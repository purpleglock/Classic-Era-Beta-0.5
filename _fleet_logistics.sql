-- ════════════════════════════════════════════════════════════
-- ЛОГИСТИКА: аванпост в любой системе, право на чужую заставу,
-- разграбление оккупированной системы, сбор топлива у звезды,
-- снос чужого аванпоста.
-- Применять: node tools/db_run.js _fleet_logistics.sql
-- ПОРЯДОК: после _defense_outpost.sql, _outpost_depot.sql,
--          _fleet_tank.sql, _fleet_tank_client.sql, _war_borders_occupation.sql.
--
-- ЧТО БЫЛО НЕ ТАК. Флот тратил плечи ВПЕРЁД, а залиться мог только на своей
-- верфи или у своей заставы (_fleet_can_refuel). Заставу же ставить было
-- почти негде: _outpost_can_deploy требовал систему без флага, без колонии,
-- без чужого аванпоста И чтобы НИ ОДИН сосед по гиперпути не был под чужим
-- флагом. В обжитой галактике это ноль клеток. Итог ровно тот, на который
-- жалуется игрок: улетел — и назад не на чем; остаётся стоять или распустить.
--
-- ЧТО ТЕПЕРЬ.
--   1) Аванпост ставится в ЛЮБОЙ системе — своей, ничьей, чужой. Ограничение
--      одно: аванпост в системе ОДИН (чья застава встала первой — того место).
--      Несколько держав в одной системе (колонии, флоты) правилу не мешают.
--   2) Носитель летит куда угодно: запрет «cannot enter foreign borders» снят.
--   3) Право пользования заставами: держава просит доступ, владелец даёт или
--      отзывает. С правом чужая depot-застава заправляет как своя.
--   4) «Разграбить систему» — флот в системе, которую ДЕРЖИТ моя держава
--      (system_occupation), сливает топливо: раз в сутки на систему, до
--      половины бака, за счёт склада владельца системы.
--   5) Сбор у звезды: флот на стоянке медленно (6 ч за плечо) цедит бак сам.
--      Медленно — но брошенным флот не остаётся никогда.
--   6) Чужой аванпост можно снести боевым флотом — при войне.
-- ════════════════════════════════════════════════════════════

-- ── 0) Константы слайса (свои: _defense_const не трогаем, её ключи уже
--       один раз затирали целиком, см. _defense_const_merge.sql) ──
create or replace function public._fl_log_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'star_hours'    then 6      -- часов стоянки за одно плечо от звезды
    when 'plunder_cd_h'  then 24     -- кулдаун разграбления одной системы, ч
    when 'plunder_share' then 0.5    -- сколько бака даёт разграбление (доля)
    when 'raze_hops'     then 1      -- плеч из бака за снос чужого аванпоста
    else 0 end
$$;

-- ════════════════════════════════════════════════════════════
-- 1) ПРАВИЛА ПОСТРОЙКИ: один аванпост на систему, место — любое
-- ════════════════════════════════════════════════════════════
-- Схлопываем историю: если в системе стояли заставы двух держав, остаётся
-- та, что встала раньше (created_at, затем id — чтобы выбор был однозначным).
delete from public.outposts o
 using public.outposts k
 where k.system_id = o.system_id
   and (k.created_at, k.id) < (o.created_at, o.id);

drop index if exists public.outposts_uidx;
create unique index if not exists outposts_sys_uidx on public.outposts(system_id);

create or replace function public._outpost_can_deploy(p_fid text, p_sys text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.map_systems where id = p_sys)
     and not exists(select 1 from public.outposts where system_id = p_sys)
$$;
revoke all on function public._outpost_can_deploy(text,text) from public;
grant execute on function public._outpost_can_deploy(text,text) to authenticated;

