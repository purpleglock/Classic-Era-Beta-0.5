// © 2025–2026. Все права защищены.
// ═══════════════════════════════════════════════════════════════
// ХОЗЯЙСТВО — остаток кабинета, переехавший в новеллу.
//
//   ⛏ Добыча ресурсов      : Залежи · Концессии
//   🚛 Торговля             : Караваны · Рынок · Обмен
//   📊 Биржа                : Организации · Заказы · Маржа · Фьючерсы · Опционы · Облигации
//   ⚔ Вооружённые силы     : Состав · Военпром (одна дверь: армия и её стройка)
//   🧮 Статистика державы   : Обзор · Достижения
//   📰 Вестник державы      : Новости от лица государства
//
// Разговоры разные, и делятся они не по «вкладкам», а по тому, с кем игрок
// говорит: с управляющим приисками, с торговым домом, с биржевой палатой,
// с генштабом, с канцелярией статистики. Добыча и биржа — отдельные двери
// потому, что это два самых длинных разговора в игре, и мешать их с торговлей
// значит топить оба.
//
// Каркас (рельса · сценический пролог · главы) — тот же, что у politics.js:
// переиспользуем его целиком, чтобы экраны не разъезжались по стилю. Тела
// разделов — ровно те же ec*-функции, ничего не переписано и не потеряно.
// ═══════════════════════════════════════════════════════════════

const EST = {
  tab: {},        // screen key → активный раздел
  open: null,     // какой экран сейчас развёрнут
};

