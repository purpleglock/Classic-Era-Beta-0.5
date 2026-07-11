-- ============================================================
-- РАЗОВЫЙ СРЕЗ: откат «тысяч товаров», раздутых багом добора
-- Применять в Supabase → SQL Editor ПОСЛЕ обновлённого
-- _budget_wellbeing.sql (в нём добор капирован 3 сутками).
--
-- Что случилось: первый economy_accrue после включения авто-добычи
-- всех залежей и фабрик товаров начислил rate × d за ВСЕ дни с
-- last_tick (d не был ограничен) — склады взлетели до капа.
--
-- Что делает срез: для каждой фракции считает её СУТОЧНЫЙ поток
-- по новой механике (авто-добыча всех залежей × слоты/3; товары
-- 10/слот) и режет склад ТОЛЬКО по тем ресурсам, которые фракция
-- сама добывает/производит, до потолка greatest(300, поток × 3).
-- Купленное/переданное (ресурсы без своей добычи) НЕ трогает.
-- Идемпотентно: повторный запуск ничего больше не срежет.
-- ============================================================
do $$
declare
  f record; bld record; relem jsonb; rname text; rr text; rate numeric;
  flow jsonb; gf_slots numeric; k text; cur numeric; lim numeric;
  res jsonb; changed boolean;
begin
  for f in select faction_id, resources from public.faction_economy
           where resources is not null and resources <> '{}'::jsonb
  loop
    -- суточный поток добычи по каждой залежи (зеркало economy_accrue)
    flow := '{}'::jsonb;
    for bld in
      select cb.slots_open, c.resources as cres
      from public.colony_buildings cb
      join public.colonies c on c.id = cb.colony_id
      where cb.faction_id = f.faction_id and cb.btype = 'mining'
        and c.resources is not null and jsonb_array_length(c.resources) > 0
    loop
      for relem in select value from jsonb_array_elements(bld.cres) loop
        rname := relem->>'name';
        if rname is null then continue; end if;
        rr := coalesce(relem->>'r','common');
        rate := case rr when 'uncommon' then 12 when 'rare' then 6 when 'epic' then 3 when 'legendary' then 1 else 25 end;
        rate := greatest(1, round(rate * public._richness_mult(relem->>'amt')
                                       * greatest(1, coalesce(bld.slots_open,1)) / 3.0));
        flow := jsonb_set(flow, array[rname],
                  to_jsonb(coalesce((flow->>rname)::numeric,0) + rate), true);
      end loop;
    end loop;

    -- товары: суточное производство фабрик
    select coalesce(sum(slots_open),0) into gf_slots
      from public.colony_buildings where faction_id = f.faction_id and btype='goodsfab';
    if gf_slots > 0 then
      flow := jsonb_set(flow, array['Товары'], to_jsonb(10 * gf_slots), true);
    end if;

    -- срез: только добываемые/производимые ресурсы, потолок = max(300, 3 сут потока)
    res := f.resources; changed := false;
    for k in select jsonb_object_keys(flow) loop
      cur := coalesce((res->>k)::numeric, 0);
      lim := greatest(300, (flow->>k)::numeric * 3);
      if cur > lim then
        res := jsonb_set(res, array[k], to_jsonb(lim), true);
        changed := true;
      end if;
    end loop;

    if changed then
      update public.faction_economy set resources = res where faction_id = f.faction_id;
    end if;
  end loop;
end $$;
