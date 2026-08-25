// ════════════════════════════════════════════════════════════════════
// ВОКСЕЛЬНЫЕ ОБЛОМКИ — разрушаемое укрытие арены
// ────────────────────────────────────────────────────────────────────
// Зачем это вообще: пока камни были цельными икосаэдрами, они не участвовали в
// бою — снаряды летели СКВОЗЬ них, и укрыться было негде; поле боя сводилось к
// открытой сфере, где всё решает только кто первым навёл башни. Здесь обломок —
// РЕШЁТКА КУБИКОВ, и это даёт три вещи разом:
//   • огонь по нему останавливается (можно спрятаться за камень и лечиться);
//   • камень выгрызается залпами — укрытие тает, пока за ним сидишь;
//   • разбитый пополам обломок РАЗВАЛИВАЕТСЯ на самостоятельные куски, которые
//     разлетаются и остаются укрытиями поменьше.
//
// ⚠️ ПОЧЕМУ INSTANCEDMESH, А НЕ ОТДЕЛЬНЫЕ MESH'И: на арене полторы сотни камней
// по несколько сотен ячеек — это десятки тысяч объектов. Отдельными Mesh'ами
// сцена умирает на первом же кадре. Одна инстансная сетка на обломок = один
// вызов отрисовки, а «выбитая» ячейка просто получает нулевой масштаб.
//
// ⚠️ ПОЧЕМУ ЛУЧ ИДЁТ DDA ПО РЕШЁТКЕ, А НЕ ПЕРЕБОРОМ ЯЧЕЕК: снаряд летит 880
// единиц в секунду, за кадр это десятки метров. Перебор всех ячеек на каждый
// снаряд — квадрат по стоимости; обход по сетке стоит ровно столько шагов,
// сколько ячеек пересекает отрезок.
// Экспорт: window.VOX
// ════════════════════════════════════════════════════════════════════
window.VOX = (function () {
'use strict';

const V = (x,y,z)=>new THREE.Vector3(x||0,y||0,z||0);

// Материал общий на все обломки: камень один и тот же, а инстансы всё равно
// красятся по-объектно. Разные материалы = разные вызовы отрисовки на ровном месте.
// ⚠️ ВОКСЕЛЬ НЕ ДОЛЖЕН ВЫГЛЯДЕТЬ ВОКСЕЛЕМ. Решётка нужна физике (разрушение,
// перехват огня, дробление), а глазу нужен АСТЕРОИД. Поэтому ячейка — не куб, а
// гранёный камешек, который перекрывается с соседями, плюс крапчатая текстура и
// разброс тона по инстансам: вблизи это груда породы, издали — цельная глыба.
// Куб выдаёт себя ровными рядами бликов — камешек их не даёт.
let MAT = null, TEX = null;
function stoneTex(){
  if (TEX) return TEX;
  const c=document.createElement('canvas'); c.width=c.height=128;
  const x=c.getContext('2d');
  x.fillStyle='#3a434d'; x.fillRect(0,0,128,128);
  for (let i=0;i<900;i++){
    const v=Math.random();
    x.fillStyle='rgba('+(v>0.5?255:0)+','+(v>0.5?255:0)+','+(v>0.5?255:0)+','+(0.05+Math.random()*0.12)+')';
    const r=1+Math.random()*4;
    x.beginPath(); x.arc(Math.random()*128, Math.random()*128, r, 0, 6.28); x.fill();
  }
  TEX = new THREE.CanvasTexture(c);
  TEX.wrapS = TEX.wrapT = THREE.RepeatWrapping;
  return TEX;
}
function mat(){
  if (!MAT){
    // ⚠️ НЕ PBR И БЕЗ BUMP-КАРТЫ. MeshStandardMaterial считает физическую модель
    // освещения на КАЖДЫЙ ПИКСЕЛЬ, а bumpMap добавляет к этому производные по
    // экрану. Камни занимают половину кадра — это был самый дорогой фрагментный
    // шейдер в сцене, и «фпс падает, когда смотришь на астероиды» шло именно
    // отсюда. Ламберт с одной текстурой и плоскими нормалями выглядит на гранёной
    // породе практически так же, а стоит в разы меньше.
    MAT = new THREE.MeshLambertMaterial({ map: stoneTex(), color:0x6a747f, flatShading:true });
  }
  return MAT;
}

// Псевдослучайность с зерном: форма камня должна быть устойчивой (одна и та же
// при пересборке), иначе после дробления куски «перерисовываются» другими.
function rnd(seed){ let x = Math.sin(seed*127.1+311.7)*43758.5453; return x - Math.floor(x); }

// ── §1. Создание обломка ─────────────────────────────────────
// n — сторона решётки (нечётная), cs — размер ячейки в единицах мира.
function make(scene, pos, radius, seed){
  tmp();
  // ⚠️ РАЗРЕШЕНИЕ ДЕРЖИМ НИЗКИМ. При n=13 один камень это 600+ инстансов, а их
  // на арене сотня — под миллион треугольников и просадка кадра в пол. Пяти-семи
  // ячеек по стороне хватает и на укрытие, и на дробление.
  const n = Math.max(5, Math.min(7, Math.round(radius/22)*2+3));
  const cs = (radius*2)/n;
  const cells = new Uint8Array(n*n*n);
  const hp = new Float32Array(n*n*n);
  const c = (n-1)/2;
  let count = 0;
  for (let i=0;i<n;i++) for (let j=0;j<n;j++) for (let k=0;k<n;k++){
    const dx=(i-c)/c, dy=(j-c)/c, dz=(k-c)/c;
    const d = Math.sqrt(dx*dx+dy*dy+dz*dz);
    // рваная поверхность: порог гуляет по направлению, поэтому камень не шар
    const bump = 0.72 + 0.34*rnd(seed + i*13 + j*71 + k*197);
    if (d <= bump){ const id=(i*n+j)*n+k; cells[id]=1; hp[id]=CELL_HP; count++; }
  }
  return build(scene, pos, n, cs, cells, hp, count, seed);
}

const CELL_HP = 70;          // сколько урона держит одна ячейка

function build(scene, pos, n, cs, cells, hp, count, seed){
  // ⚠️ ЯЧЕЙКИ ДОЛЖНЫ ПЕРЕКРЫВАТЬСЯ, ИНАЧЕ ВИДНА РЕШЁТКА. При радиусе меньше
  // половины диагонали ячейки между камешками остаются щели и глаз читает
  // «кучку шариков». Берём радиус почти в размер ячейки — поверхность сливается
  // в породу, а сама решётка остаётся только в физике.
  const geo = new THREE.IcosahedronGeometry(cs*0.86, 0);
  const mesh = new THREE.InstancedMesh(geo, mat(), count);
  mesh.frustumCulled = true;
  const o = {
    n:n, cs:cs, cells:cells, hp:hp, count:count, seed:seed,
    mesh:mesh, slot:new Int32Array(n*n*n).fill(-1), idOf:new Int32Array(count).fill(-1),
    pos:pos.clone(), q:new THREE.Quaternion(), spin:V(rnd(seed)*0.06-0.03, rnd(seed+1)*0.06-0.03, rnd(seed+2)*0.06-0.03),
    vel:V(), r:0, dirty:false, dead:false,
  };
  // ⚠️ ВНУТРЕННИЕ ЯЧЕЙКИ НЕ РИСУЮТСЯ. У шара из семи ячеек по стороне ядро — это
  // до половины всего объёма, и оно наглухо закрыто оболочкой: платить за него
  // отрисовкой незачем. Слоты раскладываются так: сначала ВИДИМЫЕ (те, у кого
  // есть пустой сосед), потом скрытые; mesh.count равен числу видимых. Когда
  // залп выбивает ячейку, открывшиеся соседи переводятся в видимую часть —
  // поэтому дыра в камне показывает породу, а не пустоту.
  const shown = new Uint8Array(cells.length);
  const isShell = (id)=>{
    const i=(id/(n*n))|0, j=((id/n)|0)%n, k=id%n;
    const nb=(a,b,c2)=>(a<0||b<0||c2<0||a>=n||b>=n||c2>=n) ? 0 : cells[(a*n+b)*n+c2];
    return !nb(i+1,j,k) || !nb(i-1,j,k) || !nb(i,j+1,k) || !nb(i,j-1,k) || !nb(i,j,k+1) || !nb(i,j,k-1);
  };
  for (let id=0; id<cells.length; id++) if (cells[id] && isShell(id)) shown[id]=1;

  const m = new THREE.Matrix4();
  let s = 0;
  const c = (n-1)/2;
  const order = [];
  for (let id=0; id<cells.length; id++) if (cells[id] &&  shown[id]) order.push(id);
  const visN = order.length;
  for (let id=0; id<cells.length; id++) if (cells[id] && !shown[id]) order.push(id);
  for (const id of order){
    const i = (id/(n*n))|0, j = ((id/n)|0)%n, k = id%n;
    // случайный поворот и лёгкий сдвиг каждой ячейки: одинаково поставленные
    // многогранники выстраивают грани в ряды, и это опять читается как сетка
    const rs = seed + id*0.7;
    m.makeRotationFromEuler(new THREE.Euler(rnd(rs)*6.28, rnd(rs+1)*6.28, rnd(rs+2)*6.28));
    m.setPosition((i-c)*cs + (rnd(rs+3)-0.5)*cs*0.22,
                  (j-c)*cs + (rnd(rs+4)-0.5)*cs*0.22,
                  (k-c)*cs + (rnd(rs+5)-0.5)*cs*0.22);
    mesh.setMatrixAt(s, m);
    o.slot[id] = s; o.idOf[s] = id;
    s++;
  }
  o.total = count;                    // сколько ячеек вообще живо
  o.vis = visN;                       // из них видимых (первые vis слотов)
  // лёгкий разброс тона: без него набор одинаковых ячеек читается как узор
  const col = new THREE.Color();
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count*3), 3);
  for (let q=0;q<count;q++){
    const k = 0.78 + rnd(seed+q*3.7)*0.42;
    col.setRGB(k, k*0.99, k*1.02);
    mesh.setColorAt(q, col);
  }
  mesh.instanceColor.needsUpdate = true;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = visN;
  mesh.position.copy(pos);
  scene.add(mesh);
  o.r = radiusOf(o);
  return o;
}

