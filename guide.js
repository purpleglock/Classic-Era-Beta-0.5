// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ── GUIDEBOOK — Гайдбук «Классическая Эра» ─────────────────────────────────

// Оглавление сгруппировано по темам: плоский список из 28 ссылок читается как
// свалка — в нём не видно, где кончается «как начать» и начинается «как воевать».
// Порядок групп = порядок разделов на странице (подсветка активного идёт сверху вниз).
const GB_TOC = [
  { group: 'Начало', items: [
    { id: 'gb-intro',      icon: '◈', label: 'С чего начать' },
    { id: 'gb-reg',        icon: '◷', label: 'Регистрация' },
    { id: 'gb-wizard',     icon: '⬡', label: 'Создание фракции' },
    { id: 'gb-doctrine',   icon: '⚑', label: 'Доктрина: все бонусы' },
  ] },
  { group: 'Держава и экономика', items: [
    { id: 'gb-economy',    icon: '◇', label: 'Экономика и доход' },
    { id: 'gb-colonies',   icon: '◉', label: 'Колонии и планеты' },
    { id: 'gb-capitals',   icon: '🪐', label: 'Планеты-столицы' },
    { id: 'gb-resources',  icon: '◆', label: 'Ресурсы и добыча' },
    { id: 'gb-buildings',  icon: '⌂', label: 'Здания' },
    { id: 'gb-prosperity', icon: '◈', label: 'Благосостояние' },
    { id: 'gb-budget',     icon: '🏛', label: 'Бюджет державы' },
    { id: 'gb-research',   icon: '✦', label: 'Технологии' },
  ] },
  { group: 'Война', items: [
    { id: 'gb-army',       icon: '⚔', label: 'Армия и флот' },
    { id: 'gb-war',        icon: '🔥', label: 'Война и битвы' },
    { id: 'gb-defense',    icon: '⛨', label: 'Оборона' },
    { id: 'gb-constructors', icon: '⚒', label: 'Конструкторы' },
    { id: 'gb-intel',      icon: '◐', label: 'Разведка и агенты' },
  ] },
  { group: 'Деньги и соседи', items: [
    { id: 'gb-trade',      icon: '⇄', label: 'Торговля и караваны' },
    { id: 'gb-exchange',   icon: '📊', label: 'Биржа' },
    { id: 'gb-raids',      icon: '🏴', label: 'Пиратство (флоты)' },
    { id: 'gb-diplo',      icon: '🤝', label: 'Дипломатия и союзы' },
    { id: 'gb-faith',      icon: '🛐', label: 'Вера и религия' },
  ] },
  { group: 'Галактика', items: [
    { id: 'gb-doom',       icon: '🜨', label: 'Оружие судного дня' },
    { id: 'gb-map',        icon: '⬢', label: 'Карта галактики' },
    { id: 'gb-novella',    icon: '❖', label: 'Новелла на главной' },
    { id: 'gb-precursors', icon: '⌘', label: 'Дозвёздные миры' },
    { id: 'gb-loop',       icon: '↻', label: 'Игровой день' },
    { id: 'gb-tips',       icon: '★', label: 'Советы новичку' },
  ] },
];
// Плоский список — для всего, что работает по разделам, а не по группам.
const GB_SECTIONS = GB_TOC.flatMap(g => g.items);

// ── Доктрина: точные модификаторы (зеркало EC_MODS из economy.js) ──
const GB_MOD = {
  // pct: положительное хорошо? grow=true → рост зелёный; grow=false → снижение зелёный
  gc:          { label: 'Доход',          grow: true,  pct: true },
  mine:        { label: 'Добыча',         grow: true,  pct: true },
  build:       { label: 'Цена построек',  grow: false, pct: true },
  colonize:    { label: 'Цена колоний',   grow: false, pct: true },
  claim_cost:  { label: 'Цена систем',    grow: false, pct: true },
  claim_cd:    { label: 'Перезарядка',    grow: false, pct: true },
  research:    { label: 'Цена науки',     grow: false, pct: true },
  sci_flat:    { label: 'Наука',          grow: true,  pct: false, suf: '/сут' },
};
const GB_GRANT = {
  trade: 'Торговый хаб', factory: 'Гражданская фабрика', military_factory: 'Военный завод',
  training: 'Центр подготовки', science: 'Научный институт', mining: 'Добывающий завод',
  intel: 'Центр спецслужб',
};

// ── Доктрина: числа берутся ЖИВЫМИ из EC_MODS (economy.js) — без дубля. ──
// Тип цивилизации хранит лишь flavor-текст (его нет в EC_MODS); моды — из EC_MODS.civ.
const GB_DOC_CIV = [
  ['frontier', 'Фронтир', 'Недавно основанное поселение на краю освоенного космоса. Несмотря на ограниченные ресурсы и трудности становления, энтузиазм колонистов позволяет развивать инфраструктуру в ускоренном темпе. Стартовый бонус: бесплатный Центр спецслужб.'],
  ['colony',   'Колония', 'Стабильное государство с развитой бюрократией и отлаженными цепочками поставок. Мощная экономика позволяет эффективно добывать ресурсы и возводить постройки, однако излишняя зарегулированность заметно усложняет процесс освоения новых секторов. Стартовый бонус: бесплатная Гражданская фабрика.'],
];
// Родные миры расы (метки групп планет) из EC_HAB + EC_GRP_LABEL.
function gbRaceHab(race) {
  if (typeof EC_HAB === 'undefined') return '';
  const lbl = (typeof EC_GRP_LABEL !== 'undefined') ? EC_GRP_LABEL : {};
  return (EC_HAB[race] || []).map(e => lbl[e] || e).join(', ');
}
// Порядок отображения планет-столиц в гайдбуке (данные — из EC_CAPITAL в economy.js).
const GB_CAP_ORDER = ['terrestrial', 'oceanic', 'desert', 'volcanic', 'lava', 'cryo', 'micro', 'exotic'];
// Какие расы получают этот родной мир (из EC_HAB в economy.js).
function gbCapRaces(env) {
  if (typeof EC_HAB === 'undefined') return '';
  return Object.keys(EC_HAB).filter(r => (EC_HAB[r] || []).includes(env)).join(', ');
}
function gbCapRows() {
  if (typeof EC_CAPITAL === 'undefined') return '';
  const lbl = (typeof EC_GRP_LABEL !== 'undefined') ? EC_GRP_LABEL : {};
  return GB_CAP_ORDER.filter(env => EC_CAPITAL[env]).map(env => {
    const c = EC_CAPITAL[env];
    const races = gbCapRaces(env);
    return `<div class="gb-cap-row">
      <div class="gb-cap-hd">
        <span class="gb-cap-title">🪐 ${c.title}</span>
        <span class="gb-cap-type">${lbl[env] || env}</span>
      </div>
      <div class="gb-cap-flavor">${c.flavor}</div>
      <div class="gb-cap-stats">
        <span class="gb-cap-stat">⬚ Ячейки: <b>${c.cells}</b></span>
        <span class="gb-cap-stat">◆ Стартовые ресурсы: <b>${c.res.join(', ')}</b></span>
      </div>
      <div class="gb-cap-chips">${gbChips(c.mods, null, null)}</div>
      ${races ? `<div class="gb-cap-races">Родной мир для: ${races}</div>` : ''}
    </div>`;
  }).join('');
}

// Один чип модификатора
function gbChip(field, val) {
  const m = GB_MOD[field]; if (!m || !val) return '';
  const good = m.grow ? val > 0 : val < 0;
  const sign = val > 0 ? '+' : '−';
  const abs = Math.abs(val);
  const num = m.pct ? `${Math.round(abs * 100)}%` : `${abs}${m.suf || ''}`;
  return `<span class="gb-chip ${good ? 'gb-chip-good' : 'gb-chip-bad'}">${m.label} ${sign}${num}</span>`;
}
// Все чипы доктрины + (опц.) грант-здание + грант-тех + бонус-слот
function gbChips(mods, grant, tech, slot) {
  const order = ['gc', 'mine', 'build', 'colonize', 'claim_cost', 'claim_cd', 'research', 'sci_flat'];
  let h = order.map(k => gbChip(k, mods[k])).join('');
  if (grant && GB_GRANT[grant]) h += `<span class="gb-chip gb-chip-grant">⌂ ${GB_GRANT[grant]}</span>`;
  if (tech) h += `<span class="gb-chip gb-chip-tech">✦ ${tech}</span>`;
  if (slot) h += `<span class="gb-chip gb-chip-tech">✦ +${slot} слот исследований</span>`;
  return h;
}
// Строит строки доктрины для категории cat (gov|regime|ideology|race) из ЖИВЫХ EC_MODS.
// Зеркало регистрации: грант-здание (EC_DOCTRINE_BUILD), тех (EC_DOCTRINE_TECH),
// бонус-слот (EC_DOCTRINE_SLOTS), родные миры (EC_HAB), сигнатура (EC_ARCHETYPE).
function gbDocRows(cat) {
  if (typeof EC_MODS === 'undefined' || !EC_MODS[cat]) return '';
  const builds = (typeof EC_DOCTRINE_BUILD !== 'undefined' && EC_DOCTRINE_BUILD[cat]) || {};
  const slots = (typeof EC_DOCTRINE_SLOTS !== 'undefined' && EC_DOCTRINE_SLOTS[cat]) || {};
  return Object.keys(EC_MODS[cat]).map(name => {
    const mods = EC_MODS[cat][name];
    const tech = (cat === 'ideology' && typeof EC_DOCTRINE_TECH !== 'undefined') ? EC_DOCTRINE_TECH[name] : null;
    const arch = (cat === 'ideology' && typeof EC_ARCHETYPE !== 'undefined') ? EC_ARCHETYPE[name] : null;
    const habitat = (cat === 'race') ? gbRaceHab(name) : '';
    const sig = arch && arch.signature ? `<span class="gb-doc-sig">★ ${arch.signature}</span>` : '';
    return `<div class="gb-doc-row">
      <div class="gb-doc-name">${name}${habitat ? `<span class="gb-doc-hab">Родные миры: ${habitat}</span>` : ''}${sig}</div>
      <div class="gb-doc-chips">${gbChips(mods, builds[name], tech, slots[name])}</div>
    </div>`;
  }).join('');
}
// Число вариантов в категории (для счётчика раскрывашки).
function gbDocCount(cat) { return (typeof EC_MODS !== 'undefined' && EC_MODS[cat]) ? Object.keys(EC_MODS[cat]).length : 0; }
// Строки для типа цивилизации (моды из EC_MODS.civ, имена/flavor — из GB_DOC_CIV).
function gbCivRows() {
  const civ = (typeof EC_MODS !== 'undefined' && EC_MODS.civ) || {};
  return GB_DOC_CIV.map(([key, name]) => `<div class="gb-doc-row">
      <div class="gb-doc-name">${name}</div>
      <div class="gb-doc-chips">${gbChips(civ[key] || {}, null, null)}</div>
    </div>`).join('');
}

// Оборачивает список строк доктрины в собственную раскрывашку с заголовком-категорией.
// label — название категории (Идеология, Форма правления…), count — число вариантов.
function gbDocCollapse(label, rowsHtml, count, open) {
  return `<details class="gb-collapse gb-doc-collapse"${open ? ' open' : ''}>
    <summary class="gb-collapse-sum"><span class="gb-collapse-ic">▸</span><span>${label}</span><span class="gb-collapse-hint">${count} вар.</span></summary>
    <div class="gb-doc-list">${rowsHtml}</div>
  </details>`;
}

// Богатство залежи: множитель темпа (зеркало EC_RICHNESS / public._richness_mult)
// и потолок залежи — _mine_cap(богатство) × 8, общий на все шахты колонии.
// Зеркало dep_cap из economy_accrue, сверено с БД 2026-07-29.
const GB_RICHNESS = [
  ['Следы',        0.6,   16], ['Мало',         1.0,  32], ['Умеренно',    1.5,  48],
  ['Много',        2.0,   64], ['Очень много',  2.5,  88], ['Колоссально', 3.0, 112],
];
function gbRichTable() {
  const rows = GB_RICHNESS.map(([n, m, cap]) =>
    `<tr><td>${n}</td><td><b>×${m.toFixed(1)}</b></td><td><b>${cap}/сут</b></td></tr>`).join('');
  return `<div class="gb-table-wrap"><table class="gb-table">
    <thead><tr><th>Богатство залежи (с карты)</th><th>Множитель темпа</th><th>Потолок залежи (все шахты колонии вместе; ×бонус доктрины)</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// Полная таблица ресурсов: иконка, редкость, персональная цена, добыча/слот и
// ГС/слот/сутки (цена × добыча). Данные — из каталога GalaxyGen (один источник).
const GB_RES_RATE = { common: 25, uncommon: 12, rare: 6, epic: 3, legendary: 1 };   // зеркало живого economy_accrue (сверено 2026-07-29)
const GB_RAR_N = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };
// Роль ресурса в механиках (по имени из GalaxyGen). Ресурс может иметь несколько ролей.
// fuel — топливо флота · army — сырьё на корабли/дивизии · goods — Фабрика товаров · doom — «Длань».
const GB_RES_ROLE = {
  'Железо': ['army', 'goods'], 'Силикаты': ['goods'], 'Лёд': ['goods'], 'Жидкая вода': ['goods'],
  'Углерод': ['fuel'], 'Метан': ['fuel'], 'Титан': ['army'], 'Редкоземельные руды': ['army'],
  'Изотопы': ['fuel', 'army'], 'Дейтерий': ['fuel', 'army'], 'Гелий-3': ['fuel', 'army'],
  'Старвис': ['fuel'], 'Стелларит': ['army'],
  'Гравиядро': ['doom'], 'Программируемая материя': ['doom'],
};
const GB_ROLE_TAG = {
  fuel:  { ic: '⛽', label: 'топливо' },
  army:  { ic: '⚔', label: 'армия' },
  goods: { ic: '🛍', label: 'товары' },
  doom:  { ic: '🜨', label: 'судный день' },
};
function gbRoleChips(name) {
  return (GB_RES_ROLE[name] || []).map(r => {
    const t = GB_ROLE_TAG[r]; if (!t) return '';
    return `<span class="gb-role gb-role-${r}">${t.ic} ${t.label}</span>`;
  }).join(' ') || '<span class="gb-role gb-role-sell">💰 продажа</span>';
}
function gbResFilter(cat, btn) {
  document.querySelectorAll('.gb-resfilter .gb-rf-btn').forEach(b => b.classList.toggle('on', b === btn));
  document.querySelectorAll('.gb-res-table tbody tr').forEach(tr => {
    tr.style.display = (cat === 'all' || (tr.dataset.roles || '').split(' ').includes(cat)) ? '' : 'none';
  });
}
function gbResTable() {
  const cat = (window.GalaxyGen && GalaxyGen.RESOURCES) || [];
  if (!cat.length) return '<p class="gb-muted">Каталог ресурсов недоступен.</p>';
  const ic = (R) => (GalaxyGen.resIconHtml ? GalaxyGen.resIconHtml(R.name, 'gb-res-ic') : (R.icon || ''));
  const rows = cat.slice().sort((a, b) => (a.price - b.price) || a.name.localeCompare(b.name)).map(R => {
    const rate = GB_RES_RATE[R.r] || 8;
    const roles = (GB_RES_ROLE[R.name] || []).join(' ');
    return `<tr data-roles="${roles}">
      <td><span class="gb-res-cell">${ic(R)} ${R.name}</span></td>
      <td><span class="gb-rar gb-rar-${GB_RAR_N[R.r] || 1}">${R.rname}</span></td>
      <td>${gbRoleChips(R.name)}</td>
      <td>${R.price} ГС</td>
      <td>${rate}</td>
      <td><b>${R.price * rate}</b></td>
    </tr>`;
  }).join('');
  const filters = [['all', '◆ Все'], ['fuel', '⛽ Топливо'], ['army', '⚔ Армия'], ['goods', '🛍 Товары'], ['doom', '🜨 Судный день']];
  const fbar = `<div class="gb-resfilter">${filters.map(([k, l], i) =>
    `<button class="gb-rf-btn${i === 0 ? ' on' : ''}" onclick="gbResFilter('${k}',this)">${l}</button>`).join('')}</div>`;
  return `${fbar}<div class="gb-table-wrap"><table class="gb-table gb-res-table">
    <thead><tr><th>Ресурс</th><th>Редкость</th><th>Роль</th><th>Цена/ед</th><th>Добыча постройки/сут</th><th>ГС с постройки/сут</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// Первый абзац раздела — вводный: крупнее и контрастнее остального текста
// (.gb-lead в css/19_guide.css). Помечаем разметку тут, а не руками в каждой
// секции: разделов под тридцать, и ручные классы разъезжаются при правках.
function gbMarkLeads() {
  document.querySelectorAll('.gb-main .gb-section').forEach(sec => {
    const p = sec.querySelector(':scope > p');
    if (p) p.classList.add('gb-lead');
  });
}

// Оборачивает большие таблицы гайда в раскрывашку <details> (свёрнуто по умолчанию).
function gbMakeCollapsible() {
  document.querySelectorAll('.gb-main .gb-table-wrap, .gb-main .gb-tbl').forEach(tbl => {
    if (tbl.closest('details')) return;
    const det = document.createElement('details');
    det.className = 'gb-collapse';
    const sum = document.createElement('summary');
    sum.className = 'gb-collapse-sum';
    sum.innerHTML = '<span class="gb-collapse-ic">▸</span><span>Раскрыть таблицу</span><span class="gb-collapse-hint">нажмите</span>';
    tbl.parentNode.insertBefore(det, tbl);
    det.appendChild(sum);
    det.appendChild(tbl);
  });
}

// ══════════════════════════════════════════════════════════════════════
// ИЛЛЮСТРАЦИИ МЕХАНИК — схемы рисуются прямо в SVG и темятся под движок
// (цвета берутся из CSS-переменных). Каждая обёрнута в <figure> с подписью.
// ══════════════════════════════════════════════════════════════════════
function gbFig(tag, svg, caption) {
  return `<figure class="gb-fig">
    ${svg}
    <figcaption class="gb-fig-cap"><span class="gb-fig-tag">${tag}</span><span>${caption}</span></figcaption>
  </figure>`;
}

// ── Базовые примитивы HTML-схем (текст переносится, ничего не вылезает) ──
// Узел-карточка: акцент-полоса слева + иконка + заголовок (+ подзаголовок).
// accent: '' золото · 'g' зелёный · 'b' синий · 'p' фиолетовый.
function gbNode(accent, icon, title, sub) {
  return `<div class="gb-node${accent ? ' gb-node--' + accent : ''}">
    <div class="gb-node-t">${icon ? `<span class="gb-node-ic">${icon}</span>` : ''}${title}</div>
    ${sub ? `<div class="gb-node-s">${sub}</div>` : ''}
  </div>`;
}
// Стрелка-коннектор. c: '' золото · 'g' · 'p' · 'err'.
function gbArr(c) { return `<span class="gb-arrow${c ? ' gb-arrow--' + c : ''}">→</span>`; }
// Цветная точка для легенды.
function gbDot(color) { return `<span class="gb-dot2" style="background:${color}"></span>`; }

// Экономический цикл: две струи дохода в казну + параллельная ветка науки.
function gbFigEconomy() {
  const lane = (tag, flow) => `<div class="gb-lane"><span class="gb-lane-tag">${tag}</span><div class="gb-flow">${flow}</div></div>`;
  const casna = gbNode('b', '💰', 'Казна ГС', '');
  const body = `<div class="gb-fig-body">
    ${lane('Сырьевой доход', gbNode('', '⛏', 'Добыча', 'ресурсы → склад') + gbArr() + gbNode('g', '💱', 'Сбыт ресурсов', 'караваны · биржа · экспорт') + gbArr('g') + casna)}
    ${lane('Доход построек', gbNode('', '🏭', 'Фабрики и хабы', '× просперити системы') + gbArr('g') + casna)}
    ${lane('Наука · параллельно', gbNode('p', '🔬', 'Научные институты', 'дают ОН') + gbArr('p') + gbNode('p', '✦', 'Технологии', 'усиления и юниты'))}
  </div>`;
  return gbFig('Экономический цикл', body, 'Деньги в казну текут двумя путями: <b>добыча → сбыт</b> и <b>фабрики/хабы</b> (× просперити). Наука идёт отдельной веткой и кормит технологии.');
}

// Караван: ваша добыча → флот в пути → партнёр → ГС обоим.
function gbFigCaravan() {
  const body = `<div class="gb-fig-body">
    <div class="gb-flow">
      ${gbNode('', '💱', 'Ваша добыча', 'режим «экспорт»')}
      ${gbArr('g')}
      ${gbNode('', '🚚', 'Торговый флот', '1–2 цикла в пути')}
      ${gbArr('g')}
      ${gbNode('', '🤝', 'Партнёр', 'торговое согласие')}
      ${gbArr('g')}
      ${gbNode('b', '💰', 'ГС обоим', 'партнёру +½ сверху')}
    </div>
    <div class="gb-fig-foot err">☠️ В пути грозят пираты — защищают <b>конвой 🛡</b> и <b>торговая политика 📜</b>. Отношения с партнёром дают <b>±20%</b> к выгоде.</div>
  </div>`;
  return gbFig('Торговый караван', body, 'Караван — <b>постоянное соглашение</b>: каждый цикл флот возит ваш поток добычи партнёру, и оба получают ГС.');
}

// Энергобаланс корабля: реактор задаёт лимит, модули его заполняют.
function gbFigShip() {
  const seg = (f, c) => `<div class="gb-pbar-seg" style="flex:${f};background:${c};opacity:.85"></div>`;
  const dot = (c, n) => `<span>${gbDot(c)}${n}</span>`;
  const body = `<div class="gb-fig-body">
    <div class="gb-pbar-lbl">⚡ Реактор задаёт лимит энергии (ширина полосы). Модули заполняют его потреблением:</div>
    <div class="gb-pbar">
      ${seg(30, 'var(--color-accent)')}${seg(22, 'var(--color-info)')}${seg(20, 'var(--color-lore)')}${seg(16, 'var(--color-warning)')}${seg(12, 'transparent')}
    </div>
    <div class="gb-pbar-scale"><span>← потребление модулей</span><span class="ok">предел = выработка реактора →</span></div>
    <div class="gb-legend2">
      ${dot('var(--color-accent)', 'оружие')}${dot('var(--color-info)', 'щиты')}${dot('var(--color-lore)', 'двигатели')}${dot('var(--color-warning)', 'системы')}${dot('var(--color-border-strong)', 'свободный запас')}
    </div>
    <div class="gb-rules2">
      <div class="gb-rule gb-rule--ok"><b>✔ потребление ≤ выработка</b><span>проект можно сохранить и построить</span></div>
      <div class="gb-rule gb-rule--err"><b>✘ перегрузка сети</b><span>постройка заблокирована — ставьте реактор мощнее</span></div>
    </div>
  </div>`;
  return gbFig('Энергобаланс корабля', body, 'Главное правило конструктора: <b>реактор даёт энергию</b>, модули её тратят. Ушёл остаток в минус — <b>компонент не встанет</b>: конструктор откатит последнее действие. Та же логика — у грузоподъёмности в килограммах.');
}

// Благосостояние: шкала просперити 0.85…1.30 + рычаг плотности.
function gbFigProsperity() {
  const body = `<div class="gb-fig-body">
    <div class="gb-flow" style="margin-bottom:12px">
      ${gbNode('', '🏭', 'Доход здания', 'слоты × …')}
      ${gbArr()}
      ${gbNode('b', '⚖', '× Труд системы', 'жители ÷ места')}
      ${gbArr('g')}
      ${gbNode('p', '🛍', '× Товары державы', '×0.90 … ×1.10')}
      ${gbArr('g')}
      ${gbNode('g', '💰', 'ГС в казну', '')}
    </div>
    <div class="gb-gauge-bar"></div>
    <div class="gb-gauge-zones"><span class="err">◄ нехватка рук · бедность</span><span class="ok">избыток рук · столица ►</span></div>
    <div class="gb-fig-foot"><b>Труд</b> — свой для каждой системы (плотность застройки). <b>Товары</b> — один множитель на всю державу (Фабрика товаров кормит население). <b>Столица всегда в зелёной зоне.</b></div>
  </div>`;
  return gbFig('Благосостояние — два множителя', body, 'Доход ГС-зданий = слоты × <b>труд системы</b> × <b>товары державы</b>. Мягкие полосы без обвалов.');
}

// Биржа: безтекстовый мини-график индекса (SVG) + HTML-чипы инструментов.
function gbFigExchange() {
  const data = [0, 8, 4, 16, 10, 24, 18, 30, 22, 40, 34, 44, 48, 58];
  const step = 680 / (data.length - 1);
  const poly = data.map((v, i) => `${(i * step).toFixed(0)},${(80 - v * 1.15).toFixed(0)}`).join(' ');
  const chips = ['🏢 Организации', '📋 Заказы', '🏛 Облигации', '📈 Маржа', '📅 Фьючерсы', '🎲 Опционы'].map(t => `<span>${t}</span>`).join('');
  const body = `<div class="gb-fig-body">
    <div class="gb-chart-hd"><b>📊 Официальный курс</b><span class="ok">▲ рост котировок</span></div>
    <svg class="gb-chart-svg" viewBox="0 0 680 84" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <line x1="0" y1="80" x2="680" y2="80" stroke="var(--color-border)" stroke-width="1"/>
      <polyline points="${poly}" fill="none" stroke="var(--ok)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="gb-chart-base">официальный курс — Биржевой совет пересчитывает раз в 3 часа</div>
    <div class="gb-chips2">${chips}</div>
  </div>`;
  return gbFig('Биржа', body, 'Поверх живого рынка — инструменты: <b>организации</b>, <b>заказы</b>, <b>облигации</b> и деривативы (<b>маржа · фьючерсы · опционы</b>). Сделки с долями — при открытых торгах.');
}

// Длань Неотвратимости: SVG-графика дуги (без текста) + HTML-легенда.
function gbFigDoom() {
  const A = 'var(--color-accent)', E = 'var(--err)', B = 'var(--color-info)';
  const svg = `<svg class="gb-fig-canvas" viewBox="0 0 680 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="80" cy="98" r="24" fill="${A}" opacity="0.15" stroke="${A}" stroke-width="2"/>
    <circle cx="80" cy="98" r="7" fill="${A}"/>
    <path d="M104,84 Q340,8 556,84" fill="none" stroke="${E}" stroke-width="2.5" stroke-dasharray="7 6"/>
    <circle cx="340" cy="38" r="5" fill="${E}"/>
    <circle cx="592" cy="98" r="28" fill="none" stroke="var(--color-border-strong)" stroke-width="1.5" stroke-dasharray="3 4"/>
    <circle cx="585" cy="92" r="13" fill="${B}" opacity="0.55"/>
    <circle cx="606" cy="108" r="8" fill="var(--color-text-faint)"/>
  </svg>`;
  const legend = `<div class="gb-fig-body" style="padding-top:14px">
    <div class="gb-flow">
      ${gbNode('', '🜨', 'Ваша система', 'орудие «Длань»')}
      ${gbArr('err')}
      ${gbNode('', '☄️', 'Залп', '−20 Гравиядра · полёт 3–24 ч')}
      ${gbArr('err')}
      ${gbNode('b', '🪨', 'Цель', 'планета → мёртвый камень')}
    </div>
  </div>`;
  return gbFig('Межзвёздная артиллерия', svg + legend, 'Залп из вашей системы по планете <b>в другой системе</b> навсегда превращает её в мёртвый камень. Время полёта зависит от дистанции; орудие со временем деградирует.');
}

// Карта галактики: SVG-графика (без текста) + HTML-легенда.
function gbFigMap() {
  const A = 'var(--color-accent)', B = 'var(--color-info)', N = 'var(--color-text-faint)';
  const sys = (x, y, c, star) => star
    ? `<path d="M${x},${y - 9} l2.6,5.6 6.1,.6 -4.6,4.1 1.3,6 -5.4,-3.1 -5.4,3.1 1.3,-6 -4.6,-4.1 6.1,-.6 Z" fill="${c}"/>`
    : `<circle cx="${x}" cy="${y}" r="5" fill="${c}"/>`;
  const lane = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--color-border-medium)" stroke-width="1.2"/>`;
  const svg = `<svg class="gb-fig-canvas" viewBox="0 0 680 230" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="30" y="26" width="300" height="180" rx="16" fill="var(--color-lore)" opacity="0.06" stroke="var(--color-lore)" stroke-width="1" stroke-dasharray="6 6"/>
    <path d="M70,86 Q60,146 110,176 Q180,196 210,146 Q230,106 180,76 Q120,66 70,86 Z" fill="${A}" opacity="0.09" stroke="${A}" stroke-width="1.5"/>
    <path d="M380,66 Q360,126 410,166 Q500,196 560,146 Q600,96 540,71 Q450,51 380,66 Z" fill="${B}" opacity="0.09" stroke="${B}" stroke-width="1.5"/>
    <line x1="245" y1="56" x2="245" y2="196" stroke="var(--err)" stroke-width="2" stroke-dasharray="4 5"/>
    ${lane(110, 146, 160, 106)}${lane(160, 106, 120, 91)}${lane(160, 106, 200, 146)}
    ${lane(430, 146, 470, 96)}${lane(470, 96, 540, 116)}${lane(430, 146, 500, 156)}
    ${lane(200, 146, 430, 146)}
    ${sys(120, 91, A, true)}${sys(160, 106, A)}${sys(110, 146, A)}${sys(200, 146, A)}
    ${sys(540, 116, B, true)}${sys(470, 96, B)}${sys(430, 146, B)}${sys(500, 156, B)}
    ${sys(300, 106, N)}${sys(320, 176, N)}
  </svg>`;
  const legend = `<div class="gb-fig-body" style="padding-top:12px">
    <div class="gb-maplegend">
      <span style="color:${A}">★ столица</span>
      <span>${gbDot(A)}держава A</span>
      <span>${gbDot(B)}держава B</span>
      <span><span class="gb-dot2" style="background:${N};border-radius:50%"></span>нейтраль</span>
      <span style="color:var(--err)">┊ линия фронта</span>
      <span style="color:var(--color-lore)">▢ сектор</span>
    </div>
  </div>`;
  return gbFig('Карта галактики', svg + legend, '<b>Системы</b> соединены гиперпутями; <b>границы</b> очерчивают каждую державу, на стыке двух — <b>линия фронта</b>. Захватывать можно только смежную нейтральную систему.');
}

