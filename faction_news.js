// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
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

// Edge Function нейро-вердикта: держит ключ OpenRouter, читает новость+лор из
// БД сама (клиент шлёт только id — подменить контекст с клиента нельзя).
const FN_AI_VERDICT_URL = 'https://pgngkkiiopymvrcozvvr.supabase.co/functions/v1/news-verdict';

// Запросить нейро-вердикт на новость (fire-and-forget — не блокирует UI).
async function fnTriggerAiVerdict(newsId) {
  if (!newsId) return;
  let token = (typeof SB_ANON !== 'undefined') ? SB_ANON : '';
  try { token = await getTokenFresh(); } catch (e) {}
  try {
    fetch(FN_AI_VERDICT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: (typeof SB_ANON !== 'undefined' ? SB_ANON : ''), Authorization: 'Bearer ' + token },
      body: JSON.stringify({ news_id: newsId }),
    }).catch(() => {});
  } catch (e) {}
}

// Стафф: запросить/переоценить нейро-вердикт ВРУЧНУЮ с показом результата.
// Ждёт ответ функции (не fire-and-forget), сообщает об ошибке, перерисовывает статью.
async function fnRequestAiVerdict(newsId) {
  if (!newsId) return;
  const btn = document.getElementById('fn-art-aibtn');
  if (btn) { btn.disabled = true; btn.textContent = '🧠 Оцениваю…'; }
  let token = (typeof SB_ANON !== 'undefined') ? SB_ANON : '';
  try { token = await getTokenFresh(); } catch (e) {}
  try {
    const r = await fetch(FN_AI_VERDICT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: (typeof SB_ANON !== 'undefined' ? SB_ANON : ''), Authorization: 'Bearer ' + token },
      body: JSON.stringify({ news_id: newsId }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) { toast('Нейро-оценка: ' + (d.error || ('HTTP ' + r.status)), 'err'); }
    else {
      const v = d.verdict || {};
      toast('Нейро-оценка готова: ' + (v.verdict || '—') + (v.ok === false ? ' (модель не ответила корректно)' : ''), 'ok');
      // Подтянуть свежую строку и перерисовать статью.
      try {
        const rows = await dbGet('faction_news', `id=eq.${encodeURIComponent(newsId)}&limit=1`);
        if (rows && rows[0]) { FN.byId.set(newsId, rows[0]); fnOpenArticle(newsId); }
      } catch (e) {}
    }
  } catch (e) { toast('Нейро-оценка: ' + (e.message || String(e)), 'err'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '🧠 Нейро-оценка'; } }
}

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

