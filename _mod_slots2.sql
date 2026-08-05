-- ПАЛУБА ПО СИЛУЭТУ (август 2026): предел модулей больше не табличное число —
-- ячейки есть там, где под ними есть корпус, и реально ограничивает энергосеть.
-- Серверный потолок остаётся только как страховка от прямой записи в базу:
-- он заведомо выше геометрического, форму держит клиент, а баланс — энергия.
create or replace function public._cn_mod_slots(p_class text) returns int
language sql immutable as $$
  select case p_class
    when 'corvette'         then 40
    when 'destroyer'        then 60
    when 'supportCarrier'   then 70
    when 'mediumCruiser'    then 90
    when 'hyperCruiser'     then 90
    when 'multiroleCarrier' then 110
    when 'battleship'       then 140
    when 'dreadnought'      then 170
    when 'ss13'             then 200
    when 'btr'      then 4
    when 'tanki'    then 4
    when 'aviacia'  then 3
    when 'vertihui' then 3
    when 'arta'     then 2
    when 'mla'      then 2
    when 'peh'      then 1
    when 'dron'     then 1
    when 'dronkos'  then 1
    else 99
  end;
$$;
