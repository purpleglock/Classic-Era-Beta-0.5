// ── GUIDEBOOK — Гайдбук «Классическая Эра» ─────────────────────────────────

const GB_SECTIONS = [
  { id: 'gb-intro',     icon: '◈', label: 'С чего начать' },
  { id: 'gb-rules',     icon: '⚖', label: 'Правила проекта' },
  { id: 'gb-reg',       icon: '◷', label: 'Регистрация' },
  { id: 'gb-wizard',    icon: '⬡', label: 'Создание фракции' },
  { id: 'gb-doctrine',  icon: '⚑', label: 'Доктрина: все бонусы' },
  { id: 'gb-economy',   icon: '◇', label: 'Экономика и доход' },
  { id: 'gb-colonies',  icon: '◉', label: 'Колонии и планеты' },
  { id: 'gb-capitals',  icon: '🪐', label: 'Планеты-столицы' },
  { id: 'gb-resources', icon: '◆', label: 'Ресурсы и добыча' },
  { id: 'gb-buildings', icon: '⌂', label: 'Здания' },
  { id: 'gb-research',  icon: '✦', label: 'Технологии' },
  { id: 'gb-army',      icon: '⚔', label: 'Армия и флот' },
  { id: 'gb-constructors', icon: '⚒', label: 'Конструкторы' },
  { id: 'gb-intel',     icon: '◐', label: 'Разведка и агенты' },
  { id: 'gb-trade',     icon: '⇄', label: 'Торговля и караваны' },
  { id: 'gb-raids',     icon: '🏴', label: 'Рейды (каперство)' },
  { id: 'gb-diplo',     icon: '🤝', label: 'Дипломатия и союзы' },
  { id: 'gb-map',       icon: '⬢', label: 'Карта галактики' },
  { id: 'gb-loop',      icon: '↻', label: 'Игровой день' },
  { id: 'gb-tips',      icon: '★', label: 'Советы новичку' },
];

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

