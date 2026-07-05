-- ============================================================
-- АУДИТ (только чтение, ничего не меняет) — реальное состояние RLS в живой БД.
--
-- Зачем: репо ≠ прод. Был прецедент — colony_projects принимал PATCH, потому
-- что RLS в живой базе оказался не тем, что в SQL-файлах. Часть политик
-- (pages, characters, comments, sections, site_settings) создавалась в
-- дашборде и в репо её вообще нет.
--
-- КАК: вставить целиком в Supabase → SQL Editor → Run.
-- Результат — одна таблица «находок», отсортирована по серьёзности.
-- Скинь вывод Клоду — по нему пишется точечная миграция.
--
-- Расшифровка severity:
--   1-CRIT — таблица доступна на запись всем (RLS выключен или политика true)
--   2-WARN — открытая запись при включённом RLS / запись для anon
--   3-INFO — RLS включён, политик нет (запись закрыта; убедиться, что фичи живы)
--   4-OK   — контрольные проверки (замок экономики на месте и т.п.)
-- ============================================================

with tbl as (
  select c.oid, c.relname as tab, c.relrowsecurity as rls_on
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
pol as (
  select tablename as tab, policyname, permissive, roles, cmd,
         coalesce(qual, '') as qual, coalesce(with_check, '') as chk
  from pg_policies
  where schemaname = 'public'
)

-- 1. RLS ВЫКЛЮЧЕН: любой игрок с anon-ключом пишет напрямую (grant-уровень
--    в Supabase по умолчанию открыт) — это та самая дыра colony_projects.
select '1-CRIT' as severity, tab as "table",
       'RLS ВЫКЛЮЧЕН — прямая запись из консоли работает' as finding
from tbl where not rls_on

union all
-- 2. Политика записи с using/with check = true для authenticated/public.
select case when 'anon' = any(p.roles) or 'public' = any(p.roles)
            then '1-CRIT' else '2-WARN' end,
       p.tab,
       'открытая запись: policy "' || p.policyname || '" cmd=' || p.cmd
       || ' roles=' || array_to_string(p.roles, ',')
       || ' (qual=' || coalesce(nullif(p.qual,''),'—')
       || ', check=' || coalesce(nullif(p.chk,''),'—') || ')'
from pol p
join tbl t on t.tab = p.tab and t.rls_on
where p.cmd in ('INSERT','UPDATE','DELETE','ALL')
  and (p.qual in ('', 'true') and p.chk in ('', 'true'))

union all
-- 3. Любая политика записи для роли anon (незалогиненный!).
select '2-WARN', p.tab,
       'запись для ANON: policy "' || p.policyname || '" cmd=' || p.cmd
from pol p
where p.cmd in ('INSERT','UPDATE','DELETE','ALL')
  and 'anon' = any(p.roles)

union all
-- 4. RLS включён, но политик нет вообще — всё закрыто (и чтение тоже).
select '3-INFO', t.tab, 'RLS включён, политик 0 — таблица полностью закрыта'
from tbl t
where t.rls_on and not exists (select 1 from pol p where p.tab = t.tab)

union all
-- 5. Контроль: замок _security_lockdown на 5 эконом-таблицах ещё стоит?
select case when tg.tgname is null then '1-CRIT' else '4-OK' end,
       t.tab,
       case when tg.tgname is null
            then 'ЗАМОК СНЯТ — триггер trg_lock_* отсутствует!'
            else 'замок экономики на месте (' || tg.tgname || ')' end
from tbl t
left join pg_trigger tg on tg.tgrelid = t.oid and tg.tgname = 'trg_lock_' || t.tab
where t.tab in ('faction_economy','colonies','colony_buildings',
                'colony_projects','unit_production')

order by 1, 2;
