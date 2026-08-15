// © 2025–2026. Все права защищены.
// ═══════════════════════════════════════════════════════════════
// ОПОВЕЩЕНИЯ — ОДИН КОЛОКОЛ НА ВЕСЬ САЙТ.
//
// ⚠️ ПОЧЕМУ ЭТО ПОЯВИЛОСЬ. Игра сообщала о себе только тем, что игрок сам
// открывал ведомство и смотрел. Заявка на службу, ответ поддержки, входящая
// операция разведки, готовое исследование, исполненный заказ на бирже, ход в
// бою — всё это случалось молча. За полтора десятка ведомств бейдж был ОДИН
// («Двор», FM.me.inbox) и ещё один самодельный у «Горячих точек»: каждый
// считал себя сам и жил своей жизнью.
//
// ЗДЕСЬ НЕ ЗАВОДИТСЯ ЛЕНТА УВЕДОМЛЕНИЙ. Ленту пришлось бы наполнять из полусотни
// мест, чистить и разъезжаться с реальностью. Счётчики СЧИТАЮТСЯ ПО ЖИВЫМ
// ДАННЫМ одной серверной функцией notif_counts() (_notifications.sql) — по тем
// же таблицам, которые ведомство и так показывает. Бейдж не может разойтись с
// разделом: он и есть его пересчёт.
//
// ДВЕ ПОРОДЫ СЧЁТЧИКОВ, и разница видна игроку:
//   • ДЕЛО (kind:'todo') — ждёт действия. Гаснет САМО, когда дело сделано;
//     «прочитать» его нельзя, поэтому и метки просмотра у него нет.
//   • НОВОЕ (kind:'new')  — достаточно прочесть. Гаснет, когда игрок вошёл в
//     раздел: ntMark() двигает метку просмотра на сервере.
//
// ЭМОДЗИ ЗАПРЕЩЕНЫ (см. no-emoji-outline-svg-icons): значки — контурный SVG той
// же породы, что NAV_ICO/CN_ICO. Ведомственные берём у polGlyph, свой один —
// колокол.
// ═══════════════════════════════════════════════════════════════

const NT = {
  n: {},            // {канал: число}
  loaded: false,
  busy: false,
  at: 0,            // когда считали в последний раз (мс)
  open: false,      // раскрыта ли панель
};

// Как часто перепрашивать сервер. Реже — бейдж врёт, чаще — лишний запрос на
// ровном месте: события в этой игре идут тиками, а не секундами.
const NT_POLL_MS = 90000;

