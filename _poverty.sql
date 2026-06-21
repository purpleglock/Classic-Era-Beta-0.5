-- ============================================================
-- ПРОСТРАНСТВЕННАЯ ЭКОНОМИКА · СРЕЗ 6 — БЕДНОСТЬ (кабинет)
-- Выполнить ПОСЛЕ _spatial_economy1..5.sql и _spatial_economy_map.sql.
-- Достраивает бедность как полноценную петлю:
--   1) ПОСЛЕДСТВИЯ — бедные системы теряют население (отток/миграция), а
--      затяжная стагнация выливается в ВОССТАНИЕ (разовый грабёж казны +
--      временный штраф просперити + событие в ленте).
--   2) МЕРЫ — игрок тратит ГС на помощь бедной системе: дотация (деньги →
--      просперити), продпайки (мгновенно гасят напряжение), экстренный импорт
--      (закрывает дефицит потребления, тормозит рост напряжения).
-- ⚠ Зеркало в economy.js: spatial_status теперь отдаёт strain/pop/relief/revolt;
--   EC.spatial[sid] эти поля несёт; ecPovertySection / ecPovertySummary рендерят;
--   ecReliefApply → poverty_relief.
-- Надстройка над срезом 4: переопределяет _econ_adjust, _system_balance,
-- _econ_update_status, spatial_status (логистика+спилловер+сектор СОХРАНЕНЫ).
-- ============================================================

-- ── Схема ───────────────────────────────────────────────────
-- Доля заселённости колонии (миграция): 0.4..1. cells остаётся ёмкостью
-- застройки (не трогаем!), а эффективное население = cells × pop_mult.
alter table public.colonies   add column if not exists pop_mult numeric not null default 1;
update public.colonies set pop_mult = 1 where pop_mult is null;
-- Временный штраф просперити после восстания.
alter table public.system_econ add column if not exists revolt_until timestamptz;

-- Меры помощи бедным системам (активные дотации/пайки/импорт).
create table if not exists public.econ_relief (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  owner_id    uuid,
  system_id   text not null,
  kind        text not null check (kind in ('subsidy','ration','import')),
  prosp_bonus numeric not null default 0,   -- прибавка к просперити пока активна
  until       timestamptz,                  -- до какого момента активна (null = бессрочно)
  created_at  timestamptz default now()
);
-- (без предиката now() — он не IMMUTABLE; активность фильтруем в запросах)
create index if not exists relief_sys_idx on public.econ_relief(system_id);
create index if not exists relief_fac_idx on public.econ_relief(faction_id);

alter table public.econ_relief enable row level security;
drop policy if exists "relief_sel" on public.econ_relief;
create policy "relief_sel" on public.econ_relief for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));

-- ── Активная помощь системе (сумма прибавок просперити) ──────
create or replace function public._poverty_relief_prosp(p_system_id text)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(sum(prosp_bonus),0) from public.econ_relief
   where system_id = p_system_id and (until is null or until > now());
$$;
revoke all on function public._poverty_relief_prosp(text) from public;
grant execute on function public._poverty_relief_prosp(text) to anon, authenticated;

-- Активен ли экстренный импорт (тормозит рост напряжения).
create or replace function public._poverty_import_active(p_system_id text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.econ_relief
    where system_id = p_system_id and kind = 'import' and (until is null or until > now()));
$$;
revoke all on function public._poverty_import_active(text) from public;
grant execute on function public._poverty_import_active(text) to anon, authenticated;

