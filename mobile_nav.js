// © 2025–2026. Все права защищены.
// ═══════════════════════════════════════════════════════════════
// НАВИГАЦИЯ КАБИНЕТА НА ТЕЛЕФОНЕ — СОБРАНА ЗАНОВО.
//
// ⚠️ ПОЧЕМУ ЗАНОВО, А НЕ «ПОДЖАТЬ ОТСТУПЫ». На мониторе кабинет читается: рельса
// ведомств строкой сверху, рельса разделов колонкой у правого борта, главы —
// подпунктами под разделом. Три уровня видны разом, каждый переход — один клик.
// На телефоне ровно та же разметка складывалась в кашу:
//   • рельса ведомств (полтора десятка названий) ПЕРЕНОСИЛАСЬ на 5-6 строк и
//     занимала пол-экрана прежде, чем игрок доходил до первой цифры;
//   • рельса разделов сворачивалась в строку «Двор 1 / 7», которая раскрывалась
//     сеткой ещё на треть экрана — то есть меню поверх меню;
//   • у экранов без своей рельсы (разведка, Длань, исследования, войска) полосы
//     вкладок оставались как есть — своей формы, своего размера, четвёртым
//     этажом навигации;
//   • тап-мишени 12px текста без полей: попасть пальцем в «Внутренняя политика»
//     между «Приёмной» и «Статистикой» — лотерея.
// Ужимать это дальше некуда: проблема не в размерах, а в том, что вся навигация
// пытается быть ВИДИМОЙ ОДНОВРЕМЕННО. На телефоне так не делают.
//
// КАК СДЕЛАНО. Телефонный стандарт: навигация уезжает вниз, под большой палец, и
// раскрывается листами.
//   1) НИЖНЯЯ ПАНЕЛЬ (#mnav) — четыре мишени по 54px: «Меню» (борт сайта),
//      «Приёмная», текущее ВЕДОМСТВО, текущий РАЗДЕЛ. Панель же и хлебные крошки:
//      подписи двух правых кнопок показывают, где игрок стоит.
//   2) ЛИСТЫ (#mnav-sheet) — по тапу снизу поднимается список: ведомства по
//      группам уклада (как в приёмной) или разделы текущего ведомства. Виден весь
//      список сразу, строками по 52px, активный помечен полосой-акцентом.
//
// ⚠️ ЛИСТ РАЗДЕЛОВ НИЧЕГО НЕ ЗНАЕТ ПРО ЭКРАНЫ. Экранов полтора десятка, и каждый
// рисует своё меню своей разметкой (`.pol-rail`, `.ec-tabs`, `.ec-fb-tabs`,
// `.hp-vnt-rail`, `.hp-vni-tabs`…). Описывать их по одному — полтора десятка мест,
// где завтра разъедется. Поэтому лист работает ЗЕРКАЛОМ: находит живую полосу в
// открытом экране, перерисовывает её строками у себя, а по тапу зовёт `.click()`
// на ИСХОДНОЙ кнопке. Обработчики, состояние, порядок — всё остаётся на месте,
// экраны не тронуты. Та же мысль, что у `cabRailify` на мониторе (cabinet.js),
// только там полоса переезжает в колонку, а здесь — отражается в лист.
//
// ⚠️ ПАНЕЛЬ ЖИВЁТ В <body>, А НЕ В СТРАНИЦЕ. iOS Safari отсчитывает
// `position:fixed` не от вьюпорта, а от прокручиваемого предка — им был бы #cw,
// и панель уезжала бы вверх вместе с прокруткой (ровно этим болела кнопка
// «назад», см. `_vnBackFabSync` в render.js). В <body> она вне всех скроллеров.
// ═══════════════════════════════════════════════════════════════

const MNAV = {
  ready: false,      // разметка создана
  sheet: null,       // какой лист открыт: 'dept' | 'sect' | null
  pick: [],          // исходные кнопки экрана под строками листа разделов
  _lbl: {},          // последние подписи кнопок — чтобы не трогать DOM вхолостую
  _marked: [],       // полосы, спрятанные в пользу листа (метка data-mnav)
};

// ⚠️ ПОРОГ ТОТ ЖЕ, ЧТО У `_cabWide()` В cabinet.js, И ЭТО ОБЯЗАТЕЛЬНО. Мобильная
// вёрстка новеллы берёт шире (плюс `(pointer:coarse) and (max-width:1024px)`), но
// здесь такой захват столкнул бы лбами две перестановки: на тач-планшете в 900px
// `cabRailify` уже переставил бы полосы вкладок в колонку — а панель спрятала бы
// их как «отражённые в лист», и от колонки остался бы пустой борт. Одна ширина —
// одна навигация: до 768px работает панель, выше — рельсы монитора.
const MNAV_MQ = '(max-width:768px)';
function mnavPhone() {
  try { return window.matchMedia(MNAV_MQ).matches; } catch (e) { return false; }
}