// ── Каналы ─────────────────────────────────────────────────────
// ⚠️ КЛЮЧ КАНАЛА = `ведомство.вкладка`. Цифра на «Внешней политике» отвечает
// «где-то там что-то есть» и заставляет обойти семь разделов рельсы вручную —
// поэтому счёт идёт по ВКЛАДКАМ, и бейдж садится ровно на тот раздел, где
// лежит дело. Ведомственная цифра на двери приёмной — СУММА своих вкладок
// (ntDept), а не отдельный источник правды.
//
// dept — ключ ведомства (CAB_DEPT); tab — ключ раздела на его рельсе (POL_SEC /
//        POL_DSEC / EST_SCR[dept].sec). Без tab канал ведомственный (у экрана
//        нет рельсы: «Исследования», «Управление колониями»).
// nm   — как называется дело в панели;
// sub  — что с ним делать (панель — список дел, а не список слов);
// ic   — ключ polGlyph (та же графика, что у дверей и рельсы);
// kind — 'todo' (ждёт решения, гаснет само) или 'new' (достаточно прочесть).
// ⚠️ ПОРЯДОК = ПОРЯДОК В ПАНЕЛИ: сперва то, что ждёт РЕШЕНИЯ и может протухнуть
// (ход в бою, ответ на предложение мира, заявка), потом готовое, потом чтение.
const NT_CH = {
  'battle':         { nm: 'Ход за вами',           sub: 'бой ждёт вашего хода',              ic: 'war',     kind: 'todo', go: () => go('hotspots') },
  'dipl.war':       { nm: 'Предложения по войне',  sub: 'мир, капитуляция, вступление',      ic: 'war',     kind: 'todo', dept: 'dipl',  tab: 'war' },
  'dipl.alliance':  { nm: 'Зовут в союз',          sub: 'уния, вассалитет, объединение',     ic: 'pact',    kind: 'todo', dept: 'dipl',  tab: 'alliance' },
  'dipl.loans':     { nm: 'Спор по займу',         sub: 'кредит оспорен — рассудить',        ic: 'coin',    kind: 'todo', dept: 'dipl',  tab: 'loans' },
  'ipol.court':     { nm: 'Заявки на службу',      sub: 'принять ко двору или отказать',     ic: 'throne',  kind: 'todo', dept: 'ipol',  tab: 'court' },
  'ipol.faith':     { nm: 'Зовут в веру',          sub: 'принять учение или отвергнуть',     ic: 'temple',  kind: 'todo', dept: 'ipol',  tab: 'faith' },
  'trade.barter':   { nm: 'Встречный обмен',       sub: 'бартер и продажа технологий',       ic: 'swap',    kind: 'todo', dept: 'trade', tab: 'barter' },
  'intel.ransom':   { nm: 'Выкуп агента',          sub: 'за вашего человека просят цену',    ic: 'coin',    kind: 'todo', dept: 'intel' },
  'intel.ops':      { nm: 'Операция завершена',    sub: 'снять результат, агенты простаивают', ic: 'sat',   kind: 'todo', dept: 'intel' },
  'research':       { nm: 'Исследование готово',   sub: 'снять и занять слот',               ic: 'compass', kind: 'todo', dept: 'research' },
  'planets':        { nm: 'Стройка завершена',     sub: 'принять работы в колониях',         ic: 'forge',   kind: 'todo', dept: 'planets' },
  'press.mod':      { nm: 'Новости на модерации',  sub: 'вынести вердикт',                   ic: 'scales',  kind: 'todo', dept: 'press', tab: 'mod' },
  'exch.orders':    { nm: 'Заказы исполнены',      sub: 'биржа закрыла ваши заказы',         ic: 'scroll',  kind: 'new',  dept: 'exch',  tab: 'orders' },
  'intel.incoming': { nm: 'Против вас работали',   sub: 'входящие тайные операции',          ic: 'sat',     kind: 'new',  dept: 'intel' },
  'press.notif':    { nm: 'О вас пишут',           sub: 'сектор назвал вашу державу',        ic: 'ping',    kind: 'new',  dept: 'press', tab: 'notif' },
  'stat.ach':       { nm: 'Новые достижения',      sub: 'держава отличилась',                ic: 'medal',   kind: 'new',  dept: 'stat',  tab: 'ach' },
  'news':           { nm: 'Сводка сектора',        sub: 'новости, которых вы не читали',     ic: 'ledger',  kind: 'new',  home: true },
  'ticket':         { nm: 'Ответ поддержки',       sub: 'в вашем обращении есть ответ',      ic: 'speech',  kind: 'new',  act: () => { if (typeof tkOpen === 'function') tkOpen(); } },
};

// Каналы стола приёмной (гаснут, когда стол на экране).
const NT_DESK = ['news'];

// ── Счёт ───────────────────────────────────────────────────────
function ntCount(chan) { return +NT.n[chan] || 0; }

// Сколько ждёт ЗА ДВЕРЬЮ ведомства — сумма всех его вкладок (бейдж на двери
// приёмной, в рельсе кабинета и в листе телефона).
function ntDept(dept) {
  return Object.entries(NT_CH).reduce((s, [k, c]) => s + (c.dept === dept ? ntCount(k) : 0), 0);
}

// Сколько ждёт в КОНКРЕТНОЙ вкладке (бейдж на рельсе разделов, polRail).
// Каналы ведомства без своей вкладки садятся на раздел по умолчанию — иначе
// «Выкуп агента» посчитался бы в дверь, но не показался бы нигде внутри.
function ntTab(dept, tab) {
  return Object.entries(NT_CH).reduce((s, [k, c]) =>
    s + ((c.dept === dept && c.tab === tab) ? ntCount(k) : 0), 0);
}

// Сколько ждёт в ОСТАЛЬНЫХ разделах ведомства. Нужно свёрнутой рельсе телефона:
// там виден только текущий раздел, и без этой цифры бейджи не увидит никто.
function ntDeptRest(dept, curTab) {
  return Object.entries(NT_CH).reduce((s, [k, c]) =>
    s + ((c.dept === dept && c.tab && c.tab !== curTab) ? ntCount(k) : 0), 0);
}

// Всего — для колокола и для пункта «Кабинет игрока» в борте.
function ntTotal() {
  return Object.keys(NT_CH).reduce((s, k) => s + ntCount(k), 0);
}

// ── Загрузка ───────────────────────────────────────────────────
// Тихая: оповещения — фон, и ронять тостом «не удалось посчитать» на каждый
// зевок сети было бы хуже, чем не показать бейдж.
async function ntLoad(force) {
  if (NT.busy) return;
  if (!force && NT.at && Date.now() - NT.at < NT_POLL_MS) return;
  if (typeof user === 'undefined' || !user) { NT.n = {}; NT.loaded = false; return; }
  if (typeof ecRpc !== 'function') return;
  NT.busy = true;
  try {
    const r = await ecRpc('notif_counts', {});
    NT.n = (r && typeof r === 'object') ? r : {};
    NT.loaded = true;
    NT.at = Date.now();
    ntRepaint();
  } catch (e) {
    // Сессия истекла / сеть — просто оставляем прошлые числа.
  } finally { NT.busy = false; }
}

