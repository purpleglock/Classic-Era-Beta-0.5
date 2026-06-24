// ================================================================
// ADMIN.JS — консоль управления фракциями (суперадмины + эдиторы)
// Все действия идут напрямую через dbGet/dbPost/dbPatch/dbDel;
// SQL не нужен — RLS уже разрешает стаффу писать в любую строку.
// ================================================================

// Экранирование строки для onclick="fn('значение')" — обёртка в одинарные кавычки
const adArg = s => "'" + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

// Полный каталог ресурсов (источник — galaxy_gen.js). Используется как фолбэк
// когда AD.resInfo ещё не заполнен из планет и как база выпадающего списка.
const AD_RES_CATALOG = [
  { name: 'Железо',                  icon: '⚙️',  r: 'common' },
  { name: 'Силикаты',                icon: '🪨',  r: 'common' },
  { name: 'Лёд',                     icon: '🧊',  r: 'common' },
  { name: 'Углерод',                 icon: '⬛',  r: 'common' },
  { name: 'Метан',                   icon: '💚',  r: 'common' },
  { name: 'Сера',                    icon: '🌑',  r: 'common' },
  { name: 'Медь',                    icon: '🟤',  r: 'uncommon' },
  { name: 'Титан',                   icon: '🔘',  r: 'uncommon' },
  { name: 'Ионит',                   icon: '🟡',  r: 'uncommon' },
  { name: 'Аммиачный лёд',           icon: '🟣',  r: 'uncommon' },
  { name: 'Редкоземельные руды',      icon: '💡',  r: 'rare' },
  { name: 'Платина',                 icon: '⬜',  r: 'rare' },
  { name: 'Изотопы',                 icon: '☢️',  r: 'rare' },
  { name: 'Жидкая вода',             icon: '🌊',  r: 'rare' },
  { name: 'Реликтовое дерево',       icon: '🧬',  r: 'rare' },
  { name: 'Дейтерий',                icon: '⚛️',  r: 'rare' },
  { name: 'Гелий-3',                 icon: '🫧',  r: 'rare' },
  { name: 'Старвис',                 icon: '🔥',  r: 'epic' },
  { name: 'Хтонит',                  icon: '💎',  r: 'epic' },
  { name: 'Стелларит',               icon: '🔷',  r: 'epic' },
  { name: 'Гравиядро',               icon: '🔮',  r: 'legendary' },
  { name: 'Рагенод',                 icon: '💀',  r: 'legendary' },
  { name: 'Программируемая материя', icon: '🟢',  r: 'legendary' },
];

const AD = {
  apps:      [],        // faction_applications (approved)
  ecos:      [],        // faction_economy (all)
  colonies:  [],        // colonies (all)
  buildings: [],        // colony_buildings (all)
  prod:      [],        // unit_production (all)
  systems:   [],        // map_systems (all)
  designs:   [],        // faction_units (all)
  routes:    [],        // trade_routes (all)
  portraits: [],        // spy_portraits (общий пул портретов оперативников)
  unions:    [],        // diplo_unions (все союзы — реестр для удаления)
  byFid:     new Map(), // fid → { app, eco, colonies[], buildings[], roster[], queue[], designs[], systems[] }
  resInfo:   {},        // resName → { r, icon }
  sel:       null,      // selected faction_id
  tab:       'factions',// верхняя вкладка консоли: factions | unions | portraits
  subtab:    'treasury',
  sysSearch: '',
  audit:     {},        // fid → { rows[], loading, err } (журнал действий, лениво)
  auditCat:  'all',     // активный фильтр категории в журнале
  busy:      false,
  embed:     null,     // встраивание панели в композитор новостей (faction_news.js)
};

// ── Доступ ──────────────────────────────────────────────────────
function adCanAccess() { return !!(user && ['superadmin', 'editor'].includes(user.role)); }
function adEntry(fid)  { return AD.byFid.get(fid); }
function adNum(n)      { return Number(n || 0).toLocaleString('ru-RU'); }

// Журнал выдач для блока «вердикт» в композиторе новостей.
function adLogGrant(entry) {
  if (!AD.embed || !AD.embed.active) return;
  const grants = (typeof fnGrantsCollect === 'function') ? fnGrantsCollect() : (AD.embed.grants || []);
  grants.push(Object.assign({ ts: Date.now() }, entry));
  if (typeof fnGrantsSet === 'function') fnGrantsSet(grants);
  else AD.embed.grants = grants;
  if (typeof fnVerdictPreviewRefresh === 'function') fnVerdictPreviewRefresh();
}
function adTreasuryLabel(field) { return field === 'science' ? 'ОН' : 'ГС'; }

// ── Загрузка данных (прогрессивно: сначала лёгкое ядро, потом детали) ──
function adBuildIndex() {
  AD.byFid = new Map();
  (AD.apps || []).forEach(app => {
    AD.byFid.set(app.faction_id, {
      app,
      eco:      (AD.ecos || []).find(e => e.faction_id === app.faction_id) || null,
      colonies: (AD.colonies || []).filter(c => c.faction_id === app.faction_id),
      buildings:(AD.buildings || []).filter(b => b.faction_id === app.faction_id),
      roster:   (AD.prod || []).filter(p => p.faction_id === app.faction_id && p.status === 'done'),
      queue:    (AD.prod || []).filter(p => p.faction_id === app.faction_id && p.status === 'queued'),
      designs:  (AD.designs || []).filter(d => d.faction_id === app.faction_id),
      systems:  (AD.systems || []).filter(s => s.faction === app.faction_id),
      routes:   (AD.routes || []).filter(r => r.a_fid === app.faction_id || r.b_fid === app.faction_id),
    });
  });
  // Карта редкости ресурсов: сначала каталог, потом данные с планет (перезаписывают если есть)
  AD.resInfo = {};
  AD_RES_CATALOG.forEach(rc => { AD.resInfo[rc.name] = { r: rc.r, icon: rc.icon }; });
  (AD.systems || []).forEach(s => (s.planets || []).forEach(p => (p.resources || []).forEach(r => {
    if (r && r.name) AD.resInfo[r.name] = { r: r.r || AD.resInfo[r.name]?.r || 'common', icon: r.icon || AD.resInfo[r.name]?.icon || '◈' };
  })));
}

// Ядро — лёгкие запросы, нужные для таблицы фракций (грузится за ~1 c)
async function adLoadCore() {
  const [apps, ecos] = await Promise.all([
    dbGet('faction_applications', 'status=eq.approved&select=faction_id,name,owner_id,owner_email,race,civ_type,gov,regime,ideology,capital_env,system_id,system_name&order=name.asc').catch(() => []),
    dbGet('faction_economy',  'select=*').catch(() => []),
  ]);
  AD.apps = apps || [];
  AD.ecos = ecos || [];
}

// Детали — счётчики и содержимое вкладок (без тяжёлого planets jsonb)
async function adLoadDetails() {
  const [cols, blds, prod, systems, designs, routes, faiths, portraits] = await Promise.all([
    dbGet('colonies',         'select=*').catch(() => []),
    dbGet('colony_buildings', 'select=*').catch(() => []),
    dbGet('unit_production',  'select=*').catch(() => []),
    dbGet('map_systems',      'select=id,name,faction').catch(() => []),               // без planets/x,y — экономим ~25 КБ
    dbGet('faction_units',    'select=id,category,name,faction_id&order=name.asc').catch(() => []), // без тяжёлых data/summary
    dbGet('trade_routes',     'select=id,a_fid,a_name,b_fid,b_name,volume,price,resource,cargo,ships,convoy,threats,origin_sys,dest_sys,transit_until,status,created_at&order=created_at.desc').catch(() => []), // торговые пути (разбор дохода + детальная вкладка караванов)
    dbGet('faith_membership', 'select=faction_id').catch(() => []),                    // кто исповедует веру (доход храмов считается только тогда)
    dbGet('spy_portraits',    'select=id,race,gender,url,label&order=created_at.desc').catch(() => []),  // общий пул портретов оперативников
  ]);
  AD.colonies  = cols    || [];
  AD.buildings = blds    || [];
  AD.prod      = prod    || [];
  AD.systems   = systems || [];
  AD.designs   = designs || [];
  AD.routes    = routes  || [];
  AD.faithFids = new Set((faiths || []).map(f => f.faction_id));
  AD.portraits = portraits || [];
  try { AD.unions = await adRpc('union_admin_list') || []; } catch (e) { AD.unions = []; }
}

// Лёгкий вызов SECURITY DEFINER RPC из админ-панели (свежий токен + JSON).
async function adRpc(fn, body) {
  const token = await getTokenFresh();
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(t || ('HTTP ' + r.status)); }
  if (r.status === 204) return null;
  return r.json();
}

async function adLoad() { await adLoadCore(); await adLoadDetails(); adBuildIndex(); }

// ── Рендер ──────────────────────────────────────────────────────
let _adRenderTok = 0;
async function adRenderConsole() {
  if (!adCanAccess()) { setPg('<div class="sempty">Нет доступа</div>'); return; }
  const tok = ++_adRenderTok;
  // Анти-спам: если данные уже загружены недавно (init дёргает рендер
  // несколько раз) — просто перерисовать, без сети и без мигания каркасом.
  // Иначе постоянная замена DOM не даёт кликать.
  if (AD.byFid.size && AD._loadedAt && (Date.now() - AD._loadedAt < 8000)) { adPaint(); return; }
  // ГАРАНТИРОВАННЫЙ первый кадр (без adPaint) — экран не может остаться пустым.
  setPg(`<div class="fm-console"><div class="fm-header"><div>
      <div class="fm-title">🛠 Консоль управления</div>
      <div class="fm-summary"><span>Загрузка данных…</span></div></div>
      <button class="btn btn-gh btn-sm" onclick="go('admin',false)">↻ Обновить</button></div>
    <div class="sload" style="min-height:140px"><div class="pulse-loader"></div></div></div>`);
  AD.loading = true; AD.loadError = null;
  try { adBuildIndex(); adPaint(); } catch (e) { console.error('[admin] paint shell', e); }
  // 1) Ядро — фракции + казна
  try {
    await adLoadCore();
    if (tok !== _adRenderTok) return;   // более новый рендер уже идёт — не спамим
    adBuildIndex();
    AD.loading = false;
    adPaint();
  } catch (e) {
    console.error('[admin] core load', e);
    AD.loading = false; AD.loadError = e.message || String(e);
    try { adPaint(); } catch(_) {}
    return;
  }
  // 2) Детали — в фоне; таблица фракций уже на экране, счётчики дозаполнятся
  try {
    await adLoadDetails();
    if (tok !== _adRenderTok) return;
    AD._loadedAt = Date.now();
    adBuildIndex();
    adPaint();
  } catch (e) { console.error('[admin] details load', e); }
}

function adPaint() {
  // Встроенная панель в композиторе новостей — обновляем только слот, не всю страницу.
  if (AD.embed && AD.embed.active) {
    adRenderSlot();
    return;
  }
  // Собираем тело в try/catch: если adStatsTable/adFacPanel упадёт, раньше
  // падал ВЕСЬ template setPg(...) ДО вставки -> пустой .fm-console. Теперь
  // ошибка попадает в видимый блок, а не превращается в пустоту.
  let header = '', body = '';
  try {
    const totalCols  = AD.colonies.length;
    const totalSys   = (AD.systems || []).filter(s => s.faction).length;
    const totalUnits = (AD.prod || []).filter(p => p.status === 'done').reduce((a, p) => a + (p.qty || 0), 0);
    const fCount     = AD.byFid.size;
    header = `<div class="fm-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div>
        <div class="fm-title" style="font-family:var(--font-display,sans-serif);font-size:22px;font-weight:700;color:var(--gdl,#5fb0e6);letter-spacing:1px">🛠 Консоль управления</div>
        <div class="fm-summary" style="display:flex;flex-wrap:wrap;gap:4px 18px;font-size:12px;color:var(--t3,#8aa0b0);margin-top:6px">
          <span>Фракций: <b style="color:var(--t1,#e8edf2)">${fCount}</b></span>
          <span>Колоний: <b style="color:var(--t1,#e8edf2)">${totalCols}</b></span>
          <span>Систем занято: <b style="color:var(--t1,#e8edf2)">${totalSys}</b></span>
          <span>Юнитов: <b style="color:var(--t1,#e8edf2)">${totalUnits}</b></span>
        </div>
      </div>
      <button class="btn btn-gh btn-sm" onclick="adReloadPaint()">↻ Обновить</button>
    </div>`;
    // ── Выпадающий выбор фракции (надёжно, без кликов по строкам) ──
    const opts = [...AD.byFid.entries()].map(([fid, e]) =>
      `<option value="${esc(fid)}"${AD.sel === fid ? ' selected' : ''}>${esc(e.app.name)}${e.eco ? '' : ' (нет экономики)'}</option>`
    ).join('');
    const selector = `<div style="margin:18px 0;display:flex;flex-wrap:wrap;align-items:center;gap:10px">
      <label style="font-family:var(--font-display,sans-serif);font-size:13px;font-weight:600;color:var(--t2,#c0ccd6)">Фракция:</label>
      <select id="fm-fac-select" onchange="adSelectFaction(this.value)" style="flex:1;min-width:220px;max-width:420px;padding:10px 12px;font-size:14px;background:var(--b2,#141a22);color:var(--t1,#e8edf2);border:1px solid var(--gd,#3a7fbf);border-radius:8px;cursor:pointer">
        <option value="">— выберите фракцию для управления —</option>
        ${opts}
      </select>
    </div>`;
    // Панель кладём в ВЫДЕЛЕННЫЙ слот. При выборе фракции меняем ТОЛЬКО его
    // содержимое (adSelectFaction), без перерисовки всей страницы — это
    // надёжнее (полный re-render #pg на Vercel почему-то не показывал панель).
    const stats = `<div style="margin-top:24px"><div style="font-family:var(--font-display,sans-serif);font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--t3,#8aa0b0);margin-bottom:8px">Сводка по всем фракциям</div>${adStatsTable()}</div>`;
    // ── Верхние вкладки консоли ────────────────────────────────────
    const TABS = [['factions', '🛠 Фракции'], ['unions', '🤝 Союзы', (AD.unions || []).length], ['portraits', '🎭 Арты', (AD.portraits || []).length]];
    const tabBar = `<div class="fm-ctabs" style="display:flex;flex-wrap:wrap;gap:6px;margin:18px 0 4px;border-bottom:1px solid var(--w2,#2a3340);padding-bottom:2px">
      ${TABS.map(([id, lbl, n]) => `<button class="btn ${AD.tab === id ? 'btn-gd' : 'btn-gh'} btn-sm" onclick="adSetTab('${id}')" style="border-bottom-left-radius:0;border-bottom-right-radius:0">${lbl}${n != null ? ` <span style="opacity:.65;font-size:11px">${n}</span>` : ''}</button>`).join('')}
    </div>`;
    let tabContent;
    if (AD.tab === 'unions')        tabContent = adUnionsPanel();
    else if (AD.tab === 'portraits') tabContent = adPortraitsPanel();
    else tabContent = selector + `<div id="fm-panel-slot">${adPanelSlotHtml()}</div>` + stats;
    body = tabBar + `<div style="margin-top:14px">${tabContent}</div>`;
  } catch (e) {
    console.error('[ADMIN] adPaint build error', e);
    body = `<div style="color:#ff7a7a;padding:16px;border:1px solid #ff7a7a;border-radius:8px;margin-top:12px">Ошибка отрисовки: ${esc(e.message || String(e))}<br><button class="btn btn-gh btn-sm" onclick="go('admin',false)" style="margin-top:8px">↺ Повторить</button></div>`;
  }
  // ВАЖНО: display:block, НЕ flex. Раньше .fm-console был flex-column, и внутри
  // .fm-table-wrap (overflow-x:auto) схлопывался в 0 высоты в Chromium/Yandex
  // (flex min-height:0 + overflow) -> таблица была в DOM, но не видна (consoleH=86).
  // Блочный поток всегда отдаёт таблице её высоту.
  setPg(`<div class="fm-console" style="max-width:1200px;margin:0 auto;padding:24px 16px 60px;color:var(--t1,#e8edf2);display:block">${header}<div style="margin-top:18px">${body}</div></div>`);
  // ФОРС видимости #pg: многократные перерисовки могли оставить анимацию .pgi
  // на opacity:0. Гасим анимацию и форсим видимость.
  var _pg = document.getElementById('pg');
  if (_pg) { _pg.style.animation = 'none'; _pg.style.opacity = '1'; _pg.style.transform = 'none'; }
}

