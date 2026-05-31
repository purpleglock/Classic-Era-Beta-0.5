// ════════════════════════════════════════════════════════════
// DATA — loadSecs, loadPgs, routing
// ════════════════════════════════════════════════════════════




async function loadSecs() {
  try { 
    sections = await dbGet('sections','select=*&order=sort_order.asc,name_ru.asc') || []; 
  } catch(e) { 
    console.error('Error loading sections:', e);
    sections = []; 
  }
}
function canSeeDrafts() {
  return user && ['superadmin','editor','moderator'].includes(user.role);
}

async function loadPgs() {
  try {
    const base = 'select=*&order=sort_order.asc,title.asc';
    pages = await dbGet('pages', canSeeDrafts() ? base : base + '&status=eq.published') || [];
    // Парсим инфобокс каждой страницы для быстрого доступа
    pages.forEach(p => {
      if (p.infobox) return;
      try {
        const blocks = JSON.parse(p.content || '[]');
        const ib = blocks.find(b => b.type === 'infobox');
        if (ib) {
          const flat = {};
          (ib.sections||[]).forEach(s => (s.rows||[]).forEach(r => {
            if (r.key) { flat[r.key] = r.val||''; flat[r.key.toLowerCase()] = r.val||''; }
          }));
          p.infobox = flat;
        }
      } catch(e) {}
    });
    const sc = document.getElementById('sb-cnt'); if (sc) sc.textContent = pages.length + (lang==='en'?' pgs':' стр.');
  } catch(e) { pages = []; }
}

