-- ПРОБА БЕЗ НАКАТА: заводим бой ангела в системе, где стоят крылья, зовём
-- расстановку воинства и смотрим, что реально встало на доску.
do $$
declare af text; foe text; sys text; bid uuid; r jsonb; u record;
begin
  select faction_id into af from public.angel_state where fell_at is null limit 1;
  select f.system_id into sys from public.fleets f
    join public.angel_guard g on g.fleet_id = f.id
   where g.role = 'escort' and g.dead_at is null and f.system_id is not null limit 1;
  select defender_fid into foe from public.wars
   where attacker_fid = af and status = 'active' limit 1;
  raise notice 'ангел=% система=% враг=%', af, sys, foe;

  insert into public.battles(system_id, attacker_fid, defender_fid, status)
    values (sys, af, foe, 'forming') returning id into bid;

  -- Крылья в бой, как это делает _war_sweep.
  insert into public.battle_fleets(battle_id, fleet_id, fid, side)
    select bid, f.id, af, 'attacker' from public.fleets f
     where f.faction_id = af and f.system_id = sys;

  r := public._angel_guard_deploy(bid);
  raise notice 'РАССТАНОВКА: %', r;

  for u in select unit_name, cls, x, y, hp, armor, dmg, rng, speed, pd, wings,
                  jsonb_array_length(coalesce(acts,'[]'::jsonb)) nacts,
                  (select sum((w->>'dmg')::numeric * (w->>'shots')::int)
                     from jsonb_array_elements(wpn) w) salvo,
                  pk->>'kd' kd
             from public.battle_units where battle_id = bid order by unit_name
  loop
    raise notice '  % [%] гекс %:% hp=% бр=% залп=% rng=% ск=% пво=% звено=% действий=%',
      u.unit_name, u.kd, u.x, u.y, u.hp, u.armor, u.salvo, u.rng, u.speed, u.pd, u.wings, u.nacts;
  end loop;

  raise notice 'ИТОГО бортов на доске: %, суммарный залп: %',
    (select count(*) from public.battle_units where battle_id = bid),
    (select sum((select sum((w->>'dmg')::numeric * (w->>'shots')::int)
                   from jsonb_array_elements(wpn) w))
       from public.battle_units where battle_id = bid);
end$$;
