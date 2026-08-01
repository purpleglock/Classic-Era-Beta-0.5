// © 2025–2026 Setis241. Проприетарное ПО. См. LICENSE.
// ════════════════════════════════════════════════════════════
// HULL GEN v1 — процедурный визуализатор КОРПУСОВ (вид сверху)
// ────────────────────────────────────────────────────────────
// Тот же подход, что в TURRET GEN: корабль рисуется целиком вектором,
// НИКАКИХ растровых текстур. Всё, что видно, — геометрия:
//   §3 ОБШИВКА  — мозаика бронеплит «в разбежку» внутри силуэта;
//   §4 ПОЯС     — кольцо бронеплит по борту с фаской и швами;
//   §5 НАДСТРОЙКА — своя для каждого семейства класса (шлюп ≠ линкор ≠
//                   авианосец ≠ станция), плюс дюзовый блок кормы;
//   §6 СВЕТ     — боковой свет, AO по кромке, контактная тень.
// Геометрию корпуса (станции st) даёт конструктор — HG только КРАСИТ.
// Экспорт: window.HG
// ════════════════════════════════════════════════════════════
window.HG = (function () {
'use strict';

// ── §1. Мелочи ───────────────────────────────────────────────
const n1 = v => Math.round(v * 10) / 10;
const INK = '#080a0d';
function seedRand(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function hex2rgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); }
function rgb2hex(a) { return '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function mix(a, b, t) { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex([0, 1, 2].map(i => A[i] + (B[i] - A[i]) * t)); }
function shade(c, k) { const A = hex2rgb(c); return rgb2hex(A.map(v => k > 0 ? v + (255 - v) * k : v * (1 + k))); }

// ── §2. Геометрия (самодостаточная копия — модуль не зависит от конструктора) ──
// Контур корпуса из станций [y, полуширина]; wf — множитель полуширины.
function outlinePts(st, wf) {
  wf = wf == null ? 1 : wf;
  const R = st.map(p => [160 + p[1] * wf, p[0]]);
  const L = st.slice().reverse().map(p => [160 - p[1] * wf, p[0]]);
  return R.concat(L);
}
// Плотный сэмпл замкнутого Catmull-Rom по контрольным точкам (гладкий обвод).
function catmullPoly(pts, seg) {
  const n = pts.length; if (n < 3) return pts.map(p => p.slice());
  seg = seg || 6; const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    for (let s = 0; s < seg; s++) {
      const t = s / seg, u = 1 - t;
      out.push([u * u * u * p1[0] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * p2[0],
                u * u * u * p1[1] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * p2[1]]);
    }
  }
  return out;
}
const polyPath = poly => 'M' + poly.map(p => n1(p[0]) + ',' + n1(p[1])).join('L') + 'Z';
function axisInt(p1, p2, axis, val) { const a = axis === 'x' ? 0 : 1, t = (val - p1[a]) / ((p2[a] - p1[a]) || 1e-9); return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])]; }
// Отсечение полигона полуплоскостью по оси (Сазерленд-Ходжман, один разрез).
function clipAxis(poly, axis, val, keepGE) {
  const get = p => axis === 'x' ? p[0] : p[1], inside = p => keepGE ? get(p) >= val : get(p) <= val, out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prv = poly[(i + poly.length - 1) % poly.length], ic = inside(cur), ip = inside(prv);
    if (ic) { if (!ip) out.push(axisInt(prv, cur, axis, val)); out.push(cur); }
    else if (ip) out.push(axisInt(prv, cur, axis, val));
  }
  return out;
}
function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a) / 2; }
function bbox(p) { const xs = p.map(q => q[0]), ys = p.map(q => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
function centroid(p) { let x = 0, y = 0; p.forEach(q => { x += q[0]; y += q[1]; }); return [x / p.length, y / p.length]; }
// Полуширина корпуса в сечении y (линейно между станциями).
function halfAt(H, y) {
  const s = H.st;
  if (y <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) if (y <= s[i][0]) { const a = s[i - 1], b = s[i]; return a[1] + (b[1] - a[1]) * ((y - a[0]) / ((b[0] - a[0]) || 1)); }
  return s[s.length - 1][1];
}
// Скруглённый прямоугольник со срезанными углами (палубный блок).
function chamfRect(x, y, w, h, c) {
  c = Math.min(c, w / 2, h / 2);
  return [[x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c], [x + w - c, y + h],
          [x + c, y + h], [x, y + h - c], [x, y + c]];
}

// ── Материалы: тон обшивки от рецепта брони ──────────────────
// Ключевые слова названия брони → базовый тон металла. Цвет даёт МАТЕРИАЛ,
// а не «раскраска»: керамика светлая и матовая, композит тёмный, реактивная
// броня с рыжиной, сплавы — холодный графит.
const MATS = [
  [/керамик|ceramic/i, '#b3b6b1'],
  [/композит|composite/i, '#5d646b'],
  [/реактив|динамич/i, '#8a7663'],
  [/сталь|steel|железо/i, '#8d959c'],
  [/титан|titan/i, '#9aa3ab'],
  [/адамант|нейтрон|экзот|кристалл/i, '#7e8ba0'],
  [/нано|nano/i, '#78868a'],
];
function tintOf(name) {
  for (const [re, c] of MATS) if (re.test(String(name || ''))) return c;
  return '#8d959c';
}

// ── §3. ДЕФЫ: градиенты обшивки ──────────────────────────────
// ⚠️ ГЛАВНОЕ ПРАВИЛО ЯРУСОВ: на корпусе СТОЯТ ОРУДИЯ, и читаться должны ОНИ.
// Поэтому корпус — тёмный тихий фон (почти карбон), весь контраст отдан кромке
// брони и самим турелям. Светлая «серая жесть» под турелью убивала силуэт орудия.
function defs(o) {
  const u = o.uid, base = o.tint;
  return `<defs>`
    + `<linearGradient id="hg_skin_${u}" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0.25">`
    + `<stop offset="0" stop-color="${shade(base, -0.56)}"/><stop offset="0.45" stop-color="${shade(base, -0.70)}"/>`
    + `<stop offset="1" stop-color="${shade(base, -0.84)}"/></linearGradient>`
    + `<linearGradient id="hg_belt_${u}" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0.2">`
    + `<stop offset="0" stop-color="${shade(base, 0.28)}"/><stop offset="1" stop-color="${shade(base, -0.46)}"/></linearGradient>`
    + `<linearGradient id="hg_deck_${u}" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="0.8" y2="1">`
    + `<stop offset="0" stop-color="${shade(base, 0.34)}"/><stop offset="1" stop-color="${shade(base, -0.52)}"/></linearGradient>`
    + `</defs>`;
}

// ── §4. КОРПУС: чистая обшивка ───────────────────────────────
// Корпус НЕ засыпается плиткой: это фон, на котором работает броня. Всё, что тут
// есть, — гладкий металл, пара продольных швов, идущих ПО ОБВОДУ, и редкие
// шпангоуты. Один акцент на кадр: главный герой — бронепояс (§5).
function surfPt(H, yA, yB, u, v) {
  const y = yA + (yB - yA) * u;
  return [160 + v * halfAt(H, y), y];
}
// Линия постоянной «поперечной координаты» v — идёт вдоль корпуса, повторяя обвод.
function strakeLine(H, yA, yB, v, k) {
  const p = [];
  for (let i = 0; i <= k; i++) p.push(surfPt(H, yA, yB, i / k, v));
  return 'M' + p.map(q => n1(q[0]) + ',' + n1(q[1])).join('L');
}
function skin(H, o) {
  const ys = H.st.map(p => p[0]), yA = Math.min(...ys), yB = Math.max(...ys), len = yB - yA;
  // Швы едва намечены: это фактура, а не рисунок. Всё, что ярче — конкурент орудию.
  const engrave = d => `<path d="${d}" fill="none" stroke="#000" stroke-width="1.1" opacity="0.30"/>`
                     + `<path d="${d}" fill="none" stroke="${shade(o.tint, 0.5)}" stroke-width="0.5" opacity="0.06" transform="translate(-0.4,0.7)"/>`;
  let out = '';
  for (const v of [-0.55, 0.55]) out += engrave(strakeLine(H, yA, yB, v, 44));   // два продольных шва, не четыре
  const nFr = Math.max(2, Math.round(len / 96));                                 // шпангоуты — редкие
  for (let f = 1; f < nFr; f++) {
    const y = yA + len * f / nFr, hw = halfAt(H, y) * 0.8;
    if (hw < 6) continue;
    out += engrave(`M${n1(160 - hw)},${n1(y)}L${n1(160 + hw)},${n1(y)}`);
  }
  return `<g clip-path="url(#${o.clip})">${out}</g>`;
}

// ── §5. БРОНЯ — ГЛАВНЫЙ ОБЪЕКТ ОТРИСОВКИ ─────────────────────
// Пояс собран из ПЛИТ, уложенных вдоль обвода: каждая плита — толстая, с фаской
// по внешней кромке, стыком-впадиной с соседкой и тенью, которую она роняет на
// палубу. Класс брони виден глазом, без чтения цифр:
//   · ширина пояса и толщина плиты растут с классом;
//   · со среднего класса пояс становится ДВУХСЛОЙНЫМ (разнесённое бронирование);
//   · тон металла — от рецепта (керамика светлая, композит тёмный, и т.д.);
//   · на тяжёлых поясах по внутреннему шву появляется силовой крепёж.
function armor(H, o) {
  const total = 0.09 + 0.14 * o.aRt;                     // полная глубина пояса (доля полубимса)
  const layers = o.aRt > 0.45 ? 2 : 1;                   // разнесённое бронирование со среднего класса
  const rnd = seedRand(o.seed ^ 0x5bd1);
  const gap = layers > 1 ? total * 0.16 : 0;             // воздушный зазор между слоями
  const lw = (total - gap) / layers;
  let out = '';
  for (let l = 0; l < layers; l++) {
    const vOut = 1 - l * (lw + gap), vIn = vOut - lw;
    const O = catmullPoly(outlinePts(H.st, vOut), 4), I = catmullPoly(outlinePts(H.st, vIn), 4);
    const n = Math.min(O.length, I.length);
    // Внешний слой — крупные плиты, внутренний — вдвое чаще (набор под ним).
    const seg = Math.round((22 + o.aRt * 16) * (l ? 1.6 : 1));
    const step = Math.max(1, Math.round(n / seg));
    const body = [];
    for (let i = 0; i < n; i += step) {
      const j = Math.min(n - 1, i + step);
      const q = [O[i], O[j], I[j], I[i]];
      if (polyArea(q) < 1.5) continue;
      const jt = (rnd() - 0.5) * 0.10;
      // Тело плиты держим тёмным (фон для орудий); работает не заливка, а КРОМКА.
      const tone = l ? -0.72 : -0.52;
      body.push(
        `<path d="${polyPath(q)}" fill="${shade(o.tint, tone + jt)}" data-slot="armor"/>`
        // Единственный светлый акцент на корпусе — фаска по внешней кромке брони.
        + `<path d="M${n1(O[i][0])},${n1(O[i][1])}L${n1(O[j][0])},${n1(O[j][1])}" fill="none" stroke="${shade(o.tint, 0.72)}" stroke-width="${(0.7 + o.aRt * 0.7).toFixed(2)}" opacity="${l ? 0.16 : 0.46}"/>`
        + `<path d="M${n1(O[i][0])},${n1(O[i][1])}L${n1(I[i][0])},${n1(I[i][1])}" fill="none" stroke="#000" stroke-width="0.9" opacity="${l ? 0.4 : 0.6}"/>`
      );
    }
    out += body.join('');
    // Внутренняя кромка слоя: плита стоит НАД палубой и роняет на неё тень.
    const seam = polyPath(I);
    out += `<path d="${seam}" fill="none" stroke="#000" stroke-width="${(1.4 + 2.4 * o.aRt).toFixed(1)}" opacity="${l ? 0.4 : 0.55}" stroke-linejoin="round" style="filter:blur(1.1px)"/>`
         + `<path d="${seam}" fill="none" stroke="${shade(o.tint, 0.5)}" stroke-width="0.6" opacity="0.22" stroke-linejoin="round"/>`;
    // Силовой крепёж по внутреннему шву — только у тяжёлых поясов и только на внешнем слое.
    // Крепёж не рисуем: заклёпки читаются как «WWII» и спорят с орудиями.
  }
  return `<g clip-path="url(#${o.clip})">${out}</g>`;
}

// ── §6. НАДСТРОЙКА: своя для каждого семейства класса ─────────
const FAM = {
  corvette: 'slim', frigate: 'slim', destroyer: 'slim',
  cruiser: 'mid', hypercruiser: 'mid',
  battleship: 'cap', dreadnought: 'cap',
  carrier: 'deck', assault: 'deck',
  station: 'hub',
};
function famOf(k) { return FAM[k] || null; }

// Направление света для экструзий (как в TURRET GEN): свет сверху-слева.
const LIGHT = { x: -0.5, y: -0.86 };
const shiftPts = (pts, dx, dy) => pts.map(p => [p[0] + dx, p[1] + dy]);
function insetPts(pts, d) {
  const c = centroid(pts), b = bbox(pts), r = Math.max(1, Math.max(b[2] - b[0], b[3] - b[1]) / 2);
  const k = Math.max(0, 1 - d / r);
  return pts.map(p => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]);
}
// Объёмная деталь на палубе: падающая тень, боковые грани экструзии, фаска, верх.
function solid(pts, h, o) {
  const dx = -LIGHT.x * h * 0.7, dy = -LIGHT.y * h * 0.7;
  const base = o.tint;
  let s = `<path d="${polyPath(shiftPts(pts, dx * 1.6, dy * 1.6))}" fill="#000" opacity="0.34" style="filter:blur(1.2px)"/>`;
  const n = pts.length, top = shiftPts(pts, dx, dy);
  for (let i = 0; i < n; i++) {                          // боковины: своя яркость по нормали к свету
    const p = pts[i], q = pts[(i + 1) % n];
    const ex = q[0] - p[0], ey = q[1] - p[1], L = Math.hypot(ex, ey) || 1;
    const nx = ey / L, ny = -ex / L;
    const lit = Math.max(0, nx * LIGHT.x + ny * LIGHT.y);
    s += `<path d="${polyPath([p, q, [q[0] + dx, q[1] + dy], [p[0] + dx, p[1] + dy]])}" fill="${shade(base, -0.72 + lit * 0.34)}" stroke="${INK}" stroke-width="0.4" stroke-opacity="0.6" stroke-linejoin="round"/>`;
  }
  s += `<path d="${polyPath(top)}" fill="${shade(base, -0.30)}" stroke="${INK}" stroke-width="0.6" stroke-opacity="0.8" stroke-linejoin="round" data-slot="deck"/>`;
  s += `<path d="${polyPath(insetPts(top, Math.max(1, h * 0.5)))}" fill="${shade(base, -0.14)}" stroke="none" opacity="0.85"/>`;   // фаска
  s += `<path d="${polyPath(insetPts(top, Math.max(1, h * 0.5)))}" fill="none" stroke="${shade(base, 0.55)}" stroke-width="0.5" opacity="0.22"/>`;
  return s;
}

function deck(H, o) {
  const fam = famOf(o.hull); if (!fam) return '';
  const nose = H.nose, ey = H.engine[1], span = ey - nose;
  const at = t => nose + span * t;
  const hw = y => halfAt(H, y);
  // ОБЪЁМНЫЙ БЛОК: тень → боковины экструзии → фаска → верхняя грань. Ровно тот же
  // приём, что делает орудия в оружейной верфи «железными», а не аппликацией.
  const g = (pts, lvl) => solid(pts, 2.6 + 2.2 * (lvl || 0), o);
  const box = (t0, t1, wk, lvl) => {
    const ya = at(t0), yb = at(t1), w = Math.min(hw((ya + yb) / 2) * wk, 34);
    return g(chamfRect(160 - w, ya, w * 2, yb - ya, Math.min(w * 0.5, 5)), lvl);
  };
  // БАРБЕТ главного калибра: круглый погон, выступающий над палубой (объёмом).
  const ring = (t, r) => {
    const y = at(t), pts = [];
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; pts.push([160 + Math.cos(a) * r, y + Math.sin(a) * r]); }
    return solid(pts, 3.4, o)
      + `<circle cx="160" cy="${n1(y - 2.4)}" r="${n1(r * 0.5)}" fill="#0b0e12" opacity="0.8"/>`;
  };
  // Мачта-пилон: узкий высокий блок с растяжками (объём + контурные штанги).
  const mast = t => {
    const y = at(t);
    return solid([[157.6, y - 8], [162.4, y - 8], [163.4, y + 5], [156.6, y + 5]], 6.5, o)
      + `<line x1="160" y1="${n1(y - 12)}" x2="160" y2="${n1(y + 5)}" stroke="${shade(o.tint, 0.45)}" stroke-width="0.7" opacity="0.4"/>`;
  };
  let s = '';
  if (fam === 'slim') {
    s += box(0.30, 0.60, 0.34, 0) + box(0.36, 0.52, 0.20, 1) + mast(0.33);
  } else if (fam === 'mid') {
    s += box(0.26, 0.62, 0.36, 0) + box(0.33, 0.53, 0.22, 1) + mast(0.28);
    s += ring(0.24, 8) + ring(0.74, 8);
  } else if (fam === 'cap') {
    // Цитадель: три яруса + барбеты главного калибра нос/корма.
    s += box(0.24, 0.66, 0.42, 0) + box(0.30, 0.58, 0.28, 1) + box(0.36, 0.50, 0.16, 2) + mast(0.31);
    s += ring(0.16, 13) + ring(0.20, 9) + ring(0.78, 13) + ring(0.84, 9);
  } else if (fam === 'deck') {
    // Полётная палуба во всю длину + остров у правого борта + катапульты.
    const ya = at(0.08), yb = at(0.94), w = Math.min(H.maxHW * 0.72, 60);
    s += `<path d="${polyPath(chamfRect(160 - w, ya, w * 2, yb - ya, 9))}" fill="${shade(o.tint, -0.52)}" fill-opacity="0.8" stroke="${INK}" stroke-width="0.8" stroke-opacity="0.7" data-slot="deck"/>`;
    s += `<line x1="160" y1="${n1(ya + 6)}" x2="160" y2="${n1(yb - 6)}" stroke="${shade(o.tint, 0.55)}" stroke-width="1" stroke-dasharray="7 7" opacity="0.35"/>`;
    // Угловая палуба (косой участок) — узнаваемый признак авианосца.
    s += `<path d="${polyPath([[160 - w, at(0.30)], [160 - w * 0.2, at(0.10)], [160 - w * 0.2, at(0.16)], [160 - w * 0.72, at(0.34)]])}" fill="none" stroke="${shade(o.tint, 0.5)}" stroke-width="0.9" opacity="0.3"/>`;
    for (const t of [0.16, 0.24]) s += `<line x1="${n1(160 - w * 0.75)}" y1="${n1(at(t))}" x2="${n1(160 + w * 0.75)}" y2="${n1(at(t))}" stroke="${shade(o.tint, 0.45)}" stroke-width="0.7" opacity="0.22"/>`;
    const ix = 160 + w * 0.66;
    s += g(chamfRect(ix - 7, at(0.38), 14, span * 0.20, 3), 0) + g(chamfRect(ix - 4, at(0.42), 8, span * 0.09, 2), 1);
    s += `<path d="M${n1(ix)},${n1(at(0.36))} L${n1(ix + 2.5)},${n1(at(0.30))} L${n1(ix - 2.5)},${n1(at(0.30))} Z" fill="${shade(o.tint, 0.2)}" stroke="${INK}" stroke-width="0.5"/>`;
  } else if (fam === 'hub') {
    // Станция: концентрические кольца палуб + стыковочные фермы.
    const cy = at(0.5), R = H.maxHW;
    [0.86, 0.62, 0.38].forEach((r, i) => { s += `<circle cx="160" cy="${n1(cy)}" r="${n1(R * r)}" fill="none" stroke="${shade(o.tint, 0.3 - i * 0.1)}" stroke-width="${(1.4 - i * 0.3).toFixed(1)}" opacity="0.34"/>`; });
    s += g(chamfRect(160 - R * 0.24, cy - R * 0.24, R * 0.48, R * 0.48, R * 0.1), 1);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.4;
      s += `<line x1="${n1(160 + Math.cos(a) * R * 0.4)}" y1="${n1(cy + Math.sin(a) * R * 0.4)}" x2="${n1(160 + Math.cos(a) * R * 0.9)}" y2="${n1(cy + Math.sin(a) * R * 0.9)}" stroke="${shade(o.tint, 0.24)}" stroke-width="1.6" opacity="0.32"/>`;
    }
  }
  return `<g clip-path="url(#${o.clip})">${s}</g>`;
}

