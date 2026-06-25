-- ============================================================================
--  БИРЖА · СРЕЗ 9 — ПРЕДОХРАНИТЕЛИ (реанимация казино без сверхприбыли)
--  Применять в Supabase → SQL Editor ПОСЛЕДНИМ (после ВСЕХ _exchange_*.sql и
--  _exchange_freeze.sql). Идемпотентно. Зависит от: _market_setup.sql
--  (market_resources / market_price_history / _market_price_calc / _market_ensure /
--   _res_base_value), _market_sim.sql (market_index / index_holdings / _market_shock /
--   _market_index_value), _exchange_margin/_futures/_options.sql (позиции +
--   _margin_pnl / _fut_price / _opt_premium / _opt_intrinsic), _exchange_corps.sql
--   (exchange_session_sync), _exchange_bonds.sql (bonds_settle), _security_money.sql
--   (_ec_my_fid / current_user_banned), _economy_setup.sql (faction_economy).
--
--  ЗАЧЕМ. Срез _exchange_freeze.sql закрыл индекс/маржу/фьючерсы/опционы/облигации,
--  потому что они печатали миллиарды. ДВЕ корневые причины:
--    (1) РАСЧЁТ ПО МГНОВЕННОЙ ЦЕНЕ, которую тот же игрок двигает спотовыми
--        ордерами (market_buy/sell_resource), особенно на «тонких» легендарных
--        ресурсах (флоат ~1500): открыл плечо → качнул цену → закрыл в плюс.
--    (2) БЕСКОНЕЧНЫЙ «ДОМ»: выигрыш = `gc + payout` (печать из воздуха), проигрыш
--        сжигается. Это не игра с нулевой суммой между игроками, а печатный
--        станок при любом перевесе (манипуляция ИЛИ просто возврат к среднему).
--
--  ЧЕМ ЛЕЧИМ (по выбору владельца: открыть ВСЁ, плечо ×2, жёсткий пул дома):
--    A. MARK-ЦЕНА (TWAP). Деривативы входят и рассчитываются НЕ по мгновенной
--       цене, а по СРЕДНЕЙ из последних снимков истории (market_price_history,
--       пишется только на суточном тике). Спотовый «насос» двигает живую цену,
--       но НЕ среднюю — чтобы сдвинуть mark, цену надо УДЕРЖИВАТЬ несколько
--       суток (дорого, со спредом, и плечо всего ×2). Атомарный pump-and-dump
--       мёртв.
--    B. ПУЛ ДОМА (exchange_house) — ZERO-SUM. КАЖДАЯ ставка (залог/премия/вложение
--       в индекс) уходит В пул; КАЖДАЯ выплата берётся ИЗ пула и обрезается его
--       остатком. Дрип ВЫКЛЮЧЕН (был 200к/сут — это и был кран печати ГС), сидбанк
--       срезан 2 млн → 100к. Тогда за всю историю: выплачено ≤ внесено + 100к.
--       Казино НЕ печатает деньги — выигрыши оплачиваются ТОЛЬКО проигрышами
--       других игроков; единственная разовая инъекция за всю жизнь ≤ сидбанк (100к).
--    C. ПЛЕЧО ≤ ×2 (было ×10). Ликвидация лонга только при −45% движении.
--    D. ЛИМИТЫ СТАВКИ: абсолютный потолок залога, ≤25% казны на позицию, не
--       более 6 открытых позиций на инструмент, потолок вложения в индекс.
--
--  Все функции — SECURITY DEFINER, клиентского DML нет. Срез ВОЗВРАЩАЕТ грант на
--  точки входа, отозванный _exchange_freeze.sql (create-or-replace сохраняет
--  старые привилегии, поэтому grant обязателен).
-- ============================================================================

-- ── A. MARK-ЦЕНА: среднее последних 5 снимков истории (фолбэк — живая/базовая) ─
--    Снимки пишутся только в market_tick() (суточно), поэтому спот внутри сессии
--    их не двигает — манипуляция расчётной ценой обезврежена.
create or replace function public._ex_mark(p_name text)
returns numeric language sql stable security definer set search_path=public as $$
  select round(coalesce(
    (select avg(price) from (
        select price from public.market_price_history
        where name = p_name order by at desc limit 5) z),
    (select price from public.market_resources where name = p_name),
    public._res_base_value(p_name)
  ), 4)::numeric
