-- ============================================================
-- АУДИТ ч.2 (только чтение) — полные тексты политик таблиц,
-- которых НЕТ в репо (создавались в дашборде): profiles, pages,
-- characters, comments, sections, site_settings, user_roles.
--
-- Аудит ч.1 показал 2 политики записи с условием true на profiles —
-- этот запрос покажет их имена и точные выражения.
--
-- Вставить в Supabase → SQL Editor → Run, вывод скинуть Клоду.
-- ============================================================

select tablename  as "table",
       policyname as "policy",
       cmd,
       array_to_string(roles, ',')     as roles,
       permissive,
       coalesce(qual, '—')             as using_expr,
       coalesce(with_check, '—')       as check_expr
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles','pages','characters','comments',
                    'sections','site_settings','user_roles')
order by tablename, cmd, policyname;
