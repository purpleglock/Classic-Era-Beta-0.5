/* ════════════════════════════════════════════════════════════
 * «АВАДДОН» — СПРАЙТ. Процедурный демон. Пара к «Престолу» (angel_fx.js).
 * ────────────────────────────────────────────────────────────
 * ПОЧЕМУ НЕ «АНГЕЛ С РОГАМИ». Демон, сделанный как испорченный ангел, всегда
 * читается вторичным: те же колёса, тот же нимб, только чёрное. Здесь он
 * построен НАОБОРОТ по каждому правилу, на котором стоит Престол, — и именно
 * поэтому рядом они смотрятся парой, а не вариацией.
 *
 *   ПРЕСТОЛ                            │  АВАДДОН
 *   ───────────────────────────────────┼──────────────────────────────────────
 *   нет ПОЗЫ (машина из колёс)         │  нет СИЛУЭТА (контур считается заново
 *                                      │  каждый кадр: масса не держит форму)
 *   лика нет, он закрыт заслонкой      │  ликов много, и все ЧУЖИЕ: всплывают
 *                                      │  в массе и тонут обратно
 *   светит (кость и золото)            │  ЕСТ свет: тело — вырезанное место,
 *                                      │  видно по кромке и по трещинам
 *   смотрит на тебя (глаза ведут цель) │  слеп: к цели поворачивается ПАСТЬЮ
 *   всё плавно, рывок один — молния    │  всё рвано, плавно одно — дыхание
 *   венец света над головой            │  венец РОГОВ, единственная твёрдая и
 *                                      │  неподвижная часть на всём спрайте
 *   шкала ПЕЧАТЕЙ: падает — он умирает │  шкала ОКОВ: падает — он РАСПУСКАЕТСЯ
 *
 * ПОСЛЕДНЯЯ СТРОКА — ГЛАВНАЯ. У ангела убывающая шкала означает «слабеет»,
 * у демона — «держат хуже»: контур рвётся шире, трещины горячее, рывки чаще,
 * пасть открывается охотнее. Игрок видит цену промедления, не читая цифр.
 *
 * ЦВЕТ. Тон стороны уходит ТОЛЬКО в дальнее зарево — как у ангела. Само тело
 * всегда смоль и уголь: он тоже не принадлежит стороне, он ей попутчик, но
 * попутчик другого рода.
 *
 * ПОДРОБНОСТЬ — ФУНКЦИЯ ОТ РАЗМЕРА (demonDetail, opt.detail): на карте силуэт,
 * на доске полный набор, вблизи — зубья, нити, лики с бликом. Телефон выше
 * первой ступени не поднимается.
 *
 * ЗАВИСИМОСТИ: ничего. Чистый canvas 2D, наружу:
 *   demonDraw(ctx, opt)     — нарисовать в точке (opt.detail — потолок ступени)
 *   demonWantsFrames()      — доске: держи rAF живым, пока он в кадре
 *   demonHit(id, ang)       — разрыв шкуры в месте попадания (затягивается)
 *   demonChainBar(...)      — полоса оков вместо полоски корпуса
 * ════════════════════════════════════════════════════════════ */

var DEMON = {
  t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  live: 0,          // сколько демонов нарисовали в последнем кадре
  hits: {},         // id → { t, a } последний разрыв и его направление
  seen: {},         // id → прошлый счётчик попаданий
  forms: {},        // id → облик (раскладка лохмотьев, ликов, рогов, трещин)
  formN: 0,
  gc: {}, gcN: 0,   // кэш градиентов
  lo: null,
  dead: false
};

/* ── КАЧЕСТВО РИСОВКИ ───────────────────────────────────────
 * Та же беда, что у Престола, и то же лекарство: спрайт считается каждый кадр
 * целиком, поэтому экономим не на движении, а на слоях и на градиентах.
 * Продавить руками: DEMON.lo = true/false.                                   */
function demonLo() {
  if (DEMON.lo != null) return DEMON.lo;
  var w = (typeof window !== 'undefined') ? (window.innerWidth || 1200) : 1200;
  var touch = (typeof navigator !== 'undefined') && (navigator.maxTouchPoints > 0);
  DEMON.lo = (w < 900) || !!touch;
  return DEMON.lo;
}

// Кэш градиентов по квантованному ключу. Ёмкость ограничена: ключи со временем
// накапливаются, и без предела это медленная утечка.
function demonGrad(k, make) {
  var g = DEMON.gc[k];
  if (g) return g;
  if (DEMON.gcN > 400) { DEMON.gc = {}; DEMON.gcN = 0; }
  g = make(); DEMON.gc[k] = g; DEMON.gcN++;
  return g;
}
function demonQ(v, step) { return Math.round(v / step) * step; }

// Часы спрайта: свои, не игровые. Он шевелится и когда доска ждёт сервер.
function demonT() {
  return ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - DEMON.t0) / 1000;
}

function demonWantsFrames() { return DEMON.live > 0; }

/* ПОПАДАНИЕ. У ангела залп «доходил и не значил ничего» — вспышка нимба.
 * У демона наоборот: попадание ВИДНО и оно РВЁТ. Из разрыва бьёт уголь, край
 * контура проваливается внутрь — и за полсекунды затягивается обратно.
 * Смысл ровно тот же и ровно противоположный: ты сделал ему больно, и это
 * ничего не изменило, потому что рана заросла у тебя на глазах.              */
function demonHit(id, ang) {
  DEMON.hits[id || '_'] = { t: demonT(), a: (ang == null ? Math.random() * Math.PI * 2 : ang) };
}
function demonSyncHits(u) {
  if (!u || u.id == null) return;
  var n = (u.pk && +u.pk.dmn) || 0;
  var was = DEMON.seen[u.id];
  if (was != null && n > was) demonHit(u.id);
  DEMON.seen[u.id] = n;
}

