// ================================================================
// ADMIN.JS — консоль управления фракциями (суперадмины + эдиторы)
// Все действия идут напрямую через dbGet/dbPost/dbPatch/dbDel;
// SQL не нужен — RLS уже разрешает стаффу писать в любую строку.
// ================================================================

// Экранирование строки для onclick="fn('значение')" — обёртка в одинарные кавычки
const adArg = s => "'" + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

const AD = {
  apps:      [],        // faction_applications (approved)
  ecos:      [],        // faction_economy (all)
  colonies:  [],        // colonies (all)
  buildings: [],        // colony_buildings (all)
  prod:      [],        // unit_production (all)
  systems:   [],        // map_systems (all)
  designs:   [],        // faction_units (all)
  byFid:     new Map(), // fid → { app, eco, colonies[], buildings[], roster[], queue[], designs[], systems[] }
  resInfo:   {},        // resName → { r, icon }
  sel:       null,      // selected faction_id
  subtab:    'treasury',
  sysSearch: '',
  busy:      false,
};

// ── Доступ ──────────────────────────────────────────────────────
function adCanAccess() { return !!(user && ['superadmin', 'editor'].includes(user.role)); }
function adEntry(fid)  { return AD.byFid.get(fid); }
function adNum(n)      { return Number(n || 0).toLocaleString('ru-RU'); }

// ── Загрузка данных ─────────────────────────────────────────────
async function adLoad() {
  const [apps, ecos, cols, blds, prod, systems, designs] = await Promise.all([
    dbGet('faction_applications', 'status=eq.approved&select=faction_id,name,owner_id,owner_email,race,civ_type,system_id,system_name&order=name.asc').catch(() => []),
    dbGet('faction_economy',  'select=*').catch(() => []),
    dbGet('colonies',         'select=*&order=faction_id.asc').catch(() => []),
    dbGet('colony_buildings', 'select=*&order=faction_id.asc').catch(() => []),
    dbGet('unit_production',  'select=*&order=faction_id.asc').catch(() => []),
    dbGet('map_systems',      'select=id,name,faction,planets,x,y').catch(() => []),
    dbGet('faction_units',    'select=*&order=name.asc').catch(() => []),
  ]);

  AD.apps      = apps      || [];
  AD.ecos      = ecos      || [];
  AD.colonies  = cols      || [];
  AD.buildings = blds      || [];
  AD.prod      = prod      || [];
  AD.systems   = systems   || [];
  AD.designs   = designs   || [];

  AD.byFid = new Map();
  AD.apps.forEach(app => {
    AD.byFid.set(app.faction_id, {
      app,
      eco:      AD.ecos.find(e => e.faction_id === app.faction_id) || null,
      colonies: AD.colonies.filter(c => c.faction_id === app.faction_id),
      buildings:AD.buildings.filter(b => b.faction_id === app.faction_id),
      roster:   AD.prod.filter(p => p.faction_id === app.faction_id && p.status === 'done'),
      queue:    AD.prod.filter(p => p.faction_id === app.faction_id && p.status === 'queued'),
      designs:  AD.designs.filter(d => d.faction_id === app.faction_id),
      systems:  AD.systems.filter(s => s.faction === app.faction_id),
    });
  });

  // Карта редкости ресурсов из планет всех систем
  AD.resInfo = {};
  AD.systems.forEach(s => (s.planets || []).forEach(p => (p.resources || []).forEach(r => {
    if (r && r.name && !AD.resInfo[r.name]) AD.resInfo[r.name] = { r: r.r || 'common', icon: r.icon || '◈' };
  })));
}

// ── Рендер ──────────────────────────────────────────────────────
async function adRenderConsole() {
  if (!adCanAccess()) { setPg('<div class="sempty">Нет доступа</div>'); return; }
  setPg('<div class="sload"><div class="pulse-loader"></div></div>');
  try {
    await adLoad();
    adPaint();
  } catch (e) {
    setPg(`<div class="sempty" style="gap:12px;flex-direction:column">
      <div style="font-size:32px;opacity:.2">⏱</div>
      <div style="font-size:13px;color:var(--t2)">Не удалось загрузить консоль</div>
      <div style="font-size:11px;color:var(--t4);max-width:300px;text-align:center">${esc(e.message)}</div>
      <button class="btn btn-gh" onclick="go('admin',false)">↺ Повторить</button>
    </div>`);
  }
}

