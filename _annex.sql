-- ============================================================
-- ОБЪЕДИНЕНИЕ ДЕРЖАВ (уния) — две державы становятся одним государством
-- Применять ПОСЛЕ _diplo_unions.sql и _faction_members.sql. Идемпотентно.
--
-- Возвращаем то, ради чего была уния: несколько игроков играют ОДНИМ
-- государством — общие колонии, казна, войска и наука. Ломала её ровно
-- одна вещь: младший терял партию, потому что его исследования гасились,
-- а прав на общее хозяйство у него не было никаких. Здесь этого нет:
--
--   • активы младшей ПЕРЕЛИВАЮТСЯ в старшую, исследования объединяются
--     множествами — не пропадает ни одна технология ни у кого;
--   • игрок младшей автоматически садится в состав старшей державы
--     СОПРАВИТЕЛЕМ со всеми правами и зоной «вся держава» — то есть
--     продолжает играть тем же кабинетом, просто под общим флагом;
--   • владелец может потом урезать ему права во «Дворе», как любому
--     участнику: полномочия разделяются внятно, а не «всё или ничего».
--
-- Доминион (diplo_vassals) остаётся отдельной, ОБРАТИМОЙ ступенью для тех,
-- кто хочет сперва договориться данью. Обязательным условием он НЕ является:
-- предложить объединение можно любой державе напрямую.
-- ============================================================

create table if not exists public.state_annexations (
  id uuid primary key default gen_random_uuid(),
  lead_fid  text not null,          -- кто присоединяет (сюзерен)
  minor_fid text not null,          -- кого присоединяют (вассал)
  status text not null default 'pending'
         check (status in ('pending','accepted','declined','withdrawn')),
  created_at timestamptz not null default now(),
  sealed_at  timestamptz
);
create index if not exists an_lead_idx  on public.state_annexations(lead_fid, status);
create index if not exists an_minor_idx on public.state_annexations(minor_fid, status);

alter table public.state_annexations enable row level security;
drop policy if exists "an_sel" on public.state_annexations;
create policy "an_sel" on public.state_annexations for select to authenticated using (true);
-- DML клиентам не выдаём: только через SECURITY DEFINER RPC ниже.

-- ── Депеша в общую ленту ────────────────────────────────────
create or replace function public._annex_news(p_title text, p_body text, p_color text)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, published_at, created_at, updated_at)
    values (null, '⚜ ГАЛАКТИЧЕСКАЯ ХРОНИКА', coalesce(p_color,'rgba(150,160,180,0.55)'), null, null,
      p_title, null, p_body, 'approved', now(), now(), now());
exception when others then raise notice 'annex news: %', sqlerrm; end$$;
revoke all on function public._annex_news(text,text,text) from public;

-- ── Слияние активов: младшая → старшая ──────────────────────
-- Тот же обобщённый проход, что был у унии, но с двумя правками:
--   • исследования объединяются, казна младшей не «обнуляется в никуда»,
--     а именно ПЕРЕЛИВАЕТСЯ (сумма уже начислена старшей);
--   • map_systems.union_origin помнит исходного владельца, чтобы карта
--     рисовала на бывших системах младшей ЕЁ флаг: две геральдики,
--     одно государство.
create or replace function public._annex_merge(p_lead text, p_minor text)
returns void language plpgsql security definer set search_path=public as $$
declare r record; t text;
begin
  -- 1) Казна, ресурсы, исследования
  begin
    update public.faction_economy le set
      gc = coalesce(le.gc,0) + coalesce(me.gc,0),
      resources = (
        select coalesce(jsonb_object_agg(k, to_jsonb(v)), '{}'::jsonb) from (
          select key as k, sum(value::numeric) as v from (
            select * from jsonb_each_text(coalesce(le.resources,'{}'::jsonb))
            union all
            select * from jsonb_each_text(coalesce(me.resources,'{}'::jsonb))
          ) x group by key
        ) s
      ),
      research = (
        select coalesce(jsonb_agg(distinct e), '[]'::jsonb) from (
          select jsonb_array_elements(coalesce(le.research,'[]'::jsonb)) e
          union all
          select jsonb_array_elements(coalesce(me.research,'[]'::jsonb))
        ) u
      )
    from public.faction_economy me
    where le.faction_id = p_lead and me.faction_id = p_minor;
    update public.faction_economy set gc = 0, resources = '{}'::jsonb
      where faction_id = p_minor;
  exception when others then raise notice 'annex economy: %', sqlerrm; end;

  -- 2) Территория: флаг младшей остаётся на её системах
  begin
    alter table public.map_systems add column if not exists union_origin text;
  exception when others then null; end;
  begin
    update public.map_systems
      set union_origin = coalesce(union_origin, faction), faction = p_lead
      where faction = p_minor;
  exception when others then raise notice 'annex systems: %', sqlerrm; end;

  -- 3) Всё остальное, что помечено faction_id: колонии, постройки, проекты,
  --    юниты, флоты, армии, оборона, агенты, дизайны, корпорации и т.д.
  for r in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema='public' and tb.table_name=c.table_name and tb.table_type='BASE TABLE'
    where c.table_schema='public' and c.column_name='faction_id'
      and c.data_type in ('text','character varying')
      and c.table_name not in ('faction_applications','faction_economy',
                               'state_unions','state_annexations','faction_members')
  loop
    t := r.table_name;
    begin
      execute format('update public.%I set faction_id = $1 where faction_id = $2', t)
        using p_lead, p_minor;
    exception when others then raise notice 'annex % : %', t, sqlerrm; end;
  end loop;