/* ── СТУПЕНЬ ПОДРОБНОСТИ ────────────────────────────────────
 *   0 — силуэт: масса, кромка, пятно пасти;
 *   1 — доска: лохмотья, трещины, воронка, один лик, капли, рога;
 *   2 — богатый: зубья, нити на лохмотьях, три лика, насечка на рогах, угли;
 *   3 — крупный план: пять ликов с бликом, мелкие трещины, полный венец.
 * cap — потолок от вызывающего: радиус на карте говорит «сделай заметным»,
 * а не «сделай подробным» (эти грабли уже собраны на Престоле).              */
function demonDetail(R, cap) {
  var lo = demonLo();
  var d;
  if (R < (lo ? 13 : 10)) d = 0;
  else if (lo) d = 1;
  else if (R < 22) d = 1;
  else if (R < 40) d = 2;
  else d = 3;
  return (cap == null) ? d : Math.min(d, cap);
}

/* ── ОБЛИК: РАСКЛАДКА, КОТОРАЯ НЕ ПРЫГАЕТ ───────────────────
 * Контур пересчитывается каждый кадр, но РАСКЛАДКА — нет. Если гонять random()
 * по лохмотьям и ликам, получится телевизионный снег, а не существо: рябь
 * читается как помеха, а не как жизнь. Поэтому всё случайное берётся ОДИН раз
 * из семени, посчитанного по id: два демона на доске не близнецы, но каждый
 * сам себе равен от кадра к кадру.                                           */
