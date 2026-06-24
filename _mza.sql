-- ============================================================
--  ГИПЕРПЕЙСЕР — МОБИЛЬНОЕ ОРУДИЕ СУДНОГО ДНЯ
--  (внутр. идентификаторы оставлены как mza_* — это техническое имя)
--
--  Корабль-носитель орудия судного дня. В отличие от стационарной
--  «Длани Неотвратимости» (doomgun) — СТРОИТСЯ В КОНСТРУКТОРЕ КАК
--  КОРАБЛЬ, ГОНЯЕТСЯ ПО ВСЕЙ КАРТЕ по гиперпутям и «шпуляет» залпы
--  по любой планете карты (превращает её в мёртвую — как doomgun).
--
--  Цепочка:
--   1) Исследование «Сама неотвратимость» (pol.inevitability) — то же,
--      что открывает doomgun. Без него МЗА не построить.
--   2) Постройка МЗА (mza_build) в системе своей колонии: ГС +
--      Программируемая материя, строится СУТКИ → появляется на карте.
--   3) Отправка по гиперпутям в любую систему карты (долёт = дистанция).
--   4) Залп (mza_fire) из текущей системы по планете-цели: тратит
--      Гравиядра, изнашивает носитель, снаряд летит (долёт = дистанция),
--      затем поражает планету через общий резолвер _doom_resolve.
--   5) Залп и постройка льют пугающие сводки в ленту сектора.
--
--  Зависимости (ДОЛЖНЫ быть применены РАНЕЕ):
--   • _interstellar_artillery.sql — doom_salvos, _doom_resolve,
--     _doom_news, узел tech_nodes('pol.inevitability'). МЗА
--     переиспользует таблицу залпов и общий резолвер: _doom_resolve
--     уже разрешает ВСЕ залпы фракции (в т.ч. наши mza_id) и шлёт
--     новость «☠ ПЛАНЕТА УНИЧТОЖЕНА».
--   • _security_money.sql           — _ec_my_fid
--   • _map_setup.sql                — map_systems(x,y,planets)
--   • _economy_setup.sql            — colonies, faction_economy
--
--  Выполнить ЦЕЛИКОМ в Supabase → SQL Editor ПОСЛЕ
--  _interstellar_artillery.sql. Идемпотентно.
-- ============================================================

-- ── 1) ЗАЛПЫ: отметка «выпущен с МЗА» (а не со стационарного орудия) ──
-- gun_id у таких залпов = null; mza_id указывает на корабль-носитель.
-- _doom_resolve фильтрует по faction_id+status, поэтому наши залпы он
-- разрешает наравне с обычными (планета → мёртвая + новость).
alter table public.doom_salvos add column if not exists mza_id uuid;
create index if not exists doom_salvos_mza_idx on public.doom_salvos(mza_id);

-- ── 2) ТАБЛИЦА: корабли-носители МЗА ────────────────────────
--   status='building' — строится в системе system_id, готов в arrive_at (сутки)
--   status='idle'     — стоит в системе system_id (готов к отправке / залпу)
--   status='transit'  — летит from_sys → dest_sys, прибудет в arrive_at
create table if not exists public.mza_ships (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  owner_id    uuid,
  name        text,
  status      text not null default 'idle',
  system_id   text references public.map_systems(id) on delete set null,   -- где стоит (building/idle)
  from_sys    text references public.map_systems(id) on delete set null,   -- откуда летит (transit)
  dest_sys    text references public.map_systems(id) on delete set null,   -- куда летит (transit)
  integrity   numeric not null default 100,    -- износ от выстрелов; <=0 → негодна
  total_shots int not null default 0,
  depart_at   timestamptz,
  arrive_at   timestamptz,
  created_at  timestamptz default now()
);
create index if not exists mza_fac_idx on public.mza_ships(faction_id);
create index if not exists mza_sys_idx on public.mza_ships(system_id);

alter table public.mza_ships enable row level security;
drop policy if exists "mza_sel" on public.mza_ships;
drop policy if exists "mza_all" on public.mza_ships;
-- читать всем (угроза видна как и doom_salvos), писать — только через RPC
create policy "mza_sel" on public.mza_ships for select to public using (true);
create policy "mza_all" on public.mza_ships for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

