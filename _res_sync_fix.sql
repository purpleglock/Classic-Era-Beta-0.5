-- ============================================================
--  РАССИНХРОН РЕСУРСОВ: склад и статистика  ·  _res_sync_fix.sql
--  Жалоба: «засирает даже склад, если нет места» + числа панели не сходятся
--  с начислением.
--
--  ТРИ БАГА, ТРИ ПОЧИНКИ (все в одном накате, идемпотентно):
--
--  1) ЛИМИТ СКЛАДА ПРИМЕНЯЛСЯ ПО КАЖДОМУ РЕСУРСУ.
--     В economy_accrue слияние было `least(cap, склад_k + добыча_k)` — то есть
--     КАЖДЫЙ ресурс мог дорасти до полной ёмкости, а UI и гайд обещают ОБЩИЙ
--     лимит на все ресурсы вместе. Итог на 03.08: склады забиты в разы сверх
--     лимита (240 673 при лимите 43 000; 22 158 при 1 000). Теперь:
--       · сперва СПИСАНИЯ (товарная биржа), они освобождают место;
--       · продали больше, чем лежало → недостачу берём из свежей добычи
--         (сбыт идёт мимо склада, как экспорт), склад в минус не уходит;
--       · добыча ложится ТОЛЬКО в свободное место, пропорционально по всем
--         ресурсам + добор наибольших остатков, чтобы место не пропадало;
--       · сверх ёмкости — сгорает (ровно то, что написано в UI и гайде).
--     Ёмкость = (1000 + 500×слоты складов) × _budget_cap_mult(инфраструктура) —
--     множитель инфраструктуры обещан гайдом и уже применялся в аванпостах,
--     но НЕ применялся в тике. Теперь единая формула везде.
--
--  2) СТАТИСТИКА ВРАЛА: income_history.mined писал СЫРУЮ добычу, а не то, что
--     реально легло на склад. Теперь mined = положено, mined_lost = сгорело.
--
--  3) ГЛАВНОЕ: ДВЕ РАЗНЫЕ МОДЕЛИ ДОБЫЧИ.
--     Панель «⛏ Ресурсы» (resource_worker_plan) считает добычу РАБОЧИМИ
--     (реворк 24.07), а тик копал по ДОМИКАМ/ЯРУСАМ (накат 29.07 незаметно
--     затёр accrue реворка). Для fac_95a2fce0aa панель показывала +14 783/сут,
--     тик давал +83 627/сут сырыми. Модели сведены В ОДНУ:
--
--       выход залежи = min( потолок залежи ,  ПОЛНАЯ СТАВКА × ПОКРЫТИЕ )
--         ПОЛНАЯ СТАВКА = база(редкость) × богатство × доктрина × домик
--                         (ставки 29.07 — баланс сохранён)
--         ПОКРЫТИЕ      = рабочих на залежи ÷ спрос залежи (0…1)
--         потолок       = _mine_cap(богатство) × 8 × доктрина (анти-стакинг 29.07)
--         рабочих < 5   → залежь не копается (как и показывает панель)
--
--     Что это даёт: рабочие, ползунок «Снабжение», приоритетные системы
--     (6000 ГС) и политика редкости НАКОНЕЦ влияют на начисление — до этого
--     тик их не смотрел вовсе. Домик перестаёт быть гейтом (залежь копается и
--     без него, ×1.0), ярусный штраф 0.8 уходит — его роль играет домик-буст.
--     Перебор идёт по _worker_deposits: концессии гейтятся там же (на чужой
--     колонии копаю только отданные мне залежи, на своей — только не отданные).
--
--     БАЛАНС ПРОВЕРЕН по живой базе: суммарная добыча галактики
--     224.6k/сут → 247.7k/сут (+10%), то есть уровень 29.07 сохранён.
--
--  Экспортный канал (mine_mode='export' → караваны/экспорт) СОХРАНЁН: доля
--  вывоза = доля слотов добывающих построек колонии в режиме «экспорт».
--
--  Порядок: самостоятельный накат, зависимостей нет (все хелперы уже в базе).
-- ============================================================

-- ── 0) СХЕМА: сколько добычи сгорело сверх ёмкости склада ───
alter table public.income_history add column if not exists mined_lost numeric default 0;

