-- ============================================================================
--  ДОБЫЧА · 3 КАНАЛА + БАЛАНС РЫНКА + АДМИН-НАСТРОЙКИ NPC
--  Применять в Supabase → SQL Editor ПОСЛЕ _faith_multi.sql и _market_sim.sql.
--  Идемпотентно. Зависит от: _market_setup.sql / _market_sim.sql (market_resources,
--    market_index, _market_price_calc, market_tick, _res_value), _faith_multi.sql
--    (economy_accrue — берём её как канонический базис), _security_money.sql
--    (current_user_role / _ec_my_fid).
--
--  ЧТО МЕНЯЕТСЯ
--  1) ДОБЫВАЮЩИЙ ЗАВОД — теперь ТРИ канала потока (mine_mode):
--       📦 store  — копить на склад (как было);
--       🚚 export — отдавать торговому пути (караваны); остаток авто-продаётся 0.6
--                   (значение 'export' сохранено для совместимости со старыми зданиями);
--       🏪 market — СБЫВАТЬ ПРЯМО НА ЖИВОЙ РЫНОК: запас market_resources растёт →
--                   цена этого ресурса падает, ГС начисляется по живой цене. Так
--                   перепроизводство игроков САМО роняет цену — рынок реагирует.
--  2) БАЛАНС РЫНКА — мягче и саморегулируется:
--       • эластичность цены 0.45→0.30, разлёт 0.25..4.0× → 0.5..2.5× (настраивается);
--       • усилен возврат запаса к равновесию;
--       • NPC-АРБИТРАЖ: боты реагируют на цену — дорого (price>base) ⇒ продают
--         (запас↑, цена↓), дёшево ⇒ скупают (запас↓, цена↑). Стабилизирующая
--         обратная связь вместо пассивного случайного блуждания.
--  3) АДМИН — глобальные ручки рынка/NPC (market_config) + правка по каждому
--     ресурсу (npc_supply/npc_demand/equilibrium/base_price/stock).
-- ============================================================================

-- ── Глобальные настройки рынка (одна строка, правит админ) ───────────────────
create table if not exists public.market_config (
  id            int primary key default 1,
  elasticity    numeric not null default 0.30,  -- цена ~ (eq/stock)^elasticity
  clamp_lo      numeric not null default 0.50,  -- нижняя граница множителя цены
  clamp_hi      numeric not null default 2.50,  -- верхняя граница множителя цены
  reversion     numeric not null default 0.15,  -- скорость возврата запаса к равновесию/сут
  volatility    numeric not null default 0.02,  -- мультипликативный шум запаса/сут (±)
  npc_react     numeric not null default 0.60,  -- сила ценовой реакции NPC (арбитраж)
  walk          numeric not null default 0.20,  -- остаточное случайное блуждание NPC-потока (±)
  shock_chance  numeric not null default 0.06,  -- базовый шанс событийного шока за прогон
  player_sell   numeric not null default 0.80,  -- доля живой цены при сбыте добычи на рынок (mine_mode=market)
  updated_at    timestamptz not null default now()
);
insert into public.market_config(id) values(1) on conflict (id) do nothing;
alter table public.market_config enable row level security;
drop policy if exists "mc_sel" on public.market_config;
create policy "mc_sel" on public.market_config for select to public using (true);
-- запись — только через SECURITY DEFINER admin-RPC

create or replace function public._market_cfg() returns public.market_config
language sql stable as $$ select * from public.market_config where id = 1 $$;

-- ── Цена от запаса: эластичность и разлёт берутся из market_config ───────────
--    Была immutable(p_base,p_stock,p_eq); теперь stable (читает конфиг).
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

