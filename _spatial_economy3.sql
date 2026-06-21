-- ============================================================
-- ПРОСТРАНСТВЕННАЯ ЭКОНОМИКА · СРЕЗ 3 — торговые караваны гасят дефицит
-- Выполнить ПОСЛЕ _spatial_economy1.sql и _spatial_economy2.sql.
-- Роль логистики НЕ дублируется отдельной сущностью — её несут существующие
-- торговые караваны между игроками (public.trade_routes). Куда караван
-- доставляет груз (dest_sys), там растёт предложение → гаснет дефицит и
-- бедность. Своей таблицы маршрутов больше нет.
-- ⚠ Зеркало в economy.js: EC.spatial = NET-баланс систем (с учётом караванов).
-- ============================================================

-- ── Баланс системы С УЧЁТОМ караванов, проходящих ЧЕРЕЗ неё (net) ──
--   raw = _system_balance (домики+население). Затем: активные торговые
--   маршруты, чей путь по гиперпутям проходит через эту систему (транзит или
--   доставка), добавляют объём к предложению потребления — где караван
--   проходит, там беднеют меньше.
create or replace function public._system_balance_net(p_system_id text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  raw jsonb;
  sup_r numeric; sup_g numeric; sup_c numeric;
  dem_r numeric; dem_g numeric; dem_c numeric;
  lab_s numeric; lab_d numeric;
  imp_c numeric:=0;
  cov_r numeric; cov_g numeric; cov_c numeric; cov_l numeric;
  pr_r numeric; pr_g numeric; pr_c numeric;
  welfare numeric; prosperity numeric; st text;
begin
  raw := public._system_balance(p_system_id);
  sup_r := (raw->'supply'->>'r')::numeric; sup_g := (raw->'supply'->>'g')::numeric; sup_c := (raw->'supply'->>'c')::numeric;
  dem_r := (raw->'demand'->>'r')::numeric; dem_g := (raw->'demand'->>'g')::numeric; dem_c := (raw->'demand'->>'c')::numeric;
  lab_s := (raw->'labor'->>'supply')::numeric; lab_d := (raw->'labor'->>'demand')::numeric;

  -- КАРАВАНЫ ЧЕРЕЗ СИСТЕМУ: активные маршруты, чей путь проходит здесь,
  -- кормят систему (предложение потребления растёт → дефицит/бедность спадают).
  imp_c := public._caravan_inflow(p_system_id);
  sup_c := sup_c + imp_c;

  cov_r := case when dem_r<=0 then 1 else round(sup_r/dem_r,3) end;
  cov_g := case when dem_g<=0 then 1 else round(sup_g/dem_g,3) end;
  cov_c := case when dem_c<=0 then 1 else round(sup_c/dem_c,3) end;
  cov_l := case when lab_d<=0 then 1 else round(lab_s/lab_d,3) end;

  pr_r := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_r))),3);
  pr_g := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_g))),3);
  pr_c := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_c))),3);

  welfare := least(2.0, greatest(0, least(cov_c, cov_l)));
  prosperity := round(least(1.6, greatest(0.4, 0.4 + 0.6*welfare)),3);

  if cov_c < 0.4 or cov_l < 0.4 then st := 'stagnation';
  elsif cov_c < 0.7 or cov_l < 0.7 then st := 'unrest';
  else st := 'ok'; end if;

  return jsonb_build_object(
    'system_id', p_system_id, 'pop', raw->'pop',
    'supply',   jsonb_build_object('r',sup_r,'g',sup_g,'c',sup_c),
    'demand',   jsonb_build_object('r',dem_r,'g',dem_g,'c',dem_c),
    'labor',    jsonb_build_object('supply',lab_s,'demand',lab_d),
    'coverage', jsonb_build_object('r',cov_r,'g',cov_g,'c',cov_c,'l',cov_l),
    'prices',   jsonb_build_object('r',pr_r,'g',pr_g,'c',pr_c),
    'caravan',  jsonb_build_object('c', imp_c),   -- доставлено караванами в систему
    'prosperity', prosperity, 'status', st
  );
end$$;
revoke all on function public._system_balance_net(text) from public;
grant execute on function public._system_balance_net(text) to anon, authenticated;

-- ── spatial_status: NET-баланс (с доставками караванов) ──────
create or replace function public.spatial_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare app public.faction_applications; res jsonb := '[]'::jsonb; s record;
begin
  select * into app from public.faction_applications
    where owner_id = auth.uid() and status = 'approved' order by updated_at desc limit 1;
  if not found then return res; end if;
  for s in
    select distinct c.system_id, ms.name
    from public.colonies c
    left join public.map_systems ms on ms.id = c.system_id
    where c.faction_id = app.faction_id and c.system_id is not null
  loop
    res := res || jsonb_build_array(
      public._system_balance_net(s.system_id) || jsonb_build_object('name', s.name)
    );
  end loop;
  return res;
