-- ════════════════════════════════════════════════════════════
-- ТТХ КОРАБЛЯ В РЕЗЕРВЕ: огневые группы и помехозащищённость
-- ────────────────────────────────────────────────────────────
-- На телефоне игрок выбирает борт для расстановки по карточке резерва, а в
-- ней из ТТХ было видно только корпус и урон: «чем именно бьёт», сколько
-- стволов и на какую дальность каждая группа — узнать было негде, пока
-- корабль не окажется на доске. Сама раскладка орудий у _bt_stats уже есть
-- ('wpn'), просто battle_pool её не переносил. Добавляем 'wpn' и 'eccm' —
-- остальное тело функции слово в слово прежнее.
-- ════════════════════════════════════════════════════════════

create or replace function public.battle_pool(p_battle uuid, p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare res jsonb := '[]'::jsonb; r record; used int; st jsonb;
begin
  -- админский полный каталог (весь опубликованный ship-парк, сорт. по классу) —
  -- ТОЛЬКО для СВОЕЙ стороны стаффа. Для бота (и любой чужой стороны) считаем
  -- обычный резерв флотов (пустой), иначе _bt_check_end видел бы у бота
  -- неисчерпаемый резерв и бой не завершался бы после уничтожения всех его кораблей.
  if public._bt_admin_full(p_battle) and p_fid = public._ec_my_fid() then
    select coalesce(jsonb_agg(x order by rnk, nm), '[]'::jsonb) into res from (
      select public._bt_cls_rank(s.st->>'cls') as rnk,
             coalesce(s.st->>'name','Корабль') as nm,
             jsonb_build_object(
               'unit_id', fu.id, 'unit_name', coalesce(s.st->>'name','Корабль'), 'free', 99,
               'cost', coalesce((fu.summary->>'cost')::numeric, 0),
               'cls', s.st->>'cls', 'hp', s.st->'hp', 'dmg', s.st->'dmg',
               'speed', s.st->'speed', 'rng', s.st->'rng',
               'shield', s.st->'shield', 'armor', s.st->'armor', 'sensor', s.st->'sensor',
               'stealth', s.st->'stealth', 'cargo', s.st->'cargo', 'crew', s.st->'crew',
               'pd', s.st->'pd', 'jam', s.st->'jam', 'dejam', s.st->'dejam',
               'eccm', s.st->'eccm', 'wpn', coalesce(s.st->'wpn', '[]'::jsonb),
               'interdict', s.st->'interdict', 'stabil', s.st->'stabil', 'ftl', s.st->'ftl',
               'wings', s.st->'wings') as x
        from public.faction_units fu
        cross join lateral (select public._bt_stats(fu.id) as st) s
       where fu.category = 'ship'
         and coalesce((fu.summary->>'hp')::numeric, 0) > 0
         and s.st is not null
    ) q;
    return res;
  end if;

  -- обычный резерв: корабли скованных боем флотов минус выставленное
  for r in
    select (c->>'unit_id')::uuid as uid,
           coalesce(c->>'unit_name','Корабль') as nm,
           sum(greatest(0, coalesce((c->>'qty')::int,0))) as qty
      from public.battle_fleets bf
      join public.fleets f on f.id = bf.fleet_id
      cross join lateral jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
     where bf.battle_id = p_battle and bf.fid = p_fid
       and nullif(c->>'unit_id','') is not null
     group by 1,2
  loop
    select count(*) into used from public.battle_units
      where battle_id = p_battle and fid = p_fid and unit_id = r.uid;
    if r.qty - used <= 0 then continue; end if;
    st := public._bt_stats(r.uid);
    res := res || jsonb_build_array(jsonb_build_object(
      'unit_id', r.uid, 'unit_name', r.nm, 'free', r.qty - used,
      'cost', (select coalesce((fu.summary->>'cost')::numeric, 0)
                 from public.faction_units fu where fu.id = r.uid),
      'cls', st->>'cls', 'hp', st->'hp', 'dmg', st->'dmg',
      'speed', st->'speed', 'rng', st->'rng',
      'shield', st->'shield', 'armor', st->'armor', 'sensor', st->'sensor',
      'stealth', st->'stealth', 'cargo', st->'cargo', 'crew', st->'crew',
      'pd', st->'pd', 'jam', st->'jam', 'dejam', st->'dejam',
      'eccm', st->'eccm', 'wpn', coalesce(st->'wpn', '[]'::jsonb),
      'interdict', st->'interdict', 'stabil', st->'stabil', 'ftl', st->'ftl',
      'wings', st->'wings'));
  end loop;
  return res;
end$$;
revoke all on function public.battle_pool(uuid,text) from public;
grant execute on function public.battle_pool(uuid,text) to authenticated;

notify pgrst, 'reload schema';