// Габаритный радиус по живым ячейкам — им пользуются столкновения кораблей и
// грубая отбраковка снарядов.
function radiusOf(o){
  const c=(o.n-1)/2;
  let max=0;
  for (let s=0;s<(o.total||o.mesh.count);s++){
    const id=o.idOf[s]; if (id<0) continue;
    const i=(id/(o.n*o.n))|0, j=((id/o.n)|0)%o.n, k=id%o.n;
    const d=Math.hypot((i-c),(j-c),(k-c))*o.cs;
    if (d>max) max=d;
  }
  return max + o.cs*0.5;
}

// ── §2. Луч по решётке (DDA) ─────────────────────────────────
// Возвращает {id, t, point} первой живой ячейки на отрезке, либо null.
// ⚠️ Временные объекты создаются ЛЕНИВО: файл подключён обычным скриптом, а
// three.js приезжает ESM-модулем (он отложен) — любой `new THREE.*` в теле
// файла падает раньше, чем THREE вообще появится.
let _p, _inv, _m, _dq, _lp, _ld, _cur;
function tmp(){ if (!_p){ _p=V(); _inv=new THREE.Quaternion(); _m=new THREE.Matrix4(); _dq=new THREE.Quaternion(); _lp=V(); _ld=V(); _cur=V(); } }
function raycast(o, p0, dir, len){
  if (o.dead) return null;
  tmp();
  // грубая отбраковка по габаритной сфере — 99% снарядов отсекаются здесь
  const to = _p.copy(o.pos).sub(p0);
  const along = to.dot(dir);
  if (along < -o.r || along > len + o.r) return null;
  if (_p.copy(p0).addScaledVector(dir, Math.max(0,Math.min(len,along))).distanceTo(o.pos) > o.r) return null;

  // в локальные координаты обломка. ⚠️ БЕЗ clone(): этот код зовётся десятки
  // тысяч раз в секунду, и каждый временный Vector3 — работа сборщику мусора,
  // которая потом отдаётся рывком кадра.
  _inv.copy(o.q).invert();
  const lp = _lp.copy(p0).sub(o.pos).applyQuaternion(_inv);
  const ld = _ld.copy(dir).applyQuaternion(_inv);
  const n=o.n, cs=o.cs, half=n*cs*0.5;
  // вход в куб решётки
  let t0=0, t1=len;
  for (let a=0;a<3;a++){
    const p = lp.getComponent(a), d = ld.getComponent(a);
    if (Math.abs(d)<1e-9){ if (p<-half||p>half) return null; continue; }
    let ta=(-half-p)/d, tb=(half-p)/d;
    if (ta>tb){ const s=ta; ta=tb; tb=s; }
    t0=Math.max(t0,ta); t1=Math.min(t1,tb);
    if (t0>t1) return null;
  }
  // шаг по ячейкам
  const cur = _cur.copy(lp).addScaledVector(ld, t0+1e-4);
  let i = Math.floor((cur.x+half)/cs), j = Math.floor((cur.y+half)/cs), k = Math.floor((cur.z+half)/cs);
  const si = ld.x>0?1:-1, sj = ld.y>0?1:-1, sk = ld.z>0?1:-1;
  const tdx = Math.abs(cs/(ld.x||1e-9)), tdy = Math.abs(cs/(ld.y||1e-9)), tdz = Math.abs(cs/(ld.z||1e-9));
  const bx = (i+(si>0?1:0))*cs-half, by=(j+(sj>0?1:0))*cs-half, bz=(k+(sk>0?1:0))*cs-half;
  let tx = Math.abs((bx-cur.x)/(ld.x||1e-9)), ty = Math.abs((by-cur.y)/(ld.y||1e-9)), tz = Math.abs((bz-cur.z)/(ld.z||1e-9));
  let t = t0;
  let guard = n*3+6;
  while (guard-- > 0){
    if (i>=0&&i<n&&j>=0&&j<n&&k>=0&&k<n){
      const id=(i*n+j)*n+k;
      if (o.cells[id]) return { id:id, t:t, point:p0.clone().addScaledVector(dir, t) };
    }
    if (tx<ty && tx<tz){ i+=si; t=t0+tx; tx+=tdx; }
    else if (ty<tz){ j+=sj; t=t0+ty; ty+=tdy; }
    else { k+=sk; t=t0+tz; tz+=tdz; }
    if (t>t1) break;
  }
  return null;
}

