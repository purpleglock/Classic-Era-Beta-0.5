// ════════════════════════════════════════════════════════════════════
// АРЕНА «ДРЕДНОУТ» — СЮЖЕТНЫЕ ЗАДАНИЯ
// ────────────────────────────────────────────────────────────────────
// ⚠️ ЧЕМ МИССИЯ ОТЛИЧАЕТСЯ ОТ СВОБОДНОГО БОЯ. Свободный бой (он же «учебный»)
// — это равные стороны, запас подкреплений и «кто кого». Там нет ни одной
// причины что-то делать, кроме как стрелять; это стенд жанра, и он остаётся
// как есть — отдельной строкой в выборе задания.
// Миссия ставит ЗАДАЧУ, у которой есть провал. Отсюда всё остальное:
//   · борт игрока ШТУЧНЫЙ и заранее заданный — это персонаж, а не сборка;
//   · противник стоит там, где велит сценарий, и часть его СПИТ;
//   · подкрепления приходят волнами по часам, а не из общего счётчика;
//   · победа считается по выполненным задачам, поражение — по гибели борта.
// Всё это движок арены не знает вовсе: он умеет вести бой, а кто в этом бою
// стоит и когда он кончится, решает этот файл через DN.api (см. хвост
// dn_arena.js). Обратно арена зовёт сюда три раза: begin / step / onKill.
//
// ⚠️ ЛИНКОР «БРАНДТАУХЕР» — НЕ РАСХОДНИК. Он проходит через сюжет дальше, и
// сделать его «крепким корветом ради баланса первой миссии» нельзя: игрок
// должен запомнить, что под ним ЛИНКОР. Поэтому сложность здесь набирается не
// хилым игроком, а числом стволов напротив и часами на выполнение.
// Экспорт: window.DNM
// ════════════════════════════════════════════════════════════════════
window.DNM = (function () {
'use strict';

const S = DN.state, A = DN.api;
const V = A.V, clamp = A.clamp, rnd = A.rnd;

// ── §1. БОРТ ИГРОКА ──────────────────────────────────────────
// Собран той же дверью, что и любой проект в игре (DNK.build): корпус линкора,
// тяжёлая переборочная броня, главный калибр 420 мм и вспомогательная плазма.
// Легендарность вынесена в ДВА множителя и подписана — чтобы через месяц было
// видно, где именно корабль «особенный», а не искать это по всем ТТХ.
const BRANDT_HULL = 1.75;      // корпус: полтора линкора — его строили под прорыв
const BRANDT_FIELD = 1.6;      // поле: стелс-контур питается от того же реактора
let BR = null;
function brandt(){
  if (BR) return BR;
  BR = DNK.build({
    key:'brandt', name:'Линкор «Брандтаухер»', cls:'battleship',
    armor:'ship_heavy_bulkhead',
    guns:{ main:{ klass:'heavy',  tech:'rail',   caliber:420, barrelLen:90, barrels:3, layout:'row',     size:1.1 },
           sec: { klass:'medium', tech:'plasma', caliber:190, barrelLen:45, barrels:2, layout:'stacked', size:1 },
           aa:  { klass:'aa',     tech:'laser',  caliber:45,  barrelLen:60, barrels:4, layout:'quad',    size:0.9 } },
    modules:['md_cloak','md_repdrones','md_ampl','sidis_defense'],
    about:'Стелс-линкор особой постройки. Гасит сигнатуру целиком, бьёт с одного захода и уходит до того, как его успевают взять в клещи.' });
  BR.hullBuild = brandtHull;          // штучный силуэт, см. §1б
  BR.deckAt    = brandtDeck;          // установки садятся на хребет, не мимо борта
  BR.turFlat   = 0.46;                // установки утоплены: копьё, а не ёжик
  BR.hp = Math.round(BR.hp*BRANDT_HULL);
  BR.shield = Math.round(BR.shield*BRANDT_FIELD);
  return BR;
}

// ── §1б. КОРПУС «БРАНДТАУХЕРА» ───────────────────────────────
// ⚠️ ЭТО НЕ ПОРТРЕТ КЛАССА, А ШТУЧНЫЙ СИЛУЭТ. bgBuildShip строит типового
// линкора — он правильный, но он ОДИН НА ВСЕХ, а сюжетный борт обязан
// узнаваться с первого кадра. Форма: длинная плоская ПЛИТА с ножевым носом,
// острыми скулами и блочной кормой; светлая палуба сверху, почти чёрный корпус
// под ней, вдоль борта — полосы свечения. Стелс-линкор выглядит лезвием.
//
// Строится ЛОФТОМ ПО СЕЧЕНИЯМ, как и bgHullGeo, а не примитивами: обвод задаётся
// таблицей станций, поэтому нос можно свести в лезвие, а корму раздать в блок.
// Геометрия ЕДИНИЧНОЙ длины, нос в +X, центр в начале координат — это условие
// движка (`grp.scale.setScalar(spec.len)` в shipProto).

// ⚠️ СЕЧЕНИЕ ШЕСТИУГОЛЬНОЕ, А НЕ ПРЯМОУГОЛЬНОЕ. Первый заход строил ПЛОСКУЮ
// ПЛИТУ — и борт вышел плотом: доска с башнями поверху. На референсе это
// ГРАНЁНОЕ КОПЬЁ: узкий плоский гребень по хребту, от него вниз-наружу идут
// скулы до самой широкой линии, оттуда вниз-внутрь — к узкому днищу. Именно
// излом на скуле даёт длинный блик по всей длине и тень под ним, на которой
// весь силуэт и держится.
//   wT — полуширина гребня, hw — полуширина по скуле, wB — полуширина днища,
//   yT — гребень, yC — скула, yB — днище.
function loft6(sec){
  const pos = [], uv = [], idx = [];
  const quad = (a,b,c,d)=>{
    const i0 = pos.length/3;
    [a,b,c,d].forEach(v=>pos.push(v[0],v[1],v[2]));
    uv.push(0,0, 1,0, 1,1, 0,1);
    idx.push(i0,i0+1,i0+2, i0,i0+2,i0+3);
  };
  // шесть точек обвода по часовой, если смотреть с носа
  const ring = S0 => [
    [S0.x, S0.yT,  S0.wT], [S0.x, S0.yC,  S0.hw], [S0.x, S0.yB,  S0.wB],
    [S0.x, S0.yB, -S0.wB], [S0.x, S0.yC, -S0.hw], [S0.x, S0.yT, -S0.wT],
  ];
  for (let i=0;i<sec.length-1;i++){
    const A = ring(sec[i]), B = ring(sec[i+1]);
    for (let k=0;k<6;k++) quad(A[k], B[k], B[(k+1)%6], A[(k+1)%6]);
  }
  const cap = (S0, front)=>{
    const R = ring(S0), c = [S0.x, (S0.yT+S0.yB)/2, 0], i0 = pos.length/3;
    // веером от оси: торец у копья почти вырождается, треугольники честнее квада
    for (let k=0;k<6;k++){
      const p = R[k], q = R[(k+1)%6], b0 = pos.length/3;
      if (front){ pos.push(c[0],c[1],c[2], p[0],p[1],p[2], q[0],q[1],q[2]); }
      else      { pos.push(c[0],c[1],c[2], q[0],q[1],q[2], p[0],p[1],p[2]); }
      uv.push(0.5,0.5, 0,0, 1,0);
      idx.push(b0, b0+1, b0+2);
    }
    void i0;
  };
  cap(sec[0], true); cap(sec[sec.length-1], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('uv',       new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ⚠️ ЭТО НЕ КОПЬЁ С ХРЕБТОМ, А НАВИСАЮЩАЯ ПЛИТА НАД УТОПЛЕННЫМ КОРПУСОМ.
// По крупным планам видно главное: и нос, и корма — это СВЁРНУТЫЕ В ТОЧКУ
// КРОМКИ ВЕРХНЕЙ ПЛИТЫ, а сам корпус до них не доходит. Плита свешивается
// вперёд и назад, под ней — глубокий подрез, и именно в нём горят полосы.
// Нос кончается не иглой по центру, а СРЕЗОМ У ВЕРХНЕЙ КРОМКИ: днище от него
// уходит вниз-назад. Пока я строил симметричное веретено, этого не было.
const BR_P = [   // ВЕРХНЯЯ ПЛИТА
// ⚠️ КОРМА ТУПАЯ И ПОЛНОВЫСОТНАЯ, КЛИН ИДЁТ ТОЛЬКО К НОСУ. Вот главная ошибка,
// которую я повторял три захода: сводил В ТОЧКУ ОБА КОНЦА — и борт выходил
// линзой-листом, тонкой щепкой при формально верных 7:1. На арте силуэт это
// ДЛИННЫЙ КЛИН: у кормы полная высота и полная ширина, срез вертикальный, а
// вперёд обвод убывает монотонно до острия. Отсюда и вся масса корабля.
//  x       wT     hw     wB     yT      yC      yB
  { x: 0.500, wT:0.003, hw:0.004, wB:0.003, yT: 0.020, yC: 0.017, yB: 0.014 },  // остриё носа
  { x: 0.400, wT:0.009, hw:0.015, wB:0.008, yT: 0.024, yC: 0.018, yB: 0.010 },
  { x: 0.250, wT:0.020, hw:0.031, wB:0.018, yT: 0.030, yC: 0.020, yB: 0.006 },
  { x: 0.050, wT:0.032, hw:0.047, wB:0.029, yT: 0.036, yC: 0.024, yB: 0.002 },
  { x:-0.040, wT:0.036, hw:0.052, wB:0.032, yT: 0.038, yC: 0.026, yB: 0.001 },
  { x:-0.060, wT:0.038, hw:0.054, wB:0.034, yT: 0.058, yC: 0.040, yB: 0.000 },  // УСТУП вверх
  { x:-0.250, wT:0.043, hw:0.060, wB:0.038, yT: 0.062, yC: 0.042, yB:-0.002 },
  { x:-0.430, wT:0.045, hw:0.062, wB:0.040, yT: 0.064, yC: 0.043, yB:-0.004 },
  { x:-0.500, wT:0.045, hw:0.062, wB:0.040, yT: 0.064, yC: 0.043, yB:-0.004 },  // ТУПОЙ СРЕЗ
];
const BR_B = [   // КОРПУС ПОД ПЛИТОЙ: уже её, тоже тупой в корме
  { x: 0.200, wT:0.008, hw:0.014, wB:0.007, yT: 0.004, yC:-0.001, yB:-0.006 },
  { x: 0.020, wT:0.022, hw:0.032, wB:0.019, yT: 0.000, yC:-0.014, yB:-0.030 },
  { x:-0.180, wT:0.030, hw:0.044, wB:0.026, yT:-0.002, yC:-0.026, yB:-0.050 },
  { x:-0.380, wT:0.033, hw:0.048, wB:0.028, yT:-0.004, yC:-0.031, yB:-0.058 },
  { x:-0.500, wT:0.033, hw:0.048, wB:0.028, yT:-0.004, yC:-0.031, yB:-0.058 },
];
// ⚠️ КОРПУС ПЕРЕВЁРНУТ. Таблицы ниже описывают обвод «плитой вверх», но борт
// собирается ЗЕРКАЛЬНО: массивная часть с огнями уходит НАВЕРХ, тонкая кромка —
// вниз. Так силуэт и садится на арт. Зеркалим одним местом, чтобы таблицы
// оставались читаемыми: верх и низ меняются ролями, порядок yT>yB сохраняется.
function brFlip(T){
  return T.map(k=>({ x:k.x, wT:k.wB, hw:k.hw, wB:k.wT, yT:-k.yB, yC:-k.yC, yB:-k.yT }));
}
// Палуба под установки — верх ПЛИТЫ (её плоский гребень).
function brandtDeck(x){
  // после переворота выше оказывается то корпус, то плита — берём тот, что выше
  const a = brAt(brFlip(BR_P), x), b = brAt(brFlip(BR_B), x);
  return (b.yT > a.yT) ? { hw:b.wT, y:b.yT } : { hw:a.wT, y:a.yT };
}
function brAt(T, x){
  for (let i=1;i<T.length;i++){
    if (x >= T[i].x || i===T.length-1){
      const A=T[i-1], B=T[i], k=(x-A.x)/((B.x-A.x)||1);
      return { hw:A.hw+(B.hw-A.hw)*k, wT:A.wT+(B.wT-A.wT)*k, yC:A.yC+(B.yC-A.yC)*k, yT:A.yT+(B.yT-A.yT)*k };
    }
  }
  return { hw:T[0].hw, wT:T[0].wT, yC:T[0].yC, yT:T[0].yT };
}

function brandtHull(tone){
  const grp = new THREE.Group();
  const plate = (typeof bgHullMat==='function') ? bgHullMat(tone)       : new THREE.MeshStandardMaterial({color:0x8fa6b8, metalness:0.6, roughness:0.45});
  const body  = (typeof bgHullMat==='function') ? bgHullMat(tone, true) : new THREE.MeshStandardMaterial({color:0x2a3038, metalness:0.6, roughness:0.7});
  const glow  = (typeof bgGlowMat==='function') ? bgGlowMat(0xc06cff, 0.9) : new THREE.MeshBasicMaterial({color:0xc06cff});
  const warm  = (typeof bgGlowMat==='function') ? bgGlowMat(0xffcf94, 0.9) : new THREE.MeshBasicMaterial({color:0xffcf94});
  const add = (geo, mat)=>{ const m=new THREE.Mesh(geo, mat); grp.add(m); return m; };

  // ⚠️ НИЖНИЕ ДВЕ ТРЕТИ ОБЯЗАНЫ ПОПАДАТЬ В СИЛУЭТ. Пока корпус под плитой был
  // взят `dim`-материалом, он тонул в чёрном фоне: в кадре оставалась одна
  // светлая плита, и борт читался щепкой при почти верных пропорциях (7:1
  // против 7.7 у арта). Высоты не хватало НЕ в геометрии, а в свете.
  const P = brFlip(BR_P), B = brFlip(BR_B);
  add(loft6(P), plate);
  add(loft6(B), plate);

  // ⚠️ КОРМА ДОДЕЛАНА: блок машинного отделения ПОД плитой и позади корпуса,
  // гранёный, с подрезом. Раньше корма просто сходила на нет — борт выглядел
  // обрубленным.
  add(loft6(brFlip([          // блок машинного отделения
    { x:-0.300, wT:0.016, hw:0.028, wB:0.014, yT:-0.048, yC:-0.058, yB:-0.068 },
    { x:-0.460, wT:0.024, hw:0.040, wB:0.021, yT:-0.046, yC:-0.062, yB:-0.080 },
    { x:-0.520, wT:0.022, hw:0.036, wB:0.019, yT:-0.048, yC:-0.062, yB:-0.078 },
  ])), body);
  add(loft6(brFlip([          // гребень вдоль кормовой трети
    { x: 0.020, wT:0.004, hw:0.006, wB:0.003, yT:-0.030, yC:-0.038, yB:-0.044 },
    { x:-0.170, wT:0.006, hw:0.010, wB:0.004, yT:-0.044, yC:-0.060, yB:-0.074 },
    { x:-0.330, wT:0.006, hw:0.010, wB:0.004, yT:-0.048, yC:-0.062, yB:-0.076 },
  ])), body);

  // ПОЛОСЫ В ПОДРЕЗЕ — по кромке корпуса, следуя его сужению
  const strip = (x0, x1, dy, mat, th, k)=>{
    const N=10, secs=[];
    for (let i=0;i<=N;i++){
      const x = x0+(x1-x0)*i/N, P0 = brAt(BR_B, x), q=0.0011;
      secs.push({ x:x, wT:q, hw:q, wB:q, yT:P0.yC+dy+th, yC:P0.yC+dy, yB:P0.yC+dy-th });
    }
    [1,-1].forEach(sz=>{
      const g2 = loft6(secs), pos = g2.attributes.position;
      for (let i=0;i<pos.count;i++) pos.setZ(i, pos.getZ(i) + sz*brAt(B, pos.getX(i)).hw*(k||0.98));
      pos.needsUpdate = true; g2.computeVertexNormals();
      add(g2, mat);
    });
  };
  strip( 0.14, -0.44,  0.010, glow, 0.0040, 1.00);   // верхняя, у самой кромки плиты
  strip( 0.06, -0.42, -0.012, glow, 0.0024, 0.97);
  for (let i=0;i<10;i++) strip(-0.01-i*0.040, -0.036-i*0.040, -0.001, warm, 0.0019, 1.01);

  // светящиеся щели на кормовом срезе плиты — они же видны на арте
  [1,-1].forEach(sz=>{
    for (let i=0;i<4;i++){
      const m = add(loft6(brFlip([
        { x:-0.452-i*0.004, wT:0.0016, hw:0.0016, wB:0.0016, yT:0.052, yC:0.048, yB:0.044 },
        { x:-0.468-i*0.004, wT:0.0016, hw:0.0016, wB:0.0016, yT:0.052, yC:0.048, yB:0.044 },
      ])), glow);
      m.position.z = sz*(0.008+i*0.005);
    }
  });

  // ДЮЗЫ под кормовым блоком. Факел растёт по +Y (арена тянет `scale.y`),
  // а узел развёрнут так, что +Y смотрит В КОРМУ.
  const nz = [];
  [1,-1].forEach(sz=>{
    // СОПЛО: гранёный раструб, а не пустое место перед факелом
    // ⚠️ СОПЛА ПО СРЕДНЕЙ ЛИНИИ КОРМЫ. У кромки они читались наростом сверху.
    const noz = add(loft6([
      { x:-0.470, wT:0.009, hw:0.016, wB:0.009, yT: 0.014, yC: 0.000, yB:-0.014 },
      { x:-0.540, wT:0.011, hw:0.019, wB:0.011, yT: 0.016, yC: 0.000, yB:-0.016 },
      { x:-0.556, wT:0.009, hw:0.015, wB:0.009, yT: 0.012, yC: 0.000, yB:-0.012 },
    ]), body);
    noz.position.z = sz*0.016;
    const fg = loft6([
      { x:0,    wT:0.006, hw:0.011, wB:0.006, yT:0.011, yC:0, yB:-0.011 },
      { x:0.09, wT:0.001, hw:0.002, wB:0.001, yT:0.002, yC:0, yB:-0.002 },
    ]);
    fg.rotateZ(Math.PI/2);
    const fl = add(fg, glow);
    fl.rotation.z = Math.PI/2;
    fl.position.set(-0.558, 0.000, sz*0.016);
    nz.push(fl);
  });
  grp.userData.nz = nz;
  return grp;
}

// ── §2. КАТАЛОГ ──────────────────────────────────────────────
// Учебный бой лежит здесь же, хотя ведёт его не этот файл: список заданий
// должен быть ОДИН, иначе экран выбора собирается из двух источников и они
// разъезжаются.
const LIST = [
  { id:'free', kind:'free', name:'УЧЕБНЫЙ БОЙ',
    sub:'Свободная схватка на арене',
    text:'Ни задач, ни сюжета: равные стороны, свой проект, выучка противника и размер схватки — на ваш выбор. Здесь ставят руку: ход ступенями, наводка отдельно от корпуса, мощность колесом.' },
  { id:'azumi', kind:'mission', name:'МИССИЯ I · «АЗУМИ»',
    sub:'Линкор «Брандтаухер» · орбита Азуми',
    text:'Обойдя защитные посты Коалиции рас под маскировкой, «Брандтаухер» выходит на орбиту Азуми. Гарнизон не поднят по тревоге. Снять дежурные борта и космопорт, удержать точку до подхода союзных эсминцев и прикрыть их, пока они гасят планетарные щиты. Уйти вы должны своим ходом.' },
];

// ── §3. НАСТРОЙКИ СЦЕНАРИЯ ───────────────────────────────────
// Всё, что придётся крутить после первой же проверки, собрано в одном месте.
const CFG = {
  arena:   4300,
  station: [700, 0, 0],          // космопорт
  start:   [-820, 60, 300],      // откуда выходит «Брандтаухер»
  evac:    [-3250, 140, 0],      // точка эвакуации — позади, в стороне от Коалиции
  evacR:   340,
  capR:    520,                  // радиус точки захвата
  capHold: 16,                   // сколько секунд её держать
  shieldT: 150,                  // сколько союзники ломают планетарные щиты
  waveGap: 27,                   // пауза между подкреплениями Коалиции
  holdCap: 9,                   // ⚠️ и сколько их разом на удержании (см. wave)
  lastGap: 15,                   // и то же, когда уже началась эвакуация
  // Куда развернуть борта, «смотрящие на Азуми». Планета ездит за камерой
  // (см. §6), поэтому это не её координата, а просто далёкая точка в её
  // направлении — разворот по ней честный, а сама планета ни при чём.
  planet:  [-2600, -1700, -10000],
};

let M = null;                    // состояние текущей миссии
const decor = [];                // всё, что миссия добавила на сцену

// ── §4. МЕЛКИЕ РУКИ ──────────────────────────────────────────
function add(node){ S.scene.add(node); decor.push(node); return node; }
function clearDecor(){ decor.forEach(n=>S.scene.remove(n)); decor.length = 0; }

// Развести обломки пояса из шара вокруг точки.
// ⚠️ НЕ УБИВАТЬ, А ОТОДВИГАТЬ. Первый заход ставил камню `dead=1` — казалось,
// это тот же флаг, которым его гасит попадание. Не тот: `stepRocks` вычёркивает
// мёртвый камень из списка, но его меш (а это InstancedMesh на сотни ячеек)
// остаётся в сцене осиротевшим и рисуется мусором — кадр забивало плоскостями.
// Камень живой и валидный, ему просто не место здесь: сдвигаем `pos`, а меш
// подтянется сам на ближайшем VOX.step.
function clearRocks(at, r){
  (S.rocks||[]).forEach(k=>{
    if (k.dead) return;
    const need = r + k.r;
    if (k.pos.distanceTo(at) >= need) return;
    const dir = k.pos.clone().sub(at);
    if (dir.lengthSq() < 1) dir.set(1, 0.2, 0.3);
    k.pos.copy(at).addScaledVector(dir.normalize(), need + 140);
    if (k.mesh) k.mesh.position.copy(k.pos);
  });
}

// Поставить борт в точку и развернуть носом на цель. Свой respawn у арены
// ставит борта по БАЗАМ сторон — в миссии баз нет, есть места по сценарию.
function place(s, pos, look){
  A.respawn(s);
  s.pos.set(pos[0], pos[1], pos[2]);
  s.vel.set(0,0,0);
  const dir = V(look[0]-pos[0], look[1]-pos[1], look[2]-pos[2]).normalize();
  s.q.setFromUnitVectors(V(1,0,0), dir);
  const up = V(0,1,0).applyQuaternion(s.q), want = V(0,1,0).projectOnPlane(dir);
  if (want.lengthSq()>0.01){
    want.normalize();
    const ra = up.angleTo(want);
    if (ra>1e-4) s.q.premultiply(new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3().crossVectors(up,want).normalize(), ra));
  }
  s.node.position.copy(s.pos); s.node.quaternion.copy(s.q);
  if (s===S.me){ S.aim.yaw = Math.atan2(dir.z, dir.x); S.aim.pit = 0; S.camAnchor = null; }
  return s;
}

// role/anchor — это ЗАДАЧА борта, а не его характер (см. §8а dn_arena.js):
// 'line' дерётся по общим правилам, 'hold' работает по месту и не бросает пост.
function unit(key, mine, name, pos, look, role){
  const u = A.makeShip(DNK.preset(key), mine, name);
  place(u, pos, look || CFG.station);
  u.ai = { t:0, tgt:null, role: role || 'line' };
  if (role === 'hold') u.ai.anchor = u.pos.clone();
  return u;
}

// ── §5. КОСМОПОРТ ────────────────────────────────────────────
// ⚠️ ПОРТ БЫЛ МЕЛЬЧЕ КОРАБЛЯ, КОТОРЫЙ ЕГО АТАКУЕТ. Кольцо радиусом 84 — это 170
// единиц в поперечнике, при линкоре в 250 длиной. Оттого «жалкие посты»: игрок
// подходит к галактической столице и видит деталь размером с себя. Сооружение
// обязано подавлять масштабом, иначе никакой постановки кадра не спасёт.
const R_RING = 300;                  // радиус причального кольца
// ⚠️ СТАНЦИЯ — НЕ КОРАБЛЬ БЕЗ ДВИГАТЕЛЯ. Соблазн был велик: взять дредноут,
// обнулить ему ход и назвать станцией. Так нельзя — игрок читает силуэт раньше
// подписи, и «космопорт», у которого нос и корма, ломает сцену. Здесь свой
// узел: причальное кольцо, ферма, узел управления. Башен у него нет вовсе:
// космопорт защищает ГАРНИЗОН, в этом и смысл первой задачи.
// ⚠️ ПОРТ СТРОИТСЯ ТЕМ ЖЕ ЖЕЛЕЗОМ, ЧТО И БОРТА. Первый заход был собран из
// TorusGeometry, CylinderGeometry и SphereGeometry — то есть ровно из того
// словаря, которого проект избегает везде. Кольцо-бублик, труба-мачта и шар-
// ступица рядом с гранёными плитованными корпусами читаются как чужая деталь
// из другой игры. Здесь только `bgTaper` (тело с РАЗНЫМ сечением на концах) и
// `bgHullMat` (плита с бампом, тем же тоном стороны) — см. battle_gl.js:
// «коробка с одинаковыми торцами и есть тот самый квадратик, который видно за
// версту; скос всего в четверть уже превращает её в надстройку».
function stationMesh(){
  const g = new THREE.Group();
  const TAP = (typeof bgTaper === 'function') ? bgTaper : null;
  // ⚠️ ОСНОВНАЯ МАССА — ТУСКЛАЯ. `bgHullMat('foe')` без `dim` даёт светлую плиту
  // с розовым подсветом стороны: на корвете это намёк, а на сооружении в шестьсот
  // единиц — заливка, и порт светится как леденец. Яркая плита остаётся только
  // на палубах и причальных площадках, где она читается как освещённое место.
  const hull = (typeof bgHullMat === 'function') ? bgHullMat('foe', true)
             : new THREE.MeshStandardMaterial({ color:0x564850, metalness:0.62, roughness:0.62 });
  const dark = hull;
  const lit  = (typeof bgHullMat === 'function') ? bgHullMat('foe')
             : new THREE.MeshStandardMaterial({ color:0xa8909a, metalness:0.62, roughness:0.44 });

  // одно тело: длина по X, скос задаётся долями kw/kl, sx кренит верх вдоль X
  const put = (l,h,w,kw,kl,sx, mat, x,y,z, ry,rz)=>{
    const geo = TAP ? TAP(l,h,w,kw,kl,sx) : new THREE.BoxGeometry(l,h,w);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x||0, y||0, z||0);
    m.rotation.set(0, ry||0, rz||0);
    g.add(m); return m;
  };
  const RAD = t => -t;                 // длина тела смотрит ОТ центра наружу
  const TAN = t => -(t + Math.PI/2);   // длина тела идёт по касательной

  // ПРИЧАЛЬНОЕ КОЛЬЦО — не бублик, а ФЕРМА из шестнадцати звеньев. Гранёный
  // обод сразу читается как построенное, а не отлитое.
  const NSEG = 16, CH = 2*R_RING*Math.sin(Math.PI/NSEG) + 8;
  for (let i=0;i<NSEG;i++){
    const t = i/NSEG*Math.PI*2;
    put(CH, 30, 46, 0.66, 0.94, 0, hull, Math.cos(t)*R_RING, 0, Math.sin(t)*R_RING, TAN(t));
    // раскос между звеньями: тонкая наклонная стойка, «ферменность» обода
    const t2 = (i+0.5)/NSEG*Math.PI*2;
    put(30, 44, 13, 0.5, 0.7, 0, dark, Math.cos(t2)*R_RING, 0, Math.sin(t2)*R_RING, RAD(t2));
  }

  // СТУПИЦА — ярусами, как рубка у борта: снизу шире, кверху уже.
  [[190,74,190,0.78],[150,62,150,0.74],[104,52,104,0.7]].forEach(([l,h,w,k],i)=>
    put(l,h,w,k,k,0, i?hull:dark, 0, i*62 - 34, 0));

  // МАЧТА — четыре сужающихся яруса вместо трубы
  // ⚠️ МАЧТА НЕ ГЛАВНАЯ. В четыре яруса она вымахивала выше диаметра кольца, и
  // порт читался как башня с ободом у подножия. Главное здесь — ПРИЧАЛ.
  let my = 30, mw = 82;
  for (let i=0;i<3;i++){
    put(mw, 84, mw, 0.82, 0.82, 0, i===1?lit:hull, 0, my + 42, 0);
    my += 80; mw *= 0.82;
  }
  put(18, 42, 18, 0.4, 0.4, 0, hull, 0, my + 20, 0);            // шпиль антенн
  // нижняя мачта — короче, порт растёт в обе стороны
  put(74, 96, 74, 0.78, 0.78, 0, dark, 0, -96, 0);
  [-1,1].forEach(sy=> put(200, 20, 200, 0.86, 0.86, 0, lit, 0, sy*(sy>0?170:150), 0));   // палубы

  // СПИЦЫ: шесть ферм от ступицы к ободу
  for (let i=0;i<6;i++){
    const t = i*Math.PI/3;
    put(R_RING-86, 22, 30, 0.6, 0.9, 0, dark,
        Math.cos(t)*(R_RING+86)/2, 0, Math.sin(t)*(R_RING+86)/2, RAD(t));
  }

  // ПРИЧАЛЫ: четыре рукава наружу, площадка и кран на каждом
  const BERTH = [];
  for (let i=0;i<4;i++){
    const t = i*Math.PI/2 + Math.PI/4, cx = Math.cos(t), cz = Math.sin(t);
    put(150, 26, 34, 0.62, 0.88, 0, dark, cx*(R_RING+78), 0, cz*(R_RING+78), RAD(t));
    put(86, 16, 86, 0.8, 0.8, 0, lit, cx*(R_RING+152), 0, cz*(R_RING+152), RAD(t));
    put(16, 88, 16, 0.5, 0.6, 0, dark, cx*(R_RING+152), 48, cz*(R_RING+152), RAD(t));   // стойка крана
    put(78, 12, 12, 0.5, 0.7, 22, dark, cx*(R_RING+172), 92, cz*(R_RING+172), RAD(t));  // стрела
    BERTH.push([cx, cz, t]);
  }

  // ГРУЗ: штабеля на площадках — мелочь, которая говорит, что порт РАБОТАЕТ
  BERTH.slice(0,3).forEach(([cx,cz,t])=>{
    for (let k=0;k<6;k++){
      const row = k%3, col = (k/3)|0;
      put(30, 16, 17, 0.9, 0.96, 0, k%2?hull:dark,
          cx*(R_RING+128) - cz*(row-1)*20, 16 + col*17, cz*(R_RING+128) + cx*(row-1)*20, RAD(t));
    }
  });

  // ПРИШВАРТОВАННЫЕ БОРТА: гражданские, вдоль рукава, заметно мельче порта
  BERTH.slice(0,3).forEach(([cx,cz,t],i)=>{
    const L = 140 + i*28, ax = cx*(R_RING+150), az = cz*(R_RING+150), ay = (i-1)*50;
    put(L, 34, 44, 0.58, 0.44, L*0.16, dark, ax + cx*26, ay, az + cz*26, RAD(t));
    put(30, 22, 26, 0.66, 0.7, 0, hull, ax + cx*(26 - L*0.30), ay + 24, az + cz*(26 - L*0.30), RAD(t));
  });

  // ⚠️ ОГНИ — ОДИН ОБЪЕКТ, А НЕ СОРОК СПРАЙТОВ. Каждый спрайт это свой вызов
  // отрисовки, а бортов в кадре бывает два десятка (см. шапку buildTurretNodes).
  const pos = [], col = [];
  const lamp = (x,y,z,c)=>{ pos.push(x,y,z); col.push(c[0],c[1],c[2]); };
  const WARM=[1.0,0.80,0.52], COLD=[0.50,0.89,0.96], RED=[1.0,0.30,0.36];
  for (let i=0;i<NSEG*2;i++){
    const t=i/(NSEG*2)*Math.PI*2;
    lamp(Math.cos(t)*R_RING, 16, Math.sin(t)*R_RING, i%3 ? WARM : COLD);
  }
  BERTH.forEach(([cx,cz])=>{
    lamp(cx*(R_RING+152), 26, cz*(R_RING+152), COLD);
    lamp(cx*(R_RING+152), -26, cz*(R_RING+152), COLD);
  });
  lamp(0, my + 52, 0, RED); lamp(0, -152, 0, RED);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pg.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  const pts = new THREE.Points(pg, new THREE.PointsMaterial({
    map:A.glowTex(), size:18, sizeAttenuation:true, vertexColors:true,
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:1 }));

  if (A.bake) A.bake(g);            // вся статика — в пару вызовов
  g.add(pts);
  // ⚠️ ОГНИ ОБЯЗАНЫ ИМЕТЬ ПОТОЛОК ЭКРАННОГО РАЗМЕРА. `sizeAttenuation` растит
  // точку обратно пропорционально дальности: вплотную к кольцу каждая из
  // полусотни ламп раздувается на пол-экрана, и всё это АДДИТИВНО и БЕЗ записи
  // глубины ложится слоями друг на друга. Заливка взлетает, кадр умирает —
  // ровно то «возле станции фпс падает». Геометрия тут ни при чём: её всего
  // два меша. Размер подрезается по дальности в step().
  g.userData.lamps = pts;
  return g;
}

// Запись борта для арены, собранная руками: makeShip строит корабль из проекта,
// а у станции проекта нет. Поля здесь ровно те, которых движок касается.
function makeStatic(spec, node, mine){
  S.scene.add(node);
  const s = {
    cls:spec.cls, key:spec.key, C:spec, mine:mine, name:spec.name, node:node,
    pos:V(), vel:V(), q:new THREE.Quaternion(), roll:0,
    hp:spec.hp, hpMax:spec.hp, sh:spec.shield, shMax:spec.shield, shT:0,
    pw:'off', pwT:0, en:spec.en, enMax:spec.en,
    step:1, thr:0, alive:true, gunT:0, ab:{}, abOn:{},
    amp:0, siege:false, cloak:0, hot:0, pdUp:0, slow:0, ai:null, dead:0, tur:[],
    fort:true,
  };
  S.ships.push(s);
  return s;
}

function stationSpec(hp){
  return { key:'st_azumi', cls:'station', name:'Космопорт «Азуми-Верхний»',
    len:660, hp:hp, shield:Math.round(hp*0.25), spd:0, acc:0, yaw:0, lift:0, en:100,
    gun:{ rng:900, spd:900, ru:'—', mag:1 }, mounts:[], acts:[],
    res:{ kinetic:0.20, energy:0.15, missile:0.10 }, pd:0 };
}

// ── §6. ПЛАНЕТА И ЕЁ ЩИТЫ ────────────────────────────────────
// ⚠️ АЗУМИ — НЕ ОБЪЕКТ НА АРЕНЕ, А НЕБО. Первый заход поставил её обычной
// сферой в трёх тысячах единиц — и получилась не планета, а СТЕНА: сквозь неё
// пролетали астероиды, ореол спрайтом давал по краю широкий серый обод, и всё
// вместе читалось как круг, наклеенный поверх боя.
// Планета устроена как небо и ведёт себя как небо:
//   · узел ЕЗДИТ ЗА КАМЕРОЙ (только сдвиг, поворот неизменен) — значит, к ней
//     нельзя подлететь и её нельзя обогнуть, а угловой размер постоянен;
//   · depthTest выключен, renderOrder −1 — рисуется ДО всего и не спорит с
//     обломками за глубину; заодно снят потолок дальности камеры;
//   · свет ей идёт от того же ключевого источника, что и кораблям, поэтому у
//     неё есть терминатор — та самая граница дня и ночи, без которой шар
//     остаётся плоским кружком.
// Ободом теперь работает АТМОСФЕРА (френель по кромке), а не спрайт-ореол.
// ⚠️ ВЕКТОР СЧИТАЕТСЯ ЛЕНИВО, А НЕ ПРИ РАЗБОРЕ ФАЙЛА. three.js приезжает ESM-
// модулем и в момент чтения этого файла ЕЩЁ НЕ ПОДНЯТ: любой `new THREE.*` в
// теле модуля роняет его целиком (ровно так же заведены временные векторы в
// dn_arena.js — tmpInit). Здесь это стоило всего DNM: «DNM is not defined».
let P_DIR = null;
function pdir(){ return P_DIR || (P_DIR = V(-0.26, -0.17, -1).normalize()); }
const P_DIST = 10000, P_RAD = 2650;

// Поверхность рисуется шумом в холст: полосы облачности, материки, шапки. Без
// карты сфера остаётся ровно закрашенной, а ровно закрашенный шар глаз читает
// как круг, а не как мир.
function planetTex(){
  const w=768, h=384, c=document.createElement('canvas'); c.width=w; c.height=h;
  const x=c.getContext('2d'), img=x.createImageData(w,h), d=img.data;
  const hash=(i,j)=>{ const s=Math.sin(i*127.1+j*311.7)*43758.5453; return s-Math.floor(s); };
  const vnoise=(u,v)=>{                        // сглаженный шум на решётке
    const i=Math.floor(u), j=Math.floor(v), fu=u-i, fv=v-j;
    const su=fu*fu*(3-2*fu), sv=fv*fv*(3-2*fv);
    const a=hash(i,j), b=hash(i+1,j), cc=hash(i,j+1), dd=hash(i+1,j+1);
    return (a*(1-su)+b*su)*(1-sv) + (cc*(1-su)+dd*su)*sv;
  };
  const fbm=(u,v)=>{ let s=0, a=0.5, f=1;
    for (let o=0;o<5;o++){ s+=a*vnoise(u*f,v*f); f*=2; a*=0.5; } return s; };
  for (let j=0;j<h;j++){
    const lat = (j/h-0.5)*2;                   // −1 полюс … +1 полюс
    for (let i=0;i<w;i++){
      const n = fbm(i/w*7, j/h*7) + 0.22*Math.cos(lat*3.1);
      const ice = Math.abs(lat) > 0.80 - 0.12*fbm(i/w*9+40, j/h*9);
      let r,g,b;
      if (ice){               r=214; g=228; b=236; }
      else if (n > 0.62){     const k=(n-0.62)*2.4;      // суша
                              r=72+70*k; g=88+66*k; b=64+40*k; }
      else {                  const k=(0.62-n)*1.5;      // океан, к глубине темнее
                              r=26+26*(1-k); g=68+48*(1-k); b=104+58*(1-k); }
      const cl = fbm(i/w*4+11, j/h*4+7);       // облачность поверх всего
      if (cl > 0.60){ const k=Math.min(1,(cl-0.60)*3.2)*0.8;
                      r+=(232-r)*k; g+=(240-g)*k; b+=(246-b)*k; }
      const o=(j*w+i)*4; d[o]=r; d[o+1]=g; d[o+2]=b; d[o+3]=255;
    }
  }
  x.putImageData(img,0,0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace || t.colorSpace;
  return t;
}

// Френель: чем ближе точка к кромке шара, тем ярче. Им сделаны и атмосфера
// (снаружи, мягко), и щит (жёстче, с рябью).
const FRES_V = `varying vec3 vN; varying vec3 vP;
  void main(){ vN = normalize(normalMatrix*normal);
               vP = (modelViewMatrix*vec4(position,1.0)).xyz;
               gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const FRES_F = `uniform vec3 uCol; uniform float uK; uniform float uPow; uniform float uT;
  uniform float uRipple; varying vec3 vN; varying vec3 vP;
  void main(){
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(-vP))), uPow);
    float g = 1.0 + uRipple*0.35*sin(vP.y*0.004 + uT*1.7);
    gl_FragColor = vec4(uCol, clamp(f*g,0.0,1.0)*uK);
  }`;
function fresMat(col, k, pow, ripple, side){
  return new THREE.ShaderMaterial({
    uniforms:{ uCol:{value:new THREE.Color(col)}, uK:{value:k}, uPow:{value:pow},
               uT:{value:0}, uRipple:{value:ripple} },
    vertexShader:FRES_V, fragmentShader:FRES_F,
    transparent:true, depthWrite:false, depthTest:false,
    blending:THREE.AdditiveBlending, side:side||THREE.FrontSide });
}

function buildPlanet(){
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(P_RAD, 56, 40),
    new THREE.MeshStandardMaterial({ map:planetTex(), roughness:1, metalness:0 }));
  ball.rotation.z = 0.32;                       // ось наклонена: шар без наклона мёртв
  g.add(ball);
  // атмосфера: тонкая кромка снаружи диска, а не заливка на полкадра
  const air = new THREE.Mesh(new THREE.SphereGeometry(P_RAD*1.055, 48, 32),
    fresMat(0x86c8ff, 0.62, 3.0, 0, THREE.BackSide));
  g.add(air);
  // щит: та же кромка, но жёстче и с рябью — видно, что это поле, а не воздух
  const shMat = fresMat(0x8fe6ff, 0.40, 2.0, 1, THREE.FrontSide);
  const sh = new THREE.Mesh(new THREE.SphereGeometry(P_RAD*1.11, 44, 30), shMat);
  g.add(sh);
  // ⚠️ ГЛУБИНОЙ НЕ УЧАСТВУЕТ. Иначе обломки арены прошивают планету насквозь и
  // весь фокус с «далёким небом» разваливается на первом же камне.
  g.traverse(o=>{ if (o.material){ o.material.depthTest=false; o.material.depthWrite=false; } });
  g.renderOrder = -10;
  add(g);
  return { grp:g, shield:sh, shMat:shMat, air:air.material,
           pos:V().copy(pdir()).multiplyScalar(P_DIST) };
}

// Луч союзника по щиту. Живёт полсекунды и гаснет — это отметка «работа идёт»,
// а не оружие: урона по щиту от неё нет, щит считается по часам сценария.
// ⚠️ БЬЁТ В НАПРАВЛЕНИИ, А НЕ В ТОЧКУ: планета ездит за камерой, и «точка
// планеты» у каждого кадра своя — луч, построенный по ней, дёргался бы.
function shieldBeam(from){
  const to = from.clone().addScaledVector(pdir(), 5200);
  const g = new THREE.BufferGeometry().setFromPoints([from.clone(), to]);
  const m = new THREE.LineBasicMaterial({ color:0x9ff0ff, transparent:true, opacity:0.55,
    depthWrite:false, blending:THREE.AdditiveBlending });
  const ln = new THREE.Line(g, m);
  S.scene.add(ln);
  M.beams.push({ n:ln, m:m, t:0 });
}

// ── §7. МЕТКИ ЗАДАЧ НА СЦЕНЕ ─────────────────────────────────
// Точка захвата и точка эвакуации — это МЕСТА, а места должны быть видны в
// кадре, а не только стрелкой в HUD. Кольцо своим цветом плюс ореол.
function marker(pos, col, r){
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 3, 6, 44),
    new THREE.MeshBasicMaterial({ color:col, transparent:true, opacity:0.35 }));
  ring.rotation.x = Math.PI/2; g.add(ring);
  const ring2 = ring.clone(); ring2.rotation.x = 0; ring2.rotation.y = Math.PI/2; g.add(ring2);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map:A.glowTex(), color:col,
    transparent:true, opacity:0.10, depthWrite:false, blending:THREE.AdditiveBlending }));
  halo.scale.set(r*2.6, r*2.6, 1); g.add(halo);
  g.position.copy(pos);
  return add(g);
}

// ── §8. ЗАПУСК ЗАДАНИЯ ───────────────────────────────────────
function begin(id){
  clearDecor();
  S.arena = CFG.arena;
  const me = A.makeShip(brandt(), true, 'БРАНДТАУХЕР');
  place(me, CFG.start, CFG.station);
  S.me = me;
  me.cloak = 8;                       // выход из-под маскировки: несколько секунд форы

  const DPS = DNK.dpsOf(me.C);        // всё, что ниже, меряется ОГНЁМ ИГРОКА, а не на глаз

  M = {
    id:id, st:'strike', t:0, alert:0, alerted:false,
    planet:buildPlanet(), beams:[], waveT:CFG.waveGap, waves:0,
    hold:0, shield:1, gap:0, allies:[], garrison:[], station:null,
    capNode:null, evacNode:null, note:'', noteT:0, q:[], cur:null,
  };

  // космопорт: примерно четырнадцать секунд сосредоточенного огня
  const stn = makeStatic(stationSpec(Math.round(DPS*14)), stationMesh(), false);
  stn.pos.set(CFG.station[0], CFG.station[1], CFG.station[2]);
  stn.node.position.copy(stn.pos);
  M.station = stn;

  // ⚠️ АРЕНА СЫПЛЕТ КАМНИ, НЕ ЗНАЯ ПРО СООРУЖЕНИЕ. Пояс раскидывается по всему
  // объёму до того, как миссия что-либо поставит, и глыба в сотню единиц
  // втыкается прямо в причальное кольцо: кадр сразу читается как поломка, а не
  // как порт. Расчищаем ему место — заодно и перед носом у игрока, чтобы старт
  // не начинался с уклонения от валуна в упор.
  clearRocks(stn.pos, R_RING + 320);
  clearRocks(V(CFG.start[0], CFG.start[1], CFG.start[2]), 300);

  // ⚠️ ГАРНИЗОН СПИТ. Это и есть «застать врасплох»: борта стоят на дежурстве
  // без хода, с холодными орудиями, и просыпаются ТОЛЬКО от первого попадания
  // (или сами через минуту). Дать им ИИ сразу — значит отменить весь смысл
  // подхода под маскировкой.
  const GAR = [['vereten','Дозорный «Булай»',[980,80,-360]],
               ['vereten','Дозорный «Онда»',  [900,-90, 420]],
               ['strizh', 'Фрегат «Хибари»',   [560, 40, 520]],
               ['strizh', 'Фрегат «Судзумэ»',  [640,120,-480]]];
  GAR.forEach(([k,n,p])=>{
    const u = A.makeShip(DNK.preset(k), false, n);
    place(u, p, CFG.start);
    u.ai = null; u.dormant = true; u.step = 0; u.thr = 0;
    M.garrison.push(u);
  });

  note('ПОРА ПОКАЗАТЬ КОАЛИЦИИ, КАК ВОЕВАТЬ', 5);
  talk('me',  'Кажется, мы всё таки напаролись на гарнизон...');
  talk('me',  'Хотя... в секторе космопорта всего 4 корабля.');
  talk('cmd', 'Даю добро на ликвидацию. Второй раз так близко к галактической столице не подойти.');
  talk('me',  'Значит, работаем с одного захода. К БОЮ!');
  A.say('«Брандтаухер», бейте первым.');
}

function note(t, sec){ M.note = t; M.noteT = sec || 4; }

// ── §8б. ЭФИР ────────────────────────────────────────────────
// ⚠️ ЗАДАЧА И РЕПЛИКА — РАЗНЫЕ ВЕЩИ. Строка задачи наверху отвечает на вопрос
// «что делать»; её читают мельком и она обязана быть сухой. Всё остальное —
// кто мы, зачем мы здесь и чем за это платим — идёт эфиром, слева, по одной
// реплике за раз. Без него миссия остаётся набором таймеров: игрок выполняет
// четыре задачи и не знает, ЧТО он только что сделал.
//
// Правила письма те же, что для хроник: короткие фразы, ноль пафоса, никто не
// объясняет очевидного и не произносит названий механик. Люди на мостике
// говорят так, как говорят на работе.
const VOICE = {
  me:  { n:'Сетис',   c:'120,225,245' },
  ally:{ n:'Флавий',  c:'125,255,192' },
  foe: { n:'Республиканский флот', c:'255,90,130' },
  cmd: { n:'Рэдрик Рий',     c:'255,196,90' },
};
// ⚠️ РЕПЛИКА — ЭТО ВРЕМЯ, А НЕ СТРОКА. Раньше здесь было «набить 46 знаков в
// секунду и подождать»: реплика кончалась и следующая стартовала В ТОМ ЖЕ
// КАДРЕ. Четыре реплики на смене задачи выходили очередью без единой паузы —
// читать это невозможно, глаз не успевает даже понять, что сменился говорящий.
// Кино держится на паузах, а не на буквах: пауза ПЕРЕД чужой репликой длиннее,
// чем перед своей же следующей, а внутри строки держат знаки препинания.
const TYPE = 26;                     // знаков в секунду: было 46, это скороговорка
const GAP_SELF = 0.40;               // тот же голос продолжает
const GAP_TURN = 0.95;               // слово переходит к другому — держим паузу

function charCost(ch){
  if ('.!?…'.indexOf(ch) >= 0) return 0.30;   // точка — вдох
  if (',;:—–'.indexOf(ch) >= 0) return 0.13;  // запятая — полувдох
  return 0;
}
function typeTime(t){ let v=0; for (let i=0;i<t.length;i++) v += 1/TYPE + charCost(t[i]); return v; }
// сколько знаков уже произнесено к моменту age
function typedCount(c){
  let v=0, n=0;
  for (let i=0;i<c.t.length;i++){ v += 1/TYPE + charCost(c.t[i]); if (v > c.age) break; n++; }
  return n;
}

function talk(who, text, sec){
  if (!M) return;
  // длительность = набор + время на прочтение + хвост на осмысление
  const d = sec || (typeTime(text) + clamp(text.length*0.030, 1.0, 2.8) + 0.45);
  M.q.push({ w:who, t:text, d:d });
}

function stepTalk(dt){
  if (M.gap > 0){ M.gap -= dt; return; }        // держим паузу между репликами
  if (M.cur){
    M.cur.age += dt;
    if (M.cur.age >= M.cur.d){
      const nx = M.q[0];
      M.gap = (nx && nx.w === M.cur.w) ? GAP_SELF : GAP_TURN;
      M.cur = null;
    }
    return;
  }
  // ⚠️ ОЧЕРЕДЬ, А НЕ ПЕРЕБИВАНИЕ. Реплики приходят пачками (смена задачи +
  // тревога + потеря борта в одну секунду), и без очереди игрок увидит только
  // последнюю — то есть ничего.
  if (M.q.length) M.cur = Object.assign({ age:0 }, M.q.shift());
  // очередь не копится бесконечно: старое из неё уже неактуально
  if (M.q.length > 6) M.q.splice(0, M.q.length-6);
}

// ── §9. ПОДКРЕПЛЕНИЯ КОАЛИЦИИ ────────────────────────────────
// Приходят ОТ ЗАЩИТНЫХ ПОСТОВ — то есть с той стороны, откуда «Брандтаухер»
// пробирался мимо них. Всегда одним краем: игрок должен понимать, где фронт, и
// иметь спину, в которую можно уходить.
// Что говорит Коалиция, когда подходят её борта. Волн больше, чем реплик, —
// последняя повторяется: к этому времени игрок уже не читает, а уходит.
const WAVE_SAY = [
  'Кавалария прибыла!',
  'Кто уцелел? Отзовитесь.',
  'Броня на подходе, держитесь!',
  'Вызывали?',
];
const WAVE = [['strizh','strizh','vereten'],
              ['vereten','vereten','strizh'],
              ['vereten','hor','strizh','strizh'],
              ['hor','vereten','vereten','tsar'],
              ['tsar','hor','vereten','vereten','strizh']];
// ⚠️ ПОТОЛОК ЖИВЫХ БОРТОВ. «Врагов очень много» — это ощущение, а не число в
// массиве: на эвакуации волны идут каждые пятнадцать секунд и не кончаются, и
// без потолка через минуту на сцене шесть десятков корпусов с башнями — кадр
// ложится, а бой от этого не становится страшнее. Двадцать два борта в воздухе
// уже не вытянуть ни при какой игре, и ровно это игроку и надо понять.
const FOE_CAP = 22;
// ⚠️ ПОТОЛОК ЗАДАЁТСЯ ЭТАПОМ, А НЕ ОДИН НА ВСЮ МИССИЮ. На удержании игрок один
// против всего, что пришло, и без своего, более низкого потолка этап
// превращался в чистую арифметику на вылет: враги копятся линейно до двух
// десятков, входящий урон растёт, живучесть у борта одна. Замер до правки —
// гибель на 128-й секунде при 170 секундах работы, и мастерство не решало
// (бот, который дерётся и маневрирует, жил те же 128).
function wave(n, tag, cap){
  if (S.ships.filter(o=>!o.mine && o.alive).length >= (cap || FOE_CAP)) return 0;
  const list = WAVE[Math.min(n, WAVE.length-1)];
  const R = S.arena;
  list.forEach((k,i)=>{
    const p = [R*0.80, rnd(-260,260), rnd(-900,900)];
    const u = unit(k, false, (tag||'Коалиция')+'-'+(n+1)+String.fromCharCode(1040+i),
                   p, [S.me.pos.x, S.me.pos.y, S.me.pos.z]);
    u.step = 3;
  });
  return list.length;
}

// ── §10. ХОД СЦЕНАРИЯ ────────────────────────────────────────
const STEP = {

  // ЗАДАЧА 1 — внезапный удар. Пока гарнизон спит, у игрока преимущество
  // первого залпа; проснувшись, четыре борта против одного линкора — ровно та
  // задача, ради которой «Брандтаухер» и построен.
  strike(dt){
    if (!M.alerted){
      M.alert += dt;
      // ⚠️ ТРЕВОГУ ПОДНИМАЕТ ЛЮБОЕ ПОПАДАНИЕ, А НЕ ПРОБИТИЕ КОРПУСА. Первый
      // залп садится в ЩИТ, корпус при этом цел — и проверка «hp < hpMax»
      // молчала: гарнизон продолжал спать под обстрелом до истечения минуты.
      const touched = u => u.hp < u.hpMax || u.sh < u.shMax;
      const hurt = M.garrison.some(touched) || touched(M.station);
      if (hurt || M.alert > 70){
        M.alerted = true;
        // ⚠️ ГАРНИЗОН — ЭТО ОХРАНА ПОРТА. Подняв тревогу, он обязан драться ЗА
        // ПОРТ, а не уходить за игроком в пустоту: роль 'hold' с постом на месте
        // дежурства и держит их у объекта, который они прикрывают.
        M.garrison.forEach(u=>{ if (u.alive){
          u.ai = { t:0, tgt:null, role:'hold', anchor:u.pos.clone() };
          u.dormant=false; u.step=3; } });
        note('МЫ ПОДНЯЛИ ТРЕВОГУ', 4);
        talk('foe', 'Порт, у нас неопознанный борт на внутренней орбите! Это наш линкор... СТОП! ТРЕВОГА! ');
        talk('me',  'Прятаться больше незачем, работаем.');
        if (window.DNS) DNS.alarm();
      }
    }
    if (alive(M.garrison).length===0 && !M.station.alive){
      M.st='capture'; M.hold=0;
      M.capNode = marker(V(CFG.station[0],CFG.station[1],CFG.station[2]), 0x5adcf0, CFG.capR);
      note('Красивый был космический порт... Ну ничего, занимаем позицию.', 4);
      talk('me',  'Наверное отсюда был красивый вид на Азуми.');
      talk('cmd', 'Отличная работа, к вам приближаются союзные силы.');
    }
  },

  // ЗАДАЧА 2 — захват. Держать точку телом, а не флажком: отсчёт идёт, пока
  // борт внутри кольца, и стоит уйти — замирает.
  capture(dt){
    const d = S.me.pos.distanceTo(V(CFG.station[0],CFG.station[1],CFG.station[2]));
    if (d < CFG.capR) M.hold = Math.min(CFG.capHold, M.hold + dt);
    else M.hold = Math.max(0, M.hold - dt*0.5);
    if (M.hold >= CFG.capHold){
      M.st='hold'; M.waveT = 12;
      if (M.capNode){ S.scene.remove(M.capNode); M.capNode=null; }
      // ⚠️ ЭСМИНЦЫ НА ПОЗИЦИИ, А НЕ В СВАЛКЕ. У них ОДНА работа — жечь щит, и
      // ради неё они и пришли. Роль 'hold' держит их на огневой: они огрызаются
      // по тому, кто подошёл, но с места не уходят и за корветами не гоняются.
      // Без этого весь третий этап разваливался: союзники уезжали драться,
      // щит не двигался, и прикрывать было некого.
      const at = [ [-1500,120,-700], [-1650,-40,140], [-1500,60,760] ];
      ['vereten','vereten','hor'].forEach((k,i)=>{
        const u = unit(k, true, ['«Стриж»','«Зарница»','«Кряж»'][i], at[i], CFG.planet, 'hold');
        M.allies.push(u);
      });
      note('ТОЧКА ВЗЯТА · ПОДКРЕПЛЕНИЯ НА ПОДХОДЕ', 5);
      talk('ally','«Брандтаухер», это Флавий. Не ждали?');
      talk('ally','Держитесь, парни, мы поможем с уничтожением щита. Работы минуты на две с половиной.');
      talk('me',  'Надеюсь, у нас они есть... Ладно, мы вас прикроем, работайте!');
      A.say('Союзные эсминцы вошли в сектор и открыли огонь по щитам Азуми.');
    }
  },

  // ЗАДАЧА 3 — прикрыть союзников. Щит гаснет по часам, но ТОЛЬКО пока живы
  // те, кто по нему бьёт: выбьют эсминцы — миссия сорвана, и это единственный
  // способ провалить её, не потеряв свой борт.
  hold(dt){
    const live = alive(M.allies);
    if (live.length === 0){
      fail('Щиты Азуми целы, удар сорван.');
      return;
    }
    M.shield = Math.max(0, M.shield - dt/CFG.shieldT * (0.55 + 0.45*live.length/M.allies.length));
    // лучи по щиту: по одному в полсекунды от случайного живого эсминца
    M.beamT = (M.beamT||0) - dt;
    if (M.beamT <= 0){ M.beamT = 0.45; shieldBeam(live[(Math.random()*live.length)|0].pos); }

    M.waveT -= dt;
    if (M.waveT <= 0){
      M.waveT = CFG.waveGap; wave(M.waves++, null, CFG.holdCap); note('ПОДКРЕПЛЕНИЯ КОАЛИЦИИ', 3);
      talk('foe', WAVE_SAY[Math.min(M.waves-1, WAVE_SAY.length-1)]);
    }
    // на середине работы эсминцы отчитываются: игрок должен понимать, что часы
    // идут не впустую, иначе третий этап читается как бесконечный
    if (!M.halfSaid && M.shield < 0.5){
      M.halfSaid = true;
      talk('ally','Щит просел. Поднажмем. Ещё немного.');
    }

    if (M.shield <= 0){
      M.st = 'evac';
      M.planet.shMat.uniforms.uK.value = 0;
      M.evacNode = marker(V(CFG.evac[0],CFG.evac[1],CFG.evac[2]), 0x7dffc0, CFG.evacR);
      M.waveT = 6;
      note('ЭТО НЕ ИМЕЕТ СМЫСЛА, ОТСТУПАЙТЕ', 7);
      talk('ally','А я говорил, что получится! Встречай нас, галактическая столица!');
      talk('cmd', '«Брандтаухер», отходите. Немедленно.');
      talk('me',  'А как же... наши?');
      talk('cmd', 'Это приказ.');
      talk('me',  '…Принято. Курс на точку эвакуации.');
      talk('ally','Идите. Мы подержим их, сколько выйдет.');
      A.say('Щиты сняты. Коалиция ведёт к Азуми всё, что у неё есть, этот бой не вытянуть.');
      // ⚠️ СОЮЗНИКОВ МЫ БРОСАЕМ. Это не недоделка: они остаются драться и почти
      // наверняка гибнут. Задание считается выполненным по УХОДУ «Брандтаухера»
      // — линкор здесь дороже эскадры, и игрок должен это почувствовать.
      M.allies.forEach(u=>{ if (u.alive) u.step = 3; });
    }
  },

  // ЗАДАЧА 4 — уйти. Волны идут чаще и не кончаются: держаться бессмысленно,
  // это и есть содержание задачи.
  evac(dt){
    M.waveT -= dt;
    if (M.waveT <= 0){ M.waveT = CFG.lastGap; wave(Math.max(2, M.waves++)); }
    if (S.me.pos.distanceTo(V(CFG.evac[0],CFG.evac[1],CFG.evac[2])) < CFG.evacR){
      talk('me', 'Прыжковый контур заряжен. Уходим.');
      win('«Брандтаухер» ушёл с орбиты Азуми. ' +
          ' Из звена Флавия на связь не вышел никто.');
    }
  },
};

function alive(list){ return list.filter(u=>u.alive); }

// Подрезка огней станции по дальности — см. §5, потолок экранного размера.
function stepLamps(){
  if (!M || !M.station) return;
  const p = M.station.node.userData.lamps; if (!p) return;
  const d = S.cam.position.distanceTo(M.station.pos);
  p.material.size = Math.max(4, Math.min(18, d*0.022));
}

function step(dt){
  stepLamps();
  if (!M || S.over) return;
  M.t += dt;
  if (M.noteT > 0) M.noteT -= dt;
  stepTalk(dt);
  // ⚠️ СПЯЩИЙ ГАРНИЗОН НЕ ДРЕЙФУЕТ. У него нет ИИ, а движок каждый кадр всё
  // равно тянет борт вперёд по инерции — без этого дежурные борта медленно
  // разъезжались бы по сектору, и «дежурство» читалось бы как бегство.
  M.garrison.forEach(u=>{ if (u.dormant && u.alive){ u.vel.set(0,0,0); u.thr = 0; } });
  // ⚠️ ВЫБИТЫЕ БОРТА УБИРАЮТСЯ ИЗ СПИСКА. В свободном бою их держат: они ждут
  // подкрепления и возвращаются тем же объектом. В миссии никто не возвращается,
  // а по DN.ships каждый кадр ходят шаг мира, попадания, метки HUD и приборы —
  // за одну эвакуацию список набирает под сотню покойников, и все они считаются.
  for (let i=S.ships.length-1;i>=0;i--){
    const o = S.ships[i];
    if (o!==S.me && !o.alive && o.dead <= -3) S.ships.splice(i,1);
  }
  // гаснущие лучи по щиту
  for (let i=M.beams.length-1;i>=0;i--){
    const b = M.beams[i]; b.t += dt;
    b.m.opacity = Math.max(0, 0.55*(1 - b.t/0.5));
    if (b.t >= 0.5){ S.scene.remove(b.n); b.n.geometry.dispose(); M.beams.splice(i,1); }
  }
  // ⚠️ НЕБО ЕДЕТ ЗА КАМЕРОЙ. Только сдвиг: поворот трогать нельзя, иначе уедет
  // терминатор и наклон оси — и планета начнёт «крутиться» от движения игрока.
  M.planet.grp.position.copy(S.cam.position).addScaledVector(pdir(), P_DIST);
  M.planet.pos.copy(M.planet.grp.position);
  // щит дышит и гаснет по мере обработки
  M.planet.shMat.uniforms.uT.value = M.t;
  M.planet.shMat.uniforms.uK.value = 0.40*M.shield;
  if (M.capNode) M.capNode.rotation.y += dt*0.25;
  if (M.evacNode) M.evacNode.rotation.y += dt*0.4;

  if (!S.me.alive){ fail('«Брандтаухер» потерян. Операция сорвана.'); return; }
  (STEP[M.st] || (()=>{}))(dt);
}

function onKill(s, from){
  if (!M) return;
  if (s === S.me) return;                 // гибель игрока разбирается в step()
  if (s === M.station){ note('КОСМОПОРТ УНИЧТОЖЕН', 3); talk('me','Что ж, жаль, что гражданским не дали уйти...'); }
  else if (M.allies.indexOf(s) >= 0){
    note('СОЮЗНЫЙ БОРТ ПОТЕРЯН', 3);
    const left = alive(M.allies).length;
    talk('ally', left ? 'Потеряли борт. Нас двое… работаем.' : 'Мы держались, «Брандтаухер»…');
  }
}

// ⚠️ ЗА СОБОЙ УБИРАЕТ МИССИЯ, А НЕ АРЕНА. Планета, метки задач и лучи по щиту —
// это её вещи, и арена о них не знает. Пока этой двери не было, выход из миссии
// в свободный бой оставлял на сцене небо Азуми: в бою на другом конце галактики
// посреди арены висел чужой мир, к тому же переставший ездить за камерой.
function clear(){ clearDecor(); M = null; }

function win(txt){ M = null; DN.finish(true, txt); }
function fail(txt){ M = null; DN.finish(false, txt); }

// ── §11. ЗАДАЧА НА ЭКРАНЕ ────────────────────────────────────
// ⚠️ ОДНА СТРОКА СВЕРХУ И НИ СЛОВОМ БОЛЬШЕ. Приборная панель арены собрана
// так, что в бою читаются формы, а не слова (см. §13 dn_arena.js), и вываливать
// поверх неё бортовой журнал нельзя. Здесь ровно три вещи: что делать сейчас,
// сколько этого осталось (полоска) и куда ехать (метка с дальностью).
const GOAL = {
  strike:  ()=>['УНИЧТОЖИТЬ ГАРНИЗОН И КОСМОПОРТ',
                (alive(M.garrison).length + (M.station.alive?1:0)) + ' цел. осталось',
                1 - (alive(M.garrison).length + (M.station.alive?1:0))/(M.garrison.length+1)],
  capture: ()=>['ЗАКРЕПИТЬСЯ НА ТОЧКЕ',
                S.me.pos.distanceTo(V(CFG.station[0],CFG.station[1],CFG.station[2])) < CFG.capR
                  ? 'удержание ' + Math.ceil(CFG.capHold-M.hold) + ' с'
                  : 'вернитесь в кольцо',
                M.hold/CFG.capHold],
  hold:    ()=>['ПРИКРЫТЬ ФЛАВИЯ',
                alive(M.allies).length + ' из ' + M.allies.length + ' эсминцев в строю',
                1-M.shield],
  evac:    ()=>['ОТХОД К ТОЧКЕ ЭВАКУАЦИИ',
                Math.round(S.me.pos.distanceTo(V(CFG.evac[0],CFG.evac[1],CFG.evac[2]))) + ' до точки',
                clamp(1 - (S.me.pos.distanceTo(V(CFG.evac[0],CFG.evac[1],CFG.evac[2]))-CFG.evacR)/
                          (V(CFG.start[0],CFG.start[1],CFG.start[2]).distanceTo(
                           V(CFG.evac[0],CFG.evac[1],CFG.evac[2]))), 0, 1)],
};

// Эфир слева, ПОД строкой задачи и НАД приборами. Место выбрано не «где
// свободно»: слева ничего не рисует ни арена, ни сенсорные кнопки (они у самой
// кромки внизу), а взгляд, оторвавшись от перекрестья, идёт туда первым.
//
// ⚠️ ВЁРСТКА СЧИТАЕТСЯ ПО ПОЛНОЙ РЕПЛИКЕ, А ПРОЯВЛЯЮТСЯ БУКВЫ. Раньше строки
// набирались из УЖЕ НАБРАННОГО куска: блок перевёрстывался на каждой букве,
// прыгал и «дышал» — прочесть его спокойно нельзя. Сначала раскладываем весь
// текст, потом открываем в нём знаки: блок стоит неподвижно, как в кино.
//
// ⚠️ КОЛОНКА БЫЛА 0.42 ШИРИНЫ, то есть 157 пикселей на телефоне, шрифтом в 12.
// Реплика в шесть слов разваливалась на шесть строк бисера. Размер и колонка
// теперь считаются от экрана.
function hudTalk(x, W, H){
  const c = M.cur; if (!c) return;
  const V0 = VOICE[c.w] || VOICE.me;

  const fs   = Math.round(clamp(W/26, 13, 18));       // тело реплики
  const ns   = Math.max(10, Math.round(fs*0.74));     // имя говорящего
  const lh   = Math.round(fs*1.52);
  const px   = Math.round(clamp(W*0.055, 18, 44));
  const wide = Math.min(560, W - px*2);
  const py   = Math.round(Math.max(92, H*0.17));

  // вход и выход: реплика ВСПЛЫВАЕТ, а не возникает
  const fin  = clamp(c.age/0.30, 0, 1);
  const fout = clamp((c.d - c.age)/0.50, 0, 1);
  const al   = Math.min(fin, fout);
  const rise = (1-fin)*7;

  // раскладка по ПОЛНОМУ тексту — блок не шевелится, пока идут буквы
  x.font = fs+'px "Courier New", monospace';
  const lines = [];
  let line = '';
  c.t.split(' ').forEach(w=>{
    const probe = line ? line+' '+w : w;
    if (x.measureText(probe).width > wide){ lines.push(line); line = w; }
    else line = probe;
  });
  if (line) lines.push(line);

  const top = py - ns - 10 + rise;
  const hgt = ns + 10 + lines.length*lh + 10;

  x.save();
  x.textAlign='left'; x.textBaseline='middle';

  // ⚠️ ПОДЛОЖКИ-ПЛАШКИ НЕТ. Затемняющий прямоугольник читался как таблица: у
  // него кромка, и на спокойном небе видно именно её, а не реплику. Эфир должен
  // читаться и на чёрном небе, и на светлом камне, и на вспышке залпа — это
  // даёт ТЕНЬ ПОД БУКВАМИ, у которой краёв нет вовсе. Ставим её один раз на
  // весь блок, снимаем в конце (x.restore).
  x.shadowColor = 'rgba(0,0,0,'+(0.9*al).toFixed(2)+')';
  x.shadowBlur  = fs*1.1;

  // риска говорящего: его цвет, во всю высоту блока
  x.fillStyle = 'rgba('+V0.c+','+(0.85*al).toFixed(2)+')';
  x.fillRect(px-10, top-4, 2, hgt-8);
  void hgt;

  // ИМЯ — в разрядку. Буквы ставим руками: letterSpacing на канве есть не везде,
  // а имя короткое, и разрядка отделяет служебную строку от речи лучше кегля.
  x.font = ns+'px "Courier New", monospace';
  x.fillStyle = 'rgba('+V0.c+','+(0.95*al).toFixed(2)+')';
  const nm = V0.n.toUpperCase();
  let nx = px;
  for (let i=0;i<nm.length;i++){ x.fillText(nm[i], nx, top+ns*0.5); nx += x.measureText(nm[i]).width + ns*0.22; }

  // РЕЧЬ: раскрываем ровно typedCount знаков по уже готовой раскладке
  const shown = typedCount(c);
  x.font = fs+'px "Courier New", monospace';
  x.fillStyle = 'rgba(226,241,249,'+(0.95*al).toFixed(2)+')';
  let used = 0, cx = px, cy = top+ns+8;
  for (let i=0;i<lines.length;i++){
    const L = lines[i];
    const y = top + ns + 10 + i*lh + lh*0.5;
    if (used >= shown) break;
    const take = Math.min(L.length, shown - used);
    x.fillText(L.slice(0, take), px, y);
    if (take < L.length){ cx = px + x.measureText(L.slice(0, take)).width; cy = y; used = shown; break; }
    used += L.length + 1;                       // +1 за пробел, съеденный переносом
    cx = px + x.measureText(L).width; cy = y;
  }

  // каретка, пока говорят: мигает только во время набора
  if (shown < c.t.length && Math.floor(performance.now()/380)%2===0){
    x.fillStyle = 'rgba('+V0.c+','+(0.8*al).toFixed(2)+')';
    x.fillRect(cx+2, cy-fs*0.42, fs*0.52, fs*0.84);
  }
  x.restore();
  x.textAlign='left'; x.textBaseline='middle';
}

function target(){
  if (M.st==='evac') return { p:V(CFG.evac[0],CFG.evac[1],CFG.evac[2]), col:'125,255,192' };
  if (M.st==='capture') return { p:V(CFG.station[0],CFG.station[1],CFG.station[2]), col:'120,225,245' };
  if (M.st==='hold') return null;
  const g = alive(M.garrison)[0] || (M.station.alive ? M.station : null);
  return g ? { p:g.pos, col:'255,90,130' } : null;
}

function hud(x, W, H, s){
  if (!M || !s) return;
  const g = (GOAL[M.st] || (()=>['','',0]))();
  const cx = W/2, top = 18;
  x.textAlign='center'; x.textBaseline='middle';
  x.font='13px "Courier New", monospace';
  x.fillStyle='rgba(220,240,250,0.95)';
  x.fillText(g[0], cx, top+10);
  x.font='11px "Courier New", monospace';
  x.fillStyle='rgba(150,180,196,0.85)';
  x.fillText(g[1], cx, top+28);
  // полоска выполнения — узкая, во всю ширину задачи
  const bw = Math.min(360, W*0.5), bx = cx-bw/2, by = top+40;
  x.fillStyle='rgba(255,255,255,0.10)'; x.fillRect(bx, by, bw, 3);
  x.fillStyle='rgba(120,225,245,0.9)';  x.fillRect(bx, by, bw*clamp(g[2],0,1), 3);

  // ⚠️ ГРОМКАЯ СТРОКА ЖИВЁТ ПРИ ЗАДАЧЕ, А НЕ ПОСРЕДИ ЭКРАНА. Она стояла на
  // 0.28 высоты — то есть ровно под эфиром, и на телефоне трёхстрочная реплика
  // упиралась в неё вплотную: два разных текста сливались в одну стену, и было
  // не понять, где кончается голос и начинается объявление. Это ОБЪЯВЛЕНИЕ О
  // ЗАДАЧЕ («точка взята», «подкрепления»), его место — под самой задачей,
  // отдельной строкой заголовка. И оно обязано влезать в ширину экрана.
  if (M.noteT > 0){
    const k  = clamp(M.noteT/1.2, 0, 1);
    const nf = Math.round(clamp(W/30, 12, 18));
    x.font = nf+'px "Courier New", monospace';
    x.fillStyle = 'rgba(255,196,90,'+(0.35+0.6*k).toFixed(2)+')';
    // длинное объявление переносим, а не выпускаем за кромку
    const lim = W - 32, parts = [];
    let ln = '';
    M.note.split(' ').forEach(w=>{
      const probe = ln ? ln+' '+w : w;
      if (x.measureText(probe).width > lim){ parts.push(ln); ln = w; } else ln = probe;
    });
    if (ln) parts.push(ln);
    parts.forEach((L,i)=> x.fillText(L, cx, by + 22 + i*(nf+5)));
  }

  hudTalk(x, W, H);

  // метка цели: в кадре — ромб с дальностью, за кадром — стрелка по кромке
  const T = target();
  if (T){
    const p = T.p.clone().project(S.cam);
    const sx=(p.x*0.5+0.5)*W, sy=(-p.y*0.5+0.5)*H, seen = p.z<1 && sx>0 && sx<W && sy>0 && sy<H;
    const d = Math.round(T.p.distanceTo(s.pos));
    x.strokeStyle='rgba('+T.col+',0.9)'; x.fillStyle='rgba('+T.col+',0.9)'; x.lineWidth=1.6;
    if (seen){
      x.beginPath();
      x.moveTo(sx,sy-9); x.lineTo(sx+9,sy); x.lineTo(sx,sy+9); x.lineTo(sx-9,sy); x.closePath();
      x.stroke();
      x.font='10px "Courier New", monospace';
      x.fillText(d, sx, sy+22);
    } else {
      // ⚠️ ЗА СПИНОЙ КАДР ЗЕРКАЛИТСЯ. При p.z>1 точка проецируется в
      // ПРОТИВОПОЛОЖНУЮ сторону экрана, и стрелка честно показывала не туда:
      // игрок доворачивал борт от точки эвакуации, а не к ней. Разворачиваем
      // вектор относительно центра — ровно так же, как это делает hudMarks.
      const cy = H/2;
      const dx = (p.z<1 ? sx : 2*cx-sx) - cx;
      const dy = (p.z<1 ? sy : 2*cy-sy) - cy;
      const a = Math.atan2(dy, dx), rr = Math.min(W,H)*0.38;
      const px = cx+Math.cos(a)*rr, py = cy+Math.sin(a)*rr;
      x.save(); x.translate(px,py); x.rotate(a);
      x.beginPath(); x.moveTo(11,0); x.lineTo(-6,7); x.lineTo(-6,-7); x.closePath(); x.fill();
      x.restore();
      x.font='10px "Courier New", monospace';
      x.fillText(d, px, py+18);
    }
  }
  x.textAlign='left';
}

return { LIST, begin, step, hud, onKill, brandt, clear, CFG, get state(){ return M; } };
})();
