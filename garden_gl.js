// ════════════════════════════════════════════════════════════════════
// «УЙТИ В ПУСТОТУ» — ТРЁХМЕРНАЯ СЦЕНА (движок арены «Дредноут»)
// ────────────────────────────────────────────────────────────────────
// Зачем это вместо изометрии: сад — единственное место игры, где камера стоит
// ВПЛОТНУЮ к предметам, и рисованная изометрия там держалась на честном слове.
// Планета была кругом с градиентом, кольцо — эллипсом из отрезков, камни —
// многоугольниками с накладной «жилой», корабль — обводкой шпангоутов. Каждая
// из этих вещей по отдельности сделана аккуратно, но вместе они не складываются
// в место: нет ни одного общего источника света, у предметов нет объёма, и
// глубина сообщается только порядком отрисовки. Арена «Дредноут» решает ровно
// ту же задачу (борт вблизи, камни, пустота) и решает её иначе — сценой с
// настоящим светом. Здесь взято её решение целиком:
//   • тот же свет (тёплый ключевой + холодная полусфера) — bgBuildLights/DN.mount;
//   • те же звёзды-подложка, туманность-спрайт и БЛИЖНЯЯ ПЫЛЬ как прибор скорости;
//   • те же ВОКСЕЛЬНЫЕ камни (dn_voxel.js, window.VOX) — гранёная порода, а не
//     многоугольник с обводкой;
//   • тот же корпус, что на доске боя и в верфи (bgBuildShip из battle_gl.js):
//     «факельщик» перестаёт быть значком и становится тем же кораблём.
//
// ⚠️ УПРАВЛЕНИЕ НЕ ТРОНУТО, И ЭТО НАМЕРЕННО. Камера смотрит с ФИКСИРОВАННОГО
// направления — 45° по азимуту и 34° над плоскостью, то есть ровно туда же,
// куда смотрела изометрия (gIso: экранное «вправо» = мировое (1,−1), экранное
// «вниз» = (1,1)). Поэтому W/A/S/D, стик, gardenNear и попадание клика в грядку
// продолжают означать то же самое, что и раньше. Погоня за носом («камера за
// кормой») выглядит эффектнее, но это ДРУГАЯ игра: она ломает и раскладку
// клавиш, и подбор ячейки под манипулятором, и привычку игрока.
//
// ⚠️ ПРИБОРЫ ОСТАЮТСЯ НА 2D-ХОЛСТЕ. Подписи, схема системы, реплики садовода и
// прицел сети рисуются поверх — тем же ctx, что и раньше, но по экранным
// координатам из project(). Мир — здесь, надписи — там: пытаться писать текст
// мешами значит потерять кириллицу, чёткость и всю верстку HUD.
//
// Единицы: мировые (tx,ty) кладутся в плоскость XZ один в один, Y — высота.
// Экспорт: window.GDGL
// ════════════════════════════════════════════════════════════════════
window.GDGL = (function () {
'use strict';

const G = {
  ok: false, cv: null, renderer: null, scene: null, cam: null,
  world: null, org: { x: 0, z: 0 },
  vw: 960, vh: 540,
  sky: null, dust: null, key: null,
  planet: null, ring: null, bays: null,
  ship: null, hat: null, jets: [],
  peers: new Map(), rocks: [], net: null, halo: [],
  plots: [], plotHost: null,
  camPos: null, camAt: null, first: true,
};

const V = (x, y, z) => new THREE.Vector3(x || 0, y || 0, z || 0);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// Камера: азимут 45° и подъём 34° — то же направление взгляда, что у изометрии
// 2:1 (её наклон arctg .5 ≈ 26.6°; берём чуть выше, перспектива иначе кладёт
// кольцо в линию). Менять эти два числа нельзя без правки moveVec в garden.js.
const CAM_AZ = Math.PI * .25, CAM_EL = 34 * Math.PI / 180;
const CAM_D = 46;                       // база отхода, в мировых единицах
// ⚠️ БОРТ ИДЁТ НАД КОЛЬЦОМ, А НЕ СКВОЗЬ НЕГО. Плоскость игры одна (мировые
// tx,ty), и если положить корабль ровно в неё, он проходит рельсы, фермы и
// теплицы насквозь — сад читается голограммой. Своя высота стоит ноль игровых
// последствий (подбор ячейки и клик считаются по проекции на плоскость), но
// возвращает постройке телесность: над ней ЛЕТАЮТ.
const SHIP_ALT = 6.5;

// ── §1. Загрузка. three.js берём тем же ленивым импортом, что и доска боя
// (bgLoadThree), воксели — обычным тегом: их файл живёт в арене и в кабинет
// не подключён. Обе загрузки одноразовые и не роняют сад, если не удались.
let _load = null;
function load() {
  if (_load) return _load;
  _load = (typeof bgLoadThree === 'function' ? bgLoadThree() : Promise.resolve(false))
    .then(ok => {
      if (!ok || typeof THREE === 'undefined') return false;
      if (window.VOX) return true;
      return new Promise(res => {
        const s = document.createElement('script');
        s.src = 'dn_voxel.js?v=20260828gdgl';
        s.onload = () => res(true);
        s.onerror = () => res(true);          // без вокселей камни будут гранёные, но будут
        document.head.appendChild(s);
      });
    })
    .catch(() => false);
  return _load;
}

// ── §2. Сцена ────────────────────────────────────────────────
function mount(canvas, world) {
  if (typeof THREE === 'undefined') return false;
  const n0 = world && world.nodes && world.nodes[0];
  if (!n0 || !world.solo) return false;        // трёхмерный сад — только Храм
  try {
    G.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  } catch (e) { return false; }
  G.cv = canvas; G.world = world;
  G.org = { x: n0.tx, z: n0.ty };
  G.renderer.setClearColor(0x04070c, 1);
  G.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  G.scene = new THREE.Scene();
  G.cam = new THREE.PerspectiveCamera(52, 1, .5, 30000);
  G.camPos = V(); G.camAt = V();

  // Свет — зеркало арены: тёплый ключевой (светило) плюс холодная полусфера,
  // чтобы теневая сторона не была дырой. Ключевой каждый кадр разворачивается
  // по sunAt, тому же, что двигал тень на ободе в изометрии.
  G.key = new THREE.DirectionalLight(0xfff0d8, 2.2);
  G.scene.add(G.key);
  G.scene.add(new THREE.HemisphereLight(0x4a6ea8, 0x090e16, .8));

  buildSky(); buildDust(); buildPlanet(n0); buildRing(n0);
  G.ok = true;
  return true;
}

function buildSky() {
  const N = 900, p = new Float32Array(N * 3), c = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const v = V(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
      .normalize().multiplyScalar(9000);
    p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z;
    const k = .12 + Math.random() * .38;
    c[i * 3] = k * (.7 + Math.random() * .3); c[i * 3 + 1] = k * (.8 + Math.random() * .2); c[i * 3 + 2] = k;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  // ⚠️ ЗВЁЗД МАЛО И ОНИ ТУСКЛЫЕ — тот же довод, что на арене: плотное яркое небо
  // читается шумом поверх сцены, а не фоном. Работает ближняя пыль.
  G.sky = new THREE.Group();
  G.sky.add(new THREE.Points(g, new THREE.PointsMaterial({
    size: 16, vertexColors: true, sizeAttenuation: true,
    transparent: true, opacity: .55, depthWrite: false,
  })));
  const neb = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex(), color: 0x4a3aa0, transparent: true, opacity: .40,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  neb.position.set(-3000, 900, -4200); neb.scale.set(6000, 4200, 1);
  G.sky.add(neb);
  const neb2 = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex(), color: 0x1f5f78, transparent: true, opacity: .28,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  neb2.position.set(3600, -700, 3000); neb2.scale.set(5200, 3400, 1);
  G.sky.add(neb2);
  G.scene.add(G.sky);
}

let _glow = null;
function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(.35, 'rgba(255,255,255,.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return (_glow = new THREE.CanvasTexture(c));
}

// ⚠️ ПЫЛЬ — ПРИБОР СКОРОСТИ, А НЕ УКРАШЕНИЕ. Дословно арена: звёзды на девяти
// тысячах единиц неподвижны при любом ходе, кольцо далеко, и без ближней взвеси
// корабль «стоит» даже на разгоне. Точки живут в кубе вокруг камеры и
// заворачиваются на противоположную грань.
const DUST_N = 700, DUST_BOX = 90;
function buildDust() {
  const p = new Float32Array(DUST_N * 3);
  for (let i = 0; i < DUST_N * 3; i++) p[i] = (Math.random() * 2 - 1) * DUST_BOX;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  G.dust = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0x93b6cc, size: .34, sizeAttenuation: true,
    transparent: true, opacity: .5, depthWrite: false,
  }));
  G.dust.frustumCulled = false;
  G.scene.add(G.dust);
}
function stepDust() {
  const c = G.cam.position, a = G.dust.geometry.attributes.position, arr = a.array;
  const o = [c.x, c.y, c.z];
  for (let i = 0; i < DUST_N; i++) {
    for (let k = 0; k < 3; k++) {
      const j = i * 3 + k, d = arr[j] - o[k];
      if (d > DUST_BOX) arr[j] -= DUST_BOX * 2;
      else if (d < -DUST_BOX) arr[j] += DUST_BOX * 2;
    }
  }
  a.needsUpdate = true;
}