// Флот: реальные корабли → соединение → перелёт по гиперпутям (жжёт топливо).
function gbFigFleet() {
  const body = `<div class="gb-fig-body">
    <div class="gb-flow">
      ${gbNode('', '🚀', 'Корабли ростера', 'построены на верфи')}
      ${gbArr()}
      ${gbNode('b', '⚓', 'Соединение', 'снимок состава · база в системе')}
      ${gbArr('g')}
      ${gbNode('', '⛽', 'Гиперпрыжки', 'топливо × корабли × прыжки')}
      ${gbArr('g')}
      ${gbNode('g', '◎', 'Цель на карте', 'вся галактика, без границ')}
    </div>
    <div class="gb-fig-foot">Иконка-клин ⚓ слева от звезды несёт <b>флаг и цвет владельца</b> + бейдж числа кораблей. <b>Чужие флоты видят все</b>, но их <b>состав скрыт</b> (бейдж «⚓?») — пока не вскроете разведкой.</div>
  </div>`;
  return gbFig('Флот как мобильное соединение', body, 'Флот собирается из <b>реальных кораблей</b> вашего ростера и ходит по карте. Каждый гиперпрыжок <b>жжёт топливо со склада</b> по классам кораблей.');
}

// Вера: храмы → доход + сила паствы → дешевле войска; десятина основателю.
function gbFigFaith() {
  const body = `<div class="gb-fig-body">
    <div class="gb-flow">
      ${gbNode('p', '🛐', 'Храмы Веры', 'слоты = «паства»')}
      ${gbArr('p')}
      ${gbNode('b', '💰', '+150 ГС/слот', 'пока исповедуешь')}
    </div>
    <div class="gb-flow">
      ${gbNode('p', '🙏', 'Сила паствы', 'сумма слотов храмов')}
      ${gbArr('g')}
      ${gbNode('g', '⚔', 'Дешевле войска', 'флот — вдвое')}
    </div>
    <div class="gb-fig-foot">👑 <b>Основатель</b> взимает <b>десятину +20%</b> с дохода храмов адептов. Миссионеры разносят веру: признавшая держава строит ваши храмы — и платит вам десятину.</div>
  </div>`;
  return gbFig('Вера и храмы', body, 'Храмы Веры дают <b>пассивный ГС</b> и <b>удешевляют войска</b>. Чем больше паствы (слотов), тем сильнее эффект. Спиритуалистам и теократиям бонус сильнее.');
}