// Снять редакторскую разметку (BBCode-теги/FX/markdown), чтобы в текстовом превью
// карточки не светились коды вроде [fx:schizo], [img:URL], **жирный**, ## и т.п.
function fnStripMarkup(s) {
  let t = String(s || '');
  t = t.replace(/\r/g, '');
  // схизо-блок целиком — это скрытый рунический текст, в превью ему не место
  t = t.replace(/\[fx:schizo\][\s\S]*?\[\/fx\]/gi, ' ');
  // блок под паролем — НЕ светим секрет в тизере, оставляем только метку
  t = t.replace(/\[lock:[^\]\n]*\][\s\S]*?\[\/lock\]/gi, ' 🔒 ');
  // сворачиваемая «глава» — содержимое не секретное, оставляем текст без тегов
  t = t.replace(/\[spoiler:[^\]\n]*\]([\s\S]*?)\[\/spoiler\]/gi, '$1');
  // музыка: [music:URL] и голые ссылки на площадки — в тизере только метка
  t = t.replace(/\[music:[^\]]*\]/gi, ' 🎵 ');
  t = t.replace(/https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|soundcloud\.com|music\.yandex\.[a-z]+)\/\S+/gi, ' 🎵 ');
  // картинки: [img:URL] и голые URL изображений
  t = t.replace(/\[img:[^\]]*\]/gi, ' ');
  t = t.replace(/https?:\/\/\S+\.(?:jpe?g|png|gif|webp|avif|svg)(?:\?\S*)?/gi, ' ');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  // парные форматные/FX-теги: [center]…[/center], [c:gold]…[/c], [bg:…]…[/bg], [fx:…]…[/fx], [left]/[right]
  t = t.replace(/\[\/?(?:center|left|right|c|bg|fx)(?::[^\]]*)?\]/gi, ' ');
  // упоминание фракции [fac:FID]Имя[/fac] → Имя
  t = t.replace(/\[fac:[^\]|]+(?:\|[^\]]*)?\]([\s\S]*?)\[\/fac\]/gi, '$1');
  // markdown-ссылки [text](url) → text
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // заголовки, цитаты, маркеры списков в начале строки
  t = t.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  t = t.replace(/^[ \t]*>[ \t]?/gm, '');
  t = t.replace(/^[ \t]*[-*+][ \t]+/gm, '');
  // горизонтальные разделители (---, ***, ___)
  t = t.replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, ' ');
  // выделения: **жирный** / __…__, *курсив* / _…_, `код`
  t = t.replace(/(\*\*|__)([\s\S]*?)\1/g, '$2');
  t = t.replace(/(\*|_)([\s\S]*?)\1/g, '$2');
  t = t.replace(/`([^`]*)`/g, '$1');
  return t.replace(/\s+/g, ' ').trim();
}

// Извлечь faction_id всех упоминаний [fac:FID]…[/fac] из текста (заголовок+тело).
// Это «пинги» — упомянутые фракции увидят новость в своей ленте «Оповещения».
function fnParseMentions() {
  const txt = (document.getElementById('fn-c-title')?.value || '') + '\n'
            + (document.getElementById('fn-c-body')?.value || '');
  const out = [];
  const re = /\[fac:([^\]|]+)(?:\|[^\]]*)?\]/gi;
  let m;
  while ((m = re.exec(txt))) { const id = (m[1] || '').trim(); if (id && !out.includes(id)) out.push(id); }
  return out;
}

// Флаг (герб) фракции по её id — из общего реестра, загруженного fnLoadApproved.
// Используется чипом-упоминанием в il() как фолбэк, если URL не зашит в тег
// (например, старые упоминания без флага).
function fnFlagFor(fid) {
  try { return (FN.heralds && FN.heralds.get(fid)) || ''; } catch (e) { return ''; }
}

// Переход к фракции из чипа-упоминания (закрываем статью, открываем реестр фракций).
function fnGotoFaction(fid, ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  if (typeof fnCloseArticle === 'function') fnCloseArticle();
  if (typeof go === 'function') go('factions');
}

// Краткое превью из текста, если лид не задан.
function fnExcerpt(n) {
  const e = (n.excerpt || '').trim();
  if (e) return e;
  const body = fnStripMarkup(n.body || '');
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
      dbGet('faction_news', 'status=eq.approved&owner_id=is.null&order=created_at.desc&limit=40').catch(() => []),
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

// Есть ли у новости флаг визуального/поведенческого эффекта (поле fx = список через запятую).
// Флаги: glitch, bg (см. композитор), noauto (отключить авто-реакции),
// private (личное сообщение фракции — не в ленту, только в её кабинет + всплывашка).
function fnHasFx(n, flag) { return !!(n && typeof n.fx === 'string' && n.fx.split(',').includes(flag)); }

// Особые НПС с фиксированным «крутым» символом-флагом (эффект задаётся CSS, не картинкой).
// author_herald = 'fx:rift' → таинственный «Разлом».
const FN_SPECIAL_NPC = {
  rift: { name: 'Разлом', color: 'rgba(170,70,255,0.6)', herald: 'fx:rift' },
};
// HTML флага автора: спец-эффект (fx:*), загруженная картинка или ничего.
function fnAuthorFlagHtml(herald, cls) {
  if (!herald) return '';
  if (herald === 'fx:rift') return `<span class="fn-rift-flag ${cls || ''}" aria-label="Разлом" title="Разлом — таинственный НПС">◈</span>`;
  return `<img class="${cls || ''}" src="${esc(herald)}" alt="" onerror="this.style.display='none'">`;
}

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
    const accent = (kind === 'news' && n.faction_id) ? 'var(--gd)' : (n.faction_color || 'var(--gd)');
    const cardCover = n.image_url
      ? `<div class="fn-card-cov"><img src="${esc(n.image_url)}" loading="lazy" alt=""></div>` : '';
    const herald = (kind === 'news') ? ((FN.heralds && FN.heralds.get(n.faction_id)) || n.author_herald || '') : (n.author_herald || '');
    const flag = herald ? fnAuthorFlagHtml(herald, 'fn-card-flag') : '<span class="fn-dot"></span>';
    const kicker = bulletin
      ? `<span class="fn-card-live fn-card-bulletin">◈ СВОДКА</span><span class="fn-card-fac">${esc((n.faction_name || 'СЕКТОР').toUpperCase())}</span>`
      : rumor
      ? `<span class="fn-card-live fn-card-rumor">📡 СЛУХ</span><span class="fn-card-fac">${esc((n.faction_name || 'АНОНИМНО').toUpperCase())}</span>`
      : `<span class="fn-card-fac fn-card-fac-main">${flag}${esc((n.faction_name || 'ФРАКЦИЯ').toUpperCase())}</span>`;
    const readmore = bulletin ? 'СВОДКА ▸' : rumor ? '|||||||| ' : '||||||||';
    return `<article class="fn-card${lead ? ' fn-card-lead' : ''}${rumor ? ' fn-card-is-rumor' : ''}${bulletin ? ' fn-card-is-bulletin' : ''}" data-fn-id="${esc(n.id)}" onclick="fnOpenArticle('${esc(n.id)}')" style="--fn-accent:${esc(accent)}">
      ${fnIsStaff() ? `<button class="fn-card-del" title="Удалить (админ)" onclick="fnAdminDelete('${esc(n.id)}',event)">✕</button>` : ''}
      <div class="fn-card-inner">
        ${cardCover}
        <div class="fn-card-body">
          <div class="fn-card-kicker">${kicker}</div>
          <h3 class="fn-card-title">${esc(n.title || 'Без заголовка')}</h3>
          <p class="fn-card-excerpt">${esc(fnExcerpt(n))}</p>
          <div class="fn-card-foot"><span class="fn-card-date">${esc(fnStardate(n.published_at || n.created_at))}</span><span class="fn-readmore">${readmore}</span></div>
        </div>
      </div>
    </article>`;
  };
  let newsSection = '';
  if (list.length) {
    const items = list.slice(0, 20).map(n => card(n, false)).join('');
    newsSection = `<section class="home-block fn-home">
      <div class="hb-head"><span class="hb-tag">ВЕСТНИК ФРАКЦИЙ</span><span class="fn-home-sub">// ВХОДЯЩИЕ ПЕРЕДАЧИ · ${list.length}</span></div>
      <div class="fn-feed-news">${items}</div>
    </section>`;
  }
  return newsSection;
}

// ── Лента сектора: компактная лента системных событий (слухи + сводки) ──
// Это событие — анонс достижения? (title «🏆 Достижение: …»)
function fnIsAch(n) { return /^🏆\s*Достижение:/.test(n && n.title || ''); }
// Это событие — колонизация планеты? (title «Колонизация: …»)
// Колоний бывает много, поэтому в ленте их сворачиваем в одну сводку,
// чтобы они не вытесняли остальные события из видимой части.
function fnIsColony(n) { return /^Колонизация:/.test(n && n.title || ''); }
// Флаг (герб) фракции для события — по имени в заголовке. '' если не нашли.
function fnFeedFlagHtml(n) {
  const f = fnEventFaction(n);
  if (f && f.herald_url) return `<img class="fn-fr-flag" src="${esc(f.herald_url)}" alt="" loading="lazy" onerror="this.style.display='none'">`;
  return '';
}
// Картинка достижения (assets/ach/<id>.webp). '' если не нашли.
function fnAchImg(n) {
  const f = fnAchLookup(n);
  return f ? `assets/ach/${f.id}.webp` : '';
}
// Нормализация имени для устойчивого сравнения: регистр, пробелы, кавычки,
// ё→е. Чтобы «крутое  Имя» и «Крутое Имя» матчились, а не давали пустую карточку.
function fnNormName(s) {
  return String(s == null ? '' : s)
    .replace(/[«»"“”„‟]/g, '')       // любые кавычки прочь
    .replace(/ё/gi, 'е')             // ё/е равнозначны
    .replace(/\s+/g, ' ')            // схлопнуть пробелы
    .trim().toLowerCase();
}
// По новости найти id и запись каталога EC_ACH. null если не нашли.
// Имя берём НАДЁЖНЕЕ всего из заголовка («🏆 Достижение: Имя» — его же проверяет
// fnIsAch), тело и «ёлочки» — лишь запасные источники. Сравнение нормализованное,
// плюс фолбэк «имя каталога целиком встречается в тексте» для нестандартных формулировок.
function fnAchLookup(n) {
  if (!n || typeof EC_ACH === 'undefined') return null;
  const title = String(n.title || '');
  const body  = String(n.body  || '');
  // 1) кандидаты-имена из разных мест, по убыванию надёжности
  const cands = [];
  const mt = /Достижени[ея]\s*:\s*(.+?)\s*$/i.exec(title);
  if (mt) cands.push(mt[1]);
  const mb = /достижени[ея]\s+«([^»]+)»/i.exec(body);
  if (mb) cands.push(mb[1]);
  const mq = /«([^»]+)»/.exec(title) || /«([^»]+)»/.exec(body);
  if (mq) cands.push(mq[1]);
  // 2) точное (нормализованное) совпадение по любому кандидату
  for (const raw of cands) {
    const key = fnNormName(raw);
    if (!key) continue;
    for (const id in EC_ACH) {
      if (EC_ACH[id] && fnNormName(EC_ACH[id].name) === key) return { id, ach: EC_ACH[id] };
    }
  }
  // 3) фолбэк: имя из каталога целиком встречается в заголовке/теле
  const hay = fnNormName(title + ' ' + body);
  let best = null;
  for (const id in EC_ACH) {
    const nm = fnNormName(EC_ACH[id] && EC_ACH[id].name);
    if (nm && nm.length >= 3 && hay.indexOf(nm) !== -1 && (!best || nm.length > best.len)) {
      best = { id, ach: EC_ACH[id], len: nm.length };
    }
  }
  if (best) return { id: best.id, ach: best.ach };
  // 4) не нашли — подсказка в консоль для отладки каталога
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[ach] карточка не построена: имя не найдено в EC_ACH', { title, cands });
  }
  return null;
}
// Карточка самого достижения для статьи новости: арт (или значок-фолбэк) + название +
// условие получения + девиз + смысл + награда. '' если новость не про достижение или
// ачивка не найдена в каталоге.
function fnAchCardHtml(n) {
  if (!fnIsAch(n)) return '';
  const found = fnAchLookup(n);
  if (!found) return '';
  const { id, ach } = found;
  const num = (v) => (typeof ecNum === 'function') ? ecNum(v) : v;
  return `<div class="fn-ach-card">
    <div class="fn-ach-art">
      <img src="${esc(`assets/ach/${id}.webp`)}" alt="" loading="lazy" onerror="this.remove()">
      <span class="fn-ach-glyph">${esc(ach.ic || '🏆')}</span>
      <span class="fn-ach-badge" aria-hidden="true">🏆</span>
    </div>
    <div class="fn-ach-info">
      <div class="fn-ach-label">◆ Достижение получено</div>
      <div class="fn-ach-name">${esc(ach.name || '')}</div>
      ${ach.cond  ? `<div class="fn-ach-cond"><span class="fn-ach-cond-ic">⬡</span> ${esc(ach.cond)}</div>` : ''}
      ${ach.quote ? `<div class="fn-ach-quote">«${esc(ach.quote)}»</div>` : ''}
      ${ach.desc  ? `<div class="fn-ach-desc">${esc(ach.desc)}</div>` : ''}
      ${ach.reward ? `<span class="fn-ach-reward">◆ +${num(ach.reward)} ГС</span>` : ''}
    </div>
  </div>`;
}
// ── Новелла: герб причастной державы (ФОНОМ за текстом) + карточка ачивки ──
// Когда герой на обложке рассказывает о сводке, герб причастной державы ложится
// ФОНОМ-водяным знаком за текстом окна (как `.fn-art-bgflag` в статье), а для
// достижения под текстом раскрывается карточка самой ачивки. Событие БЕЗ
// причастной фракции (биржа и т.п.) → ни фона, ни карточки.
// URL герба для фоновой подложки окна ('' — нет причастной державы/герба).
function fnHeroFlagUrl(n) {
  if (!n) return '';
  const fac = (typeof fnEventFaction === 'function') ? fnEventFaction(n) : null;
  return (fac && fac.herald_url) || '';
}
// HTML под текстом: игровая плашка достижения (для ачивок). Иначе '' — флаг
// уже отрисован фоном через fnHeroFlagUrl.
function fnHeroBannerHtml(n) {
  if (!n) return '';
  if (!(typeof fnIsAch === 'function' && fnIsAch(n))) return '';
  return (typeof fnHeroAchHtml === 'function') ? fnHeroAchHtml(n) : '';
}
// Игровая плашка достижения для новеллы — БЕЗ декоративных символов (◆/⬡/🏆),
// плоский sci-fi в токенах окна. Отдельная от статейной fnAchCardHtml.
function fnHeroAchHtml(n) {
  const found = (typeof fnAchLookup === 'function') ? fnAchLookup(n) : null;
  if (!found) return '';
  const { id, ach } = found;
  const en = (typeof lang !== 'undefined' && lang === 'en');
  const num = (v) => (typeof ecNum === 'function') ? ecNum(v) : v;
  // Арт ачивки, при сбое загрузки — значок-фолбэк (ach.ic или 🏆), а не пустой квадрат.
  const glyph = esc(ach.ic || '🏆');
  const art = `<div class="hp-vn-ach-art">
    <img src="${esc('assets/ach/' + id + '.webp')}" alt="" loading="lazy" onerror="this.closest('.hp-vn-ach-art').classList.add('noimg')">
    <span class="hp-vn-ach-glyph" aria-hidden="true">${glyph}</span>
  </div>`;
  return `<div class="hp-vn-ach">
    <span class="hp-vn-ach-scan" aria-hidden="true"></span>
    ${art}
    <div class="hp-vn-ach-body">
      <div class="hp-vn-ach-kick">${en ? 'Achievement unlocked' : 'Достижение получено'}</div>
      <div class="hp-vn-ach-name">${esc(ach.name || '')}</div>
      ${ach.cond  ? `<div class="hp-vn-ach-cond">${esc(ach.cond)}</div>` : ''}
      ${ach.quote ? `<div class="hp-vn-ach-quote">«${esc(ach.quote)}»</div>` : ''}
      ${ach.desc  ? `<div class="hp-vn-ach-desc">${esc(ach.desc)}</div>` : ''}
      ${ach.reward ? `<div class="hp-vn-ach-reward">+${num(ach.reward)} ГС</div>` : ''}
    </div>
  </div>`;
}
function fnFeedRow(n) {
  const kind = fnKind(n);
  const ic = kind === 'bulletin' ? '◈' : '📡';
  return `<div class="fn-feed-row fn-fr-${kind}" data-fn-id="${esc(n.id)}" onclick="fnOpenArticle('${esc(n.id)}')">
    <span class="fn-fr-ic">${ic}</span>
    ${fnFeedFlagHtml(n)}
    <span class="fn-fr-title">${esc(n.title || '')}</span>
    <span class="fn-fr-time">${esc(fnStardate(n.published_at || n.created_at))}</span>
    ${fnIsStaff() ? `<button class="fn-fr-del" title="Удалить (админ)" onclick="fnAdminDelete('${esc(n.id)}',event)">✕</button>` : ''}
  </div>`;
}
// Сводная строка ленты сектора: ВСЕ достижения сектора в одной сворачиваемой группе.
// Каждая под-строка — конкретная ачивка: флаг фракции + название + арт ачивки фоном.
function fnFeedAchGroup(grp) {
  const cnt = grp.length;
  const word = fnPlural(cnt, 'достижение', 'достижения', 'достижений');
  const sub = grp.map(n => {
    const who = String(n.title || '').replace(/^🏆\s*Достижение:\s*/, '').trim() || 'Фракция';
    const m = /достижени[ея]\s+«([^»]+)»/i.exec(n.body || '');
    const nm = m ? m[1] : who;
    const img = fnAchImg(n);
    const bg = img ? ` style="--fn-ach-img:url('${esc(img)}')"` : '';
    return `<div class="fn-feed-row fn-fr-bulletin fn-feed-subrow${img ? ' has-art' : ''}"${bg} data-fn-id="${esc(n.id)}" onclick="event.stopPropagation();fnOpenArticle('${esc(n.id)}')">
      <span class="fn-fr-ic">🏆</span>
      ${fnFeedFlagHtml(n)}
      <span class="fn-fr-title"><b>${esc(who)}</b> — ${esc(nm)}</span>
      <span class="fn-fr-time">${esc(fnStardate(n.published_at || n.created_at))}</span>
    </div>`;
  }).join('');
  return `<div class="fn-feed-group">
    <div class="fn-feed-row fn-fr-bulletin fn-feed-summary" onclick="fnToggleFeedAchGroup(this)" role="button" tabindex="0">
      <span class="fn-fr-chev">▸</span>
      <span class="fn-fr-ic">🏆</span>
      <span class="fn-fr-title">${esc(cnt + ' ' + word + ' сектора')}</span>
      <span class="fn-feed-hint">развернуть</span>
      <span class="fn-fr-time">${esc(fnStardate(grp[0].published_at || grp[0].created_at))}</span>
    </div>
    <div class="fn-feed-sub">${sub}</div>
  </div>`;
}
function fnToggleFeedAchGroup(el) {
  const g = el.closest('.fn-feed-group');
  if (g) g.classList.toggle('open');
}
// Сводная строка ленты: ВСЕ колонизации в одной сворачиваемой группе.
// Колоний бывают десятки — без сворачивания они монополизируют ленту.
function fnFeedColonyGroup(grp) {
  const cnt = grp.length;
  const word = fnPlural(cnt, 'колонизация', 'колонизации', 'колонизаций');
  const sub = grp.map(n => {
    // title: «Колонизация: <планета> — <фракция>» → показываем хвост
    const tail = String(n.title || '').replace(/^Колонизация:\s*/, '').trim() || '—';
    return `<div class="fn-feed-row fn-fr-bulletin fn-feed-subrow" data-fn-id="${esc(n.id)}" onclick="event.stopPropagation();fnOpenArticle('${esc(n.id)}')">
      <span class="fn-fr-ic">🪐</span>
      ${fnFeedFlagHtml(n)}
      <span class="fn-fr-title">${esc(tail)}</span>
      <span class="fn-fr-time">${esc(fnStardate(n.published_at || n.created_at))}</span>
    </div>`;
  }).join('');
  return `<div class="fn-feed-group">
    <div class="fn-feed-row fn-fr-bulletin fn-feed-summary" onclick="fnToggleFeedAchGroup(this)" role="button" tabindex="0">
      <span class="fn-fr-chev">▸</span>
      <span class="fn-fr-ic">🪐</span>
      <span class="fn-fr-title">${esc(cnt + ' ' + word + ' сектора')}</span>
      <span class="fn-feed-hint">развернуть</span>
      <span class="fn-fr-time">${esc(fnStardate(grp[0].published_at || grp[0].created_at))}</span>
    </div>
    <div class="fn-feed-sub">${sub}</div>
  </div>`;
}
// Собираем ленту: достижения и колонизации — каждое в свою сворачиваемую сводку
// сверху, остальные события (экспансия / новые государства / вера / союзы / слухи) —
// строками. Так массовые однотипные события не вытесняют разнообразную хронику.
function fnFeedRows(rows) {
  const achs = rows.filter(fnIsAch);
  const colonies = rows.filter(n => !fnIsAch(n) && fnIsColony(n));
  const others = rows.filter(n => !fnIsAch(n) && !fnIsColony(n));
  const out = [];
  if (achs.length) out.push(achs.length > 1 ? fnFeedAchGroup(achs) : fnFeedRow(achs[0]));
  if (colonies.length) out.push(colonies.length > 1 ? fnFeedColonyGroup(colonies) : fnFeedRow(colonies[0]));
  others.slice(0, 10).forEach(n => out.push(fnFeedRow(n)));
  return out.join('');
}
function fnEventsFeedHtml() {
  const ev = FN.events || [];
  if (!ev.length) return '';
  return `<section class="home-block fn-feed">
    <div class="hb-head"><span class="hb-tag">ЛЕНТА СЕКТОРА</span><span class="fn-home-sub">// СИСТЕМНЫЕ СОБЫТИЯ · ${ev.length}</span></div>
    <div id="fn-corp-ticker"></div>
    <div class="fn-feed-list" id="fn-feed-list">${fnFeedRows(ev)}</div>
  </section>`;
}

// ── Биржевая бегущая лента в «Ленте сектора» ────────────────
// Котировки одобренных организаций (тот же RPC corps_status, что и кабинет
// «Биржа»). Заполняем асинхронно после рендера главной — RPC тяжёлый и
// требует логина, поэтому он не должен тормозить загрузку страницы.
function fnCorpTickerHtml(cs) {
  const board = (cs && cs.board) || [];
  if (!board.length) return '';
  const ses = (cs && cs.session) || {};
  const num = (typeof ecNum === 'function') ? ecNum : (v => Number(v || 0).toLocaleString('ru-RU'));
  const chgOf = (price, sp) => { const f = (sp && sp.length) ? +sp[0] : price; return f ? Math.round((price / f - 1) * 100) : 0; };
  const items = board.map(b => {
    const ch = chgOf(b.share_price, b.spark), up = ch >= 0;
    return `<span class="ec-tick-item"><b>${esc(b.name)}</b> ${num(Math.round(b.share_price))} <span style="color:${up ? '#5fc98a' : '#e0688a'}">${up ? '▲' : '▼'}${ch >= 0 ? '+' : ''}${ch}%</span></span>`;
  }).join('');
  const sesPill = ses.open
    ? `<span class="fn-corp-ses on">● торги открыты</span>`
    : `<span class="fn-corp-ses off">● торги закрыты</span>`;
  return `<div class="fn-corp-ticker">
    <span class="fn-corp-ticker-cap">📈 CORP·IDX ${sesPill}</span>
    <div class="ec-tick"><div class="ec-tick-run">${items}${items}</div></div>
  </div>`;
}
// ── Ситуативный совет по бирже (для новеллы) ────────────────
// Читает срез corps_status (board котировок + сессия), оценивает настроение
// рынка (средняя дневная динамика + ширина роста) и возвращает СЛУЧАЙНУЮ
// реплику из пула, подходящего к текущей ситуации. Не «из вакуума» — числа и
// имена лидера/аутсайдера берём из живых котировок.
function _fnPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
// Дней до экспирации позиции (фьючерс/опцион). +Infinity, если даты нет.
function _fnDaysTo(iso) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  return isNaN(t) ? Infinity : (t - Date.now()) / 86400000;
}
// Советы по ЛИЧНЫМ деривативам игрока (маржа/фьючерсы/опционы). Возвращает
// { urgent:[], notable:[] } — urgent = риск ликвидации/экспирация сегодня/крупный
// минус (приоритет), notable = прибыль/идущие позиции/контанго. Числа реальные.
function _fnDerivAdvice(margin, futures, options, en) {
  const urgent = [], notable = [];
  const sideRu = s => s === 'short' ? 'шорт' : 'лонг';
  const sideEn = s => s === 'short' ? 'short' : 'long';
  const pct = x => (x >= 0 ? '+' : '') + Math.round(x) + '%';
  // близость к ликвидации: |цена−ликв| / цена
  const liqNear = p => p.liq && p.price ? Math.abs(p.price - p.liq) / p.price : 1;

  // ── Маржинальные позиции ──
  (margin && margin.open || []).forEach(p => {
    const ln = liqNear(p), profit = (p.pnl || 0) >= 0;
    const roi = p.collateral ? (p.pnl / p.collateral) * 100 : 0;
    if (ln <= 0.07 && p.pnl < 0) {
      urgent.push(en
        ? `Your ${sideEn(p.side)} on ${p.resource} is a breath from liquidation — price ${Math.round(p.price)}, wall at ${Math.round(p.liq)}. Add collateral or cut it.`
        : `Твой ${sideRu(p.side)} по «${p.resource}» в шаге от ликвидации — цена ${Math.round(p.price)}, стена на ${Math.round(p.liq)}. Доливай залог или режь.`);
    } else if (roi <= -45) {
      urgent.push(en
        ? `That ${sideEn(p.side)} on ${p.resource} is deep red — ${pct(roi)} on your collateral at ×${p.leverage}. Leverage cuts both ways.`
        : `Тот ${sideRu(p.side)} по «${p.resource}» глубоко в минусе — ${pct(roi)} к залогу при ×${p.leverage}. Плечо режет в обе стороны.`);
    } else if (roi >= 60) {
      notable.push(en
        ? `Your ${sideEn(p.side)} on ${p.resource} is up ${pct(roi)} on collateral. A good moment to bank some of it.`
        : `Твой ${sideRu(p.side)} по «${p.resource}» даёт ${pct(roi)} к залогу. Хороший момент часть зафиксировать.`);
    } else {
      notable.push(en
        ? `${p.resource} ${sideEn(p.side)} is running at ×${p.leverage}, ${profit ? 'green' : 'red'} for now. Keep an eye on the liq line.`
        : `«${p.resource}», ${sideRu(p.side)} ×${p.leverage}, пока ${profit ? 'в плюсе' : 'в минусе'}. Поглядывай на линию ликвидации.`);
    }
  });

  // ── Фьючерсы ──
  (futures && futures.open || []).forEach(p => {
    const d = _fnDaysTo(p.expires_at), profit = (p.pnl || 0) >= 0;
    if (d <= 1) {
      urgent.push(en
        ? `Your ${p.resource} future expires within the day — it settles to spot whether you like it or not. Decide now.`
        : `Твой фьючерс на «${p.resource}» гасится в течение суток — расчёт по споту, хочешь ты того или нет. Решай сейчас.`);
    } else if (d <= 3) {
      notable.push(en
        ? `The ${p.resource} future has ${Math.ceil(d)} days left and sits ${profit ? 'in profit' : 'underwater'}. Expiry is near.`
        : `У фьючерса на «${p.resource}» осталось ${Math.ceil(d)} дн., и он ${profit ? 'в плюсе' : 'под водой'}. Экспирация близко.`);
    } else {
      notable.push(en
        ? `You're holding a ${p.resource} future, ${profit ? 'green' : 'red'} for now — contango does the rest until expiry.`
        : `Держишь фьючерс на «${p.resource}», пока ${profit ? 'в плюсе' : 'в минусе'} — до экспирации доделает контанго.`);
    }
  });

  // ── Опционы ──
  (options && options.open || []).forEach(p => {
    const d = _fnDaysTo(p.expires_at), itm = (p.intrinsic || 0) > 0;
    const kindRu = p.kind === 'put' ? 'пут' : 'колл';
    if (d <= 1) {
      (itm ? urgent : notable).push(en
        ? `Your ${p.kind} on ${p.resource} expires within the day — ${itm ? `it's in the money (${Math.round(p.intrinsic)}). Exercise or close before it's worthless.` : 'it’s out of the money. Likely it just burns.'}`
        : `Твой ${kindRu} на «${p.resource}» истекает в течение суток — ${itm ? `он в деньгах (${Math.round(p.intrinsic)}). Исполни или закрой, пока не сгорел.` : 'он вне денег. Скорее всего просто сгорит.'}`);
    } else if (itm && (p.value || 0) >= (p.premium_paid || 0) * 1.5) {
      notable.push(en
        ? `That ${p.kind} on ${p.resource} is well in the money — worth far more than its premium. Closing early locks the win.`
        : `Тот ${kindRu} на «${p.resource}» крепко в деньгах — стоит куда больше премии. Закрыть досрочно — зафиксировать выигрыш.`);
    } else {
      notable.push(en
        ? `You hold a ${p.kind} on ${p.resource}, ${itm ? 'in the money' : 'still out of the money'}. Time decay is the enemy.`
        : `У тебя ${kindRu} на «${p.resource}», ${itm ? 'в деньгах' : 'пока вне денег'}. Главный враг — распад по времени.`);
    }
  });

  return { urgent, notable };
}
function fnMarketMoodAdvice(cs, en) {
  const board = (cs && cs.board) || [];
  const open = !!(cs && cs.session && cs.session.open);
  // Нет котировок — затишье/закрыто.
  if (!board.length) {
    return open
      ? _fnPick(en
          ? ['The board is bare today — no one is trading. Best to wait.',
             'Quiet on the floor — not a single quote moving.']
          : ['Доска пуста — никто не торгует. Лучше выждать.',
             'В зале тихо — ни одной котировки не шелохнётся.'])
      : _fnPick(en
          ? ['Trading is closed — come back when the bell rings.',
             'The exchange is shut for now. Nothing to do but wait for the open.']
          : ['Торги закрыты — загляни, когда ударит гонг.',
             'Биржа сейчас на замке. Остаётся ждать открытия.']);
  }
  const chgOf = (b) => {
    const f = (b.spark && b.spark.length) ? +b.spark[0] : b.share_price;
    return f ? (b.share_price / f - 1) * 100 : 0;
  };
  let sum = 0, up = 0, best = null, worst = null;
  board.forEach(b => {
    const ch = chgOf(b);
    sum += ch; if (ch >= 0) up++;
    if (!best  || ch > best.ch)  best  = { name: b.name, ch };
    if (!worst || ch < worst.ch) worst = { name: b.name, ch };
  });
  const avg = sum / board.length;
  const breadth = up / board.length;          // доля растущих
  const r = (x) => (x >= 0 ? '+' : '') + Math.round(x) + '%';
  const bN = best ? best.name : '', wN = worst ? worst.name : '';
  const closedTail = open ? '' : (en ? ' But the bell has rung — trading is closed.' : ' Но гонг уже прозвучал — торги закрыты.');
  let pool;
  if (avg >= 4) {                              // бурный рост
    pool = en
      ? [`The board is on fire — ${bN} leads at ${r(best.ch)}. Ride it, but don't get greedy.`,
         `Euphoria today: almost everything is green. ${bN} is the talk of the floor.`,
         `Bulls are charging — ${Math.round(breadth*100)}% of papers up. A day to take profit, not chase.`]
      : [`Доска пылает — ${bN} ведёт на ${r(best.ch)}. Лови момент, но не жадничай.`,
         `Сегодня эйфория: почти всё в зелёном. О ${bN} говорит весь зал.`,
         `Быки в атаке — растёт ${Math.round(breadth*100)}% бумаг. День фиксировать прибыль, а не догонять.`];
  } else if (avg >= 1.2) {                      // умеренный рост
    pool = en
      ? [`Mood is upbeat — ${bN} up ${r(best.ch)}, the rest follows quietly.`,
         `A calm green day. Nothing wild, but the trend leans up.`,
         `Buyers have the edge today. ${bN} is the one to watch.`]
      : [`Настрой бодрый — ${bN} прибавляет ${r(best.ch)}, остальные тихо подтягиваются.`,
         `Спокойный зелёный день. Без безумств, но тренд клонит вверх.`,
         `Сегодня перевес у покупателей. Приглядись к ${bN}.`];
  } else if (avg > -1.2) {                      // боковик
    pool = en
      ? [`The market is undecided — half up, half down. A day for patience.`,
         `Flat and nervous: ${bN} ${r(best.ch)}, ${wN} ${r(worst.ch)}. No clear hand.`,
         `Choppy waters. I'd watch before I'd wager.`]
      : [`Рынок в нерешительности — половина вверх, половина вниз. День для терпения.`,
         `Вяло и нервно: ${bN} ${r(best.ch)}, ${wN} ${r(worst.ch)}. Чёткой руки нет.`,
         `Качка на воде. Я бы сперва присмотрелась, а не ставила.`];
  } else if (avg > -4) {                         // умеренное падение
    pool = en
      ? [`Sellers are pressing — ${wN} down ${r(worst.ch)}. Careful with new positions.`,
         `A red drift across the board. Bargain hunters may stir, but don't catch a falling knife.`,
         `The mood has soured today. ${wN} is dragging the floor down.`]
      : [`Продавцы давят — ${wN} теряет ${r(worst.ch)}. С новыми позициями осторожнее.`,
         `Красный дрейф по всей доске. Охотники за дешевизной зашевелятся, но не лови падающий нож.`,
         `Настроение скисло. ${wN} тянет зал вниз.`];
  } else {                                       // обвал
    pool = en
      ? [`Panic on the floor — ${wN} collapses ${r(worst.ch)}, ${Math.round((1-breadth)*100)}% of papers bleeding.`,
         `A rout today. Better to sit on your money than rush to buy the dip.`,
         `The board is drowning in red. Even ${bN}, the day's "best", is barely holding.`]
      : [`Паника в зале — ${wN} рушится на ${r(worst.ch)}, кровит ${Math.round((1-breadth)*100)}% бумаг.`,
         `Сегодня разгром. Лучше переждать с деньгами на руках, чем спешить откупать падение.`,
         `Доска тонет в красном. Даже ${bN}, «лучший» за день, едва держится.`];
  }
  return _fnPick(pool) + closedTail;
}
// Итоговый совет: ЛИЧНЫЕ деривативы важнее настроения рынка. Срочное (риск
// ликвидации/экспирация) — всегда; заметное (прибыль/идущие позиции) — часто;
// иначе общий настрой по котировкам. Числа и имена — из живых срезов.
function fnExchangeAdviceFrom(d, en) {
  d = d || {};
  const { urgent, notable } = _fnDerivAdvice(d.margin, d.futures, d.options, en);
  if (urgent.length) return _fnPick(urgent);
  if (notable.length && Math.random() < 0.7) return _fnPick(notable);
  return fnMarketMoodAdvice(d.cs, en);
}
// СИНХРОННЫЙ совет — берёт только уже загруженные данные (кабинет EC.* или кэш
// FN.*), поэтому реплика печатается мгновенно, без подвисания/«глитча» окна.
// Если в кэше ничего нет, возвращает '' (зовущий даст нейтральный фолбэк).
function fnExchangeAdvice(en) {
  const EChas = (typeof EC !== 'undefined') ? EC : {};
  const pick = (cacheKey, ecKey) => FN[cacheKey] || EChas[ecKey] || null;
  const cs      = pick('_corpStatus',    'corps');
  const margin  = pick('_marginStatus',  'margin');
  const futures = pick('_futuresStatus', 'futures');
  const options = pick('_optionsStatus', 'options');
  if (!cs && !margin && !futures && !options) { fnWarmExchange(); return ''; }
  return fnExchangeAdviceFrom({ cs, margin, futures, options }, en);
}
// Тихо прогреть кэш срезов на будущее (fire-and-forget, без блокировки UI).
function fnWarmExchange() {
  if (FN._exWarming) return;
  if (!(typeof user !== 'undefined' && user && typeof ecRpc === 'function')) return;
  FN._exWarming = true;
  const set = (k, p) => p.then(v => { FN[k] = v; }).catch(() => {});
  Promise.all([
    set('_corpStatus',    ecRpc('corps_status')),
    set('_marginStatus',  ecRpc('margin_status')),
    set('_futuresStatus', ecRpc('futures_status')),
    set('_optionsStatus', ecRpc('options_status')),
  ]).finally(() => { FN._exWarming = false; });
}
async function fnLoadCorpTicker() {
  // Цели: лента сектора (#fn-corp-ticker) и боковая лента индексов в новелле (#hp-vn-ticker).
  const mounts = () => [document.getElementById('fn-corp-ticker'), document.getElementById('hp-vn-ticker')].filter(Boolean);
  const fill = html => mounts().forEach(m => { m.innerHTML = html; });
  if (!mounts().length) return;
  if (typeof user === 'undefined' || !user || typeof ecRpc !== 'function') return;
  // Кэш на сессию: не дёргаем тяжёлый RPC при каждом возврате на главную.
  if (FN._corpTickerHtml != null && (Date.now() - (FN._corpTickerAt || 0) < 90000)) {
    fill(FN._corpTickerHtml); return;
  }
  let cs = null;
  try { cs = await ecRpc('corps_status'); } catch (e) { return; }
  FN._corpStatus = cs;   // сырой срез для ситуативного совета в новелле
  const html = fnCorpTickerHtml(cs);
  FN._corpTickerHtml = html; FN._corpTickerAt = Date.now();
  fill(html);
}
// ── Бегущая строка ЛИЧНЫХ позиций игрока (маржа/фьючерсы/опционы) ──
// Идёт ОТДЕЛЬНОЙ лентой над котировками компаний в новелле. Числа реальные —
// из срезов margin_status/futures_status/options_status. Нет позиций → '' (строка
// просто не показывается).
function fnDerivTickerHtml(margin, futures, options, en) {
  const num = (typeof ecNum === 'function') ? ecNum : (v => Math.round(Number(v || 0)).toLocaleString('ru-RU'));
  const col = up => up ? '#5fc98a' : '#e0688a';
  const pct = x => (x >= 0 ? '+' : '') + Math.round(x) + '%';
  const sval = v => (v >= 0 ? '+' : '') + num(Math.round(v));
  const daysTo = iso => { if (!iso) return Infinity; const t = Date.parse(iso); return isNaN(t) ? Infinity : (t - Date.now()) / 86400000; };
  const items = [];
  // Маржинальные лонги/шорты: ROI к залогу + предупреждение о близкой ликвидации.
  (margin && margin.open || []).forEach(p => {
    const up = (p.pnl || 0) >= 0;
    const roi = p.collateral ? (p.pnl / p.collateral) * 100 : 0;
    const side = p.side === 'short' ? (en ? 'short' : 'шорт') : (en ? 'long' : 'лонг');
    const liqNear = (p.liq && p.price) ? Math.abs(p.price - p.liq) / p.price : 1;
    const warn = (liqNear <= 0.08 && (p.pnl || 0) < 0) ? '⚠ ' : '';
    items.push(`<span class="ec-tick-item">${warn}<b>${esc(p.resource)}</b> ${side} ×${p.leverage || 1} <span style="color:${col(up)}">${pct(roi)}</span></span>`);
  });
  // Фьючерсы: P&L + песочные часы при экспирации в течение суток.
  (futures && futures.open || []).forEach(p => {
    const up = (p.pnl || 0) >= 0;
    const exp = daysTo(p.expires_at) <= 1 ? ' ⏳' : '';
    items.push(`<span class="ec-tick-item"><b>${esc(p.resource)}</b> ${en ? 'fut' : 'фьюч'}${exp} <span style="color:${col(up)}">${sval(p.pnl || 0)}</span></span>`);
  });
  // Опционы: в деньгах / вне денег + экспирация.
  (options && options.open || []).forEach(p => {
    const itm = (p.intrinsic || 0) > 0;
    const exp = daysTo(p.expires_at) <= 1 ? ' ⏳' : '';
    const kind = p.kind === 'put' ? (en ? 'put' : 'пут') : (en ? 'call' : 'колл');
    items.push(`<span class="ec-tick-item"><b>${esc(p.resource)}</b> ${kind}${exp} <span style="color:${col(itm)}">${itm ? (en ? 'ITM' : 'в деньгах') : (en ? 'OTM' : 'вне денег')}</span></span>`);
  });
  if (!items.length) return '';
  const cap = en ? '💼 MY POSITIONS' : '💼 МОИ ПОЗИЦИИ';
  const run = items.join('');
  return `<div class="fn-corp-ticker">
    <span class="fn-corp-ticker-cap">${cap}</span>
    <div class="ec-tick"><div class="ec-tick-run">${run}${run}</div></div>
  </div>`;
}
// Заполнить ленту личных позиций в новелле (#hp-vn-myticker). Берёт прогретый
// кэш срезов (fnWarmExchange), при отсутствии — догружает сам.
async function fnLoadMyTicker() {
  const mount = document.getElementById('hp-vn-myticker');
  if (!mount) return;
  if (typeof user === 'undefined' || !user || typeof ecRpc !== 'function') { mount.innerHTML = ''; return; }
  const en = (typeof lang !== 'undefined' && lang === 'en');
  let m = FN._marginStatus, f = FN._futuresStatus, o = FN._optionsStatus;
  if (m == null && f == null && o == null) {
    try {
      const r = await Promise.all([
        ecRpc('margin_status').catch(() => null),
        ecRpc('futures_status').catch(() => null),
        ecRpc('options_status').catch(() => null),
      ]);
      m = r[0]; f = r[1]; o = r[2];
      FN._marginStatus = m; FN._futuresStatus = f; FN._optionsStatus = o;
    } catch (e) { return; }
  }
  // Если #hp-vn-myticker уже исчез (игрок ушёл с биржи), не трогаем.
  if (!document.getElementById('hp-vn-myticker')) return;
  mount.innerHTML = fnDerivTickerHtml(m, f, o, en);
}
async function fnLoadMoreEvents() {
  const off = (FN.events || []).length;
  let more = [];
  try { more = await dbGet('faction_news', `status=eq.approved&owner_id=is.null&order=created_at.desc&offset=${off}&limit=30`) || []; } catch (e) {}
  if (more.length) {
    FN.events = (FN.events || []).concat(more);
    more.forEach(n => FN.byId.set(n.id, n));
    const list = document.getElementById('fn-feed-list');
    if (list) list.insertAdjacentHTML('beforeend', fnFeedRows(more));
  }
  if (more.length < 30) { const b = document.getElementById('fn-feed-more'); if (b) b.style.display = 'none'; }
}

