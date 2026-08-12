// © 2025–2026. Все права защищены.
// ═══════════════════════════════════════════════════════════════
// КАБИНЕТ ДЕРЖАВЫ (#economy) — РАБОЧАЯ КОМНАТА.
//
// ⚠️ ПОЧЕМУ ОН ВЕРНУЛСЯ. Кабинет закрыли и всю работу увезли в новеллу: каждое
// ведомство стало «экраном» поверх сцены на главной. Разговор вышел красивый, а
// работа — нет:
//   1) экраны грузились КАЖДЫЙ САМ ЗА СЕБЯ и время от времени отваливались
//      (внутренняя/внешняя политика, войска) — лечилось только F5;
//   2) единственной дверью в работу стало меню из полутора десятков реплик:
//      чтобы сравнить казну с военпромом, игрок выходил в разговор и заходил
//      заново — новелла оказалась НЕ рамкой работы, а турникетом перед ней.
//
// Теперь роли разведены честно:
//   • НОВЕЛЛА — приветствие. Красивая сцена, новости, забавы. Работы в ней нет.
//   • КАБИНЕТ — работа. Все ведомства державы, одна дверь, одна загрузка.
//
// Экраны при этом НЕ переписаны и не продублированы: каркасы politics.js,
// estate.js и render.js остались как есть, кабинет лишь хостит их контейнеры у
// себя (vnScreenHosts) и открывает теми же функциями. CSS уже делает открытый
// экран `position:fixed`-окном поверх страницы — то есть из кабинета он
// открывается окном НАД кабинетом, и «назад» возвращает в кабинет, а не
// выбрасывает на главную. Одна реализация каждого раздела, одно место правды.
// ═══════════════════════════════════════════════════════════════

// ⚠️ ВЕДОМСТВО — ВКЛАДКА, А НЕ ОКНО. Сперва ведомства открывались поверх
// кабинета `position:fixed`-окном (так их рисует CSS в новелле). Получилось
// то же, от чего уходили: чтобы перейти из казны в военпром, игрок закрывал
// окно, возвращался в приёмную и открывал второе. Кабинет снова листается:
// сверху — рельса ведомств, ниже — тело открытого, страница не перекрывается,
// сайдбар и «на главную» остаются на месте. Окном экран остаётся ТОЛЬКО в
// новелле; в кабинете его распластывает `#cab-stage` (30_cabinet.css).

const CAB = {
  dept: null,        // какое ведомство открыто (null = стоим в приёмной)
};

// ═══════════════════════════════════════════════════════════════
// ОДНО МЕНЮ НА ЭКРАН: горизонтальные полосы вкладок → в левую колонку.
//
// ⚠️ ПОЧЕМУ ЭТО ЗДЕСЬ, А НЕ В КАЖДОМ ЭКРАНЕ. Экраны писались порознь и каждый
// завёл СВОЮ полосу вкладок своей формы: разведка — рамочные чипы
// (`.hp-vni-tabs`), Длань — красные коробки (`.hp-vnd-tabs`), исследования —
// свои (`.hp-vnr-tabs`), войска — плитки родов войск (`.ec-fb-tabs`), экономика —
// круглые чипы (`.ec-tabs`). В кабинете они складывались этажами: рельса
// ведомств сверху, колонка разделов слева, полоса вкладок над телом, а внутри
// тела ещё одна. Четыре навигации четырёх дизайнов на одном экране.
//
// Править полтора десятка шаблонов — это полтора десятка мест, где завтра
// разъедется снова. Поэтому перестановка ОДНА и живёт на уровне DOM: что бы
// экран ни нарисовал, его полоса вкладок переезжает в меню слева. Кнопки —
// те же узлы с теми же onclick, ничего не пересоздаётся, экраны не тронуты.
// ═══════════════════════════════════════════════════════════════

// Полосы, которые считаем навигацией экрана. Порядок неважен.
const CAB_STRIPS = ['.hp-vni-tabs', '.hp-vnd-tabs', '.hp-vnr-tabs', '.ec-fb-tabs', '.ec-tabs'];