function adStatsTable() {
  if (!AD.byFid.size) {
    if (AD.loading) return `<div class="sload" style="min-height:120px"><div class="pulse-loader"></div></div>`;
    if (AD.loadError) return `<div class="fm-empty" style="display:flex;flex-direction:column;gap:10px;align-items:center;padding:24px">
      <span>Не удалось загрузить: ${esc(AD.loadError)}</span>
      <button class="btn btn-gh btn-sm" onclick="go('admin',false)">↺ Повторить</button></div>`;
    return `<div class="fm-empty">Нет одобренных фракций</div>`;
  }
  // БЕЗ <table>: только div'ы с инлайн-стилями. Раньше <table> в этом
  // окружении схлопывался в 0 высоты на Vercel/Yandex (localhost — нет).
  // div-строки с контентом не могут схлопнуться ни в одном браузере.
  const numCols = ['ГС', 'ОН', 'Агенты', 'Колонии', 'Постройки', 'Системы', 'Юниты', 'Технол.'];
  const cellBase = 'flex:1 1 56px;min-width:46px;text-align:right;font-family:monospace;font-size:12px;color:var(--t2,#c0ccd6)';
  const head = `<div style="display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--w2,#2a3340);background:var(--b3,#0f141b);font-family:monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--t3,#8aa0b0)">
    <div style="flex:2 1 170px;min-width:140px">Фракция / Раса / Владелец</div>
    ${numCols.map(c => `<div style="flex:1 1 56px;min-width:46px;text-align:right">${c}</div>`).join('')}
  </div>`;
  const rows = [...AD.byFid.entries()].map(([fid, e]) => {
    const eco = e.eco || {};
    const isSel = AD.sel === fid;
    const hasEco = !!e.eco;
    const tech = Array.isArray(eco.research) ? eco.research.length : 0;
    const rosterQty = e.roster.reduce((a, p) => a + (p.qty || 0), 0);
    const c = v => `<div style="${cellBase}">${v}</div>`;
    return `<div onclick="adSelectFaction('${esc(fid)}')" style="display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid var(--w1,#1e2630);cursor:pointer;background:${isSel ? 'color-mix(in srgb,var(--gd,#3a7fbf) 12%,transparent)' : 'transparent'}">
      <div style="flex:2 1 170px;min-width:140px">
        <div style="font-weight:600;color:var(--t1,#e8edf2);margin-bottom:2px">${esc(e.app.name)}</div>
        <div style="font-family:monospace;font-size:10px;color:var(--t4,#6a7a88)">${esc(e.app.race || '—')} · <span style="color:var(--te,#3ec0d0)">${esc(e.app.owner_email || '—')}</span></div>
      </div>
      ${c(hasEco ? adNum(eco.gc) : '—')}${c(hasEco ? adNum(eco.science) : '—')}${c(hasEco ? adNum(eco.agents) : '—')}
      ${c(e.colonies.length)}${c(e.buildings.length)}${c(e.systems.length)}${c(rosterQty)}${c(tech)}
    </div>`;
  }).join('');
  return `<div style="border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b2,#141a22);overflow:hidden">${head}${rows}</div>`;
}

// HTML панели для слота (панель выбранной фракции или подсказка)
function adPanelSlotHtml() {
  if (AD.sel && AD.byFid.has(AD.sel)) {
    try { return adFacPanel(); }
    catch (e) { return `<div style="color:#ff7a7a;padding:16px;border:1px solid #ff7a7a;border-radius:8px">Ошибка панели: ${esc(e.message || String(e))}</div>`; }
  }
  return `<div style="padding:22px;border:1px dashed var(--w2,#2a3340);border-radius:10px;color:var(--t3,#8aa0b0);font-size:13px;text-align:center">Выберите фракцию из списка выше — откроется управление её казной, ресурсами, технологиями, территорией, колониями и армией.</div>`;
}
// Обновить ТОЛЬКО слот панели (без перерисовки всей консоли)
function adRenderSlot() {
  const slotId = (AD.embed && AD.embed.active) ? (AD.embed.slotId || 'fn-c-admin-slot') : 'fm-panel-slot';
  const slot = document.getElementById(slotId);
  if (slot) {
    slot.innerHTML = adPanelSlotHtml();
    if (AD.embed && AD.embed.active && typeof fnVerdictPreviewRefresh === 'function') fnVerdictPreviewRefresh();
    return true;
  }
  return false;
}
// ── Глобальный пул портретов оперативников (общий для всех фракций) ──
// Расы — те же, что в регистрации фракций (faction_reg.js: FR_RACE). Не выдумываем.
const AD_PORTRAIT_RACES   = (typeof FR_RACE !== 'undefined' && Array.isArray(FR_RACE) && FR_RACE.length)
  ? FR_RACE.slice()
  : ['Гуманоиды', 'Млекопитающие', 'Рептилоиды', 'Авианы (Птицеподобные)', 'Инсектоиды', 'Акватики (Водные)', 'Плантоиды (Растениевидные)', 'Литоиды (Каменные)', 'Синтетики / Киборги', 'Энергетические сущности'];
const AD_PORTRAIT_GENDERS = ['муж.', 'жен.', 'агендер'];
function adPortraitsPanel() {
  const list = AD.portraits || [];
  const byRace = {};
  list.forEach(p => { const k = p.race || '— универсальные (любая раса) —'; (byRace[k] = byRace[k] || []).push(p); });
  const inp = 'padding:8px 10px;font-size:13px;background:var(--b2,#141a22);color:var(--t1,#e8edf2);border:1px solid var(--w2,#2a3340);border-radius:8px';
  const raceOpts = ['<option value="">— любая раса (универсальный) —</option>']
    .concat(AD_PORTRAIT_RACES.map(r => `<option value="${esc(r)}">${esc(r)}</option>`)).join('');
  const genderOpts = ['<option value="">— любой пол —</option>']
    .concat(AD_PORTRAIT_GENDERS.map(g => `<option value="${esc(g)}">${esc(g)}</option>`)).join('');
  const groups = Object.keys(byRace).sort().map(race => {
    const cards = byRace[race].map(p => `<div style="position:relative;width:92px">
        <div style="width:92px;height:116px;border-radius:8px;border:1px solid var(--w2,#2a3340);background:#0c1322 center/cover no-repeat;background-image:url('${esc(p.url)}')"></div>
        <div style="font-size:9px;color:var(--t4,#6a7a88);margin-top:3px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.gender || 'любой пол')}</div>
        <button class="btn btn-gh btn-xs" title="Удалить портрет" onclick="adPortraitDelete('${esc(p.id)}')" style="position:absolute;top:3px;right:3px;min-width:0;padding:2px 6px;background:rgba(8,12,22,.8)">✕</button>
      </div>`).join('');
    return `<div style="margin-top:14px">
      <div style="font-family:monospace;font-size:11px;color:var(--te,#3ec0d0);margin-bottom:7px">${esc(race)} <span style="color:var(--t4,#6a7a88)">· ${byRace[race].length}</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:10px">${cards}</div>
    </div>`;
  }).join('') || '<div style="color:var(--t4,#6a7a88);font-size:13px;padding:14px 0">Пул пуст — загрузите первые портреты. Игра подбирает их оперативникам случайно по расе.</div>';
  return `<div style="margin-top:24px;border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b2,#141a22);padding:16px 18px">
    <div style="font-family:var(--font-display,sans-serif);font-size:16px;font-weight:700;color:var(--gdl,#5fb0e6)">🎭 Портреты оперативников <span style="font-size:11px;font-weight:400;color:var(--t4,#6a7a88)">· общий пул для всех фракций (${list.length})</span></div>
    <div style="font-size:12px;color:var(--t3,#8aa0b0);margin:6px 0 4px">Помечайте портреты расой и полом. Каждому оперативнику игра выбирает портрет <b>случайно</b> из подходящих по расе (и полу, если задан) — выбор закреплён за агентом. Без расы — «универсальные», подходят всем.</div>
    <div style="font-size:11px;color:var(--t4,#6a7a88);margin:0 0 12px;line-height:1.5">📁 Картинки сохраняются <b>прямо в папку игры</b> <code>${AD_PORT_DIR}/</code> (не в облако) — потом публикуешь вместе с проектом. Запусти локальный сервер один раз: <code>node tools/upload-server.js</code> и держи окно открытым.</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <select id="ad-portrait-race" style="${inp}">${raceOpts}</select>
      <select id="ad-portrait-gender" style="${inp}">${genderOpts}</select>
      <input id="ad-portrait-file" type="file" accept="image/*" multiple style="${inp};max-width:280px">
      <button class="btn btn-gd btn-sm" onclick="adPortraitUpload()">⬇ Сохранить в папку</button>
      <span id="ad-portrait-status" style="font-size:12px;color:var(--t3,#8aa0b0)"></span>
    </div>
    <div id="ad-portrait-grid">${groups}</div>
  </div>`;
}
// ── Союзы: реестр всех федераций/конфедераций + удаление ──────
function adUnionsPanel() {
  const list = AD.unions || [];
  const ST = { pending: ['НА МОДЕРАЦИИ', 'var(--color-warning,#d9a13a)'], approved: ['ОДОБРЕН', 'var(--ok,#5fbf7f)'], rejected: ['ОТКЛОНЁН', 'var(--err,#ff7a7a)'] };
  const cards = list.map(u => {
    const col  = u.color || '#5a7fb0';
    const kind = u.kind === 'federation' ? '🛡 Федерация' : '🤝 Конфедерация';
    const st   = ST[u.status] || ['—', 'var(--t4,#6a7a88)'];
    const herald = u.herald_url
      ? `<div style="width:40px;height:40px;border-radius:8px;flex-shrink:0;background:#0c1322 center/cover no-repeat;background-image:url('${esc(u.herald_url)}')"></div>`
      : `<div style="width:40px;height:40px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#0c1322;color:${esc(col)};font-size:18px">${u.kind === 'federation' ? '🛡' : '🤝'}</div>`;
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--w2,#2a3340);border-radius:9px;background:var(--b1,#0f141b)">
      <span style="width:5px;align-self:stretch;border-radius:4px;background:${esc(col)}"></span>
      ${herald}
      <div style="min-width:0;flex:1">
        <div style="font-weight:700;color:var(--t1,#e8edf2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.name || 'Без названия')}
          <span style="font-size:9px;font-weight:700;letter-spacing:.08em;color:${st[1]};border:1px solid ${st[1]};border-radius:5px;padding:1px 5px;margin-left:6px">${st[0]}</span></div>
        <div style="font-size:11px;color:var(--t3,#8aa0b0);margin-top:2px">${kind} · 👑 ${esc(u.leader_name || u.leader_fid || '—')} · 👥 ${(+u.members || 0)}</div>
      </div>
      <button class="btn btn-rd btn-sm" onclick="adUnionDelete('${esc(u.id)}', this)" style="white-space:nowrap">🗑 Удалить</button>
    </div>`;
  }).join('') || '<div style="color:var(--t4,#6a7a88);font-size:13px;padding:14px 0">Союзов нет.</div>';
  return `<div style="margin-top:24px;border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b2,#141a22);padding:16px 18px">
    <div style="font-family:var(--font-display,sans-serif);font-size:16px;font-weight:700;color:var(--gdl,#5fb0e6)">🤝 Союзы <span style="font-size:11px;font-weight:400;color:var(--t4,#6a7a88)">· все федерации и конфедерации (${list.length})</span></div>
    <div style="font-size:12px;color:var(--t3,#8aa0b0);margin:6px 0 12px">Удаление союза необратимо: распускает объединение, убирает всех участников и приглашения. Вассальные пакты не затрагиваются.</div>
    <div style="display:flex;flex-direction:column;gap:8px">${cards}</div>
  </div>`;
}
async function adUnionDelete(id, btn) {
  if (AD.busy) return;
  const u = (AD.unions || []).find(x => x.id === id);
  const name = u ? (u.name || 'союз') : 'союз';
  if (!confirm(`Удалить союз «${name}»?\n\nОбъединение будет распущено, все участники и приглашения удалены. Необратимо.`)) return;
  AD.busy = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Удаление…'; }
  try {
    await adRpc('union_delete', { p_union_id: id });
    AD.unions = (AD.unions || []).filter(x => x.id !== id);
    toast(`Союз «${name}» удалён`, 'ok');
    adPaint();
  } catch (ex) {
    toast('Ошибка: ' + (ex.message || ex), 'err');
    if (btn) { btn.disabled = false; btn.textContent = '🗑 Удалить'; }
  } finally { AD.busy = false; }
}
// ── Локальное сохранение портретов в папку игры (assets/portraits/) ──
// Картинки пишутся прямо в папку проекта через ЛОКАЛЬНЫЙ аплоад-сервер
// (tools/upload-server.js — запусти `node tools/upload-server.js`). Никакого
// выбора папки и никакого Supabase Storage. В БД хранится только относительный
// путь + раса/пол; потом публикуешь папку вместе с игрой.
const AD_PORT_DIR    = 'assets/portraits';                 // путь от корня сайта (для URL)
const AD_PORT_SERVER = 'http://localhost:8787';            // адрес tools/upload-server.js
const AD_PORT_EXT    = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

// Жив ли локальный сервер? (короткий пинг, чтобы дать понятную ошибку)
async function adPortServerAlive() {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`${AD_PORT_SERVER}/ping`, { signal: ctl.signal });
    clearTimeout(t); return r.ok;
  } catch (e) { return false; }
}

async function adPortraitUpload() {
  const fileEl = document.getElementById('ad-portrait-file');
  const race   = (document.getElementById('ad-portrait-race')   || {}).value || null;
  const gender = (document.getElementById('ad-portrait-gender') || {}).value || null;
  const status = document.getElementById('ad-portrait-status');
  const files  = fileEl && fileEl.files ? [...fileEl.files] : [];
  if (!files.length) { if (status) status.textContent = 'Выберите файл(ы)'; return; }
  if (status) status.textContent = 'Проверка сервера…';
  if (!(await adPortServerAlive())) {
    if (status) status.textContent = `Сервер не запущен — выполни: node tools/upload-server.js`;
    toast('Запусти локальный аплоад-сервер: node tools/upload-server.js', 'err');
    return;
  }
  let done = 0, fail = 0;
  for (const f of files) {
    if (status) status.textContent = `Сохранение ${done + fail + 1}/${files.length}…`;
    try {
      const cf  = (typeof compressImageFile === 'function') ? await compressImageFile(f, 768, 0.85) : f;
      const ext = AD_PORT_EXT[cf.type] || 'jpg';
      const r   = await fetch(`${AD_PORT_SERVER}/upload?ext=${ext}`, {
        method: 'POST', headers: { 'Content-Type': cf.type || 'application/octet-stream' }, body: cf
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok || !j.url) throw new Error(j.error || ('HTTP ' + r.status));
      await dbPost('spy_portraits', { race, gender, url: j.url, label: f.name || null });
      done++;
    } catch (e) { console.error('[admin] portrait save', e); fail++; }
  }
  if (status) status.textContent = `Готово: +${done}${fail ? `, ошибок ${fail}` : ''} → ${AD_PORT_DIR}/`;
  try { AD.portraits = await dbGet('spy_portraits', 'select=id,race,gender,url,label&order=created_at.desc'); } catch (e) {}
  adPaint();
}
async function adPortraitDelete(id) {
  if (!confirm('Удалить портрет из пула? (Агентам, у кого он был, подберётся другой.)')) return;
  const p = (AD.portraits || []).find(x => x.id === id);
  try {
    await dbDel('spy_portraits', `id=eq.${id}`);
    // Если файл лежит в папке игры — попросим сервер удалить его (best-effort).
    if (p && p.url && p.url.indexOf(AD_PORT_DIR + '/') === 0) {
      const name = p.url.split('/').pop();
      fetch(`${AD_PORT_SERVER}/file?name=${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {});
    }
    AD.portraits = (AD.portraits || []).filter(x => x.id !== id); adPaint();
  } catch (e) { toast('Не удалось удалить: ' + (e.message || e), 'err'); }
}

function adSelectFaction(fid) {
  AD.sel = fid || null;        // выбор из списка (без переключения)
  AD.subtab = 'treasury';
  AD.sysSearch = '';
  console.log('[ADMIN] select faction:', AD.sel, 'inIndex=', AD.sel ? AD.byFid.has(AD.sel) : '-');
  if (!adRenderSlot()) adPaint();   // если слота нет — полный рендер
  const s = document.getElementById('fm-fac-select'); if (s && s.value !== (AD.sel || '')) s.value = AD.sel || '';
}
function adSetSubtab(t) { AD.subtab = t; if (!adRenderSlot()) adPaint(); }
function adSetTab(t) { AD.tab = t || 'factions'; adPaint(); }

