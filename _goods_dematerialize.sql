-- ============================================================================
--  ТОВАРЫ — ДЕМАТЕРИАЛИЗАЦИЯ (2026-07-12)
--  Применять в Supabase → SQL Editor ПОСЛЕ обновлённого _budget_wellbeing.sql
--  (accrue уже без склада товаров) и ПОСЛЕ всех _market_*/_exchange_* срезов.
--  Идемпотентно. Заменяет собой _goods_off_exchange.sql и _goods_bug_trim.sql.
--
--  ЗАЧЕМ. «Товары» как накопительный ресурс порождали целый класс багов
--  (добор за пропущенные дни → «тысячи товаров», клобберы блока в accrue,
--  доение биржи бесплатным выпуском). Теперь товары — НЕ ресурс, а поток
--  внутри тика: фабрика делает ровно под спрос населения (pop/600/сут) и
--  списывает воду/сырьё пропорционально фактическому выпуску. Излишка нет,
--  склада нет, продажи нет — только множитель дохода welfare 0.90–1.10.
-- ============================================================================

-- ── 1. Разовая чистка: стереть «Товары» со складов всех держав ───────────────
update public.faction_economy
   set resources = resources - 'Товары'
 where resources ? 'Товары';

-- ── 2. Снять «Товары» с галактического рынка/биржи навсегда ──────────────────
-- Список благ, которым запрещён выход на рынок/биржу (расширяемый).
create or replace function public._ex_off_exchange(p_name text)
returns boolean language sql immutable as $$
  select p_name in ('Товары')
$$;

-- _market_ensure — единый чокпоинт спота и деривативов: гейт стоит ПЕРВЫМ.
create or replace function public._market_ensure(p_name text)
returns public.market_resources language plpgsql security definer set search_path=public as $$
declare mr public.market_resources; v_rar text; v_base numeric; v_eq numeric;
begin
  if public._ex_off_exchange(p_name) then
    raise exception '«%» не торгуется на бирже (внутреннее благо державы)', p_name;
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

-- Снести живущие данные товаров с рынка/истории + пересчитать индекс.
delete from public.market_price_history where name = 'Товары';
delete from public.market_resources     where name = 'Товары';
update public.market_index set value = public._market_index_value(), updated_at = now() where id = 1;

-- ── 3. Биржа брендов — под снос: товаров на складе больше не существует ──────
drop function if exists public.goods_market_board();
drop function if exists public.goods_buy(text, numeric);
drop function if exists public.goods_buy(text, int);
drop function if exists public.goods_set_price(numeric);
drop function if exists public.goods_set_price(int);
drop function if exists public.goods_set_brand(text);
-- Колонки goods_brand/goods_price в faction_economy НЕ трогаем (безвредны).

notify pgrst, 'reload schema';

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select count(*) from public.faction_economy where resources ? 'Товары';  -- 0
-- 2) select * from public.market_resources where name = 'Товары';             -- 0 строк
-- 3) select public.market_sell_resource('Товары', 100);                       -- ИСКЛЮЧЕНИЕ
-- 4) select public.economy_accrue('<fid>');  -- goods: demand/coverage/welfare/made, БЕЗ склада