function renderGuidebook() {
  const toc = GB_TOC.map(g =>
    `<div class="gb-toc-group">
       <div class="gb-toc-group-t">${g.group}</div>
       ${g.items.map(s =>
      `<a class="gb-toc-link" href="javascript:void(0)" onclick="gbScrollTo('${s.id}')">
         <span class="gb-toc-icon">${s.icon}</span><span>${s.label}</span>
       </a>`).join('')}
     </div>`
  ).join('');

  const html = `
<div class="gb-wrap">
  <aside class="gb-toc">
    <div class="gb-toc-title">НА ЭТОЙ СТРАНИЦЕ</div>
    <nav class="gb-toc-list">${toc}</nav>
  </aside>

  <main class="gb-main">

    <header class="gb-hero">
      <div class="gb-hero-eyebrow">РУКОВОДСТВО ИГРОКА · BETA 0.5</div>
      <h1 class="gb-hero-title">Как играть в Классическую Эру</h1>
      <p class="gb-hero-sub">Военно-политическая игра в жанре научной фантастики, где вы — правитель звёздного государства. Здесь собрано почти всё, что нужно знать: от создания фракции до первых колоний, армий, шпионажа и оружия судного дня.</p>
    </header>

    <!-- Оглавление для узких экранов: боковая колонка там скрыта, и без этого
         блока телефон остаётся вообще без навигации по 28 разделам. -->
    <details class="gb-toc-m">
      <summary class="gb-toc-m-sum"><span class="gb-collapse-ic">▸</span><span>Содержание руководства</span><span class="gb-collapse-hint">${GB_SECTIONS.length} разделов</span></summary>
      <nav class="gb-toc-list">${toc}</nav>
    </details>

    <!-- С ЧЕГО НАЧАТЬ -->
    <section id="gb-intro" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">◈</span>С чего начать</h2>
      <p>Как и было сказано, вы управляете межзвёздной державой. Ваша цель проста: развивать экономику, расширять территорию, строить армии и флоты, вести разведку и дипломатию. Раз в сутки наступает новый <strong>игровой день</strong>, когда начисляется доход и завершаются все начатые работы.</p>

      <div class="gb-steps">
        <div class="gb-step"><div class="gb-step-n">1</div><div><strong>Зарегистрируйтесь, </strong> создав аккаунт по почте и паролю.</div></div>
        <div class="gb-step"><div class="gb-step-n">2</div><div><strong>Создайте фракцию</strong> в разделе «Фракции», либо на главной странице перейдите к форме регистрации из нескольких шагов.</div></div>
        <div class="gb-step"><div class="gb-step-n">3</div><div><strong>Дождитесь одобрения</strong> заявки администратором.</div></div>
        <div class="gb-step"><div class="gb-step-n">4</div><div><strong>Откройте «Кабинет игрока»</strong> и стройте здания, колонизируйте планеты, развивайтесь.</div></div>
      </div>

      <div class="gb-cards">
        <div class="gb-card"><div class="gb-card-big">ГС</div><div class="gb-card-t">Галактические стандарты</div><div class="gb-card-d">Главная валюта. Тратится на стройку, колонии, армию и операции.</div></div>
        <div class="gb-card"><div class="gb-card-big">ОН</div><div class="gb-card-t">Очки науки</div><div class="gb-card-d">Копятся со временем, тратятся на исследование технологий.</div></div>
        <div class="gb-card"><div class="gb-card-big">⌖</div><div class="gb-card-t">Агенты</div><div class="gb-card-d">Кадры разведки. Нужны для шпионских операций против соседей.</div></div>
      </div>

      <h3 class="gb-h3">Где что лежит: вкладки Кабинета</h3>
      <p>Весь Кабинет — это шестнадцать вкладок. Дальше в руководстве они называются точно так же, как подписаны в игре:</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">◈ Обзор</span><span class="gb-kv-val">Казна, статистика за ходы, индексы державы — сюда смотрят первым делом.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🏗 Колонии</span><span class="gb-kv-val">Колонизация, терраформ, стройка зданий и слотов, Храмы Веры.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⚔ Вооружённые силы</span><span class="gb-kv-val">Ростер юнитов и кораблей; здесь формируются <b>флоты и армии</b>.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🏭 Военпром</span><span class="gb-kv-val">Заказ производства войск по вашим чертежам (и постройка за ◈ осколки).</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🛰 Аванпосты</span><span class="gb-kv-val">Добывающие аванпосты и носители, разворачивающие их по галактике.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🔬 Исследования</span><span class="gb-kv-val">Дерево технологий, слоты и очередь изучения.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🌐 Территория</span><span class="gb-kv-val">Ваши системы и колонии списком.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⚖ Благополучие</span><span class="gb-kv-val">Ползунки <b>бюджета державы</b>, благополучие систем, население и меры против бедности. <b>Отдельной вкладки «Бюджет» нет</b> — он здесь, наверху.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🏛 Курс державы</span><span class="gb-kv-val">Политики и общий курс: долгие решения, меняющие правила игры для вашей страны.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⛏ Ресурсы и торговля</span><span class="gb-kv-val">Шесть под-вкладок: <b>⛏ Ресурсы · 🚛 Караваны · 🏪 Рынок · 🤝 Обмен · 📊 Биржа · ⚖ Концессии</b>. Отдельных вкладок «Торговля» и «Биржа» нет.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🤝 Дипломатия</span><span class="gb-kv-val">Союзы, вассалитет, займы, отношения и закрытие границ.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⚔ Война</span><span class="gb-kv-val">Объявление войны, стороны конфликта, оккупации и мирные предложения.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🛐 Вера</span><span class="gb-kv-val">Своя религия, признание чужих вер, реестр религий галактики.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🏆 Достижения · 📰 Новости</span><span class="gb-kv-val">Ачивки державы и лента событий галактики.</span></div>
      </div>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Часть механик живёт <b>вне Кабинета</b>: карта галактики (захват систем, движение флотов, «Звёздный марш»), <b>Конструкторы</b> и <a class="gb-link" onclick="gbScrollTo('gb-novella')">новелла на главной</a>.</div>
      </div>
    </section>

    

    <!-- РЕГИСТРАЦИЯ -->
    <section id="gb-reg" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">◷</span>Регистрация и заявка</h2>
      <p>Нажмите <strong>«Войти»</strong> в боковом меню и создайте аккаунт. После входа в навигации появится раздел <strong>«Фракции»</strong> - оттуда подаётся заявка на создание державы. Либо перейдите к форме заполнения из раздела фракций и главной страницы.</p>

      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div>Один аккаунт — одна фракция. Новую заявку можно подать, только если предыдущую отклонили.</div>
      </div>

      <h3 class="gb-h3">Что происходит с заявкой</h3>
      <div class="gb-status-list">
        <div class="gb-status"><span class="gb-dot gb-dot-warn"></span><strong>На рассмотрении</strong> - заявка ждёт проверки администратором.</div>
        <div class="gb-status"><span class="gb-dot gb-dot-ok"></span><strong>Одобрена</strong> - в меню появляются «Кабинет игрока» и «Конструкторы». Игра началась!</div>
        <div class="gb-status"><span class="gb-dot gb-dot-err"></span><strong>Отклонена</strong> - свяжитесь с администратором и подайте заявку заново.</div>
      </div>
    </section>

    <!-- СОЗДАНИЕ ФРАКЦИИ -->
    <section id="gb-wizard" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⬡</span>Создание фракции</h2>
      <p>Мастер проведёт вас по шагам. Каждое решение влияет на бонусы державы — их полную сводку смотрите в разделе <a class="gb-link" onclick="gbScrollTo('gb-doctrine')">«Доктрина»</a>.</p>

      <div class="gb-wsteps">
        <div class="gb-wstep"><b>Название и тип цивилизации.</b> Фронтир (молодая колония) или Колония (устоявшаяся держава) - у них разные стартовые бонусы.</div>
        <div class="gb-wstep"><b>Форма правления и политический режим.</b> Две независимые оси доктрины — их бонусы складываются.</div>
        <div class="gb-wstep"><b>Идеология.</b> Задаёт стратегический вектор и часто даёт стартовую технологию.</div>
        <div class="gb-wstep"><b>Раса.</b> Влияет на доход и определяет, какие планеты для вас «родные» (заселяются сразу, без терраформирования).</div>
        <div class="gb-wstep"><b>Столичная система и планета.</b> Выберите свободную звезду на мини-карте — она станет столицей (отметка ★ на карте галактики).</div>
        <div class="gb-wstep"><b>Стартовые постройки.</b> 20 очков на выбор начальных зданий (см. таблицу ниже).</div>
        <div class="gb-wstep"><b>Описание, история, и герб.</b> Лор фракции: лидер, культура, история, геральдика. Необязательно, но желательно.</div>
      </div>

      <h3 class="gb-h3">Стартовые постройки - 20 очков</h3>
      <div class="gb-tbl">
        <div class="gb-tr gb-th"><span>Здание</span><span>Очки</span><span>Что даёт</span></div>
        <div class="gb-tr"><span>Гражданская фабрика</span><span>5</span><span>Доход в ГС (бесплатно для Colony)</span></div>
        <div class="gb-tr"><span>Добывающий завод</span><span>5</span><span>Добыча простых ресурсов (только обычные залежи); необычные+ качают Глубинный комплекс и Экзотический экстрактор — строятся уже в игре</span></div>
        <div class="gb-tr"><span>Торговый хаб</span><span>5</span><span>Доход в ГС через торговые пути</span></div>
        <div class="gb-tr"><span>Центр подготовки</span><span>5</span><span>Производство пехоты</span></div>
        <div class="gb-tr"><span>Центр спецслужб</span><span>5</span><span>Прирост агентов (бесплатно для Frontier)</span></div>
        <div class="gb-tr"><span>Научный институт</span><span>10</span><span>Прирост очков науки</span></div>
        <div class="gb-tr"><span>Военный завод</span><span>10</span><span>Производство наземной техники</span></div>
        <div class="gb-tr"><span>Корабельная верфь</span><span>10</span><span>Производство кораблей и авиации</span></div>
        <div class="gb-tr"><span>+500 ГС</span><span>10</span><span>Стартовый капитал в казну</span></div>
      </div>

      <div class="gb-note gb-note-tip">
        <span class="gb-note-i">★</span>
        <div><b>Совет новичку.</b> Возьмите Гражданскую фабрику + Торговый хаб + Центр подготовки + 500 ГС. Это ровно 20 очков и даёт стабильный доход с самого начала.</div>
      </div>
    </section>

    <!-- ДОКТРИНА -->
    <section id="gb-doctrine" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⚑</span>Доктрина: все бонусы</h2>
      <p>«Доктрина» — это сумма бонусов от вашего типа цивилизации, формы правления, режима, идеологии и расы. <strong>Бонусы складываются.</strong> Например, +20% к доходу от правления и +20% от расы дадут вместе +40%.</p>

      <div class="gb-legend">
        <span class="gb-chip gb-chip-good">ЗЕЛЁНЫЙ — выгодно вам</span>
        <span class="gb-chip gb-chip-bad">КРАСНЫЙ — штраф / дороже</span>
        <span class="gb-chip gb-chip-grant">⌂ СТАРТОВОЕ ЗДАНИЕ</span>
        <span class="gb-chip gb-chip-tech">✦ СТАРТОВАЯ ТЕХНОЛОГИЯ</span>
      </div>

      <p style="margin:6px 0 14px;color:var(--color-text-muted);font-size:13px">Нажмите на категорию, чтобы развернуть её таблицу.</p>

      ${gbDocCollapse('Тип цивилизации', gbCivRows(), GB_DOC_CIV.length, true)}
      <div class="gb-doc-note">${GB_DOC_CIV.map(c => `<div><b>${c[1]}:</b> ${c[2]}</div>`).join('')}</div>

      ${gbDocCollapse('Форма правления', gbDocRows('gov'), gbDocCount('gov'))}
      ${gbDocCollapse('Политический режим', gbDocRows('regime'), gbDocCount('regime'))}
      ${gbDocCollapse('Идеология', gbDocRows('ideology'), gbDocCount('ideology'))}
      ${gbDocCollapse('Раса', gbDocRows('race'), gbDocCount('race'))}

      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Любой множитель не может опустить показатель ниже 30% от базы, поэтому даже если набрать много штрафов, доход не обнулится.</div>
      </div>

      <div class="gb-robot">
        <div class="gb-robot-hd"><span class="gb-robot-ic">⚙</span>Роботы — особая раса</div>
        <p class="gb-robot-sub">Фракция считается <b>машинами</b>, если выбрана раса <b>«Синтетики / Киборги»</b> <i>или</i> правление <b>«Машинный разум (ИИ)»</b>. Они играют принципиально иначе: мощная экспансия и наука ценой денег.</p>
        <div class="gb-kv-grid">
          <div class="gb-kv-row"><span class="gb-kv-key">🪐 Все планеты родные</span><span class="gb-kv-val">Колонизируют <b>любой</b> тип планет сразу, <b>без терраформа</b>.</span></div>
          <div class="gb-kv-row"><span class="gb-kv-key">⚔ Армия на Военном Заводе</span><span class="gb-kv-val">Пехоту-роботов «собирают» на <b>Военном Заводе</b> (Центр Подготовки не нужен), причём <b>×3</b> к мощности — 3000/слот вместо 1000.</span></div>
          <div class="gb-kv-row"><span class="gb-kv-key">✦ +1 слот исследований</span><span class="gb-kv-val">Машинный разум ведёт на <b>одну</b> технологию больше параллельно (стекается со слотами от политик «Разум»).</span></div>
          <div class="gb-kv-row"><span class="gb-kv-key">⬢ 2 захвата подряд</span><span class="gb-kv-val">Берут <b>две</b> системы подряд, и только потом уходят на перезарядку (вместо 1).</span></div>
          <div class="gb-kv-row"><span class="gb-kv-key gb-kv-bad">◇ Расплата — деньги</span><span class="gb-kv-val">Сильный штраф к доходу: <b>−35% ГС</b> (у «Синтетиков»), с правлением «Машинный разум» — суммарно ещё больше.</span></div>
        </div>
      </div>

      <div class="gb-robot">
        <div class="gb-robot-hd"><span class="gb-robot-ic">🔬</span>Технократы — культ науки</div>
        <p class="gb-robot-sub">Государство, поставившее науку выше всего. Жертвуют доходом и социалкой ради скорости прогресса — их фишка в <b>параллельных исследованиях</b>.</p>
        <div class="gb-kv-grid">
          <div class="gb-kv-row"><span class="gb-kv-key">✦ +1 слот исследований (правление)</span><span class="gb-kv-val">Форма правления <b>«Технократия»</b> позволяет вести на <b>одну</b> технологию больше параллельно.</span></div>
          <div class="gb-kv-row"><span class="gb-kv-key">✦ +1 слот исследований (идеология)</span><span class="gb-kv-val">Идеология <b>«Технократия (Культ науки)»</b> даёт ещё <b>+1</b> слот. Выбрав и то, и другое — изучаете на <b>две</b> технологии больше.</span></div>
          <div class="gb-kv-row"><span class="gb-kv-key">🔬 Дешёвая наука</span><span class="gb-kv-val">Обе опции заметно <b>удешевляют исследования</b> и дают <b>+ОН/сут</b> — слоты есть чем загрузить.</span></div>
          <div class="gb-kv-row"><span class="gb-kv-key">∑ Стекается со всем</span><span class="gb-kv-val">Бонусные слоты складываются с роботами (+1) и политиками ветки «Разум» (+1/+2).</span></div>
          <div class="gb-kv-row"><span class="gb-kv-key gb-kv-bad">◇ Расплата — деньги</span><span class="gb-kv-val">Каждая из двух опций даёт <b>−15% ГС</b>: чистая наука стоит казне.</span></div>
        </div>
      </div>
    </section>

    <!-- ЭКОНОМИКА -->
    <section id="gb-economy" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">◇</span>Экономика и доход</h2>
      ${gbFigEconomy()}
      <p>Весь доход начисляется <strong>автоматически</strong> раз в игровой день — планировщик обсчитывает все фракции сам, заходить для этого не нужно. Если вы не были в игре несколько дней, при следующем входе доход придёт сразу за все пропущенные дни — ничего не теряется. Открытие <strong>«Кабинета игрока»</strong> просто подтягивает накопленное мгновенно, не дожидаясь ночного расчёта.</p>

      <h3 class="gb-h3">Откуда берётся доход</h3>
      <ul class="gb-ul">
        <li><b>ГС за цикл</b> — складывается из: <b>Гражданских фабрик</b> и <b>Торговых хабов</b> (постройки), <b>караванов</b> (продажа добычи), <b>экспорта</b> (авто-продажа). Минус — апкип <b>торговой политики</b> и <b>дань</b> сюзерену (если вы вассал). Всё × бонус доктрины к доходу.</li>
        <li><b>Очки науки</b> — от Научных институтов + бонусы доктрины.</li>
        <li><b>Агенты</b> — <b>нанимаются</b> на рынке рекрутов (см. «Разведка»); Центр Спецслужб задаёт их потолок.</li>
      </ul>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>В «Обзоре» панель <b>«Статистика за ходы»</b> показывает разбивку — сколько чего пришло в казну за каждый цикл (постройки/караваны/биржа/экспорт/−политика).</div>
      </div>

      <p>Подробно про добычу, цены ресурсов, режимы склад/экспорт и каналы сбыта — в разделах <a class="gb-link" onclick="gbScrollTo('gb-resources')">«Ресурсы и добыча»</a> и <a class="gb-link" onclick="gbScrollTo('gb-trade')">«Торговля»</a>. Про то, почему доход зданий «дышит» — в <a class="gb-link" onclick="gbScrollTo('gb-prosperity')">«Благосостоянии»</a>. А свободные ГС можно пустить в финансовые инструменты на <a class="gb-link" onclick="gbScrollTo('gb-exchange')">«Бирже»</a>.</p>
    </section>

    <!-- КОЛОНИИ -->
    <section id="gb-colonies" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">◉</span>Колонии и планеты</h2>
      <p>В Кабинете игрока → <strong>«🏗 Колонии»</strong> выберите систему своей территории, затем планету, и нажмите «Колонизировать».</p>

      <ul class="gb-ul">
        <li><b>Родные планеты</b> вашей расы заселяются сразу за <b>400 ГС</b> (с учётом бонусов доктрины).</li>
        <li><b>Чужие планеты</b> требуют сначала терраформирования.</li>
        <li><b>Планеты можно заселять подряд</b>, без ожидания: перезарядка стоит не на колонизации, а на <a class="gb-link" onclick="gbScrollTo('gb-map')">захвате новых систем</a> с карты (базово 4 дня, срок зависит от доктрины). Ограничивают вас деньги и число ваших систем.</li>
      </ul>

      <h3 class="gb-h3">Типы планет</h3>
      <p>Каждая планета относится к климатической группе. Для одних рас она «родная» (заселяется сразу), для других — чужая (нужен терраформ). Какие миры родные — определяет ваша раса (см. <a class="gb-link" onclick="gbScrollTo('gb-wizard')">«Создание фракции»</a> и сводку в Кабинете).</p>
      <div class="gb-table-wrap"><table class="gb-table">
        <thead><tr><th>Группа планет</th><th>Колонизация</th></tr></thead>
        <tbody>
          <tr><td>Землеподобные, Океанические</td><td>Обычно лёгкие/родные</td></tr>
          <tr><td>Пустынные, Вулканические</td><td>Средняя сложность терраформа</td></tr>
          <tr><td>Криомиры, Малые тела, Лавовые, Экзотические</td><td>Сложно/экстремально, если не родные</td></tr>
          <tr><td>Газовые / ледяные / горячие гиганты, аномалии, пояса астероидов</td><td>Колонию нельзя, но можно <b>станцию</b> — с нужной технологией Небожителей (астероидные/гигантов/аномалий). Станция дешёвая (<b>300 ГС</b>), но это малая колония на <b>3–5 ячеек</b></td></tr>
        </tbody>
      </table></div>
      <p>У каждой планеты есть свой набор <a class="gb-link" onclick="gbScrollTo('gb-resources')">ресурсов</a> и количество ячеек под застройку.</p>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">⚙</span>
        <div><b>Роботам</b> (<a class="gb-link" onclick="gbScrollTo('gb-doctrine')">«Синтетики»/«Машинный разум»</a>) родными считаются <b>все</b> типы планет — они заселяют любой мир сразу, без терраформа.</div>
      </div>

      <h3 class="gb-h3">Терраформирование</h3>
      <p>Делает непригодную планету пригодной. Сложность зависит от того, насколько мир далёк от родных условий вашей расы:</p>
      <div class="gb-tbl">
        <div class="gb-tr gb-th"><span>Уровень</span><span>Время</span><span>Стоимость</span></div>
        <div class="gb-tr"><span>Простое</span><span>1 день</span><span>1 000 ГС</span></div>
        <div class="gb-tr"><span>Сложное</span><span>2 дня</span><span>1 800 ГС + 60 ОН</span></div>
        <div class="gb-tr"><span>Экстремальное</span><span>4 дня</span><span>4 800 ГС + 30 ОН</span></div>
      </div>

      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Газовые гиганты, аномалии и пояса астероидов <b>терраформировать нельзя</b> — обычной колонии там не будет никогда. Единственный путь к ним — <b>станции</b> Небожителей. А планета, выжженная <a class="gb-link" onclick="gbScrollTo('gb-doom')">«Дланью»</a>, мертва навсегда: ни колонии, ни станции, ни терраформа.</div>
      </div>

      <h3 class="gb-h3">Ячейки и расширение</h3>
      <p>Каждая планета имеет <b>ячейки</b> — места под здания (по умолчанию 6, одно здание = одна ячейка). Чтобы получить больше места, используйте <b>«Обустройство среды»</b>: 1 000 ГС, +3 ячейки, 1 день работы.</p>
    </section>

    <!-- ПЛАНЕТЫ-СТОЛИЦЫ -->
    <section id="gb-capitals" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">🪐</span>Планеты-столицы</h2>
      <p><strong>Столица</strong> — это родной мир, с которого начинает каждая фракция. Её тип определяется <strong>расой</strong>: при создании фракции вы выбираете родной мир из доступных вашей расе (см. <a class="gb-link" onclick="gbScrollTo('gb-wizard')">«Создание фракции»</a>). Столица крупнее обычной колонии, сразу даёт стартовые ресурсы и <b>лёгкий пассивный бонус</b> — «характер» вашего родного мира.</p>

      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Бонус столицы намеренно <b>мягкий</b> — он складывается с доктриной, но не заменяет её. Это вкус родного мира, а не основной источник силы. Столицу нельзя потерять при захвате системы — её можно лишь перенести в «Кабинете».</div>
      </div>

      <div class="gb-legend">
        <span class="gb-chip gb-chip-good">зелёный — выгодно вам</span>
        <span class="gb-chip gb-chip-bad">красный — штраф</span>
      </div>

      <div class="gb-cap-list">${gbCapRows()}</div>

      <p class="gb-cap-foot">Стартовые ресурсы столицы — обычные (common): их добывают <a class="gb-link" onclick="gbScrollTo('gb-buildings')">Добывающие заводы</a>. Более редкие месторождения ищите при <a class="gb-link" onclick="gbScrollTo('gb-colonies')">колонизации</a> других планет.</p>
    </section>

    <!-- РЕСУРСЫ -->
    <section id="gb-resources" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">◆</span>Ресурсы и добыча</h2>
      <p>Часть планет содержит месторождения. Их копают <strong>рабочие</strong> — подкласс населения; ресурсы копятся на складе фракции, а затем превращаются в ГС. Добывающие постройки нужны не для «присутствия», а как <b>усилитель</b>.</p>

      <h3 class="gb-h3">Кто копает: рабочие <span class="gb-badge">👷</span></h3>
      <ul class="gb-ul">
        <li><b>Рабочие = доля населения</b>, её задаёт ползунок <b>«Снабжение»</b> в Бюджете: 10 / 20 / 30 / 40 / 50 % при уровне 0…4. Смена снабжения вступает в силу <b>со следующего хода</b>.</li>
        <li>Пул рабочих сам растекается по системам <b>пропорционально спросу залежей</b>. Спрос залежи тем выше, чем богаче месторождение и крупнее добывающая постройка колонии.</li>
        <li><b>Приоритетная система</b> (★, 6 000 ГС) набирает рабочих <b>первой</b>, до всех остальных. То же делает <b>приоритет по редкости</b>, а выключённая редкость не копается вовсе.</li>
        <li>Меньше <b>5 рабочих</b> на залежи — она не копается совсем («нет рабочих»).</li>
      </ul>

      <h3 class="gb-h3">Три яруса добычи <span class="gb-badge">⛏</span></h3>
      <p>Добывающая постройка — <b>буст</b>, а не пропуск: залежь копается и без неё, но комплекс поднимает и ставку залежи, и её спрос на рабочих (+10 % за уровень). Ярусы отличаются ценой и тем, под какое сырьё они строятся:</p>
      <div class="gb-table-wrap"><table class="gb-table">
        <thead><tr><th>Постройка</th><th>Цена</th><th>Подо что</th></tr></thead>
        <tbody>
          <tr><td>⛏ <b>Добывающий завод</b></td><td>500 ГС</td><td><b>Обычные</b> (common) — вал, который кормит казну и стройку</td></tr>
          <tr><td>⛏ <b>Глубинный горный комплекс</b></td><td>2 500 ГС</td><td><b>Необычные и редкие</b> (uncommon, rare) — сырьё под флот и топливо</td></tr>
          <tr><td>⛏ <b>Экзотический экстрактор</b></td><td>8 000 ГС</td><td><b>Эпические и легендарные</b> (epic, legendary) — Гравиядро, Программируемая материя и прочие уникальные ресурсы</td></tr>
        </tbody>
      </table></div>

      <h3 class="gb-h3">Как добывать</h3>
      <ul class="gb-ul">
        <li>Колонизируйте планету с залежами — <b>рабочие начнут копать сами</b>, выбирать ничего не нужно.</li>
        <li>Выход залежи = <b>ставка залежи × покрытие рабочими</b>. Ставка = <b>база редкости × богатство месторождения × доктрина × бонус постройки</b>; покрытие = <b>рабочих на залежи ÷ спроса залежи</b> (полное покрытие — полная ставка, половина рабочих — половина выхода).</li>
        <li>Выход одной залежи ограничен <b>потолком по богатству</b> (таблица ниже) — больше из неё не выжать, сколько бы рабочих ни пригнать.</li>
        <li>Не хватает рабочих на всё — либо поднимайте <b>Снабжение</b> и население, либо метьте ключевые системы <b>приоритетом</b>: остальные просядут, зато важное закроется полностью.</li>
        <li>Куда идёт добыча — <b>склад или экспорт</b> — настраивается по каждому ресурсу во вкладке <b>«⛏ Ресурсы и торговля»</b> → под-вкладка <b>«⛏ Ресурсы»</b>.</li>
        <li>Добывающая постройка <b>не даёт ГС напрямую</b> — ценность даёт состав планеты и выбранный канал сбыта.</li>
      </ul>
      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div>Склад имеет <b>ОБЩИЙ лимит ёмкости</b> на все ресурсы вместе: (1000 + по 500 за слот <b>Склада</b>) × множитель <b>Инфраструктуры</b> (×0.8 … ×1.3). Нет свободного места — добыча на склад <b>сгорает</b> (сколько именно, видно в «Статистике за ходы»). Излишки продавайте или пускайте в 🚚 Экспорт / 🏪 Рынок — эти каналы склад не трогают.</div>
      </div>

      <div class="gb-note gb-note-info">
        <span class="gb-note-i">∑</span>
        <div><b>Формула добычи по залежи/сутки:</b> <b>min(потолок залежи, ставка × покрытие)</b>, где ставка = база редкости × богатство × доктрина × бонус постройки, а покрытие = рабочие ÷ спрос. Панель «⛏ Ресурсы» показывает ровно то, что начислит ход: одна формула на UI и на сервере.</div>
      </div>

      <h3 class="gb-h3">Богатство месторождения</h3>
      <p>У каждой залежи на карте есть <b>богатство</b> — от «следов» до «колоссально». Оно работает <b>трижды</b>: множит ставку добычи (×0.6 у «следов» … ×3.0 у «колоссально»), задаёт <b>потолок залежи</b> (сколько с неё вообще можно снять в сутки) и поднимает её <b>спрос на рабочих</b> — богатую жилу надо кем-то копать.</p>
      <p><b>Постройка = буст.</b> Залежь копается и без добывающего комплекса. Каждый его уровень даёт <b>+10%</b> и к ставке залежи, и к её спросу на рабочих: комплекс на 6 уровней копает в полтора раза быстрее, но и рабочих съедает в полтора раза больше.</p>
      ${gbRichTable()}

      <h3 class="gb-h3">Цена и скорость добычи по ресурсам</h3>
      ${gbResTable()}
      <p>У каждого ресурса <b>своя цена</b> за единицу; добыча за слот зависит от редкости (чем реже — тем медленнее). Итоговый столбец «ГС за слот/сут» = цена × добыча <b>при богатстве ×1.0</b> — именно он показывает, за какие месторождения стоит бороться. Дорогие ресурсы выгоднее возить караванами по полной цене, а дешёвый «вал» — сбрасывать на бирже.</p>

      <h3 class="gb-h3">Сырьё для производства армии</h3>
      <p>Ресурсы нужны не только ради ГС: <b>постройка кораблей, техники и дивизий тратит сырьё со склада</b>. У каждого проекта в Конструкторе есть <b>ресурсная ведомость</b> — список того, что уйдёт на один корпус.</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">Броня</span><span class="gb-kv-val">Железо, Титан</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Щиты</span><span class="gb-kv-val">Редкоземельные руды, Дейтерий</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Двигатели</span><span class="gb-kv-val">Метан, Дейтерий</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Реакторы</span><span class="gb-kv-val">Изотопы, Гелий-3</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Вооружение</span><span class="gb-kv-val">Железо · Гелий-3 (лучевое) · Изотопы (ракеты)</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Системы / ангары</span><span class="gb-kv-val">Редкоземельные руды, Стелларит, Титан</span></div>
      </div>
      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div>Чего <b>не хватает на складе</b> в момент производства — докупается на рынке по <b>×1.5</b> цены. Налаженная добыча нужных руд заметно удешевляет флот.</div>
      </div>

      <h3 class="gb-h3">Топливо для перелётов флота</h3>
      <p>Отдельная роль ресурсов — <b>топливо гиперпрыжков</b>: каждый переброс <a class="gb-link" onclick="gbScrollTo('gb-army')">флота</a> по карте тратит топливо со склада по классам кораблей. За что отвечает каждое топливо:</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">Гелий-3 · Метан</span><span class="gb-kv-val">Лёгкие корабли — корветы и фрегаты.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Дейтерий · Углерод</span><span class="gb-kv-val">Средние корабли — эсминцы и крейсеры.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Старвис · Изотопы</span><span class="gb-kv-val">Тяжёлые корабли — линкоры и дредноуты (самый дорогой расход).</span></div>
      </div>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">∑</span>
        <div>Многие ресурсы носят <b>двойную роль</b>: то же сырьё и кормит постройку кораблей, и горит в их двигателях, и продаётся за ГС. Точная раскладка топлива по классам — в разделе <a class="gb-link" onclick="gbScrollTo('gb-army')">«Армия и флот»</a>.</div>
      </div>

      <h3 class="gb-h3">Как превратить ресурсы в ГС</h3>
      <p>Коротко: <b>💱 Экспорт</b> → караваны (полная цена + дипломатия, остаток авто-продажа 60%); <b>бартер</b> → отдать/продать вручную. Подробно — в разделе <a class="gb-link" onclick="gbScrollTo('gb-trade')">«Торговля»</a>.</p>
      <div class="gb-note gb-note-tip">
        <span class="gb-note-i">★</span>
        <div>Дорогие ресурсы (эпические/легендарные) выгоднее возить караванами по полной цене — дипломатия и полная цена дают больше, чем авто-продажа излишков.</div>
      </div>
    </section>

    <!-- ЗДАНИЯ -->
    <section id="gb-buildings" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⌂</span>Здания</h2>
      <p>Здания — фундамент державы. Каждое занимает одну ячейку на планете и имеет до <b>6 слотов</b> мощности. Постройка здания и открытие каждого нового слота занимают <b>1 день</b>; недостроенное можно отменить с возвратом денег.</p>

      <p><b>Важно:</b> ГС-здания приносят не фиксированный доход, а слоты × <b>просперити системы</b> — насколько система богата зависит от плотности застройки. Подробно об этом — в разделе <a class="gb-link" onclick="gbScrollTo('gb-prosperity')">«Благосостояние»</a>. Военные постройки (верфь, военный завод) ГС не дают, но тоже занимают рабочие руки.</p>

      <div class="gb-bld-grid">
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⚙</span><b>Гражданская фабрика</b></div><div class="gb-bld-cost">500 ГС · 2 слота сразу</div><div class="gb-bld-d">Основной источник ГС: +200 ГС/сут за слот. Итог зависит от <b>просперити системы</b> (баланс спрос/предложение) и спроса на товары — в дефицитной по сырью/труду системе доход просядет, в сбалансированной вырастет.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⛏</span><b>Добывающий завод</b></div><div class="gb-bld-cost">500 ГС · 2 слота сразу</div><div class="gb-bld-d">Усиливает добычу залежей планеты: <b>+10% к ставке за уровень</b> (сам ГС не даёт). Копают <a class="gb-link" onclick="gbScrollTo('gb-resources')">рабочие</a>, завод лишь поднимает их отдачу.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⛏</span><b>Глубинный горный комплекс</b></div><div class="gb-bld-cost">2 500 ГС · 1 слот</div><div class="gb-bld-d">Добыча <b>необычных и редких</b> залежей — топливо гиперпрыжков и сырьё под флот.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⛏</span><b>Экзотический экстрактор</b></div><div class="gb-bld-cost">8 000 ГС · 1 слот</div><div class="gb-bld-d">Добыча <b>эпических и легендарных</b> залежей. Единственный путь к Гравиядру и Программируемой материи — сырью <a class="gb-link" onclick="gbScrollTo('gb-doom')">оружия судного дня</a>.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">🛍</span><b>Фабрика товаров</b></div><div class="gb-bld-cost">1 200 ГС · первый бесплатно</div><div class="gb-bld-d">Из воды и сырья делает товары <b>ровно под спрос населения</b> (pop/600 в сутки): слот покрывает до 10 товаров/сут, входы списываются пропорционально выпуску (0.6 воды + 0.4 сырья на товар). Товары не копятся и не продаются — только множитель дохода державы ×0.90…×1.10. Входы: Лёд/Жидкая вода и Железо/Силикаты.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⇄</span><b>Торговый хаб</b></div><div class="gb-bld-cost">1 000 ГС · 1 слот</div><div class="gb-bld-d"><b>+100 ГС/сут за слот</b>, но только при активных торговых путях — без караванов хаб простаивает.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">📦</span><b>Склад</b></div><div class="gb-bld-cost">800 ГС · 1 слот</div><div class="gb-bld-d">Поднимает лимит ёмкости склада ресурсов (+500 за слот). Нужен, если копите добычу в режиме «Склад».</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">✦</span><b>Научный институт</b></div><div class="gb-bld-cost">1 000 ГС · 1 слот</div><div class="gb-bld-d"><b>+1 ОН/сут за слот</b> (× множитель «Образования» в <a class="gb-link" onclick="gbScrollTo('gb-budget')">бюджете</a>).</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⚔</span><b>Центр подготовки</b></div><div class="gb-bld-cost">500 ГС · 1 слот</div><div class="gb-bld-d">Производство пехоты: <b>1 слот = 1000 бойцов</b> за цикл.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">◐</span><b>Центр спецслужб</b></div><div class="gb-bld-cost">3 000 ГС · 1 слот</div><div class="gb-bld-d">Поднимает <b>потолок</b> числа агентов разведки: <b>1 слот = +1 агент</b> (базово 2). Самих агентов вы нанимаете на рынке рекрутов.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⛭</span><b>Военный завод</b></div><div class="gb-bld-cost">1 000 ГС · 1 слот</div><div class="gb-bld-d">Производство наземной техники: <b>1 слот = 100 единиц</b> за цикл. У <a class="gb-link" onclick="gbScrollTo('gb-doctrine')">роботов</a> здесь же собирается и пехота.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">🚀</span><b>Корабельная верфь</b></div><div class="gb-bld-cost">2 000 ГС · 1 слот</div><div class="gb-bld-d">Производство кораблей: <b>1 слот = 1 корабль</b> (или 12 малых аппаратов) за цикл.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">✈</span><b>Аэрокосмический завод</b></div><div class="gb-bld-cost">1 200 ГС · 1 слот</div><div class="gb-bld-d"><b>Авиация строится здесь, а не на Верфи.</b> 1 слот = 12 единиц авиации за цикл. Без него истребители и бомбардировщики заказать нельзя.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">☀</span><b>Центр благополучия</b></div><div class="gb-bld-cost">3 000 ГС · 1 слот</div><div class="gb-bld-d">Поднимает <b>индекс благополучия державы</b>. У каждой идеологии свой механизм: спиритуалистам считается от охвата храмов, корпоратам — от казны (с потолком), пацифистам — щедрый плоский бонус. Лимит: <b>1 на систему и 5 на державу</b>.</div></div>
      </div>

      <h3 class="gb-h3">Оборонные постройки <span class="gb-badge">⛨</span></h3>
      <p>Отдельное семейство — они не приносят ГС, а держат вашу систему. Подробно про каждую — в разделе <a class="gb-link" onclick="gbScrollTo('gb-defense')">«Оборона»</a>.</p>
      <div class="gb-bld-grid">
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">🛰</span><b>Звёздная База</b></div><div class="gb-bld-cost">5 000 ГС · 1 слот</div><div class="gb-bld-d"><b>Вместимость флота: +50 кораблей за слот.</b> Сверх этого лимита корабли строить нельзя — без Звёздных Баз флот упирается в потолок. Содержания не требует.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">🎯</span><b>Батарея ПВО</b></div><div class="gb-bld-cost">1 500 ГС · 1 слот</div><div class="gb-bld-d">Пассивно прикрывает планету от вражеской авиации: за каждый слот снижает урон атакующих авиагрупп.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⛨</span><b>Комплекс ПРО</b></div><div class="gb-bld-cost">3 000 ГС · 1 слот</div><div class="gb-bld-d">Прикрывает <b>всю свою систему</b> от залпов судного дня. Боезапаса нет: когда снаряд идёт к вашей планете, открывается <b>«Окно перехвата»</b> — вы вручную угадываете профиль подхода. Слоты дают разведку и авто-отработку.</div></div>
      </div>

      <h3 class="gb-h3">Особые постройки</h3>
      <p>Строятся не через обычную панель и слотов не открывают — каждая требует своей технологии и стоит на порядок дороже: <b>☢ Арсенал Судного Дня</b>, <b>🏭 Баллистический военпромзавод</b>, <b>🜨 Длань Неотвратимости</b> и мегасооружение <b>⭘ Ожерелье Немезиды</b>. Всё про них — в разделах <a class="gb-link" onclick="gbScrollTo('gb-doom')">«Оружие судного дня»</a> и <a class="gb-link" onclick="gbScrollTo('gb-defense')">«Оборона»</a>. Отдельно стоит <b>🛐 Храм Веры</b> — он строится во вкладке «Колонии» и описан в разделе <a class="gb-link" onclick="gbScrollTo('gb-faith')">«Вера»</a>.</p>

      <h3 class="gb-h3">Цена слотов</h3>
      <p>Слоты открываются по <b>лестнице</b>, одинаковой почти для всех зданий: часть слотов идёт бесплатно вместе с постройкой, дальше — <b>500 · 500 · 1 500 · 1 500 · 3 000 ГС</b>. Исключение — Звёздная База: у неё лестница на порядок дороже (5 000 → 12 000 ГС за слот).</p>
      <div class="gb-note gb-note-tip">
        <span class="gb-note-i">★</span>
        <div>Шестой слот стоит как <b>всё здание с первыми тремя слотами вместе</b>. Прежде чем докупать дорогой слот, посчитайте — часто выгоднее поставить второе такое же здание в <b>другой системе</b>: и дешевле, и <a class="gb-link" onclick="gbScrollTo('gb-prosperity')">благополучие</a> не проседает от плотной застройки.</div>
      </div>
    </section>

    <!-- БЛАГОСОСТОЯНИЕ -->
    <section id="gb-prosperity" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">◈</span>Благосостояние систем</h2>
      <p>Доход ваших ГС-зданий — это <b>не</b> фиксированная цифра. Каждое здание даёт <b>слоты</b>, а итоговый доход = слоты × <b>два множителя</b>: благополучие <b>системы</b> (свой для каждой) и обеспечение товарами <b>всей державы</b> (общий). Оба видны на вкладке <strong>«Благополучие»</strong>.</p>
      ${gbFigProsperity()}

      <h3 class="gb-h3">Словарь вкладки «Благополучие»</h3>
      <p>В таблице систем шесть колонок — вот что каждая значит:</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">👥 Жители</span><span class="gb-kv-val"><b>Население системы</b> — сумма населения всех ваших колоний в ней. Жители дают рабочие руки и едят товары. (Процент рядом — доля заселённости, она падает при долгой бедности.)</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">👷 Места</span><span class="gb-kv-val"><b>Рабочие места</b> — сколько рук требуют все постройки системы (включая военные). Чем плотнее застройка, тем больше мест.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⚖ Труд (покрытие)</span><span class="gb-kv-val">Отношение <b>жители ÷ рабочие места</b> в %. &gt;100% — рук в избытке (хорошо), &lt;100% — нехватка рук (давит доход).</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">× Благополучие</span><span class="gb-kv-val"><b>Множитель дохода</b> всех построек системы, выводится из покрытия труда. Богатая система платит больше, бедная — меньше.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Статус</span><span class="gb-kv-val">«в достатке» / «волнения» / «стагнация» — насколько системе хватает рук. ★ Столица всегда «в достатке».</span></div>
      </div>

      <h3 class="gb-h3">Рычаг 1 — труд системы (плотность застройки)</h3>
      <p>Главный рычаг прост: <b>мало построек на большое население</b> → рук в избытке → система <b>богатеет</b> (благополучие растёт). <b>Плотно застроили</b> небольшое население → рук не хватает → благополучие мягко проседает.</p>
      <ul class="gb-ul">
        <li>Полоса благополучия <b>мягкая</b>: резких обвалов нет — доход «дышит», а не рушится.</li>
        <li><b>Столичная система всегда богата и спокойна</b> — большое население, простор для застройки. Её доход не падает, население не бунтует.</li>
        <li>Военные постройки (верфь, военный завод) ГС не приносят, но рабочие места <b>занимают</b> — учитывайте это в доходных системах.</li>
        <li>Соседние системы <b>вашей же державы</b> по гиперпути немного делятся излишком благополучия (<b>спилловер</b>). На целый сектор влияют события — <b>война, пираты, бум</b>.</li>
      </ul>

      <h3 class="gb-h3">Рычаг 2 — товары державы <span class="gb-badge">🛍</span></h3>
      <p>Второй множитель <b>один на всю державу</b>: население <b>ест товары</b>, которые делает <a class="gb-link" onclick="gbScrollTo('gb-buildings')">Фабрика товаров</a> (вода + сырьё → товары). Чем лучше обеспечено население, тем выше общий множитель дохода — в полосе <b>×0.90 … ×1.10</b>.</p>
      <ul class="gb-ul">
        <li><b>Обеспечение = товары ÷ спрос населения.</b> Хватает (100%+) → доход всех построек ×1.10; дефицит → проседает к ×0.90.</li>
        <li>Спрос растёт вместе с населением державы — расширяясь, не забывайте строить фабрики товаров.</li>
        <li>Излишек товаров продаётся на бирже. Входы (Лёд / Жидкая вода и Железо / Силикаты) надо <b>добывать</b>, иначе фабрика простаивает.</li>
      </ul>

      <h3 class="gb-h3">Бедность: последствия и лечение</h3>
      <p>Если рабочих рук долго не хватает, система копит напряжение: <b>волнения → стагнация</b> (доход слегка обрезан). Бедность <b>мягкая</b> — она понемногу гонит население (доля заселённости падает, но не до нуля) и лишь в крайнем случае даёт редкие <b>беспорядки</b> с разовым ущербом казне.</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">🏗 Разрядить застройку</span><span class="gb-kv-val">Коренное лечение: меньше построек на население — больше свободных рук. Расселяйте доходные здания по разным системам.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">💰 Дотация</span><span class="gb-kv-val">+0.25 к благополучию на 5 дней. Деньги напрямую поднимают доход — лечит симптом, не корень.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">📦 Снабжение</span><span class="gb-kv-val">−3 напряжения сразу + малый буст на 3 дня. Быстро сбивает волнения.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🚀 Экстренный импорт</span><span class="gb-kv-val">+0.15 на 7 дней и тормозит рост напряжения, пока строите производство.</span></div>
      </div>
      <div class="gb-note gb-note-tip">
        <span class="gb-note-i">★</span>
        <div>Где смотреть: индекс <b>«Бедность»</b> в «Обзоре» и вкладка <b>«Благополучие»</b> — клик по строке системы раскрывает причины дефицита и кнопки мер. Стоимость экстренных мер растёт с населением системы.</div>
      </div>
    </section>

    <!-- БЮДЖЕТ -->
    <section id="gb-budget" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">🏛</span>Бюджет державы</h2>
      <p>Отдельной вкладки «Бюджет» в Кабинете нет: бюджет — это блок <strong>«🏛 Бюджет державы — рычаги»</strong> в самом верху вкладки <strong>«⚖ Благополучие»</strong>. Это главный пульт управления страной. Пять ползунков распределяют деньги по отраслям, и от них зависит почти всё: сколько <b>слотов</b> откроется в постройках, как быстро строится флот, растёт ли население и какой множитель получит весь ваш доход. Бюджет <b>списывается каждый цикл</b> — это постоянный расход казны.</p>

      <h3 class="gb-h3">Пять уровней финансирования</h3>
      <p>У каждой отрасли пять положений: <b>нет финансирования · скудно · норма · усиленно · максимум</b>. Чем выше — тем больше отдача, но цена растёт <b>прогрессивно</b> (веса 0 · 1 · 2 · 4 · 7): «норма» дёшева, «максимум» кусается вчетверо дороже неё.</p>
      <div class="gb-table-wrap"><table class="gb-table">
        <thead><tr><th>Отрасль</th><th>Чем управляет</th><th>Разброс эффекта</th></tr></thead>
        <tbody>
          <tr><td>🏭 <b>Промышленность («Снабжение»)</b></td><td>Слоты гражданских построек (фабрики, хабы, склады, храмы) и <b>доля рабочих</b> в населении — именно они копают залежи. Смена вступает в силу со следующего хода.</td><td>1 → 6 слотов · 10% → 50% рабочих</td></tr>
          <tr><td>⚔ <b>Оборонзаказ</b></td><td>Слоты военных построек и <b>скорость производства юнитов</b>.</td><td>×1.5 → ×0.65 срока постройки</td></tr>
          <tr><td>🔬 <b>Образование</b></td><td>Слоты НИИ и Центров Спецслужб, множитель <b>очков науки</b>.</td><td>×0.5 → ×1.4 ОН</td></tr>
          <tr><td>⚖ <b>Соцобеспечение</b></td><td>Благополучие и <b>рост населения</b>.</td><td>×0.85 → ×1.15 ко всему доходу</td></tr>
          <tr><td>🚚 <b>Инфраструктура</b></td><td><b>Ёмкость складов</b> ресурсов.</td><td>×0.8 → ×1.3 вместимости</td></tr>
        </tbody>
      </table></div>

      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div><b>Два нуля, которые убивают державу.</b> <b>Оборонзаказ на нуле</b> — корабли и войска <b>не строятся вовсе</b>, сколько бы верфей вы ни возвели. <b>Соцобеспечение на нуле</b> — население <b>бежит на 2% в сутки</b>, а вместе с ним уходят рабочие руки и доход.</div>
      </div>

      <h3 class="gb-h3">Слоты — это люди, а не деньги</h3>
      <p>Слот в постройке открывается не сам по себе: бюджет задаёт <b>целевое</b> число слотов, а закрыть их должны реальные жители. Считается просто — <b>3 жителя на один рабочий слот</b>. Не хватает населения в системе — слоты стоят пустыми, сколько ни поднимай ползунок.</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">👥 Потолок населения</span><span class="gb-kv-val"><b>100 жителей на ячейку</b> колонии. Больше ячеек (обустройство среды) и больше колоний — выше потолок.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">📈 Рост населения</span><span class="gb-kv-val">От соцобеспечения: <b>−2% · +0.5% · +1.5% · +2.5% · +3.5%</b> в сутки. Сверху <b>до +1%/сут</b> за полное обеспечение <a class="gb-link" onclick="gbScrollTo('gb-prosperity')">товарами</a>.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">💸 Цена бюджета</span><span class="gb-kv-val"><b>Население × сумма ставок отраслей</b> за цикл. Чем больше держава — тем дороже её содержать: расширение без роста дохода загоняет казну в минус.</span></div>
      </div>

      <div class="gb-note gb-note-tip">
        <span class="gb-note-i">★</span>
        <div><b>Рабочая связка на старте:</b> Промышленность и Соцобеспечение — «норма», Оборонзаказ — «скудно» (лишь бы не ноль), пока не выстроена экономика. Как только доход стабилен — поднимайте Промышленность до «усиленно»: слоты окупаются быстрее всего.</div>
      </div>
    </section>

    <!-- ТЕХНОЛОГИИ -->
    <section id="gb-research" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">✦</span>Технологии</h2>
      <p>В Кабинете игрока → <strong>«🔬 Исследования»</strong> открывается дерево исследований. Выберите узел — если хватает очков науки, исследование запустится. Базово изучается <b>одна</b> технология за раз (у <a class="gb-link" onclick="gbScrollTo('gb-doctrine')">роботов и технократов</a> — больше).</p>
      <ul class="gb-ul">
        <li><b>Дополнительные слоты исследований</b> открывают политики ветки «Разум»: <b>«Свет знаний»</b> (+1 слот) и <b>«Превосходство разума»</b> (+2 слота). Чем больше слотов — тем больше технологий изучается параллельно.</li>
        <li><b>Технократы</b> ведут исследования на несколько фронтов сразу: форма правления <b>«Технократия»</b> и идеология <b>«Культ науки»</b> дают по <b>+1 слоту</b> (вместе — +2). Стекается с роботами и политиками «Разум».</li>
        <li><b>Очередь технологий.</b> Если все слоты заняты или не хватает ОН — жмите «+ в очередь». Технология запустится автоматически, как только освободится слот и накопятся очки науки. В очередь можно ставить и цепочку зависимостей по порядку.</li>
        <li>Часть технологий доступна только после изучения предыдущих.</li>
        <li>Некоторые идеологии дают стартовую технологию бесплатно (см. раздел «Доктрина»).</li>
        <li>Технологии открывают новые модули в конструкторах кораблей и дивизий.</li>
        <li>Дерево разбито на ветки (Флот · Наземные войска · Авиация · Политика) и читается слева направо по тирам.</li>
      </ul>
    </section>

    <!-- АРМИЯ -->
    <section id="gb-army" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⚔</span>Армия и флот</h2>
      <p>Объём военного производства зависит от количества открытых слотов в военных зданиях:</p>
      <ul class="gb-ul">
        <li><b>Центр подготовки</b> — производит пехоту (1000/слот).</li>
        <li><b>Военный завод</b> — производит наземную технику (тяжёлая занимает больше мощности, чем лёгкая).</li>
        <li><b>Корабельная верфь</b> — строит крупные корабли или эскадрильи малых аппаратов.</li>
      </ul>

      <div class="gb-note gb-note-info">
        <span class="gb-note-i">⚙</span>
        <div><b>Роботы</b> (<a class="gb-link" onclick="gbScrollTo('gb-doctrine')">«Синтетики»/«Машинный разум»</a>) собирают пехоту не в Центре Подготовки, а на <b>Военном Заводе</b> — там же, где технику, и <b>втрое эффективнее</b> (3000/слот). Отдельный Центр Подготовки им строить не нужно.</div>
      </div>

      <p>Сначала юнит нужно спроектировать в <a class="gb-link" onclick="gbScrollTo('gb-constructors')">Конструкторах</a>, затем заказать во вкладке <b>«🏭 Военпром»</b>. Заказы выполняются к следующему игровому дню и попадают в <b>«⚔ Вооружённые силы государства»</b> — ваш ростер.</p>

      <h3 class="gb-h3">Армии вместо дивизий <span class="gb-badge">🪖</span></h3>
      <p>Наземные войска ходят по карте <b>армиями</b>, которые вы собираете из готовых юнитов ростера — так же, как флот собирается из кораблей.</p>
      <ul class="gb-ul">
        <li>Во вкладке «Вооружённые силы» жмите <b>«⚔ Сформировать армию»</b> и наберите её из наземки и авиации состава.</li>
        <li>Армия встаёт <b>гарнизоном на колонии</b>, а перебрасывается на карте галактики в режиме <b>«Звёздный марш»</b>.</li>
        <li><b>Гарнизон сверх порога</b> (20 юнитов или население ÷ 10) <b>давит на благополучие</b> колонии, а войска на колониях сверх мирного гарнизона бьют по <a class="gb-link" onclick="gbScrollTo('gb-budget')">бюджету</a>. Рассредоточивайте армии.</li>
      </ul>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">◈</span>
        <div><b>Осколки цикла</b> (их дают находки <a class="gb-link" onclick="gbScrollTo('gb-novella')">Разлома</a>) строят юнита <b>бесплатно и мгновенно</b> — без ГС, сырья, очереди и лимитов цехов. 1 осколок = 1 юнит; для флота осколок привязан к классу корабля.</div>
      </div>

      <h3 class="gb-h3">Флот — мобильное соединение <span class="gb-badge">⚓</span></h3>
      <p>Построенные корабли можно собрать в <b>флот</b> — реальное соединение, которое <b>ходит по карте галактики</b>. На вкладке <b>«⚔ Вооружённые силы»</b> выберите корабли из ростера, систему-базу (любая ваша колония) и имя — кнопка <b>«Сформировать флот»</b> снимет эти корпуса из ростера и поставит соединение в выбранную систему.</p>
      ${gbFigFleet()}
      <ul class="gb-ul">
        <li><b>Состав</b> — снимок реальных кораблей (флагман + эскорт). Число кораблей задаёт силу флота.</li>
        <li><b>Движение.</b> Клик по своему флоту на карте открывает плашку команд: <b>перебросить</b> (в любую систему — границы не мешают), <b>вернуть на базу</b>, <b>распустить</b> (корабли возвращаются в ростер).</li>
        <li><b>Время в пути</b> зависит от дистанции: ~2 часа до соседней системы и до ~18 часов от края до края.</li>
        <li><b>Редактирование состава ✎.</b> Если флот стоит в системе со <b>своей верфью</b>, можно добрать или вернуть корабли и переименовать соединение прямо в строке флота.</li>
      </ul>

      <h3 class="gb-h3">Топливо на гиперпрыжки <span class="gb-badge">⛽</span></h3>
      <p>Перелёт <b>жжёт топливо со склада</b>: расход = <b>топливо класса × число кораблей × число гиперпрыжков</b> по маршруту. Не хватает топлива — переброс отменяется. Разные классы кораблей пьют разное топливо:</p>
      <div class="gb-table-wrap"><table class="gb-table">
        <thead><tr><th>Класс корабля</th><th>Топливо за корабль / прыжок</th></tr></thead>
        <tbody>
          <tr><td>Корвет</td><td>Гелий-3 ×1 · Метан ×1</td></tr>
          <tr><td>Фрегат</td><td>Гелий-3 ×2 · Метан ×1</td></tr>
          <tr><td>Эсминец</td><td>Дейтерий ×2 · Углерод ×1</td></tr>
          <tr><td>Крейсер</td><td>Дейтерий ×3 · Углерод ×2</td></tr>
          <tr><td>Линкор</td><td>Старвис ×2 · Изотопы ×1</td></tr>
          <tr><td>Дредноут</td><td>Старвис ×4 · Изотопы ×2</td></tr>
        </tbody>
      </table></div>
      <div class="gb-note gb-note-tip">
        <span class="gb-note-i">★</span>
        <div>Тяжёлый флот <b>прожорлив</b>: дредноут пьёт вчетверо больше лёгкого корвета. Налаженная добыча <b>Старвиса, Дейтерия и Гелия-3</b> — условие дальних манёвров. Расход на перелёт показывается до подтверждения.</div>
      </div>

      <h3 class="gb-h3">Видимость флотов и стелс факельщика</h3>
      <ul class="gb-ul">
        <li><b>Чужие флоты видят все</b> — соединения всех держав отображаются на карте (стоянка и перелёт), в цвете и под флагом владельца.</li>
        <li><b>Состав скрыт.</b> Сколько именно кораблей и каких — видно <b>только после разведки</b> этой фракции. До этого флот несёт серый бейдж «<b>⚓?</b>».</li>
        <li><b>Факельщик (мобильная «Длань») невидим</b> до тех пор, пока не <b>выстрелит</b> (засветится в своей системе) или его не <b>вскроют</b> спецоперацией. Вскрытый чужой факельщик пульсирует красным кольцом «обнаружен».</li>
      </ul>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">◐</span>
        <div>Против чужих флотов есть отдельные <b>тактические спецоперации</b> (охота на факельщикы, диверсия на флот) — см. <a class="gb-link" onclick="gbScrollTo('gb-intel')">«Разведка»</a>.</div>
      </div>
    </section>

    <!-- ВОЙНА И БИТВЫ -->
    <section id="gb-war" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">🔥</span>Война и битвы</h2>
      <p>Флоты можно водить по карте и в мирное время, но стрелять они начнут только на <b>войне</b>. Война — это формальное состояние между державами: объявляется вкладкой <strong>«Война»</strong>, ведётся флотами на карте и заканчивается мирным договором.</p>

      <h3 class="gb-h3">Объявление войны</h3>
      <ul class="gb-ul">
        <li>Выбираете державу и указываете <b>повод (casus belli)</b> — он попадёт в новость на всю галактику. Повод не обязателен, но война без причины бьёт по репутации.</li>
        <li><b>Союзнику по своему же союзу войну объявить нельзя</b> — сначала выйдите из федерации или конфедерации.</li>
        <li>У войны две стороны — <b>нападающая</b> и <b>обороняющаяся</b>. К любой из них могут присоединиться другие державы: вы можете <b>позвать союзника</b>, а третья сторона — <b>вступить</b> сама.</li>
        <li>Мир заключается <b>предложением</b>: одна сторона выдвигает условия, другая принимает, отклоняет или ждёт, пока предложение не отзовут.</li>
      </ul>

      <h3 class="gb-h3">Оккупация систем</h3>
      <p>Чужую систему нельзя купить — её <b>занимают войной</b>. Флот, вставший во вражеской системе, переводит её под <b>оккупацию</b>: владелец теряет с неё отдачу, пока не придёт освободитель. Снять оккупацию может сам владелец или любая держава, воюющая с оккупантом на стороне обороны. <b>Ничейные системы не оккупируются</b> — их берут обычным захватом с карты.</p>

      <h3 class="gb-h3">Как начинается бой</h3>
      <p>Отдельной кнопки «атаковать» нет. Бой возникает сам, когда <b>два враждебных флота оказываются в одной системе</b>: сервер заводит сражение, обе стороны получают новость и приглашение на доску. Одновременно в одной системе между теми же двумя державами идёт <b>только одно</b> сражение — подошедшие следом корабли вливаются в него подкреплением.</p>

      <h3 class="gb-h3">Доска боя <span class="gb-badge">⬢</span></h3>
      <p>Сражение разыгрывается вручную на <b>гексагональной доске</b>. Это пошаговая тактика: вы двигаете каждый корабль и выбираете, по кому стрелять.</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">📐 Размер поля</span><span class="gb-kv-val">Обычное сражение — <b>60×80</b> гексов. Дуэль (бойцовский клуб, тренировочный бой) — тесные <b>48×28</b>.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⏱ Ход</span><span class="gb-kv-val">За свой ход вы активируете <b>до 6 кораблей</b>. Неиспользованные активации <b>сгорают</b>. На ход даётся <b>24 часа</b> — не успели, ход передаётся дальше.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⚓ Стоимость активации</span><span class="gb-kv-val">Мелочь ходит дёшево, туши дорого: корвет, фрегат и авиакрыло — <b>1</b>, эсминец — <b>2</b>, крейсер и линкор — <b>3</b>, дредноут — <b>4</b>.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🎯 Дальность</span><span class="gb-kv-val">Зона поражения растёт с классом: корвет бьёт на <b>3</b> гекса, фрегат — 4, эсминец и крейсер — 5, линкор — 6, дредноут — <b>7</b>.</span></div>
      </div>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div><b>Ракурсов и «удара в корму» в игре нет.</b> Куда повёрнут корабль — значения не имеет: бой решают <b>дальность, огневые группы и позиция на поле</b>, а не разворот носа.</div>
      </div>

      <h3 class="gb-h3">Огневые группы и залп</h3>
      <p>Корабль стреляет не «одной пушкой на N урона»: каждая <b>огневая группа</b> из конструктора имеет свою дальность и свой залп. На доске вокруг выбранного корабля рисуются <b>кольца дальностей</b> — чем ближе вы подойдёте к цели, тем больше групп отработает по ней за один приказ.</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">🔫 Скорострельность = дробины</span><span class="gb-kv-val">Число выстрелов в залпе задаётся скорострельностью орудия по шести ступеням: до 1 выстрела/мин — <b>1 дробина</b>, до 10 — 2, до 30 — 3, до 100 — 4, до 400 — 5, выше — <b>6</b>. Скорострельные батареи бьют часто и слабо, тяжёлые — редко и страшно.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⚡ Три канала урона</span><span class="gb-kv-val"><b>Кинетика · Энергия · Ракеты</b> — определяется типом орудия. Броня цели держит каждый канал по-своему (см. <a class="gb-link" onclick="gbScrollTo('gb-constructors')">сплавы брони</a>): удачный канал против чужого сплава решает бой.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🛡 ПРО корабля</span><span class="gb-kv-val">Системы ближнего перехвата <b>сбивают часть входящих ракет</b>. Против ракетного флота это лучшая защита; кинетику и лучи она не остановит.</span></div>
      </div>

      <h3 class="gb-h3">Радар, скрытность и РЭБ</h3>
      <p>Вы не видите всё поле. Чужие корабли на доске — сперва <b>тусклые неопознанные контакты</b>, и стрелять по ним нельзя, пока не установлен контакт.</p>
      <ul class="gb-ul">
        <li><b>Вблизи видно всех:</b> до <b>3 гексов</b> — визуальный контакт, скрытность не спасает.</li>
        <li><b>Дальше решает радар:</b> цель обнаруживается на дистанции ≈ <b>ваш сенсор − половина её скрытности</b>. Мелочь прячется лучше: у корвета скрытность 9, у дредноута — 2, у станции — 1.</li>
        <li><b>Выстрел раскрывает стрелявшего</b> до его следующего хода — залп из темноты стоит вам позиции.</li>
        <li><b>РЭБ</b> глушит сенсоры врага в радиусе 5 гексов, <b>контр-РЭБ</b> снимает помехи со своих в том же радиусе, а <b>помехозащищённость</b> корабля вычитается из чужого глушения.</li>
      </ul>

      <h3 class="gb-h3">Ландшафт поля</h3>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">⬢ Астероиды</span><span class="gb-kv-val"><b>Режут линию огня</b> — сквозь них не выстрелить. Но стоянка в поле стоит <b>−10% корпуса за ход</b>.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">▒ Туманность</span><span class="gb-kv-val"><b>Гасит щиты до нуля</b> и рассеивает залпы. Гиблое место для щитового флота и укрытие для бронированного.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">◎ Гравитационный колодец</span><span class="gb-kv-val">В конце хода <b>тянет ближние корабли к центру</b> — сносит с выверенной позиции.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⣿ Обломки</span><span class="gb-kv-val"><b>−1 к ходу</b>, но <b>−15% входящего урона</b>. Хорошая позиция для тяжёлого корабля, который никуда не спешит.</span></div>
      </div>

      <h3 class="gb-h3">Подкрепления и интердикция</h3>
      <p>Пока бой идёт, в него можно <b>вводить свежие корабли</b> из пула — если противник этому не мешает.</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">⛔ Интердикция</span><span class="gb-kv-val">Корабль с интердиктором <b>запирает подкрепления врага</b>: пока он жив на доске, свежие корпуса противник не введёт.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⚓ Стабилизация</span><span class="gb-kv-val">Модуль-контрмера: <b>вражеская интердикция на вас не действует</b>.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🌀 FTL-гипердвигатель</span><span class="gb-kv-val">Прыгает подкреплением <b>сквозь</b> вражескую интердикцию — единственный способ пробить запертую доску.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🛩 Авиакрылья</span><span class="gb-kv-val">Носители поднимают авиакрылья с доски (<b>1 активация</b>). Крыло — отдельный юнит: быстрый, скрытный и хрупкий.</span></div>
      </div>
      <div class="gb-note gb-note-tip">
        <span class="gb-note-i">★</span>
        <div>Бой заканчивается <b>уничтожением</b> одной из сторон или отступлением. Уцелевшие корабли возвращаются во флот с полученными повреждениями — <b>чинить их надо на верфи</b>, ремонт стоит половину цены постройки корпуса.</div>
      </div>
    </section>

    <!-- ОБОРОНА -->
    <section id="gb-defense" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⛨</span>Оборона</h2>
      <p>Флот прикрывает вас там, где стоит. Всё остальное держат <b>стационарные постройки и минные заграждения</b> — они работают, пока вас нет в игре, и это единственное, что стоит между вашей столицей и чужим залпом судного дня.</p>

      <h3 class="gb-h3">Звёздная База — потолок флота</h3>
      <p>Не оборона в прямом смысле, но без неё армии не будет: <b>каждый слот Звёздной Базы даёт +50 мест под корабли</b>. Упёрлись в лимит — новые корпуса просто не построятся, сколько бы верфей и денег ни было. Содержания База не требует, только вместимость.</p>

      <h3 class="gb-h3">Батарея ПВО и Комплекс ПРО</h3>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">🎯 Батарея ПВО</span><span class="gb-kv-val">Пассивно и без вашего участия <b>срезает урон вражеских авиагрупп</b> по планете — за каждый слот. Ставится на конкретную колонию.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⛨ Комплекс ПРО</span><span class="gb-kv-val">Прикрывает <b>всю систему</b> от снарядов судного дня. Боезапаса нет — вместо него <b>дуэль наведения</b> (ниже).</span></div>
      </div>

      <h3 class="gb-h3">Окно перехвата — дуэль с наводчиком</h3>
      <p>Когда по вашей планете идёт залп, ПРО не срабатывает само. Открывается <b>«Окно перехвата»</b>: вы должны <b>угадать, как именно снаряд заходит на цель</b>. Атакующий выбирает свой профиль в тот же момент — это чистая блеф-дуэль.</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">◣ Низкая траектория</span><span class="gb-kv-val">Идёт над самой атмосферой, прячась в тени рельефа. Мало времени на реакцию.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">◥ Высокая дуга</span><span class="gb-kv-val">Выходит на баллистическую дугу и падает отвесно. Видно рано — сбить трудно.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">◈ Рой ложных целей</span><span class="gb-kv-val">Снаряд идёт в облаке обманок. Сеть перехвата перегружена целями.</span></div>
      </div>
      <p>Вторая ось дуэли — <b>окно подлёта</b>: <b>⏩ раннее</b> (бить в первой половине подлёта, резко, но предсказуемо) или <b>⏳ позднее</b> (тянуть до последнего, сеть успевает остыть). Угадать надо <b>обе</b> оси.</p>
      <p><b>Слоты ПРО покупают вам разведку</b>, сужая перебор:</p>
      <div class="gb-tbl gb-tbl--2">
        <div class="gb-tr gb-th"><span>Слотов</span><span>Что даёт разведка</span></div>
        <div class="gb-tr"><span>2</span><span>Отсеивает <b>одну ложную версию</b> траектории — остаётся два профиля вместо трёх</span></div>
        <div class="gb-tr"><span>4</span><span>Радар раскрывает <b>окно подлёта</b> — вторая ось больше не гадается</span></div>
        <div class="gb-tr"><span>6</span><span>Чистая отметка: видно и <b>планету-цель</b> залпа</span></div>
      </div>

      <h3 class="gb-h3">⭘ Ожерелье Немезиды</h3>
      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div><b>Мегасооружение и единственная абсолютная защита.</b> Кольцо перехватчиков вокруг системы <b>гарантированно сбивает любой залп</b> Длани и Факельщика — без дуэли, без осечек, включая невидимые для обычной ПРО боеголовки. Цена под стать: <b>2 000 000 ГС</b> плюс 200 Стелларита, 40 Рагенода и 20 Гравиядра, стройка 3 дня, требует технологию «Ожерелье Немезиды». Заряды не бесконечны — их <b>6</b>.</div>
      </div>

      <h3 class="gb-h3">Минные поля и посты дронов</h3>
      <ul class="gb-ul">
        <li><b>Минное поле ставится на систему</b>, а не на планету: чужой флот, вошедший в заминированную систему, получает урон на входе. Своё поле можно снять.</li>
        <li><b>Пост дронов ПРО</b> — отдельная постройка-страж: держит патруль перехватчиков и отрабатывает по угрозам в системе автоматически.</li>
        <li>И то, и другое <b>видно не всем</b>: чужие заграждения вскрываются разведкой, а не с карты.</li>
      </ul>
    </section>

    <!-- КОНСТРУКТОРЫ -->
    <section id="gb-constructors" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⚒</span>Конструкторы</h2>
      <p>Готовых кораблей и танков в игре нет — есть только те, что вы <b>спроектировали сами</b>. «Конструкторы» — ваше КБ: здесь рождаются чертежи, которые потом ставятся в производство в Кабинете. Один и тот же чертёж можно строить сколько угодно раз, пока он не устареет.</p>

      <h3 class="gb-h3">Два цеха</h3>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">🚀 Корабельная верфь</span><span class="gb-kv-val">Космический флот. Классы корпусов: <b>Корвет · Эсминец · Крейсер · Факельщик · Носитель поддержки · Ударный носитель · Линкор · Дредноут</b> и станция <b>СС-13</b>.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🪖 Планетарный арсенал</span><span class="gb-kv-val">Единый цех для всего, что воюет у поверхности: <b>пехота, БТР, танк, артиллерия, дрон, БПЛА, самолёт, вертолёт, МЛА</b>. Отдельных конструкторов «наземки» и «авиации» больше нет — оба пункта ведут сюда же.</span></div>
      </div>
      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div><b>Дивизии больше не проектируются.</b> Билдер дивизий убран из хаба и открывается только для правки уже созданных. Теперь вы строите <b>отдельные юниты</b> и <b>формируете из них армии</b> — см. <a class="gb-link" onclick="gbScrollTo('gb-army')">«Армия и флот»</a>.</div>
      </div>

      <h3 class="gb-h3">Из чего собирается корпус</h3>
      <p>Слева — слоты проекта, справа — <b>схема корпуса «вид сверху»</b> с реальными узлами: огневые точки и отсеки под модули. Клик по узлу открывает каталог того, что в него влезет.</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">⬡ Класс корпуса</span><span class="gb-kv-val">Задаёт всё остальное: сколько узлов под оружие и модули, базовый экипаж, грузоподъёмность и <b>какие вообще</b> реакторы, двигатели и броня будут доступны — списки у каждого класса свои.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⚛ Реактор</span><span class="gb-kv-val">Единственный источник энергии. Уровни 1…4: чем выше, тем больше выработка и тем дороже корпус в сырье.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🔥 Двигатели</span><span class="gb-kv-val">Дают <b>тягу</b>. Скорость корабля выводится из тяги и массы — тяжёлый корпус с лёгким двигателем еле ползёт по гексам.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🛡 Броня</span><span class="gb-kv-val">Главный источник <b>прочности (HP)</b>: она считается из физики материала, а не из плоского «+N брони». Тут же подключаются ваши <b>собственные сплавы</b> (см. ниже).</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">◈ Щит</span><span class="gb-kv-val">Второй слой защиты, который восстанавливается. Ест энергию постоянно — и <b>обнуляется в туманности</b> на <a class="gb-link" onclick="gbScrollTo('gb-war')">поле боя</a>.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">📡 Радар</span><span class="gb-kv-val">Дальность обнаружения в гексах + <b>помехозащищённость</b> против чужой РЭБ. Активные станции «раскачиваются» энергией: мощный реактор добавляет радару дальности.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🔫 Огневые точки</span><span class="gb-kv-val">Узлы на схеме. В каждый ставится одно орудие; их число жёстко задано классом — на корвете их единицы, на дредноуте десятки.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⚙ Отсеки модулей</span><span class="gb-kv-val">РЭБ и контр-РЭБ, ПРО ближнего перехвата, интердиктор, стабилизатор, FTL-гипердвигатель, системы управления. Именно они решают <a class="gb-link" onclick="gbScrollTo('gb-war')">тактику боя</a>, а не калибр.</span></div>
      </div>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">✦</span>
        <div>Доступность каждой позиции в каталогах зависит от изученных <a class="gb-link" onclick="gbScrollTo('gb-research')">технологий</a>: неоткрытые группы оружия и модулей просто не показываются, а отдельные позиции висят с замком 🔒.</div>
      </div>

      <h3 class="gb-h3">Два лимита, которые не дадут вам соврать</h3>
      ${gbFigShip()}
      <p>Конструктор не ругается постфактум — он <b>не позволит</b> превысить лимит: последнее действие откатывается, и всплывает подсказка, что именно не влезло.</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">⚡ Остаток энергии</span><span class="gb-kv-val">Реактор выдаёт мощность, а двигатели, щит, радар, орудия и модули её вычитают. Ушло <b>в минус</b> — «энергосеть перегружена, реактор не тянет». Лечится реактором уровнем выше или снятием прожорливой системы.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⚖ Грузоподъёмность (кг)</span><span class="gb-kv-val">У корпуса есть <b>запас массы</b>. Каждое орудие, радар и часть модулей его съедают; некоторая броня и двигатели, наоборот, добавляют. Минус — «превышена грузоподъёмность». Именно этот остаток становится <b>трюмом торгового корабля</b>.</span></div>
      </div>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div><b>Торговый корабль</b> — это просто корпус, у которого <b>много свободных килограммов</b>: не вешайте на него орудия и тяжёлые системы. Оставшаяся грузоподъёмность = сколько увезёт <a class="gb-link" onclick="gbScrollTo('gb-trade')">караван</a>, а тяга двигателей — как быстро он дойдёт до партнёра.</div>
      </div>

      <h3 class="gb-h3">Что считает конструктор</h3>
      <p>Над схемой висит живой HUD: любая замена компонента сразу пересчитывает весь проект.</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">Прочность · Щиты</span><span class="gb-kv-val">HP из материала брони + ёмкость щита.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Огневая мощь</span><span class="gb-kv-val">Сумма урона всех установленных орудий.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Скорость</span><span class="gb-kv-val">В <b>«квадратах»</b> — это буквально гексы, которые корабль пройдёт за активацию в бою.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Дальность огня · Радар</span><span class="gb-kv-val">Тоже в гексах. Дальность огня = <b>лучшее</b> из установленных орудий; радар — когда вы вообще увидите цель.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Экипаж</span><span class="gb-kv-val">Растёт с каждым обитаемым узлом. Дредноут — это сотни человек.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Стоимость · Разработка</span><span class="gb-kv-val"><b>ГС</b> считаются из фактического сырья проекта, а <b>ОН</b> — из класса корпуса плюс надбавка за каждый навешенный компонент: перегруженный чертёж дорог не только в деньгах, но и в науке.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Конструкционные решения</span><span class="gb-kv-val">Разбивка по материалам: <b>Каркас · Системы · Броня · Электроника · Композиты</b> — из неё и выводится цена.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Сырьё / корпус</span><span class="gb-kv-val"><b>Ресурсная ведомость</b>: сколько реальных ресурсов со склада уйдёт на один такой корпус.</span></div>
      </div>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">◆</span>
        <div><b>Сырьё на постройку.</b> Кроме ГС, каждый корпус списывает <b>ресурсы со склада</b> по этой ведомости (броня → Железо/Титан, щиты → Редкоземельные руды/Дейтерий, реактор → Изотопы/Гелий-3 и т. д.). Чего нет — докупается по <b>×1.5</b> цены. Подробнее — в разделе <a class="gb-link" onclick="gbScrollTo('gb-resources')">«Ресурсы»</a>.</div>
      </div>

      <h3 class="gb-h3">Оружие: чем один ствол отличается от другого</h3>
      <p>У орудия четыре параметра, и все они всплывают на <a class="gb-link" onclick="gbScrollTo('gb-war')">доске боя</a>:</p>
      <ul class="gb-ul">
        <li><b>Канал урона</b> — кинетика, энергия или ракеты. Определяется технологией орудия и решает, как по нему отработает чужая броня: под каждый канал у сплава своя стойкость.</li>
        <li><b>Урон</b> считается из физики: калибр × масса установки × уровень технологии × класс орудия × тип боеприпаса. Поэтому «большая пушка» — это буквально большая пушка.</li>
        <li><b>Скорострельность</b> превращается в <b>число выстрелов в залпе</b> (1…6 «дробин»). Скорострельная батарея сыплет часто и слабо, тяжёлое орудие бьёт редко и страшно.</li>
        <li><b>Дальность</b> задаёт кольцо вокруг корабля в бою. Корабль с разнодальнобойными группами эффективен и на подходе, и в упор — но каждая группа отработает, только если цель в её кольце.</li>
      </ul>
      <div class="gb-note gb-note-tip">
        <span class="gb-note-i">★</span>
        <div><b>Не ставьте всё подряд.</b> Реактор и килограммы — общий бюджет: каждый лишний ствол отнимает энергию у щита и радара. Осмысленный корабль решает <b>одну задачу</b> — держать удар, стрелять издалека, глушить или ловить чужие подкрепления, — а не всё сразу.</div>
      </div>

      <h3 class="gb-h3">⚗ Алхимия брони — свои сплавы</h3>
      <p>Броню можно не выбирать из списка, а <b>сварить самому</b>: вы смешиваете <b>настоящие ресурсы игры</b>, и характеристики рождаются из <b>пропорций и порогов</b>, а не из принципа «чем больше насыпал, тем лучше». Удачная пропорция запускает <b>реакцию</b> — легированная сталь, титаналь, керметокомпозит, экзоматрица, кинетический монолит, динамическая защита, саморемонт, гравикомпенсация массы.</p>
      <ul class="gb-ul">
        <li>Сплав даёт свой <b>HP</b>, отдельные <b>стойкости к кинетике, энергии и ракетам</b> и может добавить или отнять грузоподъёмность.</li>
        <li>У рецепта бывают <b>предупреждения</b> — например, нестабильный заряд с риском детонации. Это не запрет, это ваш выбор.</li>
        <li>Готовый сплав появляется в списке брони наравне с заводскими и доступен всем вашим проектам.</li>
      </ul>

      <h3 class="gb-h3">Каталоги</h3>
      <p>Разделы <b>Флот · Наземная техника · Авиация · Дивизии</b> (в меню — группа «Войска») — витрины чужих и ваших проектов: можно посмотреть характеристики, схему и ресурсную ведомость чужого корабля, не строя его.</p>

      <h3 class="gb-h3">Путь от чертежа к войскам</h3>
      <div class="gb-steps">
        <div class="gb-step"><div class="gb-step-n">1</div><div>Изучите <b>технологии</b> — они открывают корпуса, орудия и модули.</div></div>
        <div class="gb-step"><div class="gb-step-n">2</div><div>Соберите проект в <b>Конструкторе</b> и уложитесь в энергию и килограммы.</div></div>
        <div class="gb-step"><div class="gb-step-n">3</div><div>Закажите производство: Кабинет → <b>«🏭 Строительство вооружённых сил»</b> (нужны военные здания со слотами и сырьё на складе).</div></div>
        <div class="gb-step"><div class="gb-step-n">4</div><div>К следующему игровому дню юниты выходят в <b>«⚔ Вооружённые силы государства»</b> — оттуда собираются <b>флоты и армии</b>.</div></div>
      </div>
    </section>

    <!-- РАЗВЕДКА -->
    <section id="gb-intel" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">◐</span>Разведка и агенты</h2>
      <p>Агенты — это <strong>именованные оперативники</strong> с перками, которых вы нанимаете на <strong>рынке рекрутов</strong>. Центр Спецслужб задаёт <b>потолок</b> числа агентов (2 + слоты Центра). Всё — на вкладке <strong>«Разведка»</strong>.</p>

      <h3 class="gb-h3">Агентура и рынок рекрутов</h3>
      <ul class="gb-ul">
        <li>Список <b>рекрутов</b> (кандидаты с именем, перком, расой и ценой) <b>обновляется ежедневно</b> — каждый игровой день 1–3 старейших кандидата заменяются новыми. Нанимаете за ГС.</li>
        <li>Нанятый агент <b>обучается 1 цикл</b>, затем готов к делу.</li>
        <li>Перк агента влияет на операции:</li>
      </ul>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">🕵 Инфильтратор</span><span class="gb-kv-val">+12% к успеху краж (казна, технологии).</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">💣 Диверсант</span><span class="gb-kv-val">+12% к успеху саботажа и дестабилизации.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">👻 Призрак</span><span class="gb-kv-val">−10% к риску раскрытия.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">📊 Аналитик</span><span class="gb-kv-val">+10% к успеху разведки.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🛡 Куратор</span><span class="gb-kv-val">+2 к защищённости ВСЕХ ваших систем (суммарно не больше +10) и ускоряет расследования.</span></div>
      </div>

      <h3 class="gb-h3">Операции</h3>
      <p>Выбираете цель, операцию и <b>каких конкретно агентов</b> отправить. Перки выбранных агентов прибавляются к шансам. Срок операций — <b>1–2 цикла</b>.</p>
      <div class="gb-tbl">
        <div class="gb-tr gb-th"><span>Операция</span><span>Требует</span><span>Результат</span></div>
        <div class="gb-tr"><span>Разведка (базовая)</span><span>—</span><span>Казна, наука, агенты, список колоний цели</span></div>
        <div class="gb-tr"><span>Глубокая разведка</span><span>—</span><span>Постройки, флот, технологии + постройки по колониям</span></div>
        <div class="gb-tr"><span>Кража казны</span><span>разведка</span><span>Похитить часть ГС</span></div>
        <div class="gb-tr"><span>Саботаж постройки</span><span>глуб. разведка</span><span>Вывести здание в <b>выбранной колонии</b></span></div>
        <div class="gb-tr"><span>Дестабилизация</span><span>разведка</span><span>Снизить доход цели на 3 цикла</span></div>
        <div class="gb-tr"><span>Кража технологий</span><span>глуб. разведка</span><span>Украсть технологию (нужна <b>сеть — ≥2 агента</b>)</span></div>
      </div>

      <h3 class="gb-h3">Тактические операции против флота</h3>
      <p>Отдельная ветка операций бьёт не по экономике, а по <b>военному флоту</b> цели. Выполняются <b>мгновенно</b>; сопротивление считается от <b>защищённости столичной системы</b> цели.</p>
      <div class="gb-tbl gb-tbl--2">
        <div class="gb-tr gb-th"><span>Операция</span><span>Результат</span></div>
        <div class="gb-tr"><span>📡 Подпространственная охота</span><span>Вскрывает <b>все скрытые факельщикы</b> цели на 2 суток (крит — на 4). Снимает стелс мобильной «Длани».</span></div>
        <div class="gb-tr"><span>💥 Диверсия на флот</span><span>Выбираете <b>конкретный флот</b> цели: успех — флот «застревает» (+1 день недвижим); крит — списывает <b>25–40%</b> каждого типа кораблей в составе.</span></div>
      </div>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Сложные операции требуют сначала провести <b>разведку</b> цели. Саботаж бьёт по <b>конкретной колонии</b> (выбирается из данных глубокой разведки). Пойманный на деле агент <b>выбывает</b> из агентуры.</div>
      </div>

      <h3 class="gb-h3">Защищённость систем</h3>
      <p><b>Защищённость</b> — единственная мера обороны и она же <b>сложность чужих операций</b>. Отдельного «уровня сложности» у операции больше нет: есть её <b>вес</b> — во сколько раз дело чувствительно к обороне (разведка со стороны ×0.5, кража технологий ×1.5).</p>
      <div class="gb-tbl gb-tbl--2">
        <div class="gb-tr gb-th"><span>Что даёт защиту</span><span>Сколько</span></div>
        <div class="gb-tr"><span>Базовая бдительность державы</span><span>+12 любой системе</span></div>
        <div class="gb-tr"><span>🏗 Пост разведки в системе</span><span>+8 за каждый</span></div>
        <div class="gb-tr"><span>🕵 Оперативник в охране системы</span><span>+4, и ещё +3 за каждый уровень сверх первого</span></div>
        <div class="gb-tr"><span>🛡 Куратор в штате</span><span>+2 за каждого на всю державу, но не больше +10</span></div>
        <div class="gb-tr"><span>🏛 Столичная система</span><span>+10</span></div>
        <div class="gb-tr"><span>Потолок</span><span>95 — глухую систему не вскрыть вообще</span></div>
      </div>
      <ul class="gb-ul">
        <li><b>Оперативники стоят в СИСТЕМАХ, а не в колониях.</b> Мест в системе ровно столько, сколько дают Посты разведки: <b>один Пост — три человека</b>. Нет Поста — селить некого, система держится на одной базовой бдительности.</li>
        <li><b>Государственные дела</b> (казна, технологии, дестабилизация, ликвидация) идут против <b>столичной системы</b>; саботаж и массовый снос — против системы <b>той колонии</b>, по которой бьют.</li>
        <li><b>Стоящий в охране в поле не ходит</b> — и наоборот. Это главный размен: люди либо защищают, либо работают.</li>
        <li><b>К сложности сверх защищённости</b> добавляются <b>чужеродность расы</b> оперативника (сойти за литоида человеку почти невозможно) и <b>личные изъяны</b> тех, кого вы отправили: пьянство, известное лицо, кодекс чести. Изъян виден в карточке оперативника.</li>
      </ul>

      <h3 class="gb-h3">Артефакты агентуры</h3>
      <p>Предметы, которые вешаются на <b>конкретного оперативника</b> — до двух штук. Достать их можно только в <a class="gb-link" onclick="gbScrollTo('gb-home')">Разломе</a>: артефакт отдают на джекпоте <b>«Взгляд в ответ»</b> — тогда, когда оттуда заметили вас.</p>
      <ul class="gb-ul">
        <li><b>👁 Одноразовые</b> — сгорают на первой же операции. Такова <b>Печать Взгляда</b>: одно дело удаётся гарантированно, чем бы цель ни была защищена.</li>
        <li><b>⛓ Проклятые</b> — снять нельзя, предмет отпустит оперативника только мёртвым. <b>Ярмо Разлома</b> учит втрое быстрее, но светится; <b>Шёпот роя</b> подсказывает верный ход и не затыкается в самых неподходящих местах.</li>
        <li>Прочее — <b>Стеклянный глаз</b> (пробивает 12 защищённости), <b>Хронокапля</b> (дело на ход короче), <b>Сердце Немого</b> и <b>Зеркальная маска</b> (почти не оставляют следов), <b>Пепел Тетославии</b>.</li>
      </ul>

      <h3 class="gb-h3">Расследование</h3>
      <ul class="gb-ul">
        <li><b>Расследование (мини-игра):</b> когда вас бьют незаметно, в «Тревогах» виден ущерб, но не исполнитель. Жмите <b>«Расследовать»</b> (150 ГС за попытку) — копятся <b>улики</b>, по мере улик открываются подсказки (буква названия, длина), а на <b>100%</b> шпион <b>вычислен</b> (отношения падают, casus belli, новость). Больше контрразведки/Кураторов — быстрее улики.</li>
      </ul>
    </section>

    <!-- ТОРГОВЛЯ -->
    <section id="gb-trade" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⇄</span>Торговля и караваны</h2>
      <p>Всё это живёт во вкладке <strong>«⛏ Ресурсы и торговля»</strong>, разбитой на под-вкладки: <b>⛏ Ресурсы · 🚛 Караваны · 🏪 Рынок · 🤝 Обмен · 📊 Биржа · ⚖ Концессии</b>. (Отношения, союзы и кредиты — отдельная вкладка <strong>«🤝 Дипломатия»</strong>.)</p>

      <h3 class="gb-h3">Караван = торговый флот + груз</h3>
      ${gbFigCaravan()}
      <p>Караван — это <b>постоянное соглашение</b>: после согласия партнёра он <b>каждый цикл</b> возит вашу добычу и обе стороны получают ГС (партнёр — половину сверху). Караван возит <b>поток добычи</b>, а не единицы со склада.</p>
      <ul class="gb-ul">
        <li><b>Флот.</b> Соберите караван из <b>торговых кораблей</b> (корпус с грузовыми ангарами — строится в Конструкторах). Сумма грузоподъёмности = сколько груза увезёт.</li>
        <li><b>Груз.</b> Отмечаете <b>месторождения</b> (которые добываете в режиме 💱 Экспорт) — флот грузит их поток, заполняя трюм по убыванию ценности. Можно везти <b>несколько ресурсов</b> сразу.</li>
        <li><b>Скорость → время в пути.</b> Быстрые корабли быстрее доходят до партнёра. Караван сначала «в пути» (1–2 цикла) и приносит доход только по прибытии.</li>
        <li><b>Дипломатия.</b> Отношения с партнёром дают <b>±20%</b> к выгоде каравана.</li>
        <li><b>Эскорт (конвой).</b> Боевые корабли в караване снижают риск пиратов в пути.</li>
      </ul>

      <h3 class="gb-h3">Куда девать добычу: склад · экспорт · рынок</h3>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">📦 Склад</span><span class="gb-kv-val">Режим добывающего завода: ресурс копится в пул (лимит — склады). Караванам недоступен.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">💱 Экспорт</span><span class="gb-kv-val">Режим завода: добыча идёт в <b>караваны</b>; что караваны не разобрали — авто-продаётся по 60%.</span></div>
      </div>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Один поток — один канал: ресурс либо копится на склад, либо идёт на экспорт/караваны. Дорогое везите караванами (полная цена + дипломатия).</div>
      </div>

      <h3 class="gb-h3">Опасности и защита</h3>
      <p>На караваны нападают пираты и древние угрозы на пути, а также <b>игроки-каперы</b> — вражеские <b>флоты на карте</b>, стоящие на гиперпути каравана (см. «Пиратство»). При нападении доход за цикл теряется или груз угоняют. Защита: <b>конвой</b> в караване и <b>торговая политика</b> (платный контракт с NPC-флотом, задаётся здесь же, в под-вкладке «Караваны»).</p>

      <h3 class="gb-h3">Обмен (бартер)</h3>
      <p>Блок <b>«Обмен»</b> позволяет передавать активы между фракциями: <b>ГС, ОН, ресурсы склада и корабли</b> (передаётся владение). Соберите, что <b>отдаёте</b>, и при желании — что хотите <b>взамен</b>:</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">Подарок</span><span class="gb-kv-val">Если поле «взамен» пустое — активы уходят партнёру сразу.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Сделка</span><span class="gb-kv-val">Если указали встречный запрос — партнёр получает <b>предложение</b> и принимает/отклоняет его. Обмен проходит <b>атомарно</b>: если у любой из сторон не хватает активов в момент принятия — сделка не состоится.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Корабли</span><span class="gb-kv-val">Передаются по модели из вашего ростера; у получателя они появляются как готовые.</span></div>
      </div>

      <h3 class="gb-h3">Рынок технологий и чертежей</h3>
      <p>В подвкладке <b>«Обмен»</b> можно продавать за ГС <b>изученные технологии</b> и <b>чертежи кораблей/дивизий</b>. Покупатель платит и получает технологию в своё дерево (или чертёж в конструктор). Удобно «продать науку» союзнику или подзаработать на отстающих.</p>
    </section>

    <!-- БИРЖА -->
    <section id="gb-exchange" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">📊</span>Биржа</h2>
      <p>Под-вкладка <strong>«📊 Биржа»</strong> (внутри «⛏ Ресурсы и торговля») — это финансовые инструменты, надстроенные над живым рынком ресурсов. Цены ресурсов «дышат» сами по себе (спрос/предложение галактики), и на этих движениях можно зарабатывать, не добывая ни тонны руды. Биржа — для тех, кто уже наладил экономику и хочет вложить свободные ГС.</p>
      ${gbFigExchange()}

      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div><b>Торговая сессия.</b> Сделки с долями организаций идут только при <b>открытых торгах</b> (окно по времени UTC, статус виден вверху вкладки). На закрытии — фиксинг цен и выплата дивидендов. Деривативы и облигации доступны и вне сессии.</div>
      </div>

      <h3 class="gb-h3">🏢 Организации (корпорации)</h3>
      <p>Объедините свои <b>реальные постройки</b> в организацию — вместе они дают <b>синергию</b>: +3% дохода за каждую вложенную постройку (до +30%). <b>Доли</b> в корпорации можно продавать другим фракциям через биржевой стакан, а владельцы долей получают <b>дивиденды</b> с дохода построек. Котировки крутит сама галактика через <b>секторный спрос</b>.</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">⚡ Синергия</span><span class="gb-kv-val">+3% дохода за постройку в составе организации, потолок +30%. Стимул собирать профильные активы под одной вывеской.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">📊 Секторный спрос</span><span class="gb-kv-val">Множитель дохода и котировок <b>0.25× … 3.0×</b>. Дефицит сырья поднимает рудники, очередь кораблей — верфи, торговые пути — хабы, охват веры — храмы.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">💵 Дивиденды</span><span class="gb-kv-val">Держите доли чужих корпораций — на закрытии торгов получаете часть их дохода.</span></div>
      </div>

      <h3 class="gb-h3">📋 Заказы (госзаказ / RFQ)</h3>
      <p>Разместите <b>заявку на закупку</b> ресурса: деньги блокируются в <b>эскроу</b>, а заказ объявляется в ленте сектора. Любая фракция исполняет его из своих запасов — <b>целиком или частями</b> — и получает гарантированную оплату из эскроу. Удобно, когда нужно докупить редкое сырьё под флот или «Длань».</p>

      <h3 class="gb-h3">🏛 Облигации — долг</h3>
      <p>Два режима. <b>Инвестор:</b> покупаете облигации другой державы, каждый ход получаете <b>купон</b> (проценты), в конце срока вам возвращают <b>номинал</b>. <b>Эмитент:</b> сами выпускаете облигации — получаете ГС сразу, но каждый ход платите купон держателям и гасите номинал в срок.</p>
      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div><b>Риск дефолта.</b> Если у эмитента кончатся ГС на выплату — купоны прекращаются и номинал не вернут. Высокий купон обычно означает и выше риск.</div>
      </div>

      <h3 class="gb-h3">Деривативы — ставки на цену</h3>
      <p>Это <b>чистые ставки на движение цены</b> ресурса: сам ресурс вы не покупаете, выигрыш и проигрыш приходят деньгами. Расчёт идёт по <b>официальному курсу</b> (его пересчитывает Биржевой совет раз в 3 часа — <b>ваши сделки на курс не влияют</b>), с небольшой <b>комиссией палаты</b>; выигрыши выплачиваются из её резерва. Внутри каждой под-вкладки есть кнопка «📖 простыми словами» с примером.</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">📈 Маржа</span><span class="gb-kv-val"><b>Лонг</b> (ставка на рост) или <b>шорт</b> (на падение) с <b>плечом до ×2</b>. Плечо множит и прибыль, и убыток. ⚠ Дойдёт цена до <b>цены ликвидации</b> — позиция закроется, залог сгорит.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">📅 Фьючерсы</span><span class="gb-kv-val">То же, что маржа, но с <b>датой экспирации</b> — контракт сам рассчитается в срок. Вход чуть дороже спота (<b>контанго</b>), к дате надбавка тает.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🎲 Опционы</span><span class="gb-kv-val">Покупаете <b>право</b> за <b>премию</b>. <b>Колл</b> — на рост, <b>пут</b> — на падение. Угадали — выплата; не угадали — теряете <b>только премию</b>, ликвидации нет.</span></div>
      </div>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div><b>Спот-торговлю</b> самими ресурсами (купить/продать по текущей цене) ищите в под-вкладке <b>«🏪 Рынок»</b>, а не на бирже. Биржа — это инструменты <i>поверх</i> цен.</div>
      </div>
      <div class="gb-note gb-note-tip">
        <span class="gb-note-i">★</span>
        <div>Новичку: начните с <b>организаций</b>, <b>облигаций</b> или <b>опционов</b> — там нет ликвидации (у опциона риск ограничен премией). Маржу и фьючерсы с плечом оставьте на потом.</div>
      </div>
    </section>

    <!-- ПИРАТСТВО (ФЛОТЫ КАРТЫ) -->
    <section id="gb-raids" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">🏴</span>Пиратство (флоты на карте)</h2>
      <p>PvP-пиратство ведут <strong>флоты прямо на карте галактики</strong> — отдельной вкладки в кабинете больше нет. Подводите свой флот к <b>гиперпути</b>, по которому идёт чужой караван, и грабите его одним нажатием. Добыча — ресурсы и ГС.</p>

      <h3 class="gb-h3">Как грабить</h3>
      <ul class="gb-ul">
        <li>Флот должен <b>стоять (idle)</b> в системе, через которую <b>проходит трасса</b> вражеского каравана (концы маршрута или любая система на пути по гиперпутям).</li>
        <li>Кликните флот на карте → в его командной плашке появятся кнопки <b>«🏴 Грабить»</b> по каждому доступному каравану.</li>
        <li>Единственная проверка — <b>заметят или нет</b>. <b>Не заметили</b> → тихо угоняете часть груза (ресурсы + ГС). <b>Заметили</b> → добычи нет, <b>отношения с целью падают</b> (casus belli), а жертва получает новость с вашим именем.</li>
        <li>Боя и потерь кораблей нет — это стелс-налёт. Шанс, что заметят, растёт от <b>эскорта каравана</b>, <b>патруля цели</b> и размера вашего флота.</li>
        <li>После налёта у флота <b>кулдаун 3 часа</b>.</li>
      </ul>

      <h3 class="gb-h3">⛓ Рабство и Синли-бей</h3>
      <ul class="gb-ul">
        <li><b>Налёт на колонию</b>: тот же idle-флот в <b>чужой системе с колонией</b> → кнопка «⛓ Налёт на колонию». Стелс-чек; успех угоняет часть населения в <b>рабство</b> (происхождение — держава колонии, оно сохраняется навсегда).</li>
        <li><b>Рабы — рабочие без благополучия</b>: вливаются в пул рабочих державы и <b>копают залежи как обычные рабочие</b>, но не считаются населением и не требуют благополучия/упкипа.</li>
        <li><b>Синли-бей</b> (в новелле) — невольничий рынок: раз в неделю появляются NPC-лоты рабов случайной державы, плюс лоты игроков. <b>Происхождение видно, продавец скрыт.</b> Выкуп рабов <b>своей</b> державы возвращает их в население.</li>
        <li>Тайная операция <b>«Похищение рабов»</b> — агентами угнать чужих рабов себе.</li>
        <li>❌ <b>Просвещённым державам</b> (демократический/эгалитарный режим или идеология Пацифизм/Ксенофилия) рейды, рабы и Синли-бей <b>недоступны</b>.</li>
      </ul>

      <h3 class="gb-h3">Защита своих караванов</h3>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">Конвой</span><span class="gb-kv-val">Свои боевые корабли в конкретном караване — дают отпор грабителю.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">📜 Торговая политика</span><span class="gb-kv-val">Платный контракт с NPC-флотом, защищает <b>все</b> ваши караваны. Тиры: Патрульный контракт (120 ГС/цикл, +8 защиты) и Конвой Торговой Лиги (350 ГС/цикл, +18). Апкип списывается каждый цикл.</span></div>
      </div>
    </section>

    <!-- ДИПЛОМАТИЯ И СОЮЗЫ -->
    <section id="gb-diplo" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">🤝</span>Дипломатия и союзы</h2>
      <p>Вкладка <strong>«🤝 Дипломатия»</strong> — отношения, кредиты, <b>союзы</b> и пограничный контроль. Форм союза ровно три: <b>конфедерация</b>, <b>федерация</b> и <b>вассалитет</b> — других (объединения двух держав в одну и подобного) в игре пока нет.</p>

      <h3 class="gb-h3">Закрытие границ <span class="gb-badge">🔒</span></h3>
      <p>Границы закрываются <b>выборочно, по фракциям</b> (или разом для всех). Кому вы закрыли границу — <b>тот не введёт свои флоты в ваши системы</b>, а его гипермаршруты сквозь вашу территорию будут строиться в обход. Открыть обратно можно в любой момент.</p>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div><b>Союзники по федерации и конфедерации проходят всегда</b> — на них закрытие границ не действует.</div>
      </div>

      <h3 class="gb-h3">Федерация и конфедерация</h3>
      <p>Многочленные союзы равных держав. Создаёте союз (название + тип), приглашаете другие фракции, они вступают. Лидер может приглашать; при выходе лидера лидерство переходит дальше.</p>
      <ul class="gb-ul">
        <li><b>Конфедерация</b> — мягкий союз: бонус к защите караванов и от разведки.</li>
        <li><b>Федерация</b> — крепкий союз: сильнее защита и общий флот.</li>
      </ul>

      <h3 class="gb-h3">Вассалитет</h3>
      <p>Парный пакт: <b>сюзерен</b> и <b>вассал</b>. Вы предлагаете фракции стать вассалом с договорной <b>данью 5–30%</b> от её дохода ГС. Вассал принимает или отклоняет; любая сторона может разорвать.</p>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Одна фракция — один союз. Вассал не может брать своих вассалов. Вассал платит сюзерену дань каждый цикл, взамен — защита.</div>
      </div>

      <h3 class="gb-h3">Кредиты и МГА</h3>
      <p>Можно выдать <b>заём</b> другой фракции в ГС (с условиями в заметке). Заёмщик гасит долг кнопкой «Погасить». Если заёмщик не платит — кредитор открывает <b>спор</b>, и дело уходит в <b>МГА</b> (межгалактический арбитраж), где решение по спорному долгу принимает администрация.</p>

      <h3 class="gb-h3">Отношения</h3>
      <p>Дипломатический <b>респект</b> отражает отношения между державами и влияет на механику: например, отношения с торговым партнёром дают <b>±20%</b> к выгоде каравана, а раскрытый шпионаж/рейд их роняет.</p>
    </section>

    <!-- ВЕРА -->
    <section id="gb-faith" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">🛐</span>Вера и религия</h2>
      <p>Для духовных держав вера — это <b>отдельная экономика</b>, параллель торговле: религии основывают, разносят их по галактике и строят <b>Храмы Веры</b>, которые кормят казну и удешевляют армию. Всё — на вкладке <strong>«Вера»</strong>.</p>
      ${gbFigFaith()}

      <h3 class="gb-h3">Кто может исповедовать веру</h3>
      <ul class="gb-ul">
        <li><b>Основать</b> собственную религию могут идеология <a class="gb-link" onclick="gbScrollTo('gb-doctrine')">«Спиритуализм»</a> и форма правления <b>«Теократия»</b> — но <b>только одну</b> свою.</li>
        <li><b>Прочие народы</b> своей волей веру не учреждают — они могут <b>принять чужую</b> только по приглашению («признание») от её основателя.</li>
        <li><b>Мультивера.</b> Держава может исповедовать <b>сразу несколько религий</b> и строить храмы разных вер — при постройке храма указывается, чьей он религии.</li>
      </ul>

      <h3 class="gb-h3">Храм Веры и благословения</h3>
      <p>Храм строится во вкладке <a class="gb-link" onclick="gbScrollTo('gb-colonies')">«Колонии»</a> (1 200 ГС, первый — бесплатный, до 6 слотов). Доход и сила храма идут, <b>пока вы исповедуете его религию</b>.</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">💰 +150 ГС за слот</span><span class="gb-kv-val">Пассивный доход с каждого слота храма (× бонусы доктрины).</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⚔ Дешевле войска</span><span class="gb-kv-val">«Сила паствы» (сумма слотов храмов) удешевляет постройку войск, <b>флот — вдвое сильнее</b>. Спиритуалистам и теократиям эффект больше.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🙏 Сила паствы</span><span class="gb-kv-val">Чем больше слотов храмов по всей державе — тем сильнее все благословения.</span></div>
      </div>

      <h3 class="gb-h3">Роли и десятина</h3>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">👑 Пророк-основатель</span><span class="gb-kv-val">Учредил веру. Взимает <b>десятину +20%</b> с дохода храмов всех адептов своей религии.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🕊 Признавший веру</span><span class="gb-kv-val">Принял чужую веру по приглашению. Строит её храмы, но отдаёт основателю десятину с их дохода.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🙏 Адепт</span><span class="gb-kv-val">Рядовой носитель веры.</span></div>
      </div>
      <p><b>Распространение.</b> Основатель шлёт <b>миссионеров</b> к другой державе («Предложить признание»): приняв веру, она начинает строить ваши храмы — и с их дохода вам течёт десятина. Чем шире паства, тем богаче культ.</p>

      <h3 class="gb-h3">🕳 Тайные секты</h3>
      <p>Через <a class="gb-link" onclick="gbScrollTo('gb-intel')">разведку</a> (операция «Тайная секта») можно внедрить <b>скрытый храм</b> своей веры в чужую державу. Он работает как обычный храм — <b>+150 ГС/сут идут вам</b> — пока <b>контрразведка цели его не вскроет</b>. У каждой секты растёт <b>риск вскрытия %</b>; вскрытая секта ликвидируется.</p>

      <h3 class="gb-h3">Модерация и реестр</h3>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Новая религия проходит <b>модерацию администрации</b>, как анкета фракции: имя, догмат и образ становятся видны миру после одобрения, но <b>бонусы храмов действуют сразу</b>. Все веры галактики собраны в <b>реестре религий</b> на вкладке «Вера».</div>
      </div>
    </section>

    <!-- ОРУЖИЕ СУДНОГО ДНЯ -->
    <section id="gb-doom" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">🜨</span>Оружие судного дня</h2>
      <p><strong>«Длань Неотвратимости»</strong> — межзвёздная артиллерия и самое страшное оружие в игре. Это <b>капстоун</b>: дойти до него непросто, зато оно нарушает обычные правила — залпом из вашей системы можно <b>навсегда стереть планету в чужой системе</b>, превратив её в мёртвый камень вместе со всеми колониями на ней.</p>
      ${gbFigDoom()}

      <h3 class="gb-h3">Путь к орудию</h3>
      <div class="gb-wsteps">
        <div class="gb-wstep"><b>Исследуйте «Сама неотвратимость».</b> Запредельно дорогой капстоун ветки политики — <b>5 000 ОН</b>. Открывает постройку орудия.</div>
        <div class="gb-wstep"><b>Возведите «Длань Неотвратимости»</b> на одной из колоний: <b>700 000 ГС + 40 единиц Программируемой материи</b> на складе, 1 игровой день. Орудие не открывает слоты — оно одно на постройку.</div>
        <div class="gb-wstep"><b>Постройте «☢ Арсенал Судного Дня»</b> — <b>300 000 ГС + 20 Программируемой материи</b>. Без него орудие молчит: «Длань» стреляет не ресурсами, а <b>готовыми снарядами</b>, и собирает их только Арсенал.</div>
        <div class="gb-wstep"><b>Соберите снаряд Х67 «Ада»</b> — <b>150 000 ГС + 20 Гравиядра + 8 Программируемой материи</b>, один снаряд за сутки. Арсенал делает их по одному, впрок.</div>
      </div>
      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div>Сложите цифры: <b>полтора миллиона ГС</b> до первого выстрела и по 150 000 за каждый следующий снаряд. «Длань» — не оружие войны, а оружие последнего аргумента.</div>
      </div>

      <h3 class="gb-h3">Как стреляет</h3>
      <ul class="gb-ul">
        <li>Откройте <b>«Пульт залпа»</b>, выберите <b>любую систему</b> на карте и планету-цель. Залп списывает <b>один готовый снаряд</b> со склада Арсенала.</li>
        <li><b>Снаряд летит не мгновенно.</b> Время полёта зависит от дистанции: <b>~3 часа</b> до соседней системы и <b>до 24 часов</b> от края до края галактики. Жертва видит, что залп в пути, и успевает поднять <a class="gb-link" onclick="gbScrollTo('gb-defense')">ПРО</a>.</li>
        <li><b>Залп можно сбить.</b> У цели открывается <a class="gb-link" onclick="gbScrollTo('gb-defense')">«Окно перехвата»</a> — блеф-дуэль наведения; <b>Ожерелье Немезиды</b> сбивает гарантированно.</li>
        <li>При попадании планета становится <b>мёртвым камнем</b> (🪨): любая колония на ней стирается, включая столицу, и заселить её больше нельзя.</li>
      </ul>

      <h3 class="gb-h3">🏭 Баллистика и Факельщик</h3>
      <p>Стирать планеты нужно не всегда. Вторая ветка судного дня — <b>баллистические боеголовки</b>: они не убивают мир целиком, а выбивают <b>население и постройки</b>. Их конвейер — <b>«Баллистический военпромзавод»</b> (150 000 ГС, технология баллистики), по снаряду в сутки.</p>
      <div class="gb-table-wrap"><table class="gb-table">
        <thead><tr><th>Снаряд</th><th>Цена</th><th>Что делает</th></tr></thead>
        <tbody>
          <tr><td><b>Х19 «Хазар»</b><br><span class="gb-cap-foot">лёгкая баллистика</span></td><td>20 000 ГС</td><td>Летит <b>вдвое быстрее</b> · 2–6% населения · 0–1 постройка</td></tr>
          <tr><td><b>Х69 «Фантом»</b><br><span class="gb-cap-foot">баллистика-невидимка</span></td><td>60 000 ГС · 2 Гравиядра</td><td><b>Невидим для планетарной ПРО</b> — сбивает только Немезида · 2–5% населения · 1 постройка</td></tr>
          <tr><td><b>Х05 «Сурей»</b><br><span class="gb-cap-foot">кассетная баллистика</span></td><td>90 000 ГС · 4 Гравиядра</td><td><b>Широкое накрытие</b> · 8–16% населения · 2–4 постройки</td></tr>
          <tr><td><b>Х0414 «Отей»</b><br><span class="gb-cap-foot">тяжёлая баллистика</span></td><td>250 000 ГС · 1 Гравиядро</td><td><b>Гарантированно 5 построек</b> · 12–22% населения · вдвое больший радиус · летит медленно</td></tr>
        </tbody>
      </table></div>
      <p><b>Факельщик</b> — мобильная «Длань»: корабль-носитель, который возит орудие по карте. Стоит <b>1 200 000 ГС + 60 Программируемой материи</b>, залп жжёт <b>12 Гравиядра</b> и сильно изнашивает установку. Дальность — <b>4 прыжка</b> по гиперпутям от текущей позиции (тяжёлым снарядом — вдвое дальше). Главное его свойство: <b>чужой Факельщик невидим на карте</b>, пока не выстрелит или пока его не вскроют спецоперацией «Подпространственная охота» (см. <a class="gb-link" onclick="gbScrollTo('gb-intel')">«Разведка»</a>).</p>

      <h3 class="gb-h3">Содержание и деградация</h3>
      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div>Орудие <b>деградирует</b>. У него есть <b>целостность 0–100</b>: каждый выстрел снимает <b>20</b>, и сверх того она падает <b>сама по себе — на 5 в сутки</b>. Оплаченное содержание (<b>4 Программируемой материи в день</b>) снижает естественный распад до <b>1 в сутки</b>. Кончится целостность — «Длань» <b>развалится</b>. Это не оружие «построил и забыл»: пока оно стоит, вы платите материей.</div>
      </div>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Применение «Длани» — событие галактического масштаба. По правилам проекта уничтожение планет и сверх-оружие <b>согласуются с Администрацией</b> и почти всегда влекут дипломатические последствия (casus belli, коалиции против вас).</div>
      </div>
    </section>

    <!-- КАРТА -->
    <section id="gb-map" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⬢</span>Карта галактики</h2>
      <p>Карта — это живое полотно всей вселенной: тут видно, кому принадлежит каждая звезда, как соединены системы и где проходят границы держав. С карты вы расширяете территорию и выбираете цели — будь то новая колония или планета под залп <a class="gb-link" onclick="gbScrollTo('gb-doom')">«Длани Неотвратимости»</a>.</p>
      ${gbFigMap()}

      <h3 class="gb-h3">Что на ней видно</h3>
      <ul class="gb-ul">
        <li><b>Системы</b> — серые нейтральные и окрашенные в цвет фракции-владельца. Внутри системы — планеты с их типами и ресурсами.</li>
        <li><b>Гиперпути</b> — линии между системами; по ним ходят флоты, торговые караваны и рейдеры. Соседство по гиперпути решает, что вы можете захватить и с кем граничите.</li>
        <li><b>Границы</b> — автоматически очерчивают территорию каждой державы. На стыке двух держав образуется <b>линия фронта</b> (граница в цветах обоих соседей).</li>
        <li><b>★ Столица</b> — главная система фракции, отмечена звездой.</li>
        <li><b>◇ Секторы</b> — крупные регионы галактики со своим лором, цветом и особой границей. На целый сектор влияют события (война, пираты, бум), задевая благосостояние систем внутри.</li>
      </ul>

      <h3 class="gb-h3">Иконки юнитов у звёзд</h3>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">⚓ Флот (клин)</span><span class="gb-kv-val">Соединение кораблей <b>слева</b> от звезды, в цвете и под флагом владельца, с бейджем числа кораблей. Свои — кликабельны (команды движения). Чужой со скрытым составом — серый бейдж «<b>⚓?</b>».</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🜨 Факельщик (мобильная «Длань»)</span><span class="gb-kv-val">Иконка <b>справа</b> от звезды. <b>Чужой невидим</b>, пока не выстрелит или его не вскроют разведкой; вскрытый — пульсирует <b>красным кольцом</b> «обнаружен».</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⛟ Носитель аванпоста</span><span class="gb-kv-val">Движущийся юнит-строитель: летит по гиперпутям и разворачивает аванпост (управление прямо на карте).</span></div>
      </div>

      <h3 class="gb-h3">Захват систем</h3>
      <ul class="gb-ul">
        <li>Захватывать можно только <b>ничейную</b> систему, <b>смежную</b> по гиперпути с вашей территорией. Чужие системы так не отнять — для этого война и отыгрыш.</li>
        <li>Стоимость — <b>3 000 ГС</b> (с учётом доктрины), после чего действует <b>перезарядка 4 дня</b> — доктрина её удлиняет или сокращает.</li>
        <li>Базово — <b>1 захват</b>, затем перезарядка. Технология <b>«Дом в небесах»</b> или раса <a class="gb-link" onclick="gbScrollTo('gb-doctrine')">роботов</a> дают пул из <b>2 захватов подряд</b> — берёте 2 системы, и только потом стартует перезарядка.</li>
      </ul>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>На телефонах и планшетах карта работает через отдельный быстрый отрисовщик (управляется пальцем — щипок для зума, перетаскивание для сдвига).</div>
      </div>
    </section>

    <!-- НОВЕЛЛА НА ГЛАВНОЙ -->
    <section id="gb-novella" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">❖</span>Новелла на главной</h2>
      <p class="gb-lead">Главная страница — не витрина, а <b>вторая половина игры</b>. Сцена с героиней-советницей задаёт вопрос, а вы отвечаете пунктами меню: часть из них — быстрый доступ к обычным вкладкам Кабинета, часть — механики, которых <b>нигде больше нет</b>.</p>

      <h3 class="gb-h3">Что в меню разговора</h3>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">◈ События · биржа · рынок</span><span class="gb-kv-val">Сводки галактики: хроника сектора, куда идёт биржевой индекс и что двигает цены ресурсов. Быстрый утренний обзор, не выходя из новеллы.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🏆 Достижения · 📊 Рейтинг</span><span class="gb-kv-val">Ачивки за сегодня и <b>живой рейтинг держав</b> сектора — кто впереди по экономике, науке и силе.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🪐 Колонизация · управление</span><span class="gb-kv-val">Те же действия, что во вкладках «Колонии» и «Исследования», но прямо из разговора.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⛏ Георазведка</span><span class="gb-kv-val">Казино под вывеской геологии: платите за разведку своей колонии и получаете случайную залежь — от пустышки до джекпота.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🜂 Всмотреться в Разлом</span><span class="gb-kv-val">Псионический хор державы. Подробности ниже.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🥊 Бойцовский клуб</span><span class="gb-kv-val">Дуэли на выданных кораблях + тотализатор. Подробности ниже.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⌘ FPNI</span><span class="gb-kv-val">Досье Фонда по защите от невмешательства: найденные <a class="gb-link" onclick="gbScrollTo('gb-precursors')">дозвёздные цивилизации</a> и решения по ним.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">⛓ Синли-бей</span><span class="gb-kv-val">Невольничий рынок (см. <a class="gb-link" onclick="gbScrollTo('gb-raids')">«Пиратство»</a>). <b>Пункт не появляется</b> у просвещённых держав.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🕵 Разведуправление</span><span class="gb-kv-val">Вся тайная война: агентура и рынок рекрутов, планирование операций, досье на другие державы, защищённость систем, плен и журнал дел. <b>Отдельной вкладки «Разведка» в Кабинете больше нет</b> — она целиком здесь.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🜨 Штаб артиллерии</span><span class="gb-kv-val">Пульт залпа и обороны <a class="gb-link" onclick="gbScrollTo('gb-doom')">«Длани»</a> с наводчиком-персонажем. Пункт открывается только после исследования «Сама неотвратимость».</span></div>
      </div>

      <h3 class="gb-h3">🜂 Разлом — ставка, поле и осколки</h3>
      <p>Вы платите ставку, и хор погружается в подпространство: открывается <b>поле 7×7 узлов</b>. Одна ставка = <b>три погружения</b>; каждая дополнительная ставка добавляет ещё одно и <b>разгоняет множитель</b> всех находок. Что можно вытащить:</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">Взгляд в ответ</span><span class="gb-kv-val">Джекпот — встречное касание чуждого разума, <b>×6 от ставки</b>.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Псионический маяк</span><span class="gb-kv-val">×2 от ставки. <b>Собрали 2 маяка</b> — получаете <b>◈ осколок цикла</b>.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Эхо Разлома · Видение</span><span class="gb-kv-val">Мелкие находки (×0.8) плюс образ в кодекс — его можно рассмотреть во весь экран. <b>4 видения</b> тоже дают осколок.</span></div>
      </div>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">◈</span>
        <div><b>Осколок цикла</b> — бесплатная и мгновенная постройка одного юнита во вкладке «🏭 Военпром»: без ГС, сырья, очереди и лимитов цехов. Осколки бывают <b>классовые</b> (осколок корвета не построит дредноут) и <b>универсальные</b> — сначала тратятся классовые.</div>
      </div>
      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div>Если вы исповедуете чужую веру, с каждой ставки в Разломе уходит <b>десятина патрону — 5%</b>. Разлом — это азарт: ставка может не вернуться вовсе.</div>
      </div>

      <h3 class="gb-h3">🥊 Бойцовский клуб</h3>
      <ul class="gb-ul">
        <li><b>Сутки идёт набор заявок.</b> Затем сервер выбирает <b>двух дуэлянтов</b> и выдаёт им <b>случайные свежие корабли</b>, честно подобранные по стоимости — свой флот тут ни при чём, ставится только мастерство.</li>
        <li>Дуэль — <b>настоящий тактический бой</b> на <a class="gb-link" onclick="gbScrollTo('gb-war')">гекс-доске</a>, только на тесном поле 48×28.</li>
        <li>Остальные <b>смотрят и ставят</b> (потолок ставки — 500 000 ГС). Банк = проигравший пул плюс ставка НПС (до 400 000) — он делится между угадавшими.</li>
      </ul>
    </section>

    <!-- ДОЗВЁЗДНЫЕ ЦИВИЛИЗАЦИИ -->
    <section id="gb-precursors" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⌘</span>Дозвёздные миры и Фонд</h2>
      <p class="gb-lead">На некоторых планетах живут <b>цивилизации, которые ещё не вышли в космос</b>. У каждой — своя раса, своя религия, своя прожитая история от каменного топора до первых спутников, написанная генератором и <b>не повторяющаяся</b> ни у кого другого. Что с ними делать — решаете вы. Вкладка <b>«FPNI»</b> в новелле.</p>

      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Мир виден державе, у которой <b>есть колония в его системе</b> (или уже был контакт). Показанный тир может <b>врать</b>: скрытные культуры и те, кто уже тайно вышел в космос, выглядят примитивнее, чем есть.</div>
      </div>

      <h3 class="gb-h3">История идёт сама</h3>
      <ul class="gb-ul">
        <li>Двенадцать эпох: <b>E0 → E11</b>, от первых костров до порога звёздного полёта. <b>Раз в неделю</b> каждый живой мир делает <b>один шаг</b> по своей летописи — часы у всех свои, галактика не шагает строем.</li>
        <li>Летопись читается как книга: у каждой строки своя дата — прошлое по <b>их</b> годам, всё случившееся при вас — по звёздной дате, как в новостях.</li>
        <li><b>Шаг после E11 — взлёт.</b> Мир перестаёт быть находкой и становится <b>новой фракцией на карте</b> со своим именем, цветом и формой правления. Если он был вашим протекторатом или возвышен вами — рождается <b>вашим вассалом</b>. Если вы им насолили — взлетают злыми, и в сводке это сказано прямым текстом.</li>
        <li>После взлёта дозвёздные решения по ним закрыты: это уже <b>внешняя политика</b>, а не опека.</li>
      </ul>

      <h3 class="gb-h3">Решения</h3>
      <p>Каждое вмешательство дописывает строку в их летопись — потом вы прочитаете, что сделали, их же словами. На действие даётся <b>кулдаун 20 часов</b>, отдельно от наблюдения. Цены растут с тиром цивилизации.</p>
      <div class="gb-table-wrap"><table class="gb-table">
        <thead><tr><th>Решение</th><th>Цена</th><th>Что делает</th><th>Досье</th></tr></thead>
        <tbody>
          <tr><td>🔬 <b>Изучать</b></td><td>—</td><td>Наука с их истории; шаманы и древние руины дают <b>×3</b>. Единственное, что <b>лечит</b> досье Фонда.</td><td><b>+5</b></td></tr>
          <tr><td>🎁 <b>Дар с неба</b></td><td>от 120 000 ГС</td><td>Зерно, лекарства и металл, каких они не куют: отношение и благополучие вверх.</td><td>−5</td></tr>
          <tr><td>🕊 <b>Тихая миссия</b></td><td>от 60 000 ГС</td><td>Без чудес: чинить колодцы, оставлять карты, слушать песни. Дёшево и понемногу.</td><td>−2</td></tr>
          <tr><td>✨ <b>Знамение</b></td><td>от 200 000 ГС</td><td>Отношение прыгает разом, но мир <b>навсегда уходит в спиритуализм</b>.</td><td>−10</td></tr>
          <tr><td>🜂 <b>Возвысить</b></td><td>от 500 000 ГС</td><td><b>Эпоха вперёд</b> немедленно, вы — их патрон навсегда. На пороге превращается в «дать им звёзды»: держава родится сегодня и под вашей рукой.</td><td>−15</td></tr>
          <tr><td>⛏ <b>Выкачивать</b></td><td>—</td><td>ГС по населению; благополучие и население вниз, история <b>стоит на месте</b>. На нуле благополучия мир «выпит досуха».</td><td>−20</td></tr>
          <tr><td>☩ <b>Обратить в веру</b></td><td>от 340 000 ГС</td><td>Нужна своя религия. Каждый обращённый мир даёт <b>+25% к ставке храмов</b> державы (потолок ×2). Может не выйти — слушают тем охотнее, чем проще их мир и чем лучше к вам относятся.</td><td>−25</td></tr>
          <tr><td>⚑ <b>Протекторат</b></td><td>от 300 000 ГС</td><td>Бросок: <b>у них бывает мнение</b>. Провал — деньги на ветер и испорченное отношение.</td><td>−35</td></tr>
          <tr><td>⛓ <b>Увести в рабство</b></td><td>от 260 000 ГС</td><td>Не убить, а вывезти: невольники вливаются в <a class="gb-link" onclick="gbScrollTo('gb-raids')">пул рабочих</a> державы. Планета остаётся жить — но уже без них.</td><td>−45</td></tr>
          <tr><td>💥 <b>Урок будет усвоен</b></td><td>бесплатно, но нужен <b>флот в системе</b></td><td><b>Эпоха назад</b>: флот жжёт всё, что народ успел построить, и прожитую эпоху им придётся жить заново. С E0 откатывать некуда — урок становится истреблением. <b>Тихо не выйдет:</b> об ударе узнаёт вся галактика.</td><td>−50…−75</td></tr>
          <tr><td>☠ <b>Истребить</b></td><td>от 220 000 ГС</td><td>Необратимо: планета освобождается. У народов с «тайным оружием» последний залп бьёт по вашему флоту.</td><td>−60</td></tr>
        </tbody>
      </table></div>

      <h3 class="gb-h3">⌘ Фонд по защите от невмешательства</h3>
      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div>Фонд ведёт на вас <b>досье</b>. Каждое вмешательство роняет его, наблюдение — поднимает. Дошло до <b>−100</b> — Фонд <b>взыскивает четверть казны</b> и откатывает досье к <b>−50</b>, а не к нулю: он помнит. Дозвёздный мир — проект державы на квартал, а не кнопка, которую жмут между делом.</div>
      </div>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">⚖</span>
        <div><b>Запреты уклада.</b> Просвещённым державам (демократический/эгалитарный режим либо идеология Пацифизм/Ксенофилия) закрыты <b>геноцид, рабство, выкачивание, протекторат и «урок»</b> — насилие и эксплуатация. Наблюдение, дары, возвышение и проповедь остаются. Кнопки не прячутся, а <b>гаснут</b> с подписью «закрыто укладом державы».</div>
      </div>
    </section>

    <!-- ИГРОВОЙ ДЕНЬ -->
    <section id="gb-loop" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">↻</span>Игровой день</h2>
      <p>Раз в сутки наступает новый игровой день — он обрабатывается автоматически для всех фракций, без вашего участия. В этот момент происходит сразу всё накопленное:</p>
      <div class="gb-steps">
        <div class="gb-step"><div class="gb-step-n">↑</div><div>Начисляется доход — ГС, очки науки, агенты.</div></div>
        <div class="gb-step"><div class="gb-step-n">⌂</div><div>Завершаются постройки, открытые слоты и обустройство среды.</div></div>
        <div class="gb-step"><div class="gb-step-n">⚔</div><div>Готовые юниты выходят из производства в ваш ростер.</div></div>
        <div class="gb-step"><div class="gb-step-n">◐</div><div>Завершаются шпионские операции и приходят их результаты.</div></div>
      </div>
      <div class="gb-note gb-note-tip">
        <span class="gb-note-i">★</span>
        <div>Заходить каждый день не обязательно: доход и завершение работ идут сами. Заход в Кабинет лишь подтягивает накопленное сразу, не дожидаясь ночного расчёта.</div>
      </div>
    </section>

    <!-- СОВЕТЫ -->
    <section id="gb-tips" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">★</span>Советы новичку</h2>
      <div class="gb-tips">
        <div class="gb-tip"><div class="gb-tip-n">01</div><div><b>Смотрите на бонусы, а не на названия.</b> Красивое имя доктрины ничего не значит — открывайте раздел «Доктрина» и считайте, что реально даёт выбор.</div></div>
        <div class="gb-tip"><div class="gb-tip-n">02</div><div><b>Первые дни — это стройка.</b> Не копите деньги «на потом»: каждое здание и слот начинают приносить доход уже на следующий день.</div></div>
        <div class="gb-tip"><div class="gb-tip-n">03</div><div><b>Торговля — простейший доход.</b> Найдите союзника и заключите торговый путь — хабы заработают сразу для обоих.</div></div>
        <div class="gb-tip"><div class="gb-tip-n">04</div><div><b>Заселяйте планеты без простоя.</b> Как только перезарядка колонизации прошла — берите следующий мир. Больше планет = больше ячеек.</div></div>
        <div class="gb-tip"><div class="gb-tip-n">05</div><div><b>Не оголяйте разведку.</b> Держите пару агентов в резерве — иначе соседи безнаказанно вас обчистят.</div></div>
        <div class="gb-tip"><div class="gb-tip-n">06</div><div><b>Доход капает сам.</b> Начисления идут автоматически каждый день, даже если вы не в игре — за пропущенные дни всё придёт сразу. Заходить стоит не ради дохода, а чтобы пускать накопленные ресурсы в дело.</div></div>
      </div>
    </section>

    <footer class="gb-footer">
      <div class="gb-footer-line"></div>
      <p>Классическая Эра · Beta 0.5 · Руководство игрока</p>
    </footer>

  </main>
</div>`;

  if (typeof setPg === 'function') setPg(html);
  if (typeof setAct === 'function') setAct('guide');

  gbMarkLeads();
  gbMakeCollapsible();
  gbApplyCovers();

  requestAnimationFrame(() => {
    const links = document.querySelectorAll('.gb-toc-link');
    if (!links.length) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        links.forEach(l => l.classList.remove('active'));
        // Списков содержания два (боковой и мобильная раскрывашка) — подсвечиваем оба.
        document.querySelectorAll(`.gb-toc-link[onclick*="${e.target.id}"]`)
          .forEach(l => l.classList.add('active'));
      });
    }, { rootMargin: '-15% 0px -75% 0px' });
    document.querySelectorAll('.gb-section').forEach(s => obs.observe(s));
  });
}

