-- ════════════════════════════════════════════════════════════════════════
--  МИГРАЦИЯ: стабильный pid планеты (связь карта ↔ кабинет НЕ по имени)
--
--  Проблема: колонии связывались с планетой по planet_name. Имена планет
--  НЕ уникальны в системе → колонизация цепляла «первую одноимённую», список
--  свободных планет прятал обе, а unique(system_id, planet_name) не давал
--  заселить вторую одноимённую планету. Игроки: «колонил одну — заколонилась
--  другая, а та, что хотел, исчезла».
--
--  Решение: каждой планете в map_systems.planets[] выдаётся стабильный "pid"
--  (целое, уникальное в пределах системы, переживает правки/перестановки в
--  редакторе карты). Колонии/проекты ссылаются на planet_pid. Уникальность
--  колонии — по (system_id, planet_pid), а не по имени.
--
--  Запускать ОТДЕЛЬНО в SQL-редакторе Supabase. Идемпотентно (можно повторно).
--  Самодостаточно: переопределяет зависимые функции (_apply_colony_projects,
--  _ensure_capital), поэтому порядок относительно _economy_setup.sql не важен.
--  Полные (канонические) версии всех функций — в _economy_setup.sql и
--  _faction_setup.sql; их повторный прогон безопасен и желателен.
--
--  Примечание по SQL: к элементу jsonb_array_elements обращаемся через ЯВНЫЙ
--  алиас колонки — `... as t(val)` и затем `val->>'...'`. Голый алиас
--  (`jsonb_array_elements(...) x` + `x->>'...'`) в подзапросе Postgres трактует
--  неоднозначно (ошибка «operator does not exist: numeric ->> unknown»).
-- ════════════════════════════════════════════════════════════════════════

-- 1. КОЛОНКИ ─────────────────────────────────────────────────────────────
alter table public.colonies        add column if not exists planet_pid int;
alter table public.colony_projects add column if not exists planet_pid int;

-- 2. БЭКФИЛЛ pid В ДАННЫХ КАРТЫ ───────────────────────────────────────────
-- Каждой планете без pid выдаём (max_pid_в_системе + порядковый_номер):
-- строго больше любого существующего pid и уникально → коллизий нет.
update public.map_systems ms
set planets = (
  select jsonb_agg(
           case when (el.val ? 'pid') then el.val
                else jsonb_set(el.val, '{pid}', to_jsonb(
                       (select coalesce(max((b.val->>'pid')::int), 0)
                          from jsonb_array_elements(coalesce(ms.planets, '[]'::jsonb)) as b(val))
                       + el.ord)) end
           order by el.ord
         )
  from jsonb_array_elements(coalesce(ms.planets, '[]'::jsonb)) with ordinality as el(val, ord)
)
where jsonb_typeof(ms.planets) = 'array'
  and jsonb_array_length(ms.planets) > 0
  and exists (select 1 from jsonb_array_elements(ms.planets) as z(val) where not (z.val ? 'pid'));

-- 3. БЭКФИЛЛ planet_pid У КОЛОНИЙ И ПРОЕКТОВ (по имени → pid планеты карты) ─
-- На старых данных у колонии в системе уникальное имя (прежний констрейнт),
-- поэтому имя однозначно отображается в pid. При неоднозначности берём min(pid).
update public.colonies c
set planet_pid = sub.pid
from (
  select c2.id,
    (select (e.val->>'pid')::int
       from public.map_systems ms
       cross join lateral jsonb_array_elements(coalesce(ms.planets, '[]'::jsonb)) as e(val)
       where ms.id = c2.system_id and e.val->>'name' = c2.planet_name
       order by (e.val->>'pid')::int asc nulls last limit 1) as pid
  from public.colonies c2
  where c2.planet_pid is null
) sub
where c.id = sub.id and sub.pid is not null;

update public.colony_projects p
set planet_pid = sub.pid
from (
  select p2.id,
    (select (e.val->>'pid')::int
       from public.map_systems ms
       cross join lateral jsonb_array_elements(coalesce(ms.planets, '[]'::jsonb)) as e(val)
       where ms.id = p2.system_id and e.val->>'name' = p2.planet_name
       order by (e.val->>'pid')::int asc nulls last limit 1) as pid
  from public.colony_projects p2
  where p2.kind = 'terraform' and p2.planet_pid is null
) sub
where p.id = sub.id and sub.pid is not null;

-- 4. УНИКАЛЬНОСТЬ: имя → pid ──────────────────────────────────────────────
-- Снимаем старый unique(system_id, planet_name) (любое имя констрейнта),
-- ставим частичный unique по (system_id, planet_pid). Старые колонии без pid
-- (planet_pid is null) индексом не ограничиваются.
do $$
declare cn text;
begin
  for cn in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.colonies'::regclass and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname)
             from unnest(c.conkey) k
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k)
          = array['planet_name','system_id']
  loop
    execute format('alter table public.colonies drop constraint %I', cn);
  end loop;
end$$;

create unique index if not exists colonies_system_pid_uidx
  on public.colonies (system_id, planet_pid) where planet_pid is not null;