// Кормовой машинный блок: поперечная переборка + гнёзда дюз.
function sternBay(H, o) {
  if (o.ground) return '';
  const ey = H.engine[1], y = ey - Math.min(26, (ey - H.nose) * 0.09);
  const w = halfAt(H, y) * 0.9;
  const nz = Math.max(1, Math.min(6, o.nozzles | 0 || 1));
  let s = `<path d="${polyPath(chamfRect(160 - w, y, w * 2, ey - y, 4))}" fill="${shade(o.tint, -0.5)}" fill-opacity="0.85" stroke="${INK}" stroke-width="0.7" stroke-opacity="0.7" data-slot="deck"/>`;
  const span = Math.min(w * 0.78, 6 + nz * 4), r = Math.min(5.5, (2 * span) / (nz * 2.4) || 5.5);
  for (let i = 0; i < nz; i++) {
    const fx = nz === 1 ? 160 : 160 - span + 2 * span * i / (nz - 1);
    s += `<circle cx="${n1(fx)}" cy="${n1((y + ey) / 2)}" r="${n1(Math.max(2.2, r))}" fill="#0c0f13" stroke="${shade(o.tint, 0.3)}" stroke-width="0.8" opacity="0.9"/>`;
  }
  return `<g clip-path="url(#${o.clip})">${s}</g>`;
}

