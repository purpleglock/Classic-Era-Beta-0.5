-- ============================================================
-- ВЕРА-5 · ХРАМЫ-РЕТРАНСЛЯТОРЫ + ПАМЯТНИКИ ВЕРЫ
-- Применять в Supabase → SQL Editor ПОСЛЕ _faith_multi.sql,
-- а ЗАТЕМ перекатить _budget_wellbeing.sql (его economy_accrue
-- использует _faith_temple_rate из этого файла).
--
-- Суть:
--   1) Храм — ретранслятор идей, «кораптящий» население. Старые 150 ГС/слот —
--      ГАРАНТИРОВАННЫЙ ПОЛ (никто не теряет доход против прежней механики);
--      охват населения даёт только БОНУС сверху:
--
--      ставка = min(240, 150 + 90 × охват^0.7 × рвение × сеть × памятники)
--        охват     = min(1, зона / население державы)
--        зона      = слоты храмов × 120 душ × (1 + 0.10 × памятники)
--        рвение    = [1.20 1.10 1.00 0.94 0.88][соцобеспечение] —
--                    обездоленный народ ищет утешение в вере
--        сеть      = 1 + 0.03 × чужих держав в моих верах, кап 1.15
--        памятники = 1 + 0.05 × одобренных памятников, кап 1.25
--
--      Баланс: минимум = старый флэт 150, потолок 240 ГС/слот (×1.6).
--      Больше храмов выгодно ДВАЖДЫ: растёт база (слоты×ставка) и ширится
--      зона вещания → выше охват → выше сама ставка. У ~200 существующих
--      храмов худший случай = ровно прежние 30 000 ГС/сут, лучший ~48 000 —
--      «миллиардов из воздуха» нет.
--
--   2) ПАМЯТНИК ВЕРЫ: строит только ОСНОВАТЕЛЬ религии.
--      Цена: 600 «Реликтовое дерево» + 10 000 ГС. Один на колонию.
--      Оформление (название/образ/описание) уходит на модерацию, как
--      регистрация религии. Бонус: +0.5%/сут к росту населения колонии
--      (благополучие) — действует сразу; облик виден миру после одобрения.
-- ============================================================

-- ── 1) СХЕМА ────────────────────────────────────────────────
create table if not exists public.faith_monuments (
  id            uuid primary key default gen_random_uuid(),
  colony_id     uuid not null unique references public.colonies(id) on delete cascade,
  faction_id    text not null,
  faith_id      uuid not null references public.faiths(id) on delete cascade,
  name          text not null,
  description   text,
  image_url     text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  reject_reason text,
  reviewed_by   text,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.faith_monuments enable row level security;
drop policy if exists fm_select_all on public.faith_monuments;
create policy fm_select_all on public.faith_monuments
  for select to authenticated using (true);
revoke insert, update, delete on public.faith_monuments from anon, authenticated;

-- ── 2) Хелперы ──────────────────────────────────────────────
-- Число памятников державы (для формулы ставки; считаются и pending —
-- бонусы работают сразу, как у храмов, модерация касается только облика).
create or replace function public._faith_monuments_n(p_fid text)
returns int language sql stable security definer set search_path=public as $$
  select count(*)::int from public.faith_monuments
  where faction_id = p_fid and status <> 'rejected'
$$;
revoke all on function public._faith_monuments_n(text) from public;

-- Ставка дохода храма ГС/слот/сут — «ретранслятор идей».
-- Зеркало: ecFaithMechanics в economy.js (клиент только показывает
-- готовые числа из faith_status, расчёт ТОЛЬКО здесь).
create or replace function public._faith_temple_rate(p_fid text)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare
  slots numeric; pop numeric; reach numeric; cov numeric;
  b public.faction_budget; fervor numeric; net numeric; monu numeric; n int;