-- ── Корректировка просперити: сектор + статус + ПОМОЩЬ/ВОССТАНИЕ ──
--   Применяется в КОНЦЕ обоих балансов. Помощь (дотации) поднимает просперити
--   ПОВЕРХ потолка стагнации — в этом и смысл вливания денег. Восстание режет.
create or replace function public._econ_adjust(p_system_id text, p_prosp numeric, p_status text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare smod numeric; persist text; fstatus text; pr numeric; rel numeric; rv timestamptz;
begin
  select case when econ_until is not null and econ_until < now() then 1 else coalesce(econ_mod,1) end
    into smod from public.map_sectors where p_system_id = any(system_ids) limit 1;
  smod := coalesce(smod, 1);
  select status, revolt_until into persist, rv from public.system_econ where system_id = p_system_id;
  fstatus := coalesce(persist, p_status);
  pr := p_prosp * smod;
  if fstatus = 'stagnation' then pr := least(pr, 0.4);
  elsif fstatus = 'unrest' then pr := pr * 0.85; end if;
  if rv is not null and rv > now() then pr := pr * 0.8; end if;          -- штраф после восстания
  pr := pr + public._poverty_relief_prosp(p_system_id);                  -- помощь (поверх потолка)
  pr := round(least(1.6, greatest(0.4, pr)), 3);
  return jsonb_build_object('prosperity', pr, 'status', fstatus);
end$$;
revoke all on function public._econ_adjust(text,numeric,text) from public;
grant execute on function public._econ_adjust(text,numeric,text) to anon, authenticated;

-- ── Баланс системы (raw) — население с учётом миграции (pop_mult) ──
create or replace function public._system_balance(p_system_id text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  r record; v jsonb;
  sup_r numeric:=0; sup_g numeric:=0; sup_c numeric:=0;
  dem_r numeric:=0; dem_g numeric:=0; dem_c numeric:=0;
  lab_d numeric:=0; pop numeric:=0; lab_s numeric;
  cov_r numeric; cov_g numeric; cov_c numeric; cov_l numeric;
  pr_r numeric; pr_g numeric; pr_c numeric;
  welfare numeric; prosperity numeric; st text; adj jsonb;
begin
  -- эффективное население = ёмкость × доля заселённости (миграция, срез 6)
  select coalesce(sum(cells * coalesce(pop_mult,1)),0) into pop
    from public.colonies where system_id = p_system_id;

  for r in
    select cb.btype, cb.slots_open, cb.tnp_mode
    from public.colony_buildings cb
    join public.colonies c on c.id = cb.colony_id
    where c.system_id = p_system_id
  loop
    v := public._building_vector(r.btype, r.slots_open, coalesce(r.tnp_mode,false));
    sup_r := sup_r + (v->>'ro')::numeric; sup_g := sup_g + (v->>'go')::numeric; sup_c := sup_c + (v->>'co')::numeric;
    dem_r := dem_r + (v->>'ri')::numeric; dem_g := dem_g + (v->>'gi')::numeric; dem_c := dem_c + (v->>'ci')::numeric;
    lab_d := lab_d + (v->>'l')::numeric;
  end loop;

  lab_s := pop * 1;
  dem_c := dem_c + pop * 0.5;

  cov_r := case when dem_r<=0 then 1 else round(sup_r/dem_r,3) end;
  cov_g := case when dem_g<=0 then 1 else round(sup_g/dem_g,3) end;
  cov_c := case when dem_c<=0 then 1 else round(sup_c/dem_c,3) end;
  cov_l := case when lab_d<=0 then 1 else round(lab_s/lab_d,3) end;

  pr_r := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_r))),3);
  pr_g := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_g))),3);
  pr_c := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_c))),3);

  welfare := least(2.0, greatest(0, least(cov_c, cov_l)));
  prosperity := round(least(1.6, greatest(0.4, 0.4 + 0.6*welfare)),3);
  if cov_c < 0.4 or cov_l < 0.4 then st := 'stagnation';
  elsif cov_c < 0.7 or cov_l < 0.7 then st := 'unrest';
  else st := 'ok'; end if;

  adj := public._econ_adjust(p_system_id, prosperity, st);
  prosperity := (adj->>'prosperity')::numeric; st := adj->>'status';

  return jsonb_build_object(
    'system_id', p_system_id, 'pop', pop,
    'supply',   jsonb_build_object('r',sup_r,'g',sup_g,'c',sup_c),
    'demand',   jsonb_build_object('r',dem_r,'g',dem_g,'c',dem_c),
    'labor',    jsonb_build_object('supply',lab_s,'demand',lab_d),
    'coverage', jsonb_build_object('r',cov_r,'g',cov_g,'c',cov_c,'l',cov_l),
    'prices',   jsonb_build_object('r',pr_r,'g',pr_g,'c',pr_c),
    'prosperity', prosperity, 'status', st
  );
end$$;
revoke all on function public._system_balance(text) from public;
grant execute on function public._system_balance(text) to anon, authenticated;
-- _system_balance_net (срез 4) НЕ переопределяем: он читает raw->pop, который уже
-- учитывает миграцию, и вызывает обновлённый _econ_adjust. Логистика/спилловер целы.

