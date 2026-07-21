-- _faith_orphan_fix.sql
-- ПРОБЛЕМА: загрузка экономики падала с 23503
--   Key (faith_id)=(…) is not present in table "faiths"
--   insert or update on "colony_buildings" violates "colony_buildings_faith_id_fkey"
-- ПРИЧИНА: храм в colony_buildings ссылался на удалённую веру (осиротевший faith_id).
--   economy_init/economy_tick делают UPDATE по зданиям → Postgres перепроверяет FK
--   на этой строке → не находит веру → валит весь запрос → экономика не грузится.
--   На проде висел старый FK БЕЗ on delete set null (_faith_multi.sql не накатан),
--   поэтому удаление веры не обнулило храмы.
--
-- Идемпотентно, безопасно гонять повторно.

-- 1) Чистка сирот: обнулить ссылки на несуществующие веры.
update public.colony_buildings cb
   set faith_id = null
 where cb.faith_id is not null
   and not exists (select 1 from public.faiths f where f.id = cb.faith_id);

-- faith_membership: faith_id входит в PK, обнулить нельзя — удаляем осиротевшие строки.
delete from public.faith_membership m
 where not exists (select 1 from public.faiths f where f.id = m.faith_id);

-- 2) Пересобрать FK храма с ON DELETE SET NULL (то, что должно было приехать
--    с _faith_multi.sql). Тогда удаление веры само обнулит храмы, а не оставит хвост.
alter table public.colony_buildings
  drop constraint if exists colony_buildings_faith_id_fkey;
alter table public.colony_buildings
  add  constraint colony_buildings_faith_id_fkey
  foreign key (faith_id) references public.faiths(id) on delete set null;