// ⚠️ ВЕЗДЕ >>> 0 И Math.imul. У Престола семя — положительная константа в коде,
// и туда эти грабли не заезжали. Здесь семя считается ИЗ id через XOR, а `^`
// в JS даёт ЗНАКОВОЕ 32-битное: одно отрицательное число на входе — и весь
// поток случайных уходит в минус. Наружу это вылезло не «странной раскладкой»,
// а падением холста: у капли получился отрицательный радиус, ellipse бросил
// IndexSizeError, и предохранитель снял спрайт с отрисовки целиком.
function demonHash(n) {
  var s = (n >>> 0);
  s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0;
  s = Math.imul(s ^ (s >>> 13), 3266489909) >>> 0;
  return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
}
function demonForm(id) {
  var k = String(id == null ? '_' : id);
  var F = DEMON.forms[k];
  if (F) return F;
  if (DEMON.formN > 24) { DEMON.forms = {}; DEMON.formN = 0; }
  var s = 2166136261 >>> 0;
  for (var c = 0; c < k.length; c++) { s = Math.imul(s ^ k.charCodeAt(c), 16777619) >>> 0; }
  var rnd = (function (seed) {
    return function () {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  })(s);
  F = { seed: Math.floor(s % 9973), ph: [], limbs: [], faces: [], horns: [], cracks: [], drips: [] };
  var i, j;
  for (i = 0; i < 6; i++) F.ph.push(rnd() * Math.PI * 2);

  // ЛОХМОТЬЯ. Шесть — столько же, сколько крыл у серафима, и это единственное,
  // что у них общего. Крыло — костяное, с осью и порядком перьев; лохмотье —
  // мембрана без кости: её выбрасывает давлением изнутри и втягивает обратно.
  // Половина растёт «за» телом, половина «перед» — иначе масса плоская.
  for (i = 0; i < 6; i++) {
    F.limbs.push({
      a: (i / 6) * Math.PI * 2 + (rnd() - 0.5) * 0.55,
      len: 0.85 + rnd() * 0.95,
      w: 0.28 + rnd() * 0.22,
      bend: (rnd() - 0.5) * 1.5,
      per: 2.4 + rnd() * 3.6,
      ph: rnd() * 10,
      front: (i % 2 === 0),
      jag: [rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd()]
    });
  }
  // ЛИКИ. Не его лица — взятые. Всплывают в разном такте, живут секунду-две и
  // уходят. Ни один не смотрит на игрока: они слепые, у них залиты глаза и
  // открыт только рот — тем и страшны.
  for (i = 0; i < 5; i++) {
    F.faces.push({
      a: rnd() * Math.PI * 2, r: 0.30 + rnd() * 0.30, sz: 0.30 + rnd() * 0.16,
      per: 5.5 + rnd() * 7.0, ph: rnd() * 12, tilt: (rnd() - 0.5) * 1.1,
      gap: 0.25 + rnd() * 0.55
    });
  }
  // ВЕНЕЦ РОГОВ по верхней половине. Длины разные и растут криво: ровный ряд
  // одинаковых рогов — это корона, то есть украшение. Здесь не украшение.
  var hn = 13;
  for (i = 0; i < hn; i++) {
    F.horns.push({
      a: -Math.PI / 2 + (i - (hn - 1) / 2) * 0.255 + (rnd() - 0.5) * 0.09,
      // ⚠️ ДЛИНА И СВЕТЛОТА. Первый заход дал рога до 1.2R и почти белые: на
      // кадре вышел морской ёж — кость забрала весь силуэт, а масса под ней
      // читалась подложкой. Рог должен быть КОРОЧЕ комьев тела и грязнее их:
      // венец не торчит из существа, он в нём сидит.
      len: 0.26 + rnd() * 0.34,
      curl: (rnd() - 0.5) * 1.5,
      w: 0.045 + rnd() * 0.045,
      rank: (i * 5) % hn          // порядок отсева по ступеням: венец редеет ровно
    });
  }
  // ТРЕЩИНЫ — единственное, чем тело светит. Ветвятся ломаной от середины.
  for (i = 0; i < 9; i++) {
    var seg = [];
    for (j = 0; j < 5; j++) seg.push((rnd() - 0.5) * 0.36);
    F.cracks.push({ a: rnd() * Math.PI * 2, r0: 0.12 + rnd() * 0.26,
                    len: 0.42 + rnd() * 0.58, seg: seg, ph: rnd() * 8, per: 2.0 + rnd() * 3.0,
                    rank: i });
  }
  // КАПЛИ. Только с нижней дуги (0.6..2.5 рад): смола не течёт вверх.
  for (i = 0; i < 7; i++) {
    F.drips.push({ a: 0.6 + rnd() * 1.9, per: 1.8 + rnd() * 2.8, ph: rnd() * 6, sz: 0.028 + rnd() * 0.034 });
  }
  DEMON.forms[k] = F; DEMON.formN++;
  return F;
}

/* ── ГЕОМЕТРИЯ ЛИКА ─────────────────────────────────────────
 * Глаз задан путём (миндаль), как у ангела, — но используется он ровно
 * наоборот: у Престола миндалина открыта и в ней зрачок, который тебя ведёт,
 * здесь она ЗАЛИТА. Пустая миндалина на лице — это не «закрытые глаза», это
 * глаза, которых нет; и читается это мгновенно, потому что форма-то знакомая. */
var DEMON_EYE_D = 'M -1 0 C -0.55 -0.66 -0.20 -0.78 0 -0.78'
                + ' C 0.20 -0.78 0.55 -0.66 1 0'
                + ' C 0.55 0.66 0.20 0.78 0 0.78'
                + ' C -0.20 0.78 -0.55 0.66 -1 0 Z';
var DEMON_P = null;
function demonPaths() {
  if (!DEMON_P && typeof Path2D === 'function') DEMON_P = { eye: new Path2D(DEMON_EYE_D) };
  return DEMON_P;
}

/* ── КОНТУР, КОТОРОГО НЕТ ───────────────────────────────────
 * Сердце спрайта. У корабля силуэт — паспорт: по нему борт узнают. У этого
 * существа паспорта нет, и это его единственный настоящий признак: сколько на
 * него ни смотри, во второй раз он выглядит иначе.
 *
 * Как считается. Радиус узла — сумма четырёх синусов по углу и времени со
 * взаимно непростыми частотами (2, 3, 5, 8): такая сумма на глаз не
 * повторяется никогда, но остаётся ЗАМКНУТОЙ и гладкой — комья переваливаются,
 * а не мигают. Пятая гармоника подмешивается только по мере распускания:
 * скованный держит форму почти ровно, свободный идёт лохмотьями.
 *
 * РЫВОК. Раз в секунду с небольшим одно место вспухает и оседает. Это
 * единственное резкое движение, и оно ровно обратно ангельскому: у того всё
 * плавно, кроме молнии — «чужая воля в машине»; здесь всё рвано, и рывок
 * значит «внутри что-то повернулось».                                        */
function demonArcD(a, b) {
  var d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? (Math.PI * 2 - d) : d;
}
function demonOutline(R, t, F, loose, hit, n) {
  var P = [], i;
  var jper = 1.20 - loose * 0.50;
  var jk = Math.floor(t / jper), into = t - jk * jper;
  var ja = into < 0.40 ? (1 - into / 0.40) : 0;
  var jang = demonHash(jk * 7 + F.seed) * Math.PI * 2;
  for (i = 0; i < n; i++) {
    var a = (i / n) * Math.PI * 2;
    var r = 1
      + 0.190 * Math.sin(a * 2 + t * 0.62 + F.ph[0])
      + 0.110 * Math.sin(a * 3 - t * 0.97 + F.ph[1])
      + 0.060 * Math.sin(a * 5 + t * 1.70 + F.ph[2])
      + 0.035 * Math.sin(a * 8 - t * 2.40 + F.ph[3])
      + loose * 0.130 * Math.sin(a * 7 + t * 3.10 + F.ph[4]);
    var d1 = demonArcD(a, jang);
    r += 0.30 * ja * (0.35 + loose) * Math.exp(-(d1 * d1) / 0.30);
    // РАЗРЫВ от попадания: край проваливается внутрь и возвращается.
    if (hit.k > 0) {
      var d2 = demonArcD(a, hit.a);
      r -= 0.34 * hit.k * Math.exp(-(d2 * d2) / 0.16);
    }
    // 0.94 по вертикали — масса чуть оседает под себя, а не висит шаром
    P.push({ a: a, r: r, x: Math.cos(a) * R * r, y: Math.sin(a) * R * r * 0.94 });
  }
  return P;
}
// Точка контура по углу — лохмотьям, каплям и рогам, чтобы они росли ИЗ
// кромки, а не из воздуха рядом с ней.
function demonAt(P, a) {
  var n = P.length;
  var i = Math.round((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * n) % n;
  return P[i];
}
// Замкнутая гладкая кривая по узлам: середины отрезков — опоры, сами узлы —
// контрольные точки. Дёшево и без изломов на стыке (обычная беда закольцованных
// сплайнов: последний сегмент выпадает и даёт угол).
function demonPath(x, P) {
  var n = P.length, i;
  x.beginPath();
  x.moveTo((P[n - 1].x + P[0].x) / 2, (P[n - 1].y + P[0].y) / 2);
  for (i = 0; i < n; i++) {
    var c = P[i], q = P[(i + 1) % n];
    x.quadraticCurveTo(c.x, c.y, (c.x + q.x) / 2, (c.y + q.y) / 2);
  }
  x.closePath();
}

/* ── ЛОХМОТЬЕ ───────────────────────────────────────────────
 * Мембрана без кости: средняя линия — квадратичная кривая, по обе стороны от
 * неё ширина с зазубринами из раскладки. Выбрасывается быстро, втягивается
 * медленно (ext в квадрате) — от этого движение читается как давление изнутри,
 * а не как взмах.                                                            */
function demonLimb(x, R, lb, t, D, loose, heat) {
  var ph = t * (Math.PI * 2 / lb.per) + lb.ph;
  var ext = 0.5 + 0.5 * Math.sin(ph);
  ext = ext * ext;
  var len = R * (0.45 + lb.len * 1.30 * ext * (0.80 + loose * 0.45));
  if (len < R * 0.28) return;
  x.save();
  x.rotate(lb.a);
  var bend = lb.bend * (0.6 + 0.4 * Math.sin(t * 0.8 + lb.ph));
  var ex = len, ey = bend * R * 1.15, cx1 = len * 0.5, cy1 = bend * R * 0.55;
  var at = function (u) {
    var m = 1 - u;
    return [2 * m * u * cx1 + u * u * ex, 2 * m * u * cy1 + u * u * ey];
  };
  var S = D >= 2 ? 8 : 5, i, up = [], dn = [];
  for (i = 0; i <= S; i++) {
    var u = i / S, p0 = at(u), p1 = at(Math.min(1, u + 0.06));
    var dx = p1[0] - p0[0], dy = p1[1] - p0[1], dl = Math.hypot(dx, dy) || 1;
    var w = R * lb.w * (1 - u * 0.70) * (0.70 + 0.55 * lb.jag[i % 8]);
    up.push([p0[0] + (-dy / dl) * w, p0[1] + (dx / dl) * w]);
    dn.push([p0[0] + (dy / dl) * w * 0.72, p0[1] - (dx / dl) * w * 0.72]);
  }
  x.beginPath();
  x.moveTo(up[0][0], up[0][1]);
  for (i = 1; i <= S; i++) x.lineTo(up[i][0], up[i][1]);
  for (i = S; i >= 0; i--) x.lineTo(dn[i][0], dn[i][1]);
  x.closePath();
  var ql = Math.max(1, demonQ(len, 3));
  x.fillStyle = demonGrad('lb' + ql, function () {
    var g = x.createLinearGradient(0, 0, ql, 0);
    g.addColorStop(0, 'rgba(16,9,12,0.95)');
    g.addColorStop(0.55, 'rgba(22,12,14,0.72)');
    g.addColorStop(1, 'rgba(30,16,16,0)');
    return g;
  });
  x.fill();
  // ⚠️ ЖАР ПО КРОМКЕ. Без него лоскут — тёмное на тёмном, то есть ничего:
  // на первом кадре шесть лохмотьев не читались вовсе, от них оставались
  // только нити. Кромка не делает их светлыми, она делает их ВИДНЫМИ.
  x.save();
  x.globalCompositeOperation = 'lighter';
  x.strokeStyle = 'rgba(132,34,18,' + (0.10 + 0.16 * heat) + ')';
  x.lineWidth = Math.max(0.6, R * 0.05);
  x.stroke();
  x.restore();
  x.strokeStyle = 'rgba(168,136,126,' + (0.18 + 0.10 * heat) + ')';
  x.lineWidth = Math.max(0.35, R * 0.012);
  x.stroke();

  // НИТИ. Вблизи ровный край мембраны выдаёт заливку: у рванья должны быть
  // волокна, которые тянутся дальше самого лоскута и не держат форму.
  if (D >= 2) {
    x.strokeStyle = 'rgba(140,110,104,0.16)';
    x.lineWidth = Math.max(0.3, R * 0.007);
    x.beginPath();
    for (i = 0; i < 3; i++) {
      var tu = 0.72 + i * 0.09, tp = at(Math.min(1, tu));
      var tl = R * (0.22 + lb.jag[i] * 0.30);
      x.moveTo(tp[0], tp[1]);
      x.quadraticCurveTo(tp[0] + tl * 0.6, tp[1] + Math.sin(t * 2.1 + i + lb.ph) * tl * 0.35,
                         tp[0] + tl, tp[1] + Math.sin(t * 1.4 + i * 2 + lb.ph) * tl * 0.55);
    }
    x.stroke();
  }
  x.restore();
}

/* ── ЛИК ────────────────────────────────────────────────────
 * ПОЧЕМУ ЛИЦО СВЕТЛЕЕ МАССЫ. Тело почти чёрное; чёрные черты на чёрном — это
 * не лицо, это ничего. Поэтому лик всплывает СВЕТЛЫМ пятном: он ловит тот же
 * угольный свет, что идёт из трещин, — и на этом пятне уже читаются провалы
 * глаз и рта. Так же и по смыслу: лицо здесь — не часть его, а чужая кожа,
 * которую изнутри подпёрло к поверхности.
 *
 * ГЛАЗА ЗАЛИТЫ, РОТ ОТКРЫТ. Это не «зажмурился»: миндалина знакомой формы,
 * но в ней нет ничего. Зрачок сделал бы лик персонажем — а он не персонаж,
 * он вещь, которую демон надел на секунду.                                   */
function demonFace(x, px, py, r, fc, k, D, heat) {
  var P2 = demonPaths();
  x.save();
  x.translate(px, py);
  x.rotate(fc.tilt);
  var a = k * (0.85 + 0.15 * heat);
  var qa = demonQ(a, 0.1);

  // кожа: пятно, подсвеченное снизу — оттуда, где угли
  x.beginPath();
  x.ellipse(0, 0, r * 0.78, r, 0, 0, Math.PI * 2);
  var qr = Math.max(1, demonQ(r, 2));
  x.fillStyle = demonGrad('fc' + qr + '_' + qa.toFixed(1), function () {
    var g = x.createLinearGradient(0, qr, 0, -qr);
    g.addColorStop(0, 'rgba(84,50,42,' + (0.95 * qa) + ')');
    g.addColorStop(0.55, 'rgba(48,28,28,' + (0.88 * qa) + ')');
    g.addColorStop(1, 'rgba(20,12,14,' + (0.60 * qa) + ')');
    return g;
  });
  x.fill();
  // кромка: лицо не лежит НА массе, оно подпёрто ИЗ-ПОД неё
  x.strokeStyle = 'rgba(12,7,9,' + (0.55 * a) + ')';
  x.lineWidth = Math.max(0.4, r * 0.10);
  x.stroke();

  // глаза
  var eyR = r * 0.30, ex = r * 0.34, ey = -r * 0.20;
  for (var s = -1; s <= 1; s += 2) {
    x.save();
    x.translate(s * ex, ey);
    x.scale(eyR, eyR * 0.56);
    x.fillStyle = 'rgba(6,3,5,' + (0.95 * a) + ')';
    if (P2) x.fill(P2.eye);
    else { x.beginPath(); x.ellipse(0, 0, 1, 1, 0, 0, Math.PI * 2); x.fill(); }
    x.restore();
    // вблизи — мокрый ободок: чужая кожа ещё свежая
    if (D >= 3 && P2) {
      x.save();
      x.translate(s * ex, ey);
      x.scale(eyR, eyR * 0.56);
      x.strokeStyle = 'rgba(206,186,178,' + (0.30 * a) + ')';
      x.lineWidth = 0.09;
      x.stroke(P2.eye);
      x.restore();
    }
  }

  // рот: не улыбка и не «о», а разъём — щель, которую растянуло
  var mw = r * 0.62, mh = r * fc.gap * 0.72;
  x.beginPath();
  x.moveTo(-mw, r * 0.30);
  x.quadraticCurveTo(0, r * 0.30 - mh, mw, r * 0.30);
  x.quadraticCurveTo(0, r * 0.30 + mh * 1.35, -mw, r * 0.30);
  x.closePath();
  x.fillStyle = 'rgba(5,2,4,' + (0.95 * a) + ')';
  x.fill();
  if (D >= 3) {
    x.save();
    x.globalCompositeOperation = 'lighter';
    x.fillStyle = 'rgba(190,58,20,' + (0.30 * a * heat) + ')';
    x.fill();
    x.restore();
  }
  x.restore();
}

/* ── ПАСТЬ ──────────────────────────────────────────────────
 * ЕДИНСТВЕННОЕ, ЧЕМ ОН ОБРАЩЁН К ЦЕЛИ. У ангела к цели поворачиваются глаза —
 * он тебя видит. Этот слеп; к тебе разворачивается воронка, и это хуже: тебя
 * не рассматривают, тебя МЕРЯЮТ.
 *
 * Глубина сделана кольцами, уходящими внутрь и смещёнными ПРОТИВ направления
 * взгляда: смещение и есть перспектива, без него воронка читается плоской
 * дыркой. Зубья по кромке — разной длины и не по сетке: ровный частокол
 * читается шестерёнкой, а шестерёнка — это уже машина, то есть ангел.        */
function demonMaw(x, R, t, gaze, D, loose, heat, F, gk) {
  var mr = R * (0.40 + 0.22 * gk + loose * 0.10);
  x.save();
  x.rotate(gaze);
  var rings = D >= 2 ? 5 : 3, i;
  for (i = 0; i < rings; i++) {
    var q = 1 - (i / rings) * 0.80;
    var sh = -i * mr * 0.11;
    x.beginPath();
    x.ellipse(sh, 0, mr * q * 0.74, mr * q, 0, 0, Math.PI * 2);
    var v = Math.max(0, Math.round(20 - i * 4));
    x.fillStyle = 'rgba(' + v + ',' + Math.max(0, v - 10) + ',' + Math.max(0, v - 6) + ',1)';
    x.fill();
  }
  // угли на дне: не пламя, а именно угли — они не освещают, они только сами
  // видны. Пламя в пасти сделало бы из него печку, то есть предмет.
  if (D >= 1) {
    x.save();
    x.globalCompositeOperation = 'lighter';
    var emb = D >= 2 ? 7 : 3;
    for (i = 0; i < emb; i++) {
      var pe = (t * 0.7 + i * 0.19) % 1;
      var ea = Math.sin(pe * Math.PI) * (0.30 + 0.55 * gk) * heat;
      var ex2 = -mr * 0.55 + Math.sin(i * 2.1 + t * 1.3) * mr * 0.18;
      var ey = Math.cos(i * 1.7 + t * 1.1) * mr * 0.34;
      x.beginPath();
      x.arc(ex2, ey, mr * (0.05 + (i % 3) * 0.022), 0, Math.PI * 2);
      x.fillStyle = 'rgba(255,' + (96 + (i % 4) * 22) + ',36,' + ea.toFixed(3) + ')';
      x.fill();
    }
    x.restore();
  }
  // зубья
  if (D >= 2) {
    var tn = 20;
    x.beginPath();
    for (i = 0; i < tn; i++) {
      var ta = (i / tn) * Math.PI * 2 + 0.11;
      var tb = ((i + 0.62) / tn) * Math.PI * 2 + 0.11;
      var rx = mr * 0.74, ry = mr;
      var hh = 0.78 + demonHash(i * 3 + F.seed) * 0.16;    // длина зуба
      var ax = Math.cos(ta) * rx, ay = Math.sin(ta) * ry;
      var bx = Math.cos(tb) * rx, by = Math.sin(tb) * ry;
      var mx2 = (ax + bx) / 2 * hh, my2 = (ay + by) / 2 * hh;
      x.moveTo(ax, ay); x.lineTo(mx2, my2); x.lineTo(bx, by);
    }
    x.fillStyle = 'rgba(146,132,120,0.62)';
    x.fill();
    x.strokeStyle = 'rgba(40,26,24,0.55)';
    x.lineWidth = Math.max(0.3, R * 0.008);
    x.stroke();
  }
  x.restore();
}

/* ── РОГ ────────────────────────────────────────────────────
 * Единственная твёрдая вещь на спрайте и единственная, которая НЕ шевелится.
 * В этом вся её работа: рядом с массой, которая каждый кадр другая, кость
 * читается как «вот это в нём настоящее». Основание грязное, кончик светлый —
 * наоборот было бы «свеча», а не рог.                                        */
function demonHorn(x, R, h, t, D, P) {
  var pt = demonAt(P, h.a);
  var bx = Math.cos(h.a) * R * pt.r * 0.86, by = Math.sin(h.a) * R * pt.r * 0.94 * 0.86;
  var len = R * h.len;
  var w = R * h.w;
  x.save();
  x.translate(bx, by);
  x.rotate(h.a + Math.sin(t * 0.5 + h.a) * 0.02);   // почти не качается — это кость
  var tipx = len, tipy = h.curl * len * 0.45;
  var c1x = len * 0.45, c1y = h.curl * len * 0.10;
  x.beginPath();
  x.moveTo(0, -w);
  x.quadraticCurveTo(c1x, c1y - w * 0.45, tipx, tipy);
  x.quadraticCurveTo(c1x, c1y + w * 0.45, 0, w);
  x.closePath();
  var qh = Math.max(1, demonQ(len, 3));
  x.fillStyle = demonGrad('hr' + qh, function () {
    var g = x.createLinearGradient(0, 0, qh, 0);
    g.addColorStop(0, 'rgba(34,24,22,1)');
    g.addColorStop(0.45, 'rgba(104,90,80,1)');
    g.addColorStop(1, 'rgba(176,164,146,1)');
    return g;
  });
  x.fill();
  x.strokeStyle = 'rgba(24,16,14,0.6)';
  x.lineWidth = Math.max(0.3, R * 0.008);
  x.stroke();
  // насечка: рог рос кольцами, как ноготь
  if (D >= 2) {
    x.strokeStyle = 'rgba(40,28,24,0.35)';
    x.lineWidth = Math.max(0.25, R * 0.006);
    x.beginPath();
    for (var i = 1; i <= 4; i++) {
      var u = i / 5, m = 1 - u;
      var px = 2 * m * u * c1x + u * u * tipx;
      var py = 2 * m * u * c1y + u * u * tipy;
      var ww = w * (1 - u * 0.8);
      x.moveTo(px, py - ww); x.lineTo(px, py + ww);
    }
    x.stroke();
  }
  x.restore();
}

/* ── ГЛАВНОЕ: НАРИСОВАТЬ АВАДДОНА ───────────────────────────
 * opt: { cx, cy, R, alpha, tone, gaze, id, bound (0..1, синоним seals),
 *        detail (потолок ступени), spawn (мелкое подобие), bake, t }
 *
 * ПОРЯДОК СЛОЁВ снизу вверх: зарево-гашение → задние лохмотья → тело →
 * трещины → пасть → лики → передние лохмотья → венец рогов → капли → разрыв.
 * Лохмотья разнесены нарочно: так масса оказывается МЕЖДУ ними, а не под
 * ними — только тогда видно, что они из неё растут.                          */
function demonDraw(x, opt) {
  // ПРЕДОХРАНИТЕЛЬ — тот же, что у Престола, и по той же причине: ошибка здесь
  // падает не один раз, а шестьдесят раз в секунду, и всё, что рисуется ПОСЛЕ,
  // не рисуется вовсе. Сорвался — жалуемся один раз и снимаемся с отрисовки.
  if (DEMON.dead) return;
  try {
    demonDrawCore(x, opt);
  } catch (e) {
    DEMON.dead = true;
    if (typeof console !== 'undefined') console.error('▲ Аваддон: спрайт снят с отрисовки', e);
  }
}
function demonDrawCore(x, opt) {
  if (!opt.bake) DEMON.live++;
  var cx = opt.cx, cy = opt.cy, R = opt.R || 20;
  var A = opt.alpha == null ? 1 : opt.alpha;
  var tone = opt.tone || '190,60,50';
  var t = opt.t == null ? demonT() : opt.t;
  var gaze = opt.gaze == null ? -Math.PI / 2 : opt.gaze;
  // ОКОВЫ. 1 — скован, 0 — распущен. Имя seals оставлено синонимом, чтобы
  // спрайт втыкался в те же вызовы, что и ангел, без переписывания доски.
  var bound = opt.bound == null ? (opt.seals == null ? 1 : opt.seals) : opt.bound;
  bound = Math.max(0, Math.min(1, bound));
  var loose = 1 - bound;
  // ▲ ПОДОБИЕ (opt.spawn) — мелкий бес, пара к ангельской страже. Что снимаем:
  // венец (рогов у него ещё нет — он ничего не сожрал), лики (чужих лиц тоже
  // нет), два лохмотья из шести. Что оставляем: массу, пасть, трещины. Отличие
  // в чине читается ОБЛИКОМ, а не тем, что «мельче» — грабли собраны на страже.
  var sp = !!opt.spawn;
  var D = demonDetail(R, opt.detail);
  var F = demonForm(opt.id);

  var heat = (0.32 + loose * 0.68) * (sp ? 0.8 : 1);   // яркость углей и трещин
  var breath = Math.sin(t * (0.85 + loose * 1.35));

  // разрыв от попадания
  var hrec = DEMON.hits[opt.id || '_'];
  var hit = { k: 0, a: 0 };
  if (hrec) {
    var hdt = t - hrec.t;
    if (hdt < 0.62) { hit.k = 1 - hdt / 0.62; hit.a = hrec.a; }
    else delete DEMON.hits[opt.id || '_'];
  }

  x.save();
  x.globalAlpha = A;
  x.translate(cx, cy);

  // 1) ЗАРЕВО, КОТОРОЕ ГАСИТ. У ангела первый слой — свет; здесь первый слой
  //    ТЕМНЕЕ доски: он съедает звёзды вокруг борта. Тон стороны появляется
  //    только на дальнем краю грязным подмесом — не свечение, а пятно.
  var halo = Math.max(2, demonQ(R * (sp ? 1.5 : 2.05) * (1 + breath * 0.05), 2));
  var qh = demonQ(heat, 0.1);
  x.beginPath(); x.arc(0, 0, halo, 0, Math.PI * 2);
  x.fillStyle = demonGrad('dh' + halo + '_' + qh.toFixed(1) + '_' + tone, function () {
    var g = x.createRadialGradient(0, 0, halo * 0.05, 0, 0, halo);
    g.addColorStop(0, 'rgba(9,4,6,0.90)');
    g.addColorStop(0.38, 'rgba(38,10,12,' + (0.30 + 0.16 * qh) + ')');
    g.addColorStop(0.70, 'rgba(' + tone + ',' + (0.10 + 0.06 * qh) + ')');
    g.addColorStop(1, 'rgba(' + tone + ',0)');
    return g;
  });
  x.fill();

  // 2) ЗАДНИЕ ЛОХМОТЬЯ
  var lim = sp ? 4 : 6;
  F.limbs.forEach(function (lb, i) {
    if (i >= lim || lb.front) return;
    demonLimb(x, R, lb, t, D, loose, heat);
  });

  // 3) ТЕЛО. Контур считается заново каждый кадр (см. demonOutline).
  var n = D >= 2 ? 30 : (D >= 1 ? 20 : 12);
  var P = demonOutline(R, t, F, loose, hit, n);

  // жар под кромкой: широкая обводка тем же контуром на сложении. Без неё на
  // чёрной доске тело — просто провал, и не понять, где оно кончается.
  if (D >= 1) {
    x.save();
    x.globalCompositeOperation = 'lighter';
    demonPath(x, P);
    x.strokeStyle = 'rgba(148,34,16,' + (0.09 + 0.10 * heat) + ')';
    x.lineWidth = Math.max(1, R * 0.22);
    x.stroke();
    x.restore();
  }

  demonPath(x, P);
  var qr = Math.max(1, demonQ(R, 2));
  x.fillStyle = demonGrad('bd' + qr, function () {
    var g = x.createRadialGradient(0, 0, qr * 0.10, 0, 0, qr * 1.35);
    g.addColorStop(0, 'rgba(26,11,12,1)');
    g.addColorStop(0.55, 'rgba(15,7,10,1)');
    g.addColorStop(1, 'rgba(6,3,6,1)');
    return g;
  });
  x.fill();
  // КРОМКА — сальный блеск на шкуре, светлее сверху-слева. Единственная
  // светлая линия на теле; она же и держит силуэт.
  x.strokeStyle = demonGrad('br' + qr, function () {
    var g = x.createLinearGradient(-qr, -qr, qr, qr);
    g.addColorStop(0, 'rgba(216,198,188,0.40)');
    g.addColorStop(0.45, 'rgba(118,100,96,0.15)');
    g.addColorStop(1, 'rgba(58,42,42,0.05)');
    return g;
  });
  x.lineWidth = Math.max(0.5, R * 0.022);
  x.stroke();

  // 4) ТРЕЩИНЫ. Всё, чем тело светит. Клип по контуру: трещина, вылезшая за
  //    кромку, мгновенно превращает шкуру в проволочный чертёж.
  if (D >= 1) {
    x.save();
    demonPath(x, P);
    x.clip();
    var cn = D >= 3 ? 9 : (D >= 2 ? 6 : 3);
    F.cracks.forEach(function (c) {
      if (c.rank >= cn) return;
      var pulse = 0.45 + 0.55 * Math.sin(t * (Math.PI * 2 / c.per) + c.ph);
      var al = (0.30 + 0.55 * heat) * (0.30 + 0.70 * pulse);
      var pts = [], i;
      for (i = 0; i <= 5; i++) {
        var u = i / 5;
        var rr = R * (c.r0 + c.len * u);
        var aa = c.a + c.seg[Math.min(4, i)] * u;
        pts.push([Math.cos(aa) * rr, Math.sin(aa) * rr * 0.94]);
      }
      x.beginPath();
      x.moveTo(pts[0][0], pts[0][1]);
      for (i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
      // сначала тёмный подрез: без него светлая линия лежит НА шкуре, а не в ней
      x.strokeStyle = 'rgba(0,0,0,0.65)';
      x.lineWidth = Math.max(0.6, R * 0.034);
      x.stroke();
      x.save();
      x.globalCompositeOperation = 'lighter';
      x.strokeStyle = 'rgba(255,104,32,' + al.toFixed(3) + ')';
      x.lineWidth = Math.max(0.35, R * 0.014);
      x.stroke();
      x.restore();
    });
    x.restore();
  }

  // 5) ПАСТЬ. Открывается редко и не по часам: период плавает от оков.
  var gper = 4.6 - loose * 1.8;
  var gin = t % gper;
  var gk = gin < 0.60 ? Math.sin(gin / 0.60 * Math.PI) : 0;
  demonMaw(x, R, t, gaze, D, loose, heat, F, gk);
  // выдох: дуга пыли уходит от пасти и гаснет
  if (D >= 1 && gk > 0.05) {
    x.save();
    x.rotate(gaze);
    var er = R * (0.5 + (1 - gk) * 1.5);
    x.beginPath();
    x.arc(R * 0.2, 0, er, -1.1, 1.1);
    x.strokeStyle = 'rgba(150,72,44,' + (0.22 * gk).toFixed(3) + ')';
    x.lineWidth = Math.max(0.5, R * 0.05 * gk);
    x.stroke();
    x.restore();
  }

  // 6) ЛИКИ
  if (!sp && D >= 1) {
    var fmax = D >= 3 ? 5 : (D >= 2 ? 3 : 1);
    F.faces.forEach(function (fc, fi) {
      if (fi >= fmax) return;
      var p = ((t + fc.ph) % fc.per) / fc.per;
      if (p > 0.30) return;
      var k = Math.sin(p / 0.30 * Math.PI);
      var pt = demonAt(P, fc.a);
      var px = Math.cos(fc.a) * R * pt.r * fc.r;
      var py = Math.sin(fc.a) * R * pt.r * 0.94 * fc.r;
      demonFace(x, px, py, R * fc.sz * (0.62 + 0.38 * k), fc, k, D, heat);
    });
  }

  // 7) ПЕРЕДНИЕ ЛОХМОТЬЯ
  F.limbs.forEach(function (lb, i) {
    if (i >= lim || !lb.front) return;
    demonLimb(x, R, lb, t, D, loose, heat);
  });

  // 8) ВЕНЕЦ РОГОВ. Редеет по ступеням через rank — снимаются не подряд
  //    стоящие, а вразбивку, иначе венец превращается в половину венца.
  if (!sp && D >= 1) {
    var hn = D >= 3 ? 13 : (D >= 2 ? 9 : 5);
    F.horns.forEach(function (h) {
      if (h.rank >= hn) return;
      demonHorn(x, R, h, t, D, P);
    });
  }

  // 9) КАПЛИ смолы с нижней кромки
  if (D >= 1) {
    var dn2 = D >= 2 ? 7 : 3;
    F.drips.forEach(function (d, di) {
      if (di >= dn2) return;
      var p = ((t + d.ph) % d.per) / d.per;
      var pt = demonAt(P, d.a);
      var sx = Math.cos(d.a) * R * pt.r, sy = Math.sin(d.a) * R * pt.r * 0.94;
      var fall = p * p * R * 1.6;
      var al = (1 - p) * 0.85;
      x.strokeStyle = 'rgba(12,6,9,' + al.toFixed(3) + ')';
      x.lineWidth = Math.max(0.4, R * d.sz * 0.9);
      x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx, sy + fall); x.stroke();
      x.beginPath();
      x.ellipse(sx, sy + fall, R * d.sz * 0.85, R * d.sz * 1.3, 0, 0, Math.PI * 2);
      x.fillStyle = 'rgba(10,5,8,' + al.toFixed(3) + ')';
      x.fill();
      if (D >= 2) {
        x.save();
        x.globalCompositeOperation = 'lighter';
        x.beginPath();
        x.arc(sx, sy + fall, R * d.sz * 0.4, 0, Math.PI * 2);
        x.fillStyle = 'rgba(228,84,28,' + (al * 0.5 * heat).toFixed(3) + ')';
        x.fill();
        x.restore();
      }
    });
  }

  // 10) РАЗРЫВ. Ты попал, шкура лопнула, из-под неё бьёт уголь — и она
  //     затягивается у тебя на глазах. Ровно обратное ангельской вспышке:
  //     там «дошло и не значило ничего», здесь «дошло, было больно, и всё
  //     равно ничего не значило».
  if (hit.k > 0) {
    var wa = hit.a, k2 = hit.k;
    var wpt = demonAt(P, wa);
    var wx = Math.cos(wa) * R * wpt.r, wy = Math.sin(wa) * R * wpt.r * 0.94;
    x.save();
    x.globalCompositeOperation = 'lighter';
    x.strokeStyle = 'rgba(255,126,44,' + (0.85 * k2).toFixed(3) + ')';
    x.lineWidth = Math.max(0.6, R * 0.05 * k2);
    x.beginPath();
    for (var w2 = 0; w2 < 5; w2++) {
      var wan = wa + (w2 - 2) * 0.16;
      x.moveTo(Math.cos(wan) * R * 0.35, Math.sin(wan) * R * 0.35 * 0.94);
      x.lineTo(Math.cos(wan) * R * wpt.r * (0.95 + 0.12 * k2),
               Math.sin(wan) * R * wpt.r * 0.94 * (0.95 + 0.12 * k2));
    }
    x.stroke();
    x.beginPath();
    x.arc(wx, wy, R * 0.30 * k2, 0, Math.PI * 2);
    x.fillStyle = 'rgba(255,190,120,' + (0.55 * k2).toFixed(3) + ')';
    x.fill();
    x.restore();
  }

  x.restore();
}

/* ── ПОЛОСА ОКОВ ────────────────────────────────────────────
 * Пара к angelSealBar и его противоположность. У ангела деления ГАСНУТ по мере
 * того, как он умирает. Здесь звенья ЛОПАЮТСЯ, и на месте лопнувшего остаётся
 * уголь: шкала не «сколько у него осталось», а «сколько его ещё держит».
 * Поэтому пустая полоса здесь — худшее, что игрок может увидеть.             */
function demonChainBar(x, cx, cy, w, bound) {
  var f = Math.max(0, Math.min(1, bound == null ? 1 : bound));
  var n = 10, gap = w * 0.012, cw = (w - gap * (n - 1)) / n;
  x.save();
  for (var i = 0; i < n; i++) {
    var bx = cx - w / 2 + i * (cw + gap);
    var on = (i + 1) / n <= f + 1e-6;
    x.fillStyle = on
      ? (f > 0.35 ? 'rgba(196,206,214,0.90)' : 'rgba(232,168,96,0.95)')
      : 'rgba(150,44,18,0.55)';
    x.fillRect(bx, cy, cw, 3);
  }
  x.restore();
}

if (typeof window !== 'undefined') {
  window.demonDraw = demonDraw;
  window.demonChainBar = demonChainBar;
  window.demonWantsFrames = demonWantsFrames;
  window.demonHit = demonHit;
  window.demonSyncHits = demonSyncHits;
  window.demonLo = demonLo;
  window.DEMON = DEMON;
}
