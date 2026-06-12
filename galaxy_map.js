// ════════════════════════════════════════════════════════════
// GALAXY MAP — интерактивная карта галактики (часть вики)
// Данные: Supabase (map_systems / map_hyperlanes / map_factions)
// Зависит от: core.js (dbGet/dbPost/dbPatch/dbDel, esc, toast, SB_URL),
//             auth.js (user), d3-delaunay (CDN)
// ════════════════════════════════════════════════════════════

const GM_W = 3300, GM_H = 2062;
const GM_BASE = 'assets/map/';
const GM_STAR_TYPES = ['yellow', 'red', 'blue', 'white', 'green'];

const GM = {
  systems: [], lanes: [], factions: [],
  scale: 1, tx: 0, ty: 0,
  edit: false, mode: 'select',   // select | link | add
  linkFrom: null,
  drag: null,                    // {sys, moved}
  panning: false, panStart: null,
  loaded: false,
  showBorders: true, fullscreen: false,
  showRes: false,                // режим «ресурсы систем»
  resRarities: ['rare', 'epic', 'legendary'], // какие редкости показывать на карте
  touch: null,                   // {mode:'pan'|'pinch', ...}
};

function gmCanEdit() { return !!(user && ['superadmin', 'editor'].includes(user.role)); }
function gmFaction(id) { return GM.factions.find(f => f.id === id) || null; }

