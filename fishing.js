/* ══════════════════════════════════════════════════════════════
   🎣 ПОЙДЁМ К РЕКЕ — берег у Храма мироздания (экран новеллы)
   ──────────────────────────────────────────────────────────────
   Сервер: _fishing.sql + _fishing_temple.sql + _fishing_river.sql
   (fishing_get / fishing_cast / fishing_land / fishing_seed_*).
   Правда о добыче живёт ТОЛЬКО на сервере: клиент отыгрывает заброс, а
   «что клюнуло» узнаёт из fishing_cast и подтверждает исход в fishing_land.

   Место одно на всю галактику: мир генерируется детерминированно из id
   системы и pid тела, глубина — из паспорта берега.

   Два берега. На ближнем — мостки, с них ловят. Через реку не переплыть:
   вода глубокая и в ней тонут — на тот берег ходят НА ЛОДКЕ. Там поляна,
   на поляне старик; у него берут семечко мира, сажают рядом, и через сутки
   с дерева забирают ихор.

   Подсечка простая: клюнуло — успей нажать. Никакого вываживания.

   Сутки берега общие и считаются от эпохи (зеркало _fishing_night):
   30 минут цикл, 15 день / 15 ночь.
   ══════════════════════════════════════════════════════════════ */
'use strict';

/* ── мир ─────────────────────────────────────────────────────── */
const FISH_TILE = 16;
const FISH_VW = 480, FISH_VH = 270;      // логический кадр, дальше целочисленный зум
const FISH_W = 180, FISH_H = 132;        // берег в тайлах: два берега и омут между ними
const FISH_WATER_Y = 74;                 // урез воды

const FT_AIR = 0, FT_DIRT = 1, FT_GRASS = 2, FT_STONE = 3, FT_SAND = 4, FT_WOOD = 5, FT_LEAF = 6, FT_PLANK = 7;
// Настил мостков (7) в этот список НЕ входит: он платформа, а не стена —
// держит сверху, но пропускает снизу и сбоку (см. collide). Стеной он был
// ловушкой: упавший в воду упирался в него и оставался под мостками.
const FISH_SOLID = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 0, 6: 0, 7: 0 };

// Зеркало _fishing_site_depth(): глубина храмовой воды. Запасное значение —
// настоящую глубину всегда присылает сервер в паспорте берега.
const FISH_SITE_DEPTH = 48;
// Ключ храмовой палитры: берег один, поэтому это не «биом мира», а место.
const FISH_SITE_KEY = 'Храм мироздания';

// ТОТ БЕРЕГ. Поляна занимает левый край карты и нарочно ровная: на ней и
// сажают. Границы — зеркало проверки p_x в fishing_seed_plant (там только
// широкий диапазон, настоящая лунка выбирается здесь).
const FISH_MEADOW_X0 = 8, FISH_MEADOW_X1 = 46;
const FISH_MEADOW_Y = 66;          // высота поляны в тайлах (ровная площадка)
const FISH_NPC_X = 22;             // где сидит старик
// Радиус, на котором работает «E»: и лодка, и старик, и лунка. Два тайла —
// столько, чтобы с края мостков дотянуться до причаленной лодки.
const FISH_REACH = 34;

// Палитра берега. Мир формально землеподобный, но выглядит он как одно
// конкретное место: известняк, тёмная хвоя и очень глубокая стоячая вода.
const FISH_BIOME = {
  key: 'temple',
  water: ['rgba(86,150,166,.34)', 'rgba(6,26,44,.92)'],
  waterN: ['rgba(38,70,92,.40)', 'rgba(3,10,24,.95)'],
  ground: { 1: ['#57503f', '#48422f'], 2: ['#6a7a54', '#5a6947'], 3: ['#5a5a5f', '#4a4a4f'], 4: ['#d6cdae', '#bdb494'], 5: ['#5c4a38', '#4a3b2c'], 6: ['#2f5f4a', '#27523f'], 7: ['#6f5b41', '#5e4c36'] },
  grass: '#8a9a63', sandTop: '#e6ddbc',
};

/* ── мелочи ──────────────────────────────────────────────────── */
const fClamp = (v, a, b) => v < a ? a : v > b ? b : v;
const fLerp = (a, b, t) => a + (b - a) * t;
const fRnd = (a, b) => a + Math.random() * (b - a);

// Детерминированный шум с сидом: берег планеты всегда один и тот же.
function fHash(n, seed) { n = (n * 1103515245 + seed) | 0; n = (n << 13) ^ n; return 1 - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824; }
function fNoise(x, seed) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return fLerp(fHash(i, seed), fHash(i + 1, seed), u); }
function fFbm(x, seed) { let s = 0, a = .5, m = 1; for (let o = 0; o < 4; o++) { s += fNoise(x * m, seed) * a; a *= .5; m *= 2; } return s; }
function fSeedOf(str) { let h = 2166136261; for (let i = 0; i < (str || '').length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// Зеркало _fishing_night: цикл 30 минут, 15 день / 15 ночь, общий для всех.
function fishNightNow() { return Math.floor(Date.now() / 1000 / 900) % 2 === 1; }
function fishNightLeft() { return 900 - Math.floor(Date.now() / 1000) % 900; }

/* ══════════════════════════════════════════════════════════════
   ДВИЖОК БЕРЕГА
   ══════════════════════════════════════════════════════════════ */
function FishWorld(seed, maxDepth) {
  const map = new Uint8Array(FISH_W * FISH_H);
  const topH = new Int16Array(FISH_W);
  const wTop = new Int16Array(FISH_W).fill(-1);
  const wBot = new Int16Array(FISH_W).fill(-1);
  const tile = (x, y) => (x < 0 || y < 0 || x >= FISH_W || y >= FISH_H) ? FT_STONE : map[y * FISH_W + x];
  const setT = (x, y, v) => { if (x >= 0 && y >= 0 && x < FISH_W && y < FISH_H) map[y * FISH_W + x] = v; };

  // Глубина омута в ТАЙЛАХ подбирается так, чтобы дно = maxDepth метров.
  const deepT = Math.max(6, Math.round(maxDepth / 1.2));
  // Омут один и он КРУТОЙ: чаша обрывается почти сразу от отмели. Так глубина
  // становится вопросом заброса, а не заплыва — до дна добивает только
  // дальний бросок, а до бездны (48 м) лишь бросок на полной силе.
  const lakes = [{ x: 90, r: 34, d: deepT }];
  // Отмель: до этой глубины берег ещё «ходибельный», ниже — плывут, а не идут.
  const SHELF = 5, WALK_FLOOR = FISH_WATER_Y + SHELF;
  // Суша держится НЕВЫСОКО над урезом: это пологий берег, а не каньон.
  // Раньше суша стояла на 10-20 тайлов выше воды, и кромка чаши срезалась
  // отвесной стеной — упавший в воду обратно уже не выбирался.
  const groundH = x => {
    // Тот берег — ровная поляна: на бугристой земле не разглядеть ни лунок,
    // ни всходов, а весь смысл того берега в них.
    let h = x <= FISH_MEADOW_X1 + 6
      ? FISH_MEADOW_Y + fFbm(x * .05, seed) * .6
      : 69 + fFbm(x * .012, seed) * 3.5 + Math.sin(x * .031 + seed * .001) * 1.5;
    for (const L of lakes) {
      const d = Math.abs(x - L.x);
      // Без «+1»: дно ровно на L.d тайлов ниже уреза, иначе омут выходил
      // на метр глубже паспортных 48 м, и сервер молча срезал заявку.
      if (d < L.r) h = Math.max(h, FISH_WATER_Y + L.d * Math.cos(d / L.r * Math.PI / 2) ** 0.75);
    }
    return h;
  };
  for (let x = 0; x < FISH_W; x++) topH[x] = Math.round(groundH(x));
  // ЛАНДШАФТ. Там, где игрок ХОДИТ (суша и отмель), отвесных стен быть не
  // должно: перепад не больше тайла на колонку — ровно та ступенька, которую
  // берёт шаг. Два прохода превращают кромку чаши в лестницу с обеих сторон.
  // Обрыв в омут это не трогает: ниже отмели условие не выполняется, и стена
  // остаётся стеной — но там уже вода, из неё всплывают.
  for (let x = 1; x < FISH_W; x++) if (topH[x - 1] <= WALK_FLOOR) topH[x] = Math.max(topH[x], topH[x - 1] - 1);
  for (let x = FISH_W - 2; x >= 0; x--) if (topH[x + 1] <= WALK_FLOOR) topH[x] = Math.max(topH[x], topH[x + 1] - 1);
  for (let x = 0; x < FISH_W; x++) {
    const h = topH[x];
    for (let y = h; y < FISH_H; y++) {
      let t = FT_DIRT;
      if (y > h + 6 + fFbm(x * .05, seed) * 5) t = FT_STONE;
      if (y === h) t = (h > FISH_WATER_Y - 6) ? FT_SAND : FT_GRASS;   // песчаная полоса вдоль воды
      else if (y < h + 3 && h > FISH_WATER_Y - 4) t = FT_SAND;
      setT(x, y, t);
    }
  }
  // Деревья/торосы на суше — детерминированно от сида.
  for (let x = 6; x < FISH_W - 6; x++) {
    const h = topH[x];
    if (h > FISH_WATER_Y - 6) continue;
    if (x <= FISH_MEADOW_X1 + 4) continue;      // поляну не засаживаем: там растёт своё
    if (fHash(x, seed ^ 0x9e37) < 0.90) continue;
    const hh = 5 + ((fHash(x, seed ^ 0x51ed) * 5 + 5) | 0) % 5;
    for (let i = 1; i <= hh; i++) setT(x, h - i, FT_WOOD);
    const cy = h - hh;
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 1; dy++)
      if (dx * dx + dy * dy * 1.4 < 6.2 && tile(x + dx, cy + dy) === FT_AIR) setT(x + dx, cy + dy, FT_LEAF);
  }
  // Мостки — единственное рукотворное место на берегу, с них и ловят.
  // Настил лежит на три тайла выше уреза, со стороны суши к нему приставлена
  // одна ступень, а сваи стоят только НАД водой: столб, опущенный в воду,
  // разорвал бы столбец глубины (кэш ниже читает колонку от уреза вниз).
  let edge = -1;
  for (let x = lakes[0].x; x < FISH_W - 14; x++) if (topH[x] < FISH_WATER_Y) { edge = x; break; }
  if (edge > 12) {
    // Настил — ровно на два тайла выше уреза: с берега на него шаг, из воды
    // выпрыгивают (см. hop в updatePlayer), а под ним остаётся просвет, чтобы
    // из-под мостков можно было выбрести по отмели. Высокий настил был
    // ловушкой: упавший в воду упирался в него снизу.
    const deckY = FISH_WATER_Y - 2;
    for (let i = 1; i <= 10; i++) {
      const x = edge - i;
      setT(x, deckY, FT_PLANK);
      // Сваи — только НАД водой и НЕ у берегового конца: свая, поставленная
      // в первую же колонку, замуровывала вход на мостки (настил над ней —
      // шагнуть некуда).
      if (i % 3 === 0) setT(x, deckY + 1, FT_PLANK);
    }
  }
  for (let x = 0; x < FISH_W; x++) {
    if (tile(x, FISH_WATER_Y) !== FT_AIR) continue;
    let b = FISH_WATER_Y;
    while (b < FISH_H && tile(x, b) === FT_AIR) b++;
    wTop[x] = FISH_WATER_Y; wBot[x] = b;
  }
  // Старт — сухой берег у самых мостков: спустился к воде и сразу видишь,
  // куда идти. Запасной вариант нужен, только если берег вырожденный.
  let spawn = 20;
  if (edge > 0) spawn = Math.min(edge + 3, FISH_W - 4);
  else for (let x = lakes[0].x; x < FISH_W - 20; x++) if (topH[x] < FISH_WATER_Y - 2) { spawn = x + 3; break; }

  // Сухой берег ближе всего к колонке x — сюда выбрасывает вымокшего и сюда
  // же сходят с лодки. Ищем в обе стороны, чтобы работало с любого берега.
  const dryNear = x => {
    for (let d = 0; d < FISH_W; d++) {
      if (x - d >= 0 && topH[x - d] < FISH_WATER_Y - 1) return x - d;
      if (x + d < FISH_W && topH[x + d] < FISH_WATER_Y - 1) return x + d;
    }
    return spawn;
  };

  // Ближайший БЕРЕГ — колонка, где воды нет вовсе (урез упирается в грунт).
  // Именно к ней прижимается нос лодки, и именно на неё сходят. Отличается от
  // dryNear: та ищет сушу «повыше уреза», а у пологого берега такая находится
  // за десяток тайлов от воды — из-за этого сойти на берег было нельзя даже
  // вплотную к нему.
  const bankNear = x => {
    for (let d = 0; d < FISH_W; d++) {
      if (x - d >= 0 && wTop[x - d] < 0) return x - d;
      if (x + d < FISH_W && wTop[x + d] < 0) return x + d;
    }
    return spawn;
  };

  return {
    tile, topH, wTop, wBot, spawn, dryNear, bankNear, biome: FISH_BIOME, maxDepth, lakes, seed,
    solid: (x, y) => !!FISH_SOLID[tile(x, y)],
    plank: (x, y) => tile(x, y) === FT_PLANK,
    water: (x, y) => y >= FISH_WATER_Y && tile(x, y) === FT_AIR && y < FISH_H,
    // Глубина в МЕТРАХ под точкой — её мы и заявляем серверу (он её зажмёт).
    depthM: px => {
      const tx = px / FISH_TILE | 0;
      if (tx < 0 || tx >= FISH_W || wTop[tx] < 0) return 0;
      return Math.round((wBot[tx] - wTop[tx]) * 1.2);
    },
  };
}

/* ── состояние экрана ───────────────────────────────────────── */
let _fish = null;          // активная сессия (движок + петля)
let _fishState = null;     // последний ответ fishing_get()
let _fishSite = null;      // паспорт берега из _fishing_site() {sys,pid,name,maxdepth,owner_name,…}
let _fishFit = null;       // текущий обработчик resize канваса (снимается вместе с игрой)
let _fishKick = null;      // снятие «добора» звука на первом жесте

// Флаг державы, с которым игрок ходит по берегу: цвет фракции + герб картинкой.
// Держим отдельным объектом, чтобы рендер каждого кадра не лез в EC и не ждал
// картинку: пока герб грузится, полотнище просто одноцветное.
const _fishFlag = { col: '#6f8bb5', img: null, fid: null };
function fishFlagLoad() {
  const hasEC = (typeof EC === 'object' && EC) ? EC : null;
  const app = hasEC && EC.app;
  const fac = (hasEC && typeof ecFacOf === 'function' && EC.fid) ? ecFacOf(EC.fid) : null;
  const col = (app && app.color) || (fac && fac.color) || '#6f8bb5';
  const url = (app && (app.herald_url || app.image_url)) || (fac && fac.herald_url) || '';
  _fishFlag.col = col;
  _fishFlag.fid = (hasEC && EC.fid) || null;
  if (!url) { _fishFlag.img = null; return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';   // герб лежит в Storage: без этого канвас «пачкается»
  img.onerror = () => { if (_fishFlag.img === img) _fishFlag.img = null; };
  img.src = url;
  _fishFlag.img = img;
}

/* ══════════════════════════════════════════════════════════════
   БЕРЕГ ОБЩИЙ: соседи через Realtime
   ──────────────────────────────────────────────────────────────
   Место одно на всю галактику, поэтому и канал один: кто зашёл к воде —
   тот и на берегу, все одновременно, без комнат и очередей.

   Два разных потока, нарочно:
     • presence — КТО пришёл (имя державы, цвет, герб) и кто ушёл. Состояние,
       а не событие: подключившийся получает всех уже стоящих у воды сразу,
       без «поздоровайся первым».
     • broadcast 'm' — ГДЕ он сейчас. Поток координат 10 раз в секунду, без
       истории: опоздал пакет — ничего страшного, следующий уже в пути.

   Движение чужих силуэтов сглаживаем интерполяцией (см. tick): по сети
   приходят редкие точки, а рисуем мы 60 кадров, и без догона сосед дёргался бы.
   Правды об улове здесь нет и быть не может — она только на сервере.
   ══════════════════════════════════════════════════════════════ */
const FISH_NET_HZ = 100;          // как часто шлём себя, мс
const FISH_NET_IDLE = 1500;       // молчим стоя, но не дольше этого (пакет-«живой»)
const FISH_NET_DROP = 20000;      // сосед замолчал дольше — убираем силуэт

const FishNet = {
  ch: null, peers: new Map(), key: null, joined: false, timer: 0, last: null, lastT: 0,
  imgs: new Map(),               // герб по url: одна картинка на всех соседей с ней

  start() {
    if (this.ch || typeof sb === 'undefined' || !sb) return;
    this.key = (typeof user !== 'undefined' && user && user.id) || ('guest-' + Math.random().toString(36).slice(2));
    this._open();
    this.timer = setInterval(() => this._send(), FISH_NET_HZ);
  },

  stop() {
    clearInterval(this.timer); this.timer = 0;
    clearTimeout(this.retryT); this.retryT = 0;
    if (this.ch) { try { sb.removeChannel(this.ch); } catch (e) {} }
    this.ch = null; this.joined = false; this.last = null;
    this.peers.clear();
  },

  _open() {
    const ch = sb.channel('fishing-shore', {
      config: { broadcast: { self: false }, presence: { key: this.key } },
    });
    this.ch = ch;
    ch.on('broadcast', { event: 'm' }, ({ payload }) => this._move(payload))
      .on('presence', { event: 'sync' }, () => this._sync())
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          this.joined = true;
          try { await ch.track(this._card()); } catch (e) {}
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // Канал после CLOSED сам не оживает (та же грабля, что в чате):
          // пересобираем, пока игрок на берегу.
          this.joined = false;
          if (!this.retryT && this.timer) this.retryT = setTimeout(() => {
            this.retryT = 0;
            try { sb.removeChannel(this.ch); } catch (e) {}
            this.ch = null;
            if (this.timer) this._open();
          }, 3000);
        }
      });
  },

  // Визитка для presence: под каким флагом человек пришёл к воде.
  _card() {
    const hasEC = (typeof EC === 'object' && EC) ? EC : null;
    const app = hasEC && EC.app;
    const fac = (hasEC && typeof ecFacOf === 'function' && EC.fid) ? ecFacOf(EC.fid) : null;
    return {
      n: String((app && app.name) || (fac && fac.name) || 'Странник').slice(0, 40),
      c: _fishFlag.col,
      h: String((app && (app.herald_url || app.image_url)) || (fac && fac.herald_url) || '').slice(0, 300),
    };
  },

  _img(url) {
    if (!url) return null;
    let img = this.imgs.get(url);
    if (img !== undefined) return img;
    img = new Image();
    img.crossOrigin = 'anonymous';           // герб из Storage: иначе канвас «пачкается»
    img.onerror = () => this.imgs.set(url, null);
    img.src = url;
    this.imgs.set(url, img);
    return img;
  },

  // Кто у воды. Присутствие — источник правды по составу: не пришедшего в
  // presence соседа рисовать нечем (нет ни имени, ни флага), а ушедшего надо
  // убрать сразу, не дожидаясь таймаута молчания.
  _sync() {
    if (!this.ch) return;
    let st = {};
    try { st = this.ch.presenceState() || {}; } catch (e) { return; }
    const was = this.peers.size;
    const live = new Set();
    for (const k of Object.keys(st)) {
      if (k === this.key) continue;
      live.add(k);
      const card = (st[k] && st[k][0]) || {};
      const p = this._peer(k);
      p.name = String(card.n || 'Странник').slice(0, 40);
      p.flagCol = /^#[0-9a-fA-F]{3,8}$/.test(card.c || '') ? card.c : '#6f8bb5';
      p.flagImg = this._img(card.h);
    }
    for (const k of [...this.peers.keys()]) if (!live.has(k)) this.peers.delete(k);
    if (this.peers.size !== was) this._hud();
  },

  // Счётчик «у воды» живёт в шапке — она перерисовывается по событиям, а не
  // каждый кадр, поэтому смену состава подталкиваем руками.
  _hud() { try { fishPaintHud(); } catch (e) {} },

  // Силуэт соседа. Держим ОДИН объект на человека и правим его поля: рендер
  // и интерполяция опираются на то, что объект между кадрами не подменяется.
  _peer(k) {
    let p = this.peers.get(k);
    if (!p) {
      p = {
        k, name: '', flagCol: '#6f8bb5', flagImg: null,
        x: 0, y: 0, tx: 0, ty: 0, dir: 1, vx: 0, walk: 0, onGround: true, rodA: 0,
        boat: { x: 0, y: 0, tx: 0, ty: 0, ride: false, row: 0, tilt: 0 },
        line: { state: 'idle', bx: 0, by: 0 },
        at: 0, seen: false,
      };
      this.peers.set(k, p);
    }
    return p;
  },

  _move(m) {
    if (!m || !m.k || m.k === this.key) return;
    const p = this._peer(m.k);
    p.tx = Number(m.x) || 0; p.ty = Number(m.y) || 0;
    p.dir = m.d < 0 ? -1 : 1;
    p.onGround = m.g !== 0;
    p.rodA = Number(m.ra) || 0;
    p.line.state = String(m.fs || 'idle');
    p.line.bx = Number(m.fx) || 0; p.line.by = Number(m.fy) || 0;
    p.boat.ride = !!m.r;
    if (p.boat.ride) {
      p.boat.tx = Number(m.bx) || 0; p.boat.ty = Number(m.by) || 0;
      p.boat.tilt = Number(m.bt) || 0; p.boat.row = Number(m.br) || 0;
    }
    p.at = Date.now();
    // Первый пакет — ставим силуэт на место, а не тащим его через всю карту.
    if (!p.seen) { p.seen = true; p.x = p.tx; p.y = p.ty; p.boat.x = p.boat.tx; p.boat.y = p.boat.ty; }
  },

  // Догон между пакетами. Скорость (vx) не присылаем, а берём из самого
  // догона: ею анимация решает, шагает сосед или стоит.
  tick(dt) {
    const now = Date.now(), k = Math.min(1, dt * 12);
    for (const [key, p] of this.peers) {
      if (p.at && now - p.at > FISH_NET_DROP) { this.peers.delete(key); this._hud(); continue; }
      const dx = p.tx - p.x;
      p.x += dx * k; p.y += (p.ty - p.y) * k;
      p.vx = dt > 0 ? dx * k / dt / FISH_TILE * 2 : 0;
      if (Math.abs(dx) > .5) p.walk += dt * Math.min(14, Math.abs(dx) * 1.6 + 5);
      p.boat.x += (p.boat.tx - p.boat.x) * k;
      p.boat.y += (p.boat.ty - p.boat.y) * k;
    }
  },

  // Себя шлём только когда есть что сказать: стоящий у воды не должен
  // забивать канал шестьюстами пакетами в минуту.
  _send() {
    const S = _fish;
    if (!S || !S.alive || !this.joined || !this.ch) return;
    const me = S.me, F = S.F, b = S.boat;
    const m = {
      k: this.key,
      x: Math.round(me.x * 2) / 2, y: Math.round(me.y * 2) / 2,
      d: me.dir, g: me.onGround ? 1 : 0, ra: Math.round(me.rodA * 100) / 100,
      fs: F.state, fx: Math.round(F.bx), fy: Math.round(F.by),
      r: b.ride ? 1 : 0,
    };
    if (b.ride) {
      m.bx = Math.round(b.x * 2) / 2; m.by = Math.round(b.y * 2) / 2;
      m.bt = Math.round(b.tilt * 100) / 100; m.br = Math.round(b.row * 20) / 20;
    }
    const sig = JSON.stringify(m), now = Date.now();
    if (sig === this.last && now - this.lastT < FISH_NET_IDLE) return;
    this.last = sig; this.lastT = now;
    try { this.ch.send({ type: 'broadcast', event: 'm', payload: m }); } catch (e) {}
  },
};