// ── §3. Планета. ⚠️ ЭТО ГЛАВНЫЙ ПРЕДМЕТ КАДРА. В изометрии она была кругом с
// радиальным градиентом и накладным терминатором — то есть плоской. Здесь шар
// со своей текстурой, атмосферным ободком (сфера чуть больше, вывернутая
// нормалями внутрь) и настоящей тенью от ключевого света: терминатор считает
// освещение, а не рисуется поверх.
function buildPlanet(n0) {
  const host = n0.host || {};
  const R = (host.r || 46);
  const grp = new THREE.Group();
  grp.position.set(0, 0, 0);
  const mat = new THREE.MeshLambertMaterial({ map: planetTex(host, n0.seed | 0) });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), mat);
  ball.rotation.y = (n0.seed | 0) * .01;
  grp.add(ball);
  // Атмосфера: тонкая оболочка, светящаяся к краю. Держится на BackSide и
  // аддитивном смешении — дешевле шейдера Френеля и на нашем ракурсе неотличимо.
  const air = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.035, 48, 32),
    new THREE.MeshBasicMaterial({
      color: 0x5fa8e8, transparent: true, opacity: .10,
      side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
  grp.add(air);
  G.planet = { grp, ball, R };
  G.scene.add(grp);
}

// Текстура планеты пишется на холсте по тем же приметам, что рисовал 2D-пейнтер
// (группа тела задаёт палитру), плюс пятна материков и полярные шапки. Шум
// детерминированный: мир должен выглядеть одинаково от входа к входу.
function planetTex(host, seed) {
  const W = 1024, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const grp = host.grp || 'rock';
  const PAL = {
    ocean: ['#12324e', '#1d5878', '#4e8fa8'],
    rock: ['#2c2a26', '#4a4238', '#6d6152'],
    ice: ['#25333f', '#4a6272', '#9fc0d2'],
    lava: ['#231311', '#5c2317', '#b4501f'],
    gasgiant: ['#2a2438', '#5b4a6e', '#9d86ad'],
  };
  const pal = PAL[grp] || PAL.rock;
  x.fillStyle = pal[0]; x.fillRect(0, 0, W, H);
  let s = (seed || 7) * 2654435761 % 2147483647;
  const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
  // Материки — крупные кляксы, поверх них мелкая крапина: без второго слоя шар
  // читается воздушным шариком в разводах.
  for (let i = 0; i < 46; i++) {
    x.fillStyle = pal[1 + (i % 2)];
    x.globalAlpha = .18 + rnd() * .30;
    const cx = rnd() * W, cy = H * (.18 + rnd() * .64), r = 30 + rnd() * 150;
    x.beginPath(); x.ellipse(cx, cy, r, r * (.45 + rnd() * .5), rnd() * 3, 0, 7); x.fill();
  }
  for (let i = 0; i < 1400; i++) {
    x.globalAlpha = .05 + rnd() * .12;
    x.fillStyle = rnd() > .5 ? '#ffffff' : '#000000';
    x.beginPath(); x.arc(rnd() * W, rnd() * H, 1 + rnd() * 5, 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  // Шапки: у газового гиганта их нет, у остальных — по вкусу мира.
  if (grp !== 'gasgiant') {
    const cap = grp === 'lava' ? 'rgba(90,60,50,.55)' : 'rgba(226,240,250,.72)';
    x.fillStyle = cap;
    x.fillRect(0, 0, W, H * .045); x.fillRect(0, H * .955, W, H * .045);
    x.globalAlpha = .5;
    x.fillRect(0, H * .045, W, H * .03); x.fillRect(0, H * .925, W, H * .03);
    x.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

// ── §4. Кольцо. Обод из двух рельсов и GD_BAYS отсеков между ними: та же
// постройка, что рисовалась отрезками, но теперь она стоит в пространстве и
// ловит свет — с тёмной стороны планеты она честно тонет.
// ⚠️ РАЗМЕРЫ КОЛЬЦА СЧИТАЮТСЯ ОТ РАДИУСА ПЛАНЕТЫ, А НЕ ПИШУТСЯ ЧИСЛАМИ. Обод в
// три единицы шириной был подобран под планету в 46: планета выросла — и то же
// число превратило постройку в проволочку вокруг мира. Всё, что ниже, — доли
// радиуса, поэтому сад остаётся сооружением при любом калибре тела.
const BAYS = 48, RING_K = 1.19;
function buildRing(n0) {
  const RP = (n0.host ? n0.host.r : 110);
  const R = RP * RING_K;
  const W = RP * .058;                     // полуширина обода
  const grp = new THREE.Group();
  const steel = new THREE.MeshLambertMaterial({ color: 0x8a99a8, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3b444f, flatShading: true });
  // Рельсы: труба заметной толщины — тонкий тор с орбиты не читается вовсе.
  [R - W, R + W].forEach(r => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r, W * .17, 6, 260), steel);
    t.rotation.x = Math.PI / 2;
    grp.add(t);
  });
  // Хребет между рельсами — по нему обод читается лентой, а не двумя обручами.
  const spine = new THREE.Mesh(new THREE.TorusGeometry(R, W * .1, 4, 260), dark);
  spine.rotation.x = Math.PI / 2;
  grp.add(spine);
  // Отсеки, фермы и мачты — инстансами: три вызова отрисовки на весь сад.
  const bay = new THREE.InstancedMesh(new THREE.BoxGeometry(W * 1.5, W * .34, W * 2), dark, BAYS);
  const truss = new THREE.InstancedMesh(new THREE.BoxGeometry(W * .22, W * .22, W * 2.2), steel, BAYS);
  const mast = new THREE.InstancedMesh(new THREE.BoxGeometry(W * .16, W * .9, W * .16), steel, BAYS);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V(1, 1, 1), p = V();
  const e = new THREE.Euler();
  for (let j = 0; j < BAYS; j++) {
    // Плоскость кольца — XZ, поэтому «угол по ободу» это поворот вокруг Y, а сам
    // угол берётся тем же выражением, что и в world.cells (иначе теплицы
    // разъедутся с отсеками, на которых стоят).
    const a = (j / BAYS) * Math.PI * 2 + (n0.seed | 0) * .01;
    p.set(Math.cos(a) * R, 0, Math.sin(a) * R);
    e.set(0, -a, 0); q.setFromEuler(e);
    m.compose(p, q, sc); bay.setMatrixAt(j, m);
    p.set(Math.cos(a) * R, W * .55, Math.sin(a) * R);
    m.compose(p, q, sc); mast.setMatrixAt(j, m);
    const a2 = a + Math.PI / BAYS;
    p.set(Math.cos(a2) * R, 0, Math.sin(a2) * R);
    e.set(0, -a2, 0); q.setFromEuler(e);
    m.compose(p, q, sc); truss.setMatrixAt(j, m);
  }
  [bay, truss, mast].forEach(o => { o.instanceMatrix.needsUpdate = true; grp.add(o); });
  G.ring = { grp, R, W };
  G.scene.add(grp);
}

// ── §5. Теплицы. Своих отсеков десятки, поэтому обычные меши: их пересобирают
// на каждое обновление состояния (посев, полив, урожай), и инстансы тут только
// мешали бы. Купол светится изнутри — это единственный тёплый свет на ободе,
// по нему сад и читается издали.
// cells: [{tx,ty,mine,plant:{ripe,care}}]
function setPlots(cells) {
  if (!G.ok) return;
  if (G.plotHost) { G.scene.remove(G.plotHost); disposeTree(G.plotHost); }
  G.flags = [];
  const host = new THREE.Group();
  const W = G.ring ? G.ring.W : 6;         // мерка отсека: всё на нём от неё
  (cells || []).forEach(cc => {
    const x = cc.tx - G.org.x, z = cc.ty - G.org.z;
    const pl = cc.plant;
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(W * 1.2, W * .2, W * 1.2),
      new THREE.MeshLambertMaterial({ color: cc.mine ? 0x6f7d8c : 0x4a5058, flatShading: true }));
    frame.position.set(x, W * .3, z);
    host.add(frame);
    if (cc.fcol || cc.fnm) host.add(flagPost(cc, x, z, W));
    if (pl) {
      // Цвет купола ведёт РЕЖИМ, а не культура — тот же довод, что в 2D: беду
      // надо читать с одного взгляда, какой бы формы ни была посадка.
      const care = pl.care != null ? pl.care : 1;
      const col = pl.ripe ? 0xffc46b
        : new THREE.Color(.42 + (1 - care) * .5, .78 - (1 - care) * .3, .62 - (1 - care) * .35).getHex();
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(W * .55, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .55 }));
      dome.position.set(x, W * .4, z);
      dome.scale.set(1, .8, 1);
      host.add(dome);
      const lamp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex(), color: col, transparent: true, opacity: pl.ripe ? .85 : .5,
        depthWrite: false, blending: THREE.AdditiveBlending }));
      lamp.position.set(x, W * .5, z); lamp.scale.set(W * 3.4, W * 3.4, 1);
      host.add(lamp);
    }
  });
  G.plotHost = host;
  G.scene.add(host);
}