// ── Полноэкранная статья (sci-fi «терминал-депеша») ─────────
function fnBodyToParas(body) {
  let isFirst = true;
  return String(body || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => {
      // [music:URL] или голая музыкальная ссылка — плеер (null для чужих доменов)
      const mus = p.match(/^\[music:(https?:\/\/[^\]\s]+)\]$/i) || (p.match(/^https?:\/\/\S+$/i) ? [null, p] : null);
      if (mus) { const h = fnMusicHtml(mus[1]); if (h) return h; }
      // [img:URL] или голый URL картинки — рендерим как изображение
      const imgMatch = p.match(/^\[img:(https?:\/\/.+)\]$/i)
        || (p.match(/^https?:\/\/\S+$/i) && p.match(/\.(jpe?g|png|gif|webp|avif|svg)(\?[^\s]*)?$/i) ? [null, p] : null);
      if (imgMatch) return `<div class="fn-art-img"><img src="${esc(imgMatch[1])}" loading="lazy" alt=""></div>`;
      const cls = isFirst ? ' class="fn-lead-p"' : '';
      if (isFirst) isFirst = false;
      return `<p${cls}>${esc(p).replace(/\n/g, '<br>')}</p>`;
    }).join('');
}
// Богатый рендер тела статьи: тот же markdown/FX-движок, что и в вики-статьях
// (renderMd/il из render.js) + совместимость со старым синтаксисом новостей
// [img:URL] и голым URL картинки. Падение назад на fnBodyToParas, если renderMd нет.
function fnRenderBody(body) {
  let t = String(body || '').replace(/\r/g, '');
  // [img:URL] → markdown-картинка
  t = t.replace(/\[img:(https?:\/\/[^\]\s]+)\]/g, (_, u) => `\n\n![](${u})\n\n`);
  // голый URL картинки на отдельной строке → markdown-картинка
  t = t.replace(/^(https?:\/\/\S+\.(?:jpe?g|png|gif|webp|avif|svg)(?:\?\S*)?)\s*$/gim, '![]($1)');
  if (typeof renderMd !== 'function') return fnBodyToParas(body);
  // «Шизотекст» может занимать НЕСКОЛЬКО абзацев, а renderMd рубит текст по строкам
  // и не видит парный тег. Поэтому вынимаем такие блоки целиком ДО renderMd,
  // подменяем плейсхолдером, а после — возвращаем готовый HTML рун.
  const blocks = [];
  // Сворачиваемые «главы» [spoiler:Заголовок]…[/spoiler] и блоки под паролем
  // [lock:пароль|Заголовок]…[/lock]. Вынимаем ДО renderMd (они многострочные),
  // содержимое рендерим рекурсивно, на место ставим плейсхолдер FNEMBi.
  const embeds = [];
  const stash = h => `\n\nFNEMB${embeds.push(h) - 1}\n\n`;
  t = t.replace(/\[spoiler:([^\]\n]*)\]([\s\S]*?)\[\/spoiler\]/gi,
    (_, title, inner) => stash(fnSpoilerHtml(title, fnRenderBody(inner))));
  t = t.replace(/\[lock:([^\]\n]*?)\]([\s\S]*?)\[\/lock\]/gi,
    (_, meta, inner) => stash(fnLockHtml(meta, fnRenderBody(inner))));
  // Музыка: [music:URL] или голая ссылка YouTube/SoundCloud на отдельной строке
  // → безопасный плеер (fnMusicHtml вернёт null для чужих доменов — тогда как было)
  t = t.replace(/\[music:(https?:\/\/[^\]\s]+)\]/gi,
    (m0, u) => { const h = fnMusicHtml(u); return h ? stash(h) : m0; });
  t = t.replace(/^(https?:\/\/\S+)[ \t]*$/gim,
    (m0, u) => { const h = fnMusicHtml(u); return h ? stash(h) : m0; });
  t = t.replace(/\[fx:schizo\]([\s\S]*?)\[\/fx\]/gi, (m0, inner) => {
    // Однострочный (инлайновый) шизотекст оставляем renderMd — он отрендерит его
    // прямо внутри абзаца через il() и НЕ порвёт предложение. В отдельный блок
    // выносим только многострочный (renderMd рубит по строкам и не увидел бы тег).
    if (!/\n/.test(inner)) return m0;
    const i = blocks.push(typeof schizoWrap === 'function' ? schizoWrap(inner) : esc(inner)) - 1;
    return `\n\nSZ${i}\n\n`;
  });
  let html = renderMd(t);
  // Возвращаем блоки рун: только точная форма <p>SZi</p> (наш маркер всегда отдельный абзац),
  // поэтому случайный «SZ0» в тексте не пострадает.
  blocks.forEach((b, bi) => {
    const tok = 'SZ' + bi;
    const div = '<div class="fn-art-schizo">' + b + '</div>';
    // renderMd мог обернуть маркер по-разному (или вовсе не обернуть) — заменяем все формы
    html = html.split('<p>' + tok + '</p>').join(div)
               .split('<p>' + tok + ' </p>').join(div)
               .split('<p> ' + tok + '</p>').join(div)
               .split(tok).join(div);
  });
  // Возвращаем сворачиваемые блоки / блоки под паролем (без обёртки)
  embeds.forEach((b, bi) => {
    const tok = 'FNEMB' + bi;
    html = html.split('<p>' + tok + '</p>').join(b)
               .split('<p>' + tok + ' </p>').join(b)
               .split('<p> ' + tok + '</p>').join(b)
               .split(tok).join(b);
  });
  return html;
}