-- ── 1) ЖИВОЕ НАЧИСЛЕНИЕ ─────────────────────────────────────
create or replace function public.economy_accrue(p_fid text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  eco public.faction_economy; d int;
  inc_gc numeric:=0; inc_sci numeric:=0; inc_agents int:=0; trade_gc numeric:=0; pirate boolean:=false;
  r record; col record; bld record; relem jsonb; thr jsonb;
  res_add jsonb := '{}'::jsonb; res_sub jsonb := '{}'::jsonb; merged jsonb; k text;
  rname text; rr text; rate numeric; escorted boolean; attacked boolean; chance numeric; avail numeric; shipped numeric;
  mods jsonb; m_mine numeric; m_gc numeric; tier_f numeric; slot_f numeric;
  market_cap numeric; market_gc numeric := 0; sell numeric;
  export_gc numeric := 0; cap numeric;
  rel_score int; dip_coef numeric;
  mine_flow jsonb := '{}'::jsonb;
  flow_rar  jsonb := '{}'::jsonb;
  citem jsonb; cargo_price numeric;
  policy_cost numeric := 0;
  -- РАБОЧИЕ (единая модель с панелью «⛏ Ресурсы»)
  w_alloc jsonb := '{}'::jsonb; w_dem jsonb := '{}'::jsonb; dep_w numeric; cov numeric;
  -- ОБЩИЙ СКЛАД
  stored jsonb := '{}'::jsonb;
  v_used numeric; v_free numeric; v_want numeric; v_stored numeric := 0; v_lost numeric := 0;
  q numeric; ff numeric;
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
    elsif r.btype='sci_giant' then inc_sci := inc_sci + r.slots_open*3;
    elsif r.btype='sci_anomaly' then inc_sci := inc_sci + r.slots_open*5;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    end if;
  end loop;

  if d >= 1 then
    -- Ёмкость ОБЩЕГО склада: база + слоты складов, × множитель инфраструктуры
    -- (зеркало _outpost_mining_settle и ecStoreCap на клиенте).
    cap := round((1000 + coalesce((select sum(slots_open) from public.colony_buildings
                            where faction_id=p_fid and btype='warehouse'),0) * 500)
                 * public._budget_cap_mult((public._budget_row(p_fid)).infra));

    -- ══ ДОБЫЧА: ставка залежи × покрытие рабочими (сведено 2026-08-03) ═══
    -- Ставка 29.07 (редкость × богатство × доктрина × домик) и потолок залежи
    -- сохранены — балансовый уровень тот же. Новое: сколько из ставки реально
    -- добыто, решают РАБОЧИЕ, ровно как показывает панель «⛏ Ресурсы».
    -- Перебор по _worker_deposits: залежи всех моих колоний + концессии на
    -- чужих; домик больше не обязателен (он буст, а не гейт присутствия).
    w_alloc := public._worker_alloc(p_fid);
    for r in select colony_id, demand from public._worker_demand(p_fid) loop
      w_dem := jsonb_set(w_dem, array[r.colony_id::text], to_jsonb(r.demand), true);
    end loop;

    for bld in
      select dp.colony_id, dp.res_name as q_name, dp.rarity as q_rar, dp.amt as q_amt,
             dp.dep_demand, dp.house_slots,
             -- полная ставка залежи при 100% покрытии рабочими
             greatest(1, round(
               (case dp.rarity when 'uncommon' then 12 when 'rare' then 6
                               when 'epic' then 3 when 'legendary' then 1 else 25 end)
               * public._richness_mult(dp.amt) * m_mine * public._house_mult(dp.house_slots)
             )) as q_full,
             greatest(1, round(public._mine_cap(dp.amt) * 8 * m_mine)) as dep_cap,
             -- доля вывоза = доля слотов добывающих построек колонии в режиме «экспорт»
             coalesce((select sum(case when coalesce(cb.mine_mode,'store')='export'
                                       then greatest(1, coalesce(cb.slots_open,1)) else 0 end)::numeric
                            / nullif(sum(greatest(1, coalesce(cb.slots_open,1))),0)
                       from public.colony_buildings cb
                      where cb.colony_id = dp.colony_id and cb.faction_id = p_fid
                        and cb.btype in ('mining','mining_deep','mining_exotic')), 0) as exp_share
      from public._worker_deposits(p_fid) dp
    loop
      rname := bld.q_name;
      rr := bld.q_rar;
      if bld.dep_demand is null or bld.dep_demand <= 0 then continue; end if;
      -- рабочие колонии делятся между её залежами пропорционально спросу
      dep_w := floor(coalesce((w_alloc->>bld.colony_id::text)::numeric, 0)
                     * bld.dep_demand
                     / nullif(coalesce((w_dem->>bld.colony_id::text)::numeric, 0), 0));
      if dep_w is null or dep_w < 5 then continue; end if;   -- «нет рабочих» — как в панели
      cov := least(1, dep_w / bld.dep_demand);
      rate := least(bld.dep_cap, round(bld.q_full * cov));
      if rate <= 0 then continue; end if;
      declare
        to_exp numeric; to_store numeric;
      begin
        to_exp := round(rate * bld.exp_share);
        to_store := greatest(0, rate - to_exp);
        if to_exp > 0 then
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(coalesce((mine_flow->>rname)::numeric,0) + to_exp*d), true);
          flow_rar  := jsonb_set(flow_rar,  array[rname], to_jsonb(rr), true);
        end if;
        if to_store > 0 then
          res_add := jsonb_set(res_add, array[rname], to_jsonb(coalesce((res_add->>rname)::numeric,0) + to_store*d), true);
        end if;
      end;
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

    -- ══ СКЛАД: лимит ОБЩИЙ на все ресурсы вместе ═══════════════════════
    -- Было `least(cap, склад_k + добыча_k)` по каждому ресурсу — суммарный
    -- склад получался фактически безлимитным (в 5–22 раза сверх ёмкости).
    merged := coalesce(eco.resources,'{}'::jsonb);

    -- 1) списания (товарная биржа) — освобождают место. Если продали больше,
    --    чем лежало, недостачу берём из свежей добычи: сбыт идёт мимо склада.
    for k in select jsonb_object_keys(res_sub) loop
      q := coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric;
      if q < 0 then
        res_add := jsonb_set(res_add, array[k],
                     to_jsonb(greatest(0, coalesce((res_add->>k)::numeric,0) + q)), true);
        q := 0;
      end if;
      merged := jsonb_set(merged, array[k], to_jsonb(q), true);
    end loop;

    -- 2) добыча ложится только в СВОБОДНОЕ место
    select coalesce(sum(value::numeric),0) into v_used from jsonb_each_text(merged);
    select coalesce(sum(value::numeric),0) into v_want from jsonb_each_text(res_add);
    v_free := greatest(0, cap - v_used);
    if v_want > 0 and v_free > 0 then
      ff := least(1, v_free / v_want);
      -- пропорционально: переполнение режет все ресурсы одинаково, а не первый по алфавиту
      for k in select key from jsonb_each_text(res_add) order by (value::numeric) desc loop
        q := least(floor((res_add->>k)::numeric * ff), v_free - v_stored);
        if q > 0 then
          stored := jsonb_set(stored, array[k], to_jsonb(q), true);
          v_stored := v_stored + q;
        end if;
      end loop;
      -- добор: место, потерянное на округлении вниз, отдаём наибольшим остаткам
      for k in select key from jsonb_each_text(res_add) order by (value::numeric) desc loop
        exit when v_stored >= v_free;
        q := least((res_add->>k)::numeric - coalesce((stored->>k)::numeric,0), v_free - v_stored);
        if q > 0 then
          stored := jsonb_set(stored, array[k], to_jsonb(coalesce((stored->>k)::numeric,0) + q), true);
          v_stored := v_stored + q;
        end if;
      end loop;
      for k in select jsonb_object_keys(stored) loop
        merged := jsonb_set(merged, array[k],
                    to_jsonb(coalesce((merged->>k)::numeric,0) + (stored->>k)::numeric), true);
      end loop;
    end if;
    v_lost := greatest(0, v_want - v_stored);   -- сгорело: нет места на складе

    update public.faction_economy
      set gc = greatest(0, gc + round(inc_gc * m_gc * d) + trade_gc + market_gc + export_gc - policy_cost * d),
          science = science + greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
          agents  = agents  + greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
          resources = merged,
          last_tick = last_tick + (d || ' days')::interval
      where faction_id=p_fid returning * into eco;

    -- Статистика: mined = что РЕАЛЬНО легло на склад (было — сырая добыча).
    insert into public.income_history(faction_id, owner_id, days, gc_build, gc_trade, gc_market, gc_export, gc_policy, gc_net, gc_after, sci, agents_n, mined, mined_lost)
      values(p_fid, eco.owner_id, d,
        round(inc_gc * m_gc * d), trade_gc, market_gc, export_gc, policy_cost * d,
        round(inc_gc * m_gc * d) + trade_gc + market_gc + export_gc - policy_cost * d,
        eco.gc,
        greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
        greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
        v_stored, v_lost);
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
      'policy', policy_cost, 'pirate', pirate,
      'mined',  v_stored, 'mined_lost', v_lost, 'store_cap', cap));
