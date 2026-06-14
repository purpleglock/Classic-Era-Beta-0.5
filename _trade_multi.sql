-- ============================================================
-- ТОРГОВЛЯ · МУЛЬТИРЕСУРС: несколько ресурсов в одном караване
-- Применять в Supabase → SQL Editor ПОСЛЕ _trade_flow.sql. Идемпотентно.
--
-- Маршрут хранит cargo = [{"res":"Железо","vol":20}, ...]. Суммарный vol ≤
-- грузоподъёмности флота. В начислении каждый ресурс возится как поток
-- (throughput = min(vol, добыча ресурса)), доход × цена(ресурса) × дип-коэф.
-- Старые одно-ресурсные маршруты (cargo пуст) работают по resource/volume.
-- ============================================================

-- мультигруз каравана
alter table public.trade_routes add column if not exists cargo jsonb not null default '[]'::jsonb;

-- ── RPC: предложить караван с НЕСКОЛЬКИМИ ресурсами ──────────
create or replace function public.trade_propose_multi(p_to_fid text, p_origin_sys text, p_dest_sys text, p_cargo jsonb, p_convoy int, p_threats jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; cap int; used int; bowner uuid; roster_ships int; committed int;
  fleet_cargo int; cargo_used int; tot_vol int; citem jsonb; v_vol int; first_res text; first_price numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_cargo is null or jsonb_array_length(p_cargo) = 0 then raise exception 'empty cargo'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_to_fid = app.faction_id then raise exception 'self'; end if;
  select owner_id into bowner from public.faction_economy where faction_id=p_to_fid;
  if bowner is null then raise exception 'recipient has no economy'; end if;
  perform 1 from public.map_systems where id=p_origin_sys and faction=app.faction_id;
  if not found then raise exception 'origin not yours'; end if;
  perform 1 from public.map_systems where id=p_dest_sys and faction=p_to_fid;
  if not found then raise exception 'destination not theirs'; end if;
  select coalesce(sum(slots_open),0) into cap from public.colony_buildings where faction_id=app.faction_id and btype='trade';
  select count(*) into used from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
  if used >= cap then raise exception 'no free trade hub slots'; end if;

  -- эскорт ≤ свободных боевых кораблей
  select coalesce(sum(qty),0) into roster_ships from public.unit_production where faction_id=app.faction_id and category='ship' and status='done';
  select coalesce(sum(convoy),0) into committed from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
  if coalesce(p_convoy,0) > roster_ships - committed then raise exception 'not enough escort ships'; end if;

  -- суммарный объём грузов ≤ свободной грузоподъёмности флота
  tot_vol := 0;
  for citem in select value from jsonb_array_elements(p_cargo) loop
    v_vol := coalesce((citem->>'vol')::int, 0);
    if v_vol <= 0 then raise exception 'bad cargo volume'; end if;
    tot_vol := tot_vol + v_vol;
    if first_res is null then first_res := citem->>'res'; end if;
  end loop;
  select coalesce(sum(public._ship_cargo(fu.data)*up.qty),0) into fleet_cargo
    from public.unit_production up join public.faction_units fu on fu.id=up.unit_id
    where up.faction_id=app.faction_id and up.category='ship' and up.status='done';
  select coalesce(sum(volume),0) into cargo_used from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
  if tot_vol > fleet_cargo - cargo_used then
    raise exception 'not enough trade capacity (free: %)', greatest(0, fleet_cargo - cargo_used);
  end if;

  -- resource/volume/price — легаси-поля для отображения (первый груз + суммарный объём)
  first_price := public._res_price(coalesce((select rarity from public.resource_rarity where name=first_res),'common'));
  insert into public.trade_routes(a_fid,a_owner,a_name,b_fid,b_owner,b_name,volume,status,origin_sys,dest_sys,resource,price,convoy,threats,cargo)
    values(app.faction_id, auth.uid(), app.name, p_to_fid, bowner, public._fac_name(p_to_fid), tot_vol, 'pending',
           p_origin_sys, p_dest_sys, first_res, first_price, coalesce(p_convoy,0), coalesce(p_threats,'[]'::jsonb), p_cargo);
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.trade_propose_multi(text,text,text,jsonb,int,jsonb) from public;
grant execute on function public.trade_propose_multi(text,text,text,jsonb,int,jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════
-- economy_accrue — версия из _trade_flow.sql + мультиресурс в торговой секции.
-- ════════════════════════════════════════════════════════════
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
  citem jsonb; cargo_price numeric;     -- ◄ МУЛЬТИРЕСУРС: элемент груза и его цена
begin
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then return jsonb_build_object('faction_id',p_fid,'days',0); end if;

  mods := public._faction_mods(p_fid);
  m_mine := (mods->>'mine')::numeric;
  m_gc   := (mods->>'gc')::numeric;
  if eco.debuff_until is not null and eco.debuff_until > now() then
    m_gc := m_gc * (1 - coalesce(eco.debuff_pct,0));
  end if;

  update public.unit_production set status='done' where faction_id=p_fid and status='queued' and ready_at<=now();

  perform public._apply_colony_projects(p_fid);
  perform public._spy_resolve(p_fid);
  perform public._raid_resolve(p_fid);

  if eco.research_active is not null and eco.research_ready is not null and eco.research_ready <= now() then
    update public.faction_economy
      set research = coalesce(research,'[]'::jsonb) || to_jsonb(eco.research_active::text),
          research_active = null, research_ready = null
      where faction_id = p_fid;
    select * into eco from public.faction_economy where faction_id = p_fid;
  end if;
  if eco.research_active2 is not null and eco.research_ready2 is not null and eco.research_ready2 <= now() then
    update public.faction_economy
      set research = coalesce(research,'[]'::jsonb) || to_jsonb(eco.research_active2::text),
          research_active2 = null, research_ready2 = null
      where faction_id = p_fid;
    select * into eco from public.faction_economy where faction_id = p_fid;
  end if;

  d := floor(extract(epoch from (now()-eco.last_tick))/86400.0);

  for r in select btype, slots_open from public.colony_buildings where faction_id=p_fid loop
    if r.btype='factory' then inc_gc := inc_gc + r.slots_open*200;
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    end if;
  end loop;

  if d >= 1 then
    cap := 1000 + coalesce((select sum(slots_open) from public.colony_buildings
                            where faction_id=p_fid and btype='warehouse'),0) * 500;

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
        mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(coalesce((mine_flow->>rname)::numeric,0) + rate*d), true);
        if bld.mine_mode = 'export' then
          export_gc := export_gc + rate * d * public._res_value(rname, rr) * 0.6;
        else
          res_add := jsonb_set(res_add, array[rname], to_jsonb(coalesce((res_add->>rname)::numeric,0) + rate*d), true);
        end if;
      end loop;
    end loop;
    export_gc := round(export_gc * m_gc);

    -- ── КАРАВАНЫ: мультиресурс, поток добычи ──
    for r in select cargo, resource, volume, price, convoy, threats, b_fid from public.trade_routes where status='active' and a_fid=p_fid loop
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
        -- мультиресурс: каждый груз — отдельный поток
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
        -- легаси: один ресурс
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

    market_cap := (select coalesce(sum(slots_open),0) from public.colony_buildings
                   where faction_id = p_fid and btype = 'market') * 25 * d;
    if market_cap > 0 then
      for r in
        select res_name, res_rar, avail from (
          select distinct on (nm) nm as res_name, rr as res_rar,
            greatest(0, coalesce((eco.resources->>nm)::numeric,0)
                        + coalesce((res_add->>nm)::numeric,0)
                        - coalesce((res_sub->>nm)::numeric,0)) as avail
          from (
            select (e.value->>'name') as nm, coalesce(e.value->>'r','common') as rr
            from public.colonies c, jsonb_array_elements(c.resources) e
            where c.faction_id = p_fid
          ) q
          order by nm, public._res_value(nm, rr) desc
        ) u
        where avail > 0
        order by public._res_value(res_name, res_rar) desc
      loop
        exit when market_cap <= 0;
        sell := least(r.avail, market_cap);
        res_sub := jsonb_set(res_sub, array[r.res_name],
                     to_jsonb(coalesce((res_sub->>r.res_name)::numeric,0) + sell), true);
        market_gc := market_gc + sell * public._res_value(r.res_name, r.res_rar) *
          (case r.res_rar when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65 when 'uncommon' then 0.55 else 0.5 end);
        market_cap := market_cap - sell;
      end loop;
      market_gc := round(market_gc * m_gc);
    end if;

    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_add) loop
      merged := jsonb_set(merged, array[k], to_jsonb(least(cap, coalesce((merged->>k)::numeric,0) + (res_add->>k)::numeric)), true);
    end loop;
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric)), true);
    end loop;

    update public.faction_economy
      set gc = gc + round(inc_gc * m_gc * d) + trade_gc + market_gc + export_gc,
          science = science + greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
          agents  = agents  + greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
          resources = merged,
          last_tick = last_tick + (d || ' days')::interval
      where faction_id=p_fid returning * into eco;
  end if;

  return jsonb_build_object('faction_id',eco.faction_id,'gc',eco.gc,'science',eco.science,'agents',eco.agents,
    'resources',eco.resources,'last_tick',eco.last_tick,'days',d, 'mods', mods,
    'income', jsonb_build_object(
      'gc',     round(inc_gc * m_gc),
      'science',greatest(0, inc_sci    + (mods->>'sci_flat')::numeric),
      'agents', greatest(0, inc_agents + (mods->>'agents_flat')::numeric),
      'trade',  trade_gc, 'market', market_gc, 'export', export_gc, 'pirate', pirate));
end$$;
revoke all on function public.economy_accrue(text) from public;

-- ── Проверка ────────────────────────────────────────────────
-- Караван с несколькими грузами: каждый ресурс возится своим потоком,
-- доход = Σ min(vol, добыча) × цена × дип. UI мультивыбора — следующим срезом.