/* ══════════════════════════════════════════════════════════════
   ЗВУК БЕРЕГА
   ──────────────────────────────────────────────────────────────
   Ни одного файла: всё синтезируется на месте. Берегу нужны плеск,
   поплавок, ветер и пара сигналов — на них хватает осциллятора и
   шумового буфера, а мегабайты mp3 на статике стоили бы дороже всей
   рыбалки (см. заметку про egress).
   Контекст рождается ТОЛЬКО из жеста игрока: браузер иначе держит его
   suspended, и первый же плеск уходит в тишину.
   ══════════════════════════════════════════════════════════════ */
const FishSfx = {
  ctx: null, master: null, buf: null,
  amb: null, ambG: null, ambF: null, ambLvl: 0,
  on: (() => { try { return localStorage.getItem('fish_mute') !== '1'; } catch (e) { return true; } })(),

  wake() {
    if (!this.on) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.on = false; return null; }
      try { this.ctx = new AC(); } catch (e) { this.on = false; return null; }
      this.master = this.ctx.createGain();
      this.master.gain.value = .5;
      this.master.connect(this.ctx.destination);
      // Две секунды белого шума — из него делается всё мокрое и ветреное.
      const n = this.ctx.sampleRate * 2;
      this.buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} }
    return this.ctx;
  },

  // Тон: коротая нота с горкой громкости. f2 — куда съезжает высота.
  tone(f, dur, vol, type, f2, delay) {
    const c = this.wake(); if (!c) return;
    const t = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(.02, dur * .3));
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + .02);
  },

  // Шумовой всплеск через полосовой фильтр: плеск, шелест, свист заброса.
  noise(dur, f, q, vol, f2, delay) {
    const c = this.wake(); if (!c) return;
    const t = c.currentTime + (delay || 0);
    const s = c.createBufferSource(); s.buffer = this.buf; s.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.setValueAtTime(f, t); bp.Q.value = q || 1;
    if (f2) bp.frequency.exponentialRampToValueAtTime(Math.max(40, f2), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(.03, dur * .25));
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(bp); bp.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur + .02);
  },

  /* ── голоса берега ── */
  splash(big) { const s = big ? 1 : .55; this.noise(.16 * s + .12, 1500, .7, .30 * s, 320); this.tone(300, .12, .06 * s, 'sine', 140); },
  plop()      { this.tone(520, .10, .10, 'sine', 210); this.noise(.07, 1800, 2, .07, 900); },
  cast()      { this.noise(.24, 2600, .9, .16, 500); },
  reel()      { this.noise(.18, 900, 3, .10, 1600); },
  // Клюнуло — единственный звук, который обязан выдернуть игрока из мыслей.
  bite()      { for (let i = 0; i < 3; i++) this.tone(i === 2 ? 1180 : 880, .09, .13, 'triangle', null, i * .1); this.splash(false); },
  // Улов: чем реже, тем выше и длиннее лесенка.
  win(rar)    { const b = [523, 659, 784, 988, 1319], n = 2 + Math.min(3, rar || 0); for (let i = 0; i < n; i++) this.tone(b[i], .18, .11, 'triangle', null, i * .085); },
  lose()      { this.tone(300, .16, .10, 'sine', 170); this.tone(200, .22, .07, 'sine', 120, .1); },
  jump()      { this.tone(320, .09, .07, 'square', 520); },
  land()      { this.noise(.07, 300, 1.5, .07); },
  row()       { this.noise(.20, 700, .8, .09, 250); },
  ui()        { this.tone(660, .05, .06, 'square'); },
  bad()       { this.tone(220, .18, .09, 'sawtooth', 150); },

  /* ── фон: вода и ветер ──
     Один шумовой слой на всё время игры; громкость ведёт игра — чем ближе
     к воде, тем слышнее. Ночью тише и глуше: берег засыпает. */
  ambStart() {
    const c = this.wake(); if (!c || this.amb) return;
    this.amb = c.createBufferSource(); this.amb.buffer = this.buf; this.amb.loop = true;
    this.ambF = c.createBiquadFilter(); this.ambF.type = 'lowpass';
    this.ambF.frequency.value = 620; this.ambF.Q.value = .7;
    this.ambG = c.createGain(); this.ambG.gain.value = 0;
    // Медленный «прибой»: волна дышит сама по себе, без участия кадра.
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = .13; lg.gain.value = .35;
    lfo.connect(lg); lg.connect(this.ambG.gain);
    this.amb.connect(this.ambF); this.ambF.connect(this.ambG); this.ambG.connect(this.master);
    this.amb.start(); lfo.start();
    this.ambLfo = lfo;
  },
  // lvl 0..1 — близость к воде; night приглушает верх.
  ambSet(lvl, night) {
    if (!this.ambG || !this.ctx) return;
    const v = fClamp(lvl, 0, 1) * (night ? .06 : .085);
    this.ambG.gain.setTargetAtTime(v, this.ctx.currentTime, .4);
    this.ambF.frequency.setTargetAtTime(night ? 420 : 700, this.ctx.currentTime, .8);
  },
  ambStop() {
    try { if (this.amb) this.amb.stop(); } catch (e) {}
    try { if (this.ambLfo) this.ambLfo.stop(); } catch (e) {}
    this.amb = null; this.ambLfo = null; this.ambG = null; this.ambF = null;
  },

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('fish_mute', this.on ? '0' : '1'); } catch (e) {}
    if (!this.on) { this.ambStop(); if (this.master) this.master.gain.value = 0; }
    else { if (this.master) this.master.gain.value = .5; this.wake(); this.ambStart(); this.ui(); }
    return this.on;
  },
};
// Кнопка в шапке берега.
function fishSoundToggle() {
  const on = FishSfx.toggle();
  const b = document.getElementById('fish-snd');
  if (b) { b.textContent = on ? '🔊' : '🔇'; b.title = on ? 'звук включён' : 'звук выключен'; }
}

/* ── экран пальцем ───────────────────────────────────────────────
   Тач определяем по грубому указателю, а не по ширине: планшет с
   клавиатурой ведёт себя как десктоп, а телефон в альбоме — нет. */
const fishTouch = () => (matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window);

/* ══════════════════════════════════════════════════════════════
   ИГРА
   ══════════════════════════════════════════════════════════════ */