$$;

-- ── C/D. Параметры предохранителей (одно место правды) ──────────────────────
create or replace function public._margin_max_lev() returns numeric language sql immutable as $$ select 2::numeric      $$;  -- было 10
create or replace function public._ex_max_coll()    returns numeric language sql immutable as $$ select 100000::numeric $$;  -- потолок залога/премии на позицию
create or replace function public._ex_coll_frac()   returns numeric language sql immutable as $$ select 0.25::numeric   $$;  -- ≤25% казны на позицию
create or replace function public._ex_max_open()    returns int     language sql immutable as $$ select 6              $$;  -- открытых позиций на инструмент
create or replace function public._ex_index_cap()   returns numeric language sql immutable as $$ select 500000::numeric $$;  -- потолок вложенного в индекс (basis)
create or replace function public._ex_index_spread()returns numeric language sql immutable as $$ select 0.005::numeric  $$;  -- спред дома по индексу (~1% круг)

-- ── Проверка лимита ставки (общая для всех инструментов) ─────────────────────
create or replace function public._ex_check_stake(p_stake numeric, p_gc numeric)
returns void language plpgsql immutable as $$
begin
  if p_stake > public._ex_max_coll() then
    raise exception 'stake too large (max % GC per position)', public._ex_max_coll();
  end if;
  if p_stake > floor(greatest(p_gc,0) * public._ex_coll_frac()) then
    raise exception 'stake exceeds % %% of treasury', round(public._ex_coll_frac()*100);
  end if;
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  B. ПУЛ ДОМА — единая казна биржи. Сидбанк = верхняя граница того, сколько
--  казино может влить в экономику за всю историю.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.exchange_house (
  id         int primary key default 1,
  pool       numeric not null default 100000,    -- текущая ликвидность дома (стартовый сидбанк)
  updated_at timestamptz not null default now()
);
insert into public.exchange_house(id, pool) values (1, 100000) on conflict (id) do nothing;
-- СБРОС раздутого пула к сидбанку (был 2 млн + дрип 200к/сут — это и был кран
-- печати ГС). Теперь сид = верхняя граница того, сколько казино может влить В
-- ЭКОНОМИКУ ЗА ВСЮ ИСТОРИЮ; дальше строго zero-sum (платим только проигрышами).
update public.exchange_house set pool = 100000, updated_at = now() where id = 1;
alter table public.exchange_house enable row level security;
-- RLS без политик: читается/пишется только через SECURITY DEFINER RPC

create or replace function public._house_baseline() returns numeric language sql immutable as $$ select 100000::numeric $$;  -- разовый сидбанк (потолок инъекции ГС за всю историю)
create or replace function public._house_drip()     returns numeric language sql immutable as $$ select 0::numeric      $$;  -- дрип ВЫКЛЮЧЕН: казино не печатает, только перераспределяет проигрыши

-- Внести в пул (ставка/проигрыш/спред уходят дому)
create or replace function public._house_take(p_amt numeric)
returns void language plpgsql security definer set search_path=public as $$
begin
  if coalesce(p_amt,0) <= 0 then return; end if;
  update public.exchange_house set pool = pool + floor(p_amt), updated_at = now() where id = 1;
  if not found then
    insert into public.exchange_house(id, pool) values (1, public._house_baseline() + floor(p_amt))
      on conflict (id) do update set pool = public.exchange_house.pool + floor(p_amt);
  end if;
end$$;

-- Выплатить из пула, ОБРЕЗАЯ запрос остатком пула (главный предохранитель)
create or replace function public._house_pay(p_req numeric)
returns numeric language plpgsql security definer set search_path=public as $$
declare avail numeric; pay numeric;
begin
  if coalesce(p_req,0) <= 0 then return 0; end if;
  select pool into avail from public.exchange_house where id = 1 for update;
  if avail is null then
    insert into public.exchange_house(id, pool) values (1, public._house_baseline()) on conflict (id) do nothing;
    select pool into avail from public.exchange_house where id = 1 for update;
  end if;
  pay := least(floor(p_req), greatest(0, floor(avail)));
  update public.exchange_house set pool = pool - pay, updated_at = now() where id = 1;
  return pay;
end$$;

