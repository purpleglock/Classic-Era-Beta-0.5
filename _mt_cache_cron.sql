-- ═══════════════════════════════════════════════════════════════════════
--  Чистка кэша переводов по расписанию.
--  mt_cache_gc() сносит строки, которых не спрашивали 90 дней. Без крона
--  таблица растёт вечно: перевод одной сводки живёт столько же, сколько
--  проект, хотя саму сводку никто не откроет второй раз.
--  Раз в неделю, ночью с воскресенья на понедельник — работа фоновая.
-- ═══════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      if exists (select 1 from cron.job where jobname = 'mt-cache-gc') then
        perform cron.unschedule('mt-cache-gc');
      end if;
      perform cron.schedule('mt-cache-gc', '40 3 * * 1', 'select public.mt_cache_gc();');
      raise notice 'pg_cron: mt-cache-gc запланирован (по понедельникам в 03:40)';
    exception when others then
      raise notice 'pg_cron для чистки кэша переводов настроить не удалось (%) — кэш продолжит расти, чистить вручную: select public.mt_cache_gc();', sqlerrm;
    end;
  else
    raise notice 'pg_cron недоступен — чистить кэш переводов вручную: select public.mt_cache_gc();';
  end if;
end $$;
