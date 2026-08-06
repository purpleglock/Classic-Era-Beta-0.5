-- ══════════════════════════════════════════════════════════════════════
-- ПРАВДА ДОХОДА ГС (06.08.2026)
--
-- Жалоба: «доход начисляется один, а в статистике другой». Причина — клиент
-- показывал механики, которых в тике НЕ БЫЛО: просперити систем и доход веры.
-- Решение принято В ПОЛЬЗУ КЛИЕНТА: заводим обе механики в economy_accrue.
--
-- Что меняется по балансу (это РЕАЛЬНЫЙ буст, не косметика):
--   • доход фабрик/хабов/храмов множится на просперити системы;
--   • храмы начинают платить по ставке «ВОЛНЫ» (_faith_temple_rate, 150…480
--     ГС/слот) — гейт по исповедуемой вере;
--   • основатель веры получает десятину 20% с храмов адептов (надбавка, у
--     адепта НЕ вычитается);
--   • тайные секты платят как скрытые храмы.
--
-- Побочно чинится мёртвый узел: _econ_update_status не звал НИКТО, из-за чего
-- статусы бедности и system_econ.prosperity стояли с 24.07. Теперь её зовёт тик.
--
-- Порядок: файл самодостаточен, катать одним куском. После наката — поднять
-- BUILD в index.html (клиент возвращает показ веры и просперити).
-- ══════════════════════════════════════════════════════════════════════

-- ── Разбивка веры в истории дохода ───────────────────────────────────
alter table public.income_history add column if not exists gc_temple numeric not null default 0;
alter table public.income_history add column if not exists gc_tithe  numeric not null default 0;
alter table public.income_history add column if not exists gc_sects  numeric not null default 0;

-- ── Просперити системы: ОДНО число для тика и для панелей ────────────
-- Читаем из system_econ (его обновляет _econ_update_status на тике). Если строка
-- протухла или её нет — считаем живьём. Так клиент и начисление видят одно и то же,
-- а не два независимо посчитанных значения (ровно эта развилка и породила жалобы).
create or replace function public._prosp_of(p_sid text)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select coalesce(
    (select se.prosperity from public.system_econ se
      where se.system_id = p_sid
        and se.updated_at > now() - interval '36 hours'
        and se.prosperity is not null),
    coalesce((public._system_balance_net(p_sid)->>'prosperity')::numeric, 1))
$fn$;

-- ── Доля храмовых слотов, которые реально платят ─────────────────────
-- Ставка ВОЛНЫ насыщается при полном охвате населения, но слоты сверх охвата
-- продолжали бы платить линейно — держава могла бы застроить пустые ячейки
-- храмами и печатать деньги без людей. Платят только слоты в пределах паствы:
-- frac = min(1, население / зона вещания). Это ЗЕРКАЛЬНАЯ величина к
-- _faith_coverage (там min(1, зона/население)) — не перепутать.
create or replace function public._faith_paid_frac(p_fid text)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select case when s.slots <= 0 or s.reach <= 0 then 0
              else round(least(1, s.pop / s.reach), 4) end
  from (select
    coalesce((select sum(slots_open) from public.colony_buildings
              where faction_id = p_fid and btype = 'temple'), 0)::numeric as slots,
    greatest(1, public._fac_pop(p_fid))::numeric as pop,
    coalesce((select sum(slots_open) from public.colony_buildings
              where faction_id = p_fid and btype = 'temple'), 0)::numeric
      * 120 * (1 + 0.10 * least(5, public._faith_monuments_n(p_fid))) as reach) s
$fn$;