-- Остаток пула для UI
create or replace function public._house_pool() returns numeric language sql stable security definer set search_path=public as $$
  select coalesce((select pool from public.exchange_house where id = 1), public._house_baseline())
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  МАРЖА — переопределение с mark-ценой, лимитами ставки и пулом дома.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.margin_open(p_resource text, p_side text, p_collateral numeric, p_leverage numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy;
        coll numeric; lev numeric; notional numeric; size numeric; entry numeric; liq numeric; v_id uuid; open_cnt int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_side not in ('long','short') then raise exception 'bad side'; end if;
  coll := floor(coalesce(p_collateral,0));
  lev  := round(coalesce(p_leverage,1));
  if coll < 100 then raise exception 'collateral too small (min 100)'; end if;
  if lev < 1 or lev > public._margin_max_lev() then raise exception 'bad leverage (1..%)', public._margin_max_lev(); end if;
  fid := public._ec_my_fid();

  select count(*) into open_cnt from public.margin_positions where faction_id = fid and status = 'open';
  if open_cnt >= public._ex_max_open() then raise exception 'too many open positions (max %)', public._ex_max_open(); end if;

  select * into eco from public.faction_economy where faction_id = fid for update;   -- сериализация казны
  if not found then raise exception 'no economy'; end if;
  if eco.gc < coll then raise exception 'not enough GC'; end if;
  perform public._ex_check_stake(coll, eco.gc);

  perform public._market_ensure(p_resource);            -- гарантировать строку рынка
  entry := public._ex_mark(p_resource);                 -- MARK, не мгновенная цена
  if entry is null or entry <= 0 then raise exception 'no market price'; end if;
  notional := coll * lev;
  size     := notional / entry;
  liq      := public._margin_liq_price(p_side, entry, lev);

  update public.faction_economy set gc = gc - coll where faction_id = fid;
  perform public._house_take(coll);                     -- залог уходит в пул дома
  insert into public.margin_positions(faction_id, resource, side, size_units, entry_price, collateral, leverage, liq_price)
    values (fid, p_resource, p_side, size, entry, coll, lev, liq)
    returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'entry', entry, 'size', round(size,4), 'liq', liq);
end$$;

create or replace function public.margin_close(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; pos public.margin_positions; px numeric; pnl numeric; equity numeric; payout numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into pos from public.margin_positions where id = p_id for update;
  if not found then raise exception 'no position'; end if;
  if pos.faction_id <> fid then raise exception 'not your position'; end if;
  if pos.status <> 'open' then raise exception 'position not open'; end if;

  px     := public._ex_mark(pos.resource);              -- MARK
  pnl    := public._margin_pnl(pos.side, pos.size_units, pos.entry_price, px);
  equity := pos.collateral + pnl;
  payout := public._house_pay(greatest(0, floor(equity)));   -- выплата из пула (обрезается остатком)

  update public.faction_economy set gc = gc + payout where faction_id = fid;
  update public.margin_positions
     set status = 'closed', exit_price = px, realized = payout - pos.collateral, closed_at = now()
   where id = pos.id;

  return jsonb_build_object('ok', true, 'payout', payout, 'pnl', floor(pnl), 'price', px);
end$$;

create or replace function public.margin_settle()
returns jsonb language plpgsql security definer set search_path=public as $$
declare pos record; px numeric; pnl numeric; equity numeric; notional numeric; payout numeric; n int := 0;
begin
  for pos in select * from public.margin_positions where status = 'open' for update loop
    px := public._ex_mark(pos.resource);                -- MARK
    if px is null then continue; end if;
    pnl      := public._margin_pnl(pos.side, pos.size_units, pos.entry_price, px);
    equity   := pos.collateral + pnl;
    notional := pos.size_units * pos.entry_price;
    if equity <= notional * public._margin_mm() then
      payout := public._house_pay(greatest(0, floor(equity)));
      update public.faction_economy set gc = gc + payout where faction_id = pos.faction_id;
      update public.margin_positions
         set status = 'liquidated', exit_price = px, realized = payout - pos.collateral, closed_at = now()
       where id = pos.id;
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'liquidated', n);
end$$;

