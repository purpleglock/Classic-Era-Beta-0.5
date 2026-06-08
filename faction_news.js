// ════════════════════════════════════════════════════════════
// FACTION NEWS — новости фракций: написание игроком, модерация
// администрацией, публикация на главной в «газетном» стиле.
// Поток: игрок пишет → pending → стафф одобряет/отклоняет → approved
// показывается на главной и в кабинете автора.
// ════════════════════════════════════════════════════════════

const FN = {
  approved: [],          // одобренные новости (для главной)
  byId: new Map(),       // id → новость (для открытия статьи)
  myFac: undefined,      // approved-анкета текущего игрока (null — нет)
  busy: false,
  draftKey: null,        // ключ автосохранения текущего черновика композитора
  draftT: null,          // таймер дебаунса автосохранения
};

function fnIsStaff() { return !!(user && ['superadmin', 'editor', 'moderator'].includes(user.role)); }

// Перерисовать активный список новостей — где бы он сейчас ни был открыт:
// в экономическом кабинете (вкладка «Новости») или в панели профиля (#ap).
function fnRefresh() {
  const mount = document.getElementById('ec-news-mount');
  if (mount) { fnRenderNewsTab(mount); return; }
  if (typeof apOpen !== 'undefined' && apOpen && typeof apTab !== 'undefined' && apTab === 'news' && typeof renderApTab === 'function') {
    renderApTab();
  }
}

// Одобренная анкета текущего пользователя (с кэшем). null — фракции нет.
async function fnGetMyFaction(force) {
  if (!user) return null;
  if (FN.myFac !== undefined && !force) return FN.myFac;
  try {
    const rows = await dbGet('faction_applications',
      `owner_id=eq.${user.id}&status=eq.approved&order=updated_at.desc&limit=1&select=faction_id,name,color,herald_url,race,ideology,gov,regime`);
    FN.myFac = (rows && rows[0]) ? rows[0] : null;
  } catch (e) { FN.myFac = null; }
  return FN.myFac;
}

// Краткое превью из текста, если лид не задан.
function fnExcerpt(n) {
  const e = (n.excerpt || '').trim();
  if (e) return e;
  const body = (n.body || '').replace(/\s+/g, ' ').trim();
  return body.length > 220 ? body.slice(0, 220).replace(/\s+\S*$/, '') + '…' : body;
}

function fnDateLine(n) {
  return fmtD(n.published_at || n.created_at);
}

// Звёздная дата для погружения: в сеттинге 3000-й год. Реальный 2026 → 3000,
// дальше год катится вперёд. Формат: «ЗВ.ДАТА 3000.157 · 12:12».
function fnStardate(dateStr) {
  const d = new Date(dateStr || Date.now());
  if (isNaN(d)) return 'ЗВ.ДАТА 3000.001';
  const galYear = 3000 + (d.getFullYear() - 2026);
  const day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `ЗВ.ДАТА ${galYear}.${String(day).padStart(3, '0')} · ${hh}:${mm}`;
}

// ── Главная: загрузка и блок новостей ───────────────────────
async function fnLoadApproved() {
  try {
    // Новости игроков (owner_id есть) — в «Вестник». Системные события (owner_id null:
    // слухи + сводки) — в отдельную «Ленту сектора».
    const [news, events, heralds] = await Promise.all([
      dbGet('faction_news', 'status=eq.approved&owner_id=not.is.null&order=published_at.desc.nullslast,created_at.desc&limit=12').catch(() => []),
      dbGet('faction_news', 'status=eq.approved&owner_id=is.null&order=created_at.desc&limit=10').catch(() => []),
      dbGet('faction_applications', 'status=eq.approved&select=faction_id,name,herald_url').catch(() => []),
    ]);
    FN.approved = news || [];
    FN.events = events || [];
    FN.factionList = (heralds || []);
    FN.heralds = new Map(FN.factionList.filter(h => h.herald_url).map(h => [h.faction_id, h.herald_url]));
    FN.byId = new Map([...FN.approved, ...FN.events].map(n => [n.id, n]));
  } catch (e) { FN.approved = []; FN.events = []; }
  return FN.approved;
}

// Тип записи: 'news' (игрок), 'bulletin' (сводка сектора), 'rumor' (слух).
function fnKind(n) { if (n.owner_id) return 'news'; return n.kind === 'bulletin' ? 'bulletin' : 'rumor'; }

// Фракция, которой касается событие — по имени в заголовке (для фон-герба).
function fnEventFaction(n) {
  if (!FN.factionList || !FN.factionList.length) return null;
  const hay = ((n.title || '') + ' ' + (n.faction_name || ''));
  let best = null;
  FN.factionList.forEach(f => {
    if (f.name && f.herald_url && hay.indexOf(f.name) !== -1 && (!best || f.name.length > best.name.length)) best = f;
  });
  return best;
}