-- ── 3) КОНСТАНТЫ (баланс) ───────────────────────────────────
create or replace function public._mza_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'build_gc'      then 1200000  -- ГС за постройку носителя (премия за мобильность)
    when 'build_matter'  then 60       -- Программируемой материи за постройку
    when 'build_h'       then 24       -- постройка занимает сутки
    when 'shot_grav'     then 12       -- Гравиядра за один залп
    when 'shot_wear'     then 25       -- износ integrity за выстрел (≈4 залпа на корпус)
    when 'fly_h_min'     then 2        -- мин. перелёт носителя (соседняя система), часов
    when 'fly_h_max'     then 20       -- макс. перелёт носителя (край↔край карты), часов
    when 'salvo_h_min'   then 3        -- мин. долёт залпа (соседняя система), часов
    when 'salvo_h_max'   then 24       -- макс. долёт залпа (край↔край карты) = 1 сутки
    when 'refund'        then 0.50     -- доля возврата ГС при списании носителя
    else 0 end
$$;

-- ── helper: долёт по дистанции (доля диагонали карты × диапазон часов) ──
create or replace function public._mza_dist_hours(p_from text, p_to text, p_min numeric, p_max numeric)
returns numeric language sql stable security definer set search_path=public as $$
  with a as (select x, y from public.map_systems where id = p_from),
       b as (select x, y from public.map_systems where id = p_to),
       d as (select sqrt(power(max(x)-min(x),2) + power(max(y)-min(y),2)) diag from public.map_systems)
  select p_min + least(1.0, greatest(0.0,
           sqrt(power(coalesce(b.x,0)-coalesce(a.x,0),2) + power(coalesce(b.y,0)-coalesce(a.y,0),2))
           / nullif((select diag from d),0)))
         * (p_max - p_min)
  from a, b
$$;
revoke all on function public._mza_dist_hours(text,text,numeric,numeric) from public;

-- ── 4) Ленивое «прибытие/достройка»: building→idle, transit→idle@dest ──
create or replace function public._mza_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.mza_ships
    set status='idle', depart_at=null, arrive_at=null
    where faction_id=p_fid and status='building' and arrive_at <= now();
  update public.mza_ships
    set status='idle', system_id=dest_sys, from_sys=null, dest_sys=null,
        depart_at=null, arrive_at=null
    where faction_id=p_fid and status='transit' and arrive_at <= now();
end$$;
revoke all on function public._mza_settle(text) from public;