begin
  slots := coalesce((select sum(slots_open) from public.colony_buildings
                     where faction_id = p_fid and btype = 'temple'),0);
  pop := greatest(1, public._fac_pop(p_fid));
  n := public._faith_monuments_n(p_fid);
  monu := least(1.25, 1 + 0.05 * n);
  reach := slots * 120 * (1 + 0.10 * least(5, n));
  cov := least(1, reach / pop);
  b := public._budget_row(p_fid);
  fervor := (array[1.20, 1.10, 1.00, 0.94, 0.88])[greatest(0,least(4,b.social)) + 1];
  -- сеть: чужие державы, исповедующие ЛЮБУЮ из моих вер
  net := least(1.15, 1 + 0.03 * coalesce((
    select count(distinct m.faction_id) from public.faith_membership m
    join public.faiths f on f.id = m.faith_id and f.founder_fid = p_fid
    where m.faction_id <> p_fid),0));
  -- пол = старый флэт 150 (в минус против прежней механики уйти нельзя),
  -- бонус = до +90 за охват, разогнанный рвением/сетью/памятниками, потолок 240
  return round(least(240, 150 + 90 * power(cov, 0.7) * fervor * net * monu));
end$$;
revoke all on function public._faith_temple_rate(text) from public;

-- Охват населения (0..1) — для faith_status/UI, та же геометрия что в rate.
create or replace function public._faith_coverage(p_fid text)
returns numeric language sql stable security definer set search_path=public as $$
  select round(least(1,
    coalesce((select sum(slots_open) from public.colony_buildings
              where faction_id = p_fid and btype = 'temple'),0)
    * 120 * (1 + 0.10 * least(5, public._faith_monuments_n(p_fid)))
    / greatest(1, public._fac_pop(p_fid))), 3)
$$;
revoke all on function public._faith_coverage(text) from public;

-- ── 3) faith_monument_build ─────────────────────────────────
create or replace function public.faith_monument_build(
  p_colony_id uuid, p_name text, p_description text default null,
  p_image_url text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_fid text; v_faith uuid; c public.colonies; eco public.faction_economy;
  wood numeric; v_name text;
begin
  v_fid := public._ec_my_fid();
  if v_fid is null then raise exception 'no faction'; end if;
  -- только основатель религии умеет воздвигать памятники веры
  select faith_id into v_faith from public.faith_membership
    where faction_id = v_fid and role = 'founder' limit 1;
  if v_faith is null then
    raise exception 'only a faith founder may raise a monument';
  end if;
  select * into c from public.colonies where id = p_colony_id;
  if not found or c.faction_id is distinct from v_fid then
    raise exception 'colony not found or not yours';
  end if;
  if exists(select 1 from public.faith_monuments where colony_id = p_colony_id) then
    raise exception 'this colony already has a monument';
  end if;
  v_name := btrim(coalesce(p_name,''));
  if length(v_name) < 2 then raise exception 'monument needs a name'; end if;

  -- цена: 600 Реликтового дерева + 10 000 ГС
  select * into eco from public.faction_economy where faction_id = v_fid for update;
  wood := coalesce((eco.resources->>'Реликтовое дерево')::numeric, 0);
  if wood < 600 then raise exception 'not enough relic wood: need 600'; end if;
  if eco.gc < 10000 then raise exception 'not enough gc: need 10000'; end if;
  update public.faction_economy
     set gc = gc - 10000,
         resources = jsonb_set(resources, array['Реликтовое дерево'], to_jsonb(wood - 600), true)
   where faction_id = v_fid;

  insert into public.faith_monuments(colony_id, faction_id, faith_id, name, description, image_url)
    values(p_colony_id, v_fid, v_faith, left(v_name,60),
           nullif(btrim(coalesce(p_description,'')),''),
           nullif(btrim(coalesce(p_image_url,'')),''));
  return jsonb_build_object('ok', true, 'status', 'pending');
end$$;
revoke all on function public.faith_monument_build(uuid,text,text,text) from public;
grant execute on function public.faith_monument_build(uuid,text,text,text) to authenticated;

-- ── 4) faith_monument_edit: переподача отклонённого облика ──
create or replace function public.faith_monument_edit(
  p_id uuid, p_name text, p_description text default null,
  p_image_url text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; m public.faith_monuments;
begin
  v_fid := public._ec_my_fid();
  select * into m from public.faith_monuments where id = p_id;
  if not found or m.faction_id is distinct from v_fid then
    raise exception 'monument not found or not yours';
  end if;
  if length(btrim(coalesce(p_name,''))) < 2 then raise exception 'monument needs a name'; end if;
  update public.faith_monuments set
    name = left(btrim(p_name),60),
    description = nullif(btrim(coalesce(p_description,'')),''),
    image_url = nullif(btrim(coalesce(p_image_url,'')),''),
    status = 'pending', reject_reason = null
  where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'pending');
