// ════════════════════════════════════════════════════════════════════
// ВИТРИНА ВЕРФИ — ТА ЖЕ МОДЕЛЬ, ЧТО ВЫЙДЕТ В БОЙ
// ────────────────────────────────────────────────────────────────────
// Конструктор показывал свой плоский SVG-чертёж вида сверху, и он НЕ ИМЕЛ
// НИЧЕГО ОБЩЕГО с тем, что игрок видит на арене: там честная трёхмерная модель
// (bgBuildShip из battle_gl.js) — корпус-лофт, надстройка класса, светящиеся
// дюзы. Обещать в верфи одно, а показывать в бою другое — обман, из-за него и
// возникает «у нас корабли в бою не так выглядят».
//
// Поэтому витрина собирает борт ТЕМ ЖЕ bgBuildShip, что и доска, и довешивает
// на него ровно то, чего боевая модель не знает, а игрок разложил на палубе:
// турели своего калибра, ленты навесной брони, блистеры модулей и купол щита.
//
// ⚠️ ЭТО ОТДЕЛЬНАЯ СЦЕНА, а не BG. BG на страницу один: сядь витрина в него —
// открытый бой и открытая верфь дрались бы за камеру, поле и цикл кадров.
// Общее у них ровно то, что и должно быть общим, — геометрия корабля.
// ⚠️ Сцена НАМЕРЕННО ЛЁГКАЯ: ни поля гексов, ни звёздной сферы на 2600 точек,
// ни ленты эффектов. Верфь открыта долго и на слабых машинах — платить за
// превью полноценной ареной нельзя.
// ════════════════════════════════════════════════════════════════════

const BGP = {
  cv: null, renderer: null, scene: null, cam: null, ship: null, raf: 0,
  // ⚠️ ДИСТАНЦИЯ НЕ КОНСТАНТА. Борта отличаются по габариту в разы (корвет vs
  // колосс, у которого корпус вообще рисует игрок), и любое зашитое число значит
  // «одни вылезают за кадр, другие болтаются точкой». Держим МНОЖИТЕЛЬ зума, а
  // саму дистанцию каждый кадр считаем от габаритной сферы модели и текущего
  // раствора камеры — тогда борт вписан при любой форме панели и любом корпусе.
  yaw: -0.75, pitch: 0.55, zoom: 1, rad: 0.8, spin: true,
  ptrs: new Set(), drag: null, key: null,
};

function bgPvReady() { return !!(BGP.renderer && BGP.scene); }

// Поднять витрину на канвасе. false — WebGL/three недоступны, и верфь остаётся
// на плоском чертеже: он никуда не делся и служит фолбэком.
function bgPvMount(canvas) {
  if (typeof THREE === 'undefined') return false;
  if (BGP.cv === canvas && bgPvReady()) return true;
  bgPvDispose();
  try {
    BGP.cv = canvas;
    BGP.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    BGP.renderer.setClearColor(0x000000, 0);
    BGP.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    BGP.scene = new THREE.Scene();
    BGP.cam = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
    // Свет — зеркало арены (bgBuildLights). Разойдись они, и металл в верфи
    // станет другого тона, чем в бою: «корабль другой» вернётся с другой стороны.
    const key = new THREE.DirectionalLight(0xfff0d8, 2.1);
    key.position.set(-0.55, 0.68, -0.48).multiplyScalar(10);
    BGP.scene.add(key);
    BGP.scene.add(new THREE.HemisphereLight(0x4a6ea8, 0x0a0f18, 0.85));
  } catch (e) { console.warn('[bgp] витрина не поднялась', e); bgPvDispose(); return false; }
  canvas.addEventListener('webglcontextlost', ev => { ev.preventDefault(); bgPvDispose(); }, { once: true });
  bgPvBind(canvas);
  bgPvKick();
  return true;
}

