-- ════════════════════════════════════════════════════════════
-- 17.08 «ПРОЕКТ КОРАБЛЯ НЕ НАЙДЕН» на расстановке боя с Легионом.
-- Карточка в доске показывала «0 корп · 0 урон · null гекс», а высадка падала:
-- _bt_stats(unit_id) возвращал null.
--
-- Причина не в бою и не в Легионе: в составах ФЛОТОВ висели unit_id проектов,
-- которых в faction_units больше нет — проект переопубликовали, он получил
-- новый id, а composition остался ссылаться на мёртвый. Флот при этом выглядел
-- целым (имя и количество лежат прямо в composition), поэтому поломка всплывала
-- только в бою — то есть ровно тогда, когда всё решается.
--
-- Битых ссылок нашлось 6 у двух держав, и у каждой есть точный двойник по имени
-- в той же фракции — перевязываем на него. Количество и имя не трогаем.
-- ЦЕПОЧКА: разовый ремонт. Повторный прогон безвреден (правит только мёртвые).
-- ════════════════════════════════════════════════════════════

with bad as (
  select f.id fleet_id,
         jsonb_agg(
           case when exists (select 1 from public.faction_units u
                              where u.id = (c->>'unit_id')::uuid)
                then c
                else c || jsonb_build_object('unit_id',
                       (select u2.id::text from public.faction_units u2
                         where u2.faction_id = f.faction_id
                           and u2.name = c->>'unit_name'
                         limit 1))
           end
           order by ord) comp,
         bool_or(not exists (select 1 from public.faction_units u3
                              where u3.id = (c->>'unit_id')::uuid)
                 and exists (select 1 from public.faction_units u4
                              where u4.faction_id = f.faction_id
                                and u4.name = c->>'unit_name')) fixed
    from public.fleets f,
         lateral jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) with ordinality t(c, ord)
   group by f.id
)
update public.fleets f
   set composition = bad.comp
  from bad
 where f.id = bad.fleet_id and bad.fixed;

-- Проверка: должно вернуть 0 строк.
select f.name fleet, c->>'unit_name' un
  from public.fleets f, jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
 where not exists (select 1 from public.faction_units u where u.id = (c->>'unit_id')::uuid);
