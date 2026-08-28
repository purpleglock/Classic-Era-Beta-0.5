-- ============================================================
-- РЕЗЕРВ ДОСКИ: _bt_stats СЧИТАЕТСЯ ОДИН РАЗ НА БОРТ, А НЕ 25
-- Правил боя НЕ меняет: тот же список, те же ключи, тот же порядок.
-- ?v=20260828poolperf
--
-- БЫЛО (симптом): «БОЙ НЕДОСТУПЕН: CANCELING STATEMENT DUE TO STATEMENT
-- TIMEOUT» при открытии админ-боя с ботами. Замер под учёткой игрока:
-- battle_state 11.7 с, из них battle_pool 8.8 с (потолок authenticated — 8 с).
--
-- ПРИЧИНА: ветка админского полного каталога брала статы через
--   cross join lateral (select public._bt_stats(fu.id) as st) s
-- и потом ссылалась на `s.st` ДВАДЦАТЬ ПЯТЬ раз в jsonb_build_object плюс
-- ещё раз в ORDER BY через _bt_cls_rank. Функция объявлена STABLE с
-- procost 100, поэтому планировщик спокойно ВСТРАИВАЛ её в каждую ссылку:
-- один вызов _bt_stats по каталогу из 159 бортов стоит ~670 мс, а их
-- выходило больше двух десятков. Обычная ветка (резерв флотов) этим не
-- болела — там stats кладут в переменную.
--
-- СТАЛО: CTE с MATERIALIZED — гарантия, что _bt_stats и _bt_acts_of
-- посчитаются РОВНО ПО ОДНОМУ разу на борт. Плюс честная цена у _bt_stats,
-- чтобы планировщику и впредь не хотелось её размножать.
-- ============================================================

-- Цена вызова: внутри читает несколько таблиц, 100 — это заведомая ложь,
-- из-за которой её встраивают в каждую ссылку.
alter function public._bt_stats(uuid) cost 500;
alter function public._bt_acts_of(uuid) cost 500;

create or replace function public.battle_pool(p_battle uuid, p_fid text)
returns jsonb language plpgsql stable as $$
declare res jsonb := '[]'::jsonb; r record; used int; st jsonb;
begin
  -- админский полный каталог (весь опубликованный ship-парк, сорт. по классу) —
  -- ТОЛЬКО для СВОЕЙ стороны стаффа. Для бота (и любой чужой стороны) считаем
  -- обычный резерв флотов (пустой), иначе _bt_check_end видел бы у бота
  -- неисчерпаемый резерв и бой не завершался бы после уничтожения всех его кораблей.
  if public._bt_admin_full(p_battle) and p_fid = public._ec_my_fid() then
    with cat as materialized (
      -- ⚠️ MATERIALIZED ОБЯЗАТЕЛЕН. Без него _bt_stats встраивается в каждую
      -- из ~25 ссылок ниже и открытие доски уходит в statement timeout.
      select fu.id as uid,
             coalesce((fu.summary->>'cost')::numeric, 0) as cost,
             public._bt_stats(fu.id) as st,
             coalesce(public._bt_acts_of(fu.id), '[]'::jsonb) as acts
        from public.faction_units fu
       where fu.category = 'ship'
         and coalesce((fu.summary->>'hp')::numeric, 0) > 0
    )
    select coalesce(jsonb_agg(x order by rnk, nm), '[]'::jsonb) into res from (
      select public._bt_cls_rank(c.st->>'cls') as rnk,
             coalesce(c.st->>'name','Корабль') as nm,
             jsonb_build_object(
               'unit_id', c.uid, 'unit_name', coalesce(c.st->>'name','Корабль'), 'free', 99,
               'cost', c.cost,
               'cls', c.st->>'cls', 'hp', c.st->'hp', 'dmg', c.st->'dmg',
               'speed', c.st->'speed', 'rng', c.st->'rng',
               'shield', c.st->'shield', 'armor', c.st->'armor', 'sensor', c.st->'sensor',
               'stealth', c.st->'stealth', 'cargo', c.st->'cargo', 'crew', c.st->'crew',
               'pd', c.st->'pd', 'jam', c.st->'jam', 'dejam', c.st->'dejam',
               'eccm', c.st->'eccm', 'wpn', coalesce(c.st->'wpn', '[]'::jsonb),
               'acts', c.acts,
               'interdict', c.st->'interdict', 'stabil', c.st->'stabil', 'ftl', c.st->'ftl',
               'wings', c.st->'wings') as x
        from cat c
       where c.st is not null
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
end$$;
