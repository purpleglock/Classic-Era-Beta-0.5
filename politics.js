// © 2025–2026. Все права защищены.
// ═══════════════════════════════════════════════════════════════
// ПОЛИТИКА — два экрана новеллы вместо шести вкладок кабинета.
//
//   ⚖ Внутренняя политика : Двор · Благополучие · Курс державы · Вера
//   🕊 Внешняя политика    : Границы · Война · Союзы · Отношения · Патронат ·
//                            Кредиты · Аванпосты
//
// Война живёт СНАРУЖИ: объявление — это разговор с соседом, а не с собственным
// двором, и стоит она ровно там же, где границы и союзы, которые ею и рвутся.
//
// Кабинет — бухгалтерия: там строят, считают, продают. Политика — другой жанр
// разговора, и живёт она там же, где новелла: у трона, а не в ведомости.
// Тела разделов отдаёт economy.js (те же ecTab*), здесь — рамка и порядок.
// Объяснений тут НЕТ: вся справка живёт в гайдбуке (GB_TOPICS в guide.js) и
// открывается кнопкой «?» окном поверх сцены.
// ═══════════════════════════════════════════════════════════════

const POL = {
  tab: 'court',        // активный раздел внутренней политики
  dtab: 'borders',     // активный раздел внешней
  chrome: false,       // рисуем внутри своей рамки → ecIntro молчит (свой пролог)
  seen: {},            // какие заставки игрок уже свернул
};

// ── Разделы ────────────────────────────────────────────────────
// key: [имя, сцена (глиф + заставка), help = ключ карточки гайдбука]
const POL_SEC = {
  court: {
    nm: 'Двор', scene: 'throne', help: 'court',
  },
  welfare: {
    nm: 'Благополучие', scene: 'scales', help: 'welfare',
  },
  policy: {
    nm: 'Курс державы', scene: 'compass', help: 'policy',
  },
  faith: {
    nm: 'Вера', scene: 'temple', help: 'faith',
  },
};
// Внешняя политика была ОДНОЙ вкладкой-простынёй «Дипломатия»: границы, союзы,
// отношения, патронат и кредиты валились подряд. Разговоры это разные — каждый
// получил своё место на рельсе и свою сцену.
const POL_DSEC = {
  borders: {
    nm: 'Границы', scene: 'gate', help: 'borders',
  },
  war: {
    nm: 'Война', scene: 'war', help: 'war',
  },
  alliance: {
    nm: 'Союзы', scene: 'pact', help: 'alliance',
  },
  relations: {
    nm: 'Отношения', scene: 'ties', help: 'relations',
  },
  patron: {
    nm: 'Духовный патронат', scene: 'chalice', help: 'patron',
  },
  loans: {
    nm: 'Кредиты', scene: 'coin', help: 'loans',
  },
  outposts: {
    nm: 'Аванпосты', scene: 'sat', help: 'outposts',
  },
};

// Переход в экран политики ОТКУДА УГОДНО (кабинет, ссылки внутри разделов).
// Новелла на главной инициализируется асинхронно, поэтому ждём её контроллер,
// а не стреляем в пустоту через фиксированный setTimeout.
function polGoto(kind) {
  // Работа вернулась в кабинет: ссылки внутри разделов ведут туда, а не на
  // главную в меню новеллы (см. шапку cabinet.js).
  if (typeof cabGoto === 'function') { cabGoto(kind); return; }
  if (typeof go === 'function' && typeof curSlug !== 'undefined' && curSlug !== 'home') go('home', false);
  let tries = 0;
  const tick = () => {
    const ready = (typeof _heroVNCtl !== 'undefined' && _heroVNCtl) && document.getElementById('hp-vn-pol');
    if (ready) { heroVNChoice(kind); return; }
    if (++tries > 40) { if (typeof toast === 'function') toast('Экран политики доступен на главной, в меню новеллы', 'inf'); return; }
    setTimeout(tick, 80);
  };
  setTimeout(tick, 60);
}

// ── Глифы разделов: та же линия, что и в больших заставках ─────
// Эмодзи в интерфейсе не используем: у каждой ОС свой рисунок, они выпадают из
// графики экрана и не красятся в цвет раздела. Рисуем сами, 24×24, один штрих.
function polGlyph(kind, cls) {
  const G = {
    throne: '<path d="M7 21V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v12z"/><path d="M5 21h14"/><path d="M9 7V4M12 7V2M15 7V4"/>',
    scales: '<path d="M4 7h16"/><path d="M12 7v13M8 21h8"/><path d="M4 7 1.5 14h5zM20 7l-2.5 7h5z"/>',
    compass:'<circle cx="12" cy="12" r="9"/><path d="M12 5.5 14 12l-2 6.5L10 12z"/>',
    temple: '<path d="M12 3l9 5H3z"/><path d="M6 8v10M10 8v10M14 8v10M18 8v10"/><path d="M3 18h18v3H3z"/>',
    war:    '<path d="M4 20 16 5M14 3l4 4-2 2-4-4z"/><path d="M20 20 8 5"/>',
    gate:   '<path d="M6 21V6M18 21V6"/><path d="M4 6h4M16 6h4"/><path d="M9 12h6"/><path d="M12 9v6"/>',
    pact:   '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>',
    ties:   '<circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="19" cy="18" r="2"/><path d="M5.6 7.4 9.8 10M18.4 7.4 14.2 10M7.6 18 10.4 14.6M17.2 16.6 14.4 13.8"/>',
    chalice:'<path d="M7 4h10l-1.4 6A4 4 0 0 1 12 12a4 4 0 0 1-3.6-2z"/><path d="M12 12v6M8 20h8"/>',
    coin:   '<circle cx="12" cy="9" r="5"/><path d="M12 7v4M10.5 8h3"/><path d="M4 15c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5"/><path d="M4 15v3c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5v-3"/>',
    sat:    '<circle cx="12" cy="12" r="3"/><path d="M5 7l4 3M5 17l4-3M19 7l-4 3M19 17l-4-3"/><path d="M2 5h4v4H2zM18 5h4v4h-4z"/>',
    crown:  '<path d="M4 18h16l1-11-5 4-4-6-4 6-5-4z"/><path d="M4 21h16"/>',
  }[kind] || '';
  return `<svg class="pol-gl${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${G}</svg>`;
}