// HTML-блок для главной: «Вестник фракций» (новости игроков) + «Лента сектора» (события).
function fnHomeBlockHtml() {
  const list = FN.approved || [];
  const card = (n, lead) => {
    const kind = fnKind(n);               // news | rumor | bulletin
    const rumor = kind === 'rumor', bulletin = kind === 'bulletin';
    // Цвет фракции игрока НЕ используем (бывает кислотным) — единый тон темы.
    // Слухи/сводки красим в свой контролируемый цвет (серый/циан).
    const accent = (kind === 'news') ? 'var(--gd)' : (n.faction_color || 'var(--gd)');
    const cardCover = n.image_url
      ? `<div class="fn-card-cov"><img src="${esc(n.image_url)}" loading="lazy" alt=""></div>` : '';
    const herald = (kind === 'news' && FN.heralds) ? FN.heralds.get(n.faction_id) : '';
    const flag = herald ? `<img class="fn-card-flag" src="${esc(herald)}" alt="" onerror="this.style.display='none'">` : '<span class="fn-dot"></span>';
    const kicker = bulletin
      ? `<span class="fn-card-live fn-card-bulletin">◈ СВОДКА</span><span class="fn-card-fac">${esc((n.faction_name || 'СЕКТОР').toUpperCase())}</span>`
      : rumor
      ? `<span class="fn-card-live fn-card-rumor">📡 СЛУХ</span><span class="fn-card-fac">${esc((n.faction_name || 'АНОНИМНО').toUpperCase())}</span>`
      : `<span class="fn-card-live">ПЕРЕДАЧА</span><span class="fn-card-fac">${flag}${esc((n.faction_name || 'ФРАКЦИЯ').toUpperCase())}</span>`;
    const readmore = bulletin ? 'СВОДКА ▸' : rumor ? 'ПОДРОБНОСТИ ▸' : 'ДЕКОДИРОВАТЬ ▸';
    return `<article class="fn-card${lead ? ' fn-card-lead' : ''}${rumor ? ' fn-card-is-rumor' : ''}${bulletin ? ' fn-card-is-bulletin' : ''}" onclick="fnOpenArticle('${esc(n.id)}')" style="--fn-accent:${esc(accent)}">
      ${cardCover}
      <div class="fn-card-body">
        <div class="fn-card-kicker">${kicker}</div>
        <h3 class="fn-card-title">${esc(n.title || 'Без заголовка')}</h3>
        <p class="fn-card-excerpt">${esc(fnExcerpt(n))}</p>
        <div class="fn-card-foot"><span class="fn-card-date">${esc(fnStardate(n.published_at || n.created_at))}</span><span class="fn-readmore">${readmore}</span></div>
      </div>
    </article>`;
  };
  let newsSection = '';
  if (list.length) {
    const [lead, ...rest] = list;
    const grid = rest.slice(0, 6).map(n => card(n, false)).join('');
    newsSection = `<section class="home-block fn-home">
      <div class="hb-head"><span class="hb-tag">ВЕСТНИК ФРАКЦИЙ</span><span class="fn-home-sub">// ВХОДЯЩИЕ ПЕРЕДАЧИ · ${list.length}</span></div>
      <div class="fn-grid">
        ${card(lead, true)}
        ${grid ? `<div class="fn-grid-rest">${grid}</div>` : ''}
      </div>
    </section>`;
  }
  return newsSection + fnEventsFeedHtml();
}

// ── Лента сектора: компактная лента системных событий (слухи + сводки) ──
function fnFeedRow(n) {
  const kind = fnKind(n);
  const ic = kind === 'bulletin' ? '◈' : '📡';
  return `<div class="fn-feed-row fn-fr-${kind}" onclick="fnOpenArticle('${esc(n.id)}')">
    <span class="fn-fr-ic">${ic}</span>
    <span class="fn-fr-title">${esc(n.title || '')}</span>
    <span class="fn-fr-time">${esc(fnStardate(n.published_at || n.created_at))}</span>
  </div>`;
}
function fnEventsFeedHtml() {
  const ev = FN.events || [];
  if (!ev.length) return '';
  return `<section class="home-block fn-feed">
    <div class="hb-head"><span class="hb-tag">ЛЕНТА СЕКТОРА</span><span class="fn-home-sub">// СИСТЕМНЫЕ СОБЫТИЯ · ${ev.length}</span></div>
    <div class="fn-feed-list" id="fn-feed-list">${ev.slice(0, 10).map(fnFeedRow).join('')}</div>
  </section>`;
}
async function fnLoadMoreEvents() {
  const off = (FN.events || []).length;
  let more = [];
  try { more = await dbGet('faction_news', `status=eq.approved&owner_id=is.null&order=created_at.desc&offset=${off}&limit=30`) || []; } catch (e) {}
  if (more.length) {
    FN.events = (FN.events || []).concat(more);
    more.forEach(n => FN.byId.set(n.id, n));
    const list = document.getElementById('fn-feed-list');
    if (list) list.insertAdjacentHTML('beforeend', more.map(fnFeedRow).join(''));
  }
  if (more.length < 30) { const b = document.getElementById('fn-feed-more'); if (b) b.style.display = 'none'; }
}

// ── Полноэкранная статья (sci-fi «терминал-депеша») ─────────
function fnBodyToParas(body) {
  let isFirst = true;
  return String(body || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => {
      // [img:URL] или голый URL картинки — рендерим как изображение
      const imgMatch = p.match(/^\[img:(https?:\/\/.+)\]$/i)
        || (p.match(/^https?:\/\/\S+$/i) && p.match(/\.(jpe?g|png|gif|webp|avif|svg)(\?[^\s]*)?$/i) ? [null, p] : null);
      if (imgMatch) return `<div class="fn-art-img"><img src="${esc(imgMatch[1])}" loading="lazy" alt=""></div>`;
      const cls = isFirst ? ' class="fn-lead-p"' : '';
      if (isFirst) isFirst = false;
      return `<p${cls}>${esc(p).replace(/\n/g, '<br>')}</p>`;
    }).join('');
}

