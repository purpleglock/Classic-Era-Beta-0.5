/* Тихая Вода — рыбалка в духе Террарии.
   Вертикальный срез: платформер-управление, водоём с волнами/каустиками,
   заброс → поклёвка → подсечка → вываживание → лут.
   Мультиплеер: транспорт вынесен в Net (сейчас BroadcastChannel между вкладками). */
'use strict';

/* ─── настройки ─────────────────────────────────────────────────────── */
const TILE = 16;
const VIEW_W = 480, VIEW_H = 270;          // логическое разрешение, дальше целочисленный зум
const W = 1200, H = 150;                   // мир в тайлах
const WATER_Y = 78;                        // уровень воды (тайлы)
const DAY_LEN = 300;                       // секунд в сутках

const T_AIR = 0, T_DIRT = 1, T_GRASS = 2, T_STONE = 3, T_SAND = 4, T_WOOD = 5, T_LEAF = 6;
const SOLID = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 0, 6: 0 };

/* ─── мелочи ────────────────────────────────────────────────────────── */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];

function hash(n) { n = (n << 13) ^ n; return 1 - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824; }
function noise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u); }
function fbm(x) { let s = 0, a = .5, f = 1; for (let o = 0; o < 4; o++) { s += noise1(x * f) * a; a *= .5; f *= 2; } return s; }

/* ─── мир ───────────────────────────────────────────────────────────── */
const map = new Uint8Array(W * H);
const tile = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? T_STONE : map[y * W + x];
const setT = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) map[y * W + x] = v; };
const solidAt = (x, y) => !!SOLID[tile(x, y)];
const isWater = (x, y) => y >= WATER_Y && tile(x, y) === T_AIR && y < H;

const LAKES = [
  { x: 150, r: 95, d: 26 }, { x: 430, r: 70, d: 17 },
  { x: 700, r: 120, d: 38 }, { x: 1010, r: 80, d: 22 },
];

function groundH(x) {
  let h = 64 + fbm(x * .012) * 9 + Math.sin(x * .031) * 3.5;
  for (const L of LAKES) {
    const d = Math.abs(x - L.x);
    if (d < L.r) {
      const b = Math.cos(d / L.r * Math.PI / 2) ** 1.5;
      h = Math.max(h, WATER_Y + 1 + L.d * b);
    }
  }
  return h;
}

const topH = new Int16Array(W);
const waterTop = new Int16Array(W).fill(-1);
const waterBot = new Int16Array(W).fill(-1);

function genWorld() {
  for (let x = 0; x < W; x++) {
    const h = Math.round(groundH(x));
    topH[x] = h;
    for (let y = h; y < H; y++) {
      let t = T_DIRT;
      if (y > h + 6 + fbm(x * .05) * 5) t = T_STONE;
      if (y === h) t = (h > WATER_Y - 3) ? T_SAND : T_GRASS;
      else if (y < h + 3 && h > WATER_Y - 2) t = T_SAND;
      setT(x, y, t);
    }
  }
  // деревья на суше
  for (let x = 6; x < W - 6; x++) {
    const h = topH[x];
    if (h > WATER_Y - 6) continue;
    if (Math.random() > .045) continue;
    const hh = 5 + (Math.random() * 5 | 0);
    for (let i = 1; i <= hh; i++) setT(x, h - i, T_WOOD);
    const cy = h - hh;
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 1; dy++)
      if (dx * dx + dy * dy * 1.4 < 6.2 && tile(x + dx, cy + dy) === T_AIR) setT(x + dx, cy + dy, T_LEAF);
  }
  // кэш водяных столбов
  for (let x = 0; x < W; x++) {
    if (tile(x, WATER_Y) !== T_AIR) continue;
    let b = WATER_Y;
    while (b < H && tile(x, b) === T_AIR) b++;
    waterTop[x] = WATER_Y; waterBot[x] = b;
  }
}
genWorld();

const waterDepthAt = px => {                      // глубина воды в пикселях под точкой
  const tx = px / TILE | 0;
  return waterTop[tx] < 0 ? 0 : (waterBot[tx] - waterTop[tx]) * TILE;
};

/* ─── лут ───────────────────────────────────────────────────────────── */
// rar: 0 хлам · 1 обычная · 2 редкая · 3 очень редкая · 4 легенда
const LOOT = [
  { n: 'Ржавая банка', rar: 0, w: 16, junk: 1 }, { n: 'Пучок водорослей', rar: 0, w: 14, junk: 1 },
  { n: 'Старый сапог', rar: 0, w: 9, junk: 1 }, { n: 'Мокрая ветка', rar: 0, w: 8, junk: 1 },
  { n: 'Плотва', rar: 1, w: 30, fish: 1 }, { n: 'Окунь', rar: 1, w: 26, fish: 1 },
  { n: 'Карась', rar: 1, w: 22, fish: 1 }, { n: 'Линь', rar: 1, w: 14, fish: 1, minD: 60 },
  { n: 'Зеркальный карп', rar: 2, w: 11, fish: 1, minD: 90 },
  { n: 'Сом', rar: 2, w: 9, fish: 1, minD: 150, fight: 1.35 },
  { n: 'Лунная форель', rar: 2, w: 10, fish: 1, night: 1 },
  { n: 'Стеклянный угорь', rar: 3, w: 4, fish: 1, minD: 170, night: 1, fight: 1.5 },
  { n: 'Обломок обшивки', rar: 2, w: 8, minD: 110 }, { n: 'Капсула чёрного ящика', rar: 3, w: 3.5, minD: 190 },
  { n: 'Кольцо рулевого', rar: 3, w: 2.5, minD: 150 },
  { n: 'Осколок затонувшего киля', rar: 3, w: 2, minD: 210 },
  { n: 'Компас, что смотрит вниз', rar: 4, w: .7, minD: 200 },
  { n: 'Сердце тихой воды', rar: 4, w: .45, minD: 240, night: 1, fight: 1.9 },
];