// ── Сценические заставки: чистый SVG, инди-анимация на CSS ─────
// Никаких библиотек и картинок: линия, круг, ритм. Дёшево по трафику и
// одинаково выглядит на любом фоне.
function polScene(kind) {
  const S = {
    throne: `<g class="pol-sv-slow">
        <path d="M60 92 L60 44 Q60 30 74 30 L106 30 Q120 30 120 44 L120 92 Z"/>
        <path d="M52 92 L128 92 L134 108 L46 108 Z"/>
        <path d="M74 30 L74 14 M90 30 L90 8 M106 30 L106 14"/>
      </g>
      <circle class="pol-sv-pulse" cx="90" cy="8" r="4"/>
      <g class="pol-sv-orbit"><circle cx="90" cy="60" r="52" class="pol-sv-ring"/></g>`,
    scales: `<g class="pol-sv-tilt">
        <path d="M40 40 L140 40"/><path d="M40 40 L26 74 L54 74 Z"/><path d="M140 40 L126 66 L154 66 Z"/>
      </g>
      <path d="M90 40 L90 104 M66 108 L114 108"/>
      <circle class="pol-sv-pulse" cx="90" cy="34" r="5"/>`,
    compass: `<circle cx="90" cy="62" r="44" class="pol-sv-ring"/>
      <circle cx="90" cy="62" r="30" class="pol-sv-ring pol-sv-ring2"/>
      <g class="pol-sv-needle"><path d="M90 26 L98 62 L90 98 L82 62 Z"/></g>
      <circle class="pol-sv-pulse" cx="90" cy="62" r="4"/>`,
    temple: `<path d="M90 16 L146 48 L34 48 Z"/>
      <path d="M46 48 L46 100 M68 48 L68 100 M90 48 L90 100 M112 48 L112 100 M134 48 L134 100"/>
      <path d="M28 100 L152 100 L152 110 L28 110 Z"/>
      <g class="pol-sv-halo"><circle cx="90" cy="34" r="18" class="pol-sv-ring"/></g>`,
    war: `<g class="pol-sv-clash"><path d="M40 106 L118 28 M110 20 L128 38 L120 46 L102 28 Z"/></g>
      <g class="pol-sv-clash pol-sv-clash2"><path d="M140 106 L62 28 M70 20 L52 38 L60 46 L78 28 Z"/></g>
      <circle class="pol-sv-spark" cx="90" cy="58" r="7"/>`,
    // Границы: два пилона и створ между ними — засов ходит, а не «руки домиком».
    gate: `<path d="M52 108 L52 26 M128 108 L128 26"/>
      <path d="M40 26 L64 26 M116 26 L140 26"/>
      <path d="M28 108 L152 108"/>
      <g class="pol-sv-grip"><path d="M64 62 L116 62"/></g>
      <path d="M90 46 L90 78"/>
      <circle class="pol-sv-pulse" cx="90" cy="62" r="6"/>`,
    // Союз: два кольца, вошедшие друг в друга. Общая доля — заштрихованный створ.
    pact: `<circle cx="70" cy="62" r="34" class="pol-sv-ring"/>
      <circle cx="110" cy="62" r="34" class="pol-sv-ring"/>
      <g class="pol-sv-grip"><path d="M90 32 A34 34 0 0 1 90 92 A34 34 0 0 1 90 32 Z"/></g>
      <circle class="pol-sv-pulse" cx="90" cy="62" r="5"/>`,
    // Отношения: узел связей — центр держит четыре двора, нити пульсируют.
    ties: `<circle cx="90" cy="62" r="13"/>
      <circle cx="34" cy="30" r="8"/><circle cx="146" cy="30" r="8"/>
      <circle cx="40" cy="100" r="8"/><circle cx="142" cy="98" r="8"/>
      <path d="M41 36 L79 55 M139 36 L101 55 M47 95 L79 71 M135 93 L101 70" class="pol-sv-ring"/>
      <g class="pol-sv-ping"><circle cx="90" cy="62" r="30" class="pol-sv-ring"/></g>`,
    // Патронат: чаша, над ней чужое пламя — свет не свой, но горит за вас.
    chalice: `<path d="M56 34 L124 34 L114 70 A28 28 0 0 1 66 70 Z"/>
      <path d="M90 84 L90 104 M62 108 L118 108"/>
      <g class="pol-sv-halo"><circle cx="90" cy="24" r="14" class="pol-sv-ring"/></g>
      <circle class="pol-sv-pulse" cx="90" cy="24" r="5"/>`,
    // Кредиты: столбик монет и одна на ребре — долг, который ещё качается.
    coin: `<ellipse cx="86" cy="94" rx="40" ry="13"/>
      <path d="M46 94 L46 76 M126 94 L126 76"/>
      <ellipse cx="86" cy="76" rx="40" ry="13" class="pol-sv-ring"/>
      <g class="pol-sv-tilt"><circle cx="90" cy="40" r="22"/><path d="M90 30 L90 50 M82 36 L98 36"/></g>`,
    sat: `<circle cx="90" cy="66" r="16"/>
      <path d="M52 50 L74 60 M52 82 L74 72 M128 50 L106 60 M128 82 L106 72"/>
      <rect x="34" y="42" width="18" height="16"/><rect x="128" y="42" width="18" height="16"/>
      <g class="pol-sv-ping"><circle cx="90" cy="66" r="30" class="pol-sv-ring"/></g>
      <g class="pol-sv-ping pol-sv-ping2"><circle cx="90" cy="66" r="30" class="pol-sv-ring"/></g>`,
  }[kind] || '';
  return `<svg class="pol-sv" viewBox="0 0 180 124" aria-hidden="true">${S}</svg>`;
}

