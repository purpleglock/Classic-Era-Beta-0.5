-- ════════════════════════════════════════════════════════════
-- ОРУЖЕЙНАЯ ВЕРФЬ: КАЛИБРОВКА ЭНЕРГИИ ПО КАТАЛОГУ КВАКВАНТОРА
-- ────────────────────────────────────────────────────────────
-- ПРОБЛЕМА. Энергопотребление своих турелей считалось по своей шкале, ни с чем
-- не сверенной: base[класс] × tech.pw × (урон / урон_эталона)^0.8. У каталожных
-- орудий та же величина лежит в поле `power` и проставлена вручную. Шкалы
-- разошлись на порядок: «Вольфанг» даёт 30233 урона за 1200 ⚡ (40 ⚡ на 1000
-- урона), ланцетное мегаорудие — 29604 за 10037 ⚡ (339). На одном реакторе
-- каталожных стволов помещалось в 6-8 раз больше, и игроки резонно считали
-- верфь бесполезной.
--
-- КАЛИБРОВКА. Логарифмический фит по 53 каталожным орудиям с ненулевым power:
--   корабельные E = 1.145 · урон^0.716   (n=21)
--   наземные     E = 8.615 · урон^0.324  (n=20)
--   авиационные  E = 8.877 · урон^0.191  (n=12)
-- Экспонента 0.8 → 0.716 (корабельный фит; он же взят для наземных классов —
-- наземный 0.32 настолько плоский, что сделал бы крупные наземные турели почти
-- бесплатными, а каталог там сам по себе рыхлый). powerBase каждого класса
-- переставлен в точку каталожной кривой при уроне эталонного орудия этого
-- класса — платформа берётся по первому носителю в classCarriers.
-- Проверка: кинетическая heavy-турель на 30000 урона теперь стоит 1271 ⚡
-- против 1200 ⚡ у «Вольфанга». Остаток разрыва у ланцетного — это премия
-- техники em (pw 2.6), осознанный размен, а не ошибка шкалы.
--
-- ХРАПОВИК (§3). Экспонента вниз удешевляет орудия ВЫШЕ эталона класса и
-- удорожает те, что ниже: без клапана 2 из 19 живых турелей подорожали бы
-- (LRLS-8 213→221, Launcher 8 219→227) и могли уронить публикацию корабля с
-- «энергосеть перегружена». Поэтому существующим строкам пишем
-- least(старая, новая): энергия только падает или стоит. Отсюда же гарантия,
-- что _tg_carriers лишь расширит список носителей, и ни одна турель не слетит
-- с корабля по carriers @> [класс].
-- ⚠️ Храповик живёт в СТРОКЕ, а не в формуле. Пересохранение турели на верфи
-- считает её заново по новой шкале — иначе можно было бы взять дешёвую легаси-
-- строку, накрутить ей урон и остаться на замороженном потреблении.
-- damage / dalnost / mass / price / resurs у существующих строк НЕ трогаем:
-- цена завязана на energy, и её пересчёт удешевил бы задним числом все корабли
-- с этими стволами.
--
-- ЗЕРКАЛО В JS. POWER_BASE и экспонента в turret_gen.js правятся тем же
-- патчем: расхождение JS и SQL здесь означает, что превью на верстаке врёт.
--
-- §4 — попутно закрыт промах гейта энергосети по turretId (детали на месте).
--
-- Порядок применения: ПОСЛЕ _turret_forge.sql, _turret_forge_units.sql,
-- _turret_price_science.sql, _nano_repair.sql (берём их живые определения).
-- ════════════════════════════════════════════════════════════

-- ── §1. Словарь: powerBase по каталожной кривой ──────────────
CREATE OR REPLACE FUNCTION public._tg_dict()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
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
  "powerBase": {"drone":14,"air":22,"apc":36,"aa":31,"tankgun":81,"arty":128,
                "light":70,"medium":126,"heavy":495,"super":862,
                "mg":17,"hw":27,"gl":30,"howitz":144,"rsu":129,"rpu":110,"rocket":140,"brm":242},
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
$function$;

