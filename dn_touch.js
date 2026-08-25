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
const L = {};
function layout(W, H){
  const k = clamp(Math.min(W, H)/420, 0.78, 1.35);   // общий калибр под экран
  L.k = k;
  L.stick = { x: 108*k, y: H - 112*k, r: 74*k, kn: 30*k };
  L.thr   = { x: 22*k, y: H - 300*k, w: 26*k, h: 168*k };
  L.fire  = { x: W - 86*k, y: H - 104*k, r: 54*k };
  L.zoom  = { x: W - 172*k, y: H - 74*k,  r: 30*k };
  L.pw    = { x: W - 168*k, y: H - 168*k, r: 30*k };
  L.mods  = [];
  const acts = (S.me && S.me.C.acts) || [];
  for (let i=0;i<acts.length;i++)
    L.mods.push({ x: W - 44*k, y: H - 250*k - i*66*k, r: 27*k, i:i });
  // Правое поле наводки: всё правее середины, кроме кружков кнопок.
  L.aimX = W*0.40;
}
function hit(b, x, y){ return b && Math.hypot(x-b.x, y-b.y) <= b.r*1.18; }

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
  if (hit(L.zoom, x, y)){ P.set(id, { role:'tap' }); S.zoom = !S.zoom; return; }
  if (hit(L.pw,   x, y)){ P.set(id, { role:'tap' }); cyclePower(); return; }
  for (const m of L.mods) if (hit(m, x, y)){
    P.set(id, { role:'tap' });
    const a = s.C.acts[m.i]; if (a) A.useAbil(s, a.k);
    return;
  }
  const T = L.thr;
  if (x < T.x + T.w*2.4 && y > T.y - T.h*0.15 && y < T.y + T.h*1.15){
    P.set(id, { role:'tap' });
    // ступени сверху вниз: полный … назад
    const n = A.THR_STEPS.length;
    const i = clamp(Math.floor((y - T.y) / (T.h/n)), 0, n-1);
    s.step = n-1-i;
    if (window.DNS) DNS.click();
    return;
  }
  if (x < L.aimX){ P.set(id, { role:'stick', ox:x, oy:y }); stick(x, y, x, y); return; }
  P.set(id, { role:'aim', px:x, py:y });
}

