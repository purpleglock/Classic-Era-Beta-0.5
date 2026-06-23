// ════════════════════════════════════════════════════════════
// GALAXY MAP — интерактивная карта галактики (часть вики)
// Данные: Supabase (map_systems / map_hyperlanes / map_factions)
// Зависит от: core.js (dbGet/dbPost/dbPatch/dbDel, esc, toast, SB_URL),
//             auth.js (user), d3-delaunay (CDN)
// ════════════════════════════════════════════════════════════

const GM_W = 6600, GM_H = 4124;
const GM_BASE = 'assets/map/';
const GM_STAR_TYPES = ['yellow', 'red', 'blue', 'white', 'green'];

// Потолок зума и порог «глубокого зума»: за GM_DEEP_SCALE звёзды раскрываются
// в анимированные системы (звезда + орбиты планет по составу s.planets).
const GM_MAX_SCALE = 26;
const GM_DEEP_SCALE = 4;

// Иконки контролов — инлайн-SVG (currentColor), чтобы не зависеть от эмодзи-шрифта:
// глифы ⬡💎⤢⛶ на телефонах рендерились разноцветными эмодзи и плохо читались.
const GM_ICO = {
  borders: '<svg class="gm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2.6l8.1 4.7v9.4L12 21.4 3.9 16.7V7.3z"/></svg>',
  flags: '<svg class="gm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 4.4h11l-2.3 3.4L17 11.2H6"/></svg>',
  res: '<svg class="gm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linejoin="round"><path d="M5.4 8l3.1-4.5h7L18.6 8 12 20.5z" stroke-width="1.8"/><path d="M3.6 8h16.8M9 3.5 12 8 9 20.5M15 3.5 12 8l3 12.5" stroke-width="1.2"/></svg>',
  econ: '<svg class="gm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M9.3 9.4c0-1.3 1.2-2.1 2.7-2.1s2.7.9 2.7 2c0 2.6-5.4 1.4-5.4 4 0 1.1 1.2 2 2.7 2s2.7-.9 2.7-2.1"/></svg>',
  zin: '<svg class="gm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg>',
  zout: '<svg class="gm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5.5 12h13"/></svg>',
  fit: '<svg class="gm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
  fs: '<svg class="gm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/></svg>',
  edit: '<svg class="gm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10.5-10.5a1.5 1.5 0 0 0 0-2.1l-1.9-1.9a1.5 1.5 0 0 0-2.1 0L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  collapse: '<svg class="gm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9.5l5 5 5-5"/></svg>',
};
function gmCtlBtns() {
  return `
        <button class="gm-ctl gm-ctl-toggle${GM.ctlCollapsed ? ' gm-on' : ''}" id="gm-ctl-toggle" title="${GM.ctlCollapsed ? 'Показать панель' : 'Свернуть панель'}" onclick="gmToggleControls()">${GM_ICO.collapse}</button>
        <div class="gm-ctl-group${GM.ctlCollapsed ? ' gm-collapsed' : ''}" id="gm-ctl-group">
        <button class="gm-ctl${GM.showBorders ? ' gm-active' : ''}" title="Границы" id="gm-ctl-borders" onclick="gmToggleBorders()">${GM_ICO.borders}</button>
        <button class="gm-ctl${GM.showFlags ? ' gm-active' : ''}" title="Флаги фракций" id="gm-ctl-flags" onclick="gmToggleFlags()">${GM_ICO.flags}</button>
        <button class="gm-ctl${GM.showRes ? ' gm-active' : ''}" title="Ресурсы систем" id="gm-ctl-res" onclick="gmToggleRes()">${GM_ICO.res}</button>
        ${gmResFilterHtml()}
        <button class="gm-ctl${GM.showEcon ? ' gm-active' : ''}" title="Бедность систем" id="gm-ctl-econ" onclick="gmToggleEcon()">${GM_ICO.econ}</button>
        ${gmEconLegendHtml()}
        <button class="gm-ctl" title="Приблизить" onclick="gmZoomBtn(1)">${GM_ICO.zin}</button>
        <button class="gm-ctl" title="Отдалить" onclick="gmZoomBtn(-1)">${GM_ICO.zout}</button>
        <button class="gm-ctl" title="Вся карта" onclick="gmFit()">${GM_ICO.fit}</button>
        <button class="gm-ctl" title="На весь экран" id="gm-ctl-fs" onclick="gmToggleFullscreen()">${GM_ICO.fs}</button>
        </div>`;
}
// Свернуть/развернуть панель контролов карты — остаётся только кнопка-стрелка.
function gmToggleControls() {
  const g = document.getElementById('gm-ctl-group');
  if (!g) return;
  GM.ctlCollapsed = !g.classList.contains('gm-collapsed');
  g.classList.toggle('gm-collapsed', GM.ctlCollapsed);
  const b = document.getElementById('gm-ctl-toggle');
  if (b) { b.classList.toggle('gm-on', GM.ctlCollapsed); b.title = GM.ctlCollapsed ? 'Показать панель' : 'Свернуть панель'; }
}

const GM = {
  systems: [], lanes: [], factions: [], sectors: [],
  minefields: [], outposts: [], opShips: [], mzaShips: [],  // оборона: видимые поля/аванпосты + мои носители аванпостов + мои Гиперпейсер (через RPC)
  scale: 1, tx: 0, ty: 0,
  edit: false, mode: 'select',   // select | link | unlink | add | sector
  editSession: false,            // ПК: редактор зашёл в правку карты → старый SVG-рендер
  linkFrom: null,
  sectorDraft: null,             // {id?, name, color, lore, system_ids:[]} — редактируемый сектор
  drag: null,                    // {sys, moved}
  panning: false, panStart: null,
  loaded: false,
  showBorders: true, showFlags: true, fullscreen: false, ctlCollapsed: false,
  showRes: false,                // режим «ресурсы систем»
  showEcon: false,               // режим «бедность» (просперити систем)
  resRarities: ['rare', 'epic', 'legendary'], // какие редкости показывать на карте
  touch: null,                   // {mode:'pan'|'pinch', ...}
  myFid: null,                   // фракция игрока (для «развитости» СВОИХ колоний)
  devByCol: {},                  // colony_id -> сумма открытых слотов построек (только свои)
  bldByCol: {},                  // colony_id -> {btype: слоты} (только свои; для постройко-эффектов)
};

function gmCanEdit() { return !!(user && ['superadmin', 'editor'].includes(user.role)); }
function gmFaction(id) { return GM.factions.find(f => f.id === id) || null; }

// ПК: вход/выход из редактора карты. Просмотр идёт быстрым canvas-рендером,
// а правка (двигать звёзды/пути/сектора) — в старом SVG-рендере, который
// рисуется только при GM.editSession (см. renderGalaxyMap).
function gmEnterEdit() {
  if (!gmCanEdit()) return;
  GM.editSession = true;
  GMM.active = false;
  renderGalaxyMap();
}
function gmExitEdit() {
  GM.editSession = false; GM.edit = false;
  renderGalaxyMap();
}

// ── Загрузка данных ─────────────────────────────────────────
async function loadGalaxyData() {
  try {
    const [sys, lanes, facs, secs, routes, econ, salvos, mines, outposts, opShips, mzaShips] = await Promise.all([
      dbGet('map_systems', 'select=*'),
      dbGet('map_hyperlanes', 'select=*'),
      dbGet('map_factions', 'select=*&order=sort.asc'),
      dbGet('map_sectors', 'select=*').catch(() => []),   // таблица может быть не создана
      // активные торговые маршруты — для трафика караванов по гиперпутям
      dbGet('trade_routes', 'status=eq.active&select=origin_sys,dest_sys,a_fid,convoy').catch(() => []),
      // пространственная экономика: кэш просперити/статуса систем (режим «бедность»)
      dbGet('system_econ', 'select=system_id,status,prosperity').catch(() => []),
      // межзвёздная артиллерия: залпы в полёте (видны всем — угроза публична).
      // Таблицы может не быть (_interstellar_artillery.sql ещё не применён) → []
      dbGet('doom_salvos', 'status=eq.in_flight&select=origin_system_id,target_system_id,target_pid,target_planet,launched_at,ready_at,faction_id').catch(() => []),
      // ОБОРОНА: видимые мне минные поля, аванпосты и мои корабли-носители аванпостов.
      // RPC требуют авторизации и фракции игрока → для гостей/без фракции вернут
      // ошибку, а если _defense_*.sql ещё не применён — функции нет. Везде → [].
      user ? apiFetch('rpc/minefields_visible',  { method: 'POST', body: '{}' }).catch(() => []) : Promise.resolve([]),
      user ? apiFetch('rpc/outposts_visible',    { method: 'POST', body: '{}' }).catch(() => []) : Promise.resolve([]),
      user ? apiFetch('rpc/outpost_ships_mine',  { method: 'POST', body: '{}' }).catch(() => []) : Promise.resolve([]),
      user ? apiFetch('rpc/mza_ships_mine',      { method: 'POST', body: '{}' }).catch(() => []) : Promise.resolve([]),
    ]);
    GM.systems = (sys || []).map(s => ({ ...s, x: +s.x, y: +s.y, planets: s.planets || [] }));
    GM.lanes = lanes || [];
    GM.factions = facs || [];
    GM.routes = routes || [];
    GM.salvos = salvos || [];   // залпы артиллерии в полёте (для визуализации на карте)
    GM.minefields = Array.isArray(mines) ? mines : [];        // оборона: минные поля (гексы)
    GM.outposts   = Array.isArray(outposts) ? outposts : [];  // оборона: развёрнутые аванпосты
    GM.opShips    = Array.isArray(opShips) ? opShips : [];    // мои корабли-носители аванпостов (idle/в полёте)
    GM.mzaShips   = Array.isArray(mzaShips) ? mzaShips : [];  // мои Гиперпейсер — мобильные «Длани» (idle/в полёте)
    GM.sectors = (secs || []).map(s => ({ ...s, system_ids: s.system_ids || [] }));
    GM.econ = {};   // system_id → { status, prosperity } для режима «бедность»
    (econ || []).forEach(e => { if (e && e.system_id) GM.econ[e.system_id] = { status: e.status, prosperity: +e.prosperity }; });
    GM.loaded = true;
    GM.dataAt = Date.now();   // отметка свежести — фоновое обновление карты дросселируется по ней
    // мета фракций (флаг/герб, лидер) из анкет — необязательно
    GM.facMeta = {};
    try {
      // Метаданные (герб/лидер/имя/доктрина) — из анкеты (не меняются при переезде).
      // Столица (система + имя планеты) — из РЕАЛЬНОЙ столичной колонии (is_capital),
      // иначе переименование/перенос показывались бы как при регистрации.
      const [apps, cols] = await Promise.all([
        dbGet('faction_applications', 'status=eq.approved&select=faction_id,owner_id,herald_url,leader,gov,name,system_id,planet_name'),
        dbGet('colonies', 'select=*').catch(() => []),
      ]);
      GM.colonies = cols || [];   // реальные колонии (для панели системы)
      GM.capitals = {};   // system_id -> faction_id (актуальная столица)
      GM.capPlanet = {};  // system_id -> имя столичной планеты (актуальное)
      (apps || []).forEach(a => { if (a.faction_id) GM.facMeta[a.faction_id] = a; });
      // Предзагрузка гербов фракций СРАЗУ (параллельно с остальной загрузкой карты):
      // иначе картинки флагов начинали качаться только при первом рендере и «всплывали»
      // позже. Теперь к первому показу карты они обычно уже готовы; опоздавшие до-пекут
      // битмап по onload (см. gmmFlagImg). Грузим только тех, у кого есть herald_url.
      if (typeof gmmFlagImg === 'function') Object.keys(GM.facMeta).forEach(fid => gmmFlagImg(fid));
      // столица = колония с is_capital (после миграции) ИЛИ planet_type='Столичный мир' (текущий признак)
      (cols || []).forEach(c => {
        if (!c.faction_id || !c.system_id) return;
        if ((c.is_capital || c.planet_type === 'Столичный мир') && !GM.capitals[c.system_id]) {
          GM.capitals[c.system_id] = c.faction_id; GM.capPlanet[c.system_id] = c.planet_name;
        }
      });
      // Фракция игрока + постройки его колоний: «развитость» (сумма слотов) и
      // раскладка по типам (GM.bldByCol[colId] = {factory, mining, science, ...}).
      // Грузим colony_buildings ТОЛЬКО своей фракции: число/типы построек чужих —
      // это разведданные (вскрываются шпионажем), их нельзя выдавать на карте.
      GM.myFid = null; GM.devByCol = {}; GM.bldByCol = {};
      if (user) { const mine = (apps || []).find(a => a.owner_id === user.id && a.faction_id); if (mine) GM.myFid = mine.faction_id; }
      if (GM.myFid) {
        try {
          const blds = await dbGet('colony_buildings', `faction_id=eq.${GM.myFid}&select=colony_id,btype,slots_open`);
          (blds || []).forEach(b => {
            const slots = b.slots_open || 0;
            GM.devByCol[b.colony_id] = (GM.devByCol[b.colony_id] || 0) + slots;
            const m = GM.bldByCol[b.colony_id] || (GM.bldByCol[b.colony_id] = {});
            if (b.btype) m[b.btype] = (m[b.btype] || 0) + slots;
          });
        } catch (e) { /* таблицы может не быть */ }
      }
    } catch (e) { /* таблиц может не быть */ }
  } catch (e) {
    console.warn('[map] load error', e);
    toast('Ошибка загрузки карты: ' + e.message, 'err');
  }
}

// ── Точка входа (вызывается из go('map')) ───────────────────
async function renderGalaxyMap() {
  const host = document.getElementById('pg');
  host.className = 'pgi';
  if (GM.loaded) {
    // повторный заход: данные уже в памяти — рисуем мгновенно. Фоновое обновление —
    // не чаще раза в минуту: топология галактики не меняется поминутно, а каждый
    // фон-рефреш тянул ВСЕ системы (select=*) → лишний трафик к БД при частой навигации.
    const STALE_MS = 60 * 1000;
    if (Date.now() - (GM.dataAt || 0) > STALE_MS) {
      loadGalaxyData().then(() => {
        if (document.getElementById('pg') !== host) return;
        if (GMM.active) { gmmBuildWorld(); gmmRaster(); }
        else if (document.getElementById('gm-svg')) gmDraw();
      });
    }
  } else {
    host.innerHTML = `<div class="sload"><div class="pulse-loader"></div></div>`;
    await loadGalaxyData();
    if (document.getElementById('pg') !== host) return; // ушли со страницы
  }

  // Быстрый canvas-рендерер (GMM) — и на телефоне, и на ПК: SVG/DOM-вариант
  // при зуме пере-растеризует весь вектор → мигание и адские лаги (см. блок GMM).
  // Старый SVG-рендер остаётся ТОЛЬКО как редактор карты: редактор входит в него
  // кнопкой «Редактировать», что выставляет GM.editSession (см. gmEnterEdit).
  if (gmIsMobile() || !GM.editSession) { GM.edit = false; gmmRender(host); return; }
  GMM.active = false;

  // сброс временного состояния (DOM пересоздаётся при каждом входе)
  GM.edit = false; GM.mode = 'select'; GM.linkFrom = null;
  GM.drag = null; GM.panning = false; GM.fullscreen = false; GM.touch = null;

  const canEdit = gmCanEdit();
  host.innerHTML = `
    <div id="gm-wrap">
      <div id="gm-viewport">
        <div id="gm-bg"></div>
        <div id="gm-canvas">
          <svg id="gm-svg" viewBox="0 0 ${GM_W} ${GM_H}" preserveAspectRatio="none"></svg>
          <div id="gm-stars"></div>
        </div>
      </div>
      <div id="gm-coord">X: 0 | Y: 0</div>
      <div id="gm-controls">${gmCtlBtns()}</div>
      ${canEdit ? gmToolbarHtml() : ''}
      <div id="gm-panel" class="gm-hidden"></div>
      <div id="gm-form" class="gm-hidden"></div>
    </div>`;

  gmBindViewport();
  gmBindResTip();
  document.getElementById('gm-wrap')?.classList.toggle('gm-show-res', GM.showRes);
  document.getElementById('gm-wrap')?.classList.toggle('gm-show-econ', GM.showEcon);
  gmFit();
  gmDraw();
}

function gmToolbarHtml() {
  return `<div id="gm-toolbar">
    <button class="gm-tb-btn gm-tb-exit" onclick="gmExitEdit()">← К карте</button>
    <button class="gm-tb-btn" id="gm-edit-toggle" onclick="gmToggleEdit()">✎ Редактировать карту</button>
    <div id="gm-edit-tools" class="gm-hidden">
      <button class="gm-tb-btn" data-mode="select" onclick="gmSetMode('select')">✥ Двигать</button>
      <button class="gm-tb-btn" data-mode="add" onclick="gmSetMode('add')">＋ Звезда</button>
      <button class="gm-tb-btn" data-mode="link" onclick="gmSetMode('link')">⟿ Проложить</button>
      <button class="gm-tb-btn" data-mode="unlink" onclick="gmSetMode('unlink')">✕ Убрать путь</button>
      <button class="gm-tb-btn" data-mode="sector" onclick="gmSetMode('sector')">▣ Сектора</button>
      <span class="gm-tb-hint" id="gm-tb-hint"></span>
    </div>
  </div>`;
}

// ── Камера: fit / clamp / apply ─────────────────────────────
function gmMinScale() {
  const vp = document.getElementById('gm-viewport');
  if (!vp) return 0.1;
  // contain: видно всю галактику целиком
  return Math.min(vp.clientWidth / GM_W, vp.clientHeight / GM_H);
}
function gmFit() {
  if (GMM.active) { gmmFit(true); return; }
  const vp = document.getElementById('gm-viewport');
  if (!vp) return;
  const w = vp.clientWidth, h = vp.clientHeight;
  if (GM.systems.length > 0) {
    // Центрируем на кластере звёзд, а не на всём холсте
    const xs = GM.systems.map(s => s.x), ys = GM.systems.map(s => s.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 250;
    GM.scale = Math.min(w / (maxX - minX + pad * 2), h / (maxY - minY + pad * 2));
    GM.tx = w / 2 - (minX + maxX) / 2 * GM.scale;
    GM.ty = h / 2 - (minY + maxY) / 2 * GM.scale;
  } else {
    GM.scale = gmMinScale();
    GM.tx = (w - GM_W * GM.scale) / 2;
    GM.ty = (h - GM_H * GM.scale) / 2;
  }
  gmApply();
}
function gmClamp() {
  const vp = document.getElementById('gm-viewport');
  if (!vp) return;
  const w = vp.clientWidth, h = vp.clientHeight;
  const minScale = gmMinScale();
  GM.scale = Math.min(Math.max(GM.scale, minScale), GM_MAX_SCALE);
  const mw = GM_W * GM.scale, mh = GM_H * GM.scale;
  GM.tx = Math.min(0, Math.max(GM.tx, w - mw));
  GM.ty = Math.min(0, Math.max(GM.ty, h - mh));
  if (mw < w) GM.tx = (w - mw) / 2;
  if (mh < h) GM.ty = (h - mh) / 2;
}
let _gmStrokeT = null;
function gmApply() {
  gmClamp();
  const c = document.getElementById('gm-canvas');
  if (c) {
    c.style.transform = `translate(${GM.tx}px, ${GM.ty}px) scale(${GM.scale})`;
    // LOD-масштаб иконок/подписей: контр-множитель к линейному зуму canvas,
    // чтобы итоговый экранный размер рос сублинейно (как на мобайле: base·scale^0.7).
    // iconK = scale^0.7 / scale = scale^-0.3 — вдали иконки крупнее, вблизи не раздуваются.
    const k = Math.max(0.5, Math.min(2.2, Math.pow(GM.scale, -0.3)));
    c.style.setProperty('--gm-icon-k', k.toFixed(3));
  }
  // Глубокий зум: звёзды раскрываются в анимированные системы (орбиты по составу)
  document.getElementById('gm-wrap')?.classList.toggle('gm-deepzoom', GM.scale >= GM_DEEP_SCALE);
  // Толщину обводок обновляем НЕ каждый кадр зума (это меняет CSS-переменные и
  // заставляет перерисовывать весь SVG → лаги), а с задержкой, после остановки.
  clearTimeout(_gmStrokeT);
  _gmStrokeT = setTimeout(gmUpdateStrokes, 110);
}

// ── Привязка событий вьюпорта ───────────────────────────────
function gmBindViewport() {
  const vp = document.getElementById('gm-viewport');
  if (!vp) return;

  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const px = (mx - GM.tx) / GM.scale, py = (my - GM.ty) / GM.scale;
    GM.scale += (e.deltaY > 0 ? -1 : 1) * 0.12 * GM.scale;
    GM.scale = Math.min(Math.max(GM.scale, gmMinScale()), GM_MAX_SCALE);
    GM.tx = mx - px * GM.scale;
    GM.ty = my - py * GM.scale;
    gmApply();
  }, { passive: false });

  // ── Touch: 1 палец — пан, 2 пальца — пинч-зум ──
  vp.addEventListener('touchstart', gmTouchStart, { passive: false });
  vp.addEventListener('touchmove', gmTouchMove, { passive: false });
  vp.addEventListener('touchend', gmTouchEnd);
  vp.addEventListener('touchcancel', gmTouchEnd);

  // координаты курсора в системе карты
  vp.addEventListener('mousemove', (e) => {
    const r = vp.getBoundingClientRect();
    const x = Math.round((e.clientX - r.left - GM.tx) / GM.scale);
    const y = Math.round((e.clientY - r.top - GM.ty) / GM.scale);
    const cp = document.getElementById('gm-coord');
    if (cp && x >= 0 && y >= 0 && x <= GM_W && y <= GM_H) cp.textContent = `X: ${x} | Y: ${y}`;
  });

  // старт панорамирования / добавление звезды по пустому месту
  vp.addEventListener('mousedown', (e) => {
    if (e.target.closest('.gm-star') || e.target.closest('.hyperlane-hit') ||
        e.target.closest('.gm-sec-hit') || e.target.closest('.gm-sec-label') ||
        e.target.closest('#gm-panel') || e.target.closest('#gm-form') ||
        e.target.closest('#gm-sector') || e.target.closest('#gm-toolbar')) return;
    if (GM.edit && GM.mode === 'add') {
      const r = vp.getBoundingClientRect();
      const x = Math.round((e.clientX - r.left - GM.tx) / GM.scale);
      const y = Math.round((e.clientY - r.top - GM.ty) / GM.scale);
      gmAddStar(x, y);
      return;
    }
    GM.panning = true;
    vp.classList.add('gm-grabbing');
    GM.panStart = { x: e.clientX - GM.tx, y: e.clientY - GM.ty };
  });

  // глобальные слушатели (живут, пока вьюпорт в DOM)
  window.addEventListener('mousemove', gmWindowMove);
  window.addEventListener('mouseup', gmWindowUp);
  window.addEventListener('resize', gmOnResize);
}

function gmOnResize() { if (document.getElementById('gm-viewport')) gmApply(); }

function gmWindowMove(e) {
  const vp = document.getElementById('gm-viewport');
  if (!vp) { window.removeEventListener('mousemove', gmWindowMove); return; }
  // Кнопку мыши отпустили вне окна (mouseup до нас не дошёл) — панорамирование/драг
  // «залипли». Без этого следующий пассивный mousemove с устаревшим panStart рывком
  // швыряет карту, и gmClamp загоняет её в дальний угол мира.
  if ((GM.panning || GM.drag) && !(e.buttons & 1)) { gmWindowUp(); return; }
  if (GM.drag) {
    const r = vp.getBoundingClientRect();
    const x = (e.clientX - r.left - GM.tx) / GM.scale;
    const y = (e.clientY - r.top - GM.ty) / GM.scale;
    GM.drag.sys.x = Math.max(0, Math.min(GM_W, Math.round(x)));
    GM.drag.sys.y = Math.max(0, Math.min(GM_H, Math.round(y)));
    GM.drag.moved = true;
    gmDraw();
    return;
  }
  if (GM.panning && GM.panStart) {
    GM.tx = e.clientX - GM.panStart.x;
    GM.ty = e.clientY - GM.panStart.y;
    gmApply();
  }
}

async function gmWindowUp() {
  const vp = document.getElementById('gm-viewport');
  if (vp) vp.classList.remove('gm-grabbing');
  GM.panning = false; GM.panStart = null;
  if (GM.drag) {
    const d = GM.drag; GM.drag = null;
    if (d.moved) {
      try { await dbPatch('map_systems', 'id=eq.' + encodeURIComponent(d.sys.id), { x: d.sys.x, y: d.sys.y }); }
      catch (e) { toast('Не сохранилось: ' + e.message, 'err'); }
    }
  }
}

// ── Touch (мобильные жесты) ─────────────────────────────────
function gmTouchDist(t) {
  const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
  return Math.hypot(dx, dy);
}
function gmTouchStart(e) {
  const vp = document.getElementById('gm-viewport');
  if (!vp) return;
  if (e.touches.length === 1) {
    const tt = e.touches[0];
    // тап по звезде — не панорамируем (даём сработать click)
    if (tt.target.closest && tt.target.closest('.gm-star')) { GM.touch = null; return; }
    e.preventDefault();
    GM.touch = { mode: 'pan', x: tt.clientX - GM.tx, y: tt.clientY - GM.ty };
  } else if (e.touches.length === 2) {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
    GM.touch = { mode: 'pinch', dist: gmTouchDist(e.touches), scale: GM.scale,
      px: (mx - GM.tx) / GM.scale, py: (my - GM.ty) / GM.scale, mx, my };
  }
}
function gmTouchMove(e) {
  if (!GM.touch) return;
  const vp = document.getElementById('gm-viewport');
  if (!vp) return;
  e.preventDefault();
  if (GM.touch.mode === 'pan' && e.touches.length === 1) {
    GM.tx = e.touches[0].clientX - GM.touch.x;
    GM.ty = e.touches[0].clientY - GM.touch.y;
    gmApply();
  } else if (GM.touch.mode === 'pinch' && e.touches.length === 2) {
    const d = gmTouchDist(e.touches);
    GM.scale = Math.min(Math.max(GM.touch.scale * (d / GM.touch.dist), gmMinScale()), GM_MAX_SCALE);
    GM.tx = GM.touch.mx - GM.touch.px * GM.scale;
    GM.ty = GM.touch.my - GM.touch.py * GM.scale;
    gmApply();
  }
}
function gmTouchEnd() { GM.touch = null; }

// ── Контролы (границы / зум / фуллскрин) ────────────────────
function gmToggleBorders() {
  GM.showBorders = !GM.showBorders;
  document.getElementById('gm-ctl-borders')?.classList.toggle('gm-active', GM.showBorders);
  if (GMM.active) { gmmRaster(); return; }
  document.getElementById('gm-svg')?.classList.toggle('gm-noborders', !GM.showBorders);
}
// Флаги фракций поверх территорий (отдельно от границ — можно выключить, оставив
// границы/заливки). Влияет только на canvas-рендер (GMM); в SVG-редакторе флагов нет.
function gmToggleFlags() {
  GM.showFlags = !GM.showFlags;
  document.getElementById('gm-ctl-flags')?.classList.toggle('gm-active', GM.showFlags);
  if (GMM.active) gmmRaster();
}
// ── Режим «ресурсы систем» ──────────────────────────────────
// Над каждой звездой — сводка ресурсов системы (уникальные по названию ресурсы
// всех её планет). Что именно показывать — задают фильтры по редкости, чтобы
// карта не превращалась в кашу из иконок.
const GM_RARITY_ORDER = { legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 };
const GM_RARITIES = [   // порядок кнопок: от ценных к обычным
  { r: 'legendary', short: 'Л', name: 'Легендарные' },
  { r: 'epic', short: 'Э', name: 'Эпические' },
  { r: 'rare', short: 'Ц', name: 'Ценные' },
  { r: 'uncommon', short: 'Р', name: 'Редкие' },
  { r: 'common', short: 'О', name: 'Обычные' },
];
function gmSysRes(sys) {
  const map = new Map(); // name → {name, icon, r}  (храним самую высокую редкость)
  (sys.planets || []).forEach(p => {
    const list = p && Array.isArray(p.resources) ? p.resources : [];
    list.forEach(r => {
      if (!r || !r.name) return;
      const cur = map.get(r.name);
      if (!cur || (GM_RARITY_ORDER[r.r] || 0) > (GM_RARITY_ORDER[cur.r] || 0))
        map.set(r.name, { name: r.name, icon: r.icon, r: r.r });
    });
  });
  return [...map.values()].sort((a, b) => (GM_RARITY_ORDER[b.r] || 0) - (GM_RARITY_ORDER[a.r] || 0));
}
// Полоска фильтров редкости (видна только в режиме ресурсов)
function gmResFilterHtml() {
  const btns = GM_RARITIES.map(R => {
    const on = GM.resRarities.includes(R.r);
    return `<button class="gm-rf r-${R.r}${on ? ' gm-on' : ''}" data-r="${R.r}" title="${R.name}" onclick="gmSetResRarity('${R.r}')">${R.short}</button>`;
  }).join('');
  return `<div id="gm-res-filter" class="${GM.showRes ? '' : 'gm-hidden'}">${btns}</div>`;
}
function gmToggleRes() {
  GM.showRes = !GM.showRes;
  document.getElementById('gm-wrap')?.classList.toggle('gm-show-res', GM.showRes);
  document.getElementById('gm-ctl-res')?.classList.toggle('gm-active', GM.showRes);
  document.getElementById('gm-res-filter')?.classList.toggle('gm-hidden', !GM.showRes);
  if (GMM.active) gmmRaster();
}

