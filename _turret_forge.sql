-- ════════════════════════════════════════════════════════════
-- ОРУЖЕЙНАЯ ВЕРФЬ — серверное зеркало движка turret_gen.js (§9 ТТХ)
-- ────────────────────────────────────────────────────────────
-- Таблица кастомных орудий фракций + RLS + RPC (SECURITY DEFINER),
-- пересчитывающие ТТХ АВТОРИТЕТНО из конфига (клиентским цифрам не
-- доверяем — см. client-write RLS-дыра). _cn_recompute (в _unit_publish.sql)
-- при публикации юнита резолвит weapons[].turretId → урон/энергия/дальность
-- отсюда.
--
-- ВНИМАНИЕ: числа ДОЛЖНЫ совпадать с turret_gen.js. Менял там — правь тут.
-- Порядок применения: этот файл ДО _turret_forge_units.sql.
-- ════════════════════════════════════════════════════════════

-- ── §0. Справочники (зеркало turret_gen.js §1 и §9) ──────────
create or replace function public._tg_dict()
returns jsonb language sql immutable as $$
select $j${
  "techs": {
    "kinetic": {"pw":0.7,"dl":0.85,"kind":"gun","kvTech":"кинетическое","kvDmg":"кинетический"},
    "ehs":     {"pw":1.0,"dl":1.00,"kind":"gun","kvTech":"электрохимическое","kvDmg":"электрохимическая система"},
    "rail":    {"pw":2.4,"dl":1.10,"kind":"rail","kvTech":"рельсотрон","kvDmg":"рельсотрон"},
    "em":      {"pw":2.6,"dl":1.50,"kind":"rail","kvTech":"электромагнитное","kvDmg":"электрохимическая система"},
    "laser":   {"pw":2.0,"dl":2.00,"kind":"beam","kvTech":"лазер","kvDmg":"импульсный лазер"},
    "plasma":  {"pw":1.6,"dl":0.40,"kind":"plasma","kvTech":"плазма","kvDmg":"термический"},
    "missile": {"pw":0.5,"dl":1.80,"kind":"launcher","kvTech":"управляемое наведение","kvDmg":"взрывной"},
    "explos":  {"pw":0.4,"dl":1.60,"kind":"launcher","kvTech":"взрывчатое","kvDmg":"взрывной"},
    "nano":    {"pw":1.5,"dl":1.20,"kind":"beam","kvTech":"нанотехнологии","kvDmg":"кинетический"},
    "ew":      {"pw":1.2,"dl":2.40,"kind":"array","kvTech":"электронное подавление","kvDmg":"разведка"},
    "grav":    {"pw":2.8,"dl":1.60,"kind":"exotic","kvTech":"гравитационное","kvDmg":"гравитационный"},
    "anti":    {"pw":3.4,"dl":1.50,"kind":"exotic","kvTech":"антиматериальное","kvDmg":"антимат"}
  },
  "classes": {
    "aa":      {"s":0.75,"ru":"ПВО / зенитное","kvClass":"турель ПВО"},
    "light":   {"s":0.95,"ru":"Лёгкое корабельное","kvClass":"легкое корабельное орудие"},
    "medium":  {"s":1.25,"ru":"Среднее корабельное","kvClass":"среднее корабельное орудие"},
    "heavy":   {"s":1.70,"ru":"Тяжёлое корабельное","kvClass":"тяжелое корабельное орудие"},
    "super":   {"s":2.20,"ru":"Супероружие","kvClass":"супероружие"},
    "tankgun": {"s":1.00,"ru":"Танковая пушка","kvClass":"танковая пушка"},
    "arty":    {"s":1.45,"ru":"Арторудие","kvClass":"арторудие"},
    "apc":     {"s":0.70,"ru":"Турель БТР","kvClass":"турель бтр"},
    "air":     {"s":0.60,"ru":"Авиационное/курсовое","kvClass":"авиапушка"},
    "drone":   {"s":0.50,"ru":"Дрон-пушка","kvClass":"дрон-пушка"},
    "mg":      {"s":0.55,"ru":"Пулемёт (станок)","kvClass":"пулемет"},
    "hw":      {"s":0.65,"ru":"Тяжёлое вооружение","kvClass":"тяжелое вооружение"},
    "gl":      {"s":0.60,"ru":"Гранатомёт","kvClass":"гранатомет"},
    "howitz":  {"s":1.60,"ru":"Гаубица","kvClass":"гаубица"},
    "rsu":     {"s":1.50,"ru":"РСУ (реактивная)","kvClass":"рсу"},
    "rpu":     {"s":1.20,"ru":"РПУ (пусковая)","kvClass":"рпу"},
    "rocket":  {"s":1.30,"ru":"Ракета","kvClass":"ракета"},
    "brm":     {"s":1.90,"ru":"Баллистическая ракета","kvClass":"баллистическая ракета"}
  },
  "rules": {
    "mg":      {"cal":[5,20],   "len":[20,70], "techs":["kinetic","ehs"]},
    "gl":      {"cal":[20,60],  "len":[15,40], "techs":["explos","ehs","kinetic"]},
    "hw":      {"cal":[20,60],  "len":[20,60], "techs":["kinetic","ehs","rail","laser","plasma"]},
    "drone":   {"cal":[5,30],   "len":[20,60], "techs":["kinetic","ehs","rail","laser","plasma"]},
    "air":     {"cal":[12,75],  "len":[30,80], "techs":["kinetic","ehs","rail","laser","plasma","missile"]},
    "apc":     {"cal":[15,90],  "len":[25,70], "techs":["kinetic","ehs","rail","laser","plasma"]},
    "aa":      {"cal":[12,60],  "len":[30,80], "techs":["kinetic","ehs","laser","missile","ew"]},
    "tankgun": {"cal":[40,180], "len":[30,70], "techs":["kinetic","ehs","rail","em","laser","plasma"]},
    "arty":    {"cal":[76,350], "len":[30,60], "techs":["ehs","em","rail","explos","kinetic"]},
    "howitz":  {"cal":[100,420],"len":[15,45], "techs":["ehs","explos","em"]},
    "rpu":     {"cal":[60,300], "len":[15,40], "techs":["missile","explos"]},
    "rsu":     {"cal":[60,250], "len":[15,35], "techs":["missile","explos"]},
    "rocket":  {"cal":[80,400], "len":[15,40], "techs":["missile","explos"]},
    "brm":     {"cal":[250,500],"len":[10,30], "techs":["missile","explos","anti"]},
    "light":   {"cal":[40,140], "len":[30,90], "techs":["kinetic","ehs","rail","laser","plasma","ew","missile"]},
    "medium":  {"cal":[90,260], "len":[30,90], "techs":["ehs","rail","em","laser","plasma","nano","ew","missile"]},
    "heavy":   {"cal":[180,420],"len":[35,100],"techs":["ehs","rail","em","laser","plasma","nano","ew","grav"]},
    "super":   {"cal":[300,500],"len":[40,110],"techs":["ehs","rail","em","laser","nano","anti","grav"]}
  },
  "techM": {"кинетическое":1,"электрохимическое":1.2,"рельсотрон":1.5,"лазер":1.3,"плазма":1.4,
            "управляемое наведение":1.3,"электромагнитное":1.6},
  "dmgM":  {"кинетический":1.1,"электрохимическая система":1.6,"взрывной":3.6,"рельсотрон":5.5,
            "энергетический":3.8,"импульсный лазер":1.5,"термический":4},
  "clsM":  {"турель ПВО":2.5,"турель":1.5,"бронетанковая пушка":1.5,"арторудие":2.4,"гаубица":2.8,
            "танковая пушка":1.9,"турель бтр":1.3,"авиапушка":2},
  "powerBase": {"drone":15,"air":40,"apc":30,"aa":100,"tankgun":100,"arty":120,
                "light":250,"medium":500,"heavy":900,"super":1200,
                "mg":20,"hw":40,"gl":25,"howitz":150,"rsu":180,"rpu":90,"rocket":120,"brm":400},
  "powerRef":  {"drone":15,"air":45,"apc":40,"aa":20,"tankgun":120,"arty":200,
                "light":90,"medium":130,"heavy":350,"super":500,
                "mg":12,"hw":30,"gl":40,"howitz":220,"rsu":130,"rpu":100,"rocket":150,"brm":400},
  "rangeBase": {"drone":3,"air":8,"apc":5,"aa":4,"mg":4,"hw":5,"gl":4,
                "tankgun":10,"arty":18,"howitz":22,"rsu":9,"rpu":8,"rocket":12,"brm":26,
                "light":4,"medium":6,"heavy":10,"super":14},
  "rangeLayout": {"row":1.0,"stacked":1.0,"quad":0.95,"rotary":0.80},
  "rofTech":  {"kinetic":2.6,"ehs":1.0,"rail":0.50,"em":0.35,"laser":0.05,"plasma":0.15,"missile":0.04},
  "rofClass": {"aa":8,"drone":2,"air":2,"apc":1,"tankgun":1,"arty":0.7,
               "light":1,"medium":1,"heavy":1,"super":1,
               "mg":6,"hw":1.5,"gl":2,"howitz":0.6,"rsu":2.5,"rpu":1.2,"rocket":0.5,"brm":0.15},
  "rofLayout": {"row":1.0,"stacked":1.0,"quad":1.1,"rotary":1.6},
  "rofCap": {"drone":2000,"air":2500,"apc":2200,"aa":12000,"tankgun":6000,
             "arty":60,"light":200,"medium":120,"heavy":60,"super":20,
             "mg":4000,"hw":400,"gl":300,"howitz":40,"rsu":60,"rpu":30,"rocket":12,"brm":3},
  "layoutMin": {"row":1,"stacked":2,"quad":4,"rotary":3},
  "resGs": {"blackmetall":8,"rudametall":20,"coloredmetall":45,"kristall":90,"staarvis":150},
  "carriers": {
    "peh":{"ru":"Пехота","mass":150,"power":150},
    "dron":{"ru":"Дрон","mass":120,"power":250},
    "dronkos":{"ru":"БПЛА (косм.)","mass":400,"power":600},
    "btr":{"ru":"БТР / БМП","mass":2500,"power":900},
    "tanki":{"ru":"Танк","mass":9000,"power":2000},
    "arta":{"ru":"Артиллерия","mass":25000,"power":2500},
    "aviacia":{"ru":"Атм. авиация","mass":2500,"power":1500},
    "vertihui":{"ru":"Вертолёт","mass":1800,"power":1200},
    "mla":{"ru":"Звездолёт","mass":6000,"power":4000},
    "corvette":{"ru":"Корвет","mass":40000,"power":9000},
    "destroyer":{"ru":"Эсминец","mass":90000,"power":20000},
    "supportCarrier":{"ru":"Авианосец подд.","mass":90000,"power":20000},
    "mediumCruiser":{"ru":"Средний крейсер","mass":200000,"power":45000},
    "hyperCruiser":{"ru":"Гиперкрейсер","mass":260000,"power":70000},
    "multiroleCarrier":{"ru":"Многоцел. авианосец","mass":260000,"power":70000},
    "battleship":{"ru":"Линкор","mass":400000,"power":120000},
    "dreadnought":{"ru":"Дредноут","mass":600000,"power":200000},
    "ss13":{"ru":"СС-13 (станция)","mass":600000,"power":200000}
  },
  "classCarriers": {
    "mg":["peh","dron","btr","tanki","arta","aviacia","vertihui","dronkos","mla"],
    "gl":["peh","btr","tanki","vertihui","dron"],
    "hw":["peh","btr","tanki","aviacia","vertihui","dron","dronkos"],
    "drone":["dron","dronkos","aviacia","vertihui","mla"],
    "air":["aviacia","vertihui","dronkos","mla","dron"],
    "apc":["btr","tanki","arta","mla","vertihui"],
    "aa":["btr","tanki","arta","mla","corvette","destroyer","supportCarrier","mediumCruiser",
          "hyperCruiser","multiroleCarrier","battleship","dreadnought","ss13"],
    "tankgun":["tanki","btr","arta","mla"],
    "arty":["arta","tanki"],
    "howitz":["arta"],
    "rsu":["arta","btr","vertihui"],
    "rpu":["arta","btr","tanki","aviacia","vertihui","mla","corvette","destroyer"],
    "rocket":["arta","mla","corvette","destroyer","supportCarrier","mediumCruiser"],
    "brm":["arta","ss13","battleship","dreadnought"],
    "light":["mla","corvette","destroyer","supportCarrier","mediumCruiser","hyperCruiser",
             "multiroleCarrier","battleship","dreadnought","ss13"],
    "medium":["destroyer","supportCarrier","mediumCruiser","hyperCruiser","multiroleCarrier",
              "battleship","dreadnought","ss13"],
    "heavy":["mediumCruiser","hyperCruiser","multiroleCarrier","battleship","dreadnought","ss13"],
    "super":["battleship","dreadnought","ss13"]
  }
}$j$::jsonb
$$;
grant execute on function public._tg_dict() to authenticated, anon;

