-- ============================================================
-- ЭТАП 2 — СЕРВЕРНАЯ ЭКОНОМИКА (деньги считает сервер, не клиент)
-- Применять в Supabase → SQL Editor. Идемпотентно (CREATE OR REPLACE).
--
-- Эти функции — ДОПОЛНЕНИЕ: пока клиент их не вызывает и прямая запись не
-- заперта, ничего не ломается. Замок (запрет прямой записи) — отдельным
-- финальным шагом, КОГДА клиент уже переведён на эти RPC.
--
-- СРЕЗ 1: строительная экономика (постройки, слоты, обустройство, снос, отмена).
--   Цены — зеркало EC_BUILD / ecBuildCost / ecColonizeCost из economy.js.
--   ⚠ Если меняешь цены в economy.js — синхронь _ec_bld_base/_ec_bld_ladder.
-- ============================================================

-- ── Зеркало цен зданий (EC_BUILD, economy.js:93) ────────────
-- Базовая стоимость постройки здания.
create or replace function public._ec_bld_base(p_btype text)
returns numeric language sql immutable as $$
  select case p_btype
    when 'factory'          then 500    when 'mining'   then 500
    when 'trade'            then 1000   when 'market'   then 1500
    when 'science'          then 1000   when 'training' then 500
    when 'intel'            then 3000   when 'military_factory' then 1000
    when 'shipyard'         then 2000   when 'warehouse' then 800
    when 'temple'           then 1200   -- ВЕРА: храм (_faith_setup.sql)
    when 'starbase'         then 5000   -- Звёздная База (_defense_starbase.sql)
    when 'flak'             then 1500   -- ПВО
    when 'abm'              then 3000   -- ПРО
    else null end
$$;
-- Сколько слотов даётся бесплатно при постройке (EC_BUILD[t].free).
create or replace function public._ec_bld_free(p_btype text)
returns int language sql immutable as $$
  select case when p_btype in ('factory','mining') then 2 else 1 end
$$;
-- Цена открытия слота: p_idx = текущее slots_open (0..5) → цена СЛЕДУЮЩЕГО слота.
-- factory/mining: [0,0,500,1500,1500,3000]; остальные: [0,500,500,1500,1500,3000].
create or replace function public._ec_bld_ladder(p_btype text, p_idx int)
returns numeric language sql immutable as $$
  select case
    when p_idx < 0 or p_idx > 5 then null
    else (case when p_btype in ('factory','mining')
               then (array[0,0,500,1500,1500,3000])[p_idx+1]
               else (array[0,500,500,1500,1500,3000])[p_idx+1]
          end)
  end
$$;

-- ── Итоговые цены с учётом доктрины ─────────────────────────
-- ecBuildCost(base)    = max(1, round(base * mods.build))
create or replace function public._ec_build_cost(p_fid text, p_base numeric)
returns numeric language sql stable security definer set search_path=public as $$
  select greatest(1, round(coalesce(p_base,0) * (public._faction_mods(p_fid)->>'build')::numeric))
$$;
-- ecColonizeCost(base) = max(1, round(base * mods.colonize))
create or replace function public._ec_colonize_cost(p_fid text, p_base numeric)
returns numeric language sql stable security definer set search_path=public as $$
  select greatest(1, round(coalesce(p_base,0) * (public._faction_mods(p_fid)->>'colonize')::numeric))
$$;

-- ── helper: фракция текущего игрока (одобренная анкета) ──────
-- Возвращает faction_id или кидает исключение. Бан учитывается.
create or replace function public._ec_my_fid()
returns text language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select faction_id into fid from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1;
  if fid is null then raise exception 'no approved faction'; end if;
  return fid;
end$$;

