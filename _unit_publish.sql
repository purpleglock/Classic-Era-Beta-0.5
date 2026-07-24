-- ============================================================
-- ПУБЛИКАЦИЯ ЮНИТОВ ЧЕРЕЗ СЕРВЕР · HÄRDENING (закрытие форжа summary/data)
-- Применять в Supabase ПОСЛЕ _unit_catalog.sql (даёт public._cn_catalog()).
-- Идемпотентно.
--
-- Что делает: сервер сам пересчитывает cost/on/bill/ttx из присланного data
-- по каталогу (constructors.js → _cn_catalog), игнорируя клиентский summary.
-- Запись faction_units — только через economy_publish_unit (SECURITY DEFINER).
-- В САМОМ КОНЦЕ файла — REVOKE прямого INSERT/UPDATE (шаг отсечки): применять
-- ПОСЛЕ выката клиента, который шлёт publish через RPC (constructors.js).
-- ============================================================

-- ── fid одобренной анкеты автора БЕЗ исключения (null если нет) ──
create or replace function public._ec_my_fid_opt()
returns text language sql stable security definer set search_path=public as $$
  select faction_id from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1
$$;

-- ── Накопитель ведомости: bill[nm] += ceil(qty) ─────────────
create or replace function public._cn_bill_add(p_bill jsonb, p_name text, p_qty numeric)
returns jsonb language sql immutable as $$
  select case when ceil(coalesce(p_qty,0)) <= 0 then p_bill
    else jsonb_set(p_bill, array[p_name],
      to_jsonb(coalesce((p_bill->>p_name)::numeric,0) + ceil(p_qty)), true) end
$$;

-- ── Тип орудия по названию (зеркало cnWpnResKind) ───────────
create or replace function public._cn_wpn_kind(p_name text)
returns text language sql immutable as $$
  select case
    when lower(coalesce(p_name,'')) ~ 'пусков|ракет|шахт|перехватчик|торпед|бомб' then 'missile'
    when lower(coalesce(p_name,'')) ~ 'лазер|импульс|электромагн|ланцет|плазм|бластер' then 'energy'
    else 'ballistic' end
$$;

-- ── Требуемые тех-ключи из data (зеркало cnUnitReqTech) ─────
create or replace function public._cn_req_tech(p_cat text, p_data jsonb)
returns text[] language plpgsql immutable as $$
declare
  cab jsonb := public._cn_catalog();
  base_cls jsonb; base_wpn jsonb; keys text[] := '{}';
  k text; w jsonb; m jsonb; h jsonb;
begin
  if p_cat = 'division' then return '{}'; end if;
  base_cls := cab->'base'->'classes'->p_cat;
  base_wpn := cab->'base'->'weapons'->p_cat;
  k := p_data->>'class';
  if k is not null and not (base_cls ? k) then keys := array_append(keys, 'cls.'||p_cat||'.'||k); end if;
  if k is not null and coalesce((p_data->>'type')::int,0) >= 1 then keys := array_append(keys, 'type.'||p_cat||'.'||k); end if;
  for w in select * from jsonb_array_elements(coalesce(p_data->'weapons','[]'::jsonb)) loop
    if (w->>'g') is not null and not (base_wpn ? (w->>'g')) then keys := array_append(keys, 'wpn.'||p_cat||'.'||(w->>'g')); end if;
  end loop;
  for m in select * from jsonb_array_elements(coalesce(p_data->'modules','[]'::jsonb)) loop
    if (m->>'g') is not null then keys := array_append(keys, 'mod.'||p_cat||'.'||(m->>'g')); end if;
  end loop;
  if jsonb_array_length(coalesce(p_data->'hangars','[]'::jsonb)) > 0 then
    keys := array_append(keys, 'hangar.ship');
    for h in select * from jsonb_array_elements(p_data->'hangars') loop
      if (h->>'id')::int in (1,2) then keys := array_append(keys, 'hangar.ship.heavy'); end if;
    end loop;
  end if;
  return (select array_agg(distinct e) from unnest(keys) e);
end$$;

-- ── СИНТЕЗ (KV): прочность от физики брони (зеркало cnKvArmorHp) ──
create or replace function public._cn_kv_armor_hp(cls jsonb, a jsonb)
returns numeric language plpgsql immutable as $$
declare
  s numeric; bm numeric:=0.1; cm numeric:=0.2; rm numeric:=0.3; km numeric:=0.5; sv numeric:=1.0;
  dF numeric:=1; tF numeric:=1; hF numeric:=1; at numeric; hr numeric; tc numeric;
  cat text; nm text; hp numeric; res jsonb; mat jsonb;