// ── §7. СВЕТ: объём цилиндра, AO по кромке, контактная тень ──
function light(H, o, hullPath) {
  const x0 = n1(160 - H.maxHW), x1 = n1(160 + H.maxHW);
  return `<linearGradient id="hg_lit_${o.uid}" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${x1}" y2="0">`
    + `<stop offset="0" stop-color="#fff" stop-opacity="0.10"/><stop offset="0.40" stop-color="#fff" stop-opacity="0"/>`
    + `<stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.26"/></linearGradient>`
    + `<g clip-path="url(#${o.clip})">`
    + `<path d="${hullPath}" fill="url(#hg_lit_${o.uid})"/>`
    + `<path d="${hullPath}" fill="none" stroke="#000" stroke-width="16" stroke-linejoin="round" opacity="0.40" style="filter:blur(7px)"/>`
    + `<path d="${hullPath}" fill="none" stroke="#000" stroke-width="4" stroke-linejoin="round" opacity="0.5" style="filter:blur(1.5px)"/>`
    + `</g>`;
}

// ── §8. Сборка корпуса ───────────────────────────────────────
// opt: { uid, clip, hull, aRt(0..1), tint|armorName, seed, detail, nozzles, ground }
// clip — id уже объявленного clipPath по силуэту (его делает вызывающий).
function norm(opt) {
  const o = Object.assign({ uid: 'h', clip: 'cnBodyClip', hull: 'destroyer', aRt: 0.4, seed: 7, detail: 1, nozzles: 1, ground: false }, opt || {});
  if (!o.tint) o.tint = tintOf(o.armorName);
  o.aRt = Math.max(0, Math.min(1, +o.aRt || 0));
  o.detail = Math.max(0, Math.min(1, o.detail == null ? 1 : +o.detail));
  o.seed = (o.seed >>> 0) || 7;
  return o;
}
// ── §7.5 ГРАНЁНЫЙ СОСТАВНОЙ КОРПУС ───────────────────────────
// Корабль перестаёт быть одним сглаженным блобом. Он собран из ЧАСТЕЙ, между
// которыми есть ПУСТОТА — именно она, а не покраска, даёт узнаваемый силуэт:
//   · гранёное тело — продольные фасеты, каждая своим тоном по своей нормали
//     (плоское затенение, как на гранёном металле, а не мыльный градиент);
//   · клин форштевня — отдельная светлая грань;
//   · вынесенные пилоны с ЩЕЛЬЮ между ними и бортом;
//   · кластер гондол за кормой — оторван от корпуса тёмным зазором.
// Обвод БЕЗ сглаживания: прямые рёбра = механика, кривые = камешек.
function hullPoly(H, wf) { return outlinePts(H.st, wf == null ? 1 : wf); }
function hullPathOf(H, wf) { return polyPath(hullPoly(H, wf)); }
const yAt = (H, t) => { const ys = H.st.map(p => p[0]), a = Math.min(...ys), b = Math.max(...ys); return a + (b - a) * t; };