// ── §5б. ФЛАГ НАД ЯЧЕЙКОЙ ────────────────────────────────────
// ⚠️ ЧЬЯ ГРЯДКА — ДОЛЖНО БЫТЬ ВИДНО, А НЕ УЗНАВАТЬСЯ ТЫЧКОМ. Тот же довод, что
// и в изометрии, где флагшток и появился: сосед без флага безымянен до касания.
// Полотнище — не картинка на плоскости: герб державы КРОИТСЯ по ткани (гербы
// широкие, 736×491 и шире; вписанные в квадрат, они мнутся в грязное пятно), а
// цвет державы остаётся кромкой и полосой у древка. Ветра в пустоте нет, но
// станция живёт — по ткани идёт волна (см. stepFlags).
const _herTex = {};
function flagTex(col, herUrl) {
  const key = (col || '') + '|' + (herUrl || '');
  if (_herTex[key]) return _herTex[key];
  const c = document.createElement('canvas'); c.width = 128; c.height = 72;
  const x = c.getContext('2d');
  x.fillStyle = col || '#6f8bb5'; x.fillRect(0, 0, 128, 72);
  const tex = new THREE.CanvasTexture(c);
  if (herUrl) {
    const im = new Image();
    im.crossOrigin = 'anonymous';          // герб лежит в Storage: иначе канвас «пачкается»
    im.onload = () => {
      const k = Math.max(128 / im.width, 72 / im.height);
      const dw = im.width * k, dh = im.height * k;
      try { x.drawImage(im, (128 - dw) / 2, (72 - dh) / 2, dw, dh); } catch (e) { return; }
      x.fillStyle = col || '#6f8bb5'; x.fillRect(0, 0, 12, 72);   // полоса у древка
      tex.needsUpdate = true;
    };
    im.src = herUrl;
  }
  // Тень по нижней кромке: без неё ткань читается наклейкой.
  const g = x.createLinearGradient(0, 0, 0, 72);
  g.addColorStop(0, 'rgba(255,255,255,.18)');
  g.addColorStop(.55, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,.3)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 72);
  tex.needsUpdate = true;
  return (_herTex[key] = tex);
}