-- ════════════════════════════════════════════════════════════
-- RPC: ПОСТРОЙКА ЗДАНИЯ (отложенный проект, 1 ход)
-- ════════════════════════════════════════════════════════════
create or replace function public.economy_build(p_colony_id uuid, p_btype text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies; base numeric; cost numeric;
  used int; pending int;
begin
  fid := public._ec_my_fid();
  if public._ec_bld_base(p_btype) is null then raise exception 'bad btype'; end if;
  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if col.faction_id is distinct from fid then raise exception 'not your colony'; end if;

  -- свободные ячейки: здания + ожидающие постройки < cells
  select count(*) into used    from public.colony_buildings where colony_id = p_colony_id;
  select count(*) into pending from public.colony_projects
    where colony_id = p_colony_id and kind = 'build';
  if used + pending >= coalesce(col.cells, 6) then raise exception 'no free cells'; end if;

  base := public._ec_bld_base(p_btype);
  cost := public._ec_build_cost(fid, base);

  update public.faction_economy set gc = gc - cost
    where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects
    (faction_id, owner_id, kind, btype, colony_id, payload, label, ready_at)
  values
    (fid, auth.uid(), 'build', p_btype, p_colony_id,
     jsonb_build_object('spent_gc', cost, 'spent_science', 0, 'btype', p_btype,
                        'free_slots', public._ec_bld_free(p_btype)),
     'Постройка', now() + interval '1 day');

  return jsonb_build_object('ok', true, 'cost', cost);
end$$;
revoke all on function public.economy_build(uuid,text) from public;
grant execute on function public.economy_build(uuid,text) to authenticated;

-- ════════════════════════════════════════════════════════════
-- RPC: ОТКРЫТИЕ СЛОТА ЗДАНИЯ (отложенный проект, 1 ход)
-- ════════════════════════════════════════════════════════════
create or replace function public.economy_open_slot(p_building_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; b public.colony_buildings; cost numeric; pend int;
begin
  fid := public._ec_my_fid();
  select * into b from public.colony_buildings where id = p_building_id;
  if not found then raise exception 'building not found'; end if;
  if b.faction_id is distinct from fid then raise exception 'not your building'; end if;
  if coalesce(b.slots_open,0) >= 6 then raise exception 'all slots open'; end if;

  select count(*) into pend from public.colony_projects
    where kind = 'slot' and building_id = p_building_id;
  if pend > 0 then raise exception 'slot already in progress'; end if;

  cost := public._ec_build_cost(fid, public._ec_bld_ladder(b.btype, coalesce(b.slots_open,0)));

  update public.faction_economy set gc = gc - cost
    where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects
    (faction_id, owner_id, kind, colony_id, building_id, payload, label, ready_at)
  values
    (fid, auth.uid(), 'slot', b.colony_id, p_building_id,
     jsonb_build_object('spent_gc', cost, 'spent_science', 0),
     'Слот', now() + interval '1 day');

  return jsonb_build_object('ok', true, 'cost', cost);
end$$;
revoke all on function public.economy_open_slot(uuid) from public;
grant execute on function public.economy_open_slot(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════
-- RPC: ОБУСТРОЙСТВО СРЕДЫ (+3 ячейки, 1 ход) — EC_HABITAT_COST=1000
-- ════════════════════════════════════════════════════════════
create or replace function public.economy_habitat(p_colony_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies; cost numeric; pend int;
begin
  fid := public._ec_my_fid();
  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if col.faction_id is distinct from fid then raise exception 'not your colony'; end if;

  select count(*) into pend from public.colony_projects
    where kind = 'habitat' and colony_id = p_colony_id;
  if pend > 0 then raise exception 'habitat already in progress'; end if;

  cost := public._ec_colonize_cost(fid, 1000);

  update public.faction_economy set gc = gc - cost
    where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects
    (faction_id, owner_id, kind, colony_id, cells, payload, label, ready_at)
  values
    (fid, auth.uid(), 'habitat', p_colony_id, 3,
     jsonb_build_object('spent_gc', cost, 'spent_science', 0),
     'Обустройство среды', now() + interval '1 day');

  return jsonb_build_object('ok', true, 'cost', cost);
end$$;
revoke all on function public.economy_habitat(uuid) from public;
grant execute on function public.economy_habitat(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════
-- RPC: ОТМЕНА ПРОЕКТА (возврат того, что СЕРВЕР списал при создании)
--   Возврат берётся из payload.spent_gc/spent_science — после замка эти поля
--   проставляет только сервер, подделать нельзя.
-- ════════════════════════════════════════════════════════════
create or replace function public.economy_cancel_project(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; pr public.colony_projects; rg numeric; rs numeric;
begin
  fid := public._ec_my_fid();
  select * into pr from public.colony_projects where id = p_project_id;
  if not found then raise exception 'project not found'; end if;
  if pr.faction_id is distinct from fid then raise exception 'not your project'; end if;

  rg := coalesce((pr.payload->>'spent_gc')::numeric, 0);
  rs := coalesce((pr.payload->>'spent_science')::numeric, 0);

  delete from public.colony_projects where id = p_project_id;
  if rg <> 0 or rs <> 0 then
    update public.faction_economy set gc = gc + rg, science = science + rs
      where faction_id = fid;
  end if;

  return jsonb_build_object('ok', true, 'refund_gc', rg, 'refund_science', rs);
end$$;
revoke all on function public.economy_cancel_project(uuid) from public;
grant execute on function public.economy_cancel_project(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════
-- RPC: СНОС ЗДАНИЯ (возврат полной вложенной стоимости: база + платные слоты)
--   Зеркало ecBuildingInvested: база + сумма лестницы по платным открытым слотам.
--   Плюс возврат за незавершённый слот-проект этого здания (его и удаляем).
-- ════════════════════════════════════════════════════════════
create or replace function public.economy_demolish(p_building_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; b public.colony_buildings; refund numeric := 0; i int; free_n int;
  pr public.colony_projects;
begin
  fid := public._ec_my_fid();
  select * into b from public.colony_buildings where id = p_building_id;
  if not found then raise exception 'building not found'; end if;
  if b.faction_id is distinct from fid then raise exception 'not your building'; end if;

  -- база
  refund := public._ec_build_cost(fid, public._ec_bld_base(b.btype));
  -- платные открытые слоты (индексы free .. slots_open-1)
  free_n := public._ec_bld_free(b.btype);
  if coalesce(b.slots_open,0) > free_n then
    for i in free_n .. (b.slots_open - 1) loop
      refund := refund + public._ec_build_cost(fid, public._ec_bld_ladder(b.btype, i));
    end loop;
  end if;

  -- незавершённый слот этого здания — вернём его затраты и удалим проект
  for pr in select * from public.colony_projects
            where kind = 'slot' and building_id = p_building_id loop
    refund := refund + coalesce((pr.payload->>'spent_gc')::numeric, 0);
    delete from public.colony_projects where id = pr.id;
  end loop;

  delete from public.colony_buildings where id = p_building_id;
  if refund <> 0 then
    update public.faction_economy set gc = gc + refund where faction_id = fid;
  end if;

  return jsonb_build_object('ok', true, 'refund', refund);
end$$;
revoke all on function public.economy_demolish(uuid) from public;
grant execute on function public.economy_demolish(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════
-- СРЕЗ 2: КОЛОНИЗАЦИЯ · СТАНЦИИ · ТЕРРАФОРМ
--   Цены — зеркало EC_COLONIZE_COST=400, EC_STATION_COST=300, EC_TERRA.
--   Группа планеты / родные среды / tier — зеркало ecPlanetGroup / EC_HAB /
--   EC_ENV / ecTerraTier из economy.js.
-- ════════════════════════════════════════════════════════════

-- Тип планеты (русское имя группы из генератора) → внутренняя группа.
-- Зеркало EC_GRP_NAME (economy.js:300).
create or replace function public._ec_planet_group(p_type text)
returns text language sql immutable as $$
  select case btrim(coalesce(p_type,''))
    when 'Лавовые миры'    then 'lava'      when 'Вулканические' then 'volcanic'
    when 'Землеподобные'   then 'terrestrial' when 'Океанические' then 'oceanic'
    when 'Пустынные'       then 'desert'    when 'Криомиры'      then 'cryo'
    when 'Газовые гиганты' then 'gasgiant'  when 'Ледяные гиганты' then 'icegiant'
    when 'Горячие гиганты' then 'hotgiant'  when 'Экзотические'  then 'exotic'
    when 'Малые тела'      then 'micro'     when 'Аномалии'      then 'anomaly'
    else 'unknown' end
$$;

-- Фолбэк: имя планеты → группа (легаси/сид-формат, зеркало EC_PLANET_NAME).
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
-- ВАЖНО: kind-aware (пояса/аномалии). Дубль из _fix_station_belt — чтобы повторный
-- накат этого security-слоя не затирал станции на поясах старой type-only логикой.
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

-- Планета стёрта «Дланью Неотвратимости» (межзвёздной артиллерией) — мёртвый
-- камень: ни колонии, ни станции, ни терраформа. Зеркало флагов из _doom_resolve.
create or replace function public._ec_planet_dead(p_pl jsonb)
returns boolean language sql immutable as $$
  select coalesce((p_pl->>'dead')::boolean, false)
      or coalesce((p_pl->>'doomed')::boolean, false)
$$;

-- «Климатическая» координата группы (EC_ENV, economy.js:137). null — неизвестно.
create or replace function public._ec_env(p_group text)
returns int language sql immutable as $$
  select case p_group
    when 'cryo' then 0 when 'oceanic' then 2 when 'terrestrial' then 2
    when 'micro' then 3 when 'desert' then 3 when 'exotic' then 4
    when 'volcanic' then 5 when 'lava' then 6 else null end
$$;

-- Непригодные для обычной колонии группы (EC_NOCOL) — только станция.
create or replace function public._ec_nocol(p_group text)
returns boolean language sql immutable as $$
  select p_group in ('gasgiant','icegiant','hotgiant','anomaly','belt')
$$;

-- Уровень сложности терраформа (1..3) для группы planet и расы. Зеркало ecTerraTier.
create or replace function public._ec_terra_tier(p_group text, p_race text)
returns int language plpgsql stable security definer set search_path=public as $$
declare pe int; nat int[]; d int; mn int;
begin
  pe := public._ec_env(p_group);
  if pe is null then return 3; end if;
  select array_agg(public._ec_env(e)) into nat
    from unnest(public._race_native_envs(p_race)) e
    where public._ec_env(e) is not null;
  if nat is null or array_length(nat,1) is null then return 2; end if;
  mn := null;
  foreach d in array nat loop
    if mn is null or abs(pe - d) < mn then mn := abs(pe - d); end if;
  end loop;
  return case when mn <= 1 then 1 when mn <= 3 then 2 else 3 end;
end$$;

-- Конфиг станции, открывающей группу g, ЕСЛИ изучена нужная техника (зеркало
-- ecStationFor + станции из EC_POLITICS: pol.cel_asteroid/giants/anomaly).
-- Возвращает {cells} или null (нет техники / группа не станционная).
create or replace function public._ec_station_for(p_fid text, p_group text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rsrch jsonb;
begin
  select research into rsrch from public.faction_economy where faction_id = p_fid;
  rsrch := coalesce(rsrch, '[]'::jsonb);
  if p_group = 'belt' and rsrch ? 'pol.cel_asteroid' then
    return jsonb_build_object('cells', 3);
  elsif p_group in ('gasgiant','icegiant','hotgiant') and rsrch ? 'pol.cel_giants' then
    return jsonb_build_object('cells', 4);
  elsif p_group = 'anomaly' and rsrch ? 'pol.cel_anomaly' then
    return jsonb_build_object('cells', 5);
  end if;
  return null;
end$$;

-- helper: планета по pid в системе (jsonb-элемент map_systems.planets)
create or replace function public._ec_planet(p_system_id text, p_pid int)
returns jsonb language sql stable security definer set search_path=public as $$
  select e.val
  from public.map_systems ms
  cross join lateral jsonb_array_elements(coalesce(ms.planets,'[]'::jsonb)) as e(val)
  where ms.id = p_system_id and (e.val->>'pid')::int = p_pid
  limit 1
$$;

-- ── RPC: КОЛОНИЗАЦИЯ родной планеты (мгновенно) ─────────────
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
  if public._ec_planet_dead(pl) then raise exception 'planet is dead — cannot be colonized'; end if;
  grp := public._ec_group_of(pl);   -- ← kind-aware (пояс/аномалия), не затирать фикс _fix_station_belt
  if public._ec_nocol(grp) then raise exception 'planet needs a station, not colony'; end if;

  -- родная (или роботы — всё родное); иначе колония невозможна без терраформа
  native := public._faction_is_robot(fid)
            or grp = any(public._race_native_envs(v_race));
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

-- ── RPC: СТАНЦИЯ Небожителей на непригодном мире (мгновенно) ─
create or replace function public.economy_build_station(p_system_id text, p_planet_pid int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; pl jsonb; grp text; st jsonb; cost numeric;
begin
  fid := public._ec_my_fid();
  if p_planet_pid is null then raise exception 'planet has no pid'; end if;
  pl := public._ec_planet(p_system_id, p_planet_pid);
  if pl is null then raise exception 'planet not found'; end if;
  if public._ec_planet_dead(pl) then raise exception 'planet is dead — cannot host a station'; end if;
  grp := public._ec_group_of(pl);   -- ← kind-aware (пояс/аномалия), не затирать фикс _fix_station_belt

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

-- ── RPC: ТЕРРАФОРМ непригодной планеты (отложенный проект) ───
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
  if public._ec_planet_dead(pl) then raise exception 'planet is dead — cannot be terraformed'; end if;
  grp := public._ec_group_of(pl);   -- ← kind-aware (пояс/аномалия), не затирать фикс _fix_station_belt
  if public._ec_nocol(grp) then raise exception 'planet needs a station, not terraform'; end if;
  if grp = any(public._race_native_envs(v_race)) then raise exception 'planet is native — colonize directly'; end if;

  -- проект терраформа этой планеты уже идёт?
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
  -- EC_TERRA: 1→{1д,1000ГС,0ОН} 2→{2д,1800ГС,60ОН} 3→{4д,4800ГС,30ОН}
  if tier = 1 then gc_base:=1000; sci:=0;   turns:=1;
  elsif tier = 2 then gc_base:=1800; sci:=60;  turns:=2;
  else               gc_base:=4800; sci:=30;  turns:=4; end if;

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

-- ════════════════════════════════════════════════════════════
-- СРЕЗ 3: ПРОИЗВОДСТВО ЮНИТОВ · СТОИМОСТЬ РАЗРАБОТКИ
--   Стоимость берётся из faction_units.summary.cost / .on (сервер читает дизайн).
--   ⚠ summary.cost/on авторит игрок в билдере — серверный пересчёт компонентов НЕ
--     делаем (это весь билдер). Здесь гарантируем лишь, что списание = summary*qty
--     и нельзя произвести/отменить «бесплатно» через консоль. Лимиты мощности за
--     ход (ecCaps) пока остаются клиентскими — их обход не даёт ресурсов, только
--     темп; вынести в RPC можно позже.
-- ════════════════════════════════════════════════════════════

-- ── RPC: ПРОИЗВОДСТВО (дивизия → army, корабль → shipyard) ───
create or replace function public.economy_produce(p_unit_id uuid, p_qty int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; u public.faction_units; qty int; cost numeric;
  cat text; ln text; w int; rdy timestamptz;
begin
  fid := public._ec_my_fid();
  qty := greatest(1, coalesce(p_qty, 1));
  select * into u from public.faction_units where id = p_unit_id;
  if not found then raise exception 'unit design not found'; end if;
  if u.faction_id is not null and u.faction_id is distinct from fid then raise exception 'not your design'; end if;

  if u.category = 'division' then cat:='division'; ln:='army';     w:=0;
  elsif u.category = 'ship'   then cat:='ship';     ln:='shipyard'; w:=1;
  else raise exception 'this category is not produced here'; end if;

  cost := coalesce((u.summary->>'cost')::numeric, 0) * qty;

  select coalesce(last_tick, now()) + interval '1 day' into rdy
    from public.faction_economy where faction_id = fid;
  if rdy is null then rdy := now() + interval '1 day'; end if;

  update public.faction_economy set gc = gc - cost where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.unit_production
    (faction_id, owner_id, unit_id, unit_name, category, line, weight, qty, status, ready_at)
  values
    (fid, auth.uid(), u.id, u.name, cat, ln, w, qty, 'queued', rdy);

  return jsonb_build_object('ok', true, 'cost', cost, 'qty', qty, 'ready_at', rdy);
end$$;
revoke all on function public.economy_produce(uuid,int) from public;
grant execute on function public.economy_produce(uuid,int) to authenticated;

-- ── RPC: ОТМЕНА ПРОИЗВОДСТВА (возврат cost*qty по дизайну) ───
create or replace function public.economy_cancel_production(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; q public.unit_production; refund numeric := 0;
begin
  fid := public._ec_my_fid();
  select * into q from public.unit_production where id = p_id;
  if not found then raise exception 'production not found'; end if;
  if q.faction_id is distinct from fid then raise exception 'not your production'; end if;
  if q.status <> 'queued' then raise exception 'already delivered'; end if;

  select coalesce((u.summary->>'cost')::numeric, 0) * coalesce(q.qty,0) into refund
    from public.faction_units u where u.id = q.unit_id;
  refund := coalesce(refund, 0);

  delete from public.unit_production where id = p_id;
  if refund <> 0 then
    update public.faction_economy set gc = gc + refund where faction_id = fid;
  end if;

  return jsonb_build_object('ok', true, 'refund', refund);
end$$;
revoke all on function public.economy_cancel_production(uuid) from public;
grant execute on function public.economy_cancel_production(uuid) to authenticated;

-- ── RPC: списание ОН за разработку юнита (constructors.js:980) ─
-- Только УМЕНЬШАЕТ науку (не может увеличить → не чит на ресурсы). p_on = summary.on.
-- faction_units вставляется клиентом как и раньше (его таблица не запирается этим
-- этапом); RPC лишь переносит списание ОН с прямого PATCH на сервер.
create or replace function public.economy_dev_charge(p_on numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  if p_on is null or p_on < 0 then raise exception 'bad cost'; end if;
  if p_on = 0 then return jsonb_build_object('ok', true, 'charged', 0); end if;
  update public.faction_economy set science = science - p_on
    where faction_id = fid and science >= p_on;
  if not found then raise exception 'not enough science'; end if;
  return jsonb_build_object('ok', true, 'charged', p_on);
end$$;
revoke all on function public.economy_dev_charge(numeric) from public;
grant execute on function public.economy_dev_charge(numeric) to authenticated;

-- ════════════════════════════════════════════════════════════
-- СРЕЗ 4: прочие мутации игрока (без денег) — нужны, чтобы замок 2c
--   не сломал переключение ТНП и «бросить колонию».
-- ════════════════════════════════════════════════════════════

-- ── RPC: режим фабрики ТНП↔ГС ───────────────────────────────
create or replace function public.economy_set_tnp(p_building_id uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  update public.colony_buildings set tnp_mode = coalesce(p_on, false)
    where id = p_building_id and faction_id = fid;
  if not found then raise exception 'building not found'; end if;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.economy_set_tnp(uuid,boolean) from public;
grant execute on function public.economy_set_tnp(uuid,boolean) to authenticated;

-- ── RPC: бросить колонию (без возврата; столицу нельзя) ──────
create or replace function public.economy_abandon(p_colony_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies;
begin
  fid := public._ec_my_fid();
  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if col.faction_id is distinct from fid then raise exception 'not your colony'; end if;
  if coalesce(col.is_capital, false) then raise exception 'cannot abandon capital'; end if;
  delete from public.colony_projects where colony_id = p_colony_id and faction_id = fid;
  delete from public.colonies where id = p_colony_id;  -- постройки уйдут по FK on delete cascade
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.economy_abandon(uuid) from public;
grant execute on function public.economy_abandon(uuid) to authenticated;

-- ── Проверка после применения ───────────────────────────────
-- Должно вернуть число (например 500 или с учётом доктрины):
--   select public._ec_build_cost(public._ec_my_fid(), public._ec_bld_base('factory'));
-- (если выполнять из SQL Editor под postgres, _ec_my_fid упадёт 'no approved
--  faction' — это норм, функции вызываются из приложения под игроком.)