// ── Режим «бедность»: раскраска систем по просперити (кэш system_econ) ──
function gmEconLegendHtml() {
  return `<div id="gm-econ-legend" class="${GM.showEcon ? '' : 'gm-hidden'}">
    <span class="gm-el gm-el-poor">бедность</span>
    <span class="gm-el gm-el-mid">впритык</span>
    <span class="gm-el gm-el-rich">достаток</span>
  </div>`;
}
function gmToggleEcon() {
  GM.showEcon = !GM.showEcon;
  document.getElementById('gm-wrap')?.classList.toggle('gm-show-econ', GM.showEcon);
  document.getElementById('gm-ctl-econ')?.classList.toggle('gm-active', GM.showEcon);
  document.getElementById('gm-econ-legend')?.classList.toggle('gm-hidden', !GM.showEcon);
  if (GMM.active) gmmRaster();
  else gmDrawSvg();   // SVG-рендер: режим «бедность» перекрашивает САМИ ячейки (не ореолы)
}
// Цвет по просперити: стагнация — бордовый, далее красный→оранж→жёлтый→зелёный.
function gmEconColor(pr, status) {
  if (status === 'stagnation') return '#c0392b';
  if (pr <= 0.6) return '#e74c3c';
  if (pr <= 0.85) return '#e67e22';
  if (pr < 1.1) return '#f1c40f';
  return '#2ecc71';
}
// Заливка ячейки системы в режиме «бедность»: полупрозрачный цвет просперити прямо
// в границах системы (вместо ореола-кольца). Нет данных — нейтральная серая дымка.
function gmEconFill(s) {
  const e = GM.econ && GM.econ[s.id];
  if (!e || e.prosperity == null || isNaN(e.prosperity)) return 'rgba(90,100,120,0.16)';
  const [r, g, b] = gmRgb(gmEconColor(e.prosperity, e.status));
  return `rgba(${r},${g},${b},0.5)`;
}
function gmSetResRarity(r) {
  const i = GM.resRarities.indexOf(r);
  if (i >= 0) GM.resRarities.splice(i, 1); else GM.resRarities.push(r);
  document.querySelector(`#gm-res-filter .gm-rf[data-r="${r}"]`)?.classList.toggle('gm-on', GM.resRarities.includes(r));
  if (GMM.active) { gmmRaster(); return; }
  gmDrawStars();   // пересобираем сводки над звёздами под новый фильтр
}
function gmZoomBtn(dir) {
  if (GMM.active) { gmmZoomAt(GMM.vw / 2, GMM.vh / 2, GMM.s * (dir > 0 ? 1.45 : 1 / 1.45), true); return; }
  const vp = document.getElementById('gm-viewport');
  if (!vp) return;
  const w = vp.clientWidth, h = vp.clientHeight;
  const px = (w / 2 - GM.tx) / GM.scale, py = (h / 2 - GM.ty) / GM.scale;
  GM.scale = Math.min(Math.max(GM.scale * (dir > 0 ? 1.3 : 1 / 1.3), gmMinScale()), GM_MAX_SCALE);
  GM.tx = w / 2 - px * GM.scale;
  GM.ty = h / 2 - py * GM.scale;
  gmApply();
}
function gmToggleFullscreen() {
  const wrap = document.getElementById('gm-wrap');
  if (!wrap) return;
  const nativeFs = document.fullscreenElement || document.webkitFullscreenElement;
  const fallbackFs = !nativeFs && wrap.classList.contains('gm-fullscreen');
  if (nativeFs) {                            // выйти из нативного
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    return;
  }
  if (fallbackFs) { gmFallbackFs(false); return; }  // выйти из фолбэка
  const req = wrap.requestFullscreen || wrap.webkitRequestFullscreen;   // войти
  if (req) req.call(wrap).catch(() => gmFallbackFs(true));
  else gmFallbackFs(true);
}
// CSS-фолбэк: переносим карту в <body>, чтобы overflow/transform родителей не мешали
function gmFallbackFs(on) {
  const wrap = document.getElementById('gm-wrap');
  if (!wrap) return;
  if (on) {
    if (!GM._fsHome) { GM._fsHome = wrap.parentNode; }
    document.body.appendChild(wrap);
    wrap.classList.add('gm-fullscreen');
  } else {
    wrap.classList.remove('gm-fullscreen');
    if (GM._fsHome) { GM._fsHome.appendChild(wrap); GM._fsHome = null; }
  }
  document.getElementById('gm-ctl-fs')?.classList.toggle('gm-active', on);
  requestAnimationFrame(() => { if (GMM.active) gmmResize(); else { gmClamp(); gmApply(); } });
}
function gmOnFsChange() {
  const wrap = document.getElementById('gm-wrap');
  if (!wrap) return;
  const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  wrap.classList.toggle('gm-fullscreen', fs);
  document.getElementById('gm-ctl-fs')?.classList.toggle('gm-active', fs);
  requestAnimationFrame(() => { if (GMM.active) gmmResize(); else { gmClamp(); gmApply(); } });
}
if (!window._gmFsBound) {
  window._gmFsBound = true;
  document.addEventListener('fullscreenchange', gmOnFsChange);
  document.addEventListener('webkitfullscreenchange', gmOnFsChange);
}

// ── Отрисовка (Вороной + гиперпути + звёзды) ────────────────
function gmDraw() {
  gmDrawSvg();
  gmDrawStars();
}

// Детерминированный шум: одинаков для двух соседних ячеек на общем ребре,
// чтобы границы оставались стыкованными.
function gmEdgeHash(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
// Внутренние возмущённые точки одного ребра a→b (детерминированно, без концов).
// Общий шум по отсортированным концам → два соседних ребра/ячейки совпадут (без щелей).
// Подразбиение АДАПТИВНОЕ: ~1 точка на 12px (длинные рёбра → много мелких сегментов),
// амплитуда — две октавы шума для «природного» сложного края.
function gmEdgeSubs(a, b, amp = 8) {
  const onBox = (p) => p[0] <= 0.5 || p[1] <= 0.5 || p[0] >= GM_W - 0.5 || p[1] >= GM_H - 0.5;
  if (onBox(a) && onBox(b)) return [];   // рёбра bbox карты не трогаем
  const swap = (a[0] > b[0]) || (a[0] === b[0] && a[1] > b[1]);
  const p = swap ? b : a, q = swap ? a : b;
  const cdx = q[0] - p[0], cdy = q[1] - p[1];
  const clen = Math.hypot(cdx, cdy);
  if (clen < 6) return [];
  const nx = -cdy / clen, ny = cdx / clen;
  // вариативность: у каждого ребра своя «изрезанность» (0.5–1.6×) — границы не однообразны
  const vary = 0.5 + gmEdgeHash(p[0] * 0.13 + q[0] * 0.91, p[1] * 0.57 + q[1] * 0.19) * 1.1;
  const localAmp = Math.min(amp * vary, clen * 0.32);
  // меньше точек на ребро = легче пути (производительность пана/зума)
  const n = Math.max(4, Math.min(13, Math.round(clen / 16)));
  const subs = [];
  for (let s = 1; s < n; s++) {
    const tc = s / n;
    // две октавы шума: крупная волна + деталь → изрезанный «природный» край
    const lo  = gmEdgeHash(p[0] + q[0] * 0.37 + tc * 53.1,  p[1] + q[1] * 0.29 + tc * 91.7)  - 0.5;
    const mid = gmEdgeHash(p[0] * 0.71 + tc * 137.3,        q[1] * 0.83 + tc * 311.5)        - 0.5;
    const off = (lo * 1.25 + mid * 0.55) * localAmp;
    subs.push([p[0] + cdx * tc + nx * off, p[1] + cdy * tc + ny * off]);
  }
  if (swap) subs.reverse();   // вернуть в порядке a→b
  return subs;
}
function gmPerturbPoly(poly, amp = 8) {
  if (!poly || poly.length < 2) return poly;
  const out = [];
  for (let i = 0; i < poly.length - 1; i++) {
    out.push(poly[i]);
    for (const s of gmEdgeSubs(poly[i], poly[i + 1], amp)) out.push(s);
  }
  return out;
}
// Возмущённое ребро как самостоятельный путь (с концами) — совпадает с заливкой.
function gmPerturbEdge(a, b, amp = 8) {
  return [a, ...gmEdgeSubs(a, b, amp), b];
}
// Catmull-Rom → cubic-Bezier, замкнутый путь, мягкое скругление углов
function gmSmoothPath(pts) {
  const n = pts.length;
  if (n < 3) return pts.slice(1).map(p => 'L' + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
  const k = 0.18; // натяжение — небольшое, чтобы не «надувать» ячейки
  let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) * k;
    const c1y = p1[1] + (p2[1] - p0[1]) * k;
    const c2x = p2[0] - (p3[0] - p1[0]) * k;
    const c2y = p2[1] - (p3[1] - p1[1]) * k;
    d += 'C' + c1x.toFixed(1) + ',' + c1y.toFixed(1)
       + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1)
       + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
  }
  return d;
}

// Детерминированные «пустые» seed-точки по всему холсту.
// Они участвуют в вычислении Вороного и создают органические границы в пустоте,
// но не рендерятся как звёзды и не имеют заливки.
function gmPhantomSeeds() {
  const SPACING = 310, JITTER = 0.48, MIN_D = 190;
  const seeds = [];
  const cols = Math.ceil(GM_W / SPACING) + 1;
  const rows = Math.ceil(GM_H / SPACING) + 1;
  for (let gx = 0; gx < cols; gx++) {
    for (let gy = 0; gy < rows; gy++) {
      const bx = gx * SPACING + SPACING / 2;
      const by = gy * SPACING + SPACING / 2;
      const jx = (gmEdgeHash(bx * 0.37 + by * 1.1, bx * 0.9 + gy) - 0.5) * SPACING * JITTER;
      const jy = (gmEdgeHash(bx * 1.3 + by * 0.61, by * 0.8 + gx) - 0.5) * SPACING * JITTER;
      const px = Math.max(5, Math.min(GM_W - 5, bx + jx));
      const py = Math.max(5, Math.min(GM_H - 5, by + jy));
      if (GM.systems.some(s => Math.hypot(s.x - px, s.y - py) < MIN_D)) continue;
      seeds.push({ id: `_ph_${gx}_${gy}`, x: px, y: py, faction: null, phantom: true });
    }
  }
  return seeds;
}

// «Вес» системы = радиус кольца дополнительных seed-точек вокруг неё.
// Крупная звезда → её ячейки сливаются в одну БОЛЬШУЮ область, соседи поджимаются.
// (приближение взвешенного Вороного через мульти-seed; тайлинг сохраняется)
function gmSysWeight(s) {
  if (s.phantom) return 0;
  if (s.faction === 'rift') return s.id === 'rift_core' ? 120 : 0;
  return s.is_giant ? 165 : 0;
}

function gmVoronoiCells() {
  if (!window.d3 || !d3.Delaunay || GM.systems.length < 1) return [];
  try {
    const LANE_BIAS = 0.07;
    const sysById = Object.fromEntries(GM.systems.map(s => [s.id, s]));
    const phantoms = gmPhantomSeeds();
    const all = [...GM.systems, ...phantoms];
    // базовая позиция (со сдвигом к соседям по гиперпутям)
    const basePos = s => {
      if (s.phantom) return [s.x, s.y];
      const nbrs = GM.lanes
        .filter(l => l.a_id === s.id || l.b_id === s.id)
        .map(l => sysById[l.a_id === s.id ? l.b_id : l.a_id])
        .filter(Boolean);
      if (!nbrs.length) return [s.x, s.y];
      const cx = nbrs.reduce((a, n) => a + n.x, 0) / nbrs.length;
      const cy = nbrs.reduce((a, n) => a + n.y, 0) / nbrs.length;
      return [s.x + (cx - s.x) * LANE_BIAS, s.y + (cy - s.y) * LANE_BIAS];
    };
    // разворачиваем каждую систему в один или несколько seed'ов (вес → кольцо)
    const pts = [], owners = [];   // owners[i] = система-владелец seed'а i
    const RING = 6;                // точек в кольце крупной звезды
    all.forEach(s => {
      const [bx, by] = basePos(s);
      const w = gmSysWeight(s);
      pts.push([bx, by]); owners.push(s);            // центр
      if (w > 0) for (let k = 0; k < RING; k++) {
        const a = (k / RING) * Math.PI * 2;
        pts.push([bx + Math.cos(a) * w, by + Math.sin(a) * w]); owners.push(s);
      }
    });
    const del = d3.Delaunay.from(pts);
    const vor = del.voronoi([0, 0, GM_W, GM_H]);
    return owners.map((s, i) => ({ sys: s, poly: vor.cellPolygon(i) }));
  } catch (e) { console.warn('[map] voronoi', e); return []; }
}

// ── Общая геометрия карты (для SVG-рендера десктопа и canvas-рендера телефона):
//    заливки ячеек, классифицированные границы и изогнутые гиперпути ──
function gmBuildGeo() {
  const cells = gmVoronoiCells();

  // карта система → id сектора (одно членство; defensive — берём первый)
  const sectorsR = gmSectorsForRender();
  const secOfSys = {};
  sectorsR.forEach(sec => (sec.system_ids || []).forEach(id => { if (!secOfSys[id]) secOfSys[id] = sec.id; }));

  // ── Заливки ячеек ──
  //   реальные системы → цвет фракции; ПУСТОТА (фантом-ячейки) → тёмный «туман войны»;
  //   территория сектора → лёгкая цветная подложка.
  const fills = [];     // {fac?, isRift, isFog, pts}
  const secFills = [];  // {color, pts}
  const fog = [];   // полигоны пустоты — единая пелена «тумана войны» (расступается у звёзд)
  cells.forEach(({ sys, poly }) => {
    if (!poly) return;
    if (sys.phantom) { fog.push(gmPerturbPoly(poly)); return; }
    const fac = gmFaction(sys.faction);
    const pts = gmPerturbPoly(poly);
    fills.push({ sys, fac, isRift: !!(fac && fac.id === 'rift'), pts });
    const sid = secOfSys[sys.id];
    if (sid) { const sec = sectorsR.find(x => x.id === sid); if (sec) secFills.push({ secId: sid, color: sec.color || 'rgba(120,200,255,0.5)', pts }); }
  });

  // ── Границы: схлопываем внутренние рёбра. Ребро между двумя ячейками ОДНОЙ
  //    фракции не рисуем — остаётся только внешний контур территории. ──
  const edgeMap = new Map();
  const ekey = (a, b) => {
    const ax = Math.round(a[0] * 10), ay = Math.round(a[1] * 10);
    const bx = Math.round(b[0] * 10), by = Math.round(b[1] * 10);
    return (ax < bx || (ax === bx && ay <= by)) ? `${ax},${ay}|${bx},${by}` : `${bx},${by}|${ax},${ay}`;
  };
  cells.forEach(({ sys, poly }) => {
    if (!poly) return;
    const fid = sys.faction || null;
    const secId = secOfSys[sys.id] || null;
    for (let i = 0; i < poly.length - 1; i++) {
      const k = ekey(poly[i], poly[i + 1]);
      let e = edgeMap.get(k);
      if (!e) { e = { a: poly[i], b: poly[i + 1], sides: [] }; edgeMap.set(k, e); }
      e.sides.push({ fid, secId, oid: sys.id, ph: !!sys.phantom, sx: sys.x, sy: sys.y });
    }
  });
  const edges = [];   // {kind:'front'|'fac'|'rift'|'neutral', color?, pts}
  const FRONT_OFF = 4;   // смещение линии фронта к своей территории (user units)
  edgeMap.forEach(e => {
    if (e.sides.length === 2 && e.sides[0].oid === e.sides[1].oid) return; // sub-ячейки одной звезды
    if (e.sides.every(s => s.ph)) return;                                 // ребро в глубине пустоты — скрыто туманом
    const facSides = e.sides.filter(s => s.fid && gmFaction(s.fid));
    const distinct = [...new Set(facSides.map(s => s.fid))];
    if (facSides.length === 2 && distinct.length === 1) return; // внутреннее ребро одной фракции
    const pts = gmPerturbEdge(e.a, e.b);
    if (distinct.length >= 2) {
      // ── ЛИНИЯ ФРОНТА: две границы, каждая смещена к своей стороне ──
      const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L, mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2;
      facSides.forEach(s => {
        const fac = gmFaction(s.fid);
        const sign = ((s.sx - mx) * nx + (s.sy - my) * ny) >= 0 ? 1 : -1;
        const ox = nx * FRONT_OFF * sign, oy = ny * FRONT_OFF * sign;
        // nrm — единичная нормаль ВНУТРЬ территории фракции (для зубцов «оборонной»
        // границы). phase сдвигает зубцы одной стороны фронта на полшага → встречные
        // шипы входят в шахматном порядке, а не остриё в остриё.
        edges.push({ kind: 'front', color: gmSolidColor(fac.color), pts: pts.map(p => [p[0] + ox, p[1] + oy]), nrm: [nx * sign, ny * sign], phase: sign > 0 ? 0 : 0.5 });
      });
    } else if (distinct.length === 1) {
      const fac = gmFaction(distinct[0]);
      if (fac.id === 'rift') edges.push({ kind: 'rift', pts });
      else {
        // нормаль внутрь — к центру своей звезды (зубцы смотрят в свою территорию)
        const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L, ny = dx / L, mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2;
        const fs = facSides[0] || e.sides.find(s => s.fid) || { sx: mx, sy: my };
        const sign = ((fs.sx - mx) * nx + (fs.sy - my) * ny) >= 0 ? 1 : -1;
        edges.push({ kind: 'fac', color: gmSolidColor(fac.color), pts, nrm: [nx * sign, ny * sign] });
      }
    } else if (!e.sides.some(s => s.ph)) {
      // нейтральная граница рисуется только МЕЖДУ реальными ничейными системами;
      // у кромки пустоты (рядом фантом) — не рисуем, туман сам очерчивает берег
      edges.push({ kind: 'neutral', color: 'rgba(150,170,200,0.18)', pts });
    }
  });

  // ── Границы СЕКТОРОВ: ребро между членом сектора и не-членом (или иным сектором).
  //    Рисуется поверх фракционных границ особым стилем (анимированный пунктир). ──
  const secEdges = [];   // {secId, color, pts}
  edgeMap.forEach(e => {
    const s0 = e.sides[0] ? e.sides[0].secId : null;
    const s1 = e.sides[1] ? e.sides[1].secId : null;
    if (s0 === s1) return;                       // обе стороны в одном секторе (или обе вне) → внутреннее
    const pts = gmPerturbEdge(e.a, e.b, 5);      // лёгкое возмущение — мягче, чем у границ территорий
    [s0, s1].forEach((sid, idx) => {
      if (!sid || sid === (idx === 0 ? s1 : s0)) return;
      const sec = sectorsR.find(x => x.id === sid);
      if (sec) secEdges.push({ secId: sid, color: gmReadable(sec.color || '#7cc8ff'), pts });
    });
  });

  // ── Метки секторов: центр масс систем сектора (мировые координаты) ──
  const secLabels = [];
  sectorsR.forEach(sec => {
    const mem = (sec.system_ids || []).map(id => GM.systems.find(s => s.id === id)).filter(Boolean);
    if (!mem.length) return;
    const cx = mem.reduce((a, s) => a + s.x, 0) / mem.length;
    const cy = mem.reduce((a, s) => a + s.y, 0) / mem.length;
    secLabels.push({ id: sec.id, name: sec.name, color: gmReadable(sec.color || '#7cc8ff'), x: cx, y: cy });
  });

  // ── Гиперпути: слегка изогнутая кривая вместо прямой. Изгиб детерминированный
  //    (хэш по концам) — стабилен между перерисовками, не зависит от порядка. ──
  const lanes = [];
  GM.lanes.forEach(l => {
    const a = GM.systems.find(s => s.id === l.a_id), b = GM.systems.find(s => s.id === l.b_id);
    if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const nx = -dy / len, ny = dx / len;
    const h = gmEdgeHash(Math.min(a.x, b.x) + Math.max(a.x, b.x) * 0.31, Math.min(a.y, b.y) + Math.max(a.y, b.y) * 0.47);
    const bend = (h - 0.5) * 2 * Math.min(len * 0.11, 55);
    lanes.push({ id: l.id, a_id: l.a_id, b_id: l.b_id, ax: a.x, ay: a.y, cx: +(mx + nx * bend).toFixed(1), cy: +(my + ny * bend).toFixed(1), bx: b.x, by: b.y });
  });

  return { fills, secFills, edges, lanes, secEdges, secLabels, fog };
}

function gmDrawSvg() {
  const svg = document.getElementById('gm-svg');
  if (!svg) return;
  const geo = gmBuildGeo();
  const dOf = (pts, close) => 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + (close ? 'Z' : '');

  const fillHtml = geo.fills.map(f => {
    const d = dOf(f.pts, true);
    if (f.isFog) return `<path class="vor-fog" d="${d}" fill="rgba(4,6,12,${f.fogA != null ? f.fogA : 0.55})" stroke="none"></path>`;  // туман войны (пустота)
    if (f.isRift) return `<path class="vor-cell vor-rift" d="${d}" stroke="none"></path>`;  // заливка/анимация — в CSS
    // Режим «бедность»: ячейку красим по просперити системы (а не цветом фракции).
    const fill = GM.showEcon ? gmEconFill(f.sys) : (f.fac ? f.fac.color : 'rgba(120,140,170,0.05)');
    const cls = 'vor-cell' + (f.fac ? ' vor-claimed' : ' vor-neutral');
    return `<path class="${cls}" d="${d}" fill="${fill}" stroke="none"></path>`;
  }).join('');

  // подложка территории сектора (поверх заливок фракций, под границами)
  const secFillHtml = (geo.secFills || []).map(f =>
    `<path class="gm-sec-fill" d="${dOf(f.pts, true)}" fill="${f.color}" stroke="none"></path>`).join('');

  const facBorderHtml = [], neutralBorderHtml = [];
  geo.edges.forEach(e => {
    const d = dOf(e.pts);
    if (e.kind === 'front') facBorderHtml.push(`<path class="vor-cell vor-edge vor-claimed vor-front" d="${d}" fill="none" stroke="${e.color}"></path>`);
    else if (e.kind === 'rift') facBorderHtml.push(`<path class="vor-cell vor-edge vor-rift-edge" d="${d}" fill="none"></path>`);
    else if (e.kind === 'fac') facBorderHtml.push(`<path class="vor-cell vor-edge vor-claimed" d="${d}" fill="none" stroke="${e.color}"></path>`);
    else neutralBorderHtml.push(`<path class="vor-cell vor-edge vor-neutral" d="${d}" fill="none" stroke="${e.color}"></path>`);
  });

  const laneHtml = geo.lanes.map(L => {
    const d = `M${L.ax},${L.ay} Q${L.cx},${L.cy} ${L.bx},${L.by}`;
    const cls = 'hyperlane' + (GM.edit && GM.mode === 'unlink' ? ' gm-deletable' : '');
    const visible = `<path class="${cls}" d="${d}" fill="none"></path>`;
    if (GM.edit && GM.mode === 'unlink') {
      const hit = `<path class="hyperlane-hit" d="${d}" fill="none" onclick="gmDeleteLane('${L.id}')"></path>`;
      return hit + visible;
    }
    return visible;
  }).join('');

  const fb = facBorderHtml.join('');

  // ── Сектора: мягкое тёмное «разрежение»-пустота (перо из 3 слоёв) + хит-зона ──
  const secVoid = geo.secEdges.map(e =>
    `<path class="gm-sec-void" d="${dOf(e.pts)}" fill="none"></path>`).join('');
  const secVoidCore = geo.secEdges.map(e =>
    `<path class="gm-sec-void-core" d="${dOf(e.pts)}" fill="none"></path>`).join('');
  const secLine = geo.secEdges.map(e =>
    `<path class="gm-sec-line" d="${dOf(e.pts)}" fill="none"></path>`).join('');
  const secHit = geo.secEdges.map(e =>
    `<path class="gm-sec-hit" d="${dOf(e.pts)}" fill="none" onclick="gmSectorBorderClick('${e.secId}')"></path>`).join('');
  const secLabelHtml = geo.secLabels.map(l =>
    `<text class="gm-sec-label" x="${l.x.toFixed(0)}" y="${l.y.toFixed(0)}" fill="${l.color}" onclick="gmSectorBorderClick('${l.id}')">${esc((l.name || '').toUpperCase())}</text>`).join('');

  // Свечение — широкий полупрозрачный контур БЕЗ SVG-фильтра (feGaussianBlur тормозил
  // при пане/зуме). Дёшево композитится.
  svg.innerHTML =
    `<g class="vor-layer">${fillHtml}</g>`
    + `<g class="sec-fill-layer">${secFillHtml}</g>`
    + `<g class="vor-border-layer gm-glow-layer">${fb}</g>`
    + `<g class="vor-border-layer">${neutralBorderHtml.join('')}${fb}</g>`
    + `<g class="lane-layer">${laneHtml}</g>`
    + `<g class="sec-layer">${secVoid}${secVoidCore}${secLine}${secLabelHtml}${secHit}</g>`;
  svg.classList.toggle('gm-noborders', !GM.showBorders);
  gmUpdateStrokes();
}

// толщина обводок постоянна на экране: ширина_в_юнитах = px / scale
function gmUpdateStrokes() {
  const svg = document.getElementById('gm-svg');
  if (!svg) return;
  const s = GM.scale || 1;
  svg.style.setProperty('--lane-w', (3 / s).toFixed(2));
  svg.style.setProperty('--cell-w', (1.4 / s).toFixed(2));
  // Сектора: ширины/пунктир/хит-зона постоянны на экране (в юнитах = px/scale)
  svg.style.setProperty('--sec-w', (5 / s).toFixed(2));
  svg.style.setProperty('--sec-void-w', (20 / s).toFixed(2));
  svg.style.setProperty('--sec-void-core', (11 / s).toFixed(2));
  svg.style.setProperty('--sec-hit-w', (16 / s).toFixed(2));
  svg.style.setProperty('--sec-font', (24 / s).toFixed(1) + 'px');
  // LOD подписей: вдали (мелкий зум) прячем имена рядовых систем — остаются
  // только гиганты, столицы и разломы. Вблизи показываем все.
  const wrap = document.getElementById('gm-wrap');
  wrap?.classList.toggle('gm-lod-far', s < 0.55);
  // Сектора: название + клик по границе показываем ТОЛЬКО на сильном отдалении
  // (≈ максимально/почти максимально отдалённая карта). Вблизи — только линия границы.
  // В режиме редактора секторов всегда показываем (иначе не поправить).
  const far = s <= gmMinScale() * 1.7;
  const secFar = far || (GM.edit && GM.mode === 'sector');
  wrap?.classList.toggle('gm-sec-far', secFar);
  // Обзор секторов: на сильном отдалении (вне редактора) гасим системы и их имена,
  // чтобы сектора читались выразительнее. В редакторе секторов — НЕ гасим (надо кликать).
  wrap?.classList.toggle('gm-sec-overview', far && !GM.edit);
}

// превращает rgba(r,g,b,a) в более плотный контур
function gmSolidColor(rgba) {
  const m = /rgba?\(([^)]+)\)/.exec(rgba || '');
  if (!m) return 'rgba(120,140,170,0.5)';
  const p = m[1].split(',').map(s => s.trim());
  return `rgba(${p[0]},${p[1]},${p[2]},0.6)`;
}
// парсит цвет в [r,g,b]
function gmRgb(c) {
  if (!c) return [140, 160, 190];
  if (c[0] === '#') { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) { const p = m[1].split(',').map(s => parseFloat(s)); return [p[0] | 0, p[1] | 0, p[2] | 0]; }
  return [140, 160, 190];
}
// возвращает цвет, гарантированно читаемый на тёмном фоне (тёмные осветляет, сохраняя оттенок)
function gmReadable(c) {
  let [r, g, b] = gmRgb(c);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum < 0.5) { const f = 0.45 + (0.5 - lum) * 0.8; r = Math.round(r + (255 - r) * f); g = Math.round(g + (255 - g) * f); b = Math.round(b + (255 - b) * f); }
  return `rgb(${r},${g},${b})`;
}

function gmDrawStars() {
  const layer = document.getElementById('gm-stars');
  if (!layer) return;
  const caps = GM.capitals || {};
  const secSelIds = (GM.edit && GM.mode === 'sector' && GM.sectorDraft) ? GM.sectorDraft.system_ids : [];
  layer.innerHTML = GM.systems.map(s => {
    const sel = (GM.linkFrom === s.id) ? ' gm-linksel' : '';
    const secSel = secSelIds.includes(s.id) ? ' gm-sec-selected' : '';
    // Системы разлома — не звёзды, а пульсирующие аномалии (другой стиль)
    if (s.faction === 'rift') {
      const core = s.id === 'rift_core' ? ' gm-rift-core' : '';
      return `<div class="gm-star gm-rift-node${core}${sel}${secSel}" data-id="${esc(s.id)}" style="left:${s.x}px;top:${s.y}px"
          onmousedown="gmStarDown(event,'${esc(s.id)}')" onclick="gmStarClick(event,'${esc(s.id)}')">
          <span class="gm-rift-eye"></span><span class="gm-rift-ring"></span>
          <span class="gm-label gm-rift-label">${esc(s.name)}</span>
        </div>`;
    }
    const giant = s.is_giant ? ' gm-giant' : '';
    const capFid = caps[s.id];
    const capCol = capFid ? gmReadable((gmFaction(capFid) || {}).color || '#ffd24d') : '';
    const capHtml = capFid ? `<span class="gm-cap" title="Столица: ${esc((GM.facMeta[capFid] || {}).name || '')}" style="color:${capCol}">★</span>` : '';
    return `<div class="gm-star${giant}${sel}${secSel}${capFid ? ' gm-capital' : ''}" data-id="${esc(s.id)}" style="left:${s.x}px;top:${s.y}px"
        onmousedown="gmStarDown(event,'${esc(s.id)}')" onclick="gmStarClick(event,'${esc(s.id)}')">
        <img src="${GM_BASE}stars/star_${esc(s.star_type || 'yellow')}.png" draggable="false" alt="">
        ${capHtml}
        ${gmResOverlay(s)}
        ${gmOrbits(s)}
        <span class="gm-label">${esc(s.name)}</span>
      </div>`;
  }).join('');
}

// Орбитальная раскладка системы для глубокого зума: звезда в центре + вращающиеся
// кольца с точками-планетами по составу s.planets. Скрыта по умолчанию (display:none),
// показывается через #gm-wrap.gm-deepzoom — поэтому без зума анимации не тикают.
const GM_ORBIT_MAX = 7;            // не больше колец на систему (защита от каши/лагов)
// Единый список тел системы для отрисовки: планеты генератора + миры без класса
// (заданы админкой вручную) + колонии/столицы из таблицы colonies, которых нет
// среди планет (добавлены через консоль администрации). Матчинг по имени, чтобы
// не задвоить. Раньше орбиты строились только по p.kind — поэтому столицы,
// классless-миры и консольные колонии вообще не показывались. Кэш на объекте
// системы; сбрасывается при перезагрузке данных (GM.systems пересоздаётся) и в
// gmSaveForm (там s.planets меняется на месте → s._bodies=null).
function gmSystemBodies(sys) {
  if (sys._bodies) return sys._bodies;
  const norm = s => (s ? String(s) : '').trim().toLowerCase();
  const sysCols = (GM.colonies || []).filter(c => c.system_id === sys.id);
  const capName = norm((GM.capPlanet && GM.capPlanet[sys.id]) ||
    (sysCols.find(c => c.is_capital || c.planet_type === 'Столичный мир') || {}).planet_name);
  const byName = new Map(); let anon = 0;
  (sys.planets || []).forEach(p => {
    if (!p) return;
    const nm = norm(p.name);
    // пояса/аномалии остаются как есть; всё прочее без класса считаем планетой
    const b = { name: p.name || '', kind: p.kind || 'planet', zone: p.zone, dist: p.dist, type: p.type,
                dead: !!(p.dead || p.doomed),   // ☠ выжжена «Дланью Неотвратимости» — рисуем мёртвым камнем
                pid: Number.isInteger(p.pid) ? p.pid : null };
    if (nm && nm === capName) b.isCapital = true;
    byName.set(nm || ('__p' + anon++), b);
  });
  sysCols.forEach(c => {
    const nm = norm(c.planet_name);
    const isCap = !!(c.is_capital || c.planet_type === 'Столичный мир');
    const hit = nm && byName.get(nm);
    // planet_pid колонии — стабильный идентификатор планеты (для привязки минных полей)
    const cpid = (c.planet_pid != null && c.planet_pid !== '') ? +c.planet_pid : null;
    if (hit) { hit.isColony = true; hit.faction_id = c.faction_id; hit.colId = c.id; if (cpid != null) hit.pid = cpid; if (isCap) hit.isCapital = true; return; }
    byName.set(nm || ('__c' + anon++), { name: c.planet_name || 'Колония', kind: 'planet', isColony: true, isCapital: isCap, faction_id: c.faction_id, colId: c.id, pid: cpid, type: c.planet_type || '' });
  });
  return (sys._bodies = [...byName.values()]);
}
// Тела для орбитальной раскладки: от звезды наружу, обрезаны до GM_ORBIT_MAX, но
// столицы из обрезки не выпадают — им гарантированно оставляем место.
function gmOrbitBodies(sys) {
  const byDist = (p, q) => (+p.dist || 0) - (+q.dist || 0);
  let b = gmSystemBodies(sys).slice().sort(byDist);
  if (b.length > GM_ORBIT_MAX) {
    const cap = b.filter(x => x.isCapital), rest = b.filter(x => !x.isCapital);
    b = [...cap, ...rest].slice(0, GM_ORBIT_MAX).sort(byDist);
  }
  return b;
}
function gmOrbits(sys) {
  const planets = gmOrbitBodies(sys);
  if (!planets.length) return '';
  const rings = planets.map((p, i) => {
    const r = 38 + i * 16;                         // радиус кольца (юниты карты)
    const dur = 16 + i * 5;                        // дальние — медленнее
    const delay = -((i * 137) % 360) / 360 * dur;  // негативная задержка = стартовая фаза
    const belt = p.kind === 'belt', anom = p.kind === 'anomaly';
    const sz = belt ? 5 : anom ? 7 : 9;            // размер точки
    const kc = belt ? ' gm-dot-belt' : anom ? ' gm-dot-anom' : p.dead ? ' gm-dot-dead' : '';
    return `<div class="gm-orbit" style="--r:${r}px;--dur:${dur}s;animation-delay:${delay.toFixed(2)}s">
        <span class="gm-planet${kc}" style="--zc:${p.dead ? '#6b6b72' : gmZoneColor(p.zone)};--sz:${sz}px"></span>
      </div>`;
  }).join('');
  return `<div class="gm-sys" aria-hidden="true">${rings}</div>`;
}