// base64 от UTF-8 строки — чтобы пароль не лежал в DOM открытым текстом
// (это не настоящая защита, а «спойлер»: содержимое всё равно в разметке).
function fnB64(s) { try { return btoa(unescape(encodeURIComponent(String(s)))); } catch (e) { return ''; } }

// HTML сворачиваемой «главы»: клик по шапке раскрывает/прячет содержимое.
function fnSpoilerHtml(title, bodyHtml) {
  const t = esc((String(title || '').trim()) || 'Раскрыть');
  return `<div class="fn-spoiler"><button type="button" class="fn-spoiler-hd" onclick="fnSpoilerToggle(this)">`
    + `<span class="fn-spoiler-ar">▶</span><span class="fn-spoiler-ttl">${t}</span></button>`
    + `<div class="fn-spoiler-body">${bodyHtml}</div></div>`;
}
// HTML блока под паролем: meta = "пароль" или "пароль|Заголовок".
function fnLockHtml(meta, bodyHtml) {
  const parts = String(meta || '').split('|');
  const pw = (parts[0] || '').trim();
  const title = esc((parts.slice(1).join('|').trim()) || 'Под паролем');
  return `<div class="fn-lock" data-pw="${esc(fnB64(pw))}"><div class="fn-lock-hd">🔒 ${title}</div>`
    + `<div class="fn-lock-gate"><input type="text" class="fn-lock-inp" placeholder="Введите пароль…" `
    + `autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" name="fn-lock-${Math.random().toString(36).slice(2)}" `
    + `onkeydown="if(event.key==='Enter'){event.preventDefault();fnLockTry(this);}">`
    + `<button type="button" class="fn-lock-btn" onclick="fnLockTry(this)">Открыть</button>`
    + `<span class="fn-lock-msg"></span></div><div class="fn-lock-body" hidden>${bodyHtml}</div></div>`;
}
// Раскрытие/сворачивание «главы».
function fnSpoilerToggle(btn) {
  const box = btn && btn.closest('.fn-spoiler');
  if (box) box.classList.toggle('open');
}
// Проверка пароля и раскрытие защищённого блока.
function fnLockTry(el) {
  const box = el && el.closest('.fn-lock');
  if (!box) return;
  const inp = box.querySelector('.fn-lock-inp');
  const msg = box.querySelector('.fn-lock-msg');
  if (fnB64(inp && inp.value || '') === (box.getAttribute('data-pw') || '') && (box.getAttribute('data-pw') || '')) {
    box.classList.add('open');
    const body = box.querySelector('.fn-lock-body'); if (body) body.hidden = false;
    const gate = box.querySelector('.fn-lock-gate'); if (gate) gate.style.display = 'none';
  } else {
    if (msg) msg.textContent = 'Неверный пароль';
    box.classList.add('fn-lock-shake');
    setTimeout(() => box.classList.remove('fn-lock-shake'), 420);
  }
}