function rollLoot(depth, night) {
  const pool = LOOT.filter(l => (!l.minD || depth >= l.minD));
  let tot = 0; const ws = pool.map(l => { let w = l.w; if (l.night) w *= night ? 2.2 : .25; if (l.minD) w *= .8 + Math.min(1.6, depth / 220); tot += w; return w; });
  let r = Math.random() * tot;
  for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) return pool[i]; }
  return pool[0];
}

/* ─── канвас ────────────────────────────────────────────────────────── */
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
let SCALE = 3;
function resize() {
  SCALE = Math.max(2, Math.min(Math.floor(innerWidth / VIEW_W), Math.floor(innerHeight / VIEW_H)));
  cv.width = VIEW_W; cv.height = VIEW_H;
  cv.style.width = VIEW_W * SCALE + 'px'; cv.style.height = VIEW_H * SCALE + 'px';
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', resize); resize();

/* ─── ввод ──────────────────────────────────────────────────────────── */
const keys = {}, mouse = { x: VIEW_W / 2, y: VIEW_H / 2, down: false, pressed: false };
addEventListener('keydown', e => { keys[e.code] = 1; if (e.code === 'Space' || e.code === 'Tab') e.preventDefault(); if (e.code === 'Tab') showBag = !showBag; });
addEventListener('keyup', e => keys[e.code] = 0);
cv.addEventListener('mousemove', e => {
  const r = cv.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) / SCALE; mouse.y = (e.clientY - r.top) / SCALE;
});
cv.addEventListener('mousedown', e => { if (e.button === 0) { mouse.down = true; mouse.pressed = true; } });
addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());

/* ─── игрок ─────────────────────────────────────────────────────────── */
const NAMES = ['Смотрящий', 'Тихий', 'Костерок', 'Приблуда', 'Молчун', 'Поплавок'];
// стартуем на берегу: ближайшая суша справа от первого озера
const SPAWN_X = (() => {
  for (let x = LAKES[0].x; x < W - 20; x++) if (topH[x] < WATER_Y - 2 && topH[x + 6] < WATER_Y - 2) return x + 3;
  return 20;
})();
const me = {
  id: Math.random().toString(36).slice(2, 8), name: pick(NAMES),
  x: SPAWN_X * TILE, y: (topH[SPAWN_X] - 4) * TILE, vx: 0, vy: 0,
  w: 8, h: 18, dir: 1, onGround: false, inWater: false, anim: 0, walk: 0, rodA: 0,
};
const bag = new Map(); let showBag = false;

// p.x — центр, p.y — ноги (низ), p.h вверх от ног.
const rangeX = p => [Math.floor((p.x - p.w / 2) / TILE), Math.floor((p.x + p.w / 2 - .01) / TILE)];
const rangeY = p => [Math.floor((p.y - p.h) / TILE), Math.floor((p.y - .01) / TILE)];

function tileCollide(p) {
  /* --- горизонталь --- */
  if (p.vx) {
    p.x += p.vx;
    let [x0, x1] = rangeX(p), [y0, y1] = rangeY(p), hit = null;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!solidAt(x, y)) continue;
      // ступенька: одиночный блок под ногами перешагиваем
      if (y === y1 && !solidAt(x, y - 1) && !solidAt(x, y - 2) && p.onGround) continue;
      if (hit === null || (p.vx > 0 ? x < hit : x > hit)) hit = x;
    }
    if (hit !== null) {
      p.x = p.vx > 0 ? hit * TILE - p.w / 2 - .01 : (hit + 1) * TILE + p.w / 2 + .01;
      p.vx = 0;
    } else {
      // если перешагнули блок — приподнимаем
      [y0, y1] = rangeY(p);[x0, x1] = rangeX(p);
      for (let x = x0; x <= x1; x++) if (solidAt(x, y1)) { p.y = y1 * TILE - .01; break; }
    }
  }
  /* --- вертикаль --- */
  p.y += p.vy; p.onGround = false;
  if (p.vy) {
    const [x0, x1] = rangeX(p), [y0, y1] = rangeY(p);
    let hit = null;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!solidAt(x, y)) continue;
      if (hit === null || (p.vy > 0 ? y < hit : y > hit)) hit = y;
    }
    if (hit !== null) {
      if (p.vy > 0) { p.y = hit * TILE - .01; p.onGround = true; }
      else p.y = (hit + 1) * TILE + p.h + .01;
      p.vy = 0;
    }
  }
}