// ── Экраны ─────────────────────────────────────────────────────
// el   — id оверлея (создаётся в render.js вместе с остальными экранами)
// view — ключ пункта меню новеллы (heroVNChoice)
// sec  — разделы рельсы: [имя, сцена, ключ справки гайдбука, тело]
// help — ключ карточки в GB_TOPICS (guide.js): ВСЯ справка живёт только там.
const EST_SCR = {
  mine: {
    el: 'hp-vn-mine', view: 'mine', title: 'Добыча ресурсов', def: 'deposits',
    sec: {
      deposits: {
        nm: 'Залежи', scene: 'pick', help: 'deposits',
        body: () => (typeof ecResourcesPanel === 'function' ? ecResourcesPanel() : ''),
      },
      conc: {
        nm: 'Концессии', scene: 'pact', help: 'conc',
        body: () => (typeof ecConcessionsBlock === 'function' ? ecConcessionsBlock() : ''),
      },
    },
    after: () => { try { ecDrawPlanetSpheres(); } catch (e) {} },
    load: () => { try { if (typeof ecLoadWorkerPlan === 'function') ecLoadWorkerPlan(); } catch (e) {} },
  },

  trade: {
    el: 'hp-vn-trade', view: 'trade', title: 'Торговля', def: 'caravans',
    sec: {
      caravans: {
        nm: 'Караваны', scene: 'caravan', help: 'caravans',
        body: () => (typeof ecTradeSubBody === 'function' ? ecTradeSubBody('caravans') : ''),
      },
      market: {
        nm: 'Рынок', scene: 'stall', help: 'market',
        body: () => (typeof ecTradeSubBody === 'function' ? ecTradeSubBody('market') : ''),
      },
      barter: {
        nm: 'Обмен', scene: 'swap', help: 'barter',
        body: () => (typeof ecTradeSubBody === 'function' ? ecTradeSubBody('barter') : ''),
      },
    },
  },

  exch: {
    el: 'hp-vn-exch', view: 'exch', title: 'Биржа', def: 'corps',
    sec: {
      corps: {
        nm: 'Организации', scene: 'tower', help: 'corps',
        body: () => (typeof ecExCorpsBlock === 'function' ? ecExCorpsBlock() : ''),
      },
      orders: {
        nm: 'Заказы', scene: 'scroll', help: 'orders',
        body: () => (typeof ecExOrdersBlock === 'function' ? ecExOrdersBlock() : ''),
      },
      margin: {
        nm: 'Маржа', scene: 'chart', help: 'margin',
        body: () => (typeof ecExMarginBlock === 'function' ? ecExMarginBlock() : ''),
      },
      futures: {
        nm: 'Фьючерсы', scene: 'hour', help: 'futures',
        body: () => (typeof ecExFuturesBlock === 'function' ? ecExFuturesBlock() : ''),
      },
      options: {
        nm: 'Опционы', scene: 'dice', help: 'options',
        body: () => (typeof ecExOptionsBlock === 'function' ? ecExOptionsBlock() : ''),
      },
      bonds: {
        nm: 'Облигации', scene: 'coin', help: 'bonds',
        body: () => (typeof ecExBondsBlock === 'function' ? ecExBondsBlock() : ''),
      },
    },
    // Часть инструментов закрывается на реконструкцию — рельса это учитывает.
    hide: k => (typeof EC_EX_CLOSED === 'object' && EC_EX_CLOSED && EC_EX_CLOSED[k]),
  },

  army: {
    el: 'hp-vn-army', view: 'army', title: 'Вооружённые силы', def: 'roster',
    sec: {
      roster: {
        nm: 'Состав', scene: 'shield', help: 'roster',
        body: () => (typeof ecTabForces === 'function' ? ecTabForces() : ''),
      },
      build: {
        nm: 'Военпром', scene: 'forge', help: 'build',
        body: () => (typeof ecTabMilBuild === 'function' ? ecTabMilBuild() : ''),
      },
    },
  },

  press: {
    el: 'hp-vn-press', view: 'press', title: 'Вестник державы', def: 'mine',
    // Разговоры тут разные: своя редакция, чужие упоминания, редакторская почта.
    // Валить их одной простынёй — то же, чем был кабинет до переезда, поэтому
    // каждая секция получила свою дверь на рельсе. Тело всех четырёх рисует
    // faction_news.js, но по ключу секции: fnRenderNewsTab(mount, key).
    sec: {
      mine: {
        nm: 'Редакция', scene: 'scroll', help: 'press:mine',
        body: () => estNewsMount(),
      },
      notif: {
        nm: 'Оповещения', scene: 'ping', help: 'press:notif',
        body: () => estNewsMount(),
      },
      admin: {
        nm: 'Админ-публикация', scene: 'quill', help: 'press:admin',
        body: () => estNewsMount(),
      },
      mod: {
        nm: 'Модерация', scene: 'scales', help: 'press:mod',
        body: () => estNewsMount(),
      },
    },
    // Служебные секции — только редакции сайта.
    hide: k => (k === 'admin' || k === 'mod') && !(typeof fnIsStaff === 'function' && fnIsStaff()),
    // Тело новостей — асинхронное: каркас уже в DOM, содержимое доливает faction_news.js.
    after: () => {
      const mount = document.getElementById('ec-news-mount');
      if (mount && typeof fnRenderNewsTab === 'function') fnRenderNewsTab(mount, estTab('press'));
    },
  },

  stat: {
    el: 'hp-vn-stat', view: 'stat', title: 'Статистика державы', def: 'overview',
    sec: {
      // «Территория» тут была ДУБЛЁМ: карта владений и захват смежных систем —
      // это экран «Колонизация» (heroVNColony), и второй такой же в статистике
      // только сбивал с толку. Осталось то, чего больше нигде нет.
      overview: {
        nm: 'Обзор', scene: 'ledger', help: 'overview',
        body: () => (typeof ecTabOverview === 'function' ? ecTabOverview() : ''),
      },
      ach: {
        nm: 'Достижения', scene: 'medal', help: 'ach',
        body: () => (typeof ecTabAchievements === 'function' ? ecTabAchievements() : ''),
      },
    },
  },
};

// Каркас вестника: тело всех его секций доливает faction_news.js в этот узел.
function estNewsMount() { return `<div id="ec-news-mount"><div class="ec-empty">Загрузка…</div></div>`; }