begin
  if a is null then return 0; end if;
  nm := coalesce(a->>'name','');
  if nm like 'Нет%' then return 0; end if;
  s := coalesce((cls->>'mass')::numeric,0)/2000 + coalesce((cls->>'gabarit')::numeric,0)*2;
  mat := a->'material';
  if mat is not null and mat <> 'null'::jsonb then
    at := ((mat->'tensileStrength'->>'min')::numeric + (mat->'tensileStrength'->>'max')::numeric)/2;
    hr := (mat->>'heatResistance')::numeric;
    tc := (mat->>'thermalConductivity')::numeric;
    at := 500 + 3000*(1 - exp(-at/5000));
    hr := 500 + 2500*(1 - exp(-hr/2000));
    tc := 100 + 1900*(1 - exp(-tc/1000));
    dF := dF + (mat->>'density')::numeric*0.02;
    tF := tF + at/4000;
    hF := hF + hr/4000 + tc/50000;
  end if;
  cat := a->>'category';
  if    cat='heavyMetal' then bm:=bm*1.5; rm:=rm*1.3;
  elsif cat='lightMetal' then bm:=bm*0.7; km:=km*1.3; cm:=cm*1.1;
  elsif cat='ceramic'    then km:=km*1.4; rm:=rm*1.2; bm:=bm*0.8;
  elsif cat='composite'  then bm:=bm*1.1; cm:=cm*1.1; rm:=rm*1.1; km:=km*1.1; sv:=sv*1.1;
  end if;
  -- СПЛАВ (алхимия): объём брони масштабируется под корпус (mass/gabarit + resurs
  -- корпуса как прокси размера), рецепт даёт только материал/качество/стойкости.
  -- Зеркало ветки cnKvArmorHp (constructors.js) — число-в-число.
  if coalesce((a->>'_alloy')::boolean, false) then
    declare cr jsonb := cls->'resurs'; loadv numeric := 0; qv numeric; base numeric; hpa numeric;
    begin
      if cr is not null then
        loadv := coalesce((cr->>'blackmetall')::numeric,0)*bm + coalesce((cr->>'coloredmetall')::numeric,0)*cm
               + coalesce((cr->>'rudametall')::numeric,0)*rm + coalesce((cr->>'kristall')::numeric,0)*km
               + coalesce((cr->>'staarvis')::numeric,0)*sv;
      end if;
      base := (s + loadv) * dF * tF * hF;
      qv := coalesce((a->>'quality')::numeric, 1);
      hpa := base * (0.4 + 0.6*qv);
      if (a->>'hpPercentBoost') is not null then hpa := hpa * (1 + (a->>'hpPercentBoost')::numeric); end if;
      hpa := hpa + coalesce((a->>'hpBoost')::numeric,0) * 0.2;   -- ALLOY_FLOOR_K (пол для мелких корпусов)
      return hpa;
    end;
  end if;
  res := a->'resurs';
  if res is not null then
    s := s + coalesce((res->>'blackmetall')::numeric,0)*bm + coalesce((res->>'coloredmetall')::numeric,0)*cm
           + coalesce((res->>'rudametall')::numeric,0)*rm + coalesce((res->>'kristall')::numeric,0)*km
           + coalesce((res->>'staarvis')::numeric,0)*sv;
  end if;
  s := s * dF * tF * hF;
  hp := coalesce((a->>'hpBoost')::numeric,0) + s;
  if (a->>'hpPercentBoost') is not null then hp := hp * (1 + (a->>'hpPercentBoost')::numeric); end if;
  return hp;
end$$;

-- ── СИНТЕЗ (KV): скорость в «квадратах» (зеркало cnKvSpeed) ──
create or replace function public._cn_kv_speed(cls jsonb, k text, reactObj jsonb, engObj jsonb, speedcoef jsonb)
returns numeric language plpgsql immutable as $$
declare rf numeric; ef numeric; kmh numeric; sp numeric; co numeric;
begin
  rf := coalesce((reactObj->>'force')::numeric,1); if rf=0 then rf:=1; end if;
  ef := coalesce((engObj->>'force')::numeric,0);
  if ef<=0 then return 0; end if;
  kmh := ((ef*rf)/greatest(coalesce((cls->>'mass')::numeric,100),1))*10;
  co := coalesce((speedcoef->>k)::numeric,1); if co=0 then co:=1; end if;
  sp := round(kmh/co);
  if sp>100 then sp:=100; end if;
  return sp;
end$$;

