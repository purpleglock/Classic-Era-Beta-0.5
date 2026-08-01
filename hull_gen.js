// © 2025–2026 Setis241. Проприетарное ПО. См. LICENSE.
// ════════════════════════════════════════════════════════════
// HULL GEN v2 — процедурный визуализатор КОРПУСОВ (вид сверху)
// ────────────────────────────────────────────────────────────
// Язык отрисовки задан референсами (01.08): СВЕТЛЫЙ гранёный корпус на чёрном,
// собранный из КРУПНЫХ СЕКЦИЙ, между которыми идут ГЛУБОКИЕ ТЁМНЫЕ ПАЗЫ. Форму
// держат перепад тона и пустота, а не контурные линии.
//   §4 СЕКЦИИ  — продольные блоки (хребет, борта, броня) с пазами между ними;
//   §5 БРОНЯ   — крайний пояс: самый светлый, с жёсткой кромкой и швами;
//   §6 НИШИ    — утопленные прямоугольные площадки, выстроенные по оси;
//   §7 КОРМА   — поперечный блок с соплами и гондолы на пилонах.
// ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: клёпки, шпангоутов, кирпичной кладки, случайных
// «деталек». Всё, что рисуется, — это конструктивная секция или паз между ними.
// Экспорт: window.HG
// ════════════════════════════════════════════════════════════
window.HG = (function () {
'use strict';

// ── §1. Мелочи ───────────────────────────────────────────────
const n1 = v => Math.round(v * 10) / 10;
function hex2rgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); }
function rgb2hex(a) { return '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function shade(c, k) { const A = hex2rgb(c); return rgb2hex(A.map(v => k > 0 ? v + (255 - v) * k : v * (1 + k))); }
const GROOVE = '#0e1216';                                // дно паза — почти чёрное
const INK = '#0b0d10';                                   // чернильный контур детали (как в оружейной верфи)

// ── §2. Геометрия ────────────────────────────────────────────
// Силуэт БЕЗ сглаживания: прямые рёбра = механика. Кривая = камешек.
function outlinePts(st, wf) {
  wf = wf == null ? 1 : wf;
  const R = st.map(p => [160 + p[1] * wf, p[0]]);
  const L = st.slice().reverse().map(p => [160 - p[1] * wf, p[0]]);
  return R.concat(L);
}
// Совместимость со старыми вызовами (конструктор строит по ним clip-path).
function catmullPoly(pts) { return pts.map(p => p.slice()); }
const polyPath = poly => 'M' + poly.map(p => n1(p[0]) + ',' + n1(p[1])).join('L') + 'Z';
function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a) / 2; }
function halfAt(H, y) {
  const s = H.st;
  if (y <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) if (y <= s[i][0]) { const a = s[i - 1], b = s[i]; return a[1] + (b[1] - a[1]) * ((y - a[0]) / ((b[0] - a[0]) || 1)); }
  return s[s.length - 1][1];
}
function hullPoly(H, wf) { return outlinePts(H.st, wf == null ? 1 : wf); }
function hullPathOf(H, wf) { return polyPath(hullPoly(H, wf)); }
const spanOf = H => { const ys = H.st.map(p => p[0]); return [Math.min(...ys), Math.max(...ys)]; };
const yAt = (H, t) => { const [a, b] = spanOf(H); return a + (b - a) * t; };

// ЛЕНТА СЕКЦИИ: кусок корпуса между поперечными координатами v0..v1 и продольными
// t0..t1. Идёт ПО ОБВОДУ (полуширина берётся в каждом сечении), поэтому у носа
// секция сама сужается вместе с корпусом — как на референсах.
function strip(H, v0, v1, t0, t1) {
  const [yA, yB] = spanOf(H), y0 = yA + (yB - yA) * t0, y1 = yA + (yB - yA) * t1;
  // Узловые y: границы + все станции внутри диапазона → рёбра совпадают с гранями корпуса.
  const ys = [y0];
  for (const s of H.st) if (s[0] > y0 + 0.5 && s[0] < y1 - 0.5) ys.push(s[0]);
  ys.push(y1);
  const a = ys.map(y => [160 + v1 * halfAt(H, y), y]);
  const b = ys.slice().reverse().map(y => [160 + v0 * halfAt(H, y), y]);
  return a.concat(b);
}

// ── §3. Материал: тон металла от рецепта брони ───────────────
// Цвет даёт МАТЕРИАЛ, а не раскраска. Корабль светлый — как на референсах.
const MATS = [
  [/керамик|ceramic/i, '#c2c6c2'],
  [/композит|composite/i, '#7d858c'],
  [/реактив|динамич/i, '#a9967f'],
  [/сталь|steel|железо/i, '#a3abb2'],
  [/титан|titan/i, '#b0b8bf'],
  [/адамант|нейтрон|экзот|кристалл/i, '#98a6bc'],
  [/нано|nano/i, '#93a3a6'],
];
function tintOf(name) {
  for (const [re, c] of MATS) if (re.test(String(name || ''))) return c;
  return '#a3abb2';
}
// Плоское затенение грани: тон СТУПЕНЬКОЙ по поперечной координате, без градиента.
// Свет слева-сверху → левый борт светлее, правый уходит в тень.
function facet(tint, v, lift) {
  const step = Math.round((-v + 1) * 3) / 3 - 1;         // квантование → чёткие грани
  return shade(tint, -0.30 + step * 0.20 + (lift || 0));
}

// ── §3.5 РЕЛЬСЫ: единая рама корабля ─────────────────────────
// Все элементы (секции, ниши, пилоны, кормовой блок, броня) садятся на ОДНИ И ТЕ
// ЖЕ продольные координаты. Отсюда связность: ниша не «где-то на палубе», а между
// хребтовым и бортовым рельсом; пилон растёт из бортового рельса; кормовой блок
// упирается в них же. Меняешь рельс — двигается вся конструкция разом.
function rails(o) {
  const belt = 0.08 + 0.12 * o.aRt;                      // глубина бронепояса
  return { spine: 0.26, mid: 0.70, belt: 1 - belt, edge: 1, beltW: belt };
}
// Градиент поперёк секции: светлая кромка со стороны света → база → тень.
// Именно он даёт ОБЪЁМ: секция читается как выпуклая плита, а не как заливка.
function bandGrad(id, o, x0, x1, base, lit) {
  const dir = x0 < x1;                                   // от левого края к правому
  const a = shade(base, 0.26 + (lit || 0)), b = shade(base, 0.02 + (lit || 0) * 0.5), c = shade(base, -0.34);
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n1(x0)}" y1="0" x2="${n1(x1)}" y2="0">`
    + `<stop offset="0" stop-color="${dir ? a : c}"/><stop offset="0.30" stop-color="${b}"/>`
    + `<stop offset="0.72" stop-color="${shade(base, -0.12)}"/><stop offset="1" stop-color="${dir ? c : a}"/></linearGradient>`;
}

