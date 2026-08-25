// ════════════════════════════════════════════════════════════════════
// АРЕНА «ДРЕДНОУТ» — стенд прямого управления бортом (одиночный, против ботов)
// ────────────────────────────────────────────────────────────────────
// Зачем отдельный файл, а не режим боевой доски: доска — ПОШАГОВАЯ и серверная
// (гексы, ход = 6 секунд, всё решает БД). Здесь реальное время, физика на
// клиенте, БД не участвует вовсе. Общее у них ровно то же, что и у верфи с
// ареной: ГЕОМЕТРИЯ КОРАБЛЯ. Борта собирает тот же bgBuildShip из battle_gl.js.
//
// ⚠️ УПРАВЛЕНИЕ КАПИТАНСКОЕ, А НЕ САМОЛЁТНОЕ. Первый заход вёл нос за мышью —
// и это НЕ жанр: борт вёл себя как истребитель, а мышь делала два дела разом.
// Разведено намертво:
//   КЛАВИШИ — корабль: W/S ступени хода, A/D руль, Space/Shift всплытие-погружение.
//   МЫШЬ    — только БАШНИ: перекрестье ходит в секторе обстрела, корпус стоит.
// Отсюда и ощущение массы: борт доворачивает своим темпом, а огонь при этом
// уже идёт туда, куда смотрит наводчик.
//
// ⚠️ МЫШЬ НЕ ИНВЕРТИРОВАНА. Вправо — прицел вправо, вниз — прицел вниз. Знаки
// здесь неочевидны (yaw растёт ВПРАВО по экрану, потому что d(взгляд)/d(yaw)
// совпадает с экранным «право»), поэтому не меняйте их «по аналогии» с pit.
//
// ⚠️ МОЩНОСТЬ РАСПРЕДЕЛЯЕТСЯ КОЛЕСОМ — тем же, что на доске (bbWheelSegs:
// двигатели / орудия / щит). Держишь E, ведёшь мышью, отпускаешь — режим встал.
//
// Масштаб мира: корпус лофтится в ЕДИНИЧНУЮ длину и масштабируется по классу,
// поэтому дистанции здесь — в тех же единицах, что и длина борта.
// Экспорт: window.DN
// ════════════════════════════════════════════════════════════════════
window.DN = (function () {
'use strict';

// ── §1. Борта берутся из ИГРЫ, а не отсюда ───────────────────
// ⚠️ ЗДЕСЬ БОЛЬШЕ НЕТ НИ ОДНОЙ ТТХ. Раньше в этом месте лежала своя таблица
// пяти корпусов и одной пушки на класс — выдуманная от начала до конца. Пока
// арена была пробой жанра, это было честно; как только она стала частью игры,
// это стало враньём: в игре корабль — ПРОЕКТ (корпус класса, броня, орудия из
// оружейной верфи, модули), и каждая его цифра уже посчитана.
// Всё, что раньше было тут, теперь собирает dn_kit.js (window.DNK) из тех же
// источников, что и верфь. Здесь остались только правила БОЯ.
//
// spec — то, что вернул DNK.build/DNK.preset. Поля намеренно названы так же,
// как звались поля старой таблицы (len/hp/shield/spd/acc/yaw/lift/en/gun), —
// чтобы физика и камера, которым ТТХ безразличны, не знали о подмене вовсе.
function SHIPS(){ return window.DNK ? DNK.PRESET_ORDER : []; }
function specOf(key){ return window.DNK ? DNK.preset(key) : null; }
const DEF_SHIP = 'vereten';

// ⚠️ ЭТО НЕ ТАНК. Потолок в 0.55 рад (31°) — сухопутная цифра: у гаубицы он
// такой, потому что ей мешает погон и корпус. В пустоте мешать нечему, а цель
// приходит С ЛЮБОГО НАПРАВЛЕНИЯ, в том числе сверху. С танковым потолком борт
// не мог поднять стволы на противника над собой — и это читалось как «оружие
// не работает»: перекрестье на цели, а башни молчат. 1.35 рад — это 77° вверх
// и вниз, то есть всё, кроме отвесного зенита над самой башней.
const TUR_PIT = 1.35;          // сколько башня берёт вверх-вниз
// ⚠️ ПОРОГ НАВОДКИ ЩЕДРЫЙ, А БАШНИ БЫСТРЫЕ. С допуском 0.05 рад башня «почти
// наведена» большую часть времени и молчит: игрок жмёт огонь — и секунду ничего
// не происходит. Это и читалось как «стрельба реализована хреново». Рассеивание
// всё равно больше этого допуска, так что точность от него не страдает.
const TUR_LOCK = 0.16;         // довернулась и может стрелять (рад)

// ── §1г. СЛОЖНОСТЬ БОТОВ ─────────────────────────────────────
// ⚠️ БОТ ОБЯЗАН ПРОМАХИВАТЬСЯ. Он считает упреждение точно и не устаёт водить
// стволами — «честный» расчёт на деле читерский, игрок так вести цель не может.
// Ослабление идёт не уроном (иначе бой превращается в жевание щита), а
// ТОЧНОСТЬЮ и РЕАКЦИЕЙ: err — разброс в корпусах цели, sway — как быстро
// ошибка гуляет, react — пауза на прицеливание после смены цели, lead — какую
// долю упреждения он берёт верно, dmg — множитель урона, kit — охота жать
// ремонт и щит.
const DIFF = {
  easy:   { name:'Новобранцы', err:1.7, sway:1.5, react:1.6, lead:0.55, dmg:0.70, kit:0.35 },
  normal: { name:'Ровный бой', err:1.0, sway:1.0, react:1.0, lead:0.75, dmg:0.85, kit:0.65 },
  hard:   { name:'Ветераны',   err:0.5, sway:0.6, react:0.5, lead:0.92, dmg:1.00, kit:1.00 },
};

// Ступени хода — как на мостике: назад / стоп / малый / полный. Плавный
// «аналоговый» газ на тяжёлом борте не читается: игрок не понимает, на каком он
// ходу. Ступень видно в HUD и слышно по дюзам.
const THR_STEPS = [-0.45, 0, 0.5, 1];

// ── §1в. КОЛЕСО МОЩНОСТИ ─────────────────────────────────────
// Те же три статьи, что и в пошаговом бою (bbWheelSegs), но здесь режим —
// ⚠️ ВРЕМЕННОЕ УСИЛЕНИЕ, КОТОРОЕ ЖРЁТ ЭНЕРГИЮ КОРАБЛЯ. Раньше он стоял «включил
// и забыл»: щит навсегда, двигатели навсегда — выбор без цены, то есть не выбор.
// Теперь у борта есть запас энергии: пока режим держится, он утекает; кончился —
// режим сам падает в «Ровный ход», и запас копится обратно только вне режима.
// Отсюда ритм боя: разогнаться на двигателях к цели, переключиться на орудия для
// залпа, поймать чужой залп на щит — и всё это в пределах одного бака.
const POWER = {
  eng: { name:'Двигатели', ico:'⚙', drain:9,  tip:'Ход и ускорение +45%. Разорвать дистанцию, догнать, уйти.' },
  wpn: { name:'Орудия',    ico:'⚔', drain:11, tip:'Урон +30%, перезарядка −20%, башни доворачивают быстрее.' },
  shd: { name:'Щит',       ico:'🛡', drain:14, tip:'Входящий урон −30%, поле восстанавливается втрое.' },
  off: { name:'Ровный ход',ico:'○', drain:0,  tip:'Мощность никуда не отведена — энергия копится обратно.' },
};
const POWER_KEYS = ['eng','wpn','shd','off'];
const POWER_SWAP = 1.4;                 // перекидывать мощность мгновенно нельзя

// Снаряжение борта живёт в его проекте (DNK: acts), а не здесь: сколько
// модулей поставлено на палубу — столько кнопок, до шести. См. §7б.

const DN = {
  ready:false, cv:null, renderer:null, scene:null, cam:null, raf:0,
  last:0, running:false, over:null, fire1:false,
  me:null, ships:[], shots:[], fx:[], rocks:[], dust:null,
  keys:new Set(), aim:{yaw:0,pit:0}, locked:false, shake:0,
  wheel:{ open:false, ax:0, ay:0 }, zoom:false, zoomK:0,
  spawn:null,                     // экран возвращения в строй {t, cls, spot}
  hud:null, hx:null, feed:[], score:{kills:0,deaths:0},
  arena:3400, waves:false, sens:1, diff:'normal', rein:{mine:0,foe:0},
  // ⚠️ РЕЖИМ. Свободный бой («обучение») и сюжетная миссия ходят одним и тем же
  // движком: разница только в том, кто расставляет борта и кто решает, чем бой
  // кончился. Пока DN.mission пуст — работает старый счёт подкреплений; как
  // только миссия взята, всё это отдаётся ей (dn_mission.js, window.DNM).
  mission:null,
  touch:false,                    // управление с пальца (dn_touch.js)
  tRud:0, tVert:0,                // аналоговый руль и вертикаль со стика
};

const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const rnd=(a,b)=>a+Math.random()*(b-a);
const V=(x,y,z)=>new THREE.Vector3(x||0,y||0,z||0);

// Временные векторы заводятся в mount(), а НЕ в теле файла: three.js приезжает
// ESM-модулем (он отложен), и любой `new THREE.*` при разборе роняет весь стенд.
let t1, t2, t3, tq, tm;
function tmpInit(){
  t1=new THREE.Vector3(); t2=new THREE.Vector3(); t3=new THREE.Vector3();
  tq=new THREE.Quaternion(); tm=new THREE.Matrix4();
}

// ── §2. Сцена ────────────────────────────────────────────────
function mount(canvas){
  if (typeof THREE === 'undefined') return false;
  DN.cv = canvas;
  tmpInit();
  DN.renderer = new THREE.WebGLRenderer({ canvas:canvas, antialias:true });
  DN.renderer.setClearColor(0x04070c, 1);
  DN.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio||1));
  DN.scene = new THREE.Scene();
  DN.cam = new THREE.PerspectiveCamera(62, 1, 0.5, 14000);
  // Свет — зеркало арены и верфи (bgBuildLights/bgPvMount): металл должен быть
  // того же тона, иначе «корабли выглядят по-другому» вернётся с третьей стороны.
  const key = new THREE.DirectionalLight(0xfff0d8, 2.1);
  key.position.set(-0.55,0.68,-0.48).multiplyScalar(1000);
  DN.scene.add(key);
  DN.scene.add(new THREE.HemisphereLight(0x4a6ea8, 0x0a0f18, 0.85));
  buildSky(); buildRocks(); buildDust();
  bindInput();
  window.addEventListener('resize', resize);
  DN.ready = true;
  resize();
  return true;
}

function buildSky(){
  const N=900, p=new Float32Array(N*3), c=new Float32Array(N*3);
  for (let i=0;i<N;i++){
    const v=V(rnd(-1,1),rnd(-1,1),rnd(-1,1)).normalize().multiplyScalar(9000);
    p[i*3]=v.x; p[i*3+1]=v.y; p[i*3+2]=v.z;
    const k=rnd(0.12,0.5); c[i*3]=k*rnd(0.7,1); c[i*3+1]=k*rnd(0.8,1); c[i*3+2]=k;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p,3));
  g.setAttribute('color', new THREE.BufferAttribute(c,3));
  // ⚠️ ЗВЁЗД МАЛО И ОНИ ТУСКЛЫЕ. Плотное яркое небо рябит: глаз читает его как
  // шум поверх боя, а не как фон. Небо здесь — подложка, работает пыль (stepDust).
  DN.stars = new THREE.Points(g, new THREE.PointsMaterial({ size:16, vertexColors:true, sizeAttenuation:true, transparent:true, opacity:0.55, depthWrite:false }));
  DN.scene.add(DN.stars);
  const neb = new THREE.Sprite(new THREE.SpriteMaterial({ map:glowTex(), color:0x4a3aa0, transparent:true, opacity:0.45, depthWrite:false, blending:THREE.AdditiveBlending }));
  neb.position.set(-3000,600,-4200); neb.scale.set(6000,4200,1);
  DN.scene.add(neb);
}

// ⚠️ ПЫЛЬ — ЭТО НЕ УКРАШЕНИЕ, А ПРИБОР СКОРОСТИ. Звёзды на девяти тысячах
// единиц неподвижны при любом ходе, обломки редки — без ближней взвеси борт
// «стоит» даже на полном. Точки живут в кубе вокруг камеры и заворачиваются на
// противоположную грань, поэтому их всегда ровно столько, сколько нужно.
const DUST_N = 900, DUST_BOX = 900;
function buildDust(){
  const p=new Float32Array(DUST_N*3);
  for (let i=0;i<DUST_N*3;i++) p[i]=rnd(-DUST_BOX,DUST_BOX);
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p,3));
  DN.dust = new THREE.Points(g, new THREE.PointsMaterial({ color:0x93b6cc, size:2.6, sizeAttenuation:true, transparent:true, opacity:0.55, depthWrite:false }));
  DN.dust.frustumCulled = false;
  DN.scene.add(DN.dust);
}
function stepDust(){
  const c=DN.cam.position, a=DN.dust.geometry.attributes.position, arr=a.array;
  for (let i=0;i<DUST_N;i++){
    const o=[c.x,c.y,c.z];
    for (let k=0;k<3;k++){
      const j=i*3+k, d=arr[j]-o[k];
      if (d> DUST_BOX) arr[j]-=DUST_BOX*2;
      else if (d<-DUST_BOX) arr[j]+=DUST_BOX*2;
    }
  }
  a.needsUpdate = true;
}

// ⚠️ АСТЕРОИДЫ ВОКСЕЛЬНЫЕ И РАЗРУШАЕМЫЕ (dn_voxel.js). Цельные икосаэдры были
// декорацией: огонь шёл сквозь них, укрыться было негде, и бой сводился к
// открытой сфере. Решётка кубиков даёт укрытие, которое ВЫГРЫЗАЕТСЯ залпами и
// разваливается на куски, когда камень перебит пополам.
function buildRocks(){
  for (let i=0;i<46;i++){
    const r = rnd(34,120);
    const p = V(rnd(-1,1),rnd(-0.35,0.35),rnd(-1,1)).normalize().multiplyScalar(rnd(400, DN.arena*0.85));
    DN.rocks.push(VOX.make(DN.scene, p, r, i*7+3));
  }
}

// Шаг астероидов: вращение, разлёт осколков и отложенное дробление. Связность
// считаем НЕ каждый кадр, а только у задетых камней — обход по решётке дешёвый,
// но делать его сотню раз за кадр незачем.
function stepRocks(dt){
  for (let i=DN.rocks.length-1;i>=0;i--){
    const o=DN.rocks[i];
    if (o.dead){ DN.rocks.splice(i,1); continue; }
    VOX.step(o, dt);
    if (o.dirty){
      const parts = VOX.split(o, DN.scene);
      if (parts){ DN.rocks.splice(i,1); parts.forEach(np=>DN.rocks.push(np)); }
    }
  }
}

function resize(){
  if (!DN.renderer) return;
  const cv=DN.cv, w=cv.clientWidth||1, h=cv.clientHeight||1;
  DN.renderer.setSize(w,h,false);
  DN.cam.aspect=w/h; DN.cam.updateProjectionMatrix();
  if (DN.hud){ const pr=Math.min(2,window.devicePixelRatio||1); DN.hud.width=w*pr; DN.hud.height=h*pr; DN.hx.setTransform(pr,0,0,pr,0,0); }
}

// ── §3. Борт ─────────────────────────────────────────────────
// ⚠️ ЗАПЕКАНИЕ КОРПУСА. bgBuildShip собирает борт из четырёх-шести десятков
// отдельных мешей: ярусы рубки, мачта, шпангоуты, пилоны, гондолы. На доске
// такой борт один-два, и это ничего не стоит; здесь их четырнадцать, и каждый
// меш — отдельный вызов отрисовки. Замер показал 309 вызовов при жалких 80 тыс.
// треугольников: кадр упирался не в видеокарту, а в перебор объектов на CPU —
// отсюда «фпс падает, когда кораблей больше трёх».
//
// Лечится слиянием: всё, что НЕ ДВИЖЕТСЯ относительно корпуса, сливается в один
// меш на материал. Не трогаем только то, что живёт своей жизнью: дюзы (они
// пульсируют масштабом) и башни (они вращаются) — их добавляем уже после.
function bakeShip(grp, skipRoots){
  const keep = new Set();
  if (skipRoots) skipRoots.forEach(r=>{ r.traverse(n=>keep.add(n)); });
  const jets = grp.userData.jets || grp.userData.nz;
  if (jets && jets.forEach) jets.forEach(j=>{
    j.userData.jet = true;                    // метка для клона: это подвижная деталь
    let n=j; while (n && n!==grp){ keep.add(n); n=n.parent; }
  });

  const groups = new Map();          // материал → список геометрий в системе борта
  const drop = [];
  grp.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(grp.matrixWorld).invert();
  grp.traverse(o=>{
    if (!o.isMesh || keep.has(o) || !o.geometry) return;
    const key = o.material;
    if (!groups.has(key)) groups.set(key, []);
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    groups.get(key).push(g);
    drop.push(o);
  });
  if (drop.length < 4) return grp;    // сливать нечего

  drop.forEach(o=>{ if (o.parent) o.parent.remove(o); });
  groups.forEach((list, mat)=>{
    let n=0;
    list.forEach(g=>{ n += g.attributes.position.count; });
    const pos = new Float32Array(n*3), nor = new Float32Array(n*3), uv = new Float32Array(n*2);
    let po=0, uo=0;
    list.forEach(g=>{
      const p=g.attributes.position, nr=g.attributes.normal, u=g.attributes.uv;
      pos.set(p.array, po);
      if (nr) nor.set(nr.array, po);
      if (u) uv.set(u.array, uo);
      po += p.array.length; uo += (u? u.array.length : p.count*2);
      g.dispose();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor,3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv,2));
    geo.computeBoundingSphere();
    grp.add(new THREE.Mesh(geo, mat));
  });
  return grp;
}


// ⚠️ МОДЕЛЬ СОБИРАЕТСЯ ОДИН РАЗ НА КЛАСС И СТОРОНУ, дальше только клонируется.
// Каждый борт прежде строился с нуля: лофт корпуса, надстройка, башни, слияние —
// четырнадцать раз подряд на старте боя, и столько же комплектов геометрии в
// памяти. Клон Object3D делит геометрию и материалы с образцом, а собственными
// у него остаются только матрицы — ровно то, что и должно быть своим у каждого
// корабля. Башни при этом остаются подвижными: у клона свои узлы поворота.
const PROTO = {};
function shipProto(spec, mine){
  const key = spec.key + (mine?'|m':'|f');
  if (PROTO[key]) return PROTO[key];
  const grp = (typeof bgBuildShip==='function') ? bgBuildShip(spec.cls, mine?'mine':'foe', null) : new THREE.Group();
  const turs = buildTurretNodes(grp, spec, mine);
  // сливаем ВСЮ статику корпуса вместе с барбетами башен, не трогая поворотные узлы
  bakeShip(grp, turs.map(t=>t.yawG));
  grp.scale.setScalar(spec.len);
  PROTO[key] = grp;
  return grp;
}