// Сводка ресурсов над звездой (видна только в режиме «ресурсы»). Рисуется всегда,
// показывается через CSS-класс #gm-wrap.gm-show-res — чтобы переключение было мгновенным.
function gmResOverlay(s) {
  // показываем только включённые в фильтре редкости — иначе на карте каша
  const list = gmSysRes(s).filter(r => GM.resRarities.includes(r.r || 'common'));
  if (!list.length) return '';
  const MAX = 6;
  const pins = list.slice(0, MAX).map(r =>
    `<span class="gm-res-pin r-${r.r || 'common'}" data-name="${esc(r.name)}" data-r="${esc(gmRarName(r.r))}">${gmResIc(r)}</span>`).join('');
  const more = list.length > MAX ? `<span class="gm-res-pin gm-res-more">+${list.length - MAX}</span>` : '';
  return `<div class="gm-res-overlay">${pins}${more}</div>`;
}
function gmRarName(r) { return (GM_RARITIES.find(x => x.r === r) || {}).name || 'обычные'; }
// Иконка ресурса: картинка из каталога (resIconHtml), а для нестандартных
// ресурсов (нет в каталоге) — сохранённая в данных эмодзи.
function gmResIc(r) {
  if (typeof resIconHtml === 'function' && typeof resIconSrc === 'function' && resIconSrc(r.name))
    return resIconHtml(r.name);
  return `<span class="res-ic res-ic-emoji">${r.icon || '◆'}</span>`;
}

// Тултип с названием ресурса при наведении на иконку (десктоп). Привязка одна
// на документ — переживает пересборку слоя звёзд; позиция в экранных координатах
// (через getBoundingClientRect), поэтому читается на любом зуме карты.
function gmBindResTip() {
  if (window._gmResTipBound) return;
  window._gmResTipBound = true;
  const tip = document.createElement('div');
  tip.id = 'gm-res-tip';
  document.body.appendChild(tip);
  const hide = () => tip.classList.remove('gm-on');
  document.addEventListener('mouseover', e => {
    const pin = e.target.closest && e.target.closest('.gm-res-pin[data-name]');
    if (!pin) return;
    tip.innerHTML = esc(pin.dataset.name) + (pin.dataset.r ? `<span class="gm-tip-r">${esc(pin.dataset.r)}</span>` : '');
    const b = pin.getBoundingClientRect();
    tip.style.left = (b.left + b.width / 2) + 'px';
    tip.style.top = (b.top - 7) + 'px';
    tip.classList.add('gm-on');
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest && e.target.closest('.gm-res-pin')) hide();
  });
  // при панораме/зуме карты прячем, чтобы не «висел» на старом месте
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('wheel', hide, true);
}

// ── Взаимодействие со звёздами ──────────────────────────────
function gmStarDown(e, id) {
  if (!(GM.edit && GM.mode === 'select')) return;
  e.stopPropagation();
  const sys = GM.systems.find(s => s.id === id);
  if (sys) GM.drag = { sys, moved: false };
}

function gmStarClick(e, id) {
  e.stopPropagation();
  const sys = GM.systems.find(s => s.id === id);
  if (!sys) return;
  if (GM.edit && GM.mode === 'link') { gmLinkClick(sys); return; }
  if (GM.edit && GM.mode === 'sector') { gmSectorToggleSys(sys.id); return; }
  if (GM.edit && GM.mode === 'select') {
    if (GM.drag && GM.drag.moved) return; // это было перетаскивание
    gmOpenForm(sys); return;
  }
  gmOpenPanel(sys);
}

// ── Панель просмотра системы ────────────────────────────────
function gmOpenPanel(sys) {
  const panel = document.getElementById('gm-panel');
  if (!panel) return;
  // ── Разлом: особая «глитч»-панель другой вселенной ──
  if (sys.faction === 'rift') {
    panel.className = 'gm-rift-panel';
    panel.innerHTML = `
      <button class="gm-close" onclick="gmClosePanel()">✕</button>
      <div class="gm-rift-tag">⚠ АНОМАЛИЯ · ВНЕ КАТАЛОГА</div>
      <h2 class="gm-panel-title gm-rift-title" data-txt="${esc(sys.name)}">${esc(sys.name)}</h2>
      <div class="gm-rift-badge">Сигнатура: иная вселенная</div>
      <p class="gm-panel-desc">${esc(sys.description || '')}</p>
      <div class="gm-rift-readout">
        <div class="gm-rift-row"><span>Стабильность</span><b class="gm-rift-bad">критическая</b></div>
        <div class="gm-rift-row"><span>Происхождение</span><b>неизвестно</b></div>
        <div class="gm-rift-row"><span>Активность за барьером</span><b class="gm-rift-bad">обнаружена</b></div>
      </div>
      <div class="gm-rift-foot">// канал перехвата нестабилен — данные частичны //</div>`;
    panel.classList.remove('gm-hidden');
    return;
  }
  const fac = gmFaction(sys.faction);
  const sysCols = (GM.colonies || []).filter(c => c.system_id === sys.id);
  // Убираем из «Состава системы» ТОЛЬКО фантом столицы: легаси-запись (без kind →
  // рисуется как «Контроль: ничейная»), дублирующую столичную планету. Сама столица
  // корректно показана в блоке «Колонии». Реальные планеты (с kind/зоной/ресурсами),
  // в т.ч. те, на которых стоят обычные колонии, — НЕ трогаем.
  const capCol = sysCols.find(c => c.is_capital || c.planet_type === 'Столичный мир');
  const capName = ((capCol && capCol.planet_name) || (GM.capPlanet && GM.capPlanet[sys.id]) || '').trim().toLowerCase();
  const planets = (sys.planets || [])
    .filter(p => {
      if (!p) return false;
      const nm = (p.name ? String(p.name) : '').trim().toLowerCase();
      const isGhostCapital = nm && nm === capName && !p.kind;  // легаси-дубль столицы
      return !isGhostCapital;
    })
    .map((p, i) => gmPlanetView(p, i)).join('')
    || `<p class="gm-empty">Система ещё не исследована. Данные о планетах отсутствуют.</p>`;
  const meta = fac && GM.facMeta ? GM.facMeta[fac.id] : null;
  const facBlock = fac ? (() => {
    const col = gmReadable(fac.color);
    const flag = meta && meta.herald_url
      ? `<div class="gm-fac-flag" style="border-color:${col}"><img src="${esc(meta.herald_url)}" onerror="this.parentElement.style.display='none'"></div>`
      : `<div class="gm-fac-flag" style="border-color:${col};color:${col}">⬡</div>`;
    return `<div class="gm-fac-card" style="--fcol:${col};background:${gmSolidColor(fac.color).replace('0.6', '0.14')}">
      ${flag}
      <div class="gm-fac-info">
        <div class="gm-fac-name" style="color:${col}">${esc(fac.name)}</div>
        ${meta && meta.leader ? `<div class="gm-fac-leader">${esc(meta.leader)}</div>` : ''}
        ${GM.capitals && GM.capitals[sys.id] === fac.id ? `<div class="gm-fac-capital">★ ${esc((GM.capPlanet && GM.capPlanet[sys.id]) || (meta && meta.planet_name) || '')}</div>` : ''}
      </div>
    </div>`;
  })() : `<div class="gm-fac-badge gm-neutral">Нейтральная система</div>`;
  panel.className = '';
  const colsBlock = sysCols.length ? `
    <div class="gm-panel-sub">Колонии · ${sysCols.length}</div>
    <div class="gm-collist">${sysCols.map(c => {
      const f2 = gmFaction(c.faction_id); const fcol = f2 ? gmReadable(f2.color) : 'rgba(255,255,255,.4)';
      const isCap = c.is_capital || c.planet_type === 'Столичный мир';
      return `<div class="gm-col-row"><span class="gm-col-dot" style="background:${fcol}"></span><span class="gm-col-nm">${isCap ? '★ ' : ''}${esc(c.planet_name || 'Колония')}</span>${c.planet_type ? `<span class="gm-col-ty">${esc(c.planet_type)}</span>` : ''}</div>`;
    }).join('')}</div>` : '';
  // ── Оборона: видимые мне минные поля/аванпосты/мои корабли в этой системе ──
  const defRows = [];
  const mByFac = new Map();
  (GM.minefields || []).filter(m => m.system_id === sys.id).forEach(m => {
    const e = mByFac.get(m.faction_id) || { hexes: 0, hexMax: +m.hex_max || 6, mine: false };
    e.hexes += (+m.hexes || 0); e.hexMax = Math.max(e.hexMax, +m.hex_max || 6);
    e.mine = e.mine || !!m.mine; mByFac.set(m.faction_id, e);
  });
  mByFac.forEach((e, fid) => {
    const f = gmFaction(fid); const c = f ? gmReadable(f.color) : 'rgba(255,120,90,.9)';
    const nm = f ? f.name : ((GM.facMeta && GM.facMeta[fid] && GM.facMeta[fid].name) || 'Неизвестно');
    defRows.push(`<div class="gm-col-row"><span class="gm-col-dot" style="background:${c}"></span><span class="gm-col-nm">💣 Минное поле${e.mine ? ' · ваше' : ''}</span><span class="gm-col-ty">${esc(nm)} · ${Math.min(e.hexes, e.hexMax)}/${e.hexMax} гекс.</span></div>`);
  });
  (GM.outposts || []).filter(o => o.system_id === sys.id).forEach(o => {
    const f = gmFaction(o.faction_id); const c = f ? gmReadable(f.color) : 'rgba(150,200,245,.9)';
    const nm = (f && f.name) || o.faction_name || (GM.facMeta && GM.facMeta[o.faction_id] && GM.facMeta[o.faction_id].name) || 'Неизвестно';
    const rm = o.mine ? `<button class="btn btn-gh btn-sm" style="padding:1px 7px;font-size:11px" onclick="gmOutpostDismantleMap('${o.id}','${sys.id}')" title="Разобрать (возврат ~50%)">разобрать</button>` : `<span class="gm-col-ty">${esc(nm)}</span>`;
    const md = o.mode === 'mining' ? ' ⛏' : (o.mode === 'recon' ? ' 🛰' : '');
    defRows.push(`<div class="gm-col-row"><span class="gm-col-dot" style="background:${c}"></span><span class="gm-col-nm">🛰 Аванпост${md}${o.mine ? ' · ваш' : ''}${o.name ? ': ' + esc(o.name) : ''}</span>${rm}</div>`);
  });
  // мои корабли-носители, стоящие (idle) в этой системе
  (GM.opShips || []).filter(sh => sh.status === 'idle' && sh.system_id === sys.id).forEach(sh => {
    const f = GM.myFid ? gmFaction(GM.myFid) : null; const c = f ? gmReadable(f.color) : 'rgba(150,210,255,.9)';
    defRows.push(`<div class="gm-col-row"><span class="gm-col-dot" style="background:${c}"></span><span class="gm-col-nm">🚀 Носитель аванпоста${sh.name ? ': ' + esc(sh.name) : ''}</span><span class="gm-col-ty">${sh.can_deploy ? 'можно развернуть' : 'на стоянке'}</span></div>`);
  });
  // мои Гиперпейсер (мобильные «Длани»), стоящие (idle) в этой системе
  (GM.mzaShips || []).filter(sh => sh.status === 'idle' && sh.system_id === sys.id).forEach(sh => {
    defRows.push(`<div class="gm-col-row"><span class="gm-col-dot" style="background:rgba(225,70,55,.9)"></span><span class="gm-col-nm">☣ Гиперпейсер${sh.name ? ': ' + esc(sh.name) : ''}</span><span class="gm-col-ty">${sh.can_fire ? 'готов к залпу' : (sh.in_flight ? 'снаряд в полёте' : 'корпус ' + Math.round(+sh.integrity || 0) + '%')}</span></div>`);
  });
  const defBlock = defRows.length
    ? `<div class="gm-panel-sub">Оборона · ${defRows.length}</div><div class="gm-collist">${defRows.join('')}</div>` : '';
  // Носитель аванпоста строится на Верфи в кабинете (как весь флот), не с карты —
  // здесь только управление уже построенным носителем (клик по самому носителю).
  panel.innerHTML = `
    <button class="gm-close" onclick="gmClosePanel()">✕</button>
    <h2 class="gm-panel-title">${esc(sys.name)}</h2>
    ${facBlock}
    ${(typeof ecCanAccess === 'function' && ecCanAccess() && typeof EC !== 'undefined' && EC.app && EC.app.faction_id === sys.faction)
      ? `<button class="btn btn-gh btn-sm" style="margin:6px 0 2px" onclick="gmClosePanel();go('economy')">🛰 Открыть кабинет</button>` : ''}
    <p class="gm-panel-desc">${esc(sys.description || '')}</p>
    ${colsBlock}
    ${defBlock}
    <div class="gm-panel-sub">Состав системы <span class="gm-sub-hint">★ от звезды наружу →</span></div>
    <div class="gm-orblist">${planets}</div>`;
}
function gmClosePanel() {
  document.getElementById('gm-panel')?.classList.add('gm-hidden');
  if (GMM.active && GMM.selId) { GMM.selId = null; GMM.dirty = true; gmmKick(); }
}

// ════════════════════════════════════════════════════════════
//  ОБОРОНА — управление прямо на карте (мины-гексы + носители аванпостов)
// ════════════════════════════════════════════════════════════
// RPC-мутация: POST в /rest/v1/rpc/<fn>. apiFetch берёт свежий токен для POST.
function gmDefRpc(fn, body) {
  return apiFetch('rpc/' + fn, { method: 'POST', body: JSON.stringify(body || {}) });
}
// Перезагрузить оборонные данные (после действия) и перерисовать карту.
async function gmReloadDefense(reopenSysId) {
  if (!user) return;
  try {
    const [mines, outposts, ships, mzas, salvos] = await Promise.all([
      gmDefRpc('minefields_visible').catch(() => GM.minefields || []),
      gmDefRpc('outposts_visible').catch(() => GM.outposts || []),
      gmDefRpc('outpost_ships_mine').catch(() => GM.opShips || []),
      gmDefRpc('mza_ships_mine').catch(() => GM.mzaShips || []),
      // залпы в полёте (doomgun + Гиперпейсер — общая таблица) для анимации снаряда на карте
      dbGet('doom_salvos', 'status=eq.in_flight&select=origin_system_id,target_system_id,target_pid,target_planet,launched_at,ready_at,faction_id').catch(() => GM.salvos || []),
    ]);
    GM.minefields = Array.isArray(mines) ? mines : [];
    GM.outposts = Array.isArray(outposts) ? outposts : [];
    GM.opShips = Array.isArray(ships) ? ships : [];
    GM.mzaShips = Array.isArray(mzas) ? mzas : [];
    GM.salvos = Array.isArray(salvos) ? salvos : (GM.salvos || []);
    if (GMM.active) { gmmBuildDefense(); gmmBuildSalvos(); GMM.dirty = true; gmmKick(); }
    // если открыта панель этой системы — обновим её (число гексов/аванпостов/носителей)
    const p = document.getElementById('gm-panel');
    if (reopenSysId && p && !p.classList.contains('gm-hidden')) {
      const sys = GM.systems.find(s => s.id === reopenSysId); if (sys) gmOpenPanel(sys);
    }
  } catch (e) { /* тихо: оборона необязательна */ }
}

// Клик по минному гексу вокруг планеты: пустой → заложить (+гекс), занятый → снять.
async function gmMineHexClick(h) {
  if (GM._defBusy) return; GM._defBusy = true;
  try {
    const fn = h.filled ? 'minefield_unlay' : 'minefield_lay';
    await gmDefRpc(fn, { p_system_id: h.sysId, p_pid: h.pid });
    toast(h.filled ? 'Гекс разминирован' : 'Гекс заминирован', 'ok');
    await gmReloadDefense(h.sysId);
  } catch (e) { toast('Ошибка: ' + (e.message || e), 'err'); }
  finally { GM._defBusy = false; }
}

// Носитель аванпоста строится на Верфи в кабинете (ecOutpostBuildShip), не с карты.
async function gmOutpostDismantleMap(id, sysId) {
  if (!confirm('Разобрать аванпост? Вернётся около половины стоимости.')) return;
  if (GM._defBusy) return; GM._defBusy = true;
  try {
    const r = await gmDefRpc('outpost_dismantle', { p_id: id });
    toast('Аванпост разобран · +' + ((r && r.refund) || 0) + ' ГС', 'ok');
    await gmReloadDefense(sysId);
  } catch (e) { toast('Ошибка: ' + (e.message || e), 'err'); }
  finally { GM._defBusy = false; }
}

// ── Командная плашка носителя (клик по нему на карте) ──
function gmOpenOutpostCmd(id) {
  const sh = (GM.opShips || []).find(x => x.id === id && x.status === 'idle');
  if (!sh) return;
  GMM.opCmd = { id, mode: 'menu' };
  GMM.dirty = true; gmmKick();
  const el = document.getElementById('gm-opcmd'); if (!el) return;
  const sysName = (GM.systems.find(s => s.id === sh.system_id) || {}).name || sh.system_id;
  el.innerHTML = `<div class="gm-opcmd-card">
      <button class="gm-close" onclick="gmCloseOutpostCmd()">✕</button>
      <div class="gm-opcmd-title">🚀 Носитель аванпоста${sh.name ? ' «' + esc(sh.name) + '»' : ''}</div>
      <div class="gm-opcmd-sub">в системе ${esc(sysName)}</div>
      <button class="gm-opcmd-btn" onclick="gmOutpostCmdSend()">➤ Отправить — выберите систему</button>
      ${sh.can_deploy
        ? `<button class="gm-opcmd-btn" onclick="gmOutpostCmdDeploy('recon')">🛰 Развернуть: разведка</button>
           <button class="gm-opcmd-btn" onclick="gmOutpostCmdDeploy('mining')">⛏ Развернуть: добыча</button>
           <div class="gm-opcmd-hint">Разведка — срез по соседним державам. Добыча — ресурсы вне границ + стоянка флота.</div>`
        : `<button class="gm-opcmd-btn gm-dis" disabled>⚑ Развернуть в аванпост</button>
           <div class="gm-opcmd-hint">Развернуть нельзя: нужна нейтральная система, не впритык к чужой границе</div>`}
      <button class="gm-opcmd-btn gm-opcmd-danger" onclick="gmOutpostCmdScrap()">✕ Списать носитель</button>
    </div>`;
  el.classList.remove('gm-hidden');
}
function gmCloseOutpostCmd() {
  GMM.opCmd = null; GMM.dirty = true; gmmKick();
  document.getElementById('gm-opcmd')?.classList.add('gm-hidden');
}
function gmOutpostCmdSend() {
  if (!GMM.opCmd) return;
  GMM.opCmd.mode = 'target';
  const el = document.getElementById('gm-opcmd');
  if (el) el.innerHTML = `<div class="gm-opcmd-card">
      <div class="gm-opcmd-title">➤ Выберите систему-цель</div>
      <div class="gm-opcmd-hint">Кликните систему на карте. В чужие границы входить нельзя.</div>
      <button class="gm-opcmd-btn" onclick="gmCloseOutpostCmd()">Отмена</button>
    </div>`;
}
async function gmOutpostSendTo(id, destSys) {
  const dst = GM.systems.find(s => s.id === destSys);
  if (dst && dst.faction && dst.faction !== GM.myFid && dst.faction !== 'rift') {
    toast('Нельзя входить в чужие границы', 'err'); return;
  }
  if (GM._defBusy) return; GM._defBusy = true;
  try {
    const r = await gmDefRpc('outpost_ship_send', { p_id: id, p_dest_sys: destSys });
    toast('Носитель в пути · долёт ~' + ((r && r.fly_h) || '?') + ' ч', 'ok');
    gmCloseOutpostCmd();
    await gmReloadDefense();
  } catch (e) { toast('Ошибка: ' + (e.message || e), 'err'); gmCloseOutpostCmd(); }
  finally { GM._defBusy = false; }
}
async function gmOutpostCmdDeploy(mode) {
  if (!GMM.opCmd) return; const id = GMM.opCmd.id;
  const md = mode === 'mining' ? 'mining' : 'recon';
  if (GM._defBusy) return; GM._defBusy = true;
  try {
    await gmDefRpc('outpost_ship_deploy', { p_id: id, p_mode: md });
    toast(md === 'mining' ? '⛏ Добывающий аванпост развёрнут' : '🛰 Разведаванпост развёрнут', 'ok');
    gmCloseOutpostCmd();
    await gmReloadDefense();
  } catch (e) { toast('Ошибка: ' + (e.message || e), 'err'); }
  finally { GM._defBusy = false; }
}
async function gmOutpostCmdScrap() {
  if (!GMM.opCmd) return; const id = GMM.opCmd.id;
  if (!confirm('Списать носитель? Вернётся ~50% стоимости.')) return;
  if (GM._defBusy) return; GM._defBusy = true;
  try {
    const r = await gmDefRpc('outpost_ship_scrap', { p_id: id });
    toast('Носитель списан · +' + ((r && r.refund) || 0) + ' ГС', 'ok');
    gmCloseOutpostCmd();
    await gmReloadDefense();
  } catch (e) { toast('Ошибка: ' + (e.message || e), 'err'); }
  finally { GM._defBusy = false; }
}

// ── Командная плашка Гиперпейсер (мобильной «Длани») — клик по ней на карте ──
// Та же плашка #gm-opcmd, но действия: отправить (вся карта) / залп / списать.
function gmOpenMzaCmd(id) {
  const sh = (GM.mzaShips || []).find(x => x.id === id && x.status === 'idle');
  if (!sh) return;
  GMM.mzaCmd = { id, mode: 'menu' };
  gmCloseOutpostCmd();   // на всякий случай гасим плашку носителя
  GMM.dirty = true; gmmKick();
  const el = document.getElementById('gm-opcmd'); if (!el) return;
  const sysName = (GM.systems.find(s => s.id === sh.system_id) || {}).name || sh.system_id;
  el.innerHTML = `<div class="gm-opcmd-card">
      <button class="gm-close" onclick="gmCloseMzaCmd()">✕</button>
      <div class="gm-opcmd-title">☣ Гиперпейсер${sh.name ? ' «' + esc(sh.name) + '»' : ''}</div>
      <div class="gm-opcmd-sub">в системе ${esc(sysName)} · корпус ${Math.round(+sh.integrity || 0)}%</div>
      <button class="gm-opcmd-btn" onclick="gmMzaCmdSend()">➤ Перебросить — выберите систему</button>
      ${sh.can_fire
        ? `<button class="gm-opcmd-btn gm-opcmd-danger" onclick="gmMzaCmdFire()">🜨 Залп — выберите систему-цель</button>`
        : `<button class="gm-opcmd-btn gm-dis" disabled>🜨 Залп недоступен</button>
           <div class="gm-opcmd-hint">${sh.in_flight ? 'Снаряд уже в полёте' : (+sh.integrity <= 0 ? 'Корпус изношен — спишите носитель' : 'Нет данных')}</div>`}
      <button class="gm-opcmd-btn gm-opcmd-danger" onclick="gmMzaCmdScrap()">✕ Списать Гиперпейсер</button>
    </div>`;
  el.classList.remove('gm-hidden');
}
function gmCloseMzaCmd() {
  GMM.mzaCmd = null; GMM.dirty = true; gmmKick();
  document.getElementById('gm-opcmd')?.classList.add('gm-hidden');
}
function gmMzaCmdSend() {
  if (!GMM.mzaCmd) return;
  GMM.mzaCmd.mode = 'sendTarget';
  const el = document.getElementById('gm-opcmd');
  if (el) el.innerHTML = `<div class="gm-opcmd-card">
      <div class="gm-opcmd-title">➤ Куда перебросить Гиперпейсер?</div>
      <div class="gm-opcmd-hint">Кликните любую систему карты. Долёт зависит от дистанции.</div>
      <button class="gm-opcmd-btn" onclick="gmCloseMzaCmd()">Отмена</button>
    </div>`;
}
async function gmMzaSendTo(id, destSys) {
  if (GM._defBusy) return; GM._defBusy = true;
  try {
    const r = await gmDefRpc('mza_send', { p_id: id, p_dest_sys: destSys });
    toast('☣ Гиперпейсер в пути · долёт ~' + ((r && r.fly_h) || '?') + ' ч', 'ok');
    gmCloseMzaCmd();
    await gmReloadDefense();
  } catch (e) { toast('Ошибка: ' + (e.message || e), 'err'); gmCloseMzaCmd(); }
  finally { GM._defBusy = false; }
}
function gmMzaCmdFire() {
  if (!GMM.mzaCmd) return;
  GMM.mzaCmd.mode = 'fireTarget';
  const el = document.getElementById('gm-opcmd');
  if (el) el.innerHTML = `<div class="gm-opcmd-card">
      <div class="gm-opcmd-title">🜨 Система-цель залпа</div>
      <div class="gm-opcmd-hint">Кликните систему карты, затем выберите планету. Залп превратит её в мёртвый мир.</div>
      <button class="gm-opcmd-btn" onclick="gmCloseMzaCmd()">Отмена</button>
    </div>`;
}
// После выбора системы-цели — список её планет (целятся по pid).
function gmMzaPickPlanet(id, sys) {
  if (!GMM.mzaCmd) return;
  GMM.mzaCmd.mode = 'menu';   // прекращаем перехват кликов по карте
  // Источник целей — те же тела, что рисует карта: gmSystemBodies сливает
  // natural-планеты map_systems.planets С КОЛОНИЯМИ (в т.ч. столицей-домиком,
  // которой нет в map_systems.planets). Иначе по столице нельзя было дать залп.
  const planets = (gmSystemBodies(sys) || []).filter(p => p && p.pid != null && p.kind === 'planet');
  const el = document.getElementById('gm-opcmd'); if (!el) return;
  if (!planets.length) {
    el.innerHTML = `<div class="gm-opcmd-card">
      <button class="gm-close" onclick="gmCloseMzaCmd()">✕</button>
      <div class="gm-opcmd-title">🜨 ${esc(sys.name || '')}</div>
      <div class="gm-opcmd-hint">В системе нет планет-целей.</div>
      <button class="gm-opcmd-btn" onclick="gmMzaCmdFire()">← Другая система</button>
    </div>`;
    return;
  }
  const rows = planets.map(p => {
    const dead = p.dead || p.doomed;
    return `<button class="gm-opcmd-btn${dead ? ' gm-dis' : ' gm-opcmd-danger'}" ${dead ? 'disabled' : ''}
        onclick="gmMzaFireAt('${id}','${esc(sys.id)}',${p.pid})">${dead ? '☠ ' : '🜨 '}${esc(p.name || ('планета ' + p.pid))}${dead ? ' (мертва)' : ''}</button>`;
  }).join('');
  el.innerHTML = `<div class="gm-opcmd-card">
      <button class="gm-close" onclick="gmCloseMzaCmd()">✕</button>
      <div class="gm-opcmd-title">🜨 Залп по ${esc(sys.name || '')}</div>
      <div class="gm-opcmd-sub">Выберите планету-цель</div>
      ${rows}
      <button class="gm-opcmd-btn" onclick="gmMzaCmdFire()">← Другая система</button>
    </div>`;
  el.classList.remove('gm-hidden');
}
async function gmMzaFireAt(id, sysId, pid) {
  if (!confirm('Дать залп по планете? Она станет мёртвым миром, колония на ней будет стёрта.')) return;
  if (GM._defBusy) return; GM._defBusy = true;
  try {
    const r = await gmDefRpc('mza_fire', { p_id: id, p_target_system_id: sysId, p_target_pid: pid });
    toast('🜨 Залп выпущен · долёт ~' + ((r && r.flight_h) || '?') + ' ч', 'ok');
    gmCloseMzaCmd();
    await gmReloadDefense();
  } catch (e) { toast('Ошибка: ' + (e.message || e), 'err'); }
  finally { GM._defBusy = false; }
}
async function gmMzaCmdScrap() {
  if (!GMM.mzaCmd) return; const id = GMM.mzaCmd.id;
  if (!confirm('Списать Гиперпейсер? Вернётся ~50% стоимости ГС.')) return;
  if (GM._defBusy) return; GM._defBusy = true;
  try {
    const r = await gmDefRpc('mza_scrap', { p_id: id });
    toast('Гиперпейсер списан · +' + ((r && r.refund) || 0) + ' ГС', 'ok');
    gmCloseMzaCmd();
    await gmReloadDefense();
  } catch (e) { toast('Ошибка: ' + (e.message || e), 'err'); }
  finally { GM._defBusy = false; }
}

// ── Режим редактирования ────────────────────────────────────
function gmToggleEdit() {
  GM.edit = !GM.edit;
  GM.mode = 'select'; GM.linkFrom = null;
  document.getElementById('gm-edit-tools')?.classList.toggle('gm-hidden', !GM.edit);
  const btn = document.getElementById('gm-edit-toggle');
  if (btn) { btn.textContent = GM.edit ? '✓ Готово' : '✎ Редактировать карту'; btn.classList.toggle('gm-active', GM.edit); }
  document.getElementById('gm-wrap')?.classList.toggle('gm-editing', GM.edit);
  gmSetMode('select');
  gmDraw();
}
function gmSetMode(m) {
  GM.mode = m; GM.linkFrom = null;
  document.querySelectorAll('#gm-edit-tools .gm-tb-btn').forEach(b =>
    b.classList.toggle('gm-active', b.dataset.mode === m));
  const hint = document.getElementById('gm-tb-hint');
  if (hint) hint.textContent = m === 'add' ? 'Клик по пустому месту — новая звезда'
    : m === 'link' ? 'Клик на первую звезду, затем на вторую — проложить путь'
    : m === 'unlink' ? 'Клик по линии гиперпути — удалить'
    : m === 'sector' ? 'Клик по звёздам — собрать сектор; клик по границе — править существующий'
    : 'Тащи звезду мышью; клик — редактировать';
  // Форма сектора видна только в режиме «Сектора»
  if (m === 'sector') { if (!GM.sectorDraft) gmSectorNew(false); gmRenderSectorForm(); }
  else { GM.sectorDraft = null; document.getElementById('gm-sector')?.remove(); }
  gmDraw();
}

function gmLinkClick(sys) {
  if (!GM.linkFrom) { GM.linkFrom = sys.id; gmDrawStars(); return; }
  if (GM.linkFrom === sys.id) { GM.linkFrom = null; gmDrawStars(); return; }
  const a = GM.linkFrom, b = sys.id;
  if (GM.lanes.some(l => (l.a_id === a && l.b_id === b) || (l.a_id === b && l.b_id === a))) {
    toast('Такой путь уже есть', 'inf'); GM.linkFrom = null; gmDrawStars(); return;
  }
  gmCreateLane(a, b);
}
async function gmCreateLane(a, b) {
  try {
    const rows = await dbPost('map_hyperlanes', { a_id: a, b_id: b });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row && row.id) GM.lanes.push(row); else await loadGalaxyData();
    GM.linkFrom = null; gmDraw();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); GM.linkFrom = null; gmDrawStars(); }
}
async function gmDeleteLane(id) {
  if (!(GM.edit && GM.mode === 'unlink')) return;
  try { await dbDel('map_hyperlanes', 'id=eq.' + encodeURIComponent(id)); GM.lanes = GM.lanes.filter(l => l.id !== id); gmDrawSvg(); }
  catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

// ════════════════════════════════════════════════════════════
// СЕКТОРА — именованные группы систем с лором и особой границей
// ════════════════════════════════════════════════════════════
// Список секторов для рендера: сохранённые + текущий черновик (живой предпросмотр).
function gmSectorsForRender() {
  const base = (GM.sectors || []).slice();
  if (GM.edit && GM.mode === 'sector' && GM.sectorDraft) {
    const d = GM.sectorDraft;
    const draft = { id: d.id || '__draft__', name: d.name, color: d.color, lore: d.lore, system_ids: d.system_ids };
    const i = base.findIndex(s => s.id === draft.id);
    if (i >= 0) base[i] = draft; else base.push(draft);
  }
  return base;
}
// rgba/hex → #rrggbb (для <input type=color>) и обратно
function gmToHex(c) { const [r, g, b] = gmRgb(c); return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''); }
function gmHexToRgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; }

