// ════════════════════════════════════════════════════════════════════
// ЗВУК АРЕНЫ — синтез на месте, без единого файла
// ────────────────────────────────────────────────────────────────────
// ⚠️ ЗВУКОВ В ПРОЕКТЕ НЕТ И ТЯНУТЬ ИХ НЕОТКУДА: ни библиотеки сэмплов, ни права
// качать чужие. Поэтому всё, что здесь звучит, СЧИТАЕТСЯ WebAudio на лету —
// шум, огибающая, пара фильтров. Это честный «космический» тембр (у выстрела нет
// натуры, которую можно подделать), и он ничего не весит.
//
// Что должно быть слышно и зачем:
//   ГУЛ МАШИН — единственный признак хода, который работает, когда смотришь вбок
//     и пыль не в кадре: тон и громкость идут за ступенью и форсажем.
//   ЗАЛП — свой сухой и близкий, чужой глуше и с задержкой по расстоянию.
//   ПОПАДАНИЕ ПО СЕБЕ — отдельный, низкий: игрок обязан понять, что его бьют,
//     не глядя на полосу корпуса.
//   ВЗРЫВ — раскат с хвостом, слышен на всю арену.
//   КОЛЕСО/РЕЖИМ — короткий щелчок и гудение перекладки мощности.
// Панорама и громкость считаются от камеры: залп за спиной слышно сзади.
// Экспорт: window.DNS
// ════════════════════════════════════════════════════════════════════
window.DNS = (function () {
'use strict';

const S = { ctx:null, master:null, eng:null, on:true, vol:0.55,
            live:0, lastShot:0, lastHit:0 };

// ⚠️ ОГРАНИЧИТЕЛЬ ГОЛОСОВ. Каждый звук здесь — это несколько НОВЫХ узлов
// WebAudio (источник, фильтры, громкость, панорама). В бою четырнадцати бортов
// выстрелов бывает под сотню в секунду, и на каждый строился свой граф — счёт
// шёл на тысячи узлов, а это уже заметная просадка кадра. Правило простое:
// одновременно живёт не больше MAX_VOICES звуков, и на каждый тип есть
// минимальный интервал — ухо всё равно не различает два выстрела через 20 мс,
// а процессор разницу чувствует.
const MAX_VOICES = 18;
function canPlay(kind, gapMs){
  if (S.live >= MAX_VOICES) return false;
  const now = performance.now();
  const key = kind === 'shot' ? 'lastShot' : 'lastHit';
  if (now - S[key] < gapMs) return false;
  S[key] = now;
  return true;
}
function holdVoice(node, sec){
  S.live++;
  setTimeout(()=>{ S.live = Math.max(0, S.live-1); }, sec*1000 + 40);
}

// ⚠️ КОНТЕКСТ ПОДНИМАЕТСЯ ТОЛЬКО ПО ДЕЙСТВИЮ ИГРОКА. Браузер глушит звук,
// созданный до первого клика, и «звука нет» — это чаще всего именно оно.
function boot(){
  if (S.ctx) { if (S.ctx.state==='suspended') S.ctx.resume(); return true; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  S.ctx = new AC();
  S.master = S.ctx.createGain();
  S.master.gain.value = S.on ? S.vol : 0;
  S.master.connect(S.ctx.destination);
  buildEngine();
  return true;
}

function mute(on){ S.on = !on; if (S.master) S.master.gain.value = S.on ? S.vol : 0; }
function toggle(){ mute(S.on); return S.on; }

// ── Шумовой буфер: основа выстрелов и взрывов ────────────────
let NOISE = null;
function noiseBuf(){
  if (NOISE) return NOISE;
  const n = S.ctx.sampleRate * 2;
  NOISE = S.ctx.createBuffer(1, n, S.ctx.sampleRate);
  const d = NOISE.getChannelData(0);
  for (let i=0;i<n;i++) d[i] = Math.random()*2-1;
  return NOISE;
}

// Общая обвязка: источник → фильтр → громкость с огибающей → панорама → выход.
function voice(dur, pan, gain){
  const g = S.ctx.createGain();
  const p = S.ctx.createStereoPanner ? S.ctx.createStereoPanner() : null;
  if (p){ p.pan.value = Math.max(-1, Math.min(1, pan||0)); g.connect(p); p.connect(S.master); }
  else g.connect(S.master);
  g.gain.value = 0;
  return g;
}

// ── Гул машин: держится всё время боя, дышит по ступени хода ──
function buildEngine(){
  // ⚠️ НИ ТОНА, НИ ПРИБОЯ. Через три захода стало понятно, что именно портит звук:
  //   • синус/пила в петле — это гудок, ухо цепляется за высоту;
  //   • медленный LFO на громкости — это накат волн, «шум моря», а не машина.
  // Двигатель узнаётся по ДВУМ вещам: резонансу корпуса (узкая подчёркнутая
  // полоса в низах — «рокот») и частой мелкой пульсации (работа агрегата).
  // Поэтому здесь: шум → пиковый фильтр на 110 Гц (резонанс, Q≈2.5) → лёгкая
  // амплитудная пульсация 11 Гц, и отдельно тихая струя в средних частотах.
  const src = S.ctx.createBufferSource();
  src.buffer = noiseBuf(); src.loop = true;

  const lp = S.ctx.createBiquadFilter();
  lp.type='lowpass'; lp.frequency.value = 340; lp.Q.value = 0.4;
  const res = S.ctx.createBiquadFilter();
  res.type='peaking'; res.frequency.value = 110; res.Q.value = 2.5; res.gain.value = 9;
  const hp = S.ctx.createBiquadFilter();
  hp.type='highpass'; hp.frequency.value = 60; hp.Q.value = 0.4;
  const rumble = S.ctx.createGain(); rumble.gain.value = 0.85;

  const air = S.ctx.createBufferSource();
  air.buffer = noiseBuf(); air.loop = true;
  const bp = S.ctx.createBiquadFilter();
  bp.type='bandpass'; bp.frequency.value = 620; bp.Q.value = 0.8;
  const ag = S.ctx.createGain(); ag.gain.value = 0;

  const g = S.ctx.createGain(); g.gain.value = 0;

  // пульс агрегата: частый и очень слабый — слышен как «работает», а не как волна
  const puls = S.ctx.createOscillator(); puls.type='sawtooth'; puls.frequency.value = 11;
  const pg = S.ctx.createGain(); pg.gain.value = 0.05;
  puls.connect(pg); pg.connect(g.gain);

  src.connect(lp); lp.connect(res); res.connect(hp); hp.connect(rumble); rumble.connect(g);
  air.connect(bp); bp.connect(ag); ag.connect(g);
  g.connect(S.master);
  src.start(); air.start(); puls.start();
  S.eng = { g:g, lp:lp, bp:bp, res:res, puls:puls, air:ag };
}

// Вызывается каждый кадр: thr — доля хода (−0.45…1), boost — форсаж/двигатели.
function engine(thr, boost){
  if (!S.eng) return;
  const t = Math.abs(thr||0);
  const now = S.ctx.currentTime;
  S.eng.g.gain.setTargetAtTime(0.08 + t*0.13 + (boost?0.05:0), now, 0.4);
  S.eng.lp.frequency.setTargetAtTime(300 + t*280, now, 0.5);
  S.eng.res.frequency.setTargetAtTime(104 + t*26, now, 0.5);      // рокот чуть выше на ходу
  S.eng.puls.frequency.setTargetAtTime(9 + t*7 + (boost?3:0), now, 0.4);  // агрегат частит
  S.eng.bp.frequency.setTargetAtTime(560 + t*300 + (boost?200:0), now, 0.5);
  S.eng.air.gain.setTargetAtTime(0.04 + t*0.12 + (boost?0.06:0), now, 0.45);
}

// ── Разовые звуки ────────────────────────────────────────────
// dist — расстояние до камеры (тише и глуше вдали), pan — −1…1
function shot(mine, dist, pan){
  if (!S.ctx) return;
  const near = Math.max(0, 1 - (dist||0)/1600);
  if (near<=0.02) return;
  // свой залп важнее чужого: ему даём проходить чаще
  if (!canPlay('shot', mine ? 45 : 110)) return;
  holdVoice(null, 0.25);
  const t0 = S.ctx.currentTime;
  // ⚠️ ЗАЛП ДОЛЖЕН ПРОБИВАТЬСЯ ЧЕРЕЗ ГУЛ. Прежний выстрел был одним коротким
  // шипом на 0.16 громкости — ровно в той же области, где работает шум машин,
  // поэтому «орудий не слышно». Теперь у него ДВЕ составляющие, как у настоящего
  // выстрела: резкий верхний щелчок (его слышно поверх любого фона) и низкий
  // удар с быстрым спадом, который даёт вес. Плюс общая громкость выше вдвое.
  const src = S.ctx.createBufferSource(); src.buffer = noiseBuf();
  src.playbackRate.value = mine ? 2.2 : 1.5;
  const bp = S.ctx.createBiquadFilter();
  bp.type='bandpass'; bp.frequency.value = mine ? 1800 : 1200; bp.Q.value = 0.7;
  const g = voice(0.22, pan, 0);
  src.connect(bp); bp.connect(g);
  const v = (mine?0.38:0.20)*near;
  g.gain.setValueAtTime(v, t0);
  g.gain.exponentialRampToValueAtTime(0.0008, t0+0.18);
  src.start(t0); src.stop(t0+0.22);

  // низ: короткий удар, падающий по частоте — «вес» калибра
  const o = S.ctx.createOscillator(); o.type='sine';
  o.frequency.setValueAtTime(mine?190:150, t0);
  o.frequency.exponentialRampToValueAtTime(mine?58:48, t0+0.14);
  const og = voice(0.16, pan, 0); o.connect(og);
  og.gain.setValueAtTime((mine?0.30:0.16)*near, t0);
  og.gain.exponentialRampToValueAtTime(0.001, t0+0.16);
  o.start(t0); o.stop(t0+0.18);
}

function hit(onMe, dist, pan){
  if (!S.ctx) return;
  const near = Math.max(0, 1 - (dist||0)/1800);
  if (near<=0.02) return;
  if (!onMe && !canPlay('hit', 90)) return;      // попадание ПО СЕБЕ звучит всегда
  holdVoice(null, 0.4);
  const t0=S.ctx.currentTime;
  const src=S.ctx.createBufferSource(); src.buffer=noiseBuf();
  src.playbackRate.value = onMe ? 0.55 : 1.2;
  const lp=S.ctx.createBiquadFilter();
  lp.type='lowpass'; lp.frequency.value = onMe? 320 : 1400;
  const g=voice(0.3, pan, 0);
  src.connect(lp); lp.connect(g);
  const v=(onMe?0.34:0.09)*near;
  g.gain.setValueAtTime(v,t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0+(onMe?0.34:0.18));
  src.start(t0); src.stop(t0+0.4);
  if (onMe){                                   // по своему корпусу ещё и звон
    const o=S.ctx.createOscillator(); o.type='triangle'; o.frequency.setValueAtTime(150,t0);
    o.frequency.exponentialRampToValueAtTime(70,t0+0.3);
    const og=voice(0.3,pan,0); o.connect(og);
    og.gain.setValueAtTime(0.12,t0); og.gain.exponentialRampToValueAtTime(0.001,t0+0.3);
    o.start(t0); o.stop(t0+0.32);
  }
}

function boom(dist, pan){
  if (!S.ctx) return;
  const near = Math.max(0.06, 1 - (dist||0)/3600);
  const t0=S.ctx.currentTime;
  const src=S.ctx.createBufferSource(); src.buffer=noiseBuf();
  src.playbackRate.value=0.6;
  const lp=S.ctx.createBiquadFilter(); lp.type='lowpass';
  lp.frequency.setValueAtTime(900,t0); lp.frequency.exponentialRampToValueAtTime(90,t0+1.1);
  const g=voice(1.2,pan,0);
  src.connect(lp); lp.connect(g);
  g.gain.setValueAtTime(0.5*near,t0);
  g.gain.exponentialRampToValueAtTime(0.001,t0+1.2);
  src.start(t0); src.stop(t0+1.3);
}

// Щелчок интерфейса и гудение перекладки мощности.
function click(){
  if (!S.ctx) return;
  const t0=S.ctx.currentTime, o=S.ctx.createOscillator();
  o.type='square'; o.frequency.value=880;
  const g=voice(0.05,0,0); o.connect(g);
  g.gain.setValueAtTime(0.05,t0); g.gain.exponentialRampToValueAtTime(0.001,t0+0.05);
  o.start(t0); o.stop(t0+0.06);
}
function power(){
  if (!S.ctx) return;
  const t0=S.ctx.currentTime, o=S.ctx.createOscillator();
  o.type='sawtooth'; o.frequency.setValueAtTime(120,t0);
  o.frequency.exponentialRampToValueAtTime(420,t0+0.35);
  const lp=S.ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=1200;
  const g=voice(0.4,0,0); o.connect(lp); lp.connect(g);
  g.gain.setValueAtTime(0.10,t0); g.gain.exponentialRampToValueAtTime(0.001,t0+0.4);
  o.start(t0); o.stop(t0+0.42);
}
// Сирена: корпус ниже четверти. Заводится один раз на вход в состояние.
function alarm(){
  if (!S.ctx) return;
  const t0=S.ctx.currentTime;
  for (let i=0;i<2;i++){
    const o=S.ctx.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(660,t0+i*0.34);
    o.frequency.exponentialRampToValueAtTime(430,t0+i*0.34+0.28);
    const g=voice(0.3,0,0); o.connect(g);
    g.gain.setValueAtTime(0.001,t0+i*0.34);
    g.gain.exponentialRampToValueAtTime(0.13,t0+i*0.34+0.05);
    g.gain.exponentialRampToValueAtTime(0.001,t0+i*0.34+0.3);
    o.start(t0+i*0.34); o.stop(t0+i*0.34+0.32);
  }
}

return { boot:boot, mute:mute, toggle:toggle, engine:engine,
         shot:shot, hit:hit, boom:boom, click:click, power:power, alarm:alarm,
         get ready(){ return !!S.ctx; }, state:S };
})();