create or replace function public.margin_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'mm',      public._margin_mm(),
    'max_lev', public._margin_max_lev(),
    'max_coll',public._ex_max_coll(),
    'max_open',public._ex_max_open(),
    'house',   public._house_pool(),
    'open', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'resource', p.resource, 'side', p.side,
        'size', p.size_units, 'entry', p.entry_price, 'collateral', p.collateral,
        'leverage', p.leverage, 'liq', p.liq_price,
        'price', public._ex_mark(p.resource),
        'notional', round(p.size_units * p.entry_price),
        'pnl', floor(public._margin_pnl(p.side, p.size_units, p.entry_price, public._ex_mark(p.resource))),
        'opened_at', p.opened_at)
      order by p.opened_at desc)
      from public.margin_positions p
      where p.faction_id = fid and p.status = 'open'), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'resource', p.resource, 'side', p.side,
        'entry', p.entry_price, 'exit', p.exit_price, 'leverage', p.leverage,
        'collateral', p.collateral, 'realized', p.realized, 'status', p.status,
        'closed_at', p.closed_at)
      order by p.closed_at desc)
      from (select * from public.margin_positions
            where faction_id = fid and status in ('closed','liquidated')
            order by closed_at desc limit 12) p), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'price', price, 'base', base_price)
        order by base_price desc)
      from public.market_resources), '[]'::jsonb)
  );
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  ФЬЮЧЕРСЫ — то же: mark-вход, лимиты, пул дома.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.futures_open(p_resource text, p_side text, p_collateral numeric, p_leverage numeric, p_term_days int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy;
        coll numeric; lev numeric; notional numeric; size numeric; spot numeric; fut numeric; liq numeric; v_id uuid; open_cnt int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_side not in ('long','short') then raise exception 'bad side'; end if;
  coll := floor(coalesce(p_collateral,0));
  lev  := round(coalesce(p_leverage,1));
  if coll < 100 then raise exception 'collateral too small (min 100)'; end if;
  if lev < 1 or lev > public._margin_max_lev() then raise exception 'bad leverage'; end if;
  if p_term_days is null or p_term_days < 1 or p_term_days > 90 then raise exception 'bad term (1..90)'; end if;
  fid := public._ec_my_fid();

  select count(*) into open_cnt from public.futures_positions where faction_id = fid and status = 'open';
  if open_cnt >= public._ex_max_open() then raise exception 'too many open futures (max %)', public._ex_max_open(); end if;

  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  if eco.gc < coll then raise exception 'not enough GC'; end if;
  perform public._ex_check_stake(coll, eco.gc);

  perform public._market_ensure(p_resource);
  spot := public._ex_mark(p_resource);                  -- MARK
  if spot is null or spot <= 0 then raise exception 'no market price'; end if;
  fut      := public._fut_price(spot, p_term_days);
  notional := coll * lev;
  size     := notional / fut;
  liq      := public._margin_liq_price(p_side, fut, lev);

  update public.faction_economy set gc = gc - coll where faction_id = fid;
  perform public._house_take(coll);
  insert into public.futures_positions(faction_id, resource, side, size_units, entry_price, spot_entry, collateral, leverage, liq_price, expires_at)
    values (fid, p_resource, p_side, size, fut, spot, coll, lev, liq, now() + (p_term_days || ' days')::interval)
    returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'fut', fut, 'spot', spot, 'size', round(size,4), 'liq', liq);
end$$;

create or replace function public.futures_close(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; pos public.futures_positions; px numeric; pnl numeric; payout numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into pos from public.futures_positions where id = p_id for update;
  if not found then raise exception 'no position'; end if;
  if pos.faction_id <> fid then raise exception 'not your position'; end if;
  if pos.status <> 'open' then raise exception 'position not open'; end if;

  px     := public._ex_mark(pos.resource);              -- MARK
  pnl    := public._margin_pnl(pos.side, pos.size_units, pos.entry_price, px);
  payout := public._house_pay(greatest(0, floor(pos.collateral + pnl)));

  update public.faction_economy set gc = gc + payout where faction_id = fid;
  update public.futures_positions
     set status = 'closed', exit_price = px, realized = payout - pos.collateral, closed_at = now()
   where id = pos.id;
  return jsonb_build_object('ok', true, 'payout', payout, 'pnl', floor(pnl), 'price', px);
end$$;

create or replace function public.futures_settle()
returns jsonb language plpgsql security definer set search_path=public as $$
declare pos record; px numeric; pnl numeric; equity numeric; notional numeric; payout numeric; n_liq int := 0; n_set int := 0;
begin
  for pos in select * from public.futures_positions where status = 'open' for update loop
    px := public._ex_mark(pos.resource);                -- MARK
    if px is null then continue; end if;
    pnl      := public._margin_pnl(pos.side, pos.size_units, pos.entry_price, px);
    equity   := pos.collateral + pnl;
    notional := pos.size_units * pos.entry_price;

    if equity <= notional * public._margin_mm() then
      payout := public._house_pay(greatest(0, floor(equity)));
      update public.faction_economy set gc = gc + payout where faction_id = pos.faction_id;
      update public.futures_positions
         set status = 'liquidated', exit_price = px, realized = payout - pos.collateral, closed_at = now()
       where id = pos.id;
      n_liq := n_liq + 1;
    elsif pos.expires_at <= now() then
      payout := public._house_pay(greatest(0, floor(equity)));
      update public.faction_economy set gc = gc + payout where faction_id = pos.faction_id;
      update public.futures_positions
         set status = 'settled', exit_price = px, realized = payout - pos.collateral, closed_at = now()
       where id = pos.id;
      n_set := n_set + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'liquidated', n_liq, 'settled', n_set);
