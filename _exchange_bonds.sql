-- ============================================================================
--  БИРЖА · СРЕЗ 3 — ГОСУДАРСТВЕННЫЕ ОБЛИГАЦИИ (долг)
--  Применять в Supabase → SQL Editor ПОСЛЕ _market_sim.sql. Идемпотентно.
--  Зависит от: _market_sim.sql (market_tick), _security_money.sql (_ec_my_fid),
--    _economy_setup.sql (faction_economy, _fac_name), _news_mentions.sql
--    (_post_life_news — хроника для дефолтов).
--
--  ИДЕЯ. Облигация — долговая бумага. Фракция-ЭМИТЕНТ выпускает заём: задаёт
--  номинал одной бумаги (face), купон в сутки (coupon_bps — б.п. от номинала),
--  объём (units) и срок (term). Инвесторы ПОКУПАЮТ бумаги → их ГС уходят
--  эмитенту СЕЙЧАС. Каждый ход эмитент платит купон держателям; в срок гасит
--  номинал. Если в момент выплаты у эмитента не хватает ГС → ДЕФОЛТ: купоны
--  стоп, номинал не возвращается (риск инвестора = доходность бумаги).
--
--  Расчёт купонов/погашений — в bonds_settle(), вызывается из market_tick()
--  (идемпотентно по суткам через bond_state.last_tick). Чтение для UI —
--  bonds_status(). Все записи — только через SECURITY DEFINER RPC.
-- ============================================================================

-- ── Выпуски облигаций ───────────────────────────────────────────────────────
create table if not exists public.bond_issues (
  id          uuid primary key default gen_random_uuid(),
  issuer_fid  text not null,
  issuer_name text,
  face        numeric not null,           -- номинал одной бумаги (принципал)
  coupon_bps  int not null,               -- купон/сутки, б.п. от номинала (100 = 1%/сут)
  units_total int not null,
  units_left  int not null,               -- ещё не размещено (доступно к покупке)
  matures_at  timestamptz not null,
  status      text not null default 'open',  -- open | redeemed | default | cancelled
  created_at  timestamptz not null default now()
);
create index if not exists bi_issuer on public.bond_issues(issuer_fid);
create index if not exists bi_status on public.bond_issues(status);
alter table public.bond_issues enable row level security;
-- RLS без политик: чтение через bonds_status(), записи через RPC

-- ── Держания (кто сколько бумаг каждого выпуска) ────────────────────────────
create table if not exists public.bond_holdings (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references public.bond_issues(id) on delete cascade,
  holder_fid text not null,
  units      int not null,
  created_at timestamptz not null default now(),
  unique (issue_id, holder_fid)
);
create index if not exists bh_holder on public.bond_holdings(holder_fid);
alter table public.bond_holdings enable row level security;

-- ── Идемпотентный суточный счётчик расчётов ─────────────────────────────────
create table if not exists public.bond_state (
  id        int primary key default 1,
  last_tick timestamptz not null default now()
);
insert into public.bond_state(id, last_tick) values(1, now()) on conflict (id) do nothing;
alter table public.bond_state enable row level security;

-- ════════════════════════════════════════════════════════════════════════════
--  bonds_settle() — выплата купонов и погашение в срок. Идемпотентно по суткам.
--  При нехватке ГС у эмитента в момент выплаты → выпуск уходит в 'default'.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.bonds_settle()
returns jsonb language plpgsql security definer set search_path=public as $$
declare st public.bond_state; d int; iss record; h record;
        v_units int; v_total numeric; v_gc numeric; v_principal numeric; n int := 0;
