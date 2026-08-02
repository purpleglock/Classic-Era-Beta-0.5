-- ============================================================
-- СБРОС ЗАВИСШЕЙ РАССТАНОВКИ ДУЭЛИ (2026-08-02, повторно)
-- Бой b56052ef-3324-4c75-9c0b-8695c7ae5d0e
-- ============================================================
-- Игрок (Микустан) выставил 18 бортов на 721 546 ГС при бюджете
-- 204 210 — втрое дороже. battle_deploy их записал, battle_ready
-- отбил: «состав дороже бюджета». Борта остались висеть на доске
-- при att_ready/def_ready = false.
--
-- Первопричина уже устранена накатом _battle_state_duel_budget.sql:
-- battle_state снова отдаёт duel_budget, клиент видит лимит по
-- деньгам и не даёт собрать состав дороже него.
--
-- Здесь просто убираем застрявшую расстановку, чтобы игрок начал
-- с чистой доски. Пулы-резервы и дедлайн не трогаем.
-- ============================================================

begin;

do $$
declare b record; n int; spent numeric;
begin
  select * into b from public.battles
   where id = 'b56052ef-3324-4c75-9c0b-8695c7ae5d0e';
  if b.id is null then raise exception 'бой не найден — накат отменён'; end if;
  if b.status <> 'forming' then
    raise exception 'бой уже не в фазе расстановки (%) — накат отменён', b.status;
  end if;

  select count(*), coalesce(sum(coalesce((fu.summary->>'cost')::numeric, 0)), 0)
    into n, spent
    from public.battle_units bu
    join public.faction_units fu on fu.id = bu.unit_id
   where bu.battle_id = b.id;
  raise notice 'снимаем с доски % бортов на % ГС (бюджет %)', n, spent::bigint, b.duel_budget::bigint;
end$$;

delete from public.battle_units
 where battle_id = 'b56052ef-3324-4c75-9c0b-8695c7ae5d0e';

update public.battles
   set att_ready = false, def_ready = false
 where id = 'b56052ef-3324-4c75-9c0b-8695c7ae5d0e';

select public._bt_log('b56052ef-3324-4c75-9c0b-8695c7ae5d0e',
  '🧹 Доска очищена: прошлый состав был дороже бюджета, а лимит по деньгам не показывался. Теперь бюджет виден в расстановке — набирайте флот заново.');

commit;

-- Проверка:
--   select count(*) from battle_units
--     where battle_id='b56052ef-3324-4c75-9c0b-8695c7ae5d0e';  → 0
