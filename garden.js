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

// ══════════════════════════════════════════════════════════════════════════
// МАСШТАБ. Корабль — эталон: корвет длиной ~3 единицы. Всё остальное меряется
// ОТ НЕГО, и именно тут задаётся «пространство», а не в размере спрайта.
// ⚠️ РАНЬШЕ МИР БЫЛ РАЗМЕРОМ С КОРАБЛЬ. Тело имело радиус .3–1.15 единицы, то
// есть было ВТРОЕ МЕЛЬЧЕ корвета; звезда — 2–3.4, чуть крупнее его. Оттого
// корвет и выходил «в треть звезды»: не спрайт был велик, а мир мал.
// Теперь тело крупнее корабля в ~90 раз (GD_BODY_K), а расстояния между телами
// растянуты ещё сильнее (GD_ORB_K): между орбитами лететь надо, а не шагнуть.
const GD_BODY_K = 90;                // во столько тела крупнее прежнего
const GD_ORB_K = 260;                // во столько разнесены орбиты и системы
const GD_SPACING = 115 * GD_ORB_K;   // на столько разводим СОСЕДНИЕ системы
const GD_PLAT = 15 * GD_ORB_K;       // радиус площадки вокруг светила (в единицах)
const GD_REACH = 2.6 * GD_ORB_K;     // на сколько дотягивается манипулятор
// ⚠️ СКОРОСТЬ НЕ УМНОЖАЕТСЯ НА МАСШТАБ МИРА. Я так сделал — и корабль стал
// проходить ~1500 ЭКРАННЫХ пикселей за кадр: не полёт, а телепорт с рывками
// каждый кадр. Скорость меряется тем, сколько кадр занимает НА ЭКРАНЕ, и её
// потолок задаёт читаемость, а не размер мира. 200 единиц/с — это система
// поперёк примерно за двадцать секунд.
const GD_SPEED = 200;                // единиц в секунду обычным ходом
const GD_LIFT = 12;                  // толщина площадки (px)

// Рукава. p — плита площадки, d — её тень и скол, t — светлая жила,
// x — акцент обломков. Гамма холодная: цвет различает рукава, а не кричит.
// ══════════════════════════════════════════════════════════════════════════
// ОРБИТАЛЬНЫЕ ПОЯСА
// ══════════════════════════════════════════════════════════════════════════
// ⚠️ ВЫСОТА МЕРЯЕТСЯ РАДИУСАМИ ПЛАНЕТЫ, А НЕ НА ГЛАЗОК. Прежнее «кольцо в 3.2
// радиуса» было числом из ниоткуда: и грядки, и камни висели там, где красиво,
// а не там, где вещи висят. Считаем от земных высот (планета = 6371 км):
//   VLEO  100–450 км   → 1.016–1.071 R   атмосфера ещё тормозит, высоту держат
//   НОО   450–2000 км  → 1.071–1.314 R   станции, съёмка, ВЕСЬ мусор
//   СОО   2000–35786   → 1.314–6.616 R   навигация
//   ГСО   35786 км     → 6.616 R         висит над одной точкой экватора
//   свалка +200–300 км → 6.66 R          сюда уводят отработавшее
// Грядки живут на НОО (там же, где станции), камни ловятся там же — потому что
// именно на НОО и копится мусор. ГСО — внешняя кромка сцены.
const GD_RP = 46;                       // радиус планеты в единицах мира
const GD_SHELL = {
  vleo: 1.016, vleoTop: 1.071,
  leo: 1.071, leoTop: 1.314,
  meo: 1.314, meoTop: 6.616,
  geo: 6.616, grave: 6.66,
};
// ⚠️ САД — ЭТО ПОСТРОЙКА, А НЕ РОССЫПЬ ТОЧЕК. Орбитальное кольцо на НОО: обод
// из двух рельсов, между ними отсеки-теплицы. Своих отсеков у державы десятки,
// всего на ободе их GD_BAYS — остальное стоит тёмным железом. Это и есть мир:
// видно, что кольцо больше тебя и что ты на нём поселенец.
const GD_RING = 1.19;                   // высота обода в радиусах планеты (НОО)
// Пояс обломков — НАРУЖУ от сада, на средних орбитах. Над грядками камней быть
// не должно: там работают, а не ловят (см. seedAsteroids).
const GD_BELT = { lo: 1.85, hi: 3.4 };
const GD_BAYS = 48;                     // отсеков по всему ободу
const GD_RINGW = 3.1;                   // полуширина обода в единицах мира

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

// ══════════════════════════════════════════════════════════════
// ОБЛИК ФАКЕЛЬЩИКА: ШЛЯПА И РАСЦВЕТКА
// ══════════════════════════════════════════════════════════════
// Единственная вещь в саду, которая ничего не даёт в цифрах, — и потому
// единственная, которую выбирают ДЛЯ СЕБЯ. Держим в localStorage: это не
// собственность державы и не предмет, а то, как игрок себя тут видит; гонять
// ради шляпы RPC и таблицу — лишняя цепочка и лишний egress.
//
// ⚠️ ШЛЯПУ РИСУЕТ ОДНА ФУНКЦИЯ ДЛЯ ВСЕХ. Она нужна и кораблю в кадре, и
// плиткам выбора в меню; вторая копия «примерно такой же» разъедется с первой
// на первой же правке, и в меню будешь выбирать не то, что увидишь в игре.
const GD_LOOK_KEY = 'gd_look_v1';
const GD_HATS = ['straw', 'cap', 'cat', 'helm'];
const GD_HAT_NM = { straw: 'соломенная', cap: 'фуражка', cat: 'кот в шлеме', helm: 'шлем' };
// Расцветка — это КОРПУС, а не герб: цвет державы остаётся полосой по борту
// (принадлежность), а корпус игрок красит как хочет.
const GD_HULLS = {
  steel:  { nm: 'сталь',   a: '#38434f', b: '#222b35', c: '#151b23', t: '#8fd3ff' },
  copper: { nm: 'медь',    a: '#6b4a2c', b: '#43301d', c: '#271c12', t: '#e0a34a' },
  bone:   { nm: 'кость',   a: '#b8b1a1', b: '#8a8478', c: '#5c584f', t: '#ffe6b0' },
  moss:   { nm: 'хвоя',    a: '#33513f', b: '#22362a', c: '#15211a', t: '#7fd6a3' },
  void:   { nm: 'пустота', a: '#2c2740', b: '#1b1828', c: '#0e0c16', t: '#c7a6ff' },
};
const GD_LOOK = { hat: 'straw', hull: 'steel' };
(function gdLookLoad() {
  try {
    const j = JSON.parse(localStorage.getItem(GD_LOOK_KEY) || '{}');
    if (GD_HATS.includes(j.hat)) GD_LOOK.hat = j.hat;
    if (GD_HULLS[j.hull]) GD_LOOK.hull = j.hull;
  } catch (e) {}
})();
function gdLookSet(k, v) {
  if (k === 'hat' && !GD_HATS.includes(v)) return;
  if (k === 'hull' && !GD_HULLS[v]) return;
  GD_LOOK[k] = v;
  try { localStorage.setItem(GD_LOOK_KEY, JSON.stringify(GD_LOOK)); } catch (e) {}
}