-- ── §1. Нормализация конфига (зеркало TG.normalize) ──────────
-- Зажимает всё, что влияет на ТТХ: класс → технология → калибр, длина,
-- стволы, масштаб. Косметика (seed/yaw/detail/цвета) проходит как есть.
create or replace function public._tg_norm(p_cfg jsonb)
returns jsonb language plpgsql immutable as $$
declare
  d jsonb := public._tg_dict();
  k text; t text; r jsonb;
  cal numeric; len numeric; n int; sz numeric; lay text;
begin
  k := coalesce(p_cfg->>'klass','medium');
  if d->'classes'->k is null then k := 'medium'; end if;
  r := coalesce(d->'rules'->k, d->'rules'->'medium');
  t := coalesce(p_cfg->>'tech','ehs');
  if not (r->'techs') ? t then t := r->'techs'->>0; end if;

  cal := coalesce(nullif(p_cfg->>'caliber','')::numeric, (r->'cal'->>0)::numeric);
  if cal = 0 then cal := (r->'cal'->>0)::numeric; end if;
  cal := greatest((r->'cal'->>0)::numeric, least((r->'cal'->>1)::numeric, cal));

  len := coalesce(nullif(p_cfg->>'barrelLen','')::numeric, (r->'len'->>0)::numeric);
  if len = 0 then len := (r->'len'->>0)::numeric; end if;
  len := greatest((r->'len'->>0)::numeric, least((r->'len'->>1)::numeric, len));

  n := greatest(1, least(8, coalesce(nullif(p_cfg->>'barrels','')::numeric, 1)::int));
  -- Масштаб — единственный «свободный» множитель массы (степень 1.4), поэтому
  -- зажат теми же границами, что и ползунок в верфи: 0.4..3.
  sz := greatest(0.4, least(3, coalesce(nullif(p_cfg->>'size','')::numeric, 1)));
  lay := coalesce(p_cfg->>'layout','row');
  if d->'layoutMin'->lay is null then lay := 'row'; end if;

  return coalesce(p_cfg,'{}'::jsonb) || jsonb_build_object(
    'klass', k, 'tech', t, 'caliber', cal, 'barrelLen', len,
    'barrels', n, 'size', sz, 'layout', lay,
    'platform', coalesce(nullif(p_cfg->>'platform',''),'1'),
    'detail',  greatest(0, least(1, coalesce(nullif(p_cfg->>'detail','')::numeric, 0.6))),
    -- Поворот башни — режим осмотра в верстаке, а не свойство орудия:
    -- на ТТХ не влияет и в конфиге не хранится (всегда 0).
    'yaw',     0,
    'seed',    greatest(1, least(9999, coalesce(nullif(p_cfg->>'seed','')::numeric, 1337)::int))
  );
