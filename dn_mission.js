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
  BR.hp = Math.round(BR.hp*BRANDT_HULL);
  BR.shield = Math.round(BR.shield*BRANDT_FIELD);
  return BR;
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
  shieldT: 170,                  // сколько союзники ломают планетарные щиты
  waveGap: 27,                   // пауза между подкреплениями Коалиции
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
// ⚠️ СТАНЦИЯ — НЕ КОРАБЛЬ БЕЗ ДВИГАТЕЛЯ. Соблазн был велик: взять дредноут,
// обнулить ему ход и назвать станцией. Так нельзя — игрок читает силуэт раньше
// подписи, и «космопорт», у которого нос и корма, ломает сцену. Здесь свой
// узел: причальное кольцо, ферма, узел управления. Башен у него нет вовсе:
// космопорт защищает ГАРНИЗОН, в этом и смысл первой задачи.
function stationMesh(){
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color:0x9aabb6, metalness:0.55, roughness:0.55 });
  const dark = new THREE.MeshStandardMaterial({ color:0x3a4854, metalness:0.5,  roughness:0.75 });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(26,26,86,10), hull); g.add(core);
  const hub  = new THREE.Mesh(new THREE.SphereGeometry(34,14,10), dark); g.add(hub);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(84,8,8,28), hull);
  ring.rotation.x = Math.PI/2; g.add(ring);
  for (let i=0;i<4;i++){                       // спицы к кольцу
    const a = i*Math.PI/2;
    const sp = new THREE.Mesh(new THREE.BoxGeometry(78,7,7), dark);
    sp.position.set(Math.cos(a)*42, 0, Math.sin(a)*42);
    sp.rotation.y = -a; g.add(sp);
  }
  [-1,1].forEach(sy=>{                          // причальные фермы сверху и снизу
    const t = new THREE.Mesh(new THREE.BoxGeometry(12,34,12), dark);
    t.position.y = sy*58; g.add(t);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(30,30,5,8), hull);
    pad.position.y = sy*76; g.add(pad);
  });
  // огни: станция должна ЖИТЬ, пока её не разобрали
  for (let i=0;i<10;i++){
    const a = i/10*Math.PI*2;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map:A.glowTex(), color: i%3?0xffd08a:0x7fe3f5,
      transparent:true, opacity:0.75, depthWrite:false, blending:THREE.AdditiveBlending }));
    s.position.set(Math.cos(a)*84, 0, Math.sin(a)*84); s.scale.set(22,22,1);
    g.add(s);
  }
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
    len:180, hp:hp, shield:Math.round(hp*0.25), spd:0, acc:0, yaw:0, lift:0, en:100,
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
    hold:0, shield:1, allies:[], garrison:[], station:null,
    capNode:null, evacNode:null, note:'', noteT:0, q:[], cur:null,
  };

  // космопорт: примерно четырнадцать секунд сосредоточенного огня
  const stn = makeStatic(stationSpec(Math.round(DPS*14)), stationMesh(), false);
  stn.pos.set(CFG.station[0], CFG.station[1], CFG.station[2]);
  stn.node.position.copy(stn.pos);
  M.station = stn;

  // ⚠️ ГАРНИЗОН СПИТ. Это и есть «застать врасплох»: борта стоят на дежурстве
  // без хода, с холодными орудиями, и просыпаются ТОЛЬКО от первого попадания
  // (или сами через минуту). Дать им ИИ сразу — значит отменить весь смысл
  // подхода под маскировкой.
  const GAR = [['vereten','Дозорный «Кэйдзи»',[980,80,-360]],
               ['vereten','Дозорный «Онда»',  [900,-90, 420]],
               ['strizh', 'Катер «Хибари»',   [560, 40, 520]],
               ['strizh', 'Катер «Судзумэ»',  [640,120,-480]]];
  GAR.forEach(([k,n,p])=>{
    const u = A.makeShip(DNK.preset(k), false, n);
    place(u, p, CFG.start);
    u.ai = null; u.dormant = true; u.step = 0; u.thr = 0;
    M.garrison.push(u);
  });

  note('ГАРНИЗОН НЕ ПОДНЯТ ПО ТРЕВОГЕ', 5);
  talk('me',  'Посты Коалиции за кормой. Сигнатура ноль — нас здесь нет.');
  talk('me',  'Дальномер: четыре борта на дежурных орбитах, порт на стыковке. Машины у них холодные.');
  talk('cmd', 'Азуми — единственная, кто нас не ждёт. Второй раз так близко не подойти.');
  talk('me',  'Значит, работаем с одного захода. Орудия к бою.');
  A.say('«Брандтаухер» на орбите. Бейте первым.');
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
  me:  { n:'МОСТИК',   c:'120,225,245' },
  ally:{ n:'«СТРИЖ»',  c:'125,255,192' },
  foe: { n:'ПЕРЕХВАТ', c:'255,90,130' },
  cmd: { n:'ШТАБ',     c:'255,196,90' },
};
function talk(who, text, sec){
  if (!M) return;
  M.q.push({ w:who, t:text, d: sec || (2.4 + text.length*0.042) });
}
function stepTalk(dt){
  if (M.cur){
    M.cur.age += dt;
    if (M.cur.age >= M.cur.d) M.cur = null;
  }
  // ⚠️ ОЧЕРЕДЬ, А НЕ ПЕРЕБИВАНИЕ. Реплики приходят пачками (смена задачи +
  // тревога + потеря борта в одну секунду), и без очереди игрок увидит только
  // последнюю — то есть ничего.
  if (!M.cur && M.q.length) M.cur = Object.assign({ age:0 }, M.q.shift());
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
  'С третьего поста идёт дежурное звено. Курс на порт.',
  'Ещё группа с постов. Он там один, зажимайте.',
  'Тяжёлые на подходе. Не выпускать за орбиту.',
  'Всё, что снялось с постов, — к Азуми. Он не уйдёт.',
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
function wave(n, tag){
  if (S.ships.filter(o=>!o.mine && o.alive).length >= FOE_CAP) return 0;
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
        note('ТРЕВОГА НА ОРБИТЕ — ГАРНИЗОН ПОДНЯТ', 4);
        talk('foe', 'Порт, у нас неопознанный борт на внутренней орбите! Тревога по гарнизону!');
        talk('me',  'Увидели. Тем лучше — прятаться больше незачем.');
        if (window.DNS) DNS.alarm();
      }
    }
    if (alive(M.garrison).length===0 && !M.station.alive){
      M.st='capture'; M.hold=0;
      M.capNode = marker(V(CFG.station[0],CFG.station[1],CFG.station[2]), 0x5adcf0, CFG.capR);
      note('ТОЧКА СВОБОДНА — ЗАКРЕПИТЬСЯ', 4);
      talk('me',  'Гарнизона нет. Порт горит.');
      talk('cmd', 'Держите орбиту. Без вас эсминцам туда не войти.');
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
      note('ТОЧКА ВЗЯТА · ЭСМИНЦЫ СОЮЗА НА ПОДХОДЕ', 5);
      talk('ally','«Брандтаухер», это «Стриж». Звено в секторе, встаём на огневую.');
      talk('ally','Щит держат с четырёх узлов. Работы минуты на три.');
      talk('me',  'Три минуты у вас есть. Всё, что придёт с постов, — наше.');
      A.say('Союзные эсминцы вошли в сектор и открыли огонь по щитам Азуми.');
    }
  },

  // ЗАДАЧА 3 — прикрыть союзников. Щит гаснет по часам, но ТОЛЬКО пока живы
  // те, кто по нему бьёт: выбьют эсминцы — миссия сорвана, и это единственный
  // способ провалить её, не потеряв свой борт.
  hold(dt){
    const live = alive(M.allies);
    if (live.length === 0){
      fail('Союзные эсминцы выбиты — щиты Азуми целы, удар сорван.');
      return;
    }
    M.shield = Math.max(0, M.shield - dt/CFG.shieldT * (0.55 + 0.45*live.length/M.allies.length));
    // лучи по щиту: по одному в полсекунды от случайного живого эсминца
    M.beamT = (M.beamT||0) - dt;
    if (M.beamT <= 0){ M.beamT = 0.45; shieldBeam(live[(Math.random()*live.length)|0].pos); }

    M.waveT -= dt;
    if (M.waveT <= 0){
      M.waveT = CFG.waveGap; wave(M.waves++); note('ПОДКРЕПЛЕНИЯ КОАЛИЦИИ', 3);
      talk('foe', WAVE_SAY[Math.min(M.waves-1, WAVE_SAY.length-1)]);
    }
    // на середине работы эсминцы отчитываются: игрок должен понимать, что часы
    // идут не впустую, иначе третий этап читается как бесконечный
    if (!M.halfSaid && M.shield < 0.5){
      M.halfSaid = true;
      talk('ally','Щит просел наполовину. Мы видим узлы. Ещё немного.');
    }

    if (M.shield <= 0){
      M.st = 'evac';
      M.planet.shMat.uniforms.uK.value = 0;
      M.evacNode = marker(V(CFG.evac[0],CFG.evac[1],CFG.evac[2]), 0x7dffc0, CFG.evacR);
      M.waveT = 6;
      note('ЩИТЫ АЗУМИ ПАЛИ · УХОДИТЕ К ТОЧКЕ ЭВАКУАЦИИ', 7);
      talk('ally','Щит снят! Азуми открыта, десант пошёл!');
      talk('cmd', '«Брандтаухер», отходите. Немедленно.');
      talk('me',  'У меня здесь три борта под огнём.');
      talk('cmd', 'Эсминцы мы построим. Вас — нет. Это приказ.');
      talk('me',  '…Принято. Курс на точку эвакуации.');
      talk('ally','Идите. Мы подержим их, сколько выйдет.');
      A.say('Щиты сняты. Коалиция ведёт к Азуми всё, что у неё есть, — этот бой не вытянуть.');
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
      win('«Брандтаухер» ушёл с орбиты Азуми. Щиты планеты сняты, гарнизон и космопорт уничтожены — ' +
          'дальше дело союзного десанта. Из звена «Стриж» на связь не вышел никто.');
    }
  },
};

