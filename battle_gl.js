// ════════════════════════════════════════════════════════════════════
// БОЕВАЯ ДОСКА — WebGL-СЦЕНА (этап 1: каркас)
// ────────────────────────────────────────────────────────────────────
// Почему не 2D-канвас с наклоном: аффинный трансформ canvas 2D перспективу не
// умеет, а CSS-перспектива поверх канваса ломает три вещи разом — спрайты вида
// сверху растягиваются вместе с плоскостью, границы прокрутки перестают совпадать
// с трапецией видимой области, и браузер каждый кадр композитит огромный 3D-слой.
// Здесь честная сцена: камера с настоящей матрицей проекции, поле — геометрия в
// плоскости XZ, выбор клетки — рейкаст (луч из курсора в плоскость), а не обратная
// формула к чужой математике. Отсюда же берётся производительность: геометрия
// живёт в буферах на видеокарте, «запекать» нечего.
//
// ИГРОВАЯ ЛОГИКА НЕ ТРОГАЕТСЯ. Сетка гексов, дальности, ЛОС, клики — всё остаётся
// в battle_board.js; отсюда вызывается только его математика координат
// (bbHexCenter / bbHexFromWorld). Мир плоский, как и был: мировой X → X сцены,
// мировой Y → Z сцены, высота Y = 0. Никакой новой системы координат.
// ════════════════════════════════════════════════════════════════════

const BG = {
  ready: false,
  cv: null, renderer: null, scene: null, cam: null,
  raf: 0, dirty: true,
  // камера-орбита: точка прицела лежит НА ПЛОСКОСТИ, вокруг неё крутимся
  tgt: { x: 0, z: 0 },
  yaw: -Math.PI / 2,      // 0 = смотрим вдоль +X; -90° ставит нос поля вправо
  pitch: 0.92,            // угол над плоскостью (рад): 0 — вровень, π/2 — сверху
  dist: 900,
  hover: null,            // {x,y} гекс под курсором
  ptrs: new Map(), drag: null, orbit: null, pinch: null,
  g: {},                  // группы сцены по ключам (поле, борта, эффекты)
  units: new Map(),       // id борта → Object3D (борт живёт между обновлениями!)
  fx: new Map(),          // эффект из BB.anim.fx → узел сцены {step,kill}
  trail: new Map(),       // id борта → выхлопной след (лента, гаснет вне движения)
};

const BG_PITCH_MIN = 0.28, BG_PITCH_MAX = 1.45;
// Потолок отдаления. Был 3200 — меньше, чем нужно, чтобы охватить большую
// арену (60×60 это ~3000×3500 мировых единиц): камера упиралась в кламп и
// показывала окно в треть поля, а игрок видел «пустоту» вместо своего фланга.
const BG_DIST_MIN = 180, BG_DIST_MAX = 7000;

// Масштаб флота: кинематографический — борта крупнее клетки, сетка уходит в фон.
// Эффекты растут ТЕМ ЖЕ множителем и намеренно завязаны на него одной константой:
// разъедутся — попадание потеряется на фоне корпуса, а взрыв накроет пол-доски.
const BG_SHIP_K = 1.25;
const BG_FX_K = BG_SHIP_K;

// ── ЦВЕТА (зеркало BB_C, чтобы 2D и 3D не разъезжались) ─────
const BG_C = {
  mine: 0x5adcf0,
  foe:  0xff3c82,
  grid: 0x5ac8e6,
};

function bgHasThree() { return typeof THREE !== 'undefined'; }

// ── Мир ↔ сцена ─────────────────────────────────────────────
// Плоскость боя лежит в XZ. Мировой Y (глубина поля) становится Z сцены.
function bgToScene(px, py) { return { x: px, z: py }; }

// ════════════════════════════════════════════════════════════
// СБОРКА СЦЕНЫ
// ════════════════════════════════════════════════════════════
function bgInit(canvas) {
  if (!bgHasThree()) { console.warn('[bg] THREE не загружен'); return false; }
  BG.cv = canvas;
  BG.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  BG.renderer.setClearColor(0x02040a, 1);
  BG.scene = new THREE.Scene();
  BG.cam = new THREE.PerspectiveCamera(46, 1, 10, 20000);

  bgBuildSky();
  bgBuildLights();
  bgBuildField();

  bgResize();
  bgBindInput();
  BG.ready = true;
  bgKick();
  return true;
}

// ── Свет: одна «звезда системы» + холодная заливка ──────────
// Направленный свет даёт корпусам светотень (ради неё всё и затевалось), заливка
// не даёт теневой стороне провалиться в чёрное.
function bgBuildLights() {
  const key = new THREE.DirectionalLight(0xfff0d8, 2.1);
  key.position.set(-0.55, 0.68, -0.48).multiplyScalar(1000);
  BG.scene.add(key);
  BG.scene.add(new THREE.HemisphereLight(0x4a6ea8, 0x0a0f18, 0.85));
  BG.g.key = key;
}

// ── Небо: настоящий трёхмерный задник ───────────────────────
// Звёзды сидят на огромной сфере вокруг сцены, поэтому при повороте и наезде
// камеры они ведут себя как бесконечно далёкие сами собой — никакого ручного
// параллакса не нужно, им занимается перспектива.
function bgBuildSky() {
  const N = 2600, R = 9000;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    // равномерно по сфере (иначе звёзды сбиваются к полюсам)
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos[i * 3] = Math.cos(th) * r * R;
    pos[i * 3 + 1] = u * R;
    pos[i * 3 + 2] = Math.sin(th) * r * R;
    // температуры: от голубых гигантов до красных карликов
    const t = Math.random();
    c.setHSL(t < 0.5 ? 0.58 : 0.09, 0.35 + Math.random() * 0.3, 0.55 + Math.random() * 0.4);
    const b = 0.25 + Math.pow(Math.random(), 3) * 0.75;   // ярких мало
    col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 26, sizeAttenuation: true, vertexColors: true, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  BG.scene.add(pts);
  BG.g.sky = pts;
}

// ── Поле: плоскость боя ─────────────────────────────────────
// Сплошной сетки НЕТ (см. концепцию: гексы — логика, а не декор). В плоскости
// лежат только зоны развёртывания и кромка поля; клетки проявляются точечно —
// под курсором и в досягаемости выбранного борта.
function bgBuildField() {
  const s = BB.st; if (!s) return;
  const { W, H } = bbWorldSize();
  const grp = new THREE.Group();
  const R = BB.R;

  // Дно арены — НЕ прямоугольная плита, а набор гексов самой формы боя.
  // Клетки за кромкой не рисуются вовсе: поле просто кончается, и по нему
  // читается силуэт арены (линза, долька, кольцо, перешеек, полумесяц).
  const meAtt = s.my_side === 'attacker';
  const hasSp = !!s.spawn;
  const z = s.zone || 3;
  const cells = [], zoneCells = { att: [], def: [] };
  for (let x = 0; x < s.w; x++) {
    for (let y = 0; y < s.h; y++) {
      if (!bbInArena(x, y)) continue;
      cells.push([x, y]);
      const k = hasSp
        ? (bbInSpawn('att', x, y) ? 'att' : (bbInSpawn('def', x, y) ? 'def' : null))
        : (x < z ? 'att' : (x >= s.w - z ? 'def' : null));
      if (k) zoneCells[k].push([x, y]);
    }
  }

  const lay = (list, geo, mat, yy) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    list.forEach(([x, y], i) => {
      const p = bbHexCenter(x, y);
      im.setMatrixAt(i, m.makeTranslation(p.px, yy, p.py));
    });
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    grp.add(im);
  };

  // дно: даёт кораблям фон и ловит границу арены
  lay(cells, bgHexFillGeo(R), new THREE.MeshBasicMaterial({
    color: 0x060a12, transparent: true, opacity: 0.62, depthWrite: false,
    side: THREE.DoubleSide }), -1);

  // сектора подхода — заливка там, откуда стороны реально входят в бой
  ['att', 'def'].forEach(k => {
    const mine = (k === 'att') === meAtt;
    lay(zoneCells[k], bgHexFillGeo(R), new THREE.MeshBasicMaterial({
      color: bgCol(mine ? BG_C.mine : BG_C.foe), transparent: true, opacity: 0.10,
      depthWrite: false, side: THREE.DoubleSide }), 0);
  });

  // кромка арены — по фактической границе формы, а не по прямоугольнику
  bgBuildRim(grp, cells);

  BG.scene.add(grp);
  BG.g.field = grp;

  // подсветка клетки под курсором — один переиспользуемый контур
  const hex = new THREE.LineLoop(bgHexGeo(BB.R * 0.92), new THREE.LineBasicMaterial({ color: 0x8cf0ff }));
  hex.visible = false;
  BG.scene.add(hex);
  BG.g.hover = hex;

  // отдельная группа под эффекты боя и следы: живёт своей жизнью, чистится
  // покадрово и никогда не попадает под пересборку поля
  const fx = new THREE.Group();
  BG.scene.add(fx);
  BG.g.fx = fx;
}

// Кромка арены: рёбра тех гексов, у которых сосед — пустота.
// Даёт живой рваный контур вместо прямоугольной рамки. Направление d смотрит
// на ребро между вершинами d и d+1 (углы 60°·d) — тот же расклад, что в bbStep.
function bgBuildRim(grp, cells) {
  const R = BB.R, pts = [];
  const V = i => { const a = Math.PI / 3 * (i % 6); return [Math.cos(a) * R, Math.sin(a) * R]; };
  cells.forEach(([x, y]) => {
    const c = bbHexCenter(x, y);
    for (let d = 0; d < 6; d++) {
      const n = bbStep(x, y, d);
      if (bbInArena(n.x, n.y)) continue;
      const a = V(d), b = V(d + 1);
      pts.push(new THREE.Vector3(c.px + a[0], 0, c.py + a[1]),
               new THREE.Vector3(c.px + b[0], 0, c.py + b[1]));
    }
  });
  if (!pts.length) return;
  const rim = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: BG_C.grid, transparent: true, opacity: 0.34 }));
  rim.frustumCulled = false;
  grp.add(rim);
}

// Контур гекса в плоскости XZ (flat-top, как в 2D-доске)
function bgHexGeo(r) {
  const p = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i;
    p.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return new THREE.BufferGeometry().setFromPoints(p);
}

// ════════════════════════════════════════════════════════════
// КАМЕРА
// ════════════════════════════════════════════════════════════
function bgApplyCam() {
  const c = BG.cam;
  const cp = Math.cos(BG.pitch), sp = Math.sin(BG.pitch);
  c.position.set(
    BG.tgt.x + Math.cos(BG.yaw) * cp * BG.dist,
    sp * BG.dist,
    BG.tgt.z + Math.sin(BG.yaw) * cp * BG.dist
  );
  c.lookAt(BG.tgt.x, 0, BG.tgt.z);
}

// Дистанция, с которой в кадр влезает прямоугольник w×h. Считаем ОБА габарита:
// по вертикали через fov, по горизонтали — через fov с поправкой на аспект.
// Раньше ширину мерили вертикальным углом, и на узком экране (телефон стоймя)
// поле резалось по бокам, а на широком камера отъезжала лишнего.
function bgFitDist(w, h, k) {
  const ty = Math.tan(BG.cam.fov * Math.PI / 360);
  const tx = ty * (BG.cam.aspect || 1);
  const m = k || 0.6;
  return Math.min(BG_DIST_MAX, Math.max(BG_DIST_MIN, Math.max((w * m) / tx, (h * m) / ty)));
}

function bgCamHome() {
  const s = BB.st; if (!s) return;
  const { W, H } = bbWorldSize();
  BG.tgt.x = W / 2; BG.tgt.z = H / 2;
  BG.dist = bgFitDist(W, H, 0.62);              // поле целиком, с запасом по краям
  BG.pitch = 0.92; BG.yaw = -Math.PI / 2;
  bgApplyCam(); BG.dirty = true; bgKick();
}

// ── ВРАЩЕНИЕ КАМЕРЫ ─────────────────────────────────────────
// РЕЖИМА ОБЗОРА БОЛЬШЕ НЕТ. Он переопределял один палец под вращение, и это
// дралось со всем остальным: щипок начинался уже подкрученной камерой, а
// выйти из режима было нечем, кроме той же кнопки, которую в разметке легко
// потерять. Правило теперь одно и без состояний: ОДИН палец всегда тянет
// поле, ДВА — зум и доворот, а точный поворот — кнопками-стрелками. На
// десктопе вращение осталось на ПКМ и Shift+перетаскивание.
// Шаг поворота кнопкой-стрелкой: четверть оборота с плавным доездом
function bgOrbitStep(dir) {
  BG.spin = { yaw0: BG.yaw, yaw1: BG.yaw + dir * Math.PI / 4, t0: performance.now(), dur: 320 };
  bgKick();
}

function bgResize() {
  if (!BG.renderer) return;
  const box = BG.cv.parentElement.getBoundingClientRect();
  const w = Math.max(240, Math.round(box.width)), h = Math.max(240, Math.round(box.height));
  BG.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  BG.renderer.setSize(w, h, false);
  BG.cam.aspect = w / h;
  BG.cam.updateProjectionMatrix();
  bgApplyCam();
  BG.dirty = true; bgKick();
}

// ════════════════════════════════════════════════════════════
// ВЫБОР КЛЕТКИ — РЕЙКАСТ
// ────────────────────────────────────────────────────────────
// Луч из курсора через матрицу камеры пересекается с плоскостью поля. Это ТОЧНО
// та же математика, которой сцена рисуется, поэтому курсор физически не может
// разойтись с клеткой — в отличие от подбора обратной формулы к CSS-перспективе.
// ════════════════════════════════════════════════════════════
const _bgRay = { rc: null, plane: null, hit: null };
function bgPickWorld(sx, sy) {
  if (!_bgRay.rc) {
    _bgRay.rc = new THREE.Raycaster();
    _bgRay.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    _bgRay.hit = new THREE.Vector3();
  }
  const r = BG.cv.getBoundingClientRect();
  const ndc = new THREE.Vector2(((sx) / r.width) * 2 - 1, -((sy) / r.height) * 2 + 1);
  _bgRay.rc.setFromCamera(ndc, BG.cam);
  const p = _bgRay.rc.ray.intersectPlane(_bgRay.plane, _bgRay.hit);
  if (!p) return null;                       // луч ушёл выше горизонта
  return { px: p.x, py: p.z };               // обратно в мировые координаты доски
}
function bgHexAt(sx, sy) {
  const w = bgPickWorld(sx, sy);
  return w ? bbHexFromWorld(w.px, w.py) : null;
}

// ════════════════════════════════════════════════════════════
// ВВОД: пан по плоскости, орбита, зум
// ════════════════════════════════════════════════════════════
function bgLocalXY(ev) {
  const r = BG.cv.getBoundingClientRect();
  return { sx: ev.clientX - r.left, sy: ev.clientY - r.top };
}

function bgBindInput() {
  const cv = BG.cv;
  cv.style.touchAction = 'none';

  cv.onpointerdown = ev => {
    cv.setPointerCapture(ev.pointerId);
    const p = bgLocalXY(ev);
    BG.ptrs.set(ev.pointerId, p);
    if (BG.ptrs.size === 2) {
      const [a, b] = [...BG.ptrs.values()];
      BG.pinch = {
        d: Math.hypot(a.sx - b.sx, a.sy - b.sy),
        mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2,
      };
      BG.drag = BG.orbit = null;
      return;
    }
    // ПКМ / Shift / включённый режим обзора — орбита, иначе тянем поле
    if (ev.button === 2 || ev.shiftKey) {
      BG.orbit = { sx: p.sx, sy: p.sy, yaw: BG.yaw, pitch: BG.pitch, moved: false };
      BG.drag = null;
    } else {
      const w = bgPickWorld(p.sx, p.sy);
      BG.drag = w ? { gx: w.px, gy: w.py, moved: false, sx: p.sx, sy: p.sy } : null;
      BG.orbit = null;
    }
    BG.camAnim = null;            // взялись за камеру — автодоворот не мешает
    ev.preventDefault();
  };

  cv.onpointermove = ev => {
    const p = bgLocalXY(ev);
    if (BG.ptrs.has(ev.pointerId)) BG.ptrs.set(ev.pointerId, p);

    if (BG.pinch && BG.ptrs.size >= 2) {
      const [a, b] = [...BG.ptrs.values()];
      const d = Math.hypot(a.sx - b.sx, a.sy - b.sy);
      const P = BG.pinch;
      if (d > 4 && P.d > 4) {
        const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
        // ТОЧКА ПОД ПАЛЬЦАМИ ОСТАЁТСЯ ПОД ПАЛЬЦАМИ. Раньше щипок менял только
        // дистанцию камеры, а она смотрит в центр экрана — поэтому приближалось
        // не то, что держат. Берём мировую точку под ПРЕЖНЕЙ серединой щипка,
        // меняем дистанцию, потом сдвигаем прицел так, чтобы та же точка легла
        // под НОВОЙ серединой: заодно получается панорама двумя пальцами.
        const before = bgPickWorld(P.mx, P.my);
        BG.dist = Math.max(BG_DIST_MIN, Math.min(BG_DIST_MAX, BG.dist * P.d / d));
        // ДОВОРОТА ЩИПКОМ НЕТ. Пальцы при сведении всегда чуть проворачиваются,
        // и камера уезжала вбок при обычном зуме — никакой порог этого не
        // лечит, только оттягивает. Щипок делает ровно две вещи: приближает и
        // возит поле. Поворот — кнопками ↺↻ (и ПКМ/Shift на десктопе).
        bgApplyCam();
        if (before) {
          const after = bgPickWorld(mx, my);
          if (after) {
            BG.tgt.x += before.px - after.px;
            BG.tgt.z += before.py - after.py;
            bgClampTarget();
          }
        }
        bgApplyCam();
        P.d = d; P.mx = mx; P.my = my;
        BG.camAnim = null;                      // игрок взялся за камеру — доворот отменяем
        BG.dirty = true; bgKick();
      }
      return;
    }
    if (BG.orbit) {
      const O = BG.orbit;
      if (Math.abs(p.sx - O.sx) + Math.abs(p.sy - O.sy) > 5) O.moved = true;
      BG.yaw = O.yaw + (p.sx - O.sx) * 0.006;
      BG.pitch = Math.max(BG_PITCH_MIN, Math.min(BG_PITCH_MAX, O.pitch + (p.sy - O.sy) * 0.005));
      BG.spin = null;                             // палец главнее кнопки
      bgApplyCam(); BG.dirty = true; bgKick();
      return;
    }
    if (BG.drag) {
      if (Math.abs(p.sx - BG.drag.sx) + Math.abs(p.sy - BG.drag.sy) > 5) BG.drag.moved = true;
      // ТЯНЕМ САМО ПОЛЕ: точка, за которую взялись, обязана остаться под курсором.
      // Поправка ИНКРЕМЕНТНАЯ — прицел двигаем на разницу между схваченной точкой
      // и той, что сейчас под курсором. Считать её от прицела на момент захвата
      // нельзя: рейкаст-то идёт уже сдвинутой камерой, поправка накладывалась
      // на саму себя, и камеру трясло. Сдвиг прицела в плоскости сдвигает
      // мировую точку под курсором ровно на столько же, поэтому шаг — точный.
      const w = bgPickWorld(p.sx, p.sy);
      if (w) {
        const dx = BG.drag.gx - w.px, dz = BG.drag.gy - w.py;
        const lim = BB.R * 400;                 // луч у самого горизонта даёт выброс
        if (Math.abs(dx) < lim && Math.abs(dz) < lim) {
          BG.tgt.x += dx; BG.tgt.z += dz;
          bgClampTarget();
          bgApplyCam(); BG.dirty = true; bgKick();
        }
      }
      return;
    }
    if (ev.pointerType === 'mouse') {
      const c = bgHexAt(p.sx, p.sy);
      const same = BG.hover && c && BG.hover.x === c.x && BG.hover.y === c.y;
      if (!same) {
        BG.hover = c;
        BB.hover = c;                           // превью маршрута читает BB.hover
        bgSyncHover();
        if (BB.sel != null) bgSyncOverlay();    // маршрут тянется за курсором
        BG.dirty = true; bgKick();
      }
    }
  };

  cv.onpointerup = ev => {
    const p = bgLocalXY(ev);
    BG.ptrs.delete(ev.pointerId);
    if (BG.ptrs.size < 2) BG.pinch = null;
    const d = BG.drag, o = BG.orbit;
    BG.drag = null; BG.orbit = null;
    // тап без протяжки = выбор гекса, в том числе в режиме обзора: иначе ради
    // каждого клика по борту пришлось бы гасить режим кнопкой
    const tap = (d && !d.moved) || (o && !o.moved);
    if (tap) {
      const c = bgHexAt(p.sx, p.sy);
      if (c && typeof bbClick === 'function') bbClick(c.x, c.y);
    }
  };
  cv.onpointercancel = ev => { BG.ptrs.delete(ev.pointerId); BG.drag = BG.orbit = null; BG.pinch = null; };
  cv.oncontextmenu = ev => ev.preventDefault();
  cv.onwheel = ev => {
    ev.preventDefault();
    const p = bgLocalXY(ev);
    bgZoomAnchor(BG.dist * (ev.deltaY < 0 ? 1 / 1.12 : 1.12), p.sx, p.sy);
  };
  window.addEventListener('resize', bgResize);
}

