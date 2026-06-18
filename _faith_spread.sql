-- ============================================================
-- ВЕРА (РЕЛИГИЯ) · СЛАЙС 2: РАСПРОСТРАНЕНИЕ — ПРИЗНАНИЕ + ДЕСЯТИНА
-- Применять в Supabase → SQL Editor ПОСЛЕ _faith_setup.sql. Идемпотентно.
--
-- Идея: основатель веры ПРЕДЛАГАЕТ её признание чужой державе. Признавшая
-- фракция (даже не спиритуалист) получает право строить Храмы Веры. С дохода
-- её храмов основатель получает ДЕСЯТИНУ (+20%) — спред веры выгоден.
--
-- Признание = строка в faith_membership с ролью 'recognized' (а не отдельная
-- таблица) — поэтому гейт economy_build и скидка _faith_unit_discount из слайса 1
-- работают без изменений. Здесь только: новая роль, предложения, десятина.
-- Ковёртная операция «насаждение веры» — слайс 3. Федерация веры — слайс 4.
-- ============================================================

-- ── 1) РОЛЬ 'recognized' + ТАБЛИЦА ПРЕДЛОЖЕНИЙ ──────────────
alter table public.faith_membership drop constraint if exists faith_membership_role_check;
alter table public.faith_membership add constraint faith_membership_role_check
  check (role in ('founder','member','recognized'));

create table if not exists public.faith_offers (
  id uuid primary key default gen_random_uuid(),
  faith_id uuid not null references public.faiths(id) on delete cascade,
  from_fid text not null,           -- основатель веры
  to_fid text not null,             -- кому предложено признание
  to_owner uuid,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz default now()
);
create index if not exists fo_to_idx on public.faith_offers(to_fid, status);
create index if not exists fo_from_idx on public.faith_offers(from_fid, status);

alter table public.faith_offers enable row level security;
drop policy if exists "foffer_sel" on public.faith_offers;
create policy "foffer_sel" on public.faith_offers for select to authenticated using (true);

-- ── 2) RPC: ПРЕДЛОЖИТЬ ПРИЗНАНИЕ (только основатель) ────────
create or replace function public.faith_offer_recognition(p_to_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_faith uuid; v_to_owner uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  select faith_id into v_faith from public.faith_membership where faction_id = v_fid and role = 'founder';
  if v_faith is null then raise exception 'only a faith founder may offer recognition'; end if;
  if coalesce(btrim(p_to_fid),'') = '' or p_to_fid = v_fid then raise exception 'bad target'; end if;
  if exists(select 1 from public.faith_membership where faction_id = p_to_fid) then
    raise exception 'target already follows a faith';
  end if;
  select owner_id into v_to_owner from public.faction_applications
    where faction_id = p_to_fid and status = 'approved' order by updated_at desc limit 1;
  if v_to_owner is null then raise exception 'target faction not found'; end if;
  if exists(select 1 from public.faith_offers where faith_id = v_faith and to_fid = p_to_fid and status = 'pending') then
    raise exception 'offer already pending';
  end if;
  insert into public.faith_offers(faith_id, from_fid, to_fid, to_owner)
    values(v_faith, v_fid, p_to_fid, v_to_owner);
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.faith_offer_recognition(text) from public;
grant execute on function public.faith_offer_recognition(text) to authenticated;

-- ── 3) RPC: ОТВЕТ НА ПРЕДЛОЖЕНИЕ (цель) ────────────────────
create or replace function public.faith_offer_respond(p_offer_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_uid uuid; o public.faith_offers;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid(); v_uid := auth.uid();
  select * into o from public.faith_offers where id = p_offer_id and to_fid = v_fid and status = 'pending';
  if not found then raise exception 'offer not found'; end if;
  if not p_accept then
    update public.faith_offers set status = 'declined' where id = p_offer_id;
    return jsonb_build_object('ok', true, 'accepted', false);
  end if;
  if exists(select 1 from public.faith_membership where faction_id = v_fid) then
    raise exception 'you already follow a faith — leave it first';
  end if;
  insert into public.faith_membership(faction_id, faith_id, role, owner_id)
    values(v_fid, o.faith_id, 'recognized', v_uid);
  update public.faith_offers set status = 'accepted' where id = p_offer_id;
  -- прочие висящие предложения этой фракции снимаем
  update public.faith_offers set status = 'declined' where to_fid = v_fid and status = 'pending' and id <> p_offer_id;
  return jsonb_build_object('ok', true, 'accepted', true);
end$$;
revoke all on function public.faith_offer_respond(uuid,boolean) from public;
grant execute on function public.faith_offer_respond(uuid,boolean) to authenticated;

-- Входящие предложения признания для фракции (вынесено для переиспользования).
create or replace function public._faith_offers_in(p_fid text)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'from_fid', o.from_fid,
      'faith_name', f.name, 'faith_color', f.color) order by o.created_at), '[]'::jsonb)
  from public.faith_offers o
  join public.faiths f on f.id = o.faith_id
  where o.to_fid = p_fid and o.status = 'pending'
