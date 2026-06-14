-- ============================================================
-- ТОРГОВЛЯ · ФАЗА 1 (фундамент): честная грузоподъёмность корабля
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- «Торговый корабль» = дизайн с грузовыми ангарами (Транспортный/Грузовой,
-- canHaveUnits=false). Грузоподъёмность = сумма их вместимости. Сервер считает
-- её САМ из data дизайна — клиентскому summary.cargo НЕ доверяем (он авторит
-- игрок → иначе «фрахтовщик на 9999 за 100 ГС»).
--
-- Зеркало CN_SHIP.hangarTypes (constructors.js): id3 Транспортный=20, id4 Грузовой=10.
-- (Боевые ангары id0/1/2 — для авиагрупп, не груз.)
-- ⚠ Если меняешь вместимость грузовых ангаров в конструкторе — синхронь здесь.
-- ============================================================

create or replace function public._ship_cargo(p_data jsonb)
returns int language sql immutable as $$
  select coalesce(sum(
    case (h->>'id')::int when 3 then 20 when 4 then 10 else 0 end
  ), 0)::int
  from jsonb_array_elements(coalesce(p_data->'hangars', '[]'::jsonb)) h
$$;
revoke all on function public._ship_cargo(jsonb) from public;
grant execute on function public._ship_cargo(jsonb) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- Для дизайна с грузовыми ангарами вернёт суммарную вместимость:
--   select id, name, public._ship_cargo(data) as cargo
--   from public.faction_units where category='ship' and public._ship_cargo(data) > 0;
-- Это «торговые корабли». Караваны (срез 2) будут брать вместимость отсюда.
