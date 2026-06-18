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
  { slug: 'build-ground', ico: '🛡', name: 'Завод тяжёлого машиностроения', desc: 'Наземная техника: БТР, танки, САУ, шагоходы. Ходовая, броня, орудия.', cat: 'ground' },
  { slug: 'build-aviation', ico: '✈', name: 'Аэрокосмический цех', desc: 'Авиация: истребители, бомбардировщики, шаттлы. Микрореактор, авионика, подвесы.', cat: 'aviation' },
  { slug: 'build-division', ico: '⛬', name: 'Конструктор дивизий', desc: 'Формирование армий из пехоты, танков, артиллерии и авиации в составе дивизии.', cat: 'division' },
];

async function cnRenderHub() {
  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);
  await cnLoadMyFaction();
  if (!cnCanAccess()) { cnGate(); return; }
  const fac = cnMyFactionMeta();
  const facLine = fac
    ? `<div class="cn-hub-faction">От имени фракции: <b style="color:${esc(frReadable(fac.faction_color))}">${esc(fac.faction_name || '—')}</b></div>`
    : cnIsStaff() ? `<div class="cn-hub-faction">Режим администрации — фракция выбирается при публикации.</div>` : '';
  const cards = CN_HUB.map(h => `<div class="cn-hub-card" onclick="go('${h.slug}')">
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
const CN_DEFS = {
  ship: {
    cat: 'ship', db: CN_SHIP, title: 'Корабельная верфь', subtitle: 'Project Shipyard — космический флот',
    nameLabel: 'Название корабля', classLabel: 'Класс корпуса', engineLabel: 'Двигательная установка',
    hasType: true, hasReactor: true, hasEnergy: true, hasHangars: true, cardUI: true,
    excl: (k, g) => (k === 'corvette' && (g === 'Тяжёлые' || g === 'Сверхтяжёлые')) || ((k === 'frigate' || k === 'destroyer') && g === 'Сверхтяжёлые'),
  },
  ground: {
    cat: 'ground', db: CN_GROUND, title: 'Завод тяжёлого машиностроения', subtitle: 'GroundForge — наземная техника',
    nameLabel: 'Серийное название модели', classLabel: 'Класс техники', engineLabel: 'Ходовая часть',
    hasType: false, hasReactor: false, hasEnergy: false, hasHangars: false,
    excl: (k, g) => (k === 'light' && g === 'Артиллерия и ПВО'),
  },
  aviation: {
    cat: 'aviation', db: CN_AIR, title: 'Аэрокосмический сборочный цех', subtitle: 'AeroForge — авиация',
    nameLabel: 'Позывной / Название модели', classLabel: 'Весовая категория', engineLabel: 'Маршевые двигатели',
    hasType: true, hasReactor: true, hasEnergy: true, hasHangars: false,
    excl: (k, g) => (k === 'light' && g === 'Ракетное и бомбовое'),
  },
};

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
// ASCII-слаги групп оружия/модулей (для имён файлов картинок — без кириллицы)
const CN_GROUP_SLUG = {
  ship: {
    weapon: { 'Легкие': 'light', 'Средние': 'medium', 'Тяжёлые': 'heavy', 'Сверхтяжёлые': 'superheavy', 'Ракетное': 'missile', 'Зенитное': 'aa' },
    module: { 'Радарное оборудование': 'radar', 'Радиоэлектронная борьба': 'ew', 'Активная защита': 'activedef', 'Управление': 'control', 'Спец. системы': 'special' },
  },
};
function cnGroupSlug(cat, type, group) { return ((CN_GROUP_SLUG[cat] || {})[type] || {})[group] || 'x'; }

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
function cnDesc(cat, kind, key, idx) {
  const d = (CN_DESC[cat] || {})[kind]; if (!d) return '';
  if (Array.isArray(d)) return d[key] || '';            // hangar/airunit: key = индекс
  const v = d[key];
  if (Array.isArray(v)) return (idx != null ? v[idx] : '') || '';
  return v || '';
}

// ── Карточки компонентов ──
function cnChip(label, val) { return `<span class="cn-chip"><i>${esc(label)}</i>${esc(val)}</span>`; }
function cnSlotStatChips(slot, obj, def) {
  if (!obj) return '';
  const E = def.hasEnergy;
  switch (slot) {
    case 'class': return cnChip('база ОН', obj.baseON) + cnChip('ОН/модуль', '+' + obj.modON);
    case 'type': return cnChip('HP', cnNum(obj.hp)) + cnChip('броня', cnNum(obj.armor)) + cnChip('ГС', cnNum(obj.cost));
    case 'reactor': return cnChip('энергия', cnNum(obj.energy) + ' E') + cnChip('ГС', cnNum(obj.cost));
    case 'armor': return cnChip('броня', '+' + cnNum(obj.armor)) + cnChip('ГС', cnNum(obj.cost));
    case 'shield': return cnChip('щит', obj.shield ? cnNum(obj.shield) : 'нет') + (E && obj.energy ? cnChip('E', cnNum(obj.energy)) : '') + cnChip('ГС', cnNum(obj.cost));
    case 'engine': return cnChip('скорость', obj.speed + ' у.е.') + (E && obj.energy ? cnChip('E', cnNum(obj.energy)) : '') + cnChip('ГС', cnNum(obj.cost));
  }
  return '';
}
// ── Дескриптор компонента: объект данных + путь картинки + описание ──
const CN_SLOT_TITLE = { class: 'Выбор корпуса', type: 'Выбор специализации', reactor: 'Выбор реактора', armor: 'Выбор бронирования', shield: 'Выбор щитового модуля', engine: 'Выбор двигателя' };
function cnCompInfo(kind, key, idx) {
  const def = CN.def, db = def.db, cat = CN.cat, k = cnId('cn-class').value;
  let obj, imgPath, desc;
  switch (kind) {
    case 'class':   obj = db.data[key];          imgPath = cnImgPath(cat, 'class', key);       desc = cnDesc(cat, 'class', key); break;
    case 'type':    obj = db.data[k].types[idx]; imgPath = cnImgPath(cat, 'type', k, idx);      desc = cnDesc(cat, 'type', k, idx); break;
    case 'reactor': obj = db.reactors[k][idx];   imgPath = cnImgPath(cat, 'reactor', k, idx);   desc = cnDesc(cat, 'reactor', k, idx); break;
    case 'armor':   obj = db.armors[k][idx];     imgPath = cnImgPath(cat, 'armor', k, idx);     desc = cnDesc(cat, 'armor', k, idx); break;
    case 'shield':  obj = db.shields[k][idx];    imgPath = cnImgPath(cat, 'shield', k, idx);    desc = cnDesc(cat, 'shield', k, idx); break;
    case 'engine':  obj = db.engines[k][idx];    imgPath = cnImgPath(cat, 'engine', k, idx);    desc = cnDesc(cat, 'engine', k, idx); break;
    case 'weapon':  obj = db.weapons[key][idx];  imgPath = cnImgPath(cat, 'weapon', cnGroupSlug(cat, 'weapon', key), idx); desc = cnDesc(cat, 'weapon', key, idx); break;
    case 'module':  obj = db.modules[key][idx];  imgPath = cnImgPath(cat, 'module', cnGroupSlug(cat, 'module', key), idx); desc = cnDesc(cat, 'module', key, idx); break;
    case 'hangar':  obj = db.hangarTypes.find(h => h.id == key); imgPath = cnImgPath(cat, 'hangar', key); desc = cnDesc(cat, 'hangar', +key); break;
    case 'airunit': obj = db.airUnits[idx];      imgPath = cnImgPath(cat, 'airunit', idx);      desc = cnDesc(cat, 'airunit', idx); break;
  }
  return { kind, key, idx, k, obj, imgPath, desc };
}
// Полный список характеристик ИЗ ДАННЫХ (всё, что есть в коде по компоненту)
function cnCompStatsRows(info) {
  const o = info.obj, E = CN.def.hasEnergy, rows = [], push = (l, v) => rows.push([l, v]);
  switch (info.kind) {
    case 'class':   push('База ОН', o.baseON); push('ОН за модуль', '+' + o.modON); if (o.types) push('Специализаций', o.types.length); break;
    case 'type':    push('Прочность', cnNum(o.hp) + ' HP'); push('Броня корпуса', '+' + cnNum(o.armor) + ' AR'); push('Цена', cnNum(o.cost) + ' ГС'); break;
    case 'reactor': push('Выработка энергии', cnNum(o.energy) + ' E'); push('Цена', cnNum(o.cost) + ' ГС'); break;
    case 'armor':   push('Броня', '+' + cnNum(o.armor) + ' AR'); push('Цена', cnNum(o.cost) + ' ГС'); break;
    case 'shield':  push('Щит', o.shield ? cnNum(o.shield) + ' ед.' : 'нет'); if (E) push('Потребление', cnNum(o.energy || 0) + ' E'); push('Цена', cnNum(o.cost) + ' ГС'); break;
    case 'engine':  push('Скорость', o.speed + ' у.е.'); if (E) push('Потребление', cnNum(o.energy || 0) + ' E'); push('Цена', cnNum(o.cost) + ' ГС'); break;
    case 'weapon':  push('Урон', cnNum(o.dmg)); if (E) push('Потребление', cnNum(o.energy || 0) + ' E'); push('Цена', cnNum(o.cost) + ' ГС'); break;
    case 'module':  if (E && o.energy) push('Потребление', cnNum(o.energy) + ' E'); push('Цена', cnNum(o.cost) + ' ГС'); break;
    case 'hangar':  push('Вместимость', o.capacity + ' очк.'); push('Потребление', cnNum(o.energy) + ' E'); push('Цена', cnNum(o.cost) + ' ГС'); push('Авиагруппы', o.canHaveUnits ? 'да' : 'нет (груз)'); break;
    case 'airunit': push('Очки в ангаре', o.points); break;
  }
  return rows.map(([l, v]) => `<div class="cn-info-row"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('');
}
// Вклад компонента в ресурсную ведомость (сырьё) — через общий расчёт cnUnitBill
function cnPartBill(info) {
  const cat = CN.cat, k = info.k, o = info.obj;
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
  return `<div class="cn-info-card${on ? ' on' : ''}${locked ? ' locked' : ''}"${(action && !locked) ? ` onclick="${action}"` : ''}>
    ${cnImgTag(info.imgPath, 'cn-info-img')}
    <div class="cn-info-body">
      <div class="cn-info-nm">${locked ? '🔒 ' : ''}${esc(info.obj.name)}${on ? ' <span class="cn-info-cur">установлено</span>' : ''}</div>
      <div class="cn-info-stats">${cnCompStatsRows(info)}</div>
      ${billHtml}
      <div class="cn-info-desc">${esc(info.desc || '…')}</div>
      ${action ? (locked ? `<div class="cn-info-pick cn-info-lk">Требует исследования</div>` : `<div class="cn-info-pick">${on ? '✓ выбрано' : 'Выбрать ▸'}</div>`) : ''}
    </div>
  </div>`;
}
function cnInfoModal(title, body) {
  let ov = document.getElementById('cn-info-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'cn-info-ov'; ov.className = 'cn-modal-ov'; ov.onclick = e => { if (e.target === ov) cnCloseInfo(); }; document.body.appendChild(ov); }
  ov.innerHTML = `<div class="cn-modal cn-pick-modal"><button class="cn-modal-x" onclick="cnCloseInfo()">✕</button><div class="cn-modal-name">${esc(title)}</div><div class="cn-info-grid">${body}</div></div>`;
  ov.classList.add('show');
}
function cnCloseInfo() { document.getElementById('cn-info-ov')?.classList.remove('show'); }

// Компактный чип ТЕКУЩЕГО выбора слота в шапке полотна (клик → модалка выбора)
const CN_SLOT_SHORT = { class: 'Корпус', type: 'Специализация', reactor: 'Реактор', engine: 'Двигатель', armor: 'Броня', shield: 'Щит' };
function cnSlotSelected(slot) {
  const def = CN.def; if (!def || !def.cardUI) return;
  const wrap = cnId('cn-' + slot + '-cards'), sel = cnId('cn-' + slot);
  if (!wrap || !sel) return;
  const info = slot === 'class' ? cnCompInfo('class', sel.value) : cnCompInfo(slot, null, +sel.value);
  if (!info.obj) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<button class="cn-slot-chip" onclick="cnOpenSlotPicker('${slot}')">
    <span class="cn-slot-lbl">${CN_SLOT_SHORT[slot] || slot}</span>
    <span class="cn-slot-val">${esc(info.obj.name)}</span>
  </button>`;
}
// Модалка выбора компонента слота (полные карточки; гейт по исследованиям)
function cnOpenSlotPicker(slot) {
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
// path — силуэт (viewBox 0 0 320 440, нос вверх); mounts — узлы подвеса орудий;
// engine [x,y] — точка сопел; shield [cx,cy,rx,ry] — контур щита; nose — y начала осевой.
const CN_SHIP_GEO = {
  corvette:    { path: "M160,70 L192,160 L202,250 L184,320 L136,320 L118,250 L128,160 Z", nose: 96,  engine: [160, 320], shield: [160, 205, 92, 150],  maxHW: 44, y0: 118, y1: 300, rows: 5 },
  frigate:     { path: "M160,55 L196,150 L208,255 L190,340 L130,340 L112,255 L124,150 Z", nose: 84,  engine: [160, 340], shield: [160, 205, 100, 170], maxHW: 48, y0: 108, y1: 324, rows: 6 },
  destroyer:   { path: "M160,46 L188,150 L196,270 L182,360 L138,360 L124,270 L132,150 Z", nose: 78,  engine: [160, 360], shield: [160, 210, 88, 178],  maxHW: 36, y0: 106, y1: 342, rows: 7 },
  cruiser:     { path: "M160,46 L205,140 L226,255 L208,355 L112,355 L94,255 L115,140 Z", nose: 80,  engine: [160, 355], shield: [160, 215, 124, 192], maxHW: 64, y0: 106, y1: 334, rows: 7 },
  battleship:  { path: "M160,38 L210,135 L234,260 L214,372 L106,372 L86,260 L110,135 Z", nose: 74,  engine: [160, 372], shield: [160, 218, 132, 200], maxHW: 74, y0: 100, y1: 354, rows: 8 },
  dreadnought: { path: "M160,30 L218,130 L246,270 L222,388 L98,388 L74,270 L102,130 Z", nose: 66,  engine: [160, 388], shield: [160, 222, 142, 212], maxHW: 84, y0: 96, y1: 374, rows: 9 },
};
// Профиль полуширины корпуса (нос→корма) для расстановки узлов подвеса
const CN_HULL_PROF = [[0, 0.30], [0.25, 0.86], [0.55, 1], [0.8, 0.9], [1, 0.62]];
function cnProf(t) { const p = CN_HULL_PROF; for (let i = 1; i < p.length; i++) { if (t <= p[i][0]) { const a = p[i - 1], b = p[i]; return a[1] + (b[1] - a[1]) * ((t - a[0]) / (b[0] - a[0] || 1)); } } return p[p.length - 1][1]; }
// Узлы подвеса — пары по бортам (центр свободен под отсеки-модули).
// rows растёт автоматически под число орудий → узлов всегда хватает.
function cnGenMounts(g, rows) {
  rows = rows || g.rows;
  const out = [];
  for (let r = 0; r < rows; r++) {
    const t = rows === 1 ? 0.5 : r / (rows - 1);
    const y = Math.round(g.y0 + t * (g.y1 - g.y0)), hw = g.maxHW * cnProf(t);
    if (hw < 16) { out.push([160, y]); continue; }       // узкий нос — узел по центру
    const off = Math.round(hw * 0.6);
    out.push([160 - off, y], [160 + off, y]);             // борта
    if (hw > 52) out.push([160, y]);                      // широкий корпус — ещё и центр
  }
  return out;
}
function cnMountsFor(g, need) {
  let rows = g.rows, m = cnGenMounts(g, rows);
  while (m.length < need && rows < 22) { rows++; m = cnGenMounts(g, rows); }
  return m;
}
// Визуал орудия: форма по группе (пушка/ракеты/ПВО), размер по калибру, цвет по боеприпасу.
function cnWpnVisual(g, name) {
  const kind = cnWpnResKind(name);
  const color = kind === 'energy' ? 'var(--te)' : kind === 'missile' ? 'var(--err)' : 'var(--t2)';
  const wt = { 'Легкие': 0.8, 'Средние': 1.0, 'Тяжёлые': 1.25, 'Сверхтяжёлые': 1.5, 'Ракетное': 1.0, 'Зенитное': 0.75 }[g] || 1;
  const shape = g === 'Ракетное' ? 'missile' : g === 'Зенитное' ? 'aa' : 'gun';
  return { color, wt, shape };
}
function cnTurretSvg(m, vis) {
  const x = m[0], y = m[1], s = vis.wt, c = vis.color;
  if (vis.shape === 'missile') { const w = 8 * s, h = 11 * s; return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="1.5" fill="${c}"/><line x1="${x}" y1="${y - h / 2}" x2="${x}" y2="${y + h / 2}" stroke="var(--b1)" stroke-width="0.8"/>`; }
  if (vis.shape === 'aa') { return `<circle cx="${x}" cy="${y}" r="${3.2 * s}" fill="${c}"/><line x1="${x}" y1="${y}" x2="${x - 5 * s}" y2="${y - 6 * s}" stroke="${c}" stroke-width="${1.4 * s}"/><line x1="${x}" y1="${y}" x2="${x + 5 * s}" y2="${y - 6 * s}" stroke="${c}" stroke-width="${1.4 * s}"/>`; }
  const r = 3.6 * s, bl = 10 * s, bw = 2.6 * s; return `<rect x="${x - bw / 2}" y="${y - bl}" width="${bw}" height="${bl}" rx="1" fill="${c}"/><circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
}
// Маркер модуля (контурные значки золотым) по группе.
function cnModuleMarker(g, x, y) {
  const c = 'var(--gd)';
  if (g === 'Радарное оборудование') return `<path d="M${x - 5},${y + 2} A5,5 0 0,1 ${x + 5},${y + 2} Z" fill="none" stroke="${c}" stroke-width="1.3"/>`;
  if (g === 'Радиоэлектронная борьба') return `<line x1="${x}" y1="${y + 4}" x2="${x}" y2="${y - 5}" stroke="${c}" stroke-width="1.3"/><circle cx="${x}" cy="${y - 6}" r="1.7" fill="${c}"/>`;
  if (g === 'Активная защита') return `<path d="M${x},${y - 5} L${x + 4},${y - 2} L${x + 4},${y + 3} L${x},${y + 5} L${x - 4},${y + 3} L${x - 4},${y - 2} Z" fill="none" stroke="${c}" stroke-width="1.2"/>`;
  if (g === 'Управление') return `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" rx="1" fill="none" stroke="${c}" stroke-width="1.2"/>`;
  return `<path d="M${x},${y - 5} L${x + 5},${y} L${x},${y + 5} L${x - 5},${y} Z" fill="none" stroke="${c}" stroke-width="1.2"/>`;
}
function cnHullHero() { cnDrawShip(); }