// ── Реакции государства на новость (дипломатия) ──────────────
// Флавор-фразы по идеологии (приоритет) → расе → дефолт. stance: approve/neutral/disapprove.
const FN_REACT_DEFAULT = {
  approve:    'Мы одобряем эту позицию.',
  neutral:    'Мы принимаем это к сведению.',
  disapprove: 'Мы не одобряем этого.',
};
const FN_REACT_IDEO = {
  'Технократия (Культ науки)': { approve: 'Рационально и обоснованно. Прогресс приветствуется.', neutral: 'Требуется больше данных, прежде чем делать выводы.', disapprove: 'Иррационально и недальновидно. Мы против.' },
  'Милитаризм (Культ силы)':   { approve: 'Достойно. Сила и воля заслуживают уважения.',          neutral: 'Слова. Посмотрим на дела и оружие.',            disapprove: 'Слабость и пустословие. Мы не впечатлены.' },
  'Пацифизм':                  { approve: 'Мудрый и мирный путь. Мы рукоплещем.',                  neutral: 'Лишь бы это не привело к насилию.',             disapprove: 'Это сеет рознь и ведёт к конфликту. Осуждаем.' },
  'Экспансионизм':             { approve: 'Смелость в духе расширения границ. Одобряем.',           neutral: 'Любопытно, но границ это не двигает.',          disapprove: 'Робость и застой. Нам не по пути.' },
  'Изоляционизм':              { approve: 'Не нарушает нашего покоя — и то хорошо.',                neutral: 'Нас это мало касается.',                        disapprove: 'Чужие дрязги тянут к нам беду. Против.' },
  'Ксенофилия':                { approve: 'Прекрасный жест единства народов! Поддерживаем.',        neutral: 'Будем рады диалогу по этому поводу.',           disapprove: 'Это сеет вражду между народами. Осуждаем.' },
  'Ксенофобия':                { approve: 'Неожиданно, но приемлемо для чужаков.',                  neutral: 'От чужаков иного и не ждали.',                  disapprove: 'Типичная чужацкая дерзость. Мы возмущены.' },
  'Спиритуализм':              { approve: 'Душа этого деяния чиста. Благословляем.',                neutral: 'Звёзды ещё не открыли нам своего знака.',       disapprove: 'Это оскорбляет наши святыни. Мы осуждаем.' },
  'Трансгуманизм':             { approve: 'Шаг к лучшей версии разума. Одобряем.',                  neutral: 'Эволюция рассудит, кто был прав.',              disapprove: 'Отсталый и косный подход. Мы против.' },
  'Экоцентризм':               { approve: 'В гармонии с природой. Мы поддерживаем.',                neutral: 'Природа стерпит — пока.',                       disapprove: 'Это вредит живому. Мы решительно против.' },
  'Индустриализм':             { approve: 'Деловой и продуктивный подход. Одобряем.',               neutral: 'Без выгоды — без интереса.',                    disapprove: 'Пустая трата ресурсов. Не одобряем.' },
};
const FN_REACT_RACE = {
  'Рептилоиды':              { approve: 'Сильный ход. Уважаем.',            neutral: 'Мы наблюдаем, не торопясь.',     disapprove: 'Добыча так не поступает. Презираем.' },
  'Инсектоиды':              { approve: 'Полезно для Роя. Принимаем.',      neutral: 'Рой не видит в этом смысла.',    disapprove: 'Чуждо Рою. Отвергаем.' },
  'Синтетики / Киборги':     { approve: 'Логически оптимально. Одобрено.',  neutral: 'Недостаточно данных для оценки.', disapprove: 'Логическая ошибка. Отклонено.' },
  'Энергетические сущности': { approve: 'Резонирует с нами. Приветствуем.', neutral: 'Колебания нейтральны.',          disapprove: 'Диссонанс. Мы отторгаем это.' },
};
function fnReactPhrase(myFac, stance) {
  const byId = FN_REACT_IDEO[myFac && myFac.ideology];
  if (byId && byId[stance]) return byId[stance];
  const byRace = FN_REACT_RACE[myFac && myFac.race];
  if (byRace && byRace[stance]) return byRace[stance];
  return FN_REACT_DEFAULT[stance];
}
// Список опций: 3 авто (по идеологии/расе) + кастомные автора (news.reactions).
function fnReactionOptions(myFac, news) {
  const opts = [
    { key: 'a', stance: 'approve',    text: fnReactPhrase(myFac, 'approve') },
    { key: 'n', stance: 'neutral',    text: fnReactPhrase(myFac, 'neutral') },
    { key: 'd', stance: 'disapprove', text: fnReactPhrase(myFac, 'disapprove') },
  ];
  let custom = [];
  try { custom = Array.isArray(news.reactions) ? news.reactions : JSON.parse(news.reactions || '[]'); } catch (e) {}
  (custom || []).forEach((c, i) => {
    if (c && ['approve', 'neutral', 'disapprove'].includes(c.stance) && c.text) {
      opts.push({ key: 'c' + i, stance: c.stance, text: String(c.text), custom: true });
    }
  });
  return opts;
}
// Метка и цвет балла отношений (−100..+100).
function fnRelLabel(score) {
  if (score >= 60)  return { t: 'Союзные',         c: 'var(--ok)' };
  if (score >= 20)  return { t: 'Дружелюбны',      c: 'var(--ok)' };
  if (score <= -60) return { t: 'Враждебны',       c: 'var(--err)' };
  if (score <= -20) return { t: 'Напряжённость',   c: 'var(--err)' };
  return { t: 'Нейтральны', c: 'var(--t3)' };
}
const FN_STANCE_ICON = { approve: '👍', neutral: '➖', disapprove: '👎' };

