// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
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
  vn:        null,      // визуальная новелла главной { enabled, sprites[], dialogues[] }
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
  await adVNLoad();
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
    const rmPool = (AD.rm && AD.rm.tasks) ? AD.rm.tasks.filter(t => t.status === 'pool').length : null;
    const TABS = [['factions', '🛠 Фракции'], ['roadmap', '🗺 Дорожная карта', rmPool], ['unions', '🤝 Союзы', (AD.unions || []).length], ['portraits', '🎭 Арты', (AD.portraits || []).length], ['vn', '💬 Новелла', ((AD.vn && AD.vn.dialogues) || []).length], ['planets', '🪐 Планеты'], ['guide', '📖 Обложки'], ['ach', '🏆 Ачивки'], ['market', '🏪 Рынок NPC'], ['mktsim', '📈 Биржа (тест)']];
    const tabBar = `<div class="fm-ctabs" style="display:flex;flex-wrap:wrap;gap:6px;margin:18px 0 4px;border-bottom:1px solid var(--w2,#2a3340);padding-bottom:2px">
      ${TABS.map(([id, lbl, n]) => `<button class="btn ${AD.tab === id ? 'btn-gd' : 'btn-gh'} btn-sm" onclick="adSetTab('${id}')" style="border-bottom-left-radius:0;border-bottom-right-radius:0">${lbl}${n != null ? ` <span style="opacity:.65;font-size:11px">${n}</span>` : ''}</button>`).join('')}
    </div>`;
    let tabContent;
    if (AD.tab === 'roadmap')        tabContent = adRmPanel();
    else if (AD.tab === 'unions')   tabContent = adUnionsPanel();
    else if (AD.tab === 'portraits') tabContent = adPortraitsPanel();
    else if (AD.tab === 'vn')        tabContent = adVNPanel();
    else if (AD.tab === 'planets')   tabContent = adPlanetTexPanel();
    else if (AD.tab === 'guide')     tabContent = adGuideCoversPanel();
    else if (AD.tab === 'ach')       tabContent = adAchPanel();
    else if (AD.tab === 'market')    tabContent = adMarketPanel();
    else if (AD.tab === 'mktsim')    tabContent = adMarketSimPanel();
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
  let done = 0, fail = 0, lastErr = '';
  for (const f of files) {
    if (status) status.textContent = `Сохранение ${done + fail + 1}/${files.length}…`;
    try {
      const cf  = (typeof compressImageFile === 'function') ? await compressImageFile(f, 768, 0.85) : f;
      const ext = AD_PORT_EXT[cf.type] || 'jpg';
      const r   = await fetch(`${AD_PORT_SERVER}/upload?ext=${ext}`, {
        method: 'POST', headers: { 'Content-Type': cf.type || 'application/octet-stream' }, body: cf
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok || !j.url) throw new Error(j.error || ('сервер: HTTP ' + r.status));
      try {
        await dbPost('spy_portraits', { race, gender, url: j.url, label: f.name || null });
      } catch (dbe) {
        // Файл в папке уже лежит — но в БД не записался. Чаще всего: нет прав
        // (не стафф) или истёк вход. Показываем настоящую причину.
        throw new Error('БД: ' + (dbe.message || dbe));
      }
      done++;
    } catch (e) { console.error('[admin] portrait save', e); fail++; lastErr = e.message || String(e); }
  }
  if (status) status.textContent = `Готово: +${done}${fail ? `, ошибок ${fail} — ${lastErr}` : ''} → ${AD_PORT_DIR}/`;
  if (fail) toast('Не записалось в БД: ' + lastErr, 'err');
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

// ── Визуальная новелла главной: спрайты персонажей + редактор реплик ──
// Конфиг хранится в site_settings (ключ wk_hero_vn) одним JSON. Спрайты —
// картинки прямо в папку игры assets/hero/ через тот же локальный аплоад-сервер
// (dir=hero). Главная (render.js buildHeroVN) случайно выбирает диалог и печатает
// его реплики по очереди в диалоговом окне с печатной машинкой.
const AD_VN_DIR = 'assets/hero';
function adVNDefault() { return { enabled: false, sprites: [], dialogues: [], catSprites: {} }; }
async function adVNLoad() {
  let fresh = false;
  try {
    let dbRaw = null;
    try { dbRaw = (typeof getSiteSetting === 'function') ? await getSiteSetting('wk_hero_vn') : null; } catch (e) {}
    let dbCfg = null, locCfg = null;
    try { dbCfg = dbRaw ? (typeof dbRaw === 'string' ? JSON.parse(dbRaw) : dbRaw) : null; } catch (e) {}
    try { locCfg = JSON.parse(localStorage.getItem('wk_hero_vn') || 'null'); } catch (e) {}
    // Побеждает более свежий (по _ts) — локальные правки не теряются, если запись в БД не прошла.
    const cfg = (typeof _vnPickNewer === 'function') ? _vnPickNewer(dbCfg, locCfg) : (dbCfg || locCfg);
    fresh = !cfg;
    AD.vn = cfg || adVNDefault();
  } catch (e) { AD.vn = adVNDefault(); fresh = true; }
  if (!AD.vn || typeof AD.vn !== 'object') AD.vn = adVNDefault();
  AD.vn.sprites   = Array.isArray(AD.vn.sprites)   ? AD.vn.sprites   : [];
  AD.vn.dialogues = Array.isArray(AD.vn.dialogues) ? AD.vn.dialogues : [];
  if (!AD.vn.catSprites || typeof AD.vn.catSprites !== 'object') AD.vn.catSprites = {};
  // Первое открытие (конфига ещё нет) — засеять редактор исходными фразами
  // обложки как ГОТОВЫМ редактируемым диалогом. Их можно править и вешать спрайт.
  if (fresh && !AD.vn.dialogues.length) AD.vn.dialogues = adVNSeedDialogues();
  AD.vn.dialogues.forEach(adVNNorm);            // привести реплики к объектам {text,spriteId}
}
// Расписание: когда диалог может всплывать (слот времени суток).
const AD_VN_TIMES = [
  ['any', '🕘 всегда'], ['morning', '🌅 утро (5–11)'], ['day', '☀️ день (12–17)'],
  ['evening', '🌇 вечер (18–23)'], ['night', '🌙 ночь (0–4)'],
];
// Нормализовать диалог: реплики-строки → {text,spriteId}; поле time; миграция старого spriteId.
function adVNNorm(d) {
  if (!d.id) d.id = adVNId();
  if (d.time == null) d.time = 'any';
  const lines = Array.isArray(d.lines) ? d.lines : [];
  d.lines = lines.map(l => {
    if (typeof l === 'string') {
      return { text: l, spriteIds: [d.spriteId || ''], count: 1 };  // старый формат
    }
    const cnt = Math.max(1, Math.min(4, (l && l.count) || 1));
    let spriteIds = Array.isArray(l.spriteIds) ? l.spriteIds : (l.spriteId ? [l.spriteId] : []);
    // Заполнить до нужного размера пустыми строками
    while (spriteIds.length < cnt) spriteIds.push('');
    spriteIds = spriteIds.slice(0, cnt);
    return { text: String((l && l.text) || ''), spriteIds, count: cnt };
  });
  if (!d.lines.length) d.lines = [{ text: '', spriteIds: [''], count: 1 }];
  return d;
}
// Исходные фразы-приветствия обложки → КАЖДАЯ ФРАЗА = ОТДЕЛЬНЫЙ диалог
// ({name} — плейсхолдер). На главной случайно всплывает один из них; в каждый
// можно дописать ещё реплики (со своими спрайтами).
function adVNSeedDialogues() {
  let lines = [];
  try { if (typeof heroGreetPhrases === 'function') lines = heroGreetPhrases('{name}'); } catch (e) {}
  lines = [...new Set((lines || []).map(s => (s || '').trim()).filter(Boolean))];
  return lines.map(l => ({ id: adVNId(), time: 'any', speaker: '', lines: [{ text: l, spriteId: '' }] }));
}
function adVNId() { return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
// Пересчитать селекторы спрайтов при изменении количества
function adVNUpdateLineCount(dialogId, lineIdx, newCount) {
  const cnt = Math.max(1, Math.min(4, parseInt(newCount) || 1));
  adVNCollect();  // сохранить текущие значения
  const dlg = (AD.vn && AD.vn.dialogues) ? AD.vn.dialogues.find(d => d.id === dialogId) : null;
  if (!dlg || !dlg.lines || !dlg.lines[lineIdx]) return;

  const ln = dlg.lines[lineIdx];
  if (!Array.isArray(ln.spriteIds)) ln.spriteIds = [];
  // Заполнить/обрезать до нужного размера
  while (ln.spriteIds.length < cnt) ln.spriteIds.push('');
  ln.spriteIds = ln.spriteIds.slice(0, cnt);
  ln.count = cnt;

  adPaint();  // перерисовать панель
}
// Снять текущие значения формы в AD.vn (чтобы не терять правки при перерисовке/сохранении).
function adVNCollect() {
  if (!AD.vn) return;
  const en = document.getElementById('ad-vn-enabled');
  if (en) AD.vn.enabled = !!en.checked;
  if (!AD.vn.catSprites || typeof AD.vn.catSprites !== 'object') AD.vn.catSprites = {};
  ['ach', 'events', 'idx'].forEach(k => {
    const slots = {};
    AD_VN_TIMES.forEach(([slot]) => {
      const sel = document.getElementById('ad-vn-cat-' + k + '-' + slot);
      if (sel && sel.value) slots[slot] = sel.value;
    });
    AD.vn.catSprites[k] = slots;   // объект по времени: {any, morning, day, evening, night}
  });
  (AD.vn.sprites || []).forEach(s => {
    const n = document.getElementById('ad-vn-spn-' + s.id);
    if (n) s.name = n.value || '';
  });
  (AD.vn.dialogues || []).forEach(d => {
    const nm = document.getElementById('ad-vn-nm-' + d.id);
    const tm = document.getElementById('ad-vn-tm-' + d.id);
    if (nm) d.speaker = nm.value || '';
    if (tm) d.time    = tm.value || 'any';
    (d.lines || []).forEach((ln, i) => {
      const tx = document.getElementById('ad-vn-lt-' + d.id + '-' + i);
      const ct = document.getElementById('ad-vn-lc-' + d.id + '-' + i);
      if (tx) ln.text = tx.value || '';
      if (ct) ln.count = Math.max(1, Math.min(4, parseInt(ct.value) || 1));
      // Собрать все выбранные спрайты для этой строки
      ln.spriteIds = [];
      for (let sIdx = 0; sIdx < (ln.count || 1); sIdx++) {
        const sp = document.getElementById('ad-vn-ls-' + d.id + '-' + i + '-' + sIdx);
        if (sp) ln.spriteIds.push(sp.value || '');
      }
      // Миграция старого поля spriteId → spriteIds
      if (ln.spriteId && !ln.spriteIds.length) ln.spriteIds = [ln.spriteId];
      delete ln.spriteId;
    });
  });
}
// Сохранить конфиг. ЛОКАЛЬНЫЙ кэш пишем ВСЕГДА (сайт читает его и работает сразу
// на этом устройстве), затем пробуем БД (общий конфиг). Если БД отказала (нет
// прав на site_settings) — пробрасываем ошибку, но локально уже сохранено.
async function adVNPersist() {
  adVNCollect();
  AD.vn._ts = Date.now();                       // метка свежести — побеждает при синхронизации
  const json = JSON.stringify(AD.vn);
  try {
    if (typeof _heroVN !== 'undefined') _heroVN = JSON.parse(json);
    localStorage.setItem('wk_hero_vn', json);
  } catch (e) {}
  if (typeof saveSiteSetting !== 'function') throw new Error('saveSiteSetting недоступна');
  await saveSiteSetting('wk_hero_vn', json);   // может бросить — обработают вызывающие
}
function adVNPanel() {
  if (!AD.vn) AD.vn = adVNDefault();
  const inp = 'padding:8px 10px;font-size:13px;background:var(--b2,#141a22);color:var(--t1,#e8edf2);border:1px solid var(--w2,#2a3340);border-radius:8px';
  const sprites = AD.vn.sprites || [];
  const dialogues = AD.vn.dialogues || [];
  const cat = AD.vn.catSprites || {};

  // ── Пул спрайтов ──
  const spriteCards = sprites.map(s => `<div style="width:104px">
      <div style="position:relative;width:104px;height:130px;border-radius:8px;border:1px solid var(--w2,#2a3340);background:#0c1322 center/contain no-repeat;background-image:url('${esc(s.url)}')">
        <button class="btn btn-gh btn-xs" title="Удалить спрайт" onclick="adVNSpriteDelete('${esc(s.id)}')" style="position:absolute;top:3px;right:3px;min-width:0;padding:2px 6px;background:rgba(8,12,22,.8)">✕</button>
      </div>
      <input id="ad-vn-spn-${esc(s.id)}" value="${esc(s.name || '')}" placeholder="имя" style="${inp};width:100%;margin-top:4px;font-size:11px;padding:5px 7px">
    </div>`).join('') || '<div style="color:var(--t4,#6a7a88);font-size:13px;padding:10px 0">Спрайтов пока нет — загрузи первый PNG/WebP персонажа (лучше с прозрачным фоном).</div>';

  const spriteOpts = id => ['<option value="">— без спрайта —</option>']
    .concat(sprites.map(s => `<option value="${esc(s.id)}"${id === s.id ? ' selected' : ''}>${esc(s.name || s.id)}</option>`)).join('');

  const timeOpts = t => AD_VN_TIMES.map(([v, l]) => `<option value="${v}"${(t || 'any') === v ? ' selected' : ''}>${esc(l)}</option>`).join('');

  // ── Редактор диалогов: у каждой РЕПЛИКИ свои спрайты (1-4) + количество; у диалога — время показа ──
  const dlgCards = dialogues.map((d, i) => {
    const lineRows = (d.lines || []).map((ln, li) => {
      const cnt = Math.max(1, Math.min(4, (ln && ln.count) || 1));
      const spriteIds = Array.isArray(ln.spriteIds) ? ln.spriteIds : (ln.spriteId ? [ln.spriteId] : []);
      // Заполнить массив спрайтов до нужного размера пустыми строками
      while (spriteIds.length < cnt) spriteIds.push('');
      spriteIds.length = cnt; // обрезать лишние

      const spriteSelects = spriteIds.map((sId, sIdx) =>
        `<select id="ad-vn-ls-${esc(d.id)}-${li}-${sIdx}" title="Спрайт #${sIdx + 1} для этой сцены" style="${inp};min-width:120px;font-size:12px">${spriteOpts(sId)}</select>`
      ).join('');

      return `<div style="display:flex;gap:8px;align-items:flex-start;margin-top:6px;flex-wrap:wrap">
        <span style="font-family:monospace;font-size:10px;color:var(--t4,#6a7a88);padding-top:9px;min-width:16px;flex-basis:100%">${li + 1}</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;flex-basis:100%">
          ${spriteSelects}
          <select id="ad-vn-lc-${esc(d.id)}-${li}" title="Сколько спрайтов в кадре (1-4)" style="${inp};min-width:80px;font-size:12px" onchange="adVNUpdateLineCount('${esc(d.id)}', ${li}, this.value)">
            <option value="1"${cnt === 1 ? ' selected' : ''}>1 спрайт</option>
            <option value="2"${cnt === 2 ? ' selected' : ''}>2 спрайта</option>
            <option value="3"${cnt === 3 ? ' selected' : ''}>3 спрайта</option>
            <option value="4"${cnt === 4 ? ' selected' : ''}>4 спрайта</option>
          </select>
        </div>
        <textarea id="ad-vn-lt-${esc(d.id)}-${li}" rows="1" placeholder="Реплика… {name}" style="${inp};flex:1;resize:vertical;line-height:1.45;font-size:13px;min-height:36px;flex-basis:100%">${esc(ln.text || '')}</textarea>
        <button class="btn btn-gh btn-xs" title="Удалить реплику" onclick="adVNRemoveLine('${esc(d.id)}',${li})" style="white-space:nowrap;flex-basis:100%;align-self:flex-end">✕</button>
      </div>`; }).join('');
    return `<div style="border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b1,#0f141b);padding:12px 13px;margin-top:10px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
        <span style="font-family:monospace;font-size:11px;color:var(--te,#3ec0d0)">#${i + 1}</span>
        <label style="font-size:12px;color:var(--t3,#8aa0b0)">Имя:</label>
        <input id="ad-vn-nm-${esc(d.id)}" value="${esc(d.speaker || '')}" placeholder="Капитан Юри" style="${inp};flex:1;min-width:120px">
        <label style="font-size:12px;color:var(--t3,#8aa0b0)">Время:</label>
        <select id="ad-vn-tm-${esc(d.id)}" title="Когда этот диалог может всплывать" style="${inp};min-width:150px">${timeOpts(d.time)}</select>
        <button class="btn btn-rd btn-xs" onclick="adVNRemoveDialogue('${esc(d.id)}')" title="Удалить диалог" style="white-space:nowrap">🗑</button>
      </div>
      ${lineRows}
      <button class="btn btn-gh btn-xs" onclick="adVNAddLine('${esc(d.id)}')" style="margin-top:8px">+ реплика</button>
    </div>`;
  }).join('') || '<div style="color:var(--t4,#6a7a88);font-size:13px;padding:10px 0">Диалогов нет. Добавь первый — персонаж заговорит на главной.</div>';

  return `<div style="margin-top:24px;border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b2,#141a22);padding:16px 18px">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-family:var(--font-display,sans-serif);font-size:16px;font-weight:700;color:var(--gdl,#5fb0e6)">💬 Визуальная новелла главной</div>
    </div>
    <div style="font-size:12px;color:var(--t3,#8aa0b0);margin:6px 0 4px">Обложка главной — это новелла: случайно всплывает один подходящий по времени диалог, реплики печатаются по очереди и сами листаются. <code>{name}</code> подставит имя игрока. У <b>каждой реплики</b> свой спрайт (меняется по ходу диалога с гладкой анимацией), количество спрайтов в кадре (1–4, для групповых сцен), и имя говорящего; у диалога — <b>время суток</b>, когда он может показаться.</div>
    <div style="font-size:11px;color:var(--t4,#6a7a88);margin:0 0 14px;line-height:1.5">📁 Спрайты сохраняются <b>в папку игры</b> <code>${AD_VN_DIR}/</code>. Запусти локальный сервер: <code>node tools/upload-server.js</code>. Лучше PNG/WebP с прозрачным фоном.</div>

    <div style="font-family:monospace;font-size:11px;color:var(--te,#3ec0d0);margin-bottom:7px">СПРАЙТЫ <span style="color:var(--t4,#6a7a88)">· ${sprites.length}</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;margin-bottom:8px">${spriteCards}</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:6px 0 18px">
      <input id="ad-vn-file" type="file" accept="image/*" multiple style="${inp};max-width:280px">
      <button class="btn btn-gd btn-sm" onclick="adVNSpriteUpload()">⬇ Загрузить спрайт(ы)</button>
      <span id="ad-vn-up-status" style="font-size:12px;color:var(--t3,#8aa0b0)"></span>
    </div>

    <div style="font-family:monospace;font-size:11px;color:var(--te,#3ec0d0);margin-bottom:2px;border-top:1px solid var(--w2,#2a3340);padding-top:14px">СПРАЙТЫ КАТЕГОРИЙ</div>
    <div style="font-size:11px;color:var(--t4,#6a7a88);margin:0 0 10px;line-height:1.5">Какой спрайт показывать, пока игрок смотрит раздел в окне новеллы. Можно задать спрайт на время суток; «всегда» — общий запасной, если на текущее время ничего не указано. Пусто — оставить спрайт реплики.</div>
    ${[['events','📰 События'],['idx','📈 Биржа'],['ach','🏆 Достижения']].map(([k,lbl]) => {
      const cv = (cat || {})[k];
      const cur = slot => (cv && typeof cv === 'object') ? (cv[slot] || '') : (slot === 'any' ? (cv || '') : '');
      const sels = AD_VN_TIMES.map(([slot, slbl]) =>
        `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t3,#8aa0b0)"><span style="min-width:104px">${esc(slbl)}</span><select id="ad-vn-cat-${k}-${slot}" style="${inp};min-width:150px;font-size:12px">${spriteOpts(cur(slot))}</select></label>`
      ).join('');
      return `<div style="margin-bottom:14px;padding:10px 12px;border:1px solid var(--w2,#2a3340);border-radius:8px;background:var(--b2,#141a22)">
        <div style="font-size:13px;color:var(--t1,#e8edf2);margin-bottom:8px;font-weight:600">${esc(lbl)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px 18px">${sels}</div>
      </div>`;
    }).join('')}

    <div style="font-family:monospace;font-size:11px;color:var(--te,#3ec0d0);margin-bottom:2px;border-top:1px solid var(--w2,#2a3340);padding-top:14px">ДИАЛОГИ <span style="color:var(--t4,#6a7a88)">· ${dialogues.length}</span></div>
    ${dlgCards}
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
      <button class="btn btn-gh btn-sm" onclick="adVNAddDialogue()">+ Добавить диалог</button>
      <button class="btn btn-gh btn-sm" onclick="adVNSeedRestore()" title="Добавить диалог из стандартных фраз-приветствий обложки (их можно отредактировать)">↺ Стандартные фразы</button>
      <button class="btn btn-gd btn-sm" onclick="adVNSave()">💾 Сохранить новеллу</button>
    </div>
  </div>`;
}
// Загрузить ОДИН файл-спрайт → вернуть URL. Сначала локальный аплоад-сервер
// (в папку игры assets/hero), если он поднят; иначе — обычная загрузка
// (Supabase Storage / base64), чтобы работало и без локального сервера.
async function adVNUploadOne(f, serverUp) {
  if (serverUp) {
    const cf  = (typeof compressImageFile === 'function') ? await compressImageFile(f, 1024, 0.9) : f;
    const ext = AD_PORT_EXT[cf.type] || 'webp';
    const r   = await fetch(`${AD_PORT_SERVER}/upload?dir=hero&ext=${ext}`, {
      method: 'POST', headers: { 'Content-Type': cf.type || 'application/octet-stream' }, body: cf
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok && j.url) return j.url;
    throw new Error(j.error || ('сервер: HTTP ' + r.status));
  }
  // Фолбэк без локального сервера: тот же загрузчик, что у обложек.
  if (typeof handleImgUpload !== 'function') throw new Error('загрузчик недоступен');
  return await new Promise((resolve, reject) => {
    let settled = false;
    const done = u => { if (!settled) { settled = true; resolve(u); } };
    const fail = () => { if (!settled) { settled = true; reject(new Error('загрузка не удалась')); } };
    setTimeout(fail, 30000);
    try { handleImgUpload(f, done); } catch (e) { reject(e); }
  });
}
async function adVNSpriteUpload() {
  const fileEl = document.getElementById('ad-vn-file');
  const status = document.getElementById('ad-vn-up-status');
  const files  = fileEl && fileEl.files ? [...fileEl.files] : [];
  if (!files.length) { if (status) status.textContent = 'Выберите файл(ы)'; return; }
  adVNCollect();
  if (status) status.textContent = 'Загрузка…';
  const serverUp = await adPortServerAlive();   // есть локальный сервер? иначе — Storage/base64
  let done = 0, fail = 0, lastErr = '';
  for (const f of files) {
    if (status) status.textContent = `Загрузка ${done + fail + 1}/${files.length}…`;
    try {
      const url = await adVNUploadOne(f, serverUp);
      if (!url) throw new Error('пустой URL');
      AD.vn.sprites.push({ id: adVNId(), name: (f.name || '').replace(/\.[^.]+$/, '') || 'спрайт', url });
      done++;
    } catch (e) { console.error('[admin] vn sprite', e); fail++; lastErr = e.message || String(e); }
  }
  // Первый загруженный спрайт автоматически вешаем ТОЛЬКО на реплики, где ещё
  // ничего не выбрано (пустой spriteIds) — чтобы он сразу показывался на главной,
  // но НЕ затирал уже выбранные спрайты. Пишем в новый формат spriteIds.
  if (done && AD.vn.sprites.length) {
    const firstId = AD.vn.sprites[0].id;
    (AD.vn.dialogues || []).forEach(d => (d.lines || []).forEach(ln => {
      const has = (Array.isArray(ln.spriteIds) && ln.spriteIds.some(Boolean)) || ln.spriteId;
      if (!has) { ln.spriteIds = [firstId]; ln.count = 1; delete ln.spriteId; }
    }));
  }
  let dbErr = '';
  try { await adVNPersist(); } catch (e) { dbErr = e.message || String(e); }   // локально уже сохранено
  if (status) status.textContent = `Файлов: ${files.length} · успешно: ${done} · ошибок: ${fail} · спрайтов в списке: ${AD.vn.sprites.length}${lastErr ? ` · ошибка: ${lastErr}` : ''}${dbErr ? ` · БД: ${dbErr}` : ''}`;
  if (done && !dbErr) toast(`Спрайт загружен (+${done})`, 'ok');
  else if (done && dbErr) toast(`Спрайт сохранён локально (+${done}); в общую БД не записалось`, 'err');
  else if (!done) toast('Не удалось загрузить спрайт: ' + (lastErr || 'неизвестная ошибка'), 'err');
  adPaint();
}
async function adVNSpriteDelete(id) {
  if (!confirm('Удалить спрайт? Он отвяжется от всех диалогов.')) return;
  adVNCollect();
  const s = (AD.vn.sprites || []).find(x => x.id === id);
  AD.vn.sprites = (AD.vn.sprites || []).filter(x => x.id !== id);
  (AD.vn.dialogues || []).forEach(d => {
    if (d.spriteId === id) d.spriteId = '';
    (d.lines || []).forEach(ln => { if (ln.spriteId === id) ln.spriteId = ''; });
  });
  if (s && s.url && s.url.indexOf(AD_VN_DIR + '/') === 0) {
    const name = s.url.split('/').pop();
    fetch(`${AD_PORT_SERVER}/file?dir=hero&name=${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {});
  }
  try { await adVNPersist(); } catch (e) { toast('Не удалось сохранить: ' + (e.message || e), 'err'); }
  adPaint();
}
function adVNAddDialogue() {
  adVNCollect();
  const first = (AD.vn.sprites || [])[0];
  AD.vn.dialogues.push({ id: adVNId(), time: 'any', speaker: '', lines: [{ text: '', spriteId: first ? first.id : '' }] });
  adPaint();
}
function adVNAddLine(did) {
  adVNCollect();
  const d = (AD.vn.dialogues || []).find(x => x.id === did);
  if (d) { d.lines = d.lines || []; const prev = d.lines[d.lines.length - 1]; d.lines.push({ text: '', spriteId: (prev && prev.spriteId) || '' }); }
  adPaint();
}
function adVNRemoveLine(did, idx) {
  adVNCollect();
  const d = (AD.vn.dialogues || []).find(x => x.id === did);
  if (d && Array.isArray(d.lines)) { d.lines.splice(idx, 1); if (!d.lines.length) d.lines.push({ text: '', spriteId: '' }); }
  adPaint();
}
function adVNSeedRestore() {
  adVNCollect();
  const seed = adVNSeedDialogues();
  if (!seed.length) { toast('Не удалось получить стандартные фразы', 'err'); return; }
  const spid = (AD.vn.sprites || [])[0]?.id || '';
  seed.forEach(d => (d.lines || []).forEach(ln => { if (!ln.spriteId) ln.spriteId = spid; }));
  AD.vn.dialogues.push(...seed);
  adPaint();
}
function adVNRemoveDialogue(id) {
  adVNCollect();
  AD.vn.dialogues = (AD.vn.dialogues || []).filter(d => d.id !== id);
  adPaint();
}
async function adVNSave() {
  try {
    await adVNPersist();
    toast('Новелла сохранена', 'ok');
  } catch (e) {
    // Локально уже сохранено (внутри adVNPersist) — на этом устройстве работает.
    toast('Сохранено локально. В общую БД не записалось (нет прав на site_settings): ' + (e.message || e), 'err');
  }
  adPaint();
}