-- ════════════════════════════════════════════════════════════════════════════
--  market_tick() — пересобран: NPC-АРБИТРАЖ по цене + мягкий возврат к
--  равновесию + остаточное блуждание + редкий событийный шок + индекс/история.
--  Сохраняет совместимость с _market_sim.sql (индекс, '__INDEX__', _market_shock).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.market_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare st public.market_state; cfg public.market_config; d int; i int; shocked boolean := false;
begin
  cfg := public._market_cfg();
  select * into st from public.market_state where id = 1 for update;
  if not found then
    insert into public.market_state(id, last_tick) values(1, now()) on conflict (id) do nothing;
    select * into st from public.market_state where id = 1 for update;
  end if;
  d := floor(extract(epoch from (now() - st.last_tick)) / 86400.0);
  if d < 1 then return jsonb_build_object('ok', true, 'days', 0); end if;
  d := least(d, 30);

  for i in 1..d loop
    -- 1) NPC-АРБИТРАЖ: реакция на разрыв цены к базе. price>base (дефицит) ⇒
    --    боты продают на рынок → запас растёт → цена падает к базе, и наоборот.
    --    Сила = npc_react, масштаб = npc_supply/npc_demand как «мощность» бота.
    update public.market_resources
       set stock = greatest(1, stock
             + (price/nullif(base_price,0) - 1.0) * cfg.npc_react
               * (npc_supply + npc_demand) * 0.5 * (0.7 + random()*0.6));
    -- 2) остаточное случайное блуждание (×walk, симметрично) — фон, не буря
    update public.market_resources
       set stock = greatest(1, stock + (npc_supply - npc_demand) * (random()-0.5) * 2 * cfg.walk);
    -- 3) мягкий мультипликативный шум
    update public.market_resources
       set stock = greatest(1, stock * (1.0 + (random()-0.5)*2*cfg.volatility));
    -- 4) возврат запаса к равновесию (усилен)
    update public.market_resources
       set stock = stock + (equilibrium - stock) * cfg.reversion;
  end loop;

  -- редкий событийный шок (вероятность из конфига, растёт с простоем, cap 0.5)
  if random() < least(0.5, cfg.shock_chance * d) then
    begin perform public._market_shock(); shocked := true; exception when others then null; end;
  end if;

  update public.market_resources
     set price = public._market_price_calc(base_price, stock, equilibrium), updated_at = now();

  -- индекс рынка (если установлен _market_sim.sql)
  begin
    update public.market_index set value = public._market_index_value(), updated_at = now() where id = 1;
  exception when others then null; end;

  insert into public.market_price_history(name, price, stock, at)
    select name, price, stock, now() from public.market_resources;
  begin
    insert into public.market_price_history(name, price, stock, at)
      select '__INDEX__', value, 0, now() from public.market_index where id = 1;
  exception when others then null; end;
  delete from public.market_price_history h using (
    select id, row_number() over (partition by name order by at desc) rn
    from public.market_price_history
  ) x where h.id = x.id and x.rn > 60;

  update public.market_state set last_tick = last_tick + (d || ' days')::interval where id = 1;
  return jsonb_build_object('ok', true, 'days', d, 'shock', shocked);
end$$;

