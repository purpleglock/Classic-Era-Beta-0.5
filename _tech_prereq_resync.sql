-- ============================================================
-- ФИКС «нельзя исследовать эсминец» — рассинхрон tech_nodes ↔ tech_prereq.
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Было: перекат сида _research_total.sql делает on conflict do update
--   set prereq = excluded.prereq и ЗАТИРАЕТ стаффские правки связей дерева
--   обратно на дефолт. Overlay tech_prereq при этом остаётся (клиент видит
--   узел доступным), а сервер валидирует по tech_nodes.prereq (старый
--   дефолт) → economy_research режет «missing prerequisites».
--   Конкретно: у cls.ship.destroyer в overlay prereq = [], в tech_nodes
--   вернулся ["cls.ship.frigate"].
-- Стало: tech_nodes.prereq пересинхронизирован из overlay. Тот же resync
--   добавлен в хвост _research_total.sql, чтобы будущие перекаты сида
--   не повторяли поломку.
-- ============================================================

update public.tech_nodes n
   set prereq = tp.prereq
  from public.tech_prereq tp
 where tp.node_id = n.node_id
   and n.prereq is distinct from tp.prereq;

-- Проверка: обе строки должны совпасть (у эсминца prereq = []).
-- select n.node_id, n.prereq as nodes, tp.prereq as overlay
--   from public.tech_nodes n join public.tech_prereq tp using (node_id);
