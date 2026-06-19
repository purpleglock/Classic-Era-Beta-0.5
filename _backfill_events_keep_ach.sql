-- ============================================================
-- РАЗОВЫЙ БЭКФИЛЛ ЛЕНТЫ СЕКТОРА ИЗ РЕАЛЬНОЙ ИСТОРИИ (СОХРАНЯЯ АЧИВКИ)
--
-- Как _backfill_events_history.sql, но НЕ удаляет анонсы достижений
-- (title «🏆 Достижение: …») — они не переанонсируются (announced=true),
-- поэтому их терять нельзя. Сносим только слухи/сводки и пересобираем из:
--   • появление фракций       (faction_applications.created_at)
--   • колонизация планет        (colonies.created_at)
--   • прошлые тайные действия   (spy_missions.created_at)
--
-- Требует _fac_name. ВЫПОЛНИТЬ ПОСЛЕ _events_cap_split.sql.
-- Идемпотентно: можно перезапускать.
-- ============================================================

-- Сносим авто-события (owner_id null) КРОМЕ достижений и пересоздаём из реальных таблиц.
delete from public.faction_news
  where owner_id is null and (title is null or title not like '🏆 Достижение:%');

-- 1) Появление государств — реальная дата одобрения
insert into public.faction_news
  (faction_id, faction_name, faction_color, owner_id, owner_email, title, excerpt, body, status, kind, published_at, created_at, updated_at)
select null, '◈ СВОДКА СЕКТОРА', fa.color, null, null,
  'Новое государство: ' || fa.name, null,
  format('На карте сектора заявило о себе государство %s. Дипломаты пересматривают расстановку сил.', fa.name),
  'approved', 'bulletin',
  coalesce(fa.created_at, fa.updated_at, now()), coalesce(fa.created_at, fa.updated_at, now()), now()
from public.faction_applications fa
where fa.status = 'approved';

-- 2) Колонизация планет — реальная дата основания колонии
insert into public.faction_news
  (faction_id, faction_name, faction_color, owner_id, owner_email, title, excerpt, body, status, kind, published_at, created_at, updated_at)
select null, '◈ СВОДКА СЕКТОРА',
  coalesce((select color from public.faction_applications where faction_id=c.faction_id and status='approved' limit 1), 'rgba(95,176,230,0.5)'),
  null, null,
  'Колонизация: ' || coalesce(c.planet_name,'планета') || ' — ' || coalesce(public._fac_name(c.faction_id),'фракция'),
  null,
  format('%s закрепилась на планете %s. Сектор прирастает новыми владениями.',
    coalesce(public._fac_name(c.faction_id),'Одна из фракций'), coalesce(c.planet_name,'—')),
  'approved', 'bulletin',
  coalesce(c.created_at, now()), coalesce(c.created_at, now()), now()
from public.colonies c
where c.faction_id is not null;

-- 3) Прошлые тайные операции-ДЕЙСТВИЯ → слухи (реальная дата, реальная цель)
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
