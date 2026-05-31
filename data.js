// ════════════════════════════════════════════════════════════
// DATA — loadSecs, loadPgs, routing
// ════════════════════════════════════════════════════════════

// ── Кеш каркаса вики (stale-while-revalidate) ───────────────
// Чтобы сайт открывался МГНОВЕННО из localStorage, а свежие данные
// подгружались в фоне — как на «нормальных» сайтах. Кешируем только
// лёгкие поля (без тяжёлого content) — его догружает go() по странице.
const CACHE_SECS_KEY = 'wk_cache_secs_v1';
const CACHE_PGS_KEY  = 'wk_cache_pgs_v1';

function _cacheSecs() {
  try { localStorage.setItem(CACHE_SECS_KEY, JSON.stringify(sections)); } catch(e) {}
}
function _cachePgs() {
  try {
    const slim = pages.map(p => ({
      id: p.id, slug: p.slug, title: p.title, title_ru: p.title_ru,
      section: p.section, parent_slug: p.parent_slug, status: p.status,
      page_type: p.page_type, sort_order: p.sort_order, created_by: p.created_by,
      updated_at: p.updated_at, created_at: p.created_at, image_url: p.image_url,
      infobox: p.infobox
    }));
    localStorage.setItem(CACHE_PGS_KEY, JSON.stringify(slim));
  } catch(e) {}
}
// Гидрация из кеша до сети — мгновенный первый рендер
function hydrateFromCache() {
  let ok = false;
  try { const s = localStorage.getItem(CACHE_SECS_KEY); if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length) { sections = a; ok = true; } } } catch(e) {}
  try { const p = localStorage.getItem(CACHE_PGS_KEY);  if (p) { const a = JSON.parse(p); if (Array.isArray(a) && a.length) { pages = a; ok = true; } } } catch(e) {}
  // Сеем кеш главной, чтобы renderHome() не ждал сеть на мгновенном кадре
  try {
    if (!_pgCache.has('home')) {
      const hc = localStorage.getItem('wk_home_content');
      if (hc) { const parsed = JSON.parse(hc); if (Array.isArray(parsed) && parsed.length) { _pgCache.set('home', { content: hc, _fromLS: true }); } }
      else { _pgCache.set('home', { content: '[]', _placeholder: true }); } // пустышка → renderHome не блокируется сетью
    }
  } catch(e) {}
  return ok;
}

async function loadSecs() {
  try {
    sections = await dbGet('sections','select=*&order=sort_order.asc,name_ru.asc') || [];
    _cacheSecs();
  } catch(e) {
    console.error('Error loading sections:', e);
    // НЕ затираем sections — оставляем то, что уже есть (из кеша)
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
    _cachePgs();
    const sc = document.getElementById('sb-cnt'); if (sc) sc.textContent = pages.length + (lang==='en'?' pgs':' стр.');
  } catch(e) { /* НЕ затираем pages — оставляем кеш */ }
}

async function loadHomePage() {
  try {
    // Используем dbGet() — он имеет 12-сек таймаут (защита от зависания)
    const rows = await dbGet('pages', 'slug=eq.home&select=*&limit=1');
    if (rows?.length) { _pgCache.set('home', rows[0]); return; }
  } catch(e) {}
  // Fallback: localStorage-кеш с предыдущего визита
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

  // Таймаут 12 с: если сервер не ответил — показываем кнопку «Повторить»
  let _fetchTimedOut = false;
  const _fetchTid = setTimeout(() => {
    if (seq !== _navSeq) return;
    _fetchTimedOut = true;
    setPg(`<div class="sempty" style="gap:12px">
      <div style="font-size:32px;opacity:.2">⏱</div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:12px;letter-spacing:2px;color:var(--t3)">СЕРВЕР НЕ ОТВЕЧАЕТ</div>
      <div style="font-size:12px;color:var(--t4);max-width:280px;text-align:center">Supabase мог уйти в паузу. Попробуйте ещё раз или зайдите позже.</div>
      <button onclick="go('${esc(slug)}',false)" class="btn btn-gh" style="margin-top:4px">↺ Повторить</button>
    </div>`);
  }, 12000);

  try {
    const abort = new AbortController(); _navAbort = abort;
    const r = await fetch(`${SB_URL}/rest/v1/pages?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`, { headers:{'apikey':SB_ANON,'Authorization':'Bearer '+getToken()}, signal:abort.signal });
    clearTimeout(_fetchTid);
    if (_fetchTimedOut || seq!==_navSeq) return; _navAbort = null;
    if (!r.ok) throw new Error('HTTP '+r.status);
    const rows = await r.json();
    if (seq!==_navSeq) return;
    if (!rows?.length) { setPg(`<div class="sempty"><div style="font-size:48px;opacity:.15">◈</div><div style="font-family:Rajdhani,sans-serif;font-size:12px;letter-spacing:2px;margin-top:8px">${T('notFound')}</div></div>`); return; }
    _pgCache.set(slug, rows[0]); await renderPage(rows[0]);
  } catch(e) {
    clearTimeout(_fetchTid);
    if (e.name==='AbortError') return; if (seq!==_navSeq) return;
    setPg(`<div class="sempty" style="gap:12px">
      <div style="font-size:32px;opacity:.2">⚠</div>
      <div style="font-size:13px;color:var(--t2)">${esc(e.message)}</div>
      <button onclick="go('${esc(slug)}',false)" class="btn btn-gh" style="margin-top:4px">↺ Повторить</button>
    </div>`);
  }
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

