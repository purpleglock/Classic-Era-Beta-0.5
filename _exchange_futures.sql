-- ============================================================================
--  БИРЖА · СРЕЗ 6 — ФЬЮЧЕРСЫ (срочные контракты на ресурс)
--  Применять в Supabase → SQL Editor ПОСЛЕ _exchange_margin.sql. Идемпотентно.
--  Зависит от: _exchange_margin.sql (_margin_mm / _margin_max_lev /
--    _margin_liq_price / _margin_pnl — общая маржинальная механика),
--    _market_setup.sql (_market_ensure), _security_money.sql (_ec_my_fid).
--
--  ИДЕЯ. Фьючерс — маржинальная позиция с ДАТОЙ ЭКСПИРАЦИИ. Вход не по спот-цене,
--  а по ФЬЮЧЕРСНОЙ: fut = spot × (1 + контанго × дней). Контанго (надбавка за
--  срок) тает по мере приближения экспирации — это «базис», который сходится к
--  споту. На экспирации позиция принудительно закрывается по СПОТ-цене:
--    long  pnl = size × (spot − fut_entry)    short pnl = size × (fut_entry − spot)
--  Лонг, держа контракт при стоящей цене, теряет премию контанго — реалистично.
--  До экспирации работает та же ЛИКВИДАЦИЯ по марже поддержания, что и в марже.
--  Расчёт (ликвидации + экспирация) — futures_settle() из market_tick().
-- ============================================================================

-- ── Фьючерсные позиции ──────────────────────────────────────────────────────
create table if not exists public.futures_positions (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  resource    text not null,
  side        text not null,                 -- long | short
  size_units  numeric not null,
  entry_price numeric not null,              -- фьючерсная цена входа (со спредом контанго)
  spot_entry  numeric not null,              -- спот на момент открытия (для справки)
  collateral  numeric not null,
  leverage    numeric not null,
  liq_price   numeric not null,
  expires_at  timestamptz not null,
  status      text not null default 'open',  -- open | settled | liquidated | closed
  exit_price  numeric,
  realized    numeric,
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz
);
create index if not exists fp_fac    on public.futures_positions(faction_id);
create index if not exists fp_status on public.futures_positions(status);
alter table public.futures_positions enable row level security;

-- ── Контанго: суточная надбавка фьючерса над спотом ─────────────────────────
create or replace function public._fut_contango_day() returns numeric language sql immutable as $$ select 0.0008::numeric $$;

-- ── Фьючерсная цена на p_days вперёд от спота ────────────────────────────────
create or replace function public._fut_price(p_spot numeric, p_days int)
returns numeric language sql immutable as $$
  select round(p_spot * (1 + public._fut_contango_day() * greatest(p_days,0)), 4)
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  futures_open() — открыть фьючерс. Залог списывается сейчас, вход по fut-цене.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.futures_open(p_resource text, p_side text, p_collateral numeric, p_leverage numeric, p_term_days int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; mr public.market_resources;
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
  if open_cnt >= 20 then raise exception 'too many open futures'; end if;

  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  if eco.gc < coll then raise exception 'not enough GC'; end if;

  mr := public._market_ensure(p_resource);
  spot := mr.price;
  if spot is null or spot <= 0 then raise exception 'no market price'; end if;
  fut      := public._fut_price(spot, p_term_days);
  notional := coll * lev;
  size     := notional / fut;
  liq      := public._margin_liq_price(p_side, fut, lev);

  update public.faction_economy set gc = gc - coll where faction_id = fid;
  insert into public.futures_positions(faction_id, resource, side, size_units, entry_price, spot_entry, collateral, leverage, liq_price, expires_at)
    values (fid, p_resource, p_side, size, fut, spot, coll, lev, liq, now() + (p_term_days || ' days')::interval)
    returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'fut', fut, 'spot', spot, 'size', round(size,4), 'liq', liq);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  futures_close() — закрыть досрочно по текущему споту (расчёт vs fut-вход).
