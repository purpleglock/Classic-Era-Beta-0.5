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
    hasType: true, hasReactor: true, hasEnergy: true, hasHangars: true,
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

  const facBlock = await cnFactionPublishBlock();

  const typeField = def.hasType ? `<div class="cn-field"><label>Специализация</label><select id="cn-type" onchange="cnVehCalc()"></select></div>` : '';
  const reactorField = def.hasReactor ? `<div class="cn-field"><label>Реактор</label><select id="cn-reactor" onchange="cnVehCalc()"></select></div>` : '';
  const hangarPanel = def.hasHangars ? `
      <div class="cn-panel">
        <h3>Ангарная палуба</h3>
        <div id="cn-hangars"></div>
        <button class="btn btn-gh btn-fw" style="margin-top:10px" onclick="cnVehAddHangar()">+ Добавить ангар</button>
      </div>` : '';

  setPg(`<div class="cn-wrap cn-builder">
    <div class="cn-head">
      <div class="cn-eyebrow">◈ ${esc(def.subtitle)}</div>
      <h1>${esc(def.title)}</h1>
      <div class="cn-back"><a onclick="go('constructors')">← к конструкторам</a></div>
    </div>
    <div class="cn-grid">
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
      </div>
      <div class="cn-side">
        <div class="cn-panel cn-sticky">
          <h3>Текущие ТТХ</h3>
          <div id="cn-stats"></div>
          ${facBlock}
          <button class="btn btn-gd btn-fw" style="margin-top:12px" onclick="cnPublish()">${edit ? '💾 Сохранить изменения' : '✓ Опубликовать'}</button>
          <button class="btn btn-gh btn-fw" style="margin-top:8px" onclick="cnCopyVehCard()">📋 Копировать спецификацию</button>
        </div>
      </div>
    </div>
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
  cnVehClassDeps();
}
function cnVehHandleClass() {
  cnId('cn-weapons').innerHTML = '';
  cnId('cn-modules').innerHTML = '';
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
    // не исследованные группы оружия/модулей скрываем (preset/правка — показываем все)
    if (type === 'weapon' && !preset && !cnWpnUnlocked(CN.cat, group)) continue;
    if (type === 'module' && !preset && !cnUnlocked('mod.' + CN.cat + '.' + group)) continue;
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
    if (!preset && !heavyOpen && [1, 2].includes(h.id)) return false;   // крупные ангары — за «Тяжёлые ангары»
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
  div.innerHTML = `<select class="cn-u-type" onchange="cnVehCalc()">${opts}</select>
    <button class="cn-del" onclick="this.closest('.cn-row').remove(); cnVehCalc();">✕</button>`;
  list.appendChild(div);
  if (presetIdx != null) div.querySelector('.cn-u-type').value = presetIdx;
  cnVehCalc();
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

  document.querySelectorAll('#cn-weapons .cn-row').forEach(row => {
    const s = JSON.parse(row.querySelector('select').value);
    const q = parseInt(row.querySelector('input').value) || 0;
    const w = db.weapons[s.g][s.idx];
    cost += w.cost * q; on += q * cls.modON; dmg += w.dmg * q;
    if (def.hasEnergy) energyCons += (w.energy || 0) * q;
  });
  document.querySelectorAll('#cn-modules .cn-row').forEach(row => {
    const s = JSON.parse(row.querySelector('select').value);
    const m = db.modules[s.g][s.idx];
    cost += m.cost; on += cls.modON;
    if (def.hasEnergy) energyCons += (m.energy || 0);
  });
  let hangarOver = false;
  if (def.hasHangars) {
    document.querySelectorAll('#cn-hangars .cn-hangar').forEach(hp => {
      const h = db.hangarTypes.find(x => x.id == hp.querySelector('.cn-h-type').value);
      cost += h.cost; on += cls.modON; energyCons += h.energy;
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
  CN.last = { hp, armor, shield, dmg, speed, cost, on: +on.toFixed(1), eCons: energyCons, eMax, energy: def.hasEnergy, hangarOver };
  cnVehRenderStats();
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
    <div class="cn-stat"><span>Стоимость</span><b style="color:var(--gd)">${cnNum(s.cost)} ГС</b></div>
    <div class="cn-stat"><span>Разработка</span><b style="color:var(--te)">${s.on} ОН</b></div>`;
  if (s.energy) rows += `<div class="cn-stat"><span>Энергосеть</span><b class="${energyOk ? '' : 'cn-warn'}">${cnNum(s.eCons)} / ${cnNum(s.eMax)} E</b></div>`;
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
  d.weapons = [...document.querySelectorAll('#cn-weapons .cn-row')].map(r => { const s = JSON.parse(r.querySelector('select').value); return { g: s.g, idx: s.idx, q: +(r.querySelector('input')?.value || 1) }; });
  d.modules = [...document.querySelectorAll('#cn-modules .cn-row')].map(r => { const s = JSON.parse(r.querySelector('select').value); return { g: s.g, idx: s.idx }; });
  if (def.hasHangars) d.hangars = [...document.querySelectorAll('#cn-hangars .cn-hangar')].map(h => ({ id: +h.querySelector('.cn-h-type').value, units: [...h.querySelectorAll('.cn-u-type')].map(u => +u.value) }));
  return d;
}
function cnVehApplyData(d) {
  const def = CN.def;
  cnId('cn-weapons').innerHTML = '';
  cnId('cn-modules').innerHTML = '';
  if (def.hasHangars && cnId('cn-hangars')) cnId('cn-hangars').innerHTML = '';
  if (d.class && def.db.data[d.class]) cnId('cn-class').value = d.class;
  cnVehClassDeps();
  if (def.hasType && d.type != null) cnId('cn-type').value = d.type;
  if (def.hasReactor && d.reactor != null) cnId('cn-reactor').value = d.reactor;
  if (d.armor != null) cnId('cn-armor').value = d.armor;
  if (d.shield != null) cnId('cn-shield').value = d.shield;
  if (d.engine != null) cnId('cn-engine').value = d.engine;
  (d.weapons || []).forEach(w => cnVehAddItem('weapon', w));
  (d.modules || []).forEach(m => cnVehAddItem('module', m));
  if (def.hasHangars) (d.hangars || []).forEach(h => cnVehAddHangar(h));
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
  c += `------------------------------------------\nИТОГ: ${cnNum(s.cost)} ГС · ${s.on} ОН`;
  if (s.energy) c += ` · энергосеть ${cnNum(s.eCons)}/${cnNum(s.eMax)} E`;
  return c;
}
function cnCopyVehCard() { cnCopy(cnVehCardText()); }