// ── Глифы панели ───────────────────────────────────────────────
// Эмодзи в интерфейсе не используем (у каждой ОС свой рисунок и он не красится
// в цвет державы) — рисуем той же линией, что глифы разделов, 24×24.
function mnavGl(kind) {
  const G = {
    menu:  '<path d="M4 7h16M4 12h16M4 17h16"/>',
    hall:  '<path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9.5 21v-6h5v6"/>',
    depts: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    list:  '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    back:  '<path d="M15 5l-7 7 7 7"/>',
    x:     '<path d="M6 6l12 12M18 6L6 18"/>',
  }[kind] || '';
  return `<svg class="mnav-gl" viewBox="0 0 24 24" aria-hidden="true">${G}</svg>`;
}
// Глиф ведомства берём у политики (там же, где его берут двери приёмной).
function mnavDeptGl(k) {
  try { return (typeof polGlyph === 'function') ? polGlyph(k) : ''; } catch (e) { return ''; }
}

// ── Где мы стоим ───────────────────────────────────────────────
function mnavStage() { return document.getElementById('cab-stage'); }
function mnavScreen() {
  const st = mnavStage(); if (!st) return null;
  return st.querySelector(':scope > .show');
}
function mnavDept() {
  try { return (typeof CAB === 'object' && CAB) ? CAB.dept : null; } catch (e) { return null; }
}
function mnavDeptDef(k) {
  try { return (typeof CAB_DEPT === 'object' && CAB_DEPT && k) ? CAB_DEPT[k] : null; } catch (e) { return null; }
}

// ── Полосы навигации экрана ────────────────────────────────────
// Порядок = порядок в листе: сперва разделы ведомства, потом полосы вкладок.
// Подпись группы — чтобы в листе было видно, где кончается один уровень.
const MNAV_STRIPS = [
  ['.pol-railw .pol-rail', 'Разделы'],
  ['.hp-vnt-rail',         'Направления'],
  ['.hp-vni-tabs',         'Вкладки'],
  ['.hp-vnd-tabs',         'Вкладки'],
  ['.hp-vnr-tabs',         'Вкладки'],
  ['.ec-fb-tabs',          'Рода войск'],
  ['.ec-tabs',             'Вкладки'],
];

// Пункты полосы. Экраны писались порознь: где-то кнопки, где-то ссылки, где-то
// див с onclick — берём всё, что кликается и что-то говорит.
function mnavItems(strip) {
  if (!strip) return [];
  return [...strip.children].filter(el =>
    el.nodeType === 1 &&
    (el.tagName === 'BUTTON' || el.tagName === 'A' || el.hasAttribute('onclick') || el.onclick) &&
    el.textContent.trim());
}

// Подпись пункта: без глифа, без счётчика и без полоски прогресса — их лист
// рисует сам, своими местами.
const MNAV_TAIL = '.ec-fb-tab-n,.hp-vnt-cat-n,.cab-door-n,.pol-rail-n';
function mnavItemTx(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('svg,img,' + MNAV_TAIL + ',.hp-vnt-cat-bar').forEach(n => n.remove());
  return c.textContent.replace(/\s+/g, ' ').trim();
}
function mnavItemTail(el) {
  const t = el.querySelector(MNAV_TAIL);
  return t ? t.textContent.replace(/\s+/g, ' ').trim() : '';
}
function mnavItemIc(el) {
  const s = el.querySelector('svg,img');
  return s ? s.outerHTML : '';
}