-- ── §2. Полные ТТХ: экспонента энергии 0.8 → 0.716 ──────────
-- Зеркало TG.stats из turret_gen.js. Изменена ровно одна константа; всё
-- остальное — живое определение из _turret_price_science.sql / _nano_repair.sql.
CREATE OR REPLACE FUNCTION public._tg_stats(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  d jsonb := public._tg_dict();
  cfg jsonb := public._tg_norm(p_input);
  T jsonb; K jsonb; R jsonb;
  refCfg jsonb; refC jsonb; C jsonb;
  v_tech text; kls text;
  kal double precision; n double precision;
  rof numeric; mass numeric; damage numeric;
  base double precision; energy numeric; price numeric;
  resurs jsonb; gs numeric := 0; on_ numeric := 1;
  refCal double precision; barrelMatters boolean; dal double precision; dalnost int;
  kind text; billKind text; bill jsonb := '{}'::jsonb;
  heal numeric := 0;
  TG_HEAL_K constant numeric := 0.5;   -- зеркало HEAL_K в turret_gen.js
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
                    / greatest(1,(refC->>'damage')::double precision), 0.716))::numeric));

  price := 55800 * power(kal, 0.402) * power(mass::double precision, 0.157)
         * power((C->>'tC')::double precision * (C->>'cC')::double precision, 0.338)
         * power(1 + energy::double precision, 0.343) / 1.15;
  price := price * power(n, 0.15);
  price := round(price/1000)*1000;

  resurs := jsonb_build_object(
    'blackmetall',   greatest(1, round(mass/900)),
    'coloredmetall', case when v_tech in ('laser','plasma','em') then greatest(1, round(mass/2200)) else 0 end,
    'rudametall',    case when v_tech in ('ehs','kinetic')       then greatest(1, round(mass/1400)) else 0 end,
    'kristall',      case when v_tech in ('laser','plasma')      then greatest(1, round(mass/1800)) else 0 end,
    'staarvis',      case when v_tech in ('rail','em') or kls='super' then greatest(1, round(mass/6000)) else 0 end);

  refCal := coalesce((d->'powerRef'->>kls)::double precision, 130);
  barrelMatters := (T->>'kind') in ('gun','rail');
  dal := coalesce((d->'rangeBase'->>kls)::double precision, 3) * (T->>'dl')::double precision
       * power(kal/refCal, 0.55)
       * (case when barrelMatters
               then power(greatest(10,(cfg->>'barrelLen')::double precision)/50, 0.55) else 1 end)
       * coalesce((d->'rangeLayout'->>public._tg_eff_layout(cfg))::double precision, 1);
  dalnost := greatest(1, least(40, round(dal::numeric)::int));

  gs := greatest(5, round((3.2 * power(damage::double precision, 0.86)
        * power(1 + dalnost::double precision/12, 0.55)
        * power(1 + energy::double precision/400, 0.18))::numeric));
  on_ := greatest(1, least(60, round((0.30*power(damage::double precision,0.42))::numeric, 1)));

  -- КАНАЛ. nano — не боевой: рой не грызёт чужую броню, а латает свой корпус.
  kind := case when v_tech = 'nano' then 'repair'
               when v_tech = 'missile' then 'missile'
               when v_tech in ('laser','plasma') then 'energy' else 'kinetic' end;
  if kind = 'repair' then heal := greatest(1, round(damage * TG_HEAL_K)); end if;

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
    'damage', damage, 'heal', heal, 'price', price, 'gs', gs, 'on', on_, 'bill', bill,
    'mass', mass, 'energy', energy, 'crew', 0, 'dalnost', dalnost,
    'rof', rof, 'caliber', kal, 'barrels', n::int, 'kind', kind,
    'salvo', (C->>'one')::numeric,
    'tC', C->'tC', 'dC', C->'dC', 'cC', C->'cC',
    'resurs', resurs,
    'kvTech', T->>'kvTech', 'kvDmg', T->>'kvDmg', 'kvClass', K->>'kvClass',
    'klassRu', K->>'ru');
end$function$;

-- ── §3. Храповик по существующим турелям ─────────────────────
-- Энергия строки = least(что было, что даёт новая шкала). Дизайны от этого
-- ломаться не могут: свободной мощности у корабля становится только больше.
-- carriers пересчитываем от УЖЕ зажатой энергии — список носителей расширится.
do $mig$
declare
  r record; v_new numeric; v_fin numeric; v_st jsonb;
  n_down int := 0; n_hold int := 0;
begin
  for r in select id, name, cfg, stats from public.faction_turrets loop
    v_new := (public._tg_stats(r.cfg)->>'energy')::numeric;
    v_fin := least(coalesce((r.stats->>'energy')::numeric, v_new), v_new);
    if v_fin >= coalesce((r.stats->>'energy')::numeric, v_fin) then
      n_hold := n_hold + 1;
    else
      n_down := n_down + 1;
    end if;
    v_st := jsonb_set(r.stats, '{energy}', to_jsonb(round(v_fin)));
    update public.faction_turrets
       set stats = v_st,
           carriers = public._tg_carriers(r.cfg, v_st)
     where id = r.id;
  end loop;
  raise notice 'калибровка турелей: подешевело %, зажато храповиком %', n_down, n_hold;