function updatePlayer(dt) {
  const inW = isWater(p2t(me.x), p2t(me.y - 4));
  me.inWater = inW;
  const acc = inW ? .35 : (me.onGround ? .9 : .45), maxv = inW ? 1.1 : 2.1;
  let mv = 0;
  if (keys.KeyA || keys.ArrowLeft) mv--;
  if (keys.KeyD || keys.ArrowRight) mv++;
  if (mv) { me.vx = clamp(me.vx + mv * acc, -maxv, maxv); me.dir = mv; me.walk += Math.abs(me.vx) * .18; }
  else me.vx *= me.onGround ? .72 : .93;

  if (keys.Space) {
    if (inW) me.vy = Math.max(me.vy - .22, -1.3);
    else if (me.onGround) me.vy = -4.15;
  }
  me.vy += inW ? .1 : .28;
  if (inW) { me.vy = clamp(me.vy, -1.4, 1.5); me.vx *= .93; if (Math.random() < .12) spawnBubble(me.x, me.y - 10); }
  else me.vy = Math.min(me.vy, 9);
  tileCollide(me);
  if (me.y > H * TILE) { me.y = (topH[SPAWN_X] - 4) * TILE; me.x = SPAWN_X * TILE; me.vy = 0; }
}
const p2t = v => Math.floor(v / TILE);

/* ─── рыбалка ───────────────────────────────────────────────────────── */
const F = {
  state: 'idle',      // idle | charge | fly | wait | bite | fight
  power: 0, t: 0,
  bx: 0, by: 0, bvx: 0, bvy: 0, sunk: 0, floatT: 0,
  biteAt: 0, nibbleAt: 0, dip: 0,
  fish: null, dist: 1, tension: 0, struggle: 0, strT: 0, depth: 0,
};
const rodTip = () => ({ x: me.x + me.dir * 11, y: me.y - 20 - Math.sin(me.rodA) * 4 });

function updateFishing(dt) {
  const night = isNight();
  me.rodA = lerp(me.rodA, F.state === 'charge' ? -.7 : F.state === 'fight' ? .5 + Math.sin(F.t * 14) * .12 : 0, .2);

  switch (F.state) {
    case 'idle':
      if (mouse.pressed) { F.state = 'charge'; F.power = 0; }
      break;

    case 'charge':
      F.power = Math.min(1, F.power + dt * 1.15);
      if (!mouse.down) {
        const tip = rodTip();
        const tx = mouse.x + cam.x, ty = mouse.y + cam.y;
        let a = Math.atan2(ty - tip.y, tx - tip.x);
        a = clamp(a, -Math.PI * .95, Math.PI * .95);
        const sp = 2.2 + F.power * 6.4;
        F.bx = tip.x; F.by = tip.y; F.bvx = Math.cos(a) * sp; F.bvy = Math.sin(a) * sp - 1.2;
        F.sunk = 0; F.state = 'fly'; me.dir = F.bvx < 0 ? -1 : 1;
      }
      break;

    case 'fly': {
      F.bvy += .3; F.bvx *= .995; F.bx += F.bvx; F.by += F.bvy;
      const tx = p2t(F.bx), ty = p2t(F.by);
      if (isWater(tx, ty)) {
        splash(F.bx, WATER_Y * TILE, 10, 1.2); ripple(F.bx, 1);
        F.depth = waterDepthAt(F.bx);
        F.state = 'wait'; F.t = 0; F.floatT = 0;
        F.biteAt = rnd(2.6, 9.5) * (F.depth > 120 ? .85 : 1);
        F.nibbleAt = rnd(1, F.biteAt - .6);
        F.bvy = 2;
      } else if (solidAt(tx, ty) || F.by > H * TILE || F.bx < 0 || F.bx > W * TILE) {
        F.state = 'idle';
      }
      break;
    }

    case 'wait': {
      F.t += dt; F.floatT += dt;
      const surf = WATER_Y * TILE + waveAt(F.bx, time);
      // поплавок всплывает и качается
      F.bvy += (surf - F.by) * .09; F.bvy *= .8; F.by += F.bvy;
      F.by += Math.sin(F.floatT * 2.4) * .12;
      if (F.nibbleAt > 0 && F.t > F.nibbleAt) { F.nibbleAt = -1; F.bvy += 1.4; ripple(F.bx, .5); }
      if (F.t > F.biteAt) {
        F.state = 'bite'; F.t = 0; F.bvy = 3.2; ripple(F.bx, .8);
        F.fish = rollLoot(F.depth, night);
      }
      if (mouse.pressed) { F.state = 'idle'; }   // смотать
      break;
    }

    case 'bite': {
      F.t += dt;
      const surf = WATER_Y * TILE + waveAt(F.bx, time);
      F.by += F.bvy; F.bvy += (surf + 7 - F.by) * .14; F.bvy *= .78;
      if (Math.random() < .3) ripple(F.bx, .35);
      if (mouse.pressed) {                       // подсечка
        F.state = 'fight'; F.t = 0; F.dist = 1; F.tension = .28;
        F.struggle = 0; F.strT = rnd(.4, 1);
        splash(F.bx, WATER_Y * TILE, 6, .8);
      } else if (F.t > .95) { F.state = 'wait'; F.t = 0; F.biteAt = rnd(3, 8); F.nibbleAt = -1; F.fish = null; }
      break;
    }

    case 'fight': {
      F.t += dt; F.strT -= dt;
      const hard = (F.fish.fight || 1) * (1 + F.fish.rar * .1);
      if (F.strT <= 0) { F.struggle = F.struggle > .3 ? 0 : rnd(.7, 1.25) * hard; F.strT = F.struggle ? rnd(.5, 1.1) : rnd(.5, 1.4); }
      const reel = mouse.down;
      // натяжение: тянем — растёт, отпускаем — падает; рывки рыбы добавляют
      F.tension += ((reel ? .55 : -.75) + F.struggle * .95) * dt;
      F.tension = Math.max(0, F.tension);
      if (reel) F.dist -= dt * .3 / (1 + F.struggle * 1.4);
      else F.dist += dt * .07 * F.struggle;
      F.dist = clamp(F.dist, 0, 1.15);
      // поплавок ходит по воде
      const tip = rodTip();
      F.bx = lerp(F.bx, tip.x + (F.bx - tip.x) * .995, .04);
      F.bx += Math.sin(F.t * 7) * F.struggle * 1.6;
      F.bx = lerp(F.bx, tip.x, (1 - F.dist) * .02);
      F.by = WATER_Y * TILE + waveAt(F.bx, time) + 2 + F.struggle * 5;
      if (Math.random() < F.struggle * .5) { ripple(F.bx, .4); spawnBubble(F.bx, F.by + 6); }

      if (F.tension >= 1) { logMsg('Леска лопнула — ' + F.fish.n + ' ушла', -1); F.state = 'idle'; F.fish = null; splash(F.bx, F.by, 8, 1); }
      else if (F.dist <= 0) { catchIt(); }
      break;
    }
  }
  mouse.pressed = false;
}

