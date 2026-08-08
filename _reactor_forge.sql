-- ════════════════════════════════════════════════════════════
-- РЕАКТОРНАЯ ВЕРФЬ — серверное зеркало движка reactor_gen.js
-- ────────────────────────────────────────────────────────────
-- Таблица кастомных реакторов фракций + RLS + RPC (SECURITY DEFINER),
-- пересчитывающие ТТХ АВТОРИТЕТНО из конфига (клиентским цифрам не
-- доверяем — см. client-write RLS-дыра). _cn_recompute (в _unit_publish.sql)
-- и _cn_deck_recompute при публикации юнита резолвят data.reactorId →
-- выработку/массу/силу/слоты отсюда.
--
-- ВНИМАНИЕ: числа ДОЛЖНЫ совпадать с reactor_gen.js. Менял там — правь тут.
-- В конце файла — самопроверка: если зеркала разошлись, накат падает.
-- Порядок применения: этот файл ДО _reactor_forge_units.sql.
-- ════════════════════════════════════════════════════════════

-- ── §0. Справочники (зеркало reactor_gen.js §1–§3) ───────────
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
    "peh":             {"ru":"Пехота","refPower":160,"refForce":100,"massCap":60,"cap":10,"div":100},
    "dron":            {"ru":"Дрон","refPower":400,"refForce":120,"massCap":20,"cap":6,"div":100},
    "dronkos":         {"ru":"БПЛА (косм.)","refPower":400,"refForce":120,"massCap":30,"cap":6,"div":100},
    "btr":             {"ru":"БТР / БМП","refPower":800,"refForce":300,"massCap":1800,"cap":70,"div":100},
    "tanki":           {"ru":"Танк","refPower":3600,"refForce":260,"massCap":6000,"cap":130,"div":100},
    "arta":            {"ru":"Артиллерия","refPower":3600,"refForce":29,"massCap":1400,"cap":160,"div":100},
    "aviacia":         {"ru":"Атм. авиация","refPower":4800,"refForce":250,"massCap":3300,"cap":80,"div":100},
    "vertihui":        {"ru":"Вертолёт","refPower":5200,"refForce":110,"massCap":2100,"cap":100,"div":100},
    "mla":             {"ru":"Звездолёт","refPower":3600,"refForce":80,"massCap":4000,"cap":80,"div":100},
    "corvette":        {"ru":"Корвет","refPower":5200,"refForce":140,"massCap":32000,"cap":250,"div":500},
    "destroyer":       {"ru":"Эсминец","refPower":10000,"refForce":180,"massCap":48000,"cap":400,"div":500},
    "supportCarrier":  {"ru":"Авианосец подд.","refPower":5600,"refForce":80,"massCap":40000,"cap":600,"div":500},
    "mediumCruiser":   {"ru":"Средний крейсер","refPower":22000,"refForce":250,"massCap":105000,"cap":700,"div":500},
    "hyperCruiser":    {"ru":"Факельщик","refPower":30000,"refForce":250,"massCap":90000,"cap":600,"div":500},
    "multiroleCarrier":{"ru":"Многоцел. авианосец","refPower":40000,"refForce":100,"massCap":105000,"cap":5500,"div":500},
    "battleship":      {"ru":"Линкор","refPower":52000,"refForce":100,"massCap":180000,"cap":1200,"div":500},
    "dreadnought":     {"ru":"Дредноут","refPower":82000,"refForce":25,"massCap":250000,"cap":1800,"div":500},
    "ss13":            {"ru":"СС-13 (станция)","refPower":160000,"refForce":60,"massCap":240000,"cap":1000,"div":500}
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
  "const": {"CAP_RATIO":3.00,"PW_EXP":0.72,"MASS_EXP":0.85,"MASS_REST":0.55,"STAB_MIN":15},
  "defaults": {"klass":"corvette","school":"yaeu","fuel":"iso","conv":"brayton","cool":"metal",
               "conf":"none","size":1,"cores":2,"enrich":2,"temp":1,"rad":1,"shield":1,"damp":0.3,
               "seed":1337,"detail":0.6,"tint":"#2b3138","accent":"#e8a93f"}
}$j$::jsonb
$$;
grant execute on function public._rg_dict() to authenticated;