// ⚠️ ПОМЕЧАЕМ ПОЛОСЫ, А НЕ ПРЯЧЕМ ИХ СПИСКОМ В CSS. `.ec-tabs` встречается и
// внутри тел разделов (местные «потоки», «фильтры») — спрятать их все значит
// отобрать у игрока навигацию, которой в листе нет. Поэтому метку `data-mnav`
// получает ровно та полоса, которую лист отразил у себя, и прячется по метке.
function mnavMark(screen) {
  const now = [];
  if (screen) MNAV_STRIPS.forEach(([sel, label]) => {
    const strip = screen.querySelector(sel);
    if (!strip || mnavItems(strip).length < 2) return;
    if (strip.dataset.mnav !== '1') strip.dataset.mnav = '1';
    if (strip.dataset.mnavT !== label) strip.dataset.mnavT = label;
    now.push(strip);
    // У рельсы разделов прячется весь короб: в нём ещё строка «Двор 1 / 7».
    const w = strip.closest('.pol-railw');
    if (w) { if (w.dataset.mnav !== 'w') w.dataset.mnav = 'w'; now.push(w); }
  });
  // Метки с прошлой отрисовки, которым больше нечего прятать. Помеченное
  // помним списком, а не ищем по документу: sync зовётся на каждый вздох
  // разметки, а разметка кабинета — тысячи узлов.
  (MNAV._marked || []).forEach(el => {
    if (now.indexOf(el) >= 0) return;
    delete el.dataset.mnav; delete el.dataset.mnavT;
  });
  MNAV._marked = now;
}
function mnavUnmarkAll() {
  (MNAV._marked || []).forEach(el => { delete el.dataset.mnav; delete el.dataset.mnavT; });
  MNAV._marked = [];
}

// Название текущего раздела — оно же подпись правой кнопки панели.
function mnavCurSect(screen) {
  if (!screen) return '';
  const strip = screen.querySelector('[data-mnav="1"]');
  if (!strip) return '';
  const on = mnavItems(strip).find(el => el.classList.contains('on'));
  return on ? mnavItemTx(on) : '';
}

// ═══════════════════════════════════════════════════════════════
// РАЗМЕТКА
// ═══════════════════════════════════════════════════════════════
function mnavBuild() {
  if (MNAV.ready || document.getElementById('mnav')) { MNAV.ready = true; return; }
  const bar = document.createElement('nav');
  bar.id = 'mnav';
  bar.setAttribute('aria-label', 'Навигация державы');
  bar.innerHTML = `
    <button class="mnav-b" type="button" data-a="menu">
      <span class="mnav-ic">${mnavGl('menu')}</span><span class="mnav-t" data-t="menu">Меню</span>
    </button>
    <button class="mnav-b" type="button" data-a="home">
      <span class="mnav-ic">${mnavGl('hall')}</span><span class="mnav-t" data-t="home">Приёмная</span>
    </button>
    <button class="mnav-b" type="button" data-a="dept">
      <span class="mnav-ic">${mnavGl('depts')}</span><span class="mnav-t" data-t="dept">Ведомства</span>
    </button>
    <button class="mnav-b" type="button" data-a="sect">
      <span class="mnav-ic">${mnavGl('list')}</span><span class="mnav-t" data-t="sect">Разделы</span>
    </button>`;

  const sheet = document.createElement('div');
  sheet.id = 'mnav-sheet';
  sheet.hidden = true;
  sheet.innerHTML = `
    <div class="mn-ov" data-a="close"></div>
    <div class="mn-panel" role="dialog" aria-modal="true" aria-label="Навигация">
      <div class="mn-hd">
        <h2 id="mn-title">Ведомства</h2>
        <button class="mn-x" type="button" data-a="close" aria-label="Закрыть">${mnavGl('x')}</button>
      </div>
      <div class="mn-body" id="mn-body"></div>
    </div>`;

  document.body.appendChild(bar);
  document.body.appendChild(sheet);
  bar.addEventListener('click', mnavClick);
  sheet.addEventListener('click', mnavClick);
  MNAV.ready = true;
}

// Строка листа. Одна форма на все уровни: глиф · имя (+пояснение) · хвост.
function mnavRow(act, ic, nm, sub, tail, on) {
  return `<button class="mn-row${on ? ' on' : ''}" type="button" data-a="${esc(act)}">
    <span class="mn-row-ic">${ic || ''}</span>
    <span class="mn-row-tx"><b>${esc(nm)}</b>${sub ? `<i>${esc(sub)}</i>` : ''}</span>
    ${tail ? `<span class="mn-row-n">${esc(tail)}</span>` : ''}
  </button>`;
}