-- Носитель летит куда угодно: логистика — не вторжение, чужая граница
-- корабль-носитель больше не разворачивает.
create or replace function public._outpost_send_ok(p_fid text, p_sys text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.map_systems where id = p_sys)
$$;
revoke all on function public._outpost_send_ok(text,text) from public;
grant execute on function public._outpost_send_ok(text,text) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 2) ПРАВО ПОЛЬЗОВАНИЯ ЗАСТАВАМИ (политика)
-- ════════════════════════════════════════════════════════════
create table if not exists public.outpost_rights (
  owner_fid    text not null,
  guest_fid    text not null,
  state        text not null default 'req' check (state in ('req','ok','no')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  primary key (owner_fid, guest_fid),
  constraint outpost_rights_sides_differ check (owner_fid <> guest_fid)
);
create index if not exists outpost_rights_guest_idx on public.outpost_rights(guest_fid);
alter table public.outpost_rights enable row level security;
do $rls$
begin
  -- Договор о заставах публичен: кто кого пускает — видно всем (как оккупация).
  if not exists(select 1 from pg_policies
                 where schemaname='public' and tablename='outpost_rights'
                   and policyname='outpost_rights_read') then
    create policy outpost_rights_read on public.outpost_rights
      for select to authenticated using (true);
  end if;
end$rls$;

create or replace function public._outpost_right_ok(p_owner text, p_guest text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.outpost_rights
                 where owner_fid = p_owner and guest_fid = p_guest and state = 'ok')
$$;

-- Попросить доступ к заставам чужой державы
create or replace function public.outpost_rights_request(p_owner_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; st text;
begin
  me := public._ec_my_fid();
  if p_owner_fid is null or p_owner_fid = me then raise exception 'кого просим?'; end if;
  if not exists(select 1 from public.faction_economy where faction_id = p_owner_fid) then
    raise exception 'нет такой державы';
  end if;
  insert into public.outpost_rights(owner_fid, guest_fid, state, requested_at, decided_at)
    values(p_owner_fid, me, 'req', now(), null)
  on conflict (owner_fid, guest_fid) do update
    set state = case when public.outpost_rights.state = 'ok' then 'ok' else 'req' end,
        requested_at = now();
  select state into st from public.outpost_rights
   where owner_fid = p_owner_fid and guest_fid = me;
  return jsonb_build_object('ok', true, 'owner', p_owner_fid, 'state', st);
end$$;
revoke all on function public.outpost_rights_request(text) from public;
grant execute on function public.outpost_rights_request(text) to authenticated;

-- Дать или отозвать право (решает владелец застав)
create or replace function public.outpost_rights_set(p_guest_fid text, p_allow boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; st text;
begin
  me := public._ec_my_fid();
  if p_guest_fid is null or p_guest_fid = me then raise exception 'кому даём?'; end if;
  st := case when coalesce(p_allow,false) then 'ok' else 'no' end;
  insert into public.outpost_rights(owner_fid, guest_fid, state, requested_at, decided_at)
    values(me, p_guest_fid, st, now(), now())
  on conflict (owner_fid, guest_fid) do update set state = st, decided_at = now();
  return jsonb_build_object('ok', true, 'guest', p_guest_fid, 'state', st);
end$$;
revoke all on function public.outpost_rights_set(text,boolean) from public;
grant execute on function public.outpost_rights_set(text,boolean) to authenticated;

-- Списки: кто просится ко мне и где прошусь я
create or replace function public.outpost_rights_list()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare me text;
begin
  me := public._ec_my_fid_opt();
  if me is null then
    return jsonb_build_object('incoming','[]'::jsonb,'outgoing','[]'::jsonb);
  end if;
  return jsonb_build_object(
    'incoming', coalesce((select jsonb_agg(jsonb_build_object(
        'fid', r.guest_fid, 'name', public._fac_name(r.guest_fid), 'state', r.state,
        'requested_at', r.requested_at, 'decided_at', r.decided_at)
        order by r.requested_at desc)
      from public.outpost_rights r where r.owner_fid = me), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(jsonb_build_object(
        'fid', r.owner_fid, 'name', public._fac_name(r.owner_fid), 'state', r.state,
        'requested_at', r.requested_at, 'decided_at', r.decided_at,
        'depots', (select count(*) from public.outposts o
                    where o.faction_id = r.owner_fid and o.mode = 'depot'))
        order by r.requested_at desc)
      from public.outpost_rights r where r.guest_fid = me), '[]'::jsonb));
end$$;
revoke all on function public.outpost_rights_list() from public;
grant execute on function public.outpost_rights_list() to authenticated;

-- ── Заправка: своя верфь, своя застава ИЛИ чужая застава с правом ──
create or replace function public._fleet_can_refuel(p_fid text, p_sys text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.colony_buildings cb
      join public.colonies c on c.id = cb.colony_id
     where cb.btype = 'shipyard' and c.faction_id = p_fid and c.system_id = p_sys)
  or exists(
    select 1 from public.outposts o
     where o.system_id = p_sys and o.mode = 'depot'
       and public._outpost_crew_k(o.crew, o.mode) >= 0.5
       and (o.faction_id = p_fid or public._outpost_right_ok(o.faction_id, p_fid)))
$$;
revoke all on function public._fleet_can_refuel(text,text) from public;
grant execute on function public._fleet_can_refuel(text,text) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 3) СБОР ТОПЛИВА У ЗВЕЗДЫ (медленно, но всегда)
-- ════════════════════════════════════════════════════════════
alter table public.fleets add column if not exists fuel_at timestamptz;
update public.fleets set fuel_at = now() where fuel_at is null;

create or replace function public._fleet_star_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare h numeric := greatest(1, public._fl_log_const('star_hours'));
begin
  update public.fleets fl
     set fuel = least(coalesce(fl.fuel_cap, 0),
                      coalesce(fl.fuel, 0)
                      + floor(extract(epoch from (now() - fl.fuel_at))/3600.0/h)),
         fuel_at = fl.fuel_at
                   + ((floor(extract(epoch from (now() - fl.fuel_at))/3600.0/h) * h)
                      || ' hours')::interval
   where fl.faction_id = p_fid
     and fl.status = 'idle' and fl.system_id is not null
     and fl.fuel_at is not null
     and coalesce(fl.fuel, 0) < coalesce(fl.fuel_cap, 0)
     and floor(extract(epoch from (now() - fl.fuel_at))/3600.0/h) >= 1;
  -- полный бак — счётчик держим у «сейчас», иначе после первой же траты
  -- мгновенно накапало бы за всё время стоянки
  update public.fleets set fuel_at = now()
   where faction_id = p_fid
     and coalesce(fuel,0) >= coalesce(fuel_cap,0)
     and (fuel_at is null or fuel_at < now() - interval '1 minute');
end$$;
revoke all on function public._fleet_star_settle(text) from public;

-- ════════════════════════════════════════════════════════════
-- 4) РАЗГРАБИТЬ СИСТЕМУ (там, где мою державу признали хозяином силой)
-- ════════════════════════════════════════════════════════════
create table if not exists public.system_plunder (
  system_id text primary key references public.map_systems(id) on delete cascade,
  actor_fid text not null,
  at        timestamptz not null default now()
);
alter table public.system_plunder enable row level security;
do $rls$
begin
  if not exists(select 1 from pg_policies
                 where schemaname='public' and tablename='system_plunder'
                   and policyname='system_plunder_read') then
    create policy system_plunder_read on public.system_plunder
      for select to authenticated using (true);
  end if;