-- ── Накопление статуса + МИГРАЦИЯ + ВОССТАНИЕ ───────────────
--   Вызывается из economy_accrue раз в день тика (как и в срезе 4).
create or replace function public._econ_update_status(p_fid text, p_days int)
returns void language plpgsql security definer set search_path=public as $$
declare
  s record; nb jsonb; cc numeric; cl numeric; w numeric; cur numeric; strn numeric; newst text;
  imp boolean; loss numeric; sysname text; sysgc numeric;
begin
  for s in select distinct c.system_id as sid from public.colonies c
           where c.faction_id = p_fid and c.system_id is not null loop
    nb := public._system_balance_net(s.sid);
    cc := coalesce((nb->'coverage'->>'c')::numeric, 1);
    cl := coalesce((nb->'coverage'->>'l')::numeric, 1);
    w  := least(cc, cl);
    imp := public._poverty_import_active(s.sid);

    -- напряжение: дефицит копит, достаток снимает; импорт тормозит рост
    select strain into cur from public.system_econ where system_id = s.sid;
    strn := coalesce(cur, 0);
    if w < 0.4 then strn := strn + (case when imp then 0 else 2 end)*p_days;
    elsif w < 0.7 then strn := strn + (case when imp then 0 else 1 end)*p_days;
    elsif w >= 0.9 then strn := strn - 1*p_days;
    end if;
    strn := least(6, greatest(0, strn));
    newst := case when strn >= 4 then 'stagnation' when strn >= 2 then 'unrest' else 'ok' end;
    insert into public.system_econ(system_id, strain, status, updated_at)
      values(s.sid, strn, newst, now())
      on conflict (system_id) do update set strain = excluded.strain, status = excluded.status, updated_at = now();

    -- МИГРАЦИЯ: бедность гонит население прочь, достаток возвращает (к базе 1.0)
    if w < 0.4 then
      update public.colonies set pop_mult = greatest(0.4, round(pop_mult - 0.05*p_days, 3))
        where system_id = s.sid;
    elsif w < 0.7 then
      update public.colonies set pop_mult = greatest(0.6, round(pop_mult - 0.02*p_days, 3))
        where system_id = s.sid;
    elsif w >= 0.9 then
      update public.colonies set pop_mult = least(1.0, round(pop_mult + 0.05*p_days, 3))
        where system_id = s.sid;
    end if;

    -- ВОССТАНИЕ: затяжная стагнация (strain на максимуме) → грабёж казны + штраф
    if strn >= 6 and not coalesce((select revolt_until from public.system_econ where system_id = s.sid) > now(), false)
       and random() < (1 - power(0.75, p_days)) then
      select coalesce(sum(cells * coalesce(pop_mult,1)),0) into loss
        from public.colonies where system_id = s.sid;
      select gc into sysgc from public.faction_economy where faction_id = p_fid;
      loss := least(coalesce(sysgc,0) * 0.10, loss * 40);
      update public.faction_economy set gc = greatest(0, gc - round(loss)) where faction_id = p_fid;
      update public.system_econ set revolt_until = now() + interval '4 days' where system_id = s.sid;
      select name into sysname from public.map_systems where id = s.sid;
      insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
          title, excerpt, body, status, published_at, created_at, updated_at)
        values(p_fid, '🔥 БЕСПОРЯДКИ', 'rgba(200,60,40,0.55)', null, null,
          'Восстание из-за нищеты', null,
          format('Доведённое до отчаяния население системы «%s» восстало. Беспорядки разграбили казну на %s ГС; экономика системы подорвана на несколько дней. Помогите бедствующим системам, пока недовольство не перекинулось дальше.',
            coalesce(sysname,'неизвестной системы'), to_char(round(loss), 'FM999999999')),
          'approved', now(), now(), now());
    end if;
  end loop;
end$$;
revoke all on function public._econ_update_status(text,int) from public;

-- ── spatial_status: + strain / население / меры / восстание ──
create or replace function public.spatial_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare app public.faction_applications; res jsonb := '[]'::jsonb; s record; bal jsonb;
  v_strain numeric; v_pop numeric; v_rv timestamptz; v_relief jsonb;