// Зум С ПРИВЯЗКОЙ К ТОЧКЕ ЭКРАНА: то, что под курсором (или под серединой
// щипка), там и остаётся. Камера смотрит в свой прицел, поэтому одной сменой
// дистанции не обойтись — прицел надо доподвинуть на разницу мировых точек.
function bgZoomAnchor(dist, sx, sy) {
  const before = bgPickWorld(sx, sy);
  BG.dist = Math.max(BG_DIST_MIN, Math.min(BG_DIST_MAX, dist));
  bgApplyCam();
  if (before) {
    const after = bgPickWorld(sx, sy);
    if (after) {
      BG.tgt.x += before.px - after.px;
      BG.tgt.z += before.py - after.py;
      bgClampTarget();
      bgApplyCam();
    }
  }
  BG.camAnim = null;
  BG.dirty = true; bgKick();
}

// Прицел камеры не уходит за пределы арены — иначе поле улетает из кадра и
// «вернуться» становится нечем.
function bgClampTarget() {
  const { W, H } = bbWorldSize();
  const pad = BB.R * 6;
  BG.tgt.x = Math.max(-pad, Math.min(W + pad, BG.tgt.x));
  BG.tgt.z = Math.max(-pad, Math.min(H + pad, BG.tgt.z));
}

function bgSyncHover() {
  const h = BG.g.hover; if (!h) return;
  if (!BG.hover) { h.visible = false; return; }
  const c = bbHexCenter(BG.hover.x, BG.hover.y);
  h.position.set(c.px, 1, c.py);
  h.visible = true;
}

// ════════════════════════════════════════════════════════════
// КОРПУСА — ЛОФТ ПО СТАНЦИЯМ
// ────────────────────────────────────────────────────────────
// Моделей в проекте нет и рисовать их не нужно: у каждого класса уже лежит
// профиль корпуса CN_SHIP_GEO[...].st — список [позиция вдоль корпуса,
// полуширина] от носа к корме. Это ровно те же силуэты, из которых собираются
// спрайты в 2D-доске, поэтому корабль в 3D останется УЗНАВАЕМО ТЕМ ЖЕ.
// Протягиваем по этому профилю кольца сечений и сшиваем в оболочку.
//
// Сечение — суперэллипс, а не круг: круглый лофт даёт колбасу, а корпус должен
// быть приплюснутым и с намёком на грани. Высота берётся долей от полуширины,
// иначе борт раздувается в трубу.
// СЕЧЕНИЕ КОРПУСА — НЕ КРУГ И НЕ СУПЕРЭЛЛИПС. Любая гладкая замкнутая кривая,
// протянутая по длине, даёт трубу: у неё нет ни палубы, ни скулы, ни днища, и
// корабль выглядит цилиндром, чем бы его ни красили. Поэтому сечение задано
// ЯВНЫМ ОБВОДОМ настоящего корпуса: плоская палуба сверху, завал борта внутрь,
// острая скула на миделе и почти плоское днище. Ребро скулы ловит свет
// отдельной полосой — именно оно и читается как «корабль», а не «болванка».
//
// Полуобвод (z ≥ 0) сверху вниз, в долях полуширины; y — в долях ПОЛУВЫСОТЫ.
const BG_HALF = [
  [0.00,  1.00],   // диаметральная плоскость, палуба
  [0.58,  0.96],   // палуба плоская почти до борта
  [0.86,  0.62],   // завал борта внутрь
  [1.00,  0.10],   // скула — самая широкая точка
  [0.88, -0.42],   // подзор
  [0.46, -0.72],   // переход в днище
  [0.00, -0.78],   // киль
];
const BG_RING = (BG_HALF.length - 1) * 2;    // вершин в сечении: обвод + зеркало
const BG_DECK = 0.62;        // полувысота корпуса (доля полуширины)
const BG_KEEL = 0.50;        // ↑ оставлено: на него смотрит старый код посадки
// Сколько раз обшивка укладывается вдоль корпуса и вокруг сечения. Считается
// в долях длины, поэтому у линкора плит физически больше, чем у корвета, а
// сама плита остаётся одного размера — по ней и читается масштаб борта.
const BG_PLATE_U = 14;
// ⚠️ ПОТОЛОК ВЕРТИКАЛИ. Всё навесное железо (мостик, ярусы, мачта, спонсоны,
// дюзы, турели) меряется ЛОКАЛЬНОЙ ПОЛУШИРИНОЙ борта — на нормальном вытянутом
// корпусе это верно: ширина и высота там одного порядка. Но корпус бывает
// ШИРОКИМ (станция, а особенно колосс, которому форму рисует игрок): там
// полуширина сравнима с ДЛИНОЙ, и та же формула давала мостик выше корабля и
// дюзу размером с сам борт. Высоту берём как min(полуширина, этот потолок) —
// доля от ДЛИНЫ, то есть от единственного размера, который у всех корпусов
// общий. Ширину не трогаем: она и должна быть шириной борта.
const BG_PLATE_V = 6;
// Потолок вертикали: ни один ярус надстройки, мачта или сопло не считаются от
// величины крупнее этой доли ДЛИНЫ корпуса.
const BG_VCAP = 0.085;

// Обход сечения: сначала правый борт сверху вниз, потом левый снизу вверх.
// Порядок важен — по нему сшиваются полосы и по нему же ложится развёртка.
function bgSection(k, hw, hh) {
  const n = BG_HALF.length;
  const p = (k < n) ? BG_HALF[k] : BG_HALF[BG_RING - k];
  const s = (k < n) ? 1 : -1;
  return { z: p[0] * hw * s, y: p[1] * (hh == null ? hw * BG_DECK : hh) };
}

