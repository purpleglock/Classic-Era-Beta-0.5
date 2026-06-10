-- ════════════════════════════════════════════════════════════════════════
--  МИГРАЦИЯ: платное переименование колонии игроком (500 ГС)
--
--  Стафф по-прежнему переименовывает бесплатно через rename_colony.
--  Эта функция — для ИГРОКА-владельца: списывает 500 ГС с казны фракции и
--  меняет имя в едином источнике истины (colonies + map_systems.planets),
--  поэтому новое имя сразу видно в кабинете, в списке колоний и в подписи
--  столицы на карте (capPlanet берётся из colonies.planet_name).
--
--  Применять в Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.colony_rename_paid(p_colony_id uuid, p_new_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  col public.colonies; nm text; bal numeric; cost numeric := 500;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  nm := nullif(btrim(p_new_name), '');
  if nm is null then raise exception 'empty name'; end if;
  if public._name_violates(nm) then raise exception 'name violates content policy'; end if;

  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  -- только владелец (стафф пользуется бесплатной rename_colony)
  if col.owner_id <> auth.uid() then raise exception 'forbidden'; end if;

  -- списать 500 ГС с экономики фракции (с блокировкой строки)
  select gc into bal from public.faction_economy where faction_id = col.faction_id for update;
  if bal is null then raise exception 'no economy'; end if;
  if bal < cost then raise exception 'not enough gc'; end if;
  update public.faction_economy set gc = gc - cost where faction_id = col.faction_id;

  -- переименовать планету на карте (по старому имени в системе колонии)
  update public.map_systems ms
    set planets = (
      select jsonb_agg(case when e->>'name' = col.planet_name then jsonb_set(e, '{name}', to_jsonb(nm)) else e end)
      from jsonb_array_elements(ms.planets) e)
    where ms.id = col.system_id
      and exists (select 1 from jsonb_array_elements(ms.planets) e2 where e2->>'name' = col.planet_name);
  -- переименовать саму колонию
  update public.colonies set planet_name = nm where id = p_colony_id;

  return jsonb_build_object('ok', true, 'gc', bal - cost);
end$$;

revoke all on function public.colony_rename_paid(uuid, text) from public;
grant execute on function public.colony_rename_paid(uuid, text) to authenticated;
