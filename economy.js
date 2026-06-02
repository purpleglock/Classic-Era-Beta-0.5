// ════════════════════════════════════════════════════════════
// ECONOMY — экономический слой (колонизация · застройка · доход)
// Данные: Supabase (faction_economy / colonies / colony_buildings),
//         RPC economy_init / economy_tick (см. _economy_setup.sql).
// Доступ: одобренная анкета государства ИЛИ superadmin/editor.
// Зависит от: core.js (dbGet/dbPost/dbPatch/dbDel, SB_URL/SB_ANON, getTokenFresh, esc, toast, setPg, go),
//             auth.js (user), faction_reg.js (frReadable)
// ════════════════════════════════════════════════════════════

const EC = { app: null, myAppUid: null, fid: null, eco: null, colonies: [], buildings: [], systems: [], designs: [], roster: [], queue: [], projects: [], allSystems: [], lanes: [], factions: [], routes: [], loans: [], missions: [], tab: 'colonies', busy: false, openColony: null, openSys: null };
const EC_CLAIM_COST = 3000, EC_CLAIM_CD_DAYS = 7;
// Ресурсы планет: цена продажи и добыча/слот по редкости
const EC_RES_PRICE = { common: 2, uncommon: 5, rare: 12, epic: 30, legendary: 80 };
const EC_RES_RATE = { common: 25, uncommon: 12, rare: 5, epic: 2, legendary: 1 };
const EC_DEST_CUT = 0.33;
// Шанс нападения на КАЖДУЮ угрозу на пути (зеркало economy_accrue): с конвоем меньше.
const EC_THREAT_CHANCE = { ancient: { escort: 0.65, bare: 0.80 }, pirates: { escort: 0.40, bare: 0.80 } };
// Итоговый риск потери каравана за ход (%) с учётом конвоя: 1 - произведение «прошёл мимо каждой угрозы».
function ecTradeRiskPct(threats, convoy) {
  const escorted = (convoy || 0) > 0;
  let safe = 1;
  (threats || []).forEach(t => { const c = (EC_THREAT_CHANCE[t.type] || EC_THREAT_CHANCE.pirates)[escorted ? 'escort' : 'bare']; safe *= (1 - c); });
  return Math.round((1 - safe) * 100);
}
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
const EC_COLONIZE_COST = 400, EC_MAX_SLOTS = 6, EC_DEFAULT_CELLS = 6;
// Обустройство среды обитания на своей колонии (+ячейки, 1 ход)
const EC_HABITAT_COST = 1000, EC_HABITAT_CELLS = 3, EC_HABITAT_TURNS = 1;
// Строительство слота здания (1 ход; ГС берётся из лестницы здания)
const EC_SLOT_TURNS = 1;
// Терраформирование непригодной планеты — уровни сложности (срок + доп. ОН)
const EC_TERRA = {
  1: { label: 'Простое',        turns: 1, gc: 1000, science: 0   },
  2: { label: 'Сложное',        turns: 2, gc: 1800, science: 60  },
  3: { label: 'Экстремальное',  turns: 4, gc: 3200, science: 200 },
};
// «Климатическая» координата групп планет (для оценки взаимной несовместимости).
// Чем дальше планета от родных миров расы по этой шкале — тем сложнее терраформ.
const EC_ENV = { cryo: 0, oceanic: 2, terrestrial: 2, micro: 3, desert: 3, exotic: 4, volcanic: 5, lava: 6 };
// Уровень сложности терраформирования планеты p для расы race (1..3)
function ecTerraTier(p, race) {
  const g = ecPlanetGroup(p);
  const pe = EC_ENV[g];
  if (pe == null) return 3; // неизвестная/экзотика — максимально сложно
  const natives = (EC_HAB[race] || []).map(x => EC_ENV[x]).filter(v => v != null);
  if (!natives.length) return 2;
  const dist = Math.min(...natives.map(v => Math.abs(pe - v)));
  return dist <= 1 ? 1 : dist <= 3 ? 2 : 3;
}

// ════════════════════════════════════════════════════════════
// ДОКТРИНА ГОСУДАРСТВА — модификаторы от выбора в анкете.
// Доли (0.20 = +20%). Поля: gc/sci/agents/mine — доход/добыча (>1 лучше);
// colonize/claim_cost — стоимости (<1 дешевле); claim_cd — кулдаун захвата (<1 чаще).
// ⚠ ЧИСЛА ДОЛЖНЫ СОВПАДАТЬ с public._faction_mods() в _economy_setup.sql.
// ════════════════════════════════════════════════════════════
const EC_MODS = {
  gov: {
    'Республика':           { sci: 0.15, gc: 0.10, claim_cd: 0.15 },
    'Монархия':             { gc: 0.20, sci: -0.15 },
    'Империя':              { claim_cost: -0.25, claim_cd: -0.25, agents: 0.10, gc: -0.10 },
    'Олигархия':            { gc: 0.25, sci: -0.15 },
    'Диктатура':            { claim_cd: -0.20, agents: 0.15, gc: -0.10 },
    'Теократия':            { agents: 0.15, gc: 0.10, sci: -0.20 },
    'Технократия':          { sci: 0.30, gc: -0.15 },
    'Корпоратократия':      { gc: 0.20, mine: 0.15, agents: -0.10 },
    'Коллективный разум':   { sci: 0.15, mine: 0.15, claim_cost: 0.20 },
    'Машинный разум (ИИ)':  { sci: 0.20, agents: 0.15, gc: -0.15 },
  },
  regime: {
    'Демократический':      { gc: 0.15, sci: 0.05, agents: -0.10 },
    'Эгалитарный':          { gc: 0.10, sci: 0.10, claim_cost: 0.10 },
    'Меритократический':    { sci: 0.25, gc: -0.10 },
    'Плутократический':     { gc: 0.25, sci: -0.10 },
    'Олигархический':       { gc: 0.15, mine: -0.10 },
    'Авторитарный':         { agents: 0.20, mine: 0.10, gc: -0.10 },
    'Тоталитарный':         { mine: 0.25, agents: 0.15, gc: -0.15 },
    'Деспотичный':          { claim_cd: -0.20, agents: 0.10, sci: -0.15 },
    'Анархический':         { colonize: -0.25, sci: 0.10, gc: -0.20 },
  },
  ideology: {
    'Технократия (Культ науки)': { sci: 0.30, gc: -0.15 },
    'Милитаризм (Культ силы)':   { agents: 0.20, claim_cost: -0.15, gc: -0.10 },
    'Пацифизм':                  { gc: 0.25, agents: -0.20 },
    'Экспансионизм':             { colonize: -0.30, claim_cost: -0.30, claim_cd: -0.40, gc: -0.10 },
    'Изоляционизм':              { gc: 0.15, sci: 0.10, claim_cost: 0.25, claim_cd: 0.25 },
    'Ксенофилия':                { gc: 0.20, agents: -0.10 },
    'Ксенофобия':                { agents: 0.15, mine: 0.10, gc: -0.20 },
    'Спиритуализм':              { agents: 0.20, sci: -0.15 },
    'Трансгуманизм':             { sci: 0.20, agents: 0.10, gc: -0.10 },
    'Экоцентризм':               { mine: 0.30, gc: -0.20 },
    'Индустриализм':             { gc: 0.25, mine: 0.10, sci: -0.15 },
  },
  race: {
    'Гуманоиды':                  { gc: 0.05, sci: 0.05 },
    'Млекопитающие':              { gc: 0.20, sci: -0.05 },
    'Рептилоиды':                 { agents: 0.20, gc: -0.10 },
    'Авианы (Птицеподобные)':     { claim_cd: -0.25, agents: 0.10, gc: -0.05 },
    'Инсектоиды':                 { mine: 0.20, gc: 0.10, sci: -0.15 },
    'Акватики (Водные)':          { gc: 0.15, colonize: 0.15 },
    'Плантоиды (Растениевидные)': { mine: 0.15, gc: 0.10, agents: -0.10 },
    'Литоиды (Каменные)':         { mine: 0.25, gc: -0.15 },
    'Синтетики / Киборги':        { sci: 0.25, gc: -0.15 },
    'Энергетические сущности':    { sci: 0.20, agents: 0.10, gc: -0.15 },
  },
  civ: {
    'frontier': { colonize: -0.25, claim_cd: -0.25, gc: -0.15 },
    'colony':   { gc: 0.20, mine: 0.10, claim_cost: 0.15 },
  },
};
const EC_MOD_FIELDS = ['gc', 'sci', 'agents', 'mine', 'colonize', 'claim_cost', 'claim_cd'];
// Считает итоговые множители доктрины для анкеты app (по умолчанию — текущая фракция).
function ecFactionMods(app) {
  app = app || (typeof EC !== 'undefined' && EC.app) || {};
  const f = {}; EC_MOD_FIELDS.forEach(k => f[k] = 0);
  const add = m => { if (m) for (const k in m) f[k] = (f[k] || 0) + m[k]; };
  add(EC_MODS.gov[app.gov]); add(EC_MODS.regime[app.regime]);
  add(EC_MODS.ideology[app.ideology]); add(EC_MODS.race[app.race]);
  add(EC_MODS.civ[app.civ_type]);
  const clamp = (v, lo) => Math.max(lo, 1 + v);
  return {
    gc: clamp(f.gc, 0.3), sci: clamp(f.sci, 0.3), agents: clamp(f.agents, 0.3),
    mine: clamp(f.mine, 0.3), colonize: clamp(f.colonize, 0.3),
    claim_cost: clamp(f.claim_cost, 0.3), claim_cd: clamp(f.claim_cd, 0.25),
    _raw: f,
  };
}

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
  // Таймаут 28 с — сырой fetch без AbortController вешал страницу
  // насмерть, если Supabase «просыпался» (cold start ~25 с).
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 28000);
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

