-- ════════════════════════════════════════════════════════════
-- КАЛИБРОВКА ЦЕНЫ, СЫРЬЯ И МАССЫ РЕАКТОРНОЙ ВЕРФИ (08.08)
-- ────────────────────────────────────────────────────────────
-- Своя установка втрое мощнее заводской выходила ВДВОЕ ДЕШЕВЛЕ её и весила
-- 40 т при лимите 250 т. Причина одна на три симптома: цена и сырьё считались
-- от абсолютной мощности степенью 0.62 (каталог внутри класса почти линеен),
-- а масса — только от индекса железа, без нижней планки по выработке.
-- Теперь якорь всему — каталожный реактор-эталон класса (refPrice/refCM/refSV),
-- плюс храповик массы massCap × MASS_REST × MASS_FLOOR_K × powRatio.
-- Правка 2: сырьё и топливная ведомость считаются от ДОхраповиковой массы
-- (храповик — про место на шасси, а не про медь в контуре), RES_EXP 0.70.
-- Зеркало клиента: reactor_gen.js §3/§5. Порядок: после _reactor_forge.sql.
create or replace function public._rg_dict()
returns jsonb language sql immutable as $$
select $j${
  "schools": {
    "ritag": {"ab":"РИТЭГ","pw":0.45,"massK":0.70,"stab":92,"forceK":0.80,"sig":0.35,"capK":1.20,
              "fuels":["iso","exo","degen"],"conv":["seebeck","tpv","stirling"],"conf":["none"]},
    "yaeu":  {"ab":"ЯЭУ","pw":1.00,"massK":1.00,"stab":62,"forceK":1.00,"sig":0.75,"capK":1.90,
              "fuels":["iso","therm","exo"],"conv":["rankine","brayton","tpv","seebeck"],"conf":["none","damped"]},
    "mgd":   {"ab":"МГД","pw":1.00,"massK":0.80,"stab":70,"forceK":1.10,"sig":0.90,"capK":2.00,
              "fuels":["methane","therm","he3","iso"],"conv":["mhd","brayton","rankine"],"conf":["none","mirror"]},
    "tyar":  {"ab":"ТЯР","pw":1.35,"massK":0.70,"stab":48,"forceK":1.15,"sig":1.10,"capK":2.50,
              "fuels":["deut","he3","therm","exo"],"conv":["brayton","rankine","mhd","direct"],
              "conf":["tokamak","stellarator","inertial","mirror"]},
    "amu":   {"ab":"АМУ","pw":1.70,"massK":0.45,"stab":34,"forceK":1.25,"sig":1.35,"capK":2.80,
              "fuels":["degen","neutro","ichor"],"conv":["direct","mhd","brayton"],
              "conf":["penning","inertial","mirror"]},
    "kvg":   {"ab":"КВГ","pw":2.00,"massK":0.35,"stab":36,"forceK":1.30,"sig":1.55,"capK":3.00,
              "fuels":["grav","neutro","ichor","exo"],"conv":["direct","mhd"],
              "conf":["penning","lattice","inertial"]}
  },
  "fuels": {
    "methane":{"ru":"Метан","res":"Метан","q":0.65,"dens":2.6,"stab":8},
    "iso":    {"ru":"Изотопы","res":"Изотопы","q":1.00,"dens":1.0,"stab":0},
    "deut":   {"ru":"Дейтерий","res":"Дейтерий","q":1.15,"dens":1.3,"stab":-4},
    "he3":    {"ru":"Гелий-3","res":"Гелий-3","q":1.30,"dens":1.1,"stab":6},
    "therm":  {"ru":"Старвис","res":"Старвис","q":1.45,"dens":0.8,"stab":-6},
    "exo":    {"ru":"Стелларит","res":"Стелларит","q":1.60,"dens":0.5,"stab":4},
    "grav":   {"ru":"Гравиядро","res":"Гравиядро","q":1.80,"dens":0.28,"stab":-10},
    "degen":  {"ru":"Рагенод","res":"Рагенод","q":1.95,"dens":0.22,"stab":-14},
    "neutro": {"ru":"Программируемая материя","res":"Программируемая материя","q":2.10,"dens":0.18,"stab":2},
    "ichor":  {"ru":"Ихор","res":"Ихор","q":2.40,"dens":0.12,"stab":-18}
  },
  "conv": {
    "seebeck": {"ru":"Термоэлектрика (эффект Зеебека)","eff":0.08,"mass":0.60,"stab":14},
    "tpv":     {"ru":"Термофотовольтаика","eff":0.22,"mass":0.70,"stab":8},
    "stirling":{"ru":"Двигатель Стирлинга","eff":0.32,"mass":0.85,"stab":4},
    "rankine": {"ru":"Паровой цикл (Ренкин)","eff":0.36,"mass":1.25,"stab":2},
    "brayton": {"ru":"Газовый цикл (Брайтон)","eff":0.45,"mass":1.00,"stab":0},
    "mhd":     {"ru":"МГД-съём с потока","eff":0.58,"mass":1.15,"stab":-8},
    "direct":  {"ru":"Прямое преобразование","eff":0.78,"mass":0.90,"stab":-16}
  },
  "cool": {
    "passive":{"ru":"Пассивный (излучением)","heat":0.45,"mass":0.50},
    "gas":    {"ru":"Газовый (гелий)","heat":1.00,"mass":0.80,"res":"Гелий-3"},
    "water":  {"ru":"Водо-водяной","heat":1.15,"mass":1.10,"res":"Жидкая вода"},
    "salt":   {"ru":"Расплав солей","heat":1.35,"mass":1.00,"res":"Ионит"},
    "metal":  {"ru":"Жидкий металл (Na / Pb)","heat":1.60,"mass":1.25,"res":"Медь"},
    "lithium":{"ru":"Литиевый бланкет","heat":1.85,"mass":1.40,"res":"Редкоземельные руды"},
    "field":  {"ru":"Полевой теплоотвод","heat":2.20,"mass":1.60,"res":"Стелларит"}
  },
  "conf": {
    "none":       {"ru":"Открытая зона","pw":1.00,"stab":0,"mass":1.00},
    "damped":     {"ru":"Зона с поглотителями","pw":0.88,"stab":18,"mass":1.10},
    "tokamak":    {"ru":"Токамак","pw":1.00,"stab":6,"mass":1.20},
    "stellarator":{"ru":"Стелларатор","pw":0.92,"stab":18,"mass":1.35},
    "inertial":   {"ru":"Инерциальное сжатие","pw":1.35,"stab":-14,"mass":0.90},
    "mirror":     {"ru":"Магнитная ловушка","pw":1.12,"stab":-4,"mass":1.00},
    "penning":    {"ru":"Ловушка Пеннинга","pw":1.50,"stab":-22,"mass":1.10},
    "lattice":    {"ru":"Резонансная решётка","pw":1.70,"stab":-30,"mass":1.25}
  },
  "carriers": {
    "peh":             {"ru":"Пехота","refPower":160,"refForce":100,"massCap":60,"cap":10,"div":100,"refPrice":3000000,"refCM":10,"refSV":0},
    "dron":            {"ru":"Дрон","refPower":400,"refForce":120,"massCap":20,"cap":6,"div":100,"refPrice":3000000,"refCM":50,"refSV":0},
    "dronkos":         {"ru":"БПЛА (косм.)","refPower":400,"refForce":120,"massCap":30,"cap":6,"div":100,"refPrice":3000000,"refCM":50,"refSV":0},
    "btr":             {"ru":"БТР / БМП","refPower":800,"refForce":300,"massCap":1800,"cap":70,"div":100,"refPrice":4000000,"refCM":10,"refSV":0},
    "tanki":           {"ru":"Танк","refPower":3600,"refForce":260,"massCap":6000,"cap":130,"div":100,"refPrice":10000000,"refCM":300,"refSV":0},
    "arta":            {"ru":"Артиллерия","refPower":3600,"refForce":29,"massCap":1400,"cap":160,"div":100,"refPrice":4500000,"refCM":50,"refSV":0},
    "aviacia":         {"ru":"Атм. авиация","refPower":4800,"refForce":250,"massCap":3300,"cap":80,"div":100,"refPrice":10000000,"refCM":400,"refSV":0},
    "vertihui":        {"ru":"Вертолёт","refPower":5200,"refForce":110,"massCap":2100,"cap":100,"div":100,"refPrice":10000000,"refCM":50,"refSV":0},
    "mla":             {"ru":"Звездолёт","refPower":3600,"refForce":80,"massCap":4000,"cap":80,"div":100,"refPrice":3000000,"refCM":50,"refSV":0},
    "corvette":        {"ru":"Корвет","refPower":5200,"refForce":140,"massCap":32000,"cap":250,"div":500,"refPrice":20000000,"refCM":50,"refSV":10},
    "destroyer":       {"ru":"Эсминец","refPower":10000,"refForce":180,"massCap":48000,"cap":400,"div":500,"refPrice":25000000,"refCM":100,"refSV":100},
    "supportCarrier":  {"ru":"Авианосец подд.","refPower":5600,"refForce":80,"massCap":40000,"cap":600,"div":500,"refPrice":12000000,"refCM":50,"refSV":0},
    "mediumCruiser":   {"ru":"Средний крейсер","refPower":22000,"refForce":250,"massCap":105000,"cap":700,"div":500,"refPrice":40000000,"refCM":200,"refSV":250},
    "hyperCruiser":    {"ru":"Факельщик","refPower":30000,"refForce":250,"massCap":90000,"cap":600,"div":500,"refPrice":40000000,"refCM":300,"refSV":100},
    "multiroleCarrier":{"ru":"Многоцел. авианосец","refPower":40000,"refForce":100,"massCap":105000,"cap":5500,"div":500,"refPrice":70000000,"refCM":100,"refSV":100},
    "battleship":      {"ru":"Линкор","refPower":52000,"refForce":100,"massCap":180000,"cap":1200,"div":500,"refPrice":80000000,"refCM":400,"refSV":0},
    "dreadnought":     {"ru":"Дредноут","refPower":82000,"refForce":25,"massCap":250000,"cap":1800,"div":500,"refPrice":150000000,"refCM":600,"refSV":400},
    "ss13":            {"ru":"СС-13 (станция)","refPower":160000,"refForce":60,"massCap":240000,"cap":1000,"div":500,"refPrice":70000000,"refCM":500,"refSV":300}
  },
  "schoolCarriers": {
    "ritag": ["peh","dron","dronkos","btr","tanki","arta","aviacia","vertihui","mla","corvette",
              "destroyer","supportCarrier","mediumCruiser","hyperCruiser","multiroleCarrier",
              "battleship","dreadnought","ss13"],
    "yaeu":  ["btr","tanki","arta","aviacia","vertihui","mla","corvette","destroyer",
              "supportCarrier","mediumCruiser","hyperCruiser","multiroleCarrier",
              "battleship","dreadnought","ss13"],
    "mgd":   ["tanki","arta","aviacia","vertihui","mla","corvette","destroyer",
              "supportCarrier","mediumCruiser","hyperCruiser","multiroleCarrier",
              "battleship","dreadnought","ss13"],
    "tyar":  ["mla","corvette","destroyer","supportCarrier","mediumCruiser","hyperCruiser",
              "multiroleCarrier","battleship","dreadnought","ss13"],
    "amu":   ["mediumCruiser","hyperCruiser","multiroleCarrier","battleship","dreadnought","ss13"],
    "kvg":   ["hyperCruiser","multiroleCarrier","battleship","dreadnought","ss13"]
  },
  "limits": {
    "size":[0.15,3.00],"cores":[1,6],"enrich":[0.50,5.00],"temp":[0.40,2.20],
    "rad":[0.00,2.50],"shield":[0.00,3.00],"damp":[0.00,1.50],"detail":[0,1],"seed":[1,9999]
  },
  "const": {"CAP_RATIO":3.00,"PW_EXP":0.72,"MASS_EXP":0.85,"MASS_REST":0.55,"STAB_MIN":15,
            "MASS_FLOOR_K":0.50,"PRICE_EXP":0.95,"RES_EXP":0.70},
  "defaults": {"klass":"corvette","school":"yaeu","fuel":"iso","conv":"brayton","cool":"metal",
               "conf":"none","size":1,"cores":2,"enrich":2,"temp":1,"rad":1,"shield":1,"damp":0.3,
               "seed":1337,"detail":0.6,"tint":"#2b3138","accent":"#e8a93f"}
}$j$::jsonb
$$;

