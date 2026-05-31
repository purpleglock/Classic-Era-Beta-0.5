// ════════════════════════════════════════════════════════════
// ECONOMY — экономический слой (колонизация · застройка · доход)
// Данные: Supabase (faction_economy / colonies / colony_buildings),
//         RPC economy_init / economy_tick (см. _economy_setup.sql).
// Доступ: одобренная анкета государства ИЛИ superadmin/editor.
// Зависит от: core.js (dbGet/dbPost/dbPatch/dbDel, SB_URL/SB_ANON, getTokenFresh, esc, toast, setPg, go),
//             auth.js (user), faction_reg.js (frReadable)
// ════════════════════════════════════════════════════════════

const EC = { app: null, myAppUid: null, fid: null, eco: null, colonies: [], buildings: [], systems: [], designs: [], roster: [], queue: [], allSystems: [], lanes: [], factions: [], routes: [], loans: [], missions: [], tab: 'colonies', busy: false };
const EC_CLAIM_COST = 3000, EC_CLAIM_CD_DAYS = 7;
// Ресурсы планет: цена продажи и добыча/слот по редкости
const EC_RES_PRICE = { common: 2, uncommon: 5, rare: 12, epic: 30, legendary: 80 };
const EC_RES_RATE = { common: 25, uncommon: 12, rare: 5, epic: 2, legendary: 1 };
const EC_DEST_CUT = 0.33;
function ecResPrice(r) { return EC_RES_PRICE[r] || EC_RES_PRICE.common; }
function ecResRarity(name) { return (EC.resInfo && EC.resInfo[name] && EC.resInfo[name].r) || 'common'; }
function ecResIcon(name) { return (EC.resInfo && EC.resInfo[name] && EC.resInfo[name].icon) || '◈'; }

const ecId = id => document.getElementById(id);
const ecNum = n => Number(n || 0).toLocaleString('ru-RU');
const ecReadable = c => (typeof frReadable === 'function') ? frReadable(c) : (c || '#cfe3ff');

// Каталог зданий — зеркало _economy_setup.sql (для цен и превью дохода; источник истины дохода — RPC)
const EC_BUILD = {
  factory:          { name: 'Гражданская фабрика', cost: 500,  ladder: [0, 0, 500, 1500, 1500, 3000], free: 2, inc: { gc: 100 }, cat: 'civ', desc: '+100 ГС за слот' },
  mining:           { name: 'Добывающий завод',    cost: 500,  ladder: [0, 0, 500, 1500, 1500, 3000], free: 2, inc: { gc: 100 }, cat: 'civ', desc: '+100 ГС за слот' },
  trade:            { name: 'Торговый хаб',         cost: 1000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: { gc: 100 }, cat: 'civ', desc: '+100 ГС за слот (торговый путь)' },
  science:          { name: 'Научный Институт',     cost: 1000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: { science: 1 }, cat: 'mil', desc: '+1 ОН за слот' },
  training:         { name: 'Центр Подготовки',     cost: 500,  ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'mil', desc: '1 слот = 1000 пехоты' },
  intel:            { name: 'Центр Спецслужб',      cost: 3000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'mil', desc: '1 слот = 1 агент' },
  military_factory: { name: 'Военный Завод',        cost: 1000, ladder: [0, 500, 500, 1500, 1500, 300], free: 1, inc: {}, cat: 'mil', desc: '1 слот = техника' },
  shipyard:         { name: 'Корабельная Верфь',    cost: 2000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'mil', desc: '1 слот = 1 корабль / 12 МЛА' },
};
const EC_ORDER = ['factory', 'mining', 'trade', 'science', 'training', 'intel', 'military_factory', 'shipyard'];
const EC_COLONIZE_COST = 400, EC_TERRAFORM_COST = 1000, EC_TERRAFORM_CELLS = 3, EC_MAX_SLOTS = 6, EC_DEFAULT_CELLS = 6;

// ── Расы → родные группы планет (дефолт, правится) ──────────
const EC_HAB = {
  'Гуманоиды': ['terrestrial'],
  'Млекопитающие': ['terrestrial', 'oceanic'],
  'Рептилоиды': ['desert', 'volcanic', 'terrestrial'],
  'Авианы (Птицеподобные)': ['terrestrial', 'desert'],
  'Инсектоиды': ['terrestrial', 'desert', 'volcanic'],
  'Акватики (Водные)': ['oceanic'],
  'Плантоиды (Растениевидные)': ['terrestrial', 'oceanic'],
  'Литоиды (Каменные)': ['micro', 'lava', 'desert'],
  'Синтетики / Киборги': ['terrestrial', 'desert', 'cryo', 'micro', 'lava', 'volcanic', 'exotic'],
  'Энергетические сущности': ['exotic', 'cryo', 'lava'],
};
const EC_GRP_LABEL = { lava: 'Лавовые', volcanic: 'Вулканические', terrestrial: 'Землеподобные', oceanic: 'Океанические', desert: 'Пустынные', cryo: 'Криомиры', gasgiant: 'Газовый гигант', icegiant: 'Ледяной гигант', hotgiant: 'Горячий гигант', exotic: 'Экзотическая', micro: 'Малое тело', anomaly: 'Аномалия', belt: 'Пояс', unknown: 'Неизвестно' };
// type = имя группы (генератор)
const EC_GRP_NAME = { 'Лавовые миры': 'lava', 'Вулканические': 'volcanic', 'Землеподобные': 'terrestrial', 'Океанические': 'oceanic', 'Пустынные': 'desert', 'Криомиры': 'cryo', 'Газовые гиганты': 'gasgiant', 'Ледяные гиганты': 'icegiant', 'Горячие гиганты': 'hotgiant', 'Экзотические': 'exotic', 'Малые тела': 'micro', 'Аномалии': 'anomaly' };
// фолбэк: имя планеты → группа (сид-данные/старый формат)
const EC_PLANET_NAME = { 'Катархей': 'lava', 'Мёртвая планета': 'lava', 'Супервулканическая планета': 'volcanic', 'Хтонический мир': 'lava', 'Горячий Юпитер': 'hotgiant', 'Горячий Нептун': 'hotgiant', 'Железный мир': 'lava', 'Дастория': 'volcanic', 'Литара': 'desert', 'Океаническая суперземля': 'exotic', 'Рыхлый гигант': 'gasgiant', 'Железный карлик': 'terrestrial', 'Духлесс': 'volcanic', 'Терра': 'terrestrial', 'Суперземля': 'terrestrial', 'Гикеан': 'oceanic', 'Панталассическая планета': 'oceanic', 'Теракрон': 'terrestrial', 'Мини-Нептун': 'gasgiant', 'Водный Юпитер': 'gasgiant', 'Тундровая планета': 'terrestrial', 'Псамора': 'oceanic', 'Мир дюн': 'desert', 'Гельвард': 'cryo', 'Турмион': 'gasgiant', 'Ледяной гигант': 'icegiant', 'Аммиачный мир': 'cryo', 'Газовый карлик': 'gasgiant', 'Метановый мир': 'cryo', 'Суперюпитер': 'gasgiant', 'Коричневый карлик': 'gasgiant', 'Планета-сирота': 'exotic', 'Углеродная планета': 'cryo', 'Тёмный замёрзший мир': 'cryo', 'Карликовая планета': 'micro', 'Мегаастероид': 'micro', 'Пустошь': 'anomaly', 'Кротовая нора': 'anomaly', 'Токсичный карлик': 'anomaly' };
const EC_NOCOL = new Set(['gasgiant', 'icegiant', 'hotgiant', 'anomaly', 'belt']);
function ecPlanetGroup(p) {
  if (!p) return 'unknown';
  if (p.kind === 'belt') return 'belt';
  if (p.kind === 'anomaly') return 'anomaly';
  const t = (p.type || '').trim();
  if (EC_GRP_NAME[t]) return EC_GRP_NAME[t];
  if (EC_PLANET_NAME[t]) return EC_PLANET_NAME[t];
  if (EC_PLANET_NAME[(p.name || '').trim()]) return EC_PLANET_NAME[(p.name || '').trim()];
  return 'unknown';
}
function ecColonizable(p) { return !EC_NOCOL.has(ecPlanetGroup(p)); }
function ecNative(p, race) { return (EC_HAB[race] || []).includes(ecPlanetGroup(p)); }

