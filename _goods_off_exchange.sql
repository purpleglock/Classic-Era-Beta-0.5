-- ============================================================================
--  ТОВАРЫ — ВОН С БИРЖИ (спот + деривативы + индекс)
--  Применять в Supabase → SQL Editor ПОСЛЕДНИМ (после _market_setup.sql,
--  _market_sim.sql, _goods_market.sql и ВСЕХ _exchange_*.sql). Идемпотентно.
--
--  ЗАЧЕМ. «Товары» — ЭНДОГЕННЫЙ коммодити: игрок чеканит их фабрикой почти
--  бесплатно (6 воды + 4 сырья → 10 товаров; вода = майнящийся Лёд, сырьё =
--  Силикаты база 1) и без потолка (упор только в пропускную способность майнинга
--  дешёвых коммонов). Выпуск такого блага на ОБЩИЙ рынок дал два эксплойта:
--    (1) СПОТ-КРАН: market_sell_resource('Товары') платит ГС за бесплатный выпуск;
--    (2) ДОЕНИЕ ПУЛА: игрок сам двигает цену товаров (дамп/придержка своего
--        выпуска) → ползёт mark (TWAP) → выигрывает house-banked маржу/фьючерс/
--        опцион/индекс ПРОТИВ ПУЛА ДОМА. Товары — идеальная мишень, т.к. их
--        предложение игрок контролирует целиком (в отличие от скудных майнящихся).
--
--  ЧТО ДЕЛАЕМ. Полностью убираем «Товары» с галактического рынка/биржи. Товары
--  остаются механикой кабинета: ПРОВИЗИЯ населения (economy_accrue) и БРЕНД-БИРЖА
--  (goods_buy — P2P, игрок↔игрок, не дом) читают faction_economy.resources, а НЕ
--  market_resources, поэтому не затрагиваются.
--
--  ЕДИНЫЙ ЧОКПОИНТ. Все точки входа рынка/биржи (market_buy/sell_resource,
--  margin_open, futures_open, options_buy) первым делом зовут _market_ensure(res).
--  Достаточно научить _market_ensure ОТКАЗЫВАТЬ по «Товарам» — и они вылетают
--  разом со спота, деривативов и (через удаление строки) из корзины индекса.
-- ============================================================================

-- ── Список благ, которым запрещён выход на рынок/биржу (расширяемый) ─────────
create or replace function public._ex_off_exchange(p_name text)
returns boolean language sql immutable as $$
  select p_name in ('Товары')
$$;

-- ── _market_ensure с гейтом: отказ создавать/возвращать заблокированное благо ─
--    Гейт стоит ПЕРВЫМ — даже если строка «Товары» каким-то образом существует,
--    любой вызов ensure (а значит и спот, и открытие деривативов) упадёт.
create or replace function public._market_ensure(p_name text)
returns public.market_resources language plpgsql security definer set search_path=public as $$
declare mr public.market_resources; v_rar text; v_base numeric; v_eq numeric;
begin
  if public._ex_off_exchange(p_name) then
    raise exception '«%» не торгуется на бирже (производимое благо)', p_name;
  end if;
  select * into mr from public.market_resources where name = p_name for update;
  if found then return mr; end if;
  v_rar  := coalesce((select rarity from public.resource_rarity where name = p_name), 'common');
  v_base := public._res_base_value(p_name, v_rar);
  v_eq   := public._mk_equilibrium(v_rar);
  insert into public.market_resources(name, base_price, price, stock, equilibrium, npc_supply, npc_demand)
    values (p_name, v_base, v_base, v_eq, v_eq, round(v_eq*0.03), round(v_eq*0.03))
    on conflict (name) do nothing;
  select * into mr from public.market_resources where name = p_name for update;
  return mr;
end$$;

-- ── Снести уже живущие данные товаров с рынка/истории + пересчитать индекс ────
delete from public.market_price_history where name = 'Товары';
delete from public.market_resources     where name = 'Товары';
update public.market_index set value = public._market_index_value(), updated_at = now() where id = 1;

-- Открытые деривативные позиции по «Товарам» (если есть) закрывать НЕ нужно:
-- *_close/*_settle считают по _ex_mark, который без рыночной строки падает на
-- _res_base_value('Товары') (стабильный якорь) — манипуляция уже невозможна,
-- позиция спокойно гасится по якорю.

notify pgrst, 'reload schema';

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select * from public.market_resources where name = 'Товары';          -- 0 строк
-- 2) select public.market_sell_resource('Товары', 100);                    -- ИСКЛЮЧЕНИЕ
-- 3) select public.margin_open('Товары','short',1000,2);                   -- ИСКЛЮЧЕНИЕ
-- 4) select public.goods_buy('<seller_fid>', 10);                          -- РАБОТАЕТ (P2P бренд)
-- 5) economy_accrue: провизия населения по «Товарам» — РАБОТАЕТ (склад, не рынок)