// Тело с РАЗНЫМ сечением на концах: низ шире верха, корма шире носа. Всё
// навесное железо строится им, а не BoxGeometry — коробка с одинаковыми
// торцами и есть тот самый «квадратик», который видно за версту. Скос всего
// в четверть уже превращает её в надстройку.
// dl/dh — доли: во сколько верхняя грань уже и короче нижней; sx — сдвиг
// верхней грани вдоль корпуса (наклон башни к носу).
function bgTaper(l, h, w, kw, kl, sx) {
  kw = kw == null ? 0.72 : kw; kl = kl == null ? 0.86 : kl; sx = sx || 0;
  const hl = l / 2, hw = w / 2, hh = h / 2;
  const tl = hl * kl, tw = hw * kw;
  const V = [
    [-hl, -hh,  hw], [ hl, -hh,  hw], [ hl, -hh, -hw], [-hl, -hh, -hw],   // низ
    [sx - tl, hh,  tw], [sx + tl, hh,  tw], [sx + tl, hh, -tw], [sx - tl, hh, -tw], // верх
  ];
  const F = [
    [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],   // борта
    [4, 5, 6, 7], [3, 2, 1, 0],                               // крыша и днище
  ];
  const pos = [], uv = [], idx = [];
  F.forEach(f => {
    const b = pos.length / 3;
    f.forEach(vi => pos.push(V[vi][0], V[vi][1], V[vi][2]));
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Геометрия корпуса ЕДИНИЧНОЙ длины, нос смотрит в +X, центр в начале координат.
// Кэшируется по классу: борта одного класса делят одну геометрию на видеокарте.
// ⚠️ hull — МАСКА КОРПУСА «ИМПЕРСКОГО КОЛОССА». У этого класса силуэта не
// существует: корпус рисует игрок, и у каждого проекта он свой (bbGeo знает про
// это и умеет строить геометрию из маски, но ТОЛЬКО если маску ему передать).
// Раньше сюда приходил один ключ класса — и все колоссы на трёхмерной доске
// выходили чужим корпусом из фолбэка, хотя на плоской доске рисовались верно.
// По той же причине кэш ключуется маской, а не именем класса.
function bgHullGeo(cls, hull) {
  const cache = BG._hull || (BG._hull = {});
  const ck = bgHullKey(cls, hull);
  if (cache[ck]) return cache[ck];
  // ⚠️ КОЛОСС ЛОФТОМ НЕ СТРОИТСЯ. Обычный корпус — это ПРОФИЛЬ: одна полуширина
  // на шпангоут, и по нему честно натягивается оболочка. У колосса корпус —
  // МАСКА КЛЕТОК, которую игрок рисует сам: крылья, вилки, отростки. Свернуть её
  // в «полуширину на станцию» значит выкинуть всю форму и получить картофелину
  // (ровно это и выходило: нарисовал крест — в бою вышел батон). Поэтому его
  // корпус ВЫДАВЛИВАЕТСЯ ИЗ РЕАЛЬНОГО ОБВОДА — что нарисовано, то и летит.
  if (hull && hull.mask) { const g = bgColossusGeo(hull); if (g) { cache[ck] = g; return g; } }

  // bbGeo уже знает соответствие KV-класс → силуэт и запасной вариант
  const H = (typeof bbGeo === 'function') ? bbGeo(cls, hull) : null;
  const st = (H && H.st && H.st.length > 1) ? H.st : [[0, 0], [40, 16], [170, 40], [250, 30], [300, 20]];
  const tip = st[0][0], stern = st[st.length - 1][0];
  const L = (stern - tip) || 1;

  // станции по возрастанию, без дублей по длине
  const rows = [];
  for (const [y, hw] of st) {
    const u = (y - tip) / L;
    if (rows.length && Math.abs(rows[rows.length - 1].u - u) < 1e-4) { rows[rows.length - 1].hw = Math.max(rows[rows.length - 1].hw, hw / L); continue; }
    rows.push({ u, hw: hw / L });
  }

  // Кольцо замыкаем ДУБЛЁМ первой вершины (BG_RING+1 штук на сечение), а не
  // модулем по индексу: иначе на шве обшивки v скакала бы с конца атласа в
  // начало и последний ряд плит размазывало бы поперёк всего борта.
  const RN = BG_RING + 1;
  // плит вдоль борта — по РЕАЛЬНОЙ длине силуэта, а не по нормированной единице
  const pu = Math.max(3, Math.round(BG_PLATE_U * L / 300));
  // ВЫСОТА КОРПУСА НЕ РАВНА ШИРИНЕ. Если вести её от местной полуширины, к носу
  // борт схлопывается в иглу, а к корме в лепёшку — оттого и «сосиска». Высоту
  // ведём своим профилем от МАКСИМАЛЬНОЙ ширины: в носу корпус узкий в плане,
  // но остаётся высоким, то есть форштевень получается КЛИНОМ, как на корабле.
  const hwMax = Math.max(...rows.map(r => r.hw), 1e-4);
  const depth = u => bgDepthProfile(Math.min(hwMax, BG_VCAP), u);
  const pos = [], uv = [], idx = [];
  rows.forEach(rw => {
    const hw = Math.max(rw.hw, 1e-4);
    const hh = depth(rw.u);
    const x = 0.5 - rw.u;                       // нос (u=0) → +X, корма (u=1) → −X
    for (let k = 0; k < RN; k++) {
      const e = bgSection(k % BG_RING, hw, hh);
      pos.push(x, e.y, e.z);
      uv.push(rw.u * pu, (k / BG_RING) * BG_PLATE_V);
    }
  });
  // сшиваем соседние кольца в полосы четырёхугольников
  for (let r = 0; r < rows.length - 1; r++) {
    const a = r * RN, b = (r + 1) * RN;
    for (let k = 0; k < BG_RING; k++) {
      idx.push(a + k, b + k, a + k + 1);
      idx.push(a + k + 1, b + k, b + k + 1);
    }
  }
  // крышка кормы (нос сходится в точку сам — там полуширина 0)
  const last = (rows.length - 1) * RN;
  const cap = pos.length / 3;
  pos.push(0.5 - rows[rows.length - 1].u, 0, 0);
  uv.push(rows[rows.length - 1].u * pu, BG_PLATE_V * 0.5);
  for (let k = 0; k < BG_RING; k++) idx.push(last + k, cap, last + k + 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();                   // светотень: ради неё всё и делалось
  cache[ck] = geo;
  return geo;
}
// ── КОРПУС «ИМПЕРСКОГО КОЛОССА»: ОБЪЁМ ИЗ МАСКИ ──────────────────────────────
// Первая версия выдавливала обвод на постоянную толщину — и получался КИРПИЧ:
// плоская крышка, отвесные борта, одинаковая высота и у могучего ядра, и у
// тонкой консоли. Плита, а не корабль.
//
// Толщину задаёт РАССТОЯНИЕ ДО КРОМКИ. У настоящего корпуса нет постоянной
// высоты: он вспухает там, где широк, и утоньшается к обводу и к вылетам. Считаем
// по маске волновой обход от пустоты (сколько клеток до ближайшего края) и
// поднимаем поверхность по этому расстоянию. Тогда любой рисунок — хоть крест,
// хоть краб — сам получает киль по хребту и тонкие законцовки, а узкие консоли
// становятся рёбрами, а не брусками. Это работает на ЛЮБОЙ маске, включая те,
// которых ещё не нарисовали: никаких зашитых профилей.
//
// Высоты берутся В УЗЛАХ решётки (а не в клетках) и усредняются по четырём
// соседям — поверхность выходит слитной, без лестницы из ступенек на палубе.
// Обвод при этом остаётся ступенчатым: он и должен, это чертёж игрока.
// Днище — зеркало палубы, но мельче: сверху надстройка, снизу киль.
function bgColossusGeo(hull) {
  if (typeof cnColGeo !== 'function' || typeof cnColSane !== 'function'
      || typeof cnColUnpack !== 'function' || typeof cnColOrigin !== 'function'
      || typeof CN_DECK_CELL === 'undefined') return null;
  const HL = cnColSane(hull);
  let G, org;
  try { G = cnColGeo(HL); org = cnColOrigin(HL); } catch (e) { return null; }
  if (!G || !G.st || !G.st.length) return null;
  const W = HL.w, Hh = HL.h, N = W * Hh;
  const bits = cnColUnpack(HL.mask, N);
  const st = G.st, tip = st[0][0], stern = st[st.length - 1][0], L = (stern - tip) || 1;
  const C = CN_DECK_CELL, ox = org[0], oy = org[1];
  const hwMax = Math.max(...st.map(p => p[1])) / L;
  const th = Math.max(0.028, Math.min(0.095, hwMax * 0.5));   // полувысота ядра

  // 1) ВОЛНА ОТ КРОМКИ: d[i] — сколько клеток от i до ближайшей пустоты.
  const d = new Int32Array(N).fill(-1);
  const q = [];
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!bits[i]) continue;
    const edge = (x === 0 || y === 0 || x === W - 1 || y === Hh - 1)
      || !bits[i - 1] || !bits[i + 1] || !bits[i - W] || !bits[i + W];
    if (edge) { d[i] = 1; q.push(i); }
  }
  for (let h2 = 0; h2 < q.length; h2++) {
    const i = q[h2], x = i % W, y = (i / W) | 0;
    const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < Hh - 1 ? i + W : -1];
    for (const j of nb) { if (j < 0 || !bits[j] || d[j] >= 0) continue; d[j] = d[i] + 1; q.push(j); }
  }
  let dMax = 1; for (let i = 0; i < N; i++) if (d[i] > dMax) dMax = d[i];

  // 2) ПРОФИЛЬ. ⚠️ ПАДЕНИЕ ДОЛЖНО БЫТЬ МЕДЛЕННЫМ. Первая версия брала опорное
  // расстояние в 3-7 клеток: всё, что чуть глубже кромки, взлетало на полную
  // высоту, и палуба покрывалась пирамидами и гребнями — горный хребет, а не
  // корабль. Опора теперь — РЕАЛЬНАЯ глубина корпуса (максимум по всей маске),
  // поэтому высота меняется плавно через весь борт: полная только у самого ядра.
  // И нижняя граница высокая (0.45): корпус утоньшается к обводу, но не сходит
  // в лезвие — иначе тонкие консоли выглядят рваной бумагой.
  const dRef = Math.max(2, dMax);
  const prof = dv => {
    const t = Math.max(0, Math.min(1, dv / dRef));
    return 0.45 + 0.55 * t * t * (3 - 2 * t);           // сглаженная ступень
  };

  // 3) ВЫСОТА В УЗЛЕ: минимум по четырём смежным клеткам (пустая = кромка = 0),
  // поэтому у обвода поверхность садится на кромку и борт получает завал.
  const VW = W + 1;
  const hv = new Float32Array(VW * (Hh + 1));
  const dc = (x, y) => (x < 0 || y < 0 || x >= W || y >= Hh || !bits[y * W + x]) ? 0 : d[y * W + x];
  for (let y = 0; y <= Hh; y++) for (let x = 0; x <= W; x++) {
    const dv = Math.min(dc(x - 1, y - 1), dc(x, y - 1), dc(x - 1, y), dc(x, y));
    hv[y * VW + x] = th * prof(dv);
  }

  // 4) СШИВКА. Палуба и днище — по узлам; борта — вертикальной юбкой по тем
  // рёбрам, где клетка граничит с пустотой.
  // ⚠️ НАМОТКУ НЕ УГАДЫВАЕМ. Оси модели зеркальны сетке (+gy идёт в −X), и
  // выписанный руками порядок вершин у половины граней оказывался наизнанку:
  // такие грани отсекались, и корпус зиял дырами. Порядок теперь ВЫВОДИТСЯ:
  // считаем нормаль треугольника и разворачиваем его, если она смотрит не туда,
  // куда должна (палуба вверх, днище вниз, юбка наружу).
  const pos = [], uv = [], idx = [];
  const PX = x => (x - 160) / L;                        // поперёк корпуса → Z
  const PY = y => 0.5 - (y - tip) / L;                  // вдоль корпуса → X
  const KEEL = 0.62;                                    // днище мельче палубы
  const put = (gx, gy, up) => {
    const cx = ox + gx * C, cy = oy + gy * C;
    const t = hv[gy * VW + gx];
    pos.push(PY(cy), up ? t : -t * KEEL, PX(cx));
    uv.push(gx * (BG_PLATE_U / 12), gy * (BG_PLATE_U / 12));
    return pos.length / 3 - 1;
  };
  const P = (i, k) => pos[i * 3 + k];
  const tri = (a, b, c2, nx, ny, nz) => {
    const ux = P(b, 0) - P(a, 0), uy = P(b, 1) - P(a, 1), uz = P(b, 2) - P(a, 2);
    const vx = P(c2, 0) - P(a, 0), vy = P(c2, 1) - P(a, 1), vz = P(c2, 2) - P(a, 2);
    const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (dot < 0) idx.push(a, c2, b); else idx.push(a, b, c2);
  };
  const quad = (a, b, c2, e, nx, ny, nz) => { tri(a, b, c2, nx, ny, nz); tri(a, c2, e, nx, ny, nz); };
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    if (!bits[y * W + x]) continue;
    const a = put(x, y, 1), b = put(x + 1, y, 1), c2 = put(x + 1, y + 1, 1), e = put(x, y + 1, 1);
    quad(a, b, c2, e, 0, 1, 0);                          // палуба
    const a2 = put(x, y, 0), b2 = put(x + 1, y, 0), c3 = put(x + 1, y + 1, 0), e2 = put(x, y + 1, 0);
    quad(a2, b2, c3, e2, 0, -1, 0);                      // днище
    // юбка борта: наружу — в сторону пустой клетки
    const wall = (x1, y1, x2, y2, dgx, dgy) => {
      const t1 = put(x1, y1, 1), t2 = put(x2, y2, 1), b1 = put(x1, y1, 0), bb = put(x2, y2, 0);
      quad(t1, t2, bb, b1, -dgy, 0, dgx);                // (dgx,dgy) сетки → (−dgy, ·, dgx) модели
    };
    if (y === 0 || !bits[(y - 1) * W + x]) wall(x, y, x + 1, y, 0, -1);
    if (y === Hh - 1 || !bits[(y + 1) * W + x]) wall(x, y + 1, x + 1, y + 1, 0, 1);
    if (x === 0 || !bits[y * W + x - 1]) wall(x, y, x, y + 1, -1, 0);
    if (x === W - 1 || !bits[y * W + x + 1]) wall(x + 1, y, x + 1, y + 1, 1, 0);
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
// Ключ корпуса: класс, а у колосса — ещё и сама маска (у каждого проекта своя).
function bgHullKey(cls, hull) {
  return cls + (hull && hull.mask ? '|' + hull.w + 'x' + hull.h + ':' + hull.mask : '');
}

// Максимальная полуширина корпуса (в долях длины) — по ней сажаются надстройка
// и дюзы, чтобы они были пропорциональны классу, а не прибиты константой.
function bgHullBeam(cls, hull) {
  const H = (typeof bbGeo === 'function') ? bbGeo(cls, hull) : null;
  const st = (H && H.st && H.st.length > 1) ? H.st : [[0, 0], [300, 20]];
  const tip = st[0][0], stern = st[st.length - 1][0];
  const L = (stern - tip) || 1;
  return Math.max(...st.map(p => p[1])) / L;
}

// ПЛАН НАДСТРОЙКИ ПО КЛАССУ. Именованные профили — там, где класс узнаваем:
// у носителя плоская полётная палуба и островок сбоку-сверху, у линкора
// многоярусная башня с мачтой, у корвета один низкий колпак. Остальные классы
// (в том числе те, что появятся позже) разбираются запасным вариантом: имя
// класса свёрнуто в число и выбирает один из трёх типовых профилей — два
// разных класса не окажутся близнецами просто потому, что их забыли описать.
//
// tiers: ярусы снизу вверх, все размеры — ДОЛИ предыдущего яруса, поэтому
// профиль не зависит ни от ширины корпуса, ни от масштаба борта на доске.
const BG_DECK_PLANS = {
  corvette:  { x:-0.14, w:0.70, h:0.75, len:0.14, bridgeTier:0, bridge:'slit',
               tiers:[{w:1,h:1,l:1,dx:0}] },
  frigate:   { x:-0.13, w:0.80, h:1.00, len:0.17, bridgeTier:0, bridge:'slit',
               tiers:[{w:1,h:1,l:1,dx:0},{w:0.6,h:0.5,l:0.5,dx:0.15}] },
  destroyer: { x:-0.15, w:0.85, h:1.15, len:0.20, bridgeTier:1, bridge:'wrap', mast:0.7,
               tiers:[{w:1,h:0.6,l:1,dx:0},{w:0.7,h:0.7,l:0.6,dx:0.18}] },
  cruiser:   { x:-0.12, w:0.95, h:1.35, len:0.22, bridgeTier:1, bridge:'wrap', mast:0.9, pods:1,
               tiers:[{w:1,h:0.55,l:1,dx:0},{w:0.72,h:0.8,l:0.62,dx:0.16},{w:0.6,h:0.5,l:0.6,dx:0.1}] },
  battleship:{ x:-0.10, w:1.05, h:1.55, len:0.26, bridgeTier:2, bridge:'cupola', mast:1.1, pods:1,
               tiers:[{w:1,h:0.5,l:1,dx:0},{w:0.8,h:0.7,l:0.7,dx:0.12},{w:0.62,h:0.8,l:0.5,dx:0.1}] },
  carrier:   { x:-0.30, w:0.45, h:1.30, len:0.16, bridgeTier:1, bridge:'tower', mast:0.8,
               tiers:[{w:1,h:0.9,l:1,dx:0},{w:0.7,h:0.9,l:0.7,dx:0.1}], side:1 },
  station:   { x: 0.00, w:1.10, h:1.70, len:0.30, bridgeTier:1, bridge:'ring', mast:1.3, pods:1,
               tiers:[{w:1,h:0.7,l:1,dx:0},{w:0.7,h:1.0,l:0.7,dx:0}] },
  // Колосс — плита, а не корабль с высоким мостиком: башня в полкорпуса на нём
  // выглядела шляпой. Низкая рубка, никакой мачты и спонсонов: форму задаёт
  // корпус, который игрок нарисовал сам, — надстройка не должна с ней спорить.
  colossus:  { x:-0.16, w:0.55, h:0.55, len:0.13, bridgeTier:0, bridge:'slit',
               tiers:[{w:1,h:1,l:1,dx:0}] },
};
const BG_DECK_FALLBACK = [
  { x:-0.16, w:0.85, h:1.20, len:0.19, bridgeTier:0, bridge:'wrap',
    tiers:[{w:1,h:0.8,l:1,dx:0},{w:0.65,h:0.6,l:0.55,dx:0.14}] },
  { x:-0.12, w:0.75, h:1.40, len:0.16, bridgeTier:1, bridge:'cupola', mast:0.8,
    tiers:[{w:1,h:0.6,l:1,dx:0},{w:0.8,h:0.9,l:0.7,dx:0.2}] },
  { x:-0.20, w:1.00, h:1.00, len:0.24, bridgeTier:0, bridge:'slit', pods:1,
    tiers:[{w:1,h:1,l:1,dx:0}] },
];

function bgDeckPlan(cls) {
  const hull = (typeof BB_HULL !== 'undefined' && BB_HULL[cls]) || cls;
  const p = BG_DECK_PLANS[cls] || BG_DECK_PLANS[hull];
  if (p) return p;
  let s = 0;
  for (let i = 0; i < String(cls).length; i++) s = (s * 31 + String(cls).charCodeAt(i)) >>> 0;
  return BG_DECK_FALLBACK[s % BG_DECK_FALLBACK.length];
}

// Мостик. Форма — часть портрета класса: щель, опоясывающая галерея, носовой
// колпак, светящаяся башня-остров, кольцо командного поста. Всегда смотрит
// ВПЕРЁД (кроме кольца), поэтому продолжает работать указателем курса.
function bgBridge(grp, plan, glow, bx, by, bz, bh, bl, bw) {
  const add = (geo, x, y, z, rz) => {
    const m = new THREE.Mesh(geo, glow);
    m.position.set(x, y, bz + z); if (rz) m.rotation.z = rz;
    grp.add(m); return m;
  };
  const fx = bx + bl * 0.5;                     // передняя грань яруса
  switch (plan.bridge) {
    case 'slit':                                 // одна щель во всю грань
      add(new THREE.BoxGeometry(bl * 0.14, bh * 0.26, bw * 0.82), fx, by + bh * 0.14, 0);
      break;
    case 'wrap':                                 // галерея: перед + скулы
      add(new THREE.BoxGeometry(bl * 0.14, bh * 0.22, bw * 0.9), fx, by + bh * 0.18, 0);
      [-1, 1].forEach(o => add(new THREE.BoxGeometry(bl * 0.7, bh * 0.16, bw * 0.1),
        bx + bl * 0.1, by + bh * 0.18, o * bw * 0.5));
      break;
    case 'cupola':                               // носовой колпак-полусфера
      add(new THREE.SphereGeometry(bh * 0.3, 10, 8), fx, by + bh * 0.22, 0);
      add(new THREE.BoxGeometry(bl * 0.12, bh * 0.14, bw * 0.6), fx, by - bh * 0.1, 0);
      break;
    case 'tower':                                // остров носителя: вертикальные окна
      [-1, 0, 1].forEach(o => add(new THREE.BoxGeometry(bl * 0.12, bh * 0.55, bw * 0.16),
        fx, by, o * bw * 0.3));
      break;
    case 'ring':                                 // командный пост станции — по кругу
      add(new THREE.CylinderGeometry(bw * 0.62, bw * 0.62, bh * 0.16, 12), bx, by + bh * 0.2, 0);
      break;
  }
}

// UV коробок надстройки: у BoxGeometry развёртка 0..1 на грань, и лист брони
// натягивался бы на весь борт рубки одной плитой. Размножаем.
function bgUvTile(geo, n) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * n, uv.getY(i) * n);
  uv.needsUpdate = true;
}

// Профиль ВЫСОТЫ корпуса по длине. Вынесен отдельно, потому что по нему живёт
// не только лофт, но и всё, что садится на корму и палубу: разъедься они —
// моторный отсек снова полезет углами наружу.
function bgDepthProfile(hwMax, u) {
  const t = Math.min(1, Math.max(0, 0.18 + u * 0.74));
  return hwMax * BG_DECK * (0.52 + 0.48 * Math.sin(Math.PI * t));
}

// Полуширина корпуса В ЗАДАННОЙ ТОЧКЕ (x в тех же долях длины, что и меши:
// +0.5 нос, −0.5 корма). Всё навесное железо сажается по НЕЙ, а не по
// максимальной ширине борта: иначе кольцо на сужении торчит хомутом, а
// моторный отсек у острой кормы выглядит приваренным чемоданом.
function bgHullHW(cls, x, hull) {
  const H = (typeof bbGeo === 'function') ? bbGeo(cls, hull) : null;
  const st = (H && H.st && H.st.length > 1) ? H.st : [[0, 0], [40, 16], [170, 40], [250, 30], [300, 20]];
  const tip = st[0][0], stern = st[st.length - 1][0], L = (stern - tip) || 1;
  const u = Math.min(1, Math.max(0, 0.5 - x));         // x → доля длины от носа
  const y = tip + u * L;
  for (let i = 1; i < st.length; i++) {
    if (y <= st[i][0]) {
      const t = (y - st[i - 1][0]) / ((st[i][0] - st[i - 1][0]) || 1);
      return (st[i - 1][1] + (st[i][1] - st[i - 1][1]) * t) / L;
    }
  }
  return st[st.length - 1][1] / L;
}

function bgHullDepth(cls, x, hull) {
  const H = (typeof bbGeo === 'function') ? bbGeo(cls, hull) : null;
  const st = (H && H.st && H.st.length > 1) ? H.st : [[0, 0], [40, 16], [170, 40], [250, 30], [300, 20]];
  const L = (st[st.length - 1][0] - st[0][0]) || 1;
  // Колосс — плита по нарисованному обводу: его «полувысота» задана толщиной
  // плиты (bgColossusGeo), а не профилем лофта, иначе навеска висит над корпусом.
  if (hull && hull.mask) return Math.max(0.015, Math.min(0.055, (Math.max(...st.map(p => p[1])) / L) * 0.275));
  const hwMax = Math.min(Math.max(...st.map(p => p[1])) / L, BG_VCAP);
  return bgDepthProfile(hwMax, Math.min(1, Math.max(0, 0.5 - x)));
}

// СИЛУЭТ НАПРАВЛЕНИЯ. Голый лофт симметричен вдоль оси, и куда смотрит борт —
// не понять. Достраиваем два признака, которые читаются мгновенно и с любого
// ракурса: надстройка смещена К КОРМЕ (значит перед — там, где её нет) и
// светящиеся дюзы в самом хвосте.
function bgBuildShip(cls, mine, hullMask) {
  const grp = new THREE.Group();
  const beam = bgHullBeam(cls, hullMask);

  const hull = new THREE.Mesh(bgHullGeo(cls, hullMask), bgHullMat(mine));
  grp.add(hull);

  // ⚠️ КОРПУС, НАРИСОВАННЫЙ ИГРОКОМ, ДОСТРАИВАТЬ НЕЧЕМ. Всё, что ниже, — это
  // ПОРТРЕТ КЛАССА: типовая надстройка, мачта, хребет, шпангоуты, моторный
  // отсек. Они существуют, чтобы отличить корвет от линкора там, где форму
  // задаёт таблица. У колосса форму задаёт САМ ИГРОК — и любая такая достройка
  // это чужая башня, воткнутая сквозь его чертёж (а чем сложнее рисунок, тем
  // безобразнее она садится; рисунков будет много и они будут сложнее). Здесь
  // только корпус и дюзы: что нарисовал, то и летит. Начинку вешает палуба.
  if (hullMask && hullMask.mask) {
    grp.userData.hullParts = [hull];
    grp.userData.nz = bgSternJets(grp, cls, hullMask, beam);
    return grp;
  }

  // НАДСТРОЙКА СВОЯ У КАЖДОГО КЛАССА. Раньше на всех сидела одна коробка с
  // одинаковой полоской мостика, и корвет от линкора отличался только длиной.
  // Профиль берём детерминированно из имени класса (см. bgDeckPlan), поэтому
  // борт всегда собирается одинаково, но соседний класс выглядит другим.
  const plan = bgDeckPlan(cls);
  const parts = [hull];
  const hw = x => bgHullHW(cls, x, hullMask);    // полуширина борта в точке
  const depthAt = x => bgHullDepth(cls, x, hullMask);   // полувысота борта там же
  // ВЕРТИКАЛЬНАЯ МЕРА: полуширина, но не выше потолка (см. BG_VCAP). Всё, что
  // растёт вверх, считается от неё — иначе широкий корпус получает башню до неба.
  const vu = x => Math.min(hw(x), BG_VCAP);
  const deckAt = x => depthAt(x) * 0.92;         // палуба чуть ниже верхней кромки
  const deckY = deckAt(plan.x);
  const glow = bgGlowMat(mine ? 0x9fe8ff : 0xffc0d4, 0.9);

  // ярусы рубки: снизу широкий, кверху сужаются и сдвигаются к носу.
  // Ширина основания — от МЕСТНОЙ ширины палубы, поэтому рубка вписана в борт,
  // а не сидит на нём чемоданом.
  // side — надстройка съезжает к правому борту (островок носителя), центр палубы
  // при этом остаётся свободным, и класс читается сразу
  const zOff = plan.side ? hw(plan.x) * 0.5 : 0;
  let topY = deckY, topX = plan.x, topW = hw(plan.x) * 1.55 * plan.w, topL = plan.len;
  plan.tiers.forEach((t, i) => {
    const bw = topW * t.w, bh = vu(topX) * plan.h * t.h, bl = topL * t.l;
    const bx = topX + t.dx * topL, by = topY + bh * 0.5;
    // ярус со скосом и завалом к носу: у настоящей рубки нет вертикальных стен
    const box = new THREE.Mesh(bgTaper(bl, bh, bw, 0.66, 0.8, bl * 0.06), bgHullMat(mine));
    box.position.set(bx, by, zOff);
    bgUvTile(box.geometry, 3);
    grp.add(box); parts.push(box);
    // мостик ставим на ЯРУС ПЛАНА, а не всегда на первый: у одних он в основании
    // башни, у других — на самой макушке
    if (i === plan.bridgeTier) bgBridge(grp, plan, glow, bx, by, zOff, bh, bl, bw);
    topY += bh; topX = bx; topW = bw; topL = bl;
  });

  // мачта/сенсорная штанга поверх башни — есть не у всех
  if (plan.mast) {
    // Мачта меряется от ПАЛУБЫ, а не от накопленной высоты башни: иначе каждый
    // ярус подкидывал её выше, и на многоярусных классах вырастал шпиль.
    const mh = Math.min(vu(topX) * plan.h * plan.mast, deckY * 2.2);
    const ms = new THREE.Mesh(bgTaper(vu(topX) * 0.16, mh, vu(topX) * 0.16, 0.5, 0.5, 0), bgHullMat(mine));
    ms.position.set(topX, topY + mh * 0.5, zOff);
    grp.add(ms); parts.push(ms);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(vu(topX) * 0.13, 8, 6), bgGlowMat(mine ? 0x8fd8ff : 0xff9fbe, 0.7));
    dish.scale.set(1, 0.45, 1);
    dish.position.set(topX, topY + mh, zOff);
    grp.add(dish);
  }

  // спонсоны: наросты по бортам у корпусов, которые в 2D читаются «толстыми»
  if (plan.pods) {
    const px = plan.x + plan.len * 0.4;
    const pl = plan.len * 1.6, ph = vu(px) * 0.7, pw = Math.min(hw(px), BG_VCAP * 2) * 0.5;
    [-1, 1].forEach(o => {
      const p = new THREE.Mesh(bgTaper(pl, ph, pw, 0.55, 0.55, pl * 0.08), bgHullMat(mine));
      p.position.set(px, 0, o * hw(px) * 0.8);
      bgUvTile(p.geometry, 3);
      grp.add(p); parts.push(p);
    });
  }

  // НАВЕСНОЕ ЖЕЛЕЗО. Голый лофт сам по себе читается «батоном» с любого
  // ракурса: сплошная гладкая поверхность без единого ребра, за которое
  // цепляется глаз. Три накладки ломают её и дают масштаб.
  // 1) моторный отсек — корма перестаёт быть просто срезом трубы
  // КОРМА. Отсек был ШИРЕ корпуса (2.1 полуширины против 2.0) и вылезал за
  // обвод углами — отсюда «уродская жопа». Держим его строго внутри борта и
  // ведём размеры от ширины НА СВОЁМ шпангоуте, а не от миделя.
  const ew = hw(-0.42), eh = depthAt(-0.42);
  const eb = new THREE.Mesh(bgTaper(0.17, eh * 1.5, ew * 1.62, 0.82, 0.72, -0.012), bgHullMat(mine));
  eb.position.set(-0.41, -eh * 0.12, 0);
  bgUvTile(eb.geometry, 2);
  grp.add(eb); parts.push(eb);
  // 2) хребет: узкий гребень по палубе от рубки к носу — линия, вдоль которой
  //    видно и длину борта, и его курс
  const sx = plan.x + 0.26;
  const sp = new THREE.Mesh(bgTaper(0.4, vu(sx) * 0.34, Math.min(hw(sx), BG_VCAP * 2) * 0.5, 0.5, 0.62, 0.03), bgHullMat(mine));
  sp.position.set(sx, deckAt(sx) * 0.7, 0);
  bgUvTile(sp.geometry, 3);
  grp.add(sp); parts.push(sp);
  // 3) пояса-шпангоуты: два кольца поперёк корпуса. Дёшево (по 12 граней) и
  //    именно они превращают гладкую оболочку в сваренный из секций корпус
  [0.16, -0.14].forEach(px => {
    const r = hw(px);
    // накладка повторяет ОБВОД сечения (тот же bgSection), поэтому лежит на
    // шкуре поясом, а не надета бубликом, как было с цилиндром
    const pts = [];
    for (let k = 0; k < BG_RING; k++) { const e = bgSection(k, r * 1.04, r * BG_DECK * 1.06); pts.push(new THREE.Vector2(e.z, e.y)); }
    const sh = new THREE.Shape(pts);
    const rb = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: false }), bgHullMat(mine));
    rb.rotation.y = Math.PI / 2;
    rb.position.set(px + 0.011, 0, 0);
    grp.add(rb); parts.push(rb);
  });
  // ходовые огни по скулам: в темноте арены борт получает контур
  [-1, 1].forEach(o => {
    const lp = new THREE.Mesh(new THREE.BoxGeometry(0.3, vu(0.05) * 0.06, vu(0.05) * 0.06),
      bgGlowMat(mine ? 0x6fd8ff : 0xff8fb0, 0.6));
    lp.position.set(0.05, vu(0.05) * 0.2, o * hw(0.05) * 0.86);
    grp.add(lp);
  });

  grp.userData.hullParts = parts;               // им меняют материал, когда борт отходил

  // дюзы: раскалённые сопла в срезе кормы — самый сильный указатель «зад тут».
  // Держим их списком: на ходу факел вытягивается, и это единственное, что
  // отличает идущий борт от стоящего, когда след ушёл за корму из кадра.
  // Дюзы — по ВЫСОТЕ кормы, а не по её ширине: на широком корпусе сопло по
  // полуширине вырастало в оранжевое пятно во весь борт.
  grp.userData.nz = bgSternJets(grp, cls, hullMask, beam);
  return grp;
}

