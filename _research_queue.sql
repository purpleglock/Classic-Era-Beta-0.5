-- ============================================================
-- ОЧЕРЕДЬ ТЕХНОЛОГИЙ + ДОПОЛНИТЕЛЬНЫЕ СЛОТЫ ИССЛЕДОВАНИЙ
--
-- 1) Активные исследования теперь хранятся в jsonb-массиве research_slots
--    ([{n:node, r:ready_ts}, …]) вместо двух фикс-колонок research_active/2.
--    Это снимает потолок «2 параллельных» и позволяет N слотов.
-- 2) research_queue (jsonb-массив node-id) — очередь технологий. Когда слот
--    освобождается, голова очереди автозапускается (если хватает ОН и изучены
--    предшественники), списывая ОН на сервере.
-- 3) Кол-во слотов = база 1 (+1 роботам) + политики:
--      • «Свет знаний»        pol.light_knowledge  → +1 слот
--      • «Превосходство разума» pol.mind_supremacy  → +2 слота
--
-- Применять в Supabase → SQL Editor ПОСЛЕ _income_history.sql и
-- _security_research.sql. Идемпотентно.
-- ============================================================

-- ── 1) Новые колонки ────────────────────────────────────────
alter table public.faction_economy add column if not exists research_slots jsonb not null default '[]'::jsonb;
alter table public.faction_economy add column if not exists research_queue jsonb not null default '[]'::jsonb;

-- ── 2) Каталог: две новые политические технологии (слоты исследований) ──
insert into public.tech_nodes (node_id, base_cost, prereq) values
  ('pol.light_knowledge', 70,  '[]'),
  ('pol.mind_supremacy',  140, '["pol.light_knowledge"]')
on conflict (node_id) do update
  set base_cost = excluded.base_cost, prereq = excluded.prereq;

-- ── 3) Бэкфилл: перенести незавершённые research_active/2 в research_slots ──
update public.faction_economy e
set research_slots = (
  select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb) from (
    select jsonb_build_object('n', e.research_active,  'r', e.research_ready)  elem, 1 ord
      where e.research_active is not null
    union all
    select jsonb_build_object('n', e.research_active2, 'r', e.research_ready2), 2
      where e.research_active2 is not null
  ) t)
where jsonb_array_length(e.research_slots) = 0
  and (e.research_active is not null or e.research_active2 is not null);

-- ── Кол-во слотов исследований фракции ──────────────────────
-- Зеркало ecResearchSlots() в economy.js.
create or replace function public._research_slots(p_fid text)
returns int language plpgsql stable security definer set search_path=public as $$
declare n int := 1; rs jsonb;
begin
  if public._faction_is_robot(p_fid) then n := n + 1; end if;
  select research into rs from public.faction_economy where faction_id = p_fid;
  rs := coalesce(rs, '[]'::jsonb);
  if rs ? 'pol.light_knowledge' then n := n + 1; end if;
  if rs ? 'pol.mind_supremacy'  then n := n + 2; end if;
  return n;
end$$;
revoke all on function public._research_slots(text) from public;
grant execute on function public._research_slots(text) to authenticated;

