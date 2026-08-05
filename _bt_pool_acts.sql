-- © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
-- ════════════════════════════════════════════════════════════
-- АКТИВНОЕ СНАРЯЖЕНИЕ ВИДНО В РЕЗЕРВЕ (battle_pool отдаёт acts)
-- ────────────────────────────────────────────────────────────
-- Кнопки-модули (29 штук) появились у бортов ещё в _bt_modules.sql, но узнать
-- о них можно было ТОЛЬКО после того, как борт уже стоит на доске: acts живут
-- в battle_units и приезжают с battle_state. На экране расстановки — где как
-- раз и решают, кого брать, — паспорт борта (ⓘ) о снаряжении молчал.
-- Особенно бьёт по бою с ботами: там резерв = весь опубликованный парк, и
-- «Гладиатор «Ноксий» с ядерной ракетой» ничем не отличался от пустого корвета.
--
-- Правка одна: в обе ветки battle_pool (админский полный каталог и обычный
-- резерв флотов) добавлено поле 'acts' = public._bt_acts_of(unit_id).
-- Тело собрано из ЖИВОГО prosrc — файл-источник (_battle_pool_wpn.sql и др.)
-- НЕ перекатывать, там версия без части полей.
--
-- ЦЕПОЧКА: ПОСЛЕ _bt_modules.sql / _bt_modules2.sql. Идемпотентно.
-- ════════════════════════════════════════════════════════════

-- ⚠ stable — как у живой версии: без явного слова функция стала бы volatile
--   (create or replace молча меняет изменчивость на дефолтную).
create or replace function public.battle_pool(p_battle uuid, p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $fn$
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
               'acts', coalesce(public._bt_acts_of(fu.id), '[]'::jsonb),
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
      'acts', coalesce(public._bt_acts_of(r.uid), '[]'::jsonb),
      'interdict', st->'interdict', 'stabil', st->'stabil', 'ftl', st->'ftl',
      'wings', st->'wings'));
  end loop;
  return res;
end$fn$;
grant execute on function public.battle_pool(uuid, text) to authenticated;
