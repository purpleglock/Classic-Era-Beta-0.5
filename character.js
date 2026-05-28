// ═══════════════════════════════════════════════════════════════
// CHARACTER SYSTEM v3.1
// ═══════════════════════════════════════════════════════════════

// ─── Class → section slug mapping ───────────────────────────────
// СОЗДАЙ РАЗДЕЛЫ С ЭТИМИ СЛАГАМИ В ВИКИ:
// soldiers, pilots, agents, commanders, engineers, diplomats,
// hackers, medics, snipers, spies, warlords, navigators
const CLASS_SECTION_SLUGS = {
  soldier:'soldiers', pilot:'pilots', agent:'agents',
  commander:'commanders', engineer:'engineers', diplomat:'diplomats',
  hacker:'hackers',
};

// ─── Class definitions ──────────────────────────────────────────
const CLASS_DEFS = {
  // Боевые — средняя зп, акцент СИЛ/ТЕЛ
  // base_stats — стартовое распределение под роль (сумма = 60, база 10 × 6)
  // Игрок затем докидывает 6 свободных очков поверх
  soldier:   {label:'Солдат',    icon:'⚔',  desc:'Элитный боец передовой линии',
    salary_start:500,
    stat_bonus:{},
    base_stats:{str:13, dex:11, con:12, int:8,  wis:9,  cha:7}},   // сила/выносливость — главное

  commander: {label:'Командир',  icon:'◆',  desc:'Стратег, лидер операций и войск',
    salary_start:800,
    stat_bonus:{},
    base_stats:{str:9,  dex:8,  con:10, int:12, wis:11, cha:10}},  // ум + харизма

  pilot:     {label:'Пилот',     icon:'◉',  desc:'Управляет флотом, судами и дронами',
    salary_start:600,
    stat_bonus:{},
    base_stats:{str:8,  dex:14, con:9,  int:11, wis:10, cha:8}},   // ловкость — топ

  engineer:  {label:'Инженер',   icon:'⚙',  desc:'Разработчик, механик и сапёр',
    salary_start:450,
    stat_bonus:{},
    base_stats:{str:9,  dex:9,  con:11, int:14, wis:10, cha:7}},   // интеллект — топ

  agent:     {label:'Агент',     icon:'◈',  desc:'Разведка, диверсии и спецоперации',
    salary_start:550,
    stat_bonus:{},
    base_stats:{str:9,  dex:13, con:9,  int:10, wis:12, cha:7}},   // ловкость + интуиция

  diplomat:  {label:'Дипломат',  icon:'◇',  desc:'Переговорщик, посол и советник',
    salary_start:400,
    stat_bonus:{},
    base_stats:{str:7,  dex:8,  con:9,  int:11, wis:12, cha:13}},  // харизма + мудрость

  hacker:    {label:'Хакер',     icon:'○',  desc:'Кибервзлом, слежка и информация',
    salary_start:520,
    stat_bonus:{},
    base_stats:{str:7,  dex:11, con:8,  int:14, wis:11, cha:9}},   // интеллект + скорость
};


const GEAR_SLOTS_MAX  = {weapon:1,armor:1,helmet:1,ring:2,artifact:2,consumable:3};
const GEAR_SLOT_ICONS = {weapon:'⚔',armor:'🛡',helmet:'⛑',ring:'◇',artifact:'◈',consumable:'⬡'};
const GEAR_SLOT_NAMES = {weapon:'Оружие',armor:'Броня',helmet:'Шлем',ring:'Кольцо',artifact:'Артефакт',consumable:'Расходник'};
const RARITY_COLOR    = {common:'#8a8a9a',uncommon:'#4caf50',rare:'#2196f3',epic:'#9c27b0',legendary:'#ff9800'};
const RARITY_LABEL    = {common:'Обычный',uncommon:'Необычный',rare:'Редкий',epic:'Эпический',legendary:'Легендарный'};
const STAT_NAMES      = {str:'СИЛ',dex:'ЛОВ',con:'ТЕЛ',int:'ИНТ',wis:'МДР',cha:'ХАР'};

// Stat allocation constants
const REG_STAT_BASE   = 8;
const REG_STAT_POINTS = 6;  // база уже в base_stats класса
const REG_STAT_MAX    = 16;

// ─── Level calculation ───────────────────────────────────────
// Эталон: игроки с 2014 года ≈ уровень 20
// Для dead/retired — замораживаем на play_end
const CHAR_REFERENCE_YEAR = 2014;
const CHAR_REF_DAYS = Math.floor((Date.now() - new Date(`${CHAR_REFERENCE_YEAR}-01-01`)) / (1000*60*60*24));

function _charLvl(ch) {
  const start = new Date(ch.play_start || Date.now());
  const isFinished = ch.status === 'dead' || ch.status === 'retired';
  const end = (isFinished && ch.play_end) ? new Date(ch.play_end) : new Date();
  const daysPlayed = Math.max(0, Math.floor((end - start) / (1000*60*60*24)));
  return Math.min(20, Math.max(1, Math.round((daysPlayed / CHAR_REF_DAYS) * 20)));
}

// ─── Utils ──────────────────────────────────────────────────────
function creditsFmt(n) {
  return String(Math.round(n||0)).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
}
function creditsAdd(extra, amount, reason, type='misc') {
  if (!extra.credits_log) extra.credits_log = [];
  extra.credits = Math.round((extra.credits||0) + amount);
  extra.credits_log.unshift({ts:new Date().toISOString(),amount,reason,type});
  if (extra.credits_log.length > 60) extra.credits_log = extra.credits_log.slice(0,60);
}
function getAbilityPages() { return pages.filter(p=>isVisiblePage(p)&&p.page_type==='ability'&&p.status==='published'); }
function getItemPages()    { return pages.filter(p=>isVisiblePage(p)&&p.page_type==='item'   &&p.status==='published'); }
function _modStr(v) { const m=Math.floor(((v||8)-10)/2); return (m>=0?'+':'')+m; }