-- ── Шаг исследований на тике: завершить готовые слоты + добрать из очереди ──
-- Вызывается из economy_accrue. Цена/prereq — из каталога tech_nodes (сервер).
create or replace function public._research_step(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare
  eco public.faction_economy;
  slot jsonb; kept jsonb := '[]'::jsonb; done_ids text[] := '{}';
  smax int; nid text; tn public.tech_nodes; cost numeric; mres numeric;
  in_slot boolean; has_missing boolean; guard int := 0;
begin
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then return; end if;

  -- 1) завершить готовые слоты → research[]
  for slot in select value from jsonb_array_elements(coalesce(eco.research_slots,'[]'::jsonb)) loop
    if (slot->>'r') is not null and (slot->>'r')::timestamptz <= now() then
      done_ids := array_append(done_ids, slot->>'n');
    else
      kept := kept || slot;
    end if;
  end loop;
  if array_length(done_ids,1) is not null then
    eco.research := coalesce(eco.research,'[]'::jsonb) || to_jsonb(done_ids);
    eco.research_slots := kept;
    update public.faction_economy
      set research = eco.research, research_slots = eco.research_slots
      where faction_id = p_fid;
  end if;

  -- 2) добрать из очереди в свободные слоты
  smax := public._research_slots(p_fid);
  mres := (public._faction_mods(p_fid)->>'research')::numeric;
  loop
    guard := guard + 1; exit when guard > 50;
    exit when jsonb_array_length(coalesce(eco.research_slots,'[]'::jsonb)) >= smax;
    exit when jsonb_array_length(coalesce(eco.research_queue,'[]'::jsonb)) = 0;
    nid := eco.research_queue->>0;

    -- уже изучено / уже в слоте / неизвестный узел → выбросить голову, дальше
    select * into tn from public.tech_nodes where node_id = nid;
    select exists(select 1 from jsonb_array_elements(coalesce(eco.research_slots,'[]'::jsonb)) ee
                  where ee->>'n' = nid) into in_slot;
    if tn.node_id is null or (coalesce(eco.research,'[]'::jsonb) ? nid) or in_slot then
      eco.research_queue := eco.research_queue - 0;
      update public.faction_economy set research_queue = eco.research_queue where faction_id = p_fid;
      continue;
    end if;

    -- предшественники изучены?
    select exists(
      select 1 from jsonb_array_elements_text(coalesce(tn.prereq,'[]'::jsonb)) v
      where not (coalesce(eco.research,'[]'::jsonb) ? v)
    ) into has_missing;
    if has_missing then exit; end if;   -- ждём, пока изучатся предшественники

    -- хватает ОН?
    cost := greatest(1, round(tn.base_cost * mres));
    if coalesce(eco.science,0) < cost then exit; end if;   -- ждём накопления ОН

    -- СТАРТ: снять с головы, добавить слот, списать ОН
    eco.research_queue := eco.research_queue - 0;
    eco.research_slots := coalesce(eco.research_slots,'[]'::jsonb)
      || jsonb_build_object('n', nid, 'r', now() + interval '1 day');
    eco.science := coalesce(eco.science,0) - cost;
    update public.faction_economy
      set research_queue = eco.research_queue,
          research_slots = eco.research_slots,
          science = eco.science
      where faction_id = p_fid;
  end loop;
end$$;
revoke all on function public._research_step(text) from public;
grant execute on function public._research_step(text) to authenticated;