// Состояние блока реакции для открытой статьи: { stance, score } или null/undefined.
// FN.reactState — карта news_id → {stance, score}.
FN.reactState = FN.reactState || {};

// HTML блока реакций для статьи n (исходя из myFac и текущего состояния).
function fnReactionBlockHtml(n, myFac) {
  // слухи (нет фракции-автора) — без реакций
  if (!n.faction_id || !n.owner_id) return '';
  // не залогинен или нет одобренной фракции
  if (!myFac || !myFac.faction_id) {
    return `<div class="fn-react fn-react-locked">
      <div class="fn-react-hd">РЕАКЦИЯ ГОСУДАРСТВА</div>
      <div class="fn-react-note">Чтобы выразить позицию своего государства и влиять на дипломатию — нужна одобренная фракция.${user ? '' : ' Войдите и зарегистрируйте её.'}</div>
    </div>`;
  }
  // нельзя реагировать на новость своей же фракции
  if (myFac.faction_id === n.faction_id) return '';

  const st = FN.reactState[n.id];
  const opts = fnReactionOptions(myFac, n);
  const btns = opts.map(o => {
    const on = st && st.stance === o.stance;
    return `<button class="fn-react-opt fn-stance-${o.stance}${on ? ' on' : ''}"
      onclick="fnReact('${esc(n.id)}','${o.stance}')">
      <span class="fn-react-ic">${FN_STANCE_ICON[o.stance]}</span>
      <span class="fn-react-txt">${esc(o.text)}</span></button>`;
  }).join('');

  let rel = '';
  if (st) {
    const lbl = fnRelLabel(st.score || 0);
    rel = `<div class="fn-react-rel">Ваше отношение к <b>${esc((n.faction_name || 'фракции').toUpperCase())}</b>:
      <span style="color:${lbl.c}">${lbl.t} (${st.score > 0 ? '+' : ''}${st.score})</span></div>`;
  }
  return `<div class="fn-react">
    <div class="fn-react-hd">РЕАКЦИЯ ГОСУДАРСТВА <span class="fn-react-sub">// влияет на отношения</span></div>
    <div class="fn-react-opts">${btns}</div>
    ${rel}
  </div>`;
}

// Подгрузка текущей реакции и балла → перерисовка блока.
async function fnLoadReactState(n, myFac) {
  if (!myFac || !myFac.faction_id || myFac.faction_id === n.faction_id) return;
  try {
    const [rx, rel] = await Promise.all([
      dbGet('news_reactions', `news_id=eq.${encodeURIComponent(n.id)}&reactor_fid=eq.${encodeURIComponent(myFac.faction_id)}&select=stance&limit=1`).catch(() => []),
      dbGet('faction_relations', `from_fid=eq.${encodeURIComponent(myFac.faction_id)}&to_fid=eq.${encodeURIComponent(n.faction_id)}&select=score&limit=1`).catch(() => []),
    ]);
    if (rx && rx[0]) FN.reactState[n.id] = { stance: rx[0].stance, score: (rel && rel[0]) ? rel[0].score : 0 };
  } catch (e) {}
  const slot = document.getElementById('fn-react-slot');
  if (slot) slot.innerHTML = fnReactionBlockHtml(n, myFac);
}

// Обработчик клика по опции реакции.
async function fnReact(newsId, stance) {
  const n = FN.byId.get(newsId);
  const myFac = await fnGetMyFaction();
  if (!myFac || !myFac.faction_id) { toast('Нужна одобренная фракция', 'err'); return; }
  try {
    const res = await apiFetch('rpc/news_react', { method: 'POST', body: JSON.stringify({ p_news_id: newsId, p_stance: stance }) });
    const score = (typeof res === 'number') ? res : (Array.isArray(res) ? res[0] : (res && res.news_react));
    FN.reactState[newsId] = { stance, score: (typeof score === 'number') ? score : 0 };
    const slot = document.getElementById('fn-react-slot');
    if (slot && n) slot.innerHTML = fnReactionBlockHtml(n, myFac);
    const lbl = fnRelLabel(FN.reactState[newsId].score);
    toast(`Позиция учтена · ${lbl.t}`, 'ok');
  } catch (e) { toast('Ошибка: ' + (e.message || e), 'err'); }
}

