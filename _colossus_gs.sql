-- Множитель сложности сборки для «Имперского колосса» (зеркало CN_KV_CLASS_GS).
-- Без него класс проваливался в «else 1» и колосс выходил ВТРОЕ ДЕШЕВЛЕ дредноута
-- при том же железе и той же площади корпуса.
create or replace function public._cn_kv_class_gs(k text)
returns numeric language sql immutable as $$
  select case k
    when 'btr' then 1.15 when 'tanki' then 1.35 when 'arta' then 1.3
    when 'dron' then 1.2 when 'aviacia' then 1.5 when 'vertihui' then 1.5
    when 'dronkos' then 1.7 when 'mla' then 1.8
    when 'corvette' then 1.8 when 'destroyer' then 2.2 when 'supportCarrier' then 2.2
    when 'mediumCruiser' then 2.6 when 'hyperCruiser' then 3 when 'multiroleCarrier' then 3
    when 'battleship' then 3.6 when 'dreadnought' then 4.2 when 'ss13' then 3
    when 'colossus' then 4.8
    else 1 end;
$$;