// Плоское затенение грани: тон СТУПЕНЬКОЙ по нормали, без градиента.
// Свет идёт слева-сверху → левый борт светлее, правый уходит в тень.
function facetFill(tint, v) {
  const lit = -v;                                        // v<0 — левый борт
  const step = Math.round((lit + 1) * 2.5) / 2.5 - 1;     // квантование → чёткие грани
  return shade(tint, -0.66 + step * 0.20);
}
// Продольная фасета: одна длинная грань от носа до кормы, БЕЗ поперечных стыков.
function facetStrip(H, v0, v1) {
  const a = H.st.map(s => [160 + v1 * s[1], s[0]]);
  const b = H.st.slice().reverse().map(s => [160 + v0 * s[1], s[0]]);
  return a.concat(b);
}
function facets(H, o) {
  const bands = [-1, -0.72, -0.38, 0, 0.38, 0.72, 1];
  let s = '';
  for (let i = 0; i < bands.length - 1; i++) {
    const v0 = bands[i], v1 = bands[i + 1], vm = (v0 + v1) / 2;
    const p = facetStrip(H, v0, v1);
    if (polyArea(p) < 4) continue;
    // Без обводки: грань отделяется от соседней ТОЛЬКО перепадом тона.
    s += `<path d="${polyPath(p)}" fill="${facetFill(o.tint, vm)}" shape-rendering="crispEdges" data-slot="hull"/>`;
  }
  return s;
}
// Клин форштевня: острая светлая грань поверх носовой части.
function prow(H, o) {
  const ys = H.st.map(p => p[0]), y0 = Math.min(...ys);
  const yb = yAt(H, 0.22), hw = halfAt(H, yb) * 0.62;
  const p = [[160, y0], [160 + hw, yb], [160, yb + (yb - y0) * 0.22], [160 - hw, yb]];
  return `<path d="${polyPath(p)}" fill="${shade(o.tint, -0.40)}" stroke="#000" stroke-width="0.8" stroke-opacity="0.6" stroke-linejoin="miter"/>`
    + `<path d="M${n1(160)},${n1(y0)}L${n1(160 - hw)},${n1(yb)}" fill="none" stroke="${shade(o.tint, 0.75)}" stroke-width="0.8" opacity="0.3"/>`;
}
// ВЫНЕСЕННЫЕ ПИЛОНЫ: стреловидные плиты, отставленные от борта ЩЕЛЬЮ.
// Щель — главный приём: она рвёт монолит и делает силуэт узнаваемым.
function pylons(H, o) {
  if (o.ground) return '';
  const t0 = 0.44, t1 = 0.76;
  const ya = yAt(H, t0), yb = yAt(H, t1);
  const hwA = halfAt(H, ya), hwB = halfAt(H, yb);
  if (hwA < 10) return '';
  const gap = 3.2, out = Math.max(10, H.maxHW * 0.42);
  let s = '';
  for (const sd of [-1, 1]) {
    // Стреловидность: передняя кромка уходит назад, задняя — короче.
    const p = [
      [160 + sd * (hwA + gap), ya],
      [160 + sd * (hwA + gap + out), ya + (yb - ya) * 0.46],
      [160 + sd * (hwA + gap + out * 0.86), yb - (yb - ya) * 0.10],
      [160 + sd * (hwB + gap), yb],
    ];
    s += `<path d="${polyPath(p)}" fill="${facetFill(o.tint, sd * 0.8)}" stroke="#000" stroke-width="0.9" stroke-opacity="0.7" stroke-linejoin="miter" data-slot="pylon"/>`
      + `<path d="M${n1(p[0][0])},${n1(p[0][1])}L${n1(p[1][0])},${n1(p[1][1])}" fill="none" stroke="${shade(o.tint, 0.75)}" stroke-width="0.8" opacity="${sd < 0 ? 0.34 : 0.14}"/>`;
  }
  return s;
}
// КЛАСТЕР ГОНДОЛ: блоки за кормой, оторванные от корпуса тёмным зазором.
// ── ГОНДОЛЫ: кормовой двигательный блок ──────────────────────
// Они дают силуэту характер, но ТОЛЬКО если посажены на место: идут ВДОЛЬ кормовой
// части борта, выходят за срез кормы и связаны с корпусом короткой перемычкой.
// Висящие в пустоте коробки (как было) читаются как мусор. Заливка — фасетами,
// без обводок: линии дробят корабль и ломают ощущение масштаба.
function nacelles(H, o) {
  if (o.ground) return '';
  const ys = H.st.map(p => p[0]), yN = Math.min(...ys), yS = Math.max(...ys), len = yS - yN;
  const n = o.nozzles >= 3 ? 4 : 2;                      // тяжёлая ходовая — четыре гондолы
  const y0 = yN + len * 0.66;                            // начинаются в кормовой трети
  const y1 = yS + len * 0.10;                            // и выходят за срез кормы
  const hwA = halfAt(H, y0), hwS = halfAt(H, yS - 2);
  const w = Math.max(3.4, H.maxHW * 0.17);               // полуширина гондолы
  const gap = Math.max(2.4, H.maxHW * 0.09);             // ЩЕЛЬ борт↔гондола — она и даёт силуэт
  let s = '';
  const pods = n === 4
    ? [[-1, hwA + gap + w], [-1, (hwA + gap + w) * 0.44], [1, (hwA + gap + w) * 0.44], [1, hwA + gap + w]]
    : [[-1, hwA + gap + w], [1, hwA + gap + w]];
  for (const [sd, dx] of pods) {
    const x = 160 + sd * dx;
    const inner = Math.abs(dx) < hwA;                    // внутренняя пара сидит на самой корме
    const yy0 = inner ? yS - len * 0.06 : y0;
    // Перемычка к борту — гондола не висит в воздухе.
    if (!inner) {
      const yb = yy0 + (y1 - yy0) * 0.34, bh = Math.max(3, len * 0.035);
      s += `<path d="${polyPath([[160 + sd * (hwA - 1), yb], [x, yb], [x, yb + bh], [160 + sd * (hwA - 1), yb + bh]])}" fill="${facetFill(o.tint, sd * 0.9)}" data-slot="pylon"/>`;
    }
    // Тело гондолы: скошенный нос, ровные борта, срез сопла.
    const p = [[x - w * 0.55, yy0], [x + w * 0.55, yy0], [x + w, yy0 + (y1 - yy0) * 0.22],
               [x + w * 0.86, y1], [x - w * 0.86, y1], [x - w, yy0 + (y1 - yy0) * 0.22]];
    s += `<path d="${polyPath(p)}" fill="${facetFill(o.tint, (x - 160) / (H.maxHW || 1))}" data-slot="nacelle"/>`
      + `<path d="${polyPath([[x - w * 0.86, y1], [x + w * 0.86, y1], [x + w * 0.7, y1 - 3.2], [x - w * 0.7, y1 - 3.2]])}" fill="#07090c" opacity="0.92"/>`;
  }
  return s;
}