function flagPost(cc, x, z, W) {
  const g = new THREE.Group();
  const H = W * 2.2, CW = W * 1.35, CH = W * .76;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(W * .05, W * .05, H, 6),
    new THREE.MeshLambertMaterial({ color: 0xc4ced8 }));
  pole.position.y = H / 2;
  g.add(pole);
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(CW, CH, 10, 1),
    new THREE.MeshLambertMaterial({
      map: flagTex(cc.fcol, cc.fher), side: THREE.DoubleSide,
      transparent: true, opacity: cc.mine ? 1 : .78 }));
  // Полотнище уходит от древка наружу и висит у верхушки — как и в изометрии,
  // иначе ткань ложится ровно туда, где поднимается культура.
  cloth.position.set(CW / 2, H - CH * .75, 0);
  g.add(cloth);
  g.position.set(x, W * .4, z);
  // Древко ставим на дальней кромке отсека и разворачиваем от планеты наружу:
  // так флаг виден с подхода, а не с изнанки кольца.
  g.rotation.y = -(cc.a || 0);
  G.flags.push({ cloth, CW, ph: Math.random() * 6.28 });
  return g;
}

function stepFlags(t) {
  if (!G.flags) return;
  for (let i = 0; i < G.flags.length; i++) {
    const f = G.flags[i], a = f.cloth.geometry.attributes.position, arr = a.array;
    for (let v = 0; v < a.count; v++) {
      const u = (arr[v * 3] + f.CW / 2) / f.CW;       // 0 у древка, 1 у кромки
      arr[v * 3 + 2] = Math.sin(t * 2.1 + f.ph + u * 5.2) * f.CW * .1 * u;
    }
    a.needsUpdate = true;
  }
}