-- ── Панель «Бедность»/«Благополучие» читает ту же просперити ─────────
CREATE OR REPLACE FUNCTION public.spatial_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare app public.faction_applications; res jsonb := '[]'::jsonb; s record; bal jsonb;
  v_strain numeric; v_pop numeric; v_rv timestamptz; v_relief jsonb;
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
    -- ПРОСПЕРИТИ (06.08): берём то же число, что начислил тик (_prosp_of),
    -- иначе панель и казна опять разойдутся.
    bal := public._system_balance_net(s.system_id)
           || jsonb_build_object('name', s.name,
                                 'prosperity', public._prosp_of(s.system_id));
    select coalesce(strain,0), revolt_until into v_strain, v_rv
      from public.system_econ where system_id = s.system_id;
    -- средняя доля заселённости системы (миграция)
    select case when sum(cells) > 0 then round(sum(cells*coalesce(pop_mult,1))/sum(cells),3) else 1 end
      into v_pop from public.colonies where system_id = s.system_id;
    -- активные меры помощи этой системе
    select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'until', until)), '[]'::jsonb)
      into v_relief from public.econ_relief
      where system_id = s.system_id and faction_id = app.faction_id and (until is null or until > now());
    res := res || jsonb_build_array(bal || jsonb_build_object(
      'strain', coalesce(v_strain,0),
      'pop_mult', coalesce(v_pop,1),
      'revolt_until', v_rv,
      'relief', v_relief));
  end loop;
  return res;
end$function$;