// ── Лист ведомств: те же группы уклада, что в дверях приёмной ──
function mnavDeptBody() {
  const depts = (typeof cabDepts === 'function') ? cabDepts() : {};
  const groups = (typeof CAB_GRP !== 'undefined') ? CAB_GRP : [];
  const cur = mnavDept();
  let inbox = 0;
  try { inbox = (typeof FM === 'object' && FM.me && FM.me.is_owner && !EC.actAs) ? (+FM.me.inbox || 0) : 0; } catch (e) {}

  let html = `<div class="mn-grp">
    ${mnavRow('go:home', mnavGl('hall'), 'Приёмная', 'сводка сектора и все двери', '', !cur)}
  </div>`;

  groups.forEach(([g, label]) => {
    const items = Object.entries(depts).filter(([, d]) => d.grp === g);
    if (!items.length) return;
    html += `<div class="mn-grp"><h3 class="mn-grp-hd">${esc(label)}</h3>` +
      items.map(([k, d]) => mnavRow('dept:' + k, mnavDeptGl(d.ic), d.nm, d.sub,
        (k === 'ipol' && inbox) ? String(inbox) : '', k === cur)).join('') + '</div>';
  });

  // Выход из работы — внизу листа, а не только на обложке кабинета: из
  // глубокого ведомства до неё пришлось бы прокручивать весь экран назад.
  html += `<div class="mn-grp mn-grp-foot">
    ${mnavRow('site:home', mnavGl('back'), 'На главную', 'сцена, новости, забавы', '', false)}
  </div>`;
  return html;
}

