-- ============================================================
-- РЕЙДЫ · ЗАЩИТА: ПАТРУЛЬ → ТОРГОВАЯ ПОЛИТИКА (наём NPC-флота за ГС)
-- Применять в Supabase → SQL Editor ПОСЛЕ _trade_export.sql. Идемпотентно.
--
-- Вместо «патруля своими кораблями» вводим платный контракт защиты всех караванов:
--   0 Нет           — 0 ГС/ход,  +0 защиты
--   1 Патрульный    — 120 ГС/ход, +8 защиты
--   2 Конвой Лиги   — 350 ГС/ход, +18 защиты
-- Апкип списывается на тике (economy_accrue). Защита идёт в D рейд-боя ко ВСЕМ
-- караванам фракции. Конвой (свои корабли на конкретный путь) остаётся как был.
-- Добыча рейда теперь мультигруз-совместима (грабят самый ценный груз каравана).
-- ============================================================

alter table public.faction_economy add column if not exists trade_policy int default 0;

-- ── Тарифы политики (единый источник для сервера) ───────────
create or replace function public._trade_policy_cost(p_tier int)
returns numeric language sql immutable as $$
  select (case coalesce(p_tier,0) when 1 then 120 when 2 then 350 else 0 end)::numeric
$$;
create or replace function public._trade_policy_def(p_tier int)
returns int language sql immutable as $$
  select case coalesce(p_tier,0) when 1 then 8 when 2 then 18 else 0 end
$$;
revoke all on function public._trade_policy_cost(int) from public;
revoke all on function public._trade_policy_def(int) from public;
grant execute on function public._trade_policy_cost(int) to authenticated;
grant execute on function public._trade_policy_def(int) to authenticated;

-- ── RPC: выбрать тир торговой политики ──────────────────────
create or replace function public.raid_policy_set(p_tier int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; t int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  t := greatest(0, least(2, coalesce(p_tier,0)));
  update public.faction_economy set trade_policy = t where faction_id=fid;
  return jsonb_build_object('ok',true,'trade_policy',t,
    'cost',public._trade_policy_cost(t),'def',public._trade_policy_def(t));
end$$;
revoke all on function public.raid_policy_set(int) from public;
grant execute on function public.raid_policy_set(int) to authenticated;

-- ── Свободные корабли: патруль больше НЕ занимает корабли ────
create or replace function public._raid_free_ships(p_fid text)
returns int language sql stable security definer set search_path=public as $$
  select coalesce((select sum(qty) from public.unit_production
                   where faction_id=p_fid and category='ship' and status='done'),0)
       - coalesce((select sum(convoy) from public.trade_routes
                   where a_fid=p_fid and status in ('pending','active')),0)
       - coalesce((select sum(ships) from public.raid_missions
                   where actor_fid=p_fid and status='active'),0)
$$;
revoke all on function public._raid_free_ships(text) from public;

-- ── Разрешение рейдов: защита = конвой + торговая политика ───
create or replace function public._raid_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare m record; rt public.trade_routes; tgt public.faction_economy;
  A numeric; D numeric; T numeric; s numeric; k numeric;
  att_losses int; def_losses int; loot_frac numeric;
  v_res text; v_price numeric; stock numeric; cargo numeric; cargo_vol numeric;
  loot_units numeric; loot_gc numeric; took_units numeric; took_gc numeric;
  det_chance int; v_detected boolean; conv int; pol_def int;
begin
  for m in select * from public.raid_missions
           where actor_fid=p_fid and status='active' and ready_at <= now()
           for update loop

    select * into rt from public.trade_routes where id=m.route_id;
    if rt.id is null or rt.status <> 'active' then
      update public.raid_missions set status='done', detected=false,
        outcome = jsonb_build_object('result','no_target') where id=m.id;
      continue;
    end if;

    select * into tgt from public.faction_economy where faction_id=m.target_fid;
    conv    := coalesce(rt.convoy,0);
    pol_def := public._trade_policy_def(coalesce(tgt.trade_policy,0));

    -- двусторонний бой по соотношению сил
    A := m.ships * 10;
    D := conv * 12 + pol_def;                    -- конвой (свои) + контракт-политика (NPC)
    T := greatest(1, A + D);
    s := A / T;
    k := 0.5 * (0.8 + random()*0.4);
    att_losses := round(m.ships * (1 - s) * k);
    def_losses := round(conv     *    s  * k);   -- гибнут только СВОИ корабли конвоя (не NPC)
    loot_frac  := greatest(0, least(0.7, (s - 0.5) * 1.4));

    -- самый ценный груз каравана (мультигруз или легаси один ресурс)
    if jsonb_array_length(coalesce(rt.cargo,'[]'::jsonb)) > 0 then
      select ci->>'res', coalesce((ci->>'vol')::numeric,0) into v_res, cargo_vol
        from jsonb_array_elements(rt.cargo) ci
        order by public._res_price(coalesce((select rarity from public.resource_rarity where name=ci->>'res'),'common')) desc
        limit 1;
      v_price := public._res_price(coalesce((select rarity from public.resource_rarity where name=v_res),'common'));
    else
      v_res := rt.resource; v_price := coalesce(rt.price,0); cargo_vol := coalesce(rt.volume,0);
    end if;

    took_units := 0; took_gc := 0;
    if loot_frac > 0 and tgt.faction_id is not null and v_res is not null then
      stock := coalesce((tgt.resources->>v_res)::numeric, 0);
      cargo := least(coalesce(cargo_vol,0), stock);
      loot_units := floor(cargo * loot_frac);
      loot_gc    := floor(loot_units * v_price * 0.5);
      if loot_units > 0 then
        update public.faction_economy
          set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[v_res],
              to_jsonb(coalesce((resources->>v_res)::numeric,0) - loot_units), true)
          where faction_id=m.target_fid and coalesce((resources->>v_res)::numeric,0) >= loot_units;
        if found then
          update public.faction_economy
            set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[v_res],
                to_jsonb(coalesce((resources->>v_res)::numeric,0) + loot_units), true)
            where faction_id=m.actor_fid;
          took_units := loot_units;
        end if;
      end if;
      took_gc := least(floor(loot_gc), greatest(0, floor(coalesce(tgt.gc,0))));
      if took_gc > 0 then
        update public.faction_economy set gc = gc - took_gc where faction_id=m.target_fid and gc >= took_gc;
        if found then update public.faction_economy set gc = gc + took_gc where faction_id=m.actor_fid;
        else took_gc := 0; end if;
      end if;
    end if;

    if att_losses > 0 then perform public._destroy_ships(m.actor_fid, att_losses); end if;
    if def_losses > 0 then
      perform public._destroy_ships(m.target_fid, def_losses);
      update public.trade_routes set convoy = greatest(0, coalesce(convoy,0) - def_losses) where id=m.route_id;
    end if;

    det_chance := case when D > 0 then 70 else 30 end;
    v_detected := (random()*100) < det_chance;
    if v_detected then
      insert into public.faction_relations(from_fid, to_fid, score, updated_at)
        values(m.target_fid, m.actor_fid, -15, now())
        on conflict (from_fid, to_fid)
        do update set score = greatest(-100, public.faction_relations.score - 15), updated_at=now();
    end if;

    insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
        title, excerpt, body, status, published_at, created_at, updated_at)
      values(m.target_fid, '🏴‍☠ ПИРАТСТВО', 'rgba(200,80,80,0.55)', null, null,
        'Караван разграблен', null,
        format('Караван фракции «%s» атакован %s. Угнано %s ед. груза%s. Потери эскорта: %s кораблей.',
          public._fac_name(m.target_fid),
          case when v_detected then 'флотом «'||public._fac_name(m.actor_fid)||'»' else 'неизвестными пиратами' end,
          took_units::text,
          case when took_gc>0 then ' и '||took_gc::text||' ГС' else '' end,
          def_losses::text),
        'approved', now(), now(), now());

    update public.raid_missions
      set status='done', detected=v_detected,
          outcome = jsonb_build_object('ships',m.ships,'att_losses',att_losses,'def_losses',def_losses,
                    'loot_units',took_units,'loot_gc',took_gc,'resource',v_res,
                    'loot_frac',round(loot_frac,2),'detected',v_detected)
      where id=m.id;
  end loop;
