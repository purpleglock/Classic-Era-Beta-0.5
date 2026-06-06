// ════════════════════════════════════════════════════════════
// EDITOR — edit mode, block editor, block picker, admin panel
// ════════════════════════════════════════════════════════════
async function toggleEdit() {
  if (editMode) { exitEdit(); return; }
  if (!user||!['superadmin','editor','moderator'].includes(user.role)) { toast(lang==='ru'?'Недостаточно прав':'Access denied','err'); return; }
  const token = await getTokenFresh();
  if (!token || token === SB_ANON) { toast(lang==='ru'?'Сессия истекла, войдите снова':'Session expired, sign in again','err'); doLogout(); return; }
  
  if (curSlug==='home') { enterEditHome(); return; }
  try {
    const rows = await dbGet('pages',`slug=eq.${encodeURIComponent(curSlug)}&select=*&limit=1`);
    if (!rows?.length) { toast(lang==='ru'?'Страница не найдена':'Page not found','err'); return; }
    const pg=rows[0];
    if(pg.page_type==='character'){enterEditCharacter(pg);return;}
    if(pg.page_type==='item'){enterEditItem(pg);return;}
    if(pg.page_type==='ability'){enterEditAbility(pg);return;}
    // faction, article и preview редактируются обычным редактором
    enterEditPage(pg);
  } catch(e) { toast(e.message,'err'); }
}

async function enterEditHome() {
  editMode=true; editData={isHome:true};
  document.getElementById('edit-btn').textContent='✖ Exit'; document.getElementById('edit-btn').className='tbtn edit-on';
  try {
    const rows=await dbGet('pages','slug=eq.home&select=*&limit=1');
    if(rows?.length){ editData._homeId=rows[0].id; _pgCache.set('home',rows[0]); try{editBlocks=JSON.parse(rows[0].content||'[]');}catch{editBlocks=[];} }
    else { const s=localStorage.getItem('wk_home_content')||'[]'; try{editBlocks=JSON.parse(s);}catch{editBlocks=[];} }
  } catch { const s=localStorage.getItem('wk_home_content')||'[]'; try{editBlocks=JSON.parse(s);}catch{editBlocks=[];} }
  renderEditUI(null,'Главная страница',true);
}
function enterEditPage(pg) {
  if (!pg) { toast('Страница не найдена','err'); return; }
  editMode=true; editData={...pg, _origStatus: pg.status || 'draft', page_type:pg.page_type||'article'};
  document.getElementById('edit-btn').textContent='✖ Exit'; document.getElementById('edit-btn').className='tbtn edit-on';
  const raw=pg.content||''; try{editBlocks=JSON.parse(raw);}catch{editBlocks=raw?[{type:'text',id:uid(),content:raw}]:[];}
  renderEditUI(pg,pT(pg),false);
}
// ── Site-builder editor state ─────────────────────────────────────
let _edSelIdx = null; // index of selected block in editBlocks

function renderEditUI(pg, titleVal, isHome) {
  const secOpts=sections.map(s=>`<option value="${esc(s.slug)}"${pg?.section===s.slug?' selected':''}>${esc(sN(s))}</option>`).join('');
  const parOpts=pages.filter(p=>isVisiblePage(p)&&(!pg||p.slug!==pg.slug)).map(p=>`<option value="${esc(p.slug)}"${pg?.parent_slug===p.slug?' selected':''}>${esc(pT(p))}</option>`).join('');
  const isRu = lang==='ru';
  _edSelIdx = null;
  document.getElementById('pg').className='pgi editor-fullscreen';
  document.getElementById('pg').innerHTML=`
<div class="ed-wrap" id="sb-wrap">

  <!-- TOP BAR -->
  <div class="ed-bar">
    <div class="ed-bar-l">
      ${pg ? `<div class="ed-status-toggle">
        <button class="ed-st-btn${pg?.status==='published'?' on':''}" onclick="setEdStatus('published')">
          <span class="ed-st-dot pub"></span>${isRu?'Опубликовано':'Published'}
        </button>
        <button class="ed-st-btn${pg?.status!=='published'?' on':''}" onclick="setEdStatus('draft')">
          <span class="ed-st-dot dft"></span>${isRu?'Черновик':'Draft'}
        </button>
      </div>` : `<span class="ed-bar-label">${isRu?'ГЛАВНАЯ':'HOME'}</span>`}
      ${pg ? `<button class="ed-meta-btn" onclick="edToggleMeta()" id="ed-meta-btn">⚙ ${isRu?'Настройки':'Settings'}</button>` : ''}
    </div>
    <div class="ed-bar-c">
      <span class="ed-bar-title">${esc(isHome?(isRu?'Главная страница':'Home page'):titleVal)}</span>
    </div>
    <div class="ed-bar-r">
      <button class="ed-btn-cancel" onclick="exitEdit()">${isRu?'Отмена':'Cancel'}</button>
      <button class="ed-btn-save" onclick="saveEdit()">✓ ${isRu?'Сохранить':'Save'}</button>
    </div>
  </div>

  <!-- META DRAWER (hidden by default) -->
  ${pg ? `<div class="ed-meta-drawer" id="ed-meta-drawer">
    <div class="ed-meta-grid">
      <div class="ed-mf">
        <label class="ed-ml">${isRu?'Заголовок EN':'Title EN'}</label>
        <input class="ed-mi" id="ei-ten" value="${esc(pg.title_ru||'')}" placeholder="English title">
      </div>
      <div class="ed-mf">
        <label class="ed-ml">Slug</label>
        <input class="ed-mi" id="ei-slug" value="${esc(pg.slug||'')}">
      </div>
      <div class="ed-mf">
        <label class="ed-ml">${isRu?'Раздел':'Section'}</label>
        <select class="ed-mi" id="ei-sec"><option value="">—</option>${secOpts}</select>
      </div>
      <div class="ed-mf">
        <label class="ed-ml">${isRu?'Родитель':'Parent'}</label>
        <select class="ed-mi" id="ei-par"><option value="">—</option>${parOpts}</select>
      </div>
      <div class="ed-mf">
        <label class="ed-ml">${isRu?'Теги':'Tags'}</label>
        <input class="ed-mi" id="ei-tags" placeholder="${isRu?'технология, оружие, империя':'technology, weapon, empire'}" value="${esc(pg.tags||'')}" oninput="editData.tags=this.value">
        <div style="font-size:9px;color:var(--t4);margin-top:4px;font-family:'JetBrains Mono',monospace">${isRu?'Через запятую':'Comma separated'}</div>
      </div>
      <div class="ed-mf">
        <label class="ed-ml">${isRu?'Тип страницы':'Page type'}</label>
        <select class="ed-mi" id="ei-pgtype" onchange="editData.page_type=this.value">
          <option value="article"${(pg.page_type||'article')==='article'?' selected':''}>📄 Статья</option>
          <option value="character"${pg.page_type==='character'?' selected':''}>◉ Персонаж</option>
          <option value="faction"${pg.page_type==='faction'?' selected':''}>⬡ Фракция</option>
          <option value="item"${pg.page_type==='item'?' selected':''}>⚔ Снаряжение</option>
          <option value="ability"${pg.page_type==='ability'?' selected':''}>◈ Способность</option>
          <option value="unit"${pg.page_type==='unit'?' selected':''}>⊕ Юнит / Корабль</option>
          <option value="preview"${pg.page_type==='preview'?' selected':''}>◈ Превью (общее)</option>
          <option value="preview-weapon"${pg.page_type==='preview-weapon'?' selected':''}>⚔ Превью оружия</option>
          <option value="preview-armor"${pg.page_type==='preview-armor'?' selected':''}>🛡 Превью брони</option>
          <option value="location"${pg.page_type==='location'?' selected':''}>📍 Локация</option>
        </select>
      </div>
    </div>
  </div>` : ''}

  <!-- MAIN CANVAS -->
  <div class="ed-canvas" id="ed-canvas">
    <div class="ed-canvas-inner">

      <!-- Cover -->
      ${pg ? `<div class="ed-cov" id="sb-cov-strip" onclick="openCovMo()" title="${isRu?'Нажмите для изменения обложки':'Click to change cover'}">
        ${pg.image_url
          ? `<img src="${esc(pg.image_url)}" style="width:100%;height:100%;object-fit:cover;object-position:${esc(pg.cover_pos||'center center')}"><div class="ed-cov-ov">✎ ${isRu?'Обложка':'Cover'}</div>`
          : `<div class="ed-cov-empty">🖼 ${isRu?'+ Добавить обложку':'+ Add cover'}</div>`}
      </div>` : ''}

      <!-- Title -->
      <div class="ed-title-row">
        ${isHome
          ? `<div class="ed-home-lbl">${isRu?'ГЛАВНАЯ СТРАНИЦА':'HOME PAGE'}</div>
             <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0 6px">
               <div>
                 <label style="display:block;font-size:9px;letter-spacing:1px;color:var(--gdl);margin-bottom:4px;font-family:'JetBrains Mono',monospace">НАДПИСЬ RU</label>
                 <input class="ed-mi" id="ei-title-ru" value="${esc(_pgCache.get('home')?.title||'КЛАССИЧЕСКАЯ ЭРА')}" placeholder="КЛАССИЧЕСКАЯ ЭРА" style="font-family:'Rajdhani',sans-serif;font-size:12px;font-weight:700;letter-spacing:2px">
               </div>
               <div>
                 <label style="display:block;font-size:9px;letter-spacing:1px;color:var(--te);margin-bottom:4px;font-family:'JetBrains Mono',monospace">НАДПИСЬ EN</label>
                 <input class="ed-mi" id="ei-title-en" value="${esc(_pgCache.get('home')?.title_ru||'CLASSIC ERA')}" placeholder="CLASSIC ERA" style="font-family:'Rajdhani',sans-serif;font-size:12px;font-weight:700;letter-spacing:2px">
               </div>
             </div>
             <div style="font-size:9px;color:var(--t4);margin-bottom:12px;padding:4px 8px;background:var(--b3);border-left:2px solid var(--gdl);font-family:'JetBrains Mono',monospace">Текст коллажа. Разбивается на 2 строки по пробелу.</div>`
          : `<input class="ed-h1" id="ei-h1" value="${esc(titleVal)}" placeholder="${isRu?'Заголовок...':'Title...'}">`}
      </div>

      <!-- Blocks -->
      <div class="ed-blocks" id="sb-blocks"></div>

      <!-- Add first / bottom button -->
      <div class="ed-add-row">
        <button class="ed-add-btn" onclick="openPicker(editBlocks.length-1,event)">＋ ${isRu?'Добавить блок':'Add block'}</button>
      </div>

    </div>
  </div>
</div>`;
  renderBlockEditor();
}

function edToggleMeta() {
  const d = document.getElementById('ed-meta-drawer');
  const b = document.getElementById('ed-meta-btn');
  if (!d) return;
  const open = d.classList.toggle('open');
  if (b) b.classList.toggle('on', open);
}

function tgProps() {}
function setEdStatus(s) {
  if(editData) editData.status=s;
  // New editor UI uses .ed-st-btn buttons
  document.querySelectorAll('.ed-st-btn').forEach(btn => {
    const isPub = btn.textContent.includes('Опубл') || btn.textContent.includes('Published');
    btn.classList.toggle('on', s === 'published' ? isPub : !isPub);
  });
}

async function saveEdit() {
  if (!user||!['superadmin','editor','moderator'].includes(user.role)) { toast(lang==='ru'?'Нет прав':'Access denied','err'); return; }
  // Проверка лимитов для юнита
  if (editData?.page_type === 'unit') {
    const _ib0 = (editBlocks||[]).find(b=>b.type==='infobox');
    if (_ib0) {
      const _rows = _ib0.sections?.[0]?.rows||[];
      const _val = k => (_rows.find(r=>r.key===k)||{}).val||'';
      const _reactorName = _val('Реактор');
      const _rp = (typeof pages!=='undefined'?pages:[]).find(p=>(p.title||p.name||'')===_reactorName);
      const _rIb = (_rp&&_rp.infobox)||{};
      const _rPow = parseFloat(_rIb['Мощность']||_rIb['power']||0)||0;
      const _mass = parseFloat((_val('Масса')||'100').replace(/[^0-9.]/g,''))||100;
      const _capB = parseFloat(_rIb['Бонус вместимости']||0)||0;
      const _baseCap = Math.round(_mass*0.7)+_capB;
      var _usedP=0,_usedC=0;
      _rows.forEach(function(r){
        var k=r.key||''; var name=r.val||'';
        if(!name||!(/^(Двигатель|Орудие|Радар|Щит|Модуль) [0-9]+$/.test(k))) return;
        var mp=(typeof pages!=='undefined'?pages:[]).find(p=>(p.title||p.name||'')===name);
        var mib=(mp&&mp.infobox)||{};
        _usedP+=parseFloat(mib['Потребление энергии']||mib['power']||0)||0;
        _usedC+=parseFloat(mib['Штраф вместимости']||mib['capacityPenalty']||0)||0;
      });
      if (_rPow>0 && _usedP>_rPow) {
        toast('Превышен лимит энергии: '+_usedP+' / '+_rPow+' МВт. Уберите лишние модули.','err');
        return;
      }
      if (_baseCap>0 && _usedC>_baseCap) {
        toast('Превышена вместимость: '+_usedC+' / '+_baseCap+' ед. Уберите лишние орудия.','err');
        return;
      }
    }
  }
  if (editData?.isHome) {
    try {
      const content=JSON.stringify(editBlocks); const now=new Date().toISOString();
      const _tRu=document.getElementById('ei-title-ru')?.value?.trim()||'КЛАССИЧЕСКАЯ ЭРА';
      const _tEn=document.getElementById('ei-title-en')?.value?.trim()||'CLASSIC ERA';
      const _hb={content,updated_at:now,title:_tRu,title_ru:_tEn};
      if (editData._homeId) { await dbPatch('pages',`id=eq.${editData._homeId}`,_hb); }
      else { await dbPost('pages',{slug:'home',..._hb,content_ru:'',status:'published',sort_order:-1,created_by:user.email,created_at:now}); localStorage.removeItem('wk_home_content'); }
      _pgCache.delete('home'); await loadHomePage(); exitEdit(true); await renderHome(); toast(T('saveOk'),'ok');
    } catch(e) { toast(T('saveErr')+' '+e.message,'err'); } return;
  }
  const title=document.getElementById('ei-h1')?.value?.trim();
  if (!title) { toast(lang==='ru'?'Заголовок обязателен':'Title is required','err'); return; }
  const body={ title, content:JSON.stringify(editBlocks), updated_at:new Date().toISOString(), title_ru:document.getElementById('ei-ten')?.value?.trim()||'', content_ru:'', status:editData.status||'draft', section:document.getElementById('ei-sec')?.value||null, parent_slug:document.getElementById('ei-par')?.value||null, image_url:editData.image_url||null, cover_height:editData.cover_height||null, cover_pos:editData.cover_pos||null, cover_type:editData.cover_type||'standard', exclude_from_collage:editData.exclude_from_collage||false, tags:editData.tags||null, page_type:document.getElementById('ei-pgtype')?.value||editData.page_type||'article' };
  try {
    if(editData.id) await dbPatch('pages',`id=eq.${editData.id}`,body);
    else { body.created_by=user.email; await dbPost('pages',body); }
    await loadPgs(); buildNav();
    const finalSlug=document.getElementById('ei-slug')?.value?.trim()||editData.slug;
    _pgCache.delete(finalSlug); exitEdit(true); go(finalSlug, false); toast(T('saveOk'),'ok');
  } catch(e) { toast(T('saveErr')+' '+e.message,'err'); }
}
function exitEdit(restore=false) { editMode=false; editData=null; editBlocks=[]; _edSelIdx=null; const eb=document.getElementById('edit-btn'); if(eb){eb.textContent='✎ '+(lang==='ru'?'Редактировать':'Edit');eb.className='tbtn';} updAuthUI(); if(!restore) go(curSlug, false); }

function upBlock(i,key,val) { if(editBlocks[i]) editBlocks[i][key]=val; }
function mvBlock(i,dir) { const j=i+dir; if(j<0||j>=editBlocks.length) return; [editBlocks[i],editBlocks[j]]=[editBlocks[j],editBlocks[i]]; renderBlockEditor(); }
function rmBlock(i) { editBlocks.splice(i,1); renderBlockEditor(); }
function renderBlockEditor() {
  const c=document.getElementById('sb-blocks'); if(!c) return;
  const isRu=lang==='ru';
  if(!editBlocks.length){
    c.innerHTML=`<div class="ed-empty-blocks">
      <div style="font-size:32px;opacity:.12;margin-bottom:8px">⊞</div>
      <div>${isRu?'Нет блоков. Нажмите «Добавить блок».':'No blocks yet.'}</div>
    </div>`;
    _edSelIdx=null;
    return;
  }
  c.innerHTML=editBlocks.map((b,i)=>{
    const isSel=_edSelIdx===i;
    const label=blockLabel(b.type);
    const rendered = renderBlock(b);
    const formHtml = isSel ? blockEditorHtml(b,i) : '';
    return `<div class="ed-block${isSel?' open':''}" id="sbc-${b.id}">
      <div class="ed-block-hdr" onclick="selectBlock(${i})">
        <span class="ed-block-icon">${blockIcon(b.type)}</span>
        <span class="ed-block-lbl">${label}</span>
        <div class="ed-block-acts">
          <button title="↑" onclick="event.stopPropagation();mvBlock(${i},-1)">↑</button>
          <button title="↓" onclick="event.stopPropagation();mvBlock(${i},1)">↓</button>
          <button title="＋" onclick="event.stopPropagation();openPicker(${i},event)" class="ed-act-add">＋</button>
          <button title="✕" onclick="event.stopPropagation();rmBlock(${i})" class="ed-act-del">✕</button>
        </div>
      </div>
      <div class="ed-block-render">
        <div style="padding:0">${rendered}</div>
        <div class="ed-block-render-overlay" onclick="selectBlock(${i})"></div>
      </div>
      ${isSel ? `<div class="ed-block-form">${formHtml}</div>` : ''}
    </div>`;
  }).join('');
  // Init canvas-based blocks inside editor
  setTimeout(()=>{
    c.querySelectorAll('.blk-rg-canvas[data-nodes]').forEach(canvas=>{
      try { initRelGraph(canvas.id, JSON.parse(canvas.dataset.nodes||'[]'), JSON.parse(canvas.dataset.edges||'[]')); } catch(e){}
    });
    c.querySelectorAll('.blk-chart-canvas[data-chart]').forEach(canvas=>{
      try { initWikiChart(canvas.id, JSON.parse(canvas.dataset.chart)); } catch(e){}
    });
  }, 80);
}

function blockIcon(t) {
  const icons={text:'¶',heading:'Aa',quote:'❞',alert:'⚠',callout:'💬',spoiler:'🔒',image:'🖼',imgtext:'🖼',gallery:'⊞',infobox:'📋',cols:'⫛',frame:'🗂',divider:'—',table:'▦',stats:'◉',timeline:'◈',vis_timeline:'⟿',rel_graph:'◎',chart:'📈',battle_map:'🗺'};
  return icons[t]||'◈';
}

function selectBlock(i){
  _edSelIdx = (_edSelIdx === i) ? null : i; // toggle
  renderBlockEditor();
  if (_edSelIdx !== null) {
    setTimeout(()=>{
      const card=document.getElementById('sbc-'+(editBlocks[_edSelIdx]?.id||''));
      if(card) card.scrollIntoView({behavior:'smooth',block:'nearest'});
    },50);
  }
}
function refreshBlockPropsPanel(){ renderBlockEditor(); }

function blockMiniPreview(b){
  const esc2=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  switch(b.type){
    case 'text': return `<div class="sbp-text">${(b.content||'').slice(0,120)||'<span style="opacity:.3">…</span>'}</div>`;
    case 'heading': return `<div class="sbp-heading">${esc2(b.text||'').slice(0,60)||'<span style="opacity:.3">…</span>'}</div>`;
    case 'toc': return `<div class="sbp-placeholder">≡ ${lang==='ru'?'Содержание (авто)':'Contents (auto)'}</div>`;
    case 'image': return b.url?`<div class="sbp-img"><img src="${esc2(b.url)}" style="max-height:60px;max-width:100%;object-fit:cover;border-radius:2px"></div>`:`<div class="sbp-placeholder">🖼 ${esc2(b.caption||'Image')}</div>`;
    case 'imgtext': return `<div class="sbp-imgtext"><div style="flex:0 0 40px;height:32px;background:var(--w2);border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:10px;opacity:.4">🖼</div><div class="sbp-text">${(b.content||'').slice(0,80)||'…'}</div></div>`;
    case 'callout': return `<div class="sbp-callout sbp-callout-${b.variant||'info'}">${esc2(b.icon||'ℹ')} ${esc2(b.title||'').slice(0,50)||'…'}</div>`;
    case 'alert': return `<div class="sbp-alert">${esc2(b.title||b.variant||'').slice(0,60)||'…'}</div>`;
    case 'quote': return `<div class="sbp-quote">❞ ${esc2(b.text||'').slice(0,80)||'…'}</div>`;
    case 'frame': return `<div class="sbp-frame">🗂 ${esc2(b.label||'').slice(0,50)||'…'}</div>`;
    case 'spoiler': return `<div class="sbp-spoiler">🔒 ${esc2(b.label||'HIDDEN').slice(0,50)}</div>`;
    case 'table': return `<div class="sbp-placeholder">📊 ${(b.headers||[]).join(', ').slice(0,60)||'Table'}</div>`;
    case 'divider': return `<div class="sbp-divider">${b.style==='ornament'?'◈ ◈ ◈':b.style==='stars'?'✦ ✦ ✦':'─────'}</div>`;
    case 'cols': return `<div class="sbp-placeholder">⫛ ${b.cols||2} ${lang==='ru'?'колонки':'columns'}</div>`;
    case 'gallery': return `<div class="sbp-placeholder">⊞ ${(b.images||[]).length} ${lang==='ru'?'изображений':'images'}</div>`;
    case 'infobox': return `<div class="sbp-infobox">📋 ${esc2(b.title||'').slice(0,50)||'Infobox'}</div>`;
    case 'stats': return `<div class="sbp-stats">${(b.items||[]).slice(0,3).map(it=>`<span>${esc2(it.val||'?')}<small>${esc2(it.label||'')}</small></span>`).join('')}</div>`;
    case 'timeline': return `<div class="sbp-placeholder">◈ ${(b.items||[]).length} ${lang==='ru'?'событий':'events'}</div>`;
    case 'battle_map': return `<div class="sbp-placeholder">🗺 ${esc2(b.title||'Battle Map').slice(0,50)}</div>`;
    case 'rel_graph': return `<div class="sbp-placeholder">◎ ${esc2(b.title||'Граф связей').slice(0,50)} <span style="opacity:.5;font-size:9px">${(b.nodes||[]).length} узл. · ${(b.edges||[]).length} св.</span></div>`;
    case 'vis_timeline': return `<div class="sbp-placeholder">⟿ ${esc2(b.title||'Хронология').slice(0,50)} <span style="opacity:.5;font-size:9px">${(b.items||[]).length} событий</span></div>`;
    case 'chart': return `<div class="sbp-placeholder">📈 ${esc2(b.title||'График').slice(0,50)} <span style="opacity:.5;font-size:9px">${b.chart_type||'bar'}</span></div>`;
    default: return `<div class="sbp-placeholder">${esc2(b.type)}</div>`;
  }
}

function upBlock(i,key,val) {
  if(editBlocks[i]) editBlocks[i][key]=val;
  // refresh just the preview card (not full re-render to preserve cursor)
  const b=editBlocks[i];
  const card=document.getElementById('sbc-'+(b?.id||''));
  if(card){const pv=card.querySelector('.sb-block-preview');if(pv&&b) pv.innerHTML=blockMiniPreview(b);}
}
function mvBlock(i,dir) { const j=i+dir; if(j<0||j>=editBlocks.length) return; [editBlocks[i],editBlocks[j]]=[editBlocks[j],editBlocks[i]]; if(_edSelIdx===i)_edSelIdx=j;else if(_edSelIdx===j)_edSelIdx=i; renderBlockEditor(); }
function rmBlock(i) { editBlocks.splice(i,1); if(_edSelIdx===i)_edSelIdx=null;else if(_edSelIdx>i)_edSelIdx--; renderBlockEditor(); }

function blockLabel(t){
  const isRu=lang==='ru';
  const labels={
    text:isRu?'📝 Текст':'📝 Text',
    image:isRu?'🖼 Изображение':'🖼 Image',
    imgtext:isRu?'🖼 Фото + Текст':'🖼 Photo + Text',
    callout:isRu?'💬 Выноска':'💬 Callout',
    frame:isRu?'🗂 Фрейм':'🗂 Frame',
    table:isRu?'📊 Таблица':'📊 Table',
    divider:isRu?'— Разделитель':'— Divider',
    cols:isRu?'⫛ Колонки':'⫛ Columns',
    quote:isRu?'❞ Цитата':'❞ Quote',
    gallery:isRu?'⊞ Галерея':'⊞ Gallery',
    infobox:isRu?'📋 Инфобокс':'📋 Infobox',
    heading:isRu?'Aa Заголовок':'Aa Heading',
    alert:isRu?'⚠ Метка':'⚠ Alert',
    spoiler:isRu?'🔒 Спойлер':'🔒 Spoiler',
    stats:isRu?'◉ Статистика':'◉ Stats',
    timeline:isRu?'◈ Хронология':'◈ Timeline',
    battle_map:isRu?'🗺 Тактическая карта':'🗺 Battle Map'
  };
  return labels[t]||t;
}

