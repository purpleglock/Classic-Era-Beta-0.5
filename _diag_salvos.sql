-- ДИАГНОСТИКА: какие залпы в полёте и жива ли их фракция.
-- alive = true → фракция существует; false → осиротевший залп (надо снести).
select
  s.id,
  s.faction_id,
  s.gun_id,
  s.mza_id,
  s.status,
  s.origin_system_id,
  s.target_system_id,
  s.launched_at,
  s.ready_at,
  (s.ready_at < now())                              as ready_passed,
  exists(select 1 from public.faction_applications a where a.faction_id = s.faction_id) as in_apps,
  exists(select 1 from public.map_factions m        where m.id        = s.faction_id) as in_map
from public.doom_salvos s
where s.status = 'in_flight'
order by s.launched_at;