// ── Производство ────────────────────────────────────────────
const EC_BLD_LABEL = { training: 'Центр Подготовки', military_factory: 'Военный Завод', shipyard: 'Корабельная Верфь' };
const EC_VEH_WEIGHT = { tank_light: 1, tank_mbt: 2, tank_heavy: 4, tank_walker: 4, btr_wheel: 1, bmp_track: 2, btr_hover: 1, art_mortar: 1, art_sau: 2, art_rszo: 2, art_laser: 4 };
const EC_GROUND_WEIGHT = { light: 1, medium: 2, artillery: 2, heavy: 4, walker: 4 };
function ecUnitWeight(u) { return EC_GROUND_WEIGHT[(u && u.data && u.data.class) || ''] || 2; }
function ecSlotsSum(t) { return EC.buildings.filter(b => b.btype === t).reduce((a, b) => a + (b.slots_open || 0), 0); }
function ecCaps() {
  const tr = ecSlotsSum('training'), mf = ecSlotsSum('military_factory'), sy = ecSlotsSum('shipyard');
  return { training: tr * 1000, military: mf * 100, ships: sy, mla: sy * 12, hasTraining: tr > 0, hasMil: mf > 0, hasShipyard: sy > 0 };
}
function ecPendingUse() {
  let ships = 0;
  EC.queue.forEach(q => { if (q.category === 'ship') ships += q.qty; });
  return { ships };
}
function ecHasBuilding(bt) { return EC.buildings.some(b => b.btype === bt); }
// Имя компонента состава дивизии (сток или зарегистрированная техника)
function ecDivCompName(modelId) {
  if ((modelId || '').indexOf('tech:') === 0) { const u = EC.designs.find(d => d.id === modelId.slice(5)); return u ? u.name : 'техника'; }
  const m = (typeof CN_DIV_DATA !== 'undefined') ? CN_DIV_DATA.find(x => x.id === modelId) : null;
  return m ? m.name : (modelId || '—');
}
// Какие здания нужны под состав дивизии: пехота→Подготовка, техника→Воензавод, корабль→Верфь
function ecDivReqBuildings(div) {
  const blocks = (div.data && div.data.blocks) || [];
  const need = new Set();
  blocks.forEach(b => {
    const id = b.modelId || '';
    if (id.indexOf('tech:') === 0) {
      const u = EC.designs.find(d => d.id === id.slice(5));
      const cat = u ? u.category : 'ground';
      need.add(cat === 'ship' ? 'shipyard' : 'military_factory');
    } else {
      const m = (typeof CN_DIV_DATA !== 'undefined') ? CN_DIV_DATA.find(x => x.id === id) : null;
      need.add((m && m.type === 'inf') ? 'training' : 'military_factory');
    }
  });
  return [...need];
}

// ── Доступ / фракция ────────────────────────────────────────
function ecIsStaff() { return !!(user && ['superadmin', 'editor'].includes(user.role)); }
async function ecLoadApp() {
  if (!user) { EC.app = null; EC.myAppUid = null; return null; }
  if (EC.myAppUid === user.id) return EC.app;
  try {
    const rows = await dbGet('faction_applications', `owner_id=eq.${user.id}&status=eq.approved&order=updated_at.desc&limit=1`);
    EC.app = (rows && rows[0]) ? rows[0] : null;
  } catch (e) { EC.app = null; }
  EC.myAppUid = user.id;
  return EC.app;
}
function ecCanAccess() { return !!(user && (ecIsStaff() || (EC.myAppUid === user.id && EC.app && EC.app.faction_id))); }
let _ecNavLoading = false;
function ecNavEnsure() {
  if (!user || ecIsStaff() || EC.myAppUid === user.id || _ecNavLoading) return;
  _ecNavLoading = true;
  ecLoadApp().finally(() => { _ecNavLoading = false; if (typeof buildNav === 'function') buildNav(); });
}

async function ecRpc(fn, body) {
  const token = await getTokenFresh();
  // Таймаут 18 с — сырой fetch без AbortController вешал страницу
  // насмерть, если Supabase «просыпался» (cold start).
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 18000);
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!r.ok) { const t = await r.text(); throw new Error(t || ('HTTP ' + r.status)); }
    if (r.status === 204) return null;
    return r.json();
  } catch (e) {
    clearTimeout(tid);
    if (e.name === 'AbortError') throw new Error('сервер не ответил вовремя');
    throw e;
  }
}

// ── Точка входа (#economy) ──────────────────────────────────
async function ecRenderDashboard() {
  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);
  await ecLoadApp();
  if (!ecCanAccess()) { ecGate(); return; }
  if (!EC.app || !EC.app.faction_id) {
    setPg(`<div class="ec-gate"><div class="ec-gate-ico">💰</div>
      <h2>Экономика государства</h2>
      <p>Экономика привязана к одобренной фракции. У вашего аккаунта нет одобренной анкеты — создайте и проведите её через модерацию.</p>
      <button class="btn btn-gd" onclick="go('factions')">К фракциям</button></div>`);
    return;
  }
  try {
    await ecRpc('economy_init');
    const tick = await ecRpc('economy_tick');
    if (tick && tick.days >= 1) {
      const parts = [];
      if (tick.income.gc) parts.push(`+${ecNum(tick.income.gc * tick.days)} ГС`);
      if (tick.income.science) parts.push(`+${ecNum(tick.income.science * tick.days)} ОН`);
      if (tick.income.tnp) parts.push(`+${ecNum(tick.income.tnp * tick.days)} ТНП`);
      if (parts.length) toast(`Доход за ${tick.days} сут.: ${parts.join(' · ')}`, 'ok');
    }
    await ecLoad();
    ecPaintCabinet();
  } catch (e) {
    // Никакого вечного спиннера — показываем причину и кнопку повтора
    setPg(`<div class="ec-wrap"><div class="sempty" style="gap:12px;flex-direction:column">
      <div style="font-size:32px;opacity:.2">⏱</div>
      <div style="font-size:13px;color:var(--t2)">Не удалось загрузить экономику</div>
      <div style="font-size:11px;color:var(--t4);max-width:320px;text-align:center">${esc(e.message)}<br>Если повторяется — возможно, не выполнен _economy_setup.sql, либо сервер ещё «просыпается».</div>
      <button class="btn btn-gh" onclick="go('economy',false)">↺ Повторить</button>
    </div></div>`);
  }
}

function ecGate() {
  setPg(`<div class="ec-gate">
    <div class="ec-gate-ico">💰</div>
    <h2>Экономика государства</h2>
    <p>Доступно игрокам с одобренной анкетой государства и администрации.</p>
    ${user
      ? `<button class="btn btn-gd" onclick="go('factions')">К фракциям</button>`
      : `<button class="btn btn-gd" onclick="showAuth('login')">Войти</button>`}
  </div>`);
}

async function ecLoad() {
  EC.fid = EC.app.faction_id;
  const fid = encodeURIComponent(EC.fid);
  const [ecoRows, cols, blds, sys, designs, prod, allSys, lanes, facs, routes, loans, missions] = await Promise.all([
    dbGet('faction_economy', `faction_id=eq.${fid}`),
    dbGet('colonies', `faction_id=eq.${fid}&order=created_at.asc`).catch(() => []),
    dbGet('colony_buildings', `faction_id=eq.${fid}&order=created_at.asc`).catch(() => []),
    dbGet('map_systems', `faction=eq.${fid}&select=id,name,planets`).catch(() => []),
    dbGet('faction_units', `or=(faction_id.eq.${fid},faction_id.is.null)&order=name.asc`).catch(() => []),
    dbGet('unit_production', `faction_id=eq.${fid}&order=created_at.desc`).catch(() => []),
    dbGet('map_systems', `select=id,name,faction,x,y`).catch(() => []),
    dbGet('map_hyperlanes', `select=a_id,b_id`).catch(() => []),
    dbGet('faction_applications', `status=eq.approved&select=faction_id,name&order=name.asc`).catch(() => []),
    dbGet('trade_routes', `order=created_at.desc`).catch(() => []),
    dbGet('loans', `order=created_at.desc`).catch(() => []),
    dbGet('spy_missions', `order=created_at.desc&limit=25`).catch(() => []),
  ]);
  EC.eco = (ecoRows && ecoRows[0]) || { gc: 0, science: 0, tnp: 0, last_tick: null };
  EC.colonies = cols || [];
  EC.buildings = blds || [];
  EC.systems = (sys || []).map(s => ({ ...s, planets: s.planets || [] }));
  EC.designs = (designs || []);
  EC.roster = (prod || []).filter(p => p.status === 'done');
  EC.queue = (prod || []).filter(p => p.status === 'queued');
  EC.allSystems = (allSys || []).map(s => ({ ...s, x: +s.x, y: +s.y }));
  EC.lanes = lanes || [];
  EC.factions = (facs || []).filter(f => f.faction_id);
  EC.routes = routes || [];
  EC.loans = loans || [];
  EC.missions = missions || [];
  // карта редкости/иконки ресурсов из колоний (+ доступных планет)
  EC.resInfo = {};
  EC.colonies.forEach(c => (c.resources || []).forEach(r => { if (r && r.name && !EC.resInfo[r.name]) EC.resInfo[r.name] = { r: r.r || 'common', icon: r.icon || '◈' }; }));
  EC.systems.forEach(s => (s.planets || []).forEach(p => (p.resources || []).forEach(r => { if (r && r.name && !EC.resInfo[r.name]) EC.resInfo[r.name] = { r: r.r || 'common', icon: r.icon || '◈' }; })));
}
async function ecReloadPaint() { await ecLoad(); ecPaintCabinet(); }

// ── Превью дохода (зеркало RPC) ─────────────────────────────
function ecBuildingIncome(b) {
  const d = EC_BUILD[b.btype]; if (!d) return { gc: 0, science: 0 };
  return { gc: (d.inc.gc || 0) * b.slots_open, science: (d.inc.science || 0) * b.slots_open };
}
function ecIncomePreview() {
  let gc = 0, science = 0;
  EC.buildings.forEach(b => { const i = ecBuildingIncome(b); gc += i.gc; science += i.science; });
  return { gc, science };
}
function ecResEntries() { const res = (EC.eco && EC.eco.resources) || {}; return Object.keys(res).map(k => [k, +res[k] || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]); }

