-- ============================================================================
--  БИРЖА · АВТО-ПРОГОН РЫНКА (pg_cron)
--  Применять в Supabase → SQL Editor ПОСЛЕ _exchange_margin.sql. Идемпотентно.
--  Зависит от: _market_setup.sql (market_tick), _exchange_margin.sql
--    (market_tick зовёт margin/futures/options_settle best-effort).
--
--  ЗАЧЕМ. Сейчас market_tick() выполняется только когда игрок что-то делает
--  (заход в кабинет / сделка). Из-за этого:
--    • цена и точки графика не появляются, пока никто не играет;
--    • ликвидации маржи/фьючерсов и экспирации опционов ждут чужой активности.
--  Этот срез вешает pg_cron, который зовёт market_tick() каждые 10 минут:
--    • ЦЕНА всё равно двигается раз в игровые сутки (market_tick идемпотентен
--      по суткам: при d<1 он только прогоняет расчёты деривативов и выходит) —
--      то есть «1 точка графика в сутки», как и было задумано;
--    • но теперь сутки «доезжают» сами, без игрока, и каждые 10 минут
--      проверяются ЛИКВИДАЦИИ и ЭКСПИРАЦИИ (settle-хуки идут до выхода по d<1).
--  Никаких изменений механики дохода держав — market_tick трогает только рынок.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      if exists (select 1 from cron.job where jobname = 'market-auto-tick') then
        perform cron.unschedule('market-auto-tick');
      end if;
      -- каждые 10 минут: суточный шаг цены доезжает сам + проверка ликвидаций/экспираций
      perform cron.schedule('market-auto-tick', '*/10 * * * *', 'select public.market_tick();');
      raise notice 'pg_cron: market-auto-tick запланирован (каждые 10 минут)';
    exception when others then
      raise notice 'pg_cron для авто-прогона рынка настроить не удалось (%) — рынок продолжит тикать на заходе игрока', sqlerrm;
    end;
  else
    raise notice 'pg_cron недоступен на этом проекте — рынок тикает на заходе игрока (market_tick из economy_tick)';
  end if;
end$$;

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select jobname, schedule, command from cron.job where jobname = 'market-auto-tick';
-- 2) Подождать 10 минут → select * from cron.job_run_details
--      where jobid = (select jobid from cron.job where jobname='market-auto-tick')
--      order by start_time desc limit 5;   -- статус succeeded
-- 3) Снять авто-прогон при нужде: select cron.unschedule('market-auto-tick');