end
$function$;

-- ── 2) ПАНЕЛЬ = ЗЕРКАЛО ТИКА ────────────────────────────────
-- yield считается ровно той же формулой, что и начисление: полная ставка
-- залежи × покрытие рабочими, срез потолком залежи. Плюс отдаём клиенту
-- слагаемые (full_rate/cov/dep_cap) — чтобы «разбор добычи» не врал.
create or replace function public.resource_worker_plan()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  fid text; alloc jsonb; total_w numeric; b public.faction_budget;
  mods jsonb; m_mine numeric; systems jsonb := '[]'::jsonb;
  sysrec record; deprec record;
  col_dem_map jsonb := '{}'::jsonb;
  dw record;
  sys_workers numeric; sys_demand numeric; deps jsonb;
  col_workers numeric; col_dem numeric; dep_workers numeric; dep_yield numeric;
  dep_full numeric; dep_cap numeric; dep_cov numeric;
  rpol jsonb; store_cap numeric; store_used numeric;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('error','no_faction'); end if;
  b := public._budget_row(fid);
  total_w := public._fac_workers(fid);
  alloc := public._worker_alloc(fid);
  mods := public._faction_mods(fid);
  m_mine := (mods->>'mine')::numeric;
  select coalesce(rarity_policy,'{}'::jsonb) into rpol from public.faction_economy where faction_id = fid;

  store_cap := round((1000 + coalesce((select sum(slots_open) from public.colony_buildings
                          where faction_id=fid and btype='warehouse'),0) * 500)
                     * public._budget_cap_mult(b.infra));
  select coalesce(sum(value::numeric),0) into store_used
    from public.faction_economy fe, jsonb_each_text(coalesce(fe.resources,'{}'::jsonb))
   where fe.faction_id = fid;

  for dw in select colony_id, demand from public._worker_demand(fid) loop
    col_dem_map := jsonb_set(col_dem_map, array[dw.colony_id::text], to_jsonb(dw.demand), true);
  end loop;

  for sysrec in
    select d.system_id,
           coalesce(nullif(ms.name,''), d.system_id, 'Система') as sys_name,
           bool_or(d.priority) as priority,
           array_agg(distinct d.colony_id) as colony_ids
    from public._worker_deposits(fid) d
    left join public.map_systems ms on ms.id = d.system_id
    group by d.system_id, ms.name
  loop
    sys_workers := 0; sys_demand := 0; deps := '[]'::jsonb;
    for deprec in
      select * from public._worker_deposits(fid) dep
      where dep.system_id is not distinct from sysrec.system_id
      order by dep.dep_demand desc
    loop
      col_workers := coalesce((alloc->>deprec.colony_id::text)::numeric, 0);
      col_dem     := coalesce((col_dem_map->>deprec.colony_id::text)::numeric, 0);
      dep_workers := case when col_dem > 0 then floor(col_workers * deprec.dep_demand / col_dem) else 0 end;
      -- зеркало economy_accrue: ставка × покрытие, срез потолком залежи
      dep_full := greatest(1, round(
        (case deprec.rarity when 'uncommon' then 12 when 'rare' then 6
                            when 'epic' then 3 when 'legendary' then 1 else 25 end)
        * public._richness_mult(deprec.amt) * m_mine * public._house_mult(deprec.house_slots)));
      dep_cap  := greatest(1, round(public._mine_cap(deprec.amt) * 8 * m_mine));
      dep_cov  := case when deprec.dep_demand > 0 then least(1, dep_workers / deprec.dep_demand) else 0 end;
      dep_yield := case when dep_workers < 5 then 0
                        else least(dep_cap, round(dep_full * dep_cov)) end;
      sys_workers := sys_workers + dep_workers;
      sys_demand  := sys_demand + deprec.dep_demand;
      deps := deps || jsonb_build_object(
        'colony_id', deprec.colony_id,
        'planet', deprec.planet_name,
        'res', deprec.res_name,
        'rarity', deprec.rarity,
        'amt', deprec.amt,
        'demand', round(deprec.dep_demand),
        'workers', round(dep_workers),
        'base', floor(dep_workers / 5.0),
        'covered', dep_workers >= 5,
        'fill', round(dep_cov, 3),
        'btype', deprec.btype,
        'house_slots', deprec.house_slots,
        'bcount', deprec.bcount,
        'house_bonus', round((public._house_mult(deprec.house_slots) - 1) * 100),
        'm_mine', m_mine,
        'full_rate', dep_full,          -- ставка при 100% покрытии
        'dep_cap', dep_cap,             -- потолок залежи (анти-стакинг)
        'cov', round(dep_cov, 3),
        'yield', round(dep_yield));
    end loop;

    systems := systems || jsonb_build_object(
      'system_id', sysrec.system_id,
      'name', sysrec.sys_name,
      'priority', sysrec.priority,
      'colony_ids', to_jsonb(sysrec.colony_ids),
      'demand', round(sys_demand),
      'workers', round(sys_workers),
      'fill', case when sys_demand > 0 then round(least(1, sys_workers / sys_demand), 3) else 0 end,
      'deposits', deps);
  end loop;

  return jsonb_build_object(
    'workers_total', round(total_w),
    'pop', round(public._fac_pop(fid)),
    'share', public._worker_share(coalesce(b.industry_eff, b.industry)),
    'industry', b.industry,
    'industry_eff', coalesce(b.industry_eff, b.industry),
    'm_mine', m_mine,
    'mine_sources', public._mine_breakdown(fid),
    'priority_cost', 6000,
    'rarity_policy', coalesce(rpol,'{}'::jsonb),
    'store_cap', store_cap,
    'store_used', round(store_used),
    'systems', systems);