function gmSectorNew(redraw = true) {
  GM.sectorDraft = { id: null, name: 'Новый сектор', color: 'rgba(120, 200, 255, 0.5)', lore: '', system_ids: [] };
  if (redraw) { gmRenderSectorForm(); gmDraw(); }
}
function gmSectorEdit(id) {
  if (id === '__draft__') return;
  const s = GM.sectors.find(x => x.id === id);
  if (!s) return;
  GM.sectorDraft = { id: s.id, name: s.name, color: s.color, lore: s.lore || '', system_ids: (s.system_ids || []).slice() };
  gmRenderSectorForm(); gmDraw();
}
function gmSectorToggleSys(id) {
  if (!GM.sectorDraft) gmSectorNew(false);
  const arr = GM.sectorDraft.system_ids;
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1); else arr.push(id);
  gmRenderSectorForm(); gmDraw();
}
async function gmSectorSave() {
  const d = GM.sectorDraft;
  if (!d) return;
  if (!d.system_ids.length) { toast('Добавь хотя бы одну систему', 'inf'); return; }
  const payload = { name: d.name || 'Сектор', color: d.color, lore: d.lore || '', system_ids: d.system_ids };
  try {
    if (d.id) {
      await dbPatch('map_sectors', 'id=eq.' + encodeURIComponent(d.id), payload);
      const s = GM.sectors.find(x => x.id === d.id); if (s) Object.assign(s, payload);
    } else {
      const rows = await dbPost('map_sectors', payload);
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row && row.id) { GM.sectors.push({ ...row, system_ids: row.system_ids || [] }); d.id = row.id; }
      else await loadGalaxyData();
    }
    toast('Сектор сохранён', 'ok');
    gmRenderSectorForm(); gmDraw();
  } catch (e) { toast('Ошибка: ' + e.message + ' (создал таблицу _map_sectors.sql?)', 'err'); }
}
async function gmSectorDelete() {
  const d = GM.sectorDraft;
  if (!d || !d.id) { gmSectorNew(); return; }
  if (!confirm('Удалить сектор «' + (d.name || '') + '»?')) return;
  try {
    await dbDel('map_sectors', 'id=eq.' + encodeURIComponent(d.id));
    GM.sectors = GM.sectors.filter(s => s.id !== d.id);
    toast('Сектор удалён', 'ok'); gmSectorNew();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}
// Клик по границе/метке сектора: в режиме редактирования секторов — править, иначе — лор
function gmSectorBorderClick(id) {
  if (GM.edit && GM.mode === 'sector') { gmSectorEdit(id); return; }
  gmOpenSector(id);
}
function gmOpenSector(id) {
  const sec = GM.sectors.find(s => s.id === id);
  if (!sec) return;
  const panel = document.getElementById('gm-panel');
  if (!panel) return;
  const col = gmReadable(sec.color || '#7cc8ff');
  const n = (sec.system_ids || []).length;
  panel.className = 'gm-sector-panel';
  panel.innerHTML = `
    <button class="gm-close" onclick="gmClosePanel()">✕</button>
    <div class="gm-sec-tag" style="color:${col}">◈ СЕКТОР</div>
    <h2 class="gm-panel-title" style="color:${col}">${esc(sec.name)}</h2>
    <div class="gm-sec-pmeta">Систем: ${n}</div>
    <p class="gm-panel-desc">${esc(sec.lore || 'Лор этого сектора пока не записан.')}</p>`;
  panel.classList.remove('gm-hidden');
}

// Панель-редактор сектора (живёт в #gm-wrap, только в режиме «Сектора»)
function gmRenderSectorForm() {
  const wrap = document.getElementById('gm-wrap');
  if (!wrap) return;
  let el = document.getElementById('gm-sector');
  if (!el) { el = document.createElement('div'); el.id = 'gm-sector'; wrap.appendChild(el); }
  const d = GM.sectorDraft || { name: '', color: 'rgba(120,200,255,0.5)', lore: '', system_ids: [] };
  const chips = d.system_ids.length
    ? d.system_ids.map(id => {
        const s = GM.systems.find(x => x.id === id);
        return `<span class="gm-sec-chip" onclick="gmSectorToggleSys('${id}')">${esc(s ? s.name : id)} ✕</span>`;
      }).join('')
    : '<span class="gm-sec-empty">Кликай по звёздам на карте</span>';
  const list = (GM.sectors || []).map(s =>
    `<button class="gm-sec-listbtn${GM.sectorDraft && GM.sectorDraft.id === s.id ? ' gm-active' : ''}" onclick="gmSectorEdit('${s.id}')">
       <span class="gm-sec-dot" style="background:${gmReadable(s.color || '#7cc8ff')}"></span>${esc(s.name)}</button>`).join('');
  el.innerHTML = `
    <div class="gm-sec-fhead">${d.id ? '✎ Сектор' : '＋ Новый сектор'}</div>
    <label class="gm-fl">Название</label>
    <input class="gm-fi" id="gm-sec-name" value="${esc(d.name || '')}" oninput="GM.sectorDraft.name=this.value;gmDrawSvg()">
    <div class="gm-sec-row">
      <div><label class="gm-fl">Цвет</label>
        <input type="color" class="gm-sec-color" value="${gmToHex(d.color)}" oninput="GM.sectorDraft.color=gmHexToRgba(this.value,0.5);gmDrawSvg();gmRenderSectorForm()"></div>
      <div style="flex:1"><label class="gm-fl">Систем</label><div class="gm-sec-count">${d.system_ids.length}</div></div>
    </div>
    <label class="gm-fl">Лор (окно при клике на границу)</label>
    <textarea class="gm-fi gm-sec-lore" rows="4" oninput="GM.sectorDraft.lore=this.value" placeholder="Краткое описание сектора…">${esc(d.lore || '')}</textarea>
    <div class="gm-sec-chips">${chips}</div>
    <div class="gm-sec-actions">
      <button class="gm-tb-btn gm-active" onclick="gmSectorSave()">✓ Сохранить</button>
      <button class="gm-tb-btn" onclick="gmSectorNew()">＋ Новый</button>
      ${d.id ? `<button class="gm-tb-btn gm-danger" onclick="gmSectorDelete()">🗑</button>` : ''}
    </div>
    ${list ? `<div class="gm-sec-lhead">Существующие</div><div class="gm-sec-list">${list}</div>` : ''}`;
}

async function gmAddStar(x, y) {
  const id = 'sys_' + Date.now().toString(36);
  const obj = { id, name: 'Новая система', star_type: 'yellow', x, y, is_giant: false, faction: null, description: '', planets: [] };
  try {
    const rows = await dbPost('map_systems', obj);
    const row = Array.isArray(rows) ? rows[0] : rows;
    GM.systems.push(row ? { ...row, x: +row.x, y: +row.y, planets: row.planets || [] } : obj);
    gmDraw();
    gmOpenForm(GM.systems[GM.systems.length - 1]);
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

// ── Рендер тела состава (просмотр) ──────────────────────────
function gmResChips(res) {
  if (!res || !res.length) return '';
  // Редкость кодируется ОДНИМ способом: цвет текста + тонкая левая полоса того же
  // цвета. Рамка-«коробка» у всех одна нейтральная — без радуги цветных рамок.
  return `<div class="gm-res">` + res.map(r =>
    `<span class="gm-res-tag r-${r.r || 'common'}"><span class="gm-res-ic">${gmResIc(r)}</span><span class="gm-res-nm">${esc(r.name)}</span>${r.amt ? `<i>${esc(r.amt)}</i>` : ''}</span>`).join('') + `</div>`;
}
function gmSlotsBadge(p) {
  if (p.slotsP === undefined && p.slotsK === undefined) return '';
  // Тихий индикатор в правом рейле: показываем только ненулевые слоты (без «0 П»),
  // расшифровка — в подсказке. П — планетные, К — космические слоты застройки.
  const parts = [];
  if (p.slotsP) parts.push(`<b>${p.slotsP}</b> П`);
  if (p.slotsK) parts.push(`<b>${p.slotsK}</b> К`);
  if (!parts.length) return '<span class="gm-slots gm-slots-none" title="Нет слотов застройки">без слотов</span>';
  return `<span class="gm-slots" title="Слоты застройки: П — планетные, К — космические">${parts.join('<i>·</i>')}</span>`;
}
function gmZoneColor(z) {
  return { 'Пекло': '#ff4422', 'Внутр.': '#ff8800', 'Обитаемая': '#7fdd55', 'Холод': '#33bce8', 'Пустота': '#8e8eff' }[z] || '#8aa0bd';
}
function gmPlanetView(p, i) {
  const idx = String((i || 0) + 1).padStart(2, '0');
  if (p && p.kind) { // богатый формат (из генератора)
    const dead = !!(p.dead || p.doomed);
    const zc = dead ? '#6b6b72' : gmZoneColor(p.zone);
    const kindCls = p.kind === 'belt' ? ' gm-dot-belt' : p.kind === 'anomaly' ? ' gm-dot-anom' : dead ? ' gm-dot-dead' : '';
    const sat = [];
    if (p.rings) sat.push(`кольца ×${p.rings}`);
    if (p.moons) sat.push(`спутники ×${p.moons}`);
    const satStr = sat.length ? ` · ${sat.join(' · ')}` : '';
    const dist = (p.dist != null) ? `<span class="gm-orb-dist">${p.dist} а.е.</span>` : '';
    // мёртвый мир: ресурсов/слотов нет, тип — «Мёртвая планета», помечаем ☠
    if (dead) return `<div class="gm-orb gm-orb-dead">
      <div class="gm-orb-idx">${idx}</div>
      <div class="gm-orb-dot gm-dot-dead" style="--zc:${zc}"></div>
      <div class="gm-orb-main">
        <div class="gm-orb-top"><span class="gm-orb-name">☠ ${esc(p.name)}</span>${dist}</div>
        <div class="gm-orb-meta"><span class="gm-orb-sub" style="color:#9aa0aa">Мёртвая планета · выжжена дотла</span></div>
      </div>
    </div>`;
    return `<div class="gm-orb">
      <div class="gm-orb-idx">${idx}</div>
      <div class="gm-orb-dot${kindCls}" style="--zc:${zc}"></div>
      <div class="gm-orb-main">
        <div class="gm-orb-top"><span class="gm-orb-name">${esc(p.name)}</span>${dist}</div>
        <div class="gm-orb-meta"><span class="gm-orb-sub">${esc(p.type || '')}${p.zone ? ` · <span class="gm-orb-zone" style="color:${zc}">${esc(p.zone)}</span>` : ''}${satStr}</span>${gmSlotsBadge(p)}</div>
        ${gmResChips(p.resources)}
      </div>
    </div>`;
  }
  // старый формат {name,type,owner,img}
  return `<div class="gm-orb gm-orb-legacy">
    <div class="gm-orb-idx">${idx}</div>
    <div class="gm-planet-img"><img src="${GM_BASE}${esc(p.img || '')}" onerror="this.style.visibility='hidden'"></div>
    <div class="gm-orb-main">
      <div class="gm-orb-top"><span class="gm-orb-name">${esc(p.name || '—')}</span></div>
      <div class="gm-orb-sub">${esc(p.type || 'Неизвестно')} · Контроль: ${esc(p.owner || 'ничейная')}</div>
      ${gmResChips(p.resources)}
    </div>
  </div>`;
}

// ── Форма редактирования системы ────────────────────────────
function gmOpenForm(sys) {
  const form = document.getElementById('gm-form');
  if (!form) return;
  GM.editId = sys.id;
  GM.formPlanets = JSON.parse(JSON.stringify(sys.planets || []));
  const facOpts = `<option value="">— Нейтральная —</option>` +
    GM.factions.map(f => `<option value="${esc(f.id)}"${sys.faction === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
  const typeOpts = GM_STAR_TYPES.map(t => `<option value="${t}"${(sys.star_type || 'yellow') === t ? ' selected' : ''}>${t}</option>`).join('');
  form.className = '';
  form.innerHTML = `
    <button class="gm-close" onclick="gmCloseForm()">✕</button>
    <h3 class="gm-form-title">Система: ${esc(sys.name)}</h3>
    <input type="hidden" id="gmf-id" value="${esc(sys.id)}">
    <label class="gm-fl">Название</label>
    <input class="gm-fi" id="gmf-name" value="${esc(sys.name || '')}">
    <div class="gm-frow">
      <div><label class="gm-fl">Тип звезды</label><select class="gm-fi" id="gmf-type">${typeOpts}</select></div>
      <div><label class="gm-fl">Фракция</label><select class="gm-fi" id="gmf-faction">${facOpts}</select></div>
    </div>
    <label class="gm-fl"><input type="checkbox" id="gmf-giant" ${sys.is_giant ? 'checked' : ''}> Гигант</label>
    <label class="gm-fl">Описание</label>
    <textarea class="gm-fi" id="gmf-desc" rows="3">${esc(sys.description || '')}</textarea>
    <div class="gm-fl gm-planets-hdr">Состав системы
      <span>
        <button class="gm-mini-btn gm-gen-btn" onclick="gmOpenGen()">🎲 Генератор</button>
        <button class="gm-mini-btn" onclick="gmAddPlanetManual()">＋ вручную</button>
      </span>
    </div>
    <div class="gm-fp-note">ℹ Ресурсы влияют на отображение и на <b>будущие</b> колонизации (снимок берётся по pid при заселении). Уже колонизированные планеты сохраняют свой набор — задним числом он не меняется.</div>
    <div id="gmf-planets"></div>
    <div class="gm-form-actions">
      <button class="gm-tb-btn gm-danger" onclick="gmDeleteStar('${esc(sys.id)}')">Удалить систему</button>
      <button class="gm-tb-btn gm-active" onclick="gmSaveForm()">Сохранить</button>
    </div>`;
  gmRenderFormPlanets();
}

function gmRenderFormPlanets() {
  const box = document.getElementById('gmf-planets');
  if (!box) return;
  if (!GM.formPlanets.length) { box.innerHTML = `<div class="gm-empty" style="padding:6px 0">Состав пуст. Сгенерируй 🎲 или добавь вручную.</div>`; return; }
  box.innerHTML = GM.formPlanets.map((p, i) => {
    let head;
    if (p && p.kind) {
      const kc = p.kind === 'belt' ? ' gm-dot-belt' : p.kind === 'anomaly' ? ' gm-dot-anom' : '';
      head = `<div class="gm-fp-head">
        <span class="gm-orb-dot${kc}" style="--zc:${gmZoneColor(p.zone)}"></span>
        <span class="gm-fp-name">${esc(p.name)}</span>
        <span class="gm-fp-meta">${p.dist != null ? p.dist + ' а.е. · ' : ''}${esc(p.type || '')} · ${p.slotsP || 0}П+${p.slotsK || 0}К</span>
        <button class="gm-mini-btn gm-danger" onclick="gmRemovePlanet(${i})">✕</button>
      </div>`;
    } else {
      head = `<div class="gm-planet-row">
        <input class="gm-fi gm-fi-sm" placeholder="Имя" value="${esc(p.name || '')}" oninput="GM.formPlanets[${i}].name=this.value">
        <input class="gm-fi gm-fi-sm" placeholder="Тип" value="${esc(p.type || '')}" oninput="GM.formPlanets[${i}].type=this.value">
        <input class="gm-fi gm-fi-sm" placeholder="Контроль" value="${esc(p.owner || '')}" oninput="GM.formPlanets[${i}].owner=this.value">
        <input class="gm-fi gm-fi-sm" placeholder="img" value="${esc(p.img || '')}" oninput="GM.formPlanets[${i}].img=this.value">
        <button class="gm-mini-btn gm-danger" onclick="gmRemovePlanet(${i})">✕</button>
      </div>`;
    }
    return `<div class="gm-fp-card">${head}${gmResEditSection(p, i)}</div>`;
  }).join('');
}
// Секция правки ресурсов одной планеты: чипы (с удалением) + ролл + ручное добавление.
// Формат записи — как у генератора: {name, icon, r, rname, amt}. Для экономики
// обязательны name+r (по r считается добыча); icon/amt — только отображение.
function gmResEditSection(p, i) {
  const res = Array.isArray(p.resources) ? p.resources : [];
  const chips = res.length
    ? res.map((r, j) => `<span class="gm-fp-res-chip r-${r.r || 'common'}">${gmResIc(r)} ${esc(r.name)}${r.amt ? ` <i>${esc(r.amt)}</i>` : ''}<button title="Убрать" onclick="gmPlanetRemoveRes(${i},${j})">✕</button></span>`).join('')
    : `<span class="gm-fp-res-empty">ресурсов нет</span>`;
  return `<div class="gm-fp-res">
      <div class="gm-fp-res-chips">${chips}</div>
      <div class="gm-fp-res-tools">
        <button class="gm-mini-btn" onclick="gmPlanetRollRes(${i})" title="Случайный набор по типу планеты">🎲 ресурсы</button>
        <button class="gm-mini-btn" onclick="gmPlanetAddResToggle(${i})">＋ ресурс</button>
      </div>
      <div class="gm-fp-res-picker gm-hidden" id="gm-respick-${i}">${gmResPickerHtml(i)}</div>
    </div>`;
}
function gmResPickerHtml(i) {
  const cat = (window.GalaxyGen && GalaxyGen.RESOURCES) || [];
  if (!cat.length) return '<span class="gm-fp-res-empty">каталог не загружен</span>';
  const opts = cat.map((R, ci) => `<option value="${ci}">${R.icon ? R.icon + ' ' : ''}${esc(R.name)} · ${esc(R.rname || R.r)}</option>`).join('');
  const amts = ((window.GalaxyGen && GalaxyGen.AMT_LEVELS) || ['умеренно']).map(a => `<option value="${esc(a)}"${a === 'умеренно' ? ' selected' : ''}>${esc(a)}</option>`).join('');
  return `<select class="gm-fi gm-fi-sm" id="gm-respick-res-${i}">${opts}</select>
    <select class="gm-fi gm-fi-sm" id="gm-respick-amt-${i}">${amts}</select>
    <button class="gm-mini-btn gm-active" onclick="gmPlanetAddRes(${i})">Добавить</button>`;
}
function gmPlanetRollRes(i) {
  if (!window.GalaxyGen || !GalaxyGen.rollResources) { toast('Генератор не загружен', 'err'); return; }
  const p = GM.formPlanets[i]; if (!p) return;
  const starCls = document.getElementById('gmg-cls')?.value || null;  // если открыт генератор — учтём класс
  p.resources = GalaxyGen.rollResources(p.g, starCls, 5);
  gmRenderFormPlanets();
  toast(p.resources.length ? `Выпало ресурсов: ${p.resources.length}` : 'Пусто — крути ещё или добавь вручную', 'ok');
}
function gmPlanetAddResToggle(i) { document.getElementById('gm-respick-' + i)?.classList.toggle('gm-hidden'); }
function gmPlanetAddRes(i) {
  const cat = (window.GalaxyGen && GalaxyGen.RESOURCES) || [];
  const ci = +document.getElementById('gm-respick-res-' + i)?.value;
  const amt = document.getElementById('gm-respick-amt-' + i)?.value || 'умеренно';
  const R = cat[ci]; if (!R) return;
  const p = GM.formPlanets[i]; if (!p) return;
  if (!Array.isArray(p.resources)) p.resources = [];
  // один и тот же ресурс на планете не дублируем — обновляем количество
  const ex = p.resources.find(x => x.name === R.name);
  if (ex) ex.amt = amt;
  else p.resources.push({ name: R.name, icon: R.icon, r: R.r, rname: R.rname || R.r, amt });
  gmRenderFormPlanets();
}
function gmPlanetRemoveRes(i, j) {
  const p = GM.formPlanets[i];
  if (p && Array.isArray(p.resources)) { p.resources.splice(j, 1); gmRenderFormPlanets(); }
}
function gmAddPlanetManual() { GM.formPlanets.push({ name: '', type: '', owner: '', img: '', resources: [] }); gmRenderFormPlanets(); }
function gmRemovePlanet(i) { GM.formPlanets.splice(i, 1); gmRenderFormPlanets(); }
function gmCloseForm() { document.getElementById('gm-form')?.classList.add('gm-hidden'); gmCloseGen(); }

// Стабильный идентификатор планеты внутри системы. НЕ индекс массива:
// планеты в редакторе можно переставлять/удалять/вставлять, а колонии
// (colonies.planet_pid) ссылаются именно на pid — он должен пережить правки.
// Сохраняем существующие pid, новым выдаём max+1 (без переиспользования).
function gmAssignPids(planets) {
  let max = 0;
  planets.forEach(p => { if (Number.isInteger(p.pid) && p.pid > max) max = p.pid; });
  planets.forEach(p => { if (!Number.isInteger(p.pid)) p.pid = ++max; });
  return planets;
}

async function gmSaveForm() {
  const id = document.getElementById('gmf-id').value;
  const planets = gmAssignPids(GM.formPlanets.filter(p => (p.name || '').trim()));
  const body = {
    name: document.getElementById('gmf-name').value.trim() || 'Без имени',
    star_type: document.getElementById('gmf-type').value,
    faction: document.getElementById('gmf-faction').value || null,
    is_giant: document.getElementById('gmf-giant').checked,
    description: document.getElementById('gmf-desc').value.trim(),
    planets,
  };
  try {
    await dbPatch('map_systems', 'id=eq.' + encodeURIComponent(id), body);
    const s = GM.systems.find(x => x.id === id);
    if (s) Object.assign(s, body);
    gmCloseForm(); gmDraw(); toast('Сохранено', 'ok');
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}
async function gmDeleteStar(id) {
  if (!confirm('Удалить систему и связанные гиперпути?')) return;
  try {
    await dbDel('map_systems', 'id=eq.' + encodeURIComponent(id));
    GM.systems = GM.systems.filter(s => s.id !== id);
    GM.lanes = GM.lanes.filter(l => l.a_id !== id && l.b_id !== id);
    gmCloseForm(); gmDraw(); toast('Удалено', 'ok');
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

// ── Генератор состава ───────────────────────────────────────
function gmOpenGen() {
  let modal = document.getElementById('gm-gen');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'gm-gen';
    document.getElementById('gm-wrap')?.appendChild(modal);
  }
  const clsOpts = (window.GalaxyGen?.STAR_CLASSES || ['random']).map(c =>
    `<option value="${c}">${c === 'random' ? '— Случайный класс —' : c}</option>`).join('');
  modal.className = '';
  modal.innerHTML = `
    <button class="gm-close" onclick="gmCloseGen()">✕</button>
    <h3 class="gm-form-title">🎲 Генератор состава</h3>
    <div class="gm-frow">
      <div><label class="gm-fl">Класс звезды</label><select class="gm-fi" id="gmg-cls">${clsOpts}</select></div>
      <div><label class="gm-fl">Насыщенность <span id="gmg-rval">5</span></label>
        <input type="range" class="gm-range" id="gmg-rich" min="1" max="10" value="5" oninput="document.getElementById('gmg-rval').textContent=this.value">
      </div>
    </div>
    <div class="gm-gen-actions">
      <button class="gm-tb-btn gm-active" onclick="gmRollGen()">🎲 Крутить</button>
      <button class="gm-tb-btn" id="gmg-apply" onclick="gmApplyGen()" disabled>✓ Применить состав</button>
    </div>
    <div id="gmg-result" class="gm-gen-result"><div class="gm-empty" style="padding:10px 0">Нажми «Крутить» — выпадет вариант состава. Не нравится — крути ещё.</div></div>`;
}
function gmCloseGen() { document.getElementById('gm-gen')?.classList.add('gm-hidden'); }

function gmRollGen() {
  if (!window.GalaxyGen) { toast('Генератор не загружен', 'err'); return; }
  const richness = +document.getElementById('gmg-rich').value;
  const starCls = document.getElementById('gmg-cls').value;
  GM.genResult = GalaxyGen.generate({ richness, starCls });
  const r = GM.genResult;
  const bodies = r.bodies.map((b, i) => {
    const kc = b.kind === 'belt' ? ' gm-dot-belt' : b.kind === 'anomaly' ? ' gm-dot-anom' : '';
    const sat = (b.rings ? ' · кольца ×' + b.rings : '') + (b.moons ? ' · спутн. ×' + b.moons : '');
    return `<div class="gm-gen-body">
      <span class="gm-orb-idx">${String(i + 1).padStart(2, '0')}</span>
      <span class="gm-orb-dot${kc}" style="--zc:${gmZoneColor(b.zone)}"></span>
      <div style="flex:1;min-width:0">
        <div class="gm-gb-top"><span class="gm-fp-name">${esc(b.name)}</span>${b.dist != null ? `<span class="gm-orb-dist">${b.dist} а.е.</span>` : ''}${b.kind === 'planet' ? gmSlotsBadge(b) : `<span class="gm-slots gm-slots-k"><b>${b.slotsK || 0}</b>&nbsp;К</span>`}</div>
        <div class="gm-fp-meta">${esc(b.type)} · <span style="color:${gmZoneColor(b.zone)}">${esc(b.zone)}</span>${sat}</div>
        ${gmResChips(b.resources)}
      </div>
    </div>`;
  }).join('');
  document.getElementById('gmg-result').innerHTML =
    `<div class="gm-gen-summary">★ ${r.star.icon} ${esc(r.star.name)} (${r.star.cls}) · тел: ${r.bodies.length}</div>${bodies}`;
  const ap = document.getElementById('gmg-apply'); if (ap) ap.disabled = false;
}
function gmApplyGen() {
  if (!GM.genResult) return;
  GM.formPlanets = JSON.parse(JSON.stringify(GM.genResult.bodies));
  gmRenderFormPlanets();
  gmCloseGen();
  toast('Состав применён — не забудь «Сохранить»', 'ok');
}

// ════════════════════════════════════════════════════════════
// GMM — МОБИЛЬНЫЙ РЕНДЕРЕР КАРТЫ (canvas).
//
// Почему отдельный: DOM/SVG-вариант на телефонах неюзабелен — слой
// 3300×2062 (SVG-вороной + DOM-звёзды) пере-растеризуется браузером при
// каждом пинче, а бесконечные CSS-анимации разлома заставляют перерисо-
// вывать весь слой даже в покое → лаги, дёрганье, «рендер с нуля».
//
// Здесь мир (фон, вороной, границы, линии, звёзды, подписи) рисуется в
// офскрин-битмап (видимая область + запас по пол-экрана), а каждый кадр
// на экран — это ОДИН drawImage с трансформом. Пан/пинч/инерция всегда
// идут по готовому битмапу (60 fps); после остановки жеста битмап
// перерисовывается в полном разрешении (короткая фоновая операция).
//
// Жесты: 1 палец — пан (с инерцией), 2 — пинч-зум, тап — панель системы,
// дабл-тап по пустому — зум. Редактирование карты — только на десктопе.
// Отладка на ПК: ?gmm=1 в адресе принудительно включает этот рендерер.
// ════════════════════════════════════════════════════════════
const GMM = {
  active: false, cv: null, ctx: null, dpr: 1, vw: 0, vh: 0,
  s: 0.1, tx: 0, ty: 0,            // камера: screen = world * s + t (CSS px)
  paths: null,                     // кэш Path2D мира (группировка по цвету)
  bmp: null,                       // офскрин-битмап {cv, wx, wy, scale, pw, ph, camS}
  ptrs: new Map(), gesture: null, rect: null,
  vel: null, anim: null,           // инерция / анимация камеры
  raf: 0, dirty: false, rasterT: 0, lastRaster: 0,
  lastTap: 0, ltx: 0, lty: 0,
  selId: null, imgs: {}, resImgs: {},   // resImgs: кэш PNG-иконок ресурсов по имени
};
const GMM_RAR_C = { common: '#7f93ad', uncommon: '#5fc257', rare: '#39bfe8', epic: '#b66cf2', legendary: '#ffa033' };
// туманности фона: [x, y, r] в долях карты, цвет, альфа (палитра как у #gm-bg)
const GMM_NEBULAE = [
  [.22, .28, .30, '150,34,42', .30],
  [.78, .66, .28, '54,34,104', .26],
  [.62, .16, .24, '110,28,36', .20],
  [.12, .82, .27, '30,52,96', .18],
  [.88, .22, .21, '70,30,80', .16],
];

function gmIsMobile() {
  if (/[?&]gmm=1\b/.test(location.search)) return true;   // принудительно (отладка)
  if (/[?&]gmm=0\b/.test(location.search)) return false;  // принудительно десктоп
  return window.matchMedia && matchMedia('(pointer: coarse)').matches;
}

// ── Вход в мобильный режим ──────────────────────────────────
function gmmRender(host) {
  GMM.active = true;
  // Класс gm-mobile (пальцевые контролы, нижний лист-панель) — только на тач-устройствах;
  // на ПК canvas-режим использует десктопную панель/контролы (класс gm-canvas-desk).
  const touch = gmIsMobile();
  const deskEdit = !touch && gmCanEdit();   // на ПК редактор может уйти в правку карты
  host.innerHTML = `
    <div id="gm-wrap" class="${touch ? 'gm-mobile' : 'gm-canvas-desk'}">
      <div id="gm-viewport"><canvas id="gmm-cv"></canvas></div>
      <div id="gm-controls">${gmCtlBtns()}${deskEdit ? `<button class="gm-ctl gm-ctl-edit" title="Редактировать карту" onclick="gmEnterEdit()">${GM_ICO.edit}</button>` : ''}</div>
      <div id="gm-panel" class="gm-hidden"></div>
      <div id="gm-opcmd" class="gm-hidden"></div>
    </div>`;
  GMM.cv = document.getElementById('gmm-cv');
  GMM.ctx = GMM.cv.getContext('2d');
  GMM.bmp = null; GMM.ptrs.clear(); GMM.gesture = null;
  GMM.vel = null; GMM.anim = null; GMM.selId = null; GMM.lastTap = 0; GMM.opCmd = null;
  gmmLoadImgs();
  gmmBuildWorld();
  gmmBindCanvas();
  if (!window._gmmRszBound) { window._gmmRszBound = true; window.addEventListener('resize', gmmOnWinResize); }
  // первичный размер + «вся карта»
  const vp = document.getElementById('gm-viewport');
  GMM.vw = vp.clientWidth; GMM.vh = vp.clientHeight;
  GMM.dpr = Math.min(2, window.devicePixelRatio || 1);
  GMM.cv.width = Math.max(1, Math.round(GMM.vw * GMM.dpr));
  GMM.cv.height = Math.max(1, Math.round(GMM.vh * GMM.dpr));
  gmmCover();
  gmmRaster();
  // дорисовка, когда подгрузятся веб-шрифты (подписи в битмапе)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
    if (GMM.active && GMM.cv && GMM.cv.isConnected) gmmRaster();
  });
}

function gmmLoadImgs() {
  GM_STAR_TYPES.forEach(t => {
    if (GMM.imgs[t]) return;
    const im = new Image();
    im.onload = () => { if (GMM.active && GMM.cv && GMM.cv.isConnected) gmmRasterSoon(); };
    im.src = GM_BASE + 'stars/star_' + t + '.png';
    GMM.imgs[t] = im;
  });
}

// ── Камера ──────────────────────────────────────────────────
function gmmMinS() { return Math.min(GMM.vw / GM_W, GMM.vh / GM_H) || 0.05; }
function gmmClampCam(c) {
  c.s = Math.min(Math.max(c.s, gmmMinS()), GM_MAX_SCALE);
  const mw = GM_W * c.s, mh = GM_H * c.s;
  c.tx = Math.min(0, Math.max(c.tx, GMM.vw - mw));
  c.ty = Math.min(0, Math.max(c.ty, GMM.vh - mh));
  if (mw < GMM.vw) c.tx = (GMM.vw - mw) / 2;
  if (mh < GMM.vh) c.ty = (GMM.vh - mh) / 2;
  return c;
}
function gmmClamp() { const c = gmmClampCam({ s: GMM.s, tx: GMM.tx, ty: GMM.ty }); GMM.s = c.s; GMM.tx = c.tx; GMM.ty = c.ty; }
function gmmFit(animate) {
  const ms = gmmMinS();
  const to = { s: ms, tx: (GMM.vw - GM_W * ms) / 2, ty: (GMM.vh - GM_H * ms) / 2 };
  if (animate) gmmAnimTo(to, 320);
  else { GMM.s = to.s; GMM.tx = to.tx; GMM.ty = to.ty; GMM.dirty = true; gmmKick(); }
}
// стартовый вид: карта ЗАПОЛНЯЕТ экран (cover), а не висит узкой полосой в пустоте.
// на портретном телефоне «вся карта» (contain) даёт огромные чёрные поля сверху/снизу —
// поэтому при входе центрируем по cover-масштабу; кнопка ⤢ остаётся «вся карта».
function gmmCover() {
  const cs = Math.min(4, Math.max(gmmMinS(), GMM.vw / GM_W, GMM.vh / GM_H) * 1.02);
  GMM.s = cs;
  GMM.tx = (GMM.vw - GM_W * cs) / 2; GMM.ty = (GMM.vh - GM_H * cs) / 2;
  gmmClamp(); GMM.dirty = true; gmmKick();
}
function gmmZoomAt(cx, cy, ns, animate) {
  ns = Math.min(Math.max(ns, gmmMinS()), GM_MAX_SCALE);
  const wx = (cx - GMM.tx) / GMM.s, wy = (cy - GMM.ty) / GMM.s;
  const to = gmmClampCam({ s: ns, tx: cx - wx * ns, ty: cy - wy * ns });
  if (animate) gmmAnimTo(to, 280);
  else { GMM.s = to.s; GMM.tx = to.tx; GMM.ty = to.ty; GMM.dirty = true; gmmKick(); }
}
function gmmAnimTo(to, dur) {
  GMM.vel = null;
  GMM.anim = { t0: performance.now(), dur: dur || 280, from: { s: GMM.s, tx: GMM.tx, ty: GMM.ty }, to };
  gmmKick();
}

function gmmResize() {
  const vp = document.getElementById('gm-viewport');
  if (!vp || !GMM.cv || !GMM.cv.isConnected) return;
  const w = vp.clientWidth, h = vp.clientHeight;
  if (!w || !h) return;
  GMM.vw = w; GMM.vh = h;
  GMM.dpr = Math.min(2, window.devicePixelRatio || 1);
  GMM.cv.width = Math.round(w * GMM.dpr);
  GMM.cv.height = Math.round(h * GMM.dpr);
  gmmClamp();
  gmmRaster();
}
function gmmOnWinResize() {
  if (!GMM.active || !document.getElementById('gmm-cv')) return;
  clearTimeout(GMM._rszT);
  GMM._rszT = setTimeout(gmmResize, 120);
}

// ── Жесты (Pointer Events; touch-action:none на канвасе) ───
function gmmBindCanvas() {
  const cv = GMM.cv;
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    GMM.rect = cv.getBoundingClientRect();
    GMM.ptrs.set(e.pointerId, { x: e.clientX - GMM.rect.left, y: e.clientY - GMM.rect.top });
    GMM.vel = null; GMM.anim = null;
    if (GMM.ptrs.size === 1) {
      const p = GMM.ptrs.get(e.pointerId), now = performance.now();
      GMM.gesture = { mode: 'pan', id: e.pointerId, sx: p.x, sy: p.y, tx0: GMM.tx, ty0: GMM.ty,
        moved: false, t0: now, lx: p.x, ly: p.y, lt: now, vx: 0, vy: 0 };
    } else if (GMM.ptrs.size === 2) gmmStartPinch();
    else GMM.gesture = null;
  });
  cv.addEventListener('pointermove', (e) => {
    const pt = GMM.ptrs.get(e.pointerId);
    if (!pt) return;
    const r = GMM.rect || cv.getBoundingClientRect();
    pt.x = e.clientX - r.left; pt.y = e.clientY - r.top;
    const g = GMM.gesture;
    if (!g) return;
    if (g.mode === 'pan' && e.pointerId === g.id) {
      const dx = pt.x - g.sx, dy = pt.y - g.sy;
      if (!g.moved && Math.hypot(dx, dy) > 7) g.moved = true;
      if (!g.moved) return;
      GMM.tx = g.tx0 + dx; GMM.ty = g.ty0 + dy;
      gmmClamp();
      const now = performance.now(), dt = Math.max(1, now - g.lt);
      g.vx = 0.75 * ((pt.x - g.lx) / dt) + 0.25 * g.vx;   // сглаженная скорость для инерции
      g.vy = 0.75 * ((pt.y - g.ly) / dt) + 0.25 * g.vy;
      g.lx = pt.x; g.ly = pt.y; g.lt = now;
      GMM.dirty = true; gmmKick();
    } else if (g.mode === 'pinch' && GMM.ptrs.size >= 2) {
      const ps = [...GMM.ptrs.values()];
      const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1;
      const cx = (ps[0].x + ps[1].x) / 2, cy = (ps[0].y + ps[1].y) / 2;
      GMM.s = Math.min(Math.max(g.s0 * (d / g.d0), gmmMinS()), GM_MAX_SCALE);
      GMM.tx = cx - g.wx * GMM.s; GMM.ty = cy - g.wy * GMM.s;
      gmmClamp();
      GMM.dirty = true; gmmKick();
    }
  });
  const up = (e) => {
    if (!GMM.ptrs.delete(e.pointerId)) return;
    const g = GMM.gesture;
    if (GMM.ptrs.size === 1) {
      // из пинча в пан оставшимся пальцем — без скачка
      const [id] = GMM.ptrs.keys();
      const p = GMM.ptrs.get(id), now = performance.now();
      GMM.gesture = { mode: 'pan', id, sx: p.x, sy: p.y, tx0: GMM.tx, ty0: GMM.ty,
        moved: true, t0: now, lx: p.x, ly: p.y, lt: now, vx: 0, vy: 0 };
      return;
    }
    if (GMM.ptrs.size) return;
    GMM.gesture = null;
    if (!g || g.mode !== 'pan') return;
    const now = performance.now();
    if (!g.moved && e.type === 'pointerup' && now - g.t0 < 500) {
      const r = GMM.rect || cv.getBoundingClientRect();
      gmmTapAt(e.clientX - r.left, e.clientY - r.top);
    } else if (g.moved && now - g.lt < 60 && Math.hypot(g.vx, g.vy) > 0.08) {
      GMM.vel = { vx: g.vx, vy: g.vy, t: 0 };   // инерция доводки
      gmmKick();
    }
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  // колесо — вдруг планшет с мышью / отладка на ПК
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    GMM.lastWheel = performance.now();   // отметка «идёт зум колесом» → дешёвый растр в кадре
    const r = cv.getBoundingClientRect();
    // Прямой зум к курсору (без анимации — она спамила перерастеризацию и лагала).
    gmmZoomAt(e.clientX - r.left, e.clientY - r.top, GMM.s * (e.deltaY > 0 ? 1 / 1.2 : 1.2), false);
  }, { passive: false });
  // тултип названия ресурса при наведении курсора
  cv.addEventListener('mousemove', (e) => {
    if (!GM.showRes || !GMM.resHitMap || !GMM.resHitMap.length) { gmmHideResTip(); return; }
    const r = cv.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    // преобразуем координаты мыши в мировые координаты
    const b = GMM.bmp;
    if (!b) { gmmHideResTip(); return; }
    // bitamp рисуется в: (b.wx * GMM.s + GMM.tx, b.wy * GMM.s + GMM.ty) с размером (b.pw * f, b.ph * f)
    // где f = GMM.s / b.scale. Обратное преобразование:
    const wx = (mx - b.wx * GMM.s - GMM.tx) / GMM.s + b.wx;
    const wy = (my - b.wy * GMM.s - GMM.ty) / GMM.s + b.wy;
    // ищем иконку ресурса под мышью
    const hit = GMM.resHitMap.find(rn =>
      wx >= rn.x && wx <= rn.x + rn.w && wy >= rn.y && wy <= rn.y + rn.h);
    if (hit) gmmShowResTip(hit, e.clientX, e.clientY);
    else gmmHideResTip();
  });
  cv.addEventListener('mouseleave', () => gmmHideResTip());
}
function gmmShowResTip(hit, clientX, clientY) {
  let tip = document.getElementById('gmm-res-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'gmm-res-tip';
    document.body.appendChild(tip);
  }
  tip.innerHTML = esc(hit.name) + (hit.r ? `<span class="gm-tip-r">${esc(hit.r)}</span>` : '');
  tip.style.left = (clientX) + 'px';
  tip.style.top = (clientY - 7) + 'px';
  tip.classList.add('gm-on');
}
function gmmHideResTip() {
  const tip = document.getElementById('gmm-res-tip');
  if (tip) tip.classList.remove('gm-on');
}
function gmmStartPinch() {
  const ps = [...GMM.ptrs.values()];
  const d0 = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1;
  const cx = (ps[0].x + ps[1].x) / 2, cy = (ps[0].y + ps[1].y) / 2;
  GMM.gesture = { mode: 'pinch', d0, s0: GMM.s, wx: (cx - GMM.tx) / GMM.s, wy: (cy - GMM.ty) / GMM.s };
}

function gmmTapAt(lx, ly) {
  const now = performance.now();
  const dbl = (now - GMM.lastTap < 320 && Math.hypot(lx - GMM.ltx, ly - GMM.lty) < 40);
  const sysAtScreen = () => {
    let best = null, bd = 1e9;
    GM.systems.forEach(s => {
      const sx = s.x * GMM.s + GMM.tx, sy = gmmTY(s.y * GMM.s + GMM.ty);
      const d = Math.hypot(sx - lx, sy - ly), rad = Math.max(24, gmmIconPx(s, GMM.s) * 0.7);
      if (d < rad && d < bd) { bd = d; best = s; }
    });
    return best;
  };
  // 0) РЕЖИМ ПРИЦЕЛИВАНИЯ носителя: клик по системе = отправить туда, по пустоте = отмена.
  if (GMM.opCmd && GMM.opCmd.mode === 'target') {
    const tgt = sysAtScreen();
    if (tgt) gmOutpostSendTo(GMM.opCmd.id, tgt.id);
    else { gmCloseOutpostCmd(); toast('Отправка отменена', ''); }
    return;
  }
  // 0б) РЕЖИМ ПРИЦЕЛИВАНИЯ Гиперпейсер: отправка / выбор системы-цели для залпа.
  if (GMM.mzaCmd && (GMM.mzaCmd.mode === 'sendTarget' || GMM.mzaCmd.mode === 'fireTarget')) {
    const tgt = sysAtScreen();
    if (!tgt) { gmCloseMzaCmd(); toast('Отменено', ''); return; }
    if (GMM.mzaCmd.mode === 'sendTarget') gmMzaSendTo(GMM.mzaCmd.id, tgt.id);
    else gmMzaPickPlanet(GMM.mzaCmd.id, tgt);
    return;
  }
  // 1) ГЕКСЫ МИН вокруг планеты (глубокий зум): клик по гексу = заминировать/снять.
  if (GMM.mineHex && GMM.mineHex.length) {
    let best = null, bd = 1e9;
    GMM.mineHex.forEach(h => { const d = Math.hypot(h.x - lx, h.y - ly); if (d < h.r && d < bd) { bd = d; best = h; } });
    if (best) { gmMineHexClick(best); return; }
  }
  // 2) КЛИК ПО МОЕМУ НОСИТЕЛЮ → командная плашка (отправить / развернуть / списать).
  if (GMM.shipHit && GMM.shipHit.length) {
    let best = null, bd = 1e9;
    GMM.shipHit.forEach(h => { const d = Math.hypot(h.x - lx, h.y - ly); if (d < h.r && d < bd) { bd = d; best = h; } });
    if (best) { if (best.mza) gmOpenMzaCmd(best.id); else gmOpenOutpostCmd(best.id); return; }
  }
  if (GMM.opCmd) gmCloseOutpostCmd();   // клик мимо — закрываем плашку
  if (GMM.mzaCmd) gmCloseMzaCmd();
  // ОБЗОР: главное — регионы. Клик по сектору в приоритете над звёздами.
  if (gmmOverview()) {
    if (!dbl) {
      const secId = gmmSectorAt(lx, ly);
      if (secId) { gmOpenSector(secId); GMM.lastTap = now; GMM.ltx = lx; GMM.lty = ly; return; }
    }
    if (dbl) { gmmZoomAt(lx, ly, GMM.s * 2.2, true); GMM.lastTap = 0; }
    else { GMM.lastTap = now; GMM.ltx = lx; GMM.lty = ly; gmClosePanel(); }
    return;
  }
  // ближняя дистанция — ближайшая система в радиусе пальца
  let best = null, bd = 1e9;
  GM.systems.forEach(s => {
    const sx = s.x * GMM.s + GMM.tx, sy = gmmTY(s.y * GMM.s + GMM.ty);
    const d = Math.hypot(sx - lx, sy - ly);
    const rad = Math.max(24, gmmIconPx(s, GMM.s) * 0.7);
    if (d < rad && d < bd) { bd = d; best = s; }
  });
  if (best) {
    GMM.selId = best.id; GMM.dirty = true; gmmKick();
    gmOpenPanel(best);
    gmmEnsureVisible(best);
    GMM.lastTap = 0;
    return;
  }
  if (dbl) {
    // дабл-тап по пустому: зум к точке; если уже почти максимум — вся карта
    gmmZoomAt(lx, ly, GMM.s > 3.4 ? gmmMinS() : GMM.s * 2.2, true);
    GMM.lastTap = 0;
  } else {
    GMM.lastTap = now; GMM.ltx = lx; GMM.lty = ly;
    gmClosePanel();
  }
}
// какой сектор под точкой экрана (lx,ly) — проверка попадания в union ячеек сектора
function gmmSectorAt(lx, ly) {
  const P = GMM.paths;
  if (!P || !P.secHit || !P.secHit.length || !GMM.ctx) return null;
  const wx = (lx - GMM.tx) / GMM.s, wy = (ly - GMM.ty) / GMM.s;   // экран → мир
  const ctx = GMM.ctx;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);   // координаты Path2D — мировые
  let hit = null;
  for (const h of P.secHit) { if (ctx.isPointInPath(h.p2d, wx, wy)) { hit = h.secId; break; } }
  ctx.restore();
  return hit;
}
// после открытия нижней панели доводим камеру, чтобы звезда не пряталась под ней
function gmmEnsureVisible(sys) {
  const sx = sys.x * GMM.s + GMM.tx, sy = gmmTY(sys.y * GMM.s + GMM.ty);
  let tx = GMM.tx, ty = GMM.ty;
  const yMin = 56, yMax = GMM.vh * 0.32, xMin = 30, xMax = GMM.vw - 30;
  if (sy > yMax) ty += yMax - sy; else if (sy < yMin) ty += yMin - sy;
  if (sx < xMin) tx += xMin - sx; else if (sx > xMax) tx += xMax - sx;
  if (tx !== GMM.tx || ty !== GMM.ty) gmmAnimTo(gmmClampCam({ s: GMM.s, tx, ty }), 260);
}

// ── Кадровый цикл: блит битмапа + инерция/анимация ──────────
function gmmKick() { if (!GMM.raf && GMM.active) GMM.raf = requestAnimationFrame(gmmFrame); }
function gmmFrame(ts) {
  GMM.raf = 0;
  if (!GMM.cv || !GMM.cv.isConnected) { GMM.active = false; return; }   // ушли со страницы
  let again = false;
  if (GMM.anim) {
    const a = GMM.anim, k = Math.min(1, (ts - a.t0) / a.dur);
    const e = 1 - Math.pow(1 - k, 3);
    GMM.s = a.from.s + (a.to.s - a.from.s) * e;
    GMM.tx = a.from.tx + (a.to.tx - a.from.tx) * e;
    GMM.ty = a.from.ty + (a.to.ty - a.from.ty) * e;
    if (k >= 1) GMM.anim = null; else again = true;
    GMM.dirty = true;
  } else if (GMM.vel) {
    const dt = GMM.vel.t ? Math.min(40, ts - GMM.vel.t) : 16;
    GMM.vel.t = ts;
    GMM.tx += GMM.vel.vx * dt; GMM.ty += GMM.vel.vy * dt;
    const f = Math.exp(-dt / 320);   // трение
    GMM.vel.vx *= f; GMM.vel.vy *= f;
    gmmClamp();
    if (Math.hypot(GMM.vel.vx, GMM.vel.vy) < 0.01) GMM.vel = null; else again = true;
    GMM.dirty = true;
  }
  // Глубокий зум: системы раскрываются в анимированные орбиты — гоним кадры
  // непрерывно (живой оверлей поверх статичного битмапа, как кольцо выбора).
  // Аналогично — пока виден трафик караванов по гиперпутям.
  if (gmmDeepA() > 0.01) { GMM.dirty = true; again = true; }
  else if (gmmLaneA() > 0.01 && GMM.caravans && GMM.caravans.length) { GMM.dirty = true; again = true; }
  // залпы артиллерии живут на любом зуме — гоним кадры, пока есть снаряды в полёте
  if (GMM.salvos && GMM.salvos.length) { GMM.dirty = true; again = true; }
  // корабли-носители аванпостов в полёте — тоже анимируем на любом зуме
  if (GMM.defense && GMM.defense.ships && GMM.defense.ships.some(d => d.kind === 'transit')) { GMM.dirty = true; again = true; }
  if (GMM.opCmd) { GMM.dirty = true; again = true; }   // пульс кольца выбранного носителя
  if (GMM.dirty) { GMM.dirty = false; gmmBlit(); }
  if (gmmNeedRaster()) {
    const now = performance.now();
    const moving = !!(GMM.gesture || GMM.anim || GMM.vel) || (now - (GMM.lastWheel || 0) < 180);
    if (moving) {
      // ВО ВРЕМЯ жеста. Чистый ПАН битмап НЕ пере-печём — покрытие края держит живой
      // слой территорий (см. gmmBlit), а пере-печь туман (138 радиальных градиентов)
      // каждые 110мс = рывки. Дешёвый низкоразрешённый растр делаем только при смене
      // ЗУМА (битмап становится мыльным/каша на переходе обзор↔системы), иначе ждём
      // утихания. Чистый полноразмерный — как жест уймётся (debounce).
      if (gmmZoomChanged() && now - GMM.lastRaster > 110) gmmRaster(0.6);
      gmmRasterSoon();
    } else {
      gmmRaster(1);      // покой — сразу начисто
    }
  }
  if (again) gmmKick();
}
function gmmBlit() {
  const ctx = GMM.ctx, dpr = GMM.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#04060c';
  ctx.fillRect(0, 0, GMM.vw, GMM.vh);
  // Живой космофон во весь кадр ПОД плоскостью карты — каждый кадр, на любом зуме.
  // Гарантирует, что по краям НИКОГДА не зияет пустота: ни при завале на глубоком
  // зуме, ни пока битмап до-/перерастеризуется после жеста зума (раньше там был
  // голый чёрный фон-заглушка). Дёшево: заливка + 5 туманностей + рамка; звёздную
  // россыпь сюда не льём (дорого на обзоре и уже запечена в самом битмапе).
  {
    const cs = GMM.s;
    const wx0 = -GMM.tx / cs, wy0 = -GMM.ty / cs, wx1 = (GMM.vw - GMM.tx) / cs, wy1 = (GMM.vh - GMM.ty) / cs;
    ctx.save();
    ctx.setTransform(cs * dpr, 0, 0, cs * dpr, GMM.tx * dpr, GMM.ty * dpr);
    // в режиме систем (не обзор) вьюпорт мал → звёздную россыпь рисуем и живьём,
    // чтобы открытые края (за границей мира / пока битмап не докрыл) были звёздным
    // космосом, а не чёрной дырой. На обзоре звёзды не льём — дорого и битмап и так всё кроет.
    gmmPaintSpace(ctx, cs, wx0, wy0, wx1, wy1, !gmmOverview(cs));
    ctx.restore();
  }
  // ЖИВОЙ ВЕКТОРНЫЙ МИР ПОД битмапом — каждый кадр. Тот же дешёвый слой (территории,
  // сектора, границы, ГИПЕРПУТИ, метки регионов), что печётся в битмап, но рисуемый
  // живьём. Битмап непрозрачен и кроет его там, где успел перерастеризоваться; а на
  // крае, который битмап при пане ещё не докрыл, мгновенно видно ВСЁ (и пути, и
  // регионы), без «пустого квадрата». Рисуем с тем же наклоном плоскости ky, что и
  // битмап (drawImage … gmmTY … *ky) → контуры совпадают, без шва. Туман — плоский
  // (без дорогих прорех у звёзд): в крае этого достаточно, точные прорехи добьёт битмап.
  {
    const cs = GMM.s, ky = gmmTiltK(), pv = GMM.vh / 2, P = GMM.paths;
    if (P) {
      ctx.save();
      // тот же мировой transform, что и у битмапа: вертикальный масштаб ky вокруг центра
      ctx.setTransform(cs * dpr, 0, 0, cs * ky * dpr, GMM.tx * dpr, (pv * (1 - ky) + ky * GMM.ty) * dpr);
      gmmPaintVector(ctx, cs, true);   // live: без тяжёлых флагов-клипов (их даёт битмап)
      if (P.fogPath) { ctx.fillStyle = 'rgba(4,6,14,0.88)'; ctx.fill(P.fogPath); }
      ctx.restore();
    }
  }
  const b = GMM.bmp;
  if (b) {
    const f = GMM.s / b.scale;   // битмап-px → CSS-px
    const ky = gmmTiltK();       // вертикальный завал плоскости под наклон систем
    const dx = b.wx * GMM.s + GMM.tx, dy = b.wy * GMM.s + GMM.ty;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(b.cv, 0, 0, b.pw, b.ph, dx, gmmTY(dy), b.pw * f, b.ph * f * ky);
  }
  // ЖИВОЙ СЛОЙ ОБЪЕКТОВ: звёзды / подписи / иконки ресурсов рисуются каждый кадр
  // в МИРОВОЙ системе координат по ТЕКУЩЕМУ зуму. Их экранный размер сублинейный
  // (gmmIconPx ~ scale^0.7) / постоянный (подписи) — линейное растяжение битмапа
  // его не держит, поэтому раньше при перерастеризации размер «щёлкал». Теперь —
  // как у орбит: всегда верный размер, без рассинхрона зум↔объекты.
  ctx.save();
  ctx.setTransform(GMM.s * dpr, 0, 0, GMM.s * dpr, GMM.tx * dpr, GMM.ty * dpr);
  gmmPaintStars(ctx, GMM.s);
  ctx.restore();
  if (GMM.selId) {   // кольцо выбранной системы — поверх, живёт без перерисовки мира
    const sys = GM.systems.find(x => x.id === GMM.selId);
    if (sys) {
      const sx = sys.x * GMM.s + GMM.tx, sy = gmmTY(sys.y * GMM.s + GMM.ty);
      const R = gmmIconPx(sys, GMM.s) * 0.62 + 6;
      const ry = R * (1 - 0.5 * gmmDeepA());   // в разрезе кольцо ложится в плоскость диска
      ctx.beginPath(); ctx.ellipse(sx, sy, R, ry, 0, 0, 6.2832);
      ctx.strokeStyle = 'rgba(150,205,255,.85)'; ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  gmmPaintLaneTraffic(ctx);  // караваны по гиперпутям (как только видны сами пути)
  gmmPaintSalvos(ctx);   // залпы межзвёздной артиллерии в полёте (на любом зуме)
  gmmPaintOrbits(ctx);   // живой оверлей анимированных систем (на глубоком зуме)
  gmmPaintDeepFx(ctx);   // HUD-переход «вход в систему»: рамка/скобки/скан/импульс
  gmmPaintDefense(ctx);  // оборона: аванпосты/носители — ПОВЕРХ орбит, иначе на глубоком
                         // зуме большая планета/корона звезды перекрывают значки
}

// Стилизованный HUD-переход при заходе в ПОЛНЫЙ зум системы. Вокруг системы в фокусе
// «собирается» приборная рамка: угловые скобки съезжаются к домену, по кольцу бежит
// сканирующая дуга, а в момент входа разово расходится кольцо-импульс. Всё привязано
// к gmmDeepA (0 на обзоре → 1 в системе) — при отдалении эффект так же плавно
// разбирается. Геометрия системы берётся из GMM.focusFx (его кладёт gmmPaintOrbits).
function gmmPaintDeepFx(ctx) {
  const a = gmmDeepA();
  const prev = GMM._prevDeepA == null ? a : GMM._prevDeepA;
  GMM._prevDeepA = a;
  const fx = GMM.focusFx;
  if (a <= 0.02 || !fx) return;
  const t = performance.now() / 1000;
  if (prev < 0.5 && a >= 0.5) GMM.deepFxT = t;          // пересекли порог входа → запустить импульс
  const { cx, cy, rMax } = fx, [r, g, b] = fx.color;
  const lr = Math.min(255, r + 75), lg = Math.min(255, g + 75), lb = Math.min(255, b + 75);
  const TILT = gmmTiltK(), R = rMax * 1.16;             // рамка чуть шире домена системы
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // — кольцо-рамка + бегущая сканирующая дуга (в плоскости наклонённого диска) —
  ctx.save(); ctx.translate(cx, cy); ctx.scale(1, TILT);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(${lr},${lg},${lb},${(0.16 * a).toFixed(3)})`; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.2832); ctx.stroke();
  const sweep = (t * 0.32) % 6.2832;   // медленное вращение сканирующей дуги
  ctx.strokeStyle = `rgba(${lr},${lg},${lb},${(0.5 * a).toFixed(3)})`; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, R, sweep, sweep + 0.85); ctx.stroke();
  // разовый импульс-кольцо при входе
  if (GMM.deepFxT) {
    const dt = t - GMM.deepFxT;
    if (dt >= 0 && dt < 0.7) {
      const u = dt / 0.7;
      ctx.strokeStyle = `rgba(${lr},${lg},${lb},${((1 - u) * 0.7).toFixed(3)})`;
      ctx.lineWidth = 3 * (1 - u) + 0.6;
      ctx.beginPath(); ctx.arc(0, 0, R * (0.35 + u * 0.95), 0, 6.2832); ctx.stroke();
    } else if (dt >= 0.7) GMM.deepFxT = 0;
  }
  ctx.restore();

  // — угловые скобки, «садящиеся» в кадр: пока не дозумились — шире, при a→1 у домена —
  const S = R * (0.95 + 0.55 * (1 - a)), arm = R * 0.26;
  ctx.strokeStyle = `rgba(${lr},${lg},${lb},${(0.85 * a).toFixed(3)})`; ctx.lineWidth = 2;
  const bracket = (sx, sy) => {
    const x = cx + sx * S, y = cy + sy * S * TILT;
    ctx.beginPath();
    ctx.moveTo(x - sx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y - sy * arm * TILT);
    ctx.stroke();
  };
  bracket(-1, -1); bracket(1, -1); bracket(-1, 1); bracket(1, 1);
  ctx.restore();
}

// Сила оверлея орбит: 0 на обычном зуме → 1 на глубоком (плавный заход в [lo,hi]).
function gmmDeepA() {
  const lo = 2.4, hi = 3.6;
  const u = Math.max(0, Math.min(1, (GMM.s - lo) / (hi - lo)));
  return u * u * (3 - 2 * u);
}
// Вертикальный «завал» плоскости карты под 3D-диски систем: на глубоком зуме вся
// плоскость (битмап территорий/границ, звёзды, орбиты, трафик) сжимается по
// вертикали к центру экрана — как у наклонённого диска. ky: 1 — плоско «сверху»,
// 0.5 — полный наклон (та же сплюснутость, что и у орбит). Пивот един для всех
// слоёв (центр вьюпорта), поэтому карта и системы тилтятся как одно целое.
function gmmTiltK() {
  const base = gmmDeepA();                 // сила наклона по зуму (0 плоско → 1 глубоко)
  if (base <= 0) return 1;
  // У верхнего/нижнего края галактики наклон ГАСИМ: сжатие плоскости к центру
  // обнажило бы полосу за краем мира (заполнить нечем → «пустота/дыра»). Полный
  // наклон только когда сверху и снизу есть запас мира ~полвьюпорта — тогда сжатая
  // плоскость всё ещё кроет экран. Ближе к краю — плавно выпрямляем (ky→1).
  const s = GMM.s;
  const vyTop = -GMM.ty / s, vyBot = (GMM.vh - GMM.ty) / s;   // мировые Y верх/низ кадра
  const need = (vyBot - vyTop) * 0.5 || 1;
  const avail = Math.min(vyTop, GM_H - vyBot);                // запас мира сверху/снизу
  const edge = Math.max(0, Math.min(1, avail / need));
  return 1 - 0.5 * base * edge;
}
function gmmTY(screenY) { const p = GMM.vh / 2; return p + (screenY - p) * gmmTiltK(); }
// Сила слоя трафика гиперпутей: 0 на дальнем обзоре (пути ещё каша) → 1 когда
// отдельные гиперпути читаются. Дальше остаётся включённым — империя живёт.
function gmmLaneA() {
  const lo = 0.55, hi = 1.3;
  const u = Math.max(0, Math.min(1, (GMM.s - lo) / (hi - lo)));
  return u * u * (3 - 2 * u);
}
// Расстояние до ближайшей соседней системы (мировые юниты, кэш на объекте) —
// чтобы кластер орбит вписывался в полупролёт и НЕ налезал на соседей.
function gmmNN(sys) {
  if (sys._nn != null) return sys._nn;
  let best = Infinity;
  for (const o of GM.systems) {
    if (o === sys) continue;
    const d = Math.hypot(o.x - sys.x, o.y - sys.y);
    if (d < best) best = d;
  }
  sys._nn = isFinite(best) ? best : 700;
  return sys._nn;
}
// Экранный радиус тела по группе планеты (p.type — отображаемое имя группы из
// генератора): гиганты крупные, карлики мелкие — чтобы разница размеров читалась.
// Аномалии пульсируют отдельно.
const GMM_PG_SZ = {
  'Газовые гиганты': 12, 'Ледяные гиганты': 11, 'Горячие гиганты': 11,
  'Океанические': 8, 'Экзотические': 8, 'Землеподобные': 7.5, 'Пустынные': 7,
  'Вулканические': 6.5, 'Лавовые миры': 6, 'Криомиры': 5, 'Малые тела': 4.5,
};
function gmmPlanetSz(p) { return GMM_PG_SZ[p.type] || 7; }
// Цвет свечения короны по типу звезды (rgb-строка для rgba()).
const GMM_STAR_GLOW = {
  yellow: '255,214,140', red: '255,150,110', orange: '255,178,114', blue: '160,200,255',
  white: '224,233,255', neutron: '200,222,255', giant: '255,198,150', purple: '210,160,255',
};
function gmStarGlow(tp) { return GMM_STAR_GLOW[tp] || '255,210,150'; }

// Рисует звёзды-системы «в разрезе»: плоские орбиты с планетами по составу s.planets.
// Радиусы — по реальной дистанции (p.dist, а.е.), размер тела — по группе планеты,
// пояса — поле астероидов. У системы в фокусе (ближайшей к центру) — подписи планет.
// Только для систем в кадре (отсев по вьюпорту) — стоимость ограничена.
function gmmPaintOrbits(ctx) {
  GMM.mineHex = [];                 // клик-зоны гексов мин (пересобираются каждый глубокий кадр)
  GMM.focusFx = null;               // геометрия системы в фокусе — для HUD-перехода (gmmPaintDeepFx)
  const a = gmmDeepA();
  if (a <= 0.01) return;
  const s = GMM.s, tx = GMM.tx, ty = GMM.ty;
  const wx0 = -tx / s, wy0 = -ty / s, wx1 = (GMM.vw - tx) / s, wy1 = (GMM.vh - ty) / s;
  const inView = sys => !(sys.x < wx0 - 300 || sys.x > wx1 + 300 || sys.y < wy0 - 300 || sys.y > wy1 + 300);
  // есть что рисовать, если у системы есть ЛЮБОЕ тело: планеты генератора,
  // классless-миры из админки или консольные колонии/столицы (gmSystemBodies
  // сводит всё это вместе). Раньше тут был only p.kind → системы с одной лишь
  // консольной колонией отсеивались и орбиты не появлялись вовсе.
  const hasP = sys => sys.faction !== 'rift' && gmSystemBodies(sys).length > 0;
  const t = performance.now() / 1000;
  // система в фокусе (ближайшая к центру экрана) — ей подписываем планеты
  const cwx = (GMM.vw / 2 - tx) / s, cwy = (GMM.vh / 2 - ty) / s;
  let focus = null, fd = Infinity;
  GM.systems.forEach(sys => {
    if (!hasP(sys) || !inView(sys)) return;
    const d = Math.hypot(sys.x - cwx, sys.y - cwy);
    if (d < fd) { fd = d; focus = sys; }
  });
  ctx.save();
  ctx.lineCap = 'round';
  const TILT = gmmTiltK();   // наклон плоскости системы = общий завал карты (3D-диск)
  // Рост системы на СВЕРХЗУМЕ: иконки/тела капятся на camS=1, поэтому без этого
  // дальнейший зум только разносил орбиты, но не укрупнял планеты/мины. gz растёт с
  // приближением (1 у порога раскрытия → до 3.2 у потолка) — тела и гексы мин крупнее.
  const gz = Math.max(1, Math.min(3.2, GMM.s / 4.5));
  GM.systems.forEach(sys => {
    if (!hasP(sys) || !inView(sys)) return;
    const planets = gmOrbitBodies(sys);
    const cx = sys.x * s + tx, cy = gmmTY(sys.y * s + ty);
    const n = planets.length;
    const isFocus = sys === focus;
    const starR = Math.max(10, gmmIconPx(sys, s) * 0.5) * gz;
    const rMax = Math.min(gmmNN(sys) * 0.42 * s, 230 * gz);   // клубок не налезает на соседа; потолок растёт на сверхзуме
    const rIn = Math.min(starR + 22, rMax - 6);
    // радиусы орбит — по реальной дистанции (а.е.), отсюда неравномерные интервалы
    const ds = planets.map(p => +p.dist || 0);
    const dmin = Math.min(...ds), dmax = Math.max(...ds);
    const radii = planets.map((p, i) => {
      if (n <= 1) return (rIn + rMax) / 2;
      const u = dmax > dmin ? (ds[i] - dmin) / (dmax - dmin) : i / (n - 1);
      return rIn + (rMax - rIn) * u;
    });
    // ── ПРОСТРАНСТВО СИСТЕМЫ: наклонный диск-«домен» + корона звезды. Без обводки:
    //    территория обособлена самим светящимся диском, тонированным в цвет фракции-
    //    владельца (нейтральная — холодный синий). Свет держится по диску и мягко
    //    гаснет к краю — система читается как очерченный, но не «обведённый» домен. ──
    const glow = gmStarGlow(sys.star_type);
    const owner = sys.faction ? gmFaction(sys.faction) : null;
    const terr = owner ? gmRgb(gmReadable(owner.color)) : [120, 150, 205];
    if (isFocus) GMM.focusFx = { cx, cy, rMax, color: terr };   // для HUD-перехода входа в систему
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const haze = ctx.createRadialGradient(cx, cy, starR * 0.5, cx, cy, rMax * 1.12);
    haze.addColorStop(0, `rgba(${glow},${(0.12 * a).toFixed(3)})`);             // тёплый центр у звезды
    haze.addColorStop(0.45, `rgba(${terr},${(0.075 * a).toFixed(3)})`);         // тон владельца по диску
    haze.addColorStop(0.82, `rgba(${terr},${(0.05 * a).toFixed(3)})`);          // держим свет почти до края
    haze.addColorStop(1, 'rgba(0,0,0,0)');                                      // мягкий невидимый рубеж
    ctx.fillStyle = haze;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(1, TILT); ctx.translate(-cx, -cy);
    ctx.beginPath(); ctx.arc(cx, cy, rMax * 1.12, 0, 6.2832); ctx.fill();
    ctx.restore();
    // корона звезды
    const cor = ctx.createRadialGradient(cx, cy, 0, cx, cy, starR * 2.4);
    cor.addColorStop(0, `rgba(${glow},${(0.55 * a).toFixed(3)})`);
    cor.addColorStop(0.5, `rgba(${glow},${(0.2 * a).toFixed(3)})`);
    cor.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cor;
    ctx.beginPath(); ctx.arc(cx, cy, starR * 2.4, 0, 6.2832); ctx.fill();
    ctx.restore();
    const labels = [];   // подписи планет/поясов — собираем здесь, рисуем после тел
    const colPos = [];   // экранные позиции колоний — для внутрисистемного трафика
    for (let i = 0; i < n; i++) {
      const p = planets[i], r = radii[i], zc = p.dead ? '#6b6b72' : gmZoneColor(p.zone);  // мёртвый мир — холодный камень
      // орбита — наклонный эллипс, тонированный под зону, с лёгким двойным свечением
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * TILT, 0, 0, 6.2832);
      ctx.globalAlpha = a * (isFocus ? 0.12 : 0.07);
      ctx.strokeStyle = zc; ctx.lineWidth = 3; ctx.stroke();    // мягкий ореол линии
      ctx.globalAlpha = a * (isFocus ? 0.4 : 0.24);
      ctx.lineWidth = 1; ctx.stroke();                          // чёткая нить орбиты

      if (p.kind === 'belt') {
        // поле астероидов — кольцо мелких камешков, медленно дрейфует по орбите
        const drift = (t / 80) * 6.2832;
        const N = Math.max(28, Math.min(120, Math.round(r * 0.9)));
        const band = Math.max(2.5, r * 0.05);
        ctx.fillStyle = zc;
        for (let k = 0; k < N; k++) {
          const h = Math.sin((k + 1) * 12.9898 + i * 7.13) * 43758.5453;
          const j = h - Math.floor(h);                    // псевдослучайное 0..1 (стабильное)
          const aa = (k / N) * 6.2832 + drift;
          const rr = r + (j - 0.5) * 2 * band;
          ctx.globalAlpha = a * (0.22 + 0.55 * j);
          ctx.fillRect(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * TILT, 1.5, 1.5);
        }
        // подпись пояса — выносим наружу вправо по дуге (рисуется общим проходом)
        if (isFocus && p.name) labels.push({ name: p.name, ang: 0, r, sz: band, dim: true });
        continue;
      }

      const isAnom = p.kind === 'anomaly';
      const sz = (isAnom ? 6 + Math.sin(t * 0.9 + i) * 1.4 : gmmPlanetSz(p)) * gz;
      // планеты разнесены по золотому углу + общий медленный дрейф: относительные
      // промежутки сохраняются, поэтому тела не сбиваются в кучу на одной стороне
      const ang = i * 2.39996 + t * 0.045;
      const px = cx + Math.cos(ang) * r, py = cy + Math.sin(ang) * r * TILT;  // наклон плоскости
      // ореол
      ctx.globalAlpha = a * (isAnom ? 0.6 : 0.4);
      const gg = ctx.createRadialGradient(px, py, 0, px, py, sz * 2.6);
      gg.addColorStop(0, zc); gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(px, py, sz * 2.6, 0, 6.2832); ctx.fill();
      // тело с боковым светом (объём шара без псевдо-3D на самой карте).
      // Мёртвый мир: тусклый камень без яркого блика — выжжен дотла.
      ctx.globalAlpha = a;
      const g = ctx.createRadialGradient(px - sz * 0.38, py - sz * 0.38, 0, px, py, sz);
      if (p.dead) { g.addColorStop(0, '#9a9aa2'); g.addColorStop(0.5, zc); g.addColorStop(1, 'rgba(0,0,0,.75)'); }
      else { g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, zc); g.addColorStop(1, 'rgba(0,0,0,.62)'); }
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, sz, 0, 6.2832); ctx.fill();

      // ── «признаки жизни» колонизированного мира (базовый слой) — на мёртвом мире нет ──
      if (p.isColony && !isAnom && !p.dead) { gmmBodyLife(ctx, px, py, sz, p, a, t); colPos.push({ px, py }); }

      // ── минные ГЕКСЫ вокруг планеты (своя колония — кликабельны; чужое поле — показ) ──
      if (p.isColony && !isAnom && !p.dead && p.pid != null) gmmPlanetMineHexes(ctx, px, py, sz, TILT, a, p, sys);

      if (isFocus && p.name) labels.push({ name: p.name, ang, r, sz, dead: p.dead });
    }
    // внутрисистемный трафик: еле заметные конвои между колониями системы
    if (colPos.length > 1) gmmSysTraffic(ctx, colPos, a, t);
    // ── подписи планет фокус-системы: вынос наружу по радиусу (как спицы — не
    // пересекают звезду) + защита от наложения сдвигом дальше от центра ──
    if (isFocus && labels.length) {
      ctx.globalAlpha = a; ctx.textBaseline = 'middle';
      ctx.font = '600 12px Rajdhani, sans-serif'; ctx.shadowColor = '#000';
      const boxes = [];
      for (const L of labels) {
        const nm = L.dead ? '☠ ' + L.name : L.name;   // мёртвый мир помечаем в подписи
        const dirx = Math.cos(L.ang), diry = Math.sin(L.ang), right = dirx >= 0;
        ctx.textAlign = right ? 'left' : 'right';
        const w = ctx.measureText(nm).width;
        let off = L.sz + 6, lx = 0, ly = 0, box = null;
        for (let tries = 0; tries < 7; tries++) {
          const ax = cx + dirx * (L.r + off), ay = cy + diry * (L.r + off) * TILT;
          const x0 = right ? ax : ax - w, x1 = x0 + w, y0 = ay - 7, y1 = ay + 7;
          lx = ax; ly = ay; box = { x0, y0, x1, y1 };
          if (!boxes.some(b => x0 < b.x1 + 2 && x1 > b.x0 - 2 && y0 < b.y1 + 2 && y1 > b.y0 - 2)) break;
          off += 13;
        }
        boxes.push(box);
        ctx.shadowBlur = 4;
        ctx.fillStyle = L.dead ? 'rgba(170,170,178,.9)' : L.dim ? 'rgba(210,222,245,.85)' : 'rgba(223,234,255,.95)';
        ctx.fillText(nm, lx, ly);
      }
      ctx.shadowBlur = 0;
    }
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}

// Стабильная фаза анимации тела (по имени) — чтобы пульсация/вращение у соседних
// колоний не шли синхронно. Кэшируется на объекте тела (живёт до перезагрузки).
function gmmBodyPhase(body) {
  if (body._ph != null) return body._ph;
  let h = 0; const s = body.name || '';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (body._ph = (h % 1000) / 1000 * 6.2832);
}

// Доминирующая отрасль СВОЕЙ колонии → цвет «жизни» (зарево/огни/спутники тонятся
// под неё, сразу читается, чем занят мир). null, если построек нет.
const GMM_IND_TINT = {
  industry: [232, 150, 70],   // фабрики + добыча — ржаво-оранжевый смог
  science:  [95, 195, 232],   // научный институт — холодный синий
  military: [150, 175, 205],  // подготовка + спецслужбы — стальной
  trade:    [228, 192, 95],   // хаб + биржа + склад — золотой
};
function gmmColonyTint(bld) {
  if (!bld) return null;
  const ind = (bld.factory || 0) + (bld.mining || 0);
  const sci = (bld.science || 0);
  const mil = (bld.training || 0) + (bld.intel || 0);
  const tr = (bld.trade || 0) + (bld.market || 0) + (bld.warehouse || 0);
  const m = Math.max(ind, sci, mil, tr);
  if (m <= 0) return null;
  return GMM_IND_TINT[m === ind ? 'industry' : m === sci ? 'science' : m === mil ? 'military' : 'trade'];
}

// «Признаки жизни» колонизированного мира. БАЗОВЫЙ слой (все фракции): зарево
// городов, ночные огни, 1–3 спутника. Для СВОИХ колоний (есть данные построек в
// GM.bldByCol) добавляется постройко-точность: цвет «жизни» = доминирующая отрасль
// (смог фабрик / синь науки / сталь военных / золото торговли) + спецэффекты —
// сонар Научного института, патрули Центра подготовки, теневые запуски спецслужб.
// Данные чужих не грузим (разведданные) → для них только базовый слой в цвете фракции.
// Интенсивность («развитость») — по сумме слотов своих, иначе по статусу (столица>колония).
function gmmBodyLife(ctx, px, py, sz, body, a, t) {
  const cap = !!body.isCapital, ph = gmmBodyPhase(body);
  const bld = (GM.bldByCol && body.colId) ? GM.bldByCol[body.colId] : null;  // только свои колонии
  const fac = body.faction_id ? gmFaction(body.faction_id) : null;
  const tint = gmmColonyTint(bld);
  const [r, g, b] = tint || (fac ? gmRgb(fac.color) : [255, 200, 130]);
  let dev = cap ? 1 : 0.45;
  if (body.colId && GM.devByCol) {
    const slots = GM.devByCol[body.colId];
    if (slots != null) dev = Math.max(dev, Math.min(1, 0.3 + slots / 14));
  }
  // ── зарево городов: мягкий медленно «дышащий» ореол поверх тела (additive) ──
  const pulse = 0.7 + 0.3 * Math.sin(t * 0.5 + ph);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const haloR = sz * (2.0 + dev * 1.6);
  const gg = ctx.createRadialGradient(px, py, sz * 0.6, px, py, haloR);
  gg.addColorStop(0, `rgba(${r},${g},${b},${((0.16 + 0.22 * dev) * pulse * a).toFixed(3)})`);
  gg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gg;
  ctx.beginPath(); ctx.arc(px, py, haloR, 0, 6.2832); ctx.fill();
  ctx.restore();
  // ── ночные огни: крошечные неспешно мерцающие точки на диске ──
  const lights = Math.round(3 + dev * 5);
  const lr = Math.min(255, r + 90), lg = Math.min(255, g + 90), lb = Math.min(255, b + 70);
  for (let k = 0; k < lights; k++) {
    const h1 = Math.sin((k + 1) * 91.17 + ph) * 43758.5453;
    const h2 = Math.sin((k + 1) * 12.34 + ph) * 24634.6345;
    const rr = (h1 - Math.floor(h1)) * sz * 0.8;
    const aa = (h2 - Math.floor(h2)) * 6.2832;
    const tw = 0.5 + 0.5 * Math.sin(t * 1.1 + k * 1.7 + ph);
    ctx.globalAlpha = a * (0.3 + 0.5 * tw);
    ctx.fillStyle = cap ? '#fff2c8' : `rgb(${lr},${lg},${lb})`;
    ctx.fillRect(px + Math.cos(aa) * rr - 0.6, py + Math.sin(aa) * rr - 0.6, 1.2, 1.2);
  }
  // ── СПУТНИКИ: 1–3 точки на круговой орбите, медленно облетают планету ──
  const moons = 1 + Math.round(dev * 2);            // развитее мир → больше спутников
  const orbR = sz * 1.7;                            // радиус орбиты спутника
  const spd = 0.22 + dev * 0.12;                    // медленный облёт (период ~20–30 с)
  for (let k = 0; k < moons; k++) {
    const aa = ph + k * (6.2832 / moons) + t * spd * (k % 2 ? -1 : 1);  // соседние — встречь
    const mx = px + Math.cos(aa) * orbR, my = py + Math.sin(aa) * orbR * 0.6;  // лёгкий наклон орбиты
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = cap ? '#ffe7a8' : `rgb(${lr},${lg},${lb})`;
    ctx.beginPath(); ctx.arc(mx, my, 1.5, 0, 6.2832); ctx.fill();
  }
  // ── ПОСТРОЙКО-ТОЧНЫЕ эффекты (только свои колонии: есть bld) ──
  if (bld) gmmColonySpecials(ctx, px, py, sz, bld, ph, a, t);
  ctx.globalAlpha = 1;
}

// Спецэффекты своих колоний по типам построек (дёшево: без аллокаций градиентов).
// • Научный институт → расходящийся кольцевой импульс-сонар.
// • Центр подготовки → патрульная эскадра: 2–3 точки на строгой круговой орбите.
// • Центр спецслужб → редкий тусклый быстрый маркер, уходящий в космос (агент).
function gmmColonySpecials(ctx, px, py, sz, bld, ph, a, t) {
  // сонар науки
  if (bld.science) {
    const u = (t / 5 + ph) % 1;                       // импульс раз в ~5 с
    const sr = sz * 1.4 + u * sz * 4.5;
    ctx.globalAlpha = a * (1 - u) * 0.5;
    ctx.strokeStyle = 'rgb(120,210,240)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(px, py, sr, 0, 6.2832); ctx.stroke();
  }
  // патрульная эскадра
  if (bld.training) {
    const n = bld.training > 2 ? 3 : 2, pr = sz * 1.32;
    ctx.fillStyle = 'rgb(176,196,222)';
    for (let k = 0; k < n; k++) {
      const aa = ph * 2 + k * (6.2832 / n) + t * 0.55;  // строгая, чуть быстрее гражданских
      ctx.globalAlpha = a * 0.9;
      ctx.fillRect(px + Math.cos(aa) * pr - 0.9, py + Math.sin(aa) * pr - 0.9, 1.8, 1.8);
    }
  }
  // теневой запуск спецслужб
  if (bld.intel) {
    const period = 9, cyc = Math.floor(t / period + ph);
    const u = (t / period + ph) - cyc;
    if (u < 0.22) {
      const k = u / 0.22;
      const hh = Math.sin(cyc * 12.9898 + ph * 4.1) * 43758.5453;
      const ang = (hh - Math.floor(hh)) * 6.2832;       // направление — своё каждый запуск
      const d = sz * 1.1 + k * sz * 6;
      ctx.globalAlpha = a * (1 - k) * 0.7;
      ctx.fillStyle = 'rgb(150,160,180)';
      ctx.fillRect(px + Math.cos(ang) * d - 0.7, py + Math.sin(ang) * d - 0.7, 1.4, 1.4);
    }
  }
}

// Внутрисистемный трафик между ближайшими колониями. Пары — по ближайшему
// соседу (ограничены по числу, чтобы не плодить связей через всю систему). Сама
// отрисовка — НЕ линия (см. ниже): линия читалась как чертёж, а не как космос.
function gmmSysTraffic(ctx, colPos, a, t) {
  const seen = new Set(), edges = [];
  for (let i = 0; i < colPos.length && edges.length < 5; i++) {
    let bj = -1, bd = Infinity;
    for (let j = 0; j < colPos.length; j++) {
      if (i === j) continue;
      const d = Math.hypot(colPos[i].px - colPos[j].px, colPos[i].py - colPos[j].py);
      if (d < bd) { bd = d; bj = j; }
    }
    if (bj < 0) continue;
    const key = i < bj ? i + '-' + bj : bj + '-' + i;
    if (seen.has(key)) continue; seen.add(key);
    edges.push([colPos[i], colPos[bj]]);
  }
  // БЕЗ линий-маршрутов (это читалось как чертёж). Вместо трассы — поток еле
  // заметных искорок: отдельные корабли ловят свет и медленно дрейфуют между
  // колониями. У потока есть ширина (боковой разброс), лёгкий изгиб траектории,
  // разнобой скоростей и затухание у планет — чтобы ощущалось как живое движение,
  // а не схема. Каждый «корабль» — крошечная мерцающая точка.
  edges.forEach(([A, B], i) => {
    const hx = B.px - A.px, hy = B.py - A.py, len = Math.hypot(hx, hy) || 1;
    const nx = -hy / len, ny = hx / len;            // нормаль к направлению
    const head = Math.atan2(hy, hx);                // курс «кораблика» (носом по ходу)
    const ships = 7;
    for (let k = 0; k < ships; k++) {
      const seed = i * 13.7 + k * 7.3;
      const sgn = Math.sin(seed) >= 0 ? 1 : -1;
      const lane = Math.sin(seed * 2.1) * len * 0.05;          // боковой разброс → поток шире линии
      const spd = 0.025 + Math.abs(Math.sin(seed * 1.7)) * 0.03; // у каждого своя скорость
      const u = (t * spd + Math.abs(Math.sin(seed))) % 1;
      const bow = Math.sin(u * Math.PI) * len * 0.09 * sgn;     // дуга — не прямая линейка
      const off = lane + bow;
      const px = A.px + hx * u + nx * off, py = A.py + hy * u + ny * off;
      const tw = 0.55 + 0.45 * Math.abs(Math.sin(t * 1.2 + seed)); // мерцание (с приподнятым дном)
      const fade = Math.min(1, Math.sin(u * Math.PI) * 1.6);    // появляется/гаснет у планет
      // треугольник-кораблик носом по курсу: матовый ореол + плотное ядро
      ctx.save();
      ctx.translate(px, py); ctx.rotate(head);
      ctx.globalAlpha = a * 0.32 * tw * fade;
      ctx.fillStyle = 'rgb(150,185,235)';
      gmmTri(ctx, 3.2);
      ctx.globalAlpha = a * 0.95 * tw * fade;
      ctx.fillStyle = '#e6f0ff';
      gmmTri(ctx, 1.9);
      ctx.restore();
    }
  });
  ctx.globalAlpha = 1;
}
// Треугольник-«кораблик» в локальных координатах, носом в сторону +X (длина ~2s).
function gmmTri(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(s, 0);                 // нос
  ctx.lineTo(-s * 0.75, s * 0.7);   // корма
  ctx.lineTo(-s * 0.75, -s * 0.7);
  ctx.closePath();
  ctx.fill();
}

// ТРАФИК ИМПЕРИИ: караваны летят по гиперпутям вдоль реальных торговых маршрутов
// (GMM.caravans). Кораблики идут с постоянной мировой скоростью (длинный маршрут
// не быстрее короткого), носом по ходу, в цвете фракции-отправителя. Виден, как
// только читаются сами гиперпути; рисуется в экранных координатах, как орбиты.
function gmmPaintLaneTraffic(ctx) {
  const a = gmmLaneA();
  if (a <= 0.01 || !GMM.caravans || !GMM.caravans.length) return;
  const s = GMM.s, tx = GMM.tx, ty = GMM.ty, t = performance.now() / 1000;
  const wx0 = -tx / s - 40, wy0 = -ty / s - 40, wx1 = (GMM.vw - tx) / s + 40, wy1 = (GMM.vh - ty) / s + 40;
  const V = 13;                         // мировых юнитов в секунду — общий темп каравана (неспешный)
  const sz = 3.0 + Math.min(3.6, s * 0.9);  // кораблик подрастает с зумом, но в меру
  GMM.caravans.forEach((cv, ci) => {
    const dur = cv.total / V;            // время полного прохода маршрута
    const [r, g, b] = cv.col;
    const lr = Math.min(255, r + 70), lg = Math.min(255, g + 70), lb = Math.min(255, b + 70);
    for (let k = 0; k < cv.ships; k++) {
      const u = ((t / dur) + (k / cv.ships) + ci * 0.13) % 1;   // позиция вдоль ВСЕГО маршрута
      const dist = u * cv.total;
      // находим сегмент по накопленной длине
      let seg = cv.segs[0];
      for (let j = cv.segs.length - 1; j >= 0; j--) { if (dist >= cv.segs[j].acc) { seg = cv.segs[j]; break; } }
      const lu = Math.max(0, Math.min(1, (dist - seg.acc) / (seg.len || 1)));
      const p = gmmBezPt(seg.g, lu);
      if (p.x < wx0 || p.x > wx1 || p.y < wy0 || p.y > wy1) continue;   // вне кадра
      const px = p.x * s + tx, py = gmmTY(p.y * s + ty);
      ctx.save();
      ctx.translate(px, py); ctx.rotate(p.ang);
      ctx.globalAlpha = a * 0.45;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      gmmTri(ctx, sz * 1.8);            // матовый ореол
      ctx.globalAlpha = a * 0.95;
      ctx.fillStyle = `rgb(${lr},${lg},${lb})`;
      gmmTri(ctx, sz);                  // плотное ядро
      ctx.restore();
    }
  });
  ctx.globalAlpha = 1;
}

// ── Офскрин-битмап мира ─────────────────────────────────────
// Сменился ли ЗУМ настолько, что битмап надо пере-печь (мыло/переход обзор↔системы)?
// Чистый пан сюда НЕ попадает — его покрытие держит живой слой территорий.
function gmmZoomChanged() {
  const b = GMM.bmp;
  if (!b) return true;
  const ratio = GMM.s / b.camS;
  return ratio > 1.45 || ratio < 0.62 || Math.abs(gmmZoomT(GMM.s) - gmmZoomT(b.camS)) > 0.06;
}
function gmmNeedRaster() {
  const b = GMM.bmp;
  if (!b) return !!GMM.paths;
  const ratio = GMM.s / b.camS;
  if (ratio > 1.45 || ratio < 0.62) return true;        // зум ушёл — битмап мыльный/тяжёлый
  if (Math.abs(gmmZoomT(GMM.s) - gmmZoomT(b.camS)) > 0.06) return true;   // идём сквозь переход обзор↔системы — освежаем кадры
  const vx0 = -GMM.tx / GMM.s, vy0 = -GMM.ty / GMM.s;
  const vx1 = (GMM.vw - GMM.tx) / GMM.s, vy1 = (GMM.vh - GMM.ty) / GMM.s;
  const bx1 = b.wx + b.pw / b.scale, by1 = b.wy + b.ph / b.scale;
  if (vx0 < b.wx - 2 && b.wx > 1) return true;          // выехали за покрытие (и там есть мир)
  if (vy0 < b.wy - 2 && b.wy > 1) return true;
  if (vx1 > bx1 + 2 && bx1 < GM_W - 1) return true;
  if (vy1 > by1 + 2 && by1 < GM_H - 1) return true;
  return false;
}
function gmmRasterSoon() {
  if (GMM.rasterT) clearTimeout(GMM.rasterT);   // debounce: чистый растр только после паузы в движении
  GMM.rasterT = setTimeout(gmmRaster, 90);
}
function gmmRaster(quality) {
  if (GMM.rasterT) { clearTimeout(GMM.rasterT); GMM.rasterT = 0; }
  if (!GMM.active || !GMM.cv || !GMM.cv.isConnected) return;
  if (!GMM.paths) gmmBuildWorld();
  const q = quality || 1;   // <1 — дешёвый низкоразрешённый растр во время жеста
  const s = GMM.s, dpr = GMM.dpr;
  // мировое окно: видимая область + запас вокруг. По вертикали запас больше: на
  // глубоком зуме плоскость заваливается (сжимается ×0.5 к центру), поэтому чтобы
  // битмап и после сжатия крыл весь экран, по Y нужно покрытие шире, чем по X.
  const padX = GMM.vw * 0.6, padY = GMM.vh * 0.9;
  const wx0 = Math.max(0, (-GMM.tx - padX) / s), wy0 = Math.max(0, (-GMM.ty - padY) / s);
  const wx1 = Math.min(GM_W, (GMM.vw - GMM.tx + padX) / s), wy1 = Math.min(GM_H, (GMM.vh - GMM.ty + padY) / s);
  if (wx1 <= wx0 || wy1 <= wy0) return;
  let bs = s * dpr * q;
  // бюджет растра: не больше 4096 по стороне и ~8.5 Мпикс суммарно
  const rawW = (wx1 - wx0) * bs, rawH = (wy1 - wy0) * bs;
  bs *= Math.min(1, 4096 / rawW, 4096 / rawH, Math.sqrt(8.5e6 / (rawW * rawH)));
  const pw = Math.max(1, Math.ceil((wx1 - wx0) * bs)), ph = Math.max(1, Math.ceil((wy1 - wy0) * bs));
  let b = GMM.bmp;
  if (!b) b = GMM.bmp = { cv: document.createElement('canvas') };
  if (b.cv.width !== pw || b.cv.height !== ph) { b.cv.width = pw; b.cv.height = ph; }
  const c2 = b.cv.getContext('2d');
  c2.setTransform(1, 0, 0, 1, 0, 0);
  c2.clearRect(0, 0, pw, ph);
  c2.setTransform(bs, 0, 0, bs, -wx0 * bs, -wy0 * bs);
  gmmPaint(c2, s, wx0, wy0, wx1, wy1);
  Object.assign(b, { wx: wx0, wy: wy0, scale: bs, pw, ph, camS: s });
  GMM.lastRaster = performance.now();
  GMM.dirty = true; gmmKick();
}

// ── Кэш Path2D мира (пересобирается при смене данных) ───────
function gmmBuildWorld() {
  const geo = gmBuildGeo();
  const dOf = (pts, close) => 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + (close ? 'Z' : '');
  // заливки, сгруппированные по цвету (фракция = один Path2D из всех её ячеек)
  const fillD = new Map();
  const econD = new Map();   // те же ячейки, но цвет = просперити системы (режим «бедность»)
  const facD = new Map();    // фракция → { d, color, bbox } для наложения флага на территорию
  geo.fills.forEach(f => {
    const color = f.isRift ? 'rgba(14,2,24,.8)' : (f.fac ? f.fac.color : 'rgba(120,140,170,0.04)');
    const d = dOf(f.pts, true);
    fillD.set(color, (fillD.get(color) || '') + d);
    if (!f.isRift && f.sys) { const ec = gmEconFill(f.sys); econD.set(ec, (econD.get(ec) || '') + d); }
    if (!f.isRift && f.fac && f.fac.id) {
      let e = facD.get(f.fac.id);
      if (!e) { e = { d: '', color: f.fac.color, x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }; facD.set(f.fac.id, e); }
      e.d += d;
      for (const p of f.pts) {
        if (p[0] < e.x0) e.x0 = p[0]; if (p[0] > e.x1) e.x1 = p[0];
        if (p[1] < e.y0) e.y0 = p[1]; if (p[1] > e.y1) e.y1 = p[1];
      }
    }
  });
  // туман — единый путь по всем ячейкам пустоты (без швов: один Path2D)
  const fogD = (geo.fog || []).map(pts => dOf(pts, true)).join('');
  // подложки территорий секторов по цвету
  const secFillD = new Map();
  (geo.secFills || []).forEach(f => secFillD.set(f.color, (secFillD.get(f.color) || '') + dOf(f.pts, true)));
  // области секторов по id — для попадания тапом (union ячеек сектора)
  const secHitD = new Map();
  (geo.secFills || []).forEach(f => { if (f.secId) secHitD.set(f.secId, (secHitD.get(f.secId) || '') + dOf(f.pts, true)); });
  // границы: цветные (фракции/фронты) по цвету, нейтральные и разлом — отдельно.
  // teethD — «зубцы» оборонной границы: маленькие ЗАЛИВНЫЕ треугольные клинья,
  // основанием на линии, остриём ВНУТРЬ территории (по нормали e.nrm) — пилообразный
  // крепостной рубеж. Геометрия в мировых единицах, печётся в Path2D (fill).
  const edgeD = new Map(); let neutralD = '', riftD = '';
  const teethD = new Map(), TOOTH_GAP = 12;          // шаг между клиньями (реже)
  const TBASE = [3.4, 2.0], TH = [2.8, 1.6];          // [крупный, мелкий] основание/высота — чередуются
  geo.edges.forEach(e => {
    const d = dOf(e.pts);
    if (e.kind === 'neutral') neutralD += d;
    else if (e.kind === 'rift') riftD += d;
    else {
      edgeD.set(e.color, (edgeD.get(e.color) || '') + d);
      if (e.nrm) {                                    // нарастить клинья вдоль ломаной по длине дуги
        let td = teethD.get(e.color) || '';
        // nrm смотрит ВНУТРЬ территории → клинья всегда остриём НАРУЖУ (-nrm). На
        // ФРОНТЕ две линии держав рядом; чтобы встречные шипы не били «лоб в лоб», их
        // фазы сдвинуты (e.phase) — зубцы входят в шахмат, между зубцами соседа.
        const nx = -e.nrm[0], ny = -e.nrm[1], pts = e.pts;
        let dist = 0, next = TOOTH_GAP * (0.5 + (e.phase || 0)), ti = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1];
          const segLen = Math.hypot(bx - ax, by - ay);
          if (segLen <= 1e-3) continue;
          const ux = (bx - ax) / segLen, uy = (by - ay) / segLen;
          while (next <= dist + segLen) {
            const t = next - dist, px = ax + ux * t, py = ay + uy * t;
            const k = ti & 1, hb = TBASE[k] / 2, h = TH[k];   // поочерёдно крупный/мелкий клин
            const b1x = px - ux * hb, b1y = py - uy * hb, b2x = px + ux * hb, b2y = py + uy * hb;
            const apx = px + nx * h, apy = py + ny * h;        // остриём ВНУТРЬ своей территории (иначе на фронте зубцы двух держав утыкаются друг в друга)
            td += `M${b1x.toFixed(1)},${b1y.toFixed(1)}L${b2x.toFixed(1)},${b2y.toFixed(1)}L${apx.toFixed(1)},${apy.toFixed(1)}Z`;
            next += TOOTH_GAP; ti++;
          }
          dist += segLen;
        }
        teethD.set(e.color, td);
      }
    }
  });
  let lanesD = '';
  GMM.laneGeo = new Map();   // "a|b"/"b|a" → кривая гиперпути (для трафика караванов)
  geo.lanes.forEach(L => {
    lanesD += `M${L.ax},${L.ay} Q${L.cx},${L.cy} ${L.bx},${L.by}`;
    if (L.a_id && L.b_id) {
      GMM.laneGeo.set(L.a_id + '|' + L.b_id, { ax: L.ax, ay: L.ay, cx: L.cx, cy: L.cy, bx: L.bx, by: L.by });
      GMM.laneGeo.set(L.b_id + '|' + L.a_id, { ax: L.bx, ay: L.by, cx: L.cx, cy: L.cy, bx: L.ax, by: L.ay });
    }
  });
  // границы секторов, сгруппированные по цвету (для пунктира)
  const secD = new Map();
  (geo.secEdges || []).forEach(e => secD.set(e.color, (secD.get(e.color) || '') + dOf(e.pts)));
  GMM.paths = {
    fills: [...fillD].map(([color, d]) => ({ color, p2d: new Path2D(d) })),
    facFills: [...facD].map(([fid, e]) => ({
      fid, color: e.color, p2d: new Path2D(e.d),
      bx: e.x0, by: e.y0, bw: Math.max(1, e.x1 - e.x0), bh: Math.max(1, e.y1 - e.y0),
    })),
    econFills: [...econD].map(([color, d]) => ({ color, p2d: new Path2D(d) })),
    fogPath: fogD ? new Path2D(fogD) : null,
    secFills: [...secFillD].map(([color, d]) => ({ color, p2d: new Path2D(d) })),
    edges: [...edgeD].map(([color, d]) => ({ color, p2d: new Path2D(d) })),
    teeth: [...teethD].filter(([, d]) => d).map(([color, d]) => ({ color, p2d: new Path2D(d) })),
    neutral: neutralD ? new Path2D(neutralD) : null,
    rift: riftD ? new Path2D(riftD) : null,
    lanes: lanesD ? new Path2D(lanesD) : null,
    secEdges: [...secD].map(([color, d]) => ({ color, p2d: new Path2D(d) })),
    secLabels: geo.secLabels || [],
    secHit: [...secHitD].map(([secId, d]) => ({ secId, p2d: new Path2D(d) })),
  };
  gmmBuildCaravans();
  gmmBuildSalvos();
  gmmBuildDefense();
}