// ⚠️ БОРТ ЗАВОДИТСЯ ПО КЛЮЧУ ПРОЕКТА, А НЕ ПО КЛАССУ. Класс — это только
// корпус; два эсминца с разной бронёй и разными орудиями — разные корабли, и
// арена обязана это различать, иначе весь смысл верфи пропадает.
function makeShip(key, mine, name){
  const C = (key && key.mounts) ? key : specOf(key) || specOf(DEF_SHIP);
  const cls = C.cls;
  const grp = shipProto(C, mine).clone(true);
  DN.scene.add(grp);
  const s = {
    cls:cls, key:C.key, C:C, mine:mine, name:name, node:grp,
    pos:V(), vel:V(), q:new THREE.Quaternion(), roll:0,
    hp:C.hp, hpMax:C.hp, sh:C.shield, shMax:C.shield, shT:0,
    pw:'off', pwT:0, en:C.en, enMax:C.en,       // режим мощности и запас под него
    step:1, thr:0, alive:true, gunT:0,
    // Снаряжение борта: у каждой активации свой откат и своё «горит сейчас».
    // Ключей ровно столько, сколько модулей поставлено на палубу проекта.
    ab:{}, abOn:{},
    amp:0, siege:false, cloak:0, hot:0, pdUp:0, slow:0,
    ai:null, dead:0,
  };
  C.acts.forEach(a=>{ s.ab[a.k]=0; s.abOn[a.k]=0; });
  // связываем состояние башен с узлами КЛОНА (в образце они общие на всех)
  s.tur = [];
  grp.traverse(o=>{
    if (!o.userData || o.userData.turIdx == null) return;
    const m = C.mounts[o.userData.turIdx];
    if (!m) return;
    s.tur.push({ m:m, w:m.w, node:o.parent, yawG:o, pitG:o.children.find(c=>c.userData && c.userData.pit) || o,
                 yaw:m.home, pit:0, cd:0, r:o.userData.r, mag:m.w?m.w.mag:1, rel:0,
                 bz:o.userData.bz || [0], bl:o.userData.bl || o.userData.r*3.2, bi:0 });
  });
  s.tur.sort((a,b)=>a.m.x - b.m.x);
  // дюзы у клона свои — собираем их заново для пульсации
  const jets = [];
  grp.traverse(o=>{ if (o.userData && o.userData.jet) jets.push(o); });
  grp.userData.jets = jets;
  DN.ships.push(s);
  return s;
}

function shipDir(s, out){ return (out||V()).set(1,0,0).applyQuaternion(s.q); }
function shipUp(s, out){ return (out||V()).set(0,1,0).applyQuaternion(s.q); }
function shipRight(s, out){ return (out||V()).set(0,0,1).applyQuaternion(s.q); }
function radius(s){ return s.C.len*0.55; }
// Множители режима мощности — по одной функции на статью, чтобы не искать их
// по всему файлу, когда цифры поедут.
function pwOn(s, k){ return s.pw===k && s.en>0; }
function pwEng(s){ return pwOn(s,'eng') ? 1.45 : 1; }
function pwDmg(s){ return pwOn(s,'wpn') ? 1.30 : 1; }
function pwRof(s){ return pwOn(s,'wpn') ? 0.80 : 1; }
function pwTake(s){ return pwOn(s,'shd') ? 0.70 : 1; }
function pwRegen(s){ return pwOn(s,'shd') ? 3.0 : 1; }

// Расход и накопление. Энергия копится ТОЛЬКО вне режима — иначе усиление
// становится бесплатным и колесо снова превращается в тумблер «сделай хорошо».
function stepPower(s, dt){
  if (s.pwT>0) s.pwT -= dt;
  const d = (POWER[s.pw]||POWER.off).drain;
  if (d>0){
    s.en -= d*dt;
    if (s.en<=0){
      s.en=0; s.pw='off'; s.pwT=0;
      if (s===DN.me) say('Энергия кончилась — мощность сброшена');
    }
  } else {
    s.en = Math.min(s.enMax, s.en + s.C.enRegen*dt);
  }
}
// ⚠️ ПРИЦЕЛ ЖИВЁТ В МИРОВЫХ УГЛАХ, А НЕ В СИСТЕМЕ КОРПУСА. Пока он считался
// относительно корабля, ЛЮБОЙ доворот рулём тащил за собой и перекрестье, и
// камеру: вести цель было невозможно — корабль поворачивает, прицел уезжает
// вместе с ним. Теперь корпус вращается ПОД неподвижной наводкой: навёл на цель
// — она там и останется, что бы ни делал руль. Башни всё равно считают свои
// углы от корпуса (см. stepGuns), так что сектора работают как работали.
// Взгляд не ограничен ничем по кругу: смотреть можно хоть на собственную корму.
const AIM_PIT = 1.0;
function aimDir(s, ay, ap){
  const pit = clamp(ap, -AIM_PIT, AIM_PIT);
  return V(Math.cos(pit)*Math.cos(ay), Math.sin(pit), Math.cos(pit)*Math.sin(ay));
}




// ⚠️ НА КАРТЕ ПОКАЗЫВАЕМ НАПРАВЛЕНИЯ ОГНЯ, А НЕ ЗОНУ ЦЕЛИКОМ. Полный сектор
// дальности — это диск в полкилометра: при камере от третьего лица он лежит
// почти в плоскости взгляда и вырождается в полосу через весь экран, что бы с
// ним ни делали (проверено трижды: заливкой, контуром, волной).
// Игровое решение проще и читается мгновенно: у каждого ствола свой УЗКИЙ ЛУЧ,
// идущий от борта ровно туда, КУДА ЭТОТ СТВОЛ СЕЙЧАС СМОТРИТ. Лучи поворачиваются
// вместе с башнями — видно и куда борт способен бить, и как стволы догоняют
// прицел. Длина луча — доля дальности, поэтому «докуда достаю» тоже читается,
// а полкарты при этом не закрашено.
//   заряжена       — луч цвета своей стороны;
//   перезаряжается — янтарный и вдвое тусклее;
//   упёрлась в край сектора — луч короче и гаснет: дальше борт не даёт.
// Лежит горизонтально в мире и НЕ кренится вместе с корпусом.
const ZONE_VERT = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;
// ⚠️ ЭТОТ ШЕЙДЕР ЖРЁТ НЕ МАТЕМАТИКОЙ, А ПЛОЩАДЬЮ. Лучи секторов накрывают
// половину экрана и лежат ДРУГ НА ДРУГЕ (их девять у дредноута), то есть каждый
// пиксель кадра прогоняется через них по нескольку раз. Отсюда и просадка,
// которая появлялась ровно при прицеливании: до зума лучи спрятаны.
// Что здесь сделано:
//   • УБРАН discard. На прозрачной аддитивной поверхности он не экономит
//     ничего (ноль и так ничего не прибавляет), зато отключает у видеокарты
//     ранний отсев по глубине и загоняет весь проход в медленную ветку.
//   • ЧЕТЫРЕ smoothstep СВЁРНУТЫ В ДВА УМНОЖЕНИЯ. Мягкость на краях глазом
//     неотличима, а на каждый пиксель приходилось четыре кубических интерполяции.
const ZONE_FRAG = `
  precision mediump float;
  varying vec2 vUv;
  uniform vec3 uCol;
  uniform float uAlpha;
  void main(){
    float r = vUv.y;                       // 0 у борта, 1 на конце луча
    float a = abs(vUv.x - 0.5) * 2.0;      // 0 по оси луча, 1 у его кромки
    float side = 1.0 - a*a;                // мягкие бока, парабола вместо smoothstep
    float tail = 1.0 - r*r;                // гаснет к концу луча
    float body = side * tail;
    float core = max(0.0, 1.0 - a*4.0) * tail * 0.5;
    gl_FragColor = vec4(uCol, (body*0.28 + core) * uAlpha);
  }
`;

const ZONE_BEAM = 0.30;          // длина луча — доля дальности орудий
const ZONE_WIDE = 0.16;          // полураствор луча, рад