end$rls$;

create or replace function public.fleet_plunder(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; fl public.fleets; occ public.system_occupation; cap int; have numeric;
  gain int; cd numeric; last_at timestamptz; cost jsonb; rk text; rneed numeric;
  sysname text;
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  perform public._fleet_star_settle(fid);
  select * into fl from public.fleets where id = p_id for update;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;
  if fl.status <> 'idle' or fl.system_id is null then raise exception 'флот в пути'; end if;

  select * into occ from public.system_occupation where system_id = fl.system_id;
  if not found or occ.occupier_fid is distinct from fid then
    raise exception 'грабить можно только систему, которую держит ваша держава';
  end if;

  cap  := public._fleet_cap_for(fl.composition);
  have := least(coalesce(fl.fuel, cap), cap);
  if have >= cap then raise exception 'бак и так полон'; end if;

  cd := greatest(1, public._fl_log_const('plunder_cd_h'));
  select at into last_at from public.system_plunder where system_id = fl.system_id;
  if last_at is not null and last_at > now() - (cd || ' hours')::interval then
    raise exception 'систему уже вычистили: следующий налёт через %',
      to_char(last_at + (cd || ' hours')::interval - now(), 'HH24:MI');
  end if;

  gain := least(cap - have, greatest(1, ceil(cap * public._fl_log_const('plunder_share'))::int));

  -- сколько плеч влили — столько сырья и увели со склада владельца системы
  cost := public._fleet_fuel_for(fl.composition, gain);
  for rk, rneed in select key, (value)::numeric from jsonb_each_text(cost) loop
    update public.faction_economy
       set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[rk],
             to_jsonb(greatest(0, coalesce((resources->>rk)::numeric,0) - rneed)), true)
     where faction_id = occ.owner_fid;
  end loop;

  update public.fleets set fuel = have + gain, fuel_cap = cap, fuel_at = now() where id = p_id;
  insert into public.system_plunder(system_id, actor_fid, at)
    values(fl.system_id, fid, now())
  on conflict (system_id) do update set actor_fid = fid, at = now();

  select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = fl.system_id;
  begin
    perform public._war_news(
      '🛢 Реквизиция: ' || sysname,
      format('Флот державы %s выкачал топливные склады %s. Бак пополнен на %s.',
             public._war_nm(fid), sysname, gain),
      jsonb_build_array(fid, occ.owner_fid));
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'gained', gain, 'fuel', have + gain, 'fuel_cap', cap,
                            'took', cost, 'next_at', now() + (cd || ' hours')::interval);