function adFacPanel() {
  const e = adEntry(AD.sel);
  if (!e) return '';
  const SUBTABS = [['treasury','💰 Казна'],['economy','📊 Экономика'],['resources','📦 Ресурсы'],['mining','⛏ Добыча'],['caravans','🚚 Караваны'],['research','🔬 Технологии'],['territory','🌐 Территория'],['colonies','🏗 Колонии'],['army','⚔ Армия'],['agents','🕵 Агенты'],['journal','📋 Журнал'],['owner','👑 Владелец'],['testing','🧪 Тест'],['danger','⚠ Зона риска']];
  const tabBtns = SUBTABS.map(([id, lbl]) => `<button class="fm-stab${AD.subtab===id?' on':''}" onclick="adSetSubtab('${id}')">${lbl}</button>`).join('');
  const bodyMap = { treasury: adTabTreasury, economy: adTabEconomy, resources: adTabResources, mining: adTabMining, caravans: adTabCaravans, research: adTabResearch, territory: adTabTerritory, colonies: adTabColonies, army: adTabArmy, agents: adTabAgents, journal: adTabJournal, owner: adTabOwner, testing: adTabTesting, danger: adTabDanger };
  const renderFn = bodyMap[AD.subtab] || adTabTreasury;
  let tabBody = '';
  try { tabBody = renderFn(e); }
  catch (ex) { tabBody = `<div style="color:#ff7a7a;padding:12px">Ошибка вкладки: ${esc(ex.message || String(ex))}</div>`; }
  // Инлайн-стили — панель видна и не схлопывается независимо от CSS.
  return `<div class="fm-panel" id="fm-panel" style="display:block;border:1px solid var(--gd,#3a7fbf);border-radius:10px;background:var(--b2,#141a22);margin-bottom:18px;overflow:hidden">
    <div class="fm-panel-hd" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 20px;background:color-mix(in srgb,var(--gd,#3a7fbf) 8%,transparent);border-bottom:1px solid var(--w2,#2a3340)">
      <div>
        <div class="fm-panel-title" style="font-family:var(--font-display,sans-serif);font-size:18px;font-weight:700;color:var(--gdl,#5fb0e6)">${esc(e.app.name)}</div>
        <div class="fm-panel-sub" style="font-family:monospace;font-size:10px;color:var(--t4,#6a7a88);margin-top:4px">${esc(e.app.faction_id)} · ${esc(e.app.race || '—')} · <a class="fm-link" style="color:var(--te,#3ec0d0)" href="mailto:${esc(e.app.owner_email || '')}">${esc(e.app.owner_email || '—')}</a></div>
      </div>
      <button class="btn btn-gh btn-xs" onclick="adSelectFaction('${esc(AD.sel)}')">✕ Закрыть</button>
    </div>
    <div class="fm-stabs" style="display:flex;flex-wrap:wrap;gap:4px;padding:10px 14px;background:var(--b3,#0f141b);border-bottom:1px solid var(--w2,#2a3340)">${tabBtns}</div>
    <div class="fm-tab-body" style="padding:18px 20px">${tabBody}</div>
  </div>`;
}

// ── Вкладка: Казна ──────────────────────────────────────────────
function adTabTreasury(e) {
  if (!e.eco) return `<div class="fm-no-eco">Экономика не инициализирована. Перейдите в <b>⚠ Зону риска</b> → Создать экономику.</div>`;
  const eco = e.eco;
  const field = (id, label, fld, deltas, negDeltas) => `
    <div class="fm-form-row">
      <label class="fm-lbl">${label}</label>
      <div class="fm-field-row">
        <input class="fi fm-num-input" id="fm-${fld}" type="number" value="${eco[fld] || 0}" min="0">
        ${deltas.map(d => `<button class="btn btn-gh btn-xs" onclick="adDelta('${fld}',${d})">+${d >= 1000 ? (d/1000)+'к' : d}</button>`).join('')}
        ${negDeltas.map(d => `<button class="btn btn-rd btn-xs" onclick="adDelta('${fld}',${-d})">−${d >= 1000 ? (d/1000)+'к' : d}</button>`).join('')}
      </div>
    </div>`;
  return `<div class="fm-form">
    ${field('fm-gc',      'ГС (Галактический Стандарт)', 'gc',      [100,1000,10000], [100,1000])}
    ${field('fm-science', 'ОН (Очки Науки)',             'science', [10,50,100],      [10])}
    <div class="fm-dim" style="font-size:11px;margin:4px 0">Агенты теперь именованные — выдавайте их во вкладке «🕵 Агенты».</div>
    <button class="btn btn-gd" onclick="adSetTreasury()" style="margin-top:8px">💾 Установить значения</button>
  </div>`;
}

