-- ============================================================================
--  БИРЖА · СРЕЗ 5 — МАРЖИНАЛЬНАЯ ТОРГОВЛЯ (ЛОНГИ/ШОРТЫ С ПЛЕЧОМ)
--  Применять в Supabase → SQL Editor ПОСЛЕ _exchange_corps.sql. Идемпотентно.
--  Зависит от: _market_setup.sql (market_resources / _market_ensure /
--    _market_price_calc / market_tick), _exchange_bonds.sql (bonds_settle),
--    _exchange_corps.sql (exchange_session_sync — хуки сессии), _security_money.sql
--    (_ec_my_fid, current_user_banned), _economy_setup.sql (faction_economy).
--
--  ИДЕЯ. Игрок ставит на ДВИЖЕНИЕ живой цены ресурса (market_resources.price),
--  НЕ покупая сам ресурс — расчёт деньгами (cash-settled). Открывая позицию,
--  он вносит ЗАЛОГ (collateral); номинал позиции = залог × ПЛЕЧО (leverage,
--  до ×10). Размер в единицах = номинал / цена входа.
--    ЛОНГ  — прибыль, если цена выросла:  pnl = size × (price − entry)
--    ШОРТ  — прибыль, если цена упала:    pnl = size × (entry − price)
--  Капитал позиции = залог + pnl. Если он падает ниже МАРЖИ ПОДДЕРЖАНИЯ
--  (mm = 5% номинала) — ЛИКВИДАЦИЯ: позиция принудительно закрывается, остаток
--  (обычно крохи) возвращается, залог сгорает. Контрагент — «дом» (биржа):
--  выигрыш печатает ГС, проигрыш сжигает — симметрично, как ETF-паи индекса.
--
--  Цена «маркируется к рынку» (mark-to-market) и ликвидации ловятся в
--  margin_settle(), вызываемой из market_tick() (best-effort, каждый прогон).
--  Закрытие вручную — margin_close(). Чтение для UI — margin_status().
-- ============================================================================

-- ── Маржинальные позиции ────────────────────────────────────────────────────
create table if not exists public.margin_positions (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  resource    text not null,
  side        text not null,                 -- long | short
  size_units  numeric not null,              -- номинал / цена входа
  entry_price numeric not null,
  collateral  numeric not null,              -- внесённый залог (ГС)
  leverage    numeric not null,              -- кредитное плечо (1..10)
  liq_price   numeric not null,              -- цена принудительного закрытия
  status      text not null default 'open',  -- open | closed | liquidated
  exit_price  numeric,
  realized    numeric,                       -- реализованный P/L (выплата − залог)
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz
);
create index if not exists mp_fac    on public.margin_positions(faction_id);
create index if not exists mp_status on public.margin_positions(status);
alter table public.margin_positions enable row level security;
-- RLS без политик: чтение через margin_status(), записи только через RPC.

-- ── Параметры маржинальной торговли ─────────────────────────────────────────
--    mm — маржа поддержания (доля номинала). max_lev — потолок плеча.
create or replace function public._margin_mm()      returns numeric language sql immutable as $$ select 0.05::numeric $$;
create or replace function public._margin_max_lev() returns numeric language sql immutable as $$ select 10::numeric  $$;

-- ── Цена ликвидации (где капитал = mm × номинал) ────────────────────────────
--    long:  entry × (1 + mm − 1/lev)      short: entry × (1 − mm + 1/lev)
create or replace function public._margin_liq_price(p_side text, p_entry numeric, p_lev numeric)
returns numeric language sql immutable as $$
  select case when p_side = 'long'
    then round(p_entry * (1 + public._margin_mm() - 1/greatest(p_lev,1)), 4)
    else round(p_entry * (1 - public._margin_mm() + 1/greatest(p_lev,1)), 4)
  end
$$;

-- ── P/L позиции при цене p_price ────────────────────────────────────────────
create or replace function public._margin_pnl(p_side text, p_size numeric, p_entry numeric, p_price numeric)
returns numeric language sql immutable as $$
  select case when p_side = 'long'
    then p_size * (p_price - p_entry)
    else p_size * (p_entry - p_price)
  end
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  margin_open() — открыть позицию. Залог списывается из казны сейчас.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.margin_open(p_resource text, p_side text, p_collateral numeric, p_leverage numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; mr public.market_resources;
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
  if open_cnt >= 20 then raise exception 'too many open positions'; end if;   -- антиспам

  select * into eco from public.faction_economy where faction_id = fid for update;   -- сериализация казны
  if not found then raise exception 'no economy'; end if;
  if eco.gc < coll then raise exception 'not enough GC'; end if;

  mr := public._market_ensure(p_resource);   -- блокирует/создаёт строку рынка
  entry := mr.price;
  if entry is null or entry <= 0 then raise exception 'no market price'; end if;
  notional := coll * lev;
  size     := notional / entry;
  liq      := public._margin_liq_price(p_side, entry, lev);

  update public.faction_economy set gc = gc - coll where faction_id = fid;
  insert into public.margin_positions(faction_id, resource, side, size_units, entry_price, collateral, leverage, liq_price)
    values (fid, p_resource, p_side, size, entry, coll, lev, liq)
    returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'entry', entry, 'size', round(size,4), 'liq', liq);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  margin_close() — закрыть свою открытую позицию по текущей цене.