begin
  select * into st from public.bond_state where id = 1 for update;
  if not found then
    insert into public.bond_state(id,last_tick) values(1, now()) on conflict (id) do nothing;
    select * into st from public.bond_state where id = 1 for update;
  end if;
  d := floor(extract(epoch from (now() - st.last_tick)) / 86400.0);
  if d < 1 then return jsonb_build_object('ok', true, 'days', 0); end if;
  d := least(d, 30);

  for iss in select * from public.bond_issues where status = 'open' for update loop
    select coalesce(sum(units),0) into v_units from public.bond_holdings where issue_id = iss.id;
    if v_units = 0 then
      -- ничего не размещено: если срок вышел — просто закрываем выпуск
      if iss.matures_at <= now() then
        update public.bond_issues set status = 'redeemed' where id = iss.id;
      end if;
      continue;
    end if;

    -- купон за d суток на размещённый объём (сумма округлённых выплат держателям)
    select coalesce(sum(round(d * iss.face * iss.coupon_bps / 10000.0 * units)),0)
      into v_total from public.bond_holdings where issue_id = iss.id;

    select gc into v_gc from public.faction_economy where faction_id = iss.issuer_fid for update;
    if v_gc is null then continue; end if;   -- эмитент исчез — пропускаем

    if v_total > 0 then
      if v_gc < v_total then
        -- дефолт по купону: выплаты стоп, номинал не вернётся
        update public.bond_issues set status = 'default' where id = iss.id;
        begin perform public._post_life_news(
          '🏛 Дефолт по облигациям: ' || coalesce(iss.issuer_name, public._fac_name(iss.issuer_fid)),
          format('%s не смогла обслужить купон по своему займу — выпуск объявлен дефолтным. Держатели теряют вложенное.',
                 coalesce(iss.issuer_name, public._fac_name(iss.issuer_fid))),
          'rgba(224,104,138,0.55)', jsonb_build_array(iss.issuer_fid)); exception when others then null; end;
        delete from public.bond_holdings where issue_id = iss.id;   -- держатели потеряли вложенное — убираем мёртвые бумаги
        continue;
      end if;
      update public.faction_economy set gc = gc - v_total where faction_id = iss.issuer_fid;
      for h in select * from public.bond_holdings where issue_id = iss.id loop
        update public.faction_economy
           set gc = gc + round(d * iss.face * iss.coupon_bps / 10000.0 * h.units)
         where faction_id = h.holder_fid;
      end loop;
      n := n + 1;
    end if;

    -- погашение номинала в срок
    if iss.matures_at <= now() then
      v_principal := iss.face * v_units;
      select gc into v_gc from public.faction_economy where faction_id = iss.issuer_fid for update;
      if v_gc < v_principal then
        update public.bond_issues set status = 'default' where id = iss.id;
        begin perform public._post_life_news(
          '🏛 Дефолт при погашении: ' || coalesce(iss.issuer_name, public._fac_name(iss.issuer_fid)),
          format('%s не вернула номинал по истёкшему займу — выпуск дефолтный.',
                 coalesce(iss.issuer_name, public._fac_name(iss.issuer_fid))),
          'rgba(224,104,138,0.55)', jsonb_build_array(iss.issuer_fid)); exception when others then null; end;
        delete from public.bond_holdings where issue_id = iss.id;   -- дефолт при погашении — номинал не вернётся, чистим бумаги
        continue;
      end if;
      update public.faction_economy set gc = gc - v_principal where faction_id = iss.issuer_fid;
      for h in select * from public.bond_holdings where issue_id = iss.id loop
        update public.faction_economy set gc = gc + iss.face * h.units where faction_id = h.holder_fid;
      end loop;
      delete from public.bond_holdings where issue_id = iss.id;
      update public.bond_issues set status = 'redeemed' where id = iss.id;
    end if;
  end loop;

  update public.bond_state set last_tick = last_tick + (d || ' days')::interval where id = 1;
  return jsonb_build_object('ok', true, 'days', d, 'settled', n);
end$$;

