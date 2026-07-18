-- ============================================================
-- АДМИН-ТЕСТ: «Пропустить полёт»
-- Все флоты фракции, что сейчас в пути, прибывают немедленно:
-- arrive_at := now(), затем штатный _fleet_settle (он же считает
-- закрытые границы, перехват, бой и оккупацию — см. _war_intercept.sql).
-- Применять ПОСЛЕ _army_fleet.sql и _war_intercept.sql.
-- ============================================================

create or replace function public.admin_test_skip_flight(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;

  update public.fleets set arrive_at = now()
    where faction_id = p_fid and status = 'transit';
  get diagnostics n = row_count;

  perform public._fleet_settle(p_fid);
  return jsonb_build_object('ok', true, 'arrived', n);
end$$;
revoke all on function public.admin_test_skip_flight(text) from public;
grant execute on function public.admin_test_skip_flight(text) to authenticated;

-- ── ГОТОВО ──────────────────────────────────────────────────
