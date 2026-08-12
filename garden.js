// ============================================================
// ✦ «УЙТИ В ПУСТОТУ» — карта галактики в натуральную величину
// ------------------------------------------------------------
// Мир НЕ выдуман: это те же map_systems / map_sectors, разложенные в плоскость.
//   система → СВЕТИЛО и площадка вокруг него: обжитый круг, на нём ячейки
//   сектор  → рукав: свой цвет вещества у площадок
//   всё остальное → пустота, и её тут подавляющее большинство
//
// ⚠️ ПОЧЕМУ ТУТ НЕТ ТАЙЛОВОГО ПОЛА. Три версии подряд мир мостился ромбами:
// сплошным полем, потом клочьями, потом материками по секторам. Каждый раз
// выходил огород, а не космос, и причина не в палитре и не в декоре — В
// МАСШТАБЕ. Видимая сетка ромбов НАЗНАЧАЕТ единицу измерения: если под килем
// клетка в 64 пикселя, то звезда неизбежно получается ростом с несколько
// клеток, то есть с корабль, а расстояние между системами — в десяток шагов.
// Никакой рисовкой это не лечится.
//
// Поэтому масштаб задан заново и от звезды:
//   • светило рисуется НАСТОЯЩЕГО размера — сотни пикселей, оно подавляет
//     всё в кадре, как и должно;
//   • площадка вокруг него — тонкий обжитой ободок, а не земля;
//   • соседние системы разведены на GD_SPACING (сотни тайлов) — между ними
//     пустой ход, который надо пройти гипером;
//   • камера в гипере отъезжает, и видно, какое это на самом деле расстояние.
// Пола нет вообще: под кораблём либо площадка, либо пустота.
//
// Зеркало сервера: _garden.sql (имена RPC там прежние, «садовые»).
// ============================================================

const GD_TW = 64, GD_TH = 32;        // изометрия 2:1: единица мира в пикселях
const GD_SPACING = 115;              // на столько разводим СОСЕДНИЕ системы
const GD_PLAT = 15;                  // радиус площадки вокруг светила (в единицах)
const GD_REACH = 2.6;                // на сколько дотягивается манипулятор
const GD_SPEED = 11;                 // единиц в секунду обычным ходом
const GD_LIFT = 12;                  // толщина площадки (px)

// Рукава. p — плита площадки, d — её тень и скол, t — светлая жила,
// x — акцент обломков. Гамма холодная: цвет различает рукава, а не кричит.
const GD_ARMS = [
  { key: 'ash',    nm: 'Пепельный',   p: '#1a212b', d: '#131922', t: '#28323f', x: '#7f95ab' },
  { key: 'glass',  nm: 'Стеклянный',  p: '#152530', d: '#0f1c25', t: '#20394a', x: '#7fc4d8' },
  { key: 'rust',   nm: 'Ржавый',      p: '#241f21', d: '#1a1617', t: '#39302e', x: '#c98f6a' },
  { key: 'steel',  nm: 'Стальной',    p: '#1b232a', d: '#141a20', t: '#2b3742', x: '#9fb3c4' },
  { key: 'amet',   nm: 'Аметистовый', p: '#1e1c2b', d: '#161421', t: '#2f2a44', x: '#a892d6' },
];
const GD_EDGE = '#8fd3ff';            // холодный акцент: кромка, интерфейс
const GD_WARM = '#ffc46b';            // тёплый акцент: светила, готовый урожай

// Оттенок от базового цвета: k<1 темнее, k>1 светлее.
// Результат кэшируется: функция зовётся пачками при запекании площадок, а
// разбор hex-строки каждый раз — чистая трата.
const _gdShade = new Map();
function gShade(hex, k) {
  const kq = Math.round(k * 50) / 50;
  const key = hex + '|' + kq;
  let v = _gdShade.get(key);
  if (v) return v;
  const n = parseInt(hex.slice(1), 16);
  const r = gClamp(Math.round((n >> 16) * kq), 0, 255);
  const g = gClamp(Math.round(((n >> 8) & 255) * kq), 0, 255);
  const b = gClamp(Math.round((n & 255) * kq), 0, 255);
  v = `rgb(${r},${g},${b})`;
  _gdShade.set(key, v);
  return v;
}

// Мягкое пятно света отдельной картинкой: радиальный градиент дорог, а нужен
// он десятки раз за кадр — рисуем один раз в буфер и потом растягиваем.
function gGlowSprite(rgb, inner) {
  const R = 96, c = document.createElement('canvas');
  c.width = c.height = R * 2;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(R, R, 0, R, R, R);
  rg.addColorStop(0, `rgba(${rgb},${inner})`);
  rg.addColorStop(.42, `rgba(${rgb},${inner * .32})`);
  rg.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = rg; g.fillRect(0, 0, R * 2, R * 2);
  return c;
}