// ── Свои глифы и сцены поверх политики ─────────────────────────
// polGlyph/polScene — общая графика экранов новеллы. Хозяйству нужны свои
// сюжеты (кирка, обоз, лоток, башня, кузня), поэтому расширяем словари, а не
// копируем каркас: polPrologue/polRail зовут глобальные функции и подхватят их.
const EST_GL = {
  pick:    '<path d="M4 20 14 10"/><path d="M3 9c5-5 13-5 18 0"/><path d="M12 3v5"/>',
  caravan: '<path d="M2 16h13V8H2z"/><path d="M15 11h4l3 3v2h-7z"/><circle cx="6" cy="18.5" r="1.8"/><circle cx="18" cy="18.5" r="1.8"/>',
  stall:   '<path d="M3 9h18l-2-5H5z"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>',
  swap:    '<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>',
  tower:   '<path d="M6 21V5l6-2 6 2v16z"/><path d="M9 9h2M13 9h2M9 13h2M13 13h2"/><path d="M10 21v-4h4v4"/>',
  scroll:  '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  chart:   '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M7 16l4-5 3 3 5-7"/>',
  hour:    '<path d="M7 3h10M7 21h10"/><path d="M7 3c0 5 5 6 5 9s-5 4-5 9"/><path d="M17 3c0 5-5 6-5 9s5 4 5 9"/>',
  dice:    '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="12" cy="12" r="1.2"/>',
  shield:  '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v7"/>',
  forge:   '<path d="M3 20h18"/><path d="M5 20V9h6v11"/><path d="M11 13h8v7"/><path d="M8 9V4"/><path d="M14 13V9h4"/>',
  ledger:  '<path d="M5 3h14v18H5z"/><path d="M5 8h14"/><path d="M9 3v18"/><path d="M12 12h4M12 16h4"/>',
  map:     '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  medal:   '<circle cx="12" cy="15" r="6"/><path d="M12 12.5l1 2 2 .3-1.5 1.4.4 2-1.9-1-1.9 1 .4-2L9 14.8l2-.3z"/><path d="M8 3l2 6M16 3l-2 6"/>',
  ping:    '<circle cx="12" cy="12" r="2.5"/><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9"/><path d="M4.5 4.5a10.6 10.6 0 0 0 0 15M19.5 4.5a10.6 10.6 0 0 1 0 15"/>',
  quill:   '<path d="M4 20c6-1 9-4 12-10l3-6-6 3C7 10 5 14 4 20z"/><path d="M4 20l7-7"/>',
};
const EST_SV = {
  pick: `<g class="pol-sv-tilt"><path d="M40 104 L104 44"/><path d="M34 40 Q90 4 146 40"/><path d="M90 20 L90 44"/></g>
    <circle class="pol-sv-spark" cx="36" cy="106" r="6"/>`,
  caravan: `<g class="pol-sv-slow"><path d="M20 84 L96 84 L96 40 L20 40 Z"/><path d="M96 56 L124 56 L146 76 L146 84 L96 84"/>
      <circle cx="46" cy="96" r="10" class="pol-sv-ring"/><circle cx="122" cy="96" r="10" class="pol-sv-ring"/></g>
    <g class="pol-sv-ping"><circle cx="90" cy="66" r="46" class="pol-sv-ring"/></g>`,
  stall: `<path d="M22 46 L158 46 L142 20 L38 20 Z"/><path d="M34 46 L34 106 L146 106 L146 46"/>
    <path d="M62 106 L62 72 L118 72 L118 106"/><circle class="pol-sv-pulse" cx="90" cy="88" r="5"/>`,
  swap: `<g class="pol-sv-grip"><path d="M28 48 L136 48 L112 26"/></g>
    <g class="pol-sv-grip pol-sv-grip2"><path d="M152 84 L44 84 L68 106"/></g>`,
  tower: `<path d="M56 110 L56 32 L90 16 L124 32 L124 110 Z"/>
    <path d="M70 46h12M98 46h12M70 66h12M98 66h12M70 86h12M98 86h12"/>
    <g class="pol-sv-halo"><circle cx="90" cy="12" r="10" class="pol-sv-ring"/></g>`,
  scroll: `<path d="M50 14 L130 14 L130 110 L50 110 Z"/><path d="M66 38h48M66 58h48M66 78h30"/>
    <circle class="pol-sv-pulse" cx="130" cy="98" r="6"/>`,
  chart: `<path d="M30 108 L30 18"/><path d="M30 108 L154 108"/>
    <g class="pol-sv-slow"><path d="M42 92 L72 58 L96 76 L142 30"/></g>
    <circle class="pol-sv-pulse" cx="142" cy="30" r="6"/>`,
  hour: `<path d="M52 14 L128 14 M52 110 L128 110"/>
    <path d="M52 14 C52 50 90 54 90 62 C90 70 52 74 52 110"/>
    <path d="M128 14 C128 50 90 54 90 62 C90 70 128 74 128 110"/>
    <circle class="pol-sv-pulse" cx="90" cy="62" r="5"/>`,
  dice: `<g class="pol-sv-tilt"><rect x="46" y="24" width="76" height="76" rx="14"/>
      <circle cx="68" cy="46" r="6"/><circle cx="100" cy="78" r="6"/><circle cx="84" cy="62" r="6"/></g>`,
  shield: `<path d="M90 12 L142 32 L142 66 C142 94 118 108 90 116 C62 108 38 94 38 66 L38 32 Z"/>
    <path d="M90 42 L90 88"/><g class="pol-sv-ping"><circle cx="90" cy="64" r="44" class="pol-sv-ring"/></g>`,
  forge: `<path d="M22 110 L158 110"/><path d="M36 110 L36 46 L74 46 L74 110"/><path d="M74 66 L128 66 L128 110"/>
    <g class="pol-sv-slow"><path d="M55 46 L55 18"/></g><circle class="pol-sv-spark" cx="55" cy="14" r="7"/>`,
  ledger: `<path d="M40 14 L140 14 L140 110 L40 110 Z"/><path d="M40 38 L140 38"/><path d="M70 14 L70 110"/>
    <path d="M86 58h38M86 76h38M86 94h24"/><circle class="pol-sv-pulse" cx="55" cy="26" r="5"/>`,
  map: `<g class="pol-sv-slow"><path d="M20 32 L64 14 L112 32 L160 14 L160 96 L112 114 L64 96 L20 114 Z"/>
      <path d="M64 14 L64 96 M112 32 L112 114"/></g>
    <circle class="pol-sv-pulse" cx="90" cy="60" r="6"/>`,
  medal: `<circle cx="90" cy="76" r="32"/>
    <path d="M90 58 L96 70 L109 72 L99 81 L102 94 L90 88 L78 94 L81 81 L71 72 L84 70 Z"/>
    <path d="M64 12 L76 46 M116 12 L104 46"/>
    <g class="pol-sv-halo"><circle cx="90" cy="76" r="44" class="pol-sv-ring"/></g>`,
  ping: `<circle cx="90" cy="62" r="9"/>
    <path d="M62 34 A40 40 0 0 0 62 90 M118 34 A40 40 0 0 1 118 90"/>
    <g class="pol-sv-ping"><circle cx="90" cy="62" r="46" class="pol-sv-ring"/></g>
    <g class="pol-sv-ping pol-sv-ping2"><circle cx="90" cy="62" r="46" class="pol-sv-ring"/></g>`,
  quill: `<g class="pol-sv-tilt"><path d="M38 112 C74 100 100 76 122 36 L136 12 L104 28 C64 50 46 78 38 112 Z"/>
      <path d="M38 112 L84 66"/></g>
    <circle class="pol-sv-pulse" cx="46" cy="112" r="5"/>`,
};
if (typeof polGlyph === 'function') {
  const _polGlyphRaw = polGlyph;
  window.polGlyph = function (kind, cls) {
    if (!EST_GL[kind]) return _polGlyphRaw(kind, cls);
    return `<svg class="pol-gl${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${EST_GL[kind]}</svg>`;
  };
}
if (typeof polScene === 'function') {
  const _polSceneRaw = polScene;
  window.polScene = function (kind) {
    if (!EST_SV[kind]) return _polSceneRaw(kind);
    return `<svg class="pol-sv" viewBox="0 0 180 124" aria-hidden="true">${EST_SV[kind]}</svg>`;
  };
}

