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

  // тёмное «дно» поля: даёт кораблям фон и ловит границу арены
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ color: 0x060a12, transparent: true, opacity: 0.62, depthWrite: false })
  );
  base.rotation.x = -Math.PI / 2;
  base.position.set(W / 2, -1, H / 2);
  grp.add(base);

  // зоны развёртывания — заливка у торцов, а не решётка
  const meAtt = s.my_side === 'attacker';
  const z = s.zone || 3;
  const zw = bbHexCenter(z - 1, 0).px + BB.R;
  const zone = (x0, w, hex) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, H),
      new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.10, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x0 + w / 2, 0, H / 2);
    grp.add(m);
  };
  zone(0, zw, meAtt ? BG_C.mine : BG_C.foe);
  zone(W - zw, zw, meAtt ? BG_C.foe : BG_C.mine);

  bgBuildEdgeFog(grp, W, H);

  // кромка арены — тонкая рамка по границе поля
  const edge = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(W, 0, 0),
      new THREE.Vector3(W, 0, H), new THREE.Vector3(0, 0, H),
    ]),
    new THREE.LineBasicMaterial({ color: BG_C.grid, transparent: true, opacity: 0.28 })
  );
  grp.add(edge);

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

// ── РЕЖИМ ОБЗОРА (вращение камеры пальцем) ──────────────────
// На телефоне повернуть камеру было практически нечем: ПКМ и Shift там нет,
// а доворот щипком ловится через раз (порог в 12°, иначе камеру ведёт при
// каждом обычном зуме). Кнопка «⟳» в панели боя включает режим обзора —
// тогда ОДИН палец крутит и наклоняет камеру, а не тянет поле. Тап без
// протяжки при этом работает как раньше: по гексу можно ткнуть, не выходя
// из режима.
function bgOrbitMode(on) {
  BG.orbitMode = (on == null) ? !BG.orbitMode : !!on;
  if (BG.cv) BG.cv.style.cursor = BG.orbitMode ? 'move' : '';
  return BG.orbitMode;
}
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
        ang: Math.atan2(b.sy - a.sy, b.sx - a.sx),
        twist: 0,                               // копим доворот до порога, см. ниже
      };
      BG.drag = BG.orbit = null;
      return;
    }
    // ПКМ / Shift / включённый режим обзора — орбита, иначе тянем поле
    if (ev.button === 2 || ev.shiftKey || BG.orbitMode) {
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
        // Доворот щипком: до порога в ~12° крутить нельзя, иначе камера ведёт
        // при каждом обычном сведении пальцев.
        const ang = Math.atan2(b.sy - a.sy, b.sx - a.sx);
        let da = ((ang - P.ang) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        P.twist += da;
        if (Math.abs(P.twist) > 0.21) { BG.yaw += da; }
        P.ang = ang;
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
const BG_RING = 14;          // вершин в сечении
// Сечение АСИММЕТРИЧНО по вертикали: палуба выпуклая, днище почти плоское.
// Симметричный лофт давал «батон» — по нему не понять ни где верх, ни куда нос.
const BG_DECK = 1.05;        // полувысота над осью (доля полуширины)
const BG_KEEL = 0.50;        // полувысота под осью
const BG_SE = 2.6;           // степень суперэллипса: 2 — эллипс, больше — гранёнее

function bgSection(k, hw) {
  const a = (k / BG_RING) * Math.PI * 2;
  const ca = Math.cos(a), sa = Math.sin(a);
  const p = 2 / BG_SE;
  const hh = hw * (sa >= 0 ? BG_DECK : BG_KEEL);
  return {
    z: Math.sign(ca) * Math.pow(Math.abs(ca), p) * hw,
    y: Math.sign(sa) * Math.pow(Math.abs(sa), p) * hh,
  };
}

// Геометрия корпуса ЕДИНИЧНОЙ длины, нос смотрит в +X, центр в начале координат.
// Кэшируется по классу: борта одного класса делят одну геометрию на видеокарте.
function bgHullGeo(cls) {
  const cache = BG._hull || (BG._hull = {});
  if (cache[cls]) return cache[cls];

  // bbGeo уже знает соответствие KV-класс → силуэт и запасной вариант
  const H = (typeof bbGeo === 'function') ? bbGeo(cls) : null;
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

  const pos = [], idx = [];
  rows.forEach(rw => {
    const hw = Math.max(rw.hw, 1e-4);
    const x = 0.5 - rw.u;                       // нос (u=0) → +X, корма (u=1) → −X
    for (let k = 0; k < BG_RING; k++) {
      const e = bgSection(k, hw);
      pos.push(x, e.y, e.z);
    }
  });
  // сшиваем соседние кольца в полосы четырёхугольников
  for (let r = 0; r < rows.length - 1; r++) {
    const a = r * BG_RING, b = (r + 1) * BG_RING;
    for (let k = 0; k < BG_RING; k++) {
      const k2 = (k + 1) % BG_RING;
      idx.push(a + k, b + k, a + k2);
      idx.push(a + k2, b + k, b + k2);
    }
  }
  // крышка кормы (нос сходится в точку сам — там полуширина 0)
  const last = (rows.length - 1) * BG_RING;
  const cap = pos.length / 3;
  pos.push(0.5 - rows[rows.length - 1].u, 0, 0);
  for (let k = 0; k < BG_RING; k++) idx.push(last + k, cap, last + (k + 1) % BG_RING);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();                   // светотень: ради неё всё и делалось
  cache[cls] = geo;
  return geo;
}

// Максимальная полуширина корпуса (в долях длины) — по ней сажаются надстройка
// и дюзы, чтобы они были пропорциональны классу, а не прибиты константой.
function bgHullBeam(cls) {
  const H = (typeof bbGeo === 'function') ? bbGeo(cls) : null;
  const st = (H && H.st && H.st.length > 1) ? H.st : [[0, 0], [300, 20]];
  const tip = st[0][0], stern = st[st.length - 1][0];
  const L = (stern - tip) || 1;
  return Math.max(...st.map(p => p[1])) / L;
}

// СИЛУЭТ НАПРАВЛЕНИЯ. Голый лофт симметричен вдоль оси, и куда смотрит борт —
// не понять. Достраиваем два признака, которые читаются мгновенно и с любого
// ракурса: надстройка смещена К КОРМЕ (значит перед — там, где её нет) и
// светящиеся дюзы в самом хвосте.
function bgBuildShip(cls, mine) {
  const grp = new THREE.Group();
  const beam = bgHullBeam(cls);

  const hull = new THREE.Mesh(bgHullGeo(cls), bgHullMat(mine));
  grp.add(hull);

  // надстройка: рубка на палубе, ближе к корме
  const bw = beam * 0.85, bh = beam * 1.25, bl = 0.20;
  const br = new THREE.Mesh(new THREE.BoxGeometry(bl, bh, bw), bgHullMat(mine));
  grp.userData.hullParts = [hull, br];          // им меняют материал, когда борт отходил
  br.position.set(-0.16, beam * BG_DECK * 0.75 + bh * 0.32, 0);
  grp.add(br);
  // мостик — узкая светящаяся полоса на рубке, смотрит вперёд
  const gl = new THREE.Mesh(
    new THREE.BoxGeometry(bl * 0.16, bh * 0.26, bw * 0.82),
    bgGlowMat(mine ? 0x9fe8ff : 0xffc0d4, 0.9)
  );
  gl.position.set(-0.16 + bl * 0.5, br.position.y + bh * 0.10, 0);
  grp.add(gl);

  // дюзы: раскалённые сопла в срезе кормы — самый сильный указатель «зад тут».
  // Держим их списком: на ходу факел вытягивается, и это единственное, что
  // отличает идущий борт от стоящего, когда след ушёл за корму из кадра.
  const nz = beam * 0.42, jets = [];
  [-1, 0, 1].forEach(o => {
    if (o !== 0 && beam < 0.06) return;         // у мелочи одно сопло
    const e = new THREE.Mesh(
      new THREE.CylinderGeometry(nz * 0.55, nz * 0.72, 0.055, 10),
      bgGlowMat(0xffb469, 1.5)
    );
    e.rotation.z = Math.PI / 2;                 // ось сопла вдоль корпуса
    e.position.set(-0.5 + 0.02, -beam * 0.06, o * nz * 1.15);
    grp.add(e);
    jets.push(e);
  });
  grp.userData.nz = jets;

  return grp;
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
    const key = (u.contact ? '?' : u.cls) + '|' + (u.mine ? 1 : 0);
    let m = BG.units.get(u.id);
    if (m && m.userData.key !== key) { bgDropUnit(u.id); m = null; }   // сменился класс/сторона/захват
    if (!m) {
      // неопознанный контакт: отметка на радаре без ТТХ и без корпуса —
      // сервер не отдал класс, и рисовать «какой-нибудь» корабль нельзя
      const L = u.contact ? BB.R * 0.8
        : BB.R * (0.75 + (typeof bbClsSize === 'function' ? bbClsSize(u.cls) : 1) * 1.15) * BG_SHIP_K;
      m = u.contact ? bgBuildContact() : bgBuildShip(u.cls, u.mine);
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
    const uu = (!u.contact && (forming || !u.moved))
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
function bgHullMat(mine, dim, ghost) {
  const cache = BG._hullMat || (BG._hullMat = {});
  const k = (mine ? 'mine' : 'foe') + (dim ? '-dim' : '') + (ghost ? '-gh' : '');
  if (cache[k]) return cache[k];
  cache[k] = new THREE.MeshStandardMaterial({
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

function bgFxBuild(f) {
  if (f.kind === 'beam') return bgFxBeam(f);
  if (f.kind === 'flash') return bgFxFlash(f);
  if (f.kind === 'hit' || f.kind === 'boom') return bgFxBlast(f);
  return null;
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
    const grow = boom ? R * (0.5 + t * 1.35) : R * (0.28 + t * 0.6);
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

// ── Кромка арены: тьма к краям ──────────────────────────────
// Четыре полосы по границам поля — тот же приём, что bbPaintEdgeFog, только
// плашмя в плоскости. Доска не «обрывается» голой геометрией.
function bgBuildEdgeFog(grp, W, H) {
  const R = BB.R, d = R * 4.2;
  const mat = () => new THREE.MeshBasicMaterial({
    map: bgTexFade(), transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const band = (cx, cz, w, h, dx, dz) => {
    const m = new THREE.Mesh(BG._quad || (BG._quad = new THREE.PlaneGeometry(1, 1)), mat());
    bgLayFlat(m, cx, 0.6, cz, w, h, dx, dz);
    grp.add(m);
  };
  band(-R + d / 2, H / 2, d, H + 2 * R, -1, 0);        // левая: тьма снаружи
  band(W + R - d / 2, H / 2, d, H + 2 * R, 1, 0);      // правая
  band(W / 2, -R + d / 2, d, W + 2 * R, 0, -1);        // верх
  band(W / 2, H + R - d / 2, d, W + 2 * R, 0, 1);      // низ
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
  if (s.status === 'forming') { bgSyncDeployZone(G); return; }

  const sel = (s.units || []).find(u => u.id === BB.sel);
  if (!sel || !s.my_turn) return;
  const R = BB.R;
  const canAct = sel.acted || s.acts_left > 0;
  const mine = bgCol(BG_C.mine);

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
  if (!sel.moved && canAct) {
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
  if (!sel.fired && canAct) {
    (s.units || []).forEach(u => {
      if (u.mine || u.side === s.my_side) return;
      if (!bbCanHit(sel, u).ok) return;
      bgMarkHex(G, u.x, u.y, bgCol(BG_C.foe), 0.22, 0.55);
    });
  }
  // режим ремонта: союзники под нано-рой
  if (BB.heal && !sel.fired && canAct) {
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
    const shF = (u.max_shield > 0) ? Math.max(0, Math.min(1, u.shield / u.max_shield)) : 0;
    st.hpF = hpF; st.shF = shF;
    st.hp.material.color.set(hpF > 0.5 ? bgCol(u.mine ? BG_C.mine : BG_C.foe)
                           : hpF > 0.25 ? new THREE.Color(0xffbe46) : new THREE.Color(0xff4646));
    st.sh.visible = shF > 0;
    // «уже отходил» — гасим борт, как alpha 0.5 в 2D
    const spent = u.mine && s.my_turn && ((u.moved && u.fired) || (!u.acted && !(s.acts_left > 0)));
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
    const m = bgBuildShip(p.cls, true);
    (m.userData.hullParts || []).forEach(q => { q.material = bgHullMat(true, false, true); });
    m.scale.setScalar(L);
    const c = bbHexCenter(p.x, p.y);
    m.position.set(c.px, L * 0.12, c.py);
    m.rotation.y = face;
    BG.g.gh.add(m);
  });
}

// Камера расстановки: своя зона спавна целиком по высоте доски
function bgCamDeploy() {
  const s = BB.st; if (!s || !BG.ready) return;
  const { W, H } = bbWorldSize();
  const z = s.zone || 3;
  const zoneW = (z + 2.5) * BB.R * 1.5;
  BG.tgt.x = s.my_side === 'attacker' ? zoneW / 2 : W - zoneW / 2;
  BG.tgt.z = H / 2;
  // Своя зона по ширине — и НЕ вся высота. На большой арене (60 рядов) полная
  // высота отгоняет камеру так далеко, что борта становятся точками и экран
  // читается как пустой. Борта садятся от середины наружу, поэтому показываем
  // середину: 22 ряда вокруг неё, дальше игрок отъедет сам.
  const rows = Math.min(H, 22 * BB.R * BB_SQ3);
  BG.dist = bgFitDist(zoneW * 2, rows, 0.58);
  BG.pitch = 0.98; BG.yaw = -Math.PI / 2;
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
  BG.spin = null; BG.orbitMode = false; BG._failed = null;
  BG.fx.forEach(n => n.kill()); BG.fx.clear();
  BG.trail.forEach(t => t.material.dispose()); BG.trail.clear();
  BG.units.clear();
  if (BG.stat) BG.stat.clear();
  bgClearGroup(BG.g.ov); bgClearGroup(BG.g.terr); bgClearGroup(BG.g.st);
  BG._terrRef = null;
  if (BG.renderer) BG.renderer.dispose();
  BG.renderer = null; BG.scene = null; BG.cam = null; BG.g = {};
  window.removeEventListener('resize', bgResize);
}