// Шляпа сверху, в своих координатах: центр в нуле, R — половина ширины полей.
// Ни одной пульсации — только форма (см. HAT: живёт лишь наклон).
function gdDrawHat(ctx, R, kind) {
  const k = kind || GD_LOOK.hat;
  if (k === 'cap') {
    // Фуражка: козырёк вперёд (нос корабля — вправо), тулья, кокарда.
    ctx.fillStyle = '#1b2733';
    ctx.beginPath(); ctx.ellipse(R * .34, 0, R * .62, R * .58, 0, -1.6, 1.6); ctx.fill();
    ctx.strokeStyle = 'rgba(8,12,17,.8)'; ctx.lineWidth = R * .05; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, R * .78, R * .74, 0, 0, 7);
    ctx.fillStyle = '#2b3947'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#141c25';                                       // околыш
    ctx.beginPath(); ctx.ellipse(0, 0, R * .52, R * .49, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#e0a34a';                                       // кокарда
    ctx.beginPath(); ctx.arc(R * .3, 0, R * .11, 0, 7); ctx.fill();
    return;
  }
  if (k === 'cat') {
    // ⚠️ ЗДЕСЬ БЫЛ КАПЮШОН, И СВЕРХУ ОН ЧИТАЛСЯ НЕПРИЛИЧНО: капля с острым
    // концом назад и тёмным овалом лица — форма, которую глаз опознаёт совсем
    // не как одежду. Вместо неё спящий кот в шлеме космонавта: круг читается
    // однозначно, а свернувшийся зверь узнаётся даже в двадцать пикселей.
    // Голова смотрит вперёд (нос корабля — вправо), хвост уложен назад.
    const bg = ctx.createRadialGradient(-R * .2, -R * .25, R * .05, 0, 0, R * .92);
    bg.addColorStop(0, '#2a3442'); bg.addColorStop(1, '#131a23');
    ctx.beginPath(); ctx.arc(0, 0, R * .9, 0, 7);
    ctx.fillStyle = bg; ctx.fill();

    ctx.save(); ctx.clip();                       // всё зверьё — внутри шлема
    // Хвост кольцом вокруг тела: сначала он, чтобы тело легло сверху.
    ctx.strokeStyle = '#c8a06a'; ctx.lineWidth = R * .17; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(-R * .05, R * .12, R * .48, -.35, 2.5); ctx.stroke();
    // Тело клубком.
    ctx.fillStyle = '#e0b87e';
    ctx.beginPath(); ctx.ellipse(-R * .12, 0, R * .56, R * .48, 0, 0, 7); ctx.fill();
    // Голова.
    ctx.fillStyle = '#eec98f';
    ctx.beginPath(); ctx.ellipse(R * .34, 0, R * .36, R * .34, 0, 0, 7); ctx.fill();
    // Уши: прижаты к голове, потому и торчат вбок, а не вверх.
    ctx.beginPath();
    ctx.moveTo(R * .3, -R * .3); ctx.lineTo(R * .12, -R * .56); ctx.lineTo(R * .44, -R * .42);
    ctx.moveTo(R * .3, R * .3); ctx.lineTo(R * .12, R * .56); ctx.lineTo(R * .44, R * .42);
    ctx.closePath(); ctx.fill();
    // Спит: глаза — две дуги, а не точки. Точками кот выходит бодрым.
    ctx.strokeStyle = '#5a442a'; ctx.lineWidth = R * .05; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(R * .42, -R * .16, R * .1, -2.5, -.6); ctx.stroke();
    ctx.beginPath(); ctx.arc(R * .42, R * .16, R * .1, .6, 2.5); ctx.stroke();
    ctx.fillStyle = '#c47b86';                                        // нос
    ctx.beginPath(); ctx.arc(R * .62, 0, R * .06, 0, 7); ctx.fill();
    ctx.restore();

    // Стекло: блик и обод. Без блика шар не читается стеклом.
    ctx.globalAlpha = .3;
    const gl = ctx.createLinearGradient(-R * .6, -R * .6, R * .4, R * .5);
    gl.addColorStop(0, '#dff1ff'); gl.addColorStop(.55, 'rgba(223,241,255,0)');
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.arc(0, 0, R * .9, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#8fd3ff'; ctx.lineWidth = R * .07;
    ctx.beginPath(); ctx.arc(0, 0, R * .9, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(10,15,21,.85)'; ctx.lineWidth = R * .03;
    ctx.beginPath(); ctx.arc(0, 0, R * .96, 0, 7); ctx.stroke();
    return;
  }
  if (k === 'helm') {
    // Шлем: полусфера с визором поперёк и гребнем вдоль.
    const g = ctx.createRadialGradient(-R * .25, -R * .3, R * .05, 0, 0, R * .84);
    g.addColorStop(0, '#c3cedb'); g.addColorStop(.6, '#7d8b9b'); g.addColorStop(1, '#3c4753');
    ctx.beginPath(); ctx.ellipse(0, 0, R * .84, R * .8, 0, 0, 7);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(20,28,37,.8)'; ctx.lineWidth = R * .06; ctx.stroke();
    ctx.fillStyle = 'rgba(143,211,255,.85)';                         // визор
    ctx.beginPath(); ctx.ellipse(R * .4, 0, R * .2, R * .44, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(30,40,52,.9)';                             // гребень
    ctx.fillRect(-R * .8, -R * .07, R * 1.2, R * .14);
    return;
  }
  // Соломенная: поля, плетение, лента, тулья.
  ctx.beginPath(); ctx.ellipse(0, 0, R, R * .9, 0, 0, 7);
  const g = ctx.createRadialGradient(-R * .3, -R * .35, R * .05, 0, 0, R);
  g.addColorStop(0, '#e9d097'); g.addColorStop(.62, '#cbab68'); g.addColorStop(1, '#96793f');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(64,49,24,.6)'; ctx.lineWidth = R * .05; ctx.stroke();
  ctx.strokeStyle = 'rgba(122,96,49,.4)'; ctx.lineWidth = R * .022;
  for (let kk = .42; kk < .96; kk += .26) {
    ctx.beginPath(); ctx.ellipse(0, 0, R * kk, R * kk * .9, 0, 0, 7); ctx.stroke();
  }
  ctx.fillStyle = '#3d4f62';
  ctx.beginPath(); ctx.ellipse(0, 0, R * .42, R * .38, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#dcbf80';
  ctx.beginPath(); ctx.ellipse(0, -R * .03, R * .34, R * .3, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(64,49,24,.5)'; ctx.lineWidth = R * .028;
  ctx.beginPath(); ctx.ellipse(0, -R * .03, R * .34, R * .3, 0, 0, 7); ctx.stroke();
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
function GardenWorld(systems, sectors, hyperlanes) {
  // ═══ МАСШТАБ ЗАВИСИТ ОТ ТОГО, СКОЛЬКО СИСТЕМ В МИРЕ ═══
  // ⚠️ НАТУРАЛЬНАЯ ВЕЛИЧИНА И ЕСТЬ ТО, ОТ ЧЕГО ЭКРАН БЫЛ ПУСТ. На галактическом
  // масштабе (GD_BODY_K/GD_ORB_K) тело — доли процента своей орбиты: кадр
  // шириной в восемьдесят единиц летит между орбитами в тысячу единиц десятками
  // секунд, и всё это время в нём НЕТ НИЧЕГО — ни звезды, ни планет. Это
  // честно и абсолютно неиграбельно. Поэтому у ОДИНОЧНого мира (Храм) свой
  // набор мер: светило — сотни пикселей в кадре, планета — читаемый диск,
  // между орбитами два-три экрана, система целиком — полминуты ходу.
  // Скорость, длина манипулятора и размер корабля едут ТЕМ ЖЕ набором: разойдись
  // они с геометрией — и корабль снова окажется то ростом с планету, то телепортом.
  const solo = (systems || []).length === 1;
  const BK = solo ? 7 : GD_BODY_K;        // крупность тел
  const OK = solo ? 2.5 : GD_ORB_K;         // разнос орбит
  const SK = solo ? .58 : 3.2;   // корабль < планеты < звезда — именно в таком порядке              // во сколько светило крупнее тела
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
    const base = grp === 'micro' ? .30
      : grp === 'belt' ? .42
      : grp === 'anomaly' ? .5
      : ['gasgiant', 'icegiant', 'hotgiant'].includes(grp) ? 1.15
      : .48 + Math.min(.34, cells * .02);
    return base * BK;
  };

  const nodes = raw.map(n => {
    const seed = gSeedOf(n.id || '') % 997;
    const list = ((n.sys && n.sys.planets) || []).filter(p => p && p.name);
    // Светило: гигант заметно крупнее, плюс лёгкая надбавка за населённость —
    // богатая система должна и выглядеть весомее.
    // ⚠️ ЗВЕЗДА КРУПНЕЕ САМОГО КРУПНОГО ТЕЛА, А НЕ КОРАБЛЯ. Прежние 2–3.4
    // единицы означали светило ростом с корвет — от этого весь мир и читался
    // макетом. Меряем её той же линейкой, что и тела.
    const starR = ((n.giant ? 3.4 : 2.0) + Math.min(.6, list.length * .05)) * BK * SK;

    const bodies = [];
    let orb = starR * 2.6, prev = 0;
    list.forEach((p, i) => {
      const grp = grpOf(p), r = bodyR(p, grp);
      // ⚠️ МЕЖДУ ОРБИТАМИ — ПУСТОТА, А НЕ ЗАЗОР В ПОЛТЕЛА. Разнос считается от
      // GD_ORB_K: тело занимает доли процента своей орбиты, как и положено, и
      // от планеты до планеты надо ЛЕТЕТЬ.
      orb += prev + r + (.85 + gHash(seed, i, 71) * .5) * OK * 4;
      prev = r;
      bodies.push({
        name: p.name, grp, r, orb, p,
        seed: (gSeedOf(p.name || '') % 977) + i * 7,       // рисунок тела — по нему
        a0: gHash(seed + i, i * 7, 73) * Math.PI * 2,
        sp: .045 / Math.sqrt(orb),                        // дальние идут медленнее
        belt: grp === 'belt',
      });
    });
    const extent = bodies.length ? bodies[bodies.length - 1].orb + bodies[bodies.length - 1].r
                                 : starR * 2.2;
    return {
      id: n.id, name: n.name, sys: n.sys, sec: n.sec, giant: n.giant,
      stype: (n.sys && n.sys.star_type) || 'yellow',      // текстура светила с карты
      tx: n.rx, ty: n.ry,                                 // масштаб применим ниже
      starR, bodies, seed,
      R: Math.max(extent * 1.16, starR * 2.6),            // площадка охватывает систему
    };
  });

  // ⚠️ МЕСТО ДЕЙСТВИЯ — ОРБИТА ПЛАНЕТЫ, А НЕ СИСТЕМА ЦЕЛИКОМ. Система, даже
  // ужатая соло-мерами, остаётся сценой не того калибра: планета в ней — диск в
  // несколько единиц, грядка на её фоне пылинка, и между орбитами снова летишь
  // по пустоте. Сад разбит НА ОРБИТЕ той планеты, где раньше ловили рыбу:
  // планета занимает кадр, грядки идут кольцом над ней, камни дрейфуют снаружи.
  // Светило и прочие тела со сцены уходят — они за кадром, как берег с воды.
  if (solo && nodes[0]) {
    const n = nodes[0];
    const list = n.bodies.filter(b => !b.belt);
    const host = list.find(b => /храм/i.test(b.name || '')) || list[0];
    if (host) {
      host.r = GD_RP;                    // планета в единицах: она И ЕСТЬ кадр
      n.host = host;
      n.starR = host.r;                  // якорь площадки — планета, не звезда
      n.bodies = [];                     // остальные орбиты со сцены убраны
      n.R = GD_RP * GD_SHELL.geo;        // площадка кончается на геостационаре
      n.name = host.name || n.name;
    }
  }

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
  // ⚠️ У ОДИНОЧНОЙ СИСТЕМЫ ГРАНИЦА СЧИТАЕТСЯ ОТ НЕЁ, А НЕ ОТ РАЗНОСА СОСЕДЕЙ.
  // Мир теперь один Храм (см. gardenDescend): запас в GD_SPACING дал бы вокруг
  // него тридцать тысяч единиц ровного ничего — лететь в никуда полминуты и
  // упереться в невидимую стену. Держим кольцо пустоты вокруг площадки: его
  // хватает и на гипер, и на трал, и край читается как окраина системы.
  const pad = solo ? nodes[0].R * 2.6 : GD_SPACING;
  const bounds = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  const N = Math.max(x1 - x0, y1 - y0) + pad * 2;      // для миникарты и клампов

  // Радиус площадки в данном направлении: кромка рваная, но плавная.
  function platR(n, ang) {
    return n.R * (1
      + Math.sin(ang * 3 + n.seed) * .13
      + Math.sin(ang * 5 - n.seed * .7) * .07
      + (gNoise(Math.cos(ang) * 2.5 + n.seed, Math.sin(ang) * 2.5, 61) - .5) * .5);
  }

  // ── ПРОСТРАНСТВЕННЫЙ ИНДЕКС ────────────────────────────────────────────────
  // ⚠️ ЛИНЕЙНЫЙ ПЕРЕБОР ЗДЕСЬ БЫЛ ГЛАВНОЙ ПРИЧИНОЙ РЫВКОВ. Замысел строился на
  // «светил полсотни — значит вопрос „пустота ли тут“ это полсотни расстояний».
  // На настоящей карте их ТЫСЯЧИ, а перебор идёт по нескольку раз за кадр:
  // isVoid (дважды за шаг), nearNode для подсказки, отбор видимых, компас. То
  // есть десятки тысяч Math.hypot в кадре — отсюда дёрганье именно в полёте, и
  // именно на большой карте: на маленькой этого не увидеть в принципе.
  // Сетка строится один раз; шаг — по среднему разносу систем.
  const GRID = Math.max(GD_SPACING, 1);
  const gcol = tx => Math.floor(tx / GRID), grow = ty => Math.floor(ty / GRID);
  const grid = new Map();
  const gkey = (cx, cy) => cx + ':' + cy;
  nodes.forEach(n => {
    const k = gkey(gcol(n.tx), grow(n.ty));
    const b = grid.get(k);
    if (b) b.push(n); else grid.set(k, [n]);
  });
  // Самая крупная площадка: на столько клеток надо расширять поиск, чтобы точка
  // внутри чужой большой системы не была объявлена пустотой.
  const maxR = nodes.reduce((m, n) => Math.max(m, n.R), 0);
  const RCELL = Math.ceil((maxR * 1.6) / GRID);

  // Ближайшее светило и расстояние до него. Основа всего: и «пустота ли тут»,
  // и «на чьей я площадке». Кольцами от клетки точки наружу: как только кольцо
  // заведомо дальше найденного, дальше искать нечего.
  function nearNode(tx, ty) {
    const cx = gcol(tx), cy = grow(ty);
    let best = null, bd = 1e9;
    for (let r = 0; r <= RCELL + 2; r++) {
      // кольцо r уже дальше найденного — выходим
      if (best && (r - 1) * GRID > bd) break;
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (r && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // только кромка
          const b = grid.get(gkey(cx + dx, cy + dy));
          if (!b) continue;
          for (let i = 0; i < b.length; i++) {
            const d = Math.hypot(tx - b[i].tx, ty - b[i].ty);
            if (d < bd) { bd = d; best = b[i]; }
          }
        }
      }
    }
    return best ? { n: best, d: bd } : null;
  }

  // Системы в прямоугольнике мира — для отбора видимых в кадре. Тоже по сетке:
  // фильтр по всему массиву каждый кадр ещё и мусорил массивами.
  function nodesIn(x0q, y0q, x1q, y1q, out) {
    out.length = 0;
    const c0 = gcol(x0q) - RCELL, c1 = gcol(x1q) + RCELL;
    const r0 = grow(y0q) - RCELL, r1 = grow(y1q) + RCELL;
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        const b = grid.get(gkey(cx, cy));
        if (!b) continue;
        for (let i = 0; i < b.length; i++) {
          const n = b[i], m = n.R * 3;
          if (n.tx > x0q - m && n.tx < x1q + m && n.ty > y0q - m && n.ty < y1q + m) out.push(n);
        }
      }
    }
    return out;
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
    const n = byId.get(nodeId) || null;
    const out = [];
    if (n) {
      // ⚠️ ГРЯДКИ СТОЯТ НА КОЛЬЦЕ, А НЕ ВИСЯТ В ВАКУУМЕ. Это и была причина, по
      // которой место не читалось садом: посевы болтались точками в чёрном, без
      // опоры, без постройки, без признака, что тут кто-то живёт. Сад разбит на
      // ОРБИТАЛЬНОМ КОЛЬЦЕ на высоте НОО: одна высота, ячейки — отсеки по обводу,
      // между ними фермы. Номер ячейки = номер отсека, то есть просто угол.
      if (n.host) {
        const R0 = GD_RP * GD_RING;
        for (let j = 0; j < cap; j++) {
          const a = (j / GD_BAYS) * Math.PI * 2 + n.seed * .01;
          out.push({ tx: n.tx + Math.cos(a) * R0, ty: n.ty + Math.sin(a) * R0, a, bay: j });
        }
      } else {
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
    }
    return (cellCache[key] = out);
  }

  // Поиск по id — тоже картой: find() по тысячам систем звался из компаса и
  // миникарты на каждый кадр.
  const byId = new Map(nodes.map(n => [n.id, n]));

  // ⚠️ ТИПИЧНЫЙ РАЗНОС СОСЕДЕЙ — ЭТО МАСШТАБ ОБЗОРА. Зум гипера нельзя писать
  // константой: он зависит от того, как густо стоят системы на КОНКРЕТНОЙ
  // карте. Подобранный на пробе (двадцать систем) он на настоящей карте
  // показывал пустой экран — до ближайшей звезды оказывалось за край кадра.
  // Берём медиану расстояний до ближайшего соседа: одно число, устойчивое и к
  // плотным скоплениям, и к одиночкам на отшибе.
  let nnMed = GD_SPACING;
  if (nodes.length > 1) {
    const step = Math.max(1, Math.floor(nodes.length / 200));   // выборка, не весь список
    const ds = [];
    for (let i = 0; i < nodes.length; i += step) {
      const a = nodes[i];
      let best = Infinity;
      for (let j = 0; j < nodes.length; j++) {
        if (j === i) continue;
        const d = (a.tx - nodes[j].tx) ** 2 + (a.ty - nodes[j].ty) ** 2;
        if (d < best) best = d;
      }
      if (isFinite(best)) ds.push(Math.sqrt(best));
    }
    if (ds.length) { ds.sort((x, y) => x - y); nnMed = ds[ds.length >> 1] || GD_SPACING; }
  }

  // ── Гиперпути. Держим парами узлов и раскладываем ПО СЕТКЕ так же, как
  // системы: рисовать их надо только те, что попали в кадр, а не все тысячи.
  const lanes = [];
  (hyperlanes || []).forEach(l => {
    const a = byId.get(l.a_id), b = byId.get(l.b_id);
    if (a && b) lanes.push({ a, b });
  });
  const laneGrid = new Map();
  lanes.forEach(L => {                       // штампуем по клеткам вдоль отрезка
    const steps = Math.max(1, Math.ceil(Math.hypot(L.b.tx - L.a.tx, L.b.ty - L.a.ty) / GRID));
    const seen = new Set();
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const k = gkey(gcol(L.a.tx + (L.b.tx - L.a.tx) * u), grow(L.a.ty + (L.b.ty - L.a.ty) * u));
      if (seen.has(k)) continue;
      seen.add(k);
      const bkt = laneGrid.get(k);
      if (bkt) bkt.push(L); else laneGrid.set(k, [L]);
    }
  });
  function lanesIn(x0q, y0q, x1q, y1q, out) {
    out.length = 0;
    const got = new Set();
    for (let cx = gcol(x0q) - 1; cx <= gcol(x1q) + 1; cx++) {
      for (let cy = grow(y0q) - 1; cy <= grow(y1q) + 1; cy++) {
        const b = laneGrid.get(gkey(cx, cy));
        if (!b) continue;
        for (let i = 0; i < b.length; i++) if (!got.has(b[i])) { got.add(b[i]); out.push(b[i]); }
      }
    }
    return out;
  }

  // Мерки корабля и хода — часть мира, а не константы рендера: они верны только
  // вместе с той геометрией, под которую посчитаны.
  const speed = solo ? 13 : GD_SPEED;       // единиц в секунду обычным ходом
  const reach = solo ? 8 : GD_REACH;        // докуда дотягивается манипулятор
  const shipU = solo ? 5.5 : 3.2;           // длина корпуса в единицах
  const shipHull = solo ? 26 : 26;          // с какого экранного размера рисуем корпус
  // Грядки нарисованы в АБСОЛЮТНЫХ мировых пикселях (ellipse 20×10), и на
  // садовом масштабе это значок в десяток пикселей рядом со стометровой лодкой.
  // Множитель приводит их к росту садовода.
  const plotScale = solo ? 4.5 : 1;

  return { N, nodes, bounds, solo, speed, reach, shipU, shipHull, plotScale,
           isVoid, armAt, nearNode, platR, cells, nodesIn,
           lanes, lanesIn,
           nodeOf: id => byId.get(id) || null };
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
  const P = { tx: spawn.tx, ty: spawn.ty, ang: -Math.PI / 2, thr: 0, bob: 0, hyper: false, boost: 0 };
  // z — отъезд камеры. В гипере отъезжаем: иначе расстояние между системами
  // остаётся числом в углу, а не тем, что видно глазами.
  const cam = { x: 0, y: 0, z: 1.4 };
  const keys = {};
  let stop = false, last = performance.now();
  const pad = { x: 0, y: 0 };
  const wake = [];
  const _vis = [];              // буфер видимых систем: живёт весь сеанс, не мусорит
  // Габарит кадра в координатах мировой плоскости: считается раз в кадр и
  // используется отсечкой камней (drawAsteroids), чтобы не рисовать всё поле.
  let vx0s = -1e9, vy0s = -1e9, vx1s = 1e9, vy1s = 1e9;
  const _cmpBuf = [], _cmp = { t: 0, x: NaN, near6: null };   // кэш целей компаса
  // Чужие садоводы: слепок с сервера + своя интерполяция между пингами.
  const peers = [];
  let pingBusy = false, pingTimer = 0;
  // Обзорный зум: в одной системе — «вся система в кадре», на галактике —
  // прежний дальний план между светилами.
  const hyperZ = world.solo
    ? gClamp(420 / Math.max(1, world.nodes[0].R * 1.5 * GD_TW / 2), .004, .4)
    : .0016;

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
  // ⚠️ МЫШЬ НЕ РУЛИТ КОРАБЛЁМ. Тык по площадке задавал курс — и тогда ею
  // нельзя делать НИЧЕГО другого: любой клик по грядке уводил корабль вместо
  // того, чтобы открыть грядку. Курс — только клавишами; мышь работает по миру:
  // клик по своей ячейке открывает её, клик по камню бросает сеть.
  let lastX = P.tx, lastY = P.ty;
  const onDown = e => {
    const r = cv.getBoundingClientRect();
    const w = scr2world((e.clientX - r.left) / r.width * vw, (e.clientY - r.top) / r.height * vh);
    gardenClick(w.tx, w.ty);
  };
  cv.addEventListener('pointerdown', onDown);

  // Бросок сети: летит от кормы к камню, и только по прилёту дёргается сервер.
  // Без полёта клик по камню в двух экранах от тебя читался телепортом улова.
  let netFly = null;
  function netThrow(rock, t) {
    if (netFly || _gdHook) return;
    netFly = { rock, t0: t, dur: .38, back: false };
    if (_gd) _gd.actAt = t;                        // корабль отыгрывает взмах
  }
  function netStep(dt, t) {
    if (!netFly) return;
    if (t - netFly.t0 > netFly.dur && !netFly.back) {
      netFly.back = true;
      gardenRockOpen(netFly.rock);                 // содержимое решает сервер
    }
    if (t - netFly.t0 > netFly.dur * 2) netFly = null;
  }
  function drawNetFly(t) {
    if (!netFly) return;
    const u = gClamp((t - netFly.t0) / netFly.dur, 0, 1);
    const k = netFly.back ? 1 - (u - 1) : u;       // туда и обратно
    const a = gIso(P.tx, P.ty), b = gIso(netFly.rock.tx, netFly.rock.ty);
    const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k - GD_LIFT;
    ctx.strokeStyle = 'rgba(215,235,252,.55)'; ctx.lineWidth = 1.6 / cam.z;
    ctx.beginPath(); ctx.moveTo(a.x, a.y - GD_LIFT); ctx.lineTo(x, y); ctx.stroke();
    ctx.strokeStyle = 'rgba(215,235,252,.9)'; ctx.lineWidth = 2.2 / cam.z;
    const rr = (18 + 10 * Math.sin(k * Math.PI)) / cam.z;
    ctx.beginPath(); ctx.ellipse(x, y, rr, rr * .74, .4, 0, 7); ctx.stroke();
  }

  // Клик по миру: сперва камни (по ним бросают сеть), потом свои ячейки.
  // Дальность обоих действий ограничена — мышь не должна доставать через всю
  // систему, иначе ходить незачем.
  function gardenClick(tx, ty) {
    // ⚠️ ГРЯДКА ВАЖНЕЕ КАМНЯ. Раньше камни проверялись первыми, и любой обломок,
    // проходящий над теплицей, воровал клик по ячейке. Сначала ищем свою
    // ячейку под курсором, и только если её там нет — бросаем сеть.
    const R2 = (world.reach * 1.2) ** 2;
    let best = null, bd = R2;
    ((_gdState && _gdState.lands) || []).forEach(l => {
      world.cells(l.sys, l.cells).forEach((cc, i) => {
        const d = (cc.tx - tx) ** 2 + (cc.ty - ty) ** 2;
        if (d < bd) { bd = d; best = { l, cc, i }; }
      });
    });
    if (!best) {
      const rock = astNear(tx, ty, world.reach * 1.6);
      if (!rock) return;
      const d = Math.hypot(rock.tx - P.tx, rock.ty - P.ty);
      if (d > world.reach * 6) { gardenToast('Далеко: сеть не добросить.'); return; }
      netThrow(rock, performance.now() / 1000);
      return;
    }
    if (Math.hypot(best.cc.tx - P.tx, best.cc.ty - P.ty) > world.reach * 4) {
      gardenToast('Далеко: подойди к грядке.'); return;
    }
    const plot = _gdPlots()[_gdPlotKey(best.l.sys, best.i)];
    if (plot && !plot.mine) { gardenToast('Чужая плантация. Смотреть можно, трогать — нет.'); return; }
    gardenPanel({ kind: 'plot', sys: best.l.sys, cell: best.i, land: best.l, plot,
                  tx: best.cc.tx, ty: best.cc.ty });
  }

  function moveVec() {
    let dx = 0, dy = 0;
    if (keys['KeyA'] || keys['ArrowLeft'])  { dx -= 1; dy += 1; }
    if (keys['KeyD'] || keys['ArrowRight']) { dx += 1; dy -= 1; }
    if (keys['KeyW'] || keys['ArrowUp'])    { dx -= 1; dy -= 1; }
    if (keys['KeyS'] || keys['ArrowDown'])  { dx += 1; dy += 1; }
    if (pad.x || pad.y) { dx += pad.x + pad.y; dy += pad.y - pad.x; }
    const m = Math.hypot(dx, dy);
    return m > 0 ? { x: dx / m, y: dy / m } : { x: 0, y: 0 };
  }

  // ── Присутствие. Один вызов делает обе работы: кладёт меня и забирает
  // остальных (см. garden_ping). Раз в 1.5 с — этого хватает, чтобы чужой
  // корабль читался живым, и не хватает, чтобы устроить базе поток точек.
  // ⚠️ ПИНГИ НЕ НАКЛАДЫВАЮТСЯ: пока ответ не пришёл, следующий не уходит.
  // Иначе на медленной сети запросы копятся очередью и корабли скачут.
  async function ping() {
    if (pingBusy || typeof ecRpc !== 'function') return;
    pingBusy = true;
    try {
      const r = await ecRpc('garden_ping', {
        p_tx: P.tx, p_ty: P.ty, p_ang: P.ang,
        p_hat: GD_LOOK.hat, p_hull: GD_LOOK.hull,
        p_sys: (_gdState && _gdState.temple) || null,
      });
      const was = peers.length;
      peersMerge((r && r.peers) || []);
      // Сводку трогаем только когда состав менялся: перерисовывать её каждые
      // полторы секунды впустую незачем.
      if (peers.length !== was) gardenPaintHud();
    } catch (e) { /* сеть моргнула — в следующий раз */ }
    pingBusy = false;
  }

  function peersMerge(list) {
    const seen = {};
    list.forEach(d => {
      seen[d.id] = 1;
      let q = peers.find(x => x.id === d.id);
      if (!q) {
        // Первый раз — ставим сразу на место, без подъезда через полкарты.
        q = { id: d.id, tx: +d.tx, ty: +d.ty, ang: +d.ang || 0, thr: 0, bob: 0 };
        peers.push(q);
      }
      q.nm = String(d.nm || 'Безымянные').slice(0, 24);
      q.col = /^#[0-9a-f]{6}$/i.test(String(d.col || '')) ? d.col : '#6f8bb5';
      q.hat = GD_HATS.includes(d.hat) ? d.hat : 'straw';
      q.hull = GD_HULLS[d.hull] ? d.hull : 'steel';
      q.ttx = +d.tx; q.tty = +d.ty; q.tang = +d.ang || 0;
    });
    for (let i = peers.length - 1; i >= 0; i--) if (!seen[peers[i].id]) peers.splice(i, 1);
  }

  function peersStep(dt, t) {
    for (let i = 0; i < peers.length; i++) {
      const q = peers[i];
      if (q.ttx == null) continue;
      const px0 = q.tx, py0 = q.ty;
      // Подтягиваем к последней известной точке. Далеко отстал — ставим сразу:
      // это не полёт, а рассинхрон, и «догонять» его через весь сад глупо.
      const d = Math.hypot(q.ttx - q.tx, q.tty - q.ty);
      const k = d > world.speed * 40 ? 1 : Math.min(1, dt * 4.5);
      q.tx += (q.ttx - q.tx) * k; q.ty += (q.tty - q.ty) * k;
      const mx = q.tx - px0, my = q.ty - py0;
      const mv = Math.hypot(mx, my);
      // Курс — из фактического хода, как и у своего корабля; стоит — держим
      // присланный.
      let want = mv > dt * world.speed * .2
        ? Math.atan2((mx + my) * GD_TH / 2, (mx - my) * GD_TW / 2) : q.tang;
      let da = want - q.ang;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      q.ang += da * Math.min(1, dt * 7);
      q.thr += ((mv > dt * world.speed * .2 ? 1 : 0) - q.thr) * Math.min(1, dt * 5);
      q.bob = Math.sin(t * 2.2 + i) * 1.1;
    }
  }

  function step(dt, t) {
    // Пока висит вопрос кромки, руль отключён: выбор делают словами, а не тем,
    // что палец случайно остался на стике.
    if (_gdEdge) { pad.x = pad.y = 0; for (const k in keys) keys[k] = 0; }
    const v = moveVec();
    // Обычным ходом — только по площадке, пустоту проходят гипером, и наоборот.
    // Ровно та развилка, что была у лодки с водой: она и делает пустоту
    // расстоянием, а не просто фоном.
    // ⚠️ В САДУ НЕТ РАЗВИЛКИ «ПЛОЩАДКА ИЛИ ГИПЕР». Она была нужна галактике:
    // пустота = расстояние, которое проходят другим режимом. Здесь пустота —
    // это ВОДА, по которой носит камни: в неё выходят той же лодкой и на том же
    // зуме, иначе ловить нечем — в гипере лодка вырождается в метку.
    const ok = (x, y) => world.solo ? true : (world.isVoid(x, y) === P.hyper);
    // Разгон на Shift. ⚠️ НАБИРАЕТСЯ ПЛАВНО: мгновенный скачок скорости в
    // несколько раз читается не разгоном, а телепортом с рывком камеры —
    // держать курс на такой перекладке невозможно. Разгон копится ~1.5 с и так
    // же спадает, а вместе с ним едут камера и нити.
    // Разгон работает и в системе: расстояния между орбитами настоящие, и без
    // него перелёт от планеты к планете превращается в ожидание.
    const wantB = (keys['ShiftLeft'] || keys['ShiftRight']) ? 1 : 0;
    P.boost += (wantB - P.boost) * Math.min(1, dt * (wantB ? 1.6 : 3.2));
    // ⚠️ ПОТОЛОК РАЗГОНА СНИЖЕН. Было ×57 к обычному ходу: на такой скорости
    // экран за секунду проходит несколько систем, курс не держится, а найти
    // что-либо нельзя в принципе. ×33 — всё ещё «перегон между звёздами».
    const SPD = world.speed;
    const sp = (P.hyper ? SPD * (13 + P.boost * 20)
                        : SPD * (1 + P.boost * 5)) * dt;
    const nx = P.tx + v.x * sp, ny = P.ty + v.y * sp;
    const B = world.bounds;
    const px0 = P.tx, py0 = P.ty;
    if (ok(nx, P.ty)) P.tx = gClamp(nx, B.x0, B.x1);
    if (ok(P.tx, ny)) P.ty = gClamp(ny, B.y0, B.y1);
    // ⚠️ НОС СМОТРИТ ТУДА, КУДА КОРАБЛЬ РЕАЛЬНО ЕДЕТ. Проверка проходимости
    // раздельная по осям: у кромки площадки одна ось встаёт, и корабль ползёт
    // боком, а нос при этом держал НАЖАТОЕ направление — это и читалось как
    // «косоебит». Курс берём из фактического смещения, ввод — только запасной.
    const mx = P.tx - px0, my = P.ty - py0;
    const fv = Math.hypot(mx, my) > sp * .12 ? { x: mx, y: my } : v;
    lastX = P.tx; lastY = P.ty;

    // ── Отход от светила. ⚠️ КРАЙ МИРА БЫЛ НЕВИДИМОЙ СТЕНОЙ: корабль просто
    // упирался в clamp по bounds, и всё. Теперь дорога наружу проговаривается
    // (far1 → far2), а у самой кромки задаётся вопрос — см. gardenEdgeAsk.
    const n0 = world.nodes[0];
    if (n0 && !_gdHook && !_gdPanel && !_gdEdge) {
      const dR = Math.hypot(P.tx - n0.tx, P.ty - n0.ty) / Math.max(1, n0.R);
      const lvl = dR > 2.0 ? 2 : dR > 1.5 ? 1 : 0;
      if (lvl > (P.farLvl || 0)) { gardenSay(lvl === 2 ? 'far2' : 'far1', 4); P.sayAt = t; }
      P.farLvl = lvl;
      if (dR > 2.45) gardenEdgeAsk(n0);
      // Праздная болтовня: только у светила, в пути и редко.
      else if (!lvl && (v.x || v.y) && t - (P.sayAt || 0) > 40 && Math.random() < dt * .15) {
        gardenSay('idle'); P.sayAt = t;
      }
    }

    const moving = !!(v.x || v.y);
    P.thr += ((moving ? 1 : 0) - P.thr) * Math.min(1, dt * 6);
    if (moving) {
      const sx = (fv.x - fv.y) * GD_TW / 2, sy = (fv.x + fv.y) * GD_TH / 2;
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

    // ⚠️ В ГИПЕРЕ КАМЕРА ЖЁСТКО НА КОРАБЛЕ, И ЭТО НЕ ПРИДИРКА К ВКУСУ, А
    // ЛЕЧЕНИЕ БАГА. Было: мягкое слежение (k ≈ 0.35 за кадр) плюс ЖЁСТКИЙ
    // потолок на отставание. В гипере корабль идёт ~150 px за кадр, мягкое
    // слежение даёт установившееся отставание втрое больше потолка — значит
    // КАЖДЫЙ кадр срабатывал не плавный догон, а обрезка «поставить ровно на
    // границу». Точка обрезки пляшет от малейшей смены курса и dt, и корабль
    // мотало из стороны в сторону. Под Shift коэффициент упирался в 1, обрезка
    // не включалась — оттого «с шифтом всё ок», и это была подсказка.
    // В гипере просто держим камеру НА корабле: нечему дрожать.
    // ⚠️ МЯГКОГО СЛЕЖЕНИЯ С ОБРЕЗКОЙ БОЛЬШЕ НЕТ НИГДЕ. Пара «догонять плавно, но
    // не дальше потолка» устойчива только пока корабль медленный: как только шаг
    // за кадр превышает потолок, плавный догон не успевает НИКОГДА, и каждый
    // кадр отрабатывает обрезка «поставить ровно на границу». Её точка пляшет от
    // dt и курса — это и есть дрожание и «кидает». Камера просто на корабле.
    const s = gIso(P.tx, P.ty);
    cam.x = s.x; cam.y = s.y;

    // Камера стоит БЛИЗКО. Отъезд остаётся только как признак скорости, и
    // небольшой: раньше на разгоне мир уезжал так, что искать в нём было
    // нечего. Плавно — рывок масштаба читается глюком, а не ускорением.
    // ⚠️ ЗУМ ТЕПЕРЬ ХОДИТ НА ПОРЯДКИ, А НЕ НА ПРОЦЕНТЫ. Мир вырос в сотни раз,
    // и это не косметика: подсветовым ходом мы стоим у борта планеты (корвет ~
    // 100 px, планета — во весь кадр), а в гипере смотрим на систему целиком с
    // высоты, где она сама размером с точку. Между этими двумя состояниями и
    // лежит «пространство»: одно и то же место выглядит по-разному, потому что
    // расстояния настоящие.
    // ⚠️ ЗУМ ГИПЕРА ПОДБИРАЕТСЯ ПОД МИР, А НЕ КОНСТАНТОЙ. 0.0016 было мерой
    // для галактики, где в кадр надо уложить десяток систем. В одной системе с
    // таким зумом смотреть не на что: Храм вырождается в точку посреди чёрного.
    // Берём столько, чтобы система целиком стояла в кадре.
    const wantZ = (P.hyper ? hyperZ : .62) * (1 - P.boost * .45);
    // Сводим ЛОГАРИФМИЧЕСКИ: между 1 и 0.0016 линейный догон почти весь путь
    // ползёт у нуля, и выход в гипер читается рывком с длинным хвостом.
    const kz = Math.min(1, dt * 2.2);
    cam.z = Math.exp(Math.log(cam.z) + (Math.log(wantZ) - Math.log(cam.z)) * kz);

    hatStep(dt, t);          // шляпа и седок живут своей пружиной, см. drawShip
    peersStep(dt, t);        // чужие корабли едут между пингами
    netStep(dt, t);          // брошенная сеть летит к камню и возвращается
    astStep(dt, t);          // камни дрейфуют, см. «ЛОВЛЯ КАМНЕЙ»
  }

  // ══════════════════════════════════════════════════════════
  // ЗАДНИК
  // ══════════════════════════════════════════════════════════
  // ⚠️ НЕБО БОЛЬШЕ НЕ МОСТИТСЯ ТАЙЛОМ. Раньше и звёзды (SKY_W×SKY_H), и
  // туманности (NEB_W×NEB_H) были ОДНИМ набором пятен, который повторялся по
  // экрану: в кадр попадало по четыре-шесть копий одного и того же облака, и
  // космос читался обоями — глаз ловит повтор мгновенно, никакой палитрой это
  // не лечится. Теперь ячейка сетки — не повтор, а АДРЕС: что в ней лежит,
  // считается хешем от её НОМЕРА. Узор не повторяется нигде, а стоит ровно
  // столько же — ничего не хранится, всё считается на лету по видимым ячейкам.
  //
  // Слои идут от дальнего к ближнему: подложка → далёкие галактики → облака →
  // звёзды (они ПЕРЕД дальним газом) → тёмная пыль → виньетка. Пыль
  // обязательна: без неё туманность светится в пустоте сама по себе, а не
  // лежит в облаке, которое где-то плотнее, где-то съедает звёзды.
  const skySeed = (gSeedOf((world.nodes[0] && world.nodes[0].id) || 'void') % 9973) | 0;

  // Обход ВИДИМЫХ ячеек слоя: cb(cx, cy, экранный x, экранный y) — левый верх
  // ячейки. Параллакс входит только в смещение, размер ячейки постоянный.
  function skyCells(par, W, H, cb) {
    const ox = cam.x * par, oy = cam.y * par;
    const c0 = Math.floor(ox / W) - 1, c1 = Math.floor((ox + vw) / W) + 1;
    const r0 = Math.floor(oy / H) - 1, r1 = Math.floor((oy + vh) / H) + 1;
    for (let cx = c0; cx <= c1; cx++)
      for (let cy = r0; cy <= r1; cy++)
        cb(cx, cy, cx * W - ox, cy * H - oy);
  }
  // Хеш ячейки: номер ячейки и номер объекта в ней разводим разными простыми
  // множителями, иначе соседние ячейки дают похожие числа и «случайность»
  // ложится диагональными полосами.
  const cHash = (cx, cy, i, s) => gHash(cx * 131 + i * 17, cy * 197 + i * 29, skySeed + s);

  // Палитра газа. Холодная основа Храма плюс редкие тёплые вкрапления: цвет
  // должен различать облака, а не раскрашивать кадр.
  // ⚠️ ГАЗ КЛАДЁТСЯ СЛОЖЕНИЕМ СВЕТА ('lighter'), А НЕ ПОВЕРХ. Прозрачные пятна
  // поверх чёрного дают грязный серый налёт и гасят друг друга на пересечениях;
  // светящийся газ в пустоте именно СКЛАДЫВАЕТСЯ — где гуще, там ярче.
  const nebSpr = [
    gGlowSprite('58,96,182', .30),    // синь
    gGlowSprite('104,74,176', .26),   // фиолет
    gGlowSprite('36,124,146', .22),   // бирюза
    gGlowSprite('158,98,72', .18),    // охра, редко
  ];
  const dustSpr = gGlowSprite('4,6,11', .5);          // пыль: гасит, а не светит
  const coreSpr = gGlowSprite('186,214,255', .5);     // ядро далёкой галактики
  const STAR_TINT = ['200,220,240', '176,200,255', '255,226,190', '210,232,255'];

  // Пятно газа: вытянутое и повёрнутое. Круглые кляксы читаются пузырями.
  function nebBlob(x, y, r, sq, rot, spr, al) {
    if (x + r < -r || x - r > vw + r || y + r < -r || y - r > vh + r) return;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.globalAlpha = al;
    ctx.drawImage(spr, -r, -r * sq, r * 2, r * 2 * sq);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  const lit = on => { ctx.globalCompositeOperation = on ? 'lighter' : 'source-over'; };

  // Слой газа. Ячейки заполняются НЕ ВСЕ: пропуски и есть то, что превращает
  // ровное поле пятен в облако с разрывами.
  function nebLayer(par, W, H, fill, rBase, alK, tint) {
    skyCells(par, W, H, (cx, cy, sx, sy) => {
      if (cHash(cx, cy, 0, 3) > fill) return;
      const n = cHash(cx, cy, 1, 5) > .55 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const h1 = cHash(cx, cy, i + 2, 7), h2 = cHash(cx, cy, i + 5, 11);
        const h3 = cHash(cx, cy, i + 9, 13), h4 = cHash(cx, cy, i + 14, 17);
        const spr = nebSpr[tint != null ? tint : (h4 > .94 ? 3 : h4 > .62 ? 1 : h4 > .3 ? 0 : 2)];
        nebBlob(sx + h1 * W, sy + h2 * H, rBase * (.55 + h3 * 1.1),
                .38 + h4 * .5, h1 * Math.PI * 2, spr, alK * (.55 + h2 * .6));
      }
    });
  }

  // Далёкая галактика: диск с ядром. Редкая — примерно одна на несколько
  // экранов, и именно поэтому работает как ориентир глубины.
  function galaxies(t) {
    skyCells(.045, 2200, 1700, (cx, cy, sx, sy) => {
      const h = cHash(cx, cy, 0, 23);
      if (h < .78) return;
      const x = sx + cHash(cx, cy, 1, 29) * 2200, y = sy + cHash(cx, cy, 2, 31) * 1700;
      const r = 44 + cHash(cx, cy, 3, 37) * 90, rot = cHash(cx, cy, 4, 41) * Math.PI * 2;
      if (x + r < 0 || x - r > vw || y + r < 0 || y - r > vh) return;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot);
      ctx.globalAlpha = .5 + cHash(cx, cy, 5, 43) * .3;
      ctx.drawImage(nebSpr[0], -r, -r * .3, r * 2, r * .6);
      ctx.globalAlpha = .55;
      ctx.drawImage(coreSpr, -r * .26, -r * .16, r * .52, r * .32);
      ctx.restore();
      ctx.globalAlpha = 1;
    });
  }

  // Звёзды. Три слоя параллакса; чем ближе, тем крупнее и ярче. Цвет — из
  // короткой палитры: белым по чёрному небо выглядит распечаткой.
  const STAR_L = [[.05, 9, 1.0, .34], [.11, 7, 1.35, .52], [.2, 5, 1.9, .78]];
  function stars(t) {
    for (let li = 0; li < STAR_L.length; li++) {
      const [par, cnt, sz, al] = STAR_L[li], W = 240, H = 240;
      skyCells(par, W, H, (cx, cy, sx, sy) => {
        for (let i = 0; i < cnt; i++) {
          const h1 = cHash(cx, cy, i, 51 + li), h2 = cHash(cx, cy, i + 40, 61 + li);
          const h3 = cHash(cx, cy, i + 80, 71 + li);
          const x = sx + h1 * W, y = sy + h2 * H;
          if (x < 0 || y < 0 || x > vw || y > vh) continue;
          let a = al * (.4 + h3 * .6);
          if (h3 > .93) a *= .55 + Math.sin(t * 1.7 + h1 * 9) * .45;   // мерцает не всё
          ctx.fillStyle = `rgba(${STAR_TINT[(h1 * 4) | 0]},${a})`;
          const s = sz * (.7 + h3 * .7);
          ctx.fillRect(x, y, s, s);
          // Одна на сотню — яркая, с крестом бликов. Ими и держится ощущение,
          // что звёзды разной величины, а не рассыпанный песок.
          if (li === 2 && h3 > .985) {
            const L = s * 7;
            ctx.fillRect(x - L, y + s * .35, L * 2 + s, s * .3);
            ctx.fillRect(x + s * .35, y - L, s * .3, L * 2 + s);
          }
        }
      });
    }
  }

  let vign = null, vignK = '';
  function drawSky(t) {
    // Подложка: не плоская заливка, а лёгкий перепад — верх кадра холоднее.
    const key = vw + 'x' + vh;
    if (vignK !== key) {
      vignK = key;
      const g1 = ctx.createLinearGradient(0, 0, 0, vh);
      g1.addColorStop(0, '#070a12'); g1.addColorStop(.55, '#05070c'); g1.addColorStop(1, '#04050a');
      const g2 = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * .35,
                                          vw / 2, vh / 2, Math.max(vw, vh) * .78);
      g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,.42)');
      vign = { base: g1, edge: g2 };
    }
    ctx.fillStyle = vign.base; ctx.fillRect(0, 0, vw, vh);
    lit(true);
    galaxies(t);
    nebLayer(.07, 1500, 1150, .62, 520, .9, null);      // дальний газ, крупный
    lit(false);
    stars(t);
    lit(true);
    nebLayer(.16, 950, 760, .40, 300, .75, null);       // ближе и мельче
    lit(false);
  }

  // Ближний план: тёмная пыль и волокна. Идут ПОСЛЕ звёзд — облако должно
  // местами их съедать, иначе глубины нет.
  function drawNebula() {
    skyCells(.26, 820, 640, (cx, cy, sx, sy) => {
      const h = cHash(cx, cy, 0, 91);
      if (h > .5) return;
      const h1 = cHash(cx, cy, 1, 93), h2 = cHash(cx, cy, 2, 97), h3 = cHash(cx, cy, 3, 101);
      nebBlob(sx + h1 * 820, sy + h2 * 640, 190 + h3 * 260,
              .3 + h1 * .35, h2 * Math.PI * 2, dustSpr, .5 + h3 * .5);
      if (h < .2) {                                      // редкая светлая жила
        lit(true);
        nebBlob(sx + h2 * 820, sy + h1 * 640, 150 + h3 * 200,
                .16 + h3 * .2, h1 * Math.PI * 2 + 1, nebSpr[2], .55);
        lit(false);
      }
    });
    ctx.fillStyle = vign.edge; ctx.fillRect(0, 0, vw, vh);
  }

  const domeGlow = gGlowSprite('143,211,255', .30);
  const ichorGlow = gGlowSprite('190,160,255', .30);
  const bayGlow = gGlowSprite('150,215,175', .22);      // свет из теплицы наружу
  const hubGlow = gGlowSprite('255,196,107', .26);      // огонь Храма на ободе

  // ── ТЕЛА РИСУЮТСЯ, А НЕ КЛАДУТСЯ КАРТИНКОЙ ────────────────────────────────
  // ⚠️ РАСТР ЗДЕСЬ НЕ РАБОТАЕТ. Текстуры карты (planet_<вид>.png, star_<тип>.png)
  // сделаны под значок в полсотни пикселей. В пустоте планета занимает кадр
  // целиком — растянутый в десятки раз PNG превращается в мыло с пикселями.
  // Поэтому тела строятся вектором, как пояса астероидов: гладко на любом зуме
  // и без единого файла. Палитра — по группе, рисунок — по seed, так что два
  // мира одного класса не близнецы.
  const GD_PAL = {
    gasgiant:  ['#c9a878', '#8d6f4c', '#e8d2ab'],
    icegiant:  ['#8fc2d8', '#4d7f9b', '#cfeaf5'],
    hotgiant:  ['#d89a6a', '#9a5733', '#f2c79b'],
    terran:    ['#5d8f6a', '#2f5a49', '#9fd3b0'],
    ocean:     ['#3f7fa8', '#22506e', '#8fc6e0'],
    ice:       ['#a9c8d8', '#6f93a6', '#e6f4fb'],
    lava:      ['#b4442a', '#7a2a18', '#ffb46a'],
    rock:      ['#9a9086', '#5f574f', '#c5bcb0'],
    micro:     ['#9aa3ad', '#5c636b', '#c3cad2'],
    anomaly:   ['#a892d6', '#5c4a86', '#d8c9f5'],
  };
  const gdPal = grp => GD_PAL[grp] || (['gasgiant', 'icegiant', 'hotgiant'].includes(grp)
    ? GD_PAL.gasgiant : GD_PAL.rock);

  // Планета: шар со светотенью от звезды плюс рисунок по группе. Всё дугами и
  // градиентами — ни одного растра, поэтому чем ближе, тем ЧЁТЧЕ.
  function drawBody(b, bx, by, br, sunA) {
    const pal = gdPal(b.grp), sd = b.seed || 1;
    const lx = bx - Math.cos(sunA) * br * .45, ly = by - Math.sin(sunA) * br * .45;
    const g = ctx.createRadialGradient(lx, ly, br * .06, bx, by, br * 1.02);
    g.addColorStop(0, pal[2]); g.addColorStop(.52, pal[0]); g.addColorStop(1, pal[1]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.clip();
    const giant = ['gasgiant', 'icegiant', 'hotgiant'].includes(b.grp);
    if (giant) {                                   // пояса облаков поперёк шара
      for (let i = 0; i < 9; i++) {
        const u = (i + .5) / 9, yy = by - br + u * br * 2;
        const h = br * (.06 + gHash(sd, i, 41) * .1);
        ctx.globalAlpha = .18 + gHash(sd + i, i, 43) * .22;
        ctx.fillStyle = (i % 2) ? pal[2] : pal[1];
        ctx.beginPath();
        ctx.ellipse(bx, yy, br * Math.sqrt(Math.max(0, 1 - ((yy - by) / br) ** 2)), h, 0, 0, 7);
        ctx.fill();
      }
    } else if (b.grp === 'terran' || b.grp === 'ocean') {
      ctx.globalAlpha = .5; ctx.fillStyle = pal[0];
      for (let i = 0; i < 7; i++) {                // материки кляксами
        const a = gHash(sd, i, 51) * Math.PI * 2, rr = gHash(sd + i, i, 53) * br * .8;
        ctx.beginPath();
        ctx.ellipse(bx + Math.cos(a) * rr, by + Math.sin(a) * rr,
                    br * (.16 + gHash(sd, i, 55) * .26), br * (.1 + gHash(sd, i, 57) * .2),
                    a, 0, 7);
        ctx.fill();
      }
    } else if (b.grp === 'lava') {
      ctx.globalAlpha = .75; ctx.strokeStyle = pal[2];
      for (let i = 0; i < 9; i++) {                // трещины
        const a = gHash(sd, i, 61) * Math.PI * 2, rr = gHash(sd + i, i, 63) * br * .85;
        ctx.lineWidth = br * .035;
        ctx.beginPath();
        ctx.arc(bx + Math.cos(a) * rr * .4, by + Math.sin(a) * rr * .4,
                br * (.18 + gHash(sd, i, 65) * .4), a, a + 1.1);
        ctx.stroke();
      }
    } else {
      ctx.globalAlpha = .3; ctx.fillStyle = pal[1];
      for (let i = 0; i < 10; i++) {               // кратеры
        const a = gHash(sd, i, 71) * Math.PI * 2, rr = gHash(sd + i, i, 73) * br * .82;
        const cr = br * (.05 + gHash(sd, i, 75) * .12);
        ctx.beginPath(); ctx.arc(bx + Math.cos(a) * rr, by + Math.sin(a) * rr, cr, 0, 7); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // Ночная сторона: мягкий градиент, а не половинка круга встык.
    const nx = bx + Math.cos(sunA) * br, ny = by + Math.sin(sunA) * br;
    const ng = ctx.createRadialGradient(nx, ny, br * .1, nx, ny, br * 1.9);
    ng.addColorStop(0, 'rgba(0,0,0,.82)'); ng.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ng; ctx.fillRect(bx - br, by - br, br * 2, br * 2);
    ctx.restore();

    if (b.grp === 'gasgiant' || b.grp === 'icegiant') {   // кольцо
      ctx.strokeStyle = 'rgba(214,228,240,.30)'; ctx.lineWidth = br * .07;
      ctx.beginPath(); ctx.ellipse(bx, by, br * 1.9, br * .58, .3, 0, 7); ctx.stroke();
    }
  }

  // Светило: ядро, лимб, корона и протуберанцы — тоже вектором.
  function drawStar(n, x, y, R, t) {
    const core = ctx.createRadialGradient(x - R * .22, y - R * .22, R * .04, x, y, R);
    core.addColorStop(0, '#fffdf3'); core.addColorStop(.5, '#ffeec2');
    core.addColorStop(.86, '#ffc873'); core.addColorStop(1, '#f0a049');
    const cor = ctx.createRadialGradient(x, y, R * .92, x, y, R * 1.9);
    cor.addColorStop(0, 'rgba(255,206,130,.42)');
    cor.addColorStop(.4, 'rgba(255,180,100,.14)');
    cor.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = cor;
    ctx.beginPath(); ctx.arc(x, y, R * 1.9, 0, 7); ctx.fill();
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,236,190,.55)'; ctx.lineWidth = R * .02;
    for (let i = 0; i < 7; i++) {                  // протуберанцы у самого лимба
      const a = gHash(n.seed, i, 81) * Math.PI * 2 + t * .05;
      const h = R * (.06 + gHash(n.seed + i, i, 83) * .14);
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * R, y + Math.sin(a) * R, h, a + 1.6, a + 4.7);
      ctx.stroke();
    }
  }

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
    // ⚠️ ПЕЧЁМ НЕ В МИРОВЫХ ПИКСЕЛЯХ. Площадка теперь тысячи мировых единиц
    // поперёк — холст «один в один» вышел бы под миллион пикселей по стороне и
    // просто уронил бы вкладку. Печём в ограниченный габарит и растягиваем при
    // отрисовке: площадка это мягкое пятно, детализация ей не нужна.
    const RXW = n.R * 1.35 * GD_TW / 2, RYW = n.R * 1.35 * GD_TH / 2;
    const bs = Math.min(1, 900 / Math.max(1, RXW));    // масштаб запекания
    const RX = RXW * bs, RY = RYW * bs;
    const w = Math.ceil(RX * 2 + 40), h = Math.ceil(RY * 2 + 40 + GD_LIFT);
    const cx = w / 2, cy = h / 2 - GD_LIFT / 2;

    const cv2 = document.createElement('canvas');
    cv2.width = w; cv2.height = h;
    const g = cv2.getContext('2d');
    const SC = bs;                                     // все мерки ниже — через него

    // Контур площадки: сто точек по кругу с рваным радиусом. Ромбов нет —
    // именно они назначали масштаб и делали из галактики огород.
    const STEP = 100, pts = [];
    for (let i = 0; i < STEP; i++) {
      const ang = i / STEP * Math.PI * 2;
      const r = world.platR(n, ang);
      pts.push({ x: cx + Math.cos(ang) * r * GD_TW / 2 * SC, y: cy + Math.sin(ang) * r * GD_TH / 2 * SC });
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
      g.ellipse(cx, cy, n.R * r * GD_TW / 2 * SC, n.R * r * GD_TH / 2 * SC, 0, 0, 7);
      g.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const ang = i / 12 * Math.PI * 2 + n.seed * .01;
      g.beginPath(); g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(ang) * n.R * 1.3 * GD_TW / 2 * SC, cy + Math.sin(ang) * n.R * 1.3 * GD_TH / 2 * SC);
      g.stroke();
    }
    // Обломки: лежат в плоскости площадки, ничего стоячего.
    for (let i = 0; i < 26; i++) {
      const h1 = gHash(n.seed + i, i * 7, 21), h2 = gHash(i * 13, n.seed + i, 33);
      const ang = h1 * Math.PI * 2, rr = (.25 + h2 * .95) * n.R;
      const x = cx + Math.cos(ang) * rr * GD_TW / 2 * SC, y = cy + Math.sin(ang) * rr * GD_TH / 2 * SC;
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

    s = { cv: cv2, cx, cy, bs, hit: performance.now() };
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

    // ⚠️ БЕЗ БЕЖЕВОЙ ЗАСВЕТКИ ПОД СИСТЕМОЙ, ЕСЛИ ЕСТЬ ТЕКСТУРА ЗВЕЗДЫ. Этот
    // спрайт заливал тёплой мутью круг вдвое шире всей системы. Пока звезда
    // была нарисованной, он читался «светом от солнца»; с настоящей текстурой
    // (у неё своя корона) это просто серо-бежевая пелена поверх чёрного космоса
    // — из-за неё кадр и выглядел линялым.
    // Засветку под системой не рисуем: у векторного светила своя корона, а
    // спрайт вдвое шире всей системы давал серо-бежевую пелену по кадру.

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

    // В саду в центре кадра ПЛАНЕТА, а не светило (см. разбивку сада на орбите):
    // рисуем её тем же пейнтером тел, каким она нарисована на карте системы.
    if (world.solo && n.host) {
      // ⚠️ ПЛАНЕТА МЕРЯЕТСЯ ТОЙ ЖЕ ЛИНЕЙКОЙ, ЧТО И ОРБИТЫ. Всё, что лежит в
      // плоскости орбит, идёт через gIso и получает множитель √2; тело же
      // рисовалось «как есть», и радиус 1.19 переставал значить 1.19 — обод
      // оказывался втрое дальше от поверхности, чем задумано.
      // Шар на экране круглый, а орбита вокруг него — эллипс: по вертикали он
      // сплюснут вдвое. Значит планету надо мерить МАЛОЙ полуосью — иначе она
      // прорастает сквозь собственное кольцо там, где орбита ближе всего.
      const PR = n.host.r * (GD_TH / 2) * Math.SQRT2;
      drawShells(x, y, U);
      drawBody(n.host, x, y, PR, t * .05);
      drawLimb(x, y, PR, t);
    } else drawStar(n, x, y, R, t);

    // Тела на своих орбитах. Дальние идут медленнее — иначе система читается
    // каруселью, а не системой.
    n.bodies.forEach(b => {
      if (b.belt) return;
      const a = b.a0 + t * b.sp;
      const bx = x + Math.cos(a) * b.orb * U, by = y + Math.sin(a) * b.orb * GD_TH / 2;
      const br = b.r * U;
      drawBody(b, bx, by, br, a);
    });

    ctx.fillStyle = 'rgba(215,235,252,.9)';
    ctx.font = '13px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.textAlign = 'center';
    ctx.fillText((n.name || '').toUpperCase(), x, y - n.R * GD_TH / 2 - 14);
    ctx.textAlign = 'left';
  }

  // ══════════════════════════════════════════════════════════
  // ОРБИТАЛЬНЫЕ ПОЯСА НА ЭКРАНЕ
  // ══════════════════════════════════════════════════════════
  // Высота должна ЧИТАТЬСЯ, иначе орбита остаётся словом в комментарии: сад
  // выглядит просто кольцом вокруг шара, и непонятно, низко ты идёшь или у ГСО.
  // Рисуем кромки поясов и подписываем их — как на разметке акватории.
  const GD_BANDS = [
    { r: GD_SHELL.vleoTop, lb: 'VLEO 450 км' },
    { r: GD_SHELL.leoTop, lb: 'НОО 2000 км' },
    { r: GD_SHELL.meoTop, lb: 'ГСО 35 786 км' },
  ];
  // ── САМО КОЛЬЦО ───────────────────────────────────────────────────────────
  // Рисуется ПОД грядками: обод — опора, а не рамка поверх. Порядок частей тот
  // же, что у настоящей фермы: дальний рельс, поперечины, ближний рельс, отсеки.
  // ⚠️ СВЕТ НА ОРБИТЕ — НЕ РОВНЫЙ. Кольцо за виток уходит в тень планеты и
  // выходит обратно: отсек на ночной стороне не досвечивается, и это ЕДИНСТВЕННОЕ
  // условие, которое меняется само, без игрока. Отсюда и смысл выбирать, где
  // сеять: угол отсека на ободе решает, сколько он берёт света.
  const sunAt = t => t * .02;                       // светило обходит сцену
  // 1 — полный свет, 0 — в тени планеты. Тень = конус за планетой, по ширине
  // это примерно её диск, поэтому в темноте всегда небольшая дуга обода.
  function bayLight(a, t) {
    let d = Math.abs(((a - sunAt(t) - Math.PI) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    const half = Math.asin(gClamp(1 / GD_RING, 0, 1));   // полуугол тени с обода
    return gClamp(d / half - .35, 0, 1);
  }

  // ⚠️ ПЛАНЕТА БЫЛА ПЛОСКИМ БЕЖЕВЫМ КРУГОМ. Пейнтер карты рисует тело ровной
  // заливкой — на карте это верно (там тело размером с горошину), но здесь оно
  // занимает весь кадр, и без светораздела читается картонным кружком. Кладём
  // терминатор от того же светила, что двигает тень на кольце, и тонкий лимб:
  // шар должен быть шаром, и должно быть видно, откуда свет.
  function drawLimb(x, y, R, t) {
    const sa = sunAt(t);
    const sx = Math.cos(sa), sy = Math.sin(sa) * .5;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.clip();

    // ⚠️ ПЛАНЕТА — ТЁМНАЯ МАССА, А НЕ ЗАЛИВКА. Пейнтер карты отдаёт ровный
    // бежевый диск; на весь кадр это картон, и он забивает единственное, что
    // здесь должно светиться, — теплицы. Гасим тело почти в чёрное и оставляем
    // только серп у светила: так планета ВЕСИТ, а сад читается на её фоне.
    const g = ctx.createLinearGradient(x + sx * R, y + sy * R, x - sx * R, y - sy * R);
    // ⚠️ ТЁМНАЯ — НЕ ЗНАЧИТ ЧЁРНАЯ. Первый заход гасил диск в ноль, и кадр
    // становился чёрной дырой с волоском серпа: замер дал 99.4% тени. Тело
    // должно ЧИТАТЬСЯ массой — дневная сторона приглушена, но видна, и только
    // ночная уходит в темноту.
    g.addColorStop(0, 'rgba(6,9,14,.00)');
    g.addColorStop(.22, 'rgba(5,8,13,.34)');
    g.addColorStop(.52, 'rgba(4,6,11,.72)');
    g.addColorStop(1, 'rgba(3,5,9,.93)');
    ctx.fillStyle = g;
    ctx.fillRect(x - R, y - R, R * 2, R * 2);
    ctx.restore();

    // Серп: узкая дуга по самой кромке со стороны светила — единственное место,
    // где у планеты есть цвет. Три слоя дают спад без градиента вдоль дуги.
    for (let i = 0; i < 3; i++) {
      const k = i / 2;
      ctx.strokeStyle = `rgba(255,${232 - k * 40},${198 - k * 60},${.42 - k * .28})`;
      ctx.lineWidth = R * (.006 + k * .022);
      ctx.beginPath();
      ctx.arc(x, y, R * (.996 - k * .012), sa - 1.05 - k * .35, sa + 1.05 + k * .35);
      ctx.stroke();
    }

    // Атмосфера: холодная кайма снаружи диска, ярче всего у серпа.
    ctx.strokeStyle = 'rgba(143,211,255,.13)'; ctx.lineWidth = R * .016;
    ctx.beginPath(); ctx.arc(x, y, R * 1.010, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(178,224,255,.26)'; ctx.lineWidth = R * .01;
    ctx.beginPath(); ctx.arc(x, y, R * 1.008, sa - 1.3, sa + 1.3); ctx.stroke();
  }

  function drawShadow(n, x, y, U, t) {
    const sa = sunAt(t) + Math.PI;                   // тень уходит ОТ светила
    const half = Math.asin(gClamp(1 / GD_RING, 0, 1));
    const far = GD_RP * GD_SHELL.geo;
    ctx.fillStyle = 'rgba(4,7,12,.62)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 0; i <= 12; i++) {
      const a = sa - half + (2 * half) * (i / 12);
      // Та же мера, что у поясов и обода: конус тени должен ложиться ровно на
      // те кольца, которые он гасит.
      ctx.lineTo(x + Math.cos(a) * far * U * Math.SQRT2,
                 y + Math.sin(a) * far * GD_TH / 2 * Math.SQRT2);
    }
    ctx.closePath(); ctx.fill();
  }

  function drawRing(n, x, y, U, t, ownCells) {
    const R0 = GD_RP * GD_RING;
    const W = GD_RINGW;
    // ⚠️ ОБОД СТРОИТСЯ В МИРОВЫХ КООРДИНАТАХ И ГОНИТСЯ ЧЕРЕЗ gIso — КАК ЯЧЕЙКИ.
    // Прямой эллипс здесь был враньём: gIso не только сплющивает плоскость 2:1,
    // он ещё и поворачивает её на 45°. Кольцо шло без поворота, ячейки — с ним,
    // и сад уезжал по диагонали от собственных теплиц. Одна проекция на сцену.
    const pt = (a, r) => {
      const s = gIso(n.tx + Math.cos(a) * r, n.ty + Math.sin(a) * r);
      return { x: s.x, y: s.y - GD_LIFT };
    };

    // ⚠️ ОБОД НЕ ОБВОДИТСЯ, ОН ЛОВИТ СВЕТ. Ровная линия по всему кругу — это
    // чертёж; металл на орбите блестит там, где на него падает светило, и тонет
    // в тени. Рельсы и поперечины гасим по тому же bayLight, что и теплицы.
    const rail = (r, base) => {
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 72; i++) {
        const a0 = (i / 72) * Math.PI * 2, a1 = ((i + 1.04) / 72) * Math.PI * 2;
        const L = bayLight(a0, t);
        const p0 = pt(a0, r), p1 = pt(a1, r);
        ctx.strokeStyle = `rgba(196,214,232,${base * (.10 + L * .52)})`;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
    };
    rail(R0 + W, 1);

    for (let i = 0; i < GD_BAYS * 2; i++) {
      const a = (i / (GD_BAYS * 2)) * Math.PI * 2;
      const L = bayLight(a, t);
      ctx.strokeStyle = `rgba(150,172,196,${.06 + L * .26})`;
      ctx.lineWidth = 1;
      const o = pt(a, R0 + W), q = pt(a, R0 - W);
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }

    rail(R0 - W, .8);

    // Отсеки. Свой — застеклён и освещён изнутри (в нём и стоит грядка), чужой
    // и пустой — голая рама: ободу есть куда расти, и это видно без объяснений.
    for (let j = 0; j < GD_BAYS; j++) {
      const a = (j / GD_BAYS) * Math.PI * 2 + n.seed * .01;
      const c = pt(a, R0);
      const own = ownCells && j < ownCells;
      // ⚠️ ОТСЕК ДОЛЖЕН БЫТЬ КОРПУСОМ, В КОТОРОМ СТОИТ ГРЯДКА. Прежний был вдвое
      // уже грядки и почти прозрачным: на экране выходила сыпь серых трапеций
      // отдельно и висящие эллипсы отдельно — то есть ни постройки, ни сада.
      // Ширина берётся ОТ ГРЯДКИ (21 * plotScale в мировых px), чтобы грядка
      // села внутрь корпуса, а не рядом с ним.
      // Грядка рисуется в тех же мировых пикселях (21*PS по полуширине), значит
      // корпус меряется ими же — иначе он снова разъедется с садом.
      const w = 21 * PS + 10, h = 10.5 * PS + 16;
      const L = bayLight(a, t);
      ctx.save(); ctx.translate(c.x, c.y);

      // ⚠️ ТЕПЛИЦА — ЕДИНСТВЕННЫЙ ИСТОЧНИК СВЕТА В КАДРЕ. Всё остальное здесь
      // только отражает: планета тёмная, камни тёмные, обод блестит кромкой.
      // Поэтому свой отсек не обводится, а СВЕТИТСЯ — сначала ореолом наружу,
      // потом стеклом. Ночью лампы держат ровный тёплый свет, днём добавляется
      // солнце: по кадру сразу видно, где у тебя сейчас день.
      if (own) {
        const gr = Math.max(w, h) * 2.1;
        ctx.globalAlpha = .30 + L * .22;
        ctx.drawImage(bayGlow, -gr, -gr - h * .3, gr * 2, gr * 2);
        ctx.globalAlpha = 1;
      }

      // Пол отсека: плита, на которой лежит грунт. Без неё грядка «висит».
      ctx.fillStyle = own ? 'rgba(16,22,26,.95)' : 'rgba(10,13,17,.92)';
      ctx.beginPath();
      ctx.moveTo(-w, h * .18); ctx.lineTo(-w * .66, -h);
      ctx.lineTo(w * .66, -h); ctx.lineTo(w, h * .18);
      ctx.closePath(); ctx.fill();

      if (own) {
        ctx.fillStyle = `rgba(126,206,158,${.10 + L * .16})`;
        ctx.fill();
        // Кромка стекла ловит свет так же, как рельсы, — одним законом на сцену.
        ctx.strokeStyle = `rgba(196,246,214,${.22 + L * .40})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        // Лампы: ровная тёплая полоса под крышей. Она и есть «свой» отсек.
        ctx.fillStyle = `rgba(255,196,107,${.34 + L * .12})`;
        ctx.fillRect(-w * .52, -h * .88, w * 1.04, Math.max(1, h * .05));
      } else {
        // Чужой отсек — голое ребро: видно только там, где на него падает свет.
        ctx.strokeStyle = `rgba(150,172,196,${.05 + L * .24})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Храм — узел обода: с него всё началось, к нему всё и пристроено.
    // Храм — самый яркий огонь на ободе: по нему кольцо и опознаётся издали.
    const hub = pt(n.seed * .01, R0);
    const hr = 7 * U * .5;
    ctx.globalAlpha = .55 + Math.sin(t * 1.1) * .10;
    ctx.drawImage(hubGlow, hub.x - hr * 3, hub.y - hr * 3, hr * 6, hr * 6);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(10,13,18,.95)';
    ctx.beginPath(); ctx.ellipse(hub.x, hub.y, hr, 6 * GD_TH / 2, 0, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(255,206,130,${.72 + Math.sin(t * 1.1) * .14})`;
    ctx.beginPath(); ctx.arc(hub.x, hub.y, 2.2 * U * .5, 0, 7); ctx.fill();
  }

  function drawShells(x, y, U) {
    // Радиусы поясов — в той же мере, что и обод с ячейками (см. √2 у gIso).
    const K = Math.SQRT2;
    const rxOf = r => GD_RP * r * U * K, ryOf = r => GD_RP * r * GD_TH / 2 * K;
    // Полоса НОО залита — это обжитая высота: сад, станции, весь мусор.
    ctx.fillStyle = 'rgba(143,211,255,.045)';
    ctx.beginPath();
    ctx.ellipse(x, y, rxOf(GD_SHELL.leoTop), ryOf(GD_SHELL.leoTop), 0, 0, 7);
    ctx.ellipse(x, y, rxOf(GD_SHELL.leo), ryOf(GD_SHELL.leo), 0, 0, 7, true);
    ctx.fill();

    ctx.lineWidth = 1;
    ctx.font = '11px ui-monospace,SFMono-Regular,Menlo,monospace';
    ctx.textAlign = 'left';
    GD_BANDS.forEach(b => {
      const rx = rxOf(b.r), ry = ryOf(b.r);
      ctx.strokeStyle = 'rgba(143,211,255,.16)';
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(143,211,255,.34)';
      ctx.fillText(b.lb, x + rx * .70, y - ry * .70);
    });

    // Орбита захоронения: пунктиром — туда уводят отработавшее, там не живут.
    ctx.setLineDash([6, 7]);
    ctx.strokeStyle = 'rgba(180,160,140,.20)';
    ctx.beginPath();
    ctx.ellipse(x, y, GD_RP * GD_SHELL.grave * U, GD_RP * GD_SHELL.grave * GD_TH / 2, 0, 0, 7);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ══════════════════════════════════════════════════════════
  // ЯЧЕЙКА С КУЛЬТУРОЙ
  // ══════════════════════════════════════════════════════════
  // ⚠️ ГРЯДКА МЕРЯЕТСЯ ОТ МИРА, А НЕ В ПИКСЕЛЯХ. Все размеры ниже умножены на
  // PS: без него грядка остаётся значком с прежнего, галактического масштаба —
  // рядом с садоводом это пятнышко, в которое непонятно, как целиться.
  const PS = world.plotScale || 1;

  // Силуэт культуры выбирается ИМЕНЕМ посева, а не случайно: игрок должен
  // узнавать грядку издали, не открывая панель, и узнавать её завтра тоже.
  const GD_FORMS = ['fan', 'vine', 'pod', 'crown'];
  const formOf = pl => pl.kind === 'ichor' ? 'tree'
    : GD_FORMS[gSeedOf(pl.res || pl.kind || '') % GD_FORMS.length];

  // Цвет ведёт РЕЖИМ (care), а не вид: чахнущая культура желтеет и никнет
  // одинаково, какой бы формы ни была — иначе беду не прочесть с одного взгляда.
  function leafCol(care, a) {
    const r = Math.round(126 + (1 - care) * 92), g = Math.round(196 - (1 - care) * 46),
          b = Math.round(168 - (1 - care) * 96);
    return `rgba(${r},${g},${b},${a})`;
  }

  // Один лист = серп: две дуги от черешка к острию. Дешевле спрайта и не мылится
  // на приближении, а камера в саду стоит ВПЛОТНУЮ.
  function leaf(x, y, len, wid, ang, col) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * .45, -wid, len, 0);
    ctx.quadraticCurveTo(len * .45, wid * .42, 0, 0);
    ctx.fill();
    ctx.restore();
  }

  function drawPlot(p, t, x, y, mine) {
    // ГРЯДКА, А НЕ ЗНАЧОК: вскопанная земля, борозды и кромка. Раньше здесь были
    // два волосяных кольца — на них не читалось ни что это грядка, ни чья она.
    const RX = 21 * PS, RY = 10.5 * PS;
    ctx.fillStyle = mine ? 'rgba(38,46,42,.72)' : 'rgba(34,38,44,.46)';
    ctx.beginPath(); ctx.ellipse(x, y, RX, RY, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(20,26,24,.55)'; ctx.lineWidth = 1 * PS;
    for (let i = -1; i <= 1; i++) {
      const fy = y + i * RY * .42, fw = RX * Math.sqrt(1 - (i * .42) ** 2) * .82;
      ctx.beginPath(); ctx.moveTo(x - fw, fy); ctx.lineTo(x + fw, fy); ctx.stroke();
    }
    ctx.strokeStyle = mine ? 'rgba(143,211,255,.46)' : 'rgba(140,160,180,.20)';
    ctx.lineWidth = 1.2 * PS;
    ctx.beginPath(); ctx.ellipse(x, y, RX, RY, 0, 0, 7); ctx.stroke();

    const pl = p.plant;
    if (!pl) return;

    const grow = pl.ripe ? 1 : gClamp(1 - pl.left / (pl.kind === 'ichor' ? 72 * 3600 : 24 * 3600), .08, 1);
    const care = pl.care == null ? 1 : pl.care;
    const form = formOf(pl);
    const sd = gSeedOf((pl.res || '') + pl.id) % 601;
    const h = (form === 'tree' ? 46 : 26) * grow * PS;
    const lean = (1 - care) * 6 * PS;
    // Дыхание: чем суше и заросшее, тем слабее качает — растение живое ровно
    // настолько, насколько за ним ходят.
    const sway = Math.sin(t * .9 + sd) * (.6 + care * 1.6) * PS * grow;
    const tipx = x + lean + sway, tipy = y - h;
    const stem = form === 'tree'
      ? (care > .6 ? '#8f7ac4' : '#5f5872')
      : (care > .55 ? '#5f8f6b' : '#7a7454');

    ctx.globalAlpha = (.22 + care * .38) * (form === 'tree' ? 1 : .55);
    const dr = h * .9 + 8 * PS;
    ctx.drawImage(form === 'tree' ? ichorGlow : domeGlow, x - dr, y - h * .5 - dr, dr * 2, dr * 2);
    ctx.globalAlpha = 1;

    // Всходы: пока культура не поднялась, у неё есть ТОЛЬКО семядоли. Сразу
    // рисовать взрослый силуэт мелким — значит стереть саму идею роста.
    if (grow < .22 && form !== 'tree') {
      const s = 5 * PS + grow * 14 * PS;
      leaf(x, y - 2 * PS, s, s * .5, -2.5 + sway * .04, leafCol(care, .85));
      leaf(x, y - 2 * PS, s, s * .5, -0.6 + sway * .04, leafCol(care, .85));
      return;
    }

    ctx.strokeStyle = stem; ctx.lineCap = 'round';
    ctx.lineWidth = (form === 'tree' ? 3.2 : 1.9) * PS;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.quadraticCurveTo(x + lean * .4, y - h * .6, tipx, tipy);
    ctx.stroke();

    if (form === 'fan') {
      // Веер: листья одной длины из одной точки — злак, читается щёткой.
      const n = 5;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i - (n - 1) / 2) * .46 + sway * .03;
        leaf(tipx, tipy + h * .12, h * .62, h * .13, a, leafCol(care, .9));
      }
    } else if (form === 'vine') {
      // Лоза: листья парами по стеблю + завиток усика на макушке.
      for (let i = 1; i <= 3; i++) {
        const u = i / 3.6, ly = y - h * u, lx = x + lean * u * .6 + sway * u;
        const s = h * (.42 - u * .12);
        leaf(lx, ly, s, s * .34, -2.85 + sway * .04, leafCol(care, .88));
        leaf(lx, ly, s, s * .34, -0.29 + sway * .04, leafCol(care, .88));
      }
      ctx.lineWidth = 1.1 * PS; ctx.strokeStyle = leafCol(care, .8);
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const a = i * .62, rr = 3.4 * PS * grow * (1 - i / 22);
        const cx2 = tipx + 4 * PS + Math.cos(a) * rr, cy2 = tipy + Math.sin(a) * rr;
        i ? ctx.lineTo(cx2, cy2) : ctx.moveTo(cx2, cy2);
      }
      ctx.stroke();
    } else if (form === 'pod') {
      // Стручки: висят вдоль стебля, к спелости наливаются тёплым.
      for (let i = 0; i < 4; i++) {
        const u = .28 + i * .19, py = y - h * u, px = x + lean * u + sway * u
          + (i % 2 ? 4.6 : -4.6) * PS;
        ctx.fillStyle = pl.ripe ? GD_WARM : leafCol(care, .8);
        ctx.beginPath();
        ctx.ellipse(px, py, 2.1 * PS * grow, 5.6 * PS * grow, (i % 2 ? .3 : -.3), 0, 7);
        ctx.fill();
      }
      leaf(x + lean * .3, y - h * .3, h * .34, h * .1, -2.7, leafCol(care, .7));
      leaf(x + lean * .3, y - h * .3, h * .34, h * .1, -0.44, leafCol(care, .7));
    } else if (form === 'crown') {
      // Розетка: широкие листья веером книзу, соцветие сверху.
      const n = 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + sd * .01;
        leaf(x, y - 2 * PS, h * .5, h * .17, a * .5 - Math.PI * .5 + (i % 2 ? .2 : -.2),
             leafCol(care, .8));
      }
      ctx.fillStyle = pl.ripe ? GD_WARM : leafCol(care, .95);
      ctx.beginPath(); ctx.arc(tipx, tipy, 3.6 * PS * grow, 0, 7); ctx.fill();
    } else {
      // Древо ихора: крона гроздью пузырей, дышит в такт свечению.
      const pu = .8 + Math.sin(t * 1.6) * .2;
      ctx.fillStyle = care > .6 ? `rgba(201,166,255,${.26 * pu})` : 'rgba(120,110,150,.20)';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + sd * .01;
        ctx.beginPath();
        ctx.arc(tipx + Math.cos(a) * 7 * PS * grow, tipy + Math.sin(a) * 4.5 * PS * grow,
                8 * PS * grow * pu, 0, 7);
        ctx.fill();
      }
      for (let i = 1; i <= 2; i++) {
        const u = i / 3;
        ctx.strokeStyle = stem; ctx.lineWidth = 1.6 * PS;
        ctx.beginPath();
        ctx.moveTo(x + lean * u * .4, y - h * u);
        ctx.lineTo(x + lean * u + (i % 2 ? 11 : -11) * PS * grow, y - h * (u + .18));
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';

    if (pl.weeds > 55) {
      // Сорняк лезет ИЗ ЗЕМЛИ по кромке грядки, а не висит частоколом по центру:
      // так видно, что он теснит посев, а не что посев такой.
      ctx.strokeStyle = 'rgba(150,160,110,.7)'; ctx.lineWidth = 1 * PS;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + sd * .02;
        const wx = x + Math.cos(a) * RX * .72, wy = y + Math.sin(a) * RY * .72;
        ctx.beginPath(); ctx.moveTo(wx, wy);
        ctx.quadraticCurveTo(wx + 2 * PS, wy - 5 * PS, wx + 5 * PS, wy - 8 * PS);
        ctx.stroke();
      }
    }
    if (pl.water < 20) {
      ctx.fillStyle = '#e0a34a';
      ctx.beginPath(); ctx.arc(x + 13 * PS, y - h - 6 * PS, 2.6 * PS, 0, 7); ctx.fill();
    }
    if (pl.ripe) {
      ctx.fillStyle = GD_WARM;
      ctx.font = Math.round(12 * PS) + 'px ui-monospace,SFMono-Regular,Menlo,monospace';
      ctx.textAlign = 'center';
      ctx.fillText('◆', x, y - h - 13 * PS); ctx.textAlign = 'left';
    }
  }

  // ══════════════════════════════════════════════════════════
  // ЛОВЛЯ КАМНЕЙ — ЭТО И ЕСТЬ ВТОРАЯ ПОЛОВИНА ИГРЫ
  // ══════════════════════════════════════════════════════════
  // ⚠️ РАНЬШЕ «ЗАЧЕРПНУТЬ ВЗВЕСЬ» ЖАЛОСЬ В ПУСТОМ МЕСТЕ. Трал предлагался в
  // ЛЮБОЙ точке пустоты, целью были собственные координаты — то есть игрок жал
  // «E» посреди ничего и надеялся на бросок кубика. Ловить надо ВИДИМЫЙ камень:
  // он дрейфует, к нему надо подойти бортом, и он уходит из поля, когда пойман.
  // Само событие клёва по-прежнему решает сервер (fishing_cast).
  const AST = [];
  (function seedAsteroids() {
    const n = world.nodes[0];
    if (!n) return;
    const cnt = world.solo ? 30 : 0;
    for (let i = 0; i < cnt; i++) {
      const a = gHash(i * 13, 7, 301) * Math.PI * 2;
      // ⚠️ КАМНИ НЕ ЛЕТАЮТ НАД ГРЯДКАМИ. Раньше поле обломков занимало те же
      // высоты, что и кольцо сада (VLEO…верх НОО): камень висел поверх теплиц,
      // перекрывал панель ячейки и перехватывал клик — тыкаешь в грядку, а
      // ловишь щебень. Пояс вынесен НАРУЖУ, на средние орбиты: за уловом надо
      // ОТОЙТИ от сада, и это правильно — это две разные работы.
      const rr = GD_RP * (GD_BELT.lo + (GD_BELT.hi - GD_BELT.lo) * gHash(i * 29, 11, 303));
      AST.push({
        tx: n.tx + Math.cos(a) * rr, ty: n.ty + Math.sin(a) * rr,
        // ⚠️ ЭТО КАМЕНЬ, А НЕ АСТЕРОИД. Прежние 2.2–6.4 единицы = до 14% радиуса
        // планеты: обломок выходил вдвое крупнее корабля и с целый отсек
        // теплицы. Такое не черпают сетью. Камень мельче корабля — тогда видно,
        // что его подбирают, а не таранят.
        r: .35 + gHash(i * 7, 3, 305) * .85,             // радиус в единицах
        sd: gSeedOf('ast' + i) % 911,
        // Дрейф по кольцу вокруг светила плюс своё вращение: поле должно жить,
        // а не висеть декорацией.
        ang: a, orb: rr, sp: (.006 + gHash(i * 5, 9, 307) * .01) * (i % 2 ? 1 : -1),
        spin: (gHash(i * 3, 5, 309) - .5) * .6,
        rot: gHash(i * 11, 2, 311) * 6.28,
        gone: 0,
      });
    }
  })();
  const n0 = world.nodes[0];
  function astStep(dt, t) {
    for (let i = 0; i < AST.length; i++) {
      const A = AST[i];
      // ⚠️ ФЛАГ НАДО ГАСИТЬ. `gone` уходил в минус и оставался ИСТИННЫМ навсегда:
      // камень каждый кадр прибавлял к углу 1.7 радиана — на экране это метался
      // и мерцал объект «с адской скоростью», пойманный обломок, который так и
      // не вернулся в поле. Возврат — ОДИН раз, потом флаг в ноль.
      if (A.gone > 0) {                                  // пойманный уходит и
        A.gone -= dt;                                    // возвращается новым
        if (A.gone > 0) continue;
        A.gone = 0;
        A.orb = GD_RP * (GD_BELT.lo + (GD_BELT.hi - GD_BELT.lo) * gHash(A.sd, i, 313));
        A.ang += 1.7;
      }
      A.ang += A.sp * dt;
      A.rot += A.spin * dt;
      A.tx = n0.tx + Math.cos(A.ang) * A.orb;
      A.ty = n0.ty + Math.sin(A.ang) * A.orb;
    }
  }
  // Ближайший камень в пределах сачка — цель для «E».
  function astNear(tx, ty, reach) {
    let best = null, bd = reach * reach;
    for (let i = 0; i < AST.length; i++) {
      const A = AST[i];
      if (A.gone > 0) continue;
      const d = (A.tx - tx) ** 2 + (A.ty - ty) ** 2;
      if (d < bd) { bd = d; best = A; }
    }
    return best;
  }
  function drawAsteroids(t) {
    const U = GD_TW / 2;
    for (let i = 0; i < AST.length; i++) {
      const A = AST[i];
      if (A.gone > 0) continue;
      const c = gIso(A.tx, A.ty);
      const R = A.r * U;
      if (c.x + R < vx0s || c.x - R > vx1s || c.y + R < vy0s || c.y - R > vy1s) continue;
      ctx.save();
      ctx.translate(c.x, c.y - GD_LIFT);
      ctx.rotate(A.rot);
      // Обломок рисуется многоугольником по seed: два камня не близнецы.
      ctx.beginPath();
      const V = 9;
      for (let j = 0; j < V; j++) {
        const a = j / V * Math.PI * 2;
        const rr = R * (.72 + gHash(A.sd, j, 317) * .5);
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr * .78;
        j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      // ⚠️ КАМЕНЬ — СИЛУЭТ С КРОМКОЙ, А НЕ КОРИЧНЕВЫЙ МНОГОУГОЛЬНИК В ОБВОДКЕ.
      // Прежний рисовался светлой заливкой с чёрным контуром и синей жилой —
      // на чёрном это читалось наклейкой и спорило яркостью с теплицами. Тело
      // почти чёрное, свет ловит только кромка со стороны светила.
      const sa = sunAt(t) - A.rot;                  // светило в системе камня
      ctx.fillStyle = '#0a0d12'; ctx.fill();
      ctx.save(); ctx.clip();
      const g = ctx.createLinearGradient(Math.cos(sa) * R, Math.sin(sa) * R * .78,
                                         -Math.cos(sa) * R, -Math.sin(sa) * R * .78);
      g.addColorStop(0, 'rgba(190,176,158,.85)');
      g.addColorStop(.22, 'rgba(96,88,78,.35)');
      g.addColorStop(.5, 'rgba(20,20,24,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-R * 1.2, -R * 1.2, R * 2.4, R * 2.4);
      ctx.restore();
      ctx.restore();
    }
    // ⚠️ ЦЕЛЬ ДЛЯ СЕТИ ПОКАЗЫВАЕМ ЯВНО. Ловят мышью, значит игрок должен
    // видеть, докуда сеть добрасывается: ближайший камень в пределах броска
    // берём в прицел и подписываем ЛКМ — без подписи это опять угадайка.
    const tgt = astNear(P.tx, P.ty, world.reach * 6);
    if (tgt) {
      const c = gIso(tgt.tx, tgt.ty);
      const R = tgt.r * U + 10 / cam.z;
      ctx.strokeStyle = 'rgba(143,211,255,.7)'; ctx.lineWidth = 1.2 / cam.z;
      ctx.setLineDash([4 / cam.z, 4 / cam.z]);
      ctx.beginPath(); ctx.ellipse(c.x, c.y - GD_LIFT, R, R * .78, 0, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(205,230,250,.9)';
      ctx.font = `${Math.round(10 / cam.z)}px ui-monospace,SFMono-Regular,Menlo,monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('ЛКМ — СЕТЬ', c.x, c.y - GD_LIFT - R - 8 / cam.z);
      ctx.textAlign = 'left';
    }
  }

  // ══════════════════════════════════════════════════════════
  // ФАКЕЛЬЩИК: КОРПУС КЛАССА + ШЛЯПА САДОВОДА
  // ══════════════════════════════════════════════════════════
  // ⚠️ «ФАКЕЛЬЩИК» — ЭТО КЛАСС КОРАБЛЯ (hyperCruiser), А НЕ ЛОДКА С ФОНАРЁМ.
  // Я успел нарисовать деревянную посудину — это была отсебятина: у класса есть
  // свой силуэт в конструкторе (CN_SHIP_GEO.hypercruiser — длинный широкий клин,
  // лафет мобильной «Длани»), и корабль игрока обязан читаться ИМ. Корпус
  // строится по тем же шпангоутам, что и палуба с боевой доской, только
  // вектором: на садовом зуме растровый спрайт расползается в мыло.
  //
  // ⚠️ ШЛЯПА НЕ КОЛЫШЕТСЯ. Первая версия гнала волну по полям каждый кадр — на
  // экране это читалось трясущимся желе, а не шляпой: форма не успевала
  // опознаться. Силуэт ЖЁСТКИЙ; живёт только наклон — запаздывание за
  // поворотом (пружина) и лёгкий кивок на разгоне. Движение должно объяснять
  // ФИЗИКУ, а не заполнять кадр.
  const GD_SHIP_U = world.shipU;         // длина корпуса в мировых единицах
  const GD_SHIP_MIN = 11;                // метка не мельче этого на экране, px
  const GD_SHIP_HULL = world.shipHull;   // с этого экранного размера рисуем корпус
  const torchGlow = gGlowSprite('143,211,255', .45);   // ходовой свет, не факел

  // Шпангоуты класса: нос в первой точке, корма в последней. Приводим к длине 1
  // и полуширине в долях длины — дальше умножаем на L и не думаем о единицах.
  const HULL = (() => {
    const G = (typeof CN_SHIP_GEO !== 'undefined' && CN_SHIP_GEO)
      ? (CN_SHIP_GEO.hypercruiser || CN_SHIP_GEO.corvette) : null;
    const ST = (G && G.st && G.st.length > 2)
      ? G.st : [[26, 6], [70, 26], [180, 46], [300, 40], [392, 22]];
    const tip = ST[0][0], stern = ST[ST.length - 1][0], len = stern - tip || 1;
    return ST.map(pt => [(stern - pt[0]) / len - .5, pt[1] / len]);   // x∈[-.5,.5]
  })();

  // Пружина шляпы: она запаздывает за поворотом и тем показывает вес.
  const HAT = { lag: 0, vel: 0, prev: P.ang, wave: -9, bite: -9 };
  function hatStep(dt, t) {
    let d = P.ang - HAT.prev;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    HAT.prev = P.ang;
    const rate = dt > 0 ? d / dt : 0;
    HAT.vel += (-rate * .1 - HAT.lag) * Math.min(1, dt * 14) - HAT.vel * Math.min(1, dt * 6);
    HAT.lag = gClamp(HAT.lag + HAT.vel, -.3, .3);
    if (_gd && _gd.actAt) HAT.wave = _gd.actAt;
    if (_gdHook) { if (HAT.bite < 0) HAT.bite = t; } else HAT.bite = -9;
  }

  // ⚠️ КОРАБЛЬ РИСУЕТСЯ НЕ ТОЛЬКО СВОЙ. Чужие садоводы — те же факельщики, в
  // своих шляпах и своей краске, и рисовать их второй, упрощённой функцией
  // значило бы завести второй корабль, который разъедется с первым на первой
  // же правке. Поэтому drawShip принимает, КОГО рисует: sh — состояние (курс,
  // тяга, качка), lk — облик, col — цвет державы, self — свой ли (только у
  // своего живут пружина шляпы и сачок).
  function drawShip(x, y, overPlat, sh, lk, col2, self) {
    sh = sh || P;
    lk = lk || GD_LOOK;
    const own = self !== false;
    const col = col2 || (typeof _fishFlag !== 'undefined' && _fishFlag.col) || '#6f8bb5';
    const cy = y - 15 - (sh.bob || 0);
    const t = performance.now() / 1000;

    const U = GD_TW / 2;
    const scr = Math.max(GD_SHIP_MIN, GD_SHIP_U * U * cam.z);   // экранная длина
    const L = scr / cam.z;                                      // она же в мире
    if (scr < GD_SHIP_HULL) {                                   // метка, а не корпус
      const r = L * .5;
      ctx.save();
      ctx.translate(x, cy); ctx.rotate(sh.ang);
      ctx.fillStyle = 'rgba(255,196,107,.25)';
      ctx.beginPath(); ctx.arc(0, 0, r * 1.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffe6b0';
      ctx.beginPath();
      ctx.moveTo(r, 0); ctx.lineTo(-r * .7, -r * .62); ctx.lineTo(-r * .35, 0);
      ctx.lineTo(-r * .7, r * .62); ctx.closePath(); ctx.fill();
      ctx.restore();
      return;
    }

    if (overPlat) {                                    // тень — признак площадки
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath(); ctx.ellipse(x, y, L * .5, L * .18, 0, 0, 7); ctx.fill();
    }

    // Ходовой свет корабля: холодное пятно под корпусом, заметное на ходу.
    // Тёплый ореол «от факела» убран вместе со свечкой на носу — он делал из
    // корабля лампу и перекрашивал грядки вокруг в оранжевый.
    const flick = .9 + Math.sin(t * 9) * .07 + Math.sin(t * 21.3) * .03;
    const gr = L * (.5 + sh.thr * .45);
    ctx.globalAlpha = .18 + sh.thr * .22;
    ctx.drawImage(torchGlow, x - gr, cy - gr, gr * 2, gr * 2);
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(x, cy);
    ctx.rotate(sh.ang);

    // ── Корпус класса. Обводим шпангоуты по верхнему борту и обратно по нижнему.
    const hullPath = k => {
      ctx.beginPath();
      for (let i = 0; i < HULL.length; i++) {
        const px2 = HULL[i][0] * L, py = -HULL[i][1] * L * k;
        i ? ctx.lineTo(px2, py) : ctx.moveTo(px2, py);
      }
      for (let i = HULL.length - 1; i >= 0; i--) ctx.lineTo(HULL[i][0] * L, HULL[i][1] * L * k);
      ctx.closePath();
    };
    hullPath(1);
    // Расцветка корпуса — выбор игрока (GD_HULLS), цвет державы остаётся
    // полосой по борту ниже: одно про вкус, другое про принадлежность.
    const HC = GD_HULLS[lk.hull] || GD_HULLS.steel;
    const hg = ctx.createLinearGradient(0, -L * .2, 0, L * .2);
    hg.addColorStop(0, HC.a); hg.addColorStop(.42, HC.b); hg.addColorStop(1, HC.c);
    ctx.fillStyle = hg; ctx.fill();
    ctx.strokeStyle = gShade(col, .85); ctx.lineWidth = L * .012; ctx.stroke();
    // Продольный набор и цвет державы по борту — читается принадлежность.
    ctx.save(); hullPath(1); ctx.clip();
    ctx.strokeStyle = 'rgba(10,14,18,.55)'; ctx.lineWidth = L * .007;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath(); ctx.moveTo(-L * .5, i * L * .028); ctx.lineTo(L * .5, i * L * .028); ctx.stroke();
    }
    ctx.fillStyle = col; ctx.globalAlpha = .45;
    ctx.fillRect(-L * .5, -L * .13, L, L * .022);
    ctx.fillRect(-L * .5, L * .108, L, L * .022);
    ctx.globalAlpha = 1;
    ctx.restore();
    // Надстройка: приподнятая палуба у миделя, на неё и надета шляпа.
    hullPath(.42);
    ctx.fillStyle = HC.a; ctx.fill();
    ctx.strokeStyle = gShade(HC.t, 1); ctx.globalAlpha = .3;
    ctx.lineWidth = L * .008; ctx.stroke(); ctx.globalAlpha = 1;

    // Дюзы: свечение по тяге, у самой кормы.
    const ex = -L * .5, eg = L * (.05 + sh.thr * .12) * flick;
    const fg = ctx.createLinearGradient(ex, 0, ex - eg * 3, 0);
    fg.addColorStop(0, gShade(HC.t, .95)); fg.addColorStop(1, 'rgba(143,211,255,0)');
    ctx.fillStyle = fg; ctx.globalAlpha = .7;
    ctx.beginPath();
    ctx.moveTo(ex, -L * .05); ctx.lineTo(ex - eg * 3, 0); ctx.lineTo(ex, L * .05);
    ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;

    // ⚠️ САЧОК ПОКАЗЫВАЕТСЯ ТОЛЬКО В РАБОТЕ. Постоянная палка с кольцом за
    // кормой читается мусором, прилипшим к силуэту: в покое корабль должен быть
    // корпусом, а не вешалкой. Появляется на взмахе и на клёве, потом убирается.
    const sw = (own && HAT.wave > 0) ? gClamp(1 - (t - HAT.wave) / .55, 0, 1) : 0;
    const bite = (own && HAT.bite > 0) ? (.5 + Math.sin((t - HAT.bite) * 14) * .5) : 0;
    const netOn = Math.max(sw, (own && _gdHook) ? 1 : 0);
    if (netOn > .02) {
      const nx = -L * .3 + sw * L * .85, ny = L * (.16 - sw * .07);
      ctx.globalAlpha = netOn;
      ctx.strokeStyle = '#8f7a52'; ctx.lineWidth = L * .014;
      ctx.beginPath(); ctx.moveTo(-L * .22, L * .06); ctx.lineTo(nx, ny); ctx.stroke();
      ctx.strokeStyle = 'rgba(215,235,252,' + (.55 + bite * .4) + ')';
      ctx.lineWidth = L * .011;
      ctx.beginPath(); ctx.ellipse(nx, ny, L * .085, L * .065, .4, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Шляпа над рубкой. Кивает вперёд на разгоне, отстаёт на повороте — и всё.
    ctx.save();
    const lag = own ? HAT.lag : 0;
    ctx.translate(L * .02 + sh.thr * L * .015, lag * L * .1);
    ctx.rotate(lag * .55);
    gdDrawHat(ctx, L * .17, lk.hat);
    ctx.restore();

    // ⚠️ НИКАКОГО ОГНЯ НА НОСУ. Я поставил туда язык пламени, буквально поняв
    // имя класса, — на экране это свечка, воткнутая в корабль. «Факельщик» —
    // это гиперкрейсер, лафет «Длани»; его огонь там, где ему место: в дюзах.
    ctx.restore();

    // ⚠️ ГЕРБ НЕ ЛЕПИТСЯ КВАДРАТИКОМ НАД КОРАБЛЁМ. Так он вставал белым
    // прямоугольником поверх корпуса, не поворачивался вместе с ним и читался
    // наклейкой из другого приложения. Принадлежность и так видна цветом
    // державы по борту; герб — маленьким вымпелом НА корпусе, вписанным в круг
    // и повёрнутым по курсу, либо не рисуется вовсе.
    // ⚠️ ВЫМПЕЛ НАЕЗЖАЛ НА ШЛЯПУ. Он сидел на x = −0.12·L, а поля шляпы (центр
    // +0.02·L, радиус 0.17·L) доходят до −0.15·L: круг с гербом лез прямо под
    // них и обрезался соломой. Место вымпела — кормовая четверть (−0.33·L):
    // там борт ещё широкий (полуширина ≈ 0.10·L), шляпа далеко, а дюзы начи-
    // наются только с −0.5·L.
    const img = own ? _fishFlag.img : null;
    if (img && img.complete && img.naturalWidth && L > 60) {
      const r = L * .048;
      ctx.save();
      ctx.translate(x, cy); ctx.rotate(sh.ang);
      ctx.beginPath(); ctx.arc(-L * .33, 0, r, 0, 7);
      ctx.fillStyle = 'rgba(12,17,24,.85)'; ctx.fill();
      ctx.save(); ctx.clip();
      try { ctx.drawImage(img, -L * .33 - r, -r, r * 2, r * 2); }
      catch (e) { _fishFlag.img = null; }
      ctx.restore();
      ctx.strokeStyle = 'rgba(143,211,255,.5)'; ctx.lineWidth = L * .006; ctx.stroke();
      ctx.restore();
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
      ctx.globalAlpha = Math.min(1, ph * 2.5) * (1 - ph) * (.5 + P.boost * .55);
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

    // ⚠️ ВСЕ СВЕТИЛА УЖЕ ЗАПЕЧЕНЫ В mmCv (см. bakeMinimap) — второй проход по
    // world.nodes КАЖДЫЙ КАДР был чистой дубляжкой и стоил по arc() на систему
    // на кадр. Живыми остаются только свои земли и стрелка: их единицы.
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
    // ⚠️ ЦЕЛИ = МОИ ЗЕМЛИ + БЛИЖАЙШИЕ СВЕТИЛА. Раньше стрелки вели только к
    // своим системам: у кого их одна (или ноль), тот в пустоте оставался без
    // единого ориентира. Чужие ведём тускло и не больше шести штук, иначе
    // кромка кадра превращается в частокол.
    // ⚠️ БЕЗ map+sort ПО ВСЕМ СИСТЕМАМ КАЖДЫЙ КАДР. На полсотни светил это
    // незаметно, на настоящей карте — нет: аллокация массива объектов плюс
    // сортировка на кадр. Ближайшую шестёрку набираем одним проходом вставкой,
    // свои земли добавляем отдельно — их единицы.
    const lands = (_gdState && _gdState.lands) || [];
    const mine = new Map();
    lands.forEach(l => { const n = world.nodeOf(l.sys); if (n) mine.set(n.id, l); });
    // ⚠️ НЕ КАЖДЫЙ КАДР И НЕ ПО ВСЕЙ КАРТЕ. Шестёрка ближайших меняется за
    // секунды, а не за кадр: пересобираем раз в 250 мс и только из систем в
    // округе (сетка), а не перебором тысяч.
    const now = performance.now();
    if (!_cmp.near6 || now - _cmp.t > 250) {
      _cmp.t = now;
      const R = GD_SPACING * 6;
      const around = world.nodesIn(P.tx - R, P.ty - R, P.tx + R, P.ty + R, _cmpBuf);
      const near6 = [];
      for (const n of around) {
        const d = (n.tx - P.tx) ** 2 + (n.ty - P.ty) ** 2;
        if (near6.length < 6) { near6.push({ n, d }); near6.sort((a, b) => a.d - b.d); }
        else if (d < near6[5].d) { near6[5] = { n, d }; near6.sort((a, b) => a.d - b.d); }
      }
      _cmp.near6 = near6;
    }
    const near6 = _cmp.near6 || [];
    const seen = new Set(near6.map(o => o.n.id));
    const marks = near6.map(o => ({ n: o.n, l: mine.get(o.n.id) || null }));
    mine.forEach((l, id) => {
      if (seen.has(id)) return;
      const n = world.nodeOf(l.sys); if (n) marks.push({ n, l });
    });
    if (!marks.length) return;
    const m = 26, taken = [];
    marks.forEach(o => {
      const n = o.n, l = o.l || { land: '', name: n.name };
      const s = gIso(n.tx, n.ty);
      const x = (s.x - cam.x) * cam.z + vw / 2, y = (s.y - cam.y) * cam.z + vh / 2;
      if (x > m && x < vw - m && y > m && y < vh - m) return;
      const cx = vw / 2, cy = vh / 2;
      const ang = Math.atan2(y - cy, x - cx);
      const k = Math.min(Math.abs((vw / 2 - m) / Math.cos(ang)), Math.abs((vh / 2 - m) / Math.sin(ang)));
      const mx = cx + Math.cos(ang) * k, my = cy + Math.sin(ang) * k;
      const dist = Math.round(Math.hypot(n.tx - P.tx, n.ty - P.ty));
      const own = l.land === 'own';
      const tone = !o.l ? 'rgba(150,180,210,.5)'
                 : own ? 'rgba(143,211,255,.85)' : 'rgba(255,196,107,.85)';

      ctx.save();
      ctx.translate(mx, my); ctx.rotate(ang);
      ctx.fillStyle = tone;
      const a = o.l ? 7 : 5, b = o.l ? 4.5 : 3.4;
      ctx.beginPath(); ctx.moveTo(a, 0); ctx.lineTo(-b - .5, -b); ctx.lineTo(-b - .5, b); ctx.closePath(); ctx.fill();
      ctx.restore();

      const lx = gClamp(mx, 54, vw - 54), ly = gClamp(my + 16, 16, vh - 6);
      if (taken.some(p => Math.abs(p.x - lx) < 96 && Math.abs(p.y - ly) < 13)) return;
      taken.push({ x: lx, y: ly });
      ctx.fillStyle = o.l ? 'rgba(180,205,228,.75)' : 'rgba(150,180,210,.5)';
      ctx.font = '9.5px ui-monospace,SFMono-Regular,Menlo,monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${(l.name || '').slice(0, 14).toUpperCase()} ${dist}`, lx, ly);
      ctx.textAlign = 'left';
    });
  }

  // Буфер отрезков гиперпутей: живёт весь сеанс, чтобы отбор в кадре
  // не плодил массивы.
  const _lanes = [];

  // ── ГИПЕР: ОБЗОР В ЭКРАННЫХ ПИКСЕЛЯХ ──────────────────────────────────────
  // От мира берутся только координаты. Размеры — экранные и от зума НЕ зависят:
  // система это значок, путь это линия, корабль это метка. Мерить обзор мировой
  // линейкой бессмысленно: на честном масштабе система вырождается в пиксель.
  function drawHyperView(vis, vx0, vy0, vx1, vy1, t) {
    ctx.setTransform(px, 0, 0, px, 0, 0);
    const S = (wx, wy) => {                       // мир → экран
      const p = gIso(wx, wy);
      return { x: (p.x - cam.x) * cam.z + vw / 2, y: (p.y - cam.y) * cam.z + vh / 2 };
    };

    // Гиперпути
    const ls = world.lanesIn(vx0, vy0, vx1, vy1, _lanes);
    ctx.lineCap = 'round';
    for (let i = 0; i < ls.length; i++) {
      const a = S(ls[i].a.tx, ls[i].a.ty), b = S(ls[i].b.tx, ls[i].b.ty);
      ctx.strokeStyle = 'rgba(126,190,240,.16)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(190,228,255,.40)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const u = (t * .16 + (i % 7) * .14) % 1;
      ctx.fillStyle = 'rgba(215,240,255,.8)';
      ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, 1.8, 0, 7); ctx.fill();
    }

    // Системы-значки
    ctx.textAlign = 'center';
    ctx.font = '10px ui-monospace,SFMono-Regular,Menlo,monospace';
    for (let i = 0; i < vis.length; i++) {
      const n = vis[i], c = S(n.tx, n.ty);
      if (c.x < -60 || c.x > vw + 60 || c.y < -60 || c.y > vh + 60) continue;
      // Значок — тоже вектором: ядро с ореолом, гигант теплее и крупнее.
      const ic = n.giant ? 30 : 20;                     // габарит значка, px
      const rr = ic * .3;
      const hg = ctx.createRadialGradient(c.x, c.y, rr * .5, c.x, c.y, ic * .8);
      hg.addColorStop(0, n.giant ? 'rgba(255,206,120,.55)' : 'rgba(190,222,255,.45)');
      hg.addColorStop(1, 'rgba(140,180,230,0)');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(c.x, c.y, ic * .8, 0, 7); ctx.fill();
      ctx.fillStyle = n.giant ? '#ffd98a' : '#e8f2ff';
      ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, 7); ctx.fill();
      const l = _gdLand(n.id);
      if (l) {                                           // свои — с ободком
        ctx.strokeStyle = l.land === 'own' ? GD_EDGE : GD_WARM;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(c.x, c.y, ic * .62, 0, 7); ctx.stroke();
      }
      ctx.fillStyle = l ? 'rgba(215,235,252,.92)' : 'rgba(170,196,220,.55)';
      ctx.fillText((n.name || '').toUpperCase(), c.x, c.y + ic * .62 + 11);
    }
    ctx.textAlign = 'left';

    // Корабль: метка постоянного размера
    const me = S(P.tx, P.ty);
    ctx.save();
    ctx.translate(me.x, me.y); ctx.rotate(P.ang);
    ctx.fillStyle = 'rgba(150,220,255,.20)';
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, 7); ctx.fill();
    ctx.fillStyle = '#dff0ff';
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(-6, -5.4); ctx.lineTo(-3, 0); ctx.lineTo(-6, 5.4);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    const near = gardenNear(world, P);
    if (near) {
      ctx.fillStyle = 'rgba(205,230,250,.95)';
      ctx.font = '11px ui-monospace,SFMono-Regular,Menlo,monospace';
      ctx.textAlign = 'center';
      ctx.fillText(near.hint.toUpperCase() + '  ·  E', me.x, me.y + 34);
      ctx.textAlign = 'left';
    }
    _gd && (_gd.near = near);
  }

  // ── МИНИКАРТА СИСТЕМЫ. В подсветовом ходу камера стоит вплотную, планета
  // занимает кадр целиком — и сориентироваться внутри системы нечем: не видно
  // ни звезды, ни того, на какой ты орбите. Это схема системы сверху: звезда в
  // центре, кольца орбит, тела на своих местах и ты.
  function drawSysMap(t) {
    const nn = world.nearNode(P.tx, P.ty);
    if (!nn || (nn.d > nn.n.R * 1.8 && !world.solo)) return;
    const n = nn.n;
    // ⚠️ НА ТЕЛЕФОНЕ СХЕМА УЕЗЖАЕТ НАВЕРХ. Внизу слева стоит стик (см.
    // gardenTouchUI): панель ложилась ровно на него, и половина руля была под
    // картинкой — палец попадал в схему, а не в управление.
    const tch = _gdTouch();
    const S = tch ? 116 : 150, x0 = 14, y0 = tch ? 14 : vh - S - 14,
          cx = x0 + S / 2, cy = y0 + S / 2;
    const rMax = Math.max(n.R, 1), k = (S / 2 - 12) / rMax;    // мир → панель

    ctx.fillStyle = 'rgba(6,10,16,.78)'; ctx.fillRect(x0, y0, S, S);
    ctx.strokeStyle = 'rgba(143,211,255,.30)'; ctx.lineWidth = 1;
    ctx.strokeRect(x0 + .5, y0 + .5, S - 1, S - 1);

    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, S, S); ctx.clip();

    ctx.strokeStyle = 'rgba(143,211,255,.16)'; ctx.lineWidth = 1;
    n.bodies.forEach(b => {
      ctx.beginPath(); ctx.arc(cx, cy, b.orb * k, 0, 7); ctx.stroke();
    });
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(2.5, n.starR * k), 0, 7); ctx.fill();
    n.bodies.forEach(b => {
      const a = b.a0 + t * b.sp;
      ctx.fillStyle = b.belt ? 'rgba(160,175,190,.7)' : (GD_BODY[b.grp] || GD_BODY.rock);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * b.orb * k, cy + Math.sin(a) * b.orb * k,
              Math.max(1.8, b.r * k), 0, 7);
      ctx.fill();
    });

    // Свои ячейки. Схема теперь единственный прибор (миникарты галактики
    // больше нет), а плантация на площадке размером с десяток пикселей:
    // без отметки свою же грядку ищешь облётом всей системы.
    ((_gdState && _gdState.plots) || []).forEach(pp => {
      if (pp.sys !== n.id) return;
      const cc = world.cells(n.id, pp.cell + 1)[pp.cell]; if (!cc) return;
      ctx.fillStyle = pp.mine ? (pp.plant && pp.plant.ripe ? GD_WARM : GD_EDGE)
                              : 'rgba(150,170,190,.5)';
      ctx.beginPath();
      ctx.arc(cx + (cc.tx - n.tx) * k, cy + (cc.ty - n.ty) * k, 2.2, 0, 7); ctx.fill();
    });
    // Ты. Метка всегда видна, даже если ушёл за габарит схемы.
    const dx = gClamp((P.tx - n.tx) * k, -S / 2 + 6, S / 2 - 6);
    const dy = gClamp((P.ty - n.ty) * k, -S / 2 + 6, S / 2 - 6);
    ctx.save();
    ctx.translate(cx + dx, cy + dy); ctx.rotate(P.ang);
    ctx.fillStyle = '#dff0ff';
    ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3.4, -3); ctx.lineTo(-3.4, 3); ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();

    ctx.fillStyle = 'rgba(180,205,228,.75)';
    ctx.font = '9.5px ui-monospace,SFMono-Regular,Menlo,monospace';
    // Подпись под коробкой, когда та стоит вверху: над ней места уже нет.
    ctx.fillText((n.name || '').slice(0, 20).toUpperCase(), x0 + 6, tch ? y0 + S + 13 : y0 - 5);
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
    vx0s = cam.x - hw; vx1s = cam.x + hw; vy0s = cam.y - hh; vy1s = cam.y + hh;
    const corners = [gUniso(cam.x - hw, cam.y - hh), gUniso(cam.x + hw, cam.y - hh),
                     gUniso(cam.x - hw, cam.y + hh), gUniso(cam.x + hw, cam.y + hh)];
    const vx0 = Math.min(...corners.map(c => c.tx)), vx1 = Math.max(...corners.map(c => c.tx));
    const vy0 = Math.min(...corners.map(c => c.ty)), vy1 = Math.max(...corners.map(c => c.ty));

    // ⚠️ ОТБОР ВИДИМЫХ — ПО СЕТКЕ, В ПЕРЕИСПОЛЬЗУЕМЫЙ МАССИВ. Было .filter по
    // ВСЕМ системам плюс .slice().sort() — три новых массива на кадр поверх
    // линейного перебора. На тысяче систем это и перебор, и мусор для сборщика:
    // ровно то дёрганье, которое ловится только на большой карте.
    const vis = world.nodesIn(vx0, vy0, vx1, vy1, _vis);

    // ⚠️ В ГИПЕРЕ МИРОВЫХ РАЗМЕРОВ НЕТ ВООБЩЕ. Это обзор, а не полёт у борта:
    // мерить тут вещи мировой линейкой бессмысленно — при зуме 0.0016 система
    // честного размера превращается в пиксель, а если зум поднять, соседей не
    // видно. Поэтому в гипере от мира берутся только КООРДИНАТЫ, а размеры
    // задаются в ЭКРАННЫХ пикселях и от зума не зависят: система — значок,
    // корабль — метка, путь — линия. Ровно так ведёт себя карта.
    // ⚠️ В ОДНОЙ СИСТЕМЕ ОБЗОР — ЭТО ТА ЖЕ СИСТЕМА ИЗДАЛЕКА, А НЕ ЗНАЧКИ.
    // drawHyperView рисует карту галактики: точка-система, линии путей, подпись.
    // Когда система одна и зум подобран под неё (hyperZ), смотреть на значок
    // вместо звезды с орбитами — потеря всего, ради чего сюда и летят.
    if (P.hyper && !world.solo) {
      drawHyperView(vis, vx0, vy0, vx1, vy1, t);
    } else {
      // ⚠️ В САДУ ПЛОЩАДКИ НЕТ. Плита под системой — наследство от карты, где
      // сектор был материком: сплошная заливка радиусом до ГСО. На орбите под
      // ногами ПУСТОТА, и эта плита заливала ровным средним тоном почти весь
      // кадр — из-за неё тонули и серп планеты, и огни теплиц, то есть всё, на
      // чём сцена держится. Сортировку оставляем: по ней идут остальные слои.
      vis.sort((a, b) => (a.tx + a.ty) - (b.tx + b.ty));
      if (!world.solo) vis.forEach(n => {
        const s = platSprite(n), c = gIso(n.tx, n.ty);
        const iw = s.cv.width / s.bs, ih = s.cv.height / s.bs;   // обратно в мировые px
        ctx.drawImage(s.cv, c.x - s.cx / s.bs, c.y - s.cy / s.bs, iw, ih);
      });

      // Слой 1.5: обод кольца. Идёт ПОД грядками — это опора, на которой они
      // стоят; нарисуй его после, и сад окажется под решёткой.
      if (world.solo) vis.forEach(n => {
        if (!n.host) return;
        const c = gIso(n.tx, n.ty), l = _gdLand(n.id);
        drawShadow(n, c.x, c.y - GD_LIFT, GD_TW / 2, t);
        drawRing(n, c.x, c.y - GD_LIFT, GD_TW / 2, t, l ? l.cells : 0);
      });

      // Слой 2: плантации.
      const plots = _gdPlots();
      vis.forEach(n => {
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
        drawSystem(n, t, c.x, c.y - GD_LIFT);
      });

      // Слой 4: камни. Они в пустоте, поверх площадки их не бывает.
      drawAsteroids(t);

      // Слой 5: корабль и брошенная сеть. Чужие — ПОД своим: свой должен
      // оставаться самым читаемым пятном в кадре, даже в толпе.
      drawWake(t);
      drawPeers(t);
      drawNetFly(t);
      const ps = gIso(P.tx, P.ty);
      drawShip(ps.x, ps.y - GD_LIFT, !world.isVoid(P.tx, P.ty));
      drawSay(ps.x, ps.y - GD_LIFT, t);
    }

    // ── Чужие садоводы. ⚠️ ПИНГ ХОДИТ РАЗ В ПОЛТОРЫ СЕКУНДЫ, А КОРАБЛИ ЕДУТ
    // КАЖДЫЙ КАДР. Ставить чужого ровно туда, где он был на последнем ответе,
    // нельзя: получается дёрганая телепортация раз в полторы секунды. Между
    // пингами ведём его к последней известной точке, а курс и тягу берём из
    // того, как он на самом деле поехал, — тогда чужой корабль живёт, а не
    // мигает. Своих координат в чужую руку не даём: рисуем ровно то, что
    // прислал сервер.
    function drawPeers(t) {
      for (let i = 0; i < peers.length; i++) {
        const q = peers[i];
        const s0 = gIso(q.tx, q.ty);
        // Отсечка по кадру: в толпе незачем рисовать корпуса за экраном.
        if (q.tx < vx0s || q.tx > vx1s || q.ty < vy0s || q.ty > vy1s) continue;
        drawShip(s0.x, s0.y - GD_LIFT, !world.isVoid(q.tx, q.ty), q,
                 { hat: q.hat, hull: q.hull }, q.col, false);
        // Имя державы над кораблём: без него это просто чужое железо.
        const fs = 11 / cam.z;
        ctx.font = `${Math.round(fs)}px ui-monospace,SFMono-Regular,Menlo,monospace`;
        const w = ctx.measureText(q.nm).width;
        const bx = s0.x - w / 2 - 5 / cam.z, by = s0.y - GD_LIFT - 44 / cam.z;
        ctx.globalAlpha = .85;
        ctx.fillStyle = 'rgba(5,8,13,.8)';
        ctx.fillRect(bx, by, w + 10 / cam.z, fs + 7 / cam.z);
        ctx.fillStyle = q.col;
        ctx.fillRect(bx, by, 2 / cam.z, fs + 7 / cam.z);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#b9cbdd';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(q.nm, s0.x, by + (fs + 7 / cam.z) / 2);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
    }

    // ── Реплика садовода. Плашка над кораблём, а не тост в углу: говорит
    // ОН, и видно, что говорит именно он. Держится на экранном масштабе —
    // на отъезде буквы иначе схлопываются в точку.
    function drawSay(x, y, t) {
      if (!_gdSay) return;
      const u = (t - _gdSay.t0) / _gdSay.dur;
      if (u >= 1) { _gdSay = null; return; }
      const al = Math.min(1, u * 6) * Math.min(1, (1 - u) * 5);
      const fs = 12 / cam.z, pad = 8 / cam.z;
      ctx.font = `${Math.round(fs)}px system-ui,sans-serif`;
      const w = ctx.measureText(_gdSay.t).width;
      const bx = x - w / 2 - pad, by = y - (52 + u * 8) / cam.z;
      const bw = w + pad * 2, bh = fs + pad * 1.5;
      ctx.globalAlpha = al * .92;
      ctx.fillStyle = 'rgba(5,8,13,.92)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = GD_EDGE;
      ctx.fillRect(bx, by, 2 / cam.z, bh);
      ctx.globalAlpha = al;
      ctx.fillStyle = '#dfe7f2';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(_gdSay.t, x, by + bh / 2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
    }

    // Подсказка «что под манипулятором» — в мире, у самой цели. В гипере она
    // экранная (см. drawHyperView), тут только подсветовой ход.
    const near = gardenNear(world, P);
    if (near && !P.hyper) {
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
    // Компас и миникарта — приборы ГАЛАКТИКИ: они отвечают на вопрос «в какой
    // стороне другие светила». В одной системе на него нет ответа, и оба
    // прибора вырождаются в точку. Ориентирует схема системы.
    if (P.hyper && !world.solo) drawCompass();
    if (!P.hyper || world.solo) drawSysMap(t);
    if (!world.solo) drawMinimap();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  ping();                                  // первый слепок сразу, не через 1.5 с
  pingTimer = setInterval(ping, 1500);

  return {
    P, cam, near: null, actAt: 0, astNear, peers,
    padSet: (x, y) => { pad.x = x; pad.y = y; },
    boostSet: v => { keys['ShiftLeft'] = v ? 1 : 0; },
    keysClear: () => { pad.x = pad.y = 0; for (const k in keys) keys[k] = 0; },
    onResize: (w, h, s) => { vw = w; vh = h; px = s; },
    stop: () => {
      stop = true;
      clearInterval(pingTimer);
      // Уходя — снимаем себя с обода сразу, а не ждём, пока протухнет строка:
      // призрак чужого корабля, который стоит и не двигается, хуже пустоты.
      if (typeof ecRpc === 'function') { try { ecRpc('garden_bye', {}); } catch (e) {} }
      removeEventListener('keydown', kd); removeEventListener('keyup', ku);
      removeEventListener('blur', kblur);
      cv.removeEventListener('pointerdown', onDown);
    },
  };
}

// ── Что у корабля под манипулятором. В гипере — только выход и трал, как было
// у лодки; над площадкой — своя ячейка, а у кромки — прыжок. ──
function gardenNear(world, P) {
  const RCH = world.reach || GD_REACH;
  let best = null, bd = RCH * RCH;

  // ⚠️ «E» БОЛЬШЕ НЕ ЛОВИТ КАМНИ. Сеть бросают МЫШЬЮ — по конкретному камню, и
  // держать для того же самого вторую кнопку было незачем: любой камень рядом
  // перебивал грядку под манипулятором, и «E» у теплицы кидало в щебень.
  // «E» — только работа в саду; камни — только клик.

  if (P.hyper) {
    const nn = world.nearNode(P.tx, P.ty);
    if (nn && nn.d < nn.n.R * 1.5) {
      // Подходим к площадке — предлагаем выйти в точке ближайшей кромки.
      const ang = Math.atan2(P.ty - nn.n.ty, P.tx - nn.n.tx);
      const r = world.platR(nn.n, ang) * .9;
      return { kind: 'land', tx: nn.n.tx + Math.cos(ang) * r, ty: nn.n.ty + Math.sin(ang) * r,
               hint: 'вернуться на площадку' };
    }
    return null;
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

  // Прыжок доступен С ЛЮБОЙ точки площадки, а не только у самой кромки: ждать,
  // пока подползёшь к краю, — на ровном месте выдуманная возня. Точку выхода
  // считаем по направлению от светила, то есть уходим «наружу».
  if (world.solo) return null;               // в саду прыгать некуда — см. ok()
  const nn = world.nearNode(P.tx, P.ty);
  if (nn) {
    const ang = Math.atan2(P.ty - nn.n.ty, P.tx - nn.n.tx) || 0;
    const rr = world.platR(nn.n, ang) + 3;
    return { kind: 'hyper', tx: nn.n.tx + Math.cos(ang) * rr, ty: nn.n.ty + Math.sin(ang) * rr,
             hint: 'уйти в гипер' };
  }
  return null;
}

// ============================================================
// ДЕЙСТВИЕ ПО «E»
// ============================================================
function gardenAct() {
  const n = _gd && _gd.near;
  if (!n) return;
  // Отметка взмаха: по ней лодка отыгрывает движение сачком (см. drawShip).
  _gd.actAt = performance.now() / 1000;
  if (n.kind === 'hyper') { _gd.P.hyper = true; _gd.P.tx = n.tx + .5; _gd.P.ty = n.ty + .5; return; }
  if (n.kind === 'land')  { _gd.P.hyper = false; _gd.P.tx = n.tx; _gd.P.ty = n.ty; return; }
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
// ============================================================
// ЧТО ГОВОРИТ САДОВОД
// ============================================================
// Реплики всплывают над кораблём: место молчаливое, и без голоса оно читается
// пустым складом. Говорит один человек сам с собой — значит коротко, не в
// рифму и без объяснений игроку, что он только что нажал. Банк большой
// намеренно: три повтора подряд убивают приём быстрее, чем плохая строка.
const GD_SAY = {
  sprout: ['Живой. Надо же.', 'Держится за камень. Значит, будет держаться и за меня.',
    'Ну здравствуй.', 'Из такого... и росток.', 'Тёплый. Или мне кажется...',
    'В трюм. Аккуратно...', 'Кто-то же сеял тебя до меня))', 'Прорастёшь - сочтёмся.',
    'Одним больше.', 'Не думал, что тут вообще что-то живёт.'],
  sproutFine: ['Чисто взял.', 'Вот так и надо было всегда.', 'Рука помнит.',
    'Целая горсть.', 'Сегодня стропа слушается.'],
  spore: ['Спора мира.', 'Такое находят раз в жизни. Надеюсь, не в последний...',
    'Да ну нафиг...', 'Руки трясутся. Ладно...',
    'Храм, если ты слушаешь... спасибо.'],
  ore: ['Тоже хлеб.', 'Приемлемо...', 'Сгодится.',
    'Камень как камень. Взвесим.', 'Не росток, но ничего...'],
  dust: ['Пыль.', 'Ох...', 'Всё тот же щебень.', 'Ни зерна.',
    'Ну хоть размялся.'],
  lost: ['Ушёл.', 'Стропа не выдержала.', 'Моя вина, не его.', 'Держал же.',
    'Ладно. Их тут много.', 'Второй раз подряд. Позор.'],
  sow: ['Расти.', 'Тут тебе будет светло.', 'Земли нет, но обойдёмся.',
    'Ну, давай.', 'Двадцать четыре часа. Я подожду.', 'Только не в этот раз, ладно?',
    'Корни в железо. Привыкай.', 'Сажаю, но... всё ещё не верю.'],
  sowIchor: ['Древо ихора. Один раз в жизни, и тот сейчас.',
    'Расти медленно. Тебе можно.', 'Три дня. Я никуда не денусь.'],
  water: ['Свет на полную.', 'Тянись к лампам.', 'Так-то лучше.',
    'Без света ты мне никто.', 'Ещё немного.'],
  feed: ['Пошло добро.', 'Ешь.', 'Дорого. Но ты того стоишь...', 'Не жадничаю.',
    'На той неделе было дешевле...'],
  weed: ['Налёт снят.', 'Вот теперь дышишь.', 'Развелось.',
    'Скребком по стеклу. Всю ночь буду это слышать.', 'Чисто.'],
  harvest: ['Взял.', 'Ровно по труду.', 'Заработал, забрал.',
    'В трюм, и по новой.', 'Не густо, но моё.'],
  harvestFine: ['Как по учебнику.', 'Вот за это и держусь.', 'С кайфом.'],
  till: ['Еще одна милая теплица...', 'Ещё одна ячейка моя.', 'Место есть - будет и посев.',
    'Железо холодное. Ничего, нагреем.'],
  clear: ['Не прижилось.', 'Извини.', 'Сам виноват - недосмотрел.', 'Начнём заново.'],
  // Отход от светила: чем дальше, тем меньше про садоводство.
  far1: ['Далековато я забрёл.', 'Отсюда кольцо, как у неё на руке..',
    'Может я заблудился...', 'Звезда так делеко... Непривычно.',
    'Грядки отсюда и не видно.', 'Ещё немного и обратно?'],
  far2: ['Дальше ничего. Совсем ничего.', 'Никто отсюда не возвращался с урожаем.',
    'А если просто не поворачивать?', 'Сколько у меня топлива? Я не считал.',
    'Вот она, кромка. Хотел же посмотреть.',
    'Свет сюда идёт дольше, чем я живу.', 'Тишина такая, что слышно обшивку.'],
  // Праздная болтовня: изредка, когда просто летишь и ничего не делаешь.
  idle: ['Надо бы налёт снять. Потом. Хотя я точно забуду', 'Голова гудит.', 'Ещё один день. Чудесный...',
    'Кто-то же должен это делать.', 'Тяжело...', 'Могут ли астероиды платить налоги?',
    'Дома бы уже чай остыл.', 'Со скуки можно посчитать обороты',
    'Храм молчит. Как всегда...', 'Ладно, работаем.'],
};
let _gdSay = null;
// Не повторяться: помним последнюю строку каждой темы.
const _gdSaid = {};
// ⚠️ РЕПЛИКА, СКАЗАННАЯ ПОД ОТКРЫТОЙ ПАНЕЛЬЮ, ПРОПАДАЕТ. Панель ячейки — окно
// во весь экран с затемнением, корабль за ним не виден: работа в саду говорит
// в пустоту. Поэтому под панелью реплику откладываем и произносим, когда окно
// закрылось и садовода снова видно.
let _gdSayQ = null;
function gardenSay(key, dur) {
  const bank = GD_SAY[key];
  if (!bank || !bank.length) return;
  if (document.getElementById('gd-panel')) { _gdSayQ = [key, dur]; return; }
  let t = bank[(Math.random() * bank.length) | 0];
  if (bank.length > 1 && t === _gdSaid[key]) t = bank[(Math.random() * bank.length) | 0];
  _gdSaid[key] = t;
  _gdSay = { t, t0: performance.now() / 1000, dur: dur || (2.4 + t.length * .035) };
}

// ============================================================
// ТЕЛЕФОН: СТИК И КНОПКИ
// ============================================================
// ⚠️ НА ТЕЛЕФОНЕ ИГРЫ НЕ БЫЛО ВООБЩЕ. Курс держат W/A/S/D, работа — «E»,
// разгон — Shift: без клавиатуры корабль просто стоит, а тык по холсту (это
// единственное, что работало) бросает сеть. padSet в движке был с самого
// начала, но его никто не звал. Слой рисуем ПОВЕРХ холста и только на
// пальцевых экранах: на мыши он мешает и не нужен.
//
// Стик даёт ЭКРАННЫЙ вектор (padSet складывает изометрию сам), поэтому палец
// вверх = корабль вверх по экрану, а не «на северо-запад мира».
function _gdTouch() {
  return matchMedia('(pointer:coarse)').matches || innerWidth < 900;
}

function gardenTouchUI(fs) {
  if (!_gdTouch() || document.getElementById('gd-pad')) return;
  const box = document.createElement('div');
  box.id = 'gd-pad'; box.className = 'gd-pad';
  box.innerHTML = `
    <div class="gd-stick" id="gd-stick"><i></i></div>
    <div class="gd-btns">
      <button class="gd-tb gd-tb-b" id="gd-tb-boost" type="button">РАЗГОН</button>
      <button class="gd-tb gd-tb-e" id="gd-tb-act" type="button">E</button>
    </div>`;
  fs.appendChild(box);

  const st = document.getElementById('gd-stick');
  const nub = st.firstElementChild;
  const R = 46;
  let sid = null, cx = 0, cy = 0;
  const set = e => {
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const m = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, m / R);
    dx = dx / m * k; dy = dy / m * k;
    nub.style.transform = `translate(${(dx * R).toFixed(1)}px,${(dy * R).toFixed(1)}px)`;
    // Мёртвая зона: без неё корабль ползёт от дрожания пальца.
    if (k < .18) { _gd && _gd.padSet(0, 0); return; }
    _gd && _gd.padSet(dx, dy);
  };
  const rel = () => { sid = null; nub.style.transform = ''; _gd && _gd.padSet(0, 0); };
  st.addEventListener('pointerdown', e => {
    if (_gdHook) return;                       // во время стяжки экран занят
    sid = e.pointerId;
    try { st.setPointerCapture(sid); } catch (_) {}
    const r = st.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    set(e); e.preventDefault(); e.stopPropagation();
  });
  st.addEventListener('pointermove', e => { if (e.pointerId === sid) { set(e); e.preventDefault(); } });
  st.addEventListener('pointerup', rel);
  st.addEventListener('pointercancel', rel);
  st.addEventListener('lostpointercapture', rel);

  const act = document.getElementById('gd-tb-act');
  act.addEventListener('pointerdown', e => {
    // Во время стяжки кнопка «E» — тот же хват: его ловит общий перехватчик
    // (см. gardenGripStart), поэтому тут только не мешаем.
    if (_gdHook) return;
    e.preventDefault(); e.stopPropagation(); gardenAct();
  });

  // Разгон — УДЕРЖАНИЕМ, как Shift: переключателем его забывают выключить, и
  // корабль всю игру летит перегоном.
  const bo = document.getElementById('gd-tb-boost');
  const bset = v => { bo.classList.toggle('on', !!v); _gd && _gd.boostSet && _gd.boostSet(v); };
  bo.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); bset(1); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(k => bo.addEventListener(k, () => bset(0)));
}

// ============================================================
// КРОМКА МИРА = ВЫБОР, А НЕ СТЕНА
// ============================================================
// ⚠️ КРАЙ КАРТЫ НЕ БЫЛ ПРОПИСАН ВООБЩЕ. Корабль упирался в clamp по bounds:
// невидимая стена, о которой игра молчит, — то есть худший из возможных
// ответов на «а что там дальше». Ответ теперь есть, и он не про геометрию:
// садовод сам решает, поворачивать ему или нет. «Не поворачивать» — конец
// вылазки: экран гаснет, и он возвращается к грядкам другим человеком.
let _gdEdge = false;

function gardenEdgeAsk() {
  if (_gdEdge || !_gd || _gdHook) return;
  _gdEdge = true;
  gardenPadOff(true);
  if (_gd.keysClear) _gd.keysClear();
  const el = document.createElement('div');
  el.id = 'gd-edge'; el.className = 'gd-edge';
  el.innerHTML = `<div class="gd-edge-w">
      <div class="gd-edge-t">Вы всматриваетесь в пустоту...</div>
      <p>Но как и прежде, не находите смысла двигаться дальше.</p>
      <p class="gd-edge-q">Держать курс?</p>
      <div class="gd-edge-b">
        <button class="gd-b gd-prim" type="button"
          onclick="event.stopPropagation();gardenEdgeBack()">Вернуться к свету</button>
        <button class="gd-b gd-ghost" type="button"
          onclick="event.stopPropagation();gardenEdgeGo()">Уйти во тьму</button>
      </div></div>`;
  (document.getElementById('gd-fs') || document.body).appendChild(el);
}

// Повернул — отводим корабль внутрь кольца, иначе он остаётся у самой кромки
// и вопрос задаётся снова в тот же кадр.
function gardenEdgeBack() {
  const el = document.getElementById('gd-edge'); if (el) el.remove();
  _gdEdge = false;
  gardenPadOff(false);
  if (!_gd || !_gdWorld) return;
  const n0 = _gdWorld.nodes[0]; if (!n0) return;
  const P = _gd.P;
  const a = Math.atan2(P.ty - n0.ty, P.tx - n0.tx) || 0;
  const r = n0.R * 2.05;
  P.tx = n0.tx + Math.cos(a) * r; P.ty = n0.ty + Math.sin(a) * r;
  P.farLvl = 2;
  gardenSay('far1');
}

const GD_EDGE_GO = ['Ну и лечу.', 'Никто не считает мои обороты.',
  'Оттуда видно всё и сразу, говорят.', 'А грядки подождут. Они умеют.',
  'Сколько-то я ещё продержусь.'];

async function gardenEdgeGo() {
  const el = document.getElementById('gd-edge'); if (!el) return;
  _gdEdge = false;
  const line = GD_EDGE_GO[(Math.random() * GD_EDGE_GO.length) | 0];
  el.classList.add('gone');
  el.innerHTML = `<div class="gd-edge-w"><p class="gd-edge-end">${esc(line)}</p></div>`;
  if (_gd) { const P = _gd.P; P.thr = 1; }
  await new Promise(r => setTimeout(r, 3400));
  if (!document.getElementById('gd-fs')) return;
  gardenToast('Неправильный выбор. Тебе придется вернуться.', '');
  gardenPaintOverview();
}

let _gdPanel = null;
// Редкость ростка словом: числа с сервера (0..4) в панели ничего не значат.
const GD_RAR = ['обычный', 'редкий', 'ценный', 'эпический', 'легендарный'];

// Руль на телефоне живёт под окнами: пока сверху что-то открыто, его прячем.
function gardenPadOff(v) {
  const e = document.getElementById('gd-pad');
  if (!e) return;
  e.classList.toggle('off', !!v);
  if (v && _gd) { _gd.padSet(0, 0); _gd.boostSet && _gd.boostSet(0); }
}

function gardenPanelClose() {
  _gdPanel = null;
  gardenPadOff(false);
  const el = document.getElementById('gd-panel');
  if (el) el.remove();
  if (_gdSayQ) { const q = _gdSayQ; _gdSayQ = null; gardenSay(q[0], q[1]); }
}

function gardenPanel(n) {
  _gdPanel = { sys: n.sys, cell: n.cell };
  gardenPadOff(true);
  gardenPanelRefresh(true);
}

function gardenPanelRefresh(create) {
  if (!_gdPanel) return;
  let el = document.getElementById('gd-panel');
  if (!el) {
    if (!create) return;
    el = document.createElement('div');
    el.id = 'gd-panel'; el.className = 'gd-panel';
    // Клик мимо окна закрывает: панель теперь во весь экран, и «мимо» есть.
    el.onpointerdown = e => { if (e.target === el) { e.stopPropagation(); gardenPanelClose(); } };
    (document.getElementById('gd-fs') || document.body).appendChild(el);
  }
  const land = _gdLand(_gdPanel.sys);
  const plot = _gdPlots()[_gdPlotKey(_gdPanel.sys, _gdPanel.cell)];
  const c = (_gdState && _gdState.const) || {};
  const nm = (land && land.name) || (_gdState && _gdState.temple === _gdPanel.sys ? 'Храм мироздания' : 'участок');

  let head, body;
  if (!plot) {
    head = gdHead(nm, 'Шельф пустой', 'ячейка не развёрнута');
    body = `<div class="gd-p-b">
      <div class="gd-p-lead">Это заброшенное орбитальное кольцо почти полностью уничтожено и уже никогда не будет служить Храму Мироздания... По крайней мере, здесь осталось много модулей гидропоники, все они могут послужить теплицей.</div>
      <div class="gd-p-line"><span>цена работ</span><b>${Math.round(c.till_gc || 0)} ГС</b></div>
      <div class="gd-foot"><button class="gd-b gd-prim" onclick="event.stopPropagation();gardenTill()">Починить модуль</button></div>
    </div>`;
  } else if (!plot.plant) {
    // ⚠️ ВЫБОР ПОСЕВА — ЭТО ТРЮМ, А НЕ СПИСОК ЗАЛЕЖЕЙ. Раньше сюда падал сырой
    // JSON пород системы простынёй, да ещё в форточке в углу экрана. Теперь это
    // ПОЛНОЦЕННЫЙ экран выбора: плитка ростков со спрайтами пород (resIconHtml —
    // те же картинки, что в экономике и на карте), редкость и остаток.
    const temple = land && land.land === 'temple';
    const spr = (_gdState && _gdState.sprouts) || [];
    const ich = (_gdState && _gdState.seed_ichor) || 0;
    const tot = spr.reduce((a, x) => a + (x.qty | 0), 0);
    head = gdHead(nm, 'Теплица готова', 'что сажаем');
    body = `<div class="gd-p-b">
      ${temple && ich > 0 ? `<button class="gd-card gd-ichor"
          onclick="event.stopPropagation();gardenSow('ichor')">
          <span class="gd-card-ic">◈</span>
          <span class="gd-card-t">Древо ихора<em>отдаст до ${Math.round(c.ichor_cap || 10)} ихора... Ровно столько, сколько в него вложили заботы...</em></span>
          <span class="gd-card-q">×${ich}</span></button>` : ''}
      <div class="gd-p-sec">ростки в трюме<span>${tot}</span></div>
      ${spr.length ? `<div class="gd-grid">${spr.map(s => {
        const rn = _gdResName(s.res);
        const ic = (typeof resIconHtml === 'function')
          ? resIconHtml(rn, 'gd-ric') : `<span class="gd-ric">◇</span>`;
        return `<button class="gd-card r${s.rar | 0}"
          onclick="event.stopPropagation();gardenSow('res',${JSON.stringify(rn).replace(/"/g, '&quot;')})">
          <span class="gd-card-ic">${ic}</span>
          <span class="gd-card-t">${esc(rn)}<em>${GD_RAR[s.rar | 0] || 'обычный'}</em></span>
          <span class="gd-card-q">×${s.qty | 0}</span></button>`;
      }).join('')}</div>`
        : `<div class="gd-empty">Трюм пуст.<span>Но ничего! В местных астероидах много соединений, чтобы синтезировать что-то интересное...</span></div>`}
    </div>`;
  } else {
    const p = plot.plant;
    const ich = p.kind === 'ichor';
    const bar = (v, col, warn) => `<div class="gd-bar${warn ? ' warn' : ''}"><i style="width:${gClamp(v, 0, 100)}%;background:${col}"></i></div>`;
    const care = Math.round((p.care == null ? 1 : p.care) * 100);
    const pres = _gdResName(p.res);
    const ic = ich ? '<span class="gd-ric gd-ric-ichor">◈</span>'
      : ((typeof resIconHtml === 'function') ? resIconHtml(pres, 'gd-ric') : '<span class="gd-ric">◇</span>');
    head = gdHead(nm, ich ? 'Древо ихора' : (pres || 'посев'),
                  p.ripe ? 'созрело' : 'зреет ' + gardenLeft(p.left), ic);
    body = `<div class="gd-p-b">
      <div class="gd-gauge"><span>свет</span>${bar(p.water, '#8fd3ff', p.water < 20)}<b>${p.water}</b></div>
      <div class="gd-gauge"><span>раствор</span>${bar(p.feed, '#c9a24a', p.feed < 10)}<b>${p.feed}</b></div>
      <div class="gd-gauge"><span>налёт</span>${bar(p.weeds, '#8f9a56', p.weeds > 60)}<b>${p.weeds}</b></div>
      <div class="gd-care">режим выдержан на <b>${care}%</b> - столько и получишь</div>
      <div class="gd-row">
        <button class="gd-b" onclick="event.stopPropagation();gardenCare('water')">Озарить</button>
        <button class="gd-b" onclick="event.stopPropagation();gardenCare('feed')">Долить раствор<em>${Math.round(c.feed_gc || 0)} ГС</em></button>
        <button class="gd-b" onclick="event.stopPropagation();gardenCare('weed')">Снять налёт</button>
      </div>
      <div class="gd-foot">
        ${p.ripe ? `<button class="gd-b gd-prim" onclick="event.stopPropagation();gardenHarvest()">Славный урожауй...</button>` : ''}
        <button class="gd-b gd-ghost" onclick="event.stopPropagation();gardenClear()">Убрать посев</button>
      </div>
    </div>`;
  }
  el.innerHTML = `<div class="gd-p-win">${head}${body}</div>`;
}

// ⚠️ В СТАРЫХ ПОСЕВАХ В res ЛЕЖИТ СЫРОЙ JSON. Так писал _g_seeds до наката
// _garden_sprouts.sql: в грядку уезжал весь элемент залежи целиком, и в шапке
// окна вместо «Железо» висело {"r":"common","amt":"много",...}. Новые строки
// чистые, но старые посевы доживают в ячейках сутками — разворачиваем при
// показе, а не чиним данные: через сутки их и так не останется.
function _gdResName(v) {
  if (v == null) return '';
  if (typeof v === 'object') return String(v.name || v.res || '');
  const t = String(v).trim();
  if (t[0] === '{' || t[0] === '[') {
    try {
      const j = JSON.parse(t);
      return _gdResName(Array.isArray(j) ? j[0] : j);
    } catch (e) {}
  }
  return t;
}

// Шапка окна: адрес мелким моношрифтом, крупная строка состояния и статус.
function gdHead(nm, title, sub, ic) {
  return `<div class="gd-p-h">
    <div class="gd-p-adr">${esc(nm)}<i>·</i>ячейка ${String(_gdPanel.cell + 1).padStart(2, '0')}
      <button type="button" onclick="event.stopPropagation();gardenPanelClose()">✕</button></div>
    <div class="gd-p-ttl">${ic || ''}<b>${esc(title)}</b><span>${sub || ''}</span></div>
  </div>`;
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
  const r = await gardenDo('garden_till', { p_sys: _gdPanel.sys, p_cell: _gdPanel.cell }, 'Стапель развёрнут.');
  if (r) gardenSay('till');
}
async function gardenSow(kind, res) {
  if (!_gdPanel) return;
  const plot = _gdPlots()[_gdPlotKey(_gdPanel.sys, _gdPanel.cell)];
  if (!plot) return;
  const r = await gardenDo('garden_plant', { p_plot: plot.id, p_kind: kind, p_res: res || null }, 'Засеяно.');
  // Посев — действие разовое: окно закрываем, иначе садовода за ним не видно.
  if (r) { gardenSay(kind === 'ichor' ? 'sowIchor' : 'sow'); gardenPanelClose(); }
}
async function gardenCare(act) {
  const p = _gdCurPlant(); if (!p) return;
  const r = await gardenDo('garden_care', { p_plant: p.id, p_act: act });
  if (r) gardenSay(act === 'water' ? 'water' : act === 'feed' ? 'feed' : 'weed');
}
async function gardenHarvest() {
  const p = _gdCurPlant(); if (!p) return;
  const r = await gardenDo('garden_harvest', { p_plant: p.id });
  if (r) {
    gardenToast(`${r.name}: ${r.amount} (режим ${Math.round((r.care || 0) * 100)}%)`, 'ok');
    gardenSay((r.care || 0) >= .8 ? 'harvestFine' : 'harvest');
    gardenPanelClose();
  }
}
async function gardenClear() {
  const p = _gdCurPlant(); if (!p) return;
  const r = await gardenDo('garden_clear', { p_plant: p.id }, 'Посев свёрнут.');
  if (r) { gardenSay('clear'); gardenPanelClose(); }
}
// ⚠️ СПОРУ МИРА НЕ ПОКУПАЮТ. Кнопка «купить за 200 000 ГС» осталась от старика
// у реки и обесценивала весь сад: древо ихора — единственная вещь, которую
// нельзя взять деньгами, её ТОЛЬКО находят в камне (шанс ~1.2 %, не чаще раза
// в сутки). RPC garden_seed_buy снят и на сервере.

// ============================================================
// СТЯЖКА СЕТИ: мини-игра, а не бросок кубика
// ============================================================
// ⚠️ РАНЬШЕ ЛОВЛИ КАК ТАКОВОЙ НЕ БЫЛО. Сервер бросал кубик, клиент показывал
// «есть касание» и ждал ОДНОГО клика в окно react — то есть от игрока
// требовалось не умение, а реакция на всплывашку. Теперь камень надо СТЯНУТЬ:
// по стропе бегает захват, на ней три хвата в случайных местах, и каждый надо
// поймать. Промахи копятся — на третьем камень уходит. Чисто взял — снял с
// камня больше ростков (p_score уезжает на сервер и решает выдачу).
//
// Сервер: garden_cast() кладёт добычу в pending и отдаёт «жёсткость» (hard);
// garden_haul(id, ok, score) выдаёт награду. Содержимое камня до конца стяжки
// не показываем — иначе по «жирности» решают, тянуть или бросить.
let _gdHook = null;

async function gardenRockOpen(rock) {
  if (_gdHook) return;
  let b;
  try {
    b = await ecRpc('garden_cast', { p_sys: (_gdState && _gdState.temple) || null });
  } catch (e) {
    gardenToast((e && e.message) || 'сеть сорвалась', 'err');
    return;
  }
  if (!b || !b.id) { gardenToast('Камень рассыпался в пыль.'); return; }
  gardenGripStart(b.id, Number(b.hard) || 1, rock);
}

// Состояние стяжки живёт в _gdHook: id добычи, камень, хваты, промахи.
function gardenGripStart(id, hard, rock) {
  const need = 3;
  const el = document.createElement('div');
  el.id = 'gd-grip'; el.className = 'gd-grip';
  el.innerHTML = `
    <div class="gd-grip-h">СТЯЖКА СЕТИ<span>ПРОБЕЛ ИЛИ ЛКМ</span></div>
    <div class="gd-grip-track" id="gd-grip-track">
      <i class="gd-grip-zone" id="gd-grip-zone"></i>
      <b class="gd-grip-cur" id="gd-grip-cur"></b>
    </div>
    <div class="gd-grip-f"><span id="gd-grip-pips"></span><span id="gd-grip-msg">камень идёт</span></div>`;
  (document.getElementById('gd-fs') || document.body).appendChild(el);

  _gdHook = {
    id, rock, hard, need, hit: 0, miss: 0, maxMiss: 2, acc: [],
    // Захват ходит туда-обратно: скорость и ширина хвата — от жёсткости камня.
    x: 0, dir: 1, spd: .62 + hard * .38,
    zw: gClamp(.19 - (hard - 1) * .055, .07, .24),
    zx: .25 + Math.random() * .5,
    t0: performance.now(), raf: 0, done: false,
  };
  gardenGripPips();
  gardenPadOff(true);
  const step = () => {
    const h = _gdHook; if (!h || h.done) return;
    const now = performance.now();
    const dt = Math.min(.05, (now - (h.tPrev || now)) / 1000); h.tPrev = now;
    h.x += h.dir * h.spd * dt;
    if (h.x > 1) { h.x = 1; h.dir = -1; }
    if (h.x < 0) { h.x = 0; h.dir = 1; }
    const cur = document.getElementById('gd-grip-cur');
    const zon = document.getElementById('gd-grip-zone');
    if (cur) cur.style.left = (h.x * 100).toFixed(2) + '%';
    if (zon) { zon.style.left = (h.zx * 100).toFixed(2) + '%'; zon.style.width = (h.zw * 100).toFixed(2) + '%'; }
    h.raf = requestAnimationFrame(step);
  };
  _gdHook.raf = requestAnimationFrame(step);

  _gdHook.key = e => {
    if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'KeyE') return;
    e.preventDefault(); e.stopPropagation();
    gardenGripHit();
  };
  addEventListener('keydown', _gdHook.key, true);
  // ⚠️ ХВАТ ЛОВИТСЯ КЛИКОМ ГДЕ УГОДНО. Пока слушатель висел на самой коробочке,
  // играть приходилось, целясь мышью в узкую полоску внизу экрана — на скорости
  // это отдельная возня, не имеющая отношения к стяжке. Слушаем ВЕСЬ экран и
  // гасим клик на перехвате, чтобы он не ушёл в холст и не бросил вторую сеть.
  _gdHook.tap = e => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    gardenGripHit();
  };
  addEventListener('pointerdown', _gdHook.tap, true);
}

function gardenGripPips() {
  const h = _gdHook; if (!h) return;
  const el = document.getElementById('gd-grip-pips');
  if (!el) return;
  let s = '';
  for (let i = 0; i < h.need; i++) s += `<i class="${i < h.hit ? 'on' : ''}"></i>`;
  for (let i = 0; i < h.maxMiss; i++) s += `<i class="m ${i < h.miss ? 'on' : ''}"></i>`;
  el.innerHTML = s;
}

function gardenGripMsg(t, cls) {
  const el = document.getElementById('gd-grip-msg');
  if (el) { el.textContent = t; el.className = cls || ''; }
}

function gardenGripHit() {
  const h = _gdHook; if (!h || h.done) return;
  const c = h.zx + h.zw / 2;
  const d = Math.abs(h.x - c);
  if (d <= h.zw / 2) {
    // Точность хвата: в центре — 1, по кромке — 0. Из них и складывается score.
    h.acc.push(1 - d / (h.zw / 2));
    h.hit++;
    // Каждый следующий хват уже и быстрее: тянуть камень к концу труднее.
    h.zw = Math.max(.05, h.zw * .78);
    h.spd *= 1.16;
    h.zx = .06 + Math.random() * (.88 - h.zw);
    gardenGripMsg(h.hit >= h.need ? 'взяли' : 'держим', 'ok');
  } else {
    h.miss++;
    h.acc.push(0);
    h.zx = .06 + Math.random() * (.88 - h.zw);
    gardenGripMsg(h.miss >= h.maxMiss ? 'сорвалось' : 'мимо', 'bad');
  }
  gardenGripPips();
  if (h.hit >= h.need) gardenGripEnd(true);
  else if (h.miss >= h.maxMiss) gardenGripEnd(false);
}

async function gardenGripEnd(ok) {
  const h = _gdHook; if (!h || h.done) return;
  h.done = true;
  cancelAnimationFrame(h.raf);
  // ⚠️ ПЕРЕХВАТЧИК ТАПА СНИМАЕТСЯ ТОЖЕ. Снимали только клавиатуру, а h.tap
  // висел на window в ФАЗЕ ПЕРЕХВАТА и глушил preventDefault/stopPropagation
  // КАЖДЫЙ pointerdown на странице — до конца сеанса. После первой же ловли
  // (и реплики о ней) управление умирало насмерть: до стика и до холста тычок
  // просто не доходил. На мыши это читалось «клик перестал работать», на
  // телефоне — «управление заглохло».
  removeEventListener('keydown', h.key, true);
  removeEventListener('pointerdown', h.tap, true);
  _gdHook = null;
  const el = document.getElementById('gd-grip'); if (el) el.remove();
  gardenPadOff(false);
  // Пойманный камень уходит из поля и возвращается новым (см. astStep): иначе
  // один и тот же обломок черпается бесконечно, стоя на месте.
  if (ok && h.rock) h.rock.gone = 12;
  const score = h.acc.length ? h.acc.reduce((a, b) => a + b, 0) / h.acc.length : 0;
  try {
    const r = await ecRpc('garden_haul', { p_id: h.id, p_ok: !!ok, p_score: Math.round(score * 100) / 100 });
    // Реплика — по ИТОГУ, а не по факту броска: сорвал, взял пустышку и вынул
    // спору — три разных события, и говорить о них одним и тем же нельзя.
    if (!r || r.lost) { gardenToast('Камень ушёл в пустоту.', ''); gardenSay('lost'); }
    else if (r.kind === 'sprout') {
      gardenToast(`Ростки: ${_gdResName(r.res)} ×${r.qty}`, 'ok');
      gardenSay(score >= .75 && h.miss === 0 ? 'sproutFine' : 'sprout');
    }
    else if (r.kind === 'spore') { gardenToast('Спора мира в трюме.', 'ok'); gardenSay('spore', 4.2); }
    else if (r.gc > 0) { gardenToast(`${r.name}: +${Math.round(r.gc)} ГС`, 'ok'); gardenSay('ore'); }
    else { gardenToast(r.name || 'Пустая порода.', ''); gardenSay('dust'); }
  } catch (e) { gardenToast((e && e.message) || 'сорвалось', 'err'); }
  await gardenReload();
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
    (_gdState.seed_ichor > 0 ? `<span>спора мира: <b>${_gdState.seed_ichor}</b></span>` : '') +
    (() => {
      const n = ((_gdState.sprouts) || []).reduce((s, x) => s + (x.qty | 0), 0);
      return n ? `<span>ростки: <b>${n}</b></span>` : '';
    })() +
    // Соседи на ободе. Строка появляется, только когда кто-то есть: пустое
    // «в саду: 0» каждую минуту напоминало бы, что ты один.
    ((_gd && _gd.peers && _gd.peers.length)
      ? `<span class="gd-ok">на ободе: <b>${_gd.peers.length + 1}</b></span>` : '');
}

function gardenStopGame() {
  _gdEdge = false; _gdSayQ = null; _gdSay = null;
  if (_gd) { try { _gd.stop(); } catch (e) {} _gd = null; }
  if (_gdFit) { removeEventListener('resize', _gdFit); _gdFit = null; }
  gardenPanelClose();
  const fs = document.getElementById('gd-fs');
  if (fs) fs.remove();
  if (_gdHook) gardenGripEnd(false);           // стяжку не бросаем висеть
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
/* ⚠️ ПАНЕЛЬ БОЛЬШЕ НЕ ФОРТОЧКА В УГЛУ. Работа с ячейкой — главное, что тут
   делают руками, а она жила в 288px-коробочке справа сверху: мелкий текст,
   мелкие кнопки, ростки в три строки. Теперь это окно по центру с затемнением
   позади — экран, а не подсказка. */
.gd-panel{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(3,5,9,.66);backdrop-filter:blur(2px);color:#cfe0f2;font:14px system-ui,sans-serif}
.gd-p-win{width:min(680px,100%);max-height:100%;display:flex;flex-direction:column;background:#070b11;border:1px solid #16202c;border-top:2px solid #8fd3ff;box-shadow:0 24px 70px rgba(0,0,0,.6);clip-path:polygon(0 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%)}
.gd-p-h{padding:14px 20px 16px;border-bottom:1px solid #121b25;flex:none}
.gd-p-adr{display:flex;align-items:center;gap:0;color:#5d7085;font:10.5px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase}
.gd-p-adr i{font-style:normal;color:#2b3b4d;padding:0 8px}
.gd-p-adr button{margin-left:auto;background:none;border:0;color:#4d6076;font-size:16px;line-height:1;padding:0 2px}
.gd-p-adr button:hover{color:#cfe0f2}
.gd-p-ttl{display:flex;align-items:center;gap:12px;margin-top:10px}
.gd-p-ttl b{font:22px/1.1 system-ui,sans-serif;font-weight:500;color:#eaf2fb;letter-spacing:.01em}
.gd-p-ttl span{margin-left:auto;font:11px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#7d8fa3}
.gd-p-b{padding:16px 20px 20px;overflow:auto}
.gd-p-lead{color:#8fa4b8;line-height:1.5;font-size:13.5px}
.gd-p-line{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid #121b25;font:12px ui-monospace,monospace;color:#5d7085;letter-spacing:.06em;text-transform:uppercase}
.gd-p-line b{color:#eaf2fb;font:15px ui-monospace,monospace;font-weight:400;text-transform:none}
.gd-p-sec{display:flex;align-items:baseline;gap:10px;margin:2px 0 10px;font:10.5px ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:#5d7085}
.gd-p-sec span{margin-left:auto;color:#8fa4b8}
.gd-p-note{color:#5d7085;font-size:12px;margin-top:14px;line-height:1.5}
.gd-empty{padding:26px 0 8px;text-align:center;color:#8fa4b8;font-size:15px}
.gd-empty span{display:block;max-width:380px;margin:8px auto 0;color:#5d7085;font-size:12.5px;line-height:1.55}
/* Плитка ростков: спрайт породы, имя, редкость, остаток. */
.gd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:8px}
.gd-card{display:flex;align-items:center;gap:11px;padding:10px 12px;background:rgba(143,211,255,.03);border:1px solid #16202c;color:#eaf2fb;font:14px system-ui,sans-serif;text-align:left;cursor:pointer}
.gd-card:hover{border-color:#8fd3ff;background:rgba(143,211,255,.09)}
.gd-card-ic{flex:none;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:19px;color:#8fa4b8}
.gd-ric{width:32px;height:32px;object-fit:contain;display:block;filter:saturate(.9)}
.gd-ric-ichor{font-size:20px;color:#c7a6ff}
.gd-card-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gd-card-t em{display:block;font-style:normal;font:10px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#5d7085;margin-top:3px}
.gd-card-q{flex:none;font:13px ui-monospace,monospace;color:#8fa4b8}
.gd-card.r1 em{color:#7fc4d8}.gd-card.r2 em{color:#8fd3ff}
.gd-card.r3 em{color:#a892d6}.gd-card.r4 em{color:#ffc46b}
.gd-card.r3{border-color:#33294a}.gd-card.r4{border-color:#54401f}
.gd-ichor{width:100%;margin-bottom:14px;border-color:#3b3157;background:rgba(180,150,255,.06)}
.gd-ichor:hover{border-color:#c7a6ff;background:rgba(180,150,255,.12)}
/* Шкалы ухода. */
.gd-gauge{display:flex;align-items:center;gap:12px;margin:9px 0;font:11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#5d7085}
.gd-gauge span{width:76px;flex:none}
.gd-gauge b{width:34px;flex:none;text-align:right;color:#eaf2fb;font-size:13px;font-weight:400}
.gd-gauge .gd-bar{flex:1;height:6px;background:#0e1620;border:0;padding:0;overflow:hidden}
.gd-gauge .gd-bar.warn{box-shadow:inset 0 0 0 1px rgba(224,163,74,.55)}
.gd-gauge .gd-bar i{display:block;height:100%}
/* ⚠️ КНОПКИ ОКНА БЫЛИ БЕЛЫМИ СИСТЕМНЫМИ. У .gd-b не было ни одного правила —
   как и у .gd-grip: браузер рисовал их своим серым прямоугольником поверх
   тёмного окна, и половина экрана светилась. Базовый вид задаём здесь. */
.gd-b{display:block;width:100%;padding:12px 14px;background:rgba(143,211,255,.04);
  border:1px solid #1d2a38;color:#dfe7f2;font:14px system-ui,sans-serif;text-align:left;
  cursor:pointer;transition:border-color .12s,background .12s}
.gd-b:hover{border-color:#8fd3ff;background:rgba(143,211,255,.1)}
.gd-b:active{background:rgba(143,211,255,.16)}
.gd-b em{font-style:normal;font:10px ui-monospace,monospace;letter-spacing:.12em;color:#5d7085}
.gd-b.gd-prim{border-color:#8fd3ff;background:rgba(143,211,255,.12);color:#eaf2fb}
.gd-b.gd-prim:hover{background:rgba(143,211,255,.2)}
.gd-b.gd-ghost{background:none;border-color:#1a242f;color:#7d8fa3}
.gd-b.gd-ghost:hover{border-color:#c9603f;color:#e8bfb0;background:rgba(201,96,63,.08)}
.gd-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px}
.gd-row .gd-b{margin:0;text-align:center;padding:11px 8px}
.gd-row .gd-b em{display:block;font-style:normal;font:10px ui-monospace,monospace;color:#5d7085;margin-top:4px;letter-spacing:.1em}
.gd-foot{display:flex;gap:8px;margin-top:16px;padding-top:14px;border-top:1px solid #121b25}
.gd-foot .gd-b{margin:0;flex:1;text-align:center}
.gd-care{margin:16px 0 0;padding-top:12px;border-top:1px solid #121b25;color:#7d8fa3;font-size:12.5px}
.gd-care b{color:#ffc46b}
/* ── Телефон: стик слева, кнопки справа. Слой поверх холста, но клики ловят
   только сами органы управления — остальное уходит в мир (тап по камню). ── */
.gd-pad{position:absolute;inset:auto 0 0 0;height:180px;z-index:15;pointer-events:none;
  display:flex;align-items:flex-end;justify-content:space-between;padding:0 18px 18px;
  touch-action:none;user-select:none;-webkit-user-select:none}
.gd-stick{pointer-events:auto;width:124px;height:124px;border-radius:50%;
  border:1px solid rgba(143,211,255,.22);background:rgba(6,10,16,.42);
  display:flex;align-items:center;justify-content:center;touch-action:none}
.gd-stick i{width:52px;height:52px;border-radius:50%;background:rgba(143,211,255,.16);
  border:1px solid rgba(143,211,255,.45);transition:transform .06s linear}
.gd-btns{pointer-events:auto;display:flex;flex-direction:column;align-items:flex-end;gap:12px}
.gd-tb{border:1px solid rgba(143,211,255,.4);background:rgba(6,10,16,.55);color:#cfe0f2;
  font:12px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;touch-action:none}
.gd-tb-e{width:88px;height:88px;border-radius:50%;font-size:22px;letter-spacing:0}
.gd-tb-b{padding:11px 16px;border-radius:0}
.gd-tb.on{background:rgba(143,211,255,.22);border-color:#8fd3ff}
/* Пока сверху окно (ячейка, стяжка, кромка) — руль убран: палец на телефоне
   попадает в стик вместо кнопки, и корабль уезжает из-под панели. */
.gd-pad.off{display:none}
.gd-tb:active{background:rgba(143,211,255,.28)}
/* ── Стяжка сети. ⚠️ РАЗМЕТКА БЫЛА, А СТИЛЕЙ НЕ БЫЛО ВООБЩЕ: мини-игра
   выпадала голым текстом в углу («СТЯЖКА СЕТИПРОБЕЛ ИЛИ ЛКМ»), полоса с
   захватом не рисовалась — играть было не во что, хотя логика работала. ── */
.gd-grip{position:absolute;left:50%;bottom:16%;transform:translateX(-50%);z-index:25;
  width:min(440px,86vw);padding:12px 14px 11px;background:rgba(7,11,17,.94);
  border:1px solid #16202c;border-top:2px solid #8fd3ff;box-shadow:0 18px 50px rgba(0,0,0,.55);
  color:#cfe0f2;font:13px system-ui,sans-serif;animation:gdEdgeIn .18s ease both}
.gd-grip-h{display:flex;align-items:baseline;justify-content:space-between;gap:12px;
  font:10.5px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.2em;
  text-transform:uppercase;color:#8fd3ff}
.gd-grip-h span{letter-spacing:.12em;color:#5d7085}
.gd-grip-track{position:relative;height:30px;margin:10px 0 9px;background:#0c131b;
  border:1px solid #17222e;overflow:hidden}
.gd-grip-zone{position:absolute;top:0;bottom:0;background:rgba(143,211,255,.18);
  box-shadow:inset 1px 0 0 rgba(143,211,255,.8),inset -1px 0 0 rgba(143,211,255,.8)}
.gd-grip-cur{position:absolute;top:-1px;bottom:-1px;width:3px;margin-left:-1.5px;
  background:#ffe6b0;box-shadow:0 0 10px rgba(255,230,176,.8)}
.gd-grip-f{display:flex;align-items:center;justify-content:space-between;gap:10px;
  font:10.5px ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:#5d7085}
.gd-grip-f i{display:inline-block;width:9px;height:9px;margin-right:5px;border-radius:50%;
  border:1px solid #2b3b4d}
.gd-grip-f i.on{background:#8fd3ff;border-color:#8fd3ff}
.gd-grip-f i.m{border-color:#5c3a2a}
.gd-grip-f i.m.on{background:#c9603f;border-color:#c9603f}
.gd-grip-f .ok{color:#8fd3ff}.gd-grip-f .bad{color:#e0a34a}
/* ── Кромка мира: вопрос, а не стена. ── */
.gd-edge{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;
  padding:24px;background:rgba(3,5,9,.82);color:#cfe0f2;font:14px system-ui,sans-serif;
  animation:gdEdgeIn .5s ease both}
.gd-edge.gone{background:#04060a;transition:background 1.4s linear}
.gd-edge-w{width:min(460px,100%);text-align:center}
.gd-edge-t{font:11px ui-monospace,monospace;letter-spacing:.3em;text-transform:uppercase;color:#5d7085}
.gd-edge-w p{margin:16px 0 0;line-height:1.6;color:#8fa4b8}
.gd-edge-q{color:#eaf2fb!important;font-size:16px}
.gd-edge-b{display:flex;flex-direction:column;gap:8px;margin-top:22px}
.gd-edge-end{color:#8fa4b8;font-size:17px;line-height:1.7;animation:gdEdgeIn 1.2s ease both}
@keyframes gdEdgeIn{from{opacity:0}to{opacity:1}}
@media(max-width:768px){.gd-panel{padding:0;align-items:flex-end}
  .gd-p-win{width:100%;max-height:78%;clip-path:none}
  .gd-row{grid-template-columns:1fr}
  /* Стяжку с телефона держим ВЫШЕ органов управления. */
  .gd-grip{bottom:auto;top:14%}
  .gd-p-b{padding:14px 16px 22px}
  .gd-b{padding:13px 12px}
  .gd-keys{font-size:10px;padding:5px 8px}}
/* Обложка «куда идти» живёт в колонке новеллы и держится её переменных. */
.fish-lead{font-size:12.5px;color:var(--t3,#8aa0b0);line-height:1.6;max-width:560px;margin:0 auto;text-align:center}
.fish-site{max-width:560px;margin:0 auto;padding:10px 0 2px;text-align:center}
.fish-site-nm{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--acc,#8fd3ff)}
.fish-site-sub{font-size:11.5px;color:var(--t4,#6a7a88);margin-top:6px}
.fish-site-kv{display:flex;flex-wrap:wrap;gap:4px 16px;justify-content:center;font:11.5px ui-monospace,monospace;color:var(--t3,#8aa0b0);margin-top:12px}
.fish-site-kv b{color:var(--t1,#dfe7f2);font-weight:400}
.fish-go{display:inline-flex;padding:8px 22px;margin-top:16px;cursor:pointer;background:var(--bg2,#101922);border:1px solid var(--acc,#8fd3ff);color:var(--t1,#dfe7f2);font:inherit}
.fish-go:hover{background:var(--bg3,#16222e)}
/* Выбор облика на обложке: ряд плиток, отмеченная — акцентом. */
.gd-keysbox{margin-top:22px}
.gd-keys-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:6px 18px;
  max-width:520px;margin:0 auto}
.gd-keys-k{display:flex;align-items:baseline;gap:10px;padding:4px 0;
  border-bottom:1px solid var(--bd,#141d27)}
.gd-keys-k b{flex:none;min-width:104px;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;
  font-weight:400;letter-spacing:.1em;color:var(--t1,#dfe7f2)}
.gd-keys-k span{font-size:12px;color:var(--t4,#6a7a88)}
.gd-look{max-width:560px;margin:26px auto 0;padding-top:18px;border-top:1px solid var(--bd,#16202c)}
.gd-look-t{font:10.5px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;
  text-transform:uppercase;color:var(--t4,#6a7a88);text-align:center;margin:14px 0 8px}
.gd-look-r{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.gd-look-i{display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 10px 7px;
  background:var(--bg2,#101922);border:1px solid var(--bd,#1b2836);cursor:pointer;color:inherit;min-width:78px}
.gd-look-i:hover{border-color:var(--acc,#8fd3ff)}
.gd-look-i.on{border-color:var(--acc,#8fd3ff);background:rgba(143,211,255,.09)}
.gd-look-i canvas{width:56px;height:56px;display:block}
.gd-look-i i{width:56px;height:34px;display:block}
.gd-look-i em{font-style:normal;font:10px ui-monospace,monospace;letter-spacing:.1em;
  text-transform:uppercase;color:var(--t4,#6a7a88)}
.gd-look-i.on em{color:var(--t1,#dfe7f2)}
@media(max-width:768px){.gd-look-i{min-width:66px;padding:7px 7px 6px}
  .gd-look-i canvas{width:46px;height:46px}.gd-look-i i{width:46px;height:28px}}
`;
  document.head.appendChild(s);
}

// ── Обложка: куда идти. ──
function _gdHead(en) {
  return `<div class="hp-vn-col-head">
    <span class="hp-vn-col-title">✦ ${en ? 'Temple of Creation' : 'Уйти в пустоту'}</span>
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
  el.innerHTML = _gdHead(en) + _gdMsg('Что ж...');
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

  // Место действия одно — система Храма (см. gardenDescend). Ячейки в ней
  // сервер даёт всем ('temple'), поэтому пустого экрана «своего шельфа нет»
  // тут быть не может: land есть всегда.
  const tmp = lands.find(l => l.land === 'temple') || lands[0];
  const body = `<div class="fish-site">
        <div class="fish-site-nm">${esc((tmp && tmp.name) || 'Пустота')}</div>
        <div class="fish-site-sub">система Храма Мироздания · орбитальные ячейки</div>
        <div class="fish-site-kv">
          <span>ячеек: <b>${mine.length}/${Math.round((_gdState.const || {}).plot_cap || 0)}</b></span>
          ${ripe ? `<span>созрело: <b>${ripe}</b></span>` : ''}
          ${dry ? `<span>вне режима: <b>${dry}</b></span>` : ''}
          ${_gdState.seed_ichor > 0 ? `<span>в трюме: <b>спора мира</b></span>` : ''}
        </div>
        <button class="fish-go" onclick="event.stopPropagation();gardenDescend()">Уйти</button>
      </div>
      ${gardenKeysHtml()}${gardenLookHtml()}`;

  el.innerHTML = _gdHead(en) + `<div class="hp-vn-col-body">${body}</div>`;
  gardenLookPaint();
}

// ── Обучение. ⚠️ ОНО ЖИЛО ПОЛОСОЙ ПОД ХОЛСТОМ И ЧИТАЛОСЬ РОВНО ОДИН РАЗ —
// в первую секунду, дальше просто отъедало кадр и лезло в глаза всю игру.
// Место управления — на пороге, рядом с выбором облика: там его читают ДО
// вылета, осознанно, и там же оно не мешает смотреть на сад.
function gardenKeysHtml() {
  const rows = _gdTouch()
    ? [['стик слева', 'курс'], ['тап по грядке', 'открыть ячейку'],
       ['тап по камню', 'бросить сеть'], ['E', 'работа в саду'],
       ['разгон', 'держать для перегона'], ['тап где угодно', 'хват при стяжке'],
       ['↩ уйти', 'вернуться сюда']]
    : [['W A S D', 'курс'], ['ЛКМ по грядке', 'открыть ячейку'],
       ['ЛКМ по камню', 'бросить сеть'], ['E', 'работа в саду'],
       ['Shift', 'разгон'], ['Пробел', 'хват при стяжке'], ['Esc', 'уйти']];
  return `<div class="gd-look gd-keysbox">
      <div class="gd-look-t">управление</div>
      <div class="gd-keys-g">${rows.map(r =>
        `<div class="gd-keys-k"><b>${r[0]}</b><span>${r[1]}</span></div>`).join('')}</div>
    </div>`;
}

// ── Облик: шляпа и расцветка. Выбирают ЗДЕСЬ, до вылета: в кадре игры для
// этого пришлось бы держать ещё одно окно поверх и без того занятого экрана.
// Плитки шляп рисует та же gdDrawHat, что и корабль, — выбираешь ровно то,
// что увидишь.
function gardenLookHtml() {
  const hats = GD_HATS.map(k => `<button class="gd-look-i${k === GD_LOOK.hat ? ' on' : ''}"
      type="button" data-hat="${k}" title="${GD_HAT_NM[k]}"
      onclick="event.stopPropagation();gardenLookPick('hat','${k}')">
      <canvas width="112" height="112"></canvas><em>${GD_HAT_NM[k]}</em></button>`).join('');
  const hulls = Object.keys(GD_HULLS).map(k => {
    const h = GD_HULLS[k];
    return `<button class="gd-look-i${k === GD_LOOK.hull ? ' on' : ''}" type="button"
      onclick="event.stopPropagation();gardenLookPick('hull','${k}')">
      <i style="background:linear-gradient(180deg,${h.a},${h.b} 45%,${h.c});box-shadow:inset 0 0 0 1px ${h.t}66"></i>
      <em>${h.nm}</em></button>`;
  }).join('');
  return `<div class="gd-look">
      <div class="gd-look-t">шляпа</div><div class="gd-look-r">${hats}</div>
      <div class="gd-look-t">расцветка факельщика</div><div class="gd-look-r">${hulls}</div>
    </div>`;
}

function gardenLookPaint() {
  document.querySelectorAll('.gd-look-i[data-hat] canvas').forEach(cv => {
    const k = cv.parentElement.dataset.hat;
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    c.save();
    c.translate(cv.width / 2, cv.height / 2);
    // Нос корабля смотрит вправо, шляпа рисуется в его координатах: в плитке
    // разворачиваем «на игрока», иначе козырёк и капюшон читаются боком.
    c.rotate(-Math.PI / 2);
    gdDrawHat(c, 42, k);
    c.restore();
  });
}

function gardenLookPick(k, v) {
  gdLookSet(k, v);
  const box = document.querySelector('.gd-look');
  if (!box) return;
  // Перерисовываем только выделение: полная перекладка обложки сбрасывает
  // прокрутку к шапке ровно в тот момент, когда игрок листает плитки.
  const rows = box.querySelectorAll('.gd-look-r');
  const row = rows[k === 'hat' ? 0 : 1];
  if (!row) return;
  const keys = k === 'hat' ? GD_HATS : Object.keys(GD_HULLS);
  row.querySelectorAll('.gd-look-i').forEach((b, i) => b.classList.toggle('on', keys[i] === v));
}

// ── Выход на отмель ──
async function gardenDescend() {
  gardenStyleOnce();
  gardenStopGame();

  const fs = document.createElement('div');
  fs.className = 'gd-fs'; fs.id = 'gd-fs';
  fs.innerHTML = `<div class="gd-bar">
      <span class="gd-bar-t">✦ Уйти в пустоту</span>
      <div class="gd-hud" id="gd-hud"></div>
      <button class="gd-exit" type="button" onclick="event.stopPropagation();gardenPaintOverview()">↩ уйти</button>
    </div>
    <div class="gd-stage" id="gd-stage"><canvas class="gd-cv" id="gd-cv"></canvas></div>`;
  document.body.appendChild(fs);

  const stage = document.getElementById('gd-stage');
  stage.insertAdjacentHTML('beforeend', '<div class="gd-keys" id="gd-load" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border:0;background:#05070c">Храм проступает…</div>');

  if (!_gdWorld) {
    try {
      // ⚠️ МЕСТО ДЕЙСТВИЯ — ОДНА СИСТЕМА ХРАМА, А НЕ ВСЯ ГАЛАКТИКА. Карта в
      // натуральную величину читалась пустым коридором: тысячи светил, между
      // ними по тридцать тысяч единиц ничего, и всё, что там можно делать, —
      // держать Shift. Играть не во что, а грузились при этом все системы,
      // сектора и гиперпути разом. Теперь мир ровно там, где смысл: система
      // Храма Мироздания — единственная земля, куда сервер пускает всех
      // (`_g_land` → 'temple'), поэтому ячейки есть у любого игрока.
      // Гиперпути и сектора не нужны: лететь некуда и рукав тут один.
      const all = await dbGet('map_systems', 'select=id,name,x,y,is_giant,star_type,planets');
      const tid = _gdState && _gdState.temple;
      const temple = (all || []).find(s => s.id === tid)
                  || (all || []).find(s => /храм\s*мироздан/i.test(s.name || ''))
                  || (all || [])[0];
      if (!temple) throw new Error('Храм не найден на карте');
      _gdWorld = GardenWorld([temple], [], []);
    } catch (e) {
      gardenToast('Карта не загрузилась: ' + ((e && e.message) || ''), 'err');
      gardenPaintOverview(); return;
    }
  }
  const ld = document.getElementById('gd-load'); if (ld) ld.remove();
  if (!document.getElementById('gd-fs')) return;      // успели уйти

  // Появление: на площадке Храма. Встаём НА неё — первый кадр должен показать,
  // куда ты прилетел, а не пустоту где-то рядом.
  const node = _gdWorld.nodes[0];
  // Встаём В ВИДУ СВЕТИЛА, а не где-то на краю площадки: первый кадр должен
  // показать звезду и ближние орбиты, иначе вход в мир — это чёрный экран.
  // ⚠️ ОТСТУП СЧИТАЕТСЯ ПО ЭКРАНУ, А НЕ ПО МИРУ. Изометрия сжимает одну ось
  // вдвое: ровный отступ по обеим координатам даёт сдвиг ВВЕРХ на полтора
  // экрана — светило оказывается за кадром, и игрок видит пустоту. Шагаем по
  // диагонали (+k, −k): на экране это чисто горизонталь, и звезда стоит сбоку
  // примерно в двух своих радиусах — то есть занимает полкадра.
  const k0 = node ? node.starR * 1.35 : 0;
  let spawn = node ? { tx: node.tx + k0, ty: node.ty - k0 } : { tx: 0, ty: 0 };
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
  gardenTouchUI(document.getElementById('gd-stage'));
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