// Караваны торговых маршрутов: для каждого активного trade_route считаем путь по
// гиперпутям (BFS, как ecPath) и собираем ломаную из кривых-сегментов (та же
// геометрия, что у нарисованных гиперпутей). По ней потом «летят» кораблики.
function gmmBuildCaravans() {
  GMM.caravans = [];
  if (!GM.routes || !GM.routes.length || !GMM.laneGeo) return;
  const adj = {};
  GM.lanes.forEach(l => { (adj[l.a_id] = adj[l.a_id] || []).push(l.b_id); (adj[l.b_id] = adj[l.b_id] || []).push(l.a_id); });
  const bfs = (from, to) => {
    if (!from || !to || from === to) return null;
    const q = [from], prev = { [from]: null }, seen = new Set([from]);
    while (q.length) {
      const c = q.shift();
      if (c === to) { const p = []; let n = to; while (n != null) { p.unshift(n); n = prev[n]; } return p; }
      (adj[c] || []).forEach(nb => { if (!seen.has(nb)) { seen.add(nb); prev[nb] = c; q.push(nb); } });
    }
    return null;
  };
  GM.routes.forEach(r => {
    const path = bfs(r.origin_sys, r.dest_sys);
    if (!path || path.length < 2) return;
    const segs = []; let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const g = GMM.laneGeo.get(path[i] + '|' + path[i + 1]);
      if (!g) continue;
      // длина кривой — грубо по контрольной ломаной (достаточно для развесовки скорости)
      const len = Math.hypot(g.cx - g.ax, g.cy - g.ay) + Math.hypot(g.bx - g.cx, g.by - g.cy);
      segs.push({ g, len, acc: total }); total += len;
    }
    if (!segs.length || total <= 0) return;
    const fac = gmFaction(r.a_fid);
    const col = fac ? gmRgb(fac.color) : [180, 210, 245];
    GMM.caravans.push({ segs, total, col, ships: Math.max(1, Math.min(3, (r.convoy || 0) + 1)) });
  });
}