// ── §4. СЕКЦИИ КОРПУСА ───────────────────────────────────────
// Хребет по оси, палубы, борта под бронёй. Между ними — ПАЗЫ (тёмное дно корпуса),
// и в каждом пазу лежит AO: секция приподнята и роняет тень на дно. Поперёк секции
// разрезаны на блоки СО СКОСАМИ (не прямые стыки) — язык скосов общий для всего
// модуля: 1 к 4 по длине блока.
// ⚠️ ГЛАВНОЕ ПРАВИЛО МАСШТАБА: размеры деталей заданы в АБСОЛЮТНЫХ единицах, а не
// в долях корпуса. Пока всё считалось долями, большой корабль был просто увеличенной
// копией маленького — глазу не за что зацепиться, и дредноут читался «корабликом».
// Теперь у широкого корпуса полос БОЛЬШЕ, а не шире; шпангоуты чаще; ниши те же по
// размеру, но их больше. Именно количество деталей и передаёт размер.
const U = { band: 11, frame: 13, bay: [9, 6], silo: 3.2, fin: 1.7 };
function sectionsOf(o, H) {
  const R = rails(o);
  const half = H.maxHW;
  // Полосы палубы нарезаются по абсолютной ширине U.band между хребтом и бортом.
  const nDeck = Math.max(1, Math.round((R.mid - R.spine) * half / U.band));
  const out = [[-R.belt, -R.mid, 0.06, 0.05, 0.985]];    // борт под бронёй (левый)
  for (let i = 0; i < nDeck; i++) {
    const a = R.spine + (R.mid - R.spine) * i / nDeck, b = R.spine + (R.mid - R.spine) * (i + 1) / nDeck;
    const lift = (i % 2) * 0.05;                         // соседние полосы чуть разного тона
    out.push([-b + 0.012, -a - 0.012, lift, 0.11, 0.985]);
  }
  out.push([-R.spine, R.spine, 0.13, 0.02, 0.985]);      // ХРЕБЕТ
  for (let i = 0; i < nDeck; i++) {
    const a = R.spine + (R.mid - R.spine) * i / nDeck, b = R.spine + (R.mid - R.spine) * (i + 1) / nDeck;
    const lift = (i % 2) * 0.05;
    out.push([a + 0.012, b - 0.012, lift, 0.11, 0.985]);
  }
  out.push([R.mid, R.belt, 0.06, 0.05, 0.985]);          // борт под бронёй (правый)
  return out;
}
// Блок секции со скошенными торцами: передний торец «уезжает» назад по борту,
// задний — вперёд. Даёт стреловидность вместо нарезки колбасы.
function secBlock(H, v0, v1, t0, t1, skew) {
  const [yA, yB] = spanOf(H), L = yB - yA;
  // Симметричную ленту (она пересекает ось) НЕ скашиваем: «внутренней» кромки у неё
  // нет, и скос оставлял между блоками чёрные клинья.
  const sym = v0 * v1 < 0;
  const y0 = yA + L * t0, y1 = yA + L * t1, sk = sym ? 0 : (y1 - y0) * (skew == null ? 0.16 : skew);
  const inner = Math.abs(v0) < Math.abs(v1) ? v0 : v1;   // ближняя к оси кромка
  const outer = inner === v0 ? v1 : v0;
  const xIn = y => 160 + inner * halfAt(H, y), xOut = y => 160 + outer * halfAt(H, y);
  // Узловые y для кромки: концы + станции внутри диапазона (рёбра совпадают с гранями).
  const nodes = (a, b) => {
    const r = [a];
    for (const s of H.st) if (s[0] > a + 0.5 && s[0] < b - 0.5) r.push(s[0]);
    r.push(b);
    return r;
  };
  // Скос: ВНУТРЕННЯЯ кромка короче внешней с обоих концов на sk. Обе кромки строим
  // каждую по своему диапазону — иначе полигон самопересекался «бабочкой».
  const outEdge = nodes(y0, y1).map(y => [xOut(y), y]);
  const inEdge = nodes(y0 + sk, Math.max(y0 + sk + 0.5, y1 - sk)).reverse().map(y => [xIn(y), y]);
  return outEdge.concat(inEdge);
}
// ── ЭКСТРУЗИЯ (формула оружейной верфи) ──────────────────────
// Именно она делает деталь «железной»: падающая тень → боковины по нормали к свету
// → фаска → верхняя грань. Плюс чернильный контур: без него формы не читаются.
// Свет направлен строго ВДОЛЬ оси корабля (x = 0). Любая боковая составляющая
// смещает экструзию вбок и РАЗРУШАЕТ зеркальную симметрию: левый борт перестаёт
// совпадать с правым. Объём даёт подъём по оси + градиент поперёк.
const LIGHT = { x: 0, y: -1 };
const shiftPts = (pts, dx, dy) => pts.map(p => [p[0] + dx, p[1] + dy]);
function insetPts(pts, d) {
  let cx = 0, cy = 0; pts.forEach(p => { cx += p[0]; cy += p[1]; });
  cx /= pts.length; cy /= pts.length;
  const b = bboxOf(pts), r = Math.max(2, Math.max(b[2] - b[0], b[3] - b[1]) / 2);
  const k = Math.max(0.05, 1 - d / r);
  return pts.map(p => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k]);
}
function bboxOf(p) { const xs = p.map(q => q[0]), ys = p.map(q => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
// ⚠️ ЭКСТРУЗИИ БОЛЬШЕ НЕТ (01.08). Она поднимала каждую деталь над соседней и
// рисовала боковые грани — корпус превращался в ЛЕСТНИЦУ из уступов. Деталь теперь
// ПЛОСКАЯ: градиент поперёк даёт форму, мягкая тень под кромкой сажает её на место,
// тонкий кант собирает силуэт. Параметр h сохранён (его передают все вызовы) и
// управляет только СИЛОЙ тени — насколько деталь «оторвана» от палубы.
function solid(pts, h, o, fill, slot) {
  const d = polyPath(pts);
  const ao = Math.max(1.2, Math.min(3.4, h * 0.7));
  return `<path d="${d}" fill="none" stroke="#000" stroke-width="${n1(ao)}" opacity="0.5" style="filter:blur(1.1px)"/>`
    + `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="0.6" stroke-linejoin="round" data-slot="${slot || "hull"}"/>`
    + `<path d="${d}" fill="none" stroke="${shade(o.tint, 0.6)}" stroke-width="0.5" opacity="0.18"/>`;
}
function sections(H, o) {
  // ⚠️ ПОЛОСЫ НЕ РЕЖУТСЯ ПОПЕРЁК. Равномерная нарезка на блоки превращала корпус в
  // плитку шоколада: одинаковые фаски по всей площади, глазу не за что зацепиться.
  // Корпус = БОЛЬШИЕ ГЛАДКИЕ поверхности; детали живут в нескольких плотных зонах
  // (см. cluster) и в узлах класса. Неравномерность плотности и даёт масштаб.
  let g = '', s2 = `<path d="${hullPathOf(H, 1)}" fill="${GROOVE}"/>`;
  sectionsOf(o, H).forEach(([v0, v1, lift, t0, t1], i) => {
    const id = `hg_b${i}_${o.uid}`;
    g += bandGrad(id, o, 160 + v0 * H.maxHW, 160 + v1 * H.maxHW, o.tint, lift);
    const p = strip(H, v0, v1, t0, t1);
    if (polyArea(p) < 3) return;
    // Все полосы В ОДНОЙ ПЛОСКОСТИ: разная высота давала ступени вдоль всего борта.
    s2 += solid(p, 2.0, o, `url(#${id})`, "hull");
  });
  return `<defs>${g}</defs>` + s2;
}
// Клин форштевня — светлая грань с собственным градиентом, собирающая нос в остриё.
function prow(H, o) {
  // Клин ИДЁТ ПО ОБВОДУ носа, а не лежит ромбом поверх него: ширина берётся в
  // каждом сечении от самого корпуса, поэтому плита садится на нос как влитая.
  const R = rails(o);
  const p = strip(H, -R.spine * 1.2, R.spine * 1.2, 0.0, 0.26);
  if (polyArea(p) < 3) return '';
  const id = `hg_pr_${o.uid}`, d = polyPath(p);
  const hw = Math.max(2, halfAt(H, yAt(H, 0.26)) * R.spine * 1.2);
  return `<defs>${bandGrad(id, o, 160 - hw, 160 + hw, o.tint, 0.20)}</defs>`
    + solid(p, 5.2 * (0.8 + 0.4 * o.aRt), o, `url(#${id})`, "hull");
}

// ── §5. БРОНЯ ────────────────────────────────────────────────
// Крайний пояс сидит на рельсе belt: его внутренняя кромка — та же координата, по
// которой обрезаны бортовые секции, поэтому броня «сходится» с корпусом, а не
// лежит поверх. Каждая плита имеет собственный градиент (наружная кромка ловит
// свет, внутренняя уходит в тень) и роняет тень в паз. Класс брони читается
// глазом: шире пояс, чаще швы, на тяжёлой — второй разнесённый слой.
function armor(H, o) {
  const R = rails(o);
  let g = '', s = '';
    // Подробность пояса задаётся классом: у дредноута плиты короче, слоёв больше —
  // броня должна читаться как отдельная тяжёлая конструкция, а не как кант.
  const AD = { dreadnought: { seg: 0.5, layers: 1, flat: 1 }, battleship: { seg: 0.72, layers: 2 } }[o.hull] || { seg: 1, layers: 0 };
  const layers = AD.flat ? 1 : Math.max(AD.layers, o.aRt > 0.5 ? 2 : 1);
  for (let l = 0; l < layers; l++) {
    const vOut = l ? R.belt - R.beltW * (0.30 + 0.55 * (l - 1)) : 1;   // каждый следующий слой глубже
    const vIn = l ? vOut - R.beltW * 0.5 : R.belt;
    const nSeg = Math.max(4, Math.round((spanOf(H)[1] - spanOf(H)[0]) / ((26 - 10 * o.aRt) * AD.seg))) * (l ? 2 : 1);   // плита пояса — абсолютной длины
    const t0 = l ? 0.32 + 0.06 * (l - 1) : 0.045, t1 = l ? 0.86 - 0.05 * (l - 1) : 0.99;
    for (const sd of [-1, 1]) {
      const id = `hg_a${l}${sd < 0 ? 'l' : 'r'}_${o.uid}`;
      const xa = 160 + sd * vIn * H.maxHW, xb = 160 + sd * vOut * H.maxHW;
      // Наружу — свет, внутрь — тень: плита читается скруглённой по толщине.
      g += bandGrad(id, o, sd < 0 ? xb : xa, sd < 0 ? xa : xb, o.tint, l ? 0.04 : 0.22);
      for (let i = 0; i < nSeg; i++) {
        const a = t0 + (t1 - t0) * i / nSeg, b = t0 + (t1 - t0) * (i + 1) / nSeg;
        const p = strip(H, sd < 0 ? -vOut : vIn, sd < 0 ? -vIn : vOut, a + 0.005, b);
        if (polyArea(p) < 2) continue;
        // Плита пояса ВЫШЕ палубы: высота экструзии = класс брони. Именно она даёт
        // ощущение толщины, а не ширина полосы.
        s += solid(p, (2.6 + 4.4 * o.aRt) * (l ? 0.55 : 1), o, `url(#${id})`, "armor");
      }
    }
  }
  // Жёсткая световая кромка по самому борту — броня «ловит свет», как на референсах.
  const lit = polyPath(hullPoly(H, 1));
  s += `<path d="${lit}" fill="none" stroke="${shade(o.tint, 0.72)}" stroke-width="${(0.8 + o.aRt * 0.7).toFixed(1)}" opacity="0.6" stroke-linejoin="miter"/>`;
  return `<defs>${g}</defs>` + s;
}

// ── §6. ПАЛУБА ОСТАЁТСЯ ПУСТОЙ ──────────────────────────────
// ⚠️ ГЛАВНОЕ ОГРАНИЧЕНИЕ МОДУЛЯ: корпус — это ФОН. Поверх него конструктор рисует
// узлы орудий (башни с артом), кликабельные полигоны отсеков, метки ангаров и
// подписи батарей. Всё это живёт на палубе между хребтом и бортом. Поэтому там
// НЕЛЬЗЯ рисовать ничего своего: любые короба, ниши и решётки конкурируют с
// орудиями, и схема перестаёт читаться. Свои детали — только по краям (бронепояс,
// борт, оконечности) и только крупные.
// Прежние cluster()/bays() удалены именно поэтому.
function clusterDefs(o) { return ""; }
// ── §6.5 СЛОВАРЬ УЗЛОВ: у каждого своя геометрия ─────────────
// Принцип взят из оружейной верфи: там у КАЖДОЙ платформы и КАЖДОЙ технологии свой
// рисовальщик, а не вариация одной формы. Здесь так же — ниже не «плитка с разными
// параметрами», а разные конструкции: башня-мостик, ангарный зев, поле пусковых
// ячеек, радиаторный веер, тарелка сенсора, ферма-хребет, стыковочный захват.
// Класс корабля выбирает СВОЙ набор (§6.6) — отсюда непохожесть силуэтов.

// ПОСТ УПРАВЛЕНИЯ: НЕ башня-шляпа (она читалась колпаком на палубе), а низкий
// вытянутый блок вдоль оси со смотровой прорезью — часть палубы, а не нашлёпка.
// Размеры АБСОЛЮТНЫЕ: на большом корпусе он не раздувается, а теряется в масштабе.
function elBridge(H, o, t) {
  const y = yAt(H, t), hw = halfAt(H, y);
  if (hw < 12) return "";
  const w = 7, len = 26;
  const p = [[160 - w, y], [160 + w, y], [160 + w, y + len - 5], [160 + w - 3, y + len],
             [160 - w + 3, y + len], [160 - w, y + len - 5]];
  let s2 = solid(p, 4.5, o, shade(o.tint, -0.06), "bridge");
  // Смотровая прорезь по переднему торцу — единственный акцент.
  s2 += `<path d="M${n1(160 - w + 1.6)},${n1(y - 3.2)}L${n1(160 + w - 1.6)},${n1(y - 3.2)}" stroke="${o.glow || "#7fe0ff"}" stroke-width="1.4" opacity="0.55"/>`;
  return s2;
}
// АНГАРНЫЙ ЗЕВ: тёмный вырез в борту с направляющими и светящейся полосой створа.
function elHangar(H, o, t, len) {
  const y0 = yAt(H, t), y1 = yAt(H, t + (len || 0.14)), R = rails(o);
  let s = '';
  for (const sd of [-1, 1]) {
    const xo = y => 160 + sd * halfAt(H, y) * R.belt, xi = y => 160 + sd * halfAt(H, y) * (R.mid - 0.06);
    const p = [[xo(y0), y0], [xo(y1), y1], [xi(y1 - (y1 - y0) * 0.14), y1 - (y1 - y0) * 0.14], [xi(y0 + (y1 - y0) * 0.14), y0 + (y1 - y0) * 0.14]];
    const d = polyPath(p);
    s += `<path d="${d}" fill="#05070a"/>`
      + `<path d="${d}" fill="none" stroke="#000" stroke-width="3" opacity="0.85" style="filter:blur(1.2px)"/>`
      + `<path d="M${n1(xo(y0))},${n1(y0)}L${n1(xo(y1))},${n1(y1)}" stroke="${o.glow || '#7fe0ff'}" stroke-width="1.2" opacity="0.5"/>`;
    for (let i = 1; i < 4; i++) {                        // направляющие в глубине зева
      const yy = y0 + (y1 - y0) * i / 4;
      s += `<line x1="${n1(xo(yy))}" y1="${n1(yy)}" x2="${n1(xi(yy))}" y2="${n1(yy)}" stroke="${shade(o.tint, 0.3)}" stroke-width="0.6" opacity="0.4"/>`;
    }
  }
  return s;
}
// ПОЛЕ ПУСКОВЫХ ЯЧЕЕК: сетка мелких крышек, каждая со своей фаской.
function elSilos(H, o, t, rows, cols) {
  const R = rails(o), y = yAt(H, t), hw = halfAt(H, y);
  if (hw < 16) return '';
  // Крышка ячейки — ФИКСИРОВАННЫЕ U.silo единиц. На широкой палубе их просто
  // помещается больше: поле растёт числом ячеек, а не их размером.
  const deck = hw * (R.mid - R.spine - 0.12);
  const cw = U.silo, ch = U.silo * 1.05;
  cols = Math.max(1, Math.floor(deck / cw));
  rows = rows || 4;
  let s = '';
  for (const sd of [-1, 1]) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = 160 + sd * (hw * (R.spine + 0.08) + c * cw), yy = y + r * ch;
    const p = [[x, yy], [x + cw * 0.82, yy], [x + cw * 0.82, yy + ch * 0.82], [x, yy + ch * 0.82]];
    s += `<path d="${polyPath(p)}" fill="#0a0d11" stroke="${shade(o.tint, 0.34)}" stroke-width="0.4" stroke-opacity="0.45"/>`
      + `<path d="M${n1(x + cw * 0.16)},${n1(yy + ch * 0.16)}L${n1(x + cw * 0.66)},${n1(yy + ch * 0.16)}" stroke="${shade(o.tint, 0.5)}" stroke-width="0.5" opacity="0.3"/>`;
  }
  return s;
}
// РАДИАТОРНЫЙ ВЕЕР: тонкие рёбра, выходящие ЗА борт (единственное, что торчит).
function elRadiators(H, o, t, n) {
  const y0 = yAt(H, t), R = rails(o);
  n = n || 5;
  let s = '';
  for (const sd of [-1, 1]) for (let i = 0; i < n; i++) {
    const y = y0 + i * 6, hw = halfAt(H, y);   // шаг рёбер — абсолютный
    if (hw < 8) continue;
    const x0 = 160 + sd * hw * 0.9, x1 = 160 + sd * (hw + 16);   // вылет ребра — абсолютный
    const th = U.fin;
    s += solid([[x0, y - th], [x1, y - th * 0.6], [x1, y + th * 0.6], [x0, y + th]], 1.6, o, shade(o.tint, -0.10), 'radiator');
  }
  return s;
}
// ТАРЕЛКА СЕНСОРА: круг с секторной разбивкой и опорой.
function elDish(H, o, t, k) {
  const y = yAt(H, t), r = 7 * (k || 1);   // тарелка не растёт с кораблём
  let s = `<circle cx="160" cy="${n1(y)}" r="${n1(r)}" fill="${shade(o.tint, -0.44)}" stroke="${INK}" stroke-width="0.7"/>`;
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI;
    s += `<line x1="${n1(160 - Math.cos(a) * r)}" y1="${n1(y - Math.sin(a) * r)}" x2="${n1(160 + Math.cos(a) * r)}" y2="${n1(y + Math.sin(a) * r)}" stroke="${shade(o.tint, 0.2)}" stroke-width="0.5" opacity="0.45"/>`;
  }
  return s + `<circle cx="160" cy="${n1(y)}" r="${n1(r * 0.28)}" fill="${shade(o.tint, 0.3)}" stroke="${INK}" stroke-width="0.6"/>`;
}
// ФЕРМА-ХРЕБЕТ: открытая диагональная решётка вместо сплошной палубы.
function elTruss(H, o, t0, t1) {
  const R = rails(o), yA0 = yAt(H, t0), yB0 = yAt(H, t1);
  const n = Math.max(4, Math.round((yB0 - yA0) / 9));
  let s = `<path d="${polyPath(strip(H, -R.spine * 0.8, R.spine * 0.8, t0, t1))}" fill="#06080b"/>`;
  for (let i = 0; i < n; i++) {
    const ya = yA0 + (yB0 - yA0) * i / n, yb = yA0 + (yB0 - yA0) * (i + 1) / n;
    const wa = halfAt(H, ya) * R.spine * 0.8, wb = halfAt(H, yb) * R.spine * 0.8;
    s += `<path d="M${n1(160 - wa)},${n1(ya)}L${n1(160 + wb)},${n1(yb)}M${n1(160 + wa)},${n1(ya)}L${n1(160 - wb)},${n1(yb)}" stroke="${shade(o.tint, 0.1)}" stroke-width="1.4" fill="none" opacity="0.8"/>`;
  }
  return s;
}
// ОСЕВОЙ УСКОРИТЕЛЬ («факельщик»): единственный класс, у которого главный калибр —
// не башня на палубе, а ствол ВО ВСЮ ДЛИНУ корпуса. Отсюда и силуэт: игла с дулом
// в носу, хомуты-шпангоуты по длине ствола и раздутый кормовой блок питания.
// Ширина строго по хребтовому рельсу — палуба под орудийные узлы остаётся свободной.
function elSpinal(H, o, t0, t1, off) {
  const R = rails(o), w = R.spine * 0.92;
  off = off || 0;                                        // СМЕЩЕНИЕ ОТ ОСИ: см. ниже
  const p = strip(H, off - w, off + w, t0, t1);
  if (polyArea(p) < 3) return '';
  const id = `hg_sp_${o.uid}`;
  const hwm = Math.max(2, halfAt(H, yAt(H, (t0 + t1) / 2)) * w);
  const cx0 = 160 + off * halfAt(H, yAt(H, (t0 + t1) / 2));
  let s = `<defs>${bandGrad(id, o, cx0 - hwm, cx0 + hwm, o.tint, 0.16)}</defs>`
    + solid(p, 3.6, o, `url(#${id})`, 'spinal');
  // Хомуты ускорителя — абсолютный шаг: на длинном корпусе их просто больше. Вылет
  // хомута РАЗНЫЙ по бортам (наружу от смещённого ствола длиннее) — конструкция
  // держится на одном силовом борту, а не висит симметрично в пустоте.
  const yA = yAt(H, t0), yB = yAt(H, t1), n = Math.max(3, Math.round((yB - yA) / 28));
  const sgn = off >= 0 ? 1 : -1;
  for (let i = 1; i < n; i++) {
    const y = yA + (yB - yA) * i / n, h = halfAt(H, y), cx = 160 + off * h;
    const wl = h * R.spine * (sgn > 0 ? 1.9 : 1.2), wr = h * R.spine * (sgn > 0 ? 1.2 : 1.9);
    if (wl + wr < 5) continue;
    s += solid([[cx - wl, y - 2.2], [cx + wr, y - 2.2], [cx + wr, y + 2.2], [cx - wl, y + 2.2]], 2.0, o, shade(o.tint, -0.14), 'spinal');
  }
  // Дуло: тёмный колодец с накалом — второй (и последний) цветной акцент после сопел.
  const ym = yAt(H, t0), hm = halfAt(H, ym), cxm = 160 + off * hm, r = Math.max(2.2, hm * w * 0.8);
  s += `<circle cx="${n1(cxm)}" cy="${n1(ym)}" r="${n1(r)}" fill="#05070a" stroke="${shade(o.tint, 0.5)}" stroke-width="0.8"/>`
    + `<circle cx="${n1(cxm)}" cy="${n1(ym)}" r="${n1(r * 0.5)}" fill="${o.glow || '#7fe0ff'}" opacity="0.5"/>`;
  return s;
}
// НАКЛАДНАЯ ПЛИТА НА ПАЛУБЕ: второй ярус, посаженный НЕ ПО ОСИ. Это и ломает
// зеркальность: корабль читается как установка, к которой пристроили ещё один
// блок, а не как отлитая симметричная модель. Плита лежит поверх секций, имеет
// собственный градиент, скошенные углы и тень на палубу.
function elPlate(H, o, t0, t1, sd) {
  // ⚠️ ПЛИТА ЖИВЁТ ТОЛЬКО НА ПАЛУБЕ. Границы берутся из рельсов: внешняя — рельс
  // mid (шов палубы с бортом), внутренняя — чуть за осью. Задавать их числами «на
  // глаз» нельзя: на изломах силуэта плита вылезала на бронепояс и висела над
  // кромкой отдельной доской. Теперь она физически не может выйти за палубу.
  const R = rails(o);
  const vOut = sd * (R.mid - 0.02), vIn = sd * -0.06;
  const p = strip(H, Math.min(vOut, vIn), Math.max(vOut, vIn), t0, t1);
  if (polyArea(p) < 6) return '';
  const id = `hg_pl${(t0 * 100) | 0}_${o.uid}`;
  const hm = halfAt(H, yAt(H, (t0 + t1) / 2));
  let s = `<defs>${bandGrad(id, o, 160 + vOut * hm, 160 + vIn * hm, o.tint, 0.12)}</defs>`
    + solid(p, 4.6, o, `url(#${id})`, 'plate');
  // Поперечные швы плиты — абсолютный шаг, как у всего остального.
  const yA = yAt(H, t0), yB = yAt(H, t1), n = Math.max(2, Math.round((yB - yA) / 22));
  for (let i = 1; i < n; i++) {
    const y = yA + (yB - yA) * i / n, h = halfAt(H, y);
    s += `<path d="M${n1(160 + vOut * h)},${n1(y)}L${n1(160 + vIn * h)},${n1(y)}" stroke="${shade(o.tint, -0.36)}" stroke-width="0.7" opacity="0.65"/>`;
  }
  return s;
}
// ОДНОБОРТНЫЙ РАДИАТОРНЫЙ ГРЕБЕНЬ: рёбра только с ОДНОЙ стороны. Нужен там, где
// симметрия вредна — корабль должен читаться как собранная установка, а не как
// зеркальная модель самолётика.
function elFinBank(H, o, t, n, sd) {
  const y0 = yAt(H, t);
  let s = '';
  for (let i = 0; i < (n || 5); i++) {
    const y = y0 + i * 6, hw = halfAt(H, y);
    if (hw < 8) continue;
    const len = 12 + (i % 3) * 6;                        // вылет гуляет — ритм не читается
    const x0 = 160 + sd * hw * 0.9, x1 = 160 + sd * (hw + len), th = U.fin;
    s += solid([[x0, y - th], [x1, y - th * 0.6], [x1, y + th * 0.6], [x0, y + th]], 1.6, o, shade(o.tint, -0.10), 'radiator');
  }
  return s;
}
// СТЫКОВОЧНЫЙ ЗАХВАТ: П-образная скоба, вынесенная за борт (только станция).
function elClamps(H, o, ts) {
  const R = rails(o);
  let s = '';
  for (const t of ts) {
    const y = yAt(H, t), hw = halfAt(H, y) * R.belt, arm = H.maxHW * 0.20, th = H.maxHW * 0.05;
    for (const sd of [-1, 1]) {
      const x = 160 + sd * hw;
      s += solid([[x, y - th * 2.4], [x + sd * arm, y - th * 2.4], [x + sd * arm, y - th], [x + sd * th, y - th],
                  [x + sd * th, y + th], [x + sd * arm, y + th], [x + sd * arm, y + th * 2.4], [x, y + th * 2.4]],
                 2.4, o, shade(o.tint, -0.16), 'clamp');
      s += `<circle cx="${n1(x + sd * arm * 0.6)}" cy="${n1(y)}" r="${n1(th * 0.8)}" fill="${o.glow || '#7fe0ff'}" opacity="0.45"/>`;
    }
  }
  return s;
}