// ⚠️ ЛУЧИ СЕКТОРОВ ЕСТЬ ТОЛЬКО У ИГРОКА. Раньше их заводил КАЖДЫЙ борт в
// makeShip: семь кораблей по девять клиньев — это шесть десятков мешей со
// своей геометрией и своим материалом, висящих в сцене невидимыми навсегда.
// Показывались они всё равно одному игроку (stepZone зовётся только для DN.me).
// ⚠️ ГЕОМЕТРИЯ ОДНА НА ВСЕ ЛУЧИ. Клин строится в ЕДИНИЧНОМ радиусе и растягивается
// масштабом меша: RingGeometry на каждый ствол — это девять одинаковых буферов.
let ZONE_GEO = null;
function zoneGeo(){
  // Внутренний радиус НЕ у самого борта: камера при прицеливании сидит почти
  // вплотную к корме, и ближняя часть клина закрашивала весь экран — самая
  // дорогая половина заливки уходила туда, где рисунок всё равно не читается.
  if (!ZONE_GEO) ZONE_GEO = new THREE.RingGeometry(0.16, 1, 16, 1, -ZONE_WIDE, ZONE_WIDE*2);
  return ZONE_GEO;
}
function buildZone(s){
  if (s.zone) return;
  const grp = new THREE.Group();
  const base = s.mine ? 0x5adcf0 : 0xff3c82;
  s.C.mounts.forEach(()=>{
    // симметричный клин: направление задаётся поворотом меша, а не геометрией
    const mat = new THREE.ShaderMaterial({
      vertexShader: ZONE_VERT, fragmentShader: ZONE_FRAG,
      uniforms: { uCol:{value:new THREE.Color(base)}, uAlpha:{value:0} },
      transparent:true, depthWrite:false, side:THREE.DoubleSide,
      blending:THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(zoneGeo(), mat);
    mesh.rotation.order = 'YXZ';
    mesh.renderOrder = 2;
    grp.add(mesh);
  });
  grp.visible = false;
  DN.scene.add(grp);                       // в сцену, а не в группу корабля
  s.zone = grp;
  s.zoneR = (s.C.gun ? s.C.gun.rng : 600) * ZONE_BEAM;
}

function stepZone(s){
  if (!s.zone) return;
  const want = (s===DN.me && s.alive && !DN.spawn) ? DN.zoomK : 0;
  if (want <= 0.02){ if (s.zone.visible) s.zone.visible = false; return; }
  s.zone.visible = true;
  const f = shipDir(s, t1);
  s.zone.position.copy(s.pos);
  s.zone.rotation.set(0, -Math.atan2(f.z, f.x), 0);   // по курсу, без крена
  const list = s.C.mounts;
  // куда смотрит прицел — в системе корпуса: по нему видно, какие стволы
  // physically не могут довернуться и потому стоят на упоре
  // ⚠️ БЕЗ КЛОНОВ В КАДРЕ: два объекта на борт, а не два на каждый кадр.
  const inv = (s._qinv || (s._qinv = new THREE.Quaternion())).copy(s.q).invert();
  const look = (s._look || (s._look = V())).copy(DN.cam.getWorldDirection(t3)).applyQuaternion(inv);
  const aimA = Math.atan2(look.z, look.x);
  s.zone.children.forEach((mesh,i)=>{
    const T = s.tur && s.tur.find(t=>t.m === list[i]);
    const reloading = T && (T.rel>0 || T.mag<=0);
    // ⚠️ НЕПОДВИЖНЫЙ ЛУЧ — ЭТО НЕ ПОЛОМКА, А УПОР. Башня, чей сектор не
    // накрывает точку прицела, честно стоит на краю и не крутится: со стороны
    // это читалось как «одна ось ездит, остальные висят». Поэтому такой луч
    // ЯВНО помечен — он короче и заметно бледнее, то есть «эта не участвует,
    // доворачивай борт», а не «оно сломалось».
    const jam = !reloading && Math.abs(angDiff(aimA, list[i].home)) > list[i].arc/2;
    mesh.rotation.set(-Math.PI/2, 0, 0);
    mesh.rotateZ(-(T ? T.yaw : list[i].home));
    mesh.scale.setScalar(s.zoneR * (jam ? 0.55 : 1));
    mesh.material.uniforms.uAlpha.value = want * (reloading ? 0.45 : (jam ? 0.3 : 1));
    mesh.material.uniforms.uCol.value.setHex(reloading ? 0xffc45a : (s.mine?0x5adcf0:0xff3c82));
  });
}

// ── §4. Ввод ─────────────────────────────────────────────────
function bindInput(){
  const cv=DN.cv;
  addEventListener('keydown', e=>{
    if (e.repeat) return;
    DN.keys.add(e.code);
    if (!DN.running) return;
    const s=DN.me;
    if (!DN.spawn && s){
      if (e.code==='KeyW') s.step = Math.min(THR_STEPS.length-1, s.step+1);
      if (e.code==='KeyS') s.step = Math.max(0, s.step-1);
      // 1…6 — активации проекта по порядку, как они стоят на палубе
      const di = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6'].indexOf(e.code);
      if (di>=0 && s.C.acts[di]) useAbil(s, s.C.acts[di].k);
      if (e.code==='KeyM' && window.DNS){ say(DNS.toggle()?'Звук включён':'Звук выключен'); }
      // счётчик кадров: разговор о производительности должен идти в числах.
      // ⚠️ Именно G, а не F: F занята точкой входа на экране возвращения в строй.
      if (e.code==='KeyG') DN.fps = DN.fps ? null : { n:0, t:performance.now(), v:0 };
    if (e.code==='KeyE'){ DN.wheel.open=true; DN.wheel.ax=0; DN.wheel.ay=0; if (window.DNS) DNS.click(); }
    }
    if (['KeyW','KeyS','KeyA','KeyD','Space','ShiftLeft','ShiftRight','KeyE','KeyG','Enter'].indexOf(e.code)>=0) e.preventDefault();
  });
  addEventListener('keyup', e=>{
    DN.keys.delete(e.code);
    if (e.code==='KeyE' && DN.wheel.open){ wheelPick(); DN.wheel.open=false; }
  });
  cv.addEventListener('mousedown', e=>{
    if (DN.touch) return;           // на телефоне мышиные события синтетические
    if (window.DNS) DNS.boot();     // WebAudio заводится только по действию игрока
    if (!DN.locked){ if (cv.requestPointerLock) cv.requestPointerLock(); return; }
    if (e.button===0){
      DN.fire1=true;
      // ⚠️ ПЕРВЫЙ ЗАЛП УХОДИТ В ТОТ ЖЕ КАДР. Без этого между нажатием и
      // выстрелом стоял случайный кусок перезарядки — до полусекунды тишины на
      // ровном месте, и оружие ощущалось неисправным.
      const me=DN.me;
      if (me && me.alive && me.tur) me.tur.forEach(T=>{ if (T.cd < 0.09 && T.rel<=0) T.cd = 0; });
    }
    if (e.button===2) DN.zoom=true;      // ПКМ — прицеливание, а не оружие
  });
  addEventListener('mouseup', e=>{
    if (e.button===0) DN.fire1=false;
    if (e.button===2) DN.zoom=false;
  });
  cv.addEventListener('contextmenu', e=>e.preventDefault());
  document.addEventListener('pointerlockchange', ()=>{
    DN.locked = (document.pointerLockElement===cv);
    if (!DN.locked) DN.fire1=false;
  });
  addEventListener('mousemove', e=>{
    if (!DN.locked) return;
    if (DN.wheel.open){ DN.wheel.ax+=e.movementX; DN.wheel.ay+=e.movementY; return; }
    // Мышь ведёт БАШНИ, а не руль. Знаки ПРЯМЫЕ: вправо — вправо, вниз — вниз.
    const k = 0.0022*DN.sens*(DN.zoom?0.42:1);
    DN.aim.yaw += e.movementX*k;
    DN.aim.pit -= e.movementY*k;
    if (DN.aim.yaw> Math.PI) DN.aim.yaw-=Math.PI*2;      // взгляд ходит по кругу
    if (DN.aim.yaw<-Math.PI) DN.aim.yaw+=Math.PI*2;
    DN.aim.pit = clamp(DN.aim.pit, -AIM_PIT, AIM_PIT);
  });
}

// ── §5. Колесо мощности ──────────────────────────────────────
function wheelSeg(){
  const w=DN.wheel;
  if (Math.hypot(w.ax,w.ay) < 40) return -1;          // центр = отмена
  let a = Math.atan2(w.ay, w.ax) + Math.PI/2;          // 0 = вверх
  if (a<0) a+=Math.PI*2;
  return Math.floor(a/(Math.PI*2/POWER_KEYS.length)) % POWER_KEYS.length;
}
function wheelPick(){
  const i=wheelSeg(); if (i<0) return;
  const s=DN.me, k=POWER_KEYS[i];
  if (!s||!s.alive||s.pwT>0||s.pw===k) return;
  if (k!=='off' && s.en < s.enMax*0.08){ say('Энергии не хватает'); return; }
  s.pw=k; s.pwT=POWER_SWAP;
  if (window.DNS) DNS.power();
  say('Мощность → '+POWER[k].name);
}

// ── §6. Управление кораблём ──────────────────────────────────
// Руль: доворот вокруг СВОЕЙ вертикали, скорость поворота — из класса. Крен
// подмешивается от руля и гаснет сам: борт ложится в вираж, но не кувыркается.
function turn(s, rud, dt, k){
  if (rud){
    tq.setFromAxisAngle(shipUp(s,t3), -rud*s.C.yaw*(k||1)*dt*(s===DN.me?1.25:1));
    s.q.premultiply(tq).normalize();
  }
  // выравнивание крена к «вверх» мира — иначе борт постепенно заваливается
  const fwd = shipDir(s,t1);
  const want = V(0,1,0).projectOnPlane(fwd);
  if (want.lengthSq()>0.02){
    want.normalize();
    const u=shipUp(s,t3), ra=u.angleTo(want);
    if (ra>1e-4){
      tq.setFromAxisAngle(t2.crossVectors(u,want).normalize(), Math.min(ra, 1.2*dt));
      s.q.premultiply(tq).normalize();
    }
  }
  s.roll += (rud*0.42 - s.roll) * Math.min(1, dt*2.2);   // визуальный завал
}

function playerControl(dt){
  const s=DN.me; if (!s||!s.alive) return;
  const K=DN.keys;
  // ⚠️ РУЛЬ И ВЕРТИКАЛЬ — АНАЛОГОВЫЕ, КОГДА ИХ ДАЁТ ПАЛЕЦ. Клавиша знает только
  // «нажата/нет», и на телефоне это давало рыскание: борт мотало от упора к
  // упору. Стик кладёт долю отклонения в DN.tRud/DN.tVert, и они здесь просто
  // побеждают клавиатуру, если палец на стике.
  const rud = DN.tRud || ((K.has('KeyD')?1:0)-(K.has('KeyA')?1:0));
  const vert = DN.tVert || ((K.has('Space')?1:0)-((K.has('ShiftLeft')||K.has('ShiftRight'))?1:0));
  turn(s, rud, dt, 1);
  // машина отзывается заметно быстрее: полсекунды на ступень вместо полутора —
  // «ватность» хода читалась как отсутствие отклика на клавишу
  s.thr += (THR_STEPS[s.step]-s.thr) * Math.min(1, dt*1.1);   // машина набирает ход не сразу
  const boost = pwEng(s)*(s.slow>0?0.45:1);
  s.vel.addScaledVector(shipDir(s,t1), s.thr*s.C.acc*boost*dt);
  // вертикальный ход — подруливающие, а не «нос вверх»: корабль не самолёт
  if (vert) s.vel.addScaledVector(V(0,1,0), vert*s.C.lift*dt);

}

// Захват: ближайший враг у линии прицела — им же подсвечивается рамка в HUD.
function lockTarget(){
  const s=DN.me; if(!s||!s.alive) return null;
  const d = aimDir(s, DN.aim.yaw, DN.aim.pit);
  let best=null, bd=1e9;
  DN.ships.forEach(o=>{
    if (o===s||!o.alive||o.mine===s.mine) return;
    const v=t1.subVectors(o.pos,s.pos), L=v.length();
    if (L>s.C.gun.rng*1.4) return;
    // допуск по углу растёт с расстоянием ровно на габарит цели
    const need = Math.cos(Math.max(0.02, Math.atan2(radius(o)*2.2, L)));
    if (v.normalize().dot(d) > need && L<bd){ bd=L; best=o; }
  });
  return best;
}

// ── §7. Оружие ───────────────────────────────────────────────
// Башня на палубе: тумба + ствол. Живёт ВНУТРИ группы корабля, поэтому ходит и
// кренится вместе с корпусом, а доворачивается своим yaw/pit.
// ⚠️ БАШНЯ — ЧАСТЬ КОРПУСА, А НЕ ТУМБА, ПОСТАВЛЕННАЯ СВЕРХУ. Первый заход давал
// ровно это: серый цилиндр чужого материала, торчащий над палубой, со стволом-
// карандашом, а у бортовых половина висела за обводом. Здесь башня собрана по
// тем же правилам, что и корпус в bgBuildShip:
//   • МАТЕРИАЛ ТОТ ЖЕ (bgHullMat) — тот же металл, тот же тон стороны, иначе
//     деталь читается как чужая деталь, приклеенная к модели;
//   • СИДИТ В ПАЛУБЕ: барбет утоплен, над обводом торчит только маска со
//     стволами, а поперечное место ограничено ПОЛУШИРИНОЙ КОРПУСА в этой точке —
//     башня физически не может свисать за борт;
//   • ФОРМА ПО КАЛИБРУ: у мелких классов один ствол, у крупных спарка, размер
//     идёт от габарита борта, а не константой на всех.
function buildTurretNodes(node, spec, mine){
  const cls = spec.cls, list = spec.mounts;
  const mat = (typeof bgHullMat==='function') ? bgHullMat(mine?'mine':'foe')
            : new THREE.MeshStandardMaterial({ color:0x8fa6b8, metalness:0.65, roughness:0.45 });
  // ⚠️ ВИД БАШНИ — ОТ ОРУДИЯ, А НЕ ОТ КЛАССА КОРПУСА. На палубе стоит то, что
  // игрок собрал в оружейной верфи: число стволов, калибр и размер установки
  // берутся у самой сборки. Зенитный блок обязан выглядеть блоком, а главный
  // калибр — главным калибром, даже если оба стоят на одном борте.
  return list.map((m, idx)=>{
    const W = m.w || spec.gun;
    const big = W ? W.barrels >= 2 : false;
    const K = 0.62 + (W ? Math.min(1.15, W.caliber/380) : 0.4)*0.55;
    const hw = (typeof bgHullHW==='function') ? bgHullHW(cls, m.x, null) : 0.06;
    const dp = (typeof bgHullDepth==='function') ? bgHullDepth(cls, m.x, null) : 0.04;
    // ⚠️ УСТАНОВКА МЕНЬШЕ, ЧЕМ КАЖЕТСЯ ПРАВИЛЬНЫМ. Башня на 0.030 длины корпуса
    // — это дом на палубе: у линкора в 250 метров она выходила под восемь
    // метров в поперечнике вместе с барбетом и зрительно съедала обводы. У
    // настоящего корабля башня — низкая шайба, из которой торчат ДЛИННЫЕ тонкие
    // стволы; «деревянность» силуэта берётся ровно из обратных пропорций.
    const r = Math.min(0.021*K, hw*0.46);

    const g = new THREE.Group();
    const barb = new THREE.Mesh(new THREE.CylinderGeometry(r*1.15, r*1.25, r*0.9, 12), mat);
    barb.position.y = -r*0.15;
    g.add(barb);                                       // барбет статичен — уйдёт в запекание

    const yawG = new THREE.Group(); yawG.position.y = r*0.34; g.add(yawG);
    yawG.userData.turIdx = idx; yawG.userData.r = r;    // по этой метке клон находит башни
    const face = (typeof bgTaper==='function')
      ? new THREE.Mesh(bgTaper(r*2.5, r*1.15, r*1.9, 0.72, 0.78, r*0.28), mat)
      : new THREE.Mesh(new THREE.BoxGeometry(r*2.5, r*1.15, r*1.9), mat);
    face.position.x = r*0.15;
    yawG.add(face);
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(r*1.1, r*0.55, r*0.4), mat);
    cheek.position.set(-r*0.75, r*0.42, 0);
    yawG.add(cheek);

    const pitG = new THREE.Group(); pitG.position.x = r*0.9; pitG.userData.pit = true; yawG.add(pitG);
    // Ствол: длинный и тонкий. Длина берётся у сборки — орудие с длиной ствола
    // 90 калибров обязано выглядеть длинноствольным, иначе вся оружейная верфь
    // на палубе не видна.
    const bLen = (W && W.cfg && +W.cfg.barrelLen) || 70;   // калибров длины ствола
    const BL = r*(3.6 + clamp(bLen, 30, 110)/100*2.2);
    const barrel = (dz)=>{
      const b = new THREE.Mesh(new THREE.CylinderGeometry(r*0.105, r*0.135, BL, 10), mat);
      b.rotation.z = -Math.PI/2; b.position.set(BL*0.5, 0, dz);
      pitG.add(b);
      const brk = new THREE.Mesh(new THREE.CylinderGeometry(r*0.185, r*0.185, r*0.30, 10), mat);
      brk.rotation.z = -Math.PI/2; brk.position.set(BL*0.94, 0, dz);
      pitG.add(brk);
    };
    // ⚠️ СТВОЛОВ РИСУЕТСЯ СТОЛЬКО, СКОЛЬКО ИХ У ОРУДИЯ. Раньше здесь стояло
    // «два или один», и трёхорудийная башня главного калибра, счетверённая
    // зенитка и шестиствольная ротора выглядели одинаково — спаркой. Игрок
    // собирает установку в верфи и обязан узнавать её на палубе.
    const nb = clamp(Math.round(W ? W.barrels||1 : 1), 1, 6);
    const bz = [];
    for (let b=0;b<nb;b++) bz.push(nb===1 ? 0 : (b-(nb-1)/2) * r*(nb>3?0.52:0.62));
    bz.forEach(barrel);
    // клон ищет по этим меткам, откуда бьёт ствол: см. fireFrom
    yawG.userData.bz = bz; yawG.userData.bl = BL;
    // маска и стволы — по одной детали на подвижный узел
    bakeShip(yawG, [pitG]);
    bakeShip(pitG);

    const zLim = Math.max(0, hw - r*1.3);
    g.position.set(m.x, dp*0.86, zLim*m.z);
    node.add(g);
    return { node:g, yawG:yawG, pitG:pitG, r:r };
  });
}

// Скорость доворота башни: у мелкого борта расторопные, у линкора — тяжёлые.
function turRate(s){ return Math.max(1.1, 3.6 - s.C.len/40); }
// Разность углов в (−π, π]
function angDiff(a,b){ let d=(a-b)%(Math.PI*2); if (d>Math.PI) d-=Math.PI*2; if (d<-Math.PI) d+=Math.PI*2; return d; }

// ⚠️ САМОНАВОДКИ НЕТ. Башни ведут ТУ ТОЧКУ, куда смотрит прицел, и бьют строго в
// неё: ни упреждения за игрока, ни подкрутки к цели. Промах — промах. Считает
// корабль сам только ДАЛЬНОМЕР: разнесённые по палубе стволы обязаны сходиться в
// одной точке, иначе бортовая башня физически не может целить туда же, куда носовая.
function stepGuns(s, aimPt, want, dt){
  if (!s.tur) return 0;
  // «Залп» больше не отдельная кнопка: перегрев даёт модуль-усилитель, если он
  // на борту стоит (s.amp), и режим мощности «Орудия».
  const over = (s.amp||0) > 0;
  const n = s.tur.length;
  const rate = turRate(s)*(pwOn(s,'wpn')?1.25:1);
  let onTarget = 0;
  s.tur.forEach(T=>{
    if (T.cd>0) T.cd -= dt;
    // перезарядка идёт сама по себе, наводиться при этом можно
    const W = T.w || s.C.gun;
    if (T.rel>0){
      T.rel -= dt;
      if (T.rel<=0){ T.mag = W.mag; T.rel = 0; if (s===DN.me && window.DNS) DNS.click(); }
    }
    // куда смотреть этой башне — в системе координат КОРПУСА
    const loc = s.node.worldToLocal(aimPt.clone());
    const dx = loc.x - T.node.position.x, dy = loc.y - T.node.position.y, dz = loc.z - T.node.position.z;
    const wantYaw = Math.atan2(dz, dx);
    const wantPit = Math.atan2(dy, Math.hypot(dx,dz));
    const off = angDiff(wantYaw, T.m.home), lim = T.m.arc/2;
    const goal = T.m.home + clamp(off, -lim, lim);
    const gp = clamp(wantPit, -TUR_PIT, TUR_PIT);
    const dyaw = angDiff(goal, T.yaw);
    T.yaw += clamp(dyaw, -rate*dt, rate*dt);
    T.pit += clamp(gp - T.pit, -rate*dt, rate*dt);
    T.yawG.rotation.y = -T.yaw;
    T.pitG.rotation.z = T.pit;
    if (T.rec>0){ T.rec=Math.max(0,T.rec-dt*5); T.pitG.position.x = T.r*0.9 - T.r*0.55*T.rec; }
    // Осадный режим приковывает борт к месту, зато орудия бьют дальше:
    // те же множители, что и на доске (_bt_siege_rng / _bt_siege_dmg).
    const reach = Math.abs(off) <= lim && Math.abs(wantPit) <= TUR_PIT
               && Math.hypot(dx,dy,dz)*s.C.len <= W.rng*(s.siege?1.25:1);
    const aimed = reach && Math.abs(dyaw) < TUR_LOCK && Math.abs(gp-T.pit) < TUR_LOCK;
    if (aimed && T.rel<=0 && T.mag>0) onTarget++;
    if (want && aimed && T.cd<=0 && T.rel<=0 && T.mag>0){
      // ⚠️ ТЕМП БОЛЬШЕ НЕ ДЕЛИТСЯ НА ЧИСЛО БАШЕН. Старая арена держала один
      // «залп борта» на всех и растягивала его по стволам (rof×n/2.6): там
      // орудие было общим. Здесь у каждой башни СВОЯ сборка с верфи и свой
      // паспортный темп — делить его значит врать про орудие.
      T.cd = W.rof * (over?0.6:1) * pwRof(s);
      T.mag--;
      if (T.mag<=0) T.rel = W.rel * pwRof(s);         // «Орудия» ускоряют и заряжание
      fireFrom(s, T, aimPt, over);
    }
  });
  return onTarget;
}

// Выстрел ИЗ КОНКРЕТНОЙ БАШНИ: и точка вылета, и направление берутся у неё.
// ⚠️ СНАРЯД — ЧЕСТНОЕ ТЕЛО В СЦЕНЕ, А НЕ СПРАЙТ С ЭКРАННЫМ ПОВОРОТОМ. Спрайт,
// довёрнутый по проекции вектора, читался как мазок непонятно чего: он всегда
// лицом к камере, а его «длина» живёт в экранных координатах и не связана с
// перспективой — вблизи полоса гигантская, вдаль схлопывается. Здесь обычный
// вытянутый Mesh, развёрнутый вдоль полёта: он ведёт себя как предмет, летящий
// в пространстве, и это сразу читается как выстрел.
//
// ⚠️ НО НИЧЕГО НЕ СОЗДАЁТСЯ НА КАЖДЫЙ ВЫСТРЕЛ. Первый вариант заводил на снаряд
// свой Mesh, свою геометрию И свой материал — материал компилируется в шейдер,
// и залп давал десятки компиляций в секунду (те самые рывки). Геометрия и два
// материала общие, тела берутся из ПУЛА и возвращаются в него при попадании.
let TR_GEO = null;
const TR_MAT = {};
function trGeo(){
  // капсула вдоль +Y: тонкая, со скруглёнными концами — «болт», а не палка
  // ⚠️ КОРОТКИЙ И ТОЛСТЕНЬКИЙ. Длинная капсула читалась как растянутая макаронина
  // через пол-экрана: снаряд должен быть ПРЕДМЕТОМ, а не полосой — длина порядка
  // трети корпуса корвета, не больше.
  if (!TR_GEO) TR_GEO = new THREE.CapsuleGeometry(0.85, 4, 4, 6);
  return TR_GEO;
}
function trMat(mine){
  const k = mine?'m':'f';
  if (!TR_MAT[k]) TR_MAT[k] = new THREE.MeshBasicMaterial({
    color: mine?0x6fd0ea:0xe0567f, transparent:true, opacity:0.8,
    blending:THREE.AdditiveBlending, depthWrite:false });
  return TR_MAT[k];
}
// Голова снаряда — маленький аддитивный сгусток: по нему видно снаряд даже
// когда тот летит прямо от игрока и тело вырождено в точку. ⚠️ Материалы головы
// тоже ОБЩИЕ: создавать SpriteMaterial при каждом взятии из пула — ровно та же
// ошибка, из-за которой стрельба лагала, только этажом ниже.
const HEAD_MAT = {};
function headMat(mine){
  const k = mine?'m':'f';
  if (!HEAD_MAT[k]) HEAD_MAT[k] = new THREE.SpriteMaterial({ map:glowTex(),
    color: mine?0x9fe8ff:0xff8fae, transparent:true, opacity:0.75,
    depthWrite:false, blending:THREE.AdditiveBlending });
  return HEAD_MAT[k];
}
function tracer(p, mine, len){
  const pool = DN.trPool || (DN.trPool = []);
  let n = pool.pop();
  if (!n){
    n = new THREE.Mesh(trGeo(), trMat(mine));
    const head = new THREE.Sprite(headMat(mine));
    head.scale.set(5,5,1);
    n.add(head);
    DN.scene.add(n);
  }
  n.material = trMat(mine);
  if (n.children[0]) n.children[0].material = headMat(mine);
  n.visible = true;
  n.position.copy(p);
  n.scale.set(1, Math.max(1, (len||9)/6), 1);
  return n;
}
function tracerFree(n){
  if (!n) return;
  n.visible = false;
  (DN.trPool || (DN.trPool=[])).push(n);
}
// Разворот тела вдоль полёта: геометрия вытянута по +Y, поэтому берём поворот
// от оси Y к вектору движения. Никакой экранной математики.
function tracerAim(node, p, d, len){
  node.position.copy(p);
  node.quaternion.setFromUnitVectors(V(0,1,0), d);
}

function fireFrom(s, T, aimPt, over){
  const W = T.w || s.C.gun;
  // ⚠️ ВОТ ПОЧЕМУ «СТРЕЛЯЕТ ИЗ ОДНОЙ ТОЧКИ». Срез брался у ОСНОВАНИЯ башни —
  // узла, который не поворачивается ни по горизонту, ни по возвышению. Куда бы
  // ни смотрели стволы, огонь выходил из одной и той же точки палубы, и все
  // стволы установки били из неё же: ни отдачи по стволам, ни очереди «слева
  // направо», ни даже совпадения трассы со стволом. Берём узел ВОЗВЫШЕНИЯ,
  // вылет по длине ствола и смещение конкретного ствола — и стволы отрабатывают
  // по очереди, как на настоящей установке.
  T.bi = ((T.bi||0) + 1) % T.bz.length;
  T.pitG.updateWorldMatrix(true, false);          // матрицы могли отстать на кадр
  const muzzle = T.pitG.localToWorld(V(T.bl*0.98, 0, T.bz[T.bi]));
  const dir = aimPt.clone().sub(muzzle).normalize();
  const sp = W.spread*(over?1.35:1)*(s===DN.me&&DN.zoom?0.45:1);
  dir.x+=rnd(-sp,sp); dir.y+=rnd(-sp,sp); dir.z+=rnd(-sp,sp);
  dir.normalize();
  const rng = W.rng*(s.siege?1.25:1);
  const len = W.kind==='energy' ? 16 : (W.kind==='missile' ? 6 : 9);
  const shot = { p:muzzle, d:dir, v:W.spd, life:rng/W.spd, rng:rng, gone:0, kind:W.kind,
                 heal: W.kind==='repair' ? W.heal : 0,
                 dmg: W.dmg*(over?1.15:1)*(s.siege?2:1)*(1+(s.amp||0))*pwDmg(s)
                      *(s.mine?1:(DIFF[DN.diff]||DIFF.normal).dmg),
                 own:s, mine:s.mine, len:len, node:tracer(muzzle, s.mine, len) };
  tracerAim(shot.node, muzzle, dir, len);
  DN.shots.push(shot);
  muzzleFlash(muzzle, s.mine, W.kind, Math.max(12, W.caliber*0.09));
  T.rec = 1;                                   // отдача: ствол уходит назад и возвращается
  if (s===DN.me) DN.shake = Math.min(0.8, DN.shake+0.05);
  const a = sfxAt(muzzle); if (a) DNS.shot(s===DN.me, a.d, a.pan);
}

// ⚠️ ДАЛЬНОМЕР СЧИТАЕТ ОТ КАМЕРЫ, А НЕ ОТ КОРАБЛЯ. Перекрестье — это центр
// кадра, то есть луч ИЗ КАМЕРЫ; а камера поднята и сдвинута к плечу. Пока точка
// прицеливания строилась из позиции корабля, снаряды уходили в сторону от
// перекрестья ровно на это смещение — «летит хуй знает куда». Считаем ту самую
// точку, которую видит игрок: луч из камеры через центр экрана до первой цели
// (или до предела орудий).
function rangePoint(s, look){
  const o = DN.cam.position;
  const far = s.C.gun.rng + o.distanceTo(s.pos);
  let bd = far;
  DN.ships.forEach(u=>{
    if (u===s||!u.alive||u.mine===s.mine) return;
    const L = t1.subVectors(u.pos,o).dot(look);
    if (L<=0 || L>=bd) return;
    if (t2.copy(o).addScaledVector(look,L).distanceTo(u.pos) < radius(u)*1.25) bd=L;
  });
  // обломок на линии тоже останавливает луч: целиться сквозь камень нельзя
  DN.rocks.forEach(r=>{
    if (r.dead) return;
    const L = t1.subVectors(r.pos,o).dot(look);
    if (L<=0 || L>=bd) return;
    if (t2.copy(o).addScaledVector(look,L).distanceTo(r.pos) < r.r) bd=L;
  });
  return o.clone().addScaledVector(look, bd);
}

// ── §7б. СНАРЯЖЕНИЕ: те же модули, что жмут на доске ─────────
// ⚠️ ТРЁХ ВЫДУМАННЫХ КНОПОК («ремонт / форсаж / залп») БОЛЬШЕ НЕТ. Их не
// существует в игре: там борт нажимает ТО, ЧТО НА НЁМ СТОИТ, — модуль занял
// слот на палубе, стоил денег, энергии и экипажа. Список берётся у проекта
// (DNK: combat.act), кулдаун переведён из ходов в секунды, урон — по SCALE.
// Здесь только ИСПОЛНЕНИЕ; ТТХ активаций сюда не пишутся.
function actOf(s, k){ return (s.C.acts||[]).find(a=>a.k===k); }

function useAbil(s, k){
  if (!s || !s.alive) return;
  const a = actOf(s, k);
  if (!a || s.ab[k]>0) return;
  const tgt = pickFoe(s, a.rng || (s.C.gun?s.C.gun.rng:600));
  switch (a.kind){
    case 'stance':                       // осадная платформа: прикован, но злее
      s.siege = !s.siege;
      if (s.siege){ s.step=1; s.thr=0; }
      s.abOn[k] = s.siege ? 1 : 0;
      s.ab[k] = a.cd*0.5;
      break;
    case 'amp':                          // усиление контура/орудий на время
      s.amp = Math.max(s.amp, a.val || 0.3);
      s.pdUp = a.k==='pdup' ? (a.val||0.3) : s.pdUp;
      s.abOn[k] = a.dur || 8;
      s.ab[k] = a.cd;
      break;
    case 'heal':                         // ремонтные дроны: лечат вас же
      s.hot = Math.max(s.hot, (a.val||0)/6);
      s.abOn[k] = 6; s.ab[k] = a.cd;
      break;
    case 'blink': {                      // прыжок вперёд по курсу
      const d = shipDir(s, t1).clone();
      s.pos.addScaledVector(d, a.rng || s.C.len*8);
      s.node.position.copy(s.pos);
      boom(s.pos.clone().addScaledVector(d,-s.C.len), s.C.len*0.8);
      s.ab[k] = a.cd;
      break; }
    case 'cloak':
      s.cloak = a.dur || 6; s.abOn[k] = s.cloak; s.ab[k] = a.cd;
      break;
    case 'ram':                          // таран: урон тому, кто вплотную
      if (tgt && tgt.pos.distanceTo(s.pos) < (radius(s)+radius(tgt))*1.6){
        damage(tgt, a.dmg, s, 'kinetic'); boom(tgt.pos, tgt.C.len);
      }
      s.ab[k] = a.cd;
      break;
    case 'burst':                        // импульс вокруг цели или носителя
      DN.ships.forEach(u=>{
        if (!u.alive || u.mine===s.mine) return;
        const at = tgt && a.k!=='hell' ? tgt.pos : s.pos;
        if (u.pos.distanceTo(at) > (a.rng || s.C.len*6)) return;
        if (a.dmg) damage(u, a.dmg, s, 'energy');
        if (a.k==='stasis' || a.k==='blind' || a.k==='scramble') u.slow = 4;
      });
      boom((tgt?tgt.pos:s.pos).clone(), s.C.len*1.4);
      s.abOn[k] = 0; s.ab[k] = a.cd;
      break;
    default:                             // strike: ракета/торпеда по цели
      if (!tgt){ if (s===DN.me) say('Нет цели в захвате'); return; }
      launchStrike(s, tgt, a);
      s.ab[k] = a.cd;
  }
  if (s===DN.me) say('Модуль: '+a.name);
}

// Ближайший враг в пределах дальности активации.
function pickFoe(s, rng){
  let best=null, bd=rng||1e9;
  DN.ships.forEach(u=>{ if (u.alive && u.mine!==s.mine && u.cloak<=0){
    const d=u.pos.distanceTo(s.pos); if (d<bd){ bd=d; best=u; } } });
  return best;
}

// ⚠️ РАКЕТА МОДУЛЯ — ВЕДОМАЯ, И ЕЁ СБИВАЮТ. На доске у ракетного канала своё
// правило: он не зависит от дистанции, зато ПРО цели срезает до 60% урона.
// Здесь ровно то же самое — снаряд летит с наведением, а вычет делает damage().
function launchStrike(s, tgt, a){
  const muzzle = s.pos.clone().addScaledVector(shipDir(s,t1), s.C.len*0.6);
  const dir = t2.subVectors(tgt.pos, muzzle).normalize().clone();
  const spd = 620;
  DN.shots.push({ p:muzzle, d:dir, v:spd, life:(a.rng||1200)/spd, rng:a.rng||1200, gone:0,
                  kind:'missile', dmg:a.dmg*(1+(s.amp||0)), seek:tgt, own:s, mine:s.mine,
                  len:7, node:tracer(muzzle, s.mine, 7) });
  const snd = sfxAt(muzzle); if (snd) DNS.shot(s===DN.me, snd.d, snd.pan);
}

// ── §8а. ПОВЕДЕНИЕ БОРТА: ДИСТАНЦИЯ, КУРС, РОЛЬ ──────────────
// ⚠️ ЗДЕСЬ ЖИВЁТ ВСЯ ТАКТИКА. Правило, которое нарушать нельзя: бот НЕ ходит в
// точку, где стоит цель. Он ходит по КРУГУ вокруг неё на своей боевой
// дистанции. Разница огромная и видна с первого взгляда — вместо кучи, которая
// сходится в одну точку и тает, получается карусель, где борта разворачиваются
// бортом, работают всеми башнями и выходят из-под огня.
//
// Роли (s.ai.role) задаются тем, кто борт поставил:
//   'line'  — линейный: держит дистанцию своего калибра, кружит, добивает.
//             Умолчание, в свободном бою других и нет.
//   'hold'  — держит ПОСТ (s.ai.anchor): работает по своей задаче и огрызается,
//             но с места не уходит дальше поводка. Ради него всё и затевалось:
//             эсминцы, обстреливающие планету, не должны бросать позицию и
//             гоняться за корветом через полсектора.
//   'hunt'  — сходится вплотную: абордажная манера лёгких бортов.

// БОЕВАЯ ДИСТАНЦИЯ. Не «половина дальности», а честный компромисс: своя
// дальность против ЧУЖОЙ. Дальнобойный борт держится там, где он достаёт, а
// его не достают; короткоствольный вынужден лезть, и это его беда, а не общее
// правило для всех.
function botKeep(s, t){
  const my = s.C.gun.rng, his = (t.C.gun && t.C.gun.rng) || my;
  const role = s.ai.role || 'line';
  if (role === 'hunt') return Math.max(radius(s)+radius(t)+s.C.len*1.2, my*0.28);
  // Если бьём дальше — стоим на своей кромке, чуть внутри, чтобы не терять цель
  // на рывках. Если он бьёт дальше — сходимся ближе, иначе размен всегда не наш.
  const d = my > his*1.15 ? my*0.82 : Math.min(my*0.60, his*0.55);
  return Math.max(d, radius(s)+radius(t)+s.C.len*2);
}

// КУРС. Складывается из трёх составляющих, и ни одна из них не «лететь в цель»:
//   · РАДИАЛЬНАЯ — подойти или отойти, пока дистанция не та;
//   · ТАНГЕНЦИАЛЬНАЯ — идти вокруг цели, когда дистанция уже та (карусель);
//   · ПОВОДОК ПОСТА — для роли 'hold': возврат к своей точке.
// Направление обхода у каждого борта своё (s.ai.orb) и меняется редко —
// иначе строй толчётся на месте, переобуваясь каждый кадр.
function botCourse(s, t, dist, keep, hurt){
  const to = t1.subVectors(t.pos, s.pos);
  const L = Math.max(1, to.length());
  const rad = to.clone().multiplyScalar(1/L);              // на цель
  // ось обхода — «вверх» мира: борта ходят вокруг цели в плоскости боя, а не
  // штопором через полюса, иначе сцена превращается в клубок
  const tang = t2.crossVectors(V(0,1,0), rad);
  if (tang.lengthSq() < 1e-4) tang.set(0,0,1); else tang.normalize();
  if (s.ai.orb == null) s.ai.orb = Math.random()<0.5 ? -1 : 1;
  s.ai.orbT = (s.ai.orbT||0) - 0.0;                        // смена стороны — в botThink
  tang.multiplyScalar(s.ai.orb);

  // насколько дистанция «не та»: −1 слишком близко … +1 слишком далеко
  const err = clamp((dist - keep)/Math.max(1, keep*0.55), -1, 1);
  // подранок разрывает дистанцию решительнее и заходит по большей дуге
  const push = hurt ? clamp(err - 0.75, -1, 1) : err;
  const dir = rad.clone().multiplyScalar(push)
                 .addScaledVector(tang, 1 - Math.abs(push)*0.55);

  // ПОВОДОК ПОСТА. Борт с задачей не бросает её ради драки: чем дальше он
  // отошёл, тем сильнее его тянет обратно, и на трёх длинах корпуса тяга
  // перебивает всё остальное.
  if (s.ai.role==='hold' && s.ai.anchor){
    const back = t3.subVectors(s.ai.anchor, s.pos);
    const bd = back.length();
    const leash = Math.max(s.C.len*4, keep*0.5);
    if (bd > leash*0.6){
      back.normalize();
      dir.addScaledVector(back, clamp(bd/leash, 0, 2.2));
    }
  }
  if (dir.lengthSq() < 1e-6) dir.copy(rad);
  return dir.normalize().clone();
}

// ── §8. Боты ─────────────────────────────────────────────────
// Мозгов ровно столько, чтобы бой был боем: держать дистанцию своего калибра,
// доворачивать РУЛЁМ (боты летают по тем же правилам, что игрок), стрелять с
// упреждением, уходить и чиниться на малом здоровье, крутить ту же мощность.
function botThink(s, dt){
  const A=s.ai;
  A.t -= dt;
  // ⚠️ ЦЕЛЬ ВЫБИРАЕТСЯ ПО ЦЕНЕ, А НЕ ПО БЛИЗОСТИ. «Ближайший» — это и была та
  // самая пустая логика: борт хватался за первого попавшегося, бросал позицию и
  // ехал за корветом на другой конец сектора, где его и убивали.
  // Считаем ВЕС: дороже всего тот, кто уже в моей дальности, уже подбит и
  // близко; для роли 'hold' вес падает по мере удаления цели ОТ ПОСТА, а не от
  // борта — иначе поводок и выбор цели тянут в разные стороны.
  // Цель меняется ещё и с ленцой (A.t), чтобы борт не дёргался между двумя.
  if (A.t<=0 || !A.tgt || !A.tgt.alive){
    A.t = rnd(1.4,2.6);
    const from = (A.role==='hold' && A.anchor) ? A.anchor : s.pos;
    let best=null, bw=-1e9;
    DN.ships.forEach(o=>{
      if (!o.alive || o.mine===s.mine) return;
      const d = o.pos.distanceTo(from);
      const rng = s.C.gun.rng;
      let w = -d/Math.max(1,rng);                       // ближе к посту — дороже
      if (d < rng) w += 1.4;                            // достаю прямо сейчас
      w += (1 - o.hp/o.hpMax)*0.8;                      // подбитого добиваем
      if (o.fort) w -= 0.5;                             // неподвижная цель подождёт
      if (o===A.tgt) w += 0.35;                         // за свою цель держимся
      if (A.role==='hold' && d > rng*1.6) w -= 2.5;     // за поводок не гоняемся
      if (w>bw){ bw=w; best=o; }
    });
    A.tgt = best;
    // сторону обхода меняем РЕДКО и вместе с целью: иначе борт переобувается
    // каждый кадр и топчется на месте вместо карусели
    if (Math.random()<0.25) A.orb = Math.random()<0.5 ? -1 : 1;
  }
  const t=A.tgt;
  // ⚠️ ЦЕЛИ НЕТ — ЭТО ТОЖЕ ПОВЕДЕНИЕ. Раньше здесь стоял голый return: борт с
  // пустым списком врагов замирал столбом (а у 'hold' это штатное состояние —
  // все чужие выбиты, а работать по своей задаче надо). Возвращаем его на пост.
  if (!t){
    if (A.role==='hold' && A.anchor){
      const back = t1.subVectors(A.anchor, s.pos), bd = back.length();
      if (bd > s.C.len*2.5){
        back.normalize();
        const side = back.dot(shipRight(s,t2)), ahead0 = back.dot(shipDir(s,t3));
        turn(s, ahead0 < 0 ? (side>=0?1:-1) : clamp(side*3,-1,1), dt, 0.9);
        s.thr = 0.5;
        s.vel.addScaledVector(shipDir(s,t2), s.thr*s.C.acc*dt);
      } else s.thr = 0;
    }
    stepGuns(s, s.pos, false, dt);
    return;
  }
  const D = DIFF[DN.diff] || DIFF.normal;
  const dist = t.pos.distanceTo(s.pos);
  const hurt = (s.hp/s.hpMax) < 0.35;
  // ⚠️ БОТ ЖМЁТ ТО, ЧТО У НЕГО СТОИТ. Раньше он звал три общие кнопки, которых
  // теперь нет ни у кого: снаряжение — часть проекта. Логика простая и
  // корабельная: подранок лечится и прыгает, здоровый бьёт ударными и
  // усиливает контур; и всё это не мгновенно, а с задержкой живой руки.
  (s.C.acts||[]).forEach(a=>{
    if (s.ab[a.k]>0) return;
    const want = a.kind==='heal'   ? hurt
               : a.kind==='blink'  ? (hurt && dist < s.C.len*10)
               : a.kind==='cloak'  ? hurt
               : a.kind==='stance' ? (!s.siege && dist > s.C.gun.rng*0.7 && !hurt)
               : a.kind==='ram'    ? dist < radius(s)*2.5
               : dist < (a.rng || s.C.gun.rng);
    if (want && Math.random() < D.kit*dt*1.4) useAbil(s, a.k);
  });
  // из осады надо уметь выйти: прикованный борт добивают
  if (s.siege && (hurt || dist < s.C.gun.rng*0.35)){
    const st=(s.C.acts||[]).find(a=>a.kind==='stance'); if (st && s.ab[st.k]<=0) useAbil(s, st.k);
  }
  if (s.pwT<=0 && Math.random()<D.kit*dt*3){
    const want = s.en < s.enMax*0.15 ? 'off'
               : hurt ? 'shd' : (dist>s.C.gun.rng ? 'eng' : 'wpn');
    if (s.pw!==want && (want==='off' || s.en>s.enMax*0.35)) { s.pw=want; s.pwT=POWER_SWAP; }
  }
  // ── КУДА ИДТИ ────────────────────────────────────────────
  // ⚠️ «ЛЕТЕТЬ В ЦЕЛЬ» — ЭТО НЕ ПОВЕДЕНИЕ. Раньше здесь стояло ровно оно: курс
  // ставился НА ЦЕЛЬ, и бот шёл на неё в лоб, пока не упирался носом или не
  // умирал. Снаружи это и читалось как «боты тупо идут убиваться»: строй
  // сходился в одну точку, все шли грудью, никто не держал дистанцию своего
  // калибра и не разрывал её, когда огонь становился невыгодным.
  // Теперь у борта есть БОЕВАЯ ДИСТАНЦИЯ и он её ДЕРЖИТ, а сближение и разрыв —
  // это два разных манёвра, а не «газ вперёд».
  const keep = botKeep(s, t);
  // упреждение берётся НЕ полностью: доля из сложности
  const lead = t.pos.clone().addScaledVector(t.vel, dist/s.C.gun.spd*D.lead);
  const want = botCourse(s, t, dist, keep, hurt);
  const av = avoidRocks(s, want);                  // курс с учётом камней на пути
  const to = av.dir;
  // ⚠️ РУЛЬ ПО ПРОЕКЦИИ НА БОРТ СЛЕП К ЦЕЛИ ЗА КОРМОЙ: там проекция около нуля,
  // руль выходит нулевым — и бот, вместо разворота, уходит по прямой навсегда
  // (заодно и в первый попавшийся астероид). Если цель позади, кладём руль на
  // упор в ту сторону, куда она смещена, и доворачиваем честные 180°.
  const side = to.dot(shipRight(s,t2));
  const ahead = to.dot(shipDir(s,t3));
  const rud = ahead < 0 ? (side >= 0 ? 1 : -1) : clamp(side*3, -1, 1);
  // разворот «через себя» боту даётся живее обычного руления: иначе полный
  // оборот занимает у линкора четверть минуты и он всё это время просто едет
  turn(s, rud, dt, ahead < 0 ? 1.5 : 0.9);
  s.vel.addScaledVector(V(0,1,0), clamp(to.y*3,-1,1)*s.C.lift*0.7*dt);
  // ХОД. Ступень выбирается по тому, ДЕРЖИТСЯ ли дистанция, а не «вперёд, пока
  // не упрёшься»: за пределами своей дистанции — полный, в её створе — малый
  // (борт идёт лагом, давая стрелять бортовым башням), ближе створа — назад.
  s.thr = av.brake ? 0.15
        : (dist > keep*1.15 ? 1
        : (dist < keep*0.72 ? -0.4 : 0.35));
  if (s.ai.role==='hold' && dist > keep*1.15 && s.ai.anchor
      && s.pos.distanceTo(s.ai.anchor) > s.C.len*3) s.thr = 0.5;   // от поста не убегать
  s.vel.addScaledVector(shipDir(s,t2), s.thr*s.C.acc*pwEng(s)*(s.slow>0?0.45:1)*dt);

  // ОШИБКА НАВОДКИ ГУЛЯЕТ, а не берётся заново каждый кадр: иначе она сходится
  // в среднем к нулю и стрельба снова становится снайперской. Ведём три
  // медленно дрейфующих смещения — это и есть «рука наводчика».
  A.sw = A.sw || V();
  A.swT = (A.swT||0) - dt;
  if (A.swT<=0){
    A.swT = rnd(0.5,1.1)/Math.max(0.2,D.sway);
    A.swTo = V(rnd(-1,1),rnd(-1,1),rnd(-1,1));
  }
  A.sw.lerp(A.swTo||V(), Math.min(1, dt*2.2));
  // масштаб ошибки: корпуса цели, растёт с дистанцией и с её манёвром
  // Насколько мажет: половина ошибки — база класса цели, остальное набегает с
  // дистанцией и с её манёвром. Числа подобраны замером по стоячей цели: на
  // «ровном бою» примерно половина снарядов ложится в корпус.
  const dodge = 1 + t.vel.length()/Math.max(1,t.C.spd)*0.5;
  const err = radius(t)*D.err*dodge*(0.4 + 0.5*dist/s.C.gun.rng);
  const at = lead.clone().addScaledVector(A.sw, err);

  // ПАУЗА НА ПРИЦЕЛИВАНИЕ после смены цели: у игрока есть окно на манёвр
  A.hold = (A.hold||0) - dt;
  if (A.tgtPrev !== t){ A.tgtPrev = t; A.hold = D.react; }
  const mayFire = !hurt && dist < s.C.gun.rng && A.hold <= 0;
  stepGuns(s, at, mayFire, dt);
}


// ⚠️ БОТ ОБЯЗАН ВИДЕТЬ КАМНИ. Без этого он идёт к цели по прямой, втыкается в
// астероид, отскакивает, снова упирается — и половина строя всю схватку трётся
// о породу. Полноценный поиск пути здесь не нужен и вреден (борт тяжёлый, ему
// нужна плавная дуга, а не ломаная): работает СКОЛЬЖЕНИЕ ВДОЛЬ ПРЕПЯТСТВИЯ.
// Смотрим вперёд на тормозной путь, берём ближайший камень на курсе и
// подмешиваем к желаемому направлению боковую составляющую — тем сильнее, чем
// ближе камень и чем точнее он по носу. Обход выходит по касательной, борт при
// этом не бросает цель из виду.
function avoidRocks(s, want){
  const fwd = shipDir(s, t2);
  const look = Math.max(s.C.len*3, s.vel.length()*1.8 + s.C.len*2.5);
  let best=null, bestD=1e9, bestOff=0;
  for (const r of DN.rocks){
    if (r.dead) continue;
    const to = t1.subVectors(r.pos, s.pos);
    const d = to.length();
    if (d > look + r.r) continue;
    const along = to.dot(fwd);
    if (along <= 0) continue;                       // камень за кормой — не мешает
    // насколько он «по носу»: расстояние от центра камня до линии курса
    const off = t3.copy(s.pos).addScaledVector(fwd, along).distanceTo(r.pos);
    const clear = r.r + radius(s)*1.6;              // зазор, который надо держать
    if (off > clear) continue;
    if (d < bestD){ bestD=d; best=r; bestOff=off; }
  }
  if (!best) return { dir:want, brake:false };
  // сторона обхода: та, куда камень НЕ смещён относительно курса
  const side = t1.subVectors(s.pos, best.pos);
  side.addScaledVector(fwd, -side.dot(fwd)).normalize();   // строго поперёк курса
  if (side.lengthSq() < 1e-6) side.copy(shipRight(s,t3));  // камень точно по оси — уходим вбок
  const clear = best.r + radius(s)*1.6;
  const urg = clamp(1 - bestD/(Math.max(1,best.r+radius(s))*3.2), 0, 1);  // близость
  const head = clamp(1 - bestOff/Math.max(1,clear), 0, 1);                // точность по носу
  const w = Math.min(2.2, urg*head*2.6);
  const dir = want.clone().addScaledVector(side, w).normalize();
  // совсем в упор — сбрасываем ход, иначе никакой руль не спасёт
  return { dir:dir, brake: bestD < clear*1.6 && head > 0.75 };
}

// ── §9. Шаг мира ─────────────────────────────────────────────
function stepShip(s, dt){
  if (!s.alive){
    s.dead -= dt;
    // ⚠️ ВОЗРОЖДАЮТСЯ ОБЕ СТОРОНЫ. Раньше условие стояло на `!s.mine`, то есть
    // союзники, погибнув, выбывали навсегда — через минуту игрок оставался один
    // против полного строя врага и, естественно, «не мог победить». Теперь
    // гибель тратит ПОДКРЕПЛЕНИЕ стороны (см. DN.rein), и пока оно есть, борт
    // возвращается со своей базы.
    // ⚠️ В МИССИИ НИКТО НЕ ВОЗВРАЩАЕТСЯ САМ. Кто и когда прилетает — сценарий
    // задания, а не общий счётчик подкреплений: иначе гарнизон, который надо
    // застать врасплох, воскресал бы прямо на глазах.
    if (s.dead<=0 && !DN.over && !DN.mission && takeRein(s.mine)) respawn(s, SPOTS[(Math.random()*SPOTS.length)|0]);
    if (s.dead<=-2 && DN.mission && s.node.parent){ DN.scene.remove(s.node); }
    return;
  }
  for (const k in s.ab){
    if (s.ab[k]>0) s.ab[k]=Math.max(0,s.ab[k]-dt);
    if (s.abOn[k]>0) s.abOn[k]=Math.max(0,s.abOn[k]-dt);
  }
  stepPower(s, dt);
  if (s.gunT>0) s.gunT-=dt;
  // ── состояния, наведённые модулями ──
  // Усиление гаснет вместе со своей активацией; ремонтный поток капает всё
  // время её действия; стазис держит борт несколько секунд после импульса.
  const ampAct = (s.C.acts||[]).find(a=>a.kind==='amp' && s.abOn[a.k]>0);
  s.amp  = ampAct ? (ampAct.val || 0.3) : 0;
  if (!ampAct) s.pdUp = 0;
  const healAct = (s.C.acts||[]).find(a=>a.kind==='heal' && s.abOn[a.k]>0);
  if (healAct) s.hp = Math.min(s.hpMax, s.hp + (s.hot||0)*dt);
  else s.hot = 0;
  if (s.cloak>0) s.cloak = Math.max(0, s.cloak-dt);
  if (s.slow>0)  s.slow  = Math.max(0, s.slow-dt);
  // щит восстанавливается только вне обстрела — иначе перестрелка не кончается
  s.shT -= dt;
  if (s.shT<=0) s.sh = Math.min(s.shMax, s.sh + s.shMax*0.10*pwRegen(s)*dt);
  // среда тормозит: без этого борт разгоняется бесконечно и теряет управление
  // ⚠️ ВЕРТИКАЛЬ ОГРАНИЧИВАЕТСЯ ОТДЕЛЬНО. Общий кламп по длине вектора съедал
  // подъём целиком: на полном ходу бюджет скорости уже выбран маршевым, и
  // Space/Shift переставали работать вовсе — «половина геймплея мёртвая».
  // Осадная платформа приковывает борт к месту — цена дальнего и сильного огня.
  const vmax = s.siege ? 0 : s.C.spd*pwEng(s)*(s.slow>0?0.45:1);
  s.vel.multiplyScalar(Math.max(0, 1-dt*0.55));
  let vy = s.vel.y;
  s.vel.y = 0;
  if (s.vel.length()>vmax) s.vel.setLength(vmax);
  s.vel.y = clamp(vy, -s.C.lift*1.6, s.C.lift*1.6);
  s.pos.addScaledVector(s.vel, dt);
  if (s.pos.length()>DN.arena){
    s.pos.setLength(DN.arena);
    s.vel.addScaledVector(t1.copy(s.pos).normalize(), -s.C.acc*dt*3);
    if (s===DN.me) say('Край сектора');
  }
  DN.rocks.forEach(r=>{
    if (r.dead) return;
    const lim = r.r + radius(s);
    if (s.pos.distanceTo(r.pos) < lim){
      const n = t1.subVectors(s.pos, r.pos).normalize().clone();
      s.pos.copy(r.pos).addScaledVector(n, lim);
      const hit = Math.max(0, -s.vel.dot(n));
      s.vel.reflect(n).multiplyScalar(0.35);
      if (hit>25){ damage(s, hit*1.1, null); if (s===DN.me){ DN.shake=1.4; say('Удар о обломок'); } }
    }
  });
  s.node.position.copy(s.pos);
  s.node.quaternion.copy(s.q);
  if (s.roll) s.node.rotateX(s.roll);          // крен — только в картинке
  const jets = s.node.userData.jets || s.node.userData.nz;
  if (jets && jets.forEach){
    const k = 0.6 + Math.max(0,s.thr)*1.1 + (pwOn(s,'eng')?0.3:0);
    jets.forEach((j,i)=>{ if (j&&j.scale) j.scale.set(1, k*(1+0.12*Math.sin(DN.last*0.004+i)), 1); });
  }
}

// ⚠️ БРОНЯ РАЗБИРАЕТСЯ ПО КАНАЛАМ — так же, как на доске (_bt_fire в
// _nano_repair.sql): у плиты своя стойкость к кинетике, к энергии и к ракетам,
// а ПРО вдобавок срезает ракетный урон и суммируется со стойкостью, но не
// глубже 60%. Раньше здесь был один голый вычет — из-за него весь выбор брони
// и весь смысл трёх технологий орудий не значили ничего.
function damage(s, dmg, from, kind){
  if (!s.alive) return;
  const K = kind || 'kinetic';
  let rk = clamp((s.C.res && s.C.res[K]) != null ? s.C.res[K] : 0, -0.75, 0.9);
  if (K==='missile'){
    const pd = clamp((s.C.pd||0) + (s.pdUp||0), 0, 0.6);
    if (pd>0) rk = 1 - (1-rk)*(1-pd);
  }
  dmg *= (1 - rk);
  dmg *= pwTake(s);
  s.shT = 3.2;
  if (s.sh>0){ const a=Math.min(s.sh,dmg); s.sh-=a; dmg-=a; }
  if (dmg>0) s.hp-=dmg;
  if (s===DN.me){
    DN.shake = Math.min(1.6, DN.shake + dmg/s.hpMax*6);
    // откуда прилетело — в экранных координатах: дуга загорится с той стороны
    if (from && from.pos){
      const v = t1.subVectors(from.pos, DN.cam.position);
      const rt = t2.set(1,0,0).applyQuaternion(DN.cam.quaternion);
      const up = t3.set(0,1,0).applyQuaternion(DN.cam.quaternion);
      const a = Math.atan2(-v.dot(up), v.dot(rt));
      (DN.hits || (DN.hits=[])).push({ a:a, at:performance.now() });
      if (DN.hits.length > 6) DN.hits.shift();
    }
  }
  if (s.hp<=0) kill(s, from);
}

function kill(s, from){
  s.alive=false; s.hp=0; s.dead=4;
  boom(s.pos, s.C.len*1.6);
  s.node.visible=false;
  if (s===DN.me){
    DN.score.deaths++;
    // В миссии экрана «возвращения в строй» нет: борт у игрока штучный, его
    // гибель — провал задания, а не размен. Решает это сама миссия.
    if (DN.mission){ say('ВАШ БОРТ ПОТЕРЯН'); }
    else if (takeRein(true)) { say('ВАШ БОРТ ПОТЕРЯН'); openSpawn(); }
    else say('ВАШ БОРТ ПОТЕРЯН — подкреплений нет');
  }
  else if (from===DN.me){ DN.score.kills++; say('УНИЧТОЖЕН: '+s.name); }
  else say(s.name+' уничтожен');
  if (DN.mission && window.DNM) DNM.onKill(s, from);
}

// ── §9б. ПОДКРЕПЛЕНИЯ СТОРОН ─────────────────────────────────
// Бой держится на запасе бортов, а не на «убей всех сразу»: у каждой стороны
// свой счёт, гибель его тратит, кончился — сторона больше не возвращается, и
// когда её последний борт выбит, бой окончен. Это и даёт цену размену: увести
// подбитый борт к своей базе выгоднее, чем разменять его один к одному.
function takeRein(mine){
  const k = mine ? 'mine' : 'foe';
  if (DN.rein[k] <= 0) return false;
  DN.rein[k]--;
  return true;
}

// ── §10. Возвращение в строй ─────────────────────────────────
// В этом жанре смерть — не «через три секунды снова здесь». Игрок ВЫБИРАЕТ,
// каким бортом выйти и с какого края сектора, пока идёт отсчёт. Отсюда тактика:
// потеряли линкор — возвращаетесь корветом и заходите с фланга.
// ⚠️ У СТОРОН ЕСТЬ СВОИ БАЗЫ. Раньше все борта сыпались случайными точками по
// сфере: игрок мог возродиться в гуще врага, союзники — на другом конце карты,
// и линии боя не возникало вовсе. Теперь база — это ЗОНА у своего края арены:
// свои (игрок и звено) входят только оттуда, противник — со своей, встречное
// движение к середине и даёт бой, а не броуновскую свалку.
// Точка входа выбирается ВНУТРИ своей зоны: фланг, центр, авангард.
const SPOTS = [
  { key:'left',  name:'Левый фланг',  tip:'Заход сбоку, в обход',     off:[ 0.0,  0.06, -0.30] },
  { key:'ctr',   name:'Центр базы',   tip:'Ровно от своей кромки',    off:[ 0.0,  0.00,  0.00] },
  { key:'right', name:'Правый фланг', tip:'Заход сбоку, зеркально',   off:[ 0.0, -0.06,  0.30] },
  { key:'van',   name:'Авангард',     tip:'Ближе к середине — в лоб', off:[ 0.42, 0.00,  0.00] },
];

// Центры баз: противоположные края арены по оси X. Свои — со стороны −X.
function baseOf(mine){ return V(DN.arena*(mine?-0.78:0.78), 0, 0); }

// Метка базы на сцене: кольцо своего цвета плюс свечение. Без неё «своя
// сторона» существует только в коде — игрок не понимает, куда отходить.
// ⚠️ МЕТКИ БАЗ СНИМАЮТСЯ ОТДЕЛЬНОЙ РУКОЙ. Раньше их чистил только buildBases —
// то есть ровно тот, кто их и ставит. В свободном бою это работало, а стоило
// уйти в миссию (баз в ней нет, buildBases никто не зовёт) — кольца прежнего
// боя оставались висеть в сцене НАВСЕГДА. Кольцо радиусом 300, увиденное с
// ребра, — это ровная светящаяся линия через весь кадр: снаружи выглядит как
// «эффект, которому там неоткуда взяться».
function clearBases(){
  if (DN.baseNodes) DN.baseNodes.forEach(n=>DN.scene.remove(n));
  DN.baseNodes = [];
}

function buildBases(){
  clearBases();
  [true,false].forEach(mine=>{
    const c = mine ? 0x5adcf0 : 0xff3c82;
    const g = new THREE.Group();
    // ⚠️ МЕТКА БАЗЫ — ОРИЕНТИР, А НЕ ДЕКОРАЦИЯ НА ПОЛЭКРАНА. Первый вариант с
    // кольцом на 360 единиц и ореолом на 1500 просто заливал кадр цветом: борт
    // выходит внутри зоны и смотрит сквозь неё весь бой.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(300, 2.5, 6, 48),
      new THREE.MeshBasicMaterial({ color:c, transparent:true, opacity:0.22 }));
    ring.rotation.x = Math.PI/2;
    g.add(ring);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map:glowTex(), color:c,
      transparent:true, opacity:0.07, depthWrite:false, blending:THREE.AdditiveBlending }));
    halo.scale.set(650,650,1);
    g.add(halo);
    g.position.copy(baseOf(mine));
    DN.scene.add(g); DN.baseNodes.push(g);
  });
}

