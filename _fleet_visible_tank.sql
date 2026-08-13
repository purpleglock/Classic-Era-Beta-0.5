-- ============================================================
-- fleets_visible — НАДМНОЖЕСТВО _fleet_intel.sql
-- Применять ПОСЛЕ _fleet_intel.sql, _fleet_route.sql, _fleet_tank.sql,
-- _outpost_depot.sql. Идемпотентно.
--
-- ДОБАВЛЕНО (только для СВОИХ флотов — чужим бак и маршрут не отдаём):
--   fuel / fuel_cap  — бак в плечах (шкала запаса хода в карточке),
--   can_refuel       — можно ли заправиться там, где флот стоит,
--   route / route_at — маршрут рейса, чтобы карта рисовала ЛОМАНУЮ по узлам,
--                      а не прямую линию сквозь галактику.
--
-- ПОПУТНО ПОЧИНЕНО: клиент (galaxy_map.js) проверяет fl.can_recall и
-- fl.is_station, а прежняя версия их не отдавала — кнопка «↩ Вернуть на базу»
-- и карточка станции не показывались НИКОГДА. Теперь отдаются.
-- ============================================================

create or replace function public.fleets_visible()
returns jsonb language plpgsql security definer set search_path=public as $$
declare viewer text;
begin
  viewer := public._ec_my_fid();
  perform public._fleet_settle(fl.faction_id) from (select distinct faction_id from public.fleets) fl;
  return (
    with cov as (select sid from public._fleet_coverage(viewer))
    select coalesce(jsonb_agg(jsonb_build_object(
        'id',          f.id,
        'faction_id',  f.faction_id,
        'faction_name',public._fac_name(f.faction_id),
        'name',        case when f.faction_id = viewer then f.name else null end,
        'status',      f.status,
        'system_id',   f.system_id,
        'from_sys',    f.from_sys,
        'dest_sys',    f.dest_sys,
        'depart_at',   f.depart_at,
        'arrive_at',   f.arrive_at,
        'mine',        (f.faction_id = viewer),
        'stalled',     (f.stalled_until is not null and f.stalled_until > now()),
        'intel',       k.known,
        'ships',       case when k.known then (
                          select coalesce(sum(greatest(0,(c->>'qty')::int)),0)
                          from jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c)
                        else null end,
        'composition', case when k.known then f.composition else null end,
        -- ── своё: станция, база, бак, маршрут ──
        'is_station',  case when f.faction_id = viewer then coalesce(f.is_station,false) else null end,
        'home_sys',    case when f.faction_id = viewer then f.home_sys else null end,
        'can_recall',  case when f.faction_id = viewer then
                         (f.status='idle' and f.home_sys is not null
                          and f.system_id is distinct from f.home_sys
                          and not coalesce(f.is_station,false))
                       else null end,
        'fuel',        case when f.faction_id = viewer then f.fuel else null end,
        'fuel_cap',    case when f.faction_id = viewer then f.fuel_cap else null end,
        'can_refuel',  case when f.faction_id = viewer and f.system_id is not null
                         then public._fleet_can_refuel(f.faction_id, f.system_id) else null end,
        'route',       case when f.faction_id = viewer then f.route    else null end,
        'route_at',    case when f.faction_id = viewer then f.route_at else null end
      ) order by f.faction_id, f.id), '[]'::jsonb)
    from public.fleets f
    cross join lateral (select public._fleet_intel_known(viewer, f.faction_id) as known) k
    cross join lateral (select (
        f.faction_id = viewer
        or k.known
        or (f.status = 'idle'  and f.system_id::text in (select sid from cov))
        or (f.status <> 'idle' and (f.from_sys::text in (select sid from cov)
                                 or f.dest_sys::text in (select sid from cov)))
      ) as seen) d
    where d.seen
  );
end$$;
revoke all on function public.fleets_visible() from public;
grant execute on function public.fleets_visible() to authenticated;

notify pgrst, 'reload schema';
