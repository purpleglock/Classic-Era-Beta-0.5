-- ============================================================
-- ПОЧИНКА ПРОФИЛЕЙ — устранение дублей и уникальность email
-- Причина бага: у public.profiles нет UNIQUE(email), а сохранение
-- профиля делает POST с Prefer: resolution=merge-duplicates. Без
-- уникального ключа upsert не находит конфликт и КАЖДЫЙ раз вставляет
-- новую строку → дубли → в комментариях/участниках берётся устаревшая.
-- Выполнить целиком в Supabase → SQL Editor.
-- ============================================================

-- 1) Удалить дубли, оставив по одной (последней физической) строке на email
delete from public.profiles a
  using public.profiles b
  where a.email = b.email and a.ctid < b.ctid;

-- 2) Уникальность email → теперь merge-duplicates работает как upsert (без новых дублей)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_email_key'
  ) then
    alter table public.profiles add constraint profiles_email_key unique (email);
  end if;
end$$;
