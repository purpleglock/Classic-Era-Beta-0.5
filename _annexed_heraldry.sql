-- ============================================================
-- ГЕРАЛЬДИКА ПРИСОЕДИНЁННЫХ ДЕРЖАВ (для карты)
--
-- После объединения (_annex.sql) анкета младшей державы уходит в status='annexed',
-- а её системы в map_systems остаются с union_origin = её fid: территория держит
-- СВОЮ краску и СВОЙ герб. Но RLS fa_select отдаёт игроку только 'approved' —
-- значит GM.facMeta про присоединённых ничего не знал и флаг над их землями
-- пропадал. Открывать всю строку нельзя (owner_id — приватен), поэтому даём
-- узкую security definer RPC: только показные поля.
-- ============================================================

create or replace function public.map_annexed_meta()
returns table(faction_id text, name text, herald_url text, leader text, gov text, planet_name text)
language sql stable security definer set search_path=public as $$
  select faction_id, name, herald_url, leader, gov, planet_name
    from public.faction_applications
   where status = 'annexed' and faction_id is not null
$$;
revoke all on function public.map_annexed_meta() from public;
grant execute on function public.map_annexed_meta() to anon, authenticated;
