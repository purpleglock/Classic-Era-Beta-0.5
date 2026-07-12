-- ============================================================
-- ПОТОКИ РЕСУРСОВ · единая панель управления добычей + концессии
-- Применять в Supabase → SQL Editor ПОСЛЕ _faith_multi.sql. Идемпотентно.
--
-- Что даёт:
--   1) faction_res_flows — настройки потока ПО РЕСУРСУ (1 набор на державу,
--      а не галочки на каждом здании):
--        mode              — 'store'/'export'/NULL (NULL = как у здания, старое поведение)
--        market_limit      — сколько ед./сут МАКСИМУМ сбывает Товарная биржа из потока
--                            (NULL = без лимита, 0 = не продавать этот ресурс)
--        market_from_store — сколько ед./сут биржа ДОБИРАЕТ со склада (0 = склад не трогать)
--        to_store          — переливать ли остаток потока на склад
--                            (false = остаток авто-продаётся как экспорт ×0.6)
--   2) mining_concessions — «право добычи»: поток конкретной залежи конкретной
--      колонии уходит ДРУГОЙ державе (интерим факторий: месторождение остаётся
--      на месте, добычу получает торговец).
--   3) trade_routes.from_store — караван добирает недостающий объём СО СКЛАДА.
--   4) res_sell_now — разовая продажа со склада (явное действие игрока,
--      Товарная биржа НЕ нужна; авто-слива склада по-прежнему НЕТ).
--
-- ВАЖНО (источник истины): пересоздаёт economy_accrue как СТРОГОЕ надмножество
-- версии из _faith_multi.sql (строки -- ВЕРА / -- ВЕРА-2 / -- ВЕРА-4 / -- МУЛЬТИ
-- сохранены). Добавленное помечено «-- ПОТОКИ:». При будущих слайсах, трогающих
-- economy_accrue, продублируйте строки «-- ПОТОКИ:».
-- ============================================================

-- ── 1) СХЕМА ────────────────────────────────────────────────
create table if not exists public.faction_res_flows (
  faction_id        text    not null,
  res_name          text    not null,
  mode              text    default null check (mode is null or mode in ('store','export')),
  market_limit      numeric default null check (market_limit is null or market_limit >= 0),
  market_from_store numeric not null default 0 check (market_from_store >= 0),
  to_store          boolean not null default true,
  updated_at        timestamptz not null default now(),
  primary key (faction_id, res_name)
);
-- Самолечение прод-дрейфа: если таблица когда-то была создана без ключа
-- (faction_id, res_name), «create table if not exists» её НЕ чинит, а
-- insert…on conflict в res_flow_set падает в рантайме («no unique or exclusion
-- constraint») — снаружи это выглядит как «режимы не сохраняются». Догоняем
-- ключ идемпотентно, предварительно схлопнув возможные дубли строк.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.faction_res_flows'::regclass and contype in ('p','u')
  ) then
    delete from public.faction_res_flows a using public.faction_res_flows b
      where a.ctid < b.ctid and a.faction_id = b.faction_id and a.res_name = b.res_name;
    alter table public.faction_res_flows add primary key (faction_id, res_name);
  end if;
end $$;
alter table public.faction_res_flows enable row level security;
drop policy if exists frf_select_own on public.faction_res_flows;
create policy frf_select_own on public.faction_res_flows
  for select to authenticated using (faction_id = public._ec_my_fid());
revoke insert, update, delete on public.faction_res_flows from anon, authenticated;

create table if not exists public.mining_concessions (
  id         uuid primary key default gen_random_uuid(),
  colony_id  uuid not null references public.colonies(id) on delete cascade,
  res_name   text not null,
  from_fid   text not null,
  to_fid     text not null,
  created_at timestamptz not null default now(),
  unique (colony_id, res_name)
);
alter table public.mining_concessions enable row level security;
drop policy if exists mc_select_party on public.mining_concessions;
create policy mc_select_party on public.mining_concessions
  for select to authenticated
  using (from_fid = public._ec_my_fid() or to_fid = public._ec_my_fid());
revoke insert, update, delete on public.mining_concessions from anon, authenticated;

alter table public.trade_routes
  add column if not exists from_store boolean not null default false;