-- ── 5) RPC: построить МЗА (в системе своей колонии; строится СУТКИ) ──
create or replace function public.mza_build(p_system_id text, p_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; res jsonb;
  gc_cost numeric; matter_need numeric; have_matter numeric; build_h numeric; ready timestamptz; v_id uuid;
  sysname text; fname text;
begin
  fid := public._ec_my_fid();
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  -- ВОРОТА: исследование «Сама неотвратимость» (то же, что у doomgun)
  if not (coalesce(eco.research,'[]'::jsonb) ? 'pol.inevitability') then
    raise exception 'research required: pol.inevitability';
  end if;
  if not exists(select 1 from public.colonies where faction_id=fid and system_id=p_system_id) then
    raise exception 'build MZA only at a system with your colony';
  end if;

  gc_cost     := public._mza_const('build_gc');
  matter_need := public._mza_const('build_matter');
  res := coalesce(eco.resources,'{}'::jsonb);
  have_matter := coalesce((res->>'Программируемая материя')::numeric, 0);
  if have_matter < matter_need then
    raise exception 'not enough programmable matter: need %, have %', matter_need, floor(have_matter);
  end if;
  if coalesce(eco.gc,0) < gc_cost then raise exception 'not enough GC'; end if;

  res := jsonb_set(res, array['Программируемая материя'], to_jsonb(have_matter - matter_need), true);
  update public.faction_economy set gc = gc - gc_cost, resources = res
    where faction_id = fid and gc >= gc_cost;
  if not found then raise exception 'not enough GC'; end if;

  build_h := public._mza_const('build_h');
  ready := now() + (build_h || ' hours')::interval;
  insert into public.mza_ships(faction_id, owner_id, name, status, system_id, depart_at, arrive_at)
    values(fid, auth.uid(), nullif(trim(coalesce(p_name,'')),''), 'building', p_system_id, now(), ready)
    returning id into v_id;

  select name into sysname from public.map_systems where id=p_system_id;
  select name into fname from public.faction_applications where faction_id=fid and status='approved' order by updated_at desc limit 1;
  perform public._doom_news(
    '☣ ЗАЛОЖЕН ГИПЕРПЕЙСЕР',
    coalesce(fname,'Неизвестная держава')||' закладывает Гиперпейсер — мобильное орудие судного дня — в системе «'||
    coalesce(sysname,'???')||'». Теперь приговор мирам обретёт ноги: он сможет прийти к любой звезде.');

  return jsonb_build_object('ok', true, 'id', v_id, 'gc', gc_cost, 'matter', matter_need, 'ready_at', ready);
end$$;
revoke all on function public.mza_build(text,text) from public;
grant execute on function public.mza_build(text,text) to authenticated;

-- ── 6) RPC: отправить МЗА по гиперпутям в систему-цель (вся карта) ──
create or replace function public.mza_send(p_id uuid, p_dest_sys text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; sh public.mza_ships; fly_h numeric;
begin
  fid := public._ec_my_fid();
  perform public._mza_settle(fid);
  select * into sh from public.mza_ships where id=p_id;
  if not found then raise exception 'MZA not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your MZA'; end if;
  if sh.status = 'building' then raise exception 'MZA is still under construction'; end if;
  if sh.status <> 'idle' then raise exception 'MZA is already in transit'; end if;
  if sh.integrity <= 0 then raise exception 'MZA is wrecked'; end if;
  if not exists(select 1 from public.map_systems where id=p_dest_sys) then raise exception 'no such system'; end if;
  if p_dest_sys = sh.system_id then raise exception 'MZA is already there'; end if;

  fly_h := coalesce(public._mza_dist_hours(sh.system_id, p_dest_sys,
                      public._mza_const('fly_h_min'), public._mza_const('fly_h_max')),
                    public._mza_const('fly_h_min'));
  update public.mza_ships
    set status='transit', from_sys=system_id, dest_sys=p_dest_sys, system_id=null,
        depart_at=now(), arrive_at=now() + (round(fly_h*60)::int || ' minutes')::interval
    where id=p_id;
  return jsonb_build_object('ok', true, 'fly_h', round(fly_h,1),
                            'arrive_at', now() + (round(fly_h*60)::int || ' minutes')::interval);
end$$;
revoke all on function public.mza_send(uuid,text) from public;
grant execute on function public.mza_send(uuid,text) to authenticated;

-- ── 7) RPC: ЗАЛП по планете-цели из текущей системы носителя ──
-- Снимаем прежнюю 3-арг сигнатуру (добавляем p_target_name для целей без pid).
drop function if exists public.mza_fire(uuid, text, int);
create or replace function public.mza_fire(p_id uuid, p_target_system_id text,
                                           p_target_pid int, p_target_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; sh public.mza_ships; eco public.faction_economy; res jsonb;
  grav_need numeric; have_grav numeric; tgt public.map_systems; pl jsonb; rdy timestamptz;
  fly_h numeric; ptname text; fname text; newint numeric;
begin
  fid := public._ec_my_fid();
  perform public._mza_settle(fid);
  select * into sh from public.mza_ships where id=p_id;
  if not found then raise exception 'MZA not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your MZA'; end if;
  if sh.status <> 'idle' or sh.system_id is null then raise exception 'MZA must be idle in a system to fire'; end if;
  if sh.integrity <= 0 then raise exception 'MZA is wrecked'; end if;
  if exists(select 1 from public.doom_salvos where mza_id = sh.id and status='in_flight') then
    raise exception 'salvo already in flight';
  end if;

  -- цель: планета по pid в системе
  select * into tgt from public.map_systems where id = p_target_system_id;
  if not found then raise exception 'target system not found'; end if;
  if p_target_pid is not null then
    select value into pl from jsonb_array_elements(coalesce(tgt.planets,'[]'::jsonb))
      where (value->>'pid')::int = p_target_pid limit 1;
  end if;
  if pl is null then
    -- столица/домик может жить ТОЛЬКО в colonies (нет записи в map_systems.planets,
    -- planet_pid может быть не проставлен): целим по planet_pid, иначе по ИМЕНИ.
    select coalesce(planet_name,'планета') into ptname from public.colonies
      where system_id = p_target_system_id
        and ((p_target_pid is not null and planet_pid = p_target_pid)
             or (p_target_name is not null and planet_name = p_target_name))
      order by (planet_pid is not null) desc limit 1;
    if ptname is null then raise exception 'target planet not found'; end if;
  else
    if coalesce((pl->>'dead')::boolean, false) then raise exception 'planet already dead'; end if;
    ptname := coalesce(pl->>'name','планета');
  end if;

  -- топливо: Гравиядра
  select * into eco from public.faction_economy where faction_id = fid for update;
  grav_need := public._mza_const('shot_grav');
  res := coalesce(eco.resources,'{}'::jsonb);
  have_grav := coalesce((res->>'Гравиядро')::numeric, 0);
  if have_grav < grav_need then
    raise exception 'not enough gravity cores: need %, have %', grav_need, floor(have_grav);
  end if;
  res := jsonb_set(res, array['Гравиядро'], to_jsonb(have_grav - grav_need), true);
  update public.faction_economy set resources = res where faction_id = fid;

  -- износ носителя
  newint := greatest(0, sh.integrity - public._mza_const('shot_wear'));
  update public.mza_ships set integrity = newint, total_shots = total_shots + 1 where id = sh.id;

  -- долёт залпа = дистанция от носителя до цели
  fly_h := coalesce(public._mza_dist_hours(sh.system_id, p_target_system_id,
                      public._mza_const('salvo_h_min'), public._mza_const('salvo_h_max')),
                    public._mza_const('salvo_h_min'));
  rdy := now() + (round(fly_h*60)::int || ' minutes')::interval;
  insert into public.doom_salvos
    (gun_id, mza_id, faction_id, owner_id, origin_system_id, target_system_id, target_pid, target_planet, ready_at)
  values
    (null, sh.id, fid, auth.uid(), sh.system_id, p_target_system_id, p_target_pid, ptname, rdy);

  select name into fname from public.faction_applications where faction_id=fid and status='approved' order by updated_at desc limit 1;
  perform public._doom_news(
    '🜨 ЗАЛП ГИПЕРПЕЙСЕРА ВЫПУЩЕН — ОТСЧЁТ ПОШЁЛ',
    'Гиперпейсер ('||coalesce(fname,'???')||') дал залп по системе «'||coalesce(tgt.name,'???')||
    '». Снаряд уже в пути к планете «'||ptname||'» — расчётное время полёта ~'||
    to_char(fly_h,'FM990.0')||' ч. Орудие можно увезти куда угодно — спрятаться негде.');

  return jsonb_build_object('ok', true, 'grav', grav_need, 'ready_at', rdy, 'target', ptname,
                            'flight_h', round(fly_h,1), 'integrity', newint);
end$$;
revoke all on function public.mza_fire(uuid,text,int,text) from public;
grant execute on function public.mza_fire(uuid,text,int,text) to authenticated;

-- ── 8) RPC: списать носитель МЗА (частичный возврат ГС) ──
create or replace function public.mza_scrap(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; sh public.mza_ships; refund numeric;
begin
  fid := public._ec_my_fid();
  select * into sh from public.mza_ships where id=p_id;
  if not found then raise exception 'MZA not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your MZA'; end if;
  refund := floor(public._mza_const('build_gc') * public._mza_const('refund'));
  delete from public.mza_ships where id=p_id;
  update public.faction_economy set gc = gc + refund where faction_id=fid;
  return jsonb_build_object('ok', true, 'refund', refund);
end$$;
revoke all on function public.mza_scrap(uuid) from public;
grant execute on function public.mza_scrap(uuid) to authenticated;

-- ── 9) RPC: мои носители МЗА (building + idle + в полёте) ──
-- VOLATILE: внутри _mza_settle делает UPDATE (ленивое прибытие/достройка).
create or replace function public.mza_ships_mine()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._mza_settle(fid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', sh.id, 'name', sh.name, 'status', sh.status,
      'system_id', sh.system_id, 'from_sys', sh.from_sys, 'dest_sys', sh.dest_sys,
      'depart_at', sh.depart_at, 'arrive_at', sh.arrive_at,
      'integrity', sh.integrity, 'total_shots', sh.total_shots,
      'in_flight', exists(select 1 from public.doom_salvos s where s.mza_id=sh.id and s.status='in_flight'),
      'can_fire', (sh.status='idle' and sh.system_id is not null and sh.integrity > 0
        and not exists(select 1 from public.doom_salvos s where s.mza_id=sh.id and s.status='in_flight'))
    ) order by sh.created_at asc)
    from public.mza_ships sh where sh.faction_id = fid
  ), '[]'::jsonb);