-- ── §1. Нормализация (зеркало RG.normalize) ──────────────────
create or replace function public._rg_norm(p_in jsonb)
returns jsonb language plpgsql immutable as $$
declare
  d jsonb := public._rg_dict();
  c jsonb := coalesce(d->'defaults','{}'::jsonb) || coalesce(p_in,'{}'::jsonb);
  S jsonb; k text; lim jsonb; v numeric;
begin
  if not (d->'carriers') ? (c->>'klass') then c := jsonb_set(c,'{klass}','"corvette"'); end if;
  if not (d->'schools')  ? (c->>'school') then c := jsonb_set(c,'{school}','"yaeu"');  end if;
  -- Школа обязана быть уместной для класса — это ограничение первично.
  if not (coalesce(d->'schoolCarriers'->(c->>'school'),'[]'::jsonb) ? (c->>'klass')) then
    select jsonb_set(c,'{school}', to_jsonb(s.key)) into c
      from jsonb_each(d->'schools') s
     where d->'schoolCarriers'->s.key ? (c->>'klass')
     order by (s.value->>'capK')::numeric
     limit 1;
    if not (d->'schools') ? (c->>'school') then c := jsonb_set(c,'{school}','"ritag"'); end if;
  end if;
  S := d->'schools'->(c->>'school');
  if not (S->'fuels') ? (c->>'fuel') then c := jsonb_set(c,'{fuel}', S->'fuels'->0); end if;
  if not (S->'conv')  ? (c->>'conv') then c := jsonb_set(c,'{conv}', S->'conv'->0);  end if;
  if not (S->'conf')  ? (c->>'conf') then c := jsonb_set(c,'{conf}', S->'conf'->0);  end if;
  if not (d->'cool')  ? (c->>'cool') then c := jsonb_set(c,'{cool}','"gas"'); end if;
  -- Пассивный теплоотвод физически не тянет ничего мощнее РИТЭГа.
  if c->>'cool' = 'passive' and c->>'school' <> 'ritag' then c := jsonb_set(c,'{cool}','"gas"'); end if;

  foreach k in array array['size','cores','enrich','temp','rad','shield','damp','detail','seed'] loop
    lim := d->'limits'->k;
    v := coalesce(nullif(c->>k,'')::numeric, (d->'defaults'->>k)::numeric);
    v := greatest((lim->>0)::numeric, least((lim->>1)::numeric, v));
    if k in ('cores','seed') then v := round(v); end if;
    c := jsonb_set(c, array[k], to_jsonb(v));
  end loop;
  if coalesce(c->>'tint','')   = '' then c := jsonb_set(c,'{tint}',   d->'defaults'->'tint');   end if;
  if coalesce(c->>'accent','') = '' then c := jsonb_set(c,'{accent}', d->'defaults'->'accent'); end if;
  c := c - 'yaw';
  return c;
end$$;
grant execute on function public._rg_norm(jsonb) to authenticated;

-- ── §2. Индексы сборки (зеркало RG.index) ────────────────────
-- E — «сколько тока», M — «сколько железа». Оба безразмерные и сравниваются
-- с эталоном; в абсолютные ⚡ и кг их переводит класс-носитель.
create or replace function public._rg_index(p_cfg jsonb)
returns jsonb language plpgsql immutable as $$
declare
  d jsonb := public._rg_dict(); c jsonb := p_cfg;
  S jsonb; F jsonb; CV jsonb; L jsonb; N jsonb;
  V double precision; Q double precision; E double precision; M double precision;
begin
  S := d->'schools'->(c->>'school'); F := d->'fuels'->(c->>'fuel');
  CV := d->'conv'->(c->>'conv');      L := d->'cool'->(c->>'cool');
  N := d->'conf'->(c->>'conf');
  V := power((c->>'size')::double precision, 1.9) * power((c->>'cores')::double precision, 0.70);
  Q := (S->>'pw')::double precision * (F->>'q')::double precision
     * power((c->>'enrich')::double precision, 0.40)
     * power((c->>'temp')::double precision, 1.05)
     * (N->>'pw')::double precision * V;
  E := Q * (CV->>'eff')::double precision * (1 - 0.10 * (c->>'damp')::double precision);
  M := (S->>'massK')::double precision
     * power((c->>'size')::double precision, 2.4)
     * power((c->>'cores')::double precision, 0.90)
     * (CV->>'mass')::double precision * (L->>'mass')::double precision * (N->>'mass')::double precision
     * (1 + (c->>'shield')::double precision * 0.55)
     * (1 + (c->>'rad')::double precision * 0.30)
     * power((c->>'temp')::double precision, 0.45);
  return jsonb_build_object('Q', Q, 'E', E, 'M', M);