function fnOpenArticle(id) {
  const n = FN.byId.get(id);
  if (!n) { toast('Новость не найдена', 'err'); return; }
  // Цвет фракции игрока не используем (бывает кислотным); слухи/сводки — свой цвет.
  const accent = n.owner_id ? 'var(--gd)' : (n.faction_color || 'var(--gd)');
  const modal = document.getElementById('fn-article') || (() => {
    const m = document.createElement('div'); m.id = 'fn-article'; m.className = 'fn-art-ov';
    m.onclick = e => { if (e.target === m) fnCloseArticle(); };
    document.body.appendChild(m); return m;
  })();
  const kind = fnKind(n);               // news | rumor | bulletin
  const coverHtml = n.image_url
    ? `<div class="fn-art-cov"><img src="${esc(n.image_url)}" alt="" loading="lazy"></div>` : '';
  // События (слухи/сводки) без обложки — на фон герб фракции, которой касается ситуация
  const evFac = (!n.owner_id && !n.image_url) ? fnEventFaction(n) : null;
  const bgFlag = evFac ? `<div class="fn-art-bgflag" style="background-image:url('${esc(evFac.herald_url)}')"></div>` : '';
  const barL = kind === 'bulletin' ? '◈ СВОДКА СЕКТОРА' : kind === 'rumor' ? '📡 ПЕРЕХВАЧЕННЫЙ СЛУХ' : '◈ FACTION DISPATCH NETWORK';
  const barR = kind === 'bulletin' ? 'ОФИЦИАЛЬНО' : kind === 'rumor' ? 'НЕПОДТВЕРЖДЕНО' : 'ВХОДЯЩАЯ ПЕРЕДАЧА';
  modal.innerHTML = `<div class="fn-art" style="--fn-accent:${esc(accent)}">
    ${bgFlag}
    <div class="fn-art-bar">
      <span class="fn-art-bar-l">${barL}</span>
      <span class="fn-art-bar-r">${barR}</span>
    </div>
    <button class="fn-art-close" onclick="fnCloseArticle()">✕</button>
    ${coverHtml}
    <div class="fn-art-inner">
      <div class="fn-art-meta">
        <span class="fn-art-fac">${(n.owner_id && FN.heralds && FN.heralds.get(n.faction_id)) ? `<img class="fn-art-flag" src="${esc(FN.heralds.get(n.faction_id))}" alt="" onerror="this.style.display='none'">` : '<span class="fn-dot"></span>'}${esc((n.faction_name || 'ФРАКЦИЯ').toUpperCase())}</span>
        <span class="fn-art-date">${esc(fnStardate(n.published_at || n.created_at))}</span>
      </div>
      <h1 class="fn-art-title">${esc(n.title || 'Без заголовка')}</h1>
      <div class="fn-art-body">${fnBodyToParas(n.body)}</div>
      <div id="fn-react-slot"></div>
    </div>
    <div class="fn-art-foot">
      <span>▌ КОНЕЦ ПЕРЕДАЧИ</span>
      <span class="fn-art-foot-id">REF·${esc(String(n.id).slice(0, 8).toUpperCase())}</span>
    </div>
  </div>`;
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
  // Блок реакции государства — асинхронно (нужна одобренная фракция читателя)
  fnGetMyFaction().then(myFac => {
    const slot = document.getElementById('fn-react-slot');
    if (slot) slot.innerHTML = fnReactionBlockHtml(n, myFac);
    fnLoadReactState(n, myFac);
  }).catch(() => {});
}
function fnCloseArticle() {
  document.getElementById('fn-article')?.classList.remove('show');
  document.body.style.overflow = '';
}

// ── Кабинет: вкладка «Новости» ──────────────────────────────
async function fnRenderNewsTab(b) {
  b.innerHTML = `<div class="sload" style="min-height:60px"><div class="quote-loader">Загрузка...</div></div>`;
  const staff = fnIsStaff();
  const fac = await fnGetMyFaction();

  let html = '';

  // Секция автора (владельца одобренной фракции)
  if (fac && fac.faction_id) {
    let mine = [];
    try {
      mine = await dbGet('faction_news', `faction_id=eq.${encodeURIComponent(fac.faction_id)}&order=created_at.desc`) || [];
    } catch (e) {}
    const stMap = {
      pending:  ['НА МОДЕРАЦИИ', 'var(--color-warning,#e0a030)'],
      approved: ['ОПУБЛИКОВАНА', 'var(--ok,#3ec96b)'],
      rejected: ['ОТКЛОНЕНА', 'var(--err,#ff6b6b)'],
    };
    const rows = mine.length ? mine.map(n => {
      const st = stMap[n.status] || ['—', 'var(--t3)'];
      const canEdit = n.status !== 'approved';
      return `<div class="fn-mine-row">
        <div class="fn-mine-main">
          <div class="fn-mine-title">${esc(n.title || 'Без заголовка')}</div>
          <div class="fn-mine-meta">${esc(fnDateLine(n))} · <b style="color:${st[1]}">${st[0]}</b>${n.status === 'rejected' && n.reject_reason ? ` · <span style="color:var(--t3)">причина: ${esc(n.reject_reason)}</span>` : ''}</div>
        </div>
        <div class="fn-mine-acts">
          <button class="btn btn-gh btn-xs" onclick="fnPreview('${esc(n.id)}')">Просмотр</button>
          ${canEdit ? `<button class="btn btn-gh btn-xs" onclick="fnOpenComposer('${esc(n.id)}')">✎</button>` : ''}
          <button class="btn btn-rd btn-xs" onclick="fnDelete('${esc(n.id)}')">✕</button>
        </div>
      </div>`;
    }).join('') : `<div style="color:var(--t3);font-size:12px;padding:8px 0">Вы ещё не написали ни одной новости.</div>`;

    html += `<div class="fn-tab-sec">
      <div class="fn-tab-hd">
        <span>📰 Новости фракции «${esc(fac.name || '')}»</span>
        <button class="btn btn-gd btn-sm" onclick="fnOpenComposer()">✚ Написать новость</button>
      </div>
      <div class="fn-mine-list">${rows}</div>
      <div class="fn-tab-note">Новость уходит на проверку администрации. После одобрения она появится на главной в «Вестнике фракций».</div>
    </div>`;
  } else if (!staff) {
    html += `<div class="fn-tab-sec"><div style="color:var(--t3);font-size:13px;padding:8px 0">
      Писать новости могут владельцы одобренной фракции.
      <button class="btn btn-gd btn-fw" style="margin-top:10px" onclick="closeAp();go('faction-new')">⬡ Зарегистрировать фракцию</button>
    </div></div>`;
  }

  // Секция модерации (стафф)
  if (staff) {
    let pend = [];
    try { pend = await dbGet('faction_news', 'status=eq.pending&order=created_at.asc') || []; } catch (e) {}
    const modRows = pend.length ? pend.map(n => `<div class="fn-mod-row" id="fn-mod-${esc(n.id)}">
      <div class="fn-mod-main">
        <div class="fn-mod-title">${esc(n.title || 'Без заголовка')}</div>
        <div class="fn-mod-meta">${esc(n.faction_name || '—')} · ${esc(n.owner_email || '')} · ${esc(fnDateLine(n))}</div>
        <div class="fn-mod-excerpt">${esc(fnExcerpt(n))}</div>
      </div>
      <div class="fn-mod-acts">
        <button class="btn btn-gh btn-sm" onclick="fnPreview('${esc(n.id)}')">Читать</button>
        <button class="btn btn-gd btn-sm" onclick="fnApprove('${esc(n.id)}')">✓ Одобрить</button>
        <button class="btn btn-rd btn-sm" onclick="fnReject('${esc(n.id)}')">✕ Отклонить</button>
      </div>
    </div>`).join('') : `<div style="color:var(--t3);font-size:12px;padding:8px 0">Нет новостей на модерации</div>`;

    html += `<div class="fn-tab-sec">
      <div class="fn-tab-hd"><span>🛡 Модерация новостей (${pend.length})</span></div>
      <div class="fn-mod-list">${modRows}</div>
    </div>`;
  }

  b.innerHTML = html || `<div style="color:var(--t3);font-size:13px;padding:8px 0">Нет доступа к новостям.</div>`;
}

