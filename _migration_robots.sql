-- ════════════════════════════════════════════════════════════════════════
--  МИГРАЦИЯ: фракции-роботы
--  «Робот» = раса «Синтетики / Киборги» ИЛИ правление «Машинный разум (ИИ)».
--  Бонусы:
--    • пехота собирается на Военном Заводе ×3 (3000/слот) — это в JS (economy.js);
--    • 2 параллельных слота исследований (research_active / research_active2);
--    • 2 захвата систем за цикл.
--
--  Запускать ОТДЕЛЬНО в SQL-редакторе. Самодостаточно: все зависимости
--  (_faction_mods, _apply_colony_projects, _spy_resolve, _res_price) уже в базе.
--  Включает свежую economy_accrue — она же содержит баланс дохода фабрики/добычи
--  (фабрика 200, добыча 50), так что отдельную mining-миграцию повторять не нужно.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Схема: второй слот исследований
alter table public.faction_economy add column if not exists research_active2 text;
alter table public.faction_economy add column if not exists research_ready2  timestamptz;

-- 2. Детектор «роботов»
create or replace function public._faction_is_robot(p_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.faction_applications
    where faction_id = p_fid and status = 'approved'
      and (race = 'Синтетики / Киборги' or gov = 'Машинный разум (ИИ)')
  );
$$;
revoke all on function public._faction_is_robot(text) from public;
grant execute on function public._faction_is_robot(text) to authenticated;