// ── Заставка раздела: сцена + имя + «?» ────────────────────────
// Ни строчки объяснений: правила мира и порядок действий живут ТОЛЬКО в
// гайдбуке (GB_TOPICS в guide.js) и открываются оттуда окном по кнопке «?».
// def.help — ключ карточки руководства; нет ключа — нет и кнопки.
function polPrologue(key, def) {
  const folded = !!POL.seen[key];
  const help = (typeof gbHelpBtn === 'function' && def.help) ? gbHelpBtn(def.help) : '';
  return `<section class="pol-scene${folded ? ' fold' : ''}">
    <div class="pol-scene-art">${polScene(def.scene)}</div>
    <div class="pol-scene-tx">
      <div class="pol-scene-hd">
        <span class="pol-scene-ic">${polGlyph(def.scene)}</span>
        <h2>${esc(def.nm)}</h2>
        ${help}
        <button class="pol-fold" type="button" onclick="event.stopPropagation();polFold('${key}')">${folded ? 'развернуть' : 'свернуть'}</button>
      </div>
    </div>
  </section>`;
}
function polFold(key) {
  POL.seen[key] = !POL.seen[key];
  polRefresh(); dipRefresh();
  // Прологи одни на все экраны новеллы — сворачивать их умеет и хозяйство.
  if (typeof estRefreshOpen === 'function') estRefreshOpen();
}

// ── Зачистка объяснений в телах экономики ──────────────────────
// Тела разделов рисует economy.js, и они те же, что в кабинете: там по ним
// рассыпаны пояснения-приписки («— из чего складывается доход», «как крутить»,
// подсказки-тултипы). В новелле их быть не должно — вся справка только в
// гайдбуке, по кнопке «?». Снимаем их после отрисовки, а не правим economy.js:
// одно место вместо трёх десятков, и кабинет админа остаётся как был.
function polStripTeach(host) {
  const content = host && host.querySelector('.pol-content');
  if (!content) return;
  content.querySelectorAll('.ec-hint,.ec-wf-legend,.ec-wl-what,.ec-wl-lever').forEach(e => e.remove());
  content.querySelectorAll('[data-tip]').forEach(e => e.removeAttribute('data-tip'));
}