// ── Обложки разделов ──────────────────────────────────────────────────
// Для каждого раздела гайда (id="gb-…") пробуем подгрузить картинку-обложку
// assets/guide/<id>.jpg (грузится в админке, вкладка «Обложки»). Если файл
// есть — вставляем её фоном со сложной слой-маской прозрачности (см.
// .gb-cover в css/19_guide.css). Нет файла — раздел остаётся как был.
function gbApplyCovers() {
  document.querySelectorAll('.gb-main .gb-section[id^="gb-"]').forEach(sec => {
    if (sec.querySelector(':scope > .gb-cover')) return;
    const url = `assets/guide/${sec.id}.jpg`;
    const img = new Image();
    img.onload = () => {
      if (sec.querySelector(':scope > .gb-cover')) return;
      const cv = document.createElement('div');
      cv.className = 'gb-cover';
      cv.style.backgroundImage = `url('${url}')`;
      sec.insertBefore(cv, sec.firstChild);
      sec.classList.add('has-cover');
    };
    img.src = url;
  });
}

function gbScrollTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ══════════════════════════════════════════════════════════════════════
// ПРАВИЛА ПРОЕКТА — отдельные страницы (раскрывающаяся группа в меню).
// Переиспользуют стили гайдбука (.gb-*). Маршруты rules-* — в data.js (go),
// раскрытие/подсветка группы — в render.js (buildNav + setAct).
// ══════════════════════════════════════════════════════════════════════
const RULES_PAGES = [
  {
    slug: 'rules-general', icon: '◈', label: 'Общие правила',
    eyebrow: 'РАЗДЕЛ 1 · КОНЦЕПЦИЯ ПРОЕКТА',
    title: 'Общие правила и концепция',
    sub: 'Философия вселенной, золотое правило, статус Администрации и фундаментальные запреты.',
    body: `
      <p>«Классическая Эра» — независимый авторский текстовый ролевой проект (РВПИ) с собственным таймлайном, лором и правилами. Проект не опирается на сторонние каноны (Star Wars, Warhammer, Mass Effect и др.) и является некоммерческим. Наша цель — вернуть атмосферу «старого формата» ролевой игры: лёгкой, творческой и эмоциональной.</p>
      <div class="gb-note gb-note-info"><span class="gb-note-i">i</span><div>Подача и одобрение анкеты фракции означает ваше <b>полное и безоговорочное согласие</b> со всеми правилами проекта. Незнание правил, лора или механик не освобождает от ответственности.</div></div>

      <h3 class="gb-h3">1.2 · История превыше победы</h3>
      <p>Главная ценность — качественный сюжет. Мы поощряем подход <b>Play-to-Story</b> (игра ради истории), а не Play-to-Win. Потеря колонии или поражение в бою — не повод для внеигровых обид, а катализатор нового витка ролевой игры. Умение красиво проигрывать и создавать драму ценится выше сухих статистических побед.</p>

      <h3 class="gb-h3">1.4 · Статус и роль Администрации</h3>
      <ul class="gb-ul">
        <li>Администрация — гарант работоспособности вселенной, арбитр в спорах и координатор глобального сюжета.</li>
        <li>Администрация <b>не имеет права</b> использовать системные полномочия в пользу какой-либо из сторон конфликта.</li>
        <li>Кураторы и администраторы могут играть на общих основаниях; их государства <b>не имеют скрытых преимуществ</b> (IC) и подчиняются общим правилам.</li>
      </ul>

      <h3 class="gb-h3">1.5 · Канон и целостность лора</h3>
      <ul class="gb-ul">
        <li><b>Глобальный канон:</b> события из официальной летописи и сюжетных квестов — неоспоримый факт.</li>
        <li><b>Локальный лор:</b> вы свободны прописывать историю своей фракции, <b>если</b> это не противоречит глобальному канону и физике вселенной.</li>
        <li>Масштабные события (уничтожение звёздной системы, сверх-оружие) согласуются с Администрацией заранее.</li>
      </ul>

      <h3 class="gb-h3">1.6 · Фундаментальные игровые запреты</h3>
      <div class="gb-note gb-note-warn"><span class="gb-note-i">!</span><div>Проект строится на честном отыгрыше и погружении. Перечисленное ниже <b>строго запрещено</b>.</div></div>
      <ul class="gb-ul">
        <li><b>Смешивание IC и OOC:</b> переносить личные обиды в игру и наоборот. То, что происходит в космосе — остаётся в космосе.</li>
        <li><b>Метагейминг:</b> использовать в игре информацию, добытую неигровым путём (утечки в дискорде, скрытые параметры флота). Правитель знает лишь то, что добыто RP-шпионажем.</li>
        <li><b>Годмод / Пауэргейминг:</b> отыгрывать неуязвимость и действовать за чужих персонажей и флоты без согласия владельца.</li>
        <li><b>Прямой плагиат:</b> копировать государства, персонажей и гербы «под кальку» из известных франшиз. Вдохновляться можно — копировать нельзя.</li>
      </ul>

      <h3 class="gb-h3">1.7 · Базовая терминология</h3>
      <ul class="gb-ul">
        <li><b>IC (In Character):</b> внутриигровая информация и действия от лица персонажей и фракции.</li>
        <li><b>OOC (Out Of Character):</b> внеигровое общение игроков как реальных людей.</li>
        <li><b>РВПИ:</b> ролевая военно-политическая игра — управление не одним героем, а целыми государствами и корпорациями.</li>
        <li><b>Ход:</b> базовый отрезок игрового времени с лимитом действий (стройка, перемещение флота, исследования).</li>
      </ul>`
  },
  {
    slug: 'rules-charter', icon: '⚖', label: 'Устав проекта',
    eyebrow: 'РАЗДЕЛ 2 · ПОЛЬЗОВАТЕЛЬСКОЕ СОГЛАШЕНИЕ',
    title: 'Устав проекта',
    sub: 'Технические, имущественные и административные отношения между игроком и проектом.',
    body: `
      <p>Устав регулирует технические, имущественные и административные отношения между игроком и проектом. Факт подачи анкеты означает безоговорочное согласие со всеми его положениями — это аналог договора оферты.</p>

      <h3 class="gb-h3">Глава I · Общие положения</h3>
      <ul class="gb-ul">
        <li><b>1.1 Презумпция согласия.</b> Подача анкеты = полное согласие с Уставом.</li>
        <li><b>1.2 Право на изменения.</b> Администрация может менять Устав в любой момент ради баланса; о крупных изменениях — оповещение в новостном канале. Продолжение игры = согласие с новыми условиями.</li>
        <li><b>1.3 Принцип финального слова.</b> В нестандартных и конфликтных ситуациях решение Администрации принимается по логике вселенной и здравому смыслу, становится прецедентом и обжалованию не подлежит.</li>
        <li><b>1.4 Форс-мажоры.</b> Администрация не отвечает за временную недоступность сайта и ботов. При глобальных сбоях вправе объявить заморозку хода или откат до стабильной точки.</li>
      </ul>

      <h3 class="gb-h3">Глава II · Права на контент и статус фракций</h3>
      <ul class="gb-ul">
        <li><b>2.1 Имущество проекта.</b> Фракции, планеты, флоты, технологии, ГС и ОН — <b>не ваша личная собственность</b>, а элементы общего мира во временном управлении.</li>
        <li><b>2.2 Неотчуждаемость лора.</b> Опубликованные посты, чертежи и события становятся частью канона. При уходе или блокировке игрок не вправе требовать их удаления.</li>
        <li><b>2.3 Закон об активности (AFK).</b> Пропажа лидера без уведомления более <b>14 дней</b> → Администрация вправе заморозить фракцию, перевести в статус «Павшего государства» (NPC) или передать другому игроку.</li>
        <li><b>2.4 Добровольная передача власти.</b> Уходя, уведомите Администрацию. Государство не исчезает мгновенно — кураторы выводят его сюжетно (распад, гражданская война, поглощение).</li>
      </ul>

      <h3 class="gb-h3">Глава III · Честная игра и уязвимости</h3>
      <div class="gb-note gb-note-warn"><span class="gb-note-i">!</span><div>Обнаружили баг, ошибку в расчётах или лазейку в правилах — <b>обязаны немедленно сообщить команде</b>. Скрытое использование ведёт к откату прогресса фракции или изгнанию.</div></div>
      <ul class="gb-ul">
        <li><b>3.1 Запрет мультиаккаунтов.</b> Один человек = одна фракция. Фейки для марионеток, перелива ресурсов и голосований → бан всей сетки аккаунтов.</li>
        <li><b>3.2 Багоюз и эксплойты.</b> Умышленное использование уязвимостей запрещено (см. предупреждение выше).</li>
        <li><b>3.3 Махинации и «перелив».</b> Системные махинации с экономикой без ролевого обоснования (напр. «слив казны» союзнику перед уходом) аннулируются.</li>
        <li><b>3.4 Ответственность за аккаунт.</b> Вы отвечаете за сохранность доступов. Передача аккаунта третьим лицам запрещена; всё сделанное с него считается сделанным вами.</li>
      </ul>

      <h3 class="gb-h3">Глава IV · Вердикты и решения</h3>
      <ul class="gb-ul">
        <li><b>4.1 Авторитет Гейм-мастера.</b> Вердикты ГМ по итогам боёв окончательны в рамках хода и обязательны к исполнению.</li>
        <li><b>4.2 Процедура апелляции.</b> Несогласны — подайте <b>одну</b> аргументированную апелляцию (с расчётами и ссылками на правила) старшему администратору в ЛС.</li>
        <li><b>4.3 Запрет саботажа.</b> Публичные споры и токсичные обсуждения вердиктов в общих чатах запрещены.</li>
        <li><b>4.4 Сроки давности.</b> Апелляции принимаются не позднее <b>72 часов (3 дней)</b> после вердикта; далее результат — устоявшийся канон.</li>
      </ul>`
  },
  {
    slug: 'rules-rp', icon: '⚔', label: 'Регламент RP и боёв',
    eyebrow: 'РАЗДЕЛ 3 · РОЛЕВОЙ ПРОЦЕСС',
    title: 'Правила RP-процессов и боёв',
    sub: 'Написание постов, диалоги, новости и правила космических и наземных сражений.',
    body: `
      <p>Раздел регламентирует написание игровых постов, ведение дипломатии, публикацию новостей, а также правила наземных и космических боёв.</p>

      <h3 class="gb-h3">Глава I · Стандарты отыгрыша</h3>
      <div class="gb-note gb-note-info"><span class="gb-note-i">i</span><div><b>Объём поста:</b> не менее <b>10 строк</b> (≈100–150 слов с ПК). <b>Лимит ответа:</b> <b>72 часа</b>. Однострочные ответы запрещены; пропуск без предупреждения → ГМ вправе засчитать техническое поражение.</div></div>
      <ul class="gb-ul">
        <li><b>Диалоги — по очереди.</b> Нельзя в одном посте задать вопрос, описать реакцию оппонента и ответить за него.</li>
        <li><b>Чтение мыслей запрещено.</b> Описывайте эмоции своего героя, но оппонент вправе трактовать их по-своему или не заметить.</li>
        <li><b>Новости:</b> не более <b>3 сводок за ход</b> (реальную неделю). Каждая — с заголовком, игровой датой и источником. Хороший отыгрыш политики повышает соц. капитал и шанс ивентов.</li>
      </ul>

      <h3 class="gb-h3">Глава II · Космические столкновения</h3>
      <p style="font-style:italic;color:var(--color-text-faint)">«Войны выигрываются качеством войск, а не количеством.» — Генерал Коалиции</p>
      <ul class="gb-ul">
        <li><b>Инициатива.</b> Число кораблей не ограничено. Первым пишет <b>атакующий</b>, задавая вектор, затем <b>обороняющийся</b>; итоги фазы описывает Гейм-мастер.</li>
        <li><b>Тактическая карта.</b> Квадранты по <b>250 км</b>; в одном квадранте — только один флот от каждой стороны.</li>
        <li><b>Гравитация и гипер.</b> Вблизи планет координаты выхода из гиперпространства могут сместиться. В астероидных полях манёвры и огонь критически затруднены.</li>
        <li><b>Интердикторы.</b> Гравитационные колодцы вытягивают флот из гипера и блокируют отступление; точность падает с размером корабля-интердиктора.</li>
        <li><b>Резервы и отступление.</b> Подкрепления — каждые <b>5 ходов</b>; команда на отступление доступна спустя <b>1 ход</b>; выход из колодца — до <b>3 ходов</b> под огнём.</li>
      </ul>
      <p><b>Завершение боя:</b> полное уничтожение стороны · успешное отступление за пределы системы · капитуляция · закулисное перемирие между игроками.</p>

      <h3 class="gb-h3">Глава III · Наземные операции</h3>
      <ul class="gb-ul">
        <li><b>Развёртывание.</b> Высадка с плацдарма или орбитальным десантом. Гексокарты нет — ГМ моделирует бой текстом по вводным, приказам и рельефу.</li>
        <li><b>Перехват десанта.</b> Высадку могут уничтожить в первый же ход, если объект — планета-крепость или плотно прикрыт ПВО, ПРО и ПКО.</li>
        <li><b>Доктрина 3000 года.</b> Окопные войны в прошлом: мобильные группы, авиация и дроны эффективнее тяжёлой пехоты, но танковые кулаки и артиллерия важны для прорыва укреплений.</li>
        <li><b>Окружение и прорыв.</b> Штатное отступление — спустя <b>1 ход</b>; из «котла» — только через заявку на успешный прорыв (рассчитывает ГМ), возможны тяжёлые потери.</li>
      </ul>
      <p><b>Финал операции:</b> уничтожение группировки · отступление или прорыв к эвакуации · капитуляция гарнизона · мирный договор.</p>`
  },
  {
    slug: 'rules-conduct', icon: '⚠', label: 'Дисциплина и общение',
    eyebrow: 'РАЗДЕЛ 4 · ДИСЦИПЛИНАРНЫЙ РЕГЛАМЕНТ',
    title: 'Дисциплинарный регламент',
    sub: 'Внеигровое общение (OOC), границы контента и система взысканий.',
    body: `
      <p>Раздел регулирует внеигровое общение (OOC), поведение в общих чатах и границы допустимого контента. Цель — комфортная, творческая и безопасная атмосфера для всех участников.</p>

      <h3 class="gb-h3">4.1 · Реальность и вымысел</h3>
      <div class="gb-note gb-note-warn"><span class="gb-note-i">!</span><div><b>Абсолютное табу</b> на обсуждение реальной политики, мировых конфликтов, религий и межнациональных отношений. Споры и вбросы из реального мира → немедленный мут или бан.</div></div>

      <h3 class="gb-h3">4.2 · Радикальные идеологии и «исторический косплей»</h3>
      <p>Проект — не площадка для маргинальных и экстремистских фантазий.</p>
      <ul class="gb-ul">
        <li><b>Никаких «космических нацистов».</b> Запрещены символика (свастики, руны и их прямые аналоги), лозунги, звания и эстетика Третьего Рейха, фашистской Италии и любых признанных экстремистскими группировок.</li>
        <li>Запрещено прописывать в лор фракции геноцид по реальным расовым, национальным или религиозным признакам.</li>
        <li>Маскировка запрещённой символики под «оригинальный лор» → удаление фракции и перманентная блокировка.</li>
      </ul>

      <h3 class="gb-h3">4.3 · Пародии на современность</h3>
      <p>Никаких «Космической Российской Федерации», «Звёздных США» или правителей с именами реальных современных президентов. Создавайте уникальные государства, чтобы не провоцировать политические конфликты на ровном месте.</p>

      <h3 class="gb-h3">4.4 · Токсичность и травля</h3>
      <p>Запрещены прямые и завуалированные оскорбления, переход на личности, угрозы расправой в реальной жизни (Doxxing) и травля. Разжигание ненависти и пассивная агрессия во внеигровых чатах пресекаются Администрацией.</p>

      <h3 class="gb-h3">4.5 · Запрещённый (шок) контент</h3>
      <p>В любых чатах и в оформлении фракций (гербы, арты, флаги) запрещены:</p>
      <ul class="gb-ul">
        <li>Порнография (18+) и излишне откровенная эротика.</li>
        <li>Сцены реальной жестокости, расчленёнки и шок-контент (Gore).</li>
        <li>Пропаганда наркотиков, суицида и призывы к нарушению законов.</li>
      </ul>

      <h3 class="gb-h3">4.6 · Спам, флуд и реклама</h3>
      <p>Запрещён флуд там, где это не предусмотрено логикой канала, и реклама сторонних ролевых проектов, discord-серверов или коммерческих услуг без согласования с Администрацией.</p>

      <h3 class="gb-h3">4.7 · Система взысканий</h3>
      <ul class="gb-ul">
        <li><b>Устное предупреждение</b> — за мелкие нарушения, случайный флуд, оффтоп.</li>
        <li><b>Мут</b> (от 1 часа до 1 недели) — за оскорбления, политоту, провокации.</li>
        <li><b>Игровой штраф</b> — снятие ОН/ГС или блокировка игровых действий за саботаж.</li>
        <li><b>Бан</b> (временный или перманентный) — за систематические нарушения, плагиат, экстремизм, рекламу, грубые оскорбления.</li>
      </ul>
      <div class="gb-note gb-note-info"><span class="gb-note-i">i</span><div>При грубом нарушении пунктов 4.1 и 4.2 наказание может применяться <b>без предварительных предупреждений</b>.</div></div>`
  },
  {
    slug: 'rules-naming', icon: '✎', label: 'Регистрация и нейминг',
    eyebrow: 'РАЗДЕЛ 5 · РЕГИСТРАЦИЯ И НЕЙМИНГ',
    title: 'Регистрация и ролевой нейминг',
    sub: 'Профили на сайте и рамки для названий государств, планет и персонажей.',
    body: `
      <p>Раздел задаёт правила создания профилей и строгие рамки для названий ваших государств, планет и персонажей — чтобы сохранить серьёзную и атмосферную научно-фантастическую стилистику проекта.</p>

      <h3 class="gb-h3">5.1 · Профиль на сайте и в Wiki</h3>
      <ul class="gb-ul">
        <li><b>Никнеймы:</b> читаемые и адекватные. Запрещены мат (в т.ч. завуалированный заменой букв), оскорбления, политические, религиозные и экстремистские лозунги.</li>
        <li><b>Аватары:</b> без порнографии (18+), шок-контента, реальной политической символики и изображений, оскорбляющих участников.</li>
      </ul>

      <h3 class="gb-h3">5.2 · Названия фракций, корпораций, альянсов</h3>
      <ul class="gb-ul">
        <li><b>Без мата.</b> Запрещены матерные, бранные и пошлые слова в названиях государств, планет, систем и вооружения.</li>
        <li><b>Без троллинга и абсурда.</b> Названия вроде «Империя Пива», «Святой Орден Табуретки» или «Zalupa» ломают погружение и не пройдут проверку.</li>
        <li><b>Без реальности и копипаста.</b> Нельзя использовать названия реальных государств (США, РФ, КНР), радикальных группировок и точные копии франшиз (Галактическая Империя, Империум Человечества, Альянс Систем).</li>
      </ul>

      <h3 class="gb-h3">5.3 · Имена персонажей и лидеров</h3>
      <ul class="gb-ul">
        <li>Избегайте откровенно абсурдных, мемных или нелепых имён (например, «Вася Пупкин во главе звёздного дредноута»).</li>
        <li>Запрещены имена реальных современных политиков, диктаторов и религиозных деятелей.</li>
        <li>Запрещены 100% узнаваемые герои массовой культуры (Джон Сноу, Люк Скайуокер, Илон Маск).</li>
      </ul>

      <h3 class="gb-h3">5.4 · Цензура и принудительное переименование</h3>
      <p>Кураторы проверяют каждую анкету. Недопустимое название → анкета отклоняется с требованием правок. Если нарушение всплыло уже в процессе игры, Администрация вправе <b>принудительно переименовать</b> объект или аннулировать его создание. Систематическое создание абсурдных или оскорбительных названий назло кураторам расценивается как саботаж и ведёт к блокировке.</p>`
  },
];

