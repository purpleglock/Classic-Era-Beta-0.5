-- ============================================================
-- ТОВАРЫ НА РЫНКЕ/БИРЖЕ
--   Регистрирует продукт «Товары» (с Фабрики товаров) как позицию
--   галактического рынка market_resources → появляется на вкладке «Рынок»
--   (ручная купля/продажа по живой цене) и на «Бирже» (спот + деривативы).
--
-- ПРИМЕНЯТЬ ПОСЛЕ: _market_setup.sql и _goods_factory.sql. Идемпотентно.
--
-- ⚠ Рынок/биржа ОБЩИЕ для всех держав → позиция называется «Товары» (единый
--   коммодити). Бренд игрока («своё название») — это витрина в его кабинете;
--   отдельные ИМЕННЫЕ листинги каждой державы на общей бирже = отдельная фича.
-- ============================================================

insert into public.market_resources (name, base_price, price, stock, equilibrium, npc_supply, npc_demand)
values ('Товары', 14, 14, 4000, 4000, 120, 120)
on conflict (name) do update
  set base_price = excluded.base_price,
      equilibrium = excluded.equilibrium;

-- Пересчёт цены по текущему запасу (если функция рынка уже есть).
update public.market_resources
  set price = public._market_price_calc(base_price, stock, equilibrium),
      updated_at = now()
  where name = 'Товары';

-- Проверка:
-- select name, base_price, price, stock from public.market_resources where name='Товары';