// ── §6.6 КОМПОЗИЦИЯ КЛАССА: свой набор узлов ─────────────────
// Никакого «одного решения на всех»: у каждого семейства свой список элементов и
// своих мест. Корвет — голый и быстрый; линкор — башня и пусковые; авианосец —
// ангарные зевы во всю длину; станция — захваты и ферма вместо двигателей.
const COMPOSE = {
  // Всё, что здесь стоит, — либо ЗА бортом (радиаторы), либо на кромке борта
  // (ангарные зевы), либо в оконечности (пост управления, тарелка). Середина палубы
  // не занимается НИЧЕМ: там конструктор расставляет орудия и отсеки.
  corvette:     (H, o) => elDish(H, o, 0.22, 0.55) + elRadiators(H, o, 0.72, 3),
  frigate:      (H, o) => elBridge(H, o, 0.20) + elRadiators(H, o, 0.76, 3),
  destroyer:    (H, o) => elBridge(H, o, 0.18) + elRadiators(H, o, 0.78, 4),
  cruiser:      (H, o) => elBridge(H, o, 0.16) + elDish(H, o, 0.26, 0.7) + elRadiators(H, o, 0.80, 5),
  // ФАКЕЛЬЩИК (KV-ключ hyperCruiser): осевой ускоритель во всю длину + кормовой
  // энергоблок. Ни поста управления в носу, ни тарелки — нос занят дулом.
  // ФАКЕЛЬЩИК: ствол СМЕЩЁН С ОСИ, рёбра только по одному борту, пост управления
  // отодвинут к корме на другой борт. Симметрию ломаем нарочно — это установка,
  // собранная вокруг орудия, а не «корабль» в привычном смысле.
  // На палубе факельщика НЕТ НИЧЕГО: класс держится силуэтом (ломаный клин с
  // обратными подрезами) и тем, что живёт за бортом. Накладные плиты и осевой
  // ствол пробовались и убраны — они спорили с орудийными узлами и читались
  // досками поверх корпуса.
  hypercruiser: (H, o) => elFinBank(H, o, 0.66, 6, -1) + elFinBank(H, o, 0.82, 4, 1),
  battleship:   (H, o) => elBridge(H, o, 0.14) + elDish(H, o, 0.24, 0.7) + elRadiators(H, o, 0.82, 5),
  dreadnought:  (H, o) => elBridge(H, o, 0.12) + elDish(H, o, 0.22, 0.8) + elRadiators(H, o, 0.84, 6),
  carrier:      (H, o) => elHangar(H, o, 0.30, 0.30) + elDish(H, o, 0.12, 0.6),
  assault:      (H, o) => elHangar(H, o, 0.34, 0.26) + elBridge(H, o, 0.14),
  station:      null,                                    // у станции своя схема, см. stationDeck
};
function compose(H, o) { const f = COMPOSE[o.hull]; return f ? f(H, o) : ''; }

