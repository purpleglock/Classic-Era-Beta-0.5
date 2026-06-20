-- ============================================================
-- ЛЕНТА СЕКТОРА: отдельная корзина для колонизаций + возврат хроники
--
-- Проблема: _cap_events (см. _events_cap_split.sql) держал ДВЕ корзины —
-- достижения (20) и «всё остальное» (15). Бэкфилл создаёт по сводке на КАЖДУЮ
-- колонию (см. _backfill_events_keep_ach.sql), колоний десятки, и они свежие →
-- на каждой вставке триггер оставлял 15 самых новых «остальных», а это
-- колонизации. Они физически вытеснили из БД сводки «новое государство»,
-- экспансии, слухи и хронику мира. В ленте оставалась только колонизация.
--
-- Решение: ТРИ корзины по префиксу заголовка
--   • достижения  (title LIKE '🏆 Достижение:%')  — 20 свежих
--   • колонизации (title LIKE 'Колонизация:%')     — 12 свежих
--   • остальное   (экспансия / новые государства / вера / союзы / слухи) — 15
-- Клиент сворачивает достижения и колонизации в сводки, поэтому 20+12 строк
-- не мешают, а 15 «разнообразных» событий всегда видны.
--
-- Плюс разовый возврат вытесненной хроники: пересоздаём сводки «новое
-- государство» и слухи из реальных таблиц (колонизации не трогаем — они на месте).
--
-- Выполнить в Supabase → SQL Editor ОДИН РАЗ. Идемпотентно.
-- Требует: faction_news, faction_applications, spy_missions, _fac_name.
-- ============================================================

-- ── 1) Новый триггер обрезки: три корзины ───────────────────
create or replace function public._cap_events()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if NEW.owner_id is null then
    -- Корзина «достижения»: 20 свежих
    delete from public.faction_news
      where owner_id is null and title like '🏆 Достижение:%'
        and id not in (
          select id from public.faction_news
            where owner_id is null and title like '🏆 Достижение:%'
            order by created_at desc limit 20);
    -- Корзина «колонизации»: 12 свежих
    delete from public.faction_news
      where owner_id is null and title like 'Колонизация:%'
        and id not in (
          select id from public.faction_news
            where owner_id is null and title like 'Колонизация:%'
            order by created_at desc limit 12);
    -- Корзина «остальное»: 15 свежих (всё, что не достижение и не колонизация)
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

-- ── 2) Возврат вытесненной хроники (всё, кроме колонизаций и достижений) ──
-- Сносим текущую «остальную» корзину и пересобираем из реальных таблиц.
-- Колонизации и достижения НЕ трогаем — они уже в своих корзинах.
delete from public.faction_news
  where owner_id is null
    and (title is null or (title not like '🏆 Достижение:%' and title not like 'Колонизация:%'));

-- 2a) Появление государств — реальная дата одобрения
insert into public.faction_news
  (faction_id, faction_name, faction_color, owner_id, owner_email, title, excerpt, body, status, kind, published_at, created_at, updated_at)
select null, '◈ СВОДКА СЕКТОРА', fa.color, null, null,
  'Новое государство: ' || fa.name, null,
  format('На карте сектора заявило о себе государство %s. Дипломаты пересматривают расстановку сил.', fa.name),
  'approved', 'bulletin',
  coalesce(fa.created_at, fa.updated_at, now()), coalesce(fa.created_at, fa.updated_at, now()), now()
from public.faction_applications fa
where fa.status = 'approved';

-- 2b) Прошлые тайные операции-действия → слухи (реальная дата, реальная цель)
insert into public.faction_news
  (faction_id, faction_name, faction_color, owner_id, owner_email, title, excerpt, body, status, kind, published_at, created_at, updated_at)
select null, '⚠ СЕКТОРНЫЕ СЛУХИ', 'rgba(150,160,180,0.55)', null, null,
  case m.op
    when 'steal_gc'    then 'Ограбление казны: '   || coalesce(public._fac_name(m.target_fid),'фракция')
    when 'sabotage'    then 'Диверсия у '          || coalesce(public._fac_name(m.target_fid),'фракции')
    when 'destabilize' then 'Волнения у '          || coalesce(public._fac_name(m.target_fid),'фракции')
    when 'steal_tech'  then 'Утечка технологий у '  || coalesce(public._fac_name(m.target_fid),'фракции')
  end, null,
  case m.op
    when 'steal_gc'    then format('По слухам, со счетов %s ночью исчезла крупная сумма. Очевидцы говорят о людях без опознавательных знаков.', coalesce(public._fac_name(m.target_fid),'одной из фракций'))
    when 'sabotage'    then format('Свидетели сообщают о взрыве на одном из объектов %s. Официально — «авария», но очевидцы уверены в диверсии.', coalesce(public._fac_name(m.target_fid),'одной из фракций'))
    when 'destabilize' then format('Поговаривают о перебоях и нарастающем хаосе в делах %s. Чужая рука?', coalesce(public._fac_name(m.target_fid),'одной из фракций'))
    when 'steal_tech'  then format('Ходят слухи об утечке закрытых разработок у %s — кто-то вынес нечто ценное.', coalesce(public._fac_name(m.target_fid),'одной из фракций'))
  end,
  'approved', 'rumor',
  coalesce(m.created_at, now()), coalesce(m.created_at, now()), now()
from public.spy_missions m
where m.op in ('steal_gc','sabotage','destabilize','steal_tech') and m.status = 'done';

-- ── 3) Разовая обрезка по новым лимитам ─────────────────────
delete from public.faction_news
  where owner_id is null and title like '🏆 Достижение:%'
    and id not in (select id from public.faction_news
      where owner_id is null and title like '🏆 Достижение:%'
      order by created_at desc limit 20);
delete from public.faction_news
  where owner_id is null and title like 'Колонизация:%'
    and id not in (select id from public.faction_news
      where owner_id is null and title like 'Колонизация:%'
      order by created_at desc limit 12);
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
