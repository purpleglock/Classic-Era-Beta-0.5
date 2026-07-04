-- _map_recenter_y.sql — РАЗОВО. Вертикально центрирует кластер звёзд в холсте карты.
-- Звёзды в map_systems сгруппированы в ВЕРХНЕЙ части поля (GM_W×GM_H = 9580×6360),
-- низ пустой → на карте кластер прижат к верху. Сдвигаем ВСЕ системы на общий
-- вертикальный офсет так, чтобы центр кластера совпал с центром холста.
-- Относительные позиции, гиперпути, границы и сектора при этом НЕ меняются
-- (сдвиг одинаковый для всех), меняется только вертикальное положение всей карты.
--
-- Идемпотентность: после применения центр кластера ≈ GM_H/2, повторный прогон
-- даст офсет ≈ 0. Офсет клампится, чтобы ни одна система не ушла за [0..GM_H].

do $$
declare
  gm_h   constant numeric := 6360;   -- высота холста (GM_H в galaxy_map.js)
  y_min  numeric;
  y_max  numeric;
  want   numeric;   -- желаемый офсет (центрирование)
  lo     numeric;   -- макс. отрицательный сдвиг (чтобы min не ушёл < 0)
  hi     numeric;   -- макс. положительный сдвиг (чтобы max не ушёл > GM_H)
  off    numeric;
begin
  select min(y), max(y) into y_min, y_max from public.map_systems;
  if y_min is null then
    raise notice 'map_systems пуст — нечего сдвигать';
    return;
  end if;

  want := gm_h / 2 - (y_min + y_max) / 2;   -- сдвиг для центрирования
  lo   := -y_min;                           -- нельзя опустить ниже 0
  hi   := gm_h - y_max;                      -- нельзя поднять выше GM_H
  off  := greatest(lo, least(hi, want));    -- клампим офсет в допустимый диапазон

  raise notice 'y: [% .. %], желаемый офсет %, применяю %', y_min, y_max, round(want), round(off);

  if abs(off) < 1 then
    raise notice 'сдвиг < 1 px — карта уже отцентрирована, пропускаю';
    return;
  end if;

  update public.map_systems set y = y + off;
end $$;