end$$;

create or replace function public.futures_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'mm',          public._margin_mm(),
    'max_lev',     public._margin_max_lev(),
    'max_coll',    public._ex_max_coll(),
    'max_open',    public._ex_max_open(),
    'house',       public._house_pool(),
    'contango_day',public._fut_contango_day(),
    'open', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'resource', p.resource, 'side', p.side,
        'size', p.size_units, 'entry', p.entry_price, 'spot_entry', p.spot_entry,
        'collateral', p.collateral, 'leverage', p.leverage, 'liq', p.liq_price,
        'price', public._ex_mark(p.resource), 'expires_at', p.expires_at,
        'notional', round(p.size_units * p.entry_price),
        'pnl', floor(public._margin_pnl(p.side, p.size_units, p.entry_price, public._ex_mark(p.resource))))
      order by p.expires_at asc)
      from public.futures_positions p
      where p.faction_id = fid and p.status = 'open'), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'resource', p.resource, 'side', p.side, 'entry', p.entry_price,
        'exit', p.exit_price, 'leverage', p.leverage, 'collateral', p.collateral,
        'realized', p.realized, 'status', p.status, 'closed_at', p.closed_at)
      order by p.closed_at desc)
      from (select * from public.futures_positions
            where faction_id = fid and status in ('settled','liquidated','closed')
            order by closed_at desc limit 12) p), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'price', price, 'base', base_price)
        order by base_price desc)
      from public.market_resources), '[]'::jsonb)
  );
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  ОПЦИОНЫ — mark-цена, лимит премии, пул дома.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.options_buy(p_resource text, p_kind text, p_strike numeric, p_contracts numeric, p_term_days int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy;
        ct numeric; strike numeric; spot numeric; prem numeric; cost numeric; v_id uuid; open_cnt int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_kind not in ('call','put') then raise exception 'bad kind'; end if;
  strike := round(coalesce(p_strike,0), 2);
  ct     := floor(coalesce(p_contracts,0));
  if strike <= 0 then raise exception 'bad strike'; end if;
  if ct < 1 then raise exception 'bad contracts'; end if;
  if p_term_days is null or p_term_days < 1 or p_term_days > 90 then raise exception 'bad term (1..90)'; end if;
  fid := public._ec_my_fid();

  select count(*) into open_cnt from public.option_positions where faction_id = fid and status = 'open';
  if open_cnt >= public._ex_max_open() then raise exception 'too many open options (max %)', public._ex_max_open(); end if;

  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;

  perform public._market_ensure(p_resource);
  spot := public._ex_mark(p_resource);                  -- MARK
  if spot is null or spot <= 0 then raise exception 'no market price'; end if;
  prem := public._opt_premium(p_kind, spot, strike, p_term_days);
  cost := ceil(prem * ct);
  if eco.gc < cost then raise exception 'not enough GC'; end if;
  perform public._ex_check_stake(cost, eco.gc);          -- премия — это ставка

  update public.faction_economy set gc = gc - cost where faction_id = fid;
  perform public._house_take(cost);                      -- премия уходит в пул дома
  insert into public.option_positions(faction_id, resource, kind, strike, contracts, premium_paid, spot_entry, expires_at)
    values (fid, p_resource, p_kind, strike, ct, cost, spot, now() + (p_term_days || ' days')::interval)
    returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'premium', cost, 'unit_premium', prem, 'spot', spot);