// ── Межзвёздная артиллерия: залпы «Длани Неотвратимости» в полёте ──
// Снаряд летит через космос из системы-источника в систему-цель ДУГОЙ (а не по
// гиперпутям — это оружие судного дня, ему не нужны торговые пути). Изгиб дуги —
// всегда в ОДНУ сторону от направления полёта, поэтому встречный залп (B→A)
// выгибается в противоположную: размен идёт по двум разнесённым дугам, а не по
// одной прямой «каше». Позиция вдоль траектории — по РЕАЛЬНОМУ времени полёта
// (launched_at → ready_at), видно, как близко снаряд подошёл к обречённой планете.
// Цвет луча/снаряда — фракции-стрелка (кто бьёт), прицел на цели — красный (смерть).
function gmmBuildSalvos() {
  GMM.salvos = [];
  if (!GM.salvos || !GM.salvos.length) return;
  const byId = Object.fromEntries((GM.systems || []).map(s => [s.id, s]));
  GM.salvos.forEach(s => {
    const tgt = byId[s.target_system_id];
    if (!tgt) return;                         // цель не на карте — нечего рисовать
    const ori = byId[s.origin_system_id];     // источник может быть неизвестен/вне карты
    const la = s.launched_at ? Date.parse(s.launched_at) : null;
    const ra = s.ready_at ? Date.parse(s.ready_at) : null;
    const fac = gmFaction(s.faction_id);
    const col = fac ? gmRgb(fac.color) : [255, 96, 48];   // цвет стрелка (нет → тревожный красно-оранж)
    // имя стрелка для подписи «кто → во что» (анкета — самый надёжный источник имени)
    const aName = (GM.facMeta && GM.facMeta[s.faction_id] && GM.facMeta[s.faction_id].name)
      || (fac && fac.name) || 'Неизвестно';
    let g = null;                                          // квадратичная Безье дуги {ax,ay,cx,cy,bx,by}
    if (ori) {
      const ax = ori.x, ay = ori.y, bx = tgt.x, by = tgt.y;
      const dxv = bx - ax, dyv = by - ay, len = Math.hypot(dxv, dyv) || 1;
      const nx = -dyv / len, ny = dxv / len;              // левая нормаль направления полёта (знак привязан к направлению → встречный залп выгнется зеркально)
      const bow = Math.max(60, Math.min(560, len * 0.16));
      g = { ax, ay, cx: (ax + bx) / 2 + nx * bow, cy: (ay + by) / 2 + ny * bow, bx, by };
    }
    GMM.salvos.push({ g, sys: tgt, dx: tgt.x, dy: tgt.y, la, ra, col,
      attacker: aName, planet: s.target_planet || '' });
  });
}

