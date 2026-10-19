-- ════════════════════════════════════════════════════════════
-- НАЗЕМКА, ЭТАП 4 — СЕРВЕРНАЯ ЧАСТЬ КЛИЕНТА  (19.10.2026)
-- ------------------------------------------------------------
--   • ground_landing_targets() — куда моя армия может высадиться прямо сейчас:
--     колонии в системах, где стоит мой флот (или я держу систему), которые
--     держит держава, с которой идёт война, и орбита за мной.
--   • armies_mine() — армия знает свой бой и оккупацию (срок перехода,
--     когда можно грабить).
--   • battles_mine() — наземные бои снова в списке «Мои бои».
--   • occupations_all() — слой «Оккупация» на карте показывает и колонии в
--     оккупации (флаг над системой, пометка colony).
-- Удалений данных в файле нет. Повторный запуск безопасен.
-- ════════════════════════════════════════════════════════════

create or replace function public.ground_landing_targets() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me text;
begin
  me := public._ec_my_fid();
  if me is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'colony_id', c.id, 'planet_name', c.planet_name, 'system_id', c.system_id,
      'system_name', coalesce(nullif(ms.name,''), ms.id),
      'holder', h.holder, 'holder_name', public._war_nm(h.holder),
      'liberation', c.faction_id = me, 'is_capital', c.is_capital,
      'battle', exists (select 1 from public.battles b where b.kind = 'ground' and b.colony_id = c.id and b.status <> 'done'))
      order by ms.name, c.planet_name)
    from public.colonies c
    join public.map_systems ms on ms.id = c.system_id
    cross join lateral (select public._ground_holder(c.id) holder) h
   where c.system_id in (select f.system_id from public.fleets f where f.faction_id = me and f.status = 'idle'
                         union select o.system_id from public.system_occupation o where o.occupier_fid = me)
     and h.holder is distinct from me
     and public.at_war(me, h.holder)
     and public._ground_orbit_ok(me, c.system_id, h.holder)
  ), '[]'::jsonb);
end $$;
grant execute on function public.ground_landing_targets() to authenticated;

create or replace function public.armies_mine() returns jsonb
language plpgsql security definer set search_path = public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._army_settle(fid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'status', a.status, 'mission', a.mission, 'battle_id', a.battle_id,
      'colony_id', a.colony_id, 'from_colony', a.from_colony, 'dest_colony', a.dest_colony,
      'home_colony', a.home_colony, 'composition', a.composition,
      'depart_at', a.depart_at, 'arrive_at', a.arrive_at,
      'system_id', (select system_id from public.colonies c where c.id = a.colony_id),
      'from_system_id', (select system_id from public.colonies c where c.id = a.from_colony),
      'dest_system_id', (select system_id from public.colonies c where c.id = a.dest_colony),
      'planet_name', (select planet_name from public.colonies c where c.id = a.colony_id),
      'dest_planet_name', (select planet_name from public.colonies c where c.id = a.dest_colony),
      'foreign', (select c.faction_id <> fid from public.colonies c where c.id = a.colony_id),
      'units', (select coalesce(sum(greatest(0,(c->>'qty')::int)),0)
                from jsonb_array_elements(coalesce(a.composition,'[]'::jsonb)) c),
      'occupy', (select jsonb_build_object('transfer_at', o.transfer_at, 'plundered_at', o.plundered_at,
                         'owner_name', public._war_nm(o.owner_fid),
                         'plunder_at', coalesce(o.plundered_at + (public._ground_const('plunder_cd_h') || ' hours')::interval, now()))
                   from public.colony_occupation o where o.colony_id = a.colony_id and o.occupier_fid = fid),
      'can_recall', (a.status='idle' and a.home_colony is not null and a.colony_id is distinct from a.home_colony)
    ) order by a.created_at asc)
    from public.armies a where a.faction_id = fid
  ), '[]'::jsonb);
end $$;

do $$
declare d text;
begin
  -- «Мои бои»: наземка снова видна (скрыта была до готовности клиента)
  d := pg_get_functiondef('public.battles_mine()'::regprocedure);
  if position('b.kind <> ''ground''' in d) > 0 then
    execute replace(d, ' and b.kind <> ''ground''', '');
  end if;

  -- Слой «Оккупация»: плюс колонии в оккупации
  d := pg_get_functiondef('public.occupations_all()'::regprocedure);
  if position('colony_occupation' in d) = 0 then
    execute replace(d, 'from public.system_occupation o), ''[]''::jsonb);',
      'from public.system_occupation o), ''[]''::jsonb)
    || coalesce((
    select jsonb_agg(jsonb_build_object(
      ''system_id'', c.system_id,
      ''occupier'', co.occupier_fid,
      ''occupier_name'', public._war_nm(co.occupier_fid),
      ''occupier_color'', (select mf.color from public.map_factions mf where mf.id = co.occupier_fid),
      ''owner'', co.owner_fid,
      ''owner_name'', public._war_nm(co.owner_fid),
      ''since'', co.since, ''colony'', true, ''planet_name'', c.planet_name,
      ''transfer_at'', co.transfer_at) order by co.since desc)
    from public.colony_occupation co join public.colonies c on c.id = co.colony_id
   where not exists (select 1 from public.system_occupation so where so.system_id = c.system_id)), ''[]''::jsonb);');
  end if;
end $$;

-- ── war_status: колонии в оккупации (свои занятые и занятые нами) ──
do $$
declare d text;
begin
  d := pg_get_functiondef('public.war_status()'::regprocedure);
  if position('colony_occ' in d) = 0 then
    execute replace(d, '''history'', (',
      '''colony_occ'', (
      select coalesce(jsonb_agg(jsonb_build_object(
        ''colony_id'', o.colony_id, ''planet_name'', c.planet_name, ''is_capital'', c.is_capital,
        ''system_name'', (select coalesce(nullif(ms.name,''''), ms.id) from public.map_systems ms where ms.id = c.system_id),
        ''mine'', o.owner_fid = me,
        ''occupier'', o.occupier_fid, ''occupier_name'', public._war_nm(o.occupier_fid),
        ''owner'', o.owner_fid, ''owner_name'', public._war_nm(o.owner_fid),
        ''since'', o.since, ''transfer_at'', o.transfer_at,
        ''battle'', exists (select 1 from public.battles b where b.kind = ''ground'' and b.colony_id = o.colony_id and b.status <> ''done''))
        order by o.transfer_at), ''[]''::jsonb)
      from public.colony_occupation o join public.colonies c on c.id = o.colony_id
     where o.owner_fid = me or o.occupier_fid = me),
    ''history'', (');
  end if;
end $$;
-- Весь файл уже применён в базе.