async function adSetTreasury() {
  if (!AD.sel || AD.busy) return;
  const gc      = Math.max(0, parseInt(document.getElementById('fm-gc')?.value) || 0);
  const science = Math.max(0, parseInt(document.getElementById('fm-science')?.value) || 0);
  AD.busy = true;
  try {
    const e = adEntry(AD.sel);
    const oldGc = e?.eco?.gc, oldSci = e?.eco?.science;
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { gc, science });
    if (e && e.eco) { e.eco.gc = gc; e.eco.science = science; }
    if (oldGc != null && gc !== oldGc) adLogGrant({ type: 'treasury', field: 'gc', label: 'ГС', from: oldGc, to: gc, delta: gc - oldGc });
    if (oldSci != null && science !== oldSci) adLogGrant({ type: 'treasury', field: 'science', label: 'ОН', from: oldSci, to: science, delta: science - oldSci });
    toast('Казна обновлена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adDelta(field, delta) {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  const val = Math.max(0, Number(e.eco[field] || 0) + delta);
  AD.busy = true;
  try {
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { [field]: val });
    e.eco[field] = val;
    adLogGrant({ type: 'treasury', field, label: adTreasuryLabel(field), delta, to: val });
    toast(`${field}: ${adNum(val)}`, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Вкладка: Ресурсы ────────────────────────────────────────────
const AD_RARITY_LABEL = { common: 'обычный', uncommon: 'редкий', rare: 'ценный', epic: 'эпический', legendary: 'легенд.' };
const AD_RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

function adTabResources(e) {
  if (!e.eco) return `<div class="fm-no-eco">Экономика не инициализирована.</div>`;
  const res = e.eco.resources || {};
  const resKeys = Object.keys(res).filter(k => (res[k] || 0) > 0);

  const curRows = resKeys.length
    ? resKeys.map(k => {
        const info = AD.resInfo[k] || {};
        return `<div class="fm-res-row" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--w1,#1e2630)">
          <span style="font-size:16px;width:22px;text-align:center">${esc(info.icon || '◈')}</span>
          <span style="flex:1;min-width:100px;font-size:13px;color:var(--t1,#e8edf2)">${esc(k)}</span>
          <span class="fm-rarity fm-rarity-${info.r || 'common'}" style="font-size:10px;min-width:60px">${AD_RARITY_LABEL[info.r] || info.r || 'common'}</span>
          <input class="fi fm-res-val" id="fm-rv-${esc(k)}" type="number" value="${res[k]}" min="0" style="width:80px;text-align:right">
          <button class="btn btn-gh btn-xs" onclick="adDeltaRes(${adArg(k)},50)">+50</button>
          <button class="btn btn-gh btn-xs" onclick="adDeltaRes(${adArg(k)},100)">+100</button>
          <button class="btn btn-gh btn-xs" onclick="adDeltaRes(${adArg(k)},500)">+500</button>
          <button class="btn btn-gh btn-xs" onclick="adDeltaRes(${adArg(k)},1000)">+1к</button>
          <button class="btn btn-rd btn-xs" onclick="adDeltaRes(${adArg(k)},-100)">−100</button>
          <button class="btn btn-gh btn-xs" onclick="adUpdateResource(${adArg(k)})" title="Установить точное значение из поля">✓</button>
          <button class="btn btn-rd btn-xs" onclick="adZeroResource(${adArg(k)})" title="Убрать ресурс">✕</button>
        </div>`;
      }).join('')
    : `<div class="fm-empty">Нет ресурсов на складе</div>`;

  // Группировка каталога по редкости для выпадающего списка
  const byRarity = {};
  AD_RES_CATALOG.forEach(rc => { (byRarity[rc.r] = byRarity[rc.r] || []).push(rc); });
  const resOptGroups = AD_RARITY_ORDER.filter(r => byRarity[r]).map(r =>
    `<optgroup label="${AD_RARITY_LABEL[r] || r}">${byRarity[r].map(rc => `<option value="${esc(rc.name)}">${esc(rc.icon)} ${esc(rc.name)}</option>`).join('')}</optgroup>`
  ).join('');

  // Пресет-кнопки быстрой выдачи (выбранный ресурс + фиксированные суммы)
  const quickBtns = [50, 100, 500, 1000, 5000].map(v =>
    `<button class="btn btn-gd btn-xs" onclick="adAddResourceAmt(${v})">+${v >= 1000 ? v/1000+'к' : v}</button>`
  ).join('');

  return `<div class="fm-resources">
    <div class="fm-section-title">Текущие ресурсы на складе</div>
    <div class="fm-res-list">${curRows}</div>
    <div class="fm-section-title" style="margin-top:16px">Добавить / пополнить</div>
    <div class="fm-field-row" style="flex-wrap:wrap;gap:6px;align-items:center">
      <select class="fi" id="fm-add-res-name" style="flex:2;min-width:180px">${resOptGroups}</select>
      <input class="fi" id="fm-add-res-amt" type="number" value="100" min="1" style="width:80px" placeholder="Кол-во">
      <button class="btn btn-gd btn-sm" onclick="adAddResource()">+ Добавить</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;align-items:center">
      <span style="font-size:11px;color:var(--t3,#8aa0b0);margin-right:2px">Быстро:</span>
      ${quickBtns}
    </div>
  </div>`;
}

async function adUpdateResource(name) {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  const val = Math.max(0, parseInt(document.getElementById('fm-rv-' + name)?.value) || 0);
  const old = Number(e.eco.resources?.[name] || 0);
  AD.busy = true;
  try {
    const res = { ...(e.eco.resources || {}), [name]: val };
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { resources: res });
    e.eco.resources = res;
    if (val !== old) adLogGrant({ type: 'resource', name, delta: val - old, to: val });
    toast(`${name}: ${adNum(val)}`, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adZeroResource(name) {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  AD.busy = true;
  try {
    const res = { ...(e.eco.resources || {}) }; delete res[name];
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { resources: res });
    e.eco.resources = res;
    toast(`${name} убран`, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adAddResource() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) { toast('Нет экономики', 'err'); return; }
  const nameEl = document.getElementById('fm-add-res-name');
  const name = nameEl?.value?.trim();
  const amt  = Math.max(1, parseInt(document.getElementById('fm-add-res-amt')?.value) || 0);
  if (!name) { toast('Выберите / введите ресурс', 'err'); return; }
  AD.busy = true;
  try {
    const to = Number(e.eco.resources?.[name] || 0) + amt;
    const res = { ...(e.eco.resources || {}), [name]: to };
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { resources: res });
    e.eco.resources = res;
    adLogGrant({ type: 'resource', name, delta: amt, to });
    toast(`+${adNum(amt)} ${name}`, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// Быстрые кнопки: выбранный ресурс + фиксированное количество
async function adAddResourceAmt(amt) {
  const nameEl = document.getElementById('fm-add-res-name');
  const name = nameEl?.value?.trim();
  if (!name) { toast('Выберите ресурс из списка', 'err'); return; }
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) { toast('Нет экономики', 'err'); return; }
  AD.busy = true;
  try {
    const to = Number(e.eco.resources?.[name] || 0) + amt;
    const res = { ...(e.eco.resources || {}), [name]: to };
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { resources: res });
    e.eco.resources = res;
    adLogGrant({ type: 'resource', name, delta: amt, to });
    toast(`+${adNum(amt)} ${name}`, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// Изменить количество ресурса на delta (inline-кнопки в строке склада)
async function adDeltaRes(name, delta) {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  const cur = Number(e.eco.resources?.[name] || 0);
  const val = Math.max(0, cur + delta);
  AD.busy = true;
  try {
    const res = { ...(e.eco.resources || {}), [name]: val };
    if (val === 0) delete res[name];
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { resources: res });
    e.eco.resources = res;
    adLogGrant({ type: 'resource', name, delta, to: val });
    toast(`${name}: ${adNum(val)}`, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Вкладка: Экономика ──────────────────────────────────────────
// Полный разбор «откуда и сколько идёт дохода»: ГС с фабрик/хабов/храмов и
// караванов, наука с институтов, агенты со спецслужб, плюс прочие мощности
// (подготовка/верфи/склады/биржа). Расчёт — зеркало economy_accrue (_faith_setup.sql).

function adSlotsOf(e, type) { return e.buildings.filter(b => b.btype === type).reduce((a, b) => a + (b.slots_open || 0), 0); }
function adCountOf(e, type) { return e.buildings.filter(b => b.btype === type).length; }
function adDebuffPct(eco) {
  if (eco && eco.debuff_until && new Date(eco.debuff_until) > new Date()) return Math.max(0, Math.min(1, +eco.debuff_pct || 0));
  return 0;
}

function adTabEconomy(e) {
  if (!e.eco) return `<div class="fm-no-eco">Экономика не инициализирована.</div>`;
  const m = (typeof ecFactionMods === 'function') ? ecFactionMods(e.app || {}) : { gc: 1, sci_flat: 0, agents_flat: 0 };
  const debuff = adDebuffPct(e.eco);
  const gcMul  = (m.gc || 1) * (1 - debuff);
  const hasFaith = AD.faithFids ? AD.faithFids.has(AD.sel) : false;

  // ── ГС с построек (точно как сервер: inc_gc × m_gc) ──
  const facSlots = adSlotsOf(e, 'factory'), tradeSlots = adSlotsOf(e, 'trade'), templeSlots = adSlotsOf(e, 'temple');
  const facBase    = facSlots * 200;
  const tradeBase  = tradeSlots * 100;
  const templeBase = hasFaith ? templeSlots * 150 : 0;
  const bldGcBase  = facBase + tradeBase + templeBase;
  const bldGcFinal = Math.round(bldGcBase * gcMul);

  // ── Караваны (валовый поток; фактически зависит от экспортной добычи и пиратов) ──
  const act = (e.routes || []).filter(r => r.status === 'active');
  const out = act.filter(r => r.a_fid === AD.sel);   // исходящие — фракция продаёт
  const inn = act.filter(r => r.b_fid === AD.sel);   // входящие — доля 50%
  const outGross = out.reduce((a, r) => a + (r.volume || 0) * (r.price || 0), 0);
  const outGc = Math.round(outGross * (m.gc || 1));
  const inGc  = inn.reduce((a, r) => a + Math.round((r.volume || 0) * (r.price || 0) * 0.5), 0);
  const pendingOut = (e.routes || []).filter(r => r.a_fid === AD.sel && r.status === 'pending').length;

  // ── Наука и агенты (плоский бонус доктрины) ──
  const sciSlots = adSlotsOf(e, 'science');
  const sciBase = sciSlots * 1;
  const sciFlat = Math.round(m.sci_flat || 0);
  const sciFinal = Math.max(0, sciBase + sciFlat);
  const intelSlots = adSlotsOf(e, 'intel');
  const agFlat = Math.round(m.agents_flat || 0);
  const agFinal = Math.max(0, intelSlots + agFlat);

  // ── Прочие мощности ──
  const warehouseSlots = adSlotsOf(e, 'warehouse');
  const storageCap = 1000 + warehouseSlots * 500;
  const marketSlots = adSlotsOf(e, 'market');
  const trainSlots = adSlotsOf(e, 'training');
  const milfacSlots = adSlotsOf(e, 'military_factory');
  const shipSlots = adSlotsOf(e, 'shipyard');

  const gcNetSteady = bldGcFinal + outGc + inGc;

  // helper: строка источника
  const row = (icon, label, detail, value, vcolor) => `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--w1,#1e2630)">
    <span style="font-size:15px;width:22px;text-align:center">${icon}</span>
    <span style="flex:1;min-width:120px;font-size:13px;color:var(--t1,#e8edf2)">${label}<span style="display:block;font-size:10px;color:var(--t4,#6a7a88);font-family:monospace">${detail}</span></span>
    <span style="font-family:monospace;font-size:14px;color:${vcolor};min-width:84px;text-align:right">${value}</span>
  </div>`;

  const gcMulNote = `доктрина ×${(m.gc || 1).toFixed(2)}${debuff ? ` · дестабилизация −${Math.round(debuff * 100)}%` : ''} → итог ×${gcMul.toFixed(2)}`;

  // ── ГС-блок ──
  const gcRows = [
    facSlots    ? row('🏭', 'Гражданские фабрики', `${facSlots} слот. × 200 = ${adNum(facBase)} → ×${gcMul.toFixed(2)}`, `+${adNum(Math.round(facBase * gcMul))}`, 'var(--gd,#3a7fbf)') : '',
    tradeSlots  ? row('💱', 'Торговые хабы', `${tradeSlots} слот. × 100 = ${adNum(tradeBase)} → ×${gcMul.toFixed(2)}`, `+${adNum(Math.round(tradeBase * gcMul))}`, 'var(--gd,#3a7fbf)') : '',
    templeSlots ? row('🛐', 'Храмы веры', hasFaith ? `${templeSlots} слот. × 150 = ${adNum(templeSlots*150)} → ×${gcMul.toFixed(2)}` : `${templeSlots} слот. — нет исповедуемой веры, доход 0`, hasFaith ? `+${adNum(Math.round(templeSlots*150*gcMul))}` : '0', hasFaith ? 'var(--gd,#3a7fbf)' : 'var(--t4,#6a7a88)') : '',
    out.length  ? row('🚚', `Караваны исходящие (${out.length})`, `вал ${adNum(outGross)} × доктрина ${(m.gc||1).toFixed(2)} — зависит от экспортной добычи и пиратов`, `+${adNum(outGc)}`, 'var(--gd,#3a7fbf)') : '',
    inn.length  ? row('📥', `Караваны входящие (${inn.length})`, `доля получателя 50% от поставок партнёра`, `+${adNum(inGc)}`, 'var(--gd,#3a7fbf)') : '',
  ].filter(Boolean).join('') || `<div class="fm-empty">Нет источников ГС — нет фабрик/хабов/караванов.</div>`;

  // активные пути списком
  const routeList = act.length ? `<div style="margin-top:8px;font-size:11px;color:var(--t3,#8aa0b0)">
    ${act.map(r => {
      const isOut = r.a_fid === AD.sel;
      const partner = isOut ? (r.b_name || r.b_fid) : (r.a_name || r.a_fid);
      return `<div style="padding:3px 0">${isOut ? '↗' : '↘'} <b style="color:var(--t2,#c0ccd6)">${esc(partner)}</b> · ${esc(r.resource || 'разное')} · объём ${adNum(r.volume||0)} × цена ${adNum(r.price||0)}${isOut ? '' : ' (вход, 50%)'}</div>`;
    }).join('')}
  </div>` : '';

  // ── Наука-блок ──
  const sciRows = [
    sciSlots ? row('🔬', 'Научные институты', `${sciSlots} слот. × 1 ОН`, `+${adNum(sciBase)}`, 'var(--pu,#b07bd8)') : '',
    sciFlat  ? row('📜', 'Бонус доктрины (наука)', `плоский ${sciFlat > 0 ? '+' : ''}${sciFlat} ОН/сут`, `${sciFlat > 0 ? '+' : ''}${adNum(sciFlat)}`, sciFlat > 0 ? 'var(--pu,#b07bd8)' : 'var(--t4,#6a7a88)') : '',
  ].filter(Boolean).join('') || `<div class="fm-empty">Нет источников науки — нет научных институтов.</div>`;

  // ── Агенты-блок ──
  const agRows = [
    intelSlots ? row('🕵', 'Центры спецслужб', `${intelSlots} слот. × 1 агент`, `+${adNum(intelSlots)}`, 'var(--te,#3ec0d0)') : '',
    agFlat     ? row('📜', 'Бонус доктрины (агенты)', `плоский ${agFlat > 0 ? '+' : ''}${agFlat}/сут`, `${agFlat > 0 ? '+' : ''}${adNum(agFlat)}`, agFlat > 0 ? 'var(--te,#3ec0d0)' : 'var(--t4,#6a7a88)') : '',
  ].filter(Boolean).join('') || `<div class="fm-empty">Нет источников агентов — нет центров спецслужб.</div>`;

  // ── Переменные источники ──
  const varRows = [
    marketSlots ? row('📈', 'Товарная биржа', `${marketSlots} слот. → продаёт до ${adNum(marketSlots*25)} ед. ресурсов/сут за ГС (50–75% цены)`, 'перем.', 'var(--t3,#8aa0b0)') : '',
  ].filter(Boolean).join('');

  // ── Прочие мощности (не доход, а что даёт) ──
  const capChip = (icon, label, val) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--w1,#1e2630)">
    <span style="font-size:14px;width:20px;text-align:center">${icon}</span>
    <span style="flex:1;font-size:12px;color:var(--t2,#c0ccd6)">${label}</span>
    <span style="font-family:monospace;font-size:12px;color:var(--t1,#e8edf2)">${val}</span>
  </div>`;
  const capRows = [
    capChip('🪖', 'Центры подготовки (пехота)', `${trainSlots} слот. → ${adNum(trainSlots*1000)} ед./заказ`),
    capChip('🛠', 'Военные заводы (техника)',   `${milfacSlots} слот. → ${adNum(milfacSlots*100)} ед./заказ`),
    capChip('🚀', 'Корабельные верфи',          `${shipSlots} слот. → ${shipSlots} кор. / ${shipSlots*12} МЛА`),
    capChip('📦', 'Склады (ёмкость хранилища)', `${warehouseSlots} слот. → лимит ${adNum(storageCap)}`),
  ].join('');

  const sect = (title, inner) => `<div class="fm-section-title">${title}</div><div style="border:1px solid var(--w2,#2a3340);border-radius:8px;padding:4px 12px;background:var(--b2,#141a22);margin-bottom:16px">${inner}</div>`;

  return `<div class="fm-economy">
    <div style="display:flex;flex-wrap:wrap;gap:8px 18px;padding:10px 14px;border:1px solid var(--w2,#2a3340);border-radius:8px;background:var(--b3,#0f141b);margin-bottom:14px;font-size:12px;color:var(--t3,#8aa0b0)">
      <span>💰 Постоянный ГС/сут: <b style="color:var(--gd,#3a7fbf)">+${adNum(gcNetSteady)}</b></span>
      <span>🔬 Наука/сут: <b style="color:var(--pu,#b07bd8)">+${adNum(sciFinal)}</b></span>
      <span>🕵 Агенты/сут: <b style="color:var(--te,#3ec0d0)">+${adNum(agFinal)}</b></span>
      <span style="flex-basis:100%;font-size:10px;color:var(--t4,#6a7a88)">Множитель ГС: ${gcMulNote}</span>
    </div>

    ${sect('💰 Доход ГС / сутки', gcRows + routeList + (pendingOut ? `<div style="font-size:11px;color:var(--color-warning,#e0a030);padding:6px 0">⏳ Ещё ${pendingOut} путь(ей) на согласовании (пока без дохода)</div>` : ''))}
    ${varRows ? sect('💱 Переменный доход ГС (зависит от склада/потока)', varRows) : ''}
    ${sect(`🔬 Наука / сутки — итог +${adNum(sciFinal)} ОН`, sciRows)}
    ${sect(`🕵 Агенты / сутки — итог +${adNum(agFinal)}`, agRows)}
    ${sect('🏗 Прочие мощности (производство)', capRows)}

    <div class="fm-dim" style="font-size:11px;margin-top:4px">Расчёт зеркалит живой тик economy_accrue: ГС построек × множитель доктрины × (1−дестабилизация); наука и агенты — плоский бонус доктрины. Караваны показаны валом — фактический доход режут пираты и зависит от экспортной добычи. Подробная добыча ресурсов — во вкладке «⛏ Добыча».</div>
  </div>`;
}

// ── Вкладка: Добыча ─────────────────────────────────────────────
// Подробный разбор «кто, сколько и как добывает»: множитель доктрины,
// каждый добывающий завод → его слоты/месторождения → добыча/сутки, режим
// потока (склад/экспорт) и сводка по фракции. Расчёт — зеркало economy_accrue
// (см. ecMineRate/ecFactionMods в economy.js).

// Итоговый множитель добычи фракции (доктрина + бонусы изученных политтехнологий).
// ecFactionMods(app) не подмешивает research для чужой анкеты — добавляем вручную.
function adMineMult(e) {
  const base = (typeof ecFactionMods === 'function') ? ecFactionMods(e.app || {}) : { mine: 1, _raw: {} };
  const rawMine = (base._raw && typeof base._raw.mine === 'number') ? base._raw.mine : (base.mine - 1);
  let resBonus = 0;
  const research = Array.isArray(e.eco && e.eco.research) ? e.eco.research : [];
  if (typeof EC_RESEARCH_BONUS !== 'undefined') {
    research.forEach(id => { const b = EC_RESEARCH_BONUS[id]; if (b && b.mine) resBonus += b.mine; });
  }
  return { mult: Math.max(0.3, 1 + rawMine + resBonus), resBonus };
}

// Добыча одного слота/сутки: редкость × богатство месторождения × множитель.
function adMineRate(rar, amt, mult) {
  const baseRate = (typeof EC_RES_RATE !== 'undefined' && EC_RES_RATE[rar || 'common']) || 25;
  const rich = (typeof ecRichMult === 'function') ? ecRichMult(amt) : 1.5;
  return Math.max(1, Math.round(baseRate * rich * mult));
}

function adTabMining(e) {
  if (!e.eco) return `<div class="fm-no-eco">Экономика не инициализирована.</div>`;
  const mm = adMineMult(e);
  const mult = mm.mult;
  const cols = e.colonies || [];
  const totals = new Map();   // name → { rate, slots, r, icon, store, export }
  let totalSlots = 0, usedSlots = 0, mineBlds = 0, idleMineBlds = 0;

  const rarLbl = r => AD_RARITY_LABEL[r] || r || 'common';
  const iconOf = (ri, name) => esc((ri && ri.icon) || (AD.resInfo[name] && AD.resInfo[name].icon) || '◈');
  const rarOf  = (ri, name) => (ri && ri.r) || (AD.resInfo[name] && AD.resInfo[name].r) || 'common';

  // ── Колонии с добывающими заводами ──
  const colBlocks = cols.map(c => {
    const blds = e.buildings.filter(b => b.colony_id === c.id && b.btype === 'mining');
    if (!blds.length) return '';
    const sys = AD.systems.find(s => s.id === c.system_id);
    const planetRes = Array.isArray(c.resources) ? c.resources.filter(r => r && r.name) : [];

    const bldCards = blds.map(b => {
      mineBlds++;
      const targets = Array.isArray(b.mining_targets) ? b.mining_targets : [];
      const slotsOpen = b.slots_open || 0;
      totalSlots += slotsOpen; usedSlots += targets.length;
      if (!targets.length) idleMineBlds++;
      const isExport = b.mine_mode === 'export';
      const modeBadge = isExport
        ? `<span style="font-size:10px;padding:2px 7px;border-radius:6px;background:color-mix(in srgb,var(--gd,#3a7fbf) 18%,transparent);color:var(--gdl,#5fb0e6)">💱 Экспорт</span>`
        : `<span style="font-size:10px;padding:2px 7px;border-radius:6px;background:var(--w1,#1e2630);color:var(--t3,#8aa0b0)">📦 На склад</span>`;

      // слоты, назначенные на месторождения (с группировкой по ресурсу)
      const tcount = new Map();
      targets.forEach(n => tcount.set(n, (tcount.get(n) || 0) + 1));
      const assignedRows = [...tcount.entries()].map(([name, cnt]) => {
        const ri = planetRes.find(r => r.name === name);
        const rar = rarOf(ri, name);
        const per = adMineRate(rar, ri && ri.amt, mult);
        const sub = per * cnt;
        const cur = totals.get(name) || { rate: 0, slots: 0, r: rar, icon: (ri && ri.icon) || (AD.resInfo[name] && AD.resInfo[name].icon), store: false, export: false };
        cur.rate += sub; cur.slots += cnt; if (isExport) cur.export = true; else cur.store = true;
        totals.set(name, cur);
        return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--w1,#1e2630)">
          <span style="font-size:15px;width:20px;text-align:center">${iconOf(ri, name)}</span>
          <span style="flex:1;min-width:90px;font-size:13px;color:var(--t1,#e8edf2)">${esc(name)}</span>
          <span class="fm-rarity fm-rarity-${rar}" style="font-size:10px;min-width:54px">${rarLbl(rar)}</span>
          <span style="font-size:11px;color:var(--t3,#8aa0b0);min-width:74px;text-align:right" title="Богатство месторождения">${esc((ri && ri.amt) || '—')}</span>
          <span style="font-family:monospace;font-size:11px;color:var(--t4,#6a7a88);min-width:64px;text-align:right" title="Добыча за 1 слот/сут">${cnt}×${adNum(per)}</span>
          <span style="font-family:monospace;font-size:13px;color:var(--gdl,#5fb0e6);min-width:64px;text-align:right" title="Всего с этого завода/сут">+${adNum(sub)}</span>
        </div>`;
      }).join('');

      const idleNote = !targets.length
        ? `<div class="fm-empty" style="padding:6px 0;font-size:11px;color:var(--color-warning,#e0a030)">⚠ Слоты не назначены — завод простаивает (${slotsOpen} своб.)</div>` : '';

      return `<div style="border:1px solid var(--w2,#2a3340);border-radius:8px;padding:10px 12px;margin-bottom:8px;background:var(--b3,#0f141b)">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <span style="font-size:13px;font-weight:600;color:var(--t1,#e8edf2)">⛏ Добывающий завод</span>
          ${modeBadge}
          <span style="font-family:monospace;font-size:11px;color:var(--t3,#8aa0b0);margin-left:auto">${targets.length}/${slotsOpen} слот.</span>
        </div>
        ${assignedRows || ''}${idleNote}
      </div>`;
    }).join('');

    return `<div style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:14px;font-weight:700;color:var(--gdl,#5fb0e6)">${c.is_capital ? '★ ' : ''}${esc(c.planet_name || '?')}</span>
        <span style="font-family:monospace;font-size:10px;color:var(--t4,#6a7a88)">${esc(sys ? sys.name : (c.system_id || '?'))}${c.planet_type ? ' · ' + esc(c.planet_type) : ''}</span>
      </div>
      ${bldCards}
    </div>`;
  }).filter(Boolean).join('');

  // ── Сводка по фракции ──
  const sumEntries = [...totals.entries()].sort((a, b) => b[1].rate - a[1].rate);
  const grandTotal = sumEntries.reduce((s, [, v]) => s + v.rate, 0);
  const sumRows = sumEntries.length
    ? sumEntries.map(([name, v]) => {
        const flow = v.export && v.store ? '📦+💱' : v.export ? '💱 экспорт' : '📦 склад';
        return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--w1,#1e2630)">
          <span style="font-size:16px;width:22px;text-align:center">${iconOf(null, name)}</span>
          <span style="flex:1;min-width:90px;font-size:13px;color:var(--t1,#e8edf2)">${esc(name)}</span>
          <span class="fm-rarity fm-rarity-${v.r}" style="font-size:10px;min-width:54px">${rarLbl(v.r)}</span>
          <span style="font-size:11px;color:var(--t3,#8aa0b0);min-width:58px;text-align:right">${v.slots} слот.</span>
          <span style="font-size:10px;color:var(--t4,#6a7a88);min-width:74px;text-align:right">${flow}</span>
          <span style="font-family:monospace;font-size:14px;color:var(--gdl,#5fb0e6);min-width:70px;text-align:right">+${adNum(v.rate)}</span>
        </div>`;
      }).join('')
    : `<div class="fm-empty">Фракция ничего не добывает — нет добывающих заводов с назначенными слотами.</div>`;

  const pct = Math.round((mult - 1) * 100);
  const multStr = (pct === 0 ? '×1.0 (база)' : `×${mult.toFixed(2)} (${pct > 0 ? '+' : ''}${pct}%)`);
  const resBonusStr = mm.resBonus ? ` · из них +${Math.round(mm.resBonus * 100)}% от изученных технологий` : '';

  return `<div class="fm-mining">
    <div style="display:flex;flex-wrap:wrap;gap:8px 18px;padding:10px 14px;border:1px solid var(--w2,#2a3340);border-radius:8px;background:var(--b3,#0f141b);margin-bottom:14px;font-size:12px;color:var(--t3,#8aa0b0)">
      <span>Множитель добычи: <b style="color:var(--gdl,#5fb0e6)">${multStr}</b>${resBonusStr}</span>
      <span>Заводов: <b style="color:var(--t1,#e8edf2)">${mineBlds}</b>${idleMineBlds ? ` <span style="color:var(--color-warning,#e0a030)">(${idleMineBlds} простаивает)</span>` : ''}</span>
      <span>Слотов добычи: <b style="color:var(--t1,#e8edf2)">${usedSlots}/${totalSlots}</b></span>
      <span>Всего/сутки: <b style="color:var(--gdl,#5fb0e6)">+${adNum(grandTotal)}</b> ед.</span>
    </div>

    <div class="fm-section-title">Итоговая добыча по ресурсам / сутки</div>
    <div style="border:1px solid var(--w2,#2a3340);border-radius:8px;padding:4px 12px;background:var(--b2,#141a22);margin-bottom:16px">${sumRows}</div>

    <div class="fm-section-title">Разбор по колониям и заводам</div>
    ${colBlocks || `<div class="fm-empty">Нет добывающих заводов ни в одной колонии.</div>`}
    <div class="fm-dim" style="font-size:11px;margin-top:10px">Расчёт зеркалит живое начисление (economy_accrue): редкость × богатство месторождения × множитель доктрины/технологий. Режим «💱 Экспорт» — поток продаётся за ГС и не копится на складе; «📦 На склад» — копится до лимита ёмкости.</div>
  </div>`;
}

// ── Вкладка: Караваны ───────────────────────────────────────────
// Детальный разбор торговых путей фракции: состав груза, направление,
// партнёр, объём/цена/доход, конвой и угрозы, назначенные корабли, сроки.
// Поля — зеркало trade_routes (_economy_setup.sql + _trade_multi/_trade_speed/_trade_ship_assign).

function adSysName(id) {
  if (!id) return '—';
  const s = (AD.systems || []).find(x => x.id === id);
  return s ? s.name : id;
}
function adShipName(unitId) {
  const d = (AD.designs || []).find(x => x.id === unitId);
  return d ? d.name : unitId;
}
function adFmtTs(ts) {
  if (!ts) return '—';
  const dt = new Date(ts);
  if (isNaN(dt)) return '—';
  return `${dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}
// Состав груза маршрута: мультигруз cargo[{res,vol}] или легаси resource/volume.
function adRouteCargoRows(r) {
  const cargo = Array.isArray(r.cargo) && r.cargo.length
    ? r.cargo.map(ci => ({ res: ci.res, vol: +ci.vol || 0 }))
    : (r.resource ? [{ res: r.resource, vol: +r.volume || 0 }] : []);
  if (!cargo.length) return `<div class="fm-empty" style="padding:4px 0;font-size:11px">Состав груза не указан</div>`;
  return cargo.map(ci => {
    const info = AD.resInfo[ci.res] || {};
    const price = (typeof ecResPriceN === 'function') ? ecResPriceN(ci.res) : (r.price || 0);
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--w1,#1e2630)">
      <span style="font-size:15px;width:20px;text-align:center">${esc(info.icon || '◈')}</span>
      <span style="flex:1;min-width:90px;font-size:13px;color:var(--t1,#e8edf2)">${esc(ci.res || '?')}</span>
      <span class="fm-rarity fm-rarity-${info.r || 'common'}" style="font-size:10px;min-width:54px">${AD_RARITY_LABEL[info.r] || info.r || 'common'}</span>
      <span style="font-family:monospace;font-size:12px;color:var(--t2,#c0ccd6);min-width:90px;text-align:right" title="Объём/ход">×${adNum(ci.vol)}/ход</span>
      <span style="font-family:monospace;font-size:11px;color:var(--t4,#6a7a88);min-width:70px;text-align:right" title="Цена за ед.">${adNum(price)}/ед.</span>
    </div>`;
  }).join('');
}

function adCaravanCard(r, e, m) {
  const isOut = r.a_fid === AD.sel;
  const partnerFid = isOut ? r.b_fid : r.a_fid;
  const partnerName = isOut ? (r.b_name || (AD.byFid.get(partnerFid)?.app.name) || partnerFid) : (r.a_name || (AD.byFid.get(partnerFid)?.app.name) || partnerFid);
  const value = (r.volume || 0) * (r.price || 0);
  const income = isOut ? Math.round(value * (m.gc || 1)) : Math.round(value * 0.5);

  // статус / транзит
  const transitMs = r.transit_until ? new Date(r.transit_until).getTime() - Date.now() : 0;
  const inTransit = r.status === 'active' && transitMs > 0;
  let badge;
  if (r.status === 'pending')      badge = `<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:color-mix(in srgb,var(--color-warning,#e0a030) 22%,transparent);color:var(--color-warning,#e0a030)">⏳ на согласовании</span>`;
  else if (r.status === 'declined')badge = `<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:var(--w1,#1e2630);color:#ff7a7a">✕ отклонён</span>`;
  else if (r.status === 'closed')  badge = `<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:var(--w1,#1e2630);color:var(--t4,#6a7a88)">⛔ закрыт</span>`;
  else if (inTransit)              badge = `<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:color-mix(in srgb,var(--gd,#3a7fbf) 20%,transparent);color:var(--gdl,#5fb0e6)">🚀 в пути</span>`;
  else                             badge = `<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:color-mix(in srgb,var(--ok,#52c41a) 20%,transparent);color:var(--ok,#52c41a)">✓ активен</span>`;

  const dirLabel = isOut
    ? `<span style="color:var(--gdl,#5fb0e6)">↗ Исходящий</span> · продаём → <b>${esc(partnerName)}</b>`
    : `<span style="color:var(--te,#3ec0d0)">↘ Входящий</span> · получаем ← <b>${esc(partnerName)}</b>`;

  // конвой / угрозы
  const threats = Array.isArray(r.threats) ? r.threats : [];
  const riskPct = (typeof ecTradeRiskPct === 'function') ? ecTradeRiskPct(threats, r.convoy) : 0;
  const threatTxt = threats.length
    ? threats.map(t => t.type === 'ancient' ? '👁 древние' : '🏴‍☠ пираты').join(', ')
    : 'чисто';
  const riskColor = riskPct >= 60 ? '#ff7a7a' : riskPct >= 30 ? 'var(--color-warning,#e0a030)' : 'var(--ok,#52c41a)';

  // корабли
  const ships = (r.ships && typeof r.ships === 'object') ? r.ships : {};
  const shipEntries = Object.keys(ships).filter(k => (+ships[k] || 0) > 0);
  const shipTxt = shipEntries.length
    ? shipEntries.map(id => `${esc(adShipName(id))} ×${adNum(ships[id])}`).join(', ')
    : '<span style="color:var(--t4,#6a7a88)">не назначены</span>';

  const srow = (k, v) => `<div style="display:flex;gap:8px;font-size:11px;padding:2px 0"><span style="color:var(--t3,#8aa0b0);min-width:118px">${k}</span><span style="color:var(--t1,#e8edf2);flex:1">${v}</span></div>`;

  return `<div style="border:1px solid var(--w2,#2a3340);border-radius:9px;padding:12px 14px;margin-bottom:10px;background:var(--b3,#0f141b)">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <span style="font-size:13px;font-weight:600;color:var(--t1,#e8edf2)">${dirLabel}</span>
      ${badge}
      <span style="margin-left:auto;font-family:monospace;font-size:14px;color:${isOut ? 'var(--gd,#3a7fbf)' : 'var(--te,#3ec0d0)'}" title="${isOut ? 'Доход продавца (×доктрина)' : 'Доля получателя 50%'}">+${adNum(income)} ГС/ход</span>
    </div>
    <div style="margin-bottom:8px">${adRouteCargoRows(r)}</div>
    ${srow('🌐 Маршрут', `${esc(adSysName(r.origin_sys))} <span style="color:var(--t4,#6a7a88)">→</span> ${esc(adSysName(r.dest_sys))}`)}
    ${srow('📦 Оборот/ход', `${adNum(r.volume || 0)} ед. × ${adNum(r.price || 0)} ГС = <b>${adNum(value)}</b> ГС вал.`)}
    ${srow('🛡 Конвой / риск', `${r.convoy ? `${adNum(r.convoy)} кор. охраны` : 'без охраны'} · угрозы: ${threatTxt} · <span style="color:${riskColor}">риск грабежа ${riskPct}%/ход</span>`)}
    ${srow('🚀 Грузовые', shipTxt)}
    ${srow('🕓 Создан', adFmtTs(r.created_at) + (inTransit ? ` · прибудет ${adFmtTs(r.transit_until)}` : ''))}
  </div>`;
}

function adTabCaravans(e) {
  const m = (typeof ecFactionMods === 'function') ? ecFactionMods(e.app || {}) : { gc: 1 };
  const routes = e.routes || [];
  if (!routes.length) return `<div class="fm-caravans"><div class="fm-empty">У фракции нет ни одного торгового пути.</div></div>`;

  const rank = { active: 0, pending: 1, closed: 2, declined: 3 };
  const sorted = [...routes].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || (new Date(b.created_at) - new Date(a.created_at)));

  const active  = sorted.filter(r => r.status === 'active');
  const pending = sorted.filter(r => r.status === 'pending');
  const archived = sorted.filter(r => r.status === 'closed' || r.status === 'declined');

  const out = active.filter(r => r.a_fid === AD.sel);
  const inn = active.filter(r => r.b_fid === AD.sel);
  const outGc = out.reduce((a, r) => a + Math.round((r.volume || 0) * (r.price || 0) * (m.gc || 1)), 0);
  const inGc  = inn.reduce((a, r) => a + Math.round((r.volume || 0) * (r.price || 0) * 0.5), 0);

  const block = (title, list) => list.length
    ? `<div class="fm-section-title">${title} (${list.length})</div>${list.map(r => adCaravanCard(r, e, m)).join('')}`
    : '';

  return `<div class="fm-caravans">
    <div style="display:flex;flex-wrap:wrap;gap:8px 18px;padding:10px 14px;border:1px solid var(--w2,#2a3340);border-radius:8px;background:var(--b3,#0f141b);margin-bottom:14px;font-size:12px;color:var(--t3,#8aa0b0)">
      <span>Активных путей: <b style="color:var(--t1,#e8edf2)">${active.length}</b></span>
      <span>↗ исходящих: <b style="color:var(--gdl,#5fb0e6)">${out.length}</b> · ↘ входящих: <b style="color:var(--te,#3ec0d0)">${inn.length}</b></span>
      <span>На согласовании: <b style="color:var(--color-warning,#e0a030)">${pending.length}</b></span>
      <span style="flex-basis:100%">Вал. доход активных: <b style="color:var(--gd,#3a7fbf)">+${adNum(outGc + inGc)} ГС/ход</b> <span style="font-size:10px;color:var(--t4,#6a7a88)">(до пиратов и экспортной добычи)</span></span>
    </div>
    ${block('✓ Активные', active)}
    ${block('⏳ На согласовании', pending)}
    ${archived.length ? `<div class="fm-section-title">📁 Архив (закрытые/отклонённые) (${archived.length})</div>${archived.slice(0, 12).map(r => adCaravanCard(r, e, m)).join('')}` : ''}
    <div class="fm-dim" style="font-size:11px;margin-top:6px">Доход исходящих = объём × цена × множитель доктрины; входящих — фиксированная доля получателя 50%. Фактический поток зависит от экспортной добычи на стороне продавца и срезается пиратами по риску.</div>
  </div>`;
}

// ── Вкладка: Технологии ─────────────────────────────────────────
function adTabResearch(e) {
  if (!e.eco) return `<div class="fm-no-eco">Экономика не инициализирована.</div>`;
  const done   = new Set(Array.isArray(e.eco.research) ? e.eco.research : []);
  const slots  = Array.isArray(e.eco.research_slots) ? e.eco.research_slots : [];
  const queue  = Array.isArray(e.eco.research_queue) ? e.eco.research_queue : [];
  const cat    = (typeof ecBuildResearch === 'function') ? ecBuildResearch() : [];
  const nameOf = id => (cat.find(n => n.id === id) || {}).name || id;

  const activeHtml = (slots.length || queue.length)
    ? `<div class="fm-cap">
        ${slots.map((s, i) => `⏳ Слот ${i + 1}: <b>${esc(nameOf(s.n))}</b>`).join(' · ') || '—'}
        ${queue.length ? ` · 🕓 в очереди: ${queue.map(id => esc(nameOf(id))).join(', ')}` : ''}
        <button class="btn btn-rd btn-xs" onclick="adClearActive()">Прервать всё</button>
      </div>` : '';

  const byCat = {};
  cat.forEach(n => { (byCat[n.catLabel] = byCat[n.catLabel] || []).push(n); });
  const nodes = Object.keys(byCat).map(cl => `
    <div class="fm-rs-cat">
      <div class="fm-rs-cat-t">${esc(cl)}</div>
      <div class="fm-rs-grid">
        ${byCat[cl].map(n => {
          const isDone = done.has(n.id);
          return `<div class="fm-rs-node${isDone ? ' done' : ''}">
            <div class="fm-rs-gp">${esc(n.group)}</div>
            <div class="fm-rs-name">${esc(n.name)}</div>
            <button class="btn ${isDone ? 'btn-rd' : 'btn-gd'} btn-xs" onclick="adToggleResearch(${adArg(n.id)})">
              ${isDone ? '✕ Отозвать' : '✓ Выдать'}
            </button>
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');

  return `<div class="fm-research">
    <div class="fm-actions-bar">
      <button class="btn btn-gd btn-sm" onclick="adGrantAllResearch()">✓ Выдать все</button>
      <button class="btn btn-rd btn-sm" onclick="adClearResearch()">✕ Сбросить все</button>
      <span class="fm-rs-count">${done.size} / ${cat.length} изучено</span>
    </div>
    ${activeHtml}
    ${nodes || '<div class="fm-empty">Каталог пуст (constructors.js не загружен)</div>'}
  </div>`;
}

async function adToggleResearch(nodeId) {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  AD.busy = true;
  try {
    const cur = Array.isArray(e.eco.research) ? [...e.eco.research] : [];
    const idx = cur.indexOf(nodeId);
    const nodes = typeof ecBuildResearch === 'function' ? ecBuildResearch() : [];
    const node = nodes.find(n => n.id === nodeId);
    if (idx >= 0) cur.splice(idx, 1); else cur.push(nodeId);
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { research: cur });
    e.eco.research = cur;
    adLogGrant({ type: 'research', id: nodeId, name: node?.name || nodeId, revoke: idx >= 0 });
    adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adGrantAllResearch() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  if (!confirm('Выдать все технологии фракции?')) return;
  const allNodes = (typeof ecBuildResearch === 'function' ? ecBuildResearch() : []).map(n => n.id);
  AD.busy = true;
  try {
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { research: allNodes });
    e.eco.research = allNodes;
    adLogGrant({ type: 'research_all', count: allNodes.length });
    toast('Все технологии выданы', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adClearResearch() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  if (!confirm('Сбросить все технологии?')) return;
  AD.busy = true;
  try {
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { research: [], research_active: null, research_ready: null, research_active2: null, research_ready2: null, research_slots: [], research_queue: [] });
    e.eco.research = []; e.eco.research_active = null; e.eco.research_ready = null; e.eco.research_slots = []; e.eco.research_queue = [];
    toast('Технологии сброшены', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adClearActive() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  AD.busy = true;
  try {
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { research_active: null, research_ready: null, research_active2: null, research_ready2: null, research_slots: [], research_queue: [] });
    e.eco.research_active = null; e.eco.research_ready = null; e.eco.research_slots = []; e.eco.research_queue = [];
    toast('Активные исследования и очередь прерваны', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Вкладка: Территория ─────────────────────────────────────────
function adTabTerritory(e) {
  const myFid = AD.sel;
  const q = (AD.sysSearch || '').toLowerCase();

  const facName = fid => {
    if (!fid) return 'нейтральная';
    const entry = AD.byFid.get(fid);
    return entry ? entry.app.name : fid;
  };

  const capId = e.app && e.app.system_id;
  const sysRow = (s, isOwn) => `<div class="fm-sys-row">
    <span class="fm-sys-name">${capId === s.id ? '★ ' : ''}${esc(s.name || s.id)}</span>
    <span class="fm-sys-owner ${s.faction ? (isOwn ? 'mine' : 'other') : 'neutral'}">${esc(facName(s.faction))}</span>
    <span class="fm-sys-acts">
      ${!isOwn ? `<button class="btn btn-gd btn-xs" onclick="adGrantSystem(${adArg(s.id)})">→ Взять</button>` : ''}
      ${capId === s.id ? '<span class="fm-dim" style="font-size:10px;white-space:nowrap">★ столица</span>' : `<button class="btn btn-gh btn-xs" onclick="adSetCapital(${adArg(s.id)})" title="Сделать столицей: пометит на карте ★ и перенесёт сюда все колонии">★ Столица</button>`}
      ${s.faction ? `<button class="btn btn-rd btn-xs" onclick="adReleaseSystem(${adArg(s.id)})">✕ Освободить</button>` : ''}
    </span>
  </div>`;

  const mySystems = e.systems;
  const myRows = mySystems.map(s => sysRow(s, true)).join('') || `<div class="fm-empty">Нет систем</div>`;

  let searchHtml;
  if (q.length >= 2) {
    const results = AD.systems.filter(s => s.faction !== myFid && (s.name || '').toLowerCase().includes(q)).slice(0, 60);
    searchHtml = results.length ? results.map(s => sysRow(s, false)).join('') : `<div class="fm-empty">Ничего не найдено</div>`;
  } else {
    searchHtml = `<div class="fm-hint">Введите ≥ 2 символа для поиска по всем системам</div>`;
  }

  return `<div class="fm-territory">
    <div class="fm-sys-stats">
      <span>У фракции: <b>${mySystems.length}</b> систем</span>
      <span>Всего систем: <b>${AD.systems.length}</b></span>
    </div>
    <div class="fm-section-title">Системы фракции</div>
    <div class="fm-sys-list">${myRows}</div>
    <div class="fm-section-title" style="margin-top:16px">Найти и добавить систему</div>
    <input class="fi" id="fm-sys-q" placeholder="Поиск по названию..." value="${esc(AD.sysSearch || '')}"
      oninput="AD.sysSearch=this.value;adPaint()" style="width:100%;margin-bottom:8px">
    <div class="fm-sys-list">${searchHtml}</div>
  </div>`;
}

// Сделать систему СТОЛИЦЕЙ фракции: анкета (для маркера ★ и спавна) + карта + перенос колоний
async function adSetCapital(sysId) {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e) return;
  const sys = (AD.systems || []).find(s => s.id === sysId);
  if (!confirm(`Сделать «${sys ? sys.name : sysId}» столицей фракции?\nСистема пометится столицей ★ на карте, закрепится за фракцией, и все ${e.colonies.length} колоний переедут сюда.`)) return;
  AD.busy = true;
  try {
    const fenc = encodeURIComponent(AD.sel);
    // столичная колония-источник истины (бывшая столица, иначе первая)
    const capCol = e.colonies.find(c => c.is_capital) || e.colonies[0];
    await dbPatch('faction_applications', `faction_id=eq.${fenc}&status=eq.approved`, { system_id: sysId });
    await dbPatch('map_systems', `id=eq.${encodeURIComponent(sysId)}`, { faction: AD.sel });
    if (e.colonies.length) await dbPatch('colonies', `faction_id=eq.${fenc}`, { system_id: sysId });
    // единый источник истины: ровно одна столица (is_capital) в новой системе
    await dbPatch('colonies', `faction_id=eq.${fenc}`, { is_capital: false });
    if (capCol) await dbPatch('colonies', `id=eq.${encodeURIComponent(capCol.id)}`, { is_capital: true });
    // локально
    if (e.app) e.app.system_id = sysId;
    e.colonies.forEach(c => { c.system_id = sysId; c.is_capital = !!(capCol && c.id === capCol.id); });
    AD.colonies.forEach(c => { if (c.faction_id === AD.sel) c.system_id = sysId; });
    if (sys) { sys.faction = AD.sel; if (!e.systems.find(x => x.id === sysId)) e.systems.push(sys); }
    toast('Столица перенесена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adGrantSystem(sysId) {
  if (!AD.sel || AD.busy) return;
  AD.busy = true;
  try {
    await dbPatch('map_systems', `id=eq.${encodeURIComponent(sysId)}`, { faction: AD.sel });
    const sys = AD.systems.find(s => s.id === sysId);
    if (sys) {
      const prevFid = sys.faction;
      sys.faction = AD.sel;
      if (prevFid) { const pe = AD.byFid.get(prevFid); if (pe) pe.systems = pe.systems.filter(s => s.id !== sysId); }
      const me = adEntry(AD.sel); if (me && !me.systems.find(s => s.id === sysId)) me.systems.push(sys);
    }
    adLogGrant({ type: 'system', id: sysId, name: sys?.name || sysId });
    toast('Система передана фракции', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adReleaseSystem(sysId) {
  if (AD.busy) return;
  AD.busy = true;
  try {
    await dbPatch('map_systems', `id=eq.${encodeURIComponent(sysId)}`, { faction: null });
    const sys = AD.systems.find(s => s.id === sysId);
    if (sys) {
      const prevFid = sys.faction; sys.faction = null;
      if (prevFid) {
        const pe = AD.byFid.get(prevFid);
        if (pe) {
          pe.systems = pe.systems.filter(s => s.id !== sysId);
          // если эта система была столицей — снимаем метку столицы
          if (pe.app && pe.app.system_id === sysId) {
            await dbPatch('faction_applications', `faction_id=eq.${encodeURIComponent(prevFid)}&status=eq.approved`, { system_id: null });
            pe.app.system_id = null;
          }
        }
      }
    }
    toast('Система освобождена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Вкладка: Колонии ────────────────────────────────────────────
function adTabColonies(e) {
  const cols = e.colonies;
  const EC_ORDER_LOCAL  = (typeof EC_ORDER  !== 'undefined') ? EC_ORDER  : ['factory','mining','trade','science','training','intel','military_factory','shipyard'];
  const EC_BUILD_LOCAL  = (typeof EC_BUILD  !== 'undefined') ? EC_BUILD  : {};

  const colCards = cols.map(c => {
    const blds = e.buildings.filter(b => b.colony_id === c.id);
    const used = blds.length, cap = c.cells || 6, full = used >= cap;
    const sys = AD.systems.find(s => s.id === c.system_id);

    const bldRows = blds.map(b => {
      const d = EC_BUILD_LOCAL[b.btype];
      return `<div class="fm-bld-row">
        <span class="fm-bld-name">${d ? esc(d.name) : esc(b.btype)}</span>
        <span class="fm-bld-slots">
          <button class="btn btn-gh btn-xs" onclick="adSetSlots(${adArg(b.id)},${Math.max(1,b.slots_open-1)})" ${b.slots_open<=1?'disabled':''}>−</button>
          <span class="fm-slot-val">${b.slots_open}/6</span>
          <button class="btn btn-gh btn-xs" onclick="adSetSlots(${adArg(b.id)},${Math.min(6,b.slots_open+1)})" ${b.slots_open>=6?'disabled':''}>+</button>
        </span>
        <button class="btn btn-rd btn-xs" onclick="adRemoveBuilding(${adArg(b.id)})">✕</button>
      </div>`;
    }).join('') || `<div class="fm-empty" style="padding:4px 0;font-size:11px">Пусто</div>`;

    const bldOpts = EC_ORDER_LOCAL.map(t => { const d = EC_BUILD_LOCAL[t]; return `<option value="${t}">${d ? esc(d.name) : t}</option>`; }).join('');
    return `<div class="fm-col-card">
      <div class="fm-col-hd">
        <div>
          <span class="fm-col-name">${esc(c.planet_name)}</span>
          <span class="fm-col-sys">${esc(sys ? sys.name : (c.system_id || '?'))}</span>
          <span class="fm-col-type">${esc(c.planet_type || '')}</span>
        </div>
        <span class="fm-col-cells${full ? ' full' : ''}">${used}/${cap} ⬚</span>
      </div>
      <div class="fm-bld-list">${bldRows}</div>
      <div class="fm-col-foot">
        <select id="fm-bsel-${c.id}" class="fi" style="flex:1">${bldOpts}</select>
        <button class="btn btn-gh btn-sm" ${full ? 'disabled' : ''} onclick="adAddBuilding(${adArg(c.id)})">+ Постройка</button>
        <button class="btn btn-rd btn-sm" onclick="adRemoveColony(${adArg(c.id)})">✕ Колонию</button>
      </div>
    </div>`;
  }).join('') || `<div class="fm-empty">Нет колоний</div>`;

  const sysOpts = e.systems.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  // системы, где реально лежат колонии (для информации о рассинхроне)
  const colSysIds = [...new Set(e.colonies.map(c => c.system_id))];
  const ownIds = new Set(e.systems.map(s => s.id));
  const orphanSys = colSysIds.filter(id => !ownIds.has(id));
  const orphanNote = orphanSys.length
    ? `<div class="fm-empty" style="color:var(--color-warning,#e0a030);padding:8px 0">⚠ Часть колоний в системах, которыми фракция не владеет (рассинхрон спавна/переезда). Перенесите их в свою систему ниже.</div>` : '';
  return `<div class="fm-colonies">
    <div class="fm-cols-grid">${colCards}</div>
    <div class="fm-section-title" style="margin-top:16px">⇄ Перенести ВСЕ колонии фракции в систему</div>
    ${orphanNote}
    <div class="fm-col-form">
      <select class="fi" id="fm-move-sys" style="min-width:150px">${sysOpts || '<option value="">Нет систем у фракции</option>'}</select>
      <button class="btn btn-gh btn-sm" onclick="adMoveColonies()">⇄ Перенести все (${e.colonies.length})</button>
      <span class="fm-dim" style="font-size:11px">постройки и доход сохранятся, имена колоний останутся</span>
    </div>
    <div class="fm-section-title" style="margin-top:16px">+ Добавить колонию</div>
    <div class="fm-col-form">
      <select class="fi" id="fm-col-sys" style="min-width:130px">${sysOpts || '<option value="">Нет систем</option>'}</select>
      <input class="fi" id="fm-col-pname" placeholder="Планета" style="flex:1">
      <input class="fi" id="fm-col-ptype" placeholder="Тип" value="Столичный мир" style="flex:1">
      <input class="fi" id="fm-col-cells" type="number" value="6" min="1" max="12" style="width:60px">
      <button class="btn btn-gd btn-sm" onclick="adAddColony()">+ Добавить</button>
    </div>
  </div>`;
}

async function adMoveColonies() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e) return;
  const sysId = document.getElementById('fm-move-sys')?.value;
  if (!sysId) { toast('Выберите систему', 'err'); return; }
  if (!e.colonies.length) { toast('У фракции нет колоний', 'inf'); return; }
  const sys = e.systems.find(s => s.id === sysId) || (AD.systems || []).find(s => s.id === sysId);
  if (!confirm(`Перенести все ${e.colonies.length} колоний фракции в систему «${sys ? sys.name : sysId}»? Постройки и доход сохранятся.`)) return;
  AD.busy = true;
  try {
    await dbPatch('colonies', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { system_id: sysId });
    e.colonies.forEach(c => { c.system_id = sysId; });
    AD.colonies.forEach(c => { if (c.faction_id === AD.sel) c.system_id = sysId; });
    toast('Колонии перенесены в систему', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adAddColony() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e) return;
  const sysId  = document.getElementById('fm-col-sys')?.value;
  const pName  = (document.getElementById('fm-col-pname')?.value || '').trim();
  const pType  = (document.getElementById('fm-col-ptype')?.value || '').trim();
  const cells  = Math.max(1, parseInt(document.getElementById('fm-col-cells')?.value) || 6);
  if (!sysId || !pName) { toast('Укажите систему и название планеты', 'err'); return; }
  const ownerId    = (e.eco?.owner_id) || e.app?.owner_id;
  const ownerEmail = (e.eco?.owner_email) || e.app?.owner_email;
  // Snapshot planet resources if the planet exists in map data
  const sys = AD.systems.find(s => s.id === sysId);
  const planet = sys && (sys.planets || []).find(p => p.name === pName);
  const resources = planet && Array.isArray(planet.resources) ? planet.resources.map(r => ({ name: r.name, icon: r.icon, r: r.r })) : [];
  // pid с карты (если планета существует) — связь колонии с конкретной планетой, а не с именем
  const pPid = planet && Number.isInteger(planet.pid) ? planet.pid : null;
  AD.busy = true;
  try {
    const rows = await dbPost('colonies', { faction_id: AD.sel, owner_id: ownerId, system_id: sysId, planet_name: pName, planet_pid: pPid, planet_type: pType, cells, terraformed: false, resources });
    if (rows?.[0]) { e.colonies.push(rows[0]); AD.colonies.push(rows[0]); }
    adLogGrant({ type: 'colony', name: pName, system: sys?.name || sysId, cells });
    toast('Колония добавлена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adRemoveColony(colId) {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Удалить колонию и все постройки?')) return;
  AD.busy = true;
  try {
    await dbDel('colony_buildings', `colony_id=eq.${colId}`);
    await dbDel('colonies', `id=eq.${colId}`);
    const e = adEntry(AD.sel);
    if (e) { e.buildings = e.buildings.filter(b => b.colony_id !== colId); e.colonies = e.colonies.filter(c => c.id !== colId); }
    AD.buildings = AD.buildings.filter(b => b.colony_id !== colId);
    AD.colonies  = AD.colonies.filter(c => c.id !== colId);
    toast('Колония удалена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adAddBuilding(colId) {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e) return;
  const btype = document.getElementById('fm-bsel-' + colId)?.value; if (!btype) return;
  const d = (typeof EC_BUILD !== 'undefined') ? EC_BUILD[btype] : null;
  const ownerId = (e.eco?.owner_id) || e.app?.owner_id;
  AD.busy = true;
  try {
    const rows = await dbPost('colony_buildings', { colony_id: colId, faction_id: AD.sel, owner_id: ownerId, btype, slots_open: d?.free || 1, tnp_mode: false });
    if (rows?.[0]) { e.buildings.push(rows[0]); AD.buildings.push(rows[0]); }
    adLogGrant({ type: 'building', name: d?.name || btype, btype });
    toast('Постройка добавлена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adRemoveBuilding(bldId) {
  if (!AD.sel || AD.busy) return;
  AD.busy = true;
  try {
    await dbDel('colony_buildings', `id=eq.${bldId}`);
    const e = adEntry(AD.sel);
    if (e) e.buildings = e.buildings.filter(b => b.id !== bldId);
    AD.buildings = AD.buildings.filter(b => b.id !== bldId);
    toast('Постройка снесена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adSetSlots(bldId, n) {
  if (!AD.sel || AD.busy) return;
  AD.busy = true;
  try {
    await dbPatch('colony_buildings', `id=eq.${bldId}`, { slots_open: n });
    const bld = AD.buildings.find(b => b.id === bldId); if (bld) bld.slots_open = n;
    toast('Слоты: ' + n, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Вкладка: Армия ──────────────────────────────────────────────
function adTabArmy(e) {
  const roster = e.roster;
  const rosterRows = roster.length
    ? roster.map(p => `<div class="fm-unit-row">
        <span class="fm-unit-cat">${esc(p.category || '')}</span>
        <span class="fm-unit-name">${esc(p.unit_name || '—')}</span>
        <span class="fm-unit-qty">×${p.qty || 1}</span>
        <button class="btn btn-rd btn-xs" onclick="adRemoveUnit(${adArg(p.id)})">✕</button>
      </div>`).join('')
    : `<div class="fm-empty">Нет юнитов в ростере</div>`;

  // Faction designs + stock (null faction_id)
  const allDesigns = AD.designs.filter(d => d.faction_id === AD.sel || !d.faction_id);
  const catOrder = ['ship', 'ground', 'aviation', 'division'];
  const bycat = {}; allDesigns.forEach(d => { (bycat[d.category] = bycat[d.category] || []).push(d); });
  const designOptGroups = catOrder.filter(c => bycat[c]).map(c =>
    `<optgroup label="${esc(c)}">${bycat[c].map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</optgroup>`
  ).join('');

  return `<div class="fm-army">
    <div class="fm-section-title">Ростер — готовые юниты</div>
    <div class="fm-unit-list">${rosterRows}</div>
    <div class="fm-section-title" style="margin-top:16px">Выдать юниты</div>
    <div class="fm-field-row" style="flex-wrap:wrap">
      <select class="fi" id="fm-unit-sel" style="flex:2;min-width:160px">
        ${designOptGroups || '<option value="">Нет дизайнов</option>'}
      </select>
      <input class="fi" id="fm-unit-qty" type="number" value="1" min="1" max="999" style="width:72px" placeholder="Кол-во">
      <button class="btn btn-gd btn-sm" onclick="adGrantUnit()">✓ Выдать</button>
    </div>
  </div>`;
}

async function adGrantUnit() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e) return;
  const unitId = document.getElementById('fm-unit-sel')?.value;
  if (!unitId) { toast('Выберите юнит', 'err'); return; }
  const design = AD.designs.find(d => d.id === unitId);
  if (!design) { toast('Дизайн не найден', 'err'); return; }
  const qty = Math.max(1, parseInt(document.getElementById('fm-unit-qty')?.value) || 1);
  const ownerId = (e.eco?.owner_id) || e.app?.owner_id;
  AD.busy = true;
  try {
    const now = new Date().toISOString();
    const rows = await dbPost('unit_production', {
      faction_id: AD.sel, owner_id: ownerId,
      unit_id: design.id, unit_name: design.name, category: design.category,
      line: design.category === 'ship' ? 'shipyard' : 'army',
      weight: 1, qty, status: 'done', ready_at: now
    });
    if (rows?.[0]) { e.roster.push(rows[0]); AD.prod.push(rows[0]); }
    adLogGrant({ type: 'unit', name: design.name, qty, category: design.category });
    toast(`Выдано: ${design.name} ×${qty}`, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adRemoveUnit(id) {
  if (!AD.sel || AD.busy) return;
  AD.busy = true;
  try {
    await dbDel('unit_production', `id=eq.${id}`);
    const e = adEntry(AD.sel); if (e) e.roster = e.roster.filter(p => p.id !== id);
    AD.prod = AD.prod.filter(p => p.id !== id);
    toast('Юнит удалён', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Вкладка: Агенты (выдача и кастомизация) ─────────────────────
const AD_PERKS = [
  ['infiltrator', '🕵 Инфильтратор'], ['saboteur', '💣 Диверсант'],
  ['ghost', '👻 Призрак'], ['analyst', '📊 Аналитик'], ['handler', '🛡 Куратор'],
];
const AD_FNAMES = ['Алекс','Марк','Юри','Дана','Лена','Ник','Ивар','Соня','Рэй','Тао','Мира','Кай','Лев','Зара','Орин','Вера'];
const AD_LNAMES = ['Восс','Кейн','Орлов','Драй','Морозов','Сато','Винтер','Холт','Рейес','Ким','Блэк','Норд','Грей','Фокс','Волков'];
function adPerkSelect(id, cur) {
  return `<select class="fi" id="${id}">${AD_PERKS.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
function adTabAgents(e) {
  if (e.agents == null) { adLoadAgents(AD.sel); return `<div class="fm-empty">Загрузка агентов…</div>`; }
  const rows = e.agents.length
    ? e.agents.map(a => {
        const training = a.ready_at && new Date(a.ready_at).getTime() > Date.now();
        return `<div class="fm-field-row" style="flex-wrap:wrap;gap:6px;align-items:center;border-bottom:1px solid var(--w2,#2a3340);padding:6px 0">
          <input class="fi" id="ag-fn-${a.id}" value="${esc(a.first_name || '')}" style="width:110px" placeholder="Имя">
          <input class="fi" id="ag-ln-${a.id}" value="${esc(a.last_name || '')}" style="width:110px" placeholder="Фамилия">
          ${adPerkSelect('ag-pk-' + a.id, a.perk)}
          ${training ? '<span class="fm-dim" style="font-size:10px">обучается</span>' : '<span class="fm-dim" style="font-size:10px;color:var(--ok,#5fc38a)">готов</span>'}
          <button class="btn btn-gd btn-xs" onclick="adSetAgent(${adArg(a.id)})" title="Сохранить">💾</button>
          <button class="btn btn-rd btn-xs" onclick="adRemoveAgent(${adArg(a.id)})" title="Удалить">✕</button>
        </div>`;
      }).join('')
    : `<div class="fm-empty">Нет агентов</div>`;
  return `<div class="fm-agents">
    <div class="fm-section-title">Агенты фракции (${e.agents.length})</div>
    <div>${rows}</div>
    <div class="fm-section-title" style="margin-top:16px">Выдать агента <span class="fm-dim" style="font-weight:400">— готов сразу, виден в кабинете фракции</span></div>
    <div class="fm-field-row" style="flex-wrap:wrap;gap:6px">
      <input class="fi" id="ag-new-fn" style="width:120px" placeholder="Имя">
      <input class="fi" id="ag-new-ln" style="width:120px" placeholder="Фамилия">
      ${adPerkSelect('ag-new-pk', 'infiltrator')}
      <button class="btn btn-gh btn-sm" onclick="adAgentRandom()">🎲 Случайно</button>
      <button class="btn btn-gd btn-sm" onclick="adGrantAgent()">✓ Выдать</button>
    </div>
  </div>`;
}
async function adLoadAgents(fid) {
  try {
    const rows = await dbGet('spy_agents', `faction_id=eq.${fid}&order=hired_at.asc`);
    const e = adEntry(fid); if (e) e.agents = rows || [];
  } catch (ex) { const e = adEntry(fid); if (e) e.agents = []; toast('Ошибка загрузки агентов: ' + ex.message, 'err'); }
  adPaint();
}
function adAgentRandom() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('ag-new-fn', AD_FNAMES[Math.floor(Math.random() * AD_FNAMES.length)]);
  set('ag-new-ln', AD_LNAMES[Math.floor(Math.random() * AD_LNAMES.length)]);
  set('ag-new-pk', AD_PERKS[Math.floor(Math.random() * AD_PERKS.length)][0]);
}
async function adGrantAgent() {
  if (!AD.sel || AD.busy) return;
  const first = document.getElementById('ag-new-fn')?.value || '';
  const last = document.getElementById('ag-new-ln')?.value || '';
  const perk = document.getElementById('ag-new-pk')?.value || 'infiltrator';
  AD.busy = true;
  try {
    await apiFetch('rpc/admin_grant_agent', { method: 'POST', body: JSON.stringify({ p_fid: AD.sel, p_first: first, p_last: last, p_perk: perk }) });
    const e = adEntry(AD.sel); if (e) e.agents = null;
    adLogGrant({ type: 'agent', first, last, perk });
    toast('Агент выдан', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}
async function adSetAgent(id) {
  if (AD.busy) return;
  const first = document.getElementById('ag-fn-' + id)?.value || '';
  const last = document.getElementById('ag-ln-' + id)?.value || '';
  const perk = document.getElementById('ag-pk-' + id)?.value || null;
  AD.busy = true;
  try {
    await apiFetch('rpc/admin_set_agent', { method: 'POST', body: JSON.stringify({ p_id: id, p_first: first, p_last: last, p_perk: perk }) });
    const e = adEntry(AD.sel); if (e) e.agents = null;
    toast('Сохранено', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}
async function adRemoveAgent(id) {
  if (AD.busy) return;
  if (!confirm('Удалить агента?')) return;
  AD.busy = true;
  try {
    await apiFetch('rpc/admin_remove_agent', { method: 'POST', body: JSON.stringify({ p_id: id }) });
    const e = adEntry(AD.sel); if (e) e.agents = null;
    toast('Агент удалён', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Вкладка: Владелец (вход в кабинет / снятие / передача) ──────
// Три независимые функции (_admin_transfer.sql + impersonation в economy.js):
//   • Войти в кабинет игрока — стафф видит фракцию глазами владельца (без снятия).
//   • Снять игрока — государство остаётся, но становится бесхозным.
//   • Передать другому игроку — постоянная смена владельца во всех таблицах.
// ── Вкладка: Журнал действий игрока ─────────────────────────────
// Серверный аудит (таблица faction_audit, заполняется триггерами БД —
// см. _admin_action_log.sql). Ловит всё, что пишется в игровые таблицы,
// даже правки напрямую через консоль. Грузится лениво по выбранной фракции.
const AD_AUDIT_CATS = [
  ['all',     '🗂 Все'],
  ['colony',  '🏗 Колонии'],
  ['building','🧱 Постройки'],
  ['unit',    '⚔ Юниты'],
  ['caravan', '🚚 Караваны'],
  ['trade',   '🔁 Бартер'],
  ['exchange','📈 Биржа'],
  ['finance', '🏦 Займы'],
  ['spy',     '🕵 Шпионаж'],
  ['diplo',   '🤝 Дипломатия'],
  ['faith',   '🕊 Вера'],
  ['defense', '🛡 Оборона'],
  ['design',  '🛠 Проекты'],
  ['research','🔬 Наука'],
  ['economy', '💰 Экономика'],
  ['news',    '📰 Новости'],
];
const AD_AUDIT_CAT_ICON = { colony:'🏗', building:'🧱', unit:'⚔', caravan:'🚚', trade:'🔁', exchange:'📈', finance:'🏦', spy:'🕵', diplo:'🤝', faith:'🕊', defense:'🛡', design:'🛠', research:'🔬', economy:'💰', news:'📰' };

function adTabJournal(e) {
  const fid = AD.sel;
  const st  = AD.audit[fid];
  if (!st) { adLoadAudit(fid); return `<div class="fm-empty">Загрузка журнала…</div>`; }
  if (st.loading) return `<div class="fm-empty">Загрузка журнала…</div>`;
  if (st.err) {
    return `<div style="color:var(--color-warning,#e0a030);padding:10px 12px;border:1px solid var(--w2,#2a3340);border-radius:8px;line-height:1.5">
      Журнал недоступен: ${esc(st.err)}<br>
      <span style="font-size:12px;color:var(--t3,#8aa0b0)">Похоже, не применён срез <code>_admin_action_log.sql</code> в Supabase (таблица <code>faction_audit</code>). Примените его в SQL Editor — журнал заполнится из реальной истории и начнёт писать новые действия.</span>
      <div style="margin-top:8px"><button class="btn btn-gd btn-sm" onclick="adReloadAudit()">↻ Повторить</button></div>
    </div>`;
  }

  const rows = st.rows || [];
  if (!rows.length) return `<div class="fm-empty">Журнал пуст — действий за этой фракцией пока не записано.<div style="margin-top:8px"><button class="btn btn-gh btn-sm" onclick="adReloadAudit()">↻ Обновить</button></div></div>`;

  const counts = {};
  rows.forEach(r => { counts[r.category] = (counts[r.category] || 0) + 1; });
  const cat = AD.auditCat || 'all';
  const filterBtns = AD_AUDIT_CATS
    .filter(([id]) => id === 'all' || counts[id])
    .map(([id, lbl]) => {
      const n = id === 'all' ? rows.length : (counts[id] || 0);
      return `<button class="fm-stab${cat === id ? ' on' : ''}" style="font-size:11px;padding:4px 9px" onclick="adAuditFilter('${id}')">${lbl} <span style="opacity:.6">${n}</span></button>`;
    }).join('');

  const shown = cat === 'all' ? rows : rows.filter(r => r.category === cat);

  const itemHtml = r => {
    const icon = AD_AUDIT_CAT_ICON[r.category] || '•';
    const actorBadge = r.is_staff
      ? `<span title="${esc(r.actor_email || 'админ')}" style="font-size:9px;font-weight:700;letter-spacing:.06em;color:var(--color-warning,#e0a030);border:1px solid color-mix(in srgb,var(--color-warning,#e0a030) 50%,transparent);border-radius:4px;padding:1px 5px;white-space:nowrap">АДМИН</span>`
      : (r.actor_email
          ? `<span title="${esc(r.actor_email)}" style="font-size:9px;color:var(--te,#3ec0d0);white-space:nowrap">игрок</span>`
          : `<span title="фон/крон" style="font-size:9px;color:var(--t4,#6a7a88);white-space:nowrap">⚙ авто</span>`);
    const actColor = r.action === 'delete' ? 'var(--err,#ff7a7a)' : r.action === 'insert' ? 'var(--gdl,#5fb0e6)' : 'var(--t3,#8aa0b0)';
    return `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-bottom:1px solid var(--w2,#2a3340)">
      <span style="font-size:15px;line-height:1.3;width:20px;text-align:center;flex:0 0 auto">${icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--t1,#e8edf2);line-height:1.4">${esc(r.summary || r.action || '—')}</div>
        <div style="font-size:10px;color:var(--t4,#6a7a88);font-family:monospace;margin-top:2px">${adFmtTs(r.ts)} · <span style="color:${actColor}">${esc(r.action || '')}</span></div>
      </div>
      <div style="flex:0 0 auto;align-self:center">${actorBadge}</div>
    </div>`;
  };

  return `<div class="fm-journal">
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;align-items:center">
      ${filterBtns}
      <button class="btn btn-gh btn-xs" style="margin-left:auto" onclick="adReloadAudit()">↻ Обновить</button>
    </div>
    <div style="font-size:11px;color:var(--t4,#6a7a88);margin-bottom:8px">Показано ${shown.length} из ${rows.length} записей (последние ${rows.length}). Журнал ведётся на сервере и фиксирует все изменения игровых данных фракции — даже правки админа из этой консоли (метка <b style="color:var(--color-warning,#e0a030)">АДМИН</b>).</div>
    <div style="border:1px solid var(--w2,#2a3340);border-radius:8px;background:var(--b3,#0f141b);overflow:hidden">
      ${shown.map(itemHtml).join('') || '<div class="fm-empty" style="padding:14px">В этой категории записей нет.</div>'}
    </div>
  </div>`;
}

async function adLoadAudit(fid) {
  if (!fid) return;
  if (AD.audit[fid] && AD.audit[fid].loading) return;
  AD.audit[fid] = { loading: true, rows: [], err: null };
  try {
    const rows = await dbGet('faction_audit', `faction_id=eq.${encodeURIComponent(fid)}&order=ts.desc&limit=400`);
    AD.audit[fid] = { loading: false, rows: Array.isArray(rows) ? rows : [], err: null };
  } catch (ex) {
    AD.audit[fid] = { loading: false, rows: [], err: ex.message || String(ex) };
  }
  if (AD.subtab === 'journal' && AD.sel === fid) { if (!adRenderSlot()) adPaint(); }
}
function adReloadAudit() { if (AD.sel) { delete AD.audit[AD.sel]; adLoadAudit(AD.sel); if (!adRenderSlot()) adPaint(); } }
function adAuditFilter(cat) { AD.auditCat = cat; if (!adRenderSlot()) adPaint(); }

function adTabOwner(e) {
  const hasOwner = !!(e.app.owner_id);
  const ownerLine = hasOwner
    ? `<b style="color:var(--t1,#e8edf2)">${esc(e.app.owner_email || '—')}</b> <span style="font-family:monospace;font-size:10px;color:var(--t4,#6a7a88)">${esc(e.app.owner_id)}</span>`
    : `<b style="color:var(--color-warning,#e0a030)">— бесхозное (нет владельца)</b>`;

  // выпадающий список игроков для передачи (лениво из admin_list_users)
  let assignPicker;
  if (AD.users == null) {
    adLoadUsers();
    assignPicker = `<div class="fm-empty">Загрузка списка игроков…</div>`;
  } else {
    // кандидаты: все аккаунты, кроме текущего владельца этой фракции;
    // помечаем тех, кто уже владеет одобренной фракцией (им передать нельзя)
    const opts = AD.users
      .filter(u => u.user_id !== e.app.owner_id)
      .map(u => {
        const busy = u.faction_status === 'approved' && u.faction_name;
        const tag = busy ? ` — занят: ${u.faction_name}` : (u.role && u.role !== 'viewer' ? ` (${u.role})` : '');
        return `<option value="${esc(u.user_id)}"${busy ? ' disabled' : ''}>${esc(u.email || u.user_id)}${esc(tag)}</option>`;
      }).join('');
    assignPicker = `<div class="fm-field-row" style="flex-wrap:wrap;gap:6px;align-items:center">
      <select class="fi" id="ad-assign-user" style="flex:2;min-width:240px">
        <option value="">— выберите игрока —</option>${opts}
      </select>
      <button class="btn btn-gd btn-sm" onclick="adAssignFaction()">↪ Передать государство</button>
    </div>`;
  }

  const row = (label, hint, btn) => `<div class="fm-danger-act" style="align-items:flex-start">
    <div class="fm-danger-label"><div>${label}</div>${hint ? `<div class="fm-dim" style="font-size:11px;margin-top:3px;font-weight:400;line-height:1.4">${hint}</div>` : ''}</div>${btn}</div>`;

  return `<div class="fm-danger">
    <div class="fm-danger-banner" style="background:rgba(95,176,230,.12);border-color:rgba(95,176,230,.4);color:var(--gdl,#5fb0e6)">👑 Управление владельцем государства. Сама страна (карта, экономика, колонии, армия) НЕ удаляется ни одной из этих операций.</div>
    <div style="padding:8px 0;font-size:12px;color:var(--t3,#8aa0b0)">Текущий владелец: ${ownerLine}</div>
    ${row('🔑 Войти в кабинет игрока', 'Открыть экономику и кабинет этой фракции глазами её владельца — для проверки и помощи. Игрок остаётся на месте, ничего не меняется.', `<button class="btn btn-gd" onclick="adEnterCabinet()">Войти в кабинет</button>`)}
    ${row('🚪 Снять игрока с государства', 'Государство остаётся целым, но становится бесхозным (без владельца). Бывший владелец освобождается и сможет подать новую анкету. Данные страны не трогаются.', `<button class="btn btn-rd" onclick="adVacateFaction()" ${hasOwner ? '' : 'disabled'}>Снять игрока</button>`)}
    <div style="margin-top:14px;border-top:1px solid var(--w2,#2a3340);padding-top:12px">
      <div class="fm-danger-label" style="margin-bottom:4px">↪ Передать государство другому игроку <span class="fm-dim" style="font-weight:400">— постоянная смена владельца</span></div>
      <div class="fm-dim" style="font-size:11px;margin-bottom:8px;line-height:1.4">Новый игрок получает полный контроль над страной (колонии, армия, экономика, дизайны) и роль «игрок». Прежний владелец (если есть) освобождается. Игрокам, уже владеющим одобренной фракцией, передать нельзя.</div>
      ${assignPicker}
    </div>
  </div>`;
}

async function adLoadUsers() {
  try {
    const rows = await apiFetch('rpc/admin_list_users', { method: 'POST', body: '{}' });
    AD.users = Array.isArray(rows) ? rows : [];
  } catch (ex) { AD.users = []; toast('Ошибка загрузки игроков: ' + ex.message, 'err'); }
  if (AD.subtab === 'owner') adPaint();
}

// Вход в кабинет выбранной фракции (impersonation, без снятия игрока) — логика в economy.js
function adEnterCabinet() {
  if (!AD.sel) return;
  if (typeof ecEnterAsFaction === 'function') ecEnterAsFaction(AD.sel);
  else toast('Модуль экономики не загружен', 'err');
}

async function adVacateFaction() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e) return;
  const who = e.app.owner_email || e.app.owner_id || 'владелец';
  if (!confirm(`Снять игрока (${who}) с государства «${e.app.name}»?\n\nСтрана останется целой, но станет бесхозной. Бывший владелец сможет подать новую анкету. Данные не удаляются.`)) return;
  AD.busy = true;
  try {
    await apiFetch('rpc/admin_vacate_faction', { method: 'POST', body: JSON.stringify({ p_faction_id: AD.sel }) });
    e.app.owner_id = null; e.app.owner_email = null;
    if (e.eco) { e.eco.owner_id = null; e.eco.owner_email = null; }
    AD.users = null;   // список ролей мог измениться
    toast('Игрок снят, государство бесхозное', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adAssignFaction() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e) return;
  const uid = document.getElementById('ad-assign-user')?.value || '';
  if (!uid) { toast('Выберите игрока', 'err'); return; }
  const u = (AD.users || []).find(x => x.user_id === uid);
  const who = u ? (u.email || uid) : uid;
  if (!confirm(`Передать государство «${e.app.name}» игроку ${who}?\n\nОн получит полный контроль и роль «игрок». Прежний владелец (если есть) будет снят.`)) return;
  AD.busy = true;
  try {
    const r = await apiFetch('rpc/admin_assign_faction', { method: 'POST', body: JSON.stringify({ p_faction_id: AD.sel, p_user_id: uid }) });
    e.app.owner_id = uid; e.app.owner_email = (r && r.new_owner_email) || (u && u.email) || null;
    if (e.eco) { e.eco.owner_id = uid; e.eco.owner_email = e.app.owner_email; }
    AD.users = null;   // роли изменились
    toast(`Государство передано: ${who}`, 'ok'); adPaint();
  } catch (ex) {
    const msg = /already owns an approved faction/.test(ex.message) ? 'У игрока уже есть одобренная фракция' : ex.message;
    toast('Ошибка: ' + msg, 'err');
  }
  finally { AD.busy = false; }
}

// ── Вкладка: Тестовые инструменты ───────────────────────────────
// Ускоряют игровые таймеры и резолвят отложенные действия немедленно
// (через admin_test_* RPC, _admin_testing.sql). Только стафф.
function adTabTesting(e) {
  const eco = e.eco;
  const lastTick = eco?.last_tick ? new Date(eco.last_tick) : null;
  const fmtT = d => d ? d.toLocaleString('ru-RU') : '—';
  const row = (label, hint, btn) => `<div class="fm-danger-act" style="align-items:flex-start">
    <div class="fm-danger-label"><div>${label}</div>${hint ? `<div class="fm-dim" style="font-size:11px;margin-top:3px;font-weight:400;line-height:1.4">${hint}</div>` : ''}</div>${btn}</div>`;
  return `<div class="fm-danger">
    <div class="fm-danger-banner" style="background:rgba(95,176,230,.12);border-color:rgba(95,176,230,.4);color:var(--gdl,#5fb0e6)">🧪 Тестовые инструменты — ускоряют игровые таймеры и резолвят отложенные действия немедленно, не дожидаясь суточного тика.</div>
    ${row('🏴‍☠️ Завершить рейды немедленно', 'Все активные рейды этой фракции (как атакующего и как цели) резолвятся сейчас: бой, добыча, потери, раскрытие.', `<button class="btn btn-gd" onclick="adTestSpeedRaids()">Завершить рейды</button>`)}
    ${row('🕵 Завершить шпионаж немедленно', 'Агенты мгновенно дообучаются, активные операции резолвятся сейчас.', `<button class="btn btn-gd" onclick="adTestSpeedSpy()">Завершить шпионаж</button>`)}
    ${row('⏩ Форсировать тик дохода', `Начислить доход за сутки немедленно (last_tick откатится на 25 ч). Последний доход: ${fmtT(lastTick)}.`, `<button class="btn btn-gd" onclick="adTestForceTick()" ${eco ? '' : 'disabled'}>Начислить доход</button>`)}
    ${row('🜨 Приземлить залп артиллерии', 'Все снаряды «Длани Неотвратимости» этой фракции, что в полёте, мгновенно поражают цель: планета-цель превращается в мёртвый камень, колония на ней стирается.', `<button class="btn btn-gd" onclick="adTestSpeedDoom()">Приземлить залп</button>`)}
    ${row('🜨 Выдать орудие судного дня', 'Поставить готовую «Длань Неотвратимости» (целостность 100%) на первую колонию фракции со свободной ячейкой — без исследования и затрат. Заодно открывает технологию «Сама неотвратимость».', `<button class="btn btn-gd" onclick="adGrantDoomgun()">Выдать орудие</button>`)}
    ${row('☣ Выдать Гиперпейсер в конкретной системе', 'Спавнит готовый Гиперпейсер (мобильное орудие судного дня) сразу на карте — в выбранной системе. Без исследования и затрат; технология открывается заодно. Пусто = первая колония фракции.',
      `<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
        <select id="ad-mza-sys" class="ec-input" style="min-width:200px"><option value="">— первая колония фракции —</option>${(AD.systems || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru')).map(s => `<option value="${esc(s.id)}">${esc(s.name || s.id)}${s.faction ? '' : ' · нейтр.'}</option>`).join('')}</select>
        <button class="btn btn-gd" onclick="adGrantMza()">Выдать Гиперпейсер</button>
      </div>`)}
    ${row('☣ Приземлить залп Гиперпейсера', 'Все гиперпейсеры фракции мгновенно прибывают, а их снаряды в полёте поражают цель: планета-цель становится мёртвым камнем, колония на ней стирается.', `<button class="btn btn-gd" onclick="adTestSpeedMza()">Приземлить залп</button>`)}
    ${row('🛐 Удалить религию фракции', 'Удаляет веру, основанную этой фракцией. Адепты, признания и тайные секты уходят каскадом. Необратимо.', `<button class="btn btn-rd" onclick="adTestDeleteFaith()">Удалить религию</button>`)}
  </div>`;
}

async function adTestSpeedDoom() {
  if (!AD.sel || AD.busy) return;
  AD.busy = true;
  try {
    const r = await apiFetch('rpc/admin_test_speed_doom', { method: 'POST', body: JSON.stringify({ p_fid: AD.sel }) });
    toast(`Залпы приземлены: ${r?.landed || 0}`, 'ok');
    await adReloadPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adGrantDoomgun() {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Выдать «Длань Неотвратимости» этой фракции? Орудие появится на её колонии немедленно.')) return;
  AD.busy = true;
  try {
    const r = await apiFetch('rpc/admin_grant_doomgun', { method: 'POST', body: JSON.stringify({ p_fid: AD.sel, p_colony_id: null }) });
    toast(`Орудие выдано на колонию «${r?.colony || '—'}»`, 'ok');
    await adReloadPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adGrantMza() {
  if (!AD.sel || AD.busy) return;
  const sid = document.getElementById('ad-mza-sys')?.value || null;
  const where = sid ? (((AD.systems || []).find(s => s.id === sid) || {}).name || sid) : 'первой колонии фракции';
  if (!confirm(`Выдать Гиперпейсер этой фракции в системе «${where}»? Появится на карте немедленно.`)) return;
  AD.busy = true;
  try {
    const r = await apiFetch('rpc/admin_grant_mza', { method: 'POST', body: JSON.stringify({ p_fid: AD.sel, p_system_id: sid }) });
    toast(`Гиперпейсер выдан · система «${r?.system_name || '—'}»`, 'ok');
    await adReloadPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adTestSpeedMza() {
  if (!AD.sel || AD.busy) return;
  AD.busy = true;
  try {
    const r = await apiFetch('rpc/admin_test_speed_mza', { method: 'POST', body: JSON.stringify({ p_fid: AD.sel }) });
    toast(`Залпы Гиперпейсера приземлены: ${r?.landed || 0}`, 'ok');
    await adReloadPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adTestSpeedRaids() {
  if (!AD.sel || AD.busy) return;
  AD.busy = true;
  try {
    const r = await apiFetch('rpc/admin_test_speed_raids', { method: 'POST', body: JSON.stringify({ p_fid: AD.sel }) });
    toast(`Рейды резолвлены (атака: ${r?.as_attacker || 0}, защита: ${r?.as_target || 0})`, 'ok');
    await adReloadPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adTestSpeedSpy() {
  if (!AD.sel || AD.busy) return;
  AD.busy = true;
  try {
    const r = await apiFetch('rpc/admin_test_speed_spy', { method: 'POST', body: JSON.stringify({ p_fid: AD.sel }) });
    toast(`Шпионаж резолвлен (операций: ${r?.ops || 0})`, 'ok');
    await adReloadPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adTestForceTick() {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Форсировать тик дохода? Доход за сутки будет начислен немедленно.')) return;
  AD.busy = true;
  try {
    await apiFetch('rpc/admin_test_force_tick', { method: 'POST', body: JSON.stringify({ p_fid: AD.sel }) });
    toast('Доход начислен', 'ok');
    await adReloadPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adTestDeleteFaith() {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Удалить религию, основанную этой фракцией? Адепты, признания и тайные секты будут удалены каскадом. Необратимо.')) return;
  AD.busy = true;
  try {
    const r = await apiFetch('rpc/admin_test_delete_faith', { method: 'POST', body: JSON.stringify({ p_fid: AD.sel }) });
    toast(`Религия «${r?.name || ''}» удалена`, 'ok');
    await adReloadPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Вкладка: Опасная зона ───────────────────────────────────────
function adTabDanger(e) {
  const hasEco = !!e.eco;
  const row = (label, btn) => `<div class="fm-danger-act"><div class="fm-danger-label">${label}</div>${btn}</div>`;
  return `<div class="fm-danger">
    <div class="fm-danger-banner">⚠ Действия в этом разделе необратимы — применять осознанно</div>
    ${!hasEco ? row('Экономика фракции не инициализирована', `<button class="btn btn-gd" onclick="adInitEco()">✚ Создать экономику</button>`) : ''}
    ${row('Обнулить казну (ГС / ОН / Агенты → 0)', `<button class="btn btn-rd" onclick="adZeroTreasury()" ${!hasEco ? 'disabled' : ''}>Обнулить казну</button>`)}
    ${row('Обнулить все ресурсы склада', `<button class="btn btn-rd" onclick="adZeroResources()" ${!hasEco ? 'disabled' : ''}>Обнулить ресурсы</button>`)}
    ${row('Сбросить таймер дохода (last_tick = сейчас, доход через 24 ч)', `<button class="btn btn-gh" onclick="adResetTick()" ${!hasEco ? 'disabled' : ''}>Сбросить таймер</button>`)}
    ${row('Удалить все колонии и постройки фракции', `<button class="btn btn-rd" onclick="adDeleteColonies()">Удалить колонии</button>`)}
    ${row('Удалить весь ростер юнитов', `<button class="btn btn-rd" onclick="adDeleteRoster()">Удалить ростер</button>`)}
    ${row('Удалить строку экономики (казна, исследования, ресурсы)', `<button class="btn btn-rd" onclick="adDeleteEco()" ${!hasEco ? 'disabled' : ''}>Удалить экономику</button>`)}
    <div style="margin-top:16px;border-top:1px solid rgba(255,74,74,.25);padding-top:14px">
      <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#ff7a7a;margin-bottom:10px">💀 ЯДЕРНЫЙ ВАРИАНТ</div>
      ${row('Полное удаление фракции: анкета, карта, экономика, колонии, ростер, дизайны. Роль владельца сбрасывается на viewer — сможет зарегистрироваться заново.', `<button class="btn btn-rd" onclick="adDeleteFaction()" style="white-space:nowrap;font-weight:700;background:rgba(180,0,0,.7);border-color:#c00">💀 Удалить фракцию</button>`)}
    </div>
  </div>`;
}

async function adResetTick() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  if (!confirm('Сбросить таймер дохода? last_tick = сейчас, следующий доход через 24 ч (исправляет таймер, «убежавший» из-за прошлого двойного начисления).')) return;
  AD.busy = true;
  try {
    const now = new Date().toISOString();
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { last_tick: now });
    if (e.eco) e.eco.last_tick = now;
    toast('Таймер дохода сброшен', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adInitEco() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || e.eco) { toast(e?.eco ? 'Уже инициализировано' : 'Нет фракции', 'inf'); return; }
  AD.busy = true;
  try {
    const rows = await dbPost('faction_economy', {
      faction_id: AD.sel, owner_id: e.app.owner_id, owner_email: e.app.owner_email,
      gc: 0, science: 0, tnp: 0, agents: 0, resources: {}, research: [], last_tick: new Date().toISOString()
    });
    if (rows?.[0]) { e.eco = rows[0]; AD.ecos.push(rows[0]); }
    toast('Экономика создана', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adZeroTreasury() {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Обнулить казну (ГС / ОН / Агенты)?')) return;
  AD.busy = true;
  try {
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { gc: 0, science: 0, agents: 0 });
    const e = adEntry(AD.sel); if (e?.eco) { e.eco.gc = 0; e.eco.science = 0; e.eco.agents = 0; }
    toast('Казна обнулена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adZeroResources() {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Обнулить все ресурсы?')) return;
  AD.busy = true;
  try {
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { resources: {} });
    const e = adEntry(AD.sel); if (e?.eco) e.eco.resources = {};
    toast('Ресурсы обнулены', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adDeleteColonies() {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Удалить ВСЕ колонии и постройки фракции? Необратимо.')) return;
  AD.busy = true;
  try {
    await dbDel('colony_buildings', `faction_id=eq.${encodeURIComponent(AD.sel)}`);
    await dbDel('colonies',         `faction_id=eq.${encodeURIComponent(AD.sel)}`);
    const e = adEntry(AD.sel); if (e) { e.colonies = []; e.buildings = []; }
    AD.colonies  = AD.colonies.filter(c => c.faction_id !== AD.sel);
    AD.buildings = AD.buildings.filter(b => b.faction_id !== AD.sel);
    toast('Колонии удалены', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adDeleteRoster() {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Удалить весь ростер юнитов фракции? Необратимо.')) return;
  AD.busy = true;
  try {
    await dbDel('unit_production', `faction_id=eq.${encodeURIComponent(AD.sel)}`);
    const e = adEntry(AD.sel); if (e) { e.roster = []; e.queue = []; }
    AD.prod = AD.prod.filter(p => p.faction_id !== AD.sel);
    toast('Ростер удалён', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adDeleteEco() {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Удалить строку экономики? Казна, ресурсы, технологии будут потеряны.')) return;
  AD.busy = true;
  try {
    await dbDel('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`);
    const e = adEntry(AD.sel); if (e) e.eco = null;
    AD.ecos = AD.ecos.filter(ec => ec.faction_id !== AD.sel);
    toast('Экономика удалена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Полное удаление фракции ─────────────────────────────────────
async function adDeleteFaction() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel);
  if (!e) return;
  const name = e.app?.name || AD.sel;
  if (!confirm(
    `ПОЛНОЕ УДАЛЕНИЕ ФРАКЦИИ «${name}»\n\n` +
    `Будет безвозвратно удалено:\n` +
    `• Анкета (регистрация)\n` +
    `• Запись на карте\n` +
    `• Экономика, казна, ресурсы, технологии\n` +
    `• Все колонии и постройки\n` +
    `• Ростер и очередь юнитов\n` +
    `• Дизайны юнитов\n\n` +
    `Роль владельца сбросится — сможет зарегистрироваться заново.\n\nПродолжить?`
  )) return;
  if (!confirm(`Последнее предупреждение.\nУдалить «${name}» без возможности восстановления?`)) return;
  AD.busy = true;
  try {
    const token = await getTokenFresh();
    const ctrl  = new AbortController();
    const tid   = setTimeout(() => ctrl.abort(), 28000);
    const r = await fetch(`${SB_URL}/rest/v1/rpc/admin_delete_faction`, {
      method: 'POST',
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_faction_id: AD.sel }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!r.ok) { const t = await r.text(); throw new Error(t || 'HTTP ' + r.status); }
    const fid = AD.sel;
    AD.byFid.delete(fid);
    AD.apps      = AD.apps.filter(a => a.faction_id !== fid);
    AD.ecos      = AD.ecos.filter(ec => ec.faction_id !== fid);
    AD.colonies  = AD.colonies.filter(c => c.faction_id !== fid);
    AD.buildings = AD.buildings.filter(b => b.faction_id !== fid);
    AD.prod      = AD.prod.filter(p => p.faction_id !== fid);
    AD.designs   = AD.designs.filter(d => d.faction_id !== fid);
    AD.systems.forEach(s => { if (s.faction === fid) s.faction = null; });
    AD.sel = null;
    AD.subtab = 'treasury';
    toast(`Фракция «${name}» полностью удалена`, 'ok');
    adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Утилиты ─────────────────────────────────────────────────────
async function adReloadPaint() {
  const prev = { sel: AD.sel, subtab: AD.subtab, sysSearch: AD.sysSearch };
  try {
    await adLoad();
    Object.assign(AD, prev);
  } catch (e) { toast('Ошибка обновления: ' + e.message, 'err'); }
  adPaint();
}