async function saveCharFull(slug, patch) {
  try {
    const token = await getTokenFresh();
    const r = await fetch(`${SB_URL}/rest/v1/characters?slug=eq.${encodeURIComponent(slug)}`,{
      method:'PATCH',
      headers:{'apikey':SB_ANON,'Authorization':'Bearer '+token,'Content-Type':'application/json','Prefer':'return=minimal'},
      body:JSON.stringify({...patch,updated_at:new Date().toISOString()}),
    });
    if (!r.ok && r.status!==204) throw new Error('HTTP '+r.status);
  } catch(e) { console.warn('[char] save error:',e.message); }
}


// ═══════════════════════════════════════════════════════════════
// REGISTRATION WIZARD
// ═══════════════════════════════════════════════════════════════
let _regStep = 0;
let _regData = {};

function openCharRegister() {
  if (!user) { showAuth('login'); return; }
  const myChar = pages.find(p=>p.page_type==='character'&&p.created_by===user.email);
  if (myChar) { toast('У вас уже есть персонаж','inf'); go(myChar.slug); closeAp?.(); return; }
  _regStep = 1;
  const _initCls = CLASS_DEFS['soldier'];
  _regData = { name:'',class:'soldier',faction:'',bio:'',image_url:'',exclude_from_collage:false,abilities:[],
    stats:{..._initCls.base_stats}, statsLeft:REG_STAT_POINTS };
  const scr = document.getElementById('char-reg-screen');
  if (scr) {
    scr.style.display = 'block';
    _regRender();
    setTimeout(()=>document.getElementById('reg-name')?.focus(),100);
  }
}

const _REG_STEPS = ['ЛИЧНОСТЬ','КЛАСС','НАВЫКИ','ФРАКЦИЯ','СПОСОБНОСТИ','ФИНАЛ'];

function _regRender() {
  const scr = document.getElementById('char-reg-screen'); if (!scr) return;
  const stepsEl = document.getElementById('creg-steps');
  const contentEl = document.getElementById('creg-content');
  const actionsEl = document.getElementById('creg-actions');
  if (!stepsEl || !contentEl || !actionsEl) return;

  stepsEl.innerHTML = _REG_STEPS.map((s,i) => `
    <div class="creg-step ${i+1<_regStep?'done':i+1===_regStep?'active':''}" ${i+1<_regStep?`onclick="_regStep=${i+1};_regRender()"`:''}>
      <div class="creg-step-num">${i+1<_regStep?'✓':i+1}</div>
      <div class="creg-step-info">
        <div class="creg-step-label">${s}</div>
        ${i+1===_regStep?'<div class="creg-step-cur">ТЕКУЩИЙ</div>':''}
      </div>
    </div>`).join('');

  const fn=[null,_rH1,_rH2,_rH3,_rH4,_rH5,_rH6];
  contentEl.innerHTML = fn[_regStep]?.() || '';

  actionsEl.innerHTML = `
    <div class="creg-act-left">
      <button class="creg-btn-back" onclick="${_regStep>1?'regBack()':'document.getElementById(\'char-reg-screen\').style.display=\'none\''}">${_regStep>1?'← НАЗАД':'ОТМЕНА'}</button>
    </div>
    <div class="creg-act-progress">${_regStep} / ${_REG_STEPS.length}</div>
    <div class="creg-act-right">
      ${_regStep<_REG_STEPS.length
        ? `<button class="btn btn-gd" onclick="regNext()">Далее →</button>`
        : `<button class="btn btn-gd" id="reg-submit" onclick="regSubmit()">✓ Создать персонажа</button>`}
    </div>`;
}

function _rH1(){return`
  <div class="creg-step-header">
    <div class="creg-step-eyebrow">ШАГ 1</div>
    <div class="creg-step-title">КТО ВЫ?</div>
  </div>
  <div class="creg-form">
    <div class="creg-field">
      <label class="creg-label">Имя персонажа *</label>
      <input class="creg-input creg-input-lg" id="reg-name" value="${esc(_regData.name)}" placeholder="Введите имя..." oninput="_regData.name=this.value">
    </div>
    <div class="creg-field">
      <label class="creg-label">Фото персонажа</label>
      <div style="display:flex;gap:8px">
        <input class="creg-input" id="reg-img" value="${esc(_regData.image_url)}" placeholder="https://..." style="flex:1" oninput="_regData.image_url=this.value;_regPreviewImg()">
        <label class="creg-upload-btn" style="cursor:pointer">📁<input type="file" accept="image/*" style="display:none" onchange="regImgUpload(this)"></label>
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;margin-top:8px">
        <input type="checkbox" id="reg-exclude-collage" ${_regData.exclude_from_collage?'checked':''} onchange="_regData.exclude_from_collage=this.checked" style="cursor:pointer">
        <span style="font-size:12px;color:rgba(255,255,255,.5)">Не показывать в коллаже главной</span>
      </label>
    </div>
    ${_regData.image_url
      ? `<div class="creg-img-preview"><img src="${esc(_regData.image_url)}" style="width:100%;max-height:280px;object-fit:cover;object-position:center 20%;display:block"><div class="creg-img-overlay"></div></div>`
      : `<div class="creg-img-empty">◈ &nbsp; НЕТ ИЗОБРАЖЕНИЯ</div>`}
    <div class="creg-rules" style="margin-top:24px">
      <div class="creg-rules-head">◈ ПРАВИЛА</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:rgba(255,255,255,.45);line-height:2.2">
        · Один аккаунт = один персонаж<br>
        · Имя выбирается один раз<br>
        · Уровень растёт каждую неделю (макс. 20)<br>
        · Стартовые кредиты зависят от класса
      </div>
    </div>
  </div>`;}

