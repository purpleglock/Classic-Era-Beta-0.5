-- ============================================================================
--  ПОЛНЫЙ ДЕМОНТАЖ ЖУРНАЛА ДЕЙСТВИЙ (faction_audit).
--
--  ЗАЧЕМ. Журнал (вкладка «📋 Журнал» в админке) писал строку в faction_audit
--  на КАЖДОЕ изменение игровых таблиц и адски грузил Disk IO. Триггеры уже
--  снимались срезом _audit_disable.sql, но таблица, функции и (возможно)
--  часть триггеров остались. Этот срез убирает ВСЁ: триггеры, функции, таблицу
--  со всеми записями. Вкладка из админки удалена клиентом (?v=20260715nojournal1).
--
--  БЕЗОПАСНОСТЬ. trg_audit — AFTER-триггеры с `return null`, на игру не влияют.
--  Данные журнала теряются НАВСЕГДА (это и есть цель). Игровые таблицы не трогаем.
--
--  КАК ПРИМЕНИТЬ. Supabase → SQL Editor → New query → вставить весь файл → Run.
--  Внизу будет «AUDIT DROP: снято триггеров N, журнал удалён».
-- ============================================================================

-- 1) Снять триггеры trg_audit со всех таблиц, где они ещё висят.
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
  raise notice 'AUDIT DROP: снято триггеров trg_audit: %', cnt;
end$$;

-- 2) Удалить все функции аудита (из _admin_action_log.sql).
drop function if exists public._audit_capture()          cascade;
drop function if exists public._audit_backfill()          cascade;
drop function if exists public._audit_map()               cascade;
drop function if exists public._audit_meta(text)          cascade;
drop function if exists public._audit_fid(jsonb)          cascade;
drop function if exists public._audit_owner(jsonb)        cascade;
drop function if exists public._audit_hint(jsonb)         cascade;
drop function if exists public._audit_name(text)          cascade;

-- 3) Удалить саму таблицу журнала (вместе с индексами и записями).
drop table if exists public.faction_audit cascade;

do $$ begin raise notice 'AUDIT DROP: журнал удалён полностью'; end $$;