// ── Рендер кабинета ─────────────────────────────────────────
function ecTreasuryHtml() {
  const inc = ecIncomePreview();
  const incParts = [];
  if (inc.gc) incParts.push(`<span style="color:var(--gd)">+${ecNum(inc.gc)} ГС</span>`);
  if (inc.science) incParts.push(`<span style="color:var(--pu)">+${ecNum(inc.science)} ОН</span>`);
  const incLine = incParts.length ? incParts.join(' · ') : '<span style="color:var(--t4)">нет дохода — откройте слоты</span>';
  let nextLine = '';
  if (EC.eco.last_tick) {
    const ms = new Date(EC.eco.last_tick).getTime() + 86400000 - Date.now();
    nextLine = ms <= 0 ? 'доход готов к начислению' : `следующий доход через ${Math.floor(ms / 3600000)} ч ${Math.floor((ms % 3600000) / 60000)} мин`;
  }
  const resN = ecResEntries().length;
  return `<div class="ec-treasury">
    <div class="ec-res"><span class="ec-res-k">Галактический стандарт</span><span class="ec-res-v" style="color:var(--gd)">${ecNum(EC.eco.gc)} ГС</span></div>
    <div class="ec-res"><span class="ec-res-k">Очки науки</span><span class="ec-res-v" style="color:var(--pu)">${ecNum(EC.eco.science)} ОН</span></div>
    <div class="ec-res ec-res-click" onclick="ecSetTab('diplomacy')" title="Управление ресурсами"><span class="ec-res-k">Ресурсы планет</span><span class="ec-res-v" style="color:var(--ok)">${resN} ${resN === 1 ? 'вид' : 'вид(ов)'}</span></div>
    <div class="ec-res ec-res-inc"><span class="ec-res-k">Доход / сутки</span><span class="ec-res-v">${incLine}</span><span class="ec-next">${esc(nextLine)}</span></div>
  </div>`;
}

function ecPaintCabinet() {
  const col = ecReadable(EC.app.color);
  const tabs = [['overview', 'Обзор'], ['colonies', 'Колонии'], ['military', 'Армия и флот'], ['research', 'Исследования'], ['territory', 'Территория'], ['diplomacy', 'Дипломатия'], ['intel', 'Разведка']];
  const tabsHtml = tabs.map(([id, l]) => `<button class="ec-tab${EC.tab === id ? ' on' : ''}" onclick="ecSetTab('${id}')">${l}</button>`).join('');
  const body = EC.tab === 'overview' ? ecTabOverview() : EC.tab === 'military' ? ecTabMilitary()
    : EC.tab === 'research' ? ecTabResearch() : EC.tab === 'territory' ? ecTabTerritory()
    : EC.tab === 'diplomacy' ? ecTabDiplomacy() : EC.tab === 'intel' ? ecTabIntel() : ecTabColonies();
  setPg(`<div class="ec-wrap">
    <div class="ec-head"><div class="ec-eyebrow">◈ КАБИНЕТ ИГРОКА</div><h1 style="border-bottom:2px solid ${col}">${esc(EC.app.name || 'Моя фракция')}</h1></div>
    ${ecTreasuryHtml()}
    <div class="ec-tabs">${tabsHtml}</div>
    <div class="ec-tabbody">${body}</div>
  </div>`);
}
function ecSetTab(t) { EC.tab = t; ecPaintCabinet(); }

function ecTabOverview() {
  const rosterCount = EC.roster.reduce((a, r) => a + (r.qty || 0), 0);
  const stat = (k, v) => `<div class="ec-ov-card"><div class="ec-ov-v">${v}</div><div class="ec-ov-k">${esc(k)}</div></div>`;
  return `<div class="ec-ov-grid">
    ${stat('Колоний', ecNum(EC.colonies.length))}
    ${stat('Построек', ecNum(EC.buildings.length))}
    ${stat('Систем', ecNum(EC.systems.length))}
    ${stat('Юнитов в ростере', ecNum(rosterCount))}
  </div>
  <div class="ec-race-note">Раса: <b>${esc(EC.app.race || '—')}</b> · родные миры: ${(EC_HAB[EC.app.race] || []).map(g => EC_GRP_LABEL[g] || g).join(', ') || '—'}. Чужие типы планет доступны через терраформ.</div>
  <div class="ec-ov-links">
    <button class="btn btn-gh" onclick="go('constructors')">⚒ Конструкторы</button>
    <button class="btn btn-gh" onclick="go('cat-ships')">🚀 Каталоги</button>
    <button class="btn btn-gh" onclick="go('map')">🜨 Карта галактики</button>
    <button class="btn btn-gh" onclick="go('factions')">⬡ Фракции</button>
  </div>`;
}

function ecTabColonies() {
  const coloniesHtml = EC.colonies.length ? EC.colonies.map(ecColonyCard).join('') : `<div class="ec-empty">Колоний пока нет.</div>`;
  const race = EC.app.race;
  const rows = [];
  EC.systems.forEach(s => (s.planets || []).forEach(p => {
    if (!p || !p.name) return;
    if (EC.colonies.some(c => c.system_id === s.id && c.planet_name === p.name)) return;
    const g = ecPlanetGroup(p), label = EC_GRP_LABEL[g] || g, cells = +p.slotsP || EC_DEFAULT_CELLS;
    let badge, btn;
    if (!ecColonizable(p)) {
      badge = `<span class="ec-pl-bad ec-pl-no">непригодна · ${esc(label)}</span>`;
      btn = `<button class="btn btn-gh btn-sm" disabled>—</button>`;
    } else if (ecNative(p, race)) {
      badge = `<span class="ec-pl-bad ec-pl-native">родная · ${esc(label)}</span>`;
      btn = `<button class="btn btn-gd btn-sm" onclick="ecColonize('${esc(s.id)}',${ecArg(p.name)},${ecArg(p.type)},${cells},0)">Колонизировать · ${EC_COLONIZE_COST} ГС</button>`;
    } else {
      badge = `<span class="ec-pl-bad ec-pl-foreign">чужая · ${esc(label)}</span>`;
      btn = `<button class="btn btn-gh btn-sm" onclick="ecColonize('${esc(s.id)}',${ecArg(p.name)},${ecArg(p.type)},${cells},1)">Терраформ+колон. · ${ecNum(EC_TERRAFORM_COST)} ГС</button>`;
    }
    rows.push(`<div class="ec-colonize-row">
      <div class="ec-cz-main"><span class="ec-cz-name">${esc(p.name)}</span><span class="ec-cz-sub">${esc(s.name)} · ⬚ ${cells}</span></div>
      <div class="ec-cz-right">${badge}${btn}</div>
    </div>`);
  }));
  const colonizeHtml = rows.length ? rows.join('') : `<div class="ec-empty">В ваших системах нет планет. Контролируйте больше систем на карте галактики.</div>`;
  return `<div class="ec-section-title">Колонии <span class="ec-hint">— застройка (1 здание = 1 ячейка)</span></div>
    <div class="ec-colonies">${coloniesHtml}</div>
    <div class="ec-section-title">Колонизация <span class="ec-hint">— все планеты в ваших системах</span></div>
    <div class="ec-colonize">${colonizeHtml}</div>`;
}

function ecDivBuildCard(div) {
  const need = ecDivReqBuildings(div);
  const missing = need.filter(bt => !ecHasBuilding(bt));
  const can = missing.length === 0;
  const blocks = (div.data && div.data.blocks) || [];
  const comp = blocks.length
    ? blocks.map(b => `${esc(ecDivCompName(b.modelId))} ×${ecNum(b.count || 1)}`).join(', ')
    : 'состав пуст';
  const needChips = need.length
    ? need.map(bt => `<span class="ec-need ${ecHasBuilding(bt) ? 'ok' : 'no'}">${ecHasBuilding(bt) ? '✓' : '✗'} ${esc(EC_BLD_LABEL[bt])}</span>`).join('')
    : '<span class="ec-need ok">✓ без спец-зданий</span>';
  const cost = (div.summary && div.summary.cost) || 0;
  return `<div class="ec-div-card">
    <div class="ec-div-hd"><span class="ec-div-name">⚔ ${esc(div.name)}</span><span class="ec-div-cost">${ecNum(cost)} ГС</span></div>
    <div class="ec-div-comp">${comp}</div>
    <div class="ec-div-need">${needChips}</div>
    <div class="ec-div-act">
      <input type="number" id="ec-div-qty-${esc(div.id)}" value="1" min="1" class="ec-prod-qty">
      ${can
      ? `<button class="btn btn-gd btn-sm" onclick="ecProduceDivision('${esc(div.id)}')">Сформировать</button>`
      : `<button class="btn btn-gh btn-sm" disabled>Нет: ${missing.map(m => esc(EC_BLD_LABEL[m])).join(', ')}</button>`}
    </div>
  </div>`;
}