function openSpawn(){ DN.spawn = { t:7, cls:DN.me.key ? keyOf(DN.me) : DEF_SHIP, spot:1 }; }
// Ключ проекта борта в списке доступных — по нему экран подсвечивает карточку.
function keyOf(s){ return SHIPS().find(k=>specOf(k)===s.C) || DEF_SHIP; }
function stepSpawn(dt){
  const sp=DN.spawn; if (!sp) return;
  sp.t -= dt;
  const K=DN.keys;
  SHIPS().forEach((c,i)=>{ if (K.has('Digit'+(i+1))) sp.cls=c; });
  if (K.has('KeyQ')) sp.spot=0;
  if (K.has('KeyZ')) sp.spot=1;
  if (K.has('KeyR')) sp.spot=2;
  if (K.has('KeyF')) sp.spot=3;
  if (sp.t<=0 || K.has('Enter')){
    DN.spawn=null;
    swapShip(sp.cls);
    respawn(DN.me, SPOTS[sp.spot]);
  }
}
// Смена борта: старая модель снимается со сцены, новая собирается тем же
// bgBuildShip. Счёт, ввод и камера принадлежат ИГРОКУ, а не корпусу.
function swapShip(key){
  const old=DN.me;
  if (old.key===(specOf(key)||{}).key) return;
  DN.scene.remove(old.node);
  DN.ships.splice(DN.ships.indexOf(old),1);
  DN.me = makeShip(key, true, 'ВЫ');
}