end$$;
revoke all on function public.spatial_status() from public;
grant execute on function public.spatial_status() to authenticated;

-- ── Маршрут каравана по гиперпутям (origin→dest, BFS как на клиенте) ─
--   Кратчайший путь по public.map_hyperlanes без циклов, с потолком глубины.
--   Возвращает массив system_id ВДОЛЬ ПУТИ (origin, промежуточные, dest) —
--   караван физически летит через эти системы (зеркало gmmBuildCaravans).
create or replace function public._caravan_path(p_origin text, p_dest text)
returns text[] language sql stable security definer set search_path=public as $$
  with recursive bfs as (
    select p_origin as node, array[p_origin] as path, 0 as depth
    union all
    select (case when h.a_id = b.node then h.b_id else h.a_id end),
           b.path || (case when h.a_id = b.node then h.b_id else h.a_id end),
           b.depth + 1
    from bfs b
    join public.map_hyperlanes h on (h.a_id = b.node or h.b_id = b.node)
    where b.depth < 10            -- потолок глубины (защита от взрыва на плотном графе)
      and b.node <> p_dest        -- ветку, дошедшую до цели, дальше не растим
      and (case when h.a_id = b.node then h.b_id else h.a_id end) <> all(b.path)  -- без циклов
  )
  select case when p_origin = p_dest then array[p_origin]
              else (select path from bfs where node = p_dest order by array_length(path,1) limit 1) end;
$$;
revoke all on function public._caravan_path(text,text) from public;
grant execute on function public._caravan_path(text,text) to anon, authenticated;

-- ── Приток караванами в систему (ВДОЛЬ ВСЕГО ПУТИ, не только dest) ───
--   Любой активный маршрут, чей путь проходит ЧЕРЕЗ эту систему, кормит её
--   своим объёмом (мультигруз — Σ cargo[].vol, иначе volume). Система-источник
--   (откуда груз уходит) не считается — берём путь со 2-го узла: транзит+доставка.
--   «Где караван проходит — там гаснет дефицит и бедность.»
create or replace function public._caravan_inflow(p_system_id text)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(sum(
    case when jsonb_array_length(coalesce(tr.cargo,'[]'::jsonb)) > 0
      then (select coalesce(sum((c->>'vol')::numeric),0) from jsonb_array_elements(tr.cargo) c)
      else coalesce(tr.volume,0) end
  ),0)
  from public.trade_routes tr
  where tr.status = 'active'
    and tr.origin_sys is not null and tr.dest_sys is not null
    and p_system_id = any((public._caravan_path(tr.origin_sys, tr.dest_sys))[2:]);
$$;
revoke all on function public._caravan_inflow(text) from public;
grant execute on function public._caravan_inflow(text) to anon, authenticated;

-- ── economy_accrue: NET-просперити (доставки караванов гасят дефицит) ──
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
  sys_net jsonb := '{}'::jsonb;                      -- ПРОСТР.ЭК: system_id → net-баланс (с доставками караванов)
  v_prosp numeric; v_pg numeric;                     -- ПРОСТР.ЭК: рабочие
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

  -- ПРОСТР.ЭК: net-баланс по системам фракции (раз за тик)
  for col in select distinct c.system_id as sid from public.colonies c
             where c.faction_id = p_fid and c.system_id is not null loop
    sys_net := jsonb_set(sys_net, array[col.sid], public._system_balance_net(col.sid), true);
  end loop;

  -- ГС-домики: доход × просперити(net) системы (фабрика ещё × ценовую премию товаров)
  for r in
    select cb.btype, cb.slots_open, cb.faith_id, c.system_id as sid
    from public.colony_buildings cb
    left join public.colonies c on c.id = cb.colony_id
    where cb.faction_id = p_fid
  loop
    v_prosp := coalesce((sys_net->r.sid->>'prosperity')::numeric, 1);
    if r.btype='factory' then
      v_pg := coalesce((sys_net->r.sid->'prices'->>'g')::numeric, 1);
      inc_gc := inc_gc + r.slots_open*200 * v_prosp * v_pg;
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100 * v_prosp;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    elsif r.btype='temple' and (                                                      -- МУЛЬТИ: доход лишь пока исповедуешь веру храма
        (r.faith_id is not null and public._faith_member(p_fid, r.faith_id))
        or (r.faith_id is null and has_faith)) then inc_gc := inc_gc + r.slots_open*150 * v_prosp;  -- ВЕРА
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

-- ── Проверка после применения ───────────────────────────────
-- select public._caravan_path('<origin>','<dest>');  -- цепочка систем вдоль маршрута
-- select public._caravan_inflow('<любая_система_на_пути>');  -- объём караванов через неё
-- select public.spatial_status();   -- у систем на пути caravan.c > 0 и coverage.c выше
