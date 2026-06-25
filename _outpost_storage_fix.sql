-- ============================================================================
--  ФИКС: «НЕТ МЕСТА — НЕТ ДОБЫЧИ» + АВАНПОСТ ДОБЫВАЕТ 1 ВЫБРАННЫЙ РЕСУРС
--  Применять в Supabase → SQL Editor ПОСЛЕ _mining_market_routing.sql и
--  _defense_outpost.sql (берёт economy_accrue из routing как канонический базис,
--  outposts/_outpost_mining_settle — из defense_outpost). Идемпотентно.
--
--  ПРОБЛЕМА (то, что чинит этот срез):
--   1) Лимит склада в SQL применялся ПО КАЖДОМУ ресурсу (least(cap, …)), а в UI
--      показывался как ОБЩИЙ → каждый ресурс мог дорасти до cap, суммарно склад
--      был фактически безлимитным («добыча сверхнормы»). Аванпосты вообще НИКАК
--      не упирались в лимит. Теперь cap — ОБЩИЙ для всего склада: нет свободного
--      места → ресурс на склад не кладётся (нет места — нет добычи). Касается и
--      добывающих заводов (режим 📦 Склад), и аванпостов. Каналы 🚚 экспорт и
--      🏪 рынок не трогают склад (сбыт сразу) — на них правило «нет места» не
--      распространяется, это осознанный «слив мимо склада».
--   2) Добывающий аванпост тянул ВСЕ ресурсы со ВСЕХ планет системы. Теперь он
--      добывает ОДИН выбранный ресурс (outposts.mine_res); пока не выбран — не
--      добывает ничего (только ГС-стипендия). Выбор — при развёртывании на карте
--      и сменой в кабинете (вкладка «Аванпосты»).
-- ============================================================================

-- ── Колонка выбранного ресурса аванпоста ─────────────────────────────────────
alter table public.outposts add column if not exists mine_res text;

-- ════════════════════════════════════════════════════════════════════════════
--  _outpost_mining_settle — теперь добывает ТОЛЬКО o.mine_res и упирается в
--  ОБЩИЙ свободный объём склада фракции (нет места — нет добычи). ГС-стипендия
--  (outpost_mine_gc) начисляется независимо (это операционный доход, не добыча).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._outpost_mining_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare
  o record; relem jsonb; d int; rr text; rate numeric;
  cur jsonb; gc_total numeric := 0;
  cap numeric; used numeric; freecap numeric; addq numeric;
begin
  if not exists(select 1 from public.outposts where faction_id=p_fid and mode='mining'
                  and floor(extract(epoch from (now()-coalesce(last_accrue,created_at)))/86400.0) >= 1) then
    return;   -- нечего начислять
  end if;
  select coalesce(resources,'{}'::jsonb) into cur from public.faction_economy where faction_id=p_fid for update;
  if cur is null then return; end if;

  -- ОБЩИЙ лимит склада фракции и текущее свободное место
  cap := 1000 + coalesce((select sum(slots_open) from public.colony_buildings
                          where faction_id=p_fid and btype='warehouse'),0) * 500;
  used := (select coalesce(sum(value::numeric),0) from jsonb_each_text(cur));
  freecap := greatest(0, cap - used);

  for o in select * from public.outposts where faction_id=p_fid and mode='mining' loop
    d := floor(extract(epoch from (now()-coalesce(o.last_accrue,o.created_at)))/86400.0);
    if d < 1 then continue; end if;
    gc_total := gc_total + public._defense_const('outpost_mine_gc') * d;

    -- добываем ТОЛЬКО выбранный ресурс — и только если есть место на складе
    if nullif(trim(coalesce(o.mine_res,'')),'') is not null and freecap > 0 then
      rate := 0;
      for relem in
        select r.value
        from jsonb_array_elements(coalesce((select planets from public.map_systems where id=o.system_id),'[]'::jsonb)) pl,
             jsonb_array_elements(coalesce(pl.value->'resources','[]'::jsonb)) r
        where r.value->>'name' = o.mine_res
      loop
        rr := coalesce(relem->>'r','common');
        rate := rate + (case rr when 'uncommon' then 6 when 'rare' then 3 when 'epic' then 1 when 'legendary' then 1 else 12 end);
      end loop;
      addq := least(rate * d, freecap);
      if addq > 0 then
        cur := jsonb_set(cur, array[o.mine_res], to_jsonb(coalesce((cur->>o.mine_res)::numeric,0) + addq), true);
        freecap := freecap - addq;
      end if;
    end if;

    update public.outposts set last_accrue = coalesce(last_accrue,created_at) + (d || ' days')::interval
      where id = o.id;
  end loop;

  update public.faction_economy set gc = gc + gc_total, resources = cur where faction_id = p_fid;
end$$;
revoke all on function public._outpost_mining_settle(text) from public;