-- 3. Исследования: 1 слот; роботы — 2 параллельных
create or replace function public.economy_research(p_node text, p_cost numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; eco public.faction_economy;
  max_slots int := 1; active_cnt int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_node is null or p_node = '' then raise exception 'bad node'; end if;
  if p_cost is null or p_cost < 0 then raise exception 'bad cost'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into eco from public.faction_economy where faction_id=app.faction_id;
  if not found then raise exception 'no economy'; end if;

  if public._faction_is_robot(app.faction_id) then max_slots := 2; end if;
  active_cnt := (eco.research_active is not null)::int + (eco.research_active2 is not null)::int;
  if active_cnt >= max_slots then raise exception 'research in progress'; end if;
  if eco.research_active = p_node or eco.research_active2 = p_node then raise exception 'already in progress'; end if;
  if coalesce(eco.research,'[]'::jsonb) ? p_node then raise exception 'already researched'; end if;
  if coalesce(eco.science,0) < p_cost then raise exception 'not enough science'; end if;

  if eco.research_active is null then
    update public.faction_economy
      set science = science - p_cost, research_active = p_node, research_ready = now() + interval '1 day'
      where faction_id = app.faction_id;
  else
    update public.faction_economy
      set science = science - p_cost, research_active2 = p_node, research_ready2 = now() + interval '1 day'
      where faction_id = app.faction_id;
  end if;
  return jsonb_build_object('ok', true, 'ready_at', now() + interval '1 day');
end$$;
revoke all on function public.economy_research(text,numeric) from public;
grant execute on function public.economy_research(text,numeric) to authenticated;

-- 4. Захват систем: «Дом в небесах» ИЛИ роботы → 2 за цикл
create or replace function public.economy_claim_system(p_system_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  app public.faction_applications;
  eco public.faction_economy;
  sys public.map_systems;
  adj boolean;
  cost numeric := 3000;
  cd interval := '7 days';
  mods jsonb;
  max_claims int := 1;
  in_window boolean;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into app from public.faction_applications
    where owner_id = auth.uid() and status = 'approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  mods := public._faction_mods(app.faction_id);
  cost := round(3000 * (mods->>'claim_cost')::numeric);
  cd := (round(7 * (mods->>'claim_cd')::numeric) || ' days')::interval;
  select * into eco from public.faction_economy where faction_id = app.faction_id;
  if not found then raise exception 'no economy'; end if;
  select * into sys from public.map_systems where id = p_system_id;
  if not found then raise exception 'system not found'; end if;
  if sys.faction is not null then raise exception 'system already claimed'; end if;

  select exists (
    select 1 from public.map_hyperlanes h
    join public.map_systems ms
      on ms.id = case when h.a_id = p_system_id then h.b_id
                      when h.b_id = p_system_id then h.a_id end
    where (h.a_id = p_system_id or h.b_id = p_system_id) and ms.faction = app.faction_id
  ) into adj;
  if not adj then raise exception 'system not adjacent to your territory'; end if;

  if eco.gc < cost then raise exception 'not enough GC'; end if;

  if (eco.research is not null and eco.research ? 'pol.house_heavens')
     or public._faction_is_robot(app.faction_id) then max_claims := 2; end if;
  in_window := eco.last_system_claim is not null and eco.last_system_claim > now() - cd;

  if in_window then
    if coalesce(eco.claim_used, 0) >= max_claims then raise exception 'claim cooldown active'; end if;
    update public.faction_economy
      set gc = gc - cost, claim_used = coalesce(claim_used, 0) + 1
      where faction_id = app.faction_id;
  else
    update public.faction_economy
      set gc = gc - cost, last_system_claim = now(), claim_used = 1
      where faction_id = app.faction_id;
  end if;
  update public.map_systems set faction = app.faction_id where id = p_system_id;

  return jsonb_build_object('ok', true, 'system_id', p_system_id, 'cost', cost);
end$$;
revoke all on function public.economy_claim_system(text) from public;
grant execute on function public.economy_claim_system(text) to authenticated;

-- 5. Начисление: завершает ОБА слота исследований (+ баланс фабрики/добычи 200/50)
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

  -- завершение исследований: слот 1
  if eco.research_active is not null and eco.research_ready is not null and eco.research_ready <= now() then
    update public.faction_economy
      set research = coalesce(research,'[]'::jsonb) || to_jsonb(eco.research_active::text),
          research_active = null, research_ready = null
      where faction_id = p_fid;
    select * into eco from public.faction_economy where faction_id = p_fid;
  end if;
  -- завершение исследований: слот 2 (роботы)
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
    elsif r.btype='mining' then inc_gc := inc_gc + r.slots_open*50;  -- + ресурсы (ниже)
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    end if;
  end loop;

  if d >= 1 then
    for bld in
      select cb.mining_targets, c.resources as cres
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
        rate := case rr when 'uncommon' then 12 when 'rare' then 5 when 'epic' then 2 when 'legendary' then 1 else 25 end;
        rate := greatest(1, round(rate * m_mine));
        res_add := jsonb_set(res_add, array[rname], to_jsonb(coalesce((res_add->>rname)::numeric,0) + rate*d), true);
      end loop;
    end loop;

    for r in select volume, resource, price, convoy, threats, b_fid from public.trade_routes where status='active' and a_fid=p_fid loop
      escorted := coalesce(r.convoy,0) > 0; attacked := false;
      for thr in select value from jsonb_array_elements(coalesce(r.threats,'[]'::jsonb)) loop
        if (thr->>'type') = 'ancient' then chance := case when escorted then 0.65 else 0.80 end;
        else chance := case when escorted then 0.40 else 0.80 end; end if;
        if random() < chance then attacked := true; end if;
      end loop;
      if attacked then pirate := true; continue; end if;
      avail := coalesce((eco.resources->>r.resource)::numeric,0) + coalesce((res_add->>r.resource)::numeric,0) - coalesce((res_sub->>r.resource)::numeric,0);
      shipped := least(coalesce(r.volume,0)*d, avail);
      if shipped <= 0 then continue; end if;
      res_sub := jsonb_set(res_sub, array[r.resource], to_jsonb(coalesce((res_sub->>r.resource)::numeric,0)+shipped), true);
      trade_gc := trade_gc + shipped * coalesce(r.price,0);
      update public.faction_economy set gc = gc + round(shipped*coalesce(r.price,0)*0.33) where faction_id = r.b_fid;
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
          order by nm, public._res_price(rr) desc
        ) u
        where avail > 0
        order by public._res_price(res_rar) desc
      loop
        exit when market_cap <= 0;
        sell := least(r.avail, market_cap);
        res_sub := jsonb_set(res_sub, array[r.res_name],
                     to_jsonb(coalesce((res_sub->>r.res_name)::numeric,0) + sell), true);
        market_gc := market_gc + sell * public._res_price(r.res_rar) * 0.5;
        market_cap := market_cap - sell;
      end loop;
      market_gc := round(market_gc * m_gc);
    end if;

    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_add) loop
      merged := jsonb_set(merged, array[k], to_jsonb(coalesce((merged->>k)::numeric,0) + (res_add->>k)::numeric), true);
    end loop;
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric)), true);
    end loop;

    update public.faction_economy
      set gc = gc + round(inc_gc * m_gc * d) + trade_gc + market_gc,
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
      'trade',  trade_gc, 'market', market_gc, 'pirate', pirate));
end$$;