const gClamp = (v, a, b) => v < a ? a : v > b ? b : v;
function gHash(x, y, s) {
  let n = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
// Плавный шум: значения в узлах решётки, между ними сглаженная интерполяция.
// Нужен именно плавный — на белом шуме кромка площадки идёт пилой.
function gNoise(x, y, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = gHash(x0, y0, s), b = gHash(x0 + 1, y0, s);
  const c = gHash(x0, y0 + 1, s), d = gHash(x0 + 1, y0 + 1, s);
  const t1 = a + (b - a) * ux, t2 = c + (d - c) * ux;
  return t1 + (t2 - t1) * uy;
}
function gSeedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < (str || '').length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Опознание державы, с которым игрок идёт по галактике: цвет фракции на борту
// и герб на киле. Держим отдельным объектом, чтобы рендер каждого кадра не лез
// в EC и не ждал картинку: пока герб грузится, борт просто одноцветный.
const _fishFlag = { col: '#6f8bb5', img: null, fid: null };
function fishFlagLoad() {
  const hasEC = (typeof EC === 'object' && EC) ? EC : null;
  const app = hasEC && EC.app;
  const fac = (hasEC && typeof ecFacOf === 'function' && EC.fid) ? ecFacOf(EC.fid) : null;
  _fishFlag.col = (app && app.color) || (fac && fac.color) || '#6f8bb5';
  _fishFlag.fid = (hasEC && EC.fid) || null;
  const url = (app && (app.herald_url || app.image_url)) || (fac && fac.herald_url) || '';
  if (!url) { _fishFlag.img = null; return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';   // герб лежит в Storage: без этого канвас «пачкается»
  img.onerror = () => { if (_fishFlag.img === img) _fishFlag.img = null; };
  img.src = url;
  _fishFlag.img = img;
}

// ── Проекция ────────────────────────────────────────────────
const gIso = (tx, ty) => ({ x: (tx - ty) * GD_TW / 2, y: (tx + ty) * GD_TH / 2 });
const gUniso = (x, y) => ({ tx: (y / GD_TH + x / GD_TW), ty: (y / GD_TH - x / GD_TW) });

// ============================================================
// МИР. Никаких массивов тайлов: только список светил и аналитика.
// ============================================================
// Прежние версии держали поле 360×360 (130 тысяч ячеек) и решали по нему, где
// твердь. Здесь твердь есть ТОЛЬКО внутри площадки светила, а светил полсотни —
// значит вопрос «пустота ли тут» это полсотни расстояний, и никакой памяти.
// Заодно исчезает потолок на размер мира: разводить системы можно как угодно
// далеко, поле бы этого не пережило.
function GardenWorld(systems, sectors) {
  const secOf = {};                                   // system_id → индекс сектора
  (sectors || []).forEach((s, i) => (s.system_ids || []).forEach(id => { secOf[id] = i; }));

  let free = (sectors || []).length;
  const raw = systems.map(s => ({
    id: s.id, name: s.name, sys: s, giant: !!s.is_giant,
    sec: secOf[s.id] != null ? secOf[s.id] : (free++),
    rx: +s.x || 0, ry: +s.y || 0,
  }));

  // МАСШТАБ ЗАДАЁТ САМАЯ ТЕСНАЯ ПАРА. Растягиваем карту так, чтобы ближайшие
  // соседи разошлись на GD_SPACING: именно теснота исходных координат делала
  // из галактики двор, где до соседнего солнца десять шагов.
  let minD = 1e9;
  for (let i = 0; i < raw.length; i++)
    for (let j = i + 1; j < raw.length; j++) {
      const d = Math.hypot(raw[i].rx - raw[j].rx, raw[i].ry - raw[j].ry);
      if (d > .5 && d < minD) minD = d;
    }

  // ── РАЗМЕР СИСТЕМЫ БЕРЁТСЯ ИЗ ЕЁ СОСТАВА. Раньше площадка была одинаковой
  // болванкой со случайным разбросом, и система с восемью телами выглядела
  // ровно как система с одним. Теперь: у каждого тела свой радиус (по той же
  // группировке, что и схема системы в render.js), орбиты расходятся с зазором
  // пропорционально соседям, а габарит системы — это её внешняя орбита.
  const grpOf = p => (typeof ecPlanetGroup === 'function') ? ecPlanetGroup(p) : 'rock';
  const bodyR = (p, grp) => {
    const cells = +p.slotsP || 0;
    return grp === 'micro' ? .30
      : grp === 'belt' ? .42
      : grp === 'anomaly' ? .5
      : ['gasgiant', 'icegiant', 'hotgiant'].includes(grp) ? 1.15
      : .48 + Math.min(.34, cells * .02);
  };

  const nodes = raw.map(n => {
    const seed = gSeedOf(n.id || '') % 997;
    const list = ((n.sys && n.sys.planets) || []).filter(p => p && p.name);
    // Светило: гигант заметно крупнее, плюс лёгкая надбавка за населённость —
    // богатая система должна и выглядеть весомее.
    const starR = (n.giant ? 6.2 : 3.6) + Math.min(1.2, list.length * .1);

    const bodies = [];
    let orb = starR * 1.55, prev = 0;
    list.forEach((p, i) => {
      const grp = grpOf(p), r = bodyR(p, grp);
      orb += prev + r + .85 + gHash(seed, i, 71) * .5;    // зазор ∝ соседям
      prev = r;
      bodies.push({
        name: p.name, grp, r, orb,
        a0: gHash(seed + i, i * 7, 73) * Math.PI * 2,
        sp: .045 / Math.sqrt(orb),                        // дальние идут медленнее
        belt: grp === 'belt',
      });
    });
    const extent = bodies.length ? bodies[bodies.length - 1].orb + bodies[bodies.length - 1].r
                                 : starR * 2.2;
    return {
      id: n.id, name: n.name, sys: n.sys, sec: n.sec, giant: n.giant,
      tx: n.rx, ty: n.ry,                                 // масштаб применим ниже
      starR, bodies, seed,
      R: Math.max(extent * 1.16, starR * 2.6),            // площадка охватывает систему
    };
  });

  // МАСШТАБ КАРТЫ. Мало развести соседей на GD_SPACING: система с десятком тел
  // сама по себе широкая, и на тесной карте площадки налезали бы друг на друга.
  // Поэтому берём максимум из двух требований — минимальный воздух между
  // соседями и непересечение самих систем.
  let need = minD < 1e8 ? GD_SPACING / minD : 1;
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].tx - nodes[j].tx, nodes[i].ty - nodes[j].ty);
      if (d > .5) need = Math.max(need, (nodes[i].R + nodes[j].R) * 1.9 / d);
    }
  nodes.forEach(n => { n.tx *= need; n.ty *= need; });

  // Границы мира — по светилам с запасом: за них корабль просто не пускаем.
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  nodes.forEach(n => {
    x0 = Math.min(x0, n.tx); x1 = Math.max(x1, n.tx);
    y0 = Math.min(y0, n.ty); y1 = Math.max(y1, n.ty);
  });
  const pad = GD_SPACING;
  const bounds = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  const N = Math.max(x1 - x0, y1 - y0) + pad * 2;      // для миникарты и клампов

  // Радиус площадки в данном направлении: кромка рваная, но плавная.
  function platR(n, ang) {
    return n.R * (1
      + Math.sin(ang * 3 + n.seed) * .13
      + Math.sin(ang * 5 - n.seed * .7) * .07
      + (gNoise(Math.cos(ang) * 2.5 + n.seed, Math.sin(ang) * 2.5, 61) - .5) * .5);
  }

  // Ближайшее светило и расстояние до него. Основа всего: и «пустота ли тут»,
  // и «на чьей я площадке».
  function nearNode(tx, ty) {
    let best = null, bd = 1e9;
    for (let i = 0; i < nodes.length; i++) {
      const d = Math.hypot(tx - nodes[i].tx, ty - nodes[i].ty);
      if (d < bd) { bd = d; best = nodes[i]; }
    }
    return best ? { n: best, d: bd } : null;
  }

  function isVoid(tx, ty) {
    const nn = nearNode(tx, ty);
    if (!nn) return true;
    if (nn.d > nn.n.R * 1.6) return true;               // заведомо мимо
    return nn.d > platR(nn.n, Math.atan2(ty - nn.n.ty, tx - nn.n.tx));
  }

  const armAt = (tx, ty) => {
    const nn = nearNode(tx, ty);
    return GD_ARMS[((nn ? nn.n.sec : 0) % GD_ARMS.length + GD_ARMS.length) % GD_ARMS.length];
  };

  // ── Ячейки. Раскладываются КОЛЬЦАМИ по площадке чисто арифметически.
  // Раньше номер ячейки означал «N-й непустой тайл обхода», и стоило рельефу
  // измениться, как все плантации переезжали. Теперь номер — это угол и радиус,
  // и он не зависит ни от чего, кроме самого номера.
  const cellCache = {};
  function cells(nodeId, cap) {
    const key = nodeId + '#' + cap;
    if (cellCache[key]) return cellCache[key];
    const n = nodes.find(v => v.id === nodeId);
    const out = [];
    if (n) {
      let ring = 0;
      while (out.length < cap) {
        const cnt = 6 + ring * 4, rr = n.R * (.32 + ring * .21);
        for (let j = 0; j < cnt && out.length < cap; j++) {
          const a = (j / cnt) * Math.PI * 2 + ring * .41 + n.seed * .01;
          out.push({ tx: n.tx + Math.cos(a) * rr, ty: n.ty + Math.sin(a) * rr });
        }
        ring++;
        if (ring > 8) break;
      }
    }
    return (cellCache[key] = out);
  }

  return { N, nodes, bounds, isVoid, armAt, nearNode, platR, cells,
           nodeOf: id => nodes.find(n => n.id === id) };
}

// ============================================================
// СОСТОЯНИЕ ЭКРАНА
// ============================================================
let _gd = null;           // живая петля
let _gdWorld = null;      // геометрия (кэш на сессию)
let _gdState = null;      // ответ garden_get()
let _gdFit = null;

const _gdPlotKey = (sys, cell) => sys + '#' + cell;
function _gdPlots() {
  const m = {};
  ((_gdState && _gdState.plots) || []).forEach(p => { m[_gdPlotKey(p.sys, p.cell)] = p; });
  return m;
}
function _gdLand(sys) {
  return ((_gdState && _gdState.lands) || []).find(l => l.sys === sys) || null;
}