end$$;

create or replace function public.options_close(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; pos public.option_positions; spot numeric; days numeric; val numeric; v_payout numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into pos from public.option_positions where id = p_id for update;
  if not found then raise exception 'no position'; end if;
  if pos.faction_id <> fid then raise exception 'not your position'; end if;
  if pos.status <> 'open' then raise exception 'position not open'; end if;

  spot     := public._ex_mark(pos.resource);            -- MARK
  days     := greatest(0, extract(epoch from (pos.expires_at - now())) / 86400.0);
  val      := public._opt_premium(pos.kind, spot, pos.strike, days);
  v_payout := public._house_pay(floor(val * pos.contracts * 0.9));   -- спред дома + обрезка пулом

  update public.faction_economy set gc = gc + v_payout where faction_id = fid;
  update public.option_positions
     set status = 'closed', exit_spot = spot, payout = v_payout, realized = v_payout - pos.premium_paid, closed_at = now()
   where id = pos.id;
  return jsonb_build_object('ok', true, 'payout', v_payout, 'spot', spot);
end$$;

create or replace function public.options_settle()
returns jsonb language plpgsql security definer set search_path=public as $$
declare pos record; spot numeric; intr numeric; v_payout numeric; n_ex int := 0; n_exp int := 0;
begin
  for pos in select * from public.option_positions where status = 'open' and expires_at <= now() for update loop
    spot := public._ex_mark(pos.resource);              -- MARK
    intr := public._opt_intrinsic(pos.kind, spot, pos.strike);
    if intr > 0 then
      v_payout := public._house_pay(floor(intr * pos.contracts));
      update public.faction_economy set gc = gc + v_payout where faction_id = pos.faction_id;
      update public.option_positions
         set status = 'exercised', exit_spot = spot, payout = v_payout, realized = v_payout - pos.premium_paid, closed_at = now()
       where id = pos.id;
      n_ex := n_ex + 1;
    else
      update public.option_positions
         set status = 'expired', exit_spot = spot, payout = 0, realized = -pos.premium_paid, closed_at = now()
       where id = pos.id;
      n_exp := n_exp + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'exercised', n_ex, 'expired', n_exp);
end$$;