begin
  select * into app from public.faction_applications
    where owner_id = auth.uid() and status = 'approved' order by updated_at desc limit 1;
  if not found then return res; end if;
  for s in
    select distinct c.system_id, ms.name
    from public.colonies c
    left join public.map_systems ms on ms.id = c.system_id
    where c.faction_id = app.faction_id and c.system_id is not null
  loop
    bal := public._system_balance_net(s.system_id) || jsonb_build_object('name', s.name);
    select coalesce(strain,0), revolt_until into v_strain, v_rv
      from public.system_econ where system_id = s.system_id;
    -- средняя доля заселённости системы (миграция)
    select case when sum(cells) > 0 then round(sum(cells*coalesce(pop_mult,1))/sum(cells),3) else 1 end
      into v_pop from public.colonies where system_id = s.system_id;
    -- активные меры помощи этой системе
    select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'until', until)), '[]'::jsonb)
      into v_relief from public.econ_relief
      where system_id = s.system_id and faction_id = app.faction_id and (until is null or until > now());
    res := res || jsonb_build_array(bal || jsonb_build_object(
      'strain', coalesce(v_strain,0),
      'pop_mult', coalesce(v_pop,1),
      'revolt_until', v_rv,
      'relief', v_relief));
  end loop;
  return res;
end$$;
revoke all on function public.spatial_status() from public;
grant execute on function public.spatial_status() to authenticated;

-- ── RPC: оказать помощь бедной системе (тратит ГС) ──────────
--   Меры (на эффективное население pop системы):
--     subsidy — дотация: +0.25 просперити на 5 дн. (дорого, лечит доход).
--     ration  — продпайки: −3 напряжения сразу + 0.10 просперити на 3 дн.
--     import  — экстренный импорт: +0.15 просперити на 7 дн. + тормоз напряжения.
create or replace function public.poverty_relief(p_system_id text, p_kind text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  app public.faction_applications; eco public.faction_economy;
  pop numeric; cost numeric; bonus numeric; days int;
begin
  select * into app from public.faction_applications
    where owner_id = auth.uid() and status = 'approved' order by updated_at desc limit 1;
  if not found then raise exception 'no faction'; end if;
  if p_kind not in ('subsidy','ration','import') then raise exception 'bad kind'; end if;
  if not exists(select 1 from public.colonies where system_id = p_system_id and faction_id = app.faction_id) then
    raise exception 'not your system'; end if;

  select coalesce(sum(cells * coalesce(pop_mult,1)),0) into pop
    from public.colonies where system_id = p_system_id;

  if    p_kind = 'subsidy' then cost := greatest(15000, ceil(pop*450)); bonus := 0.25; days := 5;
  elsif p_kind = 'ration'  then cost := greatest(10000, ceil(pop*300)); bonus := 0.10; days := 3;
  else                          cost := greatest(12000, ceil(pop*350)); bonus := 0.15; days := 7;
  end if;

  select * into eco from public.faction_economy where faction_id = app.faction_id for update;
  if not found then raise exception 'no economy'; end if;
  if eco.gc < cost then raise exception 'not enough'; end if;

  update public.faction_economy set gc = gc - cost where faction_id = app.faction_id;

  -- одна активная мера данного вида на систему: старую гасим
  update public.econ_relief set until = now()
    where system_id = p_system_id and faction_id = app.faction_id and kind = p_kind
      and (until is null or until > now());
  insert into public.econ_relief(faction_id, owner_id, system_id, kind, prosp_bonus, until)
    values(app.faction_id, auth.uid(), p_system_id, p_kind, bonus, now() + (days || ' days')::interval);

  -- продпайки мгновенно снимают напряжение (−3, не ниже 0)
  if p_kind = 'ration' then
    update public.system_econ
      set strain = greatest(0, strain - 3),
          status = case when greatest(0, strain - 3) >= 4 then 'stagnation'
                        when greatest(0, strain - 3) >= 2 then 'unrest' else 'ok' end,
          updated_at = now()
      where system_id = p_system_id;
  end if;

  return jsonb_build_object('ok', true, 'kind', p_kind, 'cost', round(cost),
    'bonus', bonus, 'days', days, 'gc', eco.gc - cost);
end$$;
revoke all on function public.poverty_relief(text,text) from public;
grant execute on function public.poverty_relief(text,text) to authenticated;

-- ── Проверка после применения ───────────────────────────────
-- select public.spatial_status();   -- у систем появились strain/pop_mult/relief/revolt_until
-- select public.poverty_relief('<system_id>','subsidy');  -- дотация (тратит ГС, +просперити)
-- держите систему в дефиците несколько тиков → отток населения (pop_mult↓) → восстание