function respawn(s, spot){
  s.hp=s.hpMax; s.sh=s.shMax; s.alive=true; s.node.visible=true;
  // место входа: центр своей базы + смещение выбранной точки + небольшой разброс,
  // чтобы звено не выходило одной кучей в одной координате
  const base = baseOf(s.mine);
  const o = (spot||SPOTS[1]).off;
  const R = DN.arena;
  s.pos.set(base.x + o[0]*R*0.5 + rnd(-40,40),
            base.y + o[1]*R      + rnd(-30,30),
            base.z + o[2]*R*0.5  + rnd(-40,40));
  s.vel.set(0,0,0); s.thr=0; s.step=1; s.roll=0; s.pw='off'; s.pwT=0; s.en=s.enMax;
  if (s.tur) s.tur.forEach(T=>{ T.mag=(T.w||s.C.gun).mag; T.rel=0; T.cd=0; });
  s.siege=false; s.amp=0; s.cloak=0; s.slow=0; s.hot=0; s.pdUp=0;
  for (const k in s.ab){ s.ab[k]=0; s.abOn[k]=0; }
  // ⚠️ НОС СТАВИМ ПРЯМО, БЕЗ lookAt. Модель корабля смотрит вдоль +X, а lookAt
  // строит базис под −Z, и правка «доверни на 90°» давала разворот В ДРУГУЮ
  // СТОРОНУ: и игрок, и звено выходили кормой к противнику и первые полминуты
  // разворачивались. Здесь один честный поворот: ось +X модели → направление на
  // чужую базу. Ошибиться знаком тут негде.
  const look = baseOf(!s.mine).sub(s.pos).normalize();
  s.q.setFromUnitVectors(V(1,0,0), look);
  // выравнивание крена: «вверх» борта не должен уходить набок после разворота
  const up = shipUp(s,t2), want = V(0,1,0).projectOnPlane(look);
  if (want.lengthSq()>0.01){
    want.normalize();
    const ra = up.angleTo(want);
    if (ra>1e-4) s.q.premultiply(new THREE.Quaternion()
      .setFromAxisAngle(t1.crossVectors(up,want).normalize(), ra));
  }
  if (s===DN.me){
    const f = shipDir(s,t1);
    DN.aim.yaw = Math.atan2(f.z, f.x); DN.aim.pit = 0;
    DN.shake=0; DN.camAnchor=null; say('В строю: '+s.C.name);
  }
}

function stepShots(dt){
  for (let i=DN.shots.length-1;i>=0;i--){
    const b=DN.shots[i], step=b.v*dt;
    // ведомый снаряд доворачивает на цель — не мгновенно, уйти манёвром можно
    if (b.seek){
      if (!b.seek.alive) b.seek=null;
      else {
        const to = t1.subVectors(b.seek.pos, b.p).normalize();
        b.d.lerp(to, Math.min(1, dt*2.6)).normalize();
      }
    }
    let hit=null;
    // Ремонтный рой (технология «нано») ищет СВОЙ борт, а не чужой: на доске он
    // тоже не режет броню, а латает её (TG: kind==='repair').
    const heal = b.kind==='repair';
    for (const s of DN.ships){
      if (!s.alive || (heal ? s.mine!==b.mine || s===b.own : s.mine===b.mine)) continue;
      // отрезок против сферы борта — на 900 ед/с проверять точку бессмысленно
      const t = clamp(t1.subVectors(s.pos,b.p).dot(b.d), 0, step);
      if (t2.copy(b.p).addScaledVector(b.d,t).distanceTo(s.pos) < radius(s)){ hit=s; break; }
    }
    // ⚠️ КАМЕНЬ ПЕРЕХВАТЫВАЕТ ОГОНЬ. Проверяем ДО кораблей и по отрезку кадра:
    // снаряд, чей путь пересёк живую ячейку раньше, чем борт, обязан встать
    // именно там — иначе укрытие не работает и «стрелять сквозь скалу» можно.
    // ⚠️ СНАЧАЛА ДЕШЁВЫЙ ОТСЕВ, ПОТОМ ОБХОД РЕШЁТКИ. Полный DDA по каждому камню
    // на каждый снаряд — это 46 обходов × десятки снарядов в кадр, с клонами
    // векторов внутри. Здесь сначала скалярная проверка «отрезок против сферы»
    // без единой аллокации, и лишь для прошедших — честный обход вокселей.
    let rockHit=null, rockT=1e9, rockObj=null;
    for (const r of DN.rocks){
      if (r.dead) continue;
      const ox=r.pos.x-b.p.x, oy=r.pos.y-b.p.y, oz=r.pos.z-b.p.z;
      const along = ox*b.d.x + oy*b.d.y + oz*b.d.z;
      if (along < -r.r || along > step + r.r) continue;
      const t = along < 0 ? 0 : (along > step ? step : along);
      const dx=ox-b.d.x*t, dy=oy-b.d.y*t, dz=oz-b.d.z*t;
      if (dx*dx+dy*dy+dz*dz > r.r*r.r) continue;
      const h = VOX.raycast(r, b.p, b.d, step);
      if (h && h.t < rockT){ rockT=h.t; rockHit=h; rockObj=r; }
    }
    if (rockHit && (!hit || rockT < t1.subVectors(hit.pos,b.p).dot(b.d))){
      VOX.damage(rockObj, rockHit.id, b.dmg);
      spark(rockHit.point, b.mine);
      tracerFree(b.node);
      DN.shots.splice(i,1);
      continue;
    }
    b.p.addScaledVector(b.d, step);
    b.gone = (b.gone||0) + step;
    b.life-=dt;
    if (b.node) { b.node.position.copy(b.p); tracerAim(b.node, b.p, b.d, b.len||26); }
    if (hit || b.life<=0){
      if (hit && heal){
        hit.hp = Math.min(hit.hpMax, hit.hp + (b.heal||0));
        spark(b.p, b.mine, hit===DN.me);
      } else if (hit){
        // ⚠️ УРОН СЧИТАЕТСЯ НА ПОПАДАНИИ, А НЕ НА ВЫСТРЕЛЕ: он зависит от того,
        // сколько снаряд пролетел. Кривая — из _bt_weapon_model.sql: автопушка
        // на краю дальности отдаёт четверть, луч — три пятых, ракета — всё,
        // но в упор не наводится вовсе.
        const k = window.DNK ? DNK.falloff(b.kind||'kinetic', b.gone||0, b.rng||1e9) : 1;
        damage(hit, b.dmg*k, b.own, b.kind||'kinetic');
        spark(b.p, b.mine, hit===DN.me);
      }
      tracerFree(b.node);
      DN.shots.splice(i,1);
    }
  }
}