// ── §3. Разрушение ───────────────────────────────────────────
// Выбивает ячейку и её соседей по радиусу поражения. power — урон снаряда.
function damage(o, id, power){
  const n=o.n;
  const rad = Math.max(0, Math.min(3, Math.floor(power/CELL_HP)));   // радиус выемки в ячейках
  const i0=(id/(n*n))|0, j0=((id/n)|0)%n, k0=id%n;
  let killed = 0;
  for (let di=-rad; di<=rad; di++)
  for (let dj=-rad; dj<=rad; dj++)
  for (let dk=-rad; dk<=rad; dk++){
    if (Math.hypot(di,dj,dk) > rad+0.35) continue;
    const i=i0+di, j=j0+dj, k=k0+dk;
    if (i<0||j<0||k<0||i>=n||j>=n||k>=n) continue;
    const cid=(i*n+j)*n+k;
    if (!o.cells[cid]) continue;
    o.hp[cid] -= power/(1+Math.hypot(di,dj,dk));
    if (o.hp[cid] <= 0){ clearCell(o, cid); killed++; }
  }
  // ⚠️ РАДИУС НЕ ПЕРЕСЧИТЫВАЕМ НА КАЖДОЕ ПОПАДАНИЕ: это обход всех живых ячеек,
  // а попаданий в секунду бывают десятки. Обновляем в шаге, не чаще двух раз в
  // секунду — на столкновения такой лаг не влияет.
  if (killed){ o.dirty = true; o.rDirty = true; }
  return killed;
}