function _rH2(){return`
  <div class="creg-step-header">
    <div class="creg-step-eyebrow">ШАГ 2</div>
    <div class="creg-step-title">КЛАСС</div>
  </div>
  <div class="creg-class-grid">
    ${Object.entries(CLASS_DEFS).map(([k,v])=>`
      <div class="creg-class-card ${_regData.class===k?'sel':''}" onclick="_regData.class='${k}';_regData.stats={...CLASS_DEFS['${k}'].base_stats};_regData.statsLeft=REG_STAT_POINTS;_regRender()">
        <div class="creg-cc-top">
          <div class="creg-cc-icon">${v.icon}</div>
          <div class="creg-cc-economy">
            <span class="creg-cc-start">${creditsFmt(v.salary_start)} <span>ЭК</span></span>
          </div>
        </div>
        <div class="creg-cc-name">${v.label}</div>
        <div class="creg-cc-desc">${v.desc}</div>
        ${Object.keys(v.stat_bonus||{}).length?`<div style="font-family:'JetBrains Mono',monospace;font-size:8px;color:rgba(168,105,44,.55);letter-spacing:.5px">${Object.entries(v.stat_bonus).map(([s,n])=>`+${n} ${STAT_NAMES[s]}`).join(' · ')}</div>`:''}
        ${_regData.class===k?`<div class="creg-cc-sel-mark">✓ ВЫБРАНО</div>`:''}
      </div>`).join('')}
  </div>`;}