async function loadHomePage() {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pages?slug=eq.home&select=*&limit=1`, { headers: { 'apikey':SB_ANON, 'Authorization':'Bearer '+getToken() } });
    if (r.ok) { const rows = await r.json(); if (rows?.length) { _pgCache.set('home', rows[0]); return; } }
  } catch(e) {}
  const lsSaved = localStorage.getItem('wk_home_content');
  if (lsSaved) { try { const parsed = JSON.parse(lsSaved); if (Array.isArray(parsed) && parsed.length) { _pgCache.set('home', { content: lsSaved, _fromLS: true }); } } catch {} }
}

let _navAbort = null, _navSeq = 0, _pushingHash = false;
function route() { if (_pushingHash) return; if (editMode) exitEdit(false); go(location.hash.slice(1)||'home', false); }

async function go(slug, push=true) {
  if (editMode) exitEdit(false);
  // На мобильных закрываем боковое меню при переходе (категория/раздел/страница)
  if (typeof closeMobSb === 'function') closeMobSb();
  if (_navAbort) { _navAbort.abort(); _navAbort=null; }
  const seq = ++_navSeq;

  if (push) { _pushingHash = true; location.hash = '#' + slug; Promise.resolve().then(() => { _pushingHash = false; }); }

  if (slug.startsWith('sec:')) {
    curSlug = slug; const sec = sections.find(s=>s.slug===slug.slice(4));
    setAct(slug); updTopBcSec(sec); updAuthUI(); renderSectionPage(sec); return;
  }

  curSlug = slug; setAct(slug);
  const p = pages.find(x=>x.slug===slug);
  updTopBc(slug, p); updAuthUI();
  
  // Обновляем блок "Близкие по теме" при каждом переходе
  if (typeof renderRelatedArticles === 'function') {
    requestAnimationFrame(() => renderRelatedArticles());
  }

  if (slug==='home') { await renderHome(); return; }
  if (slug==='map') {
    if (typeof renderGalaxyMap === 'function') { await renderGalaxyMap(); }
    else { setPg('<div class="sempty">galaxy_map.js не загружен</div>'); }
    return;
  }
  if (slug==='factions') {
    if (typeof renderFactionsPage === 'function') { await renderFactionsPage(); }
    else { setPg('<div class="sempty">faction_reg.js не загружен</div>'); }
    return;
  }
  if (slug==='faction-new') {
    if (typeof renderFactionWizard === 'function') { await renderFactionWizard(); }
    else { setPg('<div class="sempty">faction_reg.js не загружен</div>'); }
    return;
  }
  if (slug==='armor-config') {
    if (typeof renderArmorConfigPage === 'function') { renderArmorConfigPage(); }
    else { setPg('<div class="sempty">renderArmorConfigPage не найден</div>'); }
    return;
  }
  // ── Конструкторы юнитов фракций ──
  const CN_ROUTES = {
    'constructors': 'cnRenderHub',
    'build-ship': 'cnRenderShip', 'build-ground': 'cnRenderGround',
    'build-aviation': 'cnRenderAviation', 'build-division': 'cnRenderDivision',
  };
  if (CN_ROUTES[slug]) {
    const fn = window[CN_ROUTES[slug]];
    if (typeof fn === 'function') { await fn(); } else { setPg('<div class="sempty">constructors.js не загружен</div>'); }
    return;
  }
  const CN_CATS = { 'cat-ships': 'ship', 'cat-ground': 'ground', 'cat-aviation': 'aviation', 'cat-divisions': 'division' };
  if (CN_CATS[slug]) {
    if (typeof cnRenderCatalog === 'function') { await cnRenderCatalog(CN_CATS[slug]); }
    else { setPg('<div class="sempty">constructors.js не загружен</div>'); }
    return;
  }
  if (slug==='economy') {
    if (typeof ecRenderDashboard === 'function') { await ecRenderDashboard(); }
    else { setPg('<div class="sempty">economy.js не загружен</div>'); }
    return;
  }
  if (slug==='admin') {
    if (typeof adRenderConsole === 'function') { await adRenderConsole(); }
    else { setPg('<div class="sempty">admin.js не загружен</div>'); }
    return;
  }
  if (_pgCache.has(slug)) {
    const cached = _pgCache.get(slug);
    // Проверяем что в кэше полная запись (с content), а не урезанная из liveItems
    if (cached && cached.content !== undefined && cached.content !== null && cached.status !== undefined) {
      await renderPage(cached); return;
    }
    // Иначе удаляем неполную запись и делаем полный фетч
    _pgCache.delete(slug);
  }

  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);

  try {
    const abort = new AbortController(); _navAbort = abort;
    const r = await fetch(`${SB_URL}/rest/v1/pages?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`, { headers:{'apikey':SB_ANON,'Authorization':'Bearer '+getToken()}, signal:abort.signal });
    if (seq!==_navSeq) return; _navAbort = null;
    if (!r.ok) throw new Error('HTTP '+r.status);
    const rows = await r.json();
    if (seq!==_navSeq) return;
    if (!rows?.length) { setPg(`<div class="sempty"><div style="font-size:48px;opacity:.15">◈</div><div style="font-family:Rajdhani,sans-serif;font-size:12px;letter-spacing:2px;margin-top:8px">${T('notFound')}</div></div>`); return; }
    _pgCache.set(slug, rows[0]); await renderPage(rows[0]);
  } catch(e) { if (e.name==='AbortError') return; if (seq!==_navSeq) return; setPg(`<div class="sempty"><div>${esc(e.message)}</div></div>`); }
}
function setPg(html) {
  const el=document.getElementById('pg');
  el.className='pgi';
  el.innerHTML=html;
  setTimeout(()=>{
    // Battle maps
    el.querySelectorAll('[data-bm]').forEach(svgEl=>{
      const bid=svgEl.id?.replace('bm-svg-','');
      if(bid&&!_bmStates[bid])bmInit(bid);
    });
    // Relation graphs
    el.querySelectorAll('.blk-rg-canvas[data-nodes]').forEach(canvas=>{
      try {
        const nodes = JSON.parse(canvas.dataset.nodes || '[]');
        const edges = JSON.parse(canvas.dataset.edges || '[]');
        if (canvas.id) initRelGraph(canvas.id, nodes, edges);
      } catch(e) { console.error('relgraph init', e); }
    });
    // Charts
    el.querySelectorAll('.blk-chart-canvas[data-chart]').forEach(canvas=>{
      try {
        const d = JSON.parse(canvas.dataset.chart);
        if (canvas.id) initWikiChart(canvas.id, d);
      } catch(e) { console.error('chart init', e); }
    });
  }, 80);
}

