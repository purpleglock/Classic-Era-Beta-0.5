-- ════════════════════════════════════════════════════════════════════════
--  РАЗОВЫЙ ФИКС: легаси-исключение «жить где угодно без терраформа»
--
--  Проблема: перк «все миры родные / терраформ не нужен» раздаётся по флагу
--  _faction_is_robot(fid) = раса «Синтетики / Киборги» ИЛИ правление
--  «Машинный разум (ИИ)». Игрок «Супердемократия Люмена» (fac_d9662abfe6)
--  взял ИИ-правление с БИОЛОГИЧЕСКОЙ расой (Гуманоиды) ещё до разделения перка,
--  поэтому терраформ ему запрещён строкой economy_terraform, хотя тело у него
--  живое. Общее правило НЕ трогаем — только точечное исключение по faction_id.
--
--  Что делает патч:
--    • новый хелпер _faction_native_all(fid) = _faction_is_robot(fid) И fid НЕ
--      в списке легаси-исключений. Именно он решает «все миры родные / без
--      терраформа». Прочие робо-бонусы (наука ×2, захваты ×2, пехота ×3)
--      по-прежнему на _faction_is_robot — их НЕ меняем.
--    • economy_colonize: native теперь через _faction_native_all.
--    • economy_terraform: запрет «robots colonize directly» теперь через
--      _faction_native_all → исключённая фракция может терраформировать.
--
--  Итог для fac_d9662abfe6 (Гуманоиды): terrestrial — колонизирует напрямую,
--  остальное — через терраформ, как у обычной био-расы. Уже заселённые миры
--  остаются как есть.
--
--  Запускать ОТДЕЛЬНО в SQL-редакторе. Самодостаточно (зависимости
--  _faction_is_robot, _ec_planet, _ec_group_of, _ec_nocol, _race_native_envs,
--  _ec_colonize_cost, _ec_terra_tier, _ec_my_fid уже в базе).
--  Клиент-зеркало: economy.js EC_HAB_NOSHORTCUT / ecNativeAll (?v=20260709robothab1).
-- ════════════════════════════════════════════════════════════════════════

-- 1. «Все миры родные / терраформ не нужен» — роботы, КРОМЕ легаси-исключений.
--    Чтобы добавить ещё одну фракцию — допиши faction_id в NOT IN (...).
create or replace function public._faction_native_all(p_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select public._faction_is_robot(p_fid)
     and p_fid not in ('fac_d9662abfe6');   -- «Супердемократия Люмена» (Гуманоиды + ИИ)
$$;
revoke all on function public._faction_native_all(text) from public;
grant execute on function public._faction_native_all(text) to authenticated;

-- 2. КОЛОНИЗАЦИЯ: «родная» через _faction_native_all (было _faction_is_robot).
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

-- 3. ТЕРРАФОРМ: запрет «robots colonize directly» через _faction_native_all
--    (было _faction_is_robot) → легаси-исключение может терраформировать.
create or replace function public.economy_terraform(p_system_id text, p_planet_pid int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_race text; pl jsonb; grp text; tier int;
  gc_base numeric; sci numeric; turns int; cost_gc numeric; cells int;
begin
  fid := public._ec_my_fid();
  if p_planet_pid is null then raise exception 'planet has no pid'; end if;
  if public._faction_native_all(fid) then raise exception 'robots colonize directly, no terraform'; end if;
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