function bgPvDispose() {
  if (BGP.raf) cancelAnimationFrame(BGP.raf);
  BGP.raf = 0;
  if (BGP.renderer) { try { BGP.renderer.dispose(); } catch (e) {} }
  BGP.renderer = null; BGP.scene = null; BGP.cam = null; BGP.ship = null;
  BGP.cv = null; BGP.key = null; BGP.ptrs.clear(); BGP.drag = null;
}

// Мышь/палец: тащить — вращать борт, колесо — приблизить. Одна кнопка и никаких
// режимов: витрину крутят, а не редактируют.
function bgPvBind(cv) {
  cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', e => {
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    BGP.ptrs.add(e.pointerId);
    BGP.drag = { x: e.clientX, y: e.clientY };
    BGP.spin = false;                          // тронули — самокрут выключаем
  });
  cv.addEventListener('pointermove', e => {
    if (!BGP.drag || !BGP.ptrs.has(e.pointerId)) return;
    const dx = e.clientX - BGP.drag.x, dy = e.clientY - BGP.drag.y;
    BGP.drag = { x: e.clientX, y: e.clientY };
    BGP.yaw -= dx * 0.008;
    BGP.pitch = Math.max(-0.2, Math.min(1.45, BGP.pitch + dy * 0.006));
    bgPvKick();
  });
  const up = e => { BGP.ptrs.delete(e.pointerId); if (!BGP.ptrs.size) BGP.drag = null; };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    BGP.zoom = Math.max(0.35, Math.min(3, BGP.zoom * (e.deltaY > 0 ? 1.12 : 1 / 1.12)));
    bgPvKick();
  }, { passive: false });
}

function bgPvSpin(on) { BGP.spin = on == null ? !BGP.spin : !!on; bgPvKick(); }
function bgPvHome() { BGP.yaw = -0.75; BGP.pitch = 0.55; BGP.zoom = 1; bgPvKick(); }
function bgPvZoom(f) { BGP.zoom = Math.max(0.35, Math.min(3, BGP.zoom / f)); bgPvKick(); }
// Дистанция, при которой габаритная сфера борта целиком в кадре. Панель верфи
// широкая и низкая — узкое место ВЫСОТА, но при вертикальной раскладке (телефон)
// прижимает уже ширина, поэтому берём меньший из двух растворов.
function bgPvDist() {
  const cam = BGP.cam; if (!cam) return 3;
  const vf = cam.fov * Math.PI / 360;                      // полураствор по вертикали
  const hf = Math.atan(Math.tan(vf) * cam.aspect);         // и по горизонтали
  return (BGP.rad * 1.16) / Math.sin(Math.max(0.05, Math.min(vf, hf))) * BGP.zoom;
}

function bgPvKick() { if (!BGP.raf && bgPvReady()) BGP.raf = requestAnimationFrame(bgPvFrame); }

function bgPvFrame() {
  BGP.raf = 0;
  if (!bgPvReady()) return;
  const cv = BGP.cv;
  if (!cv || !cv.isConnected) { bgPvDispose(); return; }    // ушли со страницы — гасим цикл
  const pr = BGP.renderer.getPixelRatio();
  const w = cv.clientWidth || 1, h = cv.clientHeight || 1;
  if (cv.width !== Math.round(w * pr) || cv.height !== Math.round(h * pr)) {
    BGP.renderer.setSize(w, h, false);
    BGP.cam.aspect = w / h; BGP.cam.updateProjectionMatrix();
  }
  if (BGP.spin) BGP.yaw += 0.0028;                          // медленный оборот витрины
  const d = bgPvDist(), cp = Math.cos(BGP.pitch), sp = Math.sin(BGP.pitch);
  const c = BGP.mid || { x: 0, y: 0, z: 0 };
  BGP.cam.position.set(c.x + Math.cos(BGP.yaw) * cp * d, c.y + sp * d, c.z + Math.sin(BGP.yaw) * cp * d);
  BGP.cam.lookAt(c.x, c.y, c.z);
  // Дюзы дышат: витрина должна выглядеть живой, а не скриншотом.
  if (BGP.ship && BGP.ship.userData.jets) {
    const t = performance.now() * 0.004;
    BGP.ship.userData.jets.forEach((j, i) => j.scale.set(1, 1.1 + 0.16 * Math.sin(t + i), 1));
  }
  BGP.renderer.render(BGP.scene, BGP.cam);
  if (BGP.ship || BGP.spin) BGP.raf = requestAnimationFrame(bgPvFrame);
}