// ── §7. КОРМА: поперечный блок, сопла, гондолы на пилонах ────
// Блок упирается ровно в бортовые рельсы, сопла выстроены между ними — корма
// продолжает ту же раму, а не приставлена отдельной деталью.
function stern(H, o) {
  if (o.ground) return '';
  const R = rails(o);
  const [yA, yB] = spanOf(H), len = yB - yA;
  const nz = Math.max(1, Math.min(6, o.nozzles | 0 || 1));
  const id = `hg_st_${o.uid}`, idN = `hg_nz_${o.uid}`;
  const p = secBlock(H, -R.mid, R.mid, 0.88, 0.995, 0.10), d = polyPath(p);
  let g = bandGrad(id, o, 160 - R.mid * H.maxHW, 160 + R.mid * H.maxHW, o.tint, -0.14)
    + `<radialGradient id="${idN}"><stop offset="0" stop-color="#05070a"/><stop offset="0.72" stop-color="#0d1116"/>`
    + `<stop offset="1" stop-color="${shade(o.tint, -0.2)}"/></radialGradient>`
    + `<radialGradient id="${idN}g"><stop offset="0" stop-color="${o.glow || "#7fe0ff"}" stop-opacity="0.55"/>`
    + `<stop offset="1" stop-color="${o.glow || "#7fe0ff"}" stop-opacity="0"/></radialGradient>`;
  let s = solid(p, 4.2, o, `url(#${id})`, "stern");
  const hw = halfAt(H, yA + len * 0.93) * R.mid;
  const span = Math.min(hw * 0.86, 6 + nz * 4.5), r = Math.min(5.5, Math.max(2.4, span / (nz * 1.4)));
  const cy = yB - Math.max(4, len * 0.030);
  for (let i = 0; i < nz; i++) {
    const fx = nz === 1 ? 160 : 160 - span + 2 * span * i / (nz - 1);
    // Сопло: тёмный колодец + раскалённое ядро. Единственный цветной акцент на
    // корабле — по правилу «1-2 акцента», и он же отмечает рабочую часть.
    s += `<circle cx="${n1(fx)}" cy="${n1(cy)}" r="${n1(r * 1.5)}" fill="url(#${idN}g)" opacity="0.8"/>`
      + `<circle cx="${n1(fx)}" cy="${n1(cy)}" r="${n1(r)}" fill="url(#${idN})"/>`
      + `<circle cx="${n1(fx)}" cy="${n1(cy)}" r="${n1(r * 0.42)}" fill="${o.glow || "#7fe0ff"}" opacity="0.5"/>`
      + `<circle cx="${n1(fx)}" cy="${n1(cy)}" r="${n1(r)}" fill="none" stroke="${shade(o.tint, 0.6)}" stroke-width="0.8" opacity="0.6"/>`;
  }
  return `<defs>${g}</defs>` + s;
}

