-- ============================================================
-- ФИКС: станции на поясах/аномалиях — серверная группировка kind-aware
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Баг: _ec_planet_group(type) определял группу ТОЛЬКО по строке типа. Пояса
-- (kind='belt') и аномалии (kind='anomaly') в справочник типов не входят →
-- группа 'unknown' → _ec_station_for null → «no station tech for this world».
-- Клиент же берёт kind (ecPlanetGroup: if kind==='belt'). Чиним сервер так же.
-- ============================================================

-- Фолбэк: имя планеты → группа (легаси/сид-формат, зеркало EC_PLANET_NAME).
-- Нужен для гигантов/аномалий старого формата, где в type/name лежит конкретное
-- имя ('Горячий Юпитер', 'Ледяной гигант', 'Пустошь'…), а не категория.
create or replace function public._ec_name_group(p_name text)
returns text language sql immutable as $$
  select case btrim(coalesce(p_name,''))
    when 'Катархей' then 'lava'  when 'Мёртвая планета' then 'lava'
    when 'Супервулканическая планета' then 'volcanic'  when 'Хтонический мир' then 'lava'
    when 'Горячий Юпитер' then 'hotgiant'  when 'Горячий Нептун' then 'hotgiant'
    when 'Железный мир' then 'lava'  when 'Дастория' then 'volcanic'
    when 'Литара' then 'desert'  when 'Океаническая суперземля' then 'exotic'
    when 'Рыхлый гигант' then 'gasgiant'  when 'Железный карлик' then 'terrestrial'
    when 'Духлесс' then 'volcanic'  when 'Терра' then 'terrestrial'
    when 'Суперземля' then 'terrestrial'  when 'Гикеан' then 'oceanic'
    when 'Панталассическая планета' then 'oceanic'  when 'Теракрон' then 'terrestrial'
    when 'Мини-Нептун' then 'gasgiant'  when 'Водный Юпитер' then 'gasgiant'
    when 'Тундровая планета' then 'terrestrial'  when 'Псамора' then 'oceanic'
    when 'Мир дюн' then 'desert'  when 'Гельвард' then 'cryo'
    when 'Турмион' then 'gasgiant'  when 'Ледяной гигант' then 'icegiant'
    when 'Аммиачный мир' then 'cryo'  when 'Газовый карлик' then 'gasgiant'
    when 'Метановый мир' then 'cryo'  when 'Суперюпитер' then 'gasgiant'
    when 'Коричневый карлик' then 'gasgiant'  when 'Планета-сирота' then 'exotic'
    when 'Углеродная планета' then 'cryo'  when 'Тёмный замёрзший мир' then 'cryo'
    when 'Карликовая планета' then 'micro'  when 'Мегаастероид' then 'micro'
    when 'Пустошь' then 'anomaly'  when 'Кротовая нора' then 'anomaly'
    when 'Токсичный карлик' then 'anomaly'
    else 'unknown' end
$$;
revoke all on function public._ec_name_group(text) from public;
grant execute on function public._ec_name_group(text) to authenticated;

-- Группа планеты — точное зеркало ecPlanetGroup (economy.js):
-- kind → категория type → фолбэк по type-как-имени → фолбэк по name.
create or replace function public._ec_group_of(p_planet jsonb)
returns text language sql immutable as $$
  select case
    when p_planet->>'kind' = 'belt'    then 'belt'
    when p_planet->>'kind' = 'anomaly' then 'anomaly'
    when public._ec_planet_group(p_planet->>'type') <> 'unknown'
         then public._ec_planet_group(p_planet->>'type')
    when public._ec_name_group(p_planet->>'type') <> 'unknown'
         then public._ec_name_group(p_planet->>'type')
    else public._ec_name_group(p_planet->>'name')
  end
$$;
revoke all on function public._ec_group_of(jsonb) from public;
grant execute on function public._ec_group_of(jsonb) to authenticated;