// Просмотр черновика/ожидающей новости автором или стаффом (без публикации).
async function fnPreview(id) {
  // Берём из локального кэша или подгружаем поштучно
  let n = FN.byId.get(id);
  if (!n) {
    try { const rows = await dbGet('faction_news', `id=eq.${encodeURIComponent(id)}&limit=1`); n = rows && rows[0]; } catch (e) {}
    if (n) FN.byId.set(id, n);
  }
  if (!n) { toast('Не найдено', 'err'); return; }
  fnOpenArticle(id);
}

// ── Композитор (написать / редактировать) ───────────────────
function fnOpenComposer(id) {
  const modal = document.getElementById('fn-composer') || (() => {
    const m = document.createElement('div'); m.id = 'fn-composer'; m.className = 'fn-comp-ov';
    m.onclick = e => { if (e.target === m) fnCloseComposer(); };
    // Автосохранение: любой ввод/выбор внутри композитора → отложенное сохранение черновика.
    m.addEventListener('input', fnDraftSaveSoon);
    m.addEventListener('change', fnDraftSaveSoon);
    // Страховка при сворачивании/закрытии вкладки или потере страницы — мгновенный сброс.
    window.addEventListener('pagehide', fnDraftSave);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') fnDraftSave(); });
    document.body.appendChild(m); return m;
  })();
  const key = fnDraftKey(id);
  // если редактируем — подтянем данные
  let n = id ? FN.byId.get(id) : null;
  const fill = (data) => {
    // Черновик из localStorage важнее серверных данных: это последние несохранённые
    // правки игрока (например, после обрыва связи). Если он есть — подставляем его.
    const draft = fnDraftLoad(key);
    const restored = !!(draft && (draft.title || draft.body || draft.image_url || (draft.reactions || []).length));
    const eff = restored ? draft : (data || null);
    modal.innerHTML = `<div class="fn-comp">
      <button class="gm-close" onclick="fnCloseComposer()">✕</button>
      <div class="fn-comp-hd">${id ? '✎ Редактировать новость' : '📰 Новая новость фракции'}</div>
      <input type="hidden" id="fn-c-id" value="${id ? esc(id) : ''}">
      ${restored ? `<div class="fn-c-restored">📝 Восстановлен черновик от ${esc(fnClock(draft.ts))} — несохранённые правки подставлены.
        <button type="button" class="btn btn-gh btn-xs" onclick="fnDraftDiscard()">Очистить черновик</button></div>` : ''}
      <div class="fg"><label class="fl">Заголовок *</label>
        <input class="fi fn-c-title" id="fn-c-title" maxlength="160" value="${esc(eff?.title || '')}" placeholder="Главное событие недели"></div>
      <div class="fg">
        <label class="fl">Обложка</label>
        <div class="fn-c-cov-wrap">
          ${eff?.image_url ? `<div class="fn-c-cov-prv" id="fn-c-cov-prv"><img src="${esc(eff.image_url)}" alt=""><button type="button" class="fn-c-cov-rm" onclick="fnCoverRemove()">✕</button></div>` : `<div class="fn-c-cov-prv fn-c-cov-empty" id="fn-c-cov-prv"></div>`}
          <label class="btn btn-gh fn-c-cov-btn">📷 Загрузить обложку<input type="file" accept="image/*" style="display:none" onchange="fnCoverUpload(this)"></label>
        </div>
        <input type="hidden" id="fn-c-img" value="${esc(eff?.image_url || '')}">
      </div>
      <div class="fg fn-c-body-fg">
        <div class="fn-c-body-hd"><label class="fl">Текст новости *</label><label class="btn btn-gh btn-xs fn-c-ins-btn">📷 Вставить фото<input type="file" accept="image/*" style="display:none" onchange="fnInsertImg(this)"></label></div>
        <textarea class="fi fn-c-body" id="fn-c-body" placeholder="Пишите свободно. Пустая строка = новый абзац.">${esc(eff?.body || '')}</textarea></div>
      <div class="fg">
        <div class="fn-c-body-hd"><label class="fl">Варианты реакций <span style="color:var(--t4);font-weight:400">— необязательно</span></label>
          <button type="button" class="btn btn-gh btn-xs" onclick="fnReactAddRow()">＋ Свой вариант</button></div>
        <div class="fn-comp-note" style="margin:0 0 6px">Читатели и так получат авто-реакции по своей идеологии. Здесь можно добавить свои ивентные фразы — каждая со своим тоном.</div>
        <div id="fn-c-reacts">${(() => { let cs = []; try { cs = Array.isArray(eff?.reactions) ? eff.reactions : JSON.parse(eff?.reactions || '[]'); } catch (e) {} return (cs || []).map(c => fnReactRowHtml(c.text, c.stance)).join(''); })()}</div>
      </div>
      <div class="fn-comp-ftr">
        <button class="btn btn-gh" onclick="fnCloseComposer()">Отмена</button>
        <button class="btn btn-gd" onclick="fnSubmit()">📨 Отправить на проверку</button>
      </div>
      <div class="fn-comp-note fn-c-draft" id="fn-c-draft-st"></div>
      <div class="fn-comp-note">После отправки новость проверит администрация. Опубликованную правит только администрация. Черновик сохраняется автоматически на этом устройстве.</div>
    </div>`;
    modal.classList.add('show');
    FN.draftKey = key;
    fnDraftStatus(restored ? ('восстановлен черновик · ' + fnClock(draft.ts)) : '');
  };
  if (id && !n) {
    dbGet('faction_news', `id=eq.${encodeURIComponent(id)}&limit=1`).then(rows => { fill(rows && rows[0]); }).catch(() => fill(null));
  } else { fill(n); }
}
function fnCloseComposer() {
  clearTimeout(FN.draftT);
  fnDraftSave();   // финальное сохранение — закрытие/обрыв не теряет последние буквы
  document.getElementById('fn-composer')?.classList.remove('show');
}

