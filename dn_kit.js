// © 2025–2026. Все права защищены.
// ════════════════════════════════════════════════════════════════════
// DN-KIT — СНАРЯЖЕНИЕ АРЕНЫ ИЗ ИГРОВЫХ ДАННЫХ
// ────────────────────────────────────────────────────────────────────
// Зачем файл. Арена «Дредноут» родилась стендом жанра и потому носила СВОИ
// пять корпусов и одну пушку на класс (dn_arena.js §1). К игре это не имело
// отношения вовсе: в игре корабль — ПРОЕКТ (корпус класса + броня + реактор +
// орудия из оружейной верфи + модули), и весь смысл боя в том, что игрок сам
// этот проект собрал. Стенд с выдуманными цифрами обесценивал всё это разом.
//
// Здесь борт собирается ИЗ ТЕХ ЖЕ ИСТОЧНИКОВ, что и в игре:
//   • KV.shipClasses      — корпус класса (масса, габарит, отсеки, поле щита)
//   • KV.materialsDatabase— броневые плиты (armorElements — лишь список ссылок)
//   • KV.modulesLibrary   — модули, их combat-эффекты и активации
//   • ARMOR_ALCHEMY       — свои сплавы игрока (стойкости к трём каналам)
//   • cnKvArmorHp         — та самая формула прочности корпуса, что в верфи
//   • TG.stats            — оружейная верфь: урон, дальность, темп, канал
// Ничего не выдумано на месте: если цифра пришла не отсюда — ей тут не место.
//
// ⚠️ ДВА КОЭФФИЦИЕНТА ПЕРЕВОДА, И БОЛЬШЕ НИКАКИХ. Игра считает бой ПОШАГОВО и
// в гексах; арена — в реальном времени и в единицах длины корпуса. Мост держат
// ровно две константы, и обе объяснимы:
//   SCALE — во сколько раз арена мельче игровых чисел. Прочность корпуса в игре
//           идёт десятками тысяч (одна «Царь-цитадель» даёт 5500), урон орудий
//           и активаций — тысячами. Делим и то и другое на ОДНО число, поэтому
//           соотношения (сколько залпов держит борт) остаются игровыми.
//   TURN  — ход боевой доски в секундах (6 с, см. _bt_timepool). Через него
//           залп орудия превращается в ТЕМП: за 6 секунд непрерывного огня
//           башня выдаёт ровно свой игровой залп, а кулдаун активации в ходах
//           становится кулдауном в секундах.
// Всё остальное — производные. Крутить баланс арены = крутить эти две цифры,
// а не переписывать ТТХ: ТТХ принадлежат игре.
//
// Экспорт: window.DNK
// ════════════════════════════════════════════════════════════════════
window.DNK = (function () {
'use strict';

// ── §1. Мост игра ↔ арена ────────────────────────────────────
const SCALE   = 10;      // игровые единицы прочности/урона → арена
const TURN    = 6;       // секунд в ходе боевой доски (_bt_tp_max)
const HEX     = 62;      // единиц арены в одном гексе доски
// ⚠️ ТРЕТИЙ И ПОСЛЕДНИЙ КОЭФФИЦИЕНТ — ТЕМП ПЕРЕСТРЕЛКИ, И ОН НУЖЕН ЧЕСТНО.
// На доске залп — это ИТОГ целого хода: сближение, доворот, наводка, огонь,
// и обе стороны бьют гарантированно. Бой там кончается за 2–4 хода. Если тот
// же урон в секунду перенести в реальное время как есть, борт умирает раньше,
// чем успевает довернуть корпус, — то есть весь манёвр, ради которого арена и
// сделана, перестаёт существовать. PACE растягивает ОДИН обмен залпами на
// столько ходов, сколько нужно, чтобы решения игрока успевали случиться.
// Соотношения между бортами он не меняет: это один множитель на всех.
// ⚠️ ЧЕТЫРЁХ БЫЛО МАЛО: тяжёлое орудие сносило эсминец с двух попаданий —
// «ваншоты». Восемь дают полноценную перестрелку: борт под сплошным огнём
// живёт десятки секунд, и за это время успевает довернуть, уйти за камень,
// нажать модуль. Соотношения бортов при этом не сдвинулись ни на волос.
const PACE    = 8;
const clamp = (v,a,b)=> v<a?a:(v>b?b:v);
const num   = (v,d)=> (v==null||isNaN(+v)) ? (d||0) : +v;

// ── §2. Профиль спада урона по каналу ────────────────────────
// Зеркало _bt_wpn_opt / _bt_wpn_far / _bt_wpn_dmin из _bt_weapon_model.sql.
// На доске спад считался по гексам между бортами; здесь — по пройденному
// снарядом пути, но кривая та же: кинетика зла в упор и вырождается на краю,
// луч тянет ровно, ракета от дистанции не зависит, но вплотную не наводится.
const CHAN = {
  kinetic: { opt:0.40, far:0.25, dmin:1, ru:'кинетика', col:0xffb066, spd:1500 },
  energy:  { opt:0.60, far:0.60, dmin:1, ru:'энергия',  col:0x66e8ff, spd:2600 },
  missile: { opt:1.00, far:1.00, dmin:2, ru:'ракеты',   col:0xff8a5c, spd: 760 },
  repair:  { opt:1.00, far:1.00, dmin:1, ru:'ремонт',   col:0x9dffc7, spd:1400 },
};
// Множитель урона на пройденной дистанции d при паспортной дальности rng.
function falloff(kind, d, rng){
  const C = CHAN[kind] || CHAN.kinetic;
  if (d < HEX*C.dmin) return kind==='missile' ? 0 : 1;   // ракета в упор не работает
  const opt = rng*C.opt;
  if (d <= opt) return 1;
  const k = clamp((d-opt)/Math.max(1, rng-opt), 0, 1);
  return 1 + (C.far-1)*k;
}

// ── §3. Корпус класса ────────────────────────────────────────
// Ходовые качества НЕ выдуманы: они считаются от массы и габарита корпуса —
// тех самых чисел, по которым игра берёт с державы сырьё и считает скорость
// (cnKvSpeed: тяга/масса). Тяжёлый борт тяжёл ВЕЗДЕ, а не только на доске.
// len — длина борта в единицах арены: габарит класса, поджатый корнем, иначе
// дредноут (габарит 800) вставал бы вдесятеро длиннее корвета (100) и бой
// превращался в облёт стены.
const CLS_RU = {
  corvette:'Корвет', destroyer:'Эсминец', supportCarrier:'Поддерживающий носитель',
  mediumCruiser:'Средний крейсер', hyperCruiser:'Факельщик',
  multiroleCarrier:'Многоцелевой носитель', battleship:'Линкор',
  dreadnought:'Дредноут', ss13:'СС-13', colossus:'Имперский колосс',
};
// Порядок — по массе корпуса, он же порядок «весовых категорий» арены.
const CLS_ORDER = ['corvette','destroyer','supportCarrier','mediumCruiser',
                   'hyperCruiser','multiroleCarrier','battleship','dreadnought'];

function hullOf(cls){
  const KVc = (window.KV && KV.shipClasses) || {};
  const c = KVc[cls] || KVc.destroyer || { mass:100000, gabarit:150, modul:32, shieldBoost:9, capacity:400 };
  const mass = num(c.mass,100000), gab = num(c.gabarit,150);
  // ДЛИНА. Габарит 100…800 → 42…86 единиц: тот же порядок, что был у стенда,
  // но пропорции теперь игровые, а не подобранные.
  const len = Math.round(18 + Math.pow(gab, 0.52) * 2.35);
  // ХОД. Обратно массе, как в cnKvSpeed. Числитель подобран так, чтобы корвет
  // остался на прежних ~72 ед/с — иначе поедет вся дистанционная геометрия боя.
  const spd  = clamp(Math.round(72 * Math.pow(90000/mass, 0.42)), 22, 90);
  const acc  = clamp(Math.round(spd*0.30), 6, 26);
  // РАЗВОРОТ и ВСПЛЫТИЕ — от длины: длинный корпус ворочает медленнее.
  const yaw  = clamp(+(9.5/(len+8)).toFixed(3), 0.14, 0.62);
  const lift = clamp(Math.round(560/len), 6, 20);
  return { cls, name: c.xxx || CLS_RU[cls] || cls, len, spd, acc, yaw, lift,
           mass, gab, slots: num(c.modul,32), capacity: num(c.capacity,400),
           shieldBoost: num(c.shieldBoost,0), raw:c };
}

// ── §4. Броня ────────────────────────────────────────────────
// Прочность считает cnKvArmorHp — ровно та функция, которой верфь показывает
// игроку HP проекта. Стойкости: у стоковой плиты базовые 10% по трём каналам
// (_armor_baseline_resist.sql), у своего сплава — то, что насчитала алхимия.
// ⚠️ САМИ ПЛИТЫ ЛЕЖАТ В KV.materialsDatabase. armorElements — это только
// список ссылок «какая броня доступна такому-то классу», по нему и ходит номер
// брони в проекте; искать плиту в нём самом бесполезно, там одни reference.
function armorOf(cls, armorKey, alloyMix){
  const MDB = (window.KV && KV.materialsDatabase) || {};
  const LST = ((window.KV && KV.armorElements) || {})[cls] || [];
  let obj = null, resist = { kinetic:0.10, energy:0.10, missile:0.10 }, name = 'Без брони';
  if (alloyMix && window.ARMOR_ALCHEMY){
    const a = ARMOR_ALCHEMY.calcAlloy(alloyMix);
    if (a && a.ok){ obj = a; obj._alloy = true; resist = a.resist; name = 'Сплав (свой рецепт)'; }
  } else {
    // Ключ плиты или НОМЕР в списке брони класса — ровно так проект и хранит
    // выбор игрока (p_data.armor — индекс в armorElements[класс]).
    let key = armorKey;
    if (typeof armorKey === 'number'){ const e = LST[armorKey]; key = e && e.reference; }
    if (key && MDB[key]){ obj = MDB[key]; name = obj.name || key; }
  }
  const raw = (obj && typeof cnKvArmorHp === 'function')
    ? cnKvArmorHp((window.KV && KV.shipClasses[cls]) || {}, obj) : 0;
  return { name, hp: Math.max(0, raw||0), resist, obj };
}

// ── §5. Орудие: оружейная верфь → ствол на палубе ────────────
// cfg — ровно тот объект, что принимает TG.stats (класс установки, технология,
// калибр, длина ствола, число стволов, компоновка). Ничего «арендного» в нём
// нет: такое орудие игрок собирает в верфи и ставит на настоящий проект.
//
// ⚠️ ЗАЛП ДОСКИ → ТЕМП АРЕНЫ. На доске орудие бьёт РАЗ В ХОД и снимает свой
// damage. В реальном времени та же пушка стреляет очередями, поэтому урон
// одного выстрела = залп × (длительность цикла / ход) / выстрелов в цикле.
// Просуммируйте выстрелы за 6 секунд — получите паспортный залп. Это и есть
// весь перевод; больше нигде урон не трогается.
function weaponOf(cfg, tag){
  const st = (window.TG && TG.stats) ? TG.stats(cfg) : null;
  if (!st) return null;
  const kind = st.kind || 'kinetic';
  const C = CHAN[kind] || CHAN.kinetic;
  const salvo = st.damage/SCALE;                       // паспортный залп в единицах арены
  // ЦИКЛ. rof верфи — выстрелов В МИНУТУ, то есть 60/rof секунд между залпами.
  // Тяжёлое орудие даёт 1–3 залпа в минуту: ждать по двадцать секунд у пушки в
  // реальном времени нельзя, поэтому цикл поджат в играбельное окно 1.2…9 с.
  // Порядок при этом сохранён: зенитка бьёт очередью без пауз, главный калибр —
  // раз в несколько секунд, и разница между ними та же, что в верфи.
  const rpm   = clamp(num(st.rof, 60), 1, 20000);
  const cycle = clamp(60/rpm, 1.2, 9);
  // Магазин — сколько выстрелов уместилось в очередь. У скорострелки их много,
  // у главного калибра один: он и есть «залп».
  // ⚠️ МАГАЗИН НЕ БЫВАЕТ В ОДИН ВЫСТРЕЛ. У тяжёлых орудий темп верфи — единицы
  // выстрелов в минуту, и формула давала им ровно один выстрел за цикл: вся
  // мощь сборки прилетала ОДНИМ снарядом, то есть половина чужого корпуса за
  // одно попадание. Минимум три: суммарный урон за цикл тот же (он делится на
  // число выстрелов), но промах перестаёт быть бесплатным, а попадание —
  // приговором. Спарка и трёхорудийная башня так и стреляют — очередью.
  const mag   = clamp(Math.round(rpm/45), 3, 10);
  const rof   = clamp(cycle*0.30/mag, 0.07, 0.6);      // темп ВНУТРИ очереди
  const rel   = Math.max(0.6, cycle - rof*mag);        // пауза между очередями
  // ⚠️ ГЛАВНОЕ РАВЕНСТВО ВСЕГО ФАЙЛА: за ход доски (TURN) орудие выдаёт ровно
  // свой паспортный залп. Отсюда урон одного выстрела — и больше он нигде не
  // трогается: ни классом, ни «на глаз».
  const perShot = salvo * (cycle/(TURN*PACE)) / mag;
  return {
    name: cfg.name || tag || 'орудие', tag: tag||'', cfg,
    kind, ru: C.ru, col: C.col,
    dmg: Math.max(1, +perShot.toFixed(1)),
    dps: +(salvo/(TURN*PACE)).toFixed(1),
    salvo: Math.round(salvo),
    rng: Math.round(st.dalnost * HEX),                 // гексы доски → единицы арены
    hex: st.dalnost,
    rof, mag, rel, cycle, spd: C.spd,
    // Разброс — от калибра: мелкая скорострелка сыпет, тяжёлое орудие кладёт
    // точно. Компенсирует то, что игрок ведёт цель руками, а не считает.
    spread: clamp(0.016 - num(st.caliber,120)/26000, 0.004, 0.016),
    heal: kind==='repair' ? Math.round(num(st.heal,0)/SCALE) : 0,
    energy: st.energy, gs: st.gs, on: st.on, caliber: st.caliber, barrels: st.barrels,
  };
}

// ── §6. Модули ───────────────────────────────────────────────
// Пассивные combat-поля берём как есть (pd/jam/stealth/sensor/hangar).
// Активации — те же ключи, что жмут на доске (combat.act), но кулдаун из ХОДОВ
// переведён в секунды, а урон и лечение поделены на SCALE.
//
// ⚠️ ЧЕГО СОЗНАТЕЛЬНО НЕТ: перков экипажа (perks.js). Почти все они играют с
// ПУЛОМ СЕКУНД ХОДА («остаток переходит в следующий ход», «−1 ход со всех
// кулдаунов») — в реальном времени пула нет, и переносить их значило бы
// придумывать им новый смысл. Придумывать смысл игровым сущностям этот файл
// права не имеет: перки ждут своего честного переноса.
// ⚠️ ЗНАЧКИ ЗДЕСЬ НЕ ХРАНЯТСЯ. В интерфейсе проекта эмодзи запрещены (тофу на
// половине систем и «смайлики» вместо приборов): значок рисуется линиями в
// dn_arena.js по полю kind. Здесь только смысл активации, не её картинка.
const ACT_UI = {
  siege:    { ru:'Осадная платформа', kind:'stance' },
  salvo:    { ru:'Ракетный залп',    kind:'strike' },
  broadside:{ ru:'Бортовой залп',    kind:'burst'  },
  blink:    { ico:'➤',  ru:'Прыжок',           kind:'blink'  },
  cloak:    { ru:'Маскировка',       kind:'cloak'  },
  amp:      { ru:'Усилитель контура',kind:'amp'    },
  drones:   { ico:'✚',  ru:'Ремонтные дроны',  kind:'heal'   },
  torpedo:  { ico:'☄',  ru:'Торпеда «Голиаф»', kind:'strike' },
  storm:    { ru:'Ракеты «Шквал»',   kind:'strike' },
  ram:      { ico:'▲',  ru:'Плазменный таран', kind:'ram'    },
  rupture:  { ico:'▲',  ru:'Разрывной таран',  kind:'ram'    },
  drain:    { ico:'◇',  ru:'Иссушитель',       kind:'strike' },
  wbreak:   { ico:'◇',  ru:'«Ломовик»',        kind:'strike' },
  disrupt:  { ico:'◇',  ru:'Подавитель',       kind:'strike' },
  wboost:   { ico:'⚔',  ru:'Ракета-усилитель', kind:'amp'    },
  pboost:   { ico:'♪',  ru:'Импульс «Хорал»',  kind:'amp'    },
  hell:     { ico:'☀',  ru:'Адские лазеры',    kind:'burst'  },
  blind:    { ico:'✳',  ru:'Ослепление',       kind:'burst'  },
  pdup:     { ru:'ПРО-усиление',     kind:'amp'    },
  stasis:   { ico:'❄',  ru:'Стазис-лучи',      kind:'burst'  },
  apulse:   { ru:'Импульс брони',    kind:'amp'    },
  tractor:  { ico:'⇔',  ru:'Тяговый луч',      kind:'burst'  },
  nuke:     { ico:'☢',  ru:'Ядерная ракета',   kind:'strike' },
  tartarus: { ico:'☄',  ru:'«Тартар»',         kind:'strike' },
  sammo:    { ico:'❄',  ru:'Стазис-боеприпас', kind:'amp'    },
  scramble: { ico:'✳',  ru:'Скремблер',        kind:'burst'  },
  amlaser:  { ru:'Противоракетные лазеры', kind:'amp' },
};

function modulesOf(list){
  const LIB = (window.KV && KV.modulesLibrary) || {};
  const pas = { pd:0, jam:0, stealth:0, sensor:0, hangar:0 };
  const acts = [];
  let power = 0, crew = 0, field = 0;
  (list||[]).forEach(key=>{
    const m = LIB[key]; if (!m) return;
    power += num(m.power,0); crew += num(m.crewRequired,0);
    field += num(m.protectiveField,0);
    const cm = m.combat || {};
    ['pd','jam','stealth','sensor','hangar'].forEach(k=>{
      if (cm[k]==null) return;
      pas[k] = (k==='pd') ? Math.min(0.6, pas.pd + num(cm.pd,0))
                          : Math.max(pas[k], num(cm[k],0));
    });
    if (cm.act){
      const ui = ACT_UI[cm.act] || { ru:cm.act, kind:'burst' };
      acts.push({
        k: cm.act, key, name: m.name || ui.ru, kind: ui.kind, ru: ui.ru,
        cd: Math.max(2, num(cm.cd,3) * TURN),          // ходы → секунды
        dur: ui.kind==='amp' ? 8 : (ui.kind==='cloak' ? 6 : 0),
        // ⚠️ ВОТ ОТКУДА БЫЛИ ВАНШОТЫ. Урон орудий растянут темпом перестрелки
        // (PACE), а урон активаций делился только на SCALE — то есть остался
        // в масштабе ДОСКИ, где торпеда «Голиаф» и должна сносить эсминец
        // одним попаданием, потому что там это целый ход. Рядом с растянутым
        // огнём орудий он оказывался ВОСЕМЬ РАЗ сильнее положенного: пушки
        // грызут корпус десятками секунд, а одна кнопка убирает борт целиком.
        // Модуль обязан ехать по тому же мосту, что и орудие, — иначе моста нет.
        // Лечение и щитовые прибавки (val) — по той же причине и тем же делом.
        dmg: cm.dmg!=null ? num(cm.dmg)/(SCALE*PACE) : 0,
        rng: cm.rng!=null ? num(cm.rng)*HEX : 0,
        // val — это либо ПРОЧНОСТЬ (дроны чинят, щит держит), либо ДОЛЯ
        // (усилитель даёт +0.6 к урону). Доли не масштабируются: 60% остаются
        // 60% в любом масштабе. Растягиваем только то, что измеряется в HP.
        val: num(cm.val,0) > 3 ? num(cm.val)/(SCALE*PACE) : num(cm.val,0),
        lor: m.lor || '',
      });
    }
  });
  return { pas, acts, power, crew, field };
}

// ── §7. Раскладка башен по палубе ────────────────────────────
// Правило секторов — то же, что выведено для стенда (dn_arena.js §1б):
// оконечность бьёт в свою полусферу ±135°, борт — ±115° вокруг траверза, любая
// точка вокруг корпуса накрыта минимум двумя стволами. Ново здесь другое:
// СКОЛЬКО башен у борта, решает не таблица, а КОРПУС — потолок отсеков класса
// (modul). У корвета их 24, у дредноута 112, и разница в числе стволов оттуда.
const A_END = 2.36, A_SIDE = 2.00;
// ⚠️ БАШЕН БЫЛО НЕРЕАЛИСТИЧНО МАЛО. Потолок в девять установок и кривая по
// корню давали линкору СЕМЬ стволов на весь борт — при том, что отсеков у него
// восемьдесят четыре. Корабль такого водоизмещения — это главный калибр в
// оконечностях ПЛЮС противоминная батарея по бортам ПЛЮС зенитные гнёзда, и
// именно их отсутствие делало палубу пустой, а силуэт — игрушечным.
// Счёт идёт прямо от отсеков корпуса: корвет 3, эсминец 5, крейсер 6,
// факельщик 9, линкор 12, дредноут 14.
// ⚠️ ПОТОЛОК В 14 — НЕ ВКУСОВЩИНА. Подвижных узлов у башни два (маска и
// стволы), и каждый — свой вызов отрисовки на КАЖДОМ борте: два десятка бортов
// в кадре умножают это число на двадцать. Выше четырнадцати кадр начинает
// стоить дороже, чем прибавка к виду.
function mountsOf(hull){
  const n = clamp(Math.round(hull.slots/7), 2, 14);
  const M = [];
  const push=(x,z,home,arc,role)=>M.push({ x, z, home, arc, role });
  // борта ставятся ПАРАМИ: несимметричная батарея выглядит как повреждение
  const pair=(x,role,z)=>{ push(x,-(z||0.97), -Math.PI/2, A_SIDE, role);
                           push(x, (z||0.97),  Math.PI/2, A_SIDE, role); };
  // Порядок значим: он же порядок ПРИОРИТЕТА. Сначала главный калибр в
  // оконечностях, потом возвышенная носовая, потом батарея — и так, чтобы на
  // любом числе установок борт оставался осмысленным кораблём.
  push( 0.34, 0, 0, A_END, 'main');                       // носовая
  push(-0.34, 0, Math.PI, A_END, 'main');                 // кормовая
  push( 0.15, 0, 0, 2.9, 'main');                         // возвышенная носовая
  pair(-0.04, 'sec');                                     // противоминная в миделе
  pair( 0.24, 'aa');                                      // зенитные гнёзда у бака
  push(-0.16, 0, Math.PI, 2.9, 'main');                   // возвышенная кормовая
  pair(-0.30, 'sec');                                     // кормовая батарея
  pair( 0.06, 'aa');                                      // зенитки у надстройки
  pair(-0.44, 'aa', 0.80);                                // на юте, обвод уже
  return M.slice(0, n);
}

// ── §8. Сборка борта ─────────────────────────────────────────
// loadout — то, что игрок собрал бы в верфи:
//   { cls, armor|alloy, guns:{main,sec,aa}, modules:[ключи] }
// guns.* — конфиги оружейной верфи (TG). Отсутствующий пункт просто не занимает
// палубу: борт без бортовых орудий выйдет с пустыми спонсонами, и это его беда.
function build(loadout, opt){
  const L = loadout || {}, cls = L.cls || 'destroyer';
  const hull = hullOf(cls);
  const arm  = armorOf(cls, L.armor, L.alloy);
  const mods = modulesOf(L.modules);
  const guns = {};
  ['main','sec','aa'].forEach(r=>{ if (L.guns && L.guns[r]) guns[r] = weaponOf(L.guns[r], r); });
  if (!guns.main) guns.main = weaponOf(DEF_GUN(cls), 'main');
  // ⚠️ СУПЕРОРУДИЕ — ШТУЧНАЯ УСТАНОВКА. В верфи оно занимает пол-палубы, и
  // «три таких же в линию» не бывает ни на одном проекте. Ставим его ровно
  // на одну башню, остальные носовые берут вспомогательный калибр.
  const superMain = !!(L.guns && L.guns.main && L.guns.main.klass === 'super');
  let mainUsed = false;
  const mounts = mountsOf(hull).map(m=>{
    let w = guns[m.role] || guns.sec || guns.main;
    if (m.role==='main' && superMain){
      if (mainUsed) w = guns.sec || guns.aa || guns.main; else { w = guns.main; mainUsed = true; }
    }
    return { x:m.x, z:m.z, home:m.home, arc:m.arc, role:m.role, w };
  });

  // ПРОЧНОСТЬ. ⚠️ ЕЁ ДАЁТ ОДНА ТОЛЬКО БРОНЯ — так считает и сервер
  // (_cn_deck_publish: hp = _cn_kv_armor_hp(класс, броня) × (1 + плита палубы)).
  // Голый корпус без плиты не «живучий сам по себе»: снял броню — снял корабль.
  // Плита палубы здесь не учитывается: раскладки палубы у пресета нет, а
  // выдумывать ей множитель значило бы врать. Проект из игры принесёт свой.
  const hp = Math.max(200, Math.round(arm.hp * (1 + num(L.plate,0)) / SCALE));
  // ЩИТ. Поле корпуса класса + щитовые модули проекта, если они стоят.
  const shield = Math.max(0, Math.round((hull.shieldBoost*160 + mods.field + num(L.shieldField,0))/SCALE));
  // ЭНЕРГИЯ под колесо мощности: реакторный запас борта. Крупный борт держит
  // режим дольше — у него и реактор крупнее.
  const en = clamp(Math.round(70 + hull.mass/2600), 80, 260);

  const spec = {
    key: (L.key || cls) + '|' + (L.armor||'alloy'),
    cls, name: L.name || hull.name, hullName: hull.name, about: L.about||'',
    len: hull.len, spd: hull.spd, acc: hull.acc, yaw: hull.yaw, lift: hull.lift,
    hp, shield, en, enRegen: Math.max(8, Math.round(en/9)),
    armor: arm, res: arm.resist,
    pd: mods.pas.pd, jam: mods.pas.jam, stealth: mods.pas.stealth,
    sensor: mods.pas.sensor, hangar: mods.pas.hangar,
    acts: mods.acts.slice(0,6), mounts, guns, slots: hull.slots,
    modules: (L.modules||[]).slice(),
  };
  spec.gun = guns.main;                 // ведущее орудие: ТТХ-строка и дальномер
  // ЦЕНА ПРОЕКТА В ГС — та же, что держава заплатила бы в верфи (cnKvPartGs:
  // сырьё корпуса и брони по курсу класса + плоская боевая цена своих орудий).
  // Нужна не для красоты: ею арена и уравнивает стороны, см. wing().
  const partGs = (o)=> (typeof cnKvPartGs==='function' && o) ? cnKvPartGs(o, cls) : 0;
  spec.gs = Math.round(partGs(hull.raw) + partGs(arm.obj)
          + mounts.reduce((a,m)=> a + (m.w ? num(m.w.gs,0) : 0), 0));
  if (opt && opt.debug) audit(spec);
  return spec;
}

// Орудие «по умолчанию» — не украшение, а честная сборка верфи под класс:
// чем крупнее корпус, тем крупнее установка, которую он тянет.
function DEF_GUN(cls){
  const i = Math.max(0, CLS_ORDER.indexOf(cls));
  if (i<=1) return { klass:'light',  tech:'ehs',  caliber:120, barrelLen:60, barrels:2, layout:'stacked', size:1 };
  if (i<=3) return { klass:'medium', tech:'rail', caliber:200, barrelLen:70, barrels:2, layout:'stacked', size:1 };
  if (i<=5) return { klass:'heavy',  tech:'ehs',  caliber:300, barrelLen:70, barrels:2, layout:'stacked', size:1 };
  return              { klass:'heavy',  tech:'rail', caliber:380, barrelLen:80, barrels:3, layout:'row',     size:1.1 };
}

// ── §9. Готовые проекты ──────────────────────────────────────
// Это не «классы арены», а ПРОЕКТЫ: такие корабли держава могла бы построить.
// Каждый — узнаваемая роль, собранная из настоящих узлов, а не набор цифр.
const PRESETS = {
  strizh: { key:'strizh', name:'Корвет «Стриж»', cls:'corvette',
    armor:'ram_paint',
    // ⚠️ АВТОПУШКИ КОРВЕТУ НЕ ПО ЧИНУ. Лёгкая кинетика на 90 мм даёт залп 279 —
    // в игре это оружие катера против катера, и в общей свалке корвет с ним не
    // царапал никого (двести попаданий на эсминец). Предельная ЛЁГКАЯ установка,
    // которую класс тянет по правилам верфи, — спаренный рельсотрон 140 мм: залп
    // втринадцать раз больше, а корпус остаётся бумажным. Это и есть корвет:
    // бьёт больно, живёт ровно до первого ответного залпа.
    guns:{ main:{ klass:'light', tech:'rail', caliber:140, barrelLen:90, barrels:2, layout:'stacked', size:1 } },
    modules:['md_blink','md_storm'],
    about:'Быстрый и злой: спаренные рельсы бьют не по-корветски, прыжок вытаскивает из клещей. Ответа не держит вовсе.' },

  vereten: { key:'vereten', name:'Эсминец «Веретено»', cls:'destroyer',
    armor:'ship_composite_x',
    guns:{ main:{ klass:'medium', tech:'rail',  caliber:180, barrelLen:80, barrels:2, layout:'stacked', size:1 },
           sec: { klass:'light',  tech:'laser', caliber:110, barrelLen:50, barrels:1, layout:'row',     size:1 } },
    modules:['md_tempest','md_repdrones','sidis_defense'],
    about:'Рабочая лошадь линии: рельсы на нос, лазеры по бортам, ПРО и дроны на живучесть.' },

  hor: { key:'hor', name:'Крейсер «Хорал»', cls:'mediumCruiser',
    armor:'ship_nano_lattice',
    guns:{ main:{ klass:'heavy',  tech:'laser', caliber:260, barrelLen:60, barrels:2, layout:'stacked', size:1 },
           sec: { klass:'medium', tech:'nano',  caliber:140, barrelLen:50, barrels:1, layout:'row',     size:1 },
           aa:  { klass:'aa',     tech:'laser', caliber:45,  barrelLen:60, barrels:4, layout:'quad',    size:0.9 } },
    modules:['md_pboost','md_repdrones','md_amlaser'],
    about:'Поддержка: ремонтный рой на союзника, импульс «Хорал» на звено, зенитки против ракет.' },

  fakel: { key:'fakel', name:'Факельщик «Кряж»', cls:'hyperCruiser',
    armor:'ship_giperhuina',
    guns:{ main:{ klass:'super', tech:'em',  caliber:380, barrelLen:100, barrels:1, layout:'row',     size:1.2 },
           sec: { klass:'light', tech:'ehs', caliber:100, barrelLen:50,  barrels:2, layout:'stacked', size:1 } },
    modules:['md_siege','md_goliath','md_ampl'],
    about:'Дальнобой: одно чудовищное орудие, осадная платформа и торпеда. Вблизи беспомощен.' },

  tsar: { key:'tsar', name:'Линкор «Царь-цитадель»', cls:'battleship',
    armor:'ship_heavy_bulkhead',
    guns:{ main:{ klass:'heavy',  tech:'ehs',     caliber:400, barrelLen:70, barrels:3, layout:'row',     size:1.1 },
           sec: { klass:'medium', tech:'plasma',  caliber:180, barrelLen:40, barrels:2, layout:'stacked', size:1 },
           aa:  { klass:'aa',     tech:'kinetic', caliber:40,  barrelLen:70, barrels:6, layout:'rotary',  size:0.9 } },
    modules:['md_broadside','md_apulse','sidis_defense'],
    about:'Стена: главный калибр, плазменный борт и броня, которую надо разгрызать.' },

  gnev: { key:'gnev', name:'Дредноут «Гнев»', cls:'dreadnought',
    armor:'ship_heavy_bulkhead',
    // ⚠️ СУПЕРОРУДИЕ С ДРЕДНОУТА СНЯТО. Спаренная рельса 460 мм даёт залп 57 302
    // — это осадная артиллерия по станциям, а не корабельный главный калибр:
    // ОДИН её выстрел снимал полтора корвета и три четверти эсминца, то есть
    // всё, что мельче линкора, она удаляла из боя до того, как оно доворачивало
    // корпус. Игра это позволяет — и цена там соответствующая (118 000 ГС,
    // дороже самого корабля), — но проект, собранный ТАК, это плохой проект, а
    // не сложный противник. «Гнев» несёт девять честных тяжёлых стволов 400 мм.
    guns:{ main:{ klass:'heavy', tech:'ehs',    caliber:400, barrelLen:80, barrels:3, layout:'row', size:1.1 },
           sec: { klass:'heavy', tech:'plasma', caliber:220, barrelLen:40,  barrels:2, layout:'stacked', size:1 },
           aa:  { klass:'aa',    tech:'laser',  caliber:50,  barrelLen:60,  barrels:4, layout:'quad',    size:0.9 } },
    modules:['md_nuke','md_ampl','md_stasis','md_amlaser'],
    about:'Всё сразу и ничего быстро: разворачивается вечность, но живым из-под него не уходят.' },
};
const PRESET_ORDER = ['strizh','vereten','hor','fakel','tsar','gnev'];

const CACHE = {};
function preset(key){
  if (CACHE[key]) return CACHE[key];
  const L = PRESETS[key] || PRESETS.vereten;
  return (CACHE[key] = build(L));
}

// ── §10. Проект из игры ──────────────────────────────────────
// faction_units.data — то, что лежит в базе у настоящего проекта. Сюжетный
// режим и кооп будут поднимать борт игрока ИМЕННО отсюда, а не из PRESETS.
function fromUnit(data, name){
  const d = data || {};
  const mods = (d.modules||[]).map(e=> e && (e.key || e.id || e.g)).filter(Boolean);
  const guns = {};
  const list = (d.weapons||[]).filter(Boolean);
  if (list[0]) guns.main = list[0].cfg || list[0];
  if (list[1]) guns.sec  = list[1].cfg || list[1];
  if (list[2]) guns.aa   = list[2].cfg || list[2];
  return build({ key:'unit:'+(d.id||''), name: name || d.name, cls: d.category || d.cls || 'destroyer',
                 armor: d.armor && (d.armor.key || d.armor), alloy: d.alloy,
                 guns, modules: mods, shieldField: d.shieldField });
}

// ── §10б. Стороны равны СИЛОЙ, а не числом ───────────────────
// ⚠️ ПОЧЕМУ НЕ ПО ГС. Первым заходом стороны уравнивались ценой проекта — это
// честная игровая цифра, но в бою она не работает: лёгкие автопушки корвета
// стоят копейки И бьют как копейки, а средняя рельса стоит вдесятеро и бьёт
// в тридцать раз больнее. Девять «дешёвых» корветов по цене эсминца выходили
// против него мясом. Экономика державы такой размен допускает; арена — нет.
//
// Поэтому счёт идёт по БОЕВОЙ ЦЕННОСТИ борта: живучесть × урон, свёрнутые
// корнем (классика размена «числом или качеством»: вдвое крепче и вдвое
// злее = вчетверо ценнее, то есть вчетверо меньше таких бортов на сторону).
// Обе величины взяты из игровых ТТХ, ничего постороннего в них нет.
function bv(spec){ return Math.sqrt(Math.max(1,(spec.hp+spec.shield)) * Math.max(1, dpsOf(spec))); }
// Сколько таких бортов встаёт на сторону при заданном запасе силы.
function wing(spec, budget){
  return clamp(Math.round(num(budget, BUDGET) / Math.max(1, bv(spec))), 1, 9);
}
// Запас силы стороны: примерно три линейных эсминца «Веретено».
const BUDGET = 500;

// ── §11. Сверка ──────────────────────────────────────────────
// Печатает то, ради чего вся эта арифметика: чем борт бьёт и сколько держит.
// Если TTK уезжает в секунды или в минуты — крутить надо SCALE и TURN, а не
// ТТХ. Зовите DNK.auditAll() из консоли стенда.
function dpsOf(spec){
  return spec.mounts.reduce((a,m)=>{
    const w=m.w; if(!w) return a;
    return a + w.dps;
  },0);
}
function audit(spec){
  const line = { борт:spec.name, 'ГС':spec.gs, 'сила':Math.round(bv(spec)), 'в звене':wing(spec), корпус:spec.hp, щит:spec.shield,
                 'урон/с':Math.round(dpsOf(spec)),
                 'дальность гл.калибра':spec.gun && spec.gun.rng,
                 ход:spec.spd, башен:spec.mounts.length,
                 'к/э/р':[spec.res.kinetic,spec.res.energy,spec.res.missile].join('/'),
                 активаций:spec.acts.length };
  if (window.console) (console.table ? console.table([line]) : console.log(line));
  return line;
}
function auditAll(){
  const rows = PRESET_ORDER.map(k=>audit(preset(k)));
  return rows;
}

return { SCALE, TURN, HEX, PACE, CHAN, BUDGET, falloff, build, preset, fromUnit, dpsOf, wing,
         bv, PRESETS, PRESET_ORDER, CLS_ORDER, CLS_RU, hullOf, armorOf, weaponOf,
         modulesOf, mountsOf, ACT_UI, audit, auditAll };
})();