// ── Каркас экрана ──────────────────────────────────────────────
function estScr(key) { return EST_SCR[key] || null; }
function estSecs(key) {
  const s = estScr(key); if (!s) return {};
  if (!s.hide) return s.sec;
  const out = {};
  Object.entries(s.sec).forEach(([k, d]) => { if (!s.hide(k)) out[k] = d; });
  return out;
}
function estTab(key) {
  const s = estScr(key), secs = estSecs(key);
  let t = EST.tab[key] || s.def;
  if (!secs[t]) t = Object.keys(secs)[0] || s.def;
  return t;
}
// Рельса зовёт ОДНО имя: открытый экран всегда один, ключ берём из состояния —
// иначе в onclick пришлось бы протаскивать два аргумента через шаблон politics.js.
function estSetCur(tab) { if (EST.open) estSet(EST.open, tab); }
function estSet(key, tab) {
  EST.tab[key] = tab; estRefresh(key);
  const b = document.querySelector('#' + estScr(key).el + ' .pol-body'); if (b) b.scrollTop = 0;
}

function estClose(key) {
  const s = estScr(key); if (!s) return;
  const el = document.getElementById(s.el); if (!el) return;
  el.classList.remove('show'); el.setAttribute('aria-hidden', 'true'); el.innerHTML = '';
  if (EST.open === key) EST.open = null;
  if (typeof _heroVNView !== 'undefined' && _heroVNView === s.view) _heroVNView = null;
}
// Уходим на любой другой экран новеллы — гасим все свои (кроме целевого).
function estCloseAll(exceptView) {
  Object.keys(EST_SCR).forEach(k => { if (EST_SCR[k].view !== exceptView) estClose(k); });
}
function estReturn(key) { if (typeof heroVNBack === 'function') heroVNBack(estScr(key).view); }