-- ── Хук расчётов в market_tick(): тело из _market_sim.sql + bonds_settle() ───
--    Вызываем bonds_settle() ПЕРВЫМ (до раннего выхода при d<1), best-effort.
create or replace function public.market_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare st public.market_state; d int; i int; shocked boolean := false;
begin
  begin perform public.bonds_settle(); exception when others then null; end;  -- облигации: купоны/погашение

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
--  bond_issue() — выпустить заём. ГС придут по мере покупки инвесторами.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.bond_issue(p_face numeric, p_units int, p_coupon_bps int, p_term_days int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; nm text; open_cnt int; v_id uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_face is null or p_face < 1 then raise exception 'bad face'; end if;
  if p_units is null or p_units < 1 or p_units > 100000 then raise exception 'bad units'; end if;
  if p_coupon_bps is null or p_coupon_bps < 1 or p_coupon_bps > 1000 then raise exception 'bad coupon'; end if;  -- ≤10%/сут
  if p_term_days is null or p_term_days < 1 or p_term_days > 120 then raise exception 'bad term'; end if;
  fid := public._ec_my_fid();
  select count(*) into open_cnt from public.bond_issues where issuer_fid = fid and status = 'open';
  if open_cnt >= 5 then raise exception 'too many open issues'; end if;   -- антиспам
  nm := coalesce(nullif(public._fac_name(fid),''), 'Эмитент');
  insert into public.bond_issues(issuer_fid, issuer_name, face, coupon_bps, units_total, units_left, matures_at)
    values (fid, nm, floor(p_face), p_coupon_bps, p_units, p_units, now() + (p_term_days || ' days')::interval)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  bond_buy() — купить p_units бумаг выпуска: ГС → эмитенту, бумаги → вам.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.bond_buy(p_issue_id uuid, p_units int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; iss public.bond_issues; eco public.faction_economy; cost numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_units is null or p_units < 1 then raise exception 'bad units'; end if;
  fid := public._ec_my_fid();
  select * into iss from public.bond_issues where id = p_issue_id for update;
  if not found then raise exception 'no issue'; end if;
  if iss.status <> 'open' then raise exception 'issue closed'; end if;
  if iss.issuer_fid = fid then raise exception 'cannot buy own bonds'; end if;
  if iss.units_left < p_units then raise exception 'not enough units left'; end if;

  -- FOR UPDATE на казне покупателя (анти-double-spend)
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  cost := iss.face * p_units;
  if eco.gc < cost then raise exception 'not enough GC'; end if;

  update public.faction_economy set gc = gc - cost where faction_id = fid;
  update public.faction_economy set gc = gc + cost where faction_id = iss.issuer_fid;   -- эмитент получает заём сейчас
  update public.bond_issues set units_left = units_left - p_units where id = iss.id;
  insert into public.bond_holdings(issue_id, holder_fid, units)
    values (iss.id, fid, p_units)
    on conflict (issue_id, holder_fid) do update set units = public.bond_holdings.units + excluded.units;

  return jsonb_build_object('ok', true, 'cost', cost);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  bond_cancel() — снять свой выпуск, пока ничего не размещено.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.bond_cancel(p_issue_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; iss public.bond_issues;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into iss from public.bond_issues where id = p_issue_id for update;
  if not found then raise exception 'no issue'; end if;
  if iss.issuer_fid <> fid then raise exception 'not your issue'; end if;
  if iss.status <> 'open' then raise exception 'issue closed'; end if;
  if iss.units_left <> iss.units_total then raise exception 'already placed'; end if;   -- есть держатели — нельзя
  update public.bond_issues set status = 'cancelled' where id = iss.id;
  return jsonb_build_object('ok', true);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  bonds_status() — данные для UI: мои выпуски, мои держания, рынок чужих бумаг.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.bonds_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'issuer', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'face', i.face, 'coupon_bps', i.coupon_bps,
        'units_total', i.units_total, 'units_left', i.units_left,
        'units_sold', i.units_total - i.units_left,
        'matures_at', i.matures_at, 'status', i.status,
        'daily_coupon', round(i.face * i.coupon_bps / 10000.0 * (i.units_total - i.units_left))
      ) order by i.created_at desc)
      from public.bond_issues i where i.issuer_fid = fid), '[]'::jsonb),
    'holdings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'issue_id', i.id, 'issuer_name', coalesce(i.issuer_name, public._fac_name(i.issuer_fid)),
        'units', h.units, 'face', i.face, 'coupon_bps', i.coupon_bps,
        'matures_at', i.matures_at, 'status', i.status,
        'value', i.face * h.units,
        'daily_coupon', round(i.face * i.coupon_bps / 10000.0 * h.units)
      ) order by i.matures_at asc)
      from public.bond_holdings h join public.bond_issues i on i.id = h.issue_id
      where h.holder_fid = fid), '[]'::jsonb),
    'market', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'issuer_name', coalesce(i.issuer_name, public._fac_name(i.issuer_fid)),
        'face', i.face, 'coupon_bps', i.coupon_bps, 'units_left', i.units_left,
        'matures_at', i.matures_at
      ) order by i.coupon_bps desc)
      from public.bond_issues i
      where i.status = 'open' and i.units_left > 0 and i.issuer_fid <> fid), '[]'::jsonb)
  );
end$$;

-- ── Права ───────────────────────────────────────────────────────────────────
revoke all on function public.market_tick()              from public;
revoke all on function public.bonds_settle()             from public;
revoke all on function public.bond_issue(numeric,int,int,int) from public;
revoke all on function public.bond_buy(uuid,int)         from public;
revoke all on function public.bond_cancel(uuid)          from public;
revoke all on function public.bonds_status()             from public;
grant execute on function public.market_tick()           to anon, authenticated;
grant execute on function public.bonds_settle()          to anon, authenticated;
grant execute on function public.bond_issue(numeric,int,int,int) to authenticated;
grant execute on function public.bond_buy(uuid,int)      to authenticated;
grant execute on function public.bond_cancel(uuid)       to authenticated;
grant execute on function public.bonds_status()          to authenticated;

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select public.bond_issue(1000, 50, 100, 14);     -- заём: номинал 1000, 50 бумаг, 1%/сут, 14 дней
-- 2) (другой фракцией) select public.bond_buy('<issue_id>', 10);   -- ГС уходят эмитенту
-- 3) select public.bonds_status();                    -- мои выпуски/держания/рынок
-- 4) Сдвинуть bond_state.last_tick назад → select public.market_tick(); → купоны начислены
-- 5) После matures_at → market_tick → погашение номинала (или 'default', если ГС не хватило)