-- ── Режим завода: 'store' | 'export'(=торговый путь) | 'market'(живой рынок) ──
create or replace function public.economy_set_mine_mode(p_building_id uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_mode not in ('store','export','market') then raise exception 'bad mode'; end if;
  fid := public._ec_my_fid();
  update public.colony_buildings set mine_mode = p_mode
    where id = p_building_id and faction_id = fid and btype = 'mining';
  if not found then raise exception 'no such mining building'; end if;
  return jsonb_build_object('ok', true, 'mode', p_mode);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  economy_accrue — канонический базис из _faith_multi.sql + ТРЕТИЙ канал
--  добычи 'market' (прямой сбыт на живой рынок: запас↑, цена↓, ГС по живой цене).
-- ════════════════════════════════════════════════════════════════════════════
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
  has_faith boolean := false;
  tithe_gc numeric := 0;
  v_sects int := 0;
  sct record; v_ci_host int; v_new_exp numeric;
  to_market jsonb := '{}'::jsonb;         -- ◄ НОВОЕ: добыча в режиме «на рынок»
  mr_px numeric;                           -- живая цена ресурса при сбыте на рынок
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

  has_faith := exists(select 1 from public.faith_membership where faction_id = p_fid);

  for r in select btype, slots_open, faith_id from public.colony_buildings where faction_id=p_fid loop
    if r.btype='factory' then inc_gc := inc_gc + r.slots_open*200;
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    elsif r.btype='temple' and (
        (r.faith_id is not null and public._faith_member(p_fid, r.faith_id))
        or (r.faith_id is null and has_faith)) then inc_gc := inc_gc + r.slots_open*150;
    end if;
  end loop;

  if exists(select 1 from public.faiths where founder_fid = p_fid) then
    select coalesce(sum(cb.slots_open),0) * 150 * 0.20 into tithe_gc
    from public.faith_membership m
    join public.faiths f on f.id = m.faith_id and f.founder_fid = p_fid
    join public.colony_buildings cb on cb.faction_id = m.faction_id and cb.btype = 'temple'
      and (cb.faith_id = f.id or cb.faith_id is null)
    where m.role <> 'founder';
    inc_gc := inc_gc + coalesce(tithe_gc, 0);
  end if;

  select count(*) into v_sects from public.faith_sects where owner_fid = p_fid and status = 'active';
  if v_sects > 0 then inc_gc := inc_gc + v_sects * 150; end if;

  if d >= 1 then
    cap := 1000 + coalesce((select sum(slots_open) from public.colony_buildings
                            where faction_id=p_fid and btype='warehouse'),0) * 500;

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

    -- ── ДОБЫЧА: канал решает mine_mode (store | export=торг.путь | market) ──
    for bld in
      select cb.mining_targets, coalesce(cb.mine_mode,'store') as mine_mode, c.resources as cres
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
        if bld.mine_mode = 'market' then
          -- ◄ НОВОЕ: прямой сбыт на живой рынок (settle ниже)
          to_market := jsonb_set(to_market, array[rname], to_jsonb(coalesce((to_market->>rname)::numeric,0) + rate*d), true);
          flow_rar  := jsonb_set(flow_rar,  array[rname], to_jsonb(rr), true);
        elsif bld.mine_mode = 'export' then
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(coalesce((mine_flow->>rname)::numeric,0) + rate*d), true);
          flow_rar  := jsonb_set(flow_rar,  array[rname], to_jsonb(rr), true);
        else
          res_add := jsonb_set(res_add, array[rname], to_jsonb(coalesce((res_add->>rname)::numeric,0) + rate*d), true);
        end if;
      end loop;
    end loop;

    -- ── СБЫТ НА ЖИВОЙ РЫНОК (mine_mode=market): запас↑ → цена↓, ГС по живой цене ──
    for rname in select jsonb_object_keys(to_market) loop
      avail := coalesce((to_market->>rname)::numeric, 0);
      if avail <= 0 then continue; end if;
      perform public._market_ensure(rname);                  -- гарантировать строку рынка
      mr_px := public._res_value(rname, coalesce(flow_rar->>rname,'common'));  -- живая цена ДО сброса
      market_gc := market_gc + avail * mr_px * (select player_sell from public.market_config where id=1);
      update public.market_resources
         set stock = stock + avail,
             price = public._market_price_calc(base_price, stock + avail, equilibrium),
             updated_at = now()
       where name = rname;
    end loop;

    for r in select cargo, resource, volume, price, convoy, threats, b_fid, transit_until from public.trade_routes where status='active' and a_fid=p_fid loop
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
          shipped := least(coalesce((citem->>'vol')::numeric,0)*d, avail);
          if shipped <= 0 then continue; end if;
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(avail - shipped), true);
          cargo_price := public._res_price(coalesce((select rarity from public.resource_rarity where name=rname),'common'));
          trade_gc := trade_gc + shipped * cargo_price * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*cargo_price*0.5*dip_coef) where faction_id = r.b_fid;
        end loop;
      else
        avail := coalesce((mine_flow->>r.resource)::numeric, 0);
        shipped := least(coalesce(r.volume,0)*d, avail);
        if shipped > 0 then
          mine_flow := jsonb_set(mine_flow, array[r.resource], to_jsonb(avail - shipped), true);
          trade_gc := trade_gc + shipped * coalesce(r.price,0) * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*coalesce(r.price,0)*0.5*dip_coef) where faction_id = r.b_fid;
        end if;
      end if;
    end loop;
    trade_gc := round(trade_gc * m_gc);

    -- остаток торгового потока (караваны не разобрали) → авто-продажа 0.6
    for rname in select jsonb_object_keys(mine_flow) loop
      avail := coalesce((mine_flow->>rname)::numeric, 0);
      if avail > 0 then
        export_gc := export_gc + avail * public._res_value(rname, coalesce(flow_rar->>rname,'common')) * 0.6;
      end if;
    end loop;
    export_gc := round(export_gc * m_gc);

    -- товарная биржа (btype=market): пассивный сбыт накопленного склада
    market_cap := (select coalesce(sum(slots_open),0) from public.colony_buildings
                   where faction_id = p_fid and btype = 'market') * 25 * d;
    if market_cap > 0 then
      for r in
        select u.res_name, u.res_rar, u.avail from (
          select distinct on (q.nm) q.nm as res_name, q.rr as res_rar,
            greatest(0, coalesce((eco.resources->>q.nm)::numeric,0)
                        + coalesce((res_add->>q.nm)::numeric,0)
                        - coalesce((res_sub->>q.nm)::numeric,0)) as avail
          from (
            select (e.value->>'name') as nm, coalesce(e.value->>'r','common') as rr
            from public.colonies c, jsonb_array_elements(c.resources) e
            where c.faction_id = p_fid
          ) q
          order by q.nm, public._res_value(q.nm, q.rr) desc
        ) u
        where u.avail > 0
        order by public._res_value(u.res_name, u.res_rar) desc
      loop
        exit when market_cap <= 0;
        sell := least(r.avail, market_cap);
        res_sub := jsonb_set(res_sub, array[r.res_name],
                     to_jsonb(coalesce((res_sub->>r.res_name)::numeric,0) + sell), true);
        market_gc := market_gc + sell * public._res_value(r.res_name, r.res_rar) *
          (case r.res_rar when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65 when 'uncommon' then 0.55 else 0.5 end);
        market_cap := market_cap - sell;
      end loop;
    end if;
    market_gc := round(market_gc * m_gc);   -- ВКЛ. прямой сбыт на рынок + биржу

    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_add) loop
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