-- ── 2) RPC: настройки потока ────────────────────────────────
create or replace function public.res_flow_set(
  p_res text, p_mode text default null, p_market_limit numeric default null,
  p_market_from_store numeric default 0, p_to_store boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if coalesce(btrim(p_res),'') = '' then raise exception 'resource required'; end if;
  if p_mode is not null and p_mode not in ('store','export') then raise exception 'bad mode'; end if;
  insert into public.faction_res_flows(faction_id, res_name, mode, market_limit, market_from_store, to_store)
    values (fid, btrim(p_res), p_mode,
            case when p_market_limit is null then null else greatest(0, p_market_limit) end,
            greatest(0, coalesce(p_market_from_store,0)), coalesce(p_to_store,true))
  on conflict (faction_id, res_name) do update set
    mode = excluded.mode, market_limit = excluded.market_limit,
    market_from_store = excluded.market_from_store, to_store = excluded.to_store,
    updated_at = now();
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.res_flow_set(text,text,numeric,numeric,boolean) from public, anon;
grant execute on function public.res_flow_set(text,text,numeric,numeric,boolean) to authenticated;

create or replace function public.res_flow_clear(p_res text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  delete from public.faction_res_flows
    where faction_id = public._ec_my_fid() and res_name = btrim(coalesce(p_res,''));
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.res_flow_clear(text) from public, anon;
grant execute on function public.res_flow_clear(text) to authenticated;

-- ── 3) RPC: караван добирает со склада ──────────────────────
create or replace function public.trade_route_from_store(p_id uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  update public.trade_routes set from_store = coalesce(p_on,false)
    where id = p_id and a_fid = fid and status in ('pending','active');
  if not found then raise exception 'route not found or not yours'; end if;
  return jsonb_build_object('ok', true, 'from_store', coalesce(p_on,false));
end$$;
revoke all on function public.trade_route_from_store(uuid,boolean) from public, anon;
grant execute on function public.trade_route_from_store(uuid,boolean) to authenticated;

-- ── 4) RPC: концессии (право добычи залежи) ─────────────────
create or replace function public.concession_grant(p_colony uuid, p_res text, p_to_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies; new_id uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into col from public.colonies where id = p_colony;
  if not found or col.faction_id is distinct from fid then raise exception 'not your colony'; end if;
  if coalesce(btrim(p_res),'') = '' then raise exception 'resource required'; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(col.resources,'[]'::jsonb)) e
                 where e->>'name' = btrim(p_res)) then
    raise exception 'no such deposit in this colony';
  end if;
  if coalesce(btrim(p_to_fid),'') = '' or p_to_fid = fid then raise exception 'bad target faction'; end if;
  if not exists (select 1 from public.faction_applications
                 where faction_id = p_to_fid and status = 'approved') then
    raise exception 'target faction not found';
  end if;
  insert into public.mining_concessions(colony_id, res_name, from_fid, to_fid)
    values (p_colony, btrim(p_res), fid, p_to_fid)
    on conflict (colony_id, res_name) do nothing
    returning id into new_id;
  if new_id is null then raise exception 'deposit already conceded — revoke first'; end if;
  return jsonb_build_object('ok', true, 'id', new_id);
end$$;
revoke all on function public.concession_grant(uuid,text,text) from public, anon;
grant execute on function public.concession_grant(uuid,text,text) to authenticated;

-- Отозвать может владелец залежи; получатель может отказаться сам.
create or replace function public.concession_revoke(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  delete from public.mining_concessions where id = p_id and (from_fid = fid or to_fid = fid);
  if not found then raise exception 'concession not found'; end if;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.concession_revoke(uuid) from public, anon;
grant execute on function public.concession_revoke(uuid) to authenticated;

-- ── 5) RPC: разовая продажа со склада ───────────────────────
-- Явное действие игрока (в отличие от бывшего авто-слива). Товарная биржа НЕ
-- нужна — это сброс запаса по невыгодной ставке (50–75% цены);
-- цена = ценность × доля редкости × доктрина (те же числа, что market_gc в тике).
create or replace function public.res_sell_now(p_res text, p_qty numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; avail numeric; sell numeric;
  rr text; gain numeric; m_gc numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if coalesce(btrim(p_res),'') = '' then raise exception 'resource required'; end if;
  if coalesce(p_qty,0) <= 0 then raise exception 'qty must be positive'; end if;
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy row'; end if;
  avail := coalesce((eco.resources->>btrim(p_res))::numeric, 0);
  sell := least(p_qty, avail);
  if sell <= 0 then raise exception 'nothing to sell: warehouse is empty for this resource'; end if;
  rr := coalesce((select rarity from public.resource_rarity where name = btrim(p_res)),'common');
  m_gc := (public._faction_mods(fid)->>'gc')::numeric;
  if eco.debuff_until is not null and eco.debuff_until > now() then
    m_gc := m_gc * (1 - coalesce(eco.debuff_pct,0));
  end if;
  gain := round(sell * public._res_value(btrim(p_res), rr) *
    (case rr when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65
             when 'uncommon' then 0.55 else 0.5 end) * m_gc);
  update public.faction_economy
    set gc = gc + gain,
        resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[btrim(p_res)],
                              to_jsonb(greatest(0, avail - sell)), true)
    where faction_id = fid;
  return jsonb_build_object('ok', true, 'sold', sell, 'gc', gain);
