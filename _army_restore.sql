-- ============================================================
-- ТОЧЕЧНЫЙ РЕМОНТ v2 (2026-07-14): вернуть состав пустой армии.
-- ПОЛНОСТЬЮ АВТОМАТИЧЕСКИЙ: запусти целиком, ничего вставлять не надо.
-- Берёт у фракции пустой армии САМЫЙ СВЕЖИЙ чертёж дивизии и заполняет
-- армию его составом ×1. Если чертёж не тот — скажи, поправим точечно.
-- ============================================================

do $$
declare
  a record; des record; blk jsonb; u record; cnt int; newcomp jsonb;
begin
  for a in select * from public.armies
           where coalesce(composition,'[]'::jsonb) = '[]'::jsonb loop
    -- самый свежий чертёж дивизии этой фракции
    select * into des from public.faction_units
      where category = 'division' and faction_id = a.faction_id
      order by updated_at desc nulls last limit 1;
    if not found then
      raise notice 'армия % (%): у фракции % нет чертежей дивизий — пропуск',
        a.id, coalesce(a.name,'-'), a.faction_id;
      continue;
    end if;

    newcomp := '[]'::jsonb;
    for blk in select value from jsonb_array_elements(coalesce(des.data->'blocks','[]'::jsonb)) loop
      select * into u from public._div_block_unit(blk->>'modelId');
      if u.o_id is not null then
        cnt := greatest(0, coalesce((blk->>'count')::int, 0));
        if cnt > 0 then
          newcomp := newcomp || jsonb_build_object(
            'unit_id', u.o_id::text, 'unit_name', u.o_name, 'category', u.o_cat, 'qty', cnt);
        end if;
      end if;
    end loop;

    if newcomp = '[]'::jsonb then
      raise notice 'армия % (%): чертёж «%» пуст — пропуск', a.id, coalesce(a.name,'-'), des.name;
      continue;
    end if;
    update public.armies set composition = newcomp where id = a.id;
    raise notice 'армия % (%): восстановлена по чертежу «%» → %',
      a.id, coalesce(a.name,'-'), des.name, newcomp;
  end loop;
end$$;

-- Контроль: у армий должен появиться состав
select id, name, faction_id,
       (select coalesce(sum((c->>'qty')::int),0)
        from jsonb_array_elements(coalesce(composition,'[]'::jsonb)) c) as units
from public.armies;