$$;
revoke all on function public._faith_offers_in(text) from public;

-- ── 4) faith_status v2: + роль recognized, предложения, десятина ──
create or replace function public.faith_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_fid text; m public.faith_membership; f public.faiths;
  s int; disc numeric; is_founder boolean;
begin
  v_fid := public._ec_my_fid();
  s    := public._faith_strength(v_fid);
  disc := public._faith_unit_discount(v_fid);
  select * into m from public.faith_membership where faction_id = v_fid;

  if not found then
    return jsonb_build_object('faith', null, 'can_found', public._faith_can_found(v_fid),
      'strength', s, 'unit_discount', disc, 'temple_income', 150, 'tithe_pct', 0.20,
      'offers_in', public._faith_offers_in(v_fid));
  end if;

  select * into f from public.faiths where id = m.faith_id;
  is_founder := (m.role = 'founder');
  return jsonb_build_object(
    'faith', jsonb_build_object('id', f.id, 'name', f.name, 'dogma', f.dogma,
       'color', f.color, 'open', f.open, 'founder_fid', f.founder_fid),
    'role', m.role,
    'can_found', public._faith_can_found(v_fid),
    'strength', s,
    'unit_discount', disc,
    'temple_income', 150,
    'tithe_pct', 0.20,
    'adepts', (select coalesce(jsonb_agg(jsonb_build_object(
                 'fid', mm.faction_id, 'role', mm.role,
                 'flock', public._faith_strength(mm.faction_id)) order by mm.joined_at), '[]'::jsonb)
               from public.faith_membership mm where mm.faith_id = f.id),
    'offers_in', public._faith_offers_in(v_fid),
    'offers_out', case when is_founder then (
        select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'to_fid', o.to_fid) order by o.created_at), '[]'::jsonb)
        from public.faith_offers o where o.faith_id = f.id and o.status = 'pending')
      else '[]'::jsonb end);
end$$;
revoke all on function public.faith_status() from public;
grant execute on function public.faith_status() to authenticated;

-- ── 5) economy_accrue v3: + ДЕСЯТИНА основателю ─────────────
-- База: _faith_setup.sql (со строками «-- ВЕРА:»). Добавлено «-- ВЕРА-2:».
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

  for r in select btype, slots_open from public.colony_buildings where faction_id=p_fid loop
    if r.btype='factory' then inc_gc := inc_gc + r.slots_open*200;
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    elsif r.btype='temple' and has_faith then inc_gc := inc_gc + r.slots_open*150;  -- ВЕРА
    end if;
  end loop;

  -- ВЕРА-2: если я основатель веры — получаю 20% дохода храмов всех адептов/признавших.
  if exists(select 1 from public.faiths where founder_fid = p_fid) then
    select coalesce(sum(cb.slots_open),0) * 150 * 0.20 into tithe_gc
    from public.faith_membership m
    join public.faiths f on f.id = m.faith_id and f.founder_fid = p_fid
    join public.colony_buildings cb on cb.faction_id = m.faction_id and cb.btype = 'temple'
    where m.role <> 'founder';
    inc_gc := inc_gc + coalesce(tithe_gc, 0);
  end if;

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

-- ── Проверка ────────────────────────────────────────────────
-- select public.faith_offer_recognition('<target_faction_id>');
-- select public.faith_status();   -- offers_in / offers_out / role='recognized'