-- ── economy_research: старт исследования НЕМЕДЛЕННО в свободный слот ─────
-- Сигнатура прежняя (text, numeric); p_cost от клиента игнорируется.
create or replace function public.economy_research(p_node text, p_cost numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; eco public.faction_economy; tn public.tech_nodes;
  smax int; cost numeric; missing text; in_slot boolean;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_node is null or p_node = '' then raise exception 'bad node'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into eco from public.faction_economy where faction_id=app.faction_id;
  if not found then raise exception 'no economy'; end if;

  select * into tn from public.tech_nodes where node_id = p_node;
  if not found then raise exception 'unknown tech node'; end if;

  smax := public._research_slots(app.faction_id);
  if jsonb_array_length(coalesce(eco.research_slots,'[]'::jsonb)) >= smax then raise exception 'research in progress'; end if;
  select exists(select 1 from jsonb_array_elements(coalesce(eco.research_slots,'[]'::jsonb)) ee
                where ee->>'n' = p_node) into in_slot;
  if in_slot then raise exception 'already in progress'; end if;
  if coalesce(eco.research,'[]'::jsonb) ? p_node then raise exception 'already researched'; end if;

  select string_agg(value, ', ') into missing
    from jsonb_array_elements_text(coalesce(tn.prereq,'[]'::jsonb)) as value
    where not (coalesce(eco.research,'[]'::jsonb) ? value);
  if missing is not null then raise exception 'missing prerequisites: %', missing; end if;

  cost := greatest(1, round(tn.base_cost * (public._faction_mods(app.faction_id)->>'research')::numeric));
  if coalesce(eco.science,0) < cost then raise exception 'not enough science'; end if;

  update public.faction_economy
    set science = science - cost,
        research_slots = coalesce(research_slots,'[]'::jsonb)
          || jsonb_build_object('n', p_node, 'r', now() + interval '1 day')
    where faction_id = app.faction_id;
  return jsonb_build_object('ok', true, 'cost', cost, 'ready_at', now() + interval '1 day');
end$$;
revoke all on function public.economy_research(text,numeric) from public;
grant execute on function public.economy_research(text,numeric) to authenticated;

-- ── economy_research_queue: добавить технологию в очередь ────
create or replace function public.economy_research_queue(p_node text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; eco public.faction_economy; tn public.tech_nodes;
  in_slot boolean; in_queue boolean; missing text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_node is null or p_node = '' then raise exception 'bad node'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into eco from public.faction_economy where faction_id=app.faction_id;
  if not found then raise exception 'no economy'; end if;

  select * into tn from public.tech_nodes where node_id = p_node;
  if not found then raise exception 'unknown tech node'; end if;
  if coalesce(eco.research,'[]'::jsonb) ? p_node then raise exception 'already researched'; end if;

  select exists(select 1 from jsonb_array_elements(coalesce(eco.research_slots,'[]'::jsonb)) ee
                where ee->>'n' = p_node) into in_slot;
  if in_slot then raise exception 'already in progress'; end if;
  select exists(select 1 from jsonb_array_elements_text(coalesce(eco.research_queue,'[]'::jsonb)) v
                where v = p_node) into in_queue;
  if in_queue then raise exception 'already queued'; end if;

  -- предшественники должны быть изучены, в слоте ИЛИ уже в очереди (раньше)
  select string_agg(value, ', ') into missing
    from jsonb_array_elements_text(coalesce(tn.prereq,'[]'::jsonb)) as value
    where not (coalesce(eco.research,'[]'::jsonb) ? value)
      and not exists(select 1 from jsonb_array_elements(coalesce(eco.research_slots,'[]'::jsonb)) ee where ee->>'n' = value)
      and not exists(select 1 from jsonb_array_elements_text(coalesce(eco.research_queue,'[]'::jsonb)) qv where qv = value);
  if missing is not null then raise exception 'queue prerequisites first: %', missing; end if;

  if jsonb_array_length(coalesce(eco.research_queue,'[]'::jsonb)) >= 12 then raise exception 'queue full'; end if;

  update public.faction_economy
    set research_queue = coalesce(research_queue,'[]'::jsonb) || to_jsonb(p_node)
    where faction_id = app.faction_id;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.economy_research_queue(text) from public;
grant execute on function public.economy_research_queue(text) to authenticated;

-- ── economy_research_dequeue: убрать технологию из очереди по индексу ──
create or replace function public.economy_research_dequeue(p_idx int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; eco public.faction_economy;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into eco from public.faction_economy where faction_id=app.faction_id;
  if not found then raise exception 'no economy'; end if;
  if p_idx is null or p_idx < 0 or p_idx >= jsonb_array_length(coalesce(eco.research_queue,'[]'::jsonb)) then
    raise exception 'bad queue index';
  end if;
  update public.faction_economy
    set research_queue = research_queue - p_idx
    where faction_id = app.faction_id;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.economy_research_dequeue(int) from public;
grant execute on function public.economy_research_dequeue(int) to authenticated;

-- ════════════════════════════════════════════════════════════
-- economy_accrue: версия _income_history.sql, но завершение/очередь
-- исследований вынесены в _research_step (вызов в конце тика).
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
  policy_cost numeric := 0;
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

  -- завершение готовых исследований + автозапуск очереди (после начисления ОН)
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
-- select research_slots, research_queue from public.faction_economy limit 5;
-- select public._research_slots('<faction_id>');   -- 1..5
