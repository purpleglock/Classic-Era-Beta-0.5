// © 2025–2026. Проприетарное ПО. См. LICENSE.
// ════════════════════════════════════════════════════════════
// CITY GEN v4 — процедурный генератор ГОРОДСКОГО СИЛУЭТА (фон новеллы)
// ────────────────────────────────────────────────────────────
// Язык снят с референса (арт главной): ГРАФИКА ТУШЬЮ, чистый чёрно-белый.
// Разбор того, из чего он собран, — он же техзадание этому файлу:
//   1) ТОН. Только белое и чёрное. Полутон даёт ШТРИХОВКА — плотные параллельные
//      прямые линии под одним углом (§3). Серых заливок нет: именно они делали
//      предыдущую версию вялой, а «дрожащий» штрих делал её детским рисунком.
//   2) СИЛУЭТ РВАНЫЙ И АСИММЕТРИЧНЫЙ. Башня набирается из БЛОКОВ, каждый со своими
//      отступами слева и справа (§4): получаются зазубрины, плечи, выносы. Ровная
//      призма встречается, но как исключение.
//   3) ДЕТАЛЬ РАЗНОМАСШТАБНАЯ. На одном фасаде соседствуют крупные чёрные поля,
//      шахматка окон, узкие щели и мелкие белые коробки (§5). Один мотив на всё
//      здание = «полосатая тряпка», поэтому мотив выбирается НА БЛОК.
//   4) КОНСТРУКЦИИ. Решётчатые мачты с X-раскосами, фермы-переходы, провисающие
//      тросы (§6) — они и создают ощущение построенного города, а не набора коробок.
//   5) ГЛУБИНА. Дальний план — сплошной чёрный силуэт без деталей, ближний — белый
//      с чёрной деталью. Планы разделяет контраст, а не подмешивание неба.
// ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: серых полутонов, колец-«тарелок», парящих платформ,
// дрожащих кромок, единой сетки-миллиметровки на весь город.
// Экспорт: window.CG — CG.city(opt) → svg-строка, CG.building(opt) → один дом.
// ════════════════════════════════════════════════════════════
window.CG = (function () {
'use strict';

// ── §1. Мелочи ───────────────────────────────────────────────
const n1 = v => Math.round(v * 10) / 10;
function rng(seed) {                                     // mulberry32: один сид — один город
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hex2rgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); }
function rgb2hex(a) { return '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function mix(c1, c2, k) { const A = hex2rgb(c1), B = hex2rgb(c2); return rgb2hex(A.map((v, i) => v + (B[i] - v) * k)); }
const R2 = (x, y, w, h, f) => w > 0.15 && h > 0.15 ? `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" fill="${f}"/>` : '';
const PT = (p, f) => `<path d="M${p.map(q => n1(q[0]) + ',' + n1(q[1])).join('L')}Z" fill="${f}"/>`;
const rnd = (R, a, b) => a + R() * (b - a);
const ri = (R, a, b) => a + Math.floor(R() * (b - a + 1));

// ── §2. Палитра ──────────────────────────────────────────────
// Всего два цвета на плане. Дальний план — заливка чернилами целиком.
// day (0..1) — сколько света на планете (§13a). Освещённая грань дома не бывает
// белее того, что даёт светило: у красного карлика на далёкой орбите «бумага»
// уходит в сумеречную синь, а тень почти сливается с ней.
function palette(sky, depth, day) {
  const d = day == null ? 1 : Math.max(0, Math.min(1, day));
  const face = mix(mix('#0b0f14', sky, 0.14), '#f2f2f0', 0.18 + 0.82 * d);
  return {
    paper: depth > 0.62 ? mix('#111417', sky, 0.16) : face,       // лицо
    ink: depth > 0.62 ? mix('#111417', sky, 0.16)
                      : mix('#0e1013', face, (1 - d) * 0.3),      // деталь и тень
    solid: depth > 0.62,                                          // дальний = глухой силуэт
    fine: depth < 0.34,                                           // мелочь только у ближнего
    day: d,
    glow: '#ffd9a0'                                               // окна, зажжённые в сумерках
  };
}

// ── §3. Штриховка ────────────────────────────────────────────
// Полутон = ПРЯМЫЕ параллельные линии под одним углом, обрезанные по прямоугольнику
// аналитически (без clipPath: сотни клипов на город — это тормоза и мусор в defs).
// Линии строго прямые: «живость» здесь даёт плотность, а не дрожь.
function hatch(x, y, w, h, col, dens, ang) {
  if (w < 1.2 || h < 1.2) return '';
  const step = Math.max(1.5, 4.6 - dens * 3.2);
  const t = 1 / Math.tan((ang || 60) * Math.PI / 180);      // сдвиг по x на всю высоту
  const dx = h * t;
  let d = '', guard = 0;
  for (let x0 = x - Math.abs(dx); x0 < x + w && guard++ < 200; x0 += step) {
    // Отрезок от (x0, y+h) до (x0+dx, y): режем по вертикальным границам блока.
    let ax = x0, ay = y + h, bx = x0 + dx, by = y;
    if (ax < x) { ay = y + h - (x - ax) / (dx || 1e-6) * h; ax = x; }
    if (bx > x + w) { by = y + (bx - (x + w)) / (dx || 1e-6) * h; bx = x + w; }
    if (bx <= ax || ay <= by) continue;
    d += `M${n1(ax)},${n1(ay)}L${n1(bx)},${n1(by)}`;
  }
  return d ? `<path d="${d}" stroke="${col}" stroke-width="0.55" fill="none"/>` : '';
}

// ── §4. Силуэт: стопка блоков ────────────────────────────────
// Блок = {x, w, y0, y1}. Каждый следующий уже предыдущего и садится со СВОИМ
// отступом слева/справа — отсюда зазубрины и плечи. Отступ ограничен габаритом
// нижнего блока: ступень не имеет права свисать в воздух.
function stack(R, w, h, kind) {
  const bl = [];
  const n = kind === 'slab' ? ri(R, 1, 2) : kind === 'jag' ? ri(R, 4, 7) : ri(R, 2, 4);
  let y = 0, x = 0, cw = w;
  for (let i = 0; i < n && y < h - 2; i++) {
    const last = i === n - 1;
    const bh = last ? h - y : h * rnd(R, 0.12, 0.42);
    bl.push({ x: x, w: cw, y0: y, y1: Math.min(h, y + bh) });
    y += bh;
    const nw = cw * rnd(R, kind === 'jag' ? 0.5 : 0.66, 0.92);
    x += rnd(R, 0, 1) * (cw - nw);                          // сдвиг в пределах нижнего
    cw = nw;
    if (cw < 2) break;
  }
  return bl;
}

// ── §5. Фасад: мотив НА БЛОК ─────────────────────────────────
// Мотивы разного масштаба, чтобы фасад не читался одной текстурой. Все рисуются
// внутри прямоугольника блока и сами следят за своими габаритами.
function motif(R, b, P, name, dark) {
  const x = b.x, w = b.w, y = b.yTop, h = b.hPx;
  const fg = dark ? P.paper : P.ink;                        // на чёрном поле пишем белым
  let s = '';
  if (name === 'checker') {                                 // шахматка окон
    const cw = Math.max(1.2, w / ri(R, 3, 7)), ch = Math.max(1.2, cw * rnd(R, 0.7, 1.5));
    const gx = cw * 0.42, gy = ch * 0.5;
    let d = '', g = 0;
    for (let yy = y + gy; yy < y + h - ch && g < 900; yy += ch + gy)
      for (let xx = x + gx; xx < x + w - cw * 0.6 && g < 900; xx += cw + gx, g++)
        d += `M${n1(xx)},${n1(yy)}h${n1(cw)}v${n1(ch)}h${n1(-cw)}Z`;
    if (d) s += `<path d="${d}" fill="${fg}"/>`;
  } else if (name === 'slots') {                            // длинные вертикальные щели
    const n = ri(R, 2, 6);
    let d = '';
    for (let k = 0; k < n; k++) {
      const sw = w / n * rnd(R, 0.2, 0.45), sx = x + w * (k + 0.5) / n - sw / 2;
      const t0 = y + h * rnd(R, 0.02, 0.12), t1 = y + h * rnd(R, 0.86, 0.99);
      d += `M${n1(sx)},${n1(t0)}h${n1(sw)}V${n1(t1)}h${n1(-sw)}Z`;
    }
    s += `<path d="${d}" fill="${fg}"/>`;
  } else if (name === 'bands') {                            // плотные ленты этажей
    const p = Math.max(1.6, h / ri(R, 8, 26));
    let d = '';
    for (let yy = y + p; yy < y + h - p * 0.5; yy += p) d += `M${n1(x + w * 0.06)},${n1(yy)}H${n1(x + w * 0.94)}`;
    s += `<path d="${d}" stroke="${fg}" stroke-width="${n1(Math.min(1.4, p * 0.42))}" fill="none"/>`;
  } else if (name === 'boxes') {                            // редкие мелкие коробки
    const n = ri(R, 2, 6);
    let d = '';
    for (let k = 0; k < n; k++) {
      const bw = w * rnd(R, 0.16, 0.5), bh2 = h * rnd(R, 0.03, 0.12);
      const bx = x + rnd(R, 0.05, 0.95 - bw / w) * w, by = y + rnd(R, 0.04, 0.9) * h;
      d += `M${n1(bx)},${n1(by)}h${n1(bw)}v${n1(bh2)}h${n1(-bw)}Z`;
    }
    s += `<path d="${d}" fill="${fg}"/>`;
  } else if (name === 'field') {                            // глухое чёрное поле с прорезями
    s += R2(x + w * 0.08, y + h * 0.05, w * 0.84, h * 0.9, fg);
    const n = ri(R, 2, 5);
    let d = '';
    for (let k = 0; k < n; k++) {
      const yy = y + h * (0.12 + 0.76 * (k + 0.5) / n);
      d += `M${n1(x + w * 0.16)},${n1(yy)}h${n1(w * 0.68)}v${n1(Math.max(0.8, h * 0.02))}h${n1(-w * 0.68)}Z`;
    }
    s += `<path d="${d}" fill="${dark ? P.ink : P.paper}"/>`;
  } else if (name === 'hatch') {                            // штриховка как полутон плоскости
    s += hatch(x + w * 0.05, y + h * 0.04, w * 0.9, h * 0.92, fg, rnd(R, 0.3, 0.8), ri(R, 52, 74));
  }
  return s;
}

// ── §6. Конструкции ──────────────────────────────────────────
// Решётчатая мачта: две стойки, пояса и X-раскосы. Ставится на кровлю.
function lattice(x, y0, y1, w, col) {
  const n = Math.max(2, Math.round((y0 - y1) / (w * 1.1)));
  let d = `M${n1(x)},${n1(y0)}V${n1(y1)}M${n1(x + w)},${n1(y0)}V${n1(y1)}`;
  for (let k = 0; k < n; k++) {
    const a = y0 + (y1 - y0) * k / n, b = y0 + (y1 - y0) * (k + 1) / n;
    d += `M${n1(x)},${n1(a)}H${n1(x + w)}M${n1(x)},${n1(a)}L${n1(x + w)},${n1(b)}M${n1(x + w)},${n1(a)}L${n1(x)},${n1(b)}`;
  }
  d += `M${n1(x)},${n1(y1)}H${n1(x + w)}`;
  return `<path d="${d}" stroke="${col}" stroke-width="0.7" fill="none"/>`;
}
// Ферма-переход: пояса + раскосы. Упирается в стены обеих башен.
function truss(x1, x2, y, th, col) {
  const n = Math.max(2, Math.round((x2 - x1) / (th * 1.2)));
  let d = `M${n1(x1)},${n1(y)}H${n1(x2)}M${n1(x1)},${n1(y - th)}H${n1(x2)}`;
  for (let k = 0; k < n; k++) {
    const a = x1 + (x2 - x1) * k / n, b = x1 + (x2 - x1) * (k + 1) / n;
    d += `M${n1(a)},${n1(y)}L${n1(b)},${n1(y - th)}M${n1(a)},${n1(y - th)}L${n1(b)},${n1(y)}M${n1(a)},${n1(y)}V${n1(y - th)}`;
  }
  return `<path d="${d}" stroke="${col}" stroke-width="0.7" fill="none"/>`;
}
// Провисающие тросы: пучок из 2–3 линий с разной стрелой провиса.
function cables(x1, y1, x2, y2, R, col) {
  let d = '';
  const n = ri(R, 2, 3), sp = Math.abs(x2 - x1);
  for (let k = 0; k < n; k++) {
    const sag = sp * rnd(R, 0.1, 0.3) + k * sp * 0.05, dy = k * 4;
    d += `M${n1(x1)},${n1(y1 + dy)}Q${n1((x1 + x2) / 2)},${n1(Math.max(y1, y2) + sag)} ${n1(x2)},${n1(y2 + dy)}`;
  }
  return `<path d="${d}" stroke="${col}" stroke-width="0.7" fill="none"/>`;
}

// Зажжённые окна: редкая россыпь тёплых точек по фасаду. Плотность и яркость —
// от нехватки дневного света (P.day), поэтому в полдень землеподобного мира их
// нет вовсе, а у ледяного мира на 6 а.е. фасад светится.
function litWindows(R, b, P) {
  const k = Math.max(0, Math.min(1, (0.62 - P.day) / 0.62));
  const cw = Math.max(1.1, b.w / ri(R, 4, 8)), ch = Math.max(1.1, cw * 0.9);
  let d = '', g = 0;
  for (let yy = b.yTop + ch; yy < b.yTop + b.hPx - ch && g < 260; yy += ch * 2.1)
    for (let xx = b.x + cw; xx < b.x + b.w - cw && g < 260; xx += cw * 2.1)
      if (R() < 0.16 + 0.5 * k) { d += `M${n1(xx)},${n1(yy)}h${n1(cw)}v${n1(ch)}h${n1(-cw)}Z`; g++; }
  return d ? `<path d="${d}" fill="${P.glow}" fill-opacity="${n1(0.25 + 0.65 * k)}"/>` : '';
}

// ── §7. Один дом ─────────────────────────────────────────────
function drawBuilding(R, o) {
  const P = o.pal, w = o.w, h = o.h;
  const kind = o.kind || (R() < 0.34 ? 'jag' : R() < 0.62 ? 'step' : R() < 0.85 ? 'prism' : 'slab');
  const lit = o.lit == null ? R() < 0.5 : o.lit;            // с какой стороны тень
  const bl = stack(R, w, h, kind);
  const solid = P.solid;
  let s = '';

  bl.forEach((b, i) => {
    const top = i === bl.length - 1;
    b.yTop = h - b.y1; b.hPx = b.y1 - b.y0;
    // Верхнее ребро может быть срезано — скос идёт по самому блоку, не приклейкой.
    const cut = top && kind !== 'slab' && R() < 0.5 ? b.hPx * rnd(R, 0.1, 0.45) : 0;
    // ⚠️ Сторона среза решается ОДНИМ броском на блок. Когда её выбирали отдельно
    // для каждого угла, углы опускались вразнобой — и над кровлей оставался
    // «улетевший» тонкий клин: то самое рваное ребро в воздухе.
    const cutRight = R() < 0.5;
    // Низ блока опущен на полпикселя ПОД соседний: встык два path'а дают волосяную
    // щель — сквозь неё просвечивает небо и по всей башне идёт красная нитка.
    const yb = h - b.y0 + (i ? 0.6 : 0);
    const q = [[b.x, yb], [b.x + b.w, yb], [b.x + b.w, b.yTop + (cutRight ? cut : 0)], [b.x, b.yTop + (cutRight ? 0 : cut)]];
    s += PT(q, P.paper);
    if (solid) return;                                       // дальний план: только силуэт

    // Тень: узкая грань сплошным чёрным либо плотной штриховкой — оба варианта
    // есть на референсе, чередование не даёт фасадам стать одинаковыми.
    // Верх теневой полосы берётся ПО СВОЕЙ стороне среза, иначе она торчит за скос.
    const sw = b.w * rnd(R, 0.1, 0.22), sx = lit ? b.x : b.x + b.w - sw;
    const shTop = b.yTop + ((lit ? !cutRight : cutRight) ? cut : 0);
    s += R() < 0.55 ? R2(sx, shTop, sw, h - b.y0 - shTop, P.ink)
                    : hatch(sx, shTop, sw, h - b.y0 - shTop, P.ink, 0.9, 62);

    // Мотив НА БЛОК: у соседних блоков одной башни он разный.
    const inner = { x: lit ? b.x + sw : b.x, w: b.w - sw, yTop: b.yTop + cut + 1, hPx: b.hPx - cut - 2 };
    if (inner.w > 2 && inner.hPx > 4) {
      const names = P.fine ? ['checker', 'slots', 'bands', 'boxes', 'field', 'hatch'] : ['slots', 'bands', 'field'];
      s += motif(R, inner, P, names[Math.floor(R() * names.length)], false);
      // Мало света снаружи — свет изнутри: чем темнее мир, тем больше зажжённых
      // окон. Это единственное, что оживляет фасад на далёкой орбите, где
      // штриховка и тень почти неразличимы.
      if (P.day < 0.62) s += litWindows(R, inner, P);
    }
    // Вынос-консоль: небольшой блок за габарит. На референсе такие «полки» повсюду.
    // Вынос — ОБЪЁМ, а не планка: высота не меньше его вылета, иначе получается
    // висящая в воздухе палка. Плюс подпор в стену, чтобы было видно, на чём держится.
    if (P.fine && !top && R() < 0.35) {
      const cw = b.w * rnd(R, 0.22, 0.55);
      const ch = Math.max(cw * 0.9, b.hPx * rnd(R, 0.12, 0.26));
      const left = R() < 0.5, cx = left ? b.x - cw : b.x + b.w;
      const cy = b.yTop + b.hPx * rnd(R, 0.15, 0.6);
      s += R2(cx, cy, cw, ch, P.paper);
      s += R2(cx, cy + ch * 0.62, cw, ch * 0.38, P.ink);     // тень под выносом
      s += PT(left ? [[b.x, cy + ch], [b.x, cy + ch + ch * 0.8], [b.x - cw * 0.5, cy + ch]]
                   : [[b.x + b.w, cy + ch], [b.x + b.w, cy + ch + ch * 0.8], [b.x + b.w + cw * 0.5, cy + ch]], P.ink);
    }
  });

  // Венец: решётчатая мачта или игла. Крепится к последнему блоку.
  const t = bl[bl.length - 1], ty = h - t.y1;
  if (!solid && P.fine && R() < 0.55) {
    if (R() < 0.5 && t.w > 5) {
      const lw = Math.max(2.5, Math.min(t.w * 0.4, t.w - 1));
      // ⚠️ Ставим мачту ТОЛЬКО в пределах верхнего блока. Раньше правая граница
      // считалась как 0.7−lw/w и у узких блоков уходила в минус: мачта съезжала
      // за кровлю и висела в воздухе рядом с башней.
      s += lattice(t.x + rnd(R, 0, Math.max(0, t.w - lw)), ty, ty - h * rnd(R, 0.06, 0.22), lw, P.ink);
    } else {
      const mx = t.x + t.w * rnd(R, 0.3, 0.7), mh = h * rnd(R, 0.05, 0.2);
      s += PT([[mx - 0.7, ty], [mx + 0.7, ty], [mx + 0.25, ty - mh], [mx - 0.25, ty - mh]], P.ink);
    }
  }
  return { svg: s, roofY: ty, w: w, h: h, blocks: bl, edgeAt: yL => {   // стена на высоте yL
    for (let i = bl.length - 1; i >= 0; i--) if (yL >= bl[i].y0 && yL <= bl[i].y1) return bl[i];
    return bl[0];
  } };
}

// ── §8. Город ────────────────────────────────────────────────
// Движок слоёв вынесен из city(): им же пользуется сцена (§13), которой нужен не
// только svg, но и НАБОР ПОСТАВЛЕННЫХ ДОМОВ — чтобы повесить флаги на реальные
// кровли, а не в случайные точки неба.
function cityBody(R, cfg) {
  const W = cfg.W, H = cfg.H, horizon = cfg.horizon, layers = cfg.layers, sky = cfg.sky;
  const D = cfg.dens || popProfile(null);                   // профиль застройки (§9)
  const zone = cfg.charZone;                                // полоса под персонажа
  const ruin = Math.max(0, Math.min(1, cfg.ruin || 0));     // 0 — целый город, 1 — пепелище
  let body = '', nearest = [];
  for (let L = layers - 1; L >= 0; L--) {                   // от дальнего к ближнему
    const depth = layers === 1 ? 0 : L / (layers - 1);
    const P = palette(sky, depth, cfg.day);
    if (cfg.light) P.fine = false;                          // без мелких мотивов и консолей
    const scale = 1 - depth * 0.3;
    const put = [];
    let x = -30 - R() * 40, guard = 0;
    while (x < W + 20 && guard++ < 220) {
      const t = R();
      // ОБЛЕГЧЁННЫЙ РЕЖИМ (light): дома шире, мелочь на фасадах отключена. Полный
      // кадр — это тысячи узлов на слой; как фон под интерфейсом он грузит
      // отрисовку впустую, деталь там всё равно не разглядеть.
      const w = (t < 0.18 ? rnd(R, 55, 110) : t < 0.72 ? rnd(R, 24, 52) : rnd(R, 11, 24)) * scale * (cfg.light ? 1.7 : 1);
      const tall = R() < D.tallP;
      let h = H * (tall ? rnd(R, D.hi * 0.55, D.hi) : rnd(R, D.lo, D.lo + (D.hi - D.lo) * 0.55)) * scale;
      // РАЗРУШЕННЫЙ ГОРОД (§14): башню срезает взрывом на случайной высоте и
      // кренит на основание. Отдельный «обломочный» силуэт рисовать не нужно —
      // обрубок тех же правил читается страшнее, чем нарочито битая геометрия.
      let tilt = 0;
      if (ruin && R() < 0.62 * ruin) { h *= rnd(R, 0.3, 0.78); tilt = rnd(R, -4, 4) * ruin; }
      // Полоса, отведённая персонажу новеллы: застройка там приседает, чтобы
      // силуэт девочки читался на небе, а не тонул в фасадах.
      if (zone && depth < 0.34 && x + w > zone[0] * W && x < zone[1] * W) h = Math.min(h, H * 0.2);
      // ⚠️ Теневая грань смотрит ПРОЧЬ ОТ СВЕТИЛА (cfg.lit), а не куда выпал бросок:
      // раньше половина города стояла в тень к солнцу, и небо со звездой жило само
      // по себе. Малая доля исключений оставлена нарочно — дома развёрнуты
      // по-разному, и глухая одинаковость фасадов читается как обои.
      const litSide = cfg.lit == null ? R() < 0.5 : (R() < 0.12 ? !cfg.lit : cfg.lit);
      const b = drawBuilding(R, { w: w, h: h, pal: P, lit: litSide });
      const bx = x, by = horizon - h;
      // Крен считается ВОКРУГ ОСНОВАНИЯ (0, h), иначе башня отрывается от земли.
      const tr = tilt ? ` rotate(${n1(tilt)},${n1(w / 2)},${n1(h)})` : '';
      body += `<g transform="translate(${n1(bx)},${n1(by)})${tr}">${b.svg}</g>`;
      if (ruin && tilt && R() < 0.5) body += plume(R, bx + w * 0.5, by, H * rnd(R, 0.2, 0.6), w * rnd(R, 0.5, 1.3), P.ink);
      put.push({ bx: bx, by: by, h: h, w: w, b: b, roofY: by + b.roofY, depth: depth });
      // Разрежённость от населения: у деревни между домами пустая земля.
      x += w * rnd(R, 0.78, 1.06) + (R() < 0.2 ? rnd(R, 4, 20) : 0)
         + (R() < D.gap ? w * rnd(R, 0.6, 2.6) : 0);
    }
    if (depth < 0.34) nearest = put;
    // Фермы и тросы — только ближний план, иначе в глубине выходит грязь.
    if (depth < 0.34) for (let i = 0; i < put.length - 1; i++) {
      const a = put[i], c = put[i + 1];
      if (a.h < H * 0.3 || c.h < H * 0.3) continue;
      const r = R();
      if (r < 0.2) {                                        // ферма-переход
        const y = Math.max(a.roofY, c.roofY) + rnd(R, 20, 90);
        const ea = a.b.edgeAt(a.by + a.h - y), ec = c.b.edgeAt(c.by + c.h - y);
        const x1 = a.bx + ea.x + ea.w, x2 = c.bx + ec.x;
        if (x2 - x1 > 12 && x2 - x1 < 260) body += truss(x1, x2, y, rnd(R, 5, 11), P.ink);
      } else if (r < 0.4) {                                 // пучок тросов
        // ⚠️ Оба конца берутся с ОБРАЩЁННЫХ ДРУГ К ДРУГУ стен: правая кромка левой
        // башни и левая кромка правой. Раньше у обеих брался левый край верхнего
        // блока — левый конец троса начинался в пустом небе слева от дома.
        const at = a.b.blocks[a.b.blocks.length - 1], ct = c.b.blocks[c.b.blocks.length - 1];
        const x1 = a.bx + at.x + at.w, x2 = c.bx + ct.x;
        if (x2 - x1 < 8 || x2 - x1 > 300) continue;
        body += cables(x1, a.roofY + rnd(R, 4, 30), x2, c.roofY + rnd(R, 4, 30), R, P.ink);
      }
    }
  }
  return { svg: body, near: nearest };
}

function city(opt) {
  opt = opt || {};
  const W = opt.w || 1600, H = opt.h || 700;
  const sky = opt.sky || '#c1121a', sky2 = opt.sky2 || mix(sky, '#000000', 0.28);
  const seed = opt.seed == null ? (Math.random() * 1e9) | 0 : opt.seed;
  const R = rng(seed);
  const id = 'cg' + (seed >>> 0).toString(36);
  const b = cityBody(R, {
    W: W, H: H, sky: sky, layers: opt.layers || 3,
    horizon: opt.horizon == null ? H : opt.horizon,
    dens: opt.pop == null ? popProfile(null) : popProfile(opt.pop),
    charZone: opt.charZone || null
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMax slice">`
    + `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${sky2}"/><stop offset="0.7" stop-color="${sky}"/><stop offset="1" stop-color="${mix(sky, '#ffffff', 0.06)}"/>`
    + `</linearGradient></defs>`
    + `<rect width="${W}" height="${H}" fill="url(#${id})"/>${b.svg}</svg>`;
}

// Один дом отдельной картинкой.
function building(opt) {
  opt = opt || {};
  const W = opt.w || 160, H = opt.h || 420, sky = opt.sky || '#c1121a';
  const seed = opt.seed == null ? (Math.random() * 1e9) | 0 : opt.seed;
  const R = rng(seed);
  const b = drawBuilding(R, { w: W * 0.56, h: H * 0.88, pal: palette(sky, opt.depth || 0), kind: opt.kind });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
    + (opt.bg === false ? '' : `<rect width="${W}" height="${H}" fill="${sky}"/>`)
    + `<g transform="translate(${n1(W * 0.22)},${n1(H * 0.1)})">${b.svg}</g></svg>`;
}

// ── §8б. Дым пожара ──────────────────────────────────────────
// Столб дыма тем же языком, что и всё остальное: не размытие, а ШТРИХ — пучок
// расходящихся кверху дуг. Прозрачность одна на весь столб, чтобы не плодить
// полутонов, которых в этой графике нет.
function plume(R, x, y, h, w, col) {
  let d = '';
  const n = ri(R, 4, 7), dr = rnd(R, -0.4, 0.4);            // общий снос ветром
  for (let k = 0; k < n; k++) {
    const off = (k / (n - 1) - 0.5) * w;
    const tipX = x + off * 3.2 + h * dr, tipY = y - h;
    d += `M${n1(x + off * 0.4)},${n1(y)}Q${n1(x + off * 1.6 + h * dr * 0.3)},${n1(y - h * 0.55)} ${n1(tipX)},${n1(tipY)}`;
  }
  return `<path d="${d}" stroke="${col}" stroke-width="${n1(Math.max(0.8, w * 0.14))}" fill="none" opacity="0.5"/>`;
}

// Гряда обломков вдоль горизонта: ломаная из мелких клиньев.
function rubble(R, W, gy, unit, col) {
  const u = Math.max(1.2, unit);
  let d = '';
  for (let x = -10; x < W + 10;) {
    const w = u * rnd(R, 2, 9), h = u * rnd(R, 0.6, 3.2);
    d += `M${n1(x)},${n1(gy)}L${n1(x + w * 0.35)},${n1(gy - h)}L${n1(x + w)},${n1(gy)}Z`;
    x += w * rnd(R, 0.7, 1.4);
  }
  return `<path d="${d}" fill="${col}"/>`;
}

// ── §9. Население → плотность застройки ──────────────────────
// Пришло население (в тысячах) — вышло, СКОЛЬКО домов видно и какие они. Шкала
// логарифмическая: между хутором и городом разница должна читаться сразу, а между
// мегаполисом и сверхмегаполисом — уже почти нет, иначе кадр превращается в частокол.
function popProfile(pop) {
  const p = Math.max(0, +pop || 0);
  const t = Math.min(1, Math.log10(1 + p / 2) / Math.log10(1 + 4000 / 2));
  return {
    t: t,
    pop: p,
    layers: p < 3 ? 1 : p < 40 ? 2 : p < 500 ? 3 : 4,
    tallP: 0.015 + 0.4 * t * t,        // доля высоток растёт медленно, потом рывком
    hi: 0.2 + 0.74 * t,                // потолок высот
    lo: 0.05 + 0.11 * t,
    gap: 0.6 * (1 - t) * (1 - t),      // разрывы застройки: у деревни — поле между домами
    folk: t                            // сколько мелочи у земли
  };
}

// ── §10. Масштабная мелочь ───────────────────────────────────
// Постройка игрока «огромная» не сама по себе, а ОТНОСИТЕЛЬНО чего-то знакомого.
// Поэтому у подножия колоссов стоят фигурки в человеческий рост и техника: без них
// орудие ПРО читается как обычная башня, снятая с другого расстояния.
function tinyFolk(R, x0, x1, gy, col, n, unit) {
  const u = Math.max(1.1, unit || 3);                       // рост человека в пикселях
  let d = '';
  for (let k = 0; k < n; k++) {
    const x = rnd(R, x0, x1);
    if (R() < 0.32) {                                       // машина
      const w = u * rnd(R, 1.6, 3.2), h = u * 0.5;
      d += `M${n1(x)},${n1(gy)}h${n1(w)}v${n1(-h)}h${n1(-w * 0.3)}v${n1(-h * 0.6)}h${n1(-w * 0.4)}v${n1(h * 0.6)}h${n1(-w * 0.3)}Z`;
    } else {                                                // человек
      const w = Math.max(0.7, u * 0.34);
      d += `M${n1(x)},${n1(gy)}h${n1(w)}v${n1(-u)}h${n1(-w)}Z`;
    }
  }
  return d ? `<path d="${d}" fill="${col}"/>` : '';
}
// Повёрнутый брус — из него собираются стволы, опоры и стрелы кранов.
function bar(x, y, ang, len, th, col) {
  const c = Math.cos(ang), s = Math.sin(ang), nx = -s * th / 2, ny = c * th / 2;
  return PT([[x + nx, y + ny], [x + c * len + nx, y + s * len + ny],
             [x + c * len - nx, y + s * len - ny], [x - nx, y - ny]], col);
}

// ── §11. Постройки игрока ────────────────────────────────────
// Это не «дома побольше»: у каждой свой узнаваемый силуэт и СВОЙ масштаб в долях
// кадра. Всё, что игрок построил руками, рисуется поверх ближнего плана и режет
// небо выше рядовой застройки — иначе постройка теряется в городе.
// Локальные координаты: 0..w по ширине, 0..h сверху вниз, земля — y = h.
const LM_H = {                                              // доля высоты кадра
  abm: 0.98, shipyard: 0.86, shield: 0.8, spaceport: 0.72,
  reactor: 0.56, palace: 0.5, temple: 0.46, factory: 0.36, mine: 0.24
};
const LM_W = { abm: 0.9, shipyard: 1.5, shield: 1.1, spaceport: 0.7,
  reactor: 0.95, palace: 1.3, temple: 0.8, factory: 1.25, mine: 0.9 };
const LM_RU = {
  abm: 'Батарея ПРО', shipyard: 'Верфь', shield: 'Щитовой пилон',
  spaceport: 'Космопорт', reactor: 'Реактор', palace: 'Дворец', temple: 'Храм',
  factory: 'Завод', mine: 'Рудник'
};

function landmark(R, kind, P, w, h, unit) {
  const gy = h, ink = P.ink, pap = P.paper;
  const fh = Math.max(1.4, unit * 2.6);                     // ЭТАЖ = 2.6 роста человека
  let s = '';
  // Корпус постройки лепится ТЕМ ЖЕ drawBuilding, что и рядовые дома: иначе колосс
  // выпадает из графики — рядом фасады со штриховкой и мотивами, а у него голая
  // геометрия. Сверху потом добавляется только опознавательная часть.
  const mass = (mx, mw, mh, kd) => {
    const b = drawBuilding(R, { w: mw, h: mh, pal: P, kind: kd || 'step', lit: false });
    return `<g transform="translate(${n1(mx)},${n1(gy - mh)})">${b.svg}</g>`;
  };
  // Поэтажные ленты — главный носитель масштаба: по ним глаз считает этажи и сам
  // понимает, что ствол орудия шириной в двенадцать из них.
  // ⚠️ tp — СУЖЕНИЕ КОРПУСА КВЕРХУ (доля ширины на сторону). Без него лента этажа
  // рисовалась одной длины сверху донизу и у всякой трапеции/ступени вылезала за
  // стену: над кровлей висели обрубки линий. Лента обязана жить внутри силуэта.
  const floors = (x, y, ww, hh, tp) => {
    if (hh < fh * 2) return '';
    const k = tp || 0;
    let d = '';
    for (let yy = y + fh; yy < y + hh - fh * 0.4; yy += fh) {
      const inn = k * ww * (1 - (yy - y) / hh);              // сверху максимум, у земли 0
      d += `M${n1(x + inn)},${n1(yy)}h${n1(ww - inn * 2)}`;
    }
    return `<path d="${d}" stroke="${ink}" stroke-width="${n1(Math.min(0.9, fh * 0.16))}" fill="none" opacity="0.85"/>`;
  };
  const plinth = (pw, ph) => {                              // общий стилобат
    const px = (w - pw) / 2;
    let o = PT([[px, gy], [px + pw, gy], [px + pw * 0.94, gy - ph], [px + pw * 0.06, gy - ph]], pap);
    o += hatch(px + pw * 0.06, gy - ph, pw * 0.88, ph, ink, 0.55, 62);
    o += floors(px + pw * 0.08, gy - ph, pw * 0.84, ph);
    o += R2(px + pw * 0.06, gy - ph, pw * 0.88, Math.max(0.8, ph * 0.09), ink);
    return o;
  };

  if (kind === 'abm') {                                     // БАТАРЕЯ ПРО: главный колосс
    const bh = h * 0.22, bw = w * 0.82;
    s += plinth(bw, bh);
    // Цитадель под барабаном. ⚠️ Раньше её лепил drawBuilding ('step'), а ленты
    // этажей клались поверх ПРЯМОУГОЛЬНИКОМ — ступени стопки уходили внутрь, и
    // половина линий висела в небе рядом с корпусом. Теперь корпус — одна честная
    // трапеция с известным сужением, и этажи считаются по ней же.
    const cw = bw * 0.5, mh = h * 0.4, mx = (w - cw) / 2;
    const cTop = gy - bh * 0.86 - mh, cBot = gy - bh * 0.86, tp = 0.1;
    s += PT([[mx, cBot], [mx + cw, cBot], [mx + cw * (1 - tp), cTop], [mx + cw * tp, cTop]], pap);
    s += floors(mx + cw * 0.06, cTop, cw * 0.88, cBot - cTop, tp);
    // теневая грань — узкой полосой внутри сужения, чтобы не свисать вбок
    s += hatch(mx + cw * tp, cTop, cw * 0.11, cBot - cTop, ink, 0.9, 62);
    // казематы по бокам стилобата — основание обитаемо, а не просто тумба
    s += R2((w - bw) / 2 - w * 0.05, gy - bh * 0.5, w * 0.1, bh * 0.5, pap);
    s += R2(w / 2 + bw / 2 - w * 0.05, gy - bh * 0.66, w * 0.1, bh * 0.66, pap);
    // барабан наведения — садится НА цитадель (подошва барабана перекрывает кровлю)
    // ⚠️ Барабан лишь чуть шире цитадели (было ×1.32): широкая шляпка на узком
    // стволе давала силуэт гриба, а не батареи.
    const tw = cw * 1.08, tx = (w - tw) / 2, th = h * 0.13, ty = cTop - th * 0.72;
    s += PT([[tx, ty + th], [tx + tw, ty + th], [tx + tw * 0.88, ty], [tx + tw * 0.12, ty]], pap);
    s += R2(tx + tw * 0.06, ty + th * 0.62, tw * 0.88, th * 0.16, ink);
    s += hatch(tx + tw * 0.12, ty, tw * 0.76, th * 0.56, ink, 0.7, 62);
    // ⚠️ СТВОЛОВ НЕТ. Задранное дуло через полкадра перечёркивало небо и ломало
    // силуэт города — батарея читается по барабану наведения и цитадели, а не по
    // торчащей палке. Всё, что было ниже (стволы, дульный тормоз, люлька), снято.
    const px = w / 2;
    // ⚠️ Стволы стоят ВПРИТЫК: при разносе 0.62·thk между двумя брусьями оставалась
    // щель в 0.24·thk, и сквозь неё вдоль всего орудия шла красная нитка неба.
    // Разделяет их теперь ШОВ — тонкая чёрная линия, а не дыра.
    // Вместо орудия — плоская рубка наведения: ещё одна ступень того же силуэта.
    const kh = th * 0.5, ky = ty - kh;
    s += PT([[tx + tw * 0.16, ty], [tx + tw * 0.84, ty], [tx + tw * 0.72, ky], [tx + tw * 0.28, ky]], pap);
    s += R2(tx + tw * 0.3, ky + kh * 0.35, tw * 0.4, Math.max(0.8, kh * 0.14), ink);
    s += R2(px - tw * 0.015, ky - th * 0.55, tw * 0.03, th * 0.55, ink);   // антенна
    // Мачта — НА стилобате: на w*0.05 она стояла левее его кромки ((w−bw)/2), в воздухе.
    s += lattice((w - bw) / 2 + bw * 0.04, gy - bh, gy - bh - h * 0.22, Math.max(2.5, fh * 2), ink);
    s += tinyFolk(R, (w - bw) / 2, w / 2 + bw / 2, gy, ink, 11, unit);
  } else if (kind === 'shipyard') {                         // ВЕРФЬ: рама с корпусом внутри
    const bh = h * 0.12;
    s += plinth(w, bh);
    s += mass(w * 0.06, w * 0.2, h * 0.3, 'slab');          // цех у левой опоры
    s += mass(w * 0.74, w * 0.16, h * 0.24, 'slab');
    const y0 = gy - bh, y1 = h * 0.06, lw = w * 0.05;
    s += lattice(w * 0.03, y0, y1, lw, ink);
    s += lattice(w * 0.92, y0, y1, lw, ink);
    s += truss(w * 0.03, w * 0.97, y1 + h * 0.06, h * 0.05, ink);
    s += truss(w * 0.03, w * 0.97, y0 - h * 0.3, h * 0.045, ink);
    // КОРПУС В СТАПЕЛЕ. ⚠️ Был перекошенной плитой во всю раму, да ещё со штриховкой
    // прямоугольником поверх наклонной кромки — та вылезала в небо серым пятном.
    // Теперь это узнаваемый корабль: ровная палубная линия, острый нос, развал бортов,
    // шпангоуты вертикальными рёбрами ВНУТРИ обвода. Никакой штриховки поверх.
    const hy = y0 - h * 0.09, hh2 = h * 0.11;                 // палуба и высота борта
    const x0h = w * 0.2, x1h = w * 0.78, nose = w * 0.12;     // нос уходит вправо
    for (let k = 0; k < 5; k++)                               // кильблоки под днищем
      s += R2(x0h + (x1h - x0h - nose) * (k + 0.5) / 5, hy, w * 0.022, y0 - hy, ink);
    s += PT([[x0h + w * 0.03, hy], [x1h - nose, hy], [x1h, hy - hh2 * 0.55],
             [x1h - nose * 0.2, hy - hh2], [x0h, hy - hh2]], pap);
    let rib = '';                                             // шпангоуты
    for (let k = 1; k < 7; k++) {
      const rx = x0h + (x1h - nose - x0h) * k / 7;
      rib += `M${n1(rx)},${n1(hy - hh2 * 0.9)}V${n1(hy - hh2 * 0.08)}`;
    }
    s += `<path d="${rib}" stroke="${ink}" stroke-width="${n1(Math.max(0.6, w * 0.005))}" fill="none" opacity="0.8"/>`;
    s += R2(x0h, hy - hh2, x1h - nose * 0.2 - x0h, Math.max(0.9, hh2 * 0.12), ink);  // палубный пояс
    s += bar(w * 0.5, y1 + h * 0.06, Math.PI / 2, h * 0.14, w * 0.016, ink);  // кран-балка
    s += tinyFolk(R, w * 0.05, w * 0.95, gy, ink, 12, unit);
  } else if (kind === 'shield') {                           // ПИЛОН ЩИТА: игла с поясами
    const bh = h * 0.14;
    s += plinth(w * 0.6, bh);
    const cw = w * 0.2, cx = (w - cw) / 2, top = h * 0.1;
    s += mass(cx - cw * 0.75, cw * 0.6, h * 0.18, 'slab');  // подстанции у подножия
    s += mass(cx + cw * 1.15, cw * 0.5, h * 0.13, 'slab');
    s += PT([[cx, gy - bh], [cx + cw, gy - bh], [cx + cw * 0.62, top], [cx + cw * 0.38, top]], pap);
    // Игла сужается с cw до 0.24·cw — ленты этажей обязаны сужаться вместе с ней,
    // иначе сверху они на треть ширины торчат в небо по обе стороны от иглы.
    s += floors(cx + cw * 0.06, top, cw * 0.88, gy - bh - top, 0.36);
    for (let k = 0; k < 5; k++) {
      const yy = gy - bh - (gy - bh - top) * (k + 0.6) / 5.6, ew = cw * (1.5 - k * 0.16);
      s += R2((w - ew) / 2, yy, ew, Math.max(1, h * 0.012), ink);
    }
    s += bar(cx + cw / 2, top, -Math.PI / 2, h * 0.09, w * 0.012, ink);
    s += tinyFolk(R, w * 0.2, w * 0.8, gy, ink, 6, unit);
  } else if (kind === 'spaceport') {                        // КОСМОПОРТ: вышка + ферма
    const bh = h * 0.16;
    s += plinth(w * 0.9, bh);
    const cw = w * 0.34, cx = (w - cw) / 2;
    s += mass(w * 0.02, w * 0.22, h * 0.26, 'slab');        // терминал сбоку от вышки
    s += R2(cx, h * 0.24, cw, gy - bh - h * 0.24, pap);
    s += hatch(cx, h * 0.24, cw * 0.28, gy - bh - h * 0.24, ink, 0.8, 62);
    s += floors(cx + cw * 0.3, h * 0.24, cw * 0.66, gy - bh - h * 0.24);
    s += PT([[cx - cw * 0.3, h * 0.24], [cx + cw * 1.3, h * 0.24], [cx + cw * 1.1, h * 0.14], [cx - cw * 0.1, h * 0.14]], pap);
    s += R2(cx - cw * 0.1, h * 0.16, cw * 1.2, h * 0.035, ink);
    s += lattice(cx + cw * 0.4, h * 0.14, h * 0.03, cw * 0.2, ink);
    s += tinyFolk(R, w * 0.1, w * 0.9, gy, ink, 8, unit);
  } else if (kind === 'reactor') {                          // РЕАКТОР: градирня + купол
    const bh = h * 0.1;
    s += plinth(w, bh);
    const tw = w * 0.42, tx = w * 0.04, ty = h * 0.12;
    s += PT([[tx, gy - bh], [tx + tw, gy - bh], [tx + tw * 0.74, ty], [tx + tw * 0.26, ty]], pap);
    s += hatch(tx + tw * 0.26, ty, tw * 0.2, gy - bh - ty, ink, 0.9, 62);
    const dw = w * 0.4, dx = w * 0.56, dy = gy - bh - h * 0.3;
    s += `<path d="M${n1(dx)},${n1(gy - bh)}V${n1(dy + h * 0.1)}A${n1(dw / 2)},${n1(h * 0.16)} 0 0 1 ${n1(dx + dw)},${n1(dy + h * 0.1)}V${n1(gy - bh)}Z" fill="${pap}"/>`;
    s += hatch(dx, dy + h * 0.12, dw * 0.3, h * 0.18, ink, 0.7, 62);
    s += mass(w * 0.46, w * 0.12, h * 0.34, 'step');        // машинный зал между ними
    s += tinyFolk(R, w * 0.05, w * 0.95, gy, ink, 6, unit);
  } else if (kind === 'palace') {                           // ДВОРЕЦ: столица державы
    const bh = h * 0.13;
    s += plinth(w, bh);
    const bw = w * 0.86, bx = w * 0.07, by = gy - bh - h * 0.42;
    s += mass(bx - w * 0.05, w * 0.14, h * 0.3, 'slab');    // флигели по краям
    s += mass(bx + bw - w * 0.09, w * 0.14, h * 0.3, 'slab');
    s += R2(bx, by, bw, h * 0.42, pap);
    const n = 9;                                            // колоннада вместо окон
    let d = '';
    for (let k = 0; k < n; k++) d += `M${n1(bx + bw * (k + 0.5) / n - bw * 0.012)},${n1(by + h * 0.08)}h${n1(bw * 0.024)}v${n1(h * 0.34)}h${n1(-bw * 0.024)}Z`;
    s += `<path d="${d}" fill="${ink}"/>`;
    s += PT([[bx - bw * 0.03, by + h * 0.08], [bx + bw * 1.03, by + h * 0.08], [bx + bw * 0.5, by - h * 0.09]], pap);
    const cw = w * 0.22, cx = (w - cw) / 2;
    s += `<path d="M${n1(cx)},${n1(by - h * 0.05)}A${n1(cw / 2)},${n1(h * 0.15)} 0 0 1 ${n1(cx + cw)},${n1(by - h * 0.05)}Z" fill="${pap}"/>`;
    s += bar(w / 2, by - h * 0.19, -Math.PI / 2, h * 0.1, w * 0.01, ink);
    s += tinyFolk(R, w * 0.05, w * 0.95, gy, ink, 10, unit);
  } else if (kind === 'temple') {                           // ХРАМ: зиккурат со шпилем
    const bh = h * 0.1; s += plinth(w, bh);
    let py = gy - bh, pw = w * 0.9;
    for (let k = 0; k < 4; k++) {
      const ph = h * 0.16;
      s += R2((w - pw) / 2, py - ph, pw, ph, pap);
      s += R2((w - pw) / 2, py - ph, pw * 0.14, ph, ink);
      s += floors((w - pw) / 2 + pw * 0.18, py - ph, pw * 0.8, ph);
      py -= ph; pw *= 0.72;
    }
    s += PT([[w / 2 - w * 0.03, py], [w / 2 + w * 0.03, py], [w / 2, py - h * 0.16]], pap);
    s += tinyFolk(R, w * 0.1, w * 0.9, gy, ink, 7, unit);
  } else if (kind === 'factory') {                          // ЗАВОД: корпус и трубы
    const bh = h * 0.1; s += plinth(w, bh);
    s += R2(w * 0.05, gy - bh - h * 0.5, w * 0.62, h * 0.5, pap);
    s += hatch(w * 0.05, gy - bh - h * 0.5, w * 0.62, h * 0.5, ink, 0.35, 62);
    s += floors(w * 0.08, gy - bh - h * 0.5, w * 0.56, h * 0.5);
    let d = '';                                             // пилообразная кровля
    for (let k = 0; k < 5; k++) {
      const x0 = w * 0.05 + w * 0.62 * k / 5, x1 = w * 0.05 + w * 0.62 * (k + 1) / 5;
      d += `M${n1(x0)},${n1(gy - bh - h * 0.5)}L${n1(x1)},${n1(gy - bh - h * 0.5)}L${n1(x1)},${n1(gy - bh - h * 0.58)}Z`;
    }
    s += `<path d="${d}" fill="${pap}"/>`;
    for (let k = 0; k < 3; k++) {
      const cx = w * (0.72 + k * 0.1);
      s += PT([[cx, gy - bh], [cx + w * 0.055, gy - bh], [cx + w * 0.045, h * (0.1 + k * 0.08)], [cx + w * 0.01, h * (0.1 + k * 0.08)]], pap);
      s += R2(cx + w * 0.005, h * (0.1 + k * 0.08), w * 0.05, h * 0.02, ink);
    }
    s += tinyFolk(R, w * 0.05, w * 0.95, gy, ink, 8, unit);
  } else {                                                  // РУДНИК: копёр
    const bh = h * 0.16; s += plinth(w * 0.8, bh);
    s += lattice(w * 0.4, gy - bh, h * 0.1, w * 0.14, ink);
    s += truss(w * 0.12, w * 0.4, gy - bh - h * 0.1, h * 0.06, ink);
    s += R2(w * 0.06, gy - bh - h * 0.3, w * 0.2, h * 0.3, pap);
    s += tinyFolk(R, w * 0.05, w * 0.95, gy, ink, 5, unit);
  }
  return s;
}

// ── §12. Флаги державы ───────────────────────────────────────
// Флаг — единственное цветное пятно в чёрно-белом кадре, поэтому его мало и он
// стоит там, где взгляд и так останавливается: кровля высотки, стилобат колосса.
// f = {a, b, emblem (символ), href (герб картинкой)}.
// Полотнище ПО ФАСАДУ: узкая длинная лента, прижатая к стене, снизу — ласточкин
// хвост. Именно так флаг читается частью здания; квадратная тряпка на кровле
// выглядела наклейкой и парила отдельно от дома.
function wallBanner(x, y, w, h, f, ink) {
  const v = h * 0.12;
  let s = `<path d="M${n1(x)},${n1(y)}h${n1(w)}v${n1(h - v)}l${n1(-w / 2)},${n1(v)}l${n1(-w / 2)},${n1(-v)}Z" fill="${f.a}"/>`;
  s += R2(x, y + h * 0.5, w, h * 0.1, f.b);                 // одна поперечная полоса
  s += R2(x - w * 0.12, y - h * 0.035, w * 1.24, h * 0.035, ink);        // кронштейн в стену
  if (f.href) s += `<image href="${f.href}" x="${n1(x + w * 0.14)}" y="${n1(y + h * 0.1)}" width="${n1(w * 0.72)}" height="${n1(w * 0.72)}" preserveAspectRatio="xMidYMid meet"/>`;
  return s;
}
// Вымпел на древке: длинный узкий клин. Ставится РЯДАМИ по стилобату — один
// одинокий флажок сбоку читался как случайная закорючка.
function pennant(x, gy, ph, f, ink) {
  const fl = ph * 0.42;
  let s = bar(x, gy, -Math.PI / 2, ph, Math.max(0.7, ph * 0.035), ink);
  s += PT([[x, gy - ph], [x + fl, gy - ph + fl * 0.16], [x, gy - ph + fl * 0.34]], f.a);
  return s;
}
function pennantRow(x0, x1, gy, ph, f, ink, n) {
  let s = '';
  for (let k = 0; k < n; k++) s += pennant(x0 + (x1 - x0) * (k + 0.5) / n, gy, ph * (k % 2 ? 0.82 : 1), f, ink);
  return s;
}
// ⚠️ Флаг крепится к ВЕРХНЕМУ БЛОКУ, а не к середине фундамента: у сужающихся
// башен верхний блок узкий и смещён вбок, и древко на середине фасада повисало
// рядом с кровлей в пустом небе. Та же грабля, что была у мачты-венца (§7).
function topSpan(p) {
  const t = p.b.blocks[p.b.blocks.length - 1];
  return { x: p.bx + t.x, w: t.w, hPx: t.y1 - t.y0 };
}
// Сосед, нарисованный ПОЗЖЕ и не ниже, закрывает кровлю своим силуэтом: флаг на
// такой кровле висит уже над чужой стеной, оторванный от своего дома.
function roofFree(list, p) {
  const i = list.indexOf(p), s = topSpan(p);
  for (let k = i + 1; k < list.length; k++) {
    const q = list[k];
    if (q.bx > s.x + s.w) break;
    if (q.bx + q.w > s.x && q.roofY <= p.roofY + 2) return false;
  }
  return true;
}
// Дома, на которые вообще можно вешать: кровля целиком в кадре, не перекрыта и
// достаточно широкая, чтобы полотнище село на стену, а не свесилось мимо неё.
function flagHosts(list, W) {
  return list.filter(p => {
    const s = topSpan(p);
    return s.w > 4 && s.x > W * 0.02 && s.x + s.w < W * 0.98 && roofFree(list, p);
  }).sort((a, b) => a.roofY - b.roofY);
}

// ── §13. Небо: звезда, атмосфера, сцена ──────────────────────
// Пресеты неба планеты. Верх — зенит, низ — горизонт; haze = плотность атмосферы
// (0 = безвоздушная скала, звёзды видны и днём), light = цвет светила по умолчанию.
const ATMO = {
  crimson: { top: '#6d0a10', bot: '#c1121a', haze: 0.7, light: '#ffd9a8' },
  terra:   { top: '#12355b', bot: '#7fb2c9', haze: 0.85, light: '#fff2cf' },
  arid:    { top: '#5a2a12', bot: '#d59a4e', haze: 0.75, light: '#ffe0a0' },
  ice:     { top: '#12303f', bot: '#bcdcea', haze: 0.6, light: '#dff0ff' },
  toxic:   { top: '#14361f', bot: '#93c245', haze: 0.95, light: '#e8ff9a' },
  ash:     { top: '#1d2126', bot: '#8d8f92', haze: 1.0, light: '#ffcf9a' },
  ocean:   { top: '#0b2438', bot: '#58a7bf', haze: 0.8, light: '#eaf6ff' },
  void:    { top: '#04060b', bot: '#141c2c', haze: 0.0, light: '#ffffff' }
};

// ── §13a. Светимость: сколько на самом деле светит это солнце ──
// Диск в небе рисовался «на глаз» (dist 0..1) и врал: у красного карлика он был
// такой же, как у голубого гиганта, а на 9 а.е. в кадре стоял полдень. Теперь
// кадр считается по ФИЗИКЕ системы: класс звезды даёт светимость и радиус,
// орбита — расстояние, из них выходит и размер диска, и уровень освещённости.
// L и R — в солнечных единицах (главная последовательность, грубо);
// вырожденные (D — белый карлик, N — пульсар) светят почти ничем.
const STAR_L = { O: 3e4, B: 1.2e3, A: 22, F: 3.2, G: 1, K: 0.32, M: 0.03, D: 0.0025, N: 5e-5 };
const STAR_R = { O: 8, B: 4.2, A: 1.9, F: 1.3, G: 1, K: 0.78, M: 0.4, D: 0.013, N: 1e-5 };
const STAR_C = { O: '#bcd2ff', B: '#d6e2ff', A: '#eef2ff', F: '#fff8e0', G: '#ffefb8',
                 K: '#ffcf8a', M: '#ff9a70', D: '#e6e6ff', N: '#c8fff0' };
// Пояса системы — запасной путь, когда орбита в а.е. неизвестна: зона уже учитывает
// класс звезды, поэтому даёт освещённость сама по себе (в земных единицах).
const ZONE_INSOL = { 'пекло': 9, 'внутр': 2.4, 'обитаемая': 1, 'холод': 0.11, 'пустота': 0.015 };
function zoneInsol(z) {
  const s = String(z || '').toLowerCase();
  for (const k in ZONE_INSOL) if (s.indexOf(k) === 0) return ZONE_INSOL[k];
  return null;
}
// Возвращает {insol, r, day, color} либо null, если данных системы нет.
function starPhys(o, W) {
  if (!o) return null;
  const cls = String(o.cls || '').toUpperCase();
  const L = STAR_L[cls], Rs = STAR_R[cls];
  const dAu = +o.distAu;
  let insol = null, ang = null;
  if (L && dAu > 0) { insol = L / (dAu * dAu); ang = Rs / dAu; }
  else if (L || o.zone) {
    insol = zoneInsol(o.zone);
    if (insol == null) return null;
    // Орбиту восстанавливаем из освещённости — она и задаёт угловой размер диска:
    // у карлика обитаемая зона вплотную, и солнце там ВДВОЕ крупнее нашего.
    ang = (Rs || 1) / Math.sqrt((L || 1) / insol);
  } else return null;
  // Кадр ≈ 60° по ширине. Солнце с Земли — 0.53°, то есть радиус диска = W*0.0044.
  // Всё остальное — честная пропорция к этому якорю.
  const r = Math.max(1.2, Math.min(W * 0.2, W * 0.0044 * ang));
  // Освещённость в цвет переводим логарифмически (как глаз): земная норма ≈ 0.8,
  // вчетверо меньше света — 0.62, сотая доля — глухие сумерки.
  const day = Math.max(0.03, Math.min(1, 0.8 + 0.3 * Math.log(insol) / Math.LN10));
  return { insol: insol, r: r, day: day, color: STAR_C[cls] || null };
}

// Звезда системы. dist 0 — светило-гигант в полнеба, 1 — далёкая искра: так одним
// числом читается, у какого солнца стоит колония. Если пришли настоящие данные
// системы (§13a), диаметр берётся из них, а dist не используется вовсе.
// ⚠️ Никаких лучей-звёздочек. Светило — ЧИСТЫЙ ДИСК и мягкое гало, и всё: лучевая
// корона из прямых линий читалась как детская снежинка и спорила со штриховкой.
// Отдалённость = только диаметр диска. «Живость» даёт дымка, которая идёт ПОВЕРХ
// диска полосами (§airLayers рисуется после) — так же, как на референсе.
function star(R, id, W, H, o) {
  const c = o.color, dist = Math.max(0, Math.min(1, o.dist == null ? 0.55 : o.dist));
  const r = o.r != null ? o.r : 6 + (1 - dist) * (1 - dist) * 58;
  const x = W * (o.x == null ? 0.74 : o.x), y = H * (o.y == null ? 0.24 : o.y);
  // Гало живёт не диском, а КОЛИЧЕСТВОМ СВЕТА: далёкая искра не может залить
  // полнеба ореолом, поэтому радиус ореола растёт от освещённости (o.day).
  const day = o.day == null ? 1 : o.day;
  const halo = Math.max(r * 1.6, r * (2.2 + 3.4 * day) + (W * 0.012) * day);
  let s = `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(halo)}" fill="url(#${id}g)"/>`;
  s += `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r)}" fill="${c}"/>`;
  if (o.companion) s += `<circle cx="${n1(x + Math.max(r * 2.6, W * 0.03))}" cy="${n1(y + Math.max(r * 1.1, H * 0.02))}" r="${n1(Math.max(1.2, r * 0.34))}" fill="${mix(c, '#ffffff', 0.25)}"/>`;
  return { svg: s, x: x, y: y, r: r, color: c };
}

// Орбитальные объекты: рисуются В НЕБЕ глухим силуэтом (как дальний план) и
// перекрываются городом. Масштаб задаётся не размером, а тем, что объект НЕ
// ВЛЕЗАЕТ в кадр целиком: у «Длани» видно только середину ствола и казённик.
const SKY_KINDS = { arty: 'Длань Неотвратимости', station: 'Орбитальная станция' };
function orbital(R, kind, W, H, o) {
  const ink = o.ink, pap = o.paper;
  const cx = W * (o.x == null ? 0.3 : o.x), cy = H * (o.y == null ? 0.3 : o.y);
  const k = o.size == null ? 1 : o.size;
  let s = '';
  if (kind === 'arty') {
    const ang = (o.ang == null ? 14 : o.ang) * Math.PI / 180;   // ствол смотрит вниз-вбок
    const len = W * 1.1 * k, th = H * 0.11 * k;
    const x0 = cx - Math.cos(ang) * len * 0.62, y0 = cy - Math.sin(ang) * len * 0.62;
    s += bar(x0, y0, ang, len, th, ink);                        // ствол
    s += bar(x0, y0, ang, len, th * 0.16, pap);                 // белая осевая — блик
    // пояса-обоймы поперёк ствола
    for (let i = 1; i < 7; i++) {
      const t = i / 7, px = x0 + Math.cos(ang) * len * t, py = y0 + Math.sin(ang) * len * t;
      s += bar(px + Math.sin(ang) * th * 0.85, py - Math.cos(ang) * th * 0.85, ang + Math.PI / 2, th * 1.7, th * (i === 3 ? 0.16 : 0.07), ink);
    }
    // казённик: массивный блок с решётчатыми фермами
    const bx = x0 - Math.cos(ang) * th * 0.2, by = y0 - Math.sin(ang) * th * 0.2;
    s += bar(bx - Math.sin(ang) * th * 1.3, by + Math.cos(ang) * th * 1.3, ang, th * 3.4, th * 2.6, ink);
    s += bar(bx - Math.sin(ang) * th * 2.6, by + Math.cos(ang) * th * 2.6, ang, th * 1.2, th * 1.2, ink);
    s += bar(bx + Math.sin(ang) * th * 1.6, by - Math.cos(ang) * th * 1.6, ang, th * 1.4, th * 0.9, ink);
    // дульный срез
    const mx = x0 + Math.cos(ang) * len, my = y0 + Math.sin(ang) * len;
    s += bar(mx - Math.cos(ang) * th * 0.5 + Math.sin(ang) * th * 0.95, my - Math.sin(ang) * th * 0.5 - Math.cos(ang) * th * 0.95, ang + Math.PI / 2, th * 1.9, th * 0.5, ink);
  } else {
    const rw = W * 0.22 * k, rh = H * 0.05 * k;
    s += bar(cx - rw / 2, cy, 0, rw, rh, ink);
    s += bar(cx, cy - rh * 2.4, Math.PI / 2, rh * 4.8, rh * 0.35, ink);
    s += bar(cx - rw * 0.34, cy - rh * 2.4, 0, rw * 0.68, rh * 0.8, ink);
    s += bar(cx - rw * 0.34, cy + rh * 1.6, 0, rw * 0.68, rh * 0.8, ink);
  }
  return s;
}

// Слои атмосферы: гало у горизонта + пластами лежащая дымка. При haze = 0 вместо
// них — звёздное поле: воздуха нет, светило висит в чёрном.
// day — уровень света (§13a): чем его меньше, тем слабее дымка (её нечем
// подсветить) и тем увереннее сквозь воздух проступают звёзды.
function airLayers(R, W, H, horizon, A, sky, day) {
  let s = '';
  const dl = day == null ? 1 : day;
  const starField = op => {
    let d = '';
    for (let k = 0; k < 140; k++) { const x = R() * W, y = R() * horizon * 0.95, rr = R() < 0.12 ? 1.5 : 0.7; d += `M${n1(x)},${n1(y)}h${n1(rr)}v${n1(rr)}h${n1(-rr)}Z`; }
    return `<path d="${d}" fill="#ffffff" fill-opacity="${n1(op)}"/>`;
  };
  if (A.haze <= 0.01) return starField(0.8);
  // Дымка гаснет вместе со светом: на сумеречном мире она не белая пелена, а
  // еле различимый налёт у горизонта.
  const hz = A.haze * (0.3 + 0.7 * dl);
  if (dl < 0.45) s += starField((0.45 - dl) / 0.45 * 0.7 * (1 - A.haze * 0.5));
  s += `<rect x="0" y="${n1(horizon - H * 0.34 * hz)}" width="${W}" height="${n1(H * 0.34 * hz)}" fill="${mix(sky, '#ffffff', 0.22 * hz)}" opacity="0.55"/>`;
  for (let k = 0; k < 4; k++) {                             // пласты дымки
    const y = horizon - H * rnd(R, 0.06, 0.5) * hz, th = H * rnd(R, 0.006, 0.022);
    s += `<rect x="0" y="${n1(y)}" width="${W}" height="${n1(th)}" fill="${mix(sky, '#ffffff', 0.35)}" opacity="${n1(0.1 + 0.22 * hz)}"/>`;
  }
  return s;
}

// ── СЦЕНА ────────────────────────────────────────────────────
// opt: {seed, w, h, atmo|sky, pop (тыс.), built:['abm',...], flag:{a,b,emblem,href},
//       star:{cls:'G', distAu:1.0, zone:'Обитаемая', dist,x,y,color,companion},
//       charZone:[0..1,0..1], ground:true, labels:false}
// ⚠️ star.cls + star.distAu (или star.zone) — НАСТОЯЩИЕ данные системы: по ним
// считается и диск, и освещённость всего кадра (§13a). Старое star.dist (0..1)
// остаётся только фолбэком, когда системы не знаем.
function scene(opt) {
  opt = opt || {};
  const W = opt.w || 1600, H = opt.h || 700;
  const seed = opt.seed == null ? (Math.random() * 1e9) | 0 : opt.seed;
  const R = rng(seed);
  const id = 'sc' + (seed >>> 0).toString(36);
  const A = ATMO[opt.atmo] || ATMO.crimson;
  // Пепелище: небо затянуто гарью — и низ, и зенит уходят в чёрное. Цвет светила
  // при этом НЕ трогаем: тусклый диск сквозь дым и есть вся драма.
  const ruin = Math.max(0, Math.min(1, opt.ruin || 0));
  // ФОТОМЕТРИЯ КАДРА (§13a). day = 1 — земной полдень, 0.03 — вечные сумерки на
  // краю системы. Небо, палитра фасадов, дымка и гало звезды подчинены ей все.
  const ph = starPhys(opt.star, W);
  const day = ph ? ph.day : 1;
  const dark = 1 - day;
  const skyLit = c => mix(c, '#05070c', 0.8 * dark);        // «выключаем свет» в небе
  const sky = skyLit(mix(opt.sky || A.bot, '#1a1512', 0.45 * ruin));
  const sky2 = skyLit(mix(opt.sky2 || (opt.sky ? mix(opt.sky, '#000000', 0.42) : A.top), '#000000', 0.5 * ruin));
  const horizon = opt.horizon == null ? H * 0.995 : opt.horizon;
  const D = popProfile(opt.pop == null ? 60 : opt.pop);
  const layers = Math.min(opt.layers || D.layers, opt.light ? 2 : 4);
  const P0 = palette(sky, 0, day);                          // палитра ближнего плана
  const f = opt.flag && (opt.flag.a || opt.flag.href) ? {
    a: opt.flag.a || '#c1121a', b: opt.flag.b || '#f2f2f0',
    emblem: opt.flag.emblem || '', href: opt.flag.href || ''
  } : null;

  const st = star(R, id, W, H, {
    color: opt.star && opt.star.color || (ph && ph.color) || A.light,
    dist: opt.star ? opt.star.dist : 0.55,
    r: ph ? ph.r : null, day: day,
    x: opt.star && opt.star.x, y: opt.star && opt.star.y,
    companion: opt.star && opt.star.companion
  });

  // Свет падает ОТ ДИСКА: солнце справа — тень слева (§8).
  const cb = cityBody(R, { W: W, H: H, sky: sky, layers: layers, horizon: horizon, dens: D, ruin: ruin,
    light: !!opt.light, charZone: opt.charZone || null, day: day, lit: st.x > W * 0.5 });

  // Постройки игрока идут ПОВЕРХ города и раздвигаются по ширине. Полоса персонажа
  // для них запретна: колосс на переднем плане перекроет спрайт целиком.
  const all = (opt.built || []).slice(0, 8);
  const unit = H * 0.006;                                   // человек ≈ 0.6% кадра
  // «Длань» и станции — не постройки на земле: они висят на орбите (§13).
  const orbKinds = all.filter(k => SKY_KINDS[k]);
  const built = all.filter(k => !SKY_KINDS[k]).map(k => LM_H[k] ? k : 'factory')
                   .sort((a, b) => LM_H[b] - LM_H[a]);      // сначала самые высокие

  let orb = '';
  orbKinds.forEach((k, i) => {
    orb += orbital(R, k, W, H, {
      ink: mix('#111417', sky2, 0.2), paper: mix(sky, '#ffffff', 0.5),
      x: k === 'arty' ? (opt.charZone ? 0.26 : 0.34) : 0.68 + i * 0.06,
      y: k === 'arty' ? 0.22 : 0.14, size: k === 'arty' ? rnd(R, 0.9, 1.05) : 0.8,
      ang: rnd(R, 10, 20)
    });
  });

  // РАССТАНОВКА. Раньше постройки делили ширину поровну и вставали частоколом по
  // центру — самое худшее, что можно сделать с силуэтом. Теперь высокие уходят к
  // КРАЯМ кадра (и частично за него: обрез рамкой сам говорит «не влезает»),
  // а низкие садятся ближе к центру, где им есть куда встать, никого не закрывая.
  let lm = '';
  built.forEach((kind, i) => {
    const hh = H * LM_H[kind] * rnd(R, 0.9, 1.0);
    const ww = hh * LM_W[kind] * 0.55;
    // ⚠️ Раскладка зависит от ЧИСЛА построек. Одна — по центру: правило «первую к
    // краю» выкидывало единственный колосс за рамку, и в кадре не оставалось
    // ничего. Две — в трети. Три и больше — от краёв к центру по убыванию высоты.
    const side = i % 2 ? 1 : -1, rank = Math.floor(i / 2);
    const off = built.length === 1 ? 0 : built.length === 2 ? 0.2 : (0.38 - rank * 0.13);
    let cx = W * 0.5 + side * W * off + rnd(R, -W * 0.015, W * 0.015);
    if (opt.charZone) {                                     // сдвигаем прочь от персонажа
      const z0 = opt.charZone[0] * W, z1 = opt.charZone[1] * W;
      if (cx > z0 - ww / 2 && cx < z1 + ww / 2) cx = cx < (z0 + z1) / 2 ? z0 - ww / 2 - 10 : z1 + ww / 2 + 10;
    }
    lm += `<g transform="translate(${n1(cx - ww / 2)},${n1(horizon - hh)})">${landmark(R, kind, P0, ww, hh, unit)}</g>`;
    // Вымпелы — рядом по стилобату, а не по одному сбоку от постройки.
    if (f && (kind === 'abm' || kind === 'palace' || kind === 'temple'))
      lm += pennantRow(cx - ww * 0.34, cx + ww * 0.34, horizon - hh * 0.12, hh * 0.16, f, P0.ink, 4);
    if (opt.labels) lm += `<text x="${n1(cx)}" y="${n1(horizon - 6)}" font-size="${n1(H * 0.022)}" text-anchor="middle" fill="${P0.ink}" opacity="0.75">${LM_RU[kind]}</text>`;
  });

  // Флаги на городе: одно полотнище по фасаду самой высокой ближней башни и
  // пара вымпелов на кровлях пониже.
  let fl = '';
  // На пепелище полотнища нет — только голое древко: сорванный флаг говорит о
  // случившемся точнее, чем целый стяг над руинами.
  const hosts = f ? flagHosts(cb.near, W) : [];
  if (f && ruin > 0.5 && hosts.length) {
    const p = hosts[0], s = topSpan(p);
    fl += bar(s.x + s.w * 0.5, p.roofY, -Math.PI / 2, Math.max(10, p.h * 0.14), 1.2, P0.ink);
  } else if (f && hosts.length) {
    const host = hosts[0], hs = topSpan(host);
    // Полотнище не длиннее стены, к которой прижато: свесившись за низ верхнего
    // блока, лента снова висит в воздухе — теперь уже под кровлей.
    const bw = Math.min(hs.w * 0.34, H * 0.045);
    const bh = Math.min(bw * 3.4, hs.hPx * 0.8);
    if (bh > bw * 1.2) fl += wallBanner(hs.x + hs.w * 0.5 - bw / 2, host.roofY + hs.hPx * 0.1, bw, bh, f, P0.ink);
    hosts.slice(1, 4).forEach(p => {
      if (R() >= 0.6) return;
      const s = topSpan(p);
      fl += pennant(s.x + s.w * 0.5, p.roofY, Math.max(8, p.h * 0.1), f, P0.ink);
    });
  }

  // Земля. На пепелище вместо толпы — гряда обломков: людей на улице нет.
  let ground = '';
  if (opt.ground !== false) {
    ground = R2(0, horizon - 1, W, H - horizon + 1, P0.ink);
    ground += ruin > 0.5 ? rubble(R, W, horizon, unit, P0.ink)
      : tinyFolk(R, 0, W, H - 1, P0.ink, Math.round(6 + 30 * D.folk), unit);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMax slice">`
    + `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${sky2}"/><stop offset="0.72" stop-color="${sky}"/><stop offset="1" stop-color="${mix(sky, '#ffffff', 0.1)}"/></linearGradient>`
    + `<radialGradient id="${id}g"><stop offset="0" stop-color="${st.color}" stop-opacity="${A.haze > 0.01 ? 0.55 : 0.25}"/><stop offset="1" stop-color="${st.color}" stop-opacity="0"/></radialGradient>`
    + `</defs>`
    + `<rect width="${W}" height="${H}" fill="url(#${id})"/>`
    // Орбитальное — между звездой и дымкой: атмосфера ложится поверх силуэта,
    // и «Длань» сразу читается как объект ЗА воздухом, а не наклейка на кадре.
    // ⚠️ ПОСТРОЙКИ ИГРОКА — ФОНОВЫЙ СЛОЙ: lm идёт ДО города. Поверх ближнего плана
    // колосс лез на весь кадр и забивал силуэт; за застройкой он читается как то,
    // что стоит в глубине квартала, и город сам обрезает ему подножие.
    + st.svg + orb + airLayers(R, W, H, horizon, A, sky) + lm + cb.svg + fl + ground + `</svg>`;
}

function mount(el, opt) {
  if (typeof el === 'string') el = document.querySelector(el);
  if (!el) return null;
  // Сцену просят явно (mode:'scene') либо по признаку — небо/население/постройки.
  const asScene = opt && (opt.mode === 'scene' || opt.built || opt.atmo || opt.star || opt.flag || opt.pop != null);
  el.innerHTML = asScene ? scene(opt) : city(opt);
  return el.firstChild;
}

return {
  city: city, building: building, scene: scene, mount: mount,
  rng: rng, palette: palette, popProfile: popProfile,
  ATMO: ATMO, KINDS: LM_RU, SKY_KINDS: SKY_KINDS
};
})();