function disposeTree(o) {
  o.traverse(n => {
    if (n.geometry) n.geometry.dispose();
    if (n.material && n.material.dispose && !n.material.userData.keep) n.material.dispose();
  });
}

// ── §6. Камни. Воксельные — ровно те же, что укрытия арены (dn_voxel.js).
// ⚠️ ЦВЕТ СОРТА КРАСИТСЯ МАТЕРИАЛОМ, А НЕ ЗАМЕНОЙ ГЕОМЕТРИИ: сорт камня меняется
// прямо в полёте (astStep возвращает пойманный другим), и пересобирать решётку
// на каждую такую смену — заведомая просадка кадра.
const ROCK_MAT = {};
function rockMat(T) {
  if (ROCK_MAT[T]) return ROCK_MAT[T];
  const base = (window.VOX && G._voxMat) ? G._voxMat : null;
  const m = new THREE.MeshLambertMaterial({
    color: T === 2 ? 0x8d7fc4 : T === 1 ? 0xb08a4e : 0x6a747f,
    flatShading: true, map: base ? base.map : null,
  });
  m.userData.keep = 1;
  return (ROCK_MAT[T] = m);
}

function syncRocks(list, t) {
  if (!G.ok) return;
  for (let i = 0; i < list.length; i++) {
    const A = list[i];
    let R = G.rocks[i];
    if (!R) {
      const pos = V(A.tx - G.org.x, 0, A.ty - G.org.z);
      let o = null;
      if (window.VOX) {
        try { o = VOX.make(G.scene, pos, A.r, (A.sd | 0) + 1); } catch (e) { o = null; }
        if (o && !G._voxMat) G._voxMat = o.mesh.material;
      }
      let node;
      if (o) { node = o.mesh; }
      else {
        node = new THREE.Mesh(new THREE.IcosahedronGeometry(A.r, 0),
                              new THREE.MeshLambertMaterial({ color: 0x6a747f, flatShading: true }));
        G.scene.add(node);
      }
      // Ореол редкого камня: тот же спрайт свечения, что у туманности. В 2D он
      // рисовался градиентом под телом — здесь честно висит в пространстве и не
      // выдаёт себя при облёте.
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex(), transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending }));
      G.scene.add(halo);
      R = G.rocks[i] = { vox: o, node, halo, tier: -1 };
    }
    const vis = !(A.gone > 0);
    R.node.visible = vis;
    R.halo.visible = vis && (A.tier | 0) > 0;
    if (!vis) continue;
    if (R.tier !== (A.tier | 0)) {
      R.tier = A.tier | 0;
      R.node.material = rockMat(R.tier);
      R.halo.material.color.set(R.tier === 2 ? 0xa892d6 : 0xc9a24a);
    }
    // ⚠️ У ПОЯСА ЕСТЬ ТОЛЩИНА. Все камни ровно в плоскости обода — это лента из
    // картона: в кадре они выстраиваются в одну линию, и пустота перестаёт быть
    // объёмом. Высота детерминированная (от зерна камня) и небольшая: клик
    // считается по проекции на плоскость, и уводить её далеко нельзя.
    if (R.y == null) R.y = ((A.sd % 97) / 97 - .5) * 7;
    R.node.position.set(A.tx - G.org.x, R.y, A.ty - G.org.z);
    R.node.rotation.set(A.rot * .6, A.rot, A.rot * .35);
    R.halo.position.copy(R.node.position);
    R.halo.visible = R.halo.visible && R.tier > 0;
    if (R.tier > 0) {
      const pu = .78 + .22 * Math.sin(t * (R.tier === 2 ? 2.6 : 1.7) + A.sd);
      R.halo.material.opacity = (R.tier === 2 ? .40 : .28) * pu;
      const s = A.r * (R.tier === 2 ? 9 : 7);
      R.halo.scale.set(s, s, 1);
    }
  }
}