// ── Звук. Панорама и дальность считаются от КАМЕРЫ, а не от корабля: слышно то,
// что видно (см. dn_sfx.js). Если звука нет вовсе — контекст не поднят: он
// заводится первым кликом игрока, иначе браузер его глушит.
function sfxAt(p){
  if (!window.DNS || !DNS.ready) return null;
  const d = DN.cam.position.distanceTo(p);
  const right = t1.set(1,0,0).applyQuaternion(DN.cam.quaternion);
  const pan = clamp(t2.subVectors(p, DN.cam.position).normalize().dot(right), -1, 1);
  return { d:d, pan:pan };
}

// ── §11. Эффекты ─────────────────────────────────────────────
function glowTex(){
  if (DN._glow) return DN._glow;
  const c=document.createElement('canvas'); c.width=c.height=128;
  const x=c.getContext('2d'), g=x.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.25,'rgba(255,255,255,0.6)');
  g.addColorStop(0.6,'rgba(255,255,255,0.16)'); g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g; x.fillRect(0,0,128,128);
  DN._glow = new THREE.CanvasTexture(c);
  return DN._glow;
}
// ⚠️ ЭФФЕКТЫ БЕРУТСЯ ИЗ ПУЛА. Каждый вызов раньше создавал новый Sprite И новый
// SpriteMaterial: одно попадание — шесть материалов, а при перестрелке восьми
// бортов это сотни компиляций шейдера в секунду. Отсюда и «фпс умирает, когда
// стреляют многие». Спрайт с материалом создаётся ОДИН раз и потом только
// перекрашивается; число одновременных эффектов ограничено сверху — за кадром
// их всё равно никто не считает, а стоимость они дают вполне реальную.
const FX_CAP = 160;
function sprite(col, size){
  const pool = DN.fxPool || (DN.fxPool = []);
  let n = pool.pop();
  if (!n){
    n = new THREE.Sprite(new THREE.SpriteMaterial({ map:glowTex(), transparent:true,
      depthWrite:false, blending:THREE.AdditiveBlending }));
    DN.scene.add(n);
  }
  n.material.color.setHex(col);
  n.material.opacity = 1;
  n.visible = true;
  n.scale.set(size,size,1);
  return n;
}
function spriteFree(n){
  if (!n) return;
  n.visible = false;
  const pool = DN.fxPool || (DN.fxPool = []);
  if (pool.length < 240) pool.push(n); else DN.scene.remove(n);
}
// Ставим эффект в очередь, вытесняя самый старый, если их слишком много.
function fxPush(rec){
  if (DN.fx.length >= FX_CAP){
    const old = DN.fx.shift();
    if (old) spriteFree(old.n);
  }
  DN.fx.push(rec);
}

function spark(p, mine, onMe){
  const a = sfxAt(p); if (a) DNS.hit(!!onMe, a.d, a.pan);
  const col = mine?0x9fe8ff:0xffb0c0;
  const core = sprite(col, 30); core.position.copy(p);
  fxPush({ n:core, t:0, dur:0.16, k0:30, k1:6, fade:true });
  const ring = sprite(0xffffff, 8); ring.position.copy(p);
  fxPush({ n:ring, t:0, dur:0.26, k0:8, k1:46, fade:true });
  // ⚠️ ЭФФЕКТЫ ДЕГРАДИРУЮТ ПОД НАГРУЗКОЙ. В плотном бою попаданий десятки в
  // секунду, и полный набор искр на каждое — это сотни спрайтов, которые никто
  // не успевает разглядеть. Когда очередь эффектов заполнена больше чем на
  // половину, оставляем только ядро вспышки: картинка почти та же, счёт кадра
  // остаётся целым.
  const busy = DN.fx.length > FX_CAP*0.5;
  const near = !busy && DN.cam.position.distanceTo(p) < 900;
  for (let i=0; near && i<3; i++){
    const sp = sprite(col, 9); sp.position.copy(p);
    const dir = V(rnd(-1,1), rnd(-1,1), rnd(-1,1)).normalize().multiplyScalar(rnd(30,70));
    fxPush({ n:sp, t:0, dur:rnd(0.18,0.34), k0:9, k1:2, fade:true, vel:dir, from:p.clone() });
  }
}
// ⚠️ ДУЛЬНАЯ ВСПЫШКА БЫЛА ВЫЗВАНА, НО НЕ НАПИСАНА. fireFrom звал muzzleFlash с
// первого дня, а функции не существовало: каждый выстрел ронял кадр исключением,
// и цикл боя вставал — снаружи это выглядело как «арена подвисает, когда
// начинают стрелять». Вспышка красится по КАНАЛУ орудия: у автопушки жёлтая, у
// луча голубая, у пусковой оранжевая — по ней видно, чем именно бьёт борт.
function muzzleFlash(p, mine, kind, size){
  const col = (window.DNK && DNK.CHAN[kind||'kinetic'] ? DNK.CHAN[kind||'kinetic'].col
                                                      : (mine?0x9fe8ff:0xffc890));
  const k = size || 20;
  const f = sprite(col, k); f.position.copy(p);
  fxPush({ n:f, t:0, dur:0.09, k0:k, k1:k*0.3, fade:true });
}

function boom(p, size){
  const a = sfxAt(p); if (a) DNS.boom(a.d, a.pan);
  const s=sprite(0xffd9a0, size*0.6); s.position.copy(p);
  fxPush({ n:s, t:0, dur:0.9, k0:size*0.6, k1:size*2.6, fade:true });
}
function stepFx(dt){
  for (let i=DN.fx.length-1;i>=0;i--){
    const f=DN.fx[i]; f.t+=dt;
    const u=f.t/f.dur;
    if (u>=1){ spriteFree(f.n); DN.fx.splice(i,1); continue; }
    const k=f.k0+(f.k1-f.k0)*u; f.n.scale.set(k,k,1);
    if (f.vel) f.n.position.copy(f.from).addScaledVector(f.vel, f.t);
    if (f.fade) f.n.material.opacity=1-u;
  }
}

// ── §12. Камера ──────────────────────────────────────────────
// ⚠️ ЭТО ПРИЦЕЛЬНАЯ КАМЕРА, а не «вид от третьего лица». Правила, которые
// нарушать нельзя, потому что каждое из них уже было нарушено и мешало целиться:
//
//  1. ЦЕНТР ЭКРАНА = ЛИНИЯ ОГНЯ. Камера смотрит ровно вдоль луча прицела, и
//     перекрестье всегда в середине кадра. Раньше камера смотрела «в точку перед
//     кораблём», перекрестье плавало по экрану, и вести цель было нечем.
//  2. УГЛЫ БЕЗ СГЛАЖИВАНИЯ. Мышь двигает камеру в тот же кадр. Сглаживается
//     только ЯКОРЬ (положение корабля) — от него камера отстаёт мягко. Лаг по
//     углу — это то самое «камеру сбивает», от чего наводка превращается в кашу.
//  3. КОРПУС НЕ ЗАСЛОНЯЕТ. Камера поднята и сдвинута к правому плечу, борт
//     сидит в нижней трети кадра; на взгляде назад плечо гасится, иначе камера
//     упирается в собственную надстройку.
//  4. НИЧЕГО НЕ КАЧАЕТ ОБЗОР. Крен корпуса на камеру не идёт; раствор объектива
//     постоянный, кроме короткого кика на форсаже; дрожь — только от попаданий
//     по себе, и она короткая.
//  5. КАМЕРА НЕ НЫРЯЕТ В ОБЛОМКИ: если между ней и кораблём оказался камень,
//     радиус подтягивается.
const CAM = { fov:64, dist:3.6, up:0.55, side:0.34, lag:9 };

function stepCam(dt){
  const s=DN.me; if(!s) return;
  const look = aimDir(s, DN.aim.yaw, DN.aim.pit);
  // якорь — точка над кораблём; сглаживаем ТОЛЬКО его
  const anchor = s.pos.clone().addScaledVector(V(0,1,0), s.C.len*CAM.up);
  if (!DN.camAnchor) DN.camAnchor = anchor.clone();
  DN.camAnchor.lerp(anchor, Math.min(1, dt*CAM.lag));

  // плечо: вправо от линии взгляда, гаснет когда смотрим назад вдоль корпуса
  const right = t1.crossVectors(look, V(0,1,0));
  if (right.lengthSq()<1e-4) right.set(0,0,1); else right.normalize();
  const backish = clamp(-look.dot(shipDir(s,t2)), 0, 1);          // 1 = смотрим себе в корму
  const pivot = DN.camAnchor.clone().addScaledVector(right, s.C.len*CAM.side*(1-backish*0.85));

  let dist = s.C.len*(CAM.dist - DN.zoomK*1.1);
  // камера не должна оказаться внутри обломка
  DN.rocks.forEach(r=>{
    if (r.dead) return;
    const c = pivot.clone().addScaledVector(look, -dist);
    if (c.distanceTo(r.pos) < r.r + 6){
      dist = Math.max(s.C.len*1.6, pivot.distanceTo(r.pos) - r.r - 6);
    }
  });

  DN.cam.position.copy(pivot).addScaledVector(look, -dist);
  DN.cam.lookAt(pivot.clone().addScaledVector(look, 4000));        // центр кадра = линия огня
  if (DN.shake>0){
    DN.shake = Math.max(0, DN.shake - dt*3.2);
    const k=DN.shake*0.006;                                        // дрожь еле заметная: она мешает целиться
    DN.cam.rotateX(rnd(-k,k)); DN.cam.rotateY(rnd(-k,k));
  }
  // раствор постоянный; форсаж даёт короткий кик — этого хватает для «рывка»
  // прицеливание: объектив сужается, борт отъезжает ближе к камере
  const fov = (DN.zoom ? 34 : CAM.fov) + (pwOn(s,'eng') ? 7 : 0);
  DN.zoomK += ((DN.zoom?1:0)-DN.zoomK)*Math.min(1,dt*6);
  if (Math.abs(DN.cam.fov-fov)>0.05){ DN.cam.fov += (fov-DN.cam.fov)*Math.min(1,dt*4); DN.cam.updateProjectionMatrix(); }
  if (DN.stars) DN.stars.position.copy(DN.cam.position);
  stepDust();
}

// ⚠️ ОГОНЬ ИГРОКА СЧИТАЕТСЯ ПОСЛЕ КАМЕРЫ И ПО ЕЁ МАТРИЦЕ. Точку прицеливания
// нельзя выводить формулой от корабля: камера стоит не в корабле, а выше и у
// плеча, и центр кадра смотрит НЕ туда же, куда луч из корпуса. Разница как раз
// и давала «летит хуй знает куда». Берём буквально то, что видит игрок:
// положение камеры и её собственное направление взгляда — тогда центр экрана и
// точка попадания совпадают тождественно, а не приблизительно.
function playerGuns(dt){
  const s=DN.me;
  if (!s||!s.alive||DN.spawn){ DN.onTarget=0; return; }
  const look = DN.cam.getWorldDirection(t3).clone();
  DN.onTarget = stepGuns(s, rangePoint(s, look), DN.fire1, dt);
  // клик «в пустоту» должен отвечать хотя бы щелчком: молчание игрок читает как
  // поломку и жмёт ещё раз, вместо того чтобы довернуть борт
  DN._dry = (DN._dry||0) - dt;
  if (DN.fire1 && DN.onTarget===0 && DN._dry<=0){
    DN._dry = 0.45;
    if (window.DNS) DNS.click();
  }
}

// ── §13. HUD ─────────────────────────────────────────────────
// Лента событий больше НЕ РИСУЕТСЯ на экране: строки текста в бою никто не
// читает. Сообщения остаются в DN.feed для отладки и звукового отклика.
function say(t){ DN.feed.unshift({ t:t, at:performance.now() }); if (DN.feed.length>6) DN.feed.pop(); }

// ⚠️ ЭТО ПРИБОРНАЯ ПАНЕЛЬ, А НЕ ОТЛАДОЧНАЯ КОНСОЛЬ. Первый HUD был набором
// подписанных полосок («КОРПУС 3200/3200», «МОЩНОСТЬ → Двигатели») — в бою такое
// не читается: глаз занят целью, а слова требуют чтения. Здесь всё показано
// ФОРМОЙ И ЦВЕТОМ, на своих привычных местах:
//   низ по центру  — блок борта: дуга корпуса, дуга щита, кольцо энергии;
//   левее          — машинный телеграф: четыре ступени хода и стрелка скорости;
//   правее         — три модуля кругами с кольцевым откатом;
//   над ними       — три значка мощности, активный подсвечен;
//   верх справа    — счёт боя значками, без слов.
// Единственные цифры на экране — секунды отката внутри кругов: их читают
// мельком и они действительно нужны.
function drawHud(){
  const x=DN.hx; if(!x) return;
  const W=DN.cv.clientWidth, H=DN.cv.clientHeight, s=DN.me;
  x.clearRect(0,0,W,H);
  x.textBaseline='middle'; x.textAlign='center';
  x.font='11px "Courier New", monospace';
  const cx=W/2, cy=H/2;
  if (!s) return;
  const tgt = s.alive ? lockTarget() : null;

  hudReticle(x, cx, cy, s);
  hudMarks(x, W, H, cx, cy, s, tgt);
  if (s.alive && !DN.spawn) hudPanel(x, W, H, s);
  hudDamageArcs(x, W, H, cx, cy);
  hudScore(x, W, H);
  if (DN.fps){
    x.textAlign='left'; x.font='12px "Courier New", monospace';
    const v = DN.fps.v;
    x.fillStyle = v>=50 ? 'rgba(120,235,180,0.9)' : (v>=30 ? 'rgba(255,200,90,0.9)' : 'rgba(255,90,110,0.95)');
    x.fillText(v + ' fps   ' + DN.renderer.info.render.calls + ' draw   '
               + Math.round(DN.renderer.info.render.triangles/1000) + 'k tri', 24, 22);
  }

  if (DN.mission && window.DNM) DNM.hud(x, W, H, s);
  if (window.DNT && DN.touch) DNT.draw(x, W, H, s);
  if (DN.wheel.open) drawWheel(x,cx,cy);
  if (DN.spawn) drawSpawn(x,W,H);
  if (!DN.locked && !DN.touch && DN.running && s.alive && !DN.spawn) hudCursorHint(x, cx, cy);
}

// ── Прицел: кольцо, «усы» и деления готовности башен ─────────
function hudReticle(x, cx, cy, s){
  if (!s.alive || DN.spawn) return;
  const on = DN.onTarget||0, all = s.tur? s.tur.length : 0;

  // ⚠️ СЕКТОР ПОКАЗЫВАЕТ САМ ПРИЦЕЛ. Ни веера по палубе, ни схемы в углу: и то и
  // другое требует от игрока перевода «картинка → пространство» посреди боя.
  // В играх это решают состоянием перекрестья, и здесь так же:
  //   стволы достают   — прицел живой, кольцо и усы яркие;
  //   не достают       — прицел гаснет до серого и «схлопывается», а по бокам
  //                      загорается стрелка в ту сторону, куда нужно доворачивать
  //                      борт, чтобы башни дотянулись.
  // Никаких новых элементов на экране не появляется — меняется тот, на который
  // игрок и так смотрит.
  const col = on ? (lockTarget() ? '255,90,130' : '120,210,235') : '150,165,175';
  const k = on ? 1 : 0.55;                       // «схлопывание» при отказе
  x.strokeStyle='rgba('+col+','+(on?0.95:0.5)+')'; x.lineWidth=1.6;
  x.beginPath(); x.arc(cx,cy,8*k,0,6.28); x.stroke();
  x.beginPath();
  x.moveTo(cx-20*k,cy); x.lineTo(cx-11*k,cy); x.moveTo(cx+11*k,cy); x.lineTo(cx+20*k,cy);
  x.moveTo(cx,cy-20*k); x.lineTo(cx,cy-11*k); x.moveTo(cx,cy+11*k); x.lineTo(cx,cy+20*k);
  x.stroke();

  if (!on && all){
    // куда доворачивать: ищем ближайший по углу сектор и показываем сторону
    const inv = s.q.clone().invert();
    const look = DN.cam.getWorldDirection(t3).clone().applyQuaternion(inv);
    const aimA = Math.atan2(look.z, look.x);
    let best = 0, bd = 9;
    s.tur.forEach(T=>{
      if (T.rel>0 || T.mag<=0) return;
      const d = angDiff(T.m.home, aimA);
      const need = Math.abs(d) - T.m.arc/2;
      if (need < bd){ bd = need; best = d; }
    });
    const side = best >= 0 ? 1 : -1;             // + вправо по борту
    const px = cx + side*46, py = cy;
    x.save(); x.translate(px,py); x.rotate(side>0?0:Math.PI);
    x.fillStyle='rgba(255,190,90,'+(0.55+0.35*Math.abs(Math.sin(performance.now()/260))).toFixed(2)+')';
    x.beginPath(); x.moveTo(9,0); x.lineTo(-4,6); x.lineTo(-4,-6); x.closePath(); x.fill();
    x.restore();
  }

}

// ⚠️ ПОПАДАНИЕ ПО СЕБЕ ОБЯЗАНО ИМЕТЬ НАПРАВЛЕНИЕ. Полоса корпуса говорит «тебя
// бьют», но не говорит откуда, а это главный вопрос: разворачиваться, уходить
// или прятаться за камень. Дуга по краю экрана загорается с той стороны, откуда
// пришёл урон, и гаснет за полторы секунды.
function hudDamageArcs(x, W, H, cx, cy){
  if (!DN.hits || !DN.hits.length) return;
  const now = performance.now();
  for (let i=DN.hits.length-1;i>=0;i--){
    const h = DN.hits[i];
    const age = (now - h.at)/1400;
    if (age >= 1){ DN.hits.splice(i,1); continue; }
    const r = Math.min(W,H)*0.46;
    x.strokeStyle = 'rgba(255,70,90,'+((1-age)*0.55).toFixed(2)+')';
    x.lineWidth = 5 + (1-age)*5;
    x.beginPath(); x.arc(cx, cy, r, h.a-0.34, h.a+0.34); x.stroke();
  }
}