// Рисует залпы поверх карты — минималистично, в языке самой карты (как трафик
// караванов + кольцо выделения системы). Никаких плашек/перекрестий:
//  • тонкая дуга-трасса в цвете фракции-стрелка (бледная впереди, светится позади);
//  • маленькая бело-горячая искра-снаряд скользит по дуге (масштаб как у караванов);
//  • цель помечена красным пунктирным кольцом вокруг звезды — тем же стилем, что и
//    кольцо выбранной системы (gmmBlit), только красным и с лёгким пульсом.
// Кто в кого бьёт — читается по тому, ИЗ ЧЬЕЙ звезды и каким цветом выходит дуга.
function gmmPaintSalvos(ctx) {
  if (!GMM.salvos || !GMM.salvos.length) return;
  const s = GMM.s, t = performance.now() / 1000, now = Date.now();
  const SX = wx => wx * s + GMM.tx;          // мир→экран X
  const SY = wy => gmmTY(wy * s + GMM.ty);   // мир→экран Y (с наклоном плоскости)
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  GMM.salvos.forEach(sv => {
    // прогресс полёта по реальному времени (если меток нет — считаем на полпути)
    let u = 0.5;
    if (sv.la != null && sv.ra != null && sv.ra > sv.la) u = (now - sv.la) / (sv.ra - sv.la);
    u = Math.max(0, Math.min(1, u));
    const [r, gg, b] = sv.col;
    const lr = Math.min(255, r + 110), lg = Math.min(255, gg + 110), lb = Math.min(255, b + 110);
    const tX = SX(sv.dx), tY = SY(sv.dy);

    if (sv.g) {
      const N = 28, pts = [];
      for (let i = 0; i <= N; i++) { const p = gmmBezPt(sv.g, i / N); pts.push([SX(p.x), SY(p.y)]); }
      const iCur = Math.max(0, Math.min(N, Math.ceil(u * N)));
      const seg = (from, to) => {
        if (to < from) return;
        ctx.beginPath(); ctx.moveTo(pts[from][0], pts[from][1]);
        for (let i = from + 1; i <= to; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      };
      // впереди снаряда — лёгкая бледная трасса (куда летит). Позади — светящийся
      // след с мягким glow (виден и на красной территории за счёт высветления+bloom).
      ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(${lr},${lg},${lb},0.22)`; ctx.lineWidth = 1.1; seg(iCur, N);
      ctx.shadowColor = `rgba(${lr},${lg},${lb},0.7)`; ctx.shadowBlur = 5;
      ctx.strokeStyle = `rgba(${lr},${lg},${lb},0.55)`; ctx.lineWidth = 1.5; seg(0, iCur);
      ctx.shadowBlur = 0;

      // снаряд — маленькая бело-горячая искра с короткой кометной чёрточкой по ходу
      const head = gmmBezPt(sv.g, u), hX = SX(head.x), hY = SY(head.y);
      const back = gmmBezPt(sv.g, Math.max(0, u - 0.03));
      const ang = Math.atan2(hY - SY(back.y), hX - SX(back.x));
      const sz = 2.6 + Math.min(3.2, s * 0.9);   // как у каравана — мелкая искра
      ctx.save();
      ctx.translate(hX, hY); ctx.rotate(ang);
      const tg = ctx.createLinearGradient(-sz * 5, 0, sz, 0);   // короткий хвост-чёрточка
      tg.addColorStop(0, `rgba(${lr},${lg},${lb},0)`);
      tg.addColorStop(1, 'rgba(255,250,238,0.95)');
      ctx.strokeStyle = tg; ctx.lineWidth = sz * 0.7;
      ctx.beginPath(); ctx.moveTo(-sz * 5, 0); ctx.lineTo(0, 0); ctx.stroke();
      ctx.shadowColor = `rgba(${lr},${lg},${lb},0.95)`; ctx.shadowBlur = 7;
      ctx.fillStyle = 'rgba(255,252,244,1)';
      ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * 0.62, 0, 0, 6.2832); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ЦЕЛЬ — красное пунктирное кольцо вокруг звезды, в стиле кольца выбора (gmmBlit):
    // эллипс с тем же сжатием по наклону плоскости (deepA), лёгкий пульс + бег пунктира.
    if (tX > -60 && tX < GMM.vw + 60 && tY > -60 && tY < GMM.vh + 60) {
      const pulse = 0.6 + 0.4 * Math.sin(t * 2.2);
      const R = (sv.sys ? gmmIconPx(sv.sys, s) * 0.62 : 10) + 8;
      const ry = R * (1 - 0.5 * gmmDeepA());
      ctx.setLineDash([5, 4]); ctx.lineDashOffset = -t * 7;
      ctx.strokeStyle = `rgba(255,80,60,${0.85 * pulse})`; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(tX, tY, R, ry, 0, 0, 6.2832); ctx.stroke();
      ctx.setLineDash([]);
    }
  });
  ctx.restore();
}

// ── Оборона: минные поля (гекс-кольцо) + аванпосты + корабли-носители ─────────
// Данные: minefields_visible()/outposts_visible() (свои + разведанные чужие) и
// outpost_ships_mine() (МОИ корабли-носители — idle и в полёте). На карте — в
// языке самой карты (как кольцо выбора/трафик), цвет = фракция владельца.
//  • минное поле   → кольцо из hex_max гексов под звездой; первые `hexes` залиты
//    (застроено минами), остальные — пустой контур. Видно, как поле растёт.
//  • аванпост      → станция-ромб с антенной над звездой.
//  • корабль idle  → значок носителя у звезды его системы.
//  • корабль летит → носитель скользит по гиперпути from→dest (позиция по времени).
function gmmBuildDefense() {
  GMM.defense = { mines: [], outposts: [], ships: [] };
  const byId = Object.fromEntries((GM.systems || []).map(s => [s.id, s]));
  // минные поля → лукап по планете (system_id|pid) для гекс-кольца на глубоком зуме
  // + агрегат по (система, фракция) для компактного значка на дальнем зуме.
  GM.minefieldByPid = {};
  const mAgg = new Map();
  (GM.minefields || []).forEach(m => {
    const sys = byId[m.system_id]; if (!sys) return;
    const fac = gmFaction(m.faction_id);
    const col = fac ? gmRgb(fac.color) : [220, 90, 70];
    if (m.planet_pid != null) {
      GM.minefieldByPid[m.system_id + '|' + m.planet_pid] = {
        hexes: +m.hexes || 0, hexMax: +m.hex_max || 6, mine: !!m.mine, col, faction_id: m.faction_id,
      };
    }
    const key = m.system_id + '|' + m.faction_id;
    let e = mAgg.get(key);
    if (!e) { e = { sys, fid: m.faction_id, mine: !!m.mine, hexes: 0, hexMax: +m.hex_max || 6 }; mAgg.set(key, e); }
    e.hexes += (+m.hexes || 0);
    e.hexMax = Math.max(e.hexMax, +m.hex_max || 6);
    e.mine = e.mine || !!m.mine;
  });
  mAgg.forEach(e => {
    const fac = gmFaction(e.fid);
    const col = fac ? gmRgb(fac.color) : [220, 90, 70];   // нет фракции → тревожный красный
    GMM.defense.mines.push({ sys: e.sys, col, hexes: Math.min(e.hexes, e.hexMax), hexMax: e.hexMax, mine: e.mine });
  });
  // развёрнутые аванпосты: по одному значку на (система, фракция).
  (GM.outposts || []).forEach(o => {
    const sys = byId[o.system_id]; if (!sys) return;
    const fac = gmFaction(o.faction_id);
    const col = fac ? gmRgb(fac.color) : [150, 200, 245];
    GMM.defense.outposts.push({ sys, col, mine: !!o.mine });
  });
  // мои корабли-носители аванпостов. Цвет — моей фракции.
  const myFac = GM.myFid ? gmFaction(GM.myFid) : null;
  const myCol = myFac ? gmRgb(myFac.color) : [150, 210, 255];
  if ((GM.opShips || []).length || (GM.mzaShips || []).length) {
    // граф гиперпутей для прокладки маршрута летящих кораблей (как у караванов)
    const adj = {};
    GM.lanes.forEach(l => { (adj[l.a_id] = adj[l.a_id] || []).push(l.b_id); (adj[l.b_id] = adj[l.b_id] || []).push(l.a_id); });
    const bfs = (from, to) => {
      if (!from || !to || from === to) return null;
      const q = [from], prev = { [from]: null }, seen = new Set([from]);
      while (q.length) {
        const c = q.shift();
        if (c === to) { const p = []; let n = to; while (n != null) { p.unshift(n); n = prev[n]; } return p; }
        (adj[c] || []).forEach(nb => { if (!seen.has(nb)) { seen.add(nb); prev[nb] = c; q.push(nb); } });
      }
      return null;
    };
    // единый расклад носителя на карту: idle у звезды / transit по гиперпути.
    // `extra` навешивает спец-поля (для Гиперпейсер: mza/canFire/integrity).
    const pushShip = (sh, extra) => {
      if (sh.status === 'idle' && sh.system_id) {
        const sys = byId[sh.system_id]; if (!sys) return;
        GMM.defense.ships.push(Object.assign({ kind: 'idle', sys, col: myCol, id: sh.id, name: sh.name }, extra));
        return;
      }
      if (sh.status === 'transit' && sh.from_sys && sh.dest_sys) {
        const a = byId[sh.from_sys], b = byId[sh.dest_sys];
        if (!a || !b) return;
        const la = sh.depart_at ? Date.parse(sh.depart_at) : null;
        const ra = sh.arrive_at ? Date.parse(sh.arrive_at) : null;
        // путь по гиперпутям; если связного маршрута нет — прямая дуга (как у залпа)
        const path = (GMM.laneGeo && bfs(sh.from_sys, sh.dest_sys)) || null;
        let segs = null, total = 0, g = null;
        if (path && path.length >= 2) {
          segs = [];
          for (let i = 0; i < path.length - 1; i++) {
            const gg = GMM.laneGeo.get(path[i] + '|' + path[i + 1]); if (!gg) continue;
            const len = Math.hypot(gg.cx - gg.ax, gg.cy - gg.ay) + Math.hypot(gg.bx - gg.cx, gg.by - gg.cy);
            segs.push({ g: gg, len, acc: total }); total += len;
          }
          if (!segs.length || total <= 0) segs = null;
        }
        if (!segs) {                                    // прямая дуга from→dest
          const dxv = b.x - a.x, dyv = b.y - a.y, len = Math.hypot(dxv, dyv) || 1;
          const nx = -dyv / len, ny = dxv / len, bow = Math.max(40, Math.min(360, len * 0.14));
          g = { ax: a.x, ay: a.y, cx: (a.x + b.x) / 2 + nx * bow, cy: (a.y + b.y) / 2 + ny * bow, bx: b.x, by: b.y };
        }
        GMM.defense.ships.push(Object.assign({ kind: 'transit', segs, total, g, dest: b, col: myCol, la, ra }, extra));
      }
    };
    (GM.opShips || []).forEach(sh => pushShip(sh, { canDeploy: !!sh.can_deploy }));
    // Гиперпейсер — мобильные «Длани»: красный отблеск + флаг возможности залпа.
    const mzaCol = [225, 70, 55];
    (GM.mzaShips || []).forEach(sh => pushShip(sh, { mza: true, col: mzaCol, canFire: !!sh.can_fire, integrity: +sh.integrity || 0 }));
  }
}

// Минные ГЕКСЫ вокруг конкретной планеты (глубокий зум). Полный круг из hexMax
// гексов; первые `hexes` залиты (мины стоят). У СВОЕЙ колонии пустые гексы рисуем
// пунктиром и регистрируем как клик-зоны (GMM.mineHex) — клик кладёт/снимает гекс.
// У чужого поля показываем только залитые гексы (разведка), без клика.
function gmmPlanetMineHexes(ctx, px, py, sz, TILT, a, p, sys) {
  const mf = (GM.minefieldByPid || {})[sys.id + '|' + p.pid];
  const mineable = !!(p.faction_id && GM.myFid && p.faction_id === GM.myFid);
  if (!mineable && !mf) return;
  const hexMax = mf ? mf.hexMax : 6;
  const hexes = mf ? Math.min(mf.hexes, hexMax) : 0;
  const myFac = GM.myFid ? gmFaction(GM.myFid) : null;
  const col = mf ? mf.col : (myFac ? gmRgb(myFac.color) : [150, 210, 255]);
  const [r, g, b] = col;
  const R = sz * 2.7, hr = Math.max(2, sz * 0.52);
  ctx.save(); ctx.lineJoin = 'round';
  for (let i = 0; i < hexMax; i++) {
    const ang = -Math.PI / 2 + i * (2 * Math.PI / hexMax);
    const hx = px + Math.cos(ang) * R, hy = py + Math.sin(ang) * R * TILT;
    const filled = i < hexes;
    if (!filled && !mineable) continue;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const aa = Math.PI / 6 + k * Math.PI / 3;
      const qx = hx + Math.cos(aa) * hr, qy = hy + Math.sin(aa) * hr * TILT;
      if (k === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
    }
    ctx.closePath();
    if (filled) {
      ctx.globalAlpha = a; ctx.fillStyle = `rgba(${r},${g},${b},0.5)`; ctx.fill();
      ctx.strokeStyle = `rgba(${Math.min(255, r + 80)},${Math.min(255, g + 80)},${Math.min(255, b + 80)},0.9)`;
      ctx.lineWidth = Math.max(0.6, hr * 0.16); ctx.stroke();
    } else {
      ctx.globalAlpha = a * 0.6; ctx.setLineDash([3, 3]);
      ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`; ctx.lineWidth = Math.max(0.5, hr * 0.14); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    if (mineable) GMM.mineHex.push({ x: hx, y: hy, r: hr * 1.15, sysId: sys.id, pid: p.pid, idx: i, filled });
  }
  ctx.restore();
}

// Кольцо минных гексов (КОМПАКТНОЕ, дальний зум): hexMax шестиугольников веером под
// звездой; первые `hexes` залиты. Используется, пока планеты ещё не раскрыты в орбиты.
function gmmMineRing(ctx, cx, cy, rad, sq, col, hexes, hexMax, a) {
  const n = Math.max(1, hexMax), R = rad * 2.3;           // радиус, на котором сидят мины
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i - (n - 1) / 2) * 0.6;    // веер снизу звезды
    const hx = cx + Math.cos(ang) * R, hy = cy + Math.sin(ang) * R * sq;
    gmmMineGlyph(ctx, hx, hy, rad, col, a, i < hexes);
  }
}

// Станция-аванпост: корпус-ромб с антенной-«тарелкой» и двумя солнечными панелями.
function gmmOutpostGlyph(ctx, x, y, rad, col, a) {
  const [r, g, b] = col;
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
  ctx.lineWidth = Math.max(0.8, rad * 0.2);
  ctx.beginPath(); ctx.moveTo(0, -rad * 0.5); ctx.lineTo(0, -rad * 1.55); ctx.stroke();
  ctx.fillStyle = `rgba(${Math.min(255, r + 70)},${Math.min(255, g + 70)},${Math.min(255, b + 70)},${a})`;
  ctx.beginPath(); ctx.arc(0, -rad * 1.55, rad * 0.26, 0, 6.2832); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-rad * 0.72, 0); ctx.lineTo(-rad * 1.45, 0);
  ctx.moveTo(rad * 0.72, 0); ctx.lineTo(rad * 1.45, 0);
  ctx.stroke();
  ctx.fillStyle = `rgba(${r},${g},${b},${a * 0.9})`;
  ctx.beginPath();
  ctx.moveTo(0, -rad * 0.6); ctx.lineTo(rad * 0.72, 0);
  ctx.lineTo(0, rad * 0.6); ctx.lineTo(-rad * 0.72, 0); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

// Корабль-носитель: гладкий «челнок» — стреловидный корпус с фонарём кабины,
// разнесёнными крыльями и двигательным свечением сзади (нос вперёд по ang).
function gmmCarrierGlyph(ctx, x, y, sz, col, a, ang) {
  const [r, g, b] = col;
  const lr = Math.min(255, r + 70), lg = Math.min(255, g + 70), lb = Math.min(255, b + 70);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // двигательное свечение за кормой
  const eg = ctx.createRadialGradient(-sz * 1.1, 0, 0, -sz * 1.1, 0, sz * 0.95);
  eg.addColorStop(0, `rgba(${lr},${lg},${lb},${0.9 * a})`);
  eg.addColorStop(1, `rgba(${lr},${lg},${lb},0)`);
  ctx.fillStyle = eg;
  ctx.beginPath(); ctx.arc(-sz * 1.1, 0, sz * 0.95, 0, 6.2832); ctx.fill();

  // крылья — две тонкие дельты по бортам
  ctx.fillStyle = `rgba(${r},${g},${b},${0.7 * a})`;
  ctx.beginPath();
  ctx.moveTo(-sz * 0.2, sz * 0.28); ctx.lineTo(-sz * 1.0, sz * 1.1); ctx.lineTo(-sz * 0.7, sz * 0.28);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-sz * 0.2, -sz * 0.28); ctx.lineTo(-sz * 1.0, -sz * 1.1); ctx.lineTo(-sz * 0.7, -sz * 0.28);
  ctx.closePath(); ctx.fill();

  // корпус — каплевидный, со скруглённым носом
  ctx.fillStyle = `rgba(${Math.min(255, r + 30)},${Math.min(255, g + 30)},${Math.min(255, b + 30)},${a})`;
  ctx.strokeStyle = `rgba(${lr},${lg},${lb},${a})`;
  ctx.lineWidth = Math.max(0.5, sz * 0.12);
  ctx.beginPath();
  ctx.moveTo(sz * 1.55, 0);                         // нос
  ctx.quadraticCurveTo(sz * 0.2, sz * 0.62, -sz * 1.0, sz * 0.34);   // правый борт
  ctx.quadraticCurveTo(-sz * 1.25, 0, -sz * 1.0, -sz * 0.34);        // корма
  ctx.quadraticCurveTo(sz * 0.2, -sz * 0.62, sz * 1.55, 0);          // левый борт
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // фонарь кабины — светлая капля ближе к носу
  ctx.fillStyle = `rgba(${Math.min(255, lr + 40)},${Math.min(255, lg + 40)},${Math.min(255, lb + 40)},${a})`;
  ctx.beginPath(); ctx.ellipse(sz * 0.45, 0, sz * 0.42, sz * 0.24, 0, 0, 6.2832); ctx.fill();
  ctx.restore();
}

// Морская/орбитальная мина: шарообразный корпус с короткими шипами-детонаторами.
// filled — установленная мина (залита), иначе — бледный контур «свободной ячейки».
function gmmMineGlyph(ctx, x, y, r, col, a, filled) {
  const [cr, cg, cb] = col;
  const lr = Math.min(255, cr + 80), lg = Math.min(255, cg + 80), lb = Math.min(255, cb + 80);
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const body = r * 0.62, spike = r * 0.95;
  // шипы
  ctx.strokeStyle = filled ? `rgba(${lr},${lg},${lb},${a})` : `rgba(${cr},${cg},${cb},${a * 0.6})`;
  ctx.lineWidth = Math.max(0.5, r * 0.16);
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const ang = k * Math.PI / 4;
    ctx.moveTo(Math.cos(ang) * body, Math.sin(ang) * body);
    ctx.lineTo(Math.cos(ang) * spike, Math.sin(ang) * spike);
  }
  ctx.stroke();
  // корпус
  if (filled) {
    const g = ctx.createRadialGradient(-body * 0.3, -body * 0.3, 0, 0, 0, body);
    g.addColorStop(0, `rgba(${lr},${lg},${lb},${a})`);
    g.addColorStop(1, `rgba(${cr},${cg},${cb},${a})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, body, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = `rgba(${lr},${lg},${lb},${a})`; ctx.lineWidth = Math.max(0.4, r * 0.12);
    ctx.beginPath(); ctx.arc(0, 0, body, 0, 6.2832); ctx.stroke();
  } else {
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${a * 0.55})`; ctx.lineWidth = Math.max(0.4, r * 0.13);
    ctx.beginPath(); ctx.arc(0, 0, body, 0, 6.2832); ctx.stroke();
  }
  ctx.restore();
}

// Точка на ломаной из сегментов-Безье по доле длины u∈[0,1] (как у караванов).
function gmmSegPt(segs, total, u) {
  const L = Math.max(0, Math.min(1, u)) * total;
  for (const seg of segs) {
    if (L <= seg.acc + seg.len || seg === segs[segs.length - 1]) {
      const lu = seg.len > 0 ? (L - seg.acc) / seg.len : 0;
      return gmmBezPt(seg.g, Math.max(0, Math.min(1, lu)));
    }
  }
  return gmmBezPt(segs[segs.length - 1].g, 1);
}