function ecTabMilitary() {
  const caps = ecCaps(), use = ecPendingUse();
  const divisions = EC.designs.filter(d => d.category === 'division');
  const ships = EC.designs.filter(d => d.category === 'ship');

  const divHtml = divisions.length
    ? `<div class="ec-div-grid">${divisions.map(ecDivBuildCard).join('')}</div>`
    : `<div class="ec-empty">Нет дивизий. Спроектируйте дивизию в Конструкторе дивизий. <button class="btn btn-gh btn-sm" style="margin-left:8px" onclick="go('build-division')">⛬ Конструктор дивизий</button></div>`;

  let shipForm;
  if (!caps.hasShipyard) shipForm = `<div class="ec-empty">Нужна Корабельная Верфь — постройте её во вкладке «Колонии».</div>`;
  else if (!ships.length) shipForm = `<div class="ec-empty">Нет проектов кораблей. Спроектируйте в Корабельном конструкторе. <button class="btn btn-gh btn-sm" style="margin-left:8px" onclick="go('build-ship')">🚀 Конструктор</button></div>`;
  else shipForm = `<div class="ec-prod-form">
      <select id="ec-ship-sel">${ships.map(d => `<option value="${esc(d.id)}">${esc(d.name)} — ${ecNum((d.summary && d.summary.cost) || 0)} ГС</option>`).join('')}</select>
      <input type="number" id="ec-ship-qty" value="1" min="1" class="ec-prod-qty">
      <button class="btn btn-gd btn-sm" onclick="ecProduceShip()">＋ Заложить</button>
    </div>
    <div class="ec-cap">Верфь: <b class="${use.ships > caps.ships ? 'ec-warn' : ''}">${use.ships}/${caps.ships} кораблей за ход</b></div>`;

  const queueHtml = EC.queue.length
    ? EC.queue.map(q => { const ms = q.ready_at ? new Date(q.ready_at).getTime() - Date.now() : 0; const t = ms <= 0 ? 'готово на след. ходу' : `через ${Math.max(0, Math.floor(ms / 3600000))} ч`; return `<div class="ec-q-row"><span class="ec-r-name">${esc(q.unit_name)} ×${ecNum(q.qty)}</span><span class="ec-q-t">${t}</span><button class="ec-bld-del" title="Отменить" onclick="ecCancelProd('${q.id}')">✕</button></div>`; }).join('')
    : `<div class="ec-empty" style="padding:8px">Очередь пуста.</div>`;

  const stock = {};
  EC.roster.forEach(r => { const k = (r.category || '') + '|' + (r.unit_name || ''); if (!stock[k]) stock[k] = { name: r.unit_name, category: r.category, qty: 0 }; stock[k].qty += r.qty || 0; });
  const all = Object.values(stock);
  let rosterHtml = '';
  [['division', '⚔ Дивизии'], ['ship', '🚀 Флот']].forEach(([c, lbl]) => {
    const arr = all.filter(s => s.category === c); if (!arr.length) return;
    rosterHtml += `<div class="ec-r-sec">${lbl}</div>` + arr.map(s => `<div class="ec-r-row"><span class="ec-r-name">${esc(s.name)}</span><span class="ec-r-qty">×${ecNum(s.qty)}</span></div>`).join('');
  });
  if (!rosterHtml) rosterHtml = `<div class="ec-empty" style="padding:8px">Ростер пуст — сформируйте дивизии и постройте корабли.</div>`;

  return `<div class="ec-section-title">Дивизии <span class="ec-hint">— комплектование: нужны здания под состав (пехота → Подготовка, техника → Воензавод)</span></div>
    ${divHtml}
    <div class="ec-section-title">Флот <span class="ec-hint">— корабли строятся на Верфи поштучно</span></div>
    ${shipForm}
    <div class="ec-section-title">В очереди <span class="ec-hint">— доставка в конце хода (сутки)</span></div>
    <div class="ec-queue">${queueHtml}</div>
    <div class="ec-section-title">Ростер — армия и флот</div>
    <div class="ec-roster">${rosterHtml}</div>`;
}

// ── Территория: смежность, миникарта, захват ───────────────
function ecMySysIds() { return new Set((EC.allSystems || []).filter(s => s.faction === EC.fid).map(s => s.id)); }
function ecClaimableIds() {
  const mine = ecMySysIds(), adj = new Set();
  (EC.lanes || []).forEach(l => {
    if (mine.has(l.a_id) && !mine.has(l.b_id)) adj.add(l.b_id);
    if (mine.has(l.b_id) && !mine.has(l.a_id)) adj.add(l.a_id);
  });
  const byId = new Map((EC.allSystems || []).map(s => [s.id, s]));
  return [...adj].filter(id => { const s = byId.get(id); return s && !s.faction; });
}
function ecClaimCooldownMs() {
  if (!EC.eco.last_system_claim) return 0;
  return Math.max(0, new Date(EC.eco.last_system_claim).getTime() + EC_CLAIM_CD_DAYS * 86400000 - Date.now());
}
function ecMinimap() {
  const all = EC.allSystems || [];
  if (!all.length) return `<div class="ec-empty">Карта недоступна.</div>`;
  const W = (typeof GM_W !== 'undefined') ? GM_W : 3300, H = (typeof GM_H !== 'undefined') ? GM_H : 2062;
  const mine = ecMySysIds(), claim = new Set(ecClaimableIds()), myCol = ecReadable(EC.app.color);
  const byId = new Map(all.map(s => [s.id, s]));
  const lanesSvg = (EC.lanes || []).map(l => {
    const a = byId.get(l.a_id), b = byId.get(l.b_id); if (!a || !b) return '';
    const own = mine.has(l.a_id) && mine.has(l.b_id);
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${own ? myCol : 'rgba(255,255,255,.07)'}" stroke-width="${own ? 5 : 2}"/>`;
  }).join('');
  const dots = all.map(s => {
    let r = 14, fill = 'rgba(140,160,190,.5)', stroke = 'transparent', sw = 0, click = '';
    if (mine.has(s.id)) { r = 22; fill = myCol; }
    else if (claim.has(s.id)) { r = 20; fill = 'rgba(0,0,0,.45)'; stroke = 'var(--gd)'; sw = 5; click = ` style="cursor:pointer" onclick="ecClaimSystem('${esc(s.id)}')"`; }
    else if (s.faction) { fill = 'rgba(255,90,90,.35)'; }
    return `<g${click}><circle cx="${s.x}" cy="${s.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"><title>${esc(s.name)}${mine.has(s.id) ? ' (ваша)' : claim.has(s.id) ? ' — можно колонизировать' : s.faction ? ' (занята)' : ' (ничья)'}</title></circle></g>`;
  }).join('');
  return `<div class="ec-minimap"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${lanesSvg}${dots}</svg></div>
    <div class="ec-mm-legend"><span><i style="background:${myCol}"></i> ваши</span><span><i style="background:rgba(0,0,0,.4);box-shadow:inset 0 0 0 2px var(--gd)"></i> доступно</span><span><i style="background:rgba(255,90,90,.35)"></i> заняты</span><span><i style="background:rgba(140,160,190,.5)"></i> ничьи</span></div>`;
}
function ecTabTerritory() {
  const cdMs = ecClaimCooldownMs(), claim = ecClaimableIds();
  const byId = new Map((EC.allSystems || []).map(s => [s.id, s]));
  const cdLine = cdMs > 0
    ? `<div class="ec-cap ec-warn">Колонизация системы доступна через ${Math.ceil(cdMs / 86400000)} дн.</div>`
    : `<div class="ec-cap">Доступно. Раз в ${EC_CLAIM_CD_DAYS} дн., стоимость ${ecNum(EC_CLAIM_COST)} ГС.</div>`;
  const list = claim.length
    ? claim.map(id => { const s = byId.get(id); return `<div class="ec-colonize-row"><div class="ec-cz-main"><span class="ec-cz-name">★ ${esc(s.name)}</span><span class="ec-cz-sub">смежная · ничья</span></div>
        <button class="btn ${cdMs > 0 ? 'btn-gh' : 'btn-gd'} btn-sm" ${cdMs > 0 ? 'disabled' : ''} onclick="ecClaimSystem('${esc(id)}')">Колонизировать систему · ${ecNum(EC_CLAIM_COST)} ГС</button></div>`; }).join('')
    : `<div class="ec-empty">Нет смежных свободных систем. Расширяйтесь вдоль гиперпутей — соседние ничьи системы появятся здесь.</div>`;
  return `<div class="ec-section-title">Карта территории <span class="ec-hint">— ваши системы и доступные для колонизации</span></div>
    ${ecMinimap()}
    <div class="ec-section-title">Колонизация системы <span class="ec-hint">— смежная по гиперпути и ничья</span></div>
    ${cdLine}
    <div class="ec-colonize">${list}</div>`;
}
async function ecClaimSystem(systemId) {
  if (EC.busy) return;
  if (ecClaimCooldownMs() > 0) { toast('Колонизация системы на перезарядке', 'err'); return; }
  if ((EC.eco.gc || 0) < EC_CLAIM_COST) { toast(`Недостаточно ГС: нужно ${ecNum(EC_CLAIM_COST)}`, 'err'); return; }
  if (!confirm('Колонизировать систему за ' + ecNum(EC_CLAIM_COST) + ' ГС? (раз в ' + EC_CLAIM_CD_DAYS + ' дн.)')) return;
  EC.busy = true;
  try {
    await ecRpc('economy_claim_system', { p_system_id: systemId });
    toast('Система колонизирована!', 'ok');
    await ecReloadPaint();
    if (typeof loadGalaxyData === 'function' && typeof GM !== 'undefined' && GM.loaded) { try { await loadGalaxyData(); } catch (e) {} }
  } catch (e) {
    const m = e.message || '';
    toast(m.includes('cooldown') ? 'Колонизация системы на перезарядке' : m.includes('adjacent') ? 'Система не граничит с вашей территорией' : m.includes('already') ? 'Система уже занята' : m.includes('not enough') ? 'Недостаточно ГС' : 'Ошибка: ' + m, 'err');
    await ecReloadPaint();
  } finally { EC.busy = false; }
}

