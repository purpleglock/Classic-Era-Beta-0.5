-- ============================================================
-- ТОРГОВЛЯ · ГРУЗОПОДЪЁМНОСТЬ ПО KV (переработка)
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- РАНЬШЕ: грузоподъёмность торгового корабля = сумма грузовых ангаров
--   (id3 Транспортный=20, id4 Грузовой=10) — устаревшая модель конструктора.
-- ТЕПЕРЬ: опираемся на НАСТОЯЩУЮ грузоподъёмность KV (kv.cap, кг) — остаток
--   вместимости шасси после оружия/модулей/брони. Клиент считает её в
--   конструкторе (CN.last.kv.cap) и фиксирует в data->>'kv_cargo' при публикации
--   дизайна. Сервер читает это значение и не пересчитывает KV-математику
--   (античит: kv.cap уже ограничен на клиенте жёстким гейтом «не в минус», а
--   само число заморожено в data при сохранении — игрок не крутит его на лету).
--
-- Старые дизайны без kv_cargo откатываются на прежний ангарный расчёт —
-- совместимость сохранена, ничего не ломается до перепубликации.
--
-- Каскад: _ship_cargo() используется trade_capacity(), trade_route_propose,
--   _trade_ship_assign, _fleet_speed — все они автоматически перейдут на KV.
-- ============================================================

create or replace function public._ship_cargo(p_data jsonb)
returns int language sql immutable as $$
  select greatest(0, coalesce(
    -- Новая модель: замороженная грузоподъёмность KV из data (кг).
    (p_data->>'kv_cargo')::int,
    -- Легаси-откат: сумма грузовых ангаров старого конструктора.
    (select coalesce(sum(
        case (h->>'id')::int when 3 then 20 when 4 then 10 else 0 end
      ), 0)::int
      from jsonb_array_elements(coalesce(p_data->'hangars', '[]'::jsonb)) h)
  ))::int
$$;
revoke all on function public._ship_cargo(jsonb) from public;
grant execute on function public._ship_cargo(jsonb) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
--   select id, name, public._ship_cargo(data) as cargo_kg
--   from public.faction_units where category='ship'
--   order by cargo_kg desc;
-- «Торговые корабли» = те, у кого cargo_kg > 0 (есть свободная грузоподъёмность).