// ГОНДОЛЫ: идут вдоль кормовой части борта, выходят за срез кормы и держатся на
// короткой перемычке. Между гондолой и бортом — ЩЕЛЬ: она и рвёт монолит.
// У факельщика гондол нет: тяга собрана в раздутый кормовой блок — это и есть «факел».
const NO_NACELLE = { battleship: 1, dreadnought: 1, station: 1, hypercruiser: 1, corvette: 1 };
function nacelles(H, o) {
  if (o.ground || H.maxHW < 22 || NO_NACELLE[o.hull]) return '';
  // ⚠️ ПЕРЕПИСАНО (01.08). Раньше гондола и пилон заливались плоским facet() без
  // контура и без градиента — на схеме это читалось как две серые ДОСКИ, приклеенные
  // к борту. Теперь они собраны тем же языком, что и корпус: градиент поперёк даёт
  // объём, чернильный кант собирает силуэт, тень сажает деталь, у пилона появилась
  // толщина и скос, а у гондолы — гранёный нос, кормовое сопло и продольный шов.
  const [yA, yB] = spanOf(H), len = yB - yA;
  const R = rails(o);
  const y0 = yA + len * 0.58, y1 = yB + len * 0.05;      // не убегают за корму далеко
  // ⚠️ Отступ считается от САМОГО ШИРОКОГО сечения на длине гондолы, а не от её
  // начала. Иначе корпус, расширяющийся к корме, накрывал гондолу секциями (они
  // рисуются позже), и от неё торчал только огрызок за кормовым срезом.
  let hwA = 0;
  for (let t = 0; t <= 1; t += 0.05) hwA = Math.max(hwA, halfAt(H, y0 + (y1 - y0) * t));
  const w = Math.max(3.0, Math.min(H.maxHW * 0.13, 7.5));  // гондола НЕ раздувается на крупном корпусе
  const gap = Math.max(2.4, H.maxHW * 0.07);
  let g = '', s = '';
  for (const sd of [-1, 1]) {
    const x = 160 + sd * (hwA + gap + w);
    const id = `hg_nc${sd < 0 ? 'l' : 'r'}_${o.uid}`, idP = id + 'p';
    g += bandGrad(id, o, sd < 0 ? x + w : x - w, sd < 0 ? x - w : x + w, o.tint, 0.10)
      + bandGrad(idP, o, 160, x, o.tint, -0.06);
    // ПИЛОН: короткая наклонная перемычка со скосом назад — растёт из бортового
    // рельса, а не приставлена встык.
    const yb = y0 + (y1 - y0) * 0.26, bh = Math.max(3.5, len * 0.040);
    const xr = 160 + sd * hwA * R.belt;
    s += solid([[xr, yb], [x, yb + bh * 0.30], [x, yb + bh], [xr, yb + bh * 0.55]], 2.4, o, `url(#${idP})`, 'pylon');
    // ГОНДОЛА: гранёный нос (три излома), параллельное тело, срез кормы.
    const p = [[x, y0], [x + w * 0.62, y0 + (y1 - y0) * 0.06], [x + w, y0 + (y1 - y0) * 0.20],
               [x + w * 0.86, y1], [x - w * 0.86, y1],
               [x - w, y0 + (y1 - y0) * 0.20], [x - w * 0.62, y0 + (y1 - y0) * 0.06]];
    s += solid(p, 3.4, o, `url(#${id})`, 'nacelle');
    // Продольный шов по гондоле — единственная линия на ней, держит длину.
    s += `<path d="M${n1(x)},${n1(y0 + (y1 - y0) * 0.16)}L${n1(x)},${n1(y1 - 4)}" stroke="${shade(o.tint, -0.34)}" stroke-width="0.7" opacity="0.6"/>`;
    // Сопло гондолы: тот же язык, что у кормовых дюз (тёмный колодец + накал).
    const ye = y1 - 2.4, rr = Math.max(1.6, w * 0.46);
    s += `<ellipse cx="${n1(x)}" cy="${n1(ye)}" rx="${n1(w * 0.8)}" ry="${n1(rr * 0.7)}" fill="#07090c" stroke="${shade(o.tint, 0.45)}" stroke-width="0.6"/>`
      + `<ellipse cx="${n1(x)}" cy="${n1(ye)}" rx="${n1(w * 0.42)}" ry="${n1(rr * 0.36)}" fill="${o.glow || '#7fe0ff'}" opacity="0.45"/>`;
  }
  return `<defs>${g}</defs>` + s;
}
// Габарит вместе с гондолами — нужен превью, чтобы они не резались рамкой.
function extent(H, o) {
  const [yA, yB] = spanOf(H), len = yB - yA;
  if (o.ground || H.maxHW < 22) return { y0: yA, y1: yB, hw: H.maxHW };
  let hwA = 0;
  for (let t = 0.58; t <= 1.05; t += 0.05) hwA = Math.max(hwA, halfAt(H, yA + len * t));
  const w = Math.max(3.0, Math.min(H.maxHW * 0.13, 7.5)), gap = Math.max(2.4, H.maxHW * 0.07);
  return { y0: yA, y1: yB + len * 0.05, hw: Math.max(H.maxHW, hwA + gap + w * 2) };
}