// ⚠️ РАЗМЕР СОПЛА — ПО ВЫСОТЕ КОРМЫ, А НЕ ПО ЕЁ ШИРИНЕ. Раньше он шёл от
// полуширины: на вытянутом корвете это выглядело верно, а на широком борте
// (носитель, станция, колосс) полуширина сопоставима с ДЛИНОЙ корабля — и три
// сопла превращались в оранжевые блины во весь борт. Дюза не может быть толще
// самой кормы: от её высоты и считаем, с жёстким потолком в долях длины.
function bgSternJets(grp, cls, hullMask, beam) {
  const d = bgHullDepth(cls, -0.48, hullMask);       // полувысота кормы
  const hw = bgHullHW(cls, -0.48, hullMask);         // и её полуширина
  const nz = Math.max(0.006, Math.min(d * 0.62, hw * 0.34, 0.05));
  const jets = [];
  [-1, 0, 1].forEach(o => {
    if (o !== 0 && beam < 0.06) return;         // у мелочи одно сопло
    const e = new THREE.Mesh(
      new THREE.CylinderGeometry(nz * 0.42, nz * 0.9, Math.min(0.06, nz * 1.8), 8),
      bgGlowMat(0xffb469, 1.5)
    );
    e.rotation.z = Math.PI / 2;                 // ось сопла вдоль корпуса
    e.position.set(-0.5 + 0.02, -nz * 0.12, o * nz * 1.25);
    grp.add(e);
    jets.push(e);
  });
  return jets;
}

// Самосветящийся материал: свет от него не зависит от освещения сцены, поэтому
// дюзы и мостик горят даже с теневого борта — иначе указатель направления
// пропадал ровно тогда, когда он нужнее всего.
function bgGlowMat(hex, i) {
  const cache = BG._glowMat || (BG._glowMat = {});
  const k = hex + '|' + i;
  if (cache[k]) return cache[k];
  cache[k] = new THREE.MeshBasicMaterial({ color: hex });
  return cache[k];
}

// Синхронизация состава: борта ПЕРЕЖИВАЮТ обновление состояния. Пересобирать
// группу целиком (как было в каркасе) нельзя — снимок с сервера приходит ровно
// в тот момент, когда bbDiffAnimate заводит твины перемещения, и корабль,
// потерявший объект сцены, обрывал бы полёт на середине. Поэтому сверяем состав
// по id: новые заводим, выбывших снимаем, остальных не трогаем.
function bgSyncUnits() {
  const s = BB.st; if (!s || !BG.scene) return;
  if (!BG.g.units) { BG.g.units = new THREE.Group(); BG.scene.add(BG.g.units); }
  const live = new Set();
  (s.units || []).forEach(u => {
    live.add(u.id);
    // Маска корпуса колосса живёт в дизайне, а не в юните — достаём тем же
    // путём, что и 2D (bbDesignOf), иначе 3D покажет чужой борт.
    const uh = u.contact ? null : bgUnitHull(u);
    const key = (u.contact ? '?' : bgHullKey(u.cls, uh)) + '|' + (u.mine ? 1 : 0);
    let m = BG.units.get(u.id);
    if (m && m.userData.key !== key) { bgDropUnit(u.id); m = null; }   // сменился класс/сторона/захват
    if (!m) {
      // неопознанный контакт: отметка на радаре без ТТХ и без корпуса —
      // сервер не отдал класс, и рисовать «какой-нибудь» корабль нельзя
      const L = u.contact ? BB.R * 0.8
        : BB.R * (0.75 + (typeof bbClsSize === 'function' ? bbClsSize(u.cls) : 1) * 1.15) * BG_SHIP_K;
      m = u.contact ? bgBuildContact() : bgBuildShip(u.cls, u.mine, uh);
      m.scale.setScalar(L);
      m.userData.key = key; m.userData.uid = u.id;
      m.userData.L = L;
      m.userData.y = u.contact ? BB.R * 0.3 : L * 0.12;   // высота килем над плоскостью
      BG.g.units.add(m);
      BG.units.set(u.id, m);
    }
  });
  BG.units.forEach((m, id) => { if (!live.has(id)) bgDropUnit(id); });
  bgPlaceUnits();
  BG.dirty = true; bgKick();
}

// Свой корпус колосса по юниту: у остальных классов силуэт задан классом.
function bgUnitHull(u) {
  if (!u || u.cls !== 'colossus' || typeof bbDesignOf !== 'function') return null;
  const d = bbDesignOf(u.name, u.cls);
  return (d && d.data && d.data.hull) ? d.data.hull : null;
}

function bgDropUnit(id) {
  const m = BG.units.get(id);
  if (m) { BG.g.units.remove(m); BG.units.delete(id); }   // геометрия/материалы общие — не чистим
  const tr = BG.trail.get(id);
  if (tr) { BG.g.fx.remove(tr); tr.material.dispose(); BG.trail.delete(id); }
}

// Посадка бортов на доску. Координату берём НЕ из гекса, а из bbUnitCenter —
// та же функция, по которой едет 2D-доска: если у борта активен твин, она
// вернёт точку на маршруте и курс с доворотом. Отсюда движение в 3D бесплатно
// совпадает с 2D покадрово, а не «примерно похоже».
function bgPlaceUnits() {
  const s = BB.st; if (!s) return;
  const forming = s.status === 'forming';
  (s.units || []).forEach(u => {
    const m = BG.units.get(u.id); if (!m) return;
    // Курс по стороне для всех, кто ещё НЕ маневрировал: флоты смотрят
    // навстречу, даже если сервер проставил facing иначе (зеркало bbPaintUnits).
    const uu = (!u.contact && (forming || !bbEverMoved(u)))
      ? Object.assign({}, u, { facing: bbSideFacing(u.side) }) : u;
    const c = bbUnitCenter(uu);
    m.position.set(c.px, m.userData.y, c.py);
    m.rotation.y = -c.ang;                      // 2D-угол по часовой → поворот вокруг Y против
    if (u.contact) return;                      // у отметки нет ни курса, ни дюз, ни следа
    const moving = u.id != null && BB.anim.move.has(u.id);
    if (moving !== m.userData.mv) {
      m.userData.mv = moving;
      (m.userData.nz || []).forEach(e => e.scale.set(1, moving ? 2.3 : 1, 1));
    }
    bgTrail(u, m, c.ang, moving);
  });
  bgPlaceStatus();
}

// Отметка неопознанного контакта: ромб со знаком вопроса, всегда к зрителю
function bgBuildContact() {
  const grp = new THREE.Group();
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: bgTexContact(), color: bgCol(BG_C.foe), transparent: true,
    opacity: 0.9, depthWrite: false }));
  grp.add(sp);
  return grp;
}

// Выхлопной след: лента за кормой на время скольжения между гексами. Ленты
// живут в пуле по id борта — создавать и выбрасывать их каждый ход накладно,
// а гасить видимостью бесплатно.
function bgTrail(u, m, ang, moving) {
  let tr = BG.trail.get(u.id);
  if (!moving) { if (tr) tr.visible = false; return; }
  if (!tr) {
    tr = bgRibbon(bgTexTrail(), u.mine ? BG_C.mine : BG_C.foe, 0.55);
    BG.g.fx.add(tr);
    BG.trail.set(u.id, tr);
  }
  tr.visible = true;
  const len = BB.R * 1.9 * BG_FX_K;
  const p = m.position;
  bgAimRibbon(tr, p.x, p.y, p.z, p.x - Math.cos(ang) * len, p.y, p.z - Math.sin(ang) * len, BB.R * 0.30 * BG_FX_K);
}

// Материал корпуса. Сталь тёмная и НЕЙТРАЛЬНАЯ: если красить весь борт в цвет
// стороны, корабли превращаются в цветные игрушки. Принадлежность читается
// подсветкой снизу и оснасткой, а не заливкой всего корпуса.
// dim — борт уже отходил в этом ходу: в 2D он гасился до alpha 0.5, здесь
// вместо прозрачности гаснет сама сталь. Прозрачный корпус в 3D показал бы
// собственные внутренности и потерял бы светотень, ради которой всё затевалось.
// Обшивка. Печём на канвасе бесшовный лист брони: расшивка панелей, чуть
// разный тон соседних плит, потёртости по швам. Лист СЕРЫЙ — цвет и сторону
// по-прежнему задаёт материал, поэтому одна текстура обслуживает оба флота.
// Она же идёт в bumpMap: расшивка ловит бортовой свет и корпус перестаёт быть
// гладкой болванкой, ради чего всё и делалось.
function bgTexPlate() {
  return bgTex('plate', 256, 256, (x, w) => {
    const rnd = (() => { let s = 0x2f6a5b; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    x.fillStyle = '#c9c9c9'; x.fillRect(0, 0, w, w);
    // плиты: сетка 4×4 с лёгким разбросом тона — «сварено из листов»
    const N = 4, c = w / N;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const v = 178 + Math.round(rnd() * 60);
      x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      x.fillRect(i * c + 1, j * c + 1, c - 2, c - 2);
    }
    // расшивка: тёмный шов + светлая фаска сразу под ним
    x.lineWidth = 3; x.strokeStyle = 'rgba(22,26,32,0.95)';
    for (let i = 0; i <= N; i++) {
      x.beginPath(); x.moveTo(i * c, 0); x.lineTo(i * c, w); x.stroke();
      x.beginPath(); x.moveTo(0, i * c); x.lineTo(w, i * c); x.stroke();
    }
    x.lineWidth = 1; x.strokeStyle = 'rgba(215,220,228,0.35)';
    for (let i = 0; i <= N; i++) {
      x.beginPath(); x.moveTo(i * c + 1.5, 0); x.lineTo(i * c + 1.5, w); x.stroke();
      x.beginPath(); x.moveTo(0, i * c + 1.5); x.lineTo(w, i * c + 1.5); x.stroke();
    }
    // лючки и потёртости; всё внутри плиты, чтобы шов тайла остался чистым
    for (let n = 0; n < 26; n++) {
      const px = rnd() * w, py = rnd() * w, s = 2 + rnd() * 7;
      x.fillStyle = rnd() < 0.5 ? 'rgba(60,64,70,0.45)' : 'rgba(205,210,218,0.25)';
      x.fillRect(px, py, s, s * (0.4 + rnd()));
    }
  });
}

function bgHullMat(mine, dim, ghost) {
  const cache = BG._hullMat || (BG._hullMat = {});
  const k = (mine ? 'mine' : 'foe') + (dim ? '-dim' : '') + (ghost ? '-gh' : '');
  if (cache[k]) return cache[k];
  const tex = bgTexPlate().clone();
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;                            // иначе к корме плиты слипаются в кашу
  tex.colorSpace = THREE.SRGBColorSpace;
  cache[k] = new THREE.MeshStandardMaterial({
    map: tex, bumpMap: tex, bumpScale: dim ? 0.2 : 0.45,
    color: mine ? (dim ? 0x445260 : 0x8fa6b8) : (dim ? 0x564850 : 0xa8909a),
    metalness: 0.62, roughness: dim ? 0.62 : 0.44,
    emissive: mine ? BG_C.mine : BG_C.foe,
    emissiveIntensity: dim ? 0.02 : 0.055,     // еле тлеет: намёк на сторону, не заливка
    transparent: !!ghost, opacity: ghost ? 0.45 : 1, depthWrite: !ghost,
  });
  return cache[k];
}

// ════════════════════════════════════════════════════════════
// РАСХОДНИКИ ЭФФЕКТОВ: текстуры, цвета, ленты
// ────────────────────────────────────────────────────────────
// Картинок в проект не добавляем — все засветки печём на канвасе при первом
// обращении и держим по ключу. Текстуры БЕЛЫЕ: цвет даёт материал, поэтому один
// «блик» обслуживает и бирюзовый залп, и малиновый, и оранжевый взрыв.
// ════════════════════════════════════════════════════════════
function bgTex(key, w, h, draw) {
  const cache = BG._tex || (BG._tex = {});
  if (cache[key]) return cache[key];
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return (cache[key] = t);
}

// Мягкий шар: ядро взрыва, дульная вспышка, искра, головка снаряда
function bgTexGlow() {
  return bgTex('glow', 128, 128, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.72)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.78, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, w);
  });
}
// Ударная волна: тонкое кольцо со спадом внутрь
function bgTexRing() {
  return bgTex('ring', 128, 128, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.70, 'rgba(255,255,255,0)');
    g.addColorStop(0.87, 'rgba(255,255,255,1)');
    g.addColorStop(0.96, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, w);
  });
}
// Сечение трассера ПОПЕРЁК луча: раскалённая нить в середине, спад к краям.
// Профиль запечён в текстуру, а не набран тремя линиями разной толщины, как в
// 2D: линии в перспективе разъезжаются по ширине, текстура — нет.
function bgTexBeam() {
  return bgTex('beam', 8, 64, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.28, 'rgba(255,255,255,0.14)');
    g.addColorStop(0.44, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(0.56, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });
}
// Выхлопной след: ярко у дюз, в ничто к хвосту, с мягкими краями поперёк
function bgTexTrail() {
  return bgTex('trail', 64, 16, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const m = x.createLinearGradient(0, 0, 0, h);   // размыть кромки ленты
    m.addColorStop(0, 'rgba(0,0,0,0)');
    m.addColorStop(0.5, 'rgba(0,0,0,1)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalCompositeOperation = 'destination-in';
    x.fillStyle = m; x.fillRect(0, 0, w, h);
  });
}

// ── ТЕКСТ В СЦЕНЕ ───────────────────────────────────────────
// Надписи — спрайты, а не DOM-накладки: спрайт живёт в глубине, поэтому имя
// борта честно уезжает за астероид, а всплывающее число урона остаётся на своей
// высоте, а не липнет к экрану. Плата — текстура на каждую строку, поэтому они
// кэшируются по самой строке: имена бортов повторяются от кадра к кадру, а
// числа урона — от залпа к залпу.
function bgTexText(str) {
  const cache = BG._txt || (BG._txt = {});
  if (cache[str]) return cache[str];
  const F = 48, pad = 12, font = '600 ' + F + 'px system-ui, "Segoe UI", sans-serif';
  const cv = document.createElement('canvas');
  const x = cv.getContext('2d');
  x.font = font;
  const w = Math.max(8, Math.ceil(x.measureText(str).width)) + pad * 2, h = F + pad * 2;
  cv.width = w; cv.height = h;
  x.font = font;                               // смена размера канваса сбрасывает контекст
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineJoin = 'round'; x.lineWidth = F * 0.18;
  x.strokeStyle = 'rgba(0,0,0,0.85)';          // обводка: текст читается на любом фоне
  x.strokeText(str, w / 2, h / 2);
  x.fillStyle = '#ffffff';
  x.fillText(str, w / 2, h / 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData = { w, h };
  return (cache[str] = t);
}

function bgTextSprite(str, col, h, opa) {
  const t = bgTexText(str);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: t, color: col, transparent: true, opacity: opa == null ? 0.85 : opa,
    depthWrite: false, depthTest: false }));
  sp.scale.set(h * t.userData.w / t.userData.h, h, 1);
  return sp;
}