end$$;
revoke all on function public.faith_monument_edit(uuid,text,text,text) from public;
grant execute on function public.faith_monument_edit(uuid,text,text,text) to authenticated;

-- ── 5) Модерация (стафф): очередь + вердикт ─────────────────
create or replace function public.faith_monuments_pending_list()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.current_user_role() in ('superadmin','editor','moderator')
    then coalesce((select jsonb_agg(jsonb_build_object(
        'id', fm.id, 'name', fm.name, 'description', fm.description,
        'image_url', fm.image_url, 'created_at', fm.created_at,
        'faction_id', fm.faction_id,
        'faith_name', (select name from public.faiths where id = fm.faith_id),
        'colony_name', (select planet_name from public.colonies where id = fm.colony_id),
        'founder_name', (select a.name from public.faction_applications a
                         where a.faction_id = fm.faction_id and a.status = 'approved'
                         order by a.updated_at desc limit 1)
      ) order by fm.created_at)
      from public.faith_monuments fm where fm.status = 'pending'), '[]'::jsonb)
    else '[]'::jsonb end
$$;
revoke all on function public.faith_monuments_pending_list() from public;
grant execute on function public.faith_monuments_pending_list() to authenticated;

create or replace function public.faith_monument_review(
  p_id uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_email text;
begin
  if public.current_user_role() not in ('superadmin','editor','moderator') then
    raise exception 'forbidden: staff only';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  update public.faith_monuments set
    status = case when p_approve then 'approved' else 'rejected' end,
    reject_reason = case when p_approve then null else p_reason end,
    reviewed_by = v_email, reviewed_at = now()
  where id = p_id;
  if not found then raise exception 'monument not found'; end if;
  return jsonb_build_object('ok', true, 'status', case when p_approve then 'approved' else 'rejected' end);
end$$;
revoke all on function public.faith_monument_review(uuid,boolean,text) from public;
grant execute on function public.faith_monument_review(uuid,boolean,text) to authenticated;

-- ── 6) faith_status v6: динамика веры + памятники ───────────
-- База: _faith_multi.sql v5 (строки -- ВЕРА-2/-4 / -- МОД / -- МУЛЬТИ
-- сохранены). Добавленное помечено «-- ВОЛНА:».
create or replace function public.faith_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_fid text; m public.faith_membership; f public.faiths;
  s int; disc numeric; is_founder boolean; v_faiths jsonb;
  v_rate numeric; v_cov numeric; v_mons jsonb; v_eco jsonb;   -- ВОЛНА