create or replace function public.options_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'vol',      public._opt_vol(),
    'max_coll', public._ex_max_coll(),
    'max_open', public._ex_max_open(),
    'house',    public._house_pool(),
    'open', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'resource', p.resource, 'kind', p.kind, 'strike', p.strike,
        'contracts', p.contracts, 'premium_paid', p.premium_paid, 'spot_entry', p.spot_entry,
        'spot', public._ex_mark(p.resource), 'expires_at', p.expires_at,
        'intrinsic', floor(public._opt_intrinsic(p.kind, public._ex_mark(p.resource), p.strike) * p.contracts),
        'value', floor(public._opt_premium(p.kind, public._ex_mark(p.resource), p.strike,
                   greatest(0, extract(epoch from (p.expires_at - now()))/86400.0)) * p.contracts * 0.9))
      order by p.expires_at asc)
      from public.option_positions p
      where p.faction_id = fid and p.status = 'open'), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'resource', p.resource, 'kind', p.kind, 'strike', p.strike,
        'contracts', p.contracts, 'premium_paid', p.premium_paid, 'payout', p.payout,
        'realized', p.realized, 'status', p.status, 'closed_at', p.closed_at)
      order by p.closed_at desc)
      from (select * from public.option_positions
            where faction_id = fid and status in ('exercised','expired','closed')
            order by closed_at desc limit 12) p), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'price', price, 'base', base_price)
        order by base_price desc)
      from public.market_resources), '[]'::jsonb)
  );
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  ИНДЕКС (ETF) — пул дома + спред + потолок вложения. Самостоятельный
--  market_tick() УБРАН (игрок не может «протикать» рынок прямо перед сделкой).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.index_buy(p_gc numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; val numeric; px numeric; units numeric; spend bigint; cur_basis numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_gc is null or p_gc < 1 then raise exception 'bad amount'; end if;
  spend := floor(p_gc);
  fid := public._ec_my_fid();
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  if eco.gc < spend then raise exception 'not enough GC'; end if;
  perform public._ex_check_stake(spend, eco.gc);

  select value into val from public.market_index where id = 1;                 -- БЕЗ self-tick
  if val is null or val <= 0 then raise exception 'no index'; end if;

  cur_basis := coalesce((select basis from public.index_holdings where faction_id = fid), 0);
  if cur_basis + spend > public._ex_index_cap() then
    raise exception 'index position cap reached (max % GC invested)', public._ex_index_cap();
  end if;

  px    := val * (1 + public._ex_index_spread());        -- покупаешь чуть дороже индекса (спред дому)
  units := spend / px;

  update public.faction_economy set gc = gc - spend where faction_id = fid;
  perform public._house_take(spend);                     -- вложение паркуется в пул дома
  insert into public.index_holdings(faction_id, units, basis, updated_at)
    values (fid, units, spend, now())
    on conflict (faction_id) do update
      set units = public.index_holdings.units + excluded.units,
          basis = public.index_holdings.basis + excluded.basis,
          updated_at = now();

  return jsonb_build_object('ok', true, 'units', round(units,4), 'value', val, 'spent', spend);
end$$;

create or replace function public.index_sell(p_units numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; h public.index_holdings; val numeric; px numeric; proceeds bigint; pay bigint; basis_out numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_units is null or p_units <= 0 then raise exception 'bad units'; end if;
  fid := public._ec_my_fid();
  select * into h from public.index_holdings where faction_id = fid for update;
  if not found or h.units < p_units then raise exception 'not enough units'; end if;

  select value into val from public.market_index where id = 1;                 -- БЕЗ self-tick
  if val is null or val <= 0 then raise exception 'no index'; end if;

  px        := val * (1 - public._ex_index_spread());    -- продаёшь чуть дешевле индекса (спред дому)
  proceeds  := floor(p_units * px);
  pay       := public._house_pay(proceeds);              -- выплата из пула (обрезается остатком)
  basis_out := h.basis * (p_units / h.units);

  update public.index_holdings
     set units = units - p_units, basis = greatest(0, basis - basis_out), updated_at = now()
   where faction_id = fid;
  update public.faction_economy set gc = gc + pay where faction_id = fid;

  return jsonb_build_object('ok', true, 'proceeds', pay, 'value', val, 'pl', floor(pay - basis_out));
end$$;

create or replace function public.exchange_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'house',  public._house_pool(),
    'spread', public._ex_index_spread(),
    'cap',    public._ex_index_cap(),
    'index', jsonb_build_object(
       'value', (select value from public.market_index where id = 1),
       'base',  (select base_value from public.market_index where id = 1),
       'spark', coalesce((
          select jsonb_agg(price order by at)
          from (select price, at from public.market_price_history
                where name = '__INDEX__' order by at desc limit 24) z), '[]'::jsonb)
    ),
    'holdings', coalesce((
       select jsonb_build_object('units', units, 'basis', basis)
       from public.index_holdings where faction_id = fid),
       jsonb_build_object('units', 0, 'basis', 0)),
    'resources', coalesce((
       select jsonb_object_agg(name, spark)
       from (
         select name, jsonb_agg(price order by at) as spark
         from (
           select name, price, at,
                  row_number() over (partition by name order by at desc) rn
           from public.market_price_history where name <> '__INDEX__') q
         where rn <= 12
         group by name) s), '{}'::jsonb)
  );
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  market_tick() — НАДМНОЖЕСТВО (из _exchange_margin.sql) + восстановление пула.
--  Дотягиваем пул дома к базе ≤ _house_drip() за сутки (единственная и жёстко
--  ограниченная инфляция: даже опустошённый пул не печатает больше drip/сут).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.market_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare st public.market_state; d int; i int; shocked boolean := false;
begin
  begin perform public.bonds_settle();          exception when others then null; end;  -- облигации
  begin perform public.exchange_session_sync(); exception when others then null; end;  -- сессии биржи (open/close + дивиденды)
  begin perform public.margin_settle();         exception when others then null; end;  -- маржа: ликвидации
  begin perform public.futures_settle();        exception when others then null; end;  -- фьючерсы
  begin perform public.options_settle();        exception when others then null; end;  -- опционы

  select * into st from public.market_state where id = 1 for update;
  if not found then
    insert into public.market_state(id, last_tick) values(1, now()) on conflict (id) do nothing;
    select * into st from public.market_state where id = 1 for update;
  end if;
  d := floor(extract(epoch from (now() - st.last_tick)) / 86400.0);
  if d < 1 then return jsonb_build_object('ok', true, 'days', 0); end if;
  d := least(d, 30);

  for i in 1..d loop
    update public.market_resources
       set stock = greatest(1, stock + npc_supply*(0.6+random()*0.8) - npc_demand*(0.6+random()*0.8));
    update public.market_resources
       set stock = greatest(1, stock * (0.96 + random()*0.08));
    update public.market_resources
       set stock = stock + (equilibrium - stock) * 0.08;
  end loop;

  if random() < least(0.6, 0.12 * d) then
    perform public._market_shock();
    shocked := true;
  end if;

  update public.market_resources
     set price = public._market_price_calc(base_price, stock, equilibrium),
         updated_at = now();
  update public.market_index set value = public._market_index_value(), updated_at = now() where id = 1;

  -- восстановление пула дома к базе (ограниченное), best-effort. При drip=0
  -- блок не делает НИ ОДНОЙ записи (казино строго zero-sum, без печати).
  if public._house_drip() > 0 then
    begin
      update public.exchange_house
         set pool = least(public._house_baseline(), pool + public._house_drip() * d), updated_at = now()
       where id = 1 and pool < public._house_baseline();
    exception when others then null; end;
  end if;

  insert into public.market_price_history(name, price, stock, at)
    select name, price, stock, now() from public.market_resources;
  insert into public.market_price_history(name, price, stock, at)
    select '__INDEX__', value, 0, now() from public.market_index where id = 1;
  delete from public.market_price_history h using (
    select id, row_number() over (partition by name order by at desc) rn
    from public.market_price_history
  ) x where h.id = x.id and x.rn > 60;

  update public.market_state set last_tick = last_tick + (d || ' days')::interval where id = 1;
  return jsonb_build_object('ok', true, 'days', d, 'shock', shocked);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  ВОЗВРАТ ГРАНТОВ — отменяем revoke из _exchange_freeze.sql (create-or-replace
--  сохраняет старые привилегии, поэтому grant обязателен). Только точки входа
--  игрока; *_settle / *_status / market_tick уже доступны.
-- ════════════════════════════════════════════════════════════════════════════
grant execute on function public.index_buy(numeric)                          to authenticated;
grant execute on function public.index_sell(numeric)                         to authenticated;
grant execute on function public.margin_open(text,text,numeric,numeric)      to authenticated;
grant execute on function public.margin_close(uuid)                          to authenticated;
grant execute on function public.futures_open(text,text,numeric,numeric,int) to authenticated;
grant execute on function public.futures_close(uuid)                         to authenticated;
grant execute on function public.options_buy(text,text,numeric,numeric,int)  to authenticated;
grant execute on function public.options_close(uuid)                         to authenticated;
grant execute on function public.bond_buy(uuid,int)                          to authenticated;

-- Новые/переопределённые функции чтения/расчёта
grant execute on function public._ex_mark(text)                              to anon, authenticated;
grant execute on function public._house_pool()                               to anon, authenticated;
grant execute on function public.margin_status()                             to authenticated;
grant execute on function public.futures_status()                            to authenticated;
grant execute on function public.options_status()                            to authenticated;
grant execute on function public.exchange_status()                           to authenticated;
grant execute on function public.market_tick()                               to anon, authenticated;

-- PostgREST: подхватить новые сигнатуры и снятый revoke
notify pgrst, 'reload schema';

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select public._margin_max_lev();        -- = 2
-- 2) select public._house_pool();             -- сидбанк 100 000 (дрип выкл, дальше zero-sum)
-- 3) select public.margin_open('Железо','long', 100000, 3);  -- ИСКЛЮЧЕНИЕ: bad leverage (>2)
-- 4) select public.margin_open('Железо','long', 999999, 2);  -- ИСКЛЮЧЕНИЕ: stake too large
-- 5) select public.margin_open('Железо','long', 1000, 2);    -- ок; вход по mark-цене, залог ушёл в пул
-- 6) Накачать спот market_buy_resource('Железо', …) НЕ двигает mark (среднее истории) → манипуляция мертва
-- 7) Закрыть с прибылью: выплата приходит из пула и обрезается, если пул пуст