-- 5. ЗАВИСИМЫЕ ФУНКЦИИ (pid-aware) ────────────────────────────────────────
-- Завершение проектов: терраформ создаёт колонию с planet_pid, дубль по pid.
create or replace function public._apply_colony_projects(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare pr record;
begin
  for pr in select * from public.colony_projects
            where faction_id = p_fid and ready_at <= now()
            order by ready_at asc
  loop
    if pr.kind = 'build' then
      insert into public.colony_buildings (colony_id, faction_id, owner_id, btype, slots_open, tnp_mode)
        values (pr.colony_id, p_fid, pr.owner_id, pr.btype,
                coalesce((pr.payload->>'free_slots')::int, 1), false);
    elsif pr.kind = 'slot' then
      update public.colony_buildings set slots_open = least(6, slots_open + 1)
        where id = pr.building_id and faction_id = p_fid;
    elsif pr.kind = 'habitat' then
      update public.colonies set cells = cells + coalesce(pr.cells, 3), terraformed = true
        where id = pr.colony_id and faction_id = p_fid;
    elsif pr.kind = 'terraform' then
      -- дубль определяем по pid (точно), для старых проектов без pid — по имени
      if not exists (select 1 from public.colonies c
                     where c.faction_id = p_fid
                       and c.system_id is not distinct from pr.system_id
                       and (case when pr.planet_pid is not null
                                 then c.planet_pid = pr.planet_pid
                                 else c.planet_name = pr.planet_name end)) then
        insert into public.colonies (faction_id, owner_id, system_id, planet_name, planet_pid, planet_type, cells, terraformed, resources)
          values (p_fid, pr.owner_id, pr.system_id, pr.planet_name, pr.planet_pid, pr.planet_type,
                  coalesce(nullif(pr.cells, 0), 6), true, coalesce(pr.payload->'resources', '[]'::jsonb));
      end if;
    end if;
    delete from public.colony_projects where id = pr.id;
  end loop;
end$$;
revoke all on function public._apply_colony_projects(text) from public;

-- Столица: планета получает стабильный pid, колония пишется с planet_pid,
-- дубль ловим по pid (без ON CONFLICT по снятому констрейнту).
create or replace function public._ensure_capital(p_fid text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  app public.faction_applications;
  env text; ptype text; cap_name text; cap_id uuid; sys_id text; pres jsonb; cap_cells int;
  cap_pid int; cap_planet_pid int;
begin
  select * into app from public.faction_applications
    where faction_id = p_fid and status = 'approved'
    order by updated_at desc limit 1;
  if not found then return null; end if;

  select id, system_id, planet_name, planet_pid into cap_id, sys_id, cap_name, cap_pid from public.colonies
    where faction_id = p_fid
    order by is_capital desc, (planet_type = 'Столичный мир') desc, created_at asc limit 1;
  if cap_id is null then
    sys_id := app.system_id;
    cap_name := coalesce(nullif(app.planet_name, ''), app.system_name, 'Столица');
  end if;
  if sys_id is null then return cap_id; end if;

  env   := coalesce(nullif(app.capital_env, ''), (public._race_native_envs(app.race))[1], 'terrestrial');
  ptype := public._env_label(env);
  cap_cells := case env
    when 'terrestrial' then 9 when 'oceanic' then 9
    when 'desert' then 8 when 'volcanic' then 8 when 'cryo' then 8 when 'exotic' then 8
    when 'lava' then 7 when 'micro' then 7
    else 9 end;

  -- pid столичной планеты на карте: по pid колонии, затем по имени
  if cap_pid is not null then
    select (e.val->>'pid')::int into cap_planet_pid
      from public.map_systems ms
      cross join lateral jsonb_array_elements(coalesce(ms.planets, '[]'::jsonb)) as e(val)
      where ms.id = sys_id and (e.val->>'pid')::int = cap_pid limit 1;
  end if;
  if cap_planet_pid is null then
    select (e.val->>'pid')::int into cap_planet_pid
      from public.map_systems ms
      cross join lateral jsonb_array_elements(coalesce(ms.planets, '[]'::jsonb)) as e(val)
      where ms.id = sys_id and e.val->>'name' = cap_name limit 1;
  end if;
  -- планеты нет на карте — генерируем с новым pid (max+1 в системе)
  if cap_planet_pid is null then
    select coalesce(max((e.val->>'pid')::int), 0) + 1 into cap_planet_pid
      from public.map_systems ms
      cross join lateral jsonb_array_elements(coalesce(ms.planets, '[]'::jsonb)) as e(val)
      where ms.id = sys_id;
    update public.map_systems
      set planets = coalesce(planets, '[]'::jsonb) || jsonb_build_object(
            'name', cap_name, 'type', ptype, 'slotsP', cap_cells, 'pid', cap_planet_pid,
            'resources', public._basic_capital_res(ptype))
      where id = sys_id;
  end if;

  select e.val->'resources' into pres
    from public.map_systems ms
    cross join lateral jsonb_array_elements(coalesce(ms.planets, '[]'::jsonb)) as e(val)
    where ms.id = sys_id and (e.val->>'pid')::int = cap_planet_pid limit 1;

  if cap_id is null then
    select id into cap_id from public.colonies
      where system_id is not distinct from sys_id and planet_pid = cap_planet_pid limit 1;
    if cap_id is null then
      insert into public.colonies (faction_id, owner_id, system_id, planet_name, planet_pid, planet_type, cells, is_capital, resources)
        values (p_fid, app.owner_id, sys_id, cap_name, cap_planet_pid, ptype, cap_cells, true, coalesce(pres, '[]'::jsonb))
        returning id into cap_id;
    end if;
  end if;
  if cap_id is not null and cap_pid is null then
    update public.colonies set planet_pid = cap_planet_pid where id = cap_id and planet_pid is null;
  end if;

  update public.colonies set is_capital = (id = cap_id) where faction_id = p_fid;
  update public.map_systems set faction = p_fid where id = sys_id;
  return cap_id;
end$$;
revoke all on function public._ensure_capital(text) from public;
