-- ============================================================
-- ФАБРИКА ТОВАРОВ · реальная производственная цепочка
--   вода (🧊 Лёд / 🌊 Жидкая вода) + сырьё (⚙️ Железо / 🪨 Силикаты)
--     → 📦 Товары → ОБЕСПЕЧЕНИЕ населения → благополучие → доход.
--   Излишек товаров копится на складе и продаётся на бирже (Товарная биржа).
--   Игрок даёт товарам своё имя (бренд).
--
-- ПРИМЕНЯТЬ ПОСЛЕ: _faith_multi.sql (берёт его economy_accrue v5 как базу и
--   дописывает блок -- ТОВАРЫ). Если у тебя живёт более новая версия
--   economy_accrue — скажи, перенесу блок в неё (это create-or-replace, файл
--   станет источником истины для функции).
--
-- РЕЦЕПТ (на 1 слот в сутки): 6 воды + 4 сырья → 10 товаров.
-- СПРОС: население системы (cells × pop_mult) ÷ 12 товаров/сут.
-- ОБЕСПЕЧЕНИЕ → доход: covered≥1 → ×1.10, дефицит → к ×0.90 (плавно).
-- ============================================================

-- ── бренд товаров державы (имя продукта) ────────────────────
alter table public.faction_economy add column if not exists goods_brand text;

-- ── каталог: новый тип постройки goodsfab ───────────────────
create or replace function public._ec_bld_base(p_btype text)
returns numeric language sql immutable as $$
  select case p_btype
    when 'factory'          then 500    when 'mining'   then 500
    when 'trade'            then 1000   when 'market'   then 1500
    when 'science'          then 1000   when 'training' then 500
    when 'intel'            then 3000   when 'military_factory' then 1000
    when 'shipyard'         then 2000   when 'warehouse' then 800
    when 'temple'           then 1200
    when 'starbase'         then 5000
    when 'flak'             then 1500
    when 'abm'              then 3000
    when 'goodsfab'         then 1200   -- ФАБРИКА ТОВАРОВ
    else null end
$$;
create or replace function public._ec_bld_free(p_btype text)
returns int language sql immutable as $$
  select case when p_btype in ('factory','mining') then 2 else 1 end
$$;
-- лестница слотов goodsfab = как у обычных (не как factory/mining)
create or replace function public._ec_bld_ladder(p_btype text, p_idx int)
returns numeric language sql immutable as $$
  select case
    when p_idx < 0 or p_idx > 5 then null
    else (case when p_btype in ('factory','mining')
               then (array[0,0,500,1500,1500,3000])[p_idx+1]
               else (array[0,500,500,1500,1500,3000])[p_idx+1]
          end)
  end
$$;

-- ── RPC: задать/сменить бренд товаров ───────────────────────
create or replace function public.goods_set_brand(p_name text)
returns text language plpgsql security definer set search_path=public as $$
declare fid text; nm text;
begin
  fid := public._ec_my_fid();
  nm := nullif(btrim(p_name), '');
  if nm is not null and char_length(nm) > 40 then nm := left(nm, 40); end if;
  update public.faction_economy set goods_brand = nm where faction_id = fid;
  return nm;
end$$;
revoke all on function public.goods_set_brand(text) from public;
grant execute on function public.goods_set_brand(text) to authenticated;