-- ════════════════════════════════════════════════════════════════════════════
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

  select price into px from public.market_resources where name = pos.resource;
  px     := coalesce(px, pos.entry_price);
  pnl    := public._margin_pnl(pos.side, pos.size_units, pos.entry_price, px);
  payout := greatest(0, floor(pos.collateral + pnl));

  update public.faction_economy set gc = gc + payout where faction_id = fid;
  update public.futures_positions
     set status = 'closed', exit_price = px, realized = payout - pos.collateral, closed_at = now()
   where id = pos.id;
  return jsonb_build_object('ok', true, 'payout', payout, 'pnl', floor(pnl), 'price', px);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  futures_settle() — ликвидации (марж. поддержание) + расчёт по экспирации.
--  Best-effort из market_tick(). Идемпотентна по состоянию (статус меняется раз).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.futures_settle()
returns jsonb language plpgsql security definer set search_path=public as $$
declare pos record; px numeric; pnl numeric; equity numeric; notional numeric; payout numeric; n_liq int := 0; n_set int := 0;
begin
  for pos in select * from public.futures_positions where status = 'open' for update loop
    select price into px from public.market_resources where name = pos.resource;
    if px is null then continue; end if;
    pnl      := public._margin_pnl(pos.side, pos.size_units, pos.entry_price, px);
    equity   := pos.collateral + pnl;
    notional := pos.size_units * pos.entry_price;

    if equity <= notional * public._margin_mm() then
      -- ликвидация до срока
      payout := greatest(0, floor(equity));
      update public.faction_economy set gc = gc + payout where faction_id = pos.faction_id;
      update public.futures_positions
         set status = 'liquidated', exit_price = px, realized = payout - pos.collateral, closed_at = now()
       where id = pos.id;
      n_liq := n_liq + 1;
    elsif pos.expires_at <= now() then
      -- экспирация: расчёт по спот-цене (базис сошёлся)
      payout := greatest(0, floor(equity));
      update public.faction_economy set gc = gc + payout where faction_id = pos.faction_id;
      update public.futures_positions
         set status = 'settled', exit_price = px, realized = payout - pos.collateral, closed_at = now()
       where id = pos.id;
      n_set := n_set + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'liquidated', n_liq, 'settled', n_set);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  futures_status() — мои открытые/закрытые фьючерсы + торгуемые ресурсы.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.futures_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'mm',          public._margin_mm(),
    'max_lev',     public._margin_max_lev(),
    'contango_day',public._fut_contango_day(),
    'open', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'resource', p.resource, 'side', p.side,
        'size', p.size_units, 'entry', p.entry_price, 'spot_entry', p.spot_entry,
        'collateral', p.collateral, 'leverage', p.leverage, 'liq', p.liq_price,
        'price', coalesce(mr.price, p.entry_price), 'expires_at', p.expires_at,
        'notional', round(p.size_units * p.entry_price),
        'pnl', floor(public._margin_pnl(p.side, p.size_units, p.entry_price, coalesce(mr.price, p.entry_price))))
      order by p.expires_at asc)
      from public.futures_positions p
      left join public.market_resources mr on mr.name = p.resource
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

-- ── Права ───────────────────────────────────────────────────────────────────
revoke all on function public.futures_open(text,text,numeric,numeric,int) from public;
revoke all on function public.futures_close(uuid)                         from public;
revoke all on function public.futures_settle()                            from public;
revoke all on function public.futures_status()                            from public;
grant execute on function public.futures_open(text,text,numeric,numeric,int) to authenticated;
grant execute on function public.futures_close(uuid)                      to authenticated;
grant execute on function public.futures_settle()                         to anon, authenticated;
grant execute on function public.futures_status()                         to authenticated;

notify pgrst, 'reload schema';

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select public.futures_open('Платина','long', 2000, 4, 14);  -- фьючерс на 14 дней
-- 2) select public.futures_status();                              -- вход = spot×(1+контанго×14)
-- 3) Сдвинуть expires_at назад → select public.market_tick();     -- расчёт по споту ('settled')
-- 4) Обвал ниже liq_price → market_tick → 'liquidated'