// Переход на экран хозяйства ОТКУДА УГОДНО (двери кабинета, ссылки внутри
// разделов). Новелла на главной поднимается асинхронно — ждём её контроллер,
// а не стреляем в пустоту фиксированным setTimeout (та же логика, что polGoto).
function estGoto(view) {
  const scr = Object.keys(EST_SCR).filter(k => EST_SCR[k].view === view)[0];
  if (!scr) return;
  // Работа вернулась в кабинет — см. шапку cabinet.js.
  if (typeof cabGoto === 'function') { cabGoto(view); return; }
  if (typeof go === 'function' && typeof curSlug !== 'undefined' && curSlug !== 'home') go('home', false);
  let tries = 0;
  const tick = () => {
    const ready = (typeof _heroVNCtl !== 'undefined' && _heroVNCtl) && document.getElementById(EST_SCR[scr].el);
    if (ready) { heroVNChoice(view); return; }
    if (++tries > 40) { if (typeof toast === 'function') toast('Экран доступен на главной, в меню новеллы', 'inf'); return; }
    setTimeout(tick, 80);
  };
  setTimeout(tick, 60);
}

async function estOpen(key) {
  const s = estScr(key); if (!s) return;
  const el = document.getElementById(s.el); if (!el) return;
  EST.open = key;
  el.classList.add('show'); el.setAttribute('aria-hidden', 'false');
  const back = `estReturn.bind(null,'${key}')`;
  el.innerHTML = polMsg(s.title, back, 'Поднимаю ведомости…');
  try {
    if (!(await polEnsureData(el, s.title, back))) return;
    if (s.load) s.load();
    if (!el.classList.contains('show')) return;
    estRefresh(key);
  } catch (e) {
    console.error('[estate]', e);
    if (el.classList.contains('show')) {
      el.innerHTML = polErr(s.title, back, 'Ведомости не поднялись — связь с канцелярией потеряна.',
        `estOpen('${key}')`, (e && e.message) || '');
    }
  }
}

