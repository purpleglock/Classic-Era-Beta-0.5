-- Свод констант обороны: каждая новая плита обороны переписывала _defense_const
-- целиком и уносила чужие ключи. Последним лёг _outpost_depot.sql — вместе с ним
-- пропали ВСЕ ключи ПРО и ПВО: `slots >= null` даёт null, то есть «разведки нет»
-- при любом числе слотов. Здесь — объединение всех слоёв; правило прежнее:
-- новый слой ДОПИСЫВАЕТ ключи в этот файл, а не заводит свою версию функции.
create or replace function public._defense_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    -- ЗВЁЗДНАЯ БАЗА И РЕМОНТ
    when 'starbase_cap_per_slot' then 50
    when 'repair_fraction'       then 0.40
    when 'repair_cost_frac'      then 0.50
    when 'repair_days'           then 1
    -- МИННЫЕ ПОЛЯ
    when 'mine_hex_max'          then 6
    when 'mine_hex_cost'         then 400
    when 'mine_hex_attrition'    then 0.05
    when 'mine_wear_hexes'       then 1
    when 'mine_refund_frac'      then 0.50
    -- АВАНПОСТЫ
    when 'outpost_ship_cost'     then 2000
    when 'outpost_build_h'       then 24
    when 'outpost_cap'           then 20
    when 'outpost_refund'        then 0.50
    when 'outpost_mine_gc'       then 75
    when 'op_fly_h_min'          then 2
    when 'op_fly_h_max'          then 18
    -- ЭКИПАЖ И ЗАСТАВА
    when 'crew_need_recon'       then 10
    when 'crew_need_mining'      then 25
    when 'crew_need_depot'       then 20
    when 'crew_hire_gc'          then 20
    when 'crew_wage_gc'          then 2
    when 'crew_desert_frac'      then 0.25
    when 'op_empty_days'         then 5
    when 'depot_cap'             then 30
    -- ПВО
    when 'flak_per_slot'         then 0.15
    when 'flak_cap'              then 0.60
    -- ПРО: снаряды
    when 'abm_ammo_cost'         then 800
    when 'abm_ammo_days'         then 1
    -- ПРО: дуэль по осям подхода
    when 'abm_narrow_slots'      then 2
    when 'abm_radar_slots'       then 4
    when 'abm_clear_slots'       then 6
    when 'abm_clear_chance'      then 0.50
    when 'abm_auto_per_slot'     then 0.06
    when 'abm_auto_cap'          then 0.30
    else null end
$$;