// ── Обложки разделов гайдбука (assets/guide/<id-раздела>.jpg) ─────────
// Грузятся тем же локальным аплоад-сервером (tools/upload-server.js, dir=guide),
// фикс. именем = id раздела (перезапись). БД не нужна: гайд сам подхватывает
// файл фоном со слой-маской (gbApplyCovers в guide.js). Список разделов — из
// GB_SECTIONS (guide.js, доступен в рантайме).
const AD_GUIDE_DIR = 'assets/guide';
function adGuideCoversPanel() {
  const secs = (typeof GB_SECTIONS !== 'undefined' && Array.isArray(GB_SECTIONS)) ? GB_SECTIONS : [];
  const bust = AD.gcBust || '';
  const cards = secs.map(s => {
    const url = `${AD_GUIDE_DIR}/${s.id}.jpg${bust ? `?t=${bust}` : ''}`;
    return `<div style="width:150px">
      <div style="position:relative;width:150px;height:90px;border-radius:9px;border:1px solid var(--w2,#2a3340);overflow:hidden;background:#0c1322 center/cover no-repeat">
        <img src="${esc(url)}" alt="" onload="this.style.opacity=1" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
             style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .2s">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--t4,#6a7a88);font-size:26px">${s.icon || '◆'}</div>
      </div>
      <div style="font-size:11px;color:var(--t2,#c4d0da);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(s.label)}">${esc(s.label)}</div>
      <input type="file" accept="image/*" id="ad-gc-${esc(s.id)}" style="display:none" onchange="adGuideCoverUpload('${esc(s.id)}', this)">
      <button class="btn btn-gh btn-xs" style="margin-top:4px;width:100%" onclick="document.getElementById('ad-gc-${esc(s.id)}').click()">⬆ Обложка</button>
      <div id="ad-gc-st-${esc(s.id)}" style="font-size:9px;color:var(--t4,#6a7a88);min-height:11px;text-align:center"></div>
    </div>`;
  }).join('') || '<div style="color:var(--t4,#6a7a88);font-size:13px;padding:14px 0">Список разделов гайда недоступен (guide.js не загружен).</div>';
  return `<div style="margin-top:24px;border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b2,#141a22);padding:16px 18px">
    <div style="font-family:var(--font-display,sans-serif);font-size:16px;font-weight:700;color:var(--gdl,#5fb0e6)">📖 Обложки разделов гайда <span style="font-size:11px;font-weight:400;color:var(--t4,#6a7a88)">· ${secs.length} разделов</span></div>
    <div style="font-size:12px;color:var(--t3,#8aa0b0);margin:6px 0 4px">Каждому разделу — своя картинка-обложка. Она рисуется фоном со сложной слой-маской прозрачности (мягко растворяется по краям и снизу). Загрузка перезаписывает обложку раздела.</div>
    <div style="font-size:11px;color:var(--t4,#6a7a88);margin:0 0 12px;line-height:1.5">📁 Сохраняется <b>прямо в папку игры</b> <code>${AD_GUIDE_DIR}/&lt;id&gt;.jpg</code>. Запусти локальный сервер: <code>node tools/upload-server.js</code> и держи окно открытым.</div>
    <div style="display:flex;flex-wrap:wrap;gap:14px">${cards}</div>
  </div>`;
}
// Перекодировать картинку-файл в JPEG-Blob нужного размера (канвас).
function adImageToJpeg(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      const k = Math.min(1, maxDim / Math.max(w, h));
      w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);   // подложка под прозрачность PNG
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', quality || 0.85);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('не удалось прочитать изображение'));
    img.src = URL.createObjectURL(file);
  });
}
async function adGuideCoverUpload(secId, inputEl) {
  const f = inputEl && inputEl.files && inputEl.files[0];
  const st = document.getElementById(`ad-gc-st-${secId}`);
  if (!f) return;
  if (st) st.textContent = 'Проверка сервера…';
  if (!(await adPortServerAlive())) {
    if (st) st.textContent = 'Сервер не запущен';
    toast('Запусти локальный аплоад-сервер: node tools/upload-server.js', 'err');
    return;
  }
  try {
    if (st) st.textContent = 'Сохранение…';
    // Конвертируем в реальный JPEG (гайд ждёт <id>.jpg). Имя с расширением —
    // сервер сохранит его как есть, не подменяя по content-type.
    const blob = await adImageToJpeg(f, 1280, 0.85);
    const r  = await fetch(`${AD_PORT_SERVER}/upload?dir=guide&name=${encodeURIComponent(secId + '.jpg')}`, {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok || !j.url) throw new Error(j.error || ('сервер: HTTP ' + r.status));
    AD.gcBust = Date.now();              // сбросить кэш превью
    if (st) st.textContent = 'Готово ✓';
    toast(`Обложка раздела «${secId}» сохранена`, 'ok');
    adPaint();
  } catch (e) {
    console.error('[admin] guide cover', e);
    if (st) st.textContent = 'Ошибка';
    toast('Не удалось сохранить обложку: ' + (e.message || e), 'err');
  }
}

// ── Ачивки: арт (assets/ach/<id>.webp) + правки подписей (_overrides.json) ──
// Арт грузится локальным сервером (dir=ach). Тексты (имя/цитата/описание/
// условие) пишутся в assets/ach/_overrides.json — economy.js накладывает их
// поверх каталога EC_ACH. Числа условий и реальные награды — за сервером БД.
const AD_ACH_DIR = 'assets/ach';
const AD_ACH_FIELDS = [['name', 'Название'], ['quote', 'Цитата'], ['desc', 'Описание'], ['cond', 'Условие']];
function adAchPanel() {
  const ids  = (typeof EC_ACH_ORDER !== 'undefined' && Array.isArray(EC_ACH_ORDER)) ? EC_ACH_ORDER : [];
  const cat  = (typeof EC_ACH !== 'undefined') ? EC_ACH : {};
  if (!ids.length || typeof EC_ACH === 'undefined') {
    return `<div style="margin-top:24px;color:var(--t4,#6a7a88);font-size:13px">Каталог ачивок недоступен (economy.js не загружен).</div>`;
  }
  // Лениво подтянуть текущие правки из файла (один раз).
  if (AD.achOv == null) { AD.achOv = {}; adAchLoadOv(); }
  const ov   = AD.achOv || {};
  const bust = AD.achBust || '';
  const inp  = 'width:100%;box-sizing:border-box;padding:6px 8px;font-size:12px;background:var(--b1,#0f141b);color:var(--t1,#e8edf2);border:1px solid var(--w2,#2a3340);border-radius:7px';
  const cards = ids.filter(id => cat[id]).map(id => {
    const a = cat[id];
    const url = `${AD_ACH_DIR}/${id}.webp${bust ? `?t=${bust}` : ''}`;
    const fields = AD_ACH_FIELDS.map(([k, lbl]) => {
      const v = (ov[id] && ov[id][k] != null) ? ov[id][k] : (a[k] || '');
      const edited = ov[id] && ov[id][k] != null && ov[id][k] !== '';
      const fid = `ad-ach-${k}-${esc(id)}`;
      const tag = (k === 'desc' || k === 'quote')
        ? `<textarea id="${fid}" rows="2" style="${inp};resize:vertical">${esc(v)}</textarea>`
        : `<input id="${fid}" type="text" value="${esc(v)}" style="${inp}">`;
      return `<label style="display:block;margin-top:6px"><span style="font-size:10px;color:var(--t4,#6a7a88)">${lbl}${edited ? ' ✎' : ''}</span>${tag}</label>`;
    }).join('');
    return `<div style="width:280px;border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b1,#0f141b);padding:10px">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <div style="position:relative;width:104px;height:65px;flex-shrink:0;border-radius:8px;overflow:hidden;border:1px solid var(--w2,#2a3340);background:#0c1322 center/cover">
          <img src="${esc(url)}" alt="" onload="this.style.opacity=1" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
               style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .2s">
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--t4,#6a7a88);font-size:24px">${a.ic || '🏆'}</div>
        </div>
        <div style="min-width:0;flex:1">
          <div style="font-size:9px;font-family:monospace;color:var(--t4,#6a7a88);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(id)}</div>
          <div style="font-size:10px;color:var(--te,#3ec0d0);margin-top:2px">🏆 +${(+a.reward || 0)} ГС <span style="color:var(--t4,#6a7a88)">(награда за сервером)</span></div>
          <input type="file" accept="image/*" id="ad-ach-file-${esc(id)}" style="display:none" onchange="adAchArtUpload('${esc(id)}', this)">
          <button class="btn btn-gh btn-xs" style="margin-top:5px;width:100%" onclick="document.getElementById('ad-ach-file-${esc(id)}').click()">⬆ Арт</button>
        </div>
      </div>
      ${fields}
      <div style="display:flex;gap:6px;align-items:center;margin-top:8px">
        <button class="btn btn-gd btn-xs" onclick="adAchSaveText('${esc(id)}')">💾 Сохранить</button>
        <button class="btn btn-gh btn-xs" title="Вернуть подписи из каталога" onclick="adAchResetText('${esc(id)}')">↺ Сброс</button>
        <span id="ad-ach-st-${esc(id)}" style="font-size:9px;color:var(--t4,#6a7a88)"></span>
      </div>
    </div>`;
  }).join('');
  return `<div style="margin-top:24px;border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b2,#141a22);padding:16px 18px">
    <div style="font-family:var(--font-display,sans-serif);font-size:16px;font-weight:700;color:var(--gdl,#5fb0e6)">🏆 Ачивки <span style="font-size:11px;font-weight:400;color:var(--t4,#6a7a88)">· арт и подписи (${ids.length})</span></div>
    <div style="font-size:12px;color:var(--t3,#8aa0b0);margin:6px 0 4px">Заливай арт (${AD_ACH_DIR}/&lt;id&gt;.webp, 16:10) и правь подписи — имя, цитату, описание, условие. Правки сохраняются в <code>${AD_ACH_DIR}/_overrides.json</code> и накладываются поверх каталога. <b>Числа условий и реальная награда считаются на сервере</b> — здесь только подписи.</div>
    <div style="font-size:11px;color:var(--t4,#6a7a88);margin:0 0 12px;line-height:1.5">📁 Пишется <b>прямо в папку игры</b>. Запусти: <code>node tools/upload-server.js</code> и держи окно открытым.</div>
    <div style="display:flex;flex-wrap:wrap;gap:12px">${cards}</div>
  </div>`;
}
async function adAchLoadOv() {
  try {
    const r = await fetch(`${AD_ACH_DIR}/_overrides.json?t=${Date.now()}`);
    AD.achOv = r.ok ? (await r.json().catch(() => ({}))) || {} : {};
  } catch (e) { AD.achOv = {}; }
  if (AD.tab === 'ach') adPaint();
}
// Записать текущий объект правок в файл assets/ach/_overrides.json.
async function adAchPushOv(stEl) {
  if (!(await adPortServerAlive())) {
    if (stEl) stEl.textContent = 'нет сервера';
    toast('Запусти локальный аплоад-сервер: node tools/upload-server.js', 'err');
    return false;
  }
  const r = await fetch(`${AD_PORT_SERVER}/upload?dir=ach&name=${encodeURIComponent('_overrides.json')}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(AD.achOv || {}, null, 2)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || ('сервер: HTTP ' + r.status));
  return true;
}
async function adAchSaveText(id) {
  const st = document.getElementById(`ad-ach-st-${id}`);
  const cat = EC_ACH[id] || {};
  const entry = {};
  AD_ACH_FIELDS.forEach(([k]) => {
    const el = document.getElementById(`ad-ach-${k}-${id}`);
    const v = el ? el.value.trim() : '';
    // Храним только реально изменённые поля (отличные от каталога).
    if (v && v !== (cat[k] || '')) entry[k] = v;
  });
  AD.achOv = AD.achOv || {};
  if (Object.keys(entry).length) AD.achOv[id] = entry; else delete AD.achOv[id];
  try {
    if (st) st.textContent = 'Сохранение…';
    if (!(await adAchPushOv(st))) return;
    // Живой оверлей в каталоге, чтобы игра и превью сразу видели правки.
    if (typeof EC_ACH !== 'undefined' && EC_ACH[id]) {
      AD_ACH_FIELDS.forEach(([k]) => { if (entry[k] != null) EC_ACH[id][k] = entry[k]; });
    }
    if (st) st.textContent = 'Готово ✓';
    toast(`Подписи «${id}» сохранены`, 'ok');
  } catch (e) {
    console.error('[admin] ach save', e);
    if (st) st.textContent = 'Ошибка';
    toast('Не удалось сохранить: ' + (e.message || e), 'err');
  }
}
async function adAchResetText(id) {
  if (!(AD.achOv && AD.achOv[id])) { toast('У этой ачивки нет правок', 'ok'); return; }
  if (!confirm(`Сбросить подписи «${id}» к каталогу по умолчанию?`)) return;
  delete AD.achOv[id];
  const st = document.getElementById(`ad-ach-st-${id}`);
  try {
    if (!(await adAchPushOv(st))) return;
    toast(`Подписи «${id}» сброшены — обнови страницу, чтобы увидеть каталожные`, 'ok');
    adPaint();
  } catch (e) { toast('Не удалось сбросить: ' + (e.message || e), 'err'); }
}
async function adAchArtUpload(id, inputEl) {
  const f = inputEl && inputEl.files && inputEl.files[0];
  const st = document.getElementById(`ad-ach-st-${id}`);
  if (!f) return;
  if (st) st.textContent = 'Проверка сервера…';
  if (!(await adPortServerAlive())) {
    if (st) st.textContent = 'нет сервера';
    toast('Запусти локальный аплоад-сервер: node tools/upload-server.js', 'err');
    return;
  }
  try {
    if (st) st.textContent = 'Сохранение…';
    // Арт ачивок — webp (как ждёт economy.js). compressImageFile отдаёт image/webp.
    const cf = (typeof compressImageFile === 'function') ? await compressImageFile(f, 960, 0.85) : f;
    const r  = await fetch(`${AD_PORT_SERVER}/upload?dir=ach&name=${encodeURIComponent(id + '.webp')}`, {
      method: 'POST', headers: { 'Content-Type': cf.type || 'image/webp' }, body: cf
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok || !j.url) throw new Error(j.error || ('сервер: HTTP ' + r.status));
    AD.achBust = Date.now();
    if (st) st.textContent = 'Готово ✓';
    toast(`Арт ачивки «${id}» сохранён`, 'ok');
    adPaint();
  } catch (e) {
    console.error('[admin] ach art', e);
    if (st) st.textContent = 'Ошибка';
    toast('Не удалось сохранить арт: ' + (e.message || e), 'err');
  }
}

// ── Текстуры классов планет (assets/map/planets/planet_<класс>.png) ──
// Карта (galaxy_map.js, gmmPaintBody) накладывает их на шар по «виду» мира.
// Файлы пишутся в папку игры тем же локальным сервером, что и портреты.
const AD_PLANET_DIR = 'assets/map/planets';
const AD_PLANET_CLASSES = [
  ['gas',    '🪐 Газовые гиганты',      'Газовые / ледяные / горячие гиганты — полосатые'],
  ['terran', '🌍 Землеподобные',         'Земные, столичные, миры жизни — материки'],
  ['ocean',  '🌊 Океанические',          'Сплошной океан'],
  ['ice',    '❄️ Ледяные / криомиры',    'Замёрзшие миры'],
  ['lava',   '🌋 Вулканические / лава',  'Раскалённые миры'],
  ['rock',   '🪨 Каменистые / пустыни',  'Пустынные, экзотические, малые тела, камень'],
];
function adPlanetTexPanel() {
  AD.planetTexTs = AD.planetTexTs || {};
  const rows = AD_PLANET_CLASSES.map(([look, title, desc]) => {
    const ts = AD.planetTexTs[look] || '';
    const src = `${AD_PLANET_DIR}/planet_${look}.png${ts ? '?t=' + ts : ''}`;
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--w2,#2a3340);border-radius:9px;background:var(--b1,#0f141b)">
      <div style="width:60px;height:60px;border-radius:50%;flex-shrink:0;border:1px solid var(--w2,#2a3340);background:#0c1322 center/cover no-repeat;background-image:url('${src}')"></div>
      <div style="min-width:0;flex:1">
        <div style="font-weight:700;color:var(--t1,#e8edf2)">${title}</div>
        <div style="font-size:11px;color:var(--t3,#8aa0b0);margin-top:2px">${desc}</div>
      </div>
      <input id="ad-ptex-file-${look}" type="file" accept="image/*" style="font-size:12px;max-width:200px;color:var(--t3,#8aa0b0)">
      <button class="btn btn-gd btn-sm" onclick="adPlanetTexUpload('${look}')" style="white-space:nowrap">⬇ Залить</button>
      <span id="ad-ptex-status-${look}" style="font-size:12px;color:var(--t3,#8aa0b0);min-width:60px"></span>
    </div>`;
  }).join('');
  return `<div style="margin-top:24px;border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b2,#141a22);padding:16px 18px">
    <div style="font-family:var(--font-display,sans-serif);font-size:16px;font-weight:700;color:var(--gdl,#5fb0e6)">🪐 Текстуры классов планет</div>
    <div style="font-size:12px;color:var(--t3,#8aa0b0);margin:6px 0 4px">Залей по одной картинке на класс — карта наложит её на шар (свет, тень, атмосфера, вращение добавляются автоматически). Подходят квадратные картинки с диском планеты по центру; углы обрежутся в круг. Миры без своей индивидуальной картинки берут текстуру по классу.</div>
    <div style="font-size:11px;color:var(--t4,#6a7a88);margin:0 0 12px;line-height:1.5">📁 Пишется <b>прямо в папку игры</b> <code>${AD_PLANET_DIR}/</code>. Запусти один раз: <code>node tools/upload-server.js</code> и держи окно открытым. После заливки <b>обнови страницу игры</b>, чтобы карта подхватила новую картинку.</div>
    <div style="display:flex;flex-direction:column;gap:8px">${rows}</div>
  </div>${adPlanetSubPanel()}`;
}
// ── Текстуры ПОДКЛАССОВ планет (глобальные, по каталогу видов) ─────
// Каждый вид планеты из каталога (Терра, Литара, Турмион…) может иметь свою
// картинку cls_<id>.png. У кого её нет — карта берёт родительский КЛАСС (выше).
// Файл фиксированного имени, перезаписью; путь не пишется в БД — карта сама
// пробует cls_<id>.png и откатывается на класс при 404.
function adPlanetSubList() {
  const cat = (window.GalaxyGen && GalaxyGen.PLANET_CLASSES) || [];
  // только реальные виды (не псевдо-группы grp_*) и не аномалии
  return cat.filter(c => c && c.id && String(c.id).indexOf('grp_') !== 0 && c.g !== 'anomaly');
}
// Родительский КЛАСС (look) по группе вида — то же, что gmmLook на карте берёт по
// группе планеты. Превью подкласса откатывается на planet_<look>.png этого класса.
function adGroupLook(g) {
  return ({
    gasgiant: 'gas', icegiant: 'gas', hotgiant: 'gas',
    oceanic: 'ocean', terrestrial: 'terran', cryo: 'ice',
    lava: 'lava', volcanic: 'lava',
    desert: 'rock', exotic: 'rock', micro: 'rock',
  })[g] || 'rock';
}
function adPlanetSubPanel() {
  const list = adPlanetSubList();
  if (!list.length) {
    return `<div style="margin-top:24px;border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b2,#141a22);padding:16px 18px;font-size:12px;color:var(--t3,#8aa0b0)">
      🌍 Текстуры подклассов: каталог планет не загружен (galaxy_gen.js).</div>`;
  }
  AD.subTexTs = AD.subTexTs || {};
  // группируем по родительской группе для читаемости
  const byGroup = {};
  list.forEach(c => { (byGroup[c.group || c.g] = byGroup[c.group || c.g] || []).push(c); });
  const sections = Object.keys(byGroup).map(grp => {
    const rows = byGroup[grp].map(c => {
      const look = adGroupLook(c.g);
      const ts = AD.subTexTs[c.id] ? '?t=' + AD.subTexTs[c.id] : '';
      const sub = `${AD_PLANET_DIR}/cls_${c.id}.png${ts}`;
      const parent = `${AD_PLANET_DIR}/planet_${look}.png`;
      // <img> с откатом: нет своей cls_*.png → показываем родительский класс
      return `<div style="display:flex;align-items:center;gap:12px;padding:9px 12px;border:1px solid var(--w2,#2a3340);border-radius:9px;background:var(--b1,#0f141b)">
        <div style="width:46px;height:46px;border-radius:50%;flex-shrink:0;border:1px solid var(--w2,#2a3340);overflow:hidden;background:#0c1322">
          <img src="${sub}" data-parent="${parent}" onerror="if(this.src.indexOf('planet_')<0){this.src=this.dataset.parent}" style="width:100%;height:100%;object-fit:cover;display:block">
        </div>
        <div style="min-width:0;flex:1">
          <div style="font-weight:700;color:var(--t1,#e8edf2)">${c.icon ? c.icon + ' ' : ''}${esc(c.name)}</div>
          <div style="font-size:11px;color:var(--t3,#8aa0b0);margin-top:2px">id <code>${esc(c.id)}</code> · класс «${esc(look)}»</div>
        </div>
        <input id="ad-sub-file-${esc(c.id)}" type="file" accept="image/*" style="font-size:12px;max-width:170px;color:var(--t3,#8aa0b0)">
        <button class="btn btn-gd btn-sm" onclick="adPlanetSubUpload('${esc(c.id)}','${esc(look)}')" style="white-space:nowrap">⬇ Залить</button>
        <span id="ad-sub-st-${esc(c.id)}" style="font-size:12px;color:var(--t3,#8aa0b0);min-width:54px"></span>
      </div>`;
    }).join('');
    return `<div style="margin-top:10px"><div style="font-size:12px;font-weight:700;color:var(--gdl,#5fb0e6);margin:4px 0 6px">${esc(grp)}</div>
      <div style="display:flex;flex-direction:column;gap:6px">${rows}</div></div>`;
  }).join('');
  return `<div style="margin-top:24px;border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b2,#141a22);padding:16px 18px">
    <div style="font-family:var(--font-display,sans-serif);font-size:16px;font-weight:700;color:var(--gdl,#5fb0e6)">🌍 Текстуры подклассов планет</div>
    <div style="font-size:12px;color:var(--t3,#8aa0b0);margin:6px 0 4px">Каждому виду планеты можно дать <b>свою</b> картинку. У кого своей нет — карта берёт родительский класс (секция выше). Превью показывает либо свою, либо родительскую.</div>
    <div style="font-size:11px;color:var(--t4,#6a7a88);margin:0 0 6px;line-height:1.5">📁 Пишется в <code>${AD_PLANET_DIR}/cls_&lt;id&gt;.png</code> сервером <code>node tools/upload-server.js</code>. После заливки обнови страницу игры.</div>
    ${sections}
  </div>`;
}
async function adPlanetSubUpload(id, look) {
  const fileEl = document.getElementById('ad-sub-file-' + id);
  const status = document.getElementById('ad-sub-st-' + id);
  const f = fileEl && fileEl.files && fileEl.files[0];
  if (!f) { if (status) status.textContent = 'выбери файл'; return; }
  if (!(await adPortServerAlive())) {
    if (status) status.textContent = 'сервер не запущен';
    toast('Запусти локальный аплоад-сервер: node tools/upload-server.js', 'err');
    return;
  }
  if (status) status.textContent = 'заливка…';
  try {
    const cf = (typeof compressImageFile === 'function') ? await compressImageFile(f, 1024, 0.9) : f;
    // фиксированное имя cls_<id>.png (перезаписью) — карта ищет именно его
    const r = await fetch(`${AD_PORT_SERVER}/upload?dir=planets&name=cls_${encodeURIComponent(id)}.png`, {
      method: 'POST', headers: { 'Content-Type': cf.type || 'application/octet-stream' }, body: cf
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok || !j.url) throw new Error(j.error || ('сервер: HTTP ' + r.status));
    AD.subTexTs = AD.subTexTs || {}; AD.subTexTs[id] = Date.now();   // бьём кэш превью
    if (status) status.textContent = '✓ готово';
    toast(`Текстура подкласса «${id}» сохранена → ${j.url}`, 'ok');
    adPaint();
  } catch (e) {
    console.error('[admin] planet sub tex', e);
    if (status) status.textContent = 'ошибка';
    toast('Не залилось: ' + (e.message || e), 'err');
  }
}
async function adPlanetTexUpload(look) {
  const fileEl = document.getElementById('ad-ptex-file-' + look);
  const status = document.getElementById('ad-ptex-status-' + look);
  const f = fileEl && fileEl.files && fileEl.files[0];
  if (!f) { if (status) status.textContent = 'Выбери файл'; return; }
  if (status) status.textContent = 'Проверка…';
  if (!(await adPortServerAlive())) {
    if (status) status.textContent = 'Сервер не запущен';
    toast('Запусти локальный аплоад-сервер: node tools/upload-server.js', 'err');
    return;
  }
  if (status) status.textContent = 'Заливка…';
  try {
    const cf = (typeof compressImageFile === 'function') ? await compressImageFile(f, 1024, 0.9) : f;
    // имя ФИКСИРОВАННОЕ с .png — карта ищет planet_<look>.png; <img>/canvas
    // декодируют по содержимому, поэтому JPEG-байты в .png рендерятся нормально.
    const r = await fetch(`${AD_PORT_SERVER}/upload?dir=planets&name=planet_${look}.png`, {
      method: 'POST', headers: { 'Content-Type': cf.type || 'application/octet-stream' }, body: cf
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok || !j.url) throw new Error(j.error || ('сервер: HTTP ' + r.status));
    AD.planetTexTs = AD.planetTexTs || {}; AD.planetTexTs[look] = Date.now();   // бьём кэш превью
    if (status) status.textContent = '✓ готово';
    toast(`Текстура «${look}» сохранена → ${j.url}`, 'ok');
    adPaint();
  } catch (e) {
    console.error('[admin] planet tex', e);
    if (status) status.textContent = 'ошибка';
    toast('Не залилось: ' + (e.message || e), 'err');
  }
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
function adSetTab(t) {
  AD.tab = t || 'factions';
  adPaint();
  if (AD.tab === 'market' && !AD.market) adMarketLoad();
  if (AD.tab === 'roadmap' && !(AD.rm && AD.rm.loaded)) adRmLoad();
}

// ── Рынок NPC: загрузка состояния (config + ресурсы) через admin-RPC ──────────
async function adMarketLoad() {
  try { AD.market = await adRpc('admin_market_status'); }
  catch (e) { AD.market = { error: e.message }; }
  adPaint();
}

// ── Новости игроков: лента всех публикаций + нейро-вердикты ───────────────────
// Грузим только авторские новости (owner_id задан), свежие сверху.
async function adNewsLoad() {
  try {
    AD.news = await dbGet('faction_news',
      'owner_id=not.is.null&order=created_at.desc&limit=120'
      + '&select=id,title,body,faction_name,faction_color,faction_id,owner_id,status,published_at,created_at,ai_verdict,staff_verdict')
      || [];
  } catch (e) { AD.news = { error: e.message }; }
  adPaint();
}

// Запросить/переоценить нейро-вердикт по новости из админ-ленты.
async function adNewsVerdict(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '🧠 Оцениваю…'; }
  let token = (typeof SB_ANON !== 'undefined') ? SB_ANON : '';
  try { token = await getTokenFresh(); } catch (e) {}
  try {
    const r = await fetch(FN_AI_VERDICT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: (typeof SB_ANON !== 'undefined' ? SB_ANON : ''), Authorization: 'Bearer ' + token },
      body: JSON.stringify({ news_id: id }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) { toast('Нейро-оценка: ' + (d.error || ('HTTP ' + r.status)), 'err'); }
    else {
      const v = d.verdict || {};
      toast('Нейро-оценка готова: ' + (v.verdict || '—') + (v.ok === false ? ' (модель не ответила корректно)' : ''), 'ok');
      // Подтянуть свежую строку и обновить кэш ленты.
      try {
        const rows = await dbGet('faction_news', `id=eq.${encodeURIComponent(id)}&limit=1`);
        if (rows && rows[0] && Array.isArray(AD.news)) {
          const i = AD.news.findIndex(n => n.id === id);
          if (i >= 0) AD.news[i] = Object.assign({}, AD.news[i], rows[0]);
        }
      } catch (e) {}
    }
  } catch (e) { toast('Нейро-оценка: ' + (e.message || String(e)), 'err'); }
  finally { adPaint(); }
}

// Раскрыть/свернуть полный текст новости в админ-ленте.
function adNewsToggle(id) {
  AD.newsOpen = AD.newsOpen || {};
  AD.newsOpen[id] = !AD.newsOpen[id];
  adPaint();
}

// Удалить новость из админ-ленты.
async function adNewsDelete(id) {
  if (!confirm('Удалить новость безвозвратно?')) return;
  try {
    await dbDel('faction_news', `id=eq.${encodeURIComponent(id)}`);
    if (Array.isArray(AD.news)) AD.news = AD.news.filter(n => n.id !== id);
    toast('Удалено', 'ok');
    adPaint();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

function adNewsPanel() {
  const wrap = 'border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b2,#141a22);padding:16px 18px;margin-top:18px';
  const list = AD.news;
  if (!list) return `<div style="${wrap}">Загрузка новостей…</div>`;
  if (list.error) return `<div style="${wrap};color:#ff7a7a">Ошибка: ${esc(list.error)}</div>`;
  if (!list.length) return `<div style="${wrap};color:var(--t3,#8aa0b0)">Пока нет новостей от игроков.</div>`;

  const vMeta = (typeof FN_AI_LABELS !== 'undefined') ? FN_AI_LABELS : {};
  const cardCss = 'border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b1,#0f141b);padding:12px 14px;display:flex;flex-direction:column;gap:8px';
  const rows = list.map(n => {
    const v = n.ai_verdict;
    const meta = v ? (vMeta[v.verdict] || vMeta.review || {}) : null;
    const vColor = meta && meta.cls === 'ok' ? '#5fd08a' : meta && meta.cls === 'bad' ? '#ff7a7a' : meta && meta.cls === 'mid' ? '#e6c25f' : 'var(--t4,#6a7a88)';
    const badge = v
      ? `<span style="font-size:11px;color:${vColor};border:1px solid ${vColor};border-radius:5px;padding:2px 7px" title="${esc((v.ruling || v.reason || '').slice(0, 200))}">🧠 ${esc((meta && meta.ic) || '')} ${esc((meta && meta.t) || v.verdict || '')}${v.injection ? ' ⚠' : ''}</span>`
      : `<span style="font-size:11px;color:var(--t4,#6a7a88);border:1px dashed var(--w2,#2a3340);border-radius:5px;padding:2px 7px">нет вердикта</span>`;
    const staff = n.staff_verdict ? `<span style="font-size:11px;color:var(--gdl,#5fb0e6)" title="${esc((n.staff_verdict || '').slice(0,200))}">⚖ есть вердикт админа</span>` : '';
    const fac = n.faction_name ? esc(n.faction_name.toUpperCase()) : 'ФРАКЦИЯ';
    const accent = n.faction_color || 'var(--gd,#3a7fbf)';
    const full = (n.body || '').replace(/\s+/g, ' ').trim();
    const open = !!(AD.newsOpen && AD.newsOpen[n.id]);
    const long = full.length > 220;
    const bodyHtml = open
      ? `<div style="font-size:12px;color:var(--t2,#c2d0db);line-height:1.6;white-space:pre-wrap">${esc((n.body || '').trim())}</div>`
      : `<div style="font-size:12px;color:var(--t3,#8aa0b0);line-height:1.5">${esc(full.slice(0, 220))}${long ? '…' : ''}</div>`;
    const readBtn = long
      ? `<button class="btn btn-gh btn-xs" onclick="adNewsToggle('${esc(n.id)}')">${open ? '▲ Свернуть' : '📖 Читать полностью'}</button>`
      : '';
    return `<div style="${cardCss};border-left:3px solid ${esc(accent)}">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
        <span style="font-size:11px;font-weight:700;letter-spacing:.06em;color:${esc(accent)}">${fac}</span>
        <span style="font-size:10px;color:var(--t4,#6a7a88);margin-left:auto">${esc((typeof fnStardate === 'function') ? fnStardate(n.published_at || n.created_at) : (n.created_at || ''))}</span>
      </div>
      <div style="font-size:14px;font-weight:600;color:var(--t1,#e8edf2)">${esc(n.title || 'Без заголовка')}</div>
      ${bodyHtml}
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:2px">
        ${badge}${staff}
        <span style="margin-left:auto;display:flex;gap:6px">
          ${readBtn}
          <button class="btn btn-gd btn-xs" onclick="adNewsVerdict('${esc(n.id)}', this)">🧠 ${v ? 'Переоценить' : 'Вердикт'}</button>
          <button class="btn btn-gh btn-xs" onclick="adNewsDelete('${esc(n.id)}')">🗑 Удалить</button>
        </span>
      </div>
    </div>`;
  }).join('');

  return `<div style="${wrap}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <div style="font-family:var(--font-display,sans-serif);font-size:16px;font-weight:700;color:var(--gdl,#5fb0e6)">📰 Новости игроков</div>
      <span style="font-size:12px;color:var(--t3,#8aa0b0)">${list.length}${list.length >= 120 ? ' (последние)' : ''}</span>
      <button class="btn btn-gh btn-sm" style="margin-left:auto" onclick="AD.news=null;adNewsLoad()">↻ Обновить</button>
    </div>
    <div style="font-size:12px;color:var(--t3,#8aa0b0);margin-bottom:12px;line-height:1.5">Все публикации игроков с нейро-вердиктами. Кнопка «🧠 Вердикт» запросит нейро-оценку (или переоценит), «🗑 Удалить» уберёт новость безвозвратно.</div>
    <div style="display:flex;flex-direction:column;gap:10px">${rows}</div>
  </div>`;
}

// Глобальная ручка рынка: собрать значения полей и отправить
async function adMarketCfgSave() {
  const f = id => { const el = document.getElementById(id); const v = el ? parseFloat(el.value) : NaN; return Number.isFinite(v) ? v : null; };
  try {
    await adRpc('admin_market_config_set', {
      p_elasticity: f('mc-elasticity'), p_clamp_lo: f('mc-clamp_lo'), p_clamp_hi: f('mc-clamp_hi'),
      p_reversion: f('mc-reversion'), p_volatility: f('mc-volatility'), p_npc_react: f('mc-npc_react'),
      p_walk: f('mc-walk'), p_shock_chance: f('mc-shock_chance'), p_player_sell: f('mc-player_sell'),
    });
    toast('Настройки рынка сохранены', 'ok'); await adMarketLoad();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

// Массовая ручка NPC: задать поток как долю равновесия для всех ресурсов
async function adMarketNpcBulk() {
  const s = parseFloat((document.getElementById('mc-bulk-supply') || {}).value);
  const dm = parseFloat((document.getElementById('mc-bulk-demand') || {}).value);
  try {
    await adRpc('admin_market_npc_bulk', { p_supply_frac: Number.isFinite(s) ? s : 0.03, p_demand_frac: Number.isFinite(dm) ? dm : 0.03 });
    toast('NPC-поток обновлён для всех ресурсов', 'ok'); await adMarketLoad();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

// Правка одного ресурса
async function adMarketResSave(name) {
  const f = key => { const el = document.getElementById('mr-' + key + '-' + name.replace(/[^a-zа-я0-9]/gi, '_')); const v = el ? parseFloat(el.value) : NaN; return Number.isFinite(v) ? v : null; };
  try {
    await adRpc('admin_market_resource_set', {
      p_name: name, p_npc_supply: f('sup'), p_npc_demand: f('dem'),
      p_equilibrium: f('eq'), p_base_price: f('base'), p_stock: f('stock'),
    });
    toast('Ресурс «' + name + '» обновлён', 'ok'); await adMarketLoad();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

function adMarketPanel() {
  const m = AD.market;
  const wrap = 'border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b2,#141a22);padding:16px 18px;margin-top:18px';
  if (!m) return `<div style="${wrap}">Загрузка состояния рынка…</div>`;
  if (m.error) return `<div style="${wrap};color:#ff7a7a">Ошибка: ${esc(m.error)}<br><span style="font-size:11px;color:var(--t4,#6a7a88)">Применён ли _mining_market_routing.sql в Supabase?</span></div>`;
  const c = m.config || {};
  const inp = 'width:74px;padding:5px 7px;font-size:12px;background:var(--b1,#0f141b);color:var(--t1,#e8edf2);border:1px solid var(--w2,#2a3340);border-radius:6px';
  const cfgField = (key, label, hint) => `<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--t3,#8aa0b0)" title="${esc(hint)}">${esc(label)}<input id="mc-${key}" type="number" step="0.01" value="${c[key] != null ? c[key] : ''}" style="${inp}"></label>`;
  const cfgBlock = `<div style="${wrap}">
    <div style="font-family:var(--font-display,sans-serif);font-size:16px;font-weight:700;color:var(--gdl,#5fb0e6)">🏪 Глобальный рынок · NPC и баланс цен</div>
    <div style="font-size:12px;color:var(--t3,#8aa0b0);margin:6px 0 12px;line-height:1.5">Цена ресурса = базовая × (равновесие / запас)<sup>эластичность</sup>, обрезано рамкой множителя. NPC-арбитраж тянет цену к базовой: <b>дорого → боты продают</b> (запас↑, цена↓), <b>дёшево → скупают</b>. Чем выше «реакция NPC», тем активнее рынок гасит скачки.</div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">
      ${cfgField('elasticity', 'Эластичность', 'Круче цена реагирует на дефицит/избыток. Меньше = плавнее. По умолч. 0.30')}
      ${cfgField('clamp_lo', 'Мин. множ.', 'Нижняя граница множителя цены к базе (0.50 = цена не ниже половины базы)')}
      ${cfgField('clamp_hi', 'Макс. множ.', 'Верхняя граница (2.50 = не выше 2.5× базы). Узкая рамка = меньше «до небес»')}
      ${cfgField('reversion', 'Возврат к равн.', 'Скорость возврата запаса к равновесию за сутки (0.15)')}
      ${cfgField('volatility', 'Волатильность', 'Случайный мультипликативный шум запаса/сут (0.02)')}
      ${cfgField('npc_react', 'Реакция NPC', 'Сила ценового арбитража ботов. Больше = быстрее гасят скачки (0.60)')}
      ${cfgField('walk', 'Блуждание', 'Остаточный случайный поток NPC (0.20)')}
      ${cfgField('shock_chance', 'Шанс шока', 'Базовый шанс событийного шока за прогон рынка (0.06)')}
      ${cfgField('player_sell', 'Сбыт игрока', 'Доля живой цены при сбыте добычи в режиме «🏪 на рынок» (0.80)')}
      <button class="btn btn-gd btn-sm" onclick="adMarketCfgSave()">💾 Сохранить</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-top:14px;padding-top:12px;border-top:1px dashed var(--w2,#2a3340)">
      <div style="font-size:12px;color:var(--t3,#8aa0b0)">Массово задать NPC-поток (доля равновесия/сут):</div>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--t3,#8aa0b0)">Добыча NPC<input id="mc-bulk-supply" type="number" step="0.01" value="0.03" style="${inp}"></label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--t3,#8aa0b0)">Спрос NPC<input id="mc-bulk-demand" type="number" step="0.01" value="0.03" style="${inp}"></label>
      <button class="btn btn-gh btn-sm" onclick="adMarketNpcBulk()">Применить ко всем</button>
    </div>
  </div>`;

  const rows = (m.resources || []).map(r => {
    const sfx = r.name.replace(/[^a-zа-я0-9]/gi, '_');
    const ratio = r.base_price ? (r.price / r.base_price) : 1;
    const col = ratio > 1.3 ? '#e0688a' : (ratio < 0.77 ? '#5fc98a' : 'var(--t2,#b8c4d0)');
    const ri = `width:78px;padding:4px 6px;font-size:11px;background:var(--b1,#0f141b);color:var(--t1,#e8edf2);border:1px solid var(--w2,#2a3340);border-radius:5px`;
    const cell = (key, val) => `<input id="mr-${key}-${sfx}" type="number" value="${Math.round(val)}" style="${ri}">`;
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--w2,#2a3340);flex-wrap:wrap">
      <span style="min-width:150px;font-size:12px;color:var(--t1,#e8edf2)">${esc(r.name)}</span>
      <span style="min-width:92px;font-size:11px;color:${col}" title="живая цена / база">💰 ${(+r.price).toFixed(1)} <span style="color:var(--t4,#6a7a88)">(×${ratio.toFixed(2)})</span></span>
      <label style="font-size:10px;color:var(--t4,#6a7a88)">база ${cell('base', r.base_price)}</label>
      <label style="font-size:10px;color:var(--t4,#6a7a88)">равнов. ${cell('eq', r.equilibrium)}</label>
      <label style="font-size:10px;color:var(--t4,#6a7a88)">запас ${cell('stock', r.stock)}</label>
      <label style="font-size:10px;color:var(--t4,#6a7a88)">⛏ добыча ${cell('sup', r.npc_supply)}</label>
      <label style="font-size:10px;color:var(--t4,#6a7a88)">🛒 спрос ${cell('dem', r.npc_demand)}</label>
      <button class="btn btn-gh btn-xs" onclick="adMarketResSave('${esc(r.name).replace(/'/g, "\\'")}')">✔</button>
    </div>`;
  }).join('') || '<div style="color:var(--t4,#6a7a88);font-size:12px;padding:12px">Рынок пуст — применён ли _market_setup.sql?</div>';
  const resBlock = `<div style="${wrap}">
    <div style="font-family:var(--font-display,sans-serif);font-size:15px;font-weight:700;color:var(--gdl,#5fb0e6)">📦 Ресурсы рынка <span style="font-size:11px;font-weight:400;color:var(--t4,#6a7a88)">· ${(m.resources || []).length} · «добыча NPC» = сколько боты вбрасывают, «спрос NPC» = сколько скупают</span></div>
    <div style="margin-top:10px">${rows}</div>
  </div>`;
  return cfgBlock + resBlock;
}

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

  // ── Товары (особый ресурс Фабрики: бренд + цена) ──
  const goodsStock = Math.floor(Number(res['Товары'] || 0));
  const goodsBrand = e.eco.goods_brand || '';
  const goodsPrice = Number(e.eco.goods_price ?? 14);
  const goodsBlock = `
    <div class="fm-section-title" style="margin-top:4px">🛍 Товары (бренд)</div>
    <div style="padding:8px 10px;border:1px solid var(--w1,#1e2630);border-radius:8px;background:var(--bg2,#121821)">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="flex:1;min-width:120px;font-size:13px;color:var(--t1,#e8edf2)">На складе: <b>${adNum(goodsStock)}</b> ед.</span>
        <input class="fi" id="fm-goods-amt" type="number" value="100" min="1" style="width:80px" placeholder="Кол-во">
        <button class="btn btn-gd btn-xs" onclick="adGoodsAdd()">+ Выдать</button>
        <button class="btn btn-gd btn-xs" onclick="adGoodsAddAmt(500)">+500</button>
        <button class="btn btn-gd btn-xs" onclick="adGoodsAddAmt(1000)">+1к</button>
        <button class="btn btn-rd btn-xs" onclick="adGoodsAddAmt(-100)">−100</button>
        <button class="btn btn-rd btn-xs" onclick="adGoodsZero()" title="Обнулить товары">✕</button>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px">
        <input class="fi" id="fm-goods-brand" value="${esc(goodsBrand)}" placeholder="Название бренда" style="flex:2;min-width:160px">
        <input class="fi" id="fm-goods-price" type="number" min="1" value="${goodsPrice}" style="width:90px" title="Цена за ед.">
        <span style="font-size:11px;color:var(--t3,#8aa0b0)">ГС/ед.</span>
        <button class="btn btn-gh btn-sm" onclick="adGoodsSetBrand()">✓ Сохранить бренд/цену</button>
      </div>
    </div>`;

  return `<div class="fm-resources">
    <div class="fm-section-title">Текущие ресурсы на складе</div>
    <div class="fm-res-list">${curRows}</div>
    ${goodsBlock}
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

// ── Товары (бренд Фабрики): выдача + бренд/цена ──────────────────
async function adGoodsAdd() {
  const amt = Math.max(1, parseInt(document.getElementById('fm-goods-amt')?.value) || 0);
  return adGoodsAddAmt(amt);
}
async function adGoodsAddAmt(amt) {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) { toast('Нет экономики', 'err'); return; }
  const cur = Number(e.eco.resources?.['Товары'] || 0);
  const to  = Math.max(0, cur + amt);
  AD.busy = true;
  try {
    const res = { ...(e.eco.resources || {}), 'Товары': to };
    if (to === 0) delete res['Товары'];
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { resources: res });
    e.eco.resources = res;
    adLogGrant({ type: 'resource', name: 'Товары', delta: to - cur, to });
    toast(`Товары: ${adNum(to)}`, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}
async function adGoodsZero() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  AD.busy = true;
  try {
    const res = { ...(e.eco.resources || {}) }; delete res['Товары'];
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { resources: res });
    e.eco.resources = res;
    toast('Товары обнулены', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}
async function adGoodsSetBrand() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) { toast('Нет экономики', 'err'); return; }
  const brand = document.getElementById('fm-goods-brand')?.value?.trim() || null;
  const price = Math.max(1, Math.round(parseFloat(document.getElementById('fm-goods-price')?.value) || 14));
  AD.busy = true;
  try {
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { goods_brand: brand, goods_price: price });
    e.eco.goods_brand = brand; e.eco.goods_price = price;
    toast(`Бренд: ${brand || '—'} · ${price} ГС/ед.`, 'ok'); adPaint();
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
      <select class="fi" onchange="adPickColClass(this.value)" title="Выбрать класс планеты" style="flex:1">${adColClassOpts()}</select>
      <input class="fi" id="fm-col-ptype" placeholder="Тип (свой)" value="Столичный мир" style="flex:1">
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

// Опции дропдауна «класс планеты» для выдачи колонии (каталог генератора).
function adColClassOpts() {
  const cat = (window.GalaxyGen && GalaxyGen.PLANET_CLASSES) || [];
  let html = `<option value="">✎ свой класс</option>`;
  cat.forEach(c => { html += `<option value="${esc(c.name)}">${c.icon ? c.icon + ' ' : ''}${esc(c.name)}</option>`; });
  return html;
}
// Выбор класса из дропдауна — проставляем его в поле «Тип». Пустое — свой ввод.
function adPickColClass(name) {
  const inp = document.getElementById('fm-col-ptype');
  if (inp && name) inp.value = name;
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
    ${adTestSpySection()}
  </div>`;
}

// ── Подсекция: провести операцию шпионажа ОТ выбранной фракции ПРОТИВ другой ──
// Выдаёт разведку (базовую/глубокую) или запускает любую операцию мгновенно,
// без требований по интелу/агентам (admin_test_spy_op, _admin_test_spy.sql).
// Выбранная фракция (AD.sel) — исполнитель; цель выбирается из списка.
const AD_SPY_OPS = [
  ['recon_basic',   '🔍 Базовая разведка',     'Выдаёт исполнителю базовый срез по цели (казна, ОН, агенты, колонии, постройки). Открывает basic-операции против цели.'],
  ['recon_deep',    '🔬 Глубокая разведка',    'Полный срез: состав построек по колониям, юниты, число технологий. Открывает deep-операции против цели.'],
  ['steal_gc',      '💰 Кража казны',          'Крадёт долю ГС со счёта цели в пользу исполнителя.'],
  ['steal_res',     '📦 Кража ресурсов',       'Крадёт случайный ресурс со склада цели (объём растёт от числа «агентов»).'],
  ['steal_tech',    '🔬 Кража технологий',     'Похищает одну неизвестную исполнителю технологию цели.'],
  ['sabotage',      '💥 Саботаж',              'Уничтожает одно случайное здание цели.'],
  ['mass_demolish', '🧨 Массовый снос',        'Сносит N зданий цели (N = число «агентов», максимум 5).'],
  ['destabilize',   '🌀 Дестабилизация',       'Накладывает на цель дебафф −25% на 3 дня.'],
  ['kill_agent',    '🗡 Ликвидация агента',    'Убивает случайного готового агента цели.'],
  ['faith_impose',  '🛐 Насаждение веры',      'Навязывает цели веру исполнителя (нужна своя вера, цель — без веры).'],
];

function adTestSpySection() {
  const acts = AD.sel || '';
  const targets = [...AD.byFid.entries()]
    .filter(([fid]) => fid !== acts)
    .sort((a, b) => (a[1].app.name || '').localeCompare(b[1].app.name || '', 'ru'))
    .map(([fid, e]) => `<option value="${esc(fid)}">${esc(e.app.name)}${e.eco ? '' : ' (нет экономики)'}</option>`)
    .join('');
  const ops = AD_SPY_OPS.map(([code, lbl]) => `<option value="${esc(code)}">${esc(lbl)}</option>`).join('');
  return `<div class="fm-danger-act" style="align-items:flex-start;flex-direction:column;gap:10px">
    <div class="fm-danger-label" style="width:100%">
      <div>🕵 Провести операцию против фракции</div>
      <div class="fm-dim" style="font-size:11px;margin-top:3px;font-weight:400;line-height:1.4">Выбранная фракция выступает <b>исполнителем</b>. Операция выполняется мгновенно, с гарантированным успехом и без раскрытия — без требований по разведке/агентам. Разведка (базовая/глубокая) открывает соответствующие операции против цели.</div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;width:100%">
      <div style="display:flex;flex-direction:column;gap:3px;flex:1 1 200px">
        <label class="fm-dim" style="font-size:11px">Цель</label>
        <select id="ad-spy-target" class="ec-input" style="min-width:180px"><option value="">— выберите цель —</option>${targets}</select>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;flex:1 1 200px">
        <label class="fm-dim" style="font-size:11px">Операция</label>
        <select id="ad-spy-op" class="ec-input" style="min-width:200px" onchange="adSpyOpHint()">${ops}</select>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;width:96px">
        <label class="fm-dim" style="font-size:11px">«Агентов»</label>
        <input id="ad-spy-agents" type="number" min="1" max="5" value="2" class="ec-input" style="width:96px">
      </div>
      <button class="btn btn-gd" onclick="adTestSpyOp()">Провести</button>
    </div>
    <div id="ad-spy-hint" class="fm-dim" style="font-size:11px;line-height:1.4">${esc(AD_SPY_OPS[0][2])}</div>
  </div>`;
}

function adSpyOpHint() {
  const code = document.getElementById('ad-spy-op')?.value;
  const m = AD_SPY_OPS.find(o => o[0] === code);
  const el = document.getElementById('ad-spy-hint');
  if (el && m) el.textContent = m[2];
}

async function adTestSpyOp() {
  if (!AD.sel || AD.busy) return;
  const target = document.getElementById('ad-spy-target')?.value || '';
  const op = document.getElementById('ad-spy-op')?.value || '';
  const agents = Math.max(1, Math.min(5, parseInt(document.getElementById('ad-spy-agents')?.value, 10) || 1));
  if (!target) { toast('Выберите цель', 'err'); return; }
  if (!op) { toast('Выберите операцию', 'err'); return; }
  const opLabel = (AD_SPY_OPS.find(o => o[0] === op) || [, op])[1];
  const tgtName = (AD.byFid.get(target) || { app: {} }).app.name || target;
  if (!confirm(`Провести «${opLabel}» от фракции «${AD.byFid.get(AD.sel)?.app.name || AD.sel}» против «${tgtName}»?`)) return;
  AD.busy = true;
  try {
    const r = await apiFetch('rpc/admin_test_spy_op', { method: 'POST', body: JSON.stringify({ p_actor_fid: AD.sel, p_target_fid: target, p_op: op, p_agents: agents }) });
    const ok = r?.outcome === 'success';
    toast(`${opLabel} → ${tgtName}: ${ok ? 'успех' : 'без эффекта'}${adSpyResultLine(op, r?.result)}`, ok ? 'ok' : 'err');
    await adReloadPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// Короткая сводка результата операции для тоста.
function adSpyResultLine(op, res) {
  if (!res || typeof res !== 'object') return '';
  if (op === 'recon_basic' || op === 'recon_deep') return ` · разведка выдана`;
  if (op === 'steal_gc' && res.gc != null) return ` · ${adNum(res.gc)} ГС`;
  if (op === 'steal_res' && res.resource) return ` · ${res.amount} ${res.resource}`;
  if (op === 'steal_tech' && res.tech) return ` · «${res.tech}»`;
  if (op === 'sabotage' && res.building) return ` · снесено: ${res.building}`;
  if (op === 'mass_demolish' && res.count != null) return ` · снесено зданий: ${res.count}`;
  if (op === 'kill_agent' && res.agent_name) return ` · ${res.agent_name}`;
  if (op === 'faith_impose' && res.faith) return ` · «${res.faith}»`;
  if (res.note) return ` · ${res.note}`;
  return '';
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

// Мини-график (SVG-полилиния), масштаб по min/max ряда.
function adSpark(vals, w, h, color) {
  const a = (vals || []).map(Number).filter(Number.isFinite);
  if (a.length < 2) return `<svg width="${w}" height="${h}" style="display:block"></svg>`;
  const mn = Math.min(...a), mx = Math.max(...a), rng = (mx - mn) || 1;
  const pts = a.map((v, i) => {
    const x = (i / (a.length - 1)) * (w - 2) + 1;
    const y = h - 1 - ((v - mn) / rng) * (h - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const up = a[a.length - 1] >= a[0];
  return `<svg width="${w}" height="${h}" style="display:block">
    <polyline points="${pts}" fill="none" stroke="${color || (up ? '#5fc98a' : '#e0688a')}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

// ── Верхняя вкладка: Биржа (симуляция + объяснение, как работает) ───────────
function adMarketSimPanel() {
  const nf = v => (+v).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const sim = AD.marketSim;
  const idxSeries = AD.marketSimIdx || [];
  const hist = AD.marketSimHist || {};

  // ── Объяснение механики (раскрывашка) ──
  const explain = `<details open style="margin:0 0 14px;border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b2,#141a22)">
    <summary style="cursor:pointer;padding:11px 14px;font-weight:600;color:var(--gdl,#5fb0e6)">❔ Как работает биржа — коротко</summary>
    <div style="padding:0 16px 14px;font-size:13px;line-height:1.6;color:var(--t2,#c0ccd6)">
      <p style="margin:6px 0"><b>Официальный курс</b> — это цена, по которой считаются ставки игроков (маржа/фьючерсы/опционы). Игроки <b>не могут двигать её</b> своими сделками — только сама галактика. Поэтому накрутить цену под свою ставку нельзя.</p>
      <p style="margin:6px 0"><b>Движение:</b> курс шагает раз в <b>3 часа</b>. У каждого ресурса свой <b>тренд</b> (держится ~12 ч, потом может перекатиться), плюс лёгкий шум и возврат к базовой цене. Курс заперт в коридоре <b>×0.35…×2.80</b> от базы.</p>
      <p style="margin:6px 0"><b>Настрой = реакции + реальные события.</b> (а) Реакции игроков на новости за сутки (👍 +8 / 👎 −8) — перевес негатива наклоняет тренды вниз, позитива вверх; менять реакцию нельзя. (б) <b>Реальные события «Хроники сектора»</b> за 6 ч двигают курс по смыслу: удар <b>Длани/МЗА</b> (планета стёрта → дефицит → ресурсы <b>вверх</b>), <b>тайные операции/конфликты</b> (нестабильность → вверх), <b>дефолт</b> по облигациям (вниз), появление/рост фракций и союзы (спрос). Разрушение/конфликт дают паре ресурсов <b>резкий скачок вверх</b>.</p>
      <p style="margin:6px 0;color:var(--t3,#8aa0b0)">Игрок зарабатывает, угадав направление тренда и встав по нему с плечом. Дом берёт комиссию ≈0.5%, выплаты — из ограниченного резерва (печати денег нет).</p>
    </div>
  </details>`;

  // ── График индекса по твоим прогонам ──
  let idxChart = '';
  if (idxSeries.length >= 2) {
    const first = idxSeries[0], last = idxSeries[idxSeries.length - 1];
    const pct = first ? (last / first - 1) * 100 : 0;
    idxChart = `<div style="margin:0 0 14px;border:1px solid var(--w2,#2a3340);border-radius:10px;padding:12px 14px;background:var(--b2,#141a22)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:600">📊 Индекс рынка <span class="fm-dim" style="font-weight:400;font-size:11px">— по твоим прогонам (${idxSeries.length} точек)</span></span>
        <span>${nf(last)} <span style="color:${pct >= 0 ? 'var(--gd,#5fc98a)' : 'var(--err,#e0688a)'}">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span></span>
      </div>
      ${adSpark(idxSeries, 600, 70)}
    </div>`;
  }

  // ── Таблица результата последнего прогона + мини-графики по ресурсам ──
  let resultBlock = `<div class="fm-dim" style="margin-top:4px;font-size:12px">Нажми «Промотать биржу» — появятся графики и таблица «было → стало» по каждому ресурсу.</div>`;
  if (sim) {
    const changes = sim.changes || [];
    const idxB = +sim.index_before || 0, idxA = +sim.index_after || 0;
    const idxPct = idxB ? (idxA / idxB - 1) * 100 : 0;
    const t = sim.tick || {};
    const rows = changes.map(c => {
      const p = +c.pct || 0;
      const col = p > 0 ? 'var(--gd,#5fc98a)' : p < 0 ? 'var(--err,#e0688a)' : 'var(--t3,#8aa0b0)';
      const arr = p > 0 ? '▲' : p < 0 ? '▼' : '▬';
      const series = hist[c.name] || [];
      return `<tr style="border-top:1px solid var(--w2,#222c38)">
        <td style="padding:4px 10px">${esc(c.name)}</td>
        <td style="padding:4px 10px">${adSpark(series, 90, 24, col === 'var(--t3,#8aa0b0)' ? '#8aa0b0' : (p >= 0 ? '#5fc98a' : '#e0688a'))}</td>
        <td style="padding:4px 10px;text-align:right;color:var(--t3,#8aa0b0)">${nf(c.before)}</td>
        <td style="padding:4px 10px;text-align:right">→ <b>${nf(c.after)}</b> ГС</td>
        <td style="padding:4px 10px;text-align:right;color:${col}"><b>${arr} ${p > 0 ? '+' : ''}${p}%</b></td>
      </tr>`;
    }).join('');
    resultBlock = `<div style="margin-top:4px;border:1px solid var(--w2,#2a3340);border-radius:10px;overflow:hidden">
      <div style="padding:9px 12px;background:rgba(95,176,230,.10);font-size:12px;display:flex;flex-wrap:wrap;gap:16px;align-items:center">
        <span>Прогон: <b>${sim.steps} шаг(ов) ×3ч</b>${sim.days ? ` + <b>${sim.days} сут</b>` : ''}</span>
        <span>Индекс: ${nf(idxB)} → <b>${nf(idxA)}</b> <span style="color:${idxPct >= 0 ? 'var(--gd,#5fc98a)' : 'var(--err,#e0688a)'}">${idxPct >= 0 ? '+' : ''}${idxPct.toFixed(1)}%</span></span>
        <span>Настрой новостей: <b style="color:${(+t.mood || 0) > 0 ? 'var(--gd,#5fc98a)' : (+t.mood || 0) < 0 ? 'var(--err,#e0688a)' : 'var(--t2)'}">${t.mood ?? 0}</b></span>
        ${(() => { const ev = t.events || {}; const parts = []; if (+ev.destr) parts.push(`☠ разрушения: ${ev.destr}`); if (+ev.confl) parts.push(`⚠ конфликты: ${ev.confl}`); if (+ev.fin) parts.push(`🏛 дефолты: ${ev.fin}`); if (+ev.growth) parts.push(`⬡ рост: ${ev.growth}`); return parts.length ? `<span class="fm-dim" style="font-size:11px">события 6ч → ${parts.join(' · ')}</span>` : '<span class="fm-dim" style="font-size:11px">событий в ленте за 6ч нет</span>'; })()}
        ${t.shock ? '<span style="color:var(--gdl,#5fb0e6)">⚡ дефицитный шок от события</span>' : ''}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="color:var(--t3,#8aa0b0);font-size:10px;text-transform:uppercase;letter-spacing:.04em">
          <th style="text-align:left;padding:6px 10px">Ресурс</th>
          <th style="text-align:left;padding:6px 10px">График</th>
          <th style="text-align:right;padding:6px 10px">Было</th>
          <th style="text-align:right;padding:6px 10px">Стало</th>
          <th style="text-align:right;padding:6px 10px">Движение</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="5" style="padding:10px;text-align:center;color:var(--t3)">нет данных</td></tr>`}</tbody>
      </table>
    </div>`;
  }

  return `<div style="max-width:900px">
    ${explain}
    <div class="fm-danger-act" style="align-items:center;border:1px solid var(--w2,#2a3340);border-radius:10px;padding:12px 14px;margin-bottom:14px">
      <div class="fm-danger-label"><div style="font-weight:600">⏩ Промотать рынок вперёд</div><div class="fm-dim" style="font-size:11px;margin-top:3px;font-weight:400">Шаг = 3 часа курса. Сутки = прогон спот-рынка (NPC-сток). Глобально на весь сектор; заодно резолвятся ликвидации/экспирации.</div></div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
        <div style="display:flex;gap:6px;align-items:center">
          <label class="fm-dim" style="font-size:11px">шагов×3ч</label><input id="ad-mkt-steps" type="number" min="1" max="60" value="4" class="ec-input" style="width:70px">
          <label class="fm-dim" style="font-size:11px">суток</label><input id="ad-mkt-days" type="number" min="0" max="30" value="0" class="ec-input" style="width:64px">
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-gh btn-sm" onclick="adMarketSimReset()" title="Очистить графики">Сброс</button>
          <button class="btn btn-gd" onclick="adMarketAdvance()">Промотать биржу</button>
        </div>
      </div>
    </div>
    ${idxChart}
    ${resultBlock}
  </div>`;
}

// Очистить накопленные графики симуляции
function adMarketSimReset() {
  AD.marketSim = null; AD.marketSimIdx = []; AD.marketSimHist = {};
  adPaint();
}

// Промотать биржу: глобальный прогон курса (шаги по 3ч + опц. сутки спота).
// Копим серии для графиков (индекс + по ресурсам), результат в AD.marketSim.
async function adMarketAdvance() {
  if (AD.busy) return;
  const steps = Math.max(1, Math.min(60, parseInt(document.getElementById('ad-mkt-steps')?.value, 10) || 1));
  const days  = Math.max(0, Math.min(30, parseInt(document.getElementById('ad-mkt-days')?.value, 10) || 0));
  AD.busy = true;
  try {
    const r = await apiFetch('rpc/admin_test_market_advance', { method: 'POST', body: JSON.stringify({ p_steps: steps, p_days: days }) });
    AD.marketSim = r;
    // накопление серий для графиков
    if (!AD.marketSimIdx) AD.marketSimIdx = [];
    if (!AD.marketSimHist) AD.marketSimHist = {};
    if (!AD.marketSimIdx.length && r.index_before != null) AD.marketSimIdx.push(+r.index_before);
    if (r.index_after != null) AD.marketSimIdx.push(+r.index_after);
    (r.changes || []).forEach(c => {
      const h = AD.marketSimHist[c.name] || (AD.marketSimHist[c.name] = []);
      if (!h.length && c.before != null) h.push(+c.before);
      h.push(+c.after);
      if (h.length > 40) h.shift();
    });
    if (AD.marketSimIdx.length > 40) AD.marketSimIdx = AD.marketSimIdx.slice(-40);
    const t = r?.tick || {};
    toast(`Биржа промотана: ${r?.steps || 0}×3ч${r?.days ? ` +${r.days}сут` : ''} · настрой ${t.mood ?? 0}${t.shock ? ' · ⚡шок' : ''}`, 'ok');
    adPaint();
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

// ════════════════════════════════════════════════════════════════
//  ДОРОЖНАЯ КАРТА РАЗРАБОТКИ — планировщик задач и дедлайнов
//  Таблицы: dev_tasks + dev_roadmap_config (_dev_roadmap.sql).
//  Три уровня: «Приёмная» (пул) → «Дорожная карта» (авто-план) →
//  «Рассмотрение» (триаж: отказ/включение). Движок раскладки (WSJF +
//  упаковка по рабочему календарю) считается живьём здесь, на клиенте.
// ════════════════════════════════════════════════════════════════
const RM_PRIO   = { 1:{l:'Низкий',c:'#5a7a8a'}, 2:{l:'Средний',c:'#5fb0e6'}, 3:{l:'Высокий',c:'#e6a35f'}, 4:{l:'Критичный',c:'#e6655f'} };
const RM_STATUS = { pool:{l:'В пуле',c:'#8aa0b0'}, planned:{l:'В карте',c:'#5fb0e6'}, active:{l:'В работе',c:'#5fe6a3'}, testing:{l:'Тестирование',c:'#c08fe6'}, done:{l:'Завершено',c:'#7a8a6a'}, rejected:{l:'Отклонено',c:'#e6655f'} };
const RM_TEST_DAYS = 7; // задача в тестировании держится 7 дней, затем авто-завершение
const RM_CFG_DEF = { capacity_h:6, skip_weekends:true, w_value:1.0, w_priority:1.0, w_urgency:2.0, w_age:0.5, start_date:null };

// ── АВТО-ОЦЕНКА ТРУДОЗАТРАТ ──────────────────────────────────────
// «Направление» = реальная подсистема проекта, base = типичная база часов
// под её сложность/связность (экономика и карта тяжелее, текстуры легче).
// Для 'manual' (вне проекта) — оценка вводится руками. Каталог отражает то,
// что реально есть в репозитории (срезы _economy/_market/_exchange/_spy/…,
// зеркала economy.js/galaxy_map.js, админ-консоль и т.д.).
const RM_AREAS = [
  { id:'economy',  l:'Экономика / просперити',        base:14 },
  { id:'market',   l:'Рынок / цены / добыча',          base:12 },
  { id:'exchange', l:'Биржа / деривативы',             base:16 },
  { id:'spy',      l:'Шпионаж / агенты',               base:16 },
  { id:'faith',    l:'Вера / религия',                 base:14 },
  { id:'diplo',    l:'Дипломатия / союзы',             base:12 },
  { id:'defense',  l:'Оборона / орудия',               base:16 },
  { id:'fleet',    l:'Флоты / перемещение',            base:14 },
  { id:'map',      l:'Галактическая карта / рендер',   base:18 },
  { id:'research', l:'Технологии / древо',             base:12 },
  { id:'units',    l:'Юниты / конструктор',            base:14 },
  { id:'mining',   l:'Добыча / ресурсы',               base:12 },
  { id:'news',     l:'Новости / лента / события',      base:10 },
  { id:'admin',    l:'Админ-консоль / инструменты',    base:10 },
  { id:'ui',       l:'Общий UI / визуал',              base:8  },
  { id:'planets',  l:'Планеты / текстуры / локации',   base:8  },
  { id:'core',     l:'Ядро / Supabase / производит.',  base:12 },
  { id:'manual',   l:'⌨ Вне проекта — ввести вручную', base:0  },
];
const RM_WTYPES = [
  { id:'balance',  l:'Баланс / тюнинг чисел',          k:0.4 },
  { id:'bugfix',   l:'Багфикс',                         k:0.6 },
  { id:'mirror',   l:'Зеркало клиента (JS под SQL)',    k:0.7 },
  { id:'ui',       l:'UI-панель / вкладка',             k:1.0 },
  { id:'migration',l:'Миграция / бэкфилл данных',       k:1.2 },
  { id:'slice',    l:'Новый SQL-срез (логика)',         k:1.4 },
  { id:'refactor', l:'Рефактор / переработка',          k:1.6 },
  { id:'feature',  l:'Полная фича (SQL+клиент+UI)',     k:2.2 },
];
const RM_CPLX = [
  { id:'s', l:'Простая',        k:0.5 },
  { id:'m', l:'Средняя',        k:1.0 },
  { id:'l', l:'Крупная',        k:1.8 },
  { id:'xl',l:'Очень крупная',  k:3.0 },
];
// Возвращает оценку в часах (кратно 0.5, минимум 1). null = ручной ввод.
function adRmEstimate(areaId, typeId, cplxId) {
  if (areaId === 'manual') return null;
  const a = RM_AREAS.find(x => x.id === areaId) || RM_AREAS[0];
  const t = RM_WTYPES.find(x => x.id === typeId) || RM_WTYPES.find(x => x.id === 'slice');
  const c = RM_CPLX.find(x => x.id === cplxId) || RM_CPLX[1];
  const raw = a.base * t.k * c.k;
  return Math.max(1, Math.round(raw * 2) / 2);
}
function adRmAreaLabel(id) { const a = RM_AREAS.find(x => x.id === id); return a ? a.l : id; }
function adRmTypeLabel(id) { const t = RM_WTYPES.find(x => x.id === id); return t ? t.l : id; }

function adRmState() {
  if (!AD.rm) AD.rm = { loaded:false, loading:false, err:null, tasks:[], cfg:Object.assign({}, RM_CFG_DEF), level:'roadmap', editing:null, showRejected:false };
  return AD.rm;
}

// ── Загрузка задач + конфига ────────────────────────────────────
async function adRmLoad() {
  const S = adRmState();
  S.loading = true; S.err = null; adPaint();
  try {
    const [tasks, cfgRows] = await Promise.all([
      dbGet('dev_tasks', 'select=*&order=created_at.desc').catch(e => { throw e; }),
      dbGet('dev_roadmap_config', 'id=eq.1&select=*').catch(() => []),
    ]);
    S.tasks = (tasks || []).map(adRmNorm);
    // авто-завершение: «тестирование» истекло (прошло 7 дней) → завершено
    const now = Date.now();
    const expired = S.tasks.filter(t => t.status === 'testing' && t.testing_until && new Date(t.testing_until).getTime() <= now);
    for (const t of expired) {
      try { await dbPatch('dev_tasks', 'id=eq.' + t.id, { status:'done' }); t.status = 'done'; } catch (_) {}
    }
    const c = (cfgRows && cfgRows[0]) || {};
    S.cfg = Object.assign({}, RM_CFG_DEF, {
      capacity_h:Number(c.capacity_h ?? 6), skip_weekends:c.skip_weekends !== false,
      w_value:Number(c.w_value ?? 1), w_priority:Number(c.w_priority ?? 1),
      w_urgency:Number(c.w_urgency ?? 2), w_age:Number(c.w_age ?? 0.5),
      start_date:c.start_date || null,
    });
    S.loaded = true;
  } catch (e) {
    S.err = e.message || String(e);
    if (/relation .*dev_tasks.* does not exist|404|Not Found|PGRST205/i.test(S.err)) S.needSql = true;
  }
  S.loading = false; adPaint();
}
function adRmNorm(t) {
  t.priority = Number(t.priority) || 2;
  t.value    = Number(t.value); if (!t.value && t.value !== 0) t.value = 5;
  t.effort_h = Number(t.effort_h) || 0;
  t.progress = Number(t.progress) || 0;
  t.depends_on = Array.isArray(t.depends_on) ? t.depends_on.map(Number) : [];
  t.tags = Array.isArray(t.tags) ? t.tags : [];
  t.images = Array.isArray(t.images) ? t.images : [];
  return t;
}

// ── Утилиты дат/чисел ───────────────────────────────────────────
function adRmToday() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function adRmDayFloor(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function adRmClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
// idx-й рабочий день (0-based) от start (пропуская выходные, если skipW)
function adRmWorkDay(start, idx, skipW) {
  let d = adRmDayFloor(start), i = 0;
  while (true) {
    const wd = d.getDay();
    if (!skipW || (wd !== 0 && wd !== 6)) { if (i === idx) return new Date(d); i++; }
    d.setDate(d.getDate() + 1);
    if (i > 5000) return new Date(d);
  }
}
// рабочий-дневной индекс календарной даты относительно start
function adRmIdxOfDate(start, date, skipW) {
  const a = adRmDayFloor(start), b = adRmDayFloor(date);
  let cur = new Date(a), count = 0;
  if (b >= a) { while (cur < b) { cur.setDate(cur.getDate()+1); const wd=cur.getDay(); if (!skipW || (wd!==0 && wd!==6)) count++; } return count; }
  while (cur > b) { cur.setDate(cur.getDate()-1); const wd=cur.getDay(); if (!skipW || (wd!==0 && wd!==6)) count--; } return count;
}
function adRmFmtDate(d) { return d ? d.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit' }) : '—'; }
function adRmFmtFull(d) { return d ? d.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '—'; }

// ── ДВИЖОК ПЛАНИРОВЩИКА: WSJF + последовательная упаковка по календарю ──
// Один разработчик-ресурс (задачи не пересекаются). Порядок выбирается жадно
// по WSJF (Cost of Delay / размер) среди готовых (зависимости выполнены),
// дедлайны влияют на срочность → тянут задачу вперёд. Возвращает копии задач
// с проектными датами _startDate/_endDate, флагом _late и оценками.
function adRmSchedule(tasks, cfg) {
  const cap   = Math.max(0.5, Number(cfg.capacity_h) || 6);
  const skipW = !!cfg.skip_weekends;
  const W = { value:+cfg.w_value || 1, prio:+cfg.w_priority || 1, urg:+cfg.w_urgency || 2, age:+cfg.w_age || 0.5 };
  const start = cfg.start_date ? new Date(cfg.start_date + 'T00:00:00') : adRmToday();
  const today = adRmToday();
  const sched = tasks.filter(t => t.status === 'planned' || t.status === 'active');
  const byId  = new Map(tasks.map(t => [t.id, t]));

  sched.forEach(t => {
    const effortDays = Math.max(0.1, (Number(t.effort_h) || 0) / cap);
    const valueScore = adRmClamp(Number(t.value) || 5, 0, 10);
    const prioScore  = ({ 1:2.5, 2:5, 3:7.5, 4:10 })[t.priority] || 5;
    const ageDays    = Math.max(0, (today - new Date(t.created_at)) / 864e5);
    const ageScore   = Math.min(10, ageDays / 3);
    let urg;
    if (t.deadline) {
      const dl = new Date(t.deadline + 'T23:59:59');
      const daysToDl = (dl - today) / 864e5;
      const slack = daysToDl - effortDays;
      urg = slack <= 0 ? 10 : adRmClamp(10 * (1 - slack / 30), 0, 10);
    } else urg = 2;
    const cod = W.value*valueScore + W.prio*prioScore + W.urg*urg + W.age*ageScore;
    t._cod = cod; t._effortDays = effortDays; t._wsjf = cod / Math.max(0.5, effortDays);
    t._urg = urg; t._prioScore = prioScore; t._valueScore = valueScore;
  });

  const placed = new Map();
  const remaining = new Set(sched.map(t => t.id));
  let resourceFree = 0, guard = 0;
  while (remaining.size && guard++ < 10000) {
    const ready = [...remaining].map(id => byId.get(id)).filter(t =>
      (t.depends_on || []).filter(d => remaining.has(d)).length === 0);
    const cyc = ready.length === 0;
    const pool = cyc ? [...remaining].map(id => byId.get(id)) : ready;
    // активные — всегда вперёд (они уже в работе), далее по WSJF
    const pick = pool.sort((a, b) =>
      (b.status === 'active') - (a.status === 'active') || b._wsjf - a._wsjf)[0];
    let depFin = 0;
    (pick.depends_on || []).forEach(d => { const p = placed.get(d); if (p) depFin = Math.max(depFin, p.finishWH); });
    const s = Math.max(resourceFree, depFin);
    const f = s + (Number(pick.effort_h) || 0);
    placed.set(pick.id, { startWH:s, finishWH:f, cycle:cyc });
    resourceFree = f;
    remaining.delete(pick.id);
  }

  const out = sched.map(t => {
    const p = placed.get(t.id) || { startWH:0, finishWH:0 };
    const startIdx = Math.floor(p.startWH / cap);
    const endIdx   = Math.max(startIdx, Math.ceil(p.finishWH / cap) - 1);
    const startDate = adRmWorkDay(start, startIdx, skipW);
    const endDate   = adRmWorkDay(start, endIdx, skipW);
    let late = false, slackDays = null;
    if (t.deadline) {
      const dl = new Date(t.deadline + 'T23:59:59');
      late = endDate > dl;
      slackDays = Math.round((dl - endDate) / 864e5);
    }
    return Object.assign({}, t, { _startIdx:startIdx, _endIdx:endIdx, _startDate:startDate, _endDate:endDate, _late:late, _slackDays:slackDays, _cycle:p.cycle });
  }).sort((a, b) => a._startIdx - b._startIdx || b._wsjf - a._wsjf);
  out._start = start; out._cap = cap; out._skipW = skipW;
  return out;
}

// ── Главная панель ──────────────────────────────────────────────
function adRmPanel() {
  const S = adRmState();
  if (S.needSql) return adRmSqlHint();
  if (!S.loaded && !S.err) return `<div class="sload" style="min-height:160px"><div class="pulse-loader"></div></div>`;
  if (S.err && !S.loaded) return `<div style="color:#ff7a7a;padding:16px;border:1px solid #ff7a7a;border-radius:8px">Ошибка загрузки: ${esc(S.err)}<br><button class="btn btn-gh btn-sm" onclick="adRmLoad()" style="margin-top:8px">↺ Повторить</button></div>`;

  const pool   = S.tasks.filter(t => t.status === 'pool').length;
  const planned= S.tasks.filter(t => t.status === 'planned' || t.status === 'active').length;
  const levels = [
    ['capture', '➕ Приёмная',       null],
    ['roadmap', '🗺 Дорожная карта', planned || null],
    ['triage',  '⚖ Рассмотрение',   pool || null],
  ];
  const nav = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
    ${levels.map(([id, lbl, n]) => `<button class="btn ${S.level === id ? 'btn-gd' : 'btn-gh'} btn-sm" onclick="adRmSetLevel('${id}')" style="font-size:13px;padding:8px 14px">${lbl}${n != null ? ` <span style="opacity:.6;font-size:11px">${n}</span>` : ''}</button>`).join('')}
    <div style="flex:1"></div>
    <button class="btn btn-gh btn-sm" onclick="adRmLoad()" title="Перезагрузить из БД">↻</button>
  </div>`;

  let body;
  try {
    if (S.level === 'capture')      body = adRmCaptureView();
    else if (S.level === 'triage')  body = adRmTriageView();
    else                            body = adRmRoadmapView();
  } catch (e) {
    body = `<div style="color:#ff7a7a;padding:16px;border:1px solid #ff7a7a;border-radius:8px">Ошибка раздела: ${esc(e.message || String(e))}</div>`;
  }

  const head = `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:6px">
    <div>
      <div style="font-family:var(--font-display,sans-serif);font-size:19px;font-weight:700;color:var(--gdl,#5fb0e6);letter-spacing:.5px">🗺 Дорожная карта разработки</div>
      <div style="font-size:12px;color:var(--t3,#8aa0b0);margin-top:4px">Авто-планировщик: срочность (WSJF) + проектные сроки по дедлайнам. ${S.tasks.length} задач · в пуле ${pool} · в карте ${planned}</div>
    </div>
  </div>`;
  return head + nav + body;
}

function adRmSqlHint() {
  return `<div style="padding:20px;border:1px solid var(--gd,#3a7fbf);border-radius:10px;background:var(--b2,#141a22)">
    <div style="font-size:15px;font-weight:700;color:var(--gdl,#5fb0e6);margin-bottom:8px">⚙ Нужно применить SQL-срез</div>
    <div style="font-size:13px;color:var(--t2,#c0ccd6);line-height:1.5">
      Таблицы планировщика ещё нет в базе. Откройте <b>Supabase → SQL Editor</b> и выполните файл
      <code style="background:var(--b3,#0f141b);padding:2px 6px;border-radius:4px">_dev_roadmap.sql</code> целиком (создаёт <code>dev_tasks</code> + <code>dev_roadmap_config</code> с RLS только для стаффа). Затем — кнопка ниже.
    </div>
    <button class="btn btn-gd btn-sm" onclick="adRmLoad()" style="margin-top:12px">↻ Я применил — проверить</button>
  </div>`;
}

function adRmSetLevel(l) { adRmState().level = l; adPaint(); }

// ────────────────────────────────────────────────────────────────
//  УРОВЕНЬ 1 — ПРИЁМНАЯ (быстрый ввод задачи в общий пул)
// ────────────────────────────────────────────────────────────────
function adRmCaptureView() {
  const S = adRmState();
  const linkable = S.tasks.filter(t => t.status !== 'rejected');
  const inp = 'width:100%;padding:9px 11px;font-size:14px;background:var(--b2,#141a22);color:var(--t1,#e8edf2);border:1px solid var(--w2,#2a3340);border-radius:7px;box-sizing:border-box';
  const lbl = 'display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--t3,#8aa0b0);margin:0 0 5px';
  const recent = S.tasks.filter(t => t.status === 'pool').slice(0, 6);
  const est0 = adRmEstimate('economy', 'slice', 'm');

  return `<div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:22px;align-items:start">
    <div style="border:1px solid var(--w2,#2a3340);border-radius:12px;background:var(--b2,#141a22);padding:20px">
      <div style="font-size:15px;font-weight:700;color:var(--t1,#e8edf2);margin-bottom:4px">Новая задача → общий пул</div>
      <div style="font-size:12px;color:var(--t3,#8aa0b0);margin-bottom:16px">Сначала фиксируем мысль. Приоритет и сроки можно уточнить позже на «Рассмотрении».</div>

      <div style="margin-bottom:14px"><label style="${lbl}">Заголовок</label>
        <input id="rm-n-title" style="${inp}" placeholder="Что нужно сделать"></div>

      <div style="margin-bottom:14px"><label style="${lbl}">Описание / критерии готовности</label>
        <textarea id="rm-n-body" rows="3" style="${inp};resize:vertical" placeholder="Подробности, зачем, как проверить готовность"></textarea></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
        <div><label style="${lbl}">Приоритет</label>
          <select id="rm-n-prio" style="${inp}">${[1,2,3,4].map(p => `<option value="${p}"${p===2?' selected':''}>${RM_PRIO[p].l}</option>`).join('')}</select></div>
        <div><label style="${lbl}">Ценность (1–10)</label>
          <input id="rm-n-value" type="number" min="1" max="10" value="5" style="${inp}"></div>
      </div>

      <div style="margin-bottom:14px"><label style="${lbl}">Направление работ</label>
        <select id="rm-n-area" style="${inp}" onchange="adRmEstChange()">
          ${RM_AREAS.map(a => `<option value="${a.id}"${a.id==='economy'?' selected':''}>${esc(a.l)}</option>`).join('')}
        </select></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px" id="rm-n-estrow">
        <div><label style="${lbl}">Тип работ</label>
          <select id="rm-n-wtype" style="${inp}" onchange="adRmEstChange()">
            ${RM_WTYPES.map(t => `<option value="${t.id}"${t.id==='slice'?' selected':''}>${esc(t.l)}</option>`).join('')}</select></div>
        <div><label style="${lbl}">Масштаб</label>
          <select id="rm-n-cplx" style="${inp}" onchange="adRmEstChange()">
            ${RM_CPLX.map(c => `<option value="${c.id}"${c.id==='m'?' selected':''}>${esc(c.l)}</option>`).join('')}</select></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:6px">
        <div><label style="${lbl}">Оценка, часов</label>
          <input id="rm-n-effort" type="number" min="0.5" step="0.5" value="${est0}" style="${inp}" oninput="document.getElementById('rm-n-auto').checked=false;adRmEstHint()"></div>
        <div><label style="${lbl}">Дедлайн (необязательно)</label>
          <input id="rm-n-deadline" type="date" style="${inp}"></div>
      </div>
      <label style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--t3,#8aa0b0);margin-bottom:16px;cursor:pointer">
        <input id="rm-n-auto" type="checkbox" checked onchange="adRmEstChange()"> оценивать автоматически по направлению
        <span id="rm-n-esthint" style="color:var(--t4,#6a7a88);font-size:11px">≈ ${est0} ч</span>
      </label>

      <div style="margin-bottom:14px"><label style="${lbl}">Теги (через запятую)</label>
        <input id="rm-n-tags" style="${inp}" placeholder="bug, экономика, ui"></div>

      <div style="margin-bottom:18px"><label style="${lbl}">Зависит от (предшественники)</label>
        <select id="rm-n-deps" multiple size="${Math.min(5, Math.max(2, linkable.length))}" style="${inp};height:auto">
          ${linkable.map(t => `<option value="${t.id}">${esc(t.code || ('#'+t.id))} · ${esc((t.title||'').slice(0,48))}</option>`).join('') || '<option disabled>пока нет других задач</option>'}
        </select>
        <div style="font-size:11px;color:var(--t4,#6a7a88);margin-top:4px">Ctrl/⌘ — выбрать несколько. Задача не начнётся раньше, чем завершатся предшественники.</div></div>

      <div style="margin-bottom:18px"><label style="${lbl}">Картинки (скриншоты, макеты)</label>
        <div id="rm-n-imgs" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">${adRmThumbStrip(_rmNewImgs, 'adRmUnstageImg')}</div>
        <input type="file" accept="image/*" multiple id="rm-n-imgfile" style="display:none" onchange="adRmStageImg(this)">
        <button class="btn btn-gh btn-sm" type="button" onclick="document.getElementById('rm-n-imgfile').click()">🖼 Добавить картинки</button>
        <span style="font-size:11px;color:var(--t4,#6a7a88);margin-left:8px">сжимаются автоматически</span></div>

      <button class="btn btn-gd" onclick="adRmCreate()" style="width:100%;padding:11px;font-size:14px;font-weight:700">➕ Добавить в пул</button>
    </div>

    <div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--t3,#8aa0b0);margin-bottom:10px">Недавно в пуле</div>
      ${recent.length ? recent.map(t => adRmMiniCard(t)).join('') : `<div style="padding:18px;border:1px dashed var(--w2,#2a3340);border-radius:10px;color:var(--t4,#6a7a88);font-size:12px;text-align:center">Пул пуст — добавьте первую задачу</div>`}
      ${recent.length ? `<button class="btn btn-gh btn-sm" onclick="adRmSetLevel('triage')" style="width:100%;margin-top:10px">⚖ Перейти к рассмотрению →</button>` : ''}
    </div>
  </div>`;
}

function adRmMiniCard(t) {
  const p = RM_PRIO[t.priority] || RM_PRIO[2];
  return `<div style="border:1px solid var(--w2,#2a3340);border-left:3px solid ${p.c};border-radius:8px;background:var(--b2,#141a22);padding:10px 12px;margin-bottom:8px">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-family:monospace;font-size:10px;color:var(--t4,#6a7a88)">${esc(t.code || '')}</span>
      <span style="font-size:13px;font-weight:600;color:var(--t1,#e8edf2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</span>
    </div>
    <div style="font-size:11px;color:var(--t3,#8aa0b0);margin-top:3px">${p.l} · ${t.effort_h} ч${t.deadline ? ` · до ${esc(t.deadline)}` : ''}</div>
  </div>`;
}

// Пересчёт авто-оценки при смене направления/типа/масштаба или галки «авто».
// Меняет ТОЛЬКО значение поля и подсказку — без перерисовки формы (фокус цел).
function adRmEstChange() {
  const g = id => document.getElementById(id);
  const area = g('rm-n-area') ? g('rm-n-area').value : 'manual';
  const isManual = area === 'manual';
  const auto = g('rm-n-auto');
  const estRow = g('rm-n-estrow');
  // вне проекта — прячем тип/масштаб, оценка только вручную
  if (estRow) estRow.style.display = isManual ? 'none' : 'grid';
  if (auto) { auto.disabled = isManual; if (isManual) auto.checked = false; }
  if (!isManual && auto && auto.checked) {
    const est = adRmEstimate(area, g('rm-n-wtype').value, g('rm-n-cplx').value);
    if (g('rm-n-effort')) g('rm-n-effort').value = est;
  }
  adRmEstHint();
}
function adRmEstHint() {
  const g = id => document.getElementById(id);
  const span = g('rm-n-esthint'); if (!span) return;
  const area = g('rm-n-area') ? g('rm-n-area').value : 'manual';
  if (area === 'manual') { span.textContent = 'вручную'; return; }
  const est = adRmEstimate(area, g('rm-n-wtype').value, g('rm-n-cplx').value);
  const auto = g('rm-n-auto');
  span.textContent = (auto && auto.checked) ? `≈ ${est} ч` : `(авто ≈ ${est} ч)`;
}

async function adRmCreate() {
  const g = id => document.getElementById(id);
  const title = (g('rm-n-title').value || '').trim();
  if (!title) { toast('Введите заголовок', 'err'); return; }
  const deps = [...(g('rm-n-deps').selectedOptions || [])].map(o => Number(o.value)).filter(Boolean);
  const tags = (g('rm-n-tags').value || '').split(',').map(s => s.trim()).filter(Boolean);
  const area = g('rm-n-area') ? g('rm-n-area').value : 'manual';
  const wtype = g('rm-n-wtype') ? g('rm-n-wtype').value : null;
  const cplx = g('rm-n-cplx') ? g('rm-n-cplx').value : null;
  const autoEst = !!(g('rm-n-auto') && g('rm-n-auto').checked) && area !== 'manual';
  const row = {
    title,
    body: (g('rm-n-body').value || '').trim(),
    status: 'pool',
    priority: Number(g('rm-n-prio').value) || 2,
    value: adRmClamp(Number(g('rm-n-value').value) || 5, 1, 10),
    effort_h: Math.max(0.5, Number(g('rm-n-effort').value) || 8),
    deadline: g('rm-n-deadline').value || null,
    area, work_type: wtype, complexity: cplx, effort_auto: autoEst,
    tags, depends_on: deps, images: _rmNewImgs.slice(),
    created_email: (typeof user !== 'undefined' && user && user.email) || null,
  };
  try {
    const ins = await dbPost('dev_tasks', row);
    const created = Array.isArray(ins) ? ins[0] : ins;
    if (created) adRmState().tasks.unshift(adRmNorm(created));
    _rmNewImgs = [];
    toast(`Задача ${created && created.code ? created.code : ''} в пуле`, 'ok');
    adPaint();
  } catch (e) { toast('Не сохранилось: ' + (e.message || e), 'err'); }
}

// ────────────────────────────────────────────────────────────────
//  УРОВЕНЬ 3 — РАССМОТРЕНИЕ (триаж пула: отказ / включение в карту)
// ────────────────────────────────────────────────────────────────
function adRmTriageView() {
  const S = adRmState();
  const pool = S.tasks.filter(t => t.status === 'pool');
  const rejected = S.tasks.filter(t => t.status === 'rejected');

  const head = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    <div style="font-size:14px;color:var(--t2,#c0ccd6)">На рассмотрении: <b style="color:var(--t1,#e8edf2)">${pool.length}</b></div>
    <div style="flex:1"></div>
    <label style="font-size:12px;color:var(--t3,#8aa0b0);display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" ${S.showRejected ? 'checked' : ''} onchange="adRmState().showRejected=this.checked;adPaint()"> показать отклонённые (${rejected.length})</label>
  </div>`;

  const cards = pool.length
    ? pool.map(t => adRmTriageCard(t)).join('')
    : `<div style="padding:30px;border:1px dashed var(--w2,#2a3340);border-radius:12px;color:var(--t4,#6a7a88);text-align:center">Пул пуст. Новые задачи добавляются на «Приёмной».</div>`;

  let rejBlock = '';
  if (S.showRejected && rejected.length) {
    rejBlock = `<div style="margin-top:22px"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--t4,#6a7a88);margin-bottom:10px">Отклонённые</div>
      ${rejected.map(t => `<div style="border:1px solid var(--w1,#1e2630);border-radius:8px;background:var(--b3,#0f141b);padding:10px 12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;opacity:.75">
        <span style="font-family:monospace;font-size:10px;color:var(--t4,#6a7a88)">${esc(t.code||'')}</span>
        <span style="flex:1;min-width:0;font-size:13px;color:var(--t2,#c0ccd6);text-decoration:line-through;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</span>
        ${t.reject_reason ? `<span style="font-size:11px;color:var(--t4,#6a7a88)">${esc(t.reject_reason)}</span>` : ''}
        <button class="btn btn-gh btn-sm" onclick="adRmReconsider(${t.id})" title="Вернуть в пул">↩</button>
        <button class="btn btn-gh btn-sm" onclick="adRmDelete(${t.id})" title="Удалить">🗑</button>
      </div>`).join('')}</div>`;
  }
  return head + cards + rejBlock;
}

function adRmTriageCard(t) {
  const S = adRmState();
  const p = RM_PRIO[t.priority] || RM_PRIO[2];
  const inp = 'padding:6px 8px;font-size:12px;background:var(--b3,#0f141b);color:var(--t1,#e8edf2);border:1px solid var(--w2,#2a3340);border-radius:6px';
  const lbl = 'font-size:10px;color:var(--t4,#6a7a88);display:block;margin-bottom:3px';
  const depNames = (t.depends_on || []).map(id => { const d = S.tasks.find(x => x.id === id); return d ? (d.code || ('#'+id)) : ('#'+id); });
  return `<div style="border:1px solid var(--w2,#2a3340);border-left:3px solid ${p.c};border-radius:12px;background:var(--b2,#141a22);padding:16px;margin-bottom:12px">
    <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
      <span style="font-family:monospace;font-size:11px;color:var(--t4,#6a7a88);padding-top:2px">${esc(t.code||'')}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:700;color:var(--t1,#e8edf2)">${esc(t.title)}</div>
        ${t.body ? `<div style="font-size:12px;color:var(--t3,#8aa0b0);margin-top:4px;white-space:pre-wrap">${esc(t.body)}</div>` : ''}
        ${(t.tags && t.tags.length) ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:5px">${t.tags.map(tg => `<span style="font-size:10px;background:var(--b3,#0f141b);border:1px solid var(--w2,#2a3340);color:var(--t3,#8aa0b0);padding:2px 7px;border-radius:10px">${esc(tg)}</span>`).join('')}</div>` : ''}
        ${depNames.length ? `<div style="font-size:11px;color:var(--t4,#6a7a88);margin-top:6px">↳ зависит от: ${esc(depNames.join(', '))}</div>` : ''}
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;padding:12px 0;border-top:1px solid var(--w1,#1e2630)">
      <div><label style="${lbl}">Направление</label>
        <select id="rm-t-area-${t.id}" style="${inp}" onchange="adRmSet(${t.id},'area',this.value)">${RM_AREAS.map(a => `<option value="${a.id}"${a.id===(t.area||'manual')?' selected':''}>${esc(a.l)}</option>`).join('')}</select></div>
      <div><label style="${lbl}">Тип</label>
        <select id="rm-t-wtype-${t.id}" style="${inp}" onchange="adRmSet(${t.id},'work_type',this.value)">${RM_WTYPES.map(x => `<option value="${x.id}"${x.id===(t.work_type||'slice')?' selected':''}>${esc(x.l)}</option>`).join('')}</select></div>
      <div><label style="${lbl}">Масштаб</label>
        <select id="rm-t-cplx-${t.id}" style="${inp}" onchange="adRmSet(${t.id},'complexity',this.value)">${RM_CPLX.map(x => `<option value="${x.id}"${x.id===(t.complexity||'m')?' selected':''}>${esc(x.l)}</option>`).join('')}</select></div>
      <div><button class="btn btn-gh btn-sm" onclick="adRmReEstimate(${t.id})" title="Посчитать часы по направлению">≈ оценить</button></div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:end;padding:0 0 4px">
      <div><label style="${lbl}">Приоритет</label>
        <select style="${inp}" onchange="adRmSet(${t.id},'priority',this.value,true)">${[1,2,3,4].map(x => `<option value="${x}"${x===t.priority?' selected':''}>${RM_PRIO[x].l}</option>`).join('')}</select></div>
      <div><label style="${lbl}">Ценность</label>
        <input type="number" min="1" max="10" value="${t.value}" style="${inp};width:64px" onchange="adRmSet(${t.id},'value',this.value,true)"></div>
      <div><label style="${lbl}">Часов${t.effort_auto ? ' <span style="color:var(--gdl,#5fb0e6)">авто</span>' : ''}</label>
        <input type="number" min="0.5" step="0.5" value="${t.effort_h}" style="${inp};width:74px" onchange="adRmSetEffort(${t.id},this.value)"></div>
      <div><label style="${lbl}">Дедлайн</label>
        <input type="date" value="${t.deadline||''}" style="${inp}" onchange="adRmSet(${t.id},'deadline',this.value||null)"></div>
      <div style="flex:1"></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-gh btn-sm" onclick="adRmReject(${t.id})" style="color:#e6655f;border-color:#e6655f">✕ Отклонить</button>
        <button class="btn btn-gd btn-sm" onclick="adRmAccept(${t.id})">✓ В дорожную карту →</button>
      </div>
    </div>
  </div>`;
}

// Ручная правка часов в триаже = снимаем флаг авто-оценки.
async function adRmSetEffort(id, value) {
  await adRmPatch(id, { effort_h: Math.max(0.5, Number(value) || 8), effort_auto: false });
}
// Пересчитать часы по выбранному направлению/типу/масштабу (кнопка «≈ оценить»).
async function adRmReEstimate(id) {
  const g = sfx => document.getElementById('rm-t-' + sfx + '-' + id);
  const area = g('area') ? g('area').value : 'manual';
  if (area === 'manual') { toast('«Вне проекта» — задайте часы вручную', 'err'); return; }
  const est = adRmEstimate(area, g('wtype').value, g('cplx').value);
  await adRmPatch(id, { area, work_type:g('wtype').value, complexity:g('cplx').value, effort_h:est, effort_auto:true }, `Оценка ≈ ${est} ч`);
}

async function adRmAccept(id) {
  await adRmPatch(id, { status:'planned', planned_at:new Date().toISOString() }, 'В дорожной карте');
}
async function adRmReject(id) {
  const reason = (prompt('Причина отказа (необязательно):', '') || '').trim();
  await adRmPatch(id, { status:'rejected', reject_reason:reason || null }, 'Отклонено');
}
async function adRmReconsider(id) { await adRmPatch(id, { status:'pool', reject_reason:null }, 'Возвращено в пул'); }

// ────────────────────────────────────────────────────────────────
//  УРОВЕНЬ 2 — ДОРОЖНАЯ КАРТА (авто-планировщик + Гант + таблица)
// ────────────────────────────────────────────────────────────────
function adRmRoadmapView() {
  const S = adRmState();
  const scheduled = adRmSchedule(S.tasks, S.cfg);
  const testing = S.tasks.filter(t => t.status === 'testing');
  const done = S.tasks.filter(t => t.status === 'done');

  if (!scheduled.length && !testing.length && !done.length) {
    return `<div style="padding:30px;border:1px dashed var(--w2,#2a3340);border-radius:12px;color:var(--t4,#6a7a88);text-align:center">
      В карте пока нет задач. Включите их на «Рассмотрении».
      <div style="margin-top:12px"><button class="btn btn-gh btn-sm" onclick="adRmSetLevel('triage')">⚖ К рассмотрению</button></div></div>`;
  }

  // KPI
  const totalH = scheduled.reduce((a, t) => a + (t.effort_h || 0), 0);
  const endIdx = scheduled.reduce((m, t) => Math.max(m, t._endIdx), 0);
  const finishDate = scheduled.length ? adRmWorkDay(scheduled._start, endIdx, scheduled._skipW) : null;
  const atRisk  = scheduled.filter(t => t._late).length;
  const overdue = scheduled.filter(t => t.deadline && new Date(t.deadline) < adRmToday() && t.status !== 'done').length;
  const kpi = (label, val, color) => `<div style="flex:1 1 120px;min-width:110px;border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b2,#141a22);padding:12px 14px">
    <div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--t4,#6a7a88)">${label}</div>
    <div style="font-size:20px;font-weight:700;color:${color||'var(--t1,#e8edf2)'};margin-top:3px;font-family:var(--font-display,sans-serif)">${val}</div></div>`;
  const kpis = `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px">
    ${kpi('Задач в плане', scheduled.length)}
    ${kpi('Трудозатраты', (totalH/Math.max(1,S.cfg.capacity_h)).toFixed(1) + ' дн', 'var(--gdl,#5fb0e6)')}
    ${kpi('Финиш плана', adRmFmtFull(finishDate), 'var(--gdl,#5fb0e6)')}
    ${kpi('Под риском', atRisk, atRisk ? '#e6a35f' : 'var(--t1,#e8edf2)')}
    ${kpi('На тесте', testing.length, testing.length ? '#c08fe6' : 'var(--t1,#e8edf2)')}
    ${kpi('Просрочено', overdue, overdue ? '#e6655f' : 'var(--t1,#e8edf2)')}
  </div>`;

  return adRmControls() + kpis + adRmGantt(scheduled) + adRmTable(scheduled, testing, done);
}

function adRmControls() {
  const S = adRmState(), c = S.cfg;
  const ni = (id, val, attrs) => `<input id="${id}" value="${val}" ${attrs} onchange="adRmCfgFromInputs()" style="width:64px;padding:6px 8px;font-size:12px;background:var(--b3,#0f141b);color:var(--t1,#e8edf2);border:1px solid var(--w2,#2a3340);border-radius:6px">`;
  const lbl = 'font-size:10px;color:var(--t4,#6a7a88);display:block;margin-bottom:3px';
  return `<div style="border:1px solid var(--w2,#2a3340);border-radius:10px;background:var(--b2,#141a22);padding:12px 14px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:16px;align-items:end">
    <div><label style="${lbl}">Часов/день</label>${ni('rm-cap', c.capacity_h, 'type="number" min="1" step="0.5"')}</div>
    <div><label style="${lbl}">Старт плана</label><input id="rm-start" type="date" value="${c.start_date||''}" onchange="adRmCfgFromInputs()" style="padding:6px 8px;font-size:12px;background:var(--b3,#0f141b);color:var(--t1,#e8edf2);border:1px solid var(--w2,#2a3340);border-radius:6px"></div>
    <label style="font-size:12px;color:var(--t3,#8aa0b0);display:flex;align-items:center;gap:6px;cursor:pointer;padding-bottom:6px">
      <input id="rm-skipw" type="checkbox" ${c.skip_weekends ? 'checked' : ''} onchange="adRmCfgFromInputs()"> без выходных</label>
    <div style="width:1px;align-self:stretch;background:var(--w2,#2a3340)"></div>
    <div style="font-size:10px;color:var(--t4,#6a7a88);align-self:center">Веса срочности:</div>
    <div><label style="${lbl}">ценность</label>${ni('rm-wv', c.w_value, 'type="number" min="0" step="0.1"')}</div>
    <div><label style="${lbl}">приоритет</label>${ni('rm-wp', c.w_priority, 'type="number" min="0" step="0.1"')}</div>
    <div><label style="${lbl}">дедлайн</label>${ni('rm-wu', c.w_urgency, 'type="number" min="0" step="0.1"')}</div>
    <div><label style="${lbl}">возраст</label>${ni('rm-wa', c.w_age, 'type="number" min="0" step="0.1"')}</div>
    <div style="flex:1"></div>
    <button class="btn btn-gh btn-sm" onclick="adRmCfgReset()" title="Сбросить веса">↺ сброс</button>
  </div>`;
}

function adRmCfgFromInputs() {
  const S = adRmState(), g = id => document.getElementById(id);
  const c = S.cfg;
  if (g('rm-cap'))  c.capacity_h    = Math.max(1, Number(g('rm-cap').value) || 6);
  if (g('rm-start'))c.start_date    = g('rm-start').value || null;
  if (g('rm-skipw'))c.skip_weekends = g('rm-skipw').checked;
  if (g('rm-wv'))   c.w_value       = Math.max(0, Number(g('rm-wv').value) || 0);
  if (g('rm-wp'))   c.w_priority    = Math.max(0, Number(g('rm-wp').value) || 0);
  if (g('rm-wu'))   c.w_urgency     = Math.max(0, Number(g('rm-wu').value) || 0);
  if (g('rm-wa'))   c.w_age         = Math.max(0, Number(g('rm-wa').value) || 0);
  adRmCfgPersist();
  adPaint();
}
function adRmCfgReset() { Object.assign(adRmState().cfg, RM_CFG_DEF); adRmCfgPersist(); adPaint(); }
let _rmCfgTimer = null;
function adRmCfgPersist() {
  clearTimeout(_rmCfgTimer);
  const c = adRmState().cfg;
  _rmCfgTimer = setTimeout(() => {
    dbPatch('dev_roadmap_config', 'id=eq.1', {
      capacity_h:c.capacity_h, skip_weekends:c.skip_weekends, w_value:c.w_value,
      w_priority:c.w_priority, w_urgency:c.w_urgency, w_age:c.w_age, start_date:c.start_date,
    }).catch(() => {});
  }, 600);
}

// ── Гант-диаграмма (горизонтальная шкала рабочих дней) ──────────
function adRmGantt(scheduled) {
  const S = adRmState();
  const start = scheduled._start, skipW = scheduled._skipW;
  const horizon = Math.min(80, scheduled.reduce((m, t) => Math.max(m, t._endIdx), 0) + 1);
  const PX = 30, labelW = 230;
  const todayIdx = adRmIdxOfDate(start, adRmToday(), skipW);

  // шапка дат — метки каждые ~3 дня + границы недель
  let ticks = '';
  for (let i = 0; i <= horizon; i++) {
    const d = adRmWorkDay(start, i, skipW);
    const isMon = d.getDay() === 1;
    if (i % 3 === 0 || isMon) {
      ticks += `<div style="position:absolute;left:${i*PX}px;top:0;font-size:9px;color:var(--t4,#6a7a88);white-space:nowrap;${isMon?'border-left:1px solid var(--w2,#2a3340);padding-left:3px':''}">${adRmFmtDate(d)}</div>`;
    }
  }
  const todayLine = (todayIdx >= 0 && todayIdx <= horizon)
    ? `<div style="position:absolute;left:${todayIdx*PX}px;top:0;bottom:0;width:2px;background:rgba(95,230,163,.5);z-index:1" title="сегодня"></div>` : '';

  const rows = scheduled.map(t => {
    const p = RM_PRIO[t.priority] || RM_PRIO[2];
    const x = t._startIdx * PX;
    const w = Math.max(PX - 4, (t._endIdx - t._startIdx + 1) * PX - 4);
    const barColor = t._late ? '#e6655f' : (t.status === 'active' ? '#5fe6a3' : p.c);
    const pct = t.status === 'active' ? Math.max(6, Math.min(100, t.progress || 0)) : 0;
    // маркер дедлайна
    let dl = '';
    if (t.deadline) {
      const di = adRmIdxOfDate(start, new Date(t.deadline + 'T00:00:00'), skipW);
      if (di >= 0 && di <= horizon) dl = `<div style="position:absolute;left:${di*PX}px;top:1px;bottom:1px;width:0;border-left:2px dashed ${t._late?'#e6655f':'#e6a35f'};z-index:2" title="дедлайн ${esc(t.deadline)}"></div>`;
    }
    return `<div style="display:flex;align-items:center;border-bottom:1px solid var(--w1,#1e2630);min-height:30px;cursor:pointer" onclick="adRmOpenDetail(${t.id})" title="Открыть карточку задачи">
      <div style="width:${labelW}px;flex:0 0 ${labelW}px;padding:4px 10px 4px 0;overflow:hidden">
        <div style="font-size:12px;color:var(--t1,#e8edf2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.title)}${(t.images&&t.images.length)?' 📎':''}</div>
        <div style="font-family:monospace;font-size:9px;color:var(--t4,#6a7a88)">${esc(t.code||'')} · ${t.effort_h}ч${t._late?' · <span style=\"color:#e6655f\">срыв</span>':''}</div>
      </div>
      <div style="position:relative;flex:1;height:30px;min-width:${horizon*PX}px">
        ${dl}
        <div style="position:absolute;left:${x}px;top:5px;height:20px;width:${w}px;background:${barColor};opacity:.92;border-radius:5px;box-shadow:0 1px 3px rgba(0,0,0,.35);overflow:hidden" title="${esc(t.code||'')} ${esc(t.title)}\n${adRmFmtFull(t._startDate)} → ${adRmFmtFull(t._endDate)}">
          ${pct ? `<div style="position:absolute;left:0;top:0;bottom:0;width:${pct}%;background:rgba(255,255,255,.25)"></div>` : ''}
          <span style="position:absolute;left:6px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:700;color:#0c1218;white-space:nowrap;text-shadow:0 1px 0 rgba(255,255,255,.2)">${esc((t.code||'').replace('T-',''))}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  return `<div style="border:1px solid var(--w2,#2a3340);border-radius:12px;background:var(--b2,#141a22);overflow:hidden;margin-bottom:16px">
    <div style="padding:10px 14px;border-bottom:1px solid var(--w2,#2a3340);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--t3,#8aa0b0);display:flex;justify-content:space-between;align-items:center">
      <span>Гант · проектные сроки</span>
      <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:10px;color:var(--t4,#6a7a88)">━ полоса = работа · ┊ зелёная = сегодня · ┆ оранжевая = дедлайн</span>
    </div>
    <div style="overflow-x:auto;padding:0 14px 14px">
      <div style="display:flex;min-width:${labelW + horizon*PX}px">
        <div style="width:${labelW}px;flex:0 0 ${labelW}px"></div>
        <div style="position:relative;flex:1;height:16px;min-width:${horizon*PX}px;margin-bottom:2px">${ticks}</div>
      </div>
      <div style="position:relative">
        <div style="position:absolute;left:${labelW}px;right:0;top:0;bottom:0">${todayLine}</div>
        ${rows}
      </div>
    </div>
  </div>`;
}

// ── Таблица плана + тестирование + завершённые ──────────────────
function adRmTable(scheduled, testing, done) {
  const cellH = 'padding:8px 10px;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--t4,#6a7a88);text-align:left;white-space:nowrap';
  const head = `<div style="display:flex;align-items:center;background:var(--b3,#0f141b);border-bottom:1px solid var(--w2,#2a3340)">
    <div style="${cellH};flex:2 1 200px;min-width:160px">Задача</div>
    <div style="${cellH};flex:0 0 70px;text-align:right">WSJF</div>
    <div style="${cellH};flex:0 0 60px;text-align:right">Часов</div>
    <div style="${cellH};flex:0 0 110px">Старт → финиш</div>
    <div style="${cellH};flex:0 0 90px">Дедлайн</div>
    <div style="${cellH};flex:0 0 70px;text-align:right">Запас</div>
    <div style="${cellH};flex:0 0 160px;text-align:right">Действия</div>
  </div>`;

  const rank = scheduled.map((t, i) => {
    const p = RM_PRIO[t.priority] || RM_PRIO[2];
    const st = RM_STATUS[t.status] || RM_STATUS.planned;
    const slack = t._slackDays;
    const slackTxt = slack == null ? '—' : (slack < 0 ? `−${-slack} дн` : `${slack} дн`);
    const slackCol = slack == null ? 'var(--t4,#6a7a88)' : (slack < 0 ? '#e6655f' : (slack <= 2 ? '#e6a35f' : '#5fe6a3'));
    const cell = 'padding:9px 10px;font-size:12px;color:var(--t2,#c0ccd6);display:flex;align-items:center';
    return `<div style="display:flex;align-items:stretch;border-bottom:1px solid var(--w1,#1e2630);${t._late?'background:rgba(230,101,95,.06)':''}">
      <div style="${cell};flex:2 1 200px;min-width:160px;gap:8px;cursor:pointer" onclick="adRmOpenDetail(${t.id})" title="Открыть карточку">
        <span style="font-family:monospace;font-size:10px;color:var(--t4,#6a7a88);flex:0 0 auto">${i+1}.</span>
        <span style="width:6px;height:6px;border-radius:50%;background:${p.c};flex:0 0 auto" title="${p.l}"></span>
        <div style="min-width:0">
          <div style="color:var(--t1,#e8edf2);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}${(t.images&&t.images.length)?' <span style="color:var(--t4,#6a7a88);font-size:11px">📎'+t.images.length+'</span>':''}</div>
          <div style="font-family:monospace;font-size:9px;color:var(--t4,#6a7a88)">${esc(t.code||'')} <span style="color:${st.c}">●</span> ${st.l}${t._cycle?' · <span style="color:#e6a35f">цикл завис.</span>':''}</div>
        </div>
      </div>
      <div style="${cell};flex:0 0 70px;justify-content:flex-end;font-family:monospace;color:var(--gdl,#5fb0e6)">${(t._wsjf||0).toFixed(1)}</div>
      <div style="${cell};flex:0 0 60px;justify-content:flex-end;font-family:monospace">${t.effort_h}</div>
      <div style="${cell};flex:0 0 110px;font-family:monospace;font-size:11px">${adRmFmtDate(t._startDate)} → ${adRmFmtDate(t._endDate)}</div>
      <div style="${cell};flex:0 0 90px;font-family:monospace;font-size:11px;color:${t._late?'#e6655f':'var(--t2,#c0ccd6)'}">${t.deadline ? esc(t.deadline.slice(5)) : '—'}</div>
      <div style="${cell};flex:0 0 70px;justify-content:flex-end;font-family:monospace;color:${slackCol}">${slackTxt}</div>
      <div style="${cell};flex:0 0 160px;justify-content:flex-end;gap:5px">
        ${t.status === 'planned' ? `<button class="btn btn-gh btn-sm" onclick="adRmStart(${t.id})" title="В работу">▶</button>` : ''}
        ${t.status === 'active' ? `<button class="btn btn-gh btn-sm" onclick="adRmProgress(${t.id})" title="Прогресс">${t.progress||0}%</button>` : ''}
        <button class="btn btn-gd btn-sm" onclick="adRmDone(${t.id})" title="Готово → на тестирование (${RM_TEST_DAYS} дн)">✓</button>
        <button class="btn btn-gh btn-sm" onclick="adRmToPool(${t.id})" title="Вернуть в пул">↩</button>
      </div>
    </div>`;
  }).join('');

  // ── Блок тестирования (7 дней до авто-завершения) ──
  let testBlock = '';
  if (testing.length) {
    testBlock = `<div style="padding:10px 14px;background:rgba(192,143,230,.08);border-top:1px solid var(--w2,#2a3340);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#c08fe6">🧪 На тестировании (${testing.length}) — авто-завершение через ${RM_TEST_DAYS} дн</div>
      ${testing.map(t => {
        const left = t.testing_until ? Math.max(0, Math.ceil((new Date(t.testing_until).getTime() - Date.now()) / 864e5)) : 0;
        const totalMs = RM_TEST_DAYS * 864e5;
        const pct = t.testing_until ? adRmClamp(100 * (1 - (new Date(t.testing_until).getTime() - Date.now()) / totalMs), 0, 100) : 0;
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--w1,#1e2630)">
          <span style="color:#c08fe6">🧪</span>
          <span style="font-family:monospace;font-size:10px;color:var(--t4,#6a7a88)">${esc(t.code||'')}</span>
          <span style="flex:1;min-width:0;font-size:13px;color:var(--t1,#e8edf2);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick="adRmOpenDetail(${t.id})">${esc(t.title)}${(t.images&&t.images.length)?' 📎':''}</span>
          <div style="flex:0 0 120px;height:6px;background:var(--b3,#0f141b);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#c08fe6"></div></div>
          <span style="flex:0 0 64px;text-align:right;font-size:11px;color:#c08fe6">${left} дн</span>
          <button class="btn btn-gd btn-sm" onclick="adRmComplete(${t.id})" title="Завершить досрочно">✓ завершить</button>
          <button class="btn btn-gh btn-sm" onclick="adRmReactivate(${t.id})" title="Вернуть в работу">↩</button>
        </div>`;
      }).join('')}`;
  }

  let doneBlock = '';
  if (done.length) {
    doneBlock = `<div style="padding:10px 14px;background:var(--b3,#0f141b);border-top:1px solid var(--w2,#2a3340);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--t4,#6a7a88)">Завершено (${done.length})</div>
      ${done.map(t => `<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--w1,#1e2630);opacity:.7">
        <span style="color:#5fe6a3">✓</span>
        <span style="font-family:monospace;font-size:10px;color:var(--t4,#6a7a88)">${esc(t.code||'')}</span>
        <span style="flex:1;min-width:0;font-size:13px;color:var(--t2,#c0ccd6);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick="adRmOpenDetail(${t.id})">${esc(t.title)}${(t.images&&t.images.length)?' 📎':''}</span>
        <span style="font-size:11px;color:var(--t4,#6a7a88)">${t.done_at ? adRmFmtFull(new Date(t.done_at)) : ''}</span>
        <button class="btn btn-gh btn-sm" onclick="adRmToPool(${t.id})" title="Переоткрыть">↩</button>
      </div>`).join('')}`;
  }

  return `<div style="border:1px solid var(--w2,#2a3340);border-radius:12px;background:var(--b2,#141a22);overflow:hidden">
    <div style="overflow-x:auto"><div style="min-width:760px">${head}${rank || '<div style="padding:18px;color:var(--t4,#6a7a88);text-align:center">Нет активных задач в плане</div>'}${testBlock}${doneBlock}</div></div>
  </div>`;
}

// ── Действия со статусами ───────────────────────────────────────
async function adRmStart(id)   { await adRmPatch(id, { status:'active', started_at:new Date().toISOString() }, 'В работе'); }
// «Готово» → на тестирование 7 дней (по истечении авто-завершится при загрузке)
async function adRmDone(id)    {
  const until = new Date(Date.now() + RM_TEST_DAYS * 864e5).toISOString();
  await adRmPatch(id, { status:'testing', progress:100, done_at:new Date().toISOString(), testing_until:until }, `На тестировании ${RM_TEST_DAYS} дн`);
}
async function adRmComplete(id)   { await adRmPatch(id, { status:'done', testing_until:null }, 'Завершено'); }
async function adRmReactivate(id) { await adRmPatch(id, { status:'active', testing_until:null }, 'Вернулось в работу'); }
async function adRmToPool(id)  { await adRmPatch(id, { status:'pool', progress:0, testing_until:null }, 'В пуле'); }
async function adRmProgress(id) {
  const t = adRmState().tasks.find(x => x.id === id);
  const v = prompt('Прогресс, % (0–100):', String((t && t.progress) || 0));
  if (v == null) return;
  await adRmPatch(id, { progress: adRmClamp(Number(v) || 0, 0, 100) }, 'Прогресс обновлён');
}

// ── Универсальные CRUD-обёртки ──────────────────────────────────
async function adRmSet(id, field, value, isNum) {
  let v = value;
  if (isNum) v = Number(value);
  if (field === 'value') v = adRmClamp(v, 1, 10);
  if (field === 'priority') v = adRmClamp(v, 1, 4);
  if (field === 'effort_h') v = Math.max(0.5, v);
  await adRmPatch(id, { [field]: v });
}
async function adRmPatch(id, patch, okMsg) {
  try {
    const res = await dbPatch('dev_tasks', 'id=eq.' + id, patch);
    const row = Array.isArray(res) ? res[0] : res;
    const S = adRmState();
    const i = S.tasks.findIndex(t => t.id === id);
    if (i >= 0) S.tasks[i] = adRmNorm(Object.assign({}, S.tasks[i], row || patch));
    if (okMsg) toast(okMsg, 'ok');
    adPaint();
    if (adRmState().detailId === id) adRmRenderDetail();
  } catch (e) { toast('Не сохранилось: ' + (e.message || e), 'err'); }
}
async function adRmDelete(id) {
  if (!confirm('Удалить задачу безвозвратно?')) return;
  try {
    await dbDel('dev_tasks', 'id=eq.' + id);
    const S = adRmState();
    S.tasks = S.tasks.filter(t => t.id !== id);
    if (adRmState().detailId === id) adRmCloseDetail();
    toast('Удалено', 'ok'); adPaint();
  } catch (e) { toast('Ошибка удаления: ' + (e.message || e), 'err'); }
}

// ════════════════════════════════════════════════════════════════
//  КАРТИНКИ ЗАДАЧ — сжатие в webp + хранение data-URL в dev_tasks.images
//  (стафф-инструмент, малый трафик → самодостаточно, без Storage-бакета)
// ════════════════════════════════════════════════════════════════
let _rmNewImgs = [];   // стейджинг картинок для новой задачи (приёмная)

async function adRmFileToDataURL(file) {
  const cf = (typeof compressImageFile === 'function') ? await compressImageFile(file, 900, 0.8) : file;
  return await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('не прочитать файл'));
    r.readAsDataURL(cf);
  });
}
// Полоска миниатюр с крестиком удаления (removeFn(idx) — имя глобальной функции)
function adRmThumbStrip(imgs, removeFn) {
  if (!imgs || !imgs.length) return '';
  return imgs.map((src, i) => `<div style="position:relative;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid var(--w2,#2a3340)">
    <img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block" onclick="adRmLightbox('${i}',this)" data-full="1">
    <button type="button" onclick="${removeFn}(${i})" title="Удалить" style="position:absolute;top:2px;right:2px;width:18px;height:18px;line-height:16px;text-align:center;padding:0;border:none;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:12px;cursor:pointer">×</button>
  </div>`).join('');
}

// ── Стейджинг для новой задачи ──
async function adRmStageImg(input) {
  const files = input && input.files ? [...input.files] : [];
  for (const f of files) {
    try { _rmNewImgs.push(await adRmFileToDataURL(f)); } catch (e) { toast('Картинка: ' + e.message, 'err'); }
  }
  input.value = '';
  const box = document.getElementById('rm-n-imgs');
  if (box) box.innerHTML = adRmThumbStrip(_rmNewImgs, 'adRmUnstageImg');
}
function adRmUnstageImg(i) {
  _rmNewImgs.splice(i, 1);
  const box = document.getElementById('rm-n-imgs');
  if (box) box.innerHTML = adRmThumbStrip(_rmNewImgs, 'adRmUnstageImg');
}

// ── Картинки существующей задачи (в модалке) ──
async function adRmAddImg(id, input) {
  const files = input && input.files ? [...input.files] : [];
  if (!files.length) return;
  const t = adRmState().tasks.find(x => x.id === id); if (!t) return;
  const imgs = (t.images || []).slice();
  for (const f of files) {
    try { imgs.push(await adRmFileToDataURL(f)); } catch (e) { toast('Картинка: ' + e.message, 'err'); }
  }
  input.value = '';
  await adRmPatch(id, { images: imgs });
  adRmRenderDetail();
}
async function adRmDelImg(id, i) {
  const t = adRmState().tasks.find(x => x.id === id); if (!t) return;
  const imgs = (t.images || []).slice();
  imgs.splice(i, 1);
  await adRmPatch(id, { images: imgs });
  adRmRenderDetail();
}

// ════════════════════════════════════════════════════════════════
//  МОДАЛКА КАРТОЧКИ ЗАДАЧИ (клик по строке/полосе Ганта)
// ════════════════════════════════════════════════════════════════
function adRmOpenDetail(id) {
  adRmState().detailId = id;
  let host = document.getElementById('rm-detail-host');
  if (!host) { host = document.createElement('div'); host.id = 'rm-detail-host'; document.body.appendChild(host); }
  adRmRenderDetail();
  document.addEventListener('keydown', adRmEscClose);
}
function adRmEscClose(e) { if (e.key === 'Escape') adRmCloseDetail(); }
function adRmCloseDetail() {
  adRmState().detailId = null;
  const host = document.getElementById('rm-detail-host');
  if (host) host.innerHTML = '';
  document.removeEventListener('keydown', adRmEscClose);
}
function adRmRenderDetail() {
  const host = document.getElementById('rm-detail-host'); if (!host) return;
  const S = adRmState();
  const t = S.tasks.find(x => x.id === S.detailId);
  if (!t) { host.innerHTML = ''; return; }
  const p = RM_PRIO[t.priority] || RM_PRIO[2];
  const st = RM_STATUS[t.status] || RM_STATUS.pool;
  const sched = adRmSchedule(S.tasks, S.cfg).find(x => x.id === t.id);
  const depNames = (t.depends_on || []).map(d => { const x = S.tasks.find(z => z.id === d); return x ? (x.code || ('#'+d)) : ('#'+d); });
  const chip = (label, val, col) => `<div style="background:var(--b3,#0f141b);border:1px solid var(--w2,#2a3340);border-radius:8px;padding:8px 10px;min-width:90px">
    <div style="font-size:10px;color:var(--t4,#6a7a88);text-transform:uppercase;letter-spacing:.05em">${label}</div>
    <div style="font-size:13px;font-weight:600;color:${col||'var(--t1,#e8edf2)'};margin-top:2px">${val}</div></div>`;

  let testLine = '';
  if (t.status === 'testing' && t.testing_until) {
    const left = Math.max(0, Math.ceil((new Date(t.testing_until).getTime() - Date.now()) / 864e5));
    testLine = `<div style="margin-top:12px;padding:10px 12px;background:rgba(192,143,230,.1);border:1px solid #c08fe6;border-radius:8px;color:#c08fe6;font-size:13px">🧪 На тестировании — авто-завершение через <b>${left} дн</b> (${adRmFmtFull(new Date(t.testing_until))})</div>`;
  }

  const imgs = t.images || [];
  const imgGrid = imgs.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${imgs.map((src, i) => `<div style="position:relative;width:120px;height:90px;border-radius:8px;overflow:hidden;border:1px solid var(--w2,#2a3340)">
        <img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in" onclick="adRmLightboxSrc(this.src)">
        <button type="button" onclick="adRmDelImg(${t.id},${i})" title="Удалить" style="position:absolute;top:3px;right:3px;width:20px;height:20px;line-height:18px;text-align:center;padding:0;border:none;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;cursor:pointer">×</button>
      </div>`).join('')}</div>`
    : `<div style="font-size:12px;color:var(--t4,#6a7a88);margin-top:6px">Картинок нет</div>`;

  const body = `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px">
      <div style="min-width:0">
        <div style="font-family:monospace;font-size:11px;color:var(--t4,#6a7a88)">${esc(t.code||'')} · <span style="color:${st.c}">●</span> ${st.l}</div>
        <div style="font-size:19px;font-weight:700;color:var(--t1,#e8edf2);margin-top:4px">${esc(t.title)}</div>
      </div>
      <button class="btn btn-gh btn-sm" onclick="adRmCloseDetail()" title="Закрыть (Esc)">✕</button>
    </div>
    ${testLine}
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">
      ${chip('Приоритет', p.l, p.c)}
      ${chip('Ценность', t.value + ' / 10')}
      ${chip('Оценка', t.effort_h + ' ч' + (t.effort_auto ? ' (авто)' : ''))}
      ${t.area ? chip('Направление', esc(adRmAreaLabel(t.area))) : ''}
      ${t.deadline ? chip('Дедлайн', esc(t.deadline), sched && sched._late ? '#e6655f' : 'var(--t1)') : ''}
      ${sched ? chip('План', adRmFmtFull(sched._startDate) + ' → ' + adRmFmtFull(sched._endDate)) : ''}
      ${sched ? chip('WSJF', (sched._wsjf||0).toFixed(1), 'var(--gdl,#5fb0e6)') : ''}
    </div>
    ${(t.tags && t.tags.length) ? `<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:5px">${t.tags.map(tg => `<span style="font-size:11px;background:var(--b3,#0f141b);border:1px solid var(--w2,#2a3340);color:var(--t3,#8aa0b0);padding:3px 9px;border-radius:11px">#${esc(tg)}</span>`).join('')}</div>` : ''}
    ${depNames.length ? `<div style="font-size:12px;color:var(--t4,#6a7a88);margin-top:10px">↳ Зависит от: ${esc(depNames.join(', '))}</div>` : ''}

    <div style="margin-top:16px"><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--t3,#8aa0b0);margin-bottom:6px">Описание</div>
      <div style="font-size:13px;color:var(--t2,#c0ccd6);line-height:1.55;white-space:pre-wrap">${t.body ? esc(t.body) : '<span style=\"color:var(--t4,#6a7a88)\">— нет описания —</span>'}</div></div>

    <div style="margin-top:16px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--t3,#8aa0b0)">Картинки (${imgs.length})</div>
        <div><input type="file" accept="image/*" multiple id="rm-d-imgfile" style="display:none" onchange="adRmAddImg(${t.id},this)">
          <button class="btn btn-gh btn-sm" onclick="document.getElementById('rm-d-imgfile').click()">🖼 Добавить</button></div>
      </div>
      ${imgGrid}
    </div>

    <div style="margin-top:18px;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;border-top:1px solid var(--w1,#1e2630);padding-top:14px">
      ${t.status === 'pool' ? `<button class="btn btn-gd btn-sm" onclick="adRmAccept(${t.id});adRmCloseDetail()">✓ В дорожную карту</button>` : ''}
      ${t.status === 'planned' ? `<button class="btn btn-gh btn-sm" onclick="adRmStart(${t.id})">▶ В работу</button>` : ''}
      ${(t.status === 'planned' || t.status === 'active') ? `<button class="btn btn-gd btn-sm" onclick="adRmDone(${t.id})">✓ Готово → тест</button>` : ''}
      ${t.status === 'testing' ? `<button class="btn btn-gd btn-sm" onclick="adRmComplete(${t.id})">✓ Завершить</button><button class="btn btn-gh btn-sm" onclick="adRmReactivate(${t.id})">↩ В работу</button>` : ''}
      <button class="btn btn-gh btn-sm" onclick="adRmDelete(${t.id})" style="color:#e6655f;border-color:#e6655f">🗑 Удалить</button>
    </div>`;

  host.innerHTML = `<div onclick="if(event.target===this)adRmCloseDetail()" style="position:fixed;inset:0;background:rgba(6,10,16,.72);z-index:9000;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:5vh 16px">
    <div style="width:100%;max-width:640px;background:var(--b1,#0c1218);border:1px solid var(--w2,#2a3340);border-radius:14px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.5)">${body}</div>
  </div>`;
}

// ── Лайтбокс одной картинки ──
function adRmLightboxSrc(src) {
  let lb = document.getElementById('rm-lightbox');
  if (!lb) { lb = document.createElement('div'); lb.id = 'rm-lightbox'; document.body.appendChild(lb); }
  lb.onclick = () => { lb.innerHTML = ''; };
  lb.innerHTML = `<div style="position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:9500;display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out">
    <img src="${src}" style="max-width:100%;max-height:100%;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.6)"></div>`;
}
function adRmLightbox(i, el) { if (el && el.src) adRmLightboxSrc(el.src); }