// ── Загрузка данных ─────────────────────────────────────────
async function loadGalaxyData() {
  try {
    const [sys, lanes, facs] = await Promise.all([
      dbGet('map_systems', 'select=*'),
      dbGet('map_hyperlanes', 'select=*'),
      dbGet('map_factions', 'select=*&order=sort.asc'),
    ]);
    GM.systems = (sys || []).map(s => ({ ...s, x: +s.x, y: +s.y, planets: s.planets || [] }));
    GM.lanes = lanes || [];
    GM.factions = facs || [];
    GM.loaded = true;
    // мета фракций (флаг/герб, лидер) из анкет — необязательно
    GM.facMeta = {};
    try {
      // Метаданные (герб/лидер/имя/доктрина) — из анкеты (не меняются при переезде).
      // Столица (система + имя планеты) — из РЕАЛЬНОЙ столичной колонии (is_capital),
      // иначе переименование/перенос показывались бы как при регистрации.
      const [apps, cols] = await Promise.all([
        dbGet('faction_applications', 'status=eq.approved&select=faction_id,herald_url,leader,gov,name,system_id,planet_name'),
        dbGet('colonies', 'select=*').catch(() => []),
      ]);
      GM.colonies = cols || [];   // реальные колонии (для панели системы)
      GM.capitals = {};   // system_id -> faction_id (актуальная столица)
      GM.capPlanet = {};  // system_id -> имя столичной планеты (актуальное)
      (apps || []).forEach(a => { if (a.faction_id) GM.facMeta[a.faction_id] = a; });
      // столица = колония с is_capital (после миграции) ИЛИ planet_type='Столичный мир' (текущий признак)
      (cols || []).forEach(c => {
        if (!c.faction_id || !c.system_id) return;
        if ((c.is_capital || c.planet_type === 'Столичный мир') && !GM.capitals[c.system_id]) {
          GM.capitals[c.system_id] = c.faction_id; GM.capPlanet[c.system_id] = c.planet_name;
        }
      });
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
    // повторный заход: данные уже в памяти — рисуем мгновенно, обновляем в фоне
    loadGalaxyData().then(() => {
      if (document.getElementById('pg') !== host) return;
      if (GMM.active) { gmmBuildWorld(); gmmRaster(); }
      else if (document.getElementById('gm-svg')) gmDraw();
    });
  } else {
    host.innerHTML = `<div class="sload"><div class="pulse-loader"></div></div>`;
    await loadGalaxyData();
    if (document.getElementById('pg') !== host) return; // ушли со страницы
  }

  // Телефоны/планшеты (основной указатель — палец): отдельный canvas-рендерер,
  // DOM/SVG-вариант на тач-устройствах неюзабелен (см. блок GMM в конце файла).
  if (gmIsMobile()) { GM.edit = false; gmmRender(host); return; }
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
      <div id="gm-controls">
        <button class="gm-ctl${GM.showBorders ? ' gm-active' : ''}" title="Границы" id="gm-ctl-borders" onclick="gmToggleBorders()">⬡</button>
        <button class="gm-ctl${GM.showRes ? ' gm-active' : ''}" title="Ресурсы систем" id="gm-ctl-res" onclick="gmToggleRes()">💎</button>
        ${gmResFilterHtml()}
        <button class="gm-ctl" title="Приблизить" onclick="gmZoomBtn(1)">＋</button>
        <button class="gm-ctl" title="Отдалить" onclick="gmZoomBtn(-1)">－</button>
        <button class="gm-ctl" title="Вся карта" onclick="gmFit()">⤢</button>
        <button class="gm-ctl" title="На весь экран" id="gm-ctl-fs" onclick="gmToggleFullscreen()">⛶</button>
      </div>
      ${canEdit ? gmToolbarHtml() : ''}
      <div id="gm-panel" class="gm-hidden"></div>
      <div id="gm-form" class="gm-hidden"></div>
    </div>`;

  gmBindViewport();
  document.getElementById('gm-wrap')?.classList.toggle('gm-show-res', GM.showRes);
  gmFit();
  gmDraw();
}

function gmToolbarHtml() {
  return `<div id="gm-toolbar">
    <button class="gm-tb-btn" id="gm-edit-toggle" onclick="gmToggleEdit()">✎ Редактировать карту</button>
    <div id="gm-edit-tools" class="gm-hidden">
      <button class="gm-tb-btn" data-mode="select" onclick="gmSetMode('select')">✥ Двигать</button>
      <button class="gm-tb-btn" data-mode="add" onclick="gmSetMode('add')">＋ Звезда</button>
      <button class="gm-tb-btn" data-mode="link" onclick="gmSetMode('link')">⟿ Гиперпуть</button>
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
  GM.scale = gmMinScale();
  GM.tx = (w - GM_W * GM.scale) / 2;
  GM.ty = (h - GM_H * GM.scale) / 2;
  gmApply();
}
function gmClamp() {
  const vp = document.getElementById('gm-viewport');
  if (!vp) return;
  const w = vp.clientWidth, h = vp.clientHeight;
  const minScale = gmMinScale();
  GM.scale = Math.min(Math.max(GM.scale, minScale), 4.0);
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
  if (c) c.style.transform = `translate(${GM.tx}px, ${GM.ty}px) scale(${GM.scale})`;
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
    GM.scale = Math.min(Math.max(GM.scale, gmMinScale()), 4.0);
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
    if (e.target.closest('.gm-star') || e.target.closest('#gm-panel') ||
        e.target.closest('#gm-form') || e.target.closest('#gm-toolbar')) return;
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
    GM.scale = Math.min(Math.max(GM.touch.scale * (d / GM.touch.dist), gmMinScale()), 4.0);
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
  GM.scale = Math.min(Math.max(GM.scale * (dir > 0 ? 1.3 : 1 / 1.3), gmMinScale()), 4.0);
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

function gmVoronoiCells() {
  if (!window.d3 || !d3.Delaunay || GM.systems.length < 1) return [];
  try {
    const pts = GM.systems.map(s => [s.x, s.y]);
    const del = d3.Delaunay.from(pts);
    const vor = del.voronoi([0, 0, GM_W, GM_H]);
    return GM.systems.map((s, i) => ({ sys: s, poly: vor.cellPolygon(i) }));
  } catch (e) { console.warn('[map] voronoi', e); return []; }
}

// ── Общая геометрия карты (для SVG-рендера десктопа и canvas-рендера телефона):
//    заливки ячеек, классифицированные границы и изогнутые гиперпути ──
function gmBuildGeo() {
  const cells = gmVoronoiCells();

  // ── Заливки ячеек (без обводки) — соседние ячейки одной фракции сливаются ──
  const fills = [];
  cells.forEach(({ sys, poly }) => {
    if (!poly) return;
    const fac = gmFaction(sys.faction);
    fills.push({ sys, fac, isRift: !!(fac && fac.id === 'rift'), pts: gmPerturbPoly(poly) });
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
    for (let i = 0; i < poly.length - 1; i++) {
      const k = ekey(poly[i], poly[i + 1]);
      let e = edgeMap.get(k);
      if (!e) { e = { a: poly[i], b: poly[i + 1], sides: [] }; edgeMap.set(k, e); }
      e.sides.push({ fid, sx: sys.x, sy: sys.y });   // запоминаем «чья» сторона и где её система
    }
  });
  const edges = [];   // {kind:'front'|'fac'|'rift'|'neutral', color?, pts}
  const FRONT_OFF = 4;   // смещение линии фронта к своей территории (user units)
  edgeMap.forEach(e => {
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
        edges.push({ kind: 'front', color: gmSolidColor(fac.color), pts: pts.map(p => [p[0] + ox, p[1] + oy]) });
      });
    } else if (distinct.length === 1) {
      const fac = gmFaction(distinct[0]);
      if (fac.id === 'rift') edges.push({ kind: 'rift', pts });
      else edges.push({ kind: 'fac', color: gmSolidColor(fac.color), pts });
    } else {
      edges.push({ kind: 'neutral', color: 'rgba(150,170,200,0.18)', pts });
    }
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
    lanes.push({ id: l.id, ax: a.x, ay: a.y, cx: +(mx + nx * bend).toFixed(1), cy: +(my + ny * bend).toFixed(1), bx: b.x, by: b.y });
  });

  return { fills, edges, lanes };
}