// ============================================================
// ПЕТЛЯ: полёт, камера, рисование
// ============================================================
function gardenStart(cv, world, spawn) {
  let ctx = cv.getContext('2d');
  let vw = 960, vh = 540, px = 1;
  // ang — куда смотрит нос В ЭКРАННЫХ координатах: изометрия ломает «влево»,
  // а глаз сверяет нос со следом, который тоже рисуется на экране.
  const P = { tx: spawn.tx, ty: spawn.ty, ang: -Math.PI / 2, thr: 0, bob: 0, hyper: false, boost: false };
  // z — отъезд камеры. В гипере отъезжаем: иначе расстояние между системами
  // остаётся числом в углу, а не тем, что видно глазами.
  const cam = { x: 0, y: 0, z: 1.4 };
  const keys = {};
  let stop = false, last = performance.now();
  const pad = { x: 0, y: 0 };
  const wake = [];

  // ── ввод ──
  // Клавишу опознаём по e.code (физическая клавиша), а НЕ по e.key: на русской
  // раскладке e.key для WASD — «ц/ф/ы/в», и управление немеет.
  const kd = e => {
    if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return;
    if (e.repeat) return;
    keys[e.code] = 1;
    if (e.code === 'Escape') { gardenPaintOverview(); return; }
    if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); gardenAct(); }
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(e.code)) e.preventDefault();
  };
  const ku = e => { keys[e.code] = 0; };
  const kblur = () => { for (const k in keys) keys[k] = 0; };
  addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('blur', kblur);

  // Экран → мир с учётом отъезда камеры.
  const scr2world = (cx, cy) => {
    const sx = (cx - vw / 2) / cam.z + cam.x, sy = (cy - vh / 2) / cam.z + cam.y;
    return gUniso(sx, sy);
  };
  let goal = null, stall = 0, lastX = P.tx, lastY = P.ty;
  const onDown = e => {
    const r = cv.getBoundingClientRect();
    goal = scr2world((e.clientX - r.left) / r.width * vw, (e.clientY - r.top) / r.height * vh);
  };
  cv.addEventListener('pointerdown', onDown);

  function moveVec() {
    let dx = 0, dy = 0;
    if (keys['KeyA'] || keys['ArrowLeft'])  { dx -= 1; dy += 1; }
    if (keys['KeyD'] || keys['ArrowRight']) { dx += 1; dy -= 1; }
    if (keys['KeyW'] || keys['ArrowUp'])    { dx -= 1; dy -= 1; }
    if (keys['KeyS'] || keys['ArrowDown'])  { dx += 1; dy += 1; }
    if (pad.x || pad.y) { dx += pad.x + pad.y; dy += pad.y - pad.x; }
    if (!dx && !dy && goal) {
      const gx = goal.tx - P.tx, gy = goal.ty - P.ty;
      if (Math.hypot(gx, gy) < .6) goal = null; else { dx = gx; dy = gy; }
    }
    const m = Math.hypot(dx, dy);
    return m > 0 ? { x: dx / m, y: dy / m } : { x: 0, y: 0 };
  }

  function step(dt, t) {
    const v = moveVec();
    // Обычным ходом — только по площадке, пустоту проходят гипером, и наоборот.
    // Ровно та развилка, что была у лодки с водой: она и делает пустоту
    // расстоянием, а не просто фоном.
    const ok = (x, y) => world.isVoid(x, y) === P.hyper;
    // Разгон на Shift. Крейсерская через полгалактики — это минуты пустого
    // зажатого W: расстояние должно ощущаться, но не наказывать.
    P.boost = P.hyper && !!(keys['ShiftLeft'] || keys['ShiftRight']);
    const sp = (P.hyper ? GD_SPEED * (P.boost ? 34 : 11) : GD_SPEED) * dt;
    const nx = P.tx + v.x * sp, ny = P.ty + v.y * sp;
    const B = world.bounds;
    if (ok(nx, P.ty)) P.tx = gClamp(nx, B.x0, B.x1);
    if (ok(P.tx, ny)) P.ty = gClamp(ny, B.y0, B.y1);
    if (goal) {
      stall = (Math.abs(P.tx - lastX) + Math.abs(P.ty - lastY) < dt * .5) ? stall + dt : 0;
      if (stall > .4) { goal = null; stall = 0; }
    }
    lastX = P.tx; lastY = P.ty;

    const moving = !!(v.x || v.y);
    P.thr += ((moving ? 1 : 0) - P.thr) * Math.min(1, dt * 6);
    if (moving) {
      const sx = (v.x - v.y) * GD_TW / 2, sy = (v.x + v.y) * GD_TH / 2;
      const want = Math.atan2(sy, sx);
      let d = want - P.ang;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      P.ang += d * Math.min(1, dt * 9);
      if (!P.hyper && (wake.length === 0 || Math.hypot(P.tx - wake[0].tx, P.ty - wake[0].ty) > .5))
        wake.unshift({ tx: P.tx, ty: P.ty, born: t });
      if (wake.length > 22) wake.length = 22;
    }
    P.bob = Math.sin(t * 2.2) * 1.1;

    const s = gIso(P.tx, P.ty);
    cam.x += (s.x - cam.x) * Math.min(1, dt * 8);
    cam.y += (s.y - cam.y) * Math.min(1, dt * 8);
    // Камера держится близко к кораблю; отъезд остаётся только как признак
    // скорости — сильнее всего на разгоне. Плавно: рывок масштаба читается
    // как глюк, а не как ускорение.
    const wantZ = P.boost ? .62 : P.hyper ? .95 : 1.4;
    cam.z += (wantZ - cam.z) * Math.min(1, dt * 2.2);
  }

  // ══════════════════════════════════════════════════════════
  // ЗАДНИК
  // ══════════════════════════════════════════════════════════
  const SKY_W = 1200, SKY_H = 800;
  const skyLayers = [[.05, 170, 1.0, .30], [.12, 100, 1.4, .48], [.22, 52, 1.9, .70]]
    .map(([par, cnt, sz, al], li) => {
      const pts = [];
      for (let i = 0; i < cnt; i++) {
        const h1 = gHash(i * 97, li * 89, 5 + li), h2 = gHash(i * 31, li * 57, 11 + li);
        pts.push({ x: h1 * SKY_W, y: h2 * SKY_H, tw: h1 > .93 ? h2 * 9 : -1 });
      }
      return { par, sz, al, pts };
    });

  function drawSky(t) {
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, vw, vh);
    for (let li = 0; li < skyLayers.length; li++) {
      const L = skyLayers[li];
      const ox = cam.x * L.par, oy = cam.y * L.par;
      const sx = -(((ox % SKY_W) + SKY_W) % SKY_W), sy = -(((oy % SKY_H) + SKY_H) % SKY_H);
      ctx.fillStyle = `rgba(200,220,240,${L.al})`;
      for (let bx = sx; bx < vw; bx += SKY_W)
        for (let by = sy; by < vh; by += SKY_H)
          for (let i = 0; i < L.pts.length; i++) {
            const p = L.pts[i], x = bx + p.x, y = by + p.y;
            if (x < 0 || y < 0 || x > vw || y > vh) continue;
            if (p.tw >= 0) {
              ctx.fillStyle = `rgba(200,220,240,${L.al * (.6 + Math.sin(t * 2 + p.tw) * .4)})`;
              ctx.fillRect(x, y, L.sz, L.sz);
              ctx.fillStyle = `rgba(200,220,240,${L.al})`;
            } else ctx.fillRect(x, y, L.sz, L.sz);
          }
    }
  }

  const nebA = gGlowSprite('70,105,175', .13), nebB = gGlowSprite('120,80,165', .11);
  const NEB_W = 1400, NEB_H = 950;
  const nebs = [];
  for (let i = 0; i < 6; i++) {
    const h1 = gHash(i * 17, 3, 81), h2 = gHash(i * 29, 7, 83), h3 = gHash(i * 11, 5, 87);
    nebs.push({ x: h1 * NEB_W, y: h2 * NEB_H, r: 300 + h3 * 380, s: h3 > .5 ? nebA : nebB });
  }
  function drawNebula() {
    const ox = cam.x * .3, oy = cam.y * .3;
    const sx = -(((ox % NEB_W) + NEB_W) % NEB_W), sy = -(((oy % NEB_H) + NEB_H) % NEB_H);
    for (let bx = sx; bx < vw; bx += NEB_W)
      for (let by = sy; by < vh; by += NEB_H)
        for (let i = 0; i < nebs.length; i++) {
          const n = nebs[i], x = bx + n.x, y = by + n.y;
          if (x + n.r < 0 || y + n.r < 0 || x - n.r > vw || y - n.r > vh) continue;
          ctx.drawImage(n.s, x - n.r, y - n.r, n.r * 2, n.r * 2);
        }
  }

  const starGlow = gGlowSprite('255,214,150', .5);
  const poolGlow = gGlowSprite('255,206,140', .12);
  const domeGlow = gGlowSprite('143,211,255', .30);
  const ichorGlow = gGlowSprite('190,160,255', .30);

  // ══════════════════════════════════════════════════════════
  // ПЛОЩАДКА. Запекается в свой буфер один раз на систему.
  // ══════════════════════════════════════════════════════════
  // Рисовать её каждый кадр незачем: она не меняется. Кэш небольшой и с
  // вытеснением дальних — иначе полсотни буферов по мегабайту съедят память.
  const plats = new Map();
  function platSprite(n) {
    let s = plats.get(n.id);
    if (s) { s.hit = performance.now(); return s; }
    const a = GD_ARMS[((n.sec % GD_ARMS.length) + GD_ARMS.length) % GD_ARMS.length];
    const RX = n.R * 1.35 * GD_TW / 2, RY = n.R * 1.35 * GD_TH / 2;
    const w = Math.ceil(RX * 2 + 40), h = Math.ceil(RY * 2 + 40 + GD_LIFT);
    const cx = w / 2, cy = h / 2 - GD_LIFT / 2;

    const cv2 = document.createElement('canvas');
    cv2.width = w; cv2.height = h;
    const g = cv2.getContext('2d');

    // Контур площадки: сто точек по кругу с рваным радиусом. Ромбов нет —
    // именно они назначали масштаб и делали из галактики огород.
    const STEP = 100, pts = [];
    for (let i = 0; i < STEP; i++) {
      const ang = i / STEP * Math.PI * 2;
      const r = world.platR(n, ang);
      pts.push({ x: cx + Math.cos(ang) * r * GD_TW / 2, y: cy + Math.sin(ang) * r * GD_TH / 2 });
    }
    const path = () => {
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < STEP; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
    };

    g.fillStyle = gShade(a.d, .7);                     // скол: площадка имеет толщину
    g.save(); g.translate(0, GD_LIFT); path(); g.fill(); g.restore();

    path(); g.fillStyle = gShade(a.p, 1); g.fill();

    // Разметка: концентрические дуги и редкие радиусы — обжитое место, а не пол.
    g.save(); path(); g.clip();
    g.strokeStyle = 'rgba(143,211,255,.055)'; g.lineWidth = 1;
    for (let r = .22; r < 1.2; r += .16) {
      g.beginPath();
      g.ellipse(cx, cy, n.R * r * GD_TW / 2, n.R * r * GD_TH / 2, 0, 0, 7);
      g.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const ang = i / 12 * Math.PI * 2 + n.seed * .01;
      g.beginPath(); g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(ang) * n.R * 1.3 * GD_TW / 2, cy + Math.sin(ang) * n.R * 1.3 * GD_TH / 2);
      g.stroke();
    }
    // Обломки: лежат в плоскости площадки, ничего стоячего.
    for (let i = 0; i < 26; i++) {
      const h1 = gHash(n.seed + i, i * 7, 21), h2 = gHash(i * 13, n.seed + i, 33);
      const ang = h1 * Math.PI * 2, rr = (.25 + h2 * .95) * n.R;
      const x = cx + Math.cos(ang) * rr * GD_TW / 2, y = cy + Math.sin(ang) * rr * GD_TH / 2;
      const L = 7 + h2 * 16;
      g.fillStyle = gShade(a.d, 1.5);
      g.beginPath();
      g.moveTo(x - L, y); g.lineTo(x - L * .3, y - 3 - h1 * 2);
      g.lineTo(x + L, y - h1); g.lineTo(x + L * .4, y + 2.5); g.closePath(); g.fill();
      g.strokeStyle = a.x + '33'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x - L * .3, y - 3 - h1 * 2); g.lineTo(x + L, y - h1); g.stroke();
    }
    g.restore();

    path();                                            // кромка: единственная яркая линия
    g.strokeStyle = 'rgba(143,211,255,.5)'; g.lineWidth = 1.5; g.stroke();
    g.strokeStyle = 'rgba(143,211,255,.12)'; g.lineWidth = 5; g.stroke();

    s = { cv: cv2, cx, cy, hit: performance.now() };
    plats.set(n.id, s);
    if (plats.size > 14) {                             // вытесняем самый давний
      let oldK = null, oldT = Infinity;
      plats.forEach((v, kk) => { if (v.hit < oldT) { oldT = v.hit; oldK = kk; } });
      if (oldK) plats.delete(oldK);
    }
    return s;
  }

  // ══════════════════════════════════════════════════════════
  // СВЕТИЛО
  // ══════════════════════════════════════════════════════════
  // Цвет тела по группе — тот же язык, что и на схеме системы: гиганты
  // холодные и крупные, пояс — крошево, аномалия — фиолетовая.
  const GD_BODY = {
    gasgiant: '#b9a37e', icegiant: '#8fc2d8', hotgiant: '#d89a6a',
    belt: '#8a8f96', micro: '#9aa3ad', anomaly: '#a892d6', rock: '#a8a196',
  };

  function drawSystem(n, t, x, y) {
    // ⚠️ ВСЁ В МИРОВЫХ ЕДИНИЦАХ, а не в «красивых пикселях». Звезда, орбиты и
    // тела лежат в одной плоскости эклиптики и меряются той же линейкой, что и
    // расстояние до соседней системы — поэтому размер системы наконец говорит
    // правду о её составе: восемь тел и вправду шире, чем одно.
    const U = GD_TW / 2;                                 // мировая единица в пикселях
    const R = n.starR * U;

    ctx.drawImage(poolGlow, x - n.R * U * 1.2, y - n.R * U * .6,
                  n.R * U * 2.4, n.R * U * 1.2);

    // Орбиты — эллипсы, сплюснутые как вся плоскость (2:1).
    n.bodies.forEach(b => {
      const rx = b.orb * U, ry = b.orb * GD_TH / 2;
      if (b.belt) {                                      // пояс: крошево, а не линия
        ctx.fillStyle = 'rgba(160,175,190,.34)';
        for (let i = 0; i < 90; i++) {
          const a = i / 90 * Math.PI * 2 + n.seed;
          const j = (gHash(n.seed + i, i, 77) - .5) * b.r * U * 1.6;
          ctx.fillRect(x + Math.cos(a) * (rx + j), y + Math.sin(a) * (ry + j * .5), 1.4, 1.4);
        }
        return;
      }
      ctx.strokeStyle = 'rgba(143,211,255,.13)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.stroke();
    });

    const gw = R * 3.1;
    ctx.drawImage(starGlow, x - gw, y - gw, gw * 2, gw * 2);

    // Корона: неровный край, чуть дышит. Ровный круг читается наклейкой.
    ctx.fillStyle = 'rgba(255,228,175,.20)';
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = i / 48 * Math.PI * 2;
      const rr = R * (1.10 + Math.sin(a * 5 + n.seed + t * .4) * .045 + Math.sin(a * 9 - t * .3) * .03);
      const px2 = x + Math.cos(a) * rr, py2 = y + Math.sin(a) * rr;
      i ? ctx.lineTo(px2, py2) : ctx.moveTo(px2, py2);
    }
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = '#fff4dc';
    ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill();
    // Потемнение к краю диска — КОЛЬЦОМ ЧЕРЕЗ ОБВОДКУ. Через два arc() в одном
    // пути нельзя: между подпутями холст дорисовывает соединительную линию, и
    // в диске вырезается клин.
    ctx.strokeStyle = 'rgba(255,186,104,.26)';
    ctx.lineWidth = R * .3;
    ctx.beginPath(); ctx.arc(x, y, R * .85, 0, 7); ctx.stroke();

    // Тела на своих орбитах. Дальние идут медленнее — иначе система читается
    // каруселью, а не системой.
    n.bodies.forEach(b => {
      if (b.belt) return;
      const a = b.a0 + t * b.sp;
      const bx = x + Math.cos(a) * b.orb * U, by = y + Math.sin(a) * b.orb * GD_TH / 2;
      const br = b.r * U;
      ctx.fillStyle = GD_BODY[b.grp] || GD_BODY.rock;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.fill();
      // Терминатор: половина, отвёрнутая от светила, в тени.
      ctx.fillStyle = 'rgba(0,0,0,.42)';
      ctx.beginPath(); ctx.arc(bx, by, br, a - Math.PI / 2, a + Math.PI / 2); ctx.fill();
      if (b.grp === 'gasgiant' || b.grp === 'icegiant') {   // кольцо у гиганта
        ctx.strokeStyle = 'rgba(200,215,230,.28)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.ellipse(bx, by, br * 1.9, br * .6, .3, 0, 7); ctx.stroke();
      }
    });

    ctx.fillStyle = 'rgba(215,235,252,.9)';
    ctx.font = '13px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.textAlign = 'center';
    ctx.fillText((n.name || '').toUpperCase(), x, y - n.R * GD_TH / 2 - 14);
    ctx.textAlign = 'left';
  }

  // ══════════════════════════════════════════════════════════
  // ЯЧЕЙКА С КУЛЬТУРОЙ
  // ══════════════════════════════════════════════════════════
  function drawPlot(p, t, x, y, mine) {
    const col = mine ? 'rgba(143,211,255,' : 'rgba(140,160,180,';
    ctx.strokeStyle = col + (mine ? '.42)' : '.20)'); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(x, y, 20, 10, 0, 0, 7); ctx.stroke();
    ctx.strokeStyle = col + '.14)';
    ctx.beginPath(); ctx.ellipse(x, y, 11, 5.5, 0, 0, 7); ctx.stroke();

    const pl = p.plant;
    if (!pl) return;

    const grow = pl.ripe ? 1 : gClamp(1 - pl.left / (pl.kind === 'ichor' ? 72 * 3600 : 24 * 3600), .08, 1);
    const care = pl.care == null ? 1 : pl.care;
    const h = (pl.kind === 'ichor' ? 46 : 24) * grow;
    const cc = pl.kind === 'ichor'
      ? (care > .6 ? '#c9a6ff' : '#6d6485')
      : (care > .65 ? '#8fd3ff' : care > .35 ? '#9fb0a0' : '#8a7f6a');
    const lean = (1 - care) * 6;

    const dr = h * .9 + 8;
    ctx.globalAlpha = .35 + care * .45;
    ctx.drawImage(pl.kind === 'ichor' ? ichorGlow : domeGlow, x - dr, y - h * .5 - dr, dr * 2, dr * 2);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = cc; ctx.lineWidth = pl.kind === 'ichor' ? 2.6 : 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.quadraticCurveTo(x + lean * .4, y - h * .6, x + lean, y - h);
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x + lean * .5, y - h * .55); ctx.lineTo(x - 8 * grow, y - h * .80);
    ctx.moveTo(x + lean * .7, y - h * .72); ctx.lineTo(x + 8 * grow, y - h * .96);
    ctx.stroke();
    ctx.lineCap = 'butt';

    if (pl.kind === 'ichor') {
      const pu = .8 + Math.sin(t * 1.6) * .2;
      ctx.fillStyle = care > .6 ? `rgba(201,166,255,${.30 * pu})` : 'rgba(120,110,150,.22)';
      ctx.beginPath(); ctx.arc(x + lean, y - h, 12 * grow * pu, 0, 7); ctx.fill();
    }
    if (pl.weeds > 55) {
      ctx.strokeStyle = 'rgba(150,160,110,.65)'; ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(x + i * 5, y + 2); ctx.lineTo(x + i * 5 + 2, y - 7); ctx.stroke();
      }
    }
    if (pl.water < 20) {
      ctx.fillStyle = '#e0a34a';
      ctx.beginPath(); ctx.arc(x + 13, y - h - 6, 2.6, 0, 7); ctx.fill();
    }
    if (pl.ripe) {
      ctx.fillStyle = GD_WARM;
      ctx.font = '12px ui-monospace,SFMono-Regular,Menlo,monospace'; ctx.textAlign = 'center';
      ctx.fillText('◆', x, y - h - 13); ctx.textAlign = 'left';
    }
  }

  // ══════════════════════════════════════════════════════════
  // КОРАБЛЬ
  // ══════════════════════════════════════════════════════════
  function drawShip(x, y, overPlat) {
    const col = (typeof _fishFlag !== 'undefined' && _fishFlag.col) || '#6f8bb5';
    const cy = y - 15 - P.bob;

    // Тень и луч подвеса — только над площадкой: по их пропаже сразу видно,
    // что ты вышел в пустоту.
    if (overPlat) {
      ctx.fillStyle = 'rgba(0,0,0,.42)';
      ctx.beginPath(); ctx.ellipse(x, y, 13, 5.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(143,211,255,.07)';
      ctx.beginPath(); ctx.moveTo(x - 5, cy); ctx.lineTo(x + 5, cy);
      ctx.lineTo(x + 11, y); ctx.lineTo(x - 11, y); ctx.closePath(); ctx.fill();
    }

    ctx.save();
    ctx.translate(x, cy);
    ctx.rotate(P.ang);
    ctx.scale(1.75, 1.05);

    const fl = P.thr * (10 + Math.random() * 5) * (P.hyper ? 2.2 : 1);
    if (fl > 1) {
      const fg = ctx.createLinearGradient(-6, 0, -6 - fl, 0);
      fg.addColorStop(0, 'rgba(143,211,255,.75)'); fg.addColorStop(1, 'rgba(143,211,255,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(-6, -3.2); ctx.lineTo(-6 - fl, 0); ctx.lineTo(-6, 3.2); ctx.closePath(); ctx.fill();
    }

    ctx.fillStyle = '#1b232d';
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-2, -8); ctx.lineTo(-7, -3);
    ctx.lineTo(-7, 3); ctx.lineTo(-2, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2b3644';
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-2, -8); ctx.lineTo(-3, -2); ctx.lineTo(9, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-4, -5.4); ctx.stroke();
    ctx.strokeStyle = gShade(col, .6); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-4, 5.4); ctx.stroke();
    ctx.fillStyle = 'rgba(143,211,255,.22)';
    ctx.beginPath(); ctx.ellipse(5, 0, 6, 4.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#dff0ff';
    ctx.beginPath(); ctx.ellipse(5, 0, 2.6, 2, 0, 0, 7); ctx.fill();
    ctx.restore();

    const img = _fishFlag.img;
    if (img && img.complete && img.naturalWidth) {
      ctx.globalAlpha = .9;
      try { ctx.drawImage(img, x - 6, cy - 18, 12, 12); } catch (e) { _fishFlag.img = null; }
      ctx.globalAlpha = 1;
    }
  }

  function drawWake(t) {
    for (let i = 0; i < wake.length; i++) {
      const w = wake[i], age = t - w.born;
      if (age > 1.2) { wake.length = i; break; }
      const s = gIso(w.tx, w.ty);
      const a = (1 - age / 1.2) * .40;
      ctx.fillStyle = `rgba(143,211,255,${a})`;
      ctx.beginPath(); ctx.arc(s.x, s.y - 15, 2.4 * (1 - age / 1.2) + .6, 0, 7); ctx.fill();
    }
  }

  // Гипер: нити света по КРАЯМ кадра. Мир при этом виден и только приглушён —
  // маневрировать надо МЕЖДУ системами, а если прятать их, то не между чем.
  function drawHyper(t) {
    const cx = vw / 2, cy = vh / 2;
    const R0 = Math.min(vw, vh) * .40;
    for (let i = 0; i < 34; i++) {
      const h = gHash(i * 13, 7, 91), h2 = gHash(i * 29, 11, 93);
      const a = h * Math.PI * 2;
      const ph = ((t * (.9 + h2) + h) % 1) ** .55;
      const r0 = R0 + ph * Math.max(vw, vh) * .55;
      const len = 20 + ph * 90;
      ctx.globalAlpha = Math.min(1, ph * 2.5) * (1 - ph) * (P.boost ? 1 : .55);
      ctx.strokeStyle = 'rgba(170,210,245,.75)';
      ctx.lineWidth = .8 + h2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * .62);
      ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len) * .62);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ══════════════════════════════════════════════════════════
  // ПРИБОРЫ. Рисуются БЕЗ отъезда камеры, поэтому в отдельной системе координат.
  // ══════════════════════════════════════════════════════════
  const MM = 148;
  const mmCv = document.createElement('canvas');
  mmCv.width = mmCv.height = MM;
  (function bakeMinimap() {
    const g = mmCv.getContext('2d');
    const B = world.bounds, W = B.x1 - B.x0, H = B.y1 - B.y0;
    world.nodes.forEach(n => {
      const x = (n.tx - B.x0) / W * MM, y = (n.ty - B.y0) / H * MM;
      const a = GD_ARMS[((n.sec % GD_ARMS.length) + GD_ARMS.length) % GD_ARMS.length];
      g.fillStyle = a.x + '66';
      g.beginPath(); g.arc(x, y, n.giant ? 2.6 : 1.9, 0, 7); g.fill();
    });
  })();

  function drawMinimap() {
    const S = 132, x0 = vw - S - 14, y0 = vh - S - 14;
    const B = world.bounds, W = B.x1 - B.x0, H = B.y1 - B.y0;
    ctx.fillStyle = 'rgba(6,10,16,.78)';
    ctx.fillRect(x0, y0, S, S);
    ctx.drawImage(mmCv, x0, y0, S, S);
    ctx.strokeStyle = 'rgba(143,211,255,.30)'; ctx.lineWidth = 1;
    ctx.strokeRect(x0 + .5, y0 + .5, S - 1, S - 1);

    ((_gdState && _gdState.lands) || []).forEach(l => {
      const n = world.nodeOf(l.sys); if (!n) return;
      ctx.fillStyle = l.land === 'own' ? GD_EDGE : GD_WARM;
      ctx.beginPath();
      ctx.arc(x0 + (n.tx - B.x0) / W * S, y0 + (n.ty - B.y0) / H * S, 2.6, 0, 7); ctx.fill();
    });
    ctx.save();
    ctx.translate(x0 + (P.tx - B.x0) / W * S, y0 + (P.ty - B.y0) / H * S);
    ctx.rotate(P.ang);
    ctx.fillStyle = '#dff0ff';
    ctx.beginPath(); ctx.moveTo(4.5, 0); ctx.lineTo(-3, -2.6); ctx.lineTo(-3, 2.6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Компас: куда лететь к своим системам. В мире, где между звёздами пусто,
  // без него просто теряешься.
  function drawCompass() {
    const lands = (_gdState && _gdState.lands) || [];
    if (!lands.length) return;
    const m = 26, taken = [];
    lands.slice().sort((a, b) => {
      const na = world.nodeOf(a.sys), nb = world.nodeOf(b.sys);
      if (!na || !nb) return 0;
      return Math.hypot(na.tx - P.tx, na.ty - P.ty) - Math.hypot(nb.tx - P.tx, nb.ty - P.ty);
    }).forEach(l => {
      const n = world.nodeOf(l.sys); if (!n) return;
      const s = gIso(n.tx, n.ty);
      const x = (s.x - cam.x) * cam.z + vw / 2, y = (s.y - cam.y) * cam.z + vh / 2;
      if (x > m && x < vw - m && y > m && y < vh - m) return;
      const cx = vw / 2, cy = vh / 2;
      const ang = Math.atan2(y - cy, x - cx);
      const k = Math.min(Math.abs((vw / 2 - m) / Math.cos(ang)), Math.abs((vh / 2 - m) / Math.sin(ang)));
      const mx = cx + Math.cos(ang) * k, my = cy + Math.sin(ang) * k;
      const dist = Math.round(Math.hypot(n.tx - P.tx, n.ty - P.ty));
      const own = l.land === 'own';

      ctx.save();
      ctx.translate(mx, my); ctx.rotate(ang);
      ctx.fillStyle = own ? 'rgba(143,211,255,.85)' : 'rgba(255,196,107,.85)';
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -4.5); ctx.lineTo(-5, 4.5); ctx.closePath(); ctx.fill();
      ctx.restore();

      const lx = gClamp(mx, 54, vw - 54), ly = gClamp(my + 16, 16, vh - 6);
      if (taken.some(p => Math.abs(p.x - lx) < 96 && Math.abs(p.y - ly) < 13)) return;
      taken.push({ x: lx, y: ly });
      ctx.fillStyle = 'rgba(180,205,228,.75)';
      ctx.font = '9.5px ui-monospace,SFMono-Regular,Menlo,monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${(l.name || '').slice(0, 14).toUpperCase()} ${dist}`, lx, ly);
      ctx.textAlign = 'left';
    });
  }

  // ══════════════════════════════════════════════════════════
  // КАДР
  // ══════════════════════════════════════════════════════════
  function frame(now) {
    if (stop) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const t = now / 1000;
    step(dt, t);

    // Задник и приборы живут в экранных координатах, мир — в мировых с отъездом.
    ctx.setTransform(px, 0, 0, px, 0, 0);
    drawSky(t);
    drawNebula();

    // Мир: сдвиг камеры и масштаб зашиты в трансформ, поэтому рисование ниже
    // оперирует мировыми координатами и не тащит поправку в каждую строчку.
    ctx.setTransform(px * cam.z, 0, 0, px * cam.z,
                     px * (vw / 2 - cam.x * cam.z), px * (vh / 2 - cam.y * cam.z));

    // Что попало в кадр: обратная проекция углов с учётом масштаба.
    const hw = vw / 2 / cam.z, hh = vh / 2 / cam.z;
    const corners = [gUniso(cam.x - hw, cam.y - hh), gUniso(cam.x + hw, cam.y - hh),
                     gUniso(cam.x - hw, cam.y + hh), gUniso(cam.x + hw, cam.y + hh)];
    const vx0 = Math.min(...corners.map(c => c.tx)), vx1 = Math.max(...corners.map(c => c.tx));
    const vy0 = Math.min(...corners.map(c => c.ty)), vy1 = Math.max(...corners.map(c => c.ty));

    const vis = world.nodes.filter(n =>
      n.tx > vx0 - n.R * 3 && n.tx < vx1 + n.R * 3 &&
      n.ty > vy0 - n.R * 3 && n.ty < vy1 + n.R * 3);

    // Слой 1: площадки (дальние — раньше).
    vis.slice().sort((a, b) => (a.tx + a.ty) - (b.tx + b.ty)).forEach(n => {
      const s = platSprite(n), c = gIso(n.tx, n.ty);
      ctx.drawImage(s.cv, c.x - s.cx, c.y - s.cy);
    });

    // Слой 2: плантации.
    const plots = _gdPlots();
    if (!P.hyper) vis.forEach(n => {
      const l = _gdLand(n.id);
      const mineCells = l ? world.cells(n.id, l.cells) : null;
      if (mineCells) mineCells.forEach((cc, i) => {
        const s = gIso(cc.tx, cc.ty);
        drawPlot(plots[_gdPlotKey(n.id, i)] || {}, t, s.x, s.y - GD_LIFT, true);
      });
      else ((_gdState && _gdState.plots) || []).forEach(p => {
        if (p.sys !== n.id) return;
        const cc = world.cells(n.id, p.cell + 1)[p.cell]; if (!cc) return;
        const s = gIso(cc.tx, cc.ty);
        drawPlot(p, t, s.x, s.y - GD_LIFT, false);
      });
    });

    // Слой 3: светила. Идут поверх площадок — они висят НАД плоскостью.
    vis.forEach(n => {
      const c = gIso(n.tx, n.ty);
      drawStar(n, t, c.x, c.y - GD_LIFT);
    });

    // Слой 4: корабль.
    if (P.hyper) {
      ctx.setTransform(px, 0, 0, px, 0, 0);
      ctx.fillStyle = 'rgba(5,8,14,.5)'; ctx.fillRect(0, 0, vw, vh);
      ctx.setTransform(px * cam.z, 0, 0, px * cam.z,
                       px * (vw / 2 - cam.x * cam.z), px * (vh / 2 - cam.y * cam.z));
    }
    drawWake(t);
    const ps = gIso(P.tx, P.ty);
    drawShip(ps.x, ps.y - GD_LIFT, !world.isVoid(P.tx, P.ty));

    // Подсказка «что под манипулятором» — в мире, у самой цели.
    const near = gardenNear(world, P);
    if (near) {
      const s = gIso(near.tx, near.ty);
      ctx.strokeStyle = 'rgba(143,211,255,.85)'; ctx.lineWidth = 1.4 / cam.z;
      ctx.beginPath(); ctx.ellipse(s.x, s.y - GD_LIFT, 22, 11, 0, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(205,230,250,.95)';
      ctx.font = `${Math.round(11 / cam.z)}px ui-monospace,SFMono-Regular,Menlo,monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(near.hint.toUpperCase() + '  ·  E', s.x, s.y - GD_LIFT - 26 / cam.z);
      ctx.textAlign = 'left';
    }
    _gd && (_gd.near = near);

    // Приборы: обратно в экранные координаты.
    ctx.setTransform(px, 0, 0, px, 0, 0);
    if (P.hyper) drawHyper(t);
    drawCompass();
    drawMinimap();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    P, cam, near: null,
    padSet: (x, y) => { pad.x = x; pad.y = y; },
    onResize: (w, h, s) => { vw = w; vh = h; px = s; },
    stop: () => {
      stop = true;
      removeEventListener('keydown', kd); removeEventListener('keyup', ku);
      removeEventListener('blur', kblur);
      cv.removeEventListener('pointerdown', onDown);
    },
  };
}

// ── Что у корабля под манипулятором. В гипере — только выход и трал, как было
// у лодки; над площадкой — своя ячейка, а у кромки — прыжок. ──
function gardenNear(world, P) {
  let best = null, bd = GD_REACH * GD_REACH;

  if (P.hyper) {
    const nn = world.nearNode(P.tx, P.ty);
    if (nn && nn.d < nn.n.R * 1.5) {
      // Подходим к системе — предлагаем выйти в точке ближайшей кромки.
      const ang = Math.atan2(P.ty - nn.n.ty, P.tx - nn.n.tx);
      const r = world.platR(nn.n, ang) * .9;
      return { kind: 'land', tx: nn.n.tx + Math.cos(ang) * r, ty: nn.n.ty + Math.sin(ang) * r,
               hint: 'выйти из гипера' };
    }
    return { kind: 'fish', tx: P.tx, ty: P.ty, hint: 'зачерпнуть взвесь' };
  }

  const plots = _gdPlots();
  ((_gdState && _gdState.lands) || []).forEach(l => {
    world.cells(l.sys, l.cells).forEach((cc, i) => {
      const d = (cc.tx - P.tx) ** 2 + (cc.ty - P.ty) ** 2;
      if (d > bd) return;
      const p = plots[_gdPlotKey(l.sys, i)];
      let hint;
      if (!p) hint = 'развернуть ячейку';
      else if (!p.mine) hint = 'чужая плантация';
      else if (!p.plant) hint = 'засеять';
      else if (p.plant.ripe) hint = 'снять урожай';
      else hint = 'обслужить';
      bd = d; best = { kind: 'plot', tx: cc.tx, ty: cc.ty, sys: l.sys, cell: i, land: l, plot: p, hint };
    });
  });
  if (best) return best;

  // У кромки площадки — прыжок: дальше только гипером.
  const nn = world.nearNode(P.tx, P.ty);
  if (nn) {
    const ang = Math.atan2(P.ty - nn.n.ty, P.tx - nn.n.tx);
    const r = world.platR(nn.n, ang);
    if (nn.d > r - 3) {
      const rr = r + 2.5;
      return { kind: 'hyper', tx: nn.n.tx + Math.cos(ang) * rr, ty: nn.n.ty + Math.sin(ang) * rr,
               hint: 'уйти в гипер' };
    }
  }
  return null;
}

// ============================================================
// ДЕЙСТВИЕ ПО «E»
// ============================================================
function gardenAct() {
  const n = _gd && _gd.near;
  if (!n) return;
  if (n.kind === 'hyper') { _gd.P.hyper = true; _gd.P.tx = n.tx + .5; _gd.P.ty = n.ty + .5; return; }
  if (n.kind === 'land')  { _gd.P.hyper = false; _gd.P.tx = n.tx; _gd.P.ty = n.ty; return; }
  if (n.kind === 'fish')  { gardenFishOpen(); return; }
  if (n.plot && !n.plot.mine) { gardenToast('Чужая плантация. Смотреть можно, трогать — нет.'); return; }
  gardenPanel(n);
}

function gardenToast(m, k) {
  if (typeof toast === 'function') toast(m, k || '');
  else console.log(m);
}

async function gardenDo(fn, body, okMsg) {
  try {
    const r = await ecRpc(fn, body || {});
    if (okMsg) gardenToast(okMsg, 'ok');
    await gardenReload();
    return r;
  } catch (e) {
    gardenToast((e && e.message) || 'не вышло', 'err');
    return null;
  }
}

async function gardenReload() {
  try { _gdState = await ecRpc('garden_get', {}); } catch (e) {}
  gardenPaintHud();
  gardenPanelRefresh();
}

// ============================================================
// ПАНЕЛЬ ЯЧЕЙКИ
// ============================================================
// Имена RPC и полей на сервере остались садовыми (water/feed/weeds) — здесь
// это свет, раствор и налёт. Перекладываем ТОЛЬКО подписи: трогать сервер
// ради слов значило бы ломать применённую цепочку _garden.sql.
let _gdPanel = null;

function gardenPanelClose() {
  _gdPanel = null;
  const el = document.getElementById('gd-panel');
  if (el) el.remove();
}

function gardenPanel(n) {
  _gdPanel = { sys: n.sys, cell: n.cell };
  gardenPanelRefresh(true);
}

function gardenPanelRefresh(create) {
  if (!_gdPanel) return;
  let el = document.getElementById('gd-panel');
  if (!el) {
    if (!create) return;
    el = document.createElement('div');
    el.id = 'gd-panel'; el.className = 'gd-panel';
    (document.getElementById('gd-fs') || document.body).appendChild(el);
  }
  const land = _gdLand(_gdPanel.sys);
  const plot = _gdPlots()[_gdPlotKey(_gdPanel.sys, _gdPanel.cell)];
  const c = (_gdState && _gdState.const) || {};
  const nm = (land && land.name) || (_gdState && _gdState.temple === _gdPanel.sys ? 'Храм мироздания' : 'участок');
  const head = `<div class="gd-p-h"><b>${esc(nm)}</b><span>ячейка ${String(_gdPanel.cell + 1).padStart(2, '0')}</span>
    <button type="button" onclick="event.stopPropagation();gardenPanelClose()">✕</button></div>`;

  let body;
  if (!plot) {
    body = `<div class="gd-p-b">
      <div class="gd-p-lead">Шельф пустой. Развернуть стапель — ${Math.round(c.till_gc || 0)} ГС.</div>
      <button class="gd-b" onclick="event.stopPropagation();gardenTill()">Развернуть ячейку</button></div>`;
  } else if (!plot.plant) {
    const temple = land && land.land === 'temple';
    const seeds = (land && land.seeds) || [];
    const ich = (_gdState && _gdState.seed_ichor) || 0;
    body = `<div class="gd-p-b">
      <div class="gd-p-lead">Стапель готов. Чем засеваем?</div>
      ${temple ? `<div class="gd-seedrow">
        <button class="gd-b gd-ichor" ${ich > 0 ? '' : 'disabled'}
          onclick="event.stopPropagation();gardenSow('ichor')">◈ Древо ихора${ich > 0 ? '' : ' (нет споры)'}</button>
        <button class="gd-b gd-ghost" onclick="event.stopPropagation();gardenSeedBuy()">Купить спору мира — ${Math.round(c.seed_gc || 0)} ГС</button>
        <div class="gd-p-note">Отдаст не больше ${Math.round(c.ichor_cap || 10)} ихора, и ровно по труду.</div>
      </div>` : ''}
      ${seeds.length ? `<div class="gd-seeds">${seeds.map(s =>
        `<button class="gd-seed" onclick="event.stopPropagation();gardenSow('res',${JSON.stringify(s).replace(/"/g, '&quot;')})">${esc(s)}</button>`).join('')}</div>`
        : `<div class="gd-p-note">В этом веществе не поднимется ничего: у тел системы нет залежей.</div>`}
    </div>`;
  } else {
    const p = plot.plant;
    const bar = (v, good) => `<div class="gd-bar"><i style="width:${gClamp(v, 0, 100)}%;background:${good}"></i></div>`;
    const care = Math.round((p.care == null ? 1 : p.care) * 100);
    body = `<div class="gd-p-b">
      <div class="gd-p-lead">${p.kind === 'ichor' ? '◈ Древо ихора' : '◇ ' + esc(p.res || '')}
        — ${p.ripe ? '<b class="gd-ok">созрело</b>' : 'зреет ' + gardenLeft(p.left)}</div>
      <div class="gd-kv"><span>свет</span>${bar(p.water, '#8fd3ff')}<b>${p.water}</b></div>
      <div class="gd-kv"><span>раствор</span>${bar(p.feed, '#c9a24a')}<b>${p.feed}</b></div>
      <div class="gd-kv"><span>налёт</span>${bar(p.weeds, '#8f9a56')}<b>${p.weeds}</b></div>
      <div class="gd-care">режим выдержан на <b>${care}%</b> — столько и получишь</div>
      <div class="gd-acts">
        <button class="gd-b" onclick="event.stopPropagation();gardenCare('water')">☀ Поднять свет</button>
        <button class="gd-b" onclick="event.stopPropagation();gardenCare('feed')">⬢ Долить раствор (${Math.round(c.feed_gc || 0)} ГС)</button>
        <button class="gd-b" onclick="event.stopPropagation();gardenCare('weed')">✦ Снять налёт</button>
      </div>
      ${p.ripe ? `<button class="gd-b gd-harvest" onclick="event.stopPropagation();gardenHarvest()">Снять урожай</button>` : ''}
      <button class="gd-b gd-ghost" onclick="event.stopPropagation();gardenClear()">Свернуть посев</button>
    </div>`;
  }
  el.innerHTML = head + body;
}

function gardenLeft(sec) {
  sec = Math.max(0, sec | 0);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return h > 0 ? h + ' ч ' + m + ' мин' : m + ' мин';
}

function _gdCurPlant() {
  if (!_gdPanel) return null;
  const p = _gdPlots()[_gdPlotKey(_gdPanel.sys, _gdPanel.cell)];
  return p && p.plant ? p.plant : null;
}

async function gardenTill() {
  if (!_gdPanel) return;
  await gardenDo('garden_till', { p_sys: _gdPanel.sys, p_cell: _gdPanel.cell }, 'Стапель развёрнут.');
}
async function gardenSow(kind, res) {
  if (!_gdPanel) return;
  const plot = _gdPlots()[_gdPlotKey(_gdPanel.sys, _gdPanel.cell)];
  if (!plot) return;
  await gardenDo('garden_plant', { p_plot: plot.id, p_kind: kind, p_res: res || null }, 'Засеяно.');
}
async function gardenCare(act) {
  const p = _gdCurPlant(); if (!p) return;
  await gardenDo('garden_care', { p_plant: p.id, p_act: act });
}
async function gardenHarvest() {
  const p = _gdCurPlant(); if (!p) return;
  const r = await gardenDo('garden_harvest', { p_plant: p.id });
  if (r) gardenToast(`${r.name}: ${r.amount} (режим ${Math.round((r.care || 0) * 100)}%)`, 'ok');
}
async function gardenClear() {
  const p = _gdCurPlant(); if (!p) return;
  await gardenDo('garden_clear', { p_plant: p.id }, 'Посев свёрнут.');
}
async function gardenSeedBuy() {
  await gardenDo('garden_seed_buy', {}, 'Спора мира в трюме.');
}

// ============================================================
// ТРАЛ В ТЕЧЕНИИ. Механика сервера прежняя (fishing_cast/fishing_land):
// есть касание — успей выбрать сеть в окно react.
// ============================================================
let _gdHook = null;

async function gardenFishOpen() {
  if (_gdHook) return;
  try {
    const b = await ecRpc('fishing_cast', { p_depth: 0 });
    const bite = (b && b.bite) || b;
    if (!bite || !bite.id) { gardenToast('Пусто: взвесь идёт мимо.'); return; }
    const react = (Number(bite.react) || 1) * 1000;
    _gdHook = { id: bite.id, name: bite.name, until: Date.now() + react };
    gardenPaintHud();
    const el = document.createElement('div');
    el.id = 'gd-bite'; el.className = 'gd-bite';
    el.innerHTML = `<b>Есть касание</b><span>выбирай сеть</span>`;
    el.onclick = e => { e.stopPropagation(); gardenFishLand(true); };
    (document.getElementById('gd-fs') || document.body).appendChild(el);
    _gdHook.timer = setTimeout(() => gardenFishLand(false), react);
  } catch (e) {
    gardenToast((e && e.message) || 'не вышло', 'err');
  }
}

async function gardenFishLand(ok) {
  const h = _gdHook; if (!h) return;
  _gdHook = null;
  clearTimeout(h.timer);
  const el = document.getElementById('gd-bite'); if (el) el.remove();
  try {
    const r = await ecRpc('fishing_land', { p_id: h.id, p_ok: !!ok });
    if (r && r.lost) gardenToast('Ушло в поток: ' + (r.name || ''), '');
    else gardenToast('В трюме: ' + ((r && r.name) || h.name || '?'), 'ok');
  } catch (e) { gardenToast((e && e.message) || 'сорвалось', 'err'); }
  gardenPaintHud();
}

// ============================================================
// ОБЁРТКА ЭКРАНА
// ============================================================
function gardenPaintHud() {
  const el = document.getElementById('gd-hud');
  if (!el || !_gdState) return;
  const mine = (_gdState.plots || []).filter(p => p.mine);
  const ripe = mine.filter(p => p.plant && p.plant.ripe).length;
  const dry = mine.filter(p => p.plant && (p.plant.water < 20 || p.plant.weeds > 60)).length;
  el.innerHTML = `<span>ячеек: <b>${mine.length}/${Math.round((_gdState.const || {}).plot_cap || 0)}</b></span>` +
    (ripe ? `<span class="gd-ok">созрело: <b>${ripe}</b></span>` : '') +
    (dry ? `<span class="gd-warn">вне режима: <b>${dry}</b></span>` : '') +
    (_gdState.seed_ichor > 0 ? `<span>спора мира: <b>${_gdState.seed_ichor}</b></span>` : '');
}

function gardenStopGame() {
  if (_gd) { try { _gd.stop(); } catch (e) {} _gd = null; }
  if (_gdFit) { removeEventListener('resize', _gdFit); _gdFit = null; }
  gardenPanelClose();
  const fs = document.getElementById('gd-fs');
  if (fs) fs.remove();
  if (_gdHook) { clearTimeout(_gdHook.timer); _gdHook = null; }
}

function gardenStyleOnce() {
  if (document.getElementById('gd-css')) return;
  const s = document.createElement('style');
  s.id = 'gd-css';
  s.textContent = `
.gd-fs{position:fixed;inset:0;z-index:9000;background:#05070c;display:flex;flex-direction:column}
.gd-bar{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#080c13;border-bottom:1px solid #16202c;color:#cfe0f2;font:13px system-ui,sans-serif}
.gd-bar-t{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#8fd3ff}
.gd-hud{display:flex;gap:14px;flex:1;color:#7d8fa3;font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace}
.gd-hud b{color:#dfe7f2}
.gd-ok{color:#8fd3ff}.gd-warn{color:#e0a34a}
.gd-fs button{cursor:pointer}
.gd-exit{background:none;border:1px solid #22303f;color:#8fa4b8;border-radius:0;padding:5px 12px;font:11.5px ui-monospace,monospace}
.gd-exit:hover{border-color:#8fd3ff;color:#cfe0f2}
.gd-stage{position:relative;flex:1;overflow:hidden}
.gd-cv{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:crosshair}
.gd-keys{padding:6px 12px;background:#080c13;border-top:1px solid #16202c;color:#61758a;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center}
.gd-keys b{color:#8fa4b8;font-weight:400}
.gd-panel{position:absolute;right:14px;top:14px;width:296px;background:rgba(6,10,16,.94);border:1px solid #1d2836;color:#cfe0f2;font:13px system-ui,sans-serif;z-index:20;backdrop-filter:blur(3px)}
.gd-p-h{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid #16202c}
.gd-p-h span{flex:1;color:#61758a;font:10.5px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}
.gd-p-h button{background:none;border:0;color:#61758a;font-size:15px}
.gd-p-b{padding:11px}
.gd-p-lead{margin-bottom:9px;line-height:1.45}
.gd-p-note{color:#61758a;font-size:11px;margin-top:6px;line-height:1.45}
.gd-b{display:block;width:100%;margin-top:6px;padding:7px 10px;background:rgba(143,211,255,.04);border:1px solid #1d2836;color:#cfe0f2;font:12.5px system-ui,sans-serif;text-align:left}
.gd-b:hover{border-color:#8fd3ff;background:rgba(143,211,255,.09)}
.gd-b[disabled]{opacity:.4;cursor:default}
.gd-ghost{background:none;color:#61758a}
.gd-harvest{border-color:#8fd3ff;color:#cfe6ff;background:rgba(143,211,255,.12)}
.gd-ichor{border-color:#4b3d6b;color:#d9c7ff;background:rgba(180,150,255,.07)}
.gd-seeds{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.gd-seed{padding:5px 9px;background:none;border:1px solid #1d2836;color:#a9bdd0;font:11.5px ui-monospace,monospace}
.gd-seed:hover{border-color:#8fd3ff;color:#cfe0f2}
.gd-kv{display:flex;align-items:center;gap:8px;margin:5px 0;font:11.5px ui-monospace,monospace}
.gd-kv span{width:56px;color:#61758a}
.gd-kv b{width:26px;text-align:right;color:#cfe0f2;font-weight:400}
.gd-kv .gd-bar,.gd-panel .gd-bar{flex:1;height:4px;background:#111a24;overflow:hidden;padding:0;border:0}
.gd-kv .gd-bar i{display:block;height:100%}
.gd-care{margin:10px 0 4px;color:#7d8fa3;font-size:11.5px}
.gd-care b{color:#ffc46b}
.gd-acts{display:flex;flex-direction:column}
.gd-bite{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);padding:13px 26px;background:rgba(6,10,16,.94);border:1px solid #8fd3ff;color:#cfe6ff;font:13px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;text-align:center;z-index:30;cursor:pointer;animation:gdb .4s infinite alternate}
.gd-bite span{display:block;font-size:10px;color:#7d8fa3;margin-top:4px;letter-spacing:.06em}
@keyframes gdb{from{box-shadow:0 0 0 0 rgba(143,211,255,.28)}to{box-shadow:0 0 22px 2px rgba(143,211,255,.22)}}
@media(max-width:768px){.gd-panel{right:8px;left:8px;width:auto;top:auto;bottom:8px}}
/* Обложка «куда идти» живёт в колонке новеллы и держится её переменных. */
.fish-lead{font-size:12.5px;color:var(--t3,#8aa0b0);line-height:1.6;max-width:560px;margin:0 auto;text-align:center}
.fish-site{max-width:560px;margin:0 auto;padding:10px 0 2px;text-align:center}
.fish-site-nm{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--acc,#8fd3ff)}
.fish-site-sub{font-size:11.5px;color:var(--t4,#6a7a88);margin-top:6px}
.fish-site-kv{display:flex;flex-wrap:wrap;gap:4px 16px;justify-content:center;font:11.5px ui-monospace,monospace;color:var(--t3,#8aa0b0);margin-top:12px}
.fish-site-kv b{color:var(--t1,#dfe7f2);font-weight:400}
.fish-go{display:inline-flex;padding:8px 22px;margin-top:16px;cursor:pointer;background:var(--bg2,#101922);border:1px solid var(--acc,#8fd3ff);color:var(--t1,#dfe7f2);font:inherit}
.fish-go:hover{background:var(--bg3,#16222e)}
`;
  document.head.appendChild(s);
}

// ── Обложка: куда идти. ──
function _gdHead(en) {
  return `<div class="hp-vn-col-head">
    <span class="hp-vn-col-title">✦ ${en ? 'Into the Void' : 'Уйти в пустоту'}</span>
    <span class="hp-vnr-clr">${en ? 'quiet here' : 'тут тихо'}</span>
    <button class="hp-vn-col-x" type="button" onclick="event.stopPropagation();heroVNBack('fish')">↩ ${en ? 'back' : 'назад'}</button>
  </div>`;
}
const _gdMsg = txt => `<div class="hp-vn-col-body"><div class="hp-vn-col-empty">${txt}</div></div>`;

async function heroVNFishOpen() {
  const el = document.getElementById('hp-vn-fish');
  if (!el) return;
  const en = (typeof lang !== 'undefined' && lang === 'en');
  gardenStyleOnce();
  el.classList.add('show');
  el.setAttribute('aria-hidden', 'false');
  el.innerHTML = _gdHead(en) + _gdMsg('Выхожу в пустоту…');
  try {
    if (typeof ecLoadApp === 'function') await ecLoadApp();
    if (typeof EC === 'undefined' || !EC.app || !EC.app.faction_id) {
      if (!el.classList.contains('show')) return;
      el.innerHTML = _gdHead(en) + _gdMsg('Сначала зарегистрируйте державу.');
      return;
    }
    _gdState = await ecRpc('garden_get', {});
    if (!el.classList.contains('show')) return;
    gardenPaintOverview();
  } catch (e) {
    if (!el.classList.contains('show')) return;
    el.innerHTML = _gdHead(en) + _gdMsg(esc((e && e.message) || 'не дошёл'));
  }
}

function gardenPaintOverview() {
  const el = document.getElementById('hp-vn-fish');
  if (!el || !_gdState) return;
  gardenStopGame();
  const en = (typeof lang !== 'undefined' && lang === 'en');
  const lands = _gdState.lands || [];
  const mine = (_gdState.plots || []).filter(p => p.mine);
  const ripe = mine.filter(p => p.plant && p.plant.ripe).length;
  const dry = mine.filter(p => p.plant && (p.plant.water < 20 || p.plant.weeds > 60)).length;

  const body = !lands.length
    ? `<div class="fish-lead">Своего шельфа пока нет: заведите колонию — и будет где разворачивать стапель.</div>`
    : `<div class="fish-site">
        <div class="fish-site-nm">Материки и пустота</div>
        <div class="fish-site-sub">${lands.length} ${lands.length === 1 ? 'участок' : 'участка(ов)'} · между ними пустота</div>
        <div class="fish-site-kv">
          <span>ячеек: <b>${mine.length}/${Math.round((_gdState.const || {}).plot_cap || 0)}</b></span>
          ${ripe ? `<span>созрело: <b>${ripe}</b></span>` : ''}
          ${dry ? `<span>вне режима: <b>${dry}</b></span>` : ''}
          ${_gdState.seed_ichor > 0 ? `<span>в трюме: <b>спора мира</b></span>` : ''}
        </div>
        <button class="fish-go" onclick="event.stopPropagation();gardenDescend()">Уйти в пустоту</button>
      </div>
      <div class="fish-lead" style="margin-top:14px">Двигателя тут никто не торопит. Отмель помнит, кто над ней ходил.</div>`;

  el.innerHTML = _gdHead(en) + `<div class="hp-vn-col-body">${body}</div>`;
}

// ── Выход на отмель ──
async function gardenDescend() {
  gardenStyleOnce();
  gardenStopGame();

  const fs = document.createElement('div');
  fs.className = 'gd-fs'; fs.id = 'gd-fs';
  fs.innerHTML = `<div class="gd-bar">
      <span class="gd-bar-t">✦ Пустота</span>
      <div class="gd-hud" id="gd-hud"></div>
      <button class="gd-exit" type="button" onclick="event.stopPropagation();gardenPaintOverview()">↩ уйти</button>
    </div>
    <div class="gd-stage" id="gd-stage"><canvas class="gd-cv" id="gd-cv"></canvas></div>
    <div class="gd-keys"><b>W/A/S/D</b> — курс (или тык по отмели) · <b>E</b> — ячейка · гипер у кромки · трал в гипере · <b>Shift</b> — разгон · <b>Esc</b> — уйти</div>`;
  document.body.appendChild(fs);

  const stage = document.getElementById('gd-stage');
  stage.insertAdjacentHTML('beforeend', '<div class="gd-keys" id="gd-load" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border:0;background:#05070c">Пустота проступает…</div>');

  if (!_gdWorld) {
    try {
      const [sys, secs] = await Promise.all([
        dbGet('map_systems', 'select=id,name,x,y,is_giant,planets'),
        dbGet('map_sectors', 'select=id,name,system_ids').catch(() => []),
      ]);
      _gdWorld = GardenWorld(sys || [], secs || []);
    } catch (e) {
      gardenToast('Карта не загрузилась: ' + ((e && e.message) || ''), 'err');
      gardenPaintOverview(); return;
    }
  }
  const ld = document.getElementById('gd-load'); if (ld) ld.remove();
  if (!document.getElementById('gd-fs')) return;      // успели уйти

  // Появление: своя система, иначе Храм, иначе первое попавшееся светило.
  // Встаём НА площадку — первый кадр должен показать, куда ты прилетел, а не
  // пустоту где-то рядом.
  const home = (_gdState.lands || []).find(l => l.land === 'own') || (_gdState.lands || [])[0];
  const node = (home && _gdWorld.nodeOf(home.sys)) || _gdWorld.nodes[0];
  let spawn = node ? { tx: node.tx + node.R * .55, ty: node.ty + node.R * .55 } : { tx: 0, ty: 0 };
  if (node && _gdWorld.isVoid(spawn.tx, spawn.ty)) spawn = { tx: node.tx, ty: node.ty };

  const cv = document.getElementById('gd-cv');
  const fit = () => {
    const st = document.getElementById('gd-stage');
    if (!st || !cv.isConnected) return;
    const r = st.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(320, Math.round(r.width)), h = Math.max(220, Math.round(r.height));
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    if (_gd) _gd.onResize(w, h, dpr);
  };
  _gd = gardenStart(cv, _gdWorld, spawn);
  fit(); requestAnimationFrame(fit);
  _gdFit = fit; addEventListener('resize', fit);
  if (typeof fishFlagLoad === 'function') fishFlagLoad();
  gardenPaintHud();

  // Шкалы ходят по реальному времени — раз в минуту переспрашиваем сервер.
  _gd.poll = setInterval(() => { if (document.getElementById('gd-fs')) gardenReload(); }, 60000);
}

function heroVNFishClose() {
  if (_gd && _gd.poll) clearInterval(_gd.poll);
  gardenStopGame();
  const el = document.getElementById('hp-vn-fish');
  if (!el) return;
  el.classList.remove('show');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '';
  if (typeof _heroVNView !== 'undefined' && _heroVNView === 'fish') _heroVNView = null;
}

function heroVNFishRefresh() {
  const el = document.getElementById('hp-vn-fish');
  if (!el || !el.classList.contains('show')) return;
  if (_gd) gardenPaintHud();
}