function adPaint() {
  if (!adCanAccess()) return;
  const totalCols  = AD.colonies.length;
  const totalSys   = AD.systems.filter(s => s.faction).length;
  const totalUnits = AD.prod.filter(p => p.status === 'done').reduce((a, p) => a + (p.qty || 0), 0);
  const fCount     = AD.byFid.size;

  const panel = AD.sel && AD.byFid.has(AD.sel) ? adFacPanel() : '';

  setPg(`<div class="ad-console">
    <div class="ad-header">
      <div>
        <div class="ad-title">🛠 Консоль управления</div>
        <div class="ad-summary">
          <span>Фракций: <b>${fCount}</b></span>
          <span>Колоний: <b>${totalCols}</b></span>
          <span>Систем занято: <b>${totalSys}</b></span>
          <span>Юнитов: <b>${totalUnits}</b></span>
        </div>
      </div>
      <button class="btn btn-gh btn-sm" onclick="adReloadPaint()">↻ Обновить</button>
    </div>
    ${adStatsTable()}
    ${panel}
  </div>`);
}

function adStatsTable() {
  if (!AD.byFid.size) return `<div class="ad-empty">Нет одобренных фракций</div>`;
  const rows = [...AD.byFid.entries()].map(([fid, e]) => {
    const eco = e.eco || {};
    const isSel = AD.sel === fid;
    const hasEco = !!e.eco;
    const researchCount = Array.isArray(eco.research) ? eco.research.length : 0;
    const rosterQty = e.roster.reduce((a, p) => a + (p.qty || 0), 0);
    return `<tr class="ad-row${isSel ? ' sel' : ''}" onclick="adSelectFaction('${esc(fid)}')">
      <td class="ad-fac-cell">
        <div class="ad-fac-title">${esc(e.app.name)}</div>
        <div class="ad-fac-meta">${esc(e.app.race || '—')} · <span class="ad-fac-email">${esc(e.app.owner_email || '—')}</span></div>
      </td>
      <td class="ad-num ${hasEco ? '' : 'ad-no-eco-cell'}">${hasEco ? adNum(eco.gc) : '—'}</td>
      <td class="ad-num">${hasEco ? adNum(eco.science) : '—'}</td>
      <td class="ad-num">${hasEco ? adNum(eco.agents) : '—'}</td>
      <td class="ad-num">${e.colonies.length}</td>
      <td class="ad-num">${e.buildings.length}</td>
      <td class="ad-num">${e.systems.length}</td>
      <td class="ad-num">${rosterQty}</td>
      <td class="ad-num">${researchCount}</td>
    </tr>`;
  }).join('');
  return `<div class="ad-table-wrap">
    <table class="ad-table">
      <thead><tr>
        <th>Фракция / Раса / Владелец</th>
        <th>ГС</th><th>ОН</th><th>Агенты</th>
        <th>Колонии</th><th>Постройки</th><th>Системы</th>
        <th>Юниты</th><th>Технологии</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function adSelectFaction(fid) {
  AD.sel = (AD.sel === fid) ? null : fid;
  AD.subtab = 'treasury';
  AD.sysSearch = '';
  adPaint();
  if (AD.sel) setTimeout(() => document.getElementById('ad-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}
function adSetSubtab(t) { AD.subtab = t; adPaint(); }

function adFacPanel() {
  const e = adEntry(AD.sel);
  if (!e) return '';
  const SUBTABS = [['treasury','💰 Казна'],['resources','📦 Ресурсы'],['research','🔬 Технологии'],['territory','🌐 Территория'],['colonies','🏗 Колонии'],['army','⚔ Армия'],['danger','⚠ Зона риска']];
  const tabBtns = SUBTABS.map(([id, lbl]) => `<button class="ad-stab${AD.subtab===id?' on':''}" onclick="adSetSubtab('${id}')">${lbl}</button>`).join('');
  const bodyMap = { treasury: adTabTreasury, resources: adTabResources, research: adTabResearch, territory: adTabTerritory, colonies: adTabColonies, army: adTabArmy, danger: adTabDanger };
  const renderFn = bodyMap[AD.subtab] || adTabTreasury;
  return `<div class="ad-panel" id="ad-panel">
    <div class="ad-panel-hd">
      <div>
        <div class="ad-panel-title">${esc(e.app.name)}</div>
        <div class="ad-panel-sub">${esc(e.app.faction_id)} · ${esc(e.app.race || '—')} · <a class="ad-link" href="mailto:${esc(e.app.owner_email || '')}">${esc(e.app.owner_email || '—')}</a></div>
      </div>
      <button class="btn btn-gh btn-xs" onclick="adSelectFaction('${esc(AD.sel)}')">✕</button>
    </div>
    <div class="ad-stabs">${tabBtns}</div>
    <div class="ad-tab-body">${renderFn(e)}</div>
  </div>`;
}

// ── Вкладка: Казна ──────────────────────────────────────────────
function adTabTreasury(e) {
  if (!e.eco) return `<div class="ad-no-eco">Экономика не инициализирована. Перейдите в <b>⚠ Зону риска</b> → Создать экономику.</div>`;
  const eco = e.eco;
  const field = (id, label, fld, deltas, negDeltas) => `
    <div class="ad-form-row">
      <label class="ad-lbl">${label}</label>
      <div class="ad-field-row">
        <input class="fi ad-num-input" id="ad-${fld}" type="number" value="${eco[fld] || 0}" min="0">
        ${deltas.map(d => `<button class="btn btn-gh btn-xs" onclick="adDelta('${fld}',${d})">+${d >= 1000 ? (d/1000)+'к' : d}</button>`).join('')}
        ${negDeltas.map(d => `<button class="btn btn-rd btn-xs" onclick="adDelta('${fld}',${-d})">−${d >= 1000 ? (d/1000)+'к' : d}</button>`).join('')}
      </div>
    </div>`;
  return `<div class="ad-form">
    ${field('ad-gc',      'ГС (Галактический Стандарт)', 'gc',      [100,1000,10000], [100,1000])}
    ${field('ad-science', 'ОН (Очки Науки)',             'science', [10,50,100],      [10])}
    ${field('ad-agents',  'Агенты',                      'agents',  [1,5],            [1])}
    <button class="btn btn-gd" onclick="adSetTreasury()" style="margin-top:8px">💾 Установить значения</button>
  </div>`;
}

async function adSetTreasury() {
  if (!AD.sel || AD.busy) return;
  const gc      = Math.max(0, parseInt(document.getElementById('ad-gc')?.value) || 0);
  const science = Math.max(0, parseInt(document.getElementById('ad-science')?.value) || 0);
  const agents  = Math.max(0, parseInt(document.getElementById('ad-agents')?.value) || 0);
  AD.busy = true;
  try {
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { gc, science, agents });
    const e = adEntry(AD.sel); if (e && e.eco) { e.eco.gc = gc; e.eco.science = science; e.eco.agents = agents; }
    toast('Казна обновлена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adDelta(field, delta) {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  const val = Math.max(0, Number(e.eco[field] || 0) + delta);
  AD.busy = true;
  try {
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { [field]: val });
    e.eco[field] = val;
    toast(`${field}: ${adNum(val)}`, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Вкладка: Ресурсы ────────────────────────────────────────────
function adTabResources(e) {
  if (!e.eco) return `<div class="ad-no-eco">Экономика не инициализирована.</div>`;
  const res = e.eco.resources || {};
  const resKeys = Object.keys(res).filter(k => (res[k] || 0) > 0);

  const curRows = resKeys.length
    ? resKeys.map(k => {
        const info = AD.resInfo[k] || {};
        return `<div class="ad-res-row">
          <span class="ad-res-icon">${esc(info.icon || '◈')}</span>
          <span class="ad-res-name">${esc(k)}</span>
          <span class="ad-rarity ad-rarity-${info.r || 'common'}">${info.r || 'common'}</span>
          <input class="fi ad-res-val" id="ad-rv-${esc(k)}" type="number" value="${res[k]}" min="0">
          <button class="btn btn-gh btn-xs" onclick="adUpdateResource(${adArg(k)})">Сохранить</button>
          <button class="btn btn-rd btn-xs" onclick="adZeroResource(${adArg(k)})">✕</button>
        </div>`;
      }).join('')
    : `<div class="ad-empty">Нет ресурсов</div>`;

  const resOpts = Object.keys(AD.resInfo)
    .map(k => `<option value="${esc(k)}">${esc(k)} (${AD.resInfo[k].r || 'common'})</option>`).join('');

  return `<div class="ad-resources">
    <div class="ad-section-title">Текущие ресурсы на складе</div>
    <div class="ad-res-list">${curRows}</div>
    <div class="ad-section-title" style="margin-top:16px">Добавить / пополнить</div>
    <div class="ad-field-row" style="flex-wrap:wrap">
      ${resOpts ? `<select class="fi" id="ad-add-res-name" style="flex:1;min-width:160px">${resOpts}</select>` : `<input class="fi" id="ad-add-res-name" placeholder="Название ресурса" style="flex:1">`}
      <input class="fi" id="ad-add-res-amt" type="number" value="100" min="1" style="width:80px" placeholder="Кол-во">
      <button class="btn btn-gd btn-sm" onclick="adAddResource()">+ Добавить</button>
    </div>
  </div>`;
}

async function adUpdateResource(name) {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  const val = Math.max(0, parseInt(document.getElementById('ad-rv-' + name)?.value) || 0);
  AD.busy = true;
  try {
    const res = { ...(e.eco.resources || {}), [name]: val };
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { resources: res });
    e.eco.resources = res;
    toast(`${name}: ${adNum(val)}`, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adZeroResource(name) {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  AD.busy = true;
  try {
    const res = { ...(e.eco.resources || {}) }; delete res[name];
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { resources: res });
    e.eco.resources = res;
    toast(`${name} убран`, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adAddResource() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) { toast('Нет экономики', 'err'); return; }
  const nameEl = document.getElementById('ad-add-res-name');
  const name = nameEl?.value?.trim();
  const amt  = Math.max(1, parseInt(document.getElementById('ad-add-res-amt')?.value) || 0);
  if (!name) { toast('Выберите / введите ресурс', 'err'); return; }
  AD.busy = true;
  try {
    const res = { ...(e.eco.resources || {}), [name]: (Number(e.eco.resources?.[name] || 0) + amt) };
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { resources: res });
    e.eco.resources = res;
    toast(`+${adNum(amt)} ${name}`, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Вкладка: Технологии ─────────────────────────────────────────
function adTabResearch(e) {
  if (!e.eco) return `<div class="ad-no-eco">Экономика не инициализирована.</div>`;
  const done   = new Set(Array.isArray(e.eco.research) ? e.eco.research : []);
  const active = e.eco.research_active;
  const cat    = (typeof ecBuildResearch === 'function') ? ecBuildResearch() : [];

  const activeHtml = active
    ? `<div class="ad-cap">⏳ Активное: <b>${esc(active)}</b> <button class="btn btn-rd btn-xs" onclick="adClearActive()">Прервать</button></div>` : '';

  const byCat = {};
  cat.forEach(n => { (byCat[n.catLabel] = byCat[n.catLabel] || []).push(n); });
  const nodes = Object.keys(byCat).map(cl => `
    <div class="ad-rs-cat">
      <div class="ad-rs-cat-t">${esc(cl)}</div>
      <div class="ad-rs-grid">
        ${byCat[cl].map(n => {
          const isDone = done.has(n.id);
          return `<div class="ad-rs-node${isDone ? ' done' : ''}">
            <div class="ad-rs-gp">${esc(n.group)}</div>
            <div class="ad-rs-name">${esc(n.name)}</div>
            <button class="btn ${isDone ? 'btn-rd' : 'btn-gd'} btn-xs" onclick="adToggleResearch(${adArg(n.id)})">
              ${isDone ? '✕ Отозвать' : '✓ Выдать'}
            </button>
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');

  return `<div class="ad-research">
    <div class="ad-actions-bar">
      <button class="btn btn-gd btn-sm" onclick="adGrantAllResearch()">✓ Выдать все</button>
      <button class="btn btn-rd btn-sm" onclick="adClearResearch()">✕ Сбросить все</button>
      <span class="ad-rs-count">${done.size} / ${cat.length} изучено</span>
    </div>
    ${activeHtml}
    ${nodes || '<div class="ad-empty">Каталог пуст (constructors.js не загружен)</div>'}
  </div>`;
}

async function adToggleResearch(nodeId) {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  AD.busy = true;
  try {
    const cur = Array.isArray(e.eco.research) ? [...e.eco.research] : [];
    const idx = cur.indexOf(nodeId);
    if (idx >= 0) cur.splice(idx, 1); else cur.push(nodeId);
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { research: cur });
    e.eco.research = cur; adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adGrantAllResearch() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  if (!confirm('Выдать все технологии фракции?')) return;
  const allNodes = (typeof ecBuildResearch === 'function' ? ecBuildResearch() : []).map(n => n.id);
  AD.busy = true;
  try {
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { research: allNodes });
    e.eco.research = allNodes; toast('Все технологии выданы', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adClearResearch() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  if (!confirm('Сбросить все технологии?')) return;
  AD.busy = true;
  try {
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { research: [], research_active: null, research_ready: null });
    e.eco.research = []; e.eco.research_active = null; e.eco.research_ready = null;
    toast('Технологии сброшены', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adClearActive() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || !e.eco) return;
  AD.busy = true;
  try {
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { research_active: null, research_ready: null });
    e.eco.research_active = null; e.eco.research_ready = null;
    toast('Активное исследование прервано', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Вкладка: Территория ─────────────────────────────────────────
function adTabTerritory(e) {
  const myFid = AD.sel;
  const q = (AD.sysSearch || '').toLowerCase();

  const facName = fid => {
    if (!fid) return 'нейтральная';
    const entry = AD.byFid.get(fid);
    return entry ? entry.app.name : fid;
  };

  const sysRow = (s, isOwn) => `<div class="ad-sys-row">
    <span class="ad-sys-name">${esc(s.name || s.id)}</span>
    <span class="ad-sys-owner ${s.faction ? (isOwn ? 'mine' : 'other') : 'neutral'}">${esc(facName(s.faction))}</span>
    <span class="ad-sys-acts">
      ${!isOwn ? `<button class="btn btn-gd btn-xs" onclick="adGrantSystem(${adArg(s.id)})">→ Взять</button>` : ''}
      ${s.faction ? `<button class="btn btn-rd btn-xs" onclick="adReleaseSystem(${adArg(s.id)})">✕ Освободить</button>` : ''}
    </span>
  </div>`;

  const mySystems = e.systems;
  const myRows = mySystems.map(s => sysRow(s, true)).join('') || `<div class="ad-empty">Нет систем</div>`;

  let searchHtml;
  if (q.length >= 2) {
    const results = AD.systems.filter(s => s.faction !== myFid && (s.name || '').toLowerCase().includes(q)).slice(0, 60);
    searchHtml = results.length ? results.map(s => sysRow(s, false)).join('') : `<div class="ad-empty">Ничего не найдено</div>`;
  } else {
    searchHtml = `<div class="ad-hint">Введите ≥ 2 символа для поиска по всем системам</div>`;
  }

  return `<div class="ad-territory">
    <div class="ad-sys-stats">
      <span>У фракции: <b>${mySystems.length}</b> систем</span>
      <span>Всего систем: <b>${AD.systems.length}</b></span>
    </div>
    <div class="ad-section-title">Системы фракции</div>
    <div class="ad-sys-list">${myRows}</div>
    <div class="ad-section-title" style="margin-top:16px">Найти и добавить систему</div>
    <input class="fi" id="ad-sys-q" placeholder="Поиск по названию..." value="${esc(AD.sysSearch || '')}"
      oninput="AD.sysSearch=this.value;adPaint()" style="width:100%;margin-bottom:8px">
    <div class="ad-sys-list">${searchHtml}</div>
  </div>`;
}

async function adGrantSystem(sysId) {
  if (!AD.sel || AD.busy) return;
  AD.busy = true;
  try {
    await dbPatch('map_systems', `id=eq.${encodeURIComponent(sysId)}`, { faction: AD.sel });
    const sys = AD.systems.find(s => s.id === sysId);
    if (sys) {
      const prevFid = sys.faction;
      sys.faction = AD.sel;
      if (prevFid) { const pe = AD.byFid.get(prevFid); if (pe) pe.systems = pe.systems.filter(s => s.id !== sysId); }
      const me = adEntry(AD.sel); if (me && !me.systems.find(s => s.id === sysId)) me.systems.push(sys);
    }
    toast('Система передана фракции', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adReleaseSystem(sysId) {
  if (AD.busy) return;
  AD.busy = true;
  try {
    await dbPatch('map_systems', `id=eq.${encodeURIComponent(sysId)}`, { faction: null });
    const sys = AD.systems.find(s => s.id === sysId);
    if (sys) {
      const prevFid = sys.faction; sys.faction = null;
      if (prevFid) { const pe = AD.byFid.get(prevFid); if (pe) pe.systems = pe.systems.filter(s => s.id !== sysId); }
    }
    toast('Система освобождена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Вкладка: Колонии ────────────────────────────────────────────
function adTabColonies(e) {
  const cols = e.colonies;
  const EC_ORDER_LOCAL  = (typeof EC_ORDER  !== 'undefined') ? EC_ORDER  : ['factory','mining','trade','science','training','intel','military_factory','shipyard'];
  const EC_BUILD_LOCAL  = (typeof EC_BUILD  !== 'undefined') ? EC_BUILD  : {};

  const colCards = cols.map(c => {
    const blds = e.buildings.filter(b => b.colony_id === c.id);
    const used = blds.length, cap = c.cells || 6, full = used >= cap;
    const sys = AD.systems.find(s => s.id === c.system_id);

    const bldRows = blds.map(b => {
      const d = EC_BUILD_LOCAL[b.btype];
      return `<div class="ad-bld-row">
        <span class="ad-bld-name">${d ? esc(d.name) : esc(b.btype)}</span>
        <span class="ad-bld-slots">
          <button class="btn btn-gh btn-xs" onclick="adSetSlots(${adArg(b.id)},${Math.max(1,b.slots_open-1)})" ${b.slots_open<=1?'disabled':''}>−</button>
          <span class="ad-slot-val">${b.slots_open}/6</span>
          <button class="btn btn-gh btn-xs" onclick="adSetSlots(${adArg(b.id)},${Math.min(6,b.slots_open+1)})" ${b.slots_open>=6?'disabled':''}>+</button>
        </span>
        <button class="btn btn-rd btn-xs" onclick="adRemoveBuilding(${adArg(b.id)})">✕</button>
      </div>`;
    }).join('') || `<div class="ad-empty" style="padding:4px 0;font-size:11px">Пусто</div>`;

    const bldOpts = EC_ORDER_LOCAL.map(t => { const d = EC_BUILD_LOCAL[t]; return `<option value="${t}">${d ? esc(d.name) : t}</option>`; }).join('');
    return `<div class="ad-col-card">
      <div class="ad-col-hd">
        <div>
          <span class="ad-col-name">${esc(c.planet_name)}</span>
          <span class="ad-col-sys">${esc(sys ? sys.name : (c.system_id || '?'))}</span>
          <span class="ad-col-type">${esc(c.planet_type || '')}</span>
        </div>
        <span class="ad-col-cells${full ? ' full' : ''}">${used}/${cap} ⬚</span>
      </div>
      <div class="ad-bld-list">${bldRows}</div>
      <div class="ad-col-foot">
        <select id="ad-bsel-${c.id}" class="fi" style="flex:1">${bldOpts}</select>
        <button class="btn btn-gh btn-sm" ${full ? 'disabled' : ''} onclick="adAddBuilding(${adArg(c.id)})">+ Постройка</button>
        <button class="btn btn-rd btn-sm" onclick="adRemoveColony(${adArg(c.id)})">✕ Колонию</button>
      </div>
    </div>`;
  }).join('') || `<div class="ad-empty">Нет колоний</div>`;

  const sysOpts = e.systems.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  return `<div class="ad-colonies">
    <div class="ad-cols-grid">${colCards}</div>
    <div class="ad-section-title" style="margin-top:16px">+ Добавить колонию</div>
    <div class="ad-col-form">
      <select class="fi" id="ad-col-sys" style="min-width:130px">${sysOpts || '<option value="">Нет систем</option>'}</select>
      <input class="fi" id="ad-col-pname" placeholder="Планета" style="flex:1">
      <input class="fi" id="ad-col-ptype" placeholder="Тип" value="Столичный мир" style="flex:1">
      <input class="fi" id="ad-col-cells" type="number" value="6" min="1" max="12" style="width:60px">
      <button class="btn btn-gd btn-sm" onclick="adAddColony()">+ Добавить</button>
    </div>
  </div>`;
}

async function adAddColony() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e) return;
  const sysId  = document.getElementById('ad-col-sys')?.value;
  const pName  = (document.getElementById('ad-col-pname')?.value || '').trim();
  const pType  = (document.getElementById('ad-col-ptype')?.value || '').trim();
  const cells  = Math.max(1, parseInt(document.getElementById('ad-col-cells')?.value) || 6);
  if (!sysId || !pName) { toast('Укажите систему и название планеты', 'err'); return; }
  const ownerId    = (e.eco?.owner_id) || e.app?.owner_id;
  const ownerEmail = (e.eco?.owner_email) || e.app?.owner_email;
  // Snapshot planet resources if the planet exists in map data
  const sys = AD.systems.find(s => s.id === sysId);
  const planet = sys && (sys.planets || []).find(p => p.name === pName);
  const resources = planet && Array.isArray(planet.resources) ? planet.resources.map(r => ({ name: r.name, icon: r.icon, r: r.r })) : [];
  AD.busy = true;
  try {
    const rows = await dbPost('colonies', { faction_id: AD.sel, owner_id: ownerId, system_id: sysId, planet_name: pName, planet_type: pType, cells, terraformed: false, resources });
    if (rows?.[0]) { e.colonies.push(rows[0]); AD.colonies.push(rows[0]); }
    toast('Колония добавлена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adRemoveColony(colId) {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Удалить колонию и все постройки?')) return;
  AD.busy = true;
  try {
    await dbDel('colony_buildings', `colony_id=eq.${colId}`);
    await dbDel('colonies', `id=eq.${colId}`);
    const e = adEntry(AD.sel);
    if (e) { e.buildings = e.buildings.filter(b => b.colony_id !== colId); e.colonies = e.colonies.filter(c => c.id !== colId); }
    AD.buildings = AD.buildings.filter(b => b.colony_id !== colId);
    AD.colonies  = AD.colonies.filter(c => c.id !== colId);
    toast('Колония удалена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adAddBuilding(colId) {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e) return;
  const btype = document.getElementById('ad-bsel-' + colId)?.value; if (!btype) return;
  const d = (typeof EC_BUILD !== 'undefined') ? EC_BUILD[btype] : null;
  const ownerId = (e.eco?.owner_id) || e.app?.owner_id;
  AD.busy = true;
  try {
    const rows = await dbPost('colony_buildings', { colony_id: colId, faction_id: AD.sel, owner_id: ownerId, btype, slots_open: d?.free || 1, tnp_mode: false });
    if (rows?.[0]) { e.buildings.push(rows[0]); AD.buildings.push(rows[0]); }
    toast('Постройка добавлена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adRemoveBuilding(bldId) {
  if (!AD.sel || AD.busy) return;
  AD.busy = true;
  try {
    await dbDel('colony_buildings', `id=eq.${bldId}`);
    const e = adEntry(AD.sel);
    if (e) e.buildings = e.buildings.filter(b => b.id !== bldId);
    AD.buildings = AD.buildings.filter(b => b.id !== bldId);
    toast('Постройка снесена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adSetSlots(bldId, n) {
  if (!AD.sel || AD.busy) return;
  AD.busy = true;
  try {
    await dbPatch('colony_buildings', `id=eq.${bldId}`, { slots_open: n });
    const bld = AD.buildings.find(b => b.id === bldId); if (bld) bld.slots_open = n;
    toast('Слоты: ' + n, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Вкладка: Армия ──────────────────────────────────────────────
function adTabArmy(e) {
  const roster = e.roster;
  const rosterRows = roster.length
    ? roster.map(p => `<div class="ad-unit-row">
        <span class="ad-unit-cat">${esc(p.category || '')}</span>
        <span class="ad-unit-name">${esc(p.unit_name || '—')}</span>
        <span class="ad-unit-qty">×${p.qty || 1}</span>
        <button class="btn btn-rd btn-xs" onclick="adRemoveUnit(${adArg(p.id)})">✕</button>
      </div>`).join('')
    : `<div class="ad-empty">Нет юнитов в ростере</div>`;

  // Faction designs + stock (null faction_id)
  const allDesigns = AD.designs.filter(d => d.faction_id === AD.sel || !d.faction_id);
  const catOrder = ['ship', 'ground', 'aviation', 'division'];
  const bycat = {}; allDesigns.forEach(d => { (bycat[d.category] = bycat[d.category] || []).push(d); });
  const designOptGroups = catOrder.filter(c => bycat[c]).map(c =>
    `<optgroup label="${esc(c)}">${bycat[c].map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</optgroup>`
  ).join('');

  return `<div class="ad-army">
    <div class="ad-section-title">Ростер — готовые юниты</div>
    <div class="ad-unit-list">${rosterRows}</div>
    <div class="ad-section-title" style="margin-top:16px">Выдать юниты</div>
    <div class="ad-field-row" style="flex-wrap:wrap">
      <select class="fi" id="ad-unit-sel" style="flex:2;min-width:160px">
        ${designOptGroups || '<option value="">Нет дизайнов</option>'}
      </select>
      <input class="fi" id="ad-unit-qty" type="number" value="1" min="1" max="999" style="width:72px" placeholder="Кол-во">
      <button class="btn btn-gd btn-sm" onclick="adGrantUnit()">✓ Выдать</button>
    </div>
  </div>`;
}

async function adGrantUnit() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e) return;
  const unitId = document.getElementById('ad-unit-sel')?.value;
  if (!unitId) { toast('Выберите юнит', 'err'); return; }
  const design = AD.designs.find(d => d.id === unitId);
  if (!design) { toast('Дизайн не найден', 'err'); return; }
  const qty = Math.max(1, parseInt(document.getElementById('ad-unit-qty')?.value) || 1);
  const ownerId = (e.eco?.owner_id) || e.app?.owner_id;
  AD.busy = true;
  try {
    const now = new Date().toISOString();
    const rows = await dbPost('unit_production', {
      faction_id: AD.sel, owner_id: ownerId,
      unit_id: design.id, unit_name: design.name, category: design.category,
      line: design.category === 'ship' ? 'shipyard' : 'army',
      weight: 1, qty, status: 'done', ready_at: now
    });
    if (rows?.[0]) { e.roster.push(rows[0]); AD.prod.push(rows[0]); }
    toast(`Выдано: ${design.name} ×${qty}`, 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adRemoveUnit(id) {
  if (!AD.sel || AD.busy) return;
  AD.busy = true;
  try {
    await dbDel('unit_production', `id=eq.${id}`);
    const e = adEntry(AD.sel); if (e) e.roster = e.roster.filter(p => p.id !== id);
    AD.prod = AD.prod.filter(p => p.id !== id);
    toast('Юнит удалён', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Вкладка: Опасная зона ───────────────────────────────────────
function adTabDanger(e) {
  const hasEco = !!e.eco;
  const row = (label, btn) => `<div class="ad-danger-act"><div class="ad-danger-label">${label}</div>${btn}</div>`;
  return `<div class="ad-danger">
    <div class="ad-danger-banner">⚠ Действия в этом разделе необратимы — применять осознанно</div>
    ${!hasEco ? row('Экономика фракции не инициализирована', `<button class="btn btn-gd" onclick="adInitEco()">✚ Создать экономику</button>`) : ''}
    ${row('Обнулить казну (ГС / ОН / Агенты → 0)', `<button class="btn btn-rd" onclick="adZeroTreasury()" ${!hasEco ? 'disabled' : ''}>Обнулить казну</button>`)}
    ${row('Обнулить все ресурсы склада', `<button class="btn btn-rd" onclick="adZeroResources()" ${!hasEco ? 'disabled' : ''}>Обнулить ресурсы</button>`)}
    ${row('Удалить все колонии и постройки фракции', `<button class="btn btn-rd" onclick="adDeleteColonies()">Удалить колонии</button>`)}
    ${row('Удалить весь ростер юнитов', `<button class="btn btn-rd" onclick="adDeleteRoster()">Удалить ростер</button>`)}
    ${row('Удалить строку экономики (казна, исследования, ресурсы)', `<button class="btn btn-rd" onclick="adDeleteEco()" ${!hasEco ? 'disabled' : ''}>Удалить экономику</button>`)}
  </div>`;
}

async function adInitEco() {
  if (!AD.sel || AD.busy) return;
  const e = adEntry(AD.sel); if (!e || e.eco) { toast(e?.eco ? 'Уже инициализировано' : 'Нет фракции', 'inf'); return; }
  AD.busy = true;
  try {
    const rows = await dbPost('faction_economy', {
      faction_id: AD.sel, owner_id: e.app.owner_id, owner_email: e.app.owner_email,
      gc: 0, science: 0, tnp: 0, agents: 0, resources: {}, research: [], last_tick: new Date().toISOString()
    });
    if (rows?.[0]) { e.eco = rows[0]; AD.ecos.push(rows[0]); }
    toast('Экономика создана', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adZeroTreasury() {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Обнулить казну (ГС / ОН / Агенты)?')) return;
  AD.busy = true;
  try {
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { gc: 0, science: 0, agents: 0 });
    const e = adEntry(AD.sel); if (e?.eco) { e.eco.gc = 0; e.eco.science = 0; e.eco.agents = 0; }
    toast('Казна обнулена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adZeroResources() {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Обнулить все ресурсы?')) return;
  AD.busy = true;
  try {
    await dbPatch('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`, { resources: {} });
    const e = adEntry(AD.sel); if (e?.eco) e.eco.resources = {};
    toast('Ресурсы обнулены', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adDeleteColonies() {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Удалить ВСЕ колонии и постройки фракции? Необратимо.')) return;
  AD.busy = true;
  try {
    await dbDel('colony_buildings', `faction_id=eq.${encodeURIComponent(AD.sel)}`);
    await dbDel('colonies',         `faction_id=eq.${encodeURIComponent(AD.sel)}`);
    const e = adEntry(AD.sel); if (e) { e.colonies = []; e.buildings = []; }
    AD.colonies  = AD.colonies.filter(c => c.faction_id !== AD.sel);
    AD.buildings = AD.buildings.filter(b => b.faction_id !== AD.sel);
    toast('Колонии удалены', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adDeleteRoster() {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Удалить весь ростер юнитов фракции? Необратимо.')) return;
  AD.busy = true;
  try {
    await dbDel('unit_production', `faction_id=eq.${encodeURIComponent(AD.sel)}`);
    const e = adEntry(AD.sel); if (e) { e.roster = []; e.queue = []; }
    AD.prod = AD.prod.filter(p => p.faction_id !== AD.sel);
    toast('Ростер удалён', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

async function adDeleteEco() {
  if (!AD.sel || AD.busy) return;
  if (!confirm('Удалить строку экономики? Казна, ресурсы, технологии будут потеряны.')) return;
  AD.busy = true;
  try {
    await dbDel('faction_economy', `faction_id=eq.${encodeURIComponent(AD.sel)}`);
    const e = adEntry(AD.sel); if (e) e.eco = null;
    AD.ecos = AD.ecos.filter(ec => ec.faction_id !== AD.sel);
    toast('Экономика удалена', 'ok'); adPaint();
  } catch (ex) { toast('Ошибка: ' + ex.message, 'err'); }
  finally { AD.busy = false; }
}

// ── Утилиты ─────────────────────────────────────────────────────
async function adReloadPaint() {
  const prev = { sel: AD.sel, subtab: AD.subtab, sysSearch: AD.sysSearch };
  try {
    await adLoad();
    Object.assign(AD, prev);
  } catch (e) { toast('Ошибка обновления: ' + e.message, 'err'); }
  adPaint();
}
