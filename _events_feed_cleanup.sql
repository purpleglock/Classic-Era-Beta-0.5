-- ============================================================
-- ЛЕНТА СЕКТОРА: чистка исторического мусора + лимиты
--
-- Что было не так: бэкфилл (_backfill_events_keep_ach.sql и повтор в
-- _events_cap_colony.sql) насыпал в ленту ИСТОРИЮ из таблиц — по слуху на
-- КАЖДУЮ давнюю шпионскую операцию (формат «Ограбление казны: <фракция>»,
-- по 5 раз на одну цель) и кучу старых сводок. Это дублировало живой механизм:
-- слухи и так постятся сами при завершении операции (_covert_rumors_trigger.sql,
-- формат «… в районе системы X»), сводки — триггерами _sector_bulletins.sql.
--
-- Решение:
--   1) Снести бэкфилл-слухи (вся корзина «⚠ СЕКТОРНЫЕ СЛУХИ») — пусть лента
--      наполняется ТОЛЬКО живыми событиями по мере игры.
--   2) Урезать лимиты хранения: достижения 10, колонизации 8, остальное 15.
--   3) Бэкфилл слухов БОЛЬШЕ НЕ ДЕЛАЕМ (этот файл его не повторяет).
--
-- Выполнить в Supabase → SQL Editor ОДИН РАЗ. Идемпотентно.
-- Заменяет триггер из _events_cap_colony.sql.
-- ============================================================

-- ── 1) Снести весь исторический бэкфилл-мусор слухов ─────────
-- Живые слухи пойдут заново сами (_post_covert_rumor при резолве операций).
delete from public.faction_news
  where owner_id is null and faction_name = '⚠ СЕКТОРНЫЕ СЛУХИ';

-- ── 2) Триггер обрезки: три корзины с урезанными лимитами ────
create or replace function public._cap_events()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if NEW.owner_id is null then
    -- достижения: 10 свежих
    delete from public.faction_news
      where owner_id is null and title like '🏆 Достижение:%'
        and id not in (
          select id from public.faction_news
            where owner_id is null and title like '🏆 Достижение:%'
            order by created_at desc limit 10);
    -- колонизации: 8 свежих
    delete from public.faction_news
      where owner_id is null and title like 'Колонизация:%'
        and id not in (
          select id from public.faction_news
            where owner_id is null and title like 'Колонизация:%'
            order by created_at desc limit 8);
    -- остальное (экспансия / новые государства / вера / союзы / слухи): 15 свежих
    delete from public.faction_news
      where owner_id is null
        and (title is null or (title not like '🏆 Достижение:%' and title not like 'Колонизация:%'))
        and id not in (
          select id from public.faction_news
            where owner_id is null
              and (title is null or (title not like '🏆 Достижение:%' and title not like 'Колонизация:%'))
            order by created_at desc limit 15);
  end if;
  return null;
end$$;

drop trigger if exists trg_cap_events on public.faction_news;
create trigger trg_cap_events
  after insert on public.faction_news
  for each row execute function public._cap_events();

-- ── 3) Разовая обрезка по новым лимитам ─────────────────────
delete from public.faction_news
  where owner_id is null and title like '🏆 Достижение:%'
    and id not in (select id from public.faction_news
      where owner_id is null and title like '🏆 Достижение:%'
      order by created_at desc limit 10);
delete from public.faction_news
  where owner_id is null and title like 'Колонизация:%'
    and id not in (select id from public.faction_news
      where owner_id is null and title like 'Колонизация:%'
      order by created_at desc limit 8);
delete from public.faction_news
  where owner_id is null
    and (title is null or (title not like '🏆 Достижение:%' and title not like 'Колонизация:%'))
    and id not in (select id from public.faction_news
      where owner_id is null
        and (title is null or (title not like '🏆 Достижение:%' and title not like 'Колонизация:%'))
      order by created_at desc limit 15);

-- ── Проверка ────────────────────────────────────────────────
-- select case when title like '🏆 Достижение:%' then 'ach'
--             when title like 'Колонизация:%'    then 'colony'
--             else 'other' end as bucket, count(*)
--   from public.faction_news where owner_id is null group by 1;
