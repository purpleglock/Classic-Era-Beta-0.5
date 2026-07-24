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
// Превратить строку сплава в объект брони формата каталога (для db.armors[k])
function cnAlloyToArmor(a) {
  const st = a.stats || {};
  return {
    name: '⚗ ' + (a.name || 'Сплав'),
    cost: 0,
    armor: Math.round(st.hpBoost || 0),   // для чипов/ведомости
    material: st.material || null,
    category: st.category || 'composite',
    hpBoost: st.hpBoost || 0,
    hpPercentBoost: st.hpPercentBoost || 0,
    capacityBoost: st.capacityBoost || 0,
    resist: st.resist || { kinetic: 0, energy: 0, missile: 0 },
    resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
    quality: (st.quality != null ? st.quality : 1),   // 0.1..1.6 — качество рецепта (масштаб HP под корпус)
    _alloy: true, _alloyId: a.id,
  };
}
// Дописать сплавы в db.armors[k], предварительно убрав ранее вписанные (_alloy).
function cnMergeAlloys(db) {
  if (!db || !db.armors) return;
  const list = (CN_ALLOYS || []).map(cnAlloyToArmor);
  for (const k in db.armors) {
    if (!Array.isArray(db.armors[k])) continue;
    db.armors[k] = db.armors[k].filter(a => !a._alloy).concat(list);
  }
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
function cnGsChip(cost) { return window.KV_DB ? '' : cnChip('ГС', cnNum(cost)); }
function cnSlotStatChips(slot, obj, def) {
  if (!obj) return '';
  const E = def.hasEnergy;
  switch (slot) {
    case 'class': return cnChip('база ОН', obj.baseON) + cnChip('ОН/модуль', '+' + obj.modON);
    case 'type': return cnChip('HP', cnNum(obj.hp)) + cnChip('броня', cnNum(obj.armor)) + cnGsChip(obj.cost);
    case 'reactor': return cnChip('энергия', cnNum(obj.energy) + ' E') + cnGsChip(obj.cost);
    case 'armor': return cnChip('броня', '+' + cnNum(obj.armor)) + cnGsChip(obj.cost);
    case 'shield': return cnChip('щит', obj.shield ? cnNum(obj.shield) : 'нет') + (E && obj.energy ? cnChip('E', cnNum(obj.energy)) : '') + cnGsChip(obj.cost);
    case 'engine': return (window.KV_DB ? cnChip('тяга', cnNum(obj.force)) : cnChip('скорость', obj.speed + ' у.е.')) + (E && obj.energy ? cnChip('E', cnNum(obj.energy)) : '') + cnGsChip(obj.cost);
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
  // В KV-режиме покомпонентную цену не показываем — итог считается из решений.
  const pushPrice = (v) => { if (!window.KV_DB) push('Цена', v); };
  switch (info.kind) {
    case 'class':   push('База ОН', o.baseON); push('ОН за модуль', '+' + o.modON); if (o.types) push('Специализаций', o.types.length); break;
    case 'type':    push('Прочность', cnNum(o.hp) + ' HP'); push('Броня корпуса', '+' + cnNum(o.armor) + ' AR'); pushPrice(cnNum(o.cost) + ' ГС'); break;
    case 'reactor': push('Уровень', 'Ур. ' + ((info.idx || 0) + 1)); push('Выработка энергии', cnNum(o.energy) + ' E'); pushPrice(cnNum(o.cost) + ' ГС'); break;
    case 'armor':   push('Броня', '+' + cnNum(o.armor) + ' AR'); pushPrice(cnNum(o.cost) + ' ГС'); break;
    case 'shield':  push('Щит', o.shield ? cnNum(o.shield) + ' ед.' : 'нет'); if (E) push('Потребление', cnNum(o.energy || 0) + ' E'); pushPrice(cnNum(o.cost) + ' ГС'); break;
    case 'engine':  if (window.KV_DB) push('Тяга', cnNum(o.force)); else push('Скорость', o.speed + ' у.е.'); if (E) push('Потребление', cnNum(o.energy || 0) + ' E'); pushPrice(cnNum(o.cost) + ' ГС'); break;
    case 'radar': {
      const cp = o.customParameterradar || {};
      push('Дальность обзора', cp.dalnost ? cnNum(cp.dalnost) + ' кв' : 'нет');
      if (+cp.pwrPer > 0) push('От реактора', '+1 кв за ' + cnNum(cp.pwrPer) + ' E (до +' + (cp.pwrCap || 0) + ')');
      if (+cp.eccm > 0) push('Помехозащищённость', '−' + cp.eccm + ' к вражескому глушению');
      if (cp.diapazon) push('Диапазон', String(cp.diapazon).toUpperCase());
      if (o.power) push('Потребление', cnNum(o.power) + ' E');
      if (o.crewRequired) push('Экипаж', cnNum(o.crewRequired));
      if (o.capacityPenalty) push('Масса', cnNum(o.capacityPenalty) + ' кг');
      pushPrice(cnNum(o.cost) + ' ГС'); break;
    }
    case 'weapon':  push('Урон', cnNum(o.dmg)); if (E) push('Потребление', cnNum(o.energy || 0) + ' E'); pushPrice(cnNum(o.cost) + ' ГС'); break;
    case 'module': {
      if (E && o.energy) push('Потребление', cnNum(o.energy) + ' E');
      if (o.capacity) push('Грузовместимость', (o.capacity > 0 ? '+' : '') + cnNum(o.capacity));
      if (o.crewRequired) push('Экипаж', cnNum(o.crewRequired));
      const cb = o.combat || {};
      if (cb.pd) push('ПРО', 'сбивает ' + Math.round(cb.pd * 100) + '% ракет');
      if (cb.jam) push('РЭБ', '−' + cb.jam + ' к сенсорам врага (радиус 5)');
      if (cb.dejam) push('Контр-РЭБ', 'снимает до ' + cb.dejam + ' помех со своих (радиус 5)');
      if (cb.interdict) push('Интердикция', 'враг не вызывает подкрепления, пока модуль жив');
      if (cb.stabil) push('Стабилизация', 'своя сторона игнорирует интердикцию врага');
      if (cb.stealth) push('Маскировка', '+' + cb.stealth + ' к скрытности');
      if (cb.sensor) push('Сенсор', '+' + cb.sensor + ' к захвату радара');
      if (cb.hangar) push('Авиакрылья', '+' + Math.floor(cb.hangar / 300) + ' запуск(а) в бою');
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
  return `<div class="cn-info-card${on ? ' on' : ''}${locked ? ' locked' : ''}"${(action && !locked) ? ` onclick="${action}"` : ''}>
    ${cnImgTag(info.imgPath, 'cn-info-img')}
    <div class="cn-info-body">
      <div class="cn-info-nm">${locked ? '🔒 ' : ''}${info.kind === 'reactor' ? `<span class="cn-info-lvl">Ур. ${(info.idx || 0) + 1}</span> ` : ''}${esc(info.obj.name)}${on ? ' <span class="cn-info-cur">установлено</span>' : ''}</div>
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
  // Корвет — стремительный дротик: длинный игольчатый нос, короткие крылья за миделем,
  // резкий срез задней кромки крыла, узкая корма.
  corvette: [
    [0.00, 0.00], [0.08, 0.14], [0.26, 0.36], [0.44, 0.58], [0.52, 0.72],
    [0.58, 1.00], [0.68, 0.96], [0.74, 0.62], [0.88, 0.58], [1.00, 0.46],
  ],
  // Фрегат — клин с боковыми спонсонами: умеренный нос, резкий вынос спонсонов
  // к миделю, ступень внутрь и сужающаяся корма.
  frigate: [
    [0.00, 0.00], [0.07, 0.22], [0.20, 0.46], [0.34, 0.62], [0.42, 0.66],
    [0.46, 0.92], [0.62, 1.00], [0.70, 0.72], [0.84, 0.68], [0.92, 0.56], [1.00, 0.44],
  ],
  // Эсминец — длинный клинок: быстрый набор ширины, почти параллельные борта
  // на большей части длины, скошенный подзор кормы.
  destroyer: [
    [0.00, 0.00], [0.05, 0.16], [0.14, 0.44], [0.24, 0.78], [0.34, 0.92],
    [0.42, 0.94], [0.50, 1.00], [0.78, 0.98], [0.84, 0.80], [0.92, 0.76], [1.00, 0.60],
  ],
  // Крейсер — хищные скулы: ширина набирается прямо у носа, длинный мидель,
  // талия и лёгкий развал у машинного (гондолы двигателей).
  cruiser: [
    [0.00, 0.00], [0.05, 0.28], [0.12, 0.58], [0.22, 0.86], [0.30, 1.00],
    [0.52, 0.98], [0.60, 0.84], [0.72, 0.82], [0.82, 0.86], [0.92, 0.72], [1.00, 0.52],
  ],
  // Линкор — тяжёлая плита: ТУПОЙ бронированный форштевень (не игла), широченный
  // мидель во всю длину, ступень-каземат по борту, широкая корма.
  battleship: [
    [0.00, 0.22], [0.04, 0.40], [0.12, 0.62], [0.22, 0.78], [0.30, 0.84],
    [0.36, 1.00], [0.64, 1.00], [0.72, 0.86], [0.80, 0.84], [0.90, 0.78], [1.00, 0.68],
  ],
  // Дредноут — монумент: таранный шпиль-форштевень, расширение ДВУМЯ ступенями
  // (ярусы надстроек), максимальный бимс ближе к корме, массивный транец.
  dreadnought: [
    [0.00, 0.00], [0.10, 0.18], [0.16, 0.38], [0.24, 0.42], [0.32, 0.66],
    [0.40, 0.70], [0.50, 0.92], [0.58, 1.00], [0.76, 1.00], [0.86, 0.90], [0.94, 0.84], [1.00, 0.72],
  ],
  // Авианосец — плавучий аэродром: тупой нос, широченная почти прямоугольная
  // полётная палуба во всю длину, скруглённый транец. (supportCarrier)
  carrier: [
    [0.00, 0.30], [0.06, 0.55], [0.14, 0.80], [0.22, 0.90], [0.30, 0.94],
    [0.42, 0.96], [0.60, 0.96], [0.72, 0.94], [0.82, 0.92], [0.92, 0.86], [1.00, 0.74],
  ],
  // Штурмовой авианосец — клин с угловой палубой: острее носовая часть, палуба
  // выносится к борту ступенью, зауженная корма. (multiroleCarrier)
  assault: [
    [0.00, 0.10], [0.08, 0.34], [0.18, 0.60], [0.28, 0.78], [0.38, 0.88],
    [0.50, 0.92], [0.64, 0.94], [0.76, 0.90], [0.86, 0.82], [0.94, 0.72], [1.00, 0.58],
  ],
  // Гиперкрейсер — сверхдлинный дротик: тонкий нос, плавный длинный набор ширины,
  // почти параллельные борта, разнесённые гондолы двигателей у кормы. (hyperCruiser)
  hypercruiser: [
    [0.00, 0.00], [0.06, 0.20], [0.16, 0.44], [0.28, 0.66], [0.40, 0.80],
    [0.50, 0.86], [0.62, 0.88], [0.74, 0.90], [0.84, 0.72], [0.92, 0.66], [1.00, 0.50],
  ],
  // Станция (ss13) — не корабль, а узловой хаб: симметричная короткая широкая
  // «шайба» с тупыми оконечностями. (ss13)
  station: [
    [0.00, 0.40], [0.08, 0.66], [0.18, 0.86], [0.30, 0.96], [0.42, 1.00],
    [0.58, 1.00], [0.70, 0.96], [0.82, 0.86], [0.92, 0.66], [1.00, 0.44],
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
  corvette:    [70, 300, 34, 5],
  frigate:     [66, 320, 42, 6],
  destroyer:   [62, 340, 40, 7],
  cruiser:     [66, 336, 56, 7],
  battleship:  [60, 354, 68, 8],
  dreadnought: [54, 372, 82, 9],
  carrier:     [58, 366, 78, 9],
  assault:     [60, 360, 72, 8],
  hypercruiser:[56, 374, 52, 8],
  station:     [92, 320, 88, 7],
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
  let rows = g.rows, m = cnGenMounts(g, rows);
  while (m.length < need && rows < 22) { rows++; m = cnGenMounts(g, rows); }
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
// Сектор обстрела орудия (клин от узла): dir — азимут в градусах, spread — полураствор
function cnArcPath(x, y, dir, spread, r) {
  const a0 = (dir - spread) * Math.PI / 180, a1 = (dir + spread) * Math.PI / 180;
  return `M${x},${y} L${(x + r * Math.cos(a0)).toFixed(1)},${(y + r * Math.sin(a0)).toFixed(1)} A${r},${r} 0 0 1 ${(x + r * Math.cos(a1)).toFixed(1)},${(y + r * Math.sin(a1)).toFixed(1)} Z`;
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
function cnShipDecal(H, k) {
  // Нет имени — нет декали. Никаких заглушек-плейсхолдеров на борту.
  const name = ((cnId('cn-name') || {}).value || '').trim().toUpperCase();
  if (!name) return '';
  const fac = CN.myApp || {};
  const col = fac.color || '#cfd6dd';
  // ПОСАДКА: ЛЕВЫЙ НИЗ ПОЯСА БРОНИ на экране. Сцена развёрнута на 90° (нос
  // вправо, правый борт x>160 → низ экрана), значит «левый низ» в координатах
  // корпуса = кормовой участок правого борта. Текст ЛОЖИТСЯ НА КРИВУЮ (textPath
  // по средней линии пояса: кольцо силуэт hw ↔ шов палубы 0.55·hw), т.е.
  // повторяет форму брони, а не режется клипом на изломах силуэта. Кегль — от
  // фактической толщины пояса; длина при нехватке дожимается textLength.
  const sternY = H.engine[1] - 4, margin = 3;
  const hwAt = y => cnHullHalf(H, y);
  const gap = 2.5;
  // Опорные точки средней линии пояса: от кормы (с отступом) к носу.
  const pts = [];
  for (let y = sternY - margin; y >= H.nose + 4; y -= 2) {
    const h = hwAt(y);
    pts.push({ y, x: 160 + h * 0.775, th: h * 0.45 });   // th = толщина кольца брони в этом сечении
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
    for (let f = 3.1; f >= 1.5 && !fit; f -= 0.15) {
      const fw = f + 3, natural = name.length * f * 0.68, need = fw + gap + natural;
      for (let s = 0; s < pts.length; s++) {
        if (nearStern && acc[s] > 14) break;             // кормовой проход: дальше не уходим
        if (pts[s].th < f * 1.4) continue;               // пояс тоньше строки — скользим к носу
        let e = s;
        while (e + 1 < pts.length && pts[e + 1].th >= f * 1.4) e++;
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
    // своя текстура щита: ship_shieldtex_<класс>_<номер щита> → общий ship_shieldtex_<класс>
    const shTex = cnFirstImg([cnImgPath(CN.cat, 'shieldtex', k, sIdx), cnImgPath(CN.cat, 'shieldtex', k), `assets/constructors/${CN.cat}_shieldtex.webp`]);
    P.push(`<g class="cn-shieldfx">${cnShieldSvg(H, sIdx, rt, shieldD, shTex)}</g>`);
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

  // КОРПУС: если загружен арт-тело (ship_type_<k>_<t>.webp → ship_class_<k>.webp) —
  // показываем его как корабль (обрезка по силуэту). Иначе — ЧИСТЫЙ гранёный силуэт
  // (прямые грани = механический вид), минимум акцентов: пояс, осевая, мостик, реактор.
  const maxAr = Math.max(...db.armors[k].map(a => a.armor)) || 1, aRt = (armorObj ? armorObj.armor : 0) / maxAr;
  const sw = (1.4 + aRt * 2.0).toFixed(1), beltW = +(1 - (0.03 + aRt * 0.07)).toFixed(3);
  const hullPath = cnPolyPath(cnHullOutlinePts(H.st, 1));
  const brY = H.nose + (e[1] - H.nose) * 0.24, coreCy = H.nose + (e[1] - H.nose) * 0.56;
  // Фолбэк на ОБЩИЙ файл без суффикса класса (ship_<kind>.webp): одна текстура на ВСЕ классы,
  // если под конкретный класс свой файл не залит. Порядок: подкласс → класс → общий.
  const cnGenImg = kind => `assets/constructors/${CN.cat}_${kind}.webp`;
  const typeImg = cnImgPath(CN.cat, 'type', k, tIdx), classImg = cnImgPath(CN.cat, 'class', k);
  const bodyImg = cnFirstImg([typeImg, classImg, cnGenImg('class')]);
  // ОФОРМЛЕНИЕ КОРПУСА из файлов (все слои опциональны, обрезаются по силуэту):
  //  · текстура брони ship_armortex_<класс>_<номер брони> → ship_armortex_<класс> — обшивка
  //    выбранной брони поверх тела (плиты, клёпка, керамика…);
  //  · декор ship_decor_<класс>_<подкласс> → ship_decor_<класс> — эмблемы, полосы, надписи
  //    (PNG/WebP с прозрачностью) — рисуется ПОВЕРХ всего корпуса.
  // Арт кладётся горизонтально (нос вправо) — как и арт-тело.
  const aIdx = +cnId('cn-armor').value || 0;
  const armorTex = cnFirstImg([cnImgPath(CN.cat, 'armortex', k, aIdx), cnImgPath(CN.cat, 'armortex', k), cnGenImg('armortex')]);
  const decorImg = cnFirstImg([cnImgPath(CN.cat, 'decor', k, tIdx), cnImgPath(CN.cat, 'decor', k), cnGenImg('decor')]);
  // Арт тянется по ПОЛНОМУ силуэту (tipY..корма), а не от H.nose — иначе кончик носа без текстуры
  const Ln = e[1] - tipY, Bm = H.maxHW * 2, cyMid = (tipY + e[1]) / 2;
  const cnBodyArt = (img, op, blend, clip) => `<g clip-path="url(#${clip || 'cnBodyClip'})"${op != null ? ` opacity="${op}"` : ''}${blend ? ` style="mix-blend-mode:${blend}"` : ''}>`
    + `<g transform="translate(160 ${cyMid.toFixed(1)}) rotate(90)">`
    + `<image href="${esc(img)}" xlink:href="${esc(img)}" x="${(-Ln / 2).toFixed(1)}" y="${(-Bm / 2).toFixed(1)}" width="${Ln.toFixed(1)}" height="${Bm.toFixed(1)}" preserveAspectRatio="xMidYMid slice"/></g></g>`;
  P.push(`<clipPath id="cnBodyClip"><path d="${hullPath}"/></clipPath>`);
  // ПОЯС БРОНИ: кольцо между силуэтом и внутренним контуром — обшивка лежит ТОЛЬКО по бортам,
  // палуба (арт-тело) остаётся видна в центре. Дырка через clip-rule=evenodd.
  const beltInner = cnPolyPath(cnHullOutlinePts(H.st, 0.55));
  P.push(`<clipPath id="cnBeltClip" clip-rule="evenodd"><path clip-rule="evenodd" d="${hullPath} ${beltInner}"/></clipPath>`);
  // ПАДАЮЩАЯ ТЕНЬ корабля на чертёжное полотно — «отрывает» корпус от фона.
  P.push(`<path d="${hullPath}" fill="#000" opacity="0.38" style="filter:blur(9px)"/>`);
  // Базовый корпус: НЕЙТРАЛЬНЫЙ графит (без голубого) — цвет дают текстуры, не линии.
  P.push(`<path d="${hullPath}" fill="color-mix(in srgb, #aeb6bd 8%, var(--b2))" stroke="color-mix(in srgb, #cfd6dd 40%, transparent)" stroke-width="${sw}" stroke-linejoin="round"/>`);
  // ── ВСПОМОГАТЕЛЬНОЕ ОФОРМЛЕНИЕ (греблинг): переборки, шпангоуты, мостик, реактор.
  //    Рисуется И на голом силуэте, И ПОВЕРХ арт-тела — чтобы загруженная картинка
  //    читалась как построенный корабль, а не наклейка. `att` = приглушение над артом.
  // over=true → корпус закрыт текстурой: НЕ дублируем панельные линии (они уже в текстуре),
  // рисуем оформление как ГРАВИРОВКУ по обшивке — тёмная резьба + тонкий блик, а не неон
  // поверх. Реактор/мостик — функциональные метки, приглушённые под фактуру.
  const cnHullDetail = (over) => {
    const D = [];
    // Гравированная линия: тёмная канавка + световой кант (читается на любой текстуре, не спорит).
    const engrave = (x1, y1, x2, y2, w) => over
      ? `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${(w + 0.6).toFixed(1)}" opacity="0.28"/>`
        + `<line x1="${x1}" y1="${(+y1 + 0.6).toFixed(1)}" x2="${x2}" y2="${(+y2 + 0.6).toFixed(1)}" stroke="var(--w2)" stroke-width="${w}" opacity="0.09"/>`
      : `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--w2)" stroke-width="${w}" opacity="0.3"/>`;
    // осевая линия
    D.push(engrave('160', (H.nose + 4).toFixed(1), '160', (e[1] - 6).toFixed(1), 1));
    if (!over) {                                        // на голом силуэте нужны панели-переборки и рёбра
      [0.22, 0.44, 0.66, 0.82].forEach(t => {
        const y = H.nose + (e[1] - H.nose) * t, hw = cnHullHalf(H, y) * beltW;
        if (hw < 6) return;
        D.push(`<line x1="${(160 - hw).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(160 + hw).toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--w2)" stroke-width="0.7" opacity="0.28"/>`);
      });
      for (let t = 0.14; t < 0.9; t += 0.09) {
        const y = H.nose + (e[1] - H.nose) * t, hw = cnHullHalf(H, y) * beltW;
        if (hw < 10) continue;
        [-1, 1].forEach(s => D.push(`<line x1="${(160 + s * hw).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(160 + s * (hw - 5)).toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--w2)" stroke-width="0.6" opacity="0.22"/>`));
      }
    }
    // Мостик и реактор НЕ рисуются (убраны в июле 2026 по требованию: лишние пятна на текстуре).
    return D.join('');
  };
  // СВЕТОТЕНЬ по корпусу — «сажает» арт в силуэт: боковой свет→тень (объём цилиндра),
  // широкое AO по кромке + контактная тень. Никаких цветных линий — только свет.
  const cnHullEdgeShade = () => {
    const x0 = (160 - H.maxHW).toFixed(1), x1 = (160 + H.maxHW).toFixed(1);
    return `<linearGradient id="cnSideLight" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${x1}" y2="0">`
      + `<stop offset="0" stop-color="#fff" stop-opacity="0.09"/><stop offset="0.42" stop-color="#fff" stop-opacity="0"/>`
      + `<stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.24"/></linearGradient>`
      + `<g clip-path="url(#cnBodyClip)">`
      + `<path d="${hullPath}" fill="url(#cnSideLight)"/>`
      + `<path d="${hullPath}" fill="none" stroke="#000" stroke-width="16" stroke-linejoin="round" opacity="0.4" style="filter:blur(7px)"/>`
      + `<path d="${hullPath}" fill="none" stroke="#000" stroke-width="4" stroke-linejoin="round" opacity="0.5" style="filter:blur(1.5px)"/>`
      + `</g>`;
  };
  // Шов пояса брони = ТЕНЬ: плита брони чуть возвышается и роняет мягкую тень на палубу,
  // сверху едва заметный блик скола — вместо цветной линии.
  const cnBeltSeam = () => `<g clip-path="url(#cnBodyClip)">`
    + `<path d="${beltInner}" fill="none" stroke="#000" stroke-width="3" opacity="0.45" stroke-linejoin="round" style="filter:blur(1.5px)"/>`
    + `<path d="${beltInner}" fill="none" stroke="var(--w2)" stroke-width="0.6" opacity="0.22" stroke-linejoin="round"/></g>`;
  if (bodyImg) {                                       // АРТ-ТЕЛО, обрезанное по силуэту корпуса
    P.push(cnBodyArt(bodyImg)
      + (armorTex ? cnBodyArt(armorTex, 0.92, null, 'cnBeltClip') + cnBeltSeam() : '')  // броня ТОЛЬКО поясом по бортам
      + cnShipDecal(H, k)                              // декаль (флаг+имя) ПОД светотенью — краска на броне
      + cnHullEdgeShade()                              // светотень: боковой свет, AO, контактная тень
      + cnHullDetail(true)                             // оформление ПОВЕРХ арта — тенями, в лад с текстурой
      // Кант корпуса: тёмный обжим + тонкая приглушённая линия ВМЕСТО жирного неона —
      // текстура остаётся главной, контур лишь собирает силуэт.
      + `<path d="${hullPath}" fill="none" stroke="#000" stroke-width="${(+sw + 1.2).toFixed(1)}" stroke-linejoin="round" opacity="0.45"/>`
      + `<path d="${hullPath}" fill="none" stroke="color-mix(in srgb, #cfd6dd 50%, transparent)" stroke-width="0.9" stroke-linejoin="round" opacity="0.55"/>`);
  } else {                                             // ЧИСТЫЙ ГРАНЁНЫЙ СИЛУЭТ (фолбэк без арта)
    P.push(`<path d="${cnPolyPath(cnHullOutlinePts(H.st, beltW))}" fill="var(--b1)" stroke="color-mix(in srgb, #cfd6dd 30%, transparent)" stroke-width="0.7" stroke-linejoin="round"/>`);
    P.push(`<path d="${cnPolyPath(cnHullOutlinePts(H.st, Math.max(0.2, beltW - 0.2)))}" fill="none" stroke="var(--w2)" stroke-width="0.6" opacity="0.35" stroke-linejoin="round"/>`);
    if (armorTex) { P.push(cnBodyArt(armorTex, 0.92, null, 'cnBeltClip')); P.push(cnBeltSeam()); }  // броня поясом по бортам
    P.push(cnShipDecal(H, k));                         // декаль (флаг+имя) и на голом силуэте
    P.push(cnHullDetail(false));                       // полный греблинг на голом силуэте
  }
  // ДЕКОР (эмблемы/полосы/тактические надписи с прозрачным фоном) — поверх всего корпуса
  if (decorImg) P.push(cnBodyArt(decorImg));

  // ── Расчёт посадочных мест ЗАРАНЕЕ: узлы орудий, отсеки — чтобы связать их магистралями ──
  const bayN = L.bays.length;
  const maxMounts = Math.max(16, L.mounts.length);
  const wpnMounts = cnMountPositions(H, maxMounts);
  const mPos = i => { const s2 = L.mounts[i]; return (s2 && s2.pos) ? [s2.pos.x, s2.pos.y] : wpnMounts[i]; };
  let rooms = [];
  if (CN.schemShow.bays) {
    const baseRooms = Math.max(5, Math.round((e[1] - H.nose) / 40));
    rooms = cnHullRooms(H, Math.max(baseRooms, bayN));
  }

  // ОТСЕКИ/МОДУЛИ: лёгкие кликабельные ячейки. Занятый модуль — заливка + значок;
  // пустой активный — тонкий пунктир; свободное место — почти прозрачно (не спорит с телом).
  // Без коридора/люков/переборок — только то, что несёт смысл (где стоит модуль).
  let modCount = 0;
  if (CN.schemShow.bays) {
    rooms.forEach((rm, i) => {
      const active = i < bayN, m = active && L.bays[i] && L.bays[i].m; if (m) modCount++;
      const pts = rm.poly.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      const fill = m ? 'color-mix(in srgb, var(--gd) 22%, transparent)' : 'transparent';
      const stroke = m ? 'var(--gd)' : active ? 'var(--t3)' : 'transparent';
      const title = m ? 'Модуль: ' + esc((((db.modules[m.g] || [])[m.idx]) || {}).name || 'снят с производства') : active ? 'Пустой отсек — нажми: поставить модуль или удалить' : 'Внутреннее пространство — нажми, чтобы сделать отсек';
      P.push(`<g class="cn-bay" style="cursor:pointer" onclick="${active ? `cnNodeClick('bay',${i})` : `cnRoomAddAt(${i})`}"><title>${title}</title>`
        + `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${m ? 1.2 : 0.8}" stroke-linejoin="round" stroke-dasharray="${active && !m ? '3 3' : '0'}" opacity="${m ? 0.95 : active ? 0.45 : 0.16}"/>`
        + `${m ? cnModuleMarker(L.bays[i].m.g, rm.cx, rm.cy) : ''}</g>`);
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
      const dir = p[0] < 155 ? 180 : p[0] > 165 ? 0 : -90;   // сектор обстрела: от борта наружу, с центра — вперёд
      // Если для орудия загружена картинка — ставим её в узел (круглый «барбет»),
      // иначе рисуем векторную башню. Полотно повёрнуто на 90° → арт контр-вращаем.
      const wImg = cnImgPath(CN.cat, 'weapon', cnGroupSlug(CN.cat, 'weapon', w.g), w.idx);
      let art;
      if (cnWpnImgReady(wImg)) {
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
      } else art = `<g style="filter:drop-shadow(0 0 2.5px rgba(0,0,0,0.75))">${cnTurretSvg(p, vis, dir)}</g>`;
      // Прозрачная зона захвата — ПОВЕРХ арта (последним): арт с drop-shadow хиттестится только
      // по непрозрачным пикселям, из-за чего центр турели «проваливался». Круг сверху ловит клик
      // по всей области, включая центр (у сектора обстрела .cn-arc pointer-events отключён).
      const hitR = (10 + 5 * vis.wt).toFixed(1);
      nodeMk.push(`<g class="cn-node" style="cursor:grab" onpointerdown="cnMountPointerDown(event,${i})"><title>${esc(item.name)} · тащи, чтобы переместить · клик — настроить</title><path class="cn-arc" d="${cnArcPath(p[0], p[1], dir, 34, 20 + 10 * vis.wt)}" fill="${vis.color}" opacity="0"/>${art}<circle cx="${p[0]}" cy="${p[1]}" r="${hitR}" fill="transparent"/></g>`);
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
  const capTx = `ОРУДИЯ ${wpnCount}/${L.mounts.length} · ОТСЕКИ ${modCount}/${L.bays.length}` + (hangars.length ? ` · АНГАРЫ ${hangars.length}` : '');
  const cnCb = (x, y, dx, dy) => `<path d="M${x + dx * 14},${y} L${x},${y} L${x},${y + dy * 14}" fill="none" stroke="var(--te)" stroke-width="1.4" opacity="0.6"/>`;
  const deco = `<defs><pattern id="cnGrid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0v30" fill="none" stroke="var(--w1)" stroke-width="0.6"/></pattern></defs>`
    + `<rect x="0" y="0" width="${VW}" height="${VH}" fill="url(#cnGrid)" opacity="0.35"/>`
    + axis
    + cnCb(14, 12, 1, 1) + cnCb(VW - 14, 12, -1, 1) + cnCb(14, VH - 12, 1, -1) + cnCb(VW - 14, VH - 12, -1, -1)
    + `<text x="30" y="${VH - 16}" style="font:700 12px var(--font-mono);letter-spacing:2.5px;fill:var(--t4)">${esc(k.toUpperCase())} // ${esc(cls.name.toUpperCase())}${tName ? ' · ' + esc(tName.toUpperCase()) : ''}</text>`
    + `<text x="${VW - 30}" y="${VH - 16}" text-anchor="end" style="font:600 11px var(--font-mono);letter-spacing:1.5px;fill:var(--te)">${capTx}</text>`;
  host.innerHTML = `<svg viewBox="0 0 ${VW} ${VH}" class="cn-schem-svg" role="img" aria-label="Схема корабля вид сверху (горизонтально)">${deco}<g id="cn-schem-g" transform="${gT}">${P.join('')}</g><g class="cn-schem-ann">${anns}</g></svg>`;
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
    if (CN.schemShow.bays) L.bays.forEach((slot, i) => {
      const m = slot && slot.m, item = m ? ((db.modules[m.g] || [])[m.idx] || null) : null;
      rows.push(cnSlotRow('bay', i, '▦', 'Отсек ' + (i + 1), item ? esc(item.name) : 'Пусто — поставить модуль', !!item));
    });
    listHost.innerHTML = rows.length ? rows.join('') : `<div class="cn-bill-none" style="padding:8px 2px">Нет узлов и отсеков — добавьте кнопками «＋ Узел» / «＋ Отсек» на схеме.</div>`;
  }
}

// ── Ручное размещение: добавить узел/отсек, назначить/убрать содержимое, скрыть слой ──
function cnLayoutAdd(kind) { if (!CN.shipLayout) CN.shipLayout = { mounts: [], bays: [] }; if (kind === 'mount') CN.shipLayout.mounts.push({ w: null }); else CN.shipLayout.bays.push({ m: null }); cnVehCalc(); }
function cnRoomAdd() { if (!CN.shipLayout) CN.shipLayout = { mounts: [], bays: [] }; CN.shipLayout.bays.push({ m: null }); cnVehCalc(); cnOpenAssignPicker('bay', CN.shipLayout.bays.length - 1); }
// Клик по свободному месту создаёт слот ВРЕМЕННО (CN._pendingAdd): если пикер закрыли,
// ничего не поставив, cnClosePick откатывает добавленные пустышки — узлы не «плодятся сами».
function cnRoomAddAt(i) { if (!CN.shipLayout) CN.shipLayout = { mounts: [], bays: [] }; const a = CN.shipLayout.bays, n0 = a.length; while (a.length <= i) a.push({ m: null }); CN._pendingAdd = { kind: 'bay', n0 }; cnVehCalc(); cnOpenAssignPicker('bay', i); }
function cnMountAddAt(i) { if (!CN.shipLayout) CN.shipLayout = { mounts: [], bays: [] }; const a = CN.shipLayout.mounts, n0 = a.length; while (a.length <= i) a.push({ w: null }); CN._pendingAdd = { kind: 'mount', n0 }; cnVehCalc(); cnOpenAssignPicker('mount', i); }
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
    if (!cnGroupHasAvail(isW ? 'weapon' : 'module', k, group, source)) continue;
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
    const cards = source[active].map((item, i) => i).filter(i => cnItemAvail(isW ? 'weapon' : 'module', k, active, i)).map(i => { const info = cnCompInfo(isW ? 'weapon' : 'module', active, i); info.on = !!(cur && cur.g === active && cur.idx === i); return cnCompFullHtml(info, `cnAssignSlot('${kind}',${slot},'${esc(active)}',${i})`); }).join('');
    secs = `<div class="cn-info-grid">${cards}</div>`;
  }
  if (!secs) secs = `<div class="cn-bill-none" style="padding:10px">${isW ? 'Нет доступного оружия этого класса' : 'Модули ещё не исследованы (вкладка «Исследования»)'}</div>`;
  const head = `<div class="cn-assign-head">${cur ? `<button class="btn btn-gh btn-sm" onclick="cnClearSlot('${kind}',${slot})">Оставить пустым</button>` : ''}<button class="btn btn-rd btn-sm" onclick="cnDeleteSlot('${kind}',${slot})">Удалить ${isW ? 'узел' : 'отсек'}</button></div>`;
  let ov = document.getElementById('cn-pick-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'cn-pick-ov'; ov.className = 'cn-modal-ov'; ov.onclick = e => { if (e.target === ov) cnClosePick(); }; document.body.appendChild(ov); }
  ov.classList.toggle('cn-cyb', !!(CN.def && CN.def.cardUI));
  ov.innerHTML = `<div class="cn-modal cn-pick-modal"><button class="cn-modal-x" onclick="cnClosePick()">✕</button><div class="cn-modal-name">${isW ? 'Орудие в узел' : 'Модуль в отсек'}</div>${head}${tabs}<div class="cn-pick-body">${secs}</div></div>`;
  ov.classList.add('show');
}
// Переключение калибра-фильтра в пикере узла (сохраняем выбор и перерисовываем тот же слот).
function cnAssignFilter(kind, slot, g) { CN.assignFilter = g; cnOpenAssignPicker(kind, slot, true); }
function cnAssignSlot(kind, slot, g, i) { const a = kind === 'mount' ? CN.shipLayout.mounts : CN.shipLayout.bays; if (!a[slot]) return; if (kind === 'mount') a[slot].w = { g, idx: i }; else a[slot].m = { g, idx: i }; cnClosePick(); cnVehCalc(); }
function cnClearSlot(kind, slot) { const a = kind === 'mount' ? CN.shipLayout.mounts : CN.shipLayout.bays; if (a[slot]) { if (kind === 'mount') a[slot].w = null; else a[slot].m = null; } cnClosePick(); cnVehCalc(); }
function cnDeleteSlot(kind, slot) {
  // Узел/отсек РЕАЛЬНО убирается из массива (раньше лишь очищался и висел пустым навсегда)
  const a = kind === 'mount' ? CN.shipLayout.mounts : CN.shipLayout.bays;
  a.splice(slot, 1);
  cnClosePick(); cnVehCalc();
}
// Внутренность карточки оружия/модуля (картинка + статы + описание)
function cnPartCardInner(type, g, idx) {
  const db = CN.def.db, E = CN.def.hasEnergy;
  const item = (type === 'weapon' ? db.weapons : db.modules)[g][idx];
  const slug = cnGroupSlug(CN.cat, type, g);
  const img = cnImgTag(cnImgPath(CN.cat, type, slug, idx), 'cn-comp-img');
  let chips;
  if (type === 'weapon') chips = cnChip('урон', cnNum(item.dmg)) + (E && item.energy ? cnChip('E', cnNum(item.energy)) : '') + cnGsChip(item.cost);
  else chips = (E && item.energy ? cnChip('E', cnNum(item.energy)) : '') + cnGsChip(item.cost);
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
    if (!cnGroupHasAvail(type, k, group, source)) continue;
    const cards = source[group].map((item, i) => i).filter(i => cnItemAvail(type, k, group, i)).map(i =>
      cnCompFullHtml(cnCompInfo(type, group, i), `cnPickPart('${type}','${esc(group)}',${i})`)).join('');
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
  (d.weapons || []).forEach(w => { if (w && w.g && !baseWpn.includes(w.g)) keys.add('wpn.' + cat + '.' + w.g); });
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
  const def = CN_DEFS[cat];
  cnMergeAlloys(def.db);         // дописать сплавы в db.armors[k] всех классов
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
              <button class="btn btn-gh btn-sm on" id="cn-tg-b" onclick="cnSchemToggle('bays')" title="Показать/скрыть отсеки">Отсеки</button>
            </div>
            <div class="cn-schem-tools">
              <button class="btn btn-gh btn-sm" onclick="cnLayoutAdd('mount')" title="Добавить узел орудия">＋ Узел</button>
              <button class="btn btn-gh btn-sm" onclick="cnLayoutAdd('bay')" title="Добавить отсек под модуль">＋ Отсек</button>
              ${def.hasHangars ? `<button class="btn btn-gh btn-sm" onclick="cnVehAddHangar()" title="Добавить ангар">＋ Ангар</button>` : ''}
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
  // ── СПЛАВ (алхимия): объём брони НЕ фиксирован, а масштабируется под корпус ──
  // Рецепт задаёт только материал (dF/tF/hF), качество и стойкости; «сколько брони
  // несёт корпус» берём из САМОГО класса (mass/gabarit + его конструкц. resurs как
  // прокси размера, взвешенные категорией сплава). Так один сплав корректно работает
  // и на пехотинце, и на линкоре — считается в контексте каждого конструктора.
  if (a._alloy) {
    let load = 0;
    const cr = cls.resurs;
    if (cr) load = (cr.blackmetall || 0) * bm + (cr.coloredmetall || 0) * cm
      + (cr.rudametall || 0) * rm + (cr.kristall || 0) * km + (cr.staarvis || 0) * sv;
    let base = (s + load) * dF * tF * hF;                 // s = mass/2000 + gabarit*2
    const q = (a.quality != null ? a.quality : 1);        // 0.1..1.6
    let hpA = base * (0.4 + 0.6 * q);                     // качество рецепта ×(0.46..1.36)
    if (a.hpPercentBoost) hpA *= (1 + a.hpPercentBoost);  // %HP катализатора — поверх
    hpA += (a.hpBoost || 0) * 0.2;                        // качеств. «пол» (ALLOY_FLOOR_K), чтобы мелкие корпуса (пехота/дроны) не обнулялись; для кораблей ничтожен
    return hpA;
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
    (CN.shipLayout && CN.shipLayout.mounts || []).forEach(mt => { if (!mt.w) return; const w = db.weapons[mt.w.g] && db.weapons[mt.w.g][mt.w.idx]; if (!w) return; cost += w.cost; on += cls.modON; dmg += w.dmg; if (def.hasEnergy) energyCons += (w.energy || 0); billWeapons.push({ w, q: 1 }); });
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

  let hp = typeObj ? typeObj.hp : cls.hp;
  let armor = (typeObj ? typeObj.armor : 0) + armorObj.armor;
  const shield = shieldObj.shield || 0;
  let speed = engObj.speed;
  const eMax = reactObj ? reactObj.energy : 0;
  // Ресурсная ведомость: корабли строятся по ней напрямую, наземка/авиация —
  // в составе дивизий (их bill агрегируется в дивизионный summary.bill).
  const bill = cnUnitBill(CN.cat === 'army' ? cnKvRealCat(k) : CN.cat, k, { typeObj, reactObj, armorObj, shieldObj, engObj, weapons: billWeapons, modules: billModules, hangars: billHangars });

  // СИНТЕЗ: математика Кваквантора поверх — HP от физики брони, скорость в «квадратах»,
  // ресурсы/экипаж/энергия/вместимость (наглядно в превью).
  let kv = null;
  if (typeof window !== 'undefined' && window.KV_DB) {
    hp = Math.round(cnKvArmorHp(cls, armorObj));
    armor = 0;
    speed = cnKvSpeed(cls, k, reactObj, engObj);
    const res = { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 };
    const addRes = (o, q) => { if (o && o.resurs) for (const key in res) res[key] += (o.resurs[key] || 0) * (q || 1); };
    [cls, reactObj, engObj, armorObj, shieldObj, radarObj].forEach(o => addRes(o, 1));
    let crew = cls.crewRequired || 0;
    let power = (reactObj && reactObj.power) || 0;
    let cap = cls.capacity || 0;
    power -= (engObj && engObj.power) || 0;
    power -= (shieldObj && shieldObj.power) || 0;
    cap += (armorObj && armorObj.capacityBoost) || 0;
    cap += (engObj && engObj.capacityBoost) || 0;
    if (radarObj) { crew += radarObj.crewRequired || 0; power -= radarObj.power || 0; cap -= radarObj.capacityPenalty || 0; }
    billWeapons.forEach(({ w, q }) => { q = q || 1; crew += (w.crewRequired || 0) * q; power -= (w.power || 0) * q; cap -= (w.capacityPenalty || 0) * q; addRes(w, q); });
    billModules.forEach(({ m }) => { crew += (m.crewRequired || 0); power -= (m.power || 0); cap += (m.capacity || 0); addRes(m, 1); });
    for (const key in res) res[key] = Math.round(res[key]);
    // ГС теперь из сырья (см. cnKvCost), а не из млн-прайсов Кваквантора.
    cost = cnKvCost(res, k);
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
    kv = { res, crew, power: Math.round(power), cap: Math.round(cap), radar: radarRange, eccm: radarEccm, rng: fireRange, speedUnit: 'квадрат' };
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
    <div class="cn-stat"><span>Грузоподъёмность</span><b class="${s.kv.cap < 0 ? 'cn-warn' : ''}">${cnNum(s.kv.cap)} кг</b></div>` : ''}
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
      + tile('cap', 'Груз', cnNum(s.kv.cap) + ' кг', s.kv.cap < 0 ? 'warn' : '', 'Остаток грузоподъёмности шасси/корпуса')
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
    d.weapons = L.mounts.filter(m => m.w).map(m => ({ g: m.w.g, idx: m.w.idx, q: 1 }));
    d.modules = L.bays.filter(b => b.m).map(b => ({ g: b.m.g, idx: b.m.idx }));
    d.layout = { mounts: L.mounts.map(m => ({ w: m.w ? { g: m.w.g, idx: m.w.idx } : null, pos: m.pos ? { x: m.pos.x, y: m.pos.y } : null })), bays: L.bays.map(b => b.m ? { g: b.m.g, idx: b.m.idx } : null) };
  } else {
    d.weapons = [...document.querySelectorAll('#cn-weapons .cn-row')].map(r => { const s = JSON.parse(r.querySelector('select').value); return { g: s.g, idx: s.idx, q: +(r.querySelector('input')?.value || 1) }; });
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
        return { w, pos };
      }), bays: (d.layout.bays || []).map(x => {
        let m = x ? { g: x.g, idx: x.idx } : null;
        if (m && !okM(m)) { m = null; dropped++; }
        return { m };
      }) };
    else CN.shipLayout = {
      mounts: (d.weapons || []).filter(w => okW(w) || !++dropped).flatMap(w => Array.from({ length: w.q || 1 }, () => ({ w: { g: w.g, idx: w.idx } }))),
      bays: (d.modules || []).filter(m => okM(m) || !++dropped).map(m => ({ m: { g: m.g, idx: m.idx } }))
    };
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
    if (CN.last.kv && CN.last.kv.cap < 0) { toast(`Перегруз по массе: лишние ${cnNum(-CN.last.kv.cap)} кг — снимите компоненты`, 'err'); return; }
    const def = CN.def, k = cnId('cn-class').value, cls = def.db.data[k];
    const typeObj = def.hasType ? cls.types[+cnId('cn-type').value || 0] : null;
    data = cnVehCollectData();
    // Финальный заслон эксплойта: ни одно орудие/модуль не должно быть недоступно
    // выбранному классу (карта availW/availM + excl). Блокируем, а не молча правим.
    const forbidden = cnForbiddenParts(data.class, data);
    if (forbidden.length) { toast(`Классу «${esc(cls.name)}» нельзя ставить: ${forbidden.slice(0, 4).map(esc).join(', ')}${forbidden.length > 4 ? ' и др.' : ''} — снимите эти компоненты`, 'err'); return; }
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
  if (!confirm('Удалить «' + (u.name || 'юнит') + '» безвозвратно?')) return;
  try {
    await dbDel('faction_units', 'id=eq.' + id);
    CN.catUnits = (CN.catUnits || []).filter(x => x.id !== id);
    cnCloseView();
    toast('Удалено', 'inf');
    cnPaintCatalog();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}