// Рисует оборонные значки поверх карты (как gmmPaintSalvos): экранные координаты
// с учётом наклона плоскости.
function gmmPaintDefense(ctx) {
  GMM.shipHit = [];                  // клик-зоны моих кораблей-носителей (idle)
  const D = GMM.defense;
  if (!D || (!D.mines.length && !D.outposts.length && !D.ships.length)) return;
  const s = GMM.s, sq = 1 - 0.5 * gmmDeepA(), deep = gmmDeepA() > 0.2, now = Date.now(), t = performance.now() / 1000;
  // Коэффициент размера значков по зуму: на обзоре/карте секторов звёзды — крошечные
  // точки, поэтому оборонные значки ужимаем (иначе они в разы крупнее самих систем);
  // при заходе в системы значки растут до полного размера.
  const zf = 0.5 + 0.5 * gmmZoomT(s);
  const SX = wx => wx * s + GMM.tx;
  const SY = wy => gmmTY(wy * s + GMM.ty);
  const onScreen = (x, y) => x > -60 && x < GMM.vw + 60 && y > -60 && y < GMM.vh + 60;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // ── Минные поля: КОМПАКТНОЕ кольцо гексов под звездой (только на дальнем зуме).
  // На глубоком зуме гексы рисуются вокруг самих планет в gmmPaintOrbits. ──
  if (!deep) D.mines.forEach(d => {
    const tX = SX(d.sys.x), tY = SY(d.sys.y);
    if (!onScreen(tX, tY)) return;
    const ip = gmmIconPx(d.sys, s);
    const R = ip * 0.62 + 6;
    const hr = Math.max(1.4, ip * 0.11) * zf;            // размер одной мины
    const a = d.mine ? 0.85 : 0.6;                       // чужие чуть бледнее
    gmmMineRing(ctx, tX, tY + R * 0.62 * sq, hr, sq, d.col, d.hexes, d.hexMax, a);
  });

  // ── Аванпосты: станция над звездой ──
  D.outposts.forEach(d => {
    const tX = SX(d.sys.x), tY = SY(d.sys.y);
    if (!onScreen(tX, tY)) return;
    const ip = gmmIconPx(d.sys, s);
    const R = ip * 0.62 + 6;
    gmmOutpostGlyph(ctx, tX, tY - R * 0.9 * sq, Math.max(2.5, ip * 0.2) * zf, d.col, d.mine ? 0.92 : 0.7);
  });

  // ── Корабли-носители: idle у звезды + летящие по гиперпути ──
  D.ships.forEach(d => {
    if (d.kind === 'idle') {
      const tX = SX(d.sys.x), tY = SY(d.sys.y);
      if (!onScreen(tX, tY)) return;
      const ip = gmmIconPx(d.sys, s);
      // крупнее и с подложкой — носитель должно быть видно и на глубоком зуме, где
      // рядом большая планета/корона звезды, и на дальнем у мелкого значка системы.
      const R = ip * 0.62 + 6, csz = Math.max(3.5, ip * 0.26) * zf;
      const cX = tX + R * 1.05, cY = tY - R * 0.7 * sq;
      const [cr, cg, cb] = d.col;
      const sel = GMM.opCmd && GMM.opCmd.id === d.id;
      const pulse = 0.6 + 0.4 * Math.sin(t * 3);
      // тёмный диск-подложка + светлое кольцо: читается на любом фоне (планета/пустота)
      ctx.save();
      ctx.beginPath(); ctx.arc(cX, cY, csz * 1.7, 0, 6.2832);
      ctx.fillStyle = 'rgba(8,14,24,0.74)'; ctx.fill();
      ctx.setLineDash(sel ? [4, 3] : []); ctx.lineDashOffset = -t * 8;
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = sel ? `rgba(150,225,255,${0.95 * pulse})`
        : `rgba(${Math.min(255, cr + 80)},${Math.min(255, cg + 80)},${Math.min(255, cb + 80)},0.92)`;
      ctx.beginPath(); ctx.arc(cX, cY, csz * 1.7, 0, 6.2832); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      gmmCarrierGlyph(ctx, cX, cY, csz, d.col, 1, -0.5);
      if (d.mza && d.canFire) {   // Гиперпейсер готова к залпу — оранжево-красная точка
        ctx.fillStyle = 'rgba(255,140,60,0.98)';
        ctx.beginPath(); ctx.arc(cX + csz * 1.55, cY - csz * 1.55, Math.max(2, csz * 0.42), 0, 6.2832); ctx.fill();
      } else if (!d.mza && d.canDeploy) {   // носитель аванпоста — «здесь можно развернуть» (зелёная точка)
        ctx.fillStyle = 'rgba(120,235,140,0.98)';
        ctx.beginPath(); ctx.arc(cX + csz * 1.55, cY - csz * 1.55, Math.max(2, csz * 0.42), 0, 6.2832); ctx.fill();
      }
      // подпись на глубоком зуме — чтобы носитель нельзя было не заметить
      if (deep) {
        ctx.save();
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 3;
        ctx.fillStyle = d.mza ? 'rgba(255,210,200,0.98)' : 'rgba(222,236,255,0.96)';
        const lbl = d.mza ? (d.canFire ? '☣ Гиперпейсер · залп' : '☣ Гиперпейсер') : (d.canDeploy ? '🚀 носитель · развернуть' : '🚀 носитель');
        ctx.fillText(lbl, cX, cY + csz * 1.95);
        ctx.restore();
      }
      GMM.shipHit.push({ x: cX, y: cY, r: Math.max(16, csz * 1.9), id: d.id, mza: !!d.mza });
      return;
    }
    // в полёте: позиция по реальному времени (нет меток → середина)
    let u = 0.5;
    if (d.la != null && d.ra != null && d.ra > d.la) u = (now - d.la) / (d.ra - d.la);
    u = Math.max(0, Math.min(1, u));
    const [r, g, b] = d.col;
    const lr = Math.min(255, r + 90), lg = Math.min(255, g + 90), lb = Math.min(255, b + 90);
    let pt, back;
    if (d.segs) { pt = gmmSegPt(d.segs, d.total, u); back = gmmSegPt(d.segs, d.total, Math.max(0, u - 0.02)); }
    else { pt = gmmBezPt(d.g, u); back = gmmBezPt(d.g, Math.max(0, u - 0.02)); }
    const hX = SX(pt.x), hY = SY(pt.y);
    // трасса до цели (тонкая, бледная)
    const drawTrace = (sampler) => {
      const N = 24; ctx.beginPath();
      for (let i = 0; i <= N; i++) { const p = sampler(i / N); const X = SX(p.x), Y = SY(p.y); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
      ctx.stroke();
    };
    ctx.setLineDash([4, 4]); ctx.lineDashOffset = -t * 6;
    ctx.strokeStyle = `rgba(${lr},${lg},${lb},0.3)`; ctx.lineWidth = 1.1;
    if (d.segs) drawTrace(uu => gmmSegPt(d.segs, d.total, uu)); else drawTrace(uu => gmmBezPt(d.g, uu));
    ctx.setLineDash([]);
    // сам носитель
    const ang = Math.atan2(SY(pt.y) - SY(back.y), SX(pt.x) - SX(back.x));
    if (onScreen(hX, hY)) gmmCarrierGlyph(ctx, hX, hY, Math.max(2.6, s * 1.1 + 2), d.col, 0.95, ang);
  });

  ctx.restore();
}

// Точка и касательная на квадратичной кривой Безье при параметре u∈[0,1].
function gmmBezPt(g, u) {
  const mu = 1 - u;
  const x = mu * mu * g.ax + 2 * mu * u * g.cx + u * u * g.bx;
  const y = mu * mu * g.ay + 2 * mu * u * g.cy + u * u * g.by;
  const dx = 2 * mu * (g.cx - g.ax) + 2 * u * (g.bx - g.cx);
  const dy = 2 * mu * (g.cy - g.ay) + 2 * u * (g.by - g.cy);
  return { x, y, ang: Math.atan2(dy, dx) };
}

// ── Отрисовка мира в произвольный контекст (transform уже мировой) ──
// camS — экранный масштаб: толщины линий/шрифты задаются в px и делятся на него
// Космический фон: база + туманности + детерминированная звёздная россыпь + рамка
// галактики. Вынесено отдельно, потому что рисуется в ДВУХ местах: запекается в
// битмап (gmmPaint) и рисуется живьём во весь экран позади наклонённой плоскости
// (gmmBlit) — иначе при завале (ky<1) у края галактики зияли бы чёрные полосы.
// stars=false — лёгкий вариант (без звёздной россыпи) для живого фона каждый кадр;
// по умолчанию — полный (запекается в битмап).
function gmmPaintSpace(ctx, camS, wx0, wy0, wx1, wy1, stars) {
  ctx.fillStyle = '#05060b';
  ctx.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
  GMM_NEBULAE.forEach(([px, py, pr, c, a]) => {
    const cx = px * GM_W, cy = py * GM_H, R = pr * GM_W;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, `rgba(${c},${a})`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  });
  if (stars !== false) gmmPaintStarfield(ctx, camS, wx0, wy0, wx1, wy1);
  ctx.strokeStyle = 'rgba(120,160,220,.14)'; ctx.lineWidth = 1.5 / camS;
  ctx.strokeRect(0, 0, GM_W, GM_H);
}

function gmmPaint(ctx, camS, wx0, wy0, wx1, wy1) {
  gmmPaintSpace(ctx, camS, wx0, wy0, wx1, wy1);
  if (!GMM.paths) return;
  gmmPaintVector(ctx, camS);
  gmmPaintFog(ctx);
  // Звёзды/подписи/иконки ресурсов в битмап НЕ запекаем — их рисует живой слой
  // (gmmBlit → gmmPaintStars) по текущему зуму. В битмапе только то, что честно
  // масштабируется линейно при растяжении: фон, территории, туман, границы, пути.
}

// Герб/флаг фракции (ленивая загрузка из анкеты, перерисовка по onload). Картинку
// НЕ читаем попиксельно (только drawImage), поэтому crossOrigin не ставим — иначе
// сервер без CORS-заголовков ломал бы загрузку.
function gmmFlagImg(fid) {
  const meta = GM.facMeta && GM.facMeta[fid];
  const src = meta && meta.herald_url;
  if (!src) return null;
  const cache = GMM.flagImgs || (GMM.flagImgs = {});
  let im = cache[fid];
  if (im) return (im.complete && im.naturalWidth && !im.failed) ? im : null;
  im = new Image();
  im.onload = () => { if (GMM._flagLayerC) delete GMM._flagLayerC[fid]; if (GMM.active && GMM.cv && GMM.cv.isConnected) gmmRasterSoon(); };
  im.onerror = () => { im.failed = true; };
  im.src = src;
  cache[fid] = im;
  return null;
}

// Готовый «слой флага» фракции: офскрин-канва, в которой герб УЖЕ обрезан по форме
// территории и растворён радиальной слой-маской (центр непрозрачен → края в ноль).
// Считаем ОДИН раз на фракцию (форма/пропорции территории постоянны) — потом каждый
// кадр это просто drawImage в bbox территории, без клипа: дёшево и можно рисовать и
// в битмап, и в живой слой (без шва на краю битмапа). Разрешение крупное (longest
// 1024) — иначе герб «мылился»/пикселился при растяжении на всю территорию.
function gmmFlagLayer(f) {
  const im = gmmFlagImg(f.fid); if (!im) return null;
  const cache = GMM._flagLayerC || (GMM._flagLayerC = {});
  let c = cache[f.fid];
  if (c) return c;
  const aspect = f.bw / f.bh, MAX = 1024;
  let W, H;
  if (aspect >= 1) { W = MAX; H = Math.max(8, Math.round(MAX / aspect)); }
  else { H = MAX; W = Math.max(8, Math.round(MAX * aspect)); }
  c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  // 1) клип по форме территории: мировой путь территории → пиксели этой канвы
  g.save();
  g.setTransform(W / f.bw, 0, 0, H / f.bh, -f.bx * W / f.bw, -f.by * H / f.bh);
  g.clip(f.p2d);
  g.setTransform(1, 0, 0, 1, 0, 0);
  // 2) герб cover-fit во всю канву (только внутри клипа)
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  const sc = Math.max(W / iw, H / ih);
  const dw = iw * sc, dh = ih * sc;
  g.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
  g.restore();
  // 3) слой-маска: радиальное растворение к краям (внутри уже обрезанного герба)
  g.globalCompositeOperation = 'destination-in';
  const rg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.62);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.6, 'rgba(255,255,255,0.85)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  cache[f.fid] = c;
  return c;
}

// Дешёвый ВЕКТОРНЫЙ мир: территории + подложки секторов + границы + гиперпути +
// границы секторов + метки регионов. Всё это — Path2D fill/stroke (без радиальных
// градиентов), поэтому рисуется и в запекаемый битмап (gmmPaint), и ЖИВЬЁМ под ним
// каждый кадр (gmmBlit) — чтобы при пане необкрытый битмапом край сразу имел и пути,
// и регионы, а не ждал перерастеризации. НЕ входят: космофон/россыпь (gmmPaintSpace)
// и туман-с-прорехами (gmmPaintFog) — они дороже и остаются только в битмапе.
function gmmPaintVector(ctx, camS, live) {
  const P = GMM.paths;
  if (!P) return;
  // Заливки территорий. Режим «бедность» красит ячейки по просперити. Без границ и
  // без «бедности» заливки не рисуем вовсе (кнопка «Границы» убирает всю территорию,
  // как в SVG-рендере), остаются только гиперпути и звёзды.
  if (GM.showEcon) {
    (P.econFills || []).forEach(f => { ctx.fillStyle = f.color; ctx.fill(f.p2d); });
  } else if (GM.showBorders) {
    P.fills.forEach(f => { ctx.fillStyle = f.color; ctx.fill(f.p2d); });
  }
  // Флаги фракций поверх их территорий: герб, мягко растворённый слой-маской к
  // границам (полупрозрачно — карта читается сквозь него). Только в режиме «Границы».
  // Флаг каждой фракции — это уже готовый слой (обрезан по территории + растворён
  // маской), поэтому здесь только drawImage в bbox территории. Рисуем и в битмап, и в
  // живой слой (одинаково) — иначе на краю битмапа был бы шов «есть флаг / нет флага».
  if (GM.showFlags && GM.showBorders && !GM.showEcon && (P.facFills || []).length) {
    const fa = 0.4 - 0.24 * gmmZoomT(camS);   // на обзоре заметнее, при заходе в системы мягче
    if (fa > 0.02) {
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      P.facFills.forEach(f => {
        const layer = gmmFlagLayer(f); if (!layer) return;
        ctx.globalAlpha = fa;
        ctx.drawImage(layer, f.bx, f.by, f.bw, f.bh);
      });
      ctx.globalAlpha = 1;
    }
  }
  // подложки секторов — на обзоре, плавно гаснут при приближении (привязаны к «Границам»)
  const secA = 1 - gmmZoomT(camS);
  if (GM.showBorders && P.secFills && P.secFills.length && secA > 0.01) {
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .42 * secA;
    P.secFills.forEach(f => { ctx.fillStyle = f.color; ctx.fill(f.p2d); });
    ctx.restore();
  }
  if (GM.showBorders) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // мягкое цветное гало по краю территории (как было — без неона/аддитива)
    ctx.globalAlpha = .26; ctx.lineWidth = 5 / camS;
    P.edges.forEach(e => { ctx.strokeStyle = e.color; ctx.stroke(e.p2d); });
    if (P.rift) { ctx.strokeStyle = '#b14ef0'; ctx.stroke(P.rift); }
    ctx.globalAlpha = 1;
    if (P.neutral) { ctx.lineWidth = 1.2 / camS; ctx.strokeStyle = 'rgba(150,170,200,.18)'; ctx.stroke(P.neutral); }
    // сплошное цветное ядро границы
    ctx.lineWidth = 2.2 / camS;
    P.edges.forEach(e => { ctx.strokeStyle = e.color; ctx.stroke(e.p2d); });
    // ЗУБЦЫ оборонной границы — маленькие заливные клинья остриём внутрь территории
    // (тон фракции, чуть светлее, чтобы читались поверх заливки). Линия + клинья =
    // пилообразный «крепостной» рубеж (без длинных уродливых штрихов).
    if (P.teeth && P.teeth.length) {
      ctx.globalAlpha = .85;
      P.teeth.forEach(t => {
        const [r, g, b] = gmRgb(t.color);
        ctx.fillStyle = `rgb(${Math.min(255, r + 45)},${Math.min(255, g + 45)},${Math.min(255, b + 45)})`;
        ctx.fill(t.p2d);
      });
      ctx.globalAlpha = 1;
    }
    if (P.rift) {   // граница разлома — статичный глитч-пунктир (анимация дорого на телефоне)
      ctx.setLineDash([7 / camS, 5 / camS]); ctx.strokeStyle = '#c060ff'; ctx.lineWidth = 2.2 / camS;
      ctx.stroke(P.rift); ctx.setLineDash([]);
    }
  }
  if (P.lanes) {
    ctx.globalAlpha = .85; ctx.lineCap = 'round';
    ctx.strokeStyle = 'hsl(206 92% 64%)'; ctx.lineWidth = 1.8 / camS;
    ctx.stroke(P.lanes); ctx.globalAlpha = 1;
  }
  // границы секторов = «пустота»: мягкое тёмное разрежение (перо из 3 слоёв) в тон туману,
  // видно лишь на обзоре — при приближении плавно тает
  if (GM.showBorders && P.secEdges && P.secEdges.length && secA > 0.01) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#070a12';
    ctx.globalAlpha = .12 * secA; ctx.lineWidth = 20 / camS; P.secEdges.forEach(e => ctx.stroke(e.p2d));
    ctx.globalAlpha = .18 * secA; ctx.lineWidth = 11 / camS; P.secEdges.forEach(e => ctx.stroke(e.p2d));
    ctx.globalAlpha = .24 * secA; ctx.lineWidth = 5 / camS;  P.secEdges.forEach(e => ctx.stroke(e.p2d));
    ctx.globalAlpha = 1;
  }
  // метки регионов — нормальный размер, плавно гаснут при приближении
  if (GM.showBorders && P.secLabels && P.secLabels.length && secA > 0.01) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.font = `700 ${(14 / camS).toFixed(1)}px Rajdhani, 'Exo 2', sans-serif`;
    P.secLabels.forEach(l => {
      const t = (l.name || '').toUpperCase();
      ctx.globalAlpha = secA; ctx.lineWidth = 3.5 / camS; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.strokeText(t, l.x, l.y);
      ctx.globalAlpha = .9 * secA; ctx.fillStyle = l.color;
      ctx.fillText(t, l.x, l.y);
      ctx.globalAlpha = 1;
    });
  }
}

// Туман войны: тёмная пелена над пустотой, которая МЯГКО расступается вокруг звёзд.
// Рисуем на отдельном слое (та же мировая система координат), затем компонуем —
// иначе «прорехи» (destination-out) стёрли бы и территории под ними.
function gmmPaintFog(ctx) {
  const P = GMM.paths;
  if (!P || !P.fogPath) return;
  const pw = ctx.canvas.width, ph = ctx.canvas.height, m = ctx.getTransform();
  let fc = GMM.fogCv || (GMM.fogCv = document.createElement('canvas'));
  if (fc.width !== pw || fc.height !== ph) { fc.width = pw; fc.height = ph; }
  const f = fc.getContext('2d');
  f.setTransform(1, 0, 0, 1, 0, 0); f.clearRect(0, 0, pw, ph);
  f.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);   // тот же мировой transform, что у мира
  f.fillStyle = 'rgba(4,6,14,0.88)'; f.fill(P.fogPath);   // пелена над пустотой
  f.globalCompositeOperation = 'destination-out';         // прорехи у источников света
  const R = 360;
  for (const s of GM.systems) {
    if (s.phantom) continue;
    const rr = s.is_giant ? R * 1.55 : (s.faction === 'rift' ? R * 1.2 : R);
    const g = f.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.5, 'rgba(0,0,0,.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = g; f.beginPath(); f.arc(s.x, s.y, rr, 0, 6.2832); f.fill();
  }
  f.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(fc, 0, 0); ctx.restore();
}

function gmmPaintStarfield(ctx, camS, wx0, wy0, wx1, wy1) {
  // МНОГООКТАВНАЯ россыпь: базовый слой (как был, 120) виден всегда; более мелкие
  // октавы плавно проявляются при ПРИБЛИЖЕНИИ. Так плотность звёзд на ЭКРАНЕ остаётся
  // высокой на любом зуме — пустые/редкозаселённые территории и края больше не
  // выглядят «непрогруженными» голыми плашками. Звёзды рисуем и за границами мира.
  const layers = [120, 60, 30];
  for (let li = 0; li < layers.length; li++) {
    const CELL = layers[li];
    // базовый слой всегда 1; мелкие — только когда их ячейка крупнее ~22px на экране
    const a = li === 0 ? 1 : Math.max(0, Math.min(1, (CELL * camS - 22) / 45));
    if (a <= 0.01) continue;
    const seed = CELL * 0.137;
    const i0 = Math.floor(wx0 / CELL), i1 = Math.ceil(wx1 / CELL);
    const j0 = Math.floor(wy0 / CELL), j1 = Math.ceil(wy1 / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = 0; k < 2; k++) {
      const h1 = gmEdgeHash(i * 12.7 + k * 31.7 + seed, j * 7.9 + k * 17.3);
      const h2 = gmEdgeHash(i * 3.1 + k * 5.9 + seed, j * 9.7 + k * 2.3);
      const h3 = gmEdgeHash(i * 8.3 + k * 1.7 + seed, j * 4.9 + k * 23.1);
      const x = (i + h1) * CELL, y = (j + h2) * CELL;
      const r = (0.5 + h3 * 0.9) / camS;
      ctx.globalAlpha = (0.25 + h3 * 0.5) * a;
      ctx.fillStyle = h1 > 0.85 ? '#cfe0ff' : '#ffffff';
      ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }
  }
  ctx.globalAlpha = 1;
}

// иконка звезды: размер растёт СУБлинейно от зума (pow 0.55) — на фит-зуме
// звёзды мелкие и не сливаются в кашу, при приближении доходят до полного
// размера; сверху ограничены base (не мыло на 4×)
function gmmIconPx(s, camS) {
  const base = s.faction === 'rift' ? (s.id === 'rift_core' ? 70 : 44) : (s.is_giant ? 96 : 46);
  const k = Math.pow(Math.min(1, camS), s.is_giant ? 0.78 : 0.7);
  return Math.max(7, base * k);
}

// Спрайт мягкого свечения (радиальный градиент → 0 на краю) — печём ОДИН раз на
// цвет/альфу. Живой слой звёзд рисуется каждый кадр; createRadialGradient на
// каждую звезду каждый кадр заметно грузил бы пан/зум, а drawImage спрайта дёшев.
function gmmGlowSprite(rgb, a0) {
  const key = rgb + '|' + a0;
  const cache = GMM._glow || (GMM._glow = {});
  let cv = cache[key];
  if (cv) return cv;
  const S = 64;
  cv = document.createElement('canvas'); cv.width = cv.height = S;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, `rgba(${rgb},${a0})`); g.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  cache[key] = cv; return cv;
}

// «Высота» камеры → плавный переход обзор↔карта систем.
// t=0 (отдалённо): только регионы + звёзды точками; t=1 (ближе): иконки звёзд.
// В переходной полосе [lo,hi] секторы/точки гаснут, иконки/подписи проявляются.
function gmmZoomT(camS) {
  const m = gmmMinS(), lo = m * 1.85, hi = m * 2.35;   // узкая полоса — чёткая смена, без долгой каши
  const s = (camS == null ? GMM.s : camS);
  const u = Math.max(0, Math.min(1, (s - lo) / (hi - lo)));
  return u * u * (3 - 2 * u);   // smoothstep — мягкие концы перехода
}
function gmmOverview(camS) { return gmmZoomT(camS) < 0.5; }

const GMM_STAR_DOTC = { yellow: '#ffd76a', red: '#ff7a5c', blue: '#8fb8ff', white: '#eaf2ff', green: '#86e6a6' };
// обзорная «текстовая звезда»: аккуратная светящаяся точка цвета звезды
function gmmPaintStarDot(ctx, s, camS) {
  if (s.faction === 'rift') {
    const rr = (s.id === 'rift_core' ? 5.5 : 3.8) / camS;
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr * 2.6);
    g.addColorStop(0, 'rgba(170,80,255,.5)'); g.addColorStop(1, 'rgba(170,80,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, rr * 2.6, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#c98cff'; ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, 6.2832); ctx.fill();
    return;
  }
  const col = s.is_giant ? '#ffd76a' : (GMM_STAR_DOTC[s.star_type] || '#dfeaff');
  const r = (s.is_giant ? 4.6 : 2.8) / camS;
  const rgb = s.is_giant ? '255,210,120' : '150,190,255';
  ctx.drawImage(gmmGlowSprite(rgb, 0.4), s.x - r * 3, s.y - r * 3, r * 6, r * 6);
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 6.2832); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.42, 0, 6.2832); ctx.fill();
}

function gmmPaintStars(ctx, camS) {
  const caps = GM.capitals || {};
  const t = gmmZoomT(camS);
  // Обзорные точки гаснут, иконки проявляются — но фазы перетекают С ПЕРЕХЛЁСТОМ
  // (×2 с насыщением до 1): в середине перехода (t≈0.5) и точка, и иконка видны на
  // 100%, а не по 50% каждая. Раньше делили видимость 1:1 → в узкой полосе зума
  // звезда системы бледнела почти до невидимости («пропадала»). Теперь на любом
  // зуме звезду представляет хотя бы один полностью непрозрачный слой.
  const dotsA = Math.min(1, (1 - t) * 2), iconA = Math.min(1, t * 2);
  const showAll = camS >= 0.30;
  const labelPx = 12;
  const cands = [];   // кандидаты подписей — рисуем отдельным проходом с защитой от наложений
  GMM.resHitMap = [];   // живой слой → карту попаданий иконок ресурсов пересобираем каждый кадр
  // отсев по экрану: рисуем каждый кадр, поэтому системы вне вьюпорта (+поля) пропускаем
  const mg = 160;
  const inView = sy => {
    const X = sy.x * camS + GMM.tx, Y = sy.y * camS + GMM.ty;
    return X > -mg && X < GMM.vw + mg && Y > -mg && Y < GMM.vh + mg;
  };
  // ── проход 1: тела звёзд ──
  GM.systems.forEach(s => {
    if (!inView(s)) return;
    // плоскость завалена под наклон систем — звезда едет вместе с картой по вертикали,
    // но сам спрайт/подпись НЕ сплющиваем (только сдвиг позиции, размер сохраняем)
    const _scY = s.y * camS + GMM.ty, _dyW = (gmmTY(_scY) - _scY) / camS;
    ctx.save(); ctx.translate(0, _dyW);
    const important = s.is_giant || !!caps[s.id] || s.faction === 'rift';
    // обзорная «текстовая» точка — главное на обзоре, гаснет при приближении
    if (dotsA > 0.01) { ctx.globalAlpha = dotsA; gmmPaintStarDot(ctx, s, camS); ctx.globalAlpha = 1; }
    if (iconA <= 0.01) { ctx.restore(); return; }   // ещё чистый обзор — иконку не рисуем
    const iw = gmmIconPx(s, camS) / camS;   // мировые юниты
    ctx.globalAlpha = iconA;
    if (s.faction === 'rift') {
      gmmPaintRift(ctx, s, iw, camS);
    } else {
      const glowR = iw * (s.is_giant ? 0.95 : 0.72);
      const gc = s.is_giant ? '255,210,120' : '120,180,255';
      ctx.drawImage(gmmGlowSprite(gc, 0.24), s.x - glowR, s.y - glowR, glowR * 2, glowR * 2);
      const im = GMM.imgs[s.star_type] || GMM.imgs.yellow;
      if (im && im.complete && im.naturalWidth) {
        // сохраняем пропорции PNG (как object-fit:contain на десктопе) — иначе
        // неквадратные иконки (напр. star_blue 632×395) выглядят сплющенными
        const ar = im.naturalWidth / im.naturalHeight;
        let dw = iw, dh = iw;
        if (ar >= 1) dh = iw / ar; else dw = iw * ar;
        ctx.drawImage(im, s.x - dw / 2, s.y - dh / 2, dw, dh);
      } else { ctx.fillStyle = '#ffd76a'; ctx.beginPath(); ctx.arc(s.x, s.y, iw * 0.3, 0, 6.2832); ctx.fill(); }
      const capFid = caps[s.id];
      if (capFid) {
        ctx.font = `${(13 / camS).toFixed(2)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = gmReadable((gmFaction(capFid) || {}).color || '#ffd24d');
        ctx.fillText('★', s.x, s.y - iw / 2 - 1 / camS);
      }
    }
    ctx.globalAlpha = 1;
    if (GM.showRes) gmmPaintResPins(ctx, s, iw, camS);
    ctx.restore();
    if (showAll || important) cands.push({ s, iw, important });
  });
  // ── проход 2: подписи с защитой от наложений (проявляются вместе с иконками) ──
  if (iconA <= 0.01) return;
  cands.sort((a, b) => (b.important - a.important) || (b.s.is_giant - a.s.is_giant));
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
  const boxes = [], pad = 2 / camS;
  cands.forEach(({ s, iw, important }) => {
    const fpx = (s.is_giant ? labelPx + 2 : labelPx) / camS;
    ctx.font = `600 ${fpx.toFixed(2)}px Rajdhani, 'Exo 2', sans-serif`;
    const w = ctx.measureText(s.name).width;
    const _scY = s.y * camS + GMM.ty, _dyW = (gmmTY(_scY) - _scY) / camS;   // тот же завал, что у звезды
    const x0 = s.x - w / 2, y0 = s.y + _dyW + iw / 2 + 3 / camS, x1 = x0 + w, y1 = y0 + fpx;
    for (const r of boxes) {
      if (x0 < r.x1 + pad && x1 > r.x0 - pad && y0 < r.y1 + pad && y1 > r.y0 - pad) return;   // налезает → прячем
    }
    boxes.push({ x0, y0, x1, y1 });
    ctx.globalAlpha = iconA;
    ctx.lineWidth = 3 / camS; ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.strokeText(s.name, s.x, y0);
    ctx.fillStyle = s.faction === 'rift' ? '#e0c2ff' : (s.is_giant ? '#ffe6b0' : '#dfeaff');
    ctx.fillText(s.name, s.x, y0);
  });
  ctx.globalAlpha = 1;
}

function gmmPaintRift(ctx, s, iw, camS) {
  const r = iw / 2;
  const g2 = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 1.5);
  g2.addColorStop(0, 'rgba(155,48,255,.4)'); g2.addColorStop(1, 'rgba(155,48,255,0)');
  ctx.fillStyle = g2;
  ctx.beginPath(); ctx.arc(s.x, s.y, r * 1.5, 0, 6.2832); ctx.fill();
  const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 0.62);
  g.addColorStop(0, '#20003a'); g.addColorStop(0.7, '#7a18c8'); g.addColorStop(1, 'rgba(122,24,200,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.62, 0, 6.2832); ctx.fill();
  ctx.setLineDash([6 / camS, 5 / camS]);
  ctx.strokeStyle = 'rgba(205,130,255,.7)'; ctx.lineWidth = 1.6 / camS;
  ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.92, 0, 6.2832); ctx.stroke();
  ctx.setLineDash([]);
}

// PNG-иконка ресурса по имени (ленивая загрузка, перерисовка по onload).
// null → нет картинки (нестандартный ресурс) → рисуем эмодзи-фолбэк.
function gmmResImg(name) {
  if (typeof resIconSrc !== 'function') return null;
  const src = resIconSrc(name);
  if (!src) return null;
  let im = GMM.resImgs[name];
  if (im) return (im.complete && im.naturalWidth) ? im : null;
  im = new Image();
  im.onload = () => { if (GMM.active && GMM.cv && GMM.cv.isConnected) gmmRasterSoon(); };
  im.src = src;
  GMM.resImgs[name] = im;
  return null;
}
function gmmPaintResPins(ctx, s, iw, camS) {
  const list = gmSysRes(s).filter(r => GM.resRarities.includes(r.r || 'common'));
  if (!list.length) return;
  if (camS < 0.2) {   // далеко: вместо плашки — точка цвета самой ценной редкости
    ctx.fillStyle = GMM_RAR_C[list[0].r] || GMM_RAR_C.common;
    const r = 3.6 / camS;
    ctx.beginPath(); ctx.arc(s.x, s.y - iw / 2 - r * 1.6, r, 0, 6.2832); ctx.fill();
    return;
  }
  const MAX = 6, shown = list.slice(0, MAX);
  const more = list.length > MAX ? '+' + (list.length - MAX) : '';
  // крупные читаемые ячейки-иконки (≈22px на экране) в ряд на тёмной плашке
  const tile = 22 / camS, gap = 3 / camS, padX = 6 / camS, padY = 5 / camS;
  const wMore = more ? (more.length * 9 + 6) / camS : 0;
  const W = shown.length * tile + (shown.length - 1) * gap + wMore + padX * 2;
  const H = tile + padY * 2;
  const x0 = s.x - W / 2, y0 = s.y - iw / 2 - H - 8 / camS;
  ctx.fillStyle = 'rgba(7,10,18,.88)';
  ctx.strokeStyle = 'rgba(160,190,230,.3)'; ctx.lineWidth = 1.2 / camS;
  gmmRoundRect(ctx, x0, y0, W, H, 6 / camS); ctx.fill(); ctx.stroke();
  let cx = x0 + padX; const iy = y0 + padY;
  const resNames = [];  // собираем имена для тултипа
  shown.forEach((r, i) => {
    const col = GMM_RAR_C[r.r] || GMM_RAR_C.common;
    // подложка ячейки с рамкой в цвет редкости — даёт контраст и кодирует ценность
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    gmmRoundRect(ctx, cx, iy, tile, tile, 4 / camS); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.4 / camS;
    gmmRoundRect(ctx, cx, iy, tile, tile, 4 / camS); ctx.stroke();
    const im = gmmResImg(r.name), ic = tile * 0.78, off = (tile - ic) / 2;
    if (im) ctx.drawImage(im, cx + off, iy + off, ic, ic);
    else {
      ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${(ic * 0.95).toFixed(2)}px sans-serif`;
      ctx.fillText(r.icon || '◆', cx + tile / 2, iy + tile / 2 + 0.5 / camS);
    }
    resNames.push({ x: cx, y: iy, w: tile, h: tile, name: r.name, r: gmRarName(r.r) });
    cx += tile + gap;
  });
  if (more) {
    ctx.fillStyle = '#9fb1c8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${(12 / camS).toFixed(2)}px Rajdhani, sans-serif`;
    ctx.fillText(more, x0 + W - padX - wMore / 2, y0 + H / 2);
  }
  // сохраняем позиции иконок для тултипа при наведении
  if (!GMM.resHitMap) GMM.resHitMap = [];
  GMM.resHitMap.push(...resNames.map(rn => ({ sys: s, ...rn })));
}
function gmmRoundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
