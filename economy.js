// ════════════════════════════════════════════════════════════
// ECONOMY — экономический слой (колонизация · застройка · доход)
// Данные: Supabase (faction_economy / colonies / colony_buildings),
//         RPC economy_init / economy_tick (см. _economy_setup.sql).
// Доступ: одобренная анкета государства ИЛИ superadmin/editor.
// Зависит от: core.js (dbGet/dbPost/dbPatch/dbDel, SB_URL/SB_ANON, getTokenFresh, esc, toast, setPg, go),
//             auth.js (user), faction_reg.js (frReadable)
// ════════════════════════════════════════════════════════════

const EC = { app: null, myAppUid: null, fid: null, eco: null, colonies: [], buildings: [], systems: [], designs: [], roster: [], queue: [], allSystems: [], lanes: [], tab: 'colonies', busy: false };
const EC_CLAIM_COST = 3000, EC_CLAIM_CD_DAYS = 7;

const ecId = id => document.getElementById(id);
const ecNum = n => Number(n || 0).toLocaleString('ru-RU');
const ecReadable = c => (typeof frReadable === 'function') ? frReadable(c) : (c || '#cfe3ff');

// Каталог зданий — зеркало _economy_setup.sql (для цен и превью дохода; источник истины дохода — RPC)
const EC_BUILD = {
  factory:          { name: 'Гражданская фабрика', cost: 500,  ladder: [0, 0, 500, 1500, 1500, 3000], free: 2, inc: { gc: 100 }, tnpOpt: true, cat: 'civ', desc: '+100 ГС за слот (или 100 ТНП)' },
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
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(t || ('HTTP ' + r.status)); }
  if (r.status === 204) return null;
  return r.json();
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
  } catch (e) {
    setPg(`<div class="ec-wrap"><div class="sempty">Экономика недоступна: ${esc(e.message)}<br><span style="font-size:11px;color:var(--t4)">Возможно, не выполнен _economy_setup.sql в Supabase.</span></div></div>`);
    return;
  }
  await ecLoad();
  ecPaintCabinet();
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
  const [ecoRows, cols, blds, sys, designs, prod, allSys, lanes] = await Promise.all([
    dbGet('faction_economy', `faction_id=eq.${fid}`),
    dbGet('colonies', `faction_id=eq.${fid}&order=created_at.asc`),
    dbGet('colony_buildings', `faction_id=eq.${fid}&order=created_at.asc`),
    dbGet('map_systems', `faction=eq.${fid}&select=id,name,planets`),
    dbGet('faction_units', `or=(faction_id.eq.${fid},faction_id.is.null)&order=name.asc`).catch(() => []),
    dbGet('unit_production', `faction_id=eq.${fid}&order=created_at.desc`).catch(() => []),
    dbGet('map_systems', `select=id,name,faction,x,y`).catch(() => []),
    dbGet('map_hyperlanes', `select=a_id,b_id`).catch(() => []),
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
}
async function ecReloadPaint() { await ecLoad(); ecPaintCabinet(); }

// ── Превью дохода (зеркало RPC) ─────────────────────────────
function ecBuildingIncome(b) {
  const d = EC_BUILD[b.btype]; if (!d) return { gc: 0, science: 0, tnp: 0 };
  if (b.btype === 'factory' && b.tnp_mode) return { gc: 0, science: 0, tnp: b.slots_open * 100 };
  return { gc: (d.inc.gc || 0) * b.slots_open, science: (d.inc.science || 0) * b.slots_open, tnp: 0 };
}
function ecIncomePreview() {
  let gc = 0, science = 0, tnp = 0;
  EC.buildings.forEach(b => { const i = ecBuildingIncome(b); gc += i.gc; science += i.science; tnp += i.tnp; });
  return { gc, science, tnp };
}

// ── Рендер кабинета ─────────────────────────────────────────
function ecTreasuryHtml() {
  const inc = ecIncomePreview();
  const incParts = [];
  if (inc.gc) incParts.push(`<span style="color:var(--gd)">+${ecNum(inc.gc)} ГС</span>`);
  if (inc.science) incParts.push(`<span style="color:var(--pu)">+${ecNum(inc.science)} ОН</span>`);
  if (inc.tnp) incParts.push(`<span style="color:var(--ok)">+${ecNum(inc.tnp)} ТНП</span>`);
  const incLine = incParts.length ? incParts.join(' · ') : '<span style="color:var(--t4)">нет дохода — откройте слоты</span>';
  let nextLine = '';
  if (EC.eco.last_tick) {
    const ms = new Date(EC.eco.last_tick).getTime() + 86400000 - Date.now();
    nextLine = ms <= 0 ? 'доход готов к начислению' : `следующий доход через ${Math.floor(ms / 3600000)} ч ${Math.floor((ms % 3600000) / 60000)} мин`;
  }
  return `<div class="ec-treasury">
    <div class="ec-res"><span class="ec-res-k">Галактический стандарт</span><span class="ec-res-v" style="color:var(--gd)">${ecNum(EC.eco.gc)} ГС</span></div>
    <div class="ec-res"><span class="ec-res-k">Очки науки</span><span class="ec-res-v" style="color:var(--pu)">${ecNum(EC.eco.science)} ОН</span></div>
    <div class="ec-res"><span class="ec-res-k">Товары (ТНП)</span><span class="ec-res-v" style="color:var(--ok)">${ecNum(EC.eco.tnp)} ТНП</span></div>
    <div class="ec-res ec-res-inc"><span class="ec-res-k">Доход / сутки</span><span class="ec-res-v">${incLine}</span><span class="ec-next">${esc(nextLine)}</span></div>
  </div>`;
}

function ecPaintCabinet() {
  const col = ecReadable(EC.app.color);
  const tabs = [['overview', 'Обзор'], ['colonies', 'Колонии'], ['military', 'Армия и флот'], ['territory', 'Территория']];
  const tabsHtml = tabs.map(([id, l]) => `<button class="ec-tab${EC.tab === id ? ' on' : ''}" onclick="ecSetTab('${id}')">${l}</button>`).join('');
  const body = EC.tab === 'overview' ? ecTabOverview() : EC.tab === 'military' ? ecTabMilitary() : EC.tab === 'territory' ? ecTabTerritory() : ecTabColonies();
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
  const tnpToggle = d.tnpOpt
    ? `<label class="ec-tnp"><input type="checkbox" ${b.tnp_mode ? 'checked' : ''} onchange="ecToggleTnp('${b.id}', this.checked)"><span>режим ТНП</span></label>`
    : `<span class="ec-slot-count">${b.slots_open}/${EC_MAX_SLOTS}</span>`;
  return `<div class="ec-bld">
    <div class="ec-bld-top">
      <span class="ec-bld-name">${esc(d.name)}</span>
      <button class="ec-bld-del" title="Снести" onclick="ecDemolish('${b.id}')">✕</button>
    </div>
    <div class="ec-slots" title="${b.slots_open} / ${EC_MAX_SLOTS} слотов открыто">${dots}</div>
    <div class="ec-bld-inc">${esc(incTxt)}</div>
    <div class="ec-bld-act">${tnpToggle}${openBtn}</div>
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
    await dbPost('colonies', { faction_id: EC.fid, owner_id: user.id, system_id: sysId, planet_name: planetName, planet_type: planetType || '', cells: cells || EC_DEFAULT_CELLS, terraformed: !!foreign });
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