// ── Инициализация экономики (без начисления!) ───────────────
// Доход начисляется И сервером (pg_cron -> economy_tick_all раз в сутки для
// всех), И при заходе в кабинет (economy_tick — «догоняет» накопленные сутки
// сразу, чтобы не висело «готов к начислению»). Двойного начисления нет:
// economy_tick делает FOR UPDATE и двигает last_tick на целые сутки.
// Дедуп промиса — чтобы повторный рендер не дёргал тик параллельно.
let _ecBoot = null;
async function ecBootOnce() {
  if (_ecBoot) return _ecBoot;
  _ecBoot = (async () => {
    await ecRpc('economy_init');
    const tick = await ecRpc('economy_tick');
    // Тост — РОВНО ОДИН раз на реальный тик (а не на каждый вызов рендера,
    // иначе при повторных рендерах из init было двойное оповещение).
    if (tick && tick.days >= 1) {
      const parts = [];
      if (tick.income && tick.income.gc) parts.push(`+${ecNum(tick.income.gc * tick.days)} ГС`);
      if (tick.income && tick.income.science) parts.push(`+${ecNum(tick.income.science * tick.days)} ОН`);
      if (parts.length) toast(`Доход за ${tick.days} сут.: ${parts.join(' · ')}`, 'ok');
    }
    return tick;
  })();
  _ecBoot.finally(() => setTimeout(() => { _ecBoot = null; }, 2000));
  return _ecBoot;
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
    await ecBootOnce();   // создаём экономику + начисляем накопленный доход (тост внутри, 1 раз)
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
  const [ecoRows, cols, blds, sys, designs, prod, allSys, lanes, facs, routes, loans, missions, projects] = await Promise.all([
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
    dbGet('colony_projects', `faction_id=eq.${fid}&order=ready_at.asc`).catch(() => []),
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
  EC.projects = projects || [];
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
// Итоговый доход империи с учётом доктрины государства (зеркало economy_accrue).
function ecIncomePreview() {
  let gc = 0, science = 0, agents = 0;
  EC.buildings.forEach(b => { const i = ecBuildingIncome(b); gc += i.gc; science += i.science; if (b.btype === 'intel') agents += b.slots_open; });
  const m = ecFactionMods();
  return { gc: Math.round(gc * m.gc), science: Math.round(science * m.sci), agents: Math.round(agents * m.agents),
           base: { gc, science, agents }, mods: m };
}
function ecResEntries() { const res = (EC.eco && EC.eco.resources) || {}; return Object.keys(res).map(k => [k, +res[k] || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]); }
// Добыча за слот/сутки с учётом доктрины (mods.mine) — зеркало economy_accrue.
function ecMineRate(rar) { return Math.max(1, Math.round((EC_RES_RATE[rar || 'common'] || 25) * ecFactionMods().mine)); }
// Стоимость экспансии (колонизация/терраформ/обустройство) с учётом доктрины (mods.colonize).
function ecColonizeCost(base) { return Math.max(1, Math.round((base || 0) * ecFactionMods().colonize)); }

// Ресурсы планеты для mining-здания (из данных карты или снимка колонии)
function ecMiningPlanetRes(b) {
  const colony = EC.colonies.find(c => c.id === b.colony_id);
  if (!colony) return [];
  const sys = EC.systems.find(s => s.id === colony.system_id);
  const planet = (sys && (sys.planets || []).find(p => p.name === colony.planet_name)) || colony;
  return (planet && Array.isArray(planet.resources)) ? planet.resources.filter(r => r && r.name) : [];
}
// Суммарная добыча назначенных месторождений по всем mining-зданиям колонии (для заголовка)
function ecColonyMinePreview(blds, planet) {
  const mBlds = blds.filter(b => b.btype === 'mining');
  if (!mBlds.length) return '';
  const res = (planet && Array.isArray(planet.resources)) ? planet.resources.filter(r => r && r.name) : [];
  if (!res.length) return '';
  const totals = new Map();
  mBlds.forEach(b => {
    (Array.isArray(b.mining_targets) ? b.mining_targets : []).forEach(name => {
      const ri = res.find(r => r.name === name); if (!ri) return;
      const rate = ecMineRate(ri.r || 'common');
      totals.set(name, (totals.get(name) || 0) + rate);
    });
  });
  if (!totals.size) {
    const totalSlots = mBlds.reduce((s, b) => s + b.slots_open, 0);
    return `<div class="ec-pl-mine ec-mine-empty">⛏ ${totalSlots} слот. — раскройте здание, чтобы выбрать месторождения</div>`;
  }
  const chips = [...totals.entries()].map(([name, total]) => {
    const ri = res.find(r => r.name === name) || {};
    return `<span class="ec-rchip ec-rar-${ri.r || 'common'}" title="${esc(name)}: +${total}/сут"><span class="ec-rchip-i">${esc(ri.icon || '◈')}</span>${esc(name)} <b>+${total}</b></span>`;
  }).join('');
  return `<div class="ec-pl-mine">⛏ ${chips}<span class="ec-mine-hint">/сут</span></div>`;
}
// Назначить месторождения для mining-здания
async function ecMiningAssign(bid, targets) {
  if (EC.busy) return; EC.busy = true;
  try {
    await ecRpc('mining_assign', { p_building_id: bid, p_targets: targets });
    const b = EC.buildings.find(x => x.id === bid);
    if (b) b.mining_targets = targets;
    ecPaintCabinet();
  } catch(e) { toast(ecErr(e.message), 'err'); }
  finally { EC.busy = false; }
}
function ecToggleMiningTarget(bid, resName) {
  const b = EC.buildings.find(x => x.id === bid);
  if (!b) return;
  const targets = [...(Array.isArray(b.mining_targets) ? b.mining_targets : [])];
  const idx = targets.indexOf(resName);
  if (idx >= 0) { targets.splice(idx, 1); }
  else {
    if (targets.length >= b.slots_open) { toast(`Максимум ${b.slots_open} месторождений (слотов открыто: ${b.slots_open})`, 'err'); return; }
    targets.push(resName);
  }
  ecMiningAssign(bid, targets);
}

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
  const tabs = [['overview', '◈', 'Обзор'], ['colonies', '🏗', 'Колонии'], ['military', '⚔', 'Армия и флот'], ['research', '🔬', 'Исследования'], ['territory', '🌐', 'Территория'], ['diplomacy', '🤝', 'Дипломатия'], ['intel', '🕵', 'Разведка']];
  const tabsHtml = tabs.map(([id, ic, l]) => `<button class="ec-tab${EC.tab === id ? ' on' : ''}" onclick="ecSetTab('${id}')"><span class="ec-tab-ic">${ic}</span><span class="ec-tab-l">${l}</span></button>`).join('');
  const body = EC.tab === 'overview' ? ecTabOverview() : EC.tab === 'military' ? ecTabMilitary()
    : EC.tab === 'research' ? ecTabResearch() : EC.tab === 'territory' ? ecTabTerritory()
    : EC.tab === 'diplomacy' ? ecTabDiplomacy() : EC.tab === 'intel' ? ecTabIntel() : ecTabColonies();
  setPg(`<div class="ec-wrap">
    <div class="ec-head"><div class="ec-eyebrow">◈ КАБИНЕТ ИГРОКА</div><h1 style="border-bottom:2px solid ${col}">${esc(EC.app.name || 'Моя фракция')}</h1></div>
    ${ecTreasuryHtml()}
    <div class="ec-tabs">${tabsHtml}</div>
    <div class="ec-tabbody">${body}</div>
  </div>`);
  if (EC.tab === 'diplomacy') { try { ecTradeCalc(); } catch (e) {} } // живой расчёт формы каравана
}
function ecSetTab(t) { EC.tab = t; ecPaintCabinet(); }

// Чипы эффектов ОДНОГО выбора в анкете (cat: gov|regime|ideology|race|civ; value: значение).
function ecChoiceChips(cat, value) {
  const m = (EC_MODS[cat] || {})[value];
  if (!m) return '';
  const LBL = { gc: 'ГС-доход', sci: 'Наука', agents: 'Агенты', mine: 'Добыча', colonize: 'Колонизация', claim_cost: 'Захват: цена' };
  const order = ['gc', 'sci', 'agents', 'mine', 'colonize', 'claim_cost', 'claim_cd'];
  const chips = order.filter(k => m[k]).map(k => {
    const p = Math.round(m[k] * 100);
    let good, txt;
    if (k === 'colonize' || k === 'claim_cost') { good = p < 0; txt = `${LBL[k]} ${p > 0 ? '+' : ''}${p}%`; }
    else if (k === 'claim_cd') { good = p < 0; txt = `Кулдаун захвата ${p > 0 ? '+' : ''}${p}%`; }
    else { good = p > 0; txt = `${LBL[k]} ${p > 0 ? '+' : ''}${p}%`; }
    return `<span class="ec-doc-chip ${good ? 'good' : 'bad'}">${txt}</span>`;
  });
  return chips.length ? `<div class="ec-doc-chips-inline">${chips.join('')}</div>` : '';
}

// Чипы активных модификаторов доктрины (для кабинета и обзора анкеты)
function ecDoctrineChips(app) {
  const m = ecFactionMods(app);
  const pct = v => Math.round((v - 1) * 100);
  const chip = (label, v, goodIsHigh) => {
    const p = pct(v); if (!p) return '';
    const good = (goodIsHigh !== false) ? p > 0 : p < 0;
    return `<span class="ec-doc-chip ${good ? 'good' : 'bad'}">${label} ${p > 0 ? '+' : ''}${p}%</span>`;
  };
  const out = [
    chip('ГС-доход', m.gc), chip('Наука', m.sci), chip('Агенты', m.agents), chip('Добыча', m.mine),
    chip('Колонизация', m.colonize, false), chip('Захват: цена', m.claim_cost, false),
  ];
  const cdP = pct(m.claim_cd);
  if (cdP) out.push(`<span class="ec-doc-chip ${cdP < 0 ? 'good' : 'bad'}">${cdP < 0 ? `Захват чаще ×${(1 / m.claim_cd).toFixed(1)}` : `Захват реже +${cdP}%`}</span>`);
  return out.filter(Boolean).join('');
}
function ecDoctrineHtml(app) {
  app = app || EC.app || {};
  const chips = ecDoctrineChips(app);
  if (!chips) return '';
  const sub = [app.gov, app.regime, app.ideology, app.race, app.civ_type === 'frontier' ? 'Фронтир' : (app.civ_type === 'colony' ? 'Колония' : '')].filter(Boolean).map(esc).join(' · ');
  return `<div class="ec-doctrine">
    <div class="ec-doctrine-hd">⚜ Доктрина государства <span class="ec-hint">реальные эффекты вашего выбора при регистрации</span></div>
    ${sub ? `<div class="ec-doctrine-sub">${sub}</div>` : ''}
    <div class="ec-doctrine-chips">${chips}</div>
  </div>`;
}

function ecTabOverview() {
  const sumCat = c => EC.roster.filter(r => r.category === c).reduce((a, r) => a + (r.qty || 0), 0);
  const ships = sumCat('ship'), divs = sumCat('division'), ground = sumCat('ground'), avia = sumCat('aviation');
  const queued = EC.queue.reduce((a, r) => a + (r.qty || 0), 0);
  const totalCells = EC.colonies.reduce((a, c) => a + (c.cells || EC_DEFAULT_CELLS), 0);
  const usedCells = EC.buildings.length;
  const researchAll = (typeof ecBuildResearch === 'function') ? ecBuildResearch() : [];
  const researchDone = Array.isArray(EC.eco.research) ? EC.eco.research.length : 0;
  const activeProj = EC.eco.research_active;
  const activeName = activeProj ? ((researchAll.find(n => n.id === activeProj) || {}).name || activeProj) : '';
  const myRoutes = (EC.routes || []).filter(r => (r.a_fid === EC.fid || r.b_fid === EC.fid) && r.status === 'active').length;
  const myLoans = (EC.loans || []).filter(l => (l.lender_fid === EC.fid || l.borrower_fid === EC.fid) && l.status === 'active').length;
  const agents = EC.eco.agents || 0;
  const resTop = ecResEntries().slice(0, 8);
  const inc = ecIncomePreview();

  const card = (v, k, color, click) => `<div class="ec-ov-card${click ? ' ec-ov-clk' : ''}"${click ? ` onclick="ecSetTab('${click}')"` : ''}><div class="ec-ov-v"${color ? ` style="color:${color}"` : ''}>${v}</div><div class="ec-ov-k">${esc(k)}</div></div>`;
  const sect = (title, cards) => `<div class="ec-ov-sect"><div class="ec-ov-sect-t">${esc(title)}</div><div class="ec-ov-grid">${cards.filter(Boolean).join('')}</div></div>`;

  const empire = sect('🏛 Держава', [
    card(ecNum(EC.systems.length), 'Систем', null, 'territory'),
    card(ecNum(EC.colonies.length), 'Колоний', null, 'colonies'),
    card(`${ecNum(usedCells)}/${ecNum(totalCells)}`, 'Ячейки застройки', null, 'colonies'),
    card(ecNum(EC.buildings.length), 'Построек', null, 'colonies'),
  ]);
  const army = sect('⚔ Армия и флот', [
    card(ecNum(ships), 'Корабли', 'var(--te)', 'military'),
    card(ecNum(divs), 'Дивизии', 'var(--gd)', 'military'),
    card(ecNum(ground), 'Наземка', null, 'military'),
    card(ecNum(avia), 'Авиация', null, 'military'),
    queued ? card(ecNum(queued), 'В очереди', 'var(--color-warning, #e0a030)', 'military') : '',
  ]);
  const sciDip = sect('🔬 Наука · Дипломатия · Разведка', [
    card(`${ecNum(researchDone)}/${ecNum(researchAll.length)}`, 'Технологий', 'var(--pu)', 'research'),
    card(ecNum(agents), 'Агенты', null, 'intel'),
    card(ecNum(myRoutes), 'Торг. пути', null, 'diplomacy'),
    card(ecNum(myLoans), 'Активные займы', null, 'diplomacy'),
  ]);
  const activeHtml = activeProj
    ? `<div class="ec-ov-active">🔬 Исследуется: <b>${esc(activeName)}</b><span class="ec-ov-active-x">завершится в конце хода</span></div>` : '';
  const incLine = (inc.gc || inc.science)
    ? `<div class="ec-ov-inc">📈 Доход: ${inc.gc ? `<b style="color:var(--gd)">+${ecNum(inc.gc)} ГС</b>` : ''}${inc.gc && inc.science ? ' · ' : ''}${inc.science ? `<b style="color:var(--pu)">+${ecNum(inc.science)} ОН</b>` : ''} в сутки</div>` : '';
  const resHtml = resTop.length
    ? `<div class="ec-ov-sect"><div class="ec-ov-sect-t">📦 Ресурсы на складе</div><div class="ec-ov-res">${resTop.map(([n, v]) => `<span class="ec-ov-res-chip"><span class="ec-ov-res-ic">${esc(ecResIcon(n))}</span><span class="ec-ov-res-n">${esc(n)}</span><b>${ecNum(v)}</b></span>`).join('')}</div></div>` : '';

  return `${ecDoctrineHtml()}${empire}${army}${sciDip}${activeHtml}${incLine}${resHtml}
    <div class="ec-race-note">Раса: <b>${esc(EC.app.race || '—')}</b> · родные миры: ${(EC_HAB[EC.app.race] || []).map(g => EC_GRP_LABEL[g] || g).join(', ') || '—'}. Чужие типы планет — через терраформ.</div>
    <div class="ec-ov-links">
      <button class="btn btn-gh btn-sm" onclick="go('constructors')">⚒ Конструкторы</button>
      <button class="btn btn-gh btn-sm" onclick="go('cat-ships')">🚀 Каталоги</button>
      <button class="btn btn-gh btn-sm" onclick="go('map')">🜨 Карта</button>
    </div>`;
}

function ecToggleColony(id) { EC.openColony = (EC.openColony === id) ? null : id; ecPaintCabinet(); }
function ecToggleSys(id) { EC.openSys = (EC.openSys === id) ? null : id; ecPaintCabinet(); }

// Кнопка/бейдж колонизации для незаселённой планеты
function ecColonizeInfo(s, p, race) {
  const g = ecPlanetGroup(p), label = EC_GRP_LABEL[g] || g, cells = +p.slotsP || EC_DEFAULT_CELLS;
  if (!ecColonizable(p)) return { cls: 'no', tag: 'непригодна', label, btn: `<button class="btn btn-gh btn-sm" disabled title="Газовые гиганты, аномалии и пояса терраформировать нельзя">— нельзя</button>` };
  if (ecNative(p, race)) return { cls: 'native', tag: 'родная', label, btn: `<button class="btn btn-gd btn-sm" onclick="event.stopPropagation();ecColonize('${esc(s.id)}',${ecArg(p.name)},${ecArg(p.type)},${cells},0)">Колонизировать · ${ecNum(ecColonizeCost(EC_COLONIZE_COST))} ГС</button>` };
  // Чужая планета — терраформ с уровнем сложности (срок + ОН)
  const pend = ecPendingTerraform(s.id, p.name);
  if (pend) return { cls: 'foreign', tag: 'чужая', label, btn: `<span class="ec-proj-tag" title="${ecProjEtaTxt(pend)}">⏳ терраформ (${ecProjEtaTxt(pend)})</span>` };
  const tier = ecTerraTier(p, race), spec = EC_TERRA[tier];
  const costTxt = `${ecNum(ecColonizeCost(spec.gc))} ГС${spec.science ? ` + ${ecNum(spec.science)} ОН` : ''}`;
  const tierTag = `<span class="ec-terra-tier ec-terra-t${tier}">${spec.label} · ${spec.turns} ход.</span>`;
  return { cls: 'foreign', tag: 'чужая', label,
    btn: `${tierTag}<button class="btn btn-gh btn-sm" title="Терраформирование: ${spec.label.toLowerCase()}, ${spec.turns} ход(ов), ${costTxt}" onclick="event.stopPropagation();ecColonize('${esc(s.id)}',${ecArg(p.name)},${ecArg(p.type)},${cells},1)">Терраформ · ${costTxt}</button>` };
}

// Чипы ресурсов планеты (иконка + название + цвет по редкости)
function ecPlanetResChips(p) {
  const res = (p && Array.isArray(p.resources)) ? p.resources.filter(r => r && r.name) : [];
  if (!res.length) return '<span class="ec-nres">◌ ресурсов нет</span>';
  return res.map(r => {
    const rar = r.r || 'common';
    return `<span class="ec-rchip ec-rar-${rar}" title="${esc(r.name)} · ${rar}"><span class="ec-rchip-i">${esc(r.icon || '◈')}</span>${esc(r.name)}</span>`;
  }).join('');
}
// Подсказка «что выгодно строить» по ресурсам/пригодности планеты
function ecPlanetBuildHint(p) {
  const res = (p && Array.isArray(p.resources)) ? p.resources.filter(r => r && r.name) : [];
  const rich = res.some(r => ['rare', 'epic', 'legendary'].includes(r.r));
  const tips = [];
  if (res.length) tips.push(`⛏ Добывающий завод${rich ? ' — ценные ресурсы!' : ''}`);
  if (ecColonizable(p)) tips.push('🏭 Фабрика · 🔬 Институт');
  return tips.length ? `<div class="ec-pl-hint">💡 Выгодно: ${tips.join(' · ')}</div>` : '';
}

// Тело управления колонией (застройка) — показывается только в развёрнутой колонии
function ecColonyManage(c) {
  const blds = EC.buildings.filter(b => b.colony_id === c.id);
  const used = blds.length, cap = c.cells || EC_DEFAULT_CELLS, full = used >= cap;
  const bHtml = blds.map(ecBuildingRow).join('') || `<div class="ec-empty" style="padding:8px 0">Пусто. Постройте структуру ↓</div>`;
  const opts = EC_ORDER.map(t => `<option value="${t}">${esc(EC_BUILD[t].name)} — ${ecNum(EC_BUILD[t].cost)} ГС</option>`).join('');
  const pendHab = ecPendingHabitat(c.id);
  const habBtn = pendHab
    ? `<span class="ec-proj-tag" title="${ecProjEtaTxt(pendHab)}">⏳ обустройство среды (${ecProjEtaTxt(pendHab)})</span>`
    : !c.terraformed
      ? `<button class="btn btn-gh btn-sm" onclick="ecHabitat('${c.id}')" title="Расширить жизненное пространство: +${EC_HABITAT_CELLS} ячеек, завершится в конце хода">🌱 Обустроить среду (+${EC_HABITAT_CELLS} ⬚, ${ecNum(ecColonizeCost(EC_HABITAT_COST))} ГС)</button>`
      : '';
  return `<div class="ec-bld-grid">${bHtml}</div>
    <div class="ec-colony-actions">
      <select class="ec-build-sel" id="ec-bsel-${c.id}">${opts}</select>
      <button class="btn btn-gh btn-sm" ${full ? 'disabled title="Нет свободных ячеек"' : ''} onclick="ecBuild('${c.id}')">＋ Построить</button>
      ${habBtn}
      <button class="btn btn-gh btn-sm ec-danger" onclick="ecAbandon('${c.id}')" title="Бросить колонию">✕ Бросить</button>
    </div>`;
}

// Строка КОЛОНИИ (всегда показывается, даже если планета не совпала с картой)
function ecColonyRowHtml(colony, sys) {
  const open = EC.openColony === colony.id;
  const blds = EC.buildings.filter(b => b.colony_id === colony.id);
  const used = blds.length, cap = colony.cells || EC_DEFAULT_CELLS;
  const incGc = blds.reduce((a, b) => a + (ecBuildingIncome(b).gc || 0), 0);
  const incSci = blds.reduce((a, b) => a + (ecBuildingIncome(b).science || 0), 0);
  const incTxt = [incGc ? `+${ecNum(incGc)} ГС` : '', incSci ? `+${ecNum(incSci)} ОН` : ''].filter(Boolean).join(' ');
  // ресурсы: из планеты на карте (если есть) или из снимка самой колонии
  const planet = (sys && (sys.planets || []).find(x => x.name === colony.planet_name)) || colony;
  const minePreview = ecColonyMinePreview(blds, planet);
  const head = `<div class="ec-pl ec-pl-own${open ? ' open' : ''}" onclick="ecToggleColony('${colony.id}')">
    <div class="ec-pl-top">
      <div class="ec-pl-l"><span class="ec-pl-ic">🏙</span><div class="ec-pl-txt"><div class="ec-pl-nm">${esc(colony.planet_name || 'Колония')}</div><div class="ec-pl-sb">${esc(colony.planet_type || '')}${colony.terraformed ? ' · терраформ' : ''}</div></div></div>
      <div class="ec-pl-r"><span class="ec-pl-cells">⬚ ${used}/${cap}</span>${incTxt ? `<span class="ec-pl-inc">${incTxt}/сут</span>` : ''}<span class="ec-pl-chev">${open ? '▾' : '▸'}</span></div>
    </div>
    <div class="ec-pl-res">${ecPlanetResChips(planet)}</div>
    ${minePreview}
  </div>`;
  return head + (open ? `<div class="ec-pl-detail">${ecColonyManage(colony)}</div>` : '');
}
// Строка незаселённой планеты (опция колонизации)
function ecFreeRowHtml(s, p, race) {
  const cz = ecColonizeInfo(s, p, race);
  const cells = +p.slotsP || EC_DEFAULT_CELLS;
  return `<div class="ec-pl ec-pl-free">
    <div class="ec-pl-top">
      <div class="ec-pl-l"><span class="ec-pl-ic">${cz.cls === 'no' ? '⊘' : '◌'}</span><div class="ec-pl-txt"><div class="ec-pl-nm">${esc(p.name)}</div><div class="ec-pl-sb"><span class="ec-cz-${cz.cls}">${esc(cz.tag)}</span> · ${esc(cz.label)} · ⬚ ${cells} ячеек</div></div></div>
      <div class="ec-pl-r">${cz.btn}</div>
    </div>
    <div class="ec-pl-res">${ecPlanetResChips(p)}</div>
    ${cz.cls !== 'no' ? ecPlanetBuildHint(p) : ''}
  </div>`;
}

function ecTabColonies() {
  const race = EC.app.race;
  // Системы: владеемые + те, где есть колонии (чтобы колонии НЕ ТЕРЯЛИСЬ,
  // даже если имя колонии не совпало с планетой на карте или система не в списке).
  const sysMap = new Map();
  EC.systems.forEach(s => sysMap.set(s.id, { id: s.id, name: s.name, planets: (s.planets || []).filter(p => p && p.name) }));
  EC.colonies.forEach(c => { if (c.system_id && !sysMap.has(c.system_id)) {
    const live = EC.allSystems && EC.allSystems.find(x => x.id === c.system_id);
    sysMap.set(c.system_id, { id: c.system_id, name: (live && live.name) || 'Система', planets: [] });
  }});
  if (!sysMap.size) {
    return `<div class="ec-section-title">Системы и колонии</div>
      <div class="ec-empty">У вас пока нет систем и колоний. Захватывайте системы во вкладке «🌐 Территория».</div>`;
  }
  const totalCol = EC.colonies.length;
  const blocks = [...sysMap.values()].map(s => {
    const cols = EC.colonies.filter(c => c.system_id === s.id);
    const colNames = new Set(cols.map(c => c.planet_name));
    const sysOpen = EC.openSys === null || EC.openSys === s.id;
    // 1) ВСЕ колонии системы (всегда), 2) незаселённые планеты
    const colHtml = cols.map(c => ecColonyRowHtml(c, s)).join('');
    const freeHtml = s.planets.filter(p => !colNames.has(p.name)).map(p => ecFreeRowHtml(s, p, race)).join('');
    const body = (colHtml + freeHtml) || `<div class="ec-empty" style="padding:10px 12px">Нет планет.</div>`;
    return `<div class="ec-sysblk">
      <div class="ec-sysblk-hd" onclick="ecToggleSys('${esc(s.id)}')">
        <span class="ec-sysblk-nm">🜨 ${esc(s.name)}</span>
        <span class="ec-sysblk-meta">${cols.length} колон. · ${s.planets.length} планет <span class="ec-pl-chev">${sysOpen ? '▾' : '▸'}</span></span>
      </div>
      ${sysOpen ? `<div class="ec-sysblk-body">${body}</div>` : ''}
    </div>`;
  }).join('');
  return `${ecProjectsBlock()}<div class="ec-section-title">Системы и колонии <span class="ec-hint">— ${totalCol} колоний · нажмите на колонию, чтобы развернуть застройку</span></div>
    <div class="ec-syslist">${blocks}</div>`;
}

// Блок «Проекты в работе» — слоты, терраформ, обустройство среды (с таймером и отменой)
function ecProjectsBlock() {
  const ps = (EC.projects || []).slice().sort((a, b) => new Date(a.ready_at || 0) - new Date(b.ready_at || 0));
  if (!ps.length) return '';
  const icon = { slot: '🏗', terraform: '🌍', habitat: '🌱' };
  const rows = ps.map(p => `<div class="ec-q-row">
      <span class="ec-r-name">${icon[p.kind] || '⏳'} ${esc(p.label || p.kind)}</span>
      <span class="ec-q-t">${ecProjEtaTxt(p)}</span>
      <button class="ec-bld-del" title="Отменить (возврат затрат)" onclick="ecCancelProject('${p.id}')">✕</button>
    </div>`).join('');
  return `<div class="ec-section-title">Проекты в работе <span class="ec-hint">— применяются в конце хода</span></div>
    <div class="ec-queue" style="margin-bottom:14px">${rows}</div>`;
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
// ── Интерактив формы каравана (живой расчёт без перерисовки) ──
function ecPickTradeRes(btn) {
  document.querySelectorAll('#ec-cv-reslist .ec-trade-res').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  const name = btn.dataset.res, stock = +btn.dataset.stock || 1;
  const hid = ecId('ec-cv-res'); if (hid) hid.value = name;
  // подгоняем максимум объёма под запас выбранного ресурса
  const sl = ecId('ec-cv-vol-slider'), num = ecId('ec-cv-vol');
  if (sl) sl.max = Math.max(1, stock);
  if (num) { const v = Math.min(+num.value || stock, stock); num.value = v; if (sl) sl.value = v; }
  ecTradeCalc();
}
function ecSyncVol(v) {
  v = Math.max(1, parseInt(v) || 1);
  const sl = ecId('ec-cv-vol-slider'), num = ecId('ec-cv-vol');
  const max = sl ? (+sl.max || v) : v; v = Math.min(v, max);
  if (sl) sl.value = v; if (num) num.value = v;
  ecTradeCalc();
}
function ecSyncConvoy(v) {
  v = Math.max(0, parseInt(v) || 0);
  const sl = ecId('ec-cv-convoy-slider'), num = ecId('ec-cv-convoy');
  const max = sl ? (+sl.max || 0) : 0; v = Math.min(v, max);
  if (sl) sl.value = v; if (num) num.value = v;
  ecTradeCalc();
}
// Живой расчёт сделки: цена, доход обеих сторон, маршрут, риск; обновляет сводку и кнопку.
function ecTradeCalc() {
  const sumEl = ecId('ec-cv-summary'); if (!sumEl) return null; // форма не на экране
  const send = ecId('ec-cv-send');
  const resN = ecId('ec-cv-res')?.value || '';
  const vol = Math.max(0, parseInt(ecId('ec-cv-vol')?.value) || 0);
  const convoy = Math.max(0, parseInt(ecId('ec-cv-convoy')?.value) || 0);
  const oSys = ecId('ec-cv-osys')?.value || '';
  const dFac = ecId('ec-cv-dfac')?.value || '';
  const dSys = ecId('ec-cv-dsys')?.value || '';
  const price = ecResPrice(ecResRarity(resN));
  const myInc = vol * price;
  const partnerInc = Math.round(myInc * EC_DEST_CUT);
  // маршрут и угрозы (для расчёта риска; отсутствие пути НЕ блокирует сделку)
  const path = ecPath(oSys, dSys);
  const threats = path ? ecRouteThreats(path) : [];
  const riskPct = ecTradeRiskPct(threats, convoy);
  const hops = path ? path.length - 1 : null;
  // блокирующие ошибки
  let err = '';
  if (!dFac) err = 'Нет партнёра для торговли';
  else if (!dSys) err = 'У партнёра нет систем на карте — выберите другого';
  else if (!oSys) err = 'У вас нет систем на карте';
  else if (vol <= 0) err = 'Укажите объём';
  const stockBtn = document.querySelector('#ec-cv-reslist .ec-trade-res.on');
  const stockHave = stockBtn ? (+stockBtn.dataset.stock || 0) : 0;
  const shipVol = Math.min(vol, stockHave);              // реально уйдёт за ход (не больше склада)
  const overStock = vol > stockHave;
  const shipsFree = (typeof ecMyShipsAvailable === 'function') ? ecMyShipsAvailable() : 0;
  const threatNames = [...new Set(threats.map(t => t.type === 'ancient' ? 'древние' : 'пираты'))].join(' / ');
  const resIc = ecResIcon(resN), resName = esc(resN);
  // ожидаемый доход с учётом риска грабежа — главный показатель «стоит ли оно того»
  const effMy = Math.round(myInc * shipVol / Math.max(1, vol) * (1 - riskPct / 100));

  // вердикт по риску + что делать
  let riskColor = riskPct >= 50 ? 'var(--err)' : riskPct > 0 ? 'var(--color-warning)' : 'var(--ok)';
  let riskAdvice = '';
  if (threats.length && riskPct >= 50) {
    riskAdvice = shipsFree > convoy
      ? `<div class="ec-trade-note warn">⚠ Высокий риск грабежа. Добавьте конвой (есть свободных кораблей: ${shipsFree}).</div>`
      : `<div class="ec-trade-note warn">⚠ Высокий риск, а свободных кораблей охраны нет. Постройте корабли на Корабельной Верфи или выберите более близкого/безопасного партнёра.</div>`;
  }
  const routeLine = (!dFac || !dSys || !oSys)
    ? `<div class="ec-trade-srow err">⚠ ${esc(err || 'Маршрут не задан')}</div>`
    : hops == null
      ? `<div class="ec-trade-srow"><span>Путь</span><b style="color:var(--t3)">напрямую · угрозы неизвестны</b></div>`
      : `<div class="ec-trade-srow"><span>Путь</span><b>${hops} прыжк.${threats.length ? ` · <span style="color:var(--color-warning)">${threats.length} опасн. сист. (${esc(threatNames)})</span>` : ' · <span style="color:var(--ok)">безопасно</span>'}</b></div>`;

  sumEl.innerHTML = `
    <div class="ec-trade-deal">Каждый ход: <b>${resIc} ${ecNum(shipVol)} ${resName}</b> → партнёру · вы <b style="color:var(--gd)">+${ecNum(Math.round(myInc * shipVol / Math.max(1, vol)))} ГС</b>, партнёр <b style="color:var(--te)">+${ecNum(Math.round(partnerInc * shipVol / Math.max(1, vol)))} ГС</b></div>
    ${routeLine}
    <div class="ec-trade-srow"><span>Риск грабежа / ход</span><b style="color:${riskColor}">${riskPct}%${convoy ? ` · 🛡 конвой ${convoy}` : threats.length ? ' · без охраны' : ''}</b></div>
    <div class="ec-trade-srow big"><span>Ожидаемо с учётом риска</span><b style="color:${effMy > 0 ? 'var(--gd)' : 'var(--err)'}">+${ecNum(effMy)} ГС/ход</b></div>
    <div class="ec-trade-srow"><span>Длительность</span><b style="color:var(--t3)">бессрочно — пока путь не закрыт</b></div>
    ${overStock ? `<div class="ec-trade-note">ℹ Объём ${ecNum(vol)} больше запаса (${ecNum(stockHave)} ед) — за ход уйдёт только наличное.</div>` : ''}
    ${riskAdvice}`;
  if (send) {
    send.disabled = !!err;
    send.textContent = err ? err : `Предложить караван (+${ecNum(effMy)} ГС/ход)`;
  }
  return { resN, vol, convoy, oSys, dFac, dSys, threats, path, err, riskPct };
}
function ecRouteRow(r) {
  const isOrigin = r.a_fid === EC.fid;
  const other = isOrigin ? (r.b_name || ecFacName(r.b_fid)) : (r.a_name || ecFacName(r.a_fid));
  const value = (r.volume || 0) * (r.price || 0);
  const income = isOrigin ? value : Math.round(value * EC_DEST_CUT);
  const threats = r.threats || [];
  const riskPct = ecTradeRiskPct(threats, r.convoy);
  const riskTxt = threats.length ? `риск ${riskPct}%${r.convoy ? ` · 🛡${r.convoy}` : ' · без охраны'}` : 'безопасно';
  const verb = isOrigin ? `отправляю → ${esc(other)}` : `получаю ← ${esc(other)}`;
  return `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      <span class="ec-route-badge ok">✓ активен</span>
      ${ecResIcon(r.resource)} <b>${esc(r.resource || '')} ×${ecNum(r.volume)}</b>/ход · ${verb} · <b style="color:var(--gd)">+${ecNum(income)} ГС/ход</b>
      <i style="color:${threats.length ? 'var(--color-warning)' : 'var(--ok)'}"> · ${esc(riskTxt)}</i>
    </span><button class="ec-bld-del" title="Закрыть путь" onclick="ecTradeClose('${r.id}')">✕</button></div>`;
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
  // Чип-выбор ресурса (вместо «опшенса») с запасом и ценой за единицу
  const resChips = stock.map(([n, v], i) => {
    const rar = ecResRarity(n);
    return `<button type="button" class="ec-trade-res ec-rar-${rar}${i === 0 ? ' on' : ''}" data-res="${esc(n)}" data-stock="${v}" onclick="ecPickTradeRes(this)">
      <span class="ec-trade-res-ic">${ecResIcon(n)}</span><span class="ec-trade-res-n">${esc(n)}</span>
      <span class="ec-trade-res-meta">${ecNum(v)} ед · ${ecResPrice(rar)} ГС/ед</span></button>`;
  }).join('');
  const caravanForm = (tradeCap < 1) ? '<div class="ec-empty">Нужен Торговый хаб (вкладка «Колонии») — он открывает торговые пути.</div>'
    : noOthers ? '<div class="ec-empty">Нет других фракций для торговли.</div>'
      : !mySys.length ? '<div class="ec-empty">Нет ваших систем на карте — расширяйтесь (вкладка «Территория»).</div>'
        : !stock.length ? '<div class="ec-empty">Нет ресурсов на складе — стройте Добывающий завод и назначайте месторождения.</div>'
          : `<div class="ec-trade-form">
        <div class="ec-trade-how">
          <b>Как это работает:</b> караван — постоянное торговое соглашение. После того как партнёр <b>примет</b> предложение, <b>каждый ход</b> вы автоматически отправляете выбранный объём ресурса и <b>оба получаете ГС</b>. Путь действует бессрочно, пока вы или партнёр его не закроете.
          <div class="ec-trade-flow"><span>① Вы предлагаете</span><span>→</span><span>② Партнёр принимает</span><span>→</span><span>③ Доход каждый ход</span></div>
        </div>
        <div class="ec-trade-label">1 · Что отправляете <span class="ec-hint">ресурс уходит партнёру каждый ход</span></div>
        <div class="ec-trade-reslist" id="ec-cv-reslist">${resChips}</div>
        <input type="hidden" id="ec-cv-res" value="${esc(stock[0][0])}">
        <div class="ec-trade-volrow">
          <label title="Сколько единиц ресурса уходит со склада каждый ход">Объём / ход</label>
          <input type="range" id="ec-cv-vol-slider" min="1" max="${Math.max(1, stock[0][1])}" value="${Math.min(50, stock[0][1])}" oninput="ecSyncVol(this.value)">
          <input type="number" id="ec-cv-vol" min="1" value="${Math.min(50, stock[0][1])}" class="ec-trade-volnum" oninput="ecSyncVol(this.value)">
        </div>
        <div class="ec-trade-label">2 · Кому и откуда <span class="ec-hint">чужие системы на пути = угрозы по дороге</span></div>
        <div class="ec-trade-route">
          <select id="ec-cv-osys" onchange="ecTradeCalc()" title="Из вашей системы отправления">${mySys.map(s => `<option value="${esc(s.id)}">🜨 ${esc(s.name)}</option>`).join('')}</select>
          <span class="ec-trade-arrow">→</span>
          <select id="ec-cv-dfac" onchange="ecFillDestSys();ecTradeCalc()" title="Партнёр-получатель">${others.map(f => `<option value="${esc(f.faction_id)}">${esc(f.name)}</option>`).join('')}</select>
          <select id="ec-cv-dsys" onchange="ecTradeCalc()" title="В систему партнёра">${destSys0.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('') || '<option value="">— нет систем —</option>'}</select>
        </div>
        <div class="ec-trade-label">3 · Охрана <span class="ec-hint">корабли-конвой снижают риск грабежа в пути</span></div>
        ${ships > 0
          ? `<div class="ec-trade-volrow">
          <label title="Боевые корабли сопровождения из вашего флота">Конвой (≤${ships})</label>
          <input type="range" id="ec-cv-convoy-slider" min="0" max="${ships}" value="0" oninput="ecSyncConvoy(this.value)">
          <input type="number" id="ec-cv-convoy" min="0" max="${ships}" value="0" class="ec-trade-volnum" oninput="ecSyncConvoy(this.value)">
        </div>`
          : `<div class="ec-trade-note">⚓ Свободных кораблей нет — путь пойдёт без охраны. Постройте корабли на Корабельной Верфи (вкладка «Армия и флот»), чтобы снизить риск.<input type="hidden" id="ec-cv-convoy" value="0"></div>`}
        <div class="ec-trade-summary" id="ec-cv-summary"></div>
        <button class="btn btn-gd" id="ec-cv-send" onclick="ecTradePropose()">Предложить караван</button>
      </div>`;
  const inHtml = incoming.map(r => { const value = (r.volume || 0) * (r.price || 0); return `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      <span class="ec-route-badge new">предложение</span>
      <b>${esc(r.a_name || ecFacName(r.a_fid))}</b> предлагает слать вам ${ecResIcon(r.resource)} <b>${esc(r.resource)} ×${ecNum(r.volume)}</b>/ход · вы получите <b style="color:var(--gd)">+${ecNum(Math.round(value * EC_DEST_CUT))} ГС/ход</b> (бессрочно)
    </span><button class="btn btn-gd btn-xs" title="Согласиться — путь станет активным" onclick="ecTradeRespond('${r.id}',true)">Принять</button><button class="ec-bld-del" title="Отклонить" onclick="ecTradeRespond('${r.id}',false)">✕</button></div>`; }).join('');
  const outHtml = pendingOut.map(r => `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      <span class="ec-route-badge wait">⏳ ждёт ответа</span>
      ${ecResIcon(r.resource)} <b>${esc(r.resource)} ×${ecNum(r.volume)}</b>/ход → <b>${esc(r.b_name || ecFacName(r.b_fid))}</b> · начнёт приносить доход после принятия
    </span><button class="ec-bld-del" title="Отозвать предложение" onclick="ecTradeClose('${r.id}')">✕</button></div>`).join('');
  const caravanBlock = `<div class="ec-dip-card ec-dip-trade"><div class="ec-dip-t">Торговые караваны <span class="ec-hint">пути: ${used}/${tradeCap}</span></div>
      ${caravanForm}
      ${incoming.length ? `<div class="ec-r-sec">Входящие предложения</div>${inHtml}` : ''}
      ${active.length ? `<div class="ec-r-sec">Активные пути</div>${active.map(ecRouteRow).join('')}` : ''}
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
  const c = ecTradeCalc();
  if (!c) { toast('Форма недоступна', 'err'); return; }
  if (c.err) { toast(c.err, 'err'); return; }
  // Отсутствие гиперпути НЕ блокирует: караван идёт напрямую, просто без данных об угрозах.
  const riskTxt = c.threats.length ? `риск ${c.riskPct}%` : 'путь безопасен';
  ecRpcAct('trade_propose',
    { p_to_fid: c.dFac, p_origin_sys: c.oSys, p_dest_sys: c.dSys, p_resource: c.resN, p_rarity: ecResRarity(c.resN), p_volume: c.vol, p_convoy: c.convoy, p_threats: c.threats },
    `Караван предложен партнёру (${riskTxt})`);
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

function ecBuildingRow(b) {
  const d = EC_BUILD[b.btype]; if (!d) return '';
  const inc = ecBuildingIncome(b);
  const incTxt = inc.gc ? `+${ecNum(inc.gc)} ГС / сутки` : inc.science ? `+${ecNum(inc.science)} ОН / сутки` : inc.tnp ? `+${ecNum(inc.tnp)} ТНП / сутки` : d.desc;
  const dots = Array.from({ length: EC_MAX_SLOTS }, (_, i) => `<span class="ec-slot ${i < b.slots_open ? 'on' : ''}"></span>`).join('');
  const maxed = b.slots_open >= EC_MAX_SLOTS;
  const pendSlot = ecPendingSlot(b.id);
  const openBtn = maxed
    ? `<span class="ec-maxed">${EC_MAX_SLOTS}/${EC_MAX_SLOTS}</span>`
    : pendSlot
      ? `<span class="ec-proj-tag" title="${ecProjEtaTxt(pendSlot)}">⏳ слот строится</span>`
      : `<button class="btn btn-gh btn-xs" onclick="ecOpenSlot('${b.id}')">+ слот · ${ecNum(d.ladder[b.slots_open])} ГС</button>`;
  const slotCount = `<span class="ec-slot-count">${b.slots_open}/${EC_MAX_SLOTS}</span>`;
  let mineHtml = '';
  if (b.btype === 'mining') {
    const allRes = ecMiningPlanetRes(b);
    const targets = Array.isArray(b.mining_targets) ? b.mining_targets : [];
    if (allRes.length) {
      const rows = allRes.map(r => {
        const active = targets.includes(r.name);
        const rate = ecMineRate(r.r || 'common');
        const canAdd = !active && targets.length < b.slots_open;
        const cls = active ? 'active' : canAdd ? '' : 'locked';
        const onclick = (active || canAdd) ? `ecToggleMiningTarget(${ecArg(b.id)},${ecArg(r.name)})` : '';
        const tip = active ? `Добывается · нажмите чтобы остановить` : canAdd ? `Нажмите чтобы начать добычу` : `Нет свободных слотов`;
        return `<div class="ec-mine-row ${cls}" onclick="${onclick}" title="${tip}">
          <span class="ec-mine-chk">${active ? '✓' : '○'}</span>
          <span class="ec-mine-ic ec-rar-${r.r || 'common'}">${esc(r.icon || '◈')}</span>
          <span class="ec-mine-nm">${esc(r.name)}</span>
          <span class="ec-mine-rt">${active ? `+${rate}/сут` : `<span class="ec-mine-rt-dim">+${rate}/сут</span>`}</span>
        </div>`;
      }).join('');
      mineHtml = `<div class="ec-bld-mine-hd">⛏ Месторождения <span class="ec-mine-slots-used">${targets.length}/${b.slots_open} слот.</span></div><div class="ec-mine-list">${rows}</div>`;
    } else {
      mineHtml = `<div class="ec-bld-mine-empty">◌ планета без ресурсов — только ГС</div>`;
    }
  }
  return `<div class="ec-bld">
    <div class="ec-bld-top">
      <span class="ec-bld-name">${esc(d.name)}</span>
      <button class="ec-bld-del" title="Снести" onclick="ecDemolish('${b.id}')">✕</button>
    </div>
    <div class="ec-slots" title="${b.slots_open} / ${EC_MAX_SLOTS} слотов открыто">${dots}</div>
    <div class="ec-bld-inc">${esc(incTxt)}</div>
    ${mineHtml}
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
// Списание ГС и ОН одной операцией (для терраформа: ОН-затраты на сложные миры)
async function ecSpendBoth(gc, science) {
  gc = gc || 0; science = science || 0;
  if ((EC.eco.gc || 0) < gc) { toast(`Недостаточно ГС: нужно ${ecNum(gc)}, есть ${ecNum(EC.eco.gc || 0)}`, 'err'); return false; }
  if ((EC.eco.science || 0) < science) { toast(`Недостаточно ОН: нужно ${ecNum(science)}, есть ${ecNum(EC.eco.science || 0)}`, 'err'); return false; }
  await dbPatch('faction_economy', 'faction_id=eq.' + encodeURIComponent(EC.fid), { gc: (EC.eco.gc || 0) - gc, science: (EC.eco.science || 0) - science });
  EC.eco.gc = (EC.eco.gc || 0) - gc; EC.eco.science = (EC.eco.science || 0) - science;
  return true;
}

// ── Проекты колоний (отложенные на 1+ ход) ──────────────────
// Момент готовности = конец текущего хода + (turns-1) суток.
const _ecReadyTurns = (turns) => new Date((EC.eco.last_tick ? new Date(EC.eco.last_tick).getTime() : Date.now()) + Math.max(1, turns || 1) * 86400000).toISOString();
function ecPendingSlot(buildingId) { return (EC.projects || []).find(p => p.kind === 'slot' && p.building_id === buildingId); }
function ecPendingHabitat(colonyId) { return (EC.projects || []).find(p => p.kind === 'habitat' && p.colony_id === colonyId); }
function ecPendingTerraform(sysId, planetName) { return (EC.projects || []).find(p => p.kind === 'terraform' && p.system_id === sysId && p.planet_name === planetName); }
// Сколько ходов осталось до завершения проекта
function ecProjTurnsLeft(p) {
  if (!p || !p.ready_at) return 0;
  const ms = new Date(p.ready_at).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 86400000));
}
function ecProjEtaTxt(p) {
  const n = ecProjTurnsLeft(p);
  return n <= 1 ? 'готово в конце хода' : `через ${n} хода/ходов`;
}
// Отмена проекта с возвратом ГС/ОН (refund берётся из payload)
async function ecCancelProject(id) {
  const p = (EC.projects || []).find(x => x.id === id); if (!p) return;
  if (!confirm(`Отменить проект «${p.label || p.kind}»? Затраты будут возвращены.`)) return;
  try {
    await dbDel('colony_projects', 'id=eq.' + id);
    const rg = (p.payload && +p.payload.spent_gc) || 0, rs = (p.payload && +p.payload.spent_science) || 0;
    if (rg || rs) {
      await dbPatch('faction_economy', 'faction_id=eq.' + encodeURIComponent(EC.fid), { gc: (EC.eco.gc || 0) + rg, science: (EC.eco.science || 0) + rs });
      EC.eco.gc = (EC.eco.gc || 0) + rg; EC.eco.science = (EC.eco.science || 0) + rs;
    }
    toast('Проект отменён, затраты возвращены', 'inf');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); await ecReloadPaint(); }
}

// Колонизация РОДНОЙ планеты — мгновенно (просто заселение пригодного мира).
async function ecColonize(sysId, planetName, planetType, cells, foreign) {
  if (foreign) return ecTerraform(sysId, planetName, planetType, cells); // непригодная → отложенный терраформ
  if (EC.busy) return; EC.busy = true;
  try {
    if (!await ecSpend(ecColonizeCost(EC_COLONIZE_COST))) return;
    let resources = [];
    const sys = EC.systems.find(s => s.id === sysId);
    const p = sys && (sys.planets || []).find(x => x.name === planetName);
    if (p && Array.isArray(p.resources)) resources = p.resources.map(r => ({ name: r.name, icon: r.icon, r: r.r }));
    await dbPost('colonies', { faction_id: EC.fid, owner_id: user.id, system_id: sysId, planet_name: planetName, planet_type: planetType || '', cells: cells || EC_DEFAULT_CELLS, terraformed: false, resources });
    toast('Планета колонизирована', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Терраформирование НЕПРИГОДНОЙ планеты — отложенный проект (1..4 хода + ОН по сложности).
async function ecTerraform(sysId, planetName, planetType, cells) {
  if (EC.busy) return;
  if (ecPendingTerraform(sysId, planetName)) { toast('Терраформирование уже идёт', 'inf'); return; }
  const sys = EC.systems.find(s => s.id === sysId);
  const p = sys && (sys.planets || []).find(x => x.name === planetName);
  const tier = ecTerraTier(p, EC.app.race), spec = EC_TERRA[tier];
  const terraGc = ecColonizeCost(spec.gc);
  if (!confirm(`Терраформирование «${planetName}» (${spec.label.toLowerCase()}):\n• срок: ${spec.turns} ход(ов)\n• затраты: ${ecNum(terraGc)} ГС${spec.science ? ` + ${ecNum(spec.science)} ОН` : ''}\nНачать?`)) return;
  EC.busy = true;
  try {
    if (!await ecSpendBoth(terraGc, spec.science)) return;
    let resources = [];
    if (p && Array.isArray(p.resources)) resources = p.resources.map(r => ({ name: r.name, icon: r.icon, r: r.r }));
    await dbPost('colony_projects', {
      faction_id: EC.fid, owner_id: user.id, kind: 'terraform',
      system_id: sysId, planet_name: planetName, planet_type: planetType || '',
      cells: cells || EC_DEFAULT_CELLS,
      payload: { resources, spent_gc: terraGc, spent_science: spec.science },
      label: `Терраформ: ${planetName}`, ready_at: _ecReadyTurns(spec.turns),
    });
    toast(`Терраформирование начато (${spec.turns} ход.)`, 'ok');
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

// Строительство слота здания — отложенный проект (1 ход).
async function ecOpenSlot(buildingId) {
  if (EC.busy) return;
  const b = EC.buildings.find(x => x.id === buildingId); if (!b) return;
  const d = EC_BUILD[b.btype]; if (!d) return;
  if (b.slots_open >= EC_MAX_SLOTS) { toast('Все слоты открыты', 'inf'); return; }
  if (ecPendingSlot(buildingId)) { toast('Слот уже строится', 'inf'); return; }
  const cost = d.ladder[b.slots_open];
  EC.busy = true;
  try {
    if (!await ecSpend(cost)) return;
    const colony = EC.colonies.find(c => c.id === b.colony_id);
    await dbPost('colony_projects', {
      faction_id: EC.fid, owner_id: user.id, kind: 'slot',
      colony_id: b.colony_id, building_id: buildingId,
      payload: { spent_gc: cost, spent_science: 0 },
      label: `Слот: ${d.name}${colony ? ' · ' + (colony.planet_name || '') : ''}`,
      ready_at: _ecReadyTurns(EC_SLOT_TURNS),
    });
    toast('Слот заложен — откроется в конце хода', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

async function ecToggleTnp(buildingId, checked) {
  try { await dbPatch('colony_buildings', 'id=eq.' + buildingId, { tnp_mode: !!checked }); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + e.message, 'err'); await ecReloadPaint(); }
}

// Обустройство среды обитания на своей колонии (+ячейки) — отложенный проект (1 ход).
async function ecHabitat(colonyId) {
  if (EC.busy) return;
  const c = EC.colonies.find(x => x.id === colonyId); if (!c) return;
  if (ecPendingHabitat(colonyId)) { toast('Обустройство уже идёт', 'inf'); return; }
  EC.busy = true;
  try {
    const habGc = ecColonizeCost(EC_HABITAT_COST);
    if (!await ecSpend(habGc)) return;
    await dbPost('colony_projects', {
      faction_id: EC.fid, owner_id: user.id, kind: 'habitat',
      colony_id: colonyId, cells: EC_HABITAT_CELLS,
      payload: { spent_gc: habGc, spent_science: 0 },
      label: `Обустройство среды: ${c.planet_name || ''}`,
      ready_at: _ecReadyTurns(EC_HABITAT_TURNS),
    });
    toast('Обустройство среды начато — завершится в конце хода', 'ok');
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
