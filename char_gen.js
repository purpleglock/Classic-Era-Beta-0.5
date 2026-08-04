// © 2025–2026 Setis241. Проприетарное ПО. См. LICENSE.
// ════════════════════════════════════════════════════════════
// CHAR GEN v1 — процедурный ПОРТРЕТ ОПЕРАТИВНИКА (снимок из личного дела)
// ────────────────────────────────────────────────────────────
// ЯЗЫК ОТРИСОВКИ: реалистичная светопись, а не контурный рисунок.
//   §A СВЕТ    — ключ сверху-сбоку, холодный контровой с обратной стороны,
//                тусклая заливка. Объём держат ТОЛЬКО перепады тона.
//   §B КОЖА    — база + подповерхностное рассеивание (тёплые размытые пятна)
//                + микрорельеф (feTurbulence → feSpecularLighting).
//   §C ГЛАЗА   — главный носитель реализма: тень верхнего века на яблоке,
//                волокна радужки, лимбальное кольцо, влажный блик, ресничный край.
//   §D ГРАДЕ   — сверху фотообработка: зерно, развёртка, виньетка, потеря
//                насыщенности в тенях. Она же прячет векторную стерильность.
// ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: обводок, «мультяшных» заливок, плоских пятен,
// симметрии (лицо всегда асимметрично — это и читается как живое).
// Экспорт: window.CG
// ════════════════════════════════════════════════════════════
window.CG = (function () {
'use strict';

// ── §1. Мелочи ───────────────────────────────────────────────
const n1 = v => Math.round(v * 10) / 10;
const cl = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

function mulberry(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5; let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str) { let h = 2166136261; for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// HSL → hex. Цвет кожи задаём в HSL: так тон/насыщенность крутятся ползунками.
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s = cl(s, 0, 100) / 100; l = cl(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

// Гладкий замкнутый контур через точки (Catmull-Rom → кубические безье).
// Лицо — это кривые; ломаная читается как камень, а не как череп.
function smoothClosed(pts) {
  const n = pts.length; if (n < 3) return '';
  let d = 'M' + n1(pts[0][0]) + ',' + n1(pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += 'C' + n1(p1[0] + (p2[0] - p0[0]) / 6) + ',' + n1(p1[1] + (p2[1] - p0[1]) / 6)
       + ' ' + n1(p2[0] - (p3[0] - p1[0]) / 6) + ',' + n1(p2[1] - (p3[1] - p1[1]) / 6)
       + ' ' + n1(p2[0]) + ',' + n1(p2[1]);
  }
  return d + 'Z';
}
// Гладкая незамкнутая линия (веки, губы, гребни).
function smoothOpen(pts) {
  const n = pts.length; if (n < 2) return '';
  let d = 'M' + n1(pts[0][0]) + ',' + n1(pts[0][1]);
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    d += 'C' + n1(p1[0] + (p2[0] - p0[0]) / 6) + ',' + n1(p1[1] + (p2[1] - p0[1]) / 6)
       + ' ' + n1(p2[0] - (p3[0] - p1[0]) / 6) + ',' + n1(p2[1] - (p3[1] - p1[1]) / 6)
       + ' ' + n1(p2[0]) + ',' + n1(p2[1]);
  }
  return d;
}

// ── §2. Расы ─────────────────────────────────────────────────
// Каждая раса — это НЕ отдельный рисунок, а набор смещений одной и той же
// машины: пропорции черепа, тип покрова, тип глаза, надстройка (гребень/усики).
// substrate — зеркало _spy_race_class (1 позвоночные · 2 экзотика-органика
// · 3 камень · 4 машины · 5 энергия); от него считается шов легенды.
const RACES = {
  'Гуманоиды': {
    key: 'human', substrate: 1, skin: 'flesh', eye: 'human', mouth: 'lips', nose: 'human',
    skull: { w: 104, h: 300, cheek: 0.93, jaw: 0.76, brow: 0.30, crown: 1.00 },
    hue: [22, 34], sat: [16, 34], lit: [30, 66], crest: 'hair',
    iris: ['#4a5f52', '#5c4a35', '#3c4d64', '#6b5a44', '#2f3b46'],
  },
  'Млекопитающие': {
    key: 'mammal', substrate: 1, skin: 'fur', eye: 'human', mouth: 'muzzle', nose: 'muzzle',
    skull: { w: 110, h: 296, cheek: 1.00, jaw: 0.86, brow: 0.36, crown: 0.96 },
    hue: [26, 40], sat: [22, 40], lit: [24, 58], crest: 'ears',
    iris: ['#8a6a2e', '#6b4a22', '#3f5a3a', '#7a5230'],
  },
  'Рептилоиды': {
    key: 'reptile', substrate: 1, skin: 'scale', eye: 'slit', mouth: 'jaws', nose: 'slit',
    skull: { w: 96, h: 322, cheek: 0.88, jaw: 0.80, brow: 0.44, crown: 0.90 },
    hue: [78, 128], sat: [18, 38], lit: [22, 46], crest: 'ridge',
    iris: ['#b8a13c', '#c07a28', '#8fb03a', '#c9b64a'],
  },
  'Авианы (Птицеподобные)': {
    key: 'avian', substrate: 1, skin: 'feather', eye: 'round', mouth: 'beak', nose: 'none',
    skull: { w: 92, h: 292, cheek: 0.84, jaw: 0.60, brow: 0.24, crown: 1.06 },
    hue: [200, 232], sat: [12, 30], lit: [30, 62], crest: 'plume',
    iris: ['#d8a33a', '#c86a2a', '#e0c860', '#9fb8d8'],
  },
  'Инсектоиды': {
    key: 'insect', substrate: 2, skin: 'chitin', eye: 'compound', mouth: 'mandible', nose: 'none',
    skull: { w: 98, h: 300, cheek: 0.86, jaw: 0.66, brow: 0.20, crown: 1.02 },
    hue: [16, 46], sat: [24, 46], lit: [16, 40], crest: 'antenna',
    iris: ['#7a2f18', '#3f5220', '#1f3a4a', '#5a3a12'],
  },
  'Акватики (Водные)': {
    key: 'aqua', substrate: 2, skin: 'wet', eye: 'abyss', mouth: 'lips', nose: 'slit',
    skull: { w: 100, h: 306, cheek: 0.90, jaw: 0.70, brow: 0.22, crown: 1.02 },
    hue: [168, 208], sat: [16, 36], lit: [26, 54], crest: 'fin',
    iris: ['#101820', '#16242c', '#0d1a24'],
  },
  'Плантоиды (Растениевидные)': {
    key: 'plant', substrate: 2, skin: 'bark', eye: 'glow', mouth: 'seam', nose: 'none',
    skull: { w: 100, h: 310, cheek: 0.92, jaw: 0.74, brow: 0.30, crown: 0.98 },
    hue: [58, 104], sat: [14, 34], lit: [22, 48], crest: 'leaf',
    iris: ['#9fd070', '#c8d860', '#7ab850'],
  },
  'Литоиды (Каменные)': {
    key: 'lithoid', substrate: 3, skin: 'stone', eye: 'glow', mouth: 'seam', nose: 'none',
    skull: { w: 112, h: 296, cheek: 1.02, jaw: 0.94, brow: 0.50, crown: 0.92 },
    hue: [18, 40], sat: [4, 16], lit: [18, 44], crest: 'shard',
    iris: ['#e08a3a', '#d85a2a', '#e8b040'],
  },
  'Синтетики / Киборги': {
    key: 'synth', substrate: 4, skin: 'metal', eye: 'lens', mouth: 'vent', nose: 'none',
    skull: { w: 100, h: 300, cheek: 0.90, jaw: 0.80, brow: 0.34, crown: 0.98 },
    hue: [200, 224], sat: [4, 14], lit: [26, 56], crest: 'plate',
    iris: ['#4ec8e0', '#e05a3a', '#c8e050', '#8a7ae0'],
  },
  'Энергетические сущности': {
    key: 'energy', substrate: 5, skin: 'plasma', eye: 'void', mouth: 'none', nose: 'none',
    skull: { w: 98, h: 302, cheek: 0.90, jaw: 0.68, brow: 0.18, crown: 1.04 },
    hue: [186, 286], sat: [40, 70], lit: [34, 58], crest: 'halo',
    iris: ['#ffffff', '#cfe8ff', '#ffd8a8'],
  },
};
const RACE_LIST = Object.keys(RACES);

// Перк оперативника → что видно на снимке (зеркало ecPerk).
const PERKS = {
  infiltrator: { label: 'Внедрённый', gear: 'collar' },
  saboteur:    { label: 'Диверсант',  gear: 'rig' },
  ghost:       { label: 'Призрак',    gear: 'hood' },
  analyst:     { label: 'Аналитик',   gear: 'optic' },
  handler:     { label: 'Куратор',    gear: 'none' },
};

// ── §3. Параметры облика ─────────────────────────────────────
// Портрет = вот этот объект. ~200 байт JSON, никакого Storage.
function defaults(race, gender, seed) {
  race = RACES[race] ? race : 'Гуманоиды';
  const R = RACES[race], rnd = mulberry(seed >>> 0);
  const male = gender === 'муж.';
  const agender = gender === 'агендер' || !gender;
  return {
    race, gender: gender || 'агендер', seed: seed >>> 0,
    hue: Math.round(lerp(R.hue[0], R.hue[1], rnd())),
    sat: Math.round(lerp(R.sat[0], R.sat[1], rnd())),
    lit: Math.round(lerp(R.lit[0], R.lit[1], rnd())),
    // Половой диморфизм: челюсть/бровь тяжелее у «муж.», у агендера — середина.
    jaw:   Math.round(lerp(male ? 52 : agender ? 44 : 30, male ? 88 : agender ? 74 : 60, rnd())),
    brow:  Math.round(lerp(male ? 52 : agender ? 42 : 26, male ? 92 : agender ? 76 : 58, rnd())),
    cheek: Math.round(rnd() * 100),
    eyeSize: Math.round(lerp(male ? 34 : 46, male ? 66 : 82, rnd())),
    eyeGap:  Math.round(rnd() * 100),
    noseW:   Math.round(lerp(male ? 44 : 30, male ? 86 : 68, rnd())),
    mouthW:  Math.round(rnd() * 100),
    age:     Math.round(lerp(14, 62, rnd())),
    crest:   Math.round(rnd() * 100),
    iris:    R.iris[Math.floor(rnd() * R.iris.length)],
    asym:    Math.round(lerp(28, 78, rnd())),   // асимметрия: 0 = маска, 100 = живое лицо
    perk: 'handler', scars: 0, light: 34,
  };
}

// ── §4. Череп ────────────────────────────────────────────────
// Строим ПРАВУЮ половину по опорным точкам, зеркалим ЛЕВУЮ с расхождением.
// Расхождение (asym) — не баг: идеально симметричное лицо мозг читает как маску.
function skullPts(p) {
  const R = RACES[p.race], S = R.skull, rnd = mulberry(p.seed ^ 0x9e37);
  const cx = 256, top = 320 - S.h * S.crown * 0.5 - 30, H = S.h;
  const chin = top + H;
  const w = S.w;
  const cheekK = S.cheek * lerp(0.90, 1.10, p.cheek / 100);
  const jawK   = S.jaw   * lerp(0.82, 1.16, p.jaw / 100);
  const a = (p.asym / 100) * 0.055;                      // до 5.5% расхождения сторон

  // Профиль правой стороны: [доля высоты, доля полуширины].
  // Пропорции по канону головы: глаза на середине высоты, свод черепа шире,
  // подбородок ТУПОЙ. Острый клин снизу мгновенно читается как эльф из иконки.
  const prof = [
    [0.000, 0.14], [0.035, 0.52], [0.095, 0.84], [0.175, 0.97],
    [0.290, 1.00], [0.410, 0.985], [0.520, cheekK], [0.630, cheekK * 0.95],
    [0.735, jawK], [0.830, jawK * 0.90], [0.910, jawK * 0.72], [0.968, jawK * 0.46],
  ];
  const right = prof.map(q => [cx + w * q[1] * (1 + (rnd() - 0.5) * a * 2), top + H * q[0]]);
  const left = prof.slice().reverse().map(q => [cx - w * q[1] * (1 - (rnd() - 0.5) * a * 2), top + H * q[0]]);
  const pts = [[cx, top]].concat(right).concat([[cx + w * jawK * 0.16, chin], [cx - w * jawK * 0.16, chin]]).concat(left);

  return { pts, cx, top, chin, H, w, jawK, cheekK,
    browY: top + H * (0.410 + S.brow * 0.016),
    eyeY:  top + H * 0.470,
    noseY: top + H * 0.635,
    mouthY: top + H * 0.760 };
}

// ── §5. Покров: микрорельеф и подповерхностное рассеивание ────
// Ключ к «не-вектору»: поверхность обязана иметь ЗЕРНО и БЛИК. Плоская заливка
// мгновенно читается как иконка, сколько её ни тонируй.
const SURFACE = {
  //            частота  рельеф  блеск  резкость блика
  flesh:   { f: 0.85, disp: 1.6, spec: 0.42, exp: 22, oct: 4 },
  fur:     { f: 1.30, disp: 3.0, spec: 0.22, exp: 12, oct: 5 },
  scale:   { f: 0.16, disp: 3.4, spec: 0.80, exp: 34, oct: 2 },
  feather: { f: 0.55, disp: 2.4, spec: 0.40, exp: 18, oct: 4 },
  chitin:  { f: 0.30, disp: 1.8, spec: 1.30, exp: 46, oct: 2 },
  wet:     { f: 0.60, disp: 1.2, spec: 1.60, exp: 60, oct: 3 },
  bark:    { f: 0.09, disp: 5.0, spec: 0.20, exp: 10, oct: 4 },
  stone:   { f: 0.20, disp: 4.4, spec: 0.30, exp: 14, oct: 3 },
  metal:   { f: 0.05, disp: 0.6, spec: 1.80, exp: 70, oct: 1 },
  plasma:  { f: 1.10, disp: 2.2, spec: 0.10, exp: 8,  oct: 5 },
};

function surfaceDefs(id, kind, seed, lightX) {
  const S = SURFACE[kind] || SURFACE.flesh;
  return `
  <filter id="${id}-relief" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${S.f} ${S.f * 1.15}" numOctaves="${S.oct}" seed="${seed % 9999}" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="${S.disp}" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feSpecularLighting in="n" surfaceScale="${S.disp * 0.9}" specularConstant="${S.spec}" specularExponent="${S.exp}" lighting-color="#fff" result="s">
      <feDistantLight azimuth="${lightX}" elevation="58"/>
    </feSpecularLighting>
    <feComposite in="s" in2="d" operator="in" result="s2"/>
    <feComposite in="s2" in2="d" operator="arithmetic" k1="0" k2="1" k3="0.55" k4="0"/>
  </filter>`;
}

// ── §6. Фотообработка ────────────────────────────────────────
// Снимок из дела: холодные тени, тёплые света, зерно, потеря контраста.
function gradeDefs(id, seed) {
  return `
  <filter id="${id}-grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="${(seed + 7) % 9999}"/>
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer><feFuncA type="linear" slope="0.5" intercept="-0.16"/></feComponentTransfer>
  </filter>
  <!-- Лестница размытий. КЛЮЧЕВОЕ: светотень лица живёт на радиусах 16–60px.
       На малых радиусах те же самые пятна читаются как грязь, а не как объём. -->
  <filter id="${id}-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter>
  <filter id="${id}-b6"   x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="${id}-b16"  x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="16"/></filter>
  <filter id="${id}-b34"  x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="34"/></filter>
  <filter id="${id}-b60"  x="-90%" y="-90%" width="280%" height="280%"><feGaussianBlur stdDeviation="60"/></filter>
  <filter id="${id}-bloom" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
    <feGaussianBlur stdDeviation="9" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`;
}

// ── §7. Глаз ─────────────────────────────────────────────────
// Самый дорогой по вниманию узел. Порядок слоёв неслучаен:
// впадина → яблоко → тень века на яблоке → радужка с волокнами → лимб →
// зрачок → влажный блик → нижнее веко (свет) → ресничный край (тень).
function eyeGroup(id, p, G, side) {
  const R = RACES[p.race], rnd = mulberry(p.seed ^ (side > 0 ? 0x1111 : 0x2222));
  const gap = lerp(0.30, 0.44, p.eyeGap / 100);
  const ex = G.cx + side * G.w * gap;
  const ey = G.eyeY + (side > 0 ? 0 : (p.asym / 100) * 2.4);   // одна глазница выше
  const ew = G.w * lerp(0.20, 0.30, p.eyeSize / 100) * (side > 0 ? 1 : 1 - p.asym / 1400);
  const eh = ew * (R.eye === 'round' ? 0.92 : R.eye === 'abyss' ? 0.86 : R.eye === 'slit' ? 0.52 : 0.58);
  const irisR = eh * (R.eye === 'abyss' ? 1.02 : 0.86);
  const open = R.eye === 'slit' ? 0.86 : 1;

  // Впадина глазницы — мягкая тень, без неё глаз «наклеен».
  let s = `<ellipse cx="${n1(ex)}" cy="${n1(ey - eh * 0.15)}" rx="${n1(ew * 1.5)}" ry="${n1(eh * 1.9)}" fill="url(#${id}-socket)"/>`;

  if (R.eye === 'lens' || R.eye === 'glow' || R.eye === 'void') {
    // Неорганика: не глаз, а излучатель. Свет идёт ИЗ формы, а не падает на неё.
    const c = R.eye === 'void' ? '#ffffff' : p.iris;
    const rr = eh * (R.eye === 'lens' ? 0.9 : 0.7);
    s += `<g filter="url(#${id}-bloom)">
      <ellipse cx="${n1(ex)}" cy="${n1(ey)}" rx="${n1(ew * (R.eye === 'lens' ? 0.72 : 0.52))}" ry="${n1(rr)}" fill="${c}" opacity=".95"/>
    </g>`;
    if (R.eye === 'lens') {
      s += `<ellipse cx="${n1(ex)}" cy="${n1(ey)}" rx="${n1(ew * 0.78)}" ry="${n1(eh * 0.98)}" fill="none" stroke="#0a0d10" stroke-width="3" opacity=".8"/>`
         + `<ellipse cx="${n1(ex)}" cy="${n1(ey)}" rx="${n1(ew * 0.5)}" ry="${n1(rr * 0.62)}" fill="none" stroke="#0a0d10" stroke-width="1.4" opacity=".5"/>`
         + `<ellipse cx="${n1(ex - ew * 0.22)}" cy="${n1(ey - rr * 0.36)}" rx="${n1(ew * 0.16)}" ry="${n1(rr * 0.2)}" fill="#fff" opacity=".65"/>`;
    }
    return s;
  }

  if (R.eye === 'compound') {
    // Фасеточный: сотовая сетка + один общий блик по куполу.
    s += `<ellipse cx="${n1(ex)}" cy="${n1(ey)}" rx="${n1(ew * 1.15)}" ry="${n1(eh * 1.7)}" fill="${p.iris}"/>`
       + `<ellipse cx="${n1(ex)}" cy="${n1(ey)}" rx="${n1(ew * 1.15)}" ry="${n1(eh * 1.7)}" fill="url(#${id}-hex)" opacity=".55"/>`
       + `<ellipse cx="${n1(ex)}" cy="${n1(ey)}" rx="${n1(ew * 1.15)}" ry="${n1(eh * 1.7)}" fill="url(#${id}-domeLit)"/>`
       + `<ellipse cx="${n1(ex - ew * 0.42)}" cy="${n1(ey - eh * 0.78)}" rx="${n1(ew * 0.3)}" ry="${n1(eh * 0.34)}" fill="#fff" opacity=".5" filter="url(#${id}-soft)"/>`;
    return s;
  }

  // ── Органический глаз ──
  const lidTop = [[ex - ew, ey + eh * 0.10], [ex - ew * 0.5, ey - eh * open], [ex + ew * 0.2, ey - eh * 0.94 * open], [ex + ew, ey + eh * 0.16]];
  const lidBot = [[ex + ew, ey + eh * 0.16], [ex + ew * 0.3, ey + eh * 1.02], [ex - ew * 0.5, ey + eh * 0.94], [ex - ew, ey + eh * 0.10]];
  const aperture = smoothOpen(lidTop) + smoothOpen(lidBot).replace(/^M[^C]*/, 'L') + 'Z';
  const clip = `${id}-eye${side > 0 ? 'R' : 'L'}`;

  s += `<clipPath id="${clip}"><path d="${aperture}"/></clipPath>`;
  s += `<g clip-path="url(#${clip})">`;
  // Склера — никогда не белая. Серая с розовиной у слёзника.
  s += `<rect x="${n1(ex - ew * 1.2)}" y="${n1(ey - eh * 1.4)}" width="${n1(ew * 2.4)}" height="${n1(eh * 2.8)}" fill="url(#${id}-sclera)"/>`;
  // Тень от верхнего века НА яблоко — без неё глаз плоский, это главный трюк.
  s += `<ellipse cx="${n1(ex)}" cy="${n1(ey - eh * 1.15)}" rx="${n1(ew * 1.3)}" ry="${n1(eh * 1.05)}" fill="#0a0f14" opacity=".55" filter="url(#${id}-soft)"/>`;

  const ix = ex + (side > 0 ? -1 : -1) * ew * 0.06;
  if (R.eye === 'abyss') {
    s += `<ellipse cx="${n1(ix)}" cy="${n1(ey)}" rx="${n1(irisR * 1.35)}" ry="${n1(irisR * 1.35)}" fill="#080c10"/>`
       + `<ellipse cx="${n1(ix - irisR * 0.4)}" cy="${n1(ey - irisR * 0.5)}" rx="${n1(irisR * 0.3)}" ry="${n1(irisR * 0.22)}" fill="#cfe4f0" opacity=".8"/>`;
  } else {
    s += `<circle cx="${n1(ix)}" cy="${n1(ey)}" r="${n1(irisR)}" fill="${p.iris}"/>`;
    // Волокна радужки — 44 штриха разной яркости. Дешёвая, но очень сильная деталь.
    let fib = '';
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2 + rnd() * 0.1;
      const r0 = irisR * lerp(0.26, 0.44, rnd()), r1 = irisR * lerp(0.82, 0.99, rnd());
      fib += `<line x1="${n1(ix + Math.cos(a) * r0)}" y1="${n1(ey + Math.sin(a) * r0)}" x2="${n1(ix + Math.cos(a) * r1)}" y2="${n1(ey + Math.sin(a) * r1)}" stroke="${rnd() > 0.5 ? '#ffffff' : '#000000'}" stroke-width="${n1(lerp(0.5, 1.3, rnd()))}" opacity="${n1(lerp(0.06, 0.3, rnd()))}"/>`;
    }
    s += fib;
    s += `<circle cx="${n1(ix)}" cy="${n1(ey)}" r="${n1(irisR)}" fill="url(#${id}-irisSh)"/>`;
    // Лимбальное кольцо — тёмный ободок радужки. Взгляд «собирается» только с ним.
    s += `<circle cx="${n1(ix)}" cy="${n1(ey)}" r="${n1(irisR * 0.96)}" fill="none" stroke="#080b0e" stroke-width="${n1(irisR * 0.13)}" opacity=".72"/>`;
    if (R.eye === 'slit') {
      s += `<ellipse cx="${n1(ix)}" cy="${n1(ey)}" rx="${n1(irisR * 0.14)}" ry="${n1(irisR * 0.82)}" fill="#07090b"/>`;
    } else {
      s += `<circle cx="${n1(ix)}" cy="${n1(ey)}" r="${n1(irisR * 0.42)}" fill="#07090b"/>`;
    }
  }
  // Влажный блик: один яркий + один слабый с теневой стороны (отражение заливки).
  s += `<circle cx="${n1(ix - irisR * 0.42)}" cy="${n1(ey - irisR * 0.46)}" r="${n1(irisR * 0.22)}" fill="#fff" opacity=".92"/>`
     + `<circle cx="${n1(ix + irisR * 0.38)}" cy="${n1(ey + irisR * 0.3)}" r="${n1(irisR * 0.1)}" fill="#cfe0ea" opacity=".38"/>`;
  s += `</g>`;
  // Ресничный край — тень, а не линия: толстая размытая дуга по верхнему веку.
  s += `<path d="${smoothOpen(lidTop)}" fill="none" stroke="#0a0d11" stroke-width="${n1(eh * 0.3)}" stroke-linecap="round" opacity=".85" filter="url(#${id}-soft)"/>`;
  // Нижнее веко — не линия, а СВЕТЯЩИЙСЯ валик кожи под глазом.
  s += `<path d="${smoothOpen(lidBot)}" fill="none" stroke="#ffffff" stroke-width="${n1(eh * 0.16)}" opacity=".16" filter="url(#${id}-soft)"/>`;
  // Складка верхнего века.
  s += `<path d="${smoothOpen(lidTop.map(q => [q[0], q[1] - eh * 0.55]))}" fill="none" stroke="#000" stroke-width="${n1(eh * 0.14)}" opacity=".26" filter="url(#${id}-soft)"/>`;
  return s;
}

// ── §8. Нос / рот ────────────────────────────────────────────
// Ни нос, ни губы НЕ обводятся. Нос = две ноздревые тени + блик спинки.
// Рот = линия смыкания (тень) + тень под нижней губой + блик на нижней.
function noseGroup(id, p, G) {
  const R = RACES[p.race];
  if (R.nose === 'none') return '';
  const nw = G.w * lerp(0.13, 0.24, p.noseW / 100);
  const ny = G.noseY, cx = G.cx + (p.asym / 100) * 1.6;
  if (R.nose === 'slit') {
    return `<ellipse cx="${n1(cx - nw * 0.45)}" cy="${n1(ny)}" rx="${n1(nw * 0.16)}" ry="${n1(nw * 0.34)}" fill="#000" opacity=".62" filter="url(#${id}-soft)"/>`
         + `<ellipse cx="${n1(cx + nw * 0.45)}" cy="${n1(ny)}" rx="${n1(nw * 0.16)}" ry="${n1(nw * 0.34)}" fill="#000" opacity=".62" filter="url(#${id}-soft)"/>`;
  }
  let s = '';
  // Спинка носа: узкий вертикальный блик + тень с теневой стороны.
  s += `<ellipse cx="${n1(cx - nw * 0.22)}" cy="${n1(ny - nw * 1.5)}" rx="${n1(nw * 0.3)}" ry="${n1(nw * 1.7)}" fill="#fff" opacity=".13" filter="url(#${id}-soft)"/>`;
  s += `<ellipse cx="${n1(cx + nw * 0.46)}" cy="${n1(ny - nw * 1.3)}" rx="${n1(nw * 0.34)}" ry="${n1(nw * 1.6)}" fill="#000" opacity=".20" filter="url(#${id}-soft)"/>`;
  // Кончик — светлое пятно, ниже него тень.
  s += `<ellipse cx="${n1(cx)}" cy="${n1(ny - nw * 0.16)}" rx="${n1(nw * 0.46)}" ry="${n1(nw * 0.36)}" fill="#fff" opacity=".16" filter="url(#${id}-soft)"/>`;
  s += `<ellipse cx="${n1(cx)}" cy="${n1(ny + nw * 0.36)}" rx="${n1(nw * 0.72)}" ry="${n1(nw * 0.26)}" fill="#000" opacity=".30" filter="url(#${id}-soft)"/>`;
  // Ноздри.
  s += `<ellipse cx="${n1(cx - nw * 0.56)}" cy="${n1(ny + nw * 0.1)}" rx="${n1(nw * 0.2)}" ry="${n1(nw * 0.15)}" fill="#0a0c0e" opacity=".8"/>`
     + `<ellipse cx="${n1(cx + nw * 0.56)}" cy="${n1(ny + nw * 0.1)}" rx="${n1(nw * 0.2)}" ry="${n1(nw * 0.15)}" fill="#0a0c0e" opacity=".8"/>`;
  return s;
}

function mouthGroup(id, p, G) {
  const R = RACES[p.race];
  if (R.mouth === 'none') return '';
  const mw = G.w * lerp(0.22, 0.38, p.mouthW / 100);
  const my = G.mouthY, cx = G.cx;
  if (R.mouth === 'vent' || R.mouth === 'seam') {
    let s = `<path d="${smoothOpen([[cx - mw, my - 2], [cx, my + 3], [cx + mw, my - 2]])}" fill="none" stroke="#06080a" stroke-width="3.4" opacity=".8"/>`;
    if (R.mouth === 'vent') for (let i = -3; i <= 3; i++)
      s += `<rect x="${n1(cx + i * mw * 0.24 - 1.4)}" y="${n1(my - 7)}" width="2.8" height="14" rx="1.2" fill="#06080a" opacity=".55"/>`;
    return s;
  }
  if (R.mouth === 'beak') {
    const bl = mw * 1.5;
    return `<path d="${smoothClosed([[cx - mw * 0.62, my - bl * 0.5], [cx + mw * 0.62, my - bl * 0.5], [cx + mw * 0.2, my + bl * 0.42], [cx, my + bl * 0.6], [cx - mw * 0.2, my + bl * 0.42]])}" fill="url(#${id}-beak)"/>`
         + `<path d="${smoothOpen([[cx - mw * 0.56, my - bl * 0.06], [cx, my + bl * 0.1], [cx + mw * 0.56, my - bl * 0.06]])}" fill="none" stroke="#0a0c0e" stroke-width="2.6" opacity=".7"/>`
         + `<ellipse cx="${n1(cx - mw * 0.2)}" cy="${n1(my - bl * 0.22)}" rx="${n1(mw * 0.14)}" ry="${n1(bl * 0.2)}" fill="#fff" opacity=".28" filter="url(#${id}-soft)"/>`;
  }
  if (R.mouth === 'mandible') {
    let s = '';
    for (const sd of [-1, 1]) s += `<path d="${smoothOpen([[cx + sd * mw * 0.3, my - 12], [cx + sd * mw * 1.0, my + 6], [cx + sd * mw * 0.5, my + 26]])}" fill="none" stroke="url(#${id}-mand)" stroke-width="${n1(mw * 0.26)}" stroke-linecap="round"/>`;
    s += `<ellipse cx="${n1(cx)}" cy="${n1(my + 2)}" rx="${n1(mw * 0.3)}" ry="${n1(mw * 0.2)}" fill="#06080a" opacity=".85"/>`;
    return s;
  }
  if (R.mouth === 'jaws') {
    let s = `<path d="${smoothOpen([[cx - mw * 1.05, my - 6], [cx, my + 6], [cx + mw * 1.05, my - 6]])}" fill="none" stroke="#06080a" stroke-width="4" opacity=".85"/>`;
    for (let i = -4; i <= 4; i++) if (i)
      s += `<path d="M${n1(cx + i * mw * 0.2)},${n1(my + 2)} l2.6,0 l-1.3,6 Z" fill="#e8e2d0" opacity=".5"/>`;
    return s;
  }
  // Губы: линия смыкания сильнее всего, дальше объём.
  const seam = [[cx - mw, my - 1], [cx - mw * 0.4, my + 2.4], [cx, my + 1], [cx + mw * 0.4, my + 2.4], [cx + mw, my - 1]];
  let s = `<path d="${smoothOpen(seam.map(q => [q[0], q[1] - mw * 0.34]))}" fill="none" stroke="#000" stroke-width="${n1(mw * 0.2)}" opacity=".16" filter="url(#${id}-soft)"/>`;
  s += `<ellipse cx="${n1(cx)}" cy="${n1(my + mw * 0.34)}" rx="${n1(mw * 0.62)}" ry="${n1(mw * 0.22)}" fill="#fff" opacity=".14" filter="url(#${id}-soft)"/>`;
  s += `<ellipse cx="${n1(cx)}" cy="${n1(my + mw * 0.62)}" rx="${n1(mw * 0.8)}" ry="${n1(mw * 0.2)}" fill="#000" opacity=".26" filter="url(#${id}-soft)"/>`;
  s += `<path d="${smoothOpen(seam)}" fill="none" stroke="#1a0f10" stroke-width="${n1(mw * 0.11)}" stroke-linecap="round" opacity=".78"/>`;
  return s;
}

// ── §9. Надстройка (гребень / волосы / усики) ────────────────
function crestGroup(id, p, G, behind) {
  const R = RACES[p.race], rnd = mulberry(p.seed ^ 0x5a5a);
  const t = p.crest / 100, cx = G.cx, top = G.top, w = G.w;
  let s = '';
  switch (R.crest) {
    case 'hair': {
      if (!behind) return '';
      // Масса, а не пряди: крупный силуэт + несколько световых полос по форме.
      const len = lerp(0.10, 0.62, t);
      const pts = [[cx, top - 16], [cx + w * 1.08, top + G.H * 0.18], [cx + w * 1.0, top + G.H * len],
                   [cx, top + G.H * (len + 0.06)], [cx - w * 1.0, top + G.H * len], [cx - w * 1.08, top + G.H * 0.18]];
      s += `<path d="${smoothClosed(pts)}" fill="url(#${id}-hair)"/>`;
      for (let i = 0; i < 7; i++) {
        const a = -0.9 + i * 0.3;
        s += `<path d="${smoothOpen([[cx + Math.sin(a) * w * 0.3, top - 6], [cx + Math.sin(a) * w * 0.9, top + G.H * 0.2], [cx + Math.sin(a) * w * 0.95, top + G.H * len * 0.9]])}" fill="none" stroke="#fff" stroke-width="${n1(lerp(2, 7, rnd()))}" opacity="${n1(lerp(0.03, 0.11, rnd()))}" filter="url(#${id}-soft)"/>`;
      }
      return s;
    }
    case 'ears': {
      if (!behind) return '';
      for (const sd of [-1, 1]) {
        const bx = cx + sd * w * 0.86, by = top + G.H * 0.20;
        s += `<path d="${smoothClosed([[bx, by], [bx + sd * w * 0.34, by - G.H * lerp(0.10, 0.20, t)], [bx + sd * w * 0.5, by + G.H * 0.06], [bx + sd * w * 0.1, by + G.H * 0.12]])}" fill="url(#${id}-hair)"/>`;
      }
      return s;
    }
    case 'ridge': {
      if (behind) return '';
      for (let i = 0; i < 5; i++) {
        const yy = top + G.H * (0.02 + i * 0.055), hw = w * (0.22 + i * 0.1) * lerp(0.7, 1.2, t);
        s += `<ellipse cx="${n1(cx)}" cy="${n1(yy)}" rx="${n1(hw)}" ry="${n1(G.H * 0.020)}" fill="#fff" opacity=".10" filter="url(#${id}-soft)"/>`
           + `<ellipse cx="${n1(cx)}" cy="${n1(yy + G.H * 0.022)}" rx="${n1(hw)}" ry="${n1(G.H * 0.016)}" fill="#000" opacity=".24" filter="url(#${id}-soft)"/>`;
      }
      return s;
    }
    case 'plume': {
      if (!behind) return '';
      for (let i = 0; i < 9; i++) {
        const a = -1.25 + i * 0.31, L = G.H * lerp(0.14, 0.36, t) * lerp(0.7, 1.1, rnd());
        s += `<path d="${smoothOpen([[cx, top + 12], [cx + Math.sin(a) * L * 0.7, top - L * 0.5], [cx + Math.sin(a) * L * 1.25, top - L]])}" fill="none" stroke="url(#${id}-hair)" stroke-width="${n1(lerp(5, 13, rnd()))}" stroke-linecap="round"/>`;
      }
      return s;
    }
    case 'antenna': {
      if (!behind) return '';
      for (const sd of [-1, 1]) {
        const L = G.H * lerp(0.18, 0.40, t);
        s += `<path d="${smoothOpen([[cx + sd * w * 0.34, top + 14], [cx + sd * w * 0.7, top - L * 0.6], [cx + sd * w * 1.25, top - L]])}" fill="none" stroke="url(#${id}-hair)" stroke-width="6" stroke-linecap="round"/>`
           + `<circle cx="${n1(cx + sd * w * 1.25)}" cy="${n1(top - L)}" r="5" fill="url(#${id}-hair)"/>`;
      }
      return s;
    }
    case 'fin': {
      if (!behind) return '';
      const L = G.H * lerp(0.12, 0.30, t);
      s += `<path d="${smoothClosed([[cx, top - L], [cx + w * 0.5, top + G.H * 0.12], [cx, top + G.H * 0.06], [cx - w * 0.5, top + G.H * 0.12]])}" fill="url(#${id}-hair)" opacity=".9"/>`;
      return s;
    }
    case 'leaf': {
      if (!behind) return '';
      for (let i = 0; i < 7; i++) {
        const a = -1.15 + i * 0.38, L = G.H * lerp(0.16, 0.34, t) * lerp(0.75, 1.15, rnd());
        s += `<ellipse cx="${n1(cx + Math.sin(a) * L * 0.9)}" cy="${n1(top - Math.cos(a) * L * 0.55)}" rx="${n1(L * 0.16)}" ry="${n1(L * 0.5)}" transform="rotate(${n1(a * 57)} ${n1(cx + Math.sin(a) * L * 0.9)} ${n1(top - Math.cos(a) * L * 0.55)})" fill="url(#${id}-hair)"/>`;
      }
      return s;
    }
    case 'shard': {
      if (!behind) return '';
      for (let i = 0; i < 6; i++) {
        const a = -1.1 + i * 0.44, L = G.H * lerp(0.10, 0.28, t) * lerp(0.6, 1.2, rnd());
        const bx = cx + Math.sin(a) * w * 0.7, by = top + G.H * 0.06 - Math.cos(a) * 20;
        s += `<path d="M${n1(bx - 12)},${n1(by)} L${n1(bx + Math.sin(a) * L)},${n1(by - L)} L${n1(bx + 12)},${n1(by)} Z" fill="url(#${id}-hair)"/>`;
      }
      return s;
    }
    case 'plate': {
      if (behind) return '';
      const L = G.H * lerp(0.04, 0.12, t);
      s += `<path d="${smoothOpen([[cx - w * 0.9, top + G.H * 0.14], [cx, top + L * 0.2], [cx + w * 0.9, top + G.H * 0.14]])}" fill="none" stroke="#0a0e12" stroke-width="3" opacity=".7"/>`;
      for (const sd of [-1, 1]) s += `<path d="${smoothOpen([[cx + sd * w * 0.2, top + G.H * 0.05], [cx + sd * w * 0.4, top + G.H * 0.32]])}" fill="none" stroke="#0a0e12" stroke-width="2.2" opacity=".55"/>`;
      return s;
    }
    case 'halo': {
      if (!behind) return '';
      s += `<g filter="url(#${id}-bloom)"><ellipse cx="${n1(cx)}" cy="${n1(top + G.H * 0.1)}" rx="${n1(w * lerp(1.2, 1.8, t))}" ry="${n1(w * lerp(1.2, 1.8, t) * 0.34)}" fill="none" stroke="${p.iris}" stroke-width="4" opacity=".5"/></g>`;
      return s;
    }
  }
  return '';
}

// ── §10. Снаряжение по перку ─────────────────────────────────
function gearGroup(id, p, G) {
  const g = (PERKS[p.perk] || PERKS.handler).gear;
  const cx = G.cx, w = G.w;
  if (g === 'optic') {
    const ey = G.eyeY, ex = cx + w * 0.38;
    return `<g><path d="M${n1(ex - w * 0.26)},${n1(ey - 26)} h${n1(w * 0.62)} a10,10 0 0 1 10,10 v34 a10,10 0 0 1 -10,10 h${n1(-w * 0.62)} Z" fill="#11161c" opacity=".92"/>
      <ellipse cx="${n1(ex + w * 0.1)}" cy="${n1(ey)}" rx="${n1(w * 0.16)}" ry="${n1(w * 0.14)}" fill="#0a3a44"/>
      <g filter="url(#${id}-bloom)"><ellipse cx="${n1(ex + w * 0.1)}" cy="${n1(ey)}" rx="${n1(w * 0.06)}" ry="${n1(w * 0.05)}" fill="#4ee0d0" opacity=".9"/></g>
      <path d="M${n1(ex - w * 0.26)},${n1(ey - 20)} h${n1(w * 0.6)}" stroke="#fff" stroke-width="1.6" opacity=".22"/></g>`;
  }
  if (g === 'hood') {
    return `<path d="${smoothClosed([[cx, G.top - 30], [cx + w * 1.5, G.top + G.H * 0.30], [cx + w * 1.42, G.top + G.H * 1.06], [cx, G.top + G.H * 1.1], [cx - w * 1.42, G.top + G.H * 1.06], [cx - w * 1.5, G.top + G.H * 0.30]])}" fill="url(#${id}-cloth)" opacity=".97"/>`
         + `<path d="${smoothClosed([[cx, G.top + 6], [cx + w * 1.12, G.top + G.H * 0.42], [cx + w * 1.0, G.top + G.H * 1.02], [cx, G.top + G.H * 1.06], [cx - w * 1.0, G.top + G.H * 1.02], [cx - w * 1.12, G.top + G.H * 0.42]])}" fill="#000" opacity=".55" filter="url(#${id}-soft)"/>`;
  }
  if (g === 'collar') {
    return `<path d="M${n1(cx - w * 1.5)},640 L${n1(cx - w * 0.72)},${n1(G.chin + 30)} L${n1(cx)},${n1(G.chin + 74)} L${n1(cx + w * 0.72)},${n1(G.chin + 30)} L${n1(cx + w * 1.5)},640 Z" fill="#161c24"/>
      <path d="M${n1(cx - w * 0.72)},${n1(G.chin + 30)} L${n1(cx)},${n1(G.chin + 74)} L${n1(cx + w * 0.72)},${n1(G.chin + 30)}" fill="none" stroke="#fff" stroke-width="1.6" opacity=".18"/>`;
  }
  if (g === 'rig') {
    return `<path d="M${n1(cx - w * 1.6)},640 L${n1(cx - w * 0.8)},${n1(G.chin + 34)} L${n1(cx + w * 0.8)},${n1(G.chin + 34)} L${n1(cx + w * 1.6)},640 Z" fill="#1a1a1e"/>
      <rect x="${n1(cx + w * 0.3)}" y="${n1(G.chin + 60)}" width="${n1(w * 0.5)}" height="26" rx="4" fill="#0e1114" stroke="#3a3f46" stroke-width="1.4"/>
      <g filter="url(#${id}-bloom)"><circle cx="${n1(cx + w * 0.42)}" cy="${n1(G.chin + 73)}" r="3.4" fill="#e05a3a"/></g>
      <path d="M${n1(cx - w * 0.7)},${n1(G.chin + 52)} L${n1(cx + w * 0.2)},${n1(G.chin + 96)}" stroke="#2a2e34" stroke-width="9"/>`;
  }
  return `<path d="M${n1(cx - w * 1.5)},640 L${n1(cx - w * 0.78)},${n1(G.chin + 32)} L${n1(cx + w * 0.78)},${n1(G.chin + 32)} L${n1(cx + w * 1.5)},640 Z" fill="#171b21"/>`;
}

// ── §11. Сборка портрета ─────────────────────────────────────
function render(p, opt) {
  opt = opt || {};
  p = Object.assign(defaults('Гуманоиды', 'агендер', 1), p);
  const R = RACES[p.race] || RACES['Гуманоиды'];
  const id = 'cg' + (hash(JSON.stringify(p)) % 100000).toString(36);
  const G = skullPts(p);
  const rnd = mulberry(p.seed ^ 0xbeef);

  // Свет: азимут ключа. 0 = слева, 100 = справа.
  const lightX = lerp(210, 330, p.light / 100);
  const kx = G.cx + (p.light / 100 - 0.5) * G.w * 2.4;

  const base = hsl(p.hue, p.sat, p.lit);
  const deep = hsl(p.hue - 6, p.sat + 12, Math.max(6, p.lit - 26));
  const lite = hsl(p.hue + 6, Math.max(4, p.sat - 8), Math.min(94, p.lit + 26));
  const sub  = hsl(p.hue - 14, Math.min(70, p.sat + 26), Math.min(70, p.lit + 6));   // подкожное
  const rim  = R.key === 'energy' ? p.iris : hsl(206, 34, 70);                        // холодный контровой
  const path = smoothClosed(G.pts);
  const age = p.age / 100;

  // Затылок/шея — на них падает тень от челюсти, это ставит голову «на плечи».
  const neck = `<path d="M${n1(G.cx - G.w * 0.5)},${n1(G.chin - 40)} L${n1(G.cx - G.w * 0.62)},${n1(G.chin + 66)} L${n1(G.cx + G.w * 0.62)},${n1(G.chin + 66)} L${n1(G.cx + G.w * 0.5)},${n1(G.chin - 40)} Z" fill="${deep}"/>
    <ellipse cx="${n1(G.cx)}" cy="${n1(G.chin + 4)}" rx="${n1(G.w * 0.8)}" ry="34" fill="#000" opacity=".62" filter="url(#${id}-soft)"/>`;

  // Морщины/возраст: носогубная складка + подглазничная, силой от p.age.
  let wrinkles = '';
  if (age > 0.3 && R.skin === 'flesh') {
    const k = (age - 0.3) / 0.7;
    for (const sd of [-1, 1]) {
      wrinkles += `<path d="${smoothOpen([[G.cx + sd * G.w * 0.24, G.noseY + 6], [G.cx + sd * G.w * 0.42, G.mouthY - 8], [G.cx + sd * G.w * 0.34, G.mouthY + 18]])}" fill="none" stroke="#000" stroke-width="${n1(3 + k * 3)}" opacity="${n1(0.10 + k * 0.20)}" filter="url(#${id}-soft)"/>`;
      wrinkles += `<path d="${smoothOpen([[G.cx + sd * G.w * 0.22, G.eyeY + 22], [G.cx + sd * G.w * 0.46, G.eyeY + 18]])}" fill="none" stroke="#000" stroke-width="${n1(2 + k * 2)}" opacity="${n1(0.06 + k * 0.14)}" filter="url(#${id}-soft)"/>`;
    }
    for (let i = 0; i < Math.round(k * 3); i++)
      wrinkles += `<path d="${smoothOpen([[G.cx - G.w * 0.5, G.browY - 26 - i * 12], [G.cx, G.browY - 32 - i * 12], [G.cx + G.w * 0.5, G.browY - 26 - i * 12]])}" fill="none" stroke="#000" stroke-width="3" opacity="${n1(0.06 + k * 0.1)}" filter="url(#${id}-soft)"/>`;
  }

  // Шрамы — след плена. Рубец = светлая полоса + тень рядом, не «царапина».
  let scars = '';
  for (let i = 0; i < (p.scars || 0); i++) {
    const a = rnd() * Math.PI, L = lerp(30, 80, rnd());
    const sx = G.cx + (rnd() - 0.5) * G.w * 1.3, sy = lerp(G.browY, G.mouthY, rnd());
    const x2 = sx + Math.cos(a) * L, y2 = sy + Math.sin(a) * L;
    scars += `<line x1="${n1(sx)}" y1="${n1(sy)}" x2="${n1(x2)}" y2="${n1(y2)}" stroke="#000" stroke-width="4" opacity=".24" filter="url(#${id}-soft)"/>`
           + `<line x1="${n1(sx + 1.5)}" y1="${n1(sy - 1.5)}" x2="${n1(x2 + 1.5)}" y2="${n1(y2 - 1.5)}" stroke="${lite}" stroke-width="2" opacity=".42" filter="url(#${id}-soft)"/>`;
  }

  const bloomSkin = R.skin === 'plasma';

  return `<svg viewBox="0 0 512 640" xmlns="http://www.w3.org/2000/svg" class="cg-svg" preserveAspectRatio="xMidYMid slice">
  <defs>
    ${surfaceDefs(id, R.skin, p.seed, lightX)}
    ${gradeDefs(id, p.seed)}
    <radialGradient id="${id}-bg" cx="${n1(50 + (p.light / 100 - 0.5) * 60)}%" cy="34%" r="72%">
      <stop offset="0" stop-color="#243040"/><stop offset="0.5" stop-color="#101720"/><stop offset="1" stop-color="#05070a"/>
    </radialGradient>
    <radialGradient id="${id}-key" cx="${n1(kx / 512 * 100)}%" cy="26%" r="62%">
      <stop offset="0" stop-color="${lite}" stop-opacity=".95"/>
      <stop offset="0.45" stop-color="${lite}" stop-opacity=".28"/>
      <stop offset="1" stop-color="${lite}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-shadow" x1="${p.light > 50 ? '0%' : '100%'}" y1="0%" x2="${p.light > 50 ? '100%' : '0%'}" y2="30%">
      <stop offset="0" stop-color="#020407" stop-opacity=".80"/>
      <stop offset="0.42" stop-color="#020407" stop-opacity=".22"/>
      <stop offset="1" stop-color="#020407" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="${id}-sss" cx="50%" cy="62%" r="46%">
      <stop offset="0" stop-color="${sub}" stop-opacity=".42"/><stop offset="1" stop-color="${sub}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}-socket" cx="50%" cy="46%" r="50%">
      <stop offset="0" stop-color="#000" stop-opacity=".50"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-sclera" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0" stop-color="#8e939a"/><stop offset="0.4" stop-color="#c8ccd2"/><stop offset="1" stop-color="#9aa0a8"/>
    </linearGradient>
    <radialGradient id="${id}-irisSh" cx="50%" cy="30%" r="70%">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/>
    </radialGradient>
    <radialGradient id="${id}-domeLit" cx="32%" cy="24%" r="76%">
      <stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset="0.55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/>
    </radialGradient>
    <linearGradient id="${id}-hair" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0" stop-color="${hsl(p.hue, p.sat + 6, Math.max(8, p.lit - 30))}"/>
      <stop offset="1" stop-color="${hsl(p.hue, p.sat, Math.max(4, p.lit - 44))}"/>
    </linearGradient>
    <linearGradient id="${id}-beak" x1="0%" y1="0%" x2="60%" y2="100%">
      <stop offset="0" stop-color="${lite}"/><stop offset="1" stop-color="${deep}"/>
    </linearGradient>
    <linearGradient id="${id}-mand" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0" stop-color="${deep}"/><stop offset="1" stop-color="${lite}"/>
    </linearGradient>
    <linearGradient id="${id}-cloth" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0" stop-color="#1d232c"/><stop offset="1" stop-color="#0a0d12"/>
    </linearGradient>
    <pattern id="${id}-hex" width="9" height="10.4" patternUnits="userSpaceOnUse">
      <path d="M4.5,0 L9,2.6 L9,7.8 L4.5,10.4 L0,7.8 L0,2.6 Z" fill="none" stroke="#000" stroke-width="1.1" opacity=".8"/>
    </pattern>
    <radialGradient id="${id}-vig" cx="50%" cy="42%" r="72%">
      <stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".82"/>
    </radialGradient>
    <clipPath id="${id}-head"><path d="${path}"/></clipPath>
  </defs>

  <rect width="512" height="640" fill="url(#${id}-bg)"/>
  <!-- дальний план размыт: даёт глубину резкости -->
  <ellipse cx="${n1(kx)}" cy="200" rx="210" ry="180" fill="#33506e" opacity=".16" filter="url(#${id}-bloom)"/>

  <g ${bloomSkin ? `filter="url(#${id}-bloom)"` : ''}>
    ${crestGroup(id, p, G, true)}
    ${neck}
    ${gearGroup(id, p, G)}

    <!-- §A ГОЛОВА: заливка + рельеф покрова -->
    <g filter="url(#${id}-relief)"><path d="${path}" fill="${base}"/></g>

    <g clip-path="url(#${id}-head)">
      <!-- подповерхностное рассеивание: щёки/нос теплее и «просвечивают» -->
      <ellipse cx="${n1(G.cx)}" cy="${n1(G.noseY)}" rx="${n1(G.w * 0.95)}" ry="${n1(G.H * 0.26)}" fill="url(#${id}-sss)"/>
      <!-- ключевой свет -->
      <rect width="512" height="640" fill="url(#${id}-key)"/>
      <!-- теневая сторона -->
      <rect width="512" height="640" fill="url(#${id}-shadow)"/>
      <!-- ОККЛЮЗИЯ. Все радиусы крупные (b16/b34): светотень лица — это большие
           мягкие массы. На малом размытии ровно те же пятна = грязь на щеках. -->
      <!-- надбровная тень: главная «крыша» лица -->
      <ellipse cx="${n1(G.cx)}" cy="${n1(G.browY + G.H * 0.012)}" rx="${n1(G.w * 0.86)}" ry="${n1(G.H * 0.062)}" fill="#000" opacity="${n1(0.20 + 0.34 * p.brow / 100)}" filter="url(#${id}-b16)"/>
      <!-- виски: череп уходит назад -->
      <ellipse cx="${n1(G.cx - G.w * 0.92)}" cy="${n1(G.eyeY - G.H * 0.06)}" rx="${n1(G.w * 0.36)}" ry="${n1(G.H * 0.16)}" fill="#000" opacity=".34" filter="url(#${id}-b34)"/>
      <ellipse cx="${n1(G.cx + G.w * 0.92)}" cy="${n1(G.eyeY - G.H * 0.06)}" rx="${n1(G.w * 0.36)}" ry="${n1(G.H * 0.16)}" fill="#000" opacity=".34" filter="url(#${id}-b34)"/>
      <!-- впадина под скулой -->
      <ellipse cx="${n1(G.cx - G.w * 0.70)}" cy="${n1(G.mouthY - G.H * 0.055)}" rx="${n1(G.w * 0.32)}" ry="${n1(G.H * 0.10)}" fill="#000" opacity="${n1(0.12 + 0.24 * p.cheek / 100)}" filter="url(#${id}-b34)"/>
      <ellipse cx="${n1(G.cx + G.w * 0.70)}" cy="${n1(G.mouthY - G.H * 0.055)}" rx="${n1(G.w * 0.32)}" ry="${n1(G.H * 0.10)}" fill="#000" opacity="${n1(0.12 + 0.24 * p.cheek / 100)}" filter="url(#${id}-b34)"/>
      <!-- нижняя челюсть в собственной тени -->
      <ellipse cx="${n1(G.cx)}" cy="${n1(G.chin + G.H * 0.03)}" rx="${n1(G.w * 0.82)}" ry="${n1(G.H * 0.13)}" fill="#000" opacity=".46" filter="url(#${id}-b34)"/>
      <!-- СВЕТ: три опорных плана — лоб, скулы, подбородок -->
      <ellipse cx="${n1(G.cx - G.w * 0.50)}" cy="${n1(G.eyeY + G.H * 0.075)}" rx="${n1(G.w * 0.34)}" ry="${n1(G.H * 0.055)}" fill="#fff" opacity="${n1(0.07 + 0.13 * p.cheek / 100)}" filter="url(#${id}-b16)"/>
      <ellipse cx="${n1(G.cx + G.w * 0.50)}" cy="${n1(G.eyeY + G.H * 0.075)}" rx="${n1(G.w * 0.34)}" ry="${n1(G.H * 0.055)}" fill="#fff" opacity="${n1(0.07 + 0.13 * p.cheek / 100)}" filter="url(#${id}-b16)"/>
      <ellipse cx="${n1(G.cx)}" cy="${n1(G.top + G.H * 0.215)}" rx="${n1(G.w * 0.60)}" ry="${n1(G.H * 0.105)}" fill="#fff" opacity=".14" filter="url(#${id}-b34)"/>
      <ellipse cx="${n1(G.cx)}" cy="${n1(G.chin - G.H * 0.062)}" rx="${n1(G.w * 0.30)}" ry="${n1(G.H * 0.042)}" fill="#fff" opacity=".13" filter="url(#${id}-b16)"/>

      ${noseGroup(id, p, G)}
      ${eyeGroup(id, p, G, 1)}
      ${eyeGroup(id, p, G, -1)}
      ${mouthGroup(id, p, G)}
      ${crestGroup(id, p, G, false)}
      ${wrinkles}
      ${scars}
    </g>

    <!-- §B КОНТРОВОЙ: холодная кромка с теневой стороны отделяет голову от фона -->
    <g clip-path="url(#${id}-head)">
      <path d="${path}" fill="none" stroke="${rim}" stroke-width="9" opacity=".55" filter="url(#${id}-soft)"
            transform="translate(${n1((p.light > 50 ? -1 : 1) * 5)},-3)"/>
    </g>
  </g>

  <!-- §C ГРАДЕ -->
  <rect width="512" height="640" fill="url(#${id}-vig)"/>
  <rect width="512" height="640" filter="url(#${id}-grain)" opacity=".26" style="mix-blend-mode:overlay"/>
  ${opt.plain ? '' : `<rect width="512" height="640" fill="url(#${id}-scan)" opacity=".18"/>
  <pattern id="${id}-scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1.4" fill="#000" opacity=".55"/></pattern>`}
</svg>`;
}

// ── §12. Легенда (грим) и швы ────────────────────────────────
// Портрет умеет показывать НЕ истинную расу, а надетую. Чем дальше субстрат
// легенды от истинного — тем больше швов, т.е. риска раскрытия.
// Зеркало _spy_race_penalty (см. _spy_race_infiltration.sql).
const SEAM = { same: 0, sameClass: 6, orgOrg: 16, orgInorg: 34, inorgInorg: 28 };
function seamCost(trueRace, legendRace) {
  if (!trueRace || !legendRace || trueRace === legendRace) return SEAM.same;
  const a = (RACES[trueRace] || {}).substrate || 0, b = (RACES[legendRace] || {}).substrate || 0;
  if (!a || !b) return SEAM.orgOrg;
  if (a === b) return SEAM.sameClass;
  if (a <= 2 && b <= 2) return SEAM.orgOrg;
  if (a <= 2 || b <= 2) return SEAM.orgInorg;
  return SEAM.inorgInorg;
}
// Облик под легендой: череп/покров берём от легенды, глаза-«личность» тянем
// от истинной формы — именно поэтому грим и палится.
function wearLegend(p, legendRace) {
  if (!legendRace || legendRace === p.race) return Object.assign({}, p);
  const L = RACES[legendRace]; if (!L) return Object.assign({}, p);
  return Object.assign({}, p, {
    race: legendRace,
    hue: Math.round(lerp(L.hue[0], L.hue[1], 0.5)),
    sat: Math.round(lerp(L.sat[0], L.sat[1], 0.5)),
    lit: p.lit,
    iris: p.iris,
  });
}

return { RACES, RACE_LIST, PERKS, defaults, render, seamCost, wearLegend, hash, hsl };
})();