// ── ПОДПИСЬ БОРТА: ГЕРБ ДЕРЖАВЫ + ИМЯ ───────────────────────
// Имя борта не говорит, ЧЕЙ он: на стороне бывает не одна держава (дуэли
// клуба, боты, союзники). Поэтому перед именем идёт герб владельца.
//
// Герб ВПЕКАЕТСЯ В ТУ ЖЕ ТЕКСТУРУ, что и имя, а не висит отдельным спрайтом:
// отдельный спрайт приходилось растить до читаемого размера, и он лез на
// полоски корпуса и щита. В общей текстуре он ровно в высоту строки — выше
// подписи ничего не занимает и от имени не отрывается.
// Цвет стороны запекается в САМ ТЕКСТ (материал остаётся белым) — иначе
// тонировка спрайта перекрасила бы и герб.
// Герб приезжает сетью, поэтому канва перерисовывается по onload.
// crossOrigin ОБЯЗАТЕЛЕН: канвой с «грязной» картинкой WebGL текстуру не
// зальёт (Storage отдаёт CORS-заголовки, как для берега рыбалки).
function bgLabelKey(str, fid, col) {
  const f = (fid && typeof bbFacOf === 'function') ? bbFacOf({ fid }) : null;
  return col + '|' + (fid || '') + '|' + ((f && f.herald) || '') + '|' + str;
}
function bgTexLabel(str, fid, col) {
  const cache = BG._lbl || (BG._lbl = {});
  const key = bgLabelKey(str, fid, col);
  if (cache[key]) return cache[key];
  const f = (fid && typeof bbFacOf === 'function') ? bbFacOf({ fid }) : null;
  const F = 48, pad = 12, gap = 10, E = f ? F : 0;   // герб = ровно высота строки
  const font = '600 ' + F + 'px system-ui, "Segoe UI", sans-serif';
  const cv = document.createElement('canvas');
  const m = cv.getContext('2d');
  m.font = font;
  const tw = Math.max(8, Math.ceil(m.measureText(str).width));
  const w = pad * 2 + tw + (E ? E + gap : 0), h = F + pad * 2;
  cv.width = w; cv.height = h;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData = { w, h };
  const css = '#' + ('000000' + (col >>> 0).toString(16)).slice(-6);
  const paint = im => {
    const x = cv.getContext('2d');
    x.clearRect(0, 0, w, h);
    if (E) {
      const ey = (h - E) / 2;
      x.fillStyle = 'rgba(4,8,14,0.8)';                  // кайма: щиток читается на любом фоне
      x.fillRect(pad - 3, ey - 3, E + 6, E + 6);
      x.fillStyle = (typeof bbFacCol === 'function') ? bbFacCol(f && f.color) : '#33506a';
      x.fillRect(pad, ey, E, E);
      if (im) {
        // cover-fit по короткой стороне: герб не мнётся и не оставляет полей
        const k = Math.max(E / im.naturalWidth, E / im.naturalHeight);
        const iw = im.naturalWidth * k, ih = im.naturalHeight * k;
        x.save();
        x.beginPath(); x.rect(pad, ey, E, E); x.clip();
        x.drawImage(im, pad + (E - iw) / 2, ey + (E - ih) / 2, iw, ih);
        x.restore();
      } else {
        x.fillStyle = '#061018';
        x.font = '700 ' + Math.round(F * 0.44) + 'px system-ui, "Segoe UI", sans-serif';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText((typeof bbFacIni === 'function') ? bbFacIni(f && f.name) : '?', pad + E / 2, h / 2 + 1);
      }
    }
    x.font = font; x.textAlign = 'left'; x.textBaseline = 'middle';
    x.lineJoin = 'round'; x.lineWidth = F * 0.18;
    x.strokeStyle = 'rgba(0,0,0,0.85)';                  // обводка: текст читается на любом фоне
    const tx = pad + (E ? E + gap : 0);
    x.strokeText(str, tx, h / 2);
    x.fillStyle = css;
    x.fillText(str, tx, h / 2);
    t.needsUpdate = true;
  };
  paint(null);
  if (f && f.herald) {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => { try { paint(im); } catch (e) {} bgPaint(); };
    im.src = f.herald;                                   // не доехал — остаёмся на щитке с инициалами
  }
  return (cache[key] = t);
}
// Подпись борта целиком. Материал БЕЛЫЙ: цвет стороны уже в тексте.
function bgLabelSprite(str, fid, col, h, opa) {
  const t = bgTexLabel(str, fid, col);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: t, transparent: true, opacity: opa == null ? 0.9 : opa,
    depthWrite: false, depthTest: false }));
  sp.scale.set(h * t.userData.w / t.userData.h, h, 1);
  return sp;
}

// Цвета эффектов приходят из 2D-доски строкой «r,g,b» (BB_C.mine и т.п.).
// Прогоняем через setStyle, а не через конструктор с числами: тот принимает
// линейные значения, и бирюза выцвела бы относительно 2D-доски.
function bgCol(c) {
  const cache = BG._col || (BG._col = {});
  const k = String(c);
  if (cache[k]) return cache[k];
  let col;
  if (typeof c === 'number') col = new THREE.Color(c);
  else if (/^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/.test(k)) col = new THREE.Color().setStyle('rgb(' + k + ')');
  else { col = new THREE.Color(); try { col.setStyle(k); } catch (e) { col.set(0xffffff); } }
  return (cache[k] = col);
}

function bgSprite(tex, col, opa) {
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: col, transparent: true, opacity: opa == null ? 1 : opa,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
}

// Лента — квад, натянутый между двумя точками и развёрнутый ребром к камере.
// Толстых линий в WebGL нет (linewidth игнорируется почти везде), поэтому
// трассер и след — именно квады.
function bgRibbon(tex, col, opa) {
  const geo = BG._quad || (BG._quad = new THREE.PlaneGeometry(1, 1));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex, color: col, transparent: true, opacity: opa == null ? 1 : opa,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
}

// Базис ленты: локальный X — вдоль луча, Y — поперёк и перпендикулярно взгляду
// (иначе на просвет лента схлопывается в нить), Z достраивается до правой тройки.
const _bgB = {};
function bgAimRibbon(mesh, ax, ay, az, bx, by, bz, w) {
  if (!_bgB.x) {
    _bgB.x = new THREE.Vector3(); _bgB.y = new THREE.Vector3();
    _bgB.z = new THREE.Vector3(); _bgB.m = new THREE.Vector3();
    _bgB.mat = new THREE.Matrix4();
  }
  const B = _bgB;
  B.x.set(bx - ax, by - ay, bz - az);
  const len = B.x.length() || 1e-3;
  B.x.multiplyScalar(1 / len);
  B.m.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  B.z.copy(BG.cam.position).sub(B.m);
  B.y.crossVectors(B.z, B.x);
  if (B.y.lengthSq() < 1e-9) B.y.set(0, 1, 0);      // луч смотрит точно в объектив
  B.y.normalize();
  B.z.crossVectors(B.x, B.y);
  B.mat.makeBasis(B.x, B.y, B.z);
  mesh.quaternion.setFromRotationMatrix(B.mat);
  mesh.position.copy(B.m);
  mesh.scale.set(len, w, 1);
}

// Высота, на которой идёт бой: примерно середина корпуса. Трассеры должны
// проходить сквозь борта, а не под килем.
function bgFxY() { return BB.R * 0.22 * BG_FX_K; }

// Положить квад ПЛАШМЯ в плоскость доски: нормаль вверх, локальный X — вдоль
// (dx,dz). Через него ложатся подсветка, кромочная тьма и всё, что в 2D было
// просто заливкой прямоугольника.
const _bgF = {};
function bgLayFlat(mesh, cx, y, cz, w, h, dx, dz) {
  if (!_bgF.x) {
    _bgF.x = new THREE.Vector3(); _bgF.y = new THREE.Vector3();
    _bgF.z = new THREE.Vector3(0, 1, 0); _bgF.m = new THREE.Matrix4();
  }
  const F = _bgF;
  F.x.set(dx == null ? 1 : dx, 0, dz || 0).normalize();
  F.y.crossVectors(F.z, F.x);
  F.m.makeBasis(F.x, F.y, F.z);
  mesh.quaternion.setFromRotationMatrix(F.m);
  mesh.position.set(cx, y, cz);
  mesh.scale.set(w, h, 1);
}

// Полоса затухания: тьма у внешней кромки, прозрачность внутрь
function bgTexFade() {
  return bgTex('fade', 64, 8, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(2,4,9,0.94)');
    g.addColorStop(0.55, 'rgba(2,4,9,0.45)');
    g.addColorStop(1, 'rgba(2,4,9,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });
}
// Ромб неопознанного контакта со знаком вопроса — единственный текст на доске,
// который печётся в текстуру: он один на все контакты и не меняется.
function bgTexContact() {
  return bgTex('contact', 128, 128, (x, w) => {
    const c = w / 2, r = w * 0.40;
    x.beginPath();
    x.moveTo(c, c - r); x.lineTo(c + r, c); x.lineTo(c, c + r); x.lineTo(c - r, c);
    x.closePath();
    x.fillStyle = 'rgba(255,255,255,0.16)'; x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = w * 0.035;
    x.setLineDash([w * 0.06, w * 0.05]); x.stroke(); x.setLineDash([]);
    x.fillStyle = 'rgba(255,255,255,0.95)';
    x.font = 'bold ' + Math.round(w * 0.38) + 'px monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('?', c, c + w * 0.02);
  });
}

// ════════════════════════════════════════════════════════════
// ЭФФЕКТЫ БОЯ
// ────────────────────────────────────────────────────────────
// Своей очереди событий тут НЕТ. Правда о том, кто и когда выстрелил, живёт в
// battle_board.js: bbDiffAnimate сверяет снимки и складывает эффекты в
// BB.anim.fx с полями t0/dur. Мы лишь заводим на каждый из них узел сцены и
// ведём его по той же фазе. Отсюда 2D и 3D показывают один бой кадр в кадр, и
// на время обкатки обе доски согласованы без второй копии логики.
// ════════════════════════════════════════════════════════════
function bgFxNode(objs, step) {
  objs.forEach(o => BG.g.fx.add(o));
  return {
    step,
    kill() {
      const seen = new Set();
      objs.forEach(o => {
        BG.g.fx.remove(o);
        if (o.material && !seen.has(o.material)) { seen.add(o.material); o.material.dispose(); }
        if (o.userData.ownGeo && o.geometry) o.geometry.dispose();
      });
    },
  };
}

// Словарь почерков живёт в battle_board.js (BBFX_W/BBFX_M) — сюда приходят уже
// готовые эффекты. Наша задача: не свести их обратно к одной линии. Луч —
// лучом, болванка и ракета — летящим телом, импульс — расходящимся кольцом.
function bgFxBuild(f) {
  if (f.kind === 'beam' || f.kind === 'lance' || f.kind === 'tether') return bgFxBeam(f);
  if (f.kind === 'slug' || f.kind === 'rocket' || f.kind === 'nanite' || f.kind === 'lunge')
    return bgFxShot(f);
  if (f.kind === 'wave' || f.kind === 'warp') return bgFxWave(f);
  if (f.kind === 'flash') return bgFxFlash(f);
  if (f.kind === 'hit' || f.kind === 'boom') return bgFxBlast(f);
  if (f.kind === 'nova') return bgFxNova(f);
  if (f.kind === 'spark' || f.kind === 'bloom' || f.kind === 'emp'
      || f.kind === 'frost' || f.kind === 'mend' || f.kind === 'drainx')
    return bgFxBlast(Object.assign({}, f, { kind: 'hit' }));
  return null;
}

// Летящее тело: голова со свечением и короткий хвост, оба идут по ТОЙ ЖЕ
// траектории, что и в 2D (bbFxPt) — дуга ракеты в обеих досках одинакова.
function bgFxShot(f) {
  const y = bgFxY(), R = BB.R * BG_FX_K, c = bgCol(f.col), big = f.big || 1;
  const tail = bgRibbon(bgTexBeam(), c, 0);
  const core = bgRibbon(bgTexBeam(), 0xffffff, 0);   // добела раскалённая нить внутри следа
  const halo = bgSprite(bgTexGlow(), c, 0);
  const head = bgSprite(bgTexGlow(), 0xffffff, 0);
  const objs = [tail, core, halo, head];
  const rocket = f.kind === 'rocket';
  const slow = rocket || f.kind === 'nanite';
  // хвост меряем в мире, а не в долях пути: иначе на длинной дистанции
  // снаряд растягивается в мазок через полдоски
  const L = Math.hypot(f.x1 - f.x0, f.y1 - f.y0) || 1;
  const back = Math.min(slow ? 0.10 : 0.18, R * 0.9 / L);
  // ракете — факел и дымный след: по ним она читается ракетой, а не трассером
  let flame = null, smoke = null, sg = null, puff = null;
  if (rocket) {
    flame = bgSprite(bgTexGlow(), 0xffb45a, 0);
    objs.push(flame);
    puff = f.puff || [];
    sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(puff.length * 3), 3));
    smoke = new THREE.Points(sg, new THREE.PointsMaterial({
      map: bgTexGlow(), color: 0xa9adbd, size: R * 0.8 * big, sizeAttenuation: true,
      transparent: true, opacity: 0.45, depthWrite: false,
    }));
    smoke.userData.ownGeo = true; smoke.frustumCulled = false;
    objs.push(smoke);
  }
  return bgFxNode(objs, t => {
    const k = f.kind === 'lunge' ? bbEase(Math.min(1, t * 1.15)) : Math.min(1, t);
    const p = bbFxPt(f, k), q = bbFxPt(f, Math.max(0, k - back));
    const a = t > 0.85 ? (1 - t) / 0.15 : 1;
    bgAimRibbon(tail, q.x, y, q.y, p.x, y, p.y, R * 0.22 * big);
    bgAimRibbon(core, q.x, y, q.y, p.x, y, p.y, R * 0.06 * big);
    tail.material.opacity = 0.75 * a;
    core.material.opacity = 0.95 * a;
    const s = R * (slow ? 0.6 : 0.5) * big;
    halo.position.set(p.x, y, p.y); head.position.set(p.x, y, p.y);
    halo.scale.set(s, s, 1); halo.material.opacity = 0.75 * a;
    head.scale.set(s * 0.38, s * 0.38, 1); head.material.opacity = 0.95 * a;
    if (rocket) {
      const dx = p.x - q.x, dz = p.y - q.y, dl = Math.hypot(dx, dz) || 1;
      const fs = R * (0.55 + 0.18 * Math.sin(t * 40 + (f.seed || 0))) * big;
      flame.position.set(p.x - dx / dl * fs * 0.5, y, p.y - dz / dl * fs * 0.5);
      flame.scale.set(fs, fs, 1); flame.material.opacity = 0.8 * a;
      const arr = sg.attributes.position.array;
      let n = 0;
      puff.forEach((s2, i) => {
        if (s2.at > k) return;
        const cpt = bbFxPt(f, s2.at);
        arr[i * 3] = cpt.x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = cpt.y;
        n++;
      });
      // ещё не рождённые клубы прячем в точку старта, а не размазываем по сцене
      puff.forEach((s2, i) => { if (s2.at > k) { arr[i * 3] = f.x0; arr[i * 3 + 1] = y - 1e4; arr[i * 3 + 2] = f.y0; } });
      sg.attributes.position.needsUpdate = true;
      smoke.material.opacity = 0.32 * a;
    }
  });
}

// Ядерный удар. Обычный взрыв, растянутый вширь, читается бледным блином:
// свет спрайта размазывается по площади. Поэтому у ядерки сверху ещё две
// вещи — слепящая вспышка первых кадров и плотное белое ядро, которое живёт
// дольше огня. Так удар видно даже с общего плана.
function bgFxNova(f) {
  const y = bgFxY(), R = BB.R * BG_FX_K;
  const big = f.big || 1;
  // огненный шар держим в разумных размерах — размах даёт не он, а кольца
  const base = bgFxBlast(Object.assign({}, f, { kind: 'boom', big: big * 1.15 }));
  const flash = bgSprite(bgTexGlow(), 0xffffff, 0);
  const kern = bgSprite(bgTexGlow(), 0xfff3d0, 0);
  const ring = bgSprite(bgTexRing(), 0xffffff, 0);
  [flash, kern, ring].forEach(o => o.position.set(f.px, y, f.py));
  const extra = bgFxNode([flash, kern, ring], t => {
    const a = 1 - t;
    // Спрайт «на всю доску» гаснет в серую муть: свет размазывается по площади.
    // Поэтому вспышка держится компактной и яркой, а размах даёт кольцо.
    const fl = Math.max(0, 1 - t / 0.14);
    const s1 = R * 2.2 * big * (0.5 + t * 2);
    flash.scale.set(s1, s1, 1); flash.material.opacity = fl;
    const s2 = R * big * (0.7 + t * 1.2);
    kern.scale.set(s2, s2, 1); kern.material.opacity = 0.95 * a * a;
    const s3 = R * (1 + bbEase(t) * 9) * 2;
    ring.scale.set(s3, s3, 1); ring.material.opacity = 0.6 * a * a;
  });
  return { step(t) { base.step(t); extra.step(t); },
           kill() { base.kill(); extra.kill(); } };
}

// Импульс вокруг борта и прокол прыжка: кольцо, расходящееся по плоскости боя.
function bgFxWave(f) {
  const y = bgFxY(), R = BB.R * BG_FX_K, c = bgCol(f.col);
  const ring = bgSprite(bgTexRing(), c, 0);
  const in2 = bgSprite(bgTexRing(), 0xffffff, 0);
  const warp = f.kind === 'warp';
  const cx = warp ? f.x1 : f.px, cy = warp ? f.y1 : f.py;
  ring.position.set(cx, y, cy); in2.position.set(f.px, y, f.py);
  const rad = R * 1.75 * Math.max(1, f.rad || 1);
  return bgFxNode([ring, in2], t => {
    const a = 1 - t, g = rad * bbEase(t) * 2;
    ring.scale.set(g, g, 1); ring.material.opacity = 0.7 * a;
    // у прыжка второе кольцо СХЛОПЫВАЕТСЯ в точке ухода — направление читается
    const g2 = warp ? R * 1.8 * (1 - t) : g * 0.78;
    in2.scale.set(g2, g2, 1); in2.material.opacity = 0.4 * a;
  });
}

