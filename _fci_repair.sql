-- _fci_repair.sql — ЛЕЧЕНИЕ фантомной контрразведки
-- ════════════════════════════════════════════════════════════════════════
-- СИМПТОМ: панель «🛡 Контрразведка» пишет «в защите: 6 · свободно 1»,
--   но во ВСЕХ ролях «никто не назначен», и 6 агентов залипли (не идут на
--   операции, «свободно» занижено).
--
-- ПРИЧИНА (две, лечатся обе):
--   1) ОСИРОТЕВШИЕ строки faction_counterintel — агент, стоявший в КР, был
--      захвачен/удалён (сменил faction_id или исчез). _fci_sync считает строку
--      в counter_agents, а spy_counter_list (JOIN spy_agents по своей фракции)
--      её не показывает → «в защите N», но «никто не назначен».
--   2) ЗАЛИПШИЙ counter_agents от старой системы: миграция в _spy_fleet_ops.sql
--      пересинхронизирует счётчик только для фракций с непустым counter_map,
--      поэтому пустые фракции остаются с фантомным числом.
--
-- ПРИМЕНЯТЬ ПОСЛЕ: _spy_fleet_ops.sql (таблица faction_counterintel, _fci_sync).
-- Идемпотентно, безопасно гонять повторно.
-- ════════════════════════════════════════════════════════════════════════

do $$
begin
  -- если именной таблицы ещё нет (т.е. _spy_fleet_ops.sql не применён) —
  -- просто гасим фантомный counter_agents, чтобы агенты не залипали «в защите».
  if to_regclass('public.faction_counterintel') is null then
    update public.faction_economy
      set counter_agents = 0, counter_map = '{}'::jsonb
      where coalesce(counter_agents,0) <> 0 or coalesce(counter_map,'{}'::jsonb) <> '{}'::jsonb;
    return;
  end if;

  -- 1) Удаляем осиротевшие/невалидные назначения:
  --    агента нет вовсе, либо он уже не в этой фракции, либо он пленник.
  delete from public.faction_counterintel ci
  where not exists (
    select 1 from public.spy_agents a
    where a.id = ci.agent_id
      and a.faction_id = ci.faction_id
      and coalesce(a.captive, false) = false
  );

  -- 2) Пересинхронизируем counter_agents = реальное число валидных назначений
  --    для ВСЕХ фракций (а не только мигрированных). Заодно гасим залипший
  --    counter_map, чтобы старая система больше не воскрешала фантом.
  update public.faction_economy fe
    set counter_agents = (
          select count(*) from public.faction_counterintel ci
          where ci.faction_id = fe.faction_id),
        counter_map = '{}'::jsonb
    where coalesce(fe.counter_agents, 0) <> (
          select count(*) from public.faction_counterintel ci
          where ci.faction_id = fe.faction_id)
       or coalesce(fe.counter_map, '{}'::jsonb) <> '{}'::jsonb;
end $$;

-- ── ПРОВЕРКА ─────────────────────────────────────────────────────────────
-- select faction_id, counter_agents,
--   (select count(*) from public.faction_counterintel ci where ci.faction_id=fe.faction_id) as named
-- from public.faction_economy fe order by counter_agents desc;
--   → столбцы counter_agents и named должны совпадать у всех.