begin
  v_fid := public._ec_my_fid();
  s    := public._faith_strength(v_fid);
  disc := public._faith_unit_discount(v_fid);

  -- ВОЛНА: динамическая ставка храма + охват населения + мои памятники
  v_rate := public._faith_temple_rate(v_fid);
  v_cov  := public._faith_coverage(v_fid);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', fm.id, 'colony_id', fm.colony_id, 'name', fm.name,
      'description', fm.description, 'image_url', fm.image_url,
      'status', fm.status, 'reject_reason', fm.reject_reason,
      'colony_name', (select planet_name from public.colonies where id = fm.colony_id))
      order by fm.created_at), '[]'::jsonb)
    into v_mons
  from public.faith_monuments fm where fm.faction_id = v_fid;
  v_eco := jsonb_build_object(
    'coverage', v_cov,
    'pop', public._fac_pop(v_fid),
    -- зона вещания: ТОЛЬКО слоты храмов (без сект) — та же геометрия, что в rate
    'reach', round(coalesce((select sum(slots_open) from public.colony_buildings
                             where faction_id = v_fid and btype = 'temple'),0)
                   * 120 * (1 + 0.10 * least(5, public._faith_monuments_n(v_fid)))),
    'monuments_n', public._faith_monuments_n(v_fid),
    'monument_cost', jsonb_build_object('wood', 600, 'gc', 10000));

  -- МУЛЬТИ: массив всех исповедуемых вер (с ролью, паствой и контент-модерацией)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', ff.id, 'name', ff.name, 'dogma', ff.dogma, 'color', ff.color,
      'image_url', ff.image_url, 'open', ff.open, 'founder_fid', ff.founder_fid,
      'status', ff.status, 'pending_review', ff.pending_review,
      'pending', case when mm.role = 'founder' then ff.pending else null end,
      'reject_reason', ff.reject_reason,
      'role', mm.role, 'flock', public._faith_flock(v_fid, ff.id))
      order by (mm.role = 'founder') desc, mm.joined_at asc), '[]'::jsonb)
    into v_faiths
  from public.faith_membership mm join public.faiths ff on ff.id = mm.faith_id
  where mm.faction_id = v_fid;

  -- первичная вера = основанная, иначе самая ранняя принятая
  select * into m from public.faith_membership
    where faction_id = v_fid order by (role = 'founder') desc, joined_at asc limit 1;

  if not found then
    return jsonb_build_object('faith', null, 'faiths', '[]'::jsonb,             -- МУЛЬТИ
      'can_found', public._faith_can_found(v_fid),
      'strength', s, 'unit_discount', disc,
      'temple_income', v_rate, 'tithe_pct', 0.20,                                -- ВОЛНА: живая ставка
      'wave', v_eco, 'monuments', v_mons,                                        -- ВОЛНА
      'offers_in', public._faith_offers_in(v_fid),
      'sects', '[]'::jsonb, 'exposed_here', public._faith_exposed_here(v_fid));   -- ВЕРА-4
  end if;

  select * into f from public.faiths where id = m.faith_id;
  is_founder := (m.role = 'founder');
  return jsonb_build_object(
    'faith', jsonb_build_object('id', f.id, 'name', f.name, 'dogma', f.dogma,
       'color', f.color, 'open', f.open, 'founder_fid', f.founder_fid,
       'image_url', f.image_url,                                -- МОД: картинка
       'status', f.status,                                      -- МОД: pending/approved/rejected
       'pending_review', f.pending_review,                      -- МОД: правка ждёт проверки
       'pending', case when is_founder then f.pending else null end,  -- МОД: что предложено (видит основатель)
       'reject_reason', f.reject_reason),                       -- МОД: причина отклонения
    'faiths', v_faiths,                                         -- МУЛЬТИ: все исповедуемые веры
    'role', m.role,
    'can_found', public._faith_can_found(v_fid),
    'strength', s,
    'unit_discount', disc,
    'temple_income', v_rate,                                    -- ВОЛНА: живая ставка ГС/слот
    'tithe_pct', 0.20,
    'wave', v_eco,                                              -- ВОЛНА: охват/зона/памятники
    'monuments', v_mons,                                        -- ВОЛНА: мои памятники
    'adepts', (select coalesce(jsonb_agg(jsonb_build_object(
                 'fid', mm.faction_id, 'role', mm.role,
                 'flock', public._faith_flock(mm.faction_id, f.id)) order by mm.joined_at), '[]'::jsonb)  -- МУЛЬТИ
               from public.faith_membership mm where mm.faith_id = f.id),
    'offers_in', public._faith_offers_in(v_fid),
    'offers_out', case when is_founder then (
        select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'to_fid', o.to_fid) order by o.created_at), '[]'::jsonb)
        from public.faith_offers o where o.faith_id = f.id and o.status = 'pending')
      else '[]'::jsonb end,
    -- ВЕРА-4: мои тайные секты (где сижу, риск вскрытия) + вскрытые у меня
    'sects', (select coalesce(jsonb_agg(jsonb_build_object(
        'host_fid', x.host_fid, 'exposure', round(x.exposure)) order by x.planted_at), '[]'::jsonb)
        from public.faith_sects x where x.owner_fid = v_fid and x.status = 'active'),
    'exposed_here', public._faith_exposed_here(v_fid));
end$$;
revoke all on function public.faith_status() from public;
grant execute on function public.faith_status() to authenticated;

-- ── Проверка после применения ───────────────────────────────
-- select public._faith_temple_rate('<fid>');   -- ставка ГС/слот
-- select public.faith_status();                -- ключи wave / monuments / temple_income
-- ⚠ НЕ ЗАБЫТЬ: перекатить _budget_wellbeing.sql (accrue берёт ставку отсюда)