create or replace function public._rg_stats(p_input jsonb)
returns jsonb language plpgsql immutable as $$
declare
  d jsonb := public._rg_dict();
  c jsonb := public._rg_norm(p_input);
  S jsonb; F jsonb; CV jsonb; L jsonb; N jsonb; CAR jsonb;
  ix jsonb := public._rg_index(c); rf jsonb := public._rg_ref();
  eR double precision; mR double precision; dens double precision;
  power_v numeric; mass_v numeric; stab_v numeric; sig_v numeric; force_v numeric;
  tier double precision; bonus int;
  modul int; dviglo int; radar int; svaz int; capb int;
  resurs jsonb; price numeric; bill jsonb := '{}'::jsonb; on_v numeric;
  fq numeric; cq numeric; sq numeric; coolres text;
  pratio double precision; mfloor numeric; resfl double precision; massix numeric;
  qual double precision; qref double precision; RSC jsonb; RFU jsonb; RCV jsonb;
begin
  S := d->'schools'->(c->>'school'); F := d->'fuels'->(c->>'fuel');
  CV := d->'conv'->(c->>'conv');      L := d->'cool'->(c->>'cool');
  N := d->'conf'->(c->>'conf');      CAR := d->'carriers'->(c->>'klass');

  eR := (ix->>'E')::double precision / (rf->>'E')::double precision;
  mR := (ix->>'M')::double precision / (rf->>'M')::double precision;

  power_v := greatest(1, round((CAR->>'refPower')::double precision
             * power(eR, (d->'const'->>'PW_EXP')::double precision))::numeric);
  -- Превышение над заводским эталоном класса: от него считаются планка массы,
  -- цена и закладка сырья (зеркало pRatio в reactor_gen.js).
  pratio := power_v::double precision / greatest(1, (CAR->>'refPower')::double precision);
  mass_v := greatest(1, round((CAR->>'massCap')::double precision
             * (d->'const'->>'MASS_REST')::double precision
             * power(mR, (d->'const'->>'MASS_EXP')::double precision))::numeric);
  -- Железо, которое реально обточено (ДО храповика): им, а не итоговой массой,
  -- считаются сырьё и теплоноситель — храповик про место на шасси, не про медь.
  massix := mass_v;
  -- Храповик массы: компактность не отменяет того, что мощная установка —
  -- это железо. Ниже планки масса не падает никогда.
  mfloor := round(((CAR->>'massCap')::double precision
             * (d->'const'->>'MASS_REST')::double precision
             * (d->'const'->>'MASS_FLOOR_K')::double precision * pratio)::numeric);
  if mfloor > mass_v then mass_v := mfloor; end if;
  if mass_v >= 100 then mass_v := round(mass_v / 5) * 5; end if;

  dens := eR / mR;

  stab_v := (S->>'stab')::numeric + (CV->>'stab')::numeric + (N->>'stab')::numeric + (F->>'stab')::numeric
          + (c->>'rad')::numeric * 16 * (L->>'heat')::numeric
          + (c->>'damp')::numeric * 24
          + (c->>'shield')::numeric * 3
          - ((c->>'temp')::numeric - 1) * 34
          - ((c->>'enrich')::numeric - 1) * 7
          - ((c->>'cores')::numeric - 1) * 3.5
          - (ln(greatest(1, dens)) * 13)::numeric;
  stab_v := greatest(0, least(100, round(stab_v)));

  sig_v := round(((S->>'sig')::double precision * (1 + (c->>'rad')::double precision * 0.9)
         * power(power_v::double precision / greatest(1,(CAR->>'refPower')::double precision), 0.5)
         / (1 + (c->>'shield')::double precision * 0.35) * 10)::numeric) / 10;

  force_v := round(greatest(5, least((CAR->>'refForce')::double precision
             * (d->'const'->>'CAP_RATIO')::double precision,
             (CAR->>'refForce')::double precision * 0.85 * power(dens, 0.30)
             * (S->>'forceK')::double precision))::numeric);

  tier := log(10::numeric, (power_v + 10)::numeric)::double precision;
  bonus := case when c->>'conv' in ('direct','mhd') then 1 else 0 end;
  modul  := greatest(1, least(8, round((tier - 1.2)::numeric)::int + bonus));
  dviglo := greatest(1, least(5, round((tier - 2.0)::numeric)::int + bonus));
  radar  := greatest(1, least(5, round((tier - 2.2)::numeric)::int + bonus));
  svaz   := greatest(1, least(4, round((tier - 2.6)::numeric)::int + 1));
  capb   := round(-(c->>'shield')::numeric * 4 - (c->>'rad')::numeric * 2
                  + case when c->>'conv' in ('seebeck','tpv') then 6 else 0 end)::int;

  -- Сырьё: массовая часть плюс каталожная закладка эталона, вытянутая по
  -- мощности (компактная схема экономит железо, а не редкие материалы).
  resfl := power(pratio, (d->'const'->>'RES_EXP')::double precision);
  resurs := jsonb_build_object(
    'blackmetall',   greatest(1, round(massix / 700)),
    'coloredmetall', greatest(1, round(greatest(massix / 1500 * (1 + (c->>'rad')::numeric),
                                     coalesce((CAR->>'refCM')::numeric,0) * resfl::numeric))),
    'rudametall',    case when (c->>'shield')::numeric > 0
                          then greatest(1, round(massix * (c->>'shield')::numeric / 2600)) else 0 end,
    'kristall',      case when c->>'conv' in ('direct','tpv','mhd')
                          then greatest(1, round(massix / 2000)) else 0 end,
    'staarvis',      case when (S->>'pw')::numeric >= 1.35
                          then greatest(1, round(greatest(massix / 3200,
                                     coalesce((CAR->>'refSV')::numeric,0) * resfl::numeric))) else 0 end);

  -- ЦЕНА — от каталожного эталона класса (единой «цены за ⚡» в каталоге нет),
  -- множитель = превышение по мощности × дороговизна схемы относительно
  -- эталонной сборки. Зеркало priceQual/PRICE_QUAL_REF в reactor_gen.js.
  RSC := d->'schools'->(d->'defaults'->>'school');
  RFU := d->'fuels'->(d->'defaults'->>'fuel');
  RCV := d->'conv'->(d->'defaults'->>'conv');
  qual := power(1 + (F->>'q')::double precision, 0.5)
        * power(1 + (CV->>'eff')::double precision * 2, 0.6)
        * power((S->>'capK')::double precision, 0.60);
  qref := power(1 + (RFU->>'q')::double precision, 0.5)
        * power(1 + (RCV->>'eff')::double precision * 2, 0.6)
        * power((RSC->>'capK')::double precision, 0.60);
  price := greatest(100000, round(coalesce((CAR->>'refPrice')::double precision, 20000000)
                * power(pratio, (d->'const'->>'PRICE_EXP')::double precision)
                * qual / qref / 100000)::numeric * 100000);

  -- ЗАКЛАДКА ТОПЛИВА — РАЗОВАЯ, при постройке борта (upkeep-а в игре нет).
  fq := ceil(power_v / ((F->>'q')::numeric * 900) * (F->>'dens')::numeric
             * (1 + (c->>'enrich')::numeric * 0.30));
  if fq > 0 then bill := public._cn_bill_add(bill, F->>'res', fq); end if;
  coolres := L->>'res';
  if coolres is not null then
    cq := ceil(massix * (L->>'mass')::numeric / 4000 * (1 + (c->>'rad')::numeric * 0.5));
    if cq > 0 then bill := public._cn_bill_add(bill, coolres, cq); end if;
  end if;
  if (c->>'shield')::numeric > 0 then
    sq := ceil(massix * (c->>'shield')::numeric / 5000);
    if sq > 0 then bill := public._cn_bill_add(bill, 'Титан', sq); end if;
  end if;

  on_v := greatest(1, least(60, round((0.45 * power(power_v::double precision, 0.36) * 10)::numeric) / 10));

  return jsonb_build_object(
    'ok', true,
    'power', power_v, 'energy', power_v, 'mass', mass_v, 'force', force_v,
    'stab', stab_v, 'sig', sig_v, 'heat', round((ix->>'Q')::numeric, 2),
    -- Нагрузка на шасси в единицах конструктора (500 кг у кораблей, 100 у наземки
    -- и авиации) — зеркало RG.stats.capacityPenalty.
    'capacityPenalty', round(mass_v / greatest(1,(CAR->>'div')::double precision)),
    'capCls', coalesce((CAR->>'cap')::numeric, 0),
    -- Что установка даёт в бою (зеркало RG.stats, считает _reactor_battle_link.sql)
    'tpk', least(1.25, greatest(0.75, 1 + (stab_v - 60) / 200.0)),
    'stealthCut', round(sig_v),
    'eff', round((CV->>'eff')::numeric * 100), 'dens', round(dens::numeric, 3),
    'powRatio', round((power_v / greatest(1,(CAR->>'refPower')::numeric)), 2),
    'modul', modul, 'dviglo', dviglo, 'radar', radar, 'svaz', svaz,
    'capacityBoost', capb, 'resurs', resurs, 'price', price, 'bill', bill, 'on', on_v,
    'schoolAb', S->>'ab', 'fuelRu', F->>'ru', 'convRu', CV->>'ru',
    'coolRu', L->>'ru', 'confRu', N->>'ru', 'klassRu', CAR->>'ru');
end$$;
grant execute on function public._rg_stats(jsonb) to authenticated;

-- Пересчёт уже зарегистрированных установок под новую калибровку.
update public.faction_reactors r
   set stats = public._rg_stats(r.cfg),
       carriers = public._rg_carriers(public._rg_norm(r.cfg), public._rg_stats(r.cfg));

-- Самопроверка зеркал: эталонный корвет = 5200 ⚡ / 17600 кг / 87%% / 20 млн.
do $$
declare st jsonb;
begin
  st := public._rg_stats('{"klass":"corvette"}'::jsonb);
  if (st->>'power')::numeric <> 5200 or (st->>'mass')::numeric <> 17600
     or (st->>'stab')::numeric <> 87 or (st->>'price')::numeric <> 20000000 then
    raise exception 'зеркала разошлись: %', st;
  end if;
  raise notice 'reactor forge: калибровка сошлась';
end$$;