function catchIt() {
  const f = F.fish;
  splash(F.bx, WATER_Y * TILE, 14, 1.4);
  for (let i = 0; i < 10; i++) parts.push({ x: F.bx, y: F.by, vx: rnd(-1, 1), vy: rnd(-2.4, -.6), l: 1, g: .1, c: f.rar >= 3 ? '#ffd77a' : '#bfe9ff', s: 1 });
  bag.set(f.n, (bag.get(f.n) || 0) + 1);
  const kg = f.fish ? ' · ' + (rnd(.2, 2 + f.rar * 2.2)).toFixed(2) + ' кг' : '';
  logMsg((f.junk ? '' : '★ ') + f.n + kg, f.rar);
  if (f.rar >= 3) flash = 1;
  F.state = 'idle'; F.fish = null;
}

/* ─── эффекты ───────────────────────────────────────────────────────── */
const parts = [], ripples = [], bubbles = [];
let flash = 0;
const waveAt = (px, t) => Math.sin(px * .055 + t * 1.9) * 1.5 + Math.sin(px * .021 - t * 1.15) * 1.1 + Math.sin(px * .13 + t * 2.7) * .5;
function ripple(x, s) { ripples.push({ x, r: 2, m: 26 * s + 8, l: 1 }); }
function splash(x, y, n, s) { for (let i = 0; i < n; i++) parts.push({ x: x + rnd(-3, 3), y, vx: rnd(-1.6, 1.6) * s, vy: rnd(-3.4, -.8) * s, l: 1, g: .22, c: '#cfeeff', s: 1 }); }
function spawnBubble(x, y) { bubbles.push({ x, y, l: 1, r: rnd(.6, 1.8), vx: rnd(-.15, .15) }); }

function updateFx(dt) {
  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.vy += p.g; p.x += p.vx; p.y += p.vy; p.l -= dt * 1.5; if (p.l <= 0) parts.splice(i, 1); }
  for (let i = ripples.length - 1; i >= 0; i--) { const r = ripples[i]; r.r += dt * 34; r.l -= dt * .9; if (r.l <= 0 || r.r > r.m) ripples.splice(i, 1); }
  for (let i = bubbles.length - 1; i >= 0; i--) { const b = bubbles[i]; b.y -= dt * 22; b.x += b.vx; b.l -= dt * .55; if (b.l <= 0 || b.y < WATER_Y * TILE) bubbles.splice(i, 1); }
  flash = Math.max(0, flash - dt * 1.4);
}

/* фоновая рыба-декорация */
const ambient = [];
for (const L of LAKES) for (let i = 0; i < 10; i++) {
  const x = L.x * TILE + rnd(-L.r, L.r) * TILE * .6;
  ambient.push({ x, y: (WATER_Y + rnd(3, L.d * .8)) * TILE, vx: rnd(.2, .55) * (Math.random() < .5 ? -1 : 1), s: rnd(.7, 1.6), p: rnd(0, 9) });
}
function updateAmbient(dt) {
  for (const f of ambient) {
    f.x += f.vx; f.p += dt * 6;
    const tx = p2t(f.x);
    if (!isWater(tx, p2t(f.y))) { f.vx *= -1; f.x += f.vx * 2; }
    f.y += Math.sin(f.p * .5) * .12;
  }
}