end$$;
revoke all on function public.fleet_plunder(uuid) from public;
grant execute on function public.fleet_plunder(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 5) СНОС ЧУЖОГО АВАНПОСТА боевым флотом (при войне)
-- ════════════════════════════════════════════════════════════
create or replace function public.outpost_raze(p_outpost_id uuid, p_fleet_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; o public.outposts; fl public.fleets; w boolean; sysname text; ships int;
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  select * into o from public.outposts where id = p_outpost_id;
  if not found then raise exception 'outpost not found'; end if;
  if o.faction_id = fid then raise exception 'это свой аванпост — его сворачивают, а не сносят'; end if;

  select * into fl from public.fleets where id = p_fleet_id for update;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;
  if fl.status <> 'idle' or fl.system_id is null then raise exception 'флот в пути'; end if;
  if fl.system_id is distinct from o.system_id then raise exception 'флот не в той системе'; end if;

  select coalesce(sum(greatest(0,(c->>'qty')::int)),0) into ships
    from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c;
  if ships < 1 then raise exception 'нечем сносить: во флоте нет кораблей'; end if;

  begin
    select public.at_war(fid, o.faction_id) into w;
  exception when undefined_function then w := false; end;
  if not coalesce(w, false) then
    raise exception 'сносить чужую заставу можно только в состоянии войны с %',
      public._war_nm(o.faction_id);
  end if;

  update public.fleets
     set fuel = greatest(0, coalesce(fuel, 0) - public._fl_log_const('raze_hops')),
         fuel_at = now()
   where id = p_fleet_id;
  delete from public.outposts where id = p_outpost_id;

  select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = o.system_id;
  begin
    perform public._war_news(
      '💥 Застава снесена: ' || sysname,
      format('Флот державы %s разнёс аванпост %s в системе %s.',
             public._war_nm(fid), public._war_nm(o.faction_id), sysname),
      jsonb_build_array(fid, o.faction_id));
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'system_id', o.system_id, 'owner', o.faction_id);
end$$;
revoke all on function public.outpost_raze(uuid,uuid) from public;
grant execute on function public.outpost_raze(uuid,uuid) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 6) КЛИЕНТСКИЕ СПИСКИ: бак цедится у звезды, флаги видны в карточке
-- ════════════════════════════════════════════════════════════
create or replace function public.fleets_mine()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  perform public._fleet_star_settle(fid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', fl.id, 'name', fl.name, 'status', fl.status, 'is_station', fl.is_station,
      'system_id', fl.system_id, 'from_sys', fl.from_sys, 'dest_sys', fl.dest_sys,
      'home_sys', fl.home_sys, 'composition', fl.composition,
      'depart_at', fl.depart_at, 'arrive_at', fl.arrive_at,
      'ships', (select coalesce(sum(greatest(0,(c->>'qty')::int)),0)
                from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c),
      'can_recall', (fl.status='idle' and fl.home_sys is not null
                     and fl.system_id is distinct from fl.home_sys),
      'fuel', greatest(0, coalesce(fl.fuel, 0)),
      'fuel_cap', greatest(0, coalesce(fl.fuel_cap, 0)),
      'can_refuel', (fl.status = 'idle' and fl.system_id is not null
                     and public._fleet_can_refuel(fid, fl.system_id)
                     and coalesce(fl.fuel,0) < coalesce(fl.fuel_cap,0)),
      -- сбор у звезды: когда капнет следующее плечо
      'star_at', case when fl.status='idle' and fl.system_id is not null
                       and coalesce(fl.fuel,0) < coalesce(fl.fuel_cap,0)
                  then coalesce(fl.fuel_at, now())
                       + (public._fl_log_const('star_hours') || ' hours')::interval
                  end,
      -- разграбление: система под нашей оккупацией, бак неполон, кулдаун прошёл
      'can_plunder', (fl.status='idle' and fl.system_id is not null
                      and coalesce(fl.fuel,0) < coalesce(fl.fuel_cap,0)
                      and exists(select 1 from public.system_occupation so
                                  where so.system_id = fl.system_id and so.occupier_fid = fid)
                      and not exists(select 1 from public.system_plunder sp
                                      where sp.system_id = fl.system_id
                                        and sp.at > now()
                                            - (public._fl_log_const('plunder_cd_h') || ' hours')::interval))
    ) order by fl.created_at asc)
    from public.fleets fl where fl.faction_id = fid
  ), '[]'::jsonb);