function fishStart(canvas, world) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.lineJoin = ctx.lineCap = 'round';
  let PX = 1;                       // множитель буфера: логический пиксель → пиксель экрана
  // Логический кадр — НЕ константа: его форму задаёт экран (см. fit() ниже),
  // поэтому весь рендер читает VW/VH, а FISH_VW/FISH_VH остаются лишь
  // проектным размером «по умолчанию».
  let VW = Number(canvas.dataset.vw) || FISH_VW, VH = Number(canvas.dataset.vh) || FISH_VH;

  const S = {
    ctx, canvas, world, alive: true, time: 0, raf: 0,
    keys: {}, mouse: { x: VW / 2, y: VH / 2, down: false, pressed: false },
    cam: { x: 0, y: 0 },
    me: { x: world.spawn * FISH_TILE, y: (world.topH[world.spawn] - 4) * FISH_TILE, vx: 0, vy: 0, w: 8, h: 18, dir: 1, onGround: false, walk: 0, rodA: 0 },
    F: { state: 'idle', power: 0, t: 0, bx: 0, by: 0, bvx: 0, bvy: 0, floatT: 0, biteAt: 0, nibbleAt: 0, react: 1.1, id: null, depth: 0, busy: false },
    // Лодка у каждого своя и появляется по «E» у воды: одна общая плоскодонка
    // на весь берег означала бы очередь и «кто-то угнал лодку на тот берег».
    // Пока в ней не сидят — её просто нет.
    // row — фаза гребка (по ней ходят весло и корпус), tilt — крен по волне.
    boat: { x: 0, y: 0, vx: 0, ride: false, row: 0, tilt: 0 },
    wet: 0,                       // сколько секунд игрок бултыхается в воде
    parts: [], ripples: [], bubbles: [], ambient: [], flash: 0, msg: '', msgT: 0,
    hint: '', busyE: false,
  };
  for (const L of world.lakes) for (let i = 0; i < 16; i++) {
    const x = L.x * FISH_TILE + fRnd(-L.r, L.r) * FISH_TILE * .55;
    S.ambient.push({ x, y: (FISH_WATER_Y + fRnd(3, Math.max(4, L.d * .8))) * FISH_TILE, vx: fRnd(.2, .5) * (Math.random() < .5 ? -1 : 1), s: fRnd(.7, 1.5), p: fRnd(0, 9) });
  }

  /* ── ввод ── */
  const scale = () => Number(canvas.dataset.scale || 1);
  S.onKeyDown = e => {
    if (!S.alive) return;
    if (e.code === 'Escape') { fishPaintSite(); return; }
    if (e.code === 'KeyE') { e.preventDefault(); doAction(); return; }
    S.keys[e.code] = 1;
    if (['Space', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  };
  S.onKeyUp = e => { S.keys[e.code] = 0; };
  // Указатель, а не мышь: тот же код тянет и палец на планшете.
  S.onMove = e => { const r = canvas.getBoundingClientRect(); S.mouse.x = (e.clientX - r.left) / scale(); S.mouse.y = (e.clientY - r.top) / scale(); };
  // Первый тык по берегу — он же разрешение на звук: контекст можно поднять
  // только из жеста, до него любой плеск ушёл бы в тишину.
  S.onDown = e => { if (e.button === 0) { FishSfx.wake(); FishSfx.ambStart(); S.onMove(e); S.mouse.down = true; S.mouse.pressed = true; e.preventDefault(); } };
  S.onUp = e => { if (e.button === 0) S.mouse.down = false; };
  addEventListener('keydown', S.onKeyDown); addEventListener('keyup', S.onKeyUp);
  canvas.addEventListener('pointermove', S.onMove);
  canvas.addEventListener('pointerdown', S.onDown);
  addEventListener('pointerup', S.onUp);
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  /* ── физика игрока ── */
  const rangeX = p => [Math.floor((p.x - p.w / 2) / FISH_TILE), Math.floor((p.x + p.w / 2 - .01) / FISH_TILE)];
  const rangeY = p => [Math.floor((p.y - p.h) / FISH_TILE), Math.floor((p.y - .01) / FISH_TILE)];
  function collide(p) {
    if (p.vx) {
      p.x += p.vx;
      let [x0, x1] = rangeX(p), [y0, y1] = rangeY(p), hit = null;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (!world.solid(x, y)) continue;
        // Ступенька в один тайл берётся шагом. В воде — тоже: иначе бредущий
        // по отмели упирался в неё, хотя по берегу такую же перешагивает.
        if (y === y1 && !world.solid(x, y - 1) && !world.solid(x, y - 2) && (p.onGround || p.inWater)) continue;
        if (hit === null || (p.vx > 0 ? x < hit : x > hit)) hit = x;
      }
      if (hit !== null) { p.x = p.vx > 0 ? hit * FISH_TILE - p.w / 2 - .01 : (hit + 1) * FISH_TILE + p.w / 2 + .01; p.vx = 0; }
      else { [y0, y1] = rangeY(p);[x0, x1] = rangeX(p); for (let x = x0; x <= x1; x++) if (world.solid(x, y1)) { p.y = y1 * FISH_TILE - .01; break; } }
    }
    p.y += p.vy; p.onGround = false;
    if (p.vy) {
      const [x0, x1] = rangeX(p), [y0, y1] = rangeY(p);
      let hit = null;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (!world.solid(x, y)) continue;
        if (hit === null || (p.vy > 0 ? y < hit : y > hit)) hit = y;
      }
      // Настил мостков ловит только ПАДАЮЩЕГО и только если ноги были выше
      // доски: снизу сквозь него всплывают, сбоку он не стена вовсе.
      if (p.vy > 0) for (let y = Math.floor((p.y - p.vy - .01) / FISH_TILE); y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (y < 0 || !world.plank(x, y) || p.y - p.vy > y * FISH_TILE) continue;
          if (hit === null || y < hit) hit = y;
        }
      if (hit !== null) { if (p.vy > 0) { p.y = hit * FISH_TILE - .01; p.onGround = true; } else p.y = (hit + 1) * FISH_TILE + p.h + .01; p.vy = 0; }
    }
  }
  const t2 = v => Math.floor(v / FISH_TILE);
  // Выбросить на сушу: вымок или сошёл с лодки. Берег — ближайшая безводная
  // колонка, а не «сухой холм»: у пологого берега холм за десяток тайлов, и
  // выброс туда выглядел телепортом.
  function ashore(atX, msg) {
    const tx = world.bankNear(t2(atX));
    S.me.x = tx * FISH_TILE + FISH_TILE / 2;
    S.me.y = (world.topH[tx] - 1) * FISH_TILE;
    S.me.vx = 0; S.me.vy = 0; S.wet = 0;
    if (msg) say(msg, 3);
  }

  function updatePlayer(dt) {
    const me = S.me;
    // В лодке физики нет: игрок — пассажир, его несёт корпус.
    if (S.boat.ride) {
      me.x = S.boat.x; me.y = S.boat.y - 3; me.vx = 0; me.vy = 0;
      me.inWater = false; me.onGround = true; S.wet = 0;
      return;
    }
    const inW = world.water(t2(me.x), t2(me.y - 4));
    me.inWater = inW;
    const acc = inW ? .18 : (me.onGround ? .9 : .45), maxv = inW ? .55 : 2.1;
    let mv = 0;
    if (S.keys.KeyA || S.keys.ArrowLeft) mv--;
    if (S.keys.KeyD || S.keys.ArrowRight) mv++;
    if (mv) { me.vx = fClamp(me.vx + mv * acc, -maxv, maxv); me.dir = mv; me.walk += Math.abs(me.vx) * .18; }
    else me.vx *= me.onGround ? .72 : .93;
    // Прыгать МОЖНО только по земле. Раньше из воды выпрыгивали на уступ, и
    // река превращалась в дорожку из прыжков — тот берег доставался даром.
    if (S.keys.Space && me.onGround && !inW) { me.vy = -4.15; FishSfx.jump(); }
    const wasAir = !me.onGround;
    me.vy += inW ? .1 : .28;
    if (inW) {
      me.vy = fClamp(me.vy, -.3, 1.5); me.vx *= .93;
      if (Math.random() < .1) S.bubbles.push({ x: me.x, y: me.y - 10, l: 1, r: fRnd(.6, 1.6), vx: fRnd(-.15, .15) });
      // Долго барахтаться нечем: течение выносит обратно на сушу.
      S.wet += dt;
      if (S.wet > 2.2) { fishReset(S.F); FishSfx.splash(true); ashore(me.x, 'Вымок. Реку переходят на лодке.'); }
    } else { me.vy = Math.min(me.vy, 9); S.wet = 0; }
    const fall = me.vy;
    collide(me);
    // Приземление слышно только если и правда падал: шаги по земле молчат.
    if (wasAir && me.onGround && fall > 2.4) FishSfx.land();
    if (me.y > FISH_H * FISH_TILE) ashore(world.spawn * FISH_TILE, '');
  }

  // ── ЛОДКА ──
  // Ходит только по воде и только пока в ней сидят. У берега упирается носом
  // в сушу — дальше сходят пешком (E).
  function updateBoat(dt) {
    const b = S.boat;
    const surf = () => FISH_WATER_Y * FISH_TILE + waveAt(b.x, S.time) - 4;
    if (b.ride) {
      let mv = 0;
      if (S.keys.KeyA || S.keys.ArrowLeft) mv--;
      if (S.keys.KeyD || S.keys.ArrowRight) mv++;
      if (mv) { b.vx = fClamp(b.vx + mv * .12, -1.9, 1.9); S.me.dir = mv; }
      else b.vx *= .94;
      const nx = b.x + b.vx, ntx = t2(nx);
      // Нос упёрся в берег — стоим. Вода здесь есть только там, где wTop >= 0.
      if (ntx < 1 || ntx >= FISH_W - 1 || world.wTop[ntx] < 0) b.vx = 0;
      else b.x = nx;
      if (Math.abs(b.vx) > .3 && Math.random() < .5) ripple(b.x, .35);
    } else b.vx *= .9;
    b.y = fLerp(b.y, surf(), .25);
    // Гребок: чем быстрее идём, тем чаще машет весло. Стоя на месте гребец не
    // застывает — весло лениво водит по воде, лодку покачивает.
    b.row += dt * (1.1 + Math.abs(b.vx) * 3.4);
    // Крен — наклон самой волны под корпусом плюс собственная качка.
    const sl = (waveAt(b.x + 12, S.time) - waveAt(b.x - 12, S.time)) / 24;
    b.tilt = fLerp(b.tilt, sl + Math.sin(S.time * 1.5) * .022 - b.vx * .02, .18);
    // Бурун от вёсел: капли и круги там, где лопасть входит в воду.
    if (b.ride && Math.abs(b.vx) > .35 && Math.sin(b.row * 2) > .96) {
      splash(b.x - b.vx * 9, b.y + 4, 3, .5);
      FishSfx.row();
    }
  }

  // Ближайшая водная колонка к x (в тайлах) — не дальше 5 тайлов. null, если
  // воды рядом нет: лодку не спускают посреди поляны.
  function waterNear(tx) {
    for (let d = 0; d <= 5; d++) {
      if (tx - d >= 0 && world.wTop[tx - d] >= 0) return tx - d;
      if (tx + d < FISH_W && world.wTop[tx + d] >= 0) return tx + d;
    }
    return null;
  }

  // Ближайшая точка интереса под «E». Возвращает {kind, …} или null.
  function nearAction() {
    const me = S.me, mx = me.x, tx = t2(mx);
    if (S.boat.ride) {
      // Подсказку даём, только когда сход РЕАЛЬНО возможен: doAction требует
      // берег в трёх тайлах, а надпись висела посреди омута и врала.
      const bx = t2(S.boat.x), bank = world.bankNear(bx);
      return (Math.abs(bank - bx) > 3) ? null : { kind: 'off', txt: 'E — сойти на берег' };
    }
    // Своя лодка спускается на воду там, где стоишь: нужна только вода рядом.
    if (me.onGround && waterNear(tx) !== null) return { kind: 'boat', txt: 'E — спустить лодку' };
    if (Math.abs(FISH_NPC_X * FISH_TILE - mx) < FISH_REACH)
      return { kind: 'npc', txt: 'E — заговорить' };
    // Всходы: своё созревшее забирают, чужое просто подписано.
    for (const p of (_fishState && _fishState.plants) || []) {
      if (Math.abs(p.x - tx) > 1) continue;
      if (p.mine && p.ready) return { kind: 'take', id: p.id, txt: 'E — забрать ихор' };
      return { kind: 'look', txt: p.mine ? (p.ready ? '' : 'оно растёт... ' + fishLeft(p.left)) : 'дерево: ' + (p.who || 'чужое') };
    }
    if (_fishState && _fishState.seed > 0 && tx >= FISH_MEADOW_X0 && tx <= FISH_MEADOW_X1
        && me.onGround && world.topH[tx] < FISH_WATER_Y)
      return { kind: 'plant', x: tx, txt: 'E — посадить семечко' };
    return null;
  }

  async function doAction() {
    const a = nearAction();
    if (!a || S.busyE) return;
    if (a.kind === 'boat') {
      const wx = waterNear(t2(S.me.x));
      if (wx === null) return;
      S.boat.x = wx * FISH_TILE + FISH_TILE / 2;
      S.boat.y = FISH_WATER_Y * FISH_TILE;
      S.boat.vx = 0; S.boat.ride = true;
      splash(S.boat.x, FISH_WATER_Y * FISH_TILE, 8, 1); ripple(S.boat.x, 1); FishSfx.splash(true);
      fishReset(S.F); say('', 0); return;
    }
    if (a.kind === 'off') {
      // Сходят там, где нос упёрся в грунт: лодка встаёт ровно у последней
      // водной колонки, поэтому берег всегда в одном-двух тайлах.
      const tx = t2(S.boat.x), bank = world.bankNear(tx);
      if (Math.abs(bank - tx) > 3) { say('Подгреби ближе к берегу', 2.5); return; }
      S.boat.ride = false; S.boat.vx = 0;      // сошёл — лодка уходит вместе с ним
      ashore(bank * FISH_TILE, ''); return;
    }
    if (a.kind === 'npc') { fishNpcOpen(); return; }
    S.busyE = true;
    try {
      if (a.kind === 'plant') {
        await ecRpc('fishing_seed_plant', { p_x: a.x });
        FishSfx.ui();
        say('Посадил. Взойдёт через сутки.', 3.5);
        await fishReload();
      } else if (a.kind === 'take') {
        const r = await ecRpc('fishing_seed_take', { p_id: a.id });
        say('+' + Math.round((r && r.ichor) || 10) + ' ихора', 4);
        S.flash = 1; FishSfx.win(4);
        await fishReload();
        if (typeof ecReloadPaint === 'function') { try { ecReloadPaint(); } catch (e) {} }
      }
    } catch (e) { FishSfx.bad(); say(fishErr(e && e.message), 4); }
    finally { S.busyE = false; }
  }
  S.doAction = doAction;
  S.nearAction = nearAction;

  /* ── эффекты ── */
  const waveAt = (px, t) => Math.sin(px * .055 + t * 1.9) * 1.5 + Math.sin(px * .021 - t * 1.15) * 1.1 + Math.sin(px * .13 + t * 2.7) * .5;
  const ripple = (x, s) => S.ripples.push({ x, r: 2, m: 26 * s + 8, l: 1 });
  const splash = (x, y, n, s) => { for (let i = 0; i < n; i++) S.parts.push({ x: x + fRnd(-3, 3), y, vx: fRnd(-1.6, 1.6) * s, vy: fRnd(-3.4, -.8) * s, l: 1, g: .22, c: '#cfeeff' }); };
  function updateFx(dt) {
    for (let i = S.parts.length - 1; i >= 0; i--) { const p = S.parts[i]; p.vy += p.g; p.x += p.vx; p.y += p.vy; p.l -= dt * 1.5; if (p.l <= 0) S.parts.splice(i, 1); }
    for (let i = S.ripples.length - 1; i >= 0; i--) { const r = S.ripples[i]; r.r += dt * 34; r.l -= dt * .9; if (r.l <= 0 || r.r > r.m) S.ripples.splice(i, 1); }
    for (let i = S.bubbles.length - 1; i >= 0; i--) { const b = S.bubbles[i]; b.y -= dt * 22; b.x += b.vx; b.l -= dt * .55; if (b.l <= 0 || b.y < FISH_WATER_Y * FISH_TILE) S.bubbles.splice(i, 1); }
    for (const f of S.ambient) { f.x += f.vx; f.p += dt * 6; if (!world.water(t2(f.x), t2(f.y))) { f.vx *= -1; f.x += f.vx * 2; } f.y += Math.sin(f.p * .5) * .12; }
    S.flash = Math.max(0, S.flash - dt * 1.4);
    if (S.msgT > 0) S.msgT -= dt;
  }
  const say = (txt, sec) => { S.msg = txt; S.msgT = sec || 3; };

  /* ── рыбалка: клиент отыгрывает, сервер решает ── */
  // Удилище — ОДНА геометрия и для физики, и для картинки. Раньше кончик
  // считался отдельно от рисунка, и удочка торчала из груди огрызком под
  // случайным углом. Теперь есть хват (кулак), пятка и кончик на одной прямой.
  // rodA: 0 — покой, −0.7 — замах за спину, +0.35 — клюнуло, повело вниз.
  const ROD_LEN = 27;
  function rodGeom(p) {
    const d = p.dir || 1, a = -.85 + (p.rodA || 0) * 1.9;   // угол к горизонту
    const grip = { x: p.x + d * 4, y: p.y - 14.5 };
    const ux = Math.cos(a) * d, uy = Math.sin(a);
    return {
      d, a, grip,
      butt: { x: grip.x - ux * 6, y: grip.y - uy * 6 },
      tip: { x: grip.x + ux * ROD_LEN, y: grip.y + uy * ROD_LEN },
    };
  }
  const rodTip = () => rodGeom(S.me).tip;

  // Удилище: три колена с убывающей толщиной — так оно читается снастью, а не
  // палкой. Рисуется в мировых координатах, точки берём из rodGeom.
  function drawRod(g, alpha) {
    const c = S.cam;
    const seg = (t0, t1, w, col) => {
      const x0 = fLerp(g.butt.x, g.tip.x, t0), y0 = fLerp(g.butt.y, g.tip.y, t0);
      const x1 = fLerp(g.butt.x, g.tip.x, t1), y1 = fLerp(g.butt.y, g.tip.y, t1);
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0 - c.x, y0 - c.y); ctx.lineTo(x1 - c.x, y1 - c.y); ctx.stroke();
    };
    ctx.globalAlpha = alpha;
    seg(0, .22, 2.4, '#3b2c1d');          // рукоять
    seg(.22, .62, 1.6, '#8b6b45');
    seg(.62, 1, .9, '#b8905e');           // хлыст
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';
  }

  async function askServerBite() {
    const F = S.F;
    F.busy = true;
    try {
      const r = await ecRpc('fishing_cast', { p_depth: F.depth });
      F.id = (r && r.bite && r.bite.id) || null;
      // react — окно подсечки в секундах: сколько у игрока есть на реакцию.
      F.react = Math.max(.5, Number((r && r.bite && r.bite.react) || 1.1));
      if (r && typeof r.kept === 'number' && _fishState) { _fishState.kept = r.kept; fishPaintHud(); }
      // Клёв назначаем после ответа сервера: до него ловить нечего.
      F.biteAt = fRnd(2.6, 9.5) * (F.depth > 25 ? .85 : 1);
      F.nibbleAt = fRnd(1, Math.max(1.2, F.biteAt - .6));
      F.t = 0;
    } catch (e) {
      F.state = 'idle'; F.id = null;
      say(fishErr(e && e.message), 4);
    } finally { F.busy = false; }
  }

  async function landServer(ok) {
    const F = S.F;
    if (!F.id) { F.state = 'idle'; return; }
    const id = F.id; F.id = null; F.busy = true;
    try {
      const r = await ecRpc('fishing_land', { p_id: id, p_ok: !!ok });
      fishAfterLand(r);
      if (r && !r.lost) {
        // Артефакт держим на экране дольше обычного улова: это не «+40 ГС»,
        // а предмет, который потом вешают на оперативника.
        say(fishCatchLine(r), r.art ? 7 : 4.5);
        FishSfx.win(r.rar || 0);
        if ((r.rar || 0) >= 3) S.flash = 1;
      } else if (r) { say('Ушло', 2.5); FishSfx.lose(); }
    } catch (e) { FishSfx.bad(); say(fishErr(e && e.message), 4); }
    finally { F.busy = false; F.state = 'idle'; }
  }

  function updateFishing(dt) {
    const F = S.F, me = S.me, mouse = S.mouse;
    me.rodA = fLerp(me.rodA, F.state === 'charge' ? -.7 : F.state === 'bite' ? .35 : 0, .2);

    switch (F.state) {
      case 'idle':
        if (mouse.pressed && !F.busy) { F.state = 'charge'; F.power = 0; }
        break;

      case 'charge':
        F.power = Math.min(1, F.power + dt * 1.15);
        if (!mouse.down) {
          const tip = rodTip(), tx = S.mouse.x + S.cam.x, ty = S.mouse.y + S.cam.y;
          const a = fClamp(Math.atan2(ty - tip.y, tx - tip.x), -Math.PI * .95, Math.PI * .95);
          const sp = 2.2 + F.power * 6.4;
          F.bx = tip.x; F.by = tip.y; F.bvx = Math.cos(a) * sp; F.bvy = Math.sin(a) * sp - 1.2;
          F.state = 'fly'; me.dir = F.bvx < 0 ? -1 : 1;
          FishSfx.cast();
        }
        break;

      case 'fly': {
        F.bvy += .3; F.bx += F.bvx; F.by += F.bvy;
        const tx = t2(F.bx), ty = t2(F.by);
        if (world.water(tx, ty)) {
          splash(F.bx, FISH_WATER_Y * FISH_TILE, 10, 1.2); ripple(F.bx, 1); FishSfx.splash(false);
          F.depth = world.depthM(F.bx);
          F.state = 'wait'; F.t = 0; F.floatT = 0; F.bvy = 2;
          F.biteAt = 1e9; F.nibbleAt = -1;          // до ответа сервера клевать нечему
          askServerBite();
        } else if (world.solid(tx, ty) || F.by > FISH_H * FISH_TILE || F.bx < 0 || F.bx > FISH_W * FISH_TILE) {
          F.state = 'idle';
        }
        break;
      }

      case 'wait': {
        F.t += dt; F.floatT += dt;
        const surf = FISH_WATER_Y * FISH_TILE + waveAt(F.bx, S.time);
        F.bvy += (surf - F.by) * .09; F.bvy *= .8; F.by += F.bvy;
        F.by += Math.sin(F.floatT * 2.4) * .12;
        if (F.nibbleAt > 0 && F.t > F.nibbleAt) { F.nibbleAt = -1; F.bvy += 1.4; ripple(F.bx, .5); FishSfx.plop(); }
        if (F.t > F.biteAt) { F.state = 'bite'; F.t = 0; F.bvy = 3.2; ripple(F.bx, .8); FishSfx.bite(); }
        if (mouse.pressed && !F.busy) {                       // смотал сам — снимаем крючок с сервера
          FishSfx.reel();
          if (F.id) landServer(false); else F.state = 'idle';
        }
        break;
      }

      // Клюнуло. Вся игра здесь: успел нажать в окно react — улов твой.
      case 'bite': {
        F.t += dt;
        const surf = FISH_WATER_Y * FISH_TILE + waveAt(F.bx, S.time);
        F.by += F.bvy; F.bvy += (surf + 7 - F.by) * .14; F.bvy *= .78;
        if (Math.random() < .3) ripple(F.bx, .35);
        if (mouse.pressed) {
          splash(F.bx, FISH_WATER_Y * FISH_TILE, 12, 1.2); FishSfx.splash(true);
          F.state = 'landing'; landServer(true);
        } else if (F.t > F.react) { F.state = 'landing'; landServer(false); }
        break;
      }
    }
    S.mouse.pressed = false;
  }

  /* ── рендер ── */
  const B = world.biome;

  /* Берег рисуется КАЖДЫЙ кадр и вектором, а не печётся тайлами: буфер теперь
     в нативном разрешении, и запечённый холст пришлось бы растягивать — вся
     графика поплыла бы. Заливок мало: один силуэт на видимый диапазон. */
  const seed = world.seed;

  /* Кромка берега сглажена — и ТА ЖЕ кривая работает опорой для ног (см.
     rampSnap): рисовать ступени тайлов уродливо, а рисовать гладкий склон
     поверх ступенчатой коллизии — обман, персонаж прыгал по невидимым
     ступеням. Поэтому склон стал рампой и в графике, и в физике. */
  const fishTopH = x => world.topH[fClamp(Math.round(x), 0, FISH_W - 1)];
  const shoreY = x => (fishTopH(x - 1) + fishTopH(x) * 2 + fishTopH(x + 1)) / 4 * FISH_TILE;
  const shoreAt = px => {                       // высота рампы в произвольной точке
    const gx = px / FISH_TILE - .5, i = Math.floor(gx), f = gx - i;
    return fLerp(shoreY(i), shoreY(i + 1), f);
  };

  function shorePath(x0, x1) {
    ctx.beginPath();
    ctx.moveTo(x0 * FISH_TILE - S.cam.x, VH + 40);
    for (let x = x0; x <= x1; x++) ctx.lineTo(x * FISH_TILE + FISH_TILE / 2 - S.cam.x, shoreY(x) - S.cam.y);
    ctx.lineTo(x1 * FISH_TILE - S.cam.x, VH + 40);
    ctx.closePath();
  }

  let stars = [];
  const mkStars = () => { stars = Array.from({ length: 120 }, () => ({ x: Math.random() * VW, y: Math.random() * VH * .7, p: fRnd(0, 9) })); };
  mkStars();
  const clouds = Array.from({ length: 12 }, (_, i) => ({ x: Math.random() * FISH_W * FISH_TILE, y: fRnd(10, 140), s: fRnd(.6, 1.7), v: fRnd(.05, .18) }));

  // Линия горизонта на экране. Отсчитываем её от УРЕЗА ВОДЫ, а не от нуля
  // камеры: камера всегда стоит глубоко в мире (берег на 74-м тайле), и без
  // этой поправки дальние гряды уезжали в самый верх кадра и съедали небо.
  const horizonY = par => VH * .62 - (S.cam.y - (FISH_WATER_Y * FISH_TILE - VH * .62)) * par * .3;

  /* Небо этого места: газовый гигант с кольцом низко над горизонтом и мелкая
     луна. Палитра обесцвечена почти до стали — день и ночь различаются
     светлотой, а не тоном, иначе кадр читался «дачным прудом». */
  function drawGiant(night) {
    const gx = VW * .76 - S.cam.x * .04, gy = horizonY(.35) - VH * .46, R = Math.max(24, VH * .125);
    if (gy + R * 1.9 < 0) return;
    ctx.save();
    ctx.globalAlpha = night ? .85 : .40;
    ctx.strokeStyle = 'rgba(150,166,182,.30)'; ctx.lineWidth = R * .09;
    ctx.beginPath(); ctx.ellipse(gx, gy, R * 1.85, R * .34, -.22, Math.PI, Math.PI * 2); ctx.stroke();
    const bg = ctx.createLinearGradient(gx - R, gy - R, gx + R, gy + R);
    bg.addColorStop(0, '#6d7688'); bg.addColorStop(.45, '#4a5364'); bg.addColorStop(1, '#151a22');
    ctx.beginPath(); ctx.arc(gx, gy, R, 0, 7); ctx.fillStyle = bg; ctx.fill();
    ctx.save(); ctx.clip();
    for (let i = -5; i <= 5; i++) {
      ctx.fillStyle = (i & 1) ? 'rgba(30,36,46,.40)' : 'rgba(160,172,188,.14)';
      ctx.beginPath(); ctx.ellipse(gx, gy + i * R * .17 + Math.sin(i * 2.3) * 3, R, R * .06 + Math.abs(Math.sin(i)) * 2.2, 0, 0, 7); ctx.fill();
    }
    ctx.fillStyle = 'rgba(178,150,140,.28)';
    ctx.beginPath(); ctx.ellipse(gx - R * .3, gy + R * .22, R * .2, R * .09, .2, 0, 7); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(186,198,212,.38)'; ctx.lineWidth = R * .09;
    ctx.beginPath(); ctx.ellipse(gx, gy, R * 1.85, R * .34, -.22, 0, Math.PI); ctx.stroke();
    ctx.strokeStyle = 'rgba(120,134,150,.20)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(gx, gy, R * 2.12, R * .40, -.22, 0, Math.PI); ctx.stroke();
    const mx = gx - R * 2.7 + Math.sin(S.time * .05) * 30, my = gy - R * .8;
    ctx.fillStyle = '#9aa4b0'; ctx.beginPath(); ctx.arc(mx, my, 6, 0, 7); ctx.fill();
    ctx.fillStyle = '#2b323c'; ctx.beginPath(); ctx.arc(mx + 2.4, my - .6, 5.2, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawSky(night) {
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    if (night) { g.addColorStop(0, '#0d1015'); g.addColorStop(.55, '#161a22'); g.addColorStop(1, '#242a34'); }
    else { g.addColorStop(0, '#4a5661'); g.addColorStop(.55, '#79848e'); g.addColorStop(1, '#b0b7bc'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
    if (night) {
      for (const st of stars) {
        ctx.globalAlpha = .25 + Math.abs(Math.sin(st.p + S.time * .8)) * .6;
        ctx.fillStyle = '#fff'; ctx.fillRect(st.x, st.y, 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    drawGiant(night);

    // Светило — тусклое пятно за облаками, без диска и лучей.
    if (!night) {
      const sx = VW * .26, sy = 42;
      const hg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 70);
      hg.addColorStop(0, 'rgba(228,222,206,.28)'); hg.addColorStop(1, 'rgba(228,222,206,0)');
      ctx.fillStyle = hg; ctx.fillRect(sx - 80, sy - 80, 160, 160);
    }

    // Облака — вытянутые полосы с растворёнными краями.
    for (const c of clouds) {
      c.x += c.v;
      const x = ((c.x - S.cam.x * .25) % (FISH_W * FISH_TILE) + FISH_W * FISH_TILE) % (FISH_W * FISH_TILE) - 100;
      const w = 74 * c.s, h = 5 * c.s;
      if (x < -w * 2 || x > VW + w) continue;
      const cg = ctx.createLinearGradient(x - w, 0, x + w, 0);
      cg.addColorStop(0, 'rgba(0,0,0,0)');
      cg.addColorStop(.5, night ? 'rgba(150,168,192,.10)' : 'rgba(214,220,226,.16)');
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.ellipse(x, c.y, w, h, 0, 0, 7); ctx.fill();
    }

    // Три гряды с дымкой между планами — весь объём кадра держится на них.
    const fogC = night ? '13,17,23' : '150,157,163';
    for (let l = 0; l < 3; l++) {
      const par = .18 + l * .17, amp = 12 + l * 11, base = horizonY(par) - (2 - l) * 10;
      const dark = night ? [.55, .72, .88] : [.30, .46, .64];
      if (l === 2) drawTemple(night);          // храм стоит между дальней грядой и ближней
      ctx.fillStyle = `rgba(22,27,33,${dark[l]})`;
      ctx.beginPath(); ctx.moveTo(0, VH);
      for (let x = 0; x <= VW; x += 4) ctx.lineTo(x, base - fFbm((x + S.cam.x * par) * .006 + l * 37, 7) * amp);
      ctx.lineTo(VW, VH); ctx.fill();
      const fg = ctx.createLinearGradient(0, base - amp - 10, 0, base + 30);
      fg.addColorStop(0, `rgba(${fogC},0)`);
      fg.addColorStop(1, `rgba(${fogC},${.16 - l * .04})`);
      ctx.fillStyle = fg; ctx.fillRect(0, base - amp - 10, VW, amp + 44);
    }
  }

  // Силуэт Храма мироздания на том берегу: внутрь не попасть, он просто стоит
  // за омутом, и ночью в нём горит свет. Параллакс слабый (храм далеко), а
  // якорь подобран так, чтобы с ЛЮБОГО берега он оказывался над водой, а не
  // за спиной. Сам силуэт маленький: полоса неба над горизонтом узкая.
  const TEMPLE_X = 660, TEMPLE_PAR = .35;
  function drawTemple(night) {
    const x = TEMPLE_X - S.cam.x * TEMPLE_PAR, g = horizonY(.5) - 2;
    if (x < -40 || x > VW + 40) return;
    if (g < 34 || g > VH) return;   // нырнули/забрались — горизонт ушёл из кадра
    const fill = ctx.fillStyle;
    // Днём — тёмный силуэт на светлом небе, ночью наоборот: камень ловит луну.
    ctx.fillStyle = night ? 'rgba(48,62,92,.95)' : 'rgba(26,42,56,.82)';
    ctx.fillRect(x - 30, g, 60, 60);                                  // плато
    for (let t = 0; t < 3; t++) {                                     // ступени
      const w = 26 - t * 7;
      ctx.fillRect(x - w, g - (t + 1) * 5, w * 2, 6);
    }
    ctx.fillRect(x - 3, g - 25, 6, 11);                               // шпиль
    ctx.beginPath();                                                  // навершие
    ctx.moveTo(x, g - 31); ctx.lineTo(x + 5, g - 25); ctx.lineTo(x - 5, g - 25); ctx.fill();
    if (night) {                                                      // огни в проёмах
      ctx.fillStyle = 'rgba(255,214,140,.7)';
      for (let i = -2; i <= 2; i++) ctx.fillRect(x + i * 7 - 1, g - 4, 2, 3);
      ctx.fillStyle = 'rgba(255,214,140,.45)'; ctx.fillRect(x - 1, g - 22, 2, 4);
    }
    ctx.fillStyle = fill;
  }

  /* Берег — сплошной силуэт, а не тайловая кладка: тело, светлая кромка и
     редкий декор штрихами. Мостки рисуются поверх и остаются рукотворными —
     единственная прямая линия в кадре. */
  function drawTiles() {
    const night = fishNightNow();
    const x0 = Math.max(0, t2(S.cam.x) - 2), x1 = Math.min(FISH_W - 1, t2(S.cam.x + VW) + 2);
    const surf = FISH_WATER_Y * FISH_TILE - S.cam.y;

    // тело берега
    const g = ctx.createLinearGradient(0, surf - 120, 0, surf + 160);
    g.addColorStop(0, night ? '#0a0c10' : '#1b1f25');
    g.addColorStop(1, night ? '#05070a' : '#0a0d11');
    shorePath(x0, x1); ctx.fillStyle = g; ctx.fill();
    shorePath(x0, x1);
    ctx.strokeStyle = night ? 'rgba(120,140,165,.20)' : 'rgba(196,206,214,.34)';
    ctx.lineWidth = 1; ctx.stroke();

    /* Декор кромки. Два правила, из-за которых он раньше выглядел браком:
       ставим только на ПОЛОГИХ участках (на обрыве трава висела в воздухе)
       и по разрежённой сетке (каждый тайл подряд складывался в бордюр). */
    for (let x = x0; x <= x1; x++) {
      const top = world.topH[x], px = x * FISH_TILE - S.cam.x, py = shoreY(x) - S.cam.y;
      // Площадка должна быть РОВНОЙ на пять тайлов вокруг: при допуске «уклон
      // до двух» трава всё равно вставала на 45-градусном склоне и висела в
      // воздухе, потому что силуэт берега сглажен, а topH — ступенчатый.
      let flat = true;
      for (let k = -2; k <= 2 && flat; k++) {
        const a = world.topH[fClamp(x + k, 0, FISH_W - 1)], b2 = world.topH[fClamp(x + k + 1, 0, FISH_W - 1)];
        if (Math.abs(b2 - a) > 0) flat = false;
      }
      if (!flat) continue;
      const r = fHash(x, seed ^ 0x2b1d), r2 = fHash(x, seed ^ 0x77a3);

      if (x >= FISH_MEADOW_X0 - 4 && x <= FISH_MEADOW_X1 + 4) {
        if (x % 2) continue;
        for (let i = 0; i < 2; i++) {
          const h1 = fHash(x * 11 + i * 7, seed ^ 0x33af);
          if (h1 < .1) continue;
          const ox = px + 2 + ((i * 5 + ((h1 * 4) | 0)) % 13), hh = 5 + ((fHash(x * 3 + i, seed ^ 0x1177) + 1) * 5 | 0);
          const sway = Math.sin(S.time * .8 + x * .3) * 1.4;
          ctx.strokeStyle = night ? 'rgba(70,86,78,.55)' : 'rgba(58,68,60,.70)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(ox, py); ctx.quadraticCurveTo(ox + sway, py - hh * .6, ox + sway * 1.8, py - hh); ctx.stroke();
          ctx.fillStyle = `rgba(196,240,230,${night ? .55 : .30})`;
          ctx.beginPath(); ctx.arc(ox + sway * 1.8, py - hh, 1, 0, 7); ctx.fill();
        }
        continue;
      }

      // Валун: раз в 7 тайлов, неправильной формы. Полукруг под обводкой и
      // давал ту самую цепочку арок вдоль всего берега.
      if (top < FISH_WATER_Y && x % 7 === 0 && r > .1) {
        const w = 6 + ((r2 + 1) * 7 | 0), h = 3 + ((r + 1) * 3 | 0), bx = px + 8;
        ctx.fillStyle = night ? 'rgba(12,15,20,.95)' : 'rgba(26,31,37,.94)';
        ctx.beginPath();
        ctx.moveTo(bx - w * .5, py + 1);
        ctx.lineTo(bx - w * .34, py - h * .75);
        ctx.lineTo(bx + w * .05, py - h);
        ctx.lineTo(bx + w * .42, py - h * .55);
        ctx.lineTo(bx + w * .5, py + 1);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = night ? 'rgba(120,140,165,.14)' : 'rgba(186,198,208,.20)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bx - w * .34, py - h * .75); ctx.lineTo(bx + w * .05, py - h); ctx.stroke();
      }

      // Осока — пучками, а не по травинке на каждый тайл.
      if (top < FISH_WATER_Y && x % 3 === 0 && r > -.35 && r < .5) {
        ctx.strokeStyle = night ? 'rgba(90,105,120,.26)' : 'rgba(60,68,74,.48)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          const ox = px + 3 + i * 4 + ((r2 * 3) | 0);
          const len = 4 + Math.abs(fHash(x * 5 + i, seed ^ 0x9f)) * 8;
          const sway = Math.sin(S.time * .7 + x + i * .8) * 1.6;
          ctx.beginPath(); ctx.moveTo(ox, py);
          ctx.quadraticCurveTo(ox + sway, py - len * .6, ox + sway * 2.2, py - len); ctx.stroke();
        }
      }

      // Тростник — только у самой воды, где отмель.
      if (top >= FISH_WATER_Y && top <= FISH_WATER_Y + 4 && x % 2 === 0 && r < -.1) {
        const n = 2 + ((r2 + 1) * 2 | 0);
        ctx.strokeStyle = night ? 'rgba(30,40,38,.85)' : 'rgba(38,48,44,.80)';
        ctx.lineWidth = 1;
        for (let i = 0; i < n; i++) {
          const ox = px + 2 + i * 4, hh = 12 + ((fHash(x * 7 + i, seed) + 1) * 11 | 0);
          const sway = Math.sin(S.time * .6 + x + i) * 2;
          ctx.beginPath(); ctx.moveTo(ox, py); ctx.quadraticCurveTo(ox + sway * .5, py - hh * .6, ox + sway, py - hh); ctx.stroke();
        }
      }
    }

    /* Мостки: настил идёт СПЛОШНОЙ доской, а сваи — отдельными брусьями.
       Потайловая раскладка резала их на кубы с дырами между опорами. */
    const c = B.ground[FT_PLANK];
    const deckTop = {};
    for (let x = x0; x <= x1; x++) for (let y = FISH_WATER_Y - 6; y < FISH_WATER_Y + 2; y++) {
      if (world.tile(x, y) !== FT_PLANK) continue;
      if (deckTop[x] === undefined) deckTop[x] = y;    // верхний тайл колонки = настил
    }
    const cols = Object.keys(deckTop).map(Number).sort((p1, p2) => p1 - p2);
    // сваи
    for (const x of cols) {
      if (x % 3) continue;
      // ОДИН брус на опору и ровно до уреза: пара брусьев читалась объёмной
      // «3D-ножкой», а свая ниже воды делала мост выше, чем он есть.
      const px = x * FISH_TILE - S.cam.x, py = deckTop[x] * FISH_TILE - S.cam.y;
      const bot = FISH_WATER_Y * FISH_TILE - S.cam.y;
      if (bot <= py) continue;
      ctx.fillStyle = night ? 'rgba(16,13,10,.92)' : 'rgba(30,25,19,.90)';
      ctx.fillRect(px + 6, py + 5, 3, bot - py - 5);
    }
    // настил цельными пролётами
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const xa = run[0], xb = run[run.length - 1];
      const px = xa * FISH_TILE - S.cam.x, py = deckTop[xa] * FISH_TILE - S.cam.y;
      const w = (xb - xa + 1) * FISH_TILE;
      // Настил тонкий: тело на всю высоту тайла делало мост толстым брусом и
      // визуально поднимало его над водой.
      ctx.fillStyle = night ? '#120f0a' : '#1b1710';
      ctx.fillRect(px, py, w, 9);
      ctx.fillStyle = night ? '#1d1811' : '#2b241b';
      ctx.fillRect(px, py, w, 5);
      ctx.fillStyle = night ? 'rgba(196,206,214,.10)' : 'rgba(226,232,238,.16)';
      ctx.fillRect(px, py, w, 1);                       // блик по верхней грани
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(px, py + 8, w, 1);                   // тень под настилом
      ctx.strokeStyle = night ? 'rgba(0,0,0,.5)' : 'rgba(0,0,0,.35)';
      ctx.lineWidth = 1;
      for (let x = xa; x <= xb; x++) {                  // швы между досками
        const sx = x * FISH_TILE - S.cam.x;
        ctx.beginPath(); ctx.moveTo(sx, py); ctx.lineTo(sx, py + 5); ctx.stroke();
      }
      run = [];
    };
    for (let i = 0; i < cols.length; i++) {
      const x = cols[i];
      if (run.length && (x !== run[run.length - 1] + 1 || deckTop[x] !== deckTop[run[0]])) flush();
      run.push(x);
    }
    flush();
  }

  /* ── АТМОСФЕРА ───────────────────────────────────────────────────
     Кадр держится не на предметах, а на воздухе между ними: дымка слоями
     с разным параллаксом, пыль в луче, свет гиганта на кромке берега. */
  const DUST = Array.from({ length: 90 }, () => ({
    x: Math.random() * FISH_W * FISH_TILE, y: Math.random() * FISH_H * FISH_TILE,
    v: fRnd(1.5, 6), p: fRnd(0, 9), s: fRnd(.4, 1.3), par: fRnd(.75, 1),
  }));

  // Дымка: три полосы над водой, ползут с разной скоростью.
  function drawHaze(night) {
    const surf = FISH_WATER_Y * FISH_TILE - S.cam.y;
    const base = night ? '22,28,36' : '168,176,182';
    for (let l = 0; l < 3; l++) {
      const par = .12 + l * .16, y = surf - 6 - l * 16;
      const off = ((S.time * (3 + l * 4) - S.cam.x * par) % 420 + 420) % 420;
      const a = (night ? .10 : .16) - l * .025;
      // Растушёвка по ОБЕИМ осям: у лент с резкой верхней и нижней гранью
      // получались ровные светлые полки — их принимали за ступени рельефа.
      for (let i = -1; i < Math.ceil(VW / 210) + 1; i++) {
        const x = i * 210 + off - 210, w = 150 + l * 40, h = 14 + l * 6;
        if (x + w < 0 || x - w > VW) continue;
        ctx.save();
        ctx.translate(x, y); ctx.scale(1, h / w);
        const g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, w);
        g2.addColorStop(0, `rgba(${base},${a})`);
        g2.addColorStop(.55, `rgba(${base},${a * .45})`);
        g2.addColorStop(1, `rgba(${base},0)`);
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(0, 0, w, 0, 7); ctx.fill();
        ctx.restore();
      }
    }
  }

  // Пыль/споры в воздухе — медленно всплывают, дают кадру глубину.
  function drawDust(dt, night) {
    for (const d of DUST) {
      d.y -= d.v * dt; d.p += dt;
      if (d.y < S.cam.y - 20) d.y = S.cam.y + VH + 20;
      const sx = d.x - S.cam.x * d.par, sy = d.y - S.cam.y;
      if (sx < -10 || sx > VW + 10 || sy < -10 || sy > VH + 10) continue;
      ctx.fillStyle = `rgba(178,222,214,${(night ? .45 : .20) * (.35 + Math.abs(Math.sin(d.p)) * .65)})`;
      ctx.beginPath(); ctx.arc(sx + Math.sin(d.p * .7) * 3, sy, d.s, 0, 7); ctx.fill();
    }
  }

  // Виньетка: кадр гасится к краям, взгляд остаётся на воде.
  let VIGN = null, vignKey = '';
  function drawVignette() {
    const key = VW + 'x' + VH;
    if (key !== vignKey) {
      vignKey = key;
      VIGN = ctx.createRadialGradient(VW / 2, VH * .55, VH * .3, VW / 2, VH * .55, VH * 1.0);
      VIGN.addColorStop(0, 'rgba(0,0,0,0)'); VIGN.addColorStop(1, 'rgba(0,0,0,.34)');
    }
    ctx.fillStyle = VIGN; ctx.fillRect(0, 0, VW, VH);
  }

  /* Вода — тёмное зеркало, а не голубая жидкость: почти чёрное тело, у кромки
     отражение неба и штрихи ряби, глубже ничего. Сверху лежит туман — на нём
     и держится настроение места. */
  function drawWater(night) {
    const x0 = Math.max(0, t2(S.cam.x) - 1), x1 = Math.min(FISH_W - 1, t2(S.cam.x + VW) + 1);
    const surf = FISH_WATER_Y * FISH_TILE - S.cam.y;

    /* Вода — СПЛОШНОЕ поле от волны до низа кадра. Раньше она резалась по
       колонкам тайлов, а берег рисуется сглаженным силуэтом — на стыке
       оставались чёрные щели: их и видно как «пропасть» и «невидимую
       лестницу». Теперь берег кладётся ПОВЕРХ воды и сам задаёт линию уреза. */
    let hasWater = false;
    for (let x = x0; x <= x1 && !hasWater; x++) if (world.wTop[x] >= 0) hasWater = true;

    const waterPath = () => {
      ctx.beginPath();
      ctx.moveTo(-4, VH + 40);
      for (let x = x0; x <= x1; x++) {
        const wx = x * FISH_TILE;
        ctx.lineTo(wx - S.cam.x, FISH_WATER_Y * FISH_TILE + waveAt(wx, S.time) - S.cam.y);
      }
      ctx.lineTo(VW + 4, VH + 40);
      ctx.closePath();
    };

    if (hasWater) {
      // тело воды: шкала градиента ЭКРАННАЯ — по глубине омута мелкие места
      // проваливались в чёрное на первых сорока пикселях
      const wg = ctx.createLinearGradient(0, surf, 0, surf + Math.max(190, VH * .95));
      wg.addColorStop(0, night ? 'rgba(44,54,66,.94)' : 'rgba(108,118,126,.92)');
      wg.addColorStop(.30, night ? 'rgba(22,28,36,.96)' : 'rgba(54,62,70,.95)');
      wg.addColorStop(1, night ? 'rgba(4,6,9,1)' : 'rgba(10,13,17,1)');
      waterPath(); ctx.fillStyle = wg; ctx.fill();

      ctx.save(); waterPath(); ctx.clip();
      // отражение неба у кромки
      const rg = ctx.createLinearGradient(0, surf - 2, 0, surf + 28);
      rg.addColorStop(0, night ? 'rgba(60,72,90,.30)' : 'rgba(176,183,188,.26)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.fillRect(0, surf - 2, VW, 32);
      // штрихи ряби: позиции по хешу, иначе выстраиваются в диагональ
      ctx.strokeStyle = night ? 'rgba(140,158,180,.10)' : 'rgba(206,214,222,.16)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        const y = surf + 3 + i * 3.6 + Math.sin(S.time * .7 + i) * .4;
        ctx.globalAlpha = (1 - i / 14) * .7;
        for (let j = 0; j < 3; j++) {
          const ph = Math.sin(S.time * 1.1 + i * 1.7 + j * 2.3);
          const w = 16 + Math.abs(ph) * 44;
          const wxp = (fHash(i * 31 + j * 7, seed ^ 0x51ed) + 1) * .5 * (FISH_W * FISH_TILE) + ph * 20;
          const xx = wxp - S.cam.x;
          if (xx > VW || xx + w < 0) continue;
          ctx.beginPath(); ctx.moveTo(xx, y); ctx.lineTo(xx + w, y); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      /* Дорожка светила — стопка мягких пятен без единой прямой грани.
         И полоски, и конус с чёткими краями читались как ступени лестницы,
         уходящей под воду. */
      const lx = night ? VW * .76 : VW * .26;
      ctx.globalCompositeOperation = 'lighter';
      const gh = Math.min(VH - surf, 130);
      for (let i = 0; i < 9 && gh > 8; i++) {
        const k = i / 8;
        const yy = surf + 4 + k * gh;
        const w = (20 - k * 15) + Math.sin(S.time * 1.4 + i) * 2.2;
        const h = 7 - k * 3;
        if (w <= 1) continue;
        const a2 = (night ? .10 : .09) * (1 - k) ;
        ctx.save();
        ctx.translate(lx + Math.sin(S.time * .8 + i * .9) * 3.5, yy);
        ctx.scale(1, h / w);
        const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, w);
        pg.addColorStop(0, night ? `rgba(150,180,220,${a2})` : `rgba(236,232,216,${a2})`);
        pg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.arc(0, 0, w, 0, 7); ctx.fill();
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();

      // кромка воды по волне
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        const wx = x * FISH_TILE, y = FISH_WATER_Y * FISH_TILE + waveAt(wx, S.time) - S.cam.y;
        if (x === x0) ctx.moveTo(wx - S.cam.x, y); else ctx.lineTo(wx - S.cam.x, y);
      }
      ctx.strokeStyle = night ? 'rgba(150,170,195,.26)' : 'rgba(224,232,238,.40)';
      ctx.lineWidth = 1; ctx.stroke();
    }

    for (const r of S.ripples) {
      ctx.strokeStyle = `rgba(200,214,226,${.42 * r.l})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(r.x - S.cam.x, FISH_WATER_Y * FISH_TILE + waveAt(r.x, S.time) - S.cam.y, r.r, r.r * .3, 0, 0, 7); ctx.stroke();
    }

    // туман над водой
    const mg = ctx.createLinearGradient(0, surf - 44, 0, surf + 6);
    const mc = night ? '18,22,28' : '164,172,178';
    mg.addColorStop(0, `rgba(${mc},0)`);
    mg.addColorStop(1, `rgba(${mc},${night ? .20 : .28})`);
    ctx.fillStyle = mg; ctx.fillRect(0, surf - 44, VW, 50);
  }

  function drawUnderwater() {
    // Рыбы — тусклые силуэты, а не белые прямоугольники: на тёмной воде
    // прежние заплатки читались как мусор в кадре.
    for (const f of S.ambient) {
      const sx = f.x - S.cam.x, sy = f.y - S.cam.y;
      if (sx < -20 || sx > VW + 20) continue;
      const d = f.vx > 0 ? 1 : -1, w = 5 * f.s;
      ctx.fillStyle = 'rgba(168,190,206,.30)';
      ctx.beginPath(); ctx.ellipse(sx, sy, w * .6, 1.1 * f.s, 0, 0, 7); ctx.fill();
      ctx.beginPath();                                   // хвост
      ctx.moveTo(sx - d * w * .55, sy);
      ctx.lineTo(sx - d * w * .95, sy - 1.6 * f.s);
      ctx.lineTo(sx - d * w * .95, sy + 1.6 * f.s);
      ctx.closePath(); ctx.fill();
    }
    for (const b of S.bubbles) { ctx.fillStyle = `rgba(210,240,255,${.45 * b.l})`; ctx.beginPath(); ctx.arc(b.x - S.cam.x, b.y - S.cam.y, b.r, 0, 7); ctx.fill(); }
  }

  // ГОЛОВА В ШЛЕМЕ. У воды сидит не рыбак в плаще, а космонавт: белый купол,
  // тёмное забрало — и за забралом та самая галактика (лица нет, есть держава).
  // Шлем рисуется поверх шейного кольца скафандра, галактика — в клипе забрала,
  // иначе рукава вылезали за стекло.
  function drawHelmet(cx, cy, d, ghost) {
    const c1 = ghost ? '#9aa8ba' : '#e3e9f1', c2 = ghost ? '#77869a' : '#b3c0d0';
    ctx.save();
    ctx.translate(cx, cy);
    // Купол
    ctx.fillStyle = c1;
    ctx.beginPath(); ctx.ellipse(0, 0, 6.4, 6.1, 0, 0, 7); ctx.fill();
    ctx.fillStyle = c2;                                   // теневая половина — от воды
    ctx.beginPath(); ctx.ellipse(0, 1.6, 6.4, 4.5, 0, 0, Math.PI); ctx.fill();
    // Забрало смещено в сторону взгляда
    const vx = d * 1.1;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(vx, -.2, 4.4, 4.1, 0, 0, 7); ctx.clip();
    ctx.fillStyle = '#070c1c'; ctx.fillRect(-8, -8, 16, 16);
    ctx.save(); ctx.translate(vx, -.2); ctx.scale(.62, .62);
    drawGalaxyHead(0, 0);
    ctx.restore();
    ctx.restore();
    // Ободок забрала и блик на стекле
    ctx.strokeStyle = c2; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(vx, -.2, 4.4, 4.1, 0, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.30)';
    ctx.beginPath(); ctx.ellipse(vx - d * 1.8, -2, 1.5, .9, -.5 * d, 0, 7); ctx.fill();
    // Антенна на затылке — мелочь, но по ней силуэт читается «космос», а не «водолаз».
    ctx.strokeStyle = c2; ctx.lineWidth = .9;
    ctx.beginPath(); ctx.moveTo(-d * 4.4, -4.2); ctx.lineTo(-d * 6.4, -8.4); ctx.stroke();
    ctx.fillStyle = '#ff8b5e';
    ctx.fillRect(-d * 6.4 - .8, -9.4, 1.6, 1.6);
    ctx.restore();
  }

  // Галактика за стеклом: рукава крутятся медленно, ядро дышит.
  function drawGalaxyHead(cx, cy) {
    const t = S.time * .35;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(t);
    ctx.globalAlpha = .85;
    ctx.fillStyle = '#0a1226';
    ctx.beginPath(); ctx.ellipse(0, 0, 6, 5.2, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    for (let a = 0; a < 2; a++) {                       // два рукава
      ctx.strokeStyle = a ? 'rgba(140,180,255,.75)' : 'rgba(200,165,255,.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i <= 14; i++) {
        const th = a * Math.PI + i * .3, r = .5 + i * .38;
        const px = Math.cos(th) * r, py = Math.sin(th) * r * .82;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    const pulse = .75 + Math.sin(S.time * 2.2) * .25;
    ctx.fillStyle = `rgba(255,244,214,${pulse})`;
    ctx.beginPath(); ctx.ellipse(0, 0, 1.9, 1.6, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = .3 * pulse; ctx.fillStyle = '#cfe0ff';
    ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 3.8, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  // Флаг державы за спиной. Полотнище — цветом фракции, герб — картинкой,
  // если она уже подгрузилась (см. fishFlagLoad).
  // p — чей флаг: у соседа по берегу свой цвет державы, если транспорт его
  // прислал; иначе рисуем свой.
  function drawFlag(x, y, d, bob, p) {
    drawFlagLocal(x - d * 6, y - 6 + bob * .3, d, p);
  }
  // То же полотнище, но от готовой точки основания древка: в лодке флаг стоит
  // на корме и качается вместе с корпусом, а не «за спиной» гребца.
  function drawFlagLocal(px, base, d, p) {
    const f = (p && p.flagCol) ? { col: p.flagCol, img: p.flagImg || null } : _fishFlag;
    const x = px;
    ctx.strokeStyle = '#7a6446'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(px, base); ctx.lineTo(px, base - 26); ctx.stroke();
    const wav = Math.sin(S.time * 3 + x * .05) * 1.4;
    const fx = px + (d > 0 ? -11 : 1), fy = base - 26 + wav * .3;
    ctx.fillStyle = f.col;
    ctx.fillRect(fx, fy, 10, 7);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(fx, fy + 5 + wav * .2, 10, 2);
    if (f.img && f.img.complete && f.img.naturalWidth) {
      try { ctx.drawImage(f.img, fx + 1, fy + 1, 8, 5); } catch (e) { f.img = null; }
    }
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(fx, fy, 10, 1);
  }

  // Палитра скафандра. Ghost (сосед по берегу) — тот же костюм, но пыльный:
  // так чужой силуэт не спорит с твоим, а различие читается мгновенно.
  function suitColors(ghost) {
    return ghost
      ? { suit: '#9aa8ba', shade: '#77869a', trim: '#5f6c7d', panel: '#39434f', pack: '#8894a6', pack2: '#68738a', hose: '#5f6c7d', boot: '#454f5e' }
      : { suit: '#e3e9f1', shade: '#b3c0d0', trim: '#7d8a9b', panel: '#28313f', pack: '#c9d3df', pack2: '#95a2b3', hose: '#7d8a9b', boot: '#39424f' };
  }

  // ── НОГА СКАФАНДРА ──
  // Честная двухзвенка: бедро качается по фазе, колено сгибается только в
  // МАХЕ и только назад. Прежняя нога считалась одним синусом на оба звена —
  // отсюда и «ножницы», из-за которых шаг выглядел вывихом.
  // Стопа не проваливается под уровень ног (y): опорная нога стоит на земле.
  const L_THIGH = 5.2, L_SHIN = 5.4;
  function drawLeg(x, yFeet, hipY, d, phase, moving, onGround, C, far) {
    const s = moving ? Math.sin(phase) : 0;
    const c = moving ? Math.cos(phase) : 0;
    // Угол бедра от вертикали: вперёд — в сторону взгляда.
    let a1 = Math.PI / 2 - d * s * .52;
    // Сгиб колена: максимум в середине выноса (когда нога идёт вперёд, c<0),
    // на опоре — почти прямая. В прыжке ноги поджаты обе.
    let bend = moving ? Math.max(0, -c) * .95 : .08;
    if (!onGround) { a1 = Math.PI / 2 - d * .28; bend = .85; }
    const kx = x + Math.cos(a1) * L_THIGH, ky = hipY + Math.sin(a1) * L_THIGH;
    const a2 = a1 + d * bend;
    let fx = kx + Math.cos(a2) * L_SHIN, fy = ky + Math.sin(a2) * L_SHIN;
    if (onGround) fy = Math.min(fy, yFeet - .6);
    const col = far ? C.shade : C.suit;
    // Штанина: гофра — три кольца по звену, читается скафандром, а не трубой.
    ctx.lineCap = 'round';
    ctx.strokeStyle = col; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(x + d * .4, hipY); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
    ctx.strokeStyle = far ? C.trim : C.shade; ctx.lineWidth = .8;
    for (let i = 1; i <= 2; i++) {
      const t = i / 3;
      ctx.beginPath();
      ctx.moveTo(fLerp(x + d * .4, kx, t) - 1.6, fLerp(hipY, ky, t));
      ctx.lineTo(fLerp(x + d * .4, kx, t) + 1.6, fLerp(hipY, ky, t)); ctx.stroke();
    }
    ctx.fillStyle = col;                                  // наколенник
    ctx.beginPath(); ctx.arc(kx, ky, 1.9, 0, 7); ctx.fill();
    // Ботинок: тяжёлый, с подошвой; носок смотрит по направлению взгляда.
    ctx.fillStyle = C.boot;
    ctx.fillRect(fx - 2 + (d > 0 ? .4 : -.4), fy - 1.6, 4.4, 3.2);
    ctx.fillStyle = far ? C.trim : C.pack2;
    ctx.fillRect(fx - 2 + (d > 0 ? .4 : -.4), fy + 1, 4.4, 1);
    ctx.lineCap = 'butt';
  }

  // Снасть силуэта: у меня — живое состояние заброса, у соседа — присланное.
  const lineOf = (p, ghost) => (ghost ? (p.line || { state: 'idle' }) : S.F);

  // Имя державы над соседом. Мелко и приглушённо: подпись должна отвечать на
  // «кто это», не превращая берег в список игроков.
  function drawPeerName(p) {
    if (!p.name) return;
    const x = p.x - S.cam.x;
    const y = (p.boat && p.boat.ride ? p.boat.y - 22 : p.y - 30) - S.cam.y;
    if (x < -60 || x > VW + 60 || y < -10 || y > VH + 10) return;
    ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(6,14,22,.55)';
    const w = ctx.measureText(p.name).width + 6;
    ctx.fillRect(x - w / 2, y - 7, w, 10);
    ctx.fillStyle = p.flagCol || '#9fb4c8';
    ctx.fillText(p.name, x, y);
    ctx.textAlign = 'left';
  }

  function drawChar(p, ghost) {
    // В лодке — своя поза: стоячий силуэт с шагающими ногами торчал из борта.
    const boat = ghost ? p.boat : S.boat;
    if (boat && boat.ride) return drawSeated(p, ghost, boat);
    // БЕЗ округления: камера дробная, и Math.round здесь заставлял фигуру
    // прыгать туда-сюда на целый пиксель — та самая тряска на месте и в ходьбе.
    const x = p.x - S.cam.x, d = p.dir;
    /* Высота фигуры СГЛАЖИВАЕТСЯ во времени. Физика осталась тайловой (шаг на
       ступень поднимает разом на 16 пикселей), а берег нарисован пологим — без
       этого сглаживания подъём по склону выглядел дёрганьем. Большой разрыв
       (прыжок, падение, телепорт) переносим мгновенно, иначе фигура «плывёт». */
    const tx = t2(p.x);
    const onRamp = p.onGround && tx >= 0 && tx < FISH_W && world.topH[tx] < FISH_WATER_Y;
    const target = onRamp ? shoreAt(p.x) : p.y;
    if (p._dy === undefined || Math.abs(target - p._dy) > 20 || !p.onGround) p._dy = target;
    else p._dy += (target - p._dy) * .3;
    const y = p._dy - S.cam.y;
    // Ходьба: одна фаза на всё тело. Ноги в противофазе, корпус чуть оседает на
    // опорной ноге, плечо ведёт за шагом — этого хватает, чтобы силуэт «жил».
    const ph = p.walk || 0, moving = p.onGround && Math.abs(p.vx || 0) > .12;
    const bob = moving ? -Math.abs(Math.cos(ph)) * .8 : 0;
    const g = rodGeom(p);
    const a = ghost ? .6 : 1;
    ctx.globalAlpha = a;
    drawFlag(x, y, d, bob, ghost ? p : null);        // древко за спиной, до тела

    const hipY = y - 9 + bob, shY = y - 17 + bob;    // таз и плечи
    const C = suitColors(ghost);
    // ── РАНЕЦ. Пишем до тела: он за спиной. Два шланга уходят к шлему.
    const px = x - d * 4.6;
    ctx.fillStyle = C.pack2;
    ctx.fillRect(px - 2.6, shY - 1.5, 5.2, 9.5);
    ctx.fillStyle = C.pack;
    ctx.fillRect(px - 2.6, shY - 1.5, 5.2, 4.2);
    ctx.fillStyle = C.trim; ctx.fillRect(px - 2.6, shY + 3.4, 5.2, 1);
    ctx.strokeStyle = C.hose; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, shY - 1); ctx.quadraticCurveTo(x - d * 5.6, shY - 5, x - d * 3.4, shY - 6.4);
    ctx.stroke();

    drawLeg(x, y, hipY, d, ph + Math.PI, moving, p.onGround !== false, C, true);   // дальняя нога
    // ── КОРПУС СКАФАНДРА: жёсткая кираса, книзу чуть шире, с нагрудным пультом.
    ctx.fillStyle = C.suit;
    ctx.beginPath();
    ctx.moveTo(x - 4.4, shY + .4); ctx.lineTo(x + 4.4, shY + .4);
    ctx.lineTo(x + 4.8, hipY + 1.6); ctx.lineTo(x - 4.8, hipY + 1.6);
    ctx.closePath(); ctx.fill();
    // Тень по нижней кромке и по дальней стороне — объём без единой лишней линии.
    ctx.fillStyle = C.shade;
    ctx.fillRect(d > 0 ? x - 4.7 : x + 2.7, shY + .4, 2, hipY + 1.6 - shY);
    // Нагрудный пульт с двумя огоньками — единственное цветное пятно на белом.
    ctx.fillStyle = C.panel; ctx.fillRect(x - 2.6 + d * .8, shY + 2.4, 5, 3.4);
    ctx.fillStyle = '#7ee0a0'; ctx.fillRect(x - 1.8 + d * .8, shY + 3.4, 1.2, 1.2);
    ctx.fillStyle = (Math.sin(S.time * 3) > 0) ? '#ffcf6b' : '#6a5a34';
    ctx.fillRect(x + .2 + d * .8, shY + 3.4, 1.2, 1.2);
    // Пояс с креплениями
    ctx.fillStyle = C.trim; ctx.fillRect(x - 4.7, hipY - 1.4, 9.5, 2.2);
    ctx.fillStyle = C.pack2; ctx.fillRect(x - 4.7, hipY - 1.4, 1.6, 2.2);
    ctx.fillRect(x + 3.1, hipY - 1.4, 1.6, 2.2);
    drawLeg(x, y, hipY, d, ph, moving, p.onGround !== false, C, false);   // ближняя нога
    // ── ШЕЙНОЕ КОЛЬЦО: без него шлем висел бы отдельно от плеч.
    ctx.fillStyle = C.trim;
    ctx.fillRect(x - 2.8, shY - 2.6, 5.6, 3);
    // ── РУКИ: дальняя придерживает комель, ближняя лежит на рукояти.
    // Наплечники — шары в суставе: без них рукав отрывался от кирасы.
    const arm = (fromX, fromY, toX, toY, w, col) => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(fromX, fromY);
      ctx.quadraticCurveTo((fromX + toX) / 2 + d * 1.5, (fromY + toY) / 2 + 2, toX, toY);
      ctx.stroke();
    };
    const gx = g.grip.x - S.cam.x, gy = g.grip.y - S.cam.y;
    const bx = g.butt.x - S.cam.x, by = g.butt.y - S.cam.y;
    arm(x - d * 1.5, shY + 1.4, bx, by, 2.2, C.shade);
    drawRod(g, a);
    arm(x + d * 2, shY + 1.6, gx, gy, 2.6, C.suit);
    ctx.fillStyle = C.suit;                                   // наплечник ближней руки
    ctx.beginPath(); ctx.arc(x + d * 2, shY + 1.6, 2.1, 0, 7); ctx.fill();
    ctx.fillStyle = C.trim; ctx.fillRect(gx - 1.6, gy - 1.6, 3.2, 3.2);   // перчатка
    drawHelmet(x + d * .6, shY - 7.4, d, ghost);
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    return g.tip;
  }

  // Лодка — долблёнка с задранными носом и кормой. Рисуется в СВОЕЙ системе
  // координат (центр корпуса, крен по волне), в ней же сидит гребец: так
  // человек качается вместе с бортом, а не висит над ним отдельной картинкой.
  // Начало координат — ватерлиния по центру, нос — в сторону d.
  function boatSpace(b) {
    ctx.save();
    ctx.translate(b.x - S.cam.x, b.y - S.cam.y);
    ctx.rotate(b.tilt);
  }

  // Корпус ниже борта: пишем ДО гребца, чтобы он сидел внутри, а не на крышке.
  // Лодка приходит аргументом: своя у меня, своя у каждого соседа.
  function drawBoatHull(b) {
    if (!b || !b.ride) return;
    boatSpace(b);
    // Тень на воде под днищем.
    ctx.fillStyle = 'rgba(4,14,26,.30)';
    ctx.beginPath(); ctx.ellipse(0, 4, 16, 2.4, 0, 0, 7); ctx.fill();
    // Днище: борта отваливают наружу, оконечности подняты.
    ctx.beginPath();
    ctx.moveTo(-17, -7); ctx.quadraticCurveTo(-14, 4, -8, 4.6);
    ctx.lineTo(9, 4.6); ctx.quadraticCurveTo(15, 4, 18, -7);
    ctx.lineTo(14, -5.5); ctx.quadraticCurveTo(11, 1.6, 6, 1.8);
    ctx.lineTo(-6, 1.8); ctx.quadraticCurveTo(-11, 1.6, -13.5, -5.5);
    ctx.closePath();
    ctx.fillStyle = '#4a3b2c'; ctx.fill();
    // Нутро — темнее борта, иначе лодка читается доской.
    ctx.fillStyle = '#2b2118';
    ctx.beginPath(); ctx.moveTo(-13.5, -5.5); ctx.quadraticCurveTo(-11, 1.6, -6, 1.8);
    ctx.lineTo(6, 1.8); ctx.quadraticCurveTo(11, 1.6, 14, -5.5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Борт и всё, что перед гребцом: пишем ПОСЛЕ него.
  function drawBoatFront(b, d) {
    if (!b || !b.ride) return;
    boatSpace(b);
    // Ближний борт — полоска поверх ног.
    ctx.fillStyle = '#5c4a38';
    ctx.beginPath(); ctx.moveTo(-15.5, -6.4); ctx.quadraticCurveTo(-12, 1.2, -6, 1.4);
    ctx.lineTo(6, 1.4); ctx.quadraticCurveTo(12, 1.2, 15.5, -6.4);
    ctx.lineTo(17.4, -7); ctx.quadraticCurveTo(14, 3.4, 8, 3.6);
    ctx.lineTo(-7, 3.6); ctx.quadraticCurveTo(-13, 3.4, -16.4, -7);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,236,200,.12)';   // блик по кромке борта
    ctx.beginPath(); ctx.moveTo(-16.4, -7); ctx.lineTo(-15.5, -6.4);
    ctx.lineTo(15.5, -6.4); ctx.lineTo(17.4, -7); ctx.closePath(); ctx.fill();
    // Банка (сиденье) — под гребцом, но видна перед ним.
    ctx.fillStyle = '#6b573f'; ctx.fillRect(-5, -2.4, 10, 1.6);
    // ВЕСЛО. Гребок: заносим — лопасть над водой, тянем — уходит в воду.
    const st = Math.sin(b.row * 2), lift = Math.max(0, st);
    const bl = { x: -d * (10 + st * 5), y: 5 - lift * 5.5 };
    ctx.strokeStyle = '#8b6b45'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(d * 5, -6.5); ctx.lineTo(bl.x, bl.y); ctx.stroke();
    ctx.fillStyle = '#7a5c3b';                 // лопасть
    ctx.save(); ctx.translate(bl.x, bl.y); ctx.rotate(Math.atan2(bl.y + 6.5, bl.x - d * 5));
    ctx.fillRect(-1.5, -2, 5, 4); ctx.restore();
    ctx.lineCap = 'butt';
    ctx.restore();
  }

  // Поза сидящего: ног не видно за бортом, корпус качает на гребке, руки
  // держат весло. Отдельная функция, потому что стоячая анимация (шаг, качание)
  // в лодке смотрится вывихом.
  function drawSeated(p, ghost, b) {
    const d = p.dir;
    const st = Math.sin(b.row * 2);
    const lean = st * 1.6;                      // корпус ходит взад-вперёд с гребком
    boatSpace(b);
    ctx.globalAlpha = ghost ? .6 : 1;
    drawFlagLocal(-d * 12, -6, d, ghost ? p : null);   // древко на корме
    const C = suitColors(ghost);
    const lx = lean * .5;
    // Ранец за спиной — виден над кормовым бортом.
    ctx.fillStyle = C.pack2; ctx.fillRect(-d * 4.6 - 2.4, -13, 4.8, 8);
    ctx.fillStyle = C.pack; ctx.fillRect(-d * 4.6 - 2.4, -13, 4.8, 3.4);
    // Ноги: колени согнуты в сторону носа, видна только верхняя кромка бедра
    // и наколенник — остальное за бортом.
    ctx.fillStyle = C.shade;
    ctx.fillRect(d > 0 ? 1 : -8, -4.6, 7, 3.4);
    ctx.fillRect(d > 0 ? 6 : -8, -7.6, 2.6, 4);
    ctx.fillStyle = C.suit;
    ctx.beginPath(); ctx.arc(d * 7.2, -7.2, 1.8, 0, 7); ctx.fill();
    // Кираса — та же, что стоя, только наклонённая: гребут всем телом.
    ctx.fillStyle = C.suit;
    ctx.beginPath();
    ctx.moveTo(lx - 4.4, -13.5); ctx.lineTo(lx + 4.4, -13.5);
    ctx.lineTo(4.8, -5); ctx.lineTo(-4.8, -5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.shade; ctx.fillRect(d > 0 ? lx - 4.4 : lx + 2.6, -13.5, 1.8, 8.5);
    ctx.fillStyle = C.panel; ctx.fillRect(lx - 2.4 + d * .8, -12, 4.6, 3.2);
    ctx.fillStyle = '#7ee0a0'; ctx.fillRect(lx - 1.6 + d * .8, -11.2, 1.2, 1.2);
    ctx.fillStyle = C.trim; ctx.fillRect(lx - 4.5, -7.2, 9, 2);        // пояс
    ctx.fillStyle = C.trim; ctx.fillRect(lx - 2.8, -16.2, 5.6, 2.9);   // шейное кольцо
    // Руки — от плеча к рукояти весла (та же точка, что в drawBoatFront).
    ctx.strokeStyle = C.suit; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(lx, -12); ctx.quadraticCurveTo(d * 3, -9.5, d * 5, -6.5); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = C.trim; ctx.fillRect(d * 5 - 1.5, -8, 3, 3);       // перчатка на рукояти
    drawHelmet(lx + d * .6, -20.4, d, ghost);
    ctx.globalAlpha = 1;
    ctx.restore();
    // Удочка и снасть живут в мировых координатах: их крен не касается —
    // иначе поплавок ездил бы по воде вместе с качкой.
    // Хват у сидящего ниже на четыре пикселя: он держит удилище у колен, а не
    // над плечом (ноги в лодке подобраны, «пол» под ним выше).
    const g = rodGeom({ x: p.x, y: p.y + 4, dir: d, rodA: p.rodA });
    if (lineOf(p, ghost).state !== 'idle') drawRod(g, ghost ? .6 : 1);
    return g.tip;
  }

  // Старик на поляне. Сидит, не встаёт, и так тут и будет сидеть.
  function drawNpc() {
    const wx = FISH_NPC_X * FISH_TILE + 8, wy = world.topH[FISH_NPC_X] * FISH_TILE;
    const x = wx - S.cam.x, y = wy - S.cam.y;
    if (x < -30 || x > VW + 30) return;
    const bob = Math.sin(S.time * .9) * .5;
    ctx.fillStyle = '#3e3a52'; ctx.fillRect(x - 5, y - 11 + bob, 10, 11);       // балахон
    ctx.fillStyle = '#524d6a'; ctx.fillRect(x - 5, y - 11 + bob, 10, 2);
    ctx.fillStyle = '#d9b28c'; ctx.fillRect(x - 3, y - 17 + bob, 6, 6);         // лицо
    ctx.fillStyle = '#cfd6e0'; ctx.fillRect(x - 4, y - 18 + bob, 8, 2);         // седина
    ctx.fillRect(x - 3, y - 12 + bob, 6, 3);                                    // борода
    ctx.fillStyle = '#101820'; ctx.fillRect(x + 1, y - 15 + bob, 1, 1);
    ctx.strokeStyle = '#7a6446'; ctx.lineWidth = 1.4;                           // посох
    ctx.beginPath(); ctx.moveTo(x + 7, y); ctx.lineTo(x + 6, y - 20); ctx.stroke();
  }

  // Всходы на поляне: росток → деревце → цветущее дерево (готово к сбору).
  function drawPlants() {
    for (const p of (_fishState && _fishState.plants) || []) {
      const tx = fClamp(p.x, 0, FISH_W - 1);
      const wx = tx * FISH_TILE + 8, wy = world.topH[tx] * FISH_TILE;
      const x = wx - S.cam.x, y = wy - S.cam.y;
      if (x < -40 || x > VW + 40) continue;
      const total = 24 * 3600, k = fClamp(1 - (p.left || 0) / total, 0, 1);
      const h = Math.round(4 + k * 26);
      ctx.fillStyle = '#5c4a38'; ctx.fillRect(x - 1, y - h, 2, h);
      const r = Math.round(3 + k * 9);
      ctx.fillStyle = p.ready ? '#7fd8a2' : '#3f6b4e';
      ctx.beginPath(); ctx.ellipse(x, y - h - r * .4, r, r * .8, 0, 0, 7); ctx.fill();
      if (p.ready) {                                   // созрело — светится
        ctx.globalAlpha = .35 + Math.sin(S.time * 2.4) * .2;
        ctx.fillStyle = '#cfa8ff';
        ctx.beginPath(); ctx.ellipse(x, y - h - r * .4, r + 3, r + 2, 0, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawLine(tip, F) {
    if (F.state === 'idle' || F.state === 'charge') return;
    const bx = F.bx - S.cam.x, by = F.by - S.cam.y, tx = tip.x - S.cam.x, ty = tip.y - S.cam.y;
    const sag = F.state === 'bite' ? 4 : 10;
    ctx.strokeStyle = `rgba(235,245,255,${F.state === 'bite' ? .8 : .5})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo((tx + bx) / 2, Math.max(ty, by) + sag, bx, by); ctx.stroke();
    ctx.fillStyle = '#e8503f'; ctx.fillRect(bx - 2, by - 3, 4, 3);
    ctx.fillStyle = '#f2f4f7'; ctx.fillRect(bx - 2, by, 4, 3);
    if (F.state === 'bite') {
      ctx.fillStyle = `rgba(255,225,120,${.6 + Math.sin(S.time * 22) * .4})`;
      ctx.fillRect(bx - 1, by - 20, 2, 7); ctx.fillRect(bx - 1, by - 11, 2, 2);
    }
  }

  function drawOverlayUi(night) {
    const F = S.F;
    if (F.state === 'charge') {
      const x = S.me.x - S.cam.x - 14, y = S.me.y - S.cam.y - 32;
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x, y, 28, 4);
      ctx.fillStyle = F.power > .92 ? '#ffcf6b' : '#8fd3ff'; ctx.fillRect(x + 1, y + 1, 26 * F.power, 2);
    }
    // Поклёвка: крик и утекающая полоска окна. Больше игроку знать нечего.
    if (F.state === 'bite') {
      const w = Math.round(fClamp(VW * .28, 100, 200)), x = (VW - w) / 2, y = VH - 40;
      ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd166'; ctx.fillText('ТЯНИ!', VW / 2, y - 6);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#22303f'; ctx.fillRect(x, y, w, 5);
      ctx.fillStyle = '#7ee0a0'; ctx.fillRect(x, y, w * fClamp(1 - F.t / F.react, 0, 1), 5);
    }
    if (S.flash > 0) { ctx.fillStyle = `rgba(255,230,170,${S.flash * .35})`; ctx.fillRect(0, 0, VW, VH); }
    if (night) { ctx.fillStyle = 'rgba(6,8,12,.16)'; ctx.fillRect(0, 0, VW, VH); }
    if (S.msgT > 0 && S.msg) {
      ctx.font = '10px monospace'; ctx.textAlign = 'center';
      const w = ctx.measureText(S.msg).width + 18;
      ctx.fillStyle = 'rgba(6,12,20,.82)'; ctx.fillRect((VW - w) / 2, 12, w, 18);
      ctx.fillStyle = '#e6eef8'; ctx.fillText(S.msg, VW / 2, 25);
      ctx.textAlign = 'left';
    }
    // Подсказка «E» — над головой, ровно когда есть что нажать.
    if (S.hint) {
      // Внизу кадра, а не над головой: там она перекрывала флаг державы и
      // полоску заброса — ровно то, на что игрок в этот момент и смотрит.
      ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      const hx = VW / 2, hy = VH - 12;
      const w = ctx.measureText(S.hint).width + 12;
      ctx.fillStyle = 'rgba(4,10,18,.70)'; ctx.fillRect(hx - w / 2, hy - 9, w, 12);
      ctx.fillStyle = '#cfe6fa'; ctx.fillText(S.hint, hx, hy);
      ctx.textAlign = 'left';
    }
    // глубина под поплавком — по ней игрок выбирает, куда бить
    if (['wait', 'bite'].includes(S.F.state)) {
      const tx = S.F.bx - S.cam.x + 7, ty = S.F.by - S.cam.y - 7;
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = 'rgba(4,10,18,.7)'; ctx.fillRect(tx - 3, ty - 9, ctx.measureText(S.F.depth + ' м').width + 6, 12);
      ctx.fillStyle = '#cfe6fa'; ctx.fillText(S.F.depth + ' м', tx, ty);
    }
  }

  /* ── петля ── */
  let prev = performance.now();
  function frame(now) {
    if (!S.alive) return;
    const dt = Math.min(.05, (now - prev) / 1000); prev = now; S.time += dt;
    const night = fishNightNow();
    updateBoat(dt); updatePlayer(dt); updateFishing(dt); updateFx(dt);
    FishNet.tick(dt);                     // догоняем соседей между их пакетами
    const act = nearAction();
    S.hint = act ? (act.txt || '') : '';
    const tgx = S.me.x - VW / 2 + S.me.dir * 26, tgy = S.me.y - VH * .62;
    S.cam.x = fClamp(fLerp(S.cam.x, tgx, .09), 0, FISH_W * FISH_TILE - VW);
    S.cam.y = fClamp(fLerp(S.cam.y, tgy, .07), -60, FISH_H * FISH_TILE - VH);
    // Камеру НЕ округляем: кадр теперь векторный, дробный сдвиг ему не вредит,
    // а любое округление здесь даёт рывок на целый экранный пиксель.

    // Фон воды: громкость — от того, насколько игрок у воды. Считаем редко,
    // раз в четверть секунды: подстройка гейна и так плавная.
    S.ambT = (S.ambT || 0) + dt;
    if (S.ambT > .25) {
      S.ambT = 0;
      const tx = t2(S.me.x);
      let d = 99;
      for (let i = 0; i <= 24; i++) {
        if ((tx - i >= 0 && world.wTop[tx - i] >= 0) || (tx + i < FISH_W && world.wTop[tx + i] >= 0)) { d = i; break; }
      }
      FishSfx.ambSet(S.boat.ride ? 1 : fClamp(1 - d / 24, 0, 1), night);
    }

    // Кадр под try: одна ошибка рисования не должна навсегда останавливать
    // петлю — берег замирал чёрным экраном, и выйти можно было только Esc.
    try {
      // Вода ПЕРЕД берегом: она заливает сплошное поле, а берег кладётся
      // поверх и сам режет линию уреза — иначе на стыке ступенчатой воды и
      // сглаженного силуэта оставались чёрные щели.
      drawSky(night); drawWater(night); drawUnderwater(); drawTiles();
      drawNpc(); drawPlants();
      drawHaze(night);
      drawBoatHull(S.boat);                 // днище — под гребцом
      for (const p of S.parts) { ctx.globalAlpha = fClamp(p.l, 0, 1); ctx.fillStyle = p.c; ctx.fillRect(p.x - S.cam.x, p.y - S.cam.y, 2, 2); }
      ctx.globalAlpha = 1;
      // Каждый сосед — со своей лодкой и своей снастью: борт пишем сразу после
      // его силуэта, иначе чужая лодка накрыла бы чужого гребца.
      for (const p of FishNet.peers.values()) {
        if (!p.seen) continue;
        drawBoatHull(p.boat);
        const tip = drawChar(p, true);
        drawBoatFront(p.boat, p.dir);
        drawLine(tip, p.line);
        drawPeerName(p);
      }
      const myTip = drawChar(S.me, false);
      drawBoatFront(S.boat, S.me.dir);       // борт и весло — поверх гребца
      drawLine(myTip, S.F);
      drawDust(dt, night);
      drawVignette();
      drawOverlayUi(night);
    } catch (e) { if (!S.drawErr) { S.drawErr = 1; console.warn('[fishing] draw', e); } }
    S.raf = requestAnimationFrame(frame);
  }
  S.raf = requestAnimationFrame(frame);

  // Экрану задали новый кадр: пересчитываем всё, что считалось от габаритов.
  // Смена canvas.width/height обнуляет состояние контекста — сглаживание
  // приходится гасить заново, иначе пиксели поплывут.
  S.onResize = (vw, vh, px) => {
    VW = vw; VH = vh;
    PX = px || PX;
    ctx.setTransform(PX, 0, 0, PX, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.lineJoin = ctx.lineCap = 'round';
    mkStars();
  };

  // Всходы зреют сутки, но «созрело» должно загораться без перезахода: раз в
  // минуту перечитываем поляну. Дешевле, чем таймер на каждое дерево.
  S.poll = setInterval(() => { if (S.alive) fishReload(); }, 60000);

  // Экранные кнопки дёргают те же коды клавиш, что и настоящая клавиатура:
  // логика движения остаётся одна на все устройства.
  S.setKey = (code, on) => { S.keys[code] = on ? 1 : 0; if (on && code === 'Space') FishSfx.wake(); };

  S.stop = () => {
    S.alive = false; cancelAnimationFrame(S.raf); clearInterval(S.poll);
    FishSfx.ambStop();
    removeEventListener('keydown', S.onKeyDown); removeEventListener('keyup', S.onKeyUp);
    removeEventListener('pointerup', S.onUp);
    canvas.removeEventListener('pointermove', S.onMove);
    canvas.removeEventListener('pointerdown', S.onDown);
  };
  return S;
}

/* ── подписи улова ──────────────────────────────────────────── */
const FISH_RARC = ['#9aa5b4', '#7ee0a0', '#79b6ff', '#c79bff', '#ffcf6b'];
// Названия классов осколков цикла — зеркало _build_coupons.sql.
const FISH_SHARD_NM = { corvette: 'корвет', destroyer: 'эсминец', mediumCruiser: 'средний крейсер', hyperCruiser: 'факельщик' };
function fishCatchLine(r) {
  const bits = [];
  if (Number(r.gc)) bits.push('+' + Math.round(r.gc).toLocaleString('ru-RU') + ' ГС');
  if (r.res && Number(r.res_n)) bits.push('+' + Number(r.res_n) + ' ' + r.res);
  if (r.shard) bits.push('осколок цикла: ' + (FISH_SHARD_NM[r.shard] || r.shard));
  // Артефакт — единственная добыча, ради которой стоит перечитать строку:
  // ставим его последним и с иконкой снаряжения.
  if (r.art) bits.push('🎒 артефакт: ' + ((r.art && r.art.label) || 'реликвия'));
  const kg = r.kg ? ' · ' + Number(r.kg).toFixed(2) + ' кг' : '';
  return (r.name || 'улов') + kg + (bits.length ? ' · ' + bits.join(' · ') : '');
}
// Сколько ещё расти — коротко, без секунд.
function fishLeft(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (s >= 3600) return Math.ceil(s / 3600) + ' ч';
  return Math.max(1, Math.ceil(s / 60)) + ' мин';
}
// Снять крючок и вернуть удочку в покой (сели в лодку, вымокли и т.п.).
function fishReset(F) {
  if (!F) return;
  F.state = 'idle'; F.id = null; F.power = 0; F.t = 0;
}
// Перечитать состояние берега (садок, семечко, всходы) без перезапуска игры.
async function fishReload() {
  try {
    _fishState = await ecRpc('fishing_get', {});
    _fishSite = (_fishState && _fishState.site) || _fishSite;
    fishPaintHud();
  } catch (e) {}
}
function fishErr(m) {
  const s = String(m || '');
  if (s.includes('too fast')) return 'Дай воде успокоиться';
  if (s.includes('no site')) return 'Реки нет на карте';
  if (s.includes('no water')) return 'Воды больше нет';
  if (s.includes('no faction')) return 'Сначала зарегистрируйте державу';
  if (s.includes('nothing on the hook')) return 'На крючке пусто';
  if (s.includes('stale hook')) return 'Этот заброс уже закрыт';
  if (s.includes('has seed')) return 'Семечко уже в руках';
  if (s.includes('no seed')) return 'Семечка нет';
  if (s.includes('busy:')) return 'Одно семечко в рост — дождись всхода';
  if (s.includes('occupied')) return 'Тут уже растёт';
  if (s.includes('poor')) return 'Не хватает ГС';
  if (s.includes('not ready')) return 'Ещё растёт';
  if (s.includes('not yours')) return 'Это чужое дерево';
  if (s.includes('gone:')) return 'Этого дерева уже нет';
  return (typeof ecErr === 'function') ? ecErr(s) : s;
}

/* ── HUD над канвасом (садок / трофей / хроника) ────────────── */
function fishAfterLand(r) {
  if (!_fishState) return;
  if (r && typeof r.kept === 'number') _fishState.kept = r.kept;
  if (r && !r.lost) _fishState.total = (_fishState.total || 0) + 1;
  fishPaintHud();
  // Деньги/наука/ТНП поменялись — перерисуем экономику остальной игры.
  if (r && !r.lost && r.counted && typeof ecReloadPaint === 'function') { try { ecReloadPaint(); } catch (e) {} }
}
function fishPaintHud() {
  const el = document.getElementById('fish-hud');
  if (!el || !_fishState) return;
  // Садка больше нет (_fishing_uncapped.sql: cap = 0 — «предела нет»), поэтому
  // kept — просто улов за сегодня. Ветку с квотой держим на случай, если
  // сервер снова начнёт отдавать cap > 0.
  const kept = _fishState.kept || 0, cap = Number(_fishState.cap) || 0;
  const best = _fishState.best;
  const night = fishNightNow();
  const mine = (_fishState.plants || []).filter(p => p.mine)[0];
  // Сколько нас у воды прямо сейчас (я + соседи в канале). Считаем от живых
  // силуэтов, а не от «побывавших сегодня»: берег общий и виден на глаз.
  const near = FishNet.peers.size;
  el.innerHTML = `
    <span class="fish-hud-i">${night ? '🌙 ночь' : '☀ день'}</span>
    <span class="fish-hud-i">у воды: <b>${near + 1}</b>${near ? '' : ' · вы один'}</span>
    <span class="fish-hud-i">${cap > 0
      ? `садок: <b class="${kept >= cap ? 'fish-full' : ''}">${kept}/${cap}</b>${kept >= cap ? ' · дальше без наград' : ''}`
      : `улов сегодня: <b>${kept}</b>`}</span>
    ${_fishState.seed > 0 ? '<span class="fish-hud-i">🌱 семечко в руках</span>' : ''}
    ${mine ? `<span class="fish-hud-i">🌳 ${mine.ready ? '<b>созрело</b>' : fishLeft(mine.left)}</span>` : ''}
    ${best ? `<span class="fish-hud-i">трофей: <b style="color:${FISH_RARC[best.rar || 0]}">${esc(best.name)}</b></span>` : ''}`;
}

/* ══════════════════════════════════════════════════════════════
   ЭКРАН НОВЕЛЛЫ
   ══════════════════════════════════════════════════════════════ */
function fishStyleOnce() {
  if (document.getElementById('fish-css')) return;
  const s = document.createElement('style');
  s.id = 'fish-css';
  s.textContent = `
  /* Игра идёт на ВЕСЬ экран отдельным слоем: колонка новеллы для берега
     тесна, а обрезанный кадр и был тем «маленьким окошком в пол-экрана». */
  .fish-fs{position:fixed;inset:0;z-index:140;background:#04070c;
    display:flex;flex-direction:column;font-family:inherit}
  .fish-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;padding:9px 16px;
    background:#080d14;border-bottom:1px solid var(--b1,#22303f)}
  .fish-bar-t{font-size:14px;font-weight:600;letter-spacing:.5px;color:var(--t1,#dfe7f2)}
  .fish-stage{position:relative;flex:1;min-height:0;display:grid;place-items:center;overflow:hidden}
  /* Шрифты крупнее и контрастнее прежних 11 px по --t4: с той подписи
     невозможно было прочитать ни глубину, ни управление. */
  .fish-hud{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:13px;color:#9db2c4}
  .fish-hud b{color:#eaf2fb;font-weight:600}
  .fish-hud .fish-full{color:var(--color-warning,#e0a030)}
  .fish-cv{display:block;cursor:crosshair;background:#05070c;touch-action:none}
  .fish-exit{margin-left:auto;padding:5px 14px;cursor:pointer;font:inherit;font-size:13px;
    background:var(--bg2,#101922);border:1px solid var(--b1,#22303f);color:var(--t1,#dfe7f2)}
  .fish-exit:hover{border-color:var(--acc,#8fd3ff)}
  .fish-keys{padding:8px 16px;font-size:12.5px;color:#8ea3b5;text-align:center;line-height:1.55;
    background:#080d14;border-top:1px solid var(--b1,#22303f)}
  .fish-keys b{color:#cfe0ee;font-weight:600}
  .fish-spot{display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;text-align:left;
    background:var(--bg2,#101922);border:1px solid var(--b1,#22303f);color:var(--t1,#dfe7f2);font:inherit}
  .fish-spot:hover{border-color:var(--acc,#8fd3ff)}
  .fish-lead{font-size:12.5px;color:var(--t3,#8aa0b0);line-height:1.6;max-width:560px;margin:0 auto;text-align:center}
  .fish-site{max-width:560px;margin:0 auto;padding:10px 0 2px;text-align:center}
  .fish-site-nm{font-size:15px;font-weight:600;color:var(--t1,#dfe7f2);letter-spacing:.3px}
  .fish-site-sub{font-size:11.5px;color:var(--t4,#6a7a88);margin-top:2px}
  .fish-site-kv{display:flex;flex-wrap:wrap;gap:4px 16px;justify-content:center;
    font-size:11.5px;color:var(--t3,#8aa0b0);margin-top:10px}
  .fish-site-kv b{color:var(--t1,#dfe7f2);font-weight:600}
  .fish-go{display:inline-flex;padding:8px 22px;margin-top:14px;cursor:pointer;
    background:var(--bg2,#101922);border:1px solid var(--acc,#8fd3ff);color:var(--t1,#dfe7f2);font:inherit}
  .fish-go:hover{background:var(--bg3,#16222e)}
  .fish-feed{max-width:560px;margin:6px auto 0;font-size:11.5px;color:var(--t3,#8aa0b0);line-height:1.6}
  .fish-feed div{padding:2px 0;border-bottom:1px solid var(--b1,#1b2732)}
  /* Разговор со стариком: узкая карточка поверх игры, ничего больше. */
  .fish-npc{position:absolute;inset:0;z-index:2;display:grid;place-items:center;
    background:rgba(4,7,12,.62)}
  .fish-npc-c{width:min(420px,88vw);padding:16px 18px;background:#0b121a;
    border:1px solid var(--b1,#22303f)}
  .fish-npc-t{font-size:14px;color:var(--t1,#dfe7f2);font-weight:600;margin-bottom:8px}
  .fish-npc-s{font-size:13px;color:#9db2c4;line-height:1.65}
  .fish-npc-b{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
  .fish-npc-b button{padding:7px 16px;cursor:pointer;font:inherit;font-size:13px;
    background:var(--bg2,#101922);border:1px solid var(--b1,#22303f);color:var(--t1,#dfe7f2)}
  .fish-npc-b button:hover:not(:disabled){border-color:var(--acc,#8fd3ff)}
  .fish-npc-b button:disabled{opacity:.45;cursor:default}

  /* ── звук ── */
  .fish-snd{margin-left:auto;width:34px;height:30px;cursor:pointer;font-size:15px;line-height:1;
    background:var(--bg2,#101922);border:1px solid var(--b1,#22303f);color:var(--t1,#dfe7f2)}
  .fish-snd:hover{border-color:var(--acc,#8fd3ff)}
  .fish-snd + .fish-exit{margin-left:0}

  /* ── экранные кнопки ──
     Слой лежит поверх кадра, но насквозь прозрачен для касаний: ловят только
     сами кнопки, всё между ними — по-прежнему вода, по которой забрасывают. */
  .fish-pad{position:absolute;left:0;right:0;bottom:0;z-index:3;pointer-events:none;
    display:flex;justify-content:space-between;align-items:flex-end;
    padding:0 14px calc(12px + env(safe-area-inset-bottom,0px));gap:12px}
  .fish-pad-l,.fish-pad-r{display:flex;gap:10px;pointer-events:none}
  .fish-btn{pointer-events:auto;width:58px;height:58px;border-radius:50%;
    display:grid;place-items:center;font:inherit;font-size:20px;line-height:1;
    background:rgba(10,18,26,.55);border:1px solid rgba(143,211,255,.35);color:#dfe7f2;
    touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
  .fish-btn.on{background:rgba(143,211,255,.28);border-color:var(--acc,#8fd3ff)}
  .fish-btn-e{font-size:16px;font-weight:600}

  /* ── адаптация ──
     Телефон: шапка в одну строку с переносом, подпись управления мельче,
     кадр отдаёт место кнопкам. Игра всё равно во весь экран. */
  @media (max-width:720px){
    .fish-bar{padding:7px 10px;gap:4px 10px}
    .fish-bar-t{font-size:12.5px}
    .fish-hud{font-size:11.5px;gap:3px 10px;width:100%;order:3}
    .fish-snd{order:1}
    .fish-exit{order:2;padding:4px 10px;font-size:12px}
    .fish-keys{font-size:11px;padding:6px 10px;line-height:1.5}
    .fish-npc-c{width:min(420px,92vw);padding:13px 14px}
  }
  /* Лежачий телефон: подпись управления съедает половину кадра — прячем её,
     кнопки на экране и так всё объясняют. */
  @media (max-height:480px) and (orientation:landscape){
    .fish-touch .fish-keys{display:none}
    .fish-touch .fish-bar{padding:4px 10px}
    .fish-btn{width:50px;height:50px;font-size:18px}
  }
  .fish-touch .fish-cv{cursor:default}
  .fish-touch .fish-stage{padding-bottom:0}
  `;
  document.head.appendChild(s);
}

/* ══════════════════════════════════════════════════════════════
   УПРАВЛЕНИЕ ПАЛЬЦЕМ
   ──────────────────────────────────────────────────────────────
   Ходьба, прыжок и «E» — экранные кнопки поверх кадра; заброс и подсечка
   остаются на самом берегу (палец по воде = ЛКМ), иначе целиться было бы
   нечем. Кнопки не перехватывают касание воды: они лежат по краям и
   прозрачны везде, кроме себя.
   ══════════════════════════════════════════════════════════════ */
function fishPadHtml() {
  return `<div class="fish-pad" id="fish-pad">
    <div class="fish-pad-l">
      <button type="button" class="fish-btn" data-key="ArrowLeft" aria-label="влево">◀</button>
      <button type="button" class="fish-btn" data-key="ArrowRight" aria-label="вправо">▶</button>
    </div>
    <div class="fish-pad-r">
      <button type="button" class="fish-btn fish-btn-e" data-act="e" aria-label="действие">E</button>
      <button type="button" class="fish-btn" data-key="Space" aria-label="прыжок">⤴</button>
    </div>
  </div>`;
}
function fishPadBind(root) {
  const pad = root.querySelector('#fish-pad');
  if (!pad) return;
  // Палец мог уехать с кнопки — «отпускание» ловим и по up, и по cancel, и по
  // уходу указателя: иначе игрок уходил бы влево до конца берега.
  const set = (el, on) => {
    const k = el.dataset.key;
    if (!k || !_fish) return;
    _fish.setKey(k, on);
    el.classList.toggle('on', on);
  };
  pad.addEventListener('pointerdown', e => {
    const b = e.target.closest('.fish-btn'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    FishSfx.wake(); FishSfx.ambStart();
    if (b.dataset.act === 'e') { b.classList.add('on'); if (_fish) _fish.doAction(); return; }
    try { b.setPointerCapture(e.pointerId); } catch (err) {}
    set(b, true);
  });
  const up = e => {
    const b = e.target.closest && e.target.closest('.fish-btn'); if (!b) return;
    e.preventDefault(); b.classList.remove('on'); set(b, false);
  };
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);
  pad.addEventListener('lostpointercapture', up);
  pad.addEventListener('contextmenu', e => e.preventDefault());
}

/* ══════════════════════════════════════════════════════════════
   СТАРИК НА ПОЛЯНЕ
   ══════════════════════════════════════════════════════════════ */
function fishNpcClose() { const el = document.getElementById('fish-npc'); if (el) el.remove(); }
function fishNpcOpen() {
  const host = document.getElementById('fish-fs');
  if (!host || document.getElementById('fish-npc')) return;
  const st = _fishState || {};
  const price = Number(st.seed_price || 200000), ich = Number(st.seed_ichor || 10);
  const gc = Number(st.gc || 0);
  const mine = (st.plants || []).filter(p => p.mine)[0];

  let line, btn;
  if (st.seed > 0) {
    line = 'Семечко у тебя... Посади его.';
    btn = '';
  } else if (mine) {
    line = mine.ready ? 'Ах... как быстро прошло время, правда? Будто его и не было...' : 'Терпение... Подожди еще ' + fishLeft(mine.left) + '.';
    btn = '';
  } else {
    line = 'Говорят, что архонт не смог умереть, и теперь живёт назло всем. Как это семечко... что прорастёт и даст ' + ich + ' ихора. Хочешь купить?';
    btn = `<button type="button" id="fish-buy"${gc < price ? ' disabled' : ''}
             onclick="event.stopPropagation();fishSeedBuy()">Купить — ${price.toLocaleString('ru-RU')} ГС</button>`;
  }

  const d = document.createElement('div');
  d.className = 'fish-npc'; d.id = 'fish-npc';
  d.innerHTML = `<div class="fish-npc-c">
      <div class="fish-npc-t">Старик у воды</div>
      <div class="fish-npc-s" id="fish-npc-s">${esc(line)}</div>
      <div class="fish-npc-b">${btn}
        <button type="button" onclick="event.stopPropagation();fishNpcClose()">Уйти</button></div>
    </div>`;
  host.appendChild(d);
}
async function fishSeedBuy() {
  const b = document.getElementById('fish-buy');
  if (b) b.disabled = true;
  try {
    await ecRpc('fishing_seed_buy', {});
    FishSfx.ui();
    await fishReload();
    const s = document.getElementById('fish-npc-s');
    if (s) s.textContent = 'Держи. Посади на поляне — и жди сутки.';
    if (b) b.remove();
    if (typeof ecReloadPaint === 'function') { try { ecReloadPaint(); } catch (e) {} }
  } catch (e) {
    const s = document.getElementById('fish-npc-s');
    if (s) s.textContent = fishErr(e && e.message);
    if (b) b.disabled = false;
  }
}

// Гасим игровую петлю и её слушатели. Звать перед любой сменой содержимого
// оверлея: иначе кадры продолжают рисоваться в оторванный от DOM канвас.
function fishStopGame() {
  if (_fish) { try { _fish.stop(); } catch (e) {} _fish = null; }
  if (_fishFit) { removeEventListener('resize', _fishFit); _fishFit = null; }
  if (_fishKick) { try { _fishKick(); } catch (e) {} _fishKick = null; }
  const fs = document.getElementById('fish-fs');
  if (fs) fs.remove();          // полноэкранный слой живёт ровно столько, сколько игра
  FishNet.stop();
}

function heroVNFishClose() {
  fishStopGame();
  const el = document.getElementById('hp-vn-fish');
  if (!el) return;
  el.classList.remove('show');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '';
  if (typeof _heroVNView !== 'undefined' && _heroVNView === 'fish') _heroVNView = null;
}
function heroVNFishReturn() { heroVNBack('fish'); }
function _fishHead(en) {
  return `<div class="hp-vn-col-head">
    <span class="hp-vn-col-title">🎣 ${en ? 'Down to the River' : 'Пойдём к реке'}</span>
    <span class="hp-vnr-clr">${en ? 'quiet here' : 'тут тихо'}</span>
    <button class="hp-vn-col-x" type="button" onclick="event.stopPropagation();heroVNFishReturn()">↩ ${en ? 'back' : 'назад'}</button>
  </div>`;
}
const _fishMsg = txt => `<div class="hp-vn-col-body"><div class="hp-vn-col-empty">${txt}</div></div>`;

async function heroVNFishOpen() {
  const el = document.getElementById('hp-vn-fish');
  if (!el) return;
  const en = (typeof lang !== 'undefined' && lang === 'en');
  fishStyleOnce();
  el.classList.add('show');
  el.setAttribute('aria-hidden', 'false');
  el.innerHTML = _fishHead(en) + _fishMsg(en ? 'Walking down…' : 'Иду к воде…');
  try {
    if (typeof ecLoadApp === 'function') await ecLoadApp();
    if (typeof EC === 'undefined' || !EC.app || !EC.app.faction_id) {
      if (!el.classList.contains('show')) return;
      el.innerHTML = _fishHead(en) + _fishMsg('Сначала зарегистрируйте державу.');
      return;
    }
    _fishState = await ecRpc('fishing_get', {});
    _fishSite = (_fishState && _fishState.site) || null;
    if (!el.classList.contains('show')) return;
    fishPaintSite();
  } catch (e) {
    if (!el.classList.contains('show')) return;
    el.innerHTML = _fishHead(en) + _fishMsg(esc(fishErr(e && e.message)));
  }
}

// Локация: одна на всю галактику. Здесь не выбирают, куда пойти — здесь
// решают, спускаться к воде или нет.
function fishPaintSite() {
  const el = document.getElementById('hp-vn-fish');
  if (!el || !_fishState) return;
  fishStopGame();          // поднялись на берег — гасим петлю, а не прячем канвас
  const en = (typeof lang !== 'undefined' && lang === 'en');
  const site = _fishSite;
  const feed = Array.isArray(_fishState.feed) ? _fishState.feed : [];
  const kept = _fishState.kept || 0, cap = Number(_fishState.cap) || 0;   // cap 0 = садка нет

  let body;
  if (!site) {
    body = `<div class="fish-lead">Реки нет на карте.</div>`;
  } else if (!site.wet) {
    // Планету стёрли Дланью — берег сгорел вместе с миром (см. _doom_resolve).
    body = `<div class="fish-site">
        <div class="fish-site-nm">${esc(site.name)}</div>
        <div class="fish-site-sub">система «${esc(site.sysname)}»</div>
      </div>
      <div class="fish-lead" style="margin-top:12px">Воды больше нет.</div>`;
  } else {
    const mine = (_fishState.plants || []).filter(p => p.mine)[0];
    body = `<div class="fish-site">
        <div class="fish-site-nm">🏞 ${esc(site.name)}</div>
        <div class="fish-site-sub">система «${esc(site.sysname)}»</div>
        <div class="fish-site-kv">
          <span>${cap > 0
            ? `садок: <b class="${kept >= cap ? 'fish-full' : ''}">${kept}/${cap}</b>`
            : `улов сегодня: <b>${kept}</b>`}</span>
          <span>${_fishState.night ? '🌙 ночь' : '☀ день'}</span>
          ${_fishState.seed > 0 ? '<span>в руках: <b>семечко мира</b></span>' : ''}
          ${mine ? `<span>дерево: <b>${mine.ready ? 'созрело' : fishLeft(mine.left)}</b></span>` : ''}
          ${_fishState.pilgrims > 0 ? `<span>сегодня у воды: <b>${_fishState.pilgrims}</b></span>` : ''}
        </div>
        <button class="fish-go" onclick="event.stopPropagation();fishDescend()">Пойти к реке</button>
      </div>
      <div class="fish-lead" style="margin-top:14px">Тут тихо.</div>`;
  }

  const feedHtml = feed.length
    ? `<div class="fish-feed"><div style="color:var(--t4,#6a7a88);border:0">хроника берега</div>${feed.map(f => `<div${f.me ? ' style="color:var(--t1,#dfe7f2)"' : ''}>${esc(f.txt)}</div>`).join('')}</div>`
    : '';

  el.innerHTML = _fishHead(en) + `<div class="hp-vn-col-body">${body}${feedHtml}</div>`;
}

// Спустились к воде — строим берег и запускаем игру.
function fishDescend() {
  const el = document.getElementById('hp-vn-fish');
  if (!el || !_fishSite || !_fishSite.wet) return;
  const en = (typeof lang !== 'undefined' && lang === 'en');
  fishStyleOnce();
  // Гасим прошлую петлю ДО того, как строим слой: fishStopGame() сносит и
  // сам слой, и обработчик resize — позовёшь его позже, и он убьёт только
  // что созданный экран.
  fishStopGame();

  // Слой игры живёт в body, а не в колонке новеллы: так он занимает весь
  // экран независимо от вёрстки обложки (та ограничена position:absolute).
  const fs = document.createElement('div');
  fs.className = 'fish-fs'; fs.id = 'fish-fs';
  const touch = fishTouch();
  fs.className = 'fish-fs' + (touch ? ' fish-touch' : '');
  fs.innerHTML = `<div class="fish-bar">
      <span class="fish-bar-t">🎣 ${en ? 'Down to the River' : 'Пойдём к реке'}</span>
      <div class="fish-hud" id="fish-hud"></div>
      <button class="fish-snd" id="fish-snd" type="button" title="${FishSfx.on ? 'звук включён' : 'звук выключен'}"
        onclick="event.stopPropagation();fishSoundToggle()">${FishSfx.on ? '🔊' : '🔇'}</button>
      <button class="fish-exit" type="button" onclick="event.stopPropagation();fishPaintSite()">↩ ${en ? 'back' : 'уйти'}</button>
    </div>
    <div class="fish-stage" id="fish-stage"><canvas class="fish-cv" id="fish-cv"
      width="${FISH_VW}" height="${FISH_VH}"></canvas>${touch ? fishPadHtml() : ''}</div>
    <div class="fish-keys" id="fish-keys">${touch
      ? '<b>◀ ▶</b> — идти · <b>⤴</b> — прыжок · <b>E</b> — лодка и разговор ·<br>' +
        'палец по воде: <b>держи и отпусти</b> — заброс, <b>тапни на поклёвке</b> — подсечь'
      : '<b>A/D</b> — идти · <b>Space</b> — прыжок · ' +
        '<b>ЛКМ</b> зажать и отпустить — заброс (дольше держишь — дальше) · ' +
        '<b>ЛКМ</b> когда клюнуло — подсечь · <b>E</b> — лодка и разговор · <b>Esc</b> — уйти'}</div>`;
  document.body.appendChild(fs);
  if (touch) fishPadBind(fs);
  // Шум воды поднимаем ПРЯМО ЗДЕСЬ: «Пойти к реке» — уже жест игрока, значит
  // контекст разрешён. Раньше берег молчал, пока не тронешь удочку, и первые
  // полминуты место казалось мёртвым.
  FishSfx.wake(); FishSfx.ambStart(); FishSfx.ambSet(.5, fishNightNow());
  // Если браузер всё же придержал контекст (Safari поднимает его только на
  // «настоящем» касании) — добираем звук на первом же тычке или клавише.
  const kick = () => { FishSfx.wake(); FishSfx.ambStart(); };
  fs.addEventListener('pointerdown', kick);
  addEventListener('keydown', kick);
  _fishKick = () => { fs.removeEventListener('pointerdown', kick); removeEventListener('keydown', kick); };
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

  const cv = document.getElementById('fish-cv');
  // Кадр подгоняем под ЭКРАН, а не экран под кадр: зум остаётся целым (пиксель
  // не должен плыть), а сам логический кадр растягивается по свободному месту.
  const fit = () => {
    const stage = document.getElementById('fish-stage');
    if (!stage || !cv.isConnected) return;
    const r = stage.getBoundingClientRect();
    const availW = Math.max(320, r.width), availH = Math.max(220, r.height);
    // Зум берём по высоте, но не крупнее, чем позволяет ширина: иначе на
    // узком экране берег раздувался и в кадр влезала пара тайлов.
    const k = fClamp(Math.min(Math.round(availH / FISH_VH), Math.floor(availW / 420)), 1, 6);
    const vw = Math.round(fClamp(availW / k, 360, 960));
    const vh = Math.round(Math.min(fClamp(availH / k, 200, 460), vw * .8));
    // Буфер — в НАТИВНОМ разрешении экрана, а кадр остаётся логическим:
    // рисуем всё в координатах vw×vh через трансформ, поэтому векторный фон
    // выходит чётким на любом dpr, а не растянутым квадратами.
    const dpr = Math.min(3, devicePixelRatio || 1), px = k * dpr;
    const bw = Math.round(vw * px), bh = Math.round(vh * px);
    if (cv.width !== bw || cv.height !== bh || cv.dataset.vw !== String(vw)) {
      cv.width = bw; cv.height = bh;
      cv.dataset.vw = String(vw); cv.dataset.vh = String(vh);
      if (_fish) _fish.onResize(vw, vh, px);
    }
    cv.style.width = vw * k + 'px'; cv.style.height = vh * k + 'px';
    cv.dataset.scale = String(k);
  };
  // Сид берега — адрес места, а не игрока: у всех держав один и тот же берег.
  const world = FishWorld(fSeedOf(_fishSite.sys + '#' + _fishSite.pid),
                          Number(_fishSite.maxdepth) || FISH_SITE_DEPTH);
  fishFlagLoad();                      // с кем пришли — с тем и флаг
  _fish = fishStart(cv, world);
  fit();
  requestAnimationFrame(fit);          // вёрстка вокруг могла ещё не устояться
  _fishFit = fit;
  addEventListener('resize', fit);
  FishNet.start();
  fishPaintHud();
}

// Перерисовка при обновлении экономики (зовётся из ecReloadPaint как остальные экраны).
function heroVNFishRefresh() {
  const el = document.getElementById('hp-vn-fish');
  if (!el || !el.classList.contains('show')) return;
  if (_fish) fishPaintHud();   // идёт игра — не рушим её перерисовкой, обновляем только шапку
}