// Трассер: широкое свечение + белое ядро, у кинетики — летящая болванка с
// хвостом. Ориентацию пересчитываем КАЖДЫЙ кадр: камеру можно крутить прямо
// во время залпа, и лента обязана держаться ребром к объективу.
function bgFxBeam(f) {
  const y = bgFxY(), R = BB.R * BG_FX_K, c = bgCol(f.col);
  const glow = bgRibbon(bgTexBeam(), c, 0);
  const core = bgRibbon(bgTexBeam(), 0xffffff, 0);
  const objs = [glow, core];
  let halo = null, head = null;
  if (f.head) {
    halo = bgSprite(bgTexGlow(), c, 0);
    head = bgSprite(bgTexGlow(), 0xffffff, 0);
    objs.push(halo, head);
  }
  return bgFxNode(objs, t => {
    const a = 1 - t;
    bgAimRibbon(glow, f.x0, y, f.y0, f.x1, y, f.y1, R * 0.30);
    bgAimRibbon(core, f.x0, y, f.y0, f.x1, y, f.y1, R * 0.075);
    glow.material.opacity = 0.5 * a;
    core.material.opacity = 0.95 * a;
    if (head) {
      const ht = Math.min(1, t * 1.25);         // снаряд добегает раньше, чем гаснет линия
      const hx = bbLerp(f.x0, f.x1, ht), hz = bbLerp(f.y0, f.y1, ht);
      halo.position.set(hx, y, hz); head.position.set(hx, y, hz);
      const s = R * 0.62;
      halo.scale.set(s, s, 1); halo.material.opacity = 0.7 * a;
      head.scale.set(s * 0.34, s * 0.34, 1); head.material.opacity = 0.95 * a;
    }
  });
}

// Дульная вспышка у стрелка: ядро + разбегающееся кольцо
function bgFxFlash(f) {
  const y = bgFxY(), R = BB.R * BG_FX_K, c = bgCol(f.col);
  const halo = bgSprite(bgTexGlow(), c, 0);
  const core = bgSprite(bgTexGlow(), 0xffffff, 0);
  const ring = bgSprite(bgTexRing(), c, 0);
  [halo, core, ring].forEach(o => o.position.set(f.px, y, f.py));
  return bgFxNode([halo, core, ring], t => {
    const a = 1 - t, gr = R * (0.34 + t * 0.95);
    halo.scale.set(gr * 2, gr * 2, 1); halo.material.opacity = 0.6 * a;
    core.scale.set(gr * 0.7, gr * 0.7, 1); core.material.opacity = 0.9 * a;
    ring.scale.set(gr * 2.1, gr * 2.1, 1); ring.material.opacity = 0.45 * a;
  });
}

// Попадание и гибель: огненный шар, ударные волны, веер искр и обломки.
// Разлёт СФЕРИЧЕСКИЙ, а не по кругу, как в 2D: плоский веер под наклонной
// камерой читается наклейкой на полу. Приплюснут по вертикали — бой всё-таки
// идёт в одной плоскости, и вертикальный столб выбивался бы из доски.
function bgFxBlast(f) {
  const boom = f.kind === 'boom';
  const y = bgFxY(), R = BB.R * BG_FX_K, c = bgCol(f.col);
  const ball = bgSprite(bgTexGlow(), c, 0);
  const core = bgSprite(bgTexGlow(), 0xffffff, 0);
  const objs = [ball, core];
  [ball, core].forEach(o => o.position.set(f.px, y, f.py));

  const n = boom ? 26 : 10;
  const dir = new Float32Array(n * 3), spd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * 6.2832, r = Math.sqrt(1 - u * u);
    dir[i * 3] = Math.cos(th) * r; dir[i * 3 + 1] = u * 0.55; dir[i * 3 + 2] = Math.sin(th) * r;
    spd[i] = 0.35 + Math.random();
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const sparks = new THREE.Points(sg, new THREE.PointsMaterial({
    map: bgTexGlow(), color: 0xffdcab, size: R * 0.2, sizeAttenuation: true,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sparks.userData.ownGeo = true;
  sparks.frustumCulled = false;                 // точки разлетаются за исходный bbox
  objs.push(sparks);

  // всплывающее число урона: сервер отдаёт только новый корпус, поэтому величину
  // считает дифф снимков в bbDiffAnimate и кладёт её прямо в эффект
  let num = null;
  if (f.dmg > 0) {
    num = bgTextSprite('−' + Math.round(f.dmg), boom ? 0xffc46a : 0xffffff, R * 0.42, 0);
    objs.push(num);
  }

  let r1 = null, r2 = null, deb = null, dm = null;
  if (boom) {
    r1 = bgSprite(bgTexRing(), 0xfff0c8, 0);
    r2 = bgSprite(bgTexRing(), 0xffb478, 0);
    [r1, r2].forEach(o => { o.position.set(f.px, y, f.py); objs.push(o); });
    // обломки — обычным блендингом поверх свечения: они твёрдые, а не светятся.
    // Материал ОДИН на взрыв, чтобы гасить всю крошку разом одним opacity.
    const bx = BG._box || (BG._box = new THREE.BoxGeometry(1, 0.62, 0.78));
    dm = new THREE.MeshStandardMaterial({
      color: 0x2f343d, roughness: 0.85, metalness: 0.35,
      emissive: 0x3a1a08, emissiveIntensity: 0.9,   // раскалённая кромка скола
      transparent: true, depthWrite: false,
    });
    deb = [];
    const dn = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < dn; i++) {
      const m = new THREE.Mesh(bx, dm);
      const u = Math.random() * 2 - 1, th = Math.random() * 6.2832, rr = Math.sqrt(1 - u * u);
      m.userData.d = {
        x: Math.cos(th) * rr, y: u * 0.6, z: Math.sin(th) * rr,
        sp: 0.5 + Math.random() * 0.9, sz: R * 0.1 * (0.6 + Math.random() * 0.8),
        rx: Math.random() * 6.2832, ry: Math.random() * 6.2832,
        sx: (Math.random() - 0.5) * 7, sy: (Math.random() - 0.5) * 7,
      };
      objs.push(m); deb.push(m);
    }
  }

  return bgFxNode(objs, t => {
    const a = 1 - t;
    // big приходит из профиля: у ядерки и торпеды шар кратно шире обычного
    const grow = (boom ? R * (0.5 + t * 1.35) : R * (0.28 + t * 0.6)) * (f.big || 1);
    ball.scale.set(grow * 2.2, grow * 2.2, 1); ball.material.opacity = 0.55 * a;
    core.scale.set(grow * 0.85, grow * 0.85, 1); core.material.opacity = (boom ? 0.8 : 0.62) * a;
    const sp = sg.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const d = grow * (0.5 + spd[i] * t);
      sp[i * 3] = f.px + dir[i * 3] * d;
      sp[i * 3 + 1] = y + dir[i * 3 + 1] * d;
      sp[i * 3 + 2] = f.py + dir[i * 3 + 2] * d;
    }
    sg.attributes.position.needsUpdate = true;
    sparks.material.opacity = a;
    if (num) {
      // всплывает над точкой попадания: быстро проявился, дальше тает
      num.position.set(f.px, y + R * (0.55 + t * 1.6), f.py);
      num.material.opacity = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.85);
    }
    if (boom) {
      const g1 = grow * 2, g2 = R * (0.3 + t * 1.9) * 2;
      r1.scale.set(g1, g1, 1); r1.material.opacity = 0.75 * a;
      r2.scale.set(g2, g2, 1); r2.material.opacity = 0.42 * a;
      dm.opacity = 0.9 * a;
      deb.forEach(m => {
        const d = m.userData.d, dist = grow * (0.6 + d.sp * t);
        m.position.set(f.px + d.x * dist, y + d.y * dist, f.py + d.z * dist);
        m.rotation.set(d.rx + d.sx * t, d.ry + d.sy * t, 0);
        const s = d.sz * (1 - 0.35 * t);
        m.scale.set(s, s, s);
      });
    }
  });
}

// ════════════════════════════════════════════════════════════
// ЛАНДШАФТ
// ────────────────────────────────────────────────────────────
// Раскладка «случайностей» — та же формула от координат гекса, что в 2D
// (bbPaintTerrain): камни и обломки обязаны лежать там же, где на плоской
// доске, иначе одно и то же поле в двух рендерах выглядит разными местами.
// Ландшафт за бой не меняется, поэтому строится РАЗ на снимок terrain и не
// трогается при каждом обновлении.
// ════════════════════════════════════════════════════════════
function bgTerrRnd(x, y, k) {
  const v = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5;
  return v - Math.floor(v);
}

function bgSyncTerrain() {
  if (!BG.scene) return;
  if (BG._terrRef === BB.terr) return;            // тот же снимок — пересобирать нечего
  BG._terrRef = BB.terr;
  if (BG.g.terr) { bgClearGroup(BG.g.terr); BG.scene.remove(BG.g.terr); }
  const grp = new THREE.Group();
  BG.scene.add(grp);
  BG.g.terr = grp;
  if (!BB.terr || !BB.terr.size) return;

  const R = BB.R;
  const cells = [];
  BB.terr.forEach((t, key) => {
    const [x, y] = key.split(':').map(Number);
    cells.push({ t, x, y, c: bbHexCenter(x, y) });
  });

  // Камни и обломки — ИНСТАНСАМИ: на большой доске их сотни, отдельными мешами
  // это сотни draw call'ов ради декора.
  const rocks = cells.filter(c => c.t === 'ast').length * 6;
  const plates = cells.filter(c => c.t === 'deb').length * 5;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(),
        _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();

  let rm = null, ri = 0;
  if (rocks) {
    rm = new THREE.InstancedMesh(
      BG._rock || (BG._rock = new THREE.IcosahedronGeometry(1, 0)),
      new THREE.MeshStandardMaterial({ color: 0x6d7480, roughness: 0.95, metalness: 0.08, flatShading: true }),
      rocks);
    grp.add(rm);
  }
  let dmz = null, di = 0;
  if (plates) {
    dmz = new THREE.InstancedMesh(
      BG._plate || (BG._plate = new THREE.BoxGeometry(1, 0.16, 0.68)),
      new THREE.MeshStandardMaterial({ color: 0x39414c, roughness: 0.7, metalness: 0.55, flatShading: true }),
      plates);
    grp.add(dmz);
  }

  cells.forEach(({ t, x, y, c }) => {
    const rnd = k => bgTerrRnd(x, y, k);
    if (t === 'ast' && rm) {
      for (let i = 0; i < 6; i++) {
        const ar = R * (0.14 + rnd(i + 4) * 0.2);
        _p.set(c.px + (rnd(i) - 0.5) * R * 1.15,
               ar * 0.6 + rnd(i + 2) * R * 0.25,      // глыбы висят на разной высоте
               c.py + (rnd(i + 9) - 0.5) * R * 1.15);
        _e.set(rnd(i + 1) * 6.28, rnd(i + 5) * 6.28, rnd(i + 6) * 6.28);
        _q.setFromEuler(_e);
        _s.set(ar, ar * (0.7 + rnd(i + 8) * 0.5), ar * (0.8 + rnd(i + 3) * 0.4));
        rm.setMatrixAt(ri++, _m.compose(_p, _q, _s));
      }
    } else if (t === 'deb' && dmz) {
      for (let i = 0; i < 5; i++) {
        const sz = R * (0.24 + rnd(i + 4) * 0.28);
        _p.set(c.px + (rnd(i) - 0.5) * R * 1.25,
               R * 0.1 + rnd(i + 12) * R * 0.2,
               c.py + (rnd(i + 7) - 0.5) * R * 1.25);
        _e.set(rnd(i + 2) * 6.28, rnd(i + 3) * 6.28, rnd(i + 6) * 6.28);
        _q.setFromEuler(_e);
        _s.set(sz, sz, sz);
        dmz.setMatrixAt(di++, _m.compose(_p, _q, _s));
      }
    } else if (t === 'neb') {
      // Туманность — облако, а не пятно на полу: несколько засветок вразнобой
      // по высоте, иначе при наклонной камере это читается наклейкой.
      for (let i = 0; i < 3; i++) {
        const sp = bgSprite(bgTexGlow(), 0x9a5adc, 0.20 - i * 0.04);
        const rr = R * (1.6 + i * 0.5);
        sp.position.set(c.px + (rnd(i) - 0.5) * R * 0.5, R * (0.2 + i * 0.35), c.py + (rnd(i + 5) - 0.5) * R * 0.5);
        sp.scale.set(rr, rr, 1);
        grp.add(sp);
      }
    } else if (t === 'grv') {
      // Гравиколодец: кольца ПЛАШМЯ в плоскости доски + тёмное ядро.
      for (let i = 1; i <= 3; i++) {
        const rr = R * 0.28 * i;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(rr * 0.93, rr, 40),
          new THREE.MeshBasicMaterial({ color: 0x8cdcff, transparent: true,
            opacity: 0.45 - i * 0.1, depthWrite: false, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(c.px, 1.5, c.py);
        grp.add(ring);
      }
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(R * 0.14, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x060a12 })
      );
      core.position.set(c.px, R * 0.14, c.py);
      grp.add(core);
    }
  });
  if (rm) { rm.count = ri; rm.instanceMatrix.needsUpdate = true; }
  if (dmz) { dmz.count = di; dmz.instanceMatrix.needsUpdate = true; }
}

// ════════════════════════════════════════════════════════════
// ПОДСВЕТКА ХОДА
// ────────────────────────────────────────────────────────────
// Зеркало bbPaintHighlights/bbPaintArcs/bbPaintMovePreview. Пересобирается не
// покадрово, а на изменение состояния (выбор борта, наведение, новый снимок) —
// поэтому дешёвая: между кликами в сцене просто лежит готовая геометрия.
// ════════════════════════════════════════════════════════════
function bgClearGroup(g) {
  if (!g) return;
  const seen = new Set();
  g.traverse(o => {
    if (o.material && !seen.has(o.material)) { seen.add(o.material); o.material.dispose(); }
    if (o.userData.ownGeo && o.geometry) o.geometry.dispose();
  });
  g.clear();
}

// Заливка гекса плашмя — треугольный веер вокруг центра
function bgHexFillGeo(r) {
  const key = '_hexFill' + r.toFixed(2);
  if (BG[key]) return BG[key];
  const pos = [0, 0, 0], idx = [];
  for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  for (let i = 1; i <= 6; i++) idx.push(0, i, i % 6 + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return (BG[key] = g);
}

function bgSyncOverlay() {
  const s = BB.st; if (!s || !BG.scene) return;
  if (!BG.g.ov) { BG.g.ov = new THREE.Group(); BG.scene.add(BG.g.ov); }
  const G = BG.g.ov;
  bgClearGroup(G);
  BG.dirty = true;
  bgSyncVeil();                 // покрытие живёт отдельным слоем, вне overlay
  if (s.status === 'forming') { bgSyncDeployZone(G); return; }

  const sel = (s.units || []).find(u => u.id === BB.sel);
  if (!sel || !s.my_turn) return;
  const R = BB.R;
  const canAct = sel.acted || s.acts_left > 0;
  const mine = bgCol(BG_C.mine);

  // Наведение модуля забирает доску себе: рубеж, цели, траектория, накрытие.
  // Зеркало bbPaintAim — на трёхмерной доске это ЕДИНСТВЕННЫЙ слой наведения,
  // 2D-канвас под сценой не рисуется вовсе.
  if (BB.mod && bbActOf(sel, BB.mod)) { bgAimLayer(G, sel, BB.mod, true); return; }
  if (BB.modPre && bbActOf(sel, BB.modPre)) bgAimLayer(G, sel, BB.modPre, false);

  // кольца дальностей огневых групп — пересёк кольцо, включилась ещё одна
  const gs = (sel.wpn && sel.wpn.length) ? sel.wpn : [{ rng: sel.rng }];
  const rings = [...new Set(gs.map(g => Math.max(1, g.rng || 1)))].sort((a, b) => a - b);
  const sc = bbHexCenter(sel.x, sel.y);
  rings.forEach((rng, i) => {
    const rr = rng * R * 1.5;
    const pts = [];
    for (let k = 0; k <= 72; k++) { const a = k / 72 * 6.2832; pts.push(new THREE.Vector3(sc.px + Math.cos(a) * rr, 1.2, sc.py + Math.sin(a) * rr)); }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0x96f0ff, transparent: true, opacity: i === 0 ? 0.34 : 0.16 }));
    ln.userData.ownGeo = true;
    G.add(ln);
  });

  // гексы хода — досягаемость по скорости
  if (bbSteps(sel) > 0 && canAct) {
    if (!BB.reach) BB.reach = bbComputeReach(sel);
    const cells = [...BB.reach.keys()];
    if (cells.length) {
      const im = new THREE.InstancedMesh(bgHexFillGeo(R * 0.82),
        new THREE.MeshBasicMaterial({ color: mine, transparent: true, opacity: 0.18,
          depthWrite: false, side: THREE.DoubleSide }), cells.length);
      const m = new THREE.Matrix4();
      cells.forEach((key, i) => {
        const [x, y] = key.split(':').map(Number);
        const c = bbHexCenter(x, y);
        im.setMatrixAt(i, m.makeTranslation(c.px, 1, c.py));
      });
      im.instanceMatrix.needsUpdate = true;
      G.add(im);
    }
    // превью манёвра под курсором
    if (BB.hover) {
      const r = BB.reach.get(BB.hover.x + ':' + BB.hover.y);
      if (r) bgMovePreview(G, sel, r);
    }
  }

  // цели по дальности и линии огня
  if (bbCanFire(sel) && canAct) {
    (s.units || []).forEach(u => {
      if (u.mine || u.side === s.my_side) return;
      if (!bbCanHit(sel, u).ok) return;
      bgMarkHex(G, u.x, u.y, bgCol(BG_C.foe), 0.22, 0.55);
    });
  }
  // режим ремонта: союзники под нано-рой
  if (BB.heal && bbCanFire(sel) && canAct) {
    (s.units || []).forEach(u => {
      if (u.side !== s.my_side || !bbCanHeal(sel, u).ok) return;
      bgMarkHex(G, u.x, u.y, bgCol(BB_C.heal), 0.2, 0.55);
    });
  }

  // кольцо выбранного борта
  const rimPts = [];
  for (let i = 0; i <= 6; i++) { const a = Math.PI / 3 * i; rimPts.push(new THREE.Vector3(sc.px + Math.cos(a) * R * 0.9, 1.4, sc.py + Math.sin(a) * R * 0.9)); }
  const rimGeo = new THREE.BufferGeometry().setFromPoints(rimPts);
  const rim = new THREE.Line(rimGeo, new THREE.LineDashedMaterial({
    color: mine, dashSize: R * 0.12, gapSize: R * 0.1, transparent: true, opacity: 0.9 }));
  rim.computeLineDistances();
  rim.userData.ownGeo = true;
  G.add(rim);
}