end$$;
revoke all on function public.fleets_mine() from public;
grant execute on function public.fleets_mine() to authenticated;

-- Видимые аванпосты: добавляем «каким моим флотом это сносить».
-- ⚠ НАДМНОЖЕСТВО версии из _outpost_depot.sql: экипаж (crew/need/k/manned/
-- wage_day) и mine_res обязаны остаться — на них держится строка экипажа в
-- панели системы (gmOutpostCrewRow). Копировать сюда версию из
-- _defense_outpost.sql нельзя: она старше и этих полей не знает.
create or replace function public.outposts_visible()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._outpost_mining_settle(fid);   -- внутри уже считается и жалование
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'system_id', o.system_id, 'faction_id', o.faction_id,
      'name', o.name, 'mode', o.mode, 'mine_res', o.mine_res, 'mine', (o.faction_id = fid),
      'faction_name', public._fac_name(o.faction_id),
      'crew',   case when o.faction_id = fid then o.crew else null end,
      'need',   case when o.faction_id = fid then public._outpost_crew_need(o.mode) else null end,
      'k',      case when o.faction_id = fid then round(public._outpost_crew_k(o.crew, o.mode), 2) else null end,
      'manned', (public._outpost_crew_k(o.crew, o.mode) >= 0.5),
      'wage_day', case when o.faction_id = fid
                    then public._defense_const('crew_wage_gc') * o.crew else null end,
      'raze_fleet', (case when o.faction_id = fid then null else
                      (select fl.id from public.fleets fl
                        where fl.faction_id = fid and fl.status = 'idle'
                          and fl.system_id = o.system_id
                        limit 1) end)
    ) order by o.created_at asc)
    from public.outposts o
    where public._defense_can_see(fid, o.system_id, o.faction_id)
  ), '[]'::jsonb);
end$$;
revoke all on function public.outposts_visible() from public;
grant execute on function public.outposts_visible() to authenticated;

-- ── Гейты прав: читающие списки не гейтим, а новые пишущие RPC — да.
--    Плюнуть в чужую заставу — военное действие (право «флот»),
--    договор о заставах ведёт тот, кто отвечает за оборону.
do $gate$
begin
  if to_regprocedure('public._fm_wrap(text,text,text,text)') is null then
    raise notice 'fm_wrap отсутствует — _fm_gates.sql не накачен, гейт пропущен';
    return;
  end if;
  perform public._fm_wrap('fleet_plunder',          'fleet',   'fleet', 'p_id');
  perform public._fm_wrap('outpost_raze',           'fleet',   null,    null);
  perform public._fm_wrap('outpost_rights_request', 'defense', null,    null);
  perform public._fm_wrap('outpost_rights_set',     'defense', null,    null);
end$gate$;

notify pgrst, 'reload schema';