-- ════════════════════════════════════════════════════════════
-- economy_accrue v6 = v5 (_faith_multi) + блок -- ТОВАРЫ
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
  has_faith boolean := false;
  tithe_gc numeric := 0;
  v_sects int := 0;
  sct record; v_ci_host int; v_new_exp numeric;
  -- ── ТОВАРЫ ──
  gf_slots numeric := 0; gf_ratio numeric := 0; gf_made numeric := 0;
  gf_water_need numeric; gf_mat_need numeric; take numeric; need numeric;
  av_lyod numeric; av_water numeric; av_iron numeric; av_silic numeric;
  goods_demand numeric := 0; goods_have numeric; goods_eaten numeric := 0;
  goods_cov numeric := 1; goods_welfare numeric := 1; goods_gc numeric := 0;
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

    -- ════════ ТОВАРЫ: производство (вода+сырьё → товары) ════════
    select coalesce(sum(slots_open),0) into gf_slots
      from public.colony_buildings where faction_id=p_fid and btype='goodsfab';
    if gf_slots > 0 then
      -- доступно на складе (учёт уже намайненного/потраченного за этот тик)
      av_lyod  := greatest(0, coalesce((eco.resources->>'Лёд')::numeric,0)         + coalesce((res_add->>'Лёд')::numeric,0)         - coalesce((res_sub->>'Лёд')::numeric,0));
      av_water := greatest(0, coalesce((eco.resources->>'Жидкая вода')::numeric,0) + coalesce((res_add->>'Жидкая вода')::numeric,0) - coalesce((res_sub->>'Жидкая вода')::numeric,0));
      av_iron  := greatest(0, coalesce((eco.resources->>'Железо')::numeric,0)      + coalesce((res_add->>'Железо')::numeric,0)      - coalesce((res_sub->>'Железо')::numeric,0));
      av_silic := greatest(0, coalesce((eco.resources->>'Силикаты')::numeric,0)    + coalesce((res_add->>'Силикаты')::numeric,0)    - coalesce((res_sub->>'Силикаты')::numeric,0));
      gf_water_need := 6 * gf_slots * d;
      gf_mat_need   := 4 * gf_slots * d;
      -- узкое место: на сколько хватает воды и сырья (0..1)
      gf_ratio := least(1,
        case when gf_water_need > 0 then (av_lyod + av_water) / gf_water_need else 1 end,
        case when gf_mat_need   > 0 then (av_iron + av_silic) / gf_mat_need   else 1 end);
      gf_ratio := greatest(0, gf_ratio);
      if gf_ratio > 0 then
        gf_made := round(10 * gf_slots * d * gf_ratio);
        -- расход воды: сперва Лёд, затем Жидкая вода
        need := gf_water_need * gf_ratio;
        take := least(need, av_lyod);
        if take > 0 then res_sub := jsonb_set(res_sub, array['Лёд'], to_jsonb(coalesce((res_sub->>'Лёд')::numeric,0)+take), true); need := need - take; end if;
        if need > 0 then take := least(need, av_water);
          if take > 0 then res_sub := jsonb_set(res_sub, array['Жидкая вода'], to_jsonb(coalesce((res_sub->>'Жидкая вода')::numeric,0)+take), true); end if;
        end if;
        -- расход сырья: сперва Железо, затем Силикаты
        need := gf_mat_need * gf_ratio;
        take := least(need, av_iron);
        if take > 0 then res_sub := jsonb_set(res_sub, array['Железо'], to_jsonb(coalesce((res_sub->>'Железо')::numeric,0)+take), true); need := need - take; end if;
        if need > 0 then take := least(need, av_silic);
          if take > 0 then res_sub := jsonb_set(res_sub, array['Силикаты'], to_jsonb(coalesce((res_sub->>'Силикаты')::numeric,0)+take), true); end if;
        end if;
        -- готовые товары на склад
        res_add := jsonb_set(res_add, array['Товары'], to_jsonb(coalesce((res_add->>'Товары')::numeric,0) + gf_made), true);
      end if;
    end if;

    -- ════════ ТОВАРЫ: обеспечение населения ════════
    select coalesce(sum(cells * coalesce(pop_mult,1)),0) / 12.0 into goods_demand
      from public.colonies where faction_id = p_fid;
    goods_demand := goods_demand * d;
    goods_have := greatest(0, coalesce((eco.resources->>'Товары')::numeric,0)
                              + coalesce((res_add->>'Товары')::numeric,0)
                              - coalesce((res_sub->>'Товары')::numeric,0));
    if goods_demand > 0 then
      goods_eaten := least(goods_have, goods_demand);
      if goods_eaten > 0 then
        res_sub := jsonb_set(res_sub, array['Товары'], to_jsonb(coalesce((res_sub->>'Товары')::numeric,0) + goods_eaten), true);
      end if;
      goods_cov := round(least(1.5, goods_have / goods_demand), 3);
    else
      goods_cov := 1;
    end if;
    -- обеспечение → множитель дохода: covered≥1 → ×1.10, дефицит → к ×0.90
    goods_welfare := round(least(1.10, greatest(0.90, 0.90 + 0.20 * least(1, goods_cov))), 3);

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
      -- ТОВАРЫ: излишек (сверх обеспечения) продаётся первым по 12 ГС/ед × 0.6
      goods_have := greatest(0, coalesce((eco.resources->>'Товары')::numeric,0)
                                + coalesce((res_add->>'Товары')::numeric,0)
                                - coalesce((res_sub->>'Товары')::numeric,0));
      if goods_have > 0 then
        sell := least(goods_have, market_cap);
        res_sub := jsonb_set(res_sub, array['Товары'], to_jsonb(coalesce((res_sub->>'Товары')::numeric,0) + sell), true);
        goods_gc := round(sell * 12 * 0.6 * m_gc);
        market_gc := market_gc + goods_gc;
        market_cap := market_cap - sell;
      end if;
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
        market_gc := market_gc + round(sell * public._res_value(r.res_name, r.res_rar) *
          (case r.res_rar when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65 when 'uncommon' then 0.55 else 0.5 end) * m_gc);
        market_cap := market_cap - sell;
      end loop;
    end if;

    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_add) loop
      merged := jsonb_set(merged, array[k], to_jsonb(least(cap, coalesce((merged->>k)::numeric,0) + (res_add->>k)::numeric)), true);
    end loop;
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric)), true);
    end loop;

    -- ТОВАРЫ: обеспечение умножает доход построек (covered → богаче, дефицит → беднее)
    update public.faction_economy
      set gc = greatest(0, gc + round(inc_gc * m_gc * goods_welfare * d) + trade_gc + market_gc + export_gc - policy_cost * d),
          science = science + greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
          agents  = agents  + greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
          resources = merged,
          last_tick = last_tick + (d || ' days')::interval
      where faction_id=p_fid returning * into eco;

    insert into public.income_history(faction_id, owner_id, days, gc_build, gc_trade, gc_market, gc_export, gc_policy, gc_net, gc_after, sci, agents_n, mined)
      values(p_fid, eco.owner_id, d,
        round(inc_gc * m_gc * goods_welfare * d), trade_gc, market_gc, export_gc, policy_cost * d,
        round(inc_gc * m_gc * goods_welfare * d) + trade_gc + market_gc + export_gc - policy_cost * d,
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
    'goods', jsonb_build_object('brand', eco.goods_brand, 'demand', round(goods_demand),
       'coverage', goods_cov, 'welfare', goods_welfare, 'made', gf_made, 'ratio', gf_ratio, 'sold_gc', goods_gc),
    'income', jsonb_build_object(
      'gc',     round(inc_gc * m_gc * goods_welfare),
      'science',greatest(0, inc_sci    + (mods->>'sci_flat')::numeric),
      'agents', greatest(0, inc_agents + (mods->>'agents_flat')::numeric),
      'trade',  trade_gc, 'market', market_gc, 'export', export_gc,
      'policy', policy_cost, 'pirate', pirate));
end$$;
revoke all on function public.economy_accrue(text) from public;
grant execute on function public.economy_accrue(text) to authenticated;

-- ── Проверка после применения ───────────────────────────────
-- 1) построй «Фабрику товаров», добудь Лёд/Воду + Железо/Силикаты на склад
-- 2) дождись тика → на складе появятся «Товары», входы убудут
-- select resources->'Товары', goods_brand from public.faction_economy where faction_id='<fid>';
-- 3) (economy_accrue('<fid>'))->'goods'  — demand/coverage/welfare/made