function _rH3(){
  const cls=CLASS_DEFS[_regData.class]||CLASS_DEFS.soldier;
  const bonus=cls.stat_bonus||{};
  const left=_regData.statsLeft;
  return`
  <div class="creg-step-header">
    <div class="creg-step-eyebrow">ШАГ 3</div>
    <div class="creg-step-title">НАВЫКИ</div>
  </div>
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
    <span style="font-family:'Orbitron',sans-serif;font-size:13px;font-weight:700;color:${left>0?'var(--gdl)':'rgba(255,80,80,.9)'}">Очков: ${left}</span>
    <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:rgba(255,255,255,.3)">База: ${REG_STAT_BASE} · Макс: ${REG_STAT_MAX}</span>
    ${Object.keys(bonus).length?`<span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:rgba(168,105,44,.5)">Бонус «${cls.label}»: ${Object.entries(bonus).map(([s,n])=>`+${n} ${STAT_NAMES[s]}`).join(', ')}</span>`:''}
  </div>
  <div class="creg-stat-grid">
    ${Object.entries(STAT_NAMES).map(([key,label])=>{
      const base=_regData.stats[key]||REG_STAT_BASE;
      const bon=bonus[key]||0;
      const total=base+bon;
      const pct=Math.round(((base-REG_STAT_BASE)/(REG_STAT_MAX-REG_STAT_BASE))*100);
      return`<div class="creg-stat-block">
        <div class="creg-stat-label">${label}</div>
        <div class="creg-stat-controls">
          <button class="creg-stat-btn" onclick="regStat('${key}',-1)" ${base>REG_STAT_BASE?'':'disabled'}>−</button>
          <div class="creg-stat-vals">
            <div class="creg-stat-num">${base}</div>
            ${bon?`<div class="creg-stat-bonus">+${bon}</div>`:''}
          </div>
          <button class="creg-stat-btn creg-stat-btn--plus" onclick="regStat('${key}',1)" ${left>0&&base<REG_STAT_MAX?'':'disabled'}>+</button>
        </div>
        <div class="creg-stat-bar"><div class="creg-stat-bar-fill" style="width:${pct}%"></div></div>
        <div class="creg-stat-mod">${_modStr(total)}</div>
      </div>`;
    }).join('')}
  </div>`;}

function _rH4(){
  const fSecs=sections.filter(s=>s.name_ru?.toLowerCase().includes('фракц')||s.name_en?.toLowerCase().includes('fract')||s.slug?.includes('frak')||s.slug?.includes('frac'));
  const fPgs=pages.filter(p=>fSecs.some(s=>s.slug===p.section)&&p.status==='published');
  return`
  <div class="creg-step-header">
    <div class="creg-step-eyebrow">ШАГ 4</div>
    <div class="creg-step-title">ФРАКЦИЯ</div>
    <div class="creg-step-desc">Примкните к фракции (+200 ЭК) или оставайтесь независимым.</div>
  </div>
  ${fPgs.length?`<div class="creg-faction-grid">${fPgs.map(f=>`
    <div class="creg-faction-card ${_regData.faction===pT(f)?'sel':''}" onclick="_regData.faction='${esc(pT(f))}';_regRender()">
      ${f.image_url?`<img src="${esc(f.image_url)}" class="creg-ff-img" loading="lazy">`:`<div class="creg-ff-noimg">${esc(pT(f)).slice(0,2).toUpperCase()}</div>`}
      <div class="creg-ff-name">${esc(pT(f))}</div>
      ${_regData.faction===pT(f)?'<div class="creg-ff-check">✓</div>':''}
    </div>`).join('')}</div>`
    :`<div style="color:rgba(255,255,255,.25);font-family:'JetBrains Mono',monospace;font-size:11px;padding:8px 0">Нет страниц фракций в системе.</div>`}
  <div class="creg-field" style="margin-top:16px">
    <label class="creg-label">Или введите вручную</label>
    <input class="creg-input" id="reg-faction-in" value="${esc(_regData.faction)}" placeholder="Название фракции..." oninput="_regData.faction=this.value;_regRender()">
  </div>
  ${_regData.faction?`<div class="creg-selected-badge"><span>◉</span>Выбрано: ${esc(_regData.faction)}</div>`:''}
  `;}

function _rH5(){
  const abPgs=getAbilityPages(); const maxAb=2;
  return`
  <div class="creg-step-header">
    <div class="creg-step-eyebrow">ШАГ 5</div>
    <div class="creg-step-title">СПОСОБНОСТИ</div>
  </div>
  <div class="creg-ab-counter">
    <div class="creg-ab-slots">
      ${Array.from({length:maxAb}).map((_,i)=>{
        const ab=_regData.abilities[i];
        return ab
          ?`<div class="creg-ab-slot filled"><div class="creg-ab-slot-name">${esc(ab.name)}</div></div>`
          :`<div class="creg-ab-slot"><div class="creg-ab-slot-empty">СЛОТ ${i+1}</div></div>`;
      }).join('')}
    </div>
  </div>
  ${!abPgs.length
    ?`<div style="color:rgba(255,255,255,.25);font-family:'JetBrains Mono',monospace;font-size:11px">Нет опубликованных способностей (page_type=ability).</div>`
    :`<div class="creg-ab-grid">${abPgs.map(p=>{
        const sel=_regData.abilities.some(a=>a.source_slug===p.slug);
        const disabled=!sel&&_regData.abilities.length>=maxAb;
        const ic=(typeof getAbilityIconUrl==='function')?getAbilityIconUrl(pT(p))||'':'';
        const slug_=esc(p.slug), name_=esc(pT(p));
        return`<div class="creg-ab-card ${sel?'sel':''} ${disabled?'disabled':''}" ${disabled?'':'onclick="regToggleAb(this.dataset.slug,this.dataset.name)"'} data-slug="${slug_}" data-name="${name_}">
          ${ic?`<img src="${esc(ic)}" class="creg-ab-icon-img">`:`<div class="creg-ab-icon-ph">◈</div>`}
          <div class="creg-ab-card-info"><div class="creg-ab-card-name">${name_}</div></div>
          <div class="creg-ab-check">${sel?'✓':'○'}</div>
        </div>`;}).join('')}</div>`}
  `;}

function _rH6(){
  const cls=CLASS_DEFS[_regData.class]||CLASS_DEFS.soldier;
  const bonus=cls.stat_bonus||{};
  const sc=cls.salary_start+(_regData.faction?200:0);
  const fs=Object.fromEntries(Object.entries(_regData.stats).map(([k,v])=>[k,v+(bonus[k]||0)]));
  return`
  <div class="creg-step-header">
    <div class="creg-step-eyebrow">ШАГ 6</div>
    <div class="creg-step-title">ФИНАЛЬНЫЙ ПРОФИЛЬ</div>
  </div>
  <div class="creg-summary">
    <div class="creg-sum-left">
      ${_regData.image_url
        ?`<img src="${esc(_regData.image_url)}" class="creg-sum-avatar">`
        :`<div class="creg-sum-avatar-ph">${esc(_regData.name||'?').slice(0,2).toUpperCase()}</div>`}
      <div class="creg-sum-id">
        <div class="creg-sum-name">${esc(_regData.name||'—')}</div>
        <div class="creg-sum-role">${cls.icon} ${cls.label}${_regData.faction?' · '+esc(_regData.faction):''}</div>
      </div>
    </div>
    <div class="creg-sum-stats">
      <div class="creg-sum-stat"><span class="creg-sum-stat-k">Стартовые кредиты</span><span class="creg-sum-stat-v gold">${creditsFmt(sc)} ЭК</span></div>
      ${_regData.faction?`<div class="creg-sum-stat"><span class="creg-sum-stat-k">Бонус фракции</span><span class="creg-sum-stat-v green">+200 ЭК</span></div>`:''}
      ${Object.entries(STAT_NAMES).map(([k,l])=>`<div class="creg-sum-stat"><span class="creg-sum-stat-k">${l}</span><span class="creg-sum-stat-v">${fs[k]||8}</span></div>`).join('')}
    </div>
  </div>
  <div class="creg-field" style="margin-top:20px">
    <label class="creg-label">Биография</label>
    <textarea class="creg-input creg-textarea" id="reg-bio" placeholder="Краткое описание персонажа (поддерживает Markdown)..." oninput="_regData.bio=this.value" rows="6">${esc(_regData.bio)}</textarea>
    <div style="font-size:10px;color:var(--t4);margin-top:4px">Поддерживает форматирование: **жирный**, *курсив*, \`код\`, [ссылка](url), ## заголовок</div>
  </div>`;}