// Гашение ячейки: инстанс не удаляем (это перестройка буфера), а схлопываем
// последний живой слот на его место — так mesh.count просто уменьшается на 1.
function clearCell(o, id){
  tmp();
  const s0 = o.slot[id];
  if (s0 < 0) return;
  const swap = (a,b)=>{
    if (a===b) return;
    const ia=o.idOf[a], ib=o.idOf[b];
    o.mesh.getMatrixAt(a, _m);
    const mb = new THREE.Matrix4(); o.mesh.getMatrixAt(b, mb);
    o.mesh.setMatrixAt(a, mb); o.mesh.setMatrixAt(b, _m);
    o.idOf[a]=ib; o.idOf[b]=ia;
    if (ia>=0) o.slot[ia]=b;
    if (ib>=0) o.slot[ib]=a;
  };
  let s = s0;
  if (s < o.vis){                       // была видимой — уводим в скрытую зону
    swap(s, o.vis-1); o.vis--; s = o.vis;
    o.mesh.count = o.vis;
  }
  swap(s, o.total-1); o.total--;        // и выкидываем в самый конец
  o.cells[id] = 0; o.slot[id] = -1; o.idOf[o.total] = -1;
  o.count--;
  o.mesh.instanceMatrix.needsUpdate = true;
  if (o.count <= 0){ o.dead = true; return; }

  // открываем соседей, которые только что перестали быть внутренними
  const n=o.n;
  const i=(id/(n*n))|0, j=((id/n)|0)%n, k=id%n;
  const show=(a,b,c)=>{
    if (a<0||b<0||c<0||a>=n||b>=n||c>=n) return;
    const t=(a*n+b)*n+c;
    if (!o.cells[t]) return;
    const st2=o.slot[t];
    if (st2 < o.vis) return;            // уже видима
    swap(st2, o.vis); o.vis++;
    o.mesh.count = o.vis;
  };
  show(i+1,j,k); show(i-1,j,k); show(i,j+1,k); show(i,j-1,k); show(i,j,k+1); show(i,j,k-1);
}