// ── Главы раздела ──────────────────────────────────────────────
// Раздел не вываливается простынёй: он режется на главы и показывается по
// одной. Границы глав — уже существующие заголовки `.ec-section-title` (и свои
// блоки с data-chap), поэтому тела вкладок не переписываются и ничего не
// теряется: скрытые главы остаются в DOM живыми — обработчики, которые правят
// свои куски по id, продолжают работать.
function polChapterize(host, key) {
  const content = host && host.querySelector('.pol-content');
  if (!content) return;
  const chaps = [];
  let cur = { t: 'Главное', nodes: [] };
  [...content.childNodes].forEach(n => {
    const isEl = n.nodeType === 1;
    const bySec = isEl && n.classList.contains('ec-section-title');
    const byOwn = isEl && n.hasAttribute('data-chap');
    if (bySec || byOwn) {
      if (cur.nodes.length) chaps.push(cur);
      let t;
      if (byOwn) t = n.getAttribute('data-chap');
      else {
        const c = n.cloneNode(true);
        c.querySelectorAll('.ec-hint').forEach(e => e.remove());
        t = c.textContent.trim();
      }
      cur = { t: t || 'Раздел', nodes: [n] };
    } else cur.nodes.push(n);
  });
  if (cur.nodes.length) chaps.push(cur);
  // Пустые «Главное» (раздел начинается сразу с заголовка) не показываем.
  const real = chaps.filter(c => c.nodes.some(n => n.nodeType !== 3 || n.textContent.trim()));
  if (real.length < 2) return;

  if (!POL.chap) POL.chap = {};
  let idx = Math.min(POL.chap[key] | 0, real.length - 1);
  if (idx < 0) idx = 0;

  const bar = document.createElement('div');
  bar.className = 'pol-chaps';
  // ⚠️ ГЛАВЫ — ПОДПУНКТЫ РЕЛЬСЫ, А НЕ ВТОРАЯ ГОРИЗОНТАЛЬ. Раньше над телом
  // раздела ложилась своя лента вкладок («Престол · Совет · Канцелярия») — и
  // экран получал ДВА разных меню разной формы: колонка слева и полоса сверху,
  // а над ними ещё рельса ведомств кабинета. Три навигации трёх дизайнов на
  // одном экране. Теперь главы вкладываются В ту же колонку, под свой раздел:
  // одно меню, одна форма, вся глубина видна сразу.
  bar.innerHTML = real.map((c, i) =>
    `<button type="button" class="pol-chap${i === idx ? ' on' : ''}" data-i="${i}">${esc(polChapName(c.t))}</button>`).join('');

  const wrap = document.createElement('div');
  wrap.className = 'pol-chap-body';
  real.forEach((c, i) => {
    const box = document.createElement('div');
    box.className = 'pol-chap-pane';
    if (i !== idx) box.hidden = true;
    c.nodes.forEach(n => box.appendChild(n));
    wrap.appendChild(box);
  });
  content.innerHTML = '';
  // Куда лечь ленте глав. На мониторе — в рельсу, подпунктами под активным
  // разделом. На телефоне рельса свёрнута в одну строку и раскрывается тапом:
  // спрятать туда главы значит спрятать пол-экрана за жест, о котором никто не
  // догадается, — там лента остаётся над телом, как была.
  const narrow = window.matchMedia && window.matchMedia('(max-width:768px)').matches;
  const railOn = narrow ? null : host.querySelector('.pol-railw .pol-rail .pol-rail-b.on');
  if (railOn) {
    bar.classList.add('pol-chaps-sub');
    railOn.after(bar);
  } else {
    content.appendChild(bar);
  }
  content.appendChild(wrap);

  bar.addEventListener('click', e => {
    const b = e.target.closest('.pol-chap'); if (!b) return;
    e.stopPropagation();
    const i = +b.dataset.i;
    POL.chap[key] = i;
    bar.querySelectorAll('.pol-chap').forEach((x, k) => x.classList.toggle('on', k === i));
    [...wrap.children].forEach((x, k) => { x.hidden = k !== i; });
    const st = host.querySelector('.pol-body'); if (st) st.scrollTop = 0;
  });
}
// Заголовки вкладок несут значки и хвосты — для ленты глав режем до сути.
function polChapName(t) {
  return String(t || '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s*[—–-]\s.*$/, '').trim() || 'Раздел';
}

// ── Рельса разделов ────────────────────────────────────────────
// На мониторе рельса — колонка слева, все разделы видны сразу. На телефоне
// места на колонку нет, а горизонтальная лента врёт: игрок видит один-два
// пункта и не догадывается, что её можно крутить. Поэтому там рельса
// сворачивается в ОДНУ строку с текущим разделом и счётчиком «1 / 7» — по
// тапу она раскрывается сеткой, где видны все разделы разом. Разметку даём
// одну на оба случая, разводит их CSS (29_vn_mobile.css).
// ⚠️ БЕЙДЖ ЖИВЁТ ЗДЕСЬ, А НЕ В КАЖДОМ ЭКРАНЕ. Рельсу рисуют ВСЕ разделы работы —
// внутренняя политика, внешняя и все шесть ведомств хозяйства (estRefresh).
// Значит и «сколько тут ждёт» показывается в одном месте, одинаково: иначе
// девять экранов завели бы девять форм счётчика, как было с полосами вкладок.
// `dept` — ключ ведомства (CAB_DEPT), нужен, чтобы спросить у notify.js счёт
// именно этой вкладки (канал `ведомство.вкладка`). Не передали — рельса просто
// без цифр, как была.
function polRail(map, cur, fn, dept) {
  const ent = Object.entries(map);
  const i = Math.max(0, ent.findIndex(([k]) => k === cur));
  const d0 = (ent[i] || ent[0] || [null, { nm: '', scene: '' }])[1];
  const nOf = k => { try { return (dept && typeof ntTab === 'function') ? ntTab(dept, k) : 0; } catch (e) { return 0; } };
  // Свёрнутая рельса телефона показывает ТОЛЬКО текущий раздел — а дело может
  // ждать в любом другом. Поэтому на закрытой строке висит счёт по ОСТАЛЬНЫМ
  // разделам: иначе на телефоне бейджи не увидит никто.
  const rest = ent.reduce((s, [k]) => s + (k === cur ? 0 : nOf(k)), 0);
  const badge = (k, cls) => {
    const n = nOf(k);
    return `<span class="nt-badge pol-rail-nt ${cls || ''}${n ? '' : ' nt-off'}" data-nt="${dept ? dept + '.' + k : ''}">${n ? (typeof ntNum === 'function' ? ntNum(n) : n) : ''}</span>`;
  };
  return `<div class="pol-railw">
    <button class="pol-rail-cur" type="button" aria-expanded="false"
            onclick="event.stopPropagation();polRailToggle(this)">
      <span class="pol-rail-ic">${polGlyph(d0.scene)}</span>
      <span class="pol-rail-tx"><b>${esc(d0.nm)}</b></span>
      <span class="nt-badge pol-rail-nt${rest ? '' : ' nt-off'}" data-nt="${dept ? '~' + dept + ':' + cur : ''}">${rest ? (typeof ntNum === 'function' ? ntNum(rest) : rest) : ''}</span>
      <span class="pol-rail-n">${i + 1} / ${ent.length}</span>
      <span class="pol-rail-chev" aria-hidden="true">▾</span>
    </button>
    <nav class="pol-rail">${ent.map(([k, d]) =>
    `<button class="pol-rail-b${k === cur ? ' on' : ''}" type="button" onclick="event.stopPropagation();${fn}('${k}')">
       <span class="pol-rail-ic">${polGlyph(d.scene)}</span>
       <span class="pol-rail-tx"><b>${esc(d.nm)}</b></span>
       ${dept ? badge(k) : ''}
     </button>`).join('')}</nav>
  </div>`;
}
// Раскрыть/свернуть список разделов (только телефон — на мониторе кнопки нет).
function polRailToggle(btn) {
  const w = btn.closest('.pol-railw'); if (!w) return;
  const on = w.classList.toggle('open');
  btn.setAttribute('aria-expanded', on ? 'true' : 'false');
}

// ── Общий каркас экрана ────────────────────────────────────────
function polHead(title, backFn) {
  const en = (typeof lang !== 'undefined' && lang === 'en');
  return `<div class="hp-vn-col-head">
    <span class="hp-vn-col-title">${esc(title)}</span>
    <button class="hp-vn-col-x" type="button" onclick="event.stopPropagation();${backFn}()">↩ ${en ? 'back' : 'назад'}</button>
  </div>`;
}
function polMsg(title, backFn, text) {
  return polHead(title, backFn) + `<div class="hp-vn-col-body pol-body"><div class="hp-vn-col-empty">${esc(text)}</div></div>`;
}
// ⚠️ ТУПИК БЕЗ ВЫХОДА: сорванный заход писал «связь с канцелярией потеряна» и на
// этом всё — единственным лечением оставался F5. Теперь у любого срыва есть
// кнопка повтора прямо на экране: сбрасываем флаги загрузки (иначе повтор
// упрётся в тот же полупустой EC) и заходим заново.
// retryJs — готовый вызов открывашки экрана («polOpen()», «estOpen('army')»).
function polErr(title, backFn, text, retryJs, detail) {
  const d = detail ? `<div class="hp-vn-col-empty" style="font-size:11px;opacity:.55;max-width:420px">${esc(detail)}</div>` : '';
  return polHead(title, backFn) + `<div class="hp-vn-col-body pol-body">
    <div class="hp-vn-col-empty">${esc(text)}</div>${d}
    <div class="hp-vn-col-empty"><button class="btn btn-gd btn-sm" type="button"
      onclick="event.stopPropagation();polResetLoad();${retryJs}">↻ Повторить</button></div>
  </div>`;
}
// Повтор обязан начинаться с чистого листа: без сброса флагов ecEnsureData
// ответит «уже загружено» и экран откроется на том же полупустом EC.
function polResetLoad() {
  try { EC.coreLoaded = false; EC.restLoaded = false; EC._loadedFor = null; EC._restFor = null; } catch (e) {}
}

// Данные кабинета нужны всем разделам, кроме «Двора». Один общий загрузчик.
//
// ⚠️ РАНЬШЕ ЗДЕСЬ ЖДАЛИ ПОЛНЫЙ `ecLoad()` — и первый заход в любое ведомство висел
// на «поднимаю ведомости…» десятки секунд. Дело не в самих запросах: на первом
// заходе `vnEnsureData` параллельно пускает `economy_tick` (самая долгая ручка в
// игре), и все ~40 RPC полной загрузки встают в очередь за ним. После F5 троттл
// `ec_lasttick_*` тик пропускает — те же 40 запросов летят мгновенно, отсюда и
// «обновил страницу — сразу загрузилось».
// Лечим так же, как это давно делает кабинет: ждём ТОЛЬКО ядро (_ecLoadCore —
// казна, колонии, постройки, силы), а тяжёлые подсистемы вкладок догружаем фоном
// и перерисовываем открытый экран по готовности.
//
// ⚠️ И ВТОРАЯ ГРАБЛЯ, ИЗ-ЗА КОТОРОЙ РАЗДЕЛЫ ОТКРЫВАЛИСЬ ПУСТЫМИ ДО F5: условием
// загрузки было `if (!EC.eco)`. Но EC.eco к этому моменту уже лежит — его кладёт
// лёгкая выборка `vnEnsureData` ради строки ресурсов над сценой. Значит ядро НЕ
// грузилось вовсе: EC.factions пуст → «Нет других фракций» в границах и союзах,
// и фоновая догрузка (polLoadRest) тоже не запускалась. Теперь спрашиваем
// загрузчик напрямую — ecEnsureData знает, что и для какой державы загружено.
async function polEnsureData(el, title, backFn) {
  // Сначала дожидаемся авторизации (vnAppReady), иначе клик по двери через
  // секунду после загрузки страницы получал «державы нет» на пустой сессии.
  if (typeof vnAppReady === 'function') await vnAppReady();
  else if (typeof ecLoadApp === 'function') await ecLoadApp();
  if (typeof EC === 'undefined' || !EC.app || !EC.app.faction_id) {
    if (el.classList.contains('show')) {
      el.innerHTML = polMsg(title, backFn, 'Политика начинается с державы. Зарегистрируйте её — и здесь появится ваш двор.');
    }
    return false;
  }
  if (typeof ecEnsureData === 'function') await ecEnsureData(polPaintOpen);
  else if (!EC.eco && typeof ecLoad === 'function') await ecLoad();   // старый клиент без ecEnsureData
  return el.classList.contains('show');
}
// До-рисовать ТОТ экран, который игрок сейчас смотрит (зовётся, когда фоновая
// фаза 2 — биржа, вера, оборона, артиллерия — доехала).
function polPaintOpen() {
  try {
    if (typeof EST === 'object' && EST && EST.open && typeof estRefresh === 'function') estRefresh(EST.open);
    const p = document.getElementById('hp-vn-pol');
    if (p && p.classList.contains('show')) polRefresh();
    const d = document.getElementById('hp-vn-dip');
    if (d && d.classList.contains('show')) dipRefresh();
  } catch (e) {}
}
// Совместимость: подсистемы вкладок фоном (старые вызовы). Дедуп и флаги живут
// в ecEnsureData — здесь только тонкая обёртка.
function polLoadRest() {
  if (typeof ecEnsureData !== 'function') return Promise.resolve();
  return ecEnsureData(polPaintOpen);
}

// ═══════════════════════════════════════════════════════════════
// ⚖ ВНУТРЕННЯЯ ПОЛИТИКА
// ═══════════════════════════════════════════════════════════════
function polClose() {
  const el = document.getElementById('hp-vn-pol');
  if (!el) return;
  el.classList.remove('show'); el.setAttribute('aria-hidden', 'true'); el.innerHTML = '';
  if (typeof _heroVNView !== 'undefined' && _heroVNView === 'ipol') _heroVNView = null;
}
function polReturn() { if (typeof heroVNBack === 'function') heroVNBack('ipol'); }
function polSet(tab) { POL.tab = tab; polRefresh(); const b = document.querySelector('#hp-vn-pol .pol-body'); if (b) b.scrollTop = 0; }

async function polOpen() {
  const el = document.getElementById('hp-vn-pol');
  if (!el) return;
  el.classList.add('show'); el.setAttribute('aria-hidden', 'false');
  el.innerHTML = polMsg('Внутренняя политика', 'polReturn', 'Собираю двор…');
  try {
    if (!(await polEnsureData(el, 'Внутренняя политика', 'polReturn'))) return;
    if (typeof fmLoadMe === 'function') await fmLoadMe();
    if (typeof fmLoadCourt === 'function') await fmLoadCourt();
    if (!el.classList.contains('show')) return;
    polRefresh();
  } catch (e) {
    console.error('[politics]', e);
    if (el.classList.contains('show')) {
      el.innerHTML = polErr('Внутренняя политика', 'polReturn', 'Двор молчит — связь с канцелярией потеряна.',
        'polOpen()', (e && e.message) || '');
    }
  }
}

function polRefresh() {
  const el = document.getElementById('hp-vn-pol');
  if (!el || !el.classList.contains('show')) return;
  const def = POL_SEC[POL.tab] || POL_SEC.court;
  try { if (typeof ntSeenTab === 'function') ntSeenTab('ipol', POL.tab); } catch (e) {}
  const prev = el.querySelector('.pol-body');
  const keep = prev ? prev.scrollTop : 0;
  let body;
  POL.chrome = true;                       // тела вкладок не рисуют свой ec-intro
  try { body = polSectionBody(POL.tab); }
  catch (e) { console.error('[politics]', e); body = `<div class="hp-vn-col-empty">Сбой отрисовки раздела: ${esc(e && e.message || String(e))}</div>`; }
  finally { POL.chrome = false; }
  el.innerHTML = polHead('Внутренняя политика', 'polReturn') +
    `<div class="hp-vn-col-body pol-shell">
       ${polRail(POL_SEC, POL.tab, 'polSet', 'ipol')}
       <div class="pol-stage pol-body">
         ${polPrologue(POL.tab, def)}
         <div class="pol-content">${body}</div>
       </div>
     </div>`;
  polStripTeach(el);
  polChapterize(el, (el.id === 'hp-vn-dip' ? 'd:' : 'i:') + (el.id === 'hp-vn-dip' ? POL.dtab : POL.tab));
  const b = el.querySelector('.pol-body'); if (b && keep) b.scrollTop = keep;
}

function polSectionBody(tab) {
  if (tab === 'court')   return polCourtBody();
  if (tab === 'welfare') return typeof ecTabWelfare === 'function' ? ecTabWelfare() : '';
  if (tab === 'policy')  return typeof ecTabPolicy  === 'function' ? ecTabPolicy()  : '';
  if (tab === 'faith')   return typeof ecTabFaith   === 'function' ? ecTabFaith()   : '';
  return '';
}

// ── Двор: сначала престол, потом уже состав ────────────────────
// Главу государства «регистрируют» ровно так же, как любого персонажа: сервер
// (_ch_of_user в _char_office.sql) сам считает главой персонажа ВЛАДЕЛЬЦА анкеты.
// Раньше об этом негде было узнать — мастер поднимался только со страницы
// «Поступить на службу», куда владельцу хода нет. Теперь вход есть здесь.
function polThroneBlock() {
  const me = (typeof FM === 'object' && FM.me) || null;
  const off = (typeof FM === 'object' && FM.office) || null;
  if (!me || !me.is_owner) return '';
  const ch = off && off.character;
  if (ch) {
    return `<div class="pol-throne on">
      <div class="pol-throne-ic">${fmFace(ch.slug, ch.name, 'fm-face--lg')}</div>
      <div class="pol-throne-tx">
        <b>Глава государства — <a href="#${esc(ch.slug)}" onclick="go('${esc(ch.slug)}');return false">${esc(ch.name)}</a></b>
        <span>Вакантные посты совета он закрывает вполсилы. Раздайте должности ко двору — посты начнут давать
        полный вклад в доход, добычу и цены.</span>
      </div>
      <span class="pol-throne-lvl">ур. ${+ch.lvl || 1}</span>
    </div>`;
  }
  return `<div class="pol-throne">
    <div class="pol-throne-ic pol-throne-empty">${polGlyph("crown")}</div>
    <div class="pol-throne-tx">
      <b>Престол пуст</b>
      <span>У державы нет действующего персонажа-правителя. Пока его нет, вакантные посты совета не дают ничего,
      опыт за действия от имени державы не капает, характеристики не идут в экономику.
      Главой сервер считает персонажа владельца анкеты — назначать себя не нужно, достаточно его завести.</span>
    </div>
    <button class="btn btn-gd btn-sm" onclick="event.stopPropagation();polCrownMe()">Взойти на престол</button>
  </div>`;
}
// Мастер создания персонажа с приклеенной СВОЕЙ державой — тот же, что у службы.
function polCrownMe() {
  if (typeof openCharRegister !== 'function') { toast('Модуль персонажей не загружен', 'err'); return; }
  const name = (typeof EC === 'object' && EC.app && EC.app.name) || '';
  openCharRegister({
    faction: name,
    lockFaction: true,
    title: 'ГЛАВА ГОСУДАРСТВА',
    onDone: async () => {
      if (typeof fmLoadOffice === 'function') await fmLoadOffice(true);
      if (typeof fmLoadCourt === 'function') await fmLoadCourt(true);
      toast('♛ Держава обрела правителя', 'ok');
      polRefresh();
    },
    onCancel: () => polRefresh(),
  });
}

// ── «Двор» — своя вёрстка, не перенесённая вкладка ─────────────
// Три плана: престол → совет (места за столом) → канцелярия (заявки и состав).
// Данные и все действия — из faction_members.js; здесь только подача.
function polCourtBody() {
  if (typeof FM !== 'object') return '<div class="hp-vn-col-empty">Модуль двора не загружен.</div>';
  if (typeof fmLoadCourt === 'function' && !FM.list) { fmLoadCourt().then(() => polRefresh()); }
  if (!FM.list) return `<div class="sload"><div class="pulse-loader"></div></div>`;
  // Главы «Двора» размечены явно: у моей вёрстки нет .ec-section-title.
  return `<div data-chap="Престол" id="fm-court-host">${polThroneBlock()}${polOfficeCard()}</div>
    <div data-chap="Совет">${polCouncilTable()}</div>
    <div data-chap="Канцелярия">${polChancery()}</div>`;
}

// Моя должность: кольцо уровня + характеристики шкалами, очки вкладываются тут же.
function polOfficeCard() {
  const o = FM.office; if (!o || o.anon) return '';
  const ch = o.character; if (!ch) return '';
  const prev = 20 * Math.pow(ch.lvl - 1, 2);
  const pct = ch.lvl >= 20 ? 100 : Math.max(0, Math.min(100, Math.round((ch.xp - prev) / Math.max(1, ch.next_xp - prev) * 100)));
  const title = o.is_head ? 'Глава государства'
    : ((FM.me && FM.me.membership && FM.me.membership.role_title) || 'на службе');
  // Характеристика — не абстрактное число: подписываем, какой пост её читает.
  const stats = Object.keys(FM_STAT_RU).map(k => {
    const v = (ch.stats || {})[k] || 10, mod = Math.floor((v - 10) / 2);
    const can = ch.points > 0 && v < 20;
    const w = Math.max(4, Math.min(100, Math.round((v / 20) * 100)));
    const posts = FM_STAT_RU[k][1];
    return `<div class="pol-stat${v >= 12 ? ' live' : ''}">
      <div class="pol-stat-top">
        <span class="pol-stat-k">${esc(FM_STAT_RU[k][0])}</span>
        <span class="pol-stat-v">${v}<em>${mod >= 0 ? '+' : ''}${mod}</em></span>
        <button class="pol-stat-add" ${can ? '' : 'disabled'}
          title="${can ? 'Вложить очко' : 'Свободных очков нет'}"
          onclick="event.stopPropagation();chSpend('${k}')">+</button>
      </div>
      <span class="pol-stat-bar"><i style="width:${w}%"></i></span>
      <span class="pol-stat-for">${posts === '—'
        ? 'ни один пост не читает'
        : (v >= 12 ? 'работает на посту: ' : 'нужно 12 для поста: ') + esc(posts)}</span>
    </div>`;
  }).join('');
  return `<section class="pol-card pol-office">
    <div class="pol-office-hd">
      ${fmFace(ch.slug, ch.name, 'fm-face--lg')}
      <span class="pol-ring" style="--p:${pct}"><b>${ch.lvl}</b><i>ур.</i></span>
      <span class="pol-office-id">
        <a href="#${esc(ch.slug)}" onclick="go('${esc(ch.slug)}');return false">${esc(ch.name)}</a>
        <i>${esc(title)}</i>
      </span>
      <span class="pol-office-xp">${ch.lvl >= 20 ? 'потолок уровня' : `${ch.xp} / ${ch.next_xp} опыта`}<em>сегодня ${ch.today_xp} из 150</em></span>
    </div>
    <div class="pol-stats">${stats}</div>
    <div class="pol-note">Свободных очков: <b>${ch.points}</b></div>
  </section>`;
}

// Совет: посты как места за столом. Пустое место видно сразу.
function polCouncilTable() {
  const c = FM.council; if (!c) return '';
  const posts = c.posts || [], mods = c.mods || {}, war = c.war || {};
  const total = Object.keys(FM_MOD_RU).map(k => fmModStr(k, mods[k])).filter(Boolean).join('')
              + Object.keys(FM_WAR_RU).map(k => fmModStr(k, war[k], FM_WAR_RU)).filter(Boolean).join('');
  const seats = posts.map(p => {
    const gain = Object.keys(FM_MOD_RU).map(k => fmModStr(k, (p.mods || {})[k])).filter(Boolean).join('')
               + Object.keys(FM_WAR_RU).map(k => fmModStr(k, (p.war || {})[k], FM_WAR_RU)).filter(Boolean).join('');
    const vacant = !!p.head;             // пост держит правитель — вполсилы
    const statNm = esc((FM_STAT_RU[p.stat] || [p.stat])[0]);
    const weak = p.stat_val < 12;
    // Чью характеристику читает пост — видно в лицо, иначе цифра ничья.
    const who = p.char_name || '—';
    return `<div class="pol-seat${vacant ? ' vacant' : ''}${weak ? ' weak' : ''}">
      <div class="pol-seat-hd">
        <b>${esc(p.title)}</b>
        ${vacant ? '<span class="pol-seat-who"><i>вакансия</i></span>' : ''}
      </div>
      ${vacant
        // Правителя не тиражируем восемь раз — про него сказано над столом.
        ? `<div class="pol-seat-man pol-seat-man--vac"><i>держит правитель · вполсилы</i></div>`
        : `<div class="pol-seat-man">
            ${fmFace(p.char_slug, who)}
            <span class="pol-seat-man-tx">
              ${p.char_slug
                ? `<a href="#${esc(p.char_slug)}" onclick="go('${esc(p.char_slug)}');return false">${esc(who)}</a>`
                : `<b class="pol-mute">некому занять</b>`}
              <i>назначен ко двору</i>
            </span>
          </div>`}
      <div class="pol-seat-meta">
        <span class="pol-tag${weak ? ' warn' : ' good'}">${statNm} ${p.stat_val}</span>
        <span class="pol-tag">ур. ${p.lvl}</span>
        ${p.coverage < 1 ? `<span class="pol-tag warn">зона ${Math.round(p.coverage * 100)}%</span>` : ''}
      </div>
      <div class="pol-seat-gain">${gain || '<span class="pol-mute">характеристика ниже 12 — вклада нет</span>'}</div>
    </div>`;
  }).join('');
  return `<section class="pol-card">
    <h3 class="pol-h">Совет державы${total ? `<span class="pol-h-sum">${total}</span>` : ''}${typeof gbHelpBtn === 'function' ? gbHelpBtn('council') : ''}</h3>
    ${(() => {
      // Все вакансии закрывает правитель — говорим это один раз, а не на каждой карточке.
      const vac = posts.filter(p => p.head);
      const head = vac[0];
      if (!head) return '';
      return `<div class="pol-regent">
        ${fmFace(head.char_slug, head.char_name)}
        <span class="pol-regent-tx">
          <b>${esc(head.char_name || '—')}</b> закрывает вакансии совета — ${vac.length} из ${posts.length}
          <i>Пост, который держит правитель, даёт половину вклада. Назначьте людей ко двору — вклад станет полным.</i>
        </span>
      </div>`;
    })()}
    ${posts.length ? `<div class="pol-seats">${seats}</div>`
      : '<div class="pol-empty">Совета нет: ни у вас, ни у служащих нет действующего персонажа.</div>'}
  </section>`;
}

// Канцелярия: заявки и состав. Карточки те же по смыслу, но собраны заново.
function polChancery() {
  if (!FM.me || !FM.me.is_owner) return '';
  const pend = FM.list.filter(m => m.status === 'pending');
  const act  = FM.list.filter(m => m.status === 'active');
  return `<section class="pol-card">
    <h3 class="pol-h">Заявки${pend.length ? `<span class="pol-h-n">${pend.length}</span>` : ''}</h3>
    ${pend.length ? pend.map(m => fmCardHtml(m, true)).join('')
      : '<div class="pol-empty">Прошений нет.</div>'}
    <h3 class="pol-h">Состав${act.length ? `<span class="pol-h-n">${act.length}</span>` : ''}</h3>
    ${act.length ? act.map(m => fmCardHtml(m, false)).join('')
      : '<div class="pol-empty">Пока никто не служит вашей державе.</div>'}
  </section>`;
}

// Действия двора зовут fmRenderCourt(); на экране политики перерисовываем весь
// раздел, иначе престол/совет остались бы со старыми цифрами.
if (typeof fmRenderCourt === 'function') {
  const _fmRenderCourtRaw = fmRenderCourt;
  window.fmRenderCourt = function () {
    const pol = document.getElementById('hp-vn-pol');
    if (pol && pol.classList.contains('show') && POL.tab === 'court') { polRefresh(); return; }
    return _fmRenderCourtRaw.apply(this, arguments);
  };
}

// ═══════════════════════════════════════════════════════════════
// 🕊 ВНЕШНЯЯ ПОЛИТИКА
// ═══════════════════════════════════════════════════════════════
function dipClose() {
  const el = document.getElementById('hp-vn-dip');
  if (!el) return;
  el.classList.remove('show'); el.setAttribute('aria-hidden', 'true'); el.innerHTML = '';
  if (typeof _heroVNView !== 'undefined' && _heroVNView === 'dipl') _heroVNView = null;
}
function dipReturn() { if (typeof heroVNBack === 'function') heroVNBack('dipl'); }
function dipSet(tab) { POL.dtab = tab; dipRefresh(); const b = document.querySelector('#hp-vn-dip .pol-body'); if (b) b.scrollTop = 0; }

// Тела разделов внешней политики — блоки economy.js поимённо, а не вкладка
// целиком: рельса уже разложила разговоры по местам, дублировать заголовки
// «Границы»/«Кредиты» внутри их же раздела незачем.
function dipSectionBody(tab) {
  const F = n => (typeof window[n] === 'function' ? window[n]() : '');
  if (tab === 'borders')   return `<div class="ec-dip-grid">${F('ecBordersBlock')}</div>`;
  if (tab === 'war')       return F('ecTabWar');
  if (tab === 'alliance')  return F('ecAllianceBlock');
  if (tab === 'relations') return F('ecRelationsBlock');
  if (tab === 'patron')    return `<div class="ec-dip-grid">${F('ecPatronBlock')}</div>`;
  if (tab === 'loans')     return `<div class="ec-dip-grid">${F('ecLoansBlock')}</div>`;
  if (tab === 'outposts')  return F('ecTabOutposts');
  return '';
}

async function dipOpen() {
  const el = document.getElementById('hp-vn-dip');
  if (!el) return;
  el.classList.add('show'); el.setAttribute('aria-hidden', 'false');
  el.innerHTML = polMsg('Внешняя политика', 'dipReturn', 'Собираю посольский стол…');
  try {
    if (!(await polEnsureData(el, 'Внешняя политика', 'dipReturn'))) return;
    if (!el.classList.contains('show')) return;
    dipRefresh();
  } catch (e) {
    console.error('[politics]', e);
    if (el.classList.contains('show')) {
      el.innerHTML = polErr('Внешняя политика', 'dipReturn', 'Посольский канал сорван.',
        'dipOpen()', (e && e.message) || '');
    }
  }
}

function dipRefresh() {
  const el = document.getElementById('hp-vn-dip');
  if (!el || !el.classList.contains('show')) return;
  const def = POL_DSEC[POL.dtab] || POL_DSEC.relations;
  try { if (typeof ntSeenTab === 'function') ntSeenTab('dipl', POL.dtab); } catch (e) {}
  const prev = el.querySelector('.pol-body');
  const keep = prev ? prev.scrollTop : 0;
  let body;
  POL.chrome = true;
  try { body = dipSectionBody(POL.dtab); }
  catch (e) { console.error('[diplomacy]', e); body = `<div class="hp-vn-col-empty">Сбой отрисовки раздела: ${esc(e && e.message || String(e))}</div>`; }
  finally { POL.chrome = false; }
  el.innerHTML = polHead('Внешняя политика', 'dipReturn') +
    `<div class="hp-vn-col-body pol-shell">
       ${polRail(POL_DSEC, POL.dtab, 'dipSet', 'dipl')}
       <div class="pol-stage pol-body">
         ${polPrologue(POL.dtab, def)}
         <div class="pol-content">${body}</div>
       </div>
     </div>`;
  polStripTeach(el);
  polChapterize(el, (el.id === 'hp-vn-dip' ? 'd:' : 'i:') + (el.id === 'hp-vn-dip' ? POL.dtab : POL.tab));
  const b = el.querySelector('.pol-body'); if (b && keep) b.scrollTop = keep;
}