end$$;
revoke all on function public._raid_resolve(text) from public;

-- ════════════════════════════════════════════════════════════
-- economy_accrue — версия из _trade_export.sql + апкип торговой политики.
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
  flow_rar  jsonb := '{}'::jsonb;
  citem jsonb; cargo_price numeric;
  policy_cost numeric := 0;          -- ◄ апкип торговой политики /ход
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
        if bld.mine_mode = 'export' then
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(coalesce((mine_flow->>rname)::numeric,0) + rate*d), true);
          flow_rar  := jsonb_set(flow_rar,  array[rname], to_jsonb(rr), true);
        else
          res_add := jsonb_set(res_add, array[rname], to_jsonb(coalesce((res_add->>rname)::numeric,0) + rate*d), true);
        end if;
      end loop;
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

    for rname in select jsonb_object_keys(mine_flow) loop
      avail := coalesce((mine_flow->>rname)::numeric, 0);
      if avail > 0 then
        export_gc := export_gc + avail * public._res_value(rname, coalesce(flow_rar->>rname,'common')) * 0.6;
      end if;
    end loop;
    export_gc := round(export_gc * m_gc);

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
      set gc = greatest(0, gc + round(inc_gc * m_gc * d) + trade_gc + market_gc + export_gc - policy_cost * d),
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
      'trade',  trade_gc, 'market', market_gc, 'export', export_gc,
      'policy', policy_cost, 'pirate', pirate));
end$$;
revoke all on function public.economy_accrue(text) from public;

-- ── raid_status: отдаём текущую политику вместо патруля ─────
create or replace function public.raid_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text; done_ships int; conv int; raids int; pol int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select coalesce(sum(qty),0)     into done_ships from public.unit_production where faction_id=fid and category='ship' and status='done';
  select coalesce(sum(convoy),0)  into conv       from public.trade_routes   where a_fid=fid and status in ('pending','active');
  select coalesce(sum(ships),0)   into raids      from public.raid_missions  where actor_fid=fid and status='active';
  select coalesce(trade_policy,0) into pol        from public.faction_economy where faction_id=fid;
  return jsonb_build_object('ships',done_ships,'convoy',conv,'raids',raids,
    'policy',pol,'policy_cost',public._trade_policy_cost(pol),'policy_def',public._trade_policy_def(pol),
    'free', done_ships - conv - raids);
end$$;
revoke all on function public.raid_status() from public;
grant execute on function public.raid_status() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- raid_policy_set(2) → trade_policy=2; на тике списывается 350 ГС/ход и все
-- караваны получают +18 защиты в рейд-бою. Патруль кораблями больше не нужен.
