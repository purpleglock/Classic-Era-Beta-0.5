-- ════════════════════════════════════════════════════════════
-- СНЯТЬ КЛЕЙМО С ЧУЖОЙ ВЕРЫ (разовая правка данных, 17.08)
-- Обряд ставил клеймо на ЛЮБОЕ членство державы в вере, а не на её
-- собственную (починено в _precursor_legacy.sql / _precursor_anchor.sql).
-- «Мета-авраамизм» основан не тем, кто служил обряды: оба обряда на её счету —
-- чужие. Клеймо снимается, счёт обнуляется.
-- ════════════════════════════════════════════════════════════
update public.faiths
   set stigma = 0, stigma_at = null
 where id = '2082dc67-fdc6-4353-9422-7fb18bea995e'
   and not exists (
     select 1 from public.primitive_acts a
      join public.faith_membership m
        on m.faction_id = a.faction_id and m.role = 'founder'
       and m.faith_id = public.faiths.id
     where a.action = 'rite');