// Слои корпуса БЕЗ окантовки (её и тень рисует вызывающий — чтобы декаль и
// прочие свои слои можно было вложить между обшивкой и светотенью).
function body(H, opt) {
  const o = norm(opt);
  // ⚠️ ВНУТРИ СИЛУЭТА НЕ РИСУЕТСЯ НИ ОДНОЙ ЛИНИИ (правило от 01.08). Ни швов, ни
  // шпангоутов, ни клина, ни крыльев, ни гондол: любой штрих внутри читался как
  // мусор и спорил с орудиями, которые на корпусе стоят. Форму держат ТОЛЬКО
  // тональные фасеты (границы граней = перепад тона, а не обводка) и броня по борту.
  return defs(o)
    + nacelles(H, o)                                     // кормовой двигательный блок на пилонах
    + facets(H, o)                                       // гранёное тело: перепады тона без линий
    + armor(H, o);                                       // БРОНЯ: пояс по борту
}
// Окантовка силуэта: тёмный обжим + тонкая линия сборки.
function edge(H, opt) {
  const o = norm(opt);
  const hullPath = hullPathOf(H, 1);
  const sw = (1.2 + o.aRt * 1.6).toFixed(1);
  return `<path d="${hullPath}" fill="none" stroke="#000" stroke-width="${(+sw + 1.2).toFixed(1)}" stroke-linejoin="round" opacity="0.45"/>`
    + `<path d="${hullPath}" fill="none" stroke="${shade(o.tint, 0.5)}" stroke-width="0.9" stroke-linejoin="round" opacity="0.5"/>`;
}
function shadeLayer(H, opt) {
  const o = norm(opt);
  return light(H, o, hullPathOf(H, 1));
}
// Всё сразу (корпус + светотень + кант) — для превью и простых вызовов.
function hull(H, opt) {
  const o = norm(opt);
  return body(H, o) + shadeLayer(H, o) + edge(H, o);
}