// Отметить канал прочитанным. Только 'new' — 'todo' сервер и так не примет
// (см. notif_mark), и просить его об этом было бы обманом игрока: дело не
// исчезает оттого, что на него посмотрели.
async function ntMark(chan) {
  const c = NT_CH[chan];
  if (!c || c.kind !== 'new' || !ntCount(chan)) return;
  NT.n[chan] = 0;          // гасим сразу: ждать ответа сервера, чтобы бейдж
  ntRepaint();             // погас, — это заметная задержка на ровном месте.
  try { await ecRpc('notif_mark', { p_chan: chan }); } catch (e) {}
}

// Вход В РАЗДЕЛ гасит его читаемые каналы. Именно в раздел, а не в ведомство:
// открыв «Вестник», игрок попадает в «Редакцию» и упоминаний ещё не видел —
// гасить их за него значило бы спрятать новость, которую он не читал.
function ntSeenTab(dept, tab) {
  Object.entries(NT_CH).forEach(([k, c]) => {
    if (c.kind !== 'new') return;
    if (c.dept !== dept) return;
    // Канал без своей вкладки (у экрана нет рельсы) гасится входом в ведомство.
    if (c.tab && c.tab !== tab) return;
    ntMark(k);
  });
}

// Стол приёмной. Зовётся из cabDeskHtml.
function ntSeenDesk() { NT_DESK.forEach(ntMark); }

// ── Значки ─────────────────────────────────────────────────────
const NT_BELL = '<path d="M18 8.6a6 6 0 1 0-12 0c0 6-2.4 7.6-2.4 7.6h16.8S18 14.6 18 8.6Z"/><path d="M13.7 19.6a2 2 0 0 1-3.4 0"/>';

function ntBellIco() {
  return `<svg class="nav-i" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${NT_BELL}</svg>`;
}

// Число на кнопке. Больше 99 не пишем — счётчик перестаёт быть числом и
// становится словом «много», а колонка от него разъезжается.
function ntNum(n) { return n > 99 ? '99+' : String(n); }

// Бейдж для чужой разметки (двери кабинета, нижняя панель телефона, борт).
function ntBadgeHtml(n, cls) {
  n = +n || 0;
  return n ? `<span class="nt-badge ${cls || ''}">${ntNum(n)}</span>` : '';
}

// ── Панель ─────────────────────────────────────────────────────
function ntRowHtml(k) {
  const c = NT_CH[k], n = ntCount(k);
  if (!n) return '';
  const g = (typeof polGlyph === 'function' ? polGlyph(c.ic) : '');
  // Куда ведёт строка — словами. Иначе панель отвечает «что случилось», но не
  // «где это лежит», и игрок всё равно идёт искать вкладку глазами.
  let where = '';
  try {
    const d = c.dept && typeof CAB_DEPT === 'object' ? CAB_DEPT[c.dept] : null;
    const tabNm = (c.dept === 'ipol' && typeof POL_SEC === 'object' && POL_SEC[c.tab]) ? POL_SEC[c.tab].nm
                : (c.dept === 'dipl' && typeof POL_DSEC === 'object' && POL_DSEC[c.tab]) ? POL_DSEC[c.tab].nm
                : (c.tab && typeof EST_SCR === 'object' && EST_SCR[c.dept] && EST_SCR[c.dept].sec[c.tab]) ? EST_SCR[c.dept].sec[c.tab].nm
                : '';
    where = d ? (d.sh || d.nm) + (tabNm ? ' · ' + tabNm : '') : '';
  } catch (e) {}
  return `<button class="nt-row" type="button" onclick="ntGo('${k}')">
    <span class="nt-row-ic">${g}</span>
    <span class="nt-row-tx"><b>${esc(c.nm)}</b><i>${esc(where || c.sub)}</i></span>
    <span class="nt-row-n${c.kind === 'todo' ? ' nt-row-n-todo' : ''}">${ntNum(n)}</span>
  </button>`;
}

function ntPanelHtml() {
  const rows = Object.keys(NT_CH).map(ntRowHtml).join('');
  return `<div class="nt-panel" id="nt-panel">
    <div class="nt-panel-hd">
      <span>Оповещения</span>
      <button class="nt-x" type="button" onclick="ntClose()" title="Закрыть">✕</button>
    </div>
    ${rows || `<div class="nt-empty">${NT.loaded ? 'Дел нет — в державе тихо.' : 'Считаем…'}</div>`}
  </div>`;
}