function gmDrawSvg() {
  const svg = document.getElementById('gm-svg');
  if (!svg) return;
  const geo = gmBuildGeo();
  const dOf = (pts, close) => 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + (close ? 'Z' : '');

  const fillHtml = geo.fills.map(f => {
    const d = dOf(f.pts, true);
    if (f.isRift) return `<path class="vor-cell vor-rift" d="${d}" stroke="none"></path>`;  // заливка/анимация — в CSS
    const fill = f.fac ? f.fac.color : 'rgba(120,140,170,0.05)';
    const cls = 'vor-cell' + (f.fac ? ' vor-claimed' : ' vor-neutral');
    return `<path class="${cls}" d="${d}" fill="${fill}" stroke="none"></path>`;
  }).join('');

  const facBorderHtml = [], neutralBorderHtml = [];
  geo.edges.forEach(e => {
    const d = dOf(e.pts);
    if (e.kind === 'front') facBorderHtml.push(`<path class="vor-cell vor-edge vor-claimed vor-front" d="${d}" fill="none" stroke="${e.color}"></path>`);
    else if (e.kind === 'rift') facBorderHtml.push(`<path class="vor-cell vor-edge vor-rift-edge" d="${d}" fill="none"></path>`);
    else if (e.kind === 'fac') facBorderHtml.push(`<path class="vor-cell vor-edge vor-claimed" d="${d}" fill="none" stroke="${e.color}"></path>`);
    else neutralBorderHtml.push(`<path class="vor-cell vor-edge vor-neutral" d="${d}" fill="none" stroke="${e.color}"></path>`);
  });

  const laneHtml = geo.lanes.map(L => {
    const del = GM.edit && GM.mode === 'link' ? ` onclick="gmDeleteLane('${L.id}')"` : '';
    const cls = 'hyperlane' + (GM.edit && GM.mode === 'link' ? ' gm-deletable' : '');
    return `<path class="${cls}" d="M${L.ax},${L.ay} Q${L.cx},${L.cy} ${L.bx},${L.by}" fill="none"${del}></path>`;
  }).join('');

  const fb = facBorderHtml.join('');
  // Свечение — широкий полупрозрачный контур БЕЗ SVG-фильтра (feGaussianBlur тормозил
  // при пане/зуме). Дёшево композитится.
  svg.innerHTML =
    `<g class="vor-layer">${fillHtml}</g>`
    + `<g class="vor-border-layer gm-glow-layer">${fb}</g>`
    + `<g class="vor-border-layer">${neutralBorderHtml.join('')}${fb}</g>`
    + `<g class="lane-layer">${laneHtml}</g>`;
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
  layer.innerHTML = GM.systems.map(s => {
    const sel = (GM.linkFrom === s.id) ? ' gm-linksel' : '';
    // Системы разлома — не звёзды, а пульсирующие аномалии (другой стиль)
    if (s.faction === 'rift') {
      const core = s.id === 'rift_core' ? ' gm-rift-core' : '';
      return `<div class="gm-star gm-rift-node${core}${sel}" data-id="${esc(s.id)}" style="left:${s.x}px;top:${s.y}px"
          onmousedown="gmStarDown(event,'${esc(s.id)}')" onclick="gmStarClick(event,'${esc(s.id)}')">
          <span class="gm-rift-eye"></span><span class="gm-rift-ring"></span>
          <span class="gm-label gm-rift-label">${esc(s.name)}</span>
        </div>`;
    }
    const giant = s.is_giant ? ' gm-giant' : '';
    const capFid = caps[s.id];
    const capCol = capFid ? gmReadable((gmFaction(capFid) || {}).color || '#ffd24d') : '';
    const capHtml = capFid ? `<span class="gm-cap" title="Столица: ${esc((GM.facMeta[capFid] || {}).name || '')}" style="color:${capCol}">★</span>` : '';
    return `<div class="gm-star${giant}${sel}${capFid ? ' gm-capital' : ''}" data-id="${esc(s.id)}" style="left:${s.x}px;top:${s.y}px"
        onmousedown="gmStarDown(event,'${esc(s.id)}')" onclick="gmStarClick(event,'${esc(s.id)}')">
        <img src="${GM_BASE}stars/star_${esc(s.star_type || 'yellow')}.png" draggable="false" alt="">
        ${capHtml}
        ${gmResOverlay(s)}
        <span class="gm-label">${esc(s.name)}</span>
      </div>`;
  }).join('');
}