// Гекс-метка: заливка + контур (цели огня, союзники под ремонт)

// ════════════════════════════════════════════════════════════
// ЗАВЕСА СЕНСОРОВ: тьма, радар, РЭБ
// ────────────────────────────────────────────────────────────
// Покрытие — это СПРАВКА об обстановке, а не спецэффект: ни анимации, ни
// свечения. Но и подписывать его отдельной панелью незачем — слой обязан
// объяснять себя сам, поэтому говорит языком радарного экрана:
//   • тьма — ровное затемнение там, куда сенсоры не достают (шум только рвёт
//     кромку, чтобы не читались гексы);
//   • от КАЖДОГО своего борта — тонкие концентрические шкалы дальности и
//     створ переднего сектора: сразу видно, чей это радар, куда он смотрит и
//     где кончается его рука. Без колец тёмное пятно читалось ландшафтом;
//   • РЭБ — штриховка «сорванного» эфира внутри освещённого.
// Контр-РЭБ отдельным цветом не рисуем: она просто снимает штриховку помехи.
// Цена — два draw call'а, оба без обновлений между кадрами.
// ════════════════════════════════════════════════════════════
const BG_VEIL_SRC = 12;                  // сколько бортов-сенсоров держит шейдер

function bgVeilShader(mode) {
  const common = `
    precision highp float;
    varying vec2 vW;
    uniform sampler2D uCov;
    uniform vec2  uGrid;                 // w, h доски
    uniform float uR;                    // радиус гекса в мире
    uniform vec4  uSrc[${BG_VEIL_SRC}];  // x, z, дальность, курс (рад)
    uniform int   uSrcN;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    // мир → клетка → uv карты покрытия (чётность колонок игнорируем:
    // кромка размытая, полшага строки в ней и не разглядеть)
    vec2 covUV(vec2 w){
      float gx = (w.x - uR) / (uR * 1.5);
      float gy = w.y / (uR * 1.7320508) - 0.5;
      return (vec2(gx, gy) + 0.5) / uGrid;
    }
  `;
  const vert = `
    varying vec2 vW;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vW = wp.xz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;
  if (mode === 'dark') return { vert, frag: common + `
    void main(){
      vec4 c = texture2D(uCov, covUV(vW));
      if (c.a < 0.02) discard;
      // шум только на кромке — ровной линии по клеткам не остаётся,
      // но и «клубов» внутри нет: тьма должна быть спокойной
      float n = vnoise(vW / uR * 0.7);
      float lit = clamp(c.r * 1.1 + (n - 0.5) * 0.30, 0.0, 1.0);
      // край поля зрения = широкий мягкий сход в темноту, без обводки:
      // граница должна ощущаться светом, а не ещё одним контуром на доске
      float dark = smoothstep(0.92, 0.16, lit);
      if (dark < 0.01) discard;
      gl_FragColor = vec4(vec3(0.006, 0.011, 0.028), dark * 0.88 * c.a);
    }
  ` };
  return { vert, frag: common + `
    void main(){
      vec4 c = texture2D(uCov, covUV(vW));
      if (c.a < 0.02) discard;
      float lit = c.r, jam = max(c.g - c.b, 0.0);   // контр-РЭБ гасит помеху
      vec3 col = vec3(0.0);

      // Границу покрытия НЕ обводим: линия читалась как ещё один контур среди
      // колец орудий и рамок гексов. Край поля зрения несёт только свет и тьма.

      // ШКАЛЫ ДАЛЬНОСТИ: от каждого своего борта — концентрические кольца и
      // створ переднего сектора. Это и есть подпись слоя: рисунок радара
      // ни с ландшафтом, ни с подсветкой хода не спутать.
      if (lit > 0.35) {
        float scope = 0.0;
        for (int i = 0; i < ${BG_VEIL_SRC}; i++) {
          if (i >= uSrcN) break;
          vec4 sc = uSrc[i];
          vec2 d = vW - sc.xy;
          float r = length(d) / max(sc.z, 1.0);      // 0..1 по дальности сенсора
          if (r > 1.08) continue;         // с запасом: кольцо предела двустороннее
          float ang0 = atan(d.y, d.x);
          // ОДНО кольцо — предел сенсора, и то пунктиром: сплошные концентры
          // цианом путались с кольцами дальности орудий вокруг того же борта.
          float dash = step(0.42, fract(ang0 * 3.8));
          scope += smoothstep(0.070, 0.0, abs(r - 1.0)) * dash;
          // створ: две риски по кромкам переднего сектора (±60°)
          float ang = abs(mod(ang0 - sc.w + 3.14159, 6.28318) - 3.14159);
          scope += smoothstep(0.050, 0.0, abs(ang - 1.0472)) * (1.0 - r * 0.5) * 0.55 * dash;
        }
        // тёплый бледно-зелёный: не цвет орудий и не цвет кромки покрытия
        col += vec3(0.62, 0.95, 0.52) * min(scope, 1.0) * 0.34;
      }

      // РЭБ: косая штриховка, только в освещённом — «этот сектор врёт»
      if (jam > 0.02 && lit > 0.3) {
        float st = fract((vW.x + vW.y) / (uR * 0.9));
        float hatch = smoothstep(0.5, 0.40, abs(st - 0.5));
        col += vec3(0.95, 0.30, 0.48) * hatch * jam * 0.45;
      }

      float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0) * c.a;
      if (a < 0.004) discard;
      gl_FragColor = vec4(col, a);
    }
  ` };
}

// Карта покрытия в текстуру: R = освещено, G = помеха, B = контр-РЭБ, A = арена
function bgVeilTex(s, cov) {
  const w = s.w, h = s.h, buf = new Uint8Array(w * h * 4);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (!bbInArena(x, y)) continue;                 // вне арены — прозрачно
      const k = x + ':' + y;
      buf[i]     = cov.lit.has(k) ? 255 : 0;
      buf[i + 1] = cov.jam.has(k) ? 255 : 0;
      buf[i + 2] = cov.dejam.has(k) ? 255 : 0;
      buf[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter;     // билинейка и съедает клетки
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

// Источник сенсора: точка, дальность в мире, курс в радианах.
// Курс отрицательный: гекс-направления идут по часовой, atan в шейдере — против.
// Шкалы рисуем ТОЛЬКО у выбранного борта: кольца всех своих разом наложились
// друг на друга в месиво, из которого не читалась ни одна дальность.
function bgVeilSources(s) {
  const out = [];
  const sel = (s.units || []).find(u => u.id === BB.sel && (u.mine || u.side === s.my_side));
  if (!sel) return out;                            // никто не выбран — только тьма и кромка
  [sel].forEach(u => {
    if (out.length >= BG_VEIL_SRC) return;
    const c = bbHexCenter(u.x, u.y);
    const rng = (typeof bbRadarR === 'function' ? bbRadarR(u) : 6) * BB.R * 1.5;
    out.push(new THREE.Vector4(c.px, c.py, rng, -((u.facing || 0) * Math.PI / 3)));
  });
  return out;
}

function bgVeilPad(src) {
  const pad = [];
  for (let i = 0; i < BG_VEIL_SRC; i++) pad.push(src[i] || new THREE.Vector4(0, 0, 1, 0));
  return pad;
}

function bgSyncVeil() {
  const s = BB.st;
  if (!BG.scene || !s) return;
  const off = !BB.fog || s.status === 'forming';
  if (off) { if (BG.veil) bgKillVeil(); return; }
  const cov = bbCoverage(); if (!cov) return;

  // пересобираем только на новый снимок или смену выбранного борта:
  // шейдер компилировать каждый клик — дорого
  if (BG.veil && BG.veil.cov === cov && BG.veil.sel === BB.sel
      && BG.veil.w === s.w && BG.veil.h === s.h) return;

  const tex = bgVeilTex(s, cov);
  const src = bgVeilSources(s), pad = bgVeilPad(src);

  if (BG.veil && BG.veil.w === s.w && BG.veil.h === s.h) {
    // размер тот же — меняем только данные, материалы и меши живут дальше
    if (BG.veil.tex) BG.veil.tex.dispose();          // текстура у обоих квадов общая
    BG.veil.mats.forEach(m => {
      m.uniforms.uCov.value = tex;
      m.uniforms.uSrc.value = pad;
      m.uniforms.uSrcN.value = src.length;
    });
    BG.veil.tex = tex;
    BG.veil.cov = cov;
    BG.veil.sel = BB.sel;
    BG.dirty = true; bgKick();
    return;
  }

  bgKillVeil();
  const { W, H } = bbWorldSize();
  const grp = new THREE.Group();
  const mats = [];
  const mk = (mode, y, blend) => {
    const sh = bgVeilShader(mode);
    const m = new THREE.ShaderMaterial({
      vertexShader: sh.vert, fragmentShader: sh.frag,
      uniforms: {
        uCov:  { value: tex },
        uGrid: { value: new THREE.Vector2(s.w, s.h) },
        uR:    { value: BB.R },
        uSrc:  { value: pad },
        uSrcN: { value: src.length },
      },
      transparent: true, depthWrite: false, depthTest: false,
      side: THREE.DoubleSide, blending: blend,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(W / 2, y, H / 2);
    mesh.renderOrder = mode === 'dark' ? 4 : 5;
    mesh.userData.ownGeo = true;
    grp.add(mesh);
    mats.push(m);
  };
  mk('dark', BB.R * 0.34, THREE.NormalBlending);      // тьма гасит пол
  mk('glow', BB.R * 0.42, THREE.AdditiveBlending);    // кромка и штриховка — поверх
  BG.scene.add(grp);
  BG.veil = { grp, mats, tex, cov, sel: BB.sel, w: s.w, h: s.h };
  BG.dirty = true; bgKick();
}

function bgKillVeil() {
  const v = BG.veil; if (!v) return;
  BG.veil = null;
  if (BG.scene) BG.scene.remove(v.grp);
  v.grp.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  if (v.tex) v.tex.dispose();
  BG.dirty = true;
}

function bgMarkHex(G, x, y, col, fill, edge) {
  const R = BB.R, c = bbHexCenter(x, y);
  const f = new THREE.Mesh(bgHexFillGeo(R * 0.9), new THREE.MeshBasicMaterial({
    color: col, transparent: true, opacity: fill, depthWrite: false, side: THREE.DoubleSide }));
  f.position.set(c.px, 1.1, c.py);
  G.add(f);
  const pts = [];
  for (let i = 0; i <= 6; i++) { const a = Math.PI / 3 * i; pts.push(new THREE.Vector3(c.px + Math.cos(a) * R * 0.9, 1.3, c.py + Math.sin(a) * R * 0.9)); }
  const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: edge }));
  ln.userData.ownGeo = true;
  G.add(ln);
}

// ── Слой наведения модуля (зеркало bbPaintAim) ──────────────
// Кольцо на высоте: рубеж, мёртвая зона, пятно накрытия.
function bgAimRing(G, cx, cy, rad, col, op, dash, yy) {
  const pts = [];
  for (let k = 0; k <= 84; k++) {
    const a = k / 84 * 6.2832;
    pts.push(new THREE.Vector3(cx + Math.cos(a) * rad, yy || 1.6, cy + Math.sin(a) * rad));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = dash
    ? new THREE.LineDashedMaterial({ color: col, dashSize: BB.R * 0.2, gapSize: BB.R * 0.16, transparent: true, opacity: op })
    : new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op });
  const ln = new THREE.Line(geo, mat);
  if (dash) ln.computeLineDistances();
  ln.userData.ownGeo = true;
  G.add(ln);
}
function bgAimFill(G, cells, col, op) {
  const arr = [...cells];
  if (!arr.length) return;
  const im = new THREE.InstancedMesh(bgHexFillGeo(BB.R * 0.86),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op,
      depthWrite: false, side: THREE.DoubleSide }), arr.length);
  const m = new THREE.Matrix4();
  arr.forEach((k, i) => {
    const [x, y] = k.split(':').map(Number), c = bbHexCenter(x, y);
    im.setMatrixAt(i, m.makeTranslation(c.px, 1.05, c.py));
  });
  im.instanceMatrix.needsUpdate = true;
  G.add(im);
}
function bgAimLayer(G, sel, key, live) {
  const aim = (typeof BBK_AIM !== 'undefined' && BBK_AIM[key]) || {};
  const meta = (typeof BBK !== 'undefined' && BBK[key]) || {};
  const need = aim.need || meta.need;
  const R = BB.R, col = bgCol(bbModCol(key));
  const rng = bbModRng(sel, key), c0 = bbHexCenter(sel.x, sel.y);

  bgAimRing(G, c0.px, c0.py, rng * R * 1.5, col, live ? 0.6 : 0.32);
  const dead = aim.fix ? aim.fix : (aim.dmin ? aim.dmin - 1 : 0);
  if (dead > 0) bgAimRing(G, c0.px, c0.py, dead * R * 1.5, bgCol('255,90,90'), 0.5, true);

  if (aim.aura) {
    const cells = new Set(); bbDiskInto(cells, sel.x, sel.y, rng);
    bgAimFill(G, cells, col, 0.12);
    bbModAura(sel, key).forEach(u => bgMarkHex(G, u.x, u.y, col, 0.26, 0.7));
    return;
  }

  if (live) {
    if (need === 'hex') {
      const cells = new Set(); bbDiskInto(cells, sel.x, sel.y, rng);
      const ok = [...cells].filter(k => {
        const [x, y] = k.split(':').map(Number);
        return bbModCheck(sel, key, x, y).ok;
      });
      bgAimFill(G, ok, col, 0.16);
    } else {
      (BB.st.units || []).forEach(u => {
        if (u.alive === false) return;
        if (!bbModCheck(sel, key, u.x, u.y).ok) return;
        bgMarkHex(G, u.x, u.y, col, 0.22, 0.65);
      });
    }
  }

  // как в bbPaintAim: линия тянется к борту (или к гексу прыжка), не в пустоту
  const h = live && BB.hover
    && (need === 'hex' || (BB.st.units || []).some(u => u.x === BB.hover.x && u.y === BB.hover.y))
    ? BB.hover : null;
  if (!h) return;
  const chk = bbModCheck(sel, key, h.x, h.y), c1 = bbHexCenter(h.x, h.y);
  const lcol = chk.ok ? col : bgCol('255,70,70');
  // траектория: у тягового луча она тянет к себе, поэтому и рисуем от цели
  const a = aim.pull ? c1 : c0, b = aim.pull ? c0 : c1;
  const ln = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.px, 3, a.py), new THREE.Vector3(b.px, 3, b.py)]),
    need === 'hex'
      ? new THREE.LineDashedMaterial({ color: lcol, dashSize: R * 0.22, gapSize: R * 0.16, transparent: true, opacity: 0.9 })
      : new THREE.LineBasicMaterial({ color: lcol, transparent: true, opacity: 0.9 }));
  if (need === 'hex') ln.computeLineDistances();
  ln.userData.ownGeo = true;
  G.add(ln);
  // точка попадания — светящаяся метка там, куда прилетит
  const dot = bgSprite(bgTexGlow(), lcol, chk.ok ? 0.95 : 0.6);
  dot.position.set(b.px, 3.4, b.py);
  dot.scale.set(R * 0.5, R * 0.5, 1);
  G.add(dot);

  if (chk.ok && aim.aoe) {
    const cells = new Set(); bbDiskInto(cells, h.x, h.y, aim.aoe);
    bgAimFill(G, cells, col, 0.2);
    bgAimRing(G, c1.px, c1.py, (aim.aoe + 0.5) * R * 1.5, col, 0.85, true, 2.4);
    // свои под накрытием — тревожный контур, до клика
    bbModSplash(sel, key, h.x, h.y).own.forEach(u =>
      bgMarkHex(G, u.x, u.y, bgCol('255,80,80'), 0.1, 0.95));
  }
}

// Превью манёвра: пунктир по маршруту, точки шагов, кольцо назначения
function bgMovePreview(G, sel, r) {
  const R = BB.R, col = bgCol(BG_C.mine);
  const pts = [{ x: sel.x, y: sel.y }].concat(r.path || []);
  const v = pts.map(p => { const c = bbHexCenter(p.x, p.y); return new THREE.Vector3(c.px, 2, c.py); });
  const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v),
    new THREE.LineDashedMaterial({ color: col, dashSize: R * 0.18, gapSize: R * 0.15,
      transparent: true, opacity: 0.85 }));
  ln.computeLineDistances();
  ln.userData.ownGeo = true;
  G.add(ln);
  // узлы поворота
  v.slice(1).forEach(p => {
    const dot = bgSprite(bgTexGlow(), col, 0.8);
    dot.position.copy(p);
    dot.scale.set(R * 0.22, R * 0.22, 1);
    G.add(dot);
  });
  // кольцо назначения
  const d = bbHexCenter(BB.hover.x, BB.hover.y);
  const rp = [];
  for (let k = 0; k <= 48; k++) { const a = k / 48 * 6.2832; rp.push(new THREE.Vector3(d.px + Math.cos(a) * R * 0.5, 2.2, d.py + Math.sin(a) * R * 0.5)); }
  const rl = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rp),
    new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 }));
  rl.userData.ownGeo = true;
  G.add(rl);
}

// Зона расстановки на фазе forming: подсветка гексов своего края.
// Зоны-заливки у торцов рисует bgBuildField; здесь — именно клетки, куда
// физически можно ставить, чтобы «своя зона» не оставалась на глаз.
function bgSyncDeployZone(G) {
  const s = BB.st; if (!s) return;
  const R = BB.R, cells = (typeof bbZoneCells === 'function') ? bbZoneCells(s) : [];
  if (!cells.length) return;
  const im = new THREE.InstancedMesh(bgHexFillGeo(R * 0.86),
    new THREE.MeshBasicMaterial({ color: bgCol(BG_C.mine), transparent: true, opacity: 0.12,
      depthWrite: false, side: THREE.DoubleSide }), cells.length);
  const m = new THREE.Matrix4();
  cells.forEach((c, i) => {
    const p = bbHexCenter(c.x, c.y);
    im.setMatrixAt(i, m.makeTranslation(p.px, 1, p.py));
  });
  im.instanceMatrix.needsUpdate = true;
  G.add(im);
}

// ════════════════════════════════════════════════════════════
// СОСТОЯНИЕ БОРТА: полоски корпуса и щита, «уже отходил»
// ────────────────────────────────────────────────────────────
// В 2D полоски лежат ПОД гексом. Под наклонной камерой пол — самое неудобное
// место (полоска уезжает под корпус соседа), поэтому они висят НАД бортом
// спрайтами: те всегда развёрнуты к зрителю и не мнутся ракурсом.
// ════════════════════════════════════════════════════════════
function bgBar(col, opa) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    color: col, transparent: true, opacity: opa, depthWrite: false, depthTest: false }));
  sp.center.set(0, 0.5);                          // тянем полоску ОТ левого края
  return sp;
}

// Шеврон курса на кромке гекса: курс читается и тогда, когда корпус отъехал в
// мелочь. Лежит ПЛАШМЯ в плоскости доски — в 2D он рисовался там же.
function bgChevGeo() {
  if (BG._chev) return BG._chev;
  const p = [];
  [0, 2.5, -2.5].forEach(a => p.push(Math.cos(a), Math.sin(a), 0));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return (BG._chev = g);
}

function bgSyncStatus() {
  const s = BB.st; if (!s || !BG.scene) return;
  if (!BG.g.st) { BG.g.st = new THREE.Group(); BG.scene.add(BG.g.st); }
  if (!BG.stat) BG.stat = new Map();
  const live = new Set();
  (s.units || []).forEach(u => {
    if (u.contact) return;                        // у контакта ТТХ нет — нечего показывать
    live.add(u.id);
    let st = BG.stat.get(u.id);
    if (!st) {
      const col = bgCol(u.mine ? BG_C.mine : BG_C.foe);
      st = { bg: bgBar(0x000000, 0.62), hp: bgBar(0xffffff, 0.95), sh: bgBar(0xffffff, 0.75),
             chev: new THREE.Mesh(bgChevGeo(), new THREE.MeshBasicMaterial({
               color: col, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })) };
      BG.g.st.add(st.bg, st.hp, st.sh, st.chev);
      BG.stat.set(u.id, st);
    }
    // подпись борта (герб державы + имя) — отдельным спрайтом. Ключ включает
    // адрес герба: справочник гербов доезжает позже первого снимка боя, и по
    // его приходу щиток с инициалами сам сменится на картинку.
    const col = u.mine ? BG_C.mine : BG_C.foe;
    const nk = u.name ? bgLabelKey(u.name, u.fid, col) : null;
    if (st.nmKey !== nk) {
      if (st.nm) { BG.g.st.remove(st.nm); st.nm.material.dispose(); st.nm = null; }
      st.nmKey = nk;
      if (nk) { st.nm = bgLabelSprite(u.name, u.fid, col, BB.R * 0.3, 0.85); BG.g.st.add(st.nm); }
    }
    const hpF = (u.max_hp > 0) ? Math.max(0, Math.min(1, u.hp / u.max_hp)) : 1;
    const shF = (u.tp_max > 0) ? Math.max(0, Math.min(1, (u.shield || 0) / u.tp_max)) : 0;
    st.hpF = hpF; st.shF = shF;
    st.hp.material.color.set(hpF > 0.5 ? bgCol(u.mine ? BG_C.mine : BG_C.foe)
                           : hpF > 0.25 ? new THREE.Color(0xffbe46) : new THREE.Color(0xff4646));
    st.sh.visible = shF > 0;
    // «уже отходил» — гасим борт, как alpha 0.5 в 2D
    const spent = u.mine && s.my_turn && ((+u.tp) <= 0.05 || (!u.acted && !(s.acts_left > 0)));
    const m = BG.units.get(u.id);
    if (m && m.userData.spent !== spent) {
      m.userData.spent = spent;
      (m.userData.hullParts || []).forEach(p => { p.material = bgHullMat(u.mine, spent); });
      (m.userData.nz || []).forEach(e => { e.material = bgGlowMat(spent ? 0x6e4a28 : 0xffb469, 1.5); });
    }
  });
  BG.stat.forEach((st, id) => {
    if (live.has(id)) return;
    [st.bg, st.hp, st.sh, st.chev, st.nm].forEach(o => {
      if (!o) return;
      BG.g.st.remove(o); o.material.dispose();   // текстуры общие (кэш) — их не трогаем
    });
    BG.stat.delete(id);
  });
  bgPlaceStatus();
}

// Полоски, имя и шеврон едут за бортом: позиция берётся у посаженного меша
function bgPlaceStatus() {
  if (!BG.stat) return;
  const W = BB.R * 1.15, TH = BB.R * 0.085;
  BG.stat.forEach((st, id) => {
    const m = BG.units.get(id);
    if (!m) {
      [st.bg, st.hp, st.sh, st.chev, st.nm].forEach(o => { if (o) o.visible = false; });
      return;
    }
    const y = m.position.y + m.userData.L * 0.5;
    const x = m.position.x - W / 2, z = m.position.z;
    st.bg.visible = st.hp.visible = true;
    st.bg.position.set(x, y, z); st.bg.scale.set(W, TH, 1);
    st.hp.position.set(x, y, z); st.hp.scale.set(W * st.hpF, TH, 1);
    if (st.shF > 0) {
      st.sh.visible = true;
      st.sh.position.set(x, y + TH * 1.25, z);
      st.sh.scale.set(W * st.shF, TH * 0.6, 1);
    }
    if (st.nm) {
      st.nm.visible = true;
      st.nm.position.set(m.position.x, y + TH * 3.4, z);
    }
    // шеврон: на кромке гекса по курсу, плашмя
    const ang = -m.rotation.y;                  // обратно в угол 2D-доски
    const cx = m.position.x + Math.cos(ang) * BB.R * 0.86;
    const cz = m.position.z + Math.sin(ang) * BB.R * 0.86;
    st.chev.visible = true;
    bgLayFlat(st.chev, cx, 1.6, cz, BB.R * 0.16, BB.R * 0.16, Math.cos(ang), Math.sin(ang));
  });
}

// ── Доворот камеры к действиям противника ───────────────────
// Зеркало bbCamFocus: цель обзора едет к точке, а дистанция подбирается под
// охват действий. Иначе чужой залп отрабатывает за кадром — эффекты есть,
// а увидеть их некому.
function bgCamFocus(px, py, span, dur) {
  if (!BG.ready) return;
  const fov = BG.cam.fov * Math.PI / 180;
  const d1 = Math.max(BG_DIST_MIN, Math.min(BG_DIST_MAX, (Math.max(span, BB.R * 8) * 0.62) / Math.tan(fov / 2)));
  if (Math.hypot(px - BG.tgt.x, py - BG.tgt.z) < BB.R * 0.5 && Math.abs(d1 - BG.dist) < BG.dist * 0.04) return;
  BG.camAnim = { x0: BG.tgt.x, z0: BG.tgt.z, x1: px, z1: py,
                 d0: BG.dist, d1, t0: performance.now(), dur: dur || 700 };
  bgKick();
}

// ── ФАЗА РАССТАНОВКИ: призраки выставленных бортов ──────────
// Драга по гексам тут НЕТ и не будет: он выпилен из 2D-доски осознанно (гексы
// мелкие, а «тяни пальцем» вдобавок убивал прокрутку ленты бортов). Порядок
// прежний — ＋/− на карточке и тап по гексу выбранным проектом, всё это живёт в
// DOM и работает как раньше. От сцены нужно одно: показать, что уже поставлено.
function bgSyncGhosts() {
  const s = BB.st;
  if (!BG.scene) return;
  if (!BG.g.gh) { BG.g.gh = new THREE.Group(); BG.scene.add(BG.g.gh); }
  BG.g.gh.clear();                            // геометрия и материалы общие — не чистим
  if (!s || s.status !== 'forming' || !Array.isArray(BB.place)) return;
  const face = -bbDirAngle(bbSideFacing(s.my_side));
  BB.place.forEach(p => {
    const size = (typeof bbClsSize === 'function' ? bbClsSize(p.cls) : 1);
    const L = BB.R * (0.75 + size * 1.15) * BG_SHIP_K;
    const m = bgBuildShip(p.cls, true, bgUnitHull(p));
    (m.userData.hullParts || []).forEach(q => { q.material = bgHullMat(true, false, true); });
    m.scale.setScalar(L);
    const c = bbHexCenter(p.x, p.y);
    m.position.set(c.px, L * 0.12, c.py);
    m.rotation.y = face;
    BG.g.gh.add(m);
  });
}

// Камера расстановки: свой СЕКТОР ПОДХОДА целиком.
// Сектор лежит где-то на кромке арены — камера целится в его якорь и
// разворачивается от центра арены к нему, чтобы враг был «впереди».
function bgCamDeploy() {
  const s = BB.st; if (!s || !BG.ready) return;
  const { W, H } = bbWorldSize();
  const a = (typeof bbMySpawn === 'function') ? bbMySpawn() : null;
  let span;
  if (a) {
    const c = bbHexCenter(a.x, a.y);
    BG.tgt.x = c.px; BG.tgt.z = c.py;
    span = (a.r + 2.5) * BB.R * 2 * 1.5;
    // смотреть из-за спины своего сектора в сторону центра арены
    BG.yaw = Math.atan2(c.py - H / 2, c.px - W / 2);
  } else {
    const z = s.zone || 3;
    span = (z + 2.5) * BB.R * 1.5;
    BG.tgt.x = s.my_side === 'attacker' ? span / 2 : W - span / 2;
    BG.tgt.z = H / 2;
    span *= 2;
    BG.yaw = -Math.PI / 2;
  }
  BG.dist = bgFitDist(span, span, 0.58);
  BG.pitch = 0.98;
  BG.camAnim = null;
  bgApplyCam(); BG.dirty = true; bgKick();
}

// Кнопки зума в HUD: в 3D приблизить = подъехать, а не растянуть картинку
function bgZoom(f) {
  if (!BG.ready) return;
  BG.dist = Math.max(BG_DIST_MIN, Math.min(BG_DIST_MAX, BG.dist / (f || 1)));
  BG.camAnim = null;
  bgApplyCam(); BG.dirty = true; bgKick();
}

// ── Полное обновление сцены под свежий снимок ───────────────
// Одна точка входа для интеграции: что бы ни поменялось на доске — состав,
// ландшафт, выбор борта, расстановка — сцену приводит в соответствие этот вызов.
function bgRefresh() {
  if (!BG.ready) return;
  // КАЖДЫЙ ШАГ В СВОЕЙ ОБЁРТКЕ. Сорвавшийся синхронизатор не имеет права
  // оставить доску пустой: раньше одно исключение (например на незнакомом
  // классе корабля у ботов) выносило разом и борта, и призраки расстановки,
  // и подсветку — на экране оставалось поле со звёздами и «ничего не ставится».
  // Теперь падает только свой кусок, а причина едет в консоль и в тост.
  const steps = [['ландшафт', bgSyncTerrain], ['борта', bgSyncUnits],
                 ['подписи', bgSyncStatus], ['расстановка', bgSyncGhosts],
                 ['подсветка', bgSyncOverlay]];
  for (const [nm, fn] of steps) {
    try { fn(); } catch (e) { bgSyncFail(nm, e); }
  }
  // КАДР ОБЯЗАТЕЛЕН. Синхронизаторы только помечают сцену грязной, а рисует
  // её цикл — и он спит, пока его не разбудят. Без этого выставленный борт и
  // приехавшее подкрепление появлялись на доске лишь после того, как игрок
  // случайно тронет камеру: сцена уже правильная, а кадр старый.
  BG.dirty = true; bgKick();
}

// Сбой синхронизации: в консоль полностью, игроку — коротко и один раз на шаг
// (иначе тост полезет на каждый опрос сервера).
function bgSyncFail(step, e) {
  console.error('[bg] сбой синхронизации сцены: ' + step, e);
  const seen = BG._failed || (BG._failed = new Set());
  if (seen.has(step)) return;
  seen.add(step);
  if (typeof toast === 'function') toast(`3D-доска: сбой «${step}» — ${e && e.message ? e.message : e}`, 'err');
}

// ════════════════════════════════════════════════════════════
// ПОДКЛЮЧЕНИЕ: загрузка three.js и подъём сцены
// ────────────────────────────────────────────────────────────
// three.js тянем ЛЕНИВО и только когда игрок реально открыл доску: библиотека
// весит под 600 КБ, а бои случаются далеко не в каждой сессии — грузить её всем
// и всегда значит платить трафиком за то, чем не пользуются. Модуль подключаем
// динамическим import: обычным <script> ESM не берётся, а CSP сайта jsdelivr
// уже разрешает (script-src ... https://cdn.jsdelivr.net).
// ════════════════════════════════════════════════════════════
const BG_THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

function bgLoadThree() {
  if (bgHasThree()) return Promise.resolve(true);
  if (!BG._load) {
    BG._load = import(BG_THREE_URL)
      .then(T => { window.THREE = T; return true; })
      .catch(e => { console.warn('[bg] three.js не загрузился, остаёмся на 2D', e); return false; });
  }
  return BG._load;
}

// Поднять сцену на готовом канвасе. Возвращает false — значит WebGL недоступен
// и звать надо 2D-доску: без этого часть игроков осталась бы без боя вовсе.
function bgAttach(canvas) {
  if (!bgHasThree()) return false;
  try {
    if (!bgInit(canvas)) return false;
  } catch (e) {
    console.warn('[bg] сцена не поднялась', e);
    return false;
  }
  // Потеря контекста (спящая вкладка, сброс драйвера) — не повод показывать
  // игроку чёрный прямоугольник: гасим 3D и отдаём ход 2D-доске.
  canvas.addEventListener('webglcontextlost', ev => {
    ev.preventDefault();
    console.warn('[bg] потерян контекст WebGL — возврат на 2D');
    if (typeof bbFallback2D === 'function') bbFallback2D();
  }, { once: true });
  bgCamHome();
  return true;
}

// ── Шаг анимации: борта на маршруте + лента эффектов ────────
// Возвращает «есть ли ещё живое», чтобы кадровый цикл знал, крутиться ли дальше.
function bgAnimStep(now) {
  let live = false;
  const A = BB.anim;
  if (!A) return false;

  // ДОВОРОТ КАМЕРЫ. Тянем и точку прицела, и дистанцию: одного смещения мало —
  // залп через полдоски не влезет в кадр, если не отъехать.
  const ca = BG.camAnim;
  if (ca) {
    const t = bbEase(Math.min(1, (now - ca.t0) / ca.dur));
    BG.tgt.x = bbLerp(ca.x0, ca.x1, t);
    BG.tgt.z = bbLerp(ca.z0, ca.z1, t);
    BG.dist = bbLerp(ca.d0, ca.d1, t);
    bgClampTarget(); bgApplyCam();
    BG.dirty = true;
    if (t >= 1) BG.camAnim = null; else live = true;
  }

  // ПОВОРОТ КНОПКОЙ. Отдельно от доворота к действиям: тот ведёт прицел, а
  // этот — только угол обзора, и они спокойно идут одновременно.
  const sp = BG.spin;
  if (sp) {
    const t = bbEase(Math.min(1, (now - sp.t0) / sp.dur));
    BG.yaw = bbLerp(sp.yaw0, sp.yaw1, t);
    bgApplyCam();
    BG.dirty = true;
    if (t >= 1) BG.spin = null; else live = true;
  }

  // ПЕРЕМЕЩЕНИЯ. Просроченные твины снимаем сами: 3D не вправе рассчитывать, что
  // цикл 2D-доски крутится (после выпиливания её не будет вовсе). Пересаживаем
  // борта и на том кадре, где твин снят, — иначе корабль замер бы в шаге от цели.
  if (A.move.size) {
    A.move.forEach((m, id) => { if (now - m.t0 >= m.dur) A.move.delete(id); else live = true; });
    bgPlaceUnits();
    BG.dirty = true; BG.moved = true;
  } else if (BG.moved) {
    // твин мог снять и цикл 2D-доски (на обкатке крутятся оба) — тогда наш кадр
    // застал бы борт в шаге от цели. Добиваем посадку разово.
    bgPlaceUnits();
    BG.dirty = true; BG.moved = false;
  }

  // ЭФФЕКТЫ. Сверяемся с лентой по тождеству объекта: что исчезло из BB.anim.fx
  // (погасило 2D или мы сами) — снимаем со сцены.
  const list = A.fx || [];
  const seen = BG._seen || (BG._seen = new Set());
  seen.clear();
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const raw = (now - f.t0) / f.dur;
    if (raw >= 1) continue;                     // догорел
    live = true;
    seen.add(f);
    if (raw < 0) continue;                      // отложенный залп ещё не начался
    let node = BG.fx.get(f);
    if (!node) { node = bgFxBuild(f); if (!node) continue; BG.fx.set(f, node); }
    node.step(raw);
  }
  if (BG.fx.size) {
    BG.fx.forEach((node, f) => { if (!seen.has(f)) { node.kill(); BG.fx.delete(f); } });
    BG.dirty = true;
  }
  return live;
}

// ════════════════════════════════════════════════════════════
// КАДР — только по необходимости
// ────────────────────────────────────────────────────────────
// Сцена статична, пока её не двигают, поэтому холостых кадров не жжём: рисуем
// по флагу dirty. Это же не даёт вернуться к прежней беде, когда доска
// перерисовывалась вхолостую. Пока в кадре живут твины или эффекты, цикл
// сам себя перезапускает — и останавливается, как только всё догорело.
// ════════════════════════════════════════════════════════════
function bgKick() { if (!BG.raf && BG.ready) BG.raf = requestAnimationFrame(bgFrame); }
function bgFrame() {
  BG.raf = 0;
  if (!BG.ready || !BG.renderer) return;
  const live = bgAnimStep(performance.now());
  if (BG.dirty) { BG.renderer.render(BG.scene, BG.cam); BG.dirty = false; }
  if (live) bgKick();
}
// Замена bbPaint() для 3D: своего кадра тут не собирают — сцена уже собрана,
// достаточно пометить её грязной и разбудить цикл.
function bgPaint() { BG.dirty = true; bgKick(); }

function bgDispose() {
  if (BG.raf) cancelAnimationFrame(BG.raf);
  BG.raf = 0; BG.ready = false; BG.camAnim = null;
  BG.spin = null; BG._failed = null;
  BG.fx.forEach(n => n.kill()); BG.fx.clear();
  BG.trail.forEach(t => t.material.dispose()); BG.trail.clear();
  BG.units.clear();
  if (BG.stat) BG.stat.clear();
  bgKillVeil();
  bgClearGroup(BG.g.ov); bgClearGroup(BG.g.terr); bgClearGroup(BG.g.st);
  BG._terrRef = null;
  if (BG.renderer) BG.renderer.dispose();
  BG.renderer = null; BG.scene = null; BG.cam = null; BG.g = {};
  window.removeEventListener('resize', bgResize);
}