end$$;
grant execute on function public._rg_index(jsonb) to authenticated;

-- Индексы ЭТАЛОННОЙ сборки (RG.REF_IX): считаются из тех же справочников,
-- поэтому расходиться с клиентом не могут по построению.
create or replace function public._rg_ref()
returns jsonb language sql immutable as $$
  select public._rg_index(public._rg_norm(
    '{"klass":"corvette","school":"yaeu","fuel":"iso","conv":"brayton","cool":"metal",
      "conf":"none","size":1,"cores":2,"enrich":2,"temp":1,"rad":1,"shield":1,"damp":0.3}'::jsonb))
$$;

-- Потолок выработки: заводской максимум класса, поджатый потолком школы.
create or replace function public._rg_power_cap(p_klass text, p_school text)
returns numeric language sql immutable as $$
  select round(coalesce((public._rg_dict()->'carriers'->p_klass->>'refPower')::numeric, 5200)
             * least((public._rg_dict()->'const'->>'CAP_RATIO')::numeric,
                     coalesce((public._rg_dict()->'schools'->p_school->>'capK')::numeric, 1.90)))
$$;
grant execute on function public._rg_power_cap(text,text) to authenticated;

-- ── §3. Полные ТТХ (зеркало RG.stats) ────────────────────────
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
begin
  S := d->'schools'->(c->>'school'); F := d->'fuels'->(c->>'fuel');
  CV := d->'conv'->(c->>'conv');      L := d->'cool'->(c->>'cool');
  N := d->'conf'->(c->>'conf');      CAR := d->'carriers'->(c->>'klass');

  eR := (ix->>'E')::double precision / (rf->>'E')::double precision;
  mR := (ix->>'M')::double precision / (rf->>'M')::double precision;

  power_v := greatest(1, round((CAR->>'refPower')::double precision
             * power(eR, (d->'const'->>'PW_EXP')::double precision))::numeric);
  mass_v := greatest(1, round((CAR->>'massCap')::double precision
             * (d->'const'->>'MASS_REST')::double precision
             * power(mR, (d->'const'->>'MASS_EXP')::double precision))::numeric);
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

  resurs := jsonb_build_object(
    'blackmetall',   greatest(1, round(mass_v / 700)),
    'coloredmetall', greatest(1, round(mass_v / 1500 * (1 + (c->>'rad')::numeric))),
    'rudametall',    case when (c->>'shield')::numeric > 0
                          then greatest(1, round(mass_v * (c->>'shield')::numeric / 2600)) else 0 end,
    'kristall',      case when c->>'conv' in ('direct','tpv','mhd')
                          then greatest(1, round(mass_v / 2000)) else 0 end,
    'staarvis',      case when (S->>'pw')::numeric >= 1.35
                          then greatest(1, round(mass_v / 3200)) else 0 end);

  price := round(9200 * power(power_v::double precision, 0.62)
                * power(1 + (F->>'q')::double precision, 0.5)
                * power(1 + (CV->>'eff')::double precision * 2, 0.6) / 1000)::numeric * 1000;

  -- ЗАКЛАДКА ТОПЛИВА — РАЗОВАЯ, при постройке борта (upkeep-а в игре нет).
  fq := ceil(power_v / ((F->>'q')::numeric * 900) * (F->>'dens')::numeric
             * (1 + (c->>'enrich')::numeric * 0.30));
  if fq > 0 then bill := public._cn_bill_add(bill, F->>'res', fq); end if;
  coolres := L->>'res';
  if coolres is not null then
    cq := ceil(mass_v * (L->>'mass')::numeric / 4000 * (1 + (c->>'rad')::numeric * 0.5));
    if cq > 0 then bill := public._cn_bill_add(bill, coolres, cq); end if;
  end if;
  if (c->>'shield')::numeric > 0 then
    sq := ceil(mass_v * (c->>'shield')::numeric / 5000);
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

-- ── §4. Приёмка носителем (зеркало RG.fit) ───────────────────
-- Отдачи на ходовую среди ворот нет: она насыщается на потолке (см. §3).
create or replace function public._rg_fit(p_cfg jsonb, p_stats jsonb)
returns text language plpgsql immutable as $$
declare
  d jsonb := public._rg_dict();
  CAR jsonb := d->'carriers'->(p_cfg->>'klass');
  pcap numeric := public._rg_power_cap(p_cfg->>'klass', p_cfg->>'school');
  why text[] := '{}';
begin
  if (p_stats->>'power')::numeric > pcap then
    why := why || format('выработка %s ⚡ при потолке схемы %s', p_stats->>'power', pcap);
  end if;
  if (p_stats->>'mass')::numeric > (CAR->>'massCap')::numeric then
    why := why || format('масса %s кг при лимите %s', p_stats->>'mass', CAR->>'massCap');
  end if;
  if (p_stats->>'stab')::numeric < (d->'const'->>'STAB_MIN')::numeric then
    why := why || format('запас устойчивости %s%% ниже допустимых %s%%',
                         p_stats->>'stab', d->'const'->>'STAB_MIN');
  end if;
  return array_to_string(why, '; ');
end$$;
grant execute on function public._rg_fit(jsonb,jsonb) to authenticated;

-- Классы-носители установки: ровно тот, под который она спроектирована,
-- и только если прошла приёмку. Массив — ради совместимости с проводкой
-- конструктора (та же форма, что carriers у faction_turrets).
create or replace function public._rg_carriers(p_cfg jsonb, p_stats jsonb)
returns text[] language sql immutable as $$
  select case when public._rg_fit(p_cfg, p_stats) = ''
              then array[p_cfg->>'klass'] else '{}'::text[] end
$$;
grant execute on function public._rg_carriers(jsonb,jsonb) to authenticated;

-- ── §5. Таблица ──────────────────────────────────────────────
create table if not exists public.faction_reactors (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid(),
  faction_id    text,
  faction_name  text,
  faction_color text,
  name          text not null,
  cfg           jsonb not null default '{}'::jsonb,   -- нормализованный конфиг верстака
  stats         jsonb not null default '{}'::jsonb,   -- ТТХ, посчитанные сервером
  carriers      text[] not null default '{}',         -- класс(ы), которые принимают
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_freac_faction on public.faction_reactors(faction_id);
create index if not exists idx_freac_owner   on public.faction_reactors(owner_id);

alter table public.faction_reactors enable row level security;

drop policy if exists freac_select on public.faction_reactors;
create policy freac_select on public.faction_reactors for select using (
  faction_id is null
  or owner_id = auth.uid()
  or faction_id = public._ec_my_fid_opt()
  or public.current_user_role() in ('superadmin','editor')
);
-- Прямой DML запрещён — только через RPC ниже.
revoke insert, update, delete on public.faction_reactors from authenticated, anon;

-- ── §6. RPC upsert ───────────────────────────────────────────
create or replace function public.reactor_upsert(
  p_reactor_id uuid, p_name text, p_cfg jsonb,
  p_faction_id text, p_faction_name text, p_faction_color text
) returns public.faction_reactors language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_cfg jsonb; v_st jsonb; v_car text[]; v_why text;
  row public.faction_reactors;
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

  v_cfg := public._rg_norm(coalesce(p_cfg,'{}'::jsonb));
  v_st  := public._rg_stats(v_cfg);
  v_why := public._rg_fit(v_cfg, v_st);
  if v_why <> '' then raise exception 'установку не примет носитель: %', v_why; end if;
  v_car := public._rg_carriers(v_cfg, v_st);

  if p_reactor_id is null then
    insert into public.faction_reactors(owner_id, faction_id, faction_name, faction_color,
                                        name, cfg, stats, carriers)
    values (uid, p_faction_id, p_faction_name, p_faction_color, left(p_name,48), v_cfg, v_st, v_car)
    returning * into row;
  else
    update public.faction_reactors
       set name = left(p_name,48), cfg = v_cfg, stats = v_st, carriers = v_car,
           faction_name  = coalesce(p_faction_name, faction_name),
           faction_color = coalesce(p_faction_color, faction_color),
           updated_at = now()
     where id = p_reactor_id
       and (owner_id = uid or staff or (faction_id is not null and faction_id = my_fid))
    returning * into row;
    if row.id is null then raise exception 'reactor not found or forbidden'; end if;
  end if;
  return row;
end;
$$;

-- ── §7. RPC delete ───────────────────────────────────────────
-- Сироты дизайнов: реактор мог быть вписан в опубликованный юнит. Публикация
-- пересчитывается на сервере по reactorId, поэтому удаление установки,
-- которая где-то стоит, запрещаем — иначе юнит станет непересчитываемым
-- (та же грабля, что с удалением орудий верфи).
create or replace function public.reactor_delete(p_reactor_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
  staff boolean := public.current_user_role() in ('superadmin','editor');
  my_fid text := public._ec_my_fid_opt();
  used int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select count(*) into used from public.faction_units u
   where u.data->>'reactorId' = p_reactor_id::text;
  if used > 0 then
    raise exception 'установка стоит на % опубликованных проектах — сначала снимите её', used;
  end if;
  delete from public.faction_reactors
   where id = p_reactor_id
     and (owner_id = uid or staff or (faction_id is not null and faction_id = my_fid));
end;
$$;

grant execute on function public.reactor_upsert(uuid,text,jsonb,text,text,text) to authenticated;
grant execute on function public.reactor_delete(uuid) to authenticated;

-- ── §8. Объект реактора для публикации юнита ─────────────────
-- Строка faction_reactors → объект в форме каталожного реактора (те же поля,
-- что читают _cn_recompute и cnVehCalc). Зеркало cnReactorToObj в клиенте.
create or replace function public._cn_reac_obj(p_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'name',   '⚛ ' || r.name,
    'cost',   coalesce((r.stats->>'price')::numeric, 0),
    'price',  coalesce((r.stats->>'price')::numeric, 0),
    'energy', coalesce((r.stats->>'power')::numeric, 0),
    'power',  coalesce((r.stats->>'power')::numeric, 0),
    'force',  coalesce((r.stats->>'force')::numeric, 1),
    'weight', coalesce((r.stats->>'mass')::numeric, 0),
    'modul',  coalesce((r.stats->>'modul')::numeric, 1),
    'dviglo', coalesce((r.stats->>'dviglo')::numeric, 1),
    'radar',  coalesce((r.stats->>'radar')::numeric, 1),
    'svaz',   coalesce((r.stats->>'svaz')::numeric, 1),
    'capacityBoost', coalesce((r.stats->>'capacityBoost')::numeric, 0),
    -- Своя установка грузит шасси (зеркало cnReactorToObj); у каталожных поля нет.
    'capacityPenalty', coalesce((r.stats->>'capacityPenalty')::numeric, 0),
    'crewRequired', 0,
    'visibility', coalesce((r.stats->>'sig')::numeric, 0),
    'resurs', coalesce(r.stats->'resurs', '{}'::jsonb),
    -- Своя топливная ведомость: у каталожных реакторов её нет (там изотопы и
    -- гелий считаются от энергии через bd.reIso/reHe), у своих — считана верфью.
    '_fuelBill', coalesce(r.stats->'bill', '{}'::jsonb),
    '_reactorId', r.id,
    '_klass', r.cfg->>'klass')
  from public.faction_reactors r where r.id = p_id
$$;
grant execute on function public._cn_reac_obj(uuid) to authenticated;

-- ── §9. Самопроверка зеркал ──────────────────────────────────
-- Эталонная сборка обязана давать ровно то же, что reactor_gen.js. Числа
-- ниже сняты с клиентского движка; расходятся — значит правку внесли
-- только в одно зеркало, и накат должен упасть здесь, а не в бою.
do $$
declare st jsonb;
begin
  st := public._rg_stats('{"klass":"corvette"}'::jsonb);
  if (st->>'power')::numeric <> 5200 then
    raise exception 'зеркала разошлись: эталонная выработка % (ожидалось 5200)', st->>'power';
  end if;
  if (st->>'mass')::numeric <> 17600 then
    raise exception 'зеркала разошлись: эталонная масса % (ожидалось 17600)', st->>'mass';
  end if;
  if (st->>'stab')::numeric <> 87 then
    raise exception 'зеркала разошлись: эталонная устойчивость % (ожидалось 87)', st->>'stab';
  end if;
  if public._rg_power_cap('dreadnought','amu') <> 229600 then
    raise exception 'зеркала разошлись: потолок АМУ на дредноуте %', public._rg_power_cap('dreadnought','amu');
  end if;
  raise notice 'reactor forge: зеркала сошлись (эталон 5200 ⚡ / 17600 кг / 87%%)';
end$$;
