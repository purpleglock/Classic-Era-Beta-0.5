-- ═══ РЕВОРК МАШИН (17.08) ═══════════════════════════════════════════════
-- Было: −35% денег (+ ещё −15% от «Машинного разума») за набор, половина
-- которого не работала (пехота ×3 не считается сервером вообще).
-- Стало: штраф −15% без двойного удара, и другой набор — свои правила
-- вместо чужих бонусов. Зеркало на клиенте: economy.js (EC_MODS и др.).

CREATE OR REPLACE FUNCTION public._faction_mods(p_fid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.faction_applications;
  gc numeric:=0; mine numeric:=0; bld numeric:=0; col numeric:=0; cc numeric:=0; cd numeric:=0; rsch numeric:=0;
  scf int:=0; agf int:=0;   -- плоские: наука ОН/сут, агенты /сут
  rsrch jsonb;              -- изученные технологии (faction_economy.research)
  pol jsonb;                -- КУРС: дельты экономического курса державы
begin
  select * into a from public.faction_applications where faction_id=p_fid and status='approved' order by updated_at desc limit 1;
  if not found then
    
  -- СОВЕТ ДЕРЖАВЫ (_char_office.sql): персонажи на должностях.
  begin
    pol := public._fm_council_mods(p_fid);
    gc   := gc   + coalesce((pol->>'gc')::numeric, 0);
    mine := mine + coalesce((pol->>'mine')::numeric, 0);
    bld  := bld  + coalesce((pol->>'build')::numeric, 0);
    rsch := rsch + coalesce((pol->>'research')::numeric, 0);
    col  := col  + coalesce((pol->>'colonize')::numeric, 0);
    cc   := cc   + coalesce((pol->>'claim_cost')::numeric, 0);
    cd   := cd   + coalesce((pol->>'claim_cd')::numeric, 0);
    scf  := scf  + coalesce((pol->>'sci_flat')::int, 0);
    agf  := agf  + coalesce((pol->>'agents_flat')::int, 0);
  exception when others then null;
  end;

  return jsonb_build_object('gc',1,'mine',1,'build',1,'research',1,'colonize',1,'claim_cost',1,'claim_cd',1,'sci_flat',0,'agents_flat',0);
  end if;

  -- ⚠ Числа = зеркало EC_MODS в economy.js. Менять синхронно.
  case a.gov
    when 'Республика'          then gc:=gc+0.05; scf:=scf+1; agf:=agf-1;
    when 'Монархия'            then gc:=gc+0.15; rsch:=rsch+0.10; cd:=cd+0.10;
    when 'Империя'             then cc:=cc-0.20; cd:=cd-0.15; gc:=gc-0.15; agf:=agf+1;
    when 'Олигархия'           then gc:=gc+0.20; scf:=scf-1; agf:=agf-1;
    when 'Диктатура'           then cd:=cd-0.20; agf:=agf+1; gc:=gc-0.10; scf:=scf-1;
    when 'Теократия'           then gc:=gc+0.10; rsch:=rsch+0.10; agf:=agf+1; scf:=scf-1;
    when 'Технократия'         then gc:=gc-0.20; rsch:=rsch-0.15; bld:=bld+0.05; scf:=scf+2;
    when 'Корпоратократия'     then gc:=gc+0.10; mine:=mine+0.10; agf:=agf-1;
    when 'Коллективный разум'  then mine:=mine+0.20; cc:=cc+0.15; gc:=gc-0.10; scf:=scf+1;
    when 'Машинный разум (ИИ)' then gc:=gc-0.15; bld:=bld-0.10; rsch:=rsch-0.10; scf:=scf+1; agf:=agf+1;
    else null;
  end case;

  case a.regime
    when 'Демократический'   then gc:=gc+0.15; agf:=agf-1;
    when 'Эгалитарный'       then gc:=gc+0.10; cc:=cc+0.10; scf:=scf+1;
    when 'Меритократический'  then gc:=gc-0.10; rsch:=rsch-0.15; scf:=scf+2;
    when 'Плутократический'   then gc:=gc+0.20; scf:=scf-1; agf:=agf-1;
    when 'Олигархический'     then gc:=gc+0.15; mine:=mine-0.10;
    when 'Авторитарный'       then mine:=mine+0.10; agf:=agf+1; gc:=gc-0.10;
    when 'Тоталитарный'       then mine:=mine+0.20; gc:=gc-0.15; agf:=agf+1;
    when 'Деспотичный'        then cd:=cd-0.20; agf:=agf+1; scf:=scf-1;
    when 'Деспотизм'          then mine:=mine+0.15; gc:=gc+0.10; rsch:=rsch+0.15; scf:=scf-1; agf:=agf+1;
    when 'Анархический'       then col:=col-0.20; bld:=bld+0.15; gc:=gc-0.15; scf:=scf+1;
    else null;
  end case;

  case a.ideology
    when 'Технократия (Культ науки)' then gc:=gc-0.15; rsch:=rsch-0.20; scf:=scf+2;
    when 'Милитаризм (Культ силы)'   then cc:=cc-0.20; gc:=gc-0.10; rsch:=rsch+0.10; agf:=agf+1;
    when 'Пацифизм'                  then gc:=gc+0.25; cd:=cd+0.15; agf:=agf-1;
    when 'Экспансионизм'             then col:=col-0.25; cc:=cc-0.20; gc:=gc-0.10;
    when 'Изоляционизм'              then gc:=gc+0.15; cc:=cc+0.20; cd:=cd+0.20; agf:=agf+1;
    when 'Ксенофилия'                then gc:=gc+0.20; col:=col-0.10; agf:=agf-1;
    when 'Ксенофобия'                then mine:=mine+0.15; gc:=gc-0.10; agf:=agf+1;
    when 'Спиритуализм'              then gc:=gc+0.10; rsch:=rsch+0.10; scf:=scf-1; agf:=agf+1;
    when 'Трансгуманизм'             then gc:=gc-0.10; rsch:=rsch-0.20; scf:=scf+2;
    when 'Экоцентризм'               then mine:=mine+0.25; gc:=gc-0.15; bld:=bld+0.05;
    when 'Индустриализм'             then bld:=bld-0.15; mine:=mine+0.10; gc:=gc+0.05; rsch:=rsch+0.10;
    else null;
  end case;

  case a.race
    when 'Гуманоиды'                  then gc:=gc+0.05; scf:=scf+1;
    when 'Млекопитающие'              then gc:=gc+0.15;
    when 'Рептилоиды'                 then gc:=gc-0.10; agf:=agf+1;
    when 'Авианы (Птицеподобные)'     then cd:=cd-0.20; gc:=gc-0.05; agf:=agf+1;
    when 'Инсектоиды'                 then mine:=mine+0.15; gc:=gc+0.05; rsch:=rsch+0.10; scf:=scf-1;
    when 'Акватики (Водные)'          then gc:=gc+0.15; col:=col+0.15;
    when 'Плантоиды (Растениевидные)' then mine:=mine+0.15; gc:=gc+0.05; agf:=agf-1;
    when 'Литоиды (Каменные)'         then mine:=mine+0.20; gc:=gc-0.15;
    when 'Синтетики / Киборги'        then gc:=gc-0.15; mine:=mine+0.10; rsch:=rsch-0.15; scf:=scf+2;  -- РЕВОРК 17.08: деньги -15% (было -35%), дроны в шахтах +10%
    when 'Энергетические сущности'    then gc:=gc-0.15; rsch:=rsch-0.10; scf:=scf+1; agf:=agf+1;
    else null;
  end case;

  -- РЕВОРК 17.08: «Синтетики» + «Машинный разум» — ОДНА и та же природа,
  -- нельзя брать за неё плату дважды. Денежный штраф правления аннулируется.
  if a.race = 'Синтетики / Киборги' and a.gov = 'Машинный разум (ИИ)' then gc := gc + 0.15; end if;

  case a.civ_type
    when 'frontier' then col:=col-0.20; cd:=cd-0.20; gc:=gc-0.15;
    when 'colony'   then gc:=gc+0.15; mine:=mine+0.10; cc:=cc+0.15; bld:=bld-0.10;
    else null;
  end case;

  -- Лёгкий бонус планеты-столицы (зеркало EC_CAPITAL в economy.js).
  case a.capital_env
    when 'terrestrial' then gc:=gc+0.05;
    when 'oceanic'     then col:=col-0.10;
    when 'desert'      then mine:=mine+0.10;
    when 'volcanic'    then mine:=mine+0.10;
    when 'lava'        then mine:=mine+0.12;
    when 'cryo'        then rsch:=rsch-0.08;
    when 'micro'       then cd:=cd-0.12;
    when 'exotic'      then scf:=scf+1;
    else null;
  end case;

  -- Бонусы изученных политических технологий (зеркало EC_POLITICS в economy.js).
  select research into rsrch from public.faction_economy where faction_id=p_fid;
  if rsrch is not null then
    if rsrch ? 'pol.new_deal'    then gc:=gc+0.10; end if;
    if rsrch ? 'pol.mercantile'  then gc:=gc+0.10; bld:=bld-0.05; end if;
    if rsrch ? 'pol.five_year'   then bld:=bld-0.15; end if;
    if rsrch ? 'pol.goelro'      then mine:=mine+0.15; end if;
    if rsrch ? 'pol.land_reform' then col:=col-0.15; end if;
    if rsrch ? 'pol.total_mob'   then cc:=cc-0.20; end if;
  end if;

  -- КУРС ДЕРЖАВЫ (_econ_policy.sql). Guard — если срез не накачен, курса просто нет.
  begin
    pol := public._econ_policy_mods(p_fid);
    gc   := gc   + coalesce((pol->>'gc')::numeric, 0);
    mine := mine + coalesce((pol->>'mine')::numeric, 0);
    bld  := bld  + coalesce((pol->>'build')::numeric, 0);
    rsch := rsch + coalesce((pol->>'research')::numeric, 0);
    col  := col  + coalesce((pol->>'colonize')::numeric, 0);
    cc   := cc   + coalesce((pol->>'claim_cost')::numeric, 0);
    cd   := cd   + coalesce((pol->>'claim_cd')::numeric, 0);
    scf  := scf  + coalesce((pol->>'sci_flat')::int, 0);
    agf  := agf  + coalesce((pol->>'agents_flat')::int, 0);
  exception when undefined_function then null;
  end;

  
  -- СОВЕТ ДЕРЖАВЫ (_char_office.sql): персонажи на должностях.
  begin
    pol := public._fm_council_mods(p_fid);
    gc   := gc   + coalesce((pol->>'gc')::numeric, 0);
    mine := mine + coalesce((pol->>'mine')::numeric, 0);
    bld  := bld  + coalesce((pol->>'build')::numeric, 0);
    rsch := rsch + coalesce((pol->>'research')::numeric, 0);
    col  := col  + coalesce((pol->>'colonize')::numeric, 0);
    cc   := cc   + coalesce((pol->>'claim_cost')::numeric, 0);
    cd   := cd   + coalesce((pol->>'claim_cd')::numeric, 0);
    scf  := scf  + coalesce((pol->>'sci_flat')::int, 0);
    agf  := agf  + coalesce((pol->>'agents_flat')::int, 0);
  exception when others then null;
  end;

  return jsonb_build_object(
    'gc',          greatest(0.3,  1+gc),
    'mine',        greatest(0.3,  1+mine),
    'build',       greatest(0.3,  1+bld),
    'research',    greatest(0.3,  1+rsch),
    'colonize',    greatest(0.3,  1+col),
    'claim_cost',  greatest(0.3,  1+cc),
    'claim_cd',    greatest(0.25, 1+cd),
    'sci_flat',    scf,
    'agents_flat', agf);
end$function$

;
CREATE OR REPLACE FUNCTION public._budget_upkeep(p_fid text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
declare b public.faction_budget; pop numeric;
begin
  b := public._budget_row(p_fid); pop := public._fac_pop(p_fid);
  return round(pop * public._budget_pop_mult(pop) *
    ( public._budget_lvl_w(b.industry)*0.12 + public._budget_lvl_w(b.military)*0.15
    + public._budget_lvl_w(b.science)*0.12
    + case when public._faction_is_robot(p_fid) then 0 else public._budget_lvl_w(b.social)*0.12 end
    + public._budget_lvl_w(b.infra)*0.09 ));
end$function$

;
CREATE OR REPLACE FUNCTION public.wellbeing_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare fid text; b public.faction_budget; ident numeric; fpen numeric; gpen numeric; base numeric;
  hub numeric := 0; hub_n int := 0; hub_lvl numeric := 1;   -- ДОМИК
begin
  fid := public._ec_my_fid();
  perform public._army_settle(fid);
  b := public._budget_row(fid);
  -- РЕВОРК 17.08: у машин соцблок не крутит благополучие (и не берёт апкип).
  base  := case when public._faction_is_robot(fid) then 1 else public._budget_gc_mult(b.social) end;
  ident := public._wb_identity(fid);
  fpen  := public._fleet_overcap_pen(fid);
  gpen  := public._garrison_pen(fid);
  begin
    hub := public._wb_hub_bonus(fid);
    hub_lvl := public._wb_hub_level(fid);
    select count(*) into hub_n from public.colony_buildings where faction_id = fid and btype = 'wellhub' and coalesce(slots_open,0) >= 1;
  exception when undefined_function then hub := 0; hub_n := 0; hub_lvl := 1; end;
  return jsonb_build_object(
    'base', base, 'ident', ident, 'fleet_pen', fpen, 'garrison_pen', gpen,
    'hub', hub, 'hub_n', hub_n, 'hub_level', hub_lvl, 'hub_cap', 0.20, 'hub_state_max', 5,   -- ДОМИК
    'wb', round(greatest(0.55, least(1.35, base + ident + hub - fpen - gpen)), 3),
    'fleet_used', public._fleet_used(fid), 'fleet_cap', public._fleet_capacity(fid),
    'garrisons', coalesce((
      select jsonb_agg(jsonb_build_object('colony_id', c.id, 'planet', c.planet_name,
        'units', public._garrison_units(c.id), 'free', public._garrison_free(c.id),
        'over', public._garrison_over_ratio(c.id)) order by c.planet_name)
      from public.colonies c where c.faction_id = fid and public._garrison_units(c.id) > 0), '[]'::jsonb));
end$function$

;
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
  -- РЕЦЕПТ ТОВАРОВ (07.08): фабрика ест выбранные ресурсы; премиальные входы
  -- поднимают потолок благополучия 1.10 → 1.25 (∝ обеспечению × разнообразию).
  gr_recipe jsonb; gr_ing jsonb; gr_name text;
  gr_qty numeric; gr_avail numeric; gr_ratio numeric;
  gr_q numeric := 1; gr_div numeric := 0; gr_bonus numeric := 0;
  -- ПРОСПЕРИТИ (06.08): множитель дохода домиков по благополучию системы.
  prosp jsonb := '{}'::jsonb;
  -- ВЕРА (06.08): храмы/десятина/секты наконец начисляются тиком.
  t_rate numeric := 0; t_paid numeric := 1; temple_gc numeric := 0; tithe_gc numeric := 0; sects_gc numeric := 0;
  bld_gc numeric := 0; tmpl_gc numeric := 0; faith_gc numeric := 0;
  -- РЕВОРК МАШИН 17.08: раса «Синтетики / Киборги» ИЛИ правление «Машинный разум».
  v_robot boolean := false;
begin
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then return jsonb_build_object('faction_id',p_fid,'days',0); end if;

  v_robot := public._faction_is_robot(p_fid);
  mods := public._faction_mods(p_fid);
  m_mine := (mods->>'mine')::numeric;
  m_gc   := (mods->>'gc')::numeric;
  if eco.debuff_until is not null and eco.debuff_until > now() then
    m_gc := m_gc * (1 - coalesce(eco.debuff_pct,0));
  end if;
  policy_cost := public._trade_policy_cost(coalesce(eco.trade_policy,0));

  -- БЮДЖЕТ: ползунки + благополучие + апкип (ВОЗВРАТ 03.08)
  bdg := public._budget_row(p_fid);
  -- МАШИНЫ: соцблок им безразличен — ни бонуса 1.15, ни провала 0.85.
  w_mult := case when v_robot then 1 else public._budget_gc_mult(bdg.social) end;
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
                 * public._budget_cap_mult(bdg.infra)
                 * case when v_robot then 1.5 else 1 end);   -- МАШИНЫ: дроны-логисты, склад +50%

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
    -- МАШИНЫ не потребляют ТНП: спроса нет, фабрика товаров им бесполезна,
    -- зато вода и сырьё не сгорают. Просперити зафиксировано на 1.00 (см. ниже).
    if v_robot then goods_demand := 0; end if;
    select coalesce(sum(slots_open),0) into gf_slots
      from public.colony_buildings where faction_id=p_fid and btype='goodsfab';
    begin gr_recipe := public._goods_recipe(p_fid);
    exception when undefined_function then gr_recipe := null; end;
    if gf_slots > 0 and goods_demand > 0 and gr_recipe is not null then
      -- РЕЦЕПТ: узкое место по ВСЕМ ингредиентам (qty на 1 товар), затем расход.
      gr_ratio := 1;
      for gr_ing in select value from jsonb_array_elements(gr_recipe->'ingredients') loop
        gr_name := gr_ing->>'res';
        gr_qty  := coalesce((gr_ing->>'qty')::numeric, 0);
        if gr_qty <= 0 then continue; end if;
        gr_avail := greatest(0, coalesce((eco.resources->>gr_name)::numeric,0)
                               + coalesce((res_add->>gr_name)::numeric,0)
                               - coalesce((res_sub->>gr_name)::numeric,0));
        gr_ratio := least(gr_ratio, gr_avail / (gr_qty * 10 * gf_slots * d));
      end loop;
      gf_ratio := greatest(0, least(1, gr_ratio));
      gf_made  := least(goods_demand, 10 * gf_slots * d * gf_ratio);
      if gf_made > 0 then
        for gr_ing in select value from jsonb_array_elements(gr_recipe->'ingredients') loop
          gr_name := gr_ing->>'res';
          gr_qty  := coalesce((gr_ing->>'qty')::numeric, 0);
          if gr_qty <= 0 then continue; end if;
          res_sub := jsonb_set(res_sub, array[gr_name],
                       to_jsonb(coalesce((res_sub->>gr_name)::numeric,0) + gr_qty * gf_made), true);
        end loop;
      end if;
      gr_q   := coalesce((gr_recipe->>'q_avg')::numeric, 1);
      gr_div := coalesce((gr_recipe->>'diversity')::numeric, 0);
    elsif gf_slots > 0 and goods_demand > 0 then
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
    -- КАЧЕСТВО: премиальный рецепт даёт бонус сверх 1.10 (потолок +0.15 → 1.25),
    -- пропорционально обеспечению и разнообразию входов. Легаси → бонуса нет.
    gr_bonus := case when gr_recipe is null then 0
                     else least(0.15, greatest(0, gr_q - 1)) * gr_div end;
    goods_welfare := round(least(1.10 + gr_bonus,
                       greatest(0.90, 0.90 + 0.20 * goods_cov + goods_cov * gr_bonus)), 3);
    if v_robot then goods_welfare := 1; goods_cov := 1; end if;   -- МАШИНЫ: ни просперити, ни голода

    -- ══ НАСЕЛЕНИЕ: рост = соцобеспечение + товары + памятник (ВОЗВРАТ 03.08) ══
    -- Потолок ячейки×100, пол ячейки×10, бэкфилл старых записей ячейки×50.
    -- Памятник Веры даёт колонии +0.5%/сут — работает и до модерации облика.
    update public.colonies c
       set pop = least(coalesce(c.cells,0)*100,
                   greatest(coalesce(c.cells,0)*10,
                     round(coalesce(c.pop, coalesce(c.cells,0)*50)
                           * power(1 + public._pop_growth(case when v_robot
                                             then bdg.industry else bdg.social end)
                                     + case when v_robot then 0 else 0.01 * least(1, goods_cov) end
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
$function$

;
CREATE OR REPLACE FUNCTION public.economy_produce__raw(p_unit_id uuid, p_qty integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  fid text; u public.faction_units; qty int;
  base_cost numeric; surcharge numeric := 0; total numeric;
  cat text; ln text; w int; rdy timestamptz;
  bill jsonb; res jsonb; spent jsonb := '{}'::jsonb; bought jsonb := '{}'::jsonb;
  rkey text; rneed numeric; rhave numeric; rcons numeric; rshort numeric;
  mr public.market_resources;
  v_cap int; v_have int;        -- ГЕЙТ ВМЕСТИМОСТИ ФЛОТА (слайс «Звёздная База»)
begin
  fid := public._ec_my_fid();
  qty := greatest(1, coalesce(p_qty, 1));
  select * into u from public.faction_units where id = p_unit_id;
  if not found then raise exception 'unit design not found'; end if;
  -- свои ИЛИ общедоступные (faction_id null); чужие фракционные — нельзя
  if u.faction_id is not null and u.faction_id is distinct from fid then raise exception 'not your design'; end if;

  -- ★ ФИКС: наземка и авиация теперь тоже строятся (Звёздный марш)
  -- ★ ПЕХОТА: класс 'peh' лежит в БД как category='ground' (единый армейский форж),
  --   но набирается в ЦЕНТРЕ ПОДГОТОВКИ — линия 'training', не Военный Завод.
  --   У роботов носитель пехоты = Военный Завод (см. _faction_is_robot), поэтому
  --   линия выбирается по расе/правлению.
  if    u.category = 'ship'     then cat:='ship';     ln:='shipyard';         w:=1;
  elsif u.category = 'aviation' then cat:='aviation'; ln:='airfield';         w:=1;
  elsif u.category = 'ground' and coalesce(u.data->>'class','') = 'peh' then
    cat:='ground';
    ln := case when public._faction_is_robot(fid) then 'military_factory' else 'training' end;
    w:=1;
  elsif u.category = 'ground'   then cat:='ground';   ln:='military_factory'; w:=1;
  elsif u.category = 'division' then cat:='division'; ln:='army';             w:=0;
  else raise exception 'this category is not produced here'; end if;

  -- ⚓ ГЕЙТ ВМЕСТИМОСТИ ФЛОТА: корабли нельзя строить сверх вместимости Звёздных Баз.
  if cat = 'ship' then
    v_cap  := public._fleet_capacity(fid);
    v_have := public._fleet_used(fid);
    if v_have + qty > v_cap then
      raise exception 'Превышена вместимость флота: занято %, мест всего % (≈% кораблей/слот). Постройте Звёздную Базу или откройте её слот, затем повторите. Запрошено ещё %.',
        v_have, v_cap, public._defense_const('starbase_cap_per_slot'), qty;
    end if;
  end if;

  base_cost := coalesce((u.summary->>'cost')::numeric, 0) * qty;
  -- РЕВОРК МАШИН 17.08: «пехота ×3» жила только в клиентском лимите панели —
  -- на сервере роботам не доставалось НИЧЕГО. Живая замена: наземку роботы
  -- штампуют на конвейере, -35% ГС. Ресурсная ведомость не меняется.
  if cat = 'ground' and public._faction_is_robot(fid) then
    base_cost := round(base_cost * 0.65);
  end if;
  bill := coalesce(u.summary->'bill', '{}'::jsonb);

  -- запираем строку экономики на время расчёта (анти-гонка двойной закладки)
  select coalesce(resources, '{}'::jsonb) into res
    from public.faction_economy where faction_id = fid for update;
  if res is null then raise exception 'no economy'; end if;

  -- по каждому ресурсу: тратим со склада сколько есть, дефицит ДОКУПАЕМ С РЫНКА ×1.5
  for rkey, rneed in select key, (value)::numeric * qty from jsonb_each_text(bill) loop
    if rneed is null or rneed <= 0 then continue; end if;
    rhave  := coalesce((res->>rkey)::numeric, 0);
    rcons  := least(rhave, rneed);
    rshort := rneed - rcons;
    if rcons > 0 then
      res   := jsonb_set(res,   array[rkey], to_jsonb(rhave - rcons), true);
      spent := jsonb_set(spent, array[rkey], to_jsonb(rcons), true);
    end if;
    if rshort > 0 then
      mr := public._market_ensure(rkey);   -- блокирует строку рынка (FOR UPDATE)
      if mr.stock < rshort then
        raise exception 'Не хватает «%» на рынке: нужно докупить % ед., в продаже % ед. Дождитесь обновления рынка или закупки у других держав.',
          rkey, floor(rshort), floor(mr.stock);
      end if;
      surcharge := surcharge + rshort * mr.price * 1.5;
      bought    := jsonb_set(bought, array[rkey], to_jsonb(rshort), true);
      update public.market_resources
         set stock = greatest(1, stock - rshort),
             price = public._market_price_calc(base_price, greatest(1, stock - rshort), equilibrium),
             updated_at = now()
       where name = rkey;
    end if;
  end loop;
  surcharge := ceil(surcharge);
  total := base_cost + surcharge;

  select coalesce(last_tick, now()) + interval '1 day' into rdy
    from public.faction_economy where faction_id = fid;
  if rdy is null then rdy := now() + interval '1 day'; end if;

  update public.faction_economy
     set gc = gc - total, resources = res
   where faction_id = fid and gc >= total;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.unit_production
    (faction_id, owner_id, unit_id, unit_name, category, line, weight, qty, status, ready_at, res_spent, res_surcharge, res_market)
  values
    (fid, auth.uid(), u.id, u.name, cat, ln, w, qty, 'queued', rdy, spent, surcharge, bought);

  return jsonb_build_object('ok', true, 'cost', total, 'gc_base', base_cost,
    'surcharge', surcharge, 'res_spent', spent, 'res_market', bought, 'qty', qty, 'ready_at', rdy);
end$function$

;