-- ============================================================================
--  ФИКС РАССИНХРОНА РЫНКА — цена «на табло» ≠ цена сделки
--  Применять в Supabase → SQL Editor. Идемпотентно. Самодостаточно.
--
--  СИМПТОМ (скрин игрока): сверху «Гравиядро 1 348 ГС (+285%)», но покупка 1 ед.
--  идёт по ≈620 ГС («цена −36%»), продажа — по ≈650 ГС («цена −46%»). То есть
--  ОТОБРАЖАЕМАЯ цена и РЕАЛЬНАЯ цена сделки/предпросмотра считаются по РАЗНЫМ
--  параметрам.
--
--  ПРИЧИНА (клоббер, как с temple/station btype). Клиент (economy.js) читает
--  таблицу `market_config` и считает предпросмотр/прогноз по МЯГКИМ параметрам
--  из `_mining_market_routing.sql`:  elasticity 0.30, зажим 0.50..2.50.
--  А серверные `_market_price_calc` / `_market_area` (через них считается и
--  столбец `price`, и ДЕНЬГИ в market_buy/sell_resource) откатились к СТАРОМУ
--  хардкоду из `_market_setup.sql`:  elasticity 0.45, зажим 0.25..4.0.
--  Доказательство в самом скрине: +285% ≈ ×3.85 → потолок зажима ≈4.0 (старый
--  сервер); а предпросмотр «−36%» = base×2.5 / base×3.85 → потолок 2.5 (клиент).
--  Скорее всего таблица market_config «выжила» (create if not exists), а функции
--  цены затёр повторный прогон `_market_setup.sql` / `_security_money.sql`.
--
--  ФИКС. Возвращаем серверу CONFIG-AWARE версии `_market_price_calc` и
--  `_market_area` (читают market_config — те же числа, что и клиент), затем
--  ПЕРЕСЧИТЫВАЕМ сохранённый столбец `price`, чтобы табло сразу совпало с конфигом
--  (без ожидания тика). После этого: табло = предпросмотр = списание денег.
--
--  Surgical: НЕ трогаем market_tick / economy_accrue / добычу — только две
--  функции цены, имена которых market_buy/sell_resource резолвят в рантайме.
-- ============================================================================

-- 0) Гарантируем наличие конфига (на случай, если таблицы всё-таки нет) ────────
create table if not exists public.market_config (
  id            int primary key default 1,
  elasticity    numeric not null default 0.30,
  clamp_lo      numeric not null default 0.50,
  clamp_hi      numeric not null default 2.50,
  reversion     numeric not null default 0.15,
  volatility    numeric not null default 0.02,
  npc_react     numeric not null default 0.60,
  walk          numeric not null default 0.20,
  shock_chance  numeric not null default 0.06,
  player_sell   numeric not null default 0.80,
  updated_at    timestamptz not null default now()
);
insert into public.market_config(id) values(1) on conflict (id) do nothing;
alter table public.market_config enable row level security;
drop policy if exists "mc_sel" on public.market_config;
create policy "mc_sel" on public.market_config for select to public using (true);

create or replace function public._market_cfg() returns public.market_config
language sql stable as $$ select * from public.market_config where id = 1 $$;

-- 1) Цена от запаса — CONFIG-AWARE (зеркало клиентского ecMkPrice) ─────────────
create or replace function public._market_price_calc(p_base numeric, p_stock numeric, p_eq numeric)
returns numeric language sql stable as $$
  select round(
    coalesce(p_base,2) * least(
      (select clamp_hi from public.market_config where id=1),
      greatest((select clamp_lo from public.market_config where id=1),
        power( greatest(coalesce(p_eq,1),1) / greatest(coalesce(p_stock,1),1),
               (select elasticity from public.market_config where id=1) )
      )), 2)::numeric
$$;

-- 2) ∫ цены по сделке — CONFIG-AWARE (зеркало клиентского ecMkArea) ────────────
create or replace function public._market_area(p_base numeric, p_a numeric, p_b numeric, p_eq numeric)
returns numeric language sql stable as $$
  with c as (
    select least(coalesce(elasticity,0.30),0.999) as k, clamp_lo as clo, clamp_hi as chi
    from public.market_config where id = 1
  ), v as (
    select c.k, c.clo, c.chi,
      greatest(coalesce(p_base,2),0)::numeric as base,
      greatest(coalesce(p_eq,1),1)::numeric   as eq,
      greatest(coalesce(p_a,0),0)::numeric     as a,
      greatest(coalesce(p_b,0),0)::numeric     as b
    from c
  ), g as (
    select *, eq*power(chi, -1.0/k) as x_cap, eq*power(clo, -1.0/k) as x_flr from v
  )
  select case when b <= a then 0 else (
      greatest(0, least(b, x_cap) - a) * base * chi
      + case when least(b, x_flr) > greatest(a, x_cap)
          then base*power(eq,k)*( power(least(b,x_flr),1-k) - power(greatest(a,x_cap),1-k) )/(1-k)
          else 0 end
      + greatest(0, b - greatest(a, x_flr)) * base * clo
    ) end
  from g
$$;

-- 3) ПЕРЕСЧЁТ сохранённого столбца price — табло сразу совпадает с конфигом ────
update public.market_resources
   set price = public._market_price_calc(base_price, stock, equilibrium),
       updated_at = now();

-- 4) Права ────────────────────────────────────────────────────────────────────
revoke all on function public._market_price_calc(numeric,numeric,numeric) from public;
revoke all on function public._market_area(numeric,numeric,numeric,numeric) from public;
grant execute on function public._market_price_calc(numeric,numeric,numeric) to anon, authenticated;
grant execute on function public._market_area(numeric,numeric,numeric,numeric) to anon, authenticated;

-- ── Проверка ──────────────────────────────────────────────────────────────────
-- 1) Параметры, которые ВИДИТ И клиент, и сервер (должны совпадать):
--      select elasticity, clamp_lo, clamp_hi from public.market_config where id=1;  -- 0.30 / 0.50 / 2.50
-- 2) Цена ни у одного ресурса больше не выходит за ×2.50 базы:
--      select name, round(price/base_price,2) k from public.market_resources order by k desc limit 5;  -- max ≈ 2.50
-- 3) Сохранённый price = пересчёт от запаса (рассинхрона нет):
--      select name, price, public._market_price_calc(base_price, stock, equilibrium) calc
--      from public.market_resources where price <> public._market_price_calc(base_price, stock, equilibrium);  -- 0 строк
