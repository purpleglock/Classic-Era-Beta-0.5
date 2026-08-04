-- ══════════════════════════════════════════════════════════════
-- ГЕЙТ ВЛАДЕЛЬЦА СИСТЕМЫ ДЛЯ КОЛОНИЗАЦИИ  (04.08)
--
-- Дыра: economy_colonize / economy_build_station / economy_terraform
-- проверяли только «планета не занята» и НИЧЕГО не знали о владельце системы.
-- Любая держава могла расселиться в чужой системе. Так «Империя Дорей»
-- 10-11.07 заселила 5 планет в ничейном тогда «Пантеон-Миноре» (sys_mrc2486z),
-- а 03.08 систему заклеймила «Шестнадцатая Волна» — и получила чужой анклав
-- внутри своей системы (economy_claim_system берёт систему с faction is null
-- и на колонии внутри не смотрит).
--
-- Правило: селиться можно в СВОЕЙ или НИЧЕЙНОЙ системе. Ничейная остаётся
-- открытой намеренно — привычный порядок «заселил фронтир → потом заклеймил».
--
-- Тела трёх RPC переписаны ЦЕЛИКОМ с живой версии (сверено с базой 04.08,
-- совпадало с _security_money.sql) — добавлена ровно одна проверка _ec_sys_open.
-- Плюс разовая уборка анклава Дорея (пункт 2), согласована с владельцем.
-- ══════════════════════════════════════════════════════════════

-- ── 1) Хелпер: система свободна для расселения этой державой ─
create or replace function public._ec_sys_open(p_fid text, p_system_id text)
returns boolean language sql stable set search_path=public as $$
  select coalesce(
    (select s.faction is null or s.faction = p_fid
       from public.map_systems s where s.id = p_system_id),
    true);   -- системы нет в реестре карты → не блокируем (легаси-идентификаторы)
$$;
revoke all on function public._ec_sys_open(text,text) from public;
grant execute on function public._ec_sys_open(text,text) to authenticated;

-- ── RPC: КОЛОНИЗАЦИЯ родной планеты (мгновенно) ─────────────
create or replace function public.economy_colonize(p_system_id text, p_planet_pid int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_race text; pl jsonb; grp text; cost numeric; cells int; native boolean;
begin
  fid := public._ec_my_fid();
  if p_planet_pid is null then raise exception 'planet has no pid'; end if;
  if not public._ec_sys_open(fid, p_system_id) then raise exception 'system belongs to another faction'; end if;
  select race into v_race from public.faction_applications
    where faction_id = fid and status='approved' order by updated_at desc limit 1;

  pl := public._ec_planet(p_system_id, p_planet_pid);
  if pl is null then raise exception 'planet not found'; end if;
  if public._ec_planet_dead(pl) then raise exception 'planet is dead — cannot be colonized'; end if;
  grp := public._ec_group_of(pl);   -- ← kind-aware (пояс/аномалия), не затирать фикс _fix_station_belt
  if public._ec_nocol(grp) then raise exception 'planet needs a station, not colony'; end if;

  -- родная (или роботы — всё родное, КРОМЕ легаси-исключений); иначе нужен терраформ
  native := public._faction_native_all(fid)
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
  if not public._ec_sys_open(fid, p_system_id) then raise exception 'system belongs to another faction'; end if;
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

-- ── ТЕРРАФОРМ: тот же гейт (иначе дыру просто обходят проектом) ──
-- Тело не переписываем целиком (в нём живёт цена/тиры _ec_terra_tier) —
-- вставляем проверку в начало через пересоздание с живого определения.
do $mig$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='economy_terraform';
  if src is null then raise notice 'economy_terraform не найдена — пропуск'; return; end if;
  if position('_ec_sys_open' in src) > 0 then raise notice 'гейт в economy_terraform уже стоит'; return; end if;
  patched := replace(src,
    'if p_planet_pid is null then raise exception ''planet has no pid''; end if;',
    'if p_planet_pid is null then raise exception ''planet has no pid''; end if;'
    || chr(10) || '  if not public._ec_sys_open(fid, p_system_id) then raise exception ''system belongs to another faction''; end if;');
  if patched = src then raise exception 'economy_terraform: якорь для вставки гейта не найден — правьте вручную'; end if;
  execute patched;
end$mig$;

-- ── 2) Уборка анклава: колонии Дорея в чужом «Пантеон-Миноре» ──
-- Согласовано с владельцем 04.08. Зависимостей нет (проверено: 0 зданий,
-- 0 проектов, 0 орудий, 0 концессий, 0 монументов, 0 армий).
delete from public.colonies
 where system_id = 'sys_mrc2486z'
   and faction_id = 'fac_89dbdba48c';

-- ── 3) Контроль: анклавы в ЧУЖИХ системах (диагностика на будущее) ──
create or replace view public._v_colony_enclaves as
  select c.id, c.faction_id, c.system_id, s.faction as system_owner, c.planet_pid, c.planet_name
    from public.colonies c
    join public.map_systems s on s.id = c.system_id
   where s.faction is not null and s.faction <> c.faction_id;
