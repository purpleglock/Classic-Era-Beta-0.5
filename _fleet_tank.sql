-- ============================================================
-- ФЛОТ · СРЕЗ 4 — БАК НА БОРТУ (запас хода) вместо склада державы
-- Применять ПОСЛЕ _army_fleet.sql, _fleet_ops.sql, _fleet_route.sql.
-- Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК:
--   fleet_send списывал топливо со СКЛАДА ДЕРЖАВЫ в момент отправки. Флот на
--   другом конце галактики питался из общего мешка в столице — логистики не
--   существовало, глубина проникновения ничем не ограничивалась, и заставы
--   (depot-аванпосты) были бы бессмысленны.
--
-- ЧТО СТАЛО:
--   • fleets.fuel / fuel_cap — БАК, измеряется в ПЛЕЧАХ (прыжках по трассам).
--     Игрок видит одну шкалу «запас хода: 7 плеч», а не карту из четырёх руд.
--   • Перелёт тратит плечи ИЗ БАКА. Склад к полёту отношения не имеет.
--   • Заправка (fleet_refuel) — ТОЛЬКО в системе со своей ВЕРФЬЮ
--     (colony_buildings.btype='shipyard') или у своей ЗАСТАВЫ
--     (outposts.mode='depot', появится в _outpost_depot.sql).
--     Заправка берёт ровно те ресурсы, что раньше брал вылет
--     (_fleet_fuel_for) — суммарная цена похода не изменилась, изменилось
--     МЕСТО оплаты. Балансового шока нет.
--   • fuel_cap — от классов состава: бак флота = бак самого «короткоплечего»
--     корабля в нём. Край↔край карты ~29 плеч, а лучший бак 16 — то есть
--     через галактику без сети застав не пройти. Это и есть смысл застав.
--   • fleet_reach(id) — докуда хватит и докуда хватит С ВОЗВРАТОМ (два
--     кольца на карте вместо арифметики в уме).
--
-- Миграция: всем существующим флотам бак заливается ПОЛНЫЙ.
-- ============================================================

alter table public.fleets add column if not exists fuel     numeric;
alter table public.fleets add column if not exists fuel_cap numeric;

-- ── Бак по классу корабля (в ПЛЕЧАХ) ──
-- Тяжёлые корабли несут больше топлива, но и жгут больше (расход остаётся
-- прежним, через _fleet_fuel_for) — крупный флот дороже, но не короче.
create or replace function public._fleet_class_range(p_cls text)
returns int language sql immutable as $$
  select case lower(coalesce(p_cls,''))
    when 'corvette'    then 6
    when 'frigate'     then 8
    when 'destroyer'   then 10
    when 'cruiser'     then 12
    when 'battleship'  then 14
    when 'dreadnought' then 16
    else 8                       -- неизвестный класс ≈ фрегат
  end
$$;

-- ── Бак ФЛОТА = минимум по составу (флот идёт по самому короткоплечему) ──
create or replace function public._fleet_cap_for(p_comp jsonb)
returns int language plpgsql stable security definer set search_path=public as $$
declare elem jsonb; k text; cap int := null; c int;
begin
  for elem in select value from jsonb_array_elements(coalesce(p_comp,'[]'::jsonb)) loop
    if greatest(0, coalesce((elem->>'qty')::int,0)) <= 0 then continue; end if;
    k := nullif(elem->>'cls','');
    if k is null then
      select data->>'class' into k from public.faction_units
        where id = nullif(elem->>'unit_id','')::uuid;
    end if;
    c := public._fleet_class_range(k);
    if cap is null or c < cap then cap := c; end if;
  end loop;
  return coalesce(cap, 8);
end$$;
revoke all on function public._fleet_cap_for(jsonb) from public;

-- ── Можно ли заправиться в этой системе (своя верфь или своя застава) ──
create or replace function public._fleet_can_refuel(p_fid text, p_sys text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.colony_buildings cb
      join public.colonies c on c.id = cb.colony_id
     where cb.btype = 'shipyard' and c.faction_id = p_fid and c.system_id = p_sys)
  or exists(
    select 1 from public.outposts o
     where o.faction_id = p_fid and o.system_id = p_sys and o.mode = 'depot')
$$;
revoke all on function public._fleet_can_refuel(text,text) from public;

-- ── Миграция: заливаем полный бак всем, у кого его ещё нет ──
update public.fleets
   set fuel_cap = public._fleet_cap_for(composition)
 where fuel_cap is null;
