// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════
// CONSTRUCTORS — конструкторы юнитов фракций (корабли / наземная техника /
// авиация / дивизии) + каталоги. Данные: Supabase (faction_units).
// Доступ: одобренная анкета государства ИЛИ superadmin/editor.
// Зависит от: core.js (dbGet/dbPost/dbPatch/dbDel, esc, toast, setPg, go),
//             auth.js (user), faction_applications (см. _faction_setup.sql)
// ════════════════════════════════════════════════════════════

const CN = {
  cat: null, def: null,           // активный билдер
  edit: null,                     // редактируемый юнит (или null)
  last: null,                     // последний расчёт ТТХ (для публикации)
  myApp: null, myAppUid: null,    // моя одобренная анкета (кэш по user.id)
  factions: null,                 // список одобренных фракций (для стаффа)
  busy: false,
};

const cnId = id => document.getElementById(id);
const cnNum = n => Number(n || 0).toLocaleString('ru-RU');

// ── Доступ и фракция ────────────────────────────────────────
function cnIsStaff() { return !!(user && ['superadmin', 'editor'].includes(user.role)); }
function cnFactionReady() { return !!(user && CN.myAppUid === user.id); }
async function cnLoadMyFaction() {
  if (!user) { CN.myApp = null; CN.myAppUid = null; return null; }
  if (CN.myAppUid === user.id) return CN.myApp;
  try {
    const rows = await dbGet('faction_applications', `owner_id=eq.${user.id}&status=eq.approved&order=updated_at.desc&limit=1`);
    CN.myApp = (rows && rows[0]) ? rows[0] : null;
  } catch (e) { CN.myApp = null; }
  CN.myAppUid = user.id;
  return CN.myApp;
}
async function cnLoadApprovedFactions() {
  if (CN.factions) return CN.factions;
  try { CN.factions = await dbGet('faction_applications', 'status=eq.approved&select=faction_id,name,color&order=name.asc') || []; }
  catch (e) { CN.factions = []; }
  return CN.factions;
}
// синхронная проверка (для nav); точна только после cnLoadMyFaction()
function cnCanAccess() {
  if (!user) return false;
  if (cnIsStaff()) return true;
  return !!(cnFactionReady() && CN.myApp);
}
// фоновая догрузка анкеты для nav → перерисовка, когда станет известно
let _cnNavLoading = false;
function cnNavEnsure() {
  if (!user || cnIsStaff() || cnFactionReady() || _cnNavLoading) return;
  _cnNavLoading = true;
  cnLoadMyFaction().finally(() => { _cnNavLoading = false; if (typeof buildNav === 'function') buildNav(); });
}
// метаданные фракции для сохранения (моя анкета)
function cnMyFactionMeta() {
  if (CN.myApp) return { faction_id: CN.myApp.faction_id || null, faction_name: CN.myApp.name || '', faction_color: CN.myApp.color || '' };
  return null;
}

// ── Гейт-заглушка ───────────────────────────────────────────
function cnGate() {
  setPg(`<div class="cn-gate">
    <div class="cn-gate-ico">⚒</div>
    <h2>Доступ к конструкторам</h2>
    <p>Конструкторы доступны игрокам с <b>одобренной анкетой государства</b>, а также администрации.</p>
    ${user
      ? `<p class="cn-gate-sub">Подайте анкету фракции и дождитесь одобрения — после этого вы сможете создавать технику от её имени.</p>
         <button class="btn btn-gd" onclick="go('factions')">К фракциям</button>`
      : `<p class="cn-gate-sub">Войдите в аккаунт, чтобы продолжить.</p>
         <button class="btn btn-gd" onclick="showAuth('login')">Войти</button>`}
  </div>`);
}

// ════════════════════════════════════════════════════════════
// ХАБ КОНСТРУКТОРОВ (#constructors)
// ════════════════════════════════════════════════════════════
const CN_HUB = [
  { slug: 'build-ship', ico: '🚀', name: 'Корабельная верфь', desc: 'Космические корабли: от корветов до дредноутов. Реактор, броня, щиты, ангары, вооружение.', cat: 'ship' },
  { slug: 'build-army', ico: '🪖', name: 'Планетарный арсенал', desc: 'Единый конструктор армии: пехота, БТР, танки, артиллерия, дроны, авиация. Ходовая, броня, орудия — по правилам Кваквантора.', cat: 'army' },
  { slug: 'build-alloy', ico: '⚗', name: 'Материаловедение', desc: 'Своя броня из настоящих ресурсов. Пропорции решают: реакции и пороги рождают HP, стойкости и трейты. Сплавы идут в слот брони всех конструкторов.', cat: 'alloy' },
  { slug: 'build-turret', ico: '⚙', name: 'Оружейная верфь', desc: 'Своё орудие: класс установки, технология, калибр и стволы. Масса и энергия решают, кто его потянет. Готовые орудия идут в слот вооружения всех конструкторов.', cat: 'turret' },
  // Конструктор дивизий убран из хаба: армии теперь формируются из готовых юнитов
  // («Звёздный марш»). Билдер доступен только для правки уже созданных дивизий (cnEdit).
];

async function cnRenderHub() {
  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);
  await cnLoadMyFaction();
  if (!cnCanAccess()) { cnGate(); return; }
  const fac = cnMyFactionMeta();
  const facLine = fac
    ? `<div class="cn-hub-faction">От имени фракции: <b style="color:${esc(frReadable(fac.faction_color))}">${esc(fac.faction_name || '—')}</b></div>`
    : cnIsStaff() ? `<div class="cn-hub-faction">Режим администрации — фракция выбирается при публикации.</div>` : '';
  const cards = CN_HUB.map(h => `<div class="cn-hub-card" onclick="${h.url ? `location.href='${h.url}'` : `go('${h.slug}')`}">
      <div class="cn-hub-ico">${h.ico}</div>
      <div class="cn-hub-main">
        <div class="cn-hub-name">${esc(h.name)}</div>
        <div class="cn-hub-desc">${esc(h.desc)}</div>
      </div>
      <div class="cn-hub-arr">→</div>
    </div>`).join('');
  setPg(`<div class="cn-wrap">
    <div class="cn-head">
      <div class="cn-eyebrow">◈ ПРОИЗВОДСТВО</div>
      <h1>Конструкторы</h1>
      ${facLine}
    </div>
    <div class="cn-hub-grid">${cards}</div>
    <div class="cn-hub-cats">
      <span>Каталоги:</span>
      <a onclick="go('cat-ships')">Флот</a>
      <a onclick="go('cat-ground')">Наземная техника</a>
      <a onclick="go('cat-aviation')">Авиация</a>
      <a onclick="go('cat-divisions')">Дивизии</a>
    </div>
  </div>`);
}

// ════════════════════════════════════════════════════════════
// БАЗЫ ДАННЫХ БИЛДЕРОВ (портированы дословно)
// ════════════════════════════════════════════════════════════

// ── КОРАБЛИ ──
const CN_SHIP = {
  data: {
    corvette: { name: "Корвет", baseON: 2, modON: 0.5, types: [{ name: "Быстрый корвет", hp: 500, armor: 200, cost: 10 }, { name: "Эскадренный корвет", hp: 750, armor: 100, cost: 10 }, { name: "Сторожевой корвет", hp: 1000, armor: 300, cost: 10 }] },
    frigate: { name: "Фрегат", baseON: 4, modON: 1, types: [{ name: "Рейдерский фрегат", hp: 2500, armor: 850, cost: 25 }, { name: "Сторожевой корабль", hp: 3500, armor: 1000, cost: 25 }, { name: "Тяжёлый фрегат", hp: 5000, armor: 2350, cost: 25 }] },
    destroyer: { name: "Эсминец", baseON: 6, modON: 1.5, types: [{ name: "Сторожевой эсминец", hp: 3000, armor: 50, cost: 50 }, { name: "Ракетный эсминец", hp: 4000, armor: 50, cost: 50 }] },
    cruiser: { name: "Крейсер", baseON: 8, modON: 2, types: [{ name: "Лёгкий крейсер", hp: 5000, armor: 2000, cost: 100 }, { name: "Рейдерский крейсер", hp: 4000, armor: 3000, cost: 100 }, { name: "Артиллерийский крейсер", hp: 6000, armor: 4000, cost: 100 }, { name: "Линейный крейсер", hp: 8000, armor: 7500, cost: 100 }] },
    battleship: { name: "Линейный корабль", baseON: 10, modON: 3, types: [{ name: "Артиллерийский корабль", hp: 15000, armor: 10000, cost: 1000 }, { name: "Тяжелый линейный корабль", hp: 20000, armor: 15000, cost: 2000 }] },
    dreadnought: { name: "Дредноут", baseON: 12, modON: 4, types: [{ name: "Артиллерийский дредноут", hp: 40000, armor: 20000, cost: 4000 }, { name: "Броненосный дредноут", hp: 50000, armor: 30000, cost: 5000 }] }
  },
  reactors: {
    corvette: [{ name: "ТГУ-25А", energy: 2000, cost: 5 }, { name: "СИГУ-27Б", energy: 2250, cost: 15 }, { name: "ПЛГУ-28В", energy: 2500, cost: 25 }, { name: "РНГУ-30Г", energy: 3000, cost: 35 }],
    frigate: [{ name: "ТГУ-30А", energy: 3000, cost: 50 }, { name: "СИГУ-33Б", energy: 3250, cost: 75 }, { name: "ПЛГУ-37В", energy: 3500, cost: 100 }, { name: "РНГУ-45Г", energy: 4000, cost: 125 }],
    destroyer: [{ name: "ТГУ-40А", energy: 4000, cost: 250 }, { name: "СИГУ-42Б", energy: 4250, cost: 275 }, { name: "ПЛГУ-44В", energy: 4500, cost: 300 }, { name: "РНГУ-46Г", energy: 5000, cost: 325 }],
    cruiser: [{ name: "ТГУ-52А", energy: 6000, cost: 450 }, { name: "СИГУ-55Б", energy: 6250, cost: 475 }, { name: "ПЛГУ-58В", energy: 6500, cost: 500 }, { name: "РНГУ-51Г", energy: 7000, cost: 525 }],
    battleship: [{ name: "ТГУ-65А", energy: 8500, cost: 800 }, { name: "СИГУ-68Б", energy: 10250, cost: 1900 }, { name: "ПЛГУ-72В", energy: 15500, cost: 2000 }, { name: "РНГУ-75Г", energy: 25000, cost: 3000 }],
    dreadnought: [{ name: "ТГУ-88А", energy: 15000, cost: 3000 }, { name: "СИГУ-92Б", energy: 20250, cost: 5000 }, { name: "ПЛГУ-95В", energy: 30500, cost: 10000 }, { name: "РНГУ-101Г", energy: 35000, cost: 15000 }]
  },
  shields: {
    corvette: [{ name: "Дефлекторный", shield: 5000, energy: 500, cost: 100 }, { name: "Энергетический", shield: 2500, energy: 500, cost: 50 }, { name: "Корпускулярный", shield: 1000, energy: 400, cost: 25 }],
    frigate: [{ name: "Дефлекторный", shield: 10000, energy: 500, cost: 200 }, { name: "Энергетический", shield: 5000, energy: 500, cost: 100 }, { name: "Корпускулярный", shield: 2500, energy: 400, cost: 75 }],
    destroyer: [{ name: "Дефлекторный", shield: 15000, energy: 500, cost: 300 }, { name: "Энергетический", shield: 10000, energy: 500, cost: 250 }, { name: "Корпускулярный", shield: 5000, energy: 400, cost: 200 }],
    cruiser: [{ name: "Дефлекторный", shield: 25000, energy: 800, cost: 450 }, { name: "Энергетический", shield: 1500, energy: 600, cost: 350 }, { name: "Корпускулярный", shield: 10000, energy: 500, cost: 300 }],
    battleship: [{ name: "Дефлекторный", shield: 50000, energy: 2000, cost: 1500 }, { name: "Энергетический", shield: 25000, energy: 1500, cost: 1300 }, { name: "Корпускулярный", shield: 15000, energy: 1200, cost: 1000 }],
    dreadnought: [{ name: "Дефлекторный", shield: 80000, energy: 4000, cost: 3000 }, { name: "Энергетический", shield: 50000, energy: 2800, cost: 2700 }, { name: "Корпускулярный", shield: 25000, energy: 2000, cost: 2000 }]
  },
  armors: {
    corvette: [{ name: "Эскортная", armor: 2000, cost: 25 }, { name: "Навесная экранированная", armor: 4000, cost: 50 }],
    frigate: [{ name: "Сторожевая", armor: 3000, cost: 50 }, { name: "Тяжёлая фрегатная", armor: 5000, cost: 75 }],
    destroyer: [{ name: "Эскортная миноносная", armor: 4000, cost: 100 }, { name: "Рейдерская", armor: 6500, cost: 150 }, { name: "Тяжёлая навесная", armor: 8000, cost: 200 }],
    cruiser: [{ name: "Облегчённая крейсерская", armor: 10000, cost: 300 }, { name: "Экранированная система бронирования", armor: 15000, cost: 500 }],
    battleship: [{ name: "Линейная броня", armor: 30000, cost: 2000 }, { name: "Многоуровневая экранированная броня", armor: 50000, cost: 4000 }],
    dreadnought: [{ name: "Дредноутовская", armor: 75000, cost: 8000 }, { name: "Тяжёлая навесная броня", armor: 120000, cost: 15000 }]
  },
  engines: {
    corvette: [{ name: "4 ионных турбореактивных двигателя", cost: 50, energy: 100, speed: 25 }, { name: "2 плазменных скоростных двигателя", cost: 100, energy: 250, speed: 40 }],
    frigate: [{ name: "3 ионных реактивных двигателя", cost: 200, energy: 125, speed: 23 }, { name: "1 плазменный маршевый двигатель", cost: 250, energy: 200, speed: 35 }],
    destroyer: [{ name: "2 электро-химических реактивных двигателя", cost: 300, energy: 140, speed: 19 }, { name: "4 ионных маршевых двигателя", cost: 400, energy: 300, speed: 28 }],
    cruiser: [{ name: "3 ионных маршевых двигателя", cost: 500, energy: 200, speed: 20 }, { name: "3 плазменных маршевых двигателей", cost: 700, energy: 400, speed: 30 }],
    battleship: [{ name: "6 ионных маршевых двигателей", cost: 800, energy: 500, speed: 17 }, { name: "4 плазменных маршевых двигателя", cost: 1000, energy: 800, speed: 22 }],
    dreadnought: [{ name: "6 ионных маршевых двигателей", cost: 1500, energy: 600, speed: 16 }, { name: "4 плазменных маршевых двигателей", cost: 2000, energy: 1000, speed: 20 }]
  },
  weapons: {
    "Легкие": [{ name: "40-мм сдвоенное баллистическое орудие", cost: 1, energy: 50, dmg: 50 }, { name: "60-мм одиночное баллистическое орудие", cost: 1, energy: 75, dmg: 75 }, { name: "лёгкое одиночное лазерное импульсное орудие", cost: 1, energy: 25, dmg: 25 }, { name: "лёгкое одиночное электромагнитное орудие", cost: 1, energy: 125, dmg: 125 }],
    "Средние": [{ name: "100-мм рельсовый ускоритель масс", cost: 5, energy: 100, dmg: 100 }, { name: "120-мм двойное баллистическое орудие", cost: 5, energy: 100, dmg: 100 }, { name: "сдвоенное турболазерное орудие", cost: 5, energy: 100, dmg: 100 }, { name: "одиночное электромагнитное орудие", cost: 5, energy: 300, dmg: 300 }],
    "Тяжёлые": [{ name: "240-мм рельсовый ускоритель масс", cost: 25, energy: 200, dmg: 200 }, { name: "300-мм тройное баллистическое орудие", cost: 25, energy: 300, dmg: 300 }, { name: "четырехствольное мегалазерное орудие", cost: 25, energy: 500, dmg: 500 }, { name: "тяжелое одиночное импульсное орудие", cost: 25, energy: 500, dmg: 500 }],
    "Сверхтяжёлые": [{ name: "380-мм рельсовый ускоритель масс", cost: 100, energy: 1000, dmg: 1000 }, { name: "400-мм сдвоенное баллистическое орудие", cost: 100, energy: 2000, dmg: 2000 }, { name: "четырехствольное ланцетное орудие", cost: 100, energy: 2500, dmg: 2500 }],
    "Ракетное": [{ name: "лёгкая шестиствольная пусковая установка", cost: 1, energy: 50, dmg: 120 }, { name: "тяжелая четырехствольная пусковая установка", cost: 50, energy: 200, dmg: 400 }, { name: "шахта баллистической ракеты", cost: 100, energy: 500, dmg: 1000 }],
    "Зенитное": [{ name: "сдвоенный лазерный пулемёт", cost: 90, energy: 50, dmg: 100 }, { name: "восьмиствольное ПВО орудие", cost: 240, energy: 200, dmg: 250 }, { name: "Ракета-перехватчик", cost: 25, energy: 10, dmg: 200 }]
  },
  modules: {
    "Радарное оборудование": [{ name: "Система общей связи", cost: 10, energy: 100 }, { name: "Локальная связь", cost: 5, energy: 50 }, { name: "Многоцелевой сканер (+250км)", cost: 10, energy: 100 }, { name: "Сканер дальнего обнаружения (+500км)", cost: 25, energy: 200 }, { name: "Гравитационный радар (+250км)", cost: 150, energy: 500 }, { name: "Тепловой сканер (+250км)", cost: 200, energy: 500 }],
    "Радиоэлектронная борьба": [{ name: "Купол СЭБ-57 (+10 под./+5 защ.)", cost: 100, energy: 1000 }, { name: "Активные помехи (+2 под.)", cost: 5, energy: 250 }, { name: "Усилитель подавления (+5 под.)", cost: 10, energy: 300 }, { name: "Нейтрализатор помех (+5 защ.)", cost: 10, energy: 300 }],
    "Активная защита": [{ name: "Оптико-электронные станции", cost: 40, energy: 400 }, { name: "Комплект теплового подавления", cost: 300, energy: 800 }, { name: "Дроны-перехватчики", cost: 100, energy: 300 }],
    "Управление": [{ name: "БИУС Флагман", cost: 30, energy: 200 }, { name: "АСУО Терминус", cost: 30, energy: 200 }, { name: "Системный ИИ", cost: 100, energy: 400 }],
    "Спец. системы": [{ name: "Сверхдвигатель Фотон", cost: 30, energy: 400 }, { name: "Варп-двигатель Слобода", cost: 100, energy: 800 }]
  },
  hangarTypes: [
    { id: 0, name: "Эскортный ангар", cost: 50, energy: 500, capacity: 8, canHaveUnits: true },
    { id: 1, name: "Стандартный ангар", cost: 100, energy: 1000, capacity: 24, canHaveUnits: true },
    { id: 2, name: "Крупный ангар", cost: 200, energy: 1500, capacity: 48, canHaveUnits: true },
    { id: 3, name: "Транспортный ангар", cost: 50, energy: 300, capacity: 20, canHaveUnits: false },
    { id: 4, name: "Грузовой ангар", cost: 30, energy: 200, capacity: 10, canHaveUnits: false }
  ],
  airUnits: [
    { name: "12 истребителей", points: 4 },
    { name: "12 бомбардировщиков", points: 4 },
    { name: "12 дронов", points: 2 },
    { name: "2 транспортника", points: 8 }
  ],
};

// ── НАЗЕМНАЯ ТЕХНИКА ──
const CN_GROUND = {
  data: {
    light: { name: "Лёгкая техника (БТР/БМП)", baseON: 1, modON: 0.5, hp: 300, cost: 150 },
    medium: { name: "Средний боевой танк", baseON: 2, modON: 1, hp: 800, cost: 450 },
    artillery: { name: "Артиллерия / САУ / РСЗО", baseON: 3, modON: 1, hp: 600, cost: 700 },
    heavy: { name: "Тяжёлый танк", baseON: 4, modON: 1.5, hp: 1500, cost: 900 },
    walker: { name: "Тяжелый шагоход", baseON: 6, modON: 2, hp: 3000, cost: 1500 }
  },
  engines: {
    light: [{ name: "Колесная база (8x8)", speed: 100, cost: 20 }, { name: "Легкие гусеницы", speed: 70, cost: 35 }, { name: "Легкий репульсор", speed: 120, cost: 80 }],
    medium: [{ name: "Стандартные гусеницы", speed: 55, cost: 50 }, { name: "Средний репульсор", speed: 80, cost: 120 }],
    artillery: [{ name: "Колёсное шасси (САУ)", speed: 60, cost: 60 }, { name: "Гусеничное шасси (САУ)", speed: 40, cost: 90 }, { name: "Буксируемая платформа", speed: 15, cost: 25 }],
    heavy: [{ name: "Усиленные гусеницы", speed: 40, cost: 100 }, { name: "Тяжелый репульсор", speed: 60, cost: 250 }],
    walker: [{ name: "Двуногая система", speed: 45, cost: 300 }, { name: "Четырехногая система", speed: 25, cost: 600 }]
  },
  armors: {
    light: [{ name: "Легкая композитная", armor: 150, cost: 30 }, { name: "Усиленная противоосколочная", armor: 250, cost: 50 }],
    medium: [{ name: "Стандартная гомогенная", armor: 500, cost: 80 }, { name: "Динамическая защита", armor: 700, cost: 150 }],
    artillery: [{ name: "Открытая платформа", armor: 100, cost: 20 }, { name: "Противоосколочная рубка", armor: 350, cost: 70 }, { name: "Бронированная рубка", armor: 600, cost: 130 }],
    heavy: [{ name: "Тяжелая композитная", armor: 1200, cost: 200 }, { name: "Многослойная экранированная", armor: 1800, cost: 350 }],
    walker: [{ name: "Тяжелая шагоходная", armor: 2000, cost: 400 }, { name: "Звездное покрытие", armor: 3500, cost: 1000 }]
  },
  shields: {
    light: [{ name: "Отсутствует", shield: 0, cost: 0 }, { name: "Легкий дефлектор", shield: 200, cost: 100 }],
    medium: [{ name: "Отсутствует", shield: 0, cost: 0 }, { name: "Танковый генератор поля", shield: 600, cost: 250 }],
    artillery: [{ name: "Отсутствует", shield: 0, cost: 0 }, { name: "Лёгкий дефлектор", shield: 300, cost: 150 }],
    heavy: [{ name: "Отсутствует", shield: 0, cost: 0 }, { name: "Тяжелый щитовой купол", shield: 1500, cost: 500 }],
    walker: [{ name: "Отсутствует", shield: 0, cost: 0 }, { name: "Промышленный генератор щита", shield: 4000, cost: 1200 }]
  },
  weapons: {
    "Противопехотное": [{ name: "Сдвоенный бластерный пулемет", cost: 20, dmg: 40 }, { name: "Тяжелый огнемет", cost: 25, dmg: 60 }, { name: "Осколочный гранатомет", cost: 30, dmg: 80 }],
    "Противотанковое": [{ name: "Тяжелая лазерная пушка", cost: 80, dmg: 250 }, { name: "Рельсовое орудие (120мм)", cost: 120, dmg: 350 }, { name: "Плазменный луч", cost: 500, dmg: 1000 }],
    "Артиллерия и ПВО": [{ name: "Ракетная установка (6 стволов)", cost: 150, dmg: 400 }, { name: "Зенитная спаренная автопушка", cost: 100, dmg: 150 }, { name: "Тяжелая гаубица (САУ)", cost: 250, dmg: 800 }]
  },
  modules: {
    "Оптика и Связь": [{ name: "Командирская радиостанция", cost: 15 }, { name: "Тепловизор / Ночное видение", cost: 30 }, { name: "Голографический целеуказатель", cost: 50 }],
    "Защита и Поддержка": [{ name: "Система дымовой завесы", cost: 20 }, { name: "Активная защита (сбивание ракет)", cost: 120 }, { name: "Ремонтный дроид (автопочинка)", cost: 200 }]
  },
};

// ── АВИАЦИЯ ──
const CN_AIR = {
  data: {
    light: { name: "Лёгкая авиация", baseON: 1, modON: 0.2, types: [{ name: "Истребитель", hp: 80, armor: 20, cost: 35 }, { name: "Истребитель-дрон", hp: 60, armor: 10, cost: 25 }, { name: "Разведывательный дрон", hp: 40, armor: 5, cost: 25 }] },
    medium: { name: "Средняя авиация", baseON: 2, modON: 0.5, types: [{ name: "Перехватчик", hp: 120, armor: 40, cost: 60 }, { name: "Космический бомбардировщик", hp: 150, armor: 60, cost: 80 }] },
    heavy: { name: "Тяжелая авиация", baseON: 3, modON: 1.0, types: [{ name: "Многоцелевой истребитель", hp: 200, armor: 80, cost: 120 }, { name: "Тяжелый бомбардировщик", hp: 300, armor: 120, cost: 150 }, { name: "Ракетоносец", hp: 250, armor: 100, cost: 140 }] },
    cargo: { name: "Грузовые шаттлы", baseON: 1, modON: 0.5, types: [{ name: "Транспортный шаттл", hp: 200, armor: 50, cost: 50 }, { name: "Десантный шаттл", hp: 250, armor: 150, cost: 90 }] }
  },
  reactors: {
    light: [{ name: "Микро-ячейка ПТ-1", energy: 50, cost: 5 }, { name: "Ионный энергоблок ПТ-2", energy: 100, cost: 15 }],
    medium: [{ name: "Стандартный реактор СТ-1", energy: 150, cost: 10 }, { name: "Усиленный реактор СТ-2", energy: 250, cost: 25 }],
    heavy: [{ name: "Двойной реактор ТЖ-1", energy: 300, cost: 20 }, { name: "Плазменное ядро ТЖ-2", energy: 500, cost: 40 }],
    cargo: [{ name: "Транспортный реактор ГР-1", energy: 200, cost: 10 }, { name: "Коммерческий реактор ГР-2", energy: 350, cost: 25 }]
  },
  armors: {
    light: [{ name: "Легкая дюрастиловая", armor: 10, cost: 5 }, { name: "Противоосколочная сетка", armor: 25, cost: 10 }],
    medium: [{ name: "Стандартная обшивка", armor: 30, cost: 10 }, { name: "Композитные пластины", armor: 60, cost: 20 }],
    heavy: [{ name: "Тяжелая броня", armor: 80, cost: 20 }, { name: "Армированная наноброня", armor: 150, cost: 45 }],
    cargo: [{ name: "Грузовая обшивка", armor: 40, cost: 10 }, { name: "Десантное бронирование", armor: 120, cost: 30 }]
  },
  shields: {
    light: [{ name: "Без щита", shield: 0, energy: 0, cost: 0 }, { name: "Легкий дефлектор", shield: 50, energy: 30, cost: 15 }],
    medium: [{ name: "Без щита", shield: 0, energy: 0, cost: 0 }, { name: "Стандартный дефлектор", shield: 100, energy: 60, cost: 25 }],
    heavy: [{ name: "Без щита", shield: 0, energy: 0, cost: 0 }, { name: "Тактический щит", shield: 250, energy: 120, cost: 40 }],
    cargo: [{ name: "Без щита", shield: 0, energy: 0, cost: 0 }, { name: "Навигационный дефлектор", shield: 150, energy: 80, cost: 20 }]
  },
  engines: {
    light: [{ name: "2 ионных маневровых двигателя", cost: 10, energy: 10, speed: 120 }, { name: "Плазменный форсажный двигатель", cost: 25, energy: 30, speed: 180 }],
    medium: [{ name: "2 стандартных ионных двигателя", cost: 15, energy: 20, speed: 90 }, { name: "Сдвоенный плазменный ускоритель", cost: 35, energy: 50, speed: 140 }],
    heavy: [{ name: "4 ионных маршевых двигателя", cost: 20, energy: 40, speed: 70 }, { name: "Векторный плазменный двигатель", cost: 50, energy: 80, speed: 110 }],
    cargo: [{ name: "Грузовой ионный двигатель", cost: 15, energy: 30, speed: 50 }, { name: "Усиленный транспортный привод", cost: 30, energy: 60, speed: 75 }]
  },
  weapons: {
    "Курсовое вооружение": [{ name: "Сдвоенная лазерная пушка", cost: 5, energy: 10, dmg: 15 }, { name: "Тяжелый бластерный ретранслятор", cost: 15, energy: 25, dmg: 30 }, { name: "Скорострельная автопушка (Кинетика)", cost: 10, energy: 5, dmg: 20 }],
    "Ракетное и бомбовое": [{ name: "Установка ракет 'Воздух-Воздух' (4 шт)", cost: 20, energy: 5, dmg: 60 }, { name: "Протонные торпеды (Для тяжелых/бомбер)", cost: 40, energy: 10, dmg: 150 }, { name: "Кластерные бомбы", cost: 30, energy: 5, dmg: 100 }],
    "Спецоборудование": [{ name: "Хвостовая турель защиты", cost: 15, energy: 15, dmg: 10 }, { name: "Ионная пушка (Отключение систем)", cost: 25, energy: 40, dmg: 5 }]
  },
  modules: {
    "Авионика и Радары": [{ name: "Стандартный радар", cost: 5, energy: 10 }, { name: "Система захвата цели (Продвинутая)", cost: 15, energy: 20 }, { name: "Разведывательный сканер", cost: 20, energy: 30 }],
    "Защита и РЭБ": [{ name: "Генератор помех (ECM)", cost: 20, energy: 25 }, { name: "Тепловые ловушки (Flares)", cost: 10, energy: 5 }, { name: "Усиленные компенсаторы перегрузок", cost: 15, energy: 10 }],
    "Служебные": [{ name: "Система жизнеобеспечения (Пилот)", cost: 5, energy: 5 }, { name: "Гипердвигатель 1-го класса", cost: 40, energy: 60 }, { name: "Увеличенный топливный бак", cost: 10, energy: 0 }]
  },
};

// ── Дескрипторы билдеров техники (ship/ground/aviation) ──
// СИНТЕЗ: форжи потребляют данные Кваквантора (window.KV_DB). Если модуль KV не
// загрузился (кэш старого index.html) — откат на прежние каталоги, чтобы не сломать
// вернувшихся пользователей до обновления кэша. KV-классы: без типов/ангаров.
const _KVD = (typeof window !== 'undefined' && window.KV_DB) || null;
const CN_DEFS = {
  ship: {
    cat: 'ship', db: _KVD ? _KVD.ship : CN_SHIP, title: 'Корабельная верфь', subtitle: 'Project Shipyard — космический флот',
    nameLabel: 'Название корабля', classLabel: 'Класс корпуса', engineLabel: 'Двигательная установка',
    hasType: !_KVD, hasReactor: true, hasEnergy: false, hasHangars: false, cardUI: true,
    excl: () => false,
  },
  ground: {
    cat: 'ground', db: _KVD ? _KVD.ground : CN_GROUND, title: 'Завод тяжёлого машиностроения', subtitle: 'GroundForge — наземная техника',
    nameLabel: 'Серийное название модели', classLabel: 'Класс техники', engineLabel: 'Ходовая часть',
    hasType: false, hasReactor: true, hasEnergy: false, hasHangars: false, cardUI: _KVD ? false : false,
    excl: () => false,
  },
  aviation: {
    cat: 'aviation', db: _KVD ? _KVD.aviation : CN_AIR, title: 'Аэрокосмический сборочный цех', subtitle: 'AeroForge — авиация',
    nameLabel: 'Позывной / Название модели', classLabel: 'Весовая категория', engineLabel: 'Маршевые двигатели',
    hasType: !_KVD, hasReactor: true, hasEnergy: false, hasHangars: false,
    excl: () => false,
  },
  // Единый форж армии (пехота + техника + авиация). Без KV откатываемся на CN_GROUND,
  // а старые роуты build-ground/build-aviation остаются алиасами этого форжа.
  army: {
    cat: 'army', db: _KVD ? _KVD.army : CN_GROUND, title: 'Планетарный арсенал', subtitle: 'ArmyForge — пехота, техника, авиация',
    nameLabel: 'Серийное название модели', classLabel: 'Класс юнита', engineLabel: 'Ходовая / маршевые двигатели',
    // Тот же визуальный движок, что у корабельной верфи (карточки + схема узлов)
    hasType: false, hasReactor: true, hasEnergy: false, hasHangars: false, cardUI: !!_KVD,
    excl: () => false,
  },
};
// ── Масштаб нагрузки на шасси ────────────────────────────────
// «Грузоподъёмность» (kv.cap) — единый бюджет шасси: сколько ещё можно навесить,
// а что осталось свободным, то и увозит караван (_ship_cargo читает kv_cargo).
// Единица нагрузки НЕ равна килограмму: у кораблей это ~500 кг, у наземки и
// авиации ~100 кг. Поэтому в карточке компонента физическая МАССА (weight, кг)
// и НАГРУЗКА на шасси показаны отдельными строками — раньше нагрузку подписывали
// «Масса, кг», и два разных числа выглядели как одно.
const CN_LOAD_DIV = { ship: 500, ground: 100, aviation: 100, army: 100 };
// Класс единого форжа → фактическая категория БД (каталоги/исследования/SQL живут
// в разрезе ground/aviation, менять их контракт нельзя).
function cnKvRealCat(k) {
  const C = (typeof window !== 'undefined' && window.KV_CAT_CLASSES) || null;
  return (C && C.aviation.indexOf(k) >= 0) ? 'aviation' : 'ground';
}

// ════════════════════════════════════════════════════════════
// ВИЗУАЛЬНЫЙ ИНТЕРФЕЙС КОНСТРУКТОРА — картинки + описания компонентов
// ────────────────────────────────────────────────────────────
// Картинки: assets/constructors/<имя>.webp. Полный список имён файлов —
// в assets/constructors/_IMAGES.md. Если файла ещё нет, на его месте
// рисуется полосатая заглушка (вёрстка не ломается).
// Описания: CN_DESC. По умолчанию "..." — заполняются вручную.
// Картинки/описания пока только для кораблей (cardUI: true у ship).
// ════════════════════════════════════════════════════════════
function cnImgPath(cat, kind, a, b) {
  let n = cat + '_' + kind + '_' + a;
  if (b != null) n += '_' + b;
  return 'assets/constructors/' + n + '.webp';
}
function cnImgTag(path, cls) {
  return `<span class="cn-imgbox ${cls || ''}"><img src="${esc(path)}" loading="lazy" alt="" onerror="cnImgFail(this)"></span>`;
}
// Нет файла → показываем заглушку (полоски + «нет картинки»), вёрстка не ломается.
function cnImgFail(img) { const w = img.parentElement; if (w) w.classList.add('cn-imgbox-empty'); img.remove(); }
// Проба наличия картинки (для встраивания арта орудия в узел на SVG-схеме).
// Кэш на CN.imgCache: 'ok' — файл есть, 'no' — нет, 'pending' — грузится.
// Когда картинка появляется → перерисовываем схему (иначе SVG <image> «битый»).
function cnWpnImgReady(path) {
  const c = CN.imgCache || (CN.imgCache = {});
  if (c[path] === 'ok') return true;
  if (c[path]) return false;                            // 'no' | 'pending'
  c[path] = 'pending';
  const im = new Image();
  im.onload = () => { c[path] = 'ok'; (CN.imgAR || (CN.imgAR = {}))[path] = (im.naturalWidth / im.naturalHeight) || 2.3; if (CN.def && CN.def.cardUI) cnDrawShip(); };
  im.onerror = () => { c[path] = 'no'; };
  im.src = path;
  return false;
}
// Первый СУЩЕСТВУЮЩИЙ арт из списка кандидатов (конкретный → общий фолбэк).
// Проба асинхронная: когда файл догрузится, cnWpnImgReady сам перерисует схему.
function cnFirstImg(paths) { for (const p of paths) if (cnWpnImgReady(p)) return p; return null; }
// ASCII-слаги групп оружия/модулей (для имён файлов картинок — без кириллицы)
const CN_GROUP_SLUG = {
  ship: {
    weapon: { 'Легкие': 'light', 'Средние': 'medium', 'Тяжёлые': 'heavy', 'Сверхтяжёлые': 'superheavy', 'Ракетное': 'missile', 'Зенитное': 'aa' },
    module: { 'Радарное оборудование': 'radar', 'Радиоэлектронная борьба': 'ew', 'Активная защита': 'activedef', 'Управление': 'control', 'Спец. системы': 'special' },
  },
};
// Детерминированный ASCII-слаг для незнакомых (KV) групп: транслит + отсев мусора.
// Без него все KV-группы падали в 'x' и их картинки затирали бы друг друга.
const CN_TRANSLIT = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
function cnSlugify(s) {
  let out = '';
  for (const ch of String(s || '').toLowerCase()) {
    if (/[a-z0-9]/.test(ch)) out += ch;
    else if (CN_TRANSLIT[ch] != null) out += CN_TRANSLIT[ch];
    else if (ch === ' ' || ch === '-' || ch === '_') out += '_';
  }
  return out.replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'x';
}
function cnGroupSlug(cat, type, group) { return ((CN_GROUP_SLUG[cat] || {})[type] || {})[group] || cnSlugify(group); }

// Описания компонентов. По умолчанию "..." — заполняй вручную, порядок = порядку в данных.
const CN_DESC = {
  ship: {
    class: { corvette: '...', frigate: '...', destroyer: '...', cruiser: '...', battleship: '...', dreadnought: '...' },
    type: {
      corvette: ['...', '...', '...'], frigate: ['...', '...', '...'], destroyer: ['...', '...'],
      cruiser: ['...', '...', '...', '...'], battleship: ['...', '...'], dreadnought: ['...', '...'],
    },
    reactor: {
      corvette: ['...', '...', '...', '...'], frigate: ['...', '...', '...', '...'], destroyer: ['...', '...', '...', '...'],
      cruiser: ['...', '...', '...', '...'], battleship: ['...', '...', '...', '...'], dreadnought: ['...', '...', '...', '...'],
    },
    shield: {
      corvette: ['...', '...', '...'], frigate: ['...', '...', '...'], destroyer: ['...', '...', '...'],
      cruiser: ['...', '...', '...'], battleship: ['...', '...', '...'], dreadnought: ['...', '...', '...'],
    },
    armor: {
      corvette: ['...', '...'], frigate: ['...', '...'], destroyer: ['...', '...', '...'],
      cruiser: ['...', '...'], battleship: ['...', '...'], dreadnought: ['...', '...'],
    },
    engine: {
      corvette: ['...', '...'], frigate: ['...', '...'], destroyer: ['...', '...'],
      cruiser: ['...', '...'], battleship: ['...', '...'], dreadnought: ['...', '...'],
    },
    weapon: {
      'Легкие': ['...', '...', '...', '...'], 'Средние': ['...', '...', '...', '...'], 'Тяжёлые': ['...', '...', '...', '...'],
      'Сверхтяжёлые': ['...', '...', '...'], 'Ракетное': ['...', '...', '...'], 'Зенитное': ['...', '...', '...'],
    },
    module: {
      'Радарное оборудование': ['...', '...', '...', '...', '...', '...'], 'Радиоэлектронная борьба': ['...', '...', '...', '...'],
      'Активная защита': ['...', '...', '...'], 'Управление': ['...', '...', '...'], 'Спец. системы': ['...', '...'],
    },
    hangar: ['...', '...', '...', '...', '...'],
    airunit: ['...', '...', '...', '...'],
  },
};
// ── Админ-оверрайды названий/описаний орудий и модулей (вкладка «🔫 Орудия и модули») ──
// site_settings.cn_part_overrides = { "cat|kind|group|idx": { n:'имя', d:'описание' } },
// cat = ship/ground/aviation. Применяются ко всем категориям KV_DB по совпадению
// ИСХОДНОГО имени (army — независимые копии тех же объектов). Идемпотентно (_name0).
let CN_PART_OVR_LOADED = false;
function cnApplyPartOverrides(ovr) {
  const D = window.KV_DB; if (!D || !ovr) return;
  const byName = {};
  for (const key in ovr) {
    const p = key.split('|'); if (p.length !== 4) continue;
    const src = (D[p[0]] || {})[p[1] === 'weapon' ? 'weapons' : 'modules'];
    const it = src && src[p[2]] && src[p[2]][+p[3]];
    if (it) byName[it._name0 || it.name] = ovr[key];
  }
  for (const cat in D) for (const kindSrc of ['weapons', 'modules']) {
    const S = D[cat][kindSrc]; if (!S) continue;
    for (const g in S) S[g].forEach(it => {
      const o = byName[it._name0 || it.name]; if (!o) return;
      it._ovrDesc = o.d || '';
      if (!it._name0) it._name0 = it.name;
      it.name = o.n || it._name0;
    });
  }
}
async function cnLoadPartOverrides(force) {
  if ((CN_PART_OVR_LOADED && !force) || !window.KV_DB) return;
  CN_PART_OVR_LOADED = true;
  try {
    const rows = await dbGet('site_settings', 'key=eq.cn_part_overrides&select=value&limit=1');
    const raw = rows && rows[0] && rows[0].value;
    const ovr = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    if (ovr) cnApplyPartOverrides(ovr);
  } catch (e) {}
}
if (typeof window !== 'undefined') { window.cnApplyPartOverrides = cnApplyPartOverrides; window.cnLoadPartOverrides = cnLoadPartOverrides; }

// ── Кастомные сплавы брони (алхимия, armor_forge_ui.js) ──────
// Загружаем сплавы своей фракции и дописываем их в слот брони ВСЕХ классов
// KV-конструкторов. HP считает та же cnKvArmorHp (сплав несёт material/hpBoost).
// Сервер при публикации берёт рецепт по _alloyId и пересчитывает авторитетно.
let CN_ALLOYS = null, CN_ALLOYS_FID;
function cnInvalidateAlloys() { CN_ALLOYS = null; }
if (typeof window !== 'undefined') window.cnInvalidateAlloys = cnInvalidateAlloys;
// ⚠️ Обёртка ДОЛЖНА держать ссылку на исходную функцию: объявление cnAlloyMult само
// живёт в window, и присвоение window.cnAlloyMult затирало его → обёртка звала саму
// себя (RangeError: Maximum call stack size exceeded, верфь не открывалась вовсе).
if (typeof window !== 'undefined') { const _cnAlloyMult0 = cnAlloyMult; window.cnAlloyMult = function (st) { return _cnAlloyMult0(st || {}); }; }
async function cnLoadAlloys(force) {
  const fac = cnMyFactionMeta();
  const fid = (fac && fac.faction_id) || '';
  if (!force && CN_ALLOYS && CN_ALLOYS_FID === fid) return CN_ALLOYS;
  CN_ALLOYS_FID = fid;
  try {
    let q = 'select=id,name,recipe,stats,faction_id&order=updated_at.desc';
    if (fid) q = 'faction_id=eq.' + encodeURIComponent(fid) + '&' + q;
    CN_ALLOYS = await dbGet('faction_armor_alloys', q) || [];
  } catch (e) { CN_ALLOYS = []; }
  return CN_ALLOYS;
}
// ── МОДЕЛЬ СПЛАВА: эталон класса × сила рецепта ──────────────
// Сплав НЕ несёт абсолютный HP: базой берём вклад ЛУЧШЕЙ СТОКОВОЙ брони этого
// класса (эталон), а рецепт даёт МНОЖИТЕЛЬ к нему. Так «хороший сплав» всегда
// осмысленно сравним со стоком на любом корпусе — от пехотинца до дредноута
// (прежний прокси cls.resurs врал по классам от 0.5× до 3.5×).
// Множитель — качество рецепта × %HP катализатора × физика материала.
const CN_ALLOY_BILL_REF = 12800;   // HP-якорь «полной» ведомости рецепта (≈ царь-цитадель дредноута)
// Имя ресурса рецепта в ведомости постройки — зеркало SQL `_aa_name` (там, где
// имя элемента алхимии расходится с именем ресурса экономики).
const CN_ALLOY_RES_NAME = { RAREEARTH: 'Редкоземельные руды', ORGANICS: 'Реликтовое дерево', NEUTRONMAT: 'Программируемая материя' };
function cnAlloyResName(id, EL) {
  return CN_ALLOY_RES_NAME[id] || ((EL || {})[id] || {}).name || id;
}
function cnAlloyMatK(mat) {      // физика материала → 0.75..1.25 (нормировка на типовые 2.0)
  if (!mat) return 1;
  let at = (mat.tensileStrength.min + mat.tensileStrength.max) / 2;
  at = 500 + 3000 * (1 - Math.exp(-at / 5000));
  const hr = 500 + 2500 * (1 - Math.exp(-mat.heatResistance / 2000));
  const tc = 100 + 1900 * (1 - Math.exp(-mat.thermalConductivity / 1000));
  const p = (1 + mat.density * 0.02) * (1 + at / 4000) * (1 + hr / 4000 + tc / 50000);
  return Math.max(0.75, Math.min(1.25, p / 2));
}
function cnAlloyMult(a) {          // сила рецепта относительно лучшей стоковой брони класса
  const q = Math.max(0.1, Math.min(1.6, a.quality != null ? a.quality : 1));
  let m = (0.35 + 0.65 * q) * (1 + 0.45 * (a.hpPercentBoost || 0)) * cnAlloyMatK(a.material);
  if (m > 1.3) m = 1.3 + (m - 1.3) * 0.5;   // мягкое колено: топ-рецепты не упираются в стену
  return Math.max(0.25, Math.min(1.8, m));
}
// Эталон класса: лучшая стоковая броня (её HP и её конструкц. resurs → цена ГС).
function cnAlloyRef(db, k) {
  const cls = (db.data || {})[k];
  const list = db.armors[k] || [];
  let hp = 0, resurs = null;
  list.forEach(a => {
    if (!a || a._alloy) return;
    const h = cnKvArmorHp(cls, a);
    if (h > hp) { hp = h; resurs = a.resurs || null; }
  });
  return { hp, resurs };
}
// Превратить строку сплава в объект брони формата каталога (для db.armors[k]).
// ref — эталон КОНКРЕТНОГО класса: один и тот же сплав в разных классах даёт
// разные HP/цену/ведомость (объект строится под класс).
function cnAlloyToArmor(a, ref) {
  const st = a.stats || {};
  const o = {
    name: '⚗ ' + (a.name || 'Сплав'),
    cost: 0,
    material: st.material || null,
    category: st.category || 'composite',
    hpBoost: st.hpBoost || 0,
    hpPercentBoost: st.hpPercentBoost || 0,
    capacityBoost: st.capacityBoost || 0,
    resist: st.resist || { kinetic: 0, energy: 0, missile: 0 },
    quality: (st.quality != null ? st.quality : 1),   // 0.1..1.6 — качество рецепта
    _alloy: true, _alloyId: a.id, _recipe: a.recipe || null,
  };
  const mult = cnAlloyMult(o);
  o._refHp = (ref && ref.hp) || 0;
  o.armor = Math.round(o._refHp * mult);              // для чипов/баров
  // Сплав НЕ бесплатный: конструкц. resurs = сырьё эталонной брони × сила рецепта
  // (идёт в ГС-цену), а ведомость постройки = САМ РЕЦЕПТ, масштабированный классом.
  const rr = (ref && ref.resurs) || {};
  o.resurs = {
    blackmetall: Math.round((rr.blackmetall || 0) * mult), coloredmetall: Math.round((rr.coloredmetall || 0) * mult),
    rudametall: Math.round((rr.rudametall || 0) * mult), kristall: Math.round((rr.kristall || 0) * mult),
    staarvis: Math.round((rr.staarvis || 0) * mult),
  };
  o._billScale = Math.max(0.02, Math.min(1, o._refHp / CN_ALLOY_BILL_REF)) * mult;
  return o;
}
// Дописать сплавы в db.armors[k], предварительно убрав ранее вписанные (_alloy).
function cnMergeAlloys(db) {
  if (!db || !db.armors) return;
  for (const k in db.armors) {
    if (!Array.isArray(db.armors[k])) continue;
    db.armors[k] = db.armors[k].filter(a => !a._alloy);
    const ref = cnAlloyRef(db, k);
    db.armors[k] = db.armors[k].concat((CN_ALLOYS || []).map(a => cnAlloyToArmor(a, ref)));
  }
}

// ── СВОИ ОРУДИЯ (оружейная верфь) ───────────────────────────
// Полный аналог сплавов, только для слота вооружения: строка faction_turrets
// разворачивается в объект орудия каталога и дописывается в db.weapons
// отдельной группой. Доступность по классу носителя берётся из turrets.carriers
// (их посчитал сервер по массе и энергопотреблению сборки).
// Сервер при публикации резолвит орудие по turretId и пересчитывает ТТХ сам.
const CN_TURRET_GROUP = '⚙ Свои орудия';
let CN_TURRETS = null, CN_TURRETS_FID;
function cnInvalidateTurrets() { CN_TURRETS = null; }
if (typeof window !== 'undefined') window.cnInvalidateTurrets = cnInvalidateTurrets;
async function cnLoadTurrets(force) {
  const fac = cnMyFactionMeta();
  const fid = (fac && fac.faction_id) || '';
  if (!force && CN_TURRETS && CN_TURRETS_FID === fid) return CN_TURRETS;
  CN_TURRETS_FID = fid;
  try {
    let q = 'select=id,name,cfg,stats,carriers,faction_id&order=id.asc';
    if (fid) q = 'faction_id=eq.' + encodeURIComponent(fid) + '&' + q;
    CN_TURRETS = await dbGet('faction_turrets', q) || [];
  } catch (e) { CN_TURRETS = []; }
  return CN_TURRETS;
}
// Строка орудия → объект формата каталога (те же поля, что читает cnVehCalc).
// div — сколько килограммов массы стоит одна единица нагрузки на шасси
// (корабли считают по 500 кг за единицу, наземка/авиация — по 100; см.
// CN_LOAD_DIV). Без этого своё орудие с верфи было невесомым: любую махину
// с верстака можно было навесить сверх лимита, пока каталожные орудия платили.
function cnTurretToWeapon(t, div) {
  const st = t.stats || {};
  const cal = st.caliber || 0;
  // Ремонтный рой (нанотехнологии): урона не наносит вообще — в атакующую
  // сводку проекта не идёт (dmg = 0), в бою работает по СОЮЗНИКУ (см.
  // battle_fire в _nano_repair.sql). Зеркало: _cn_wpn_obj на сервере.
  const heal = st.kind === 'repair' ? Math.round(+st.heal || 0) : 0;
  return {
    capacityPenalty: Math.round((+st.mass || 0) / (div || 500)),
    name: '⚙ ' + (t.name || 'Орудие'),
    cost: Math.round(st.gs || 0),
    price: st.price || 0,
    dmg: heal ? 0 : Math.round(st.damage || 0),
    heal,
    energy: Math.round(st.energy || 0),
    power: Math.round(st.energy || 0),
    kind: st.kind || 'kinetic',
    dalnost: st.dalnost || 0,          // сервер читает плоское поле
    weight: st.mass || 0,
    crewRequired: 0,
    category: CN_TURRET_GROUP,
    tech: st.kvTech || '', damageType: st.kvDmg || '', class: st.kvClass || '',
    customParameter: { kal: String(cal), dalnost: st.dalnost || 0,
                       skorostrelnost: st.rof || 0, metrika: '0' },   // клиент читает отсюда
    // Сырьё орудия в конструкционные решения корпуса НЕ идёт: у своего орудия
    // цена плоская (stats.gs, боевая) и прибавляется к стоимости проекта как
    // есть. Иначе цена в верфи и цена в конструкторе расходились бы — там
    // resurs ещё домножался на классовый коэффициент корпуса и наценку.
    resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
    _turret: true, _turretId: t.id, _turretCfg: t.cfg || null, _gs: Math.round(st.gs || 0),
    _on: +(st.on || 0),
  };
}

// ── Арт орудия: тот же генератор, что и на оружейной верфи ───
// Свои орудия (_turretCfg) и башенные позиции каталога без webp-арта рисуем
// turret_gen.js вживую — с тем же масштабом по size/классу, что и на верфи
// (без tight: там кадр общий, изделие реально крупнеет/мельчает).
// Идентификаторы в defs у генератора фиксированные (m_plate, glow, …), а на
// странице таких SVG может быть десяток: без уникализации все турели брали бы
// градиенты ПЕРВОЙ и красились её акцентом. Отсюда суффикс на id и url(#…).
let CN_TART_N = 0;
function cnTurretCfg(item) {
  if (!item || !window.TG) return null;
  if (item._turretCfg) {
    try { return TG.normalize(item._turretCfg); } catch (e) { return null; }
  }
  if (TG.isTurret && TG.isTurret(item)) return TG.fromKV(item.name, item);
  return null;
}
// Визуальный «вес» орудия на схеме — 0..1 по ФИЗИЧЕСКОЙ МАССЕ сборки.
// Раньше вес брался из энергопотребления с потолком 2500 E: всё крупнее
// эсминечного калибра упиралось в потолок, и супероружие на схеме было
// такого же размера, что зенитный автомат. Масса разведена по логарифму от
// 100 кг до 2000 т — весь диапазон верфи, потолок реально достижим только
// предельным супероружием.
const CN_TWT_LO = Math.log(100), CN_TWT_HI = Math.log(2e6);
function cnTurretVisWt(cfg, item) {
  let m = item && (+item.weight || 0);
  if (!(m > 0) && cfg && window.TG && TG.stats) {
    try { m = TG.stats(cfg).mass || 0; } catch (e) { m = 0; }
  }
  if (m > 0) {
    return Math.max(0, Math.min(1, (Math.log(m) - CN_TWT_LO) / (CN_TWT_HI - CN_TWT_LO)));
  }
  // Нет массы (орудие каталога без ТТХ верфи) — падаем на энергопотребление.
  const e = item && (+item.energy || +item.power || 0);
  if (e > 0) return Math.max(0, Math.min(1, (Math.log(e) - Math.log(20)) / (Math.log(20000) - Math.log(20))));
  return 0.35;
}
function cnWeaponTurretArt(item, imgPath) {
  if (!item || !window.TG || !TG.render) return null;
  if (cnWpnImgReady(imgPath) && !item._turretCfg) return null;
  const cfg = cnTurretCfg(item);
  if (!cfg) return null;
  return { cfg, wt: cnTurretVisWt(cfg, item) };
}
// ⚠️ АРТ ОРУДИЯ ЗАПЕКАЕТСЯ. TG.render() — полноценный генератор (десятки путей,
// градиенты, тени), а схема перерисовывается на КАЖДЫЙ кадр зума/панорамы и на
// каждый пересчёт: раньше все турели рисовались заново по десять раз в секунду,
// отсюда фризы. Одинаковая конфигурация → одна и та же строка из кэша.
// Суффикс id тоже кэшируется вместе со строкой: два экземпляра одного орудия дают
// ОДИН набор defs-идентификаторов (дубликаты идентичны — браузер берёт первый),
// а разные орудия по-прежнему не воруют градиенты друг у друга.
const CN_TART_CACHE = new Map(), CN_TART_MAX = 96;
function cnTurretArtSvg(cfg, opt) {
  if (!cfg || !window.TG || !TG.render) return null;
  let key = null;
  try { key = JSON.stringify(cfg) + '|' + JSON.stringify(opt || null); } catch (e) { key = null; }
  if (key != null && CN_TART_CACHE.has(key)) return CN_TART_CACHE.get(key);
  let s;
  try { s = TG.render(cfg, opt); } catch (e) { return null; }
  const u = '_ta' + (++CN_TART_N);
  const out = s.replace(/id="([\w-]+)"/g, (m, a) => `id="${a}${u}"`)
               .replace(/url\(#([\w-]+)\)/g, (m, a) => `url(#${a}${u})`);
  if (key != null) {
    if (CN_TART_CACHE.size >= CN_TART_MAX) CN_TART_CACHE.delete(CN_TART_CACHE.keys().next().value);
    CN_TART_CACHE.set(key, out);
  }
  return out;
}
// Тот же арт, но кусками — для встраивания в схему корабля (нужен viewBox).
// Разбор строки регулярками тоже кэшируем: он идёт на каждый узел орудия.
const CN_TPARTS_CACHE = new Map();
function cnTurretArtParts(cfg, opt) {
  let pk = null;
  try { pk = JSON.stringify(cfg) + '|' + JSON.stringify(opt || null); } catch (e) { pk = null; }
  if (pk != null && CN_TPARTS_CACHE.has(pk)) return CN_TPARTS_CACHE.get(pk);
  const r = cnTurretArtPartsRaw(cfg, opt);
  if (pk != null) {
    if (CN_TPARTS_CACHE.size >= CN_TART_MAX) CN_TPARTS_CACHE.delete(CN_TPARTS_CACHE.keys().next().value);
    CN_TPARTS_CACHE.set(pk, r);
  }
  return r;
}
function cnTurretArtPartsRaw(cfg, opt) {
  const s = cnTurretArtSvg(cfg, opt); if (!s) return null;
  const vb = (s.match(/viewBox="([^"]+)"/) || [])[1];
  const inner = s.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  if (!vb || !inner) return null;
  const n = vb.trim().split(/\s+/).map(Number);
  return { inner, half: Math.max(n[2], n[3]) / 2 };
}
// Готовый бокс-«картинка» для карточек выбора (замена cnImgTag у орудий без webp).
function cnTurretImgTag(cfg, cls) {
  const s = cnTurretArtSvg(cfg); if (!s) return null;
  return `<span class="cn-imgbox cn-imgbox-tg ${cls || ''}">`
    + s.replace(/ width="\d+" height="\d+"/, ' width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block"')
    + `</span>`;
}
function cnWeaponImgTag(item, imgPath, cls) {
  const art = cnWeaponTurretArt(item, imgPath);
  if (art) { const tg = cnTurretImgTag(art.cfg, cls); if (tg) return tg; }
  return cnImgTag(imgPath, cls);
}
// Дописать свои орудия в db.weapons, предварительно убрав вписанные ранее.
// Порядок — по id (стабильный), чтобы индексы не «плавали» между заходами.
function cnMergeTurrets(db, div) {
  if (!db || !db.weapons) return;
  const list = (CN_TURRETS || []).slice().sort((a, b) => String(a.id) < String(b.id) ? -1 : 1);
  db.weapons[CN_TURRET_GROUP] = list.map(t => cnTurretToWeapon(t, div));
  // карта доступности: орудие видно только тем классам, которые его тянут
  const av = db.weaponsAvail;
  if (!av) return;
  for (const k in av) {
    if (!av[k]) continue;
    [...av[k]].forEach(key => { if (key.indexOf(CN_TURRET_GROUP + '|') === 0) av[k].delete(key); });
    list.forEach((t, i) => { if ((t.carriers || []).includes(k)) av[k].add(CN_TURRET_GROUP + '|' + i); });
  }
}
// Свои орудия исследовать не нужно — их уже «исследовала» сама верфь.
function cnIsTurretGroup(g) { return g === CN_TURRET_GROUP; }
// ПОЧЕМУ своего орудия нет в слоте. Носители считает верфь (масса/энергия против
// лимитов класса), и орудие, переросшее корвет, просто ИСЧЕЗАЛО из списка — со
// стороны игрока это выглядело как пропажа («сначала работало, потом перестало»).
// Теперь такие орудия остаются в пикере серой карточкой с цифрами перегруза.
// null = класс k этой сборке в принципе не положен (платформа не та) либо всё в норме.
function cnTurretLockWhy(item, k) {
  if (!item || !item._turret || !k || !window.TG) return null;
  const lim = TG.CARRIERS && TG.CARRIERS[k];
  if (!lim) return null;
  // Кандидат ли класс вообще: TG.carriers() возвращает только те носители,
  // что положены классу установки, с готовой причиной отказа.
  const cfg = cnTurretCfg(item);
  if (cfg && TG.carriers) {
    let row = null;
    try { row = (TG.carriers(cfg) || []).find(x => x.key === k); } catch (e) { row = null; }
    if (!row) return null;
    if (row.ok) return null;
    return 'Не тянет: ' + (lim.ru || k) + ' — ' + row.why;
  }
  // Нет конфигурации (легаси-строка) — считаем по сохранённым ТТХ.
  const why = [];
  const m = +item.weight || 0, e = +item.energy || +item.power || 0;
  if (m > lim.mass) why.push('масса ' + cnNum(Math.round(m)) + ' кг > ' + cnNum(lim.mass));
  if (e > lim.power) why.push('энергия ' + cnNum(e) + ' > ' + cnNum(lim.power));
  return why.length ? 'Не тянет: ' + (lim.ru || k) + ' — ' + why.join('; ') : null;
}
// Индексы своих орудий, которые классу k не по силам (для серых карточек пикера).
function cnTurretLockedIdxs(k) {
  const arr = (CN.def && CN.def.db.weapons[CN_TURRET_GROUP]) || [];
  const out = [];
  arr.forEach((it, i) => {
    if (cnItemAvail('weapon', k, CN_TURRET_GROUP, i)) return;
    if (cnTurretLockWhy(it, k)) out.push(i);
  });
  return out;
}
// Дизайн несёт стабильный turretId рядом с {g,idx}: индекс мог сместиться,
// id — нет, и сервер верит только ему (зеркало armorAlloyId).
function cnWpnTagTurret(def, w) {
  if (!w) return w;
  const o = (def.db.weapons[w.g] || [])[w.idx];
  if (o && o._turretId) w.turretId = o._turretId; else delete w.turretId;
  return w;
}
// Обратный ход при загрузке проекта: по id находим текущий индекс.
function cnWpnUntagTurret(def, w) {
  if (!w || !w.turretId) return w;
  const arr = def.db.weapons[CN_TURRET_GROUP] || [];
  const i = arr.findIndex(o => String(o._turretId) === String(w.turretId));
  if (i < 0) return null;   // орудие снято с производства — ссылка битая
  return Object.assign({}, w, { g: CN_TURRET_GROUP, idx: i });
}

function cnDesc(cat, kind, key, idx) {
  const d = (CN_DESC[cat] || {})[kind]; if (!d) return '';
  if (Array.isArray(d)) return d[key] || '';            // hangar/airunit: key = индекс
  const v = d[key];
  if (Array.isArray(v)) return (idx != null ? v[idx] : '') || '';
  return v || '';
}

// ── Карточки компонентов ──
function cnChip(label, val) { return `<span class="cn-chip"><i>${esc(label)}</i>${esc(val)}</span>`; }
// В KV-режиме итоговая цена корабля считается из конструкционных решений (cnKvCost),
// а не из млн-прайсов отдельных компонентов — поэтому «страшную» покомпонентную
// цену на карточках выбора не показываем.
function cnGsChip(cost, obj) {
  if (!window.KV_DB) return cnChip('ГС', cnNum(cost));
  const gs = cnKvPartGs(obj, cnId('cn-class') ? cnId('cn-class').value : '');
  return gs > 0 ? cnChip('ГС', cnNum(gs)) : '';
}
function cnSlotStatChips(slot, obj, def) {
  if (!obj) return '';
  const E = def.hasEnergy;
  switch (slot) {
    case 'class': return cnChip('база ОН', obj.baseON) + cnChip('ОН/модуль', '+' + obj.modON);
    case 'type': return cnChip('HP', cnNum(obj.hp)) + cnChip('броня', cnNum(obj.armor)) + cnGsChip(obj.cost, obj);
    case 'reactor': return cnChip('энергия', cnNum(obj.energy) + ' E') + cnGsChip(obj.cost, obj);
    case 'armor': return cnChip('броня', '+' + cnNum(obj.armor)) + cnGsChip(obj.cost, obj);
    case 'shield': return cnChip('щит', obj.shield ? cnNum(obj.shield) : 'нет') + ((obj.energy || obj.power) ? cnChip('E', cnNum(obj.energy || obj.power)) : '') + cnGsChip(obj.cost, obj);
    case 'engine': return (window.KV_DB ? cnChip('тяга', cnNum(obj.force)) : cnChip('скорость', obj.speed + ' у.е.')) + ((obj.energy || obj.power) ? cnChip('E', cnNum(obj.energy || obj.power)) : '') + cnGsChip(obj.cost, obj);
    case 'radar': { const d = obj.customParameterradar && obj.customParameterradar.dalnost; return cnChip('дальность', d ? cnNum(d) + ' кв' : 'нет') + (obj.power ? cnChip('E', cnNum(obj.power)) : ''); }
  }
  return '';
}
// ── Дескриптор компонента: объект данных + путь картинки + описание ──
const CN_SLOT_TITLE = { class: 'Выбор корпуса', type: 'Выбор специализации', reactor: 'Выбор реактора', armor: 'Выбор бронирования', shield: 'Выбор щитового модуля', engine: 'Выбор двигателя', radar: 'Выбор радара' };
// KV: реальная категория для путей картинок и описаний. У единого «army»-форжа
// своих файлов нет — арт/описания живут под ground/aviation (по группе или классу).
function cnRealCatOf(kind, key) {
  if (CN.cat !== 'army' || !window.KV_DB) return CN.cat;
  if (kind === 'weapon' || kind === 'module') {
    const src = kind === 'weapon' ? 'weapons' : 'modules';
    return (KV_DB.ground && KV_DB.ground[src][key]) ? 'ground' : 'aviation';
  }
  return cnKvRealCat(kind === 'class' ? key : cnId('cn-class').value);
}
function cnCompInfo(kind, key, idx) {
  const def = CN.def, db = def.db, k = cnId('cn-class').value;
  // army-форж не имеет своих файлов/описаний — используем реальную категорию
  const cat = cnRealCatOf(kind, kind === 'weapon' || kind === 'module' || kind === 'class' ? key : k);
  let obj, imgPath, desc;
  switch (kind) {
    case 'class':   obj = db.data[key];          imgPath = cnImgPath(cat, 'class', key);       desc = cnDesc(cat, 'class', key); break;
    case 'type':    obj = db.data[k].types[idx]; imgPath = cnImgPath(cat, 'type', k, idx);      desc = cnDesc(cat, 'type', k, idx); break;
    case 'reactor': obj = db.reactors[k][idx];   imgPath = cnImgPath(cat, 'reactor', k, idx);   desc = cnDesc(cat, 'reactor', k, idx); break;
    case 'armor':   obj = db.armors[k][idx];     imgPath = cnImgPath(cat, 'armor', k, idx);     desc = cnDesc(cat, 'armor', k, idx); break;
    case 'shield':  obj = db.shields[k][idx];    imgPath = cnImgPath(cat, 'shield', k, idx);    desc = cnDesc(cat, 'shield', k, idx); break;
    case 'engine':  obj = db.engines[k][idx];    imgPath = cnImgPath(cat, 'engine', k, idx);    desc = cnDesc(cat, 'engine', k, idx); break;
    case 'radar':   obj = (db.radars && db.radars[k] || [])[idx]; imgPath = cnImgPath(cat, 'radar', k, idx); desc = cnDesc(cat, 'radar', k, idx); break;
    case 'weapon':  obj = db.weapons[key][idx];  imgPath = cnImgPath(cat, 'weapon', cnGroupSlug(cat, 'weapon', key), idx); desc = cnDesc(cat, 'weapon', key, idx); break;
    case 'module':  obj = db.modules[key][idx];  imgPath = cnImgPath(cat, 'module', cnGroupSlug(cat, 'module', key), idx); desc = cnDesc(cat, 'module', key, idx); break;
    case 'hangar':  obj = db.hangarTypes.find(h => h.id == key); imgPath = cnImgPath(cat, 'hangar', key); desc = cnDesc(cat, 'hangar', +key); break;
    case 'airunit': obj = db.airUnits[idx];      imgPath = cnImgPath(cat, 'airunit', idx);      desc = cnDesc(cat, 'airunit', idx); break;
  }
  // Приоритет описаний: админский оверрайд → ручной CN_DESC → описание из данных KV
  if (obj) desc = obj._ovrDesc || desc || (obj.description && obj.description !== '...' ? obj.description : '');
  return { kind, key, idx, k, obj, imgPath, desc };
}
// Полный список характеристик ИЗ ДАННЫХ (всё, что есть в коде по компоненту)
function cnCompStatsRows(info) {
  const o = info.obj, E = CN.def.hasEnergy, rows = [], push = (l, v) => rows.push([l, v]);
  // Цена компонента. В KV-режиме млн-прайс из каталога (o.cost) не имеет
  // отношения к делу — итог проекта считает cnKvCost из конструкционного сырья.
  // Поэтому показываем НАСТОЯЩИЙ вклад компонента в цену: то же сырьё, тот же
  // курс и тот же классовый множитель, что и в итоге (без плоской наценки —
  // она берётся с проекта один раз). Раньше строку просто прятали, и карточка
  // молчала о цене вообще.
  const pushPrice = (v) => {
    if (!window.KV_DB) { push('Цена', v); return; }
    const gs = cnKvPartGs(o, info.kind === 'class' ? info.key : info.k);
    if (gs > 0) push('Цена', cnNum(gs) + ' ГС');
  };
  switch (info.kind) {
    case 'class':   push('База ОН', o.baseON); push('ОН за модуль', '+' + o.modON); if (o.types) push('Специализаций', o.types.length); break;
    case 'type':    push('Прочность', cnNum(o.hp) + ' HP'); push('Броня корпуса', '+' + cnNum(o.armor) + ' AR'); pushPrice(cnNum(o.cost) + ' ГС'); break;
    case 'reactor': push('Уровень', 'Ур. ' + ((info.idx || 0) + 1)); push('Выработка энергии', cnNum(o.energy) + ' E'); pushPrice(cnNum(o.cost) + ' ГС'); break;
    case 'armor':   push('Броня', '+' + cnNum(o.armor) + ' AR'); pushPrice(cnNum(o.cost) + ' ГС'); break;
    case 'shield':  push('Щит', o.shield ? cnNum(o.shield) + ' ед.' : 'нет'); { const e = +o.energy || +o.power || 0; if (e) push('Потребление', cnNum(e) + ' E'); } pushPrice(cnNum(o.cost) + ' ГС'); break;
    case 'engine':  if (window.KV_DB) push('Тяга', cnNum(o.force)); else push('Скорость', o.speed + ' у.е.'); { const e = +o.energy || +o.power || 0; if (e) push('Потребление', cnNum(e) + ' E'); } pushPrice(cnNum(o.cost) + ' ГС'); break;
    case 'radar': {
      const cp = o.customParameterradar || {};
      push('Дальность обзора', cp.dalnost ? cnNum(cp.dalnost) + ' кв' : 'нет');
      if (+cp.pwrPer > 0) push('От реактора', '+1 кв за ' + cnNum(cp.pwrPer) + ' E (до +' + (cp.pwrCap || 0) + ')');
      if (+cp.eccm > 0) push('Помехозащищённость', '−' + cp.eccm + ' к вражескому глушению');
      if (cp.diapazon) push('Диапазон', String(cp.diapazon).toUpperCase());
      if (o.power) push('Потребление', cnNum(o.power) + ' E');
      if (o.crewRequired) push('Экипаж', cnNum(o.crewRequired));
      if (o.capacityPenalty) push('Нагрузка на шасси', '−' + cnNum(o.capacityPenalty));
      pushPrice(cnNum(o.cost) + ' ГС'); break;
    }
    case 'weapon': {
      const cp = o.customParameter || {};
      if (+o.heal > 0) push('Ремонт союзнику', cnNum(o.heal) + ' HP за залп');
      else push('Урон', cnNum(o.dmg));
      if (cp.kal && parseFloat(String(cp.kal)) > 0) push('Калибр', String(cp.kal));
      if (+cp.skorostrelnost > 0) push('Скорострельность', cnNum(cp.skorostrelnost) + ' выстр./мин');
      if (+cp.dalnost > 0) push('Дальность', cnNum(cp.dalnost) + ' кв');
      if (o.damageType) push('Тип урона', String(o.damageType));
      if (o.tech) push('Технология', String(o.tech));
      const we = +o.energy || +o.power || 0;
      if (we) push('Потребление', cnNum(we) + ' E');
      if (o.crewRequired) push('Экипаж', cnNum(o.crewRequired));
      if (+o.weight > 0) push('Масса', cnNum(o.weight) + ' кг');
      if (+o.capacityPenalty > 0) push('Нагрузка на шасси', '−' + cnNum(o.capacityPenalty));
      if (+o.visibility > 0) push('Заметность', '+' + cnNum(o.visibility));
      pushPrice(cnNum(o.cost) + ' ГС'); break;
    }
    case 'module': {
      // потребление энергии: KV-модули хранят его в power (адаптер зеркалит в energy)
      const eUse = +o.energy || +o.power || 0;
      if (eUse) push('Потребление', cnNum(eUse) + ' E');
      if (o.capacity) push('Грузоподъёмность', (o.capacity > 0 ? '+' : '') + cnNum(o.capacity));
      if (o.crewRequired) push('Требует экипаж', cnNum(o.crewRequired));
      if (o.crewProvided) push('Даёт экипаж', '+' + cnNum(o.crewProvided));
      if (+o.visibility > 0) push('Заметность', '+' + cnNum(o.visibility));
      if (+o.shieldBoost > 0) push('Щит', '+' + Math.round(o.shieldBoost * 100) + '%');
      if (+o.damageBoost > 0) push('Урон', '+' + Math.round(o.damageBoost * 100) + '%');
      if (+o.hp > 0) push('Прочность', '+' + cnNum(o.hp) + ' HP');
      const cb = o.combat || {};
      if (cb.pd) push('ПРО', 'сбивает ' + Math.round(cb.pd * 100) + '% ракет');
      if (cb.jam) push('РЭБ', '−' + cb.jam + ' к сенсорам врага (радиус 5)');
      if (cb.dejam) push('Контр-РЭБ', 'снимает до ' + cb.dejam + ' помех со своих (радиус 5)');
      if (cb.interdict) push('Интердикция', 'враг не вызывает подкрепления, пока модуль жив (только линкор/дредноут/станция)');
      if (cb.stabil) push('Стабилизация', 'своя сторона игнорирует интердикцию врага (только линкор/дредноут/станция)');
      if (cb.ftl) push('FTL-прыжок', 'корабль вызывается подкреплением сквозь вражескую интердикцию');
      if (cb.stealth) push('Маскировка', '+' + cb.stealth + ' к скрытности');
      if (cb.sensor) push('Сенсор', '+' + cb.sensor + ' к захвату радара');
      if (cb.hangar) push('Авиакрылья', '+' + Math.floor(cb.hangar / 300) + ' запуск(а) в бою');
      // Где и как модуль стоит на палубе — это такая же характеристика, как урон:
      // от неё зависит, влезет ли он вообще и с какой отдачей будет работать.
      {
        const fam = cnModFam(o), sz = cnModCells(o), R = CN_ZONE_RULE[fam] || CN_ZONE_RULE.hull;
        push('Занимает на палубе', sz[0] + '×' + sz[1] + ' кл.');
        push('Отсек', R.band.map(b => CN_BAND_RU[b]).join('/')
          + (R.side === 'skin' ? ', по борту' : R.side === 'core' ? ', в глубине корпуса' : '')
          + (R.why ? ' — ' + R.why : ''));
        if (fam !== 'hull') push('Синергия', 'каждый смежный ' + (CN_FAM_RU[fam] || fam).toLowerCase()
          + ' +' + Math.round(CN_PLATE.adj * 100) + '%, от двух соседей ещё +' + Math.round((CN_PLATE.sq - 1) * 100)
          + '%; каждая лишняя семья на борту делит всё на ' + (1 + CN_PLATE.dil).toFixed(2));
      }
      pushPrice(cnNum(o.cost) + ' ГС'); break;
    }
    case 'hangar':  push('Вместимость', o.capacity + ' очк.'); push('Потребление', cnNum(o.energy) + ' E'); pushPrice(cnNum(o.cost) + ' ГС'); push('Авиагруппы', o.canHaveUnits ? 'да' : 'нет (груз)'); break;
    case 'airunit': push('Очки в ангаре', o.points); break;
  }
  return rows.map(([l, v]) => `<div class="cn-info-row"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('');
}
// Вклад компонента в ресурсную ведомость (сырьё) — через общий расчёт cnUnitBill
function cnPartBill(info) {
  // Для карточки корпуса ведомость берётся по КЛАССУ САМОЙ КАРТОЧКИ (info.key),
  // а не по текущему выбранному классу (info.k) — иначе все карточки в модалке
  // выбора корпуса показывают сырьё выбранного корпуса (наследственный баг цены).
  const k = info.kind === 'class' ? info.key : info.k, o = info.obj,
        cat = CN.cat === 'army' ? cnKvRealCat(k) : CN.cat;
  if (info.kind === 'class') return Object.assign({}, (CN_HULL_BILL[cat] || {})[k] || {});
  if (info.kind === 'type' || info.kind === 'airunit') return {};
  const base = cnUnitBill(cat, k, {});
  let parts = null;
  if (info.kind === 'armor') parts = { armorObj: o };
  else if (info.kind === 'shield') parts = { shieldObj: o };
  else if (info.kind === 'engine') parts = { engObj: o };
  else if (info.kind === 'reactor') parts = { reactObj: o };
  else if (info.kind === 'weapon') parts = { weapons: [{ w: o, q: 1 }] };
  else if (info.kind === 'module') parts = { modules: [{ m: o }] };
  else if (info.kind === 'hangar') parts = { hangars: [{ h: o }] };
  if (!parts) return {};
  const full = cnUnitBill(cat, k, parts), out = {};
  for (const nm in full) { const d = (full[nm] || 0) - (base[nm] || 0); if (d > 0) out[nm] = d; }
  return out;
}
// Полная карточка компонента для модалки: картинка + ВСЕ ТТХ + сырьё + описание
function cnCompFullHtml(info, action) {
  const locked = info.locked, on = info.on;
  const bill = cnPartBill(info);
  const billHtml = Object.keys(bill).length
    ? `<div class="cn-info-res"><div class="cn-info-sub">◇ Сырьё ${info.kind === 'class' ? 'корпуса' : 'за единицу'}</div><div class="cn-bill">${cnBillHtml(bill)}</div></div>` : '';
  // Корпус и специализация показываются ЗАПЕЧЁННЫМ SVG (тот же движок, что и схема),
  // орудие — своим генератором; остальное — картинкой из assets.
  const imgHtml = info.kind === 'weapon'
    ? cnWeaponImgTag(info.obj, info.imgPath, 'cn-info-img')
    : info.kind === 'class' ? cnHullImgTag(info.key, null, 'cn-info-img')
    : info.kind === 'type' ? cnHullImgTag(info.k, info.idx, 'cn-info-img')
    : cnImgTag(info.imgPath, 'cn-info-img');
  return `<div class="cn-info-card${on ? ' on' : ''}${locked ? ' locked' : ''}"${(action && !locked) ? ` onclick="${action}"` : ''}>
    ${imgHtml}
    <div class="cn-info-body">
      <div class="cn-info-nm">${locked ? '🔒 ' : ''}${info.kind === 'reactor' ? `<span class="cn-info-lvl">Ур. ${(info.idx || 0) + 1}</span> ` : ''}${esc(info.obj.name)}${on ? ' <span class="cn-info-cur">установлено</span>' : ''}</div>
      <div class="cn-info-stats">${cnCompStatsRows(info)}</div>
      ${billHtml}
      <div class="cn-info-desc">${esc(info.desc || '…')}</div>
      ${action ? (locked ? `<div class="cn-info-pick cn-info-lk">${esc(info.lockMsg || 'Требует исследования')}</div>` : `<div class="cn-info-pick">${on ? '✓ выбрано' : 'Выбрать ▸'}</div>`) : ''}
    </div>
  </div>`;
}
function cnInfoModal(title, body) {
  let ov = document.getElementById('cn-info-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'cn-info-ov'; ov.className = 'cn-modal-ov'; ov.onclick = e => { if (e.target === ov) cnCloseInfo(); }; document.body.appendChild(ov); }
  ov.classList.toggle('cn-cyb', !!(CN.def && CN.def.cardUI));
  ov.innerHTML = `<div class="cn-modal cn-pick-modal"><button class="cn-modal-x" onclick="cnCloseInfo()">✕</button><div class="cn-modal-name">${esc(title)}</div><div class="cn-info-grid">${body}</div></div>`;
  ov.classList.add('show');
}
function cnCloseInfo() { document.getElementById('cn-info-ov')?.classList.remove('show'); }

// Компактный чип ТЕКУЩЕГО выбора слота в шапке полотна (клик → модалка выбора)
const CN_SLOT_SHORT = { class: 'Корпус', type: 'Специализация', reactor: 'Реактор', engine: 'Двигатель', armor: 'Броня', shield: 'Щит', radar: 'Радар' };
function cnSlotSelected(slot) {
  const def = CN.def; if (!def || !def.cardUI) return;
  const wrap = cnId('cn-' + slot + '-cards'), sel = cnId('cn-' + slot);
  if (!wrap || !sel) return;
  const info = slot === 'class' ? cnCompInfo('class', sel.value) : cnCompInfo(slot, null, +sel.value);
  if (!info.obj) { wrap.innerHTML = ''; return; }
  const locked = slot === 'class' && cnClassLocked();
  wrap.innerHTML = `<button class="cn-slot-chip${locked ? ' cn-slot-locked' : ''}" ${locked ? `title="Класс нельзя менять при правке — создайте новый проект" onclick="toast('Класс менять нельзя: создайте новый проект','inf')"` : `onclick="cnOpenSlotPicker('${slot}')"`}>
    <span class="cn-slot-lbl">${locked ? '🔒 ' : ''}${CN_SLOT_SHORT[slot] || slot}</span>
    <span class="cn-slot-val">${slot === 'reactor' ? 'Ур.' + ((+sel.value || 0) + 1) + ' · ' : ''}${esc(info.obj.name)}</span>
  </button>`;
}
// Модалка выбора компонента слота (полные карточки; гейт по исследованиям)
function cnOpenSlotPicker(slot) {
  if (slot === 'class' && cnClassLocked()) { toast('Класс менять нельзя: создайте новый проект', 'inf'); return; }
  const sel = cnId('cn-' + slot); if (!sel) return;
  const cards = [...sel.options].map(opt => {
    const val = opt.value, locked = opt.disabled;
    const info = slot === 'class' ? cnCompInfo('class', val) : cnCompInfo(slot, null, +val);
    if (!info.obj) return '';
    info.on = (val == sel.value) && !locked; info.locked = locked;
    return cnCompFullHtml(info, locked ? '' : `cnPickSlot('${slot}','${esc(val)}');cnCloseInfo();`);
  }).join('');
  cnInfoModal(CN_SLOT_TITLE[slot] || 'Выбор компонента', cards);
}
function cnPickSlot(slot, val) {
  const sel = cnId('cn-' + slot); if (!sel) return;
  const opt = [...sel.options].find(o => o.value == val); if (!opt || opt.disabled) return;
  sel.value = val;
  if (slot === 'class') cnVehHandleClass(); else cnVehCalc();
  cnSlotSelected(slot);
  if (slot === 'class' || slot === 'type') cnHullHero();
}
// ── Геометрия корпусов для схемы «вид сверху» ──
// st — «станции» корпуса [y, полуширина] нос→корма: силуэт зеркален вокруг оси x=160,
// из станций генерируется path и считается ТОЧНЫЙ профиль полуширины (cnHullHalf).
// Каждый класс — узнаваемый: узкий носовой клин, сенсорное «плечо», крылья-спонсоны,
// талия, машинное отделение с расширением и сужение к дюзам.
function cnStPath(st) { const R = st.map(p => [160 + p[1], p[0]]), L = st.slice().reverse().map(p => [160 - p[1], p[0]]); return R.concat(L).map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + 'Z'; }
// ── Гладкий силуэт корпуса (ТОЛЬКО отрисовка) ──────────────────────────────
// H.path (полигон из станций) остаётся для геометрии/клиппинга/размещения узлов;
// для чертежа корпус рисуется замкнутым Catmull-Rom по тем же станциям → плавные
// обводы вместо ломаной. wf — множитель полуширины (для палубных обводок/пояса).
function cnCatmullClosed(pts) {
  const n = pts.length; if (n < 3) return '';
  let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += 'C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
  }
  return d + 'Z';
}
function cnHullOutlinePts(st, wf) {
  wf = wf == null ? 1 : wf;
  const R = st.map(p => [160 + p[1] * wf, p[0]]);
  const L = st.slice().reverse().map(p => [160 - p[1] * wf, p[0]]);
  return R.concat(L);
}
function cnHullSmooth(H, wf) { return cnCatmullClosed(cnHullOutlinePts(H.st, wf)); }
// Плотный сэмпл ЗАМКНУТОЙ кривой Catmull-Rom (те же контрольные, что и cnCatmullClosed,
// но возвращаем точки, а не path). Нужен, чтобы щит был параллелен ВИДИМОМУ гладкому
// корпусу, а не ломаной по станциям → зазор одинаков по всему обводу.
function cnCatmullPoly(pts, seg) {
  const n = pts.length; if (n < 3) return pts.map(p => p.slice());
  seg = seg || 8; const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    for (let s = 0; s < seg; s++) {
      const t = s / seg, u = 1 - t;
      out.push([
        u * u * u * p1[0] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * p2[0],
        u * u * u * p1[1] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * p2[1]
      ]);
    }
  }
  return out;
}
function cnPolyPath(poly) { return 'M' + poly.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z'; }
// Единичная нормаль ребра a→b (поворот направления на −90°).
function cnEdgeNormal(a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dy / L, -dx / L]; }
// ИСТИННАЯ параллельная оболочка: смещение полигона по нормали на ПОСТОЯННОЕ
// расстояние d (px). В отличие от масштаба-от-центра, толщина стоянки одинакова
// по всему обводу и не раздувается вдоль оси у вытянутых корпусов. Знак нормали
// ориентируем наружу от центроида; на выпуклых углах — ограниченная miter-правка.
function cnOffsetPoly(pts, d, miterLim) {
  miterLim = miterLim || 2;
  const n = pts.length; if (n < 3) return pts.map(p => p.slice());
  // Наружу определяем по ОБХОДУ (знак площади), а не по центроиду: у вытянутого
  // корпуса с вогнутой «талией» центроидная эвристика заворачивала нормаль внутрь
  // в дентах бортов → оболочка проваливалась в корпус. Знак обхода корректен везде.
  let area = 0; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const n1 = cnEdgeNormal(p0, p1), n2 = cnEdgeNormal(p1, p2);
    let nx = n1[0] + n2[0], ny = n1[1] + n2[1], len = Math.hypot(nx, ny);
    if (len < 1e-3) { nx = n1[0]; ny = n1[1]; len = Math.hypot(nx, ny) || 1; }
    nx = nx / len * sgn; ny = ny / len * sgn;                                // наружу по обходу
    const cosHalf = Math.max(0.42, Math.abs(n1[0] * nx + n1[1] * ny));
    const m = Math.min(d / cosHalf, d * miterLim);                           // miter-лимит
    out.push([p1[0] + nx * m, p1[1] + ny * m]);
  }
  return out;
}
// ОКРУГЛЁННАЯ параллельная оболочка: то же постоянное смещение d, но выпуклые углы
// (нос, корма, транцевые денты) закрываются ДУГОЙ радиуса d, а не miter-остриём. Даёт
// гладкое поле, которое полностью накрывает даже острый нос корпуса, без спайков и срезов.
function cnOffsetRound(pts, d) {
  const n = pts.length; if (n < 3) return pts.map(p => p.slice());
  let area = 0; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    let n1 = cnEdgeNormal(p0, p1), n2 = cnEdgeNormal(p1, p2);
    n1 = [n1[0] * sgn, n1[1] * sgn]; n2 = [n2[0] * sgn, n2[1] * sgn];          // наружу по обходу
    const a1 = Math.atan2(n1[1], n1[0]);
    let da = Math.atan2(n2[1], n2[0]) - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    out.push([p1[0] + n1[0] * d, p1[1] + n1[1] * d]);
    if (da > 0.25) {                                                          // выпуклый угол → веер точек по дуге
      const steps = Math.min(10, Math.ceil(da / 0.3));
      for (let s = 1; s < steps; s++) { const a = a1 + da * s / steps; out.push([p1[0] + Math.cos(a) * d, p1[1] + Math.sin(a) * d]); }
    }
    out.push([p1[0] + n2[0] * d, p1[1] + n2[1] * d]);
  }
  return out;
}
// Выпуклая оболочка набора точек (Эндрю, monotone chain). Щит = энергопузырь, поэтому
// строим его вокруг ВЫПУКЛОГО контура корпуса → гладкий обвод без вмятин транца и без
// самопересечений (значит и без паразитных чёрточек у носа/кормы).
function cnConvexHull(pts) {
  const p = pts.map(x => x.slice()).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up);
}
// Надстройка («остров») по центру корпуса — на ней стоят мостик и реактор.
function cnIslandPath(H) {
  const nose = H.nose, ey = H.engine[1], span = ey - nose;
  const ys = [0.30, 0.40, 0.52, 0.62].map(t => nose + span * t);
  const wf = [0.30, 0.44, 0.44, 0.30];
  const st = ys.map((y, i) => [y, Math.min(cnHullHalf(H, y) * wf[i], 26)]);
  return cnCatmullClosed(cnHullOutlinePts(st, 1));
}
// Силуэты боевых кораблей (вид сверху): У КАЖДОГО КЛАССА СВОЙ характерный обвод —
// пары [t вдоль оси 0..1, доля полубимса]. Грани прямые (faceted) → механический вид.
// Ступеньки/денты по борту = крылья, спонсоны, казематы — узнаваемость класса, не «блоб».
const CN_HULL_PROFILES = {
  // ── ПРАВИЛА СИЛУЭТА (переписаны 01.08) ──
  // Что делало корпуса похожими на ДИРИЖАБЛИ и чего тут больше нет:
  //   ✗ оба конца сходятся на конус  → корма СРЕЗАНА (последняя станция широкая);
  //   ✗ пузо по центру, плавная кривая → максимум бимса СМЕЩЁН К КОРМЕ;
  //   ✗ непрерывное скругление       → длинные ПРЯМЫЕ параллельные борта;
  //   ✗ короткий и толстый           → удлинение 6–9:1, а не 4:1.
  // Излом плеча задаётся ДВОЙНОЙ точкой (почти совпадающие t) — иначе сглаживание
  // размажет угол обратно в каплю.
  // КОРВЕТ — клин со сложными скосами: остриё-таран, излом скулы, ОБРАТНЫЙ подрез
  // борта, вторая широкая грань и максимальный бимс у самой кормы. Мелкий класс,
  // но угловатый и злой — не «капелька с дюзой».
  corvette: [
    [0.00, 0.00], [0.06, 0.12], [0.09, 0.13],
    [0.22, 0.34], [0.25, 0.35],
    [0.30, 0.24], [0.34, 0.25],
    [0.44, 0.62], [0.47, 0.63],
    [0.53, 0.46], [0.58, 0.47],
    [0.66, 0.86], [0.69, 0.88],
    [0.74, 0.66], [0.79, 0.68],
    [0.84, 1.00], [0.93, 0.98],
    [1.00, 0.52],
  ],
  frigate: [
    [0.00, 0.00], [0.05, 0.12], [0.08, 0.13], [0.26, 0.26], [0.29, 0.27],
    [0.31, 0.70], [0.50, 0.74], [0.53, 0.42], [0.74, 0.44],
    [0.77, 0.94], [0.93, 0.96], [1.00, 0.80],
  ],
  destroyer: [
    [0.00, 0.00], [0.04, 0.10], [0.07, 0.11], [0.22, 0.24], [0.25, 0.25],
    [0.27, 0.66], [0.55, 0.70], [0.58, 0.40], [0.80, 0.42],
    [0.83, 0.98], [0.95, 1.00], [1.00, 0.86],
  ],
  // Средний крейсер — НЕ капсула: долотообразный нос прямыми гранями, длинный
  // параллельный борт со ступенью каземата, широкий срез кормы.
  // Средний крейсер — НЕ капсула: долотообразный нос прямыми гранями, длинный
  // параллельный борт со ступенью каземата, широкий срез кормы.
  cruiser: [
    [0.00, 0.00], [0.05, 0.14], [0.09, 0.15], [0.18, 0.40], [0.21, 0.41],
    [0.24, 0.76], [0.50, 0.78], [0.53, 0.50], [0.74, 0.52],
    [0.77, 0.98], [0.94, 0.98], [1.00, 0.86],
  ],
  // Линкор — плита с долотом на носу: ширина набирается прямыми гранями за три
  // излома, дальше борт идёт параллельно, корма срезана во всю ширину.
  // Линкор — плита с долотом на носу: ширина набирается прямыми гранями за три
  // излома, дальше борт идёт параллельно, корма срезана во всю ширину.
  battleship: [
    [0.00, 0.00], [0.05, 0.24], [0.09, 0.26], [0.14, 0.62], [0.17, 0.64],
    [0.20, 0.92], [0.50, 0.94], [0.53, 0.70], [0.72, 0.72],
    [0.75, 1.00], [0.95, 1.00], [1.00, 0.92],
  ],
  // ДРЕДНОУТ — гранёный монумент: ломаные скулы, ступень каземата по борту,
  // максимальный бимс ближе к корме. Изменена только КОРМА — сведена в клин
  // (раньше профиль к срезу расширялся и давал тупой обрубок). Плавную «каплю»
  // сюда ставить нельзя: гранёность и есть характер этого класса.
  dreadnought: [
    [0.00, 0.10], [0.05, 0.22], [0.09, 0.24], [0.16, 0.44], [0.19, 0.46],
    [0.21, 0.74], [0.40, 0.78], [0.43, 0.58], [0.60, 0.60],
    [0.63, 0.96], [0.78, 1.00], [0.87, 0.84], [0.94, 0.58], [1.00, 0.32],
  ],
  // Поддерживающий авианосец — не «баллон», а слэб: клиновидный нос прямыми
  // гранями, палуба прямоугольником со ступенью борта, кормовой срез во всю ширину.
  // Поддерживающий авианосец — не «баллон», а слэб: клиновидный нос прямыми
  // гранями, палуба прямоугольником со ступенью борта, кормовой срез во всю ширину.
  carrier: [
    [0.00, 0.00], [0.06, 0.34], [0.10, 0.36], [0.14, 0.86], [0.17, 0.88],
    [0.46, 0.90], [0.49, 0.72], [0.72, 0.74],
    [0.75, 0.94], [0.97, 0.96], [1.00, 0.90],
  ],
  // Многоцелевой авианосец — тот же слэб, но острее нос и уже корма: угловая
  // палуба даёт ступень борта ближе к корме.
  // Многоцелевой авианосец — тот же слэб, но острее нос и уже корма: угловая
  // палуба даёт ступень борта ближе к корме.
  assault: [
    [0.00, 0.00], [0.05, 0.22], [0.09, 0.24], [0.13, 0.66], [0.16, 0.68],
    [0.42, 0.72], [0.68, 0.74], [0.71, 0.52], [0.85, 0.54],
    [0.88, 0.96], [1.00, 0.86],
  ],
  // ФАКЕЛЬЩИК — не крейсер, а лафет: осевой ускоритель с дулом в носу и раздутый
  // кормовой энергоблок («факел»). Отсюда силуэт-игла: две трети длины корпус почти
  // не расширяется (там ствол и его хомуты), а вся масса собрана в корме. Ни у кого
  // больше нет такого перекоса — класс узнаётся по одному контуру.
  // ФАКЕЛЬЩИК — единственный корпус, СОБРАННЫЙ НЕ ПО ЛИНЕЙКЕ. Остальные классы
  // читаются как «нос → плечо → корма» с ровным ритмом скосов; здесь ритм НАРОЧНО
  // сбит: длинный тонкий выносной нос-волновод, потом резкий разлёт в широкую
  // трапецию энергоблока, глубокая ВЫЕМКА за ней (пустота между блоками — это и
  // есть «футуристичность»: конструкция, а не обтекаемый корпус), и косой срез
  // кормы. Шаги скосов разной длины и разной глубины — глаз не находит периода.
  hypercruiser: [
    // ФАКЕЛЬЩИК. Что чинится этой правкой: силуэт был ОДНИМ треугольником —
    // две прямые от острия до кормового среза во всю ширину. Такой контур не
    // читается конструкцией, у него нет ни одного события по длине.
    // Теперь и нос, и корма собраны из НЕСКОЛЬКИХ прямых граней с жёсткими
    // фасками между ними (двойная точка = острый угол), а корма кончается не
    // тупым срезом во всю ширину, а РАЗНЕСЁННЫМИ КОНСОЛЯМИ: максимум бимса
    // приходится на 0.90, дальше углы срезаны внутрь — транец уже консолей.
    [0.00, 0.00], [0.05, 0.08], [0.07, 0.09],     // остриё
    [0.26, 0.21], [0.29, 0.22],                   // фаска скулы №1
    [0.33, 0.27], [0.52, 0.38], [0.55, 0.39],     // грань до талии (перелом двойной точкой)
    [0.66, 0.58], [0.69, 0.60],                   // кормовая грань №1 — самая крутая
    [0.80, 0.72], [0.83, 0.74],                   // грань №2 — положе, отсюда гранёность
    [0.90, 1.00], [0.93, 0.99],                   // разлёт консолей: максимум бимса ЗДЕСЬ
    [1.00, 0.72],                                 // транец срезан внутрь — не тупой обрубок
  ],
  station: [
    [0.00, 0.46], [0.04, 0.72], [0.08, 0.74], [0.12, 0.98], [0.18, 1.00],
    [0.82, 1.00], [0.88, 0.98], [0.92, 0.74], [0.96, 0.72], [1.00, 0.46],
  ],
  // ── АРМЕЙСКИЕ СИЛУЭТЫ (единый форж, вид сверху) ──
  // ВАЖНО: контур сглаживается Catmull-Rom — резкие углы держим ДВОЙНЫМИ точками
  // (почти совпадающие t), иначе всё расплывается в блоб.
  // Пехотинец в силовой броне — рисуется ВЕРТИКАЛЬНО (сцена без поворота,
  // см. stand-ветку в сборке полотна): шлем сверху → шея → наплечники-ступени →
  // руки → талия → бёдра → ноги → ступни.
  peh: [
    [0.00, 0.14], [0.04, 0.28], [0.09, 0.28], [0.11, 0.16], [0.13, 0.16],
    [0.14, 0.92], [0.17, 1.00], [0.26, 1.00], [0.29, 0.60], [0.33, 0.56],
    [0.52, 0.50], [0.56, 0.62], [0.62, 0.62], [0.66, 0.42], [0.88, 0.38], [1.00, 0.24],
  ],
  // БТР — скошенный нос-клин, длинный ПАРАЛЛЕЛЬНЫЙ корпус (узкий, не овал),
  // ступень десантного отсека, срез кормы с аппарелью.
  btr: [
    [0.00, 0.20], [0.05, 0.52], [0.12, 0.96], [0.15, 1.00], [0.60, 1.00],
    [0.62, 0.90], [0.88, 0.90], [0.92, 1.00], [0.96, 1.00], [1.00, 0.80],
  ],
  // Танк — ЧИСТОЕ шасси корпуса (вид сверху, без ствола и башни): наклонная
  // лобовая плита, параллельные гусеничные полки во всю длину, тупой кормовой срез.
  tanki: [
    [0.00, 0.55], [0.05, 0.85], [0.09, 1.00], [0.11, 1.00], [0.91, 1.00],
    [0.93, 1.00], [0.97, 0.94], [1.00, 0.88],
  ],
  // САУ — шасси корпуса длиннее и ниже танкового: острее скос лба, длинные
  // параллельные гусеницы, скошенная корма.
  arta: [
    [0.00, 0.42], [0.05, 0.72], [0.10, 0.96], [0.13, 1.00], [0.89, 1.00],
    [0.93, 0.96], [1.00, 0.80],
  ],
  // Дрон — компактный корпус с крестовиной несущих лучей (роторные консоли по миделю).
  dron: [
    [0.00, 0.12], [0.12, 0.30], [0.22, 1.00], [0.36, 0.88], [0.48, 0.42],
    [0.58, 0.42], [0.68, 0.92], [0.80, 0.98], [0.90, 0.36], [1.00, 0.22],
  ],
  // Космодрон — угловатый дротик с боковыми пилонами сенсоров.
  dronkos: [
    [0.00, 0.00], [0.10, 0.26], [0.24, 0.36], [0.36, 0.94], [0.48, 1.00],
    [0.58, 0.52], [0.74, 0.46], [0.86, 0.68], [1.00, 0.30],
  ],
  // Самолёт — фюзеляж-игла, стреловидное крыло у миделя, узкая хвостовая балка, оперение.
  aviacia: [
    [0.00, 0.03], [0.10, 0.10], [0.28, 0.15], [0.38, 0.26], [0.50, 1.00],
    [0.60, 0.86], [0.66, 0.22], [0.82, 0.17], [0.92, 0.52], [1.00, 0.46],
  ],
  // Вертолёт — округлая кабина, размах несущего винта у миделя, тонкая балка, хвостовой ротор.
  vertihui: [
    [0.00, 0.24], [0.08, 0.58], [0.16, 0.78], [0.26, 1.00], [0.36, 0.82],
    [0.46, 0.42], [0.58, 0.18], [0.82, 0.14], [0.90, 0.44], [1.00, 0.38],
  ],
  // МЛА — истребитель-дельта: острый нос, треугольное крыло во весь размах к корме.
  mla: [
    [0.00, 0.02], [0.14, 0.10], [0.34, 0.20], [0.56, 0.44], [0.78, 1.00],
    [0.88, 0.96], [0.92, 0.48], [1.00, 0.40],
  ],
};
// KV-классы кораблей → характерный корпус (у части KV-ключей своего силуэта не было,
// и они падали в фолбэк «corvette»; заодно оживляем неиспользуемые cruiser/frigate).
const CN_KV_HULL = {
  supportCarrier: 'carrier', multiroleCarrier: 'assault',
  mediumCruiser: 'cruiser', hyperCruiser: 'hypercruiser', ss13: 'station',
  // Армейские классы единого форжа рисуются СВОИМИ профилями (см. CN_HULL_PROFILES выше).
};
function cnGenStations(k, tipY, sternY, beam) {
  const prof = CN_HULL_PROFILES[k] || CN_HULL_PROFILES.destroyer;
  return prof.map(([t, f]) => [Math.round(tipY + (sternY - tipY) * t), Math.round(beam * f)]);
}
// [tipY, sternY, beam(полубимс), rows(рядов узлов)]
const CN_SHIP_DIM = {
  corvette:    [46, 330, 22, 5],
  frigate:     [42, 344, 27, 6],
  destroyer:   [38, 352, 26, 7],
  cruiser:     [40, 350, 32, 7],
  battleship:  [38, 358, 40, 8],
  dreadnought: [24, 406, 64, 11],   // крупнее ДЛИНОЙ и клиновидностью, не шириной
  carrier:     [40, 360, 44, 9],
  assault:     [40, 358, 38, 8],
  hypercruiser:[26, 392, 46, 8],   // длинный и ШИРОКИЙ клин: не корвет-переросток, а лафет
  station:     [86, 320, 84, 7],
  // Армейские классы: короче и с меньшим числом рядов узлов (масштаб не корабельный)
  peh:         [122, 292, 30, 3],
  btr:         [92, 322, 38, 4],
  tanki:       [98, 318, 54, 4],
  arta:        [82, 330, 46, 5],
  dron:        [118, 296, 44, 3],
  dronkos:     [114, 300, 40, 3],
  aviacia:     [64, 332, 66, 5],
  vertihui:    [90, 330, 50, 4],
  mla:         [78, 322, 60, 4],
};
const CN_SHIP_ST = {};
for (const k in CN_SHIP_DIM) {
  const [tipY, sternY, beam, rows] = CN_SHIP_DIM[k];
  CN_SHIP_ST[k] = { st: cnGenStations(k, tipY, sternY, beam), nose: tipY + 8, y0: tipY + 34, y1: sternY - 12, rows };
}
const CN_SHIP_GEO = {};
for (const stK in CN_SHIP_ST) {
  const d = CN_SHIP_ST[stK], stLast = d.st[d.st.length - 1];
  CN_SHIP_GEO[stK] = Object.assign({ path: cnStPath(d.st), engine: [160, stLast[0]], maxHW: Math.max(...d.st.map(p => p[1])) }, d);
}
// Профиль полуширины корпуса (нос→корма) — запасной, если у геометрии нет станций
const CN_HULL_PROF = [[0, 0.30], [0.25, 0.86], [0.55, 1], [0.8, 0.9], [1, 0.62]];
function cnProf(t) { const p = CN_HULL_PROF; for (let i = 1; i < p.length; i++) { if (t <= p[i][0]) { const a = p[i - 1], b = p[i]; return a[1] + (b[1] - a[1]) * ((t - a[0]) / (b[0] - a[0] || 1)); } } return p[p.length - 1][1]; }
// Узлы подвеса — пары по бортам (центр свободен под отсеки-модули).
// rows растёт автоматически под число орудий → узлов всегда хватает.
function cnGenMounts(g, rows) {
  rows = rows || g.rows;
  const out = [];
  for (let r = 0; r < rows; r++) {
    const t = rows === 1 ? 0.5 : r / (rows - 1);
    const y = Math.round(g.y0 + t * (g.y1 - g.y0)), hw = cnHullHalf(g, y);   // точная полуширина в этом сечении
    if (hw < 16) { out.push([160, y]); continue; }       // узкий нос — узел по центру
    const off = Math.round(hw * 0.62);
    out.push([160 - off, y], [160 + off, y]);             // борта
    if (hw > 52) out.push([160, y]);                      // широкий корпус — ещё и центр
  }
  return out;
}
function cnMountsFor(g, need) {
  // rows растёт под фактическое число узлов: каждый ряд даёт ≥1 позицию, поэтому
  // потолок привязан к need (+запас), а не к фиксированным 22 — иначе у «лишних»
  // узлов не оказывалось координаты, и они не рисовались на схеме (нельзя выбрать/
  // перетащить), хотя энергии на них ещё хватало.
  let rows = g.rows, m = cnGenMounts(g, rows);
  const cap = Math.max(22, (need | 0) + 4);
  while (m.length < need && rows < cap) { rows++; m = cnGenMounts(g, rows); }
  return m;
}
// Визуал орудия: форма по группе (пушка/ракеты/ПВО), размер по ЗАТРАТАМ ЭНЕРГИИ, цвет по боеприпасу.
function cnWpnVisual(g, item) {
  const name = (item && item.name) || item;
  const kind = cnWpnResKind(name);
  const color = kind === 'energy' ? 'var(--te)' : kind === 'missile' ? 'var(--err)' : 'var(--t2)';
  // Размер орудия ∝ потреблению энергии (лог-шкала 20…2500 E → 0.45…0.95), компактно.
  // Нет энергии → фолбэк на базу калибра.
  const base = { 'Легкие': 0.5, 'Средние': 0.62, 'Тяжёлые': 0.75, 'Сверхтяжёлые': 0.9, 'Ракетное': 0.62, 'Зенитное': 0.45 }[g] || 0.62;
  const e = item && +item.energy;
  let wt;
  if (e > 0) {
    const t = Math.max(0, Math.min(1, (Math.log(e) - Math.log(20)) / (Math.log(2500) - Math.log(20))));
    wt = 0.45 + 0.5 * t;
  } else wt = base;
  const shape = g === 'Ракетное' ? 'missile' : g === 'Зенитное' ? 'aa' : 'gun';
  return { color, wt, shape };
}
function cnTurretSvg(m, vis, dir) {
  const x = m[0], y = m[1], s = vis.wt, c = vis.color, rot = (dir == null ? -90 : dir);
  if (vis.shape === 'missile') {                       // ПУ / VLS: короб с ячейками
    const w = 8 * s, h = 11 * s, x0 = x - w / 2, y0 = y - h / 2;
    let cells = '';
    for (let cy = 0; cy < 3; cy++) for (let cx = 0; cx < 2; cx++) cells += `<rect x="${(x0 + 1 + cx * (w - 2) / 2).toFixed(1)}" y="${(y0 + 1 + cy * (h - 2) / 3).toFixed(1)}" width="${((w - 2) / 2 - 1).toFixed(1)}" height="${((h - 2) / 3 - 1).toFixed(1)}" fill="var(--b1)"/>`;
    return `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.2" fill="${c}"/>${cells}`;
  }
  if (vis.shape === 'aa') {                              // ЗАК: тумба + спаренные стволы
    return `<circle cx="${x}" cy="${y}" r="${(3.2 * s).toFixed(1)}" fill="var(--b1)" stroke="${c}" stroke-width="1"/><circle cx="${x}" cy="${y}" r="${(1.6 * s).toFixed(1)}" fill="${c}"/><line x1="${x}" y1="${y}" x2="${(x - 5 * s).toFixed(1)}" y2="${(y - 6 * s).toFixed(1)}" stroke="${c}" stroke-width="${(1.3 * s).toFixed(1)}"/><line x1="${x}" y1="${y}" x2="${(x + 5 * s).toFixed(1)}" y2="${(y - 6 * s).toFixed(1)}" stroke="${c}" stroke-width="${(1.3 * s).toFixed(1)}"/>`;
  }
  // Артиллерийская башня: барбет + вращающийся блок + стволы (ориентированы на dir)
  const bb = (3.2 + 1.8 * s).toFixed(2), tl = 4 + 3 * s, tw = 2 + 1.4 * s, barL = 6 + 5 * s, barOff = (tw * 0.5).toFixed(2), barW = (1 + 0.4 * s).toFixed(2);
  return `<g transform="translate(${x},${y}) rotate(${rot})">`
    + `<circle r="${bb}" fill="var(--b1)" stroke="${c}" stroke-width="1"/>`
    + `<rect x="${(-tl * 0.35).toFixed(1)}" y="${(-tw).toFixed(1)}" width="${tl.toFixed(1)}" height="${(tw * 2).toFixed(1)}" rx="1.2" fill="${c}"/>`
    + `<line x1="${(tl * 0.5).toFixed(1)}" y1="-${barOff}" x2="${(tl * 0.5 + barL).toFixed(1)}" y2="-${barOff}" stroke="${c}" stroke-width="${barW}"/>`
    + `<line x1="${(tl * 0.5).toFixed(1)}" y1="${barOff}" x2="${(tl * 0.5 + barL).toFixed(1)}" y2="${barOff}" stroke="${c}" stroke-width="${barW}"/>`
    + `</g>`;
}
// Маркер модуля (контурные значки золотым) по группе.
function cnModuleMarker(g, x, y, col, sc) {
  const c = col || 'var(--gd)';
  if (sc && sc !== 1) return `<g transform="translate(${x},${y}) scale(${sc.toFixed(2)}) translate(${-x},${-y})">${cnModuleMarker(g, x, y, c, 0)}</g>`;
  if (g === 'Радарное оборудование') return `<path d="M${x - 5},${y + 2} A5,5 0 0,1 ${x + 5},${y + 2} Z" fill="none" stroke="${c}" stroke-width="1.3"/>`;
  if (g === 'Радиоэлектронная борьба') return `<line x1="${x}" y1="${y + 4}" x2="${x}" y2="${y - 5}" stroke="${c}" stroke-width="1.3"/><circle cx="${x}" cy="${y - 6}" r="1.7" fill="${c}"/>`;
  if (g === 'Активная защита') return `<path d="M${x},${y - 5} L${x + 4},${y - 2} L${x + 4},${y + 3} L${x},${y + 5} L${x - 4},${y + 3} L${x - 4},${y - 2} Z" fill="none" stroke="${c}" stroke-width="1.2"/>`;
  if (g === 'Управление') return `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" rx="1" fill="none" stroke="${c}" stroke-width="1.2"/>`;
  return `<path d="M${x},${y - 5} L${x + 5},${y} L${x},${y + 5} L${x - 5},${y} Z" fill="none" stroke="${c}" stroke-width="1.2"/>`;
}
function cnHullHero() { cnDrawShip(); }

// ── ПАРАМЕТРЫ ОТРИСОВКИ КОРПУСА для hull_gen (HG) ────────────
// Всё, что видно на корпусе, выводится из ВЫБОРА игрока: тон металла — из рецепта
// брони, крупность плит и толщина пояса — из её класса, число дюз — из двигателя,
// семейство надстройки — из класса корпуса. Сид держим стабильным (класс+подкласс),
// чтобы разбежка плит не «дрожала» при каждом пересчёте.
function cnHullSeed(k, tIdx) {
  let s = 7; const str = String(k) + '#' + (tIdx | 0);
  for (const ch of str) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return s || 7;
}
function cnHullOpt(H, k, tIdx, armorObj, engObj, aRt, groundCls) {
  const mm = String(engObj ? engObj.name : '').match(/(\d+)/);
  return {
    uid: 'cn', clip: 'cnBodyClip',
    hull: CN_KV_HULL[k] || k,
    aRt: Math.max(0, Math.min(1, aRt || 0)),
    armorName: armorObj ? armorObj.name : '',
    seed: cnHullSeed(k, tIdx),
    detail: 1,
    nozzles: mm ? Math.min(6, +mm[1]) : 1,
    ground: !!groundCls,
  };
}
// Запечённый SVG класса/подкласса для карточки выбора корпуса: тот же движок,
// что и на схеме, — игрок видит РЕАЛЬНЫЙ корпус, а не картинку-заглушку.
function cnHullPreviewSvg(k, tIdx) {
  if (typeof HG === 'undefined') return '';
  const db = CN.def && CN.def.db; if (!db || !db.data[k]) return '';
  const H0 = CN_SHIP_GEO[CN_KV_HULL[k] || k] || CN_SHIP_GEO.corvette;
  const H = tIdx != null ? cnTypeGeo(H0, db.data[k], tIdx) : H0;
  // Броня для превью — базовая (первая стоковая) плюс класс корпуса: карточка
  // показывает КОРПУС, а не текущую комплектацию проекта.
  const arm = (db.armors[k] || []).find(a => a && !a._alloy) || null;
  const maxAr = Math.max(...(db.armors[k] || []).map(a => a.armor)) || 1;
  return HG.preview(H, {
    uid: 'c' + cnSlugify(k) + (tIdx != null ? '_' + tIdx : ''),
    hull: CN_KV_HULL[k] || k,
    aRt: arm ? Math.min(1, (arm.armor || 0) / maxAr) : 0.4,
    armorName: arm ? arm.name : '',
    seed: cnHullSeed(k, tIdx == null ? 0 : tIdx),
    detail: 1, nozzles: 2,
    ground: CN.cat === 'army' && cnKvRealCat(k) === 'ground',
  });
}
function cnHullImgTag(k, tIdx, cls) {
  const svg = cnHullPreviewSvg(k, tIdx);
  return svg ? `<span class="cn-imgbox cn-imgbox-tg cn-imgbox-hull ${cls || ''}">${svg}</span>`
             : cnImgTag(cnImgPath(CN.cat, 'class', k), cls);
}

// ── Геометрия размещения ──
function cnHullHalf(H, y) {
  if (H.st) {                                             // точный профиль по станциям корпуса
    const s = H.st;
    if (y <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) if (y <= s[i][0]) { const a = s[i - 1], b = s[i]; return a[1] + (b[1] - a[1]) * ((y - a[0]) / ((b[0] - a[0]) || 1)); }
    return s[s.length - 1][1];
  }
  const t = Math.max(0, Math.min(1, (y - H.nose) / (H.engine[1] - H.nose))); return H.maxHW * cnProf(t);
}
function cnMountPositions(H, n) { if (n <= 0) return []; return cnMountsFor(H, n).slice(0, n); }
function cnGenBays(H, n) { if (n <= 0) return []; const e = H.engine, top = H.nose + (e[1] - H.nose) * 0.28, bot = H.nose + (e[1] - H.nose) * 0.78, out = []; for (let i = 0; i < n; i++) out.push([160, Math.round(n === 1 ? (top + bot) / 2 : top + (bot - top) * i / (n - 1))]); return out; }

// ── Переборки/отсеки: диаграмма Вороного внутри корпуса (декоративная реалистичность) ──
function cnSeedRand(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function cnPathPoly(d) { const n = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number), p = []; for (let i = 0; i + 1 < n.length; i += 2) p.push([n[i], n[i + 1]]); return p; }
function cnPtInPoly(pt, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c; } return c; }
function cnClipHalf(poly, a, b) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, nx = b[0] - a[0], ny = b[1] - a[1];
  const side = p => (p[0] - mx) * nx + (p[1] - my) * ny, out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prv = poly[(i + poly.length - 1) % poly.length], dc = side(cur), dp = side(prv);
    if (dc <= 0) { if (dp > 0) { const t = dp / (dp - dc); out.push([prv[0] + t * (cur[0] - prv[0]), prv[1] + t * (cur[1] - prv[1])]); } out.push(cur); }
    else if (dp <= 0) { const t = dp / (dp - dc); out.push([prv[0] + t * (cur[0] - prv[0]), prv[1] + t * (cur[1] - prv[1])]); }
  }
  return out;
}
function cnHullBulkheads(H) {
  const poly = cnPathPoly(H.path);
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const rnd = cnSeedRand(Math.round(maxy * 13 + maxx * 7 + poly.length));
  const target = Math.max(7, Math.round((maxy - miny) / 22)), seeds = [];
  let tries = 0;
  while (seeds.length < target && tries < 600) { tries++; const p = [minx + rnd() * (maxx - minx), miny + rnd() * (maxy - miny)]; if (cnPtInPoly(p, poly)) seeds.push(p); }
  let out = '';
  seeds.forEach((s, i) => { let cell = poly.slice(); for (let j = 0; j < seeds.length && cell.length >= 3; j++) { if (j !== i) cell = cnClipHalf(cell, s, seeds[j]); } if (cell.length >= 3) out += `<polygon points="${cell.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="var(--w2)" stroke-width="0.6" opacity="0.4"/>`; });
  return out;
}
// Аккуратная разбивка внутреннего пространства корпуса на ОТСЕКИ (палубы × борта)
function cnAxisInt(p1, p2, axis, val) { const a = axis === 'x' ? 0 : 1, t = (val - p1[a]) / ((p2[a] - p1[a]) || 1e-9); return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])]; }
function cnClipAxis(poly, axis, val, keepGE) {
  const get = p => axis === 'x' ? p[0] : p[1], inside = p => keepGE ? get(p) >= val : get(p) <= val, out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prv = poly[(i + poly.length - 1) % poly.length], ic = inside(cur), ip = inside(prv);
    if (ic) { if (!ip) out.push(cnAxisInt(prv, cur, axis, val)); out.push(cur); }
    else if (ip) out.push(cnAxisInt(prv, cur, axis, val));
  }
  return out;
}
// ── РАЗРЕЗ МОДУЛЬНОЙ ПАЛУБЫ ────────────────────────────────────────────────────
// Отдельный крупный вид: решётка ячеек, модуль занимает прямоугольник по габариту.
// Корпус тут не при чём — это «что где стоит», а не силуэт корабля.
// ── ПАЛУБА: ОТДЕЛЬНЫЙ ПОЛНОЭКРАННЫЙ РЕЖИМ ──────────────────────────────────────
// Не панель на сайте и не слой поверх корпуса: жмёшь «Палуба» — весь экран под
// решётку отсеков. Корпуса тут нет вообще, подписей внутри клеток нет: цвет =
// семья, значок = что за модуль, полоса = отдача. Слова живут в подсказке.
const CN_FAM_COL = {
  jam: '#e0575f', dejam: '#57d8e0', pd: '#e0b457', stealth: '#9aa4b2',
  sensor: '#57d8e0', hangar: '#e0b457', interdict: '#e0575f', stabil: '#57d8e0',
  ftl: '#b98cff', hull: '#6b7787',
};
function cnDeckOpen() {
  if (!CN.def || !CN.def.cardUI) return;
  CN.deck = true;
  let host = cnId('cn-deck');
  if (!host) {
    host = document.createElement('div');
    host.id = 'cn-deck'; host.className = 'cn-deck';
    document.body.appendChild(host);
    document.addEventListener('keydown', cnDeckKey);
  }
  document.body.classList.add('cn-deck-on');
  if (!CN._dkPaintBound) {                          // рисование протяжкой: отпустили — кисть встала
    document.addEventListener('mouseup', () => { CN.dkPaint = false; });
    CN._dkPaintBound = true;
  }
  if (!CN._dkResizeBound) {                         // поворот телефона меняет ориентацию листа
    window.addEventListener('resize', () => { if (CN.deck) { cnDeckDraw(); cnDeckPalDraw(); } });
    CN._dkResizeBound = true;
  }
  cnDeckDraw();
  cnDeckPalDraw();
}
function cnDeckClose() {
  CN.deck = false; CN.dkGhost = null; CN.dkHover = -1;
  const host = cnId('cn-deck'); if (host) host.remove();
  document.removeEventListener('keydown', cnDeckKey);
  document.body.classList.remove('cn-deck-on');
  cnVehCalc();
}
function cnDeckKey(e) {
  if (e.key !== 'Escape' || !CN.deck) return;
  e.preventDefault();
  if (CN.dkGhost) { cnDeckGhostOff(); return; }     // сначала снимаем кисть, потом закрываем
  cnDeckClose();
}
// Палуба состоит из ЧЕРТЕЖА и ПАЛИТРЫ, и перерисовываются они порознь: чертёж
// дёргается на каждое движение мыши (габарит под курсором), а палитра — только
// когда меняются сортировка, фильтр или выбранный инструмент. Иначе поле поиска
// теряло бы фокус на каждую букву.
function cnDeckParts() {
  const host = cnId('cn-deck'); if (!host) return null;
  let main = document.getElementById('cn-deck-main');
  if (!main) {
    host.innerHTML = `<div id="cn-deck-main" class="cn-deck-main"></div>`
      + `<div id="cn-deck-pal" class="cn-deck-pal"></div>`;
    main = document.getElementById('cn-deck-main');
  }
  return { host, main, pal: document.getElementById('cn-deck-pal') };
}
function cnDeckDraw() {
  const parts = cnDeckParts(); if (!parts || !CN.deck) return;
  const host = parts.main;
  const k = cnId('cn-class').value;
  cnBaysFit(k);
  const map = cnPlateMap(k), G = map.G, C = G.C, CX = C, CY = C;
  // Корабль лежит горизонтально: экранный X = вдоль корпуса (шаг CY), Y = поперёк (шаг CX).
  const SX = (gx, gy) => G.oy + gy * CY, SY = (gx, gy) => G.ox + gx * CX;
  const vx = G.oy - CY, vy = G.ox - CX, vw = G.h * CY + CY * 2, vh = G.w * CX + CX * 2;
  // ⚠️ ТЕЛЕФОН: лист «лёжа» на узком экране сжимался в ниточку. Всю сцену строим
  // по-старому (горизонт), а на выходе поворачиваем на −90°: нос уходит ВНИЗ,
  // корпус вытягивается по длинной стороне экрана. Клики/наведение живут внутри
  // трансформа, поэтому логика гнёзд не меняется — только значки контурим обратно.
  const vert = (window.innerWidth || 9999) <= 700;
  const P = [];
  // РЕШЁТКА НА ВЕСЬ ЛИСТ — как миллиметровка под чертежом: сразу видно, что клетка
  // одна и та же, а корабль просто лежит на ней и накрывает столько, сколько накрывает.
  {
    // ⚠️ Решётка ПРИВЯЗАНА К ЛАТИЦЕ КЛЕТОК (G.oy/G.ox), а не к нулю листа: ox/oy
    // дробные, и линии по кратным C проходили между гнёздами — «миллиметровка»
    // жила своей жизнью, отсюда и ощущение разнобоя. Цвет тоже общий со слотами.
    // Каждая 8-я линия — «шпангоут»: ярче и сплошная. Мелкая сетка при этом уходит
    // в фон, и лист перестаёт быть однородной кашей из ниток.
    const gl = [], gm = [];
    const x0 = G.oy - Math.ceil((G.oy - vx) / CY) * CY, y0 = G.ox - Math.ceil((G.ox - vy) / CX) * CX;
    for (let t = x0, i = Math.round((x0 - G.oy) / CY); t <= vx + vw; t += CY, i++)
      (i % 8 ? gl : gm).push(`M${t.toFixed(1)} ${vy.toFixed(1)}V${(vy + vh).toFixed(1)}`);
    for (let t = y0, i = Math.round((y0 - G.ox) / CX); t <= vy + vh; t += CX, i++)
      (i % 8 ? gl : gm).push(`M${vx.toFixed(1)} ${t.toFixed(1)}H${(vx + vw).toFixed(1)}`);
    P.push(`<path d="${gl.join('')}" stroke="#7fd4ff" stroke-opacity="0.05" stroke-width="0.5" fill="none"/>`);
    P.push(`<path d="${gm.join('')}" stroke="#7fd4ff" stroke-opacity="0.13" stroke-width="0.7" fill="none"/>`);
  }
  // силуэт корпуса под сеткой — тёмная подложка, по ней видно, где палуба
  P.push(`<path d="${HG.hullPathOf(G.H, 1)}" transform="matrix(0 1 1 0 0 0)" fill="#111a24" stroke="#2c3a49" stroke-width="2"/>`);
  // ПУСТЫЕ КЛЕТКИ — ЭТО СЛОТЫ, А НЕ КНОПКИ. Раньше по каждой можно было щёлкнуть
  // и получить модалку; редактирование расползлось по двум способам сразу. Теперь
  // способ один — инструмент из каталога, — а решётка просто показывает гнёзда:
  // срезанные углы, тусклая заливка, уголки-кернеры. Мышь их «видит» только когда
  // в руке кисть (иначе pointer-events выключен, и клик по пустоте ничего не делает).
  // ⚠️ СВОБОДНОЕ МЕСТО — ЭТО ОБЪЁМ, А НЕ РОССЫПЬ ФИШЕК. Раньше каждая пустая клетка
  // рисовалась своей фигурой со срезами: сотни одинаковых восьмиугольников равного
  // веса читались как поле «три-в-ряд», без иерархии и направления. Теперь пустота
  // рисуется МАССИВОМ: сплошная тусклая заливка + шов ТОЛЬКО по внешней границе
  // (ребро между свободной клеткой и занятой/обшивкой), а шаг решётки внутри даёт
  // мелкая насечка. Гнездо видно там, где оно есть — на кромке массива.
  const BANDC = { bow: '#79c0ff', mid: '#7fd4ff', stern: '#e0b457' };   // цвет = отсек
  const brush = !!CN.dkGhost;
  const pe = brush ? 'auto' : 'none';
  {
    const free = i => i >= 0 && i < G.w * G.h && (G.inside[i] || G.outer[i]) && map.own[i] < 0;
    const kindOf = i => (G.inside[i] ? 'deck' : 'belt');
    const fill = { deck: [], belt: [] }, seam = {}, dot = [], hit = [];
    for (let gy = 0; gy < G.h; gy++) for (let gx = 0; gx < G.w; gx++) {
      const i2 = gy * G.w + gx; if (!free(i2)) continue;
      const kind = kindOf(i2), isDeck = kind === 'deck', sk = isDeck && G.skin[i2];
      const x = SX(gx, gy), y = SY(gx, gy);
      fill[kind].push(`M${x.toFixed(1)} ${y.toFixed(1)}h${CY}v${CX}h${-CY}Z`);
      // насечка шага: точка в узле решётки, не фигура вокруг клетки
      dot.push(`M${(x + CY / 2).toFixed(1)} ${(y + CX / 2).toFixed(1)}h0.01`);
      // ШОВ: ребро наружу. Сосед по gx — вертикаль экрана, по gy — горизонталь.
      const col = isDeck ? (BANDC[G.band[i2]] || '#7fd4ff') : '#9fb3c8';
      const e = seam[col] || (seam[col] = []);
      const nb = [
        [gx > 0 ? i2 - 1 : -1, `M${x.toFixed(1)} ${y.toFixed(1)}h${CY}`],                       // борт «выше»
        [gx < G.w - 1 ? i2 + 1 : -1, `M${x.toFixed(1)} ${(y + CX).toFixed(1)}h${CY}`],          // борт «ниже»
        [gy > 0 ? i2 - G.w : -1, `M${x.toFixed(1)} ${y.toFixed(1)}v${CX}`],                     // к носу
        [gy < G.h - 1 ? i2 + G.w : -1, `M${(x + CY).toFixed(1)} ${y.toFixed(1)}v${CX}`]         // к корме
      ];
      nb.forEach(([n, d]) => { if (n < 0 || !free(n) || kindOf(n) !== kind) e.push(d); });
      hit.push(`<g class="cn-dk-slot" onclick="cnDeckPick(${i2})" onmouseover="cnDeckHover(${i2})">`
        + `<title>${isDeck ? (CN_BAND_RU[G.band[i2]] || '') + (sk ? ', борт' : ', ядро корпуса') : 'Внешний пояс — навесная броня'}</title>`
        + `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${CY}" height="${CX}" fill="transparent"/></g>`);
    }
    if (fill.belt.length) P.push(`<path d="${fill.belt.join('')}" fill="#9fb3c8" fill-opacity="0.04"/>`);
    if (fill.deck.length) P.push(`<path d="${fill.deck.join('')}" fill="#7fd4ff" fill-opacity="0.06"/>`);
    P.push(`<path d="${dot.join('')}" stroke="#cfe0ee" stroke-opacity="0.16" stroke-width="1.1" stroke-linecap="round" fill="none"/>`);
    Object.keys(seam).forEach(col => P.push(`<path d="${seam[col].join('')}" stroke="${col}" stroke-opacity="0.6" stroke-width="1" stroke-linecap="square" fill="none"/>`));
    P.push(`<g pointer-events="${pe}" style="cursor:${brush ? 'crosshair' : 'default'}">${hit.join('')}</g>`);
  }
  // НАВЕСНОЕ И СИСТЕМНОЕ: броневые плиты, орудийные узлы, усилители
  map.sys.forEach(s => {
    const gx = s.at % G.w, gy = (s.at / G.w) | 0, x = SX(gx, gy), y = SY(gx, gy);
    const cw = s.h * CY, ch = s.w * CX, S = CN_SYS[s.sys], on = true;
    const wp = S.gun ? ((CN.shipLayout.bays[s.at] || {}).mount) : null;
    const wo = wp != null && CN.shipLayout.mounts[wp] && CN.shipLayout.mounts[wp].w;
    P.push(`<g style="cursor:pointer" onclick="cnDeckPick(${s.at})" onmouseover="cnDeckHover(${s.at})"><title>${esc(S.name)}`
      + (S.gun ? (wo ? ' — орудие поставлено' : ' — пусто, выберите орудие') : '')
      + (S.outer ? ` — +${Math.round(CN_ARMOR_PER_CELL * S.hp * s.cells.length * 100)}% к прочности` : '')
      + `</title>`
      + `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" fill="${S.col}" fill-opacity="${on ? 0.28 : 0.06}" stroke="${S.col}" stroke-opacity="${on ? 1 : 0.35}" stroke-width="1.4"/>`
      + (s.sys === 'beacon'
        ? `<circle cx="${x + cw / 2}" cy="${y + ch / 2}" r="${CN_BEACON_R * C}" fill="none" stroke="${S.col}" stroke-opacity="0.25" stroke-dasharray="3 3"/>`
        : '')
      + `</g>`);
  });
  // СВЯЗИ: между соседями одной семьи тянем жилу — синергию видно, а не додумываешь
  // Центр контура — середина ВСЕХ его клеток, а не якорной: контур бывает любой формы.
  const ctr = m => {
    let sx = 0, sy = 0;
    m.cells.forEach(c => { const gx = c % G.w, gy = (c / G.w) | 0; sx += SX(gx, gy) + CY / 2; sy += SY(gx, gy) + CX / 2; });
    return [sx / m.cells.length, sy / m.cells.length];
  };
  map.mods.forEach(m => {
    if (m.fam === 'hull' || !m.nb) return;
    const a = ctr(m), col = CN_FAM_COL[m.fam] || '#e0b457';
    (m.link || []).forEach(o => {
      const b = ctr(o); if (o.at < m.at) return;                  // жилу рисуем один раз на пару
      P.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${col}" stroke-width="${(C * 0.13).toFixed(1)}" stroke-linecap="round" opacity="0.85"/>`);
    });
  });
  // модули
  // КОНТУР рисуется ВСЕМИ своими клетками. Раньше рисовалась одна якорная —
  // ставишь вторую клетку модуля, а она выглядит пустой: «иконки пропадают».
  // Значок и полоса отдачи — один на контур, в его середине.
  map.mods.forEach(m => {
    const col = CN_FAM_COL[m.fam] || '#e0b457';
    const bar = m.fam === 'hull' ? 0 : Math.max(0.05, Math.min(1, m.k / CN_PLATE.hi));
    const own = new Set(m.cells);
    let body = '';
    m.cells.forEach(c => {
      const gx = c % G.w, gy = (c / G.w) | 0, x = SX(gx, gy), y = SY(gx, gy);
      // внутренние грани контура не обводим — видно цельную фигуру, а не сетку коробок
      body += `<rect x="${x}" y="${y}" width="${CY}" height="${CX}" fill="${col}" fill-opacity="0.22"/>`;
      // ⚠️ ОСИ НЕ ПУТАТЬ: сосед по gy сдвинут по ЭКРАННОМУ X (корабль лежит вдоль),
      // сосед по gx — по экранному Y. Обводим только грани, за которыми контура нет.
      const edge = (has, seg) => { if (!has) body += seg; };
      const at = (nx, ny) => (nx >= 0 && ny >= 0 && nx < G.w && ny < G.h) && own.has(ny * G.w + nx);
      edge(at(gx, gy - 1), `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + CX}" stroke="${col}" stroke-width="1.4"/>`);
      edge(at(gx, gy + 1), `<line x1="${x + CY}" y1="${y}" x2="${x + CY}" y2="${y + CX}" stroke="${col}" stroke-width="1.4"/>`);
      edge(at(gx - 1, gy), `<line x1="${x}" y1="${y}" x2="${x + CY}" y2="${y}" stroke="${col}" stroke-width="1.4"/>`);
      edge(at(gx + 1, gy), `<line x1="${x}" y1="${y + CX}" x2="${x + CY}" y2="${y + CX}" stroke="${col}" stroke-width="1.4"/>`);
    });
    // Значок не раздувается вместе с контуром: он метка, а не заливка.
    const [cx, cy] = ctr(m), sz = Math.max(C * 1.2, Math.min(C * 3, Math.sqrt(m.cells.length) * C * 0.7));
    P.push(`<g class="cn-dk-mod" style="cursor:pointer" onclick="cnDeckPick(${m.at})" onmouseover="cnDeckHover(${m.at})">`
      + `<title>${esc(m.mod.name || '')} — ${CN_FAM_RU[m.fam] || m.fam}, ${m.size}/${m.nom} кл., ${cnNum(+m.mod.energy || +m.mod.power || 0)} E`
      + (m.fam === 'hull' ? '' : `, отдача ${Math.round(m.k * 100)}%, соседей ${m.nb}`
        + (m.bc ? `, усилителей ${m.bc}` : '') + (m.shapeWhy ? ', ' + m.shapeWhy : '')) + `</title>`
      + body
      + (vert ? `<g transform="rotate(90 ${cx.toFixed(1)} ${cy.toFixed(1)})">` : '')
      + cnModuleMarker(m.ref.g, cx, cy - (bar ? 2 : 0), col, sz / 15)
      + (vert ? `</g>` : '')
      + (bar ? `<rect x="${(cx - sz / 3).toFixed(1)}" y="${(cy + sz / 3).toFixed(1)}" width="${((sz * 2 / 3) * bar).toFixed(1)}" height="2" rx="1" fill="${col}"/>` : '')
      + `</g>`);
  });
  // ── КИСТЬ: подсветка всех посадочных мест + габарит под курсором ───────────────
  let ghostBar = '';
  const sp = cnGhostSpec(k);
  if (sp) {
    let spots = 0;
    for (let c = 0; c < G.w * G.h; c++) {
      const cells = cnGhostCells(map, sp, c); if (!cells) continue;
      spots++;
      const gx = c % G.w, gy = (c / G.w) | 0;
      P.push(`<rect x="${SX(gx, gy) + CY * 0.32}" y="${SY(gx, gy) + CX * 0.32}" width="${(CY * 0.36).toFixed(1)}" height="${(CX * 0.36).toFixed(1)}" rx="1"`
        + ` fill="#5ad18a" fill-opacity="0.55" pointer-events="none"/>`);
    }
    const hov = CN.dkHover >= 0 ? cnGhostCells(map, sp, CN.dkHover) : null;
    if (hov) hov.forEach(c => {
      const gx = c % G.w, gy = (c / G.w) | 0;
      P.push(`<rect x="${SX(gx, gy) + 0.5}" y="${SY(gx, gy) + 0.5}" width="${CY - 1}" height="${CX - 1}" rx="2"`
        + ` fill="${sp.col}" fill-opacity="0.45" stroke="#5ad18a" stroke-width="1.4" pointer-events="none"/>`);
    });
    // ⚠️ НЕ absolute: панель кисти встаёт СТРОКОЙ под шкалами (иначе наезжала на них)
    ghostBar = `<div class="cn-deck-ghost">`
      + `<i class="cn-deck-m" style="color:#5ad18a">Ставим: ${esc(sp.name)} — ${sp.outer ? sp.len + ' кл. по борту' : sp.w + '×' + sp.h}</i>`
      + `<i class="cn-deck-m">${spots ? 'свободных мест: ' + spots : 'мест не осталось'}</i>`
      + `<button class="btn btn-gh btn-sm" onclick="cnDeckGhostOff()">Готово (Esc)</button></div>`;
  }
  const used = map.own.filter(o => o >= 0).length;
  const eSum = map.mods.reduce((s2, m) => s2 + (+m.mod.energy || +m.mod.power || 0), 0);
  const eMax = (CN.last && CN.last.eMax) || 0, eAll = (CN.last && CN.last.eCons) || eSum;
  const eLeft = eMax - eAll, eRt = eMax ? Math.max(0, Math.min(1, eAll / eMax)) : 0;
  // ── ШКАЛЫ БЮДЖЕТОВ: клетки, нагрузка (вес), энергия ───────────────────────────
  // Легенда «нос/мидель/корма» тут не нужна — цвета и так на палубе. Нужно другое:
  // сколько ЕЩЁ можно навесить. Три шкалы: заполнение, остаток числом, перебор красным.
  const KVs = (CN.last && CN.last.kv) || null;
  const gauge = (lab, left, max, unit) => {
    const use = max - left, r = max > 0 ? Math.max(0, Math.min(1, use / max)) : 0;
    const cls2 = left < 0 ? ' bad' : r > 0.9 ? ' warn' : '';
    return `<i class="cn-deck-m cn-deck-g${cls2}" title="${esc(lab)}: занято ${cnNum(Math.round(use))} из ${cnNum(Math.round(max))} ${esc(unit)}">`
      + `<u>${esc(lab)}</u><b>${cnNum(Math.round(left))}</b><s>из ${cnNum(Math.round(max))} ${esc(unit)}</s>`
      + `<em style="--r:${(r * 100).toFixed(0)}%"></em></i>`;
  };
  let gauges = gauge('клетки', G.n - used, G.n, 'кл.');
  // В KV-режиме правда о весе и энергии — в kv.cap / kv.power (палуба уже вычтена).
  if (KVs) {
    gauges += gauge('нагрузка', KVs.cap, KVs.capMax || Math.max(1, KVs.cap), 'ед.');
    if (KVs.powerMax > 0) gauges += gauge('энергия', KVs.power, KVs.powerMax, 'E');
  } else if (eMax > 0) {
    gauges += gauge('энергия', eLeft, eMax, 'E');
  }
  // Боевой итог тут же: палуба меняет прочность (плиты) и урон (узлы орудий) — раз
  // числа участвуют в расчёте, нечего гонять игрока обратно в карточку за ними.
  const S0 = CN.last || {};
  const stat = (lab, v, col) => `<i class="cn-deck-m cn-deck-g cn-deck-st" style="--fc:${col}"><u>${esc(lab)}</u><b>${v}</b></i>`;
  if (S0.hp) gauges += stat('прочность', cnNum(Math.round(S0.hp)) + ' HP', '#5ad18a');
  if (S0.armor) gauges += stat('броня', '+' + cnNum(Math.round(S0.armor)), '#9fb3c8');
  if (S0.shield) gauges += stat('щит', cnNum(Math.round(S0.shield)), '#79c0ff');
  if (S0.dmg) gauges += stat('урон', cnNum(Math.round(S0.dmg)), '#e0575f');
  // ИТОГ ПЛАТЫ: сумма боевых эффектов уже С УЧЁТОМ отдачи каждой ячейки —
  // ровно то, что уедет в бой. Одно число на семью, без простыней.
  const tot = {}, base = {};
  const acc = (o, key, v) => { o[key] = (key === 'jam' || key === 'dejam') ? Math.max(o[key] || 0, v) : (o[key] || 0) + v; };
  map.mods.forEach(m => {
    const c = m.mod.combat || {}; if (m.fam === 'hull') return;
    for (const key of ['pd', 'jam', 'dejam', 'stealth', 'sensor', 'hangar']) {
      if (!+c[key]) continue;
      acc(tot, key, +c[key] * m.k);            // с учётом расстановки — это уедет в бой
      acc(base, key, +c[key]);                 // «в одиночку», для сравнения
    }
    ['interdict', 'stabil', 'ftl'].forEach(key => { if (+c[key]) { tot[key] = 1; base[key] = 1; } });
  });
  const NM = { pd: 'ПРО', jam: 'РЭБ', dejam: 'контр-РЭБ', stealth: 'скрытность', sensor: 'радар', hangar: 'авиакрылья', interdict: 'интердикция', stabil: 'стабилизация', ftl: 'FTL' };
  const val = (key, v) => key === 'pd' ? Math.round(Math.min(0.6, v) * 100) + '%'
    : key === 'hangar' ? String(Math.floor(v / 300))
    : key === 'jam' ? '−' + v.toFixed(1) : '+' + v.toFixed(1);
  // Чип: КРУПНО итог, мелко — сколько было бы без расстановки и что дала раскладка.
  const yieldChips = Object.keys(tot).map(key => {
    const t = tot[key], b = base[key], flag = key === 'interdict' || key === 'stabil' || key === 'ftl';
    const d = b ? Math.round((t / b - 1) * 100) : 0;
    const col = CN_FAM_COL[key] || '#e0b457';
    return `<i class="cn-deck-y" style="--fc:${col}"><b>${esc(NM[key])}</b>`
      + (flag ? `<u>есть</u>` : `<u>${val(key, t)}</u>`)
      + (flag || !d ? `<s>без бонуса</s>` : `<s class="${d > 0 ? 'up' : 'dn'}">${val(key, b)} ${d > 0 ? '▲+' : '▼'}${d}%</s>`)
      + `</i>`;
  }).join('');
  const capWarn = tot.pd > 0.6 ? `<i class="cn-deck-y" style="--fc:#e0575f"><b>ПРО</b><u>потолок</u><s>всё сверх 60% сгорает</s></i>` : '';
  host.innerHTML = `<button class="cn-deck-x" onclick="cnDeckClose()" title="Закрыть (Esc)">✕</button>`
    + `<div class="cn-deck-top">`
    + `<div class="cn-deck-bar">` + gauges
    + (map.fams.length > 1 ? `<i class="cn-deck-m bad">разнобой ×${map.dil.toFixed(2)}</i>` : '')
    + `</div>` + ghostBar + `</div>`
    + `<div class="cn-deck-yield">${yieldChips + capWarn || '<i class="cn-deck-m">палуба пуста</i>'}</div>`
    + `<svg class="cn-deck-svg" onmousedown="CN.dkPaint=!!CN.dkGhost" viewBox="${vert ? `${vy} ${-(vx + vw)} ${vh} ${vw}` : `${vx} ${vy} ${vw} ${vh}`}" preserveAspectRatio="xMidYMid meet">`
    + (vert ? `<g transform="rotate(-90)">${P.join('')}</g>` : P.join(''))
    + `</svg>`;
}
// ── РЕЖИМ УСТАНОВКИ: «куда это вообще влезет» видно ДО клика ────────────────────
// Жалоба была прямая: ставишь второй-третий узел — и не понять, где ещё осталось
// место под ячейку. Теперь выбранный в пикере узел (или модуль) остаётся «на
// кисти»: палуба подсвечивает ВСЕ годные посадочные клетки, наведение рисует
// точный габарит, клик ставит и не выходит из режима — можно класть подряд.
// Esc или клик по плашке — снять кисть.
function cnDeckGhost(g) { CN.dkGhost = g || null; CN.dkHover = -1; if (CN.deck) { cnDeckDraw(); cnDeckPalRows(); } }
function cnDeckGhostOff() { CN.dkGhost = null; CN.dkHover = -1; CN.dkPaint = false; if (CN.deck) { cnDeckDraw(); cnDeckPalRows(); } }
// ── ПАЛИТРА: каталог палубы списком, сортируемый ────────────────────────────────
// Тыкать в клетку и разбирать модалку — годится, когда ставишь одну штуку. Когда
// собираешь корабль, нужен верстак: слева чертёж, справа список всего, что вообще
// можно положить, с сортировкой и поиском. Взял инструмент — рисуешь им по палубе,
// хоть протяжкой. Ластик — такой же инструмент, только снимает.
// «по конструкции» = по тому, ЧТО деталь делает на борту (РЭБ, ПРО, броня, узлы),
// а не по каталожной группе: в KV одна группа мешает радар с транспондером.
const CN_PAL_SORT = { fam: 'по конструкции', grp: 'по группе', name: 'по названию', e: 'по энергии', cost: 'по цене', size: 'по размеру' };
function cnDeckPalItems(k) {
  const out = [{ kind: 'erase', name: 'Ластик', sz: 'снять', col: '#e0575f', e: 0, cost: 0, size: 0, grp: '— инструмент', fam: '— инструмент' }];
  for (const sk in CN_SYS) {
    const S = CN_SYS[sk];
    out.push({
      kind: 'sys', sk, name: S.name, col: S.col, e: S.energy || 0, cost: S.gs || 0,
      size: S.outer ? S.len : S.cells[0] * S.cells[1],
      sz: S.outer ? `${S.len} кл. по борту` : `${S.cells[0]}×${S.cells[1]}`,
      grp: S.outer ? 'Навесная броня' : S.gun ? 'Орудийные узлы' : 'Разводка палубы',
      fam: S.outer ? 'Броня навесная' : S.gun ? 'Орудийные узлы' : 'Разводка палубы',
      note: S.outer ? `+${(CN_ARMOR_PER_CELL * S.hp * S.len * 100).toFixed(1)}% HP · нагрузка ${S.mass}`
        : S.gun ? `калибр ${S.gun === 's' ? 'лёгкий' : S.gun === 'm' ? 'средний' : 'тяжёлый'} · нагрузка ${S.mass}` : '',
    });
  }
  const db = CN.def.db;
  for (const g in db.modules) {
    if (!cnModUnlocked(CN.cat, g) || !cnGroupVisible('module', k, g, db.modules)) continue;
    (db.modules[g] || []).forEach((m, i) => {
      if (!cnItemAvail('module', k, g, i)) return;
      const fam = cnModFam(m);
      out.push({
        kind: 'mod', g, idx: i, name: m.name || '', col: CN_FAM_COL[fam] || '#7fd4ff',
        e: +m.energy || +m.power || 0, cost: +m.cost || 0, size: 1, sz: '1×1', grp: g, fam: CN_FAM_RU[fam] || fam,
        note: (CN_FAM_RU[fam] || fam) + (CN_ZONE_RULE[fam] ? ' · ' + CN_ZONE_RULE[fam].band.map(b => CN_BAND_RU[b]).join('/') : ''),
      });
    });
  }
  return out;
}
function cnDeckPalSorted(k) {
  const s = CN.dkSort || 'fam', q = (CN.dkQ || '').trim().toLowerCase();
  let list = cnDeckPalItems(k);
  if (q) list = list.filter(x => x.kind === 'erase' || (x.name + ' ' + (x.grp || '') + ' ' + (x.fam || '') + ' ' + (x.note || '')).toLowerCase().indexOf(q) >= 0);
  const cmp = {
    name: (a, b) => a.name.localeCompare(b.name, 'ru'),
    e: (a, b) => b.e - a.e,
    cost: (a, b) => b.cost - a.cost,
    size: (a, b) => b.size - a.size,
    grp: (a, b) => (a.grp || '').localeCompare(b.grp || '', 'ru') || a.name.localeCompare(b.name, 'ru'),
    fam: (a, b) => (a.fam || '').localeCompare(b.fam || '', 'ru') || a.name.localeCompare(b.name, 'ru'),
  }[s] || ((a, b) => 0);
  // Ластик всегда сверху — это инструмент, а не деталь.
  return list.sort((a, b) => (a.kind === 'erase' ? -1 : b.kind === 'erase' ? 1 : cmp(a, b)));
}
function cnPalOn(it) {
  const g = CN.dkGhost; if (!g) return false;
  return it.kind === 'erase' ? !!g.erase
    : it.kind === 'sys' ? g.sys === it.sk
    : !!(g.mod && g.mod.g === it.g && g.mod.idx === it.idx);
}
function cnDeckPalRows() {
  const box = document.getElementById('cn-deck-rows'); if (!box) return;
  const k = cnId('cn-class').value;
  const sortKey = CN.dkSort || 'fam';
  let head = '';                                     // подзаголовки-разделители при группировке
  const rows = cnDeckPalSorted(k).map(it => {
    const act = it.kind === 'erase' ? `cnDeckPalPick('erase')`
      : it.kind === 'sys' ? `cnDeckPalPick('sys','${it.sk}')`
      : `cnDeckPalPick('mod','${esc(it.g)}',${it.idx})`;
    let sep = '';
    if (sortKey === 'fam' || sortKey === 'grp') {
      const h = (sortKey === 'fam' ? it.fam : it.grp) || '';
      if (h !== head) { head = h; sep = `<div class="cn-pal-sep">${esc(h)}</div>`; }
    }
    // ⓘ — карточка детали (картинка, статы, сырьё, описание): читать подробности
    // в строке списка невозможно, но и уводить выбор в модалку больше не нужно.
    const info = it.kind === 'mod' ? `<span class="cn-pal-i" onclick="event.stopPropagation();cnPalInfo('${esc(it.g)}',${it.idx})" title="Описание">ⓘ</span>` : '';
    return sep + `<button class="cn-pal-row${cnPalOn(it) ? ' on' : ''}" style="--fc:${it.col}" onclick="${act}">`
      + `<span class="cn-pal-nm">${esc(it.name)}</span>`
      + `<span class="cn-pal-sz">${esc(it.sz)}${info}</span>`
      + `<span class="cn-pal-nt">${esc(it.note || it.grp || '')}${it.e ? ` · ${cnNum(it.e)} E` : ''}${it.cost ? ` · ${cnNum(it.cost)} ГС` : ''}</span>`
      + `</button>`;
  }).join('');
  box.innerHTML = rows || `<div class="cn-bill-none" style="padding:10px">ничего не найдено</div>`;
}
function cnDeckPalDraw() {
  const parts = cnDeckParts(); if (!parts) return;
  const opts = Object.keys(CN_PAL_SORT).map(s => `<option value="${s}"${(CN.dkSort || 'fam') === s ? ' selected' : ''}>${CN_PAL_SORT[s]}</option>`).join('');
  parts.host.classList.toggle('fold', !!CN.dkFold);
  parts.pal.innerHTML = `<div class="cn-pal-h"><span>Каталог палубы</span>`
    // на телефоне каталог — шторка снизу, значит и стрелка вертикальная
    + `<button class="cn-pal-fold" onclick="cnDeckPalFold()" title="${CN.dkFold ? 'Развернуть каталог' : 'Свернуть каталог'}">`
    + ((window.innerWidth || 9999) <= 700 ? (CN.dkFold ? '⌃' : '⌄') : (CN.dkFold ? '‹' : '›')) + `</button></div>`
    + `<div class="cn-pal-ctl">`
    + `<input id="cn-pal-q" class="cn-pal-q" placeholder="поиск…" value="${esc(CN.dkQ || '')}" oninput="cnDeckPalQ(this.value)">`
    + `<select class="cn-pal-s" onchange="cnDeckPalSort(this.value)">${opts}</select>`
    + `</div>`
    + `<div class="cn-pal-hint">Выбери инструмент и рисуй по палубе — можно протяжкой. Esc — отложить.</div>`
    + `<div id="cn-deck-rows" class="cn-pal-list"></div>`;
  cnDeckPalRows();
}
// Карточка детали из палитры — тот же разбор, что и в пикере компонентов.
function cnPalInfo(g, idx) {
  const info = cnCompInfo('module', g, idx);
  cnInfoModal(info.obj.name || 'Модуль', cnCompFullHtml(info, `cnDeckPalPick('mod','${esc(g)}',${idx});cnCloseInfo();`));
}
// Каталог сворачивается в корешок: чертёж длинный, и на узком экране список
// съедал полкорабля. Свёрнутый список не рисуется — перерисовываем и чертёж.
function cnDeckPalFold() { CN.dkFold = !CN.dkFold; cnDeckPalDraw(); cnDeckDraw(); }
function cnDeckPalQ(v) { CN.dkQ = v; cnDeckPalRows(); }
function cnDeckPalSort(v) { CN.dkSort = v; cnDeckPalRows(); }
function cnDeckPalPick(kind, a, b) {
  if (kind === 'erase') return cnDeckGhost(cnPalOn({ kind: 'erase' }) ? null : { erase: true });
  if (kind === 'sys') return cnDeckGhost(cnPalOn({ kind: 'sys', sk: a }) ? null : { sys: a });
  cnDeckGhost(cnPalOn({ kind: 'mod', g: a, idx: b }) ? null : { mod: { g: a, idx: b } });
}
// Снять то, что накрывает клетку i (модуль, узел, плиту) — работа ластика.
function cnDeckErase(i) {
  const k = cnId('cn-class').value, map = cnPlateMap(k), at = map.own[i];
  if (at < 0) return;
  const b = CN.shipLayout.bays[at]; if (!b) return;
  if (b.sys) cnSysDrop(at); else b.m = null;
  cnVehCalc();
}
// Габарит и правило посадки того, что сейчас «на кисти».
function cnGhostSpec(k) {
  const g = CN.dkGhost; if (!g) return null;
  if (g.erase) return { name: 'Ластик', col: '#e0575f', erase: true, outer: false, len: 1, w: 1, h: 1 };
  if (g.sys) {
    const S = CN_SYS[g.sys]; if (!S) return null;
    return { name: S.name, col: S.col, outer: !!S.outer, len: S.len || 1, w: S.cells[0], h: S.cells[1] };
  }
  const mo = (CN.def.db.modules[g.mod.g] || [])[g.mod.idx]; if (!mo) return null;
  return { name: mo.name || 'Модуль', col: CN_FAM_COL[cnModFam(mo)] || '#e0b457', outer: false, len: 1, w: 1, h: 1, fam: cnModFam(mo) };
}
// Куда именно встанет кисть, если ткнуть в клетку i: список клеток или null.
function cnGhostCells(map, sp, i) {
  if (!sp) return null;
  if (sp.erase) {                                    // ластик «влезает» туда, где что-то стоит
    const at = map.own[i]; if (at < 0) return null;
    const ent = map.byAt.get(at) || map.sys.find(s => s.at === at);
    return ent ? ent.cells : [i];
  }
  if (sp.outer) { const pl = cnOuterPlace(map.G, map.own, i, sp.len, -1); return pl ? pl.cells : null; }
  if (!cnPlateFits(map, i, sp.w, sp.h, -1, sp.fam)) return null;
  return cnCellsOf(map.G, i, sp.w, sp.h);
}
function cnDeckHover(i) {
  if (!CN.dkGhost) return;
  if (CN.dkPaint) { cnDeckPut(i, true); return; }     // протяжка: ведём мышью — кладём
  if (CN.dkHover === i) return;
  CN.dkHover = i; cnDeckDraw();
}
// Положить (или снять) кистью в клетку i. quiet — не ругаться при протяжке мимо.
function cnDeckPut(i, quiet) {
  const k = cnId('cn-class').value, map = cnPlateMap(k), sp = cnGhostSpec(k);
  if (!cnGhostCells(map, sp, i)) {
    if (!quiet) toast(`«${sp ? sp.name : ''}» сюда не встаёт — берите подсвеченную клетку`, 'inf');
    return;
  }
  if (sp.erase) cnDeckErase(i);
  else if (CN.dkGhost.sys) cnAssignSys(i, CN.dkGhost.sys);
  else cnAssignSlot('bay', i, CN.dkGhost.mod.g, CN.dkGhost.mod.idx);
}
// Клик по ячейке палубы: с кистью — сразу ставим, без неё — обычный пикер.
// Клик по палубе. Пустая клетка без кисти не делает НИЧЕГО — редактирование живёт
// в каталоге. Единственное исключение — орудийный узел: в нём надо выбрать орудие,
// и это клик, а не кисть (ластик по узлу по-прежнему снимает).
function cnDeckPick(i) {
  const k = cnId('cn-class').value, map = cnPlateMap(k), at = map.own[i];
  const b = at >= 0 ? CN.shipLayout.bays[at] : null, sk = b ? cnSysOf(b) : null;
  if (CN.dkGhost && CN.dkGhost.erase) { cnDeckPut(i); return; }
  if (sk && CN_SYS[sk].gun && b.mount != null) { cnOpenAssignPicker('mount', b.mount); return; }
  if (CN.dkGhost) { cnDeckPut(i); return; }
  if (at >= 0) toast('Снять — ластиком в каталоге справа', 'inf');
}function cnHullRooms(H, count) {
  const poly = cnPathPoly(H.path), top = H.nose + 6, bot = H.engine[1] - 4;
  const build = rws => {
    const res = [];
    for (let r = 0; r < rws; r++) {
      const ya = top + (bot - top) * r / rws, yb = top + (bot - top) * (r + 1) / rws;
      let band = cnClipAxis(cnClipAxis(poly, 'y', ya, true), 'y', yb, false);
      if (band.length < 3) continue;
      if (cnHullHalf(H, (ya + yb) / 2) > 40) {
        const l = cnClipAxis(band, 'x', 160, false), rr = cnClipAxis(band, 'x', 160, true);
        if (l.length >= 3) res.push(l); if (rr.length >= 3) res.push(rr);
      } else res.push(band);
    }
    return res;
  };
  let rows = Math.max(3, Math.round((bot - top) / 40)), rooms = build(rows);
  while (rooms.length < count && rows < 16) { rows++; rooms = build(rows); }
  return rooms.map(p => { let cx = 0, cy = 0; p.forEach(q => { cx += q[0]; cy += q[1]; }); return { poly: p, cx: cx / p.length, cy: cy / p.length }; });
}

// Силуэт ПОДКЛАССА: ширина корпуса по «массе» спецификации (лёгкий — узкий, тяжёлый — широкий)
function cnTypeGeo(H, cls, tIdx) {
  if (!cls.types || cls.types.length < 2) return H;
  const ms = cls.types.map(t => (t.hp || 0) + (t.armor || 0) * 2);
  const lo = Math.min(...ms), hi = Math.max(...ms), r = hi > lo ? ((ms[tIdx] || ms[0]) - lo) / (hi - lo) : 0.5;
  const wf = 0.84 + r * 0.32;
  const Hs = Object.assign({}, H);
  Hs.st = H.st.map(p => [p[0], p[1] * wf]);
  Hs.path = cnStPath(Hs.st);
  Hs.maxHW = H.maxHW * wf;
  return Hs;
}
// ДВИГАТЕЛЬ: число дюз из названия, цвет/размер по типу (ион — бирюза/тонкие, плазма — золото/шире)
function cnEngineSvg(H, engObj) {
  const e = H.engine, name = engObj ? engObj.name : '';
  const mm = name.match(/(\d+)/); let nz = mm ? Math.min(6, +mm[1]) : 1; if (nz < 1) nz = 1;
  const plasma = /плазм/i.test(name), col = plasma ? 'var(--gd)' : 'var(--te)';
  const len = Math.min(60, 20 + (engObj ? engObj.speed : 20)) * (plasma ? 1.18 : 1);
  const span = Math.min(cnHullHalf(H, e[1] - 6) * 0.72, 6 + nz * 4), w = plasma ? 6 : 4.5, op = plasma ? 0.62 : 0.5;
  let s = '';
  for (let i = 0; i < nz; i++) { const fx = nz === 1 ? 160 : 160 - span + 2 * span * i / (nz - 1); s += `<polygon points="${(fx - w).toFixed(1)},${e[1]} ${(fx + w).toFixed(1)},${e[1]} ${fx.toFixed(1)},${(e[1] + len).toFixed(1)}" fill="${col}" opacity="${op}"/>`; }
  return s;
}
function cnPolyDots(poly, spacing) {
  const pts = [];
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1], steps = Math.max(1, Math.round(Math.hypot(dx, dy) / spacing)); for (let s = 0; s < steps; s++) { const t = s / steps; pts.push([a[0] + dx * t, a[1] + dy * t]); } }
  return pts;
}
// ЩИТ — ЧИСТЫЙ энергобарьер: мягкое поле в зазоре + ОДНА аккуратная параллельная
// кромка, огибающая видимый корпус. Без штрихов-эмиттеров, точек и пунктиров (это давало
// «фуз»/шум). Цвет — по типу щита, яркость — по силе. Оболочка идёт по гладкому силуэту,
// самопересечения в глубоких выемках выброшены (барьер перекидывается через устье).
function cnShieldSvg(H, sIdx, rt, d, tex) {
  const col = sIdx === 0 ? 'var(--te)' : sIdx === 1 ? 'var(--gd)' : 'var(--t2)';
  const op = +(0.36 + 0.18 * rt).toFixed(2);
  // Барьер идёт по ТОМУ ЖЕ гранёному силуэту, что рисуется на экране (не по сглаженной
  // версии) — иначе острый нос корпуса торчал бы за скруглённым щитом. Miter 5 → нос/корма
  // получают полноценный остроконечный колпак, а не срез.
  const hull = cnConvexHull(cnHullOutlinePts(H.st, 1));
  const shellD = cnPolyPath(cnOffsetRound(hull, d));
  // ТЕКСТУРА ЩИТА (ship_shieldtex_*): энергоузор внутри купола — обрезка по оболочке,
  // экранное смешение → узор «светится», а не закрашивает корабль. Арт горизонтальный
  // (нос вправо), как и арт корпуса — контр-поворот на 90°.
  let texLayer = '';
  if (tex) {
    const ys = H.st.map(p => p[0]), y0 = Math.min(...ys) - d, y1 = Math.max(...ys) + d;
    const Ln = y1 - y0, Bm = (H.maxHW + d) * 2, cyMid = (y0 + y1) / 2;
    texLayer = `<clipPath id="cnShieldClip"><path d="${shellD}"/></clipPath>`
      + `<g clip-path="url(#cnShieldClip)" opacity="${(0.30 + 0.25 * rt).toFixed(2)}" style="mix-blend-mode:screen">`
      + `<g transform="translate(160 ${cyMid.toFixed(1)}) rotate(90)">`
      + `<image href="${esc(tex)}" xlink:href="${esc(tex)}" x="${(-Ln / 2).toFixed(1)}" y="${(-Bm / 2).toFixed(1)}" width="${Ln.toFixed(1)}" height="${Bm.toFixed(1)}" preserveAspectRatio="xMidYMid slice"/></g></g>`;
  }
  // Кромка НЕНАВЯЗЧИВАЯ (двойной жирный неон бросался в глаза): мягкое поле в зазоре,
  // широкий размытый ореол по краю и одна едва заметная тонкая линия. Внутренний контур убран.
  return `<path d="${shellD}" fill="color-mix(in srgb, ${col} 7%, transparent)" stroke="none"/>`
    + texLayer
    + `<path d="${shellD}" fill="none" stroke="${col}" stroke-width="${(4 + rt * 3).toFixed(1)}" stroke-linejoin="round" opacity="${(op * 0.22).toFixed(2)}" style="filter:blur(3px)"/>`
    + `<path d="${shellD}" fill="none" stroke="color-mix(in srgb, ${col} 55%, transparent)" stroke-width="0.7" stroke-linejoin="round" opacity="${(op * 0.75).toFixed(2)}"/>`;
}

// Живая схема корабля вид сверху — рисуется из CN.shipLayout, без картинок.
// ── ДЕКАЛЬ ЭКИПАЖА: флаг фракции + имя корабля, нанесённые краской на броню ──
// Наносится в ЛЕВЫЙ НИЖНИЙ угол пояса брони на экране (кормовой участок
// правого борта в координатах корпуса) с отступом; если пояс там узкий —
// осевой фолбэк по палубе. Кегль мелкий, зона повторяет форму пояса.
// Рисуется ДО cnHullEdgeShade и в клипе силуэта → светотень/AO корпуса ложатся
// ПОВЕРХ декали, как на настоящей окрашенной обшивке; сама краска — с тёмной
// подрезкой-канавкой (в лад с engrave-гравировкой остального оформления).
function cnShipDecal(H, k, hullOpt) {
  // Нет имени — нет декали. Никаких заглушек-плейсхолдеров на борту.
  const name = ((cnId('cn-name') || {}).value || '').trim().toUpperCase();
  if (!name) return '';
  const fac = CN.myApp || {};
  const col = fac.color || '#cfd6dd';
  // ⚠️ ГДЕ ИМЕННО ЛЕЖИТ КРАСКА (пересчитано 01.08). Раньше середина строки бралась
  // как 0.775·hw при «толщине пояса» 0.45·hw — цифры от старого корпуса, где пояс
  // занимал почти пол-борта. У нынешнего hull_gen пояс узкий: от рельса belt
  // (1 − beltW, beltW = 0.08…0.20 по классу брони) до самого борта. Декаль по
  // старым числам ложилась НА ПАЛУБУ, под орудийные узлы, и была вдвое крупнее
  // пояса. Теперь координаты берутся из ТЕХ ЖЕ рельсов, что рисуют броню.
  // ПОСАДКА: ЛЕВЫЙ НИЗ ПОЯСА БРОНИ на экране. Сцена развёрнута на 90° (нос
  // вправо, правый борт x>160 → низ экрана), значит «левый низ» в координатах
  // корпуса = кормовой участок правого борта. Текст ЛОЖИТСЯ НА КРИВУЮ (textPath
  // по средней линии пояса: кольцо силуэт hw ↔ шов палубы 0.55·hw), т.е.
  // повторяет форму брони, а не режется клипом на изломах силуэта. Кегль — от
  // фактической толщины пояса; длина при нехватке дожимается textLength.
  const sternY = H.engine[1] - 4, margin = 3;
  const hwAt = y => cnHullHalf(H, y);
  const gap = 2.5;
  // Рельсы пояса — ровно те, по которым hull_gen режет броню. У станции пояса нет:
  // там краска садится на силовое кольцо (rimIn = belt − 0.16 … борт).
  const R = (typeof HG !== 'undefined' && HG.rails) ? HG.rails(hullOpt || {}) : { belt: 0.86, beltW: 0.14 };
  const isSt = (hullOpt && hullOpt.hull) === 'station';
  const vIn = isSt ? R.belt - 0.16 : R.belt, vOut = 1;
  const vMid = (vIn + vOut) / 2, vTh = vOut - vIn;
  // Опорные точки средней линии пояса: от кормы (с отступом) к носу.
  const pts = [];
  for (let y = sternY - margin; y >= H.nose + 4; y -= 2) {
    const h = hwAt(y);
    pts.push({ y, x: 160 + h * vMid, th: h * vTh });      // th = толщина пояса в этом сечении
  }
  if (pts.length < 2) return '';
  const acc = [0];                                       // накопленная длина дуги вдоль средней линии
  for (let i = 1; i < pts.length; i++) acc[i] = acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  // Кегль ОТ КРУПНОГО к мелкому (маркировка нарочно мелкая, не плакат): для
  // каждого f ищем ближайший к корме непрерывный участок пояса, где кольцо
  // толще строки и дуги хватает на флаг+имя (до 12% дожимаем textLength).
  // Позиция важнее кегля: сперва ищем посадку, стартующую ПРЯМО у кормы
  // (дуга старта ≤ 14 ед. от якоря) — пусть мельче, но в углу; и только если
  // нигде у кормы не влезло, разрешаем зоне уезжать вдоль пояса к носу.
  let fit = null;
  for (const nearStern of [true, false]) {
    // Пояс узкий → и потолок кегля ниже, и нижняя граница мягче: на корвете со
    // стоковой бронёй кольцо всего ~2 ед., и при старом минимуме 1.5 имя просто
    // не рисовалось вовсе.
    for (let f = 2.6; f >= 1.05 && !fit; f -= 0.1) {
      const fw = f + 3, natural = name.length * f * 0.68, need = fw + gap + natural;
      for (let s = 0; s < pts.length; s++) {
        if (nearStern && acc[s] > 14) break;             // кормовой проход: дальше не уходим
        if (pts[s].th < f * 1.15) continue;              // пояс тоньше строки — скользим к носу
        let e = s;
        while (e + 1 < pts.length && pts[e + 1].th >= f * 1.15) e++;
        const avail = acc[e] - acc[s];
        if (avail >= need * 0.88) { fit = { fs: f, flagW: fw, s, e, textLen: Math.min(natural, avail - fw - gap) }; break; }
        s = e;                                           // участок короток — прыгаем за него
      }
    }
    if (fit) break;
  }
  if (!fit) return '';
  const { fs, flagW, s, e, textLen } = fit;
  // Путь строки: баз. линия смещена от середины кольца наружу на 0.36·f —
  // глифы (растут к палубе) оказываются отцентрованы по толщине пояса.
  const dPath = pts.slice(s, e + 1).map((p, i) => `${i ? 'L' : 'M'}${(p.x + fs * 0.36).toFixed(1)} ${p.y.toFixed(1)}`).join('');
  const url = fac.herald_url;
  const ini = esc(((fac.name || '?').slice(0, 2)).toUpperCase());
  // Флаг: герб фракции (приглушён под фактуру обшивки), фолбэк — инициалы в рамке цвета фракции
  const flag = url
    ? `<image href="${esc(url)}" xlink:href="${esc(url)}" x="0" y="${(-flagW / 2).toFixed(1)}" width="${flagW}" height="${flagW}" preserveAspectRatio="xMidYMid slice" opacity="0.75" style="filter:saturate(0.5) brightness(0.85) contrast(0.9)"/>`
      + `<rect x="0" y="${(-flagW / 2).toFixed(1)}" width="${flagW}" height="${flagW}" fill="none" stroke="#000" stroke-width="0.5" opacity="0.5"/>`
    : `<rect x="0" y="${(-flagW / 2).toFixed(1)}" width="${flagW}" height="${flagW}" fill="none" stroke="#cfd6dd" stroke-width="0.6" opacity="0.55"/>`
      + `<text x="${(flagW / 2).toFixed(1)}" y="${(fs * 0.32).toFixed(1)}" text-anchor="middle" style="font:700 ${(fs * 0.55).toFixed(1)}px var(--font-mono);fill:#cfd6dd" opacity="0.7">${ini}</text>`;
  // Флаг стоит в начале пути (у кормы), имя идёт по кривой пояса за ним.
  // Путь направлен корма→нос (-y) → после разворота сцены (90°) текст читается
  // слева направо, глифы «растут» к палубе — как трафарет вдоль пояса.
  // Нейтральный трафарет (#cfd6dd, как контур корпуса) — НИКАКОГО цвета фракции
  // в тексте: цветное пятно на тёмной броне выглядит наклейкой, не маркировкой.
  return `<g clip-path="url(#cnBodyClip)" opacity="0.75">`
    + `<path id="cnDecalPath_${k}" d="${dPath}" fill="none"/>`
    + `<g transform="translate(${pts[s].x.toFixed(1)} ${pts[s].y.toFixed(1)}) rotate(-90)">${flag}</g>`
    + `<text style="font:700 ${fs.toFixed(1)}px var(--font-mono);letter-spacing:0.5px;fill:#cfd6dd" opacity="0.8">`
    + `<textPath href="#cnDecalPath_${k}" xlink:href="#cnDecalPath_${k}" startOffset="${(flagW + gap).toFixed(1)}" textLength="${textLen.toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(name)}</textPath>`
    + `</text></g>`;   // ⚠️ ОДИН открытый <g> — ровно один </g>, иначе слои после декали теряют разворот сцены
}

function cnDrawShip() {
  if (!CN.def || !CN.def.cardUI) return;
  const host = cnId('cn-schematic'); if (!host) return;
  if (!CN.shipLayout) CN.shipLayout = { mounts: [], bays: [] };
  if (!CN.schemShow) CN.schemShow = { weapons: true, bays: true };
  const db = CN.def.db, k = cnId('cn-class').value, cls = db.data[k];
  const H0 = CN_SHIP_GEO[CN_KV_HULL[k] || k] || CN_SHIP_GEO.corvette;
  const tIdx = +(cnId('cn-type') || {}).value || 0;
  const H = cnTypeGeo(H0, cls, tIdx);     // силуэт зависит от подкласса (ширина по «массе»)
  CN.shipGeo = H;                          // храним актуальную геометрию для drag-обработчика узлов
  const armorObj = db.armors[k][+cnId('cn-armor').value || 0];
  const shieldObj = db.shields[k][+cnId('cn-shield').value || 0];
  const engObj = db.engines[k][+cnId('cn-engine').value || 0];
  const reactObj = db.reactors && db.reactors[k] ? db.reactors[k][+(cnId('cn-reactor') || {}).value || 0] : null;
  const e = H.engine, P = [], L = CN.shipLayout;
  const tipY = Math.min(...cnPathPoly(H.path).map(p => p[1]));
  const midY = (H.nose + e[1]) / 2;

  // ЩИТ — три стиля барьера по типу; отступ оболочки ПОСТОЯННЫЙ (px), плотность по силе
  let shieldD = 0, shieldPad = 0;
  if (shieldObj && shieldObj.shield > 0) {
    const sIdx = +cnId('cn-shield').value || 0;
    const maxSh = Math.max(...db.shields[k].map(x => x.shield)) || 1, rt = Math.min(1, shieldObj.shield / maxSh);
    shieldD = 9 + 7 * rt;                 // постоянный стоячий зазор корпус↔барьер
    shieldPad = shieldD * 2 + 6;          // запас на miter у острых носа/кормы
    // Текстур больше нет — барьер целиком векторный (поле + кромка).
    P.push(`<g class="cn-shieldfx">${cnShieldSvg(H, sIdx, rt, shieldD, null)}</g>`);
  }

  // ДВИГАТЕЛЬ — число дюз и тип (ион/плазма) из выбранного двигателя + живой факел.
  // У наземки (пехота/БТР/танки/арта) дюз нет — ходовая, факел не рисуем.
  const groundCls = CN.cat === 'army' && cnKvRealCat(k) === 'ground';
  const engPlasma = /плазм/i.test(engObj ? engObj.name : '');
  const flameLen = groundCls ? 0 : Math.min(60, 20 + (engObj ? engObj.speed : 20)) * (engPlasma ? 1.18 : 1);
  if (!groundCls) {
    const engGlowCol = engPlasma ? 'var(--gd)' : 'var(--te)';
    P.push(`<g class="cn-flame"><ellipse cx="160" cy="${e[1]}" rx="${Math.min(cnHullHalf(H, e[1] - 6) * 0.8, 30).toFixed(1)}" ry="6" fill="${engGlowCol}" opacity="0.16"/>${cnEngineSvg(H, engObj)}</g>`);
  }

  // КОРПУС — ЧИСТАЯ ВЕКТОРНАЯ ГЕОМЕТРИЯ (hull_gen.js). Растровых текстур больше нет:
  // обшивка, бронепояс, надстройка и машинный отсек рисуются процедурно — тем же
  // подходом, что в оружейной верфи. Тон металла — от РЕЦЕПТА брони, крупность
  // плит и толщина пояса — от её класса.
  const maxAr = Math.max(...db.armors[k].map(a => a.armor)) || 1, aRt = (armorObj ? armorObj.armor : 0) / maxAr;
  const hullOpt = cnHullOpt(H, k, tIdx, armorObj, engObj, aRt, groundCls);
  const hullPath = HG.hullPathOf(H, 1);
  P.push(`<clipPath id="cnBodyClip"><path d="${hullPath}"/></clipPath>`);
  // ПАДАЮЩАЯ ТЕНЬ корабля на чертёжное полотно — «отрывает» корпус от фона.
  P.push(`<path d="${hullPath}" fill="#000" opacity="0.38" style="filter:blur(9px)"/>`);
  P.push(HG.body(H, hullOpt));                           // обшивка + пояс + надстройка + дюзы
  P.push(cnShipDecal(H, k, hullOpt));                    // декаль (флаг+имя) ПОД светотенью
  P.push(HG.shade(H, hullOpt));                          // боковой свет, AO, контактная тень
  P.push(HG.edge(H, hullOpt));                           // кант силуэта

  // ── Расчёт посадочных мест ЗАРАНЕЕ: узлы орудий, отсеки — чтобы связать их магистралями ──
  const bayN = L.bays.length;
  const maxMounts = Math.max(16, L.mounts.length);
  const wpnMounts = cnMountPositions(H, maxMounts);
  const mPos = i => { const s2 = L.mounts[i]; return (s2 && s2.pos) ? [s2.pos.x, s2.pos.y] : wpnMounts[i]; };
  // Модули на корпусе БОЛЬШЕ НЕ РИСУЕМ: их место — разрез палубы (cnDrawPlate),
  // где видно, кто сколько клеток занимает. Здесь корпус и орудия.
  cnBaysFit(k);

  // ОТСЕКИ/МОДУЛИ: лёгкие кликабельные ячейки. Занятый модуль — заливка + значок;
  // пустой активный — тонкий пунктир; свободное место — почти прозрачно (не спорит с телом).
  // Без коридора/люков/переборок — только то, что несёт смысл (где стоит модуль).
  const plate = cnPlateMap(k), modCount = plate.mods.length, bayCap = plate.w * plate.h;
  // АНГАРЫ — чёрточки-выходы на броне (их может быть много); авиа = метка наружу
  const hangars = [];
  document.querySelectorAll('#cn-hangars .cn-hangar').forEach(hp => { hangars.push({ id: +hp.querySelector('.cn-h-type').value, units: [...hp.querySelectorAll('.cn-u-type')].map(u => +u.value) }); });
  const hRows = Math.ceil(hangars.length / 2) || 1;
  hangars.forEach((h, i) => {
    const side = i % 2 === 0 ? -1 : 1, t = (Math.floor(i / 2) + 0.5) / hRows;
    const y = Math.round(H.nose + (e[1] - H.nose) * (0.18 + 0.64 * t)), hw = cnHullHalf(H, y), edge = 160 + side * hw, has = h.units.length > 0;
    P.push(`<g class="cn-bay"><title>Ангар: ${esc((db.hangarTypes.find(x => x.id == h.id) || {}).name || '')}${has ? ' · авиагрупп: ' + h.units.length : ''}</title><line x1="${(edge - side * 4).toFixed(1)}" y1="${y}" x2="${(edge + side * 7).toFixed(1)}" y2="${y}" stroke="var(--te)" stroke-width="${has ? 2.6 : 1.6}" opacity="0.92"/>${has ? `<polygon points="${(edge + side * 10).toFixed(1)},${y - 3} ${(edge + side * 16).toFixed(1)},${y} ${(edge + side * 10).toFixed(1)},${y + 3}" fill="var(--te)" opacity="0.85"/>` : ''}</g>`);
  });

  // УЗЛЫ ОРУДИЙ (борта), кликабельны.
  // ВАЖНО: активные узлы (орудия/пустые) собираем отдельно от «свободных мест» и рисуем ПОВЕРХ них.
  // Иначе свободное место (более высокий индекс → позже в DOM) накрывало перетащенное орудие,
  // перехватывало клик («свободное место») и плодило дубли вместо перемещения.
  let wpnCount = 0;
  if (CN.schemShow.weapons) {
    // Эффективные позиции всех активных узлов — чтобы не рисовать свободное место поверх них.
    const actP = L.mounts.map((s, j) => (s && s.pos) ? [s.pos.x, s.pos.y] : (wpnMounts[j] || [160, H.nose]));
    const freeMk = [], nodeMk = [];
    wpnMounts.forEach((m, i) => {
    const slot = L.mounts[i], active = i < L.mounts.length;
    const w = active && slot && slot.w && db.weapons[slot.w.g] && db.weapons[slot.w.g][slot.w.idx] ? slot.w : null;
    // активный узел можно таскать → используем его сохранённую позицию (slot.pos), иначе авто-место
    const p = (active && slot && slot.pos) ? [slot.pos.x, slot.pos.y] : m;
    if (w) {
      wpnCount++; const item = db.weapons[w.g][w.idx], vis = cnWpnVisual(w.g, item);
      // разворот арта турели: от борта наружу, с центра — вперёд. Чистая
      // косметика — на бой положение узла не влияет (секторов обстрела нет).
      const dir = p[0] < 155 ? 180 : p[0] > 165 ? 0 : -90;
      // Если для орудия загружена картинка — ставим её в узел (круглый «барбет»),
      // иначе рисуем векторную башню. Полотно повёрнуто на 90° → арт контр-вращаем.
      const wImg = cnImgPath(CN.cat, 'weapon', cnGroupSlug(CN.cat, 'weapon', w.g), w.idx);
      let art;
      const tg = cnWeaponTurretArt(item, wImg);
      if (tg) {
        const parts = cnTurretArtParts(tg.cfg);
        if (parts && parts.half > 0) {
          // Радиус узла на схеме = размер орудия: от 3 (пулемёт) до 15 (предельное
          // супероружие). Раньше разброс был 4.0…4.9 — размер класса не читался.
          const sc = (3 + 12 * tg.wt) / parts.half;
          art = `<g transform="translate(${p[0]} ${p[1]}) rotate(${dir}) scale(${sc.toFixed(3)})" style="filter:drop-shadow(0 0 2.5px rgba(0,0,0,0.75)) brightness(0.9)">${parts.inner}</g>`;
        }
      }
      if (!art && cnWpnImgReady(wImg)) {
        // Арт турели ЦЕЛИКОМ (вид сверху, стволы = +x), в натуральном аспекте — без обрезки
        // по кругу. Центр вращения на узле, стволы направлены по азимуту dir (как у векторной
        // башни). Аспект берём натуральный (кэш CN.imgAR) → meet заполняет бокс без искажений.
        const ar = (CN.imgAR && CN.imgAR[wImg]) || 2.3;
        const L = 11 + 9 * vis.wt, Wd = L / ar;
        // Свет как у корпуса: контактная тень под турелью (сажает на палубу) + лёгкое
        // затемнение, чтобы арт не «светился» ярче обшивки.
        art = `<g transform="translate(${p[0]} ${p[1]}) rotate(${dir})" style="filter:drop-shadow(0 0 2.5px rgba(0,0,0,0.75)) brightness(0.9)">`
            + `<image href="${esc(wImg)}" xlink:href="${esc(wImg)}" x="${(-L * 0.40).toFixed(1)}" y="${(-Wd / 2).toFixed(1)}" width="${L.toFixed(1)}" height="${Wd.toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`
            + `</g>`;
      }
      if (!art) art = `<g style="filter:drop-shadow(0 0 2.5px rgba(0,0,0,0.75))">${cnTurretSvg(p, vis, dir)}</g>`;
      // Прозрачная зона захвата — ПОВЕРХ арта (последним): арт с drop-shadow хиттестится только
      // по непрозрачным пикселям, из-за чего центр турели «проваливался». Круг сверху ловит клик
      // по всей области, включая центр.
      const hitR = (tg ? (5 + 11 * tg.wt) : (10 + 5 * vis.wt)).toFixed(1);
      nodeMk.push(`<g class="cn-node" style="cursor:grab" onpointerdown="cnMountPointerDown(event,${i})"><title>${esc(item.name)} · тащи, чтобы переместить · клик — настроить</title>${art}<circle cx="${p[0]}" cy="${p[1]}" r="${hitR}" fill="transparent"/></g>`);
    }
    else if (active) {
      nodeMk.push(`<g class="cn-node" style="cursor:grab" onpointerdown="cnMountPointerDown(event,${i})"><title>Пустой узел — тащи, чтобы переместить · клик — поставить орудие или удалить</title><circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="var(--b2)" stroke="var(--t3)" stroke-width="1.2" stroke-dasharray="2 2" opacity="0.9"/></g>`);
    }
    else {
      // свободное место рисуем ТОЛЬКО если оно не накрывает уже стоящий узел (иначе перехват клика/дубли)
      if (actP.some(q => Math.hypot(q[0] - m[0], q[1] - m[1]) < 14)) return;
      freeMk.push(`<g class="cn-node" style="cursor:pointer" onclick="cnMountAddAt(${i})"><title>Свободное место — нажми, чтобы добавить узел орудия</title><circle cx="${m[0]}" cy="${m[1]}" r="8" fill="transparent"/><circle cx="${m[0]}" cy="${m[1]}" r="2.6" fill="none" stroke="var(--w2)" stroke-width="0.8" opacity="0.3"/></g>`);
    }
    });
    P.push(freeMk.join(''));   // свободные места — подложкой
    P.push(nodeMk.join(''));   // орудия/пустые узлы — ПОВЕРХ свободных мест
  }

  // ── СБОРКА ПОЛОТНА ──────────────────────────────────────────
  // Фиксированная сцена 960×470: шрифты и толщины всегда одного размера,
  // корабль вписывается масштабом (учёт щита, факела и подписей), поля минимальные.
  // Сцена стала выше и корабль крупнее → используем всю ширину панели.
  const topEdge = Math.min(tipY - 10, tipY - shieldPad - 2);
  const botEdge = Math.max(e[1] + flameLen + 6, e[1] + shieldPad + 2);
  const halfW = H.maxHW + shieldD + 6;
  const shipLen = botEdge - topEdge;
  // На телефоне разворачиваем корпус ВЕРТИКАЛЬНО носом вниз (портретная сцена) — так корабль
  // крупнее и занимает высоту экрана, а не жмётся в узкую горизонтальную полоску.
  const mob = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse), (max-width: 640px)').matches;
  // Пехотинец — фигура, а не корпус: рисуем СТОЯ (вертикально, головой вверх)
  // и на десктопе, и на телефоне.
  const stand = CN.cat === 'army' && k === 'peh';
  let VW, VH, CY, sc, ox = 0, gT, SX, axis;
  if (stand) {
    VW = mob ? 470 : 960; VH = mob ? 900 : 470; CY = VW / 2;
    sc = Math.min((VH - 56) / shipLen, (VW - 40) / (halfW * 2));
    gT = `translate(${(VW / 2 - 160 * sc).toFixed(2)},${(28 - topEdge * sc).toFixed(2)}) scale(${sc.toFixed(4)})`;
    SX = () => VW / 2;
    axis = `<line x1="${(VW / 2).toFixed(1)}" y1="20" x2="${(VW / 2).toFixed(1)}" y2="${VH - 20}" stroke="var(--w1)" stroke-width="0.8" stroke-dasharray="2 9" opacity="0.5"/>`;
  } else if (mob) {
    VW = 470; VH = 900; CY = VW / 2;
    sc = Math.min((VH - 56) / shipLen, (VW - 28) / (halfW * 2));
    const midShip = (topEdge + botEdge) / 2;
    gT = `translate(${(VW / 2).toFixed(2)},${(VH / 2).toFixed(2)}) scale(${sc.toFixed(4)}) rotate(180) translate(${(-160).toFixed(2)},${(-midShip).toFixed(2)})`;
    SX = () => VW / 2;                                 // выноски на портрете отключены — заглушка
    axis = `<line x1="${CY}" y1="20" x2="${CY}" y2="${VH - 20}" stroke="var(--w1)" stroke-width="0.8" stroke-dasharray="2 9" opacity="0.5"/>`;
  } else {
    VW = 960; VH = 470; CY = 244;
    sc = Math.min(944 / shipLen, 408 / (halfW * 2));
    ox = (VW - shipLen * sc) / 2;
    gT = `translate(${(ox + botEdge * sc).toFixed(2)},${(CY - 160 * sc).toFixed(2)}) scale(${sc.toFixed(4)}) rotate(90)`;
    SX = hy => ox + (botEdge - hy) * sc;               // координата вдоль корпуса → экранный X
    axis = `<line x1="20" y1="${CY}" x2="${VW - 20}" y2="${CY}" stroke="var(--w1)" stroke-width="0.8" stroke-dasharray="2 9" opacity="0.5"/>`;
  }

  // Выноски-подписи (РЕАКТОР/МОСТИК/ДЮЗЫ с линиями-указателями) убраны в июле 2026:
  // пользователь считает их интерфейсным шумом. Штампы внизу (класс/комплектация) остаются.
  const anns = '';

  // Чертёжная подложка: сетка, осевая, уголки; штампы — класс слева, комплектация справа
  const tName = cls.types && cls.types[tIdx] ? cls.types[tIdx].name : '';
  const capTx = `ОРУДИЯ ${wpnCount}/${L.mounts.length} · ОТСЕКИ ${modCount}/${bayCap}` + (hangars.length ? ` · АНГАРЫ ${hangars.length}` : '');
  const cnCb = (x, y, dx, dy) => `<path d="M${x + dx * 14},${y} L${x},${y} L${x},${y + dy * 14}" fill="none" stroke="var(--te)" stroke-width="1.4" opacity="0.6"/>`;
  // ЗУМ: сцена остаётся 0 0 VW VH, а показываем её КУСОК через viewBox — толщины линий
  // и кегль растут вместе с кораблём (это чертёж, а не «увеличенная картинка»).
  const V = cnViewRect(VW, VH), vb = `${V.x.toFixed(2)} ${V.y.toFixed(2)} ${V.w.toFixed(2)} ${V.h.toFixed(2)}`;
  // Сетка живёт в координатах СЦЕНЫ (приближаешься — клетка крупнее, как на кальке),
  // а рамка со штампами приколота к видимой области и кегля не меняет.
  const frameT = `translate(${V.x.toFixed(2)},${V.y.toFixed(2)}) scale(${(1 / V.z).toFixed(4)})`;
  const deco = `<defs><pattern id="cnGrid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0v30" fill="none" stroke="var(--w1)" stroke-width="0.6"/></pattern></defs>`
    + `<rect x="${(-VW).toFixed(0)}" y="${(-VH).toFixed(0)}" width="${VW * 3}" height="${VH * 3}" fill="url(#cnGrid)" opacity="0.35"/>`
    + axis
    + `<g id="cn-schem-frame" transform="${frameT}">`
    + cnCb(14, 12, 1, 1) + cnCb(VW - 14, 12, -1, 1) + cnCb(14, VH - 12, 1, -1) + cnCb(VW - 14, VH - 12, -1, -1)
    + `<text x="30" y="${VH - 16}" style="font:700 12px var(--font-mono);letter-spacing:2.5px;fill:var(--t4)">${esc(k.toUpperCase())} // ${esc(cls.name.toUpperCase())}${tName ? ' · ' + esc(tName.toUpperCase()) : ''}</text>`
    + `<text x="${VW - 30}" y="${VH - 16}" text-anchor="end" style="font:600 11px var(--font-mono);letter-spacing:1.5px;fill:var(--te)">${capTx}</text>`
    + `</g>`;
  host.innerHTML = `<svg viewBox="${vb}" class="cn-schem-svg" role="img" aria-label="Схема корабля вид сверху (горизонтально)">${deco}<g id="cn-schem-g" transform="${gT}">${P.join('')}</g><g class="cn-schem-ann">${anns}</g></svg>`;
  cnViewBind(host);
  cnViewHud();
  // Перехватываем касание в фазе ПЕРЕХВАТА (до onclick узлов/пустых мест), чтобы в режиме
  // постановки тап переносил выбранный узел, а не добавлял новые. Вешаем один раз на контейнер.
  if (!host._placeBound) { host.addEventListener('click', cnPlaceTapHandler, true); host._placeBound = true; }
  const wrap = host.closest('.cn-schem-wrap'); if (wrap) wrap.classList.toggle('cn-placing', CN.placing != null);

  // Мобильный список слотов: SVG-узлы (r≈4.5px) на телефоне почти неподжимаемы —
  // дублируем их крупными тач-строками (CSS показывает список только на coarse-указателе).
  const listHost = cnId('cn-schem-list');
  if (listHost) {
    const rows = [];
    if (CN.schemShow.weapons) L.mounts.forEach((slot, i) => {
      const w = slot && slot.w, item = w ? ((db.weapons[w.g] || [])[w.idx] || null) : null;
      rows.push(cnSlotRow('mount', i, '◎', 'Узел орудия ' + (i + 1), item ? esc(item.name) : 'Пусто — поставить орудие', !!item));
    });
    listHost.innerHTML = rows.length ? rows.join('') : `<div class="cn-bill-none" style="padding:8px 2px">Нет орудийных узлов — добавьте кнопкой «＋ Узел» на схеме.</div>`;
  }
  if (CN.deck) cnDeckDraw();
  cnRenderBatteries();
}

// ── Ручное размещение: добавить узел/отсек, назначить/убрать содержимое, скрыть слой ──
// ПРЕДЕЛ ОТСЕКОВ: cls.modul — сколько модулей несёт класс (корвет 3 … факельщик/станция 10).
// Оружейные узлы предела не имеют — их держит энергосеть и экипаж.
function cnModCls(k) { return CN.def && CN.def.db && CN.def.db.data[k || (cnId('cn-class') || {}).value] || null; }
function cnModSlotCap(k) {
  const cls = cnModCls(k), n = cls ? +cls.modul : NaN;
  return Number.isFinite(n) ? n : 16;            // класс вне каталога — плата 4×4 по умолчанию
}
// ── СЕТКА ПАЛУБЫ ПО СИЛУЭТУ КОРПУСА ────────────────────────────────────────────
// Сетка не «плата в центре», а покрывает ВЕСЬ корабль: клетка доступна там, где
// под ней есть корпус. Отсюда естественный лимит — большой корабль несёт больше
// модулей, потому что в него физически больше влезает, а не потому что так в таблице.
// ⚠️ КЛЕТКА ОДНА И ТА ЖЕ ДЛЯ ВСЕХ КОРПУСОВ. Раньше сторона считалась от ширины
// корпуса (maxHW*2/6) — то есть у каждого класса своя «линейка»: узкий корвет
// получал мелкую клетку и потому больше всех точек на палубе, а широкий линкор —
// крупную и всего пару рядов. Теперь метр — метр везде: сколько клеток у класса,
// решает только его силуэт. Корвет ≈6 клеток, эсминец ≈8, крейсер ≈14,
// линкор ≈32, дредноут ≈40, станция ≈46.
// ⚠️ РЕШЁТКА ОДНА НА ВСЕ КОРПУСА — как в Cosmoteer: мелкая квадратная клетка
// одного размера, корабль лежит НА ней. Раньше сторона клетки считалась от ширины
// корпуса, то есть у каждого класса была своя линейка: узкий корвет получал
// мелкую клетку и потому БОЛЬШЕ всех точек, а линкор — крупную и всего пару рядов.
// Теперь метр — метр везде, и число клеток честно растёт с размером корпуса:
// корвет 136, эсминец 178, крейсер 251, дредноут 655, станция 756.
// ⚠️ Клетка МЕЛКАЯ намеренно, и на палубе теперь живут ТРИ вида ячеек сразу —
// модули, броневые плиты и орудийные узлы. Место должно быть под все три, иначе
// это не размен, а тупик: при клетке 14+ корвет выходил в два ряда, и раскладки
// на нём не существовало вовсе.
const CN_DECK_CELL = 7;
function cnDeckGeo(k) {
  k = k || (cnId('cn-class') || {}).value;
  if (CN._dg && CN._dg.k === k) return CN._dg;
  const H0 = CN_SHIP_GEO[CN_KV_HULL[k] || k] || CN_SHIP_GEO.corvette;
  const poly = cnPathPoly(HG.hullPathOf(H0, 1));
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  poly.forEach(pt => { x1 = Math.min(x1, pt[0]); y1 = Math.min(y1, pt[1]); x2 = Math.max(x2, pt[0]); y2 = Math.max(y2, pt[1]); });
  const C = CN_DECK_CELL;
  const w = Math.max(1, Math.ceil((x2 - x1) / C)), h = Math.max(1, Math.ceil((y2 - y1) / C));
  const ox = x1 - ((w * C) - (x2 - x1)) / 2, oy = y1 - ((h * C) - (y2 - y1)) / 2;
  const inside = new Array(w * h).fill(false);
  let n = 0;
  for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) {
    // клетка палубы, если корпус накрывает её середину и обе трети по длине
    const cx = ox + gx * C + C / 2;
    const ok = cnPtInPoly([cx, oy + gy * C + C * 0.5], poly)
      && cnPtInPoly([cx, oy + gy * C + C * 0.35], poly)
      && cnPtInPoly([cx, oy + gy * C + C * 0.65], poly);
    if (ok) { inside[gy * w + gx] = true; n++; }
  }
  // ⚠️ СИММЕТРИЯ. Корпус зеркален вокруг оси, но решётка ложится на него со своим
  // шагом: у оси клетка может попасть в обвод с одного борта и промахнуться с другого
  // — вылезал одиночный «зуб», ломающий вид. Оставляем клетку только если её зеркало
  // тоже внутри (AND, а не OR: дорисовывать за обшивку нельзя).
  const A = (x1 + x2) / 2, KM = Math.round((2 * A - 2 * ox - C) / C);
  n = 0;
  for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) {
    const i = gy * w + gx; if (!inside[i]) continue;
    const mx = KM - gx;
    if (mx < 0 || mx >= w || !inside[gy * w + mx]) inside[i] = false;
  }
  for (let i = 0; i < inside.length; i++) if (inside[i]) n++;
  const G = { k, w, h, C, CX: C, CY: C, ox, oy, inside, n, poly, H: H0 };
  cnDeckZones(G);
  return (CN._dg = G);
}
// ── ОТСЕКИ КОРПУСА: где на палубе вообще можно стоять ───────────────────────────
// Палуба перестала быть одной сплошной плитой «ставь что хочешь от носа до кормы».
// У каждой клетки два признака, и оба — из геометрии, а не из таблицы:
//   band — нос (передние 30% длины), мидель, корма (задние 28%);
//   side — «борт» (клетка граничит с обшивкой) или «ядро» (со всех сторон палуба).
// Узкие корпуса (корвет, эсминец) целиком борт — ядра у них нет, и это правда:
// внутрь корвета глубокий трюм не спрячешь.
function cnDeckZones(G) {
  const band = new Array(G.w * G.h).fill(''), skin = new Array(G.w * G.h).fill(false);
  let y1 = Infinity, y2 = -Infinity;
  for (let i = 0; i < band.length; i++) if (G.inside[i]) { const gy = (i / G.w) | 0; y1 = Math.min(y1, gy); y2 = Math.max(y2, gy); }
  const span = Math.max(1, y2 - y1);
  for (let gy = 0; gy < G.h; gy++) for (let gx = 0; gx < G.w; gx++) {
    const i = gy * G.w + gx; if (!G.inside[i]) continue;
    const t = (gy - y1) / span;
    band[i] = t < 0.30 ? 'bow' : t > 0.72 ? 'stern' : 'mid';
    skin[i] = [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]]
      .some(([nx, ny]) => nx < 0 || ny < 0 || nx >= G.w || ny >= G.h || !G.inside[ny * G.w + nx]);
  }
  G.band = band; G.skin = skin;
  // ВНЕШНИЙ ПОЯС: клетки ЗА обшивкой, примыкающие к корпусу. Броня вешается сюда —
  // она навесная, а не съедает палубу под модули.
  const outer = new Array(G.w * G.h).fill(false);
  for (let gy = 0; gy < G.h; gy++) for (let gx = 0; gx < G.w; gx++) {
    const i = gy * G.w + gx; if (G.inside[i]) continue;
    outer[i] = [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]]
      .some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < G.w && ny < G.h && G.inside[ny * G.w + nx]);
  }
  G.outer = outer;
  return G;
}
const CN_BAND_RU = { bow: 'нос', mid: 'мидель', stern: 'корма' };
// Куда что ставится. band — допустимые секции, side: 'skin' — модулю нужен выход
// на обшивку (хотя бы одна клетка на борту), 'core' — наоборот, только вглубь.
const CN_ZONE_RULE = {
  sensor:    { band: ['bow', 'mid'], side: 'skin', why: 'антенне нужен борт и чистый сектор по курсу' },
  jam:       { band: ['bow', 'mid', 'stern'], side: 'skin', why: 'излучателю нужен вынос за обшивку' },
  dejam:     { band: ['bow', 'mid', 'stern'], side: 'skin', why: 'приёмник ставят на борт' },
  pd:        { band: ['bow', 'mid', 'stern'], side: 'skin', why: 'турелям ближнего рубежа нужен сектор обстрела' },
  stealth:   { band: ['bow', 'mid', 'stern'], side: 'skin', why: 'покрытие работает только по обшивке' },
  hangar:    { band: ['mid', 'stern'], side: 'core', why: 'палубе разгона нужна длина и защита корпуса' },
  ftl:       { band: ['mid'], side: 'core', why: 'привод сажают в центр масс' },
  stabil:    { band: ['mid', 'stern'], side: 'core', why: 'гиростабилизатор держат у оси' },
  interdict: { band: ['stern'], side: null, why: 'проекторы интердикции смотрят назад' },
  hull:      { band: ['bow', 'mid', 'stern'], side: null, why: '' },
};
// Проходит ли модуль семьи fam в клетки cells. Возвращает '' (годно) или причину.
function cnZoneCheck(G, fam, cells) {
  const R = CN_ZONE_RULE[fam] || CN_ZONE_RULE.hull;
  const bad = cells.filter(c => R.band.indexOf(G.band[c]) < 0);
  if (bad.length) return `только ${R.band.map(b => CN_BAND_RU[b]).join('/')} — ${R.why}`;
  if (R.side === 'skin' && !cells.some(c => G.skin[c])) return `нужен выход на борт — ${R.why}`;
  if (R.side === 'core' && cells.some(c => G.skin[c])) return `только вглубь корпуса, не по борту — ${R.why}`;
  return '';
}
// Клетки, которые займёт модуль габарита fw×fh с якорем i (без проверки занятости).
function cnCellsOf(G, i, fw, fh) {
  const out = [], x0 = i % G.w, y0 = (i / G.w) | 0;
  for (let y = y0; y < y0 + fh; y++) for (let x = x0; x < x0 + fw; x++) {
    if (x >= G.w || y >= G.h) return out;
    out.push(y * G.w + x);
  }
  return out;
}
function cnModGridDims(k) { const g = cnDeckGeo(k); return [g.w, g.h]; }
// ── МОДУЛЬНАЯ ПЛАТА: эффективность модуля зависит от его СОСЕДЕЙ ────────────────
// Голое число модулей больше ничего не решает: 20 разнородных коробок дают
// полудохлый эффект каждая, а четыре однородные, сложенные квадратом, — сверхнорму.
//   семья    — что модуль вообще делает (ключ combat: jam / pd / stealth / …).
//              Всё нефункциональное (склад, десант, экипаж) — семья 'hull', она в
//              расчёт не идёт: грузовой отсек ничего не разбавляет и ничего не усиливает.
//   смежность— каждый соседний по грани модуль ТОЙ ЖЕ семьи: +22% обоим.
//   блок     — у модуля два и больше однородных соседей: ещё +15% («контур замкнут»).
//   разбавление — на борту F разных семей: всё делится на (1 + 0.18·(F−1)).
// Итог зажат в [0.25, 2.2] — ни бесполезной трухи, ни бесконечного стакинга.
const CN_PLATE = { adj: 0.22, sq: 1.15, dil: 0.18, lo: 0.25, hi: 2.2 };
// ── ФАКТОРИ ИЗ МОДУЛЕЙ: коробка сама по себе мертва ────────────────────────────
// Модуль — не самостоятельный стат-стик, а потребитель в СЕТИ. Чтобы он работал,
// его надо ЗАПИТАТЬ: от реакторного отсека тянется шина, и модуль оживает только
// если хоть одна его клетка граничит со шиной, связной с реактором. Отсюда весь
// смысл вкладываться: место на палубе уходит не только под сами коробки, но и
// под трассу к ним, а усилители дают множитель тем, до кого дотянулись.
// ⚠️ ПИТАНИЕ ИДЁТ ПО ЖЕЛЕЗУ, А НЕ ТОЛЬКО ПО ШИНЕ. Первая версия требовала, чтобы
// каждая коробка касалась специальной шины, — и модуль, стоящий в ряду с десятком
// других, оказывался «не запитан» без единой подсказки, чем это лечить. Правило
// теперь одно и видимое глазом: всё, что связано с реактором цепочкой
// СОПРИКАСАЮЩИХСЯ блоков (модули проводят питание сами), — под током.
//   bus    — 1×1 перемычка: нужна только чтобы перекинуть питание через пустоту.
//   beacon — 2×2 усилитель: боевого стата нет, зато поднимает отдачу всех модулей
//            в радиусе; второй и третий усилитель на том же модуле слабее.
// Палуба держит не только модули: броневая плита и орудийный узел занимают на ней
// такое же место. Отсюда честный размен — лишняя плита брони или ещё одна пушка
// съедают клетки, в которые уже не встанет контур модуля.
// ⚠️ У ОРУДИЙНОГО УЗЛА ТРИ ТИПОРАЗМЕРА, а не один. Один узел 2×2 означал, что
// место под пушку стоит одинаково — и лёгкая турель, и главный калибр. Теперь
// размер узла и есть калибр: в лёгкий узел тяжёлое орудие не встанет (см.
// cnGunCaps — порог берётся по массе орудий, доступных этому классу).
// Узел ставится в ЛЮБУЮ клетку палубы: борт больше не обязателен — башня
// поднимается над корпусом, а не торчит из обшивки.
// ⚠️ БРОНЯ — НАВЕСНАЯ ЛЕНТА ВО ВНЕШНЕМ ПОЯСЕ, и её тоже три вида. Пояс за
// обшивкой ОДНУ клетку толщиной, поэтому «большая ячейка» здесь — не квадрат
// (он бы никуда не влез), а отрезок ВДОЛЬ борта: len клеток подряд, ориентацию
// ищем сами (см. cnOuterPlace).
//   coat   — покрытие: 1 клетка, дёшево, мало HP;
//   armor  — броневой пояс: 2 клетки, основная защита;
//   screen — разнесённый экран: 3 клетки, больше всех HP, но и тяжелее всех.
// ⚠️ У КАЖДОГО УЗЛА ЕСТЬ ЦЕНА, ЭНЕРГИЯ И МАССА, и они СПИСЫВАЮТСЯ. Первая версия
// брала цену только из каталожной детали — а у KV-орудий и брони своего сырья
// может не быть вовсе, и палуба выходила бесплатной: ставь сколько влезет.
// Теперь железо самого узла (башня, погон, привод, плита) стоит своих ГС, ест
// энергию и съедает грузоподъёмность — см. cnDeckLoadout.
// ⚠️ mass — В ЕДИНИЦАХ НАГРУЗКИ (как capacityPenalty орудий: 5000 кг = 10), а НЕ в
// килограммах. С килограммами один лёгкий узел выжирал весь трюм корвета и ловил
// «превышена грузоподъёмность» на пустой палубе.
const CN_SYS = {
  beacon: { name: 'Усилитель контура', cells: [4, 4], col: '#e0b457', energy: 900, gs: 1200, mass: 3 },
  gun_s:  { name: 'Узел лёгкий',       cells: [1, 1], col: '#e0575f', energy: 30,  gs: 200,  mass: 1,  gun: 's' },
  gun_m:  { name: 'Узел средний',      cells: [2, 2], col: '#e0575f', energy: 90,  gs: 700,  mass: 3,  gun: 'm' },
  gun_l:  { name: 'Узел тяжёлый',      cells: [3, 3], col: '#e0575f', energy: 220, gs: 2000, mass: 9,  gun: 'l' },
  coat:   { name: 'Покрытие',          cells: [1, 1], col: '#7fd4ff', energy: 0,   gs: 120,  mass: 1, outer: true, len: 1, hp: 0.5 },
  // ⚠️ Навесная защита ЭНЕРГИЮ НЕ ЕСТ: это железо, а не поле. «Экран» — разнесённый
  // противокумулятивный лист по мотивам бронетехники, а не энергетический дефлектор.
  // Цена целиком в массе и ГС (раньше пояс жрал 40 E, экран 260 E — это был неверный
  // прочит слова «экран»; отдача перенесена в нагрузку).
  armor:  { name: 'Броневой пояс',     cells: [2, 1], col: '#9fb3c8', energy: 0, gs: 400,  mass: 6,  outer: true, len: 2, hp: 1.0 },
  screen: { name: 'Разнесённый экран', cells: [3, 1], col: '#79c0ff', energy: 0, gs: 1300, mass: 13, outer: true, len: 3, hp: 1.5 },
};
// Итог по всему, что стоит на палубе из «разводки»: ГС, энергия, масса, прибавка HP.
// ⚠️ Один проход по bays — считать это в трёх местах врозь уже пробовали, разъезжается.
// ⚠️ СЧИТАЕМ ТОЛЬКО ВСТАВШЕЕ. Раньше проход шёл по сырому bays: узел, которому на
// палубе места не нашлось (в plateMap он попадает в bad), всё равно вносил свои ГС,
// энергию, массу и прибавку HP. Сервер такие узлы не видит вовсе — и превью
// расходилось с опубликованным кораблём. Берём разложенные узлы из карты платы.
function cnDeckLoadout(k) {
  const L = CN.shipLayout, out = { gs: 0, energy: 0, mass: 0, hp: 0, plates: 0, guns: 0 };
  if (!L || !L.bays) return out;
  cnPlateMap(k).sys.forEach(rec => {
    const S = CN_SYS[rec.sys];
    if (!S) return;
    out.gs += S.gs || 0;
    out.energy += S.energy || 0;
    out.mass += S.mass || 0;
    if (S.gun) out.guns++;
    if (S.outer) {
      out.hp += CN_ARMOR_PER_CELL * (S.hp || 0) * (S.len || 1);
      out.plates += (S.len || 1);
    }
  });
  return out;
}
// Старые раскладки знали единственный ключ 'gun' — читаем их как средний узел.
const CN_SYS_ALIAS = { gun: 'gun_m' };
// Клетка навесной брони: доля от брони выбранного бронирования (×hp своего вида).
// ⚠️ Прибавка НАМЕРЕННО мелкая. Первая версия давала +7/+24/+51% за ленту — это был
// бесплатный бафф на пустом месте. Броня теперь платит трижды: сырьём и ГС того же
// бронирования и грузоподъёмностью (энергию навесное железо не тратит).
// ⚠️ Прибавка НАМЕРЕННО крошечная: покрытие +0.6%, пояс +2.4%, экран +5.4% за ленту.
// Навесное — это доводка на пару процентов, а не второй корпус; основную прочность
// по-прежнему даёт выбранное бронирование.
const CN_ARMOR_PER_CELL = 0.012;
// Уложить навесной узел длиной len во внешний пояс, начиная с клетки i.
// Пояс идёт то вдоль корпуса, то поперёк — поэтому пробуем обе ориентации.
// Возвращает { cells, w, h } или null.
function cnOuterPlace(G, own, i, len, ignoreAt) {
  const x0 = i % G.w, y0 = (i / G.w) | 0;
  const free = c => c >= 0 && G.outer[c] && (own[c] < 0 || own[c] === ignoreAt);
  for (const [dx, dy] of [[0, 1], [1, 0]]) {
    const cells = [];
    for (let t = 0; t < len; t++) {
      const x = x0 + dx * t, y = y0 + dy * t;
      if (x >= G.w || y >= G.h) { cells.length = 0; break; }
      const c = y * G.w + x;
      if (!free(c)) { cells.length = 0; break; }
      cells.push(c);
    }
    if (cells.length === len) return { cells, w: dx ? len : 1, h: dy ? len : 1 };
  }
  return null;
}
// Пороги калибра для узлов: массу орудий этого класса режем по перцентилям,
// чтобы правило работало на любом каталоге, а не на угаданных числах.
function cnGunMass(w) { return +(w && (w.capacityPenalty != null ? w.capacityPenalty : w.cost)) || 0; }
function cnGunCaps(k) {
  if (CN._gcaps && CN._gcaps.k === k) return CN._gcaps;
  const db = CN.def.db, ms = [];
  for (const g in db.weapons) {
    if (CN.def.excl && CN.def.excl(k, g)) continue;
    (db.weapons[g] || []).forEach((w, i) => { if (cnItemAvail('weapon', k, g, i)) ms.push(cnGunMass(w)); });
  }
  ms.sort((a, b) => a - b);
  const q = p => ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * p))] : Infinity;
  const a = q(0.34), b = q(0.75);
  // Калибр — это ВИЛКА, а не потолок: в тяжёлый погон лёгкая турелька не ставится
  // (болтается в яме на три клетки), ровно как тяжёлая не лезет в лёгкий.
  return (CN._gcaps = { k, s: [-Infinity, a], m: [a, b], l: [b, Infinity] });
}
// Влезает ли орудие в узел размера sz ('s'|'m'|'l')
function cnGunFitsNode(k, w, sz) {
  const r = cnGunCaps(k)[sz]; if (!r) return true;
  const m = cnGunMass(w);
  return m <= r[1] && (r[0] === -Infinity || m > r[0]);
}
function cnGunWhyNode(k, w, sz) {
  const r = cnGunCaps(k)[sz], nm = (CN_SYS['gun_' + sz] || {}).name || 'узел';
  return cnGunMass(w) > r[1] ? `Слишком крупное для «${nm}» — нужен узел больше`
    : `Мелковато для «${nm}» — такому хватит узла меньше`;
}
// Прибавка прочности от навесного бронирования: доля на клетку × вид × длина.
function cnArmorPlateBonus() { return cnDeckLoadout().hp; }
// Типоразмер узла, к которому привязан подвес mi (или null — узла нет, старая схема)
function cnMountNodeSize(mi) {
  const L = CN.shipLayout; if (!L) return null;
  const b = (L.bays || []).find(x => x && x.mount === mi);
  const S = b ? CN_SYS[cnSysOf(b)] : null;
  return S && S.gun ? S.gun : null;
}
const CN_BEACON_R = 6;                          // радиус усилителя в клетках
const CN_BEACON_STEP = [0.30, 0.15, 0.07];      // 1-й, 2-й, 3-й усилитель; дальше ничего
function cnSysOf(b) {
  if (!b || !b.sys) return null;
  const s = CN_SYS_ALIAS[b.sys] || b.sys;
  if (!CN_SYS[s]) return null;
  if (s !== b.sys) b.sys = s;                    // легаси-ключ чиним прямо в раскладке
  return s;
}
function cnModFam(mod) {
  const c = mod && mod.combat;
  if (!c) return 'hull';
  for (const key of ['jam', 'pd', 'stealth', 'sensor', 'hangar', 'dejam', 'interdict', 'stabil', 'ftl']) {
    if (+c[key]) return key;
  }
  return 'hull';
}
const CN_FAM_RU = {
  jam: 'РЭБ', pd: 'ПРО', stealth: 'Маскировка', sensor: 'Сенсоры', hangar: 'Ангары',
  dejam: 'Контр-РЭБ', interdict: 'Интердикция', stabil: 'Стабилизация', ftl: 'FTL', hull: 'Корпусное',
};
// ── МОДУЛЬ СТРОИТСЯ КЛЕТКАМИ, А НЕ КЛАДЁТСЯ ГОТОВОЙ КОРОБКОЙ ───────────────────
// Жёсткий прямоугольник 3×3 на узком корпусе превращал палубу в «один рядок»:
// поставить его было некуда, а форму выбрать нельзя. Теперь модуль занимает
// клетки по одной, и все смежные клетки ОДНОГО модуля сливаются в контур.
//   номинал  — сколько клеток нужно контуру для полной отдачи (от энергии);
//              меньше — работает вполсилы, больше — сверхнорма, но с потолком.
//   форма    — вытянутый контур (антенна) и компактный (батарея) хороши разным.
// Отсюда «в длину или по одному блоку»: и то и другое законно и по-разному сильно.
function cnModNominal(mod) {
  const p = +(mod && (mod.energy != null ? mod.energy : mod.power)) || 0;
  if (p <= 200) return 6;
  if (p <= 600) return 10;
  if (p <= 1500) return 16;
  if (p <= 5000) return 24;
  return 32;
}
// Что даёт форма контура: длинная жила — сенсорам и РЭБ (антенна), плотный
// квадрат — ПРО и ангарам (погреб и палуба). Возвращает [множитель, подпись].
const CN_SHAPE_LINE = ['sensor', 'jam', 'dejam', 'stealth'];
const CN_SHAPE_BLOCK = ['pd', 'hangar', 'ftl', 'stabil', 'interdict'];
function cnShapeBonus(fam, cells, w) {
  if (cells.length < 3) return [1, ''];
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  cells.forEach(c => { const x = c % w, y = (c / w) | 0; x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y); });
  const bw = x2 - x1 + 1, bh = y2 - y1 + 1, long = Math.max(bw, bh), short = Math.min(bw, bh);
  const lin = short === 1 && long >= 3;                       // жила в одну клетку толщиной
  const sq = short >= 2 && long <= short + 1 && cells.length >= short * long * 0.85;
  if (lin && CN_SHAPE_LINE.indexOf(fam) >= 0) return [1.2, 'жила ' + long + ' кл. — антенна во всю длину, +20%'];
  if (sq && CN_SHAPE_BLOCK.indexOf(fam) >= 0) return [1.2, 'плотный контур ' + bw + '×' + bh + ', +20%'];
  if (lin && CN_SHAPE_BLOCK.indexOf(fam) >= 0) return [0.85, 'растянут в нитку — погребу нужна глубина, −15%'];
  if (sq && CN_SHAPE_LINE.indexOf(fam) >= 0) return [0.85, 'сбит в куб — антенне нужна длина, −15%'];
  return [1, ''];
}
// ГАБАРИТ МОДУЛЯ в клетках [ширина, высота]. Явный `cells` в KV главнее; иначе
// размер идёт от энергопотребления — чем прожорливее коробка, тем больше места
// она съедает на палубе. Это и есть «плата за установку»: место + энергия.
function cnModCells(mod) {
  const c = mod && mod.cells;
  if (c && +c[0] > 0 && +c[1] > 0) return [+c[0], +c[1]];
  return [1, 1];                                   // см. cnModNominal: модуль строится клетками
}
// Карта платы: кто где стоит, кто с кем граничит, какая у кого отдача.
//   own[i]  — индекс якорной ячейки модуля, накрывающего клетку i (или −1)
//   mods    — [{ at, mod, fam, w, h, k }]  (at = якорная ячейка, k = множитель)
function cnPlateMap(k) {
  const db = CN.def.db, L = CN.shipLayout || { bays: [] };
  const G = cnDeckGeo(k), w = G.w, h = G.h, N = w * h;
  const own = new Array(N).fill(-1), mods = [], bad = [], sys = [];
  // ⚠️ КЛЕТКА С МОДУЛЕМ ≠ КЛЕТКА, ЗАНЯТАЯ МОДУЛЕМ. Слияние в контуры раньше шло по
  // own[i] >= 0, а own выставляют и орудийные узлы. Модуль, чью клетку накрыл узел,
  // уходил в bad — и ТУТ ЖЕ получал собственный контур, отбирая клетку у узла:
  // на верфи он работал, на сервере его не существовало. Держим отдельный признак.
  const modc = new Array(N).fill(false);
  // ЕДИНОЕ правило: модуль либо занимает ВСЕ свои клетки (внутри обшивки и
  // свободные), либо не стоит вовсе и попадает в bad — половинчатых нет.
  // Системные клетки (шина, усилитель) занимают место наравне с модулями.
  for (let i = 0; i < N; i++) {
    const b = L.bays[i]; if (!b) continue;
    const sk = cnSysOf(b);
    if (sk) {
      if (CN_SYS[sk].outer) {                      // навесная броня живёт вне обшивки
        const pl = cnOuterPlace(G, own, i, CN_SYS[sk].len || 1, -1);
        if (!pl) { bad.push(i); continue; }
        pl.cells.forEach(c => { own[c] = i; });
        sys.push({ at: i, sys: sk, w: pl.w, h: pl.h, cells: pl.cells });
        continue;
      }
      const [fw, fh] = CN_SYS[sk].cells;
      if (!cnDeckFits(G, own, i, fw, fh, -1)) { bad.push(i); continue; }
      const rec = { at: i, sys: sk, w: fw, h: fh, cells: [] };
      const x0 = i % w, y0 = (i / w) | 0;
      for (let y = y0; y < y0 + fh; y++) for (let x = x0; x < x0 + fw; x++) { const c = y * w + x; own[c] = i; rec.cells.push(c); }
      sys.push(rec); continue;
    }
    const mm = b.m, mo = mm ? ((db.modules[mm.g] || [])[mm.idx] || null) : null;
    if (!mo) continue;
    if (!cnDeckFits(G, own, i, 1, 1, -1, cnModFam(mo))) { bad.push(i); continue; }
    own[i] = i; modc[i] = true;                    // пока клетка сама себе хозяин
  }
  // СЛИЯНИЕ В КОНТУРЫ: смежные клетки одного и того же модуля — один контур.
  {
    const seenC = new Set();
    for (let i = 0; i < N; i++) {
      if (!modc[i] || seenC.has(i)) continue;
      const b0 = L.bays[i]; if (!b0 || !b0.m) continue;
      const mo = (db.modules[b0.m.g] || [])[b0.m.idx]; if (!mo) continue;
      const q = [i], cells = []; seenC.add(i);
      while (q.length) {
        const c = q.pop(); cells.push(c);
        const x = c % w, y = (c / w) | 0;
        [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].forEach(([nx, ny]) => {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
          const n2 = ny * w + nx; if (seenC.has(n2) || !modc[n2]) return;
          const b2 = L.bays[n2];
          if (!b2 || !b2.m || b2.m.g !== b0.m.g || b2.m.idx !== b0.m.idx) return;
          seenC.add(n2); q.push(n2);
        });
      }
      const at = Math.min(...cells);
      cells.forEach(c => { own[c] = at; });
      const nom = cnModNominal(mo);
      mods.push({
        at, mod: mo, ref: b0.m, fam: cnModFam(mo), cells, size: cells.length, nom,
        w: 1, h: 1, k: 1, nb: 0, link: [],
        fill: Math.min(1.5, cells.length / nom),     // недобор бьёт, перебор упирается в потолок
      });
    }
  }
  const byAt = new Map(mods.map(m => [m.at, m]));
  const fams = new Set(mods.map(m => m.fam).filter(f => f !== 'hull'));
  const dil = 1 / (1 + CN_PLATE.dil * Math.max(0, fams.size - 1));
  // ── СЕТЬ ПИТАНИЯ ──────────────────────────────────────────────────────────────
  // ── УСИЛИТЕЛИ ────────────────────────────────────────────────────────────────
  // Маячок не даёт стата — он множит тех, до кого дотянулся. Второй и третий на
  // том же модуле слабее: место под ещё один контур окупается всё хуже.
  const beacons = sys.filter(s => s.sys === 'beacon');
  mods.forEach(m => {
    const hits = beacons.filter(b => b.cells.some(bc => m.cells.some(mc =>
      Math.abs(bc % w - mc % w) <= CN_BEACON_R && Math.abs(((bc / w) | 0) - ((mc / w) | 0)) <= CN_BEACON_R)));
    m.bc = hits.length;
    m.beacon = 1 + hits.slice(0, CN_BEACON_STEP.length).reduce((s2, _, i2) => s2 + CN_BEACON_STEP[i2], 0);
  });
  mods.forEach(m => {
    if (m.fam === 'hull') { m.k = 1; return; }
    const seen = new Set();
    m.cells.forEach(c => {
      const x = c % w, y = (c / w) | 0;
      [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].forEach(([nx, ny]) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const o = own[ny * w + nx];
        if (o < 0 || o === m.at) return;
        const om = byAt.get(o); if (om && om.fam === m.fam) seen.add(o);
      });
    });
    m.nb = seen.size;
    m.link = [...seen].map(a => byAt.get(a));
    const [sh, shWhy] = cnShapeBonus(m.fam, m.cells, w);
    m.shape = sh; m.shapeWhy = shWhy;
    m.k = Math.max(CN_PLATE.lo, Math.min(CN_PLATE.hi,
      m.fill * sh * (1 + CN_PLATE.adj * m.nb) * (m.nb >= 2 ? CN_PLATE.sq : 1) * dil * m.beacon));
  });
  return { w, h, own, mods, sys, byAt, dil, fams: [...fams], bad, G };
}
// Единственная проверка «влезает ли»: внутри обшивки, в границах, всё свободно —
// и, если известна семья модуля, клетки лежат в его отсеке (нос/мидель/корма,
// борт/ядро). Без fam проверка чисто геометрическая (свободное место как таковое).
function cnDeckFits(G, own, i, fw, fh, ignoreAt, fam) {
  const x0 = i % G.w, y0 = (i / G.w) | 0;
  if (x0 + fw > G.w || y0 + fh > G.h) return false;
  for (let y = y0; y < y0 + fh; y++) for (let x = x0; x < x0 + fw; x++) {
    const c = y * G.w + x;
    if (!G.inside[c]) return false;
    if (own[c] >= 0 && own[c] !== ignoreAt) return false;
  }
  if (fam && cnZoneCheck(G, fam, cnCellsOf(G, i, fw, fh))) return false;
  return true;
}
function cnPlateFits(map, i, fw, fh, ignoreAt, fam) { return cnDeckFits(map.G, map.own, i, fw, fh, ignoreAt, fam); }
function cnPlateNearest(map, i, fw, fh, ignoreAt, fam) {
  const w = map.w, x0 = i % w, y0 = (i / w) | 0;
  let best = -1, bd = Infinity;
  for (let c = 0; c < w * map.h; c++) {
    if (!cnDeckFits(map.G, map.own, c, fw, fh, ignoreAt, fam)) continue;
    const dx = c % w - x0, dy = ((c / w) | 0) - y0, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
// ПОЧИНКА РАСКЛАДКИ: после удаления модуля, смены класса или брони часть якорей
// оказывается вне обшивки или внахлёст. Пересобираем: каждый остаётся на месте,
// если может, иначе съезжает в ближайшую годную ячейку; кому места нет — снимается.
// РЕДАКТОР НИЧЕГО НЕ ПЕРЕСТАВЛЯЕТ САМ. Раньше он «чинил» раскладку, подыскивая
// сорванным модулям новое место, — и любое удаление запускало цепную реакцию:
// один съезжал, выталкивал соседа, тот следующего, и палуба ехала целиком.
// Теперь правило простое: модуль стоит там, куда его поставил игрок. Если место
// перестало быть палубой (сменили класс или корпус) — модуль СНИМАЕТСЯ, а не
// переезжает. Никто никого не двигает, ползти нечему.
function cnDeckStrip(k) {
  const db = CN.def.db, G = cnDeckGeo(k), N = G.w * G.h, a = CN.shipLayout.bays;
  const own = new Array(N).fill(-1);
  let lost = 0;
  for (let i = 0; i < N; i++) {
    const b = a[i]; if (!b) continue;
    const bsk = cnSysOf(b);
    if (b.sys) {                                     // разводка палубы держится по тем же правилам
      const S = CN_SYS[bsk];
      if (S && S.outer) {
        const pl = cnOuterPlace(G, own, i, S.len || 1, -1);
        if (!pl) { cnSysDrop(i); lost++; } else pl.cells.forEach(c => { own[c] = i; });
        continue;
      }
      if (!S || !cnDeckFits(G, own, i, S.cells[0], S.cells[1], -1)) { cnSysDrop(i); lost++; continue; }
      const x1 = i % G.w, y1 = (i / G.w) | 0;
      for (let y = y1; y < y1 + S.cells[1]; y++) for (let x = x1; x < x1 + S.cells[0]; x++) own[y * G.w + x] = i;
      continue;
    }
    if (!b.m) continue;
    const mo = (db.modules[b.m.g] || [])[b.m.idx];
    const sz = mo ? cnModCells(mo) : null;
    if (!sz || !cnDeckFits(G, own, i, sz[0], sz[1], -1, cnModFam(mo))) { b.m = null; lost++; continue; }
    const x0 = i % G.w, y0 = (i / G.w) | 0;
    for (let y = y0; y < y0 + sz[1]; y++) for (let x = x0; x < x0 + sz[0]; x++) own[y * G.w + x] = i;
  }
  if (lost) toast(`Снято с палубы (места больше нет): ${lost}`, 'inf');
}
function cnPlural(n, one, few, many) { const a = n % 100, b = n % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b > 1 && b < 5 ? few : many; }
// Плата — решётка фиксированного размера: ячейки не «добавляют», их занимают.
// Массив bays держим ровно в w*h, дырки (null-модуль) значимы — от них зависит соседство.
function cnBaysFit(k) {
  if (!CN.shipLayout) CN.shipLayout = { mounts: [], bays: [] };
  const d = cnModGridDims(k), n = d[0] * d[1], a = CN.shipLayout.bays;
  while (a.length < n) a.push({ m: null });
  if (a.length > n) a.splice(n);
  return a;
}
function cnLayoutAdd(kind) { if (!CN.shipLayout) CN.shipLayout = { mounts: [], bays: [] }; if (kind === 'mount') CN.shipLayout.mounts.push({ w: null }); else cnRoomAdd(); cnVehCalc(); }
// «＋ Отсек» на плате = занять первую свободную ячейку.
function cnRoomAdd() {
  cnBaysFit();
  const map = cnPlateMap(cnId('cn-class').value), i = map.own.findIndex(o => o < 0);
  if (i < 0) { toast('Палуба забита — снимите модуль, чтобы освободить место', 'inf'); return; }
  cnVehCalc(); cnOpenAssignPicker('bay', i);
}
function cnRoomAddAt(i) { cnBaysFit(); cnVehCalc(); cnOpenAssignPicker('bay', i); }
function cnMountAddAt(i) { if (!CN.shipLayout) CN.shipLayout = { mounts: [], bays: [] }; const a = CN.shipLayout.mounts, n0 = a.length; while (a.length <= i) a.push({ w: null }); CN._pendingAdd = { kind: 'mount', n0 }; cnVehCalc(); cnOpenAssignPicker('mount', i); }
function cnSchemToggle(which) { if (!CN.schemShow) CN.schemShow = { weapons: true, bays: true }; CN.schemShow[which] = !CN.schemShow[which]; const b = cnId(which === 'weapons' ? 'cn-tg-w' : 'cn-tg-b'); if (b) b.classList.toggle('on', CN.schemShow[which]); cnDrawShip(); }
function cnNodeClick(kind, i) { cnOpenAssignPicker(kind, i); }

// ── ЗУМ И ПАНОРАМА СХЕМЫ ─────────────────────────────────────
// Сцена всегда 0 0 VW VH; масштаб — это показанный КУСОК сцены (viewBox), поэтому
// линии, кегль и узлы увеличиваются вместе с кораблём, как на настоящем чертеже.
// Состояние живёт в CN.view и переживает перерисовку (её дёргает каждый пересчёт).
const CN_ZOOM_MIN = 1, CN_ZOOM_MAX = 8;
function cnView() { return CN.view || (CN.view = { z: 1, cx: null, cy: null }); }
// ⚠️ ЗУМ НЕ ПЕРЕРИСОВЫВАЕТ СХЕМУ. Раньше каждый щелчок колеса и каждый кадр
// панорамы гнали полный cnDrawShip(): корпус, все турели и innerHTML-reparse —
// сотни путей на кадр, отсюда «пиздец лагает». Меняется же ровно две вещи:
// viewBox корневого svg и контр-масштаб рамки со штампами. Их и правим на месте.
// Возвращает false, если рисовать ещё нечего — тогда зовём полную отрисовку.
function cnViewApply() {
  const host = cnId('cn-schematic'); if (!host) return false;
  const svg = host.querySelector('svg'), fr = host.querySelector('#cn-schem-frame'), S = CN.viewScene;
  if (!svg || !fr || !S) return false;
  const V = cnViewRect(S.VW, S.VH);
  svg.setAttribute('viewBox', `${V.x.toFixed(2)} ${V.y.toFixed(2)} ${V.w.toFixed(2)} ${V.h.toFixed(2)}`);
  fr.setAttribute('transform', `translate(${V.x.toFixed(2)},${V.y.toFixed(2)}) scale(${(1 / V.z).toFixed(4)})`);
  cnViewHud();
  return true;
}
function cnViewReset() { CN.view = { z: 1, cx: null, cy: null }; if (!cnViewApply()) cnDrawShip(); }
function cnViewRect(VW, VH) {
  const v = cnView();
  CN.viewScene = { VW, VH };
  const z = Math.max(CN_ZOOM_MIN, Math.min(CN_ZOOM_MAX, +v.z || 1));
  const w = VW / z, h = VH / z;
  let cx = v.cx == null ? VW / 2 : v.cx, cy = v.cy == null ? VH / 2 : v.cy;
  cx = Math.max(w / 2, Math.min(VW - w / 2, cx));       // панорама не выпускает сцену из вида
  cy = Math.max(h / 2, Math.min(VH - h / 2, cy));
  v.z = z; v.cx = cx; v.cy = cy;
  return { x: cx - w / 2, y: cy - h / 2, w, h, z };
}
// Экранная точка → координаты СЦЕНЫ (совпадают с viewBox корневого svg).
function cnScenePoint(svg, e) {
  const m = svg.getScreenCTM(); if (!m) return null;
  const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  return p.matrixTransform(m.inverse());
}
// Масштаб от кнопок: тянем к центру видимой области.
function cnZoomBy(f) {
  const v = cnView();
  v.z = Math.max(CN_ZOOM_MIN, Math.min(CN_ZOOM_MAX, +(( +v.z || 1) * f).toFixed(3)));
  if (!cnViewApply()) cnDrawShip();
}
function cnViewHud() {
  const b = cnId('cn-zoom-lbl'); if (b) b.textContent = Math.round((cnView().z || 1) * 100) + '%';
  const w = cnId('cn-schematic'); if (w) w.classList.toggle('cn-zoomed', (cnView().z || 1) > 1.001);
}
function cnViewBind(host) {
  if (host._viewBound) return; host._viewBound = true;
  // Колесо — масштаб ПОД КУРСОРОМ (точка под мышью остаётся на месте).
  host.addEventListener('wheel', e => {
    e.preventDefault();
    const svg = host.querySelector('svg'); if (!svg) return;
    const v = cnView(), z0 = +v.z || 1;
    const z = Math.max(CN_ZOOM_MIN, Math.min(CN_ZOOM_MAX, +(z0 * (e.deltaY < 0 ? 1.18 : 1 / 1.18)).toFixed(3)));
    if (z === z0) return;
    const p = cnScenePoint(svg, e);
    if (p) { v.cx = p.x - (p.x - v.cx) * (z0 / z); v.cy = p.y - (p.y - v.cy) * (z0 / z); }
    v.z = z;
    if (host._zoomRAF) return;
    host._zoomRAF = requestAnimationFrame(() => { host._zoomRAF = 0; if (!cnViewApply()) cnDrawShip(); });
  }, { passive: false });
  // Тяга фона — панорама. Узлы и отсеки не трогаем: у них своя тяга/клик.
  host.addEventListener('pointerdown', e => {
    if (e.button) return;
    if (CN.placing != null) return;
    if (e.target.closest('.cn-node, .cn-bay')) return;
    const v = cnView(); if ((+v.z || 1) <= 1.001) return;    // без зума панорамить нечего
    const svg = host.querySelector('svg'); if (!svg) return;
    const r = svg.getBoundingClientRect(), S = CN.viewScene || { VW: 960, VH: 470 };
    const kx = (S.VW / v.z) / (r.width || 1), ky = (S.VH / v.z) / (r.height || 1);
    const x0 = e.clientX, y0 = e.clientY, c0 = { cx: v.cx, cy: v.cy };
    host.classList.add('cn-panning');
    let raf = 0;
    const mv = ev => {
      v.cx = c0.cx - (ev.clientX - x0) * kx;
      v.cy = c0.cy - (ev.clientY - y0) * ky;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (!cnViewApply()) cnDrawShip(); });
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      host.classList.remove('cn-panning');
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  });
}
// Перетаскивание узла орудия по схеме. Клик без движения → открыть пикер (поставить/удалить).
function cnMountToLocal(evt) {                       // экранные координаты → координаты корпуса (учёт viewBox + rotate(90))
  const g = document.getElementById('cn-schem-g'); if (!g) return null;
  const svg = g.ownerSVGElement || g.closest('svg'); if (!svg) return null;
  const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
  const m = g.getScreenCTM(); if (!m) return null;
  const loc = pt.matrixTransform(m.inverse());
  return { x: loc.x, y: loc.y };
}
// Кламп позиции узла: держим в пределах корпуса/брони (не на щите) + минимальный зазор
// от других узлов, чтобы орудия не наслаивались друг на друга.
function cnMountClamp(H, x, y, i) {
  const clampHull = (x, y) => {
    const yy = Math.max(H.nose, Math.min(H.engine[1], y));
    const hw = cnHullHalf(H, yy) - 2;                   // на корпусе/броне, а не за бортом на щите
    return [Math.max(160 - hw, Math.min(160 + hw, x)), yy];
  };
  let c = clampHull(x, y); x = c[0]; y = c[1];
  const L = CN.shipLayout;
  if (L && L.mounts) {
    const auto = cnMountPositions(H, L.mounts.length);
    const others = L.mounts.map((s, j) => (s && s.pos) ? [s.pos.x, s.pos.y] : (auto[j] || null));
    const gap = 9;                                      // минимальный зазор между узлами (world units)
    for (let it = 0; it < 8; it++) {                    // релаксация: расталкиваем от соседей, потом снова в корпус
      let pushed = false;
      for (let j = 0; j < others.length; j++) {
        if (j === i || !others[j]) continue;
        const dx = x - others[j][0], dy = y - others[j][1], d = Math.hypot(dx, dy);
        if (d >= gap) continue;
        if (d < 0.01) x += gap;                         // точное совпадение — сдвиг вбок
        else { const kk = (gap - d) / d; x += dx * kk; y += dy * kk; }
        pushed = true;
      }
      c = clampHull(x, y); x = c[0]; y = c[1];
      if (!pushed) break;
    }
  }
  return { x: Math.round(x), y: Math.round(y) };
}
function cnMountPointerDown(evt, i) {
  if (CN.placing != null) return;                       // в тач-режиме постановки узлом не тянем — тап по схеме ставит его
  if (evt.button != null && evt.button !== 0) return;   // только основная кнопка
  evt.preventDefault();
  const L = CN.shipLayout, slot = L && L.mounts[i]; if (!slot) return;
  const start = cnMountToLocal(evt); let moved = false;
  const move = e => {
    const p = cnMountToLocal(e); if (!p) return;
    if (!moved && start && Math.hypot(p.x - start.x, p.y - start.y) < 3) return;   // порог, чтобы клик не считался тягой
    moved = true;
    const H = CN.shipGeo;
    if (H) slot.pos = cnMountClamp(H, p.x, p.y, i);     // в корпусе/броне + зазор от соседей
    else slot.pos = { x: Math.round(p.x), y: Math.round(p.y) };
    cnDrawShip();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!moved) cnNodeClick('mount', i);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
// Крупная тач-строка слота для мобильного списка (открывает тот же пикер, что и узел на схеме)
// Для узлов орудий добавляем кнопку «📍 Переместить» — тач-режим постановки касанием вместо тяги мелкого узла.
// ── Огневые группы: клиент-зеркало снапшота _bt_stats (тир/канал/группировка) ──
// Секторов обстрела нет: где ствол стоит на схеме, на бой не влияет. Группа
// определяется дальностью, каналом и тиром залпа — либо буквой ручной батареи.
const CN_BAT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const CN_BAT_KIND = { kinetic: 'кинетик', energy: 'лазер', missile: 'ракеты' };
// скорострельность → тир дробин 1..6 (зеркало _bt_shots_tier)
function cnShotsTier(rof) { rof = +rof || 0; return rof <= 1 ? 1 : rof <= 10 ? 2 : rof <= 30 ? 3 : rof <= 100 ? 4 : rof <= 400 ? 5 : 6; }
// имя орудия → канал урона (зеркало _cn_wpn_kind, ballistic→kinetic)
function cnWpnChannel(name) {
  const s = String(name || '').toLowerCase();
  if (/пусков|ракет|шахт|перехватчик|торпед|бомб/.test(s)) return 'missile';
  if (/лазер|импульс|электромагн|ланцет|плазм|бластер/.test(s)) return 'energy';
  return 'kinetic';
}
// Разбор монтировок в дробины (по одной на ствол), затем группировка как на сервере.
function cnBatteries() {
  const def = CN.def; if (!def || !def.cardUI) return { groups: [], mounts: [] };
  const db = def.db, L = CN.shipLayout || { mounts: [] };
  const mounts = [];
  (L.mounts || []).forEach((mt, i) => {
    if (!mt || !mt.w) return;
    const o = (db.weapons[mt.w.g] || [])[mt.w.idx]; if (!o) return;
    const cp = o.customParameter || {};
    const dmg = +o.dmg || 0; if (dmg <= 0) return;
    mounts.push({
      i, name: o.name,
      rng: Math.max(1, Math.min(40, Math.round(+cp.dalnost || 1))),
      k: cnWpnChannel(o.name),
      tier: cnShotsTier(cp.skorostrelnost),
      dmg, battery: mt.battery || null,
    });
  });
  // авто: (rng,k,tier) раздельно; ручная: (k,battery) слитно, тир=взвеш.средний
  const gm = new Map();
  mounts.forEach(m => {
    const key = m.battery ? `M|${m.k}|${m.battery}` : `A|${m.rng}|${m.k}|${m.tier}`;
    let g = gm.get(key);
    if (!g) { g = { k: m.k, bat: m.battery, rng: m.rng, dmg: 0, wsum: 0, members: [] }; gm.set(key, g); }
    g.dmg += m.dmg; g.wsum += m.dmg * m.tier; g.members.push(m.i);
    if (m.battery) g.rng = Math.min(g.rng, m.rng); else g.rng = m.rng;
    g.shots = m.battery ? Math.max(1, Math.min(6, Math.round(g.wsum / (g.dmg || 1)))) : m.tier;
  });
  return { groups: [...gm.values()], mounts };
}
// Клик по чипу монтировки: циклим Авто → A → B … → Авто
function cnMountBattery(i) {
  const L = CN.shipLayout; const mt = L && L.mounts[i]; if (!mt) return;
  const cur = mt.battery, at = CN_BAT_LETTERS.indexOf(cur);
  mt.battery = at < 0 ? CN_BAT_LETTERS[0] : (at + 1 >= CN_BAT_LETTERS.length ? null : CN_BAT_LETTERS[at + 1]);
  cnVehCalc();
}
function cnRenderBatteries() {
  const host = cnId('cn-battery'); if (!host) return;
  const { groups, mounts } = cnBatteries();
  if (!mounts.length) { host.innerHTML = `<div class="cn-bill-none" style="padding:6px 2px">Поставьте орудия — здесь появятся батареи залпа.</div>`; return; }
  const kindCls = { kinetic: 't2', energy: 'te', missile: 'err' };
  // список групп
  const grows = groups.sort((a, b) => b.dmg - a.dmg).map(g => {
    const heavy = g.shots <= 2;
    return `<div class="cn-bat-row">
      <span class="cn-bat-dot" style="background:var(--${kindCls[g.k] || 't2'})"></span>
      <span class="cn-bat-main">${g.bat ? `Группа ${esc(g.bat)} · ` : ''}${CN_BAT_KIND[g.k] || g.k}</span>
      <span class="cn-bat-shots" title="${heavy ? 'тяжёлый залп — пробивает щит' : 'скорострельный — щит держит, косит лёгких'}">залп ×${g.shots}</span>
      <span class="cn-bat-dmg">${Math.round(g.dmg)} · до ${g.rng} гекс.</span>
    </div>`;
  }).join('');
  // назначение батарей по стволам
  const mrows = mounts.map(m => {
    const tag = m.battery || 'Авто';
    return `<button type="button" class="cn-bat-chip${m.battery ? ' on' : ''}" onclick="cnMountBattery(${m.i})" title="Связать орудие в ручную батарею (клик — сменить): Авто → A → B …">
      <b>${tag}</b> <span>${esc(m.name)}</span> <i>×${m.tier}</i></button>`;
  }).join('');
  host.innerHTML = `<div class="cn-bat-list">${grows}</div>
    <div class="cn-bat-hint">Тяжёлые дробины (залп ×1–2) пробивают щит; рой (×5–6) щит держит, но косит лёгкие цели и насыщает ПРО. «Авто» дробит стволы по скорострельности. Ручная батарея (буква) сливает стволы <b>одного типа урона</b> в общий залп (дальность группы — по слабейшему стволу) — так разменивают пробитие на объём (влить тяж в рой) или наоборот.</div>
    <div class="cn-bat-mounts">${mrows}</div>`;
}
function cnSlotRow(kind, i, ico, lbl, val, filled) {
  const placing = kind === 'mount' && CN.placing === i;
  const move = kind === 'mount'
    ? `<button type="button" class="cn-slotrow-move${placing ? ' on' : ''}" onclick="event.stopPropagation();cnPlaceMount(${i})" title="Переместить узел касанием по схеме">${placing ? '✕' : '📍'}</button>`
    : '';
  return `<div class="cn-slotrow${filled ? ' filled' : ''}${placing ? ' placing' : ''}"><button type="button" class="cn-slotrow-main" onclick="cnNodeClick('${kind}',${i})"><span class="cn-slotrow-ico">${ico}</span><span class="cn-slotrow-b"><span class="cn-slotrow-lbl">${lbl}</span><span class="cn-slotrow-val">${val}</span></span><span class="cn-slotrow-arr">›</span></button>${move}</div>`;
}
// Тач-режим перемещения узла: тапни «📍», затем коснись точки на схеме — узел встанет туда.
function cnPlaceMount(i) {
  const L = CN.shipLayout; if (!L || !L.mounts[i]) return;
  if (CN.placing === i) { CN.placing = null; cnDrawShip(); return; }   // повторный тап — отмена
  CN.placing = i;
  cnClosePick();
  toast('Коснитесь точки на схеме — туда встанет узел орудия ' + (i + 1), 'inf');
  cnDrawShip();
}
// Обработчик касания по схеме в режиме постановки (навешивается на контейнер #cn-schematic).
function cnPlaceTapHandler(evt) {
  if (CN.placing == null) return;                        // обычный режим — не мешаем клику по узлу
  const L = CN.shipLayout, slot = L && L.mounts[CN.placing];
  if (!slot) { CN.placing = null; return; }
  evt.preventDefault();
  evt.stopPropagation();                                 // гасим onclick пустых мест (иначе плодятся узлы)
  if (evt.stopImmediatePropagation) evt.stopImmediatePropagation();
  const p = cnMountToLocal(evt); if (!p) return;
  const H = CN.shipGeo;
  if (H) slot.pos = cnMountClamp(H, p.x, p.y, CN.placing);   // в корпусе/броне + зазор от соседей
  else slot.pos = { x: Math.round(p.x), y: Math.round(p.y) };
  CN.placing = null;
  cnDrawShip();
}
// СИНТЕЗ (KV): оружие/модули — кат-широкие группы, доступность зависит от класса.
// db.weaponsAvail[k] / db.modulesAvail[k] = Set("group|idx"). Без KV-карт → всё доступно.
function cnItemAvail(type, k, group, i) {
  const av = type === 'weapon' ? CN.def.db.weaponsAvail : CN.def.db.modulesAvail;
  if (!av || !av[k]) return true;
  return av[k].has(group + '|' + i);
}
function cnGroupHasAvail(type, k, group, source) {
  return (source[group] || []).some((it, i) => cnItemAvail(type, k, group, i));
}
// Показывать ли группу в пикере: есть доступное ЛИБО есть свои орудия, которые
// класс не тянет (их показываем серыми — иначе группа исчезает молча).
// Группы, спрятанные из конструктора. Десант так и не стал механикой — вкладка
// висела мёртвым грузом, поэтому просто не показываем (данные в KV не трогаем).
const CN_HIDE_GROUPS = ['Десант', 'Десантные модули', 'Десантные отсеки'];
function cnGroupVisible(type, k, group, source) {
  if (CN_HIDE_GROUPS.indexOf(group) >= 0) return false;
  if (cnGroupHasAvail(type, k, group, source)) return true;
  return type === 'weapon' && cnIsTurretGroup(group) && cnTurretLockedIdxs(k).length > 0;
}
// Карточки группы: сначала доступные, затем — только для своих орудий —
// серые «не тянет» с причиной вместо молчаливого исчезновения.
function cnPickCards(type, k, group, source, actionFn, mark) {
  const arr = source[group] || [];
  let html = arr.map((it, i) => i).filter(i => cnItemAvail(type, k, group, i)).map(i => {
    const info = cnCompInfo(type, group, i);
    if (mark) mark(info, i);
    return cnCompFullHtml(info, actionFn(i));
  }).join('');
  if (type === 'weapon' && cnIsTurretGroup(group)) {
    html += cnTurretLockedIdxs(k).map(i => {
      const info = cnCompInfo(type, group, i);
      info.locked = true;
      info.lockMsg = cnTurretLockWhy(arr[i], k);
      return cnCompFullHtml(info, actionFn(i));
    }).join('');
  }
  return html;
}
// Разрешён ли компонент ИМЕННО на классе k: существует в каталоге И доступен этому
// классу (excl-группа + карта availW/availM). Ловит эксплойт «поставил на одном
// классе, где доступно, — перетащил дизайн на другой класс, где нельзя».
function cnWpnAllowed(k, x) {
  return !!(x && CN.def.db.weapons[x.g] && CN.def.db.weapons[x.g][x.idx])
    && !(CN.def.excl && CN.def.excl(k, x.g))
    && cnItemAvail('weapon', k, x.g, x.idx);
}
function cnModAllowed(k, x) {
  return !!(x && CN.def.db.modules[x.g] && CN.def.db.modules[x.g][x.idx])
    && cnItemAvail('module', k, x.g, x.idx);
}
// Список названий запрещённых для класса k компонентов в data (для сообщения/блокировки).
function cnForbiddenParts(k, d) {
  const out = [];
  (d.weapons || []).forEach(w => { if (!cnWpnAllowed(k, w)) { const o = CN.def.db.weapons[w.g] && CN.def.db.weapons[w.g][w.idx]; out.push((o && o.name) || (w.g + '#' + w.idx)); } });
  (d.modules || []).forEach(m => { if (!cnModAllowed(k, m)) { const o = CN.def.db.modules[m.g] && CN.def.db.modules[m.g][m.idx]; out.push((o && o.name) || (m.g + '#' + m.idx)); } });
  return out;
}
function cnOpenAssignPicker(kind, slot, keepFilter) {
  const isW = kind === 'mount', def = CN.def, k = cnId('cn-class').value, source = isW ? def.db.weapons : def.db.modules;
  const arr = isW ? CN.shipLayout.mounts : CN.shipLayout.bays, cur = arr[slot] && (isW ? arr[slot].w : arr[slot].m);
  // Доступные калибры/группы (после гейтов) → вкладки-фильтры вместо длинной простыни:
  // сначала выбираешь калибр (Лёгкие/Средние/…), потом орудие только этого калибра.
  const groups = [];
  for (const group in source) {
    if (isW && def.excl(k, group)) continue;
    if (isW && !cnWpnUnlocked(CN.cat, group)) continue;
    if (!isW && !cnModUnlocked(CN.cat, group)) continue;
    if (!cnGroupVisible(isW ? 'weapon' : 'module', k, group, source)) continue;
    groups.push(group);
  }
  // Активная вкладка: сохранённая (при переключении) → калибр текущего орудия → первая.
  if (!keepFilter || groups.indexOf(CN.assignFilter) < 0) CN.assignFilter = (cur && groups.indexOf(cur.g) >= 0) ? cur.g : groups[0];
  const active = CN.assignFilter;
  const tabs = groups.length > 1
    ? `<div class="cn-pick-tabs">${groups.map(g => `<button class="cn-pick-tab${g === active ? ' on' : ''}" onclick="cnAssignFilter('${kind}',${slot},'${esc(g)}')">${esc(g)}</button>`).join('')}</div>`
    : '';
  let secs = '';
  if (active) {
    const nodeSz = isW ? cnMountNodeSize(slot) : null;
    const cards = cnPickCards(isW ? 'weapon' : 'module', k, active, source,
      i => `cnAssignSlot('${kind}',${slot},'${esc(active)}',${i})`,
      (info, i) => {
        info.on = !!(cur && cur.g === active && cur.idx === i);
        if (nodeSz && !cnGunFitsNode(k, (source[active] || [])[i], nodeSz)) {
          info.locked = true;
          info.lockMsg = cnGunWhyNode(k, (source[active] || [])[i], nodeSz);
        }
      });
    secs = `<div class="cn-info-grid">${cards}</div>`;
  }
  if (!secs) secs = `<div class="cn-bill-none" style="padding:10px">${isW ? 'Нет доступного оружия этого класса' : 'Модули ещё не исследованы (вкладка «Исследования»)'}</div>`;
  // У палубы кнопки «удалить ячейку» нет: ячейки задаёт корпус, их можно только очистить.
  // Шина и усилитель — не из каталога: это сама разводка палубы, её кладут здесь же.
  const sysBtns = isW ? '' : Object.keys(CN_SYS).map(sk => {
    const S = CN_SYS[sk], on = CN.shipLayout.bays[slot] && CN.shipLayout.bays[slot].sys === sk;
    const size = S.outer ? `${S.len} кл. по борту` : `${S.cells[0]}×${S.cells[1]}`;
    const hint = S.outer ? ` +${Math.round(CN_ARMOR_PER_CELL * S.hp * S.len * 100)}% HP` : '';
    return `<button class="btn btn-sm${on ? ' btn-ac' : ' btn-gh'}" onclick="cnAssignSys(${slot},'${sk}')">`
      + `${esc(S.name)} ${size}${hint}</button>`;
  }).join('');
  // Кнопка «очистить» есть ВСЕГДА, когда в ячейке что-то стоит, — в том числе если
  // это узел, плита или усилитель: раньше она показывалась только для модуля, и
  // поставленный узел из этой модалки снять было нечем.
  const busy = isW ? !!cur : !!(cur || (CN.shipLayout.bays[slot] && CN.shipLayout.bays[slot].sys));
  const head = `<div class="cn-assign-head">` + sysBtns
    + (busy ? `<button class="btn btn-rd btn-sm" onclick="cnClearSlot('${kind}',${slot})">${isW ? 'Снять орудие' : 'Очистить ячейку'}</button>` : '')
    + (isW ? `<button class="btn btn-rd btn-sm" onclick="cnDeleteSlot('mount',${slot})">Удалить узел</button>` : '')
    + `</div>`;
  let ov = document.getElementById('cn-pick-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'cn-pick-ov'; ov.className = 'cn-modal-ov'; ov.onclick = e => { if (e.target === ov) cnClosePick(); }; document.body.appendChild(ov); }
  ov.classList.toggle('cn-cyb', !!(CN.def && CN.def.cardUI));
  ov.innerHTML = `<div class="cn-modal cn-pick-modal"><button class="cn-modal-x" onclick="cnClosePick()">✕</button><div class="cn-modal-name">${isW ? 'Орудие в узел' : 'Модуль в отсек'}</div>${head}${tabs}<div class="cn-pick-body">${secs}</div></div>`;
  ov.classList.add('show');
}
// Переключение калибра-фильтра в пикере узла (сохраняем выбор и перерисовываем тот же слот).
function cnAssignFilter(kind, slot, g) { CN.assignFilter = g; cnOpenAssignPicker(kind, slot, true); }
function cnAssignSlot(kind, slot, g, i) {
  const a = kind === 'mount' ? CN.shipLayout.mounts : CN.shipLayout.bays; if (!a[slot]) return;
  if (kind === 'mount') {
    // Калибр = типоразмер узла: в лёгкий узел главный калибр не влезает.
    const k0 = cnId('cn-class').value, wo = (CN.def.db.weapons[g] || [])[i], sz = cnMountNodeSize(slot);
    if (wo && sz && !cnGunFitsNode(k0, wo, sz)) {
      toast(`«${esc(wo.name || '')}»: ${cnGunWhyNode(k0, wo, sz)}`, 'inf');
      return;
    }
    a[slot].w = { g, idx: i };
  }
  else {
    // Модуль занимает прямоугольник клеток — ставим только если он туда влезает.
    const k = cnId('cn-class').value, mo = (CN.def.db.modules[g] || [])[i];
    const [fw, fh] = cnModCells(mo), map = cnPlateMap(k), fam = cnModFam(mo);
    // Сначала отсек, потом габарит: «сюда нельзя ставить радар» — другая беда, чем
    // «не влезает», и игроку надо сказать ровно ту, которая случилась.
    const zone = cnZoneCheck(map.G, fam, cnCellsOf(map.G, slot, fw, fh));
    if (zone) { toast(`«${esc(mo.name || '')}» сюда не ставится: ${zone}`, 'inf'); return; }
    if (!cnPlateFits(map, slot, fw, fh, slot)) {
      toast(`«${esc(mo.name || '')}» занимает ${fw}×${fh} клеток — здесь не помещается`, 'inf');
      return;                                        // молча в другое место НЕ переносим
    }
    a[slot].m = { g, idx: i };
    if (CN.deck) cnDeckGhost({ mod: { g, idx: i } });   // тот же модуль остаётся на кисти
  }
  cnClosePick(); cnVehCalc();
}
// Положить в ячейку шину или усилитель. Повторное нажатие по тому же — снять.
function cnAssignSys(slot, sk) {
  const a = CN.shipLayout.bays; if (!a[slot]) return;
  if (a[slot].sys === sk) { cnSysDrop(slot); cnClosePick(); cnVehCalc(); return; }
  const S = CN_SYS[sk], k = cnId('cn-class').value, map = cnPlateMap(k);
  // Броня НАВЕСНАЯ: её место — внешний пояс за обшивкой, клетки палубы она не ест.
  if (S.outer) {
    if (!map.G.outer[slot]) { toast('Броня вешается снаружи, по обводу корпуса — не на палубу', 'inf'); return; }
    if (!cnOuterPlace(map.G, map.own, slot, S.len || 1, slot)) {
      toast(`«${S.name}» — лента на ${S.len} кл. вдоль борта, здесь не ложится`, 'inf'); return;
    }
    cnSysDrop(slot); a[slot] = { m: null, sys: sk };
    cnDeckGhost({ sys: sk });                        // ставим дальше — места подсвечены
    cnClosePick(); cnVehCalc(); return;
  }
  if (!cnPlateFits(map, slot, S.cells[0], S.cells[1], slot)) {
    toast(`«${S.name}» занимает ${S.cells[0]}×${S.cells[1]} — здесь не помещается`, 'inf'); return;
  }
  cnSysDrop(slot);
  a[slot] = { m: null, sys: sk };
  if (!S.gun) cnDeckGhost({ sys: sk });
  // Орудийный узел заводит настоящий подвес в L.mounts, привязанный к этой клетке:
  // дальше он живёт как обычное орудие (цена, урон, батареи) — правится только место.
  if (S.gun) {
    const G = map.G, gx = slot % G.w, gy = (slot / G.w) | 0;
    CN.shipLayout.mounts.push({ w: null, cell: slot, pos: { x: G.ox + gx * G.C + G.C / 2, y: G.oy + gy * G.C + G.C / 2 } });
    a[slot].mount = CN.shipLayout.mounts.length - 1;
    cnClosePick(); cnVehCalc();
    // При рисовании протяжкой модалку не открываем — иначе она рвёт мазок.
    if (!CN.dkPaint) cnOpenAssignPicker('mount', a[slot].mount);
    return;
  }
  cnClosePick(); cnVehCalc();
}
// Снять то, что стоит в клетке (у орудийного узла заодно убрать сам подвес).
function cnSysDrop(slot) {
  const a = CN.shipLayout.bays, b = a[slot]; if (!b) return;
  const sk0 = cnSysOf(b);
  if (sk0 && CN_SYS[sk0].gun) {
    const mi = b.mount;
    if (mi != null && CN.shipLayout.mounts[mi]) {
      CN.shipLayout.mounts.splice(mi, 1);
      a.forEach(x => { if (x && x.mount != null && x.mount > mi) x.mount--; });
    }
  }
  b.sys = null; b.mount = null;
}
function cnClearSlot(kind, slot) {
  const a = kind === 'mount' ? CN.shipLayout.mounts : CN.shipLayout.bays;
  if (a[slot]) {
    if (kind === 'mount') a[slot].w = null;
    else if (a[slot].sys) cnSysDrop(slot);           // узел/плита/усилитель снимаются здесь же
    else a[slot].m = null;
  }
  cnClosePick(); cnVehCalc();
}
function cnDeleteSlot(kind, slot) {
  // ЯЧЕЙКИ ПАЛУБЫ НЕ УДАЛЯЮТСЯ. Раньше здесь был splice — он сдвигал все
  // последующие ячейки на одну, и вся палуба уезжала при удалении модуля.
  // Место на палубе задано корпусом, а не списком: «убрать» = очистить ячейку.
  if (kind === 'bay') return cnClearSlot(kind, slot);
  const a = CN.shipLayout.mounts;                    // орудийные узлы — по-прежнему список
  a.splice(slot, 1);
  cnClosePick(); cnVehCalc();
}
// Внутренность карточки оружия/модуля (картинка + статы + описание)
function cnPartCardInner(type, g, idx) {
  const db = CN.def.db, E = CN.def.hasEnergy;
  const item = (type === 'weapon' ? db.weapons : db.modules)[g][idx];
  const slug = cnGroupSlug(CN.cat, type, g);
  const wImg = cnImgPath(CN.cat, type, slug, idx);
  const img = type === 'weapon' ? cnWeaponImgTag(item, wImg, 'cn-comp-img') : cnImgTag(wImg, 'cn-comp-img');
  let chips;
  const itemE = +item.energy || +item.power || 0;
  if (type === 'weapon') { const cp = item.customParameter || {}; chips = (+item.heal > 0 ? cnChip('ремонт', cnNum(item.heal)) : cnChip('урон', cnNum(item.dmg))) + (+cp.dalnost > 0 ? cnChip('дальность', cnNum(cp.dalnost) + ' кв') : '') + (itemE ? cnChip('E', cnNum(itemE)) : '') + cnGsChip(item.cost); }
  else {
    const cb = item.combat || {};
    chips = (itemE ? cnChip('E', cnNum(itemE)) : '')
      + (item.capacity ? cnChip('груз', (item.capacity > 0 ? '+' : '') + cnNum(item.capacity)) : '')
      + (cb.interdict ? cnChip('⛔', 'интердикция') : '')
      + (cb.stabil ? cnChip('⚓', 'стабилизатор') : '')
      + (cb.ftl ? cnChip('⇢', 'FTL-прыжок') : '')
      + cnGsChip(item.cost);
  }
  const desc = cnDesc(CN.cat, type, g, idx);
  return `${img}<div class="cn-comp-b"><div class="cn-comp-nm">${esc(item.name)}</div><div class="cn-comp-st">${chips}</div>${desc ? `<div class="cn-comp-ds">${esc(desc)}</div>` : ''}</div>`;
}
// Модалка выбора оружия/модуля (карточки, сгруппированы; гейт по исследованиям)
function cnOpenPartPicker(type) {
  const def = CN.def, k = cnId('cn-class').value, source = type === 'weapon' ? def.db.weapons : def.db.modules;
  let secs = '';
  for (const group in source) {
    if (type === 'weapon' && def.excl(k, group)) continue;
    if (type === 'weapon' && !cnWpnUnlocked(CN.cat, group)) continue;
    if (type === 'module' && !cnModUnlocked(CN.cat, group)) continue;
    if (!cnGroupVisible(type, k, group, source)) continue;
    const cards = cnPickCards(type, k, group, source, i => `cnPickPart('${type}','${esc(group)}',${i})`);
    secs += `<div class="cn-pick-sec"><div class="cn-pick-h">${esc(group)}</div><div class="cn-info-grid">${cards}</div></div>`;
  }
  if (!secs) { toast(type === 'weapon' ? 'Нет доступного оружия этого класса' : 'Модули ещё не исследованы (вкладка «Исследования»)', 'inf'); return; }
  let ov = document.getElementById('cn-pick-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'cn-pick-ov'; ov.className = 'cn-modal-ov'; ov.onclick = e => { if (e.target === ov) cnClosePick(); }; document.body.appendChild(ov); }
  ov.classList.toggle('cn-cyb', !!(CN.def && CN.def.cardUI));
  ov.innerHTML = `<div class="cn-modal cn-pick-modal">
    <button class="cn-modal-x" onclick="cnClosePick()">✕</button>
    <div class="cn-modal-name">${type === 'weapon' ? 'Выбор вооружения' : 'Выбор модуля'}</div>
    <div class="cn-pick-body">${secs}</div>
  </div>`;
  ov.classList.add('show');
}
function cnClosePick() {
  document.getElementById('cn-pick-ov')?.classList.remove('show');
  // Откат «висячих» слотов: клик по свободному месту создал пустышки, но пикер закрыли без выбора
  const p = CN._pendingAdd; CN._pendingAdd = null;
  if (p && CN.shipLayout) {
    const a = p.kind === 'mount' ? CN.shipLayout.mounts : CN.shipLayout.bays;
    const filled = s => p.kind === 'mount' ? s && s.w : s && s.m;
    if (a.length > p.n0 && !a.slice(p.n0).some(filled)) { a.length = p.n0; cnVehCalc(); }
  }
}
function cnPickPart(type, g, idx) { cnClosePick(); cnVehAddItem(type, { g, idx, q: 1 }); }
// Инфо по уже добавленной строке оружия/модуля (read-only модалка)
function cnRowInfo(g, idx, type) { cnInfoModal(type === 'weapon' ? 'Вооружение' : 'Модуль', cnCompFullHtml(cnCompInfo(type, g, idx), '')); }

// ════════════════════════════════════════════════════════════
// ИССЛЕДОВАНИЯ — что доступно без исследования + гейтинг
// ════════════════════════════════════════════════════════════
// «Исследовать всё»: бесплатной базы больше НЕТ — каждый класс и каждая группа
// оружия открываются исследованием (бывшая база стала дешёвыми корнями дерева,
// см. EC_TECH_STARTER в economy.js; существующим фракциям выдана бэкфиллом в
// _research_total.sql). Пустые списки оставлены — id-контракт и cnUnitReqTech
// продолжают работать без изменений.
// СИНТЕЗ: гейтинг KV-каталога по исследованиям. Базово (бесплатно) открыты только
// СТАРТЕРЫ — первый класс каждой категории и лёгкие группы оружия; остальное
// исследуется (дерево строится из KV_DB в ecBuildResearch, зеркало tech_nodes —
// _tech_nodes_kv.sql). army = объединение ground+aviation (гейты транслируются
// в реальные категории). Без KV — прежнее пустое поведение (легаси-стартеры в БД).
const CN_KV_STARTER = {
  classes: { ship: ['corvette'], ground: ['peh'], aviation: ['dron'] },
  weapons: {
    ship: ['КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ'],
    ground: ['ХОЛОДНОЕ ОРУЖИЕ', 'ЛИЧНОЕ ОРУЖИЕ'],
    aviation: ['БОЕВЫЕ ЧАСТИ (КАМИКАДЗЕ)', 'СТРЕЛКОВОЕ ВООРУЖЕНИЕ'],
  },
};
const CN_BASE = (function () {
  const base = { classes: { ship: [], ground: [], aviation: [], army: [] }, weapons: { ship: [], ground: [], aviation: [], army: [] } };
  const D = (typeof window !== 'undefined' && window.KV_DB) || null;
  if (D) for (const cat of ['ship', 'ground', 'aviation']) {
    if (!D[cat]) continue;
    // Стартеры, пересечённые с живым каталогом (защита от рассинхрона имён)
    base.classes[cat] = CN_KV_STARTER.classes[cat].filter(k => D[cat].data[k]);
    base.weapons[cat] = CN_KV_STARTER.weapons[cat].filter(g => D[cat].weapons[g]);
  }
  base.classes.army = base.classes.ground.concat(base.classes.aviation);
  base.weapons.army = base.weapons.ground.concat(base.weapons.aviation);
  return base;
})();
async function cnLoadResearch() {
  CN.unlocked = new Set(); CN.staffAll = false;
  const fid = CN.myApp && CN.myApp.faction_id;
  // Есть фракция → гейтим по ЕЁ исследованиям (даже для стаффа-игрока)
  if (fid) {
    try {
      const rows = await dbGet('faction_economy', `faction_id=eq.${encodeURIComponent(fid)}&select=research`);
      const r = rows && rows[0] && rows[0].research;
      (r || []).forEach(k => CN.unlocked.add(k));
    } catch (e) {}
    return;
  }
  // Стафф без своей фракции — всё открыто (тест/модерация)
  if (cnIsStaff()) CN.staffAll = true;
}
function cnUnlocked(key) { return CN.staffAll || (CN.unlocked && CN.unlocked.has(key)); }
// Тех-ключи, которые требует чертёж юнита (для продажи: покупатель должен иметь их
// все в research, иначе купить нельзя). Базовые/бесплатные классы и оружие не считаем.
// Дивизии — это композиция другой техники, у них своих тех-ключей нет → [].
function cnUnitReqTech(unit) {
  if (!unit || unit.category === 'division' || !unit.data || typeof CN_BASE === 'undefined') return [];
  const cat = unit.category, d = unit.data, keys = new Set();
  const baseCls = (CN_BASE.classes[cat] || []), baseWpn = (CN_BASE.weapons[cat] || []);
  if (d.class && !baseCls.includes(d.class)) keys.add('cls.' + cat + '.' + d.class);
  if (d.class && d.type != null && +d.type >= 1) keys.add('type.' + cat + '.' + d.class);
  (d.weapons || []).forEach(w => { if (w && w.g && !baseWpn.includes(w.g) && !cnIsTurretGroup(w.g)) keys.add('wpn.' + cat + '.' + w.g); });
  (d.modules || []).forEach(m => { if (m && m.g) keys.add('mod.' + cat + '.' + m.g); });
  if (Array.isArray(d.hangars) && d.hangars.length) {
    keys.add('hangar.ship');
    if (d.hangars.some(h => [1, 2].includes(+h.id))) keys.add('hangar.ship.heavy');
  }
  return [...keys];
}
if (typeof window !== 'undefined') window.cnUnitReqTech = cnUnitReqTech;
// Единый «army»-форж своих тех-ключей не имеет: гейты транслируются в реальные
// категории (класс → своя, группа/компонент → достаточно любой из двух).
function cnClassUnlocked(cat, k) {
  if (cat === 'army') cat = cnKvRealCat(k);
  return (CN_BASE.classes[cat] || []).includes(k) || cnUnlocked('cls.' + cat + '.' + k);
}
function cnWpnUnlocked(cat, g) {
  if (cnIsTurretGroup(g)) return true;   // своё орудие уже «исследовано» верфью
  if (cat === 'army') return cnWpnUnlocked('ground', g) || cnWpnUnlocked('aviation', g);
  return (CN_BASE.weapons[cat] || []).includes(g) || cnUnlocked('wpn.' + cat + '.' + g);
}
function cnCompUnlocked(cat, t) {
  if (cat === 'army') return cnCompUnlocked('ground', t) || cnCompUnlocked('aviation', t);
  return cnUnlocked('comp.' + cat + '.' + t);
}
function cnModUnlocked(cat, g) {
  if (cat === 'army') return cnModUnlocked('ground', g) || cnModUnlocked('aviation', g);
  return cnUnlocked('mod.' + cat + '.' + g);
}
function cnCompOptions(cat, type, list, labelFn) {
  const open = cnCompUnlocked(cat, type);
  return list.map((it, i) => { const locked = i >= 1 && !open; return `<option value="${i}"${locked ? ' disabled' : ''}>${locked ? '🔒 ' : ''}${esc(labelFn(it, i))}</option>`; }).join('');
}

// ════════════════════════════════════════════════════════════
// ДВИЖОК БИЛДЕРА ТЕХНИКИ (ship / ground / aviation)
// ════════════════════════════════════════════════════════════
function cnRenderShip() { return cnVehRender('ship'); }
function cnRenderArmy() { return cnVehRender(CN_DEFS.army ? 'army' : 'ground'); }
// Старые роуты — алиасы единого армейского форжа (закладки/кэш старого index.html)
function cnRenderGround() { return cnRenderArmy(); }
function cnRenderAviation() { return cnRenderArmy(); }

async function cnVehRender(cat) {
  const edit = CN.edit; CN.edit = null;
  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);
  await cnLoadMyFaction();
  if (!cnCanAccess()) { cnGate(); return; }
  await cnLoadResearch();
  await cnLoadPartOverrides();   // админ-имена/описания орудий и модулей
  await cnLoadAlloys();          // кастомные сплавы фракции в слот брони
  await cnLoadTurrets();         // свои орудия из оружейной верфи в слот вооружения
  const def = CN_DEFS[cat];
  cnMergeAlloys(def.db);         // дописать сплавы в db.armors[k] всех классов
  cnMergeTurrets(def.db, CN_LOAD_DIV[cat] || 500);   // дописать свои орудия в db.weapons + карту доступности
  CN.cat = cat; CN.def = def; CN.last = null; CN.editUnit = edit || null;
  CN.shipLayout = { mounts: [], bays: [] }; CN.schemShow = { weapons: true, bays: true };

  const facBlock = await cnFactionPublishBlock();

  const typeField = def.hasType ? `<div class="cn-field"><label>Специализация</label><select id="cn-type" onchange="cnVehCalc()"></select></div>` : '';
  const reactorField = def.hasReactor ? `<div class="cn-field"><label>Реактор</label><select id="cn-reactor" onchange="cnVehCalc()"></select></div>` : '';
  const hangarPanel = def.hasHangars ? `
      <div class="cn-panel">
        <h3>Ангарная палуба</h3>
        <div id="cn-hangars"></div>
        <button class="btn btn-gh btn-fw" style="margin-top:10px" onclick="cnVehAddHangar()">+ Добавить ангар</button>
      </div>` : '';

  const cui = def.cardUI;
  const publishBtns = `${facBlock}
          <button class="btn btn-gd btn-fw" style="margin-top:12px" onclick="cnPublish()">${edit ? '💾 Сохранить изменения' : '✓ Опубликовать'}</button>
          <button class="btn btn-gh btn-fw" style="margin-top:8px" onclick="cnCopyVehCard()">📋 Копировать спецификацию</button>`;
  // Игровой outfit-экран: системы — компактные чипы в шапке полотна, ниже крупный корабль, под ним ТТХ
  const slotSel = (id, h) => `<select id="cn-${id}" class="cn-sel-hidden" onchange="${h}"></select><div class="cn-cards cn-slot" id="cn-${id}-cards"></div>`;
  const stageHtml = `
      <div class="cn-present cn-present-full">
        <div class="cn-panel cn-stage">
          <input id="cn-name" class="cn-stage-name" placeholder="Название корабля…" value="${esc(edit ? edit.name : '')}" oninput="cnDrawShip()">
          <div class="cn-slots">
            ${slotSel('class', 'cnVehHandleClass()')}
            ${def.hasType ? slotSel('type', 'cnVehCalc()') : ''}
            ${def.hasReactor ? slotSel('reactor', 'cnVehCalc()') : ''}
            ${slotSel('engine', 'cnVehCalc()')}
            ${slotSel('armor', 'cnVehCalc()')}
            ${slotSel('shield', 'cnVehCalc()')}
            ${def.db.radars ? slotSel('radar', 'cnVehCalc()') : ''}
          </div>
          <div id="cn-hud" class="cn-hud"></div>
          <div class="cn-schem-wrap">
            <div id="cn-schematic" class="cn-schematic"></div>
            <div class="cn-schem-toggles">
              <button class="btn btn-gh btn-sm on" id="cn-tg-w" onclick="cnSchemToggle('weapons')" title="Показать/скрыть орудия">Орудия</button>
              <button class="btn btn-gh btn-sm" id="cn-tg-b" onclick="cnDeckOpen()" title="Модульная палуба во весь экран">Палуба</button>
            </div>
            <div class="cn-schem-tools">
              <button class="btn btn-gh btn-sm" onclick="cnLayoutAdd('mount')" title="Добавить узел орудия">＋ Узел</button>
              <button class="btn btn-gh btn-sm" onclick="cnDeckOpen()" title="Модульная палуба во весь экран">＋ Модуль</button>
              ${def.hasHangars ? `<button class="btn btn-gh btn-sm" onclick="cnVehAddHangar()" title="Добавить ангар">＋ Ангар</button>` : ''}
            </div>
            <div class="cn-schem-zoom">
              <button class="btn btn-gh btn-sm" onclick="cnZoomBy(1/1.35)" title="Отдалить">−</button>
              <button class="btn btn-gh btn-sm" id="cn-zoom-lbl" onclick="cnViewReset()" title="Сбросить масштаб">100%</button>
              <button class="btn btn-gh btn-sm" onclick="cnZoomBy(1.35)" title="Приблизить">＋</button>
            </div>
          </div>
          <div id="cn-schem-list" class="cn-schem-list"></div>
          <div class="cn-schem-foot">
            <span class="cn-schem-hint">клик по узлу или отсеку — поставить/убрать · узлы можно тащить · на телефоне — 📍 у строки узла, затем касание по схеме</span>
            <span class="cn-lg"><i style="background:var(--te)"></i>энергия</span>
            <span class="cn-lg"><i style="background:var(--t2)"></i>баллистика</span>
            <span class="cn-lg"><i style="background:var(--err)"></i>ракеты</span>
            <span class="cn-lg"><i class="cn-lg-mod"></i>модуль</span>
            <span class="cn-lg"><i class="cn-lg-hangar"></i>ангар</span>
            <span class="cn-lg"><i class="cn-lg-empty"></i>свободный узел</span>
          </div>
        </div>
        <div class="cn-panel" id="cn-battery-panel"><h3>⚔ Батареи залпа</h3><div id="cn-battery"></div></div>
        ${def.hasHangars ? `<div class="cn-panel cn-hangars-panel"><h3>Ангарная палуба</h3><div id="cn-hangars"></div></div>` : ''}
        <div class="cn-panel"><h3>Ресурсы и решения</h3><div id="cn-stats" class="cn-stats-grid"></div>${publishBtns}</div>
      </div>`;
  const configHtml = `
      <div class="cn-config">
        <div class="cn-panel">
          <h3>Базовая конфигурация</h3>
          <div class="cn-field"><label>${esc(def.nameLabel)}</label><input id="cn-name" placeholder="Введите название..." value="${esc(edit ? edit.name : '')}"></div>
          <div class="cn-row2">
            <div class="cn-field"><label>${esc(def.classLabel)}</label><select id="cn-class" onchange="cnVehHandleClass()"></select></div>
            ${typeField}
          </div>
        </div>
        <div class="cn-panel">
          <h3>Энергоузел и защита</h3>
          <div class="cn-row3">
            ${reactorField}
            <div class="cn-field"><label>Бронирование</label><select id="cn-armor" onchange="cnVehCalc()"></select></div>
            <div class="cn-field"><label>Щитовой модуль</label><select id="cn-shield" onchange="cnVehCalc()"></select></div>
          </div>
          ${def.db.radars ? `<div class="cn-field"><label>Радарное оборудование</label><select id="cn-radar" onchange="cnVehCalc()"></select></div>` : ''}
          <div class="cn-field"><label>${esc(def.engineLabel)}</label><select id="cn-engine" onchange="cnVehCalc()"></select></div>
        </div>
        <div class="cn-panel">
          <h3>Вооружение</h3>
          <div id="cn-weapons"></div>
          <button class="btn btn-gh btn-fw" style="margin-top:10px" onclick="cnVehAddItem('weapon')">+ Добавить оружие</button>
        </div>
        ${hangarPanel}
        <div class="cn-panel">
          <h3>Модули и системы</h3>
          <div id="cn-modules"></div>
          <button class="btn btn-gh btn-fw" style="margin-top:10px" onclick="cnVehAddItem('module')">+ Добавить модуль</button>
        </div>
      </div>`;
  const body = cui ? stageHtml : `<div class="cn-grid">
      ${configHtml}
      <div class="cn-side">
        <div class="cn-panel cn-sticky">
          <h3>Текущие ТТХ</h3>
          <div id="cn-stats"></div>
          ${publishBtns}
        </div>
      </div>
    </div>`;

  setPg(`<div class="cn-wrap cn-builder${cui ? ' cn-cyb' : ''}">
    <div class="cn-head">
      <div class="cn-eyebrow">◈ ${esc(def.subtitle)}</div>
      <h1>${esc(def.title)}</h1>
      <div class="cn-back"><a onclick="go('constructors')">← к конструкторам</a></div>
    </div>
    <div class="cn-wip">⚠ Конструктор в переработке: палуба, модули и баланс ещё меняются — сохранённые проекты могут пересчитаться.</div>
    ${body}
  </div>`);

  if (edit && cnId('cn-faction')) cnId('cn-faction').value = edit.faction_id || '';
  CN.snap = null; CN.snapOver = false; CN._applying = false;
  cnVehInit();
  // База правки может быть уже «за лимитом» (старый проект на новом балансе) —
  // запоминаем это в snapOver, иначе жёсткий лимит откатывал бы каждое действие.
  if (edit && edit.data) { CN._applying = true; cnVehApplyData(edit.data); CN._applying = false; CN.snap = cnVehCollectData(); CN.snapOver = !!CN.lastOver; }
}

// Класс НЕЛЬЗЯ менять при правке уже сохранённого проекта: смена класса рушит
// совместимость компонентов (у каждого класса свои орудия/броня/двигатели) и
// меняла бы класс УЖЕ построенных кораблей (эксплойт design-edit-class-morph).
// Хочешь другой класс — создавай новый проект.
//
// ИСКЛЮЧЕНИЕ (осиротевший класс): если проект сохранён на классе, которого в
// каталоге БОЛЬШЕ НЕТ (класс удалён/переименован при обновлении баланса), то
// зафиксировать нечего — совместимость и так порушена. В этом случае замок
// снимаем и один раз просим выбрать, на какой класс перевести проект.
function cnClassOrphan() {
  const ek = CN.editUnit && CN.editUnit.data && CN.editUnit.data.class;
  return !!(CN.editUnit && CN.editUnit.id && ek && CN.def && CN.def.db && !CN.def.db.data[ek]);
}
function cnClassLocked() { return !!(CN.editUnit && CN.editUnit.id) && !cnClassOrphan(); }

function cnVehInit() {
  const def = CN.def, cat = CN.cat;
  // только разблокированные классы (value = ключ); сохранённый класс при правке — включаем всегда
  let keys = Object.keys(def.db.data).filter(k => cnClassUnlocked(cat, k));
  const ek = CN.editUnit && CN.editUnit.data && CN.editUnit.data.class;
  if (ek && def.db.data[ek] && !keys.includes(ek)) keys.push(ek);
  if (!keys.length) keys = [Object.keys(def.db.data)[0]];
  const clsOpt = k => `<option value="${k}">${esc(def.db.data[k].name)}</option>`;
  if (cat === 'army' && window.KV_CAT_CLASSES) {
    // Единый форж: классы сгруппированы по родам войск
    const g = keys.filter(k => cnKvRealCat(k) === 'ground'), a = keys.filter(k => cnKvRealCat(k) === 'aviation');
    cnId('cn-class').innerHTML =
      (g.length ? `<optgroup label="Наземные силы">${g.map(clsOpt).join('')}</optgroup>` : '') +
      (a.length ? `<optgroup label="Авиация">${a.map(clsOpt).join('')}</optgroup>` : '');
  } else cnId('cn-class').innerHTML = keys.map(clsOpt).join('');
  if (cnClassLocked()) cnId('cn-class').disabled = true;   // класс правке не подлежит
  else if (cnClassOrphan()) {                              // класс исчез из каталога — просим выбрать замену
    cnId('cn-class').disabled = false;
    const oldName = (CN.editUnit.data && CN.editUnit.data.class) || '—';
    toast(`Класс «${esc(oldName)}» этого проекта больше не выпускается — выберите, на какой класс его перевести`, 'inf');
  }
  if (def.cardUI) cnSlotSelected('class');
  cnVehClassDeps();
}
function cnVehHandleClass() {
  CN._dg = null; CN._gcaps = null;
  if (CN.shipLayout) { cnBaysFit(); cnDeckStrip(cnId('cn-class').value); }
  if (CN.deck) { cnDeckGhostOff(); cnDeckPalDraw(); }   // у другого класса другой каталог
  return cnVehHandleClass_();
}
function cnVehHandleClass_() {
  if (cnClassLocked()) return;   // класс при правке зафиксирован
  if (cnId('cn-weapons')) cnId('cn-weapons').innerHTML = '';
  if (cnId('cn-modules')) cnId('cn-modules').innerHTML = '';
  if (CN.def.hasHangars && cnId('cn-hangars')) cnId('cn-hangars').innerHTML = '';
  // Карточный UI держит оружие/модули в CN.shipLayout, а не в этих select'ах —
  // при смене класса корпус другой, поэтому сбрасываем ВСЁ смонтированное,
  // иначе на новом классе остаётся то, что ему не положено (эксплойт).
  if (CN.def.cardUI) CN.shipLayout = { mounts: [], bays: [] };
  cnVehClassDeps();
}
function cnVehClassDeps() {
  const def = CN.def, k = cnId('cn-class').value, cat = CN.cat;
  if (def.hasType) { const typeOpen = cnUnlocked('type.' + cat + '.' + k); cnId('cn-type').innerHTML = def.db.data[k].types.map((t, i) => { const locked = i >= 1 && !typeOpen; return `<option value="${i}"${locked ? ' disabled' : ''}>${locked ? '🔒 ' : ''}${esc(t.name)}</option>`; }).join(''); }
  if (def.hasReactor) cnId('cn-reactor').innerHTML = cnCompOptions(cat, 'reactor', def.db.reactors[k], (r, i) => `Ур.${i + 1} · ${r.name} (${r.energy} E)`);
  cnId('cn-armor').innerHTML = cnCompOptions(cat, 'armor', def.db.armors[k], a => `${a.name} (+${cnNum(a.armor)} AR)`);
  cnId('cn-shield').innerHTML = cnCompOptions(cat, 'shield', def.db.shields[k], s => s.name);
  cnId('cn-engine').innerHTML = cnCompOptions(cat, 'engine', def.db.engines[k], e => window.KV_DB ? `${e.name} (тяга ${cnNum(e.force)})` : `${e.name} (${e.speed} у.е.)`);
  if (def.db.radars && cnId('cn-radar')) cnId('cn-radar').innerHTML = cnCompOptions(cat, 'radar', def.db.radars[k] || [], r => { const d = r.customParameterradar && r.customParameterradar.dalnost; return r.name + (d ? ` (обзор ${cnNum(d)})` : ''); });
  if (def.cardUI) { ['type', 'reactor', 'armor', 'shield', 'engine', 'radar'].forEach(cnSlotSelected); cnHullHero(); }
  cnVehCalc();
}

function cnVehAddItem(type, preset) {
  const def = CN.def, k = cnId('cn-class').value;
  const container = cnId(type === 'weapon' ? 'cn-weapons' : 'cn-modules');
  const source = type === 'weapon' ? def.db.weapons : def.db.modules;
  const row = document.createElement('div');
  row.className = 'cn-row';
  const sel = document.createElement('select');
  sel.onchange = cnVehCalc;
  for (const group in source) {
    if (type === 'weapon' && def.excl(k, group)) continue;
    // не исследованные группы скрываем ВСЕГДА. Исключение — СОХРАНЁННАЯ группа этой
    // строки при правке (чтобы старый дизайн грузился), но не «все модули» подряд.
    const isPresetGroup = preset && preset.g === group;
    if (!isPresetGroup) {
      if (type === 'weapon' && !cnWpnUnlocked(CN.cat, group)) continue;
      if (type === 'module' && !cnModUnlocked(CN.cat, group)) continue;
    }
    if (!isPresetGroup && !cnGroupHasAvail(type, k, group, source)) continue;
    const g = document.createElement('optgroup');
    g.label = group;
    source[group].forEach((item, i) => {
      if (!isPresetGroup && !cnItemAvail(type, k, group, i)) return;
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ g: group, idx: i });
      let lbl = item.name;
      if (type === 'weapon') lbl += ` — ${cnNum(item.dmg)} урон` + (def.hasEnergy ? ` · ${cnNum(item.energy)} E` : ``);
      else if (def.hasEnergy && item.energy) lbl += ` · ${cnNum(item.energy)} E`;
      opt.textContent = lbl;
      g.appendChild(opt);
    });
    sel.appendChild(g);
  }
  if (sel.options.length === 0) { toast(type === 'weapon' ? 'Нет доступного оружия этого класса' : 'Модули ещё не исследованы (вкладка «Исследования»)', 'inf'); return; }
  row.appendChild(sel);
  if (preset) { try { sel.value = JSON.stringify({ g: preset.g, idx: preset.idx }); } catch (e) {} }
  if (CN.def.cardUI) {
    sel.classList.add('cn-sel-hidden');
    row.classList.add('cn-comp-row');
    let sv; try { sv = JSON.parse(sel.value); } catch (e) { sv = null; }
    if (sv) {
      const card = document.createElement('div');
      card.className = 'cn-comp cn-comp-inrow on';
      card.title = 'Подробнее';
      card.onclick = () => cnRowInfo(sv.g, sv.idx, type);
      card.innerHTML = cnPartCardInner(type, sv.g, sv.idx);
      row.insertBefore(card, sel);
    }
  }
  if (type === 'weapon') {
    const qty = document.createElement('input');
    qty.type = 'number'; qty.min = 1; qty.value = preset && preset.q ? preset.q : 1;
    qty.className = 'cn-qty'; qty.oninput = cnVehCalc;
    row.appendChild(qty);
  }
  const del = document.createElement('button');
  del.className = 'cn-del'; del.textContent = '✕';
  del.onclick = () => { row.remove(); cnVehCalc(); };
  row.appendChild(del);
  container.appendChild(row);
  cnVehCalc();
}

// ── Ангары (только корабли) ──
function cnVehAddHangar(preset) {
  const def = CN.def, k = cnId('cn-class').value;
  // гейт по исследованиям (preset/правка — пропускаем)
  if (!preset && !cnUnlocked('hangar.ship')) { toast('Ангары требуют исследования «Ангарные палубы»', 'inf'); return; }
  const heavyOpen = cnUnlocked('hangar.ship.heavy');
  const filtered = def.db.hangarTypes.filter(h => {
    // крупные ангары — за «Тяжёлые ангары»; при правке оставляем только СОХРАНЁННЫЙ тип
    if (!heavyOpen && [1, 2].includes(h.id) && !(preset && preset.id === h.id)) return false;
    if (['corvette', 'frigate', 'destroyer'].includes(k)) return ![1, 2].includes(h.id);
    if (k === 'cruiser') return h.id !== 2;
    return true;
  });
  if (!filtered.length) { if (!preset) toast('Для этого класса ангары недоступны', 'inf'); return; }
  const div = document.createElement('div');
  div.className = 'cn-hangar';
  const opts = filtered.map(h => `<option value="${h.id}">${esc(h.name)} (${h.capacity} очков)</option>`).join('');
  div.innerHTML = `
    <div class="cn-hangar-hd">
      ${CN.def.cardUI ? cnImgTag(cnImgPath(CN.cat, 'hangar', filtered[0].id), 'cn-h-img') : ''}
      <select class="cn-h-type" onchange="cnVehHangarUI(this)">${opts}</select>
      <button class="cn-del" onclick="this.closest('.cn-hangar').remove(); cnVehCalc();">✕</button>
    </div>
    <div class="cn-h-units"></div>
    <div class="cn-h-status">Занято: 0 / 0 очков</div>
    <button class="btn btn-gh btn-sm cn-h-add" onclick="cnVehAddUnit(this)">+ Авиагруппа</button>`;
  cnId('cn-hangars').appendChild(div);
  const sel = div.querySelector('.cn-h-type');
  if (preset && preset.id != null) sel.value = preset.id;
  cnVehHangarUI(sel);
  if (preset && preset.units) preset.units.forEach(u => cnVehAddUnit(div.querySelector('.cn-h-add'), u));
  cnVehCalc();
}
function cnVehHangarUI(sel) {
  const parent = sel.closest('.cn-hangar');
  const h = CN.def.db.hangarTypes.find(x => x.id == sel.value);
  const himg = parent.querySelector('.cn-h-img');
  if (himg) himg.outerHTML = cnImgTag(cnImgPath(CN.cat, 'hangar', sel.value), 'cn-h-img');
  const btn = parent.querySelector('.cn-h-add');
  const list = parent.querySelector('.cn-h-units');
  if (!h.canHaveUnits) { btn.style.display = 'none'; list.innerHTML = '<span class="cn-h-cargo">Отсек заполнен грузом</span>'; }
  else { btn.style.display = ''; list.innerHTML = ''; }
  cnVehCalc();
}
function cnVehAddUnit(btn, presetIdx) {
  const list = btn.closest('.cn-hangar').querySelector('.cn-h-units');
  const div = document.createElement('div');
  div.className = 'cn-row';
  const opts = CN.def.db.airUnits.map((u, i) => `<option value="${i}">${esc(u.name)} (${u.points} птс)</option>`).join('');
  div.innerHTML = `${CN.def.cardUI ? cnImgTag(cnImgPath(CN.cat, 'airunit', 0), 'cn-u-img') : ''}<select class="cn-u-type" onchange="cnVehUnitChange(this)">${opts}</select>
    <button class="cn-del" onclick="this.closest('.cn-row').remove(); cnVehCalc();">✕</button>`;
  list.appendChild(div);
  if (presetIdx != null) div.querySelector('.cn-u-type').value = presetIdx;
  if (CN.def.cardUI) cnVehUnitChange(div.querySelector('.cn-u-type')); else cnVehCalc();
}
function cnVehUnitChange(sel) {
  const img = sel.closest('.cn-row').querySelector('.cn-u-img');
  if (img) img.outerHTML = cnImgTag(cnImgPath(CN.cat, 'airunit', sel.value), 'cn-u-img');
  cnVehCalc();
}

// ════════════════════════════════════════════════════════════
// РЕСУРСНАЯ ВЕДОМОСТЬ КОРАБЛЯ (bill) — сырьё на 1 корпус
// ────────────────────────────────────────────────────────────
// Складывается из базы корпуса (по классу) + вклада компонентов
// (броня/щит/двигатель/реактор/оружие/модули/ангары). Пишется в
// summary.bill = {"Железо": N, ...}. На производстве economy_produce
// списывает это со склада, дефицит докупает по рынку ×1.5 (см.
// _unit_resources.sql). Логика — ОДНА, здесь; SQL только потребляет
// bill, как уже делает с summary.cost. Числа крутятся свободно.
// ════════════════════════════════════════════════════════════
// База корпуса по категории и классу. Корабли — за 1 корпус; наземка/авиация —
// за 1 регистрируемый «взвод/эскадрилью» (в дивизии одна запись ≈ один штатный
// батальон-аналог по размеру), потому масштаб сопоставим со штатными моделями.
// ЕДИНАЯ ЛЕСТНИЦА СТОИМОСТИ (важно: масштаб согласован между категориями!).
// Корабль — за 1 корпус; наземка/авиация в конструкторе — за 1 регистрируемую
// единицу-«взвод», в дивизии она занимает размер ≈ одного штатного пакета. Любой
// корабль (даже корвет) дороже сырьём, чем любой наземный пакет — это космофлот.
//   пехотный пакет < наземный пакет < авиапакет < корвет < … < дредноут
const CN_HULL_BILL = {
  ship: {
    corvette:    { 'Железо': 30,   'Медь': 8 },
    frigate:     { 'Железо': 70,   'Медь': 24,  'Титан': 8 },
    destroyer:   { 'Железо': 120,  'Медь': 40,  'Титан': 20 },
    cruiser:     { 'Железо': 220,  'Медь': 70,  'Титан': 45,  'Платина': 15 },
    battleship:  { 'Железо': 500,  'Титан': 150, 'Платина': 70, 'Изотопы': 30 },
    dreadnought: { 'Железо': 1000, 'Титан': 320, 'Платина': 160, 'Гравиядро': 6, 'Рагенод': 3 },
  },
  ground: {
    light:     { 'Железо': 6,  'Медь': 2 },
    medium:    { 'Железо': 12, 'Титан': 4,  'Медь': 3 },
    artillery: { 'Железо': 10, 'Титан': 3,  'Изотопы': 3 },
    heavy:     { 'Железо': 20, 'Титан': 8,  'Платина': 2 },
    walker:    { 'Железо': 18, 'Титан': 9,  'Редкоземельные руды': 3 },
  },
  aviation: {
    light:  { 'Титан': 3,  'Редкоземельные руды': 1 },
    medium: { 'Титан': 6,  'Редкоземельные руды': 2, 'Дейтерий': 2 },
    heavy:  { 'Титан': 10, 'Редкоземельные руды': 4, 'Дейтерий': 3 },
    cargo:  { 'Титан': 5,  'Медь': 3 },
  },
};
// Делители вклада компонентов по категории (стат → сколько сырья). Ground без
// космо-двигателя/реактора: ходовая = немного Железа.
const CN_BILL_DIV = {
  ship:     { armorFe: 2500, armorTi: 15000, shRare: 8000, shDeu: 20000, engFuel: 150, engDeu: 400, reIso: 2500, reHe: 6000 },
  aviation: { armorFe: 200,  armorTi: 1500,  shRare: 400,  shDeu: 800,   engFuel: 40,  engDeu: 120, reIso: 200,  reHe: 400 },
  ground:   { armorFe: 1200, armorTi: 6000,  shRare: 1500, shDeu: 4000 },
};
function cnBillAdd(bill, name, qty) { qty = Math.ceil(qty); if (qty > 0) bill[name] = (bill[name] || 0) + qty; }
// Тип орудия по названию → какое сырьё на него идёт
function cnWpnResKind(name) {
  const n = (name || '').toLowerCase();
  if (/пусков|ракет|шахт|перехватчик|торпед|бомб/.test(n)) return 'missile';
  if (/лазер|импульс|электромагн|ланцет|плазм|бластер/.test(n)) return 'energy';
  return 'ballistic';   // баллист/рельс/масс/пво/пулемёт/гаубиц
}
// Главный расчёт ведомости: категория + класс-ключ + разрешённые объекты
// компонентов. weapons/modules/hangars — массивы {w,q}/{m}/{h}.
function cnUnitBill(cat, k, parts) {
  const bill = {};
  const t = CN_BILL_DIV[cat]; if (!t) return bill;
  const base = (CN_HULL_BILL[cat] || {})[k] || {};
  for (const nm in base) cnBillAdd(bill, nm, base[nm]);
  const p = parts || {};
  if (p.armorObj && p.armorObj._alloy) {
    // Кастомный сплав: постройка потребляет САМ РЕЦЕПТ в реальных ресурсах,
    // масштабированный классом и силой сплава (_billScale, см. cnAlloyToArmor).
    const rec = p.armorObj._recipe || {}, sc = p.armorObj._billScale || 1;
    const EL = (typeof window !== 'undefined' && window.ARMOR_ALCHEMY && ARMOR_ALCHEMY.ELEMENTS) || {};
    for (const rid in rec) cnBillAdd(bill, cnAlloyResName(rid, EL), (rec[rid] || 0) * sc);
  } else if (p.armorObj) { cnBillAdd(bill, 'Железо', (p.armorObj.armor || 0) / t.armorFe); cnBillAdd(bill, 'Титан', (p.armorObj.armor || 0) / t.armorTi); }
  if (p.shieldObj && p.shieldObj.shield) { cnBillAdd(bill, 'Редкоземельные руды', p.shieldObj.shield / t.shRare); cnBillAdd(bill, 'Дейтерий', p.shieldObj.shield / t.shDeu); }
  if (p.engObj) {
    if (t.engFuel) { cnBillAdd(bill, 'Метан', (p.engObj.energy || 0) / t.engFuel); cnBillAdd(bill, 'Дейтерий', (p.engObj.energy || 0) / t.engDeu); }
    else cnBillAdd(bill, 'Железо', 1);   // наземная ходовая часть
  }
  if (p.reactObj && t.reIso) { cnBillAdd(bill, 'Изотопы', (p.reactObj.energy || 0) / t.reIso); cnBillAdd(bill, 'Гелий-3', (p.reactObj.energy || 0) / t.reHe); }
  (p.weapons || []).forEach(({ w, q }) => {
    if (!w || !q) return;
    const kind = cnWpnResKind(w.name);
    if (kind === 'missile') cnBillAdd(bill, 'Изотопы', (w.dmg / 150) * q);
    else if (kind === 'energy') { cnBillAdd(bill, 'Редкоземельные руды', (w.dmg / 180) * q); cnBillAdd(bill, 'Гелий-3', (w.dmg / 400) * q); }
    else cnBillAdd(bill, 'Железо', (w.dmg / 120) * q);
  });
  (p.modules || []).forEach(({ m }) => {
    if (!m) return;
    // Сырьё модуля — из его конструкционных решений (resurs), а не плоский Стелларит:
    // каркасные модули едят Железо/Медь, электроника — Редкоземельные, Стелларит
    // только там, где реально заложен Старвис.
    const r = m.resurs || {};
    cnBillAdd(bill, 'Железо', (r.blackmetall || 0) / 20);
    cnBillAdd(bill, 'Медь', (r.coloredmetall || 0) / 20);
    cnBillAdd(bill, 'Титан', (r.rudametall || 0) / 20);
    cnBillAdd(bill, 'Редкоземельные руды', (r.kristall || 0) / 20);
    cnBillAdd(bill, 'Стелларит', (r.staarvis || 0) / 20);
  });
  (p.hangars || []).forEach(({ h }) => { if (h) cnBillAdd(bill, 'Титан', (h.capacity || 0) / 12); });
  return bill;
}
// Сложить ведомость src×mult в dst (для агрегации дивизии)
function cnBillMerge(dst, src, mult) {
  mult = mult || 1;
  for (const nm in (src || {})) cnBillAdd(dst, nm, (src[nm] || 0) * mult);
  return dst;
}
// Иконка ресурса (через GalaxyGen, если доступен)
function cnBillResIcon(name) {
  try { if (window.GalaxyGen && GalaxyGen.resIconHtml) return GalaxyGen.resIconHtml(name, 'cn-bill-ic') + ' '; } catch (e) {}
  return '';
}
function cnBillHtml(bill) {
  const keys = Object.keys(bill || {});
  if (!keys.length) return '<span class="cn-bill-none">— без сырья —</span>';
  return keys.map(nm => `<span class="cn-bill-item">${cnBillResIcon(nm)}${esc(nm)} ×${cnNum(bill[nm])}</span>`).join('');
}
function cnBillText(bill) {
  const keys = Object.keys(bill || {});
  if (!keys.length) return ' - не требуется';
  return keys.map(nm => ` - ${nm}: ${cnNum(bill[nm])}`).join('\n');
}

// ════════════════════════════════════════════════════════════
// МАТЕМАТИКА КВАКВАНТОРА (перенос из govno-копия.html calculateResults)
// Активна при window.KV_DB. Скорость — в «квадратах».
// ════════════════════════════════════════════════════════════
const CN_KV_SPEEDCOEF = {
  peh: 5, btr: 8, tanki: 8, arta: 8, aviacia: 140, vertihui: 50, dron: 8,
  dronkos: 1000, mla: 1000, corvette: 1000, destroyer: 1000, supportCarrier: 1000,
  mediumCruiser: 1000, hyperCruiser: 1000, multiroleCarrier: 1000,
  battleship: 1000, dreadnought: 1000, ss13: 1,
};
// Прочность от бронеплиты: физика материала + вклад ресурсов (armorElements KV).
function cnKvArmorHp(cls, a) {
  if (!a || (a.name && (a.name.indexOf('Нет') === 0 || a.name === 'Нет брони'))) return 0;
  let s = (cls.mass || 0) / 2000 + (cls.gabarit || 0) * 2;
  let bm = 0.1, cm = 0.2, rm = 0.3, km = 0.5, sv = 1.0, dF = 1, tF = 1, hF = 1;
  if (a.material) {
    let at = (a.material.tensileStrength.min + a.material.tensileStrength.max) / 2;
    let hr = a.material.heatResistance, tc = a.material.thermalConductivity;
    at = 500 + 3000 * (1 - Math.exp(-at / 5000));
    hr = 500 + 2500 * (1 - Math.exp(-hr / 2000));
    tc = 100 + 1900 * (1 - Math.exp(-tc / 1000));
    dF += a.material.density * 0.02; tF += at / 4000; hF += hr / 4000 + tc / 50000;
  }
  if (a.category === 'heavyMetal') { bm *= 1.5; rm *= 1.3; }
  else if (a.category === 'lightMetal') { bm *= 0.7; km *= 1.3; cm *= 1.1; }
  else if (a.category === 'ceramic') { km *= 1.4; rm *= 1.2; bm *= 0.8; }
  else if (a.category === 'composite') { bm *= 1.1; cm *= 1.1; rm *= 1.1; km *= 1.1; sv *= 1.1; }
  // ── СПЛАВ (алхимия): эталон класса × сила рецепта (см. cnAlloyToArmor) ──
  // База — вклад ЛУЧШЕЙ СТОКОВОЙ брони этого класса (_refHp, проставлен при мерже
  // сплава в db.armors[k]); рецепт даёт только множитель. Прежний прокси cls.resurs
  // врал по классам (дредноут ×1.7, пехота ×0.3) — от него отказались.
  if (a._alloy) {
    if (a._refHp > 0) return a._refHp * cnAlloyMult(a);
    // Фолбэк (эталон не проставлен): старый прокси корпуса, чтобы не отдать 0.
    let load = 0;
    const cr = cls.resurs;
    if (cr) load = (cr.blackmetall || 0) * bm + (cr.coloredmetall || 0) * cm
      + (cr.rudametall || 0) * rm + (cr.kristall || 0) * km + (cr.staarvis || 0) * sv;
    return (s + load) * dF * tF * hF * cnAlloyMult(a);
  }
  if (a.resurs) s += (a.resurs.blackmetall || 0) * bm + (a.resurs.coloredmetall || 0) * cm
    + (a.resurs.rudametall || 0) * rm + (a.resurs.kristall || 0) * km + (a.resurs.staarvis || 0) * sv;
  s *= dF * tF * hF;
  let hp = (a.hpBoost || 0) + s;
  if (a.hpPercentBoost) hp *= (1 + a.hpPercentBoost);
  return hp;
}
// Скорость в «квадратах»: (сила_двигателя × сила_реактора) / масса × 10 / коэфф_класса.
function cnKvSpeed(cls, k, reactObj, engObj) {
  const rf = reactObj && reactObj.force ? reactObj.force : 1;
  const ef = engObj && engObj.force ? engObj.force : 0;
  if (ef <= 0) return 0;
  const kmh = ((ef * rf) / (cls.mass || 100)) * 10;
  let sp = Math.round(kmh / (CN_KV_SPEEDCOEF[k] || 1));
  return sp > 100 ? 100 : sp;
}
// ── ГС-стоимость KV-юнита ────────────────────────────────────────────────
// НЕ млн-прайсы Кваквантора (они раздували ГС), а: сырьё × ценность ресурса ×
// класс корпуса + ПЛОСКАЯ (аддитивная, НЕ коэффициент) наценка от общей
// ситуации в экономике. Итог — вменяемый ГС-масштаб, привязанный к сырью.
const CN_KV_RES_GS = {   // ГС за единицу KV-сырья (относительно ресурса, по редкости)
  blackmetall: 8, rudametall: 20, coloredmetall: 45, kristall: 90, staarvis: 150,
};
const CN_KV_CLASS_GS = { // множитель класса корпуса/модуля (сложность сборки)
  peh: 1, btr: 1.15, tanki: 1.35, arta: 1.3,
  dron: 1.2, aviacia: 1.5, vertihui: 1.5, dronkos: 1.7, mla: 1.8,
  corvette: 1.8, destroyer: 2.2, supportCarrier: 2.2, mediumCruiser: 2.6,
  hyperCruiser: 3, multiroleCarrier: 3, battleship: 3.6, dreadnought: 4.2, ss13: 3,
};
// Плоская наценка «от ситуации в экономике»: аддитивная база по классу, слегка
// сдвинутая живым индексом рынка (средняя переоценка над якорем в EC.market,
// если экономика загружена). НЕ множится на стоимость юнита — только прибавляется.
function cnKvEconMarkup(k) {
  let idx = 0;
  try {
    const M = (typeof window !== 'undefined' && window.EC && EC.market) || null;
    if (M) {
      let sum = 0, n = 0;
      for (const nm in M) { const m = M[nm]; if (m && m.price > 0 && m.base_price > 0) { sum += (m.price / m.base_price - 1); n++; } }
      if (n) idx = Math.max(-0.5, Math.min(1, sum / n));
    }
  } catch (e) {}
  const flat = (CN_KV_CLASS_GS[k] || 1) * 90;   // умеренная база наценки по классу
  return Math.max(0, Math.round(flat * (1 + idx)));
}
// Общий понижающий коэффициент цены за конструкционные решения (ещё раз срезано).
const CN_KV_COST_FACTOR = 0.32;
// Цена ОДНОГО компонента в ГС — ровно то, на сколько он двигает итог проекта.
// cnKvCost линейна по сырью, поэтому вклад компонента = его собственное сырьё,
// прогнанное через тот же курс и классовый множитель. Плоскую наценку
// (cnKvEconMarkup) сюда не кладём: она берётся с проекта один раз, а не с каждой
// детали. Своё орудие с верфи идёт мимо сырья — у него плоская боевая цена _gs.
function cnKvPartGs(o, k) {
  if (!o) return 0;
  if (+o._gs > 0) return Math.round(+o._gs);
  const r = o.resurs; if (!r) return 0;
  let base = 0;
  for (const x in CN_KV_RES_GS) base += (+r[x] || 0) * CN_KV_RES_GS[x];
  return Math.round(base * (CN_KV_CLASS_GS[k] || 1) * CN_KV_COST_FACTOR);
}
function cnKvCost(res, k) {
  let base = 0;
  for (const r in CN_KV_RES_GS) base += (res[r] || 0) * CN_KV_RES_GS[r];
  base *= (CN_KV_CLASS_GS[k] || 1) * CN_KV_COST_FACTOR;
  return Math.round(base + cnKvEconMarkup(k));
}

// ── Расчёт ТТХ ──
function cnVehCalc() {
  const def = CN.def, db = def.db;
  const k = cnId('cn-class').value;
  const cls = db.data[k];
  const typeObj = def.hasType ? cls.types[+cnId('cn-type').value || 0] : null;
  const reactObj = def.hasReactor ? db.reactors[k][+cnId('cn-reactor').value || 0] : null;
  const armorObj = db.armors[k][+cnId('cn-armor').value || 0];
  const shieldObj = db.shields[k][+cnId('cn-shield').value || 0];
  const engObj = db.engines[k][+cnId('cn-engine').value || 0];
  // Радар (KV.modules5): idx 0 = «Не выбран» — в расчёт не идёт (у пустышки бывают мусорные поля)
  const radarIdx = (db.radars && cnId('cn-radar')) ? (+cnId('cn-radar').value || 0) : 0;
  const radarObj = radarIdx > 0 ? (db.radars[k] || [])[radarIdx] : null;

  let cost = (typeObj ? typeObj.cost : cls.cost) + (reactObj ? reactObj.cost : 0) + armorObj.cost + shieldObj.cost + engObj.cost;
  let energyCons = def.hasEnergy ? ((shieldObj.energy || 0) + (engObj.energy || 0)) : 0;
  let dmg = 0, on = cls.baseON;
  const billWeapons = [], billModules = [], billHangars = [];   // для ресурсной ведомости

  if (def.cardUI) {
    // ⚠️ У KV-орудий расход зовётся power, а не energy — из-за этого пушки годами
    // «стояли и ничего не списывали»: в E попадал ноль.
    (CN.shipLayout && CN.shipLayout.mounts || []).forEach(mt => { if (!mt.w) return; const w = db.weapons[mt.w.g] && db.weapons[mt.w.g][mt.w.idx]; if (!w) return; cost += w.cost; on += cls.modON; dmg += w.dmg; if (def.hasEnergy) energyCons += (+w.energy || +w.power || 0); billWeapons.push({ w, q: 1 }); });
    // Разводка палубы (узлы, плиты, усилители) висит на реакторе своим железом.
    if (def.hasEnergy) energyCons += cnDeckLoadout().energy;
    (CN.shipLayout && CN.shipLayout.bays || []).forEach(by => { if (!by.m) return; const m = db.modules[by.m.g] && db.modules[by.m.g][by.m.idx]; if (!m) return; cost += m.cost; on += cls.modON; if (def.hasEnergy) energyCons += (m.energy || 0); billModules.push({ m }); });
  } else {
    document.querySelectorAll('#cn-weapons .cn-row').forEach(row => {
      const s = JSON.parse(row.querySelector('select').value);
      const q = parseInt(row.querySelector('input').value) || 0;
      const w = db.weapons[s.g][s.idx];
      cost += w.cost * q; on += q * cls.modON; dmg += w.dmg * q;
      if (def.hasEnergy) energyCons += (w.energy || 0) * q;
      billWeapons.push({ w, q });
    });
    document.querySelectorAll('#cn-modules .cn-row').forEach(row => {
      const s = JSON.parse(row.querySelector('select').value);
      const m = db.modules[s.g][s.idx];
      cost += m.cost; on += cls.modON;
      if (def.hasEnergy) energyCons += (m.energy || 0);
      billModules.push({ m });
    });
  }
  let hangarOver = false, cargo = 0;
  if (def.hasHangars) {
    document.querySelectorAll('#cn-hangars .cn-hangar').forEach(hp => {
      const h = db.hangarTypes.find(x => x.id == hp.querySelector('.cn-h-type').value);
      cost += h.cost; on += cls.modON; energyCons += h.energy;
      billHangars.push({ h });
      if (h && h.canHaveUnits === false) cargo += (h.capacity || 0);   // грузовые ангары = грузоподъёмность каравана
      let used = 0; hp.querySelectorAll('.cn-u-type').forEach(u => used += db.airUnits[u.value].points);
      const st = hp.querySelector('.cn-h-status');
      st.textContent = `Занято: ${used} / ${h.capacity} очков`;
      const over = used > h.capacity;
      st.classList.toggle('over', over);
      if (over) hangarOver = true;
    });
  }

  // НАВЕСНОЕ БРОНИРОВАНИЕ ПАЛУБЫ: покрытие/пояс/экран дают прибавку к прочности
  // (и тратят столько же сырья и денег, сколько заняли клеток).
  const DL = cnDeckLoadout(), plateK = DL.hp;
  let hp = (typeObj ? typeObj.hp : cls.hp) * (1 + plateK);
  let armor = ((typeObj ? typeObj.armor : 0) + armorObj.armor) * (1 + plateK);
  cost += armorObj.cost * plateK + DL.gs;            // железо узлов и плит платится отдельно
  const shield = shieldObj.shield || 0;
  let speed = engObj.speed;
  const eMax = reactObj ? reactObj.energy : 0;
  // Ресурсная ведомость: корабли строятся по ней напрямую, наземка/авиация —
  // в составе дивизий (их bill агрегируется в дивизионный summary.bill).
  const bill = cnUnitBill(CN.cat === 'army' ? cnKvRealCat(k) : CN.cat, k, { typeObj, reactObj, armorObj, shieldObj, engObj, weapons: billWeapons, modules: billModules, hangars: billHangars });
  // Железо палубы попадает и в ведомость — иначе «поставил, а сырьё то же».
  if (DL.gs) { cnBillAdd(bill, 'Железо', DL.gs / 40); cnBillAdd(bill, 'Титан', DL.gs / 120); }

  // СИНТЕЗ: математика Кваквантора поверх — HP от физики брони, скорость в «квадратах»,
  // ресурсы/экипаж/энергия/вместимость (наглядно в превью).
  let kv = null;
  if (typeof window !== 'undefined' && window.KV_DB) {
    hp = Math.round(cnKvArmorHp(cls, armorObj) * (1 + plateK));
    armor = 0;
    speed = cnKvSpeed(cls, k, reactObj, engObj);
    const res = { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 };
    const addRes = (o, q) => { if (o && o.resurs) for (const key in res) res[key] += (o.resurs[key] || 0) * (q || 1); };
    [cls, reactObj, engObj, shieldObj, radarObj].forEach(o => addRes(o, 1));
    addRes(armorObj, 1 + plateK);                  // навесные плиты = то же сырьё брони
    let crew = cls.crewRequired || 0;
    let power = (reactObj && reactObj.power) || 0;
    let cap = cls.capacity || 0;
    power -= (engObj && engObj.power) || 0;
    power -= (shieldObj && shieldObj.power) || 0;
    cap += (armorObj && armorObj.capacityBoost) || 0;
    // Навесная броня — это масса на обшивке: каждая клетка ест грузоподъёмность.
    cap -= DL.mass;                                  // масса палубы — в единицах нагрузки
    power -= DL.energy;                              // узлы и усилители едят мощность реактора
    cap += (engObj && engObj.capacityBoost) || 0;
    if (radarObj) { crew += radarObj.crewRequired || 0; power -= radarObj.power || 0; cap -= radarObj.capacityPenalty || 0; }
    billWeapons.forEach(({ w, q }) => { q = q || 1; crew += (w.crewRequired || 0) * q; power -= (w.power || 0) * q; cap -= (w.capacityPenalty || 0) * q; addRes(w, q); });
    billModules.forEach(({ m }) => { crew += (m.crewRequired || 0); power -= (m.power || 0); cap += (m.capacity || 0); addRes(m, 1); });
    for (const key in res) res[key] = Math.round(res[key]);
    // ГС теперь из сырья (см. cnKvCost), а не из млн-прайсов Кваквантора.
    // Свои орудия (верфь) идут поверх плоской боевой ценой — ровно тем числом,
    // которое игрок видел на верстаке (зеркало _cn_recompute).
    cost = cnKvCost(res, k)
         + billWeapons.reduce((a, { w, q }) => a + (+w._gs || 0) * (q || 1), 0)
         + DL.gs;                                    // ⚠️ иначе палуба выходит бесплатной
    // Радар: базовая дальность + бонус от мощности реактора (активные станции
    // «раскачиваются» энергией: +1 за каждые pwrPer E, кап pwrCap) + помехозащищённость.
    const rcp = (radarObj && radarObj.customParameterradar) || null;
    let radarRange = (rcp && +rcp.dalnost) || 0;
    if (rcp && +rcp.pwrPer > 0 && reactObj) {
      radarRange += Math.min(+rcp.pwrCap || 0, Math.floor(((+reactObj.power) || 0) / +rcp.pwrPer));
    }
    const radarEccm = (rcp && +rcp.eccm) || 0;
    // Дальность огня = max dalnost установленных орудий (зеркало rng в _unit_publish.sql)
    const fireRange = billWeapons.reduce((m, { w }) => Math.max(m, (w.customParameter && +w.customParameter.dalnost) || 0), 0);
    // Потолки бюджетов — чтобы палуба могла нарисовать ШКАЛУ, а не голое «осталось».
    // Максимум = всё, что даёт шасси и бустеры; израсходовано = максимум − остаток.
    const capMax = (cls.capacity || 0) + ((armorObj && armorObj.capacityBoost) || 0) + ((engObj && engObj.capacityBoost) || 0)
      + billModules.reduce((a, { m }) => a + Math.max(0, +m.capacity || 0), 0);
    const powerMax = (reactObj && reactObj.power) || 0;
    kv = { res, crew, power: Math.round(power), cap: Math.round(cap), capMax: Math.round(capMax), powerMax: Math.round(powerMax), radar: radarRange, eccm: radarEccm, rng: fireRange, speedUnit: 'квадрат' };
  }

  CN.last = { hp, armor, shield, dmg, speed, cost, on: +on.toFixed(1), eCons: energyCons, eMax, energy: def.hasEnergy, hangarOver, cargo, bill, kv };
  // KV: остаток энергии (kv.power) и грузоподъёмности (kv.cap) не должны уходить в минус.
  const kvPowerBad = !!(CN.last.kv && CN.last.kv.power < 0);
  const kvCapBad = !!(CN.last.kv && CN.last.kv.cap < 0);
  const over = (CN.last.energy && CN.last.eCons > CN.last.eMax) || CN.last.hangarOver || kvPowerBad || kvCapBad;
  CN.lastOver = over;   // читается загрузчиком правки (CN.snapOver)
  cnVehRenderStats();
  if (CN.def.cardUI) cnDrawShip();
  // Жёсткий лимит: нельзя набрать сверх показателя — откатываем последнее действие.
  if (CN._applying) return;
  // ВАЖНО: если САМ загруженный проект уже за лимитом (старый дизайн на новом
  // балансе), откат превращался в петлю — каждое действие возвращало проект в
  // «за лимитом», и редактировать было нельзя. Пока база over — правки принимаем,
  // чтобы игрок мог выкопаться (снять компоненты); гейт публикации остаётся.
  if (over && !CN.snapOver) {
    if (CN.snap) {
      CN._applying = true;
      cnVehApplyData(CN.snap);
      CN._applying = false;
      const msg = CN.last.hangarOver ? 'Ангар перегружен — авиагруппа не помещается'
        : kvCapBad ? 'Превышена грузоподъёмность — компонент не помещается'
        : 'Энергосеть перегружена — реактор не тянет';
      toast(msg, 'err');
    }
  } else {
    CN.snap = cnVehCollectData();
    CN.snapOver = over;
  }
}
function cnVehRenderStats() {
  const s = CN.last; if (!s) return;
  const energyOk = s.eCons <= s.eMax;
  const spUnit = s.kv ? s.kv.speedUnit : 'у.е.';
  // Card-UI: живые ТТХ целиком на HUD над схемой — внизу только ресурсная часть
  // (конструкционные решения + сырьё), чтобы данные не дублировались.
  if (CN.def && CN.def.cardUI) {
    let rr = '';
    if (s.kv) {
      const r = s.kv.res, R = [['Каркас', r.blackmetall], ['Системы', r.coloredmetall], ['Броня', r.rudametall], ['Электроника', r.kristall], ['Композиты', r.staarvis]].filter(x => x[1]);
      if (R.length) rr += `<div class="cn-stat cn-stat-bill"><span>Конструкционные решения</span><div class="cn-bill">${R.map(x => `<span class="cn-chip"><i>${x[0]}</i>${cnNum(x[1])}</span>`).join('')}</div></div>`;
    }
    if (s.bill && Object.keys(s.bill).length) rr += `<div class="cn-stat cn-stat-bill"><span>Сырьё / корпус</span><div class="cn-bill">${cnBillHtml(s.bill)}</div></div>`;
    cnId('cn-stats').innerHTML = rr;
    cnRenderHud();
    return;
  }
  let rows = `
    <div class="cn-stat"><span>Прочность</span><b>${cnNum(s.hp)} HP</b></div>
    ${s.kv ? '' : `<div class="cn-stat"><span>Бронирование</span><b>${cnNum(s.armor)} AR</b></div>`}
    <div class="cn-stat"><span>Щиты</span><b>${s.shield > 0 ? cnNum(s.shield) + ' ед.' : 'нет'}</b></div>
    <div class="cn-stat"><span>Огневая мощь</span><b>${cnNum(s.dmg)} урон</b></div>
    <div class="cn-stat"><span>Скорость</span><b>${cnNum(s.speed)} ${spUnit}</b></div>
    ${s.kv ? `<div class="cn-stat"><span>Экипаж</span><b>${cnNum(s.kv.crew)}</b></div>
    <div class="cn-stat"><span>Дальность огня</span><b>${s.kv.rng ? cnNum(s.kv.rng) + ' кв' : 'нет'}</b></div>
    <div class="cn-stat"><span>Радар</span><b>${s.kv.radar ? cnNum(s.kv.radar) + ' кв' : 'нет'}</b></div>
    <div class="cn-stat"><span>Остаток энергии</span><b class="${s.kv.power < 0 ? 'cn-warn' : ''}">${cnNum(s.kv.power)} ⚡</b></div>
    <div class="cn-stat"><span>Свободная грузоподъёмность</span><b class="${s.kv.cap < 0 ? 'cn-warn' : ''}">${cnNum(s.kv.cap)}</b></div>` : ''}
    ${s.cargo > 0 ? `<div class="cn-stat"><span>Грузоподъёмность</span><b style="color:var(--te)">${cnNum(s.cargo)} ед.</b></div>` : ''}
    <div class="cn-stat"><span>Стоимость</span><b style="color:var(--gd)">${cnNum(s.cost)} ГС</b></div>
    <div class="cn-stat"><span>Разработка</span><b style="color:var(--te)">${s.on} ОН</b></div>`;
  if (s.kv) {
    const r = s.kv.res, R = [['Каркас', r.blackmetall], ['Системы', r.coloredmetall], ['Броня', r.rudametall], ['Электроника', r.kristall], ['Композиты', r.staarvis]].filter(x => x[1]);
    if (R.length) rows += `<div class="cn-stat cn-stat-bill"><span>Конструкционные решения</span><div class="cn-bill">${R.map(x => `<span class="cn-chip"><i>${x[0]}</i>${cnNum(x[1])}</span>`).join('')}</div></div>`;
  }
  if (s.energy) rows += `<div class="cn-stat"><span>Энергосеть</span><b class="${energyOk ? '' : 'cn-warn'}">${cnNum(s.eCons)} / ${cnNum(s.eMax)} E</b></div>`;
  if (s.bill && Object.keys(s.bill).length) rows += `<div class="cn-stat cn-stat-bill"><span>Сырьё / корпус</span><div class="cn-bill">${cnBillHtml(s.bill)}</div></div>`;
  cnId('cn-stats').innerHTML = rows;
  cnRenderHud();
}
// Игровой HUD над схемой (card-UI): ЕДИНСТВЕННЫЙ блок живых ТТХ — плитки с
// подсказками, пульсом при изменении значения и warn-подсветкой перегрузов.
function cnRenderHud() {
  const s = CN.last, host = cnId('cn-hud'); if (!host || !s) return;
  const prev = CN._hudPrev || {}, cur = {};
  const tile = (id, lbl, val, cls, tip) => {
    cur[id] = String(val);
    const chg = prev[id] !== undefined && prev[id] !== cur[id];
    return `<div class="cn-hud-t${cls ? ' ' + cls : ''}${chg ? ' chg' : ''}"${tip ? ` title="${tip}"` : ''}><b>${val}</b><span>${lbl}</span></div>`;
  };
  let html = tile('hp', 'Прочность', cnNum(s.hp), '', 'Очки прочности корпуса в бою')
    + (s.kv ? tile('crew', 'Экипаж', cnNum(s.kv.crew), '', 'Требуемый экипаж') : tile('ar', 'Броня', cnNum(s.armor)))
    + tile('sh', 'Щит', s.shield > 0 ? cnNum(s.shield) : '—', '', 'Ёмкость защитного поля')
    + tile('dmg', 'Урон', cnNum(s.dmg), '', 'Суммарный урон орудий за ход')
    + tile('spd', 'Скорость', cnNum(s.speed) + (s.kv ? ' кв' : ''), '', 'Ход по карте боя, квадратов');
  if (s.kv) {
    html += tile('pw', 'Энергия', cnNum(s.kv.power) + ' ⚡', s.kv.power < 0 ? 'warn' : '', 'Остаток энергосети: реактор минус потребители')
      + tile('cap', 'Груз', cnNum(s.kv.cap), s.kv.cap < 0 ? 'warn' : '', 'Свободная грузоподъёмность шасси — её и увозит караван')
      + tile('rad', 'Радар', s.kv.radar ? cnNum(s.kv.radar) + ' кв' : '—', '', 'Дальность обзора радара, квадратов');
  }
  html += tile('on', 'Разработка', s.on + ' ОН', 'te', 'Очки науки за публикацию проекта')
    + tile('cost', 'Цена', cnNum(s.cost) + ' ГС', 'gd', 'Цена постройки одной единицы');
  if (s.energy && s.eMax > 0) {
    const pct = Math.min(100, Math.round(s.eCons / s.eMax * 100));
    const eCls = pct >= 100 ? ' over' : pct >= 85 ? ' warn' : '';
    html += `<div class="cn-hud-e${eCls}"><div class="cn-hud-e-hd"><span>Энергосеть</span><b>${cnNum(s.eCons)} / ${cnNum(s.eMax)} E · ${pct}%</b></div><div class="cn-hud-bar"><i style="width:${pct}%"></i></div></div>`;
  }
  CN._hudPrev = cur;
  host.innerHTML = html;
}

// ── Сбор/применение конфига (для публикации и редактирования) ──
function cnVehCollectData() {
  const def = CN.def;
  const d = { class: cnId('cn-class').value };
  if (def.hasType) d.type = +cnId('cn-type').value;
  if (def.hasReactor) d.reactor = +cnId('cn-reactor').value;
  d.armor = +cnId('cn-armor').value;
  // Кастомный сплав: помимо индекса несём стабильный id — сервер пересчитает по рецепту.
  const _aObj = (def.db.armors[d.class] || [])[d.armor];
  if (_aObj && _aObj._alloyId) d.armorAlloyId = _aObj._alloyId; else delete d.armorAlloyId;
  d.shield = +cnId('cn-shield').value;
  d.engine = +cnId('cn-engine').value;
  if (def.db.radars && cnId('cn-radar')) d.radar = +cnId('cn-radar').value;
  if (def.cardUI) {
    const L = CN.shipLayout || { mounts: [], bays: [] };
    d.weapons = L.mounts.filter(m => m.w).map(m => cnWpnTagTurret(def, { g: m.w.g, idx: m.w.idx, q: 1, battery: m.battery || null }));
    d.modules = L.bays.filter(b => b.m).map(b => ({ g: b.m.g, idx: b.m.idx }));
    // pos сохраняем ФАКТИЧЕСКИЙ (авто-раскладка, если узел не таскали) — иначе сервер
    // видит pos=null и относит все орудия к носу; борта в бою пропадают.
    const autoP = CN.shipGeo ? cnMountPositions(CN.shipGeo, Math.max(16, L.mounts.length)) : [];
    const effPos = (m, i) => m.pos ? { x: m.pos.x, y: m.pos.y } : (autoP[i] ? { x: autoP[i][0], y: autoP[i][1] } : null);
    d.layout = { mounts: L.mounts.map((m, i) => ({ w: m.w ? cnWpnTagTurret(def, { g: m.w.g, idx: m.w.idx }) : null, pos: effPos(m, i), battery: m.battery || null })), bays: L.bays.map(b => b && b.sys ? { sys: b.sys } : (b && b.m ? { g: b.m.g, idx: b.m.idx } : null)) };
  } else {
    d.weapons = [...document.querySelectorAll('#cn-weapons .cn-row')].map(r => { const s = JSON.parse(r.querySelector('select').value); return cnWpnTagTurret(def, { g: s.g, idx: s.idx, q: +(r.querySelector('input')?.value || 1) }); });
    d.modules = [...document.querySelectorAll('#cn-modules .cn-row')].map(r => { const s = JSON.parse(r.querySelector('select').value); return { g: s.g, idx: s.idx }; });
  }
  if (def.hasHangars) d.hangars = [...document.querySelectorAll('#cn-hangars .cn-hangar')].map(h => ({ id: +h.querySelector('.cn-h-type').value, units: [...h.querySelectorAll('.cn-u-type')].map(u => +u.value) }));
  // Настоящая грузоподъёмность KV (остаток вместимости шасси) — фиксируем в data,
  // чтобы сервер (_ship_cargo) считал грузоподъёмность каравана по ней, не доверяя summary.
  d.kv_cargo = (CN.last && CN.last.kv) ? Math.max(0, Math.round(CN.last.kv.cap || 0)) : 0;
  return d;
}
function cnVehApplyData(d) {
  const def = CN.def, shipCard = def.cardUI;
  // Свои орудия лежат в проекте со стабильным turretId: индекс в db.weapons мог
  // сместиться (добавили/сняли орудие в верфи), id — нет. Переразрешаем ссылки
  // ДО санации ниже, иначе живое орудие сочтут битой ссылкой и снимут.
  // Зеркало armorAlloyId, только для слота вооружения.
  d = Object.assign({}, d);
  if (Array.isArray(d.weapons)) d.weapons = d.weapons.map(w => cnWpnUntagTurret(def, w)).filter(Boolean);
  if (d.layout && Array.isArray(d.layout.mounts)) {
    d.layout = Object.assign({}, d.layout, { mounts: d.layout.mounts.map(x => {
      if (!x || !x.w || !x.w.turretId) return x;
      return Object.assign({}, x, { w: cnWpnUntagTurret(def, x.w) });
    }) });
  }
  if (cnId('cn-weapons')) cnId('cn-weapons').innerHTML = '';
  if (cnId('cn-modules')) cnId('cn-modules').innerHTML = '';
  if (def.hasHangars && cnId('cn-hangars')) cnId('cn-hangars').innerHTML = '';
  if (d.class && def.db.data[d.class]) cnId('cn-class').value = d.class;
  cnVehClassDeps();
  if (def.hasType && d.type != null) cnId('cn-type').value = d.type;
  if (def.hasReactor && d.reactor != null) cnId('cn-reactor').value = d.reactor;
  if (d.armor != null) cnId('cn-armor').value = d.armor;
  // Сплав ищем по стабильному id (индекс в db.armors мог сместиться со временем).
  if (d.armorAlloyId) {
    const arr = def.db.armors[d.class] || [];
    const ai = arr.findIndex(a => a._alloyId === d.armorAlloyId);
    if (ai >= 0) cnId('cn-armor').value = ai;
  }
  if (d.shield != null) cnId('cn-shield').value = d.shield;
  if (d.engine != null) cnId('cn-engine').value = d.engine;
  if (d.radar != null && cnId('cn-radar')) cnId('cn-radar').value = d.radar;
  // Санация ссылок на компоненты: проект мог быть создан на СТАРОМ каталоге
  // (до KV-синтеза) — группы/индексы орудий и модулей могли исчезнуть.
  // Битые ссылки молча выбрасываем, иначе db.weapons[g][idx] роняет весь экран
  // редактирования (TypeError) и проект «не редачится».
  // Проверяем не только существование компонента, но и допустимость на ТЕКУЩЕМ классе:
  // так открытие/пересохранение старого дизайна счищает всё, что классу не положено
  // (наследие эксплойта смены класса), а не только битые ссылки.
  const lk = d.class;
  const okW = x => cnWpnAllowed(lk, x);
  const okM = x => cnModAllowed(lk, x);
  let dropped = 0;
  if (shipCard) {
    if (d.layout) CN.shipLayout = { mounts: (d.layout.mounts || []).map(x => {
        let w = null, pos = null;
        if (x && ('w' in x || 'pos' in x)) { w = x.w ? { g: x.w.g, idx: x.w.idx } : null; pos = x.pos ? { x: x.pos.x, y: x.pos.y } : null; }  // новый формат {w,pos}
        else if (x) w = { g: x.g, idx: x.idx };                                                                                              // старый формат {g,idx}|null
        if (w && !okW(w)) { w = null; dropped++; }
        return { w, pos, battery: (x && x.battery) || null };
      }), bays: (d.layout.bays || []).map(x => {
        // шина/усилитель/узел/броня — разводка палубы; легаси-ключ 'gun' переводим на типоразмер
        const xs = x && x.sys ? (CN_SYS_ALIAS[x.sys] || x.sys) : null;
        if (xs && CN_SYS[xs]) return { m: null, sys: xs, mount: (x.mount != null ? x.mount : null) };
        let m = x ? { g: x.g, idx: x.idx } : null;
        if (m && !okM(m)) { m = null; dropped++; }
        return { m };
      }) };
    else CN.shipLayout = {
      mounts: (d.weapons || []).filter(w => okW(w) || !++dropped).flatMap(w => Array.from({ length: w.q || 1 }, () => ({ w: { g: w.g, idx: w.idx }, battery: w.battery || null }))),
      bays: (d.modules || []).filter(m => okM(m) || !++dropped).map(m => ({ m: { g: m.g, idx: m.idx } }))
    };
    // Старые проекты писались под другую сетку палубы: разово подрезаем то, что
    // теперь лежит вне обшивки или внахлёст. Дальше раскладку никто не трогает.
    CN._dg = null; CN._gcaps = null; cnBaysFit(lk); cnDeckStrip(lk);
  } else {
    (d.weapons || []).forEach(w => { if (okW(w)) cnVehAddItem('weapon', w); else dropped++; });
    (d.modules || []).forEach(m => { if (okM(m)) cnVehAddItem('module', m); else dropped++; });
  }
  if (dropped) toast(`Проект со старого каталога: ${dropped} комп. больше не выпускается и снято — поставьте замену`, 'inf');
  if (def.hasHangars) (d.hangars || []).forEach(h => cnVehAddHangar(h));
  if (def.cardUI) { cnSlotSelected('class'); ['type', 'reactor', 'armor', 'shield', 'engine', 'radar'].forEach(cnSlotSelected); cnHullHero(); }
  cnVehCalc();
}

// ── Текст спецификации ──
function cnVehCardText() {
  const def = CN.def, db = def.db, s = CN.last;
  const k = cnId('cn-class').value, cls = db.data[k];
  const name = (cnId('cn-name').value || 'Без названия').toUpperCase();
  const typeObj = def.hasType ? cls.types[+cnId('cn-type').value || 0] : null;
  const reactObj = def.hasReactor ? db.reactors[k][+cnId('cn-reactor').value || 0] : null;
  const engObj = db.engines[k][+cnId('cn-engine').value || 0];
  let c = `НАЗВАНИЕ: ${name}\n`;
  c += `Класс: ${cls.name}${typeObj ? ' (' + typeObj.name + ')' : ''}\n`;
  c += `------------------------------------------\n`;
  c += `КОРПУС: ${cnNum(s.hp)} HP${s.kv ? '' : ' / ' + cnNum(s.armor) + ' AR'}\n`;
  c += `ЩИТЫ: ${s.shield > 0 ? cnNum(s.shield) + ' ед.' : 'нет'}\n`;
  c += `СКОРОСТЬ: ${cnNum(s.speed)} ${s.kv ? 'квадрат' : 'у.е.'} (${engObj.name})\n`;
  if (s.kv) c += `ЭКИПАЖ: ${cnNum(s.kv.crew)}\n`;
  if (s.kv && s.kv.radar) { const rObj = db.radars && db.radars[k] && db.radars[k][+cnId('cn-radar').value || 0]; c += `РАДАР: ${rObj ? rObj.name + ' — ' : ''}${cnNum(s.kv.radar)} кв\n`; }
  if (reactObj) c += `РЕАКТОР: ${reactObj.name} (${reactObj.energy} E)\n`;
  c += `------------------------------------------\nВООРУЖЕНИЕ:\n`;
  const shipCard = def.cardUI;
  if (shipCard) {
    // Визуальный конструктор: состав в CN.shipLayout, агрегируем одинаковые по борту.
    const L = CN.shipLayout || { mounts: [], bays: [] };
    const wAgg = new Map();
    (L.mounts || []).forEach(mt => { if (!mt.w) return; const key = mt.w.g + '|' + mt.w.idx; wAgg.set(key, (wAgg.get(key) || 0) + 1); });
    if (!wAgg.size) c += ` - нет\n`;
    wAgg.forEach((q, key) => { const [g, idx] = key.split('|'); const w = (db.weapons[g] || [])[+idx]; if (!w) return; c += ` - ${w.name} x${q} (${cnNum(w.dmg * q)} урон)\n`; });
  } else {
    const ws = document.querySelectorAll('#cn-weapons .cn-row');
    if (!ws.length) c += ` - нет\n`;
    ws.forEach(r => { const sp = JSON.parse(r.querySelector('select').value); const q = r.querySelector('input').value; const w = db.weapons[sp.g][sp.idx]; c += ` - ${w.name} x${q} (${cnNum(w.dmg * q)} урон)\n`; });
  }
  if (def.hasHangars) {
    const hs = document.querySelectorAll('#cn-hangars .cn-hangar');
    if (hs.length) { c += `\nАНГАРЫ:\n`; hs.forEach(hp => { const h = db.hangarTypes.find(x => x.id == hp.querySelector('.cn-h-type').value); c += ` + ${h.name.toUpperCase()} (вмест. ${h.capacity})\n`; hp.querySelectorAll('.cn-u-type').forEach(u => c += `   > ${db.airUnits[u.value].name}\n`); }); }
  }
  c += `\nМОДУЛИ:\n`;
  if (shipCard) {
    const L = CN.shipLayout || { mounts: [], bays: [] };
    const mAgg = new Map();
    (L.bays || []).forEach(by => { if (!by.m) return; const key = by.m.g + '|' + by.m.idx; mAgg.set(key, (mAgg.get(key) || 0) + 1); });
    if (!mAgg.size) c += ` - базовая комплектация\n`;
    mAgg.forEach((q, key) => { const [g, idx] = key.split('|'); const m = (db.modules[g] || [])[+idx]; if (!m) return; c += ` - ${m.name}${q > 1 ? ' x' + q : ''}\n`; });
  } else {
    const ms = document.querySelectorAll('#cn-modules .cn-row');
    if (!ms.length) c += ` - базовая комплектация\n`;
    ms.forEach(r => { const sp = JSON.parse(r.querySelector('select').value); c += ` - ${db.modules[sp.g][sp.idx].name}\n`; });
  }
  if (s.bill && Object.keys(s.bill).length) c += `------------------------------------------\nСЫРЬЁ НА КОРПУС:\n${cnBillText(s.bill)}\n`;
  c += `------------------------------------------\nИТОГ: ${cnNum(s.cost)} ГС · ${s.on} ОН`;
  if (s.energy) c += ` · энергосеть ${cnNum(s.eCons)}/${cnNum(s.eMax)} E`;
  return c;
}
function cnCopyVehCard() { cnCopy(cnVehCardText()); }

// ════════════════════════════════════════════════════════════
// БИЛДЕР ДИВИЗИЙ (division)
// ════════════════════════════════════════════════════════════
// bill — сырьё на 1 «пакет» модели (count единиц): пехота=1000 бойцов,
// техника=100 машин, авиация=10 бортов. Складывается в дивизионный summary.bill.
const CN_DIV_DATA = [
  { id: 'inf_militia', name: 'Ополчение', type: 'inf', cost: 10, count: 1000, size: 1000, armorhp: 1, atack: 1, dalnost: 1, bill: { 'Железо': 1 } },
  { id: 'inf_regular', name: 'Регулярная пехота', type: 'inf', cost: 35, count: 1000, size: 1000, armorhp: 2, atack: 3, dalnost: 2, bill: { 'Железо': 2 } },
  { id: 'inf_heavy', name: 'Тяжелая/Штурмовая пехота', type: 'inf', cost: 80, count: 1000, size: 1000, armorhp: 5, atack: 6, dalnost: 2, bill: { 'Железо': 5, 'Титан': 1 } },
  { id: 'inf_spec', name: 'Спецназ / Десант', type: 'inf', cost: 150, count: 1000, size: 1000, armorhp: 4, atack: 10, dalnost: 3, bill: { 'Железо': 4, 'Титан': 2, 'Редкоземельные руды': 1 } },
  { id: 'inf_robot', name: 'Роботизированная пехота', type: 'inf', cost: 50, count: 1000, size: 1000, armorhp: 4, atack: 10, dalnost: 3, bill: { 'Железо': 6, 'Медь': 3, 'Редкоземельные руды': 1 } },
  { id: 'tank_light', name: 'Легкий танк', type: 'tank', cost: 300, count: 100, size: 200, armorhp: 30, atack: 25, dalnost: 4, bill: { 'Железо': 6, 'Медь': 2 } },
  { id: 'tank_mbt', name: 'Основной Боевой Танк', type: 'tank', cost: 500, count: 100, size: 300, armorhp: 80, atack: 70, dalnost: 5, bill: { 'Железо': 12, 'Титан': 4, 'Медь': 3 } },
  { id: 'tank_heavy', name: 'Тяжелый танк прорыва', type: 'tank', cost: 1000, count: 100, size: 400, armorhp: 150, atack: 110, dalnost: 5, bill: { 'Железо': 20, 'Титан': 8, 'Платина': 2 } },
  { id: 'tank_walker', name: 'Штурмовой Шагоход', type: 'tank', cost: 1500, count: 100, size: 400, armorhp: 120, atack: 140, dalnost: 6, bill: { 'Железо': 18, 'Титан': 9, 'Редкоземельные руды': 3 } },
  { id: 'btr_wheel', name: 'Колесный бронетранспортер', type: 'btr', cost: 250, count: 100, size: 150, armorhp: 15, atack: 10, dalnost: 2, bill: { 'Железо': 4, 'Медь': 1 } },
  { id: 'bmp_track', name: 'Гусеничная БМП', type: 'btr', cost: 450, count: 100, size: 200, armorhp: 35, atack: 25, dalnost: 3, bill: { 'Железо': 7, 'Титан': 2, 'Медь': 2 } },
  { id: 'btr_hover', name: 'Грави-транспорт', type: 'btr', cost: 800, count: 100, size: 150, armorhp: 25, atack: 15, dalnost: 3, bill: { 'Железо': 5, 'Медь': 3, 'Редкоземельные руды': 1 } },
  { id: 'art_mortar', name: 'Мобильная минометная батарея', type: 'artillery', cost: 200, count: 100, size: 100, armorhp: 5, atack: 40, dalnost: 15, bill: { 'Железо': 4, 'Изотопы': 1 } },
  { id: 'art_sau', name: 'Самоходная артустановка', type: 'artillery', cost: 900, count: 100, size: 250, armorhp: 20, atack: 90, dalnost: 40, bill: { 'Железо': 10, 'Титан': 3, 'Изотопы': 2 } },
  { id: 'art_rszo', name: 'РСЗО', type: 'artillery', cost: 1200, count: 100, size: 300, armorhp: 15, atack: 150, dalnost: 60, bill: { 'Железо': 9, 'Титан': 2, 'Изотопы': 3 } },
  { id: 'art_laser', name: 'Тяжелое плазменное/лазерное орудие', type: 'artillery', cost: 3500, count: 100, size: 350, armorhp: 30, atack: 250, dalnost: 80, bill: { 'Железо': 12, 'Редкоземельные руды': 5, 'Гелий-3': 2 } },
  { id: 'air_drone', name: 'Ударный беспилотник', type: 'aviation', cost: 500, count: 10, size: 10, armorhp: 2, atack: 40, dalnost: 50, bill: { 'Титан': 2, 'Редкоземельные руды': 1 } },
  { id: 'air_heli', name: 'Штурмовой ганшип', type: 'aviation', cost: 1500, count: 10, size: 20, armorhp: 15, atack: 100, dalnost: 30, bill: { 'Титан': 5, 'Медь': 2, 'Дейтерий': 1 } },
  { id: 'air_fighter', name: 'Атмосферный истребитель', type: 'aviation', cost: 2000, count: 10, size: 20, armorhp: 10, atack: 150, dalnost: 150, bill: { 'Титан': 6, 'Редкоземельные руды': 2, 'Дейтерий': 2 } },
  { id: 'air_bomber', name: 'Тяжелый тактический бомбардировщик', type: 'aviation', cost: 2500, count: 10, size: 40, armorhp: 25, atack: 400, dalnost: 200, bill: { 'Титан': 10, 'Редкоземельные руды': 3, 'Изотопы': 2, 'Дейтерий': 2 } }
];
const CN_DIV_TYPES = [['inf', 'Пехота'], ['tank', 'Танки'], ['btr', 'БТР / БМП'], ['artillery', 'Артиллерия'], ['aviation', 'Авиация']];
const CN_DIV_CAP = 10000;

async function cnRenderDivision() {
  const edit = CN.edit; CN.edit = null;
  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);
  await cnLoadMyFaction();
  if (!cnCanAccess()) { cnGate(); return; }
  // Новые дивизии не создаются: юниты собираются в армии («Звёздный марш»).
  // Билдер открывается только для правки уже существующей дивизии (или админом).
  if (!edit && !cnIsStaff()) {
    toast('Дивизии больше не проектируются: стройте юниты и формируйте из них армии во вкладке «Военпром»', '');
    go('cat-divisions'); return;
  }
  CN.cat = 'division'; CN.def = null; CN.lastDiv = null; CN.editUnit = edit || null;
  await cnLoadDivUnits();
  const facBlock = await cnFactionPublishBlock();
  setPg(`<div class="cn-wrap cn-builder">
    <div class="cn-head">
      <div class="cn-eyebrow">◈ ШТАБ ФОРМИРОВАНИЙ</div>
      <h1>Конструктор дивизий</h1>
      <div class="cn-back"><a onclick="go('constructors')">← к конструкторам</a></div>
    </div>
    <div class="cn-grid">
      <div class="cn-config">
        <div class="cn-panel">
          <h3>Формирование</h3>
          <div class="cn-field"><label>Название легиона / дивизии</label><input id="cn-name" placeholder="1-я Штурмовая Бригада" value="${esc(edit ? edit.name : '')}" oninput="cnDivName()"></div>
          <button class="btn btn-gh btn-fw" onclick="cnDivAddBlock()">+ Добавить отряд</button>
        </div>
        <div class="cn-panel">
          <h3>Состав</h3>
          <div id="cn-div-area"></div>
          <div class="cn-fac-hint">В списке «Тип войск» доступна и ★ зарегистрированная техника (своя + общедоступная) — она участвует во всех расчётах. Технику других игроков здесь не видно. Доступно техники: ${(CN.divUnits || []).length}.</div>
        </div>
      </div>
      <div class="cn-side">
        <div class="cn-panel cn-sticky">
          <h3>Сводка дивизии</h3>
          <div id="cn-stats"></div>
          <div class="cn-div-sum-title">Состав</div>
          <div id="cn-div-summary" class="cn-div-summary">Пусто</div>
          ${facBlock}
          <button class="btn btn-gd btn-fw" style="margin-top:12px" onclick="cnPublish()">${edit ? '💾 Сохранить изменения' : '✓ Опубликовать'}</button>
          <button class="btn btn-gh btn-fw" style="margin-top:8px" onclick="cnCopy(cnDivCardText())">📋 Копировать анкету</button>
        </div>
      </div>
    </div>
  </div>`);
  if (edit && cnId('cn-faction')) cnId('cn-faction').value = edit.faction_id || '';
  CN.snapDiv = null; CN._applyingDiv = false;
  if (edit && edit.data) { CN._applyingDiv = true; cnDivApplyData(edit.data); CN._applyingDiv = false; CN.snapDiv = cnDivCollectData(); }
  else cnDivTotals();
}
function cnDivName() { /* имя берётся при публикации; отдельного дисплея нет */ }
// Доступная для дивизий техника: своя (owner_id == me) + общедоступная (без фракции). Чужую не показываем.
async function cnLoadDivUnits() {
  let all = [];
  try { all = await dbGet('faction_units', 'order=updated_at.desc') || []; } catch (e) { all = []; }
  CN.divUnits = all.filter(u => u.category !== 'division' && ((user && u.owner_id === user.id) || !u.faction_id));
  return CN.divUnits;
}
// Габарит зарегистрированной техники в дивизии (на 1 ед.). Можно тонко настроить.
const CN_TECH_SIZE = { ship: 2000, ground: 200, aviation: 50 };
// Единый поиск модели: штатная (CN_DIV_DATA) или зарегистрированная техника ('tech:<id>')
function cnDivModelById(id) {
  if (!id) return null;
  if (id.indexOf('tech:') === 0) {
    const u = (CN.divUnits || []).find(x => x.id === id.slice(5));
    if (!u) return null;
    const sm = u.summary || {};
    return {
      id, name: u.name, type: 'tech', tech: true, public: cnIsPublic(u),
      cost: sm.cost || 0,
      size: CN_TECH_SIZE[u.category] || 200,
      armorhp: (sm.armor || 0) + (sm.hp || 0),
      atack: sm.dmg || 0,
      dalnost: sm.dalnost || 0,
      bill: sm.bill || {},
    };
  }
  return CN_DIV_DATA.find(m => m.id === id) || null;
}
function cnDivAddBlock(preset) {
  const area = cnId('cn-div-area');
  const div = document.createElement('div');
  div.className = 'cn-divblock cn-row';
  const types = CN_DIV_TYPES.slice();
  if ((CN.divUnits || []).length) types.push(['tech', '★ Зарегистрированная техника']);
  const typeOpts = `<option value="" disabled${preset ? '' : ' selected'}>Тип войск</option>` +
    types.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  div.innerHTML = `
    <select class="cn-d-type" onchange="cnDivTypeChange(this)">${typeOpts}</select>
    <select class="cn-d-model" onchange="cnDivTotals()"><option value="">Сначала выберите тип</option></select>
    <input type="number" class="cn-d-count" value="${preset ? (preset.count || 1) : 1}" min="1" oninput="cnDivTotals()">
    <button class="cn-del" onclick="this.closest('.cn-divblock').remove(); cnDivTotals();">✕</button>`;
  area.appendChild(div);
  if (preset && preset.type) {
    const ts = div.querySelector('.cn-d-type'); ts.value = preset.type;
    cnDivTypeChange(ts);
    if (preset.modelId) div.querySelector('.cn-d-model').value = preset.modelId;
  }
  cnDivTotals();
}
function cnDivTypeChange(sel) {
  const modelSel = sel.closest('.cn-divblock').querySelector('.cn-d-model');
  if (sel.value === 'tech') {
    const list = CN.divUnits || [];
    const cats = [['ship', 'Корабли'], ['ground', 'Наземная техника'], ['aviation', 'Авиация']];
    let html = '';
    cats.forEach(([c, lbl]) => {
      const items = list.filter(u => u.category === c);
      if (!items.length) return;
      html += `<optgroup label="${esc(lbl)}">` + items.map(u => {
        const sm = u.summary || {};
        return `<option value="tech:${esc(u.id)}">${esc(u.name)}${cnIsPublic(u) ? ' ★' : ''} — атк ${cnNum(sm.dmg || 0)} · бр ${cnNum((sm.armor || 0) + (sm.hp || 0))}</option>`;
      }).join('') + `</optgroup>`;
    });
    modelSel.innerHTML = html || '<option value="">Нет доступной техники</option>';
  } else {
    const models = CN_DIV_DATA.filter(m => m.type === sel.value);
    modelSel.innerHTML = models.length
      ? models.map(m => `<option value="${m.id}">${esc(m.name)} — атк ${m.atack} · бр ${m.armorhp} · дал ${m.dalnost}</option>`).join('')
      : '<option value="">Нет доступных моделей</option>';
  }
  cnDivTotals();
}
function cnDivTotals() {
  let cost = 0, size = 0, count = 0, sa = 0, st = 0, sd = 0, ma = 0, mt = 0, md = 0;
  const list = [], bill = {};
  document.querySelectorAll('#cn-div-area .cn-divblock').forEach(b => {
    const id = b.querySelector('.cn-d-model').value;
    const c = parseInt(b.querySelector('.cn-d-count').value) || 0;
    const m = cnDivModelById(id);
    if (m && c > 0) {
      list.push(`• ${m.name}${m.public ? ' ★' : ''} (${cnNum(c)} ед.)`);
      cost += m.cost * c; size += m.size * c;
      sa += (m.armorhp || 0) * c; st += (m.atack || 0) * c; sd += (m.dalnost || 0) * c; count += c;
      if (m.armorhp > ma) ma = m.armorhp; if (m.atack > mt) mt = m.atack; if (m.dalnost > md) md = m.dalnost;
      cnBillMerge(bill, m.bill, c);
    }
  });
  const percent = +(size / CN_DIV_CAP * 100).toFixed(1);
  const midA = count ? +(sa / count).toFixed(1) : 0, midT = count ? +(st / count).toFixed(1) : 0, midD = count ? +(sd / count).toFixed(1) : 0;
  CN.lastDiv = { cost, size, percent, count, midArmor: midA, maxArmor: ma, midAtk: midT, maxAtk: mt, midRange: midD, maxRange: md, bill };
  const over = size > CN_DIV_CAP;
  cnId('cn-stats').innerHTML = `
    <div class="cn-stat"><span>Стоимость</span><b style="color:var(--gd)">${cnNum(cost)} ГС</b></div>
    <div class="cn-stat"><span>Размер</span><b class="${over ? 'cn-warn' : ''}">${cnNum(size)} / ${cnNum(CN_DIV_CAP)}</b></div>
    <div class="cn-stat"><span>Занято</span><b class="${over ? 'cn-warn' : ''}">${percent} %</b></div>
    <div class="cn-stat"><span>Бронир. ср / макс</span><b>${midA} / ${cnNum(ma)}</b></div>
    <div class="cn-stat"><span>Атака ср / макс</span><b>${midT} / ${cnNum(mt)}</b></div>
    <div class="cn-stat"><span>Дальность ср / макс</span><b>${midD} / ${cnNum(md)}</b></div>
    ${Object.keys(bill).length ? `<div class="cn-stat cn-stat-bill"><span>Сырьё / дивизию</span><div class="cn-bill">${cnBillHtml(bill)}</div></div>` : ''}`;
  cnId('cn-div-summary').innerHTML = list.length ? list.join('<br>') : 'Пусто';
  // Жёсткий лимит размера: нельзя набрать сверх 10 000 — откатываем
  if (CN._applyingDiv) return;
  if (CN.lastDiv.size > CN_DIV_CAP) {
    if (CN.snapDiv) { CN._applyingDiv = true; cnDivApplyData(CN.snapDiv); CN._applyingDiv = false; toast('Размер дивизии превышает лимит ' + cnNum(CN_DIV_CAP) + ' — отменено', 'err'); }
  } else { CN.snapDiv = cnDivCollectData(); }
}
function cnDivCollectData() {
  return {
    blocks: [...document.querySelectorAll('#cn-div-area .cn-divblock')].map(b => ({
      type: b.querySelector('.cn-d-type').value,
      modelId: b.querySelector('.cn-d-model').value,
      count: parseInt(b.querySelector('.cn-d-count').value) || 1,
    })).filter(x => x.modelId),
  };
}
function cnDivApplyData(d) {
  cnId('cn-div-area').innerHTML = '';
  (d.blocks || []).forEach(b => cnDivAddBlock(b));
  cnDivTotals();
}
function cnDivCardText() {
  const name = (cnId('cn-name').value || '[Без названия]');
  const s = CN.lastDiv || {};
  const models = (cnId('cn-div-summary').innerText || 'Пусто');
  return `=== СВОДКА ДИВИЗИИ ===\n` +
    `1. Название: ${name}\n` +
    `2. Состав:\n${models}\n` +
    `------------------------\n` +
    `3. Общая стоимость: ${cnNum(s.cost)} ГС\n` +
    `4. Размер: ${cnNum(s.size)} / ${cnNum(CN_DIV_CAP)} (${s.percent}%)\n` +
    `5. Бронирование (ср/макс): ${s.midArmor} / ${cnNum(s.maxArmor)}\n` +
    `6. Атака (ср/макс): ${s.midAtk} / ${cnNum(s.maxAtk)}\n` +
    `7. Дальность (ср/макс): ${s.midRange} / ${cnNum(s.maxRange)}\n` +
    `------------------------\nСЫРЬЁ НА ДИВИЗИЮ:\n${cnBillText(s.bill)}`;
}

// ════════════════════════════════════════════════════════════
// ПУБЛИКАЦИЯ / ФРАКЦИЯ / КОПИРОВАНИЕ
// ════════════════════════════════════════════════════════════
async function cnFactionPublishBlock() {
  const mine = cnMyFactionMeta();
  // Стафф ВСЕГДА получает выбор фракции (даже если сам владеет одной) — чтобы
  // выдавать общедоступные/фракционные юниты-награды любому игроку.
  if (cnIsStaff()) {
    const facs = await cnLoadApprovedFactions();
    const myFid = mine && mine.faction_id;
    const opts = `<option value="">★ Общедоступная (для всех фракций)</option>` +
      facs.map(f => `<option value="${esc(f.faction_id || '')}" data-name="${esc(f.name || '')}" data-color="${esc(f.color || '')}">${esc(f.name || '—')}${myFid && f.faction_id === myFid ? ' (моя)' : ''}</option>`).join('');
    return `<div class="cn-fac-line"><label>Публиковать от фракции</label><select id="cn-faction" class="fi">${opts}</select>
      <div class="cn-fac-hint">«Общедоступная» — техника без фракции, доступна всем игрокам в конструкторе дивизий. Выберите фракцию, чтобы выдать юнит-награду только ей. ОН с казны не списываются.</div></div>`;
  }
  if (mine) return `<div class="cn-fac-line">От имени фракции: <b style="color:${esc(frReadable(mine.faction_color))}">${esc(mine.faction_name || '—')}</b></div>`;
  return '';
}
function cnResolveFactionForSave() {
  // У стаффа приоритет — выбор в селекторе (общедоступная / любая фракция).
  const sel = cnId('cn-faction');
  if (cnIsStaff() && sel) {
    const opt = sel.options[sel.selectedIndex];
    return { faction_id: sel.value || null, faction_name: opt?.dataset.name || '', faction_color: opt?.dataset.color || '' };
  }
  const mine = cnMyFactionMeta();
  if (mine) return mine;
  if (sel && sel.value) {
    const opt = sel.options[sel.selectedIndex];
    return { faction_id: sel.value || null, faction_name: opt?.dataset.name || '', faction_color: opt?.dataset.color || '' };
  }
  return { faction_id: null, faction_name: '', faction_color: '' };
}
function cnCatRoute(cat) { return { ship: 'cat-ships', ground: 'cat-ground', aviation: 'cat-aviation', division: 'cat-divisions' }[cat]; }

async function cnPublish() {
  if (CN.busy) return;
  await cnLoadMyFaction();
  if (!cnCanAccess()) { toast('Нет доступа к публикации', 'err'); return; }
  const name = (cnId('cn-name')?.value || '').trim();
  if (!name) { toast('Укажите название', 'err'); return; }
  const fac = cnResolveFactionForSave();
  let data, summary, card;
  if (CN.cat === 'division') {
    cnDivTotals();
    if (!cnId('cn-div-area').querySelector('.cn-divblock')) { toast('Добавьте хотя бы один отряд', 'err'); return; }
    if (CN.lastDiv.size > CN_DIV_CAP) { toast(`Размер дивизии ${cnNum(CN.lastDiv.size)} превышает лимит ${cnNum(CN_DIV_CAP)} — уберите лишнее`, 'err'); return; }
    data = cnDivCollectData(); summary = CN.lastDiv; card = cnDivCardText();
  } else {
    cnVehCalc();
    if (CN.last.energy && CN.last.eCons > CN.last.eMax) { toast(`Энергосеть перегружена: ${cnNum(CN.last.eCons)} E нужно, реактор даёт ${cnNum(CN.last.eMax)} E. Поставьте мощнее реактор или снимите системы`, 'err'); return; }
    if (CN.last.hangarOver) { toast('Ангар перегружен: авиагруппы превышают вместимость', 'err'); return; }
    // Старые проекты теперь МОЖНО редактировать даже «за лимитом» (откат отключён
    // для over-базы) — значит валидность держим на публикации.
    if (CN.last.kv && CN.last.kv.power < 0) { toast(`Энергосеть перегружена: не хватает ${cnNum(-CN.last.kv.power)} ⚡ — мощнее реактор или снимите системы`, 'err'); return; }
    if (CN.last.kv && CN.last.kv.cap < 0) { toast(`Перегруз: лишние ${cnNum(-CN.last.kv.cap)} ед. нагрузки — снимите компоненты`, 'err'); return; }
    const def = CN.def, k = cnId('cn-class').value, cls = def.db.data[k];
    const typeObj = def.hasType ? cls.types[+cnId('cn-type').value || 0] : null;
    data = cnVehCollectData();
    // Финальный заслон эксплойта: ни одно орудие/модуль не должно быть недоступно
    // выбранному классу (карта availW/availM + excl). Блокируем, а не молча правим.
    const forbidden = cnForbiddenParts(data.class, data);
    if (forbidden.length) { toast(`Классу «${esc(cls.name)}» нельзя ставить: ${forbidden.slice(0, 4).map(esc).join(', ')}${forbidden.length > 4 ? ' и др.' : ''} — снимите эти компоненты`, 'err'); return; }
    // Предел отсеков класса — тот же заслон: старый проект «за лимитом» правится,
    // но не публикуется, пока лишние модули не сняты.
    const gd = cnModGridDims(k), modCap = gd[0] * gd[1], modN = (data.modules || []).length;
    if (modN > modCap) { toast(`На плате класса «${esc(cls.name)}» ${modCap} ${cnPlural(modCap, 'ячейка', 'ячейки', 'ячеек')}, модулей ${modN} — снимите лишние`, 'err'); return; }
    summary = { ...CN.last, className: cls.name, typeName: typeObj ? typeObj.name : '' };
    card = cnVehCardText();
  }
  const isNew = !(CN.editUnit && CN.editUnit.id);
  // Цену/ОН/ведомость/ТТХ считает СЕРВЕР (economy_publish_unit) из data — клиентский
  // summary идёт только для предпросмотра. summary в тело запроса НЕ кладём.
  const onCost = (isNew && CN.cat !== 'division' && fac.faction_id && !cnIsStaff()) ? (summary.on || 0) : 0;
  if (onCost > 0) {
    const ecoRows = await dbGet('faction_economy', `faction_id=eq.${encodeURIComponent(fac.faction_id)}&select=science`);
    const curScience = (ecoRows && ecoRows[0] && ecoRows[0].science) || 0;
    if (curScience < onCost) { toast(`Недостаточно ОН для разработки: нужно ${onCost}, есть ${curScience}`, 'err'); return; }
  }

  // Единый армейский форж: в БД юнит уходит с реальной категорией (ground/aviation),
  // определяемой классом — контракт каталогов/исследований/SQL не меняется.
  const pubCat = CN.cat === 'army' ? cnKvRealCat(cnId('cn-class').value) : CN.cat;
  CN.busy = true;
  try {
    const res = await ecRpc('economy_publish_unit', {
      p_category: pubCat, p_name: name, p_data: data, p_card_text: card,
      p_faction_id: fac.faction_id || null, p_faction_name: fac.faction_name || null,
      p_faction_color: fac.faction_color || null,
      p_unit_id: (CN.editUnit && CN.editUnit.id) || null,
    });
    const row = (res && res.id) ? res : (Array.isArray(res) ? res[0] : res);
    if (row && row.id) CN.editUnit = row;
    const charged = row && row._on_charged;
    toast(isNew ? `Опубликовано ✓${charged ? ` · −${cnNum(charged)} ОН` : ''}` : 'Изменения сохранены ✓', 'ok');
    go(cnCatRoute(pubCat));
  } catch (e) { toast('Ошибка: ' + (e && e.message ? e.message : e), 'err'); }
  finally { CN.busy = false; }
}

function cnCopy(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Скопировано', 'ok'), () => cnCopyFallback(text));
  } else cnCopyFallback(text);
}
function cnCopyFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Скопировано', 'ok'); } catch (e) { toast('Не удалось скопировать', 'err'); }
  ta.remove();
}

// ════════════════════════════════════════════════════════════
// КАТАЛОГИ (#cat-ships / cat-ground / cat-aviation / cat-divisions)
// ════════════════════════════════════════════════════════════
const CN_CAT_META = {
  ship: { title: 'Флот', ico: '🚀', build: 'build-ship', empty: 'Ни одного корабля ещё не построено.' },
  ground: { title: 'Наземная техника', ico: '🛡', build: 'build-army', empty: 'Наземная техника ещё не создана.' },
  aviation: { title: 'Авиация', ico: '✈', build: 'build-army', empty: 'Авиапарк пока пуст.' },
  division: { title: 'Дивизии', ico: '⛬', build: 'build-division', empty: 'Дивизии ещё не сформированы.' },
};
CN.catFilter = '*';

function cnCanManage(u) { return !!(user && (cnIsStaff() || u.owner_id === user.id)); }
// Кто вообще видит юнит: администрация, владелец, своя фракция, либо общедоступный.
// Чужие фракционные юниты не показываются вовсе — иначе по карточкам в каталоге
// видно, у каких государств есть флот/техника, а это разведданные (чит).
function cnCanSeeUnit(u) {
  if (cnIsStaff()) return true;                          // администрация видит всё
  if (user && u.owner_id === user.id) return true;       // автор
  if (!u.faction_id) return true;                        // общедоступный — открыт всем
  const mine = cnMyFactionMeta();                        // член той же фракции
  return !!(mine && mine.faction_id && mine.faction_id === u.faction_id);
}
// Видимость чертежа/состава совпадает с видимостью самого юнита.
function cnCanSeeBlueprint(u) { return cnCanSeeUnit(u); }
function cnReadable(c) { return (typeof frReadable === 'function') ? frReadable(c) : (c || '#cfe3ff'); }
function cnIsPublic(u) { return !u.faction_id; }
function cnFacName(u) { return (u.faction_name && u.faction_name.trim()) ? u.faction_name : 'Общедоступная'; }

async function cnRenderCatalog(cat) {
  const meta = CN_CAT_META[cat];
  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);
  await cnLoadMyFaction();
  let units = [];
  try { units = await dbGet('faction_units', `category=eq.${cat}&order=updated_at.desc`) || []; }
  catch (e) { setPg(`<div class="cn-wrap"><div class="cn-head"><h1>${meta.ico} ${esc(meta.title)}</h1></div><div class="sempty">Ошибка загрузки: ${esc(e.message)}</div></div>`); return; }
  // Чужие фракционные юниты убираем целиком — каталог показывает только свои +
  // общедоступные (администрация видит всё). Иначе по карточкам видно чужой флот.
  units = units.filter(cnCanSeeUnit);
  CN.catUnits = units; CN.catCat = cat;
  if (CN.catFilter !== '*' && !units.some(u => (u.faction_id || '') === CN.catFilter)) CN.catFilter = '*';
  cnPaintCatalog();
}
function cnPaintCatalog() {
  const cat = CN.catCat, meta = CN_CAT_META[cat], units = CN.catUnits || [];
  // Дивизии: «+ Создать» скрыт — новые дивизии не проектируются (армии из юнитов),
  // существующие остаются в каталоге и годятся в армии.
  const canBuild = cat === 'division' ? cnIsStaff() : cnCanAccess();
  const facMap = new Map();
  units.forEach(u => { const key = u.faction_id || ''; if (!facMap.has(key)) facMap.set(key, { name: cnFacName(u), color: u.faction_color || '', n: 0 }); facMap.get(key).n++; });
  const chips = [`<button class="cn-chip-btn${CN.catFilter === '*' ? ' on' : ''}" onclick="cnCatFilter('*')">Все <i>${units.length}</i></button>`]
    .concat([...facMap.entries()].map(([key, f]) =>
      `<button class="cn-chip-btn${CN.catFilter === key ? ' on' : ''}" onclick="cnCatFilter('${esc(key)}')" style="--c:${esc(cnReadable(f.color))}">${esc(f.name)} <i>${f.n}</i></button>`)).join('');
  const shown = CN.catFilter === '*' ? units : units.filter(u => (u.faction_id || '') === CN.catFilter);
  const cards = shown.map(cnUnitCard).join('') || `<div class="sempty">${esc(meta.empty)}</div>`;
  setPg(`<div class="cn-wrap">
    <div class="cn-head cn-cat-head">
      <div><div class="cn-eyebrow">◈ КАТАЛОГ</div><h1>${meta.ico} ${esc(meta.title)}</h1></div>
      ${canBuild ? `<button class="btn btn-gd" onclick="go('${meta.build}')">+ Создать</button>` : ''}
    </div>
    <div class="cn-chips">${chips}</div>
    <div class="cn-cat-grid">${cards}</div>
  </div>`);
}
function cnCatFilter(key) { CN.catFilter = key; cnPaintCatalog(); }

function cnUnitCard(u) {
  const col = cnReadable(u.faction_color);
  const sm = u.summary || {};
  const ico = CN_CAT_META[u.category]?.ico || '◈';
  const manage = cnCanManage(u)
    ? `<div class="cn-card-acts">
         <button title="Редактировать" onclick="event.stopPropagation();cnEdit('${u.id}')">✎</button>
         <button title="Удалить" onclick="event.stopPropagation();cnDelete('${u.id}')">✕</button>
       </div>` : '';
  const cost = cnNum(sm.cost) + ' ГС';
  const icoHtml = (u.category === 'ship' && u.data && u.data.class)
    ? `<div class="cn-card-ico cn-card-ico-img">${cnImgTag(cnImgPath('ship', 'class', u.data.class), '')}</div>`
    : `<div class="cn-card-ico">${ico}</div>`;
  return `<article class="cn-card" style="--cc:${esc(col)}" onclick="cnViewUnit('${u.id}')">
    <header class="cn-card-top">
      ${icoHtml}
      <div class="cn-card-id">
        <div class="cn-card-name">${esc(u.name || 'Без названия')}</div>
        <div class="cn-card-fac">${esc(cnFacName(u))}</div>
      </div>
      ${manage}
    </header>
    <div class="cn-card-grid">${cnCardStats(u.category, sm)}</div>
    ${cnCardBill(sm.bill)}
    <footer class="cn-card-foot">
      <span class="cn-card-cost">${esc(cost)}</span>
      <span class="cn-card-more">Подробнее →</span>
    </footer>
  </article>`;
}
// Ключевые ТТХ карточки — компактная сетка «значение / подпись».
function cnCardStats(cat, sm) {
  sm = sm || {};
  const cell = (v, l, accent) => `<div class="cn-st${accent ? ' cn-st-a' : ''}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`;
  if (cat === 'division') {
    return cell(cnNum(sm.count), 'единиц')
      + cell(cnNum(sm.size) + ' / ' + cnNum(typeof CN_DIV_CAP !== 'undefined' ? CN_DIV_CAP : 10000), 'размер')
      + cell(cnNum(sm.maxAtk), 'атака ≤', true)
      + cell(cnNum(sm.maxArmor), 'броня ≤')
      + cell(cnNum(sm.maxRange), 'дальн. ≤')
      + cell((sm.percent != null ? sm.percent : 0) + '%', 'загрузка');
  }
  let out = cell(cnNum(sm.hp), 'прочность')
    + cell(cnNum(sm.dmg), 'урон', true)
    + cell(cnNum(sm.armor), 'броня');
  if (sm.shield) out += cell(cnNum(sm.shield), 'щит');
  if (sm.speed != null) out += cell(cnNum(sm.speed), 'скорость');
  if (sm.on != null) out += cell(sm.on, 'ОН');
  return out;
}
// Ресурсная ведомость на карточке (сырьё на постройку 1 ед.).
function cnCardBill(bill) {
  const keys = Object.keys(bill || {});
  if (!keys.length) return '';
  return `<div class="cn-card-bill">
    <div class="cn-card-bill-lbl">◇ Сырьё на постройку</div>
    <div class="cn-bill">${cnBillHtml(bill)}</div>
  </div>`;
}

// ── Просмотр юнита ──
function cnViewUnit(id) {
  const u = (CN.catUnits || []).find(x => x.id === id); if (!u) return;
  const col = cnReadable(u.faction_color);
  let ov = document.getElementById('cn-modal-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'cn-modal-ov'; ov.className = 'cn-modal-ov'; ov.onclick = e => { if (e.target === ov) cnCloseView(); }; document.body.appendChild(ov); }
  const sm = u.summary || {};
  const stats = cnCardStats(u.category, sm);
  const seeBp = cnCanSeeBlueprint(u);
  const isDiv = u.category === 'division';
  const spec = seeBp
    ? `<pre class="cn-spec">${esc(u.card_text || '')}</pre>`
    : `<div class="cn-spec cn-spec-locked">🔒 ${isDiv ? 'Состав дивизии засекречен' : 'Чертёж засекречен'}.<br><span style="opacity:.7">Доступно только владельцу фракции и администрации.</span></div>`;
  ov.innerHTML = `<div class="cn-modal" style="--cc:${esc(col)}">
    <button class="cn-modal-x" onclick="cnCloseView()">✕</button>
    <div class="cn-modal-bar" style="background:${esc(col)}"></div>
    <div class="cn-modal-name">${esc(u.name || 'Без названия')}</div>
    <div class="cn-card-fac" style="color:${esc(col)}">${esc(cnFacName(u))} · ${esc(CN_CAT_META[u.category]?.title || '')}</div>
    <div class="cn-card-grid cn-modal-grid">${stats}</div>
    ${cnCardBill(sm.bill)}
    ${spec}
    ${cnCanManage(u) ? `<div class="cn-modal-acts">
      <button class="btn btn-gh btn-sm" onclick="cnCloseView();cnEdit('${u.id}')">✎ Редактировать</button>
      <button class="btn btn-rd btn-sm" onclick="cnDelete('${u.id}')">✕ Удалить</button>
    </div>` : ''}
  </div>`;
  ov.classList.add('show');
}
function cnCloseView() { document.getElementById('cn-modal-ov')?.classList.remove('show'); }

function cnEdit(id) {
  const u = (CN.catUnits || []).find(x => x.id === id); if (!u) { toast('Не найдено', 'err'); return; }
  if (!cnCanManage(u)) { toast('Недостаточно прав', 'err'); return; }
  cnCloseView();
  CN.edit = u;
  go(CN_CAT_META[u.category]?.build || 'constructors');
}
async function cnDelete(id) {
  const u = (CN.catUnits || []).find(x => x.id === id); if (!u) return;
  if (!cnCanManage(u)) { toast('Недостаточно прав', 'err'); return; }
  // Проект с построенными юнитами удалять нельзя: экземпляры остаются в составе
  // без ТТХ (караван считает такой корабль эскортом, списание идёт без возврата).
  // Сервер это же режет триггером _faction_unit_delete_guard — здесь только
  // ранняя, объяснимая остановка, чтобы не ловить сырую ошибку базы.
  let inService = 0;
  try {
    const rows = await dbGet('unit_production', `unit_id=eq.${id}&select=qty`) || [];
    inService = rows.reduce((a, r) => a + (+r.qty || 0), 0);
  } catch (e) {}
  if (inService > 0) {
    toast(`Нельзя удалить: ${inService} ед. этого проекта в составе или в очереди. Сначала спишите их (Экономика → Вооружённые силы → карточка юнита → «Списать из состава»).`, 'err');
    return;
  }
  if (!confirm('Удалить «' + (u.name || 'юнит') + '» безвозвратно?')) return;
  try {
    await dbDel('faction_units', 'id=eq.' + id);
    CN.catUnits = (CN.catUnits || []).filter(x => x.id !== id);
    cnCloseView();
    toast('Удалено', 'inf');
    cnPaintCatalog();
  } catch (e) {
    const m = String(e.message || '');
    toast(m.includes('design in service')
      ? 'Нельзя удалить: юниты этого проекта ещё в составе — сначала спишите их.'
      : 'Ошибка: ' + m, 'err');
  }
}
