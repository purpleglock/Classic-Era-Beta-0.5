// © 2025–2026. Проприетарное ПО. См. LICENSE.
// ════════════════════════════════════════════════════════════
// REACTOR GEN v1 — процедурный визуализатор и расчётчик реакторов
// ────────────────────────────────────────────────────────────
// Полный аналог turret_gen.js, только для энергетики. Реактор в игре —
// это НЕ «уровень 1..5» из каталога, а конфигурация установки: школа
// (РИТЭГ/ЯЭУ/ТЯР/МГД/АМУ/КВГ), топливо из настоящих ресурсов державы,
// теплоноситель, схема преобразования (тот самый КПД), удержание,
// радиаторы, биозащита и регулирование.
//
// ЧТО СЧИТАЕТСЯ (§5 stats):
//   power  — выработка ⚡ (главный параметр, идёт в энергосеть проекта)
//   mass   — масса установки (решает, в какой корпус влезет)
//   force  — «сила реактора» из формулы скорости KV (удельная мощность)
//   stab   — запас устойчивости, %; ниже RG.STAB_MIN реактор не регистрируется
//   sig    — тепловая сигнатура (заметность борта в бою)
//   bill   — РАЗОВАЯ закладка топлива со склада державы при постройке
//            (рекуррентного содержания в игре нет — см. project-architecture)
//   resurs — конструкционное сырьё в KV-номенклатуре (идёт в цену ГС)
//   modul/dviglo/radar/svaz/capacityBoost — те же поля, что у каталожных
//            реакторов: конструктор читает их как потолки слотов.
//
// ПОТОЛОК МОЩНОСТИ. Установка проектируется под КОНКРЕТНЫЙ класс-носитель
// (cfg.klass), и её выработка считается от эталона этого класса — максимума
// КАТАЛОЖНЫХ реакторов (CARRIERS.refPower). Регистрация проходит, пока
// power ≤ refPower × RG.CAP_RATIO. CAP_RATIO = 3.0: удачная сборка на высшей
// школе даёт до трёх заводских, обычная рабочая — +50–100%. Прежние +50% были
// смешным потолком: игрок упирался в него на середине первого же ползунка.
// Хочешь другой баланс — крути CAP_RATIO (и зеркало в SQL).
//
// ⚠ ЗА ПОТОЛОК НЕ ПУСКАЮТ ПОЛЗУНКИ, А НЕ ПЛАШКА. Пределы каждого ползунка
// считаются от приёмки живьём (§6б sliderRange), а смена класса/школы
// протаскивает сборку внутрь допустимого (§6б tame). Красная плашка осталась
// как страховка на случай сборки, которую не спасти ни одним ходом.
//
// ⚠ ЗЕРКАЛО НА СЕРВЕРЕ: _reactor_forge.sql (_rg_*). Правил тут — правь там.
// Экспорт: window.RG
// ════════════════════════════════════════════════════════════
window.RG = (function () {
'use strict';

// ── §1. Справочники ──────────────────────────────────────────

// ШКОЛЫ. pw — удельный выход схемы, massK — «металлоёмкость», stab — базовый
// запас устойчивости, forceK — отдача на ходовую, sig — тепловая заметность.
// fuels/conv/conf — что физически применимо к этой школе.
//
// capK — ПОТОЛОК ШКОЛЫ относительно заводского максимума класса. Это главная
// ручка «сколько можно выжать»: РИТЭГ едва превосходит заводской (1.20), ЯЭУ
// даёт уверенные +90%, а тройной запас берут только высшие школы — и только
// удачной сборкой, потому что упереться в потолок ещё надо суметь. Настоящий потолок = refPower × min(CAP_RATIO, capK).
const SCHOOLS = {
  ritag: {
    ab: 'РИТЭГ', ru: 'Радиоизотопный термоэлектрический генератор',
    pw: 0.45, massK: 0.70, stab: 92, forceK: 0.80, capK: 1.20, sig: 0.35, glow: '#ffb066',
    fuels: ['iso', 'exo', 'degen'],
    conv:  ['seebeck', 'tpv', 'stirling'],
    conf:  ['none'],
    lore: 'Распад изотопа греет спай, спай даёт ток. Ни насосов, ни турбин, ни аварий — только медленно тающая мощность.',
  },
  yaeu: {
    ab: 'ЯЭУ', ru: 'Ядерная энергоустановка (деление)',
    pw: 1.00, massK: 1.00, stab: 62, forceK: 1.00, capK: 1.90, sig: 0.75, glow: '#86c25c',
    fuels: ['iso', 'therm', 'exo'],
    conv:  ['rankine', 'brayton', 'tpv', 'seebeck'],
    conf:  ['none', 'damped'],
    lore: 'Управляемая цепная реакция в тепловыделяющих сборках. Всё решает теплосъём: остановишь контур — расплавишь зону.',
  },
  mgd: {
    ab: 'МГД', ru: 'Магнитогидродинамический генератор',
    pw: 1.00, massK: 0.80, stab: 70, forceK: 1.10, capK: 2.00, sig: 0.90, glow: '#7fe0ff',
    fuels: ['methane', 'therm', 'he3', 'iso'],
    conv:  ['mhd', 'brayton', 'rankine'],
    conf:  ['none', 'mirror'],
    lore: 'Ионизованная струя летит сквозь поле, поле снимает ток прямо с потока. Движущихся частей нет — есть эрозия канала.',
  },
  tyar: {
    ab: 'ТЯР', ru: 'Термоядерный реактор (синтез)',
    pw: 1.35, massK: 0.70, stab: 48, forceK: 1.15, capK: 2.50, sig: 1.10, glow: '#a9b6ff',
    fuels: ['deut', 'he3', 'therm', 'exo'],
    conv:  ['brayton', 'rankine', 'mhd', 'direct'],
    conf:  ['tokamak', 'stellarator', 'inertial', 'mirror'],
    lore: 'Плазму держат поля, поля держит ток, ток даёт плазма. Круг замкнут — и рвётся там, где тоньше всего.',
  },
  amu: {
    ab: 'АМУ', ru: 'Аннигиляционная установка',
    pw: 1.70, massK: 0.45, stab: 34, forceK: 1.25, capK: 2.80, sig: 1.35, glow: '#ff5ea8',
    fuels: ['degen', 'neutro', 'ichor'],
    conv:  ['direct', 'mhd', 'brayton'],
    conf:  ['penning', 'inertial', 'mirror'],
    lore: 'Антивещество не хранят — его удерживают. Отказ питания ловушки означает, что реактора больше нет, как и всего вокруг.',
  },
  kvg: {
    ab: 'КВГ', ru: 'Квантово-вакуумный генератор',
    pw: 2.00, massK: 0.35, stab: 36, forceK: 1.30, capK: 3.00, sig: 1.55, glow: '#b98bff',
    fuels: ['grav', 'neutro', 'ichor', 'exo'],
    conv:  ['direct', 'mhd'],
    conf:  ['penning', 'lattice', 'inertial'],
    lore: 'Решётка вычерпывает разницу нулевых уровней. Считается, что это безопасно; считается, потому что уцелевших расчётов мало.',
  },
};

// Школа = ИССЛЕДОВАНИЕ. Ключ узла дерева на каждую школу; зеркала —
// EC_REACTOR_SCHOOLS в economy.js и tech_nodes в _rg_school_tech.sql.
// Генератор гейт НЕ применяет (он считает физику для любой школы) — замки
// ставит верстак (reactor_forge_ui) и, по-настоящему, сервер в reactor_upsert.
const SCHOOL_TECH = {
  ritag: 'rg.school.ritag', yaeu: 'rg.school.yaeu', mgd: 'rg.school.mgd',
  tyar:  'rg.school.tyar',  amu:  'rg.school.amu',  kvg: 'rg.school.kvg',
};

// ТОПЛИВО. res — ИМЯ ресурса на складе державы (см. galaxy_gen RESOURCES),
// q — удельная энергия, dens — сколько единиц уходит в закладку,
// stab — вклад в устойчивость, ru — как называем в интерфейсе верфи.
const FUELS = {
  methane: { ru: 'Метан',                    res: 'Метан',                   q: 0.65, dens: 2.6, stab:  +8 },
  iso:     { ru: 'Изотопы',                  res: 'Изотопы',                 q: 1.00, dens: 1.0, stab:   0 },
  deut:    { ru: 'Дейтерий',                 res: 'Дейтерий',                q: 1.15, dens: 1.3, stab:  -4 },
  he3:     { ru: 'Гелий-3',                  res: 'Гелий-3',                 q: 1.30, dens: 1.1, stab:  +6 },
  therm:   { ru: 'Старвис',                  res: 'Старвис',                 q: 1.45, dens: 0.8, stab:  -6 },
  exo:     { ru: 'Стелларит',                res: 'Стелларит',               q: 1.60, dens: 0.5, stab:  +4 },
  grav:    { ru: 'Гравиядро',                res: 'Гравиядро',               q: 1.80, dens: 0.28, stab: -10 },
  degen:   { ru: 'Рагенод',                  res: 'Рагенод',                 q: 1.95, dens: 0.22, stab: -14 },
  neutro:  { ru: 'Программируемая материя',  res: 'Программируемая материя', q: 2.10, dens: 0.18, stab:  +2 },
  ichor:   { ru: 'Ихор',                     res: 'Ихор',                    q: 2.40, dens: 0.12, stab: -18 },
};

// ПРЕОБРАЗОВАНИЕ ТЕПЛА В ТОК — это и есть КПД установки.
const CONV = {
  seebeck:  { ru: 'Термоэлектрика (эффект Зеебека)', eff: 0.08, mass: 0.60, stab: +14 },
  tpv:      { ru: 'Термофотовольтаика',              eff: 0.22, mass: 0.70, stab:  +8 },
  stirling: { ru: 'Двигатель Стирлинга',             eff: 0.32, mass: 0.85, stab:  +4 },
  rankine:  { ru: 'Паровой цикл (Ренкин)',           eff: 0.36, mass: 1.25, stab:  +2 },
  brayton:  { ru: 'Газовый цикл (Брайтон)',          eff: 0.45, mass: 1.00, stab:   0 },
  mhd:      { ru: 'МГД-съём с потока',               eff: 0.58, mass: 1.15, stab:  -8 },
  direct:   { ru: 'Прямое преобразование',           eff: 0.78, mass: 0.90, stab: -16 },
};

// ТЕПЛОНОСИТЕЛЬ. heat — сколько тепла контур реально уносит (множитель к
// работе радиаторов), mass — металлоёмкость контура.
const COOL = {
  passive: { ru: 'Пассивный (излучением)',   heat: 0.45, mass: 0.50 },
  gas:     { ru: 'Газовый (гелий)',          heat: 1.00, mass: 0.80 },
  water:   { ru: 'Водо-водяной',             heat: 1.15, mass: 1.10 },
  salt:    { ru: 'Расплав солей',            heat: 1.35, mass: 1.00 },
  metal:   { ru: 'Жидкий металл (Na / Pb)',  heat: 1.60, mass: 1.25 },
  lithium: { ru: 'Литиевый бланкет',         heat: 1.85, mass: 1.40 },
  field:   { ru: 'Полевой теплоотвод',       heat: 2.20, mass: 1.60 },
};

// УДЕРЖАНИЕ / РЕЖИМ ЗОНЫ. pw — множитель выхода, stab — вклад в устойчивость.
const CONF = {
  none:       { ru: 'Открытая зона',            pw: 1.00, stab:   0, mass: 1.00 },
  damped:     { ru: 'Зона с поглотителями',     pw: 0.88, stab: +18, mass: 1.10 },
  tokamak:    { ru: 'Токамак',                  pw: 1.00, stab:  +6, mass: 1.20 },
  stellarator:{ ru: 'Стелларатор',              pw: 0.92, stab: +18, mass: 1.35 },
  inertial:   { ru: 'Инерциальное сжатие',      pw: 1.35, stab: -14, mass: 0.90 },
  mirror:     { ru: 'Магнитная ловушка',        pw: 1.12, stab:  -4, mass: 1.00 },
  penning:    { ru: 'Ловушка Пеннинга',         pw: 1.50, stab: -22, mass: 1.10 },
  lattice:    { ru: 'Резонансная решётка',      pw: 1.70, stab: -30, mass: 1.25 },
};

// ── §2. Носители ─────────────────────────────────────────────
// hull     — масса КОРПУСА класса (KV.shipClasses), справочно;
// refPower — максимум КАТАЛОЖНЫХ реакторов этого класса (KV.engines, энергия
//            уже с множителем ×4 из constructors_kv_adapt) — ЭТАЛОН, от
//            которого считается вся выработка своей установки;
// refForce — максимум каталожной «силы реактора» этого класса (в формуле
//            скорости KV): без потолка свой реактор разгонял бы дредноут
//            впятеро против заводского;
// massCap  — сколько килограммов класс готов отдать под энергетику;
// refPrice — цена ТОГО ЖЕ каталожного реактора-эталона (KV.engines), от неё
//            считается цена своей установки: единой «цены за ⚡» в каталоге
//            нет (у дрона 3 млн за 400 ⚡, у станции 70 млн за 160 000);
// refCM/refSV — его же закладка цветмета и старвиса, нижняя планка сырья.
//
// ПОЧЕМУ ЭТАЛОН, А НЕ АБСОЛЮТНАЯ ФИЗИКА. Каталожные шкалы энергии по классам
// не сводятся к одной формуле: батарея дрона даёт 400 ⚡ при полусотне
// килограммов, реактор дредноута — 82 000 при сотнях тонн. Единая «честная»
// физика либо хоронит мелочь, либо делает крупные классы бессмысленными.
// Поэтому верстак считает ОТНОСИТЕЛЬНЫЙ индекс сборки и прикладывает его к
// эталону выбранного класса — ровно как оружейная верфь считает энергию от
// «типового орудия класса» (_tg_stats, powerBase/powerRef).
const CARRIERS = {
  peh:              { ru: 'Пехота',              hull: 100,    refPower: 160,    refForce: 100, massCap: 60, cap: 10, div: 100, refPrice: 3000000, refCM: 10, refSV: 0 },
  dron:             { ru: 'Дрон',                hull: 20,     refPower: 400,    refForce: 120, massCap: 20, cap: 6, div: 100, refPrice: 3000000, refCM: 50, refSV: 0 },
  dronkos:          { ru: 'БПЛА (косм.)',        hull: 50,     refPower: 400,    refForce: 120, massCap: 30, cap: 6, div: 100, refPrice: 3000000, refCM: 50, refSV: 0 },
  btr:              { ru: 'БТР / БМП',           hull: 13600,  refPower: 800,    refForce: 300, massCap: 1800, cap: 70, div: 100, refPrice: 4000000, refCM: 10, refSV: 0 },
  tanki:            { ru: 'Танк',                hull: 46500,  refPower: 3600,   refForce: 260, massCap: 6000, cap: 130, div: 100, refPrice: 10000000, refCM: 300, refSV: 0 },
  arta:             { ru: 'Артиллерия',          hull: 5000,   refPower: 3600,   refForce: 29,  massCap: 1400, cap: 160, div: 100, refPrice: 4500000, refCM: 50, refSV: 0 },
  aviacia:          { ru: 'Атм. авиация',        hull: 20000,  refPower: 4800,   refForce: 250, massCap: 3300, cap: 80, div: 100, refPrice: 10000000, refCM: 400, refSV: 0 },
  vertihui:         { ru: 'Вертолёт',            hull: 8000,   refPower: 5200,   refForce: 110, massCap: 2100, cap: 100, div: 100, refPrice: 10000000, refCM: 50, refSV: 0 },
  mla:              { ru: 'Звездолёт',           hull: 20000,  refPower: 3600,   refForce: 80,  massCap: 4000, cap: 80, div: 100, refPrice: 3000000, refCM: 50, refSV: 0 },
  corvette:         { ru: 'Корвет',              hull: 90000,  refPower: 5200,   refForce: 140, massCap: 32000, cap: 250, div: 500, refPrice: 20000000, refCM: 50, refSV: 10 },
  destroyer:        { ru: 'Эсминец',             hull: 109500, refPower: 10000,  refForce: 180, massCap: 48000, cap: 400, div: 500, refPrice: 25000000, refCM: 100, refSV: 100 },
  supportCarrier:   { ru: 'Авианосец подд.',     hull: 100000, refPower: 5600,   refForce: 80,  massCap: 40000, cap: 600, div: 500, refPrice: 12000000, refCM: 50, refSV: 0 },
  mediumCruiser:    { ru: 'Средний крейсер',     hull: 250000, refPower: 22000,  refForce: 250, massCap: 105000, cap: 700, div: 500, refPrice: 40000000, refCM: 200, refSV: 250 },
  hyperCruiser:     { ru: 'Факельщик',           hull: 200000, refPower: 30000,  refForce: 250, massCap: 90000, cap: 600, div: 500, refPrice: 40000000, refCM: 300, refSV: 100 },
  multiroleCarrier: { ru: 'Многоцел. авианосец', hull: 230000, refPower: 40000,  refForce: 100, massCap: 105000, cap: 5500, div: 500, refPrice: 70000000, refCM: 100, refSV: 100 },
  battleship:       { ru: 'Линкор',              hull: 400000, refPower: 52000,  refForce: 100, massCap: 180000, cap: 1200, div: 500, refPrice: 80000000, refCM: 400, refSV: 0 },
  dreadnought:      { ru: 'Дредноут',            hull: 500000, refPower: 82000,  refForce: 25,  massCap: 250000, cap: 1800, div: 500, refPrice: 150000000, refCM: 600, refSV: 400 },
  ss13:             { ru: 'СС-13 (станция)',     hull: 450000, refPower: 160000, refForce: 60,  massCap: 240000, cap: 1000, div: 500, refPrice: 70000000, refCM: 500, refSV: 300 },
};
const CARRIER_ORDER = ['peh', 'dron', 'dronkos', 'btr', 'tanki', 'arta', 'aviacia', 'vertihui',
  'mla', 'corvette', 'destroyer', 'supportCarrier', 'mediumCruiser', 'hyperCruiser',
  'multiroleCarrier', 'battleship', 'dreadnought', 'ss13'];

// Какие школы вообще уместны на носителе: аннигиляционную установку в
// пехотный ранец не ставят, а РИТЭГ линкору бессмысленен по мощности —
// но последнее решит потолок, а не запрет.
const SCHOOL_CARRIERS = {
  ritag: CARRIER_ORDER.slice(),
  yaeu:  ['btr', 'tanki', 'arta', 'aviacia', 'vertihui', 'mla', 'corvette', 'destroyer',
          'supportCarrier', 'mediumCruiser', 'hyperCruiser', 'multiroleCarrier',
          'battleship', 'dreadnought', 'ss13'],
  mgd:   ['tanki', 'arta', 'aviacia', 'vertihui', 'mla', 'corvette', 'destroyer',
          'supportCarrier', 'mediumCruiser', 'hyperCruiser', 'multiroleCarrier',
          'battleship', 'dreadnought', 'ss13'],
  tyar:  ['mla', 'corvette', 'destroyer', 'supportCarrier', 'mediumCruiser', 'hyperCruiser',
          'multiroleCarrier', 'battleship', 'dreadnought', 'ss13'],
  amu:   ['mediumCruiser', 'hyperCruiser', 'multiroleCarrier', 'battleship', 'dreadnought', 'ss13'],
  kvg:   ['hyperCruiser', 'multiroleCarrier', 'battleship', 'dreadnought', 'ss13'],
};

// ── §3. Константы баланса ────────────────────────────────────
// CAP_RATIO — во сколько раз своя установка может превзойти лучшую заводскую
//           своего класса. 1.5 = «очень удачная сборка даёт +50%», обычная
//           уверенная — +20–40%. ЭТО ГЛАВНАЯ РУЧКА БАЛАНСА ВЕРФИ.
// PW_EXP    — сжатие индекса сборки: чтобы удвоить выработку, надо поднять
//           «физику» в 2^(1/0.72) ≈ 2.6 раза. Без сжатия перебор школы и
//           топлива улетал на порядки, и потолок класса становился стеной,
//           в которую упираешься на первом же ползунке.
// MASS_REST — доля массового лимита класса, которую занимает ЭТАЛОННАЯ сборка:
//           остаток — тот запас, который игрок тратит на защиту и радиаторы.
// STAB_MIN  — ниже этого запаса устойчивости регистрация запрещена.
const CAP_RATIO = 3.00;
const PW_EXP    = 0.72;
const MASS_EXP  = 0.85;
const MASS_REST = 0.55;
const STAB_MIN  = 15;
// ХРАПОВИК МАССЫ. Компактность — законная награда за высшую школу, но не
// бесплатная: 242 000 ⚡ не влезают в сорок тонн, как бы удачно ни сошёлся
// индекс железа. Ниже этой планки масса не падает НИКОГДА:
//   massFloor = massCap × MASS_REST × MASS_FLOOR_K × powRatio.
// На эталоне (powRatio 1) планка вдвое ниже эталонной массы — то есть на
// заводской мощности компактная схема по-прежнему выигрывает до 2× веса;
// на потолке ×3 планка съедает 82% массового лимита класса, и «махина»
// наконец грузит шасси как махина.
const MASS_FLOOR_K = 0.50;
// ЦЕНА И СЫРЬЁ — от ЭТАЛОНА КЛАССА, а не от абсолютной мощности. Единой
// «цены за ⚡» в каталоге нет (дрон: 3 млн за 400 ⚡, станция: 70 млн за
// 160 000), поэтому старая степенная формула 9200 × power^0.62 давала
// дредноуту втрое мощнее заводского вдвое дешевле заводского. Внутри же
// одного класса каталог почти линеен по мощности (дредноут: ×3.73 мощности
// = ×3.33 цены), отсюда показатель 0.95.
const PRICE_EXP = 0.95;
// Сырьё растёт МЕДЛЕННЕЕ цены (0.70 против 0.95): за перебор мощности игрок
// платит казной, а не выгребает склад — редкие материалы упираются в добычу,
// и ×3 к старвису на один борт кладёт верфь державы, а не балансирует её.
const RES_EXP   = 0.70;

// Эталонная сборка: от неё считаются ОТНОСИТЕЛЬНЫЕ индексы мощности и массы.
// Числа E_REF/M_REF — её же индексы, посчитанные раз и навсегда (см. selftest
// в _reactor_forge.sql: расхождение зеркал = баг).
const REF_CFG = { school: 'yaeu', fuel: 'iso', conv: 'brayton', cool: 'metal', conf: 'none',
                  size: 1, cores: 2, enrich: 2, temp: 1, rad: 1, shield: 1, damp: 0.3 };

const DEFAULTS = {
  klass: 'corvette',
  school: 'yaeu', fuel: 'iso', conv: 'brayton', cool: 'metal', conf: 'none',
  size: 1, cores: 2, enrich: 2, temp: 1, rad: 1, shield: 1, damp: 0.3,
  seed: 1337, detail: 0.6, tint: '#2b3138', accent: '#e8a93f', yaw: 0,
};

const LIMITS = {
  size:   [0.15, 3.00, 0.05],
  cores:  [1, 6, 1],
  enrich: [0.50, 5.00, 0.10],
  temp:   [0.40, 2.20, 0.05],
  rad:    [0.00, 2.50, 0.10],
  shield: [0.00, 3.00, 0.25],
  damp:   [0.00, 1.50, 0.05],
  detail: [0, 1, 0.05],
  seed:   [1, 9999, 1],
  yaw:    [-180, 180, 1],
};

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }

// ── §4. Нормализация конфига ─────────────────────────────────
// Школа — ведущий выбор: она сужает топливо, преобразование и удержание.
// Несовместимую позицию не «чиним молча в ноль», а откатываем к первой
// допустимой этой школы — иначе смена школы роняла бы сборку в мусор.
function normalize(input) {
  var c = Object.assign({}, DEFAULTS, input || {});
  if (!CARRIERS[c.klass]) c.klass = 'corvette';
  if (!SCHOOLS[c.school]) c.school = 'yaeu';
  // Школа обязана быть уместной для класса: аннигиляционную установку в
  // пехотный ранец не ставят, и это ограничение первично к остальным.
  if (allowedSchools(c.klass).indexOf(c.school) < 0) c.school = allowedSchools(c.klass)[0];
  var S = SCHOOLS[c.school];
  if (S.fuels.indexOf(c.fuel) < 0) c.fuel = S.fuels[0];
  if (S.conv.indexOf(c.conv) < 0)  c.conv = S.conv[0];
  if (S.conf.indexOf(c.conf) < 0)  c.conf = S.conf[0];
  if (!COOL[c.cool]) c.cool = 'gas';
  // Пассивный теплоотвод физически не тянет ничего мощнее РИТЭГа.
  if (c.cool === 'passive' && c.school !== 'ritag') c.cool = 'gas';
  for (var k in LIMITS) {
    if (k === 'seed') { c.seed = Math.round(clamp(num(c.seed, 1337), 1, 9999)); continue; }
    c[k] = clamp(num(c[k], DEFAULTS[k]), LIMITS[k][0], LIMITS[k][1]);
  }
  c.cores = Math.round(c.cores);
  if (typeof c.tint !== 'string')   c.tint = DEFAULTS.tint;
  if (typeof c.accent !== 'string') c.accent = DEFAULTS.accent;
  return c;
}

function allowedSchools(klass) {
  var out = Object.keys(SCHOOLS).filter(function (s) {
    return (SCHOOL_CARRIERS[s] || []).indexOf(klass) >= 0;
  });
  return out.length ? out : ['ritag'];
}
function allowedFuels(school) { return (SCHOOLS[school] || SCHOOLS.yaeu).fuels.slice(); }
function allowedConv(school)  { return (SCHOOLS[school] || SCHOOLS.yaeu).conv.slice(); }
function allowedConf(school)  { return (SCHOOLS[school] || SCHOOLS.yaeu).conf.slice(); }
function allowedCool(school)  {
  return Object.keys(COOL).filter(function (k) { return k !== 'passive' || school === 'ritag'; });
}

// ── §5. ТТХ ──────────────────────────────────────────────────
// Индексы сборки: E — «сколько тока», M — «сколько железа». Оба безразмерные
// и сравниваются с эталоном (REF_CFG); в абсолютные ⚡ и кг их переводит
// уже класс-носитель. Вынесено отдельно, потому что считать надо дважды —
// для сборки и для эталона.
function index(cfg) {
  var S = SCHOOLS[cfg.school], F = FUELS[cfg.fuel], C = CONV[cfg.conv],
      L = COOL[cfg.cool], N = CONF[cfg.conf];
  // ОБЪЁМ АКТИВНОЙ ЗОНЫ. Масштаб — квадратично (это габарит установки),
  // число контуров — с убыванием отдачи: шесть каналов не в шесть раз
  // мощнее одного, они мешают друг другу теплом и нейтронным фоном.
  var V = Math.pow(cfg.size, 1.9) * Math.pow(cfg.cores, 0.70);
  // ТЕПЛОВАЯ МОЩНОСТЬ. Школа × топливо × обогащение × температура × удержание.
  var Q = S.pw * F.q * Math.pow(cfg.enrich, 0.40) * Math.pow(cfg.temp, 1.05) * N.pw * V;
  // ЭЛЕКТРИЧЕСКАЯ = тепловая × КПД преобразования, минус то, что съедает
  // регулирование (поглотители глушат зону, а не только разгон).
  var E = Q * C.eff * (1 - 0.10 * cfg.damp);
  // ЖЕЛЕЗО. Корпус давления, контур, радиаторы, защита — всё платит массой.
  var M = S.massK * Math.pow(cfg.size, 2.4) * Math.pow(cfg.cores, 0.90)
        * C.mass * L.mass * N.mass
        * (1 + cfg.shield * 0.55) * (1 + cfg.rad * 0.30)
        * Math.pow(cfg.temp, 0.45);
  return { Q: Q, E: E, M: M };
}
var REF_IX = index(normalize(REF_CFG));

// «Дороговизна схемы» — во сколько раз этот набор школа/топливо/съём дороже
// в производстве, чем ЭТАЛОННЫЙ набор. Нормируется на PRICE_QUAL_REF, так что
// сама по себе величина смысла не имеет — важно только отношение.
function priceQual(S, F, C) {
  return Math.pow(1 + F.q, 0.5) * Math.pow(1 + C.eff * 2, 0.6) * Math.pow(S.capK, 0.60);
}
var PRICE_QUAL_REF = (function () {
  var r = normalize(REF_CFG);
  return priceQual(SCHOOLS[r.school], FUELS[r.fuel], CONV[r.conv]);
})();

function stats(input) {
  var cfg = normalize(input);
  var S = SCHOOLS[cfg.school], F = FUELS[cfg.fuel], C = CONV[cfg.conv],
      L = COOL[cfg.cool], N = CONF[cfg.conf];
  var CAR = CARRIERS[cfg.klass] || CARRIERS.corvette;
  var ix = index(cfg);

  // ОТНОСИТЕЛЬНО ЭТАЛОНА — и только потом в абсолютные единицы класса.
  var eR = ix.E / REF_IX.E, mR = ix.M / REF_IX.M;

  var power = Math.max(1, Math.round(CAR.refPower * Math.pow(eR, PW_EXP)));
  // Во сколько раз сборка перекрывает лучший заводской реактор класса. От
  // этого числа теперь считаются и планка массы, и цена, и закладка сырья:
  // выработка — единственное, что игрок выкручивает осознанно, и платить
  // он должен именно за неё.
  var pRatio = power / Math.max(1, CAR.refPower);
  var mass  = Math.max(1, Math.round(CAR.massCap * MASS_REST * Math.pow(mR, MASS_EXP)));
  // ЖЕЛЕЗО, КОТОРОЕ ИГРОК РЕАЛЬНО ОБТОЧИЛ — до храповика. Именно оно (а не
  // итоговая масса) заказывает конструкционное сырьё и теплоноситель: храповик
  // ниже — про то, сколько места установка занимает на шасси, а не про то,
  // сколько меди ушло в контур. Считать закладку от него значило впятеро
  // задрать ведомость просто потому, что реактор мощный.
  var massIx = mass;
  // Храповик: индекс железа может уехать вниз сколь угодно далеко, масса — нет.
  var massFloor = Math.round(CAR.massCap * MASS_REST * MASS_FLOOR_K * pRatio);
  if (massFloor > mass) mass = massFloor;
  mass = mass >= 100 ? Math.round(mass / 5) * 5 : mass;

  // ТЕПЛОНАПРЯЖЁННОСТЬ — сколько тока снимается с единицы железа ОТНОСИТЕЛЬНО
  // эталона. Именно она, а не абсолютная мощность, рвёт зону: маленький
  // перегретый реактор опаснее большого спокойного той же выработки.
  var dens = eR / mR;

  // ЗАПАС УСТОЙЧИВОСТИ, %. Плюс дают школа, спокойное преобразование,
  // удержание, радиаторы (через теплоноситель) и поглотители; минус —
  // температура, обогащение, теснота каналов и теплонапряжённость.
  var stab = S.stab + C.stab + N.stab + F.stab
           + cfg.rad * 16 * L.heat
           + cfg.damp * 24
           + cfg.shield * 3
           - (cfg.temp - 1) * 34
           - (cfg.enrich - 1) * 7
           - (cfg.cores - 1) * 3.5
           // Логарифм, а не степень: компактная схема ОБЯЗАНА быть нервной,
           // но при степенной каре высшие школы (их смысл как раз в
           // компактности) уходили в минус раньше, чем игрок доводил ползунок
           // до середины, и не регистрировались вообще никогда.
           - Math.log(Math.max(1, dens)) * 13;
  // Сырое значение сохраняем: жадный спуск tame() по зажатому в 0 запасу
  // терял градиент и вставал на плато, так и не вытащив сборку в приёмку.
  var stabRaw = stab;
  stab = Math.max(0, Math.min(100, Math.round(stab)));

  // ТЕПЛОВАЯ СИГНАТУРА: чем больше сбрасываешь тепла наружу, тем ярче
  // борт светится в инфракрасном. Радиатор — это площадь, а площадь видно.
  var sig = Math.round(S.sig * (1 + cfg.rad * 0.9)
                     * Math.pow(power / Math.max(1, CAR.refPower), 0.5)
                     / (1 + cfg.shield * 0.35) * 10) / 10;

  // СИЛА РЕАКТОРА для формулы скорости KV — удельная мощность установки,
  // приложенная к эталону класса. Лёгкий энергичный реактор разгоняет корпус,
  // тяжёлый «чемодан» — нет. Эталонная сборка даёт 0.85 заводского максимума:
  // выигрыш в ходкости надо заслужить компактной схемой, а не получить даром.
  // Потолок отдачи — тот же CAP_RATIO: сверх него ходкость просто НАСЫЩАЕТСЯ,
  // а не заваливает приёмку. Ходовая — не то, чем игрок «переусердствует»
  // осознанно: компактная схема неизбежно даёт высокую удельную мощность,
  // и заворачивать за это всю сборку было бы наказанием за правильный выбор.
  var force = Math.round(clamp(CAR.refForce * 0.85 * Math.pow(dens, 0.30) * S.forceK,
                               5, CAR.refForce * CAP_RATIO));

  // ПОТОЛКИ СЛОТОВ. Каталожные реакторы несут modul/dviglo/radar/svaz —
  // конструктор читает их как «сколько отсеков/двигателей/радаров тянет
  // энергосеть». Считаем от мощности, с надбавкой за прямое преобразование
  // (у него нет промежуточного контура, шина чище).
  var tier = Math.log10(power + 10);
  var bonus = (cfg.conv === 'direct' || cfg.conv === 'mhd') ? 1 : 0;
  var modul  = Math.max(1, Math.min(8, Math.round(tier - 1.2) + bonus));
  var dviglo = Math.max(1, Math.min(5, Math.round(tier - 2.0) + bonus));
  var radar  = Math.max(1, Math.min(5, Math.round(tier - 2.2) + bonus));
  var svaz   = Math.max(1, Math.min(4, Math.round(tier - 2.6) + 1));
  // Защита и радиаторы съедают полезный объём борта, компактные схемы — дарят.
  var capacityBoost = Math.round(-cfg.shield * 4 - cfg.rad * 2
                               + (cfg.conv === 'seebeck' || cfg.conv === 'tpv' ? 6 : 0));

  // КОНСТРУКЦИОННОЕ СЫРЬЁ (KV-номенклатура) — уходит в цену ГС проекта.
  // Массовая часть осталась (радиаторы и защита правда стоят металла), но
  // снизу её подпирает каталожная закладка эталона, вытянутая по мощности:
  // компактная схема экономит железо, а не редкие материалы.
  var resFloor = Math.pow(pRatio, RES_EXP);
  var resurs = {
    blackmetall:   Math.max(1, Math.round(massIx / 700)),
    coloredmetall: Math.max(1, Math.round(Math.max(massIx / 1500 * (1 + cfg.rad),
                                                   (CAR.refCM || 0) * resFloor))),
    rudametall:    cfg.shield > 0 ? Math.max(1, Math.round(massIx * cfg.shield / 2600)) : 0,
    kristall:      (cfg.conv === 'direct' || cfg.conv === 'tpv' || cfg.conv === 'mhd')
                     ? Math.max(1, Math.round(massIx / 2000)) : 0,
    staarvis:      (S.pw >= 1.35) ? Math.max(1, Math.round(Math.max(massIx / 3200,
                                                   (CAR.refSV || 0) * resFloor))) : 0,
  };

  // KV-ПРАЙС. Якорь — цена каталожного эталона этого же класса, множитель —
  // превышение по мощности и «дороговизна схемы» (богатое топливо, высокий
  // КПД, экзотическая школа) ОТНОСИТЕЛЬНО эталонной сборки. Эталон стоит
  // ровно столько же, сколько заводской реактор, который он копирует.
  var price = Math.max(100000, Math.round(
      (CAR.refPrice || 20000000) * Math.pow(pRatio, PRICE_EXP)
      * priceQual(S, F, C) / PRICE_QUAL_REF / 100000) * 100000);

  // ЗАКЛАДКА ТОПЛИВА — РАЗОВАЯ, при постройке борта. Бедное топливо кладут
  // тоннами, богатое — граммами; обогащение всегда стоит сырья сверху.
  var bill = {};
  var fuelQty = Math.ceil(power / (F.q * 900) * F.dens * (1 + cfg.enrich * 0.30));
  if (fuelQty > 0) bill[F.res] = fuelQty;
  // Теплоноситель и бланкет — тоже со склада, и тоже один раз.
  var coolRes = { water: 'Жидкая вода', salt: 'Ионит', metal: 'Медь',
                  lithium: 'Редкоземельные руды', gas: 'Гелий-3', field: 'Стелларит' }[cfg.cool];
  if (coolRes) {
    var q = Math.ceil(massIx * L.mass / 4000 * (1 + cfg.rad * 0.5));
    if (q > 0) bill[coolRes] = (bill[coolRes] || 0) + q;
  }
  if (cfg.shield > 0) {
    var qs = Math.ceil(massIx * cfg.shield / 5000);
    if (qs > 0) bill['Титан'] = (bill['Титан'] || 0) + qs;
  }

  // ОЧКИ НАУКИ — разовая трата при регистрации установки, как за орудие.
  var on = Math.max(1, Math.min(60, Math.round(0.45 * Math.pow(power, 0.36) * 10) / 10));

  // НАГРУЗКА НА ШАССИ — ТОТ ЖЕ показатель, что в конструкторе кораблей
  // (kv.cap): единица нагрузки НЕ килограмм, у кораблей это ~500 кг, у наземки
  // и авиации ~100 (CN_LOAD_DIV в constructors.js, CARRIERS.div тут). Реактор
  // вычитается из грузоподъёмности борта ровно этим числом — как своё орудие
  // с оружейной верфи; каталожные реакторы шасси не грузят вовсе.
  var capacityPenalty = Math.round(mass / (CAR.div || 500));

  // ЧТО ЭТО ДАЁТ В БОЮ (зеркало _reactor_battle_link.sql):
  //   tpk        — множитель пула времени хода от запаса устойчивости
  //                (нейтраль 60%, шкала половинная, зажата в 0.75…1.25);
  //   stealthCut — на сколько тепловая сигнатура срезает скрытность борта.
  var tpk = Math.round(Math.min(1.25, Math.max(0.75, 1 + (stab - 60) / 200)) * 1000) / 1000;
  var stealthCut = Math.round(sig);

  return {
    tpk: tpk, stealthCut: stealthCut,
    power: power, energy: power, mass: mass, capacityPenalty: capacityPenalty, capCls: CAR.cap || 0, force: force,
    stab: stab, stabRaw: Math.round(stabRaw * 10) / 10, sig: sig, heat: Math.round(ix.Q * 100) / 100,
    powRatio: Math.round(power / Math.max(1, CAR.refPower) * 100) / 100,
    eff: Math.round(C.eff * 100), dens: Math.round(dens * 1000) / 1000,
    modul: modul, dviglo: dviglo, radar: radar, svaz: svaz,
    capacityBoost: capacityBoost, resurs: resurs, price: price, bill: bill, on: on,
    schoolAb: S.ab, fuelRu: F.ru, convRu: C.ru, coolRu: L.ru, confRu: N.ru,
  };
}

// ── §6. Приёмка носителем ────────────────────────────────────
// Установка проектируется ПОД КОНКРЕТНЫЙ КЛАСС (cfg.klass): выработка и масса
// считаются от эталона именно этого класса, поэтому «подойдёт ли она заодно
// корвету» — вопрос без смысла. Проверок три, и все три — потолки класса:
//   мощность ≤ заводской максимум × min(CAP_RATIO, capK школы)
//   масса    ≤ массовый лимит класса
//   устойчивость ≥ STAB_MIN — реактор, который пойдёт вразнос, не регистрируем.
// Отдачи на ходовую среди ворот нет: она насыщается на потолке (см. §5).
// Потолок выработки: заводской максимум класса, поджатый потолком школы.
function powerCap(klass, school) {
  var c = CARRIERS[klass] || CARRIERS.corvette, S = SCHOOLS[school] || SCHOOLS.yaeu;
  return Math.round(c.refPower * Math.min(CAP_RATIO, S.capK));
}
function fit(input) {
  var cfg = normalize(input), s = stats(cfg), c = CARRIERS[cfg.klass] || CARRIERS.corvette;
  var pCap = powerCap(cfg.klass, cfg.school), mCap = c.massCap,
      fCap = Math.round(c.refForce * CAP_RATIO);
  var why = [];
  if (s.power > pCap) why.push('выработка ' + s.power + ' ⚡ при потолке схемы ' + pCap);
  if (s.mass  > mCap) why.push('масса ' + s.mass + ' кг при лимите ' + mCap);
  if (s.stab < STAB_MIN) why.push('запас устойчивости ' + s.stab + '% ниже допустимых ' + STAB_MIN + '%');
  return {
    key: cfg.klass, ru: c.ru, ok: !why.length, why: why.join('; '),
    pCap: pCap, mCap: mCap, fCap: fCap, ref: c.refPower,
    gain: Math.round((s.power / c.refPower - 1) * 100),
  };
}
// ── §6б. ЖИВЫЕ ПРЕДЕЛЫ ПОЛЗУНКОВ ─────────────────────────────
// Раньше приёмка была ТОЛЬКО постфактум: игрок уводил ползунок в упор, а
// верстак отвечал красной плашкой «дредноут такую установку не примет».
// Это неправильно: ползунок обязан упираться там, где кончается допустимое,
// и не пускать дальше физически.
//
// Считаем честным перебором сетки ползунка: у каждого шага спрашиваем fit().
// Монотонности тут нет (радиаторы добавляют массу, но и устойчивость), поэтому
// не бинарный поиск, а НЕПРЕРЫВНЫЙ ОТРЕЗОК ДОПУСТИМОГО, содержащий текущее
// значение: слева и справа расширяемся, пока приёмка проходит. Дырки за
// краем отрезка отбрасываем — ползунок с провалами посередине непригоден.
var RANGE_KEYS = ['size', 'cores', 'enrich', 'temp', 'rad', 'shield', 'damp'];
function sliderRange(input, key) {
  var lim = LIMITS[key];
  if (!lim || RANGE_KEYS.indexOf(key) < 0) return lim ? lim.slice() : [0, 1, 1];
  var cfg = normalize(input), lo = lim[0], hi = lim[1], st = lim[2];
  var n = Math.round((hi - lo) / st);
  var okAt = function (i) {
    var v = Math.round((lo + i * st) * 1e6) / 1e6, c = Object.assign({}, cfg);
    c[key] = v;
    return fit(c).ok;
  };
  // Опора — текущее значение; если оно само не проходит (сменили класс/школу),
  // ищем ближайший допустимый шаг, начиная снизу: скромная сборка проходит чаще.
  var cur = Math.round((clamp(num(cfg[key], lo), lo, hi) - lo) / st), start = -1;
  if (okAt(cur)) start = cur;
  else for (var d = 1; d <= n && start < 0; d++) {
    if (cur - d >= 0 && okAt(cur - d)) start = cur - d;
    else if (cur + d <= n && okAt(cur + d)) start = cur + d;
  }
  if (start < 0) return [lo, lo, st, false];      // допустимого нет вообще
  var a = start, b = start;
  while (a - 1 >= 0 && okAt(a - 1)) a--;
  while (b + 1 <= n && okAt(b + 1)) b++;
  return [Math.round((lo + a * st) * 1e6) / 1e6,
          Math.round((lo + b * st) * 1e6) / 1e6, st, true];
}
// Загнать конфиг внутрь допустимого. Вызывается после смены класса, школы,
// топлива, схемы — то есть там, где ползунки не двигали, а границы уехали.
// Порядок важен: сначала сбрасываем то, что игрок «накрутил» (габарит,
// температура, обогащение, контуры), и лишь потом трогаем защиту с радиаторами.
// Одним ползунком сборку не спасти: КВГ на дредноуте выбивает потолок даже на
// минимальном габарите — там нужен и дроссель, и поглотители. Поэтому спуск
// ЖАДНЫЙ и многомерный: считаем «насколько нарушено» (сумма относительных
// превышений по трём воротам), на каждом шаге пробуем сдвинуть каждый ползунок
// на один щелчок в обе стороны и берём ход, который снижает нарушение сильнее
// всего. Останавливаемся, когда прошло — или когда ни один ход не помогает.
var TAME_ORDER = ['damp', 'temp', 'size', 'enrich', 'cores', 'rad', 'shield'];
function violation(cfg) {
  var s = stats(cfg), c = CARRIERS[cfg.klass] || CARRIERS.corvette;
  var pCap = powerCap(cfg.klass, cfg.school);
  return Math.max(0, s.power / pCap - 1)
       + Math.max(0, s.mass / c.massCap - 1)
       + Math.max(0, (STAB_MIN - s.stabRaw) / 100);
}
function tame(input) {
  var cfg = normalize(input);
  var v = violation(cfg);
  for (var guard = 0; guard < 400 && v > 0; guard++) {
    var best = null, bestV = v;
    for (var i = 0; i < TAME_ORDER.length; i++) {
      var k = TAME_ORDER[i], lim = LIMITS[k];
      for (var d = -1; d <= 1; d += 2) {
        var nv = clamp(Math.round((cfg[k] + d * lim[2]) * 1e6) / 1e6, lim[0], lim[1]);
        if (nv === cfg[k]) continue;
        var cand = normalize(Object.assign({}, cfg, (function (o) { o[k] = nv; return o; })({})));
        var cv = violation(cand);
        if (cv < bestV - 1e-9) { bestV = cv; best = cand; }
      }
    }
    if (!best) break;          // тупик: верстак покажет причину плашкой
    cfg = best; v = bestV;
  }
  return cfg;
}

// Совместимость с проводкой конструктора: список классов-носителей строкой.
function carrierKeys(input) { var f = fit(input); return f.ok ? [f.key] : []; }
// Разбор по всем классам, где школа вообще применима — для досье: видно, куда
// эту же схему имеет смысл переложить, сменив класс в верстаке.
function carriers(input) {
  var cfg = normalize(input);
  var base = SCHOOL_CARRIERS[cfg.school] || SCHOOL_CARRIERS.yaeu;
  return CARRIER_ORDER.filter(function (k) { return base.indexOf(k) >= 0; })
    .map(function (k) { return fit(Object.assign({}, cfg, { klass: k })); });
}

// ── §7. Пресет из каталога ───────────────────────────────────
// Каталожный реактор KV (KV.engines[k][i]) → приблизительный конфиг верстака:
// заготовка, от которой удобно отталкиваться, а не точная реконструкция
// (у каталога нет ни топлива, ни КПД — их там просто не существует).
function fromKV(name, e) {
  var pw = (+((e || {}).power) || 100) * 4;    // ×4 — тот же множитель, что в адаптере
  var nm = String(name || '');
  var school = /РИТЭГ/i.test(nm) ? 'ritag'
             : /аккумул|батар|ячей/i.test(nm) ? 'ritag'
             : /турбоген|турбина|газов/i.test(nm) ? 'mgd'
             : pw >= 40000 ? 'amu' : pw >= 12000 ? 'tyar' : 'yaeu';
  var S = SCHOOLS[school];
  var conv = S.conv.indexOf('brayton') >= 0 ? 'brayton' : S.conv[0];
  var fuel = S.fuels[Math.min(S.fuels.length - 1, pw >= 20000 ? 1 : 0)];
  var cfg = normalize({ school: school, fuel: fuel, conv: conv,
                        cool: school === 'ritag' ? 'passive' : 'metal',
                        conf: S.conf[0], cores: 2, enrich: 2, temp: 1, rad: 1,
                        shield: 1, damp: 0.2, size: 1 });
  // Подгоняем масштаб так, чтобы выработка совпала с каталожной: power ∝ size^1.9.
  var got = stats(cfg).power;
  cfg.size = clamp(cfg.size * Math.pow(pw / Math.max(1, got), 1 / 1.9),
                   LIMITS.size[0], LIMITS.size[1]);
  return normalize(cfg);
}
// Каталог реакторов KV одним плоским списком «имя → объект» для пресетов.
function catalog(engines) {
  var out = {};
  for (var k in (engines || {})) (engines[k] || []).forEach(function (e) {
    if (e && e.name && !out[e.name]) out[e.name] = e;
  });
  return out;
}

// ── §8. Рисование ────────────────────────────────────────────
// Схематичный вид сбоку: закладка топлива слева, активная зона в центре,
// блок преобразования справа, радиаторы сверху и снизу. Свечение — ровно
// одно (топливо/зона), остальное — светотень: правила оформления игры
// запрещают мешанину эффектов.
function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
  return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

// Срезанные углы без обводки: два полигона (внешний — «обводка», внутренний —
// фон). Именно так требуют правила оформления, border тут запрещён.
function cut(x, y, w, h, c, fill, stroke, slot, extra) {
  var p = function (X, Y, W, H, C) {
    return [X + C, Y, X + W - C, Y, X + W, Y + C, X + W, Y + H - C,
            X + W - C, Y + H, X + C, Y + H, X, Y + H - C, X, Y + C]
      .reduce(function (a, v, i) { return a + (i % 2 ? ',' + v : (i ? ' ' : '') + v); }, '');
  };
  var o = '<polygon points="' + p(x, y, w, h, c) + '" fill="' + stroke + '"/>';
  o += '<polygon points="' + p(x + 1.5, y + 1.5, w - 3, h - 3, Math.max(1, c - 1)) + '" fill="' + fill + '"' +
       (slot ? ' data-slot="' + slot + '"' : '') + (extra || '') + '/>';
  return o;
}

function render(input, opt) {
  var cfg = normalize(input), s = stats(cfg), o = opt || {};
  var S = SCHOOLS[cfg.school], F = FUELS[cfg.fuel], L = COOL[cfg.cool], N = CONF[cfg.conf];
  var rnd = mulberry(cfg.seed * 7919);
  var glow = S.glow, acc = cfg.accent, tint = cfg.tint;
  var W = 960, H = 600, CX = 470, CY = 300;

  // Габарит зоны растёт от масштаба и числа контуров, но кадр постоянный:
  // сравнивать установки между собой надо глазом, а не по подписи.
  var k = 0.55 + 0.45 * Math.min(2.2, cfg.size);
  var vw = Math.round(150 * k + cfg.cores * 14), vh = Math.round(210 * k);
  var vx = CX - vw / 2, vy = CY - vh / 2;

  var d = [];
  d.push('<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">');
  d.push('<defs>' +
    '<linearGradient id="rg_hull" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#3a424a"/><stop offset="0.45" stop-color="' + esc(tint) + '"/>' +
      '<stop offset="1" stop-color="#14181c"/></linearGradient>' +
    '<linearGradient id="rg_core" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + esc(glow) + '" stop-opacity="0.85"/>' +
      '<stop offset="1" stop-color="' + esc(glow) + '" stop-opacity="0.25"/></linearGradient>' +
    '<radialGradient id="rg_halo"><stop offset="0" stop-color="' + esc(glow) + '" stop-opacity="0.42"/>' +
      '<stop offset="1" stop-color="' + esc(glow) + '" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="rg_rad" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#2b3138"/><stop offset="1" stop-color="#161a1e"/></linearGradient>' +
    // Цилиндр: тёмный край — блик — тёмный край. Этим рисуются все трубы,
    // барабаны и обечайки, иначе они читаются плоскими плашками.
    '<linearGradient id="rg_tube" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#0c0f12"/><stop offset="0.32" stop-color="#39414a"/>' +
      '<stop offset="0.46" stop-color="#5b6570"/><stop offset="0.72" stop-color="#22282e"/>' +
      '<stop offset="1" stop-color="#0a0d0f"/></linearGradient>' +
    '<linearGradient id="rg_tubeV" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#0c0f12"/><stop offset="0.34" stop-color="#39414a"/>' +
      '<stop offset="0.48" stop-color="#5b6570"/><stop offset="0.74" stop-color="#22282e"/>' +
      '<stop offset="1" stop-color="#0a0d0f"/></linearGradient>' +
    // Рёбра радиатора: у корня горячо, к кромке остывает.
    '<linearGradient id="rg_fin" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#4a3a2c"/><stop offset="0.5" stop-color="#2b3138"/>' +
      '<stop offset="1" stop-color="#12161a"/></linearGradient>' +
    '<pattern id="rg_grate" width="7" height="7" patternUnits="userSpaceOnUse">' +
      '<path d="M0 7 L7 0" stroke="rgba(207,214,221,.09)" stroke-width="1"/></pattern>' +
    '<pattern id="rg_haz" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect width="16" height="16" fill="#14181b"/>' +
      '<rect width="8" height="16" fill="' + esc(acc) + '" opacity="0.42"/></pattern>' +
    '<filter id="rg_bloom" x="-80%" y="-80%" width="260%" height="260%">' +
      '<feGaussianBlur stdDeviation="7"/></filter>' +
    '</defs>');

  // ── Анимация: установка «дышит» ───────────────────────────
  // Одушевляем ровно то, что и правда движется в железе: зона пульсирует,
  // теплоноситель течёт, ротор крутится, шина отбора отдаёт импульсы.
  // Темп задаёт режим: горячая зона пульсирует чаще, глушение — медленнее.
  // Стиль живёт ВНУТРИ svg, поэтому скачанный файл анимируется тоже.
  var beat = Math.max(0.7, Math.min(3.4, 2.6 - cfg.temp * 0.7 + cfg.damp * 0.5));
  var flow = Math.max(0.6, Math.min(3.0, 2.2 - L.heat * 0.5));
  var spin = Math.max(0.5, Math.min(2.6, 1.9 - CONV[cfg.conv].eff * 1.4));
  d.push('<style>' +
    '@keyframes rgBeat{0%,100%{opacity:.78}50%{opacity:1}}' +
    '@keyframes rgHalo{0%,100%{opacity:.72;transform:scale(.985)}50%{opacity:1;transform:scale(1.03)}}' +
    '@keyframes rgFlow{to{stroke-dashoffset:-64}}' +
    '@keyframes rgBlade{0%{opacity:.06}45%{opacity:.34}100%{opacity:.06}}' +
    '@keyframes rgBus{0%{opacity:.15}30%{opacity:.85}100%{opacity:.15}}' +
    '@keyframes rgRod{0%,100%{transform:translateY(0)}50%{transform:translateY(2.5px)}}' +
    '.rg-ch{animation:rgBeat ' + beat.toFixed(2) + 's ease-in-out infinite}' +
    '.rg-halo{transform-box:fill-box;transform-origin:50% 50%;' +
      'animation:rgHalo ' + (beat * 1.6).toFixed(2) + 's ease-in-out infinite}' +
    '.rg-flow{stroke-dasharray:10 6;animation:rgFlow ' + flow.toFixed(2) + 's linear infinite}' +
    '.rg-blade{animation:rgBlade ' + spin.toFixed(2) + 's linear infinite}' +
    '.rg-bus{animation:rgBus ' + (flow * 1.3).toFixed(2) + 's ease-out infinite}' +
    '.rg-rod{animation:rgRod ' + (beat * 2.2).toFixed(2) + 's ease-in-out infinite}' +
    '@media (prefers-reduced-motion:reduce){' +
      '.rg-ch,.rg-halo,.rg-flow,.rg-blade,.rg-bus,.rg-rod{animation:none}}' +
    '</style>');

  d.push('<g data-yaw transform="rotate(' + (Math.round((+cfg.yaw || 0) * 100) / 100) + ')" ' +
         'transform-origin="' + CX + ' ' + CY + '">');

  // ── Мелкие приёмы, из которых собирается «железо» ──────────
  // Болт = тёмное гнездо + блик сверху-слева. Без него любая плашка
  // выглядит нарисованной, а не привинченной.
  function bolt(bx, by, r) {
    return '<circle cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) + '" r="' + r +
           '" fill="#0b0e11"/><circle cx="' + (bx - r * 0.28).toFixed(1) + '" cy="' + (by - r * 0.28).toFixed(1) +
           '" r="' + (r * 0.5).toFixed(1) + '" fill="rgba(207,214,221,.26)"/>';
  }
  function boltRow(x1, x2, by, n, r) {
    var out = '', st = (x2 - x1) / Math.max(1, n - 1);
    for (var t = 0; t < n; t++) out += bolt(x1 + st * t, by, r);
    return out;
  }
  // Труба вдоль X: тело градиентом-цилиндром + фланцы на концах.
  function pipeH(x1, x2, py, th, slot) {
    var o2 = '<rect x="' + x1 + '" y="' + (py - th / 2) + '" width="' + (x2 - x1) + '" height="' + th +
             '" fill="url(#rg_tube)"' + (slot ? ' data-slot="' + slot + '"' : '') + '/>';
    o2 += '<rect x="' + x1 + '" y="' + (py - th / 2 - 4) + '" width="7" height="' + (th + 8) + '" fill="#232a31"/>';
    o2 += '<rect x="' + (x2 - 7) + '" y="' + (py - th / 2 - 4) + '" width="7" height="' + (th + 8) + '" fill="#232a31"/>';
    return o2;
  }
  // Штампованная надпись по корпусу — то, что делает агрегат «настоящим».
  function stencil(sx, sy, txt, size, op) {
    return '<text x="' + sx + '" y="' + sy + '" fill="rgba(207,214,221,' + (op || 0.3) + ')" ' +
           'font-family="Consolas,monospace" font-size="' + size + '" letter-spacing="' + (size * 0.22).toFixed(1) +
           '">' + esc(txt) + '</text>';
  }

  // ── Опорная рама: станина, лапы, раскосы ───────────────────
  var fmx = CX - vw / 2 - 30, fmw = vw + 60, fmy = CY + vh / 2 + 6;
  d.push('<ellipse cx="' + CX + '" cy="' + (fmy + 46) + '" rx="' + (fmw * 0.52) +
         '" ry="12" fill="rgba(0,0,0,.45)"/>');
  for (var lg = 0; lg < 2; lg++) {
    var lx = lg ? fmx + fmw - 34 : fmx + 12;
    d.push('<path d="M ' + lx + ' ' + fmy + ' l 22 0 l ' + (lg ? 10 : -10) + ' 42 l -' + 22 + ' 0 Z" fill="#171c21"/>');
    d.push('<rect x="' + (lx + (lg ? 4 : -12)) + '" y="' + (fmy + 40) + '" width="34" height="7" fill="#232a31"/>');
  }
  d.push('<path d="M ' + (fmx + 26) + ' ' + (fmy + 34) + ' L ' + (fmx + fmw - 26) + ' ' + (fmy + 12) +
         '" stroke="#1b2126" stroke-width="5"/>');
  d.push(cut(fmx, fmy, fmw, 28, 8, 'url(#rg_hull)', '#0d1013', 'frame'));
  d.push('<rect x="' + (fmx + 4) + '" y="' + (fmy + 4) + '" width="' + (fmw - 8) + '" height="4" fill="rgba(207,214,221,.10)"/>');
  d.push(boltRow(fmx + 14, fmx + fmw - 14, fmy + 20, Math.max(4, Math.round(fmw / 46)), 2.6));
  d.push(stencil(fmx + 16, fmy + 21, S.ab + '-' + (100 + (cfg.seed % 900)), 9, 0.34));

  // ── РАДИАТОРЫ: панель-коллектор + гребёнка рёбер ───────────
  var rn = Math.max(0, Math.round(cfg.rad * 3));
  var rl = Math.round(60 + cfg.rad * 110);
  for (var i = 0; i < rn; i++) {
    [vy - 22 - i * 17, vy + vh + 5 + i * 17].forEach(function (ry, up) {
      var rx = CX - rl / 2;
      // Коллектор — труба, рёбра — тонкая гребёнка, сверху сетка-решётка.
      d.push('<rect x="' + rx + '" y="' + ry + '" width="' + rl + '" height="13" fill="url(#rg_tube)"' +
             (i ? '' : (up ? '' : ' data-slot="rad"')) + '/>');
      var fin = '';
      for (var fq = 0; fq * 9 < rl - 14; fq++) {
        fin += '<rect x="' + (rx + 7 + fq * 9) + '" y="' + (ry + (up ? 13 : -9)) + '" width="5" height="9" fill="url(#rg_fin)"/>';
      }
      d.push(fin);
      d.push('<rect x="' + rx + '" y="' + ry + '" width="' + rl + '" height="13" fill="url(#rg_grate)"/>');
      // Подвес к корпусу
      d.push('<rect x="' + (CX - 3) + '" y="' + (up ? ry - 8 : ry + 13) + '" width="6" height="9" fill="#1b2126"/>');
    });
  }

  // ── БИОЗАЩИТА: слои вокруг корпуса ──
  var sn = Math.round(cfg.shield * 2);
  for (var j = sn; j > 0; j--) {
    var pad = 7 * j;
    d.push(cut(vx - pad, vy - pad, vw + pad * 2, vh + pad * 2, 10 + j,
               'none', 'rgba(207,214,221,' + (0.10 + 0.05 * j).toFixed(2) + ')',
               j === sn ? 'shield' : ''));
  }

  // ── КОРПУС АКТИВНОЙ ЗОНЫ ──
  d.push('<ellipse class="rg-halo" cx="' + CX + '" cy="' + CY + '" rx="' + (vw * 1.5) + '" ry="' + (vh * 0.95) +
         '" fill="url(#rg_halo)"/>');
  // Обечайка: крышки-коллекторы сверху и снизу, рёбра жёсткости,
  // продольный блик, шов по оси и опоясок болтов — корпус, а не плашка.
  d.push('<rect x="' + (vx - 11) + '" y="' + (vy - 17) + '" width="' + (vw + 22) + '" height="18" fill="url(#rg_tube)"/>');
  d.push('<rect x="' + (vx - 11) + '" y="' + (vy + vh - 1) + '" width="' + (vw + 22) + '" height="18" fill="url(#rg_tube)"/>');
  d.push(cut(vx, vy, vw, vh, 14, 'url(#rg_hull)', '#0a0d0f', 'vessel'));
  var ribs = '';
  for (var rb = 1; rb * 26 < vw - 12; rb++) {
    var rbx = vx + rb * 26;
    ribs += '<rect x="' + rbx + '" y="' + (vy + 8) + '" width="1" height="' + (vh - 16) + '" fill="rgba(0,0,0,.34)"/>' +
            '<rect x="' + (rbx + 1) + '" y="' + (vy + 8) + '" width="1" height="' + (vh - 16) + '" fill="rgba(207,214,221,.07)"/>';
  }
  d.push(ribs);
  d.push('<rect x="' + (vx + 6) + '" y="' + (vy + 6) + '" width="7" height="' + (vh - 12) +
         '" fill="rgba(207,214,221,.10)"/>');
  d.push('<rect x="' + vx + '" y="' + (CY - 1) + '" width="' + vw + '" height="2" fill="rgba(0,0,0,.4)"/>');
  d.push(boltRow(vx + 10, vx + vw - 10, vy + 7, Math.max(3, Math.round(vw / 34)), 2.4));
  d.push(boltRow(vx + 10, vx + vw - 10, vy + vh - 7, Math.max(3, Math.round(vw / 34)), 2.4));
  // Шильд с маркировкой схемы и полоса «не влезай» у низа обечайки.
  d.push('<rect x="' + (vx + 8) + '" y="' + (vy + vh - 30) + '" width="' + Math.max(34, vw - 16) +
         '" height="9" fill="url(#rg_haz)" opacity="0.55"/>');
  d.push(stencil(vx + 9, vy + vh - 36, S.ab, 11, 0.42));

  // ── КАНАЛЫ ЗОНЫ: по одному на контур ──
  var cn = cfg.cores, chw = Math.max(6, Math.round((vw - 34) / (cn * 2 - 0.4)));
  var step = (vw - 34 - chw) / Math.max(1, cn - 1);
  for (var c = 0; c < cn; c++) {
    var cx = vx + 17 + (cn === 1 ? (vw - 34 - chw) / 2 : c * step);
    var ch = Math.round((vh - 46) * (0.72 + 0.28 * cfg.temp / 2.2));
    // Канал: раскалённая нить в шахте + размытый ореол вокруг неё.
    // Единственное свечение на сцене — здесь, поэтому его и не жалеем.
    d.push('<rect x="' + (cx - 2) + '" y="' + (CY - ch / 2 - 4) + '" width="' + (chw + 4) +
           '" height="' + (ch + 8) + '" fill="#07090b"/>');
    d.push('<rect class="rg-ch" style="animation-delay:' + (c * 0.17).toFixed(2) + 's" x="' + cx +
           '" y="' + (CY - ch / 2) + '" width="' + chw + '" height="' + ch +
           '" fill="url(#rg_core)" data-slot="core" rx="2" filter="url(#rg_bloom)"/>');
    d.push('<rect class="rg-ch" style="animation-delay:' + (c * 0.17).toFixed(2) + 's" x="' + cx +
           '" y="' + (CY - ch / 2) + '" width="' + chw + '" height="' + ch +
           '" fill="url(#rg_core)" rx="2"/>');
    d.push('<rect x="' + (cx + chw * 0.34) + '" y="' + (CY - ch / 2 + 3) + '" width="' + Math.max(1, chw * 0.22) +
           '" height="' + (ch - 6) + '" fill="' + esc(glow) + '" opacity="0.85"/>');
    // Верхняя и нижняя головки канала — он куда-то вставлен, а не парит.
    d.push('<rect x="' + (cx - 3) + '" y="' + (CY - ch / 2 - 9) + '" width="' + (chw + 6) + '" height="9" fill="url(#rg_tube)"/>');
    d.push('<rect x="' + (cx - 3) + '" y="' + (CY + ch / 2) + '" width="' + (chw + 6) + '" height="9" fill="url(#rg_tube)"/>');
    // Поглотители: стержни, опущенные в канал ровно на глубину регулирования.
    if (cfg.damp > 0.02) {
      var dh = Math.round(ch * Math.min(1, cfg.damp / 1.5));
      d.push('<rect class="rg-rod" style="animation-delay:' + (c * 0.21).toFixed(2) + 's" x="' +
             (cx + chw * 0.28) + '" y="' + (CY - ch / 2) + '" width="' + (chw * 0.44) +
             '" height="' + dh + '" fill="#171b1f" data-slot="damp"/>');
    }
  }

  // ── СХЕМА УДЕРЖАНИЯ: кольца / катушки поверх зоны ──
  if (cfg.conf !== 'none' && cfg.conf !== 'damped') {
    var coils = cfg.conf === 'stellarator' ? 7 : cfg.conf === 'tokamak' ? 5
              : cfg.conf === 'lattice' ? 9 : 4;
    for (var q = 0; q < coils; q++) {
      var cyy = vy + 16 + (vh - 32) * (q / Math.max(1, coils - 1));
      var skew = cfg.conf === 'stellarator' ? Math.sin(q * 1.1) * 8 : 0;
      // Катушка: обмотка-цилиндр, торцевые колодки и вывод кабеля вниз.
      d.push('<rect x="' + (vx - 10 + skew) + '" y="' + (cyy - 4) + '" width="' + (vw + 20) +
             '" height="8" fill="url(#rg_tube)" data-slot="conf"/>');
      d.push('<rect x="' + (vx - 14 + skew) + '" y="' + (cyy - 7) + '" width="9" height="14" fill="#232a31"/>');
      d.push('<rect x="' + (vx + vw + 5 + skew) + '" y="' + (cyy - 7) + '" width="9" height="14" fill="#232a31"/>');
      d.push('<path d="M ' + (vx + vw + 14 + skew) + ' ' + cyy + ' q 16 4 18 22" stroke="#191f24" stroke-width="3" fill="none"/>');
      var wind = '';
      for (var wq = 0; wq * 11 < vw + 14; wq++) {
        wind += '<rect x="' + (vx - 6 + skew + wq * 11) + '" y="' + (cyy - 4) + '" width="2" height="8" fill="rgba(0,0,0,.35)"/>';
      }
      d.push(wind);
    }
  }

  // ── ЗАКЛАДКА ТОПЛИВА (слева) ──
  // Бункер с наклонной горловиной, смотровое окно со столбиком таблеток,
  // радиационный трилистник на щеке и тракт подачи с задвижкой-маховиком.
  var fx = vx - 154, fy = CY - 54;
  d.push('<path d="M ' + (fx + 14) + ' ' + (fy - 18) + ' L ' + (fx + 90) + ' ' + (fy - 18) +
         ' L ' + (fx + 104) + ' ' + fy + ' L ' + fx + ' ' + fy + ' Z" fill="#1c2228"/>');
  d.push(cut(fx, fy, 104, 108, 12, 'url(#rg_hull)', '#0a0d0f', 'fuel'));
  d.push('<rect x="' + (fx + 30) + '" y="' + (fy + 16) + '" width="44" height="76" fill="#07090b"/>');
  var pel = Math.max(2, Math.round(2 + cfg.enrich * 3));
  for (var pq = 0; pq < pel; pq++) {
    var pyy = fy + 86 - pq * 15;
    d.push('<rect class="rg-ch" style="animation-delay:' + (pq * 0.19).toFixed(2) + 's" x="' + (fx + 35) +
           '" y="' + pyy + '" width="34" height="11" rx="3" fill="' + esc(glow) + '" opacity="0.75"/>');
  }
  d.push('<circle class="rg-halo" cx="' + (fx + 52) + '" cy="' + (fy + 60) + '" r="' + (30 + cfg.enrich * 8) +
         '" fill="url(#rg_halo)"/>');
  d.push('<rect x="' + (fx + 30) + '" y="' + (fy + 16) + '" width="44" height="76" fill="url(#rg_grate)"/>');
  d.push(boltRow(fx + 10, fx + 94, fy + 9, 5, 2.4));
  d.push(boltRow(fx + 10, fx + 94, fy + 99, 5, 2.4));
  d.push('<g opacity="0.5" transform="translate(' + (fx + 88) + ',' + (fy + 22) + ')">' +
         '<circle r="8" fill="none" stroke="' + esc(acc) + '" stroke-width="2" stroke-dasharray="4 4.2"/>' +
         '<circle r="2" fill="' + esc(acc) + '"/></g>');
  d.push(stencil(fx + 8, fy + 106, F.ru.slice(0, 12).toUpperCase(), 8, 0.32));
  // Тракт подачи с фланцами и запорным маховиком.
  d.push(pipeH(fx + 104, vx, CY, 12));
  var vwx = (fx + 104 + vx) / 2;
  d.push('<rect x="' + (vwx - 9) + '" y="' + (CY - 14) + '" width="18" height="28" fill="#232a31"/>');
  d.push('<circle cx="' + vwx + '" cy="' + (CY - 20) + '" r="9" fill="none" stroke="#39414a" stroke-width="3"/>');
  d.push('<rect x="' + (vwx - 1.5) + '" y="' + (CY - 20) + '" width="3" height="12" fill="#39414a"/>');

  // ── КОНТУР ТЕПЛОНОСИТЕЛЯ (петли между зоной и преобразованием) ──
  var loops = Math.max(1, Math.round(L.heat * 2));
  for (var lp = 0; lp < loops; lp++) {
    var ly = CY - 60 + lp * (120 / Math.max(1, loops));
    d.push(pipeH(vx + vw, vx + vw + 56, ly, 11, lp ? '' : 'cool'));
    // Насос-улитка на каждой второй петле: контур не сам собой гоняет.
    if (lp % 2 === 0) {
      d.push('<circle cx="' + (vx + vw + 28) + '" cy="' + ly + '" r="13" fill="url(#rg_tubeV)"/>');
      d.push('<circle cx="' + (vx + vw + 28) + '" cy="' + ly + '" r="5" fill="#0d1114"/>');
      d.push('<circle class="rg-blade" cx="' + (vx + vw + 28) + '" cy="' + ly + '" r="9" fill="none" ' +
             'stroke="rgba(207,214,221,.25)" stroke-width="2" stroke-dasharray="4 5"/>');
    }
    // Светлая нить в трубе бежит — это и есть «идёт теплоноситель».
    d.push('<path class="rg-flow" style="animation-delay:' + (lp * 0.13).toFixed(2) + 's" d="M ' +
           (vx + vw) + ' ' + ly + ' H ' + (vx + vw + 54) +
           '" stroke="rgba(207,214,221,.28)" stroke-width="2" fill="none"/>');
  }

  // ── БЛОК ПРЕОБРАЗОВАНИЯ (справа) ──
  var px = vx + vw + 54, ph = Math.round(90 + CONV[cfg.conv].eff * 120);
  // Улитка машины и выхлопная труба со стаканом — силуэт узнаётся сразу.
  d.push('<circle cx="' + (px + 59) + '" cy="' + CY + '" r="' + (ph * 0.42) + '" fill="#171c21"/>');
  d.push('<rect x="' + (px + 84) + '" y="' + (CY - ph / 2 - 46) + '" width="22" height="50" fill="url(#rg_tubeV)"/>');
  d.push('<rect x="' + (px + 79) + '" y="' + (CY - ph / 2 - 52) + '" width="32" height="9" fill="#232a31"/>');
  d.push(cut(px, CY - ph / 2, 118, ph, 12, 'url(#rg_hull)', '#0a0d0f', 'conv'));
  d.push('<rect x="' + (px + 5) + '" y="' + (CY - ph / 2 + 5) + '" width="6" height="' + (ph - 10) +
         '" fill="rgba(207,214,221,.10)"/>');
  d.push(boltRow(px + 12, px + 106, CY - ph / 2 + 8, 5, 2.4));
  d.push(boltRow(px + 12, px + 106, CY + ph / 2 - 8, 5, 2.4));
  // Приборная гроздь: манометры на щеке блока.
  for (var gg = 0; gg < 2; gg++) {
    var gx2 = px + 26 + gg * 26, gy2 = CY + ph / 2 - 26;
    d.push('<circle cx="' + gx2 + '" cy="' + gy2 + '" r="8" fill="#0d1114"/>' +
           '<circle cx="' + gx2 + '" cy="' + gy2 + '" r="8" fill="none" stroke="#39414a" stroke-width="1.5"/>' +
           '<path d="M ' + gx2 + ' ' + gy2 + ' l ' + (gg ? 5 : -4) + ' -5" stroke="' + esc(acc) +
           '" stroke-width="1.5" opacity="0.8"/>');
  }
  // Ротор для машинных циклов, пластины — для прямых схем.
  if (cfg.conv === 'rankine' || cfg.conv === 'brayton' || cfg.conv === 'stirling') {
    for (var b = 0; b < 9; b++) {
      var bx = px + 22 + b * 8;
      // Лопатки подсвечиваются волной слева направо — ротор «крутится».
      d.push('<rect class="rg-blade" style="animation-delay:' + (b * (spin / 9)).toFixed(2) + 's" x="' + bx +
             '" y="' + (CY - ph / 2 + 18 + (b % 2) * 6) + '" width="4" height="' +
             (ph - 40) + '" fill="rgba(207,214,221,.10)"/>');
    }
  } else {
    for (var g = 0; g < 6; g++) {
      d.push('<rect class="rg-blade" style="animation-delay:' + (g * (spin / 6)).toFixed(2) + 's" x="' +
             (px + 16) + '" y="' + (CY - ph / 2 + 14 + g * ((ph - 28) / 6)) +
             '" width="86" height="6" fill="' + esc(acc) + '" opacity="0.20"/>');
    }
  }
  // Шина отбора мощности
  d.push('<rect x="' + (px + 118) + '" y="' + (CY - 5) + '" width="76" height="10" fill="url(#rg_tube)"/>');
  d.push('<rect class="rg-bus" x="' + (px + 118) + '" y="' + (CY - 5) + '" width="76" height="2" fill="' + esc(acc) + '" opacity="0.45"/>');
  // Изоляторы на шине — «тут высокое напряжение».
  for (var iz = 0; iz < 3; iz++) {
    var izx = px + 132 + iz * 24;
    d.push('<rect x="' + (izx - 4) + '" y="' + (CY + 5) + '" width="8" height="12" fill="#232a31"/>' +
           '<rect x="' + (izx - 7) + '" y="' + (CY + 11) + '" width="14" height="3" fill="#2f3740"/>');
  }
  d.push(stencil(px + 120, CY - 12, s.power + ' KW', 9, 0.32));

  // ── Обшивка: панели, лючки, потёки и сварные швы (детализация) ──
  // Идут поверх всего корпуса и дают ту самую «нарисованность руками»:
  // плоский металл без грязи всегда читается как заглушка.
  var dn = Math.round(cfg.detail * 16);
  for (var m = 0; m < dn; m++) {
    var mx = vx + 8 + rnd() * (vw - 30), my = vy + 14 + rnd() * (vh - 34), kind = rnd();
    if (kind < 0.34) {
      // Панель со швом
      var pwd = 12 + rnd() * 22, phg = 8 + rnd() * 14;
      d.push('<rect x="' + mx.toFixed(1) + '" y="' + my.toFixed(1) + '" width="' + pwd.toFixed(1) +
             '" height="' + phg.toFixed(1) + '" fill="rgba(0,0,0,.22)"/>' +
             '<rect x="' + mx.toFixed(1) + '" y="' + my.toFixed(1) + '" width="' + pwd.toFixed(1) +
             '" height="1" fill="rgba(207,214,221,.09)"/>');
    } else if (kind < 0.62) {
      // Лючок на болтах
      d.push('<rect x="' + mx.toFixed(1) + '" y="' + my.toFixed(1) + '" width="13" height="10" fill="#151a1f"/>' +
             bolt(mx + 2.5, my + 2.5, 1.5) + bolt(mx + 10.5, my + 7.5, 1.5));
    } else if (kind < 0.84) {
      // Потёк/подпалина от жара
      d.push('<rect x="' + mx.toFixed(1) + '" y="' + my.toFixed(1) + '" width="' + (2 + rnd() * 3).toFixed(1) +
             '" height="' + (10 + rnd() * 22).toFixed(1) + '" fill="rgba(0,0,0,.26)"/>');
    } else {
      d.push('<rect x="' + mx.toFixed(1) + '" y="' + my.toFixed(1) + '" width="' + (4 + rnd() * 9).toFixed(1) +
             '" height="1" fill="rgba(207,214,221,.10)"/>');
    }
  }

  d.push('</g>');
  if (!o.tight) {
    d.push('<text x="24" y="' + (H - 22) + '" fill="rgba(200,197,188,.35)" ' +
           'font-family="Consolas,monospace" font-size="15" letter-spacing="3">' +
           esc(S.ab) + ' · ' + esc(F.ru) + ' · КПД ' + s.eff + '% · ' + s.power + ' ⚡</text>');
  }
  d.push('</svg>');
  return d.join('');
}

return {
  render: render, stats: stats, normalize: normalize,
  carriers: carriers, carrierKeys: carrierKeys, fromKV: fromKV, catalog: catalog,
  allowedFuels: allowedFuels, allowedConv: allowedConv, allowedConf: allowedConf,
  allowedCool: allowedCool,
  SCHOOLS: SCHOOLS, SCHOOL_TECH: SCHOOL_TECH, FUELS: FUELS, CONV: CONV, COOL: COOL, CONF: CONF,
  CARRIERS: CARRIERS, CARRIER_ORDER: CARRIER_ORDER, SCHOOL_CARRIERS: SCHOOL_CARRIERS,
  LIMITS: LIMITS, DEFAULTS: DEFAULTS,
  CAP_RATIO: CAP_RATIO, PW_EXP: PW_EXP, MASS_EXP: MASS_EXP, MASS_REST: MASS_REST,
  MASS_FLOOR_K: MASS_FLOOR_K, PRICE_EXP: PRICE_EXP, RES_EXP: RES_EXP,
  STAB_MIN: STAB_MIN, REF_CFG: REF_CFG, REF_IX: REF_IX, index: index, fit: fit,
  allowedSchools: allowedSchools, powerCap: powerCap,
  sliderRange: sliderRange, tame: tame,
};
})();