function blockEditorHtml(b,i){
  const isRu=lang==='ru';
  const lRu=(t)=>`<label class="sb-fi-label">${t}</label>`;
  const lEn=(t)=>`<label class="sb-fi-label sb-fi-label-en">${t} EN</label>`;
  const biRow=(labelRu,keyRu,labelEn,keyEn,valRu,valEn)=>`
    <div class="sb-field">${lRu(labelRu)}<input class="sb-fi" value="${esc(valRu||'')}" oninput="upBlock(${i},'${keyRu}',this.value)"></div>
    <div class="sb-field">${lEn(labelEn)}<input class="sb-fi" value="${esc(valEn||'')}" oninput="upBlock(${i},'${keyEn}',this.value)"></div>`;
  const biTA=(labelRu,keyRu,labelEn,keyEn,valRu,valEn,rows)=>`
    <div class="sb-field">${lRu(labelRu)}<textarea class="sb-fi" rows="${rows||3}" oninput="upBlock(${i},'${keyRu}',this.value)">${esc(valRu||'')}</textarea></div>
    <div class="sb-field">${lEn(labelEn)}<textarea class="sb-fi" rows="${rows||3}" oninput="upBlock(${i},'${keyEn}',this.value)">${esc(valEn||'')}</textarea></div>`;
  switch(b.type){
    case 'heading': return `
      ${biRow(isRu?'Текст RU':'Text RU','text',isRu?'Текст':'Text','text_en',b.text,b.text_en)}
      <div class="sb-field"><label class="sb-fi-label">${isRu?'Стиль':'Style'}</label>
        <select class="sb-fi" onchange="upBlock(${i},'style',this.value)">
          <option value="h-scan"${b.style==='h-scan'?' selected':''}>◈ SCAN</option>
          <option value="h-gold"${b.style==='h-gold'?' selected':''}>◈ GOLD</option>
          <option value="h-glitch"${b.style==='h-glitch'?' selected':''}>| GLITCH</option>
          <option value="h-sub"${b.style==='h-sub'?' selected':''}>— SUB</option>
        </select>
      </div>`;
    case 'toc': return `<div style="padding:8px 0;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--te);letter-spacing:1px">${isRu?'◈ Содержание автоматически собирается из заголовков на странице. Редактировать нечего.':'◈ Table of contents is auto-built from page headings. Nothing to edit.'}</div>`;
    case 'alert': return `
      <div class="sb-field"><label class="sb-fi-label">${isRu?'Тип':'Type'}</label>
        <select class="sb-fi" onchange="upBlock(${i},'variant',this.value)">
          <option value="classified"${b.variant==='classified'?' selected':''}>🔴 CLASSIFIED</option>
          <option value="secret"${b.variant==='secret'?' selected':''}>🟡 CONFIDENTIAL</option>
          <option value="intel"${b.variant==='intel'?' selected':''}>🔵 INTEL</option>
        </select>
      </div>
      ${biRow(isRu?'Заголовок RU':'Title RU','title',isRu?'Заголовок':'Title','title_en',b.title,b.title_en)}
      ${biTA(isRu?'Текст RU':'Text RU','content',isRu?'Текст':'Text','content_en',b.content,b.content_en,3)}`;
    case 'spoiler': return `
      ${biRow(isRu?'Кнопка RU':'Button RU','label',isRu?'Кнопка':'Button','label_en',b.label,b.label_en)}
      ${biTA(isRu?'Содержимое RU':'Content RU','content',isRu?'Содержимое':'Content','content_en',b.content,b.content_en,5)}`;
    case 'stats': return `
      <div class="sb-field-label">${isRu?'Показатели (до 6)':'Stats (up to 6)'}</div>
      ${(b.items||[]).map((it,k)=>`<div class="sb-stats-row">
        <input class="sb-fi" placeholder="${isRu?'Значение':'Value'}" value="${esc(it.val||'')}" oninput="editBlocks[${i}].items[${k}].val=this.value">
        <input class="sb-fi" placeholder="${isRu?'Подпись RU':'Label RU'}" value="${esc(it.label||'')}" oninput="editBlocks[${i}].items[${k}].label=this.value">
        <input class="sb-fi sb-fi-en" placeholder="Label EN" value="${esc(it.label_en||'')}" oninput="editBlocks[${i}].items[${k}].label_en=this.value">
        <button class="sb-del-btn" onclick="editBlocks[${i}].items.splice(${k},1);refreshBlockPropsPanel()">✕</button>
      </div>`).join('')}
      ${(b.items||[]).length<6?`<button class="sb-add-inline" onclick="editBlocks[${i}].items.push({val:'',label:''});refreshBlockPropsPanel()">+ ${isRu?'Добавить':'Add'}</button>`:''}`;
    case 'timeline': return `
      <div class="sb-field-label">${isRu?'События':'Events'}</div>
      ${(b.items||[]).map((it,k)=>`<div class="sb-timeline-item">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
          <input class="sb-fi" placeholder="${isRu?'Дата / Период':'Date / Period'}" value="${esc(it.date||'')}" oninput="editBlocks[${i}].items[${k}].date=this.value">
          <input class="sb-fi sb-fi-en" placeholder="Date EN" value="${esc(it.date_en||'')}" oninput="editBlocks[${i}].items[${k}].date_en=this.value">
        </div>
        <textarea class="sb-fi" rows="2" placeholder="${isRu?'Текст RU (отображается в хронологии)':'Text RU (shown in timeline)'}" oninput="editBlocks[${i}].items[${k}].text=this.value">${esc(it.text||it.title||'')}</textarea>
        <textarea class="sb-fi sb-fi-en" rows="2" placeholder="Text EN (shown in timeline)" oninput="editBlocks[${i}].items[${k}].text_en=this.value">${esc(it.text_en||it.title_en||'')}</textarea>
        <button class="sb-del-btn" style="margin-top:4px" onclick="editBlocks[${i}].items.splice(${k},1);refreshBlockPropsPanel()">✕ ${isRu?'Удалить':'Delete'}</button>
      </div>`).join('')}
      <button class="sb-add-inline" onclick="editBlocks[${i}].items.push({date:'',date_en:'',text:'',text_en:''});refreshBlockPropsPanel()">+ ${isRu?'Событие':'Event'}</button>`;
    case 'text': return `<div class="md-toolbar">
<button class="mdt" title="${isRu?'Жирный':'Bold'}" onclick="mdIns('**','**','${isRu?'текст':'text'}',${i})"><b>B</b></button>
<button class="mdt" title="${isRu?'Курсив':'Italic'}" onclick="mdIns('*','*','${isRu?'текст':'text'}',${i})"><i>I</i></button>
<button class="mdt" title="${isRu?'Код':'Code'}" onclick="mdIns('\`','\`','${isRu?'код':'code'}',${i})">{ }</button>
<button class="mdt" title="H2" onclick="mdIns('## ','','${isRu?'Заголовок':'Heading'}',${i})">H2</button>
<button class="mdt" title="H3" onclick="mdIns('### ','','${isRu?'Заголовок':'Heading'}',${i})">H3</button>
<button class="mdt" title="${isRu?'Список':'List'}" onclick="mdIns('- ','','${isRu?'пункт':'item'}',${i})">• —</button>
<button class="mdt" title="${isRu?'Цитата':'Quote'}" onclick="mdIns('> ','','${isRu?'текст':'text'}',${i})">"</button>
<button class="mdt" title="${isRu?'Ссылка':'Link'}" onclick="mdIns('[','](https://)','${isRu?'текст':'text'}',${i})">🔗</button>
<div class="mdt-sep"></div>
<button class="mdt" title="${isRu?'Цвет: Золото':'Color: Gold'}" style="color:#4e9ed8;border-color:rgba(176,112,48,.4)" onclick="mdIns('[c:gold]','[/c]','${isRu?'текст':'text'}',${i})">Au</button>
<button class="mdt" title="${isRu?'Цвет: Циан':'Color: Cyan'}" style="color:#6bb8d4;border-color:rgba(74,127,165,.4)" onclick="mdIns('[c:cyan]','[/c]','${isRu?'текст':'text'}',${i})">Cy</button>
<button class="mdt" title="${isRu?'Цвет: Красный':'Color: Red'}" style="color:#cc4848;border-color:rgba(168,48,48,.4)" onclick="mdIns('[c:red]','[/c]','${isRu?'текст':'text'}',${i})">Re</button>
<button class="mdt" title="${isRu?'Цвет: Фиолетовый':'Color: Purple'}" style="color:#a070e8;border-color:rgba(112,64,200,.4)" onclick="mdIns('[c:purple]','[/c]','${isRu?'текст':'text'}',${i})">Pu</button>
<button class="mdt" title="${isRu?'Цвет: Зелёный':'Color: Green'}" style="color:#2a9e62;border-color:rgba(42,158,98,.4)" onclick="mdIns('[c:green]','[/c]','${isRu?'текст':'text'}',${i})">Gr</button>
<button class="mdt" title="${isRu?'Цвет: Тусклый':'Color: Dim'}" style="color:var(--t4)" onclick="mdIns('[c:dim]','[/c]','${isRu?'текст':'text'}',${i})">Di</button>
<div class="mdt-sep"></div>
<button class="mdt" title="Bg: Cyber" style="background:rgba(74,127,165,.15);border-color:rgba(74,127,165,.4);color:#6bb8d4" onclick="mdIns('[bg:cyber]','[/bg]','${isRu?'текст':'text'}',${i})">▌Cy</button>
<button class="mdt" title="Bg: Gold" style="background:rgba(176,112,48,.15);border-color:rgba(176,112,48,.4);color:#4e9ed8" onclick="mdIns('[bg:gold]','[/bg]','${isRu?'текст':'text'}',${i})">▌Au</button>
<button class="mdt" title="Bg: Danger" style="background:rgba(168,48,48,.15);border-color:rgba(168,48,48,.4);color:#cc4848" onclick="mdIns('[bg:danger]','[/bg]','${isRu?'текст':'text'}',${i})">▌⚠</button>
<button class="mdt" title="Bg: Lore" style="background:rgba(112,64,200,.15);border-color:rgba(112,64,200,.4);color:#a070e8" onclick="mdIns('[bg:lore]','[/bg]','${isRu?'текст':'text'}',${i})">▌Lr</button>
<button class="mdt" title="Bg: Redacted" style="background:#111;border-color:#333;color:#555" onclick="mdIns('[bg:redacted]','[/bg]','${isRu?'текст':'text'}',${i})">▌██</button>
<div class="mdt-sep"></div>
<button class="mdt" title="FX: Scanner" style="background:linear-gradient(90deg,rgba(74,127,165,.1),rgba(176,112,48,.1));border-color:rgba(176,112,48,.3);font-size:9px;letter-spacing:.5px" onclick="mdIns('[fx:scanner]','[/fx]','TEXT',${i})">SCAN</button>
<button class="mdt" title="FX: Glitch" style="color:#f05;border-color:rgba(255,0,85,.3);font-size:9px;letter-spacing:.5px;text-shadow:1px 0 #0ff,-1px 0 #f05" onclick="mdIns('[fx:glitch]','[/fx]','TEXT',${i})">GLITCH</button>
<button class="mdt" title="FX: Jitter" style="color:var(--t2);border-color:var(--w3);font-size:9px;letter-spacing:.5px" onclick="mdIns('[fx:jitter]','[/fx]','TEXT',${i})">JITTER</button>
</div>
<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
  <button class="prv-tg" id="prv-tg-${b.id}" onclick="tgPrv('${b.id}')" style="font-size:10px">◉ ${isRu?'Предпросмотр':'Preview'}</button>
</div>
<textarea class="sb-fi" id="ta-${b.id}" rows="8" placeholder="${isRu?'Текст (Markdown)...':'Text (Markdown)...'}" oninput="upBlock(${i},'content',this.value)">${esc(b.content||'')}</textarea>
<div id="prv-${b.id}" style="display:none" class="prose"></div>
<div class="sb-field" style="margin-top:10px">
  <label class="sb-fi-label sb-fi-label-en">EN ${isRu?'перевод':'translation'}</label>
  <textarea class="sb-fi" rows="4" placeholder="Content in English..." oninput="upBlock(${i},'content_en',this.value)">${esc(b.content_en||'')}</textarea>
</div>`;
    case 'image': return `
      <div class="sb-field"><label class="sb-fi-label">${isRu?'URL изображения':'Image URL'}</label>
        <div style="display:flex;gap:6px">
          <input class="sb-fi" id="img-u-${b.id}" value="${esc(b.url||'')}" placeholder="https://..." oninput="upBlock(${i},'url',this.value);document.getElementById('img-prv-${b.id}').src=this.value;document.getElementById('img-prv-${b.id}').style.display=this.value?'block':'none'" style="flex:1">
          <label class="sb-upload-btn">📁<input type="file" accept="image/*" style="display:none" onchange="handleImgUpload(this.files[0],url=>{document.getElementById('img-u-${b.id}').value=url;upBlock(${i},'url',url);document.getElementById('img-prv-${b.id}').src=url;document.getElementById('img-prv-${b.id}').style.display='block'})"></label>
        </div>
        <img id="img-prv-${b.id}" src="${esc(b.url||'')}" style="max-width:100%;max-height:120px;display:${b.url?'block':'none'};margin-top:8px;border-radius:3px;object-fit:cover">
      </div>
      <div class="sb-field"><label class="sb-fi-label">Alt</label><input class="sb-fi" value="${esc(b.alt||'')}" oninput="upBlock(${i},'alt',this.value)"></div>
      <div class="sb-field"><label class="sb-fi-label">${isRu?'Подпись':'Caption'}</label><input class="sb-fi" value="${esc(b.caption||'')}" oninput="upBlock(${i},'caption',this.value)"></div>
      <div class="sb-field"><label class="sb-fi-label">${isRu?'Макс. высота (px)':'Max height (px)'}</label><input class="sb-fi" type="number" value="${esc(b.maxh||480)}" min="100" max="1200" oninput="upBlock(${i},'maxh',+this.value)"></div>`;
    case 'imgtext': return `
      <div class="sb-field"><label class="sb-fi-label">${isRu?'URL изображения':'Image URL'}</label>
        <div style="display:flex;gap:6px">
          <input class="sb-fi" id="imt-u-${b.id}" value="${esc(b.imgUrl||'')}" placeholder="https://..." oninput="upBlock(${i},'imgUrl',this.value)" style="flex:1">
          <label class="sb-upload-btn">📁<input type="file" accept="image/*" style="display:none" onchange="handleImgUpload(this.files[0],url=>{document.getElementById('imt-u-${b.id}').value=url;upBlock(${i},'imgUrl',url)})"></label>
        </div>
      </div>
      <div class="sb-field"><label class="sb-fi-label">${isRu?'Расположение':'Layout'}</label>
        <select class="sb-fi" onchange="upBlock(${i},'layout',this.value)">
          <option value="l"${b.layout==='l'?' selected':''}>${isRu?'Слева':'Left'}</option>
          <option value="r"${b.layout==='r'?' selected':''}>${isRu?'Справа':'Right'}</option>
        </select>
      </div>
      <div class="sb-field"><label class="sb-fi-label">${isRu?'Подпись к фото':'Photo caption'}</label><input class="sb-fi" value="${esc(b.caption||'')}" oninput="upBlock(${i},'caption',this.value)"></div>
      ${biTA(isRu?'Текст RU':'Text RU','content',isRu?'Текст':'Text','content_en',b.content,b.content_en,5)}`;
    case 'callout': return `
      <div style="display:grid;grid-template-columns:1fr auto;gap:8px">
        <div class="sb-field"><label class="sb-fi-label">${isRu?'Тип':'Type'}</label>
          <select class="sb-fi" onchange="upBlock(${i},'variant',this.value)">
            <option value="info"${b.variant==='info'?' selected':''}>ℹ️ Info</option>
            <option value="lore"${b.variant==='lore'?' selected':''}>📖 Lore</option>
            <option value="warn"${b.variant==='warn'?' selected':''}>⚠️ Warning</option>
          </select>
        </div>
        <div class="sb-field"><label class="sb-fi-label">${isRu?'Иконка':'Icon'}</label><input class="sb-fi" value="${esc(b.icon||'ℹ️')}" maxlength="4" style="width:52px" oninput="upBlock(${i},'icon',this.value)"></div>
      </div>
      ${biRow(isRu?'Заголовок RU':'Title RU','title',isRu?'Заголовок':'Title','title_en',b.title,b.title_en)}
      ${biTA(isRu?'Текст RU':'Text RU','content',isRu?'Текст':'Text','content_en',b.content,b.content_en,3)}`;
    case 'quote': return `
      ${biTA(isRu?'Цитата RU':'Quote RU','text',isRu?'Цитата':'Quote','text_en',b.text,b.text_en,3)}
      ${biRow(isRu?'Автор RU':'Author RU','author',isRu?'Автор':'Author','author_en',b.author,b.author_en)}`;
    case 'frame': return `
      ${biRow(isRu?'Заголовок RU':'Title RU','label',isRu?'Заголовок':'Title','label_en',b.label,b.label_en)}
      ${biTA(isRu?'Текст RU':'Text RU','content',isRu?'Текст':'Text','content_en',b.content,b.content_en,4)}`;
    case 'divider': return `
      <div class="sb-field"><label class="sb-fi-label">${isRu?'Стиль':'Style'}</label>
        <select class="sb-fi" onchange="upBlock(${i},'style',this.value)">
          <option value="ornament"${b.style==='ornament'?' selected':''}>◈ ◈ ◈  ${isRu?'Орнамент':'Ornament'}</option>
          <option value="stars"${b.style==='stars'?' selected':''}>✦ ✦ ✦  ${isRu?'Звёзды':'Stars'}</option>
          <option value="line"${b.style==='line'?' selected':''}>─────  ${isRu?'Линия':'Line'}</option>
        </select>
      </div>`;
    case 'cols': return `
      <div class="sb-field"><label class="sb-fi-label">${isRu?'Число колонок':'Columns'}</label>
        <select class="sb-fi" onchange="upBlock(${i},'cols',+this.value);upBlock(${i},'items',Array.from({length:+this.value},(v,k)=>(editBlocks[${i}]?.items||[])[k]||''));refreshBlockPropsPanel()">
          <option value="2"${b.cols===2?' selected':''}>${isRu?'2 колонки':'2 columns'}</option>
          <option value="3"${b.cols===3?' selected':''}>${isRu?'3 колонки':'3 columns'}</option>
        </select>
      </div>
      ${(b.items||[]).map((item,k)=>`<div class="sb-field"><label class="sb-fi-label">${isRu?'Колонка':'Column'} ${k+1} RU (Markdown)</label><textarea class="sb-fi" rows="4" oninput="editBlocks[${i}].items[${k}]=this.value">${esc(item)}</textarea></div>`).join('')}`;
    case 'table': return `
      <div class="sb-field"><label class="sb-fi-label">CSV (${isRu?'первая строка = заголовки':'first row = headers'})</label>
        <textarea class="sb-fi" rows="6" style="font-family:'JetBrains Mono',monospace;font-size:11px" oninput="parseTableCSV(${i},this.value)">${tableToCSV(b)}</textarea>
        <div class="sb-hint">${isRu?'Пример':'Example'}: ${isRu?'Имя,Роль,Фракция':'Name,Role,Faction'}</div>
      </div>`;
    case 'gallery': return `
      <div class="sb-field"><label class="sb-fi-label">${isRu?'URL изображений (по одному)':'Image URLs (one per line)'}</label>
        <textarea class="sb-fi" id="gal-ta-${b.id}" rows="5" placeholder="https://example.com/img1.jpg" oninput="upBlock(${i},'images',this.value.split('\\n').filter(u=>u.trim()))">${esc((b.images||[]).join('\n'))}</textarea>
        <label class="sb-upload-btn" style="margin-top:6px;display:inline-flex">📁 ${isRu?'Добавить файл':'Add file'}<input type="file" accept="image/*" style="display:none" onchange="handleImgUpload(this.files[0],url=>{const ta=document.getElementById('gal-ta-${b.id}');ta.value=(ta.value.trim()?ta.value.trim()+'\\n':'')+url;upBlock(${i},'images',ta.value.split('\\n').filter(u=>u.trim()))})"></label>
      </div>`;
    case 'infobox': return ibEditor(b,i);
    case 'battle_map': return battleMapEditorHtml(b,i);
    case 'rel_graph': return relGraphEditorHtml(b,i);
    case 'vis_timeline': return visTimelineEditorHtml(b,i);
    case 'chart': return chartEditorHtml(b,i);
    default: return `<p style="color:var(--t3);font-size:12px">${lang==='ru'?`Редактор для «${b.type}» не реализован.`:`No editor for «${b.type}».`}</p>`;
  }
}

function unitClsToggle(bi, k) {
  var rows = editBlocks[bi]?.sections?.[0]?.rows || [];
  var ex = rows.find(function(r){ return r.key === 'Доступно для'; });
  var cur = ex ? (ex.val||'') : '';
  var arr = cur ? cur.split(',').map(function(s){ return s.trim(); }).filter(Boolean) : [];
  if (arr.includes(k)) { arr = arr.filter(function(c){ return c !== k; }); }
  else { arr.push(k); }
  ibSmartSet(bi, 'Доступно для', arr.join(','));
  renderBlockEditor();
}