-- ── Тик: просперити + доход веры ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.economy_accrue(p_fid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- ══ ВОЗВРАТ 03.08: БЮДЖЕТ (клоббер _science_special_buildings 27.07) ══
  bdg public.faction_budget;                         -- БЮДЖЕТ: ползунки
  bdg_cost numeric := 0;                             -- БЮДЖЕТ: апкип ГС/сут
  w_mult numeric := 1;                               -- БЮДЖЕТ: благополучие (× ГС-доход)
  -- ТОВАРЫ (фабрика: поток строго под спрос населения)
  gf_slots numeric := 0; gf_ratio numeric := 0; gf_made numeric := 0;
  gf_water_need numeric; gf_mat_need numeric; take numeric; need numeric;
  av_lyod numeric; av_water numeric; av_iron numeric; av_silic numeric;
  goods_demand numeric := 0;
  goods_cov numeric := 1; goods_welfare numeric := 1;
  -- ПРОСПЕРИТИ (06.08): множитель дохода домиков по благополучию системы.
  prosp jsonb := '{}'::jsonb;
  -- ВЕРА (06.08): храмы/десятина/секты наконец начисляются тиком.
  t_rate numeric := 0; t_paid numeric := 1; temple_gc numeric := 0; tithe_gc numeric := 0; sects_gc numeric := 0;
  bld_gc numeric := 0; tmpl_gc numeric := 0; faith_gc numeric := 0;
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

  -- БЮДЖЕТ: ползунки + благополучие + апкип (ВОЗВРАТ 03.08)
  bdg := public._budget_row(p_fid);
  w_mult := public._budget_gc_mult(bdg.social);
  m_gc := m_gc * w_mult;
  bdg_cost := public._budget_upkeep(p_fid);

  update public.unit_production set status='done' where faction_id=p_fid and status='queued' and ready_at<=now();

  perform public._apply_colony_projects(p_fid);
  perform public._spy_resolve(p_fid);
  perform public._raid_resolve(p_fid);

  d := floor(extract(epoch from (now()-eco.last_tick))/86400.0);

  -- ══ ПРОСПЕРИТИ СИСТЕМ (06.08) ══════════════════════════════════════
  -- Благополучие системы наконец влияет на ДЕНЬГИ. Раньше просперити жила
  -- только в клиенте (ecBuildingProsp) и в _bld_daily_gc (дивиденды корпораций),
  -- а тик считал доход домиков плоско — отсюда и расхождение чисел у игроков.
  -- _econ_update_status пересчитывает просперити и КЛАДЁТ её в system_econ;
  -- до сегодня её не звал НИКТО (статусы бедности стояли с 24.07). Теперь её
  -- зовёт тик, а и начисление, и панель читают одно и то же число из кэша.
  if d >= 1 then
    perform public._econ_update_status(p_fid, d);
  end if;
  -- ⚠ алиас НЕ 'q': в функции уже есть переменная q (numeric) — будет конфликт имён
  select coalesce(jsonb_object_agg(psys.sid, psys.pv), '{}'::jsonb) into prosp from (
    select distinct c.system_id as sid, public._prosp_of(c.system_id) as pv
    from public.colonies c where c.faction_id = p_fid and c.system_id is not null) psys;

  -- ставка храма «ВОЛНЫ»: 150…480 ГС/слот от охвата, памятников, рвения и сети адептов
  t_rate := public._faith_temple_rate(p_fid);
  -- ⚠ ПОТОЛОК ПАСТВЫ. Ставка ВОЛНЫ уже насыщена при cov=1 (_faith_coverage режет
  -- охват на единице), но платить за КАЖДЫЙ слот сверх покрытия населения нельзя:
  -- на проверке держава с ~1200 слотов храмов получала 986k ГС/сут — больше всей
  -- своей промышленности, храм выходил доходнее фабрики (360 против 200 за слот).
  -- Платят только те слоты, чья зона вещания реально накрывает людей; остальные —
  -- памятники веры, а не источник денег.
  t_paid := public._faith_paid_frac(p_fid);

  for r in
    select cb.btype, cb.slots_open, cb.faith_id,
           coalesce((prosp->>c.system_id)::numeric, 1) as pr
    from public.colony_buildings cb
    left join public.colonies c on c.id = cb.colony_id
    where cb.faction_id = p_fid
  loop
    if r.btype='factory' then inc_gc := inc_gc + r.slots_open*200*r.pr;
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100*r.pr;
    elsif r.btype='temple' then
      -- гейт по вере: храм платит, пока держава исповедует ЕГО веру
      -- (faith_id null = старый храм, годится при любой вере). Зеркало ecTempleIncome.
      if exists(select 1 from public.faith_membership mm
                 where mm.faction_id = p_fid
                   and (r.faith_id is null or mm.faith_id = r.faith_id)) then
        temple_gc := temple_gc + r.slots_open * t_paid * t_rate * r.pr;
      end if;
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
                 * public._budget_cap_mult(bdg.infra));

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

    -- ════════ ТОВАРЫ: поток ПОД СПРОС (ВОЗВРАТ 03.08) ══════════════════
    -- Товары НЕ РЕСУРС: не пишутся на склад, не продаются, не копятся.
    -- Фабрика делает РОВНО столько, сколько съедает население за тик
    -- (спрос = pop/600/сут, зеркало EC_GOODS_DEMAND_DIV), и списывает
    -- воду/сырьё ПРОПОРЦИОНАЛЬНО выпуску (6 воды + 4 сырья на 10 товаров).
    goods_demand := public._fac_pop(p_fid) / 600.0 * d;
    select coalesce(sum(slots_open),0) into gf_slots
      from public.colony_buildings where faction_id=p_fid and btype='goodsfab';
    if gf_slots > 0 and goods_demand > 0 then
      av_lyod  := greatest(0, coalesce((eco.resources->>'Лёд')::numeric,0)         + coalesce((res_add->>'Лёд')::numeric,0)         - coalesce((res_sub->>'Лёд')::numeric,0));
      av_water := greatest(0, coalesce((eco.resources->>'Жидкая вода')::numeric,0) + coalesce((res_add->>'Жидкая вода')::numeric,0) - coalesce((res_sub->>'Жидкая вода')::numeric,0));
      av_iron  := greatest(0, coalesce((eco.resources->>'Железо')::numeric,0)      + coalesce((res_add->>'Железо')::numeric,0)      - coalesce((res_sub->>'Железо')::numeric,0));
      av_silic := greatest(0, coalesce((eco.resources->>'Силикаты')::numeric,0)    + coalesce((res_add->>'Силикаты')::numeric,0)    - coalesce((res_sub->>'Силикаты')::numeric,0));
      -- потолок мощности за тик и входы под ПОЛНУЮ мощность (для ratio-отчёта)
      gf_water_need := 6 * gf_slots * d;
      gf_mat_need   := 4 * gf_slots * d;
      gf_ratio := least(1,
        case when gf_water_need > 0 then (av_lyod + av_water) / gf_water_need else 1 end,
        case when gf_mat_need   > 0 then (av_iron + av_silic) / gf_mat_need   else 1 end);
      gf_ratio := greatest(0, gf_ratio);
      -- выпуск = минимум из спроса и мощности, ограниченной входами
      gf_made := least(goods_demand, 10 * gf_slots * d * gf_ratio);
      if gf_made > 0 then
        -- входы списываются под ФАКТИЧЕСКИЙ выпуск: 0.6 воды + 0.4 сырья на товар
        need := gf_made * 0.6;
        take := least(need, av_lyod);
        if take > 0 then res_sub := jsonb_set(res_sub, array['Лёд'], to_jsonb(coalesce((res_sub->>'Лёд')::numeric,0)+take), true); need := need - take; end if;
        if need > 0 then take := least(need, av_water);
          if take > 0 then res_sub := jsonb_set(res_sub, array['Жидкая вода'], to_jsonb(coalesce((res_sub->>'Жидкая вода')::numeric,0)+take), true); end if;
        end if;
        need := gf_made * 0.4;
        take := least(need, av_iron);
        if take > 0 then res_sub := jsonb_set(res_sub, array['Железо'], to_jsonb(coalesce((res_sub->>'Железо')::numeric,0)+take), true); need := need - take; end if;
        if need > 0 then take := least(need, av_silic);
          if take > 0 then res_sub := jsonb_set(res_sub, array['Силикаты'], to_jsonb(coalesce((res_sub->>'Силикаты')::numeric,0)+take), true); end if;
        end if;
      end if;
    end if;
    -- обеспечение = выпуск/спрос (0..1) → множитель дохода: 1 → ×1.10, 0 → ×0.90
    goods_cov := case when goods_demand > 0 then round(least(1, gf_made / goods_demand), 3) else 1 end;
    goods_welfare := round(least(1.10, greatest(0.90, 0.90 + 0.20 * goods_cov)), 3);

    -- ══ НАСЕЛЕНИЕ: рост = соцобеспечение + товары + памятник (ВОЗВРАТ 03.08) ══
    -- Потолок ячейки×100, пол ячейки×10, бэкфилл старых записей ячейки×50.
    -- Памятник Веры даёт колонии +0.5%/сут — работает и до модерации облика.
    update public.colonies c
       set pop = least(coalesce(c.cells,0)*100,
                   greatest(coalesce(c.cells,0)*10,
                     round(coalesce(c.pop, coalesce(c.cells,0)*50)
                           * power(1 + public._pop_growth(bdg.social)
                                     + 0.01 * least(1, goods_cov)
                                     + case when exists(select 1 from public.faith_monuments fm
                                                        where fm.colony_id = c.id and fm.status <> 'rejected')
                                            then 0.005 else 0 end, d))))
     where c.faction_id = p_fid;

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

    -- ══ ВЕРА: десятина и тайные секты (06.08) ═════════════════════════
    -- Десятина основателю: 20% дохода храмов ЧУЖИХ адептов моих вер, по ИХ
    -- собственной ставке ВОЛНЫ. Это НАДБАВКА основателю — у адепта ничего
    -- не вычитается (иначе вступление в чужую веру было бы чистым минусом).
    select coalesce(sum(public._faith_flock(mm.faction_id, f.id)
                        * public._faith_temple_rate(mm.faction_id) * 0.20), 0)
      into tithe_gc
      from public.faith_membership mm
      join public.faiths f on f.id = mm.faith_id
     where f.founder_fid = p_fid and mm.faction_id <> p_fid;
    -- тайные секты за рубежом = скрытые храмы по моей ставке (просперити нет — чужая земля)
    select coalesce(count(*),0) * t_rate into sects_gc
      from public.faith_sects where owner_fid = p_fid and status = 'active';
    tithe_gc := round(tithe_gc * m_gc * d);
    sects_gc := round(sects_gc * m_gc * d);

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

    -- 1) списания (товарная биржа + входы фабрики товаров) — освобождают
    --    место. Продали больше, чем лежало → недостачу берём из свежей
    --    добычи: сбыт идёт мимо склада, склад в минус не уходит.
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

    -- Слагаемые дохода одним местом — чтобы казна, income_history и превью
    -- считались ОДНИМ выражением и не могли разойтись (болезнь 06.08).
    bld_gc  := round(inc_gc * m_gc * goods_welfare * d);      -- фабрики+хабы × просперити
    tmpl_gc := round(temple_gc * m_gc * goods_welfare * d);   -- храмы × просперити
    faith_gc := tmpl_gc + tithe_gc + sects_gc;

    update public.faction_economy
      set gc = greatest(0, gc + bld_gc + faith_gc + trade_gc + market_gc + export_gc
                            - policy_cost * d - bdg_cost * d),   -- БЮДЖЕТ: апкип · ТОВАРЫ: × welfare
          science = science + greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
          agents  = agents  + greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
          resources = merged,
          last_tick = last_tick + (d || ' days')::interval
      where faction_id=p_fid returning * into eco;

    -- Статистика: mined = что РЕАЛЬНО легло на склад (было — сырая добыча).
    insert into public.income_history(faction_id, owner_id, days, gc_build, gc_trade, gc_market, gc_export, gc_policy, gc_net, gc_after, sci, agents_n, mined, mined_lost,
                                      gc_temple, gc_tithe, gc_sects)
      values(p_fid, eco.owner_id, d,
        bld_gc, trade_gc, market_gc, export_gc,
        (policy_cost + bdg_cost) * d,                            -- БЮДЖЕТ: апкип в расходах
        bld_gc + faith_gc + trade_gc + market_gc + export_gc
          - (policy_cost + bdg_cost) * d,
        eco.gc,
        greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
        greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
        v_stored, v_lost,
        tmpl_gc, tithe_gc, sects_gc);
    delete from public.income_history where faction_id=p_fid
      and id not in (select id from public.income_history where faction_id=p_fid order by tick_at desc limit 30);
  end if;

  -- завершение готовых исследований + автозапуск очереди (после начисления ОН)
  perform public._research_step(p_fid);
  select * into eco from public.faction_economy where faction_id = p_fid;

  return jsonb_build_object('faction_id',eco.faction_id,'gc',eco.gc,'science',eco.science,'agents',eco.agents,
    'resources',eco.resources,'last_tick',eco.last_tick,'days',d, 'mods', mods,
    'goods', jsonb_build_object('demand', round(goods_demand),   -- ТОВАРЫ: поток под спрос
       'coverage', goods_cov, 'welfare', goods_welfare, 'made', round(gf_made), 'ratio', gf_ratio),
    'income', jsonb_build_object(
      'gc',     round(inc_gc * m_gc * goods_welfare),
      'temple', round(temple_gc * m_gc * goods_welfare),
      'tithe',  case when d >= 1 then round(tithe_gc / d) else 0 end,
      'sects',  case when d >= 1 then round(sects_gc / d) else 0 end,
      'temple_rate', t_rate,
      'science',greatest(0, inc_sci    + (mods->>'sci_flat')::numeric),
      'agents', greatest(0, inc_agents + (mods->>'agents_flat')::numeric),
      'trade',  trade_gc, 'market', market_gc, 'export', export_gc,
      'policy', policy_cost, 'pirate', pirate, 'budget', bdg_cost,
      'mined',  v_stored, 'mined_lost', v_lost, 'store_cap', cap),
    'budget', jsonb_build_object(                                -- БЮДЖЕТ: ползунки для клиента
      'industry', bdg.industry, 'military', bdg.military, 'science', bdg.science,
      'social', bdg.social, 'infra', bdg.infra,
      'pop', public._fac_pop(p_fid), 'pop_cap', public._fac_pop_cap(p_fid),
      'growth', public._pop_growth(bdg.social),
      'upkeep', bdg_cost, 'w_mult', w_mult));
end
$function$;