update public.fleets
   set fuel = fuel_cap
 where fuel is null;

-- ── Пересчёт бака при изменении состава (не превышая нового потолка) ──
create or replace function public._fleet_tank_sync(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare cap int;
begin
  select public._fleet_cap_for(composition) into cap from public.fleets where id = p_id;
  update public.fleets
     set fuel_cap = cap,
         fuel = least(coalesce(fuel, cap), cap)
   where id = p_id;
end$$;
revoke all on function public._fleet_tank_sync(uuid) from public;

-- ── Бак держится за состав сам, без правки fleet_form/fleet_edit ──
-- INSERT: новый флот выходит с ПОЛНЫМ баком (корабли только со стапеля).
-- UPDATE: потолок пересчитывается по составу, остаток подрезается до него
--         (долить трюмом нельзя — только заправкой).
create or replace function public._fleet_tank_trg()
returns trigger language plpgsql security definer set search_path=public as $$
declare cap int;
begin
  cap := public._fleet_cap_for(new.composition);
  new.fuel_cap := cap;
  if tg_op = 'INSERT' then
    new.fuel := coalesce(new.fuel, cap);
  else
    new.fuel := least(coalesce(new.fuel, cap), cap);
  end if;
  return new;
end$$;

drop trigger if exists trg_fleet_tank on public.fleets;
create trigger trg_fleet_tank before insert or update of composition, fuel
  on public.fleets for each row execute function public._fleet_tank_trg();

-- ════════════════════════════════════════════════════════════
-- fleet_send — НАДМНОЖЕСТВО _fleet_route.sql: маршрут как был,
-- но топливо тратится ИЗ БАКА, а не со склада державы.
-- ════════════════════════════════════════════════════════════
create or replace function public.fleet_send(p_id uuid, p_dest_sys text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; fl public.fleets; fly_h numeric; jumps int;
  pth jsonb; sched jsonb; dep timestamptz := now(); cap int; have numeric;
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  select * into fl from public.fleets where id=p_id for update;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;
  if fl.status <> 'idle' then raise exception 'флот уже в пути'; end if;
  if coalesce(fl.is_station, false) then raise exception 'станция не перемещается'; end if;
  if not exists(select 1 from public.map_systems where id=p_dest_sys) then raise exception 'no such system'; end if;
  if p_dest_sys = fl.system_id then raise exception 'флот уже там'; end if;

  cap   := public._fleet_cap_for(fl.composition);
  have  := coalesce(fl.fuel, cap);
  pth   := public._fleet_path(fl.system_id, p_dest_sys);
  jumps := public._fleet_jumps(fl.system_id, p_dest_sys);

  if have < jumps then
    raise exception 'не хватает запаса хода: нужно % плеч, в баке % (бак флота — % плеч). Заправка на своей верфи или у заставы',
      jumps, round(have,1), cap;
  end if;

  fly_h := coalesce(public._fleet_fly_hours(fl.system_id, p_dest_sys), 2.0);
  sched := case when pth is null then null else public._fleet_schedule(pth, dep) end;

  update public.fleets
    set status='transit', from_sys=system_id, dest_sys=p_dest_sys, system_id=null,
        depart_at=dep, arrive_at=dep + (fly_h || ' hours')::interval,
        route=pth, route_at=sched,
        fuel = have - jumps, fuel_cap = cap
    where id=p_id;

  return jsonb_build_object('ok', true, 'fly_h', round(fly_h,1), 'jumps', jumps,
    'route', pth, 'route_at', sched, 'fuel', have - jumps, 'fuel_cap', cap,
    'arrive_at', dep + (fly_h || ' hours')::interval);
end$$;
revoke all on function public.fleet_send(uuid,text) from public;
grant execute on function public.fleet_send(uuid,text) to authenticated;

-- ════════════════════════════════════════════════════════════
-- fleet_refuel — залить плечи в бак (только верфь / застава).
-- p_hops = null → залить бак доверху. Ресурсы берутся со склада ровно по
-- прежней формуле _fleet_fuel_for(состав, плечи).
-- ════════════════════════════════════════════════════════════
create or replace function public.fleet_refuel(p_id uuid, p_hops int default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; fl public.fleets; cap int; have numeric; want int;
  cost jsonb; res jsonb; rk text; rneed numeric; rhave numeric; short text := '';
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  select * into fl from public.fleets where id=p_id for update;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;
  if fl.status <> 'idle' then raise exception 'заправка возможна только на стоянке'; end if;
  if not public._fleet_can_refuel(fid, fl.system_id) then
    raise exception 'здесь негде заправиться: нужна своя верфь или своя застава (depot-аванпост)';
  end if;

  cap  := public._fleet_cap_for(fl.composition);
  have := least(coalesce(fl.fuel, 0), cap);
  want := least(coalesce(p_hops, cap - have::int), (cap - have)::int);
  if want <= 0 then
    return jsonb_build_object('ok', true, 'filled', 0, 'fuel', have, 'fuel_cap', cap,
                              'note', 'бак уже полон');
  end if;

  cost := public._fleet_fuel_for(fl.composition, want);

  select coalesce(resources,'{}'::jsonb) into res
    from public.faction_economy where faction_id=fid for update;
  if res is null then raise exception 'нет экономики фракции'; end if;

  for rk, rneed in select key, (value)::numeric from jsonb_each_text(cost) loop
    if rneed is null or rneed <= 0 then continue; end if;
    rhave := coalesce((res->>rk)::numeric, 0);
    if rhave < rneed then short := short || rk || ' ' || round(rneed - rhave) || ', '; end if;
  end loop;
  if short <> '' then
    raise exception 'не хватает топлива на складе: %', rtrim(short, ', ');
  end if;

  for rk, rneed in select key, (value)::numeric from jsonb_each_text(cost) loop
    if rneed is null or rneed <= 0 then continue; end if;
    res := jsonb_set(res, array[rk], to_jsonb(coalesce((res->>rk)::numeric,0) - rneed), true);
  end loop;
  update public.faction_economy set resources=res where faction_id=fid;

  update public.fleets set fuel = have + want, fuel_cap = cap where id = p_id;

  return jsonb_build_object('ok', true, 'filled', want, 'fuel', have + want,
                            'fuel_cap', cap, 'cost', cost);
end$$;
revoke all on function public.fleet_refuel(uuid,int) from public;
grant execute on function public.fleet_refuel(uuid,int) to authenticated;

-- ════════════════════════════════════════════════════════════
-- fleet_reach — ДВА КОЛЬЦА для карты: докуда хватит бака и докуда
-- хватит с возвратом на ближайшую точку заправки. Возвращает списки
-- id систем — клиенту остаётся их подсветить.
-- ════════════════════════════════════════════════════════════
create or replace function public.fleet_reach(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  fid text; fl public.fleets; cap int; have numeric;
  frontier text[]; visited text[]; nextf text[]; h int := 0;
  go jsonb := '[]'::jsonb; back jsonb := '[]'::jsonb;
begin
  fid := public._ec_my_fid();
  select * into fl from public.fleets where id=p_id;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;

  cap  := public._fleet_cap_for(fl.composition);
  have := least(coalesce(fl.fuel, cap), cap);
  if fl.system_id is null then
    return jsonb_build_object('ok', true, 'fuel', have, 'fuel_cap', cap,
                              'go', go, 'round', back, 'note', 'флот в пути');
  end if;

  -- волны по трассам: h-я волна = системы ровно в h плечах
  frontier := array[fl.system_id]; visited := array[fl.system_id];
  while array_length(frontier,1) > 0 and h < have loop
    h := h + 1;
    select array_agg(distinct nb) into nextf from (
      select case when hl.a_id = any(frontier) then hl.b_id else hl.a_id end nb
        from public.map_hyperlanes hl
       where hl.a_id = any(frontier) or hl.b_id = any(frontier)) s
     where nb is not null and not (nb = any(visited));
    exit when nextf is null or array_length(nextf,1) = 0;
    visited := visited || nextf;
    frontier := nextf;
    go := go || to_jsonb(nextf);
    -- «с возвратом»: половина бака туда, половина обратно
    if h * 2 <= have then back := back || to_jsonb(nextf); end if;
  end loop;

  return jsonb_build_object('ok', true, 'fuel', have, 'fuel_cap', cap,
                            'at', fl.system_id, 'go', go, 'round', back,
                            'can_refuel_here', public._fleet_can_refuel(fid, fl.system_id));
end$$;
revoke all on function public.fleet_reach(uuid) from public;
grant execute on function public.fleet_reach(uuid) to authenticated;
