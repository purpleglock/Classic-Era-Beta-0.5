-- ════════════════════════════════════════════════════════════
-- ЗАГРАЖДЕНИЯ И МЕГАСООРУЖЕНИЯ ВИДНЫ ВСЕМ
-- ────────────────────────────────────────────────────────────
-- Было: minefields_visible()/droneposts_visible() фильтровали выдачу через
-- _defense_can_see() — своё, своя система, своя колония в системе или интел на
-- владельца. На карте это давало пустоту: игрок не видел ни чужих мин, ни
-- Постов Древних Стражей нигде, кроме собственных границ.
--
-- Почему открываем. Минное заграждение — это ПРЕДУПРЕЖДЕНИЕ, а не засада:
-- смысл его в том, чтобы чужой флот развернулся, не входя. Мегасооружение из
-- ихора — тем более: это объект размером с луну, его не спрячешь.
-- Скрытность остаётся у того, для чего она и заводилась: аванпосты
-- (outposts_visible) и корабли-носители по-прежнему идут через
-- _defense_can_see() — сама функция НЕ ТРОНУТА, меняются только два запроса.
--
-- Флаг 'mine' сохраняется: он говорит «это ваше, можно снять», и панель
-- системы вешает кнопку управления только на свои записи.
-- ════════════════════════════════════════════════════════════

create or replace function public.minefields_visible()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', mf.id, 'system_id', mf.system_id, 'planet_pid', mf.planet_pid,
      'faction_id', mf.faction_id, 'hexes', mf.hexes, 'charges', mf.hexes,
      'hex_max', public._hazard_const('sysmine_max')::int,
      'mine', (mf.faction_id = fid)
    ))
    from public.system_minefields mf
  ), '[]'::jsonb);
end$$;
revoke all on function public.minefields_visible() from public;
grant execute on function public.minefields_visible() to authenticated;

create or replace function public.droneposts_visible()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', dp.id, 'system_id', dp.system_id, 'faction_id', dp.faction_id,
      'wings', dp.wings, 'wing_max', public._hazard_const('dronewing_max')::int,
      'mine', (dp.faction_id = fid)
    ))
    from public.system_drone_posts dp
  ), '[]'::jsonb);
end$$;
revoke all on function public.droneposts_visible() from public;
grant execute on function public.droneposts_visible() to authenticated;