-- ════════════════════════════════════════════════════════════
-- ЦЕНА ГС из конструкционных решений (зеркало cnKvCost в constructors.js)
-- НЕ из млн-прайсов Кваквантора: сумма решений × вес × множитель класса ×
-- общий понижающий коэффициент + плоская наценка по классу.
-- ════════════════════════════════════════════════════════════
create or replace function public._cn_kv_class_gs(k text)
returns numeric language sql immutable as $$
  select case k
    when 'btr' then 1.15 when 'tanki' then 1.35 when 'arta' then 1.3
    when 'dron' then 1.2 when 'aviacia' then 1.5 when 'vertihui' then 1.5
    when 'dronkos' then 1.7 when 'mla' then 1.8
    when 'corvette' then 1.8 when 'destroyer' then 2.2 when 'supportCarrier' then 2.2
    when 'mediumCruiser' then 2.6 when 'hyperCruiser' then 3 when 'multiroleCarrier' then 3
    when 'battleship' then 3.6 when 'dreadnought' then 4.2 when 'ss13' then 3
    else 1 end;
$$;
-- прибавить obj.resurs × q к аккумулятору решений
create or replace function public._cn_res_add(acc jsonb, obj jsonb, q numeric)
returns jsonb language sql immutable as $$
  select case when obj is null or (obj->'resurs') is null then acc
    else (
      select coalesce(jsonb_object_agg(kk, vv), acc)
      from (
        select kk,
          coalesce((acc->>kk)::numeric,0) + coalesce((obj->'resurs'->>kk)::numeric,0)*coalesce(q,1) as vv
        from unnest(array['blackmetall','coloredmetall','rudametall','kristall','staarvis']) kk
      ) t
    ) end;
$$;
-- res = {blackmetall,coloredmetall,rudametall,kristall,staarvis}
create or replace function public._cn_kv_cost(res jsonb, k text)
returns numeric language sql immutable as $$
  select round(
    ( coalesce((res->>'blackmetall')::numeric,0)*8
    + coalesce((res->>'rudametall')::numeric,0)*20
    + coalesce((res->>'coloredmetall')::numeric,0)*45
    + coalesce((res->>'kristall')::numeric,0)*90
    + coalesce((res->>'staarvis')::numeric,0)*150
    ) * public._cn_kv_class_gs(k) * 0.32          -- CN_KV_COST_FACTOR
    + public._cn_kv_class_gs(k) * 90              -- плоская наценка (idx=0)
  );
$$;

-- ════════════════════════════════════════════════════════════
-- ПЕРЕСЧЁТ summary из data по каталогу (зеркало cnVehCalc / cnDivTotals)
-- ════════════════════════════════════════════════════════════
create or replace function public._cn_recompute(p_cat text, p_data jsonb)
returns jsonb language plpgsql stable as $$
declare
  cab jsonb := public._cn_catalog();
  db jsonb; defs jsonb; bd jsonb;
  k text; cls jsonb; typeObj jsonb; reactObj jsonb; armorObj jsonb; shieldObj jsonb; engObj jsonb;
  radarObj jsonb; radar_ numeric := 0;
  v_alloy public.faction_armor_alloys;   -- кастомный сплав брони (алхимия), если выбран
  armor_resist jsonb := jsonb_build_object('kinetic',0,'energy',0,'missile',0);
  a_rid text;
  hasType bool; hasReactor bool; hasEnergy bool; hasHangars bool;
  cost numeric := 0; econs numeric := 0; emax numeric := 0; on_ numeric; modon numeric;
  dmg numeric := 0; hp numeric; armor numeric; shield numeric; speed numeric; cargo numeric := 0;
  rng numeric := 0;   -- дальность огня в «квадратах» = max dalnost орудий (KV customParameter)
  crew numeric := 0; speedcoef jsonb;
  bill jsonb := '{}'::jsonb;
  kvres jsonb := '{}'::jsonb;   -- конструкционные решения (для цены ГС)
  w jsonb; m jsonb; h jsonb; hob jsonb; wob jsonb; mob jsonb; rec jsonb;
  q int; used int; kind text; wdmg numeric;
  -- division
  blk jsonb; mid text; cnt int; size numeric := 0; model jsonb; mbill jsonb; uid uuid; urow public.faction_units;
  rk text; rv numeric;
  m_armor numeric; m_atk numeric; m_dal numeric;
  -- боевые эффекты модулей (ПРО/РЭБ/маскировка/сенсор/ангары) → summary.mods
  mod_pd numeric := 0; mod_jam int := 0; mod_stealth int := 0; mod_sensor int := 0; mod_hangar numeric := 0;
  mod_dejam int := 0; mod_interdict bool := false; mod_stabil bool := false;
  radar_eccm int := 0;   -- помехозащищённость выбранного радара
  d_count numeric := 0; sa numeric := 0; st numeric := 0; sd numeric := 0;
  ma numeric := 0; mt numeric := 0; md numeric := 0; pct numeric;