// ── §4. Дробление ────────────────────────────────────────────
// Обход по связности: если оставшиеся ячейки распались на несколько кусков —
// каждый становится САМОСТОЯТЕЛЬНЫМ обломком и разлетается. Это и есть «разбил
// пополам»: половинки уходят в стороны, а не висят призраком одного тела.
function split(o, scene){
  o.dirty = false;
  if (o.dead || o.count < 2) return null;
  const n=o.n, seen = new Uint8Array(n*n*n), parts = [];
  const stack = [];
  for (let id=0; id<o.cells.length; id++){
    if (!o.cells[id] || seen[id]) continue;
    const part = [];
    stack.length = 0; stack.push(id); seen[id]=1;
    while (stack.length){
      const q = stack.pop(); part.push(q);
      const i=(q/(n*n))|0, j=((q/n)|0)%n, k=q%n;
      const push=(a,b,c)=>{ if(a<0||b<0||c<0||a>=n||b>=n||c>=n) return;
        const t=(a*n+b)*n+c; if (o.cells[t] && !seen[t]){ seen[t]=1; stack.push(t); } };
      push(i+1,j,k); push(i-1,j,k); push(i,j+1,k); push(i,j-1,k); push(i,j,k+1); push(i,j,k-1);
    }
    parts.push(part);
  }
  if (parts.length < 2) return null;

  // куски крупнее трёх ячеек живут дальше; мелочь просто осыпается
  const out = [];
  const c=(n-1)/2;
  parts.forEach(part=>{
    if (part.length < 5) { part.forEach(id=>clearCell(o,id)); return; }
    const cells = new Uint8Array(n*n*n), hp = new Float32Array(n*n*n);
    let cx=0, cy=0, cz=0;
    part.forEach(id=>{
      cells[id]=1; hp[id]=o.hp[id];
      const i=(id/(n*n))|0, j=((id/n)|0)%n, k=id%n;
      cx+=i; cy+=j; cz+=k;
    });
    cx/=part.length; cy/=part.length; cz/=part.length;
    const p = new THREE.Object3D();
    const nb = build(scene, o.pos, n, o.cs, cells, hp, part.length, o.seed+part.length);
    nb.q.copy(o.q); nb.mesh.quaternion.copy(o.q);
    // разлёт: от центра исходного камня к центру своего куска
    const away = V((cx-c), (cy-c), (cz-c)).applyQuaternion(o.q);
    if (away.lengthSq()<1e-6) away.set(rnd(o.seed)-0.5, rnd(o.seed+3)-0.5, rnd(o.seed+5)-0.5);
    nb.vel.copy(o.vel).addScaledVector(away.normalize(), 6 + Math.random()*8);
    nb.spin.set(o.spin.x + (Math.random()-0.5)*0.2, o.spin.y + (Math.random()-0.5)*0.2, o.spin.z + (Math.random()-0.5)*0.2);
    out.push(nb);
  });
  o.dead = true;
  scene.remove(o.mesh);
  return out;
}

// ── §5. Шаг ──────────────────────────────────────────────────
function step(o, dt){
  if (o.dead) return;
  tmp();
  o.rT = (o.rT||0) - dt;
  if (o.rDirty && o.rT<=0){ o.r = radiusOf(o); o.rDirty=false; o.rT=0.5; }
  o.pos.addScaledVector(o.vel, dt);
  o.vel.multiplyScalar(Math.max(0, 1-dt*0.12));      // осколки понемногу гаснут
  _dq.setFromEuler(new THREE.Euler(o.spin.x*dt, o.spin.y*dt, o.spin.z*dt));
  o.q.multiply(_dq).normalize();
  o.mesh.position.copy(o.pos);
  o.mesh.quaternion.copy(o.q);
}

function dispose(o, scene){ scene.remove(o.mesh); o.mesh.geometry.dispose(); o.dead=true; }

return { make:make, raycast:raycast, damage:damage, split:split, step:step,
         dispose:dispose, CELL_HP:CELL_HP };
})();