function regStat(stat, delta) {
  const cur=_regData.stats[stat]||REG_STAT_BASE, next=cur+delta;
  if (next<REG_STAT_BASE||next>REG_STAT_MAX) return;
  if (delta>0&&_regData.statsLeft<=0) return;
  _regData.stats[stat]=next; _regData.statsLeft-=delta; _regRender();
}
function regToggleAb(slug, title) {
  const maxAb=2, idx=_regData.abilities.findIndex(a=>a.source_slug===slug);
  if (idx>=0) { _regData.abilities.splice(idx,1); } else { if (_regData.abilities.length>=maxAb){toast(`Максимум ${maxAb} способности`,'err');return;} _regData.abilities.push({name:title,type:'passive',desc:'',source_slug:slug}); }
  _regRender();
}
function regNext() { if (_regStep===1&&!_regData.name.trim()){toast('Введите имя персонажа','err');return;} _regStep=Math.min(_REG_STEPS.length,_regStep+1); _regRender(); }
function regBack() { _regStep=Math.max(1,_regStep-1); _regRender(); }
function _regPreviewImg() { _regData.image_url=document.getElementById('reg-img')?.value||''; if(_regStep===1)_regRender(); }
async function regImgUpload(input) { const f=input?.files?.[0]; if(!f)return; await handleImgUpload(f,url=>{_regData.image_url=url;if(_regStep===1)_regRender();}); }

