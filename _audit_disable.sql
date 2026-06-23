-- ============================================================================
--  ОТКЛЮЧЕНИЕ ЖУРНАЛА ДЕЙСТВИЙ (faction_audit) ради экономии Disk IO.
--
--  ЗАЧЕМ. Триггеры trg_audit висят на всех игровых таблицах и на КАЖДОЕ
--  изменение (insert/update/delete) дописывают строку в public.faction_audit.
--  Самая горячая таблица — faction_economy (тик/сделка/постройка) — из-за этого
--  каждое действие игрока = доп. запись на диск. Это удваивало дисковую нагрузку.
--
--  БЕЗОПАСНОСТЬ. trg_audit — это AFTER-триггеры с `return null`: они НЕ влияют на
--  саму операцию, только добавляли запись в журнал. Снятие их игру не ломает.
--  Таблица faction_audit и все старые записи ОСТАЮТСЯ (вкладка «Журнал» покажет
--  историю, просто перестанет пополняться новыми строками).
--
--  КАК ПРИМЕНИТЬ. Supabase → SQL Editor → New query → вставить весь этот файл →
--  Run. В сообщении внизу будет «AUDIT OFF: снято триггеров: N».
-- ============================================================================

do $$
declare r record; cnt int := 0;
begin
  for r in
    select tgrelid::regclass::text as tbl
    from pg_trigger
    where tgname = 'trg_audit' and not tgisinternal
  loop
    execute format('drop trigger if exists trg_audit on %s', r.tbl);
    cnt := cnt + 1;
  end loop;
  raise notice 'AUDIT OFF: снято триггеров trg_audit: %', cnt;
end$$;

-- (необязательно) Освободить место и почистить «мёртвые» строки горячих таблиц,
-- чтобы фоновая уборка не догоняла их потом. Безопасно, данные не теряются.
vacuum (analyze) public.faction_economy;

-- ============================================================================
--  КАК ВЕРНУТЬ ЖУРНАЛ ОБРАТНО (когда разберёшься с тарифом/нагрузкой):
--  выполнить блок ниже — он заново навесит триггеры на все таблицы из карты
--  аудита. Функции _audit_map() и _audit_capture() уже есть в БД, их не трогаем.
-- ----------------------------------------------------------------------------
-- do $$
-- declare t text; cnt int := 0;
-- begin
--   for t in select tbl from public._audit_map() loop
--     if to_regclass('public.' || t) is not null then
--       execute format('drop trigger if exists trg_audit on public.%I', t);
--       execute format(
--         'create trigger trg_audit after insert or update or delete on public.%I
--            for each row execute function public._audit_capture()', t);
--       cnt := cnt + 1;
--     end if;
--   end loop;
--   raise notice 'AUDIT ON: триггеры навешены на % таблиц', cnt;
-- end$$;
-- ============================================================================
