-- ============================================================================
--  БИРЖА · СРЕЗ 7 — ОПЦИОНЫ (колл/пут за премию)
--  Применять в Supabase → SQL Editor ПОСЛЕ _exchange_margin.sql. Идемпотентно.
--  Зависит от: _market_setup.sql (_market_ensure / market_resources),
--    _exchange_margin.sql (market_tick уже зовёт options_settle best-effort),
--    _security_money.sql (_ec_my_fid), _economy_setup.sql (faction_economy).
--
--  ИДЕЯ. Опцион — ПРАВО (не обязанность) на выплату по страйку K на дату.
--    КОЛЛ — выигрывает при росте: payoff = max(0, spot − K) × контрактов
--    ПУТ  — выигрывает при падении: payoff = max(0, K − spot) × контрактов
--  Покупатель платит ПРЕМИЮ вперёд (в «дом»). На экспирации опцион
--  автоматически исполняется по спот-цене (европейский): если в деньгах —
--  выплата, иначе сгорает (премия = максимальный убыток). До экспирации можно
--  закрыть досрочно по текущей теоретической стоимости (со спредом).
--
--  Премия = внутренняя стоимость + временная (волатильность × √срок). Цена
--  считается на сервере при покупке; клиент показывает превью той же формулой.
--  Расчёт исполнений — options_settle() из market_tick() (best-effort).
-- ============================================================================

-- ── Опционные позиции ───────────────────────────────────────────────────────
create table if not exists public.option_positions (
  id           uuid primary key default gen_random_uuid(),
  faction_id   text not null,
  resource     text not null,
  kind         text not null,                -- call | put
  strike       numeric not null,
  contracts    numeric not null,
  premium_paid numeric not null,             -- суммарно уплачено за вход
  spot_entry   numeric not null,
  expires_at   timestamptz not null,
  status       text not null default 'open', -- open | exercised | expired | closed
  exit_spot    numeric,
  payout       numeric,                       -- выплата при исполнении/закрытии
  realized     numeric,                       -- выплата − премия
  opened_at    timestamptz not null default now(),
  closed_at    timestamptz
);
create index if not exists op_fac    on public.option_positions(faction_id);
create index if not exists op_status on public.option_positions(status);
alter table public.option_positions enable row level security;

-- ── Подразумеваемая волатильность (упрощённо — единая) ──────────────────────
create or replace function public._opt_vol() returns numeric language sql immutable as $$ select 0.45::numeric $$;

-- ── Премия одного контракта: внутренняя + временная стоимость ────────────────
--    intrinsic + spot × vol × √(дней/365) × 0.5 ; минимум 1.
create or replace function public._opt_premium(p_kind text, p_spot numeric, p_strike numeric, p_days numeric)
returns numeric language sql immutable as $$
  select greatest(1, round(
      greatest(0, case when p_kind = 'call' then p_spot - p_strike else p_strike - p_spot end)
    + p_spot * public._opt_vol() * power(greatest(p_days,0)/365.0, 0.5) * 0.5
  , 2))
$$;

-- ── Внутренняя стоимость одного контракта при споте ─────────────────────────
create or replace function public._opt_intrinsic(p_kind text, p_spot numeric, p_strike numeric)
returns numeric language sql immutable as $$
  select greatest(0, case when p_kind = 'call' then p_spot - p_strike else p_strike - p_spot end)
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  options_buy() — купить опцион. Премия списывается сейчас.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.options_buy(p_resource text, p_kind text, p_strike numeric, p_contracts numeric, p_term_days int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; mr public.market_resources;
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
  if open_cnt >= 20 then raise exception 'too many open options'; end if;

  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;

  mr := public._market_ensure(p_resource);
  spot := mr.price;
  if spot is null or spot <= 0 then raise exception 'no market price'; end if;
  prem := public._opt_premium(p_kind, spot, strike, p_term_days);
  cost := ceil(prem * ct);
  if eco.gc < cost then raise exception 'not enough GC'; end if;

  update public.faction_economy set gc = gc - cost where faction_id = fid;
  insert into public.option_positions(faction_id, resource, kind, strike, contracts, premium_paid, spot_entry, expires_at)
    values (fid, p_resource, p_kind, strike, ct, cost, spot, now() + (p_term_days || ' days')::interval)
    returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'premium', cost, 'unit_premium', prem, 'spot', spot);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  options_close() — продать опцион досрочно по текущей теоретической стоимости
