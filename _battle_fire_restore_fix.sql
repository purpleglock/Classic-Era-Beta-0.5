-- Откат регресса батарей + синхронизация стойкостей.
-- 1) Убрать грубую обёртку (умный battle_fire восстановит перекат _war_battle_tactics.sql).
drop function if exists public.battle_fire_battery(uuid,uuid,uuid,int);

-- 2) Синхронизировать summary.armor_resist с ЖИВЫМИ стойкостями сплава.
-- Правильный battle_fire читает t.resist (сеется из summary.armor_resist при высадке).
-- После правок алхимии сплавы пересчитаны, но summary юнитов заморожен → чиним зеркало,
-- чтобы уязвимости появились в бою без полной перепубликации.
update public.faction_units u
   set summary = jsonb_set(coalesce(u.summary,'{}'::jsonb), '{armor_resist}', a.stats->'resist')
  from public.faction_armor_alloys a
 where a.id = nullif(u.data->>'armorAlloyId','')::uuid
   and u.summary is not null;

-- 3) Обновить resist уже высаженных юнитов в АКТИВНЫХ боях (иначе слабость только у новых).
update public.battle_units bu
   set resist = a.stats->'resist'
  from public.faction_units u
  join public.faction_armor_alloys a on a.id = nullif(u.data->>'armorAlloyId','')::uuid
 where bu.unit_id = u.id and bu.alive;
