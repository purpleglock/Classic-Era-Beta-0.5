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
  { id: 'gb-intel',     icon: '◐', label: 'Разведка' },
  { id: 'gb-trade',     icon: '⇄', label: 'Торговля' },
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
  agents_flat: { label: 'Агенты',         grow: true,  pct: false, suf: '/сут' },
};
const GB_GRANT = {
  trade: 'Торговый хаб', factory: 'Гражданская фабрика', military_factory: 'Военный завод',
  training: 'Центр подготовки', science: 'Научный институт', mining: 'Добывающий завод',
  intel: 'Центр спецслужб',
};

const GB_DOC_GOV = [
  ['Республика',          { gc: 0.10, claim_cd: 0.15, sci_flat: 1 }, 'trade'],
  ['Монархия',            { gc: 0.20, sci_flat: -1 }, 'factory'],
  ['Империя',             { claim_cost: -0.25, claim_cd: -0.25, gc: -0.10, agents_flat: 1 }, 'military_factory'],
  ['Олигархия',           { gc: 0.25, sci_flat: -1 }, 'factory'],
  ['Диктатура',           { claim_cd: -0.20, gc: -0.10, agents_flat: 1 }, 'training'],
  ['Теократия',           { gc: 0.10, research: 0.15, sci_flat: -2, agents_flat: 1 }, 'training'],
  ['Технократия',         { gc: -0.15, build: 0.10, research: -0.25, sci_flat: 3 }, 'science'],
  ['Корпоратократия',     { gc: 0.20, mine: 0.15, build: -0.10, agents_flat: -1 }, 'trade'],
  ['Коллективный разум',  { mine: 0.15, claim_cost: 0.20, research: -0.10, sci_flat: 1 }, 'science'],
  ['Машинный разум (ИИ)', { gc: -0.15, build: -0.10, research: -0.15, sci_flat: 1, agents_flat: 1 }, 'science'],
];
const GB_DOC_REGIME = [
  ['Демократический',  { gc: 0.15, agents_flat: -1 }],
  ['Эгалитарный',      { gc: 0.10, claim_cost: 0.10, sci_flat: 1 }],
  ['Меритократический',{ gc: -0.10, research: -0.15, sci_flat: 2 }],
  ['Плутократический', { gc: 0.25, sci_flat: -1 }],
  ['Олигархический',   { gc: 0.15, mine: -0.10 }],
  ['Авторитарный',     { mine: 0.10, gc: -0.10, agents_flat: 1 }],
  ['Тоталитарный',     { mine: 0.25, gc: -0.15, agents_flat: 1 }],
  ['Деспотичный',      { claim_cd: -0.20, sci_flat: -1, agents_flat: 1 }],
  ['Анархический',     { colonize: -0.25, gc: -0.20, build: 0.15, sci_flat: 1 }],
];
const GB_DOC_IDEO = [
  ['Технократия (Культ науки)', { gc: -0.15, research: -0.25, sci_flat: 3 }, 'science', 'Реакторы (корабли)'],
  ['Милитаризм (Культ силы)',   { claim_cost: -0.15, gc: -0.10, research: 0.10, agents_flat: 1 }, 'military_factory', 'Броня (наземка)'],
  ['Пацифизм',                  { gc: 0.25, agents_flat: -1 }, 'factory'],
  ['Экспансионизм',             { colonize: -0.30, claim_cost: -0.30, claim_cd: -0.40, gc: -0.10 }, 'mining'],
  ['Изоляционизм',              { gc: 0.15, claim_cost: 0.25, claim_cd: 0.25, sci_flat: 1 }, 'intel', 'Щиты (наземка)'],
  ['Ксенофилия',                { gc: 0.20, agents_flat: -1 }, 'trade'],
  ['Ксенофобия',                { mine: 0.10, gc: -0.20, agents_flat: 1 }, 'training', 'Броня (наземка)'],
  ['Спиритуализм',              { research: 0.15, sci_flat: -1, agents_flat: 1 }, 'training'],
  ['Трансгуманизм',             { gc: -0.10, research: -0.15, sci_flat: 2 }, 'science', 'Щиты (наземка)'],
  ['Экоцентризм',               { mine: 0.30, gc: -0.20 }, 'mining'],
  ['Индустриализм',             { gc: 0.25, mine: 0.10, build: -0.15, research: 0.10, sci_flat: -1 }, 'factory', 'Двигатели (корабли)'],
];
const GB_DOC_RACE = [
  ['Гуманоиды',                  { gc: 0.05, sci_flat: 1 }, 'Землеподобные'],
  ['Млекопитающие',              { gc: 0.20 }, 'Землеподобные, Океанические'],
  ['Рептилоиды',                 { gc: -0.10, agents_flat: 1 }, 'Пустынные, Вулканические, Землеподобные'],
  ['Авианы (Птицеподобные)',     { claim_cd: -0.25, gc: -0.05, agents_flat: 1 }, 'Землеподобные, Пустынные'],
  ['Инсектоиды',                 { mine: 0.20, gc: 0.10, research: 0.10, sci_flat: -1 }, 'Землеподобные, Пустынные, Вулканические'],
  ['Акватики (Водные)',          { gc: 0.15, colonize: 0.15 }, 'Океанические'],
  ['Плантоиды (Растениевидные)', { mine: 0.15, gc: 0.10, agents_flat: -1 }, 'Землеподобные, Океанические'],
  ['Литоиды (Каменные)',         { mine: 0.25, gc: -0.15 }, 'Малые тела, Лавовые, Пустынные'],
  ['Синтетики / Киборги',        { gc: -0.35, research: -0.15, sci_flat: 2 }, 'ВСЕ планеты (без терраформа)'],
  ['Энергетические сущности',    { gc: -0.15, research: -0.10, sci_flat: 1, agents_flat: 1 }, 'Экзотические, Криомиры, Лавовые'],
];
const GB_DOC_CIV = [
  ['Frontier — молодая колония',  { colonize: -0.25, claim_cd: -0.25, gc: -0.15 }, 'Дешевле расширяться, но беднее старт. Бесплатно: Центр спецслужб'],
  ['Colony — устоявшаяся держава', { gc: 0.20, mine: 0.10, claim_cost: 0.15, build: -0.10 }, 'Сильная экономика, дороже захват систем. Бесплатно: Гражданская фабрика'],
];
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
// Все чипы доктрины + (опц.) грант-здание + грант-тех
function gbChips(mods, grant, tech) {
  const order = ['gc', 'mine', 'build', 'colonize', 'claim_cost', 'claim_cd', 'research', 'sci_flat', 'agents_flat'];
  let h = order.map(k => gbChip(k, mods[k])).join('');
  if (grant && GB_GRANT[grant]) h += `<span class="gb-chip gb-chip-grant">⌂ ${GB_GRANT[grant]}</span>`;
  if (tech) h += `<span class="gb-chip gb-chip-tech">✦ ${tech}</span>`;
  return h;
}
function gbDocRows(arr, withHab) {
  return arr.map(row => {
    const [name, mods, c, d] = row;
    const grant = withHab ? null : c;       // у рас третий элемент — это родные миры
    const habitat = withHab ? c : null;
    const tech = withHab ? null : d;
    return `<div class="gb-doc-row">
      <div class="gb-doc-name">${name}${habitat ? `<span class="gb-doc-hab">Родные миры: ${habitat}</span>` : ''}</div>
      <div class="gb-doc-chips">${gbChips(mods, grant, tech)}</div>
    </div>`;
  }).join('');
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
      <p class="gb-hero-sub">Пошаговая стратегия о галактических державах. Здесь — всё, что нужно знать новичку: от создания фракции до первых колоний, армий и шпионажа.</p>
    </header>

    <!-- С ЧЕГО НАЧАТЬ -->
    <section id="gb-intro" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">◈</span>С чего начать</h2>
      <p>Вы управляете межзвёздной державой. Цель — развивать экономику, расширять территорию, строить армии и флоты, вести разведку и дипломатию. Игра идёт в реальном времени: раз в сутки наступает новый <strong>игровой день</strong>, когда начисляется доход и завершаются все начатые работы.</p>

      <div class="gb-steps">
        <div class="gb-step"><div class="gb-step-n">1</div><div><strong>Зарегистрируйтесь</strong> — создайте аккаунт по почте и паролю.</div></div>
        <div class="gb-step"><div class="gb-step-n">2</div><div><strong>Создайте фракцию</strong> в разделе «Фракции» — пройдите мастер из нескольких шагов.</div></div>
        <div class="gb-step"><div class="gb-step-n">3</div><div><strong>Дождитесь одобрения</strong> заявки администратором.</div></div>
        <div class="gb-step"><div class="gb-step-n">4</div><div><strong>Откройте «Кабинет игрока»</strong> — стройте здания, колонизируйте планеты, развивайтесь.</div></div>
      </div>

      <div class="gb-cards">
        <div class="gb-card"><div class="gb-card-big">ГС</div><div class="gb-card-t">Галактические стандарты</div><div class="gb-card-d">Главная валюта. Тратится на стройку, колонии, армию и операции.</div></div>
        <div class="gb-card"><div class="gb-card-big">ОН</div><div class="gb-card-t">Очки науки</div><div class="gb-card-d">Копятся со временем, тратятся на исследование технологий.</div></div>
        <div class="gb-card"><div class="gb-card-big">⌖</div><div class="gb-card-t">Агенты</div><div class="gb-card-d">Кадры разведки. Нужны для шпионских операций против соседей.</div></div>
      </div>
    </section>

    <!-- ПРАВИЛА ПРОЕКТА -->
    <section id="gb-rules" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⚖</span>Правила проекта</h2>
      <p>Эти правила обязательны для всех участников. Их нарушение влечёт санкции вплоть до перманентной блокировки. Прочитайте их до начала игры.</p>
      <div class="gb-note gb-note-info"><span class="gb-note-i">i</span><div>Ниже — краткая выжимка. <b>Полные правила</b> (Общие правила, Устав, Регламенты RP и боёв, дисциплина, нейминг) — в разделе меню <a href="javascript:void(0)" onclick="go('rules-general')" style="color:var(--color-link)"><b>«Правила проекта»</b></a>.</div></div>

      <h3 class="gb-h3">Поведение в официальной беседе</h3>
      <p>Обсуждение политики, оскорбление участников, переходы на личности при конфликтах, спам и контент 18+ — <strong>строго запрещены</strong>.</p>
      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div>Нарушение карается <b>удалением из официальной беседы-флудилки на 1 день</b>. При повторных случаях администрация вправе <b>лишить доступа к официальной беседе навсегда</b>.</div>
      </div>
      <ul class="gb-ul">
        <li>Запрет контента 18+ действует в том числе потому, что среди участников могут быть лица, не достигшие совершеннолетия, а также ради контроля адекватного поведения в официальной беседе.</li>
        <li>Игроки вправе создавать собственные беседы-флудилки, но они <b>не относятся к официальной группе</b> и не регулируются администрацией и этими правилами.</li>
      </ul>

      <h3 class="gb-h3">Имущество проекта</h3>
      <p>Фракции, планеты, флоты, технологии, кредиты (ГС) и очки науки (ОН) <strong>не являются вашей личной интеллектуальной или материальной собственностью</strong>. Это элементы общего игрового мира, выданные вам Администрацией во временное управление для осуществления ролевого процесса.</p>

      <h3 class="gb-h3">1.4. Форс-мажоры и технические сбои</h3>
      <p>Администрация не несёт ответственности за временную недоступность сайта, вики-системы или ботов. В случае глобальных технических сбоев, влияющих на расчёты (например, слёт базы данных Инженерного терминала), Администрация вправе объявить <b>заморозку хода</b> или <b>откат прогресса</b> до последней стабильной точки сохранения.</p>

      <h3 class="gb-h3">2.2. Неотчуждаемость лора</h3>
      <p>Все текстовые посты, чертежи кораблей, описания технологий и исторические события, написанные и опубликованные вами в рамках игры, становятся <strong>неотъемлемой частью канона</strong> нашей вселенной. При добровольном уходе из проекта или принудительной блокировке аккаунта игрок навсегда лишается права требовать удаления своего контента, статей или ликвидации фракции.</p>

      <h3 class="gb-h3">Запрет мультиаккаунтов (твинководство)</h3>
      <p>Один реальный человек имеет право управлять <strong>только одной фракцией</strong> в проекте. Создание дополнительных (фейковых) аккаунтов для марионеточных государств, переливания ресурсов, шпионажа или голосований категорически запрещено.</p>
      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div>Твинководство карается <b>перманентным баном всей сетки аккаунтов</b>.</div>
      </div>
    </section>

    <!-- РЕГИСТРАЦИЯ -->
    <section id="gb-reg" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">◷</span>Регистрация и заявка</h2>
      <p>Нажмите <strong>«Войти»</strong> в боковом меню и создайте аккаунт. После входа в навигации появится раздел <strong>«Фракции»</strong> — оттуда подаётся заявка на создание державы.</p>

      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div>Один аккаунт — одна фракция. Новую заявку можно подать, только если предыдущую отклонили.</div>
      </div>

      <h3 class="gb-h3">Что происходит с заявкой</h3>
      <div class="gb-status-list">
        <div class="gb-status"><span class="gb-dot gb-dot-warn"></span><strong>На рассмотрении</strong> — заявка ждёт проверки администратором.</div>
        <div class="gb-status"><span class="gb-dot gb-dot-ok"></span><strong>Одобрена</strong> — в меню появляются «Кабинет игрока» и «Конструкторы». Игра началась!</div>
        <div class="gb-status"><span class="gb-dot gb-dot-err"></span><strong>Отклонена</strong> — свяжитесь с администратором и подайте заявку заново.</div>
      </div>
    </section>

    <!-- СОЗДАНИЕ ФРАКЦИИ -->
    <section id="gb-wizard" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⬡</span>Создание фракции</h2>
      <p>Мастер проведёт вас по шагам. Каждое решение влияет на бонусы державы — их полную сводку смотрите в разделе <a class="gb-link" onclick="gbScrollTo('gb-doctrine')">«Доктрина»</a>.</p>

      <div class="gb-wsteps">
        <div class="gb-wstep"><b>Название и тип цивилизации.</b> Frontier (молодая колония) или Colony (устоявшаяся держава) — у них разные стартовые бонусы.</div>
        <div class="gb-wstep"><b>Форма правления и политический режим.</b> Две независимые оси доктрины — их бонусы складываются.</div>
        <div class="gb-wstep"><b>Идеология.</b> Задаёт стратегический вектор и часто даёт стартовую технологию.</div>
        <div class="gb-wstep"><b>Раса.</b> Влияет на доход и определяет, какие планеты для вас «родные» (заселяются сразу, без терраформирования).</div>
        <div class="gb-wstep"><b>Столичная система и планета.</b> Выберите свободную звезду на мини-карте — она станет столицей (отметка ★ на карте галактики).</div>
        <div class="gb-wstep"><b>Стартовые постройки.</b> 20 очков на выбор начальных зданий (см. таблицу ниже).</div>
        <div class="gb-wstep"><b>Описание и герб.</b> Лор фракции: лидер, культура, история, геральдика. Необязательно, но желательно.</div>
      </div>

      <h3 class="gb-h3">Стартовые постройки — 20 очков</h3>
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
      <p>«Доктрина» — это сумма бонусов от вашего типа цивилизации, формы правления, режима, идеологии и расы. <strong>Бонусы складываются.</strong> Например, +20% к доходу от правления и +20% от расы дадут вместе +40%.</p>

      <div class="gb-legend">
        <span class="gb-chip gb-chip-good">зелёный — выгодно вам</span>
        <span class="gb-chip gb-chip-bad">красный — штраф / дороже</span>
        <span class="gb-chip gb-chip-grant">⌂ бесплатное здание</span>
        <span class="gb-chip gb-chip-tech">✦ стартовая технология</span>
      </div>

      <h3 class="gb-h3">Тип цивилизации</h3>
      <div class="gb-doc-list">${gbDocRows(GB_DOC_CIV.map(([n, m]) => [n, m]), false)}</div>
      <div class="gb-doc-note">${GB_DOC_CIV.map(c => `<div><b>${c[0].split('—')[0].trim()}:</b> ${c[2]}</div>`).join('')}</div>

      <h3 class="gb-h3">Форма правления</h3>
      <div class="gb-doc-list">${gbDocRows(GB_DOC_GOV, false)}</div>

      <h3 class="gb-h3">Политический режим</h3>
      <div class="gb-doc-list">${gbDocRows(GB_DOC_REGIME, false)}</div>

      <h3 class="gb-h3">Идеология</h3>
      <div class="gb-doc-list">${gbDocRows(GB_DOC_IDEO, false)}</div>

      <h3 class="gb-h3">Раса</h3>
      <div class="gb-doc-list">${gbDocRows(GB_DOC_RACE, true)}</div>

      <div class="gb-note gb-note-info">
        <span class="gb-note-i">i</span>
        <div>Любой бонус-множитель не может опустить показатель ниже 30% от базы — даже если набрать много штрафов, доход не обнулится.</div>
      </div>

      <div class="gb-robot">
        <div class="gb-robot-hd"><span class="gb-robot-ic">⚙</span>Роботы — особая раса</div>
        <p class="gb-robot-sub">Фракция считается <b>роботами</b>, если выбрана раса <b>«Синтетики / Киборги»</b> <i>или</i> правление <b>«Машинный разум (ИИ)»</b>. Они играют принципиально иначе — мощная экспансия и наука ценой денег.</p>
        <div class="gb-kv-grid">
          <div class="gb-kv-row"><span class="gb-kv-key">🪐 Все планеты родные</span><span class="gb-kv-val">Колонизируют <b>любой</b> тип планет сразу, <b>без терраформа</b>.</span></div>
          <div class="gb-kv-row"><span class="gb-kv-key">⚔ Армия на Военном Заводе</span><span class="gb-kv-val">Пехоту-роботов «собирают» на <b>Военном Заводе</b> (Центр Подготовки не нужен), причём <b>×3</b> к мощности — 3000/слот вместо 1000.</span></div>
          <div class="gb-kv-row"><span class="gb-kv-key">✦ 2 исследования сразу</span><span class="gb-kv-val">Машинный разум ведёт <b>две</b> технологии параллельно вместо одной.</span></div>
          <div class="gb-kv-row"><span class="gb-kv-key">⬢ 2 захвата подряд</span><span class="gb-kv-val">Берут <b>две</b> системы подряд, и только потом уходят на перезарядку (вместо 1).</span></div>
          <div class="gb-kv-row"><span class="gb-kv-key gb-kv-bad">◇ Расплата — деньги</span><span class="gb-kv-val">Сильный штраф к доходу: <b>−35% ГС</b> (у «Синтетиков»), с правлением «Машинный разум» — суммарно ещё больше.</span></div>
        </div>
      </div>
    </section>

    <!-- ЭКОНОМИКА -->
    <section id="gb-economy" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">◇</span>Экономика и доход</h2>
      <p>Весь доход начисляется <strong>автоматически</strong> раз в игровой день — планировщик обсчитывает все фракции сам, заходить для этого не нужно. Если вы не были в игре несколько дней, при следующем входе доход придёт сразу за все пропущенные дни — ничего не теряется. Открытие <strong>«Кабинета игрока»</strong> просто подтягивает накопленное мгновенно, не дожидаясь ночного расчёта.</p>

      <h3 class="gb-h3">Откуда берётся доход</h3>
      <ul class="gb-ul">
        <li><b>ГС в сутки</b> — сумма дохода всех ваших зданий, умноженная на бонус доктрины к доходу.</li>
        <li><b>Очки науки в сутки</b> — от Научных институтов плюс бонусы доктрины к науке.</li>
        <li><b>Агенты в сутки</b> — от Центров спецслужб плюс бонусы доктрины к агентам.</li>
      </ul>

      <h3 class="gb-h3">Планетарные ресурсы</h3>
      <p>На части планет есть месторождения — их добывают Добывающие заводы. Чем реже ресурс, тем дороже он стоит, но тем медленнее добывается:</p>
      <div class="gb-tbl">
        <div class="gb-tr gb-th"><span>Редкость</span><span>Цена за единицу</span><span>Добыча в сутки (за слот)</span></div>
        <div class="gb-tr"><span><span class="gb-rar gb-rar-1">Обычный</span></span><span>2 ГС</span><span>25</span></div>
        <div class="gb-tr"><span><span class="gb-rar gb-rar-2">Необычный</span></span><span>5 ГС</span><span>12</span></div>
        <div class="gb-tr"><span><span class="gb-rar gb-rar-3">Редкий</span></span><span>12 ГС</span><span>5</span></div>
        <div class="gb-tr"><span><span class="gb-rar gb-rar-4">Эпический</span></span><span>30 ГС</span><span>2</span></div>
        <div class="gb-tr"><span><span class="gb-rar gb-rar-5">Легендарный</span></span><span>80 ГС</span><span>1</span></div>
      </div>
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
          <tr><td>Газовые / ледяные / горячие гиганты, аномалии, пояса астероидов</td><td><span style="color:var(--t4)">✕ колонизировать нельзя</span></td></tr>
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
        <li>Откройте слоты и <b>назначьте месторождения</b> степпером «− N +». Можно посадить <b>несколько слотов на один ресурс</b> — его добыча суммируется (2 слота = ×2 скорость).</li>
        <li>Помимо ресурсов завод даёт небольшой доход <b>+50 ГС/сут за слот</b>. Без назначенных месторождений идёт только этот ГС-доход.</li>
        <li>Скорость добычи зависит от редкости ресурса; бонус доктрины «добыча» умножает выработку.</li>
      </ul>

      <h3 class="gb-h3">Редкость, цена и скорость добычи</h3>
      <div class="gb-table-wrap"><table class="gb-table">
        <thead><tr><th>Редкость</th><th>Цена за единицу</th><th>Добыча в сутки (за слот)</th></tr></thead>
        <tbody>
          <tr><td><span class="gb-rar gb-rar-1">Обычный</span></td><td>2 ГС</td><td>25</td></tr>
          <tr><td><span class="gb-rar gb-rar-2">Необычный</span></td><td>5 ГС</td><td>12</td></tr>
          <tr><td><span class="gb-rar gb-rar-3">Редкий</span></td><td>12 ГС</td><td>5</td></tr>
          <tr><td><span class="gb-rar gb-rar-4">Эпический</span></td><td>30 ГС</td><td>2</td></tr>
          <tr><td><span class="gb-rar gb-rar-5">Легендарный</span></td><td>80 ГС</td><td>1</td></tr>
        </tbody>
      </table></div>
      <p>Редкие ресурсы дороже, но добываются медленнее — баланс между объёмом и ценностью.</p>

      <h3 class="gb-h3">Как превратить ресурсы в ГС</h3>
      <p>Накопленные ресурсы сами по себе доход не приносят — их нужно продать. Есть три способа:</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">Местный рынок</span><span class="gb-kv-val">Вкладка «Дипломатия» → продать вручную за <b>80%</b> базовой цены. Мгновенно, без партнёров.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Товарная биржа</span><span class="gb-kv-val">Здание: <b>само</b> продаёт накопленное за ~<b>50%</b> цены каждый день. Удобно, но дешевле.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Торговый караван</span><span class="gb-kv-val">Торговый путь с другой фракцией — <b>полная</b> цена, но нужен партнёр и есть риск пиратов (см. «Торговля»).</span></div>
      </div>
      <div class="gb-callout gb-callout-tip">
        <span class="gb-callout-icon">★</span>
        <div>Дорогие ресурсы (эпические/легендарные) выгоднее возить караванами по полной цене, а дешёвый «вал» — сбрасывать на бирже автоматически.</div>
      </div>
    </section>

    <!-- ЗДАНИЯ -->
    <section id="gb-buildings" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⌂</span>Здания</h2>
      <p>Здания — фундамент державы. Каждое занимает одну ячейку на планете и имеет до <b>6 слотов</b> мощности. Постройка здания и открытие каждого нового слота занимают <b>1 день</b>; недостроенное можно отменить с возвратом денег.</p>

      <div class="gb-bld-grid">
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⚙</span><b>Гражданская фабрика</b></div><div class="gb-bld-cost">500 ГС · 2 слота сразу</div><div class="gb-bld-d">Основной источник ГС: +200 ГС/сут за каждый открытый слот.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⛏</span><b>Добывающий завод</b></div><div class="gb-bld-cost">500 ГС · 2 слота сразу</div><div class="gb-bld-d">+50 ГС/сут за слот и добыча ресурсов планеты. Несколько слотов можно назначить на один ресурс — добыча суммируется.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⇄</span><b>Торговый хаб</b></div><div class="gb-bld-cost">1 000 ГС · 1 слот</div><div class="gb-bld-d">Доход в ГС, но только при активных торговых путях.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">◆</span><b>Товарная биржа</b></div><div class="gb-bld-cost">1 500 ГС · 1 слот</div><div class="gb-bld-d">Сама продаёт накопленные ресурсы за ГС (~50% цены), без торговых путей.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">✦</span><b>Научный институт</b></div><div class="gb-bld-cost">1 000 ГС · 1 слот</div><div class="gb-bld-d">Прирост очков науки за каждый слот.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">⚔</span><b>Центр подготовки</b></div><div class="gb-bld-cost">500 ГС · 1 слот</div><div class="gb-bld-d">Позволяет производить пехоту.</div></div>
        <div class="gb-bld"><div class="gb-bld-h"><span class="gb-bld-ic">◐</span><b>Центр спецслужб</b></div><div class="gb-bld-cost">3 000 ГС · 1 слот</div><div class="gb-bld-d">Прирост агентов разведки.</div></div>
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
      <p>В <strong>«Кабинете игрока» → «Технологии»</strong> открывается дерево исследований. Выберите узел — если хватает очков науки, исследование запустится. Одновременно изучается <b>одна</b> технология (у <a class="gb-link" onclick="gbScrollTo('gb-doctrine')">роботов</a> — <b>две</b> параллельно).</p>
      <ul class="gb-ul">
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
      <p>Корабль собирается из <b>корпуса</b> и модулей: <b>двигатели</b> (ход и манёвр), <b>броня</b> и <b>щиты</b> (защита), <b>вооружение</b> и системы поддержки. Набор доступных модулей зависит от изученных <a class="gb-link" onclick="gbScrollTo('gb-research')">технологий</a>. У готового проекта считаются стоимость и характеристики.</p>

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
      <h2 class="gb-h2"><span class="gb-h2-icon">◐</span>Разведка</h2>
      <p>Агенты копятся от Центров спецслужб. На вкладке <strong>«Разведка»</strong> выберите цель, тип операции и сколько агентов задействовать. Чем больше агентов — тем выше шанс успеха и тем быстрее операция.</p>

      <div class="gb-tbl">
        <div class="gb-tr gb-th"><span>Операция</span><span>Срок</span><span>Результат</span></div>
        <div class="gb-tr"><span>Базовая разведка</span><span>1 день</span><span>Узнать казну, науку, агентов, колонии цели</span></div>
        <div class="gb-tr"><span>Глубокая разведка</span><span>2 дня</span><span>Узнать постройки, флот, армию, технологии</span></div>
        <div class="gb-tr"><span>Кража казны</span><span>2 дня</span><span>Похитить часть ГС цели</span></div>
        <div class="gb-tr"><span>Саботаж</span><span>2 дня</span><span>Вывести из строя одно здание</span></div>
        <div class="gb-tr"><span>Дестабилизация</span><span>3 дня</span><span>Снизить доход цели на несколько дней</span></div>
        <div class="gb-tr"><span>Кража технологий</span><span>4 дня</span><span>Украсть технологию у цели</span></div>
      </div>

      <div class="gb-note gb-note-warn">
        <span class="gb-note-i">!</span>
        <div>Раскрытая операция уведомляет цель, а при провале можно потерять агентов. Держите 1–2 агента в резерве на контрразведку — иначе будете уязвимы для чужого шпионажа.</div>
      </div>
    </section>

    <!-- ТОРГОВЛЯ -->
    <section id="gb-trade" class="gb-section">
      <h2 class="gb-h2"><span class="gb-h2-icon">⇄</span>Торговля</h2>
      <p>Вкладка <strong>«Торговля»</strong> объединяет рынок, торговые караваны и обмен. (Отношения и кредиты — на отдельной вкладке <strong>«Дипломатия»</strong>.)</p>

      <h3 class="gb-h3">Рынок и караваны</h3>
      <p>Ресурсы можно продать на <b>местном рынке</b> (80% цены, мгновенно) или возить <b>караванами</b> по торговому пути — это соглашение между двумя фракциями. Пока партнёров нет, Торговые хабы дохода не дают. Предложите путь другой державе — после согласия обе стороны начинают получать ГС.</p>

      <h3 class="gb-h3">Опасности маршрута</h3>
      <p>На торговые конвои нападают пираты и древние угрозы. При нападении доход за этот день теряется. <b>Эскорт (конвой)</b> заметно снижает риск — назначается там же.</p>

      <h3 class="gb-h3">Обмен (бартер)</h3>
      <p>Блок <b>«Обмен»</b> позволяет передавать активы между фракциями: <b>ГС, ОН, ресурсы склада и корабли</b> (передаётся владение). Соберите, что <b>отдаёте</b>, и при желании — что хотите <b>взамен</b>:</p>
      <div class="gb-kv-grid">
        <div class="gb-kv-row"><span class="gb-kv-key">Подарок</span><span class="gb-kv-val">Если поле «взамен» пустое — активы уходят партнёру сразу.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Сделка</span><span class="gb-kv-val">Если указали встречный запрос — партнёр получает <b>предложение</b> и принимает/отклоняет его. Обмен проходит <b>атомарно</b>: если у любой из сторон не хватает активов в момент принятия — сделка не состоится.</span></div>
        <div class="gb-kv-row"><span class="gb-kv-key">Корабли</span><span class="gb-kv-val">Передаются по модели из вашего ростера; у получателя они появляются как готовые.</span></div>
      </div>
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
      <p>Сменить столицу можно в <strong>«Кабинете» → «Территория»</strong> кнопкой «★ Столица». При переносе все колонии переезжают в новую систему.</p>
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