function ibEditor(b,i){
  const pgType = editData?.page_type || 'article';

  // ── Smart form for ITEM pages ──────────────────────────────
  if (pgType === 'item') {
    // Read current values from block
    const rows = b.sections?.[0]?.rows || [];
    const val = k => rows.find(r=>r.key===k)?.val || '';
    const RARITY_OPTS = ['common','uncommon','rare','epic','legendary']
      .map(r=>`<option value="${r}"${val('Редкость')===r?' selected':''}>${{common:'Обычный',uncommon:'Необычный',rare:'Редкий',epic:'Эпический',legendary:'Легендарный'}[r]}</option>`).join('');
    const SLOT_OPTS = ['weapon','armor','hull','engine','reactor','radar','shield','module','artifact','consumable']
      .map(s=>`<option value="${s}"${val('Слот')===s?' selected':''}>${{weapon:'⚔ Оружие',armor:'🛡 Броня',hull:'⊕ Корпус',engine:'⚙ Двигатель',reactor:'⚛ Реактор',radar:'◎ Радар',shield:'◈ Щит',module:'🔧 Модуль',artifact:'◈ Артефакт',consumable:'⬡ Расходник'}[s]}</option>`).join('');
    const curSlot = val('Слот');
    // Доп. поля зависящие от слота
    const priceField = ['weapon','armor','hull','engine','reactor','radar','shield','module'].includes(curSlot) ? `
      <div class="fg"><label class="fl">💰 Цена (энергокредиты)</label>
        <input class="be-fi" type="number" step="1000" placeholder="0" value="${esc(val('Цена'))}"
          oninput="ibSmartSet(${i},'Цена',this.value)"></div>` : '';
    const energyField = ['weapon','engine','radar','shield','module'].includes(curSlot) ? `
      <div class="fg"><label class="fl">⚡ Потребление энергии (МВт)</label>
        <input class="be-fi" type="number" step="0.1" placeholder="0" value="${esc(val('Потребление энергии'))}"
          oninput="ibSmartSet(${i},'Потребление энергии',this.value)"></div>` : '';
    const capField = (curSlot === 'weapon' || curSlot === 'module') ? `
      <div class="fg"><label class="fl">📦 Штраф вместимости (ед.)</label>
        <input class="be-fi" type="number" step="0.5" placeholder="0" value="${esc(val('Штраф вместимости'))}"
          oninput="ibSmartSet(${i},'Штраф вместимости',this.value)"></div>` : '';
    const reactorCapField = curSlot === 'reactor' ? `
      <div class="fg"><label class="fl">📦 Бонус вместимости (ед.)</label>
        <input class="be-fi" type="number" step="1" placeholder="0" value="${esc(val('Бонус вместимости'))}"
          oninput="ibSmartSet(${i},'Бонус вместимости',this.value)"></div>
      <div class="fg"><label class="fl">⚙ Слотов двигателей</label>
        <input class="be-fi" type="number" min="1" max="8" placeholder="2" value="${esc(val('Слотов двигателей'))}"
          oninput="ibSmartSet(${i},'Слотов двигателей',this.value)"></div>
      <div class="fg"><label class="fl">◎ Слотов радаров</label>
        <input class="be-fi" type="number" min="1" max="4" placeholder="1" value="${esc(val('Слотов радаров'))}"
          oninput="ibSmartSet(${i},'Слотов радаров',this.value)"></div>
      <div class="fg"><label class="fl">◈ Слотов щитов</label>
        <input class="be-fi" type="number" min="0" max="4" placeholder="1" value="${esc(val('Слотов щитов'))}"
          oninput="ibSmartSet(${i},'Слотов щитов',this.value)"></div>
      <div class="fg"><label class="fl">🔧 Слотов модулей</label>
        <input class="be-fi" type="number" min="0" max="20" placeholder="3" value="${esc(val('Слотов модулей'))}"
          oninput="ibSmartSet(${i},'Слотов модулей',this.value)"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div class="fg"><label class="fl" title="Буст скорости 0-100%: умножает АсК × (1+буст/100)">🚀 Буст скорости (%)</label>
          <input class="be-fi" type="number" min="0" max="100" step="1" placeholder="0" value="${esc(val('Буст скорости'))}"
            oninput="ibSmartSet(${i},'Буст скорости',this.value)"></div>
        <div class="fg"><label class="fl" title="Буст радаров 0-100%: умножает дальность радаров">◎ Буст радаров (%)</label>
          <input class="be-fi" type="number" min="0" max="100" step="1" placeholder="0" value="${esc(val('Буст радаров'))}"
            oninput="ibSmartSet(${i},'Буст радаров',this.value)"></div>
        <div class="fg"><label class="fl" title="Буст щитов 0-100%: умножает защитное поле">◈ Буст щитов (%)</label>
          <input class="be-fi" type="number" min="0" max="100" step="1" placeholder="0" value="${esc(val('Буст щитов'))}"
            oninput="ibSmartSet(${i},'Буст щитов',this.value)"></div>
      </div>` : '';
    // Armor config panel — new Load Limit + Physical Materials system
    const isArmor  = val('Слот') === 'armor';
    const isWeapon = val('Слот') === 'weapon';
    const isTech   = ['engine','reactor','radar','shield','module','hull'].includes(val('Слот'));
    const canCalc  = user && ['superadmin','editor'].includes(user.role);

    // Build armor class options
    const acOpts = typeof ARMOR_CLASSES !== 'undefined'
      ? Object.entries(ARMOR_CLASSES).map(([k,v])=>`<option value="${k}"${val('Класс брони')===k?' selected':''}>${v.ru} (${v.rpLimit}оч)</option>`).join('')
      : '';

    const armorSection = (isArmor && canCalc) ? `
      <div style="margin-top:12px;border-top:1px solid rgba(28,100,148,.25);padding-top:12px">
        <div style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:2px;color:rgba(28,100,148,.8);margin-bottom:6px">◈ ФИЗИКА БРОНИ · Лимит нагрузки <span style="color:var(--t4);font-size:7px">(только редактор)</span></div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--t4);margin-bottom:10px;line-height:1.6">
          HP = Σ(ресурс × кг/ед × HP/кг) × Мультипликатор_материала<br>
          HP_на_юните = HP_брони ÷ (Габарит_юнита × 0.8)
        </div>

        <div class="fg" style="margin-bottom:8px"><label class="fl">🛡 Класс брони</label>
          <select class="be-fi" id="ac-ed-class-${i}" oninput="ibSmartSet(${i},'Класс брони',this.value);armorRpUpdate(${i},'density',document.getElementById('ac-ed-density-${i}')?.value||0,5);armorCalcPreview(${i})">${acOpts}</select>
        </div>

        <div style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:1.5px;color:var(--te);margin-bottom:6px">
          СВОЙСТВА МАТЕРИАЛА — РП-ОЧКИ
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">
          <div class="fg"><label class="fl" title="Высокая плотность → +12% HP на очко. Влияет на физическое пробитие. 1 шаг = 5 очков">Плотность</label>
            <input class="be-fi" type="number" min="0" step="1" value="${esc(Math.round((parseFloat(val('ОЧ Плотность'))||0)/5))}" oninput="armorRpUpdate(${i},'density',this.value,5)" id="ac-ed-density-${i}"></div>
          <div class="fg"><label class="fl" title="Прочность на разрыв → +18% HP на очко. Повышает рейтинг пробития. 1 шаг = 10 очков">Прочность</label>
            <input class="be-fi" type="number" min="0" step="1" value="${esc(Math.round((parseFloat(val('ОЧ Прочность'))||0)/10))}" oninput="armorRpUpdate(${i},'tensile',this.value,10)" id="ac-ed-tensile-${i}"></div>
          <div class="fg"><label class="fl" title="Термостойкость → +10% HP на очко. Улучшает защиту от лазера. 1 шаг = 20 очков">Термостойкость</label>
            <input class="be-fi" type="number" min="0" step="1" value="${esc(Math.round((parseFloat(val('ОЧ Термостойкость'))||0)/20))}" oninput="armorRpUpdate(${i},'thermal',this.value,20)" id="ac-ed-thermal-${i}"></div>
        </div>

        <div id="ac-ed-preview-${i}" style="background:var(--b3);border:1px solid rgba(28,100,148,.3);padding:10px 14px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--t2)">
          ← заполни очки для расчёта
        </div>
      </div>` : '';

    // ── Weapon section — fields for calculateWeaponStats ──────
    const TECH_OPTS = [
      ['conventional','Обычное (кинетика)'],['laser','Лазерное'],['plasma','Плазменное'],
      ['railgun','Рельсотрон'],['explosive','Взрывное'],['energy','Энергетическое'],
      ['sonic','Звуковое'],['nano','Нанотехнологическое'],['gauss','Гаусс-пушка'],
    ].map(([k,l])=>`<option value="${k}"${val('Тип технологии')===k?' selected':''}>${l}</option>`).join('');

    const DTYPE_OPTS = [
      ['kinetic','Кинетический'],['piercing','Бронебойный'],['explosive','Взрывной'],
      ['incendiary','Зажигательный'],['thermal','Термический'],['laser','Лазерный'],
      ['plasma','Плазменный'],['energy','Энергетический'],['emp','ЭМИ'],
      ['chemical','Химический'],['sonic','Звуковой'],
    ].map(([k,l])=>`<option value="${k}"${val('Тип урона')===k?' selected':''}>${l}</option>`).join('');

    const WCLASS_OPTS = [
      ['pistol','Пистолет'],['smg','Пистолет-пулемёт'],['shotgun','Дробовик'],
      ['carbine','Карабин'],['rifle','Штурмовая винтовка'],['sniper','Снайперская винтовка'],
      ['machinegun','Пулемёт'],['grenade_launcher','Гранатомёт'],['rocket_launcher','Ракетный пусковой'],
      ['cannon','Орудие (пушка)'],['autocannon','Автоматическая пушка'],['howitzer','Гаубица'],
      ['mortar','Миномёт'],['flamethrower','Огнемёт'],['torpedo','Торпеда'],
      ['missile','Ракета'],['cruise_missile','Крылатая ракета'],['railgun_weapon','Рельсотронная установка'],
      ['main_battery','Главный калибр'],['anti_air','Зенитный комплекс'],
    ].map(([k,l])=>`<option value="${k}"${val('Класс оружия')===k?' selected':''}>${l}</option>`).join('');

    const weaponSection = (isWeapon && canCalc) ? `
      <div style="margin-top:12px;border-top:1px solid rgba(240,112,112,.25);padding-top:12px">
        <div style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:2px;color:rgba(240,112,112,.8);margin-bottom:6px">⚔ БАЛЛИСТИКА · Формула урона <span style="color:var(--t4);font-size:7px">(только редактор)</span></div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--t4);margin-bottom:10px;line-height:1.6">
          Урон = Калибр × √Вес × tCoef × cCoef × (1+dCoef) × rateMod / 50
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
          <div class="fg"><label class="fl" title="Калибр снаряда в миллиметрах">Калибр (мм)</label>
            <input class="be-fi" type="number" min="0" step="0.1" placeholder="напр. 7.62"
              value="${esc(val('Калибр'))}"
              oninput="ibSmartSet(${i},'Калибр',this.value);weaponCalcPreview(${i})"></div>
          <div class="fg"><label class="fl" title="Вес оружия в кг — влияет как √Вес">Вес (кг)</label>
            <input class="be-fi" type="number" min="0" step="0.1" placeholder="напр. 3.8"
              value="${esc(val('Вес'))}"
              oninput="ibSmartSet(${i},'Вес',this.value);weaponCalcPreview(${i})"></div>
          <div class="fg"><label class="fl" title="Темп стрельбы в выстрелах/мин">Темп (выст/мин)</label>
            <input class="be-fi" type="number" min="0" step="1" placeholder="напр. 600"
              value="${esc(val('Темп стрельбы'))}"
              oninput="ibSmartSet(${i},'Темп стрельбы',this.value);weaponCalcPreview(${i})"></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <div class="fg"><label class="fl">Тип технологии</label>
            <select class="be-fi" oninput="ibSmartSet(${i},'Тип технологии',this.value);weaponCalcPreview(${i})">${TECH_OPTS}</select></div>
          <div class="fg"><label class="fl">Тип урона</label>
            <select class="be-fi" oninput="ibSmartSet(${i},'Тип урона',this.value);weaponCalcPreview(${i})">${DTYPE_OPTS}</select></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <div class="fg"><label class="fl">Класс оружия</label>
            <select class="be-fi" oninput="ibSmartSet(${i},'Класс оружия',this.value);weaponCalcPreview(${i})">${WCLASS_OPTS}</select></div>
        </div>

        <div id="wc-ed-preview-${i}" style="background:var(--b3);border:1px solid rgba(240,112,112,.3);padding:10px 14px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--t2)">
          ← заполни параметры для расчёта
        </div>
      </div>` : '';


    // Доступно для классов — чекбоксы
    const _curCls = val('Доступно для') || '';
    const _clsArr = _curCls ? _curCls.split(',').map(s=>s.trim()).filter(Boolean) : [];
    const _ALL_CLS2 = [['peh','Пехота'],['btr','БТР'],['tanki','Танк'],['arta','Артиллерия'],['aviacia','Авиация'],['vertihui','Вертолёт'],['dron','Дрон'],['dronkos','БПЛА'],['mla','Звездолёт'],['corvette','Корвет'],['destroyer','Эсминец'],['supportCarrier','Авианосец'],['mediumCruiser','Ср.крейсер'],['hyperCruiser','Гиперкрейсер'],['multiroleCarrier','МЦ авианосец'],['battleship','Линкор'],['dreadnought','Дредноут'],['ss13','СС-13']];
    const _clsHtml = '<div style="margin-top:10px;border-top:1px solid var(--w2);padding-top:10px">'
      + '<div style="font-family:\'JetBrains Mono\',monospace;font-size:8px;letter-spacing:1.5px;color:var(--t4);margin-bottom:8px">🎯 ДОСТУПНО ДЛЯ КЛАССОВ <span style=\'color:var(--t4)\'>(пусто = для всех)</span></div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:5px">'
      + _ALL_CLS2.map(function(pair){
          var k=pair[0], l=pair[1], chk=_clsArr.includes(k);
          return '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;padding:3px 7px;'
            + 'background:'+(chk?'rgba(0,229,255,.18)':'var(--b3)')
            + ';border:1px solid '+(chk?'rgba(0,229,255,.5)':'var(--w2)')+';">'
            + '<input type="checkbox" '+(chk?'checked ':'')
            + 'style="margin:0;cursor:pointer" '
            + 'onchange="unitClsToggle('+i+',\''+k+'\')"> '+l+'</label>';
        }).join('')
      + '</div></div>';
    return `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:2px;color:var(--te);margin-bottom:4px">◈ ПАРАМЕТРЫ СНАРЯЖЕНИЯ</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="fg"><label class="fl">Редкость</label>
          <select class="be-fi" onchange="ibSmartSet(${i},'Редкость',this.value)">${RARITY_OPTS}</select></div>
        <div class="fg"><label class="fl">Слот</label>
          <select class="be-fi" onchange="ibSmartSet(${i},'Слот',this.value);renderBlockEditor()">${SLOT_OPTS}</select></div>
        ${curSlot === 'reactor' ? `
        <div style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--t4);padding:4px 0 8px;line-height:1.7;border-bottom:1px solid var(--w2);margin-bottom:8px">
          РЕАКТОР ИМЕЕТ ДВА РАЗНЫХ ПАРАМЕТРА:<br>
          ⚡ <b>Мощность</b> — МВт энергии (энергобюджет для модулей)<br>
          ✦ <b>Сила реактора</b> — множитель скорости (параметр force из говнокода)<br>
          Пример из говнокода — Аквитания: Мощность=3700, Сила=200
        </div>
        <div class="fg"><label class="fl">⚡ Мощность (МВт) — энергобюджет</label>
          <input class="be-fi" type="number" step="1" placeholder="напр. 3700" value="${esc(val('Мощность'))}"
            oninput="ibSmartSet(${i},'Мощность',this.value);renderBlockEditor()"></div>
        <div class="fg"><label class="fl">✦ Сила реактора — множитель скорости</label>
          <input class="be-fi" type="number" step="1" placeholder="напр. 200" value="${esc(val('Сила реактора'))}"
            oninput="ibSmartSet(${i},'Сила реактора',this.value)"></div>
        ` : curSlot === 'hull' ? `
        <div class="fg"><label class="fl">⚔ Слотов орудий</label>
          <input class="be-fi" type="number" min="1" max="20" placeholder="3" value="${esc(val('Слотов орудий'))}"
            oninput="ibSmartSet(${i},'Слотов орудий',this.value)"></div>
        <div class="fg"><label class="fl">🛡 Слотов брони</label>
          <input class="be-fi" type="number" min="1" max="8" placeholder="4" value="${esc(val('Слотов брони'))}"
            oninput="ibSmartSet(${i},'Слотов брони',this.value)"></div>
        <div class="fg"><label class="fl">Габарит</label>
          <input class="be-fi" type="number" step="0.1" placeholder="9" value="${esc(val('Габарит'))}"
            oninput="ibSmartSet(${i},'Габарит',this.value)"></div>
        <div class="fg"><label class="fl">Масса (кг)</label>
          <input class="be-fi" type="number" placeholder="46500" value="${esc(val('Масса'))}"
            oninput="ibSmartSet(${i},'Масса',this.value)"></div>
        <div class="fg"><label class="fl" title="Прибавляется к дальности всех орудий юнита">🎯 Дальность стрельбы корпуса (АсК)</label>
          <input class="be-fi" type="number" step="0.5" placeholder="0" value="${esc(val('Дальность'))}"
            oninput="ibSmartSet(${i},'Дальность',this.value)"></div>
        ` : curSlot === 'engine' ? `
        <div style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--t4);padding:4px 0 8px;line-height:1.6;border-bottom:1px solid var(--w2);margin-bottom:8px">
          ✦ <b>Сила тяги</b> = параметр <code>force</code> из говнокода (modules3)<br>
          Пример: Гелиос → 598000. Скорость = (Тяга × Сила реактора) / Масса × 10 / коэф
        </div>
        <div class="fg"><label class="fl">✦ Сила тяги (force)</label>
          <input class="be-fi" type="number" step="1" placeholder="напр. 598000" value="${esc(val('Сила тяги'))}"
            oninput="ibSmartSet(${i},'Сила тяги',this.value)"></div>
        <div class="fg"><label class="fl">🎯 Класс юнита</label>
          <select class="be-fi" onchange="ibSmartSet(${i},'Класс юнита',this.value)">
            ${['peh','btr','tanki','arta','aviacia','vertihui','dron','dronkos','mla','corvette','destroyer','battleship','dreadnought'].map(c=>`<option value="${c}"${val('Класс юнита')===c?' selected':''}>${{peh:'Пехота',btr:'БТР',tanki:'Танк',arta:'Артиллерия',aviacia:'Авиация',vertihui:'Вертолёт',dron:'Дрон',dronkos:'БПЛА',mla:'Звездолёт',corvette:'Корвет',destroyer:'Эсминец',battleship:'Линкор',dreadnought:'Дредноут'}[c]||c}</option>`).join('')}
          </select></div>
        ` : curSlot === 'radar' ? `
        <div class="fg"><label class="fl">◎ Дальность обнаружения (АсК)</label>
          <input class="be-fi" type="number" step="0.5" placeholder="напр. 5" value="${esc(val('Дальность обнаружения'))}"
            oninput="ibSmartSet(${i},'Дальность обнаружения',this.value)"></div>
        <div class="fg"><label class="fl">Диапазон</label>
          <select class="be-fi" onchange="ibSmartSet(${i},'Диапазон',this.value)">
            ${[['l','L (450 км)'],['s','S (200 км)'],['c','C (50 км)'],['x','X (20 км)'],['ka','Ka (10 км)']].map(([k,l])=>`<option value="${k}"${val('Диапазон')===k?' selected':''}>${l}</option>`).join('')}
          </select></div>
        ` : curSlot === 'shield' ? `
        <div class="fg"><label class="fl">◈ Защитное поле (ед.)</label>
          <input class="be-fi" type="number" step="1" placeholder="напр. 100" value="${esc(val('Защитное поле'))}"
            oninput="ibSmartSet(${i},'Защитное поле',this.value)"></div>
        ` : curSlot === 'module' ? `
        <div class="fg"><label class="fl">Категория модуля</label>
          <input class="be-fi" placeholder="напр. ИИ, РЭБ, связь..." value="${esc(val('Категория'))}"
            oninput="ibSmartSet(${i},'Категория',this.value)"></div>
        <div class="fg"><label class="fl">Эффект</label>
          <input class="be-fi" placeholder="что даёт модуль..." value="${esc(val('Эффект'))}"
            oninput="ibSmartSet(${i},'Эффект',this.value)"></div>
        ` : (!isWeapon && !isTech) ? `
        <div class="fg"><label class="fl">Урон</label>
          <input class="be-fi" placeholder="напр. 24" value="${esc(val('Урон'))}" oninput="ibSmartSet(${i},'Урон',this.value)"></div>
        <div class="fg"><label class="fl">Защита</label>
          <input class="be-fi" placeholder="напр. 5" value="${esc(val('Защита'))}" oninput="ibSmartSet(${i},'Защита',this.value)"></div>
        <div class="fg"><label class="fl">Требования (уровень)</label>
          <input class="be-fi" placeholder="напр. 10" value="${esc(val('Требования'))}" oninput="ibSmartSet(${i},'Требования',this.value)"></div>
        <div class="fg"><label class="fl">Иммунитеты</label>
          <input class="be-fi" placeholder="огонь, яд" value="${esc(val('Иммунитеты'))}" oninput="ibSmartSet(${i},'Иммунитеты',this.value)"></div>
        ` : ''}
      </div>
      ${['reactor','engine','radar','shield'].includes(curSlot) ? `
      <div class="fg"><label class="fl">Описание</label>
        <textarea class="be-fi" rows="2" style="resize:vertical" placeholder="Лорное описание..."
          oninput="ibSmartSet(${i},'Описание',this.value)">${esc(val('Описание'))}</textarea></div>
      ` : (!isWeapon && !isTech) ? `
      <div class="fg"><label class="fl">Эффект</label>
        <input class="be-fi" placeholder="Особый эффект предмета..." value="${esc(val('Эффект'))}" oninput="ibSmartSet(${i},'Эффект',this.value)"></div>
      <div class="fg"><label class="fl">Описание</label>
        <textarea class="be-fi" rows="2" style="resize:vertical" placeholder="Лорное описание..." oninput="ibSmartSet(${i},'Описание',this.value)">${esc(val('Описание'))}</textarea></div>
      ` : ''}
      ${armorSection}
      ${weaponSection}
      ${priceField}
      ${energyField}
      ${capField}
      ${reactorCapField}
      ${_clsHtml}
    </div>`;
  }

  // ── Smart form for ABILITY pages ──────────────────────────
  if (pgType === 'ability') {
    const rows = b.sections?.[0]?.rows || [];
    const val = k => rows.find(r=>r.key===k)?.val || '';
    const TYPE_OPTS = ['passive','action','bonus','reaction','1/day','1/rest']
      .map(t=>`<option value="${t}"${val('Тип')===t?' selected':''}>${{passive:'Пассивная',action:'Действие',bonus:'Бонусное',reaction:'Реакция','1/day':'1 раз/день','1/rest':'1 раз/отдых'}[t]}</option>`).join('');
    return `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:2px;color:var(--te);margin-bottom:4px">◈ ПАРАМЕТРЫ СПОСОБНОСТИ</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="fg"><label class="fl">Тип</label>
          <select class="be-fi" onchange="ibSmartSet(${i},'Тип',this.value)">${TYPE_OPTS}</select></div>
        <div class="fg"><label class="fl">Дальность</label>
          <input class="be-fi" placeholder="напр. 30 фт." value="${esc(val('Дальность'))}" oninput="ibSmartSet(${i},'Дальность',this.value)"></div>
        <div class="fg"><label class="fl">Стоимость активации</label>
          <input class="be-fi" placeholder="напр. 2 AP" value="${esc(val('Стоимость'))}" oninput="ibSmartSet(${i},'Стоимость',this.value)"></div>
        <div class="fg"><label class="fl">Триггер (для реакций)</label>
          <input class="be-fi" placeholder="напр. получение урона" value="${esc(val('Триггер'))}" oninput="ibSmartSet(${i},'Триггер',this.value)"></div>
        <div class="fg"><label class="fl">Бонус КЗ</label>
          <input class="be-fi" placeholder="напр. +2" value="${esc(val('Бонус КЗ'))}" oninput="ibSmartSet(${i},'Бонус КЗ',this.value)"></div>
        <div class="fg"><label class="fl">Бонус СИЛ</label>
          <input class="be-fi" placeholder="напр. +1" value="${esc(val('Бонус СИЛ'))}" oninput="ibSmartSet(${i},'Бонус СИЛ',this.value)"></div>
        <div class="fg"><label class="fl">Бонус ЛОВ</label>
          <input class="be-fi" placeholder="напр. +1" value="${esc(val('Бонус ЛОВ'))}" oninput="ibSmartSet(${i},'Бонус ЛОВ',this.value)"></div>
        <div class="fg"><label class="fl">Иммунитеты</label>
          <input class="be-fi" placeholder="напр. страх, паника" value="${esc(val('Иммунитеты'))}" oninput="ibSmartSet(${i},'Иммунитеты',this.value)"></div>
      </div>
      <div class="fg"><label class="fl">Эффект <span style="color:var(--t4);font-size:10px">(главный текст)</span></label>
        <textarea class="be-fi" rows="2" style="resize:vertical" placeholder="Что делает способность..." oninput="ibSmartSet(${i},'Эффект',this.value)">${esc(val('Эффект'))}</textarea></div>
      <div class="fg"><label class="fl">Описание <span style="color:var(--t4);font-size:10px">(лор)</span></label>
        <textarea class="be-fi" rows="2" style="resize:vertical" placeholder="Лорное описание..." oninput="ibSmartSet(${i},'Описание',this.value)">${esc(val('Описание'))}</textarea></div>
    </div>`;
  }

  // ── Smart form for UNIT pages ────────────────────────────────────
  if (pgType === 'unit') {
    const rows = b.sections?.[0]?.rows || [];
    const val  = k => rows.find(r=>r.key===k)?.val || '';

    const bySlot = slot => (typeof pages !== 'undefined' ? pages : [])
      .filter(p => {
        if (p.page_type !== 'item') return false;
        if ((p.infobox?.['Слот']||p.infobox?.['слот']||'') !== slot) return false;
        // Фильтр по классу юнита
        const avail = p.infobox?.['Доступно для']||'';
        if (!avail) return true; // пусто = для всех
        const cls = val('Класс').toLowerCase();
        return avail.split(',').map(s=>s.trim().toLowerCase()).includes(cls);
      })
      .map(p => p.title||p.name||'');

    const getIb = name => {
      if (!name) return {};
      const p = (typeof pages !== 'undefined' ? pages : []).find(p=>(p.title||p.name||'')===name);
      return p?.infobox || {};
    };
    const ibN = (name,...keys) => { const ib=getIb(name); for(const k of keys){const v=parseFloat(ib[k]||ib[k.toLowerCase()]||0);if(v)return v;} return 0; };

    const reactorName = val('Реактор');
    const hullName    = val('Корпус');
    const unitClass   = val('Класс').toLowerCase();
    const unitMass    = parseFloat(val('Масса')||100);

    // Лимиты из реактора
    const reactorPower   = ibN(reactorName,'Мощность','power');
    const reactorForce   = ibN(reactorName,'Сила реактора','force');
    const reactorCapBonus= ibN(reactorName,'Бонус вместимости','capacityBoost');
    const maxEngines     = Math.max(1, ibN(reactorName,'Слотов двигателей','dviglo')||1);
    const maxRadars      = Math.max(1, ibN(reactorName,'Слотов радаров','radar')||1);
    const maxShields     = Math.max(1, ibN(reactorName,'Слотов щитов','svaz')||1);
    const maxModulesMax  = Math.max(0, ibN(reactorName,'Слотов модулей','modul')||0);

    // Лимиты из корпуса
    const CLASS_ORUGIE = {peh:2,btr:2,tanki:3,arta:2,aviacia:5,vertihui:6,dron:3,dronkos:3,
      mla:5,corvette:1,destroyer:1,supportcarrier:1,mediumcruiser:1,hypercruiser:1,
      multirolecarrier:1,battleship:1,dreadnought:1,ss13:1};
    const hullOrugie  = ibN(hullName,'Слотов орудий','orugie');
    const maxWeapons  = hullOrugie || CLASS_ORUGIE[unitClass] || 2;
    const maxArmors   = Math.max(1, ibN(hullName,'Слотов брони','armor_slots')||4);

    // Базовая вместимость
    const baseCapacity = Math.round(unitMass * 0.7) + reactorCapBonus;

    // Считаем использованные ресурсы
    let usedPower = 0, usedCapacity = 0;
    const allSlotNames = (base, max) => Array.from({length:max},(_,n)=>val(base+' '+(n+1))).filter(Boolean);

    // Динамические слоты орудий (могут быть добавлены сверх базового)
    let weapCount = maxWeapons;
    for (let n=maxWeapons+1; n<=maxWeapons+10; n++) { if(val('Орудие '+n)) weapCount=n; else break; }
    let modCount = 0;
    for (let n=1; n<=maxModulesMax+10; n++) { if(val('Модуль '+n)) modCount=Math.max(modCount,n); }

    const engNames    = allSlotNames('Двигатель', maxEngines);
    const weapNames   = allSlotNames('Орудие',    weapCount);
    const armorNames  = allSlotNames('Броня',     maxArmors);
    const radarNames  = allSlotNames('Радар',     maxRadars);
    const shieldNames = allSlotNames('Щит',       maxShields);
    const modNames    = allSlotNames('Модуль',    modCount);

    const calcUsage = names => names.forEach(n=>{
      usedPower    += ibN(n,'Потребление энергии','power');
      usedCapacity += ibN(n,'Штраф вместимости','capacityPenalty');
    });
    calcUsage(engNames); calcUsage(weapNames); calcUsage(radarNames);
    calcUsage(shieldNames); calcUsage(modNames);

    const freePower    = reactorPower - usedPower;
    const freeCapacity = baseCapacity - usedCapacity;
    const overPower    = freePower < 0;
    const overCap      = freeCapacity < 0;
    const powerPct  = reactorPower>0 ? Math.min(100,Math.round(usedPower/reactorPower*100)) : 0;
    const capPct    = baseCapacity>0 ? Math.min(100,Math.round(usedCapacity/baseCapacity*100)) : 0;
    const PC = v => v<0?'#f44336':v<(reactorPower||1)*0.05?'#ff9800':'#4caf50';
    const CC = v => v<0?'#f44336':v<baseCapacity*0.05?'#ff9800':'#4caf50';
    const pc = PC(freePower), cc = CC(freeCapacity);

    // Блок запрета сохранения
    const blockSave = overPower || overCap;

    // Скорость для каждого движка
    const SMALL_FORMAT=['peh','btr','tanki','arta','aviacia','vertihui','dron'];
    const SPEED_ENV = {peh:5,btr:8,tanki:8,arta:8,aviacia:140,vertihui:50,dron:8,dronkos:1000,
      mla:1000,corvette:1000,destroyer:1000,supportcarrier:1000,mediumcruiser:1000,
      hypercruiser:1000,multirolecarrier:1000,battleship:1000,dreadnought:1000,ss13:1};
    const envK = SPEED_ENV[unitClass]||1;

    const fmtPrice = p => p>=1e9?(p/1e9).toFixed(1)+' млрд ЭК':p>=1e6?(p/1e6).toFixed(1)+' млн ЭК':p>=1e3?Math.round(p/1e3)+' тыс ЭК':p+' ЭК';

    // Хелпер строки с datalist + тултип + кнопка удаления
    const slotRow = (key, opts, placeholder, hint, canDelete) => {
      const dlId = 'dlu_'+key.replace(/\s/g,'_')+'_'+i;
      const dlopts = opts.map(o=>'<option value="'+o.replace(/"/g,'&quot;')+'">').join('');
      const cur = val(key).replace(/"/g,'&quot;');
      return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">
        <input class="be-fi" style="flex:1;font-size:11px" list="${dlId}"
          placeholder="${placeholder}" value="${cur}"
          oninput="ibSmartSet(${i},'${key}',this.value);renderBlockEditor()">
        <datalist id="${dlId}">${dlopts}</datalist>
        ${hint?`<span style="font-family:'JetBrains Mono',monospace;font-size:9px;white-space:nowrap;color:${hint.c||'var(--t4)'}">${hint.t}</span>`:''}
        ${canDelete?`<button onclick="ibSmartSet(${i},'${key}','');renderBlockEditor()" style="background:none;border:1px solid #444;color:#666;width:20px;height:20px;line-height:18px;text-align:center;cursor:pointer;flex-shrink:0;font-size:10px" title="Очистить слот">✕</button>`:''}
      </div>`;
    };

    // Строим HTML для каждой группы
    // Двигатели
    let engHtml='';
    for(let n=0;n<maxEngines;n++){
      const name=engNames[n]||'';
      const thrust=name?ibN(name,'Сила тяги'):0;
      const ep=name?ibN(name,'Потребление энергии','power'):0;
      const _kmh2=(thrust>0&&reactorForce>0)?(thrust*reactorForce)/unitMass*10:0;
      const ask=_kmh2>0?Math.min(100,_kmh2/envK):0;
      const _sfmt=SMALL_FORMAT.indexOf(unitClass)>=0?(ask>0?'0,'+Math.round(ask):''):(Math.round(ask)>0?Math.round(ask)+'':'');
      engHtml+=slotRow('Двигатель '+(n+1),bySlot('engine'),'Двигатель '+(n+1)+'...',
        name?{t:(ask?ask+' АсК  ':'')+'-'+ep+' МВт',c:'#4caf50'}:null, name?true:false);
    }

    // Броня
    let armorHtml='';
    for(let n=0;n<maxArmors;n++){
      const name=armorNames[n]||'';
      armorHtml+=slotRow('Броня '+(n+1),bySlot('armor'),'Броня '+(n+1)+'...',null,name?true:false);
    }

    // Орудия — с кнопкой добавить
    let weapHtml='';
    for(let n=0;n<weapCount;n++){
      const name=weapNames[n]||'';
      const ep=name?ibN(name,'Потребление энергии','power'):0;
      const cp=name?ibN(name,'Штраф вместимости','capacityPenalty'):0;
      weapHtml+=slotRow('Орудие '+(n+1),bySlot('weapon'),'Орудие '+(n+1)+'...',
        name?{t:(ep?'-'+ep+' МВт  ':'')+( cp?'-'+cp+' вмст':''),c:'#f07070'}:null,true);
    }
    // Кнопка добавить орудие
    weapHtml+=`<button class="btn btn-gh btn-sm" style="font-size:10px;margin-top:4px"
      onclick="ibSmartSet(${i},'Орудие '+(${weapCount+1}),' ');renderBlockEditor()">+ Орудие</button>`;

    // Радары
    let radarHtml='';
    for(let n=0;n<maxRadars;n++){
      const name=radarNames[n]||'';
      const ep=name?ibN(name,'Потребление энергии'):0;
      radarHtml+=slotRow('Радар '+(n+1),bySlot('radar'),'Радар '+(n+1)+'...',
        name&&ep?{t:'-'+ep+' МВт'}:null,name?true:false);
    }

    // Щиты
    let shieldHtml='';
    for(let n=0;n<maxShields;n++){
      const name=shieldNames[n]||'';
      const ep=name?ibN(name,'Потребление энергии'):0;
      shieldHtml+=slotRow('Щит '+(n+1),bySlot('shield'),'Щит '+(n+1)+'...',
        name&&ep?{t:'-'+ep+' МВт'}:null,name?true:false);
    }

    // Модули — с кнопкой добавить
    let modHtml='';
    if(maxModulesMax>0||modNames.length>0){
      for(let n=0;n<Math.max(modCount,modNames.length);n++){
        const name=modNames[n]||'';
        const ep=name?ibN(name,'Потребление энергии','power'):0;
        const cp=name?ibN(name,'Штраф вместимости','capacity'):0;
        modHtml+=slotRow('Модуль '+(n+1),bySlot('module'),'Модуль '+(n+1)+'...',
          name?{t:(ep?'-'+ep+' МВт  ':'')+( cp?'-'+cp+' вмст':''),c:'#aaa'}:null,true);
      }
      if(modCount<maxModulesMax){
        modHtml+=`<button class="btn btn-gh btn-sm" style="font-size:10px;margin-top:4px"
          onclick="ibSmartSet(${i},'Модуль '+(${modCount+1}),' ');renderBlockEditor()">+ Модуль</button>`;
      } else if(maxModulesMax>0){
        modHtml+=`<div style="font-size:9px;color:var(--t4);margin-top:4px">Лимит модулей: ${maxModulesMax} (из реактора)</div>`;
      }
    } else {
      modHtml='<div style="font-size:10px;color:var(--t4)">' + (!reactorName ? 'Выберите реактор' : 'Реактор не поддерживает модули') + '</div>';
    }

    const CLASS_LABELS_ED = {peh:'Пехота',btr:'БТР',tanki:'Танк',arta:'Артиллерия',
      aviacia:'Авиация',vertihui:'Вертолёт',dron:'Дрон',dronkos:'БПЛА',mla:'Звездолёт',
      corvette:'Корвет',destroyer:'Эсминец',supportCarrier:'Авианосец (подд.)',
      mediumCruiser:'Средний крейсер',hyperCruiser:'Гиперкрейсер',
      multiroleCarrier:'Многоцелевой авианосец',battleship:'Линкор',dreadnought:'Дредноут',ss13:'СС-13'};
    const classOpts = Object.entries(CLASS_LABELS_ED).map(([k,v])=>
      `<option value="${k}"${val('Класс')===k?' selected':''}>${v}</option>`).join('');

    return `<div style="display:flex;flex-direction:column;gap:10px">
      <div style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:2px;color:var(--te)">⊕ КОНСТРУКТОР ЮНИТА</div>

      ${blockSave?`<div style="background:#f4433620;border:1px solid #f44336;padding:8px 12px;font-family:'JetBrains Mono',monospace;font-size:10px;color:#f44336">
        ⛔ СОХРАНЕНИЕ ЗАБЛОКИРОВАНО
        ${overPower?`<br>Превышен лимит энергии: использовано ${usedPower} МВт из ${reactorPower} МВт`:''}
        ${overCap  ?`<br>Превышена вместимость: использовано ${usedCapacity} из ${baseCapacity} ед.`:''}
      </div>`:''}

      <!-- Счётчики -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="background:var(--b2);border:1px solid ${pc}30;padding:8px 10px" data-tip="Энергия\n\nРеактор даёт: ${reactorPower} МВт\nИспользовано: ${usedPower} МВт\nСвободно: ${freePower} МВт\n\nДвигатели, орудия, радары и щиты тратят энергию.\nЕсли уходит в минус — сохранение невозможно.">
          <div style="font-family:'JetBrains Mono',monospace;font-size:7px;color:${pc};margin-bottom:3px">⚡ ЭНЕРГИЯ</div>
          <div style="font-size:14px;font-weight:bold;color:${pc}">${usedPower} / ${reactorPower} МВт</div>
          <div style="height:3px;background:var(--b3);margin-top:5px"><div style="height:3px;width:${powerPct}%;background:${pc};transition:.3s"></div></div>
          <div style="font-size:9px;color:var(--t4);margin-top:2px">свободно: <span style="color:${pc}">${freePower} МВт</span></div>
        </div>
        <div style="background:var(--b2);border:1px solid ${cc}30;padding:8px 10px" data-tip="Вместимость\n\nБазовая: масса ${unitMass} кг × 0.7 = ${Math.round(unitMass*0.7)} ед.${reactorCapBonus?`\nБонус реактора: +${reactorCapBonus} ед.`:''}\nИтого: ${baseCapacity} ед.\n\nИспользовано: ${usedCapacity} ед.\nСвободно: ${freeCapacity} ед.\n\nОрудия и модули занимают вместимость.\nЕсли уходит в минус — сохранение невозможно.">
          <div style="font-family:'JetBrains Mono',monospace;font-size:7px;color:${cc};margin-bottom:3px">📦 ВМЕСТИМОСТЬ</div>
          <div style="font-size:14px;font-weight:bold;color:${cc}">${usedCapacity} / ${baseCapacity} ед.</div>
          <div style="height:3px;background:var(--b3);margin-top:5px"><div style="height:3px;width:${capPct}%;background:${cc};transition:.3s"></div></div>
          <div style="font-size:9px;color:var(--t4);margin-top:2px">масса×0.7${reactorCapBonus?'+'+reactorCapBonus:''} | свободно: <span style="color:${cc}">${freeCapacity}</span></div>
        </div>
      </div>

      <!-- Корпус -->
      <div style="border:1px solid rgba(28,100,148,.25);padding:10px 12px;background:var(--b3)">
        <div style="font-family:'JetBrains Mono',monospace;font-size:7px;letter-spacing:1.5px;color:rgba(28,100,148,.8);margin-bottom:8px" data-tip="Корпус\n\nЗадаёт класс юнита, массу и количество слотов орудий/брони.\nМасса влияет на скорость и вместимость.">КОРПУС ℹ</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <div class="fg"><label class="fl">Класс</label>
            <select class="be-fi" onchange="ibSmartSet(${i},'Класс',this.value);renderBlockEditor()">${classOpts}</select></div>
          <div class="fg"><label class="fl" data-tip="Масса в кг. Влияет на скорость (чем тяжелее — тем медленнее) и вместимость (масса × 0.7)">Масса (кг) ℹ</label>
            <input class="be-fi" type="number" placeholder="46500" value="${val('Масса')}"
              oninput="ibSmartSet(${i},'Масса',this.value);renderBlockEditor()"></div>
          <div class="fg"><label class="fl">Статус</label>
            <select class="be-fi" onchange="ibSmartSet(${i},'Статус',this.value)">
              <option value="активен"${val('Статус')==='активен'?' selected':''}>Активен</option>
              <option value="уничтожен"${val('Статус')==='уничтожен'?' selected':''}>Уничтожен</option>
              <option value="законсервирован"${val('Статус')==='законсервирован'?' selected':''}>Законсервирован</option>
            </select></div>
          <div class="fg"><label class="fl" data-tip="Размер юнита. Влияет на расчёт прочности брони.">Габарит ℹ</label>
            <input class="be-fi" type="number" step="0.1" placeholder="9" value="${val('Габарит')}"
              oninput="ibSmartSet(${i},'Габарит',this.value)"></div>
        </div>
        ${slotRow('Корпус',bySlot('hull'),'статья корпуса (опционально)...',
          hullName?{t:'⚔ '+maxWeapons+' ор.  🛡 '+maxArmors+' бр.',c:'rgba(28,100,148,.9)'}:{t:'орудий по классу: '+maxWeapons,c:'var(--t4)'},hullName?true:false)}
      </div>

      <!-- Реактор -->
      <div style="border:1px solid rgba(255,152,0,.25);padding:10px 12px;background:var(--b3)">
        <div style="font-family:'JetBrains Mono',monospace;font-size:7px;letter-spacing:1.5px;color:rgba(255,152,0,.8);margin-bottom:8px" data-tip="Реактор\n\nГлавный источник энергии юнита.\nОпределяет количество доступных слотов:\n• Двигатели (${maxEngines})\n• Радары (${maxRadars})\n• Щиты (${maxShields})\n• Модули (${maxModulesMax})">⚛ РЕАКТОР ℹ <span style="color:var(--t4);font-weight:normal;font-size:6px">задаёт слоты двиг/рад/щит/мод</span></div>
        ${slotRow('Реактор',bySlot('reactor'),'выбери реактор...',
          reactorName?{t:'⚡'+reactorPower+'МВт ⚙'+maxEngines+' ◎'+maxRadars+' ◈'+maxShields+' 🔧'+maxModulesMax,c:'#ff9800'}:null,reactorName?true:false)}
      </div>

      <!-- Двигатели -->
      <div style="border:1px solid rgba(76,175,80,.2);padding:10px 12px;background:var(--b3)">
        <div style="font-family:'JetBrains Mono',monospace;font-size:7px;letter-spacing:1.5px;color:rgba(76,175,80,.7);margin-bottom:8px" data-tip="Двигатели\n\nФормула скорости:\nАсК/ход = (Сила тяги × Сила реактора) / Масса × 10 / Коэф.среды\n\nКоэф. среды: пехота=5, танк=8, авиация=140, корабль=1000\nМакс. скорость: 100 АсК/ход\n\nКаждый двигатель тратит энергию.">⚙ ДВИГАТЕЛИ <span style="color:var(--t4)">${maxEngines} слот.</span> ℹ</div>
        ${engHtml||'<div style="font-size:10px;color:var(--t4)">'+(!reactorName?'Выберите реактор':'Нет слотов')+'</div>'}
      </div>

      <!-- Броня -->
      <div style="border:1px solid rgba(96,125,139,.25);padding:10px 12px;background:var(--b3)">
        <div style="font-family:'JetBrains Mono',monospace;font-size:7px;letter-spacing:1.5px;color:rgba(96,125,139,.7);margin-bottom:8px" data-tip="Броня\n\nНе тратит энергию и вместимость.\nHP = расчёт через систему физики брони (материал + класс брони).\nЧем выше масса и габарит юнита — тем больше HP даёт одна пластина.">🛡 БРОНЯ <span style="color:var(--t4)">${maxArmors} слот. — не тратит энергию</span> ℹ</div>
        ${armorHtml}
      </div>

      <!-- Орудия -->
      <div style="border:1px solid rgba(244,67,54,.2);padding:10px 12px;background:var(--b3)">
        <div style="font-family:'JetBrains Mono',monospace;font-size:7px;letter-spacing:1.5px;color:rgba(244,67,54,.7);margin-bottom:8px" data-tip="Орудия\n\nКоличество слотов задаётся классом корпуса.\nМожно добавить дополнительные орудия кнопкой + Орудие.\n\nКаждое орудие тратит:\n• Энергию (МВт)\n• Вместимость (ед.)\n\nУрон рассчитывается по формуле: Калибр × √Вес × коэф.технологии × коэф.класса / 50">⚔ ОРУДИЯ <span style="color:var(--t4)">${maxWeapons} слот. из корпуса</span> ℹ</div>
        ${freePower<=0&&!weapNames.length?'<div style="font-size:10px;color:#f44336;padding:4px">⚠ Нет свободной энергии</div>':''}
        ${weapHtml}
      </div>

      <!-- Радары -->
      <div style="border:1px solid rgba(0,229,255,.15);padding:10px 12px;background:var(--b3)">
        <div style="font-family:'JetBrains Mono',monospace;font-size:7px;letter-spacing:1.5px;color:rgba(0,229,255,.6);margin-bottom:8px" data-tip="Радары\n\nКоличество слотов задаётся реактором.\nДальность обнаружения суммируется со всех установленных радаров.\nКаждый радар тратит энергию.">◎ РАДАРЫ <span style="color:var(--t4)">${maxRadars} слот.</span> ℹ</div>
        ${radarHtml||'<div style="font-size:10px;color:var(--t4)">'+(!reactorName?'Выберите реактор':'Нет слотов')+'</div>'}
      </div>

      <!-- Щиты -->
      <div style="border:1px solid rgba(124,77,255,.2);padding:10px 12px;background:var(--b3)">
        <div style="font-family:'JetBrains Mono',monospace;font-size:7px;letter-spacing:1.5px;color:rgba(124,77,255,.6);margin-bottom:8px" data-tip="Щиты\n\nКоличество слотов задаётся реактором.\nЗащитное поле суммируется.\nКаждый щит тратит энергию.">◈ ЩИТЫ <span style="color:var(--t4)">${maxShields} слот.</span> ℹ</div>
        ${shieldHtml||'<div style="font-size:10px;color:var(--t4)">'+(!reactorName?'Выберите реактор':'Нет слотов')+'</div>'}
      </div>

      <!-- Модули -->
      <div style="border:1px solid rgba(255,255,255,.08);padding:10px 12px;background:var(--b3)">
        <div style="font-family:'JetBrains Mono',monospace;font-size:7px;letter-spacing:1.5px;color:var(--t3);margin-bottom:8px" data-tip="Модули\n\nДополнительное оборудование: ИИ, РЭБ, связь, буксиры и т.д.\nКоличество слотов задаётся реактором.\nМогут тратить энергию и/или вместимость.">🔧 МОДУЛИ <span style="color:var(--t4)">${maxModulesMax} слот. из реактора</span> ℹ</div>
        ${modHtml}
      </div>

      <!-- Описание -->
      <div class="fg"><label class="fl">Описание / лор</label>
        <textarea class="be-fi" rows="2" style="resize:vertical" placeholder="..."
          oninput="ibSmartSet(${i},'Описание',this.value)">${val('Описание')}</textarea></div>
    </div>`;
  }

    // ── Default: original complex editor for other page types ──
  const secs=b.sections||[];
  const PRESETS = {
    faction: [
      { label:'Государство',  rows:[{key:'Тип',val:''},{key:'Столица',val:''},{key:'Лидер',val:''},{key:'Основана',val:''},{key:'Идеология',val:''}] },
    ],
  };
  const presets = (PRESETS[pgType]||[]);
  const presetHtml = presets.length ? `<div style="margin-bottom:12px">
    <div style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:2px;color:var(--t4);margin-bottom:6px;text-transform:uppercase">◈ Быстрые пресеты</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${presets.map((p,pi)=>`<button class="btn btn-gh btn-sm" style="font-size:10px" onclick="ibApplyPreset(${i},'${pgType}',${pi})">${p.label}</button>`).join('')}
    </div>
  </div>` : '';
  const secHtml=secs.map((sec,si)=>{
    const rowHtml=(sec.rows||[]).map((row,ri)=>`<div class="ib-ed-row"><input class="be-fi" style="flex:1" placeholder="Ключ RU" value="${esc(row.key||'')}" oninput="ibSetRow(${i},${si},${ri},'key',this.value)"><input class="be-fi" style="flex:1" placeholder="Ключ EN" value="${esc(row.key_en||'')}" oninput="ibSetRow(${i},${si},${ri},'key_en',this.value)"><input class="be-fi" style="flex:2" placeholder="Значение RU" value="${esc(row.val||'')}" oninput="ibSetRow(${i},${si},${ri},'val',this.value)"><input class="be-fi" style="flex:2" placeholder="Значение EN" value="${esc(row.val_en||'')}" oninput="ibSetRow(${i},${si},${ri},'val_en',this.value)"><button class="bw-del" onclick="ibDelRow(${i},${si},${ri})">✖</button></div>`).join('');
    return `<div class="ib-ed-sec"><div class="ib-ed-sec-hdr"><input class="be-fi" style="flex:1" placeholder="Название секции RU" value="${esc(sec.name||'')}" oninput="ibSetSec(${i},${si},'name',this.value)"><input class="be-fi" style="flex:1" placeholder="Section name EN" value="${esc(sec.name_en||'')}" oninput="ibSetSec(${i},${si},'name_en',this.value)"><button class="bw-del" onclick="ibDelSec(${i},${si})">✖</button></div><div class="ib-ed-row-hdr"><span style="flex:1">Ключ RU</span><span style="flex:1">Ключ EN</span><span style="flex:2">Значение RU</span><span style="flex:2">Значение EN</span><span style="width:28px"></span></div>${rowHtml}<button class="add-blk" style="margin:4px 0;padding:6px" onclick="ibAddRow(${i},${si})">+ Строка</button></div>`;
  }).join('');
  return `${presetHtml}<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px"><div class="fg"><label class="fl">Метка RU</label><input class="be-fi" value="${esc(b.label||'')}" placeholder="напр. ПЕРСОНАЖ" oninput="upBlock(${i},'label',this.value)"></div><div class="fg"><label class="fl" style="color:var(--te)">Метка EN</label><input class="be-fi" value="${esc(b.label_en||'')}" oninput="upBlock(${i},'label_en',this.value)"></div><div class="fg"><label class="fl">Название RU</label><input class="be-fi" value="${esc(b.title||'')}" oninput="upBlock(${i},'title',this.value)"></div><div class="fg"><label class="fl" style="color:var(--te)">Название EN</label><input class="be-fi" value="${esc(b.title_en||'')}" oninput="upBlock(${i},'title_en',this.value)"></div><div class="fg"><label class="fl">Подзаголовок RU</label><input class="be-fi" value="${esc(b.subtitle||'')}" oninput="upBlock(${i},'subtitle',this.value)"></div><div class="fg"><label class="fl" style="color:var(--te)">Подзаголовок EN</label><input class="be-fi" value="${esc(b.subtitle_en||'')}" oninput="upBlock(${i},'subtitle_en',this.value)"></div></div><div class="fg"><label class="fl">URL изображения</label><div style="display:flex;gap:8px"><input class="be-fi" id="ib-img-${b.id}" value="${esc(b.image_url||'')}" placeholder="https://..." oninput="upBlock(${i},'image_url',this.value)" style="flex:1"><label class="btn btn-gh btn-sm" style="cursor:pointer;padding:8px 12px;font-size:10px">📁<input type="file" accept="image/*" style="display:none" onchange="handleImgUpload(this.files[0],url=>{document.getElementById('ib-img-${b.id}').value=url;upBlock(${i},'image_url',url)})"></label></div></div><div class="fg"><label class="fl">Подпись к фото</label><input class="be-fi" value="${esc(b.img_caption||'')}" oninput="upBlock(${i},'img_caption',this.value)"></div><div style="margin-top:8px;border-top:1px solid var(--w2);padding-top:12px"><div class="fl" style="margin-bottom:10px">Секции данных</div><div id="ib-secs-${b.id}">${secHtml}</div><button class="add-blk" onclick="ibAddSec(${i},'${b.id}')">+ Секция</button></div>`;
}

// Smart setter — writes key=val into infobox sections[0].rows, creating if needed
function ibSmartSet(bi, key, val) {
  if (!editBlocks[bi]) return;
  if (!editBlocks[bi].sections) editBlocks[bi].sections = [];
  if (!editBlocks[bi].sections[0]) editBlocks[bi].sections[0] = {name:'Параметры', name_en:'Parameters', rows:[]};
  const rows = editBlocks[bi].sections[0].rows;
  const existing = rows.find(r => r.key === key);
  if (existing) { existing.val = val; }
  else { rows.push({key, key_en:'', val, val_en:''}); }
}

// ── Armor RP Update — проверка лимита очков ──
function armorRpUpdate(bi, type, stepValue, cost) {
  // Получаем класс брони и его лимит
  const armorClass = document.getElementById(`ac-ed-class-${bi}`)?.value || 'infantry';
  const cls = (typeof ARMOR_CLASSES !== 'undefined' && ARMOR_CLASSES[armorClass]) || { rpLimit: 20 };
  const RP_MAX = cls.rpLimit || 20;
  
  // Получаем текущие значения в шагах
  const densityInput = document.getElementById(`ac-ed-density-${bi}`);
  const tensileInput = document.getElementById(`ac-ed-tensile-${bi}`);
  const thermalInput = document.getElementById(`ac-ed-thermal-${bi}`);
  
  let densitySteps = type === 'density' ? parseInt(stepValue) || 0 : parseInt(densityInput?.value) || 0;
  let tensileSteps = type === 'tensile' ? parseInt(stepValue) || 0 : parseInt(tensileInput?.value) || 0;
  let thermalSteps = type === 'thermal' ? parseInt(stepValue) || 0 : parseInt(thermalInput?.value) || 0;
  
  // Конвертируем шаги в очки (1 шаг = 5/10/20 очков)
  let densityPts = densitySteps * 5;
  let tensilePts = tensileSteps * 10;
  let thermalPts = thermalSteps * 20;
  
  // Считаем потраченные очки
  let totalPoints = densityPts + tensilePts + thermalPts;
  
  // Если превышен лимит - откатываем изменение
  if (totalPoints > RP_MAX) {
    if (type === 'density') {
      const availablePoints = RP_MAX - tensilePts - thermalPts;
      densitySteps = Math.max(0, Math.floor(availablePoints / 5));
      densityPts = densitySteps * 5;
      if (densityInput) densityInput.value = densitySteps;
    }
    if (type === 'tensile') {
      const availablePoints = RP_MAX - densityPts - thermalPts;
      tensileSteps = Math.max(0, Math.floor(availablePoints / 10));
      tensilePts = tensileSteps * 10;
      if (tensileInput) tensileInput.value = tensileSteps;
    }
    if (type === 'thermal') {
      const availablePoints = RP_MAX - densityPts - tensilePts;
      thermalSteps = Math.max(0, Math.floor(availablePoints / 20));
      thermalPts = thermalSteps * 20;
      if (thermalInput) thermalInput.value = thermalSteps;
    }
  }
  
  // Сохраняем в infobox (в очках, не в шагах!)
  ibSmartSet(bi, 'ОЧ Плотность', densityPts);
  ibSmartSet(bi, 'ОЧ Прочность', tensilePts);
  ibSmartSet(bi, 'ОЧ Термостойкость', thermalPts);
  
  // Обновляем превью
  armorCalcPreview(bi);
}

// ── Armor HP preview — new Load Limit / Physical Materials system ──
function armorCalcPreview(bi) {
  const el = document.getElementById('ac-ed-preview-' + bi);
  if (!el) return;

  const g = (sfx) => parseFloat(document.getElementById('ac-ed-' + sfx + '-' + bi)?.value) || 0;
  const armorClass  = document.getElementById('ac-ed-class-' + bi)?.value || 'infantry';
  // Конвертируем шаги в очки: 1 шаг = 5/10/20 очков
  const density_pts = g('density') * 5;
  const tensile_pts = g('tensile') * 10;
  const thermal_pts = g('thermal') * 20;

  // Run calc for default unit (gabrit 1) and preview gabrits
  const res1   = calcArmorFull({ armorClass, resources: {}, density_pts, tensile_pts, thermal_pts, unit_gabrit: 1 });
  const prev   = calcArmorForGabrits({ armorClass, resources: {}, density_pts, tensile_pts, thermal_pts });
  const cls    = res1.cls;
  // Вес от РП-очков: 1 очко = 1 кг (density_pts, tensile_pts, thermal_pts уже в очках)
  const rp_w = density_pts + tensile_pts + thermal_pts;

  // Save computed stats into infobox for use on character page
  ibSmartSet(bi, 'HP',             String(res1.hp_on_unit));
  ibSmartSet(bi, 'Пробитие мм',    String(res1.pen_mm));
  ibSmartSet(bi, 'Лазер рейтинг',  res1.laser_label);
  ibSmartSet(bi, 'Класс брони',    armorClass);

  // Weight bar
  const wPct      = Math.min(100, Math.round((res1.total_weight / res1.load_limit) * 100));
  const wColor    = res1.overload_pct > 0 ? '#cc4848' : wPct > 75 ? '#4e9ed8' : '#4ec96a';
  const wLabel    = res1.overload_pct > 0
    ? `⚠ ПЕРЕГРУЗ ${res1.overload_pct.toFixed(0)}% · штраф скорости: -${res1.speed_penalty}`
    : `✓ В пределах лимита (${wPct}%)`;

  const gabHtml = prev.map(p => {
    const clr = p.gabrit === 1 ? '#4ec96a' : 'var(--t2)';
    const fw  = p.gabrit === 1 ? '900' : '400';
    return `<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:2px">
      <span style="color:var(--t4)">${p.label} (×${p.gabrit})</span>
      <span style="color:${clr};font-weight:${fw}">${p.hp.toLocaleString('ru')} HP</span>
    </div>`;
  }).join('');

  const matPct = Math.round((res1.mat_mul - 1) * 100);
  const rpTotal = density_pts + tensile_pts + thermal_pts;
  const rpPct = Math.min(100, Math.round((rpTotal / cls.rpLimit) * 100));
  const rpColor = rpTotal >= cls.rpLimit ? 'var(--gdl)' : rpTotal > cls.rpLimit * 0.75 ? '#4e9ed8' : '#4ec96a';

  el.innerHTML = `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
  <div>
    <div style="font-size:7px;letter-spacing:2px;color:rgba(28,100,148,.5);font-family:Rajdhani,sans-serif;margin-bottom:4px">РП-ОЧКИ</div>
    <div style="font-size:11px;color:${rpColor};margin-bottom:4px">${rpTotal} / ${cls.rpLimit} оч</div>
    <div style="height:4px;background:var(--w2);border-radius:2px;margin-bottom:3px">
      <div style="height:100%;width:${rpPct}%;background:${rpColor};border-radius:2px;transition:width .3s"></div>
    </div>
    <div style="font-size:9px;color:${rpColor};line-height:1.4">${rpTotal >= cls.rpLimit ? '⚠ Лимит достигнут' : `✓ Доступно ${cls.rpLimit - rpTotal} оч`}</div>
  </div>
  <div>
    <div style="font-size:7px;letter-spacing:2px;color:rgba(28,100,148,.5);font-family:Rajdhani,sans-serif;margin-bottom:4px">МНОЖИТЕЛЬ МАТЕРИАЛА</div>
    <div style="font-size:18px;font-weight:900;font-family:Rajdhani,sans-serif;color:var(--t1)">×${res1.mat_mul.toFixed(2)}</div>
    ${matPct > 0 ? `<div style="font-size:9px;color:rgba(28,100,148,.7)">+${matPct}% от РП-очков</div>` : ''}
  </div>
</div>
<div style="border-top:1px solid var(--w2);margin:8px 0 6px"></div>
<div style="font-size:7px;letter-spacing:2px;color:rgba(28,100,148,.5);font-family:Rajdhani,sans-serif;margin-bottom:6px">HP НА ЮНИТЕ (по габариту)</div>
<div style="font-size:10px;line-height:1.8">${gabHtml}</div>
<div style="border-top:1px solid var(--w2);margin:8px 0 6px"></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
  <div>
    <div style="font-size:7px;letter-spacing:2px;color:rgba(28,100,148,.5);font-family:Rajdhani,sans-serif;margin-bottom:3px">ПРОБИТИЕ (рейтинг)</div>
    <div style="font-size:11px;color:#4e9ed8;font-weight:700">${fmtPen(res1.pen_mm)}</div>
  </div>
  <div>
    <div style="font-size:7px;letter-spacing:2px;color:rgba(28,100,148,.5);font-family:Rajdhani,sans-serif;margin-bottom:3px">ЛАЗЕР (абляция)</div>
    <div style="font-size:11px;font-weight:700;color:${res1.laser_color}">${res1.laser_label}</div>
  </div>
</div>
<div style="margin-top:6px;font-size:8px;color:rgba(80,200,120,.5);font-family:'JetBrains Mono',monospace">
  ✓ HP, Пробитие мм, Лазер рейтинг — сохранены в поля предмета
</div>`;}

// ── weaponCalcPreview — живой пересчёт урона и дальности ──────
function weaponCalcPreview(bi) {
  const el = document.getElementById('wc-ed-preview-' + bi);
  if (!el) return;
  if (typeof calculateWeaponStats !== 'function') {
    el.innerHTML = '<span style="color:var(--t4)">weapon_system.js не загружен</span>';
    return;
  }

  // Читаем поля из infobox
  const rows = editBlocks[bi]?.sections?.[0]?.rows || [];
  const v = k => rows.find(r => r.key === k)?.val || '';

  const wData = {
    caliber     : v('Калибр'),
    weight      : v('Вес'),
    fireRate    : v('Темп стрельбы'),
    techType    : v('Тип технологии'),
    damageType  : v('Тип урона'),
    weaponClass : v('Класс оружия'),
    baseRange   : v('Дальность'),
  };

  const ws = calculateWeaponStats(wData);

  // Сохраняем расчётный урон в infobox чтобы он попал на страницу персонажа
  ibSmartSet(bi, 'Урон расч.', String(ws.damage));

  if (ws.damage === 0 && ws.finalRange === 0) {
    el.innerHTML = '<span style="color:var(--t4)">← заполни параметры для расчёта</span>';
    return;
  }

  const ratePct = Math.round((ws.rateMod - 1) * 100);

  el.innerHTML = `
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:8px">
  <div>
    <div style="font-size:7px;letter-spacing:2px;color:rgba(240,112,112,.5);font-family:Rajdhani,sans-serif;margin-bottom:4px">ИТОГОВЫЙ УРОН</div>
    <div style="font-size:26px;font-weight:900;font-family:Rajdhani,sans-serif;color:#f07070;line-height:1">${ws.damage}</div>
    <div style="font-size:8px;color:var(--t4);margin-top:3px">ед. за попадание</div>
  </div>
  <div>
    <div style="font-size:7px;letter-spacing:2px;color:rgba(107,184,212,.5);font-family:Rajdhani,sans-serif;margin-bottom:4px">ДАЛЬНОСТЬ</div>
    <div style="font-size:18px;font-weight:900;font-family:Rajdhani,sans-serif;color:#6bb8d4;line-height:1">${ws.finalRange > 0 ? ws.rangeLabel : '—'}</div>
    <div style="font-size:8px;color:var(--t4);margin-top:3px">для пехоты / техники</div>
  </div>
  <div>
    <div style="font-size:7px;letter-spacing:2px;color:rgba(28,100,148,.5);font-family:Rajdhani,sans-serif;margin-bottom:4px">ТЕМП</div>
    <div style="font-size:14px;font-weight:700;font-family:Rajdhani,sans-serif;color:var(--te);line-height:1">${ws.fireRate > 0 ? ws.fireRate : '—'}</div>
    <div style="font-size:8px;color:var(--t4);margin-top:3px">${ws.fireRate > 0 ? `×${ws.rateMod.toFixed(2)} rateMod` : 'выст/мин'}</div>
  </div>
</div>
<div style="border-top:1px solid var(--w2);margin:6px 0;padding-top:6px;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--t4)">
  <div>tCoef <span style="color:var(--t2)">${ws.tCoef}</span></div>
  <div>dCoef <span style="color:var(--t2)">+${Math.round(ws.dCoef * 100)}%</span></div>
  <div>cCoef <span style="color:var(--t2)">${ws.cCoef}</span></div>
  <div>Калибр <span style="color:var(--t2)">${ws.caliber} мм</span></div>
  <div>√Вес <span style="color:var(--t2)">${ws.weightSqrt.toFixed(2)}</span></div>
  <div>rateMod <span style="color:var(--t2)">×${ws.rateMod.toFixed(3)}</span></div>
</div>
<div style="font-size:8px;color:rgba(80,200,120,.5);font-family:'JetBrains Mono',monospace">
  ✓ «Урон расч.» сохранён в поля предмета
</div>`;
}

function ibSetSec(bi,si,key,val){if(editBlocks[bi]?.sections?.[si]) editBlocks[bi].sections[si][key]=val;}
function ibSetRow(bi,si,ri,key,val){if(editBlocks[bi]?.sections?.[si]?.rows?.[ri]) editBlocks[bi].sections[si].rows[ri][key]=val;}
function ibAddSec(bi,bid){if(!editBlocks[bi].sections) editBlocks[bi].sections=[];editBlocks[bi].sections.push({name:'',name_en:'',rows:[{key:'',key_en:'',val:'',val_en:''}]});renderBlockEditor();setTimeout(()=>document.getElementById('ib-secs-'+bid)?.scrollIntoView({behavior:'smooth',block:'nearest'}),50);}
function ibDelSec(bi,si){editBlocks[bi].sections?.splice(si,1);renderBlockEditor();}
function ibAddRow(bi,si){editBlocks[bi].sections?.[si]?.rows?.push({key:'',key_en:'',val:'',val_en:''});renderBlockEditor();}
function ibDelRow(bi,si,ri){editBlocks[bi].sections?.[si]?.rows?.splice(ri,1);renderBlockEditor();}
function ibApplyPreset(bi,pgType,pi){
  const PRESETS={
    item:[
      {label:'Оружие',    secName:'Параметры', rows:[
        {key:'Редкость',val:'common'},{key:'Слот',val:'weapon'},
        {key:'Калибр',val:''},{key:'Вес',val:''},{key:'Темп стрельбы',val:''},
        {key:'Тип технологии',val:'conventional'},{key:'Тип урона',val:'kinetic'},
        {key:'Класс оружия',val:'rifle'},{key:'Дальность',val:''},
        {key:'Требования',val:''},{key:'Описание',val:''},
      ]},
      {label:'Броня',     secName:'Параметры', rows:[{key:'Редкость',val:'common'},{key:'Слот',val:'armor'},{key:'Защита',val:''},{key:'Требования',val:''},{key:'Вес',val:''},{key:'Описание',val:''}]},
      {label:'Артефакт',  secName:'Параметры', rows:[{key:'Редкость',val:'common'},{key:'Слот',val:'artifact'},{key:'Бонус КЗ',val:''},{key:'Иммунитеты',val:''},{key:'Требования',val:''},{key:'Описание',val:''}]},
      {label:'Расходник', secName:'Параметры', rows:[{key:'Редкость',val:'common'},{key:'Слот',val:'consumable'},{key:'Эффект',val:''},{key:'Стоимость',val:''},{key:'Описание',val:''}]},
    ],
    ability:[
      {label:'Пассивная', secName:'Параметры', rows:[{key:'Тип',val:'passive'},{key:'Эффект',val:''},{key:'Бонус КЗ',val:'0'},{key:'Бонус СИЛ',val:'0'},{key:'Описание',val:''}]},
      {label:'Действие',  secName:'Параметры', rows:[{key:'Тип',val:'action'},{key:'Дальность',val:''},{key:'Стоимость',val:''},{key:'Эффект',val:''},{key:'Описание',val:''}]},
      {label:'Реакция',   secName:'Параметры', rows:[{key:'Тип',val:'reaction'},{key:'Триггер',val:''},{key:'Эффект',val:''},{key:'Описание',val:''}]},
      {label:'1/день',    secName:'Параметры', rows:[{key:'Тип',val:'1/day'},{key:'Дальность',val:''},{key:'Стоимость',val:''},{key:'Эффект',val:''},{key:'Описание',val:''}]},
    ],
  };
  const preset=(PRESETS[pgType]||[])[pi];
  if(!preset||!editBlocks[bi])return;
  const rows=preset.rows.map(r=>({key:r.key,key_en:'',val:r.val,val_en:''}));
  if(!editBlocks[bi].sections)editBlocks[bi].sections=[];
  if(editBlocks[bi].sections.length>0){
    editBlocks[bi].sections[0].rows=rows;
    editBlocks[bi].sections[0].name=preset.secName;
  } else {
    editBlocks[bi].sections=[{name:preset.secName,name_en:'Parameters',rows}];
  }
  if(!editBlocks[bi].label)editBlocks[bi].label=pgType==='item'?'Предмет':'Способность';
  renderBlockEditor();
}

function tableToCSV(b){const heads=(b.headers||[]).join(',');const rows=(b.rows||[]).map(r=>r.join(',')).join('\n');return heads+(rows?'\n'+rows:'');}
function parseTableCSV(i,txt){const lines=txt.split('\n').map(l=>l.split(',').map(c=>c.trim()));if(lines.length<1)return;editBlocks[i].headers=lines[0];editBlocks[i].rows=lines.slice(1);}
function tgPrv(id){const ta=document.getElementById('ta-'+id);const pv=document.getElementById('prv-'+id);const btn=document.getElementById('prv-tg-'+id);if(!ta||!pv||!btn)return;const showing=pv.style.display==='block';ta.style.display=showing?'':'none';pv.style.display=showing?'none':'block';const isRu=lang==='ru';btn.className=showing?'prv-tg':'prv-tg on';btn.textContent=showing?`◉ ${isRu?'Предпросмотр':'Preview'}`:`✎ ${isRu?'Редактор':'Editor'}`;if(!showing) pv.innerHTML=renderMd(ta.value||'');}
function mdIns(before,after,ph,i){const ta=document.getElementById('ta-'+editBlocks[i]?.id);if(!ta)return;ta.focus();const s=ta.value.substring(ta.selectionStart,ta.selectionEnd);document.execCommand('insertText',false,before+(s||ph)+after);upBlock(i,'content',ta.value);}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// BLOCK PICKER
// ────────────────────────────────────────────────────────────────────────────────────────────────────
const BLOCK_CATS=[{id:'all',ru:'Все',en:'All'},{id:'text',ru:'Текст',en:'Text'},{id:'media',ru:'Медиа',en:'Media'},{id:'layout',ru:'Компоновка',en:'Layout'},{id:'special',ru:'Особые',en:'Special'}];
const BLOCKS=[
  {type:'text',cat:'text',icon:'📝',ru:'Текст',en:'Text',dRu:'Markdown с форматированием',dEn:'Markdown with formatting'},
  {type:'heading',cat:'text',icon:'Aa',ru:'Заголовок',en:'Heading',dRu:'Стилизованный заголовок',dEn:'Styled heading'},
  {type:'toc',cat:'text',icon:'≡',ru:'Содержание',en:'Contents',dRu:'Автосодержание из заголовков',dEn:'Auto table of contents'},
  {type:'quote',cat:'text',icon:'❞',ru:'Цитата',en:'Quote',dRu:'Выделенная цитата',dEn:'Block quote'},
  {type:'alert',cat:'text',icon:'⚠',ru:'Метка',en:'Alert',dRu:'CLASSIFIED / SECRET / INTEL',dEn:'Classified / Secret / Intel'},
  {type:'callout',cat:'text',icon:'💬',ru:'Выноска',en:'Callout',dRu:'Info / Lore / Warning',dEn:'Info / Lore / Warning'},
  {type:'spoiler',cat:'text',icon:'🔒',ru:'Спойлер',en:'Spoiler',dRu:'Скрытый блок',dEn:'Hidden block'},
  {type:'image',cat:'media',icon:'🖼',ru:'Изображение',en:'Image',dRu:'Фото с подписью',dEn:'Photo with caption'},
  {type:'imgtext',cat:'media',icon:'🖼📝',ru:'Фото + Текст',en:'Photo + Text',dRu:'Фото с обтеканием',dEn:'Float image'},
  {type:'gallery',cat:'media',icon:'⊞',ru:'Галерея',en:'Gallery',dRu:'Сетка изображений',dEn:'Image grid'},
  {type:'infobox',cat:'media',icon:'📋',ru:'Инфобокс',en:'Infobox',dRu:'Карточка с данными',dEn:'Data card'},
  {type:'cols',cat:'layout',icon:'⫛',ru:'Колонки',en:'Columns',dRu:'2 или 3 колонки',dEn:'2 or 3 columns'},
  {type:'frame',cat:'layout',icon:'🗂',ru:'Фрейм',en:'Frame',dRu:'Рамка с заголовком',dEn:'Labeled box'},
  {type:'divider',cat:'layout',icon:'—',ru:'Разделитель',en:'Divider',dRu:'Декоративный разделитель',dEn:'Decorator'},
  {type:'table',cat:'special',icon:'📊',ru:'Таблица',en:'Table',dRu:'CSV-таблица',dEn:'CSV table'},
  {type:'stats',cat:'special',icon:'◉',ru:'Статистика',en:'Stats',dRu:'Числа в строку',dEn:'Stats row'},
  {type:'timeline',cat:'special',icon:'◈',ru:'Хронология',en:'Timeline',dRu:'Шкала событий',dEn:'Event timeline'},
  {type:'battle_map',cat:'special',icon:'🗺',ru:'Тактическая карта',en:'Battle Map',dRu:'Интерактивная карта сражения со стадиями',dEn:'Interactive battle map with stages'},
  {type:'rel_graph',cat:'special',icon:'◎',ru:'Граф связей',en:'Relation Graph',dRu:'Схема персонажей, иерархий, семейных древ',dEn:'Character relations, hierarchy, family tree'},
  {type:'vis_timeline',cat:'special',icon:'⟿',ru:'Хронология (визуал)',en:'Visual Timeline',dRu:'Интерактивная шкала времени с событиями',dEn:'Interactive visual timeline of events'},
  {type:'chart',cat:'special',icon:'📈',ru:'График',en:'Chart',dRu:'Столбчатый, линейный или круговой',dEn:'Bar, line or pie chart'},
];
function openPicker(afterIdx,e){e.stopPropagation();pickerInsertIdx=afterIdx;_pickerQ='';document.getElementById('bp-search').value='';renderPickerCats();renderPickerBlocks();document.getElementById('bp-modal-ov').classList.add('show');setTimeout(()=>document.getElementById('bp-search').focus(),80);}
function closePicker(){document.getElementById('bp-modal-ov')?.classList.remove('show');document.getElementById('bp-ov')?.classList.remove('show');}
function filterPicker(q){_pickerQ=q.toLowerCase();renderPickerBlocks();}
function setPickerCat(cat){_pickerCat=cat;renderPickerCats();renderPickerBlocks();}
function renderPickerCats(){document.getElementById('bp-cats').innerHTML=BLOCK_CATS.map(c=>`<button class="bp-cat${_pickerCat===c.id?' on':''}" onclick="setPickerCat('${c.id}')">${lang==='en'?c.en:c.ru}</button>`).join('');}
function renderPickerBlocks(){
  const filtered=BLOCKS.filter(b=>{if(_pickerCat!=='all'&&b.cat!==_pickerCat)return false;if(_pickerQ){const n=lang==='en'?b.en:b.ru;return n.toLowerCase().includes(_pickerQ)||(lang==='en'?b.dEn:b.dRu).toLowerCase().includes(_pickerQ);}return true;});
  document.getElementById('blk-picker').innerHTML=filtered.length?filtered.map(b=>`<div class="bpr" onclick="insertBlock('${b.type}')"><span class="bpr-i">${b.icon}</span><div><div class="bpr-n">${lang==='en'?b.en:b.ru}</div><div class="bpr-d">${lang==='en'?b.dEn:b.dRu}</div></div></div>`).join(''):`<div style="grid-column:1/-1;padding:32px;text-align:center;font-size:12px;color:var(--t3)">${lang==='ru'?'Ничего не найдено':'Nothing found'}</div>`;
}
function insertBlock(type){
  closePicker();
  const defaults={
    text:{type:'text',id:uid(),content:''},
    heading:{type:'heading',id:uid(),text:'',style:'h-scan'},
    toc:{type:'toc',id:uid()},
    infobox:{type:'infobox',id:uid(),label:'',title:'',subtitle:'',image_url:'',img_caption:'',sections:[{name:'',rows:[{key:'',val:''}]}]},
    image:{type:'image',id:uid(),url:'',caption:''},
    imgtext:{type:'imgtext',id:uid(),layout:'l',imgUrl:'',caption:'',content:''},
    callout:{type:'callout',id:uid(),variant:'info',icon:'ℹ️',title:'',content:''},
    alert:{type:'alert',id:uid(),variant:'classified',title:'',content:''},
    spoiler:{type:'spoiler',id:uid(),label:'СКРЫТАЯ ИНФОРМАЦИЯ',content:''},
    frame:{type:'frame',id:uid(),label:'ДАННЫЕ',content:''},
    table:{type:'table',id:uid(),headers:['Столбец 1','Столбец 2','Столбец 3'],rows:[['','',''],['','','']]},
    divider:{type:'divider',id:uid(),style:'ornament'},
    cols:{type:'cols',id:uid(),cols:2,items:['','']},
    quote:{type:'quote',id:uid(),text:'',author:''},
    gallery:{type:'gallery',id:uid(),images:[]},
    stats:{type:'stats',id:uid(),items:[{val:'',label:''},{val:'',label:''},{val:'',label:''}]},
    timeline:{type:'timeline',id:uid(),items:[{date:'',date_en:'',text:'',text_en:''}]},
    battle_map:BM_DEFAULT_DATA(),
    rel_graph:{type:'rel_graph',id:uid(),title:'',nodes:[
      {id:'n1',label:'Персонаж А',type:'hero',desc:'Описание'},
      {id:'n2',label:'Персонаж Б',type:'villain',desc:'Описание'},
      {id:'n3',label:'Персонаж В',type:'default',desc:'Описание'},
    ],edges:[
      {from:'n1',to:'n2',label:'враги',type:'enemy'},
      {from:'n1',to:'n3',label:'союз',type:'ally'},
    ]},
    vis_timeline:{type:'vis_timeline',id:uid(),title:'',orient:'v',items:[
      {date:'Год 1',text:'Первое событие',category:'default'},
      {date:'Год 2',text:'Второе событие',category:'character'},
      {date:'Год 3',text:'Третье событие',category:'war'},
    ]},
    chart:{type:'chart',id:uid(),title:'',chart_type:'bar',labels:['А','Б','В','Г'],datasets:[
      {label:'Серия 1',data:[40,70,30,90]},
    ]},
  };
  
  const blk=defaults[type]||{type,id:uid()}; editBlocks.splice(pickerInsertIdx+1,0,blk); renderBlockEditor();
  _edSelIdx=pickerInsertIdx+1; // auto-select newly inserted block
  renderBlockEditor();
  setTimeout(()=>{
    const card=document.getElementById('sbc-'+(blk.id||''));
    if(card){card.classList.add('selected');card.scrollIntoView({behavior:'smooth',block:'nearest'});}
    refreshBlockPropsPanel();
  },80);
}

function openCovMo() {
    const cur = editData?.image_url || '';
    const curH = editData?.cover_height || 340;
    const curPos = editData?.cover_pos || 'center center';
    const curType = editData?.cover_type || 'standard';
    const excludeCollage = editData?.exclude_from_collage || false;

    const urlInput = document.getElementById('cov-url');
    const typeSelect = document.getElementById('cov-type');
    const excludeCheckbox = document.getElementById('cov-exclude-collage');
    const preview = document.getElementById('hero-cov-preview');
    const previewImg = document.getElementById('hero-cov-preview-img');
    if (urlInput) urlInput.value = cur;
    if (typeSelect) typeSelect.value = curType;
    if (excludeCheckbox) excludeCheckbox.checked = excludeCollage;
    if (preview && previewImg) {
      if (cur) { previewImg.src = cur; previewImg.style.objectPosition = curPos; preview.style.display = 'block'; }
      else { preview.style.display = 'none'; }
    }

    // Height slider
    const hRange = document.getElementById('cov-h-range');
    const hVal = document.getElementById('cov-h-val');
    if (hRange) { hRange.value = curH; }
    if (hVal) { hVal.textContent = curH; }

    // Position buttons
    document.querySelectorAll('.cpb').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.pos === curPos);
    });

    // Show PC controls
    const pcCtrl = document.getElementById('cov-pc-controls');
    if (pcCtrl) pcCtrl.style.display = 'block';

    document.getElementById('cov-mo-title').textContent = 'ARTICLE COVER';
    document.getElementById('cov-apply-btn').onclick = () => applyCov(document.getElementById('cov-url').value);
    document.getElementById('cov-remove-btn').onclick = () => applyCov('');
    om('mo-cover');
  }

  function setCovPos(btn) {
    document.querySelectorAll('.cpb').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    covPosPreview();
  }

  function covPosPreview() {
    const pos = document.querySelector('.cpb.on')?.dataset.pos || 'center center';
    const img = document.getElementById('hero-cov-preview-img');
    if (img) img.style.objectPosition = pos;
  }

  function applyCov(url) {
    if (editData) {
      editData.image_url = url || null;
      editData.cover_type = document.getElementById('cov-type')?.value || 'standard';
      editData.exclude_from_collage = document.getElementById('cov-exclude-collage')?.checked || false;
      if (url) {
        editData.cover_height = parseInt(document.getElementById('cov-h-range')?.value || 340, 10);
        editData.cover_pos = document.querySelector('.cpb.on')?.dataset.pos || 'center center';
      }
    }
    cm('mo-cover');
    const z = document.getElementById('cov-z');
    if (z) {
      z.innerHTML = url
        ? `<img src="${esc(url)}" id="cov-img" style="object-position:${editData?.cover_pos||'center'}"><div class="cz-ov"><span>✎ Изменить обложку</span></div>`
        : `<div class="cz-empty"><span style="font-size:28px;opacity:.2">🖼</span><span>+ Добавить обложку</span></div>`;
      if (url) { z.style.height = (editData?.cover_height || 340) + 'px'; }
    }
  }

function npFilterParents(){
  const sec=document.getElementById('np-sec')?.value||'';
  const pd=document.getElementById('np-par');
  if(!pd) return;
  const filtered=sec ? pages.filter(p=>isVisiblePage(p)&&p.section===sec) : pages.filter(isVisiblePage);
  pd.innerHTML='<option value="">— Нет —</option>';
  filtered.forEach(p=>pd.innerHTML+=`<option value="${esc(p.slug)}">${esc(pT(p))}</option>`);
}
function openNewPage(){
  npSlugLk2=false; ['np-t','np-sl'].forEach(id=>document.getElementById(id).value='');
  const sd=document.getElementById('np-sec');
  sd.innerHTML='<option value="">— Нет —</option>';
  sections.forEach(s=>sd.innerHTML+=`<option value="${esc(s.slug)}">${esc(sN(s))}</option>`);
  sd.onchange = npFilterParents;
  npFilterParents();
  om('mo-new'); setTimeout(()=>document.getElementById('np-t')?.focus(),60);
}
function autoNpSl(){if(npSlugLk2)return;document.getElementById('np-sl').value=slugify(document.getElementById('np-t').value||'');}
async function doCreateNew(){
  if(!user||!['superadmin','editor'].includes(user.role)){toast(lang==='ru'?'Нет прав':'Access denied','err');return;}
  const t=document.getElementById('np-t').value.trim(); const sl=document.getElementById('np-sl').value.trim(); const sec=document.getElementById('np-sec').value||null; const par=document.getElementById('np-par').value||null;
  if(!t||!sl){toast('Заголовок и slug обязательны','err');return;}
  const pgType=document.getElementById('np-type')?.value||'article';
  try{const now=new Date().toISOString();
    let initContent='[]';
    if(pgType==='item')initContent=JSON.stringify([{type:'infobox',id:uid(),label:'Предмет',title:t,sections:[{name:'Параметры',rows:[{key:'Редкость',val:'common'},{key:'Слот',val:'weapon'},{key:'Калибр',val:''},{key:'Вес',val:''},{key:'Темп стрельбы',val:''},{key:'Тип технологии',val:'conventional'},{key:'Тип урона',val:'kinetic'},{key:'Класс оружия',val:'rifle'},{key:'Дальность',val:''},{key:'Требования',val:''},{key:'Описание',val:''}]}]}]);
    if(pgType==='ability')initContent=JSON.stringify([{type:'infobox',id:uid(),label:'Способность',title:t,sections:[{name:'Параметры',rows:[{key:'Тип',val:'passive'},{key:'Дальность',val:''},{key:'Стоимость',val:''},{key:'Эффект',val:''},{key:'Иммунитеты',val:''},{key:'Бонус КЗ',val:'0'},{key:'Бонус СИЛ',val:'0'}]}]}]);
    if(pgType==='faction')initContent=JSON.stringify([{type:'infobox',id:uid(),label:'Фракция',title:t,sections:[{name:'Основное',rows:[{key:'Тип',val:''},{key:'Столица',val:''},{key:'Лидер',val:''},{key:'Основана',val:''},{key:'Идеология',val:''}]}]},{type:'text',id:uid(),content:''}]);
    if(pgType==='preview')initContent=JSON.stringify([{type:'infobox',id:uid(),label:'Превью',title:t,sections:[{name:'Базовые',rows:[{key:'Скорость',val:''},{key:'Мощность',val:''},{key:'Точность',val:''}]},{name:'Дополнительно',rows:[{key:'Класс',val:''},{key:'Роль',val:''},{key:'Особенность',val:''}]}]},{type:'text',id:uid(),content:''}]);
    if(pgType==='location')initContent=JSON.stringify([{type:'infobox',id:uid(),label:'Локация',title:t,sections:[{name:'Обстановка',rows:[{key:'Сектор',val:''},{key:'Система',val:''},{key:'Контроль',val:''},{key:'Опасность',val:''}]}]},{type:'text',id:uid(),content:'Опишите атмосферу места: что видят и слышат прибывшие сюда персонажи.'}]);
    await dbPost('pages',{slug:sl,title:t,section:sec,parent_slug:par,status:'draft',sort_order:0,content:initContent,page_type:pgType,created_at:now,updated_at:now,created_by:user.email});
    if(pgType==='character'){
      try{await fetch(`${SB_URL}/rest/v1/characters`,{method:'POST',headers:{'apikey':SB_ANON,'Authorization':'Bearer '+getToken(),'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({slug:sl,name:t,class:'soldier',play_start:new Date().toISOString().slice(0,10),owner_email:user.email,stats:{str:10,dex:10,con:10,int:10,wis:10,cha:10},abilities:[],gear:[],extra:{}})});}catch(e2){}
    }
    toast('Страница создана!','ok');cm('mo-new');await loadPgs();buildNav();go(sl);}catch(e){toast('Ошибка: '+e.message,'err');}
}

function openAp(){if(!user)return;apOpen=true;document.getElementById('ap').classList.add('open');renderAp();}
function closeAp(){apOpen=false;document.getElementById('ap').classList.remove('open');}
function renderAp(){
  if(!user)return;
  const dn = getDisplayName(); const avHtml = getAvatarHtml(user.email, userProfile.avatar_url, userProfile.display_name, 40);
  const rl={superadmin:'Superadmin',editor:'Editor',moderator:'Moderator',player:'Игрок',viewer:'Viewer'}; const rc={superadmin:'r-sa',editor:'r-ed',moderator:'r-mo',player:'r-pl',viewer:'r-vi'};
  document.getElementById('ap-un').textContent = dn; document.getElementById('ap-ur').textContent=rl[user.role]||user.role; document.getElementById('ap-ur').className='ap-ur '+(rc[user.role]||'');
  let apAvEl = document.getElementById('ap-av-wrap');
  if (!apAvEl) { apAvEl = document.createElement('div'); apAvEl.id = 'ap-av-wrap'; apAvEl.style.cssText = 'display:flex;align-items:center;margin-right:6px;flex-shrink:0;cursor:pointer'; apAvEl.onclick = openProfileModal; document.querySelector('.ap-ui').parentNode.insertBefore(apAvEl, document.querySelector('.ap-ui')); }
  apAvEl.innerHTML = avHtml;
  const canEdit=['superadmin','editor','moderator'].includes(user.role); const canSec=['superadmin','editor'].includes(user.role); const isSA=user.role==='superadmin';
  const tabs=[['profile','Профиль'],['mypages','Мои стр.']];
  // «Новости»: видна владельцам одобренной фракции и стаффу (для модерации)
  if(_myFactionApproved || canEdit) tabs.push(['news','Новости']);
  if(canEdit) tabs.push(['pages','Страницы']); if(canSec) tabs.push(['sections','Разделы'],['devlog','Девлог'],['apps','Анкеты'],['mga','МГА']); if(isSA) tabs.push(['users','Польз.'],['settings','Настройки']);
  if(!tabs.find(t=>t[0]===apTab)) apTab=tabs[0]?.[0]||'profile';
  document.getElementById('ap-tabs').innerHTML=tabs.map(([id,l])=>`<button class="apt${apTab===id?' on':''}" onclick="setApTab('${id}')">${l}</button>`).join('');
  renderApTab();
}
function setApTab(t){apTab=t;renderAp();}
async function renderApTab(){
  const b=document.getElementById('ap-body'); b.innerHTML='<div class="sload" style="min-height:60px"><div class="quote-loader">' + getRandomQuote() + '</div></div>';
  if(apTab==='profile'){
    const hasName = !!(userProfile.display_name && userProfile.display_name.trim());
    const dn=getDisplayName(); const avBig=getAvatarHtml(user.email,userProfile.avatar_url,dn,72);
    const rl={superadmin:'SUPERADMIN',editor:'РЕДАКТОР',moderator:'МОДЕРАТОР',player:'ИГРОК',viewer:'ЗРИТЕЛЬ'}; const rc={superadmin:'var(--gdl)',editor:'var(--tel)',moderator:'var(--pul)',player:'var(--ok)',viewer:'var(--t3)'};
    const isStaff = ['superadmin','editor','moderator'].includes(user.role);

    // Вики-метрики показываем только редакторам/админам — у игроков они всегда 0.
    let statsHtml = '';
    if (isStaff) {
      const myPgs = pages.filter(p=>isVisiblePage(p)&&(p.created_by===user.email||p.created_by===user.id));
      const myPubCount = myPgs.filter(p=>p.status==='published').length, myDftCount = myPgs.filter(p=>p.status==='draft').length;
      statsHtml = `<div class="prof-stats-grid">
        <div class="prof-stat-card"><div class="prof-stat-icon">📄</div><div class="prof-stat-val">${myPgs.length}</div><div class="prof-stat-lbl">Всего страниц</div></div>
        <div class="prof-stat-card"><div class="prof-stat-icon">✓</div><div class="prof-stat-val">${myPubCount}</div><div class="prof-stat-lbl">Опубликовано</div></div>
        <div class="prof-stat-card"><div class="prof-stat-icon">✎</div><div class="prof-stat-val">${myDftCount}</div><div class="prof-stat-lbl">Черновиков</div></div>
      </div>`;
    }

    // Игровая сводка: анкета фракции игрока (статус, столица, правление).
    let gameHtml = '';
    const myApp = (typeof frLoadMine==='function') ? await frLoadMine() : null;
    if (myApp) {
      const stMap = { draft:['ЧЕРНОВИК','var(--t3)'], pending:['НА МОДЕРАЦИИ','var(--color-warning)'], approved:['ОДОБРЕНА','var(--ok)'], rejected:['ОТКЛОНЕНА','var(--err)'] };
      const st = stMap[myApp.status] || ['—','var(--t3)'];
      const capital = (myApp.system_name||'—') + (myApp.planet_name ? ' / '+myApp.planet_name : '');
      const gRow = (k,v)=>`<div class="prof-game-row"><span>${k}</span><b>${esc(v||'—')}</b></div>`;
      gameHtml = `<div class="prof-game">
        <div class="prof-game-hd">◈ Моё государство</div>
        ${gRow('Фракция', myApp.name)}
        <div class="prof-game-row"><span>Статус анкеты</span><b style="color:${st[1]}">${st[0]}</b></div>
        ${gRow('Правление', (myApp.gov||'') + (myApp.regime?' · '+myApp.regime:''))}
        ${gRow('Столица', capital)}
        ${gRow('Раса', myApp.race)}
        ${myApp.status==='approved'
          ? `<button class="btn btn-gh btn-fw" style="margin-top:10px" onclick="closeAp();go('economy')">🛰 Открыть кабинет</button>`
          : `<button class="btn btn-gh btn-fw" style="margin-top:10px" onclick="closeAp();go('faction-new')">⬡ ${myApp.status==='rejected'?'Подать заново':'Продолжить анкету'}</button>`}
      </div>`;
    } else if (!isStaff) {
      gameHtml = `<div class="prof-game">
        <div class="prof-game-hd">◈ Моё государство</div>
        <div style="font-size:12px;color:var(--t3);margin-bottom:10px">Фракция ещё не создана.</div>
        <button class="btn btn-gd btn-fw" onclick="closeAp();go('faction-new')">⬡ Зарегистрировать фракцию</button>
      </div>`;
    }

    const nameLine = hasName ? esc(dn) : `${esc(dn)} <span class="prof-name-default">· имя по умолчанию</span>`;
    b.innerHTML=`
      <div class="prof-header">
        <div class="prof-av-large">${avBig}</div>
        <div class="prof-identity">
          <div class="prof-display-name">${nameLine}</div>
          <div class="prof-email">${esc(user.email)}</div>
          <div class="prof-role-badge" style="color:${rc[user.role]||'var(--t3)'};border-color:${rc[user.role]||'var(--t3)'}">
            <span class="prof-role-icon">◈</span>
            ${rl[user.role]||user.role}
          </div>
        </div>
      </div>
      ${gameHtml}
      ${statsHtml}
      <div class="prof-divider"></div>
      <div class="prof-form">
        <div class="fg">
          <label class="fl">Отображаемое имя</label>
          <input class="fi" id="prof-name" value="${esc(userProfile.display_name||'')}" placeholder="${esc(user.email.split('@')[0])}">
        </div>
        <div class="fg">
          <label class="fl">URL аватара</label>
          <input class="fi" id="prof-avatar" type="url" value="${esc(userProfile.avatar_url||'')}" placeholder="https://...">
        </div>
        <input type="file" id="prof-av-file" accept="image/*" style="display:none" onchange="uploadProfileAv(this)">
        <button class="btn btn-gh btn-fw" style="margin-bottom:12px" onclick="document.getElementById('prof-av-file').click()">
          <span style="margin-right:6px">📁</span> Загрузить изображение
        </button>
        <button class="btn btn-gd btn-fw" onclick="saveProfileFromApForm()">
          <span style="margin-right:6px">💾</span> Сохранить профиль
        </button>
      </div>
      <div class="prof-divider"></div>
      <div class="prof-form">
        <div class="fg">
          <label class="fl">Текущий пароль</label>
          <input class="fi" id="prof-curpass" type="password" placeholder="Для подтверждения личности" autocomplete="current-password">
        </div>
        <div class="fg">
          <label class="fl">Новый пароль</label>
          <input class="fi" id="prof-newpass" type="password" placeholder="Минимум 8 символов" autocomplete="new-password">
        </div>
        <button class="btn btn-gh btn-fw" onclick="changeMyPassword()">
          <span style="margin-right:6px">🔑</span> Сменить пароль
        </button>
      </div>`;
  } else if(apTab==='mypages'){
    const myPgs = pages.filter(p=>isVisiblePage(p)&&(p.created_by===user.email||p.created_by===user.id));
    if(!myPgs.length){b.innerHTML=`<div style="text-align:center;padding:24px 0"><div style="font-size:36px;opacity:.15;margin-bottom:10px">◈</div><div style="font-family:Rajdhani,sans-serif;font-size:10px;letter-spacing:2px;color:var(--t3)">Нет страниц</div></div>`;return;}
    const rows=myPgs.sort((a,x)=>new Date(x.updated_at||0)-new Date(a.updated_at||0)).map(p=>`<div class="ir"><div class="ir-n" onclick="go('${esc(p.slug)}');closeAp()">${esc(pT(p))}</div><span style="font-family:JetBrains Mono,monospace;font-size:8px;color:var(--t4);flex-shrink:0">${timeAgo(p.updated_at)}</span><span class="ir-b ${p.status==='published'?'bp-b':'bd-b'}">${p.status==='published'?'PUB':'DFT'}</span></div>`).join('');
    b.innerHTML=`<div style="margin-bottom:10px;font-family:JetBrains Mono,monospace;font-size:10px;color:var(--te)">${myPgs.length} страниц</div><div class="il">${rows}</div>`;
  } else if(apTab==='pages'){
    if(user.role==='viewer'){b.innerHTML=`<p style="font-size:13px;color:var(--t2);padding:8px 0">Вы просматриваете вики в режиме чтения.</p>`;return;}
    const canCreate=['superadmin','editor'].includes(user.role); const canDel=user.role==='superadmin'; const sorted=[...pages].filter(isVisiblePage).sort((a,x)=>pT(a).localeCompare(pT(x),'ru'));
    const rows=sorted.map(p=>`<div class="ir"><div class="ir-n" onclick="go('${esc(p.slug)}')">${esc(pT(p))}${p.page_type&&p.page_type!=='article'?`<span style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--t4);margin-left:5px">[${p.page_type}]</span>`:''}</div><span class="ir-b ${p.status==='published'?'bp-b':'bd-b'}">${p.status==='published'?'PUB':'DFT'}</span>${canDel?`<button class="ib-btn del" onclick="askDel('page','${p.id}','${esc(pT(p))}')" >✖</button>`:''}</div>`).join('');
    b.classList.add('pages-bg');
    const av = userProfile.avatar_url || '';
    if (av) { b.style.setProperty('--ap-pages-bg','url("'+esc(av)+'")'); b.closest('#ap')?.style.setProperty('--ap-pages-bg', 'url("'+esc(av)+'")'); }
    b.innerHTML=`${canCreate?`<div style="display:flex;gap:6px;margin-bottom:12px"><button class="btn btn-gd btn-fw" onclick="closeAp();openNewPage()">+ Новая страница</button></div>`:''}<div class="il">${rows||'<p style="color:var(--t3);font-size:12px">Нет страниц</p>'}</div>`;
  } else if(apTab==='sections'){
    const rows=[...sections].sort((a,x)=>a.sort_order-x.sort_order).map(s=>{const par=sections.find(x=>x.id===s.parent_id);const iconHtml=s.icon?`<img src="${esc(s.icon)}" alt="" style="width:16px;height:16px;object-fit:contain;vertical-align:middle;margin-right:4px">`:'<span style="margin-right:4px">◈</span>';return `<div class="ir"><div class="ir-n">${iconHtml}${esc(sN(s))}${par?`<span style="color:var(--t3);font-size:10px"> ↳ ${sN(par)}</span>`:''}</div><button class="ib-btn" onclick="openEditSec('${s.id}')">✎</button>${user.role==='superadmin'?`<button class="ib-btn del" onclick="askDel('section','${s.id}','${esc(sN(s))}')" >✖</button>`:''}</div>`;}).join('');
    b.innerHTML=`<button class="btn btn-gd btn-fw" style="margin-bottom:12px" onclick="openEditSec(null)">+ Новый раздел</button><div class="il">${rows||'<p style="color:var(--t3);font-size:12px">Нет разделов</p>'}</div>`;
  } else if(apTab==='apps'){
    if(typeof frRenderAppsTab==='function'){ await frRenderAppsTab(b); } else { b.innerHTML='<p style="color:var(--err)">faction_reg.js не загружен</p>'; }
  } else if(apTab==='mga'){
    if(typeof ecRenderMgaTab==='function'){ await ecRenderMgaTab(b); } else { b.innerHTML='<p style="color:var(--err)">economy.js не загружен</p>'; }
    return;
  } else if(apTab==='news'){
    if(typeof fnRenderNewsTab==='function'){ await fnRenderNewsTab(b); } else { b.innerHTML='<p style="color:var(--err)">faction_news.js не загружен</p>'; }
    return;
  } else if(apTab==='users'){
    try {
      // Источник истины — серверный RPC: связь user_id↔email берётся из
      // auth.users (а не угадывается), плюс роль, бан, профиль, текущая и
      // удалённые анкеты — всё одним джойном.
      const allUsers = await apiFetch('rpc/admin_list_users', { method:'POST', body:'{}' }) || [];

      const roleLabels = { superadmin:'SUPERADMIN', editor:'EDITOR', moderator:'MODERATOR', player:'PLAYER', viewer:'VIEWER' };
      const roleColors = { superadmin:'gd', editor:'te', moderator:'pul', player:'ok', viewer:'w3' };
      const roleTextColors = { superadmin:'gdl', editor:'tel', moderator:'pul', player:'ok', viewer:'t3' };

      const userCards = allUsers.map(u => {
        const email = u.email || '';
        // для текущего пользователя берём свежий локальный профиль (минуя кэш БД)
        const localProf = (user && email === user.email) ? getProfileOf(email) : null;
        const name = email.includes('@') ? email.split('@')[0] : 'Без email';
        const displayName = (localProf?.display_name) || u.display_name || name;
        const avatarUrl = (localProf?.avatar_url) || u.avatar_url || '';
        const hue = email ? [...email].reduce((a,c)=>a+c.charCodeAt(0),0) % 360 : 180;

        const userPages = email ? pages.filter(p => isVisiblePage(p) && p.created_by === email) : [];
        const pubCount = userPages.filter(p => p.status === 'published').length;
        const draftCount = userPages.filter(p => p.status === 'draft').length;

        const avHtml = avatarUrl
          ? `<img src="${esc(avatarUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
          : `<div style="width:100%;height:100%;border-radius:50%;background:hsl(${hue},60%,45%);display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-size:20px;font-weight:900;color:#fff">${esc(displayName.slice(0,2).toUpperCase())}</div>`;

        const roleColor = roleColors[u.role] || 'w3';
        const roleTextColor = roleTextColors[u.role] || 't3';

        const isCurrentUser = user && u.user_id === user.id;
        const banned = !!u.is_banned;

        // Бейджи: фракция (одобренная) и удалённые анкеты
        const facBadge = (u.faction_status === 'approved' && u.faction_name)
          ? `<span style="display:inline-flex;align-items:center;gap:3px;padding:3px 8px;background:var(--b1);border:1px solid var(--gd);font-family:Rajdhani,sans-serif;font-size:7px;letter-spacing:1px;color:var(--gdl)">🏛 ${esc(u.faction_name)}</span>`
          : '';
        const delFactions = Array.isArray(u.deleted_factions) ? u.deleted_factions.filter(Boolean) : [];
        const delBadge = delFactions.length
          ? `<div style="margin-top:10px;padding:8px 10px;background:rgba(255,90,90,.07);border:1px solid rgba(255,90,90,.25);border-radius:4px">
               <div style="font-family:'JetBrains Mono',monospace;font-size:7px;letter-spacing:1px;color:#ff7a7a;margin-bottom:4px">🗑 УДАЛЁННЫЕ АНКЕТЫ (${delFactions.length})</div>
               <div style="font-family:Rajdhani,sans-serif;font-size:11px;color:var(--t2);line-height:1.5">${delFactions.map(n=>esc(n)).join(', ')}</div>
             </div>`
          : '';

        return `
          <div class="user-card" style="background:linear-gradient(135deg, var(--b3) 0%, var(--b2) 100%);border:1px solid ${banned ? '#a33' : 'var(--w2)'};padding:16px;position:relative;overflow:hidden${isCurrentUser ? ';box-shadow:0 0 0 2px var(--te)' : ''}${banned ? ';opacity:.85' : ''}">
            <div style="position:absolute;top:0;right:0;bottom:0;width:3px;background:var(--${roleColor});opacity:0.6"></div>
            ${isCurrentUser ? `<div style="position:absolute;top:8px;left:8px;font-family:'JetBrains Mono',monospace;font-size:7px;color:var(--te);background:var(--teb);padding:2px 6px;letter-spacing:1px;border-radius:2px">ВЫ</div>` : ''}
            ${banned ? `<div style="position:absolute;top:8px;${isCurrentUser ? 'left:44px' : 'left:8px'};font-family:'JetBrains Mono',monospace;font-size:7px;color:#fff;background:#a33;padding:2px 6px;letter-spacing:1px;border-radius:2px">⛔ БАН</div>` : ''}

            <div style="display:flex;gap:14px;align-items:start;margin-top:${(isCurrentUser || banned) ? '20px' : '0'}">
              <div style="width:56px;height:56px;flex-shrink:0;position:relative">
                ${avHtml}
              </div>

              <div style="flex:1;min-width:0">
                <div style="font-family:Rajdhani,sans-serif;font-size:13px;font-weight:700;color:var(--t1);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(displayName)}</div>
                ${email ? `<div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--t4);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(email)}">${esc(email)}</div>` : `<div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--t5);margin-bottom:2px">Email не найден</div>`}
                <div style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--t5);margin-bottom:8px" title="${esc(u.user_id)}">ID: ${esc(String(u.user_id).slice(0, 8))}...</div>

                <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
                  <div style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:var(--b1);border:1px solid var(--${roleColor});font-family:Rajdhani,sans-serif;font-size:7px;letter-spacing:1.5px;color:var(--${roleTextColor})">
                    <span style="width:5px;height:5px;border-radius:50%;background:currentColor"></span>
                    ${roleLabels[u.role] || String(u.role||'').toUpperCase()}
                  </div>
                  ${facBadge}
                </div>
              </div>

              <button class="ib-btn" onclick="openEditUsr('${esc(u.user_id)}','${esc(u.role||'')}','${esc(email)}',${banned})" style="flex-shrink:0" title="Редактировать">✎</button>
            </div>

            ${userPages.length > 0 ? `
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid var(--w2)">
              <div style="text-align:center">
                <div style="font-family:Rajdhani,sans-serif;font-size:18px;font-weight:700;color:var(--t1)">${userPages.length}</div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:7px;color:var(--t4);letter-spacing:1px;margin-top:2px">ВСЕГО</div>
              </div>
              <div style="text-align:center">
                <div style="font-family:Rajdhani,sans-serif;font-size:18px;font-weight:700;color:var(--ok)">${pubCount}</div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:7px;color:var(--t4);letter-spacing:1px;margin-top:2px">ОПУБЛ.</div>
              </div>
              <div style="text-align:center">
                <div style="font-family:Rajdhani,sans-serif;font-size:18px;font-weight:700;color:var(--gd)">${draftCount}</div>
                <div style="font-family:'JetBrains Mono',monospace;font-size:7px;color:var(--t4);letter-spacing:1px;margin-top:2px">ЧЕРНОВИК</div>
              </div>
            </div>
            ` : ''}
            ${delBadge}
          </div>
        `;
      }).join('');

      b.innerHTML=`
        <div style="font-family:'Rajdhani',sans-serif;font-size:9px;letter-spacing:2px;color:var(--te);margin-bottom:12px;padding:10px 12px;background:var(--b3);border:1px solid var(--w2)">
          ◈ УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ (${allUsers.length})
          <div style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--t4);margin-top:6px;letter-spacing:0.5px">
            Роль меняется через <strong style="color:var(--te)">Supabase Dashboard → user_roles</strong>. Бан и имя — здесь.
          </div>
        </div>
        <div style="display:grid;gap:12px">
          ${userCards || '<p style="color:var(--t3);font-size:12px">Нет пользователей</p>'}
        </div>
      `;
    } catch(e){
      console.error('Users tab error:', e);
      const hint = /admin_list_users|404|PGRST202|does not exist/i.test(e.message||'')
        ? '<br><span style="color:var(--t3)">Похоже, не выполнен <strong>_admin_users.sql</strong> в Supabase → SQL Editor.</span>' : '';
      b.innerHTML=`<p style="color:var(--err);font-size:12px;padding:12px;background:var(--b3);border:1px solid var(--err)">${esc(e.message)}${hint}</p>`;
    }
  } else if(apTab==='icons'){
    await renderIconsTab(b);
  } else if(apTab==='devlog'){
    await renderDevlogTab(b);
  } else if(apTab==='settings'){
    const bgUrl = await getSiteSetting('wk_background_url') || '';
    const faviconUrl = await getSiteSetting('wk_favicon_url') || '';
    
    b.innerHTML=`
      <div style="margin-bottom:24px">
        <div style="font-family:Rajdhani,sans-serif;font-size:9px;letter-spacing:2px;color:var(--te);margin-bottom:8px">◈ FAVICON (ИКОНКА САЙТА)</div>
        <div class="fg">
          <label class="fl">URL иконки (рекомендуется 32x32 или 64x64 px)</label>
          <input class="fi" id="favicon-url" type="url" value="${esc(faviconUrl)}" placeholder="https://...">
        </div>
        <input type="file" id="favicon-file" accept="image/*" style="display:none" onchange="uploadFaviconImage(this)">
        <button class="btn btn-gh btn-fw" style="margin-bottom:8px" onclick="document.getElementById('favicon-file').click()">📁 Загрузить иконку</button>
        <button class="btn btn-gd btn-fw" onclick="saveFaviconUrl()">Применить favicon</button>
        ${faviconUrl ? `<button class="btn btn-gh btn-fw" style="margin-top:8px;color:var(--err)" onclick="removeFaviconUrl()">Убрать favicon</button>` : ''}
      </div>
      
      <div style="margin-bottom:16px">
        <div style="font-family:Rajdhani,sans-serif;font-size:9px;letter-spacing:2px;color:var(--te);margin-bottom:8px">◈ ФОНОВОЕ ИЗОБРАЖЕНИЕ</div>
        <div class="fg">
          <label class="fl">URL изображения</label>
          <input class="fi" id="bg-url" type="url" value="${esc(bgUrl)}" placeholder="https://...">
        </div>
        <input type="file" id="bg-file" accept="image/*" style="display:none" onchange="uploadBackgroundImage(this)">
        <button class="btn btn-gh btn-fw" style="margin-bottom:8px" onclick="document.getElementById('bg-file').click()">📁 Загрузить изображение</button>
        <button class="btn btn-gd btn-fw" onclick="saveBackgroundUrl()">Применить фон</button>
        ${bgUrl ? `<button class="btn btn-gh btn-fw" style="margin-top:8px;color:var(--err)" onclick="removeBackgroundUrl()">Убрать фон</button>` : ''}
      </div>
    `;
  }
}

async function saveProfileFromApForm() {
  if (!user) return;
  const displayName = document.getElementById('prof-name')?.value?.trim() || '';
  const avatarUrl   = document.getElementById('prof-avatar')?.value?.trim() || '';
  if (typeof badName === 'function' && badName(displayName)) { toast('Имя содержит недопустимые слова (мат или запрещённое) — выберите другое', 'err'); return; }
  // Надёжная запись в БД через upsert по email; ошибку показываем, а не глотаем.
  try {
    await apiFetch('rpc/set_my_profile', { method: 'POST', body: JSON.stringify({ p_name: displayName, p_avatar: avatarUrl }) });
  } catch(e) { toast('Не удалось сохранить профиль: ' + e.message, 'err'); return; }
  userProfile = { display_name: displayName, avatar_url: avatarUrl };
  localStorage.setItem('wk_profile_' + user.id, JSON.stringify(userProfile));

  try { 
    await sb.auth.updateUser({ 
      data: { 
        display_name: displayName, 
        avatar_url: avatarUrl
      } 
    }); 
  } catch(e) {}
  
  const _si = allProfiles.findIndex(p => p.email === user.email); const _pd = { email: user.email, display_name: displayName, avatar_url: avatarUrl };
  if (_si >= 0) allProfiles[_si] = _pd; else allProfiles.push(_pd);
  updAuthUI(); await renderHome(); renderAp(); toast('Профиль сохранён!', 'ok');
}

// Смена пароля текущего пользователя (Supabase Auth) с подтверждением текущего
// пароля (re-authentication) — чтобы по открытой чужой сессии нельзя было
// перехватить аккаунт, не зная старый пароль.
async function changeMyPassword() {
  if (!user) return;
  const cur = document.getElementById('prof-curpass')?.value || '';
  const np  = document.getElementById('prof-newpass')?.value || '';
  if (!cur) { toast('Введите текущий пароль', 'err'); return; }
  if (np.length < 8) { toast('Новый пароль минимум 8 символов', 'err'); return; }
  if (np === cur) { toast('Новый пароль совпадает с текущим', 'err'); return; }
  try {
    // подтверждаем личность текущим паролем — прямой запрос токена,
    // не меняя текущую сессию и не дёргая auth-события
    const vr = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'apikey': SB_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: cur }),
    });
    if (!vr.ok) { toast('Неверный текущий пароль', 'err'); return; }
    const { error } = await sb.auth.updateUser({ password: np });
    if (error) throw error;
    const c = document.getElementById('prof-curpass'); if (c) c.value = '';
    const f = document.getElementById('prof-newpass'); if (f) f.value = '';
    toast('Пароль изменён', 'ok');
  } catch (e) { toast('Ошибка смены пароля: ' + (e.message || e), 'err'); }
}

// ВЫРЕЗАН КРИВОЙ ЗАПРОС user_roles по EMAIL (решение ошибки 400 Bad Request)
async function openContribModal(email, displayName, avUrl, hue, cnt) {
  const isSA = user && user.role === 'superadmin';
  const isMe = user && user.email === email;
  const avHtml = avUrl ? `<img src="${esc(avUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" loading="lazy">` : `<span style="font-size:22px;font-family:Rajdhani,sans-serif;font-weight:700;color:hsl(${hue},60%,70%)">${esc(displayName.slice(0,2).toUpperCase())}</span>`;

  const myPgs = pages.filter(p=>isVisiblePage(p)&&p.created_by===email).sort((a,b)=>new Date(b.updated_at||0)-new Date(a.updated_at||0)).slice(0,8);
  const pgsHtml = myPgs.length ? myPgs.map(p=>{ const s=p.section?sections.find(s=>s.slug===p.section):null; return `<div class="contrib-pg-row" onclick="cm('mo-contrib');go('${esc(p.slug)}')"><div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(pT(p))}</div>${s?`<div style="font-family:JetBrains Mono,monospace;font-size:9px;color:var(--t4)">${esc(sN(s))}</div>`:''}</div><span style="font-family:JetBrains Mono,monospace;font-size:9px;color:var(--t4);flex-shrink:0">${timeAgo(p.updated_at)}</span><span class="ir-b ${p.status==='published'?'bp-b':'bd-b'}">${p.status==='published'?'PUB':'DFT'}</span></div>`; }).join('') : `<p style="color:var(--t3);font-size:12px;text-align:center;padding:16px 0">Нет страниц</p>`;

  let roleHtml = ''; let banHtml = '';
  if (isSA) {
    roleHtml = `<div style="margin-bottom:8px"><div style="font-family:Rajdhani,sans-serif;font-size:8px;letter-spacing:1.5px;color:var(--t4);margin-bottom:4px">СТАТИСТИКА</div><div id="contrib-role-display" style="font-family:Rajdhani,sans-serif;font-size:10px;color:var(--te)">${cnt} созданных страниц</div></div>`;
  }

  const mo = document.getElementById('mo-contrib'); if (!mo) return;
  document.getElementById('contrib-mo-av').innerHTML = avHtml; document.getElementById('contrib-mo-av').style.cssText = `background:hsl(${hue},35%,18%);border:2px solid hsl(${hue},45%,30%)`;
  document.getElementById('contrib-mo-name').textContent = displayName;

  // Показываем роль вместо email (для чужих — просто "УЧАСТНИК")
  const roleMap = { superadmin:'SUPERADMIN', editor:'EDITOR', moderator:'MODERATOR', viewer:'VIEWER' };
  let roleText = 'УЧАСТНИК';
  if (isMe && user) roleText = roleMap[user.role] || user.role || roleText;
  document.getElementById('contrib-mo-email').textContent = roleText;

  document.getElementById('contrib-mo-cnt').textContent = cnt;
  document.getElementById('contrib-mo-pages').innerHTML = pgsHtml; document.getElementById('contrib-mo-role-wrap').innerHTML = roleHtml + banHtml;
  document.getElementById('contrib-mo-edit-btn').style.display = isMe ? 'flex' : 'none';
  om('mo-contrib');
}

function openEditSec(id){
  document.getElementById('mo-sec-t').textContent=id?'РЕДАКТИРОВАТЬ РАЗДЕЛ':'НОВЫЙ РАЗДЕЛ';
  ['es-id','es-nru','es-nen','es-sl','es-ico','es-img'].forEach(fid=>document.getElementById(fid).value='');
  document.getElementById('es-ord').value='0';
  document.getElementById('es-exclude-collage').checked=false;
  const pd=document.getElementById('es-par'); pd.innerHTML='<option value="">— Верхний уровень —</option>'; sections.filter(s=>!s.parent_id).forEach(s=>pd.innerHTML+=`<option value="${s.id}">${esc(sN(s))}</option>`);
  
  // Сбросить preview
  esIconPreview();
  esImgPreview();
  
  om('mo-sec'); if(!id) return;
  const s=sections.find(x=>x.id===id);if(!s)return;
  document.getElementById('es-id').value=s.id; 
  document.getElementById('es-nru').value=s.name_ru||''; 
  document.getElementById('es-nen').value=s.name_en||''; 
  document.getElementById('es-sl').value=s.slug||''; 
  document.getElementById('es-ico').value=s.icon||''; 
  document.getElementById('es-img').value=s.image_url||''; 
  document.getElementById('es-ord').value=s.sort_order||'0'; 
  document.getElementById('es-par').value=s.parent_id||''; 
  document.getElementById('es-exclude-collage').checked=s.exclude_from_collage||false;
  
  // Показать preview если есть значения
  esIconPreview();
  esImgPreview();
}
function esImgPreview(){const url=document.getElementById('es-img')?.value?.trim()||'';const prev=document.getElementById('es-img-preview');const img=document.getElementById('es-img-preview-img');if(!prev||!img)return;if(url){img.src=url;prev.style.display='block';}else{prev.style.display='none';}}
function esIconPreview(){
  const url=document.getElementById('es-ico')?.value?.trim()||'';
  const prev=document.getElementById('es-ico-preview');
  const img=document.getElementById('es-ico-preview-img');
  const urlDisplay=document.getElementById('es-ico-url-display');
  const inputWrap=document.getElementById('es-ico-input-wrap');
  if(!prev||!img)return;
  if(url){
    img.src=url;
    if(urlDisplay)urlDisplay.textContent=url;
    prev.style.display='block';
    if(inputWrap)inputWrap.style.display='none';
  }else{
    prev.style.display='none';
    if(inputWrap)inputWrap.style.display='flex';
  }
}
function clearSecIcon(){
  document.getElementById('es-ico').value='';
  esIconPreview();
}
async function uploadSecIcon(input){const f=input?.files?.[0];if(!f)return;await handleImgUpload(f,url=>{document.getElementById('es-ico').value=url;esIconPreview();});}
async function uploadSecImg(input){const f=input?.files?.[0];if(!f)return;await handleImgUpload(f,url=>{document.getElementById('es-img').value=url;esImgPreview();});}

async function doSaveSec(){
  if(!user||!['superadmin','editor'].includes(user.role)){toast(lang==='ru'?'Нет прав':'Access denied','err');return;}
  const nru=document.getElementById('es-nru').value.trim(); const nen=document.getElementById('es-nen').value.trim()||nru; const sl=document.getElementById('es-sl').value.trim();
  if(!nru||!sl){toast('Название и slug обязательны','err');return;}
  const body={slug:sl,name_ru:nru,name_en:nen,parent_id:document.getElementById('es-par').value||null,sort_order:parseInt(document.getElementById('es-ord').value)||0,icon:document.getElementById('es-ico').value.trim()||null,image_url:document.getElementById('es-img').value.trim()||null,exclude_from_collage:document.getElementById('es-exclude-collage')?.checked||false};
  const id=document.getElementById('es-id').value;
  try{ if(id) await dbPatch('sections',`id=eq.${id}`,body); else await dbPost('sections',body); toast('Раздел сохранён!','ok');cm('mo-sec');await loadSecs();buildNav();renderApTab(); if(curSlug==='home') renderHome(); }catch(e){toast('Ошибка: '+e.message,'err');}
}

function openEditUsr(userId,role,email,banned){
  email = email || '';
  const prof = email ? (getProfileOf(email) || {}) : {};
  // null-safe: разметка модалки могла быть упрощена (часть полей удалена),
  // поэтому пишем только в реально существующие элементы — иначе функция
  // падала на отсутствующем поле и модалка вообще не открывалась.
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const t = document.getElementById('mo-usr-t'); if (t) t.textContent = 'ПОЛЬЗОВАТЕЛЬ';
  set('eu-id', userId);
  set('eu-email', email);
  set('eu-nm', email || '(email не найден)');
  set('eu-email-disp', email || '(email не найден)');
  set('eu-name', prof.display_name || '');
  set('eu-role', role);
  // показываем РЕАЛЬНЫЙ текущий статус бана (раньше всегда сбрасывался в 'false',
  // из-за чего сохранение разбанивало и бан «не работал»)
  set('eu-ban', banned ? 'true' : 'false');
  om('mo-usr');
}
async function doSaveUsr(){
  if(!user||user.role!=='superadmin'){toast('Только superadmin','err');return;}
  // null-safe чтение — поля имени/email в упрощённой модалке могут отсутствовать
  const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const id=val('eu-id');
  const email=val('eu-email');
  const name=val('eu-name').trim();
  const ban=val('eu-ban')==='true';
  if (name && typeof badName === 'function' && badName(name)) { toast('Имя содержит недопустимые слова (мат или запрещённое)', 'err'); return; }
  try{
    // Бан через SECURITY DEFINER RPC — обходит RLS (прямой PATCH чужой строки
    // user_roles блокировался политикой, поэтому бан молча не применялся)
    if(id && !id.startsWith('unknown_')) {
      await apiFetch('rpc/admin_set_user_ban',{method:'POST',body:JSON.stringify({p_user_id:id,p_banned:ban})});
    }
    if(email){
      await apiFetch('rpc/admin_set_profile_name',{method:'POST',body:JSON.stringify({p_email:email,p_name:name})});
      const si=allProfiles.findIndex(p=>p.email===email);
      if(si>=0) allProfiles[si]={...allProfiles[si],display_name:name}; else allProfiles.push({email:email,display_name:name,avatar_url:''});
    }
    toast('Сохранено!','ok');cm('mo-usr');renderApTab();
    if(curSlug==='home' && typeof renderHome==='function') renderHome();
  }catch(e){toast('Ошибка: '+e.message,'err');}
}
// Удаление профиля игрока (сброс имени/аватара). Роль и аккаунт не затрагиваются.
async function deleteUserProfile(){
  if(!user||user.role!=='superadmin'){toast('Только superadmin','err');return;}
  const email=document.getElementById('eu-email').value;
  if(!email){toast('Email неизвестен — профиль удалить нельзя','err');return;}
  if(!confirm(`Удалить профиль «${email}»?\nИмя и аватар будут сброшены (останется только email). Игровой аккаунт и роль не затрагиваются.`)) return;
  try{
    await apiFetch('rpc/admin_delete_profile',{method:'POST',body:JSON.stringify({p_email:email})});
    const si=allProfiles.findIndex(p=>p.email===email);
    if(si>=0) allProfiles.splice(si,1);
    toast('Профиль удалён','ok');cm('mo-usr');renderApTab();
    if(curSlug==='home' && typeof renderHome==='function') renderHome();
  }catch(e){toast('Ошибка: '+e.message,'err');}
}

function askDelChar(slug, name) {
  document.getElementById('del-txt').textContent = `Удалить персонажа «${name}»?\nЭто удалит страницу и все данные персонажа. Необратимо.`;
  document.getElementById('del-ok').onclick = () => execDelChar(slug);
  om('mo-del');
}
async function execDelChar(slug) {
  if (!user || user.role !== 'superadmin') { toast('Только superadmin', 'err'); return; }
  cm('mo-del');
  try {
    const pg = pages.find(p => p.slug === slug);
    if (pg) await dbDel('pages', `id=eq.${pg.id}`);
    const token = await getTokenFresh();
    await fetch(`${SB_URL}/rest/v1/characters?slug=eq.${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token }
    });
    _pgCache.delete(slug);
    toast('Персонаж удалён', 'ok');
    await loadPgs(); buildNav(); renderAp();
    if (curSlug === slug) go('home', false);
  } catch(e) { toast('Ошибка: ' + e.message, 'err'); }
}
function askDel(type,id,name){
  document.getElementById('del-txt').textContent=(type==='page'?`Удалить страницу «${name}»?`:`Удалить раздел «${name}»?`)+'\nЭто необратимо.'; document.getElementById('del-ok').onclick=()=>execDel(type,id); om('mo-del');
}
async function execDel(type,id){
  if(!user||user.role!=='superadmin'){toast('Только superadmin','err');return;}
  cm('mo-del');
  try{ if(type==='page') await dbDel('pages',`id=eq.${id}`); if(type==='section') await dbDel('sections',`id=eq.${id}`); toast('Удалено','ok'); if(type==='page'){await loadPgs();buildNav();renderApTab();go('home');} if(type==='section'){await loadSecs();buildNav();renderApTab();if(curSlug==='home') renderHome();} }catch(e){toast('Ошибка: '+e.message,'err');}
}

async function bmCharImgUpload(input,blockIdx,charIdx){
  const file=input?.files?.[0];if(!file)return;
  await handleImgUpload(file,url=>{
    if(editBlocks[blockIdx]&&editBlocks[blockIdx].chars[charIdx]){
      editBlocks[blockIdx].chars[charIdx].imgUrl=url;
      renderBlockEditor();
    }
  });
}

async function handleImgUpload(file, onUrl) {
  if (!file) return;
  if (!user) { toast('Необходима авторизация','err'); return; }
  const ALLOWED=['image/jpeg','image/png','image/gif','image/webp']; if (!ALLOWED.includes(file.type)) { toast('Только JPEG / PNG / GIF / WebP','err'); return; }
  if (file.size>4*1024*1024) { toast('Файл слишком большой (макс. 4 МБ)','err'); return; }
  toast('Загрузка...','inf');
  try {
    const token = await getTokenFresh(); const ext=({'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp'})[file.type]||'jpg'; const name=`${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
    const r=await fetch(`${SB_URL}/storage/v1/object/wiki-images/${name}`,{ method:'POST', headers:{'apikey':SB_ANON,'Authorization':'Bearer '+token,'Content-Type':file.type,'x-upsert':'true'}, body:file });
    if(r.ok){onUrl(`${SB_URL}/storage/v1/object/public/wiki-images/${name}`);toast('Загружено ✓','ok');return;}
    let errMsg='HTTP '+r.status; try{const e=await r.json();errMsg=e?.error||e?.message||errMsg;}catch{} toast(`Storage: ${errMsg}. Используй URL напрямую или настрой Storage policies.`,'err');
  } catch(e) { toast(`Ошибка: ${e.message}`,'err'); }
  if (file.size>512*1024){toast('Слишком большой для base64. Настрой Storage bucket.','err');return;}
  const reader=new FileReader(); reader.onload=()=>onUrl(reader.result); reader.onerror=()=>toast('Не удалось прочитать файл','err'); reader.readAsDataURL(file);
}

function slugify(s){const m={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'j',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};return s.toLowerCase().split('').map(c=>m[c]!==undefined?m[c]:c).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
function om(id){document.getElementById(id)?.classList.add('open');}
function cm(id){document.getElementById(id)?.classList.remove('open');}
function toast(msg,type='inf'){const el=document.createElement('div');el.className=`toast t${type}`;el.textContent=msg;document.getElementById('toasts').appendChild(el);setTimeout(()=>{el.style.opacity='0';setTimeout(()=>el.remove(),300);},3500);}





// ════════════════════════════════════════════════════════════
// EDITOR HTML: ГРАФ СВЯЗЕЙ
// ════════════════════════════════════════════════════════════
function relGraphEditorHtml(b, i) {
  const isRu = lang==='ru';
  const nodeTypes = ['default','hero','villain','faction','place'];
  const edgeTypes = ['default','ally','enemy','family','subordinate','romantic'];
  return `
<div class="sb-field">
  <label class="sb-fi-label">${isRu?'Заголовок':'Title'}</label>
  <input class="sb-fi" value="${esc(b.title||'')}" oninput="upBlock(${i},'title',this.value)">
</div>
<div class="sb-field-label">${isRu?'Узлы (персонажи/места)':'Nodes (characters/places)'}</div>
${(b.nodes||[]).map((n,k)=>`<div class="sb-timeline-item">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:4px">
    <input class="sb-fi" placeholder="ID (уникальный)" value="${esc(n.id||'')}" oninput="editBlocks[${i}].nodes[${k}].id=this.value;renderBlockEditor()">
    <select class="sb-fi" onchange="editBlocks[${i}].nodes[${k}].type=this.value">
      ${nodeTypes.map(t=>`<option value="${t}"${n.type===t?' selected':''}>${t}</option>`).join('')}
    </select>
  </div>
  <input class="sb-fi" placeholder="${isRu?'Имя / подпись':'Name / label'}" value="${esc(n.label||'')}" oninput="editBlocks[${i}].nodes[${k}].label=this.value" style="margin-bottom:4px">
  <input class="sb-fi" placeholder="${isRu?'Описание (тултип)':'Description (tooltip)'}" value="${esc(n.desc||'')}" oninput="editBlocks[${i}].nodes[${k}].desc=this.value" style="margin-bottom:4px">
  <button class="sb-del-btn" onclick="editBlocks[${i}].nodes.splice(${k},1);refreshBlockPropsPanel()">✕ ${isRu?'Удалить':'Delete'}</button>
</div>`).join('')}
<button class="sb-add-inline" onclick="editBlocks[${i}].nodes.push({id:'n'+Date.now(),label:'',type:'default',desc:''});refreshBlockPropsPanel()">+ ${isRu?'Узел':'Node'}</button>
<div class="sb-field-label" style="margin-top:12px">${isRu?'Связи (рёбра)':'Edges (connections)'}</div>
${(b.edges||[]).map((e,k)=>`<div class="sb-timeline-item">
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px">
    <input class="sb-fi" placeholder="ID от" value="${esc(e.from||'')}" oninput="editBlocks[${i}].edges[${k}].from=this.value">
    <input class="sb-fi" placeholder="ID до" value="${esc(e.to||'')}" oninput="editBlocks[${i}].edges[${k}].to=this.value">
    <input class="sb-fi" placeholder="${isRu?'Метка':'Label'}" value="${esc(e.label||'')}" oninput="editBlocks[${i}].edges[${k}].label=this.value">
    <select class="sb-fi" onchange="editBlocks[${i}].edges[${k}].type=this.value">
      ${edgeTypes.map(t=>`<option value="${t}"${e.type===t?' selected':''}>${t}</option>`).join('')}
    </select>
  </div>
  <button class="sb-del-btn" style="margin-top:4px" onclick="editBlocks[${i}].edges.splice(${k},1);refreshBlockPropsPanel()">✕</button>
</div>`).join('')}
<button class="sb-add-inline" onclick="editBlocks[${i}].edges.push({from:'',to:'',label:'',type:'default'});refreshBlockPropsPanel()">+ ${isRu?'Связь':'Edge'}</button>
<div class="sb-field" style="margin-top:8px;font-size:10px;color:var(--t4);font-family:'JetBrains Mono',monospace;line-height:1.6">
  ${isRu?'Узлы можно перетаскивать в режиме редактора.':'Nodes are draggable in editor mode.'}
</div>`;
}

// ════════════════════════════════════════════════════════════
// EDITOR HTML: ВИЗУАЛЬНЫЙ ТАЙМЛАЙН
// ════════════════════════════════════════════════════════════
function visTimelineEditorHtml(b, i) {
  const isRu = lang==='ru';
  const cats = [
    {v:'default',   ru:'◈ Событие'},
    {v:'character', ru:'◉ Персонаж'},
    {v:'tech',      ru:'⬡ Технология'},
    {v:'war',       ru:'✦ Конфликт'},
    {v:'politics',  ru:'◆ Политика'},
    {v:'disaster',  ru:'▲ Катастрофа'},
    {v:'discovery', ru:'◎ Открытие'},
    {v:'mystery',   ru:'◇ Тайна'},
  ];
  return `
<div class="sb-field">
  <label class="sb-fi-label">${isRu?'Заголовок':'Title'}</label>
  <input class="sb-fi" value="${esc(b.title||'')}" oninput="upBlock(${i},'title',this.value)">
</div>
<div class="sb-field">
  <label class="sb-fi-label">${isRu?'Ориентация':'Orientation'}</label>
  <select class="sb-fi" onchange="upBlock(${i},'orient',this.value)">
    <option value="v"${(b.orient||'v')==='v'?' selected':''}>${isRu?'Вертикальная (рекомендуется)':'Vertical (recommended)'}</option>
    <option value="h"${b.orient==='h'?' selected':''}>${isRu?'Горизонтальная (скролл)':'Horizontal (scroll)'}</option>
  </select>
</div>
<div class="sb-field-label">${isRu?'События':'Events'}</div>
${(b.items||[]).map((it,k)=>`<div class="sb-timeline-item">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:4px">
    <input class="sb-fi" placeholder="${isRu?'Дата / Период RU':'Date RU'}" value="${esc(it.date||'')}" oninput="editBlocks[${i}].items[${k}].date=this.value">
    <input class="sb-fi sb-fi-en" placeholder="Date EN" value="${esc(it.date_en||'')}" oninput="editBlocks[${i}].items[${k}].date_en=this.value">
  </div>
  <textarea class="sb-fi" rows="2" placeholder="${isRu?'Текст RU':'Text RU'}" oninput="editBlocks[${i}].items[${k}].text=this.value">${esc(it.text||'')}</textarea>
  <textarea class="sb-fi sb-fi-en" rows="2" placeholder="Text EN" oninput="editBlocks[${i}].items[${k}].text_en=this.value">${esc(it.text_en||'')}</textarea>
  <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
    <label class="sb-fi-label" style="margin:0;flex-shrink:0">${isRu?'Тип':'Type'}</label>
    <select class="sb-fi" onchange="editBlocks[${i}].items[${k}].category=this.value">
      ${cats.map(c=>`<option value="${c.v}"${(it.category||it.accent||'default')===c.v?' selected':''}>${c.ru}</option>`).join('')}
    </select>
    <button class="sb-del-btn" onclick="editBlocks[${i}].items.splice(${k},1);refreshBlockPropsPanel()">✕</button>
  </div>
</div>`).join('')}
<button class="sb-add-inline" onclick="editBlocks[${i}].items.push({date:'',date_en:'',text:'',text_en:'',category:'default'});refreshBlockPropsPanel()">+ ${isRu?'Событие':'Event'}</button>`;
}

// ════════════════════════════════════════════════════════════
// EDITOR HTML: ГРАФИК
// ════════════════════════════════════════════════════════════
function chartEditorHtml(b, i) {
  const isRu = lang==='ru';
  return `
<div class="sb-field">
  <label class="sb-fi-label">${isRu?'Заголовок':'Title'}</label>
  <input class="sb-fi" value="${esc(b.title||'')}" oninput="upBlock(${i},'title',this.value)">
</div>
<div class="sb-field">
  <label class="sb-fi-label">${isRu?'Тип графика':'Chart type'}</label>
  <select class="sb-fi" onchange="upBlock(${i},'chart_type',this.value)">
    <option value="bar"${(b.chart_type||'bar')==='bar'?' selected':''}>${isRu?'Столбчатый':'Bar'}</option>
    <option value="line"${b.chart_type==='line'?' selected':''}>${isRu?'Линейный':'Line'}</option>
    <option value="pie"${b.chart_type==='pie'?' selected':''}>${isRu?'Круговой':'Pie'}</option>
    <option value="donut"${b.chart_type==='donut'?' selected':''}>${isRu?'Кольцевой':'Donut'}</option>
  </select>
</div>
<div class="sb-field">
  <label class="sb-fi-label">${isRu?'Подписи осей (через запятую)':'Axis labels (comma-separated)'}</label>
  <input class="sb-fi" value="${esc((b.labels||[]).join(','))}" placeholder="А,Б,В,Г" oninput="upBlock(${i},'labels',this.value.split(',').map(s=>s.trim()))">
</div>
<div class="sb-field-label">${isRu?'Серии данных':'Data series'}</div>
${(b.datasets||[]).map((ds,k)=>`<div class="sb-timeline-item">
  <input class="sb-fi" placeholder="${isRu?'Название серии':'Series name'}" value="${esc(ds.label||'')}" oninput="editBlocks[${i}].datasets[${k}].label=this.value" style="margin-bottom:4px">
  <input class="sb-fi" placeholder="${isRu?'Данные через запятую: 10,20,30':'Values: 10,20,30'}" value="${esc((ds.data||[]).join(','))}" oninput="editBlocks[${i}].datasets[${k}].data=this.value.split(',').map(s=>+s.trim()||0)">
  <button class="sb-del-btn" style="margin-top:4px" onclick="editBlocks[${i}].datasets.splice(${k},1);refreshBlockPropsPanel()">✕</button>
</div>`).join('')}
<button class="sb-add-inline" onclick="editBlocks[${i}].datasets.push({label:'',data:[]});refreshBlockPropsPanel()">+ ${isRu?'Серия':'Series'}</button>`;
}

// ══════════════════════════════════════════════════════════════
// ITEM EDITOR — редактор карточки снаряжения
// ══════════════════════════════════════════════════════════════
function enterEditItem(pg) {
  editMode=true; editData={...pg,_origStatus:pg.status||'draft',page_type:'item'};
  document.getElementById('edit-btn').textContent='✖'; document.getElementById('edit-btn').className='tbtn edit-on';
  const raw=pg.content||''; try{editBlocks=JSON.parse(raw);}catch{editBlocks=[];}
  // Обычный редактор — infobox уже создан при создании страницы
  renderEditUI(pg, pT(pg), false);
}

// ══════════════════════════════════════════════════════════════
// ABILITY EDITOR — редактор карточки способности
// ══════════════════════════════════════════════════════════════
function enterEditAbility(pg) {
  editMode=true; editData={...pg,_origStatus:pg.status||'draft',page_type:'ability'};
  document.getElementById('edit-btn').textContent='✖'; document.getElementById('edit-btn').className='tbtn edit-on';
  const raw=pg.content||''; try{editBlocks=JSON.parse(raw);}catch{editBlocks=[];}
  renderEditUI(pg, pT(pg), false);
}

// ══════════════════════════════════════════════════════════════
// CHARACTER SYSTEM
// ══════════════════════════════════════════════════════════════
const CHAR_CLASSES=[['soldier','Солдат'],['pilot','Пилот'],['agent','Агент'],['commander','Командир'],['engineer','Инженер'],['diplomat','Дипломат'],['hacker','Хакер'],['medic','Медик'],['sniper','Снайпер'],['spy','Шпион'],['warlord','Военачальник'],['navigator','Навигатор']];
const GEAR_SLOTS={weapon:{label:'Оружие',max:1,icon:'⚔'},armor:{label:'Броня',max:1,icon:'🛡'},artifact:{label:'Артефакт',max:2,icon:'◈'},consumable:{label:'Расходник',max:3,icon:'⬡'}};
const statMod=v=>Math.floor(((v||10)-10)/2);
const modStr=v=>{const m=statMod(v);return(m>=0?'+':'')+m;};

function calcLevel(ch){
  const start = new Date(ch.play_start||Date.now());
  const isFinished = ch.status==='dead'||ch.status==='retired';
  const end = (isFinished&&ch.play_end) ? new Date(ch.play_end) : new Date();
  const daysPlayed = Math.max(0, Math.floor((end-start)/(1000*60*60*24)));
  const refDays = Math.floor((Date.now()-new Date('2014-01-01'))/(1000*60*60*24));
  return Math.min(20, Math.max(1, Math.round((daysPlayed/refDays)*20)));
}
function charGearSlotsInfo(gear){const c={};(gear||[]).forEach(g=>{c[g.slot]=(c[g.slot]||0)+1;});return Object.entries(GEAR_SLOTS).map(([k,v])=>`${v.icon}${c[k]||0}/${v.max}`).join(' ');}

async function loadCharLib(slug){try{const sec=sections.find(s=>s.slug===slug);if(!sec)return[];return await dbGet('pages',`section=eq.${encodeURIComponent(sec.slug)}&status=eq.published&select=slug,title,title_ru,image_url&order=title.asc`)||[];}catch(e){return[];}}

async function enterEditCharacter(pg){
  editMode=true; editData={...pg,_origStatus:pg.status||'draft',page_type:'character'};
  document.getElementById('edit-btn').textContent='✖'; document.getElementById('edit-btn').className='tbtn edit-on';
  let ch=null;
  try{const r=await dbGet('characters',`slug=eq.${encodeURIComponent(pg.slug)}&select=*&limit=1`);ch=r?.[0]||null;}catch(e){}
  if(!editData) return; // пользователь вышел пока шёл запрос
  if(!ch)ch={slug:pg.slug,name:pT(pg),class:'soldier',faction:'',status:'active',play_start:new Date().toISOString().slice(0,10),owner_email:user?.email||'',stats:{str:10,dex:10,con:10,int:10,wis:10,cha:10},abilities:[],gear:[],extra:{}};
  editData._char=ch;
  const[factions,abLib,itemLib]=await Promise.all([loadCharLib('fraki'),loadCharLib('sposob'),loadCharLib('snaragenie')]);
  if(!editData) return;
  editData._libs={factions,abilities:abLib,items:itemLib};
  renderCharEditUI(pg,ch);
}

// Базовые статы классов (при уровне 1). Каждый уровень +2 очка в главную стату
const CLASS_BASE_STATS = {
  soldier:    {str:15,dex:12,con:14,int:10,wis:10,cha:8},
  pilot:      {str:10,dex:16,con:12,int:12,wis:12,cha:8},
  agent:      {str:10,dex:15,con:10,int:13,wis:12,cha:12},
  commander:  {str:12,dex:10,con:12,int:13,wis:12,cha:14},
  engineer:   {str:10,dex:12,con:12,int:16,wis:12,cha:8},
  diplomat:   {str:8, dex:12,con:10,int:14,wis:12,cha:16},
  hacker:     {str:8, dex:14,con:10,int:16,wis:12,cha:10},
  medic:      {str:10,dex:13,con:12,int:15,wis:13,cha:8},
  sniper:     {str:12,dex:16,con:12,int:12,wis:13,cha:8},
  spy:        {str:10,dex:16,con:10,int:13,wis:12,cha:13},
  warlord:    {str:16,dex:10,con:14,int:10,wis:12,cha:12},
  navigator:  {str:8, dex:14,con:10,int:16,wis:14,cha:8},
};
// Какая стата растёт с уровнем (каждые 4 уровня +1 к первичной)
const CLASS_PRIMARY = {
  soldier:'str', pilot:'dex', agent:'dex', commander:'cha',
  engineer:'int', diplomat:'cha', hacker:'int', medic:'int',
  sniper:'dex', spy:'dex', warlord:'str', navigator:'int',
};

function renderCharEditUI(pg,ch){
  document.getElementById('pg').className='pgi editor-fullscreen';
  const SNAMES={str:'СИЛ',dex:'ЛОВ',con:'ТЕЛ',int:'ИНТ',wis:'МДР',cha:'ХАР'};
  const CLASS_OPTS=[['soldier','Солдат'],['pilot','Пилот'],['agent','Агент'],['commander','Командир'],['engineer','Инженер'],['diplomat','Дипломат'],['hacker','Хакер'],['medic','Медик'],['sniper','Снайпер'],['spy','Шпион'],['warlord','Военачальник'],['navigator','Навигатор']];
  const GEAR_SLOT_DEF={weapon:{label:'⚔ Оружие',max:1},armor:{label:'🛡 Броня',max:1},artifact:{label:'◈ Артефакт',max:2},consumable:{label:'⬡ Расходник',max:3}};
  const classOpts=CLASS_OPTS.map(([v,l])=>`<option value="${v}"${ch.class===v?' selected':''}>${l}</option>`).join('');
  const statusOpts=[['active','Активен'],['retired','На покое'],['dead','Погиб']].map(([v,l])=>`<option value="${v}"${ch.status===v?' selected':''}>${l}</option>`).join('');

  // Factions / abilities / items from wiki
  const facPages  = pages.filter(p=>isVisiblePage(p)&&p.page_type==='faction');
  const abPages   = pages.filter(p=>isVisiblePage(p)&&p.page_type==='ability');
  const itemPages = pages.filter(p=>isVisiblePage(p)&&p.page_type==='item');
  const fOpts     = facPages.map(f=>`<option value="${esc(pT(f))}"${ch.faction===pT(f)?' selected':''}>${esc(pT(f))}</option>`).join('');

  // Level & limits
  const lvl = calcLevel(ch);
  const maxAb     = Math.floor(lvl/2)+2;

  // Auto-stats by class + level — NOT editable by user
  const baseStats = CLASS_BASE_STATS[ch.class||'soldier'] || CLASS_BASE_STATS.soldier;
  const primStat  = CLASS_PRIMARY[ch.class||'soldier'] || 'str';
  const autoStats = {...baseStats};
  // +1 to primary stat every 4 levels
  autoStats[primStat] = Math.min(20, autoStats[primStat] + Math.floor(lvl/4));
  // Save auto-stats back to ch so saveCharEdit persists them
  ch.stats = {...autoStats};

  // Stats display (read-only)
  const statsDisplay = Object.entries(SNAMES).map(([k,l])=>{
    const v=autoStats[k]||10;
    const mod=Math.floor((v-10)/2);
    return `<div style="background:var(--b3);border:1px solid var(--w2);padding:8px;text-align:center">
      <div style="font-family:'Rajdhani',sans-serif;font-size:7px;letter-spacing:2px;color:var(--t4);margin-bottom:4px">${l}${k===primStat?` <span style="color:var(--gdl)">★</span>`:''}</div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:20px;font-weight:900;color:var(--t1)">${v}</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--te)">${mod>=0?'+':''}${mod}</div>
    </div>`;
  }).join('');

  // Gear slot summary
  const gearCount={};(ch.gear||[]).forEach(g=>{gearCount[g.slot]=(gearCount[g.slot]||0)+1;});
  const slotSummary=Object.entries(GEAR_SLOT_DEF).map(([k,v])=>`<span style="font-size:9px;font-family:'JetBrains Mono',monospace;color:${(gearCount[k]||0)>=v.max?'var(--err)':'var(--t4)'}">${v.label} ${gearCount[k]||0}/${v.max}</span>`).join('  ');

  const abRows  = (ch.abilities||[]).map((a,i)=>charAbRow(a,i,abPages)).join('');
  const gearRows= (ch.gear||[]).map((g,i)=>charGearRow(g,i,itemPages)).join('');

  document.getElementById('pg').innerHTML=`<div class="ed-wrap" id="sb-wrap">
<div class="ed-bar">
  <div class="ed-bar-l">
    <div class="ed-status-toggle">
      <button class="ed-st-btn${pg.status==='published'?' on':''}" onclick="setEdStatus('published')"><span class="ed-st-dot pub"></span>Опубл.</button>
      <button class="ed-st-btn${pg.status!=='published'?' on':''}" onclick="setEdStatus('draft')"><span class="ed-st-dot dft"></span>Черновик</button>
    </div>
    <span style="font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:2px;color:var(--te);padding:3px 8px;border:1px solid var(--te)">◈ ПЕРСОНАЖ · УР.${lvl}</span>
  </div>
  <div class="ed-bar-c"><span class="ed-bar-title">${esc(pT(pg))}</span></div>
  <div class="ed-bar-r">
    <button class="ed-btn-cancel" onclick="exitEdit()">Отмена</button>
    <button class="ed-btn-save" onclick="saveCharEdit()">✓ Сохранить</button>
  </div>
</div>
<div style="display:grid;grid-template-columns:1fr 280px;height:calc(100vh - 50px);overflow:hidden">

  <!-- LEFT: main fields -->
  <div style="overflow-y:auto;padding:16px 20px;border-right:1px solid var(--w2)">

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div class="ed-mf"><label class="ed-ml">Имя</label><input class="ed-mi" id="ch-name" value="${esc(pT(pg))}"></div>
      <div class="ed-mf"><label class="ed-ml">Звание / подзаголовок</label><input class="ed-mi" id="ch-subtitle" value="${esc(ch.extra?.subtitle||'')}" placeholder="Командир 3-го флота"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
      <div class="ed-mf">
        <label class="ed-ml">Класс</label>
        <select class="ed-mi" id="ch-class" onchange="if(editData?._char){editData._char.class=this.value;charUpdateAuto();}">
          ${classOpts}
        </select>
      </div>
      <div class="ed-mf"><label class="ed-ml">Статус</label><select class="ed-mi" id="ch-status" onchange="charStatusChanged(this.value)">${statusOpts}</select></div>
      <div class="ed-mf">
        <label class="ed-ml">Начало игры <span style="color:var(--t4);font-size:9px">(= дата вступления)</span></label>
        <input class="ed-mi" type="date" id="ch-start" value="${ch.play_start||''}" oninput="if(editData?._char){editData._char.play_start=this.value;charUpdateAuto();}">
      </div>
    </div>
    <div class="ed-mf" id="ch-end-wrap" style="margin-bottom:10px;display:${(ch.status==='dead'||ch.status==='retired')?'block':'none'}">
      <label class="ed-ml">${ch.status==='dead'?'Дата гибели':'Дата выхода на покой'} <span style="color:var(--t4);font-size:9px">(уровень заморозится на этой дате)</span></label>
      <input class="ed-mi" type="date" id="ch-end" value="${ch.play_end||''}" oninput="if(editData?._char)editData._char.play_end=this.value;">
    </div>
    <div class="ed-mf" style="margin-bottom:10px">
      <label class="ed-ml">Фракция${facPages.length?'':' <span style="color:var(--t4);font-size:9px">(создай страницы типа «Фракция»)</span>'}</label>
      <select class="ed-mi" id="ch-faction" onchange="document.getElementById('ch-faction-c').style.display=this.value==='__custom'?'block':'none';if(this.value!=='__custom'&&editData?._char)editData._char.faction=this.value">
        <option value="">— Нет фракции —</option>${fOpts}<option value="__custom">✎ Ввести вручную...</option>
      </select>
      <input class="ed-mi" id="ch-faction-c" style="margin-top:5px;display:${!facPages.length&&ch.faction?'block':'none'}" placeholder="Название фракции..." value="${esc(ch.faction||'')}" oninput="if(editData?._char)editData._char.faction=this.value">
    </div>
    <div class="ed-mf" style="margin-bottom:10px">
      <label class="ed-ml">Картинка</label>
      <div style="display:flex;gap:8px">
        <input class="ed-mi" id="ch-img" value="${esc(pg.image_url||'')}" placeholder="https://..." style="flex:1" oninput="if(editData)editData.image_url=this.value">
        <label class="ed-btn-cancel" style="cursor:pointer;padding:7px 12px">📁<input type="file" accept="image/*" style="display:none" onchange="charUploadImg(this)"></label>
      </div>
    </div>
    <div class="ed-mf" style="margin-bottom:16px">
      <label class="ed-ml">Биография</label>
      <div class="md-toolbar">
        <button class="mdt" title="Жирный" onclick="mdInsBio('**','**','текст')"><b>B</b></button>
        <button class="mdt" title="Курсив" onclick="mdInsBio('*','*','текст')"><i>I</i></button>
        <button class="mdt" title="Код" onclick="mdInsBio('\`','\`','код')">{ }</button>
        <button class="mdt" title="H2" onclick="mdInsBio('## ','','Заголовок')">H2</button>
        <button class="mdt" title="H3" onclick="mdInsBio('### ','','Заголовок')">H3</button>
        <button class="mdt" title="Список" onclick="mdInsBio('- ','','пункт')">• —</button>
        <button class="mdt" title="Цитата" onclick="mdInsBio('> ','','текст')">"</button>
        <button class="mdt" title="Ссылка" onclick="mdInsBio('[','](https://)','текст')">🔗</button>
        <div class="mdt-sep"></div>
        <button class="mdt" title="Цвет: Золото" style="color:#4e9ed8;border-color:rgba(176,112,48,.4)" onclick="mdInsBio('[c:gold]','[/c]','текст')">Au</button>
        <button class="mdt" title="Цвет: Циан" style="color:#6bb8d4;border-color:rgba(74,127,165,.4)" onclick="mdInsBio('[c:cyan]','[/c]','текст')">Cy</button>
        <button class="mdt" title="Цвет: Красный" style="color:#cc4848;border-color:rgba(168,48,48,.4)" onclick="mdInsBio('[c:red]','[/c]','текст')">Re</button>
        <button class="mdt" title="Цвет: Фиолетовый" style="color:#a070e8;border-color:rgba(112,64,200,.4)" onclick="mdInsBio('[c:purple]','[/c]','текст')">Pu</button>
        <button class="mdt" title="Цвет: Зелёный" style="color:#2a9e62;border-color:rgba(42,158,98,.4)" onclick="mdInsBio('[c:green]','[/c]','текст')">Gr</button>
        <button class="mdt" title="Цвет: Тусклый" style="color:var(--t4)" onclick="mdInsBio('[c:dim]','[/c]','текст')">Di</button>
        <div class="mdt-sep"></div>
        <button class="mdt" title="Bg: Cyber" style="background:rgba(74,127,165,.15);border-color:rgba(74,127,165,.4);color:#6bb8d4" onclick="mdInsBio('[bg:cyber]','[/bg]','текст')">▌Cy</button>
        <button class="mdt" title="Bg: Gold" style="background:rgba(176,112,48,.15);border-color:rgba(176,112,48,.4);color:#4e9ed8" onclick="mdInsBio('[bg:gold]','[/bg]','текст')">▌Au</button>
        <button class="mdt" title="Bg: Danger" style="background:rgba(168,48,48,.15);border-color:rgba(168,48,48,.4);color:#cc4848" onclick="mdInsBio('[bg:danger]','[/bg]','текст')">▌⚠</button>
        <button class="mdt" title="Bg: Lore" style="background:rgba(112,64,200,.15);border-color:rgba(112,64,200,.4);color:#a070e8" onclick="mdInsBio('[bg:lore]','[/bg]','текст')">▌Lr</button>
        <button class="mdt" title="Bg: Redacted" style="background:#111;border-color:#333;color:#555" onclick="mdInsBio('[bg:redacted]','[/bg]','текст')">▌██</button>
        <div class="mdt-sep"></div>
        <button class="mdt" title="FX: Scanner" style="background:linear-gradient(90deg,rgba(74,127,165,.1),rgba(176,112,48,.1));border-color:rgba(176,112,48,.3);font-size:9px;letter-spacing:.5px" onclick="mdInsBio('[fx:scanner]','[/fx]','TEXT')">SCAN</button>
        <button class="mdt" title="FX: Glitch" style="color:#f05;border-color:rgba(255,0,85,.3);font-size:9px;letter-spacing:.5px;text-shadow:1px 0 #0ff,-1px 0 #f05" onclick="mdInsBio('[fx:glitch]','[/fx]','TEXT')">GLITCH</button>
        <button class="mdt" title="FX: Jitter" style="color:var(--t2);border-color:var(--w3);font-size:9px;letter-spacing:.5px" onclick="mdInsBio('[fx:jitter]','[/fx]','TEXT')">JITTER</button>
      </div>
      <textarea class="ed-mi" id="ch-bio" rows="8" style="width:100%;resize:vertical;font-size:13px;line-height:1.7">${esc(ch.extra?.bio||'')}</textarea>
    </div>

    <!-- ABILITIES -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid var(--w2)">
      <span style="font-family:'Rajdhani',sans-serif;font-size:8px;font-weight:700;letter-spacing:3px;color:var(--te)">◈ СПОСОБНОСТИ</span>
      <span id="ch-ab-cnt" style="font-family:'JetBrains Mono',monospace;font-size:9px;color:${(ch.abilities||[]).length>=maxAb?'var(--err)':'var(--t4)'}">${(ch.abilities||[]).length}/${maxAb} (ур.${lvl})</span>
    </div>
    ${!abPages.length?`<div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--t4);margin-bottom:8px;padding:8px;background:var(--b3);border:1px solid var(--w2)">Создай страницы типа «Способность» — они появятся здесь</div>`:''}
    <div id="ch-ab-list">${abRows}</div>
    <button class="btn btn-gh btn-sm" style="margin-top:6px" onclick="charAddAb()">+ Добавить способность</button>

    <!-- GEAR -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 6px;padding-bottom:5px;border-bottom:1px solid var(--w2)">
      <span style="font-family:'Rajdhani',sans-serif;font-size:8px;font-weight:700;letter-spacing:3px;color:var(--te)">◈ СНАРЯЖЕНИЕ</span>
    </div>
    <div class="cs-slot-summary" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px">${slotSummary}</div>
    ${!itemPages.length?`<div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--t4);margin-bottom:8px;padding:8px;background:var(--b3);border:1px solid var(--w2)">Создай страницы типа «Снаряжение» — они появятся здесь</div>`:''}
    <div id="ch-gear-list">${gearRows}</div>
    <button class="btn btn-gh btn-sm" style="margin-top:6px" onclick="charAddGear()">+ Добавить снаряжение</button>

    <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="ed-mf"><label class="ed-ml">Email игрока</label><input class="ed-mi" id="ch-owner" value="${esc(ch.owner_email||user?.email||'')}"></div>
      <div class="ed-mf"><label class="ed-ml">Теги</label><input class="ed-mi" id="ch-tags" value="${esc(pg.tags||'')}" placeholder="командир, империя, герой" oninput="editData.tags=this.value"></div>
    </div>
  </div>

  <!-- RIGHT: auto stats + autoroster -->
  <div style="overflow-y:auto;padding:16px">
    <div style="font-family:'Rajdhani',sans-serif;font-size:8px;font-weight:700;letter-spacing:3px;color:var(--te);margin-bottom:6px">◈ ХАРАКТЕРИСТИКИ</div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--t4);margin-bottom:10px;line-height:1.5">
      Авто по классу и уровню.<br>★ — главная стата класса.
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px" id="ch-stats-display">${statsDisplay}</div>
    <div style="font-family:'Rajdhani',sans-serif;font-size:8px;font-weight:700;letter-spacing:3px;color:var(--te);margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid var(--w2)">◈ АВТОРАСЧЁТ</div>
    <div id="ch-auto"></div>
  </div>
</div></div>`;
  setTimeout(charUpdateAuto, 30);
}

function charStatusChanged(val) {
  if (editData?._char) editData._char.status = val;
  const wrap  = document.getElementById('ch-end-wrap');
  const label = wrap?.querySelector('.ed-ml');
  if (!wrap) return;
  const show = val === 'dead' || val === 'retired';
  wrap.style.display = show ? 'block' : 'none';
  if (label) label.innerHTML = val === 'dead'
    ? 'Дата гибели <span style="color:var(--t4);font-size:9px">(уровень заморозится на этой дате)</span>'
    : 'Дата выхода на покой <span style="color:var(--t4);font-size:9px">(уровень заморозится на этой дате)</span>';
  // Если убрали статус — очищаем play_end
  if (!show && editData?._char) editData._char.play_end = null;
  charUpdateAuto();
}

function charUpdateAuto(){
  if(!editData||!editData._char)return;
  const startEl=document.getElementById('ch-start');
  if(startEl?.value) editData._char.play_start=startEl.value;
  const classEl=document.getElementById('ch-class');
  if(classEl?.value) editData._char.class=classEl.value;
  const ch=editData._char;
  const startYear=ch.play_start?new Date(ch.play_start).getFullYear():new Date().getFullYear();
  const lvl=Math.min(20,Math.max(1,new Date().getFullYear()-startYear+1));
  const pb=Math.ceil(lvl/4)+1;
  const maxAb=Math.floor(lvl/2)+2;

  // Recalculate auto-stats
  const baseStats=(typeof CLASS_BASE_STATS!=='undefined'?CLASS_BASE_STATS:{})[ch.class||'soldier']||{str:10,dex:10,con:10,int:10,wis:10,cha:10};
  const primStat=(typeof CLASS_PRIMARY!=='undefined'?CLASS_PRIMARY:{})[ch.class||'soldier']||'str';
  const autoStats={...baseStats};
  autoStats[primStat]=Math.min(20,(autoStats[primStat]||10)+Math.floor(lvl/4));
  ch.stats={...autoStats};

  // Refresh stats display
  const SNAMES={str:'СИЛ',dex:'ЛОВ',con:'ТЕЛ',int:'ИНТ',wis:'МДР',cha:'ХАР'};
  const statsEl=document.getElementById('ch-stats-display');
  if(statsEl){
    statsEl.innerHTML=Object.entries(SNAMES).map(([k,l])=>{
      const v=autoStats[k]||10;
      const mod=Math.floor((v-10)/2);
      return`<div style="background:var(--b3);border:1px solid var(--w2);padding:8px;text-align:center">
        <div style="font-family:'Rajdhani',sans-serif;font-size:7px;letter-spacing:2px;color:var(--t4);margin-bottom:4px">${l}${k===primStat?` <span style="color:var(--gdl)">★</span>`:''}</div>
        <div style="font-family:'Rajdhani',sans-serif;font-size:20px;font-weight:900;color:var(--t1)">${v}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--te)">${mod>=0?'+':''}${mod}</div>
      </div>`;
    }).join('');
  }

  // Refresh ability counter
  const cnt=document.getElementById('ch-ab-cnt');
  const abUsed=(ch.abilities||[]).length;
  if(cnt){
    cnt.textContent=`${abUsed}/${maxAb} (ур.${lvl})`;
    cnt.style.color=abUsed>=maxAb?'var(--err)':'var(--t4)';
  }

  // Refresh gear slot summary
  const GEAR_SLOT_DEF={weapon:{label:'⚔ Оружие',max:1},armor:{label:'🛡 Броня',max:1},artifact:{label:'◈ Артефакт',max:2},consumable:{label:'⬡ Расходник',max:3}};
  const gearCount={};(ch.gear||[]).forEach(g=>{gearCount[g.slot]=(gearCount[g.slot]||0)+1;});
  const slotEl=document.querySelector('#sb-wrap .cs-slot-summary');
  if(slotEl){
    slotEl.innerHTML=Object.entries(GEAR_SLOT_DEF).map(([k,v])=>`<span style="font-size:9px;font-family:'JetBrains Mono',monospace;color:${(gearCount[k]||0)>=v.max?'var(--err)':'var(--t4)'}">${v.label} ${gearCount[k]||0}/${v.max}</span>`).join('&nbsp;&nbsp;');
  }

  // Autoroster
  const el=document.getElementById('ch-auto');
  if(!el)return;
  const con=Math.floor(((autoStats.con||10)-10)/2);
  const dex=Math.floor(((autoStats.dex||10)-10)/2);
  const str=Math.floor(((autoStats.str||10)-10)/2);
  const wis=Math.floor(((autoStats.wis||10)-10)/2);
  const sign=v=>(v>=0?'+':'')+v;
  const rows=[
    ['Уровень',lvl],
    ['Бонус мастера','+'+pb],
    ['КЗ (база)',10+dex],
    ['ОЖ',`${lvl*(8+con)} (${lvl}d8${sign(con*lvl)})`],
    ['Инициатива',sign(dex)],
    ['Атака ближн.',sign(str)],
    ['Атака дальн.',sign(dex)],
    ['Стойкость',sign(con+pb)],
    ['Рефлексы',sign(dex+pb)],
    ['Воля',sign(wis+pb)],
    ['Макс. способн.',maxAb],
  ];
  el.innerHTML=rows.map(([k,v])=>`<div style="display:grid;grid-template-columns:1fr auto;padding:4px 8px;background:var(--b3);border:1px solid var(--w2);margin-bottom:2px"><span style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--t4);letter-spacing:.5px;text-transform:uppercase">${k}</span><span style="font-family:'Rajdhani',sans-serif;font-size:10px;font-weight:700;color:var(--gdl)">${v}</span></div>`).join('');
}

function charAbRow(a,i,abPages){
  abPages=abPages||pages.filter(p=>isVisiblePage(p)&&p.page_type==='ability');
  const opts=abPages.map(p=>`<option value="${esc(pT(p))}"${a.name===pT(p)?' selected':''}>${esc(pT(p))}</option>`).join('');
  return`<div style="margin-bottom:4px;padding:6px 10px;background:var(--b3);border:1px solid var(--w2);border-left:2px solid rgba(28,100,148,.4);display:flex;align-items:center;gap:8px">
    ${abPages.length
      ?`<select class="ed-mi" style="flex:1;font-size:12px" onchange="if(editData?._char?.abilities)editData._char.abilities[${i}].name=this.value">
          <option value="">— выбрать способность —</option>${opts}
        </select>`
      :`<input class="ed-mi" style="flex:1;font-size:12px" placeholder="Название способности" value="${esc(a.name||'')}" oninput="if(editData?._char?.abilities)editData._char.abilities[${i}].name=this.value">`}
    <button onclick="charRemoveAb(${i})" style="background:none;border:none;color:var(--t4);cursor:pointer;font-size:16px;padding:0 4px;line-height:1;flex-shrink:0">✕</button>
  </div>`;}

function _getItemSlot(name){
  // Try cache first
  const p=pages.find(x=>pT(x)===name&&x.page_type==='item');
  if(!p)return'armor';
  const cached=_pgCache?.get(p.slug);
  if(cached?.content){
    try{
      const blocks=JSON.parse(cached.content);
      const ib=blocks.find(b=>b.type==='infobox');
      if(ib){for(const s of ib.sections||[]){for(const r of s.rows||[]){const k=(r.key||'').toLowerCase().trim();if(k==='слот'||k==='slot'){return(r.val||'armor').toLowerCase().trim();}}}}
    }catch(e){}
  }
  return'armor';
}
async function _applyGearSelection(idx,name){
  if(!editData?._char?.gear)return;
  const GEAR_SLOT_MAX={weapon:1,armor:1,artifact:2,consumable:3};
  // Load page into cache if needed
  const p=pages.find(x=>pT(x)===name&&x.page_type==='item');
  if(p&&!_pgCache.has(p.slug)){
    try{const r=await fetch(`${SB_URL}/rest/v1/pages?slug=eq.${encodeURIComponent(p.slug)}&select=*&limit=1`,{headers:{'apikey':SB_ANON,'Authorization':'Bearer '+getToken()}});if(r.ok){const rows=await r.json();if(rows?.[0])_pgCache.set(p.slug,rows[0]);}}catch(e){}
  }
  const slot=_getItemSlot(name);
  const max=GEAR_SLOT_MAX[slot]||1;
  // Count how many OTHER slots of this type already exist (excluding current idx)
  const usedCount=editData._char.gear.filter((g,i)=>i!==idx&&(g.slot||'armor')===slot).length;
  if(usedCount>=max){
    toast(`Слот «${slot}» заполнен (макс. ${max})`, 'err');
    // Reset this row
    editData._char.gear[idx].name='';
    editData._char.gear[idx].slot='armor';
    const itemPages=pages.filter(p=>isVisiblePage(p)&&p.page_type==='item');
    document.getElementById('ch-gear-list').innerHTML=editData._char.gear.map((g,i)=>charGearRow(g,i,itemPages)).join('');
    charUpdateAuto();
    return;
  }
  editData._char.gear[idx].name=name;
  editData._char.gear[idx].slot=slot;
  const itemPages=pages.filter(pp=>pp.page_type==='item');
  document.getElementById('ch-gear-list').innerHTML=editData._char.gear.map((g,i)=>charGearRow(g,i,itemPages)).join('');
  charUpdateAuto();
}
function charGearRow(g,i,itemPages){
  itemPages=itemPages||pages.filter(p=>isVisiblePage(p)&&p.page_type==='item');
  const SLOT_LABELS={weapon:'⚔ Оружие',armor:'🛡 Броня',artifact:'◈ Артефакт',consumable:'⬡ Расходник'};
  const slotLabel=SLOT_LABELS[g.slot]||g.slot||'—';
  const opts=itemPages.map(p=>`<option value="${esc(pT(p))}"${g.name===pT(p)?' selected':''}>${esc(pT(p))}</option>`).join('');
  return`<div style="margin-bottom:4px;padding:6px 10px;background:var(--b3);border:1px solid var(--w2);display:flex;align-items:center;gap:8px">
    <span style="font-size:10px;color:var(--t4);font-family:'JetBrains Mono',monospace;flex-shrink:0;min-width:80px">${slotLabel}</span>
    ${itemPages.length
      ?`<select class="ed-mi" style="flex:1;font-size:12px" onchange="_applyGearSelection(${i},this.value)">
          <option value="">— выбрать снаряжение —</option>${opts}
        </select>`
      :`<input class="ed-mi" style="flex:1;font-size:12px" placeholder="Название предмета" value="${esc(g.name||'')}" oninput="if(editData?._char?.gear)editData._char.gear[${i}].name=this.value">`}
    <button onclick="charRemoveGear(${i})" style="background:none;border:none;color:var(--t4);cursor:pointer;font-size:16px;padding:0 4px;line-height:1;flex-shrink:0">✕</button>
  </div>`;}

function charAddAb(){
  if(!editData?._char)return;
  if(!editData._char.abilities)editData._char.abilities=[];
  const startYear=editData._char.play_start?new Date(editData._char.play_start).getFullYear():new Date().getFullYear();
  const lvl=Math.min(20,Math.max(1,new Date().getFullYear()-startYear+1));
  const maxAb=Math.floor(lvl/2)+2;
  if(editData._char.abilities.length>=maxAb){toast(`Макс. способностей на ур.${lvl}: ${maxAb}`,'err');return;}
  editData._char.abilities.push({name:'',type:'passive',desc:''});
  const abPages=pages.filter(p=>isVisiblePage(p)&&p.page_type==='ability');
  document.getElementById('ch-ab-list').innerHTML=editData._char.abilities.map((a,i)=>charAbRow(a,i,abPages)).join('');
  charUpdateAuto();
}
function charRemoveAb(i){
  if(!editData?._char?.abilities)return;
  editData._char.abilities.splice(i,1);
  const abPages=pages.filter(p=>isVisiblePage(p)&&p.page_type==='ability');
  document.getElementById('ch-ab-list').innerHTML=editData._char.abilities.map((a,i)=>charAbRow(a,i,abPages)).join('');
  charUpdateAuto();
}
function charAddGear(){
  if(!editData?._char)return;
  if(!editData._char.gear)editData._char.gear=[];
  const GEAR_SLOT_DEF={weapon:{max:1},armor:{max:1},artifact:{max:2},consumable:{max:3}};
  // Check total gear count vs total slots
  const totalMax=Object.values(GEAR_SLOT_DEF).reduce((a,v)=>a+v.max,0);
  if(editData._char.gear.length>=totalMax){toast('Все слоты снаряжения заполнены','err');return;}
  // Find first slot with space
  const gearCount={};editData._char.gear.forEach(g=>{gearCount[g.slot]=(gearCount[g.slot]||0)+1;});
  const freeSlot=Object.entries(GEAR_SLOT_DEF).find(([k,v])=>(gearCount[k]||0)<v.max)?.[0]||'armor';
  editData._char.gear.push({name:'',slot:freeSlot,rarity:'common'});
  const itemPages=pages.filter(p=>isVisiblePage(p)&&p.page_type==='item');
  document.getElementById('ch-gear-list').innerHTML=editData._char.gear.map((g,i)=>charGearRow(g,i,itemPages)).join('');
  charUpdateAuto();
}
function charRemoveGear(i){
  if(!editData?._char?.gear)return;
  editData._char.gear.splice(i,1);
  const itemPages=pages.filter(p=>isVisiblePage(p)&&p.page_type==='item');
  document.getElementById('ch-gear-list').innerHTML=editData._char.gear.map((g,i)=>charGearRow(g,i,itemPages)).join('');
  charUpdateAuto();
}
async function charUploadImg(input){const file=input?.files?.[0];if(!file)return;await handleImgUpload(file,url=>{const f=document.getElementById('ch-img');if(f)f.value=url;editData.image_url=url;});}

async function saveCharEdit(){
  if(!editData?._char){toast('Нет данных персонажа','err');return;}
  const ch=editData._char;
  ch.name=(document.getElementById('ch-name')?.value||'').trim()||pT(editData)||'Персонаж';
  ch.class=document.getElementById('ch-class')?.value||'soldier';
  ch.status=document.getElementById('ch-status')?.value||'active';
  const fv=document.getElementById('ch-faction')?.value||'';
  ch.faction=fv==='__custom'?(document.getElementById('ch-faction-c')?.value||'').trim():(fv||'');
  ch.play_start=document.getElementById('ch-start')?.value||ch.play_start||new Date().toISOString().slice(0,10);
  // play_end — только если статус dead или retired
  const endVal = document.getElementById('ch-end')?.value||'';
  ch.play_end = (ch.status==='dead'||ch.status==='retired') && endVal ? endVal : null;
  ch.owner_email=(document.getElementById('ch-owner')?.value||'').trim()||user?.email||'';
  ch.extra={...ch.extra,
    subtitle:(document.getElementById('ch-subtitle')?.value||'').trim(),
    bio:document.getElementById('ch-bio')?.value||''
  };
  ch.stats=ch.stats||{str:10,dex:10,con:10,int:10,wis:10,cha:10};
  ch.abilities=ch.abilities||[];
  ch.gear=ch.gear||[];
  if(!editData?.slug){toast('Нет slug страницы','err');return;}
  try{
    const now=new Date().toISOString();
    const pageBody={title:ch.name,title_ru:ch.name,content:'[]',page_type:'character',
      status:editData.status||'draft',image_url:editData.image_url||null,exclude_from_collage:editData.exclude_from_collage||false,
      tags:editData.tags||null,
      updated_at:now,section:editData.section||null,parent_slug:editData.parent_slug||null};
    if(editData.id) await dbPatch('pages',`id=eq.${editData.id}`,pageBody);
    else{pageBody.slug=editData.slug;pageBody.created_by=user?.email||'';pageBody.created_at=now;await dbPost('pages',pageBody);}
    const charBody={slug:editData.slug,name:ch.name,class:ch.class,faction:ch.faction||null,
      status:ch.status,play_start:ch.play_start,play_end:ch.play_end||null,
      owner_email:ch.owner_email,stats:ch.stats,abilities:ch.abilities,gear:ch.gear,
      extra:ch.extra,updated_at:now};
    // PATCH if exists, POST if new
    const existing=await dbGet('characters',`slug=eq.${encodeURIComponent(editData.slug)}&select=slug&limit=1`).catch(()=>null);
    const charUrl=`${SB_URL}/rest/v1/characters`;
    const charR=existing?.length
      ?await fetch(`${charUrl}?slug=eq.${encodeURIComponent(editData.slug)}`,{method:'PATCH',headers:{'apikey':SB_ANON,'Authorization':'Bearer '+await getTokenFresh(),'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(charBody)})
      :await fetch(charUrl,{method:'POST',headers:{'apikey':SB_ANON,'Authorization':'Bearer '+await getTokenFresh(),'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(charBody)});
    if(charR&&!charR.ok&&charR.status!==204){
      const errBody=await charR.json().catch(()=>({}));
      const errMsg=errBody?.message||errBody?.error||'HTTP '+charR.status;
      // RLS error — page saved but character table failed
      console.warn('[char] character table error:',errMsg);
      toast('Страница сохранена, но таблица characters: '+errMsg,'err');
    }
    await loadPgs();buildNav();
    const _savedSlug = editData.slug;
    try{_pgCache?.delete(_savedSlug);}catch(e){}
    exitEdit(true);go(_savedSlug,false);
    toast('Персонаж сохранён!','ok');
  }catch(e){toast('Ошибка: '+e.message,'err');}
}

// ══════════════════════════════════════════════════════════════
// ICONS LIBRARY
// ══════════════════════════════════════════════════════════════
const ICONS_BUCKET='ability-icons';let _iconsAll=[];
async function renderIconsTab(b){b.innerHTML=`<div style="margin-bottom:12px"><div style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--te);margin-bottom:8px;text-transform:uppercase">◈ Иконки · ${ICONS_BUCKET}</div><div id="icons-dz" style="border:2px dashed rgba(61,122,160,.3);padding:18px;text-align:center;cursor:pointer;transition:all .2s;margin-bottom:10px;position:relative" ondragover="iconsDzOver(event,1)" ondragleave="iconsDzOver(event,0)" ondrop="iconsDrop(event)"><input type="file" multiple accept="image/*" style="position:absolute;inset:0;opacity:0;cursor:pointer" onchange="iconsUploadFiles(this.files)"><div style="font-size:18px;color:rgba(61,122,160,.4);margin-bottom:5px">⊞</div><div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:2px">Перетащи или кликни · имя файла = название</div></div><div style="display:flex;gap:8px;margin-bottom:8px"><input class="fi" id="icons-search" placeholder="Поиск..." style="flex:1;font-size:11px" oninput="iconsFilter(this.value)"><div id="icons-cnt" style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--te);padding:0 10px;border:1px solid var(--w2);display:flex;align-items:center">—</div></div></div><div id="icons-progress" style="display:none;margin-bottom:8px"><div id="icons-progress-label" style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--te);margin-bottom:3px"></div><div style="height:3px;background:var(--w1)"><div id="icons-progress-bar" style="height:100%;background:var(--te);width:0%;transition:width .3s"></div></div></div><div id="icons-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:3px"></div>`;await iconsLoadGrid();}
async function iconsLoadGrid(){const grid=document.getElementById('icons-grid'),cnt=document.getElementById('icons-cnt');if(!grid)return;try{const r=await fetch(`${SB_URL}/storage/v1/object/list/${ICONS_BUCKET}`,{method:'POST',headers:{'apikey':SB_ANON,'Authorization':'Bearer '+getToken(),'Content-Type':'application/json'},body:JSON.stringify({limit:200,offset:0,sortBy:{column:'name',order:'asc'}})});if(!r.ok){grid.innerHTML=`<div style="grid-column:1/-1;padding:12px;border:1px solid rgba(200,60,60,.3);color:rgba(255,100,100,.8);font-size:10px;line-height:1.7">Бакет <b>${ICONS_BUCKET}</b> не найден.<br>Supabase → Storage → New bucket → <b>${ICONS_BUCKET}</b> (Public ✓)</div>`;return;}const files=await r.json();_iconsAll=Array.isArray(files)?files.filter(f=>f.name&&/\.(png|jpg|jpeg|webp|gif)$/i.test(f.name)):[];if(cnt)cnt.textContent=_iconsAll.length+' иконок';iconsRenderGrid(_iconsAll);}catch(e){if(grid)grid.innerHTML=`<div style="grid-column:1/-1;padding:10px;color:var(--err);font-size:10px">${esc(e.message)}</div>`;}}
function iconsRenderGrid(files){const grid=document.getElementById('icons-grid');if(!grid)return;if(!files.length){grid.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--t4);font-size:9px">Нет иконок</div>`;return;}grid.innerHTML=files.map(f=>{const name=f.name.replace(/\.[^.]+$/,'').replace(/_/g,' ');const url=`${SB_URL}/storage/v1/object/public/${ICONS_BUCKET}/${encodeURIComponent(f.name)}`;return`<div style="position:relative;background:var(--b3);border:1px solid var(--w2);padding:7px 5px 6px;text-align:center;transition:border-color .15s" onmouseenter="this.style.borderColor='var(--te)'" onmouseleave="this.style.borderColor='var(--w2)'"><img src="${esc(url)}" style="width:46px;height:46px;object-fit:cover;display:block;margin:0 auto 4px" onerror="this.style.display='none'"><div style="font-family:'JetBrains Mono',monospace;font-size:7px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(name)}">${esc(name)}</div><button onclick="iconsDelete('${esc(f.name)}')" style="position:absolute;top:2px;right:2px;background:none;border:none;color:var(--t4);font-size:10px;cursor:pointer;padding:1px 3px" onmouseenter="this.style.color='var(--err)'" onmouseleave="this.style.color='var(--t4)'">✕</button></div>`;}).join('');}
function iconsFilter(q){const f=q.toLowerCase().trim();const fl=f?_iconsAll.filter(i=>i.name.toLowerCase().includes(f)):_iconsAll;const cnt=document.getElementById('icons-cnt');if(cnt)cnt.textContent=fl.length+' иконок';iconsRenderGrid(fl);}
function iconsDzOver(e,on){e.preventDefault();const dz=document.getElementById('icons-dz');if(dz)dz.style.borderColor=on?'var(--te)':'rgba(61,122,160,.3)';}
function iconsDrop(e){e.preventDefault();iconsDzOver(e,0);iconsUploadFiles(e.dataTransfer.files);}
async function iconsUploadFiles(files){if(!files?.length)return;const arr=Array.from(files).filter(f=>/\.(png|jpg|jpeg|webp|gif)$/i.test(f.name));if(!arr.length){toast('Только PNG/JPG/WEBP','err');return;}const prog=document.getElementById('icons-progress'),bar=document.getElementById('icons-progress-bar'),lbl=document.getElementById('icons-progress-label');if(prog)prog.style.display='block';const token=getToken();let done=0;for(const file of arr){if(lbl)lbl.textContent=`${file.name} (${done+1}/${arr.length})`;try{const r=await fetch(`${SB_URL}/storage/v1/object/${ICONS_BUCKET}/${encodeURIComponent(file.name)}`,{method:'POST',headers:{'apikey':SB_ANON,'Authorization':'Bearer '+token,'Content-Type':file.type||'image/png','x-upsert':'true'},body:file});if(!r.ok){const e=await r.json().catch(()=>({}));toast(`${file.name}: ${e.message||'ошибка'}`,'err');}}catch(e){toast(`${file.name}: ${e.message}`,'err');}done++;if(bar)bar.style.width=Math.round(done/arr.length*100)+'%';}if(prog)prog.style.display='none';toast(`Загружено ${done} иконок`,'ok');await iconsLoadGrid();await preloadIconsList();}
async function iconsDelete(fn){if(!confirm(`Удалить «${fn}»?`))return;try{const r=await fetch(`${SB_URL}/storage/v1/object/${ICONS_BUCKET}/${encodeURIComponent(fn)}`,{method:'DELETE',headers:{'apikey':SB_ANON,'Authorization':'Bearer '+getToken()}});if(!r.ok&&r.status!==204)throw new Error('HTTP '+r.status);_iconsAll=_iconsAll.filter(f=>f.name!==fn);iconsRenderGrid(_iconsAll);const cnt=document.getElementById('icons-cnt');if(cnt)cnt.textContent=_iconsAll.length+' иконок';toast('Удалено','inf');}catch(e){toast(e.message,'err');}}
function getAbilityIconUrl(name){if(!name||!_iconsAll.length)return null;const q=name.toLowerCase().replace(/\s+/g,'_');const exact=_iconsAll.find(f=>f.name.toLowerCase().replace(/\.[^.]+$/,'').replace(/\s+/g,'_')===q);if(exact)return`${SB_URL}/storage/v1/object/public/${ICONS_BUCKET}/${encodeURIComponent(exact.name)}`;const partial=_iconsAll.find(f=>f.name.toLowerCase().includes(name.toLowerCase().slice(0,4)));if(partial)return`${SB_URL}/storage/v1/object/public/${ICONS_BUCKET}/${encodeURIComponent(partial.name)}`;return null;}
async function preloadIconsList(){try{const r=await fetch(`${SB_URL}/storage/v1/object/list/${ICONS_BUCKET}`,{method:'POST',headers:{'apikey':SB_ANON,'Authorization':'Bearer '+getToken(),'Content-Type':'application/json'},body:JSON.stringify({limit:200,offset:0})});if(!r.ok)return;const f=await r.json();_iconsAll=Array.isArray(f)?f.filter(x=>x.name&&/\.(png|jpg|jpeg|webp|gif)$/i.test(x.name)):[];}catch(e){}}


// ── Background Image Functions ──────────────────────────────────
async function uploadBackgroundImage(input) {
  const file = input?.files?.[0];
  if (!file) return;
  
  await handleImgUpload(file, url => {
    document.getElementById('bg-url').value = url;
  });
}

// ════════════════════════════════════════════════════════════
// SITE SETTINGS HELPERS (DATABASE)
// ════════════════════════════════════════════════════════════

async function getSiteSetting(key) {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/site_settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`,
      { headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + getToken() } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return data?.[0]?.value || null;
  } catch(e) {
    console.warn('Failed to get setting:', key, e);
    return null;
  }
}

async function saveSiteSetting(key, value) {
  try {
    // Сохраняем в кеш для мгновенного применения при следующей загрузке
    localStorage.setItem(key + '_cache', value);
    
    // Проверяем, есть ли уже запись
    const existing = await dbGet('site_settings', `key=eq.${encodeURIComponent(key)}&select=key&limit=1`);
    
    if (existing?.length) {
      // Обновляем существующую
      await dbPatch('site_settings', `key=eq.${encodeURIComponent(key)}`, { value });
    } else {
      // Создаем новую
      await dbPost('site_settings', { key, value });
    }
  } catch(e) {
    throw new Error('Не удалось сохранить настройку: ' + e.message);
  }
}

async function saveBackgroundUrl() {
  const url = document.getElementById('bg-url')?.value?.trim() || '';
  try {
    await saveSiteSetting('wk_background_url', url);
    applyBackgroundImage(url);
    toast('Фон сохранён', 'ok');
  } catch(e) {
    toast('Ошибка: ' + e.message, 'err');
  }
}

async function removeBackgroundUrl() {
  try {
    await saveSiteSetting('wk_background_url', '');
    document.getElementById('bg-url').value = '';
    applyBackgroundImage('');
    renderAp();
    toast('Фон убран', 'inf');
  } catch(e) {
    toast('Ошибка: ' + e.message, 'err');
  }
}

function applyBackgroundImage(url) {
  if (url) {
    document.body.style.setProperty('--bg-image', `url('${url}')`);
  } else {
    document.body.style.removeProperty('--bg-image');
  }
}



// ══════════════════════════════════════════════════════════════
// DEVLOG IMAGE GENERATOR
// ══════════════════════════════════════════════════════════════

async function renderDevlogTab(b) {
  b.innerHTML = `
    <div style="font-family:'Rajdhani',sans-serif;font-size:9px;letter-spacing:2px;color:var(--te);margin-bottom:12px">◈ ГЕНЕРАТОР ДЕВЛОГ-ИЗОБРАЖЕНИЙ</div>
    
    <div class="fg" style="margin-bottom:10px">
      <label class="fl">Название проекта</label>
      <input class="fi" id="devlog-project" value="КЛАССИЧЕСКАЯ ЭРА" placeholder="Название проекта">
    </div>
    
    <div class="fg" style="margin-bottom:10px">
      <label class="fl">Номер дневника</label>
      <input class="fi" id="devlog-number" type="number" value="1" placeholder="1">
    </div>
    
    <div class="fg" style="margin-bottom:10px">
      <label class="fl">Автор</label>
      <input class="fi" id="devlog-author" value="${esc(getDisplayName())}" placeholder="Имя автора">
    </div>
    
    <div class="fg" style="margin-bottom:10px">
      <label class="fl">Фоновое изображение</label>
      <input class="fi" id="devlog-bg" type="url" placeholder="https://..." oninput="updateDevlogBgPreview(this.value)">
    </div>
    
    <div id="devlog-bg-preview" style="margin-bottom:12px;display:none">
      <img id="devlog-bg-preview-img" style="max-width:100%;max-height:200px;border:1px solid var(--w2);border-radius:4px">
    </div>
    
    <input type="file" id="devlog-bg-file" accept="image/*" style="display:none" onchange="uploadDevlogBg(this)">
    <button class="btn btn-gh btn-fw" style="margin-bottom:12px" onclick="document.getElementById('devlog-bg-file').click()">📁 Загрузить изображение</button>
    
    <button class="btn btn-gd btn-fw" style="margin-bottom:16px" onclick="generateDevlogPreview()">🎨 Создать превью</button>
    
    <div id="devlog-preview" style="margin-top:16px;text-align:center"></div>
  `;
}

function updateDevlogBgPreview(url) {
  const previewWrap = document.getElementById('devlog-bg-preview');
  const previewImg = document.getElementById('devlog-bg-preview-img');
  
  if (!url || !url.trim()) {
    previewWrap.style.display = 'none';
    return;
  }
  
  previewImg.src = url;
  previewWrap.style.display = 'block';
}

async function uploadDevlogBg(input) {
  if (!input.files?.[0]) return;
  const file = input.files[0];
  if (file.size > 10 * 1024 * 1024) { toast('Файл слишком большой (макс. 10 МБ)', 'err'); return; }
  
  toast('Загрузка...', 'ok');
  
  try {
    const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const res = await fetch(`${SB_URL}/storage/v1/object/wiki-images/${fileName}`, {
      method: 'POST',
      headers: { 
        'Authorization': 'Bearer ' + getToken(),
        'Content-Type': file.type
      },
      body: file
    });
    
    if (!res.ok) {
      const err = await res.text();
      throw new Error('Ошибка загрузки: ' + err);
    }
    
    const data = await res.json();
    const url = `${SB_URL}/storage/v1/object/public/wiki-images/${fileName}`;
    document.getElementById('devlog-bg').value = url;
    updateDevlogBgPreview(url);
    toast('Изображение загружено', 'ok');
  } catch (e) {
    toast('Ошибка: ' + e.message, 'err');
  }
}

async function generateDevlogPreview() {
  const project = document.getElementById('devlog-project')?.value?.trim() || 'КЛАССИЧЕСКАЯ ЭРА';
  const number = document.getElementById('devlog-number')?.value?.trim() || '1';
  const author = document.getElementById('devlog-author')?.value?.trim() || getDisplayName();
  const bgUrl = document.getElementById('devlog-bg')?.value?.trim() || '';
  
  const previewEl = document.getElementById('devlog-preview');
  if (!previewEl) return;
  
  previewEl.innerHTML = '<div class="sload"><div class="quote-loader">Генерация изображения...</div></div>';
  
  try {
    const blob = await generateDevlogImage(project, number, author, bgUrl);
    const url = URL.createObjectURL(blob);
    
    previewEl.innerHTML = `
      <div style="position:relative;display:inline-block">
        <img src="${url}" style="max-width:100%;border:1px solid var(--w2);box-shadow:0 4px 20px rgba(0,0,0,.5)">
        <button class="btn btn-gd" style="margin-top:12px" onclick="downloadDevlogImage()">💾 Скачать изображение</button>
      </div>
    `;
    
    // Store blob for download
    window._devlogBlob = blob;
    window._devlogFilename = `devlog_${number}_${Date.now()}.jpg`;
  } catch (e) {
    previewEl.innerHTML = `<div style="color:var(--err);font-size:12px">Ошибка: ${esc(e.message)}</div>`;
  }
}

async function generateDevlogImage(project, number, author, bgUrl) {
  const W = 1200, H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  
  // 1. Background
  if (bgUrl && bgUrl.trim()) {
    try {
      const img = await _loadImagePromise(bgUrl);
      // Fill entire canvas with image
      const scale = Math.max(W / img.width, H / img.height);
      const sw = img.width * scale;
      const sh = img.height * scale;
      const sx = (W - sw) / 2;
      const sy = (H - sh) / 2;
      ctx.drawImage(img, sx, sy, sw, sh);
    } catch (e) {
      console.error('Failed to load background:', e);
      _drawDarkBg(ctx, W, H);
    }
  } else {
    _drawDarkBg(ctx, W, H);
  }
  
  // 2. Diagonal lines pattern (на весь холст)
  ctx.save();
  ctx.strokeStyle = 'rgba(232, 185, 72, 0.06)';
  ctx.lineWidth = 1.5;
  const lineSpacing = 25;
  for (let i = -H; i < W + H; i += lineSpacing) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i - H, H);
    ctx.stroke();
  }
  ctx.restore();
  
  // 3. Left panel gradient (dark overlay for text)
  const panelW = W * 0.45;
  const gradLeft = ctx.createLinearGradient(0, 0, panelW, 0);
  gradLeft.addColorStop(0, 'rgba(4,5,10,0.95)');
  gradLeft.addColorStop(0.7, 'rgba(4,5,10,0.85)');
  gradLeft.addColorStop(1, 'rgba(4,5,10,0)');
  ctx.fillStyle = gradLeft;
  ctx.fillRect(0, 0, panelW, H);
  
  // 3. Decorative border
  const pad = 30;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
  
  // Gold corners
  const cornerL = 40;
  const goldColor = '#e8b948';
  ctx.strokeStyle = goldColor;
  ctx.lineWidth = 3;
  [[pad, pad, 1, 1], [W - pad, pad, -1, 1], [pad, H - pad, 1, -1], [W - pad, H - pad, -1, -1]].forEach(([x, y, dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(x + dx * cornerL, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * cornerL);
    ctx.stroke();
  });
  
  // Shadow helper
  const setPremiumText = () => {
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
    ctx.shadowOffsetX = 2;
  };
  const clearShadow = () => {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowOffsetX = 0;
  };
  
  // Simple clean text with strong shadow
  const drawCleanText = (text, x, y, fontSize, fontFamily, colorScheme = 'gold') => {
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    ctx.textAlign = 'left';
    
    const colors = {
      gold: { main: '#e8b948', shadow: 'rgba(0,0,0,0.9)' },
      white: { main: '#ffffff', shadow: 'rgba(0,0,0,0.9)' }
    };
    const color = colors[colorScheme] || colors.gold;
    
    // Strong shadow for readability
    ctx.shadowColor = color.shadow;
    ctx.shadowBlur = fontSize * 0.2;
    ctx.shadowOffsetY = fontSize * 0.08;
    ctx.shadowOffsetX = fontSize * 0.05;
    
    // Draw text
    ctx.fillStyle = color.main;
    ctx.fillText(text, x, y);
    
    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowOffsetX = 0;
  };
  
  // 4. Project name (top left)
  ctx.textBaseline = 'top';
  drawCleanText(project.toUpperCase(), pad + 40, pad + 50, 56, '"Rajdhani", "Arial Black", sans-serif', 'gold');
  
  // 5. "DEV DIARY" label
  drawCleanText('DEV DIARY', pad + 40, pad + 120, 28, '"Rajdhani", "Arial", sans-serif', 'white');
  
  // 6. Number (large, centered vertically)
  ctx.textBaseline = 'middle';
  drawCleanText('#' + number, pad + 40, H / 2 + 10, 220, '"Arial Black", Arial, sans-serif', 'white');
  
  // 7. Russian label (below number)
  ctx.textBaseline = 'top';
  drawCleanText('ДНЕВНИК РАЗРАБОТЧИКА №' + number, pad + 40, H / 2 + 130, 22, '"Arial", sans-serif', 'gold');
  
  // 8. Author (bottom left)
  ctx.textBaseline = 'bottom';
  drawCleanText('◈  ' + author.toUpperCase(), pad + 40, H - pad - 35, 20, '"Arial", sans-serif', 'white');
  
  clearShadow();
  
  return new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.95));
}

function _loadImagePromise(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось загрузить изображение'));
    img.src = url;
    setTimeout(() => reject(new Error('Таймаут загрузки изображения')), 10000);
  });
}

function _drawDarkBg(ctx, w, h) {
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#0a0b12');
  grad.addColorStop(1, '#1a1b22');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function downloadDevlogImage() {
  if (!window._devlogBlob) { toast('Нет изображения для скачивания', 'err'); return; }
  
  const url = URL.createObjectURL(window._devlogBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = window._devlogFilename || 'devlog.jpg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  toast('Изображение скачано', 'ok');
}

// Вставка markdown тегов в биографию
function mdInsBio(before, after, ph) {
  const ta = document.getElementById('ch-bio');
  if (!ta) return;
  ta.focus();
  const s = ta.value.substring(ta.selectionStart, ta.selectionEnd);
  document.execCommand('insertText', false, before + (s || ph) + after);
}


// ════════════════════════════════════════════════════════════
// FAVICON MANAGEMENT (DATABASE)
// ════════════════════════════════════════════════════════════

async function saveFaviconUrl() {
  const url = document.getElementById('favicon-url')?.value?.trim() || '';
  try {
    await saveSiteSetting('wk_favicon_url', url);
    applyFavicon(url);
    toast('Favicon сохранен', 'ok');
    renderAp();
  } catch(e) {
    toast('Ошибка: ' + e.message, 'err');
  }
}

async function removeFaviconUrl() {
  try {
    await saveSiteSetting('wk_favicon_url', '');
    document.getElementById('favicon-url').value = '';
    applyFavicon('');
    toast('Favicon удален', 'ok');
    renderAp();
  } catch(e) {
    toast('Ошибка: ' + e.message, 'err');
  }
}

function applyFavicon(url) {
  const favicon = document.getElementById('favicon');
  if (favicon) {
    favicon.href = url || '';
  }
}

async function uploadFaviconImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    toast('Только изображения', 'err');
    return;
  }
  
  try {
    const fileName = `favicon_${Date.now()}.${file.name.split('.').pop()}`;
    const { data, error } = await sb.storage
      .from('images')
      .upload(fileName, file, { upsert: true });
    
    if (error) throw error;
    
    const url = `${SB_URL}/storage/v1/object/public/images/${fileName}`;
    document.getElementById('favicon-url').value = url;
    
    toast('Иконка загружена', 'ok');
  } catch (e) {
    toast('Ошибка загрузки: ' + e.message, 'err');
  }
}