function estRefresh(key) {
  const s = estScr(key); if (!s) return;
  const el = document.getElementById(s.el);
  if (!el || !el.classList.contains('show')) return;
  const secs = estSecs(key), tab = estTab(key), def = secs[tab];
  if (!def) { el.innerHTML = polMsg(s.title, `estReturn.bind(null,'${key}')`, 'Разделы этого ведомства закрыты на реконструкцию.'); return; }
  const prev = el.querySelector('.pol-body');
  const keep = prev ? prev.scrollTop : 0;
  let body;
  POL.chrome = true;                    // тела вкладок не рисуют свой ec-intro
  try { body = def.body(); }
  catch (e) { console.error('[estate]', e); body = `<div class="hp-vn-col-empty">Сбой отрисовки раздела: ${esc(e && e.message || String(e))}</div>`; }
  finally { POL.chrome = false; }
  el.innerHTML = polHead(s.title, `estReturn.bind(null,'${key}')`) +
    `<div class="hp-vn-col-body pol-shell">
       ${polRail(secs, tab, 'estSetCur')}
       <div class="pol-stage pol-body">
         ${polPrologue(key + ':' + tab, def)}
         <div class="pol-content">${body}</div>
       </div>
     </div>`;
  polStripTeach(el);
  polChapterize(el, 'e:' + key + ':' + tab);
  const b = el.querySelector('.pol-body'); if (b && keep) b.scrollTop = keep;
  if (s.after) setTimeout(() => { try { s.after(); } catch (e) {} }, 0);
}

// Перерисовать открытый экран хозяйства (после любого действия экономики).
function estRefreshOpen() { if (EST.open) estRefresh(EST.open); }

// ── Кабинет перерисовывается на главной ────────────────────────
// Половина действий экономики зовёт ecPaintCabinet() напрямую, а он делает
// setPg() — замену ВСЕЙ страницы. С экрана новеллы это выбрасывало игрока в
// кабинет посреди разговора. Перехватываем: вне страницы кабинета перерисовываем
// открытый экран новеллы, а страницу не трогаем.
// ⚠️ И ТО ЖЕ САМОЕ ВНУТРИ КАБИНЕТА. Ведомства теперь открываются окнами прямо
// над кабинетом (cabinet.js), а ecPaintCabinet → cabPaint делает setPg — замену
// ВСЕЙ страницы. Значит любое действие (купил, построил, продал) выбрасывало бы
// игрока из открытого ведомства обратно в приёмную. Поэтому решает не «на какой
// мы странице», а «открыто ли сейчас ведомство»: открыто — перерисовываем ЕГО,
// страницу не трогаем.
function _ecScreenOpen() {
  if (typeof EST === 'object' && EST && EST.open) return true;
  const p = document.getElementById('hp-vn-pol');
  if (p && p.classList.contains('show')) return true;
  const d = document.getElementById('hp-vn-dip');
  if (d && d.classList.contains('show')) return true;
  return false;
}
if (typeof ecPaintCabinet === 'function') {
  const _ecPaintCabinetRaw = ecPaintCabinet;
  window.ecPaintCabinet = function () {
    if (_ecScreenOpen() || (typeof curSlug !== 'undefined' && curSlug !== 'economy')) {
      estRefreshOpen();
      if (typeof polRefresh === 'function') polRefresh();
      if (typeof dipRefresh === 'function') dipRefresh();
      return;
    }
    return _ecPaintCabinetRaw.apply(this, arguments);
  };
}
