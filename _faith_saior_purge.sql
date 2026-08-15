-- ============================================================
-- САЙОРИАНСТВО: РОСПУСК ВЕРЫ И ВОЗВРАТ ЗА ХРАМЫ
-- Вера основателя (Микустан) исчезла вместе с удалённой фракцией;
-- по FK `on delete set null` её храмы остались в colony_buildings с
-- faith_id = null — стоят «мёртвыми»: дохода не дают, метки веры нет.
-- Накат сносит осиротевшие храмы и возвращает владельцам ПОЛНУЮ
-- вложенную стоимость (база + лестница платных слотов), без деления
-- пополам как при обычном сносе: снос не по вине владельцев.
-- Одноразовый; повторный прогон безвреден (сносить будет нечего).
-- ============================================================
begin;

-- ── 1) Снимок сносимого (id + полная вложенная цена) ────────
create temp table _saior_purge on commit drop as
select b.id, b.faction_id, b.slots_open,
       public._ec_build_cost(b.faction_id, public._ec_bld_base('temple'))
       + coalesce((
           select sum(public._ec_build_cost(b.faction_id, public._ec_bld_ladder('temple', i)))
           from generate_series(public._ec_bld_free('temple'), b.slots_open - 1) i
           where b.slots_open > public._ec_bld_free('temple')
         ), 0) as refund
from public.colony_buildings b
where b.btype = 'temple' and b.faith_id is null;

-- ── 2) Незавершённые слот-проекты этих храмов: вернуть вложенное ──
create temp table _saior_proj on commit drop as
with del as (
  delete from public.colony_projects p
   where p.kind = 'slot' and p.building_id in (select id from _saior_purge)
  returning p.faction_id, coalesce((p.payload->>'spent_gc')::numeric, 0) as gc
)
select faction_id, sum(gc) as gc from del group by 1;

-- ── 3) Снос храмов ──────────────────────────────────────────
delete from public.colony_buildings where id in (select id from _saior_purge);

-- ── 4) Возврат ГС владельцам ────────────────────────────────
create temp table _saior_pay on commit drop as
select faction_id, sum(gc) as gc from (
  select faction_id, refund as gc from _saior_purge
  union all
  select faction_id, gc from _saior_proj
) t group by 1;

update public.faction_economy e
   set gc = e.gc + p.gc
  from _saior_pay p
 where p.faction_id = e.faction_id;

-- ── 5) Отчёт ────────────────────────────────────────────────
select p.faction_id,
       (select count(*) from _saior_purge s where s.faction_id = p.faction_id) as temples,
       p.gc as refunded,
       e.gc as gc_after
from _saior_pay p join public.faction_economy e on e.faction_id = p.faction_id
order by p.gc desc;

commit;