-- ════════════════════════════════════════════════════════════════════════════
--  АДМИН: настройки рынка/NPC. Доступ — только стаффу (superadmin/editor).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.admin_market_status()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  return jsonb_build_object(
    'config', (select row_to_json(c) from public.market_config c where id=1),
    'resources', coalesce((
      select jsonb_agg(row_to_json(m) order by base_price desc)
      from public.market_resources m), '[]'::jsonb));
end$$;

-- Глобальные ручки (передавайте только нужные поля; null = не менять)
create or replace function public.admin_market_config_set(
  p_elasticity numeric default null, p_clamp_lo numeric default null, p_clamp_hi numeric default null,
  p_reversion numeric default null, p_volatility numeric default null, p_npc_react numeric default null,
  p_walk numeric default null, p_shock_chance numeric default null, p_player_sell numeric default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  update public.market_config set
    elasticity   = greatest(0.05, least(1.0,  coalesce(p_elasticity,   elasticity))),
    clamp_lo     = greatest(0.05, least(1.0,  coalesce(p_clamp_lo,     clamp_lo))),
    clamp_hi     = greatest(1.0,  least(10.0, coalesce(p_clamp_hi,     clamp_hi))),
    reversion    = greatest(0.0,  least(1.0,  coalesce(p_reversion,    reversion))),
    volatility   = greatest(0.0,  least(0.5,  coalesce(p_volatility,   volatility))),
    npc_react    = greatest(0.0,  least(5.0,  coalesce(p_npc_react,    npc_react))),
    walk         = greatest(0.0,  least(2.0,  coalesce(p_walk,         walk))),
    shock_chance = greatest(0.0,  least(1.0,  coalesce(p_shock_chance, shock_chance))),
    player_sell  = greatest(0.0,  least(1.0,  coalesce(p_player_sell,  player_sell))),
    updated_at = now()
  where id = 1;
  return (select row_to_json(c)::jsonb from public.market_config c where id=1);
end$$;

-- Правка одного ресурса (npc_supply/npc_demand = «добыча/потребление NPC»)
create or replace function public.admin_market_resource_set(
  p_name text, p_npc_supply numeric default null, p_npc_demand numeric default null,
  p_equilibrium numeric default null, p_base_price numeric default null, p_stock numeric default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  perform public._market_ensure(p_name);
  update public.market_resources set
    npc_supply  = greatest(0, coalesce(p_npc_supply,  npc_supply)),
    npc_demand  = greatest(0, coalesce(p_npc_demand,  npc_demand)),
    equilibrium = greatest(1, coalesce(p_equilibrium, equilibrium)),
    base_price  = greatest(0.01, coalesce(p_base_price, base_price)),
    stock       = greatest(1, coalesce(p_stock,       stock)),
    updated_at  = now()
  where name = p_name;
  update public.market_resources
     set price = public._market_price_calc(base_price, stock, equilibrium), updated_at = now()
   where name = p_name;
  return (select row_to_json(m)::jsonb from public.market_resources m where name = p_name);
end$$;

-- Массовая ручка: задать NPC-поток как долю равновесия для ВСЕХ ресурсов разом
-- (p_supply_frac/p_demand_frac, напр. 0.05 = 5% равновесия/сут).
create or replace function public.admin_market_npc_bulk(p_supply_frac numeric, p_demand_frac numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  update public.market_resources set
    npc_supply = greatest(0, round(equilibrium * greatest(0, coalesce(p_supply_frac, 0.03)))),
    npc_demand = greatest(0, round(equilibrium * greatest(0, coalesce(p_demand_frac, 0.03)))),
    updated_at = now();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'updated', n);
end$$;

-- ── Права ───────────────────────────────────────────────────────────────────
revoke all on function public.economy_set_mine_mode(uuid,text) from public;
revoke all on function public.market_tick()                    from public;
revoke all on function public._market_price_calc(numeric,numeric,numeric) from public;
revoke all on function public.admin_market_status()            from public;
revoke all on function public.admin_market_config_set(numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) from public;
revoke all on function public.admin_market_resource_set(text,numeric,numeric,numeric,numeric,numeric) from public;
revoke all on function public.admin_market_npc_bulk(numeric,numeric) from public;
grant execute on function public.economy_set_mine_mode(uuid,text) to authenticated;
grant execute on function public.market_tick()                    to anon, authenticated;
grant execute on function public._market_price_calc(numeric,numeric,numeric) to anon, authenticated;
grant execute on function public.admin_market_status()            to authenticated;
grant execute on function public.admin_market_config_set(numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) to authenticated;
grant execute on function public.admin_market_resource_set(text,numeric,numeric,numeric,numeric,numeric) to authenticated;
grant execute on function public.admin_market_npc_bulk(numeric,numeric) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  ПЛОЩАДЬ под кривой цены — CONFIG-AWARE (зеркало _market_setup._market_area,
--  но эластичность/зажим берутся из market_config, как и _market_price_calc).
--  Зачем: market_buy_resource/market_sell_resource (из _market_setup.sql) считают
--  деньги через ∫ цены = public._market_area(...). Имя резолвится в рантайме →
--  переопределив ЭТУ функцию, мы синхронизируем стоимость сделок с ЖИВОЙ ценой
--  (config 0.30 / 0.5..2.5), не трогая сами buy/sell. Интеграл аддитивен →
--  дробление сделки (20+10 ≡ 30) по-прежнему бесполезно, круг теряет спред.
--  Была immutable (хардкод 0.45/0.25/4.0) → теперь stable (читает конфиг).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._market_area(p_base numeric, p_a numeric, p_b numeric, p_eq numeric)
returns numeric language sql stable as $$
  with c as (
    -- k<1 строго (при k=1 знаменатель 1-k=0); конфиг и так держит elasticity≤1
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
revoke all on function public._market_area(numeric,numeric,numeric,numeric) from public;
grant execute on function public._market_area(numeric,numeric,numeric,numeric) to anon, authenticated;

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select * from public.market_config;                       -- одна строка со значениями
-- 2) Завод в режиме 🏪 market → ресурс сбывается на рынок: запас растёт, цена падает.
--    select public.economy_tick(); select name, stock, price from public.market_resources where name='Железо';
-- 3) Прогон рынка стабилен: select public.market_tick();  -- цены тянутся к base, без буря.
-- 4) Админ: select public.admin_market_status();
--    select public.admin_market_config_set(p_npc_react => 1.2);   -- усилить арбитраж
--    select public.admin_market_npc_bulk(0.06, 0.04);             -- NPC активнее продают