// ── Автосохранение черновика новости (localStorage) ─────────
// Ключ — на пользователя и на режим (новая / правка конкретной id), чтобы черновики
// не перемешивались. Сохраняем при вводе (дебаунс) и при закрытии; чистим после отправки.
function fnDraftKey(id) { return 'fn_draft_' + (id ? ('edit_' + id) : 'new') + '_' + ((typeof user !== 'undefined' && user && user.id) || 'anon'); }
function fnDraftLoad(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
function fnClock(ts) { const d = new Date(ts || Date.now()); const p = n => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); }
function fnDraftStatus(text) { const el = document.getElementById('fn-c-draft-st'); if (el) el.textContent = text ? ('💾 ' + text) : ''; }
function fnDraftSave() {
  if (!FN.draftKey) return;
  const g = id => document.getElementById(id);
  if (!g('fn-c-body')) return;   // композитор не на экране
  const payload = {
    title: g('fn-c-title')?.value || '',
    body: g('fn-c-body')?.value || '',
    image_url: g('fn-c-img')?.value || '',
    reactions: fnReactCollect(),
    ts: Date.now(),
  };
  // Пустой черновик не держим в хранилище.
  if (!payload.title && !payload.body && !payload.image_url && !payload.reactions.length) {
    try { localStorage.removeItem(FN.draftKey); } catch (e) {}
    fnDraftStatus('');
    return;
  }
  try { localStorage.setItem(FN.draftKey, JSON.stringify(payload)); fnDraftStatus('черновик сохранён · ' + fnClock(payload.ts)); } catch (e) {}
}
function fnDraftSaveSoon() { clearTimeout(FN.draftT); FN.draftT = setTimeout(fnDraftSave, 600); }
function fnDraftDiscard() {
  if (FN.draftKey) { try { localStorage.removeItem(FN.draftKey); } catch (e) {} }
  const id = document.getElementById('fn-c-id')?.value || '';
  fnOpenComposer(id || undefined);   // переоткрыть с серверными данными (черновик уже стёрт)
}

