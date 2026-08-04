// © 2025–2026 Setis241. Проприетарное ПО. См. LICENSE.
// ════════════════════════════════════════════════════════════
// CHAR GEN v5 — АНАТОМИЧЕСКОЕ ЯДРО.
// ────────────────────────────────────────────────────────────
// Отличие от v4 принципиальное. Раньше каждая фигура была списком точек,
// подобранным на глаз: форма лица — двенадцать чисел, веко — шесть, и ни одно
// из них не было связано с другим. Поэтому ползунок «челюсть» не двигал скулу,
// «размер глаза» не двигал глазницу, а раса меняла два коэффициента.
//
// Здесь рисунок НЕ задаётся, а ВЫВОДИТСЯ из трёх слоёв:
//   §5 ЧЕРЕП    — костные ориентиры (свод, лобная, скуловая дуга, глазница,
//                 грушевидное отверстие, альвеолярная дуга, ветвь и тело
//                 нижней челюсти). Всё в долях высоты черепа, имена — по
//                 краниометрии: vertex, euryon, zygion, gonion, gnathion…
//   §6 ТКАНИ    — толщина мягких тканей поверх кости, по областям: висок
//                 тонкий, жевательная мышца над ветвью, щёчный жир над дугой.
//                 Контур лица = кость + ткань, а не отдельный рисунок.
//   §7+ РИСУНОК — линии и тени ставятся ПО ориентирам: тень идёт под скуловой
//                 дугой, потому что там кость выступает, а не потому что там
//                 «красиво».
//
// Глаз (§9) — не прорезь, а глазное яблоко в глазнице: сфера радиуса gr,
// веки — края, скользящие по сфере. Отсюда само собой: верхнее веко срезает
// радужку, нижнее её касается, радужка не может быть шире яблока, а наклон
// разреза — поворот всей щели вокруг центра яблока, а не сдвиг точек.
//
// ЧТО ЗАКРЫТО И ПЕРЕПИСЫВАТЬ НЕ НАДО:
//   · ring() — склейка дуг. Команда M второй дуги вырезается ВМЕСТЕ с
//     координатами. Голое 'L' без чисел обрывало путь.
//   · Строится ТОЛЬКО правая половина, левая — зеркало группы. Никакой
//     знаковой арифметики в парных узлах.
//   · Ни одного равномерного stroke в лицевых узлах: всё — ленты с нажимом.
// Экспорт: window.CG
// ════════════════════════════════════════════════════════════
window.CG = (function () {
'use strict';

// ── §1. Мелочи ───────────────────────────────────────────────
const n1 = v => Math.round(v * 10) / 10;
const cl = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const k01 = v => cl((v || 0) / 100, 0, 1);

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

function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s = cl(s, 0, 100) / 100; l = cl(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}
const shade = (h, s, l, k) => hsl(h - 8 * k, Math.min(70, s + 12 * k), Math.max(6, l - 16 * k));
const linec = (h, s, l) => hsl(h - 6, Math.min(60, s + 16), Math.max(10, l * 0.34));

// ── §2. Кривые ───────────────────────────────────────────────
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
// Склейка двух дуг в замкнутую фигуру. M второй дуги вырезается ВМЕСТЕ с
// координатами — перо уже стоит в этой точке (см. шапку файла).
function ring(a, b) { return smoothOpen(a) + smoothOpen(b).replace(/^M[^C]*/, '') + 'Z'; }

// Линия с нажимом. Толщина — два числа (от/до) либо массив по длине.
function tstroke(pts, w0, w1) {
  const n = pts.length, L = [], R = [];
  const arr = Array.isArray(w0) ? w0 : null;
  const wAt = i => {
    if (!arr) return lerp(w0, w1, i / (n - 1));
    const u = i / (n - 1) * (arr.length - 1), j = Math.floor(u);
    return j >= arr.length - 1 ? arr[arr.length - 1] : lerp(arr[j], arr[j + 1], u - j);
  };
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
    const w = wAt(i);
    L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
    R.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  return ring(L, R.reverse());
}
function wob(pts, amp, rnd) { return pts.map(q => [q[0] + (rnd() - 0.5) * amp, q[1] + (rnd() - 0.5) * amp]); }
function blob(cx, cy, rx, ry, n, jit, rnd) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, k = 1 + (rnd() - 0.5) * jit;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return smoothClosed(pts);
}
function mirror(cx, s) { return `<g transform="matrix(-1,0,0,1,${n1(cx * 2)},0)">${s}</g>`; }
// Замкнутый симметричный контур ИЗ ОДНОГО КУСКА. Половинка + зеркало здесь не
// годится: на осевом ребре касательная смотрит вверх, кривая перелетает
// вершину, и симметричная пара даёт рога на макушке. Тут ось проходится
// насквозь, соседи вершины симметричны, касательная горизонтальна — купол.
// Вход: точки от верхней осевой до нижней осевой по ПРАВОЙ стороне.
function symClosed(cx, right) {
  const left = right.slice(1, -1).reverse().map(q => [cx * 2 - q[0], q[1]]);
  return smoothClosed(right.concat(left));
}
// Поворот точек вокруг центра — им задаётся наклон глазной щели (§9).
function rot(pts, cx, cy, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return pts.map(q => {
    const x = q[0] - cx, y = q[1] - cy;
    return [cx + x * c - y * s, cy + x * s + y * c];
  });
}

// ── §3. Кадр ─────────────────────────────────────────────────
const VW = 512, VH = 560;
const HU = 330;        // высота черепа: vertex → gnathion
const CROWN = 96;

// Уровни ориентиров в долях высоты черепа. Пропорции стилизованные
// (глазница опущена относительно анатомической нормы — свод крупнее), но
// СОГЛАСОВАННЫЕ: всё остальное считается от них, а не подбирается заново.
// ГЛАВНОЕ ПРАВИЛО: центр глазницы — на СЕРЕДИНЕ высоты головы. Когда он был
// на 0.63, лоб съедал две трети лица, и голова читалась как яйцо. Ниже —
// классический канон третей: линия волос → надбровье → основание носа →
// подбородок делят лицо на три равные части.
const CANON = {
  hairline: 0.250,  // край скальпа над лобными буграми
  glabella: 0.415,  // надпереносье, между надбровными дугами
  orbit:    0.500,  // центр глазницы — ровно середина головы
  zygion:   0.545,  // самая широкая точка скуловой дуги
  nasion:   0.435,  // корень носа
  rhinion:  0.600,  // конец носовых костей, спинка
  subnasale:0.672,  // основание перегородки, край грушевидного отверстия
  stomion:  0.775,  // линия смыкания губ
  gonion:   0.815,  // угол нижней челюсти
  gnathion: 1.000,  // низ подбородка
};

// ── §4. Расы ─────────────────────────────────────────────────
// Раса задаёт КОСТЬ (доли черепа), а не набор наклеек: ширину свода,
// вынос скулы, ширину угла челюсти, размер глазницы и грушевидного отверстия.
const RACES = {
  'Гуманоиды':                 { key: 'human',   pupil: 'round',    bone: { vault: 1.00, zyg: 1.00, gon: 1.00, orbit: 1.00, pyri: 1.00, brow: 1.00 }, skin: [26, 30, 84], iris: ['#3f7d6a', '#7a4a30', '#3a5f9a', '#8a6a2a', '#5a4a6a'] },
  'Млекопитающие':             { key: 'mammal',  pupil: 'round',    bone: { vault: 1.02, zyg: 1.05, gon: 1.06, orbit: 1.02, pyri: 1.14, brow: 1.10 }, skin: [28, 34, 82], iris: ['#b07a24', '#7a5220', '#4a7a3a', '#a0521a'] },
  'Рептилоиды':                { key: 'reptile', pupil: 'slit',     bone: { vault: 0.96, zyg: 0.96, gon: 0.92, orbit: 1.08, pyri: 0.72, brow: 1.16 }, skin: [96, 30, 70], iris: ['#c8b03a', '#d08a24', '#8fc03a'] },
  'Авианы (Птицеподобные)':    { key: 'avian',   pupil: 'round',    bone: { vault: 0.98, zyg: 0.92, gon: 0.86, orbit: 1.16, pyri: 0.78, brow: 0.90 }, skin: [212, 20, 82], iris: ['#e0a83a', '#d06a24', '#e8d060'] },
  'Инсектоиды':                { key: 'insect',  pupil: 'compound', bone: { vault: 1.04, zyg: 0.94, gon: 0.90, orbit: 1.22, pyri: 0.66, brow: 0.84 }, skin: [34, 40, 64], iris: ['#8a3418', '#4a6020', '#2a4a5a'] },
  'Акватики (Водные)':         { key: 'aqua',    pupil: 'round',    bone: { vault: 1.00, zyg: 0.96, gon: 0.94, orbit: 1.10, pyri: 0.70, brow: 0.88 }, skin: [186, 26, 78], iris: ['#2aa8c0', '#1e6a80', '#3ac0a8'] },
  'Плантоиды (Растениевидные)':{ key: 'plant',   pupil: 'round',    bone: { vault: 1.00, zyg: 0.98, gon: 0.96, orbit: 1.00, pyri: 0.88, brow: 0.92 }, skin: [84, 24, 76], iris: ['#9fd070', '#c8d860', '#7ab850'] },
  'Литоиды (Каменные)':        { key: 'lithoid', pupil: 'round',    bone: { vault: 1.08, zyg: 1.10, gon: 1.16, orbit: 0.90, pyri: 0.94, brow: 1.30 }, skin: [24, 12, 62], iris: ['#e08a3a', '#d85a2a', '#e8b040'] },
  'Синтетики / Киборги':       { key: 'synth',   pupil: 'lens',     bone: { vault: 1.00, zyg: 1.00, gon: 1.00, orbit: 1.04, pyri: 0.86, brow: 0.96 }, skin: [210, 8, 86], iris: ['#4ec8e0', '#e05a3a', '#c8e050', '#8a7ae0'] },
  'Энергетические сущности':   { key: 'energy',  pupil: 'void',     bone: { vault: 0.98, zyg: 0.94, gon: 0.92, orbit: 1.12, pyri: 0.76, brow: 0.86 }, skin: [258, 30, 74], iris: ['#ffffff', '#cfe8ff', '#ffd8a8'] },
};
const RACE_LIST = Object.keys(RACES);

// ── §4b. Параметры облика ────────────────────────────────────
// Каждый ползунок правит ОДИН костный или тканевый размер, а не рисунок.
function defaults(race, gender, seed) {
  race = RACES[race] ? race : 'Гуманоиды';
  const R = RACES[race], rnd = mulberry(seed >>> 0);
  const male = gender === 'муж.', fem = gender === 'жен.';
  const mid = (m, f, a) => male ? m : fem ? f : a;
  const near = (c, sp) => Math.round(cl(c + (rnd() - 0.5) * 2 * sp, 0, 100));
  return {
    race, gender: gender || 'агендер', seed: seed >>> 0,
    hue: Math.round(R.skin[0] + (rnd() - 0.5) * 10),
    sat: Math.round(cl(R.skin[1] + (rnd() - 0.5) * 10, 4, 70)),
    // Потолок светлоты снижен: под 90 кожа выбеливается в воск.
    lit: Math.round(cl(R.skin[2] + (rnd() - 0.5) * 14, 30, 80)),
    // КОСТЬ
    vault:  near(50, 20),               // ширина мозгового свода
    jaw:    near(mid(70, 34, 52), 16),  // разворот углов нижней челюсти
    chin:   near(mid(64, 40, 52), 18),  // выступ подбородочного бугра
    cheek:  near(mid(52, 54, 52), 20),  // вынос скуловой кости вперёд/вбок
    brow:   near(mid(66, 30, 48), 18),  // надбровная дуга
    nose:   near(mid(56, 44, 50), 20),  // грушевидное отверстие и спинка
    // ТКАНИ
    soft:   near(mid(44, 54, 50), 18),  // толщина мягких тканей (полнота)
    age:    near(mid(46, 40, 43), 20),  // ткань опускается, кость проступает
    // ГЛАЗНИЦА И ЩЕЛЬ
    eyeSize: near(mid(42, 62, 52), 14), // размер глазницы
    eyeGap:  near(50, 16),              // межглазничная ширина
    eyeTilt: near(50, 20),              // наклон глазной щели (кантальный угол)
    lips:    near(mid(40, 60, 50), 18),
    // ВОЛОСЫ
    hairHue: Math.round(lerp(18, 44, rnd())),      // от холодно-русого к золотому
    hairSat: Math.round(lerp(16, 52, rnd())),
    hairLit: Math.round(lerp(14, 66, rnd())),      // от чёрных до светлых
    hairLen: near(mid(28, 66, 50), 22),            // до скулы … ниже челюсти
    iris:  R.iris[Math.floor(rnd() * R.iris.length)],
    light: 34,
  };
}

// ── §5. ЧЕРЕП ────────────────────────────────────────────────
// Костный контур правой половины: пары [t, k] — t доля высоты черепа сверху,
// k полуширина в долях базовой ширины свода bw. Имена по краниометрии.
function skull(p) {
  const R = RACES[p.race] || RACES['Гуманоиды'], B = R.bone;
  const mat = k01(p.age);
  const cx = VW / 2, crown = CROWN;
  const H = HU * lerp(0.97, 1.05, mat);          // с возрастом лицевой отдел длиннее
  const bw = H * 0.352 * B.vault * lerp(0.94, 1.06, k01(p.vault));
  const y = f => crown + H * f;

  // Ключевые ширины. Всё остальное между ними интерполируется.
  const zyg = B.zyg * lerp(0.92, 1.08, k01(p.cheek));       // zygion
  // Челюсть шире, чем было. Узкий gonion при широком своде даёт грушу:
  // голова расширяется к темени и сходит на остриё — самый нелюдской силуэт.
  const gon = B.gon * lerp(0.76, 1.00, k01(p.jaw));         // gonion
  const men = lerp(0.40, 0.55, k01(p.jaw)) * lerp(0.94, 1.08, k01(p.chin)); // ширина подбородка

  const bone = [
    [0.000, 0.10],                       // vertex
    [0.045, 0.44],
    [0.110, 0.71],                       // лобный бугор
    [0.190, 0.870],
    [0.280, 0.945],
    [0.350, 0.965],                      // euryon — макс. ширина свода
    [0.430, 0.960],
    [0.470, 0.905],                      // височная ямка (кость западает)
    [0.508, 0.930],                      // лобно-скуловой шов
    [CANON.zygion, zyg],                 // zygion
    [0.625, zyg * 0.90],                 // скуловая дуга уходит к верхней челюсти
    [0.705, lerp(zyg * 0.86, gon, 0.55)],// ветвь нижней челюсти
    [CANON.gonion, gon],                 // gonion — угол челюсти
    [0.880, lerp(gon, men, 0.42)],       // тело челюсти
    [0.945, lerp(gon, men, 0.82)],
    [0.978, men * 1.02],                 // подбородочный бугор
    [0.996, men * 0.78],
    [1.000, men * 0.34],                 // gnathion — площадка, НЕ остриё
  ];

  // ТКАНИ. Толщина в долях bw по областям. Кость с возрастом проступает,
  // «полнота» добавляет ровно там, где у человека жир: щека и низ челюсти.
  const soft = k01(p.soft), lean = lerp(1.0, 0.72, mat);
  const T = t => {
    const fat = lerp(0.012, 0.055, soft) * lean;
    if (t < 0.28) return 0.018 + fat * 0.25;                 // скальп над сводом
    if (t < 0.50) return 0.026 + fat * 0.45;                 // височная мышца + жир
    if (t < 0.64) return 0.020 + fat * 1.00;                 // щёчный жир над дугой
    if (t < 0.80) return 0.030 + fat * 1.25;                 // жевательная мышца
    if (t < 0.96) return 0.026 + fat * 0.95 * lerp(1, 1.25, mat); // брыли к старости
    return 0.020 + fat * 0.5;
  };
  // Кожа = кость + ткань, наружу по горизонтали (корональный срез).
  const skinHalf = bone.map(([t, k]) => [t, k + T(t)]);

  const toPts = arr => arr.map(([t, k]) => [cx + bw * k, y(t)]);
  const rightSkin = toPts(skinHalf), rightBone = toPts(bone);
  // Замыкание строго на уровне gnathion: точка НИЖЕ него вытягивала остриё.
  const profR = [[cx, crown]].concat(rightSkin).concat([[cx, y(1) + T(1) * bw]]);
  const outline = profR.concat(profR.slice(1, -1).reverse().map(q => [cx * 2 - q[0], q[1]]));

  // Глазница. КАНОН ПЯТЫХ: лицо по ширине делится на пять, глаз занимает
  // вторую пятую. При полуширине bw это 0.2·bw…0.6·bw от оси, то есть щель
  // шириной 0.4·bw с центром на 0.4·bw. Отсюда и берутся числа ниже.
  const ow = bw * 0.40 * (B.orbit || 1) * lerp(0.86, 1.16, k01(p.eyeSize));
  const oh = ow * lerp(0.94, 0.84, mat);
  const iod = bw * 0.42 * lerp(0.84, 1.14, k01(p.eyeGap));   // межглазничная ширина
  const orbit = { x: cx + iod / 2 + ow / 2, y: y(CANON.orbit), w: ow, h: oh };

  // Крылья носа по ширине равны межглазничному промежутку — это тот же канон.
  const pyri = { w: bw * 0.40 * (B.pyri || 1) * lerp(0.84, 1.18, k01(p.nose)),
                 top: y(CANON.nasion), y: y(CANON.subnasale) };
  // Рот шире носа примерно в полтора раза, углы — под медиальной третью радужки.
  const alv = { w: bw * lerp(0.44, 0.60, k01(p.lips)) + iod * 0.18, y: y(CANON.stomion) };

  // Точка кости по доле высоты — по ней ставятся тени, линии и ухо.
  function boneAtRaw(t) {
    for (let i = 1; i < bone.length; i++)
      if (bone[i][0] >= t) {
        const a = bone[i - 1], b = bone[i], u = (t - a[0]) / (b[0] - a[0] || 1);
        return [cx + bw * lerp(a[1], b[1], u), y(t)];
      }
    return [cx + bw * bone[bone.length - 1][1], y(t)];
  }

  return {
    R, B, cx, crown, H, bw, mat, y, bone, skinHalf,
    rightSkin, rightBone, profR,
    path: smoothClosed(outline),
    browY: y(CANON.glabella), zygY: y(CANON.zygion), gonY: y(CANON.gonion),
    orbit, pyri, alv,
    browK: (B.brow || 1) * lerp(0.7, 1.35, k01(p.brow)),
    boneAt: boneAtRaw,
    // Та же точка, но по коже: ухо садится на поверхность, а не на кость.
    skinAt: t => { const q = boneAtRaw(t); return [q[0] + bw * T(t), q[1]]; },
  };
}
// Совместимость с прежним вызовом.
const rig = skull;

// ── §6. ТЕНИ ПО КОСТИ ────────────────────────────────────────
// Каждая тень привязана к выступу или впадине черепа, а не поставлена «на глаз».
function planes(id, p, G, C) {
  const rnd = mulberry((p.seed ^ 0x9a17) >>> 0), bw = G.bw;
  let s = '';
  // Височная ямка: кость западает между сводом и скуловой дугой.
  const t1 = G.boneAt(0.415), t2 = G.boneAt(0.470), t3 = G.boneAt(0.512);
  s += `<path d="${smoothClosed(wob([
      [t1[0] - bw * 0.02, t1[1]], [t2[0] - bw * 0.015, t2[1]], [t3[0] - bw * 0.05, t3[1]],
      [t3[0] - bw * 0.26, t3[1] - bw * 0.06], [t1[0] - bw * 0.24, t1[1] + bw * 0.04]
    ], bw * 0.02, rnd))}" fill="${C.sh1}" opacity=".22"/>`;
  // Подскуловая впадина: под дугой мышца тоньше, отсюда самая читаемая тень.
  // Это ЛЕНТА вдоль кости — пятном она читается как румяна, а не как форма.
  const z = G.boneAt(CANON.zygion), g = G.boneAt(0.660);
  s += `<path d="${tstroke(wob([
      [z[0] - bw * 0.06, z[1] + bw * 0.06], [g[0] - bw * 0.16, g[1] + bw * 0.02],
      [z[0] - bw * 0.44, z[1] + bw * 0.12]
    ], bw * 0.015, rnd), [bw * 0.02, bw * 0.05, bw * 0.015])}"
    fill="${C.sh1}" opacity="${n1(lerp(0.18, 0.40, k01(p.cheek)))}"/>`;
  // Ветвь и угол челюсти: тень вдоль кости, к подбородку сходит.
  const go = G.boneAt(CANON.gonion), me = G.boneAt(0.95);
  s += `<path d="${tstroke([[z[0] - bw * 0.02, z[1] + bw * 0.16], [go[0] - bw * 0.03, go[1]],
        [me[0] - bw * 0.06, me[1]]], [bw * 0.02, bw * 0.045, 0.5])}" fill="${C.sh1}" opacity=".38"/>`;
  // Надбровная дуга: выступ кости даёт тень В глазницу.
  const O = G.orbit;
  s += `<path d="${tstroke([
      [O.x - O.w * 1.15, O.y - O.h * 0.62], [O.x - O.w * 0.2, O.y - O.h * 0.92],
      [O.x + O.w * 0.9, O.y - O.h * 0.70]], [O.h * 0.06, O.h * 0.20 * G.browK, O.h * 0.09])}"
      fill="${C.sh1}" opacity="${n1(lerp(0.25, 0.6, k01(p.brow)))}"/>`;
  // Румянец. Кожа живая не от тона, а от того, что над скулой и на кончике
  // носа кровь ближе к поверхности. Без этого лицо читается восковым.
  const bl = G.boneAt(CANON.zygion);
  s += `<path d="${blob(bl[0] - bw * 0.26, bl[1] + bw * 0.06, bw * 0.30, bw * 0.19, 9, 0.16, rnd)}"
        fill="${C.blush}" opacity=".26" filter="url(#${id}-soft)"/>`;
  return s;
}

// ── §6b. УХО ─────────────────────────────────────────────────
// Правило, не глазомер: верх завитка стоит на уровне глазницы, мочка —
// на уровне основания носа, а прилегает ухо к скуловой дуге сзади.
// Отсюда высота уха = расстояние между этими двумя ориентирами, и она
// сама подстраивается, когда меняются пропорции черепа.
function ear(id, p, G, C) {
  const top = G.y(CANON.orbit + 0.010), bot = G.y(CANON.subnasale - 0.020);
  const h = bot - top, w = h * 0.46;
  // Корень УТОПЛЕН в контур: ухо прилегает к черепу, а не торчит лопухом.
  const base = G.skinAt(0.600), x0 = base[0] - w * 0.62;
  const Y = f => top + h * f, X = f => x0 + w * f;
  const R = G.R;
  // Заострённый верх у нечеловеческих рас — это тот же завиток, вытянутый.
  const pk = R.key === 'human' || R.key === 'synth' ? 0 : h * 0.26;

  // Завиток (helix) — наружный край; замыкается по линии прилегания к черепу.
  const shell = [
    [X(0.10), Y(0.02)], [X(0.62), Y(pk ? -0.06 : 0.06)], [X(0.98) + pk * 0.5, Y(0.30 - pk / h)],
    [X(0.92), Y(0.60)], [X(0.66), Y(0.86)], [X(0.34), Y(1.00)],
    [X(0.10), Y(0.90)], [X(0.00), Y(0.55)],
  ];
  let s = `<path d="${smoothClosed(shell)}" fill="${C.skin}"/>`;
  s += `<path d="${tstroke(shell.slice(0, 6), [w * 0.030, w * 0.048, w * 0.055, w * 0.040, w * 0.025])}" fill="${C.line}" opacity=".7"/>`;
  // Раковина (concha) — впадина, поэтому это тень, а не линия.
  s += `<path d="${smoothClosed([[X(0.24), Y(0.24)], [X(0.58), Y(0.34)],
        [X(0.54), Y(0.70)], [X(0.26), Y(0.72)]])}" fill="${C.sh1}" opacity=".45"/>`;
  // Противозавиток — вилка, охватывающая раковину сверху.
  s += `<path d="${tstroke([[X(0.60), Y(0.22)], [X(0.36), Y(0.40)], [X(0.40), Y(0.66)]],
        [w * 0.030, w * 0.045, w * 0.022])}" fill="${C.line}" opacity=".55"/>`;
  // Козелок прикрывает вход в слуховой проход.
  s += `<path d="${tstroke([[X(0.20), Y(0.42)], [X(0.28), Y(0.54)]], w * 0.05, w * 0.03)}"
        fill="${C.line}" opacity=".5"/>`;
  return s;
}

// ── §7. НОС ──────────────────────────────────────────────────
// Считается от грушевидного отверстия: спинка идёт от корня (nasion) к концу
// носовых костей (rhinion), крылья садятся по краям отверстия. Ни одной
// свободной константы — только доли pyri.
// Спинка — ОТДЕЛЬНО и БЕЗ зеркала: зеркальная пара теней сходилась у оси в
// тёмный гребень, и лицо получало шов посередине. Свет один, тень одна.
function noseDorsum(id, p, G, C) {
  const N = G.pyri, cx = G.cx, bw = G.bw;
  return `<path d="${tstroke([[cx + N.w * 0.13, G.y(CANON.nasion) + bw * 0.04],
        [cx + N.w * 0.26, G.y(CANON.rhinion)], [cx + N.w * 0.24, G.y(CANON.subnasale - 0.028)]],
        [bw * 0.004, bw * 0.016, bw * 0.026])}" fill="${C.sh1}" opacity=".34"
        filter="url(#${id}-soft2)"/>`;
}
function nose(id, p, G, C) {
  const N = G.pyri, cx = G.cx, bw = G.bw;
  const tipY = G.y(CANON.subnasale - 0.028), ax = cx + N.w * 0.5, ay = N.y;
  let s = '';
  // Крыло НЕ обводится: обводка делает нос наклейкой. Его выдаёт складка-тень
  // вокруг крыла и провал ноздри — как на живописном рефе.
  s += `<path d="${tstroke([[cx + N.w * 0.16, tipY + bw * 0.02],
        [ax * 1.0, ay - bw * 0.010], [ax - N.w * 0.10, ay + bw * 0.020]],
        [bw * 0.006, bw * 0.017, bw * 0.006])}" fill="${C.sh2}" opacity=".26"
        filter="url(#${id}-soft2)"/>`;
  s += `<path d="${blob(cx + N.w * 0.24, ay + bw * 0.002, N.w * 0.085, bw * 0.009, 8, 0.14,
        mulberry((p.seed ^ 0x33) >>> 0))}" fill="${C.sh2}" opacity=".5"/>`;
  // Блик на кончике — светлое пятно, которым нос и «выходит» вперёд.
  s += `<path d="${blob(cx + N.w * 0.10, tipY - bw * 0.03, N.w * 0.16, bw * 0.030, 9, 0.2,
        mulberry((p.seed ^ 0x34) >>> 0))}" fill="#fff" opacity=".10"/>`;
  return s;
}

// ── §8. РОТ ──────────────────────────────────────────────────
// Ширина — от альвеолярной дуги, а не «на глаз»: у широкой челюсти рот шире.
function mouth(id, p, G, C) {
  const A = G.alv, cx = G.cx, hw = A.w / 2, bw = G.bw, full = k01(p.lips);
  const dip = bw * lerp(0.012, 0.030, full);
  // Линия смыкания: лук Купидона в центре, углы уходят вверх и в остриё.
  const line = [[cx, A.y], [cx + hw * 0.30, A.y + dip * 0.30], [cx + hw * 0.72, A.y + dip * 0.14],
                [cx + hw, A.y - dip * 0.24]];
  // Объём губ даёт заливка, а не контур: сама подушка светлее кожи и теплее.
  let s = `<path d="${smoothClosed([[cx, A.y - dip * 1.5], [cx + hw * 0.42, A.y - dip * 1.15],
        [cx + hw * 0.98, A.y - dip * 0.20], [cx + hw * 0.52, A.y + dip * 1.6],
        [cx, A.y + dip * 2.4]])}" fill="${C.lip}" opacity=".85"/>`;
  // Углы рта — самое тёмное: там губа уходит вглубь.
  s += `<path d="${blob(cx + hw * 0.94, A.y - dip * 0.14, hw * 0.10, dip * 0.5, 7, 0.2,
        mulberry((p.seed ^ 0x6d) >>> 0))}" fill="${C.sh2}" opacity=".5"/>`;
  // Линия смыкания — самое тёмное место рта, к углам сходит в остриё.
  s += `<path d="${tstroke(line, [bw * 0.015, bw * 0.011, bw * 0.006, 0.4])}" fill="${C.sh2}" opacity=".85"/>`;
  // Нижняя губа: объём даёт не контур, а тень под ней.
  s += `<path d="${tstroke([[cx, A.y + dip * 2.1], [cx + hw * 0.55, A.y + dip * 1.7],
        [cx + hw * 0.88, A.y + dip * 0.7]], [bw * 0.014, bw * 0.009, 0.3])}" fill="${C.sh1}" opacity=".45"/>`;
  // Блик на нижней губе — гранёный, не «пузырь».
  s += `<path d="${smoothClosed([[cx + hw * 0.10, A.y + dip * 0.8], [cx + hw * 0.46, A.y + dip * 0.7],
        [cx + hw * 0.40, A.y + dip * 1.2], [cx + hw * 0.08, A.y + dip * 1.3]])}" fill="#fff" opacity=".14"/>`;
  return s;
}

// ── §9. ГЛАЗ ─────────────────────────────────────────────────
// Глазное яблоко в глазнице. Веки — края, скользящие по сфере:
//   · верхнее срезает верхний лимб (в норме на ~1/6 радужки),
//   · нижнее касается нижнего лимба,
//   · радужка не может быть шире яблока — её радиус доля gr, не «подобран»,
//   · наклон разреза — ПОВОРОТ щели вокруг центра яблока (кантальный наклон),
//     а не сдвиг отдельных точек, поэтому веки не расходятся.
// Строится только правый глаз, левый — зеркало группы.
function eyeGroup(id, p, G, C) {
  const R = G.R, rnd = mulberry((p.seed ^ 0x51ec) >>> 0), O = G.orbit;
  const gx = O.x, gy = O.y + O.h * 0.04;          // центр яблока в глазнице
  const gr = O.w * 0.40;                           // радиус яблока
  const fw = gr * 1.34;                            // полуширина щели: шире яблока — до углов
  const tilt = (k01(p.eyeTilt) - 0.5) * 0.34;      // кантальный наклон, рад
  const open = lerp(1.0, 0.82, G.mat);             // с возрастом щель уже

  // Края век в системе яблока: −x медиально (к переносице), +x латерально.
  const upper = [
    [gx - fw, gy],
    [gx - fw * 0.60, gy - gr * 0.78 * open],
    [gx - fw * 0.14, gy - gr * 1.00 * open],
    [gx + fw * 0.40, gy - gr * 0.86 * open],
    [gx + fw * 0.80, gy - gr * 0.46 * open],
    [gx + fw, gy],
  ];
  const lower = [
    [gx + fw, gy],
    [gx + fw * 0.52, gy + gr * 0.56 * open],
    [gx - fw * 0.04, gy + gr * 0.80 * open],
    [gx - fw * 0.62, gy + gr * 0.64 * open],
    [gx - fw, gy],
  ];
  const top = rot(upper, gx, gy, -tilt), bot = rot(lower, gx, gy, -tilt);
  const socket = ring(wob(top, gr * 0.02, rnd), wob(bot, gr * 0.02, rnd));
  const clip = `${id}-eyeR`;

  // Радужка на поверхности яблока, взгляд прямо: центр = центр яблока.
  const ir = gr * 0.50, ix = gx - gr * 0.03, iy = gy + gr * 0.06;

  let s = `<clipPath id="${clip}"><path d="${socket}"/></clipPath>`;
  s += `<path d="${socket}" fill="${C.sclera}"/>`;
  s += `<g clip-path="url(#${clip})">`;
  // Тень верхнего века на склере — по форме самого века, не прямоугольник.
  s += `<path d="${ring(top.map(q => [q[0], q[1] - gr * 0.5]), bot.map(q => [q[0], q[1] - gr * 0.66]).reverse())}" fill="${C.scleraSh}"/>`;

  if (R.pupil === 'void') {
    s += `<path d="${blob(ix, iy, ir, ir * 1.05, 14, 0.1, rnd)}" fill="${p.iris}" filter="url(#${id}-glow)"/>`;
  } else if (R.pupil === 'compound') {
    const d = blob(ix, iy, ir * 1.35, ir * 1.15, 14, 0.08, rnd);
    s += `<path d="${d}" fill="${p.iris}"/><path d="${d}" fill="url(#${id}-hex)" opacity=".5"/>`;
  } else {
    s += `<path d="${blob(ix, iy, ir, ir * 1.02, 16, 0.06, rnd)}" fill="url(#${id}-iris)"/>`;
    // Тень верхнего века на радужке.
    s += `<path d="${tstroke([[ix - ir * 1.1, iy - ir * 0.5], [ix, iy - ir * 0.9], [ix + ir * 1.1, iy - ir * 0.5]],
          [ir * 0.16, ir * 0.34, ir * 0.2])}" fill="${C.limb}" opacity=".5"/>`;
    // Волокна — только в нижней, открытой веком половине.
    for (let i = 0; i < 11; i++) {
      const an = Math.PI * (0.08 + i * 0.075) + (rnd() - 0.5) * 0.06;
      const r1 = lerp(0.86, 0.99, rnd()), r0 = lerp(0.34, 0.5, rnd());
      s += `<path d="${tstroke([[ix + Math.cos(an) * ir * r1, iy + Math.sin(an) * ir * r1],
            [ix + Math.cos(an) * ir * r0, iy + Math.sin(an) * ir * r0]], ir * lerp(0.05, 0.09, rnd()), 0.2)}"
            fill="${C.limb}" opacity="${n1(lerp(0.2, 0.45, rnd()))}"/>`;
    }
    // Лимб — лента: сверху плотная, снизу сходит.
    const lim = [];
    for (let i = 0; i <= 16; i++) {
      const a = -Math.PI / 2 + (i / 16) * Math.PI * 2;
      lim.push([ix + Math.cos(a) * ir, iy + Math.sin(a) * ir * 1.02]);
    }
    s += `<path d="${tstroke(lim, [ir * 0.11, ir * 0.07, ir * 0.03, ir * 0.03, ir * 0.07, ir * 0.11])}" fill="${C.limb}"/>`;
    s += `<path d="${blob(ix, iy + ir * 0.5, ir * 0.62, ir * 0.24, 7, 0.16, rnd)}" fill="#ffffff" opacity=".38"/>`;
    s += R.pupil === 'slit'
      ? `<path d="${blob(ix, iy, ir * 0.15, ir * 0.78, 10, 0.1, rnd)}" fill="${C.line}"/>`
      : R.pupil === 'lens'
      ? `<path d="${tstroke(lim.map(q => [ix + (q[0] - ix) * 0.46, iy + (q[1] - iy) * 0.44]), ir * 0.09, ir * 0.09)}" fill="${C.line}"/>`
      : `<path d="${blob(ix, iy, ir * 0.4, ir * 0.44, 11, 0.07, rnd)}" fill="${C.line}"/>`;
    s += `<path d="${smoothClosed([[ix - ir * 0.62, iy - ir * 0.48], [ix - ir * 0.2, iy - ir * 0.58],
          [ix - ir * 0.14, iy - ir * 0.3], [ix - ir * 0.52, iy - ir * 0.22]])}" fill="#fff"/>`;
    s += `<path d="${smoothClosed([[ix + ir * 0.32, iy + ir * 0.3], [ix + ir * 0.56, iy + ir * 0.38],
          [ix + ir * 0.36, iy + ir * 0.5]])}" fill="#fff" opacity=".7"/>`;
  }
  s += `</g>`;

  // Ресничный край верхнего века: нажим гуляет, сход в остриё ЗА латеральным углом.
  const lat = top[top.length - 1];
  const lash = top.concat([[lat[0] + gr * 0.34, lat[1] - gr * 0.30]]);
  s += `<path d="${tstroke(lash, [gr * 0.035, gr * 0.085, gr * 0.125, gr * 0.115, gr * 0.08, gr * 0.04, 0.3])}" fill="${C.lash}"/>`;
  for (let i = 0; i < 3; i++) {
    const t = i / 2, L = gr * lerp(0.40, 0.18, t), a = -0.5 - t * 0.55 - tilt;
    const b = rot([[gx + fw * lerp(0.80, 0.99, t), gy - gr * lerp(0.46, 0.24, t)]], gx, gy, -tilt)[0];
    s += `<path d="${tstroke([[b[0], b[1]], [b[0] + Math.cos(a) * L * 0.6, b[1] + Math.sin(a) * L * 0.6],
          [b[0] + Math.cos(a - 0.3) * L, b[1] + Math.sin(a - 0.3) * L]], gr * lerp(0.10, 0.06, t), 0.3)}" fill="${C.lash}"/>`;
  }
  // Слёзное мясцо в медиальном углу.
  const med = top[0];
  s += `<path d="${tstroke([[med[0] + gr * 0.16, med[1] + gr * 0.18], [med[0] - gr * 0.06, med[1] + gr * 0.30]],
        gr * 0.09, 0.3)}" fill="${C.lash}" opacity=".9"/>`;
  // Край нижнего века: только латеральные две трети, сход в ноль.
  s += `<path d="${tstroke(bot.slice(0, 3), gr * 0.055, 0.2)}" fill="${C.sh2}" opacity=".45"/>`;
  // Складка верхнего века — по краю глазницы, а не «где-то выше глаза».
  s += `<path d="${tstroke(rot([[gx - fw * 0.82, gy - gr * 0.74], [gx - fw * 0.18, gy - gr * 1.30],
        [gx + fw * 0.52, gy - gr * 1.08]], gx, gy, -tilt), gr * 0.03, gr * 0.055)}" fill="${C.sh2}" opacity=".34"/>`;

  // Бровь: сидит на надглазничном крае, пик — над латеральной третью.
  const brow = rot([
    [gx - fw * 0.98, gy - gr * 1.52], [gx - fw * 0.30, gy - gr * 1.88],
    [gx + fw * 0.42, gy - gr * 1.80], [gx + fw * 1.02, gy - gr * 1.36],
  ], gx, gy, -tilt * 0.6);
  // Бровь мягкая и с сходом в остриё к виску — жирная лента читается как уголь.
  const bwd = gr * 0.115 * G.browK;
  s += `<path d="${tstroke(brow, [bwd * 0.45, bwd, bwd * 0.66, 0.25])}" fill="${C.brow}"/>`;
  // Верхняя кромка мягче нижней — так бровь не выглядит наклейкой.
  s += `<path d="${tstroke(brow, [bwd * 0.7, bwd * 1.35, bwd * 0.9, 0.3])}" fill="${C.brow}"
        opacity=".34" filter="url(#${id}-soft2)"/>`;
  return s;
}

// ── §9b. ШЕЯ И ПЛЕЧИ ─────────────────────────────────────────
// Шея выходит из-под сосцевидного отростка (за ухом), а не из подбородка,
// поэтому её верх стоит ЗА углом челюсти. Ниже она переходит в трапецию —
// это она даёт скат плеча, а не отдельная «линия плеч».
function neck(id, p, G, C) {
  const cx = G.cx, bw = G.bw, gY = G.y(CANON.gonion);
  const col = [
    [cx + bw * 0.56, gY - bw * 0.16],      // сосцевидный отросток, корень шеи
    [cx + bw * 0.50, gY + bw * 0.28],
    [cx + bw * 0.47, gY + bw * 0.66],      // самое узкое место
    [cx + bw * 0.72, gY + bw * 1.02],      // трапеция набирает объём
    [cx + bw * 1.16, gY + bw * 1.34],
    [cx + bw * 1.68, VH + 10],
  ];
  const shape = col.concat([[cx, VH + 10]]);
  let s = `<path d="${smoothClosed(shape.concat([[cx, gY - bw * 0.20]]))}" fill="${C.neck}"/>`;
  // Тень от челюсти на шее — главный признак объёма головы над шеей.
  s += `<path d="${smoothClosed([
      [cx, gY + bw * 0.18], [cx + bw * 0.42, gY + bw * 0.12], [cx + bw * 0.64, gY - bw * 0.10],
      [cx + bw * 0.62, gY + bw * 0.36], [cx + bw * 0.30, gY + bw * 0.50], [cx, gY + bw * 0.52],
    ])}" fill="${C.neckSh}" opacity=".85"/>`;
  // Грудино-ключично-сосцевидная: от отростка к яремной вырезке.
  s += `<path d="${tstroke([[cx + bw * 0.56, gY + bw * 0.06], [cx + bw * 0.36, gY + bw * 0.62],
        [cx + bw * 0.16, gY + bw * 1.02]], [bw * 0.012, bw * 0.020, bw * 0.006])}"
        fill="${C.sh1}" opacity=".22" filter="url(#${id}-soft2)"/>`;
  // Ключица: без неё плечо читается как бочка, а не как тело.
  s += `<path d="${tstroke([[cx + bw * 0.06, gY + bw * 1.14], [cx + bw * 0.56, gY + bw * 1.20],
        [cx + bw * 1.02, gY + bw * 1.34]], [bw * 0.008, bw * 0.020, bw * 0.008])}"
        fill="${C.sh1}" opacity=".30" filter="url(#${id}-soft2)"/>`;
  return s;
}

// ── §9c. ВОЛОСЫ ──────────────────────────────────────────────
// Масса, а не прядки: сперва силуэт объёма над сводом, потом внутри него
// тон и несколько потоков. Задняя масса идёт ДО головы, передняя — ПОСЛЕ,
// поэтому пробор и височные пряди ложатся на лоб, как на рефе.
function hairMass(id, p, G, C) {
  const cx = G.cx, bw = G.bw, crown = G.crown, H = G.H;
  const L = lerp(0.74, 1.10, k01(p.hairLen));          // низ каре в долях H
  const lift = bw * 0.14;                               // объём волос над костью
  const back = [
    [cx, crown - lift],                                // вершина купола, на оси
    [cx + bw * 0.62, crown + H * 0.06 - lift * 0.5],
    [cx + bw * 1.06, crown + H * 0.30],
    [cx + bw * 1.20, crown + H * 0.58],
    [cx + bw * 1.16, crown + H * (L - 0.10)],
    [cx + bw * 0.96, crown + H * L],
    [cx + bw * 0.30, crown + H * (L + 0.03)],
    [cx, crown + H * (L + 0.03)],                      // низ, на оси
  ];
  const d = symClosed(cx, back);
  return `<path d="${d}" fill="${C.hair}"/><path d="${d}" fill="url(#${id}-hairG)"/>`;
}
function hairFront(id, p, G, C) {
  const cx = G.cx, bw = G.bw, crown = G.crown, H = G.H;
  const L = lerp(0.74, 1.10, k01(p.hairLen));
  const lift = bw * 0.14;
  const rnd = mulberry((p.seed ^ 0x7a1e) >>> 0);
  // Прядь от пробора. Вершина стоит РОВНО на высоте задней массы и ровно на
  // оси — иначе две зеркальные половины дают на макушке пару рожек.
  // Пробор читается тенью (ниже), а не вырезом в силуэте.
  const lock = [
    [cx, crown - lift],                                // пробор, вершина купола
    [cx + bw * 0.40, crown - lift * 0.55],
    [cx + bw * 0.84, crown + H * 0.10],
    [cx + bw * 1.04, crown + H * 0.36],
    [cx + bw * 1.02, crown + H * (L - 0.06)],
    [cx + bw * 0.82, crown + H * (L - 0.01)],          // остриё пряди у скулы
    [cx + bw * 0.76, crown + H * 0.42],
    [cx + bw * 0.66, crown + H * 0.26],                // внутренний край
    [cx + bw * 0.20, crown + H * 0.19],                // линия роста: лоб = 1/4
    [cx, crown + H * 0.17],
  ];
  const dl = symClosed(cx, lock);
  // Силуэт — цельный, детали — правой половиной и зеркалом (см. symClosed).
  const sil = `<path d="${dl}" fill="${C.hair}"/><path d="${dl}" fill="url(#${id}-hairG)"/>`;
  let s = '';
  // Пробор — тень у оси, сходящая в ноль. Это он, а не вырез в силуэте.
  s += `<path d="${tstroke([[cx, crown - lift * 0.9], [cx + bw * 0.06, crown - lift * 0.1],
        [cx + bw * 0.12, crown + H * 0.08]], [bw * 0.028, bw * 0.016, 0.2])}"
        fill="${C.hairSh}" opacity=".55"/>`;
  // Тень волос НА лбу — то, что отделяет массу от кожи без обводки.
  s += `<path d="${tstroke([[cx + bw * 0.06, crown + H * 0.18], [cx + bw * 0.44, crown + H * 0.21],
        [cx + bw * 0.72, crown + H * 0.34]], [bw * 0.022, bw * 0.05, bw * 0.03])}"
        fill="${C.hairSh}" opacity=".42" filter="url(#${id}-soft2)"/>`;
  // Потоки: идут ПО силуэту пряди, ширина гуляет — иначе читается как расчёска.
  for (let i = 0; i < 6; i++) {
    const u = (i + 0.5) / 6, k = lerp(0.14, 0.96, u);
    const w = bw * lerp(0.008, 0.022, rnd());
    s += `<path d="${tstroke([
        [cx + bw * k * 0.16, crown - lift * lerp(0.9, 0.2, k)],
        [cx + bw * (0.30 + k * 0.46), crown + H * (0.02 + k * 0.14)],
        [cx + bw * (0.74 + k * 0.28), crown + H * (0.30 + k * 0.14)],
        [cx + bw * (0.80 + k * 0.20), crown + H * (L - 0.12 + k * 0.06)],
      ], [w * 0.3, w, w * 0.7, w * 0.15])}"
      fill="${i % 2 ? C.hairHi : C.hairSh}" opacity="${n1(lerp(0.18, 0.38, rnd()))}"/>`;
  }
  return sil + s + mirror(cx, s);
}

// ── §10. Сборка ──────────────────────────────────────────────
function render(p, opt) {
  opt = opt || {};
  p = Object.assign(defaults('Гуманоиды', 'агендер', 1), p);
  const G = skull(p);
  const id = 'cg' + (hash(JSON.stringify(p)) % 100000).toString(36);
  const cx = G.cx;

  // Палитра живописная, а не контурная: свет, полутон, тень, рефлекс.
  // Тень — не «кожа минус яркость», а сдвиг в холод и насыщенность, как на рефе.
  const C = {
    skin:    hsl(p.hue, p.sat, p.lit),
    skinHi:  hsl(p.hue + 4, Math.max(4, p.sat - 8), Math.min(97, p.lit + 8)),
    skinMid: hsl(p.hue - 2, p.sat + 4, p.lit - 7),
    sh1:     shade(p.hue, p.sat, p.lit, 0.7),
    sh2:     hsl(p.hue - 12, Math.min(58, p.sat + 14), Math.max(14, p.lit * 0.46)),
    line:    linec(p.hue, p.sat, p.lit),
    lash:    hsl(p.hue - 10, Math.min(46, p.sat + 6), Math.max(6, p.lit * 0.16)),
    brow:    hsl(p.hairHue, Math.min(48, p.hairSat), Math.max(10, p.hairLit * 0.62)),
    lip:     hsl(p.hue - 12, Math.min(60, p.sat + 24), Math.max(24, p.lit * 0.72)),
    blush:   hsl(p.hue - 16, Math.min(68, p.sat + 30), Math.max(30, p.lit * 0.82)),
    neck:    hsl(p.hue, p.sat + 2, p.lit - 4),
    neckSh:  hsl(p.hue - 8, Math.min(56, p.sat + 12), Math.max(16, p.lit * 0.56)),
    hair:    hsl(p.hairHue, p.hairSat, p.hairLit),
    hairSh:  hsl(p.hairHue - 6, Math.min(64, p.hairSat + 10), Math.max(6, p.hairLit * 0.48)),
    hairHi:  hsl(p.hairHue + 8, Math.max(6, p.hairSat - 6), Math.min(94, p.hairLit + 22)),
    sclera:  '#f6f4f2',
    scleraSh: hsl(p.hue + 200, 14, 78),
    limb:    hsl(p.hue + 200, 30, 22),
  };

  const eyes = eyeGroup(id, p, G, C);
  const planeS = planes(id, p, G, C);

  return `<svg viewBox="0 0 ${VW} ${VH}" xmlns="http://www.w3.org/2000/svg" class="cg-svg" preserveAspectRatio="xMidYMid meet">
  <defs>
    <linearGradient id="${id}-bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0" stop-color="#1b2430"/><stop offset="1" stop-color="#0a0e14"/>
    </linearGradient>
    <linearGradient id="${id}-iris" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0" stop-color="${C.limb}"/>
      <stop offset="0.45" stop-color="${p.iris}"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity=".55"/>
    </linearGradient>
    <filter id="${id}-glow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <pattern id="${id}-hex" width="7" height="8" patternUnits="userSpaceOnUse">
      <path d="M3.5,0 L7,2 L7,6 L3.5,8 L0,6 L0,2 Z" fill="none" stroke="${C.line}" stroke-width="1" opacity=".7"/>
    </pattern>
    <!-- Свет один и сверху-слева: отсюда и заливка кожи, и все тени. -->
    <linearGradient id="${id}-skinG" x1="14%" y1="4%" x2="92%" y2="86%">
      <stop offset="0" stop-color="${C.skinHi}"/>
      <stop offset="0.46" stop-color="${C.skin}"/>
      <stop offset="1" stop-color="${C.skinMid}"/>
    </linearGradient>
    <linearGradient id="${id}-hairG" x1="10%" y1="0%" x2="86%" y2="74%">
      <stop offset="0" stop-color="${C.hairHi}" stop-opacity=".55"/>
      <stop offset="0.38" stop-color="${C.hair}" stop-opacity="0"/>
      <stop offset="1" stop-color="${C.hairSh}" stop-opacity=".62"/>
    </linearGradient>
    <!-- Мягкая тень теневой стороны: край растушёван, а не обведён. -->
    <filter id="${id}-soft" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="${n1(G.bw * 0.085)}"/>
    </filter>
    <filter id="${id}-soft2" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="${n1(G.bw * 0.035)}"/>
    </filter>
    <clipPath id="${id}-head"><path d="${G.path}"/></clipPath>
  </defs>

  <rect width="${VW}" height="${VH}" fill="url(#${id}-bg)"/>

  <!-- ЗАДНЯЯ МАССА ВОЛОС — за головой и за шеей (§9c). -->
  ${hairMass(id, p, G, C)}

  <!-- ШЕЯ И ПЛЕЧИ (§9b): голова стоит на шее, а не висит в пустоте. -->
  ${(() => { const nk = neck(id, p, G, C); return nk + mirror(cx, nk); })()}

  <!-- УШИ — ДО головы: контур черепа перекроет место прилегания (§6b). -->
  ${(() => { const e = ear(id, p, G, C); return e + mirror(cx, e); })()}

  <!-- КОЖА: заливка градиентом по направлению света, без обводки силуэта. -->
  <path d="${G.path}" fill="url(#${id}-skinG)"/>

  <g clip-path="url(#${id}-head)">
    <!-- Теневая сторона: край РАСТУШЁВАН фильтром — это и заменяет контур. -->
    <path d="${(() => {
      const half = G.profR.map(q => [q[0], q[1]]);
      return smoothClosed(half.concat([[cx + G.bw * 0.30, G.y(1)], [cx + G.bw * 0.34, G.crown]]));
    })()}" fill="${C.sh1}" opacity=".30" filter="url(#${id}-soft)"/>

    <!-- ПЛАНЫ: тени привязаны к выступам и впадинам черепа (§6). -->
    <g filter="url(#${id}-soft2)">${planeS}${mirror(cx, planeS)}</g>
  </g>

  <g clip-path="url(#${id}-head)">
    ${eyes}${mirror(cx, eyes)}
    ${(() => { const nz = nose(id, p, G, C); return nz + mirror(cx, nz); })()}
    ${noseDorsum(id, p, G, C)}
    ${mouth(id, p, G, C)}${mirror(cx, mouth(id, p, G, C))}
  </g>

  <!-- ПЕРЕДНЯЯ ПРЯДЬ — ПОСЛЕ лица: пробор и височные пряди ложатся на лоб. -->
  ${hairFront(id, p, G, C)}
</svg>`;
}

return { RACES, RACE_LIST, CANON, defaults, skull, rig, render, hash, hsl };
})();
