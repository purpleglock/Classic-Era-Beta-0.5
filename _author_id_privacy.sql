-- © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
-- ============================================================
-- ПРИВАТНОСТЬ АВТОРСТВА — ЭТАП 1 (фундамент).
--
-- Цель: ни гость, ни чужой залогиненный игрок не должен получать
-- e-mail'ы из публичных таблиц. Ключ авторства = user_id (uuid, не PII).
--
-- ПОРЯДОК ПРИМЕНЕНИЯ (критично!):
--   1) этот файл (_author_id_privacy.sql) — сайт продолжает работать по-старому;
--   2) деплой клиента (?v=20260703privacy);
--   3) _author_id_revoke.sql — вычистка email-колонок (ЭТАП 3).
--
-- Откат этапа 1: вернуть старую политику "prof_sel_all" (select true)
-- и старый set_my_profile из _admin_profiles.sql. Данные не теряются.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. profiles.user_id — новый ключ профиля
-- ────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists user_id uuid;

-- Бэкфилл из auth.users по email (без учёта регистра)
update public.profiles p
   set user_id = u.id
  from auth.users u
 where p.user_id is null
   and lower(u.email) = lower(p.email);

-- Уникальность: один профиль на аккаунт (email в таблице уже unique)
create unique index if not exists profiles_user_id_key
  on public.profiles(user_id) where user_id is not null;

-- ────────────────────────────────────────────────────────────
-- 2. set_my_profile — теперь пишет и user_id (ключ = auth.uid()).
--    email продолжаем заполнять: он нужен админ-инструментам,
--    но наружу больше не отдаётся (см. п.4).
-- ────────────────────────────────────────────────────────────
create or replace function public.set_my_profile(p_name text, p_avatar text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_em text;
begin
  v_uid := auth.uid();
  v_em  := auth.jwt() ->> 'email';
  if v_uid is null then raise exception 'not authenticated'; end if;
  if public._name_violates(p_name) then raise exception 'name violates content policy'; end if;
  update public.profiles
     set display_name = p_name, avatar_url = p_avatar, user_id = v_uid
   where user_id = v_uid or (v_em is not null and email = v_em);
  if not found then
    insert into public.profiles (email, user_id, display_name, avatar_url)
    values (coalesce(v_em, v_uid::text), v_uid, p_name, p_avatar);
  end if;
end$$;
revoke all on function public.set_my_profile(text, text) from public;
grant execute on function public.set_my_profile(text, text) to authenticated;

-- ────────────────────────────────────────────────────────────
-- 3. public_profiles — публичная витрина БЕЗ email.
--    View принадлежит postgres (definer-семантика) → читает profiles
--    в обход закрытого RLS, но отдаёт только 3 безопасные колонки.
-- ────────────────────────────────────────────────────────────
create or replace view public.public_profiles as
  select user_id, display_name, avatar_url
    from public.profiles
   where user_id is not null;
grant select on public.public_profiles to anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 4. Закрываем прямое чтение profiles: сносим ВСЕ select-политики
--    (включая старую "прочитать могут все") и оставляем:
--    своя строка + стафф. Гости и чужие игроки email больше не видят.
-- ────────────────────────────────────────────────────────────
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.profiles', pol.policyname);
  end loop;
end$$;

alter table public.profiles enable row level security;

create policy "prof_sel_own_or_staff" on public.profiles
  for select to authenticated
  using (
    user_id = auth.uid()
    or email = (auth.jwt() ->> 'email')
    or public.current_user_role() in ('superadmin','editor','moderator')
  );
-- анонимам прямое чтение profiles не нужно вовсе
revoke select on public.profiles from anon;

-- ────────────────────────────────────────────────────────────
-- 5. pages.author_id — авторство страниц по uuid
-- ────────────────────────────────────────────────────────────
alter table public.pages add column if not exists author_id uuid;

-- Бэкфилл: created_by исторически хранил email
update public.pages pg
   set author_id = u.id
  from auth.users u
 where pg.author_id is null
   and pg.created_by is not null
   and lower(u.email) = lower(pg.created_by);

create index if not exists pages_author_id_idx on public.pages(author_id);

-- Новые страницы: author_id проставляет сервер из JWT (клиент может не прислать)
create or replace function public._pages_set_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_id is null then new.author_id := auth.uid(); end if;
  return new;
end$$;
drop trigger if exists trg_pages_set_author on public.pages;
create trigger trg_pages_set_author
  before insert on public.pages
  for each row execute function public._pages_set_author();

-- ────────────────────────────────────────────────────────────
-- 6. characters.owner_id — вместо owner_email (тот вычищается этапом 3)
-- ────────────────────────────────────────────────────────────
alter table public.characters add column if not exists owner_id uuid;

update public.characters c
   set owner_id = u.id
  from auth.users u
 where c.owner_id is null
   and c.owner_email is not null
   and lower(u.email) = lower(c.owner_email);

-- ────────────────────────────────────────────────────────────
-- 7. Почта для админки — только через staff-RPC (не через таблицы).
--    Админ-панель «Фракции» после этапа 3 берёт email владельца отсюда.
-- ────────────────────────────────────────────────────────────
create or replace function public.admin_get_user_email(p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() not in ('superadmin','editor','moderator') then
    raise exception 'forbidden: staff only';
  end if;
  return (select email from auth.users where id = p_user_id);
end$$;
revoke all on function public.admin_get_user_email(uuid) from public;
grant execute on function public.admin_get_user_email(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────
-- Проверка после применения:
--   select count(*) from public.profiles where user_id is null;       -- сироты профилей
--   select count(*) from public.pages
--    where created_by like '%@%' and author_id is null;               -- страницы без автора
--   select count(*) from public.characters
--    where owner_email like '%@%' and owner_id is null;               -- персонажи без владельца
-- Сироты покажутся как «Участник» — это старые/удалённые аккаунты.
-- ============================================================