// Строка кастомной опции реакции (текст + тон)
function fnReactRowHtml(text, stance) {
  const opt = (v, l) => `<option value="${v}"${stance === v ? ' selected' : ''}>${l}</option>`;
  return `<div class="fn-c-react-row">
    <select class="fi fn-c-react-stance">${opt('approve', '👍 Одобрение')}${opt('neutral', '➖ Нейтрально')}${opt('disapprove', '👎 Осуждение')}</select>
    <input class="fi fn-c-react-text" maxlength="120" placeholder="Текст реакции…" value="${esc(text || '')}">
    <button type="button" class="fn-bld-del" title="Удалить" onclick="this.parentNode.remove()">✕</button>
  </div>`;
}
function fnReactAddRow() {
  const box = document.getElementById('fn-c-reacts');
  if (box) box.insertAdjacentHTML('beforeend', fnReactRowHtml('', 'neutral'));
}
function fnReactCollect() {
  const rows = document.querySelectorAll('#fn-c-reacts .fn-c-react-row');
  const out = [];
  rows.forEach(r => {
    const text = (r.querySelector('.fn-c-react-text')?.value || '').trim();
    const stance = r.querySelector('.fn-c-react-stance')?.value || 'neutral';
    if (text) out.push({ text, stance });
  });
  return out.slice(0, 6);
}

function fnInsertImg(input) {
  const file = input?.files?.[0];
  if (!file) return;
  handleImgUpload(file, url => {
    const ta = document.getElementById('fn-c-body');
    if (!ta) return;
    const marker = `\n\n[img:${url}]\n\n`;
    const start = ta.selectionStart;
    ta.value = ta.value.slice(0, start) + marker + ta.value.slice(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = start + marker.length;
    ta.focus();
    fnDraftSaveSoon();
  });
  input.value = '';
}

function fnCoverUpload(input) {
  const file = input?.files?.[0];
  if (!file) return;
  handleImgUpload(file, url => {
    document.getElementById('fn-c-img').value = url;
    const prv = document.getElementById('fn-c-cov-prv');
    if (prv) {
      prv.classList.remove('fn-c-cov-empty');
      prv.innerHTML = `<img src="${url}" alt=""><button type="button" class="fn-c-cov-rm" onclick="fnCoverRemove()">✕</button>`;
    }
    fnDraftSaveSoon();
  });
  input.value = '';
}

function fnCoverRemove() {
  document.getElementById('fn-c-img').value = '';
  const prv = document.getElementById('fn-c-cov-prv');
  if (prv) { prv.classList.add('fn-c-cov-empty'); prv.innerHTML = ''; }
  fnDraftSaveSoon();
}

async function fnSubmit() {
  if (FN.busy) return;
  const id        = document.getElementById('fn-c-id')?.value || '';
  const title     = (document.getElementById('fn-c-title')?.value || '').trim();
  const body      = (document.getElementById('fn-c-body')?.value || '').trim();
  const image_url = (document.getElementById('fn-c-img')?.value || '').trim() || null;
  const reactions = fnReactCollect();
  if (!title || !body) { toast('Заголовок и текст обязательны', 'err'); return; }
  if (typeof badName === 'function' && badName(title)) { toast('Заголовок содержит недопустимые слова', 'err'); return; }
  // Писать новости могут только владельцы одобренной фракции (игроки).
  const fac = await fnGetMyFaction();
  if (!fac || !fac.faction_id) { toast('Новости пишут только владельцы одобренной фракции', 'err'); return; }
  FN.busy = true;
  try {
    if (id) {
      await dbPatch('faction_news', `id=eq.${encodeURIComponent(id)}`,
        { title, excerpt: null, body, image_url, reactions, status: 'pending', reject_reason: null, updated_at: new Date().toISOString() });
      toast('Изменения отправлены на проверку', 'ok');
    } else {
      await dbPost('faction_news', {
        faction_id: fac.faction_id,
        faction_name: fac.name || null,
        faction_color: fac.color || null,
        owner_id: user.id, owner_email: user.email,
        title, excerpt: null, body, image_url, reactions,
        status: 'pending',
      });
      toast('Новость отправлена на проверку', 'ok');
    }
    // Отправлено успешно — черновик больше не нужен. Сбрасываем ключ ДО закрытия,
    // иначе финальное автосохранение в fnCloseComposer пересоздаст черновик.
    try { if (FN.draftKey) localStorage.removeItem(FN.draftKey); } catch (e) {}
    FN.draftKey = null;
    fnCloseComposer();
    fnRefresh();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { FN.busy = false; }
}

// ── Модерация ───────────────────────────────────────────────
async function fnApprove(id) {
  if (FN.busy) return;
  if (!confirm('Опубликовать новость на главной?')) return;
  FN.busy = true;
  try {
    await dbPatch('faction_news', `id=eq.${encodeURIComponent(id)}`,
      { status: 'approved', published_at: new Date().toISOString(), reviewed_by: user.email, reject_reason: null, updated_at: new Date().toISOString() });
    toast('Опубликовано ✓', 'ok');
    document.getElementById('fn-mod-' + id)?.remove();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { FN.busy = false; }
}

async function fnReject(id) {
  if (FN.busy) return;
  const reason = prompt('Причина отклонения (увидит автор):', '');
  if (reason === null) return;
  FN.busy = true;
  try {
    await dbPatch('faction_news', `id=eq.${encodeURIComponent(id)}`,
      { status: 'rejected', reject_reason: reason, reviewed_by: user.email, updated_at: new Date().toISOString() });
    toast('Отклонено', 'inf');
    document.getElementById('fn-mod-' + id)?.remove();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { FN.busy = false; }
}

async function fnDelete(id) {
  if (FN.busy) return;
  if (!confirm('Удалить новость безвозвратно?')) return;
  FN.busy = true;
  try {
    await dbDel('faction_news', `id=eq.${encodeURIComponent(id)}`);
    toast('Удалено', 'ok');
    fnRefresh();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { FN.busy = false; }
}