end$function$;

-- ── 3) АВАНПОСТЫ: тот же ОБЩИЙ лимит склада ─────────────────
create or replace function public._outpost_mining_settle(p_fid text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o record; relem jsonb; d int; dd int; rr text; rate numeric; rname text;
  cur jsonb; gc_total numeric := 0;
  cap numeric; addq numeric; used numeric; free numeric;
begin
  if not exists(select 1 from public.outposts where faction_id=p_fid and mode='mining'
                  and floor(extract(epoch from (now()-coalesce(last_accrue,created_at)))/86400.0) >= 1) then
    return;   -- нечего начислять
  end if;
  select coalesce(resources,'{}'::jsonb) into cur from public.faction_economy where faction_id=p_fid for update;
  if cur is null then return; end if;

  -- Ёмкость склада ОБЩАЯ на все ресурсы (зеркало economy_accrue), а не по ресурсу
  cap := round((1000 + coalesce((select sum(slots_open) from public.colony_buildings
                          where faction_id=p_fid and btype='warehouse'),0) * 500)
               * public._budget_cap_mult((public._budget_row(p_fid)).infra));
  select coalesce(sum(value::numeric),0) into used from jsonb_each_text(cur);
  free := greatest(0, cap - used);

  for o in select * from public.outposts where faction_id=p_fid and mode='mining' loop
    d := floor(extract(epoch from (now()-coalesce(o.last_accrue,o.created_at)))/86400.0);
    if d < 1 then continue; end if;
    dd := least(d, 7);   -- анти-вывал: начисляем максимум за 7 пропущенных суток
    gc_total := gc_total + public._defense_const('outpost_mine_gc') * dd;

    -- ВСЕ ресурсы планет системы, кроме эпических и легендарных
    for relem in
      select r.value
      from jsonb_array_elements(coalesce((select planets from public.map_systems where id=o.system_id),'[]'::jsonb)) pl,
           jsonb_array_elements(coalesce(pl.value->'resources','[]'::jsonb)) r
    loop
      exit when free <= 0;   -- склад полон — добыча аванпоста сгорает
      rname := relem->>'name';
      if rname is null then continue; end if;
      rr := coalesce(relem->>'r', (select rarity from public.resource_rarity where name = rname), 'common');
      if rr in ('epic','legendary') then continue; end if;   -- элита — только экзотический экстрактор
      rate := case rr when 'uncommon' then 6 when 'rare' then 3 else 12 end;
      addq := least(rate * dd, free);
      if addq > 0 then
        cur := jsonb_set(cur, array[rname], to_jsonb(coalesce((cur->>rname)::numeric,0) + addq), true);
        free := free - addq;
      end if;
    end loop;

    update public.outposts set last_accrue = coalesce(last_accrue,created_at) + (d || ' days')::interval
      where id = o.id;
  end loop;

  update public.faction_economy set gc = gc + gc_total, resources = cur where faction_id = p_fid;
end$function$;