function alive(list){ return list.filter(u=>u.alive); }

function step(dt){
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
  if (s === M.station){ note('КОСМОПОРТ УНИЧТОЖЕН', 3); talk('me','Космопорт разобран. Стыковочные фермы горят.'); }
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
  strike:  ()=>['СНЯТЬ ГАРНИЗОН И КОСМОПОРТ',
                (alive(M.garrison).length + (M.station.alive?1:0)) + ' цел. осталось',
                1 - (alive(M.garrison).length + (M.station.alive?1:0))/(M.garrison.length+1)],
  capture: ()=>['ЗАКРЕПИТЬСЯ НА ТОЧКЕ',
                S.me.pos.distanceTo(V(CFG.station[0],CFG.station[1],CFG.station[2])) < CFG.capR
                  ? 'удержание ' + Math.ceil(CFG.capHold-M.hold) + ' с'
                  : 'вернитесь в кольцо',
                M.hold/CFG.capHold],
  hold:    ()=>['ПРИКРЫТЬ ЭСМИНЦЫ · ЩИТЫ АЗУМИ',
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
// Текст проявляется по буквам — так его успевают прочесть, а не смахнуть глазом.
function hudTalk(x, W, H){
  const c = M.cur; if (!c) return;
  const V0 = VOICE[c.w] || VOICE.me;
  const px = 24, py = Math.max(96, H*0.16);
  const wide = Math.min(430, W*0.42);
  // на телефоне эфир уезжает выше: там низ и правый край заняты пальцами
  x.textAlign='left'; x.textBaseline='middle';
  x.font='11px "Courier New", monospace';
  x.fillStyle='rgba('+V0.c+',0.95)';
  x.fillText(V0.n, px, py);
  // сколько букв уже «пришло»
  const shown = Math.min(c.t.length, Math.floor(c.age*46));
  const fade = clamp((c.d - c.age)/0.6, 0, 1);          // последние полсекунды гаснет
  x.font='12px "Courier New", monospace';
  x.fillStyle='rgba(214,236,246,'+(0.92*fade).toFixed(2)+')';
  let line='', ln=0;
  const words = c.t.slice(0, shown).split(' ');
  words.forEach(w=>{
    const probe = line ? line+' '+w : w;
    if (x.measureText(probe).width > wide){ x.fillText(line, px, py+16+ln*15); ln++; line=w; }
    else line = probe;
  });
  if (line) x.fillText(line, px, py+16+ln*15);
  // тонкая черта слева — граница «служебного» поля, чтобы текст не висел в пустоте
  x.fillStyle='rgba('+V0.c+',0.35)';
  x.fillRect(px-8, py-8, 1.5, 26+ln*15);
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

  // громкая строка на несколько секунд: смена задачи, тревога, потеря борта
  if (M.noteT > 0){
    const k = clamp(M.noteT/1.2, 0, 1);
    x.font='16px "Courier New", monospace';
    x.fillStyle='rgba(255,196,90,'+(0.35+0.6*k).toFixed(2)+')';
    x.fillText(M.note, cx, H*0.28);
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