end$mig$;

-- ── §4. Гейт энергосети: резолв своих турелей по turretId ────
CREATE OR REPLACE FUNCTION public._cn_recompute(p_cat text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  cab jsonb := public._cn_catalog();
  db jsonb; defs jsonb; bd jsonb;
  k text; cls jsonb; typeObj jsonb; reactObj jsonb; armorObj jsonb; shieldObj jsonb; engObj jsonb;
  radarObj jsonb; radar_ numeric := 0;
  v_tur public.faction_turrets;          -- своя турель из оружейной верфи
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
  -- wgs — плоская цена своих орудий (оружейная верфь), поверх цены из сырья
  wgs numeric := 0;
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
  -- ── палуба ──
  plate jsonb; pload jsonb; plate_k numeric := 0;   -- plate_k = прибавка HP от навесной брони
  mlist jsonb := '[]'::jsonb;    -- КЛЕТКИ: за них платят сырьём, ГС и экипажем
  clist jsonb := '[]'::jsonb;    -- КОНТУРЫ: они дают боевой эффект (с множителем)
  mk numeric;                    -- множитель отдачи текущего модуля
  n_cell int; bay jsonb; i int;
  kv_pow numeric := 0; kv_cap numeric := 0;         -- остаток энергосети и грузоподъёмности
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

  -- ── ПАЛУБА: разбор раскладки по маске класса ───────────────────────────────
  plate := public._cn_plate_map(k, coalesce(p_data->'layout','{}'::jsonb), db);
  pload := plate->'load';
  plate_k := coalesce((pload->>'hp')::numeric, 0);
  if not coalesce((plate->>'ok')::bool, true) then
    raise exception 'раскладка палубы не сходится: % узлов вне обшивки или внахлёст',
      jsonb_array_length(plate->'bad');
  end if;

  -- СОСТАВ МОДУЛЕЙ. Решётка главнее плоского списка — иначе в modules можно
  -- заплатить за три коробки, а в bays поставить тридцать.
  if coalesce((plate->>'legacy')::bool, false) or coalesce((plate->>'w')::int,0) = 0 then
    -- легаси: коробки поштучно, синергии нет — каждая сама себе контур
    for m in select * from jsonb_array_elements(coalesce(p_data->'modules','[]'::jsonb)) loop
      mlist := mlist || jsonb_build_array(jsonb_build_object('g', m->>'g', 'idx', (m->>'idx')::int, 'k', 1));
    end loop;
    clist := mlist;
  else
    n_cell := (plate->>'w')::int * (plate->>'h')::int;
    for i in 0..n_cell-1 loop
      bay := p_data->'layout'->'bays'->i;
      continue when bay is null or bay = 'null'::jsonb or (bay->>'g') is null;
      mlist := mlist || jsonb_build_array(jsonb_build_object(
        'g', bay->>'g', 'idx', (bay->>'idx')::int,
        'k', coalesce((plate->'kcell'->>i)::numeric, 1)));
    end loop;
    clist := plate->'conts';
  end if;
  -- ПОТОЛОК СЛОТОВ (страховка от прямой записи; форму держит маска палубы)
  if jsonb_array_length(mlist) > public._cn_mod_slots(k) then
    raise exception 'модулей больше предела класса: % при потолке %',
      jsonb_array_length(mlist), public._cn_mod_slots(k);
  end if;

  -- ЦЕНА: собираем конструкционные решения (resurs) с корпуса и компонентов,
  -- итог считаем через _cn_kv_cost. Млн-прайсы Кваквантора в цену НЕ идут.
  kvres := public._cn_res_add(kvres, cls, 1);
  kvres := public._cn_res_add(kvres, reactObj, 1);
  kvres := public._cn_res_add(kvres, engObj, 1);
  -- навесные плиты = то же сырьё брони, что и основное бронирование (зеркало клиента)
  kvres := public._cn_res_add(kvres, armorObj, 1 + plate_k);
  kvres := public._cn_res_add(kvres, shieldObj, 1);
  kvres := public._cn_res_add(kvres, radarObj, 1);
  if hasEnergy then econs := coalesce((shieldObj->>'energy')::numeric,0) + coalesce((engObj->>'energy')::numeric,0); end if;

  -- оружие
  for w in select * from jsonb_array_elements(coalesce(p_data->'weapons','[]'::jsonb)) loop
    q := greatest(0, coalesce((w->>'q')::int,1));
    -- ⚠ орудия оружейной верфи ({turretId}) в каталоге Кваквантора не лежат —
    -- резолв только через _cn_wpn_obj, иначе свой ствол = 'bad weapon'
    wob := public._cn_wpn_obj(db, k, w);
    kvres := public._cn_res_add(kvres, wob, q); on_ := on_ + q * modon;
    wgs := wgs + coalesce((wob->>'_gs')::numeric, 0) * q;
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
  for m in select * from jsonb_array_elements(mlist) loop
    mob := db->'modules'->(m->>'g')->coalesce((m->>'idx')::int,-1);
    if mob is null then raise exception 'bad module'; end if;
    kvres := public._cn_res_add(kvres, mob, 1); on_ := on_ + modon;
    if hasEnergy then econs := econs + coalesce((mob->>'energy')::numeric,0); end if;
    bill := public._cn_bill_add(bill,'Железо',              coalesce((mob->'resurs'->>'blackmetall')::numeric,0)/20);
    bill := public._cn_bill_add(bill,'Медь',                coalesce((mob->'resurs'->>'coloredmetall')::numeric,0)/20);
    bill := public._cn_bill_add(bill,'Титан',               coalesce((mob->'resurs'->>'rudametall')::numeric,0)/20);
    bill := public._cn_bill_add(bill,'Редкоземельные руды', coalesce((mob->'resurs'->>'kristall')::numeric,0)/20);
    bill := public._cn_bill_add(bill,'Стелларит',           coalesce((mob->'resurs'->>'staarvis')::numeric,0)/20);
  end loop;

  -- ── БОЕВЫЕ ЭФФЕКТЫ: ПО КОНТУРАМ, С МНОЖИТЕЛЕМ РАССТАНОВКИ ────────────────────
  -- ⚠️ ЗДЕСЬ И ЕСТЬ ВЕСЬ СМЫСЛ РАСКЛАДКИ. Раньше сервер складывал combat по
  -- КЛЕТКАМ и без множителя: место на палубе не решало ничего, а панель верфи
  -- показывала другое число. Считаем как панель — на контур, ×k (соседство,
  -- форма, разбавление, усилители). Суммируемое масштабируется, у РЭБ и
  -- контр-РЭБ берётся максимум: там сильнее не сумма, а лучший излучатель.
  for m in select * from jsonb_array_elements(clist) loop
    mob := db->'modules'->(m->>'g')->coalesce((m->>'idx')::int,-1);
    if mob is null then raise exception 'bad module'; end if;
    mk := coalesce((m->>'k')::numeric, 1);
    mod_pd      := mod_pd      + coalesce((mob->'combat'->>'pd')::numeric,0) * mk;
    mod_jam     := greatest(mod_jam, round(coalesce((mob->'combat'->>'jam')::numeric,0) * mk)::int);
    mod_stealth := mod_stealth + round(coalesce((mob->'combat'->>'stealth')::numeric,0) * mk)::int;
    mod_sensor  := mod_sensor  + round(coalesce((mob->'combat'->>'sensor')::numeric,0) * mk)::int;
    mod_hangar  := mod_hangar  + coalesce((mob->'combat'->>'hangar')::numeric,0) * mk;
    mod_dejam   := greatest(mod_dejam, round(coalesce((mob->'combat'->>'dejam')::numeric,0) * mk)::int);
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
  -- навесная лента добавляет к прочности ровно столько, сколько заняла клеток
  hp := round(public._cn_kv_armor_hp(cls, armorObj) * (1 + plate_k));
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
  for m in select * from jsonb_array_elements(mlist) loop
    mob := db->'modules'->(m->>'g')->coalesce((m->>'idx')::int,-1);
    if mob is not null then crew := crew + coalesce((mob->>'crewRequired')::numeric,0); end if;
  end loop;
  if hasEnergy and econs > emax then raise exception 'energy overload'; end if;

  -- ── ЭНЕРГОСЕТЬ И ГРУЗОПОДЪЁМНОСТЬ: ЖЁСТКИЙ ГЕЙТ (зеркало kv.power / kv.cap) ──
  -- Это единственное, что не даёт навесить на корвет линкорную батарею: не
  -- «предупреждение на верфи», а отказ публикации. Железо палубы тоже висит на
  -- реакторе и в трюме — иначе узлы и плиты ставились бы бесплатно.
  kv_pow := coalesce((reactObj->>'power')::numeric,0)
          - coalesce((engObj->>'power')::numeric,0)
          - coalesce((shieldObj->>'power')::numeric,0)
          - coalesce((radarObj->>'power')::numeric,0)
          - coalesce((pload->>'energy')::numeric,0);
  kv_cap := coalesce((cls->>'capacity')::numeric,0)
          + coalesce((armorObj->>'capacityBoost')::numeric,0)
          + coalesce((engObj->>'capacityBoost')::numeric,0)
          - coalesce((radarObj->>'capacityPenalty')::numeric,0)
          - coalesce((pload->>'mass')::numeric,0);
  for w in select * from jsonb_array_elements(coalesce(p_data->'weapons','[]'::jsonb)) loop
    q := greatest(0, coalesce((w->>'q')::int,1));
    if nullif(w->>'turretId','') is not null then
      -- СВОЯ ТУРЕЛЬ. Записи вида {turretId,q} не лежат в db->'weapons', и старый
      -- резолв по g/idx промахивался: орудие с верфи не отнимало у гейта ни ⚡,
      -- ни трюма. Клиент (cnTurretToWeapon) их считал всегда, так что дизайн,
      -- прошедший верфь, гейт проходит тоже — это закрытие дыры, не ужесточение.
      select * into v_tur from public.faction_turrets where id = (w->>'turretId')::uuid;
      if found then
        kv_pow := kv_pow - coalesce((v_tur.stats->>'energy')::numeric,0) * q;
        -- зеркало CN_LOAD_DIV: ship 500, всё остальное 100
        kv_cap := kv_cap - round(coalesce((v_tur.stats->>'mass')::numeric,0)
                                 / case when p_cat = 'ship' then 500 else 100 end) * q;
      end if;
    else
      wob := db->'weapons'->(w->>'g')->coalesce((w->>'idx')::int,-1);
      if wob is not null then
        kv_pow := kv_pow - coalesce((wob->>'power')::numeric,0) * q;
        kv_cap := kv_cap - coalesce((wob->>'capacityPenalty')::numeric,0) * q;
      end if;
    end if;
  end loop;
  for m in select * from jsonb_array_elements(mlist) loop
    mob := db->'modules'->(m->>'g')->coalesce((m->>'idx')::int,-1);
    if mob is not null then
      kv_pow := kv_pow - coalesce((mob->>'power')::numeric,0);
      kv_cap := kv_cap + coalesce((mob->>'capacity')::numeric,0);
    end if;
  end loop;
  if round(kv_pow) < 0 then
    raise exception 'энергосеть перегружена: не хватает % ⚡ — нужен мощнее реактор', -round(kv_pow);
  end if;
  if round(kv_cap) < 0 then
    raise exception 'превышена грузоподъёмность: перегруз % — снимите оснастку', -round(kv_cap);
  end if;

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

  -- Железо палубы (башни, погоны, приводы, плиты) стоит своих ГС и своего сырья —
  -- ⚠️ иначе разводка выходит бесплатной: ставь сколько влезет.
  if coalesce((pload->>'gs')::numeric,0) > 0 then
    bill := public._cn_bill_add(bill,'Железо', (pload->>'gs')::numeric / 40);
    bill := public._cn_bill_add(bill,'Титан',  (pload->>'gs')::numeric / 120);
  end if;

  -- Итоговая цена ГС из конструкционных решений (зеркало cnKvCost).
  cost := public._cn_kv_cost(kvres, k) + coalesce((pload->>'gs')::numeric,0) + wgs;

  return jsonb_build_object(
    'cost', cost, 'on', round(on_,1), 'hp', hp, 'armor', armor, 'shield', shield,
    'dmg', dmg, 'speed', speed, 'crew', crew, 'radar', radar_, 'rng', rng, 'speedUnit', 'квадрат',
    'eCons', econs, 'eMax', emax, 'energy', hasEnergy,
    'cargo', cargo, 'bill', bill,
    -- разводка палубы и остатки бюджетов: чтобы карточка показывала то же, что верфь
    'deck', pload, 'kvPower', round(kv_pow), 'kvCap', round(kv_cap),
    'armor_resist', armor_resist,   -- стойкости брони к типам урона (для боёвки)
    -- боевые эффекты модулей: ПРО (кап 0.6), РЭБ (радиус 5), маскировка, сенсор, авиакрылья
    'mods', jsonb_build_object(
      'pd', least(0.6, mod_pd), 'jam', mod_jam, 'stealth', mod_stealth,
      'sensor', mod_sensor, 'hangar', mod_hangar,
      'dejam', mod_dejam, 'interdict', mod_interdict, 'stabil', mod_stabil,
      'ftl', mod_ftl,
      'eccm', radar_eccm),
    'className', cls->>'name', 'typeName', coalesce(typeObj->>'name',''));
end$function$;