// ── §7. Корабли. Корпус берём у доски боя (bgBuildShip) — тот же «факельщик»,
// что игрок видит в верфи и в бою. Шляпа садовода остаётся: она и есть подпись
// этого места, но теперь это предмет, а не рисунок поверх силуэта.
const HULL_TONE = {
  steel: 0x8fa2b6, copper: 0xb16a34, bone: 0xb8b1a1, moss: 0x33513f, void: 0x4a4066,
};
function buildShipNode(look, tone) {
  let grp = null;
  if (typeof bgBuildShip === 'function') {
    try { grp = bgBuildShip('hypercruiser', tone || 'mine', null); } catch (e) { grp = null; }
  }
  if (!grp) {
    grp = new THREE.Group();
    grp.add(new THREE.Mesh(new THREE.ConeGeometry(.22, 1, 7),
      new THREE.MeshLambertMaterial({ color: 0x8fa2b6, flatShading: true })));
    grp.children[0].rotation.z = -Math.PI / 2;
  }
  const wrap = new THREE.Group();
  const len = (G.world && G.world.shipU) || 7;
  grp.scale.setScalar(len);
  wrap.add(grp);
  // ⚠️ РАСЦВЕТКА ЗАДАЁТ ЦВЕТ, А НЕ ПОДМЕШИВАЕТ ЕГО. Смесь «на 55% к выбранному»
  // на текстурованной обшивке доски боя даёт разницу, которой не видно с
  // расстояния камеры, — а игрок при этом ВЫБРАЛ медь или хвою. Ставим цвет
  // насмерть (клону, не общему материалу доски боя).
  const col = new THREE.Color(HULL_TONE[(look && look.hull) || 'steel']);
  grp.traverse(n => {
    if (n.isMesh && n.material && n.material.color) {
      n.material = n.material.clone();
      n.material.color.copy(col);
    }
  });
  // ⚠️ ШЛЯПА САДИТСЯ ПО ФАКТИЧЕСКОМУ ОБВОДУ КОРПУСА. Прежде её место считалось
  // от одной лишь длины (0.17·len) — и на настоящем корпусе с доски боя, где
  // есть надстройка и мачта, она оказывалась ВНУТРИ борта. Со стороны это
  // читалось как «выбор облика не работает»: игрок берёт шлем, а на экране
  // ничего не меняется. Меряем габарит и ставим шляпу над рубкой, размером от
  // ширины борта.
  const box = new THREE.Box3().setFromObject(grp);
  const beam = Math.max(box.max.z - box.min.z, len * .18);
  const hat = hatMesh((look && look.hat) || 'straw', beam * .42);
  hat.position.set(box.min.x + (box.max.x - box.min.x) * .38,
                   box.max.y + beam * .1, 0);
  wrap.add(hat);
  return wrap;
}

// Шляпа: тем же набором, что и в 2D (соломенная, фуражка, кот, шлем) — узнаётся
// силуэтом, поэтому четыре разные формы, а не четыре цвета одной.
function hatMesh(kind, R) {
  const g = new THREE.Group();
  const M = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  if (kind === 'cap') {
    const t = new THREE.Mesh(new THREE.SphereGeometry(R * .6, 12, 8, 0, 6.28, 0, Math.PI / 2), M(0x1b2733));
    const v = new THREE.Mesh(new THREE.BoxGeometry(R * .8, R * .1, R * 1.1), M(0x121a24));
    v.position.set(R * .55, R * .05, 0);
    g.add(t, v);
  } else if (kind === 'helm') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(R * .72, 14, 10, 0, 6.28, 0, Math.PI * .62), M(0x9fb0c0)));
    const cr = new THREE.Mesh(new THREE.BoxGeometry(R * .14, R * .5, R * 1.2), M(0xdfe9f2));
    cr.position.y = R * .5; g.add(cr);
  } else if (kind === 'cat') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(R * .7, 14, 10), M(0xd9b98a)));
    [-1, 1].forEach(s => {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(R * .22, R * .45, 5), M(0xc7a276));
      ear.position.set(0, R * .72, s * R * .38); g.add(ear);
    });
  } else {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.25, R * 1.35, R * .1, 14), M(0xd8bd7a));
    const top = new THREE.Mesh(new THREE.CylinderGeometry(R * .55, R * .68, R * .55, 12), M(0xc8a961));
    top.position.y = R * .32;
    g.add(brim, top);
  }
  return g;                                // место задаёт buildShipNode, см. выше
}