-- ════════════════════════════════════════════════════════════════════════════
--  economy_accrue — НАДМНОЖЕСТВО версии из _mining_market_routing.sql.
--  Единственное изменение по сути: блок слияния склада теперь ОБЩИЙ лимит
--  (сперва списания товарной биржи, затем добыча на склад до свободного места;
--  нет места — на склад не кладётся). income_history.mined = реально положено.
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
  to_market jsonb := '{}'::jsonb;         -- добыча в режиме «на рынок»
  mr_px numeric;                           -- живая цена ресурса при сбыте на рынок
  v_free numeric := 0; v_stored numeric := 0;   -- ◄ ОБЩИЙ свободный склад / реально положено
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
      perform public._market_ensure(rname);
      mr_px := public._res_value(rname, coalesce(flow_rar->>rname,'common'));
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

    -- ── СЛИЯНИЕ СКЛАДА: списания первыми (освобождают место), затем добыча на
    --    склад до ОБЩЕГО свободного места. Нет места — на склад не кладётся. ──
    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric)), true);
    end loop;
    v_free := greatest(0, cap - (select coalesce(sum(value::numeric),0) from jsonb_each_text(merged)));
    v_stored := 0;
    for k in select jsonb_object_keys(res_add) loop
      avail := least(coalesce((res_add->>k)::numeric,0), v_free);
      if avail <= 0 then continue; end if;
      merged := jsonb_set(merged, array[k], to_jsonb(coalesce((merged->>k)::numeric,0) + avail), true);
      v_free := v_free - avail; v_stored := v_stored + avail;
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
        v_stored);
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
-- economy_accrue вызывается внутренне (economy_tick), прямого гранта клиенту нет —
-- как и в _mining_market_routing.sql.

-- ════════════════════════════════════════════════════════════════════════════
--  outposts_visible — НАДМНОЖЕСТВО: добавлено поле mine_res (выбранный ресурс).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.outposts_visible()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._outpost_mining_settle(fid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'system_id', o.system_id, 'faction_id', o.faction_id,
      'name', o.name, 'mode', o.mode, 'mine_res', o.mine_res, 'mine', (o.faction_id = fid),
      'faction_name', public._fac_name(o.faction_id)
    ) order by o.created_at asc)
    from public.outposts o
    where public._defense_can_see(fid, o.system_id, o.faction_id)
  ), '[]'::jsonb);
end$$;
revoke all on function public.outposts_visible() from public;
grant execute on function public.outposts_visible() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  outpost_ship_deploy — НАДМНОЖЕСТВО: для режима 'mining' можно сразу указать
--  добываемый ресурс (p_res). Старая 2-арг сигнатура удаляется во избежание
--  неоднозначности перегрузок в PostgREST.
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.outpost_ship_deploy(uuid,text);
create or replace function public.outpost_ship_deploy(p_id uuid, p_mode text default 'recon', p_res text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; sh public.outpost_ships; sysid text; v_id uuid; md text; res text;
begin
  fid := public._ec_my_fid();
  md := lower(coalesce(p_mode,'recon'));
  if md not in ('recon','mining') then raise exception 'unknown outpost mode: %', p_mode; end if;
  perform public._outpost_ship_settle(fid);
  select * into sh from public.outpost_ships where id=p_id;
  if not found then raise exception 'outpost-ship not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your ship'; end if;
  if sh.status = 'building' then raise exception 'ship is still under construction'; end if;
  if sh.status <> 'idle' or sh.system_id is null then raise exception 'ship still in transit'; end if;
  sysid := sh.system_id;
  if not public._outpost_can_deploy(fid, sysid) then
    raise exception 'cannot deploy here: must be neutral space, не впритык к чужой границе';
  end if;

  res := nullif(trim(coalesce(p_res,'')),'');
  if md = 'mining' and res is not null then
    if not exists(
      select 1
      from jsonb_array_elements(coalesce((select planets from public.map_systems where id=sysid),'[]'::jsonb)) pl,
           jsonb_array_elements(coalesce(pl.value->'resources','[]'::jsonb)) rr
      where rr.value->>'name' = res
    ) then raise exception 'resource «%» not present in this system', res; end if;
  else
    res := null;
  end if;

  insert into public.outposts(system_id, owner_id, faction_id, name, mode, mine_res, last_accrue)
    values(sysid, auth.uid(), fid, sh.name, md, res, now())
    returning id into v_id;
  delete from public.outpost_ships where id=p_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'system_id', sysid, 'mode', md, 'mine_res', res);
end$$;
revoke all on function public.outpost_ship_deploy(uuid,text,text) from public;
grant execute on function public.outpost_ship_deploy(uuid,text,text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  outpost_set_resource — сменить добываемый ресурс развёрнутого аванпоста.
--  Доначисляет добычу прежнего ресурса, проверяет, что ресурс есть в системе.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.outpost_set_resource(p_id uuid, p_res text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; op public.outposts; res text;
begin
  fid := public._ec_my_fid();
  perform public._outpost_mining_settle(fid);   -- зафиксировать добычу прежнего ресурса
  select * into op from public.outposts where id=p_id;
  if not found then raise exception 'outpost not found'; end if;
  if op.faction_id is distinct from fid then raise exception 'not your outpost'; end if;
  res := nullif(trim(coalesce(p_res,'')),'');
  if res is not null and not exists(
      select 1
      from jsonb_array_elements(coalesce((select planets from public.map_systems where id=op.system_id),'[]'::jsonb)) pl,
           jsonb_array_elements(coalesce(pl.value->'resources','[]'::jsonb)) rr
      where rr.value->>'name' = res
  ) then raise exception 'resource «%» not present in this system', res; end if;
  update public.outposts
    set mine_res = res,
        last_accrue = case when mode='mining' then now() else last_accrue end
    where id = p_id;
  return jsonb_build_object('ok', true, 'mine_res', res);
end$$;
revoke all on function public.outpost_set_resource(uuid,text) from public;
grant execute on function public.outpost_set_resource(uuid,text) to authenticated;

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) Заводы в режиме 📦 Склад при полном складе НЕ копят сверх лимита:
--    select public.economy_tick(); -- mined в income_history = только реально положено.
-- 2) Аванпост добывает только mine_res:
--    select public.outpost_set_resource('<id>','Железо');
--    select public.outposts_visible();   -- видно mine_res
