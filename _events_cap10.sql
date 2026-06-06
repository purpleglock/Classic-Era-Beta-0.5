-- ============================================================
-- ЛЕНТА СЕКТОРА: храним максимум 10 системных событий
-- Маленький триггер обрезает авто-события (owner_id null: слухи + сводки)
-- до 10 самых свежих после каждой вставки. Большие функции не трогаем.
-- Выполнить в Supabase → SQL Editor один раз. Идемпотентно.
-- ============================================================

-- Триггер-обрезка до 10 свежих авто-событий
create or replace function public._cap_events()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if NEW.owner_id is null then
    delete from public.faction_news
      where owner_id is null
        and id not in (select id from public.faction_news where owner_id is null
                       order by created_at desc limit 10);
  end if;
  return null;
end$$;

drop trigger if exists trg_cap_events on public.faction_news;
create trigger trg_cap_events
  after insert on public.faction_news
  for each row execute function public._cap_events();

-- Разовая обрезка текущей ленты до 10 свежих
delete from public.faction_news
  where owner_id is null
    and id not in (select id from public.faction_news where owner_id is null
                   order by created_at desc limit 10);