end$$;
grant execute on function public._tg_norm(jsonb) to authenticated;

-- Фактическая компоновка: пакет ниже минимума стволов вырождается в «в ряд»
create or replace function public._tg_eff_layout(p_cfg jsonb)
returns text language sql immutable as $$
  select case when coalesce((p_cfg->>'barrels')::int,1)
                 < coalesce((public._tg_dict()->'layoutMin'->>(p_cfg->>'layout'))::int,1)
              then 'row' else coalesce(p_cfg->>'layout','row') end
$$;

-- ── §2. Темп стрельбы (зеркало TG.rofOf) ─────────────────────
create or replace function public._tg_rof(p_cfg jsonb)
returns numeric language plpgsql immutable as $$
declare
  d jsonb := public._tg_dict();
  kal double precision := greatest(1, coalesce((p_cfg->>'caliber')::double precision,1));
  n   double precision := greatest(1, coalesce((p_cfg->>'barrels')::double precision,1));
  bl  double precision := greatest(10, coalesce((p_cfg->>'barrelLen')::double precision,50));
  r double precision; cap double precision;
begin
  r := 29850 * 1.10 * power(kal+10, -1.459) * power(n, 0.655)
       * coalesce((d->'rofTech'->>(p_cfg->>'tech'))::double precision, 1)
       * coalesce((d->'rofClass'->>(p_cfg->>'klass'))::double precision, 1)
       * coalesce((d->'rofLayout'->>public._tg_eff_layout(p_cfg))::double precision, 1)
       * power(50/bl, 0.25);
  cap := least(r, coalesce((d->'rofCap'->>(p_cfg->>'klass'))::double precision, 500));
  return greatest(1, case when cap >= 100 then round((cap/10)::numeric)*10 else round(cap::numeric) end);