function renderRules(slug) {
  const page = RULES_PAGES.find(p => p.slug === slug) || RULES_PAGES[0];
  const toc = RULES_PAGES.map(p =>
    `<a class="gb-toc-link${p.slug === page.slug ? ' active' : ''}" href="javascript:void(0)" onclick="go('${p.slug}')">
       <span class="gb-toc-icon">${p.icon}</span><span>${p.label}</span>
     </a>`).join('');

  const html = `
<div class="gb-wrap">
  <aside class="gb-toc">
    <div class="gb-toc-title">ПРАВИЛА ПРОЕКТА</div>
    <nav class="gb-toc-list">${toc}</nav>
    <a class="gb-toc-link" href="javascript:void(0)" onclick="go('guide')" style="margin-top:12px;opacity:.7">
      <span class="gb-toc-icon">📖</span><span>← Игровой гайдбук</span>
    </a>
  </aside>

  <main class="gb-main">
    <header class="gb-hero">
      <div class="gb-hero-eyebrow">${page.eyebrow}</div>
      <h1 class="gb-hero-title">${page.title}</h1>
      <p class="gb-hero-sub">${page.sub}</p>
    </header>

    <section class="gb-section">
      ${page.body}
    </section>

    <footer class="gb-footer">
      <div class="gb-footer-line"></div>
      <p>Классическая Эра · Beta 0.5 · Правила проекта</p>
    </footer>
  </main>
</div>`;

  if (typeof setPg === 'function') setPg(html);
  if (typeof setAct === 'function') setAct(slug);
  window.scrollTo(0, 0);
}
