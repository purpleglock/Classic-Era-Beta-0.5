-- ════════════════════════════════════════════════════════════════════════
-- АУДИТ И ЗАКРЫТИЕ «ВНУТРЕННИХ» ФУНКЦИЙ, ОТКРЫТЫХ ДЛЯ ИГРОКОВ
-- Выполнять в Supabase → SQL Editor.
--
-- ЧАСТЬ 1 — только чтение, ничего не меняет. Выполнить и сохранить вывод.
-- ЧАСТЬ 2 — меняет ТОЛЬКО права на вызов функций (GRANT/REVOKE).
--           Данные, сохранения игроков, таблицы не трогаются.
--           Откат части 2 — блок в самом конце файла.
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════ ЧАСТЬ 1. АУДИТ (read-only) ════════════════════

-- 1.1 Внутренние SECURITY DEFINER функции, которые сейчас может вызвать
--     аноним (anon) или любой залогиненный игрок (authenticated).
--     Каждая строка = функция, доступная через /rest/v1/rpc/<имя> с публичным ключом.
select p.oid::regprocedure                                   as function,
       has_function_privilege('anon',          p.oid, 'execute') as anon_can_call,
       has_function_privilege('authenticated', p.oid, 'execute') as player_can_call
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prosecdef
   and p.proname like '\_%'
   and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'))
 order by 1;

-- 1.2 Задания pg_cron в живой базе. В репозитории их ~25 (economy-daily-tick,
--     legion-*, angel-*, precursor-*, market-auto-tick, news-vk-digest, shell-track,
--     access-log-prune, mt-cache-gc, exchange-*). Любое задание, которого нет
--     в этом списке или чья command отличается от файлов, — разобрать отдельно.
select jobid, jobname, schedule, command, active from cron.job order by jobid;

-- 1.3 Кто сейчас штаб (суперадмин / эдитор / модератор).
select ur.user_id, u.email, ur.role, ur.is_banned
  from public.user_roles ur left join auth.users u on u.id = ur.user_id
 where lower(btrim(ur.role)) in ('superadmin','admin','super','editor','moderator','mod')
 order by ur.role;

-- 1.4 Роли Postgres с правом входа (кроме служебных). Лишний логин = чёрный ход.
select rolname, rolcanlogin, rolsuper, rolbypassrls, rolvaliduntil
  from pg_roles
 where rolcanlogin and rolname not like 'pg\_%'
 order by rolname;

-- 1.5 Все пользовательские триггеры (в т.ч. на auth.users).
select tgrelid::regclass as on_table, tgname, tgfoid::regprocedure as fn, tgenabled
  from pg_trigger where not tgisinternal order by 1, 2;


-- ════════════════════ ЧАСТЬ 2. ЗАКРЫТИЕ (только права) ════════════════════
-- Эти функции вызываются ТОЛЬКО из других SECURITY DEFINER функций и крона,
-- клиент (JS) их не зовёт — проверено по коду. Отзыв права у игроков игру
-- не ломает: вызывающие функции работают с правами владельца базы.
--
-- Что опасного каждая умеет, если её вызвать напрямую:
--   _admin_reassign_owner   — переписать владельца ЛЮБОЙ державы на себя
--   _faction_purge_tails    — снести веру/артиллерию/корабли любой державы
--   _purge_orphan_factions, _system_econ_clear_orphans — массовые чистки
--   _destroy_ships, _destroy_ships_in, _fleet_kill_ships — уничтожать чужие флоты
--   _su_merge_assets, _su_restitute — перекидывать имущество между державами
--   _house_pay, _house_take — двигать деньги «биржевого дома»
--   _slaves_add, _slaves_take_any, _spy_artifact_grant, _spy_grant_xp — выдавать ресурсы/опыт
--   _audit_backfill        — переписывать журнал действий админов

begin;
do $$
declare f record; n int := 0;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname in (
         '_admin_reassign_owner', '_faction_purge_tails', '_purge_orphan_factions',
         '_system_econ_clear_orphans', '_destroy_ships', '_destroy_ships_in',
         '_fleet_kill_ships', '_su_merge_assets', '_su_restitute',
         '_house_pay', '_house_take', '_slaves_add', '_slaves_take_any',
         '_spy_artifact_grant', '_spy_grant_xp', '_audit_backfill')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    n := n + 1;
  end loop;
  raise notice 'закрыто функций: %', n;
end$$;
commit;

notify pgrst, 'reload schema';

-- После этого повторить запрос 1.1 — этих имён в выводе быть не должно.
-- Остальные строки из 1.1 разбирать по одной: сначала проверить, не вызывает ли
-- функцию клиент (поиск имени в *.js) или НЕ-definer функция (иначе отзыв уронит
-- сайт — бывший разработчик сам на этом обжёгся с _angel_is 19.08).


-- ════════════════════ ОТКАТ ЧАСТИ 2 (если вдруг что-то сломалось) ════════════════════
-- do $$ declare f record; begin
--   for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
--     where ns.nspname='public' and p.proname in ('_admin_reassign_owner','_faction_purge_tails',
--       '_purge_orphan_factions','_system_econ_clear_orphans','_destroy_ships','_destroy_ships_in',
--       '_fleet_kill_ships','_su_merge_assets','_su_restitute','_house_pay','_house_take',
--       '_slaves_add','_slaves_take_any','_spy_artifact_grant','_spy_grant_xp','_audit_backfill')
--   loop execute format('grant execute on function %s to anon, authenticated', f.sig); end loop;
-- end$$;