// ── §9. ЗАПЕЧЁННЫЙ SVG КЛАССА (карточка выбора корпуса) ──────
// Готовая картинка: корабль лежит горизонтально носом вправо, вписан в бокс.
function preview(H, opt) {
  const o = norm(opt);
  const uid = 'p' + o.uid;
  o.uid = uid; o.clip = 'hgClip_' + uid;
  const ys = H.st.map(p => p[0]), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const len = y1 - y0, beam = H.maxHW * 2;
  const VW = 400, VH = 200, pad = 10;
  const sc = Math.min((VW - pad * 2) / len, (VH - pad * 2) / beam);
  const hullPath = hullPathOf(H, 1);
  const gT = `translate(${(VW / 2).toFixed(2)},${(VH / 2).toFixed(2)}) scale(${sc.toFixed(4)}) rotate(90) translate(${(-160).toFixed(2)},${(-(y0 + y1) / 2).toFixed(2)})`;
  return `<svg viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img">`
    + `<defs><pattern id="hgGrid_${uid}" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0v24" fill="none" stroke="#3a444d" stroke-width="0.5" opacity="0.5"/></pattern>`
    + `<clipPath id="${o.clip}"><path d="${hullPath}"/></clipPath></defs>`
    + `<rect width="${VW}" height="${VH}" fill="url(#hgGrid_${uid})" opacity="0.45"/>`
    + `<g transform="${gT}">`
    + `<path d="${hullPath}" fill="#000" opacity="0.35" style="filter:blur(6px)"/>`
    + hull(H, o)
    + `</g></svg>`;
}

return { body, edge, shade: shadeLayer, hull, preview, tintOf, defs, famOf, hullPoly, hullPathOf,
         outlinePts, catmullPoly, polyPath, halfAt };
})();