function ensureShip(look) {
  const key = (look.hat || '') + '|' + (look.hull || '');
  if (G.ship && G.shipKey === key) return;
  if (G.ship) { G.scene.remove(G.ship); disposeTree(G.ship); }
  G.ship = buildShipNode(look, 'mine');
  G.shipKey = key;
  G.scene.add(G.ship);
}

function syncPeers(list) {
  const seen = new Set();
  (list || []).forEach(q => {
    seen.add(q.id);
    let n = G.peers.get(q.id);
    if (!n) {
      n = buildShipNode({ hat: q.hat, hull: q.hull }, 'ally');
      G.scene.add(n);
      G.peers.set(q.id, n);
    }
    n.position.set(q.tx - G.org.x, SHIP_ALT + (q.bob || 0) * .06, q.ty - G.org.z);
    n.rotation.y = -screenAngToWorld(q.ang);
  });
  G.peers.forEach((n, id) => {
    if (seen.has(id)) return;
    G.scene.remove(n); disposeTree(n); G.peers.delete(id);
  });
}

// ⚠️ КУРС ХРАНИТСЯ В ЭКРАННЫХ РАДИАНАХ. P.ang в garden.js — это угол НА ЭКРАНЕ
// (его считает изометрия, и по нему же сверяется след). Здесь нужен угол в
// плоскости мира, а между ними ровно то преобразование, которым gIso сплющивает
// плоскость: экранный (cos,sin) отвечает мировому направлению
// ((cos/(TW/2) + sin/(TH/2)) , (sin/(TH/2) − cos/(TW/2))) с точностью до нормы.
const TW2 = 32, TH2 = 16;
function screenAngToWorld(a) {
  const cx = Math.cos(a) / TW2, sy = Math.sin(a) / TH2;
  return Math.atan2(sy - cx, cx + sy);      // (dz, dx) → поворот вокруг Y
}

// ── §8. Кадр ─────────────────────────────────────────────────
// o: { P, t, dt, rocks, peers, look, netFly, boost }
function frame(o) {
  if (!G.ok) return;
  const P = o.P, t = o.t;
  const sa = t * .02;                                   // тот же sunAt, что был в 2D
  G.key.position.set(Math.cos(sa) * 1000, 180, Math.sin(sa) * 1000);

  ensureShip(o.look || {});
  const sx = P.tx - G.org.x, sz = P.ty - G.org.z;
  G.ship.position.set(sx, SHIP_ALT + (P.bob || 0) * .06, sz);
  G.ship.rotation.y = -screenAngToWorld(P.ang);
  // Крен на повороте: борт кладётся в разворот, как на арене. Без него корабль
  // едет доской — курс меняется, а корпус этого не отыгрывает.
  const wa = screenAngToWorld(P.ang);
  let d = wa - (G._wa == null ? wa : G._wa);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  G._wa = wa;
  G._roll = (G._roll || 0) + (clamp(-d / Math.max(.001, o.dt) * .22, -.5, .5) - (G._roll || 0)) * Math.min(1, o.dt * 5);
  G.ship.rotation.z = G._roll;

  syncRocks(o.rocks || [], t);
  syncPeers(o.peers);
  stepFlags(t);
  netLine(o.netFly, P, t);

  // Камера: фиксированное направление, отход растёт с разгоном. Плавно —
  // рывок масштаба читается глюком, а не ускорением (тот же довод, что и в 2D).
  const want = CAM_D * (1 + (P.boost || 0) * .55);
  G._d = G._d == null ? want : G._d + (want - G._d) * Math.min(1, o.dt * 2.2);
  const hor = Math.cos(CAM_EL) * G._d, ver = Math.sin(CAM_EL) * G._d;
  // ⚠️ КАМЕРА СТОИТ СО СТОРОНЫ (+X,+Z) И СМОТРИТ В (−1,0,−1). Знак здесь решает
  // ВСЁ управление: с камерой на противоположной стороне «от себя» на экране
  // означает РОСТ tx+ty, а W в moveVec его уменьшает — и весь ввод читается
  // перевёрнутым. Поставленная так камера повторяет взгляд изометрии: экранное
  // «вверх» = уменьшение tx+ty (как gIso и клала ось Y), экранное «вправо» =
  // мировое (1,−1). Не менять знаки, не поменяв moveVec в garden.js.
  G.camPos.set(sx + Math.cos(CAM_AZ) * hor, ver + SHIP_ALT, sz + Math.sin(CAM_AZ) * hor);
  G.camAt.set(sx, SHIP_ALT * .6, sz);
  if (G.first) { G.cam.position.copy(G.camPos); G.first = false; }
  else G.cam.position.lerp(G.camPos, Math.min(1, o.dt * 12));
  G.cam.lookAt(G.camAt);
  G.sky.position.copy(G.cam.position);
  stepDust();
  G.renderer.render(G.scene, G.cam);
}

