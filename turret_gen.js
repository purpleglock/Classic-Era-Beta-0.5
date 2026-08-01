// © 2025–2026 Setis241. Проприетарное ПО. См. LICENSE.
// ════════════════════════════════════════════════════════════
// TURRET GEN v3 — процедурный визуализатор орудий (вид сверху)
// ────────────────────────────────────────────────────────────
// §5  ПЛАТФОРМЫ 1..8 — каждая своя геометрия, не вариации одной.
// §6  ВООРУЖЕНИЕ — отдельный рисовальщик на каждую технологию:
//     ствол / рельсовая пара / волновод / плазменный раструб / ПУ.
// §7  БАШНЯ — силуэт по семейству класса: корабль ≠ БТР ≠ танк ≠
//     арта ≠ ПВО ≠ дрон (форма корпуса + своё навесное).
// Экипажа нет — везде 0.
// Каждая плита несёт data-slot="<материал>" под подмену текстуры.
// Экспорт: window.TG
// ════════════════════════════════════════════════════════════
window.TG = (function () {
'use strict';

// ── §1. Справочники ──────────────────────────────────────────
// Названия — по ГЕОМЕТРИИ основания, а не по классу носителя: любую
// платформу можно поставить под любой класс орудия.
const PLATFORMS = {
  '1':'1 — Кольцевой барбет',
  '2':'2 — Секторный барбет',
  '3':'3 — Опорный редан',
  '4':'4 — Малое кольцо на скосе',
  '5':'5 — Продольная плита',
  '6':'6 — Блочный каземат',
  '7':'7 — Вилочный пилон',
  '8':'8 — Ротор с противовесом',
};
const TECHS = {
  // pw — множитель энергопотребления, dl — множитель дальности (оба
  // относительно ЭХС того же класса). Лазер на кораблях даёт ровно ×2
  // дальности — это прямо видно в каталоге (3 АсК у ЭХС против 6 у лазера).
  kinetic: { pw:0.7, dl:0.85, ru:'Кинетическое',      glow:'#ffb066', kind:'gun',      kvTech:'кинетическое',         kvDmg:'кинетический' },
  ehs:     { pw:1.0, dl:1.00, ru:'Электрохимическое', glow:'#ffc98a', kind:'ehs',      kvTech:'электрохимическое',    kvDmg:'электрохимическая система' },
  rail:    { pw:2.4, dl:1.10, ru:'Рельсотрон',        glow:'#7fe0ff', kind:'rail',     kvTech:'рельсотрон',           kvDmg:'рельсотрон' },
  em:      { pw:2.6, dl:1.50, ru:'Электромагнитное',  glow:'#a9b6ff', kind:'coil',     kvTech:'электромагнитное',     kvDmg:'электрохимическая система' },
  laser:   { pw:2.0, dl:2.00, ru:'Лазер',             glow:'#66e8ff', kind:'beam',     kvTech:'лазер',                kvDmg:'импульсный лазер' },
  plasma:  { pw:1.6, dl:0.40, ru:'Плазма',            glow:'#ff7be0', kind:'plasma',   kvTech:'плазма',               kvDmg:'термический' },
  missile: { pw:0.5, dl:1.80, ru:'Ракетное / ПУ',     glow:'#ff8a5c', kind:'launcher', kvTech:'управляемое наведение',kvDmg:'взрывной' },
  // ── остальные технологии каталога ──────────────────────────
  explos:  { pw:0.4, dl:1.60, ru:'Взрывчатое (реактивное)', glow:'#ff9a4d', kind:'launcher', kvTech:'взрывчатое',      kvDmg:'взрывной' },
  nano:    { pw:1.5, dl:1.20, ru:'Нанотехнологии',     glow:'#9dffc7', kind:'nano',   kvTech:'нанотехнологии',       kvDmg:'кинетический' },
  ew:      { pw:1.2, dl:2.40, ru:'Электронное подавл.',glow:'#66d0ff', kind:'array',  kvTech:'электронное подавление',kvDmg:'разведка' },
  grav:    { pw:2.8, dl:1.60, ru:'Гравитационное',     glow:'#b98bff', kind:'exotic', kvTech:'гравитационное',       kvDmg:'гравитационный' },
  anti:    { pw:3.4, dl:1.50, ru:'Антиматериальное',   glow:'#ff5ea8', kind:'exotic', kvTech:'антиматериальное',     kvDmg:'антимат' },
};
// fam — семейство силуэта башни
const CLASSES = {
  // kvClass — ТОЧНОЕ имя класса из каталога. У корабельных классов и
  // дрон-пушки в KV.classCoefficients записи НЕТ, и игра берёт для них 1 —
  // подставлять сюда «похожий» класс с коэффициентом 2.4 нельзя, это
  // завышало бы урон корабельных орудий в 2-3 раза против боёвки.
  aa:      { ru:'ПВО / зенитное',      s:0.75, fam:'aa',    kvClass:'турель ПВО' },
  light:   { ru:'Лёгкое корабельное',  s:0.95, fam:'shipL', kvClass:'легкое корабельное орудие' },
  medium:  { ru:'Среднее корабельное', s:1.25, fam:'shipM', kvClass:'среднее корабельное орудие' },
  heavy:   { ru:'Тяжёлое корабельное', s:1.70, fam:'shipH', kvClass:'тяжелое корабельное орудие' },
  super:   { ru:'Супероружие',         s:2.20, fam:'shipS', kvClass:'супероружие' },
  tankgun: { ru:'Танковая пушка',      s:1.00, fam:'tank',  kvClass:'танковая пушка' },
  arty:    { ru:'Арторудие',           s:1.45, fam:'arty',  kvClass:'арторудие' },
  apc:     { ru:'Турель БТР',          s:0.70, fam:'apc',   kvClass:'турель бтр' },
  air:     { ru:'Авиационное/курсовое',s:0.60, fam:'drone', kvClass:'авиапушка' },
  drone:   { ru:'Дрон-пушка',          s:0.50, fam:'drone', kvClass:'дрон-пушка' },
  // ── остальные классы-установки каталога ────────────────────
  mg:      { ru:'Пулемёт (станок)',    s:0.55, fam:'apc',   kvClass:'пулемет' },
  hw:      { ru:'Тяжёлое вооружение',  s:0.65, fam:'apc',   kvClass:'тяжелое вооружение' },
  howitz:  { ru:'Гаубица',             s:1.60, fam:'arty',  kvClass:'гаубица' },
  // Пусковые — своё семейство силуэта: рама-качалка с пакетом, а не
  // артиллерийский станок с противооткатниками.
  rsu:     { ru:'РСУ (реактивная)',    s:1.50, fam:'mlrs',  kvClass:'рсу' },
  rpu:     { ru:'РПУ (пусковая)',      s:1.20, fam:'pu',    kvClass:'рпу' },
  brm:     { ru:'Баллистическая ракета',s:1.90,fam:'silo',  kvClass:'баллистическая ракета' },
};
// minBarrels — компоновка физически бессмысленна ниже этого числа стволов.
// Спарки из одного ствола не бывает, блока 2×N — тоже.
// ── ПРАВИЛА СОВМЕСТИМОСТИ ────────────────────────────────────
// Что физически может стоять на установке этого класса и в каких
// габаритах. cal — калибр, мм; len — длина ствола, клб; techs — белый
// список технологий. Границы заданы под боевую карту: чем дальше бьёт
// класс, тем крупнее калибр ему разрешён (дальность растёт от калибра
// и длины, поэтому потолки — это и есть потолки дальности класса).
const CLASS_RULES = {
  // мелкие установки
  mg:      { cal:[5,20],    len:[20,70],  techs:['kinetic','ehs'] },
  hw:      { cal:[20,60],   len:[20,60],  techs:['kinetic','ehs','rail','laser','plasma'] },
  drone:   { cal:[5,30],    len:[20,60],  techs:['kinetic','ehs','rail','laser','plasma'] },
  air:     { cal:[12,75],   len:[30,80],  techs:['kinetic','ehs','rail','laser','plasma','missile'] },
  apc:     { cal:[15,90],   len:[25,70],  techs:['kinetic','ehs','rail','laser','plasma'] },
  aa:      { cal:[12,60],   len:[30,80],  techs:['kinetic','ehs','laser','missile','ew'] },
  // наземные орудия
  tankgun: { cal:[40,180],  len:[30,70],  techs:['kinetic','ehs','rail','em','laser','plasma'] },
  arty:    { cal:[76,350],  len:[30,60],  techs:['ehs','em','rail','explos','kinetic'] },
  howitz:  { cal:[100,420], len:[15,45],  techs:['ehs','explos','em'] },
  // реактивные и ракетные — только пусковые технологии
  rpu:     { cal:[60,300],  len:[15,40],  techs:['missile','explos'] },
  rsu:     { cal:[60,250],  len:[15,35],  techs:['missile','explos'] },
  brm:     { cal:[250,500], len:[10,30],  techs:['missile','explos','anti'] },
  // корабельные
  light:   { cal:[40,140],  len:[30,90],  techs:['kinetic','ehs','rail','laser','plasma','ew','missile'] },
  medium:  { cal:[90,260],  len:[30,90],  techs:['ehs','rail','em','laser','plasma','nano','ew','missile'] },
  heavy:   { cal:[180,420], len:[35,100], techs:['ehs','rail','em','laser','plasma','nano','ew','grav'] },
  super:   { cal:[300,500], len:[40,110], techs:['ehs','rail','em','laser','nano','anti','grav'] },
};
function rulesOf(klass){ return CLASS_RULES[klass] || CLASS_RULES.medium; }
function allowedTechs(klass){ return rulesOf(klass).techs.slice(); }
// Приводит конфиг к допустимому: чинит технологию и зажимает габариты.
// Зовётся и из render, и из stats — картинка и числа обязаны совпадать.
function normalize(input){
  const cfg=Object.assign({},DEFAULTS,input||{});
  if(!CLASSES[cfg.klass]) cfg.klass='medium';
  const R=rulesOf(cfg.klass);
  if(R.techs.indexOf(cfg.tech)<0) cfg.tech=R.techs[0];
  cfg.caliber   = Math.max(R.cal[0], Math.min(R.cal[1], +cfg.caliber||R.cal[0]));
  cfg.barrelLen = Math.max(R.len[0], Math.min(R.len[1], +cfg.barrelLen||R.len[0]));
  cfg.barrels   = Math.max(1, Math.min(8, cfg.barrels|0));
  // Масштаб — свободный множитель массы (степень 1.4), а масса тянет за собой
  // урон. Зажимаем теми же границами, что и ползунок верстака, — иначе через
  // прямой вызов stats() можно было бы «раздуть» орудие мимо всех потолков.
  // ЗЕРКАЛО: _tg_norm в _turret_forge.sql.
  cfg.size      = Math.max(0.4, Math.min(3, +cfg.size||1));
  return cfg;
}

const LAYOUTS = { row:'В ряд', stacked:'Спарка (одна над другой)', quad:'Блок 2×N', rotary:'Роторный блок' };
const LAYOUT_MIN = { row:1, stacked:2, quad:4, rotary:3 };
// ЕДИНАЯ точка правды по компоновке. И геометрия, и темп, и дальность
// обязаны звать её — иначе выходит расхождение: картинка меняется, а
// числа нет (или наоборот).
function effLayout(cfg){
  const l=cfg.layout||'row', n=Math.max(1,(cfg.barrels|0)||1);
  return n < (LAYOUT_MIN[l]||1) ? 'row' : l;
}
const MATS = {
  hull:    { ru:'Корпус башни',     base:'#4a5058' },
  plate:   { ru:'Броневые плиты',   base:'#3d434b' },
  barrel:  { ru:'Стволы',           base:'#3a3f47' },
  base:    { ru:'Платформа',        base:'#42474f' },
  greeble: { ru:'Навесное',         base:'#565d66' },
  glass:   { ru:'Оптика/линзы',     base:'#2a6f86' },
};
const DEFAULTS = {
  platform:'1', tech:'ehs', klass:'medium', layout:'row',
  caliber:150, barrels:2, barrelLen:55, size:1.0,
  rof:0, power:0,
  yaw:0, detail:0.6, seed:1337,
  tint:'#4a5058', accent:'#c9a24b', textures:{},
};

// ── §2. Утиль ────────────────────────────────────────────────
function rng(seed){ let s=(seed>>>0)||1;
  return ()=>{ s^=s<<13; s>>>=0; s^=s>>17; s^=s<<5; s>>>=0; return s/4294967296; }; }
const n2 = v => Math.round(v*100)/100;
const P   = pts => pts.map(p=>n2(p[0])+' '+n2(p[1])).join(' L ');
const poly= pts => 'M '+P(pts)+' Z';
const rect= (x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];

function chamfer(pts,c){
  const out=[], n=pts.length;
  for(let i=0;i<n;i++){
    const p=pts[i], a=pts[(i-1+n)%n], b=pts[(i+1)%n];
    const va=[a[0]-p[0],a[1]-p[1]], vb=[b[0]-p[0],b[1]-p[1]];
    const la=Math.hypot(va[0],va[1])||1, lb=Math.hypot(vb[0],vb[1])||1;
    const ca=Math.min(c,la*0.45), cb=Math.min(c,lb*0.45);
    out.push([p[0]+va[0]/la*ca,p[1]+va[1]/la*ca]);
    out.push([p[0]+vb[0]/lb*cb,p[1]+vb[1]/lb*cb]);
  }
  return out;
}
function inset(pts,d){
  let cx=0,cy=0; for(const p of pts){cx+=p[0];cy+=p[1];} cx/=pts.length; cy/=pts.length;
  let r=0; for(const p of pts) r=Math.max(r,Math.hypot(p[0]-cx,p[1]-cy));
  const k=Math.max(0.02,1-d/(r||1));
  return pts.map(p=>[cx+(p[0]-cx)*k, cy+(p[1]-cy)*k]);
}
const shift = (pts,dx,dy)=>pts.map(p=>[p[0]+dx,p[1]+dy]);

// ── §3. Палитра ──────────────────────────────────────────────
function hex2rgb(h){ h=String(h).replace('#',''); if(h.length===3)h=h.split('').map(c=>c+c).join('');
  return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
function rgb2hex(a){ return '#'+a.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join(''); }
function mix(a,b,t){ const A=hex2rgb(a),B=hex2rgb(b); return rgb2hex([0,1,2].map(i=>A[i]+(B[i]-A[i])*t)); }
function shade(c,k){ const A=hex2rgb(c); return rgb2hex(A.map(v=> k>0 ? v+(255-v)*k : v*(1+k))); }
const LIGHT = { x:-0.55, y:-0.83 };

function buildDefs(cfg){
  const tech=TECHS[cfg.tech]||TECHS.ehs;
  let d='';
  for(const k in MATS){
    const base=mix(MATS[k].base,cfg.tint,0.55);
    d += `<linearGradient id="m_${k}" x1="0.15" y1="0" x2="0.88" y2="1">`
       + `<stop offset="0" stop-color="${shade(base,0.34)}"/><stop offset="0.40" stop-color="${base}"/>`
       + `<stop offset="1" stop-color="${shade(base,-0.40)}"/></linearGradient>`
       + `<linearGradient id="d_${k}" x1="0.1" y1="0" x2="0.85" y2="1">`
       + `<stop offset="0" stop-color="${shade(base,-0.22)}"/><stop offset="1" stop-color="${shade(base,-0.62)}"/></linearGradient>`
       + `<linearGradient id="s_${k}" x1="0" y1="0" x2="0.6" y2="1">`
       + `<stop offset="0" stop-color="${shade(base,-0.55)}"/><stop offset="1" stop-color="${shade(base,-0.80)}"/></linearGradient>`
       + `<linearGradient id="b_${k}" x1="0.1" y1="0" x2="0.9" y2="1">`
       + `<stop offset="0" stop-color="${shade(base,0.52)}"/><stop offset="0.55" stop-color="${shade(base,0.06)}"/>`
       + `<stop offset="1" stop-color="${shade(base,-0.34)}"/></linearGradient>`;
    if(cfg.textures && cfg.textures[k])
      d += `<pattern id="t_${k}" patternUnits="userSpaceOnUse" width="256" height="256">`
         + `<image href="${cfg.textures[k]}" width="256" height="256" preserveAspectRatio="xMidYMid slice"/></pattern>`;
  }
  d += `<radialGradient id="glow"><stop offset="0" stop-color="${tech.glow}" stop-opacity="0.95"/>`
     + `<stop offset="0.4" stop-color="${tech.glow}" stop-opacity="0.32"/>`
     + `<stop offset="1" stop-color="${tech.glow}" stop-opacity="0"/></radialGradient>`
     + `<radialGradient id="core"><stop offset="0" stop-color="#fff" stop-opacity="0.9"/>`
     + `<stop offset="0.35" stop-color="${tech.glow}" stop-opacity="0.85"/>`
     + `<stop offset="1" stop-color="${tech.glow}" stop-opacity="0"/></radialGradient>`
     + `<linearGradient id="spec" x1="0" y1="0" x2="0" y2="1">`
     + `<stop offset="0" stop-color="#fff" stop-opacity="0.34"/><stop offset="0.75" stop-color="#fff" stop-opacity="0.03"/>`
     + `<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`
     + `<pattern id="grille" patternUnits="userSpaceOnUse" width="5" height="5">`
     + `<rect width="5" height="5" fill="#181c21"/><rect width="5" height="2.4" y="1.3" fill="#3a4149"/></pattern>`
     + `<pattern id="mesh" patternUnits="userSpaceOnUse" width="7" height="7">`
     + `<rect width="7" height="7" fill="#14181d"/>`
     + `<path d="M0 0L7 7M7 0L0 7" stroke="#454d56" stroke-width="1"/></pattern>`;
  return `<defs>${d}</defs>`;
}

// ── §4. Примитивы ────────────────────────────────────────────
const INK='#0b0d10';
// Толщина обводки масштабируется под калибр: при bw=4 фиксированные 2px
// съедали всю геометрию, и мелкие орудия читались чёрным пятном.
let SWK=1;
function plate(pts,mat,o){
  o=o||{};
  const fill=o.flat||(o.dark?`url(#d_${mat})`:`url(#m_${mat})`);
  return `<path d="${poly(pts)}" fill="${fill}" stroke="${INK}" stroke-width="${n2((o.sw!=null?o.sw:1.8)*SWK)}"`
       + ` stroke-linejoin="round" data-slot="${mat}"${o.op?` opacity="${o.op}"`:''}/>`;
}
// Объёмная плита: тень → боковины экструзии → фаска → верхняя грань
function solid(pts,mat,h,o){
  o=o||{};
  const dx=-LIGHT.x*h*0.62, dy=-LIGHT.y*h*0.62;
  let s='';
  if(!o.noShadow) s+=`<path d="${poly(shift(pts,dx*1.5,dy*1.5))}" fill="#000" opacity="0.30"/>`;
  const n=pts.length;
  for(let i=0;i<n;i++){
    const p=pts[i], q=pts[(i+1)%n];
    const ex=q[0]-p[0], ey=q[1]-p[1], el=Math.hypot(ex,ey)||1;
    if((ey/el)*LIGHT.x + (-ex/el)*LIGHT.y > -0.05) continue;
    s+=`<path d="${poly([p,q,[q[0]+dx,q[1]+dy],[p[0]+dx,p[1]+dy]])}" fill="url(#s_${mat})"`
      +` stroke="${INK}" stroke-width="${n2(1.2*SWK)}" stroke-linejoin="round" data-slot="${mat}"/>`;
  }
  s+=`<path d="${poly(pts)}" fill="url(#b_${mat})" stroke="${INK}" stroke-width="${n2((o.sw||2.0)*SWK)}"`
    +` stroke-linejoin="round" data-slot="${mat}"/>`;
  s+=`<path d="${poly(inset(pts,Math.max(1.2,h*0.42)))}" fill="${o.dark?`url(#d_${mat})`:`url(#m_${mat})`}"`
    +` stroke="${INK}" stroke-width="${n2(1.1*SWK)}" stroke-linejoin="round" opacity="0.97" data-slot="${mat}"/>`;
  return s;
}
const tube = (x,y,r,mat)=>
  `<circle cx="${n2(x+r*0.22)}" cy="${n2(y+r*0.3)}" r="${n2(r)}" fill="#000" opacity="0.3"/>`
 +`<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r)}" fill="url(#b_${mat})" stroke="${INK}" stroke-width="${n2(1.8*SWK)}" data-slot="${mat}"/>`
 +`<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r*0.72)}" fill="url(#m_${mat})" stroke="${INK}" stroke-width="${n2(1.1*SWK)}" data-slot="${mat}"/>`;
function line(pts,w,op){
  return `<path d="M ${P(pts)}" fill="none" stroke="${INK}" stroke-width="${n2((w||1.1)*SWK)}"`
       + ` stroke-linecap="round" opacity="${op==null?0.5:op}"/>`;
}
function bolts(pts,r,step){
  let s='';
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i],b=pts[i+1],L=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const n=Math.max(1,Math.round(L/step));
    for(let j=0;j<=n;j++){const t=j/n;
      s+=`<circle cx="${n2(a[0]+(b[0]-a[0])*t)}" cy="${n2(a[1]+(b[1]-a[1])*t)}" r="${n2(r)}" fill="${INK}" opacity="0.55"/>`;}
  }
  return s;
}
const panel=(x,y,w,h,fill)=>`<path d="${poly(chamfer(rect(x,y,w,h),Math.min(w,h)*0.18))}" fill="${fill}"`
  +` stroke="${INK}" stroke-width="${n2(1.4*SWK)}" stroke-linejoin="round"/>`;
const grille = (x,y,w,h)=>panel(x,y,w,h,'url(#grille)');
const basket = (x,y,w,h)=>panel(x,y,w,h,'url(#mesh)');

// ── §5. ПЛАТФОРМЫ 1..8 ───────────────────────────────────────
const PLAT = {
  // 1 — кольцевой барбет: зубчатый погон, болтовой венец
  '1'(cfg,G){ const R=G.R; let s='';
    s+=`<circle cx="0" cy="0" r="${n2(R*1.05)}" fill="#000" opacity="0.3"/>`;
    s+=`<circle cx="0" cy="0" r="${n2(R)}" fill="url(#b_base)" stroke="${INK}" stroke-width="${n2(2.4*SWK)}" data-slot="base"/>`;
    s+=`<circle cx="0" cy="0" r="${n2(R*0.955)}" fill="url(#m_base)" stroke="${INK}" stroke-width="${n2(1.4*SWK)}" data-slot="base"/>`;
    const N=Math.max(20,Math.round(R/5.5));
    for(let i=0;i<N;i++){ const a=i/N*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a);
      const r0=R*0.795,r1=R*0.935,w=R*Math.PI/N*0.52;
      s+=`<path d="${poly([[r0*ca+sa*w,r0*sa-ca*w],[r1*ca+sa*w,r1*sa-ca*w],[r1*ca-sa*w,r1*sa+ca*w],[r0*ca-sa*w,r0*sa+ca*w]])}"`
        +` fill="url(#d_base)" stroke="${INK}" stroke-width="${n2(0.9*SWK)}" data-slot="base"/>`; }
    s+=`<circle cx="0" cy="0" r="${n2(R*0.775)}" fill="url(#d_base)" stroke="${INK}" stroke-width="${n2(2*SWK)}" data-slot="base"/>`;
    const M=Math.max(8,Math.round(R/26));
    for(let i=0;i<M;i++){const a=i/M*Math.PI*2+0.2,rr=R*0.885;
      s+=`<circle cx="${n2(Math.cos(a)*rr)}" cy="${n2(Math.sin(a)*rr)}" r="${n2(R*0.028)}" fill="${INK}" opacity="0.7"/>`;}
    return s; },

  // 2 — секторный барбет: 4 бронесектора с радиальными швами и люками
  '2'(cfg,G){ const R=G.R; let s='';
    s+=`<circle cx="0" cy="0" r="${n2(R*1.04)}" fill="#000" opacity="0.3"/>`;
    for(let i=0;i<4;i++){
      const a0=i/4*Math.PI*2+0.10, a1=(i+1)/4*Math.PI*2-0.10, pts=[];
      for(let t=0;t<=8;t++){const a=a0+(a1-a0)*t/8; pts.push([Math.cos(a)*R,Math.sin(a)*R]);}
      for(let t=8;t>=0;t--){const a=a0+(a1-a0)*t/8; pts.push([Math.cos(a)*R*0.62,Math.sin(a)*R*0.62]);}
      s+=solid(pts,'base',G.bw*0.40,{noShadow:1,sw:2.0});
      const am=(a0+a1)/2;
      s+=panel(Math.cos(am)*R*0.80-R*0.07, Math.sin(am)*R*0.80-R*0.07, R*0.14,R*0.14,'url(#d_base)');
    }
    s+=`<circle cx="0" cy="0" r="${n2(R*0.62)}" fill="url(#d_base)" stroke="${INK}" stroke-width="${n2(2.2*SWK)}" data-slot="base"/>`;
    s+=`<circle cx="0" cy="0" r="${n2(R*0.50)}" fill="none" stroke="${INK}" stroke-width="${n2(1.2*SWK)}" opacity="0.5"/>`;
    return s; },

  // 3 — палубный редан: восьмиугольная плита на угловых опорах + трап
  '3'(cfg,G){ const R=G.R*1.12; let s='';
    for(let i=0;i<4;i++){ const a=i/4*Math.PI*2+Math.PI/4;
      s+=solid(chamfer(rect(Math.cos(a)*R*0.86-R*0.13, Math.sin(a)*R*0.86-R*0.13, R*0.26,R*0.26),R*0.06),'greeble',G.bw*0.55); }
    const pts=[]; for(let i=0;i<8;i++){const a=i/8*Math.PI*2+Math.PI/8; pts.push([Math.cos(a)*R,Math.sin(a)*R]);}
    s+=solid(pts,'base',G.bw*0.75);
    s+=line([[-R*0.7,-R*0.30],[R*0.7,-R*0.30]],1.3,0.4)+line([[-R*0.7,R*0.30],[R*0.7,R*0.30]],1.3,0.4);
    s+=bolts([[-R*0.66,-R*0.30],[R*0.66,-R*0.30]],R*0.018,R*0.15);
    // трап
    s+=plate(rect(-R*1.24,-R*0.20,R*0.34,R*0.40),'greeble',{dark:true});
    for(let i=0;i<4;i++) s+=line([[-R*1.22+i*R*0.08,-R*0.19],[-R*1.22+i*R*0.08,R*0.19]],1.2,0.6);
    s+=`<circle cx="0" cy="0" r="${n2(R*0.60)}" fill="url(#d_base)" stroke="${INK}" stroke-width="${n2(2*SWK)}" data-slot="base"/>`;
    return s; },

  // 4 — погон БТР: малое кольцо на скошенном корпусе с крыльями
  '4'(cfg,G){ const R=G.R; let s='';
    s+=solid(chamfer([[-R*1.05,-R*0.60],[-R*0.75,-R*0.86],[R*0.80,-R*0.78],[R*1.10,-R*0.34],
                      [R*1.10,R*0.34],[R*0.80,R*0.78],[-R*0.75,R*0.86],[-R*1.05,R*0.60]],R*0.13),'base',G.bw*0.62);
    for(const sg of [-1,1]) s+=plate(rect(-R*0.60,sg*R*0.70-(sg>0?0:R*0.13),R*1.25,R*0.13),'greeble',{dark:true,sw:1.2});
    s+=grille(R*0.30,-R*0.28,R*0.42,R*0.56);
    s+=panel(-R*0.92,-R*0.20,R*0.24,R*0.40,'url(#d_base)');
    s+=`<circle cx="0" cy="0" r="${n2(R*0.70)}" fill="url(#b_base)" stroke="${INK}" stroke-width="${n2(2.2*SWK)}" data-slot="base"/>`;
    s+=`<circle cx="0" cy="0" r="${n2(R*0.60)}" fill="url(#d_base)" stroke="${INK}" stroke-width="${n2(1.6*SWK)}" data-slot="base"/>`;
    const M=14; for(let i=0;i<M;i++){const a=i/M*Math.PI*2,rr=R*0.65;
      s+=`<circle cx="${n2(Math.cos(a)*rr)}" cy="${n2(Math.sin(a)*rr)}" r="${n2(R*0.022)}" fill="${INK}" opacity="0.7"/>`;}
    return s; },

  // 5 — крыша танка: длинная плита, МТО-решётка, люки, поручни
  '5'(cfg,G){ const L=G.R*2.5,H=G.R*1.75; let s='';
    s+=solid(chamfer([[-L*0.52,-H*0.40],[-L*0.41,-H*0.50],[L*0.43,-H*0.50],[L*0.52,-H*0.30],
                      [L*0.52,H*0.30],[L*0.43,H*0.50],[-L*0.41,H*0.50],[-L*0.52,H*0.40]],G.R*0.12),'base',G.bw*0.66);
    s+=grille(-L*0.48,-H*0.34,L*0.20,H*0.68);
    s+=panel(L*0.30,-H*0.36,L*0.16,H*0.30,'url(#d_base)');
    s+=panel(L*0.30, H*0.06,L*0.16,H*0.30,'url(#d_base)');
    s+=line([[-L*0.24,-H*0.44],[L*0.26,-H*0.44]],1.3,0.4)+line([[-L*0.24,H*0.44],[L*0.26,H*0.44]],1.3,0.4);
    for(const sg of [-1,1])
      s+=`<path d="M ${n2(-L*0.18)} ${n2(sg*H*0.47)} L ${n2(L*0.06)} ${n2(sg*H*0.47)}" fill="none"`
        +` stroke="${INK}" stroke-width="${n2(G.bw*0.16)}" stroke-linecap="round" opacity="0.8"/>`;
    s+=bolts([[-L*0.44,-H*0.26],[L*0.44,-H*0.26]],G.R*0.017,G.R*0.14);
    s+=`<circle cx="0" cy="0" r="${n2(G.R*0.84)}" fill="url(#d_base)" stroke="${INK}" stroke-width="${n2(2*SWK)}" data-slot="base"/>`;
    return s; },

  // 6 — стационарный каземат: массивный блок, анкеры, кабельный лоток, ступени
  '6'(cfg,G){ const R=G.R*1.16; let s='';
    s+=solid(chamfer([[-R,-R*0.82],[-R*0.70,-R],[R*0.70,-R],[R,-R*0.82],
                      [R,R*0.82],[R*0.70,R],[-R*0.70,R],[-R,R*0.82]],R*0.16),'base',G.bw*1.05);
    for(const sx of [-1,1]) for(const sy of [-1,1])
      s+=tube(sx*R*0.76, sy*R*0.66, R*0.09,'greeble');
    s+=solid(chamfer(rect(-R*1.42,-R*0.19,R*0.52,R*0.38),R*0.07),'greeble',G.bw*0.5);
    for(let i=0;i<5;i++) s+=line([[-R*1.38+i*R*0.10,-R*0.17],[-R*1.38+i*R*0.10,R*0.17]],1.3,0.6);
    s+=grille(-R*0.30,-R*0.86,R*0.60,R*0.20);
    s+=grille(-R*0.30, R*0.66,R*0.60,R*0.20);
    s+=`<circle cx="0" cy="0" r="${n2(G.R*0.80)}" fill="url(#d_base)" stroke="${INK}" stroke-width="${n2(2.2*SWK)}" data-slot="base"/>`;
    s+=`<circle cx="0" cy="0" r="${n2(G.R*0.66)}" fill="none" stroke="${INK}" stroke-width="${n2(1.2*SWK)}" opacity="0.5"/>`;
    return s; },

  // 7 — пилон дрона: вилка из двух лонжеронов, без плиты
  '7'(cfg,G){ const R=G.R; let s='';
    for(const sg of [-1,1])
      s+=solid(chamfer([[-R*1.30,sg*R*0.10],[-R*0.30,sg*R*0.40],[R*0.34,sg*R*0.36],
                        [R*0.34,sg*R*0.14],[-R*0.34,sg*R*0.16],[-R*1.26,sg*R*0.34]],R*0.07),'base',G.bw*0.36);
    s+=solid(chamfer(rect(-R*0.40,-R*0.30,R*0.80,R*0.60),R*0.14),'base',G.bw*0.50);
    s+=`<circle cx="0" cy="0" r="${n2(R*0.34)}" fill="url(#d_base)" stroke="${INK}" stroke-width="${n2(1.8*SWK)}" data-slot="base"/>`;
    s+=tube(-R*1.16,0,R*0.13,'greeble');
    return s; },

  // 8 — ротор с противовесом: кольцо + вынесенная кормовая консоль
  '8'(cfg,G){ const R=G.R; let s='';
    s+=solid(chamfer(rect(-R*1.55,-R*0.30,R*0.85,R*0.60),R*0.13),'greeble',G.bw*0.62);
    s+=plate(rect(-R*1.48,-R*0.20,R*0.70,R*0.16),'base',{dark:true,sw:1.2});
    s+=plate(rect(-R*1.48, R*0.04,R*0.70,R*0.16),'base',{dark:true,sw:1.2});
    s+=`<circle cx="0" cy="0" r="${n2(R*1.02)}" fill="#000" opacity="0.3"/>`;
    s+=`<circle cx="0" cy="0" r="${n2(R)}" fill="url(#b_base)" stroke="${INK}" stroke-width="${n2(2.4*SWK)}" data-slot="base"/>`;
    s+=`<circle cx="0" cy="0" r="${n2(R*0.88)}" fill="url(#d_base)" stroke="${INK}" stroke-width="${n2(1.6*SWK)}" data-slot="base"/>`;
    const N=6;
    for(let i=0;i<N;i++){ const a=i/N*Math.PI*2+0.4;
      s+=solid(chamfer(rect(Math.cos(a)*R*0.70-R*0.12,Math.sin(a)*R*0.70-R*0.09,R*0.24,R*0.18),R*0.05),'greeble',G.bw*0.32,{noShadow:1,sw:1.3}); }
    s+=`<circle cx="0" cy="0" r="${n2(R*0.46)}" fill="url(#m_base)" stroke="${INK}" stroke-width="${n2(2*SWK)}" data-slot="base"/>`;
    return s; },
};
function drawPlatform(cfg,G){ return (PLAT[String(cfg.platform)]||PLAT['1'])(cfg,G); }

// ЕДИНОЕ ДУЛЬНОЕ СВЕЧЕНИЕ. Раньше каждый рисовальщик лепил свой эллипс
// url(#glow) со смещённым вперёд центром: пятно наполовину лежало НА дульном
// тормозе (замыливая деталь), у разных технологий было разного размера и
// формы, а на нескольких стволах пятна складывались в неровную кляксу.
// Теперь один помощник и одна форма для всех:
//   1) конус света строго вперёд по оси огня — гаснет к концу (#flare);
//   2) симметричный ореол РОВНО в точке среза — не «съезжает» со ствола;
//   3) точка накала в самом канале.
// x,y — срез ствола; reach — вылет света вперёд; ry — полуширина у среза.
function muzzleFlare(cfg,G,x,y,reach,ry,op){
  const o = op==null ? 1 : op;
  // Никаких конусов: конус света = фонарик, а не раскалённый срез. Только
  // мягкий ореол, чуть вытянутый вперёд по оси, и точка накала в канале.
  const cx = x + reach*0.22, rx = Math.max(ry*1.8, reach*0.55);
  return `<g class="tg-flare" opacity="${n2(o)}" style="pointer-events:none">`
    + `<ellipse cx="${n2(cx)}" cy="${n2(y)}" rx="${n2(rx)}" ry="${n2(ry*1.45)}" fill="url(#glow)" opacity="0.55"/>`
    + `<ellipse cx="${n2(x)}" cy="${n2(y)}" rx="${n2(ry*0.95)}" ry="${n2(ry*0.95)}" fill="url(#glow)" opacity="0.6"/>`
    + `<ellipse cx="${n2(x)}" cy="${n2(y)}" rx="${n2(ry*0.40)}" ry="${n2(ry*0.58)}" fill="url(#core)"/>`
    + `</g>`;
}

// ── §6. ВООРУЖЕНИЕ — свой рисовальщик на технологию ──────────
// gun (кинетика/ЭХС): ступенчатая труба, бандажи, эжектор, дульный тормоз
function armGun(cfg,y,G,dense){
  const bw=G.bw,len=G.len,x0=G.mantletX,x1=x0+len,hz=bw*0.30;
  let s='';
  s+=solid(chamfer(rect(x0-bw*1.9,y-bw*1.02,bw*2.4,bw*2.04),bw*0.34),'greeble',hz*1.2);
  s+=solid(chamfer(rect(x0-bw*0.5,y-bw*1.24,bw*0.9,bw*2.48),bw*0.22),'plate',hz*0.9);
  const pr=[[0,0.80],[0.07,0.64],[0.34,0.58],[0.62,0.52],[0.80,0.50],[1,0.48]];
  const up=pr.map(([t,w])=>[x0+len*t,y-bw*w]), dn=pr.map(([t,w])=>[x0+len*t,y+bw*w]).reverse();
  s+=solid(up.concat(dn),'barrel',hz,{sw:2.0});
  const segs=dense?9:5, hAt=t=>{for(let i=1;i<pr.length;i++) if(t<=pr[i][0]){
    const k=(t-pr[i-1][0])/((pr[i][0]-pr[i-1][0])||1); return bw*(pr[i-1][1]+(pr[i][1]-pr[i-1][1])*k);} return bw*0.48;};
  for(let i=1;i<segs;i++){ const t=i/segs*0.86,x=x0+len*t,h=hAt(t);
    s+=plate(rect(x-bw*0.10,y-h*1.06,bw*0.20,h*2.12),'barrel',{sw:1.2,dark:true});
    s+=bolts([[x,y-h*0.9],[x,y+h*0.9]],bw*0.055,h*0.75); }
  s+=solid(chamfer(rect(x0+len*0.36,y-bw*0.84,len*0.13,bw*1.68),bw*0.30),'greeble',hz*0.9); // эжектор
  s+=`<path d="${poly([[x0+bw*0.3,y-bw*0.42],[x1-bw*0.3,y-bw*0.36],[x1-bw*0.3,y-bw*0.08],[x0+bw*0.3,y-bw*0.12]])}" fill="url(#spec)"/>`;
  const mw=bw*1.20;
  s+=solid(chamfer(rect(x1-bw*1.7,y-mw*0.62,bw*2.0,mw*1.24),bw*0.26),'greeble',hz*1.1);
  for(let i=0;i<3;i++){const px=x1-bw*1.42+i*bw*0.55;
    s+=plate(rect(px,y-mw*0.42,bw*0.20,mw*0.28),'barrel',{dark:true,sw:1});
    s+=plate(rect(px,y+mw*0.14,bw*0.20,mw*0.28),'barrel',{dark:true,sw:1});}
  s+=`<ellipse cx="${n2(x1+bw*0.05)}" cy="${n2(y)}" rx="${n2(bw*0.14)}" ry="${n2(bw*0.30)}" fill="${INK}"/>`;
  s+=muzzleFlare(cfg,G,x1+bw*0.10,y,bw*3.6,bw*0.62);
  return s;
}
// ПУЛЕМЁТ: башня у него общая с турелью БТР — отличается САМ СТВОЛ, и
// отличается однозначно: перфорированный кожух охлаждения, лента из короба
// в приёмник, щелевой пламегаситель вместо дульного тормоза. Ствол тонкий и
// длинный, без бандажей и эжектора — ничего «пушечного».
function armMG(cfg,y,G){
  const bw=G.bw, len=G.len, x0=G.mantletX, x1=x0+len, hz=bw*0.26;
  const R=bw*0.52;                     // полувысота кожуха
  let s='';
  // Ствольная коробка + приёмник ленты
  s+=solid(chamfer(rect(x0-bw*2.2,y-bw*0.86,bw*2.6,bw*1.72),bw*0.24),'greeble',hz*1.2,{sw:1.7});
  s+=solid(chamfer(rect(x0-bw*1.9,y+bw*0.70,bw*1.7,bw*1.30),bw*0.20),'plate',hz*0.9,{dark:true});
  for(let i=0;i<4;i++) s+=line([[x0-bw*1.75+i*bw*0.42,y+bw*0.80],[x0-bw*1.75+i*bw*0.42,y+bw*1.90]],1.1,0.5);
  // Лента из короба в приёмник
  s+=`<path d="M ${n2(x0-bw*1.05)} ${n2(y+bw*1.30)} C ${n2(x0-bw*0.75)} ${n2(y+bw*1.05)}, ${n2(x0-bw*0.70)} ${n2(y+bw*0.65)}, ${n2(x0-bw*0.90)} ${n2(y+bw*0.30)}"`
    +` fill="none" stroke="${INK}" stroke-width="${n2(bw*0.30)}" stroke-linecap="round" opacity="0.9"/>`;
  // Кожух охлаждения — ровная труба с рядом отверстий
  const jl=len*0.62;
  s+=solid(chamfer(rect(x0,y-R*1.30,jl,R*2.60),R*0.34),'barrel',hz,{sw:1.8});
  const holes=Math.max(4,Math.round(jl/(bw*0.75)));
  for(let i=0;i<holes;i++)
    s+=`<circle cx="${n2(x0+jl*((i+0.6)/holes))}" cy="${n2(y)}" r="${n2(R*0.36)}" fill="${INK}" opacity="0.6"/>`;
  s+=`<path d="${poly([[x0+bw*0.2,y-R*0.95],[x0+jl-bw*0.2,y-R*0.90],[x0+jl-bw*0.2,y-R*0.45],[x0+bw*0.2,y-R*0.50]])}" fill="url(#spec)"/>`;
  // Тонкий ствол из кожуха
  s+=solid(rect(x0+jl,y-R*0.62,len-jl,R*1.24),'barrel',hz*0.8,{sw:1.6});
  // Щелевой пламегаситель
  s+=solid(chamfer(rect(x1-bw*0.95,y-R*1.05,bw*1.05,R*2.10),R*0.20),'greeble',hz*0.9,{sw:1.5});
  for(let i=0;i<2;i++) s+=line([[x1-bw*0.75+i*bw*0.40,y-R*0.85],[x1-bw*0.75+i*bw*0.40,y+R*0.85]],1.2,0.65);
  s+=`<ellipse cx="${n2(x1+bw*0.03)}" cy="${n2(y)}" rx="${n2(bw*0.10)}" ry="${n2(R*0.46)}" fill="${INK}"/>`;
  s+=muzzleFlare(cfg,G,x1+bw*0.06,y,bw*2.2,R*0.72,0.9);
  return s;
}
// Свободная полувысота под навесное: столько можно отъесть в сторону, не
// залезая на соседний ствол в банке. Один помощник на всех — раньше каждый
// рисовальщик лепил свои константы и в плотном ряду детали наезжали.
function halfRoom(G,want){ return Math.min(want, (G.pitch||Infinity)*0.42); }

// ehs (электротермохимическое): это ПУШКА, а не рельса — единый ствол.
// Отличие от кинетики: плазменный воспламенитель. Отсюда батарея банок-
// конденсаторов на казённике, жгут-подвод в камору и теплоотводная рубашка
// на первой трети ствола. Никаких раздельных направляющих и зазора.
function armEHS(cfg,y,G){
  const bw=G.bw, len=G.len, x0=G.mantletX, x1=x0+len, hz=bw*0.30;
  const H=halfRoom(G,bw*0.80);          // полувысота ствола у казны
  let s='';
  // Казённик с блоком запального разряда
  s+=solid(chamfer(rect(x0-bw*2.2,y-H*1.30,bw*2.7,H*2.60),bw*0.32),'greeble',hz*1.3,{sw:1.6});
  // Банки-конденсаторы: ставим только на свободную сторону
  const sides=[]; if(G.finUp!==false) sides.push(-1); if(G.finDn!==false) sides.push(1);
  for(const sg of sides){
    const yc=y+sg*(H*1.30+halfRoom(G,bw*0.52));
    for(let i=0;i<3;i++) s+=tube(x0-bw*1.7+i*bw*0.85, yc, halfRoom(G,bw*0.44),'greeble');
  }
  // Жгут запала: от казённика вдоль ствола в камору
  const p=`M ${n2(x0-bw*1.9)} ${n2(y-H*0.95)} C ${n2(x0-bw*0.4)} ${n2(y-H*1.15)}, `
        + `${n2(x0+len*0.10)} ${n2(y-H*0.95)}, ${n2(x0+len*0.16)} ${n2(y-H*0.55)}`;
  s+=`<path d="${p}" fill="none" stroke="${INK}" stroke-width="${n2(bw*0.22)}" stroke-linecap="round" opacity="0.9"/>`
    +`<path d="${p}" fill="none" stroke="${cfg.accent}" stroke-width="${n2(bw*0.09)}" opacity="0.6"/>`;
  // Ствол: плавное сужение, без ступеней-бандажей кинетики
  const pr=[[0,1.00],[0.16,0.86],[0.46,0.70],[0.78,0.60],[1,0.56]];
  const up=pr.map(([t,w])=>[x0+len*t,y-H*w]), dn=pr.map(([t,w])=>[x0+len*t,y+H*w]).reverse();
  s+=solid(up.concat(dn),'barrel',hz,{sw:2.0});
  // Теплоотводная рубашка — кольцевые рёбра на разгонном участке
  const jl=len*0.34, fins=Math.max(4,Math.round(jl/(bw*0.55)));
  for(let i=0;i<fins;i++){ const x=x0+bw*0.35+i*(jl/fins);
    s+=plate(rect(x,y-H*1.02,bw*0.14,H*2.04),'greeble',{sw:1,dark:true}); }
  s+=`<path d="${poly([[x0+bw*0.3,y-H*0.70],[x1-bw*0.3,y-H*0.44],[x1-bw*0.3,y-H*0.16],[x0+bw*0.3,y-H*0.30]])}" fill="url(#spec)"/>`;
  // Камора — светящееся окно сразу за рубашкой
  s+=`<rect x="${n2(x0+jl+bw*0.2)}" y="${n2(y-H*0.16)}" width="${n2(len*0.20)}" height="${n2(H*0.32)}"`
    +` fill="${INK}" opacity="0.85"/>`;
  s+=`<rect x="${n2(x0+jl+bw*0.3)}" y="${n2(y-H*0.09)}" width="${n2(len*0.17)}" height="${n2(H*0.18)}"`
    +` fill="${(TECHS[cfg.tech]||TECHS.ehs).glow}" opacity="0.55"/>`;
  // Дульный компенсатор. Раньше здесь была голая трапеция-«воронка» — читалась
  // как детский рисунок раструба. Теперь это агрегат: цилиндрический блок,
  // два ряда наклонённых назад окон выброса, опорное кольцо на входе и
  // усиленный венец у самого среза.
  const mb=bw*1.55, MH=halfRoom(G,H*0.92), mx=x1-mb;
  s+=solid(chamfer(rect(mx,y-MH,mb,MH*2),bw*0.18),'greeble',hz*1.05,{sw:1.6});
  for(let i=0;i<2;i++){
    const px=mx+bw*0.34+i*bw*0.58;
    for(const sg of [-1,1])
      s+=`<path d="${poly([[px,y+sg*MH*0.40],[px+bw*0.30,y+sg*MH*0.40],
                           [px+bw*0.14,y+sg*MH*1.00],[px-bw*0.16,y+sg*MH*1.00]])}"`
        +` fill="${INK}" opacity="0.88"/>`;
  }
  s+=plate(rect(mx-bw*0.05,y-MH*1.12,bw*0.20,MH*2.24),'barrel',{sw:1.2,dark:true});
  s+=solid(chamfer(rect(x1-bw*0.36,y-MH*1.10,bw*0.36,MH*2.20),bw*0.09),'plate',hz*0.85,{sw:1.5});
  s+=`<path d="${poly([[mx+bw*0.1,y-MH*0.74],[x1-bw*0.5,y-MH*0.74],[x1-bw*0.5,y-MH*0.42],[mx+bw*0.1,y-MH*0.42]])}" fill="url(#spec)"/>`;
  s+=`<ellipse cx="${n2(x1)}" cy="${n2(y)}" rx="${n2(bw*0.13)}" ry="${n2(H*0.52)}" fill="${INK}"/>`;
  s+=muzzleFlare(cfg,G,x1+bw*0.06,y,bw*3.2,H*0.60);
  return s;
}
// coil (электромагнитное): КАТУШЕЧНИК. Одна труба, на неё нанизана стопка
// тороидальных катушек, между ними — шины питания. Родственно рельсе по
// физике, но силуэт другой: не два прута с щелью, а «ёлка» из колец.
function armCoil(cfg,y,G){
  const bw=G.bw, len=G.len, x0=G.mantletX, x1=x0+len, hz=bw*0.30;
  const H=halfRoom(G,bw*0.46);          // полувысота самой трубы
  const CH=halfRoom(G,bw*1.05);         // радиус катушки
  let s='';
  s+=solid(chamfer(rect(x0-bw*2.3,y-CH*1.05,bw*2.7,CH*2.10),bw*0.34),'plate',hz*1.4); // инжектор
  // Труба-направляющая
  s+=solid(rect(x0,y-H,len,H*2),'barrel',hz,{sw:1.8});
  s+=`<rect x="${n2(x0+bw*0.2)}" y="${n2(y-H*0.34)}" width="${n2(len-bw*0.6)}" height="${n2(H*0.68)}" fill="${INK}" opacity="0.85"/>`;
  s+=`<rect x="${n2(x0+len*0.18)}" y="${n2(y-H*0.20)}" width="${n2(len*0.78)}" height="${n2(H*0.40)}"`
    +` fill="${(TECHS[cfg.tech]||TECHS.em).glow}" opacity="0.6"/>`;
  // Стопка катушек: к дулу они мельчают — видно, что снаряд разгоняется
  const N=Math.max(4,Math.round(len/(bw*1.25)));
  for(let i=0;i<N;i++){
    const t=i/N, x=x0+bw*0.3+t*len*0.92, k=1-t*0.30, w=bw*0.42;
    s+=solid(chamfer(rect(x,y-CH*k,w,CH*2*k),bw*0.14),'greeble',hz*0.7,{noShadow:1,sw:1.4});
    s+=line([[x+w*0.5,y-CH*k*0.55],[x+w*0.5,y+CH*k*0.55]],1.1,0.4);
  }
  // Шины питания вдоль обеих сторон стопки
  for(const sg of [-1,1]){
    const yc=y+sg*CH*1.12;
    s+=`<path d="M ${n2(x0-bw*0.4)} ${n2(yc)} L ${n2(x1-bw*0.6)} ${n2(yc*0.72+y*0.28)}" fill="none"`
      +` stroke="${INK}" stroke-width="${n2(bw*0.18)}" stroke-linecap="round" opacity="0.9"/>`
      +`<path d="M ${n2(x0-bw*0.4)} ${n2(yc)} L ${n2(x1-bw*0.6)} ${n2(yc*0.72+y*0.28)}" fill="none"`
      +` stroke="${cfg.accent}" stroke-width="${n2(bw*0.07)}" opacity="0.55"/>`;
  }
  s+=`<ellipse cx="${n2(x1)}" cy="${n2(y)}" rx="${n2(bw*0.12)}" ry="${n2(H*0.72)}" fill="${INK}"/>`;
  s+=muzzleFlare(cfg,G,x1+bw*0.06,y,bw*4.0,H*1.10);
  return s;
}
// nano (нанотехнологии): не ствол и не эмиттер. Это РОЙ. Улей-картридж с
// сотовыми ячейками, к нему магистрали питательной среды, впереди — веер
// раскрытых распылителей, из которых сходит облако точек-ботов. Никакой
// оптики, никаких радиаторов: нанороботам не нужен ни луч, ни канал.
function armNano(cfg,y,G){
  const bw=G.bw, len=G.len, x0=G.mantletX, x1=x0+len, hz=bw*0.36;
  const H=halfRoom(G,bw*0.95);
  const glow=(TECHS[cfg.tech]||TECHS.nano).glow;
  const rnd=rng((cfg.seed|0)+((y*7)|0)+11);
  let s='';
  // Улей-картридж: шестигранные ячейки в раме
  s+=solid(chamfer(rect(x0-bw*2.6,y-H*1.25,bw*3.0,H*2.50),bw*0.30),'greeble',hz*1.3,{sw:1.7});
  const cols=3, rows=3, cw=bw*0.78, chh=H*0.62;
  for(let c=0;c<cols;c++) for(let r=0;r<rows;r++){
    const cx=x0-bw*2.25+c*cw*0.92, cy=y-H*0.72+r*chh + (c%2?chh*0.32:0);
    const hex=[]; for(let i=0;i<6;i++){const a=i/6*Math.PI*2+Math.PI/6;
      hex.push([cx+Math.cos(a)*cw*0.34, cy+Math.sin(a)*chh*0.42]);}
    s+=`<path d="${poly(hex)}" fill="url(#d_greeble)" stroke="${INK}" stroke-width="${n2(1*SWK)}" data-slot="greeble"/>`;
    if(rnd()>0.45) s+=`<path d="${poly(inset(hex,cw*0.10))}" fill="${glow}" opacity="${n2(0.25+rnd()*0.45)}"/>`;
  }
  // Магистрали среды к распылителям
  for(const sg of [-1,1]){
    const p=`M ${n2(x0-bw*0.9)} ${n2(y+sg*H*0.95)} C ${n2(x0+len*0.30)} ${n2(y+sg*H*1.20)}, `
          + `${n2(x0+len*0.60)} ${n2(y+sg*H*0.85)}, ${n2(x1-bw*0.8)} ${n2(y+sg*H*0.62)}`;
    s+=`<path d="${p}" fill="none" stroke="${INK}" stroke-width="${n2(bw*0.20)}" stroke-linecap="round" opacity="0.9"/>`
      +`<path d="${p}" fill="none" stroke="${glow}" stroke-width="${n2(bw*0.08)}" opacity="0.6"/>`;
  }
  // Ферма-«хребет» вместо ствола: узкая балка с сегментами
  s+=solid(chamfer(rect(x0,y-H*0.34,len*0.82,H*0.68),bw*0.16),'barrel',hz*0.9,{sw:1.8});
  const segs=Math.max(4,Math.round(len/(bw*1.6)));
  for(let i=1;i<segs;i++){ const x=x0+len*0.82*(i/segs);
    s+=line([[x,y-H*0.30],[x,y+H*0.30]],1.1,0.45); }
  // Веер распылителей на срезе: три раскрытых лепестка
  for(const k of [-1,0,1]){
    const yy=y+k*H*0.72, xx=x1-len*0.16;
    s+=solid([[xx,yy-H*0.20],[x1+bw*0.2,yy-H*0.42*(1+Math.abs(k)*0.4)],
              [x1+bw*0.2,yy+H*0.42*(1+Math.abs(k)*0.4)],[xx,yy+H*0.20]],'greeble',hz*0.6,
             {noShadow:1,sw:1.4,dark:true});
    s+=`<ellipse cx="${n2(x1+bw*0.18)}" cy="${n2(yy)}" rx="${n2(bw*0.12)}" ry="${n2(H*0.34)}" fill="${INK}"/>`;
  }
  // Облако ботов: россыпь точек, гуще у среза
  const dots=Math.round(26+(+cfg.detail||0)*30);
  let cloud='';
  for(let i=0;i<dots;i++){
    const t=rnd(), dx=t*bw*4.2, dy=(rnd()-0.5)*H*2.0*(0.45+t*1.35);
    cloud+=`<circle cx="${n2(x1+bw*0.3+dx)}" cy="${n2(y+dy)}" r="${n2(bw*(0.05+rnd()*0.07))}"`
        +` fill="${glow}" opacity="${n2(0.85*(1-t*0.8))}"/>`;
  }
  s+=`<g class="tg-flare" style="pointer-events:none">`
    +`<ellipse cx="${n2(x1+bw*1.6)}" cy="${n2(y)}" rx="${n2(bw*2.4)}" ry="${n2(H*1.5)}" fill="url(#glow)" opacity="0.42"/>`
    +cloud+`</g>`;
  return s;
}
// rail (рельсотрон): ДВЕ раздельные направляющие с открытым зазором,
// катушки-перемычки, конденсаторные шины, бронекожух у казны
function armRail(cfg,y,G){
  const bw=G.bw,len=G.len,x0=G.mantletX,x1=x0+len,hz=bw*0.28;
  const gap=bw*0.30, rw=bw*0.34;
  let s='';
  s+=solid(chamfer(rect(x0-bw*2.1,y-bw*1.30,bw*2.6,bw*2.60),bw*0.30),'plate',hz*1.4);   // инжектор
  s+=solid(chamfer(rect(x0-bw*0.6,y-bw*1.10,len*0.30,bw*2.20),bw*0.26),'greeble',hz*1.1);// кожух
  for(const sg of [-1,1]){
    const yc=y+sg*(gap/2+rw/2);
    s+=solid([[x0,yc-rw/2],[x1,yc-rw*0.42],[x1,yc+rw*0.42],[x0,yc+rw/2]],'barrel',hz,{sw:1.9});
    s+=`<path d="${poly([[x0+bw*0.3,yc-rw*0.34],[x1-bw*0.3,yc-rw*0.30],[x1-bw*0.3,yc-rw*0.06],[x0+bw*0.3,yc-rw*0.10]])}" fill="url(#spec)"/>`;
  }
  // Зазор светится
  s+=`<rect x="${n2(x0)}" y="${n2(y-gap/2)}" width="${n2(len)}" height="${n2(gap)}" fill="${INK}"/>`;
  s+=`<rect x="${n2(x0+len*0.30)}" y="${n2(y-gap*0.30)}" width="${n2(len*0.68)}" height="${n2(gap*0.60)}"`
    +` fill="${(TECHS[cfg.tech]||TECHS.rail).glow}" opacity="0.55"/>`;
  // Катушки-перемычки
  const N=Math.max(5,Math.round(len/(bw*1.5)));
  for(let i=1;i<N;i++){ const x=x0+len*(i/N)*0.92;
    s+=solid(rect(x-bw*0.13,y-(gap/2+rw)*1.22,bw*0.26,(gap/2+rw)*2.44),'greeble',hz*0.55,{noShadow:1,sw:1.2}); }
  // Конденсаторные шины по бортам
  for(const sg of [-1,1]){
    const yc=y+sg*(gap/2+rw*1.72);
    s+=`<path d="M ${n2(x0)} ${n2(yc)} L ${n2(x0+len*0.55)} ${n2(yc)}" fill="none" stroke="${INK}"`
      +` stroke-width="${n2(bw*0.20)}" stroke-linecap="round" opacity="0.9"/>`
      +`<path d="M ${n2(x0)} ${n2(yc)} L ${n2(x0+len*0.55)} ${n2(yc)}" fill="none" stroke="${cfg.accent}"`
      +` stroke-width="${n2(bw*0.09)}" opacity="0.55"/>`;
  }
  s+=muzzleFlare(cfg,G,x1,y,bw*4.6,gap*1.10);
  return s;
}
// beam (лазер): гладкий волновод без бандажей + крупные радиаторные пластины + линза
// beam (лазер / твердотельное / нано): не труба, а КОРОБЧАТЫЙ излучатель.
// Массивный корпус эмиттера, вдоль него — светящийся канал накачки, по
// бортам косые радиаторные крылья, на срезе — стопка фокусирующих колец
// и линза. Должен читаться как оптика, а не как ствол.
function armBeam(cfg,y,G){
  const bw=G.bw, len=G.len, x0=G.mantletX, x1=x0+len, hz=bw*0.40;
  // Полувысота корпуса эмиттера зажата половиной шага между стволами: в
  // плотном ряду коробки обязаны стоять раздельно, а не слипаться в плиту.
  const H=Math.min(bw*1.05, (G.pitch||Infinity)*0.40);
  const sides=[]; if(G.finUp!==false) sides.push(-1); if(G.finDn!==false) sides.push(1);
  let s='';
  // Резонатор и батарея конденсаторов у казны — по тому же габариту, что и
  // корпус: иначе казна соседнего ствола перекрывает эту.
  const HB=Math.min(bw*1.55, (G.pitch||Infinity)*0.46);
  s+=solid(chamfer(rect(x0-bw*2.6,y-HB,bw*3.0,HB*2),bw*0.40),'greeble',hz*1.5);
  s+=grille(x0-bw*2.3,y-HB*0.78,bw*1.7,HB*1.55);
  // Баки-цилиндры вешаются только на свободную сторону банки.
  for(const sg of sides) s+=tube(x0-bw*1.0, y+sg*(HB+bw*0.62), bw*0.62,'greeble');
  // Косые радиаторные крылья — параллелограммы, не палочки. Вылет не
  // превышает свободного места до соседнего ствола.
  const N=Math.max(3,Math.round(2+(+cfg.detail||0)*4));
  const finOut=Math.min(H*1.35, Math.max(0,(G.pitch||Infinity)/2-H)+H*0.9);
  for(let i=0;i<N;i++){
    const x=x0+bw*0.6+i*(len*0.74/N), w=bw*0.46, sk=bw*0.55;
    for(const sg of sides)
      s+=solid([[x,y+sg*H],[x+w,y+sg*H],[x+w+sk,y+sg*(H+finOut)],[x+sk,y+sg*(H+finOut)]],
               'greeble',hz*0.45,{noShadow:1,dark:true,sw:1.3});
  }
  // Корпус эмиттера — коробка со скошенным носом
  s+=solid(chamfer([[x0,y-H],[x1-bw*1.1,y-H],[x1-bw*0.2,y-H*0.62],
                    [x1-bw*0.2,y+H*0.62],[x1-bw*1.1,y+H],[x0,y+H]],bw*0.30),'barrel',hz,{sw:2.1});
  // Канал накачки — светящаяся полоса по всей длине
  s+=`<rect x="${n2(x0+bw*0.2)}" y="${n2(y-H*0.20)}" width="${n2(len-bw*1.6)}" height="${n2(H*0.40)}"`
    +` fill="${INK}" opacity="0.9"/>`;
  s+=`<rect x="${n2(x0+bw*0.5)}" y="${n2(y-H*0.11)}" width="${n2(len-bw*2.2)}" height="${n2(H*0.22)}"`
    +` fill="${(TECHS[cfg.tech]||TECHS.laser).glow}" opacity="0.65"/>`;
  s+=`<path d="${poly([[x0+bw*0.3,y-H*0.78],[x1-bw*1.2,y-H*0.72],[x1-bw*1.2,y-H*0.38],[x0+bw*0.3,y-H*0.44]])}" fill="url(#spec)"/>`;
  // Стопка фокусирующих колец на срезе
  for(let i=0;i<3;i++){ const k=1-i*0.18, x=x1-bw*(1.0-i*0.34);
    s+=solid(chamfer(rect(x,y-H*1.10*k,bw*0.28,H*2.20*k),bw*0.10),'greeble',hz*0.7,{noShadow:1,sw:1.4}); }
  s+=`<ellipse cx="${n2(x1+bw*0.16)}" cy="${n2(y)}" rx="${n2(bw*0.36)}" ry="${n2(H*0.78)}"`
    +` fill="url(#m_glass)" stroke="${INK}" stroke-width="${n2(1.6*SWK)}" data-slot="glass"/>`;
  s+=`<ellipse cx="${n2(x1+bw*0.16)}" cy="${n2(y)}" rx="${n2(bw*0.52)}" ry="${n2(H*0.92)}" fill="url(#core)"/>`;
  s+=muzzleFlare(cfg,G,x1+bw*0.16,y,bw*5.2,H*0.66);
  return s;
}
// plasma: короткий толстый ствол, раструб-сопло, инжекторные кольца,
// баки-торы по бортам казны, светящаяся камера
function armPlasma(cfg,y,G){
  const bw=G.bw,len=G.len*0.72,x0=G.mantletX,x1=x0+len,hz=bw*0.32;
  // Раструб — самая широкая часть орудия; именно он и наезжал на соседний
  // ствол в ряду. Габарит зажат половиной шага банка: у одиночного орудия
  // раструб прежний, в плотном ряду сопла стоят раздельно.
  const M=halfRoom(G,bw*1.30);          // полувысота на срезе (раструб)
  const B=M*0.62;                       // полувысота у казны
  const sides=[]; if(G.finUp!==false) sides.push(-1); if(G.finDn!==false) sides.push(1);
  let s='';
  // Камера сгорания
  s+=solid(chamfer(rect(x0-bw*2.0,y-B*1.60,bw*2.5,B*3.20),bw*0.44),'greeble',hz*1.5);
  s+=`<ellipse cx="${n2(x0-bw*0.75)}" cy="${n2(y)}" rx="${n2(bw*0.55)}" ry="${n2(B*1.05)}" fill="url(#core)"/>`;
  // Баки — только на свободную сторону банка
  const tr=halfRoom(G,bw*0.78);
  for(const sg of sides) s+=tube(x0-bw*0.4, y+sg*(B*1.60+tr*1.05), tr,'greeble');
  // Топливопроводы к дулу
  for(const sg of sides){
    const yt=y+sg*(B*1.60+tr*1.05);
    const p=`M ${n2(x0-bw*0.4)} ${n2(yt)} C ${n2(x0+len*0.35)} ${n2(yt)}, ${n2(x0+len*0.55)} ${n2(y+sg*B*1.3)}, ${n2(x1-bw*0.6)} ${n2(y+sg*M*0.72)}`;
    s+=`<path d="${p}" fill="none" stroke="${INK}" stroke-width="${n2(bw*0.26)}" stroke-linecap="round" opacity="0.9"/>`
      +`<path d="${p}" fill="none" stroke="${cfg.accent}" stroke-width="${n2(bw*0.11)}" opacity="0.5"/>`;
  }
  // Ствол-раструб: профиль в долях от M, а не в абсолютных bw
  const pr=[[0,0.60],[0.22,0.46],[0.60,0.48],[0.80,0.66],[1,0.86]];
  const up=pr.map(([t,w])=>[x0+len*t,y-M*w*1.18]), dn=pr.map(([t,w])=>[x0+len*t,y+M*w*1.18]).reverse();
  s+=solid(up.concat(dn),'barrel',hz,{sw:2.0});
  // Инжекторные кольца
  for(let i=1;i<5;i++){ const t=i/5*0.72,x=x0+len*t;
    s+=solid(rect(x-bw*0.14,y-M*0.62,bw*0.28,M*1.24),'greeble',hz*0.55,{noShadow:1,sw:1.2}); }
  // Сопло
  s+=solid([[x1-bw*0.5,y-M*0.78],[x1+bw*0.3,y-M],[x1+bw*0.3,y+M],[x1-bw*0.5,y+M*0.78]],'greeble',hz*1.1);
  s+=muzzleFlare(cfg,G,x1+bw*0.30,y,bw*3.4,M*0.80);
  return s;
}
// ── РАКЕТНОЕ ─────────────────────────────────────────────────
// Три РАЗНЫХ изделия, а не один пакет труб с разным числом дырок:
//   pack  (РПУ)  — несколько толстых ТПК на подъёмной раме с направляющими;
//   mlrs  (РСУ)  — сотовый блок тонких НУРСов в общей обойме;
//   silo  (МБР)  — одна-две шахты со сдвинутой крышкой и кабель-мачтой.
// Компоновка выбирается КЛАССОМ установки, а не калибром: РСУ обязана
// выглядеть как РСЗО даже на крупном калибре.
// ЗЕРКАЛО: geom() считает bankSpan по этим же числам.
function packOf(cfg,G){
  const bw=G.bw, n=Math.max(1,Math.min(8,cfg.barrels|0));
  const k=cfg.klass;
  const mode = k==='brm' ? 'silo' : (k==='rsu' ? 'mlrs' : 'pack');
  if(mode==='silo'){
    const cells=Math.max(1,Math.min(3,Math.ceil(n/3)));
    return { mode, cells, cols:1, rows:cells, tr:bw*1.40, tl:G.len*0.66,
             pitchY:bw*3.20, pitchX:0 };
  }
  if(mode==='mlrs'){
    // Сотовый блок: столбцов по оси огня 2..3, строк — сколько нужно
    const cells=Math.max(4,Math.min(24,n*3));
    const cols=n>=5?3:2, rows=Math.ceil(cells/cols);
    const tr=bw*0.34;
    return { mode, cells, cols, rows, tr, tl:G.len*0.62,
             pitchY:tr*2.30, pitchX:tr*2.10 };
  }
  const cells=Math.max(1,Math.min(6,n));
  const tr=bw*0.80;
  return { mode, cells, cols:1, rows:cells, tr, tl:G.len*0.80, pitchY:tr*2.40, pitchX:0 };
}
function armLauncher(cfg,y,G){
  const bw=G.bw, x0=G.mantletX, hz=bw*0.44;
  const K=packOf(cfg,G), tr=K.tr, tl=K.tl;
  const spanY=(K.rows-1)*K.pitchY;
  const glow=(TECHS[cfg.tech]||TECHS.missile).glow;
  let s='';

  if(K.mode==='mlrs'){
    // ── РСУ: единая обойма, внутри соты труб. Тут важен БЛОК, а не
    // отдельные стволы: пакет закрыт общей рамой с торцевыми плитами.
    const halfY=spanY/2+tr*1.9, depth=tl;
    s+=solid(chamfer(rect(x0-bw*1.1,y-halfY,depth+bw*1.4,halfY*2),bw*0.34),'plate',hz*1.3,{sw:2.2});
    // Торцевые плиты обоймы
    for(const px of [x0-bw*0.5, x0+depth*0.52, x0+depth+bw*0.05])
      s+=plate(rect(px,y-halfY*0.96,bw*0.34,halfY*1.92),'greeble',{sw:1.3,dark:true});
    // Соты
    for(let r=0;r<K.rows;r++) for(let c=0;c<K.cols;c++){
      if(r*K.cols+c>=K.cells) break;
      const cy=y-spanY/2+r*K.pitchY + (c%2?K.pitchY*0.5:0);
      const cx=x0+depth-tr*1.2-c*K.pitchX;
      s+=`<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(tr*1.05)}" fill="url(#d_greeble)"`
        +` stroke="${INK}" stroke-width="${n2(1.2*SWK)}" data-slot="greeble"/>`;
      s+=`<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(tr*0.70)}" fill="${INK}"/>`;
      s+=`<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(tr*0.34)}" fill="${glow}" opacity="0.45"/>`;
    }
    // Направляющие рельсы поверх обоймы
    for(const sg of [-1,1])
      s+=plate(rect(x0-bw*0.9, y+sg*halfY*0.82-tr*0.20, depth+bw*1.0, tr*0.40),'greeble',{sw:1.1,dark:true});
    // Подъёмный гидроцилиндр и блок наведения в корме
    s+=solid(chamfer(rect(x0-bw*2.6,y-halfY*0.42,bw*1.7,halfY*0.84),bw*0.26),'greeble',hz*0.9);
    s+=tube(x0-bw*1.75,y,tr*1.1,'greeble');
    s+=`<g class="tg-flare" style="pointer-events:none"><ellipse cx="${n2(x0+depth+bw*1.0)}" cy="${n2(y)}"`
      +` rx="${n2(bw*1.5)}" ry="${n2(halfY*0.75)}" fill="url(#glow)" opacity="0.35"/></g>`;
    return s;
  }

  if(K.mode==='silo'){
    // ── МБР: не «трубы», а ШАХТЫ. Толстое кольцо горловины, сдвинутая
    // вбок массивная крышка на рельсе, кабель-мачта обслуживания.
    s+=solid(chamfer(rect(x0-bw*1.4,y-spanY/2-tr*1.5,tl*0.9,spanY+tr*3.0),bw*0.42),'plate',hz*1.5,{sw:2.4});
    for(let i=0;i<K.cells;i++){
      const cy=y-spanY/2+i*K.pitchY, cx=x0+tl*0.34;
      // Горловина
      s+=`<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(tr*1.18)}" fill="url(#b_greeble)" stroke="${INK}"`
        +` stroke-width="${n2(2.2*SWK)}" data-slot="greeble"/>`;
      s+=`<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(tr*0.94)}" fill="${INK}"/>`;
      // Носовой обтекатель ракеты в шахте
      s+=`<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(tr*0.62)}" fill="url(#m_greeble)" stroke="${INK}"`
        +` stroke-width="${n2(1.3*SWK)}" data-slot="greeble"/>`;
      s+=`<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(tr*0.24)}" fill="${glow}" opacity="0.6"/>`;
      // Анкерные болты по венцу
      for(let a=0;a<10;a++){ const an=a/10*Math.PI*2;
        s+=`<circle cx="${n2(cx+Math.cos(an)*tr*1.06)}" cy="${n2(cy+Math.sin(an)*tr*1.06)}"`
          +` r="${n2(tr*0.07)}" fill="${INK}" opacity="0.75"/>`; }
      // Сдвинутая крышка на рельсе
      s+=plate(rect(cx+tr*1.35,cy-tr*0.16,tl*0.34,tr*0.32),'greeble',{sw:1.1,dark:true});
      s+=solid(chamfer(rect(cx+tr*1.55,cy-tr*1.15,tr*1.5,tr*2.30),tr*0.30),'plate',hz*1.1,{sw:2.0});
      s+=line([[cx+tr*1.75,cy-tr*0.85],[cx+tr*2.85,cy-tr*0.85]],1.3,0.5);
      s+=line([[cx+tr*1.75,cy+tr*0.85],[cx+tr*2.85,cy+tr*0.85]],1.3,0.5);
    }
    // Кабель-мачта обслуживания
    s+=solid(chamfer(rect(x0-bw*2.4,y-tr*0.55,bw*1.6,tr*1.10),bw*0.24),'greeble',hz*0.9);
    for(let i=0;i<K.cells;i++){
      const cy=y-spanY/2+i*K.pitchY;
      const p=`M ${n2(x0-bw*1.0)} ${n2(y)} C ${n2(x0-bw*0.2)} ${n2(y)}, ${n2(x0-bw*0.2)} ${n2(cy)}, ${n2(x0+tl*0.34-tr*1.2)} ${n2(cy)}`;
      s+=`<path d="${p}" fill="none" stroke="${INK}" stroke-width="${n2(bw*0.24)}" stroke-linecap="round" opacity="0.9"/>`
        +`<path d="${p}" fill="none" stroke="${cfg.accent}" stroke-width="${n2(bw*0.09)}" opacity="0.55"/>`;
    }
    return s;
  }

  // ── РПУ: ТПК на подъёмной раме. Видны сами контейнеры, направляющие
  // рельсы под ними и откинутые передние крышки.
  const halfY=spanY/2+tr*1.6;
  s+=solid(chamfer(rect(x0-bw*2.0,y-halfY,bw*1.5,halfY*2),bw*0.30),'plate',hz*1.2,{sw:2.0}); // задняя рама
  for(const sg of [-1,1])
    s+=solid(chamfer(rect(x0-bw*1.5, y+sg*halfY-tr*0.28, tl*0.72, tr*0.56),bw*0.16),'plate',hz*0.8,{sw:1.6});
  for(let i=0;i<K.cells;i++){
    const cy=y-spanY/2+i*K.pitchY;
    // Рельс-направляющая под контейнером
    s+=plate(rect(x0-bw*0.6, cy+tr*0.92, tl*0.96, tr*0.26),'greeble',{sw:1.1,dark:true});
    // Сам ТПК: гранёный, с продольным ребром и стяжными хомутами
    s+=solid([[x0,cy-tr],[x0+tl*0.92,cy-tr*0.90],[x0+tl,cy-tr*0.62],
              [x0+tl,cy+tr*0.62],[x0+tl*0.92,cy+tr*0.90],[x0,cy+tr]],'barrel',hz,{sw:1.9});
    s+=line([[x0+bw*0.3,cy-tr*0.42],[x0+tl-bw*0.4,cy-tr*0.34]],1.2,0.45);
    for(let k=1;k<4;k++){ const x=x0+tl*(k/4);
      s+=solid(rect(x-tr*0.13,cy-tr*1.08,tr*0.26,tr*2.16),'greeble',hz*0.45,{noShadow:1,sw:1.2}); }
    // Зев + обтекатель ракеты
    s+=`<ellipse cx="${n2(x0+tl)}" cy="${n2(cy)}" rx="${n2(tr*0.30)}" ry="${n2(tr*0.60)}" fill="${INK}"/>`;
    s+=`<ellipse cx="${n2(x0+tl-tr*0.14)}" cy="${n2(cy)}" rx="${n2(tr*0.18)}" ry="${n2(tr*0.36)}"`
      +` fill="url(#m_greeble)" stroke="${INK}" stroke-width="${n2(1*SWK)}" data-slot="greeble"/>`;
    // Откинутая крышка на шарнире — наружу, а не на соседа
    const sg = cy<=y ? -1 : 1;
    s+=plate([[x0+tl-tr*0.15, cy+sg*tr*0.95],[x0+tl+tr*0.95, cy+sg*tr*1.45],
              [x0+tl+tr*1.10, cy+sg*tr*1.05],[x0+tl+tr*0.02, cy+sg*tr*0.55]],'greeble',{sw:1.3,dark:true});
    s+=muzzleFlare(cfg,G,x0+tl,cy,tr*2.4,tr*0.50,0.5);
  }
  // Блок наведения на торце рамы
  s+=solid(chamfer(rect(x0-bw*1.7,y-halfY-tr*1.5,bw*1.6,tr*1.3),bw*0.22),'greeble',hz*0.7);
  s+=`<ellipse cx="${n2(x0-bw*0.9)}" cy="${n2(y-halfY-tr*0.85)}" rx="${n2(tr*0.30)}" ry="${n2(tr*0.40)}"`
    +` fill="url(#m_glass)" stroke="${INK}" stroke-width="${n2(1.3*SWK)}" data-slot="glass"/>`;
  return s;
}
// mortar (взрывчатое): короткий толстый ствол-мортира с широким дульным
// раструбом, массивная опорная плита и противооткатные пружины.
function armMortar(cfg,y,G){
  const bw=G.bw, len=G.len*0.48, x0=G.mantletX, x1=x0+len, hz=bw*0.36;
  let s='';
  s+=solid(chamfer(rect(x0-bw*2.2,y-bw*1.5,bw*2.6,bw*3.0),bw*0.40),'plate',hz*1.4); // опорная плита
  for(const sg of [-1,1]) s+=tube(x0-bw*0.9, y+sg*bw*1.55, bw*0.52,'greeble');       // пружины
  const pr=[[0,0.92],[0.30,0.80],[0.72,0.78],[0.88,0.98],[1,1.10]];
  const up=pr.map(([t,w])=>[x0+len*t,y-bw*w]), dn=pr.map(([t,w])=>[x0+len*t,y+bw*w]).reverse();
  s+=solid(up.concat(dn),'barrel',hz*1.2,{sw:2.2});
  for(let i=1;i<4;i++){ const x=x0+len*(i/4);
    s+=plate(rect(x-bw*0.12,y-bw*0.92,bw*0.24,bw*1.84),'barrel',{sw:1.2,dark:true}); }
  s+=`<ellipse cx="${n2(x1-bw*0.1)}" cy="${n2(y)}" rx="${n2(bw*0.30)}" ry="${n2(bw*0.86)}" fill="${INK}"/>`;
  s+=muzzleFlare(cfg,G,x1,y,bw*2.6,bw*0.92,0.85);
  return s;
}
// array (РЭБ): стволов нет — плоские фазированные решётки на поворотных
// рамах, волноводы и мачта. Это не пушка, и выглядеть должна иначе.
function armArray(cfg,y,G){
  const bw=G.bw, x0=G.mantletX, hz=bw*0.34;
  const glow=(TECHS[cfg.tech]||TECHS.ew).glow;
  // Число ПОЛОТЕН = «стволы»: ползунок наращивает решётку, а не плодит
  // отдельные пушки (в geom у РЭБ всегда одна «рука»).
  const faces=Math.max(1,Math.min(6,cfg.barrels|0));
  const pw=G.len*0.26;                    // толщина полотна по оси огня
  const ph=bw*2.30;                       // высота одного полотна
  const step=ph*1.16, span=(faces-1)*step;
  const rnd=rng((cfg.seed|0)+29);
  let s='';
  // Поворотная колонна с гидравликой наклона
  s+=solid(chamfer(rect(x0-bw*2.4,y-span/2-ph*0.62,bw*2.2,span+ph*1.24),bw*0.34),'plate',hz*1.4,{sw:2.0});
  s+=grille(x0-bw*2.15,y-span/2-ph*0.40,bw*1.7,ph*0.72);
  for(const sg of [-1,1]){
    const yy=y+sg*(span/2+ph*0.38);
    s+=solid(chamfer(rect(x0-bw*1.0,yy-bw*0.20,bw*1.9,bw*0.40),bw*0.12),'greeble',hz*0.6,{noShadow:1,sw:1.3});
    s+=tube(x0-bw*0.9,yy,bw*0.26,'greeble');
  }
  for(let f=0;f<faces;f++){
    const yy=y-span/2+f*step;
    // Рама полотна: скошенная, слегка развёрнута наружу — веер, а не стопка
    const tilt=(f-(faces-1)/2)*ph*0.10;
    const frame=[[x0,yy-ph*0.50],[x0+pw,yy-ph*0.50+tilt],
                 [x0+pw,yy+ph*0.50+tilt],[x0,yy+ph*0.50]];
    s+=solid(chamfer(frame,bw*0.18),'plate',hz*0.9,{sw:1.9});
    // Плитки подрешёток: 4×5 с редкими «горячими» ячейками
    const CC=4, RR=5;
    for(let c=0;c<CC;c++) for(let r=0;r<RR;r++){
      const tx=x0+pw*(0.10+c*0.215), ty=yy-ph*0.38+r*ph*0.155+tilt*(0.10+c*0.215);
      s+=`<rect x="${n2(tx)}" y="${n2(ty)}" width="${n2(pw*0.17)}" height="${n2(ph*0.115)}"`
        +` rx="${n2(pw*0.03)}" fill="url(#d_glass)" stroke="${INK}" stroke-width="${n2(0.8*SWK)}" data-slot="glass"/>`;
      if(rnd()>0.62)
        s+=`<rect x="${n2(tx+pw*0.03)}" y="${n2(ty+ph*0.028)}" width="${n2(pw*0.11)}" height="${n2(ph*0.058)}"`
          +` fill="${glow}" opacity="${n2(0.3+rnd()*0.5)}"/>`;
    }
    // Бортовые экраны подавления боковых лепестков
    for(const sg of [-1,1])
      s+=plate([[x0+pw*0.05,yy+sg*ph*0.50],[x0+pw*0.95,yy+sg*ph*0.50+tilt],
                [x0+pw*1.02,yy+sg*ph*0.62+tilt],[x0+pw*0.02,yy+sg*ph*0.62]],'greeble',{sw:1.2,dark:true});
    // Волновод от колонны к полотну
    const p=`M ${n2(x0-bw*1.2)} ${n2(y)} C ${n2(x0-bw*0.3)} ${n2(y)}, ${n2(x0-bw*0.3)} ${n2(yy)}, ${n2(x0+pw*0.12)} ${n2(yy)}`;
    s+=`<path d="${p}" fill="none" stroke="${INK}" stroke-width="${n2(bw*0.22)}" stroke-linecap="round" opacity="0.85"/>`
      +`<path d="${p}" fill="none" stroke="${cfg.accent}" stroke-width="${n2(bw*0.08)}" opacity="0.5"/>`;
    // Фронт излучения — не «дуло», а размытое поле перед полотном
    s+=`<g class="tg-flare" style="pointer-events:none">`
      +`<ellipse cx="${n2(x0+pw*1.5)}" cy="${n2(yy+tilt)}" rx="${n2(pw*0.9)}" ry="${n2(ph*0.60)}"`
      +` fill="url(#glow)" opacity="0.45"/></g>`;
  }
  // Штыревые антенны сверху колонны — узнаваемый признак РЭБ
  for(let i=0;i<3;i++){
    const ax=x0-bw*2.0+i*bw*0.62, ay=y-span/2-ph*0.62;
    s+=`<path d="M ${n2(ax)} ${n2(ay)} L ${n2(ax-bw*0.35)} ${n2(ay-bw*(1.5+i*0.45))}" fill="none"`
      +` stroke="${INK}" stroke-width="${n2(bw*0.11)}" stroke-linecap="round" opacity="0.9"/>`;
    s+=`<circle cx="${n2(ax-bw*0.35)}" cy="${n2(ay-bw*(1.5+i*0.45))}" r="${n2(bw*0.13)}" fill="${glow}" opacity="0.8"/>`;
  }
  // Общее поле помех
  s+=`<g class="tg-flare" style="pointer-events:none">`
    +`<ellipse cx="${n2(x0+pw*2.2)}" cy="${n2(y)}" rx="${n2(pw*1.6)}" ry="${n2((span+ph)*0.62)}"`
    +` fill="url(#glow)" opacity="0.30"/></g>`;
  return s;
}
// exotic (гравитационное / антиматериальное): не ствол, а излучающее
// кольцо в раме удержания, с внутренним ядром и полем.
function armExotic(cfg,y,G){
  const bw=G.bw, x0=G.mantletX, hz=bw*0.44;
  const R=bw*1.9, reach=G.len*0.55;
  let s='';
  // Ферма удержания: две балки к кольцу
  for(const sg of [-1,1])
    s+=solid(chamfer([[x0-bw*1.2,y+sg*bw*0.5],[x0+reach,y+sg*R*0.86],
                      [x0+reach,y+sg*R*0.52],[x0-bw*1.2,y+sg*bw*0.15]],bw*0.20),'plate',hz*0.9,{sw:1.8});
  s+=solid(chamfer(rect(x0-bw*2.0,y-bw*1.3,bw*2.2,bw*2.6),bw*0.38),'greeble',hz*1.2); // генератор
  // Кольцо: внешний тор + сегменты + ядро
  const cx=x0+reach;
  s+=`<circle cx="${n2(cx)}" cy="${n2(y)}" r="${n2(R)}" fill="url(#b_greeble)" stroke="${INK}" stroke-width="${n2(2.2*SWK)}" data-slot="greeble"/>`;
  s+=`<circle cx="${n2(cx)}" cy="${n2(y)}" r="${n2(R*0.74)}" fill="url(#d_greeble)" stroke="${INK}" stroke-width="${n2(1.4*SWK)}" data-slot="greeble"/>`;
  const N=8;
  for(let i=0;i<N;i++){ const a=i/N*Math.PI*2;
    s+=solid(chamfer(rect(cx+Math.cos(a)*R*0.86-bw*0.22, y+Math.sin(a)*R*0.86-bw*0.22, bw*0.44,bw*0.44),bw*0.10),
             'greeble',hz*0.4,{noShadow:1,sw:1.2}); }
  s+=`<circle cx="${n2(cx)}" cy="${n2(y)}" r="${n2(R*0.56)}" fill="url(#core)"/>`;
  s+=`<circle cx="${n2(cx)}" cy="${n2(y)}" r="${n2(R*1.9)}" fill="url(#glow)"/>`;
  return s;
}

function armOne(cfg,y,G){
  const k=(TECHS[cfg.tech]||TECHS.ehs).kind;
  // Пулемёт узнаётся по стволу, а не по башне (корпус общий с турелью БТР).
  if(cfg.klass==='mg' && (k==='gun'||k==='ehs')) return armMG(cfg,y,G);
  if(k==='ehs')      return armEHS(cfg,y,G);
  if(k==='coil')     return armCoil(cfg,y,G);
  if(k==='nano')     return armNano(cfg,y,G);
  if(k==='rail')     return armRail(cfg,y,G);
  if(k==='beam')     return armBeam(cfg,y,G);
  if(k==='plasma')   return armPlasma(cfg,y,G);
  if(k==='launcher') return armLauncher(cfg,y,G);
  if(k==='mortar')   return armMortar(cfg,y,G);
  if(k==='array')    return armArray(cfg,y,G);
  if(k==='exotic')   return armExotic(cfg,y,G);
  return armGun(cfg,y,G, cfg.tech==='ehs');
}
// Рисует «руку» с учётом компоновки: сдвиг вдоль оси, укорочение и
// нижний ствол спарки (рисуется первым, приглушённым — он ниже ярусом).
function drawArm(cfg,arm,G){
  // Крайние стволы в банке имеют свободную сторону — только туда и можно
  // выпускать радиаторы и прочее навесное, внутрь ряда оно не влезает.
  const ys=G.bankY||[arm.y];
  const Gx=Object.assign({},G,{ mantletX:G.mantletX+(arm.dx||0), len:G.len*(arm.lenK||1),
    finUp: arm.y<=Math.min.apply(null,ys)+1e-6,
    finDn: arm.y>=Math.max.apply(null,ys)-1e-6 });
  let s='';
  if(arm.twin){
    const Gt=Object.assign({},Gx,{ mantletX:Gx.mantletX-G.bw*0.55, len:Gx.len*0.94,
      finUp:false, finDn:false });
    s+=`<g opacity="0.66">${armOne(cfg, arm.y+G.bw*0.80, Gt)}</g>`;
  }
  s+=armOne(cfg, arm.y, Gx);
  return s;
}

// ── §7. БАШНЯ — силуэт по семейству класса ───────────────────
// Детализация меняет САМ КОРПУС, а не навес: от неё зависит, сколько
// ярусов брони сложено в башне, насколько дробно срезаны углы и как густо
// идёт расшивка. На 0 — глухая коробка в два слоя, на 1 — многослойная
// ступенчатая конструкция с фасками и швами.
function tiers(cfg){ return 2+Math.round((+cfg.detail||0)*4); }   // 2..6 ярусов
function common(cfg,G,shape,hz){
  const n=tiers(cfg);
  let s='';
  for(let i=0;i<n;i++){
    const k=i/(n-1||1);
    const sh = i===0 ? shape
      : chamfer(inset(shape, G.bw*(0.70+1.15*k)), G.bw*(0.30+0.55*(+cfg.detail||0)));
    s+=solid(sh, i%2 ? 'plate':'hull', hz*(1-0.28*k), {sw: i===0?2.4:1.8, dark: i===n-1 && n>2});
  }
  const d=+cfg.detail||0, bw=G.bw, BL=G.BL, BH=G.BH;
  // Расшивка по ярусам
  const seams=Math.round(1+d*5);
  for(let i=1;i<=seams;i++){
    const y=BH*(0.44*i/(seams+1));
    s+=line([[-BL*0.34,-y],[BL*0.40,-y]],1.2,0.34);
    s+=line([[-BL*0.34, y],[BL*0.40, y]],1.2,0.34);
  }
  // Со средней детализации — вырезы-ниши в самой броне и болтовые пояса
  if(d>0.3){
    const cuts=Math.round(d*4);
    for(let i=0;i<cuts;i++){
      const x=-BL*0.30+i*(BL*0.58/Math.max(1,cuts));
      for(const sg of [-1,1])
        s+=plate(chamfer(rect(x, sg>0?BH*0.20:-BH*0.32, BL*0.58/Math.max(1,cuts)*0.62, BH*0.12), bw*0.18),
                 'plate',{sw:1.2,dark:true});
    }
    s+=bolts([[-BL*0.34,-BH*0.40],[BL*0.26,-BH*0.40]],bw*0.075,bw*1.3);
    s+=bolts([[-BL*0.34, BH*0.40],[BL*0.26, BH*0.40]],bw*0.075,bw*1.3);
  }
  // С высокой — угловые контрфорсы, меняющие силуэт по периметру
  if(d>0.62){
    for(const sx of [-1,1]) for(const sy of [-1,1])
      s+=solid(chamfer(rect(sx>0?BL*0.30:-BL*0.46, sy>0?BH*0.30:-BH*0.44, BL*0.16, BH*0.14), bw*0.20),
               'greeble', bw*0.34, {dark:true, sw:1.5});
  }
  return s;
}
function mantlet(cfg,G,hz,wide){
  const bw=G.bw, mx=G.mantletX, mH=G.bankSpan+bw*(wide?2.0:1.7);
  let s=solid(chamfer([
    [mx-bw*2.9,-mH*0.40],[mx-bw*1.3,-mH*0.50],[mx+bw*0.7,-mH*0.42],
    [mx+bw*0.7, mH*0.42],[mx-bw*1.3, mH*0.50],[mx-bw*2.9, mH*0.40],
  ],bw*0.40),'plate',hz*1.15,{sw:2.2});
  if(effLayout(cfg)==='rotary'){
    const r=mH*0.46,cx=mx-bw*0.9;
    s+=`<circle cx="${n2(cx)}" cy="0" r="${n2(r)}" fill="url(#b_plate)" stroke="${INK}" stroke-width="${n2(2.2*SWK)}" data-slot="plate"/>`
      +`<circle cx="${n2(cx)}" cy="0" r="${n2(r*0.80)}" fill="url(#d_plate)" stroke="${INK}" stroke-width="${n2(1.4*SWK)}" data-slot="plate"/>`;
    for(let i=0;i<10;i++){const a=i/10*Math.PI*2;
      s+=`<circle cx="${n2(cx+Math.cos(a)*r*0.90)}" cy="${n2(Math.sin(a)*r*0.90)}" r="${n2(r*0.045)}" fill="${INK}" opacity="0.6"/>`;}
  }
  // ОБЩИЙ БЛОК БАНКА. Без него несколько стволов в ряд читаются как
  // отдельные палки, воткнутые в башню. Плита перекрывает весь размах
  // стволов и уходит вперёд — стволы выходят из одного тела.
  const lay=effLayout(cfg), arms=G.arms||[];
  if(arms.length>1 && lay!=='rotary'){
    let lo=Infinity, hi=-Infinity, back=0;
    for(const a of arms){ lo=Math.min(lo,a.y); hi=Math.max(hi,a.y); back=Math.min(back,a.dx||0); }
    const y0=lo-bw*1.05, y1=hi+bw*1.05;
    s+=solid(chamfer([[mx-bw*2.2+back, y0+bw*0.5],[mx-bw*1.2+back, y0],
                      [mx+bw*1.9, y0],[mx+bw*2.5, y0+bw*0.8],
                      [mx+bw*2.5, y1-bw*0.8],[mx+bw*1.9, y1],
                      [mx-bw*1.2+back, y1],[mx-bw*2.2+back, y1-bw*0.5]], bw*0.55),
             'plate', hz*1.25, {sw:2.2});
    // Продольные рёбра между стволами — связывают банк в одно целое
    for(let i=0;i<arms.length-1;i++){
      const ym=(arms[i].y+arms[i+1].y)/2;
      s+=plate(rect(mx-bw*1.6+back, ym-bw*0.16, bw*3.9, bw*0.32),'greeble',{sw:1.2,dark:true});
    }
    s+=bolts([[mx-bw*1.0+back,y0+bw*0.45],[mx+bw*1.9,y0+bw*0.45]],bw*0.075,bw*1.4);
    s+=bolts([[mx-bw*1.0+back,y1-bw*0.45],[mx+bw*1.9,y1-bw*0.45]],bw*0.075,bw*1.4);
  }
  // Воротник амбразуры под каждый ствол — банк читается как один узел
  if(effLayout(cfg)!=='rotary') for(const a of (G.arms||[])){
    const ax=mx+(a.dx||0);
    s+=solid(chamfer(rect(ax-bw*0.75, a.y-bw*0.92, bw*1.5, bw*1.84), bw*0.30),
             'greeble', hz*0.55, {noShadow:1, dark:true, sw:1.5});
  }
  return s;
}
function powerBus(cfg,G,x0,x1){
  if(cfg.power<250) return '';
  const bw=G.bw,BH=G.BH; let s='';
  const nb=cfg.power>=800?3:2;
  for(let i=0;i<nb;i++){
    const y=-BH*0.17+i*(BH*0.34/Math.max(1,nb-1));
    const p=`M ${n2(x0)} ${n2(y)} C ${n2(x0*0.3)} ${n2(y*1.6)}, ${n2(x1*0.4)} ${n2(y*0.5)}, ${n2(x1)} ${n2(y)}`;
    s+=`<path d="${p}" fill="none" stroke="${INK}" stroke-width="${n2(bw*0.32)}" stroke-linecap="round" opacity="0.9"/>`
      +`<path d="${p}" fill="none" stroke="${cfg.accent}" stroke-width="${n2(bw*0.14)}" opacity="0.5"/>`;
    for(const t of [0.28,0.62,0.88]){ const x=x0+(x1-x0)*t;
      s+=plate(rect(x-bw*0.11,y-bw*0.28,bw*0.22,bw*0.56),'greeble',{sw:1}); }
  }
  return s;
}
function radiators(cfg,G){
  const {bw,BL,BH}=G;
  const fins=Math.max(2,Math.min(11,Math.round(Math.log10(Math.max(10,cfg.rof))*3.4)));
  const fw=BL*0.52/fins; let s='';
  for(let i=0;i<fins;i++){ const x=-BL*0.26+i*fw;
    s+=plate(rect(x,-BH*0.52,fw*0.58,BH*0.115),'greeble',{sw:1,dark:true});
    s+=plate(rect(x, BH*0.405,fw*0.58,BH*0.115),'greeble',{sw:1,dark:true}); }
  return s;
}

// Полоски-акценты по бортам — общий приём всех корабельных корпусов
function stripes(cfg,G,x0,x1,yk){
  const {bw,BL,BH}=G; let s='';
  for(const sg of [-1,1])
    s+=`<path d="M ${n2(BL*x0)} ${n2(sg*BH*yk)} L ${n2(BL*x1)} ${n2(sg*BH*yk)}" fill="none"`
      +` stroke="${cfg.accent}" stroke-width="${n2(bw*0.26)}" opacity="0.8"/>`;
  return s;
}

// Станина пусковой установки. wide=true — РСУ: шире, с транспортно-
// заряжающей рампой в корме; false — РПУ: компактнее, с ящиками ЗИП.
function launchBase(cfg,G,wide){
  const {bw,BL,BH}=G, hz=bw*0.48;
  const w=wide?1.10:0.94;
  let s='';
  // Поворотный круг — виден из-под станины
  s+=`<circle cx="0" cy="0" r="${n2(Math.max(BH*0.42,bw*2.2))}" fill="url(#d_base)" stroke="${INK}"`
    +` stroke-width="${n2(2*SWK)}" data-slot="base"/>`;
  // Станина: открытая рама, а не бронекоробка
  s+=solid(chamfer([[-BL*0.52,-BH*0.30*w],[-BL*0.34,-BH*0.42*w],[BL*0.26,-BH*0.42*w],
                    [ BL*0.44,-BH*0.24*w],[ BL*0.44, BH*0.24*w],[BL*0.26, BH*0.42*w],
                    [-BL*0.34, BH*0.42*w],[-BL*0.52, BH*0.30*w]],bw*0.44),'hull',hz*1.1,{sw:2.2});
  // Продольные лонжероны рамы
  for(const sg of [-1,1])
    s+=plate(rect(-BL*0.44,sg*BH*0.28*w-(sg>0?0:bw*0.34),BL*0.84,bw*0.34),'plate',{sw:1.4,dark:true});
  // Гидроцилиндры подъёма пакета — к цапфам
  for(const sg of [-1,1]){
    const yc=sg*(G.bankSpan*0.42+bw*0.70);
    s+=solid(chamfer(rect(-BL*0.20,yc-bw*0.36,BL*0.58,bw*0.72),bw*0.26),'greeble',hz*0.9,{sw:1.7});
    s+=`<path d="${poly([[-BL*0.16,yc-bw*0.24],[BL*0.32,yc-bw*0.24],[BL*0.32,yc-bw*0.04],[-BL*0.16,yc-bw*0.04]])}" fill="url(#spec)"/>`;
    s+=tube(BL*0.34,yc,bw*0.36,'greeble');
  }
  // Цапфы — узел качания пакета
  for(const sg of [-1,1]) s+=tube(G.mantletX-bw*1.9, sg*(G.bankSpan*0.5+bw*0.35), bw*0.52,'greeble');
  // Корма: у РСУ — рампа ТЗМ с направляющими, у РПУ — ящики ЗИП
  if(wide){
    s+=solid(chamfer(rect(-BL*0.90,-BH*0.34,BL*0.34,BH*0.68),bw*0.30),'greeble',hz*0.9,{dark:true});
    for(let i=0;i<4;i++) s+=line([[-BL*0.86,-BH*0.26+i*BH*0.17],[-BL*0.60,-BH*0.26+i*BH*0.17]],bw*0.14,0.7);
  } else {
    for(const sg of [-1,1])
      s+=solid(chamfer(rect(-BL*0.84, sg>0?BH*0.04:-BH*0.34, BL*0.28, BH*0.30),bw*0.24),'greeble',hz*0.8,{dark:true});
  }
  // Блок аппаратуры наведения на станине
  s+=solid(chamfer(rect(-BL*0.24,-BH*0.14,bw*1.6,bw*1.5),bw*0.24),'greeble',hz*0.8);
  s+=`<ellipse cx="${n2(-BL*0.24+bw*0.8)}" cy="${n2(-BH*0.14+bw*0.75)}" rx="${n2(bw*0.40)}" ry="${n2(bw*0.34)}"`
    +` fill="url(#m_glass)" stroke="${INK}" stroke-width="${n2(1.4*SWK)}" data-slot="glass"/>`;
  s+=powerBus(cfg,G,-BL*0.44,BL*0.24);
  s+=stripes(cfg,G,-0.30,0.12,0.34*w);
  return s;
}

const BODY = {
  // ЛЁГКОЕ КОРАБЕЛЬНОЕ: узкая обтекаемая гондола. Корма сходит на конус,
  // навесного минимум, один боковой спонсон. Читается как «малый калибр».
  shipL(cfg,G){
    const {bw,BL,BH}=G, hz=bw*0.46;
    let s=common(cfg,G,chamfer([
      [-BL*0.62,-BH*0.14],[-BL*0.40,-BH*0.38],[BL*0.18,-BH*0.44],
      [ BL*0.54,-BH*0.26],[ BL*0.54, BH*0.26],[BL*0.18, BH*0.44],
      [-BL*0.40, BH*0.38],[-BL*0.62, BH*0.14],
    ],bw*0.80),hz);
    // Продольный хребет вместо палубных швов
    s+=line([[-BL*0.46,0],[BL*0.44,0]],1.6,0.38);
    s+=solid(chamfer(rect(-BL*0.52,-BH*0.14,BL*0.20,BH*0.28),bw*0.34),'greeble',hz*0.7,{dark:true});
    // Один спонсон сбоку
    s+=solid(chamfer(rect(-BL*0.14,-BH*0.56,BL*0.30,BH*0.20),bw*0.24),'greeble',hz*0.6);
    s+=grille(-BL*0.10,-BH*0.52,BL*0.20,BH*0.12);
    s+=powerBus(cfg,G,-BL*0.44,BL*0.40);
    s+=stripes(cfg,G,-0.30,0.16,0.34);
    s+=mantlet(cfg,G,hz,false);
    return s;
  },

  // СРЕДНЕЕ КОРАБЕЛЬНОЕ: гранёный клин с выраженными «плечами» и двумя
  // бортовыми спонсонами, палубные швы с заклёпками, мачта РЛС.
  shipM(cfg,G){
    const {bw,BL,BH}=G, hz=bw*0.54, rnd=rng(cfg.seed);
    let s=common(cfg,G,chamfer([
      [-BL*0.52,-BH*0.30],[-BL*0.34,-BH*0.52],[BL*0.06,-BH*0.56],
      [ BL*0.34,-BH*0.42],[ BL*0.56,-BH*0.22],[BL*0.56, BH*0.22],
      [ BL*0.34, BH*0.42],[ BL*0.06, BH*0.56],[-BL*0.34,BH*0.52],[-BL*0.52,BH*0.30],
    ],bw*0.58),hz);
    // Плечевые накладки
    for(const sg of [-1,1])
      s+=solid(chamfer([[-BL*0.26,sg*BH*0.44],[BL*0.10,sg*BH*0.48],[BL*0.30,sg*BH*0.34],
                        [BL*0.06,sg*BH*0.28],[-BL*0.24,sg*BH*0.26]],bw*0.26),'plate',hz*0.55,{noShadow:1,sw:1.6});
    s+=line([[-BL*0.38,-BH*0.14],[BL*0.44,-BH*0.14]],1.3,0.42);
    s+=line([[-BL*0.38, BH*0.14],[BL*0.44, BH*0.14]],1.3,0.42);
    s+=bolts([[-BL*0.34,-BH*0.36],[BL*0.06,-BH*0.36]],bw*0.075,bw*1.5);
    s+=bolts([[-BL*0.34, BH*0.36],[BL*0.06, BH*0.36]],bw*0.075,bw*1.5);
    s+=solid(chamfer(rect(-BL*0.68,-BH*0.24,BL*0.22,BH*0.48),bw*0.40),'greeble',hz*0.8,{dark:true});
    s+=grille(-BL*0.65,-BH*0.15,BL*0.15,BH*0.30);
    s+=radiators(cfg,G);
    s+=powerBus(cfg,G,-BL*0.44,BL*0.42);
    const zones=[[-0.26,-0.28],[-0.26,0.18],[0.12,-0.30],[0.12,0.22]];
    const gn=Math.round(1+cfg.detail*zones.length);
    for(let i=0;i<gn&&i<zones.length;i++){
      const w=bw*(0.9+rnd()*1.2), h=bw*(0.7+rnd()*0.9);
      s+=solid(chamfer(rect(BL*zones[i][0],BH*zones[i][1],w,h),Math.min(w,h)*0.24),'greeble',hz*0.55,{dark:rnd()>0.55,sw:1.4});
    }
    // Мачта РЛС
    s+=solid(chamfer(rect(-BL*0.18,-BH*0.07,bw*1.5,bw*1.3),bw*0.26),'greeble',hz*0.7);
    s+=`<ellipse cx="${n2(-BL*0.18+bw*0.75)}" cy="${n2(-BH*0.07+bw*0.65)}" rx="${n2(bw*0.42)}" ry="${n2(bw*0.34)}"`
      +` fill="url(#m_glass)" stroke="${INK}" stroke-width="${n2(1.4*SWK)}" data-slot="glass"/>`;
    s+=stripes(cfg,G,-0.28,0.06,0.47);
    s+=mantlet(cfg,G,hz,true);
    return s;
  },

  // ТЯЖЁЛОЕ КОРАБЕЛЬНОЕ: приземистый каземат со ступенчатой бронёй в три
  // яруса, угловые контрфорсы, глубокая кормовая ниша. Тяжесть за счёт
  // слоёв, а не размера.
  shipH(cfg,G){
    const {bw,BL,BH}=G, hz=bw*0.62;
    const box=k=>chamfer([
      [-BL*0.52*k,-BH*0.40*k],[-BL*0.38*k,-BH*0.54*k],[BL*0.32*k,-BH*0.54*k],
      [ BL*0.58*k,-BH*0.32*k],[ BL*0.58*k, BH*0.32*k],[BL*0.32*k, BH*0.54*k],
      [-BL*0.38*k, BH*0.54*k],[-BL*0.52*k,-0+BH*0.40*k],
    ],bw*0.50);
    // Угловые контрфорсы — торчат из-под нижнего яруса
    let s='';
    for(const sx of [-1,1]) for(const sy of [-1,1])
      s+=solid(chamfer(rect(sx>0?BL*0.30:-BL*0.54, sy>0?BH*0.36:-BH*0.58, BL*0.24, BH*0.22),bw*0.20),
               'greeble',hz*0.7,{dark:true,sw:1.6});
    // Ступенчатая броня — число ярусов от детализации (3..5)
    const nt=3+Math.round((+cfg.detail||0)*2);
    for(let i=0;i<nt;i++){
      const k=1-i*(0.42/(nt-1||1));
      s+=solid(box(k), i%2?'plate':'hull', hz*(1-0.16*i), {sw:i===0?2.6:1.8, dark:i===nt-1});
    }
    s+=bolts([[-BL*0.34,-BH*0.44],[BL*0.26,-BH*0.44]],bw*0.085,bw*1.4);
    s+=bolts([[-BL*0.34, BH*0.44],[BL*0.26, BH*0.44]],bw*0.085,bw*1.4);
    // Глубокая кормовая ниша с подъёмником
    s+=solid(chamfer(rect(-BL*0.78,-BH*0.30,BL*0.28,BH*0.60),bw*0.44),'greeble',hz*0.9,{dark:true});
    s+=grille(-BL*0.74,-BH*0.20,BL*0.20,BH*0.40);
    for(let i=0;i<3;i++) s+=line([[-BL*0.50,-BH*0.18+i*BH*0.18],[-BL*0.36,-BH*0.18+i*BH*0.18]],bw*0.12,0.7);
    s+=radiators(cfg,G);
    s+=powerBus(cfg,G,-BL*0.46,BL*0.40);
    s+=stripes(cfg,G,-0.26,0.20,0.48);
    s+=mantlet(cfg,G,hz,true);
    return s;
  },

  // СУПЕРОРУЖИЕ: восьмигранная плита-монолит, радиальные контрфорсы по
  // всем углам, «крылья» брони вокруг маски, ступенчатая пирамида плит.
  shipS(cfg,G){
    const {bw,BL,BH}=G, hz=bw*0.86;
    // Слегка вытянутый по оси огня восьмигранник — не «шайба», а редут
    const oct=k=>{const p=[];for(let i=0;i<8;i++){const a=i/8*Math.PI*2+Math.PI/8;
      p.push([Math.cos(a)*BL*0.60*k, Math.sin(a)*BH*0.58*k]);} return chamfer(p,bw*0.50);};
    let s='';
    // Восемь массивных контрфорсов-«лап» наружу: читаются как опоры редута
    for(let i=0;i<8;i++){ const a=i/8*Math.PI*2+Math.PI/8, ca=Math.cos(a), sa=Math.sin(a);
      const r0=0.50, r1=0.76, w=bw*1.25;
      s+=solid(chamfer([[ca*BL*r0+sa*w, sa*BH*r0-ca*w],[ca*BL*r1+sa*w*0.62, sa*BH*r1-ca*w*0.62],
                        [ca*BL*r1-sa*w*0.62, sa*BH*r1+ca*w*0.62],[ca*BL*r0-sa*w, sa*BH*r0+ca*w]],bw*0.34),
               'greeble',hz*0.9,{dark:true,sw:1.8}); }
    // Ступенчатая пирамида — количество ярусов от детализации
    const n=3+Math.round((+cfg.detail||0)*2);
    for(let i=0;i<n;i++){
      const k=1-i*(0.52/(n-1||1));
      s+=solid(oct(k), i%2?'plate':'hull', hz*(1-0.15*i), {sw:i===0?3.0:2.0, dark:i===n-1});
      s+=bolts([[-BL*0.34*k,-BH*0.46*k],[BL*0.30*k,-BH*0.46*k]],bw*0.10,bw*1.5);
      s+=bolts([[-BL*0.34*k, BH*0.46*k],[BL*0.30*k, BH*0.46*k]],bw*0.10,bw*1.5);
    }
    // Бронекрылья вокруг маски — вынесены дальше и толще
    for(const sg of [-1,1])
      s+=solid(chamfer([[BL*0.06,sg*BH*0.56],[BL*0.70,sg*BH*0.44],[BL*0.74,sg*BH*0.16],
                        [BL*0.12,sg*BH*0.26]],bw*0.40),'plate',hz*1.05,{sw:2.2});
    // Два кормовых элеватора подачи вместо одной решётки
    for(const sg of [-1,1]){
      s+=solid(chamfer(rect(-BL*0.80, sg>0?BH*0.06:-BH*0.34, BL*0.26, BH*0.28),bw*0.30),'greeble',hz*0.85,{dark:true});
      s+=grille(-BL*0.77, sg>0?BH*0.11:-BH*0.29, BL*0.20, BH*0.18);
    }
    s+=radiators(cfg,G);
    s+=powerBus(cfg,G,-BL*0.46,BL*0.40);
    s+=stripes(cfg,G,-0.24,0.16,0.52);
    s+=mantlet(cfg,G,hz,true);
    return s;
  },

  // ПВО: низкая широкая тумба, открытый станок, барабаны боепитания,
  // РЛС наведения. Корпуса почти нет — механизм на виду.
  aa(cfg,G){
    const {bw,BL,BH}=G, hz=bw*0.44;
    let s=common(cfg,G,chamfer([
      [-BL*0.46,-BH*0.30],[-BL*0.22,-BH*0.50],[BL*0.24,-BH*0.50],[BL*0.50,-BH*0.24],
      [ BL*0.50, BH*0.24],[ BL*0.24, BH*0.50],[-BL*0.22,BH*0.50],[-BL*0.46,BH*0.30],
    ],bw*0.70),hz);
    // Барабаны боепитания
    for(const sg of [-1,1]) s+=tube(-BL*0.20, sg*BH*0.30, bw*1.25,'greeble');
    // Открытые лонжероны станка к маске
    for(const sg of [-1,1])
      s+=solid(chamfer([[-BL*0.06,sg*BH*0.10],[BL*0.46,sg*BH*0.26],[BL*0.46,sg*BH*0.10],[-BL*0.06,sg*BH*0.02]],bw*0.16),
               'greeble',hz*0.6,{noShadow:1,sw:1.5});
    // РЛС наведения
    s+=solid(chamfer(rect(-BL*0.44,-BH*0.13,bw*1.3,bw*2.0),bw*0.22),'greeble',hz*0.8);
    s+=`<ellipse cx="${n2(-BL*0.44+bw*0.65)}" cy="${n2(-BH*0.13+bw*1.0)}" rx="${n2(bw*0.42)}" ry="${n2(bw*0.72)}"`
      +` fill="url(#m_glass)" stroke="${INK}" stroke-width="${n2(1.5*SWK)}" data-slot="glass"/>`;
    s+=radiators(cfg,G);
    s+=mantlet(cfg,G,hz,false);
    return s;
  },

  // ТАНК: клиновидная башня — узкая в лоб, широкая в корме, наклонные
  // скулы, кормовая корзина-сетка, блок дымовых гранатомётов.
  tank(cfg,G){
    const {bw,BL,BH}=G, hz=bw*0.50;
    let s=common(cfg,G,chamfer([
      [-BL*0.44,-BH*0.50],[ BL*0.10,-BH*0.44],[BL*0.56,-BH*0.20],
      [ BL*0.56, BH*0.20],[ BL*0.10, BH*0.44],[-BL*0.44,BH*0.50],
      [-BL*0.52, BH*0.24],[-BL*0.52,-BH*0.24],
    ],bw*0.40),hz);
    // Скуловые накладки — подчёркивают клин
    for(const sg of [-1,1])
      s+=plate(chamfer([[BL*0.02,sg*BH*0.40],[BL*0.50,sg*BH*0.18],[BL*0.50,sg*BH*0.06],[BL*0.02,sg*BH*0.28]],bw*0.20),
               'plate',{sw:1.5,dark:true});
    // Кормовая корзина
    s+=basket(-BL*0.72,-BH*0.30,BL*0.24,BH*0.60);
    s+=plate(rect(-BL*0.50,-BH*0.32,bw*0.30,BH*0.64),'greeble',{sw:1.3});
    // Дымовые гранатомёты
    for(const sg of [-1,1]) for(let i=0;i<3;i++)
      s+=tube(BL*0.04+i*bw*0.86, sg*BH*0.36, bw*0.34,'greeble');
    // Люк
    s+=`<circle cx="${n2(-BL*0.16)}" cy="${n2(-BH*0.14)}" r="${n2(bw*1.15)}" fill="url(#b_greeble)" stroke="${INK}" stroke-width="${n2(2*SWK)}" data-slot="greeble"/>`
      +`<circle cx="${n2(-BL*0.16)}" cy="${n2(-BH*0.14)}" r="${n2(bw*0.80)}" fill="url(#d_greeble)" stroke="${INK}" stroke-width="${n2(1.2*SWK)}" data-slot="greeble"/>`;
    s+=powerBus(cfg,G,-BL*0.40,BL*0.40);
    for(const sg of [-1,1])
      s+=`<path d="M ${n2(-BL*0.30)} ${n2(sg*BH*0.44)} L ${n2(BL*0.04)} ${n2(sg*BH*0.40)}" fill="none"`
        +` stroke="${cfg.accent}" stroke-width="${n2(bw*0.24)}" opacity="0.8"/>`;
    s+=mantlet(cfg,G,hz,false);
    return s;
  },

  // БТР: маленький необитаемый модуль — коробка со срезом, внешний
  // боекороб, блок дымовых, тонкая сенсорная стойка. Ничего лишнего.
  apc(cfg,G){
    const {bw,BL,BH}=G, hz=bw*0.46;
    let s=common(cfg,G,chamfer([
      [-BL*0.44,-BH*0.42],[BL*0.20,-BH*0.42],[BL*0.52,-BH*0.16],
      [ BL*0.52, BH*0.16],[BL*0.20, BH*0.42],[-BL*0.44,BH*0.42],
    ],bw*0.34),hz);
    // Внешний боекороб сбоку
    s+=solid(chamfer(rect(-BL*0.30,-BH*0.72,BL*0.46,BH*0.28),bw*0.20),'greeble',hz*0.8,{dark:true});
    s+=line([[-BL*0.26,-BH*0.58],[BL*0.12,-BH*0.58]],1.2,0.5);
    // Дымовые
    for(let i=0;i<3;i++) s+=tube(BL*0.06+i*bw*0.80, BH*0.56, bw*0.30,'greeble');
    // Сенсорная стойка
    s+=solid(chamfer(rect(-BL*0.40,BH*0.10,bw*0.9,bw*1.5),bw*0.18),'greeble',hz*0.7);
    s+=`<ellipse cx="${n2(-BL*0.40+bw*0.45)}" cy="${n2(BH*0.10+bw*0.75)}" rx="${n2(bw*0.26)}" ry="${n2(bw*0.42)}"`
      +` fill="url(#m_glass)" stroke="${INK}" stroke-width="${n2(1.3*SWK)}" data-slot="glass"/>`;
    s+=`<path d="M ${n2(-BL*0.24)} ${n2(-BH*0.30)} L ${n2(BL*0.16)} ${n2(-BH*0.30)}" fill="none"`
      +` stroke="${cfg.accent}" stroke-width="${n2(bw*0.24)}" opacity="0.8"/>`;
    s+=mantlet(cfg,G,hz,false);
    return s;
  },

  // АРТА: длинный станок, два противооткатника вдоль ствола, лоток
  // заряжания в корме, откидные сошники-противовесы.
  arty(cfg,G){
    const {bw,BL,BH}=G, hz=bw*0.52;
    let s=common(cfg,G,chamfer([
      [-BL*0.56,-BH*0.28],[-BL*0.40,-BH*0.46],[BL*0.34,-BH*0.46],
      [ BL*0.58,-BH*0.26],[ BL*0.58, BH*0.26],[BL*0.34, BH*0.46],
      [-BL*0.40, BH*0.46],[-BL*0.56, BH*0.28],
    ],bw*0.50),hz);
    // Противооткатники — два толстых цилиндра к маске
    for(const sg of [-1,1]){
      const yc=sg*(G.bankSpan*0.5+bw*1.15);
      s+=solid(chamfer(rect(-BL*0.10,yc-bw*0.44,BL*0.74,bw*0.88),bw*0.30),'greeble',hz*0.9);
      s+=`<path d="${poly([[-BL*0.06,yc-bw*0.30],[BL*0.60,yc-bw*0.30],[BL*0.60,yc-bw*0.06],[-BL*0.06,yc-bw*0.06]])}" fill="url(#spec)"/>`;
      for(let i=0;i<3;i++) s+=line([[-BL*0.02+i*BL*0.20,yc-bw*0.42],[-BL*0.02+i*BL*0.20,yc+bw*0.42]],1.2,0.5);
    }
    // Лоток заряжания
    s+=solid(chamfer(rect(-BL*0.80,-BH*0.16,BL*0.30,BH*0.32),bw*0.22),'greeble',hz*0.75,{dark:true});
    for(let i=0;i<4;i++) s+=line([[-BL*0.76+i*BL*0.07,-BH*0.14],[-BL*0.76+i*BL*0.07,BH*0.14]],1.3,0.55);
    // Сошники
    for(const sg of [-1,1])
      s+=solid(chamfer([[-BL*0.50,sg*BH*0.42],[-BL*0.20,sg*BH*0.50],[-BL*0.18,sg*BH*0.66],[-BL*0.52,sg*BH*0.58]],bw*0.16),
               'plate',hz*0.6,{dark:true,sw:1.5});
    s+=radiators(cfg,G);
    s+=powerBus(cfg,G,-BL*0.48,BL*0.30);
    s+=mantlet(cfg,G,hz,true);
    return s;
  },

  // ПУСКОВЫЕ (РПУ/РСУ): башни НЕТ. Есть низкая поворотная станина, на ней
  // качающаяся рама с цапфами и гидроподъёмом, в корме — аппаратура и
  // перезарядка. Ни маски, ни бронеярусов: пакет открыт.
  pu(cfg,G){ return launchBase(cfg,G,false); },
  mlrs(cfg,G){ return launchBase(cfg,G,true); },

  // МБР: не установка, а СТАРТОВЫЙ СТОЛ. Прямоугольная плита с обваловкой,
  // газоотводные каналы по бортам, шкаф автоматики. Ничего вращающегося.
  silo(cfg,G){
    const {bw,BL,BH}=G, hz=bw*0.70;
    let s=solid(chamfer([
      [-BL*0.60,-BH*0.44],[-BL*0.44,-BH*0.60],[BL*0.44,-BH*0.60],[BL*0.60,-BH*0.44],
      [ BL*0.60, BH*0.44],[BL*0.44, BH*0.60],[-BL*0.44,BH*0.60],[-BL*0.60,BH*0.44],
    ],bw*0.60),'base',hz*1.3,{sw:2.6});
    // Газоотводные каналы — глубокие тёмные щели вдоль бортов
    for(const sg of [-1,1]){
      s+=plate(rect(-BL*0.44,sg*BH*0.40-(sg>0?0:BH*0.14),BL*0.88,BH*0.14),'plate',{dark:true,sw:1.6});
      s+=grille(-BL*0.38,sg*BH*0.42-(sg>0?0:BH*0.10),BL*0.76,BH*0.10);
    }
    // Обваловка: ступенчатый второй ярус
    s+=solid(chamfer(rect(-BL*0.46,-BH*0.34,BL*0.92,BH*0.68),bw*0.44),'hull',hz*0.9,{dark:true,sw:2.0});
    s+=bolts([[-BL*0.40,-BH*0.30],[BL*0.36,-BH*0.30]],bw*0.09,bw*1.6);
    s+=bolts([[-BL*0.40, BH*0.30],[BL*0.36, BH*0.30]],bw*0.09,bw*1.6);
    // Шкаф автоматики и трансформатор в корме
    s+=solid(chamfer(rect(-BL*0.86,-BH*0.26,BL*0.28,BH*0.52),bw*0.34),'greeble',hz*0.9,{dark:true});
    s+=grille(-BL*0.82,-BH*0.18,BL*0.20,BH*0.36);
    s+=powerBus(cfg,G,-BL*0.56,BL*0.30);
    s+=stripes(cfg,G,-0.34,0.24,0.24);
    return s;
  },

  // ДРОН: башни нет — вилка-скоба из двух щёк держит оружие,
  // между ними компактный привод.
  drone(cfg,G){
    const {bw,BL,BH}=G, hz=bw*0.34;
    let s='';
    for(const sg of [-1,1])
      s+=solid(chamfer([[-BL*0.34,sg*BH*0.16],[BL*0.50,sg*BH*0.34],[BL*0.54,sg*BH*0.16],[-BL*0.30,sg*BH*0.06]],bw*0.22),
               'hull',hz,{sw:1.9});
    s+=solid(chamfer(rect(-BL*0.34,-BH*0.22,BL*0.42,BH*0.44),bw*0.30),'plate',hz*0.9);
    s+=`<circle cx="${n2(-BL*0.13)}" cy="0" r="${n2(bw*0.62)}" fill="url(#d_greeble)" stroke="${INK}" stroke-width="${n2(1.4*SWK)}" data-slot="greeble"/>`;
    s+=`<path d="M ${n2(-BL*0.30)} ${n2(-BH*0.16)} L ${n2(BL*0.02)} ${n2(-BH*0.16)}" fill="none"`
      +` stroke="${cfg.accent}" stroke-width="${n2(bw*0.22)}" opacity="0.8"/>`;
    // Маска компактная
    const mH=G.bankSpan+bw*1.1;
    s+=solid(chamfer(rect(G.mantletX-bw*1.6,-mH*0.5,bw*2.2,mH),bw*0.28),'plate',hz*1.1);
    return s;
  },
};
function drawTurret(cfg,G){
  const fam=(CLASSES[cfg.klass]||CLASSES.medium).fam;
  return (BODY[fam]||BODY.shipM)(cfg,G);
}

// ── §8. Геометрия ────────────────────────────────────────────
// Пропорции корпуса задаются семейством: корабль — длинный и широкий,
// ПВО — приземистое, танк — клин, дрон — почти без корпуса.
const FAM_BOX = {
  shipL: { lenK:1.18, hK:0.72 },   // узкая длинная гондола
  shipM: { lenK:1.00, hK:1.00 },   // сбалансированный клин
  shipH: { lenK:0.88, hK:1.18 },   // приземистый широкий каземат
  shipS: { lenK:1.02, hK:1.30 },   // монолитная плита
  aa:    { lenK:0.74, hK:1.22 },
  tank:  { lenK:1.06, hK:0.92 },
  apc:   { lenK:0.86, hK:0.88 },
  arty:  { lenK:1.22, hK:1.04 },
  pu:    { lenK:1.14, hK:0.94 },   // станина пусковой — низкая и длинная
  mlrs:  { lenK:1.06, hK:1.10 },   // РСУ шире: пакет растёт вширь
  silo:  { lenK:1.00, hK:1.16 },   // стартовый стол
  drone: { lenK:0.62, hK:0.70 },
};
function famOf(cfg){ return (CLASSES[cfg.klass]||CLASSES.medium).fam; }
function geom(cfg){
  const K=CLASSES[cfg.klass]||CLASSES.medium, F=FAM_BOX[K.fam]||FAM_BOX.ship;
  const S=cfg.size*K.s;
  const bwRaw=(3+cfg.caliber*0.11)*S;
  const kind=(TECHS[cfg.tech]||{}).kind;
  // Лазеру нужен более широкий шаг: у эмиттера коробчатый корпус с
  // радиаторными крыльями, при шаге ствольного орудия соседи влезают друг
  // в друга и ряд читается как одна слипшаяся плита.
  // Шаг между стволами — по самой широкой части ИЗДЕЛИЯ, а не по калибру:
  // у лазера это коробка эмиттера с крыльями, у плазмы — дульный раструб,
  // у нано — веер распылителей. При «пушечном» шаге они наезжали друг на
  // друга и ряд читался как одна слипшаяся деталь.
  let wf=1, visible=cfg.barrels,
      spacing=(kind==='beam')?2.95:(kind==='plasma')?2.90:(kind==='nano')?2.70:1.85;
  const lay=effLayout(cfg);
  if(lay==='stacked'){ visible=Math.ceil(cfg.barrels/2); wf=1.42; }
  else if(lay==='quad'){ visible=Math.ceil(cfg.barrels/2); wf=1.42; spacing=1.45; }
  else if(lay==='rotary'){ visible=Math.min(cfg.barrels,3); wf=0.80; spacing=1.15; }
  // Ракетная ПУ — единый пакет труб: число стволов уходит внутрь
  // рисовальщика (это трубы), отдельных «рук» не плодим.
  if(kind==='launcher'){ visible=1; wf=1; }
  // РЭБ — не пушка: «стволы» уходят внутрь рисовальщика полотнами решётки.
  if(kind==='array'){ visible=1; wf=1; }
  const bw=bwRaw*wf;
  const len=bw*cfg.barrelLen*0.14;
  // arms[] — описание каждой видимой «руки»: где стоит, насколько отодвинута
  // назад по оси ствола и есть ли за ней спаренный собрат (нижний ярус).
  const arms=[];
  if(lay==='stacked'){
    // Спарка: сверху видно верхний ствол, нижний выглядывает со смещением
    const step=bw*2.10;
    for(let i=0;i<visible;i++) arms.push({ y:-(visible-1)/2*step+i*step, dx:0, twin:true });
  } else if(lay==='quad'){
    // Блок 2×N: стволы сцеплены плотными парами, между парами явный разрыв.
    // Второй в паре заметно отодвинут назад — пара читается как узел.
    const inPair=bw*1.35, betweenPairs=bw*4.20, pairs=Math.ceil(visible/2);
    for(let p=0;p<pairs;p++){
      const base=-(pairs-1)/2*betweenPairs+p*betweenPairs;
      for(let j=0;j<2 && p*2+j<visible;j++)
        arms.push({ y:base+(j?inPair/2:-inPair/2), dx:j?-bw*1.15:0, twin:false });
    }
  } else if(lay==='rotary'){
    // Ротор: тесный пучок вокруг оси. Стволы тем дальше отведены назад и
    // тем короче видны, чем дальше от центра — читается разворот барабана.
    const step=bw*1.30;
    for(let i=0;i<visible;i++){
      const d=Math.abs(i-(visible-1)/2);
      arms.push({ y:-(visible-1)/2*step+i*step, dx:-d*bw*2.10, lenK:1-d*0.13, twin:false });
    }
  } else {
    const step=bw*spacing;
    for(let i=0;i<visible;i++) arms.push({ y:-(visible-1)/2*step+i*step, dx:0, twin:false });
  }
  let lo=Infinity, hi=-Infinity;
  for(const a of arms){ lo=Math.min(lo,a.y); hi=Math.max(hi,a.y); }
  let bankSpan=Math.max(bw, (hi-lo)+bw*(lay==='stacked'?1.6:1));
  // У ПУ «рука» одна, но пакет труб растёт вширь по числу стволов — ширину
  // берём по пакету, иначе корпус и маска не растут вместе с ним, а трубы
  // вылезают за кадр. Формула зеркалит armLauncher.
  if(kind==='launcher'){
    const K=packOf(cfg,{bw,len});
    bankSpan=Math.max(bankSpan, (K.rows-1)*K.pitchY + K.tr*(K.mode==='silo'?4.2:3.6));
  }
  // РЭБ: ширину задаёт стопка полотен решётки (зеркало armArray).
  if(kind==='array'){
    const faces=Math.max(1,Math.min(6,cfg.barrels|0)), ph=bw*2.30;
    bankSpan=Math.max(bankSpan, (faces-1)*ph*1.16 + ph*1.4);
  }
  const bankY=arms.map(a=>a.y);
  // Шаг между соседними «руками» — по нему рисовальщики зажимают габарит,
  // чтобы навесное одного ствола не залезало на соседний.
  const ys=bankY.slice().sort((a,b)=>a-b);
  let pitch=Infinity;
  for(let i=1;i<ys.length;i++) pitch=Math.min(pitch, ys[i]-ys[i-1]);
  const BH=(bankSpan*1.60+bw*2.4)*F.hK;
  const BL=Math.max(BH*0.90,bw*5.2+36*S)*F.lenK;
  const mantletX=BL*0.52;
  const R=Math.max(BH*0.64,BL*0.58);
  return { S,bw,len,arms,bankY,bankSpan,BH,BL,mantletX,R,visible,pitch };
}

// ── §9. ТТХ ──────────────────────────────────────────────────
// Урон — формула Кваквантора (зеркало constructors_kv_adapt.js:weaponDmg).
// Масса и цена — регрессия по 36 башенным орудиям каталога.
// Коэффициенты берём ИЗ ЖИВОГО KV, если он загружен — иначе из зеркала.
// Так генератор не разъезжается с боёвкой при правке каталога.
const KV_TECH_M={'кинетическое':1,'электрохимическое':1.2,'рельсотрон':1.5,'лазер':1.3,'плазма':1.4,
  'управляемое наведение':1.3,'электромагнитное':1.6};
const KV_DMG_M={'кинетический':1.1,'электрохимическая система':1.6,'взрывной':3.6,'рельсотрон':5.5,
  'энергетический':3.8,'импульсный лазер':1.5,'термический':4};
// Корабельных классов и дрон-пушки здесь нет намеренно: их нет и в KV,
// игра берёт для них 1.
const KV_CLS_M={'турель ПВО':2.5,'турель':1.5,'бронетанковая пушка':1.5,'арторудие':2.4,'гаубица':2.8,
  'танковая пушка':1.9,'турель бтр':1.3,'авиапушка':2};
function kvCoef(table, mirror, key, fallback){
  const live=(window.KV && window.KV[table]) ? window.KV[table][key] : undefined;
  if(live!=null) return live;
  return mirror[key]!=null ? mirror[key] : fallback;
}
const KV_TECH={}, KV_DMG={}, KV_CLS={};   // сохранены для обратной совместимости

// Энергопотребление в каталоге задаётся ТИРОМ платформы, не калибром:
// дрон-пушка 5..25, БТР/танк 10..100, лёгкое кораб. 250, среднее 450..800,
// тяжёлое 850..1000, супероружие 1200..1500. Отсюда база на класс и
// эталонный калибр этого класса (медиана по каталогу).
const POWER_BASE = { drone:15, air:40, apc:30, aa:100, tankgun:100, arty:120,
                     light:250, medium:500, heavy:900, super:1200,
                     mg:20, hw:40, gl:25, howitz:150, rsu:180, rpu:90, rocket:120, brm:400 };
const POWER_REF_CAL = { drone:15, air:45, apc:40, aa:20, tankgun:120, arty:200,
                        light:90, medium:130, heavy:350, super:500,
                        mg:12, hw:30, gl:40, howitz:220, rsu:130, rpu:100, rocket:150, brm:400 };

// ДАЛЬНОСТЬ (АсК) в каталоге тоже привязана к классу, а не абсолютна:
// корабельные орудия сидят на 3..6 независимо от калибра, наземные растут
// до 25 у сверхтяжёлой артиллерии. База — для эталонного калибра класса,
// ЭХС, L/50, компоновка «в ряд».
const RANGE_BASE = { drone:3, air:8, apc:5, aa:4, mg:4, hw:5, gl:4,
                     tankgun:10, arty:18, howitz:22, rsu:9, rpu:8, rocket:12, brm:26,
                     light:4, medium:6, heavy:10, super:14 };
// Компоновка: плотный ротор — оружие подавления, дальность падает
const RANGE_LAYOUT = { row:1.0, stacked:1.0, quad:0.95, rotary:0.80 };

// ТЕМП СТРЕЛЬБЫ. Регрессия по каталогу: rof ≈ 29850·калибр^-1.459·стволы^0.655,
// далее множители технологии, класса и компоновки. Темп падает от калибра,
// длины ствола и «тяжести» технологии — ровно как в каталоге, где 500-мм
// орудие делает 4 выстрела за ход, а 6-мм восьмиствольник — 6000.
const ROF_BASE  = 29850;
const ROF_TECH  = { kinetic:2.6, ehs:1.0, rail:0.50, em:0.35, laser:0.05, plasma:0.15, missile:0.04 };
const ROF_CLASS = { aa:8, drone:2, air:2, apc:1, tankgun:1, arty:0.7,
                    light:1, medium:1, heavy:1, super:1,
                    mg:6, hw:1.5, gl:2, howitz:0.6, rsu:2.5, rpu:1.2, rocket:0.5, brm:0.15 };
const ROF_LAYOUT= { row:1.0, stacked:1.0, quad:1.1, rotary:1.6 };
// Потолок темпа по классу — чистая физика роли: артиллерийский станок не
// выдаёт тысячу выстрелов за ход, даже если формула так посчитала.
const ROF_CAP   = { drone:2000, air:2500, apc:2200, aa:12000, tankgun:6000,
                    arty:60, light:200, medium:120, heavy:60, super:20,
                    mg:4000, hw:400, gl:300, howitz:40, rsu:60, rpu:30, rocket:12, brm:3 };

function rofOf(cfg){
  const kal=Math.max(1,+cfg.caliber||1), n=Math.max(1,cfg.barrels|0);
  // (калибр+10) вместо калибра: у 6–8-мм стволов чистая степень -1.459
  // улетала в десятки тысяч, смещение гасит взрыв на малых калибрах.
  const r = ROF_BASE*1.10 * Math.pow(kal+10,-1.459) * Math.pow(n,0.655)
          * (ROF_TECH[cfg.tech]||1) * (ROF_CLASS[cfg.klass]||1)
          * (ROF_LAYOUT[effLayout(cfg)]||1)
          * Math.pow(50/Math.max(10,+cfg.barrelLen||50), 0.25);
  const capped=Math.min(r, ROF_CAP[cfg.klass]||500);
  return Math.max(1, capped>=100 ? Math.round(capped/10)*10 : Math.round(capped));
}

// Масса и урон — ядро расчёта, вынесено отдельно: энергия считается через
// урон, поэтому формулу надо звать дважды (для сборки и для эталона класса).
function core(cfg){
  const T=TECHS[cfg.tech]||TECHS.ehs, K=CLASSES[cfg.klass]||CLASSES.medium;
  const tC=kvCoef('techCoefficients',KV_TECH_M,T.kvTech,1),
        dC=kvCoef('damageTypeCoefficients',KV_DMG_M,T.kvDmg,0),
        cC=kvCoef('classCoefficients',KV_CLS_M,K.kvClass,1);
  const kal=+cfg.caliber||0, rof=+cfg.rof||0, n=Math.max(1,cfg.barrels|0);
  let mass=74.4*Math.pow(kal,1.095)*Math.pow(1+rof,-0.263)/1.19;
  mass*=Math.pow(n,0.30)*Math.pow(cfg.barrelLen/50,0.55)*Math.pow(cfg.size*K.s,1.4);
  mass=Math.max(20,Math.round(mass/10)*10);
  const one=Math.round(kal*Math.sqrt(mass/n||100)*tC*cC*(1+dC)*(1+rof/5000)/50);
  return { mass, one, damage:Math.max(1,Math.round(one*Math.pow(n,0.85))), tC, dC, cC };
}

function stats(input){
  const cfg=normalize(input);
  // Темп — расчётный, поэтому подставляем его до всего остального:
  // от него зависят и масса, и урон.
  cfg.rof=rofOf(cfg);
  const T=TECHS[cfg.tech]||TECHS.ehs, K=CLASSES[cfg.klass]||CLASSES.medium;
  const kal=+cfg.caliber||0, rof=cfg.rof, n=Math.max(1,cfg.barrels|0);
  const { mass, one, damage, tC, dC, cC } = core(cfg);

  // ЭНЕРГИЯ: база класса × множитель технологии × (урон / урон эталона)^0.55.
  // Эталон — «типовое» орудие этого класса (1 ствол, калибр класса, L/50).
  // Так энергия всегда растёт вместе с реальной мощью сборки: перекачанная
  // пушка не может обойтись дёшево по энергосети, а слабая — не задушит её.
  const base=POWER_BASE[cfg.klass]||500;
  const R0=rulesOf(cfg.klass);
  const refCfg=Object.assign({},cfg,{
    tech: R0.techs.indexOf('ehs')>=0 ? 'ehs' : R0.techs[0],
    caliber: Math.max(R0.cal[0],Math.min(R0.cal[1],POWER_REF_CAL[cfg.klass]||130)),
    barrels:1, barrelLen: Math.max(R0.len[0],Math.min(R0.len[1],50)), size:1, layout:'row' });
  refCfg.rof=rofOf(refCfg);
  const ref=core(refCfg);
  // Показатель 0.8 держит «урон на единицу энергии» почти плоским: разгон
  // калибра/стволов не даёт бесплатной эффективности, но и не хоронит крупные
  // орудия. При 0.55 гигантские сборки выходили энергетически ВЫГОДНЕЕ мелких.
  const energy=Math.max(1, Math.round(base*(T.pw||1)*Math.pow(damage/(ref.damage||1),0.8)));

  let price=55800*Math.pow(kal,0.402)*Math.pow(mass,0.157)
          *Math.pow(tC*cC,0.338)*Math.pow(1+energy,0.343)/1.15;
  price*=Math.pow(n,0.15);
  price=Math.round(price/1000)*1000;

  const t=cfg.tech;
  const resurs={
    blackmetall:  Math.max(1,Math.round(mass/900)),
    coloredmetall:(t==='laser'||t==='plasma'||t==='em')?Math.max(1,Math.round(mass/2200)):0,
    rudametall:   (t==='ehs'||t==='kinetic')?Math.max(1,Math.round(mass/1400)):0,
    kristall:     (t==='laser'||t==='plasma')?Math.max(1,Math.round(mass/1800)):0,
    staarvis:     (t==='rail'||t==='em'||cfg.klass==='super')?Math.max(1,Math.round(mass/6000)):0,
  };
  // ДАЛЬНОСТЬ: база класса × технология × калибр × длина ствола × компоновка
  const refCal=POWER_REF_CAL[cfg.klass]||130;
  // Длина ствола влияет на дальность только у ствольного оружия: у лазера
  // и плазмы «ствол» — волновод и сопло, разгонного участка там нет.
  // ЭХС и электромагнитное — тоже ствольные: их T.kind ('ehs'/'coil') назван по
  // рисовальщику, а не по физике, и раньше выпадал из проверки — дальность
  // таких орудий не зависела от длины ствола, вопреки серверному зеркалу
  // (_tg_stats считает их gun/rail). Правда — сервер.
  const barrelMatters=(T.kind==='gun'||T.kind==='rail'||T.kind==='ehs'||T.kind==='coil');
  let dalnost=(RANGE_BASE[cfg.klass]||3)*(T.dl||1)
            * Math.pow(kal/refCal, 0.55)
            * (barrelMatters ? Math.pow((+cfg.barrelLen||50)/50, 0.55) : 1)
            * (RANGE_LAYOUT[effLayout(cfg)]||1);
  // Дальность = ГЕКСЫ боевой карты. В _bt_stats поле dalnost идёт прямо в
  // rng и клампится greatest(1, least(40, ...)); боёвка пишет «бьёт на N
  // гексов». Поэтому здесь целое число в тех же границах, а не дробные АсК.
  dalnost=Math.max(1, Math.min(40, Math.round(dalnost)));

  const kind = t==='missile'?'missile' : (t==='laser'||t==='plasma')?'energy':'kinetic';
  // ЦЕНА В ИГРЕ ≠ price. price — это KV-прайс (миллионы), он нигде не тратится.
  // ГС орудия — БОЕВАЯ ЦЕНА: раньше она считалась из конструкционного сырья
  // (mass/900 и т.п.), и супероружие на 800k урона выходило в пару тысяч ГС,
  // дешевле корпуса, на который его вешают. Теперь платят за мощь: урон —
  // ведущий множитель, дальность и энергопрожорливость — надбавки.
  // Показатель 0.86 < 1: удвоение урона дорожает в ~1.8 раза, но не линейно,
  // иначе мелкие сборки становились бы выгоднее по «урону за ГС» в разы.
  // Классовый множитель корпуса тут не применяется — цена орудия плоская и
  // ровно в этом виде идёт в стоимость проекта (см. cnKvCost/_cn_recompute).
  let gs = 3.2 * Math.pow(damage,0.86)
         * Math.pow(1+dalnost/12, 0.55)
         * Math.pow(1+energy/400, 0.18);
  gs = Math.max(5, Math.round(gs));
  // ОЧКИ НАУКИ (ОН) — разовая трата при регистрации орудия в верфи, как за
  // публикацию проекта техники. Шкала подобрана к проектам (12–50 ОН у
  // кораблей): пулемёт ~2 ОН, предельное супероружие ~40.
  const on = Math.max(1, Math.min(60, Math.round(0.30*Math.pow(damage,0.42)*10)/10));
  // ВЕДОМОСТЬ В ИГРОВЫХ РЕСУРСАХ. resurs (чёрный металл/ставрис) — внутренняя
  // KV-номенклатура, на склад державы она не ложится. Со склада списывается то,
  // что считает cnUnitBill: у орудия сырьё идёт ОТ УРОНА и типа боеприпаса
  // (constructors.js, блок p.weapons). Зеркалим один в один.
  const bill={}, addB=(n,q)=>{ q=Math.ceil(q); if(q>0) bill[n]=(bill[n]||0)+q; };
  // cnWpnResKind в игре смотрит на НАЗВАНИЕ: «электромагн» там тоже энергетика,
  // хотя боеприпас у ЭМ-орудия кинетический — держим ту же развилку.
  const billKind = t==='missile' ? 'missile'
                 : (t==='laser'||t==='plasma'||t==='em') ? 'energy' : 'kinetic';
  if(billKind==='missile') addB('Изотопы', damage/150);
  else if(billKind==='energy'){ addB('Редкоземельные руды', damage/180); addB('Гелий-3', damage/400); }
  else addB('Железо', damage/120);
  return { damage, price, gs, on, bill, mass, energy, crew:0, dalnost,
           rof, caliber:kal, barrels:n, kind,
           dmgPerEnergy: Math.round(damage/energy*10)/10,
           salvo:Math.round(one), tC, dC, cC, resurs };
}

// ── §10. Сборка ──────────────────────────────────────────────
// opt.tight — кадр вплотную по изделию, без «размерного» отступа. Нужен там,
// где орудие показывают маленькой иконкой (узел на схеме корабля, карточка
// выбора): там важна читаемость силуэта, а не сравнение калибров между собой.
function render(input,opt){
  const cfg=normalize(input);
  // Энергия и темп — расчётные: от них зависит, сколько силовых шин и
  // радиаторных рёбер появится на корпусе.
  const st=stats(cfg); cfg.power=st.energy; cfg.rof=st.rof;
  const G=geom(cfg);
  // ── КАДР И МАСШТАБ ──────────────────────────────────────────
  // Раньше кадр подгонялся под изделие вплотную, поэтому размер вообще не
  // читался: и дрон-пушка, и супероружие занимали весь квадрат, а «масштаб»
  // проявлялся ТОЛЬКО толщиной обводки — отсюда и «жирные контуры».
  // Теперь наоборот: кадр общий для всей линейки, изделие в нём реально
  // мельчает и крупнеет, а обводка держит постоянную толщину на экране.
  const reach=G.mantletX+G.len+G.bw*3;
  const halfSpan=G.bankSpan*0.5+G.BH*0.6;
  const fit=Math.max(reach, G.R*1.6, halfSpan)+8;
  // S — «физический» размер сборки: ползунок × вес класса. Верх диапазона
  // (3 × 2.2 = 6.6) занимает кадр целиком, всё что меньше — пропорционально
  // меньше. Степень мягкая, а разбег ограничен: при 0.42 и потолке 3× мелкие
  // установки уезжали в точку и деталь вообще не читалась — размер должен быть
  // заметен, но не ценой того, что изделие не видно.
  const S=cfg.size*((CLASSES[cfg.klass]||CLASSES.medium).s);
  const zoom=(opt&&opt.tight) ? 1
    : Math.max(1, Math.min(1.85, Math.pow(6.6/Math.max(0.2,S), 0.26)));
  const pad=fit*zoom;
  // Обводка — в ЭКРАННЫХ пикселях, а не в единицах модели. viewBox шириной
  // 2·pad ложится на 760 px, значит масштаб = 380/pad; делим на него, и линия
  // выходит одинаково тонкой у любого орудия.
  SWK=Math.max(0.08, pad/430);
  let art=drawPlatform(cfg,G);
  let turret=drawTurret(cfg,G);
  // Дальние руки рисуем первыми, ближние поверх — иначе перекрытия врут
  for(const arm of G.arms.slice().sort((a,b)=>(a.dx||0)-(b.dx||0)))
    turret+=drawArm(cfg,arm,G);
  // data-yaw — зацепка для интерактивного превью: поворот башни это чистый
  // rotate() и на ТТХ не влияет, поэтому крутить можно правкой transform,
  // без полной перерисовки.
  art+=`<g data-yaw="1" transform="rotate(${n2(cfg.yaw)})">${turret}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n2(-pad)} ${n2(-pad)} ${n2(pad*2)} ${n2(pad*2)}"`
       + ` width="760" height="760">${buildDefs(cfg)}${art}</svg>`;
}

// ── §11. Мост к KV ───────────────────────────────────────────
// Генератор рисует ТУРЕЛИ. Стрелковка, ближний бой, гранаты, ангарные
// звенья и дроны-камикадзе башнями не являются — их в пресеты не пускаем.
// Пусковые (рпу/ракета/баллистическая) тоже сюда: у них своё семейство силуэта
// (fam 'pu'/'silo' — рама-качалка с пакетом), и без них ракетное вооружение
// оставалось единственным разделом каталога вообще без арта.
const TURRET_CLASS = /корабельн|супероруж|турель|танковая|бронетанков|арторуд|авиапушк|дрон-пушк|пво|гаубиц|рсу|рпу|ракета|баллистическ/i;
function isTurret(w){
  if(!w || !w.customParameter) return false;
  if(!TURRET_CLASS.test(String(w.class||''))) return false;
  return parseFloat(String(w.customParameter.kal||'0').replace(',','.')) > 0;
}
// Все башенные орудия каталога: { имя: запись }
function turretCatalog(lib){
  lib = lib || (window.KV && window.KV.weaponLibrary) || {};
  const out={};
  for(const n in lib) if(isTurret(lib[n])) out[n]=lib[n];
  return out;
}

function fromKV(name,w){
  const cp=(w&&w.customParameter)||{};
  const cal=parseFloat(String(cp.kal||'0').replace(',','.'))||10;
  let barrels=1, layout='row';
  // Словесные числительные: пусковые называют по числу зарядов, а не стволов
  // («Счетверённая», «Шестизарядный», «Б-8»), и packOf() без этого лепил всем
  // одну направляющую — весь раздел ракет выглядел одинаково.
  const WORDNUM={'одно':1,'двух':2,'спарен':2,'двойн':2,'тр[её]х':3,'строен':3,
                 'четыр[её]х':4,'счетвер':4,'пяти':5,'шести':6,'семи':7,'восьми':8,
                 'десяти':10,'двенадцати':12};
  const m=/(\d+)\s*[xх]\s*\d/.exec(name);
  if(m) barrels=+m[1];
  else if(/(\d+)\s*-?\s*ствольн/i.test(name)) barrels=+/(\d+)\s*-?\s*ствольн/i.exec(name)[1];
  else {
    for(const k in WORDNUM) if(new RegExp(k+'[а-яё]*(заряд|ствол|[её]нн)','i').test(name)){ barrels=WORDNUM[k]; break; }
    if(barrels===1 && /спаренн/i.test(name)) barrels=2;
  }
  if(barrels>=6) layout='rotary';
  else if(barrels===4) layout='quad';
  else if(barrels===2&&/спаренн/i.test(name)) layout='stacked';

  const t=String(w.tech||'').toLowerCase();
  const c=String(w.class||'').toLowerCase();
  const nm=String(name||'').toLowerCase();
  const cat=String(w.category||'').toLowerCase();

  // ── ЧТО ЭТО ЗА ЖЕЛЕЗО — по НАЗВАНИЮ, а не только по class/tech.
  // В каталоге class часто врёт: «Пусковая установка МБР "Титан"» лежит
  // как арторудие, «система залпового огня» — тоже. Название честнее.
  const isLauncher = /пусковая установка|\bпу[\s-]|мбр|ракет|залпового огня|рсзо|зрк|торпед|нурс/.test(nm)
                   || /рпу|ракета|баллистическ/.test(c) || /апу|рпу/.test(cat);
  // У пусковой «стволов» столько, сколько зарядов в пакете: если из названия
  // число не вычиталось («Блок НАР Б-8»), берём боекомплект из скорострельности.
  if(isLauncher && barrels<2){
    const ammo=parseFloat(cp.skorostrelnost)||0;
    if(ammo>1) barrels=Math.max(2,Math.min(8,Math.round(ammo)));
  }
  const isMG       = /пулем[её]т/.test(nm) || /пулемет/.test(c);
  const isGL       = /гранатом[её]т/.test(nm) || /гранатомет/.test(c);
  const isFlamer   = /огнем[её]т/.test(nm);

  let tech = /рельсотрон/.test(t)?'rail':/электромагн/.test(t)?'em'
    :/лазер/.test(t)?'laser':/плазм/.test(t)?'plasma'
    :/антиматериальн/.test(t)?'anti':/гравитацион/.test(t)?'grav'
    :/электронное подавл/.test(t)?'ew'
    :/нанотехнолог/.test(t)?'nano'
    :/управляем/.test(t)?'missile':/взрывчат/.test(t)?'explos'
    :/электрохим/.test(t)?'ehs':'kinetic';
  // Название перебивает tech: пусковая остаётся пусковой, даже если в
  // каталоге у неё проставлено «электрохимическое».
  if(isLauncher && !/лазер|плазм|рельсотрон/.test(t)) tech='missile';
  if(isFlamer) tech='plasma';

  let klass=/супероруж/.test(c)?'super':/тяжелое корабельное/.test(c)?'heavy'
    :/среднее корабельное/.test(c)?'medium':/легкое корабельное/.test(c)?'light'
    :/пво/.test(c)?'aa':/арторуд/.test(c)?'arty'
    :/гаубиц/.test(c)?'howitz':/рсу/.test(c)?'rsu'
    :/баллистическ/.test(c)?'brm':/^рпу|^ракета/.test(c)?'rpu'
    :/танковая|турель$/.test(c)?'tankgun':/бтр|бронетанков/.test(c)?'apc'
    :/авиапушк|курсов/.test(c)?'air'
    :/тяжелое вооружен|гранатомет/.test(c)?'hw'
    :/пулемет/.test(c)?'mg'
    :/дрон/.test(c)?'drone':'medium';
  // Уточнение класса по названию — там, где class каталога заведомо врёт
  if(isLauncher){
    klass = /мбр|баллистическ|межконтинент/.test(nm) ? 'brm'
          : /залпового огня|рсзо/.test(nm)           ? 'rsu'
          : (klass==='arty'||klass==='medium')       ? 'rpu' : klass;
  } else if(isMG && !/корабельн|пво/.test(c)) klass='mg';
  else if(isGL) klass='hw';   // отдельного класса «гранатомёт» у башен нет

  const platform={super:'2',heavy:'1',medium:'1',light:'3',aa:'8',
                  tankgun:'5',arty:'6',howitz:'6',rsu:'5',rpu:'5',brm:'6',
                  apc:'4',mg:'4',hw:'4',air:'7',drone:'7'}[klass]||'1';
  return normalize({ platform, tech, klass, layout, caliber:cal, barrels,
    barrelLen:/лазер|плазм/.test(t)?32:(klass==='arty'||klass==='super'?72:52),
    size:1,
    seed:(name||'').split('').reduce((a,ch)=>(a*31+ch.charCodeAt(0))>>>0,7) });
}

// ── §12. НА ЧТО ЭТО ВЕШАЕТСЯ ─────────────────────────────────
// Носители выводятся ИЗ САМОЙ СБОРКИ, а не задаются вручную: класс
// установки говорит, кто в принципе такое носит, а масса и энергия
// отсекают тех, кто конкретно ЭТУ сборку не потянет. Разогнал калибр и
// стволы — тяжёлые машины остались, лёгкие отвалились сами.
// Ключи носителей — классы KV (те же, что в конструкторах сайта).
const CARRIERS = {
  peh:      { ru:'Пехота',            mass:150,    power:150 },
  dron:     { ru:'Дрон',              mass:120,    power:250 },
  dronkos:  { ru:'БПЛА (косм.)',      mass:400,    power:600 },
  btr:      { ru:'БТР / БМП',         mass:2500,   power:900 },
  tanki:    { ru:'Танк',              mass:9000,   power:2000 },
  arta:     { ru:'Артиллерия',        mass:25000,  power:2500 },
  aviacia:  { ru:'Атм. авиация',      mass:2500,   power:1500 },
  vertihui: { ru:'Вертолёт',          mass:1800,   power:1200 },
  mla:      { ru:'Звездолёт',         mass:6000,   power:4000 },
  corvette: { ru:'Корвет',            mass:40000,  power:9000 },
  destroyer:{ ru:'Эсминец',           mass:90000,  power:20000 },
  supportCarrier:{ ru:'Авианосец подд.',mass:90000,power:20000 },
  mediumCruiser:{ ru:'Средний крейсер',mass:200000,power:45000 },
  hyperCruiser:{ ru:'Гиперкрейсер',   mass:260000, power:70000 },
  multiroleCarrier:{ru:'Многоцел. авианосец',mass:260000,power:70000},
  battleship:{ ru:'Линкор',           mass:400000, power:120000 },
  dreadnought:{ru:'Дредноут',         mass:600000, power:200000 },
  ss13:     { ru:'СС-13 (станция)',   mass:600000, power:200000 },
};
const CARRIER_ORDER = Object.keys(CARRIERS);
// Кто в принципе носит установку такого класса (без учёта габаритов).
const CLASS_CARRIERS = {
  mg:      ['peh','dron','btr','tanki','arta','aviacia','vertihui','dronkos','mla'],
  gl:      ['peh','btr','tanki','vertihui','dron'],
  hw:      ['peh','btr','tanki','aviacia','vertihui','dron','dronkos'],
  drone:   ['dron','dronkos','aviacia','vertihui','mla'],
  air:     ['aviacia','vertihui','dronkos','mla','dron'],
  apc:     ['btr','tanki','arta','mla','vertihui'],
  aa:      ['btr','tanki','arta','mla','corvette','destroyer','supportCarrier','mediumCruiser',
            'hyperCruiser','multiroleCarrier','battleship','dreadnought','ss13'],
  tankgun: ['tanki','btr','arta','mla'],
  arty:    ['arta','tanki'],
  howitz:  ['arta'],
  rsu:     ['arta','btr','vertihui'],
  rpu:     ['arta','btr','tanki','aviacia','vertihui','mla','corvette','destroyer'],
  rocket:  ['arta','mla','corvette','destroyer','supportCarrier','mediumCruiser'],
  brm:     ['arta','ss13','battleship','dreadnought'],
  light:   ['mla','corvette','destroyer','supportCarrier','mediumCruiser','hyperCruiser',
            'multiroleCarrier','battleship','dreadnought','ss13'],
  medium:  ['destroyer','supportCarrier','mediumCruiser','hyperCruiser','multiroleCarrier',
            'battleship','dreadnought','ss13'],
  heavy:   ['mediumCruiser','hyperCruiser','multiroleCarrier','battleship','dreadnought','ss13'],
  super:   ['battleship','dreadnought','ss13'],
};
// Полный разбор: кто тянет, кто нет и по какой причине.
function carriers(input){
  const cfg=normalize(input), st=stats(cfg);
  const base=CLASS_CARRIERS[cfg.klass]||CLASS_CARRIERS.medium;
  return CARRIER_ORDER.filter(k=>base.indexOf(k)>=0).map(k=>{
    const c=CARRIERS[k], why=[];
    if(st.mass>c.mass) why.push('масса '+Math.round(st.mass)+' кг > '+c.mass);
    if(st.energy>c.power) why.push('энергия '+st.energy+' > '+c.power);
    return { key:k, ru:c.ru, ok:!why.length, why:why.join('; ') };
  });
}
// Короткий ответ: список ключей носителей, которые реально тянут сборку.
function carrierKeys(input){ return carriers(input).filter(c=>c.ok).map(c=>c.key); }

return { render, stats, fromKV, isTurret, turretCatalog,
         carriers, carrierKeys, CARRIERS, CLASS_CARRIERS,
         normalize, rulesOf, allowedTechs, CLASS_RULES,
         PLATFORMS, TECHS, CLASSES, LAYOUTS, MATS, DEFAULTS };
})();