end$$;

-- ── §3. Ядро: масса и урон (зеркало TG.core) ─────────────────
create or replace function public._tg_core(p_cfg jsonb)
returns jsonb language plpgsql immutable as $$
declare
  d jsonb := public._tg_dict();
  T jsonb := d->'techs'->(p_cfg->>'tech');
  K jsonb := d->'classes'->(p_cfg->>'klass');
  tC double precision; dC double precision; cC double precision;
  kal double precision := coalesce((p_cfg->>'caliber')::double precision, 0);
  rof double precision := coalesce((p_cfg->>'rof')::double precision, 0);
  n   double precision := greatest(1, coalesce((p_cfg->>'barrels')::double precision, 1));
  bl  double precision := coalesce((p_cfg->>'barrelLen')::double precision, 50);
  sz  double precision := coalesce((p_cfg->>'size')::double precision, 1);
  mass double precision; one numeric;
begin
  T := coalesce(T, d->'techs'->'ehs');
  K := coalesce(K, d->'classes'->'medium');
  tC := coalesce((d->'techM'->>(T->>'kvTech'))::double precision, 1);
  dC := coalesce((d->'dmgM' ->>(T->>'kvDmg'))::double precision, 0);
  cC := coalesce((d->'clsM' ->>(K->>'kvClass'))::double precision, 1);

  mass := 74.4 * power(kal, 1.095) * power(1+rof, -0.263) / 1.19;
  mass := mass * power(n, 0.30) * power(bl/50, 0.55)
               * power(sz * (K->>'s')::double precision, 1.4);
  mass := greatest(20, round((mass/10)::numeric)*10);

  one := round((kal * sqrt(mass/n) * tC * cC * (1+dC) * (1+rof/5000) / 50)::numeric);
  return jsonb_build_object(
    'mass', mass,
    'one', one,
    'damage', greatest(1, round((one::double precision * power(n, 0.85))::numeric)),
    'tC', tC, 'dC', dC, 'cC', cC);
