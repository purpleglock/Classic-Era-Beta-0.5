-- ════════════════════════════════════════════════════════════
-- 18.08 «сигнатуры неуязвимы, флоты пропали» — разбор.
-- Здесь чинится одна из найденных дыр, самая безусловная: цикл налёта
-- (_legion_raid_cycle.sql) написан, функция legion_spoils_tick в базе есть, но
-- КРОНА У НЕЁ НЕТ — ни своей задачи, ни строчки в 'legion-engage-tick'. То есть
-- «взяли добычу и ушли в пустоту» не срабатывало ни разу: вставшая ватага
-- висела над системой вечно, а _legion_disband (единственное место, где её
-- флот убирают с карты) не звался вообще ниоткуда.
--
-- Порядок в тике важен: сначала списываем разбитых (losses_sweep), потом
-- приземляем новые контакты (engage), потом завязываем драку (standoff) — и
-- только в конце уходят те, кому уже никто не мешает (spoils). Иначе ватага
-- успела бы «уйти с добычей» в том же тике, в котором игрок привёл флот.
--
-- ЦЕПОЧКА: после _legion_raid_cycle.sql и _legion_cron_standoff.sql.
-- ════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('legion-engage-tick')
      where exists (select 1 from cron.job where jobname = 'legion-engage-tick');
    perform cron.schedule('legion-engage-tick', '2-59/5 * * * *',
      $c$select public.legion_losses_sweep();
         select public.legion_engage_tick();
         select public.legion_standoff_tick();
         select public.legion_spoils_tick();
         select public.legion_contacts_notify();$c$);
  end if;
end$$;