// Панель висит на body, а не внутри борта: борт в кабинете ужат до колонки
// глифов и `overflow` обрезал бы её по ширине значка.
function ntOpen() {
  ntClose();
  const box = document.createElement('div');
  box.className = 'nt-wrap';
  box.id = 'nt-wrap';
  box.innerHTML = ntPanelHtml();
  box.addEventListener('click', e => { if (e.target === box) ntClose(); });
  document.body.appendChild(box);
  NT.open = true;
  ntLoad(true);   // открыл — значит хочет свежее, а не то, что осело 90 с назад
}

function ntClose() {
  const b = document.getElementById('nt-wrap');
  if (b) b.remove();
  NT.open = false;
}

function ntToggle() { NT.open ? ntClose() : ntOpen(); }

// Строка панели — это переход К ДЕЛУ, а не «пометить прочитанным». Поэтому
// сперва ведём, и лишь потом гасим канал, если он из читаемых.
function ntGo(chan) {
  const c = NT_CH[chan];
  if (!c) return;
  ntClose();
  try {
    if (c.act) c.act();
    else if (c.dept && typeof cabGoto === 'function') cabGoto(c.dept, c.tab);
    else if (c.home && typeof cabHome === 'function') cabHome();
    else if (c.go) c.go();
  } catch (e) {}
  if (c.kind === 'new') ntMark(chan);
}

// ── Перерисовка бейджей на месте ───────────────────────────────
// ⚠️ НЕ ЧЕРЕЗ ПЕРЕРИСОВКУ СТРАНИЦЫ. Счётчики обновляются в фоне каждые полторы
// минуты; дёргать setPg/cabPaint означало бы выбрасывать игрока из середины
// формы и сбрасывать скролл раз в полторы минуты. Меняем ТОЛЬКО числа в уже
// нарисованных узлах: у каждого бейджа есть `data-nt` с ключом канала или
// ведомства, а хозяин разметки (кабинет, борт, нижняя панель) рисует их сам.
// Формы `data-nt`, все четыре — в одном месте, иначе завтра каждый хозяин
// разметки придумает свою:
//   '*'            — всего по державе (колокол, борт, шапка кабинета);
//   'ipol.court'   — конкретный канал (рельса разделов);
//   'ipol'         — ведомство целиком (двери приёмной, лист телефона);
//   '~ipol:court'  — ОСТАЛЬНЫЕ разделы ведомства (свёрнутая рельса телефона).
function ntRepaint() {
  document.querySelectorAll('[data-nt]').forEach(el => {
    const k = el.getAttribute('data-nt');
    if (!k) return;
    let n;
    if (k === '*') n = ntTotal();
    else if (k.charAt(0) === '~') { const p = k.slice(1).split(':'); n = ntDeptRest(p[0], p[1]); }
    else if (NT_CH[k]) n = ntCount(k);
    else if (k.indexOf('.') > 0) n = 0;   // вкладка без своего канала — всегда пусто
    else n = ntDept(k);
    el.textContent = n ? ntNum(n) : '';
    el.classList.toggle('nt-off', !n);
  });
  const p = document.getElementById('nt-panel');
  if (p) p.outerHTML = ntPanelHtml();
}

// ── Пункт борта «Оповещения» ───────────────────────────────────
// Живёт в боковом меню рядом с кабинетом: колокол нужен НА ЛЮБОЙ странице —
// на карте, в конструкторе, в вики, — а не только там, где игрок и так увидит
// дела своими глазами.
function ntNavHtml() {
  const n = ntTotal();
  return `<a class="n-home nt-nav" id="ntl-bell" href="#" onclick="event.preventDefault();ntToggle();return false" title="Оповещения">
    <span class="n-home-icon">${ntBellIco()}</span>Оповещения<span class="nt-badge nt-badge-nav${n ? '' : ' nt-off'}" data-nt="*">${n ? ntNum(n) : ''}</span>
  </a>`;
}

// ── Опрос ──────────────────────────────────────────────────────
// Останавливать таймер на скрытой вкладке смысла нет (один запрос в полторы
// минуты), а вот пересчитать СРАЗУ при возврате — да: игрок ушёл на час, вернулся
// и должен увидеть, что накопилось, а не ждать до следующего тика.
(function _ntBoot() {
  const start = () => {
    setTimeout(() => ntLoad(true), 1500);   // после загрузки сессии и EC
    setInterval(() => ntLoad(false), NT_POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) ntLoad(true); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && NT.open) ntClose(); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