// Сколько заряженных стволов способно навестись на этот борт. Считается по той
// же геометрии, что и сама стрельба (сектор в системе корпуса), поэтому цифра
// не врёт: столько снарядов и полетит, если открыть огонь.
function turretsOn(s, o){
  if (!s.tur) return 0;
  const inv = s.q.clone().invert();
  const v = t1.subVectors(o.pos, s.pos).applyQuaternion(inv);
  const ang = Math.atan2(v.z, v.x);
  const pit = Math.atan2(v.y, Math.hypot(v.x, v.z));
  if (v.length() > s.C.gun.rng) return 0;
  let n = 0;
  s.tur.forEach(T=>{
    if (T.rel>0 || T.mag<=0) return;
    if (Math.abs(angDiff(ang, T.m.home)) <= T.m.arc/2 && Math.abs(pit) <= TUR_PIT) n++;
  });
  return n;
}

// ── Метки бортов: рамка, полоска живучести, стрелка за кадром ─
function hudMarks(x, W, H, cx, cy, s, tgt){
  DN.ships.forEach(o=>{
    if (o===s||!o.alive) return;
    const p=o.pos.clone().project(DN.cam);
    const sx=(p.x*0.5+0.5)*W, sy=(-p.y*0.5+0.5)*H;
    const col = o.mine ? '90,255,190' : '255,60,130';
    const seen = p.z<1 && sx>0 && sx<W && sy>0 && sy<H;
    if (seen){
      // ⚠️ НИКАКИХ РАМОК ВОКРУГ КОРАБЛЯ. Квадрат поверх борта — это отладочная
      // подсветка: она закрывает саму модель, спорит с её силуэтом и делает
      // экран решёткой. Опознание даёт КОМПАКТНАЯ МЕТКА НАД БОРТОМ: клин цвета
      // стороны и короткая полоска живучести под ним. Захваченная цель получает
      // тонкое перекрестье-уголки, и только она.
      const dist = o.pos.distanceTo(s.pos);
      const k = clamp(1 - dist/(s.C.gun.rng*1.6), 0.12, 1);
      const up = 16 + k*16;                       // метка висит над бортом
      const w = 9 + k*5;
      x.save(); x.translate(sx, sy-up);
      // ⚠️ ДОСЯГАЕМОСТЬ ПОКАЗЫВАЕТСЯ НА САМОЙ ЦЕЛИ, А НЕ ГЕОМЕТРИЕЙ В ПУСТОТЕ.
      // Веер по палубе (в двух вариантах) закрывал мир и читался как мусор.
      // Здесь тот же ответ даёт метка над бортом: заполненный клин — стволы
      // достают, полый контур — нет; точки под клином = сколько именно стволов
      // готово ударить по этой цели прямо сейчас. Ничего лишнего на экране не
      // появляется, а вопрос «могу ли я его достать» решается взглядом на цель.
      const guns = o.mine ? 0 : turretsOn(s, o);
      const reach = guns > 0;
      x.fillStyle='rgba('+col+','+(o===tgt?0.95:0.6)+')';
      x.strokeStyle='rgba('+col+','+(o===tgt?0.9:0.5)+')'; x.lineWidth=1.3;
      x.beginPath(); x.moveTo(0,5); x.lineTo(-5,-4); x.lineTo(5,-4); x.closePath();
      if (o.mine || reach) x.fill(); else x.stroke();
      if (!o.mine && reach){
        for (let gi=0; gi<guns; gi++){
          x.fillStyle='rgba('+col+',0.85)';
          x.fillRect(-(guns*4-2)/2 + gi*4, -10, 2, 2);
        }
      }
      // живучесть — короткая черта под клином, без фона и рамки
      x.fillStyle='rgba(255,255,255,0.16)'; x.fillRect(-w, 8, w*2, 2);
      x.fillStyle='rgba('+col+',0.9)'; x.fillRect(-w, 8, w*2*(o.hp/o.hpMax), 2);
      if (o.sh>0){
        x.fillStyle='rgba(150,200,255,0.55)'; x.fillRect(-w, 12, w*2*(o.sh/o.shMax), 1.5);
      }
      x.restore();
      // цель под прицелом — четыре тонких уголка ВОКРУГ, но заметно шире борта,
      // чтобы не наезжать на модель
      if (o===tgt){
        const r = 26 + k*26, c2 = r*0.3;
        x.strokeStyle='rgba('+col+',0.8)'; x.lineWidth=1.2;
        [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(q=>{
          x.beginPath();
          x.moveTo(sx+q[0]*r, sy+q[1]*(r-c2)); x.lineTo(sx+q[0]*r, sy+q[1]*r); x.lineTo(sx+q[0]*(r-c2), sy+q[1]*r);
          x.stroke();
        });
      }
    } else {
      // за кадром — треугольник по краю в сторону борта
      const dx=(p.z<1? sx:2*cx-sx)-cx, dy=(p.z<1? sy:2*cy-sy)-cy;
      const a=Math.atan2(dy,dx), rr=Math.min(W,H)*0.44;
      const px=cx+Math.cos(a)*rr, py=cy+Math.sin(a)*rr;
      x.save(); x.translate(px,py); x.rotate(a);
      x.fillStyle='rgba('+col+',0.55)';
      x.beginPath(); x.moveTo(7,0); x.lineTo(-5,4); x.lineTo(-5,-4); x.closePath(); x.fill();
      x.restore();
    }
  });
}

// ── Дуга помощи ──────────────────────────────────────────────
function arc(x, cx, cy, r, a0, a1, col, w){
  x.strokeStyle=col; x.lineWidth=w; x.lineCap='butt';
  x.beginPath(); x.arc(cx,cy,r,a0,a1); x.stroke();
}

// ── Блок борта внизу по центру ───────────────────────────────
// ⚠️ НА ТЕЛЕФОНЕ ПРИБОРА БОРТА ВНИЗУ НЕТ ВОВСЕ.
// Сначала здесь дублировались телеграф, модули и мощность — те же, что палец
// жмёт у краёв (dn_touch.js), — и низ был свалкой колец. Их убрали, но остаток
// (полукольца живучести с радаром в сердцевине) всё равно сидел ПОСРЕДИ нижней
// половины: ровно там, где идёт бой, где свой борт и метки противника. На
// широком мониторе это поле пустует, на телефоне — нет.
//
// Поэтому показания разнесены по краям и НИЧЕГО не рисуется над полем:
//   корпус и щит — двумя дугами по ободу СТИКА (dn_touch.js drawStick);
//                  обод и так был пустой линией, а палец на нём и лежит;
//   энергия      — дугой по кромке кнопки мощности, там же, где ею и правят;
//   сектора и    — компактным диском в правом верхнем углу, под счётом бортов:
//   отметки        это единственный угол, свободный и в свободном бою, и в
//                  миссии (эфир мостика идёт по левому краю).
function hudPanel(x, W, H, s){
  if (DN.touch){
    const u = clamp(Math.min(W,H)/400, 0.82, 1.45);
    const cx = W - 52*u, cy = 104*u;
    // подложка: без неё диск теряется на светлых камнях
    x.fillStyle = 'rgba(8,14,20,0.42)';
    x.beginPath(); x.arc(cx, cy, 34*u, 0, 6.28); x.fill();
    arc(x, cx, cy, 34*u, 0, 6.28, 'rgba(255,255,255,0.10)', 1);
    hudArcs(x, cx, cy, s);
    return;
  }
  const cx = W/2, cy = H - 74, R = 62;
  // ЖИВУЧЕСТЬ: наружная дуга — корпус, внутренняя — щит. Полукруг, открытый вверх.
  const a0 = Math.PI*0.82, a1 = Math.PI*2.18;
  arc(x, cx, cy, R, a0, a1, 'rgba(255,255,255,0.10)', 7);
  arc(x, cx, cy, R, a0, a0+(a1-a0)*clamp(s.hp/s.hpMax,0,1), 'rgba(120,225,245,0.95)', 7);
  arc(x, cx, cy, R-11, a0, a1, 'rgba(255,255,255,0.07)', 4);
  arc(x, cx, cy, R-11, a0, a0+(a1-a0)*clamp(s.sh/s.shMax,0,1), 'rgba(150,195,255,0.85)', 4);
  // ЭНЕРГИЯ: кольцо внутри, желтее — расход виден по тому, как оно тает
  arc(x, cx, cy, R-19, a0, a1, 'rgba(255,255,255,0.06)', 3);
  arc(x, cx, cy, R-19, a0, a0+(a1-a0)*clamp(s.en/s.enMax,0,1), 'rgba(255,196,90,0.9)', 3);
  // В СЕРДЦЕВИНЕ — СЕКТОРА ОБСТРЕЛА. Отдельную схему на пол-экрана рисовать
  // незачем, а вот в приборе она на своём месте: вид сверху на свой борт, нос
  // вверх. Плотность заливки по кругу = СКОЛЬКО СТВОЛОВ достаёт в это
  // направление (считаются только заряженные), жёлтая риска — куда смотрит
  // прицел, розовые точки — где противник. Читается одним взглядом: доворачивай
  // борт так, чтобы риска и точки попали в плотный сектор.
  hudArcs(x, cx, cy, s);

  hudTelegraph(x, cx-R-64, cy, s);
  hudModules(x, cx+R+34, cy, s);
  hudPower(x, cx, cy-R-16, s);
}


// Круговой индикатор секторов внутри панели борта.
function hudArcs(x, cx, cy, s){
  const R0 = 15, R1 = 31, N = 48;
  const inv = s.q.clone().invert();
  const look = DN.cam.getWorldDirection(t3).clone().applyQuaternion(inv);
  const aimA = Math.atan2(look.z, look.x);
  // сколько стволов накрывает каждое направление
  const seg = new Array(N).fill(0);
  let maxN = 1;
  if (s.tur) s.tur.forEach(T=>{
    if (T.rel>0 || T.mag<=0) return;               // пустая башня в счёт не идёт
    for (let i=0;i<N;i++){
      const a = (i+0.5)/N*Math.PI*2;
      if (Math.abs(angDiff(a, T.m.home)) <= T.m.arc/2){ seg[i]++; if (seg[i]>maxN) maxN=seg[i]; }
    }
  });
  x.save(); x.translate(cx,cy);
  for (let i=0;i<N;i++){
    if (!seg[i]) continue;
    const a0 = (i/N)*Math.PI*2 - Math.PI/2, a1 = ((i+1)/N)*Math.PI*2 - Math.PI/2;
    x.beginPath(); x.arc(0,0,R1,a0,a1); x.arc(0,0,R0,a1,a0,true); x.closePath();
    x.fillStyle = 'rgba(120,225,245,'+(0.10 + 0.26*(seg[i]/maxN)).toFixed(3)+')';
    x.fill();
  }
  // силуэт борта — он же указатель носа
  x.save(); x.rotate(-s.roll*0.6);
  x.fillStyle='rgba(200,230,245,0.8)';
  x.beginPath(); x.moveTo(0,-12); x.lineTo(5,8); x.lineTo(0,5); x.lineTo(-5,8); x.closePath(); x.fill();
  x.restore();
  // куда смотрит прицел
  const ar = aimA - Math.PI/2;
  x.strokeStyle='rgba(255,196,90,0.95)'; x.lineWidth=2;
  x.beginPath(); x.moveTo(Math.cos(ar)*(R0-3), Math.sin(ar)*(R0-3));
  x.lineTo(Math.cos(ar)*(R1+4), Math.sin(ar)*(R1+4)); x.stroke();
  // противник вокруг борта: ближе к краю — дальше от вас
  DN.ships.forEach(o=>{
    if (o===s || !o.alive || o.mine===s.mine) return;
    const v = t1.subVectors(o.pos, s.pos).applyQuaternion(inv);
    const a = Math.atan2(v.z, v.x) - Math.PI/2;
    const k = clamp(o.pos.distanceTo(s.pos)/(s.C.gun.rng*1.3), 0.2, 1);
    x.fillStyle='rgba(255,60,130,0.9)';
    x.beginPath(); x.arc(Math.cos(a)*(R0+(R1-R0)*k), Math.sin(a)*(R0+(R1-R0)*k), 2.4, 0, 6.28); x.fill();
  });
  x.restore();
}

// Машинный телеграф: четыре ступени и стрелка фактического хода.
function hudTelegraph(x, px, py, s){
  const h=88, w=13, y0=py-h/2;
  for (let i=0;i<THR_STEPS.length;i++){
    const yy = y0 + (THR_STEPS.length-1-i)*(h/(THR_STEPS.length-1)) - 4;
    const on = i===s.step;
    x.fillStyle = on ? 'rgba(120,225,245,0.95)' : 'rgba(255,255,255,0.13)';
    x.fillRect(px, yy, w, 7);
  }
  // фактическая скорость — короткая стрелка слева, тянется вверх по мере разгона
  const k = clamp(s.vel.length()/s.C.spd, 0, 1.45);
  x.fillStyle='rgba(255,196,90,0.9)';
  const ay = y0 + h - k*h;
  x.beginPath(); x.moveTo(px-6, ay); x.lineTo(px-13, ay-4); x.lineTo(px-13, ay+4); x.closePath(); x.fill();
  x.strokeStyle='rgba(255,255,255,0.10)'; x.lineWidth=1;
  x.beginPath(); x.moveTo(px-6, y0-6); x.lineTo(px-6, y0+h+2); x.stroke();
}

// Модули: круги с кольцевым откатом. Цифра внутри — только когда идёт откат.
function hudModules(x, px, py, s){
  const acts = s.C.acts||[], r=17, gap=42;
  acts.forEach((a,i)=>{
    const k=a.k, ax=px+i*gap, ay=py;
    const on=s.abOn[k]>0, cd=s.ab[k]||0;
    x.fillStyle = on ? 'rgba(120,225,245,0.30)' : 'rgba(10,18,26,0.55)';
    x.beginPath(); x.arc(ax,ay,r,0,6.28); x.fill();
    arc(x, ax, ay, r, -Math.PI/2, Math.PI*1.5, 'rgba(255,255,255,0.16)', 2);
    if (cd>0) arc(x, ax, ay, r, -Math.PI/2, -Math.PI/2 + Math.PI*2*(1-cd/a.cd), 'rgba(120,225,245,0.9)', 2);
    else if (!on) arc(x, ax, ay, r, -Math.PI/2, Math.PI*1.5, 'rgba(120,225,245,0.55)', 2);
    icon(x, ax, ay, 'act:'+a.kind, on ? 'rgba(220,245,255,0.95)' : (cd>0?'rgba(160,185,200,0.6)':'rgba(200,230,245,0.9)'));
    // номер клавиши — иначе игрок не знает, чем жать именно этот модуль
    x.fillStyle='rgba(150,180,196,0.75)'; x.font='10px "Courier New", monospace';
    x.fillText(String(i+1), ax, ay-r-8);
    if (cd>0){
      x.fillStyle='rgba(220,240,250,0.9)'; x.font='11px "Courier New", monospace';
      x.fillText(Math.ceil(cd), ax, ay+r+10);
    }
  });
}

// Значки мощности: активный подсвечен, во время переброса мигает.
function hudPower(x, px, py, s){
  const keys=POWER_KEYS.filter(k=>k!=='off'), r=13, gap=34;
  const x0 = px - (keys.length-1)*gap/2;
  keys.forEach((k,i)=>{
    const ax=x0+i*gap, on=s.pw===k;
    const blink = on && s.pwT>0 && (Math.floor(performance.now()/120)%2===0);
    x.fillStyle = on ? (blink?'rgba(120,225,245,0.18)':'rgba(120,225,245,0.34)') : 'rgba(10,18,26,0.5)';
    x.beginPath(); x.arc(ax,py,r,0,6.28); x.fill();
    arc(x, ax, py, r, 0, 6.28, on?'rgba(150,240,255,0.9)':'rgba(255,255,255,0.14)', 1.5);
    icon(x, ax, py, k, on?'rgba(220,245,255,0.95)':'rgba(180,205,220,0.6)');
  });
}

// Значки рисуем линиями: шрифтовых эмодзи в интерфейсе проекта нет и не будет.
function icon(x, cx, cy, key, col){
  x.save(); x.translate(cx,cy);
  x.strokeStyle=col; x.fillStyle=col; x.lineWidth=1.6; x.lineJoin='round';
  // ── значки СНАРЯЖЕНИЯ: по роду действия модуля, а не по его имени ──
  // Модулей в игре под три десятка, рисовать каждому свой значок бессмысленно:
  // в бою читается род действия — бьёт, лечит, усиливает, прыгает, прячет.
  if (key==='act:heal'){                      // крест ремонта
    x.beginPath(); x.moveTo(-7,0); x.lineTo(7,0); x.moveTo(0,-7); x.lineTo(0,7); x.stroke();
  } else if (key==='act:strike'){             // ракета: корпус со стабилизаторами
    x.beginPath(); x.moveTo(-7,3); x.lineTo(3,3); x.lineTo(8,0); x.lineTo(3,-3); x.lineTo(-7,-3); x.closePath(); x.stroke();
    x.beginPath(); x.moveTo(-7,-3); x.lineTo(-10,-7); x.moveTo(-7,3); x.lineTo(-10,7); x.stroke();
  } else if (key==='act:burst'){              // импульс: расходящиеся лучи
    x.beginPath(); x.arc(0,0,3,0,6.28); x.stroke();
    for (let i=0;i<6;i++){ const a=i*1.047;
      x.beginPath(); x.moveTo(Math.cos(a)*5, Math.sin(a)*5); x.lineTo(Math.cos(a)*9, Math.sin(a)*9); x.stroke(); }
  } else if (key==='act:amp'){                // молния усиления
    x.beginPath(); x.moveTo(2,-8); x.lineTo(-4,1); x.lineTo(1,1); x.lineTo(-2,8); x.lineTo(5,-1); x.lineTo(0,-1); x.closePath(); x.fill();
  } else if (key==='act:blink'){              // двойной шеврон прыжка
    x.beginPath(); x.moveTo(-6,-6); x.lineTo(0,0); x.lineTo(-6,6); x.moveTo(1,-6); x.lineTo(7,0); x.lineTo(1,6); x.stroke();
  } else if (key==='act:cloak'){              // пунктирный обвод: борта «нет»
    x.setLineDash([3,3]);
    x.beginPath(); x.moveTo(-8,2); x.lineTo(-2,-5); x.lineTo(6,-5); x.lineTo(8,2); x.lineTo(-8,2); x.stroke();
    x.setLineDash([]);
  } else if (key==='act:stance'){             // упор: платформа с распорками
    x.beginPath(); x.moveTo(-8,5); x.lineTo(8,5); x.moveTo(0,5); x.lineTo(0,-6); x.stroke();
    x.beginPath(); x.moveTo(-6,-1); x.lineTo(0,-6); x.lineTo(6,-1); x.stroke();
  } else if (key==='act:ram'){                // таранный клин
    x.beginPath(); x.moveTo(0,-8); x.lineTo(7,6); x.lineTo(-7,6); x.closePath(); x.stroke();
  } else if (key==='eng'){                    // винт двигателя
    x.beginPath(); x.arc(0,0,3,0,6.28); x.stroke();
    for (let i=0;i<3;i++){ const a=i*2.09;
      x.beginPath(); x.moveTo(Math.cos(a)*4, Math.sin(a)*4); x.lineTo(Math.cos(a)*9, Math.sin(a)*9); x.stroke(); }
  } else if (key==='wpn'){                    // ствол с дульным срезом
    x.beginPath(); x.moveTo(-8,3); x.lineTo(5,3); x.lineTo(5,-1); x.lineTo(-8,-1); x.closePath(); x.stroke();
    x.beginPath(); x.moveTo(6,-3); x.lineTo(9,-3); x.lineTo(9,5); x.lineTo(6,5); x.stroke();
  } else if (key==='shd'){                    // щит
    x.beginPath(); x.moveTo(0,-8); x.lineTo(7,-4); x.lineTo(7,3); x.lineTo(0,8); x.lineTo(-7,3); x.lineTo(-7,-4); x.closePath(); x.stroke();
  }
  x.restore();
}

// Счёт: значки вместо слов — свои и чужие борта в строю, запас подкреплений.
function hudScore(x, W, H){
  const y=26, x0=W-30;
  const row=(yy, col, alive, rein)=>{
    for (let i=0;i<Math.max(alive,0);i++){
      x.fillStyle='rgba('+col+',0.9)';
      x.fillRect(x0-i*11, yy-5, 7, 10);
    }
    for (let i=0;i<Math.min(rein,10);i++){
      x.fillStyle='rgba('+col+',0.22)';
      x.fillRect(x0-(alive+i)*11, yy-3, 7, 6);
    }
  };
  row(y,    '90,255,190', DN.ships.filter(o=>o.mine&&o.alive).length, DN.rein.mine);
  row(y+16, '255,60,130', DN.ships.filter(o=>!o.mine&&o.alive).length, DN.rein.foe);
}

// Подсказка «кликни, чтобы взять управление» — значком мыши, а не фразой.
function hudCursorHint(x, cx, cy){
  const y=cy+70;
  x.strokeStyle='rgba(200,230,245,0.5)'; x.lineWidth=1.5;
  x.beginPath();
  x.moveTo(cx-7, y-10); x.lineTo(cx+7, y-10); x.lineTo(cx+7, y+10); x.lineTo(cx-7, y+10); x.closePath();
  x.stroke();
  x.beginPath(); x.moveTo(cx, y-10); x.lineTo(cx, y-3); x.stroke();
  x.fillStyle='rgba(200,230,245,0.5)';
  x.fillRect(cx-6, y-9, 5, 6);
}

function drawWheel(x,cx,cy){
  const sel=wheelSeg(), R=168, r=70, n=POWER_KEYS.length;
  x.fillStyle='rgba(4,7,12,0.55)'; x.fillRect(0,0,DN.cv.clientWidth,DN.cv.clientHeight);
  POWER_KEYS.forEach((k,i)=>{
    const a0=-Math.PI/2+i*(Math.PI*2/n), a1=a0+Math.PI*2/n;
    x.beginPath();
    x.arc(cx,cy,R,a0+0.02,a1-0.02); x.arc(cx,cy,r,a1-0.02,a0+0.02,true); x.closePath();
    const on = DN.me.pw===k;
    x.fillStyle = i===sel ? 'rgba(90,220,240,0.30)' : (on?'rgba(90,220,240,0.14)':'rgba(255,255,255,0.06)');
    x.fill();
    x.strokeStyle = i===sel ? 'rgba(150,240,255,0.95)' : 'rgba(255,255,255,0.22)';
    x.lineWidth = i===sel?2:1; x.stroke();
    const am=(a0+a1)/2, tx=cx+Math.cos(am)*(R+r)/2, ty=cy+Math.sin(am)*(R+r)/2;
    x.textAlign='center';
    x.font='18px "Courier New", monospace'; x.fillStyle='rgba(220,245,255,0.95)';
    x.fillText(POWER[k].ico, tx, ty-12);
    x.font='12px "Courier New", monospace';
    x.fillText(POWER[k].name, tx, ty+8);
    x.fillStyle='rgba(160,190,205,0.9)';
    x.fillText(POWER[k].drain ? ('−'+POWER[k].drain+' энергии/с') : 'копит запас', tx, ty+24);
    if (on){ x.fillStyle='rgba(150,240,255,0.8)'; x.fillText('текущий', tx, ty+38); }
  });
  x.textAlign='center'; x.font='12px "Courier New", monospace';
  x.fillStyle='rgba(255,196,90,0.9)';
  x.fillText('ЭНЕРГИЯ '+Math.round(DN.me.en)+' / '+DN.me.enMax, cx, cy-26);
  x.fillStyle='rgba(220,240,250,0.9)';
  wrap(x, sel<0 ? 'ведите мышью — отпустите E, чтобы направить мощность' : POWER[POWER_KEYS[sel]].tip, cx, cy, 210);
  x.textAlign='left';
}
function wrap(x, str, cx, cy, w){
  const words=String(str).split(' '), lines=[]; let line='';
  words.forEach(word=>{
    if (line && x.measureText(line+' '+word).width > w){ lines.push(line); line=word; }
    else line = line ? line+' '+word : word;
  });
  if (line) lines.push(line);
  lines.forEach((l,i)=>x.fillText(l, cx, cy-(lines.length-1)*8+i*16));
}

// Экран возвращения в строй: борт и точка входа выбираются, пока идёт отсчёт.
function drawSpawn(x,W,H){
  const sp=DN.spawn, cx=W/2;
  x.fillStyle='rgba(4,7,12,0.72)'; x.fillRect(0,0,W,H);
  x.textAlign='center';
  x.font='24px "Courier New", monospace'; x.fillStyle='rgba(255,90,120,0.95)';
  x.fillText('БОРТ ПОТЕРЯН', cx, 120);
  x.font='13px "Courier New", monospace'; x.fillStyle='rgba(200,225,240,0.85)';
  x.fillText('возвращение в строй через '+Math.max(0,Math.ceil(sp.t))+' с    (Enter — сразу)', cx, 148);

  const LIST = SHIPS();
  x.fillStyle='rgba(120,150,168,0.9)'; x.fillText('ВЫБЕРИТЕ БОРТ  (клавиши 1…'+LIST.length+')', cx, 196);
  const bw=132, gap=10, x0=cx-(LIST.length*(bw+gap)-gap)/2;
  LIST.forEach((c,i)=>{
    const px=x0+i*(bw+gap), on=sp.cls===c, C=specOf(c);
    x.fillStyle = on?'rgba(90,220,240,0.18)':'rgba(255,255,255,0.05)';
    x.fillRect(px,212,bw,86);
    x.strokeStyle = on?'rgba(90,220,240,0.9)':'rgba(255,255,255,0.2)'; x.lineWidth=on?2:1;
    x.strokeRect(px,212,bw,86);
    x.fillStyle='rgba(220,240,250,0.95)'; x.fillText((i+1)+'. '+C.name, px+bw/2, 232);
    x.fillStyle='rgba(150,175,190,0.9)';
    x.fillText('корпус '+C.hp+'  щит '+C.shield, px+bw/2, 252);
    x.fillText('ход '+C.spd+'  '+C.gun.ru, px+bw/2, 270);
    x.fillText('башен '+C.mounts.length+'  модулей '+C.acts.length, px+bw/2, 288);
  });

  x.fillStyle='rgba(120,150,168,0.9)'; x.fillText('ТОЧКА ВХОДА В СВОЕЙ ЗОНЕ  (Q / Z / R / F)', cx, 336);
  const sw=168, x1=cx-(SPOTS.length*(sw+gap)-gap)/2;
  SPOTS.forEach((p,i)=>{
    const px=x1+i*(sw+gap), on=sp.spot===i;
    x.fillStyle = on?'rgba(90,220,240,0.18)':'rgba(255,255,255,0.05)';
    x.fillRect(px,352,sw,58);
    x.strokeStyle = on?'rgba(90,220,240,0.9)':'rgba(255,255,255,0.2)'; x.lineWidth=on?2:1;
    x.strokeRect(px,352,sw,58);
    x.fillStyle='rgba(220,240,250,0.95)'; x.fillText(['Q','Z','R','F'][i]+'. '+p.name, px+sw/2, 372);
    x.fillStyle='rgba(150,175,190,0.9)'; x.fillText(p.tip, px+sw/2, 392);
  });
  x.textAlign='left';
}

function bar(x,px,py,w,h,col,k,label){
  x.fillStyle='rgba(0,0,0,0.45)'; x.fillRect(px,py,w,h);
  x.fillStyle=col+'0.9)'; x.fillRect(px,py,w*clamp(k,0,1),h);
  x.strokeStyle=col+'0.5)'; x.lineWidth=1; x.strokeRect(px,py,w,h);
  x.fillStyle='rgba(210,235,245,0.9)'; x.fillText(label, px+w+10, py+h/2);
}

// ── §14. Цикл ────────────────────────────────────────────────
// ⚠️ ШАГ МИРА ОТДЕЛЁН ОТ КАДРА НАМЕРЕННО. Кадр — это «сколько времени прошло и
// нарисуй»; шаг мира — вся физика, боты и снаряды. Пока они были одним куском,
// мир нельзя было прокрутить иначе как через requestAnimationFrame, то есть
// нельзя было ни проверить поведение ботов, ни прогнать сценарий миссии без
// живого окна (rAF молчит, когда вкладка не рисуется). Порядок внутри значим и
// не переставляется: боты решают → мир двигается → снаряды летят → камера
// встаёт → и только потом считается огонь игрока, по УЖЕ вставшей камере.
function stepWorld(dt){
  if (window.DNT && DN.touch) DNT.step(dt);       // палец кладёт свои значения в DN.keys/DN.aim
  if (DN.mission && window.DNM) DNM.step(dt);
  if (DN.spawn) stepSpawn(dt); else playerControl(dt);
  DN.ships.forEach(s=>{ if (s.ai && s.alive) botThink(s,dt); });
  DN.ships.forEach(s=>stepShip(s,dt));
  stepShots(dt); stepRocks(dt); stepFx(dt); stepCam(dt); playerGuns(dt);
  if (DN.me){ if (!DN.me.zone && DN.zoomK > 0.02) buildZone(DN.me); stepZone(DN.me); }
  if (window.DNS && DNS.ready && DN.me){
    DNS.engine(DN.me.thr, DN.me.pw==='eng');
    // сирена — один раз на переход через четверть корпуса, а не каждый кадр
    const low = DN.me.alive && DN.me.hp < DN.me.hpMax*0.25;
    if (low && !DN._low) DNS.alarm();
    DN._low = low;
  }
}

function frame(){
  DN.raf = requestAnimationFrame(frame);
  const now=performance.now();
  const dt=Math.min(0.05, (now-DN.last)/1000) || 0.016;
  DN.last=now;
  if (DN.running) stepWorld(dt);
  DN.renderer.render(DN.scene, DN.cam);
  if (DN.fps){                       // счётчик кадров по клавише F — чтобы разговор
    DN.fps.n++;                      // о производительности шёл в числах, а не на слух
    const el = performance.now() - DN.fps.t;
    if (el >= 500){ DN.fps.v = Math.round(DN.fps.n*1000/el); DN.fps.n=0; DN.fps.t=performance.now(); }
  }
  drawHud();
}

function finish(win, txt, head){
  DN.over=true; DN.running=false; DN.spawn=null;
  if (document.exitPointerLock) document.exitPointerLock();
  const box=document.getElementById('dn-over');
  if (box){
    box.style.display='flex';
    const h = box.querySelector('h1');
    if (h) h.textContent = head || (DN.mission ? (win?'ЗАДАНИЕ ВЫПОЛНЕНО':'ЗАДАНИЕ ПРОВАЛЕНО') : 'БОЙ ОКОНЧЕН');
    if (h) h.style.color = win ? '#7fe3f5' : '#ff6a86';
    document.getElementById('dn-over-txt').textContent =
      (txt != null ? txt
        : (win?'Сектор зачищен — у противника не осталось бортов. '
              :'Ваша сторона исчерпала подкрепления. '))
      +'  Сбито: '+DN.score.kills+', потеряно бортов: '+DN.score.deaths;
  }
}

// ── §15. Запуск ──────────────────────────────────────────────
function start(opt){
  opt=opt||{};
  const key = opt.cls || DEF_SHIP;
  const mine = specOf(key) || specOf(DEF_SHIP);
  DN.ships.forEach(s=>DN.scene.remove(s.node));
  DN.shots.forEach(b=>tracerFree(b.node));
  DN.fx.forEach(f=>spriteFree(f.n));
  DN.ships=[]; DN.shots=[]; DN.fx=[]; DN.feed=[];
  DN.diff = opt.diff || DN.diff || 'normal';
  DN.score={kills:0,deaths:0}; DN.over=null; DN.waves=!!opt.waves; DN.spawn=null; DN.shake=0;
  // ⚠️ СЦЕНА ЧИСТИТСЯ ДО РАЗВИЛКИ РЕЖИМОВ, А НЕ ВНУТРИ ОДНОГО ИЗ НИХ. Всё, что
  // осталось от прошлого боя, обязано уйти здесь — иначе оно доживает до
  // следующего и висит поверх него (так и случилось с кольцами баз).
  clearBases();
  if (window.DNM) DNM.clear();     // небо и метки прошлой миссии — её забота
  DN.hits = [];

  // ── СЮЖЕТНАЯ МИССИЯ ─────────────────────────────────────────
  // Всё, что ниже (запас силы, звенья, базы), — правила СВОБОДНОГО боя. У
  // миссии свой расклад: борт игрока штучный, противник стоит там, где велит
  // сценарий, а победа считается по задачам, а не по остатку бортов.
  if (opt.mission && window.DNM){
    DN.mission = opt.mission;
    DN.rein = { mine:0, foe:0 };
    DNM.begin(opt.mission);
    DN.last=performance.now(); DN.running=true;
    if (!DN.raf) frame();
    return;
  }
  DN.mission = null;

  // ⚠️ СТОРОНЫ РАВНЫ СИЛОЙ, А НЕ ЧИСЛОМ БОРТОВ. Раньше игрок задавал «4 врага,
  // 3 союзника» — цифры, за которыми ничего не стоит: четыре корвета и четыре
  // дредноута считались одинаковой задачей. Теперь у каждой стороны один и тот
  // же ЗАПАС СИЛЫ (DNK.wing: живучесть × урон), и состав из него вытекает сам.
  // Взял корвет — вас будет много; взял дредноут — ты один, и звена нет.
  const budget = opt.budget || (window.DNK ? DNK.BUDGET : 500);
  const my = window.DNK ? DNK.wing(mine, budget) : 4;
  DN.rein = { mine: opt.rein || my*2, foe: opt.rein || my*2 };
  // ⚠️ ПОЛЕ БОЯ РАЗМЕЧАЕТСЯ ПОД ОРУДИЯ, А НЕ НАОБОРОТ. Пока у всех бортов была
  // одна выдуманная пушка на 700 единиц, поле в 3400 годилось всем. Теперь
  // дальность приходит из верфи и разнится в разы: у корвета с лёгкими
  // автопушками это триста единиц, у факельщика с электромагнитным орудием —
  // полторы тысячи. На поле, размеченном не под них, первые не доезжают до
  // противника вовсе, а вторые расстреливают его на подходе.
  // Считаем по САМОМУ ДАЛЬНОБОЙНОМУ орудию в бою: сходиться придётся всем, но
  // подход измеряется десятками секунд, а не минутами.
  const LIST = SHIPS();
  const i0 = Math.max(0, LIST.indexOf(key));
  const pool = LIST.slice(Math.max(0,i0-1), i0+2);           // соседи по силе
  const longest = pool.map(specOf).concat([mine])
                      .reduce((m,sp)=> Math.max(m, sp && sp.gun ? sp.gun.rng : 0), 600);
  // Мерка — дальность ВАШЕГО главного калибра, приподнятая до дальнобойных
  // соседей: иначе борт с короткими автопушками полторы минуты едет к бою,
  // который дальнобойные ведут без него. Расхождение баз — вдвое от мерки:
  // сблизиться надо, но не через всю карту.
  const yard = Math.max(mine.gun ? mine.gun.rng : 600, longest*0.8);
  DN.arena = clamp(yard*1.9/1.56, 900, 5200);      // 1.56 = две базы по 0.78 радиуса

  DN.me = makeShip(mine, true, 'ВЫ');
  respawn(DN.me);
  buildBases();

  // Звено собирается вокруг вашего борта: соседние по силе проекты, чтобы в
  // строю были и те, кто держит удар, и те, кто заходит с фланга.
  const MATE_NAMES = ['Вьюга','Стриж','Кряж','Ворон','Зарница','Секира'];
  const spend = (side, budgetLeft, name)=>{
    let left = budgetLeft, i = 0;
    while (left > 0 && i < 9){
      const spec = specOf(pool[i % pool.length]);
      const cost = window.DNK ? DNK.bv(spec) : 100;
      if (cost > left && i > 0) break;
      const u = makeShip(spec, side, name(spec, i));
      u.ai = { t:0, tgt:null };
      respawn(u, SPOTS[i%SPOTS.length]);
      left -= cost; i++;
    }
    return i;
  };
  // своё звено — за вычетом силы уже потраченной на ваш борт
  const mineBv = window.DNK ? DNK.bv(mine) : 100;
  spend(true,  Math.max(0, budget - mineBv), (sp,i)=>MATE_NAMES[i%MATE_NAMES.length]);
  spend(false, budget, (sp,i)=>sp.name.replace(/^[^«]*«|»$/g,'')+'-'+(i+1));

  DN.last=performance.now(); DN.running=true;
  say('Бой начался. W/S — ход, A/D — руль, мышь — башни.');
  if (!DN.raf) frame();
}

// Без волн боты не возрождаются: как только последний выбит — итог.
function tick(){
  if (!DN.running || DN.over || DN.mission) return;   // в миссии итог считает DNM
  const live = m => DN.ships.some(s=>s.mine===m && (s.alive||s.dead>0)) || DN.rein[m?'mine':'foe']>0;
  if (!live(false)) finish(true);
  else if (!live(true)) finish(false);
}
setInterval(tick, 500);

return { SHIPS:SHIPS, spec:specOf, DEF_SHIP:DEF_SHIP, POWER:POWER, DIFF:DIFF,
         mount:mount, start:start, state:DN, finish:finish, stepWorld:stepWorld,
         hud:function(c){ DN.hud=c; DN.hx=c.getContext('2d'); resize(); },
         // ⚠️ ЭТО НЕ «ПУБЛИЧНЫЙ API АРЕНЫ», А СЛУЖЕБНАЯ ДВЕРЬ ДЛЯ СВОИХ ФАЙЛОВ.
         // Ею пользуются dn_mission.js (расставить борта, вести сценарий) и
         // dn_touch.js (жать то же, что жмут клавиши). Ничего постороннего сюда
         // выводить не надо: всё, что здесь появится, придётся поддерживать.
         api: { makeShip, respawn, damage, kill, say, boom, spark, sprite, spriteFree,
                glowTex, useAbil, radius, shipDir, baseOf, wheelPick, wheelSeg, angDiff,
                THR_STEPS, POWER_KEYS, SPOTS, V, clamp, rnd, arc, icon, wrap } };
})();