end$$;

-- ── §4. Полные ТТХ (зеркало TG.stats) ────────────────────────
create or replace function public._tg_stats(p_input jsonb)
returns jsonb language plpgsql immutable as $$
declare
  d jsonb := public._tg_dict();
  cfg jsonb := public._tg_norm(p_input);
  T jsonb; K jsonb; R jsonb;
  refCfg jsonb; refC jsonb; C jsonb;
  v_tech text; kls text;
  kal double precision; n double precision;
  rof numeric; mass numeric; damage numeric;
  base double precision; energy numeric; price numeric;
  resurs jsonb; gs numeric := 0; rk text;
  refCal double precision; barrelMatters boolean; dal double precision; dalnost int;
  kind text; billKind text; bill jsonb := '{}'::jsonb;
begin
  rof := public._tg_rof(cfg);
  cfg := cfg || jsonb_build_object('rof', rof);
  kls := cfg->>'klass'; v_tech := cfg->>'tech';
  T := coalesce(d->'techs'->v_tech, d->'techs'->'ehs');
  K := coalesce(d->'classes'->kls, d->'classes'->'medium');
  R := coalesce(d->'rules'->kls, d->'rules'->'medium');
  kal := (cfg->>'caliber')::double precision;
  n   := (cfg->>'barrels')::double precision;

  C := public._tg_core(cfg);
  mass := (C->>'mass')::numeric; damage := (C->>'damage')::numeric;

  -- ЭНЕРГИЯ: база класса × множитель технологии × (урон / урон эталона)^0.8.
  -- Эталон — «типовое» орудие класса (1 ствол, калибр класса, L/50, ЭХС).
  base := coalesce((d->'powerBase'->>kls)::double precision, 500);
  refCfg := cfg || jsonb_build_object(
    'tech', case when (R->'techs') ? 'ehs' then 'ehs' else R->'techs'->>0 end,
    'caliber', greatest((R->'cal'->>0)::numeric,
                least((R->'cal'->>1)::numeric,
                      coalesce((d->'powerRef'->>kls)::numeric, 130))),
    'barrels', 1,
    'barrelLen', greatest((R->'len'->>0)::numeric, least((R->'len'->>1)::numeric, 50)),
    'size', 1, 'layout', 'row');
  refCfg := refCfg || jsonb_build_object('rof', public._tg_rof(refCfg));
  refC := public._tg_core(refCfg);
  energy := greatest(1, round((base * (T->>'pw')::double precision
            * power(damage::double precision
                    / greatest(1,(refC->>'damage')::double precision), 0.8))::numeric));

  price := 55800 * power(kal, 0.402) * power(mass::double precision, 0.157)
         * power((C->>'tC')::double precision * (C->>'cC')::double precision, 0.338)
         * power(1 + energy::double precision, 0.343) / 1.15;
  price := price * power(n, 0.15);
  price := round(price/1000)*1000;

  -- Конструкционные решения (KV-номенклатура) — идут в цену ГС юнита
  resurs := jsonb_build_object(
    'blackmetall',   greatest(1, round(mass/900)),
    'coloredmetall', case when v_tech in ('laser','plasma','em') then greatest(1, round(mass/2200)) else 0 end,
    'rudametall',    case when v_tech in ('ehs','kinetic')       then greatest(1, round(mass/1400)) else 0 end,
    'kristall',      case when v_tech in ('laser','plasma')      then greatest(1, round(mass/1800)) else 0 end,
    'staarvis',      case when v_tech in ('rail','em') or kls='super' then greatest(1, round(mass/6000)) else 0 end);
  for rk in select jsonb_object_keys(d->'resGs') loop
    gs := gs + coalesce((resurs->>rk)::numeric,0) * (d->'resGs'->>rk)::numeric;
  end loop;
  gs := round(gs * 0.32);   -- CN_KV_COST_FACTOR

  -- ДАЛЬНОСТЬ = ГЕКСЫ боевой карты (в _bt_stats клампится 1..40)
  refCal := coalesce((d->'powerRef'->>kls)::double precision, 130);
  barrelMatters := (T->>'kind') in ('gun','rail');
  dal := coalesce((d->'rangeBase'->>kls)::double precision, 3) * (T->>'dl')::double precision
       * power(kal/refCal, 0.55)
       * (case when barrelMatters
               then power(greatest(10,(cfg->>'barrelLen')::double precision)/50, 0.55) else 1 end)
       * coalesce((d->'rangeLayout'->>public._tg_eff_layout(cfg))::double precision, 1);
  dalnost := greatest(1, least(40, round(dal::numeric)::int));

  kind := case when v_tech = 'missile' then 'missile'
               when v_tech in ('laser','plasma') then 'energy' else 'kinetic' end;
  -- Ведомость: зеркало cnWpnResKind — там «электромагн» тоже энергетика.
  billKind := case when v_tech = 'missile' then 'missile'
                   when v_tech in ('laser','plasma','em') then 'energy' else 'kinetic' end;
  if billKind = 'missile' then
    bill := public._cn_bill_add(bill, 'Изотопы', damage/150);
  elsif billKind = 'energy' then
    bill := public._cn_bill_add(bill, 'Редкоземельные руды', damage/180);
    bill := public._cn_bill_add(bill, 'Гелий-3', damage/400);
  else
    bill := public._cn_bill_add(bill, 'Железо', damage/120);
  end if;

  return jsonb_build_object(
    'ok', true,
    'damage', damage, 'price', price, 'gs', gs, 'bill', bill,
    'mass', mass, 'energy', energy, 'crew', 0, 'dalnost', dalnost,
    'rof', rof, 'caliber', kal, 'barrels', n::int, 'kind', kind,
    'salvo', (C->>'one')::numeric,
    'tC', C->'tC', 'dC', C->'dC', 'cC', C->'cC',
    'resurs', resurs,
    'kvTech', T->>'kvTech', 'kvDmg', T->>'kvDmg', 'kvClass', K->>'kvClass',
    'klassRu', K->>'ru');
