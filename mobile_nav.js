// © 2025–2026. Все права защищены.
// ═══════════════════════════════════════════════════════════════
// НАВИГАЦИЯ КАБИНЕТА НА ТЕЛЕФОНЕ — КНОПКА И ЛИСТ-ЛЕСЕНКА.
//
// ⚠️ ПАНЕЛЬ СНИМАЛИ — НЕ СНИМАТЬ СНОВА. Была попытка выбросить её ради «одного
// устройства навигации»: на телефоне те же ленты вкладок, что на мониторе. На
// деле навигация кабинета с телефона исчезла — рельса ведомств рисуется только
// ВНУТРИ открытого ведомства (cabinet.js), а попасть в ведомство было уже
// нечем: на глазах оставался один борт сайта. Панель возвращена.
//
// ⚠️ И ВТОРОЙ РАЗ СНИМАЛИ ТОЖЕ — КНОПКУ НАВИГАЦИИ, в пользу «лесенки лент прямо
// на экране» (три липкие ленты под шапкой: ведомства, разделы, главы). НЕ
// ПОВТОРЯТЬ: кнопка нужна, навигация живёт ЗА НЕЙ, а не занимает собой верх
// каждого экрана. Всё, что ниже, написано под кнопку.
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
//
// КАК СДЕЛАНО.
//   1) НИЖНЯЯ ПАНЕЛЬ (#mnav) — три мишени: «Меню» (борт сайта), «Приёмная» и
//      широкая кнопка НАВИГАЦИИ. Она же хлебные крошки в две строки: сверху
//      ведомство, снизу раздел внутри него — «Внутренняя политика / Двор».
//   2) ЛИСТ (#mnav-sheet) — ЛЕСЕНКА, РАЗЛОЖЕННАЯ СРАЗУ. По тапу снизу
//      поднимается ОДИН список, в котором уровни вложены сдвигом: ведомства, под
//      текущим — его разделы, под текущим разделом — его главы. Ничего не надо
//      нажимать, чтобы увидеть варианты, и ничего не заменяет собой предыдущее.
//      Любой переход — тап по любой строке любого уровня. Подробнее — у
//      mnavSubTree() и mnavBody().
//
// ⚠️ КНОПОК БЫЛО ЧЕТЫРЕ — «Ведомства» и «Разделы» СВЕДЕНЫ В ОДНУ. Две соседние
// мишени поднимали два почти одинаковых списка, и разница между ними («основные
// разделы» против «подразделов») читалась только опытом: игрок тыкал в обе по
// очереди, чтобы найти нужное. Уровень навигации — не выбор игрока, а
// подробность одного вопроса «куда пойти»: вопрос один, кнопка одна, глубина —
// ступенями внутри листа. Освободившаяся ширина ушла крошкам: где игрок стоит,
// видно и с закрытым листом.
// ⚠️ Промежуточные заходы, которые пробовали и забраковали (не возвращать):
// вкладки «Разделы | Ведомства» внутри листа — те же два меню за лишним тапом;
// сплошной свиток всех уровней подряд — стена из четырёх списков.
//
// ⚠️ ЛИСТ НИЧЕГО НЕ ЗНАЕТ ПРО ЭКРАНЫ. Экранов полтора десятка, и каждый рисует
// своё меню своей разметкой (`.pol-rail`, `.ec-tabs`, `.ec-fb-tabs`,
// `.hp-vnt-rail`, `.hp-vni-tabs`…). Описывать их по одному — полтора десятка
// мест, где завтра разъедется. Поэтому лист работает ЗЕРКАЛОМ: находит живую
// полосу в открытом экране, перерисовывает её строками у себя, а по тапу зовёт
// `.click()` на ИСХОДНОЙ кнопке. Обработчики, состояние, порядок — всё остаётся
// на месте, экраны не тронуты. Та же мысль, что у `cabRailify` на мониторе
// (cabinet.js), только там полоса переезжает в колонку, а здесь — в ступень.
//
// ⚠️ ПАНЕЛЬ ЖИВЁТ В <body>, А НЕ В СТРАНИЦЕ. iOS Safari отсчитывает
// `position:fixed` не от вьюпорта, а от прокручиваемого предка — им был бы #cw,
// и панель уезжала бы вверх вместе с прокруткой (ровно этим болела кнопка
// «назад», см. `_vnBackFabSync` в render.js). В <body> она вне всех скроллеров.
// ═══════════════════════════════════════════════════════════════