// ── §8. СВЕТ: мягкое AO по кромке + контактная тень ──────────
function light(H, o) {
  const p = hullPathOf(H, 1);
  return `<g clip-path="url(#${o.clip})">`
    + `<path d="${p}" fill="none" stroke="#000" stroke-width="14" stroke-linejoin="miter" opacity="0.34" style="filter:blur(6px)"/>`
    + `</g>`;
}

// ── §9. Сборка ───────────────────────────────────────────────
function norm(opt) {
  const o = Object.assign({ uid: 'h', clip: 'cnBodyClip', hull: 'destroyer', aRt: 0.4, seed: 7, detail: 1, nozzles: 1, ground: false }, opt || {});
  if (!o.tint) o.tint = tintOf(o.armorName);
  o.aRt = Math.max(0, Math.min(1, +o.aRt || 0));
  o.detail = Math.max(0, Math.min(1, o.detail == null ? 1 : +o.detail));
  return o;
}
function defs() { return ''; }                           // градиентов нет: только плоские грани
// ── §7.5 СТАНЦИЯ: она НЕ ЛЕТАЕТ ──────────────────────────────
// У ss13 нет ни двигателей, ни гондол, ни форштевня — это узел, а не корабль.
// Вместо продольной схемы: кольцевые палубы вокруг ядра, радиальные фермы и
// стыковочные шлюзы по внешнему кольцу.
function stationDeck(H, o) {
  // ── СТАНЦИЯ. Переписана с нуля (01.08): это НЕ корабль и рисуется по другой логике.
  // Что такое станция в игре: причальный узел, набитый отсеками-модулями. Значит:
  //   · двигателей, гондол и форштевня нет вовсе;
  //   · продольной схемы (хребет/палубы/корма) нет — у неё нет «носа»;
  //   · ВСЯ внутренность оставлена ПУСТОЙ под отсеки, которые рисует конструктор;
  //   · вся конструкция вынесена на периметр: силовое кольцо, причальные фермы,
  //     стыковочные шлюзы. Смотреть на неё нужно как на план палубы, а не на корабль.
  const [yA, yB] = spanOf(H), cy = (yA + yB) / 2, R = H.maxHW;
  const Rr = rails(o);
  const idR = `hg_strim_${o.uid}`, idD = `hg_sdock_${o.uid}`;
  let g = bandGrad(idR, o, 160 - R, 160 + R, o.tint, 0.10)
    + `<radialGradient id="${idD}"><stop offset="0" stop-color="${o.glow || "#7fe0ff"}" stop-opacity="0.55"/>`
    + `<stop offset="1" stop-color="${o.glow || "#7fe0ff"}" stop-opacity="0"/></radialGradient>`;
  // 1. Внутренность — тёмная пустая палуба. Здесь встанут отсеки.
  let s2 = `<path d="${hullPathOf(H, 1)}" fill="${GROOVE}"/>`;
  // 2. СИЛОВОЕ КОЛЬЦО по всему периметру: широкий обитаемый обод. Единственная
  //    сплошная конструкция станции — на нём держится всё остальное.
  const rimIn = Rr.belt - 0.16;
  const rim = hullPoly(H, 1).concat(hullPoly(H, rimIn).reverse());
  s2 += `<path d="${polyPath(hullPoly(H, 1))}" fill="url(#${idR})" data-slot="hull"/>`
    + `<path d="${polyPath(hullPoly(H, rimIn))}" fill="${GROOVE}"/>`
    + `<path d="${polyPath(hullPoly(H, rimIn))}" fill="none" stroke="#000" stroke-width="3.4" opacity="0.6" style="filter:blur(1.4px)"/>`
    + `<path d="${polyPath(hullPoly(H, rimIn))}" fill="none" stroke="${shade(o.tint, 0.55)}" stroke-width="0.6" opacity="0.3"/>`;
  // 3. Радиальные фермы: четыре, строго по осям. Держат кольцо и делят палубу на
  //    четыре сектора — по ним игроку удобно раскладывать отсеки.
  const th = 3.2;
  for (const t of [0.5]) {
    const y = yAt(H, t), hw = halfAt(H, y) * rimIn;
    s2 += solid([[160 - hw, y - th], [160 + hw, y - th], [160 + hw, y + th], [160 - hw, y + th]], 2.2, o, shade(o.tint, -0.20), "truss");
  }
  const yTop = yAt(H, 0.10), yBot = yAt(H, 0.90);
  s2 += solid([[160 - th, yTop], [160 + th, yTop], [160 + th, yBot], [160 - th, yBot]], 2.2, o, shade(o.tint, -0.20), "truss");
  // 4. ПРИЧАЛЫ: шлюз + короткая ферма наружу, по четырём сторонам. Это лицо станции.
  const dock = (x, y, ax, ay) => {
    const arm = 13, w = 4.5;
    const px = -ay, py = ax;                             // нормаль к направлению причала
    const p = [[x + px * w, y + py * w], [x + ax * arm + px * w, y + ay * arm + py * w],
               [x + ax * arm - px * w, y + ay * arm - py * w], [x - px * w, y - py * w]];
    return solid(p, 2.6, o, shade(o.tint, -0.10), "dock")
      + `<circle cx="${n1(x + ax * arm)}" cy="${n1(y + ay * arm)}" r="7" fill="url(#${idD})"/>`
      + `<circle cx="${n1(x + ax * arm)}" cy="${n1(y + ay * arm)}" r="3.2" fill="#07090c" stroke="${shade(o.tint, 0.55)}" stroke-width="0.8"/>`;
  };
  for (const t of [0.28, 0.72]) {
    const y = yAt(H, t), hw = halfAt(H, y);
    s2 += dock(160 - hw, y, -1, 0) + dock(160 + hw, y, 1, 0);
  }
  s2 += dock(160, yA, 0, -1) + dock(160, yB, 0, 1);
  return `<defs>${g}</defs>` + s2;
}
// ── §9.5 ЗАПЕКАНИЕ ───────────────────────────────────────────
// Корпус — это сотни путей с градиентами, и он НЕ МЕНЯЕТСЯ, пока игрок не тронул
// класс/подкласс/броню/двигатель. Раньше каждый кадр зума и панорамы пересобирал
// его с нуля (строки + reparse innerHTML) — отсюда фризы. Теперь готовая строка
// лежит в кэше и переиспользуется; ключ — ВСЁ, от чего зависит рисунок.
const BAKE = new Map(), BAKE_MAX = 64;
function bakeKey(tag, H, o) {
  return tag + '|' + o.hull + '|' + o.uid + '|' + o.clip + '|' + o.tint + '|' + o.aRt.toFixed(3)
    + '|' + o.nozzles + '|' + (o.ground ? 1 : 0) + '|' + (o.glow || '') + '|' + o.seed + '|' + o.detail
    + '|' + H.st.map(p => p[0] + ',' + p[1]).join(';');
}
function baked(tag, H, o, make) {
  const k = bakeKey(tag, H, o), hit = BAKE.get(k);
  if (hit != null) return hit;
  const v = make();
  if (BAKE.size >= BAKE_MAX) BAKE.delete(BAKE.keys().next().value);
  BAKE.set(k, v);
  return v;
}
function bakeClear() { BAKE.clear(); }
function body(H, opt) {
  const o = norm(opt);
  return baked('b', H, o, () => bodyRaw(H, o));
}
function bodyRaw(H, o) {
  // ВСЁ ВНУТРЕННЕЕ ОБРЕЗАЕТСЯ ПО СИЛУЭТУ. Экструзия приподнимает детали, и без
  // обрезки их боковые грани вылезали за борт «кривыми рёбрами». Снаружи силуэта
  // живут только гондолы — им так и положено.
  const clip = `hgIn_${o.uid}`;
  const cp = `<clipPath id="${clip}"><path d="${hullPathOf(H, 1)}"/></clipPath>`;
  // Станция не летает: ни гондол, ни сопел, ни форштевня — своя кольцевая схема.
  if (o.hull === 'station') return stationDeck(H, o);   // причалы торчат наружу — не обрезаем
  // Корабль. Порядок: гондолы (позади) → секции → нос → ниши → корма → броня.
  return nacelles(H, o)
    + `<defs>${cp}</defs><g clip-path="url(#${clip})">`
    + clusterDefs(o) + sections(H, o) + prow(H, o) + compose(H, o) + stern(H, o) + armor(H, o)
    + `</g>`;
}
function edge(H, opt) {
  const o = norm(opt);
  return `<path d="${hullPathOf(H, 1)}" fill="none" stroke="#000" stroke-width="1.2" stroke-linejoin="miter" opacity="0.5"/>`;
}
function shadeLayer(H, opt) { return light(H, norm(opt)); }
function hull(H, opt) { const o = norm(opt); return body(H, o) + edge(H, o); }