// ════════════════════════════════════════════════════════════
// БИЛДЕР ДИВИЗИЙ (division)
// ════════════════════════════════════════════════════════════
const CN_DIV_DATA = [
  { id: 'inf_militia', name: 'Ополчение', type: 'inf', cost: 10, count: 1000, size: 1000, armorhp: 1, atack: 1, dalnost: 1 },
  { id: 'inf_regular', name: 'Регулярная пехота', type: 'inf', cost: 35, count: 1000, size: 1000, armorhp: 2, atack: 3, dalnost: 2 },
  { id: 'inf_heavy', name: 'Тяжелая/Штурмовая пехота', type: 'inf', cost: 80, count: 1000, size: 1000, armorhp: 5, atack: 6, dalnost: 2 },
  { id: 'inf_spec', name: 'Спецназ / Десант', type: 'inf', cost: 150, count: 1000, size: 1000, armorhp: 4, atack: 10, dalnost: 3 },
  { id: 'inf_robot', name: 'Роботизированная пехота', type: 'inf', cost: 50, count: 1000, size: 1000, armorhp: 4, atack: 10, dalnost: 3 },
  { id: 'tank_light', name: 'Легкий танк', type: 'tank', cost: 300, count: 100, size: 200, armorhp: 30, atack: 25, dalnost: 4 },
  { id: 'tank_mbt', name: 'Основной Боевой Танк', type: 'tank', cost: 500, count: 100, size: 300, armorhp: 80, atack: 70, dalnost: 5 },
  { id: 'tank_heavy', name: 'Тяжелый танк прорыва', type: 'tank', cost: 1000, count: 100, size: 400, armorhp: 150, atack: 110, dalnost: 5 },
  { id: 'tank_walker', name: 'Штурмовой Шагоход', type: 'tank', cost: 1500, count: 100, size: 400, armorhp: 120, atack: 140, dalnost: 6 },
  { id: 'btr_wheel', name: 'Колесный бронетранспортер', type: 'btr', cost: 250, count: 100, size: 150, armorhp: 15, atack: 10, dalnost: 2 },
  { id: 'bmp_track', name: 'Гусеничная БМП', type: 'btr', cost: 450, count: 100, size: 200, armorhp: 35, atack: 25, dalnost: 3 },
  { id: 'btr_hover', name: 'Грави-транспорт', type: 'btr', cost: 800, count: 100, size: 150, armorhp: 25, atack: 15, dalnost: 3 },
  { id: 'art_mortar', name: 'Мобильная минометная батарея', type: 'artillery', cost: 200, count: 100, size: 100, armorhp: 5, atack: 40, dalnost: 15 },
  { id: 'art_sau', name: 'Самоходная артустановка', type: 'artillery', cost: 900, count: 100, size: 250, armorhp: 20, atack: 90, dalnost: 40 },
  { id: 'art_rszo', name: 'РСЗО', type: 'artillery', cost: 1200, count: 100, size: 300, armorhp: 15, atack: 150, dalnost: 60 },
  { id: 'art_laser', name: 'Тяжелое плазменное/лазерное орудие', type: 'artillery', cost: 3500, count: 100, size: 350, armorhp: 30, atack: 250, dalnost: 80 },
  { id: 'air_drone', name: 'Ударный беспилотник', type: 'aviation', cost: 500, count: 10, size: 10, armorhp: 2, atack: 40, dalnost: 50 },
  { id: 'air_heli', name: 'Штурмовой ганшип', type: 'aviation', cost: 1500, count: 10, size: 20, armorhp: 15, atack: 100, dalnost: 30 },
  { id: 'air_fighter', name: 'Атмосферный истребитель', type: 'aviation', cost: 2000, count: 10, size: 20, armorhp: 10, atack: 150, dalnost: 150 },
  { id: 'air_bomber', name: 'Тяжелый тактический бомбардировщик', type: 'aviation', cost: 2500, count: 10, size: 40, armorhp: 25, atack: 400, dalnost: 200 }
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
  const list = [];
  document.querySelectorAll('#cn-div-area .cn-divblock').forEach(b => {
    const id = b.querySelector('.cn-d-model').value;
    const c = parseInt(b.querySelector('.cn-d-count').value) || 0;
    const m = cnDivModelById(id);
    if (m && c > 0) {
      list.push(`• ${m.name}${m.public ? ' ★' : ''} (${cnNum(c)} ед.)`);
      cost += m.cost * c; size += m.size * c;
      sa += (m.armorhp || 0) * c; st += (m.atack || 0) * c; sd += (m.dalnost || 0) * c; count += c;
      if (m.armorhp > ma) ma = m.armorhp; if (m.atack > mt) mt = m.atack; if (m.dalnost > md) md = m.dalnost;
    }
  });
  const percent = +(size / CN_DIV_CAP * 100).toFixed(1);
  const midA = count ? +(sa / count).toFixed(1) : 0, midT = count ? +(st / count).toFixed(1) : 0, midD = count ? +(sd / count).toFixed(1) : 0;
  CN.lastDiv = { cost, size, percent, count, midArmor: midA, maxArmor: ma, midAtk: midT, maxAtk: mt, midRange: midD, maxRange: md };
  const over = size > CN_DIV_CAP;
  cnId('cn-stats').innerHTML = `
    <div class="cn-stat"><span>Стоимость</span><b style="color:var(--gd)">${cnNum(cost)} ГС</b></div>
    <div class="cn-stat"><span>Размер</span><b class="${over ? 'cn-warn' : ''}">${cnNum(size)} / ${cnNum(CN_DIV_CAP)}</b></div>
    <div class="cn-stat"><span>Занято</span><b class="${over ? 'cn-warn' : ''}">${percent} %</b></div>
    <div class="cn-stat"><span>Бронир. ср / макс</span><b>${midA} / ${cnNum(ma)}</b></div>
    <div class="cn-stat"><span>Атака ср / макс</span><b>${midT} / ${cnNum(mt)}</b></div>
    <div class="cn-stat"><span>Дальность ср / макс</span><b>${midD} / ${cnNum(md)}</b></div>`;
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
    `7. Дальность (ср/макс): ${s.midRange} / ${cnNum(s.maxRange)}`;
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
  const body = {
    category: CN.cat, name,
    faction_id: fac.faction_id, faction_name: fac.faction_name, faction_color: fac.faction_color,
    owner_id: user.id, owner_email: user.email,
    summary, data, card_text: card, updated_at: new Date().toISOString(),
  };
  const isNew = !(CN.editUnit && CN.editUnit.id);
  // Стафф выдаёт юниты-награды — ОН с казны фракции не списываем.
  const onCost = (isNew && CN.cat !== 'division' && fac.faction_id && !cnIsStaff()) ? (summary.on || 0) : 0;

  if (onCost > 0) {
    const ecoRows = await dbGet('faction_economy', `faction_id=eq.${encodeURIComponent(fac.faction_id)}&select=science`);
    const curScience = (ecoRows && ecoRows[0] && ecoRows[0].science) || 0;
    if (curScience < onCost) { toast(`Недостаточно ОН для разработки: нужно ${onCost}, есть ${curScience}`, 'err'); return; }
  }

  CN.busy = true;
  try {
    if (onCost > 0) {
      const ecoRows = await dbGet('faction_economy', `faction_id=eq.${encodeURIComponent(fac.faction_id)}&select=science`);
      const curScience = (ecoRows && ecoRows[0] && ecoRows[0].science) || 0;
      if (curScience < onCost) { toast(`Недостаточно ОН для разработки: нужно ${onCost}, есть ${curScience}`, 'err'); return; }
      await dbPatch('faction_economy', 'faction_id=eq.' + encodeURIComponent(fac.faction_id), { science: curScience - onCost });
    }
    if (CN.editUnit && CN.editUnit.id) { await dbPatch('faction_units', 'id=eq.' + CN.editUnit.id, body); toast('Изменения сохранены ✓', 'ok'); }
    else { const rows = await dbPost('faction_units', body); const row = Array.isArray(rows) ? rows[0] : rows; if (row && row.id) CN.editUnit = row; toast(`Опубликовано ✓${onCost ? ` · −${onCost} ОН` : ''}`, 'ok'); }
    go(cnCatRoute(CN.cat));
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
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
  const manage = cnCanManage(u)
    ? `<div class="cn-card-acts">
         <button title="Редактировать" onclick="event.stopPropagation();cnEdit('${u.id}')">✎</button>
         <button title="Удалить" onclick="event.stopPropagation();cnDelete('${u.id}')">✕</button>
       </div>` : '';
  return `<div class="cn-card" onclick="cnViewUnit('${u.id}')">
    <div class="cn-card-bar" style="background:${esc(col)}"></div>
    <div class="cn-card-body">
      <div class="cn-card-name">${esc(u.name || 'Без названия')}</div>
      <div class="cn-card-fac" style="color:${esc(col)}">${esc(cnFacName(u))}</div>
      <div class="cn-card-stats">${cnCardStats(u.category, u.summary)}</div>
    </div>
    ${manage}
  </div>`;
}
function cnCardStats(cat, sm) {
  sm = sm || {};
  const chip = (l, v) => `<span class="cn-mini">${esc(l)} <b>${esc(v)}</b></span>`;
  if (cat === 'division') return chip('Размер', cnNum(sm.size)) + chip('Стоим.', cnNum(sm.cost) + ' ГС') + chip('Атака≤', cnNum(sm.maxAtk));
  let out = chip('HP', cnNum(sm.hp)) + chip('Урон', cnNum(sm.dmg)) + chip('Стоим.', cnNum(sm.cost) + ' ГС');
  if (sm.on != null) out += chip('ОН', sm.on);
  return out;
}

// ── Просмотр юнита ──
function cnViewUnit(id) {
  const u = (CN.catUnits || []).find(x => x.id === id); if (!u) return;
  const col = cnReadable(u.faction_color);
  let ov = document.getElementById('cn-modal-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'cn-modal-ov'; ov.className = 'cn-modal-ov'; ov.onclick = e => { if (e.target === ov) cnCloseView(); }; document.body.appendChild(ov); }
  const stats = cnCardStats(u.category, u.summary);
  const seeBp = cnCanSeeBlueprint(u);
  const isDiv = u.category === 'division';
  const spec = seeBp
    ? `<pre class="cn-spec">${esc(u.card_text || '')}</pre>`
    : `<div class="cn-spec cn-spec-locked">🔒 ${isDiv ? 'Состав дивизии засекречен' : 'Чертёж засекречен'}.<br><span style="opacity:.7">Доступно только владельцу фракции и администрации.</span></div>`;
  ov.innerHTML = `<div class="cn-modal">
    <button class="cn-modal-x" onclick="cnCloseView()">✕</button>
    <div class="cn-modal-bar" style="background:${esc(col)}"></div>
    <div class="cn-modal-name">${esc(u.name || 'Без названия')}</div>
    <div class="cn-card-fac" style="color:${esc(col)}">${esc(cnFacName(u))} · ${esc(CN_CAT_META[u.category]?.title || '')}</div>
    <div class="cn-card-stats" style="margin:10px 0">${stats}</div>
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