begin
  if p_cat = 'division' then
    for blk in select * from jsonb_array_elements(coalesce(p_data->'blocks','[]'::jsonb)) loop
      mid := blk->>'modelId'; cnt := greatest(0, coalesce((blk->>'count')::int,0));
      if mid is null or cnt <= 0 then continue; end if;
      if left(mid,5) = 'tech:' then
        begin uid := substring(mid from 6)::uuid; exception when others then raise exception 'bad tech id'; end;
        select * into urow from public.faction_units where id = uid;
        if not found then raise exception 'tech design not found'; end if;
        -- доступность: своя / общедоступная / своей фракции
        if not (urow.owner_id = auth.uid() or urow.faction_id is null
                or urow.faction_id = public._ec_my_fid_opt()) then raise exception 'tech design not accessible'; end if;
        cost := cost + coalesce((urow.summary->>'cost')::numeric,0) * cnt;
        size := size + coalesce((cab->'techSize'->>urow.category)::numeric,200) * cnt;
        mbill := coalesce(urow.summary->'bill','{}'::jsonb);
        m_armor := coalesce((urow.summary->>'armor')::numeric,0) + coalesce((urow.summary->>'hp')::numeric,0);
        m_atk := coalesce((urow.summary->>'dmg')::numeric,0);
        m_dal := coalesce((urow.summary->>'dalnost')::numeric,0);
      else
        select e into model from jsonb_array_elements(cab->'divData') e where e->>'id' = mid limit 1;
        if model is null then raise exception 'division model not found: %', mid; end if;
        cost := cost + coalesce((model->>'cost')::numeric,0) * cnt;
        size := size + coalesce((model->>'size')::numeric,0) * cnt;
        mbill := coalesce(model->'bill','{}'::jsonb);
        m_armor := coalesce((model->>'armorhp')::numeric,0);
        m_atk := coalesce((model->>'atack')::numeric,0);
        m_dal := coalesce((model->>'dalnost')::numeric,0);
      end if;
      for rk, rv in select key, (value)::numeric from jsonb_each_text(mbill) loop
        bill := public._cn_bill_add(bill, rk, rv * cnt);
      end loop;
      d_count := d_count + cnt; sa := sa + m_armor*cnt; st := st + m_atk*cnt; sd := sd + m_dal*cnt;
      if m_armor > ma then ma := m_armor; end if;
      if m_atk > mt then mt := m_atk; end if;
      if m_dal > md then md := m_dal; end if;
    end loop;
    if size > (cab->>'divCap')::numeric then raise exception 'division exceeds size cap'; end if;
    pct := round(size / (cab->>'divCap')::numeric * 100, 1);
    return jsonb_build_object('cost', cost, 'size', size, 'bill', bill, 'percent', pct, 'count', d_count,
      'midArmor', case when d_count>0 then round(sa/d_count,1) else 0 end, 'maxArmor', ma,
      'midAtk',   case when d_count>0 then round(st/d_count,1) else 0 end, 'maxAtk', mt,
      'midRange', case when d_count>0 then round(sd/d_count,1) else 0 end, 'maxRange', md);
  end if;

  -- ── ТЕХНИКА (ship / ground / aviation) ──
  db := cab->p_cat; defs := cab->'defs'->p_cat; bd := cab->'billDiv'->p_cat;
  if db is null or defs is null then raise exception 'bad category'; end if;
  hasType := (defs->>'hasType')::bool; hasReactor := (defs->>'hasReactor')::bool;
  hasEnergy := (defs->>'hasEnergy')::bool; hasHangars := (defs->>'hasHangars')::bool;
  k := p_data->>'class'; cls := db->'data'->k;
  if cls is null then raise exception 'bad class'; end if;
  modon := (cls->>'modON')::numeric; on_ := (cls->>'baseON')::numeric;

  if hasType then typeObj := cls->'types'->coalesce((p_data->>'type')::int,0); if typeObj is null then raise exception 'bad type'; end if; end if;
  if hasReactor then reactObj := db->'reactors'->k->coalesce((p_data->>'reactor')::int,0); if reactObj is null then raise exception 'bad reactor'; end if; end if;
  -- Броня: кастомный сплав (алхимия) по стабильному id ИЛИ индекс каталога.
  -- Сплав пересчитан авторитетно при регистрации (armor_alloy_upsert) — берём его
  -- material/hpBoost/стойкости, клиентским цифрам не доверяем. resurs=0 (в цену ГС не идёт;
  -- расход постройки берём из РЕЦЕПТА ниже, в ведомости).
  if nullif(p_data->>'armorAlloyId','') is not null then
    select * into v_alloy from public.faction_armor_alloys where id = (p_data->>'armorAlloyId')::uuid;
    if v_alloy.id is null then raise exception 'bad alloy'; end if;
    armorObj := jsonb_build_object(
      'material',       v_alloy.stats->'material',
      'category',       v_alloy.stats->>'category',
      'hpBoost',        coalesce(v_alloy.stats->'hpBoost', to_jsonb(0)),
      'hpPercentBoost', coalesce(v_alloy.stats->'hpPercentBoost', to_jsonb(0)),
      'capacityBoost',  coalesce(v_alloy.stats->'capacityBoost', to_jsonb(0)),
      'armor',          coalesce(v_alloy.stats->'hpBoost', to_jsonb(0)),
      'quality',        coalesce(v_alloy.stats->'quality', to_jsonb(1)),   -- масштаб HP под корпус
      '_alloy',         true,                                             -- ветка проп. корпусу в _cn_kv_armor_hp
      'resurs', jsonb_build_object('blackmetall',0,'coloredmetall',0,'rudametall',0,'kristall',0,'staarvis',0)
    );
    armor_resist := coalesce(v_alloy.stats->'resist', armor_resist);
  else
    armorObj := db->'armors'->k->coalesce((p_data->>'armor')::int,0);
    if armorObj is null then raise exception 'bad armor'; end if;
  end if;
  shieldObj := db->'shields'->k->coalesce((p_data->>'shield')::int,0); if shieldObj is null then raise exception 'bad shield'; end if;
  engObj    := db->'engines'->k->coalesce((p_data->>'engine')::int,0); if engObj    is null then raise exception 'bad engine'; end if;
  -- Радар (KV.modules5): idx 0 = «Не выбран» — в расчёт не идёт (зеркало cnVehCalc)
  if coalesce((p_data->>'radar')::int,0) > 0 then
    radarObj := db->'radars'->k->((p_data->>'radar')::int);
    if radarObj is null then raise exception 'bad radar'; end if;
  end if;

  -- ЦЕНА: собираем конструкционные решения (resurs) с корпуса и компонентов,
  -- итог считаем через _cn_kv_cost. Млн-прайсы Кваквантора в цену НЕ идут.
  kvres := public._cn_res_add(kvres, cls, 1);
  kvres := public._cn_res_add(kvres, reactObj, 1);
  kvres := public._cn_res_add(kvres, engObj, 1);
  kvres := public._cn_res_add(kvres, armorObj, 1);
  kvres := public._cn_res_add(kvres, shieldObj, 1);
  kvres := public._cn_res_add(kvres, radarObj, 1);
  if hasEnergy then econs := coalesce((shieldObj->>'energy')::numeric,0) + coalesce((engObj->>'energy')::numeric,0); end if;

  -- оружие
  for w in select * from jsonb_array_elements(coalesce(p_data->'weapons','[]'::jsonb)) loop
    q := greatest(0, coalesce((w->>'q')::int,1));
    wob := db->'weapons'->(w->>'g')->coalesce((w->>'idx')::int,-1);
    if wob is null then raise exception 'bad weapon'; end if;
    kvres := public._cn_res_add(kvres, wob, q); on_ := on_ + q * modon;
    wdmg := (wob->>'dmg')::numeric; dmg := dmg + wdmg * q;
    rng := greatest(rng, coalesce((wob->>'dalnost')::numeric, 0));
    if hasEnergy then econs := econs + coalesce((wob->>'energy')::numeric,0) * q; end if;
    kind := public._cn_wpn_kind(wob->>'name');
    if kind = 'missile' then bill := public._cn_bill_add(bill,'Изотопы', wdmg/150*q);
    elsif kind = 'energy' then bill := public._cn_bill_add(bill,'Редкоземельные руды', wdmg/180*q);
                              bill := public._cn_bill_add(bill,'Гелий-3', wdmg/400*q);
    else bill := public._cn_bill_add(bill,'Железо', wdmg/120*q); end if;
  end loop;

  -- модули: сырьё из конструкционных решений (resurs, зеркало cnUnitBill) +
  -- агрегат боевых эффектов combat → summary.mods (читает боёвка, _bt_stats)
  for m in select * from jsonb_array_elements(coalesce(p_data->'modules','[]'::jsonb)) loop
    mob := db->'modules'->(m->>'g')->coalesce((m->>'idx')::int,-1);
    if mob is null then raise exception 'bad module'; end if;
    kvres := public._cn_res_add(kvres, mob, 1); on_ := on_ + modon;
    if hasEnergy then econs := econs + coalesce((mob->>'energy')::numeric,0); end if;
    bill := public._cn_bill_add(bill,'Железо',              coalesce((mob->'resurs'->>'blackmetall')::numeric,0)/20);
    bill := public._cn_bill_add(bill,'Медь',                coalesce((mob->'resurs'->>'coloredmetall')::numeric,0)/20);
    bill := public._cn_bill_add(bill,'Титан',               coalesce((mob->'resurs'->>'rudametall')::numeric,0)/20);
    bill := public._cn_bill_add(bill,'Редкоземельные руды', coalesce((mob->'resurs'->>'kristall')::numeric,0)/20);
    bill := public._cn_bill_add(bill,'Стелларит',           coalesce((mob->'resurs'->>'staarvis')::numeric,0)/20);
    mod_pd      := mod_pd      + coalesce((mob->'combat'->>'pd')::numeric,0);
    mod_jam     := greatest(mod_jam, coalesce((mob->'combat'->>'jam')::int,0));
    mod_stealth := mod_stealth + coalesce((mob->'combat'->>'stealth')::int,0);
    mod_sensor  := mod_sensor  + coalesce((mob->'combat'->>'sensor')::int,0);
    mod_hangar  := mod_hangar  + coalesce((mob->'combat'->>'hangar')::numeric,0);
    mod_dejam   := greatest(mod_dejam, coalesce((mob->'combat'->>'dejam')::int,0));
    mod_interdict := mod_interdict or coalesce((mob->'combat'->>'interdict')::int,0) > 0;
    mod_stabil    := mod_stabil    or coalesce((mob->'combat'->>'stabil')::int,0) > 0;
  end loop;

  -- ангары (только корабли)
  if hasHangars then
    for h in select * from jsonb_array_elements(coalesce(p_data->'hangars','[]'::jsonb)) loop
      select e into hob from jsonb_array_elements(db->'hangarTypes') e where (e->>'id')::int = (h->>'id')::int limit 1;
      if hob is null then raise exception 'bad hangar'; end if;
      kvres := public._cn_res_add(kvres, hob, 1); on_ := on_ + modon; econs := econs + coalesce((hob->>'energy')::numeric,0);
      if (hob->>'canHaveUnits')::bool = false then cargo := cargo + coalesce((hob->>'capacity')::numeric,0); end if;
      used := 0;
      for rec in select * from jsonb_array_elements(coalesce(h->'units','[]'::jsonb)) loop
        used := used + coalesce((db->'airUnits'->((rec#>>'{}')::int)->>'points')::int, 0);
      end loop;
      if used > (hob->>'capacity')::int then raise exception 'hangar overload'; end if;
      bill := public._cn_bill_add(bill,'Титан', coalesce((hob->>'capacity')::numeric,0)/12);
    end loop;
  end if;

  -- ТТХ — СИНТЕЗ (KV): прочность от физики брони, скорость в «квадратах», экипаж-сумма.
  -- armor свёрнут в HP (как в клиенте). cost/on/ведомость — прежние (экономика не трогается).
  speedcoef := cab->'speedcoef';
  hp := round(public._cn_kv_armor_hp(cls, armorObj));
  armor := 0;
  shield := coalesce((shieldObj->>'shield')::numeric,0);
  speed := public._cn_kv_speed(cls, k, reactObj, engObj, speedcoef);
  emax := coalesce((reactObj->>'energy')::numeric,0);
  crew := coalesce((cls->>'crewRequired')::numeric,0);
  if radarObj is not null then
    crew := crew + coalesce((radarObj->>'crewRequired')::numeric,0);
    radar_ := coalesce((radarObj->'customParameterradar'->>'dalnost')::numeric,0);
    -- активные станции раскачиваются реактором: +1 кв за pwrPer E, кап pwrCap (зеркало cnVehCalc)
    if coalesce((radarObj->'customParameterradar'->>'pwrPer')::numeric,0) > 0 then
      radar_ := radar_ + least(coalesce((radarObj->'customParameterradar'->>'pwrCap')::numeric,0),
                               floor(coalesce((reactObj->>'energy')::numeric,0)
                                     / (radarObj->'customParameterradar'->>'pwrPer')::numeric));
    end if;
    radar_eccm := coalesce((radarObj->'customParameterradar'->>'eccm')::int,0);
  end if;
  for w in select * from jsonb_array_elements(coalesce(p_data->'weapons','[]'::jsonb)) loop
    wob := db->'weapons'->(w->>'g')->coalesce((w->>'idx')::int,-1);
    if wob is not null then crew := crew + coalesce((wob->>'crewRequired')::numeric,0) * greatest(0,coalesce((w->>'q')::int,1)); end if;
  end loop;
  for m in select * from jsonb_array_elements(coalesce(p_data->'modules','[]'::jsonb)) loop
    mob := db->'modules'->(m->>'g')->coalesce((m->>'idx')::int,-1);
    if mob is not null then crew := crew + coalesce((mob->>'crewRequired')::numeric,0); end if;
  end loop;
  if hasEnergy and econs > emax then raise exception 'energy overload'; end if;

  -- ведомость: корпус + компоненты (зеркало cnUnitBill)
  for rk, rv in select key, (value)::numeric from jsonb_each_text(coalesce(cab->'hullBill'->p_cat->k,'{}'::jsonb)) loop
    bill := public._cn_bill_add(bill, rk, rv);
  end loop;
  if v_alloy.id is not null then
    -- Кастомный сплав: постройка потребляет ИМЕННО рецепт (реальные ресурсы).
    for a_rid in select key from jsonb_each(coalesce(v_alloy.recipe,'{}'::jsonb)) loop
      bill := public._cn_bill_add(bill, public._aa_name(a_rid), (v_alloy.recipe->>a_rid)::numeric);
    end loop;
  else
    bill := public._cn_bill_add(bill,'Железо', (armorObj->>'armor')::numeric / (bd->>'armorFe')::numeric);
    bill := public._cn_bill_add(bill,'Титан',  (armorObj->>'armor')::numeric / (bd->>'armorTi')::numeric);
  end if;
  if shield > 0 then
    bill := public._cn_bill_add(bill,'Редкоземельные руды', shield / (bd->>'shRare')::numeric);
    bill := public._cn_bill_add(bill,'Дейтерий', shield / (bd->>'shDeu')::numeric);
  end if;
  if bd ? 'engFuel' then
    bill := public._cn_bill_add(bill,'Метан', coalesce((engObj->>'energy')::numeric,0) / (bd->>'engFuel')::numeric);
    bill := public._cn_bill_add(bill,'Дейтерий', coalesce((engObj->>'energy')::numeric,0) / (bd->>'engDeu')::numeric);
  else
    bill := public._cn_bill_add(bill,'Железо', 1);
  end if;
  if reactObj is not null and (bd ? 'reIso') then
    bill := public._cn_bill_add(bill,'Изотопы', coalesce((reactObj->>'energy')::numeric,0) / (bd->>'reIso')::numeric);
    bill := public._cn_bill_add(bill,'Гелий-3', coalesce((reactObj->>'energy')::numeric,0) / (bd->>'reHe')::numeric);
  end if;

  -- Итоговая цена ГС из конструкционных решений (зеркало cnKvCost).
  cost := public._cn_kv_cost(kvres, k);

  return jsonb_build_object(
    'cost', cost, 'on', round(on_,1), 'hp', hp, 'armor', armor, 'shield', shield,
    'dmg', dmg, 'speed', speed, 'crew', crew, 'radar', radar_, 'rng', rng, 'speedUnit', 'квадрат',
    'eCons', econs, 'eMax', emax, 'energy', hasEnergy,
    'cargo', cargo, 'bill', bill,
    'armor_resist', armor_resist,   -- стойкости брони к типам урона (для боёвки)
    -- боевые эффекты модулей: ПРО (кап 0.6), РЭБ (радиус 5), маскировка, сенсор, авиакрылья
    'mods', jsonb_build_object(
      'pd', least(0.6, mod_pd), 'jam', mod_jam, 'stealth', mod_stealth,
      'sensor', mod_sensor, 'hangar', mod_hangar,
      'dejam', mod_dejam, 'interdict', mod_interdict, 'stabil', mod_stabil,
      'eccm', radar_eccm),
    'className', cls->>'name', 'typeName', coalesce(typeObj->>'name',''));
end$$;

-- ════════════════════════════════════════════════════════════
-- RPC ПУБЛИКАЦИИ: единственный путь записи faction_units
-- ════════════════════════════════════════════════════════════
create or replace function public.economy_publish_unit(
  p_category text, p_name text, p_data jsonb, p_card_text text,
  p_faction_id text default null, p_faction_name text default null,
  p_faction_color text default null, p_unit_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_role text; my_fid text; is_staff bool; v_sum jsonb; on_cost numeric := 0;
  req text[]; missing text[]; v_research jsonb; u_row public.faction_units;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_category not in ('ship','ground','aviation','division') then raise exception 'bad category'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'name required'; end if;

  v_role := public.current_user_role();
  is_staff := v_role in ('superadmin','editor');
  my_fid := public._ec_my_fid_opt();   -- fid одобренной анкеты автора (или null)

  -- право публиковать: стафф ИЛИ владелец одобренной анкеты
  if not is_staff and my_fid is null then raise exception 'no approved faction'; end if;
  -- если задан faction_id — только свой (или стафф выдаёт от любого/общий)
  if p_faction_id is not null and not is_staff and p_faction_id is distinct from my_fid then
    raise exception 'not your faction';
  end if;

  -- авторитетный пересчёт из data (cost/on/bill/ttx — игнорируем клиентский summary)
  v_sum := public._cn_recompute(p_category, p_data);

  -- гейтинг по исследованиям (стафф без фракции — без гейта)
  if not (is_staff and my_fid is null) then
    req := public._cn_req_tech(p_category, p_data);
    if req is not null and array_length(req,1) > 0 then
      select coalesce(e.research,'[]'::jsonb) into v_research from public.faction_economy e
        where e.faction_id = coalesce(p_faction_id, my_fid);
      select array_agg(x) into missing from unnest(req) x where not (coalesce(v_research,'[]'::jsonb) ? x);
      if missing is not null and array_length(missing,1) > 0 then
        raise exception 'research locked: %', array_to_string(missing, ', ');
      end if;
    end if;
  end if;

  if p_unit_id is not null then
    -- редактирование: автор или стафф; ОН не списываем
    select * into u_row from public.faction_units where id = p_unit_id;
    if not found then raise exception 'unit not found'; end if;
    if not (u_row.owner_id = auth.uid() or is_staff) then raise exception 'not your unit'; end if;
    -- Класс корпуса / категорию менять нельзя, пока существуют построенные юниты этого
    -- дизайна (в составе или во флотах): иначе корабли, купленные по цене старого класса,
    -- задним числом превращаются в другой класс (эксплойт + каша в списках состава).
    if ((u_row.data->>'class') is distinct from (p_data->>'class')
        or u_row.category is distinct from p_category)
       and (exists(select 1 from public.unit_production where unit_id = p_unit_id)
            or exists(select 1 from public.fleets
                      where composition::text like '%' || p_unit_id::text || '%')) then
      raise exception 'нельзя менять класс/категорию дизайна, пока существуют построенные по нему юниты — спишите их или создайте новый дизайн';
    end if;
    update public.faction_units set
      category = p_category, name = p_name,
      faction_id = p_faction_id, faction_name = p_faction_name, faction_color = p_faction_color,
      summary = v_sum, data = p_data, card_text = p_card_text, updated_at = now()
    where id = p_unit_id returning * into u_row;
    -- Переименование дизайна догоняет уже построенные юниты: unit_name в составе
    -- и в снимках composition флотов, иначе группировка по unit_id показывает старое имя.
    update public.unit_production set unit_name = p_name where unit_id = p_unit_id;
    update public.fleets f
       set composition = (select jsonb_agg(
             case when e->>'unit_id' = p_unit_id::text
                  then jsonb_set(e, '{unit_name}', to_jsonb(p_name)) else e end)
           from jsonb_array_elements(f.composition) e)
     where f.composition::text like '%' || p_unit_id::text || '%';
    return to_jsonb(u_row);
  end if;

  -- новый дизайн: списываем ОН (наука) фракции для техники не-стаффом
  if p_category <> 'division' and coalesce(p_faction_id, my_fid) is not null and not is_staff then
    on_cost := coalesce((v_sum->>'on')::numeric, 0);
  end if;
  if on_cost > 0 then
    update public.faction_economy set science = science - on_cost
      where faction_id = coalesce(p_faction_id, my_fid) and science >= on_cost;
    if not found then raise exception 'not enough science: need %', on_cost; end if;
  end if;

  insert into public.faction_units
    (category, name, faction_id, faction_name, faction_color, owner_id, owner_email, summary, data, card_text)
  values
    (p_category, p_name, p_faction_id, p_faction_name, p_faction_color, auth.uid(),
     (select email from auth.users where id = auth.uid()), v_sum, p_data, p_card_text)
  returning * into u_row;
  return to_jsonb(u_row) || jsonb_build_object('_on_charged', on_cost);
end$$;
revoke all on function public.economy_publish_unit(text,text,jsonb,text,text,text,text,uuid) from public;
grant execute on function public.economy_publish_unit(text,text,jsonb,text,text,text,text,uuid) to authenticated;

-- ════════════════════════════════════════════════════════════
-- ШАГ ОТСЕЧКИ (применять ПОСЛЕ выката клиента на RPC!):
-- запретить прямую запись faction_units; чтение и удаление — оставляем (RLS).
-- Раскомментируй и выполни, когда publish через RPC проверен в игре.
-- ════════════════════════════════════════════════════════════
-- revoke insert, update on public.faction_units from anon, authenticated;
-- drop policy if exists "fu_insert" on public.faction_units;
-- drop policy if exists "fu_update" on public.faction_units;
