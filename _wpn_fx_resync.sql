-- Паспорта в УЖЕ заведённых боях собраны до появления ключа fx: пока их не
-- пересобрать, старая доска продолжит стрелять почерком по каналу (клиент это
-- переживёт — рельсотрон там просто останется болванкой). Пересобираем
-- незакрытые бои; законченные трогать незачем.
update public.battle_units bu
   set wpn = coalesce(public._bt_stats(bu.unit_id)->'wpn', bu.wpn)
  from public.battles b
 where b.id = bu.battle_id
   and b.status <> 'done'
   and bu.unit_id is not null;