const MNAV = {
  ready: false,      // разметка создана
  sheet: null,       // лист поднят: 'nav' | null
  pick: [],          // исходные кнопки экрана под строками ступени
  _lbl: {},          // последние подписи кнопок — чтобы не трогать DOM вхолостую
  _marked: [],       // полосы, отражённые в лист (метка data-mnav)
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
    back:  '<path d="M15 5l-7 7 7 7"/>',
    up:    '<path d="M6 14l6-6 6 6"/>',
    go:    '<path d="M9 5l7 7-7 7"/>',
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
// Порядок = порядок ступеней: сперва разделы ведомства, потом полосы вкладок.
// ⚠️ ГЛАВЫ (`.pol-chaps`) — ТОЖЕ СТУПЕНЬ. На мониторе они вкладываются
// подпунктами В ту же вертикальную рельсу, под свой раздел (politics.js:
// `.pol-chaps-sub` после активного `.pol-rail-b`). На телефоне politics.js
// кладёт их лентой над телом раздела — своей формы, своего размера, четвёртым
// этажом навигации. В листе они становятся третьей ступенью.
const MNAV_STRIPS = [
  ['.pol-railw .pol-rail', 'Разделы'],
  ['.pol-chaps',           'Главы'],
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

// Название текущего раздела — оно же вторая строка крошек на кнопке панели.
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
    <button class="mnav-b mnav-b-nav" type="button" data-a="nav" aria-haspopup="dialog" aria-expanded="false">
      <span class="mnav-ic">${mnavGl('depts')}</span>
      <span class="mnav-crumb">
        <span class="mnav-t" data-t="dept">Ведомства</span>
        <span class="mnav-t2" data-t="sect">все ведомства державы</span>
      </span>
      <span class="mnav-caret">${mnavGl('up')}</span>
    </button>`;

  const sheet = document.createElement('div');
  sheet.id = 'mnav-sheet';
  sheet.hidden = true;
  sheet.innerHTML = `
    <div class="mn-ov" data-a="close"></div>
    <div class="mn-panel" role="dialog" aria-modal="true" aria-label="Навигация">
      <div class="mn-grip" data-a="close" aria-hidden="true"></div>
      <div class="mn-hd">
        <h2 id="mn-title">Куда пойти</h2>
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

// ═══════════════════════════════════════════════════════════════
// ЛЕСЕНКА ВНУТРИ ЛИСТА
// ═══════════════════════════════════════════════════════════════
// ⚠️ ЛЕСЕНКА РАЗЛОЖЕНА СРАЗУ, А НЕ ПОКАЗЫВАЕТСЯ ПО ОДНОЙ СТУПЕНИ. Это главное
// свойство листа, и ломать его нельзя. Пробовали и забраковали:
//   • вкладки «Разделы | Ведомства» внутри листа — те же два меню за лишним
//     тапом и за догадкой, в какой из них нужное;
//   • сплошной свиток, где уровни лежали отдельными группами подряд — четыре
//     списка на экране, и непонятно, какой из них про «где я сейчас»;
//   • пошаговый спуск, где ступень ЗАМЕНЯЛА предыдущую — приходилось жать,
//     чтобы увидеть, что там внутри, и держать в голове, где ты стоишь.
// Как сделано: ОДИН список, где уровни ВЛОЖЕНЫ друг в друга сдвигом вправо —
// под текущим ведомством его разделы, под текущим разделом его главы:
//     Внутренняя политика        ← ведомство, в котором стоим
//         Двор                   ← его разделы, сразу видно
//             Престол            ← главы текущего раздела
//             Совет
//         Благополучие
//     Внешняя политика
// Ничего не надо открывать, чтобы увидеть варианты: они уже на глазах, глубина
// читается отступом и линией-поводком слева. Любой переход — один тап по любой
// строке любого уровня.
//
// ⚠️ ВЛОЖЕННОЕ ПОКАЗЫВАЕТСЯ ТОЛЬКО У АКТИВНОГО. Развернуть разделы у ВСЕХ
// ведомств нельзя: рельсы чужих ведомств не существует, пока ведомство не
// открыто (её рисует сам экран, cabinet.js), а полтора десятка развёрнутых
// списков — это и есть та каша, от которой уходили.
function mnavStrips() {
  const screen = mnavScreen();
  return screen ? [...screen.querySelectorAll('[data-mnav="1"]')] : [];
}

// Строка листа. Одна форма на все уровни: глиф · имя (+пояснение) · хвост.
// `lvl` — ступень: 0 ведомства, 1 разделы, 2 главы. Сдвиг и поводок рисует CSS.
function mnavRow(act, ic, nm, sub, tail, on, lvl) {
  return `<button class="mn-row${on ? ' on' : ''}" type="button" data-a="${esc(act)}" data-l="${lvl || 0}">
    <span class="mn-row-ic">${ic || ''}</span>
    <span class="mn-row-tx"><b>${esc(nm)}</b>${sub ? `<i>${esc(sub)}</i>` : ''}</span>
    ${tail ? `<span class="mn-row-n">${esc(tail)}</span>` : ''}
  </button>`;
}

// Вложенные ступени под активной строкой: полоса `lvl` и всё, что под ней.
// Рекурсия, а не два жёстких уровня: у экранов бывает и третья полоса, и
// описывать её отдельным случаем значит завтра забыть про четвёртую.
function mnavSubTree(lvl) {
  const strips = mnavStrips();
  const strip = strips[lvl - 1];
  if (!strip) return '';
  let html = '';
  mnavItems(strip).forEach(el => {
    const i = MNAV.pick.push(el) - 1;
    const on = el.classList.contains('on');
    html += mnavRow('pick:' + i, '', mnavItemTx(el), '', mnavItemTail(el), on, lvl);
    // Глубже разворачивается только активное: главы принадлежат ТОМУ разделу,
    // который открыт, у остальных их попросту нет в разметке.
    if (on) html += mnavSubTree(lvl + 1);
  });
  return html;
}

// ── Всё дерево: кабинет, ведомства с вложенными ступенями, выход ──
function mnavBody() {
  const depts = (typeof cabDepts === 'function') ? cabDepts() : {};
  const groups = (typeof CAB_GRP !== 'undefined') ? CAB_GRP : [];
  const cur = mnavDept();
  MNAV.pick = [];

  // Хвост = сколько дел ждёт за этим ведомством (общий счёт, notify.js).
  // FM.me.inbox остаётся запасным для «Двора»: лист открывают и до первого
  // ответа notif_counts, и в этот миг единственное известное число — его.
  let inbox = 0;
  try { inbox = (typeof FM === 'object' && FM.me && FM.me.is_owner && !EC.actAs) ? (+FM.me.inbox || 0) : 0; } catch (e) {}
  const deptN = k => {
    let n = 0;
    try { n = (typeof ntDept === 'function') ? ntDept(k) : 0; } catch (e) {}
    if (k === 'ipol' && !n) n = inbox;
    return n ? (typeof ntNum === 'function' ? ntNum(n) : String(n)) : '';
  };

  // Оповещения первой строкой: на телефоне борта с колоколом нет вовсе, и без
  // этой строки счётчик до игрока не доехал бы никак.
  let ntAll = 0;
  try { ntAll = (typeof ntTotal === 'function') ? ntTotal() : 0; } catch (e) {}
  let html = `<div class="mn-grp"><h3 class="mn-grp-hd">Кабинет</h3>
    ${mnavRow('nt:open', (typeof ntBellIco === 'function' ? ntBellIco() : ''), 'Оповещения', 'что ждёт вашего решения', ntAll ? ntNum(ntAll) : '', false, 0)}
    ${mnavRow('go:home', mnavGl('hall'), 'Приёмная', 'сводка сектора и все двери', '', !cur, 0)}
  </div>`;

  // Ведомства строками (не плиткой: в плитку не вложить ступени) и с пояснением
  // только у текущего — у остальных подпись одна, чтобы полтора десятка строк
  // помещались в экран и не отодвигали вложенное вниз.
  const row = (k, d) => mnavRow('dept:' + k, mnavDeptGl(d.ic), d.nm,
    k === cur ? d.sub : '', deptN(k), k === cur, 0) + (k === cur ? mnavSubTree(1) : '');
  const seen = {};
  groups.forEach(([g, label]) => {
    const items = Object.entries(depts).filter(([k, d]) => d.grp === g && !seen[k]);
    if (!items.length) return;
    html += `<div class="mn-grp"><h3 class="mn-grp-hd">${esc(label)}</h3>` +
      items.map(([k, d]) => { seen[k] = 1; return row(k, d); }).join('') + '</div>';
  });
  const rest = Object.entries(depts).filter(([k]) => !seen[k]);
  if (rest.length) html += `<div class="mn-grp">` + rest.map(([k, d]) => row(k, d)).join('') + '</div>';

  // Выход из работы — внизу листа, а не только на обложке кабинета: из
  // глубокого ведомства до неё пришлось бы прокручивать весь экран назад.
  html += `<div class="mn-grp mn-grp-foot">
    ${mnavRow('site:home', mnavGl('back'), 'На главную', 'сцена, новости, забавы', '', false, 0)}
  </div>`;
  return html;
}

function mnavPaint() {
  const body = document.getElementById('mn-body');
  if (!body) return;
  const keep = body.scrollTop;
  body.innerHTML = mnavBody();
  // Держим место, на котором стоял палец: лист перерисовывается и на каждый
  // ответ сервера, и прыжок к началу читался бы как сбой.
  body.scrollTop = keep;
}

// Экран под листом дорисовался (ведомство открылось, раздел сменился) — ступени
// под ним появились не сразу. Ждём и перерисовываем дерево.
// ⚠️ БЕЗ requestAnimationFrame: первая попытка — СРАЗУ, остальные таймером.
// Большинство ведомств рисуется тем же тактом, что и `cabOpen`, а сам rAF не
// тикает в свёрнутой вкладке — дерево должно собираться и там.
function mnavGrow(want, tries) {
  const n = tries == null ? 10 : tries;
  if (!MNAV.sheet) return;
  mnavMark(mnavScreen());
  if (mnavStrips().length >= want) { mnavPaint(); mnavShowOn(); return; }
  if (n > 0) { setTimeout(() => mnavGrow(want, n - 1), 45); return; }
  // Ступени ниже не появилось: у ведомства один экран, у раздела нет глав —
  // игрок пришёл туда, куда шёл, и лист уходит с дороги.
  mnavClose();
}

// Активная ветка — в видимой части листа. Ведомств полтора десятка, и
// развёрнутые под «Разведуправлением» разделы иначе оказались бы за краем.
function mnavShowOn() {
  const body = document.getElementById('mn-body');
  if (!body) return;
  const on = body.querySelector('.mn-row.on[data-l="0"]');
  if (!on) return;
  const top = on.offsetTop, bot = top + on.offsetHeight;
  if (top < body.scrollTop || bot > body.scrollTop + body.clientHeight * 0.6) {
    body.scrollTop = Math.max(0, top - 12);
  }
}

function mnavOpen() {
  mnavBuild();
  const sheet = document.getElementById('mnav-sheet');
  const body = document.getElementById('mn-body');
  if (!sheet || !body) return;
  MNAV.sheet = 'nav';
  // ⚠️ ПОЛОСЫ ПОМЕЧАЕМ ЗДЕСЬ ЖЕ, а не полагаемся на наблюдателя: он кладёт метки
  // следующим кадром, и лист, поднятый сразу за сменой экрана, показал бы
  // ведомство без его разделов.
  mnavMark(mnavScreen());
  mnavPaint();
  sheet.hidden = false;
  document.documentElement.classList.add('mnav-sheet');
  const nb = document.querySelector('#mnav .mnav-b-nav');
  if (nb) { nb.classList.add('open'); nb.setAttribute('aria-expanded', 'true'); }
  body.scrollTop = 0;
  mnavShowOn();
}

function mnavClose() {
  const sheet = document.getElementById('mnav-sheet');
  MNAV.sheet = null;
  document.documentElement.classList.remove('mnav-sheet');
  if (sheet) sheet.hidden = true;
  const nb = document.querySelector('#mnav .mnav-b-nav');
  if (nb) { nb.classList.remove('open'); nb.setAttribute('aria-expanded', 'false'); }
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
  if (a === 'nt:open') { mnavClose(); if (typeof ntOpen === 'function') ntOpen(); return; }
  // Кнопка панели: лист поднялся — тот же тап его и опустит.
  if (a === 'nav') { if (MNAV.sheet) mnavClose(); else mnavOpen(); return; }

  // ⚠️ ВЫБОР ВЕДОМСТВА ЛИСТ НЕ ЗАКРЫВАЕТ. Ведомство — ещё не цель: оно
  // открывается за листом, а в самом листе ПОД ЕГО СТРОКОЙ разворачиваются
  // разделы. Закрылся бы лист — игрок остался бы с вопросом «а дальше куда» и
  // полез бы открывать его заново.
  if (a.indexOf('dept:') === 0) {
    if (typeof cabOpen === 'function') cabOpen(a.slice(5));
    mnavScrollTop();
    if (MNAV.sheet) mnavGrow(1); else mnavClose();
    return;
  }
  if (a.indexOf('pick:') === 0) {
    const el = MNAV.pick[+a.slice(5)];
    // Уровень строки: разделу (1) может отвечать своя ступень глав (2), главе —
    // уже ничего. Считаем по строке, а не по состоянию листа: строки всех
    // уровней лежат в одном списке.
    const want = (+b.dataset.l || 0) + 1;
    // Зовём ИСХОДНУЮ кнопку экрана: её onclick, её порядок, её состояние.
    // Спрятанная кнопка на программный click отвечает как обычная.
    if (el) { try { el.click(); } catch (err) { console.error('[mnav]', err); } }
    mnavScrollTop();
    // Развернулась ступень ниже (у раздела свои главы) — лист остаётся и
    // показывает её; нет — закрывается: игрок пришёл туда, куда шёл. Попыток
    // мало (≈0.1 с): раздел рисует свои главы сам, лишнее ожидание читалось бы
    // как залипание.
    mnavGrow(want, 2);
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
  // Крошки на кнопке навигации: ведомство строкой, раздел под ним. Раздела нет
  // — вторая строка не пустует, а подсказывает, что за кнопкой лежит.
  mnavLbl('dept', def ? (def.sh || def.nm) : 'Ведомства', !!key);
  mnavLbl('sect', sect || (key ? 'выбрать раздел' : 'все ведомства державы'), false);

  // Акцент панели и листа — цвет державы, тот же, что подчёркивает вкладку на
  // мониторе. Кладём СВОЮ переменную на <html> (панель и лист — разные ветки
  // разметки): общий `--fac` трогать нельзя, его читают чужие блоки.
  try {
    if (typeof EC === 'object' && EC.app && EC.app.color && typeof ecReadable === 'function') {
      const c = ecReadable(EC.app.color);
      if (MNAV._fac !== c) { MNAV._fac = c; html.style.setProperty('--mnav-fac', c); }
    }
  } catch (e) {}

  // Лист открыт, а экран под ним перерисовался — строки в нём уже указывают на
  // выброшенные из DOM кнопки. Пересобираем.
  if (MNAV.sheet && MNAV.pick.length && !document.contains(MNAV.pick[0])) mnavPaint();
}

// Подпись и состояние кнопки панели. Трогаем DOM, только если что-то изменилось:
// sync зовётся по каждому вздоху разметки.
// ⚠️ Активность ставится ПО СЛОТУ, а не «на кнопку, в которой слот лежит»:
// строки крошек `dept` и `sect` живут в ОДНОЙ кнопке навигации, и прежний
// `closest('.mnav-b')` заставил бы их спорить за её класс.
function mnavLbl(slot, text, active) {
  const t = document.querySelector(`#mnav [data-t="${slot}"]`);
  if (!t) return;
  if (MNAV._lbl[slot] !== text) { MNAV._lbl[slot] = text; t.textContent = text; }
  if (slot === 'sect') return;
  const b = (slot === 'dept') ? document.querySelector('#mnav .mnav-b-nav')
                              : t.closest('.mnav-b');
  if (b) b.classList.toggle('on', !!active);
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