// Сеть: отрезок от корабля к камню. Полёт считает garden.js (netFly), здесь
// только натянутая нить и вспышка на конце.
function netLine(fly, P, t) {
  if (!fly || !fly.rock) { if (G.net) G.net.visible = false; return; }
  if (!G.net) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    G.net = new THREE.Line(g, new THREE.LineBasicMaterial({
      color: 0xd7ebfc, transparent: true, opacity: .7 }));
    G.scene.add(G.net);
  }
  const u = clamp((t - fly.t0) / fly.dur, 0, 1);
  const k = fly.back ? Math.max(0, 2 - u) : u;
  const a = G.net.geometry.attributes.position, arr = a.array;
  const x0 = P.tx - G.org.x, z0 = P.ty - G.org.z;
  const x1 = fly.rock.tx - G.org.x, z1 = fly.rock.ty - G.org.z;
  arr[0] = x0; arr[1] = SHIP_ALT; arr[2] = z0;
  arr[3] = x0 + (x1 - x0) * k; arr[4] = SHIP_ALT * (1 - k); arr[5] = z0 + (z1 - z0) * k;
  a.needsUpdate = true;
  G.net.visible = true;
}

// ── §9. Мост к приборам ──────────────────────────────────────
// Проекция мировой точки в ЛОГИЧЕСКИЕ пиксели 2D-холста: подписи, прицел сети и
// реплики садовода рисуются поверх сцены тем же ctx, что и раньше.
// ⚠️ ВОЗВРАЩАЕТСЯ ОДИН И ТОТ ЖЕ ОБЪЕКТ. Проекций за кадр десятки (подписи,
// прицел, соседи), и плодить на каждую по объекту значит кормить сборщик мусора
// прямо в петле. Цена: результат живёт до СЛЕДУЮЩЕГО вызова — сравнивать две
// точки, не скопировав первую, нельзя.
const _pv = { x: 0, y: 0, on: false };
function project(tx, ty, h) {
  if (!G.ok) return null;
  const v = V(tx - G.org.x, h || 0, ty - G.org.z).project(G.cam);
  _pv.x = (v.x * .5 + .5) * G.vw;
  _pv.y = (-v.y * .5 + .5) * G.vh;
  _pv.on = v.z < 1;
  return _pv;
}

// Клик: луч в плоскость обода (y=0). Изометрия считала то же самое обратной
// формулой gUniso; здесь честный луч, и он не врёт на краю кадра.
const _ray = { r: null, pl: null };
function pick(sx, sy) {
  if (!G.ok) return null;
  if (!_ray.r) {
    _ray.r = new THREE.Raycaster();
    _ray.pl = new THREE.Plane(V(0, 1, 0), 0);
  }
  _ray.r.setFromCamera({ x: sx / G.vw * 2 - 1, y: -(sy / G.vh * 2 - 1) }, G.cam);
  const p = V();
  if (!_ray.r.ray.intersectPlane(_ray.pl, p)) return null;
  return { tx: p.x + G.org.x, ty: p.z + G.org.z };
}

function resize(w, h, dpr) {
  if (!G.ok) return;
  G.vw = w; G.vh = h;
  G.renderer.setPixelRatio(Math.min(2, dpr || 1));
  G.renderer.setSize(w, h, false);
  G.cam.aspect = w / Math.max(1, h);
  G.cam.updateProjectionMatrix();
}

function dispose() {
  if (!G.ok) return;
  G.rocks.forEach(R => {
    if (R.vox && window.VOX) { try { VOX.dispose(R.vox, G.scene); } catch (e) {} }
    else G.scene.remove(R.node);
    G.scene.remove(R.halo);
  });
  G.rocks = [];
  G.peers.forEach(n => { G.scene.remove(n); disposeTree(n); });
  G.peers.clear();
  if (G.plotHost) { G.scene.remove(G.plotHost); disposeTree(G.plotHost); G.plotHost = null; }
  try { G.renderer.dispose(); } catch (e) {}
  G.flags = [];
  G.ok = false; G.ship = null; G.net = null; G.first = true;
  G._d = null; G._wa = null; G._roll = 0;
}

return { load, mount, setPlots, frame, project, pick, resize, dispose,
         get ready() { return G.ok; },
         // Высота, на которой идёт борт: подписи над кораблём рисует garden.js,
         // и без неё реплика садовода висела бы у него под килем.
         get ALT() { return SHIP_ALT; },
         // Только для стендов (_gd3d_harness.html): в игре к этому никто не ходит.
         debug: () => G };
})();
