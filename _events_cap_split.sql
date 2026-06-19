-- ============================================================
-- ЛЕНТА СЕКТОРА: раздельная обрезка (достижения vs остальное)
--
-- Проблема: старый _cap_events (см. _events_cap10.sql) обрезал ВСЕ авто-события
-- (owner_id null) до 10 самых свежих. Достижения публикуются пачками и всегда
-- самые свежие → физически вытесняли из БД слухи, сводки и события мира.
--
-- Решение: считаем две корзины отдельно по префиксу заголовка
--   • достижения  (title LIKE '🏆 Достижение:%')  — держим 20 свежих
--   • остальное   (слухи + сводки + хроника мира)  — держим 15 свежих
-- Клиент сворачивает все достижения в одну сводку, поэтому 20 строк ачивок
-- не мешают, а 15 «настоящих» событий всегда остаются видимыми.
--
-- Выполнить в Supabase → SQL Editor один раз. Идемпотентно.
-- ============================================================

create or replace function public._cap_events()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if NEW.owner_id is null then
    -- Корзина «достижения»: держим 20 свежих
    delete from public.faction_news
      where owner_id is null and title like '🏆 Достижение:%'
        and id not in (
          select id from public.faction_news
            where owner_id is null and title like '🏆 Достижение:%'
            order by created_at desc limit 20);
    -- Корзина «остальные авто-события»: держим 15 свежих
    delete from public.faction_news
      where owner_id is null and (title is null or title not like '🏆 Достижение:%')
        and id not in (
          select id from public.faction_news
            where owner_id is null and (title is null or title not like '🏆 Достижение:%')
            order by created_at desc limit 15);
  end if;
  return null;
end$$;

drop trigger if exists trg_cap_events on public.faction_news;
create trigger trg_cap_events
  after insert on public.faction_news
  for each row execute function public._cap_events();

-- Разовая обрезка текущей ленты по тем же правилам
delete from public.faction_news
  where owner_id is null and title like '🏆 Достижение:%'
    and id not in (
      select id from public.faction_news
        where owner_id is null and title like '🏆 Достижение:%'
        order by created_at desc limit 20);
-- (остальные авто-события сейчас не трогаем разово — их и так почти не осталось;
--  новые будут копиться до лимита 15 сами)