// ── §10. ЗАПЕЧЁННЫЙ SVG КЛАССА (карточка выбора корпуса) ─────
function preview(H, opt) {
  const o = norm(opt);
  o.uid = 'p' + o.uid; o.clip = 'hgClip_' + o.uid;
  return baked('p', H, o, () => previewRaw(H, o));
}
function previewRaw(H, o) {
  const E = extent(H, o);
  const VW = 420, VH = 210, pad = 8;
  const sc = Math.min((VW - pad * 2) / (E.y1 - E.y0), (VH - pad * 2) / (E.hw * 2));
  const gT = `translate(${(VW / 2).toFixed(2)},${(VH / 2).toFixed(2)}) scale(${sc.toFixed(4)}) rotate(90) translate(${(-160).toFixed(2)},${(-(E.y0 + E.y1) / 2).toFixed(2)})`;
  return `<svg viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img">`
    + `<rect width="${VW}" height="${VH}" fill="#080b0e"/>`
    + `<g transform="${gT}">${hull(H, o)}</g></svg>`;
}

return { body, edge, shade: shadeLayer, hull, preview, tintOf, defs, bakeClear, rails: o => rails(norm(o)),
         outlinePts, catmullPoly, polyPath, halfAt, hullPoly, hullPathOf, extent };
})();