-- ── economy_build_station: группа по _ec_group_of (kind-aware) ──
create or replace function public.economy_build_station(p_system_id text, p_planet_pid int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; pl jsonb; grp text; st jsonb; cost numeric;
begin
  fid := public._ec_my_fid();
  if p_planet_pid is null then raise exception 'planet has no pid'; end if;
  pl := public._ec_planet(p_system_id, p_planet_pid);
  if pl is null then raise exception 'planet not found'; end if;
  grp := public._ec_group_of(pl);                 -- ← FIX: учитываем kind (пояс/аномалия)
  st := public._ec_station_for(fid, grp);
  if st is null then raise exception 'no station tech for this world'; end if;
  if exists (select 1 from public.colonies
             where system_id is not distinct from p_system_id and planet_pid = p_planet_pid) then
    raise exception 'planet already has a colony/station';
  end if;
  cost := public._ec_colonize_cost(fid, 300);
  update public.faction_economy set gc = gc - cost where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;
  insert into public.colonies
    (faction_id, owner_id, system_id, planet_name, planet_pid, planet_type, cells, terraformed, resources)
  values
    (fid, auth.uid(), p_system_id, pl->>'name', p_planet_pid, coalesce(pl->>'type',''),
     (st->>'cells')::int, true, coalesce(pl->'resources','[]'::jsonb));
  return jsonb_build_object('ok', true, 'cost', cost, 'cells', (st->>'cells')::int);
end$$;
revoke all on function public.economy_build_station(text,int) from public;
grant execute on function public.economy_build_station(text,int) to authenticated;

-- ── economy_colonize: то же (чтобы пояс/аномалию нельзя было колонизировать) ──
create or replace function public.economy_colonize(p_system_id text, p_planet_pid int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_race text; pl jsonb; grp text; cost numeric; cells int; native boolean;
begin
  fid := public._ec_my_fid();
  if p_planet_pid is null then raise exception 'planet has no pid'; end if;
  select race into v_race from public.faction_applications
    where faction_id = fid and status='approved' order by updated_at desc limit 1;
  pl := public._ec_planet(p_system_id, p_planet_pid);
  if pl is null then raise exception 'planet not found'; end if;
  grp := public._ec_group_of(pl);
  if public._ec_nocol(grp) then raise exception 'planet needs a station, not colony'; end if;
  native := public._faction_is_robot(fid) or grp = any(public._race_native_envs(v_race));
  if not native then raise exception 'planet not native — use terraform'; end if;
  if exists (select 1 from public.colonies
             where system_id is not distinct from p_system_id and planet_pid = p_planet_pid) then
    raise exception 'planet already colonized';
  end if;
  cost  := public._ec_colonize_cost(fid, 400);
  cells := coalesce((pl->>'slotsP')::int, 6);
  update public.faction_economy set gc = gc - cost where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;
  insert into public.colonies
    (faction_id, owner_id, system_id, planet_name, planet_pid, planet_type, cells, terraformed, resources)
  values
    (fid, auth.uid(), p_system_id, pl->>'name', p_planet_pid, coalesce(pl->>'type',''),
     cells, false, coalesce(pl->'resources','[]'::jsonb));
  return jsonb_build_object('ok', true, 'cost', cost);
end$$;
revoke all on function public.economy_colonize(text,int) from public;
grant execute on function public.economy_colonize(text,int) to authenticated;

-- ── economy_terraform: то же ────────────────────────────────
create or replace function public.economy_terraform(p_system_id text, p_planet_pid int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_race text; pl jsonb; grp text; tier int;
  gc_base numeric; sci numeric; turns int; cost_gc numeric; cells int;
begin
  fid := public._ec_my_fid();
  if p_planet_pid is null then raise exception 'planet has no pid'; end if;
  if public._faction_is_robot(fid) then raise exception 'robots colonize directly, no terraform'; end if;
  select race into v_race from public.faction_applications
    where faction_id = fid and status='approved' order by updated_at desc limit 1;
  pl := public._ec_planet(p_system_id, p_planet_pid);
  if pl is null then raise exception 'planet not found'; end if;
  grp := public._ec_group_of(pl);
  if public._ec_nocol(grp) then raise exception 'planet needs a station, not terraform'; end if;
  if grp = any(public._race_native_envs(v_race)) then raise exception 'planet is native — colonize directly'; end if;
  if exists (select 1 from public.colony_projects
             where faction_id = fid and kind='terraform'
               and system_id is not distinct from p_system_id and planet_pid = p_planet_pid) then
    raise exception 'terraform already in progress';
  end if;
  if exists (select 1 from public.colonies
             where system_id is not distinct from p_system_id and planet_pid = p_planet_pid) then
    raise exception 'planet already colonized';
  end if;
  tier := public._ec_terra_tier(grp, v_race);
  if tier = 1 then gc_base:=1000; sci:=0;   turns:=1;
  elsif tier = 2 then gc_base:=1800; sci:=60;  turns:=2;
  else               gc_base:=3200; sci:=200; turns:=4; end if;
  cost_gc := public._ec_colonize_cost(fid, gc_base);
  cells   := coalesce((pl->>'slotsP')::int, 6);
  update public.faction_economy set gc = gc - cost_gc, science = science - sci
    where faction_id = fid and gc >= cost_gc and science >= sci;
  if not found then raise exception 'not enough GC/science'; end if;
  insert into public.colony_projects
    (faction_id, owner_id, kind, system_id, planet_name, planet_pid, planet_type, cells, payload, label, ready_at)
  values
    (fid, auth.uid(), 'terraform', p_system_id, pl->>'name', p_planet_pid, coalesce(pl->>'type',''),
     cells,
     jsonb_build_object('resources', coalesce(pl->'resources','[]'::jsonb),
                        'spent_gc', cost_gc, 'spent_science', sci),
     'Терраформ', now() + (turns || ' days')::interval);
  return jsonb_build_object('ok', true, 'cost_gc', cost_gc, 'cost_science', sci, 'turns', turns, 'tier', tier);
end$$;
revoke all on function public.economy_terraform(text,int) from public;
grant execute on function public.economy_terraform(text,int) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- Станция на «Главном поясе астероидов» (есть теха pol.cel_asteroid) теперь
-- строится. Колонизация/терраформ пояса/аномалии корректно требуют станцию.