// Таблица богатства месторождения (зеркало EC_RICHNESS из economy.js): множитель к добыче.
const GB_RICHNESS = [
  ['Следы',        0.6], ['Мало',       1.0], ['Умеренно',   1.5],
  ['Много',        2.0], ['Очень много', 2.5], ['Колоссально', 3.0],
];
function gbRichTable() {
  const rows = GB_RICHNESS.map(([n, m]) =>
    `<tr><td>${n}</td><td><b>×${m.toFixed(1)}</b></td></tr>`).join('');
  return `<div class="gb-table-wrap"><table class="gb-table">
    <thead><tr><th>Богатство залежи (с карты)</th><th>Множитель добычи</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// Полная таблица ресурсов: иконка, редкость, персональная цена, добыча/слот и
// ГС/слот/сутки (цена × добыча). Данные — из каталога GalaxyGen (один источник).
const GB_RES_RATE = { common: 25, uncommon: 12, rare: 6, epic: 3, legendary: 1 };
const GB_RAR_N = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };
function gbResTable() {
  const cat = (window.GalaxyGen && GalaxyGen.RESOURCES) || [];
  if (!cat.length) return '<p class="gb-muted">Каталог ресурсов недоступен.</p>';
  const ic = (R) => (GalaxyGen.resIconHtml ? GalaxyGen.resIconHtml(R.name, 'gb-res-ic') : (R.icon || ''));
  const rows = cat.slice().sort((a, b) => (a.price - b.price) || a.name.localeCompare(b.name)).map(R => {
    const rate = GB_RES_RATE[R.r] || 25;
    return `<tr>
      <td><span class="gb-res-cell">${ic(R)} ${R.name}</span></td>
      <td><span class="gb-rar gb-rar-${GB_RAR_N[R.r] || 1}">${R.rname}</span></td>
      <td>${R.price} ГС</td>
      <td>${rate}</td>
      <td><b>${R.price * rate}</b></td>
    </tr>`;
  }).join('');
  return `<div class="gb-table-wrap"><table class="gb-table gb-res-table">
    <thead><tr><th>Ресурс</th><th>Редкость</th><th>Цена/ед</th><th>Добыча/сут</th><th>ГС за слот/сут</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
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

function renderGuidebook() {
  const toc = GB_SECTIONS.map(s =>
    `<a class="gb-toc-link" href="javascript:void(0)" onclick="gbScrollTo('${s.id}')">
       <span class="gb-toc-icon">${s.icon}</span><span>${s.label}</span>
     </a>`
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
      <p class="gb-hero-sub">Военно политическая игра в жанре научной фантастики, где вы - правитель звездного государства. В данном гайдбуке собрана вся (почти) информация, которая призвана объяснить всё, начиная от создания фракции до первых колоний, армий и шпионажа.</p>
    </header>

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
    </section>

    

    <!-- РЕГИСТРАЦИЯ -->
    <section id="gb-reg" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">◷</span>Регистрация и заявка</h2>
      <p>Нажмите <strong>«Войти»</strong> в боковом меню и создайте аккаунт. После входа в навигации появится раздел <strong>«Фракции»</strong> - оттуда подаётся заявка на создание державы. Либо перейдите к форме заполнения из раздела фракций и главной страницы.</p>

      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div>Один аккаунт - одна фракция. Новую заявку можно подать, только если предыдущую отклонили.</div>
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
        <div class="gb-wstep"><b>Форма правления и политический режим.</b> Две независимые оси доктрины - их бонусы складываются.</div>
        <div class="gb-wstep"><b>Идеология.</b> Задаёт стратегический вектор и часто даёт стартовую технологию.</div>
        <div class="gb-wstep"><b>Раса.</b> Влияет на доход и определяет, какие планеты для вас «родные» (заселяются сразу, без терраформирования).</div>
        <div class="gb-wstep"><b>Столичная система и планета.</b> Выберите свободную звезду на мини-карте - она станет столицей (отметка ★ на карте галактики).</div>
        <div class="gb-wstep"><b>Стартовые постройки.</b> 20 очков на выбор начальных зданий (см. таблицу ниже).</div>
        <div class="gb-wstep"><b>Описание, история, и герб.</b> Лор фракции: лидер, культура, история, геральдика. Необязательно, но желательно.</div>
      </div>

      <h3 class="gb-h3">Стартовые постройки - 20 очков</h3>
      <div class="gb-tbl">
        <div class="gb-tr gb-th"><span>Здание</span><span>Очки</span><span>Что даёт</span></div>
        <div class="gb-tr"><span>Гражданская фабрика</span><span>5</span><span>Доход в ГС (бесплатно для Colony)</span></div>
        <div class="gb-tr"><span>Добывающий завод</span><span>5</span><span>Добыча планетарных ресурсов</span></div>
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
      <p>«Доктрина» - это сумма бонусов от вашего типа цивилизации, формы правления, режима, идеологии и расы. <strong>Бонусы складываются.</strong> Например, +20% к доходу от правления и +20% от расы дадут вместе +40%.</p>

      <div class="gb-legend">
        <span class="gb-chip gb-chip-good">ЗЕЛЕНЫЙ - выгодно вам</span>
        <span class="gb-chip gb-chip-bad">КРАСНЫФЙ - штраф / дороже</span>
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
      <p>Весь доход начисляется <strong>автоматически</strong> раз в игровой день — планировщик обсчитывает все фракции сам, заходить для этого не нужно. Если вы не были в игре несколько дней, при следующем входе доход придёт сразу за все пропущенные дни — ничего не теряется. Открытие <strong>«Кабинета игрока»</strong> просто подтягивает накопленное мгновенно, не дожидаясь ночного расчёта.</p>

      <h3 class="gb-h3">Откуда берётся доход</h3>
      <ul class="gb-ul">
        <li><b>ГС за цикл</b> — складывается из: <b>Гражданских фабрик</b> и <b>Торговых хабов</b> (постройки), <b>караванов</b> (продажа добычи), <b>товарной биржи</b>, <b>экспорта</b> (авто-продажа). Минус — апкип <b>торговой политики</b> и <b>дань</b> сюзерену (если вы вассал). Всё × бонус доктрины к доходу.</li>
        <li><b>Очки науки</b> — от Научных институтов + бонусы доктрины.</li>
        <li><b>Агенты</b> — <b>нанимаются</b> на рынке рекрутов (см. «Разведка»); Центр Спецслужб задаёт их потолок.</li>
      </ul>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>В «Обзоре» панель <b>«Статистика за ходы»</b> показывает разбивку — сколько чего пришло в казну за каждый цикл (постройки/караваны/биржа/экспорт/−политика).</div>
      </div>

      <p>Подробно про добычу, цены ресурсов, режимы склад/экспорт и каналы сбыта — в разделе <a class="gb-link" onclick="gbScrollTo('gb-resources')">«Ресурсы и добыча»</a> и <a class="gb-link" onclick="gbScrollTo('gb-trade')">«Торговля»</a>.</p>
    </section>

    <!-- КОЛОНИИ -->
    <section id="gb-colonies" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">◉</span>Колонии и планеты</h2>
      <p>В <strong>«Кабинете игрока» → «Колонии»</strong> выберите систему своей территории, затем планету, и нажмите «Колонизировать».</p>

      <ul class="gb-ul">
        <li><b>Родные планеты</b> вашей расы заселяются сразу за <b>400 ГС</b> (с учётом бонусов доктрины).</li>
        <li><b>Чужие планеты</b> требуют сначала терраформирования.</li>
        <li>После колонизации действует <b>перезарядка 7 дней</b> — пока она идёт, новую планету заселить нельзя. Доктрина может её сократить.</li>
      </ul>

      <h3 class="gb-h3">Типы планет</h3>
      <p>Каждая планета относится к климатической группе. Для одних рас она «родная» (заселяется сразу), для других — чужая (нужен терраформ). Какие миры родные — определяет ваша раса (см. <a class="gb-link" onclick="gbScrollTo('gb-wizard')">«Создание фракции»</a> и сводку в Кабинете).</p>
      <div class="gb-table-wrap"><table class="gb-table">
        <thead><tr><th>Группа планет</th><th>Колонизация</th></tr></thead>
        <tbody>
          <tr><td>Землеподобные, Океанические</td><td>Обычно лёгкие/родные</td></tr>
          <tr><td>Пустынные, Вулканические</td><td>Средняя сложность терраформа</td></tr>
          <tr><td>Криомиры, Малые тела, Лавовые, Экзотические</td><td>Сложно/экстремально, если не родные</td></tr>
          <tr><td>Газовые / ледяные / горячие гиганты, аномалии, пояса астероидов</td><td>Колонию нельзя, но можно <b>станцию</b> — с нужной технологией Небожителей (астероидные/гигантов/аномалий)</td></tr>
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
        <div class="gb-tr"><span>Экстремальное</span><span>4 дня</span><span>3 200 ГС + 200 ОН</span></div>
      </div>

      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Газовые гиганты, аномалии и пояса астероидов колонизировать нельзя ни при каких условиях.</div>
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
      <p>Часть планет содержит месторождения. Их добывают <strong>Добывающие заводы</strong>, ресурсы копятся на складе фракции, а затем превращаются в ГС.</p>

      <h3 class="gb-h3">Как добывать</h3>
      <ul class="gb-ul">
        <li>Постройте <b>Добывающий завод</b> на колонии, у планеты которой есть ресурсы.</li>
        <li>Откройте слоты и <b>назначьте месторождения</b>. Можно посадить <b>несколько слотов на один ресурс</b> — добыча суммируется.</li>
        <li>Скорость добычи = <b>редкость × богатство месторождения × доктрина</b>. Богатство берётся с карты (от «следов» до «колоссально») — богатые залежи дают кратно больше.</li>
        <li><b>Режим завода</b> (тумблер на карточке): <b>📦 Склад</b> — ресурс копится в пул; <b>💱 Экспорт</b> — добыча идёт в караваны (см. «Торговля»), остаток авто-продаётся.</li>
        <li>Завод <b>не даёт ГС напрямую</b> — ценность даёт состав планеты и выбранный канал сбыта.</li>
      </ul>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Склад имеет <b>лимит ёмкости</b> (базово 1000 + по 500 за слот <b>Склада</b>). Сверх лимита ресурс на склад не кладётся — лишнее лучше пускать в экспорт.</div>
      </div>

      <div class="gb-note gb-note-info">
        <span class="gb-note-i">∑</span>
        <div><b>Формула добычи за слот/сутки:</b> базовая скорость по редкости <b>× множитель богатства залежи × бонус доктрины к добыче</b>. Минимум — 1/сут. Тот же расчёт сервер применяет при ночном начислении.</div>
      </div>

      <h3 class="gb-h3">Богатство месторождения</h3>
      <p>У каждой залежи на карте есть <b>богатство</b> — от «следов» до «колоссально». Оно множит базовую скорость добычи: бедная жила почти ничего не даёт, а колоссальная — втрое больше базы.</p>
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

      <h3 class="gb-h3">Как превратить ресурсы в ГС</h3>
      <p>Коротко: <b>💱 Экспорт</b> → караваны (полная цена + дипломатия, остаток авто-продажа 60%); <b>📈 Товарная биржа</b> → продаёт складское (50–75%); <b>бартер</b> → отдать/продать вручную. Подробно — в разделе <a class="gb-link" onclick="gbScrollTo('gb-trade')">«Торговля»</a>.</p>
      <div class="gb-note gb-note-tip">
        <span class="gb-note-i">★</span>
        <div>Дорогие ресурсы (эпические/легендарные) выгоднее возить караванами по полной цене, а дешёвый «вал» — сбрасывать на бирже автоматически.</div>
      </div>
    </section>

    <!-- ЗДАНИЯ -->
    <section id="gb-buildings" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⌂</span>Здания</h2>
      <p>Здания — фундамент державы. Каждое занимает одну ячейку на планете и имеет до <b>6 слотов</b> мощности. Постройка здания и открытие каждого нового слота занимают <b>1 день</b>; недостроенное можно отменить с возвратом денег.</p>

      <p><b>Просперити системы.</b> Доход ГС-зданий — это слоты × множитель <b>просперити</b> системы, который держится в мягкой полосе <b>×0.85…×1.30</b> (обвалов нет). Главный рычаг прост: <b>плотность застройки</b>. Население даёт рабочие руки; чем больше построек на одно население, тем меньше свободных рук — просперити плавно снижается. Поэтому <b>столичная система стартует богатой</b> (много населения, мало застройки) и всегда спокойна, а при плотной застройке доход мягко проседает. Шкалы сырья и товаров — справочные: реальный доход они почти не двигают (товарная премия фабрик — лёгкие ±15%). При затяжной нехватке рабочих рук система медленно копит напряжение: <b>волнения</b> → <b>стагнация</b> (доход слегка обрезан, мягкий потолок ×0.90) — и так же постепенно снимается восстановлением. Военные постройки (верфь, военный завод) ГС не дают, но грузят рабочие руки. Соседи той же державы по гиперпути немного делятся излишком (<b>спилловер</b>), а на сектор влияют события — <b>война, пираты, бум</b>. Баланс виден в обзоре «Держава → по системам» и во вкладке «Территория»: разрядите застройку или подвезите снабжение караванами.</p>

      <p><b>Бедность: последствия и меры.</b> Бедность теперь <b>мягкая</b>: затяжная нехватка рабочих рук слегка режет доход и <b>понемногу</b> гонит население (доля заселённости падает медленно, не ниже <b>85%</b>), и лишь в крайнем случае выливается в редкие <b>беспорядки</b> с малым разовым ущербом казне. <b>Столица иммунна</b> — она не беднеет, не теряет население и не бунтует. В кабинете это сведено в индекс <b>«Бедность»</b> (обзор) и секцию <b>«Бедность и благополучие»</b> во вкладке «Территория» — карточки систем с причинами и подсказками-рычагами. Коренное лечение — <b>разрядить застройку</b> или подвезти снабжение, но казной можно <b>экстренно поддержать</b> систему: <b>💰 дотация</b> (деньги напрямую поднимают просперити), <b>🍞 продпайки</b> (мгновенно сбивают напряжение) и <b>🚀 экстренный импорт</b> (закрывает дефицит и тормозит рост напряжения). Стоимость мер растёт с населением системы.</p>

      <div class="gb-bld-grid">
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⚙</span><b>Гражданская фабрика</b></div><div class="gb-bld-cost">500 ГС · 2 слота сразу</div><div class="gb-bld-d">Основной источник ГС: +200 ГС/сут за слот. Итог зависит от <b>просперити системы</b> (баланс спрос/предложение) и спроса на товары — в дефицитной по сырью/труду системе доход просядет, в сбалансированной вырастет.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⛏</span><b>Добывающий завод</b></div><div class="gb-bld-cost">500 ГС · 2 слота сразу</div><div class="gb-bld-d">Добыча ресурсов планеты (сам ГС не даёт). Несколько слотов можно назначить на один ресурс — добыча суммируется. Ценность зависит от редкости месторождения.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⇄</span><b>Торговый хаб</b></div><div class="gb-bld-cost">1 000 ГС · 1 слот</div><div class="gb-bld-d">Доход в ГС, но только при активных торговых путях.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">◆</span><b>Товарная биржа</b></div><div class="gb-bld-cost">1 500 ГС · 1 слот</div><div class="gb-bld-d">Сама продаёт накопленные ресурсы за ГС (50–75% цены по редкости), без торговых путей.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">📦</span><b>Склад</b></div><div class="gb-bld-cost">800 ГС · 1 слот</div><div class="gb-bld-d">Поднимает лимит ёмкости склада ресурсов (+500 за слот). Нужен, если копите добычу в режиме «Склад».</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">✦</span><b>Научный институт</b></div><div class="gb-bld-cost">1 000 ГС · 1 слот</div><div class="gb-bld-d">Прирост очков науки за каждый слот.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⚔</span><b>Центр подготовки</b></div><div class="gb-bld-cost">500 ГС · 1 слот</div><div class="gb-bld-d">Позволяет производить пехоту.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">◐</span><b>Центр спецслужб</b></div><div class="gb-bld-cost">3 000 ГС · 1 слот</div><div class="gb-bld-d">Поднимает <b>потолок</b> числа агентов разведки (нанимаются на рынке рекрутов).</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⛭</span><b>Военный завод</b></div><div class="gb-bld-cost">1 000 ГС · 1 слот</div><div class="gb-bld-d">Производство наземной техники.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">🚀</span><b>Корабельная верфь</b></div><div class="gb-bld-cost">2 000 ГС · 1 слот</div><div class="gb-bld-d">Производство кораблей и авиации.</div></div>
      </div>

      <div class="gb-note gb-note-tip">
        <span class="gb-note-i">★</span>
        <div>Каждый следующий слот в здании дороже предыдущего. Расширяйте сначала самые доходные здания.</div>
      </div>
    </section>

    <!-- ТЕХНОЛОГИИ -->
    <section id="gb-research" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">✦</span>Технологии</h2>
      <p>В <strong>«Кабинете игрока» → «Технологии»</strong> открывается дерево исследований. Выберите узел — если хватает очков науки, исследование запустится. Базово изучается <b>одна</b> технология за раз (у <a class="gb-link" onclick="gbScrollTo('gb-doctrine')">роботов и технократов</a> — больше).</p>
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

      <p>Сначала юнит нужно спроектировать в <a class="gb-link" onclick="gbScrollTo('gb-constructors')">Конструкторах</a>, затем заказать на вкладке «Армия». Заказы выполняются к следующему игровому дню и попадают в ваш ростер.</p>
    </section>

    <!-- КОНСТРУКТОРЫ -->
    <section id="gb-constructors" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⚒</span>Конструкторы</h2>
      <p>Прежде чем строить корабли и дивизии, их нужно спроектировать. «Конструкторы» — ваше конструкторское бюро: здесь создаются шаблоны, которые потом производятся в Кабинете.</p>

      <h3 class="gb-h3">Корабельный конструктор</h3>
      <p>Корабль собирается из <b>корпуса</b> и модулей: <b>двигатели</b> (скорость), <b>броня</b> и <b>щиты</b> (защита), <b>вооружение</b>, <b>ангары</b>, <b>реактор</b> и системы поддержки. Чем крупнее класс корпуса (корвет → фрегат → эсминец → крейсер → линкор → дредноут), тем мощнее модули в него влезают и тем дороже он в ГС и очках науки. Набор модулей зависит от изученных <a class="gb-link" onclick="gbScrollTo('gb-research')">технологий</a>. У готового проекта считаются стоимость и характеристики.</p>

      <h3 class="gb-h3">Два правила, которые нельзя нарушить</h3>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">⚡ Энергобаланс</span><span class="gb-kv-val"><b>Реактор</b> даёт энергию (E), а каждый модуль её тратит. Если суммарное потребление <b>больше выработки</b> — энергосеть перегружена, и проект <b>нельзя сохранить/построить</b>. Ставьте реактор мощнее или снимайте лишние системы.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🛩 Вместимость ангара</span><span class="gb-kv-val">Авиагруппа (истребители, бомбардировщики) должна <b>помещаться</b> в ангары корабля. Перегруженный ангар тоже блокирует постройку.</span></div>
      </div>

      <div class="gb-note gb-note-info">
        <span class="gb-note-i">◆</span>
        <div><b>Сырьё на постройку.</b> Кроме ГС, корпус расходует <b>ресурсы со склада</b> по ресурсной ведомости проекта (броня → Железо/Титан, щиты → Редкоземельные руды/Дейтерий, реактор → Изотопы/Гелий-3 и т.д.). Чего нет на складе — докупается по <b>×1.5</b>. Подробнее — в разделе <a class="gb-link" onclick="gbScrollTo('gb-resources')">«Ресурсы»</a>.</div>
      </div>

      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div><b>Торговый корабль</b> — это корпус с <b>грузовыми ангарами</b> (Транспортный / Грузовой ангар, без места под войска). Их суммарная вместимость = <b>грузоподъёмность</b> для караванов. <b>Двигатели</b> задают скорость → быстрый флот быстрее доводит караван до партнёра (см. <a class="gb-link" onclick="gbScrollTo('gb-trade')">«Торговля»</a>).</div>
      </div>

      <h3 class="gb-h3">Конструктор дивизий</h3>
      <p>Дивизия собирается из <b>блоков</b> — пехота, техника, авиация. Чтобы её произвести, нужны соответствующие здания: пехота → <b>Центр подготовки</b> (у <a class="gb-link" onclick="gbScrollTo('gb-doctrine')">роботов</a> — Военный Завод), техника → <b>Военный завод</b>, корабли/авиация → <b>Корабельная верфь</b>. Если нужного здания нет — кнопка производства подскажет, чего не хватает.</p>

      <h3 class="gb-h3">Каталоги</h3>
      <p>Разделы <b>Флот · Наземная техника · Авиация · Дивизии</b> (в меню собраны в группу «Войска») — витрины готовых и ваших проектов для просмотра характеристик.</p>

      <h3 class="gb-h3">Путь от чертежа к войскам</h3>
      <div class="gb-steps">
        <div class="gb-step"><div class="gb-step-n">1</div><div>Изучите нужные <b>технологии</b> — они открывают модули и типы юнитов.</div></div>
        <div class="gb-step"><div class="gb-step-n">2</div><div>Спроектируйте корабль или дивизию в <b>Конструкторе</b>.</div></div>
        <div class="gb-step"><div class="gb-step-n">3</div><div>Закажите производство в Кабинете → вкладка <b>«Армия»</b> (нужны военные здания со слотами).</div></div>
        <div class="gb-step"><div class="gb-step-n">4</div><div>К следующему игровому дню юниты выходят в ваш <b>ростер</b>.</div></div>
      </div>
    </section>

    <!-- РАЗВЕДКА -->
    <section id="gb-intel" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">◐</span>Разведка и агенты</h2>
      <p>Агенты — это <strong>именованные оперативники</strong> с перками, которых вы нанимаете на <strong>рынке рекрутов</strong>. Центр Спецслужб задаёт <b>потолок</b> числа агентов (2 + слоты Центра). Всё — на вкладке <strong>«Разведка»</strong>.</p>

      <h3 class="gb-h3">Агентура и рынок рекрутов</h3>
      <ul class="gb-ul">
        <li>Раз в неделю появляется новый <b>список рекрутов</b> (4 кандидата с именем, перком и ценой). Нанимаете за ГС.</li>
        <li>Нанятый агент <b>обучается 1 цикл</b>, затем готов к делу.</li>
        <li>Перк агента влияет на операции:</li>
      </ul>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">🕵 Инфильтратор</span><span class="gb-kv-val">+12% к успеху краж (казна, технологии).</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">💣 Диверсант</span><span class="gb-kv-val">+12% к успеху саботажа и дестабилизации.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">👻 Призрак</span><span class="gb-kv-val">−10% к риску раскрытия.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">📊 Аналитик</span><span class="gb-kv-val">+10% к успеху разведки.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">🛡 Куратор</span><span class="gb-kv-val">Усиливает контрразведку и ускоряет расследования.</span></div>
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
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Сложные операции требуют сначала провести <b>разведку</b> цели. Саботаж бьёт по <b>конкретной колонии</b> (выбирается из данных глубокой разведки). Пойманный на деле агент <b>выбывает</b> из агентуры.</div>
      </div>

      <h3 class="gb-h3">Контрразведка и расследование</h3>
      <ul class="gb-ul">
        <li><b>Контрразведка по объектам:</b> сажайте агентов на защиту — отдельно на <b>Центр</b> (казна, технологии, дестабилизация) и на <b>каждую колонию</b> (защита от саботажа по ней). Перк 🛡 Куратор усиливает КР везде.</li>
        <li><b>Расследование (мини-игра):</b> когда вас бьют незаметно, в «Тревогах» виден ущерб, но не исполнитель. Жмите <b>«Расследовать»</b> (150 ГС за попытку) — копятся <b>улики</b>, по мере улик открываются подсказки (буква названия, длина), а на <b>100%</b> шпион <b>вычислен</b> (отношения падают, casus belli, новость). Больше контрразведки/Кураторов — быстрее улики.</li>
      </ul>
    </section>

    <!-- ТОРГОВЛЯ -->
    <section id="gb-trade" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⇄</span>Торговля и караваны</h2>
      <p>Вкладка <strong>«Торговля»</strong> объединяет рынок, торговые караваны и обмен. (Отношения, союзы и кредиты — на вкладке <strong>«Дипломатия»</strong>.)</p>

      <h3 class="gb-h3">Караван = торговый флот + груз</h3>
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
        <div class="gb-kv-row"><span class="gb-kv-key">📈 Товарная биржа</span><span class="gb-kv-val">Здание продаёт <b>складские</b> ресурсы каждый цикл (50–75% по редкости).</span></div>
      </div>
      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Один поток — один канал: ресурс либо копится на склад, либо идёт на экспорт/караваны. Дорогое везите караванами (полная цена + дипломатия), дешёвый вал — на биржу.</div>
      </div>

      <h3 class="gb-h3">Опасности и защита</h3>
      <p>На караваны нападают пираты и древние угрозы на пути, а также <b>игроки-каперы</b> (см. «Рейды»). При нападении доход за цикл теряется. Защита: <b>конвой</b> в караване и <b>торговая политика</b> (платный контракт с NPC-флотом — см. «Рейды»).</p>

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

    <!-- РЕЙДЫ -->
    <section id="gb-raids" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">🏴</span>Рейды (каперство)</h2>
      <p>Вкладка <strong>«Рейды»</strong> — PvP-пиратство: вы шлёте военные корабли грабить <b>чужие караваны</b>. Добыча — ресурсы и ГС. Но это двусторонний бой: корабли теряют обе стороны.</p>

      <h3 class="gb-h3">Как грабить</h3>
      <ul class="gb-ul">
        <li>Грабить можно только <b>активный караван</b> цели — нет торговли, нечего и грабить.</li>
        <li>Чужие караваны видно <b>только после разведки</b> этой фракции (операция «Разведка» во вкладке «Разведка»).</li>
        <li>Сила рейда — от <b>числа кораблей</b> (не от ТТХ). Защита цели сопротивляется, потери считаются у всех.</li>
        <li>Дальняя цель — дольше в пути. За раскрытый разбой <b>отношения падают</b> (casus belli).</li>
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
      <p>Вкладка <strong>«Дипломатия»</strong> — отношения, кредиты и <b>союзы</b> между игроками. Союзы как у больших стратегий: федерация, конфедерация и вассалитет.</p>

      <h3 class="gb-h3">Федерация и конфедерация</h3>
      <p>Многочленные союзы равных держав. Создаёте союз (название + тип), приглашаете другие фракции, они вступают. Лидер может приглашать; при выходе лидера лидерство переходит дальше.</p>
      <ul class="gb-ul">
        <li><b>Конфедерация</b> — мягкий союз: бонус к защите караванов и от разведки.</li>
        <li><b>Федерация</b> — крепкий союз: сильнее защита и общий флот.</li>
        <li><b>Общий пул кораблей</b> — союзники смогут использовать корабли друг друга (в развитии).</li>
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

    <!-- КАРТА -->
    <section id="gb-map" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⬢</span>Карта галактики</h2>
      <ul class="gb-ul">
        <li><b>Системы</b> — серые нейтральные и окрашенные в цвет фракции-владельца.</li>
        <li><b>Гиперпути</b> — линии между системами, по ним идут флоты и торговые суда.</li>
        <li><b>Границы</b> — автоматически очерчивают территорию каждой державы; на стыке двух держав образуется <b>линия фронта</b> (граница с обеих сторон в цветах соседей).</li>
        <li><b>★ Столица</b> — главная система фракции.</li>
      </ul>

      <h3 class="gb-h3">Захват систем</h3>
      <ul class="gb-ul">
        <li>Захватывать можно только <b>ничейную</b> систему, <b>смежную</b> по гиперпути с вашей территорией.</li>
        <li>Стоимость — <b>3 000 ГС</b> (с учётом доктрины), после чего действует <b>перезарядка цикла</b>.</li>
        <li>Базово — <b>1 захват</b>, затем перезарядка. Технология <b>«Дом в небесах»</b> или раса <a class="gb-link" onclick="gbScrollTo('gb-doctrine')">роботов</a> дают пул из <b>2 захватов подряд</b> — берёте 2 системы, и только потом стартует перезарядка.</li>
      </ul>
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

  gbMakeCollapsible();

  requestAnimationFrame(() => {
    const links = document.querySelectorAll('.gb-toc-link');
    if (!links.length) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        links.forEach(l => l.classList.remove('active'));
        const link = document.querySelector(`.gb-toc-link[onclick*="${e.target.id}"]`);
        if (link) link.classList.add('active');
      });
    }, { rootMargin: '-15% 0px -75% 0px' });
    document.querySelectorAll('.gb-section').forEach(s => obs.observe(s));
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