end$$;
grant execute on function public._tg_stats(jsonb) to authenticated;

-- Носители, которые тянут сборку (зеркало TG.carrierKeys): класс говорит,
-- кто такое в принципе носит, масса и энергия отсекают тех, кто не тянет.
create or replace function public._tg_carriers(p_cfg jsonb, p_stats jsonb)
returns text[] language sql immutable as $$
  select coalesce(array_agg(c.key order by c.ord), '{}'::text[])
  from (
    select e.value #>> '{}' as key, e.ordinality as ord
    from jsonb_array_elements(
           coalesce(public._tg_dict()->'classCarriers'->(p_cfg->>'klass'),
                    public._tg_dict()->'classCarriers'->'medium')) with ordinality e
  ) c
  where (p_stats->>'mass')::numeric   <= (public._tg_dict()->'carriers'->c.key->>'mass')::numeric
    and (p_stats->>'energy')::numeric <= (public._tg_dict()->'carriers'->c.key->>'power')::numeric
$$;
grant execute on function public._tg_carriers(jsonb,jsonb) to authenticated;

-- ── §5. Таблица ──────────────────────────────────────────────
create table if not exists public.faction_turrets (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid(),
  faction_id    text,
  faction_name  text,
  faction_color text,
  name          text not null,
  cfg           jsonb not null default '{}'::jsonb,   -- нормализованный конфиг верстака
  stats         jsonb not null default '{}'::jsonb,   -- ТТХ, посчитанные сервером
  carriers      text[] not null default '{}',         -- классы носителей, которые тянут
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_ftur_faction on public.faction_turrets(faction_id);
create index if not exists idx_ftur_owner   on public.faction_turrets(owner_id);

alter table public.faction_turrets enable row level security;

-- SELECT: свои-фракционные + общедоступные (faction_id is null) + владелец + админ.
drop policy if exists ftur_select on public.faction_turrets;
create policy ftur_select on public.faction_turrets for select using (
  faction_id is null
  or owner_id = auth.uid()
  or faction_id = public._ec_my_fid_opt()
  or public.current_user_role() in ('superadmin','editor')
);
-- Прямой DML запрещён — только через RPC ниже.
revoke insert, update, delete on public.faction_turrets from authenticated, anon;

-- ── §6. RPC upsert ───────────────────────────────────────────
create or replace function public.turret_upsert(
  p_turret_id uuid, p_name text, p_cfg jsonb,
  p_faction_id text, p_faction_name text, p_faction_color text
) returns public.faction_turrets language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_cfg jsonb; v_st jsonb; v_car text[];
  row public.faction_turrets;
  staff boolean := public.current_user_role() in ('superadmin','editor');
  my_fid text := public._ec_my_fid_opt();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'empty name'; end if;
  if not staff and my_fid is null then raise exception 'no approved faction'; end if;
  if p_faction_id is not null and not staff and p_faction_id is distinct from my_fid then
    raise exception 'no rights for faction';
  end if;

  v_cfg := public._tg_norm(coalesce(p_cfg,'{}'::jsonb));
  v_st  := public._tg_stats(v_cfg);
  v_cfg := v_cfg || jsonb_build_object('rof', v_st->'rof');
  v_car := public._tg_carriers(v_cfg, v_st);
  if array_length(v_car,1) is null then
    raise exception 'эту сборку не тянет ни один носитель: слишком тяжело или прожорливо';
  end if;

  if p_turret_id is null then
    insert into public.faction_turrets(owner_id, faction_id, faction_name, faction_color,
                                       name, cfg, stats, carriers)
    values (uid, p_faction_id, p_faction_name, p_faction_color, left(p_name,48), v_cfg, v_st, v_car)
    returning * into row;
  else
    update public.faction_turrets
       set name = left(p_name,48), cfg = v_cfg, stats = v_st, carriers = v_car,
           faction_name  = coalesce(p_faction_name, faction_name),
           faction_color = coalesce(p_faction_color, faction_color),
           updated_at = now()
     where id = p_turret_id
       and (owner_id = uid or staff or (faction_id is not null and faction_id = my_fid))
    returning * into row;
    if row.id is null then raise exception 'turret not found or forbidden'; end if;
  end if;
  return row;
end;
$$;

-- ── §7. RPC delete ───────────────────────────────────────────
-- Сироты дизайнов: орудие могло быть вписано в опубликованный юнит. Публикация
-- пересчитывается на сервере по turretId, поэтому удаление орудия, которое
-- где-то стоит, запрещаем (иначе юнит станет непересчитываемым —
-- та же грабля, что с удалением проектов и «эскортом»).
create or replace function public.turret_delete(p_turret_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
  staff boolean := public.current_user_role() in ('superadmin','editor');
  my_fid text := public._ec_my_fid_opt();
  used int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select count(*) into used from public.faction_units u
   where exists (select 1 from jsonb_array_elements(coalesce(u.data->'weapons','[]'::jsonb)) w
                  where w->>'turretId' = p_turret_id::text);
  if used > 0 then
    raise exception 'орудие стоит на % опубликованных проектах — сначала снимите его', used;
  end if;
  delete from public.faction_turrets
   where id = p_turret_id
     and (owner_id = uid or staff or (faction_id is not null and faction_id = my_fid));
end;
$$;

grant execute on function public.turret_upsert(uuid,text,jsonb,text,text,text) to authenticated;
grant execute on function public.turret_delete(uuid) to authenticated;