/* ─── время суток ───────────────────────────────────────────────────── */
let time = 0;
const dayT = () => (time % DAY_LEN) / DAY_LEN;                 // 0 — рассвет, .5 — закат
const isNight = () => { const t = dayT(); return t < .06 || t > .56; };
const SKY = [
  { t: 0, a: '#1b2440', b: '#6b5a72', c: '#c98a72' },   // рассвет
  { t: .12, a: '#3f79c0', b: '#7fb4e0', c: '#cfe7f5' },  // утро
  { t: .38, a: '#2f6fbf', b: '#79b0dd', c: '#dff0fb' },  // день
  { t: .54, a: '#2a3560', b: '#a2607a', c: '#e6a06a' },  // закат
  { t: .66, a: '#0b1024', b: '#16203f', c: '#2a3c63' },  // ночь
  { t: 1, a: '#1b2440', b: '#6b5a72', c: '#c98a72' },
];
function mixHex(h1, h2, t) {
  const p = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const a = p(h1), b = p(h2);
  return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;
}
function skyNow() {
  const t = dayT();
  let i = 0; while (i < SKY.length - 2 && SKY[i + 1].t < t) i++;
  const k = (t - SKY[i].t) / (SKY[i + 1].t - SKY[i].t);
  return { a: mixHex(SKY[i].a, SKY[i + 1].a, k), b: mixHex(SKY[i].b, SKY[i + 1].b, k), c: mixHex(SKY[i].c, SKY[i + 1].c, k) };
}

/* ─── камера ────────────────────────────────────────────────────────── */
const cam = { x: 0, y: 0 };
function updateCam() {
  const tgx = me.x - VIEW_W / 2 + me.dir * 26, tgy = me.y - VIEW_H * .62;
  cam.x = clamp(lerp(cam.x, tgx, .09), 0, W * TILE - VIEW_W);
  cam.y = clamp(lerp(cam.y, tgy, .07), -60, H * TILE - VIEW_H);
}

/* ─── рендер ────────────────────────────────────────────────────────── */
const STARS = Array.from({ length: 130 }, () => ({ x: Math.random() * VIEW_W, y: Math.random() * VIEW_H * .7, s: Math.random(), p: rnd(0, 9) }));
const CLOUDS = Array.from({ length: 14 }, () => ({ x: Math.random() * W * TILE, y: rnd(10, 150), s: rnd(.6, 1.7), v: rnd(.05, .18) }));

function drawSky() {
  const s = skyNow();
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, s.a); g.addColorStop(.55, s.b); g.addColorStop(1, s.c);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const t = dayT(), nightAmt = clamp((t > .5 ? (t - .5) / .12 : (0.08 - t) / .08), 0, 1);
  if (nightAmt > 0) {
    ctx.globalAlpha = nightAmt;
    for (const st of STARS) { ctx.fillStyle = '#fff'; ctx.globalAlpha = nightAmt * (.25 + Math.abs(Math.sin(st.p + time * .8)) * .6); ctx.fillRect(st.x, st.y, 1, 1); }
    ctx.globalAlpha = 1;
  }
  // светило
  const ang = t * Math.PI * 2 - Math.PI / 2;
  const sx = VIEW_W / 2 + Math.cos(ang) * VIEW_W * .55, sy = VIEW_H * .78 + Math.sin(ang) * VIEW_H * .8;
  const sun = t < .5;
  ctx.fillStyle = sun ? '#ffe9a8' : '#e8eefc';
  ctx.beginPath(); ctx.arc(sx, sy, sun ? 9 : 7, 0, 7); ctx.fill();
  ctx.globalAlpha = .18; ctx.beginPath(); ctx.arc(sx, sy, sun ? 22 : 15, 0, 7); ctx.fill(); ctx.globalAlpha = 1;

  // облака
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  for (const c of CLOUDS) {
    c.x += c.v;
    const x = ((c.x - cam.x * .25) % (W * TILE) + W * TILE) % (W * TILE) - 100;
    if (x < -120 || x > VIEW_W + 60) continue;
    const w = 46 * c.s, h = 9 * c.s;
    ctx.beginPath(); ctx.ellipse(x, c.y, w, h, 0, 0, 7);
    ctx.ellipse(x + w * .4, c.y - h * .6, w * .55, h * .9, 0, 0, 7); ctx.fill();
  }
  // дальние холмы (параллакс)
  for (let l = 0; l < 2; l++) {
    const par = l ? .5 : .3, amp = l ? 26 : 18, base = VIEW_H * (l ? .62 : .56);
    ctx.fillStyle = l ? 'rgba(30,48,62,.75)' : 'rgba(46,66,84,.55)';
    ctx.beginPath(); ctx.moveTo(0, VIEW_H);
    for (let x = 0; x <= VIEW_W; x += 6) {
      const wx = (x + cam.x * par) * .01;
      ctx.lineTo(x, base - (fbm(wx + l * 30) * amp) - cam.y * par * .3);
    }
    ctx.lineTo(VIEW_W, VIEW_H); ctx.fill();
  }
}

