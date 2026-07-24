-- ════════════════════════════════════════════════════════════════════════
--  ПОЛНОЕ УДАЛЕНИЕ ПОСТРОЙКИ «Товарная биржа» (btype='market') ИЗ ИГРЫ
-- ────────────────────────────────────────────────────────────────────────
--  Что делает (самодостаточно, применять ПОСЛЕ _security_money.sql):
--    1. Возвращает владельцам базовую стоимость каждой уже построенной биржи
--       (1500 ГС × число построек), чтобы удаление не было чистой потерей.
--    2. Удаляет все построенные биржи (colony_buildings) и все строящиеся
--       проекты биржи (colony_projects, kind='build', btype='market').
--    3. Ставит триггеры-заслоны: впредь ни постройку, ни проект btype='market'
--       вставить нельзя (economy_build и любой редактор получат исключение).
--       Заслон на colony_projects перехватывает economy_build ДО списания ГС
--       — новую биржу не построить, а справочник _ec_bld_base не трогаем
--       (он собран из нескольких слайсов; переопределение рискнуло бы потерять
--        другие btype).
--
--  Начисление дохода биржи в economy_accrue править НЕ нужно: оно суммирует
--  slots_open по colony_buildings btype='market'; после зачистки сумма = 0,
--  а новые биржи заблокированы триггером.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Возврат базовой стоимости владельцам построенных бирж (1500 ГС за штуку).
update public.faction_economy fe
set gc = fe.gc + sub.n * 1500
from (
  select faction_id, count(*) as n
  from public.colony_buildings
  where btype = 'market'
  group by faction_id
) sub
where fe.faction_id = sub.faction_id;

-- 2) Зачистка: построенные биржи и строящиеся проекты бирж.
delete from public.colony_buildings where btype = 'market';
delete from public.colony_projects  where kind = 'build' and btype = 'market';

-- 3) Заслон на будущее: запретить вставку биржи в оба места.
create or replace function public._block_market_building()
returns trigger language plpgsql as $$
begin
  if new.btype = 'market' then
    raise exception 'Товарная биржа удалена из игры';
  end if;
  return new;
end $$;

drop trigger if exists trg_block_market_building on public.colony_buildings;
create trigger trg_block_market_building
  before insert or update of btype on public.colony_buildings
  for each row execute function public._block_market_building();

drop trigger if exists trg_block_market_project on public.colony_projects;
create trigger trg_block_market_project
  before insert or update of btype on public.colony_projects
  for each row when (new.kind = 'build')
  execute function public._block_market_building();
