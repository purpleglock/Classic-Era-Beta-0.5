-- ════════════════════════════════════════════════════════════
-- ОРУЖЕЙНАЯ ВЕРФЬ → КОНСТРУКТОРЫ: кастомные орудия в дизайне юнита
-- ────────────────────────────────────────────────────────────
-- Запись оружия в p_data->'weapons' теперь бывает двух видов:
--   { g, idx, q }        — орудие каталога Кваквантора (как раньше)
--   { turretId, q }      — своё орудие из оружейной верфи (faction_turrets)
-- Резолв обоих видов вынесен в _cn_wpn_obj: он же проверяет доступ к чужому
-- орудию и то, что класс носителя вообще тянет эту сборку (turrets.carriers).
-- ТТХ турели берутся ИЗ СТРОКИ faction_turrets, посчитанной сервером при
-- регистрации, — клиентским цифрам по-прежнему не доверяем.
--
-- Порядок применения: ПОСЛЕ _turret_forge.sql (нужна таблица faction_turrets).
-- Базовая версия _cn_recompute — из _unit_publish.sql, изменены только резолв
-- орудия и тип боеприпаса (_kind вместо разбора названия).
-- ════════════════════════════════════════════════════════════

-- ── §1. Единый резолв орудия дизайна ─────────────────────────
create or replace function public._cn_wpn_obj(p_db jsonb, p_class text, w jsonb)
returns jsonb language plpgsql stable as $fn$
declare tur public.faction_turrets; o jsonb;
begin
  if nullif(w->>'turretId','') is not null then
    select * into tur from public.faction_turrets where id = (w->>'turretId')::uuid;
    if not found then raise exception 'custom turret not found'; end if;
    -- доступность: своё / общедоступное / своей фракции (как у tech-дизайнов)
    if not (tur.owner_id = auth.uid() or tur.faction_id is null
            or tur.faction_id = public._ec_my_fid_opt()) then
      raise exception 'custom turret not accessible';
    end if;
    if not (tur.carriers @> array[p_class]) then
      raise exception 'орудие «%» не встаёт на носитель этого класса', tur.name;
    end if;
    -- Форма — как у орудия каталога (_cn_catalog): dmg/energy/dalnost/resurs.
    return jsonb_build_object(
      'name',         '⚙ ' || tur.name,
      'dmg',          coalesce(tur.stats->'damage',  to_jsonb(0)),
      'energy',       coalesce(tur.stats->'energy',  to_jsonb(0)),
      'dalnost',      coalesce(tur.stats->'dalnost', to_jsonb(0)),
      'crewRequired', 0,
      'resurs',       coalesce(tur.stats->'resurs', '{}'::jsonb),
      '_kind',        coalesce(tur.stats->>'kind','kinetic'),
      '_turret',      true);
  end if;
  o := p_db->'weapons'->(w->>'g')->coalesce((w->>'idx')::int,-1);
  if o is null then raise exception 'bad weapon'; end if;
  return o || jsonb_build_object('_kind', public._cn_wpn_kind(o->>'name'));
end$fn$;
grant execute on function public._cn_wpn_obj(jsonb,text,jsonb) to authenticated;