function move(id, x, y){
  const p = P.get(id); if (!p) return;
  if (p.role === 'stick'){ stick(p.ox, p.oy, x, y); return; }
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
function stick(ox, oy, x, y){
  const R = L.stick.r;
  let dx = clamp((x-ox)/R, -1, 1), dy = clamp((y-oy)/R, -1, 1);
  const dead = 0.16;                                  // мёртвая зона: палец дрожит
  const f = v => Math.abs(v) < dead ? 0 : (v - Math.sign(v)*dead)/(1-dead);
  S.tRud  = f(dx);
  S.tVert = -f(dy);                                   // вверх по экрану = всплытие
  L.knob = { x: L.stick.x + f(dx)*R*0.72, y: L.stick.y - S.tVert*R*0.72 };
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

  // стик
  ring(x, L.stick.x, L.stick.y, L.stick.r, 'rgba(255,255,255,0.10)', 1.5);
  ring(x, L.stick.x, L.stick.y, L.stick.r*0.32, 'rgba(255,255,255,0.08)', 1);
  const kn = L.knob || { x:L.stick.x, y:L.stick.y };
  x.fillStyle = (S.tRud||S.tVert) ? 'rgba(120,225,245,0.30)' : 'rgba(255,255,255,0.10)';
  x.beginPath(); x.arc(kn.x, kn.y, L.stick.kn, 0, 6.28); x.fill();
  ring(x, kn.x, kn.y, L.stick.kn, 'rgba(150,225,245,0.55)', 1.5);

  // телеграф: четыре ступени, текущая горит
  const T = L.thr, n = A.THR_STEPS.length, sh = T.h/n;
  for (let i=0;i<n;i++){
    const step = n-1-i, on = s.step===step;
    x.fillStyle = on ? 'rgba(120,225,245,0.85)' : 'rgba(255,255,255,0.10)';
    x.fillRect(T.x, T.y + i*sh + 3, T.w, sh-6);
  }

  // огонь
  const canFire = (S.onTarget||0) > 0;
  disc(x, L.fire, S.fire1 ? 'rgba(255,90,120,0.34)' : 'rgba(10,18,26,0.45)',
       canFire ? 'rgba(255,120,150,0.9)' : 'rgba(255,255,255,0.18)');
  // значок: перекрестье с засечками
  x.strokeStyle = canFire ? 'rgba(255,190,205,0.95)' : 'rgba(170,195,210,0.6)'; x.lineWidth = 2;
  const r = L.fire.r*0.42;
  x.beginPath(); x.arc(L.fire.x, L.fire.y, r*0.55, 0, 6.28); x.stroke();
  for (let i=0;i<4;i++){
    const a = i*Math.PI/2;
    x.beginPath();
    x.moveTo(L.fire.x+Math.cos(a)*r*0.8, L.fire.y+Math.sin(a)*r*0.8);
    x.lineTo(L.fire.x+Math.cos(a)*r*1.3, L.fire.y+Math.sin(a)*r*1.3);
    x.stroke();
  }

  // прицеливание
  disc(x, L.zoom, S.zoom?'rgba(120,225,245,0.28)':'rgba(10,18,26,0.45)',
       S.zoom?'rgba(150,240,255,0.9)':'rgba(255,255,255,0.16)');
  x.strokeStyle = 'rgba(200,230,245,0.85)'; x.lineWidth = 1.8;
  x.beginPath(); x.arc(L.zoom.x-3*k, L.zoom.y-3*k, 9*k, 0, 6.28); x.stroke();
  x.beginPath(); x.moveTo(L.zoom.x+4*k, L.zoom.y+4*k); x.lineTo(L.zoom.x+12*k, L.zoom.y+12*k); x.stroke();

  // мощность: тот же значок, что в приборе арены
  const on = s.pw!=='off' && s.en>0;
  disc(x, L.pw, on?'rgba(120,225,245,0.26)':'rgba(10,18,26,0.45)',
       on?'rgba(150,240,255,0.85)':'rgba(255,255,255,0.16)');
  A.icon(x, L.pw.x, L.pw.y, s.pw==='off'?'eng':s.pw,
         on?'rgba(220,245,255,0.95)':'rgba(150,175,190,0.55)');
  if (s.pw==='off'){                       // «мощность не отведена» — перечёркнуто
    x.strokeStyle='rgba(150,175,190,0.55)'; x.lineWidth=1.5;
    x.beginPath(); x.moveTo(L.pw.x-11*k, L.pw.y+11*k); x.lineTo(L.pw.x+11*k, L.pw.y-11*k); x.stroke();
  }
  // запас энергии — дужкой по кромке кнопки, чтобы не искать его глазами внизу
  A.arc(x, L.pw.x, L.pw.y, L.pw.r+5, -Math.PI/2, -Math.PI/2 + Math.PI*2*clamp(s.en/s.enMax,0,1),
        'rgba(255,196,90,0.85)', 3);

  // модули: те же круги с откатом, что в приборе, но под пальцем
  (s.C.acts||[]).forEach((a,i)=>{
    const b = L.mods[i]; if (!b) return;
    const live = s.abOn[a.k]>0, cd = s.ab[a.k]||0;
    disc(x, b, live?'rgba(120,225,245,0.30)':'rgba(10,18,26,0.5)',
         cd>0?'rgba(255,255,255,0.14)':'rgba(120,225,245,0.5)');
    if (cd>0) A.arc(x, b.x, b.y, b.r, -Math.PI/2, -Math.PI/2 + Math.PI*2*(1-cd/a.cd), 'rgba(120,225,245,0.9)', 2.5);
    A.icon(x, b.x, b.y, 'act:'+a.kind,
           live?'rgba(220,245,255,0.95)':(cd>0?'rgba(150,175,190,0.55)':'rgba(200,230,245,0.9)'));
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