const TCOL = {
  1: ['#5a4433', '#4b3829'], 2: ['#4b7a3a', '#3d6430'], 3: ['#4a4f5c', '#3d4149'],
  4: ['#c2b183', '#a99a71'], 5: ['#6b4f34', '#573f29'], 6: ['#3f7a45', '#356a3b'],
};
function drawTiles() {
  const x0 = Math.max(0, p2t(cam.x) - 1), x1 = Math.min(W - 1, p2t(cam.x + VIEW_W) + 1);
  const y0 = Math.max(0, p2t(cam.y) - 1), y1 = Math.min(H - 1, p2t(cam.y + VIEW_H) + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = tile(x, y); if (!t) continue;
    const sx = x * TILE - cam.x | 0, sy = y * TILE - cam.y | 0;
    const c = TCOL[t];
    ctx.fillStyle = ((x * 7 + y * 13) & 3) ? c[0] : c[1];
    ctx.fillRect(sx, sy, TILE, TILE);
    if (t === T_GRASS || t === T_SAND) { ctx.fillStyle = t === T_GRASS ? '#69a04d' : '#dcca97'; ctx.fillRect(sx, sy, TILE, 3); }
    if (t === T_LEAF) { ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(sx + 2, sy + 2, 5, 4); }
  }
}