// Сводка ресурсов над звездой (видна только в режиме «ресурсы»). Рисуется всегда,
// показывается через CSS-класс #gm-wrap.gm-show-res — чтобы переключение было мгновенным.
function gmResOverlay(s) {
  // показываем только включённые в фильтре редкости — иначе на карте каша
  const list = gmSysRes(s).filter(r => GM.resRarities.includes(r.r || 'common'));
  if (!list.length) return '';
  const MAX = 6;
  const pins = list.slice(0, MAX).map(r =>
    `<span class="gm-res-pin r-${r.r || 'common'}" title="${esc(r.name)} · ${esc(gmRarName(r.r))}">${gmResIc(r)}</span>`).join('');
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
  panel.innerHTML = `
    <button class="gm-close" onclick="gmClosePanel()">✕</button>
    <h2 class="gm-panel-title">${esc(sys.name)}</h2>
    ${facBlock}
    ${(typeof ecCanAccess === 'function' && ecCanAccess() && typeof EC !== 'undefined' && EC.app && EC.app.faction_id === sys.faction)
      ? `<button class="btn btn-gh btn-sm" style="margin:6px 0 2px" onclick="gmClosePanel();go('economy')">🛰 Открыть кабинет</button>` : ''}
    <p class="gm-panel-desc">${esc(sys.description || '')}</p>
    ${colsBlock}
    <div class="gm-panel-sub">Состав системы <span class="gm-sub-hint">★ от звезды наружу →</span></div>
    <div class="gm-orblist">${planets}</div>`;
}
function gmClosePanel() {
  document.getElementById('gm-panel')?.classList.add('gm-hidden');
  if (GMM.active && GMM.selId) { GMM.selId = null; GMM.dirty = true; gmmKick(); }
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
    : m === 'link' ? 'Клик две звезды — связать; клик по линии — удалить'
    : 'Тащи звезду мышью; клик — редактировать';
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
  if (!(GM.edit && GM.mode === 'link')) return;
  try { await dbDel('map_hyperlanes', 'id=eq.' + encodeURIComponent(id)); GM.lanes = GM.lanes.filter(l => l.id !== id); gmDrawSvg(); }
  catch (e) { toast('Ошибка: ' + e.message, 'err'); }
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
    const zc = gmZoneColor(p.zone);
    const kindCls = p.kind === 'belt' ? ' gm-dot-belt' : p.kind === 'anomaly' ? ' gm-dot-anom' : '';
    const sat = [];
    if (p.rings) sat.push(`кольца ×${p.rings}`);
    if (p.moons) sat.push(`спутники ×${p.moons}`);
    const satStr = sat.length ? ` · ${sat.join(' · ')}` : '';
    const dist = (p.dist != null) ? `<span class="gm-orb-dist">${p.dist} а.е.</span>` : '';
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
  selId: null, imgs: {},
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
  host.innerHTML = `
    <div id="gm-wrap" class="gm-mobile">
      <div id="gm-viewport"><canvas id="gmm-cv"></canvas></div>
      <div id="gm-controls">
        <button class="gm-ctl${GM.showBorders ? ' gm-active' : ''}" title="Границы" id="gm-ctl-borders" onclick="gmToggleBorders()">⬡</button>
        <button class="gm-ctl${GM.showRes ? ' gm-active' : ''}" title="Ресурсы систем" id="gm-ctl-res" onclick="gmToggleRes()">💎</button>
        ${gmResFilterHtml()}
        <button class="gm-ctl" title="Приблизить" onclick="gmZoomBtn(1)">＋</button>
        <button class="gm-ctl" title="Отдалить" onclick="gmZoomBtn(-1)">－</button>
        <button class="gm-ctl" title="Вся карта" onclick="gmFit()">⤢</button>
        <button class="gm-ctl" title="На весь экран" id="gm-ctl-fs" onclick="gmToggleFullscreen()">⛶</button>
      </div>
      <div id="gm-panel" class="gm-hidden"></div>
    </div>`;
  GMM.cv = document.getElementById('gmm-cv');
  GMM.ctx = GMM.cv.getContext('2d');
  GMM.bmp = null; GMM.ptrs.clear(); GMM.gesture = null;
  GMM.vel = null; GMM.anim = null; GMM.selId = null; GMM.lastTap = 0;
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
  gmmFit(false);
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
  c.s = Math.min(Math.max(c.s, gmmMinS()), 4);
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
function gmmZoomAt(cx, cy, ns, animate) {
  ns = Math.min(Math.max(ns, gmmMinS()), 4);
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
      GMM.s = Math.min(Math.max(g.s0 * (d / g.d0), gmmMinS()), 4);
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
    const r = cv.getBoundingClientRect();
    gmmZoomAt(e.clientX - r.left, e.clientY - r.top, GMM.s * (e.deltaY > 0 ? 1 / 1.15 : 1.15), false);
  }, { passive: false });
}
function gmmStartPinch() {
  const ps = [...GMM.ptrs.values()];
  const d0 = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1;
  const cx = (ps[0].x + ps[1].x) / 2, cy = (ps[0].y + ps[1].y) / 2;
  GMM.gesture = { mode: 'pinch', d0, s0: GMM.s, wx: (cx - GMM.tx) / GMM.s, wy: (cy - GMM.ty) / GMM.s };
}