end$$;
revoke all on function public.res_sell_now(text,numeric) from public, anon;
grant execute on function public.res_sell_now(text,numeric) to authenticated;

-- ── 6) economy_accrue v6: потоки по ресурсам + концессии ────
-- База: _faith_multi.sql v5 (строки -- ВЕРА / -- ВЕРА-2 / -- ВЕРА-4 / -- МУЛЬТИ
-- сохранены). ПОТОКИ:
--   • режим потока ресурса: faction_res_flows.mode > mine_mode здания > 'store';
--   • концессии: поток отданной залежи капает получателю (на его склад);
--   • караваны с from_store добирают недостающее со склада;
--   • биржа: market_limit/сут на ресурс + добор со склада market_from_store/сут;
--   • to_store=false: остаток потока не льётся на склад, а авто-продаётся ×0.6.
create or replace function public.economy_accrue(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  eco public.faction_economy; d int;
  inc_gc numeric:=0; inc_sci numeric:=0; inc_agents int:=0; trade_gc numeric:=0; pirate boolean:=false;
  r record; col record; bld record; relem jsonb; thr jsonb;
  res_add jsonb := '{}'::jsonb; res_sub jsonb := '{}'::jsonb; merged jsonb; k text;
  rname text; rr text; rate numeric; escorted boolean; attacked boolean; chance numeric; avail numeric; shipped numeric;
  mods jsonb; m_mine numeric; m_gc numeric;
  market_cap numeric; market_gc numeric := 0; sell numeric;
  export_gc numeric := 0; cap numeric;
  rel_score int; dip_coef numeric;
  mine_flow jsonb := '{}'::jsonb;
  flow_rar  jsonb := '{}'::jsonb;
  citem jsonb; cargo_price numeric;
  policy_cost numeric := 0;
  has_faith boolean := false;                       -- ВЕРА
  tithe_gc numeric := 0;                             -- ВЕРА-2: десятина основателю
  v_sects int := 0;                                  -- ВЕРА-4: мои активные секты
  sct record; v_ci_host int; v_new_exp numeric;      -- ВЕРА-4: вскрытие чужих сект
  fcfg jsonb := '{}'::jsonb;                         -- ПОТОКИ: настройки по ресурсам
  eff_mode text; v_conc_fid text;                    -- ПОТОКИ
  conc_out jsonb := '{}'::jsonb;                     -- ПОТОКИ: fid → {res: qty} для концессий
  k2 text; qty numeric; rcap numeric;                -- ПОТОКИ: доставка концессий
  want numeric; extra numeric; store_avail numeric;  -- ПОТОКИ: добор со склада
  lim numeric;                                       -- ПОТОКИ: лимит биржи по ресурсу
begin
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then return jsonb_build_object('faction_id',p_fid,'days',0); end if;

  mods := public._faction_mods(p_fid);
  m_mine := (mods->>'mine')::numeric;
  m_gc   := (mods->>'gc')::numeric;
  if eco.debuff_until is not null and eco.debuff_until > now() then
    m_gc := m_gc * (1 - coalesce(eco.debuff_pct,0));
  end if;
  policy_cost := public._trade_policy_cost(coalesce(eco.trade_policy,0));

  update public.unit_production set status='done' where faction_id=p_fid and status='queued' and ready_at<=now();

  perform public._apply_colony_projects(p_fid);
  perform public._spy_resolve(p_fid);
  perform public._raid_resolve(p_fid);

  d := floor(extract(epoch from (now()-eco.last_tick))/86400.0);

  has_faith := exists(select 1 from public.faith_membership where faction_id = p_fid);  -- ВЕРА

  -- ПОТОКИ: настройки потоков по ресурсам (одна панель на державу)
  select coalesce(jsonb_object_agg(f.res_name, jsonb_build_object(
      'mode', f.mode, 'market_limit', f.market_limit,
      'market_from_store', f.market_from_store, 'to_store', f.to_store)), '{}'::jsonb)
    into fcfg
  from public.faction_res_flows f where f.faction_id = p_fid;

  for r in select btype, slots_open, faith_id from public.colony_buildings where faction_id=p_fid loop  -- МУЛЬТИ: + faith_id
    if r.btype='factory' then inc_gc := inc_gc + r.slots_open*200;
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    elsif r.btype='temple' and (                                                      -- МУЛЬТИ: доход лишь пока исповедуешь веру храма
        (r.faith_id is not null and public._faith_member(p_fid, r.faith_id))
        or (r.faith_id is null and has_faith)) then inc_gc := inc_gc + r.slots_open*150;  -- ВЕРА
    end if;
  end loop;

  -- ВЕРА-2: если я основатель веры — получаю 20% дохода храмов всех адептов/признавших.
  if exists(select 1 from public.faiths where founder_fid = p_fid) then
    select coalesce(sum(cb.slots_open),0) * 150 * 0.20 into tithe_gc
    from public.faith_membership m
    join public.faiths f on f.id = m.faith_id and f.founder_fid = p_fid
    join public.colony_buildings cb on cb.faction_id = m.faction_id and cb.btype = 'temple'
      and (cb.faith_id = f.id or cb.faith_id is null)            -- МУЛЬТИ: только храмы этой веры (null=старые)
    where m.role <> 'founder';
    inc_gc := inc_gc + coalesce(tithe_gc, 0);
  end if;

  -- ВЕРА-4: доход моих тайных сект (covert temples) — каждая как храм, +150 ГС
  select count(*) into v_sects from public.faith_sects where owner_fid = p_fid and status = 'active';
  if v_sects > 0 then inc_gc := inc_gc + v_sects * 150; end if;

  if d >= 1 then
    cap := 1000 + coalesce((select sum(slots_open) from public.colony_buildings
                            where faction_id=p_fid and btype='warehouse'),0) * 500;

    -- ВЕРА-4: контрразведка хозяина вскрывает чужие секты на его территории
    if exists(select 1 from public.faith_sects where host_fid = p_fid and status = 'active') then
      v_ci_host := public._spy_ci_power(p_fid, 'hq');
      for sct in select * from public.faith_sects where host_fid = p_fid and status = 'active' loop
        v_new_exp := least(100, sct.exposure + greatest(3, v_ci_host * 12) * d);
        if v_new_exp >= 100 then
          update public.faith_sects set exposure = 100, status = 'exposed', exposed_at = now() where id = sct.id;
          insert into public.faction_relations(from_fid,to_fid,score,updated_at)
            values(p_fid, sct.owner_fid, -10, now())
            on conflict (from_fid,to_fid) do update set score=greatest(-100, public.faction_relations.score-10), updated_at=now();
          insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
              title, excerpt, body, status, published_at, created_at, updated_at)
            values(p_fid, '🛐 КОНТРРАЗВЕДКА', 'rgba(200,150,40,0.55)', null, null,
              'Вскрыта тайная секта', null,
              format('Контрразведка «%s» раскрыла тайную секту веры «%s», насаждённую фракцией «%s». Ячейка ликвидирована.',
                public._fac_name(p_fid),
                coalesce((select name from public.faiths where id=sct.faith_id),'неизвестной веры'),
                public._fac_name(sct.owner_fid)),
              'approved', now(), now(), now());
        else
          update public.faith_sects set exposure = v_new_exp where id = sct.id;
        end if;
      end loop;
    end if;

    for bld in
      select cb.colony_id, cb.mining_targets, coalesce(cb.mine_mode,'store') as mine_mode, c.resources as cres  -- ПОТОКИ: + colony_id
      from public.colony_buildings cb
      join public.colonies c on c.id = cb.colony_id
      where cb.faction_id = p_fid and cb.btype = 'mining'
        and jsonb_array_length(coalesce(cb.mining_targets,'[]'::jsonb)) > 0
        and c.resources is not null and jsonb_array_length(c.resources) > 0
    loop
      for rname in select value from jsonb_array_elements_text(bld.mining_targets) loop
        select value into relem from jsonb_array_elements(bld.cres) where value->>'name' = rname limit 1;
        if relem is null then continue; end if;
        rr := coalesce(relem->>'r','common');
        rate := case rr when 'uncommon' then 12 when 'rare' then 6 when 'epic' then 3 when 'legendary' then 1 else 25 end;
        rate := greatest(1, round(rate * public._richness_mult(relem->>'amt') * m_mine));
        -- ПОТОКИ: концессия — поток этой залежи уходит держателю права добычи
        v_conc_fid := null;
        select mc.to_fid into v_conc_fid from public.mining_concessions mc
          where mc.colony_id = bld.colony_id and mc.res_name = rname limit 1;
        if v_conc_fid is not null then
          if conc_out->v_conc_fid is null then
            conc_out := jsonb_set(conc_out, array[v_conc_fid], '{}'::jsonb, true);
          end if;
          conc_out := jsonb_set(conc_out, array[v_conc_fid, rname],
            to_jsonb(coalesce((conc_out->v_conc_fid->>rname)::numeric,0) + rate*d), true);
          continue;
        end if;
        -- ПОТОКИ: режим ресурса из панели потоков перекрывает режим здания
        eff_mode := coalesce(fcfg->rname->>'mode',
                             case when bld.mine_mode = 'export' then 'export' else 'store' end);
        if eff_mode = 'export' then
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(coalesce((mine_flow->>rname)::numeric,0) + rate*d), true);
          flow_rar  := jsonb_set(flow_rar,  array[rname], to_jsonb(rr), true);
        else
          res_add  := jsonb_set(res_add,  array[rname], to_jsonb(coalesce((res_add->>rname)::numeric,0) + rate*d), true);
          flow_rar := jsonb_set(flow_rar, array[rname], to_jsonb(rr), true);  -- ◄ редкость потока для Товарной биржи
        end if;
      end loop;
    end loop;

    -- ПОТОКИ: доставка концессионной добычи получателям (на их склад, до их лимита ёмкости)
    for k in select jsonb_object_keys(conc_out) loop
      rcap := 1000 + coalesce((select sum(slots_open) from public.colony_buildings
                               where faction_id = k and btype='warehouse'),0) * 500;
      for k2 in select jsonb_object_keys(conc_out->k) loop
        qty := (conc_out->k->>k2)::numeric;
        if qty <= 0 then continue; end if;
        update public.faction_economy fe
          set resources = jsonb_set(coalesce(fe.resources,'{}'::jsonb), array[k2],
                to_jsonb(least(rcap, coalesce((fe.resources->>k2)::numeric,0) + qty)), true)
          where fe.faction_id = k;
      end loop;
    end loop;

    for r in select cargo, resource, volume, price, convoy, threats, b_fid, transit_until, from_store from public.trade_routes where status='active' and a_fid=p_fid loop  -- ПОТОКИ: + from_store
      if r.transit_until is not null and r.transit_until > now() then continue; end if;
      escorted := coalesce(r.convoy,0) > 0; attacked := false;
      for thr in select value from jsonb_array_elements(coalesce(r.threats,'[]'::jsonb)) loop
        if (thr->>'type') = 'ancient' then chance := case when escorted then 0.65 else 0.80 end;
        else chance := case when escorted then 0.40 else 0.80 end; end if;
        if random() < chance then attacked := true; end if;
      end loop;
      if attacked then pirate := true; continue; end if;
      select coalesce(score,0) into rel_score from public.faction_relations where from_fid=p_fid and to_fid=r.b_fid;
      dip_coef := greatest(0.8, least(1.2, 1 + coalesce(rel_score,0)/500.0));

      if jsonb_array_length(coalesce(r.cargo,'[]'::jsonb)) > 0 then
        for citem in select value from jsonb_array_elements(r.cargo) loop
          rname := citem->>'res';
          avail := coalesce((mine_flow->>rname)::numeric, 0);
          want := coalesce((citem->>'vol')::numeric,0)*d;
          shipped := least(want, avail);
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(avail - shipped), true);
          -- ПОТОКИ: добор недостающего объёма со склада (галочка «брать со склада»)
          if r.from_store and shipped < want then
            store_avail := greatest(0, coalesce((eco.resources->>rname)::numeric,0)
                                       - coalesce((res_sub->>rname)::numeric,0));
            extra := least(want - shipped, store_avail);
            if extra > 0 then
              res_sub := jsonb_set(res_sub, array[rname], to_jsonb(coalesce((res_sub->>rname)::numeric,0) + extra), true);
              shipped := shipped + extra;
            end if;
          end if;
          if shipped <= 0 then continue; end if;
          cargo_price := public._res_price(coalesce((select rarity from public.resource_rarity where name=rname),'common'));
          trade_gc := trade_gc + shipped * cargo_price * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*cargo_price*0.5*dip_coef) where faction_id = r.b_fid;
        end loop;
      else
        avail := coalesce((mine_flow->>r.resource)::numeric, 0);
        want := coalesce(r.volume,0)*d;
        shipped := least(want, avail);
        mine_flow := jsonb_set(mine_flow, array[r.resource], to_jsonb(avail - shipped), true);
        -- ПОТОКИ: добор недостающего объёма со склада
        if r.from_store and shipped < want then
          store_avail := greatest(0, coalesce((eco.resources->>r.resource)::numeric,0)
                                     - coalesce((res_sub->>r.resource)::numeric,0));
          extra := least(want - shipped, store_avail);
          if extra > 0 then
            res_sub := jsonb_set(res_sub, array[r.resource], to_jsonb(coalesce((res_sub->>r.resource)::numeric,0) + extra), true);
            shipped := shipped + extra;
          end if;
        end if;
        if shipped > 0 then
          trade_gc := trade_gc + shipped * coalesce(r.price,0) * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*coalesce(r.price,0)*0.5*dip_coef) where faction_id = r.b_fid;
        end if;
      end if;
    end loop;
    trade_gc := round(trade_gc * m_gc);

    for rname in select jsonb_object_keys(mine_flow) loop
      avail := coalesce((mine_flow->>rname)::numeric, 0);
      if avail > 0 then
        export_gc := export_gc + avail * public._res_value(rname, coalesce(flow_rar->>rname,'common')) * 0.6;
      end if;
    end loop;
    export_gc := round(export_gc * m_gc);

    -- товарная биржа (btype=market): сбывает СВЕЖЕДОБЫТЫЙ поток (mine_mode=store) за ГС,
    -- по ценности × доля редкости, до лимита слотов×25/сут, дороже — первым. НАКОПЛЕННЫЙ
    -- СКЛАД НЕ ТРОГАЕТ: раньше биржа перебирала запас по ВСЕМ залежам колоний, и колонизация
    -- новой системы с Гравиядром/Стелларитом разом сливала стратегический резерв (вкл. топливо
    -- Длани). Теперь продаётся только поток этого тика; всё, что не продано, копится на складе.
    -- ПОТОКИ: сверху — персональный лимит market_limit/сут на ресурс и явный добор
    -- со склада market_from_store/сут (по умолчанию 0 — склад по-прежнему не трогается).
    market_cap := (select coalesce(sum(slots_open),0) from public.colony_buildings
                   where faction_id = p_fid and btype = 'market') * 25 * d;
    if market_cap > 0 then
      for r in
        select t.nm as res_name, coalesce(flow_rar->>t.nm,'common') as res_rar,
               coalesce((res_add->>t.nm)::numeric,0) as avail
        from jsonb_object_keys(res_add) as t(nm)
        where coalesce((res_add->>t.nm)::numeric,0) > 0
        order by public._res_value(t.nm, coalesce(flow_rar->>t.nm,'common')) desc
      loop
        exit when market_cap <= 0;
        sell := least(r.avail, market_cap);
        lim := nullif(fcfg->r.res_name->>'market_limit','')::numeric;     -- ПОТОКИ
        if lim is not null then sell := least(sell, lim * d); end if;     -- ПОТОКИ: лимит /сут
        if sell <= 0 then continue; end if;
        -- вычитаем проданное из ПОТОКА (не со склада) — на склад ляжет только остаток
        res_add := jsonb_set(res_add, array[r.res_name],
                     to_jsonb(coalesce((res_add->>r.res_name)::numeric,0) - sell), true);
        market_gc := market_gc + sell * public._res_value(r.res_name, r.res_rar) *
          (case r.res_rar when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65 when 'uncommon' then 0.55 else 0.5 end);
        market_cap := market_cap - sell;
      end loop;
      -- ПОТОКИ: явный добор со склада (market_from_store ед./сут по ресурсу)
      for r in
        select f.res_name, f.market_from_store from public.faction_res_flows f
        where f.faction_id = p_fid and f.market_from_store > 0
        order by public._res_value(f.res_name,
          coalesce((select rarity from public.resource_rarity where name=f.res_name),'common')) desc
      loop
        exit when market_cap <= 0;
        store_avail := greatest(0, coalesce((eco.resources->>r.res_name)::numeric,0)
                                   - coalesce((res_sub->>r.res_name)::numeric,0));
        sell := least(r.market_from_store * d, store_avail, market_cap);
        if sell <= 0 then continue; end if;
        res_sub := jsonb_set(res_sub, array[r.res_name],
                     to_jsonb(coalesce((res_sub->>r.res_name)::numeric,0) + sell), true);
        rr := coalesce((select rarity from public.resource_rarity where name=r.res_name),'common');
        market_gc := market_gc + sell * public._res_value(r.res_name, rr) *
          (case rr when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65 when 'uncommon' then 0.55 else 0.5 end);
        market_cap := market_cap - sell;
      end loop;
      market_gc := round(market_gc * m_gc);
    end if;

    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_add) loop
      -- ПОТОКИ: перелив на склад выключен — остаток потока авто-продаётся как экспорт (×0.6)
      if coalesce(fcfg->k->>'to_store','true') = 'false' then
        export_gc := export_gc + round(greatest(0,(res_add->>k)::numeric)
          * public._res_value(k, coalesce(flow_rar->>k,'common')) * 0.6 * m_gc);
        continue;
      end if;
      merged := jsonb_set(merged, array[k], to_jsonb(least(cap, coalesce((merged->>k)::numeric,0) + (res_add->>k)::numeric)), true);
    end loop;
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric)), true);
    end loop;

    update public.faction_economy
      set gc = greatest(0, gc + round(inc_gc * m_gc * d) + trade_gc + market_gc + export_gc - policy_cost * d),
          science = science + greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
          agents  = agents  + greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
          resources = merged,
          last_tick = last_tick + (d || ' days')::interval
      where faction_id=p_fid returning * into eco;

    insert into public.income_history(faction_id, owner_id, days, gc_build, gc_trade, gc_market, gc_export, gc_policy, gc_net, gc_after, sci, agents_n, mined)
      values(p_fid, eco.owner_id, d,
        round(inc_gc * m_gc * d), trade_gc, market_gc, export_gc, policy_cost * d,
        round(inc_gc * m_gc * d) + trade_gc + market_gc + export_gc - policy_cost * d,
        eco.gc,
        greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
        greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
        (select coalesce(sum(value::numeric),0) from jsonb_each_text(res_add)));
    delete from public.income_history where faction_id=p_fid
      and id not in (select id from public.income_history where faction_id=p_fid order by tick_at desc limit 30);
  end if;

  perform public._research_step(p_fid);
  select * into eco from public.faction_economy where faction_id = p_fid;

  return jsonb_build_object('faction_id',eco.faction_id,'gc',eco.gc,'science',eco.science,'agents',eco.agents,
    'resources',eco.resources,'last_tick',eco.last_tick,'days',d, 'mods', mods,
    'income', jsonb_build_object(
      'gc',     round(inc_gc * m_gc),
      'science',greatest(0, inc_sci    + (mods->>'sci_flat')::numeric),
      'agents', greatest(0, inc_agents + (mods->>'agents_flat')::numeric),
      'trade',  trade_gc, 'market', market_gc, 'export', export_gc,
      'policy', policy_cost, 'pirate', pirate));
end$$;
revoke all on function public.economy_accrue(text) from public;

-- ── Проверка после применения ───────────────────────────────
-- select public.res_flow_set('Железо', 'export', null, 0, true);
-- select public.res_flow_set('Гравиядро', null, 0, 0, true);    -- биржа НЕ продаёт Гравиядро
-- select public.concession_grant('<colony_id>', 'Железо', '<fid торговца>');
-- select public.res_sell_now('Железо', 100);
-- select public.trade_route_from_store('<route_id>', true);
