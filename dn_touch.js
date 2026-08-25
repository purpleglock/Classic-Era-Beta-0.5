// ════════════════════════════════════════════════════════════════════
// АРЕНА «ДРЕДНОУТ» — УПРАВЛЕНИЕ С ПАЛЬЦА
// ────────────────────────────────────────────────────────────────────
// ⚠️ ЭТО НЕ «КЛАВИАТУРА, НАРИСОВАННАЯ НА ЭКРАНЕ». Перенести W/S/A/D кнопками
// было бы честно и неиграбельно: на телефоне у игрока два больших пальца и
// ноль точности, а борт здесь требует ОДНОВРЕМЕННО вести корпус и наводить
// башни. Поэтому раскладка разведена ровно по тому же принципу, что и на
// клавиатуре (см. шапку dn_arena.js), но под две руки:
//
//   ЛЕВЫЙ палец  — СТИК КОРПУСА: вбок руль, вверх-вниз подруливающие.
//                  Аналоговый: доля отклонения идёт в DN.tRud/DN.tVert, иначе
//                  борт мотает от упора к упору.
//   ЛЕВЫЙ край   — МАШИННЫЙ ТЕЛЕГРАФ: четыре ступени хода, тычком по ступени.
//                  Ползунком его делать нельзя — палец перекрывает шкалу.
//   ПРАВОЕ ПОЛЕ  — НАВОДКА: ведение пальцем по пустому месту экрана водит
//                  башни. Ровно то же, что мышь, и с тем же знаком.
//   ПРАВЫЕ КНОПКИ— огонь (держать), прицеливание, модули 1…6, мощность.
//
// ⚠️ КНОПКИ НЕ ПЕРЕКРЫВАЮТ ПРИБОРЫ. Блок борта арены сидит внизу по центру;
// всё, что здесь рисуется, жмётся к левому и правому краям. Если приборы
// поедут — двигать надо ЭТО, а не приборы: приборы читают глазами, а кнопки
// нащупывают пальцем у края, где палец и лежит.
//
// Ввод берётся Pointer Events с холста сцены: захвата курсора на телефоне нет
// и быть не может, поэтому DN.locked здесь не участвует вовсе.
// Экспорт: window.DNT
// ════════════════════════════════════════════════════════════════════
window.DNT = (function () {
'use strict';

const S = DN.state, A = DN.api;
const clamp = A.clamp;

// Признак сенсорного устройства. Гибриды (ноутбук с тачскрином) остаются на
// мыши: там она точнее, а кнопки на экране только съедают кадр. Переключить
// вручную можно из консоли — DNT.set(true/false).
function detect(){
  return (window.matchMedia && matchMedia('(pointer:coarse)').matches)
      || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer:fine)').matches);
}

// ── Раскладка. Всё считается от размера холста, а не прибито в пикселях:
// экраны телефонов расходятся вдвое, и «красиво на моём» здесь не годится.
//
// ⚠️ ЭКРАН РАЗБИТ НА ТРИ НЕПЕРЕСЕКАЮЩИЕСЯ ПОЛОСЫ, и это главное правило файла.
// Раньше кнопки сыпались кучей в нижнюю треть — прямо на прибор борта, который
// арена рисует по центру внизу, — и низ экрана превращался в свалку колец, где
// палец не попадал никуда. Теперь:
//   ЛЕВЫЙ НИЗ  — только стик курса, вокруг него не рисуется НИЧЕГО.
//   ЛЕВЫЙ КРАЙ выше стика — лестница машинного телеграфа.
//   ПРАВЫЙ КРАЙ — колонка кнопок, ПРАВЫЙ НИЗ — огонь.
//   ВСЁ ОСТАЛЬНОЕ (центр и верх, а это большая часть высокого экрана) — наводка.
// Прибор борта на телефоне арена поднимает выше и рисует урезанным (см. hudPanel):
// телеграф, модули и мощность там больше не дублируются — они здесь, под пальцем.
const L = {};
function layout(W, H){
  const u = clamp(Math.min(W, H)/400, 0.82, 1.45);   // общий калибр под экран
  L.k = u; L.W = W; L.H = H;

  // СТИК КУРСА: вбок — руль, вверх-вниз — ВЫСОТА. Круг большой и один в углу.
  L.stick = { x: 100*u, y: H - 104*u, r: 82*u, kn: 34*u };
  // Зона захвата шире картинки: палец ложится в угол «примерно», и гонять его
  // в нарисованный круг игрок не обязан.
  L.stickBox = { x0: 0, x1: 214*u, y0: H - 216*u, y1: H };

  // ⚠️ ВЕРХ ЭКРАНА ЗАНЯТ. Там задача миссии, эфир мостика и счёт бортов; всё,
  // что ползёт вверх по краям, обязано остановиться до этой черты, иначе в
  // ландшафте лестница и модули уезжали за кадр — то есть их просто не было.
  const top = 86*u;

  // ТЕЛЕГРАФ: лестница у левого края НАД стиком. Ступень — целая строка во всю
  // ширину полосы, промахнуться нечем; полосу можно и вести пальцем.
  const rows = A.THR_STEPS.length;
  const room = Math.max(72, L.stickBox.y0 - 14*u - top);
  const rh   = Math.min(46*u, room/rows);
  L.thr = { x: 8*u, w: 46*u, rh: rh, h: rows*rh, y: L.stickBox.y0 - 14*u - rows*rh, n: rows };

  // ОГОНЬ: зеркало стика в правом углу.
  L.fire = { x: W - 86*u, y: H - 104*u, r: 66*u };

  // КОЛОНКА У ПРАВОГО КРАЯ: мощность, прицеливание, дальше модули вверх. Один
  // столбец с равным шагом — глазами не ищешь, пальцем ведёшь вверх. Упёрлись в
  // верхнюю черту — переносим остаток ВТОРЫМ столбцом внутрь экрана, а не
  // ужимаем кнопки: кнопка мельче пальца бесполезна.
  const r = 25*u, gap = 60*u, y0 = H - 214*u;
  let bx = W - 34*u, by = y0;
  const slot = () => {
    if (by - r < top){ bx -= 58*u; by = y0; }          // столбец кончился — следующий
    const s = { x: bx, y: by, r: r };
    by -= gap;
    return s;
  };
  L.pw   = slot();
  L.zoom = slot();
  L.mods = [];
  const acts = (S.me && S.me.C.acts) || [];
  for (let i = 0; i < acts.length; i++){ const s = slot(); s.i = i; L.mods.push(s); }
}
function hit(b, x, y){ return b && Math.hypot(x-b.x, y-b.y) <= b.r*1.15; }
function inBox(b, x, y){ return x>=b.x0 && x<=b.x1 && y>=b.y0 && y<=b.y1; }

// ── Пальцы. У каждого своя роль, взятая в момент касания и не меняющаяся до
// отрыва: иначе палец, соскользнувший со стика в поле наводки, начинал
// крутить башни, и борт «залипал» на последнем руле.
const P = new Map();

function down(id, x, y){
  const s = S.me;
  if (window.DNS) DNS.boot();
  if (!s) return;
  if (!L.k) layout(S.cv.clientWidth, S.cv.clientHeight);   // первый тычок может опередить первый кадр
  // ⚠️ ЭКРАН ВОЗВРАЩЕНИЯ В СТРОЙ ЖМЁТСЯ ТЫЧКОМ В ЛЮБОЕ МЕСТО. Он собран под
  // клавиши (борт 1…6, точка входа Q/Z/R), и переносить его на пальцы отдельно
  // незачем: в миссии его нет вовсе, а в свободном бою хватит «войти сразу».
  if (S.spawn){ S.keys.add('Enter'); setTimeout(()=>S.keys.delete('Enter'), 60); return; }

  if (hit(L.fire, x, y)){
    P.set(id, { role:'fire' }); S.fire1 = true;
    if (s.tur) s.tur.forEach(T=>{ if (T.cd < 0.09 && T.rel<=0) T.cd = 0; });   // залп в тот же кадр
    return;
  }
  if (hit(L.zoom, x, y)){ P.set(id, { role:'tap' }); S.zoom = !S.zoom; if (window.DNS) DNS.click(); return; }
  if (hit(L.pw,   x, y)){ P.set(id, { role:'tap' }); cyclePower(); return; }
  for (const m of L.mods) if (hit(m, x, y)){
    P.set(id, { role:'tap' });
    const a = s.C.acts[m.i]; if (a) A.useAbil(s, a.k);
    return;
  }
  // ТЕЛЕГРАФ. Полоса захвата вдвое шире нарисованной лестницы, и ступень можно
  // не только ткнуть, но и ВЫВЕСТИ пальцем: роль держится до отрыва, поэтому
  // соскочить с лестницы в наводку по дороге нельзя.
  const T = L.thr;
  if (x < T.x + T.w*2.2 && y > T.y - 10 && y < T.y + T.h + 10){
    P.set(id, { role:'thr' }); throttle(y); return;
  }
  // СТИК: прямоугольник левого нижнего угла целиком.
  if (inBox(L.stickBox, x, y)){ P.set(id, { role:'stick', ox:x, oy:y }); stick(x, y, x, y); return; }
  P.set(id, { role:'aim', px:x, py:y });
}

// Ступень по высоте пальца на лестнице: сверху ПОЛНЫЙ, снизу НАЗАД.
function throttle(y){
  const s = S.me, T = L.thr; if (!s) return;
  const i = clamp(Math.floor((y - T.y) / T.rh), 0, T.n-1);
  const st = T.n-1-i;
  if (s.step !== st){ s.step = st; if (window.DNS) DNS.click(); }
}

function move(id, x, y){
  const p = P.get(id); if (!p) return;
  if (p.role === 'stick'){ stick(p.ox, p.oy, x, y); return; }
  if (p.role === 'thr'){ throttle(y); return; }
  if (p.role === 'aim'){
    // ⚠️ ЗНАКИ ТЕ ЖЕ, ЧТО У МЫШИ. Вправо — прицел вправо, ВНИЗ — прицел вниз.
    // Инверсии здесь нет и не должно быть: она уже была разобрана в арене.
    const k = 0.0034*(S.zoom?0.42:1);
    S.aim.yaw += (x-p.px)*k;
    S.aim.pit -= (y-p.py)*k;
    if (S.aim.yaw> Math.PI) S.aim.yaw -= Math.PI*2;
    if (S.aim.yaw<-Math.PI) S.aim.yaw += Math.PI*2;
    S.aim.pit = clamp(S.aim.pit, -1.0, 1.0);
    p.px = x; p.py = y;
  }
}

function up(id){
  const p = P.get(id); if (!p) return;
  P.delete(id);
  if (p.role === 'fire') S.fire1 = false;
  if (p.role === 'stick'){ S.tRud = 0; S.tVert = 0; L.knob = null; }
}

// Стик: отклонение от точки КАСАНИЯ, а не от нарисованного центра — палец
// ложится куда попало, и подгонять его под картинку игрок не обязан.
//
// ⚠️ ВЕРТИКАЛЬ ЖИВЁТ ЗДЕСЬ, И ДРУГОГО ОРГАНА У НЕЁ НЕТ. Ход вверх-вниз — это
// подруливающие, а не «нос вверх», поэтому он и лёг на ту же ручку, что руль:
// отдельная пара кнопок «выше/ниже» отняла бы у правой руки огонь. Мёртвая
// зона мелкая (палец дрожит, но не настолько), отклик поджат квадратом —
// у центра ручка ведёт мягко, у обода отдаёт полный упор.
function stick(ox, oy, x, y){
  const R = L.stick.r;
  const dead = 0.10;
  const f = v => {
    v = clamp(v, -1, 1);
    if (Math.abs(v) < dead) return 0;
    const t = (Math.abs(v) - dead) / (1 - dead);
    return Math.sign(v) * (t*t*0.45 + t*0.55);          // мягко у центра, упор у обода
  };
  S.tRud  = f((x-ox)/R);
  S.tVert = -f((y-oy)/R);                               // вверх по экрану = всплытие
  L.knob = { x: L.stick.x + S.tRud*R*0.70, y: L.stick.y - S.tVert*R*0.70 };
}

// Мощность по кругу вместо колеса: держать E и вести мышью пальцем неудобно,
// а статей всего четыре — тычок по кнопке проходит их подряд.
function cyclePower(){
  const s = S.me; if (!s) return;
  const K = A.POWER_KEYS;
  const i = Math.max(0, K.indexOf(s.pw));
  s.pw = K[(i+1) % K.length];
  s.pwT = 1.4;
  if (window.DNS) DNS.click();
  A.say('Мощность: ' + DN.POWER[s.pw].name);
}

// ── Рисование. Всё контурами и заливкой, без единого символа шрифта: эмодзи в
// интерфейсе проекта запрещены, а подписи словами на кнопке под пальцем всё
// равно не видно.
function draw(x, W, H, s){
  if (!s || !s.alive || S.spawn) return;
  layout(W, H);
  const k = L.k;
  x.save();
  x.textAlign='center'; x.textBaseline='middle';

  drawStick(x, k);
  drawThrottle(x, k, s);
  drawFire(x, k);
  drawColumn(x, k, s);

  x.restore();
  x.textAlign='center'; x.textBaseline='middle';
}

// ── СТИК КУРСА. Кольцо, крестовина и ЧЕТЫРЕ УКАЗАТЕЛЯ по сторонам: без них
// ручка читалась как «джойстик хода», и вертикаль игрок просто не находил —
// вверх-вниз выглядели пустым местом. Сверху и снизу — двойная стрелка
// (всплытие/погружение), по бокам — перо руля.
function drawStick(x, k){
  const B = L.stick;
  ring(x, B.x, B.y, B.r, 'rgba(255,255,255,0.13)', 1.5);
  ring(x, B.x, B.y, B.r*0.30, 'rgba(255,255,255,0.08)', 1);
  // крестовина осей
  x.strokeStyle='rgba(255,255,255,0.07)'; x.lineWidth=1;
  x.beginPath();
  x.moveTo(B.x-B.r*0.82, B.y); x.lineTo(B.x+B.r*0.82, B.y);
  x.moveTo(B.x, B.y-B.r*0.82); x.lineTo(B.x, B.y+B.r*0.82);
  x.stroke();

  // указатели: подсвечиваются ровно той долей, что ушла в руль/вертикаль
  const hi = v => 'rgba(120,225,245,'+(0.28 + 0.62*clamp(Math.abs(v),0,1)).toFixed(2)+')';
  const dim = 'rgba(170,200,215,0.30)';
  chevron(x, B.x, B.y-B.r*0.80, 0, -1, 9*k, (S.tVert>0.02)?hi(S.tVert):dim, true);
  chevron(x, B.x, B.y+B.r*0.80, 0,  1, 9*k, (S.tVert<-0.02)?hi(S.tVert):dim, true);
  chevron(x, B.x-B.r*0.80, B.y, -1, 0, 9*k, (S.tRud<-0.02)?hi(S.tRud):dim, false);
  chevron(x, B.x+B.r*0.80, B.y,  1, 0, 9*k, (S.tRud>0.02)?hi(S.tRud):dim, false);

  // ручка
  const kn = L.knob || { x:B.x, y:B.y };
  x.fillStyle = (S.tRud||S.tVert) ? 'rgba(120,225,245,0.30)' : 'rgba(10,18,26,0.45)';
  x.beginPath(); x.arc(kn.x, kn.y, B.kn, 0, 6.28); x.fill();
  ring(x, kn.x, kn.y, B.kn, 'rgba(150,225,245,0.60)', 1.8);
}

// Стрелка-«галка», смотрящая в сторону (dx,dy). Двойная — у вертикали: так она
// отличается от руля с одного взгляда. Всё линиями: шрифтовых значков в
// интерфейсе проекта нет и не будет.
function chevron(x, cx, cy, dx, dy, r, col, dbl){
  x.strokeStyle=col; x.lineWidth=2; x.lineCap='round'; x.lineJoin='round';
  // перпендикуляр к направлению — по нему разводятся «крылья» галки
  const nx = -dy, ny = dx;
  const one = off => {
    const ox = cx - dx*off, oy = cy - dy*off;
    x.beginPath();
    x.moveTo(ox + nx*r - dx*r*0.9, oy + ny*r - dy*r*0.9);
    x.lineTo(ox, oy);
    x.lineTo(ox - nx*r - dx*r*0.9, oy - ny*r - dy*r*0.9);
    x.stroke();
  };
  one(0);
  if (dbl) one(r*0.85);
}

// ── МАШИННЫЙ ТЕЛЕГРАФ. Лестница с подписями ступеней и стрелкой фактического
// хода слева. Строка целиком — одна ступень, поэтому мимо не попадёшь.
const THR_NAME = ['НАЗАД','СТОП','СРЕДН','ПОЛНЫЙ'];
function drawThrottle(x, k, s){
  const T = L.thr;
  x.fillStyle='rgba(8,14,20,0.42)';
  x.fillRect(T.x-3, T.y-4, T.w+6, T.h+8);
  ring2(x, T.x-3, T.y-4, T.w+6, T.h+8, 'rgba(255,255,255,0.08)');
  for (let i=0;i<T.n;i++){
    const step = T.n-1-i, on = s.step===step, yy = T.y + i*T.rh;
    x.fillStyle = on ? 'rgba(120,225,245,0.85)' : 'rgba(255,255,255,0.09)';
    x.fillRect(T.x, yy+3, T.w, T.rh-6);
    x.fillStyle = on ? 'rgba(6,14,20,0.95)' : 'rgba(180,205,220,0.65)';
    x.font = Math.round(9*k)+'px "Courier New", monospace';
    x.save(); x.translate(T.x+T.w/2, yy+T.rh/2);
    x.fillText(THR_NAME[step], 0, 0);
    x.restore();
  }
  // фактический ход — риска у правой кромки лестницы
  const v = clamp(s.vel.length()/s.C.spd, 0, 1.45)/1.45;
  const ay = T.y + T.h - v*T.h;
  x.fillStyle='rgba(255,196,90,0.9)';
  x.beginPath();
  x.moveTo(T.x+T.w+2, ay); x.lineTo(T.x+T.w+10, ay-4); x.lineTo(T.x+T.w+10, ay+4);
  x.closePath(); x.fill();
}
function ring2(x, px, py, w, h, col){ x.strokeStyle=col; x.lineWidth=1; x.strokeRect(px,py,w,h); }

// ── ОГОНЬ.
function drawFire(x, k){
  const B = L.fire, canFire = (S.onTarget||0) > 0;
  disc(x, B, S.fire1 ? 'rgba(255,90,120,0.34)' : 'rgba(10,18,26,0.45)',
       canFire ? 'rgba(255,120,150,0.9)' : 'rgba(255,255,255,0.18)');
  x.strokeStyle = canFire ? 'rgba(255,190,205,0.95)' : 'rgba(170,195,210,0.6)'; x.lineWidth = 2;
  const r = B.r*0.40;
  x.beginPath(); x.arc(B.x, B.y, r*0.55, 0, 6.28); x.stroke();
  for (let i=0;i<4;i++){
    const a = i*Math.PI/2;
    x.beginPath();
    x.moveTo(B.x+Math.cos(a)*r*0.8, B.y+Math.sin(a)*r*0.8);
    x.lineTo(B.x+Math.cos(a)*r*1.3, B.y+Math.sin(a)*r*1.3);
    x.stroke();
  }
}

// ── КОЛОНКА У ПРАВОГО КРАЯ: мощность, прицеливание, модули — снизу вверх.
function drawColumn(x, k, s){
  // мощность
  const on = s.pw!=='off' && s.en>0;
  disc(x, L.pw, on?'rgba(120,225,245,0.26)':'rgba(10,18,26,0.45)',
       on?'rgba(150,240,255,0.85)':'rgba(255,255,255,0.16)');
  A.icon(x, L.pw.x, L.pw.y, s.pw==='off'?'eng':s.pw,
         on?'rgba(220,245,255,0.95)':'rgba(150,175,190,0.55)');
  if (s.pw==='off'){
    x.strokeStyle='rgba(150,175,190,0.55)'; x.lineWidth=1.5;
    x.beginPath(); x.moveTo(L.pw.x-10*k, L.pw.y+10*k); x.lineTo(L.pw.x+10*k, L.pw.y-10*k); x.stroke();
  }
  // запас энергии — дужкой по кромке кнопки, чтобы не искать его глазами внизу
  A.arc(x, L.pw.x, L.pw.y, L.pw.r+5, -Math.PI/2,
        -Math.PI/2 + Math.PI*2*clamp(s.en/s.enMax,0,1), 'rgba(255,196,90,0.85)', 3);

  // прицеливание
  disc(x, L.zoom, S.zoom?'rgba(120,225,245,0.28)':'rgba(10,18,26,0.45)',
       S.zoom?'rgba(150,240,255,0.9)':'rgba(255,255,255,0.16)');
  x.strokeStyle = 'rgba(200,230,245,0.85)'; x.lineWidth = 1.8;
  x.beginPath(); x.arc(L.zoom.x-3*k, L.zoom.y-3*k, 8*k, 0, 6.28); x.stroke();
  x.beginPath(); x.moveTo(L.zoom.x+3*k, L.zoom.y+3*k); x.lineTo(L.zoom.x+11*k, L.zoom.y+11*k); x.stroke();

  // модули
  (s.C.acts||[]).forEach((a,i)=>{
    const b = L.mods[i]; if (!b) return;
    const live = s.abOn[a.k]>0, cd = s.ab[a.k]||0;
    disc(x, b, live?'rgba(120,225,245,0.30)':'rgba(10,18,26,0.5)',
         cd>0?'rgba(255,255,255,0.14)':'rgba(120,225,245,0.5)');
    if (cd>0) A.arc(x, b.x, b.y, b.r, -Math.PI/2, -Math.PI/2 + Math.PI*2*(1-cd/a.cd), 'rgba(120,225,245,0.9)', 2.5);
    A.icon(x, b.x, b.y, 'act:'+a.kind,
           live?'rgba(220,245,255,0.95)':(cd>0?'rgba(150,175,190,0.55)':'rgba(200,230,245,0.9)'));
    if (cd>0){
      x.fillStyle='rgba(220,240,250,0.9)';
      x.font=Math.round(10*k)+'px "Courier New", monospace';
      x.fillText(Math.ceil(cd), b.x, b.y+b.r+9*k);
    }
  });
}

function ring(x, cx, cy, r, col, w){
  x.strokeStyle=col; x.lineWidth=w; x.beginPath(); x.arc(cx,cy,r,0,6.28); x.stroke();
}
function disc(x, b, fill, edge){
  x.fillStyle=fill; x.beginPath(); x.arc(b.x,b.y,b.r,0,6.28); x.fill();
  ring(x, b.x, b.y, b.r, edge, 2);
}

function step(dt){ /* всё состояние кладут события; шаг оставлен под будущую инерцию стика */ }

// ── Подписка. Слушаем холст сцены: HUD-холст сквозной (pointer-events:none).
function bind(cv){
  const pt = e => { const r = cv.getBoundingClientRect(); return [e.clientX-r.left, e.clientY-r.top]; };
  cv.addEventListener('pointerdown', e=>{
    if (!S.touch || e.pointerType==='mouse') return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const [x,y]=pt(e); down(e.pointerId, x, y);
  }, { passive:false });
  cv.addEventListener('pointermove', e=>{
    if (!S.touch || !P.has(e.pointerId)) return;
    e.preventDefault(); const [x,y]=pt(e); move(e.pointerId, x, y);
  }, { passive:false });
  const end = e=>{ if (S.touch) up(e.pointerId); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  // ⚠️ ЖЕСТЫ СТРАНИЦЫ ГЛУШАТСЯ ЦЕЛИКОМ. Без этого двойной тычок по кнопке огня
  // зумит страницу, а ведение пальцем тянет адресную строку — играть нельзя.
  ['touchstart','touchmove','touchend','gesturestart'].forEach(t=>
    cv.addEventListener(t, e=>{ if (S.touch) e.preventDefault(); }, { passive:false }));
}

function set(v){ S.touch = !!v; if (!v){ S.tRud=0; S.tVert=0; P.clear(); } }

return { detect, set, bind, draw, step, get on(){ return S.touch; } };
})();