// ── Дипломатия и разведка: общие хелперы ───────────────────
function ecOtherFactions() { return (EC.factions || []).filter(f => f.faction_id && f.faction_id !== EC.fid); }
function ecFacName(fid) { const f = (EC.factions || []).find(x => x.faction_id === fid); return f ? f.name : (fid || '—'); }
function ecFacSelect(id) { const opts = ecOtherFactions().map(f => `<option value="${esc(f.faction_id)}">${esc(f.name)}</option>`).join(''); return `<select id="${id}">${opts || '<option value="">— нет фракций —</option>'}</select>`; }
function ecErr(m) {
  m = m || '';
  if (m.includes('not enough')) return 'Недостаточно средств';
  if (m.includes('no free trade hub')) return 'Нет свободных слотов Торгового хаба';
  if (m.includes('has no economy')) return 'У второй стороны нет экономики (не заходила в кабинет)';
  if (m.includes('no agents')) return 'Нет агентов';
  if (m.includes('research in progress')) return 'Уже идёт исследование';
  if (m.includes('already researched')) return 'Уже изучено';
  if (m.includes('not enough science')) return 'Недостаточно ОН';
  if (m.includes('self')) return 'Нельзя с самим собой';
  if (m.includes('forbidden')) return 'Недостаточно прав';
  return 'Ошибка: ' + m;
}
async function ecRpcAct(fn, body, okMsg) {
  if (EC.busy) return; EC.busy = true;
  try { await ecRpc(fn, body); toast(okMsg, 'ok'); await ecReloadPaint(); }
  catch (e) { toast(ecErr(e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// ── Маршруты/угрозы/эскорт ──────────────────────────────────
function ecMyShipsAvailable() {
  const total = (EC.roster || []).filter(r => r.category === 'ship').reduce((a, r) => a + (r.qty || 0), 0);
  const committed = (EC.routes || []).filter(r => r.a_fid === EC.fid && ['pending', 'active'].includes(r.status)).reduce((a, r) => a + (r.convoy || 0), 0);
  return Math.max(0, total - committed);
}
function ecPath(from, to) {
  if (!from || !to) return null;
  if (from === to) return [from];
  const adj = {}; (EC.lanes || []).forEach(l => { (adj[l.a_id] = adj[l.a_id] || []).push(l.b_id); (adj[l.b_id] = adj[l.b_id] || []).push(l.a_id); });
  const q = [from], prev = { [from]: null }, seen = new Set([from]);
  while (q.length) {
    const c = q.shift();
    if (c === to) { const path = []; let n = to; while (n != null) { path.unshift(n); n = prev[n]; } return path; }
    (adj[c] || []).forEach(nb => { if (!seen.has(nb)) { seen.add(nb); prev[nb] = c; q.push(nb); } });
  }
  return null;
}
function ecThreatType(id) { let h = 0; for (let i = 0; i < (id || '').length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % 2 === 0 ? 'pirates' : 'ancient'; }
function ecRouteThreats(path) {
  const byId = new Map((EC.allSystems || []).map(s => [s.id, s]));
  return (path || []).slice(1, -1).map(id => byId.get(id)).filter(s => s && !s.faction).map(s => ({ sys: s.id, name: s.name, type: ecThreatType(s.id) }));
}
function ecFillDestSys() {
  const dFac = ecId('ec-cv-dfac')?.value, sel = ecId('ec-cv-dsys'); if (!sel) return;
  const sys = (EC.allSystems || []).filter(s => s.faction === dFac);
  sel.innerHTML = sys.length ? sys.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('') : '<option value="">— нет систем —</option>';
}
function ecRouteRow(r) {
  const isOrigin = r.a_fid === EC.fid;
  const other = isOrigin ? (r.b_name || ecFacName(r.b_fid)) : (r.a_name || ecFacName(r.a_fid));
  const value = (r.volume || 0) * (r.price || 0);
  const income = isOrigin ? value : Math.round(value * EC_DEST_CUT);
  const threats = r.threats || [];
  const risk = threats.length ? `риск: ${[...new Set(threats.map(t => t.type === 'ancient' ? 'древние' : 'пираты'))].join('/')}` : 'безопасно';
  const dir = isOrigin ? '→ ' + esc(other) : '← ' + esc(other);
  return `<div class="ec-q-row"><span class="ec-r-name">${ecResIcon(r.resource)} ${esc(r.resource || '')} ×${ecNum(r.volume)} ${dir} · +${ecNum(income)} ГС/ход · <i style="color:${threats.length ? 'var(--color-warning)' : 'var(--ok)'}">${esc(risk)}</i>${r.convoy ? ` · 🛡${r.convoy}` : ''}</span><button class="ec-bld-del" title="Закрыть" onclick="ecTradeClose('${r.id}')">✕</button></div>`;
}

// ── Вкладка «Дипломатия» ────────────────────────────────────
function ecTabDiplomacy() {
  const others = ecOtherFactions(), noOthers = !others.length;
  const tradeCap = ecSlotsSum('trade');
  const used = EC.routes.filter(r => r.a_fid === EC.fid && ['pending', 'active'].includes(r.status)).length;
  const incoming = EC.routes.filter(r => r.b_fid === EC.fid && r.status === 'pending');
  const active = EC.routes.filter(r => r.status === 'active' && (r.a_fid === EC.fid || r.b_fid === EC.fid));
  const pendingOut = EC.routes.filter(r => r.a_fid === EC.fid && r.status === 'pending');
  const asLender = EC.loans.filter(l => l.lender_fid === EC.fid && ['active', 'disputed'].includes(l.status));
  const asBorrower = EC.loans.filter(l => l.borrower_fid === EC.fid && ['active', 'disputed'].includes(l.status));
  const stock = ecResEntries();
  const mySys = (EC.allSystems || []).filter(s => s.faction === EC.fid);
  const ships = ecMyShipsAvailable();

  const stockHtml = stock.length
    ? stock.map(([n, v]) => `<div class="ec-q-row"><span class="ec-r-name">${ecResIcon(n)} ${esc(n)} <i style="color:var(--t4)">(${esc(ecResRarity(n))}, ${ecResPrice(ecResRarity(n))} ГС)</i></span><span class="ec-r-qty">${ecNum(v)}</span></div>`).join('')
    : '<div class="ec-empty" style="padding:8px">Склад пуст. Стройте Добывающий завод на колониях с ресурсами.</div>';
  const sellForm = stock.length
    ? `<div class="ec-prod-form"><select id="ec-sell-res">${stock.map(([n]) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select><input type="number" id="ec-sell-units" min="1" placeholder="кол-во" class="ec-prod-qty"><button class="btn btn-gh btn-sm" onclick="ecSellResource()">Продать на рынке</button></div><div class="cn-fac-hint" style="margin-top:5px">Местный рынок — 80% цены. Караваны выгоднее.</div>`
    : '';
  const resBlock = `<div class="ec-dip-card"><div class="ec-dip-t">Ресурсы планет</div>${stockHtml}${sellForm}</div>`;

  const transferBlock = `<div class="ec-dip-card"><div class="ec-dip-t">Передать средства</div>
    ${noOthers ? '<div class="ec-empty">Нет других фракций.</div>' : `<div class="ec-prod-form">${ecFacSelect('ec-tr-fac')}<select id="ec-tr-res"><option value="gc">ГС</option><option value="science">ОН</option></select><input type="number" id="ec-tr-amt" min="1" placeholder="сумма" class="ec-prod-qty"><button class="btn btn-gh btn-sm" onclick="ecTransfer()">Передать</button></div>`}</div>`;

  const destFac0 = others[0] && others[0].faction_id;
  const destSys0 = (EC.allSystems || []).filter(s => s.faction === destFac0);
  const caravanForm = (tradeCap < 1) ? '<div class="ec-empty">Нужен Торговый хаб (вкладка «Колонии»).</div>'
    : noOthers ? '<div class="ec-empty">Нет других фракций.</div>'
      : !mySys.length ? '<div class="ec-empty">Нет ваших систем — расширяйтесь на карте.</div>'
        : !stock.length ? '<div class="ec-empty">Нет ресурсов для отправки — добывайте на колониях.</div>'
          : `<div class="ec-caravan-form">
        <label>Из системы</label><select id="ec-cv-osys">${mySys.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
        <label>Получателю</label><select id="ec-cv-dfac" onchange="ecFillDestSys()">${others.map(f => `<option value="${esc(f.faction_id)}">${esc(f.name)}</option>`).join('')}</select>
        <label>В систему</label><select id="ec-cv-dsys">${destSys0.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('') || '<option value="">— нет систем —</option>'}</select>
        <label>Ресурс</label><select id="ec-cv-res">${stock.map(([n, v]) => `<option value="${esc(n)}">${esc(n)} (${ecNum(v)})</option>`).join('')}</select>
        <label>Объём/ход</label><input type="number" id="ec-cv-vol" min="1" value="50" class="ec-prod-qty">
        <label>Конвой (≤${ships})</label><input type="number" id="ec-cv-convoy" min="0" max="${ships}" value="0" class="ec-prod-qty">
        <button class="btn btn-gd btn-sm" onclick="ecTradePropose()">Отправить караван</button>
      </div>`;
  const inHtml = incoming.map(r => { const value = (r.volume || 0) * (r.price || 0); return `<div class="ec-q-row"><span class="ec-r-name">От ${esc(r.a_name || ecFacName(r.a_fid))}: ${ecResIcon(r.resource)} ${esc(r.resource)} ×${ecNum(r.volume)} · вам +${ecNum(Math.round(value * EC_DEST_CUT))} ГС/ход</span><button class="btn btn-gd btn-xs" onclick="ecTradeRespond('${r.id}',true)">Принять</button><button class="ec-bld-del" onclick="ecTradeRespond('${r.id}',false)">✕</button></div>`; }).join('');
  const outHtml = pendingOut.map(r => `<div class="ec-q-row"><span class="ec-r-name">→ ${esc(r.b_name || ecFacName(r.b_fid))}: ${ecResIcon(r.resource)} ${esc(r.resource)} ×${ecNum(r.volume)} <i style="color:var(--t4)">(ожидает)</i></span><button class="ec-bld-del" onclick="ecTradeClose('${r.id}')">✕</button></div>`).join('');
  const caravanBlock = `<div class="ec-dip-card"><div class="ec-dip-t">Торговые караваны <span class="ec-hint">пути: ${used}/${tradeCap}</span></div>
      ${caravanForm}
      ${incoming.length ? `<div class="ec-r-sec">Входящие</div>${inHtml}` : ''}
      ${active.length ? `<div class="ec-r-sec">Активные</div>${active.map(ecRouteRow).join('')}` : ''}
      ${pendingOut.length ? `<div class="ec-r-sec">Отправленные</div>${outHtml}` : ''}</div>`;

  const lenderHtml = asLender.map(l => `<div class="ec-q-row"><span class="ec-r-name">${esc(l.borrower_name || ecFacName(l.borrower_fid))} должен ${ecNum(l.amount)} ГС${l.status === 'disputed' ? ' · <b style="color:var(--color-warning)">СПОР</b>' : ''}</span>${l.status === 'active' ? `<button class="btn btn-gh btn-xs" onclick="ecLoanDispute('${l.id}')">Спор</button>` : '<span class="ec-q-t">в МГА</span>'}</div>`).join('');
  const borrowerHtml = asBorrower.map(l => `<div class="ec-q-row"><span class="ec-r-name">Долг ${esc(l.lender_name || ecFacName(l.lender_fid))}: ${ecNum(l.amount)} ГС${l.status === 'disputed' ? ' · <b style="color:var(--color-warning)">СПОР</b>' : ''}</span><button class="btn btn-gd btn-xs" onclick="ecLoanRepay('${l.id}')">Погасить</button></div>`).join('');
  const loanBlock = `<div class="ec-dip-card">
      <div class="ec-dip-t">Кредиты</div>
      ${noOthers ? '<div class="ec-empty">Нет других фракций.</div>' : `<div class="ec-prod-form">${ecFacSelect('ec-loan-fac')}<input type="number" id="ec-loan-amt" min="1" placeholder="сумма ГС" class="ec-prod-qty"><button class="btn btn-gd btn-sm" onclick="ecLoanIssue()">Выдать заём</button></div>
      <input id="ec-loan-note" placeholder="условия (необязательно)" class="ec-loan-note" style="margin-top:6px">`}
      ${asLender.length ? `<div class="ec-r-sec">Я кредитор</div>${lenderHtml}` : ''}
      ${asBorrower.length ? `<div class="ec-r-sec">Я заёмщик</div>${borrowerHtml}` : ''}
    </div>`;

  return `<div class="ec-section-title">Ресурсы и торговля</div>
    <div class="ec-dip-grid">${resBlock}${transferBlock}${caravanBlock}${loanBlock}</div>`;
}

// ── Вкладка «Разведка» ──────────────────────────────────────
function ecTabIntel() {
  const intelSlots = ecSlotsSum('intel');
  const others = ecOtherFactions();
  const opForm = !others.length ? '<div class="ec-empty">Нет других фракций.</div>'
    : (EC.eco.agents || 0) < 1 ? '<div class="ec-empty">Нет агентов. Стройте Центр Спецслужб (1 агент/слот за ход).</div>'
      : `<div class="ec-prod-form">${ecFacSelect('ec-spy-fac')}<select id="ec-spy-type"><option value="recon">Разведка</option><option value="sabotage">Диверсия</option></select><button class="btn btn-gd btn-sm" onclick="ecSpy()">Операция (−1 агент)</button></div>`;
  const log = (EC.missions || []).length ? EC.missions.map(m => {
    const r = m.result || {}; let txt;
    if (m.mtype === 'recon') txt = m.success ? `🔍 ${esc(m.target_name || ecFacName(m.target_fid))}: ${ecNum(r.gc)} ГС · ${ecNum(r.science)} ОН · агентов ${ecNum(r.agents)} · колоний ${r.colonies} · построек ${r.buildings} · юнитов ${ecNum(r.units)}` : 'разведка не удалась';
    else txt = !m.success ? `💥 диверсия против ${esc(m.target_name || '')}: провал` : (r.action === 'steal' ? `💥 украдено ${ecNum(r.gc)} ГС у ${esc(m.target_name || '')}` : r.action === 'destroy' ? `💥 уничтожено здание (${esc(r.building || '')}) у ${esc(m.target_name || '')}` : `💥 цель уцелела`);
    return `<div class="ec-q-row"><span class="ec-r-name">${txt}</span></div>`;
  }).join('') : '<div class="ec-empty" style="padding:8px">Операций ещё не было.</div>';
  return `<div class="ec-treasury" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
      <div class="ec-res"><span class="ec-res-k">Агенты</span><span class="ec-res-v" style="color:var(--te)">${ecNum(EC.eco.agents)}</span></div>
      <div class="ec-res"><span class="ec-res-k">Производство</span><span class="ec-res-v" style="font-size:15px">+${intelSlots} / ход</span></div>
    </div>
    <div class="ec-section-title">Операция <span class="ec-hint">— разведка раскрывает цель; диверсия 50% (кража ~10% ГС / снос здания)</span></div>
    ${opForm}
    <div class="ec-section-title">Журнал операций</div>
    <div class="ec-queue">${log}</div>`;
}

// ── Каталог исследований (из данных конструкторов) ──────────
function ecBuildResearch() {
  if (EC._research) return EC._research;
  const out = [];
  const base = (typeof CN_BASE !== 'undefined') ? CN_BASE : { classes: {}, weapons: {} };
  const CATS = [['ship', 'Корабли', (typeof CN_SHIP !== 'undefined' ? CN_SHIP : null), true], ['ground', 'Наземная техника', (typeof CN_GROUND !== 'undefined' ? CN_GROUND : null), false], ['aviation', 'Авиация', (typeof CN_AIR !== 'undefined' ? CN_AIR : null), true]];
  CATS.forEach(([cat, catLabel, db, hasReactor]) => {
    if (!db) return;
    const baseCls = base.classes[cat] || [];
    let prev = null, i = 0;
    Object.keys(db.data).forEach(k => {
      if (baseCls.includes(k)) return;
      const id = 'cls.' + cat + '.' + k;
      out.push({ id, cat, catLabel, group: 'Классы', name: 'Класс: ' + db.data[k].name, cost: 5 * Math.pow(2, i), prereq: prev ? [prev] : [] });
      prev = id; i++;
    });
    const baseW = base.weapons[cat] || [];
    let wi = 0;
    Object.keys(db.weapons || {}).forEach(g => {
      if (baseW.includes(g)) return;
      out.push({ id: 'wpn.' + cat + '.' + g, cat, catLabel, group: 'Оружие', name: 'Оружие: ' + g, cost: 10 + wi * 6, prereq: [] });
      wi++;
    });
    const comps = [['armor', 'броня', 10], ['shield', 'щиты', 12], ['engine', 'двигатели', 8]];
    if (hasReactor) comps.unshift(['reactor', 'реакторы', 12]);
    comps.forEach(([t, lbl, cost]) => out.push({ id: 'comp.' + cat + '.' + t, cat, catLabel, group: 'Компоненты', name: 'Продвинутые ' + lbl, cost, prereq: [] }));
  });
  EC._research = out;
  return out;
}
function ecTabResearch() {
  const cat = ecBuildResearch();
  const done = new Set(EC.eco.research || []);
  const active = EC.eco.research_active;
  const readyMs = EC.eco.research_ready ? new Date(EC.eco.research_ready).getTime() - Date.now() : 0;
  const sci = EC.eco.science || 0;
  const sciInc = EC.buildings.filter(b => b.btype === 'science').reduce((a, b) => a + (b.slots_open || 0), 0);
  let activeHtml = '';
  if (active) { const node = cat.find(n => n.id === active); const t = readyMs <= 0 ? 'готово на след. ходу' : `через ${Math.max(0, Math.floor(readyMs / 3600000))} ч`; activeHtml = `<div class="ec-cap">⏳ Изучается: <b>${esc(node ? node.name : active)}</b> — ${t}</div>`; }
  const nodeCard = n => {
    const isDone = done.has(n.id), isActive = active === n.id, prereqOk = (n.prereq || []).every(p => done.has(p));
    let badge, btn = '';
    if (isDone) badge = '<span class="ec-rs-badge ok">✓ изучено</span>';
    else if (isActive) badge = '<span class="ec-rs-badge cur">⏳ изучается</span>';
    else if (!prereqOk) { const need = (n.prereq || []).map(p => { const pn = cat.find(x => x.id === p); return pn ? pn.name : p; }).join(', '); badge = `<span class="ec-rs-badge lock">🔒 нужно: ${esc(need)}</span>`; }
    else { badge = '<span class="ec-rs-badge av">🔓 доступно</span>'; const can = !active && sci >= n.cost; btn = `<button class="btn ${can ? 'btn-gd' : 'btn-gh'} btn-xs" ${can ? '' : 'disabled'} onclick="ecResearch('${n.id}')">Исследовать · ${ecNum(n.cost)} ОН</button>`; }
    return `<div class="ec-rs-node${isDone ? ' done' : ''}"><div class="ec-rs-name">${esc(n.name)}</div><div class="ec-rs-foot">${badge}${btn}</div></div>`;
  };
  const byCat = {};
  cat.forEach(n => { (byCat[n.catLabel] = byCat[n.catLabel] || []).push(n); });
  const body = Object.keys(byCat).map(cl => `<div class="ec-rs-cat"><div class="ec-rs-cat-t">${esc(cl)}</div><div class="ec-rs-grid">${byCat[cl].map(nodeCard).join('')}</div></div>`).join('');
  return `<div class="ec-treasury" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
      <div class="ec-res"><span class="ec-res-k">Очки науки</span><span class="ec-res-v" style="color:var(--pu)">${ecNum(sci)} ОН</span></div>
      <div class="ec-res"><span class="ec-res-k">Доход</span><span class="ec-res-v" style="font-size:15px">+${sciInc} ОН/ход</span></div>
    </div>
    ${activeHtml}
    <div class="ec-section-title">Дерево исследований <span class="ec-hint">— 1 проект за раз, 1 ход на исследование; открывает контент в конструкторах</span></div>
    ${body}`;
}
function ecResearch(nodeId) {
  const n = ecBuildResearch().find(x => x.id === nodeId); if (!n) { toast('Узел не найден', 'err'); return; }
  const done = new Set(EC.eco.research || []);
  if (EC.eco.research_active) { toast('Уже идёт исследование', 'err'); return; }
  if (done.has(nodeId)) { toast('Уже изучено', 'inf'); return; }
  if (!(n.prereq || []).every(p => done.has(p))) { toast('Сначала изучите предшественников', 'err'); return; }
  if ((EC.eco.science || 0) < n.cost) { toast(`Недостаточно ОН: нужно ${ecNum(n.cost)}`, 'err'); return; }
  ecRpcAct('economy_research', { p_node: nodeId, p_cost: n.cost }, 'Исследование начато (1 ход)');
}

// ── Действия дипломатии/разведки ────────────────────────────
function ecSellResource() {
  const name = ecId('ec-sell-res')?.value, units = Math.max(0, parseInt(ecId('ec-sell-units')?.value) || 0);
  if (!name) { toast('Выберите ресурс', 'err'); return; }
  if (!units) { toast('Укажите количество', 'err'); return; }
  ecRpcAct('economy_sell_resource', { p_name: name, p_units: units, p_rarity: ecResRarity(name) }, 'Продано на рынке');
}
function ecTransfer() {
  const fac = ecId('ec-tr-fac')?.value, res = ecId('ec-tr-res')?.value, amt = parseInt(ecId('ec-tr-amt')?.value) || 0;
  if (!fac) { toast('Выберите фракцию', 'err'); return; }
  if (amt <= 0) { toast('Укажите сумму', 'err'); return; }
  ecRpcAct('economy_transfer', { p_to_fid: fac, p_res: res, p_amount: amt }, 'Передано');
}
function ecTradePropose() {
  const oSys = ecId('ec-cv-osys')?.value, dFac = ecId('ec-cv-dfac')?.value, dSys = ecId('ec-cv-dsys')?.value;
  const resN = ecId('ec-cv-res')?.value, vol = parseInt(ecId('ec-cv-vol')?.value) || 0, convoy = parseInt(ecId('ec-cv-convoy')?.value) || 0;
  if (!oSys || !dFac || !dSys) { toast('Заполните маршрут (системы и получателя)', 'err'); return; }
  if (!resN) { toast('Выберите ресурс', 'err'); return; }
  if (vol <= 0) { toast('Укажите объём', 'err'); return; }
  const path = ecPath(oSys, dSys);
  if (!path) { toast('Нет маршрута по гиперпутям между этими системами', 'err'); return; }
  const threats = ecRouteThreats(path);
  const riskTxt = threats.length ? `риск: ${[...new Set(threats.map(t => t.type === 'ancient' ? 'древние' : 'пираты'))].join('/')}` : 'путь безопасен';
  ecRpcAct('trade_propose', { p_to_fid: dFac, p_origin_sys: oSys, p_dest_sys: dSys, p_resource: resN, p_rarity: ecResRarity(resN), p_volume: vol, p_convoy: convoy, p_threats: threats }, `Караван отправлен (${riskTxt})`);
}
function ecTradeRespond(id, acc) { ecRpcAct('trade_respond', { p_id: id, p_accept: !!acc }, acc ? 'Путь принят' : 'Отклонено'); }
function ecTradeClose(id) { ecRpcAct('trade_close', { p_id: id }, 'Путь закрыт'); }
function ecLoanIssue() {
  const fac = ecId('ec-loan-fac')?.value, amt = parseInt(ecId('ec-loan-amt')?.value) || 0, note = ecId('ec-loan-note')?.value || '';
  if (!fac) { toast('Выберите фракцию', 'err'); return; }
  if (amt <= 0) { toast('Укажите сумму', 'err'); return; }
  ecRpcAct('loan_issue', { p_to_fid: fac, p_amount: amt, p_note: note }, 'Заём выдан');
}
function ecLoanRepay(id) { ecRpcAct('loan_repay', { p_id: id }, 'Заём погашен'); }
function ecLoanDispute(id) { ecRpcAct('loan_dispute', { p_id: id }, 'Спор подан в МГА'); }
async function ecSpy() {
  const fac = ecId('ec-spy-fac')?.value, type = ecId('ec-spy-type')?.value;
  if (!fac) { toast('Выберите цель', 'err'); return; }
  if (EC.busy) return; EC.busy = true;
  try {
    const r = await ecRpc('spy_mission', { p_target_fid: fac, p_type: type });
    toast(r && r.success ? (type === 'recon' ? 'Разведка успешна' : 'Диверсия удалась') : 'Операция провалена', r && r.success ? 'ok' : 'inf');
    await ecReloadPaint();
  } catch (e) { toast(ecErr(e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// ── МГА: арбитраж спорных займов (вкладка в админ-панели) ───
async function ecRenderMgaTab(b) {
  b.innerHTML = '<div class="sload" style="min-height:60px"><div class="quote-loader">Загрузка...</div></div>';
  let loans = [];
  try { loans = await dbGet('loans', 'status=eq.disputed&order=created_at.asc') || []; }
  catch (e) { b.innerHTML = `<p style="color:var(--err)">Ошибка: ${esc(e.message)}</p>`; return; }
  if (!loans.length) { b.innerHTML = `<div style="text-align:center;padding:24px 0;color:var(--t3)">Нет спорных займов</div>`; return; }
  b.innerHTML = `<div style="margin-bottom:10px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--te)">${loans.length} спор(ов) в МГА</div>` +
    loans.map(l => `<div class="fr-app" id="mga-${l.id}">
      <div class="fr-app-hd"><span class="fr-app-badge new">СПОР</span><b>${esc(l.borrower_name || l.borrower_fid)}</b> должен <b>${esc(l.lender_name || l.lender_fid)}</b> — ${ecNum(l.amount)} ГС</div>
      ${l.note ? `<div class="fr-app-meta">${esc(l.note)}</div>` : ''}
      <div class="fr-app-acts">
        <button class="btn btn-gd btn-sm" onclick="ecMgaVerdict('${l.id}','repay')">⚖ Взыскать</button>
        <button class="btn btn-gh btn-sm" onclick="ecMgaVerdict('${l.id}','forgive')">Простить</button>
        <button class="btn btn-rd btn-sm" onclick="ecMgaVerdict('${l.id}','default')">Дефолт</button>
      </div></div>`).join('');
}
async function ecMgaVerdict(id, action) {
  try { await ecRpc('loan_verdict', { p_id: id, p_action: action }); toast('Вердикт МГА вынесен', 'ok'); document.getElementById('mga-' + id)?.remove(); }
  catch (e) { toast(ecErr(e.message), 'err'); }
}

function ecColonyCard(c) {
  const blds = EC.buildings.filter(b => b.colony_id === c.id);
  const used = blds.length, cap = c.cells || EC_DEFAULT_CELLS;
  const full = used >= cap;
  const bHtml = blds.map(ecBuildingRow).join('') || `<div class="ec-empty" style="padding:8px 0">Пусто. Постройте структуру ↓</div>`;
  // селект застройки
  const opts = EC_ORDER.map(t => `<option value="${t}">${esc(EC_BUILD[t].name)} — ${ecNum(EC_BUILD[t].cost)} ГС</option>`).join('');
  return `<div class="ec-colony">
    <div class="ec-colony-hd">
      <div><span class="ec-colony-name">${esc(c.planet_name || 'Колония')}</span>
        <span class="ec-colony-sub">${esc(c.planet_type || '')}${c.terraformed ? ' · терраформирована' : ''}</span></div>
      <div class="ec-colony-cells ${full ? 'ec-warn' : ''}">⬚ ${used} / ${cap}</div>
    </div>
    <div class="ec-bld-grid">${bHtml}</div>
    <div class="ec-colony-actions">
      <select class="ec-build-sel" id="ec-bsel-${c.id}">${opts}</select>
      <button class="btn btn-gh btn-sm" ${full ? 'disabled title="Нет свободных ячеек"' : ''} onclick="ecBuild('${c.id}')">＋ Построить</button>
      ${!c.terraformed ? `<button class="btn btn-gh btn-sm" onclick="ecTerraform('${c.id}')">Терраформ (+${EC_TERRAFORM_CELLS} ⬚, ${ecNum(EC_TERRAFORM_COST)} ГС)</button>` : ''}
      <button class="btn btn-gh btn-sm ec-danger" onclick="ecAbandon('${c.id}')" title="Бросить колонию">✕</button>
    </div>
  </div>`;
}

function ecBuildingRow(b) {
  const d = EC_BUILD[b.btype]; if (!d) return '';
  const inc = ecBuildingIncome(b);
  const incTxt = inc.gc ? `+${ecNum(inc.gc)} ГС / сутки` : inc.science ? `+${ecNum(inc.science)} ОН / сутки` : inc.tnp ? `+${ecNum(inc.tnp)} ТНП / сутки` : d.desc;
  const dots = Array.from({ length: EC_MAX_SLOTS }, (_, i) => `<span class="ec-slot ${i < b.slots_open ? 'on' : ''}"></span>`).join('');
  const maxed = b.slots_open >= EC_MAX_SLOTS;
  const openBtn = maxed
    ? `<span class="ec-maxed">${EC_MAX_SLOTS}/${EC_MAX_SLOTS}</span>`
    : `<button class="btn btn-gh btn-xs" onclick="ecOpenSlot('${b.id}')">+ слот · ${ecNum(d.ladder[b.slots_open])} ГС</button>`;
  const slotCount = `<span class="ec-slot-count">${b.slots_open}/${EC_MAX_SLOTS}</span>`;
  return `<div class="ec-bld">
    <div class="ec-bld-top">
      <span class="ec-bld-name">${esc(d.name)}</span>
      <button class="ec-bld-del" title="Снести" onclick="ecDemolish('${b.id}')">✕</button>
    </div>
    <div class="ec-slots" title="${b.slots_open} / ${EC_MAX_SLOTS} слотов открыто">${dots}</div>
    <div class="ec-bld-inc">${esc(incTxt)}</div>
    <div class="ec-bld-act">${slotCount}${openBtn}</div>
  </div>`;
}

// экранирование строки для inline-onclick (одинарные кавычки)
function ecArg(s) { return "'" + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

// ── Денежные операции (клиентские, под RLS) ─────────────────
async function ecSpend(amount) {
  if ((EC.eco.gc || 0) < amount) { toast(`Недостаточно ГС: нужно ${ecNum(amount)}, есть ${ecNum(EC.eco.gc || 0)}`, 'err'); return false; }
  await dbPatch('faction_economy', 'faction_id=eq.' + encodeURIComponent(EC.fid), { gc: (EC.eco.gc || 0) - amount });
  EC.eco.gc = (EC.eco.gc || 0) - amount;
  return true;
}

async function ecColonize(sysId, planetName, planetType, cells, foreign) {
  if (EC.busy) return; EC.busy = true;
  try {
    const cost = foreign ? EC_TERRAFORM_COST : EC_COLONIZE_COST;
    if (!await ecSpend(cost)) return;
    let resources = [];
    const sys = EC.systems.find(s => s.id === sysId);
    const p = sys && (sys.planets || []).find(x => x.name === planetName);
    if (p && Array.isArray(p.resources)) resources = p.resources.map(r => ({ name: r.name, icon: r.icon, r: r.r }));
    await dbPost('colonies', { faction_id: EC.fid, owner_id: user.id, system_id: sysId, planet_name: planetName, planet_type: planetType || '', cells: cells || EC_DEFAULT_CELLS, terraformed: !!foreign, resources });
    toast(foreign ? 'Планета терраформирована и колонизирована' : 'Планета колонизирована', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// ── Производство юнитов ─────────────────────────────────────
const _ecReady = () => new Date((EC.eco.last_tick ? new Date(EC.eco.last_tick).getTime() : Date.now()) + 86400000).toISOString();

// Комплектование дивизии — нужны здания под её состав
async function ecProduceDivision(divId) {
  if (EC.busy) return;
  const div = EC.designs.find(d => d.id === divId && d.category === 'division'); if (!div) { toast('Дивизия не найдена', 'err'); return; }
  const qty = Math.max(1, parseInt(ecId('ec-div-qty-' + divId)?.value) || 1);
  const missing = ecDivReqBuildings(div).filter(bt => !ecHasBuilding(bt));
  if (missing.length) { toast('Нужны здания: ' + missing.map(m => EC_BLD_LABEL[m]).join(', '), 'err'); return; }
  const cost = ((div.summary && div.summary.cost) || 0) * qty;
  EC.busy = true;
  try {
    if (!await ecSpend(cost)) return;
    await dbPost('unit_production', { faction_id: EC.fid, owner_id: user.id, unit_id: div.id, unit_name: div.name, category: 'division', line: 'army', weight: 0, qty, status: 'queued', ready_at: _ecReady() });
    toast(`Формируется дивизия: ${div.name} ×${qty}`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Постройка корабля — поштучно на Верфи
async function ecProduceShip() {
  if (EC.busy) return;
  const sel = ecId('ec-ship-sel'); if (!sel || !sel.value) { toast('Выберите корабль', 'err'); return; }
  const qty = Math.max(1, parseInt(ecId('ec-ship-qty')?.value) || 1);
  const u = EC.designs.find(d => d.id === sel.value && d.category === 'ship'); if (!u) { toast('Проект не найден', 'err'); return; }
  const caps = ecCaps(), use = ecPendingUse();
  if (!caps.hasShipyard) { toast('Нужна Корабельная Верфь', 'err'); return; }
  if (use.ships + qty > caps.ships) { toast(`Лимит верфи на ход: ${use.ships}/${caps.ships} кораблей — откройте слоты или ждите хода`, 'err'); return; }
  const cost = ((u.summary && u.summary.cost) || 0) * qty;
  EC.busy = true;
  try {
    if (!await ecSpend(cost)) return;
    await dbPost('unit_production', { faction_id: EC.fid, owner_id: user.id, unit_id: u.id, unit_name: u.name, category: 'ship', line: 'shipyard', weight: 1, qty, status: 'queued', ready_at: _ecReady() });
    toast(`Заложен корабль: ${u.name} ×${qty}`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

async function ecCancelProd(id) {
  const q = EC.queue.find(x => x.id === id);
  try {
    await dbDel('unit_production', 'id=eq.' + id);
    if (q) {
      const u = EC.designs.find(d => d.id === q.unit_id);
      const refund = ((u && u.summary && u.summary.cost) || 0) * (q.qty || 0);
      if (refund) { await dbPatch('faction_economy', 'faction_id=eq.' + encodeURIComponent(EC.fid), { gc: (EC.eco.gc || 0) + refund }); EC.eco.gc = (EC.eco.gc || 0) + refund; }
    }
    toast('Производство отменено', 'inf');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); await ecReloadPaint(); }
}

async function ecBuild(colonyId) {
  if (EC.busy) return;
  const sel = ecId('ec-bsel-' + colonyId); if (!sel) return;
  const btype = sel.value; const d = EC_BUILD[btype]; if (!d) return;
  const colony = EC.colonies.find(c => c.id === colonyId); if (!colony) return;
  const used = EC.buildings.filter(b => b.colony_id === colonyId).length;
  if (used >= (colony.cells || EC_DEFAULT_CELLS)) { toast('Нет свободных ячеек на планете', 'err'); return; }
  EC.busy = true;
  try {
    if (!await ecSpend(d.cost)) return;
    await dbPost('colony_buildings', { colony_id: colonyId, faction_id: EC.fid, owner_id: user.id, btype, slots_open: d.free, tnp_mode: false });
    toast(d.name + ' построен', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

async function ecOpenSlot(buildingId) {
  if (EC.busy) return;
  const b = EC.buildings.find(x => x.id === buildingId); if (!b) return;
  const d = EC_BUILD[b.btype]; if (!d) return;
  if (b.slots_open >= EC_MAX_SLOTS) { toast('Все слоты открыты', 'inf'); return; }
  const cost = d.ladder[b.slots_open];
  EC.busy = true;
  try {
    if (!await ecSpend(cost)) return;
    await dbPatch('colony_buildings', 'id=eq.' + buildingId, { slots_open: b.slots_open + 1 });
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

async function ecToggleTnp(buildingId, checked) {
  try { await dbPatch('colony_buildings', 'id=eq.' + buildingId, { tnp_mode: !!checked }); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + e.message, 'err'); await ecReloadPaint(); }
}

async function ecTerraform(colonyId) {
  if (EC.busy) return;
  const c = EC.colonies.find(x => x.id === colonyId); if (!c) return;
  EC.busy = true;
  try {
    if (!await ecSpend(EC_TERRAFORM_COST)) return;
    await dbPatch('colonies', 'id=eq.' + colonyId, { terraformed: true, cells: (c.cells || EC_DEFAULT_CELLS) + EC_TERRAFORM_CELLS });
    toast('Планета терраформирована (+' + EC_TERRAFORM_CELLS + ' ячеек)', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

async function ecDemolish(buildingId) {
  if (!confirm('Снести постройку? ГС не возвращаются.')) return;
  try { await dbDel('colony_buildings', 'id=eq.' + buildingId); toast('Снесено', 'inf'); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + e.message, 'err'); await ecReloadPaint(); }
}

async function ecAbandon(colonyId) {
  const c = EC.colonies.find(x => x.id === colonyId); if (!c) return;
  if (!confirm('Бросить колонию «' + (c.planet_name || '') + '»? Все её постройки будут потеряны.')) return;
  try { await dbDel('colonies', 'id=eq.' + colonyId); toast('Колония оставлена', 'inf'); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + e.message, 'err'); await ecReloadPaint(); }
}