end$$;
revoke all on function public.mza_ships_mine() from public;
grant execute on function public.mza_ships_mine() to authenticated;

-- ── 10) АДМИН: выдать готовую МЗА фракции (без исследования и затрат) ──
-- Спавнит готовую МЗА (idle) в ЛЮБОЙ системе карты (p_system_id) — конкретное
-- место. Если система не указана — берём первую колонию фракции. Владелец юнита
-- наследуется от владельца фракции. Заодно открывает исследование (для согласия UI).
create or replace function public.admin_grant_mza(p_fid text, p_system_id text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare sid text; v_owner uuid; v_id uuid; sysname text;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  sid := p_system_id;
  if sid is null then
    select system_id into sid from public.colonies where faction_id=p_fid order by created_at asc limit 1;
  end if;
  if sid is null then raise exception 'no system: specify p_system_id or give the faction a colony first'; end if;
  if not exists(select 1 from public.map_systems where id=sid) then raise exception 'no such system: %', sid; end if;
  -- владелец фракции: из экономики, иначе из одобренной анкеты, иначе из колонии
  select owner_id into v_owner from public.faction_economy where faction_id=p_fid;
  if v_owner is null then
    select owner_id into v_owner from public.faction_applications
      where faction_id=p_fid and status='approved' order by updated_at desc limit 1;
  end if;
  if v_owner is null then
    select owner_id into v_owner from public.colonies where faction_id=p_fid order by created_at asc limit 1;
  end if;

  insert into public.mza_ships(faction_id, owner_id, name, status, system_id)
    values(p_fid, v_owner, 'Гиперпейсер (выдан)', 'idle', sid)
    returning id into v_id;
  update public.faction_economy
    set research = case when coalesce(research,'[]'::jsonb) ? 'pol.inevitability'
                        then research else coalesce(research,'[]'::jsonb) || '"pol.inevitability"'::jsonb end
    where faction_id = p_fid;
  select name into sysname from public.map_systems where id=sid;
  return jsonb_build_object('ok', true, 'id', v_id, 'system_id', sid, 'system_name', sysname);
end$$;
revoke all on function public.admin_grant_mza(text,text) from public;
grant execute on function public.admin_grant_mza(text,text) to authenticated;

-- ── 11) АДМИН: скип полёта (носителей и залпов МЗА) для тестов ──
-- Прибытие носителей + приземление залпов (общий резолвер _doom_resolve).
create or replace function public.admin_test_speed_mza(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  update public.mza_ships set arrive_at = now()
    where faction_id = p_fid and status in ('building','transit');
  perform public._mza_settle(p_fid);
  update public.doom_salvos set ready_at = now()
    where faction_id = p_fid and mza_id is not null and status='in_flight';
  get diagnostics n = row_count;
  perform public._doom_resolve(p_fid);
  return jsonb_build_object('ok', true, 'landed', n);
end$$;
revoke all on function public.admin_test_speed_mza(text) from public;
grant execute on function public.admin_test_speed_mza(text) to authenticated;

-- ── ГОТОВО ──────────────────────────────────────────────────