-- ── §2. _cn_recompute с поддержкой turretId ──────────────────
create or replace function public._cn_recompute(p_cat text, p_data jsonb)
returns jsonb language plpgsql stable as $$
declare
  cab jsonb := public._cn_catalog();
  db jsonb; defs jsonb; bd jsonb;
  k text; cls jsonb; typeObj jsonb; reactObj jsonb; armorObj jsonb; shieldObj jsonb; engObj jsonb;
  radarObj jsonb; radar_ numeric := 0;
  v_alloy public.faction_armor_alloys;   -- кастомный сплав брони (алхимия), если выбран
  -- база: штатная броня даёт лёгкую равномерную стойкость (+10% ко всем типам),
  -- чтобы «Броня цели» не читалась как ноль. Кастомный сплав (алхимия) её замещает
  -- своими типовыми стойкостями (создавая шов/уязвимость для контр-игры).
  armor_resist jsonb := jsonb_build_object('kinetic',0.1,'energy',0.1,'missile',0.1);
  a_rid text;
  v_aref jsonb;      -- эталон класса для сплава: {hp, resurs} (лучшая стоковая броня)
  v_amult numeric;   -- сила рецепта сплава относительно эталона
  v_abill numeric;   -- масштаб ведомости рецепта под класс
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
  mod_dejam int := 0; mod_interdict bool := false; mod_stabil bool := false; mod_ftl bool := false;
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
  -- material/hpBoost/стойкости, клиентским цифрам не доверяем. HP = эталон класса ×
  -- сила рецепта; resurs = сырьё эталона × та же сила (ГС-цена), а расход постройки —
  -- САМ РЕЦЕПТ ниже, масштабированный классом (v_abill).
  if nullif(p_data->>'armorAlloyId','') is not null then
    select * into v_alloy from public.faction_armor_alloys where id = (p_data->>'armorAlloyId')::uuid;
    if v_alloy.id is null then raise exception 'bad alloy'; end if;
    v_aref := public._cn_alloy_ref(cls, db->'armors'->k);
    armorObj := jsonb_build_object(
      'material',       v_alloy.stats->'material',
      'category',       v_alloy.stats->>'category',
      'hpBoost',        coalesce(v_alloy.stats->'hpBoost', to_jsonb(0)),
      'hpPercentBoost', coalesce(v_alloy.stats->'hpPercentBoost', to_jsonb(0)),
      'capacityBoost',  coalesce(v_alloy.stats->'capacityBoost', to_jsonb(0)),
      'armor',          coalesce(v_alloy.stats->'hpBoost', to_jsonb(0)),
      'quality',        coalesce(v_alloy.stats->'quality', to_jsonb(1)),   -- качество рецепта
      '_alloy',         true,                                             -- ветка «эталон класса» в _cn_kv_armor_hp
      '_refHp',         v_aref->'hp'                                      -- база: лучшая стоковая броня класса
    );
    v_amult := public._cn_alloy_mult(armorObj);
    -- Сплав НЕ бесплатный: конструкц. resurs = сырьё эталонной брони × сила рецепта
    -- (идёт в ГС-цену), а ведомость постройки = САМ РЕЦЕПТ, масштабированный классом.
    armorObj := armorObj || jsonb_build_object(
      'armor', round((v_aref->>'hp')::numeric * v_amult),
      'resurs', jsonb_build_object(
        'blackmetall',   round(coalesce((v_aref->'resurs'->>'blackmetall')::numeric,0)   * v_amult),
        'coloredmetall', round(coalesce((v_aref->'resurs'->>'coloredmetall')::numeric,0) * v_amult),
        'rudametall',    round(coalesce((v_aref->'resurs'->>'rudametall')::numeric,0)    * v_amult),
        'kristall',      round(coalesce((v_aref->'resurs'->>'kristall')::numeric,0)      * v_amult),
        'staarvis',      round(coalesce((v_aref->'resurs'->>'staarvis')::numeric,0)      * v_amult)));
    -- CN_ALLOY_BILL_REF = 12800 (HP-якорь «полной» ведомости, ≈ царь-цитадель)
    v_abill := greatest(0.02, least(1, (v_aref->>'hp')::numeric / 12800)) * v_amult;
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
    wob := public._cn_wpn_obj(db, k, w);
    kvres := public._cn_res_add(kvres, wob, q); on_ := on_ + q * modon;
    wdmg := (wob->>'dmg')::numeric; dmg := dmg + wdmg * q;
    rng := greatest(rng, coalesce((wob->>'dalnost')::numeric, 0));
    if hasEnergy then econs := econs + coalesce((wob->>'energy')::numeric,0) * q; end if;
    kind := wob->>'_kind';
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
    mod_ftl       := mod_ftl       or coalesce((mob->'combat'->>'ftl')::int,0) > 0;
  end loop;

  -- ЗАСЛОН: модули интердикции / стабилизатора — только линкор и дредноут
  -- (зеркало modules_ids: раньше их ставили на что угодно и заваливали ими бои)
  if (mod_interdict or mod_stabil) and k not in ('battleship','dreadnought','ss13') then
    raise exception 'модули интердикции и стабилизатора доступны только линкорам, дредноутам и станциям';
  end if;

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
    wob := public._cn_wpn_obj(db, k, w);
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
      bill := public._cn_bill_add(bill, public._aa_name(a_rid), (v_alloy.recipe->>a_rid)::numeric * coalesce(v_abill,1));
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
      'ftl', mod_ftl,
      'eccm', radar_eccm),
    'className', cls->>'name', 'typeName', coalesce(typeObj->>'name',''));
end$$;
