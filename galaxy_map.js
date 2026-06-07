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
  host.innerHTML = `<div class="sload"><div class="pulse-loader"></div></div>`;
  await loadGalaxyData();
  if (document.getElementById('pg') !== host) return; // ушли со страницы

  // сброс временного состояния (DOM пересоздаётся при каждом входе)
  GM.edit = false; GM.mode = 'select'; GM.linkFrom = null;
  GM.drag = null; GM.panning = false; GM.fullscreen = false; GM.touch = null;

  const canEdit = gmCanEdit();
  host.innerHTML = `
    <div id="gm-wrap">
      <div id="gm-viewport">
        <div id="gm-canvas">
          <img id="gm-bg" src="${GM_BASE}background_galaxy.png" draggable="false" alt="">
          <svg id="gm-svg" viewBox="0 0 ${GM_W} ${GM_H}" preserveAspectRatio="none"></svg>
          <div id="gm-stars"></div>
        </div>
      </div>
      <div id="gm-coord">X: 0 | Y: 0</div>
      <div id="gm-controls">
        <button class="gm-ctl${GM.showBorders ? ' gm-active' : ''}" title="Границы" id="gm-ctl-borders" onclick="gmToggleBorders()">⬡</button>
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
function gmApply() {
  gmClamp();
  const c = document.getElementById('gm-canvas');
  if (c) c.style.transform = `translate(${GM.tx}px, ${GM.ty}px) scale(${GM.scale})`;
  gmUpdateStrokes();
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
  document.getElementById('gm-svg')?.classList.toggle('gm-noborders', !GM.showBorders);
  document.getElementById('gm-ctl-borders')?.classList.toggle('gm-active', GM.showBorders);
}
function gmZoomBtn(dir) {
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
  requestAnimationFrame(() => { gmClamp(); gmApply(); });
}
function gmOnFsChange() {
  const wrap = document.getElementById('gm-wrap');
  if (!wrap) return;
  const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  wrap.classList.toggle('gm-fullscreen', fs);
  document.getElementById('gm-ctl-fs')?.classList.toggle('gm-active', fs);
  requestAnimationFrame(() => { gmClamp(); gmApply(); });
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
  const n = Math.max(7, Math.min(24, Math.round(clen / 10)));   // ещё больше мелких рёбер
  const subs = [];
  for (let s = 1; s < n; s++) {
    const tc = s / n;
    // три октавы шума: крупная волна + средняя + мелкая деталь → изрезанный «природный» край
    const lo  = gmEdgeHash(p[0] + q[0] * 0.37 + tc * 53.1,  p[1] + q[1] * 0.29 + tc * 91.7)  - 0.5;
    const mid = gmEdgeHash(p[0] * 0.71 + tc * 137.3,        q[1] * 0.83 + tc * 311.5)        - 0.5;
    const hi  = gmEdgeHash(p[0] * 1.93 + tc * 547.7,        q[1] * 1.27 + tc * 733.1)        - 0.5;
    const off = (lo * 1.1 + mid * 0.6 + hi * 0.3) * localAmp;   // |off| ≤ localAmp
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

function gmDrawSvg() {
  const svg = document.getElementById('gm-svg');
  if (!svg) return;
  const cells = gmVoronoiCells();

  // ── Заливки ячеек (без обводки) — соседние ячейки одной фракции сливаются ──
  const fillHtml = cells.map(({ sys, poly }) => {
    if (!poly) return '';
    const fac = gmFaction(sys.faction);
    const fill = fac ? fac.color : 'rgba(120,140,170,0.05)';
    const pts = gmPerturbPoly(poly);
    const d = 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z';
    const cls = 'vor-cell' + (fac ? ' vor-claimed' : ' vor-neutral');
    return `<path class="${cls}" d="${d}" fill="${fill}" stroke="none"></path>`;
  }).join('');

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
  const facBorderHtml = [], neutralBorderHtml = [];
  const FRONT_OFF = 4;   // смещение линии фронта к своей территории (user units)
  edgeMap.forEach(e => {
    const facSides = e.sides.filter(s => s.fid && gmFaction(s.fid));
    const distinct = [...new Set(facSides.map(s => s.fid))];
    if (facSides.length === 2 && distinct.length === 1) return; // внутреннее ребро одной фракции
    const pts = gmPerturbEdge(e.a, e.b);
    const dRaw = () => 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L');
    if (distinct.length >= 2) {
      // ── ЛИНИЯ ФРОНТА: две границы, каждая смещена к своей стороне ──
      const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L, mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2;
      facSides.forEach(s => {
        const fac = gmFaction(s.fid);
        const sign = ((s.sx - mx) * nx + (s.sy - my) * ny) >= 0 ? 1 : -1;
        const ox = nx * FRONT_OFF * sign, oy = ny * FRONT_OFF * sign;
        const d = 'M' + pts.map(p => (p[0] + ox).toFixed(1) + ',' + (p[1] + oy).toFixed(1)).join('L');
        facBorderHtml.push(`<path class="vor-cell vor-edge vor-claimed vor-front" d="${d}" fill="none" stroke="${gmSolidColor(fac.color)}"></path>`);
      });
    } else if (distinct.length === 1) {
      const fac = gmFaction(distinct[0]);
      facBorderHtml.push(`<path class="vor-cell vor-edge vor-claimed" d="${dRaw()}" fill="none" stroke="${gmSolidColor(fac.color)}"></path>`);
    } else {
      neutralBorderHtml.push(`<path class="vor-cell vor-edge vor-neutral" d="${dRaw()}" fill="none" stroke="rgba(150,170,200,0.18)"></path>`);
    }
  });

  const laneHtml = GM.lanes.map(l => {
    const a = GM.systems.find(s => s.id === l.a_id), b = GM.systems.find(s => s.id === l.b_id);
    if (!a || !b) return '';
    const del = GM.edit && GM.mode === 'link' ? ` onclick="gmDeleteLane('${l.id}')"` : '';
    const cls = 'hyperlane' + (GM.edit && GM.mode === 'link' ? ' gm-deletable' : '');
    // Слегка изогнутая кривая вместо прямой: контрольная точка = середина + перпендикуляр.
    // Изгиб детерминированный (хэш по концам) — стабилен между перерисовками, не зависит от порядка.
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const nx = -dy / len, ny = dx / len;
    const h = gmEdgeHash(Math.min(a.x, b.x) + Math.max(a.x, b.x) * 0.31, Math.min(a.y, b.y) + Math.max(a.y, b.y) * 0.47);
    const bend = (h - 0.5) * 2 * Math.min(len * 0.11, 55);
    const cx = (mx + nx * bend).toFixed(1), cy = (my + ny * bend).toFixed(1);
    return `<path class="${cls}" d="M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}" fill="none"${del}></path>`;
  }).join('');

  const fb = facBorderHtml.join('');
  svg.innerHTML = `<defs><filter id="gm-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter></defs>`
    + `<g class="vor-layer">${fillHtml}</g>`
    + `<g class="vor-border-layer gm-glow-layer" filter="url(#gm-glow)">${fb}</g>`
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
  // радиус свечения границ — постоянный на экране (компенсируем зум)
  const blur = svg.querySelector('#gm-glow feGaussianBlur');
  if (blur) blur.setAttribute('stdDeviation', (2.2 / s).toFixed(2));
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
    const giant = s.is_giant ? ' gm-giant' : '';
    const sel = (GM.linkFrom === s.id) ? ' gm-linksel' : '';
    const capFid = caps[s.id];
    const capCol = capFid ? gmReadable((gmFaction(capFid) || {}).color || '#ffd24d') : '';
    const capHtml = capFid ? `<span class="gm-cap" title="Столица: ${esc((GM.facMeta[capFid] || {}).name || '')}" style="color:${capCol}">★</span>` : '';
    return `<div class="gm-star${giant}${sel}${capFid ? ' gm-capital' : ''}" data-id="${esc(s.id)}" style="left:${s.x}px;top:${s.y}px"
        onmousedown="gmStarDown(event,'${esc(s.id)}')" onclick="gmStarClick(event,'${esc(s.id)}')">
        <img src="${GM_BASE}stars/star_${esc(s.star_type || 'yellow')}.png" draggable="false" alt="">
        ${capHtml}
        <span class="gm-label">${esc(s.name)}</span>
      </div>`;
  }).join('');
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
  const fac = gmFaction(sys.faction);
  const planets = (sys.planets || []).map((p, i) => gmPlanetView(p, i)).join('')
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
  // Реальные колонии в системе (из colonies) — структуры фракций и столичные планеты,
  // которых может не быть в статичных map_systems.planets.
  const sysCols = (GM.colonies || []).filter(c => c.system_id === sys.id);
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
function gmClosePanel() { document.getElementById('gm-panel')?.classList.add('gm-hidden'); }

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
  return `<div class="gm-res">` + res.map(r =>
    `<span class="gm-res-tag r-${r.r || 'common'}">${r.icon || ''} ${esc(r.name)}<i>${esc(r.amt || '')}</i></span>`).join('') + `</div>`;
}
function gmSlotsBadge(p) {
  if (p.slotsP === undefined && p.slotsK === undefined) return '';
  return `<span class="gm-slots"><b>${p.slotsP || 0}</b>&nbsp;П&nbsp;+&nbsp;<b>${p.slotsK || 0}</b>&nbsp;К</span>`;
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
        <div class="gm-orb-top"><span class="gm-orb-name">${esc(p.name)}</span>${dist}${gmSlotsBadge(p)}</div>
        <div class="gm-orb-sub">${esc(p.type || '')}${p.zone ? ` · <span style="color:${zc}">${esc(p.zone)} зона</span>` : ''}${satStr}</div>
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
    if (p && p.kind) {
      const kc = p.kind === 'belt' ? ' gm-dot-belt' : p.kind === 'anomaly' ? ' gm-dot-anom' : '';
      return `<div class="gm-fp-rich">
        <span class="gm-orb-dot${kc}" style="--zc:${gmZoneColor(p.zone)}"></span>
        <span class="gm-fp-name">${esc(p.name)}</span>
        <span class="gm-fp-meta">${p.dist != null ? p.dist + ' а.е. · ' : ''}${esc(p.type || '')} · ${p.slotsP || 0}П+${p.slotsK || 0}К</span>
        <button class="gm-mini-btn gm-danger" onclick="gmRemovePlanet(${i})">✕</button>
      </div>`;
    }
    return `<div class="gm-planet-row">
      <input class="gm-fi gm-fi-sm" placeholder="Имя" value="${esc(p.name || '')}" oninput="GM.formPlanets[${i}].name=this.value">
      <input class="gm-fi gm-fi-sm" placeholder="Тип" value="${esc(p.type || '')}" oninput="GM.formPlanets[${i}].type=this.value">
      <input class="gm-fi gm-fi-sm" placeholder="Контроль" value="${esc(p.owner || '')}" oninput="GM.formPlanets[${i}].owner=this.value">
      <input class="gm-fi gm-fi-sm" placeholder="img" value="${esc(p.img || '')}" oninput="GM.formPlanets[${i}].img=this.value">
      <button class="gm-mini-btn gm-danger" onclick="gmRemovePlanet(${i})">✕</button>
    </div>`;
  }).join('');
}
function gmAddPlanetManual() { GM.formPlanets.push({ name: '', type: '', owner: '', img: '' }); gmRenderFormPlanets(); }
function gmRemovePlanet(i) { GM.formPlanets.splice(i, 1); gmRenderFormPlanets(); }
function gmCloseForm() { document.getElementById('gm-form')?.classList.add('gm-hidden'); gmCloseGen(); }

async function gmSaveForm() {
  const id = document.getElementById('gmf-id').value;
  const planets = GM.formPlanets.filter(p => (p.name || '').trim());
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
async function gmDeleteStar(id) {
  if (!confirm('Удалить систему и связанные гиперпути?')) return;
  try {
    await dbDel('map_systems', 'id=eq.' + encodeURIComponent(id));
    GM.systems = GM.systems.filter(s => s.id !== id);
    GM.lanes = GM.lanes.filter(l => l.a_id !== id && l.b_id !== id);
    gmCloseForm(); gmDraw(); toast('Удалено', 'ok');
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}