// ── Музыка по ссылке (YouTube / SoundCloud) ──────────────────
// Безопасность: из пользовательской ссылки берётся ТОЛЬКО ID/путь,
// провалидированный жёстким регэкспом по белому списку доменов; iframe всегда
// собирается из нашего шаблона. Сырая ссылка юзера в разметку не попадает.
function fnMusicParse(url) {
  const u = String(url || '').trim();
  let m = u.match(/^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|live\/|embed\/)([A-Za-z0-9_-]{11})(?:[?&#]|$)/i)
       || u.match(/^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{11})(?:[?&#]|$)/i);
  if (m) return { kind: 'yt', id: m[1] };
  // soundcloud.com/автор/трек, автор/трек/s-секрет (unlisted), автор/sets/плейлист
  m = u.match(/^https?:\/\/(?:www\.)?soundcloud\.com\/([A-Za-z0-9][\w-]*(?:\/[\w-]+){1,2})\/?(?:\?[^\s]*)?$/i);
  if (m && !/^(?:discover|search|stream|upload|you|messages|settings|pages|charts|people|tags)\//i.test(m[1] + '/')) {
    return { kind: 'sc', path: m[1] };
  }
  // Яндекс Музыка: album/<id>/track/<id> или track/<id> (id — только цифры)
  m = u.match(/^https?:\/\/music\.yandex\.(?:ru|com|by|kz|ua)\/album\/(\d+)\/track\/(\d+)/i);
  if (m) return { kind: 'ym', track: m[2], album: m[1] };
  m = u.match(/^https?:\/\/music\.yandex\.(?:ru|com|by|kz|ua)\/track\/(\d+)/i);
  if (m) return { kind: 'ym', track: m[1] };
  return null;
}
// HTML карточки плеера. Click-to-load: iframe создаётся только по клику —
// статья не тянет тяжёлые плееры и не шлёт площадкам ни одного запроса до клика
// (у YouTube грузится только картинка-превью с i.ytimg.com).
function fnMusicHtml(url) {
  const p = fnMusicParse(url);
  if (!p) return null;
  if (p.kind === 'yt') {
    const embed = 'https://www.youtube-nocookie.com/embed/' + p.id + '?autoplay=1';
    return `<div class="fn-music fn-music-yt"><button type="button" class="fn-music-load" data-embed="${esc(embed)}" onclick="fnMusicLoad(this)">`
      + `<span class="fn-music-play">▶</span>`
      + `<img class="fn-music-thumb" src="https://i.ytimg.com/vi/${esc(p.id)}/mqdefault.jpg" loading="lazy" alt="">`
      + `<span class="fn-music-meta"><span class="fn-music-ttl">Аудиозапись</span><span class="fn-music-src">YouTube</span></span></button></div>`;
  }
  if (p.kind === 'ym') {
    const embed = 'https://music.yandex.ru/iframe/#track/' + p.track + (p.album ? '/' + p.album : '');
    return `<div class="fn-music fn-music-ym"><button type="button" class="fn-music-load" data-embed="${esc(embed)}" onclick="fnMusicLoad(this)">`
      + `<span class="fn-music-play">▶</span><span class="fn-music-meta"><span class="fn-music-ttl">Аудиозапись</span><span class="fn-music-src">Яндекс Музыка</span></span></button></div>`;
  }
  const embed = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent('https://soundcloud.com/' + p.path)
    + '&color=%23e8b04a&auto_play=true&visual=false&show_teaser=false';
  const name = (p.path.split('/').filter(s => s && s !== 'sets' && !/^s-/i.test(s)).pop() || 'трек').replace(/[-_]+/g, ' ');
  return `<div class="fn-music fn-music-sc"><button type="button" class="fn-music-load" data-embed="${esc(embed)}" onclick="fnMusicLoad(this)">`
    + `<span class="fn-music-play">▶</span><span class="fn-music-meta"><span class="fn-music-ttl">${esc(name)}</span><span class="fn-music-src">SoundCloud</span></span></button></div>`;
}
// Клик по карточке → создаём iframe. Src перепроверяется по белому списку ещё
// раз (защита в глубину: с чужим src iframe просто не создастся).
// YouTube — «аудио-режим»: сам плеер живёт в невидимом iframe, а карточка
// превращается в наш аудио-плеер (название, таймлайн с перемоткой, пауза,
// повтор) — управление и статусы через postMessage-протокол YouTube-iframe.
function fnMusicLoad(btn) {
  const box = btn && btn.closest('.fn-music');
  const src = (btn && btn.getAttribute('data-embed')) || '';
  const okYt = src.startsWith('https://www.youtube-nocookie.com/embed/');
  const okSc = src.startsWith('https://w.soundcloud.com/player/?');
  const okYm = src.startsWith('https://music.yandex.ru/iframe/');
  if (!box || (!okYt && !okSc && !okYm)) return;
  box._fnCard = box.innerHTML;   // исходная карточка — для fnMusicStopAll
  if (okYt) {
    const th = box.querySelector('.fn-music-thumb');
    const thumbSrc = (th && th.getAttribute('src')) || '';
    box.innerHTML = `<div class="fn-music-bar">
      <button type="button" class="fn-music-play" onclick="fnMusicToggle(this)">❚❚</button>
      ${thumbSrc ? `<img class="fn-music-thumb" src="${esc(thumbSrc)}" alt="">` : ''}
      <span class="fn-music-mid">
        <span class="fn-music-ttl">Аудиозапись</span>
        <span class="fn-music-tl" onclick="fnMusicSeek(event,this)"><span class="fn-music-tl-fill"></span></span>
      </span>
      <span class="fn-music-time">–:––</span>
      <button type="button" class="fn-music-rep" onclick="fnMusicRepeat(this)" title="Повторять трек">⟳</button>
    </div>`;
    const f = document.createElement('iframe');
    f.src = src + '&enablejsapi=1';
    f.className = 'fn-music-hidden';
    f.setAttribute('allow', 'autoplay; encrypted-media');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    f.setAttribute('referrerpolicy', 'origin');
    f.title = 'YouTube audio';
    // подписка на статусы плеера; шлём несколько раз — плеер может быть не готов
    const hail = () => { try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'fnmusic' }), 'https://www.youtube-nocookie.com'); } catch (e) {} };
    f.addEventListener('load', () => { hail(); setTimeout(hail, 700); setTimeout(hail, 2000); });
    if (!FN.musicMsgHooked) {
      FN.musicMsgHooked = true;
      window.addEventListener('message', fnMusicOnMessage);
    }
    box.appendChild(f);
    box.classList.add('on');
    fnMusicState(box, true);
    return;
  }
  // SoundCloud / Яндекс Музыка: видимый родной компакт-плеер на месте карточки
  const f = document.createElement('iframe');
  f.src = src;
  f.setAttribute('allow', 'autoplay; encrypted-media');
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
  f.setAttribute('referrerpolicy', 'origin');
  box.classList.add('on');
  box.textContent = '';
  box.appendChild(f);
}
// Статусы/прогресс от YouTube-iframe (infoDelivery). Один listener на страницу.
function fnMusicOnMessage(ev) {
  if (ev.origin !== 'https://www.youtube-nocookie.com') return;
  let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
  const info = d && d.info;
  if (!info) return;
  document.querySelectorAll('.fn-music-yt iframe').forEach(fr => {
    if (fr.contentWindow !== ev.source) return;
    const box = fr.closest('.fn-music');
    if (!box) return;
    if (info.videoData && info.videoData.title) {
      const t = box.querySelector('.fn-music-ttl');
      if (t && t.textContent !== info.videoData.title) t.textContent = info.videoData.title;
    }
    if (typeof info.duration === 'number' && info.duration > 0) box.dataset.dur = info.duration;
    if (typeof info.currentTime === 'number') fnMusicProgress(box, info.currentTime);
    if (typeof info.playerState === 'number') {
      // 1 = играет, 3 = буферизация; 2 = пауза; 0 = кончился (повтор — если включён)
      if (info.playerState === 0 && box.dataset.rep === '1') {
        fnMusicCmd(box, 'seekTo', [0, true]); fnMusicCmd(box, 'playVideo');
      } else {
        fnMusicState(box, info.playerState === 1 || info.playerState === 3);
      }
    }
  });
}
// Команда плееру в iframe (playVideo / pauseVideo / seekTo …).
function fnMusicCmd(box, func, args) {
  const f = box && box.querySelector('iframe');
  if (!f) return;
  try { f.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: args || [] }), 'https://www.youtube-nocookie.com'); } catch (e) {}
}
function fnMusicToggle(btn) {
  const box = btn && btn.closest('.fn-music');
  if (!box) return;
  const playing = box.classList.contains('playing');
  fnMusicCmd(box, playing ? 'pauseVideo' : 'playVideo');
  fnMusicState(box, !playing);
}
// Клик по таймлайну → перемотка (доля ширины × длительность).
function fnMusicSeek(ev, tl) {
  const box = tl && tl.closest('.fn-music');
  const dur = parseFloat(box && box.dataset.dur) || 0;
  if (!dur) return;
  const r = tl.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  fnMusicCmd(box, 'seekTo', [frac * dur, true]);
  fnMusicCmd(box, 'playVideo');
  fnMusicProgress(box, frac * dur);
  fnMusicState(box, true);
}
function fnMusicRepeat(btn) {
  const box = btn && btn.closest('.fn-music');
  if (!box) return;
  box.dataset.rep = box.dataset.rep === '1' ? '' : '1';
  btn.classList.toggle('on', box.dataset.rep === '1');
}
function fnMusicFmt(s) {
  s = Math.max(0, Math.round(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function fnMusicProgress(box, cur) {
  const dur = parseFloat(box.dataset.dur) || 0;
  const fill = box.querySelector('.fn-music-tl-fill');
  if (fill && dur) fill.style.width = Math.min(100, cur / dur * 100) + '%';
  const t = box.querySelector('.fn-music-time');
  if (t) t.textContent = fnMusicFmt(cur) + (dur ? ' / ' + fnMusicFmt(dur) : '');
}
// Переключить вид плеера: играет (❚❚) / пауза (▶).
function fnMusicState(box, playing) {
  if (!box) return;
  box.classList.toggle('playing', !!playing);
  const p = box.querySelector('.fn-music-play');
  if (p) p.textContent = playing ? '❚❚' : '▶';
}
// Заглушить все плееры в контейнере (закрытие статьи/композитора): iframe
// уничтожается (звук гаснет), карточка возвращается в вид «до клика».
function fnMusicStopAll(root) {
  (root || document).querySelectorAll('.fn-music.on').forEach(box => {
    const f = box.querySelector('iframe');
    if (f) f.remove();
    if (box._fnCard) box.innerHTML = box._fnCard;
    box.classList.remove('on', 'playing');
    box.dataset.rep = ''; box.dataset.dur = '';
  });
}

// ── Вердикт администрации (комментарий + журнал выдач) ────────
function fnGrantsParse(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch (e) { return []; }
}
function fnGrantsCollect() {
  try {
    const raw = document.getElementById('fn-c-grants')?.value;
    return raw ? fnGrantsParse(raw) : (AD?.embed?.grants || []);
  } catch (e) { return []; }
}
function fnGrantsSet(arr) {
  const el = document.getElementById('fn-c-grants');
  if (el) el.value = JSON.stringify(arr || []);
  if (AD && AD.embed) AD.embed.grants = arr || [];
}
function fnGrantIcon(type) {
  return ({ treasury: '💰', resource: '📦', research: '🔬', research_all: '🔬', unit: '⚔', agent: '🕵', system: '🌐', colony: '🏗', building: '🏭' }[type]) || '◈';
}
function fnGrantText(g) {
  const n = typeof adNum === 'function' ? adNum : v => Number(v || 0).toLocaleString('ru-RU');
  switch (g.type) {
    case 'treasury': {
      const sign = (g.delta || 0) >= 0 ? '+' : '';
      return g.delta != null ? `${sign}${n(g.delta)} ${g.label || adTreasuryLabel?.(g.field) || g.field || ''}`.trim() : `${g.label}: ${n(g.to)}`;
    }
    case 'resource': return `+${n(g.delta != null ? g.delta : (g.amt || g.to))} ${g.name || 'ресурс'}`;
    case 'research': return g.revoke ? `Отозвана технология «${g.name}»` : `Изучена технология «${g.name}»`;
    case 'research_all': return `Выдан полный пакет технологий (${g.count || 'все'})`;
    case 'unit': return `${g.name || 'Юнит'} ×${g.qty || 1}${g.category ? ' · ' + g.category : ''}`;
    case 'agent': {
      const perk = (typeof AD_PERKS !== 'undefined' ? AD_PERKS : []).find(p => p[0] === g.perk);
      return `${(g.first || '').trim()} ${(g.last || '').trim()}`.trim() + (perk ? ' · ' + perk[1] : '');
    }
    case 'system': return `Система «${g.name || g.id}» закреплена за фракцией`;
    case 'colony': return `Колония «${g.name}»${g.system ? ' · ' + g.system : ''}`;
    case 'building': return `Постройка «${g.name || g.btype}»`;
    default: return g.text || g.label || 'Выдача';
  }
}
function fnRenderGrantsBlock(grants) {
  if (!grants?.length) return '';
  const items = grants.map(g =>
    `<li class="fn-verdict-grant fn-grant-${esc(g.type || 'misc')}"><span class="fn-verdict-grant-ic" aria-hidden="true">${fnGrantIcon(g.type)}</span><span class="fn-verdict-grant-t">${esc(fnGrantText(g))}</span></li>`
  ).join('');
  return `<div class="fn-verdict-grants"><div class="fn-verdict-grants-hd">◈ Выдано по итогам рассмотрения</div><ul class="fn-verdict-grant-list">${items}</ul></div>`;
}
function fnRenderVerdictBlock(n) {
  const text = (n.staff_verdict || '').trim();
  const grants = fnGrantsParse(n.staff_grants);
  if (!text && !grants.length) return '';
  const grantsHtml = fnRenderGrantsBlock(grants);
  const bodyHtml = text ? `<div class="fn-verdict-body">${fnRenderBody(text)}</div>` : '';
  const when = n.verdict_at || n.updated_at;
  return `<div class="fn-art-verdict">
    <div class="fn-verdict-hd">
      <span class="fn-verdict-badge">⚖ Вердикт администрации</span>
      ${when ? `<span class="fn-verdict-meta">${esc(fnStardate(when))}</span>` : ''}
    </div>
    ${grantsHtml}
    ${bodyHtml}
  </div>`;
}
// ── Нейро-вердикт (авто-оценка ИИ) ──────────────────────────
// Виден стаффу всегда; игроку — только на свою новость (как подсказка).
// Метка считается на сервере; здесь только отображение.
const FN_AI_LABELS = {
  approve: { t: 'согласуется с лором', cls: 'ok',  ic: '✓' },
  review:  { t: 'требует проверки',    cls: 'mid', ic: '◐' },
  reject:  { t: 'противоречия / риск', cls: 'bad', ic: '✕' },
};
function fnAiBar(label, val) {
  const v = Math.max(0, Math.min(100, Number(val) || 0));
  const cls = v >= 60 ? 'ok' : (v >= 35 ? 'mid' : 'bad');
  return `<div class="fn-ai-bar"><span class="fn-ai-bar-l">${esc(label)}</span>
    <span class="fn-ai-bar-track"><span class="fn-ai-bar-fill fn-ai-${cls}" style="width:${v}%"></span></span>
    <span class="fn-ai-bar-v">${v}</span></div>`;
}
function fnRenderAiVerdictBlock(n) {
  const v = n && n.ai_verdict;
  // Нейро-вердикт публичный — виден всем под любой новостью.
  if (!v) return '';
  const meta = FN_AI_LABELS[v.verdict] || FN_AI_LABELS.review;
  const inj = v.injection ? `<div class="fn-ai-flag">⚠ Замечена попытка манипуляции текстом — оценка снижена.</div>` : '';
  // Юридический фильтр (законы РФ): блокировка или отметка на проверку.
  const lg = v.legal;
  const legalHtml = (lg && lg.flag) ? `<div class="fn-ai-flag fn-ai-legal${lg.blocked ? ' fn-ai-legal-block' : ''}">
      ${lg.blocked ? '⛔ ЗАБЛОКИРОВАНО: запрещённый по законам РФ контент' : '⚠ Автофильтр: возможный запрещённый контент — требуется проверка человеком'}${lg.cats && lg.cats.length ? ' · ' + esc(lg.cats.join(', ')) : ''}${lg.note ? `<div class="fn-ai-legal-note">${esc(lg.note)}</div>` : ''}
    </div>` : '';
  // Развёрнутый вердикт-«колонка»; если его нет (старые записи) — краткое резюме.
  const rulingTxt = (v.ruling || '').trim() || (v.reason || '').trim();
  const rulingHtml = rulingTxt ? `<div class="fn-verdict-body fn-ai-reason">${fnRenderBody(rulingTxt)}</div>` : '';
  // Сюжетные последствия — список в стиле выдач администрации.
  const effects = Array.isArray(v.effects) ? v.effects.filter(e => (e || '').trim()) : [];
  const effectsHtml = effects.length ? `<div class="fn-verdict-grants fn-ai-effects">
      <div class="fn-verdict-grants-hd">◈ Последствия в хронике</div>
      <ul class="fn-verdict-grant-list">${effects.map(e =>
        `<li class="fn-verdict-grant fn-ai-effect"><span class="fn-verdict-grant-ic" aria-hidden="true">↯</span><span class="fn-verdict-grant-t">${esc(e)}</span></li>`
      ).join('')}</ul></div>` : '';
  // Стафф может перенести нейро-вердикт в редактируемый вердикт администрации.
  const adopt = fnIsStaff() ? `<button type="button" class="btn btn-gh btn-xs fn-ai-adopt" onclick="fnAdoptAiVerdict('${esc(n.id)}')">✎ В вердикт администрации</button>` : '';
  return `<div class="fn-art-verdict fn-art-aiverdict fn-ai-${meta.cls}">
    <div class="fn-verdict-hd">
      <span class="fn-verdict-badge fn-ai-badge">🧠 Нейро-оценка хроники</span>
      <span class="fn-ai-tag fn-ai-${meta.cls}">${meta.ic} ${esc(meta.t)}</span>
    </div>
    <div class="fn-ai-bars">
      ${fnAiBar('Соответствие лору', v.lore)}
      ${fnAiBar('Связность с событиями', v.continuity)}
      ${fnAiBar('Актуальность', v.relevance)}
      ${v.feasibility != null ? fnAiBar('Соразмерность средств', v.feasibility) : ''}
    </div>
    ${legalHtml}
    ${inj}
    ${rulingHtml}
    ${effectsHtml}
    <div class="fn-ai-foot">Автоматическая оценка ИИ${v.model ? ' · ' + esc(String(v.model).split('/').pop().replace(':free','')) : ''} · носит рекомендательный характер ${adopt}</div>
  </div>`;
}
// Стафф: перенести нейро-вердикт (текст + последствия) в редактор вердикта
// администрации, где его можно отредактировать и утвердить официально.
function fnAdoptAiVerdict(id) {
  const n = FN.byId.get(id);
  const v = n && n.ai_verdict;
  if (!v) { toast('Нейро-вердикт не найден', 'err'); return; }
  const parts = [];
  if ((v.ruling || '').trim()) parts.push(v.ruling.trim());
  const effects = Array.isArray(v.effects) ? v.effects.filter(e => (e || '').trim()) : [];
  if (effects.length) parts.push('Последствия:\n' + effects.map(e => '• ' + e).join('\n'));
  const draft = parts.join('\n\n');
  fnCloseArticle();
  fnOpenComposer(id);
  // Дать композитору отрисоваться, затем подставить текст в поле вердикта.
  setTimeout(() => {
    const ta = document.getElementById('fn-c-verdict');
    if (ta) {
      if (ta.value.trim() && !confirm('В вердикте уже есть текст. Заменить его нейро-вердиктом?')) return;
      ta.value = draft;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      fnVerdictPreviewRefresh();
      ta.focus();
    }
  }, 300);
}
function fnVerdictPreviewHtml() {
  const text = (document.getElementById('fn-c-verdict')?.value || '').trim();
  const grants = fnGrantsCollect();
  if (!text && !grants.length) return '<div class="fn-verdict-empty">Пока пусто — напишите комментарий или выдайте награды через панель ниже.</div>';
  return fnRenderVerdictBlock({ staff_verdict: text, staff_grants: grants, verdict_by: (typeof getDisplayName === 'function' && getDisplayName()) || 'штаб', verdict_at: new Date().toISOString() });
}
function fnVerdictPreviewRefresh() {
  const pv = document.getElementById('fn-c-verdict-preview');
  if (pv && pv.style.display !== 'none') pv.innerHTML = fnVerdictPreviewHtml();
}
function fnToggleVerdictPreview() {
  const pv = document.getElementById('fn-c-verdict-preview');
  const btn = document.getElementById('fn-c-verdict-prev-btn');
  if (!pv) return;
  const show = pv.style.display === 'none';
  pv.style.display = show ? 'block' : 'none';
  if (show) pv.innerHTML = fnVerdictPreviewHtml();
  if (btn) { btn.classList.toggle('on', show); btn.textContent = show ? '🙈 Скрыть предпросмотр' : '👁 Предпросмотр'; }
}
async function fnAdminEmbedSync() {
  if (typeof adCanAccess !== 'function' || !adCanAccess()) return;
  const slot = document.getElementById('fn-c-admin-slot');
  if (!slot) return;
  let fid = null;
  const sel = document.getElementById('fn-c-author');
  const mode = sel?.value || '';
  if (mode.indexOf('fac:') === 0) fid = mode.slice(4);
  else if (mode === 'self') {
    const fac = await fnGetMyFaction();
    fid = fac?.faction_id || null;
  }
  const prevGrants = fnGrantsCollect();
  if (!fid) {
    AD.embed = { active: false, grants: prevGrants };
    slot.innerHTML = `<div class="fn-c-admin-empty">Панель управления доступна, когда автор — фракция игрока. Выберите фракцию из списка «Автор публикации».</div>`;
    fnVerdictPreviewRefresh();
    return;
  }
  AD.embed = { active: true, slotId: 'fn-c-admin-slot', grants: prevGrants, fid };
  AD.sel = fid;
  if (!AD.subtab) AD.subtab = 'treasury';
  slot.innerHTML = `<div class="sload" style="min-height:80px"><div class="pulse-loader"></div></div>`;
  try {
    if (!AD.byFid.size || !AD.byFid.has(fid)) {
      if (typeof adLoadCore === 'function') await adLoadCore();
      if (typeof adLoadDetails === 'function') await adLoadDetails();
      if (typeof adBuildIndex === 'function') adBuildIndex();
    }
    if (typeof adRenderSlot === 'function') adRenderSlot();
  } catch (e) {
    slot.innerHTML = `<div class="fn-c-admin-empty">Ошибка загрузки панели: ${esc(e.message || String(e))}</div>`;
  }
  fnVerdictPreviewRefresh();
}
function fnStaffVerdictFieldsHtml(eff, data) {
  if (!fnIsStaff()) return '';
  const src = eff || data || {};
  const verdict = src.staff_verdict || '';
  const grants = fnGrantsParse(src.staff_grants);
  const grantsJson = esc(JSON.stringify(grants));
  const adminPanel = (typeof adCanAccess === 'function' && adCanAccess())
    ? `<div class="fg fn-c-admin-fg">
        <label class="fl">🛠 Панель управления фракцией</label>
        <div class="fn-comp-note" style="margin:0 0 8px">Выдачи применяются сразу и автоматически оформятся в блоке вердикта.</div>
        <div id="fn-c-admin-slot" class="fn-c-admin-slot"></div>
      </div>` : '';
  return `<div class="fg fn-c-verdict-fg">
      <div class="fn-c-body-hd">
        <label class="fl">⚖ Вердикт администрации</label>
        <button type="button" class="btn btn-gh btn-xs" id="fn-c-verdict-prev-btn" onclick="fnToggleVerdictPreview()">👁 Предпросмотр</button>
      </div>
      <div class="fn-comp-note" style="margin:0 0 8px">Комментарий виден в статье под текстом новости. Модераторы и эдиторы могут пояснить решение; выдачи из панели ниже попадут в вердикт автоматически.</div>
      <textarea class="fi fn-c-verdict" id="fn-c-verdict" placeholder="Решение администрации, условия ивента, пояснения к выдаче…">${esc(verdict)}</textarea>
      <input type="hidden" id="fn-c-grants" value="${grantsJson}">
      <div id="fn-c-verdict-preview" class="fn-art-verdict fn-c-verdict-preview" style="display:none"></div>
    </div>${adminPanel}`;
}

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
  // noauto — автор отключил дефолтные варианты, оставив только свои.
  const opts = fnHasFx(news, 'noauto') ? [] : [
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
  // НПС/сводка (нет фракции-автора): дипломатии нет, но если автор задал свои
  // варианты ответа — показываем их как выбор читателя (ивент/квест).
  if (!n.faction_id || !n.owner_id) return fnNpcChoiceBlockHtml(n);
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
  if (!opts.length) return '';   // автор отключил авто-реакции и не задал своих — реагировать нечем
  // Подсвечиваем ровно одну выбранную опцию. Несколько опций могут иметь одинаковый stance
  // (авто-фраза и кастомная — обе approve), поэтому матчим по key, а не по stance.
  // После перезагрузки (в БД хранится только stance) — берём первую опцию этого тона.
  const selKey = st ? (st.optKey != null ? st.optKey : (opts.find(o => o.stance === st.stance) || {}).key) : null;
  const btns = opts.map(o => {
    const on = selKey != null && selKey === o.key;
    return `<button class="fn-react-opt fn-stance-${o.stance}${on ? ' on' : ''}"
      onclick="fnReact('${esc(n.id)}','${o.stance}','${esc(o.key)}')">
      <div class="fn-react-opt-inner">
        <span class="fn-react-ic">${FN_STANCE_ICON[o.stance]}</span>
        <span class="fn-react-txt">${esc(o.text)}</span>
      </div></button>`;
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
  if (!n.faction_id || !n.owner_id) return;   // НПС/сводка — дипломатии нет, состояние не грузим
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
async function fnReact(newsId, stance, optKey) {
  const n = FN.byId.get(newsId);
  const myFac = await fnGetMyFaction();
  if (!myFac || !myFac.faction_id) { toast('Нужна одобренная фракция', 'err'); return; }
  try {
    const res = await apiFetch('rpc/news_react', { method: 'POST', body: JSON.stringify({ p_news_id: newsId, p_stance: stance }) });
    const score = (typeof res === 'number') ? res : (Array.isArray(res) ? res[0] : (res && res.news_react));
    FN.reactState[newsId] = { stance, optKey: optKey != null ? optKey : null, score: (typeof score === 'number') ? score : 0 };
    const slot = document.getElementById('fn-react-slot');
    if (slot && n) slot.innerHTML = fnReactionBlockHtml(n, myFac);
    const lbl = fnRelLabel(FN.reactState[newsId].score);
    toast(`Позиция учтена · ${lbl.t}`, 'ok');
  } catch (e) { toast('Ошибка: ' + (e.message || e), 'err'); }
}

// ── НПС-новости: выбор ответа читателя (без дипломатии) ──────
// У НПС нет фракции-автора, поэтому балл отношений не меняется. Это просто
// интерактивный выбор (ивент/квест), сохраняется локально на устройстве.
function fnNpcCustomOptions(n) {
  let custom = [];
  try { custom = Array.isArray(n.reactions) ? n.reactions : JSON.parse(n.reactions || '[]'); } catch (e) {}
  return (custom || []).filter(c => c && c.text);
}
function fnNpcChoiceKey(id) { return 'fn_npc_choice_' + id + '_' + ((typeof user !== 'undefined' && user && user.id) || 'anon'); }
function fnNpcChoiceGet(id) { try { const v = localStorage.getItem(fnNpcChoiceKey(id)); return v == null ? null : (+v); } catch (e) { return null; } }
function fnNpcChoiceBlockHtml(n) {
  const opts = fnNpcCustomOptions(n);
  if (!opts.length) return '';                 // обычная сводка/слух без вариантов — ничего
  const chosen = fnNpcChoiceGet(n.id);
  const btns = opts.map((c, i) => {
    const stance = ['approve', 'neutral', 'disapprove'].includes(c.stance) ? c.stance : 'neutral';
    const on = chosen === i;
    return `<button class="fn-react-opt fn-stance-${stance}${on ? ' on' : ''}" onclick="fnNpcChoose('${esc(n.id)}',${i})">
      <div class="fn-react-opt-inner">
        <span class="fn-react-ic">${FN_STANCE_ICON[stance]}</span>
        <span class="fn-react-txt">${esc(c.text)}</span>
      </div></button>`;
  }).join('');
  return `<div class="fn-react fn-react-npc">
    <div class="fn-react-hd">ВАШ ОТВЕТ <span class="fn-react-sub">// ${chosen != null ? 'выбор сохранён' : 'выберите вариант'}</span></div>
    <div class="fn-react-opts">${btns}</div>
  </div>`;
}
function fnNpcChoose(id, i) {
  try { localStorage.setItem(fnNpcChoiceKey(id), String(i)); } catch (e) {}
  const n = FN.byId.get(id);
  const slot = document.getElementById('fn-react-slot');
  if (slot && n) slot.innerHTML = fnNpcChoiceBlockHtml(n);
  toast('Ваш выбор учтён', 'ok');
}

function fnOpenArticle(id) {
  const n = FN.byId.get(id);
  if (!n) { toast('Новость не найдена', 'err'); return; }
  FN._openId = id;
  // Цвет фракции игрока не используем (бывает кислотным); НПС/слухи/сводки — свой цвет.
  const accent = (n.owner_id && n.faction_id) ? 'var(--gd)' : (n.faction_color || 'var(--gd)');
  const modal = document.getElementById('fn-article') || (() => {
    const m = document.createElement('div'); m.id = 'fn-article'; m.className = 'fn-art-ov';
    m.onclick = e => { if (e.target === m) fnCloseArticle(); };
    document.body.appendChild(m); return m;
  })();
  const kind = fnKind(n);               // news | rumor | bulletin
  const coverHtml = n.image_url
    ? `<div class="fn-art-cov"><img src="${esc(n.image_url)}" alt="" loading="lazy"></div>` : '';
  // Флаг автора: герб фракции, либо герб/спец-эффект НПС.
  const artFlag = (FN.heralds && FN.heralds.get(n.faction_id)) || n.author_herald || '';
  const isFxHerald = typeof artFlag === 'string' && artFlag.indexOf('fx:') === 0;   // спец-символ, не картинка
  // События без обложки — на фон герб: картинка-флаг НПС, либо фракция по имени в заголовке.
  const evFac = (!n.owner_id && !n.image_url && !n.author_herald) ? fnEventFaction(n) : null;
  const bgImgUrl = (n.author_herald && !isFxHerald) ? n.author_herald : (evFac && evFac.herald_url) || '';
  const bgUrl = (!n.image_url) ? bgImgUrl : '';
  const bgFlag = bgUrl ? `<div class="fn-art-bgflag" style="background-image:url('${cssUrl(bgUrl)}')"></div>`
    : (isFxHerald && !n.image_url ? `<div class="fn-art-bgflag fn-art-bgrift" aria-hidden="true">◈</div>` : '');
  const barL = kind === 'bulletin' ? '◈ СВОДКА СЕКТОРА' : kind === 'rumor' ? '📡 ПЕРЕХВАЧЕННЫЙ СЛУХ' : 'Галактическая информсеть "Патриоты"';
  const barR = kind === 'bulletin' ? '◈◈' : kind === 'rumor' ? '◈◈' : '◈◈';
  const fxStr = n.fx || '';
  const glitch = fxStr.includes('glitch');
  const isBgCover = fxStr.includes('bg');
  modal.innerHTML = `<div class="fn-art${glitch ? ' fn-art-glitch' : ''}${isBgCover ? ' fn-art-bg-cover' : ''}" style="--fn-accent:${esc(accent)}">
    ${glitch ? '<span class="fn-glitch-bar fn-glitch-l" aria-hidden="true"></span><span class="fn-glitch-bar fn-glitch-r" aria-hidden="true"></span>' : ''}
    ${bgFlag}
    <div class="fn-art-bar">
      <span class="fn-art-bar-l">${barL}</span>
      <span class="fn-art-bar-r">${barR}</span>
    </div>
    <button class="fn-art-close" onclick="fnCloseArticle()">✕</button>
    ${coverHtml}
    <div class="fn-art-inner">
      <div class="fn-art-meta">
        <span class="fn-art-fac">${artFlag ? fnAuthorFlagHtml(artFlag, 'fn-art-flag') : '<span class="fn-dot"></span>'}${esc((n.faction_name || 'ФРАКЦИЯ').toUpperCase())}</span>
        <span class="fn-art-date">${esc(fnStardate(n.published_at || n.created_at))}</span>
      </div>
      <h1 class="fn-art-title">${esc(n.title || 'Без заголовка')}</h1>
      <div class="fn-art-body">${fnRenderBody(n.body)}</div>
      ${fnAchCardHtml(n)}
      ${fnRenderVerdictBlock(n)}
      ${fnRenderAiVerdictBlock(n)}
      <div id="fn-react-slot"></div>
    </div>
    <div class="fn-art-foot">
      <span>◈◈◈</span>
      ${fnIsStaff() ? `
        <button class="btn btn-gh btn-sm" id="fn-art-aibtn" style="margin-right: 15px; border-color: #8b7cf6; color: #8b7cf6;" onclick="fnRequestAiVerdict('${esc(n.id)}')">🧠 Нейро-оценка</button>
        <button class="btn btn-gh btn-sm" style="margin-right: 15px; border-color: var(--gd); color: var(--gd);" onclick="fnCloseArticle(); fnOpenComposer('${esc(n.id)}')">⚖ Редактировать вердикт</button>
        <button class="fn-art-del" title="Удалить новость (админ)" onclick="fnAdminDelete('${esc(n.id)}',event)">🗑 Удалить</button>
      ` : ''}
      <span class="fn-art-foot-id">◈◈◈</span>
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
  FN._openId = null;
  const m = document.getElementById('fn-article');
  if (m) { fnMusicStopAll(m); m.classList.remove('show'); }
  document.body.style.overflow = '';
}

// ── Личные сообщения фракции (private) ──────────────────────
// Админ может отправить новость «лично» одной фракции (флаг fx=private, status='private'):
// в общую ленту/на главную она не попадает (фильтр status=eq.approved), но видна в кабинете
// этой фракции (список «Новости фракции», грузится по faction_id без фильтра статуса)
// и один раз всплывает при входе владельца в кабинет. «Прочитано» храним локально.
function fnPrivSeenKey() { return 'fn_priv_seen_' + ((typeof user !== 'undefined' && user && user.id) || 'anon'); }
function fnPrivSeenGet() { try { return new Set(JSON.parse(localStorage.getItem(fnPrivSeenKey()) || '[]')); } catch (e) { return new Set(); } }
function fnPrivSeenAdd(id) {
  const s = fnPrivSeenGet(); s.add(id);
  // не даём списку разрастаться бесконечно — держим последние 200 id
  try { localStorage.setItem(fnPrivSeenKey(), JSON.stringify([...s].slice(-200))); } catch (e) {}
}
// Вызывается при входе в кабинет (economy.js → ecRenderDashboard). Показывает 1 ещё не
// виденное личное сообщение для фракции facId; остальные дождутся следующего входа.
async function fnCheckPrivatePopup(facId) {
  if (!facId || typeof user === 'undefined' || !user) return;
  let rows = [];
  try {
    rows = await dbGet('faction_news',
      `faction_id=eq.${encodeURIComponent(facId)}&status=eq.private&order=created_at.desc&limit=20`) || [];
  } catch (e) { return; }
  if (!rows.length) return;
  rows.forEach(r => FN.byId.set(r.id, r));   // чтобы fnOpenArticle нашёл запись
  const seen = fnPrivSeenGet();
  const next = rows.find(n => !seen.has(n.id));
  if (next) fnShowPrivatePopup(next);
}
function fnShowPrivatePopup(n) {
  fnPrivSeenAdd(n.id);   // «всплывает 1 раз» — помечаем сразу при показе
  const accent = n.faction_color || 'var(--gd)';
  const modal = document.getElementById('fn-priv-pop') || (() => {
    const m = document.createElement('div'); m.id = 'fn-priv-pop'; m.className = 'fn-priv-ov';
    m.onclick = e => { if (e.target === m) fnClosePrivatePopup(); };
    document.body.appendChild(m); return m;
  })();
  const cover = n.image_url ? `<div class="fn-priv-cov"><img src="${esc(n.image_url)}" alt="" loading="lazy"></div>` : '';
  modal.innerHTML = `<div class="fn-priv-box" style="--fn-accent:${esc(accent)}">
    <div class="fn-priv-bar"><span class="fn-priv-bar-l">📨 ВХОДЯЩАЯ ДЕПЕША · ШИФР «ЛИЧНО»</span><span class="fn-priv-bar-r">◈◈</span></div>
    <button class="fn-art-close" onclick="fnClosePrivatePopup()">✕</button>
    ${cover}
    <div class="fn-priv-inner">
      <div class="fn-priv-kicker">Только для государства «${esc((n.faction_name || '').toUpperCase())}»</div>
      <h2 class="fn-priv-title">${esc(n.title || 'Без заголовка')}</h2>
      <p class="fn-priv-excerpt">${esc(fnExcerpt(n))}</p>
      <div class="fn-priv-date">${esc(fnStardate(n.published_at || n.created_at))}</div>
    </div>
    <div class="fn-priv-ftr">
      <button class="btn btn-gh" onclick="fnClosePrivatePopup()">Позже</button>
      <button class="btn btn-gd" onclick="fnClosePrivatePopup(); fnOpenArticle('${esc(n.id)}')">📖 Читать</button>
    </div>
  </div>`;
  requestAnimationFrame(() => modal.classList.add('show'));
}
function fnClosePrivatePopup() { document.getElementById('fn-priv-pop')?.classList.remove('show'); }

// ── Кабинет: вкладка «Новости» ──────────────────────────────
async function fnRenderNewsTab(b) {
  b.innerHTML = `<div class="sload" style="min-height:60px"><div class="quote-loader">Загрузка...</div></div>`;
  const staff = fnIsStaff();
  const fac = await fnGetMyFaction();

  let html = '';

  // Секция админ-публикации (стафф): ивенты/квесты от лица НПС или любой фракции игрока.
  if (staff) {
    html += `<div class="fn-tab-sec">
      <div class="fn-tab-hd">
        <span>📡 Админ-публикация <span style="color:var(--t4);font-weight:400;font-size:12px">— от лица НПС или фракции игрока</span></span>
        <button class="btn btn-gd btn-sm" onclick="fnOpenComposer()">✚ Опубликовать ивент / квест</button>
      </div>
      <div class="fn-tab-note">Автор (НПС / своя / любая фракция) выбирается прямо в композиторе. Админская публикация выходит сразу, без модерации.</div>
    </div>`;
  }

  // Секция ОПОВЕЩЕНИЙ: всё, где упомянута фракция (пинги + системные сводки/хроники
  // + чужие новости по имени). Тело подгружается асинхронно (fnLoadMentions).
  if (fac && fac.faction_id) {
    html += `<div class="fn-tab-sec">
      <div class="fn-tab-hd"><span>🔔 Оповещения <span style="color:var(--t4);font-weight:400;font-size:12px">— упоминания вашей фракции</span></span></div>
      <div class="fn-notif-list" id="fn-notif-list"><div class="sload" style="min-height:50px"><div class="pulse-loader"></div></div></div>
    </div>`;
  }

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
      private:  ['🔒 ЛИЧНОЕ', 'var(--gd,#e8b04a)'],
    };
    const rows = mine.length ? mine.map(n => {
      const st = stMap[n.status] || ['—', 'var(--t3)'];
      // Опубликованную правит только админ; личное сообщение от админа получатель тоже не редактирует.
      const canEdit = n.status !== 'approved' && n.status !== 'private';
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
        <div class="fn-mod-meta">${esc(n.faction_name || '—')} · ${esc(fnDateLine(n))}</div>
        <div class="fn-mod-excerpt">${esc(fnExcerpt(n))}</div>
      </div>
      <div class="fn-mod-acts">
        <button class="btn btn-gh btn-sm" onclick="fnPreview('${esc(n.id)}')">Читать</button>
        <button class="btn btn-gh btn-sm" onclick="fnOpenComposer('${esc(n.id)}')">⚖ Вердикт</button>
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
  if (fac && fac.faction_id) fnLoadMentions();
}

// ── Лента «Оповещения»: всё, где упомянута фракция (RPC news_mentions) ──
async function fnLoadMentions() {
  const box = document.getElementById('fn-notif-list');
  if (!box) return;
  let rows = [];
  try {
    rows = await apiFetch('rpc/news_mentions', { method: 'POST', body: JSON.stringify({ p_limit: 40 }) }) || [];
  } catch (e) {
    box.innerHTML = `<div style="color:var(--t3);font-size:12px;padding:8px 0">Не удалось загрузить оповещения.</div>`;
    return;
  }
  if (!rows.length) {
    box.innerHTML = `<div style="color:var(--t3);font-size:12px;padding:8px 0">Пока тихо — вашу фракцию ещё нигде не упоминали.</div>`;
    return;
  }
  rows.forEach(n => FN.byId.set(n.id, n));   // чтобы fnOpenArticle нашёл запись
  const kindMeta = { news: ['📰', 'НОВОСТЬ'], bulletin: ['◈', 'СВОДКА'], rumor: ['📡', 'СЛУХ'] };
  // Одиночная строка-оповещение (используется и сама по себе, и внутри сводки).
  const rowHtml = (n) => {
    const k = fnKind(n);
    const [ic, lbl] = kindMeta[k] || kindMeta.news;
    const who = n.faction_name || (k === 'news' ? 'Фракция' : 'Сектор');
    return `<div class="fn-notif-row" data-fn-id="${esc(n.id)}" onclick="fnOpenArticle('${esc(n.id)}')">
      <span class="fn-notif-ic">${ic}</span>
      <div class="fn-notif-main">
        <div class="fn-notif-title">${esc(n.title || 'Без заголовка')}</div>
        <div class="fn-notif-meta"><span class="fn-notif-kind">${lbl}</span> · ${esc(who)} · ${esc(fnStardate(n.published_at || n.created_at))}</div>
      </div>
      <span class="fn-notif-arr">▸</span>
    </div>`;
  };
  // Сводная строка для пачки достижений, полученных разом, со списком внутри.
  const groupHtml = (grp) => {
    const who = grp[0].faction_name || 'Фракция';
    const cnt = grp.length;
    const word = fnPlural(cnt, 'достижение', 'достижения', 'достижений');
    // в подстроке — конкретная награда (из тела «…достижение «Имя»…») или заголовок
    const sub = grp.map(n => {
      const m = /достижени[ея]\s+«([^»]+)»/i.exec(n.body || '');
      const nm = m ? m[1] : (n.title || '');
      return `<div class="fn-notif-subrow" data-fn-id="${esc(n.id)}" onclick="event.stopPropagation();fnOpenArticle('${esc(n.id)}')">
        <span class="fn-notif-subic">🏆</span>
        <span class="fn-notif-subtitle">${esc(nm)}</span>
        <span class="fn-notif-arr">▸</span>
      </div>`;
    }).join('');
    return `<div class="fn-notif-group">
      <div class="fn-notif-row fn-notif-summary" onclick="fnToggleAchGroup(this)">
        <span class="fn-notif-ic">🏆</span>
        <div class="fn-notif-main">
          <div class="fn-notif-title">${esc(cnt + ' ' + word)}: ${esc(who)}</div>
          <div class="fn-notif-meta"><span class="fn-notif-kind">СВОДКА</span> · ${esc(who)} · ${esc(fnStardate(grp[0].published_at || grp[0].created_at))}</div>
        </div>
        <span class="fn-notif-arr fn-notif-chev">▾</span>
      </div>
      <div class="fn-notif-sub">${sub}</div>
    </div>`;
  };
  // Свернуть подряд идущие достижения одной фракции в одну сводку.
  const isAch = (n) => /^🏆\s*Достижение:/.test(n.title || '');
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (isAch(rows[i])) {
      const grp = [rows[i]];
      while (i + 1 < rows.length && isAch(rows[i + 1]) && rows[i + 1].faction_name === rows[i].faction_name) {
        grp.push(rows[++i]);
      }
      out.push(grp.length > 1 ? groupHtml(grp) : rowHtml(grp[0]));
    } else {
      out.push(rowHtml(rows[i]));
    }
  }
  box.innerHTML = out.join('');
}

// Развернуть/свернуть сводку достижений.
function fnToggleAchGroup(el) {
  const g = el.closest('.fn-notif-group');
  if (g) g.classList.toggle('open');
}

// Русское склонение по числу: 1 яблоко / 2 яблока / 5 яблок.
function fnPlural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
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
    m.onclick = e => { if (e.target === m) fnTryCloseComposer(); };
    // Автосохранение: любой ввод/выбор внутри композитора → отложенное сохранение черновика.
    m.addEventListener('input', fnDraftSaveSoon);
    m.addEventListener('input', fnPreviewSoon);
    m.addEventListener('input', fnVerdictPreviewRefresh);
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
      ${fnIsStaff() ? `<div class="fg">
        <label class="fl">📡 Автор публикации <span style="color:var(--t4);font-weight:400">— админ</span></label>
        <select class="fi" id="fn-c-author" onchange="fnAuthorModeChange()"><option value="">Загрузка фракций…</option></select>
        <div id="fn-c-npc-fields" style="display:none;flex-direction:column;gap:8px;margin-top:8px">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input class="fi" id="fn-c-npc-name" maxlength="80" placeholder="Имя автора (НПС / свободное)" style="flex:1;min-width:160px">
            <input class="fi" id="fn-c-npc-color" type="color" value="#3a7fbf" title="Цвет акцента" style="width:52px;padding:2px;flex:0 0 auto">
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <label class="fl" style="margin:0;white-space:nowrap">Куда:</label>
            <select class="fi" id="fn-c-npc-place" style="flex:0 1 auto;min-width:190px">
              <option value="sector">◈ Лента сектора (событие)</option>
              <option value="news">📰 Вестник новостей</option>
            </select>
            <span id="fn-c-npc-flag-prv" class="fn-c-npc-flag-prv"></span>
            <label class="btn btn-gh btn-xs" style="white-space:nowrap">🚩 Флаг НПС<input type="file" accept="image/*" style="display:none" onchange="fnNpcFlagUpload(this)"></label>
            <input type="hidden" id="fn-c-npc-herald" value="">
          </div>
        </div>
        <div class="fn-comp-note" style="margin:6px 0 0">Админская публикация выходит сразу, без модерации. «НПС» — свободный автор (событие/квест без фракции); у НПС-статьи показываются <b>только ваши варианты ответа</b> (если добавите их ниже). Фракция игрока — от её лица (с обычными реакциями).</div>
        <label class="fn-c-fx" style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="fn-c-glitch"${n && n.fx && n.fx.includes('glitch') ? ' checked' : ''}>
          <span>✨ Глитч-эффект по бокам статьи <span style="color:var(--t4)">— стильно, без вспышек/эпилепсии</span></span>
        </label>
        <label class="fn-c-fx" style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="fn-c-bg-cover"${n && n.fx && n.fx.includes('bg') ? ' checked' : ''}>
          <span>🖼 Картинка на весь фон <span style="color:var(--t4)">— обложка уйдет на задний план статьи</span></span>
        </label>
        <label class="fn-c-fx" style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="fn-c-private"${n && fnHasFx(n, 'private') ? ' checked' : ''}>
          <span>🔒 Личное сообщение фракции <span style="color:var(--t4)">— не в ленту/на главную; только в кабинет выбранной фракции (автор) + всплывёт у неё 1 раз</span></span>
        </label>
      </div>` : ''}
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
        <div class="fn-c-body-hd"><label class="fl">Текст новости *</label>
          <span style="display:flex;gap:6px">
            <button type="button" class="btn btn-gh btn-xs" onclick="fnOpenFacPicker()" title="Вставить упоминание страны — она получит оповещение">⬡ Вставить страну</button>
            <label class="btn btn-gh btn-xs fn-c-ins-btn">📷 Вставить фото<input type="file" accept="image/*" style="display:none" onchange="fnInsertImg(this)"></label>
          </span></div>
        <div class="md-toolbar fn-md-toolbar">
          <button type="button" class="mdt" title="Жирный" onclick="fnMd('**','**','текст')"><b>B</b></button>
          <button type="button" class="mdt" title="Курсив" onclick="fnMd('*','*','текст')"><i>I</i></button>
          <button type="button" class="mdt" title="Моноширинный" onclick="fnMd('\`','\`','код')">&lt;/&gt;</button>
          <button type="button" class="mdt" title="Заголовок" onclick="fnMd('## ','','Заголовок')">H2</button>
          <button type="button" class="mdt" title="Подзаголовок" onclick="fnMd('### ','','Заголовок')">H3</button>
          <button type="button" class="mdt" title="Цитата" onclick="fnMd('> ','','цитата')">❝</button>
          <button type="button" class="mdt" title="Список" onclick="fnMd('- ','','пункт')">≣</button>
          <span class="mdt-sep"></span>
          <button type="button" class="mdt" title="По левому краю" onclick="fnMd('[left]','[/left]','текст')">⇤</button>
          <button type="button" class="mdt" title="По центру" onclick="fnMd('[center]','[/center]','текст')">≡</button>
          <button type="button" class="mdt" title="По правому краю" onclick="fnMd('[right]','[/right]','текст')">⇥</button>
          <span class="mdt-sep"></span>
          <button type="button" class="mdt" title="Цвет: золото" onclick="fnMd('[c:gold]','[/c]','текст')" style="color:#e8b04a">A</button>
          <button type="button" class="mdt" title="Цвет: циан" onclick="fnMd('[c:cyan]','[/c]','текст')" style="color:#3ec0d0">A</button>
          <button type="button" class="mdt" title="Цвет: красный" onclick="fnMd('[c:red]','[/c]','текст')" style="color:#ff6b6b">A</button>
          <button type="button" class="mdt" title="Подсветка" onclick="fnMd('[bg:cyber]','[/bg]','текст')">▮</button>
          <span class="mdt-sep"></span>
          <button type="button" class="mdt" title="Картинка по ссылке" onclick="fnInsertImgUrl()">🖼</button>
          <button type="button" class="mdt" title="Музыка по ссылке — YouTube, SoundCloud или Яндекс Музыка" onclick="fnInsertMusicUrl()">🎵</button>
          <button type="button" class="mdt" title="Сворачиваемый блок (как глава)" onclick="fnMd('[spoiler:Глава]\\n','\\n[/spoiler]','скрытый текст')">▸</button>
          <button type="button" class="mdt" title="Спойлер под паролем" onclick="fnMd('[lock:пароль|Секрет]\\n','\\n[/lock]','секретный текст')">🔒</button>
          ${fnIsStaff() ? `<span class="mdt-sep"></span>
          <button type="button" class="mdt" title="Сканер" onclick="fnMd('[fx:scanner]','[/fx]','текст')">▤</button>
          <button type="button" class="mdt" title="Дрожь" onclick="fnMd('[fx:jitter]','[/fx]','текст')">≈</button>
          <button type="button" class="mdt mdt-schizo" title="Шизотекст: руны, при наведении высвечивается оригинал (только админ)" onclick="fnMd('[fx:schizo]','[/fx]','скрытый текст')">🜂</button>` : ''}
        </div>
        <textarea class="fi fn-c-body" id="fn-c-body" placeholder="Пишите свободно. Пустая строка = новый абзац. Выделите текст и нажмите кнопку форматирования.">${esc(eff?.body || '')}</textarea>
      </div>
      <div class="fg fn-c-prev-fg">
        <div class="fn-c-prev-bar">
          <button type="button" class="btn btn-gh btn-xs" id="fn-c-prev-btn" onclick="fnTogglePreview()">👁 Предпросмотр</button>
          <span class="fn-comp-note" style="margin:0">Разметка: **жирный** · *курсив* · ## Заголовок · &gt; цитата · [center]центр[/center] · [c:gold]цвет[/c]${fnIsStaff() ? ' · [fx:schizo]…[/fx]' : ''}</span>
        </div>
        <div id="fn-c-preview" class="fn-art-body fn-c-preview" style="display:none"></div>
      </div>
      <div class="fg">
        <div class="fn-c-body-hd"><label class="fl">Варианты реакций <span style="color:var(--t4);font-weight:400">— необязательно</span></label>
          <button type="button" class="btn btn-gh btn-xs" onclick="fnReactAddRow()">＋ Свой вариант</button></div>
        <div class="fn-comp-note" style="margin:0 0 6px">Читатели и так получат авто-реакции по своей идеологии. Здесь можно добавить свои ивентные фразы — каждая со своим тоном.</div>
        <div id="fn-c-reacts">${(() => { let cs = []; try { cs = Array.isArray(eff?.reactions) ? eff.reactions : JSON.parse(eff?.reactions || '[]'); } catch (e) {} return (cs || []).map(c => fnReactRowHtml(c.text, c.stance)).join(''); })()}</div>
        <label class="fn-c-fx" style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="fn-c-noauto"${n && fnHasFx(n, 'noauto') ? ' checked' : ''}>
          <span>🚫 Отключить авто-реакции <span style="color:var(--t4)">— оставить только свои варианты (выше)</span></span>
        </label>
      </div>
      ${fnStaffVerdictFieldsHtml(eff, data)}
      <div class="fn-comp-ftr">
        <button class="btn btn-gh" onclick="fnCloseComposer()">Отмена</button>
        <button class="btn btn-gd" onclick="fnSubmit()">${fnIsStaff() ? '📡 Опубликовать' : '📨 Отправить на проверку'}</button>
      </div>
      <div class="fn-comp-note fn-c-draft" id="fn-c-draft-st"></div>
      <div class="fn-comp-note">После отправки новость проверит администрация. Опубликованную правит только администрация. Черновик сохраняется автоматически на этом устройстве.</div>
    </div>`;
    modal.classList.add('show');
    FN.draftKey = key;
    fnDraftStatus(restored ? ('восстановлен черновик · ' + fnClock(draft.ts)) : '');
    if (fnIsStaff()) {
      fnPopulateAuthorSelect(n).then(() => fnAdminEmbedSync());   // автор + панель управления
    }
  };
  if (id && !n) {
    dbGet('faction_news', `id=eq.${encodeURIComponent(id)}&limit=1`).then(rows => { fill(rows && rows[0]); }).catch(() => fill(null));
  } else { fill(n); }
}
// Закрытие по клику вне окна — с подтверждением, если есть набранный текст
// (случайный клик по фону не должен «сворачивать» статью молча).
function fnTryCloseComposer() {
  const g = id => document.getElementById(id);
  const hasContent = (g('fn-c-title')?.value || '').trim()
    || (g('fn-c-body')?.value || '').trim()
    || (g('fn-c-img')?.value || '').trim();
  if (hasContent && !confirm('Закрыть редактор? Черновик сохранится, можно вернуться позже.')) return;
  fnCloseComposer();
}
function fnCloseComposer() {
  clearTimeout(FN.draftT);
  fnDraftSave();   // финальное сохранение — закрытие/обрыв не теряет последние буквы
  if (typeof AD !== 'undefined') AD.embed = null;
  const m = document.getElementById('fn-composer');
  if (m) { fnMusicStopAll(m); m.classList.remove('show'); }
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
    staff_verdict: g('fn-c-verdict')?.value || '',
    staff_grants: fnGrantsCollect(),
    ts: Date.now(),
  };
  // Пустой черновик не держим в хранилище.
  if (!payload.title && !payload.body && !payload.image_url && !payload.reactions.length
      && !payload.staff_verdict && !payload.staff_grants.length) {
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

// Вставка markdown/FX-разметки вокруг выделения в поле текста новости.
function fnMd(before, after, ph) {
  const ta = document.getElementById('fn-c-body');
  if (!ta) return;
  ta.focus();
  const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
  // execCommand сохраняет историю отмены (Ctrl+Z) в textarea
  if (document.execCommand) document.execCommand('insertText', false, before + (sel || ph) + after);
  else {
    const s = ta.selectionStart, e = ta.selectionEnd, ins = before + (sel || ph) + after;
    ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + ins.length;
  }
  fnDraftSaveSoon();
  fnPreviewSoon();
}

// ── Живой предпросмотр тела статьи в композиторе ─────────────
function fnTogglePreview() {
  const pv = document.getElementById('fn-c-preview');
  const btn = document.getElementById('fn-c-prev-btn');
  if (!pv) return;
  const show = pv.style.display === 'none';
  pv.style.display = show ? 'block' : 'none';
  document.querySelector('#fn-composer .fn-comp')?.classList.toggle('prev-on', show);
  if (btn) { btn.classList.toggle('on', show); btn.textContent = show ? '🙈 Скрыть предпросмотр' : '👁 Предпросмотр'; }
  if (show) fnUpdatePreview();
}
function fnUpdatePreview() {
  const pv = document.getElementById('fn-c-preview');
  if (!pv || pv.style.display === 'none') return;   // не считаем, пока скрыт
  const body = document.getElementById('fn-c-body')?.value || '';
  pv.innerHTML = body.trim()
    ? fnRenderBody(body)
    : '<span style="color:var(--t4)">— текст пуст: предпросмотр появится по мере набора —</span>';
}
function fnPreviewSoon() { clearTimeout(FN.prevT); FN.prevT = setTimeout(fnUpdatePreview, 250); }

// ── Вставка упоминания страны («пинг») ──────────────────────
// Открывает выбор фракции; вставляет тег [fac:FID]Имя[/fac] в текст.
// При публикации FID попадёт в mentions → страна получит оповещение.
async function fnOpenFacPicker() {
  let modal = document.getElementById('fn-fac-picker');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'fn-fac-picker'; modal.className = 'fn-fac-pick-ov';
    modal.onclick = e => { if (e.target === modal) fnCloseFacPicker(); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div class="fn-fac-pick">
    <div class="fn-fac-pick-hd"><span>⬡ Вставить страну</span><button type="button" class="gm-close" onclick="fnCloseFacPicker()">✕</button></div>
    <input class="fi fn-fac-pick-q" id="fn-fac-pick-q" placeholder="Поиск фракции…" oninput="fnFacPickFilter(this.value)" autocomplete="off">
    <div class="fn-fac-pick-list" id="fn-fac-pick-list"><div class="sload" style="min-height:60px"><div class="pulse-loader"></div></div></div>
    <div class="fn-comp-note" style="margin:8px 0 0">Упомянутая страна получит оповещение в своей ленте новостей.</div>
  </div>`;
  modal.classList.add('show');
  const facs = await fnLoadAuthorFacs();
  const list = document.getElementById('fn-fac-pick-list');
  if (!list) return;
  if (!facs.length) { list.innerHTML = `<div style="color:var(--t3);padding:10px">Нет одобренных фракций.</div>`; return; }
  list.innerHTML = facs.map(f => {
    const badge = f.herald_url
      ? `<img class="fn-fac-pick-flag" src="${esc(f.herald_url)}" alt="" onerror="this.outerHTML='<span class=\\'fn-fac-pick-dot\\' style=\\'background:${esc(f.color || 'var(--gd)')}\\'></span>'">`
      : `<span class="fn-fac-pick-dot" style="background:${esc(f.color || 'var(--gd)')}"></span>`;
    return `<button type="button" class="fn-fac-pick-row" data-name="${esc((f.name || '').toLowerCase())}" data-fid="${esc(f.faction_id)}" data-disp="${esc(f.name || '—')}" data-flag="${esc(f.herald_url || '')}" onclick="fnInsertFacEl(this)">
      ${badge}<span>${esc(f.name || '—')}</span></button>`;
  }).join('');
  const q = document.getElementById('fn-fac-pick-q'); if (q) setTimeout(() => q.focus(), 30);
}
function fnFacPickFilter(v) {
  const q = (v || '').toLowerCase().trim();
  document.querySelectorAll('#fn-fac-pick-list .fn-fac-pick-row').forEach(r => {
    r.style.display = (!q || (r.getAttribute('data-name') || '').includes(q)) ? '' : 'none';
  });
}
function fnCloseFacPicker() { document.getElementById('fn-fac-picker')?.classList.remove('show'); }
function fnInsertFacEl(el) { fnInsertFac(el.getAttribute('data-fid'), el.getAttribute('data-disp'), el.getAttribute('data-flag')); }
function fnInsertFac(fid, name, flag) {
  fnCloseFacPicker();
  const ta = document.getElementById('fn-c-body');
  if (!ta || !fid) return;
  ta.focus();
  // [fac:FID|FLAG_URL]Имя[/fac] — флаг подставляется в тег, чтобы чип показал картинку.
  const token = `[fac:${fid}${flag ? '|' + flag : ''}]${name || '—'}[/fac]`;
  const s = ta.selectionStart, e = ta.selectionEnd;
  if (document.execCommand) document.execCommand('insertText', false, token);
  else { ta.value = ta.value.slice(0, s) + token + ta.value.slice(e); ta.selectionStart = ta.selectionEnd = s + token.length; }
  fnDraftSaveSoon();
  fnPreviewSoon();
}

function fnInsertImgUrl() {
  const url = (prompt('Ссылка на картинку (https://…):', '') || '').trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) { toast('Нужна ссылка вида http(s)://…', 'err'); return; }
  fnMd('\n\n[img:' + url + ']\n\n', '', '');
}
function fnInsertMusicUrl() {
  const url = (prompt('Ссылка на трек — YouTube, SoundCloud или Яндекс Музыка:', '') || '').trim();
  if (!url) return;
  if (!fnMusicParse(url)) { toast('Не похоже на трек YouTube/SoundCloud/Яндекс Музыки. Пример: https://music.yandex.ru/album/123/track/456', 'err'); return; }
  fnMd('\n\n[music:' + url + ']\n\n', '', '');
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
    fnPreviewSoon();
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

// ── Админ-публикация: выбор автора (НПС / своя / любая фракция) ──
async function fnLoadAuthorFacs() {
  if (FN.authorFacs) return FN.authorFacs;
  try { FN.authorFacs = await dbGet('faction_applications', 'status=eq.approved&select=faction_id,name,color,herald_url,owner_id&order=name.asc') || []; }
  catch (e) { FN.authorFacs = []; }
  return FN.authorFacs;
}
// Наполнить <select id="fn-c-author"> вариантами; предвыбрать по редактируемой новости.
async function fnPopulateAuthorSelect(existing) {
  const sel = document.getElementById('fn-c-author'); if (!sel) return;
  const [facs, mine] = await Promise.all([fnLoadAuthorFacs(), fnGetMyFaction()]);
  let html = '';
  if (mine && mine.faction_id) html += `<option value="self">Моя фракция: ${esc(mine.name || '—')}</option>`;
  html += `<optgroup label="Фракции игроков">` + facs.map(f =>
    `<option value="fac:${esc(f.faction_id)}" data-name="${esc(f.name || '')}" data-color="${esc(f.color || '')}" data-owner="${esc(f.owner_id || '')}">${esc(f.name || '—')}</option>`
  ).join('') + `</optgroup>`;
  html += `<optgroup label="Особые НПС">` +
    Object.keys(FN_SPECIAL_NPC).map(k => `<option value="special:${k}">◈ ${esc(FN_SPECIAL_NPC[k].name)} — таинственный НПС</option>`).join('') +
    `</optgroup>`;
  html += `<option value="npc">НПС / свободный автор (событие, квест)</option>`;
  sel.innerHTML = html;
  // предвыбор для редактирования (НПС определяем по отсутствию фракции, не owner_id —
  // НПС-новость в «Вестнике» имеет owner_id админа, но faction_id всё равно пустой).
  if (existing && existing.id) {
    const sp = existing.author_herald && Object.keys(FN_SPECIAL_NPC).find(k => FN_SPECIAL_NPC[k].herald === existing.author_herald);
    if (sp) sel.value = 'special:' + sp;
    else if (!existing.faction_id) sel.value = 'npc';
    else if (mine && existing.faction_id === mine.faction_id) sel.value = 'self';
    else sel.value = 'fac:' + existing.faction_id;
  } else if (!(mine && mine.faction_id)) {
    sel.value = facs.length ? 'fac:' + facs[0].faction_id : 'npc';
  }
  fnAuthorModeChange();
  if (existing && existing.id && !existing.faction_id) {
    const nm = document.getElementById('fn-c-npc-name'); if (nm) nm.value = existing.faction_name || '';
    const cl = document.getElementById('fn-c-npc-color');
    if (cl && /^#[0-9a-f]{6}$/i.test(existing.faction_color || '')) cl.value = existing.faction_color;
    const pl = document.getElementById('fn-c-npc-place'); if (pl) pl.value = existing.owner_id ? 'news' : 'sector';
    if (existing.author_herald) { const h = document.getElementById('fn-c-npc-herald'); if (h) h.value = existing.author_herald; fnNpcFlagPreview(existing.author_herald); }
  }
}
// Загрузка/удаление флага НПС (герб автора для карточки/статьи).
function fnNpcFlagPreview(url) {
  const prv = document.getElementById('fn-c-npc-flag-prv');
  if (!prv) return;
  prv.innerHTML = url ? `<img src="${esc(url)}" alt="" class="fn-c-npc-flag-img"><button type="button" class="fn-c-cov-rm" onclick="fnNpcFlagRemove()">✕</button>` : '';
}
function fnNpcFlagUpload(input) {
  const file = input?.files?.[0]; if (!file) return;
  handleImgUpload(file, url => {
    const h = document.getElementById('fn-c-npc-herald'); if (h) h.value = url;
    fnNpcFlagPreview(url);
    fnDraftSaveSoon();
  });
  input.value = '';
}
function fnNpcFlagRemove() {
  const h = document.getElementById('fn-c-npc-herald'); if (h) h.value = '';
  fnNpcFlagPreview('');
  fnDraftSaveSoon();
}
function fnAuthorModeChange() {
  const sel = document.getElementById('fn-c-author');
  const npc = document.getElementById('fn-c-npc-fields');
  if (sel && npc) npc.style.display = sel.value === 'npc' ? 'flex' : 'none';
  fnAdminEmbedSync();
}
// Разобрать выбранного автора → поля строки faction_news. Возвращает null при ошибке (с тостом).
async function fnResolveAuthor() {
  const sel = document.getElementById('fn-c-author');
  const mode = sel ? sel.value : '';
  if (mode && mode.indexOf('special:') === 0) {
    const sp = FN_SPECIAL_NPC[mode.slice(8)];
    if (!sp) { toast('Неизвестный НПС', 'err'); return null; }
    // особый НПС публикуется в основную ленту с фиксированным крутым флагом-символом
    return { faction_id: null, faction_name: sp.name, faction_color: sp.color, author_herald: sp.herald,
      owner_id: user.id, kind: 'news' };
  }
  if (mode === 'npc') {
    const name = (document.getElementById('fn-c-npc-name')?.value || '').trim();
    if (!name) { toast('Укажите имя НПС-автора', 'err'); return null; }
    const color = document.getElementById('fn-c-npc-color')?.value || null;
    const herald = document.getElementById('fn-c-npc-herald')?.value || null;
    // Куда: «Вестник» (owner_id = админ → попадает в основную ленту) или «Лента сектора» (owner_id null).
    const toNews = (document.getElementById('fn-c-npc-place')?.value || 'sector') === 'news';
    return { faction_id: null, faction_name: name, faction_color: color, author_herald: herald,
      owner_id: toNews ? user.id : null, kind: toNews ? 'news' : 'bulletin' };
  }
  if (mode === 'self') {
    const fac = await fnGetMyFaction();
    if (!fac || !fac.faction_id) { toast('У вас нет одобренной фракции', 'err'); return null; }
    return { faction_id: fac.faction_id, faction_name: fac.name || null, faction_color: fac.color || null, author_herald: null, owner_id: user.id, kind: 'news' };
  }
  if (mode && mode.indexOf('fac:') === 0) {
    const opt = sel.options[sel.selectedIndex];
    const fid = mode.slice(4);
    if (!fid) { toast('Выберите фракцию', 'err'); return null; }
    return { faction_id: fid, faction_name: opt?.dataset.name || null, faction_color: opt?.dataset.color || null, author_herald: null, owner_id: opt?.dataset.owner || null, kind: 'news' };
  }
  toast('Выберите автора публикации', 'err'); return null;
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
  const staff = fnIsStaff();
  // Стафф публикует от лица НПС/любой фракции сразу (без модерации);
  // игрок — только от своей одобренной фракции, через очередь модерации.
  let author;
  if (staff) {
    author = await fnResolveAuthor();
    if (!author) return;   // тост уже показан
  } else {
    const fac = await fnGetMyFaction();
    if (!fac || !fac.faction_id) { toast('Новости пишут только владельцы одобренной фракции', 'err'); return; }
    author = { faction_id: fac.faction_id, faction_name: fac.name || null, faction_color: fac.color || null, owner_id: user.id, kind: 'news' };
  }
  const now = new Date().toISOString();
let fxArr = [];
  if (staff && document.getElementById('fn-c-glitch')?.checked) fxArr.push('glitch');
  if (staff && document.getElementById('fn-c-bg-cover')?.checked) fxArr.push('bg');
  // noauto — отключить дефолтные реакции (доступно всем); private — личное сообщение фракции (только стафф).
  if (document.getElementById('fn-c-noauto')?.checked) fxArr.push('noauto');
  const isPrivate = staff && !!document.getElementById('fn-c-private')?.checked;
  if (isPrivate) {
    if (!author.faction_id) { toast('Личное сообщение можно отправить только фракции игрока — выберите её в «Авторе публикации»', 'err'); return; }
    if (!author.owner_id)   { toast('У выбранной фракции нет владельца-получателя', 'err'); return; }
    fxArr.push('private');
  }
  const fx = fxArr.length ? fxArr.join(',') : null;
  const staff_verdict = staff ? ((document.getElementById('fn-c-verdict')?.value || '').trim() || null) : undefined;
  const staff_grants = staff ? fnGrantsCollect() : undefined;
  const hasVerdict = staff && (staff_verdict || (staff_grants && staff_grants.length));
  FN.busy = true;
  try {
    if (id) {
      const patch = { title, excerpt: null, body, image_url, reactions, mentions: fnParseMentions(), reject_reason: null, fx, updated_at: now };
      if (staff) {
        const prev = FN.byId.get(id);
        Object.assign(patch, {
          faction_id: author.faction_id, faction_name: author.faction_name, faction_color: author.faction_color,
          author_herald: author.author_herald || null,
          owner_id: author.owner_id, kind: author.kind,
          status: isPrivate ? 'private' : 'approved', published_at: (prev && prev.published_at) || now, reviewed_by: getDisplayName() || 'штаб',
          staff_verdict, staff_grants: staff_grants?.length ? staff_grants : null,
          verdict_by: hasVerdict ? (getDisplayName() || 'штаб') : (prev && prev.verdict_by) || null,
          verdict_at: hasVerdict ? now : (prev && prev.verdict_at) || null,
        });
      } else {
        patch.status = 'pending';   // правка игрока снова уходит на проверку
      }
      await dbPatch('faction_news', `id=eq.${encodeURIComponent(id)}`, patch);
      // Переоценка нейросетью при правке игроком (текст изменился).
      if (!isPrivate) fnTriggerAiVerdict(id);
      toast(isPrivate ? 'Личное сообщение обновлено и доставлено фракции' : (staff ? 'Новость обновлена и опубликована' : 'Изменения отправлены на проверку'), 'ok');
    } else {
      const _ins = await dbPost('faction_news', {
        faction_id: author.faction_id,
        faction_name: author.faction_name,
        faction_color: author.faction_color,
        author_herald: author.author_herald || null,
        owner_id: author.owner_id,
        kind: author.kind, fx,
        title, excerpt: null, body, image_url, reactions, mentions: fnParseMentions(),
        status: isPrivate ? 'private' : (staff ? 'approved' : 'pending'),
        published_at: (staff || isPrivate) ? now : null,
        reviewed_by: staff ? (getDisplayName() || 'штаб') : null,
        staff_verdict: staff ? staff_verdict : null,
        staff_grants: staff && staff_grants?.length ? staff_grants : null,
        verdict_by: hasVerdict ? (getDisplayName() || 'штаб') : null,
        verdict_at: hasVerdict ? now : null,
      });
      // Нейро-оценка свежей новости игрока (id из representation-ответа).
      const _newId = Array.isArray(_ins) ? _ins[0]?.id : _ins?.id;
      if (!isPrivate && _newId) fnTriggerAiVerdict(_newId);
      toast(isPrivate ? 'Личное сообщение доставлено фракции' : (staff ? 'Опубликовано на главной' : 'Новость отправлена на проверку'), 'ok');
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
      { status: 'approved', published_at: new Date().toISOString(), reviewed_by: getDisplayName() || 'штаб', reject_reason: null, updated_at: new Date().toISOString() });
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
      { status: 'rejected', reject_reason: reason, reviewed_by: getDisplayName() || 'штаб', updated_at: new Date().toISOString() });
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

// Удаление прямо из лент/статьи (стафф). Гасим всплытие, чтобы не открыть статью.
async function fnAdminDelete(id, ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  if (!fnIsStaff()) { toast('Только для администрации', 'err'); return; }
  if (FN.busy) return;
  if (!confirm('Удалить новость безвозвратно?')) return;
  FN.busy = true;
  try {
    await dbDel('faction_news', `id=eq.${encodeURIComponent(id)}`);
    // вычистить из кэшей и DOM (карточка «Вестника», строка «Ленты сектора»)
    FN.approved = (FN.approved || []).filter(n => n.id !== id);
    FN.events   = (FN.events || []).filter(n => n.id !== id);
    if (FN.byId) FN.byId.delete(id);
    document.querySelectorAll(`[data-fn-id="${id}"]`).forEach(el => el.remove());
    if (FN._openId === id) fnCloseArticle();
    fnRefresh();   // обновит кабинет/профиль, если открыты
    toast('Удалено', 'ok');
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { FN.busy = false; }
}