end$$;
revoke all on function public._annex_merge(text,text) from public;

-- ── RPC: предложить присоединение (только своему вассалу) ────
create or replace function public.annex_propose(p_target_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._fm_own_fid();
  if v_fid is null then raise exception 'только владелец державы может присоединять'; end if;
  if p_target_fid is null or p_target_fid = v_fid then raise exception 'bad target'; end if;
  if not exists(select 1 from public.faction_applications
                 where faction_id=p_target_fid and status='approved') then
    raise exception 'держава не найдена'; end if;
  -- Предложить объединение можно ЛЮБОЙ державе: доминион — не обязательная
  -- ступень, а лишь необязательный путь «сперва договориться обратимо».
  -- Единственное ограничение: сам ведущий не должен быть под чужой рукой.
  if exists(select 1 from public.diplo_vassals where vassal_fid=v_fid and status='active') then
    raise exception 'вы сами вассал — сперва разорвите свой вассалитет'; end if;
  if exists(select 1 from public.state_annexations
             where status='pending' and (lead_fid=v_fid or minor_fid=v_fid
                                      or lead_fid=p_target_fid or minor_fid=p_target_fid)) then
    raise exception 'предложение уже на рассмотрении'; end if;
  insert into public.state_annexations(lead_fid, minor_fid) values (v_fid, p_target_fid);
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.annex_propose(text) from public;
grant execute on function public.annex_propose(text) to authenticated;

-- ── RPC: отозвать своё предложение ──────────────────────────
create or replace function public.annex_withdraw(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._fm_own_fid();
  update public.state_annexations set status='withdrawn'
    where id=p_id and status='pending' and lead_fid=v_fid;
  if not found then raise exception 'предложение не найдено'; end if;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.annex_withdraw(uuid) from public;
grant execute on function public.annex_withdraw(uuid) to authenticated;

-- ── RPC: ответить (принять = слияние, необратимо) ───────────
create or replace function public.annex_respond(p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; a public.state_annexations;
        v_minor_owner uuid; v_lead_name text; v_minor_name text; v_lead_color text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._fm_own_fid();
  if v_fid is null then raise exception 'только владелец державы'; end if;
  select * into a from public.state_annexations where id=p_id and status='pending';
  if not found then raise exception 'предложение не найдено'; end if;
  if a.minor_fid <> v_fid then raise exception 'это не ваше предложение'; end if;

  if not p_accept then
    update public.state_annexations set status='declined' where id=p_id;
    return jsonb_build_object('ok',true,'joined',false);
  end if;

  select owner_id into v_minor_owner from public.faction_applications
    where faction_id=a.minor_fid and status='approved' order by updated_at desc limit 1;

  update public.state_annexations set status='accepted', sealed_at=now() where id=p_id;
  perform public._annex_merge(a.lead_fid, a.minor_fid);

  -- Младшая перестаёт быть государством. 'annexed' невидим для всех проверок
  -- status='approved': держава исчезает из реестров, карт и списков целей,
  -- но анкета, имя и герб сохраняются как исторический документ.
  update public.faction_applications set status='annexed', updated_at=now()
    where faction_id=a.minor_fid and status='approved';

  -- Вассалитеты и висящие предложения вокруг младшей закрываем.
  begin
    update public.diplo_vassals set status='broken'
      where status in ('pending','active') and (vassal_fid=a.minor_fid or overlord_fid=a.minor_fid);
  exception when others then raise notice 'annex vassals: %', sqlerrm; end;
  begin
    update public.state_annexations set status='withdrawn'
      where status='pending' and (lead_fid=a.minor_fid or minor_fid=a.minor_fid);
  exception when others then raise notice 'annex pending: %', sqlerrm; end;

  -- Игрок младшей садится в состав старшей Соправителем со всей державой
  -- в зоне ответственности. Владелец потом урежет права как любому при дворе.
  if v_minor_owner is not null then
    begin
      update public.faction_members set status='left', updated_at=now()
        where user_id=v_minor_owner and status in ('active','pending');
      insert into public.faction_members(faction_id, user_id, status, role, perms,
                                         scope_all, note, decided_by)
        values (a.lead_fid, v_minor_owner, 'active', 'coruler', '[]'::jsonb, true,
                'Соправитель по акту присоединения державы', v_minor_owner);
    exception when others then raise notice 'annex member: %', sqlerrm; end;
  end if;

  select name, color into v_lead_name, v_lead_color from public.faction_applications
    where faction_id=a.lead_fid and status='approved' limit 1;
  select name into v_minor_name from public.faction_applications
    where faction_id=a.minor_fid limit 1;
  perform public._annex_news(
    format('Акт присоединения: «%s» вошла в состав «%s»',
           coalesce(v_minor_name,a.minor_fid), coalesce(v_lead_name,a.lead_fid)),
    format('Доминион завершился присоединением. «%s» сложила государственность и вошла в состав «%s»: '
        || 'колонии, казна, войска и достижения науки обеих держав отныне общие. '
        || 'Флаг «%s» сохранён над её прежними системами, а её правитель занял место соправителя при дворе.',
           coalesce(v_minor_name,a.minor_fid), coalesce(v_lead_name,a.lead_fid),
           coalesce(v_minor_name,a.minor_fid)),
    v_lead_color);
  return jsonb_build_object('ok',true,'joined',true);
end$$;
revoke all on function public.annex_respond(uuid,boolean) from public;
grant execute on function public.annex_respond(uuid,boolean) to authenticated;

-- ── diplo_status: добавляем висящие предложения о присоединении ──
create or replace function public.diplo_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_fid text; v_uid uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  select m.union_id into v_uid from public.diplo_members m where m.fid=v_fid limit 1;
  return jsonb_build_object(
    'union', (select to_jsonb(u) from public.diplo_unions u where u.id=v_uid),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('fid',m.fid,'name',public._fac_name(m.fid)) order by m.joined_at), '[]'::jsonb)
                from public.diplo_members m where m.union_id=v_uid),
    'invites', (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'union_id',i.union_id,
                  'kind',(select kind from public.diplo_unions where id=i.union_id),
                  'name',(select name from public.diplo_unions where id=i.union_id),
                  'leader',public._fac_name((select leader_fid from public.diplo_unions where id=i.union_id))) order by i.created_at desc), '[]'::jsonb)
                from public.diplo_invites i where i.fid=v_fid and i.status='pending'),
    'vassals', (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'overlord',d.overlord_fid,'overlord_name',public._fac_name(d.overlord_fid),
                  'vassal',d.vassal_fid,'vassal_name',public._fac_name(d.vassal_fid),'tribute_pct',d.tribute_pct,'status',d.status) order by d.created_at desc), '[]'::jsonb)
                from public.diplo_vassals d where (d.overlord_fid=v_fid or d.vassal_fid=v_fid) and d.status in ('pending','active')),
    'annex', (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,
                  'lead',a.lead_fid,'lead_name',public._fac_name(a.lead_fid),
                  'minor',a.minor_fid,'minor_name',public._fac_name(a.minor_fid),
                  'status',a.status) order by a.created_at desc), '[]'::jsonb)
                from public.state_annexations a
                where (a.lead_fid=v_fid or a.minor_fid=v_fid) and a.status='pending'));
end$$;
revoke all on function public.diplo_status() from public;
grant execute on function public.diplo_status() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- vassal_propose('<fid>', 0.10) → vassal_respond(id,true)  — ступень 1
-- annex_propose('<fid>')        → annex_respond(id,true)   — ступень 2