// ── Геометрия размещения ──
function cnHullHalf(H, y) { const t = Math.max(0, Math.min(1, (y - H.nose) / (H.engine[1] - H.nose))); return H.maxHW * cnProf(t); }
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
function cnHullRooms(H, count) {
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
function cnScalePathX(d, sx, cx) { return cnPathPoly(d).map((p, i) => (i ? 'L' : 'M') + (cx + (p[0] - cx) * sx).toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + 'Z'; }
function cnTypeGeo(H, cls, tIdx) {
  if (!cls.types || cls.types.length < 2) return H;
  const ms = cls.types.map(t => (t.hp || 0) + (t.armor || 0) * 2);
  const lo = Math.min(...ms), hi = Math.max(...ms), r = hi > lo ? ((ms[tIdx] || ms[0]) - lo) / (hi - lo) : 0.5;
  const wf = 0.84 + r * 0.32;
  const Hs = Object.assign({}, H);
  Hs.path = cnScalePathX(H.path, wf, 160);
  Hs.maxHW = H.maxHW * wf;
  Hs.shield = [H.shield[0], H.shield[1], H.shield[2] * wf, H.shield[3]];
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
// Масштаб пути относительно точки (для конформной оболочки щита)
function cnScaleAbout(d, s, cx, cy) { return cnPathPoly(d).map((p, i) => (i ? 'L' : 'M') + (cx + (p[0] - cx) * s).toFixed(1) + ',' + (cy + (p[1] - cy) * s).toFixed(1)).join(' ') + 'Z'; }
function cnPolyDots(poly, spacing) {
  const pts = [];
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1], steps = Math.max(1, Math.round(Math.hypot(dx, dy) / spacing)); for (let s = 0; s < steps; s++) { const t = s / steps; pts.push([a[0] + dx * t, a[1] + dy * t]); } }
  return pts;
}
// ЩИТ: КОНФОРМНАЯ оболочка по силуэту корпуса (а не огромный эллипс). 3 стиля по типу.
function cnShieldSvg(H, sIdx, rt) {
  const midY = (H.nose + H.engine[1]) / 2, sf = 1.1 + 0.12 * rt;
  const col = sIdx === 0 ? 'var(--te)' : sIdx === 1 ? 'var(--gd)' : 'var(--t2)', op = 0.3 + 0.2 * rt;
  const env = s => cnScaleAbout(H.path, s, 160, midY);
  
  if (sIdx === 0) {                       // Дефлекторный — тонкий купол с легким внутренним бликом
    return `<path d="${env(sf)}" fill="color-mix(in srgb, ${col} 4%, transparent)" stroke="${col}" stroke-width="${(1.2 + rt * 0.8).toFixed(1)}" stroke-linejoin="round" opacity="${op.toFixed(2)}"/>`
      + `<path d="${env(sf - 0.03)}" fill="none" stroke="${col}" stroke-width="0.6" stroke-linejoin="round" opacity="${(op * 0.4).toFixed(2)}"/>`;
  }
  if (sIdx === 1) {                       // Энергетический — пунктирный двойной контур
    return `<path d="${env(sf)}" fill="none" stroke="${col}" stroke-width="1.4" stroke-linejoin="round" opacity="${op.toFixed(2)}"/>`
      + `<path d="${env(sf - 0.05)}" fill="none" stroke="${col}" stroke-width="0.8" stroke-dasharray="6 4" stroke-linejoin="round" opacity="${(op * 0.7).toFixed(2)}"/>`;
  }
  const dots = cnPolyDots(cnPathPoly(env(sf)), 14 - rt * 4), c = (1.0 + rt * 0.6).toFixed(1);   // Корпускулярный — редкие точки по орбите
  return dots.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${c}" fill="${col}" opacity="${(op * 1.5).toFixed(2)}"/>`).join('');
}

// Живая схема корабля вид сверху — рисуется из CN.shipLayout, без картинок.
function cnDrawShip() {
  if (CN.cat !== 'ship' || !CN.def || !CN.def.cardUI) return;
  const host = cnId('cn-schematic'); if (!host) return;
  if (!CN.shipLayout) CN.shipLayout = { mounts: [], bays: [] };
  if (!CN.schemShow) CN.schemShow = { weapons: true, bays: true };
  const db = CN.def.db, k = cnId('cn-class').value, cls = db.data[k];
  const H0 = CN_SHIP_GEO[k] || CN_SHIP_GEO.corvette;
  const tIdx = +(cnId('cn-type') || {}).value || 0;
  const H = cnTypeGeo(H0, cls, tIdx);     // силуэт зависит от подкласса (ширина по «массе»)
  CN.shipGeo = H;                          // храним актуальную геометрию для drag-обработчика узлов
  const armorObj = db.armors[k][+cnId('cn-armor').value || 0];
  const shieldObj = db.shields[k][+cnId('cn-shield').value || 0];
  const engObj = db.engines[k][+cnId('cn-engine').value || 0];
  const e = H.engine, P = [], L = CN.shipLayout;

  // ЩИТ — три разных стиля поля по типу + размер/насыщенность по силе
  if (shieldObj && shieldObj.shield > 0) {
    const sIdx = +cnId('cn-shield').value || 0;
    const maxSh = Math.max(...db.shields[k].map(x => x.shield)) || 1, rt = Math.min(1, shieldObj.shield / maxSh);
    P.push(cnShieldSvg(H, sIdx, rt));
  }

  // ДВИГАТЕЛЬ — число дюз и тип (ион/плазма) из выбранного двигателя
  P.push(cnEngineSvg(H, engObj));

  // КОРПУС + бронепояс (толщина пояса/обводки зависит от брони)
  const maxAr = Math.max(...db.armors[k].map(a => a.armor)) || 1, aRt = (armorObj ? armorObj.armor : 0) / maxAr;
  const sw = (1.8 + aRt * 4.5).toFixed(1), beltS = +(1 - (0.035 + aRt * 0.14)).toFixed(3), midY = (H.nose + e[1]) / 2;
  P.push(`<path d="${H.path}" fill="color-mix(in srgb, var(--gd) 30%, var(--b2))" stroke="var(--gd)" stroke-width="${sw}" stroke-linejoin="round"/>`);
  P.push(`<path d="${H.path}" fill="var(--b1)" stroke="none" transform="translate(${(160 * (1 - beltS)).toFixed(2)} ${(midY * (1 - beltS)).toFixed(2)}) scale(${beltS})"/>`);

  // ВНУТРЕННИЕ ОТСЕКИ (аккуратная разбивка пространства) + модули в них
  let modCount = 0; const bayN = L.bays.length;
  if (CN.schemShow.bays) {
    const baseRooms = Math.max(5, Math.round((e[1] - H.nose) / 40));
    const rooms = cnHullRooms(H, Math.max(baseRooms, bayN));
    rooms.forEach((rm, i) => {
      const active = i < bayN, m = active && L.bays[i] && L.bays[i].m; if (m) modCount++;
      const pts = rm.poly.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      const fill = m ? 'color-mix(in srgb, var(--gd) 20%, transparent)' : 'transparent';   // transparent = кликабельна вся комната
      const stroke = m ? 'var(--gd)' : active ? 'var(--t3)' : 'var(--w2)';
      const title = m ? 'Модуль: ' + esc(db.modules[m.g][m.idx].name) : active ? 'Пустой отсек — нажми: поставить модуль или удалить' : 'Внутреннее пространство — нажми, чтобы сделать отсек';
      P.push(`<g class="cn-bay" style="cursor:pointer" onclick="${active ? `cnNodeClick('bay',${i})` : `cnRoomAddAt(${i})`}"><title>${title}</title><polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${active ? 1.2 : 0.6}" stroke-dasharray="${active && !m ? '3 2' : '0'}" opacity="${active ? 0.95 : 0.4}"/>${m ? cnModuleMarker(L.bays[i].m.g, rm.cx, rm.cy) : ''}</g>`);
    });
  }

  // АНГАРЫ — чёрточки-выходы на броне (их может быть много); авиа = метка наружу
  const hangars = [];
  document.querySelectorAll('#cn-hangars .cn-hangar').forEach(hp => { hangars.push({ id: +hp.querySelector('.cn-h-type').value, units: [...hp.querySelectorAll('.cn-u-type')].map(u => +u.value) }); });
  const hRows = Math.ceil(hangars.length / 2) || 1;
  hangars.forEach((h, i) => {
    const side = i % 2 === 0 ? -1 : 1, t = (Math.floor(i / 2) + 0.5) / hRows;
    const y = Math.round(H.nose + (e[1] - H.nose) * (0.18 + 0.64 * t)), hw = cnHullHalf(H, y), edge = 160 + side * hw, has = h.units.length > 0;
    P.push(`<g class="cn-bay"><title>Ангар: ${esc((db.hangarTypes.find(x => x.id == h.id) || {}).name || '')}${has ? ' · авиагрупп: ' + h.units.length : ''}</title><line x1="${(edge - side * 4).toFixed(1)}" y1="${y}" x2="${(edge + side * 7).toFixed(1)}" y2="${y}" stroke="var(--te)" stroke-width="${has ? 2.6 : 1.6}" opacity="0.92"/>${has ? `<polygon points="${(edge + side * 10).toFixed(1)},${y - 3} ${(edge + side * 16).toFixed(1)},${y} ${(edge + side * 10).toFixed(1)},${y + 3}" fill="var(--te)" opacity="0.85"/>` : ''}</g>`);
  });

  // УЗЛЫ ОРУДИЙ (борта), кликабельны
  let wpnCount = 0;
  const maxMounts = Math.max(16, L.mounts.length);
  const wpnMounts = cnMountPositions(H, maxMounts);
  if (CN.schemShow.weapons) wpnMounts.forEach((m, i) => {
    const slot = L.mounts[i], active = i < L.mounts.length, w = active && slot && slot.w;
    // активный узел можно таскать → используем его сохранённую позицию (slot.pos), иначе авто-место
    const p = (active && slot && slot.pos) ? [slot.pos.x, slot.pos.y] : m;
    if (w) {
      wpnCount++; const item = db.weapons[w.g][w.idx], vis = cnWpnVisual(w.g, item.name);
      P.push(`<g style="cursor:grab" onpointerdown="cnMountPointerDown(event,${i})"><title>${esc(item.name)} · тащи, чтобы переместить · клик — настроить</title>${cnTurretSvg(p, vis)}</g>`);
    }
    else if (active) {
      P.push(`<g style="cursor:grab" onpointerdown="cnMountPointerDown(event,${i})"><title>Пустой узел — тащи, чтобы переместить · клик — поставить орудие или удалить</title><circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="var(--b2)" stroke="var(--t3)" stroke-width="1.2" stroke-dasharray="2 2" opacity="0.9"/></g>`);
    }
    else {
      P.push(`<g style="cursor:pointer" onclick="cnMountAddAt(${i})"><title>Свободное место — нажми, чтобы добавить узел орудия</title><circle cx="${m[0]}" cy="${m[1]}" r="4.5" fill="var(--b2)" stroke="var(--w2)" stroke-width="0.6" opacity="0.4"/></g>`);
    }
  });

  host.innerHTML = `<svg viewBox="50 40 420 240" class="cn-schem-svg" role="img" aria-label="Схема корабля вид сверху (горизонтально)"><g id="cn-schem-g" transform="translate(470,0) rotate(90)">${P.join('')}</g></svg>`;

  // Мобильный список слотов: SVG-узлы (r≈4.5px) на телефоне почти неподжимаемы —
  // дублируем их крупными тач-строками (CSS показывает список только на coarse-указателе).
  const listHost = cnId('cn-schem-list');
  if (listHost) {
    const rows = [];
    if (CN.schemShow.weapons) L.mounts.forEach((slot, i) => {
      const w = slot && slot.w, item = w ? db.weapons[w.g][w.idx] : null;
      rows.push(cnSlotRow('mount', i, '◎', 'Узел орудия ' + (i + 1), item ? esc(item.name) : 'Пусто — поставить орудие', !!item));
    });
    if (CN.schemShow.bays) L.bays.forEach((slot, i) => {
      const m = slot && slot.m, item = m ? db.modules[m.g][m.idx] : null;
      rows.push(cnSlotRow('bay', i, '▦', 'Отсек ' + (i + 1), item ? esc(item.name) : 'Пусто — поставить модуль', !!item));
    });
    listHost.innerHTML = rows.length ? rows.join('') : `<div class="cn-bill-none" style="padding:8px 2px">Нет узлов и отсеков — добавьте кнопками «＋ Узел орудия» / «＋ Отсек» выше.</div>`;
  }

  const cap = cnId('cn-schem-cap');
  if (cap) {
    const tIdx = +(cnId('cn-type') || {}).value || 0, tName = cls.types && cls.types[tIdx] ? cls.types[tIdx].name : '';
    cap.innerHTML = `<span class="cn-schem-k">${esc(cls.name)}</span>${tName ? ` · <span class="cn-schem-t">${esc(tName)}</span>` : ''} · <span class="cn-schem-m">орудий ${wpnCount}/${L.mounts.length} · модулей ${modCount}/${L.bays.length}${hangars.length ? ` · ангаров ${hangars.length}` : ''}</span>`;
  }
}

// ── Ручное размещение: добавить узел/отсек, назначить/убрать содержимое, скрыть слой ──
function cnLayoutAdd(kind) { if (!CN.shipLayout) CN.shipLayout = { mounts: [], bays: [] }; if (kind === 'mount') CN.shipLayout.mounts.push({ w: null }); else CN.shipLayout.bays.push({ m: null }); cnVehCalc(); }
function cnRoomAdd() { if (!CN.shipLayout) CN.shipLayout = { mounts: [], bays: [] }; CN.shipLayout.bays.push({ m: null }); cnVehCalc(); cnOpenAssignPicker('bay', CN.shipLayout.bays.length - 1); }
function cnRoomAddAt(i) { if (!CN.shipLayout) CN.shipLayout = { mounts: [], bays: [] }; while (CN.shipLayout.bays.length <= i) CN.shipLayout.bays.push({ m: null }); cnVehCalc(); cnOpenAssignPicker('bay', i); }
function cnMountAddAt(i) { if (!CN.shipLayout) CN.shipLayout = { mounts: [], bays: [] }; while (CN.shipLayout.mounts.length <= i) CN.shipLayout.mounts.push({ w: null }); cnVehCalc(); cnOpenAssignPicker('mount', i); }
function cnSchemToggle(which) { if (!CN.schemShow) CN.schemShow = { weapons: true, bays: true }; CN.schemShow[which] = !CN.schemShow[which]; const b = cnId(which === 'weapons' ? 'cn-tg-w' : 'cn-tg-b'); if (b) b.classList.toggle('on', CN.schemShow[which]); cnDrawShip(); }
function cnNodeClick(kind, i) { cnOpenAssignPicker(kind, i); }
// Перетаскивание узла орудия по схеме. Клик без движения → открыть пикер (поставить/удалить).
function cnMountToLocal(evt) {                       // экранные координаты → координаты корпуса (учёт viewBox + rotate(90))
  const g = document.getElementById('cn-schem-g'); if (!g) return null;
  const svg = g.ownerSVGElement || g.closest('svg'); if (!svg) return null;
  const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
  const m = g.getScreenCTM(); if (!m) return null;
  const loc = pt.matrixTransform(m.inverse());
  return { x: loc.x, y: loc.y };
}
function cnMountPointerDown(evt, i) {
  if (evt.button != null && evt.button !== 0) return;   // только основная кнопка
  evt.preventDefault();
  const L = CN.shipLayout, slot = L && L.mounts[i]; if (!slot) return;
  const start = cnMountToLocal(evt); let moved = false;
  const move = e => {
    const p = cnMountToLocal(e); if (!p) return;
    if (!moved && start && Math.hypot(p.x - start.x, p.y - start.y) < 3) return;   // порог, чтобы клик не считался тягой
    moved = true;
    const H = CN.shipGeo;
    if (H) {                                            // держим узел в пределах корпуса (+небольшой вынос за борт)
      const y = Math.max(H.nose, Math.min(H.engine[1], p.y));
      const hw = cnHullHalf(H, y) + 8;
      slot.pos = { x: Math.round(Math.max(160 - hw, Math.min(160 + hw, p.x))), y: Math.round(y) };
    } else slot.pos = { x: Math.round(p.x), y: Math.round(p.y) };
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
function cnSlotRow(kind, i, ico, lbl, val, filled) {
  return `<button type="button" class="cn-slotrow${filled ? ' filled' : ''}" onclick="cnNodeClick('${kind}',${i})"><span class="cn-slotrow-ico">${ico}</span><span class="cn-slotrow-b"><span class="cn-slotrow-lbl">${lbl}</span><span class="cn-slotrow-val">${val}</span></span><span class="cn-slotrow-arr">›</span></button>`;
}
function cnOpenAssignPicker(kind, slot) {
  const isW = kind === 'mount', def = CN.def, k = cnId('cn-class').value, source = isW ? def.db.weapons : def.db.modules;
  const arr = isW ? CN.shipLayout.mounts : CN.shipLayout.bays, cur = arr[slot] && (isW ? arr[slot].w : arr[slot].m);
  let secs = '';
  for (const group in source) {
    if (isW && def.excl(k, group)) continue;
    if (isW && !cnWpnUnlocked(CN.cat, group)) continue;
    if (!isW && !cnUnlocked('mod.' + CN.cat + '.' + group)) continue;
    const cards = source[group].map((item, i) => { const info = cnCompInfo(isW ? 'weapon' : 'module', group, i); info.on = !!(cur && cur.g === group && cur.idx === i); return cnCompFullHtml(info, `cnAssignSlot('${kind}',${slot},'${esc(group)}',${i})`); }).join('');
    secs += `<div class="cn-pick-sec"><div class="cn-pick-h">${esc(group)}</div><div class="cn-info-grid">${cards}</div></div>`;
  }
  if (!secs) secs = `<div class="cn-bill-none" style="padding:10px">${isW ? 'Нет доступного оружия этого класса' : 'Модули ещё не исследованы (вкладка «Исследования»)'}</div>`;
  const head = `<div class="cn-assign-head">${cur ? `<button class="btn btn-gh btn-sm" onclick="cnClearSlot('${kind}',${slot})">Оставить пустым</button>` : ''}<button class="btn btn-rd btn-sm" onclick="cnDeleteSlot('${kind}',${slot})">Удалить ${isW ? 'узел' : 'отсек'}</button></div>`;
  let ov = document.getElementById('cn-pick-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'cn-pick-ov'; ov.className = 'cn-modal-ov'; ov.onclick = e => { if (e.target === ov) cnClosePick(); }; document.body.appendChild(ov); }
  ov.innerHTML = `<div class="cn-modal cn-pick-modal"><button class="cn-modal-x" onclick="cnClosePick()">✕</button><div class="cn-modal-name">${isW ? 'Орудие в узел' : 'Модуль в отсек'}</div>${head}<div class="cn-pick-body">${secs}</div></div>`;
  ov.classList.add('show');
}
function cnAssignSlot(kind, slot, g, i) { const a = kind === 'mount' ? CN.shipLayout.mounts : CN.shipLayout.bays; if (!a[slot]) return; if (kind === 'mount') a[slot].w = { g, idx: i }; else a[slot].m = { g, idx: i }; cnClosePick(); cnVehCalc(); }
function cnClearSlot(kind, slot) { const a = kind === 'mount' ? CN.shipLayout.mounts : CN.shipLayout.bays; if (a[slot]) { if (kind === 'mount') a[slot].w = null; else a[slot].m = null; } cnClosePick(); cnVehCalc(); }
function cnDeleteSlot(kind, slot) { 
  const a = kind === 'mount' ? CN.shipLayout.mounts : CN.shipLayout.bays; 
  if (kind === 'mount') a[slot] = { w: null }; else a[slot] = { m: null };
  while (a.length > 0) { const last = a[a.length - 1]; if (kind === 'mount' && (!last || !last.w)) a.pop(); else if (kind === 'bay' && (!last || !last.m)) a.pop(); else break; }
  cnClosePick(); cnVehCalc(); 
}
// Внутренность карточки оружия/модуля (картинка + статы + описание)
function cnPartCardInner(type, g, idx) {
  const db = CN.def.db, E = CN.def.hasEnergy;
  const item = (type === 'weapon' ? db.weapons : db.modules)[g][idx];
  const slug = cnGroupSlug(CN.cat, type, g);
  const img = cnImgTag(cnImgPath(CN.cat, type, slug, idx), 'cn-comp-img');
  let chips;
  if (type === 'weapon') chips = cnChip('урон', cnNum(item.dmg)) + (E && item.energy ? cnChip('E', cnNum(item.energy)) : '') + cnChip('ГС', cnNum(item.cost));
  else chips = (E && item.energy ? cnChip('E', cnNum(item.energy)) : '') + cnChip('ГС', cnNum(item.cost));
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
    if (type === 'module' && !cnUnlocked('mod.' + CN.cat + '.' + group)) continue;
    const cards = source[group].map((item, i) =>
      cnCompFullHtml(cnCompInfo(type, group, i), `cnPickPart('${type}','${esc(group)}',${i})`)).join('');
    secs += `<div class="cn-pick-sec"><div class="cn-pick-h">${esc(group)}</div><div class="cn-info-grid">${cards}</div></div>`;
  }
  if (!secs) { toast(type === 'weapon' ? 'Нет доступного оружия этого класса' : 'Модули ещё не исследованы (вкладка «Исследования»)', 'inf'); return; }
  let ov = document.getElementById('cn-pick-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'cn-pick-ov'; ov.className = 'cn-modal-ov'; ov.onclick = e => { if (e.target === ov) cnClosePick(); }; document.body.appendChild(ov); }
  ov.innerHTML = `<div class="cn-modal cn-pick-modal">
    <button class="cn-modal-x" onclick="cnClosePick()">✕</button>
    <div class="cn-modal-name">${type === 'weapon' ? 'Выбор вооружения' : 'Выбор модуля'}</div>
    <div class="cn-pick-body">${secs}</div>
  </div>`;
  ov.classList.add('show');
}
function cnClosePick() { document.getElementById('cn-pick-ov')?.classList.remove('show'); }
function cnPickPart(type, g, idx) { cnClosePick(); cnVehAddItem(type, { g, idx, q: 1 }); }
// Инфо по уже добавленной строке оружия/модуля (read-only модалка)
function cnRowInfo(g, idx, type) { cnInfoModal(type === 'weapon' ? 'Вооружение' : 'Модуль', cnCompFullHtml(cnCompInfo(type, g, idx), '')); }

// ════════════════════════════════════════════════════════════
// ИССЛЕДОВАНИЯ — что доступно без исследования + гейтинг
// ════════════════════════════════════════════════════════════
const CN_BASE = {
  classes: { ship: ['corvette'], ground: ['light'], aviation: ['light'] },
  weapons: { ship: ['Легкие', 'Средние'], ground: ['Противопехотное', 'Противотанковое'], aviation: ['Курсовое вооружение'] },
};
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
  (d.weapons || []).forEach(w => { if (w && w.g && !baseWpn.includes(w.g)) keys.add('wpn.' + cat + '.' + w.g); });
  (d.modules || []).forEach(m => { if (m && m.g) keys.add('mod.' + cat + '.' + m.g); });
  if (Array.isArray(d.hangars) && d.hangars.length) {
    keys.add('hangar.ship');
    if (d.hangars.some(h => [1, 2].includes(+h.id))) keys.add('hangar.ship.heavy');
  }
  return [...keys];
}
if (typeof window !== 'undefined') window.cnUnitReqTech = cnUnitReqTech;
function cnClassUnlocked(cat, k) { return (CN_BASE.classes[cat] || []).includes(k) || cnUnlocked('cls.' + cat + '.' + k); }
function cnWpnUnlocked(cat, g) { return (CN_BASE.weapons[cat] || []).includes(g) || cnUnlocked('wpn.' + cat + '.' + g); }
function cnCompUnlocked(cat, t) { return cnUnlocked('comp.' + cat + '.' + t); }
function cnCompOptions(cat, type, list, labelFn) {
  const open = cnCompUnlocked(cat, type);
  return list.map((it, i) => { const locked = i >= 1 && !open; return `<option value="${i}"${locked ? ' disabled' : ''}>${locked ? '🔒 ' : ''}${esc(labelFn(it, i))}</option>`; }).join('');
}

// ════════════════════════════════════════════════════════════
// ДВИЖОК БИЛДЕРА ТЕХНИКИ (ship / ground / aviation)
// ════════════════════════════════════════════════════════════
function cnRenderShip() { return cnVehRender('ship'); }
function cnRenderGround() { return cnVehRender('ground'); }
function cnRenderAviation() { return cnVehRender('aviation'); }

async function cnVehRender(cat) {
  const edit = CN.edit; CN.edit = null;
  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);
  await cnLoadMyFaction();
  if (!cnCanAccess()) { cnGate(); return; }
  await cnLoadResearch();
  const def = CN_DEFS[cat];
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
          <input id="cn-name" class="cn-stage-name" placeholder="Название корабля…" value="${esc(edit ? edit.name : '')}">
          <div class="cn-slots">
            ${slotSel('class', 'cnVehHandleClass()')}
            ${def.hasType ? slotSel('type', 'cnVehCalc()') : ''}
            ${def.hasReactor ? slotSel('reactor', 'cnVehCalc()') : ''}
            ${slotSel('engine', 'cnVehCalc()')}
            ${slotSel('armor', 'cnVehCalc()')}
            ${slotSel('shield', 'cnVehCalc()')}
          </div>
          <div class="cn-schem-cap" id="cn-schem-cap"></div>
          <div class="cn-schem-wrap">
            <div id="cn-schematic" class="cn-schematic"></div>
            <div class="cn-schem-toggles">
              <button class="btn btn-gh btn-sm on" id="cn-tg-w" onclick="cnSchemToggle('weapons')" title="Показать/скрыть орудия">Орудия</button>
              <button class="btn btn-gh btn-sm on" id="cn-tg-b" onclick="cnSchemToggle('bays')" title="Показать/скрыть отсеки">Отсеки</button>
            </div>
          </div>
          <div class="cn-schem-tools">
            <button class="btn btn-gh btn-sm" onclick="cnLayoutAdd('mount')">＋ Узел орудия</button>
            <button class="btn btn-gh btn-sm" onclick="cnLayoutAdd('bay')">＋ Отсек</button>
            ${def.hasHangars ? `<button class="btn btn-gh btn-sm" onclick="cnVehAddHangar()">＋ Ангар</button>` : ''}
          </div>
          <div id="cn-schem-list" class="cn-schem-list"></div>
          <div class="cn-schem-hint">Системы сверху — клик открывает выбор. По узлам и отсекам прямо на корабле — поставить, сменить или убрать.</div>
          <div class="cn-schem-legend">
            <span class="cn-lg"><i style="background:var(--te)"></i>энергия</span>
            <span class="cn-lg"><i style="background:var(--t2)"></i>баллистика</span>
            <span class="cn-lg"><i style="background:var(--err)"></i>ракеты</span>
            <span class="cn-lg"><i class="cn-lg-mod"></i>модуль-отсек</span>
            <span class="cn-lg"><i class="cn-lg-hangar"></i>ангар</span>
            <span class="cn-lg"><i class="cn-lg-air"></i>авиация</span>
            <span class="cn-lg"><i class="cn-lg-empty"></i>свободный узел</span>
          </div>
        </div>
        ${def.hasHangars ? `<div class="cn-panel cn-hangars-panel"><h3>Ангарная палуба</h3><div id="cn-hangars"></div></div>` : ''}
        <div class="cn-panel"><h3>Текущие ТТХ</h3><div id="cn-stats" class="cn-stats-grid"></div></div>
        <div class="cn-panel">${publishBtns}</div>
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

  setPg(`<div class="cn-wrap cn-builder">
    <div class="cn-head">
      <div class="cn-eyebrow">◈ ${esc(def.subtitle)}</div>
      <h1>${esc(def.title)}</h1>
      <div class="cn-back"><a onclick="go('constructors')">← к конструкторам</a></div>
    </div>
    ${body}
  </div>`);

  if (edit && cnId('cn-faction')) cnId('cn-faction').value = edit.faction_id || '';
  CN.snap = null; CN._applying = false;
  cnVehInit();
  if (edit && edit.data) { CN._applying = true; cnVehApplyData(edit.data); CN._applying = false; CN.snap = cnVehCollectData(); }
}

function cnVehInit() {
  const def = CN.def, cat = CN.cat;
  // только разблокированные классы (value = ключ); сохранённый класс при правке — включаем всегда
  let keys = Object.keys(def.db.data).filter(k => cnClassUnlocked(cat, k));
  const ek = CN.editUnit && CN.editUnit.data && CN.editUnit.data.class;
  if (ek && def.db.data[ek] && !keys.includes(ek)) keys.push(ek);
  if (!keys.length) keys = [Object.keys(def.db.data)[0]];
  cnId('cn-class').innerHTML = keys.map(k => `<option value="${k}">${esc(def.db.data[k].name)}</option>`).join('');
  if (def.cardUI) cnSlotSelected('class');
  cnVehClassDeps();
}
function cnVehHandleClass() {
  if (cnId('cn-weapons')) cnId('cn-weapons').innerHTML = '';
  if (cnId('cn-modules')) cnId('cn-modules').innerHTML = '';
  if (CN.def.hasHangars && cnId('cn-hangars')) cnId('cn-hangars').innerHTML = '';
  cnVehClassDeps();
}
function cnVehClassDeps() {
  const def = CN.def, k = cnId('cn-class').value, cat = CN.cat;
  if (def.hasType) { const typeOpen = cnUnlocked('type.' + cat + '.' + k); cnId('cn-type').innerHTML = def.db.data[k].types.map((t, i) => { const locked = i >= 1 && !typeOpen; return `<option value="${i}"${locked ? ' disabled' : ''}>${locked ? '🔒 ' : ''}${esc(t.name)}</option>`; }).join(''); }
  if (def.hasReactor) cnId('cn-reactor').innerHTML = cnCompOptions(cat, 'reactor', def.db.reactors[k], r => `${r.name} (${r.energy} E)`);
  cnId('cn-armor').innerHTML = cnCompOptions(cat, 'armor', def.db.armors[k], a => `${a.name} (+${cnNum(a.armor)} AR)`);
  cnId('cn-shield').innerHTML = cnCompOptions(cat, 'shield', def.db.shields[k], s => s.name);
  cnId('cn-engine').innerHTML = cnCompOptions(cat, 'engine', def.db.engines[k], e => `${e.name} (${e.speed} у.е.)`);
  if (def.cardUI) { ['type', 'reactor', 'armor', 'shield', 'engine'].forEach(cnSlotSelected); cnHullHero(); }
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
      if (type === 'module' && !cnUnlocked('mod.' + CN.cat + '.' + group)) continue;
    }
    const g = document.createElement('optgroup');
    g.label = group;
    source[group].forEach((item, i) => {
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
  if (p.armorObj) { cnBillAdd(bill, 'Железо', (p.armorObj.armor || 0) / t.armorFe); cnBillAdd(bill, 'Титан', (p.armorObj.armor || 0) / t.armorTi); }
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
    if ((m.cost || 0) >= 100) cnBillAdd(bill, 'Стелларит', 1);
    else if ((m.cost || 0) >= 30) cnBillAdd(bill, 'Редкоземельные руды', 1);
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

  let cost = (typeObj ? typeObj.cost : cls.cost) + (reactObj ? reactObj.cost : 0) + armorObj.cost + shieldObj.cost + engObj.cost;
  let energyCons = def.hasEnergy ? ((shieldObj.energy || 0) + (engObj.energy || 0)) : 0;
  let dmg = 0, on = cls.baseON;
  const billWeapons = [], billModules = [], billHangars = [];   // для ресурсной ведомости

  if (CN.cat === 'ship' && def.cardUI) {
    (CN.shipLayout && CN.shipLayout.mounts || []).forEach(mt => { if (!mt.w) return; const w = db.weapons[mt.w.g][mt.w.idx]; cost += w.cost; on += cls.modON; dmg += w.dmg; if (def.hasEnergy) energyCons += (w.energy || 0); billWeapons.push({ w, q: 1 }); });
    (CN.shipLayout && CN.shipLayout.bays || []).forEach(by => { if (!by.m) return; const m = db.modules[by.m.g][by.m.idx]; cost += m.cost; on += cls.modON; if (def.hasEnergy) energyCons += (m.energy || 0); billModules.push({ m }); });
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

  const hp = typeObj ? typeObj.hp : cls.hp;
  const armor = (typeObj ? typeObj.armor : 0) + armorObj.armor;
  const shield = shieldObj.shield || 0;
  const speed = engObj.speed;
  const eMax = reactObj ? reactObj.energy : 0;
  // Ресурсная ведомость: корабли строятся по ней напрямую, наземка/авиация —
  // в составе дивизий (их bill агрегируется в дивизионный summary.bill).
  const bill = cnUnitBill(CN.cat, k, { typeObj, reactObj, armorObj, shieldObj, engObj, weapons: billWeapons, modules: billModules, hangars: billHangars });
  CN.last = { hp, armor, shield, dmg, speed, cost, on: +on.toFixed(1), eCons: energyCons, eMax, energy: def.hasEnergy, hangarOver, cargo, bill };
  cnVehRenderStats();
  if (CN.def.cardUI) cnDrawShip();
  // Жёсткий лимит: нельзя набрать сверх показателя — откатываем последнее действие
  if (CN._applying) return;
  const over = (CN.last.energy && CN.last.eCons > CN.last.eMax) || CN.last.hangarOver;
  if (over) {
    if (CN.snap) {
      CN._applying = true;
      cnVehApplyData(CN.snap);
      CN._applying = false;
      toast(CN.last.hangarOver ? 'Ангар перегружен — авиагруппа не помещается' : 'Энергосеть перегружена — реактор не тянет', 'err');
    }
  } else {
    CN.snap = cnVehCollectData();
  }
}
function cnVehRenderStats() {
  const s = CN.last; if (!s) return;
  const energyOk = s.eCons <= s.eMax;
  let rows = `
    <div class="cn-stat"><span>Прочность</span><b>${cnNum(s.hp)} HP</b></div>
    <div class="cn-stat"><span>Бронирование</span><b>${cnNum(s.armor)} AR</b></div>
    <div class="cn-stat"><span>Щиты</span><b>${s.shield > 0 ? cnNum(s.shield) + ' ед.' : 'нет'}</b></div>
    <div class="cn-stat"><span>Огневая мощь</span><b>${cnNum(s.dmg)} урон</b></div>
    <div class="cn-stat"><span>Скорость</span><b>${s.speed} у.е.</b></div>
    ${s.cargo > 0 ? `<div class="cn-stat"><span>Грузоподъёмность</span><b style="color:var(--te)">${cnNum(s.cargo)} ед.</b></div>` : ''}
    <div class="cn-stat"><span>Стоимость</span><b style="color:var(--gd)">${cnNum(s.cost)} ГС</b></div>
    <div class="cn-stat"><span>Разработка</span><b style="color:var(--te)">${s.on} ОН</b></div>`;
  if (s.energy) rows += `<div class="cn-stat"><span>Энергосеть</span><b class="${energyOk ? '' : 'cn-warn'}">${cnNum(s.eCons)} / ${cnNum(s.eMax)} E</b></div>`;
  if (s.bill && Object.keys(s.bill).length) rows += `<div class="cn-stat cn-stat-bill"><span>Сырьё / корпус</span><div class="cn-bill">${cnBillHtml(s.bill)}</div></div>`;
  cnId('cn-stats').innerHTML = rows;
}

// ── Сбор/применение конфига (для публикации и редактирования) ──
function cnVehCollectData() {
  const def = CN.def;
  const d = { class: cnId('cn-class').value };
  if (def.hasType) d.type = +cnId('cn-type').value;
  if (def.hasReactor) d.reactor = +cnId('cn-reactor').value;
  d.armor = +cnId('cn-armor').value;
  d.shield = +cnId('cn-shield').value;
  d.engine = +cnId('cn-engine').value;
  if (CN.cat === 'ship' && def.cardUI) {
    const L = CN.shipLayout || { mounts: [], bays: [] };
    d.weapons = L.mounts.filter(m => m.w).map(m => ({ g: m.w.g, idx: m.w.idx, q: 1 }));
    d.modules = L.bays.filter(b => b.m).map(b => ({ g: b.m.g, idx: b.m.idx }));
    d.layout = { mounts: L.mounts.map(m => ({ w: m.w ? { g: m.w.g, idx: m.w.idx } : null, pos: m.pos ? { x: m.pos.x, y: m.pos.y } : null })), bays: L.bays.map(b => b.m ? { g: b.m.g, idx: b.m.idx } : null) };
  } else {
    d.weapons = [...document.querySelectorAll('#cn-weapons .cn-row')].map(r => { const s = JSON.parse(r.querySelector('select').value); return { g: s.g, idx: s.idx, q: +(r.querySelector('input')?.value || 1) }; });
    d.modules = [...document.querySelectorAll('#cn-modules .cn-row')].map(r => { const s = JSON.parse(r.querySelector('select').value); return { g: s.g, idx: s.idx }; });
  }
  if (def.hasHangars) d.hangars = [...document.querySelectorAll('#cn-hangars .cn-hangar')].map(h => ({ id: +h.querySelector('.cn-h-type').value, units: [...h.querySelectorAll('.cn-u-type')].map(u => +u.value) }));
  return d;
}
function cnVehApplyData(d) {
  const def = CN.def, shipCard = CN.cat === 'ship' && def.cardUI;
  if (cnId('cn-weapons')) cnId('cn-weapons').innerHTML = '';
  if (cnId('cn-modules')) cnId('cn-modules').innerHTML = '';
  if (def.hasHangars && cnId('cn-hangars')) cnId('cn-hangars').innerHTML = '';
  if (d.class && def.db.data[d.class]) cnId('cn-class').value = d.class;
  cnVehClassDeps();
  if (def.hasType && d.type != null) cnId('cn-type').value = d.type;
  if (def.hasReactor && d.reactor != null) cnId('cn-reactor').value = d.reactor;
  if (d.armor != null) cnId('cn-armor').value = d.armor;
  if (d.shield != null) cnId('cn-shield').value = d.shield;
  if (d.engine != null) cnId('cn-engine').value = d.engine;
  if (shipCard) {
    if (d.layout) CN.shipLayout = { mounts: (d.layout.mounts || []).map(x => {
        if (x && ('w' in x || 'pos' in x)) return { w: x.w ? { g: x.w.g, idx: x.w.idx } : null, pos: x.pos ? { x: x.pos.x, y: x.pos.y } : null };  // новый формат {w,pos}
        return { w: x ? { g: x.g, idx: x.idx } : null };                                                                                        // старый формат {g,idx}|null
      }), bays: (d.layout.bays || []).map(x => ({ m: x ? { g: x.g, idx: x.idx } : null })) };
    else CN.shipLayout = { mounts: (d.weapons || []).flatMap(w => Array.from({ length: w.q || 1 }, () => ({ w: { g: w.g, idx: w.idx } }))), bays: (d.modules || []).map(m => ({ m: { g: m.g, idx: m.idx } })) };
  } else {
    (d.weapons || []).forEach(w => cnVehAddItem('weapon', w));
    (d.modules || []).forEach(m => cnVehAddItem('module', m));
  }
  if (def.hasHangars) (d.hangars || []).forEach(h => cnVehAddHangar(h));
  if (def.cardUI) { cnSlotSelected('class'); ['type', 'reactor', 'armor', 'shield', 'engine'].forEach(cnSlotSelected); cnHullHero(); }
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
  c += `КОРПУС: ${cnNum(s.hp)} HP / ${cnNum(s.armor)} AR\n`;
  c += `ЩИТЫ: ${s.shield > 0 ? cnNum(s.shield) + ' ед.' : 'нет'}\n`;
  c += `СКОРОСТЬ: ${s.speed} у.е. (${engObj.name})\n`;
  if (reactObj) c += `РЕАКТОР: ${reactObj.name} (${reactObj.energy} E)\n`;
  c += `------------------------------------------\nВООРУЖЕНИЕ:\n`;
  const ws = document.querySelectorAll('#cn-weapons .cn-row');
  if (!ws.length) c += ` - нет\n`;
  ws.forEach(r => { const sp = JSON.parse(r.querySelector('select').value); const q = r.querySelector('input').value; const w = db.weapons[sp.g][sp.idx]; c += ` - ${w.name} x${q} (${cnNum(w.dmg * q)} урон)\n`; });
  if (def.hasHangars) {
    const hs = document.querySelectorAll('#cn-hangars .cn-hangar');
    if (hs.length) { c += `\nАНГАРЫ:\n`; hs.forEach(hp => { const h = db.hangarTypes.find(x => x.id == hp.querySelector('.cn-h-type').value); c += ` + ${h.name.toUpperCase()} (вмест. ${h.capacity})\n`; hp.querySelectorAll('.cn-u-type').forEach(u => c += `   > ${db.airUnits[u.value].name}\n`); }); }
  }
  c += `\nМОДУЛИ:\n`;
  const ms = document.querySelectorAll('#cn-modules .cn-row');
  if (!ms.length) c += ` - базовая комплектация\n`;
  ms.forEach(r => { const sp = JSON.parse(r.querySelector('select').value); c += ` - ${db.modules[sp.g][sp.idx].name}\n`; });
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
    const def = CN.def, k = cnId('cn-class').value, cls = def.db.data[k];
    const typeObj = def.hasType ? cls.types[+cnId('cn-type').value || 0] : null;
    data = cnVehCollectData();
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

  CN.busy = true;
  try {
    const res = await ecRpc('economy_publish_unit', {
      p_category: CN.cat, p_name: name, p_data: data, p_card_text: card,
      p_faction_id: fac.faction_id || null, p_faction_name: fac.faction_name || null,
      p_faction_color: fac.faction_color || null,
      p_unit_id: (CN.editUnit && CN.editUnit.id) || null,
    });
    const row = (res && res.id) ? res : (Array.isArray(res) ? res[0] : res);
    if (row && row.id) CN.editUnit = row;
    const charged = row && row._on_charged;
    toast(isNew ? `Опубликовано ✓${charged ? ` · −${cnNum(charged)} ОН` : ''}` : 'Изменения сохранены ✓', 'ok');
    go(cnCatRoute(CN.cat));
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
  ground: { title: 'Наземная техника', ico: '🛡', build: 'build-ground', empty: 'Наземная техника ещё не создана.' },
  aviation: { title: 'Авиация', ico: '✈', build: 'build-aviation', empty: 'Авиапарк пока пуст.' },
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
  const canBuild = cnCanAccess();
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
  if (!confirm('Удалить «' + (u.name || 'юнит') + '» безвозвратно?')) return;
  try {
    await dbDel('faction_units', 'id=eq.' + id);
    CN.catUnits = (CN.catUnits || []).filter(x => x.id !== id);
    cnCloseView();
    toast('Удалено', 'inf');
    cnPaintCatalog();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}