--    Выплата = max(0, залог + pnl). Реализованный P/L = выплата − залог.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.margin_close(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; pos public.margin_positions; mr public.market_resources; px numeric; pnl numeric; equity numeric; payout numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into pos from public.margin_positions where id = p_id for update;
  if not found then raise exception 'no position'; end if;
  if pos.faction_id <> fid then raise exception 'not your position'; end if;
  if pos.status <> 'open' then raise exception 'position not open'; end if;

  mr     := public._market_ensure(pos.resource);
  px     := mr.price;
  pnl    := public._margin_pnl(pos.side, pos.size_units, pos.entry_price, px);
  equity := pos.collateral + pnl;
  payout := greatest(0, floor(equity));

  update public.faction_economy set gc = gc + payout where faction_id = fid;
  update public.margin_positions
     set status = 'closed', exit_price = px, realized = payout - pos.collateral, closed_at = now()
   where id = pos.id;

  return jsonb_build_object('ok', true, 'payout', payout, 'pnl', floor(pnl), 'price', px);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  margin_settle() — mark-to-market + ликвидации. Идемпотентна: реагирует на
--  текущую цену; ликвидация — одноразовая смена статуса. Best-effort из тика.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.margin_settle()
returns jsonb language plpgsql security definer set search_path=public as $$
declare pos record; px numeric; pnl numeric; equity numeric; notional numeric; payout numeric; n int := 0;
begin
  for pos in select * from public.margin_positions where status = 'open' for update loop
    select price into px from public.market_resources where name = pos.resource;
    if px is null then continue; end if;
    pnl      := public._margin_pnl(pos.side, pos.size_units, pos.entry_price, px);
    equity   := pos.collateral + pnl;
    notional := pos.size_units * pos.entry_price;
    if equity <= notional * public._margin_mm() then
      payout := greatest(0, floor(equity));
      update public.faction_economy set gc = gc + payout where faction_id = pos.faction_id;
      update public.margin_positions
         set status = 'liquidated', exit_price = px, realized = payout - pos.collateral, closed_at = now()
       where id = pos.id;
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'liquidated', n);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  Хук margin_settle в market_tick(). Канонический супермножество-тик: все
--  биржевые расчёты best-effort (несуществующие функции просто игнорируются —
--  порядок применения срезов 5/6/7 не важен), затем суточная симуляция рынка.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.market_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare st public.market_state; d int; i int; shocked boolean := false;
begin
  begin perform public.bonds_settle();          exception when others then null; end;  -- облигации
  begin perform public.exchange_session_sync(); exception when others then null; end;  -- сессии биржи (open/close + дивиденды)
  begin perform public.margin_settle();         exception when others then null; end;  -- маржа: ликвидации
  begin perform public.futures_settle();        exception when others then null; end;  -- фьючерсы (срез 6, если применён)
  begin perform public.options_settle();        exception when others then null; end;  -- опционы (срез 7, если применён)

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
--  margin_status() — данные для UI: мои открытые/недавно закрытые позиции с
--  живым P/L + сводка по счёту + список торгуемых ресурсов (живые цены).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.margin_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'mm',      public._margin_mm(),
    'max_lev', public._margin_max_lev(),
    'open', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'resource', p.resource, 'side', p.side,
        'size', p.size_units, 'entry', p.entry_price, 'collateral', p.collateral,
        'leverage', p.leverage, 'liq', p.liq_price,
        'price', coalesce(mr.price, p.entry_price),
        'notional', round(p.size_units * p.entry_price),
        'pnl', floor(public._margin_pnl(p.side, p.size_units, p.entry_price, coalesce(mr.price, p.entry_price))),
        'opened_at', p.opened_at)
      order by p.opened_at desc)
      from public.margin_positions p
      left join public.market_resources mr on mr.name = p.resource
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

-- ── Права ───────────────────────────────────────────────────────────────────
revoke all on function public.market_tick()                                from public;
revoke all on function public.margin_open(text,text,numeric,numeric)       from public;
revoke all on function public.margin_close(uuid)                           from public;
revoke all on function public.margin_settle()                              from public;
revoke all on function public.margin_status()                              from public;
grant execute on function public.market_tick()                             to anon, authenticated;
grant execute on function public.margin_open(text,text,numeric,numeric)    to authenticated;
grant execute on function public.margin_close(uuid)                        to authenticated;
grant execute on function public.margin_settle()                           to anon, authenticated;
grant execute on function public.margin_status()                           to authenticated;

-- PostgREST: обновить кэш схемы (иначе новые RPC «не видны» до перезапуска)
notify pgrst, 'reload schema';

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select public.margin_open('Железо','long', 1000, 5);   -- лонг с плечом ×5
-- 2) select public.margin_status();                          -- открытая позиция, живой P/L
-- 3) select public.market_buy_resource('Железо', 200000);    -- двинуть цену вверх → лонг в плюсе
-- 4) select public.margin_close('<id>');                     -- зафиксировать прибыль
-- 5) Шорт и обвал цены ниже liq_price → market_tick() → позиция 'liquidated'