async function regSubmit() {
  if (!user){toast('Необходима авторизация','err');return;}
  const btn=document.getElementById('reg-submit'); if(btn)btn.disabled=true;
  const bio=document.getElementById('reg-bio')?.value?.trim()||_regData.bio;
  const name=_regData.name.trim(); if(!name){toast('Имя обязательно','err');if(btn)btn.disabled=false;return;}
  const cls=CLASS_DEFS[_regData.class]||CLASS_DEFS.soldier;
  const bonus=cls.stat_bonus||{};
  const finalStats=Object.fromEntries(Object.entries(_regData.stats).map(([k,v])=>[k,v+(bonus[k]||0)]));
  const slug=slugify(name)+'-'+Math.random().toString(36).slice(2,5);
  const now=new Date().toISOString();
  const sc=cls.salary_start+(_regData.faction?200:0);
  const credits_log=[{ts:now,amount:cls.salary_start,reason:`Стартовые кредиты · ${cls.label}`,type:'start'},...(_regData.faction?[{ts:now,amount:200,reason:'Бонус за вступление во фракцию',type:'start'}]:[])];
  const extra={bio,subtitle:cls.label,credits:sc,credits_log};
  // Find the class parent PAGE (e.g. slug='soldiers' for soldier class)
  // Character goes under that page as parent_slug, inheriting its section
  const parentSlug = CLASS_SECTION_SLUGS[_regData.class]; // e.g. 'soldiers'
  const parentPage = pages.find(p => p.slug === parentSlug);
  const charSection = parentPage?.section || null;
  const charParent  = parentPage?.slug    || null;
  try {
    await dbPost('pages',{slug,title:name,title_ru:name,content:'[]',page_type:'character',status:'published',image_url:_regData.image_url||null,exclude_from_collage:_regData.exclude_from_collage||false,section:charSection,parent_slug:charParent,created_by:user.email,created_at:now,updated_at:now});
    const token=await getTokenFresh();
    const r=await fetch(`${SB_URL}/rest/v1/characters`,{method:'POST',headers:{'apikey':SB_ANON,'Authorization':'Bearer '+token,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({slug,name,class:_regData.class,faction:_regData.faction||'',status:'active',play_start:now.slice(0,10),play_end:null,owner_email:user.email,stats:finalStats,abilities:_regData.abilities,gear:[],extra,updated_at:now})});
    if(!r.ok&&r.status!==204)throw new Error('HTTP '+r.status);
    document.getElementById('char-reg-screen').style.display='none'; await loadPgs(); buildNav(); go(slug,false); toast(`✓ Персонаж создан! Начислено ${creditsFmt(sc)} ЭК`,'ok');
  } catch(e){toast('Ошибка: '+e.message,'err');if(btn)btn.disabled=false;}
}

// ═══════════════════════════════════════════════════════════════
// GEAR MANAGEMENT — unequip / sell
// ═══════════════════════════════════════════════════════════════
async function unequipGear(charSlug, gearIdx) {
  if (!user) return;
  const confirmed = confirm('Снять предмет?');
  if (!confirmed) return;
  try {
    const r = await dbGet('characters', `slug=eq.${encodeURIComponent(charSlug)}&select=*&limit=1`);
    const ch = r?.[0]; if (!ch) throw new Error('Персонаж не найден');
    const gear = [...(ch.gear || [])];
    if (gearIdx < 0 || gearIdx >= gear.length) throw new Error('Предмет не найден');
    gear.splice(gearIdx, 1);
    await saveCharFull(charSlug, { gear });
    _pgCache.delete(charSlug); go(charSlug, false);
    toast('Предмет снят', 'inf');
  } catch(e) { toast('Ошибка: ' + e.message, 'err'); }
}

async function sellGear(charSlug, gearIdx) {
  if (!user) return;
  try {
    const r = await dbGet('characters', `slug=eq.${encodeURIComponent(charSlug)}&select=*&limit=1`);
    const ch = r?.[0]; if (!ch) throw new Error('Персонаж не найден');
    const gear = [...(ch.gear || [])];
    const item = gear[gearIdx];
    if (!item) throw new Error('Предмет не найден');

    // Sell price: look up original price from item page, give 50%
    let sellPrice = 0;
    if (item.source_slug) {
      try {
        const iR = await dbGet('pages', `slug=eq.${encodeURIComponent(item.source_slug)}&select=content&limit=1`);
        const iEx = (typeof parseExtra === 'function') ? parseExtra(iR?.[0]?.content || '[]') : {};
        const origPrice = parseInt(iEx['цена'] || iEx['price'] || '0', 10);
        sellPrice = Math.floor(origPrice * 0.5);
      } catch(e) {}
    }

    const label = sellPrice > 0 ? `${creditsFmt(sellPrice)} ЭК` : 'без компенсации';
    const confirmed = confirm(`Продать «${item.name}» за ${label}?`);
    if (!confirmed) return;

    gear.splice(gearIdx, 1);
    const extra = ch.extra || {};
    if (sellPrice > 0) creditsAdd(extra, sellPrice, 'Продажа: ' + item.name, 'sell');

    await saveCharFull(charSlug, { gear, extra });
    _pgCache.delete(charSlug); go(charSlug, false);
    toast(`✓ Продано${sellPrice ? ` · +${creditsFmt(sellPrice)} ЭК` : ''}`, 'ok');
  } catch(e) { toast('Ошибка: ' + e.message, 'err'); }
}

// ═══════════════════════════════════════════════════════════════
// MARKETPLACE
// ═══════════════════════════════════════════════════════════════
async function openMarket(charSlug) {
  const itemPages=getItemPages();
  if(!itemPages.length){toast('Нет опубликованных предметов (page_type=item)','err');return;}
  _showRpPicker('',`
    <div class="mkt-header">
      <span class="mkt-title">◈ РЫНОК СНАРЯЖЕНИЯ</span>
      <div class="mkt-balance"><span class="mkt-bal-lbl">Баланс</span><span class="mkt-bal-val" id="mkt-bal-val">…</span></div>
      <button onclick="closeRpPicker()" class="xb" style="flex-shrink:0">✕</button>
    </div>
    <div id="mkt-shell" style="overflow-y:auto;flex:1;display:flex;flex-direction:column">
      <div class="sload" style="min-height:120px"><div class="quote-loader">${getRandomQuote()}</div></div>
    </div>
  `);
  let ch=null; try{ch=(await dbGet('characters',`slug=eq.${encodeURIComponent(charSlug)}&select=*&limit=1`))?.[0];}catch(e){}
  const credits=ch?.extra?.credits||0, gear=ch?.gear||[];
  const balEl=document.getElementById('mkt-bal-val'); if(balEl)balEl.textContent=creditsFmt(credits)+' ЭК';
  const slotKeys=['weapon','armor','helmet','ring','artifact','consumable'];
  let html=`<div class="mkt-filters">
    <button class="mkt-flt on" onclick="mktFilterSlot(this,'all')">Всё</button>
    ${slotKeys.map(k=>`<button class="mkt-flt" onclick="mktFilterSlot(this,'${k}')">${GEAR_SLOT_ICONS[k]} ${GEAR_SLOT_NAMES[k]}</button>`).join('')}
    <input class="mkt-search" id="mkt-q" placeholder="🔍 Поиск..." oninput="mktSearch(this.value)">
  </div><div id="mkt-items" class="mkt-items">`;
  for(const p of itemPages){
    const ex=(typeof parseExtra==='function')?parseExtra(p.content||'[]'):{};
    const price=parseInt(ex['цена']||ex['price']||'0',10);
    const owned=gear.some(g=>g.source_slug===p.slug);
    const rc=RARITY_COLOR[ex['редкость']||ex['rarity']||'common']||'#8a8a9a';
    const slot=ex['слот']||ex['slot']||'';
    const canAff=!price||credits>=price;
    html+=`<div class="mkt-item" data-slot="${slot}" data-name="${esc(pT(p)).toLowerCase()}">
      <div class="mkt-item-rarity-bar" style="background:${rc}"></div>
      ${p.image_url?`<img src="${esc(p.image_url)}" class="mkt-item-img">`:`<div class="mkt-item-img-ph" style="border-color:${rc}">${GEAR_SLOT_ICONS[slot]||'◈'}</div>`}
      <div class="mkt-item-info">
        <div class="mkt-item-name">${esc(pT(p))}</div>
        <div class="mkt-item-meta"><span style="color:${rc}">● ${RARITY_LABEL[ex['редкость']||'common']}</span>${slot?` · ${GEAR_SLOT_ICONS[slot]} ${GEAR_SLOT_NAMES[slot]||slot}`:''}${ex['урон']?` · ⚔ ${esc(ex['урон'])}`:''}</div>
      </div>
      <div class="mkt-item-buy">
        ${price>0?`<div class="mkt-price ${canAff?'':'cant'}">${creditsFmt(price)} ЭК</div>`:`<div class="mkt-price free">Бесплатно</div>`}
        ${owned?`<div class="mkt-owned">✓ В инвентаре</div>`:`<button class="btn btn-gd btn-sm" onclick="mktBuy('${esc(p.slug)}','${esc(pT(p)).replace(/'/g,"\\'")}',${price},'${esc(charSlug)}')" ${(!canAff&&price)?'disabled style="opacity:.4"':''}>Купить</button>`}
      </div>
    </div>`;
  }
  html+=`</div>`;
  const shell=document.getElementById('mkt-shell'); if(shell)shell.innerHTML=html;
}
function mktFilterSlot(btn,slot){document.querySelectorAll('.mkt-flt').forEach(b=>b.classList.remove('on'));btn.classList.add('on');document.querySelectorAll('.mkt-item').forEach(el=>{el.style.display=(slot==='all'||el.dataset.slot===slot)?'':'none';});}
function mktSearch(q){const lq=q.toLowerCase();document.querySelectorAll('.mkt-item').forEach(el=>{el.style.display=el.dataset.name.includes(lq)?'':'none';});}

async function mktBuy(itemSlug,itemName,price,charSlug){
  const btn=event?.currentTarget; if(btn)btn.disabled=true;
  try{
    const r=await dbGet('characters',`slug=eq.${encodeURIComponent(charSlug)}&select=*&limit=1`);
    const ch=r?.[0]; if(!ch)throw new Error('Персонаж не найден');
    const extra=ch.extra||{};
    if(price>0&&(extra.credits||0)<price)throw new Error('Недостаточно кредитов');
    const iR=await dbGet('pages',`slug=eq.${encodeURIComponent(itemSlug)}&select=*&limit=1`);
    const iPg=iR?.[0];
    const iEx=(typeof parseExtra==='function')?parseExtra(iPg?.content||'[]'):{};
    const slot=iEx['слот']||iEx['slot']||'weapon';
    const rarity=iEx['редкость']||iEx['rarity']||'common';
    const slotMax=GEAR_SLOTS_MAX[slot]||1;
    const slotCur=(ch.gear||[]).filter(g=>g.slot===slot).length;
    if(slotCur>=slotMax)throw new Error(`Слот «${GEAR_SLOT_NAMES[slot]||slot}» заполнен (макс. ${slotMax})`);
    if(price>0)creditsAdd(extra,-price,'Покупка: '+itemName,'purchase');
    const gear=[...(ch.gear||[]),{name:itemName,slot,rarity,image_url:iPg?.image_url||null,source_slug:itemSlug}];

    await saveCharFull(charSlug,{gear,extra});
    closeRpPicker(); _pgCache.delete(charSlug); go(charSlug,false);
    toast(`✓ ${itemName} — в инвентаре!${price?' −'+creditsFmt(price)+' ЭК':''}`,'ok');
  }catch(e){toast('Ошибка: '+e.message,'err');if(btn)btn.disabled=false;}
}

// ═══════════════════════════════════════════════════════════════
// SHARED PICKER
// ═══════════════════════════════════════════════════════════════
function _showRpPicker(title, html) {
  document.getElementById('rp-picker-ov')?.remove();
  const ov=document.createElement('div');
  ov.id='rp-picker-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,8,.88);z-index:800;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML=`<div style="background:var(--b1);border:1px solid var(--w2);width:100%;max-width:580px;max-height:78vh;display:flex;flex-direction:column;animation:mo-in .2s ease both">${html}</div>`;
  ov.addEventListener('click',e=>{if(e.target===ov)closeRpPicker();});
  document.body.appendChild(ov);
}
function closeRpPicker(){document.getElementById('rp-picker-ov')?.remove();}
function rpPickerSearch(q){const lq=q.toLowerCase();document.getElementById('rp-pick-body')?.querySelectorAll('.rp-pick-row').forEach(r=>{r.style.display=r.textContent.toLowerCase().includes(lq)?'':'none';});}

// ═══════════════════════════════════════════════════════════════
// ABILITY / GEAR PICKERS (editor)
// ═══════════════════════════════════════════════════════════════
function _rpPickerShell(title) {
  return`<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--w2);background:var(--b2);flex-shrink:0">
    <span style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;color:var(--te);flex:1">${title}</span>
    <input style="background:var(--b3);border:1px solid var(--w2);color:var(--t1);padding:5px 10px;font-size:11px;outline:none;width:130px" placeholder="Поиск..." oninput="rpPickerSearch(this.value)" id="rp-pick-search">
    <button onclick="closeRpPicker()" style="background:none;border:none;color:var(--t4);font-size:16px;cursor:pointer;padding:2px 6px">✕</button>
  </div><div id="rp-pick-body" style="overflow-y:auto;padding:6px">`;
}

function openAbPicker(){
  const ch=editData?._char; if(!ch)return;
  const lvl=_charLvl(ch),max=Math.floor(lvl/2)+2;
  if((ch.abilities||[]).length>=max){toast(`Макс. способностей на ур.${lvl}: ${max}`,'err');return;}
  const abPgs=getAbilityPages();
  if(!abPgs.length){toast('Нет опубликованных способностей','err');return;}
  const exist=new Set((ch.abilities||[]).map(a=>a.name));
  const html=_rpPickerShell('◈ СПОСОБНОСТИ')+abPgs.map(p=>{
    const sel=exist.has(pT(p));
    const ic=(typeof getAbilityIconUrl==='function')?getAbilityIconUrl(pT(p))||'':'';
    return`<div class="rp-pick-row${sel?' rp-pick-owned':''}" onclick="${sel?'':'charPickAb(\''+esc(p.slug)+'\',\''+esc(pT(p))+'\')'}">
      ${ic?`<img src="${esc(ic)}" style="width:32px;height:32px;object-fit:cover;border:1px solid var(--w2);flex-shrink:0">`:`<div style="width:32px;height:32px;background:var(--b2);border:1px dashed var(--w2);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;color:var(--t4)">◈</div>`}
      <div style="flex:1;min-width:0"><div style="font-size:13px;color:var(--t1)">${esc(pT(p))}</div></div>
      ${sel?'<span style="color:var(--te);font-size:10px">✓</span>':''}
    </div>`;}).join('')+'</div>';
  _showRpPicker('',html);
  setTimeout(()=>document.getElementById('rp-pick-search')?.focus(),80);
}
async function charPickAb(slug,title){
  closeRpPicker();const ch=editData?._char;if(!ch)return;
  let type='passive';
  try{const r=await dbGet('pages',`slug=eq.${encodeURIComponent(slug)}&select=content&limit=1`);if(r?.[0]){const ex=(typeof parseExtra==='function')?parseExtra(r[0].content):{};type=ex['тип']||ex['type']||'passive';}}catch(e){}
  ch.abilities.push({name:title,type,desc:'',source_slug:slug});
  document.getElementById('ch-ab-list').innerHTML=charRenderAbList(ch.abilities);charUpdateAuto();
}

function openGearPicker(preferSlot){
  const iPgs=getItemPages();if(!iPgs.length){toast('Нет опубликованных предметов','err');return;}
  const gear=editData?._char?.gear||[];
  const html=_rpPickerShell(`⚔ ${GEAR_SLOT_NAMES[preferSlot]||'СНАРЯЖЕНИЕ'}`)+iPgs.map(p=>{
    const owned=gear.some(g=>g.source_slug===p.slug);
    const ex=(typeof parseExtra==='function')?parseExtra(p.content||'[]'):{};
    const slot=ex['слот']||ex['slot']||'';const rc=RARITY_COLOR[ex['редкость']||ex['rarity']||'common']||'#8a8a9a';
    const price=parseInt(ex['цена']||ex['price']||'0',10);
    return`<div class="rp-pick-row${owned?' rp-pick-owned':''}" onclick="${owned?'':'charPickGear(\''+esc(p.slug)+'\',\''+esc(pT(p))+'\',\''+esc(preferSlot)+'\')'}">
      ${p.image_url?`<img src="${esc(p.image_url)}" style="width:36px;height:36px;object-fit:cover;border:1px solid ${rc};flex-shrink:0">`:`<div style="width:36px;height:36px;border:1px dashed ${rc};display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;color:${rc}">${GEAR_SLOT_ICONS[slot]||'◈'}</div>`}
      <div style="flex:1;min-width:0"><div style="font-size:13px;color:var(--t1)">${esc(pT(p))}</div><div style="font-family:'JetBrains Mono',monospace;font-size:8px;color:${rc};margin-top:2px">● ${RARITY_LABEL[ex['редкость']||'common']}${price?` · ${creditsFmt(price)} ЭК`:''}</div></div>
      ${owned?'<span style="color:var(--te);font-size:10px">✓</span>':''}
    </div>`;}).join('')+'</div>';
  _showRpPicker('',html);
  setTimeout(()=>document.getElementById('rp-pick-search')?.focus(),80);
}
async function charPickGear(slug,title,preferSlot){
  closeRpPicker();const ch=editData?._char;if(!ch)return;
  let slot=preferSlot||'weapon',rarity='common',image_url=null;
  try{const r=await dbGet('pages',`slug=eq.${encodeURIComponent(slug)}&select=content,image_url&limit=1`);if(r?.[0]){const ex=(typeof parseExtra==='function')?parseExtra(r[0].content):{};slot=ex['слот']||ex['slot']||preferSlot||'weapon';rarity=ex['редкость']||ex['rarity']||'common';image_url=r[0].image_url||null;}}catch(e){}
  const slotMax=GEAR_SLOTS_MAX[slot]||1,slotCur=(ch.gear||[]).filter(g=>g.slot===slot).length;
  if(slotCur>=slotMax){toast(`Слот «${GEAR_SLOT_NAMES[slot]||slot}» заполнен (макс. ${slotMax})`,'err');return;}
  if(!ch.gear)ch.gear=[];
  ch.gear.push({name:title,slot,rarity,image_url,source_slug:slug});
  document.getElementById('ch-gear-list').innerHTML=(editData._char.gear||[]).map(charGearRow).join('');
  const el=document.getElementById('ch-gear-info');if(el)el.textContent=charGearSlotsInfo(editData._char.gear||[]);
}

// ═══════════════════════════════════════════════════════════════
// ADMIN: GRANT CREDITS
// ═══════════════════════════════════════════════════════════════
function openGrantCredits(charSlug,charName){
  if(!user||!['superadmin','editor','moderator'].includes(user.role))return;
  _showRpPicker('',`
    <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--w2);background:var(--b2);flex-shrink:0">
      <span style="font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;letter-spacing:3px;color:var(--te);flex:1">⭐ ВЫДАТЬ КРЕДИТЫ · ${esc(charName)}</span>
      <button onclick="closeRpPicker()" style="background:none;border:none;color:var(--t4);font-size:16px;cursor:pointer;padding:2px 6px">✕</button>
    </div>
    <div style="padding:20px;display:flex;flex-direction:column;gap:12px">
      <div class="fg"><label class="fl">Сумма (ЭК)</label><input class="fi" id="grant-amt" type="number" value="500" min="1" style="font-size:18px;text-align:center;font-family:Orbitron,sans-serif"></div>
      <div class="fg"><label class="fl">Причина</label><input class="fi" id="grant-reason" value="Выдача от администрации"></div>
      <button class="btn btn-gd btn-fw" onclick="doGrantCredits('${esc(charSlug)}')">✓ Начислить</button>
    </div>`);
}
async function doGrantCredits(charSlug){
  const amt=parseInt(document.getElementById('grant-amt')?.value||'0',10);
  const reason=document.getElementById('grant-reason')?.value?.trim()||'Выдача от администрации';
  if(!amt||amt<=0){toast('Введите сумму','err');return;}
  try{
    const r=await dbGet('characters',`slug=eq.${encodeURIComponent(charSlug)}&select=extra&limit=1`);
    const extra=r?.[0]?.extra||{};creditsAdd(extra,amt,reason,'admin');
    await saveCharFull(charSlug,{extra});closeRpPicker();_pgCache.delete(charSlug);go(charSlug,false);
    toast(`✓ Начислено ${creditsFmt(amt)} ЭК`,'ok');
  }catch(e){toast('Ошибка: '+e.message,'err');}
}