function gmmTapAt(lx, ly) {
  // ближайшая система в радиусе пальца
  let best = null, bd = 1e9;
  GM.systems.forEach(s => {
    const sx = s.x * GMM.s + GMM.tx, sy = s.y * GMM.s + GMM.ty;
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
  const now = performance.now();
  if (now - GMM.lastTap < 320 && Math.hypot(lx - GMM.ltx, ly - GMM.lty) < 40) {
    // дабл-тап по пустому: зум к точке; если уже почти максимум — вся карта
    gmmZoomAt(lx, ly, GMM.s > 3.4 ? gmmMinS() : GMM.s * 2.2, true);
    GMM.lastTap = 0;
  } else {
    GMM.lastTap = now; GMM.ltx = lx; GMM.lty = ly;
    gmClosePanel();
  }
}
// после открытия нижней панели доводим камеру, чтобы звезда не пряталась под ней
function gmmEnsureVisible(sys) {
  const sx = sys.x * GMM.s + GMM.tx, sy = sys.y * GMM.s + GMM.ty;
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
  if (GMM.dirty) { GMM.dirty = false; gmmBlit(); }
  if (gmmNeedRaster()) {
    const now = performance.now();
    if (now - GMM.lastRaster > 380) gmmRaster();        // во время длинного жеста — освежаем
    else gmmRasterSoon();                               // после остановки — дорисовка начисто
  }
  if (again) gmmKick();
}
function gmmBlit() {
  const ctx = GMM.ctx, dpr = GMM.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#04060c';
  ctx.fillRect(0, 0, GMM.vw, GMM.vh);
  const b = GMM.bmp;
  if (b) {
    const f = GMM.s / b.scale;   // битмап-px → CSS-px
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(b.cv, 0, 0, b.pw, b.ph,
      b.wx * GMM.s + GMM.tx, b.wy * GMM.s + GMM.ty, b.pw * f, b.ph * f);
  }
  if (GMM.selId) {   // кольцо выбранной системы — поверх, живёт без перерисовки мира
    const sys = GM.systems.find(x => x.id === GMM.selId);
    if (sys) {
      const sx = sys.x * GMM.s + GMM.tx, sy = sys.y * GMM.s + GMM.ty;
      ctx.beginPath(); ctx.arc(sx, sy, gmmIconPx(sys, GMM.s) * 0.62 + 6, 0, 6.2832);
      ctx.strokeStyle = 'rgba(150,205,255,.85)'; ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
  }
}

// ── Офскрин-битмап мира ─────────────────────────────────────
function gmmNeedRaster() {
  const b = GMM.bmp;
  if (!b) return !!GMM.paths;
  const ratio = GMM.s / b.camS;
  if (ratio > 1.45 || ratio < 0.62) return true;        // зум ушёл — битмап мыльный/тяжёлый
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
  if (GMM.rasterT) return;
  GMM.rasterT = setTimeout(gmmRaster, 110);
}
function gmmRaster() {
  if (GMM.rasterT) { clearTimeout(GMM.rasterT); GMM.rasterT = 0; }
  if (!GMM.active || !GMM.cv || !GMM.cv.isConnected) return;
  if (!GMM.paths) gmmBuildWorld();
  const s = GMM.s, dpr = GMM.dpr;
  // мировое окно: видимая область + запас по пол-экрана с каждой стороны
  const padX = GMM.vw * 0.5, padY = GMM.vh * 0.5;
  const wx0 = Math.max(0, (-GMM.tx - padX) / s), wy0 = Math.max(0, (-GMM.ty - padY) / s);
  const wx1 = Math.min(GM_W, (GMM.vw - GMM.tx + padX) / s), wy1 = Math.min(GM_H, (GMM.vh - GMM.ty + padY) / s);
  if (wx1 <= wx0 || wy1 <= wy0) return;
  let bs = s * dpr;
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
  geo.fills.forEach(f => {
    const color = f.isRift ? 'rgba(14,2,24,.8)' : (f.fac ? f.fac.color : 'rgba(120,140,170,0.04)');
    fillD.set(color, (fillD.get(color) || '') + dOf(f.pts, true));
  });
  // границы: цветные (фракции/фронты) по цвету, нейтральные и разлом — отдельно
  const edgeD = new Map(); let neutralD = '', riftD = '';
  geo.edges.forEach(e => {
    const d = dOf(e.pts);
    if (e.kind === 'neutral') neutralD += d;
    else if (e.kind === 'rift') riftD += d;
    else edgeD.set(e.color, (edgeD.get(e.color) || '') + d);
  });
  let lanesD = '';
  geo.lanes.forEach(L => { lanesD += `M${L.ax},${L.ay} Q${L.cx},${L.cy} ${L.bx},${L.by}`; });
  GMM.paths = {
    fills: [...fillD].map(([color, d]) => ({ color, p2d: new Path2D(d) })),
    edges: [...edgeD].map(([color, d]) => ({ color, p2d: new Path2D(d) })),
    neutral: neutralD ? new Path2D(neutralD) : null,
    rift: riftD ? new Path2D(riftD) : null,
    lanes: lanesD ? new Path2D(lanesD) : null,
  };
}

// ── Отрисовка мира в произвольный контекст (transform уже мировой) ──
// camS — экранный масштаб: толщины линий/шрифты задаются в px и делятся на него
function gmmPaint(ctx, camS, wx0, wy0, wx1, wy1) {
  // фон: база + туманности + детерминированная звёздная россыпь
  ctx.fillStyle = '#05060b';
  ctx.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
  GMM_NEBULAE.forEach(([px, py, pr, c, a]) => {
    const cx = px * GM_W, cy = py * GM_H, R = pr * GM_W;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, `rgba(${c},${a})`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  });
  gmmPaintStarfield(ctx, camS, wx0, wy0, wx1, wy1);
  ctx.strokeStyle = 'rgba(120,160,220,.14)'; ctx.lineWidth = 1.5 / camS;
  ctx.strokeRect(0, 0, GM_W, GM_H);

  const P = GMM.paths;
  if (!P) return;
  P.fills.forEach(f => { ctx.fillStyle = f.color; ctx.fill(f.p2d); });
  if (GM.showBorders) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // свечение — широкий полупрозрачный контур (как на десктопе, без фильтров)
    ctx.globalAlpha = .28; ctx.lineWidth = 5 / camS;
    P.edges.forEach(e => { ctx.strokeStyle = e.color; ctx.stroke(e.p2d); });
    if (P.rift) { ctx.strokeStyle = '#b14ef0'; ctx.stroke(P.rift); }
    ctx.globalAlpha = 1;
    if (P.neutral) { ctx.lineWidth = 1.2 / camS; ctx.strokeStyle = 'rgba(150,170,200,.18)'; ctx.stroke(P.neutral); }
    ctx.lineWidth = 2.2 / camS;
    P.edges.forEach(e => { ctx.strokeStyle = e.color; ctx.stroke(e.p2d); });
    if (P.rift) {   // граница разлома — статичный глитч-пунктир (анимация дорого на телефоне)
      ctx.setLineDash([7, 5]); ctx.strokeStyle = '#c060ff'; ctx.lineWidth = 2.2 / camS;
      ctx.stroke(P.rift); ctx.setLineDash([]);
    }
  }
  if (P.lanes) {
    ctx.globalAlpha = .85; ctx.lineCap = 'round';
    ctx.strokeStyle = 'hsl(206 92% 64%)'; ctx.lineWidth = 1.8 / camS;
    ctx.stroke(P.lanes); ctx.globalAlpha = 1;
  }
  gmmPaintStars(ctx, camS);
}

function gmmPaintStarfield(ctx, camS, wx0, wy0, wx1, wy1) {
  const CELL = 120;
  const i0 = Math.floor(wx0 / CELL), i1 = Math.ceil(wx1 / CELL);
  const j0 = Math.floor(wy0 / CELL), j1 = Math.ceil(wy1 / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = 0; k < 2; k++) {
    const h1 = gmEdgeHash(i * 12.7 + k * 31.7, j * 7.9 + k * 17.3);
    const h2 = gmEdgeHash(i * 3.1 + k * 5.9, j * 9.7 + k * 2.3);
    const h3 = gmEdgeHash(i * 8.3 + k * 1.7, j * 4.9 + k * 23.1);
    const x = (i + h1) * CELL, y = (j + h2) * CELL;
    if (x < 0 || y < 0 || x > GM_W || y > GM_H) continue;
    const r = (0.5 + h3 * 0.9) / camS;
    ctx.globalAlpha = 0.25 + h3 * 0.5;
    ctx.fillStyle = h1 > 0.85 ? '#cfe0ff' : '#ffffff';
    ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
  ctx.globalAlpha = 1;
}

// иконка звезды: на телефоне размер полу-экранный — пропорционален зуму,
// но с минимумом (видна на фит-зуме) и максимумом (не мыло на 4×)
function gmmIconPx(s, camS) {
  const base = s.faction === 'rift' ? (s.id === 'rift_core' ? 74 : 46) : (s.is_giant ? 104 : 52);
  const floor = s.is_giant ? 30 : (s.faction === 'rift' ? 20 : 18);
  return Math.max(floor, Math.min(base, base * camS));
}

function gmmPaintStars(ctx, camS) {
  const caps = GM.capitals || {};
  const showAll = camS >= 0.30;   // дальше — подписи только у важного (гиганты/столицы/разлом)
  const labelPx = 12;
  GM.systems.forEach(s => {
    const iw = gmmIconPx(s, camS) / camS;   // мировые юниты
    if (s.faction === 'rift') {
      gmmPaintRift(ctx, s, iw, camS);
    } else {
      const glowR = iw * (s.is_giant ? 1.1 : 0.9);
      const gc = s.is_giant ? '255,210,120' : '120,180,255';
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR);
      g.addColorStop(0, `rgba(${gc},.34)`); g.addColorStop(1, `rgba(${gc},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s.x, s.y, glowR, 0, 6.2832); ctx.fill();
      const im = GMM.imgs[s.star_type] || GMM.imgs.yellow;
      if (im && im.complete && im.naturalWidth) ctx.drawImage(im, s.x - iw / 2, s.y - iw / 2, iw, iw);
      else { ctx.fillStyle = '#ffd76a'; ctx.beginPath(); ctx.arc(s.x, s.y, iw * 0.3, 0, 6.2832); ctx.fill(); }
      const capFid = caps[s.id];
      if (capFid) {
        ctx.font = `${(13 / camS).toFixed(2)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = gmReadable((gmFaction(capFid) || {}).color || '#ffd24d');
        ctx.fillText('★', s.x, s.y - iw / 2 - 1 / camS);
      }
    }
    const important = s.is_giant || caps[s.id] || s.faction === 'rift';
    if (showAll || important) {
      const fpx = (s.is_giant ? labelPx + 2 : labelPx) / camS;
      ctx.font = `600 ${fpx.toFixed(2)}px Rajdhani, 'Exo 2', sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const ly = s.y + iw / 2 + 3 / camS;
      ctx.lineWidth = 3 / camS; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineJoin = 'round';
      ctx.strokeText(s.name, s.x, ly);
      ctx.fillStyle = s.faction === 'rift' ? '#e0c2ff' : (s.is_giant ? '#ffe6b0' : '#dfeaff');
      ctx.fillText(s.name, s.x, ly);
    }
    if (GM.showRes) gmmPaintResPins(ctx, s, iw, camS);
  });
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

function gmmPaintResPins(ctx, s, iw, camS) {
  const list = gmSysRes(s).filter(r => GM.resRarities.includes(r.r || 'common'));
  if (!list.length) return;
  if (camS < 0.2) {   // далеко: вместо плашки — точка цвета самой ценной редкости
    ctx.fillStyle = GMM_RAR_C[list[0].r] || GMM_RAR_C.common;
    const r = 3.2 / camS;
    ctx.beginPath(); ctx.arc(s.x, s.y - iw / 2 - r * 1.6, r, 0, 6.2832); ctx.fill();
    return;
  }
  const MAX = 6, shown = list.slice(0, MAX);
  const more = list.length > MAX ? '+' + (list.length - MAX) : '';
  const ph = 13 / camS, wEach = 15 / camS, padX = 5 / camS;
  const wMore = more ? (more.length * 7 + 4) / camS : 0;
  const W = shown.length * wEach + wMore + padX * 2;
  const H = ph + 8 / camS;
  const x0 = s.x - W / 2, y0 = s.y - iw / 2 - H - 6 / camS;
  ctx.fillStyle = 'rgba(7,10,18,.82)';
  ctx.strokeStyle = 'rgba(160,190,230,.25)'; ctx.lineWidth = 1 / camS;
  gmmRoundRect(ctx, x0, y0, W, H, 5 / camS);
  ctx.fill(); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const cy = y0 + H / 2 + 0.5 / camS;
  ctx.font = `${ph.toFixed(2)}px sans-serif`;
  let cx = x0 + padX + wEach / 2;
  shown.forEach(r => { ctx.fillStyle = GMM_RAR_C[r.r] || GMM_RAR_C.common; ctx.fillText(r.icon || '◆', cx, cy); cx += wEach; });
  if (more) {
    ctx.fillStyle = '#9fb1c8';
    ctx.font = `700 ${(9.5 / camS).toFixed(2)}px Rajdhani, sans-serif`;
    ctx.fillText(more, x0 + W - padX - wMore / 2 + 2 / camS, cy);
  }
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