// На телефоне колонки нет: там меню и так свёрнуто в строку, а вкладки —
// прокручиваемая лента. Перестановку делаем только на широком экране.
function _cabWide() {
  try { return !window.matchMedia('(max-width:768px)').matches; } catch (e) { return true; }
}

// Куда лечь полосе в экране, у которого УЖЕ есть рельса (politics/estate):
// в неё же, ступенькой ниже активного пункта. Главы туда кладёт polChapterize
// (`.pol-chaps-sub`), значит вкладки внутри главы — третий уровень: цепляемся
// за активную главу, а если глав нет — за активный раздел.
function _cabRailAnchor(shell) {
  return shell.querySelector('.pol-chaps-sub .pol-chap.on')
      || shell.querySelector('.pol-rail .pol-rail-b.on');
}

function cabRailify(root) {
  const host = root || document.getElementById('cab-stage');
  if (!host || !_cabWide()) return;
  // В рельсу пускаем ОДНУ полосу на экран: вторая и третья («потоки», «фильтры»
  // внутри тела) — местная навигация своего блока, в общем меню она была бы
  // списком без хозяина. Им достаётся своя колонка на месте.
  const taken = new Set();
  CAB_STRIPS.forEach(sel => {
    host.querySelectorAll(sel).forEach(strip => {
      // Уже переставлена (свой прошлый проход) — не трогаем.
      if (strip.dataset.cabRail === '1') return;
      if (!strip.parentNode || !strip.children.length) return;

      const shell = strip.closest('.pol-shell');
      const anchor = (shell && !taken.has(shell)) ? _cabRailAnchor(shell) : null;
      if (anchor) {
        taken.add(shell);
        strip.dataset.cabRail = '1';
        strip.classList.add('cab-vrail', 'cab-vrail-deep');
        anchor.after(strip);
        return;
      }

      // Рельсы нет (разведка, Длань, исследования) — строим её из полосы:
      // всё, что шло ПОСЛЕ полосы, уезжает в правую колонку.
      const parent = strip.parentNode;
      if (parent.classList && parent.classList.contains('cab-split-rail')) return;
      const split = document.createElement('div');
      split.className = 'cab-split';
      const railBox = document.createElement('div');
      railBox.className = 'cab-split-rail';
      const col = document.createElement('div');
      col.className = 'cab-split-col';
      const after = [];
      for (let n = strip.nextSibling; n; n = n.nextSibling) after.push(n);
      parent.insertBefore(split, strip);
      strip.dataset.cabRail = '1';
      strip.classList.add('cab-vrail');
      railBox.appendChild(strip);
      after.forEach(n => col.appendChild(n));
      split.appendChild(railBox);
      split.appendChild(col);
    });
  });
}

// ── ПОДПИСИ ДЛЯ КОЛОНКИ ГЛИФОВ ─────────────────────────────────
// В кабинете борт сайта ужат до иконок (`#app.cab-mode`, 30_cabinet.css) — а
// глиф без подписи это ребус: «⬡ или ⛬ — где фракции?». Название переезжает в
// tooltip. Забираем его из самой разметки: у пунктов сайта подпись лежит голым
// текстовым узлом, у разделов вики — в `.nl-name` (рядом ещё счётчик страниц,
// он в подписи не нужен). Ставим ВСЕГДА: в развёрнутом борте tooltip не мешает.
function cabSbTitles() {
  const sb = document.getElementById('sb');
  if (!sb) return;
  sb.querySelectorAll('.n-home,.n-group-hdr,.nl-hdr').forEach(el => {
    if (el.title) return;
    const nm = el.querySelector('.nl-name,.n-group-t');
    const t = ((nm ? nm.textContent : el.textContent) || '').replace(/\s+/g, ' ').trim();
    if (t) el.title = t;
  });
}