// Цвет ствола по типу урона — те же три семейства, что в верфи и в бою.
const BGP_WCOL = { energy: 0x5adcf0, missile: 0xff5a7a, kinetic: 0xd8dee6 };
// Цвет модуля по семейству — зеркало CN_FAM_COL, но в hex для three.
const BGP_FAMCOL = {
  sensor: 0x7fd4ff, jam: 0xe0b457, dejam: 0x9ae6a0, pd: 0xff9f6f, stealth: 0xa78bfa,
  hangar: 0x79c0ff, ftl: 0x8fe3d0, stabil: 0xc9d4e0, interdict: 0xff7f9f, hull: 0x9fb3c8,
};

// ── СБОРКА ВИТРИНЫ ────────────────────────────────────────────────────────────
// spec = {
//   cls,                              класс корпуса (тот же ключ, что уходит в бой)
//   hull,                             маска корпуса «Имперского колосса» (у него
//                                     силуэта класса нет — его рисует игрок)
//   cell,                             РАЗМЕР КЛЕТКИ ПАЛУБЫ в долях длины борта —
//                                     единственная честная мера для навески:
//                                     узел на 2 клетки и должен быть вдвое
//                                     крупнее узла на одну, а не «в долю от
//                                     местной ширины борта» (на широком корпусе
//                                     это давало башни размером с корабль)
//   guns:   [{u, a, sz, kind}]        u — доля длины от носа, a — −1..1 поперёк,
//                                     sz — 's'|'m'|'l' (типоразмер узла),
//                                     kind — energy|missile|kinetic
//   plates: [{u, a, len, kind}]       навесная броня: лента вдоль борта
//   mods:   [{u, a, fam, cells}]      модули палубы
//   shield: {rt, idx} | null          купол: сила 0..1 и тип (цвет)
// }
// ⚠️ ВСЕ КООРДИНАТЫ НОРМИРОВАНЫ (u, a), а не в пикселях чертежа. Палуба меряет
// корабль клетками SVG-силуэта, модель — долями длины; связать их сырыми числами
// значит поймать разъезд на первом же классе с другим силуэтом.
function bgPvSet(spec) {
  if (!bgPvReady() || !spec) return false;
  const key = JSON.stringify(spec);
  if (key === BGP.key && BGP.ship) return true;             // ничего не менялось — не пересобираем
  BGP.key = key;
  if (BGP.ship) { BGP.scene.remove(BGP.ship); BGP.ship = null; }
  const cls = spec.cls, hull = spec.hull || null;
  let grp;
  try { grp = bgBuildShip(cls, true, hull); }
  catch (e) { console.warn('[bgp] корпус не собрался', e); return false; }
  const hwAt = x => bgHullHW(cls, x, hull);
  const depthAt = x => bgHullDepth(cls, x, hull);
  const steel = () => bgHullMat(true);
  // Клетка палубы — общая мера навески. Нет её (старый вызов) — берём осторожный
  // запасной размер от габарита, но НИКОГДА не от локальной полуширины.
  const CL = Math.max(0.006, Math.min(0.09, +spec.cell || bgHullBeam(cls, hull) * 0.22));
  const jets = (grp.userData.nz || []).slice();

  // Навеска садится по МЕСТНОЙ ширине и глубине корпуса: башня у острого носа
  // мельче, чем на миделе, — иначе она висит в воздухе за обводом.
  const at = (u, a) => {
    const x = 0.5 - Math.min(1, Math.max(0, u));
    const hw = Math.max(0.02, hwAt(x));
    return { x: x, y: depthAt(x) * 0.92, z: Math.max(-1, Math.min(1, a)) * hw * 0.9, hw: hw };
  };

  // 1) ТУРЕЛИ. Не иконка и не спрайт: барбет, вращающийся блок и стволы —
  // калибр читается с любого ракурса, а не только сверху.
  (spec.guns || []).forEach(g => {
    const p = at(g.u, g.a);
    // Размер башни = размеру её узла на палубе: 1, 2 или 3 клетки. Ровно то, что
    // игрок видит в разрезе палубы, — ни больше, ни меньше.
    const s = (g.sz === 'l' ? 3 : g.sz === 'm' ? 2 : 1) * CL / 1.4;
    const col = BGP_WCOL[g.kind] || BGP_WCOL.kinetic;
    const t = new THREE.Group();
    const bb = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.62, s * 0.72, s * 0.22, 12), steel());
    bb.position.y = s * 0.11;
    t.add(bb);
    if (g.kind === 'missile') {
      // ПУ вертикального пуска: короб с ячейками, стволов нет
      const box = new THREE.Mesh(bgTaper(s * 1.1, s * 0.5, s * 0.9, 0.92, 0.94, 0), steel());
      box.position.y = s * 0.47;
      t.add(box);
      const lamp = bgGlowMat(col, 1.0);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(s * 0.22, s * 0.03, s * 0.28), lamp);
        c.position.set((i - 1) * s * 0.3, s * 0.73, (j - 0.5) * s * 0.36);
        t.add(c);
      }
    } else {
      const tw = new THREE.Mesh(bgTaper(s * 1.05, s * 0.55, s * 0.95, 0.7, 0.78, s * 0.06), steel());
      tw.position.y = s * 0.5;
      t.add(tw);
      const nb = g.sz === 'l' ? 3 : g.sz === 'm' ? 2 : 1;   // стволов по калибру узла
      const barL = s * (g.sz === 'l' ? 1.5 : g.sz === 'm' ? 1.2 : 0.95);
      const lamp = bgGlowMat(col, 1.2);
      for (let i = 0; i < nb; i++) {
        const dz = (i - (nb - 1) / 2) * s * 0.26;
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.075, s * 0.09, barL, 8), steel());
        bar.rotation.z = Math.PI / 2;
        bar.position.set(s * 0.5 + barL * 0.5, s * 0.52, dz);
        t.add(bar);
        // дульный срез светится типом урона — видно, чем борт бьёт
        const mz = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.085, s * 0.085, s * 0.06, 8), lamp);
        mz.rotation.z = Math.PI / 2;
        mz.position.set(s * 0.5 + barL, s * 0.52, dz);
        t.add(mz);
      }
    }
    t.position.set(p.x, p.y, p.z);
    // Бортовая турель смотрит наружу, осевая — вперёд по курсу.
    t.rotation.y = Math.abs(g.a) < 0.25 ? 0 : (g.a > 0 ? -Math.PI / 2 : Math.PI / 2);
    grp.add(t);
  });

  // 2) НАВЕСНАЯ БРОНЯ. Лента вдоль борта; толщина по виду: покрытие тонкое,
  // пояс средний, разнесённый экран стоит с зазором от обшивки (он и есть
  // разнесённый — зазор тут не украшение, а суть).
  (spec.plates || []).forEach(pl => {
    const p = at(pl.u, pl.a);
    // Толщина ленты — доля КЛЕТКИ, а не полуширины борта: плита это навес на
    // обшивку, а не второй корпус (на широком борте она вырастала в пристройку).
    const th = CL * (pl.kind === 'coat' ? 0.3 : pl.kind === 'armor' ? 0.5 : 0.7);
    const gap = pl.kind === 'screen' ? CL * 0.5 : CL * 0.06;
    const len = Math.max(CL, pl.len || CL);
    const h = depthAt(p.x) * (pl.kind === 'coat' ? 0.8 : 1.1);
    const side = pl.a >= 0 ? 1 : -1;
    const slab = new THREE.Mesh(bgTaper(len, h, th, 0.8, 0.92, 0), steel());
    slab.position.set(p.x, -h * 0.04, side * (p.hw + gap + th * 0.5));
    grp.add(slab);
  });

  // 3) МОДУЛИ. Блистер на палубе цвета семейства: тарелка сенсоров, штанга РЭБ,
  // купол ПРО, люк ангара — по силуэту видно, чем борт набит, без единой подписи.
  (spec.mods || []).forEach(md => {
    const p = at(md.u, md.a);
    const col = BGP_FAMCOL[md.fam] || BGP_FAMCOL.hull;
    // Блистер по КОНТУРУ модуля: сколько клеток занял — такой и коробка.
    const s = CL * Math.max(0.7, Math.min(2.6, Math.sqrt(md.cells || 1)));
    const lamp = bgGlowMat(col, 0.9);
    const g2 = new THREE.Group();
    const base = new THREE.Mesh(bgTaper(s * 1.1, s * 0.35, s * 1.0, 0.85, 0.92, 0), steel());
    base.position.y = s * 0.17;
    g2.add(base);
    if (md.fam === 'sensor' || md.fam === 'dejam') {
      const dish = new THREE.Mesh(new THREE.SphereGeometry(s * 0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), lamp);
      dish.scale.set(1, 0.45, 1); dish.position.y = s * 0.42; dish.rotation.z = 0.5;
      g2.add(dish);
    } else if (md.fam === 'jam' || md.fam === 'interdict') {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.07, s * 0.1, s * 1.5, 6), steel());
      mast.position.y = s * 1.05; g2.add(mast);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(s * 0.16, 8, 6), lamp);
      tip.position.y = s * 1.82; g2.add(tip);
    } else if (md.fam === 'pd') {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(s * 0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), steel());
      dome.position.y = s * 0.34; g2.add(dome);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.45, s * 0.45, s * 0.05, 12), lamp);
      ring.position.y = s * 0.37; g2.add(ring);
    } else if (md.fam === 'hangar') {
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(s * 1.5, s * 0.05, s * 0.9), lamp);
      hatch.position.y = s * 0.36; g2.add(hatch);
    } else {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(s * 0.9, s * 0.05, s * 0.24), lamp);
      strip.position.y = s * 0.35; g2.add(strip);
    }
    g2.position.set(p.x, p.y, p.z);
    grp.add(g2);
  });

  // 4) ЩИТ. Купол вокруг всего борта: прозрачный и аддитивный — поле, а не
  // мыльный пузырь с плотной кромкой.
  if (spec.shield && spec.shield.rt > 0) {
    const sc = [0x5adcf0, 0xe0b457, 0xc0b8ff][spec.shield.idx || 0] || 0x5adcf0;
    const beam = bgHullBeam(cls, hull);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 16), new THREE.MeshBasicMaterial({
      color: sc, transparent: true, opacity: 0.08 + 0.07 * spec.shield.rt,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    dome.scale.set(1.0, Math.max(0.3, beam * 3.0), Math.max(0.34, beam * 3.4));
    grp.add(dome);
  }

  grp.userData.jets = jets;
  BGP.ship = grp;
  BGP.scene.add(grp);
  // Габарит СО ВСЕЙ НАВЕСКОЙ: мачты модулей и купол щита торчат за корпус, и
  // кадрировать по одному лофту значит срезать ровно то, ради чего витрина.
  try {
    const box = new THREE.Box3().setFromObject(grp);
    const sph = box.getBoundingSphere(new THREE.Sphere());
    if (isFinite(sph.radius) && sph.radius > 0) { BGP.rad = sph.radius; BGP.mid = { x: sph.center.x, y: sph.center.y, z: sph.center.z }; }
  } catch (e) { BGP.rad = 0.8; BGP.mid = null; }
  bgPvKick();
  return true;
}