function drawWater() {
  const x0 = Math.max(0, p2t(cam.x) - 1), x1 = Math.min(W - 1, p2t(cam.x + VIEW_W) + 1);
  // тело воды — столбцами по тайлам, поверхность гуляет волной
  const night = isNight();
  for (let x = x0; x <= x1; x++) {
    if (waterTop[x] < 0) continue;
    const sx = x * TILE - cam.x, wx = x * TILE;
    const top = WATER_Y * TILE + waveAt(wx, time) - cam.y;
    const bot = waterBot[x] * TILE - cam.y;
    if (bot < 0 || top > VIEW_H) continue;
    const g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, night ? 'rgba(40,80,110,.42)' : 'rgba(90,175,215,.40)');
    g.addColorStop(1, night ? 'rgba(6,16,34,.90)' : 'rgba(12,44,80,.86)');
    ctx.fillStyle = g;
    ctx.fillRect(sx, top, TILE + 1, bot - top);
    // блик поверхности
    ctx.fillStyle = night ? 'rgba(150,190,230,.35)' : 'rgba(225,248,255,.55)';
    ctx.fillRect(sx, top, TILE + 1, 1);
    ctx.fillStyle = night ? 'rgba(120,160,210,.12)' : 'rgba(180,230,255,.16)';
    ctx.fillRect(sx, top + 1, TILE + 1, 2);
  }
  // каустики
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = night ? 'rgba(90,140,190,.05)' : 'rgba(160,225,255,.07)';
  for (let x = x0; x <= x1; x++) {
    if (waterTop[x] < 0) continue;
    const sx = x * TILE - cam.x, wx = x * TILE;
    const top = WATER_Y * TILE + waveAt(wx, time) - cam.y, bot = waterBot[x] * TILE - cam.y;
    for (let y = top + 6; y < bot; y += 9) {
      const o = Math.sin(wx * .04 + y * .06 + time * 1.6) * 5;
      ctx.fillRect(sx + o, y, TILE * .7, 1.5);
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // круги на воде
  for (const r of ripples) {
    const sx = r.x - cam.x, sy = WATER_Y * TILE + waveAt(r.x, time) - cam.y;
    ctx.strokeStyle = `rgba(220,245,255,${.5 * r.l})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(sx, sy, r.r, r.r * .3, 0, 0, 7); ctx.stroke();
  }
}

function drawUnderwater() {
  for (const f of ambient) {
    const sx = f.x - cam.x, sy = f.y - cam.y;
    if (sx < -20 || sx > VIEW_W + 20) continue;
    ctx.fillStyle = 'rgba(190,215,235,.5)';
    const d = f.vx > 0 ? 1 : -1, w = 5 * f.s;
    ctx.fillRect(sx - w / 2, sy, w, 2 * f.s);
    ctx.fillRect(sx - d * w * .8, sy - 1, 2, 3 * f.s + Math.sin(f.p) * .5);
  }
  for (const b of bubbles) {
    ctx.fillStyle = `rgba(210,240,255,${.45 * b.l})`;
    ctx.beginPath(); ctx.arc(b.x - cam.x, b.y - cam.y, b.r, 0, 7); ctx.fill();
  }
}

function drawChar(p, ghost) {
  const x = Math.round(p.x - cam.x), y = Math.round(p.y - cam.y), d = p.dir;
  const bob = p.onGround ? Math.sin(p.walk) * 1 : 0;
  ctx.globalAlpha = ghost ? .65 : 1;
  // ноги
  ctx.fillStyle = '#2f3a4d';
  const step = p.onGround ? Math.sin(p.walk) * 3 : 1.5;
  ctx.fillRect(x - 3 + step * .4, y - 7, 3, 7); ctx.fillRect(x + step * -.4, y - 7, 3, 7);
  // тело
  ctx.fillStyle = ghost ? '#5b6f8a' : '#3d5a7a'; ctx.fillRect(x - 4, y - 15 + bob * .3, 8, 9);
  ctx.fillStyle = '#2c4460'; ctx.fillRect(x - 4, y - 11 + bob * .3, 8, 2);
  // голова
  ctx.fillStyle = '#d9b28c'; ctx.fillRect(x - 3, y - 21 + bob * .3, 7, 6);
  ctx.fillStyle = '#1b2434'; ctx.fillRect(x - 3, y - 23 + bob * .3, 8, 3);   // шляпа
  ctx.fillRect(x - 5 + (d > 0 ? 0 : 2), y - 21 + bob * .3, 8, 1);
  ctx.fillStyle = '#101820'; ctx.fillRect(x + (d > 0 ? 1 : -2), y - 18 + bob * .3, 1, 1);
  // удочка
  const tip = { x: p.x + d * 11, y: p.y - 20 - Math.sin(p.rodA || 0) * 4 };
  ctx.strokeStyle = '#8b6b45'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(x + d * 2, y - 13 + bob * .3); ctx.lineTo(tip.x - cam.x, tip.y - cam.y); ctx.stroke();
  ctx.globalAlpha = 1;
  return tip;
}

function drawLine(tip) {
  if (F.state === 'idle' || F.state === 'charge') return;
  const bx = F.bx - cam.x, by = F.by - cam.y, tx = tip.x - cam.x, ty = tip.y - cam.y;
  const sag = F.state === 'fight' ? 4 - F.tension * 4 : 10;
  ctx.strokeStyle = `rgba(235,245,255,${F.state === 'fight' ? .55 + F.tension * .45 : .5})`;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tx, ty);
  ctx.quadraticCurveTo((tx + bx) / 2, Math.max(ty, by) + sag, bx, by); ctx.stroke();
  // поплавок
  ctx.fillStyle = '#e8503f'; ctx.fillRect(bx - 2, by - 3, 4, 3);
  ctx.fillStyle = '#f2f4f7'; ctx.fillRect(bx - 2, by, 4, 3);
  ctx.fillStyle = '#1b2434'; ctx.fillRect(bx - 1, by - 5, 1, 2);
  if (F.state === 'bite') {
    ctx.fillStyle = `rgba(255,225,120,${.6 + Math.sin(time * 22) * .4})`;
    ctx.fillRect(bx - 1, by - 20, 2, 7); ctx.fillRect(bx - 1, by - 11, 2, 2);
  }
}

function drawHudCanvas() {
  // индикатор замаха
  if (F.state === 'charge') {
    const x = me.x - cam.x - 14, y = me.y - cam.y - 32;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x, y, 28, 4);
    ctx.fillStyle = F.power > .92 ? '#ffcf6b' : '#8fd3ff'; ctx.fillRect(x + 1, y + 1, 26 * F.power, 2);
  }
  // вываживание
  if (F.state === 'fight') {
    const w = 120, x = (VIEW_W - w) / 2, y = VIEW_H - 42;
    ctx.fillStyle = 'rgba(6,12,20,.72)'; ctx.fillRect(x - 3, y - 12, w + 6, 30);
    // натяжение
    ctx.fillStyle = '#22303f'; ctx.fillRect(x, y, w, 6);
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#7ee0a0'); g.addColorStop(.6, '#ffd166'); g.addColorStop(1, '#ff5b4d');
    ctx.fillStyle = g; ctx.fillRect(x, y, w * clamp(F.tension, 0, 1), 6);
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(x + w * .78, y - 1, 1, 8);
    // прогресс
    ctx.fillStyle = '#22303f'; ctx.fillRect(x, y + 9, w, 4);
    ctx.fillStyle = '#8fd3ff'; ctx.fillRect(x, y + 9, w * clamp(1 - F.dist, 0, 1), 4);
    ctx.font = '7px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = F.tension > .8 ? '#ff8b7d' : '#9fb2c6';
    ctx.fillText(F.tension > .8 ? 'ОТПУСТИ!' : 'держи ЛКМ', VIEW_W / 2, y - 4);
    ctx.textAlign = 'left';
  }
  if (flash > 0) { ctx.fillStyle = `rgba(255,230,170,${flash * .35})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }

  // ночная затемняющая вуаль
  const t = dayT(), n = clamp((t > .52 ? (t - .52) / .12 : (.09 - t) / .09), 0, 1);
  if (n > 0) { ctx.fillStyle = `rgba(8,14,32,${n * .35})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }

  if (showBag) {
    const items = [...bag.entries()];
    const h = 14 + items.length * 9;
    ctx.fillStyle = 'rgba(6,12,20,.85)'; ctx.fillRect(10, 40, 150, Math.max(24, h));
    ctx.font = '7px monospace'; ctx.fillStyle = '#8fd3ff'; ctx.fillText('УЛОВ', 16, 51);
    ctx.fillStyle = '#cfd8e4';
    items.forEach(([k, v], i) => ctx.fillText(k + ' ×' + v, 16, 61 + i * 9));
    if (!items.length) { ctx.fillStyle = '#66707e'; ctx.fillText('пусто', 16, 61); }
  }
}

/* ─── мультиплеер (транспорт заменяемый) ───────────────────────────── */
const Net = {
  peers: new Map(), ch: null, last: 0,
  init() {
    try { this.ch = new BroadcastChannel('deepwater'); } catch (e) { return; }
    this.ch.onmessage = e => {
      const m = e.data; if (!m || m.id === me.id) return;
      if (m.type === 'bye') { this.peers.delete(m.id); return; }
      const p = this.peers.get(m.id) || { x: m.x, y: m.y, dir: 1, rodA: 0, walk: 0, onGround: true };
      p.tx = m.x; p.ty = m.y; p.dir = m.dir; p.name = m.name; p.rodA = m.rodA;
      p.fs = m.fs; p.bx = m.bx; p.by = m.by; p.seen = time;
      this.peers.set(m.id, p);
    };
    addEventListener('beforeunload', () => this.ch.postMessage({ type: 'bye', id: me.id }));
  },
  send() {
    if (!this.ch || time - this.last < .08) return; this.last = time;
    this.ch.postMessage({ id: me.id, name: me.name, x: me.x, y: me.y, dir: me.dir, rodA: me.rodA, fs: F.state, bx: F.bx, by: F.by });
  },
  update() {
    for (const [id, p] of this.peers) {
      if (time - p.seen > 5) { this.peers.delete(id); continue; }
      p.walk += Math.abs(p.tx - p.x) * .2;
      p.x = lerp(p.x, p.tx, .25); p.y = lerp(p.y, p.ty, .25);
    }
  },
  draw() {
    for (const p of this.peers.values()) {
      if (Math.abs(p.x - cam.x - VIEW_W / 2) > VIEW_W) continue;
      const tip = drawChar(p, true);
      if (p.fs && p.fs !== 'idle' && p.fs !== 'charge') {
        ctx.strokeStyle = 'rgba(220,235,250,.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(tip.x - cam.x, tip.y - cam.y);
        ctx.quadraticCurveTo((tip.x + p.bx) / 2 - cam.x, Math.max(tip.y, p.by) + 8 - cam.y, p.bx - cam.x, p.by - cam.y);
        ctx.stroke();
        ctx.fillStyle = '#e8503f'; ctx.fillRect(p.bx - cam.x - 2, p.by - cam.y - 3, 4, 5);
      }
      ctx.font = '7px monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(190,215,240,.75)';
      ctx.fillText(p.name || '???', p.x - cam.x, p.y - cam.y - 28);
      ctx.textAlign = 'left';
    }
  },
};
Net.init();

/* ─── HUD ───────────────────────────────────────────────────────────── */
const elTop = document.getElementById('top'), elLog = document.getElementById('log');
function logMsg(s, rar) {
  const d = document.createElement('div');
  d.className = 'r' + (rar < 0 ? 0 : rar); d.textContent = s;
  if (rar < 0) d.style.color = '#ff8b7d';
  elLog.prepend(d);
  while (elLog.children.length > 9) elLog.lastChild.remove();
  setTimeout(() => d.remove(), 12000);
}
function updateHud() {
  const t = dayT(), hh = String(Math.floor(((t * 24) + 6) % 24)).padStart(2, '0');
  const mm = String(Math.floor((((t * 24) + 6) % 1) * 60)).padStart(2, '0');
  const depth = F.state === 'idle' || F.state === 'charge' ? 0 : Math.round(waterDepthAt(F.bx));
  let caught = 0; for (const v of bag.values()) caught += v;
  elTop.innerHTML = `<b>${me.name}</b> <span class="dim">· ${hh}:${mm} ${isNight() ? '🌙' : '☀'}</span><br>`
    + `<span class="dim">улов: ${caught} · видов: ${bag.size}${depth ? ' · глубина: ' + (depth / TILE).toFixed(1) + ' м' : ''}`
    + (Net.peers.size ? ` · рядом: ${Net.peers.size}` : '') + `</span>`;
}

/* ─── цикл ──────────────────────────────────────────────────────────── */
let prev = performance.now();
function frame(now) {
  let dt = Math.min(.05, (now - prev) / 1000); prev = now; time += dt;
  const steps = 1;
  updatePlayer(dt); updateFishing(dt); updateFx(dt); updateAmbient(dt); updateCam();
  Net.update(); Net.send();

  drawSky();
  drawTiles();
  drawUnderwater();
  drawWater();
  for (const p of parts) { ctx.globalAlpha = clamp(p.l, 0, 1); ctx.fillStyle = p.c; ctx.fillRect(p.x - cam.x, p.y - cam.y, 2, 2); }
  ctx.globalAlpha = 1;
  Net.draw();
  const tip = drawChar(me, false);
  drawLine(tip);
  drawHudCanvas();
  updateHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
logMsg('Ты пришёл к воде. Забрось.', 2);