// ── Лист разделов: зеркало живых полос открытого экрана ────────
function mnavSectBody() {
  const screen = mnavScreen();
  const strips = screen ? [...screen.querySelectorAll('[data-mnav="1"]')] : [];
  MNAV.pick = [];
  if (!strips.length) {
    return `<div class="mn-empty">У этого ведомства один экран — разделов нет.</div>`;
  }
  return strips.map(strip => {
    const rows = mnavItems(strip).map(el => {
      const i = MNAV.pick.push(el) - 1;
      return mnavRow('pick:' + i, mnavItemIc(el), mnavItemTx(el), '', mnavItemTail(el),
        el.classList.contains('on'));
    }).join('');
    const hd = strip.dataset.mnavT || 'Разделы';
    return `<div class="mn-grp"><h3 class="mn-grp-hd">${esc(hd)}</h3>${rows}</div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// ОТКРЫТЬ / ЗАКРЫТЬ ЛИСТ
// ═══════════════════════════════════════════════════════════════
function mnavOpen(kind) {
  mnavBuild();
  const sheet = document.getElementById('mnav-sheet');
  const body = document.getElementById('mn-body');
  const title = document.getElementById('mn-title');
  if (!sheet || !body) return;
  MNAV.sheet = kind;
  title.textContent = (kind === 'dept') ? 'Ведомства державы' : 'Разделы ведомства';
  body.innerHTML = (kind === 'dept') ? mnavDeptBody() : mnavSectBody();
  sheet.hidden = false;
  document.documentElement.classList.add('mnav-sheet');
  // Список открывается на текущем пункте, а не с начала: в длинном списке
  // ведомств активное иначе оказывается за краем.
  requestAnimationFrame(() => {
    const on = body.querySelector('.mn-row.on');
    if (on && on.offsetTop > body.clientHeight * 0.7) body.scrollTop = on.offsetTop - body.clientHeight / 2;
  });
}

function mnavClose() {
  const sheet = document.getElementById('mnav-sheet');
  MNAV.sheet = null;
  document.documentElement.classList.remove('mnav-sheet');
  if (sheet) sheet.hidden = true;
}

// Прокрутка к телу ведомства: после смены раздела читать начинают с его начала,
// а не с той высоты, до которой доскроллили предыдущий.
function mnavScrollTop() {
  requestAnimationFrame(() => {
    try {
      const st = mnavStage();
      const cw = document.getElementById('cw');
      if (st && cw) cw.scrollTop = Math.max(0, st.offsetTop - 8);
      else if (cw) cw.scrollTop = 0;
    } catch (e) {}
  });
}

// ── Один обработчик на панель и лист ───────────────────────────
function mnavClick(e) {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a || '';
  e.preventDefault();
  e.stopPropagation();

  if (a === 'close') { mnavClose(); return; }
  if (a === 'menu') { mnavClose(); if (typeof openMobSb === 'function') openMobSb(); return; }
  if (a === 'home' || a === 'go:home') {
    mnavClose();
    if (typeof cabBack === 'function') cabBack();
    // В приёмной читают сверху — с казны и стола, а не со сцены ведомств,
    // которая в ней пуста и стоит последней.
    try { const cw = document.getElementById('cw'); if (cw) cw.scrollTop = 0; } catch (err) {}
    return;
  }
  if (a === 'site:home') { mnavClose(); if (typeof go === 'function') go('home'); return; }
  if (a === 'dept') { mnavOpen('dept'); return; }
  if (a === 'sect') { mnavOpen('sect'); return; }

  if (a.indexOf('dept:') === 0) {
    mnavClose();
    if (typeof cabOpen === 'function') cabOpen(a.slice(5));
    mnavScrollTop();
    return;
  }
  if (a.indexOf('pick:') === 0) {
    const el = MNAV.pick[+a.slice(5)];
    mnavClose();
    // Зовём ИСХОДНУЮ кнопку экрана: её onclick, её порядок, её состояние.
    // Спрятанная кнопка на программный click отвечает как обычная.
    if (el) { try { el.click(); } catch (err) { console.error('[mnav]', err); } }
    mnavScrollTop();
    return;
  }
}

// ═══════════════════════════════════════════════════════════════
// СИНХРОНИЗАЦИЯ
// Панель поднимается только там, где ей есть чем управлять — на странице
// кабинета (#cab-stage живёт лишь в ней) и только на телефоне. На мониторе и
// на остальных страницах сайта её нет вовсе, разметка кабинета не тронута.
// ═══════════════════════════════════════════════════════════════
function mnavSync() {
  const phone = mnavPhone();
  const stage = mnavStage();
  const on = !!(phone && stage);
  const html = document.documentElement;

  if (!on) {
    if (html.classList.contains('mnav-on')) {
      html.classList.remove('mnav-on');
      mnavClose();
      mnavUnmarkAll();
    }
    return;
  }

  mnavBuild();
  html.classList.add('mnav-on');

  const screen = mnavScreen();
  mnavMark(screen);

  const key = mnavDept();
  const def = mnavDeptDef(key);
  const sect = mnavCurSect(screen);

  mnavLbl('home', 'Приёмная', !key);
  mnavLbl('dept', def ? (def.sh || def.nm) : 'Ведомства', !!key);
  mnavLbl('sect', sect || 'Разделы', false, !screen || !screen.querySelector('[data-mnav="1"]'));

  // Акцент панели и листа — цвет державы, тот же, что подчёркивает вкладку на
  // мониторе. Кладём СВОЮ переменную на <html> (панель и лист — разные ветки
  // разметки): общий `--fac` трогать нельзя, его читают чужие блоки.
  try {
    if (typeof EC === 'object' && EC.app && EC.app.color && typeof ecReadable === 'function') {
      const c = ecReadable(EC.app.color);
      if (MNAV._fac !== c) { MNAV._fac = c; html.style.setProperty('--mnav-fac', c); }
    }
  } catch (e) {}

  // Лист разделов открыт, а экран под ним перерисовался — строки в нём уже
  // указывают на выброшенные из DOM кнопки. Пересобираем.
  if (MNAV.sheet === 'sect') {
    const body = document.getElementById('mn-body');
    if (body && MNAV.pick.length && !document.contains(MNAV.pick[0])) body.innerHTML = mnavSectBody();
  }
}

// Подпись и состояние кнопки панели. Трогаем DOM, только если что-то изменилось:
// sync зовётся по каждому вздоху разметки.
function mnavLbl(slot, text, active, dead) {
  const t = document.querySelector(`#mnav .mnav-t[data-t="${slot}"]`);
  if (!t) return;
  if (MNAV._lbl[slot] !== text) { MNAV._lbl[slot] = text; t.textContent = text; }
  const b = t.closest('.mnav-b');
  if (!b) return;
  b.classList.toggle('on', !!active);
  b.classList.toggle('off', !!dead);
}

// ── Слежение ───────────────────────────────────────────────────
// Кабинет и его экраны перерисовывают себя из десятка мест (cabPaint, estRefresh,
// ответы сервера) — ловить все вызовы значит править их все. Слушаем сам DOM,
// кадром ожидания, как это уже делает cabRailify.
(function _mnavWatch() {
  const start = () => {
    const cw = document.getElementById('cw');
    if (!cw) { setTimeout(start, 300); return; }
    if (typeof MutationObserver === 'function') {
      let queued = false;
      const mo = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; try { mnavSync(); } catch (e) {} });
      });
      // data-* метки полос под наблюдение не попадают (следим только за class) —
      // иначе разметка сама себя будила бы по кругу.
      mo.observe(cw, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    try { mnavSync(); } catch (e) {}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.addEventListener('hashchange', () => { mnavClose(); setTimeout(() => { try { mnavSync(); } catch (e) {} }, 60); });
  window.addEventListener('resize', () => { try { mnavSync(); } catch (e) {} });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && MNAV.sheet) mnavClose(); });
  // Страховка на случай, если наблюдатель не увидел подмену (пересозданный #cw).
  setInterval(() => { try { mnavSync(); } catch (e) {} }, 1500);
})();
