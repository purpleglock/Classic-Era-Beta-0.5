-- ============================================================
-- РАЗОВЫЙ ПЕРЕИГРЫШ ДУЭЛИ КЛУБА (2026-08-02)
-- Событие d141faba-3e64-45ea-a976-8cf6cb4d7cd9
-- Бой      b56052ef-3324-4c75-9c0b-8695c7ae5d0e
-- Шестнадцатая Волна (fac_95a2fce0aa) vs Микустан (fac_26f25b449f)
-- ============================================================
-- ПОЧЕМУ: победа Микустана — техническая и незаслуженная. Шестнадцатая
-- Волна выставила 40 бортов (они лежали в battle_units), но att_ready
-- остался false: проверка бюджета драфта живёт в battle_ready, а не в
-- battle_deploy, и второй вызов отбил состав как «дороже бюджета».
-- Борта записались, готовность — нет, дедлайн истёк → техпоражение.
-- Клиент теперь считает бюджет до отправки, повтор исключён.
--
-- РЕШЕНИЕ ВЛАДЕЛЬЦА ИГРЫ:
--   • 431 000 ГС (приз 250 000 + банк 181 000) у Микустана НЕ отбираем;
--     приз по итогу переигранного боя будет выплачен ещё раз.
--   • новый круг заявок, открытый автоматически, удаляем;
--   • бой начинается с чистой расстановки, оба игрока ставят заново.
--
-- ВАЖНО: при таймауте тик удалил синтетические флоты-резервы обеих
-- сторон (fleets ... using battle_fleets), поэтому пулы для драфта
-- пересобираем через _fc_make_pool с ТЕМ ЖЕ бюджетом и той же ареной.
-- ============================================================

begin;

-- 0) страховка: работаем только если бой и событие те самые
do $$
declare b record; ev record; n int;
begin
  select * into b from public.battles
   where id = 'b56052ef-3324-4c75-9c0b-8695c7ae5d0e';
  if b.id is null then raise exception 'бой не найден — накат отменён'; end if;
  if b.kind <> 'duel' then raise exception 'это не дуэль клуба — накат отменён'; end if;

  select * into ev from public.fc_events
   where id = 'd141faba-3e64-45ea-a976-8cf6cb4d7cd9';
  if ev.id is null then raise exception 'событие клуба не найдено — накат отменён'; end if;
  if ev.battle_id <> b.id then raise exception 'событие ссылается на другой бой — накат отменён'; end if;

  -- новый круг удаляем только если в нём никто не успел записаться
  select count(*) into n from public.fc_signups
   where event_id = '03368747-184c-402c-bb4e-125f3ce8c6d3';
  if n > 0 then
    raise exception 'в новом круге уже % заявок — удалять нельзя, останови и реши вручную', n;
  end if;
end$$;

-- 1) доска начисто: снимаем все 43 борта прошлой (несостоявшейся) расстановки
delete from public.battle_units
 where battle_id = 'b56052ef-3324-4c75-9c0b-8695c7ae5d0e';

-- 2) бой возвращаем в фазу расстановки со свежим дедлайном
update public.battles
   set status       = 'forming',
       winner_fid   = null,
       ended_at     = null,
       att_ready    = false,
       def_ready    = false,
       side_to_move = 'attacker',
       turn_no      = 0,
       acts_left    = public._bt_acts(),
       att_turns_left = 6,
       def_turns_left = 6,
       deadline_at  = now() + (public._fc_form_hours() || ' hours')::interval
 where id = 'b56052ef-3324-4c75-9c0b-8695c7ae5d0e';

select public._bt_log('b56052ef-3324-4c75-9c0b-8695c7ae5d0e',
  '⚖ Круг переигран: прошлый исход был техническим — ошибка интерфейса не дала утвердить состав. Резервы выданы заново, расставляйте флот.');

-- 3) пересобираем пулы драфта обеим сторонам (старые удалил таймаут)
--    бюджет и арена — исходные, из самого боя
do $$
declare b record; na int; nb int;
begin
  select * into b from public.battles
   where id = 'b56052ef-3324-4c75-9c0b-8695c7ae5d0e';
  -- на всякий случай подчищаем возможные хвосты пулов этого боя
  delete from public.fleets f using public.battle_fleets bf
   where bf.battle_id = b.id and bf.fleet_id = f.id;
  delete from public.battle_fleets where battle_id = b.id;

  na := public._fc_make_pool(b.id, b.attacker_fid, 'attacker', b.duel_budget, b.system_id);
  nb := public._fc_make_pool(b.id, b.defender_fid, 'defender', b.duel_budget, b.system_id);
  raise notice 'пулы пересозданы: нападающий % проектов, обороняющийся % проектов', na, nb;
end$$;

-- 4) событие клуба снова «идёт»: вердикт и расчёт сбрасываем
--    (деньги, уже выплаченные Микустану, по решению владельца НЕ трогаем)
update public.fc_events
   set status     = 'live',
       settled    = false,
       winner_fid = null,
       ended_at   = null
 where id = 'd141faba-3e64-45ea-a976-8cf6cb4d7cd9';

-- 5) автоматически открытый следующий круг убираем — он лишний,
--    движок откроет новый сам, когда переигранная дуэль завершится
delete from public.fc_events
 where id = '03368747-184c-402c-bb4e-125f3ce8c6d3';

commit;

-- Проверка:
--   select status, att_ready, def_ready, deadline_at from battles
--     where id='b56052ef-3324-4c75-9c0b-8695c7ae5d0e';        → forming, false, false
--   select count(*) from battle_units
--     where battle_id='b56052ef-3324-4c75-9c0b-8695c7ae5d0e'; → 0
--   select count(*) from battle_fleets
--     where battle_id='b56052ef-3324-4c75-9c0b-8695c7ae5d0e'; → 2
