-- ════════════════════════════════════════════════════════════
-- БАК ДОЕХАЛ ДО КАРТОЧКИ ФЛОТА
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _army_fleet.sql (даёт fleets_mine), _fleet_tank.sql
-- (даёт fleets.fuel/fuel_cap и _fleet_can_refuel) и _outpost_depot.sql
-- (даёт режим 'depot', на который смотрит _fleet_can_refuel). Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК. _fleet_tank.sql ввёл бак и запретил вылет без плеч, но
-- список флотов игрока (fleets_mine) остался прежним: ни fuel, ни fuel_cap,
-- ни признака «здесь можно заправиться». Клиент их ждёт — и молча
-- деградирует, причём в обе стороны сразу:
--   • gmFleetTankHtml выходит по `fl.fuel == null` → в карточке флота НЕТ ни
--     шкалы хода, ни кнопки «Заправить бак». Заправиться нельзя в принципе;
--   • gmFleetConfirmSend берёт `tank = null` → `enough` всегда true → рейс
--     предлагается подтвердить даже когда плеч не хватает, и отказ прилетает
--     ошибкой в тосте вместо честной шкалы ДО клика.
-- То есть сервер бак требует, а игрок его не видит. Чиним источник данных,
-- клиент менять не нужно — он уже читает ровно эти три поля.
--
-- ⚠ fleets_mine НЕ обёрнута _fm_wrap (гейт прав раздаётся только на
-- пишущие RPC вроде fleet_send/outpost_set_mode), поэтому create or replace
-- здесь ничего не затирает и звать _fm_wrap заново не требуется.
-- ════════════════════════════════════════════════════════════
create or replace function public.fleets_mine()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', fl.id, 'name', fl.name, 'status', fl.status, 'is_station', fl.is_station,
      'system_id', fl.system_id, 'from_sys', fl.from_sys, 'dest_sys', fl.dest_sys,
      'home_sys', fl.home_sys, 'composition', fl.composition,
      'depart_at', fl.depart_at, 'arrive_at', fl.arrive_at,
      'ships', (select coalesce(sum(greatest(0,(c->>'qty')::int)),0)
                from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c),
      'can_recall', (fl.status='idle' and fl.home_sys is not null and fl.system_id is distinct from fl.home_sys),
      -- ── БАК (_fleet_tank.sql) ──
      'fuel', greatest(0, coalesce(fl.fuel, 0)),
      'fuel_cap', greatest(0, coalesce(fl.fuel_cap, 0)),
      -- Заправка только там, где флот СТОИТ: своя верфь или своя depot-застава.
      -- В полёте система не определена — заправлять нечего и негде.
      'can_refuel', (fl.status = 'idle' and fl.system_id is not null
                     and public._fleet_can_refuel(fid, fl.system_id)
                     and coalesce(fl.fuel,0) < coalesce(fl.fuel_cap,0))
    ) order by fl.created_at asc)
    from public.fleets fl where fl.faction_id = fid
  ), '[]'::jsonb);
end$$;
revoke all on function public.fleets_mine() from public;
grant execute on function public.fleets_mine() to authenticated;