// Экраны перерисовывают себя сами и из десятка мест (ecReloadPaint, свои
// refresh, ответы сервера). Ловить все вызовы — снова полтора десятка правок,
// поэтому слушаем сам DOM: подменили тело — переставили полосу заново.
// Кадр ожидания нужен, чтобы не бегать по разметке на каждый узел вставки.
(function _cabRailWatch() {
  if (typeof MutationObserver !== 'function') return;
  let queued = false;
  const mo = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      try { cabRailify(); } catch (e) {}
      // Борт пересобирает buildNav (вход, смена языка, обновление счётчиков) —
      // подписи после этого проставляются заново тем же наблюдателем.
      try { cabSbTitles(); } catch (e) {}
    });
  });
  const start = () => {
    const stage = document.getElementById('cab-stage');
    if (stage) { try { cabRailify(stage); } catch (e) {} }
    try { cabSbTitles(); } catch (e) {}
    mo.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

// ── Ведомства ──────────────────────────────────────────────────
// ic   — ключ глифа (polGlyph/EST_GL): рисованная линия, не эмодзи.
// grp  — колонка приёмной: земля · достаток · сила · слово.
// sh   — короткое имя для нижней панели телефона (mobile_nav.js): на кнопку в
//        четверть экрана «Внутренняя политика» не влезает, а многоточие не
//        говорит ничего. Полное имя остаётся в дверях, меню и листе.
// open/close — ТЕ ЖЕ функции, которыми экран открывался из новеллы.
// need — условие показа (Длань открыта исследованием и т.п.).
// ⚠️ ПОРЯДОК КЛЮЧЕЙ = ПОРЯДОК В МЕНЮ И В ДВЕРЯХ. «Статистика державы» стоит
// ВТОРОЙ намеренно: с неё начинается любой заход («что у меня с деньгами»), и
// в хвосте группы «Достаток» её приходилось выискивать глазами.
const CAB_DEPT = {
  ipol:     { nm: 'Внутренняя политика', sh: 'Политика', sub: 'двор, благополучие, курс державы, вера', ic: 'throne', grp: 'land',
              open: () => polOpen(), close: () => polClose() },
  stat:     { nm: 'Статистика державы', sh: 'Статистика', sub: 'роспись дохода и достижения', ic: 'ledger', grp: 'land',
              open: () => estOpen('stat'), close: () => estClose('stat') },
  dipl:     { nm: 'Внешняя политика', sh: 'Дипломатия', sub: 'границы, война, союзы, кредиты, аванпосты', ic: 'gate', grp: 'land',
              open: () => dipOpen(), close: () => dipClose() },
  colony:   { nm: 'Колонизация', sh: 'Колонизация', sub: 'захват систем и заселение планет', ic: 'map', grp: 'land',
              open: () => heroVNColonyOpen(), close: () => heroVNColonyClose() },
  planets:  { nm: 'Управление колониями', sh: 'Колонии', sub: 'застройка планет, ячейки и слоты', ic: 'forge', grp: 'land',

              open: () => heroVNPlanetsOpen(), close: () => heroVNPlanetsClose() },

  mine:     { nm: 'Добыча ресурсов', sh: 'Добыча', sub: 'залежи, рабочие, концессии', ic: 'pick', grp: 'wealth',
              open: () => estOpen('mine'), close: () => estClose('mine') },
  trade:    { nm: 'Торговля', sh: 'Торговля', sub: 'караваны, рынок, обмен', ic: 'caravan', grp: 'wealth',
              open: () => estOpen('trade'), close: () => estClose('trade') },
  exch:     { nm: 'Биржа', sh: 'Биржа', sub: 'организации, заказы, деривативы', ic: 'tower', grp: 'wealth',
              open: () => estOpen('exch'), close: () => estClose('exch') },

  army:     { nm: 'Вооружённые силы', sh: 'Войска', sub: 'состав войск и военпром', ic: 'shield', grp: 'might',
              open: () => estOpen('army'), close: () => estClose('army') },
  research: { nm: 'Исследования', sh: 'Наука', sub: 'древо технологий и очередь', ic: 'compass', grp: 'might',
              open: () => heroVNResearchOpen(), close: () => heroVNResearchClose() },
  intel:    { nm: 'Разведуправление', sh: 'Разведка', sub: 'агентура, операции, досье, контрразведка', ic: 'sat', grp: 'might',
              open: () => heroVNIntelOpen(), close: () => heroVNIntelClose() },
  doom:     { nm: 'Штаб артиллерии', sh: 'Артиллерия', sub: 'протокол последнего довода', ic: 'war', grp: 'might',
              // Длань скрыта, пока не исследована «Сама неотвратимость» (зеркало меню новеллы).
              need: () => { try { return (typeof ecDoomUnlocked === 'function' && EC.eco && ecDoomUnlocked())
                                    || localStorage.getItem('wk_doom_unlocked') === '1'; } catch (e) { return false; } },
              open: () => heroVNDoomOpen(), close: () => heroVNDoomClose() },

  press:    { nm: 'Вестник державы', sh: 'Вестник', sub: 'новости от лица государства', ic: 'quill', grp: 'word',
              open: () => estOpen('press'), close: () => estClose('press') },
  tama:     { nm: 'Фонд невмешательства', sh: 'Фонд', sub: 'дозвёздные миры и решения по ним', ic: 'temple', grp: 'word',
              open: () => heroVNTamaOpen(), close: () => heroVNTamaClose() },
  sinli:    { nm: 'Синли-бей', sh: 'Синли-бей', sub: 'невольничий рынок', ic: 'swap', grp: 'word',
              // Зеркало серверного гейта: «просвещённым» державам рынок не показываем.
              need: () => { try { return !(typeof ecIsEnlightened === 'function' && EC.app && ecIsEnlightened()); }
                            catch (e) { return true; } },
              open: () => heroVNSinliOpen(), close: () => heroVNSinliClose() },

  // ⚠️ ЗАБАВЫ ТОЖЕ ЗДЕСЬ. Это остаток меню новеллы («Давай поиграем» и «Рейтинг
  // игроков»): экраны те же самые, но открывать их из приветствия было неоткуда —
  // меню сняли вместе с псевдокабинетом на главной. Отдельная группа, а не
  // подмешаны к ведомствам: державой они не управляют, и путать их с работой не
  // надо. Новости и достижения двери не получили — они на столе приёмной.
  fight:    { nm: 'Бойцовский клуб', sh: 'Клуб', sub: 'дуэли на выданных кораблях и ставки', ic: 'dice', grp: 'play',
              open: () => heroVNFightOpen(), close: () => heroVNFightClose() },
  geo:      { nm: 'Георазведка', sh: 'Георазведка', sub: 'поиск залежей на своих планетах', ic: 'ping', grp: 'play',
              open: () => heroVNGeoOpen(), close: () => heroVNGeoClose() },
  stars:    { nm: 'Всмотреться в Разлом', sh: 'Разлом', sub: 'псионический хор и его дары', ic: 'chalice', grp: 'play',
              open: () => heroVNStarsOpen(), close: () => heroVNStarsClose() },
  fish:     { nm: 'Уйти в пустоту', sh: 'Пустота', sub: 'материки секторов и туманность меж ними', ic: 'hour', grp: 'play',
              open: () => heroVNFishOpen(), close: () => heroVNFishClose() },
  rating:   { nm: 'Рейтинг игроков', sh: 'Рейтинг', sub: 'кто чего стоит в секторе', ic: 'medal', grp: 'play',
              open: () => heroVNRatingOpen(), close: () => heroVNRatingClose() },
};

const CAB_GRP = [
  ['land',   'Земля и власть'],
  ['wealth', 'Достаток'],
  ['might',  'Сила'],
  ['word',   'Слово'],
  ['play',   'Досуг'],
];

// Показывать ли ведомство (гейты по исследованиям/доктрине).
function cabDepts() {
  const out = {};
  Object.entries(CAB_DEPT).forEach(([k, d]) => { if (!d.need || d.need()) out[k] = d; });
  return out;
}

// ── Открыть / закрыть ведомство ────────────────────────────────
// Гасим ВСЕ остальные, иначе два тела лягут друг на друга: у экранов нет общего
// менеджера, каждый знает только про себя.
function cabCloseAll(except) {
  Object.entries(CAB_DEPT).forEach(([k, d]) => {
    if (k === except) return;
    try { d.close(); } catch (e) {}
  });
}

// Переключение вкладки: рельса и заголовок обязаны перерисоваться вместе с
// телом, поэтому открывает не сама функция, а cabPaint (её хвост) — одно место,
// где ведомство поднимается, что при клике по рельсе, что после setPg.
function cabOpen(key) {
  if (!cabDepts()[key]) return;
  cabCloseAll(key);
  CAB.dept = key;
  cabPaint();
  // Прыжок вверх: вкладку переключили — читать её начинают с шапки, а не
  // с той высоты, до которой доскроллили предыдущую.
  try { const w = document.getElementById('cw'); if (w) w.scrollTop = 0; } catch (e) {}
}

// Возврат из ведомства В ПРИЁМНУЮ. Раньше «назад» звал heroVNBack и уводил в
// меню новеллы — то есть из работы в разговор. Теперь работа замкнута на себя.
function cabBack() {
  cabCloseAll(null);
  CAB.dept = null;
  cabPaint();
}

// Переход в ведомство ОТКУДА УГОДНО (ссылки внутри тел разделов: «продайте на
// Рынке», «постройте во вкладке Колонии»). Заменяет прежние polGoto/estGoto/
// heroVNGoto, которые сперва увозили игрока на главную.
function cabGoto(key) {
  if (!CAB_DEPT[key]) return;
  if (typeof curSlug !== 'undefined' && curSlug !== 'economy') {
    // Переход НАСТОЯЩИЙ (в истории появляется #economy), а дальше ждём, пока
    // страница нарисуется и появятся контейнеры экранов.
    if (typeof go === 'function') go('economy');
    let tries = 0;
    const tick = () => {
      if (document.getElementById('cab-stage')) { cabOpen(key); return; }
      if (++tries > 60) return;
      setTimeout(tick, 80);
    };
    setTimeout(tick, 80);
    return;
  }
  cabOpen(key);
}

// ── СТОЛ: ЧЕМ КАБИНЕТ ВСТРЕЧАЕТ ────────────────────────────────
// Приёмная открывалась сеткой дверей — то есть вопросом «куда пойдёшь?».
// Правильный первый экран отвечает на другой вопрос: «что случилось, пока меня
// не было». Поэтому сверху лежит стол: свежие события галактики и отдельно —
// те, где назвали ИМЕННО ЭТУ державу. Рядом с ними кнопка статистики: прочитал,
// что о тебе пишут, — сразу сверил цифры, не разыскивая ведомство в меню.

// Новости и упоминания живут в faction_news.js (FN.approved — вестник игроков,
// FN.events — сводки и слухи сектора). На #economy лента могла не грузиться
// вовсе: её тянула главная. Подтягиваем сами, ОДИН раз, и перерисовываем стол.
let _cabNewsBoot = false;
function cabNewsBoot() {
  if (_cabNewsBoot || typeof fnLoadApproved !== 'function') return;
  if (typeof FN === 'object' && ((FN.approved || []).length || (FN.events || []).length)) { _cabNewsBoot = true; return; }
  _cabNewsBoot = true;
  fnLoadApproved().then(() => { if (!CAB.dept && document.getElementById('cab-desk')) cabPaint(); }).catch(() => {});
}

// Все записи одной лентой, свежие сверху.
function _cabFeed() {
  if (typeof FN !== 'object') return [];
  return [...(FN.approved || []), ...(FN.events || [])]
    .sort((a, b) => new Date(b.published_at || b.created_at || 0) - new Date(a.published_at || a.created_at || 0));
}

// Упоминания. Три способа назвать державу, и все три встречаются в текстах:
// пинг `[fac:FID]` (ставит композитор), имя державы прямым текстом (пишут руками)
// и имя правителя. Ищем по заголовку и телу, регистр и «ё» не различаем.
function _cabMentions(feed) {
  const fid = String(EC.fid || EC.app.faction_id || '');
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
  const names = [EC.app.name, EC.app.leader].map(norm).filter(n => n.length > 2);
  return feed.filter(n => {
    const hay = norm(n.title) + ' ' + norm(n.body || n.text || '');
    if (fid && hay.includes('[fac:' + norm(fid))) return true;
    return names.some(nm => hay.includes(nm));
  });
}

function _cabNewsRow(n) {
  const t = (typeof vnPlain === 'function' ? vnPlain(n.title) : (n.title || '')) || 'Без заголовка';
  const flag = (typeof fnFeedFlagHtml === 'function') ? fnFeedFlagHtml(n) : '';
  const d = new Date(n.published_at || n.created_at || 0);
  const when = isNaN(d) ? '' : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `<button class="cab-nw" type="button" onclick="fnOpenArticle('${jsq(n.id)}')">
    ${flag || '<span class="cab-nw-dot"></span>'}
    <span class="cab-nw-t">${esc(t)}</span>
    <span class="cab-nw-d">${when}</span>
  </button>`;
}

// Сегодняшние достижения. Это бывший пункт новеллы «Достижения за сегодня»:
// та же выборка (события с меткой достижения за календарные сутки), только
// теперь она лежит на столе, а не за двумя уровнями разговора на главной.
function _cabAch(feed) {
  if (typeof fnIsAch !== 'function') return [];
  const today = n => {
    const d = new Date(n.published_at || n.created_at || 0);
    if (isNaN(d)) return false;
    const t = new Date();
    return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
  };
  return feed.filter(n => fnIsAch(n) && today(n));
}

function cabDeskHtml() {
  cabNewsBoot();
  const feed = _cabFeed();
  const mine = _cabMentions(feed).slice(0, 5);
  const ach = _cabAch(feed).slice(0, 5);
  // Достижения — часть ленты, и в общей сводке они бы её забили в удачный день.
  const news = feed.filter(n => !(typeof fnIsAch === 'function' && fnIsAch(n))).slice(0, 6);
  const empty = t => `<div class="cab-nw-empty">${esc(t)}</div>`;
  // ⚠️ СТАТИСТИКИ ЗДЕСЬ НЕТ, И ЭТО НАРОЧНО. Сперва она была строчкой-ссылкой в
  // углу заголовка (терялась), потом плиткой-кнопкой третьей колонкой — и та
  // растянулась по высоте соседних списков в пустую коробку с надписью.
  // «Второй» она сделана там, где это и значит второй: ВТОРЫМ ВЕДОМСТВОМ —
  // и в меню, и в дверях приёмной (см. порядок CAB_DEPT).
  return `<div class="cab-desk" id="cab-desk">
    <section class="cab-card">
      <h2 class="cab-grp-hd">Сводка сектора</h2>
      ${news.length ? news.map(_cabNewsRow).join('') : empty('Лента пуста — в галактике тихо.')}
    </section>
    <section class="cab-card">
      <h2 class="cab-grp-hd">О вас пишут</h2>
      ${mine.length ? mine.map(_cabNewsRow).join('') : empty('Пока о державе не писали. Слово за вами — «Вестник державы».')}
    </section>
    <section class="cab-card">
      <h2 class="cab-grp-hd">Достижения за сегодня</h2>
      ${ach.length ? ach.map(_cabNewsRow).join('') : empty('Сегодня в секторе никто не отличился.')}
    </section>
  </div>`;
}

// ЗАБАВЫ НА СТОЛЕ. Из меню сняты (см. railItems) и дверей отдельной группой тоже
// не получили: державой они не управляют, и полноразмерная плитка равняла их с
// ведомствами. Тонкая полоса под столом — «между делом», одной строкой.
function cabPlayHtml() {
  const glyph = k => (typeof polGlyph === 'function' ? polGlyph(k) : '');
  const items = Object.entries(cabDepts()).filter(([, d]) => d.grp === 'play');
  if (!items.length) return '';
  return `<nav class="cab-play" aria-label="Досуг">
    <span class="cab-play-hd">Досуг</span>
    ${items.map(([k, d]) => `
      <button class="cab-play-t" type="button" onclick="cabOpen('${k}')" title="${esc(d.sub)}">
        <span class="cab-play-ic">${glyph(d.ic)}</span>${esc(d.nm)}
      </button>`).join('')}
  </nav>`;
}

// ── Отрисовка приёмной ─────────────────────────────────────────
// Приёмная — НЕ «свалка вкладок», как старый кабинет, и не голая сетка дверей,
// как предбанник после переезда. Сверху казна (её игрок сверяет чаще всего),
// ниже — ведомства, разложенные по тому, как в державе живут: земля и власть,
// достаток, сила, слово.
function cabPaint() {
  if (!EC.app || !EC.app.faction_id) return;
  ecDepRawReset();   // ⛏ кэш сырых сумм по залежам — пересобрать на свежих постройках
  const col = ecReadable(EC.app.color);
  const img = (EC.app && (EC.app.herald_url || EC.app.image_url)) || '';
  const coverBg = img
    ? `<img class="ec-cover-img" src="${esc(img)}" alt=""><div class="ec-cover-fade"></div>`
    : `<div class="ec-cover-bg" style="background:linear-gradient(135deg, ${col}33, var(--b1) 70%)"></div>`;

  // Служащий: напоминаем, чьим именем он действует и что ему дозволено.
  const memberBanner = (EC.member && !EC.actAs)
    ? `<div class="cab-banner">
        <span>⚑ Вы на службе державы <b>${esc(EC.app.name || '')}</b> — ${esc(EC.member.role_title || '')}. Действия вне выданных прав сервер отклонит.</span>
        <span class="cab-banner-tail">${((typeof FM === 'object' && FM.me && FM.me.perms) || []).map(c => { const p = (typeof FM_PERMS !== 'undefined' ? FM_PERMS : []).find(x => x[0] === c); return p ? p[1] : ''; }).join(' ')}</span>
      </div>`
    : '';
  const adminBanner = EC.actAs
    ? `<div class="cab-banner cab-banner-adm">
        <span>🔑 Режим администрации — вы в кабинете державы <b>${esc(EC.actAs.name || EC.app.name || '')}</b>. Игрок не снят; изменения через серверные действия могут не примениться к этой державе.</span>
        <button class="btn btn-gh btn-sm cab-banner-tail" onclick="ecExitImpersonation()">✕ Выйти из кабинета</button>
      </div>`
    : '';

  const depts = cabDepts();
  const glyph = k => (typeof polGlyph === 'function' ? polGlyph(k) : '');
  const inbox = (typeof FM === 'object' && FM.me && FM.me.is_owner && !EC.actAs) ? (+FM.me.inbox || 0) : 0;
  const badge = k => (k === 'ipol' && inbox) ? `<span class="cab-door-n">${inbox}</span>` : '';

  // Рельса ведомств — то самое «листать кабинет»: из казны в военпром одним
  // кликом, без возврата в приёмную. Порядок — как в приёмной (по укладу).
  // ⚠️ ЗАБАВ В МЕНЮ НЕТ. Рельса — навигация ПО РАБОТЕ: из казны в военпром. Клуб,
  // Георазведка, Разлом и рыбалка занимали в ней целую строку и всё время были
  // на глазах, будто это ведомства. Их место — полоса на столе приёмной.
  const railItems = CAB_GRP.flatMap(([g]) => g === 'play' ? [] : Object.entries(depts).filter(([, d]) => d.grp === g));
  const rail = `<nav class="cab-rail" aria-label="Ведомства">
    <button class="cab-rail-t${CAB.dept ? '' : ' on'}" type="button" onclick="cabBack()">⌂ Приёмная</button>
    ${railItems.map(([k, d]) => `
      <button class="cab-rail-t${CAB.dept === k ? ' on' : ''}" type="button" onclick="cabOpen('${k}')" title="${esc(d.sub)}">
        <span class="cab-rail-ic">${glyph(d.ic)}</span>${esc(d.nm)}${badge(k)}
      </button>`).join('')}
  </nav>`;

  const groups = CAB_GRP.map(([g, label]) => {
    if (g === 'play') return '';   // забавы лежат полосой на столе (cabPlayHtml)
    const items = Object.entries(depts).filter(([, d]) => d.grp === g);
    if (!items.length) return '';
    return `<section class="cab-grp">
      <h2 class="cab-grp-hd">${esc(label)}</h2>
      <div class="cab-doors">${items.map(([k, d]) => `
        <button class="cab-door" type="button" onclick="cabOpen('${k}')">
          <span class="cab-door-ic">${glyph(d.ic)}</span>
          <span class="cab-door-tx"><b>${esc(d.nm)}</b><i>${esc(d.sub)}</i></span>
          ${badge(k) || '<span class="cab-door-arr">↗</span>'}
        </button>`).join('')}</div>
    </section>`;
  }).join('');

  setPg(`<div class="ec-wrap cab-wrap">
    ${memberBanner}${adminBanner}
    <div class="ec-cover cab-cover" style="--fac:${col}">
      ${coverBg}
      <div class="ec-cover-scan"></div>
      <div class="ec-cover-hud hud-tl"></div><div class="ec-cover-hud hud-tr"></div>
      <div class="ec-cover-inner">
        <div class="ec-cover-row">
          <h1 class="ec-cover-title">${esc(EC.app.name || 'Моя держава')}</h1>
          <div class="ec-cover-btns">
            <button class="btn btn-gh btn-sm" onclick="go('home')" title="Вернуться к сцене на главной">↩ На главную</button>
            <button class="btn btn-gh btn-sm" onclick="go('guide')" title="Полные правила и механики игры">❓ Как играть</button>
          </div>
        </div>
        ${ecTreasuryHtml()}
      </div>
    </div>
    <!-- ⚠️ МЕНЮ ТОЛЬКО ВНУТРИ ВЕДОМСТВА. В приёмной оно стояло всегда — и было
         ЧИСТЫМ ДУБЛЁМ: те же полтора десятка названий второй раз, сразу над
         дверями, которые и есть навигация приёмной. Меню нужно там, где дверей
         не видно: когда ведомство открыто и надо перейти в соседнее. -->
    ${CAB.dept ? rail : ''}
    ${CAB.dept ? '' : cabDeskHtml() + cabPlayHtml() + `<div class="cab-body">${groups}</div>`}
    <!-- Контейнеры ведомств: те же узлы и те же id, что у новеллы (vnScreenHosts
         в render.js). В кабинете они лежат В ПОТОКЕ страницы, а не окном поверх
         неё, — распластывает их #cab-stage в 30_cabinet.css. -->
    <div class="cab-stage${CAB.dept ? ' on' : ''}" id="cab-stage">${typeof vnScreenHosts === 'function' ? vnScreenHosts() : ''}</div>
  </div>`);

  // Кабинет перерисовали — DOM ведомства уехал вместе со страницей. Если игрок
  // стоял во вкладке, поднимаем её заново, иначе тело «схлопнется» на ровном
  // месте после любого действия экономики.
  if (CAB.dept && depts[CAB.dept]) {
    try { depts[CAB.dept].open(); }
    catch (e) {
      console.error('[cabinet]', e);
      CAB.dept = null;
      if (typeof toast === 'function') toast('Ведомство не открылось: ' + ((e && e.message) || e), 'err');
    }
  }
}