--    со спредом ×0.9 (дом удерживает спред).
-- ════════════════════════════════════════════════════════════════════════════
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

  select price into spot from public.market_resources where name = pos.resource;
  spot     := coalesce(spot, pos.spot_entry);
  days     := greatest(0, extract(epoch from (pos.expires_at - now())) / 86400.0);
  val      := public._opt_premium(pos.kind, spot, pos.strike, days);   -- текущая теор. стоимость 1 контракта
  v_payout := floor(val * pos.contracts * 0.9);                        -- спред дома

  update public.faction_economy set gc = gc + v_payout where faction_id = fid;
  update public.option_positions
     set status = 'closed', exit_spot = spot, payout = v_payout, realized = v_payout - pos.premium_paid, closed_at = now()
   where id = pos.id;
  return jsonb_build_object('ok', true, 'payout', v_payout, 'spot', spot);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  options_settle() — исполнение опционов в срок по спот-цене. Best-effort из
--  market_tick(). Идемпотентна (статус меняется один раз на экспирации).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.options_settle()
returns jsonb language plpgsql security definer set search_path=public as $$
declare pos record; spot numeric; intr numeric; v_payout numeric; n_ex int := 0; n_exp int := 0;
begin
  for pos in select * from public.option_positions where status = 'open' and expires_at <= now() for update loop
    select price into spot from public.market_resources where name = pos.resource;
    spot := coalesce(spot, pos.spot_entry);
    intr := public._opt_intrinsic(pos.kind, spot, pos.strike);
    if intr > 0 then
      v_payout := floor(intr * pos.contracts);
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

-- ════════════════════════════════════════════════════════════════════════════
--  options_status() — мои открытые/закрытые опционы + торгуемые ресурсы.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.options_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'vol', public._opt_vol(),
    'open', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'resource', p.resource, 'kind', p.kind, 'strike', p.strike,
        'contracts', p.contracts, 'premium_paid', p.premium_paid, 'spot_entry', p.spot_entry,
        'spot', coalesce(mr.price, p.spot_entry), 'expires_at', p.expires_at,
        'intrinsic', floor(public._opt_intrinsic(p.kind, coalesce(mr.price, p.spot_entry), p.strike) * p.contracts),
        'value', floor(public._opt_premium(p.kind, coalesce(mr.price, p.spot_entry), p.strike,
                   greatest(0, extract(epoch from (p.expires_at - now()))/86400.0)) * p.contracts * 0.9))
      order by p.expires_at asc)
      from public.option_positions p
      left join public.market_resources mr on mr.name = p.resource
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

-- ── Права ───────────────────────────────────────────────────────────────────
revoke all on function public.options_buy(text,text,numeric,numeric,int) from public;
revoke all on function public.options_close(uuid)                        from public;
revoke all on function public.options_settle()                           from public;
revoke all on function public.options_status()                           from public;
grant execute on function public.options_buy(text,text,numeric,numeric,int) to authenticated;
grant execute on function public.options_close(uuid)                     to authenticated;
grant execute on function public.options_settle()                        to anon, authenticated;
grant execute on function public.options_status()                        to authenticated;

notify pgrst, 'reload schema';

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select public.options_buy('Дейтерий','call', 70, 100, 21);  -- колл, страйк 70, 100 контрактов, 21 день
-- 2) select public.options_status();                              -- премия списана, внутренняя/теор. стоимость
-- 3) Поднять цену выше страйка → сдвинуть expires_at назад → market_tick → 'exercised' + выплата
-- 4) select public.options_close('<id>');                         -- досрочно по теор. стоимости (×0.9)
