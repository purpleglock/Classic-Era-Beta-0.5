-- © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
-- ============================================================
-- ПРИВАТНОСТЬ АВТОРСТВА — ЭТАП 3 (вычистка e-mail из публичных таблиц).
--
-- ПРИМЕНЯТЬ ТОЛЬКО ПОСЛЕ: _author_id_privacy.sql + деплой клиента
-- ?v=20260703privacy. Иначе на сайте пропадут подписи авторов
-- (старый клиент ещё читает email-колонки).
--
-- Что делает:
--   • обнуляет email-данные в публично читаемых таблицах
--     (pages, comments, faction_applications, faction_economy,
--      faction_news, characters);
--   • ставит триггеры-страховки: даже старый/взломанный клиент
--     не сможет снова записать email в эти колонки.
-- Колонки НЕ удаляются (совместимость со старыми клиентами и select=*).
--
-- Перед запуском полезно снять срез (сколько строк заденет):
--   select count(*) from public.pages    where created_by like '%@%';
--   select count(*) from public.comments where user_email is not null;
--   select count(*) from public.faction_applications where owner_email is not null;
--   select count(*) from public.faction_news where owner_email is not null
--       or reviewed_by like '%@%' or verdict_by like '%@%';
--   select count(*) from public.characters where owner_email is not null;
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. Снять NOT NULL с email-колонок — иначе обнуление падает
--    с ошибкой 23502 (у comments.user_email запрет точно стоит;
--    для остальных это безвредный no-op, если запрета нет).
-- ────────────────────────────────────────────────────────────
alter table public.comments             alter column user_email  drop not null;
alter table public.pages                alter column created_by  drop not null;
alter table public.faction_applications alter column owner_email drop not null;
alter table public.faction_economy      alter column owner_email drop not null;
alter table public.characters           alter column owner_email drop not null;
alter table public.faction_news         alter column owner_email drop not null;
alter table public.faction_news         alter column reviewed_by drop not null;
alter table public.faction_news         alter column verdict_by  drop not null;

-- ────────────────────────────────────────────────────────────
-- 1. Вычистка данных
-- ────────────────────────────────────────────────────────────
-- pages: created_by хранил email; служебные значения ('system') не трогаем
update public.pages    set created_by = null where created_by like '%@%';
update public.comments set user_email = null where user_email is not null;
update public.faction_applications set owner_email = null where owner_email is not null;
update public.faction_economy      set owner_email = null where owner_email is not null;
update public.characters           set owner_email = null where owner_email is not null;
-- faction_news: owner_email всегда чистим; reviewed_by/verdict_by — только
-- если там email (новый клиент пишет туда отображаемое имя — его оставляем)
update public.faction_news set owner_email = null where owner_email is not null;
update public.faction_news set reviewed_by = null where reviewed_by like '%@%';
update public.faction_news set verdict_by  = null where verdict_by  like '%@%';
-- factions (старый RP-слой): таблица/колонка может отсутствовать — не падаем
do $$
begin
  update public.factions set owner_email = null where owner_email is not null;
exception when undefined_table or undefined_column then null;
end$$;

-- ────────────────────────────────────────────────────────────
-- 2. Триггеры-страховки: email в эти колонки больше не записывается,
--    даже если его прислали (старый кэш клиента, консоль, серверные RPC).
--    INSERT'ы серверных функций (тик, слухи, трансфер) не ломаются —
--    значение просто обнуляется.
-- ────────────────────────────────────────────────────────────

-- pages: author_id из JWT + created_by-email отсекаем
create or replace function public._pages_set_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_id is null then new.author_id := auth.uid(); end if;
  if new.created_by like '%@%' then new.created_by := null; end if;
  return new;
end$$;
drop trigger if exists trg_pages_set_author on public.pages;
create trigger trg_pages_set_author
  before insert or update on public.pages
  for each row execute function public._pages_set_author();

-- comments
create or replace function public._strip_comment_email() returns trigger
language plpgsql as $$
begin
  new.user_email := null;
  return new;
end$$;
drop trigger if exists trg_strip_comment_email on public.comments;
create trigger trg_strip_comment_email
  before insert or update on public.comments
  for each row execute function public._strip_comment_email();

-- faction_applications
create or replace function public._strip_fa_email() returns trigger
language plpgsql as $$
begin
  new.owner_email := null;
  return new;
end$$;
drop trigger if exists trg_strip_fa_email on public.faction_applications;
create trigger trg_strip_fa_email
  before insert or update on public.faction_applications
  for each row execute function public._strip_fa_email();

-- faction_economy
create or replace function public._strip_eco_email() returns trigger
language plpgsql as $$
begin
  new.owner_email := null;
  return new;
end$$;
drop trigger if exists trg_strip_eco_email on public.faction_economy;
create trigger trg_strip_eco_email
  before insert or update on public.faction_economy
  for each row execute function public._strip_eco_email();

-- characters
create or replace function public._strip_char_email() returns trigger
language plpgsql as $$
begin
  new.owner_email := null;
  return new;
end$$;
drop trigger if exists trg_strip_char_email on public.characters;
create trigger trg_strip_char_email
  before insert or update on public.characters
  for each row execute function public._strip_char_email();

-- factions (старый RP-слой) — если таблица есть
do $$
begin
  execute 'create or replace function public._strip_factions_email() returns trigger
    language plpgsql as $f$ begin new.owner_email := null; return new; end $f$';
  execute 'drop trigger if exists trg_strip_factions_email on public.factions';
  execute 'create trigger trg_strip_factions_email before insert or update on public.factions
    for each row execute function public._strip_factions_email()';
exception when undefined_table or undefined_column then null;
end$$;

-- faction_news: owner_email — всегда; reviewed_by/verdict_by — только email
create or replace function public._strip_news_email() returns trigger
language plpgsql as $$
begin
  new.owner_email := null;
  if new.reviewed_by like '%@%' then new.reviewed_by := null; end if;
  if new.verdict_by  like '%@%' then new.verdict_by  := null; end if;
  return new;
end$$;
drop trigger if exists trg_strip_news_email on public.faction_news;
create trigger trg_strip_news_email
  before insert or update on public.faction_news
  for each row execute function public._strip_news_email();

-- ────────────────────────────────────────────────────────────
-- Финальный аудит (всё должно вернуть 0):
--   select count(*) from public.pages    where created_by like '%@%';
--   select count(*) from public.comments where user_email is not null;
--   select count(*) from public.faction_applications where owner_email is not null;
--   select count(*) from public.faction_economy      where owner_email is not null;
--   select count(*) from public.characters           where owner_email is not null;
--   select count(*) from public.faction_news where owner_email is not null
--       or reviewed_by like '%@%' or verdict_by like '%@%';
-- И проверка гостём (anon key, без токена):
--   /rest/v1/public_profiles?select=*        → есть имена/аватары, НЕТ email
--   /rest/v1/profiles?select=*               → пусто (RLS)
-- ============================================================
