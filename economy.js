// ════════════════════════════════════════════════════════════
// ECONOMY — экономический слой (колонизация · застройка · доход)
// Данные: Supabase (faction_economy / colonies / colony_buildings),
//         RPC economy_init / economy_tick (см. _economy_setup.sql).
// Доступ: одобренная анкета государства ИЛИ superadmin/editor.
// Зависит от: core.js (dbGet/dbPost/dbPatch/dbDel, SB_URL/SB_ANON, getTokenFresh, esc, toast, setPg, go),
//             auth.js (user), faction_reg.js (frReadable)
// ════════════════════════════════════════════════════════════

const EC = { app: null, myAppUid: null, fid: null, eco: null, colonies: [], buildings: [], systems: [], designs: [], roster: [], queue: [], projects: [], allSystems: [], lanes: [], factions: [], routes: [], loans: [], missions: [], dossiers: [], alerts: [], tab: 'colonies', busy: false, openColony: null, openSys: null, spyTarget: null, spyOp: 'recon_basic', spyAgents: 1 };
const EC_CLAIM_COST = 3000, EC_CLAIM_CD_DAYS = 7;
// ── ТАЙНЫЕ ОПЕРАЦИИ — каталог (зеркало spy_launch/ spy_resolve в SQL) ──
// diff — сложность; base — базовая длительность (ходов); need — нужная разведка
// ('','basic','deep'); recon — это разведка (даёт досье).
const EC_SPY_OPS = {
  recon_basic:  { label: 'Разведка (базовая)',  diff: 0,  base: 1, need: '',      recon: 'basic', icon: '🔍', desc: 'Экономика цели: ГС, наука, агенты, колонии.' },
  recon_deep:   { label: 'Глубокая разведка',   diff: 15, base: 2, need: '',      recon: 'deep',  icon: '🛰', desc: 'Постройки, флот, армия, изученные технологии. Открывает сложные операции.' },
  steal_gc:     { label: 'Кража казны',          diff: 25, base: 2, need: 'basic', icon: '💰', desc: 'Похитить часть ГС цели (растёт с числом агентов).' },
  sabotage:     { label: 'Саботаж постройки',    diff: 30, base: 2, need: 'deep',  icon: '💥', desc: 'Вывести из строя выбранное здание цели.' },
  destabilize:  { label: 'Дестабилизация',       diff: 35, base: 3, need: 'basic', icon: '🔥', desc: 'Снизить ГС-доход цели на несколько ходов.' },
  steal_tech:   { label: 'Кража технологий',     diff: 45, base: 4, need: 'deep',  icon: '🧪', desc: 'Украсть изученную цель технологию (добавится в ваше дерево).' },
};
const EC_SPY_ORDER = ['recon_basic', 'recon_deep', 'steal_gc', 'sabotage', 'destabilize', 'steal_tech'];
// Перки агентов (зеркало _spy_agents.sql). Этап 1 — хранятся; этап 2 — гейтят/баффят операции.
const EC_SPY_PERKS = {
  infiltrator: { label: 'Инфильтратор', icon: '🕵', desc: 'Повышает успех краж (казна, технологии).' },
  saboteur:    { label: 'Диверсант',    icon: '💣', desc: 'Повышает успех саботажа и дестабилизации.' },
  ghost:       { label: 'Призрак',      icon: '👻', desc: 'Снижает риск раскрытия операций.' },
  analyst:     { label: 'Аналитик',     icon: '📊', desc: 'Качественнее разведка, свежее досье.' },
  handler:     { label: 'Куратор',      icon: '🛡', desc: 'Усиливает контрразведку.' },
};
function ecPerk(p) { return EC_SPY_PERKS[p] || { label: p || '—', icon: '•', desc: '' }; }
function ecSpyHire(id) { ecRpcAct('spy_hire', { p_recruit_id: id }, 'Агент нанят'); }
function ecSpyFire(id) { if (confirm('Уволить агента?')) ecRpcAct('spy_agent_fire', { p_id: id }, 'Агент уволен'); }
// Сила спецслужб от доктрины (связь с agents_flat): +5% за пункт.
function ecSpyPower(app) { return (ecFactionMods(app).agents_flat || 0) * 5; }
// Свежие разведданные по цели: вернуть {level:'basic'|'deep'|null, ageDays, bonus}.
function ecSpyDossier(targetFid) {
  const recs = (EC.dossiers || []).filter(m => m.target_fid === targetFid && m.outcome === 'success' && (m.op === 'recon_basic' || m.op === 'recon_deep'));
  if (!recs.length) return { level: null, ageDays: Infinity, bonus: 0, result: null, deep: false };
  const deep = recs.find(m => m.op === 'recon_deep');
  const latest = recs[0]; // dossiers отсортированы desc по created_at
  const ageDays = Math.max(0, Math.floor((Date.now() - new Date(latest.ready_at || latest.created_at).getTime()) / 86400000));
  const base = deep ? 20 : 10;
  const bonus = Math.max(0, base - ageDays); // затухает со временем
  return { level: deep ? 'deep' : 'basic', ageDays, bonus, result: (deep || latest).result || {}, deep: !!deep };
}
// Агентура — из ростера (этап 2): операции на именованных агентах, не на пуле.
function ecSpyRoster() { return (EC.spyAgency && EC.spyAgency.roster) || []; }
function ecSpyReadyAgents() { return ecSpyRoster().filter(a => a.status === 'ready'); }     // обучены и не заняты
function ecSpyCommitted() { return ecSpyRoster().filter(a => a.status === 'busy').length; }  // на операциях
function ecSpyTraining() { return ecSpyRoster().filter(a => a.status === 'training').length; }
function ecSpyFree() { return Math.max(0, ecSpyReadyAgents().length - (EC.eco.counter_agents || 0)); }
// Колонии цели из последней УСПЕШНОЙ разведки (для выбора цели саботажа) — этап 3.
function ecSpyColonyOptions(targetFid) {
  const dos = ecSpyDossier(targetFid);
  return (dos && dos.result && Array.isArray(dos.result.colony_list)) ? dos.result.colony_list : [];
}
// Контрразведка цели (видна только если есть глубокая разведка; иначе считаем 0 для превью).
function ecSpyTargetCI(targetFid) { const f = (EC.factions || []).find(x => x.faction_id === targetFid); return (f && +f.counter_agents) || 0; }
// Сила контрразведки цели от её доктрины (нужна анкета цели — приблизительно 0, точный расчёт на сервере).
// Живой расчёт операции: успех/раскрытие/длительность (зеркало spy_launch).
// agentIds — массив id выбранных агентов (перки баффают). Для превью (lock-check) можно [].
function ecSpyCalc(op, agentIds, targetFid) {
  const d = EC_SPY_OPS[op]; if (!d) return null;
  const ids = Array.isArray(agentIds) ? agentIds : [];
  const picked = ecSpyRoster().filter(a => ids.includes(a.id));
  const A = Math.max(1, picked.length);
  const dos = ecSpyDossier(targetFid);
  const CI = ecSpyTargetCI(targetFid);
  const intel = d.recon ? 0 : dos.bonus;
  const spyPow = ecSpyPower();
  // перк-бонусы выбранных агентов (зеркало spy_launch)
  let succB = 0, detB = 0;
  picked.forEach(a => {
    if (a.perk === 'infiltrator' && (op === 'steal_gc' || op === 'steal_tech')) succB += 12;
    else if (a.perk === 'saboteur' && (op === 'sabotage' || op === 'destabilize')) succB += 12;
    else if (a.perk === 'analyst' && (op === 'recon_basic' || op === 'recon_deep')) succB += 10;
    if (a.perk === 'ghost') detB += 10;
  });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
  const success = clamp(45 + A * 8 + intel + spyPow - d.diff - CI * 9 + succB, 5, 95);
  const detect = clamp(8 + d.diff * 0.5 + CI * 12 + A * 2 - spyPow - detB, 2, 90);
  const turns = Math.max(1, Math.min(2, Math.ceil(d.base / Math.sqrt(A))));   // 1–2 цикла
  // требование разведки
  let err = '';
  if (d.need === 'basic' && !dos.level) err = 'Нужна разведка цели (базовая)';
  else if (d.need === 'deep' && dos.level !== 'deep') err = 'Нужна глубокая разведка цели';
  return { success, detect, turns, intel, dossier: dos, ci: CI, err, agents: A, succB, detB, ids };
}
// Ресурсы планет: цена продажи и добыча/слот по редкости
const EC_RES_PRICE = { common: 2, uncommon: 10, rare: 50, epic: 200, legendary: 1200 };
const EC_RES_RATE = { common: 25, uncommon: 12, rare: 6, epic: 3, legendary: 1 };
const EC_DEST_CUT = 0.5;   // доля получателя каравана — зеркало живой economy_accrue (round(shipped*price*0.5))
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
// Персональная цена по ИМЕНИ ресурса (зеркало SQL _res_value). Фолбэк — по редкости.
function ecResPriceN(name) {
  if (typeof resPrice === 'function') return resPrice(name);
  return ecResPrice(ecResRarity(name));
}
function ecResRarity(name) { return (EC.resInfo && EC.resInfo[name] && EC.resInfo[name].r) || 'common'; }
// Иконка ресурса как HTML: картинка из каталога (resIconHtml), иначе — сохранённая эмодзи.
function ecResIcon(name) {
  if (typeof resIconSrc === 'function' && resIconSrc(name)) return resIconHtml(name);
  const em = (EC.resInfo && EC.resInfo[name] && EC.resInfo[name].icon) || '◈';
  return `<span class="res-ic res-ic-emoji">${em}</span>`;
}

const ecId = id => document.getElementById(id);
const ecNum = n => Number(n || 0).toLocaleString('ru-RU');
const ecReadable = c => (typeof frReadable === 'function') ? frReadable(c) : (c || '#cfe3ff');

// Каталог зданий — зеркало _economy_setup.sql (для цен и превью дохода; источник истины дохода — RPC)
const EC_BUILD = {
  factory:          { name: 'Гражданская фабрика', cost: 500,  ladder: [0, 0, 500, 1500, 1500, 3000], free: 2, inc: { gc: 200 }, cat: 'civ', desc: '+200 ГС за слот' },
  mining:           { name: 'Добывающий завод',    cost: 500,  ladder: [0, 0, 500, 1500, 1500, 3000], free: 2, inc: {}, cat: 'civ', desc: 'Добыча ресурсов: слоты → месторождения планеты' },
  trade:            { name: 'Торговый хаб',         cost: 1000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: { gc: 100 }, cat: 'civ', desc: '+100 ГС за слот (торговый путь)' },
  market:           { name: 'Товарная биржа',       cost: 1500, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'civ', desc: 'Продаёт добытые ресурсы за ГС (50–75% цены по редкости), без торговых путей' },
  warehouse:        { name: 'Склад',                 cost: 800,  ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'civ', desc: 'Поднимает лимит хранения ресурсов (+500 ёмкости за слот)' },
  science:          { name: 'Научный Институт',     cost: 1000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: { science: 1 }, cat: 'mil', desc: '+1 ОН за слот' },
  training:         { name: 'Центр Подготовки',     cost: 500,  ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'mil', desc: '1 слот = 1000 пехоты' },
  intel:            { name: 'Центр Спецслужб',      cost: 3000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'mil', desc: '1 слот = 1 агент' },
  military_factory: { name: 'Военный Завод',        cost: 1000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'mil', desc: '1 слот = 100 ед. техники' },
  shipyard:         { name: 'Корабельная Верфь',    cost: 2000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'mil', desc: '1 слот = 1 корабль / 12 МЛА' },
};
const EC_ORDER = ['factory', 'mining', 'trade', 'market', 'warehouse', 'science', 'training', 'intel', 'military_factory', 'shipyard'];
// Короткая подсказка «как пользоваться» для каждого типа здания (показывается в карточке).
const EC_BLD_HOWTO = {
  factory:          'Пассивный доход ГС. Открывайте слоты — каждый добавляет +200 ГС/сут.',
  mining:           'Назначьте слоты на месторождения ниже. Несколько слотов на один ресурс = больше добычи.',
  trade:            'Доход только при активном торговом пути (вкладка «Торговля»).',
  market:           'Сама продаёт накопленные ресурсы за ГС (50–75% цены по редкости), без торговых путей.',
  warehouse:        'Каждый слот склада повышает лимит общего хранилища (+500). Без склада лимит мал — лишняя добыча теряется (или ставьте завод в режим «Экспорт»).',
  science:          'Даёт очки науки (ОН) для исследований.',
  training:         'Даёт мощность для производства пехоты (заказ — во вкладке «Строительство вооружённых сил»).',
  intel:            'Даёт агентов для разведки (вкладка «Разведка»).',
  military_factory: 'Даёт мощность для производства наземной техники (вкладка «Строительство вооружённых сил»).',
  shipyard:         'Даёт мощность для постройки кораблей и авиации (вкладка «Строительство вооружённых сил»).',
};
// Иконки зданий (для каталога-выбора при постройке)
const EC_BLD_ICON = {
  factory: '🏭', mining: '⛏', trade: '💱', market: '📈',
  science: '🔬', training: '🪖', intel: '🕵', military_factory: '🛠', shipyard: '🚀', warehouse: '📦',
};
const EC_COLONIZE_COST = 400, EC_MAX_SLOTS = 6, EC_DEFAULT_CELLS = 6;
// Обустройство среды обитания на своей колонии (+ячейки, 1 ход)
const EC_HABITAT_COST = 1000, EC_HABITAT_CELLS = 3, EC_HABITAT_TURNS = 1;
// Небожители: орбитальные/наземные станции в непригодных мирах — малые колонии (3–5 ячеек).
const EC_STATION_COST = 300;
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
// ПРОЦЕНТНЫЕ поля (доли, 0.20 = +20%): gc, mine, build — доход/добыча/стройка;
//   colonize, claim_cost — стоимости (<1 дешевле); claim_cd — кулдаун колонизации
//   систем (<1 чаще); research — стоимость исследований (<1 дешевле = больше техов).
// ПЛОСКИЕ поля (целые, +N в сутки): sci_flat — ОН/сут, agents_flat — агентов/сут.
//   Наука и агенты — дискретные малые величины, проценты для них бессмысленны.
// ⚠ ЧИСЛА ДОЛЖНЫ СОВПАДАТЬ с public._faction_mods() в _economy_setup.sql.
// ════════════════════════════════════════════════════════════
const EC_MODS = {
  gov: {
    'Республика':           { gc: 0.10, claim_cd: 0.15, sci_flat: 1 },
    'Монархия':             { gc: 0.20, sci_flat: -1 },
    'Империя':              { claim_cost: -0.25, claim_cd: -0.25, gc: -0.10, agents_flat: 1 },
    'Олигархия':            { gc: 0.25, sci_flat: -1 },
    'Диктатура':            { claim_cd: -0.20, gc: -0.10, agents_flat: 1 },
    'Теократия':            { gc: 0.10, research: 0.15, sci_flat: -2, agents_flat: 1 },
    'Технократия':          { gc: -0.15, build: 0.10, research: -0.25, sci_flat: 3 },
    'Корпоратократия':      { gc: 0.20, mine: 0.15, build: -0.10, agents_flat: -1 },
    'Коллективный разум':   { mine: 0.15, claim_cost: 0.20, research: -0.10, sci_flat: 1 },
    'Машинный разум (ИИ)':  { gc: -0.15, build: -0.10, research: -0.15, sci_flat: 1, agents_flat: 1 },
  },
  regime: {
    'Демократический':      { gc: 0.15, agents_flat: -1 },
    'Эгалитарный':          { gc: 0.10, claim_cost: 0.10, sci_flat: 1 },
    'Меритократический':    { gc: -0.10, research: -0.15, sci_flat: 2 },
    'Плутократический':     { gc: 0.25, sci_flat: -1 },
    'Олигархический':       { gc: 0.15, mine: -0.10 },
    'Авторитарный':         { mine: 0.10, gc: -0.10, agents_flat: 1 },
    'Тоталитарный':         { mine: 0.25, gc: -0.15, agents_flat: 1 },
    'Деспотичный':          { claim_cd: -0.20, sci_flat: -1, agents_flat: 1 },
    'Деспотизм':            { gc: 0.15, mine: 0.10, research: 0.15, sci_flat: -1, agents_flat: 1 },
    'Анархический':         { colonize: -0.25, gc: -0.20, build: 0.15, sci_flat: 1 },
  },
  ideology: {
    'Технократия (Культ науки)': { gc: -0.15, research: -0.25, sci_flat: 3 },
    'Милитаризм (Культ силы)':   { claim_cost: -0.15, gc: -0.10, research: 0.10, agents_flat: 1 },
    'Пацифизм':                  { gc: 0.25, agents_flat: -1 },
    'Экспансионизм':             { colonize: -0.30, claim_cost: -0.30, claim_cd: -0.40, gc: -0.10 },
    'Изоляционизм':              { gc: 0.15, claim_cost: 0.25, claim_cd: 0.25, sci_flat: 1 },
    'Ксенофилия':                { gc: 0.20, agents_flat: -1 },
    'Ксенофобия':                { mine: 0.10, gc: -0.20, agents_flat: 1 },
    'Спиритуализм':              { research: 0.15, sci_flat: -1, agents_flat: 1 },
    'Трансгуманизм':             { gc: -0.10, research: -0.15, sci_flat: 2 },
    'Экоцентризм':               { mine: 0.30, gc: -0.20 },
    'Индустриализм':             { gc: 0.25, mine: 0.10, build: -0.15, research: 0.10, sci_flat: -1 },
  },
  race: {
    'Гуманоиды':                  { gc: 0.05, sci_flat: 1 },
    'Млекопитающие':              { gc: 0.20 },
    'Рептилоиды':                 { gc: -0.10, agents_flat: 1 },
    'Авианы (Птицеподобные)':     { claim_cd: -0.25, gc: -0.05, agents_flat: 1 },
    'Инсектоиды':                 { mine: 0.20, gc: 0.10, research: 0.10, sci_flat: -1 },
    'Акватики (Водные)':          { gc: 0.15, colonize: 0.15 },
    'Плантоиды (Растениевидные)': { mine: 0.15, gc: 0.10, agents_flat: -1 },
    'Литоиды (Каменные)':         { mine: 0.25, gc: -0.15 },
    'Синтетики / Киборги':        { gc: -0.35, research: -0.15, sci_flat: 2 },  // все планеты родные → сильный дебаф денег
    'Энергетические сущности':    { gc: -0.15, research: -0.10, sci_flat: 1, agents_flat: 1 },
  },
  civ: {
    'frontier': { colonize: -0.25, claim_cd: -0.25, gc: -0.15 },
    'colony':   { gc: 0.20, mine: 0.10, claim_cost: 0.15, build: -0.10 },
  },
};

// ── ПЛАНЕТЫ-СТОЛИЦЫ: характеристики и лёгкий бонус родного мира ──
// Ключ = среда (env, EC_HAB). Бонусы намеренно мягкие — это «характер» родного
// мира, а не основной источник силы фракции. cells = ячейки застройки столицы,
// res = базовый профиль ресурсов (common), mods = лёгкий пассивный бонус,
// title/flavor — для регистрации и гайдбука. Зеркало: _faction_mods (capital_env)
// и _basic_capital_res в SQL.
const EC_CAPITAL = {
  terrestrial: { title: 'Колыбель жизни',     cells: 9, res: ['Железо', 'Силикаты', 'Углерод'], mods: { gc: 0.05 },        flavor: 'Сбалансированный, обжитой мир. Стабильная биосфера даёт лёгкий бонус к доходу.' },
  oceanic:     { title: 'Мир океанов',        cells: 9, res: ['Силикаты', 'Лёд'],               mods: { colonize: -0.10 }, flavor: 'Сплошной океан и развитая логистика по воде удешевляют расселение новых колоний.' },
  desert:      { title: 'Выжженные пустоши',  cells: 8, res: ['Железо', 'Силикаты', 'Сера'],    mods: { mine: 0.10 },      flavor: 'Минералы лежат прямо на поверхности — выше скорость добычи ресурсов.' },
  volcanic:    { title: 'Геотермальный мир',  cells: 8, res: ['Железо', 'Сера'],                mods: { mine: 0.10 },      flavor: 'Вулканическая активность питает шахты дешёвой энергией — выше добыча.' },
  lava:        { title: 'Расплавленные недра',cells: 7, res: ['Железо', 'Сера'],                mods: { mine: 0.12 },      flavor: 'Море магмы богато тяжёлыми металлами. Суровый мир, но максимум добычи.' },
  cryo:        { title: 'Ледяной мир',        cells: 8, res: ['Лёд', 'Железо', 'Силикаты'],     mods: { research: -0.08 }, flavor: 'Криолаборатории и сверхпроводники в вечном холоде удешевляют исследования.' },
  micro:       { title: 'Малое тело',         cells: 7, res: ['Железо', 'Силикаты'],            mods: { claim_cd: -0.12 }, flavor: 'Низкая гравитация удешевляет запуск кораблей — экспансия идёт быстрее.' },
  exotic:      { title: 'Аномальный мир',     cells: 8, res: ['Углерод', 'Силикаты'],           mods: { sci_flat: 1 },     flavor: 'Странная физика родного мира даёт учёным стабильный приток научных данных.' },
};
function ecCapital(env) { return EC_CAPITAL[env] || EC_CAPITAL.terrestrial; }
// Процентные поля (множители 1+sum) и плоские поля (целые суммы).
const EC_MOD_PCT = ['gc', 'mine', 'build', 'colonize', 'claim_cost', 'claim_cd', 'research'];
const EC_MOD_FLAT = ['sci_flat', 'agents_flat'];
// ── Конкретные ПЛЮШКИ доктрины (зеркало _doctrine_grant_* в SQL) ──
// Бонусные стартовые постройки: форма правления + идеология дают по зданию.
const EC_DOCTRINE_BUILD = {
  gov: {
    'Республика': 'trade', 'Монархия': 'factory', 'Империя': 'military_factory', 'Олигархия': 'factory',
    'Диктатура': 'training', 'Теократия': 'training', 'Технократия': 'science', 'Корпоратократия': 'trade',
    'Коллективный разум': 'science', 'Машинный разум (ИИ)': 'science',
  },
  ideology: {
    'Технократия (Культ науки)': 'science', 'Милитаризм (Культ силы)': 'military_factory', 'Пацифизм': 'factory',
    'Экспансионизм': 'mining', 'Изоляционизм': 'intel', 'Ксенофилия': 'trade', 'Ксенофобия': 'training',
    'Спиритуализм': 'training', 'Трансгуманизм': 'science', 'Экоцентризм': 'mining', 'Индустриализм': 'factory',
  },
};
// Бесплатная стартовая технология (по идеологии).
const EC_DOCTRINE_TECH = {
  'Технократия (Культ науки)': 'Продвинутые реакторы (корабли)',
  'Милитаризм (Культ силы)':   'Продвинутая броня (наземка)',
  'Трансгуманизм':             'Продвинутые щиты (наземка)',
  'Индустриализм':             'Продвинутые двигатели (корабли)',
  'Изоляционизм':              'Продвинутые щиты (наземка)',
  'Ксенофобия':                'Продвинутая броня (наземка)',
};
function ecBuildName(bt) { return (typeof EC_BUILD !== 'undefined' && EC_BUILD[bt]) ? EC_BUILD[bt].name : bt; }
// Считает итоговые модификаторы доктрины для анкеты app (по умолчанию — текущая фракция).
function ecFactionMods(app) {
  app = app || (typeof EC !== 'undefined' && EC.app) || {};
  const f = {}; [...EC_MOD_PCT, ...EC_MOD_FLAT].forEach(k => f[k] = 0);
  const add = m => { if (m) for (const k in m) f[k] = (f[k] || 0) + m[k]; };
  add(EC_MODS.gov[app.gov]); add(EC_MODS.regime[app.regime]);
  add(EC_MODS.ideology[app.ideology]); add(EC_MODS.race[app.race]);
  add(EC_MODS.civ[app.civ_type]);
  add((EC_CAPITAL[app.capital_env] || {}).mods);   // лёгкий бонус планеты-столицы
  // Бонусы изученных политических технологий (зеркало SQL _faction_mods).
  // Применяются к текущей фракции (research лежит в EC.eco, не в анкете).
  if (typeof EC !== 'undefined' && EC.eco && Array.isArray(EC.eco.research) && (!app || app === EC.app)) {
    EC.eco.research.forEach(id => add(EC_RESEARCH_BONUS[id]));
  }
  const clamp = (v, lo) => Math.max(lo, 1 + v);
  return {
    gc: clamp(f.gc, 0.3), mine: clamp(f.mine, 0.3), build: clamp(f.build, 0.3),
    research: clamp(f.research, 0.3),
    sci_flat: Math.round(f.sci_flat), agents_flat: Math.round(f.agents_flat),
    colonize: clamp(f.colonize, 0.3),
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
  // Роботы: пригодны ВСЕ колонизируемые типы планет (нет терраформа) — расплата
  //   за это в сильном денежном дебафе (см. EC_MODS.race). Зеркало: _race_native_envs.
  'Синтетики / Киборги': ['terrestrial', 'oceanic', 'desert', 'volcanic', 'lava', 'cryo', 'micro', 'exotic'],
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
// Небожители: конфиг станции, если ИЗУЧЕНА технология, открывающая группу планет g.
function ecStationFor(group) {
  const done = (EC.eco && EC.eco.research) || [];
  for (const n of EC_POLITICS) {
    if (n.special === 'station' && n.station && n.station.groups.includes(group) && done.includes(n.id)) return n.station;
  }
  return null;
}
// Технология-станция, которая ОТКРЫЛА БЫ группу g (для подсказки «нужна технология»).
function ecStationTechFor(group) {
  return EC_POLITICS.find(n => n.special === 'station' && n.station && n.station.groups.includes(group)) || null;
}

// ── Производство ────────────────────────────────────────────
const EC_BLD_LABEL = { training: 'Центр Подготовки', military_factory: 'Военный Завод', shipyard: 'Корабельная Верфь' };
const EC_VEH_WEIGHT = { tank_light: 1, tank_mbt: 2, tank_heavy: 4, tank_walker: 4, btr_wheel: 1, bmp_track: 2, btr_hover: 1, art_mortar: 1, art_sau: 2, art_rszo: 2, art_laser: 4 };
const EC_GROUND_WEIGHT = { light: 1, medium: 2, artillery: 2, heavy: 4, walker: 4 };
function ecUnitWeight(u) { return EC_GROUND_WEIGHT[(u && u.data && u.data.class) || ''] || 2; }
function ecSlotsSum(t) { return EC.buildings.filter(b => b.btype === t).reduce((a, b) => a + (b.slots_open || 0), 0); }
// ── Раса/правление «роботов»: раса «Синтетики / Киборги» ИЛИ правление
//    «Машинный разум (ИИ)». Роботы: пехота на Военном Заводе (×3), 2 слота
//    исследований, 2 захвата систем за цикл. Зеркало: public._faction_is_robot().
function ecIsRobot() {
  const a = EC.app || {};
  return a.race === 'Синтетики / Киборги' || a.gov === 'Машинный разум (ИИ)';
}
const EC_INF_PER_SLOT = 1000, EC_ROBOT_INF_PER_SLOT = 3000;
function ecCaps() {
  const tr = ecSlotsSum('training'), mf = ecSlotsSum('military_factory'), sy = ecSlotsSum('shipyard');
  const robot = ecIsRobot();
  // Роботы «собирают» пехоту как технику — на Военном Заводе, втрое эффективнее.
  const infFromMf = robot ? mf * EC_ROBOT_INF_PER_SLOT : 0;
  const infFromTr = tr * EC_INF_PER_SLOT;
  return {
    training: robot ? infFromMf : infFromTr,   // суммарная мощность пехоты
    military: mf * 100, ships: sy, mla: sy * 12,
    hasTraining: robot ? mf > 0 : tr > 0,       // у роботов «носитель пехоты» = Военный Завод
    hasMil: mf > 0, hasShipyard: sy > 0, robot,
  };
}
// Сколько пехоты / техники / кораблей «съедает» дивизия за ход.
// Пехота → мощность Центра Подготовки (caps.training), наземная техника и авиация →
// Военный Завод (caps.military), корабли в составе → Верфь (caps.ships).
// Физическое количество = model.count × count блока (пехота 1000, техника 100, авиация 10).
function ecDivManpower(div) {
  const blocks = (div.data && div.data.blocks) || [];
  let inf = 0, tech = 0, ships = 0;
  blocks.forEach(b => {
    const id = b.modelId || '';
    const c = b.count || 1;
    if (id.indexOf('tech:') === 0) {
      const u = EC.designs.find(d => d.id === id.slice(5));
      if (u && u.category === 'ship') ships += c; else tech += c;
    } else {
      const m = (typeof CN_DIV_DATA !== 'undefined') ? CN_DIV_DATA.find(x => x.id === id) : null;
      if (!m) return;
      const units = (m.count || 1) * c;
      if (m.type === 'inf') inf += units; else tech += units;
    }
  });
  return { inf, tech, ships };
}
function ecPendingUse() {
  let ships = 0, inf = 0, tech = 0;
  EC.queue.forEach(q => {
    const qty = q.qty || 1;
    if (q.category === 'ship') { ships += qty; return; }
    if (q.category === 'division') {
      const d = EC.designs.find(x => x.id === q.unit_id && x.category === 'division');
      if (d) { const mp = ecDivManpower(d); inf += mp.inf * qty; tech += mp.tech * qty; ships += mp.ships * qty; }
    }
  });
  return { ships, inf, tech };
}
function ecHasBuilding(bt) { return EC.buildings.some(b => b.btype === bt); }
// Имя компонента состава дивизии (сток или зарегистрированная техника)
function ecDivCompName(modelId) {
  if ((modelId || '').indexOf('tech:') === 0) { const u = EC.designs.find(d => d.id === modelId.slice(5)); return u ? u.name : 'техника'; }
  const m = (typeof CN_DIV_DATA !== 'undefined') ? CN_DIV_DATA.find(x => x.id === modelId) : null;
  return m ? m.name : (modelId || '—');
}
// Какие здания нужны под состав дивизии: пехота→Подготовка, техника→Воензавод, корабль→Верфь.
// Роботы: пехота тоже собирается на Военном Заводе (Центр Подготовки им не нужен).
function ecDivReqBuildings(div) {
  const blocks = (div.data && div.data.blocks) || [];
  const infBld = ecIsRobot() ? 'military_factory' : 'training';
  const need = new Set();
  blocks.forEach(b => {
    const id = b.modelId || '';
    if (id.indexOf('tech:') === 0) {
      const u = EC.designs.find(d => d.id === id.slice(5));
      const cat = u ? u.category : 'ground';
      need.add(cat === 'ship' ? 'shipyard' : 'military_factory');
    } else {
      const m = (typeof CN_DIV_DATA !== 'undefined') ? CN_DIV_DATA.find(x => x.id === id) : null;
      need.add((m && m.type === 'inf') ? infBld : 'military_factory');
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
      // Пираты срезали караваны за этот период — иначе доход «меньше превью» без объяснений.
      if (tick.income && tick.income.pirate) {
        const lost = tick.income.pirate_loss ? ` (~${ecNum(tick.income.pirate_loss)} ГС)` : '';
        toast(`🏴‍☠ Караваны атакованы пиратами — потеряно${lost} торгового дохода`, 'err');
      }
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
  const [ecoRows, cols, blds, sys, designs, prod, allSys, lanes, facs, routes, loans, missions, projects, alerts, relations, barters, techOffers, myRaids, raidStatus, tradeCargo, spyAgency, diploStatus, incomeHistory] = await Promise.all([
    dbGet('faction_economy', `faction_id=eq.${fid}`),
    dbGet('colonies', `faction_id=eq.${fid}&order=created_at.asc`).catch(() => []),
    dbGet('colony_buildings', `faction_id=eq.${fid}&order=created_at.asc`).catch(() => []),
    dbGet('map_systems', `faction=eq.${fid}&select=id,name,planets`).catch(() => []),
    dbGet('faction_units', `or=(faction_id.eq.${fid},faction_id.is.null)&order=name.asc`).catch(() => []),
    dbGet('unit_production', `faction_id=eq.${fid}&order=created_at.desc`).catch(() => []),
    dbGet('map_systems', `select=id,name,faction,x,y,planets`).catch(() => []),
    dbGet('map_hyperlanes', `select=a_id,b_id`).catch(() => []),
    dbGet('faction_applications', `status=eq.approved&select=faction_id,name&order=name.asc`).catch(() => []),
    dbGet('trade_routes', `order=created_at.desc`).catch(() => []),
    dbGet('loans', `order=created_at.desc`).catch(() => []),
    // ТОЛЬКО свои операции (приватность); цель видит входящие через RPC (исполнитель скрыт, если не раскрыт)
    dbGet('spy_missions', `actor_fid=eq.${fid}&order=created_at.desc&limit=40`).catch(() => []),
    dbGet('colony_projects', `faction_id=eq.${fid}&order=ready_at.asc`).catch(() => []),
    ecRpc('spy_incoming').catch(() => []),
    // Отношения: только свои пары (RLS отдаёт где я from или to)
    dbGet('faction_relations', `or=(from_fid.eq.${fid},to_fid.eq.${fid})`).catch(() => []),
    // Предложения обмена (RLS отдаёт где я from или to)
    dbGet('barter_offers', `status=eq.pending&order=created_at.desc`).catch(() => []),
    // Предложения продажи технологий/чертежей (RLS отдаёт где я продавец или покупатель)
    dbGet('tech_offers', `status=eq.pending&order=created_at.desc`).catch(() => []),
    // Рейды: только свои (RLS); статус флота для панели
    dbGet('raid_missions', `actor_fid=eq.${fid}&order=created_at.desc&limit=40`).catch(() => []),
    ecRpc('raid_status').catch(() => null),
    ecRpc('trade_capacity').catch(() => null),   // грузоподъёмность торгового флота
    ecRpc('spy_recruits_list').catch(() => null),   // агентура: ростер + еженедельный рынок рекрутов
    ecRpc('diplo_status').catch(() => null),         // союзы: федерация/конфедерация + вассалитеты
    dbGet('income_history', `owner_id=eq.${user.id}&order=tick_at.desc&limit=14`).catch(() => []),  // доход по времени
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
  EC.missions = missions || [];                 // мои операции (active + done)
  EC.alerts = alerts || [];                      // входящие операции против меня (исполнитель скрыт, если не раскрыт)
  EC.relations = relations || [];                // дипотношения (мои пары)
  EC.barters = barters || [];                    // активные предложения обмена (мои пары)
  EC.techOffers = techOffers || [];              // предложения продажи технологий/чертежей (мои пары)
  EC.raids = myRaids || [];                       // мои рейды (active + done)
  EC.raidStatus = raidStatus || { ships: 0, convoy: 0, raids: 0, policy: 0, free: 0 };  // статус флота
  EC.tradeCargo = tradeCargo || { total: 0, used: 0, free: 0 };   // грузоподъёмность торгового флота
  EC.spyAgency = spyAgency || { cap: 0, hired: 0, roster: [], recruits: [], refresh_at: null };  // агентура: ростер + рынок
  EC.diplo = diploStatus || { union: null, members: [], invites: [], vassals: [] };  // союзы и вассалитеты
  EC.incomeHistory = incomeHistory || [];   // снимки дохода по тикам (доход по времени)
  EC.dossiers = (missions || []).filter(m => m.outcome === 'success' && (m.op === 'recon_basic' || m.op === 'recon_deep')); // мои разведданные
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
// Наука/агенты — ПЛОСКИЙ бонус доктрины (+N/сут), а не процент (они дискретны).
// Активная дестабилизация (вражеская операция) режет ГС-доход на debuff_pct,
// пока не истёк debuff_until. Зеркало economy_accrue на сервере. Доля 0..1.
function ecDebuffPct() {
  const e = EC.eco;
  if (e && e.debuff_until && new Date(e.debuff_until) > new Date()) return Math.max(0, Math.min(1, +e.debuff_pct || 0));
  return 0;
}
function ecIncomePreview() {
  let gc = 0, science = 0, agents = 0;
  EC.buildings.forEach(b => { const i = ecBuildingIncome(b); gc += i.gc; science += i.science; if (b.btype === 'intel') agents += b.slots_open; });
  const m = ecFactionMods();
  const dz = ecDebuffPct();
  const gcMul = m.gc * (1 - dz);   // доктрина × срез дестабилизации
  return {
    gc: Math.round(gc * gcMul),
    science: Math.max(0, science + m.sci_flat),
    agents: Math.max(0, agents + m.agents_flat),
    base: { gc, science, agents }, mods: m, debuff: dz, gcMul,
  };
}
// Доход с активных караванов за сутки — единый источник для шапки и обзора («Казна»).
// Исходящие (я продаю) учитывают доктрину (× m.gc); входящие — доля партнёра (EC_DEST_CUT).
function ecCaravanIncome() {
  const m = ecFactionMods();
  const act = (EC.routes || []).filter(r => r.status === 'active');
  const out = act.filter(r => r.a_fid === EC.fid);   // исходящие — я продаю
  const inn = act.filter(r => r.b_fid === EC.fid);   // входящие — доля партнёра
  const outGc = Math.round(out.reduce((a, r) => a + (r.volume || 0) * (r.price || 0), 0) * (m.gc || 1));
  const inGc  = inn.reduce((a, r) => a + Math.round((r.volume || 0) * (r.price || 0) * EC_DEST_CUT), 0);
  return { out: outGc, inc: inGc, net: outGc + inGc, outRoutes: out, inRoutes: inn };
}
// Итоговый ГС-доход за сутки в разбивке (постройки + караваны) — чтобы шапка «Доход / сутки»
// совпадала с «Чистым доходом» в обзоре. Постройки учитывают доктрину и срез дестабилизации.
function ecGcIncome() {
  const inc = ecIncomePreview();
  const gcMul = inc.gcMul != null ? inc.gcMul : 1;
  const factory = Math.round(ecSlotsSum('factory') * 200 * gcMul);
  const trade   = Math.round(ecSlotsSum('trade') * 100 * gcMul);
  const cv = ecCaravanIncome();
  return { factory, trade, caravan: cv, net: factory + trade + cv.net };
}
function ecResEntries() { const res = (EC.eco && EC.eco.resources) || {}; return Object.keys(res).map(k => [k, +res[k] || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]); }
// Множитель богатства месторождения (amt с карты) — зеркало public._richness_mult.
const EC_RICHNESS = { 'колоссально': 3.0, 'очень много': 2.5, 'много': 2.0, 'умеренно': 1.5, 'мало': 1.0, 'следы': 0.6 };
function ecRichMult(amt) { const v = EC_RICHNESS[String(amt || '').trim()]; return v == null ? 1.5 : v; }
// Добыча за слот/сутки: редкость × богатство месторождения × доктрина — зеркало economy_accrue.
function ecMineRate(rar, amt) { return Math.max(1, Math.round((EC_RES_RATE[rar || 'common'] || 25) * ecRichMult(amt) * ecFactionMods().mine)); }
// Стоимость экспансии (колонизация/терраформ/обустройство) с учётом доктрины (mods.colonize).
function ecColonizeCost(base) { return Math.max(1, Math.round((base || 0) * ecFactionMods().colonize)); }
// Стоимость построек и слотов с учётом доктрины (mods.build).
function ecBuildCost(base) { return Math.max(1, Math.round((base || 0) * ecFactionMods().build)); }
// Стоимость исследования с учётом доктрины (mods.research) — дешевле = больше техов доступно.
function ecResearchCost(base) { return Math.max(1, Math.round((base || 0) * ecFactionMods().research)); }

// Ресурсы планеты для mining-здания (из данных карты или снимка колонии)
function ecMiningPlanetRes(b) {
  const colony = EC.colonies.find(c => c.id === b.colony_id);
  if (!colony) return [];
  // ИСТИНА — снимок самой колонии (его же использует сервер при начислении добычи).
  // По имени матчить нельзя: в системе бывают ДВЕ планеты с одинаковым именем,
  // и .find хватает не ту (часто пустого двойника) → ресурсы «пропадают».
  if (Array.isArray(colony.resources) && colony.resources.length) return colony.resources.filter(r => r && r.name);
  const sys = EC.systems.find(s => s.id === colony.system_id);
  const planet = ecFindPlanet(sys, colony.planet_name, colony.planet_pid) || colony;
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
      const rate = ecMineRate(ri.r || 'common', ri.amt);
      totals.set(name, (totals.get(name) || 0) + rate);
    });
  });
  if (!totals.size) {
    const totalSlots = mBlds.reduce((s, b) => s + b.slots_open, 0);
    return `<div class="ec-pl-mine ec-mine-empty">⛏ Добывающий завод (${totalSlots} слот.) — раскройте колонию и выберите месторождения</div>`;
  }
  const chips = [...totals.entries()].map(([name, total]) => {
    const ri = res.find(r => r.name === name) || {};
    return `<span class="ec-rchip ec-rchip-mine ec-rar-${ri.r || 'common'}" title="${esc(name)}: +${total}/сут"><span class="ec-rchip-i">${ecResIcon(name)}</span>${esc(name)} <b>+${total}</b></span>`;
  }).join('');
  return `<div class="ec-pl-mine"><span class="ec-pl-lbl">⛏ Добывается:</span>${chips}<span class="ec-mine-hint">/сут</span></div>`;
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
// Назначить/снять один слот добычи на ресурс (delta = +1 / -1).
// targets — массив имён ресурсов с допустимыми повторами: ["Железо","Железо","Золото"]
// = 2 слота на Железо, 1 на Золото. Каждый слот добывает по своему rate.
function ecMineCell(bid, resName, delta) {
  const b = EC.buildings.find(x => x.id === bid);
  if (!b) return;
  const targets = [...(Array.isArray(b.mining_targets) ? b.mining_targets : [])];
  if (delta > 0) {
    if (targets.length >= b.slots_open) { toast(`Все слоты заняты (${b.slots_open}/${b.slots_open}) — откройте ещё слот`, 'err'); return; }
    targets.push(resName);
  } else {
    const idx = targets.indexOf(resName);
    if (idx < 0) return;
    targets.splice(idx, 1);
  }
  ecMiningAssign(bid, targets);
}

// ── Рендер кабинета ─────────────────────────────────────────
function ecTreasuryHtml() {
  const inc = ecIncomePreview();
  const gcNet = ecGcIncome().net;   // постройки + караваны — как «Чистый доход» в обзоре
  const incParts = [];
  if (gcNet) incParts.push(`<span style="color:var(--gd)">+${ecNum(gcNet)} ГС</span>`);
  if (inc.science) incParts.push(`<span style="color:var(--pu)">+${ecNum(inc.science)} ОН</span>`);
  const incLine = incParts.length ? incParts.join(' · ') : '<span style="color:var(--t4)">нет дохода — откройте слоты</span>';
  let nextHtml = '';
  if (EC.eco.last_tick) {
    const start = new Date(EC.eco.last_tick).getTime();
    nextHtml = ecProgress(start, start + 86400000, 'доход готов к начислению');
  }
  const entries = ecResEntries();
  const resIco = (n) => (typeof resIconHtml === 'function') ? resIconHtml(n) : '<span class="res-ic res-ic-emoji">◈</span>';
  const resHtml = entries.length
    ? entries.map(([n, v]) => `<div class="ec-rchip ec-res-click" title="${esc(n)}" onclick="ecSetTab('trade')"><span class="ec-rchip-ic">${resIco(n)}</span><b>${ecNum(v)}</b><span class="ec-rchip-n">${esc(n)}</span></div>`).join('')
    : '<div class="ec-rchip-empty">Склад пуст — переведите добывающие заводы в режим 📦 Склад, чтобы копить ресурсы.</div>';
  return `<div class="ec-stats">
      <div class="ec-stat"><span class="ec-stat-ic" style="color:var(--gd)">⛃</span><div class="ec-stat-tx"><span class="ec-stat-k">Галактический стандарт</span><span class="ec-stat-v" style="color:var(--gd)">${ecNum(EC.eco.gc)} ГС</span></div></div>
      <div class="ec-stat"><span class="ec-stat-ic" style="color:var(--pu)">🔬</span><div class="ec-stat-tx"><span class="ec-stat-k">Очки науки</span><span class="ec-stat-v" style="color:var(--pu)">${ecNum(EC.eco.science)} ОН</span></div></div>
      <div class="ec-stat ec-stat-inc"><span class="ec-stat-ic">📈</span><div class="ec-stat-tx"><span class="ec-stat-k">Доход / сутки</span><span class="ec-stat-v" style="font-size:14px">${incLine}</span>${nextHtml ? `<span class="ec-next">${nextHtml}</span>` : ''}</div></div>
    </div>
    <div class="ec-resbar">
      <div class="ec-resbar-hd"><span>Ресурсы планет</span><span class="ec-resbar-n">${entries.length} ${entries.length === 1 ? 'вид' : 'вид(ов)'}</span></div>
      <div class="ec-resbar-list">${resHtml}</div>
    </div>`;
}

// Вводный блок-объяснялка вверху вкладки: что это, как работает, что делать.
// text — короткая суть (HTML допустим), hints — список ключевых правил/цифр.
function ecIntro(icon, title, text, hints) {
  const list = (hints && hints.length)
    ? `<ul class="ec-intro-hints">${hints.map(h => `<li>${h}</li>`).join('')}</ul>` : '';
  return `<div class="ec-intro">
    <div class="ec-intro-hd"><span class="ec-intro-ic">${icon}</span><b>${esc(title)}</b></div>
    <div class="ec-intro-tx">${text}</div>${list}</div>`;
}

function ecPaintCabinet() {
  const col = ecReadable(EC.app.color);
  const tabs = [['overview', '◈', 'Обзор'], ['colonies', '🏗', 'Колонии'], ['forces', '⚔', 'Вооружённые силы'], ['milbuild', '🏭', 'Военпром'], ['research', '🔬', 'Исследования'], ['territory', '🌐', 'Территория'], ['trade', '⇄', 'Торговля'], ['diplomacy', '🤝', 'Дипломатия'], ['intel', '🕵', 'Разведка'], ['raids', '🏴‍☠', 'Рейды'], ['news', '📰', 'Новости']];
  const tabsHtml = tabs.map(([id, ic, l]) => `<button class="ec-tab${EC.tab === id ? ' on' : ''}" onclick="ecSetTab('${id}')"><span class="ec-tab-ic">${ic}</span><span class="ec-tab-l">${l}</span></button>`).join('');
  const body = EC.tab === 'overview' ? ecTabOverview() : EC.tab === 'forces' ? ecTabForces()
    : EC.tab === 'milbuild' ? ecTabMilBuild()
    : EC.tab === 'research' ? ecTabResearch() : EC.tab === 'territory' ? ecTabTerritory()
    : EC.tab === 'trade' ? ecTabTrade()
    : EC.tab === 'diplomacy' ? ecTabDiplomacy() : EC.tab === 'intel' ? ecTabIntel()
    : EC.tab === 'raids' ? ecTabRaids()
    : EC.tab === 'news' ? ecTabNews() : ecTabColonies();
  const img = (EC.app && (EC.app.herald_url || EC.app.image_url)) || '';
  const coverBg = img
    ? `<img class="ec-cover-img" src="${esc(img)}" alt=""><div class="ec-cover-fade"></div>`
    : `<div class="ec-cover-bg" style="background:linear-gradient(135deg, ${col}33, var(--b1) 70%)"></div>`;
  setPg(`<div class="ec-wrap">
    <div class="ec-cover" style="--fac:${col}">
      ${coverBg}
      <div class="ec-cover-scan"></div>
      <div class="ec-cover-hud hud-tl"></div><div class="ec-cover-hud hud-tr"></div>
      <div class="ec-cover-inner">
        <div class="ec-cover-row">
          <h1 class="ec-cover-title">${esc(EC.app.name || 'Моя фракция')}</h1>
          <div class="ec-cover-btns">
            <button class="btn btn-gh btn-sm" onclick="go('guide')" title="Полные правила и механики игры">❓ Как играть</button>
          </div>
        </div>
        ${ecTreasuryHtml()}
      </div>
    </div>
    <div class="ec-tabs">${tabsHtml}</div>
    <div class="ec-tabbody">${body}</div>
  </div>`);
  if (EC.tab === 'trade') { try { ecCvSync(); } catch (e) {} } // флот каравана → объём/эскорт + живой расчёт
  if (EC.tab === 'intel') { try { ecSpyCalcLive(); } catch (e) {} }   // живой расчёт операции
  if (EC.tab === 'research') {
    const sc = document.querySelector('.ec-tree-scroll');
    if (sc && !sc._wheelBound) {
      sc._wheelBound = true;
      sc.addEventListener('wheel', e => { if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) { sc.scrollLeft += e.deltaY * 0.8; e.preventDefault(); } }, { passive: false });
      let drag = null;
      sc.addEventListener('mousedown', e => { if (e.button !== 0 || e.target.closest('button')) return; drag = { x: e.clientX, sl: sc.scrollLeft }; });
      sc.addEventListener('mousemove', e => { if (!drag) return; const dx = e.clientX - drag.x; sc.scrollLeft = drag.sl - dx; });
      sc.addEventListener('mouseup', () => { drag = null; });
      sc.addEventListener('mouseleave', () => { drag = null; });
    }
  }
  // Новости: контейнер уже в DOM — дозаполняем асинхронно (как в faction_news.js)
  if (EC.tab === 'news') {
    const mount = document.getElementById('ec-news-mount');
    if (mount && typeof fnRenderNewsTab === 'function') { fnRenderNewsTab(mount); }
  }
}
function ecSetTab(t) { EC.tab = t; ecPaintCabinet(); }

// Вкладка «Новости»: статический каркас, тело подгружает faction_news.js.
function ecTabNews() {
  return ecIntro('📰', 'Новости фракции',
    'Пишите новости от лица своего государства. После проверки администрацией они выходят на главной в «Вестнике фракций».',
    ['Кнопка <b>«Написать новость»</b> — ниже.',
     'Новость уходит на <b>модерацию</b>, затем публикуется или отклоняется.',
     'Опубликованные новости видны всем на главной странице.'])
    + `<div id="ec-news-mount"><div class="ec-empty">Загрузка…</div></div>`;
}

// Чипы эффектов ОДНОГО выбора в анкете (cat: gov|regime|ideology|race|civ; value: значение).
function ecChoiceChips(cat, value) {
  const m = (cat === 'capital') ? (EC_CAPITAL[value] || {}).mods : (EC_MODS[cat] || {})[value];
  if (!m) return '';
  const PCT = { gc: 'ГС-доход', mine: 'Добыча' };
  const COST = { build: 'Постройки/слоты', colonize: 'Колонизация планет', claim_cost: 'Колонизация систем: цена', research: 'Исследования' };
  const chips = [];
  const chip = (good, txt) => chips.push(`<span class="ec-doc-chip ${good ? 'good' : 'bad'}">${txt}</span>`);
  // плоские: наука / агенты (+N в сутки)
  if (m.sci_flat) chip(m.sci_flat > 0, `Наука ${m.sci_flat > 0 ? '+' : ''}${m.sci_flat} ОН/сут`);
  if (m.agents_flat) chip(m.agents_flat > 0, `Агенты ${m.agents_flat > 0 ? '+' : ''}${m.agents_flat}/сут`);
  // процентные доход/добыча (выше = лучше)
  ['gc', 'mine'].forEach(k => { if (m[k]) { const p = Math.round(m[k] * 100); chip(p > 0, `${PCT[k]} ${p > 0 ? '+' : ''}${p}%`); } });
  // процентные стоимости (ниже = лучше)
  ['build', 'colonize', 'claim_cost', 'research'].forEach(k => { if (m[k]) { const p = Math.round(m[k] * 100); chip(p < 0, `${COST[k]} ${p > 0 ? '+' : ''}${p}%`); } });
  if (m.claim_cd) { const p = Math.round(m.claim_cd * 100); chip(p < 0, `Кулдаун колонизации систем ${p > 0 ? '+' : ''}${p}%`); }
  // конкретные плюшки: бонусная постройка и/или технология
  const bgBld = (EC_DOCTRINE_BUILD[cat] || {})[value];
  if (bgBld) chips.push(`<span class="ec-doc-chip grant">🏗 +${esc(ecBuildName(bgBld))}</span>`);
  if (cat === 'ideology' && EC_DOCTRINE_TECH[value]) chips.push(`<span class="ec-doc-chip grant">🔬 ${esc(EC_DOCTRINE_TECH[value])}</span>`);
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
  const flat = (label, v, unit) => v ? `<span class="ec-doc-chip ${v > 0 ? 'good' : 'bad'}">${label} ${v > 0 ? '+' : ''}${v}${unit}</span>` : '';
  const out = [
    chip('📈 ГС-доход', m.gc), chip('⛏ Добыча', m.mine),
    flat('🔬 Наука', m.sci_flat, ' ОН/сут'), flat('🕵 Агенты', m.agents_flat, '/сут'),
    chip('🏗 Постройки/слоты', m.build, false), chip('🧪 Исследования', m.research, false),
    chip('🪐 Колонизация планет', m.colonize, false), chip('⚑ Захват систем: цена', m.claim_cost, false),
  ];
  const cdP = pct(m.claim_cd);
  if (cdP) out.push(`<span class="ec-doc-chip ${cdP < 0 ? 'good' : 'bad'}">⏳ ${cdP < 0 ? `Захват систем чаще ×${(1 / m.claim_cd).toFixed(1)}` : `Захват систем реже +${cdP}%`}</span>`);
  return out.filter(Boolean).join('');
}
// Особые способности (не-процентные механики): роботы, «Дом в небесах».
function ecDoctrineSpecials(app) {
  app = app || EC.app || {};
  const isRobot = app.race === 'Синтетики / Киборги' || app.gov === 'Машинный разум (ИИ)';
  const research = (EC.eco && EC.eco.research) || [];
  const out = [];
  if (isRobot) {
    out.push('🪐 Все планеты родные — без терраформа');
    out.push('⚙ Пехота на Военном Заводе ×3');
    out.push('🔬 2 исследования параллельно');
    out.push('⬢ 2 захвата подряд, затем перезарядка');
  } else if (research.includes('pol.house_heavens')) {
    out.push('⬢ 2 захвата подряд, затем перезарядка — «Дом в небесах»');
  }
  // Небожители: разблокированные станции на непригодных мирах.
  EC_POLITICS.forEach(n => {
    if (n.special === 'station' && n.station && research.includes(n.id)) {
      out.push(`${n.station.icon || '★'} ${n.name} — станция на ${n.station.cells} ячеек`);
    }
  });
  return out;
}
// Сводка конкретных стартовых плюшек доктрины (постройки + технологии).
function ecDoctrineGrants(app) {
  app = app || EC.app || {};
  const blds = [(EC_DOCTRINE_BUILD.gov || {})[app.gov], (EC_DOCTRINE_BUILD.ideology || {})[app.ideology]].filter(Boolean);
  const tech = EC_DOCTRINE_TECH[app.ideology];
  const items = [];
  blds.forEach(bt => items.push(`<span class="ec-doc-chip grant">🏗 ${esc(ecBuildName(bt))}</span>`));
  if (tech) items.push(`<span class="ec-doc-chip grant">🔬 ${esc(tech)}</span>`);
  return items;
}
function ecDoctrineHtml(app) {
  app = app || EC.app || {};
  const chips = ecDoctrineChips(app);
  if (!chips) return '';
  const sub = [app.gov, app.regime, app.ideology, app.race, app.civ_type === 'frontier' ? 'Фронтир' : (app.civ_type === 'colony' ? 'Колония' : '')].filter(Boolean).map(esc).join(' · ');
  const grants = ecDoctrineGrants(app);
  const specials = ecDoctrineSpecials(app);
  return `<div class="ec-doctrine">
    <div class="ec-doctrine-hd">⚜ Доктрина государства <span class="ec-hint">реальные эффекты вашего выбора при регистрации</span></div>
    ${sub ? `<div class="ec-doctrine-sub">${sub}</div>` : ''}
    ${specials.length ? `<div class="ec-doctrine-grants"><span class="ec-doctrine-grants-t" style="color:var(--pu)">★ Особые способности:</span><div class="ec-doctrine-chips">${specials.map(s => `<span class="ec-doc-chip special">${esc(s)}</span>`).join('')}</div></div>` : ''}
    <div class="ec-doctrine-sect-t">Модификаторы</div>
    <div class="ec-doctrine-chips">${chips}</div>
    ${grants.length ? `<div class="ec-doctrine-grants"><span class="ec-doctrine-grants-t">Стартовые плюшки:</span><div class="ec-doctrine-chips">${grants.join('')}</div></div>` : ''}
  </div>`;
}

// Суммарная суточная добыча по ресурсам (по всем mining-зданиям державы).
function ecMineTotals() {
  const totals = new Map();
  EC.buildings.filter(b => b.btype === 'mining').forEach(b => {
    const res = ecMiningPlanetRes(b);
    (Array.isArray(b.mining_targets) ? b.mining_targets : []).forEach(name => {
      const ri = res.find(r => r.name === name); if (!ri) return;
      const cur = totals.get(name) || { rate: 0, r: ri.r || 'common', icon: ri.icon || '◈' };
      cur.rate += ecMineRate(ri.r || 'common'); totals.set(name, cur);
    });
  });
  return totals;
}
// Полоска заполнения used/cap (для мощностей и ячеек).
function ecOvBar(used, cap, cls) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return `<span class="ec-ovx-bar"><span class="ec-ovx-bar-fill${cls ? ' ' + cls : ''}" style="width:${pct}%"></span></span>`;
}

// Таблица «доход по времени» — снимки начислений (income_history, пишет триггер)
function ecIncomeHistoryPanel() {
  const h = EC.incomeHistory || [];
  if (!h.length) return `<div class="ec-ovx-panel" style="grid-column:1/-1"><div class="ec-ovx-panel-t">📈 Доход по времени</div><div class="ec-ovx-empty">Истории пока нет — появится после первого начисления (тика).</div></div>`;
  const maxAbs = Math.max(1, ...h.map(r => Math.abs(+r.gc_delta || 0)));
  const rows = h.map(r => {
    const d = +r.gc_delta || 0, s = +r.sci_delta || 0;
    const dt = r.tick_at ? new Date(r.tick_at) : null;
    const when = dt ? `${dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : '—';
    const w = Math.round(Math.abs(d) / maxAbs * 100);
    return `<div class="ec-ih-row">
        <span class="ec-ih-when">${esc(when)}</span>
        <span class="ec-ih-bar"><i class="${d >= 0 ? 'pos' : 'neg'}" style="width:${w}%"></i></span>
        <span class="ec-ih-gc ${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : ''}${ecNum(d)} ГС</span>
        <span class="ec-ih-sci">${s ? `+${ecNum(s)} ОН` : ''}</span>
        <span class="ec-ih-bal">казна ${ecNum(+r.gc_after || 0)}</span>
      </div>`;
  }).join('');
  return `<div class="ec-ovx-panel" style="grid-column:1/-1">
    <div class="ec-ovx-panel-t">📈 Доход по времени <span class="ec-ovx-panel-sub">последние ${h.length} начислений · чистый прирост казны за тик</span></div>
    <div class="ec-ih-list">${rows}</div>
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
  const researchTotal = researchAll.length;
  const activeProj = EC.eco.research_active;
  const activeName = activeProj ? ((researchAll.find(n => n.id === activeProj) || {}).name || activeProj) : '';
  const myRoutes = (EC.routes || []).filter(r => (r.a_fid === EC.fid || r.b_fid === EC.fid) && r.status === 'active').length;
  const myLoans = (EC.loans || []).filter(l => (l.lender_fid === EC.fid || l.borrower_fid === EC.fid) && l.status === 'active').length;
  const agentsTot = (typeof ecSpyRoster === 'function') ? ecSpyRoster().length : (EC.eco.agents || 0);
  const agentsFree = (typeof ecSpyFree === 'function') ? ecSpyFree() : agentsTot;
  const agentsCI = EC.eco.counter_agents || 0;
  const agentsOps = (typeof ecSpyCommitted === 'function') ? ecSpyCommitted() : 0;
  const inc = ecIncomePreview();
  const m = inc.mods || {};
  const col = ecReadable(EC.app.color);

  // Имя/ГС/наука/доход/тик уже показаны в постоянной шапке кабинета (ec-treasury) —
  // в обзоре НЕ повторяем (убран дублирующий hero-блок). Доход детально — в «Казне» ниже.
  const gcPct = Math.round(((m.gc || 1) - 1) * 100);

  // ── 2. КАЗНА — игровой реестр доходов/расходов ГС за сутки ──
  const gcMul = inc.gcMul != null ? inc.gcMul : (m.gc || 1);
  // Торговля и караваны: продажа (исходящие), доля партнёра (входящие), вывоз ресурсов
  const _cv = ecCaravanIncome();
  const _out = _cv.outRoutes;   // исходящие — я продаю
  const _in  = _cv.inRoutes;    // входящие — получаю долю партнёра
  const _outGc = _cv.out;
  const _inGc  = _cv.inc;
  const _resOut = {};
  _out.forEach(r => { if (r.resource) _resOut[r.resource] = (_resOut[r.resource] || 0) + (r.volume || 0); });
  const _resOutTotal = Object.values(_resOut).reduce((a, b) => a + b, 0);
  const _resOutTxt = Object.entries(_resOut).map(([n, v]) => `${ecResIcon(n)} ${ecNum(v)}`).join(' · ');
  const facSlots = ecSlotsSum('factory'), trSlots = ecSlotsSum('trade'), marketSlots = ecSlotsSum('market');
  // Источники ГС-дохода (с долей-вкладом для столбика)
  const moneyInc = [];
  if (facSlots) moneyInc.push({ ic: '🏭', name: 'Гражданские фабрики', sub: `${ecNum(facSlots)} слот. × 200`, gc: Math.round(facSlots * 200 * gcMul), tab: 'colonies' });
  if (trSlots)  moneyInc.push({ ic: '💱', name: 'Торговые хабы', sub: `${ecNum(trSlots)} слот. × 100`, gc: Math.round(trSlots * 100 * gcMul), tab: 'trade' });
  if (_out.length) moneyInc.push({ ic: '🚚', name: 'Караваны · продажа', sub: `${_out.length} пут. → партнёрам`, gc: _outGc, tab: 'trade' });
  if (_in.length)  moneyInc.push({ ic: '📦', name: 'Доля с поставок', sub: `${_in.length} пут. ← вам шлют`, gc: _inGc, tab: 'trade' });
  const netGc = moneyInc.reduce((a, x) => a + x.gc, 0);
  const maxGc = moneyInc.reduce((a, x) => Math.max(a, x.gc), 0) || 1;
  const moneyRows = moneyInc.map(x => {
    const w = Math.max(5, Math.round(x.gc / maxGc * 100));
    return `<button type="button" class="ec-bdg-row" onclick="ecSetTab('${x.tab}')">
      <span class="ec-bdg-ic">${x.ic}</span>
      <span class="ec-bdg-info"><span class="ec-bdg-name">${esc(x.name)}</span><span class="ec-bdg-sub">${esc(x.sub)}</span></span>
      <span class="ec-bdg-bar"><i style="width:${w}%"></i></span>
      <span class="ec-bdg-val pos">+${ecNum(x.gc)}</span>
    </button>`;
  }).join('');
  const marketRow = marketSlots ? `<button type="button" class="ec-bdg-row ec-bdg-var" onclick="ecSetTab('trade')">
      <span class="ec-bdg-ic">📈</span>
      <span class="ec-bdg-info"><span class="ec-bdg-name">Товарная биржа</span><span class="ec-bdg-sub">${ecNum(marketSlots)} слот. · продаёт ресурсы (50–75% по редкости)</span></span>
      <span class="ec-bdg-bar ec-bdg-bar-var"></span>
      <span class="ec-bdg-val pos">+ перем.</span>
    </button>` : '';
  const expRow = _resOutTotal ? `<button type="button" class="ec-bdg-row ec-bdg-exp" onclick="ecSetTab('trade')">
      <span class="ec-bdg-ic">📤</span>
      <span class="ec-bdg-info"><span class="ec-bdg-name">Караваны · вывоз ресурсов</span><span class="ec-bdg-sub">${_resOutTxt}</span></span>
      <span class="ec-bdg-bar"></span>
      <span class="ec-bdg-val neg">−${ecNum(_resOutTotal)} ед.</span>
    </button>` : '';
  // Прочие потоки (не деньги) — компактной строкой, без дублирования панелей
  const flows = [];
  if (inc.science) flows.push(`<span class="ec-bdg-flow" onclick="ecSetTab('research')"><span class="ec-bdg-flow-ic">🔬</span><b class="ec-ovx-c-sci">+${ecNum(inc.science)}</b> ОН/сут</span>`);
  if (inc.agents)  flows.push(`<span class="ec-bdg-flow" onclick="ecSetTab('intel')"><span class="ec-bdg-flow-ic">🕵</span><b class="ec-ovx-c-agt">+${ecNum(inc.agents)}</b> агент/сут</span>`);
  if (gcPct) flows.push(`<span class="ec-bdg-flow"><span class="ec-bdg-flow-ic">${gcPct > 0 ? '⚖' : '⚠'}</span>доктрина ${gcPct > 0 ? '+' : ''}${gcPct}% ГС</span>`);
  const hasBudget = moneyInc.length || marketSlots || _resOutTotal || flows.length;
  const budget = `<div class="ec-ovx-panel ec-bdg-panel">
    <div class="ec-ovx-panel-t">💰 Казна <span class="ec-ovx-panel-sub">доходы и расходы за сутки</span></div>
    ${hasBudget ? `
      <div class="ec-bdg-net${netGc > 0 ? ' up' : ''}">
        <span class="ec-bdg-net-k">Чистый доход / сут</span>
        <span class="ec-bdg-net-v">${netGc >= 0 ? '+' : ''}${ecNum(netGc)} <small>ГС</small></span>
        ${inc.debuff ? `<span class="ec-bdg-net-warn">🔥 дестабилизация −${Math.round(inc.debuff * 100)}%</span>` : ''}
      </div>
      ${(moneyRows || marketRow) ? `<div class="ec-bdg-rows">${moneyRows}${marketRow}</div>` : ''}
      ${flows.length ? `<div class="ec-bdg-flows">${flows.join('')}</div>` : ''}
      <div class="ec-ovx-hint">Только денежные потоки (ГС). Ресурсы и их добыча — в панели «Ресурсы» ниже. Содержания армии/зданий нет — траты разовые.${_out.length || _in.length ? ' Доход с караванов зависит от поставок и срезается пиратами.' : ''}</div>`
      : `<div class="ec-ovx-empty">Казна пуста. Постройте Гражданские фабрики во вкладке «Колонии» — это база дохода.</div>`}
  </div>`;

  // ── 3. РЕСУРСЫ — добыча/сутки + склад ──
  const mineT = ecMineTotals();
  const stock = new Map(ecResEntries());
  const resNames = new Set([...mineT.keys(), ...stock.keys()]);
  const resRows = [...resNames].map(n => {
    const mt = mineT.get(n), rate = mt ? mt.rate : 0, have = stock.get(n) || 0;
    const rar = (mt && mt.r) || ecResRarity(n) || 'common';
    return { n, rate, have, rar, icon: (mt && mt.icon) || ecResIcon(n) };
  }).sort((a, b) => (b.rate - a.rate) || (b.have - a.have));
  const resPanel = resRows.length ? `<div class="ec-ovx-panel">
    <div class="ec-ovx-panel-t">⛏ Ресурсы <span class="ec-ovx-panel-sub">добыча / склад</span></div>
    <div class="ec-ovx-res-list">${resRows.map(r => `<div class="ec-ovx-res-row ec-rar-${r.rar}">
        <span class="ec-ovx-res-ic">${ecResIcon(r.n)}</span>
        <span class="ec-ovx-res-n">${esc(r.n)}</span>
        <span class="ec-ovx-res-rate">${r.rate ? `+${ecNum(r.rate)}/сут` : '<i>не добывается</i>'}</span>
        <span class="ec-ovx-res-have">${ecNum(r.have)} <span class="ec-ovx-res-have-u">на складе</span></span>
      </div>`).join('')}</div>
  </div>` : '';

  // ── 4. ДЕРЖАВА ──
  const bldByType = {};
  EC.buildings.forEach(b => { bldByType[b.btype] = (bldByType[b.btype] || 0) + 1; });
  const bldChips = EC_ORDER.map(t => bldByType[t] ? `<span class="ec-ovx-chip"><span class="ec-ovx-chip-ic">${EC_BLD_ICON[t] || '▣'}</span>${esc(ecBuildName(t))} <b>${ecNum(bldByType[t])}</b></span>` : '').filter(Boolean).join('');
  const empire = `<div class="ec-ovx-panel ec-ovx-half">
    <div class="ec-ovx-panel-t">🏛 Держава</div>
    <div class="ec-ovx-stat-grid">
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('territory')"><div class="ec-ovx-stat-v">${ecNum(EC.systems.length)}</div><div class="ec-ovx-stat-k">Систем</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('colonies')"><div class="ec-ovx-stat-v">${ecNum(EC.colonies.length)}</div><div class="ec-ovx-stat-k">Колоний</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('colonies')"><div class="ec-ovx-stat-v">${ecNum(EC.buildings.length)}</div><div class="ec-ovx-stat-k">Построек</div></div>
      <div class="ec-ovx-stat ec-ovx-stat-wide ec-ov-clk" onclick="ecSetTab('colonies')">
        <div class="ec-ovx-stat-k">Ячейки застройки</div>
        <div class="ec-ovx-stat-barline"><b>${ecNum(usedCells)}</b> / ${ecNum(totalCells)} ${ecOvBar(usedCells, totalCells, 'fill-gc')}</div>
      </div>
    </div>
    ${bldChips ? `<div class="ec-ovx-chips">${bldChips}</div>` : ''}
  </div>`;

  // ── 5. АРМИЯ + мощности производства ──
  const caps = ecCaps(), use = (typeof ecPendingUse === 'function') ? ecPendingUse() : { ships: 0, inf: 0, tech: 0 };
  const capRow = (label, used, cap, cls) => cap ? `<div class="ec-ovx-cap">
      <span class="ec-ovx-cap-k">${esc(label)}</span>
      <span class="ec-ovx-cap-v">${ecNum(used)} / ${ecNum(cap)} за ход</span>
      ${ecOvBar(used, cap, cls)}
    </div>` : '';
  const army = `<div class="ec-ovx-panel ec-ovx-half">
    <div class="ec-ovx-panel-t">⚔ Вооружённые силы ${queued ? `<span class="ec-ovx-panel-sub ec-ov-clk" onclick="ecSetTab('milbuild')">в очереди: ${ecNum(queued)}</span>` : ''}</div>
    <div class="ec-ovx-stat-grid">
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('forces')"><div class="ec-ovx-stat-v ec-ovx-c-sci">${ecNum(ships)}</div><div class="ec-ovx-stat-k">🚀 Корабли</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('forces')"><div class="ec-ovx-stat-v ec-ovx-c-gc">${ecNum(divs)}</div><div class="ec-ovx-stat-k">⚔ Дивизии</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('forces')"><div class="ec-ovx-stat-v">${ecNum(ground)}</div><div class="ec-ovx-stat-k">🛡 Наземка</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('forces')"><div class="ec-ovx-stat-v">${ecNum(avia)}</div><div class="ec-ovx-stat-k">✈ Авиация</div></div>
    </div>
    ${(caps.training || caps.military || caps.ships) ? `<div class="ec-ovx-caps">
      ${capRow('🪖 Подготовка пехоты', use.inf || 0, caps.training, 'fill-gc')}
      ${capRow('🛠 Военный завод', use.tech || 0, caps.military, 'fill-amb')}
      ${capRow('🚀 Корабельная верфь', use.ships || 0, caps.ships, 'fill-sci')}
    </div>` : '<div class="ec-ovx-hint">Военных мощностей нет — постройте Центр Подготовки, Военный Завод или Верфь.</div>'}
  </div>`;

  // ── 6. НАУКА · ДИПЛОМАТИЯ · РАЗВЕДКА ──
  const activeHtml = activeProj
    ? `<div class="ec-ovx-active">🔬 Исследуется: <b>${esc(activeName)}</b>${EC.eco.last_tick ? ecProgress(new Date(EC.eco.last_tick).getTime(), new Date(EC.eco.last_tick).getTime() + 86400000, 'готово в конце хода') : ''}</div>` : '';
  const sci = `<div class="ec-ovx-panel">
    <div class="ec-ovx-panel-t">🔬 Наука · Дипломатия · Разведка</div>
    ${activeHtml}
    <div class="ec-ovx-stat ec-ovx-stat-wide ec-ov-clk" onclick="ecSetTab('research')">
      <div class="ec-ovx-stat-k">Изучено технологий</div>
      <div class="ec-ovx-stat-barline"><b class="ec-ovx-c-sci">${ecNum(researchDone)}</b> / ${ecNum(researchTotal)} ${ecOvBar(researchDone, researchTotal, 'fill-sci')}</div>
    </div>
    <div class="ec-ovx-stat-grid" style="margin-top:10px">
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('intel')"><div class="ec-ovx-stat-v">${ecNum(agentsTot)}</div><div class="ec-ovx-stat-k">Агенты всего</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('intel')"><div class="ec-ovx-stat-v ec-ovx-c-agt">${ecNum(agentsCI)}</div><div class="ec-ovx-stat-k">Контрразведка</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('trade')"><div class="ec-ovx-stat-v">${ecNum(myRoutes)}</div><div class="ec-ovx-stat-k">Торг. пути</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('diplomacy')"><div class="ec-ovx-stat-v">${ecNum(myLoans)}</div><div class="ec-ovx-stat-k">Займы</div></div>
    </div>
    ${agentsOps ? `<div class="ec-ovx-hint">Задействовано в операциях: <b>${ecNum(agentsOps)}</b> · свободно: <b>${ecNum(agentsFree)}</b></div>` : ''}
    ${(() => {
      const u = EC.diplo && EC.diplo.union, vs = (EC.diplo && EC.diplo.vassals) || [];
      const mine = vs.filter(v => v.overlord === EC.fid && v.status === 'active').length;
      const lord = vs.find(v => v.vassal === EC.fid && v.status === 'active');
      const parts = [];
      if (u) parts.push(`${u.kind === 'federation' ? '🛡 Федерация' : '🤝 Конфедерация'}: <b>${esc(u.name)}</b>`);
      if (mine) parts.push(`вассалов: <b>${mine}</b>`);
      if (lord) parts.push(`сюзерен: <b>${esc(lord.overlord_name)}</b>`);
      return parts.length ? `<div class="ec-ovx-hint ec-ov-clk" onclick="ecSetTab('diplomacy')">${parts.join(' · ')}</div>` : '';
    })()}
  </div>`;

  const raceNote = `<div class="ec-race-note">Раса: <b>${esc(EC.app.race || '—')}</b> · ${ecIsRobot()
    ? 'родные миры: <b>все типы планет</b> — колонизация без терраформа (бонус роботов).'
    : 'родные миры: ' + ((EC_HAB[EC.app.race] || []).map(g => EC_GRP_LABEL[g] || g).join(', ') || '—') + '. Чужие типы планет — через терраформ.'}</div>`;

  return `<div class="ec-ovx-grid">${budget}${ecIncomeHistoryPanel()}${resPanel}${empire}${army}${sci}${ecDoctrineHtml()}</div>${raceNote}
    <div class="ec-ov-links">
      <button class="btn btn-gh btn-sm" onclick="go('constructors')">⚒ Конструкторы</button>
      <button class="btn btn-gh btn-sm" onclick="go('cat-ships')">🚀 Каталоги</button>
      <button class="btn btn-gh btn-sm" onclick="go('map')">🜨 Карта</button>
    </div>`;
}

function ecToggleColony(id) { EC.openColony = (EC.openColony === id) ? null : id; ecPaintCabinet(); }
// Системы сворачиваются НЕЗАВИСИМО: EC.closedSys — множество свёрнутых id (по умолчанию все открыты).
function ecToggleSys(id) {
  if (!EC.closedSys) EC.closedSys = new Set();
  if (EC.closedSys.has(id)) EC.closedSys.delete(id); else EC.closedSys.add(id);
  ecPaintCabinet();
}
function ecAllSysIds() {
  const ids = new Set();
  (EC.systems || []).forEach(s => ids.add(s.id));
  (EC.colonies || []).forEach(c => { if (c.system_id) ids.add(c.system_id); });
  return [...ids];
}
function ecCollapseAllSys() { EC.closedSys = new Set(ecAllSysIds()); ecPaintCabinet(); }
function ecExpandAllSys() { EC.closedSys = new Set(); ecPaintCabinet(); }

// Кнопка/бейдж колонизации для незаселённой планеты
function ecColonizeInfo(s, p, race) {
  const g = ecPlanetGroup(p), label = EC_GRP_LABEL[g] || g, cells = +p.slotsP || EC_DEFAULT_CELLS;
  if (!ecColonizable(p)) {
    // Небожители: непригодный мир можно освоить станцией, если изучена технология.
    const st = ecStationFor(g);
    if (st) {
      const sc = ecColonizeCost(EC_STATION_COST);
      return { cls: 'station', tag: 'станция', label,
        btn: `<button class="btn btn-gd btn-sm" title="Построить ${esc(st.label.toLowerCase())} — малая станция на ${st.cells} ячеек застройки. Стоимость ${ecNum(sc)} ГС." onclick="event.stopPropagation();ecBuildStation('${esc(s.id)}',${ecArg(p.name)},${ecArg(p.type)},${ecArg(g)},${ecPidArg(p)})">${st.icon} Станция · ${st.cells} ячеек · ${ecNum(sc)} ГС</button>` };
    }
    const tech = ecStationTechFor(g);
    const lockTitle = tech
      ? `Непригодно для жизни. Изучите технологию «${tech.name}» (ветка Небожители), чтобы построить станцию (${tech.station.cells} ячеек).`
      : 'Газовые гиганты, аномалии и пояса заселить нельзя.';
    return { cls: 'no', tag: 'непригодна', label, btn: `<button class="btn btn-gh btn-sm" disabled title="${esc(lockTitle)}">${tech ? '🔒 нужна технология' : '— нельзя'}</button>` };
  }
  if (ecNative(p, race)) return { cls: 'native', tag: 'родная', label, btn: `<button class="btn btn-gd btn-sm" onclick="event.stopPropagation();ecColonize('${esc(s.id)}',${ecArg(p.name)},${ecArg(p.type)},${cells},0,${ecPidArg(p)})">Колонизировать · ${ecNum(ecColonizeCost(EC_COLONIZE_COST))} ГС</button>` };
  // Чужая планета — терраформ с уровнем сложности (срок + ОН)
  const pend = ecPendingTerraform(s.id, p.name, p.pid);
  if (pend) return { cls: 'foreign', tag: 'чужая', label, btn: `<span class="ec-proj-tag" title="${ecProjEtaTxt(pend)}">⏳ терраформ (${ecProjEtaTxt(pend)})</span>` };
  const tier = ecTerraTier(p, race), spec = EC_TERRA[tier];
  const costTxt = `${ecNum(ecColonizeCost(spec.gc))} ГС${spec.science ? ` + ${ecNum(spec.science)} ОН` : ''}`;
  // одна понятная кнопка: заселить нельзя — но можно терраформировать (сложность + цена + срок)
  return { cls: 'foreign', tag: 'чужая', label,
    btn: `<button class="btn btn-sm ec-terra-btn ec-terra-t${tier}" title="Заселить сразу нельзя. Терраформировать (${spec.label.toLowerCase()}) → затем станет колонией. Стоимость ${costTxt}, срок ${spec.turns} ход(ов)." onclick="event.stopPropagation();ecColonize('${esc(s.id)}',${ecArg(p.name)},${ecArg(p.type)},${cells},1,${ecPidArg(p)})">🌱 Терраформ · ${spec.label} · ${costTxt} · ${spec.turns} ход.</button>` };
}

// Чипы ресурсов планеты (иконка + название + цвет по редкости)
function ecPlanetResChips(p) {
  const res = (p && Array.isArray(p.resources)) ? p.resources.filter(r => r && r.name) : [];
  if (!res.length) return '<span class="ec-nres">◌ ресурсов нет</span>';
  return res.map(r => {
    const rar = r.r || 'common';
    return `<span class="ec-rchip ec-rar-${rar}" title="${esc(r.name)} · ${rar}"><span class="ec-rchip-i">${ecResIcon(r.name)}</span>${esc(r.name)}</span>`;
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
  const pendBuilds = (EC.projects || []).filter(p => p.kind === 'build' && p.colony_id === c.id);
  const used = blds.length + pendBuilds.length, cap = c.cells || EC_DEFAULT_CELLS, full = used >= cap;
  const pendBldHtml = pendBuilds.map(p => {
    const d = EC_BUILD[p.btype] || {};
    return `<div class="ec-bld-row ec-bld-pending">
      <span class="ec-bld-name">🏗 ${esc(d.name || p.btype)}</span>
      <span class="ec-proj-tag">⏳ ${ecProjEtaTxt(p)}</span>
      <button class="ec-bld-del" title="Отменить постройку (возврат затрат)" onclick="ecCancelProject('${p.id}')">✕</button>
    </div>`;
  }).join('');
  const bHtml = blds.map(ecBuildingRow).join('') + pendBldHtml || `<div class="ec-empty" style="padding:8px 0">Пусто. Постройте структуру ↓</div>`;
  const pendHab = ecPendingHabitat(c.id);
  const habBtn = pendHab
    ? `<span class="ec-proj-tag" title="${ecProjEtaTxt(pendHab)}">⏳ обустройство среды (${ecProjEtaTxt(pendHab)})</span>`
    : !c.terraformed
      ? `<button class="btn btn-gh btn-sm" onclick="ecHabitat('${c.id}')" title="Расширить жизненное пространство: +${EC_HABITAT_CELLS} ячеек, завершится через 1 день">🌱 Обустроить среду (+${EC_HABITAT_CELLS} ⬚, ${ecNum(ecColonizeCost(EC_HABITAT_COST))} ГС)</button>`
      : '';
  return `<div class="ec-bld-grid">${bHtml}</div>
    <div class="ec-colony-actions">
      <button class="btn btn-gd btn-sm ec-build-btn" ${full ? 'disabled title="Нет свободных ячеек"' : ''} onclick="ecBuildPicker('${c.id}')">🏗 Построить${full ? '' : ` <span class="ec-build-free">${cap - used} ⬚</span>`}</button>
      ${habBtn}
      ${(typeof user !== 'undefined' && user && ['superadmin','editor','moderator'].includes(user.role))
        ? `<button class="btn btn-gh btn-sm" onclick="ecRenameColony('${c.id}',${ecArg(c.planet_name || '')})" title="Переименовать планету (стафф, бесплатно)">✎ Имя</button>`
        : `<button class="btn btn-gh btn-sm" onclick="ecRenameColonyPaid('${c.id}',${ecArg(c.planet_name || '')})" title="Переименовать планету за ${EC_RENAME_COST} ГС">✎ Имя · ${EC_RENAME_COST} ГС</button>`}
      <button class="btn btn-gh btn-sm ec-danger" onclick="ecAbandon('${c.id}')" title="Бросить колонию">✕ Бросить</button>
    </div>`;
}

// Переименование планеты/колонии — через единый источник истины (colonies + map_systems).
// Стафф — бесплатно (rename_colony). Игрок-владелец — платно (colony_rename_paid, 500 ГС).
const EC_RENAME_COST = 500;
async function ecRenameColony(colId, cur) {
  const nm = prompt('Новое название планеты:', cur || '');
  if (nm === null) return;
  const v = nm.trim();
  if (!v || v === cur) return;
  if (typeof badName === 'function' && badName(v)) { toast('Название содержит недопустимые слова (мат или запрещённое)', 'err'); return; }
  try {
    await ecRpc('rename_colony', { p_colony_id: colId, p_new_name: v });
    toast('Планета переименована', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); }
}
// Платное переименование для игрока-владельца: списывает EC_RENAME_COST ГС на сервере.
async function ecRenameColonyPaid(colId, cur) {
  const bal = (EC.eco && EC.eco.gc) || 0;
  if (bal < EC_RENAME_COST) { toast(`Нужно ${ecNum(EC_RENAME_COST)} ГС, в казне ${ecNum(bal)}`, 'err'); return; }
  const nm = prompt(`Новое название планеты (стоимость ${ecNum(EC_RENAME_COST)} ГС):`, cur || '');
  if (nm === null) return;
  const v = nm.trim();
  if (!v || v === cur) return;
  if (typeof badName === 'function' && badName(v)) { toast('Название содержит недопустимые слова (мат или запрещённое)', 'err'); return; }
  if (!confirm(`Переименовать в «${v}» за ${ecNum(EC_RENAME_COST)} ГС?`)) return;
  try {
    await ecRpc('colony_rename_paid', { p_colony_id: colId, p_new_name: v });
    toast(`Планета переименована · −${ecNum(EC_RENAME_COST)} ГС`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); }
}

// Строка КОЛОНИИ (всегда показывается, даже если планета не совпала с картой)
function ecColonyRowHtml(colony, sys) {
  const open = EC.openColony === colony.id;
  const blds = EC.buildings.filter(b => b.colony_id === colony.id);
  const used = blds.length, cap = colony.cells || EC_DEFAULT_CELLS;
  const incGc = blds.reduce((a, b) => a + (ecBuildingIncome(b).gc || 0), 0);
  const incSci = blds.reduce((a, b) => a + (ecBuildingIncome(b).science || 0), 0);
  const incTxt = [incGc ? `+${ecNum(incGc)} ГС` : '', incSci ? `+${ecNum(incSci)} ОН` : ''].filter(Boolean).join(' ');
  // ресурсы: ИСТИНА — снимок самой колонии (его использует сервер для добычи).
  // Матчинг по имени ненадёжен: в системе бывает ДВЕ одноимённые планеты,
  // .find берёт первую (часто пустую) и затирает корректный снимок колонии.
  const mapPlanet = ecFindPlanet(sys, colony.planet_name, colony.planet_pid);
  const planet = (Array.isArray(colony.resources) && colony.resources.length) ? colony : (mapPlanet || colony);
  const minePreview = ecColonyMinePreview(blds, planet);
  const head = `<div class="ec-pl ec-pl-own${open ? ' open' : ''}" onclick="ecToggleColony('${colony.id}')">
    <div class="ec-pl-top">
      <div class="ec-pl-l"><span class="ec-pl-ic">${colony.is_capital ? '★' : '🏙'}</span><div class="ec-pl-txt"><div class="ec-pl-nm">${esc(colony.planet_name || 'Колония')}</div><div class="ec-pl-sb">${colony.is_capital ? 'Столица · ' : ''}${esc(colony.planet_type || '')}${colony.terraformed ? ' · терраформ' : ''}</div></div></div>
      <div class="ec-pl-r"><span class="ec-pl-cells">⬚ ${used}/${cap}</span>${incTxt ? `<span class="ec-pl-inc">${incTxt}/сут</span>` : ''}<span class="ec-pl-chev">${open ? '▾' : '▸'}</span></div>
    </div>
    <div class="ec-pl-res"><span class="ec-pl-lbl">Ресурсы:</span>${ecPlanetResChips(planet)}</div>
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
    <div class="ec-pl-res"><span class="ec-pl-lbl">Ресурсы:</span>${ecPlanetResChips(p)}</div>
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
    sysMap.set(c.system_id, { id: c.system_id, name: (live && live.name) || 'Система', planets: (live && live.planets) || [] });
  }});
  if (!sysMap.size) {
    return `${ecIntro('🏗', 'Колонии и застройка', 'Здесь вы строите здания на своих планетах — это основа дохода, науки и армии.', ['Сначала получите систему во вкладке «🌐 Территория».', 'Затем колонизируйте пригодную планету и стройте на ней здания.'])}<div class="ec-section-title">Системы и колонии</div>
      <div class="ec-empty">У вас пока нет систем и колоний. Захватывайте системы во вкладке «🌐 Территория».</div>`;
  }
  const totalCol = EC.colonies.length;
  const blocks = [...sysMap.values()].map(s => {
    const cols = EC.colonies.filter(c => c.system_id === s.id);
    // Занятость планеты определяем по pid (две одноимённые планеты — разные объекты).
    // Имя — фолбэк только для старых колоний без planet_pid.
    const colPids = new Set(cols.map(c => c.planet_pid).filter(v => v != null));
    const colNamesNoPid = new Set(cols.filter(c => c.planet_pid == null).map(c => c.planet_name));
    const sysOpen = !(EC.closedSys && EC.closedSys.has(s.id));
    // 1) ВСЕ колонии системы (всегда), 2) незаселённые планеты
    const colHtml = cols.map(c => ecColonyRowHtml(c, s)).join('');
    const freeHtml = s.planets.filter(p => {
      if (p.pid != null && colPids.has(p.pid)) return false;
      if (colNamesNoPid.has(p.name)) return false;
      return true;
    }).map(p => ecFreeRowHtml(s, p, race)).join('');
    const body = (colHtml + freeHtml) || `<div class="ec-empty" style="padding:10px 12px">Нет планет.</div>`;
    return `<div class="ec-sysblk">
      <div class="ec-sysblk-hd" onclick="ecToggleSys('${esc(s.id)}')">
        <span class="ec-sysblk-nm">🜨 ${esc(s.name)}</span>
        <span class="ec-sysblk-meta">${cols.length} колон. · ${s.planets.length} планет <span class="ec-pl-chev">${sysOpen ? '▾' : '▸'}</span></span>
      </div>
      ${sysOpen ? `<div class="ec-sysblk-body">${body}</div>` : ''}
    </div>`;
  }).join('');
  const allIds = ecAllSysIds();
  const allClosed = allIds.length > 0 && allIds.every(id => EC.closedSys && EC.closedSys.has(id));
  const foldBtn = allIds.length > 1
    ? `<button class="btn btn-gh btn-xs" onclick="${allClosed ? 'ecExpandAllSys()' : 'ecCollapseAllSys()'}">${allClosed ? '▾ Развернуть все' : '▸ Свернуть все'}</button>`
    : '';
  return `${ecIntro('🏗', 'Колонии и застройка', 'Стройте здания на планетах — это основа дохода, науки и армии.', ['Каждое здание занимает <b>ячейку</b> планеты и имеет до <b>6 слотов</b> мощности.', 'Постройка здания и открытие нового слота длятся <b>1 день</b> (можно отменить с возвратом ГС).', 'Нажмите на колонию, чтобы развернуть застройку. ⛏ Добывающему заводу нужно назначить месторождения.'])}${ecProjectsBlock()}<div class="ec-section-title">Системы и колонии <span class="ec-hint">— ${totalCol} колоний · клик по шапке системы сворачивает её</span>${foldBtn}</div>
    <div class="ec-syslist">${blocks}</div>`;
}

// Блок «Проекты в работе» — слоты, терраформ, обустройство среды (с таймером и отменой)
function ecProjectsBlock() {
  const ps = (EC.projects || []).slice().sort((a, b) => new Date(a.ready_at || 0) - new Date(b.ready_at || 0));
  if (!ps.length) return '';
  const icon = { slot: '🏗', terraform: '🌍', habitat: '🌱', build: '🏗' };
  const rows = ps.map(p => `<div class="ec-q-row">
      <span class="ec-r-name">${icon[p.kind] || '⏳'} ${esc(p.label || p.kind)}</span>
      ${ecProgressISO(p.created_at, p.ready_at, 1, 'готово — ждёт тика')}
      <button class="ec-bld-del" title="Отменить (возврат затрат)" onclick="ecCancelProject('${p.id}')">✕</button>
    </div>`).join('');
  return `<div class="ec-section-title">Проекты в работе <span class="ec-hint">— применяются через 1 день</span></div>
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

// ── Вкладка 1: «Вооружённые силы государства» — текущий состав (ростер) ──
function ecTabForces() {
  const stock = {};
  EC.roster.forEach(r => { const k = (r.category || '') + '|' + (r.unit_name || ''); if (!stock[k]) stock[k] = { name: r.unit_name, category: r.category, qty: 0 }; stock[k].qty += r.qty || 0; });
  const all = Object.values(stock);
  let rosterHtml = '';
  [['division', '⚔', 'Дивизии', 'army', 'Дивизия'], ['ship', '🚀', 'Флот', 'fleet', 'Корабль']].forEach(([c, ic, lbl, mod, unit]) => {
    const arr = all.filter(s => s.category === c).sort((a, b) => (b.qty || 0) - (a.qty || 0));
    if (!arr.length) return;
    const tot = arr.reduce((a, s) => a + (s.qty || 0), 0);
    const cards = arr.map(s => `<div class="ec-force-card ec-force-card--${mod}">
        <span class="ec-force-tok">${ic}</span>
        <div class="ec-force-info"><div class="ec-force-name">${esc(s.name)}</div><div class="ec-force-sub">${unit}</div></div>
        <span class="ec-force-qty">×${ecNum(s.qty)}</span>
      </div>`).join('');
    rosterHtml += `<div class="ec-force-group">
      <div class="ec-force-hd ec-force-hd--${mod}"><span class="ec-force-hd-ic">${ic}</span><span class="ec-force-hd-l">${lbl}</span><span class="ec-force-hd-ct">${ecNum(tot)} ед.</span></div>
      <div class="ec-force-grid">${cards}</div>
    </div>`;
  });
  if (!rosterHtml) rosterHtml = `<div class="ec-force-empty"><span class="ec-force-empty-ic">🎖</span><div>Вооружённых сил пока нет.<br><span class="ec-force-empty-sub">Сформируйте их во вкладке «🏭 Строительство вооружённых сил».</span></div></div>`;

  const totDiv = EC.roster.filter(r => r.category === 'division').reduce((a, r) => a + (r.qty || 0), 0);
  const totShip = EC.roster.filter(r => r.category === 'ship').reduce((a, r) => a + (r.qty || 0), 0);
  const inQueue = EC.queue.reduce((a, q) => a + (q.qty || 0), 0);

  return `${ecIntro('⚔', 'Вооружённые силы государства', 'Текущий состав ваших вооружённых сил — сформированные дивизии и построенный флот.', ['Войска производятся во вкладке «🏭 Строительство вооружённых сил».', 'Готовые заказы пополняют этот состав в конце игрового хода.'])}<div class="ec-section-title">Сводка</div>
    <div class="ec-ov-grid ec-force-stats">
      <div class="ec-ov-card"><div class="ec-ov-v" style="color:var(--gd)">${ecNum(totDiv)}</div><div class="ec-ov-k">⚔ Дивизий</div></div>
      <div class="ec-ov-card"><div class="ec-ov-v" style="color:var(--te)">${ecNum(totShip)}</div><div class="ec-ov-k">🚀 Кораблей</div></div>
      ${inQueue ? `<div class="ec-ov-card ec-ov-clk" onclick="ecSetTab('milbuild')"><div class="ec-ov-v" style="color:var(--color-warning, #e0a030)">${ecNum(inQueue)}</div><div class="ec-ov-k">🏭 В очереди</div></div>` : ''}
    </div>
    <div class="ec-section-title">Боевой состав</div>
    ${rosterHtml}`;
}

// ── Вкладка 2: «Строительство вооружённых сил» — производство и очередь ──
function ecTabMilBuild() {
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
    ? EC.queue.map(q => `<div class="ec-q-row"><span class="ec-r-name">${esc(q.unit_name)} ×${ecNum(q.qty)}</span>${ecProgressISO(q.created_at, q.ready_at, 1, 'готово на след. ходу')}<button class="ec-bld-del" title="Отменить" onclick="ecCancelProd('${q.id}')">✕</button></div>`).join('')
    : `<div class="ec-empty" style="padding:8px">Очередь пуста.</div>`;

  const infLine = caps.robot
    ? `Пехота-роботы → <b>Военный завод</b> (×3: ${ecNum(EC_ROBOT_INF_PER_SLOT)}/слот), техника → <b>Военный завод</b>, корабли → <b>Корабельная верфь</b>.`
    : 'Объём производства зависит от слотов военных зданий: пехота → <b>Центр подготовки</b>, техника → <b>Военный завод</b>, корабли → <b>Корабельная верфь</b>.';
  const divHint = caps.robot
    ? '— роботы собирают пехоту и технику на Военном Заводе (Центр Подготовки не нужен)'
    : '— комплектование: нужны здания под состав (пехота → Подготовка, техника → Воензавод)';
  const groundCap = `<div class="ec-cap">Пехота: <b>${ecNum(caps.training)} ед./ход</b>${caps.robot ? ' <span class="ec-rbadge">⚙ робо-сборка ×3</span>' : ''} · Техника: <b>${ecNum(caps.military)} ед./ход</b></div>`;
  return `${ecIntro('🏭', 'Строительство вооружённых сил', 'Производство войск. Сами шаблоны проектируются в <b>Конструкторах</b>, а заказ на производство — здесь.', [infLine, 'Нет проектов? Откройте «⚒ Конструкторы» и спроектируйте дивизию или корабль.', 'Заказы выполняются к следующему игровому дню и попадают в «⚔ Вооружённые силы государства».'])}<div class="ec-section-title">Дивизии <span class="ec-hint">${divHint}</span></div>
    ${groundCap}
    ${divHtml}
    <div class="ec-section-title">Флот <span class="ec-hint">— корабли строятся на Верфи поштучно</span></div>
    ${shipForm}
    <div class="ec-section-title">В очереди <span class="ec-hint">— доставка в конце хода (сутки)</span></div>
    <div class="ec-queue">${queueHtml}</div>`;
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
// Цена и кулдаун колонизации системы с учётом доктрины (зеркало economy_claim_system).
function ecClaimCost() { return Math.max(1, Math.round(EC_CLAIM_COST * ecFactionMods().claim_cost)); }
function ecClaimCdDays() { return Math.max(1, Math.round(EC_CLAIM_CD_DAYS * ecFactionMods().claim_cd)); }
function ecClaimCooldownMs() {
  if (!EC.eco.last_system_claim) return 0;
  return Math.max(0, new Date(EC.eco.last_system_claim).getTime() + ecClaimCdDays() * 86400000 - Date.now());
}
// «Дом в небесах» (pol.house_heavens) ИЛИ роботы → пул из 2 захватов вместо 1.
function ecClaimMax() { return (ecIsRobot() || (EC.eco.research || []).includes('pol.house_heavens')) ? 2 : 1; }
// Сколько захватов осталось в пуле (зеркало модели «пул» в economy_claim_system):
//   кулдаун идёт → 0; кулдаун прошёл → пул пополнен (max); пул открыт → max − использовано.
function ecClaimsLeft() {
  if (ecClaimCooldownMs() > 0) return 0;
  if (EC.eco.last_system_claim) return ecClaimMax();
  return Math.max(0, ecClaimMax() - (EC.eco.claim_used || 0));
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
  const claimStart = EC.eco.last_system_claim ? new Date(EC.eco.last_system_claim).getTime() : 0;
  const left = ecClaimsLeft(), max = ecClaimMax(), canClaim = left > 0;
  const leftTag = max > 1 ? ` <b style="color:var(--gd)">· осталось захватов: ${left}/${max}</b>` : '';
  const cdLine = canClaim
    ? `<div class="ec-cap">Доступно${leftTag}. Раз в ${ecClaimCdDays()} дн., стоимость ${ecNum(ecClaimCost())} ГС.</div>`
    : `<div class="ec-cap ec-warn ec-cap-prog">Колонизация системы: ${ecProgress(claimStart, claimStart + ecClaimCdDays() * 86400000, 'доступно')}</div>`;
  const list = claim.length
    ? claim.map(id => { const s = byId.get(id); return `<div class="ec-colonize-row"><div class="ec-cz-main"><span class="ec-cz-name">★ ${esc(s.name)}</span><span class="ec-cz-sub">смежная · ничья</span></div>
        <button class="btn ${canClaim ? 'btn-gd' : 'btn-gh'} btn-sm" ${canClaim ? '' : 'disabled'} onclick="ecClaimSystem('${esc(id)}')">Колонизировать систему · ${ecNum(ecClaimCost())} ГС</button></div>`; }).join('')
    : `<div class="ec-empty">Нет смежных свободных систем. Расширяйтесь вдоль гиперпутей — соседние ничьи системы появятся здесь.</div>`;
  const claimMax = ecClaimMax();
  const claimBullet = claimMax > 1
    ? `Стоит ${ecNum(EC_CLAIM_COST)} ГС. Можно взять <b>${claimMax} системы подряд</b>${ecIsRobot() ? ' (бонус роботов)' : ' («Дом в небесах»)'}, затем перезарядка <b>${ecClaimCdDays()} дн.</b>`
    : `Стоит ${ecNum(EC_CLAIM_COST)} ГС. После захвата — перезарядка <b>${ecClaimCdDays()} дн.</b> (срок зависит от доктрины).`;
  return `${ecIntro('🌐', 'Территория и расширение', 'Захватывайте звёздные системы, чтобы получать новые планеты под колонии.', ['Колонизировать можно только систему, <b>смежную по гиперпути</b> с вашей и <b>ничью</b> (серую).', claimBullet, 'Получив систему — заселяйте её планеты во вкладке «🏗 Колонии».'])}<div class="ec-section-title">Карта территории <span class="ec-hint">— ваши системы и доступные для колонизации</span></div>
    ${ecMinimap()}
    <div class="ec-section-title">Колонизация системы <span class="ec-hint">— смежная по гиперпути и ничья · раз в ${ecClaimCdDays()} дн. (доктрина)</span></div>
    ${cdLine}
    <div class="ec-colonize">${list}</div>`;
}
async function ecClaimSystem(systemId) {
  if (EC.busy) return;
  if (ecClaimsLeft() <= 0) { toast('Колонизация системы на перезарядке', 'err'); return; }
  const claimCost = ecClaimCost();
  if ((EC.eco.gc || 0) < claimCost) { toast(`Недостаточно ГС: нужно ${ecNum(claimCost)}`, 'err'); return; }
  if (!confirm('Колонизировать систему за ' + ecNum(claimCost) + ' ГС? (раз в ' + ecClaimCdDays() + ' дн.)')) return;
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
  if (m.includes('name violates')) return 'Название нарушает правила (мат или запрещённое)';
  if (m.includes('empty name')) return 'Пустое название';
  if (m.includes('missing prerequisites')) return 'Не изучены технологии, нужные для чертежа';
  if (m.includes('seller lacks tech')) return 'У вас нет этой технологии';
  if (m.includes('recipient not found')) return 'Получатель не найден';
  if (m.includes('bad price')) return 'Неверная цена';
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
  const hid = ecId('ec-cv-res'); if (hid) hid.value = btn.dataset.res;
  ecCvSync();   // объём пересчитается под запас нового ресурса и собранный флот
}

// ── Сборщик флота каравана: выбираешь ПРОЕКТЫ кораблей (грузовые → грузоподъёмность, боевые → эскорт) ──
function ecCvShipCargo(unitId) { const d = (EC.designs || []).find(x => x.id === unitId); return (d && d.summary && +d.summary.cargo) || 0; }
function ecCvFleetGroups() {
  const by = {};
  (EC.roster || []).filter(r => r.category === 'ship').forEach(r => {
    if (!by[r.unit_id]) by[r.unit_id] = { id: r.unit_id, name: r.unit_name || 'Корабль', qty: 0, cargo: ecCvShipCargo(r.unit_id) };
    by[r.unit_id].qty += r.qty || 0;
  });
  const all = Object.values(by);
  return { freighters: all.filter(d => d.cargo > 0), warships: all.filter(d => d.cargo <= 0) };
}
function ecCvFleetTotals() {
  const f = EC.cvFleet || {}; let cap = 0, escort = 0;
  Object.keys(f).forEach(id => { const c = ecCvShipCargo(id); if (c > 0) cap += (f[id] || 0) * c; else escort += (f[id] || 0); });
  return { cap, escort };
}
function ecCvFleetHtml() {
  EC.cvFleet = EC.cvFleet || {};
  const { freighters, warships } = ecCvFleetGroups();
  const { cap, escort } = ecCvFleetTotals();
  const f = EC.cvFleet;
  const row = (d, tag) => `<div class="ec-q-row" style="gap:6px">
      <span class="ec-r-name">${esc(d.name)} <i style="color:var(--t4)">${tag} · в наличии ${ecNum(d.qty)}</i></span>
      <span class="ec-mine-step">
        <button class="ec-mine-btn" ${(f[d.id] || 0) <= 0 ? 'disabled' : ''} onclick="ecCvFleetAdd('${esc(d.id)}',-1)">−</button>
        <span class="ec-mine-cnt ${(f[d.id] || 0) ? 'on' : ''}">${f[d.id] || 0}</span>
        <button class="ec-mine-btn" ${(f[d.id] || 0) >= d.qty ? 'disabled' : ''} onclick="ecCvFleetAdd('${esc(d.id)}',1)">+</button>
      </span></div>`;
  const frHtml = freighters.length ? freighters.map(d => row(d, `📦 груз ${d.cargo}`)).join('')
    : '<div class="ec-empty" style="padding:6px">Нет грузовых кораблей — постройте корабль с грузовыми ангарами (Конструктор → Корабль) и заложите его в Военпроме.</div>';
  const wsHtml = warships.length ? warships.map(d => row(d, '⚔ эскорт')).join('')
    : '<div class="ec-empty" style="padding:6px">Нет боевых кораблей для эскорта.</div>';
  return `<div class="ec-r-sec">📦 Грузовые — дают грузоподъёмность</div>${frHtml}
    <div class="ec-r-sec">⚔ Эскорт — защита в пути</div>${wsHtml}
    <div class="ec-trade-note${cap < 1 ? ' warn' : ''}"><b>Флот каравана:</b> 📦 грузоподъёмность <b>${ecNum(cap)}</b> · ⚔ эскорт <b>${ecNum(escort)}</b> кораблей${cap < 1 ? ' — добавьте грузовой корабль, иначе объём = 0.' : ''}</div>`;
}
function ecCvFleetAdd(unitId, delta) {
  EC.cvFleet = EC.cvFleet || {};
  const have = (EC.roster || []).filter(r => r.category === 'ship' && r.unit_id === unitId).reduce((a, r) => a + (r.qty || 0), 0);
  EC.cvFleet[unitId] = Math.max(0, Math.min(have, (EC.cvFleet[unitId] || 0) + delta));
  const cont = ecId('ec-cv-fleet'); if (cont) cont.innerHTML = ecCvFleetHtml();
  ecCvSync();
}
// Пересчитать скрытые объём/конвой из собранного флота и запаса выбранного ресурса
function ecCvSync() {
  const { escort } = ecCvFleetTotals();
  const conI = ecId('ec-cv-convoy'); if (conI) conI.value = escort;
  const cargoEl = ecId('ec-cv-cargo'); if (cargoEl) cargoEl.innerHTML = ecCvCargoHtml();   // грузоподъёмность могла измениться
  ecTradeCalc();
}
// Аллокатор груза каравана: распределяем грузоподъёмность по ресурсам ДОБЫЧИ
// Авто-распределение грузоподъёмности по выбранным месторождениям: самые ценные
// грузим первыми, каждый ресурс — его поток добычи, пока не кончится трюм.
function ecCvAllocate() {
  const cap = ecCvFleetTotals().cap;
  const sel = Object.keys(EC.cvCargo || {}).filter(r => EC.cvCargo[r]);
  sel.sort((a, b) => ecResPriceN(b) - ecResPriceN(a));
  let rem = cap; const out = [];
  sel.forEach(res => {
    const vol = Math.min(ecExtractRate(res), rem);
    if (vol > 0) { out.push({ res, vol }); rem -= vol; }
  });
  return out;
}
// Выбор месторождений для каравана: тыкаешь ресурс из своей добычи — он грузится
// потоком (никаких ручных чисел, объём = добыча, капается грузоподъёмностью флота).
function ecCvCargoHtml() {
  EC.cvCargo = EC.cvCargo || {};
  const ex = ecExtractEntries();
  if (!ex.length) return '<div class="ec-empty" style="padding:6px">Нет ресурсов в экспорте. Переключите добывающий завод в режим 💱 Экспорт (вкладка «Колонии») — только экспорт доступен караванам, склад копит на себя.</div>';
  const alloc = {}; ecCvAllocate().forEach(c => alloc[c.res] = c.vol);
  return ex.map(([n, rate]) => {
    const on = !!EC.cvCargo[n];
    const ship = alloc[n] || 0;
    const bd = on ? 'var(--gd)' : 'var(--bd,#2a3550)';
    const tail = on
      ? (ship > 0 ? `<b style="color:var(--gd)">грузим ${ecNum(ship)}${ship < rate ? ' · лимит трюма' : ''}</b>` : `<b style="color:var(--err)">трюм полон</b>`)
      : '';
    return `<button type="button" onclick="ecCvCargoToggle('${esc(n)}')" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 10px;margin:4px 0;border-radius:8px;cursor:pointer;border:1px solid ${bd};background:${on ? 'rgba(120,200,140,.10)' : 'transparent'};color:inherit;font:inherit">
      <span style="width:18px;height:18px;flex:none;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;border:1px solid ${on ? 'var(--gd)' : 'var(--t4)'};color:${on ? 'var(--gd)' : 'var(--t4)'};font-weight:700">${on ? '✓' : '+'}</span>
      <span style="flex:1">${ecResIcon(n)} ${esc(n)} <i style="color:var(--t4);font-style:normal"> · ⛏ ${ecNum(rate)}/ход · ${ecResPriceN(n)} ГС/ед</i></span>
      ${tail}
    </button>`;
  }).join('');
}
function ecCvCargoToggle(res) {
  EC.cvCargo = EC.cvCargo || {};
  if (EC.cvCargo[res]) delete EC.cvCargo[res]; else EC.cvCargo[res] = true;
  const el = ecId('ec-cv-cargo'); if (el) el.innerHTML = ecCvCargoHtml();
  ecTradeCalc();
}
// Твой ЭКСПОРТНЫЙ поток ресурса /ход (для throughput каравана — зеркало economy_accrue).
// Только заводы в режиме «экспорт» — склад караванам недоступен.
function ecExtractRate(resName) {
  let total = 0;
  (EC.buildings || []).filter(b => b.btype === 'mining' && b.mine_mode === 'export').forEach(b => {
    const res = ecMiningPlanetRes(b);
    (Array.isArray(b.mining_targets) ? b.mining_targets : []).forEach(t => {
      if (t === resName) { const ri = res.find(x => x.name === resName); if (ri) total += ecMineRate(ri.r, ri.amt); }
    });
  });
  return total;
}
// Дипломатический коэффициент к выгоде каравана (зеркало economy_accrue)
function ecDipCoef(toFid) {
  const rel = (EC.relations || []).find(x => x.from_fid === EC.fid && x.to_fid === toFid);
  const s = rel ? (+rel.score || 0) : 0;
  return Math.max(0.8, Math.min(1.2, 1 + s / 500));
}
// Средняя скорость торгового флота (взвеш. по грузоподъёмности) — зеркало _fleet_speed
function ecFleetSpeed() {
  let wsum = 0, w = 0;
  (EC.roster || []).filter(r => r.category === 'ship').forEach(r => {
    const d = (EC.designs || []).find(x => x.id === r.unit_id);
    const cargo = (d && d.summary && +d.summary.cargo) || 0;
    const speed = (d && d.summary && +d.summary.speed) || 0;
    if (cargo > 0) { wsum += speed * cargo * (r.qty || 0); w += cargo * (r.qty || 0); }
  });
  return w > 0 ? Math.round(wsum / w) : 20;
}
// Оценка времени в пути каравана (зеркало trade_respond): дистанция/скорость
function ecTravelTurns(oSys, dSys) {
  if (!oSys || !dSys) return null;
  const adj = (EC.lanes || []).some(l => (l.a_id === oSys && l.b_id === dSys) || (l.a_id === dSys && l.b_id === oSys));
  return Math.max(1, Math.min(2, Math.ceil((adj ? 1 : 2) * 20 / Math.max(1, ecFleetSpeed()))));   // 1–2 цикла
}
// Что фракция отдаёт в ЭКСПОРТ и с какой скоростью /ход — список для каравана.
// Только заводы в режиме «экспорт»; «склад» — копит на склад, караванам недоступно.
function ecExtractEntries() {
  const m = {};
  (EC.buildings || []).filter(b => b.btype === 'mining' && b.mine_mode === 'export').forEach(b => {
    const res = ecMiningPlanetRes(b);
    (Array.isArray(b.mining_targets) ? b.mining_targets : []).forEach(t => {
      const ri = res.find(x => x.name === t); if (!ri) return;
      m[t] = (m[t] || 0) + ecMineRate(ri.r, ri.amt);
    });
  });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
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
  const convoy = Math.max(0, parseInt(ecId('ec-cv-convoy')?.value) || 0);
  const oSys = ecId('ec-cv-osys')?.value || '';
  const dFac = ecId('ec-cv-dfac')?.value || '';
  const dSys = ecId('ec-cv-dsys')?.value || '';
  const cargoCap = ecCvFleetTotals().cap;              // грузоподъёмность собранного флота
  const dipCoef = ecDipCoef(dFac);                     // дипломатия → ±20% к выгоде
  const gcMod = ecFactionMods().gc;
  // грузы: авто-распределение грузоподъёмности по выбранным месторождениям (поток добычи)
  const cargo = ecCvAllocate();
  let alloc = 0, myInc = 0, partnerInc = 0; const dealParts = [];
  cargo.forEach(({ res, vol }) => {
    alloc += vol;
    const ship = vol;                                  // vol уже = min(добыча, остаток трюма)
    const price = ecResPriceN(res);
    myInc += Math.round(ship * price * gcMod * dipCoef);
    partnerInc += Math.round(ship * price * EC_DEST_CUT * dipCoef);
    if (ship > 0) dealParts.push(`${ecResIcon(res)} ${ecNum(ship)} ${esc(res)}`);
  });
  const anySel = Object.keys(EC.cvCargo || {}).some(r => EC.cvCargo[r]);
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
  else if (cargoCap <= 0) err = 'Соберите флот каравана — нет грузоподъёмности';
  else if (!anySel) err = 'Выберите месторождения для загрузки — нажмите на ресурс';
  else if (!cargo.length) err = 'Грузоподъёмности не хватает — соберите больше торговых кораблей';
  const shipsFree = (typeof ecMyShipsAvailable === 'function') ? ecMyShipsAvailable() : 0;
  const threatNames = [...new Set(threats.map(t => t.type === 'ancient' ? 'древние' : 'пираты'))].join(' / ');
  // ожидаемый доход с учётом риска грабежа — главный показатель «стоит ли оно того»
  const effMy = Math.round(myInc * (1 - riskPct / 100));

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
    <div class="ec-trade-deal">Каждый ход: <b>${dealParts.length ? dealParts.join(' · ') : '—'}</b> → партнёру · вы <b style="color:var(--gd)">+${ecNum(myInc)} ГС</b>, партнёр <b style="color:var(--te)">+${ecNum(partnerInc)} ГС</b></div>
    <div class="ec-trade-srow"><span>Загрузка</span><b style="color:${alloc > cargoCap ? 'var(--err)' : 'var(--t2)'}">${ecNum(alloc)} / грузоподъёмность ${ecNum(cargoCap)}</b></div>
    ${routeLine}
    ${(oSys && dSys) ? `<div class="ec-trade-srow"><span>Время в пути</span><b>🚀 ${ecTravelTurns(oSys, dSys)} ход. · скорость флота ${ecFleetSpeed()}</b></div>` : ''}
    <div class="ec-trade-srow"><span>Риск грабежа / ход</span><b style="color:${riskColor}">${riskPct}%${convoy ? ` · 🛡 конвой ${convoy}` : threats.length ? ' · без охраны' : ''}</b></div>
    <div class="ec-trade-srow big"><span>Ожидаемо с учётом риска</span><b style="color:${effMy > 0 ? 'var(--gd)' : 'var(--err)'}">+${ecNum(effMy)} ГС/ход</b></div>
    <div class="ec-trade-srow"><span>Длительность</span><b style="color:var(--t3)">бессрочно — пока путь не закрыт</b></div>
    ${riskAdvice}`;
  if (send) {
    send.disabled = !!err;
    send.textContent = err ? err : `Предложить караван (+${ecNum(effMy)} ГС/ход)`;
  }
  return { convoy, oSys, dFac, dSys, threats, path, err, riskPct, cargo };
}
// Текст груза маршрута: все ресурсы мультигруза (или легаси один ресурс)
function ecRouteCargoText(r) {
  const cargo = Array.isArray(r.cargo) ? r.cargo : [];
  if (cargo.length) return cargo.map(ci => `${ecResIcon(ci.res)} ${esc(ci.res)} ×${ecNum(ci.vol)}`).join(', ');
  return `${ecResIcon(r.resource)} ${esc(r.resource || '')} ×${ecNum(r.volume)}`;
}
function ecRouteRow(r) {
  const isOrigin = r.a_fid === EC.fid;
  const other = isOrigin ? (r.b_name || ecFacName(r.b_fid)) : (r.a_name || ecFacName(r.a_fid));
  const value = (r.volume || 0) * (r.price || 0);
  // исходящий караван (продажа) учитывает бонус доктрины к ГС — как в «Казне» обзора;
  // входящий — фиксированная доля партнёра без доктрины.
  const income = isOrigin ? Math.round(value * ecFactionMods().gc) : Math.round(value * EC_DEST_CUT);
  const threats = r.threats || [];
  const riskPct = ecTradeRiskPct(threats, r.convoy);
  const riskTxt = threats.length ? `риск ${riskPct}%${r.convoy ? ` · 🛡${r.convoy}` : ' · без охраны'}` : 'безопасно';
  const verb = isOrigin ? `отправляю → ${esc(other)}` : `получаю ← ${esc(other)}`;
  const transitMs = r.transit_until ? new Date(r.transit_until).getTime() - Date.now() : 0;
  const inTransit = transitMs > 0;
  const badge = inTransit
    ? `<span class="ec-route-badge wait">🚀 в пути · прибудет ${ecFmtLeft(transitMs)}</span>`
    : `<span class="ec-route-badge ok">✓ активен</span>`;
  const incomeTxt = inTransit ? `<i style="color:var(--t3)"> · доход после прибытия</i>` : ` · <b style="color:var(--gd)">+${ecNum(income)} ГС/ход</b>`;
  return `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      ${badge}
      <b>${ecRouteCargoText(r)}</b>/ход · ${verb}${incomeTxt}
      <i style="color:${threats.length ? 'var(--color-warning)' : 'var(--ok)'}"> · ${esc(riskTxt)}</i>
    </span><button class="ec-bld-del" title="Закрыть путь" onclick="ecTradeClose('${r.id}')">✕</button></div>`;
}

// ── Вкладка «Дипломатия» ────────────────────────────────────
// ── Дипломатия: таблица отношений (респект) ─────────────────
function ecRelLabel(score) {
  const s = score || 0;
  if (s >= 60)  return { t: 'Союзные',       c: 'var(--ok)' };
  if (s >= 20)  return { t: 'Дружелюбны',    c: 'var(--ok)' };
  if (s <= -60) return { t: 'Враждебны',     c: 'var(--err)' };
  if (s <= -20) return { t: 'Напряжённость', c: 'var(--err)' };
  return { t: 'Нейтральны', c: 'var(--t3)' };
}
// Двусторонний бар: от центра вправо (+, зелёный) или влево (−, красный).
function ecRelBar(score) {
  const s = Math.max(-100, Math.min(100, Math.round(score || 0)));
  const w = Math.abs(s) / 2;                       // 0..50 (% от половины трека)
  const side = s >= 0 ? 'left:50%' : 'right:50%';
  const col = s > 0 ? 'var(--ok)' : s < 0 ? 'var(--err)' : 'var(--t4)';
  return `<span class="ec-rel-bar"><span class="ec-rel-mid"></span><span class="ec-rel-fill" style="${side};width:${w}%;background:${col}"></span></span>`;
}
function ecRelationsBlock() {
  const others = ecOtherFactions();
  if (!others.length) return '<div class="ec-dip-card"><div class="ec-dip-t">Таблица отношений</div><div class="ec-empty">Нет других фракций.</div></div>';
  const relMap = new Map();
  (EC.relations || []).forEach(r => relMap.set(r.from_fid + '>' + r.to_fid, r.score));
  const cell = (score, cap) => {
    const lbl = ecRelLabel(score || 0);
    const val = (score == null) ? '—' : `${score > 0 ? '+' : ''}${score} · ${lbl.t}`;
    return `<span class="ec-rel-cell"><span class="ec-rel-cap">${cap}</span>${ecRelBar(score)}<span class="ec-rel-val" style="color:${lbl.c}">${val}</span></span>`;
  };
  const rows = others.map(f => {
    const mine = relMap.get(EC.fid + '>' + f.faction_id);
    const theirs = relMap.get(f.faction_id + '>' + EC.fid);
    return `<div class="ec-rel-row">
      <span class="ec-rel-name">${esc(f.name || ecFacName(f.faction_id))}</span>
      ${cell(mine, 'вы →')}
      ${cell(theirs, '→ вам')}
    </div>`;
  }).join('');
  return `<div class="ec-dip-card ec-rel-card"><div class="ec-dip-t">Таблица отношений <span class="ec-hint">— баллы −100..+100, копятся от реакций на ваши и чужие новости</span></div>
    <div class="ec-rel-list">${rows}</div></div>`;
}

// ── Вкладка «Торговля»: рынок · караваны · обмен (бартер с кораблями) ──
function ecTabTrade() {
  const others = ecOtherFactions(), noOthers = !others.length;
  const tradeCap = ecSlotsSum('trade');
  const used = EC.routes.filter(r => r.a_fid === EC.fid && ['pending', 'active'].includes(r.status)).length;
  const incoming = EC.routes.filter(r => r.b_fid === EC.fid && r.status === 'pending');
  const active = EC.routes.filter(r => r.status === 'active' && (r.a_fid === EC.fid || r.b_fid === EC.fid));
  const pendingOut = EC.routes.filter(r => r.a_fid === EC.fid && r.status === 'pending');
  const stock = ecResEntries();
  const mySys = (EC.allSystems || []).filter(s => s.faction === EC.fid);
  const ships = ecMyShipsAvailable();
  const cargo = EC.tradeCargo || { total: 0, used: 0, free: 0 };   // грузоподъёмность торгового флота
  const volMax = Math.max(1, Math.min(stock.length ? stock[0][1] : 1, cargo.free || 0));

  const stockHtml = stock.length
    ? stock.map(([n, v]) => `<div class="ec-q-row"><span class="ec-r-name">${ecResIcon(n)} ${esc(n)} <i style="color:var(--t4)">(${esc(ecResRarity(n))}, ${ecResPriceN(n)} ГС)</i></span><span class="ec-r-qty">${ecNum(v)}</span></div>`).join('')
    : '<div class="ec-empty" style="padding:8px">Склад пуст. Стройте Добывающий завод на колониях с ресурсами.</div>';
  const sellForm = stock.length
    ? `<div class="ec-prod-form"><select id="ec-sell-res">${stock.map(([n]) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select><input type="number" id="ec-sell-units" min="1" placeholder="кол-во" class="ec-prod-qty"><button class="btn btn-gh btn-sm" onclick="ecSellResource()">Продать на рынке</button></div><div class="cn-fac-hint" style="margin-top:5px">Местный рынок — 80% цены${ecFactionMods().gc !== 1 ? ` · ×${ecFactionMods().gc.toFixed(2)} от доктрины` : ''}. Караваны выгоднее.</div>`
    : '';
  const resBlock = `<div class="ec-dip-card"><div class="ec-dip-t">Ресурсы планет</div>${stockHtml}${sellForm}</div>`;

  const barterBlock = ecBarterBlock(others, noOthers, stock);

  const destFac0 = others[0] && others[0].faction_id;
  const destSys0 = (EC.allSystems || []).filter(s => s.faction === destFac0);
  // Чип-выбор ресурса каравана — из вашей ДОБЫЧИ (поток), не со склада
  const extractEntries = ecExtractEntries();
  const resChips = extractEntries.map(([n, v], i) => {
    const rar = ecResRarity(n);
    return `<button type="button" class="ec-trade-res ec-rar-${rar}${i === 0 ? ' on' : ''}" data-res="${esc(n)}" onclick="ecPickTradeRes(this)">
      <span class="ec-trade-res-ic">${ecResIcon(n)}</span><span class="ec-trade-res-n">${esc(n)}</span>
      <span class="ec-trade-res-meta">⛏ ${ecNum(v)}/ход · ${ecResPriceN(n)} ГС/ед</span></button>`;
  }).join('');
  const caravanForm = (tradeCap < 1) ? '<div class="ec-empty">Нужен Торговый хаб (вкладка «Колонии») — он открывает торговые пути.</div>'
    : noOthers ? '<div class="ec-empty">Нет других фракций для торговли.</div>'
      : !mySys.length ? '<div class="ec-empty">Нет ваших систем на карте — расширяйтесь (вкладка «Территория»).</div>'
        : !extractEntries.length ? '<div class="ec-empty">Нет ресурсов в экспорте. Поставьте добывающий завод в режим 💱 Экспорт (вкладка «Колонии») — караван возит только экспортную добычу, склад остаётся себе.</div>'
          : `<div class="ec-trade-form">
        <div class="ec-trade-how">
          <b>Как это работает:</b> караван — постоянное торговое соглашение. После того как партнёр <b>примет</b>, <b>каждый ход</b> ваш караван возит вашу <b>экспортную добычу</b> (режим 💱 Экспорт на заводе, сколько влезет в трюмы) и <b>оба получаете ГС</b>. Завод в режиме 📦 Склад караванам недоступен — это разные каналы, двойного дохода нет. Путь бессрочный, пока не закроете.
          <div class="ec-trade-flow"><span>① Вы предлагаете</span><span>→</span><span>② Партнёр принимает</span><span>→</span><span>③ Доход каждый ход</span></div>
        </div>
        <div class="ec-trade-label">1 · Соберите флот каравана <span class="ec-hint">грузовые → грузоподъёмность, боевые → эскорт</span></div>
        <div id="ec-cv-fleet">${ecCvFleetHtml()}</div>
        <input type="hidden" id="ec-cv-convoy" value="0">
        <div class="ec-trade-label">2 · Что грузим <span class="ec-hint">тыкните месторождения — флот грузит их поток, ценные первыми</span></div>
        <div id="ec-cv-cargo">${ecCvCargoHtml()}</div>
        <div class="ec-trade-label">3 · Кому и откуда <span class="ec-hint">чужие системы на пути = угрозы по дороге</span></div>
        <div class="ec-trade-route">
          <select id="ec-cv-osys" onchange="ecTradeCalc()" title="Из вашей системы отправления">${mySys.map(s => `<option value="${esc(s.id)}">🜨 ${esc(s.name)}</option>`).join('')}</select>
          <span class="ec-trade-arrow">→</span>
          <select id="ec-cv-dfac" onchange="ecFillDestSys();ecTradeCalc()" title="Партнёр-получатель">${others.map(f => `<option value="${esc(f.faction_id)}">${esc(f.name)}</option>`).join('')}</select>
          <select id="ec-cv-dsys" onchange="ecTradeCalc()" title="В систему партнёра">${destSys0.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('') || '<option value="">— нет систем —</option>'}</select>
        </div>
        <div class="ec-trade-summary" id="ec-cv-summary"></div>
        <button class="btn btn-gd" id="ec-cv-send" onclick="ecTradePropose()">Предложить караван</button>
      </div>`;
  const inHtml = incoming.map(r => { const value = (r.volume || 0) * (r.price || 0); return `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      <span class="ec-route-badge new">предложение</span>
      <b>${esc(r.a_name || ecFacName(r.a_fid))}</b> предлагает слать вам <b>${ecRouteCargoText(r)}</b>/ход · вы получите <b style="color:var(--gd)">+${ecNum(Math.round(value * EC_DEST_CUT))} ГС/ход</b> (бессрочно)
    </span><button class="btn btn-gd btn-xs" title="Согласиться — путь станет активным" onclick="ecTradeRespond('${r.id}',true)">Принять</button><button class="ec-bld-del" title="Отклонить" onclick="ecTradeRespond('${r.id}',false)">✕</button></div>`; }).join('');
  const outHtml = pendingOut.map(r => `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      <span class="ec-route-badge wait">⏳ ждёт ответа</span>
      <b>${ecRouteCargoText(r)}</b>/ход → <b>${esc(r.b_name || ecFacName(r.b_fid))}</b> · начнёт приносить доход после принятия
    </span><button class="ec-bld-del" title="Отозвать предложение" onclick="ecTradeClose('${r.id}')">✕</button></div>`).join('');
  const caravanBlock = `<div class="ec-dip-card ec-dip-trade"><div class="ec-dip-t">Торговые караваны <span class="ec-hint">пути: ${used}/${tradeCap}</span></div>
      ${caravanForm}
      ${incoming.length ? `<div class="ec-r-sec">Входящие предложения</div>${inHtml}` : ''}
      ${active.length ? `<div class="ec-r-sec">Активные пути</div>${active.map(ecRouteRow).join('')}` : ''}
      ${pendingOut.length ? `<div class="ec-r-sec">Отправленные</div>${outHtml}` : ''}</div>`;

  const sub = EC.tradeSub || 'caravans';
  const subTabs = [['caravans', '🚛', 'Караваны'], ['market', '🏪', 'Рынок'], ['barter', '🤝', 'Обмен']];
  const subNav = `<div class="ec-tabs" style="margin:4px 0 12px">${subTabs.map(([id, ic, l]) => `<button class="ec-tab${sub === id ? ' on' : ''}" onclick="ecSetTradeSub('${id}')"><span class="ec-tab-ic">${ic}</span><span class="ec-tab-l">${l}</span></button>`).join('')}</div>`;
  const subBody = sub === 'market' ? resBlock
    : sub === 'barter' ? `${barterBlock}<div class="ec-section-title">Технологии и чертежи</div>${ecTechMarketBlock()}`
      : caravanBlock;
  return `${ecIntro('⇄', 'Торговля', 'Превращайте ресурсы в ГС и обменивайтесь активами с другими фракциями.', ['<b>Караваны</b> — постоянные пути (поток добычи к партнёру, доход каждый ход). <b>Рынок</b> — продать со склада за 80%. <b>Обмен</b> — подарки/сделки и биржа техов и чертежей.'])}${subNav}${subBody}`;
}
function ecSetTradeSub(s) { EC.tradeSub = s; ecPaintCabinet(); }

// ── Биржа технологий и чертежей (адресные предложения) ──────────
function ecResearchLabel(key) {
  const all = (typeof ecBuildResearch === 'function') ? ecBuildResearch() : [];
  const n = all.find(x => x.id === key);
  return (n && n.name) || key;
}
// Свои чертежи: юниты своей фракции, кроме дивизий (дивизия — композиция другой техники).
function ecMyBlueprints() {
  return (EC.designs || []).filter(u => u && u.faction_id === EC.fid && u.category !== 'division');
}
function ecTechKindToggle() {
  const k = document.getElementById('ec-tm-kind') && document.getElementById('ec-tm-kind').value;
  const t = document.getElementById('ec-tm-tech-wrap'), b = document.getElementById('ec-tm-bp-wrap');
  if (t) t.style.display = (k === 'tech') ? '' : 'none';
  if (b) b.style.display = (k === 'blueprint') ? '' : 'none';
}
function ecTechMarketBlock() {
  const others = ecOtherFactions();
  const myTechs = (EC.eco && Array.isArray(EC.eco.research)) ? EC.eco.research : [];
  const mine = new Set(myTechs);
  const bps = ecMyBlueprints();
  const incoming = (EC.techOffers || []).filter(o => o.buyer_fid === EC.fid && o.status === 'pending');
  const outgoing = (EC.techOffers || []).filter(o => o.seller_fid === EC.fid && o.status === 'pending');

  const techOpts = myTechs.map(k => `<option value="${esc(k)}">${esc(ecResearchLabel(k))}</option>`).join('');
  const bpOpts = bps.map(u => `<option value="${esc(u.id)}">${esc(u.name || 'Чертёж')} · ${esc(u.category || '')}</option>`).join('');

  const form = !others.length
    ? '<div class="ec-empty">Нет других фракций для сделки.</div>'
    : `<div class="ec-prod-form" style="flex-wrap:wrap;gap:6px">
        ${ecFacSelect('ec-tm-buyer')}
        <select id="ec-tm-kind" onchange="ecTechKindToggle()">
          <option value="tech">Технология</option>
          <option value="blueprint">Чертёж (юнит)</option>
        </select>
        <span id="ec-tm-tech-wrap">${techOpts ? `<select id="ec-tm-tech">${techOpts}</select>` : '<span class="ec-hint">нет изученных технологий</span>'}</span>
        <span id="ec-tm-bp-wrap" style="display:none">${bpOpts ? `<select id="ec-tm-bp">${bpOpts}</select>` : '<span class="ec-hint">нет своих чертежей</span>'}</span>
        <input type="number" id="ec-tm-price" min="0" placeholder="цена ГС" class="ec-prod-qty">
        <button class="btn btn-gd btn-sm" onclick="ecTechOfferPropose()">Предложить</button>
      </div>
      <div class="ec-hint" style="margin-top:4px">Технологию покупатель получает в своё дерево исследований. Чертёж — копией, но купить выйдет, только если у него уже изучены все нужные для чертежа технологии.</div>`;

  const inHtml = incoming.map(o => {
    if (o.kind === 'tech') {
      return `<div class="ec-q-row"><span class="ec-r-name"><span class="ec-route-badge new">тех</span> <b>${esc(o.seller_name || ecFacName(o.seller_fid))}</b> продаёт технологию «${esc(o.tech_label || o.tech_key)}» за <b style="color:var(--gd)">${ecNum(o.price)} ГС</b></span><button class="btn btn-gd btn-xs" onclick="ecTechOfferAccept('${o.id}')">Купить</button><button class="ec-bld-del" title="Отклонить" onclick="ecTechOfferReject('${o.id}')">✕</button></div>`;
    }
    const req = Array.isArray(o.req_tech) ? o.req_tech : [];
    const missing = req.filter(k => !mine.has(k));
    const missTxt = missing.length ? `<div class="ec-hint" style="color:var(--err)">Не хватает технологий: ${missing.map(k => esc(ecResearchLabel(k))).join(', ')}</div>` : '';
    return `<div class="ec-q-row" style="flex-wrap:wrap"><span class="ec-r-name"><span class="ec-route-badge new">чертёж</span> <b>${esc(o.seller_name || ecFacName(o.seller_fid))}</b> продаёт чертёж «${esc(o.unit_name || 'юнит')}» (${esc(o.unit_category || '')}) за <b style="color:var(--gd)">${ecNum(o.price)} ГС</b>${missTxt}</span>${missing.length ? `<button class="btn btn-gh btn-xs" disabled title="Сначала изучите недостающие технологии">🔒 Нельзя</button>` : `<button class="btn btn-gd btn-xs" onclick="ecTechOfferAccept('${o.id}')">Купить</button>`}<button class="ec-bld-del" title="Отклонить" onclick="ecTechOfferReject('${o.id}')">✕</button></div>`;
  }).join('');

  const outHtml = outgoing.map(o => `<div class="ec-q-row"><span class="ec-r-name"><span class="ec-route-badge wait">⏳ ждёт ответа</span> ${o.kind === 'tech' ? 'технология «' + esc(o.tech_label || o.tech_key) + '»' : 'чертёж «' + esc(o.unit_name || 'юнит') + '»'} → <b>${esc(ecFacName(o.buyer_fid))}</b> · ${ecNum(o.price)} ГС</span><button class="ec-bld-del" title="Отозвать предложение" onclick="ecTechOfferCancel('${o.id}')">✕</button></div>`).join('');

  return `<div class="ec-dip-card">
      <div class="ec-dip-t">Биржа технологий и чертежей</div>
      ${form}
      ${incoming.length ? `<div class="ec-r-sec">Входящие предложения</div>${inHtml}` : ''}
      ${outgoing.length ? `<div class="ec-r-sec">Отправленные</div>${outHtml}` : ''}
    </div>`;
}
async function ecTechOfferPropose() {
  const buyer = document.getElementById('ec-tm-buyer') && document.getElementById('ec-tm-buyer').value;
  const kind = (document.getElementById('ec-tm-kind') && document.getElementById('ec-tm-kind').value) || 'tech';
  const price = Math.max(0, Math.round(+(document.getElementById('ec-tm-price') && document.getElementById('ec-tm-price').value) || 0));
  if (!buyer) { toast('Выберите фракцию-покупателя', 'err'); return; }
  const body = { p_buyer_fid: buyer, p_kind: kind, p_price: price,
    p_tech_key: null, p_tech_label: null, p_unit_name: null, p_unit_category: null, p_unit_snapshot: null, p_req_tech: [] };
  if (kind === 'tech') {
    const key = document.getElementById('ec-tm-tech') && document.getElementById('ec-tm-tech').value;
    if (!key) { toast('Нет технологии для продажи', 'err'); return; }
    body.p_tech_key = key; body.p_tech_label = ecResearchLabel(key);
  } else {
    const uid = document.getElementById('ec-tm-bp') && document.getElementById('ec-tm-bp').value;
    const u = ecMyBlueprints().find(x => x.id === uid);
    if (!u) { toast('Нет чертежа для продажи', 'err'); return; }
    body.p_unit_name = u.name || 'Чертёж';
    body.p_unit_category = u.category;
    body.p_unit_snapshot = { name: u.name, summary: u.summary, data: u.data, card_text: u.card_text };
    body.p_req_tech = (typeof cnUnitReqTech === 'function') ? cnUnitReqTech(u) : [];
  }
  try {
    await ecRpc('tech_offer_propose', body);
    toast('Предложение отправлено', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + ecErr(e.message), 'err'); }
}
async function ecTechOfferAccept(id) {
  if (!confirm('Купить? С казны спишется цена предложения.')) return;
  try { await ecRpc('tech_offer_accept', { p_offer_id: id }); toast('Сделка совершена ✓', 'ok'); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + ecErr(e.message), 'err'); }
}
async function ecTechOfferReject(id) {
  try { await ecRpc('tech_offer_reject', { p_offer_id: id }); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + ecErr(e.message), 'err'); }
}
async function ecTechOfferCancel(id) {
  try { await ecRpc('tech_offer_cancel', { p_offer_id: id }); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + ecErr(e.message), 'err'); }
}

// ── Вкладка «Дипломатия»: отношения · кредиты ──
function ecTabDiplomacy() {
  const others = ecOtherFactions(), noOthers = !others.length;
  const asLender = EC.loans.filter(l => l.lender_fid === EC.fid && ['active', 'disputed'].includes(l.status));
  const asBorrower = EC.loans.filter(l => l.borrower_fid === EC.fid && ['active', 'disputed'].includes(l.status));

  const lenderHtml = asLender.map(l => `<div class="ec-q-row"><span class="ec-r-name">${esc(l.borrower_name || ecFacName(l.borrower_fid))} должен ${ecNum(l.amount)} ГС${l.status === 'disputed' ? ' · <b style="color:var(--color-warning)">СПОР</b>' : ''}</span>${l.status === 'active' ? `<button class="btn btn-gh btn-xs" onclick="ecLoanDispute('${l.id}')">Спор</button>` : '<span class="ec-q-t">в МГА</span>'}</div>`).join('');
  const borrowerHtml = asBorrower.map(l => `<div class="ec-q-row"><span class="ec-r-name">Долг ${esc(l.lender_name || ecFacName(l.lender_fid))}: ${ecNum(l.amount)} ГС${l.status === 'disputed' ? ' · <b style="color:var(--color-warning)">СПОР</b>' : ''}</span><button class="btn btn-gd btn-xs" onclick="ecLoanRepay('${l.id}')">Погасить</button></div>`).join('');
  const loanBlock = `<div class="ec-dip-card">
      <div class="ec-dip-t">Кредиты</div>
      ${noOthers ? '<div class="ec-empty">Нет других фракций.</div>' : `<div class="ec-prod-form">${ecFacSelect('ec-loan-fac')}<input type="number" id="ec-loan-amt" min="1" placeholder="сумма ГС" class="ec-prod-qty"><button class="btn btn-gd btn-sm" onclick="ecLoanIssue()">Выдать заём</button></div>
      <input id="ec-loan-note" placeholder="условия (необязательно)" class="ec-loan-note" style="margin-top:6px">`}
      ${asLender.length ? `<div class="ec-r-sec">Я кредитор</div>${lenderHtml}` : ''}
      ${asBorrower.length ? `<div class="ec-r-sec">Я заёмщик</div>${borrowerHtml}` : ''}
    </div>`;

  return `${ecIntro('🤝', 'Дипломатия', 'Союзы, отношения и кредиты. Федерация/конфедерация дают защиту и общий флот; вассал платит сюзерену дань. Торговля и обмен — на вкладке «Торговля».', ['<b>Федерация/конфедерация</b> — союз нескольких держав: защита караванов и от разведки, общий флот.', '<b>Вассалитет</b> — вассал платит сюзерену дань с дохода (как у Paradox).', 'Можно выдавать займы; споры по долгам решает МГА.'])}<div class="ec-section-title">Союзы <span class="ec-hint">— федерация · конфедерация · вассалитет</span></div>
    ${ecAllianceBlock()}
    <div class="ec-section-title">Отношения <span class="ec-hint">— дипломатический респект</span></div>
    ${ecRelationsBlock()}
    <div class="ec-section-title">Кредиты</div>
    <div class="ec-dip-grid">${loanBlock}</div>`;
}

// Блок союзов: федерация/конфедерация (группа) + вассалитет (парный пакт). Слайс 1.
function ecAllianceBlock() {
  const d = EC.diplo || { union: null, members: [], invites: [], vassals: [] };
  const chip = (txt, crown) => `<span style="display:inline-block;background:var(--b1);border:1px solid var(--w2);border-radius:8px;padding:3px 9px;margin:2px;font-size:12px">${esc(txt)}${crown ? ' 👑' : ''}</span>`;
  let unionHtml;
  if (d.union) {
    const isLeader = d.union.leader_fid === EC.fid;
    const kindName = d.union.kind === 'federation' ? 'Федерация' : 'Конфедерация';
    const membersHtml = (d.members || []).map(m => chip(m.name, m.fid === d.union.leader_fid)).join('');
    unionHtml = `<div class="ec-dip-t">${d.union.kind === 'federation' ? '🛡' : '🤝'} ${esc(kindName)}: «${esc(d.union.name)}»</div>
      <div style="margin:6px 0">${membersHtml}</div>
      ${isLeader ? `<div class="ec-prod-form" style="margin-top:6px">${ecFacSelect('ec-union-inv')}<button class="btn btn-gd btn-sm" onclick="ecUnionInvite()">Пригласить</button></div>` : ''}
      <button class="btn btn-gh btn-sm" style="margin-top:6px" onclick="ecUnionLeave()">Выйти из союза</button>`;
  } else {
    unionHtml = `<div class="ec-dip-t">🤝 Союз</div>
      <div class="ec-empty" style="padding:6px">Вы не в союзе. Создайте федерацию или конфедерацию и приглашайте державы.</div>
      <div class="ec-prod-form" style="margin-top:6px;flex-wrap:wrap">
        <input id="ec-union-name" placeholder="название союза" class="ec-loan-note" style="flex:1;min-width:140px">
        <select id="ec-union-kind" class="ec-prod-qty" style="width:auto"><option value="confederation">Конфедерация</option><option value="federation">Федерация</option></select>
        <button class="btn btn-gd btn-sm" onclick="ecUnionCreate()">Создать</button>
      </div>`;
  }
  const invHtml = (d.invites || []).map(i => `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      <span class="ec-route-badge new">приглашение</span> <b>${esc(i.name)}</b> (${i.kind === 'federation' ? 'федерация' : 'конфедерация'}) от ${esc(i.leader)}
    </span><button class="btn btn-gd btn-xs" onclick="ecUnionInviteRespond('${i.id}',true)">Вступить</button><button class="ec-bld-del" onclick="ecUnionInviteRespond('${i.id}',false)">✕</button></div>`).join('');

  const vassals = d.vassals || [];
  const myVassals = vassals.filter(v => v.overlord === EC.fid);
  const asVassal = vassals.filter(v => v.vassal === EC.fid);
  const vassalRows = myVassals.map(v => `<div class="ec-q-row"><span class="ec-r-name">${v.status === 'pending' ? '⏳ ' : '👑 '}Вассал <b>${esc(v.vassal_name)}</b> · дань ${Math.round(v.tribute_pct * 100)}%${v.status === 'pending' ? ' (ждёт ответа)' : ''}</span><button class="ec-bld-del" title="Разорвать" onclick="ecVassalBreak('${v.id}')">✕</button></div>`).join('');
  const overlordRows = asVassal.map(v => v.status === 'pending'
    ? `<div class="ec-q-row ec-route-row"><span class="ec-r-name"><span class="ec-route-badge new">вассалитет</span> <b>${esc(v.overlord_name)}</b> предлагает стать сюзереном · дань ${Math.round(v.tribute_pct * 100)}%</span><button class="btn btn-gd btn-xs" onclick="ecVassalRespond('${v.id}',true)">Принять</button><button class="ec-bld-del" onclick="ecVassalRespond('${v.id}',false)">✕</button></div>`
    : `<div class="ec-q-row"><span class="ec-r-name">Сюзерен <b>${esc(v.overlord_name)}</b> · дань ${Math.round(v.tribute_pct * 100)}%</span><button class="ec-bld-del" title="Разорвать" onclick="ecVassalBreak('${v.id}')">✕</button></div>`).join('');
  const amVassal = asVassal.some(v => v.status === 'active');
  const vassalBlock = `<div class="ec-dip-card"><div class="ec-dip-t">👑 Вассалитет <span class="ec-hint">вассал платит сюзерену дань с дохода</span></div>
      ${amVassal ? '<div class="ec-empty" style="padding:6px">Вы уже чей-то вассал — нельзя брать своих вассалов.</div>' : `<div class="ec-prod-form" style="flex-wrap:wrap">${ecFacSelect('ec-vassal-fac')}<input type="number" id="ec-vassal-pct" min="5" max="30" value="10" class="ec-prod-qty" style="width:70px" title="дань, %"><button class="btn btn-gd btn-sm" onclick="ecVassalPropose()">Сделать вассалом</button></div>`}
      ${vassalRows ? `<div class="ec-r-sec">Мои вассалы</div>${vassalRows}` : ''}
      ${overlordRows ? `<div class="ec-r-sec">Мой статус</div>${overlordRows}` : ''}
    </div>`;

  return `<div class="ec-dip-grid">
      <div class="ec-dip-card">${unionHtml}${invHtml ? `<div class="ec-r-sec">📥 Приглашения вам</div>${invHtml}` : ''}</div>
      ${vassalBlock}
    </div>`;
}
function ecUnionCreate() {
  const name = ecId('ec-union-name')?.value?.trim();
  const kind = ecId('ec-union-kind')?.value || 'confederation';
  if (!name) { toast('Введите название союза', 'err'); return; }
  ecRpcAct('union_create', { p_kind: kind, p_name: name }, 'Союз создан');
}
function ecUnionInvite() {
  const fid = ecId('ec-union-inv')?.value;
  if (!fid || !EC.diplo.union) { toast('Выберите фракцию', 'err'); return; }
  ecRpcAct('union_invite', { p_union_id: EC.diplo.union.id, p_target_fid: fid }, 'Приглашение отправлено');
}
function ecUnionInviteRespond(id, acc) { ecRpcAct('union_invite_respond', { p_invite_id: id, p_accept: !!acc }, acc ? 'Вы вступили в союз' : 'Приглашение отклонено'); }
function ecUnionLeave() { if (confirm('Выйти из союза?')) ecRpcAct('union_leave', {}, 'Вы вышли из союза'); }
function ecVassalPropose() {
  const fid = ecId('ec-vassal-fac')?.value;
  const pct = Math.max(5, Math.min(30, parseInt(ecId('ec-vassal-pct')?.value) || 10)) / 100;
  if (!fid) { toast('Выберите фракцию', 'err'); return; }
  ecRpcAct('vassal_propose', { p_target_fid: fid, p_tribute_pct: pct }, 'Предложение вассалитета отправлено');
}
function ecVassalRespond(id, acc) { ecRpcAct('vassal_respond', { p_id: id, p_accept: !!acc }, acc ? 'Вассалитет принят' : 'Отклонено'); }
function ecVassalBreak(id) { if (confirm('Разорвать вассалитет?')) ecRpcAct('vassal_break', { p_id: id }, 'Вассалитет разорван'); }

// ── Блок «Обмен» (бартер): отдать/запросить ГС·ОН·ресурсы·корабли ──
function ecBarterBlock(others, noOthers, stock) {
  if (noOthers) return `<div class="ec-dip-card"><div class="ec-dip-t">Обмен</div><div class="ec-empty">Нет других фракций.</div></div>`;
  if (!EC.bt) EC.bt = { give: [], want: [] };

  // входящие/исходящие предложения обмена
  const inOf = (EC.barters || []).filter(o => o.to_fid === EC.fid);
  const outOf = (EC.barters || []).filter(o => o.from_fid === EC.fid);
  const inHtml = inOf.map(o => `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      <span class="ec-route-badge new">обмен</span>
      <b>${esc(ecFacName(o.from_fid))}</b>: вы получите <b style="color:var(--gd)">${esc(ecBarterSummary(o.give))}</b> за <b style="color:var(--color-warning,#e0a030)">${esc(ecBarterSummary(o.want))}</b>
    </span><button class="btn btn-gd btn-xs" title="Принять обмен" onclick="ecBarterAccept('${o.id}')">Принять</button><button class="ec-bld-del" title="Отклонить" onclick="ecBarterReject('${o.id}')">✕</button></div>`).join('');
  const outHtml = outOf.map(o => `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      <span class="ec-route-badge wait">⏳ ждёт ответа</span>
      → <b>${esc(ecFacName(o.to_fid))}</b>: отдаёте <b>${esc(ecBarterSummary(o.give))}</b> за <b>${esc(ecBarterSummary(o.want))}</b>
    </span><button class="ec-bld-del" title="Отозвать" onclick="ecBarterCancel('${o.id}')">✕</button></div>`).join('');

  const inBadge = inOf.length ? `<span class="ec-route-badge new">${inOf.length} вам</span>` : '';
  return `<div class="ec-dip-card ec-bt-card"><div class="ec-dip-t"><span>Обмен ${inBadge}</span><span class="ec-hint">подарок или сделка «отдать ↔ получить»</span></div>
      <div class="ec-bt-fac">${ecFacSelect('ec-bt-fac')}</div>
      <div class="ec-bt-cols">
        <div class="ec-bt-col"><div class="ec-bt-col-t">📤 Вы отдаёте</div><div id="ec-bt-give-box">${ecBarterBoxHtml('give')}</div></div>
        <div class="ec-bt-col"><div class="ec-bt-col-t">📥 Хотите взамен <span class="ec-hint">пусто = подарок</span></div><div id="ec-bt-want-box">${ecBarterBoxHtml('want')}</div></div>
      </div>
      <button class="btn btn-gd btn-sm ec-bt-send" onclick="ecBarterPropose()">Предложить обмен</button>
      <div class="ec-r-sec">📥 Входящие предложения${inOf.length ? '' : ' <span class="ec-hint">— нажмите «Принять», когда появятся</span>'}</div>
      ${inHtml || '<div class="ec-empty" style="padding:8px">Пока никто не предложил вам обмен. Чужие предложения появятся здесь с кнопкой «Принять».</div>'}
      <div class="ec-r-sec">📤 Отправленные вами</div>
      ${outHtml || '<div class="ec-empty" style="padding:8px">Вы пока не отправляли предложений.</div>'}
    </div>`;
}
// Подпись добавленной позиции обмена
function ecBarterItemLabel(it) {
  if (it.kind === 'gc') return `${ecNum(it.qty)} ГС`;
  if (it.kind === 'science') return `${ecNum(it.qty)} ОН`;
  if (it.kind === 'ship') return `${ecNum(it.qty)}× ${it.name}`;
  return `${ecNum(it.qty)} ${it.name}`;
}
// Список добавленных позиций (чипы) + строка добавления
function ecBarterBoxHtml(side) {
  const items = (EC.bt && EC.bt[side]) || [];
  const list = items.length
    ? items.map((it, i) => `<span class="ec-bt-chip"><span>${esc(ecBarterItemLabel(it))}</span><button title="Убрать" onclick="ecBarterDel('${side}',${i})">✕</button></span>`).join('')
    : `<div class="ec-bt-empty">${side === 'give' ? 'ничего не выбрано' : 'пусто — будет подарок'}</div>`;
  return `<div class="ec-bt-chips">${list}</div>${ecBarterAddRow(side)}`;
}
// Строка «тип → значение → ＋». Поля зависят от выбранного типа.
function ecBarterAddRow(side) {
  const kind = (EC.bt && EC.bt[side + 'Kind']) || 'gc';
  let valHtml;
  if (kind === 'gc' || kind === 'science') {
    valHtml = `<input type="number" id="ec-bt-${side}-val" min="1" placeholder="сумма" class="ec-bt-num">`;
  } else if (kind === 'resource') {
    if (side === 'give') {
      const opts = ecResEntries().map(([n, v]) => `<option value="${esc(n)}">${esc(n)} (${ecNum(v)})</option>`).join('') || '<option value="">— нет —</option>';
      valHtml = `<select id="ec-bt-${side}-name">${opts}</select><input type="number" id="ec-bt-${side}-val" min="1" placeholder="кол-во" class="ec-prod-qty">`;
    } else {
      valHtml = `<input id="ec-bt-${side}-name" placeholder="ресурс" class="ec-bt-name"><input type="number" id="ec-bt-${side}-val" min="1" placeholder="кол-во" class="ec-prod-qty">`;
    }
  } else { // ship
    if (side === 'give') {
      const opts = ecMyShipList().map(s => `<option value="${esc(s.name)}">${esc(s.name)} (${ecNum(s.qty)})</option>`).join('') || '<option value="">— нет —</option>';
      valHtml = `<select id="ec-bt-${side}-name">${opts}</select><input type="number" id="ec-bt-${side}-val" min="1" placeholder="кол-во" class="ec-prod-qty">`;
    } else {
      valHtml = `<input id="ec-bt-${side}-name" placeholder="корабль" class="ec-bt-name"><input type="number" id="ec-bt-${side}-val" min="1" placeholder="кол-во" class="ec-prod-qty">`;
    }
  }
  return `<div class="ec-bt-add">
      <select class="ec-bt-kind" onchange="ecBarterKind('${side}',this.value)">
        <option value="gc"${kind === 'gc' ? ' selected' : ''}>ГС</option>
        <option value="science"${kind === 'science' ? ' selected' : ''}>ОН</option>
        <option value="resource"${kind === 'resource' ? ' selected' : ''}>Ресурс</option>
        <option value="ship"${kind === 'ship' ? ' selected' : ''}>Корабль</option>
      </select>
      ${valHtml}
      <button class="btn btn-gh btn-xs ec-bt-addbtn" title="Добавить" onclick="ecBarterAdd('${side}')">＋</button>
    </div>`;
}
function ecBarterRefresh(side) { const box = ecId(`ec-bt-${side}-box`); if (box) box.innerHTML = ecBarterBoxHtml(side); }
function ecBarterKind(side, v) { EC.bt[side + 'Kind'] = v; ecBarterRefresh(side); }
function ecBarterAdd(side) {
  if (!EC.bt) EC.bt = { give: [], want: [] };
  const kind = EC.bt[side + 'Kind'] || 'gc';
  const qty = Math.max(0, parseInt(ecId(`ec-bt-${side}-val`)?.value) || 0);
  if (!qty) { toast('Укажите количество', 'err'); return; }
  let name = null;
  if (kind === 'resource' || kind === 'ship') {
    name = (ecId(`ec-bt-${side}-name`)?.value || '').trim();
    if (!name) { toast(kind === 'ship' ? 'Укажите корабль' : 'Укажите ресурс', 'err'); return; }
  }
  EC.bt[side] = EC.bt[side] || [];
  const ex = EC.bt[side].find(it => it.kind === kind && it.name === name);
  if (ex) ex.qty += qty; else EC.bt[side].push({ kind, name, qty });
  ecBarterRefresh(side);
}
function ecBarterDel(side, i) { if (EC.bt && EC.bt[side]) { EC.bt[side].splice(i, 1); ecBarterRefresh(side); } }

// ── Вкладка «Разведка» (тайные операции 2.0) ────────────────
function ecTabIntel() {
  const intelSlots = ecSlotsSum('intel');
  const others = ecOtherFactions();
  const free = ecSpyFree(), committed = ecSpyCommitted(), ci = EC.eco.counter_agents || 0;
  const active = (EC.missions || []).filter(m => m.actor_fid === EC.fid && m.status === 'active');
  const doneOps = (EC.missions || []).filter(m => m.status === 'done');

  // Панель агентов
  const agentBar = `<div class="ec-treasury" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
      <div class="ec-res"><span class="ec-res-k">Свободно</span><span class="ec-res-v" style="color:var(--te)">${ecNum(free)}</span></div>
      <div class="ec-res"><span class="ec-res-k">На операциях</span><span class="ec-res-v" style="color:var(--color-warning,#e0a030)">${ecNum(committed)}</span></div>
      <div class="ec-res"><span class="ec-res-k">Контрразведка</span><span class="ec-res-v" style="color:var(--pu)">${ecNum(ci)}</span></div>
      <div class="ec-res"><span class="ec-res-k">Потолок / обучаются</span><span class="ec-res-v" style="font-size:15px">${ecNum((EC.spyAgency || {}).cap || 0)} / ${ecNum(ecSpyTraining())}</span></div>
    </div>`;

  // Контрразведка — распределение агентов по объектам (Центр + колонии)
  const cmap = (EC.eco && EC.eco.counter_map) || {};
  const ciScopes = [['hq', '🏛 Центр', 'казна, технологии, дестабилизация']]
    .concat((EC.colonies || []).map(c => [c.id, '🏗 ' + (c.planet_name || 'Колония'), 'защита от саботажа по ней']));
  const ciRows = ciScopes.map(([key, label, sub]) => {
    const n = +(cmap[key] || 0);
    return `<div class="ec-ci-row" style="gap:8px">
        <span style="flex:1;text-align:left;min-width:0"><b>${esc(label)}</b> <i style="color:var(--t4);font-style:normal">${esc(sub)}</i></span>
        <button class="btn btn-gh btn-sm" ${n <= 0 ? 'disabled' : ''} onclick="ecCounterIntel('${esc(key)}', ${n - 1})">−</button>
        <span class="ec-ci-val" style="min-width:24px;text-align:center">${n}</span>
        <button class="btn btn-gh btn-sm" ${free <= 0 ? 'disabled' : ''} onclick="ecCounterIntel('${esc(key)}', ${n + 1})">＋</button>
      </div>`;
  }).join('');
  const ciBlock = `<div class="ec-dip-card"><div class="ec-dip-t">🛡 Контрразведка <span class="ec-hint">всего в защите: ${ecNum(ci)} · свободно ${ecNum(free)}</span></div>
      ${ciRows}
      <div class="cn-fac-hint" style="margin-top:6px">Сажайте агентов на объекты: <b>Центр</b> ловит шпионов по казне/технологиям/дестабилизации, <b>колония</b> — саботаж именно по ней. Перк 🛡 Куратор усиливает КР везде и ускоряет расследования.</div></div>`;

  // Планировщик
  let planner;
  if (!others.length) planner = '<div class="ec-empty">Нет других фракций для операций.</div>';
  else if (!ecSpyRoster().length) planner = '<div class="ec-empty">Нет агентов. Наймите оперативников на рынке рекрутов выше (Центр Спецслужб задаёт потолок).</div>';
  else {
    if (!EC.spyTarget || !others.find(f => f.faction_id === EC.spyTarget)) EC.spyTarget = others[0].faction_id;
    const tgtOpts = others.map(f => `<option value="${esc(f.faction_id)}"${f.faction_id === EC.spyTarget ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
    const opCards = EC_SPY_ORDER.map(opk => {
      const d = EC_SPY_OPS[opk]; const c = ecSpyCalc(opk, [], EC.spyTarget);
      const locked = !!c.err;
      return `<button type="button" class="ec-spy-op${opk === EC.spyOp ? ' on' : ''}${locked ? ' locked' : ''}" ${locked ? `title="${esc(c.err)}" style="opacity:.55"` : ''} onclick="ecPickSpyOp('${opk}')">
        <span class="ec-spy-op-ic">${d.icon}</span><span class="ec-spy-op-n">${esc(d.label)}</span>${locked ? `<span class="ec-spy-op-lock" title="${esc(c.err)}">🔒</span>` : ''}</button>`;
    }).join('');
    planner = `<div class="ec-trade-form">
      <div class="ec-trade-label">1 · Цель</div>
      <select id="ec-spy-target" onchange="ecPickSpyTarget(this.value)">${tgtOpts}</select>
      <div class="ec-trade-label">2 · Операция</div>
      <div class="ec-spy-ops">${opCards}</div>
      <div id="ec-spy-colony"></div>
      <div class="ec-trade-label">3 · Агенты <span class="ec-hint">перки баффают операцию · свободно ${free}</span></div>
      <div id="ec-spy-agents-pick" style="display:flex;flex-wrap:wrap;gap:6px">${ecSpyAgentPickHtml()}</div>
      <div class="ec-trade-summary" id="ec-spy-summary"></div>
      <button class="btn btn-gd" id="ec-spy-launch" onclick="ecSpyLaunch()">Запустить операцию</button>
    </div>`;
  }

  const activeHtml = active.length ? active.map(ecSpyActiveRow).join('') : '<div class="ec-empty" style="padding:8px">Активных операций нет.</div>';
  const logHtml = doneOps.length ? doneOps.slice(0, 20).map(ecSpyLogRow).join('') : '<div class="ec-empty" style="padding:8px">Операций ещё не было.</div>';
  const alertsHtml = (EC.alerts || []).length
    ? EC.alerts.slice(0, 15).map(ecSpyAlertRow).join('')
    : '<div class="ec-empty" style="padding:8px">Тревог нет — против вас ничего не предпринимали (или попытки не оставили следов).</div>';

  // Агентура: ростер нанятых + еженедельный рынок рекрутов
  const ag = EC.spyAgency || { cap: 0, hired: 0, roster: [], recruits: [], refresh_at: null };
  const refreshDays = ag.refresh_at ? Math.max(0, Math.ceil((new Date(ag.refresh_at).getTime() - Date.now()) / 86400000)) : null;
  const atCap = (ag.hired || 0) >= (ag.cap || 0);
  const stBadge = { training: { t: 'обучается', c: 'var(--color-warning,#e0a030)' }, busy: { t: 'на операции', c: 'var(--te)' }, ready: { t: 'готов', c: 'var(--ok)' } };
  const rosterHtml = (ag.roster || []).length
    ? ag.roster.map(a => {
        const pk = ecPerk(a.perk); const sb = stBadge[a.status] || stBadge.ready;
        const trainLeft = a.status === 'training' && a.ready_at ? ` ~${Math.max(1, Math.ceil((new Date(a.ready_at).getTime() - Date.now()) / 86400000))} ход.` : '';
        return `<div class="ec-q-row">
        <span class="ec-r-name">🕵 <b>${esc(a.first_name)} ${esc(a.last_name)}</b> <i style="color:var(--t4);font-style:normal" title="${esc(pk.desc)}"> · ${pk.icon} ${esc(pk.label)}</i> <i style="color:${sb.c};font-style:normal"> · ${sb.t}${trainLeft}</i></span>
        <button class="ec-bld-del" title="${a.status === 'busy' ? 'Агент на операции' : 'Уволить'}" ${a.status === 'busy' ? 'disabled' : ''} onclick="ecSpyFire('${esc(a.id)}')">✕</button></div>`; }).join('')
    : '<div class="ec-empty" style="padding:6px">Нет нанятых агентов — наймите из списка рекрутов справа.</div>';
  const recruitsHtml = (ag.recruits || []).length
    ? ag.recruits.map(r => { const pk = ecPerk(r.perk); return `<div class="ec-q-row" style="flex-wrap:wrap;gap:6px">
        <span class="ec-r-name">${pk.icon} <b>${esc(r.first_name)} ${esc(r.last_name)}</b> <i style="color:var(--t4);font-style:normal" title="${esc(pk.desc)}"> · ${esc(pk.label)}</i></span>
        <button class="btn btn-gd btn-xs" ${atCap ? 'disabled title="Достигнут потолок агентов — стройте Центр Спецслужб"' : ''} onclick="ecSpyHire('${esc(r.id)}')">Нанять · ${ecNum(r.cost)} ГС</button></div>`; }).join('')
    : '<div class="ec-empty" style="padding:6px">Список рекрутов пуст.</div>';
  const agencyBlock = `<div class="ec-dip-grid">
      <div class="ec-dip-card"><div class="ec-dip-t">🕵 Агентура <span class="ec-hint">нанятые оперативники (${ag.hired || 0}/${ag.cap || 0})</span></div>
        <div class="ec-queue">${rosterHtml}</div></div>
      <div class="ec-dip-card"><div class="ec-dip-t">📋 Рынок рекрутов <span class="ec-hint">обновится через ${refreshDays != null ? refreshDays + ' дн.' : '—'}</span></div>
        <div class="ec-queue">${recruitsHtml}</div></div>
    </div>`;

  return `${ecIntro('🕵', 'Разведка и тайные операции', 'Шпионьте за другими фракциями: разведка, кража казны и технологий, саботаж, дестабилизация.', ['<b>Агентов</b> нанимаете на еженедельном рынке рекрутов — у каждого имя и перк. Центр спецслужб задаёт потолок числа агентов.', 'Сложные операции требуют сначала провести <b>разведку</b> цели.', 'Оставляйте часть агентов на <b>контрразведку</b> — иначе вас безнаказанно атакуют.'])}${agentBar}
    ${agencyBlock}
    <div class="ec-dip-grid">
      <div class="ec-dip-card ec-dip-trade"><div class="ec-dip-t">🎯 Планирование операции <span class="ec-hint">расчёт по разведданным и агентам</span></div>${planner}</div>
      ${ciBlock}
    </div>
    <div class="ec-section-title">Активные операции <span class="ec-hint">— завершаются через N ходов</span></div>
    <div class="ec-queue">${activeHtml}</div>
    <div class="ec-section-title">🛡 Тревоги контрразведки <span class="ec-hint">— операции против вас (исполнитель виден только если раскрыт)</span></div>
    <div class="ec-queue">${alertsHtml}</div>
    <div class="ec-section-title">Журнал — ваши операции</div>
    <div class="ec-queue">${logHtml}</div>`;
}

// ════════════════════════════════════════════════════════════
// КАПЕРСТВО (РЕЙДЫ) — флот грабит чужие караваны
// ════════════════════════════════════════════════════════════
// Тиры торговой политики — зеркало _trade_policy_cost/_def (бэкенд авторитетен)
const EC_TRADE_POLICY = [
  { name: 'Нет', cost: 0, def: 0 },
  { name: 'Патрульный контракт', cost: 120, def: 8 },
  { name: 'Конвой Торговой Лиги', cost: 350, def: 18 },
];
function ecRaidPolicySet(t) { ecRpcAct('raid_policy_set', { p_tier: Math.max(0, Math.min(2, t)) }, 'Торговая политика обновлена'); }
function ecTabRaids() {
  const st = EC.raidStatus || { ships: 0, free: 0, raids: 0, policy: 0 };
  const pol = st.policy || 0; const polInfo = EC_TRADE_POLICY[pol] || EC_TRADE_POLICY[0];
  const others = ecOtherFactions();
  const active = (EC.raids || []).filter(m => m.status === 'active');
  const done = (EC.raids || []).filter(m => m.status === 'done');

  const shipBar = `<div class="ec-treasury" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
      <div class="ec-res"><span class="ec-res-k">Корабли</span><span class="ec-res-v">${ecNum(st.ships || 0)}</span></div>
      <div class="ec-res"><span class="ec-res-k">Свободно</span><span class="ec-res-v" style="color:var(--te)">${ecNum(st.free || 0)}</span></div>
      <div class="ec-res"><span class="ec-res-k">В рейдах</span><span class="ec-res-v" style="color:var(--color-warning,#e0a030)">${ecNum(st.raids || 0)}</span></div>
      <div class="ec-res"><span class="ec-res-k">Защита</span><span class="ec-res-v" style="color:var(--pu)">${esc(polInfo.name)}</span></div>
    </div>`;

  const policyBlock = `<div class="ec-dip-card"><div class="ec-dip-t">📜 Торговая политика <span class="ec-hint">платная защита всех караванов</span></div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
        ${EC_TRADE_POLICY.map((p, i) => `<button class="btn ${i === pol ? 'btn-gd' : 'btn-gh'} btn-sm" style="display:flex;justify-content:space-between;gap:8px" onclick="ecRaidPolicySet(${i})">
            <span>${i === pol ? '✓ ' : ''}${esc(p.name)}</span>
            <span style="opacity:.8">${p.cost ? `${ecNum(p.cost)} ГС/ход · +${p.def} защ.` : 'бесплатно'}</span>
          </button>`).join('')}
      </div>
      <div class="cn-fac-hint" style="margin-top:6px">Контракт с NPC-флотом защищает ВСЕ ваши караваны от рейдов; апкип списывается каждый ход. Конвой (свои корабли на конкретный путь) добавляется сверху.</div></div>`;

  let planner;
  if ((st.ships || 0) < 1) planner = '<div class="ec-empty">Нет военных кораблей. Постройте Корабельную Верфь и заложите корабли (вкладка «Военпром»).</div>';
  else if (!others.length) planner = '<div class="ec-empty">Нет других фракций для рейда.</div>';
  else {
    if (!EC.raidTarget || !others.find(f => f.faction_id === EC.raidTarget)) { EC.raidTarget = others[0].faction_id; EC.raidScout = null; }
    const tgtOpts = others.map(f => `<option value="${esc(f.faction_id)}"${f.faction_id === EC.raidTarget ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
    const hasRecon = !!(ecSpyDossier(EC.raidTarget).level);   // караваны видны только после разведки цели
    const scout = (EC.raidScout && EC.raidScout.fid === EC.raidTarget) ? EC.raidScout.routes : null;
    let caravans;
    if (!hasRecon) caravans = `<div class="ec-empty" style="padding:8px">🔒 Нет разведданных об этой фракции. Чужие караваны видны <b>только после разведки</b> — проведите операцию «Разведка» во вкладке «Разведка». <button class="btn btn-gh btn-xs" style="margin-left:6px" onclick="ecSetTab('intel')">→ В Разведку</button></div>`;
    else if (scout == null) caravans = `<div class="ec-empty" style="padding:8px">Нажмите «🔭 Обновить караваны», чтобы увидеть текущие караваны цели.</div>`;
    else if (!scout.length) caravans = `<div class="ec-empty" style="padding:8px">У цели нет активных караванов — грабить нечего.</div>`;
    else caravans = scout.map(rt => {
      const maxShips = Math.max(1, st.free || 0);
      return `<div class="ec-q-row" style="flex-wrap:wrap;gap:6px">
        <span class="ec-r-name">${ecRouteCargoText(rt)} · 🛡 эскорт ${ecNum(rt.convoy || 0)}</span>
        <span style="display:flex;gap:6px;align-items:center">
          <input type="number" id="raid-ships-${esc(rt.id)}" min="1" max="${maxShips}" value="${Math.min(1, maxShips)}" class="ec-trade-volnum" style="width:64px" title="Кораблей в рейд">
          <button class="btn btn-gd btn-xs" ${(st.free || 0) < 1 ? 'disabled' : ''} onclick="ecRaidLaunch('${esc(rt.id)}')">🏴‍☠ Рейд</button>
        </span></div>`;
    }).join('');
    planner = `<div class="ec-trade-form">
      <div class="ec-trade-label">1 · Цель <span class="ec-hint">караваны видны только по разведанным фракциям</span></div>
      <div style="display:flex;gap:6px">
        <select id="ec-raid-target" onchange="ecRaidPickTarget(this.value)" style="flex:1">${tgtOpts}</select>
        ${hasRecon
          ? `<button class="btn btn-gh btn-sm" onclick="ecRaidScout()">🔭 Обновить караваны</button>`
          : `<button class="btn btn-gh btn-sm" onclick="ecSetTab('intel')">🕵 Разведать в «Разведке»</button>`}
      </div>
      <div class="ec-trade-label">2 · Караваны цели <span class="ec-hint">грабить можно только то, что везут</span></div>
      <div class="ec-queue">${caravans}</div>
    </div>`;
  }

  const activeHtml = active.length ? active.map(ecRaidActiveRow).join('') : '<div class="ec-empty" style="padding:8px">Активных рейдов нет.</div>';
  const logHtml = done.length ? done.slice(0, 20).map(ecRaidLogRow).join('') : '<div class="ec-empty" style="padding:8px">Рейдов ещё не было.</div>';

  return `${ecIntro('🏴‍☠', 'Каперство · рейды', 'Шлите военные корабли грабить чужие караваны. Добыча — ресурсы и ГС. Но эскорт даёт отпор: в бою корабли теряют обе стороны.', ['Сила рейда — от <b>числа кораблей</b>. Защита цели (конвой + торговая политика) сопротивляется: победит сильнейший, потери считаются у всех.', 'Грабить можно только <b>активный караван</b> цели — нет торговли, нечего и грабить.', 'Включите <b>торговую политику</b> — платный контракт защищает все ваши караваны. За раскрытый разбой отношения падают.'])}${shipBar}
    <div class="ec-dip-grid">
      <div class="ec-dip-card ec-dip-trade"><div class="ec-dip-t">🎯 Планирование рейда</div>${planner}</div>
      ${policyBlock}
    </div>
    <div class="ec-section-title">Активные рейды <span class="ec-hint">— флот в пути, завершатся через N ходов</span></div>
    <div class="ec-queue">${activeHtml}</div>
    <div class="ec-section-title">Журнал рейдов</div>
    <div class="ec-queue">${logHtml}</div>`;
}

function ecRaidActiveRow(m) {
  return `<div class="ec-q-row"><span class="ec-r-name">🏴‍☠ Рейд на <b>${esc(m.target_name || ecFacName(m.target_fid))}</b> · ${ecNum(m.ships)} кораблей</span>${ecProgressISO(m.started_at, m.ready_at, 1, 'подходит к цели')}<button class="ec-bld-del" title="Отозвать рейд" onclick="ecRaidCancel('${esc(m.id)}')">✕</button></div>`;
}
function ecRaidLogRow(m) {
  const o = m.outcome || {};
  if (o.result === 'no_target') return `<div class="ec-q-row"><span class="ec-r-name">🏴‍☠ Рейд на <b>${esc(m.target_name || ecFacName(m.target_fid))}</b> — караван ушёл, добычи нет</span></div>`;
  const loot = [];
  if (o.loot_units) loot.push(`${ecNum(o.loot_units)} ед. ${esc(o.resource || 'груза')}`);
  if (o.loot_gc) loot.push(`${ecNum(o.loot_gc)} ГС`);
  const lootTxt = loot.length ? `угнано ${loot.join(' + ')}` : 'добычи нет';
  const win = (o.loot_frac || 0) > 0;
  return `<div class="ec-q-row"><span class="ec-r-name">${win ? '✅' : '❌'} Рейд на <b>${esc(m.target_name || ecFacName(m.target_fid))}</b> — ${lootTxt}. Потери: ваши ${ecNum(o.att_losses || 0)}, эскорт ${ecNum(o.def_losses || 0)}.${o.detected ? ' · <b style="color:var(--err)">раскрыты</b>' : ''}</span></div>`;
}

// ── Действия рейдов ─────────────────────────────────────────
function ecRaidPickTarget(fid) { EC.raidTarget = fid; EC.raidScout = null; ecPaintCabinet(); }
async function ecRaidScout() {
  const fid = EC.raidTarget; if (!fid) return;
  if (!ecSpyDossier(fid).level) { toast('Сначала разведайте эту фракцию во вкладке «Разведка»', 'err'); ecSetTab('intel'); return; }
  try {
    const routes = await ecRpc('raid_scout', { p_target_fid: fid });
    EC.raidScout = { fid, routes: routes || [] };
    ecPaintCabinet();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); }
}
function ecRaidLaunch(routeId) {
  const n = Math.max(1, parseInt(ecId('raid-ships-' + routeId)?.value) || 1);
  ecRpcAct('raid_launch', { p_target_fid: EC.raidTarget, p_route_id: routeId, p_ships: n }, 'Рейд отправлен — флот в пути');
}
function ecRaidCancel(id) { ecRpcAct('raid_cancel', { p_id: id }, 'Рейд отозван'); }
function ecRaidPatrol(n) { ecRpcAct('raid_patrol_set', { p_n: Math.max(0, n) }, 'Патруль обновлён'); }
// Строка активной операции (с таймером)
function ecSpyActiveRow(m) {
  const d = EC_SPY_OPS[m.op] || { icon: '•', label: m.op };
  return `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      <span class="ec-route-badge wait">${d.icon} идёт</span>
      <b>${esc(d.label)}</b> → ${esc(m.target_name || ecFacName(m.target_fid))} · 🕵 ${ecNum(m.agents)} · успех ${ecNum(m.success_pct)}% · раскрытие ${ecNum(m.detect_pct)}%
    </span>${ecProgressISO(m.created_at, m.ready_at, 1, 'готово в конце хода')}<button class="ec-bld-del" title="Отозвать (вернуть агентов)" onclick="ecSpyCancel('${m.id}')">✕</button></div>`;
}
// Строка «тревоги» — входящая операция против нас. Исполнитель показывается,
// только если операция раскрыта (detected); иначе виден лишь факт ущерба.
function ecSpyAlertRow(a) {
  const d = EC_SPY_OPS[a.op] || { icon: '⚠', label: a.op };
  const r = a.result || {};
  const ok = a.outcome === 'success';
  let detail = '';
  if (a.op === 'steal_gc') detail = ok ? `похищено <b style="color:var(--err)">${ecNum(r.gc)} ГС</b> из казны` : 'попытка кражи казны';
  else if (a.op === 'sabotage') detail = ok ? `выведено из строя: ${esc(r.building || 'здание')}` : 'попытка саботажа';
  else if (a.op === 'steal_tech') detail = ok ? `похищена технология: ${esc(r.tech_name || r.tech || '—')}` : 'попытка кражи технологий';
  else if (a.op === 'destabilize') detail = ok ? `дестабилизация: доход −${Math.round((r.debuff_pct || 0) * 100)}% (${r.turns || 0} ход.)` : 'попытка дестабилизации';
  else if (a.op === 'recon_basic' || a.op === 'recon_deep') detail = 'разведка вашей фракции';
  else detail = ok ? 'операция удалась' : 'операция сорвана';
  // исполнитель: раскрыт → имя; не раскрыт → аноним
  const actor = a.detected
    ? `<b style="color:var(--color-warning,#e0a030)">${esc(a.actor_name || 'раскрытая фракция')}</b>`
    : `<b style="color:var(--t3)">неизвестно</b> <span class="ec-hint">(не раскрыт)</span>`;
  const badge = a.detected
    ? '<span class="ec-route-badge new">⚠ раскрыто</span>'
    : '<span class="ec-route-badge wait">⚠ аноним</span>';
  const caught = (a.detected && r.caught) ? ' · <span style="color:var(--ok)">агент пойман</span>' : '';
  // мини-игра расследования: незаметную враждебную операцию можно вскрыть по уликам
  const hostile = ['steal_gc', 'sabotage', 'destabilize', 'steal_tech'].includes(a.op);
  let investHtml = '';
  if (!a.detected && hostile && ok) {
    const ev = Math.max(0, Math.min(100, a.evidence || 0));
    investHtml = `<div style="margin-top:6px;display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;height:7px;border-radius:4px;background:var(--bd,#2a3550);overflow:hidden"><div style="height:100%;width:${ev}%;background:var(--gd)"></div></div>
        <span class="ec-hint">улики ${ev}%</span>
        <button class="btn btn-gh btn-xs" onclick="ecSpyInvestigate('${esc(a.id)}')">🔎 Расследовать · 150 ГС</button>
      </div>
      ${a.hint ? `<div class="ec-hint" style="color:var(--te)">🧩 ${esc(a.hint)}</div>` : ''}</div>`;
  }
  return `<div class="ec-q-row ec-route-row" style="flex-direction:column;align-items:stretch"><span class="ec-r-name">${badge}${d.icon} <b>${esc(d.label)}</b> · ${detail} · от: ${actor}${caught}</span>${investHtml}</div>`;
}
function ecSpyInvestigate(id) { ecRpcAct('spy_investigate', { p_mission_id: id }, 'Расследование продвинулось'); }
// Строка журнала (завершённая операция)
function ecSpyLogRow(m) {
  const d = EC_SPY_OPS[m.op] || { icon: '•', label: m.op };
  const r = m.result || {};
  const ok = m.outcome === 'success';
  let detail = '';
  if (m.op === 'recon_basic' || m.op === 'recon_deep') detail = ok ? `ГС ${ecNum(r.gc)} · ОН ${ecNum(r.science)} · агентов ${ecNum(r.agents)} · колоний ${r.colonies ?? '—'} · построек ${r.buildings ?? '—'}` : 'разведка сорвана';
  else if (m.op === 'steal_gc') detail = ok ? `украдено ${ecNum(r.gc)} ГС` : 'провал';
  else if (m.op === 'sabotage') detail = ok ? `выведено из строя: ${esc(r.building || 'здание')}${r.colony ? ` (${esc(r.colony)})` : ''}` : 'провал';
  else if (m.op === 'steal_tech') detail = ok ? `украдена технология: ${esc(r.tech_name || r.tech || '—')}` : 'провал';
  else if (m.op === 'destabilize') detail = ok ? `доход цели снижен на ${Math.round((r.debuff_pct || 0) * 100)}% (${r.turns || 0} ход.)` : 'провал';
  const badge = ok ? '<span class="ec-route-badge ok">✓</span>' : '<span class="ec-route-badge" style="color:var(--err);border-color:var(--err)">✕</span>';
  return `<div class="ec-q-row ec-route-row"><span class="ec-r-name">${badge}${d.icon} <b>${esc(d.label)}</b> → ${esc(m.target_name || ecFacName(m.target_fid))} · ${detail}${m.detected ? ' · <span style="color:var(--color-warning,#e0a030)">раскрыто</span>' : ''}</span></div>`;
}

// ── Каталог исследований (из данных конструкторов) ──────────
// Ветки дерева исследований (метка + иконка). Военные — из данных конструктора,
// политика — ручное дерево с пассивными бонусами (ниже EC_POLITICS).
const EC_RES_CATS = [
  ['ship', 'Флот', '🚀'],
  ['ground', 'Наземные войска', '⚙'],
  ['aviation', 'Авиация', '✈'],
  ['politics', 'Политика', '🏛'],
];
// ── ПОЛИТИКА: пассивные бонусы на экономику/производство/экспансию ──
// Политические доктрины фракции. bonus — модификаторы (зеркало в SQL _faction_mods!).
// special:'claim2' — спец-механика захвата двух систем за цикл.
const EC_POLITICS = [
  // Экономика
  { id: 'pol.new_deal',     branch: 'econ',   name: 'Торговые концессии',        cost: 30, prereq: [],                  bonus: { gc: 0.10 },
    desc: 'Открытие рынков и налоговые льготы для межзвёздных корпораций — приток капитала в казну. +10% дохода.' },
  { id: 'pol.mercantile',   branch: 'econ',   name: 'Торговая монополия',        cost: 50, prereq: ['pol.new_deal'],    bonus: { gc: 0.10, build: -0.05 },
    desc: 'Государственный контроль над межсистемными торговыми маршрутами. +10% дохода, −5% к цене построек.' },
  // Производство
  { id: 'pol.five_year',    branch: 'prod',   name: 'Директивная экономика',     cost: 35, prereq: [],                  bonus: { build: -0.15 },
    desc: 'Централизованное планирование производства: верфи и заводы работают по единому государственному плану. −15% к цене построек.' },
  { id: 'pol.goelro',       branch: 'prod',   name: 'Энергетическая сеть',       cost: 55, prereq: ['pol.five_year'],   bonus: { mine: 0.15 },
    desc: 'Единая энергосеть фракции: реакторные узлы повышают КПД добывающих комплексов. +15% добычи.' },
  // Экспансия → капстоун «Дом в небесах»
  { id: 'pol.land_reform',  branch: 'expand', name: 'Колонизационный кодекс',    cost: 30, prereq: [],                  bonus: { colonize: -0.15 },
    desc: 'Стандартизация прав поселенцев и льготная логистика для первых волн освоения. −15% к цене колоний.' },
  { id: 'pol.total_mob',    branch: 'expand', name: 'Экспансионный мандат',      cost: 55, prereq: ['pol.land_reform'], bonus: { claim_cost: -0.20 },
    desc: 'Доктрина приоритетной экспансии: флот и дипломатия брошены на расширение границ. −20% к цене захвата систем.' },
  { id: 'pol.house_heavens', branch: 'expand', name: 'Дом в небесах',            cost: 90, prereq: ['pol.total_mob'],   special: 'claim2',
    desc: 'Имперский колониальный проект: служба освоения позволяет захватить ДВЕ системы за один цикл, прежде чем уйти на кулдаун.' },
  // Небожители — освоение НЕПРИГОДНЫХ миров через малые станции (3–5 ячеек застройки).
  // station.groups — какие группы планет открывает; station.cells — размер станции.
  { id: 'pol.cel_asteroid', branch: 'celestial', name: 'Астероидные станции',     cost: 20,  prereq: [],
    special: 'station', station: { groups: ['belt'], cells: 3, label: 'Астероидная станция', icon: '🪨' },
    desc: 'Небожители учатся крепить обитаемые модули прямо к астероидам и телам пояса. Открывает постройку малой станции (3 ячейки застройки) на поясах и астероидах, где обычная колония невозможна.' },
  { id: 'pol.cel_giants',   branch: 'celestial', name: 'Орбитальные станции',     cost: 40, prereq: ['pol.cel_asteroid'],
    special: 'station', station: { groups: ['gasgiant', 'icegiant', 'hotgiant'], cells: 4, label: 'Орбитальная станция', icon: '🛰' },
    desc: 'Подвесные орбитальные платформы над газовыми, ледяными и горячими гигантами — забор газов и тяжёлая промышленность на орбите. Открывает станцию на 4 ячейки над гигантами всех типов.' },
  { id: 'pol.cel_anomaly',  branch: 'celestial', name: 'Аномальные станции',      cost: 60, prereq: ['pol.cel_giants'],
    special: 'station', station: { groups: ['anomaly'], cells: 5, label: 'Аномальная станция', icon: '🌀' },
    desc: 'Технология стабилизации конструкций внутри пространственных аномалий. Открывает крупнейшую станцию Небожителей — 5 ячеек застройки прямо в аномалии.' },
];
// id → bonus (для ecFactionMods). Спец-механики (special) применяются отдельно.
const EC_RESEARCH_BONUS = {};
EC_POLITICS.forEach(n => { if (n.bonus) EC_RESEARCH_BONUS[n.id] = n.bonus; });
// Привязка оружия/компонентов к классу-тиру (тематичные prereq → ветвление дерева).
// Значение = ключ класса (k из CN_*.data). Базовый класс/отсутствие → узел-корень ветки.
const EC_TECH_TREE = {
  ship: {
    weapon: { 'Тяжёлые': 'cruiser', 'Сверхтяжёлые': 'battleship', 'Ракетное': 'destroyer', 'Зенитное': 'frigate' },
    comp:   { engine: 'frigate', reactor: 'destroyer', armor: 'destroyer', shield: 'cruiser' },
  },
  ground: {
    weapon: { 'Артиллерия и ПВО': 'artillery' },
    comp:   { engine: 'medium', armor: 'heavy', shield: 'heavy' },
  },
  aviation: {
    weapon: { 'Ракетное и бомбовое': 'medium', 'Спецоборудование': 'heavy' },
    comp:   { engine: 'medium', reactor: 'medium', armor: 'heavy', shield: 'heavy' },
  },
};
// Дерево исследований: узлы того же id-формата (cls./wpn./comp.) — id-контракт с
// конструкторами сохранён. Добавлены branch/prereq/desc для древовидной раскладки.
function ecBuildResearch() {
  if (EC._research) return EC._research;
  const out = [];
  const base = (typeof CN_BASE !== 'undefined') ? CN_BASE : { classes: {}, weapons: {} };
  const DB = { ship: (typeof CN_SHIP !== 'undefined' ? CN_SHIP : null), ground: (typeof CN_GROUND !== 'undefined' ? CN_GROUND : null), aviation: (typeof CN_AIR !== 'undefined' ? CN_AIR : null) };
  EC_RES_CATS.forEach(([cat, catLabel]) => {
    const db = DB[cat]; if (!db) return;
    const hasReactor = !!db.reactors;
    const tree = EC_TECH_TREE[cat] || { weapon: {}, comp: {} };
    const baseCls = base.classes[cat] || [];
    // class prereq → массив id (база/отсутствие = корень ветки)
    const clsId = k => (k && !baseCls.includes(k) && db.data[k]) ? ['cls.' + cat + '.' + k] : [];

    // ── Класс-хребет (линейная цепочка по тирам) ──
    let prev = null, ci = 0;
    Object.keys(db.data).forEach(k => {
      if (baseCls.includes(k)) return;
      const id = 'cls.' + cat + '.' + k;
      out.push({ id, cat, catLabel, branch: 'class', name: db.data[k].name,
        desc: 'Открывает класс в конструкторе и ветку технологий', cost: 5 * Math.pow(2, ci), prereq: prev ? [prev] : [] });
      prev = id; ci++;
    });

    // ── Оружие (ветви, привязаны к классу-тиру) ──
    const baseW = base.weapons[cat] || [];
    let wi = 0;
    Object.keys(db.weapons || {}).forEach(g => {
      if (baseW.includes(g)) return;
      out.push({ id: 'wpn.' + cat + '.' + g, cat, catLabel, branch: 'weapon', name: g,
        desc: 'Разблокирует орудия «' + g + '» в конструкторе', cost: 12 + wi * 8, prereq: clsId(tree.weapon && tree.weapon[g]) });
      wi++;
    });

    // ── Компоненты (ветви) ──
    const COMP_DESC = { armor: 'Модули усиленной брони — повышают выживаемость в бою', shield: 'Щиты нового поколения: выше регенерация и ёмкость', engine: 'Продвинутые двигатели: скорость, тяга и манёвренность', reactor: 'Реакторы высокой мощности — энергия для тяжёлых систем' };
    const comps = [['armor', 14], ['shield', 16], ['engine', 10]];
    if (hasReactor) comps.unshift(['reactor', 16]);
    const COMP_NAMES = { armor: 'Продвинутая броня', shield: 'Продвинутые щиты', engine: 'Продвинутые двигатели', reactor: 'Продвинутые реакторы' };
    comps.forEach(([t, cost]) => {
      out.push({ id: 'comp.' + cat + '.' + t, cat, catLabel, branch: t, name: COMP_NAMES[t],
        desc: COMP_DESC[t], cost, prereq: clsId(tree.comp && tree.comp[t]) });
    });

    // ── Продвинутые типы корпусов (2-й/3-й вариант класса) ──
    Object.keys(db.data).forEach(k => {
      const types = db.data[k].types;
      if (!types || types.length < 2) return;
      // база-класс → корень ветки; иначе требует свой класс
      const pre = baseCls.includes(k) ? [] : ['cls.' + cat + '.' + k];
      out.push({ id: 'type.' + cat + '.' + k, cat, catLabel, branch: 'type', name: 'Спец-корпуса: ' + db.data[k].name,
        desc: 'Спецкорпуса: уникальные роли и нестандартные компоновки', cost: 10, prereq: pre });
    });

    // ── Модули и системы (отдельная ветка-цепочка) ──
    let prevMod = null, mi = 0;
    Object.keys(db.modules || {}).forEach(g => {
      const id = 'mod.' + cat + '.' + g;
      out.push({ id, cat, catLabel, branch: 'module', name: g,
        desc: 'Системы «' + g + '» — доступны в конструкторе', cost: 8 + mi * 5, prereq: prevMod ? [prevMod] : [] });
      prevMod = id; mi++;
    });

    // ── Ангары и авиакрылья (только флот) ──
    if (cat === 'ship') {
      out.push({ id: 'hangar.ship', cat, catLabel, branch: 'hangar', name: 'Ангарные палубы',
        desc: 'Ангары для базирования авиакрыльев и малых судов на борту кораблей', cost: 22, prereq: clsId('destroyer') });
      out.push({ id: 'hangar.ship.heavy', cat, catLabel, branch: 'hangar', name: 'Тяжёлые ангары',
        desc: 'Крупные боевые ангары — вмещают тяжёлые и штурмовые авиакрылья', cost: 40, prereq: ['hangar.ship'] });
    }
  });
  // ── Политика: ручное дерево бонусов ──
  EC_POLITICS.forEach(n => out.push({
    id: n.id, cat: 'politics', catLabel: 'Политика', branch: n.branch,
    name: n.name, desc: n.desc, cost: n.cost, prereq: n.prereq || [],
    bonus: n.bonus || null, special: n.special || null, station: n.station || null,
  }));
  EC._research = out;
  return out;
}
function ecSetResearchCat(c) { EC.researchCat = c; ecPaintCabinet(); }
// Глубина узла = длиннейшая цепочка prereq (роль тира). Мемоизация.
function ecTechDepth(n, byId, cache) {
  if (cache[n.id] != null) return cache[n.id];
  cache[n.id] = 0;
  let d = 0;
  (n.prereq || []).forEach(p => { const pn = byId.get(p); if (pn) d = Math.max(d, ecTechDepth(pn, byId, cache) + 1); });
  cache[n.id] = d; return d;
}
function ecTabResearch() {
  const all = ecBuildResearch();
  const done = new Set(EC.eco.research || []);
  // Роботы ведут 2 исследования параллельно (слоты research_active / research_active2).
  const maxSlots = ecIsRobot() ? 2 : 1;
  const activeSlots = [
    [EC.eco.research_active, EC.eco.research_ready],
    [EC.eco.research_active2, EC.eco.research_ready2],
  ].filter(([a]) => a);
  const activeSet = new Set(activeSlots.map(([a]) => a));
  const slotsFull = activeSlots.length >= maxSlots;
  const sci = EC.eco.science || 0;
  const sciInc = ecIncomePreview().science;
  const sel = EC.researchCat || 'ship';

  const activeHtml = activeSlots.map(([a, ready]) => {
    const node = all.find(n => n.id === a);
    return `<div class="ec-cap ec-cap-prog">⏳ Изучается: <b>${esc(node ? node.name : a)}</b> ${ecProgressISO(null, ready, 1, 'готово на след. ходу')}</div>`;
  }).join('');

  // под-вкладки родов войск
  const subTabs = EC_RES_CATS.map(([c, l, ic]) => {
    const cnt = all.filter(n => n.cat === c);
    const dn = cnt.filter(n => done.has(n.id)).length;
    return `<button class="ec-rcat${sel === c ? ' on' : ''}" onclick="ecSetResearchCat('${c}')">${ic} ${esc(l)} <span class="ec-rcat-cnt">${dn}/${cnt.length}</span></button>`;
  }).join('');

  // ── Раскладка дерева выбранного рода ──
  const nodes = all.filter(n => n.cat === sel);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const cache = {};
  nodes.forEach(n => { n._d = ecTechDepth(n, byId, cache); });
  const maxDepth = Math.max(0, ...nodes.map(n => n._d));

  const isPol = sel === 'politics';
  const W = 200, H = isPol ? 150 : 128, GX = 60, GY = 12, LANE_GAP = 30;

  // ── Полосная раскладка: каждая ветка — отдельная горизонтальная полоса ──
  const LANE_ORDER = isPol
    ? ['econ', 'prod', 'expand', 'celestial']
    : ['class', 'type', 'weapon', 'reactor', 'engine', 'armor', 'shield', 'hangar', 'module'];
  const pos = {};
  let laneY = 0;
  const laneHeaders = []; // { y, label, branch }
  LANE_ORDER.forEach(branch => {
    const lnodes = nodes.filter(n => n.branch === branch);
    if (!lnodes.length) return;
    // сгруппировать по глубине
    const byDepth = {};
    lnodes.forEach(n => { (byDepth[n._d] = byDepth[n._d] || []).push(n); });
    const maxInLane = Math.max(...Object.values(byDepth).map(a => a.length));
    laneHeaders.push({ y: laneY, label: ecBranchTag(branch), branch });
    Object.entries(byDepth).forEach(([d, ns]) => {
      ns.forEach((n, i) => { pos[n.id] = { x: parseInt(d) * (W + GX), y: laneY + i * (H + GY) }; });
    });
    laneY += maxInLane * H + (maxInLane - 1) * GY + LANE_GAP;
  });
  // любые узлы вне LANE_ORDER — добавить в конец
  const extra = nodes.filter(n => !LANE_ORDER.includes(n.branch) && !pos[n.id]);
  extra.forEach((n, i) => { pos[n.id] = { x: n._d * (W + GX), y: laneY + i * (H + GY) }; });
  if (extra.length) laneY += extra.length * (H + GY);

  const cw = (maxDepth + 1) * (W + GX) - GX + 2;
  const ch = Math.max(H, laneY - LANE_GAP);

  // SVG-связи prereq → node + фоновые полосы
  const edges = [];
  // фоновые полосы для каждой ветки
  const laneBands = laneHeaders.map(lh => {
    const lnodes2 = nodes.filter(n => n.branch === lh.branch);
    const byD2 = {};
    lnodes2.forEach(n => { (byD2[n._d] = byD2[n._d] || []).push(n); });
    const maxR = Math.max(...Object.values(byD2).map(a => a.length));
    const bh = maxR * H + (maxR - 1) * GY;
    return `<rect x="0" y="${lh.y - 6}" width="${cw}" height="${bh + 12}" class="ec-lane-band ec-lane-${lh.branch}" rx="6"/>`;
  }).join('');
  nodes.forEach(n => (n.prereq || []).forEach(pid => {
    const a = pos[pid], b = pos[n.id]; if (!a || !b) return;
    const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
    const mx = (x1 + x2) / 2;
    const bright = done.has(pid);
    edges.push(`<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" class="ec-tedge${bright ? ' lit' : ''}"/>`);
  }));
  const svg = `<svg class="ec-tree-svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}">${laneBands}${edges.join('')}</svg>`;

  // состояние + внутреннее содержимое узла (общее для холста и мобильного списка)
  const nodeState = n => {
    const isDone = done.has(n.id), isActive = activeSet.has(n.id), prereqOk = (n.prereq || []).every(p => done.has(p));
    let state = 'locked', foot = '';
    if (isDone) { state = 'done'; foot = '<span class="ec-tnode-badge ok">✓ изучено</span>'; }
    else if (isActive) { state = 'active'; foot = '<span class="ec-tnode-badge cur">⏳ изучается</span>'; }
    else if (!prereqOk) { state = 'locked'; const need = (n.prereq || []).map(p => (byId.get(p) || {}).name || p).join(', '); foot = `<span class="ec-tnode-badge lock" title="${esc(need)}">🔒 ${esc(need)}</span>`; }
    else { state = 'avail'; const rc = ecResearchCost(n.cost); const can = !slotsFull && sci >= rc; foot = `<button class="btn ${can ? 'btn-gd' : 'btn-gh'} btn-xs" ${can ? '' : 'disabled'} onclick="event.stopPropagation();ecResearch('${n.id}')">${ecNum(rc)} ОН</button>`; }
    const bonus = (n.bonus || n.special) ? ecBonusChips(n.bonus, n.special, n.station) : '';
    const descHtml = n.desc ? `<div class="ec-tnode-desc">${esc(n.desc)}</div>` : '';
    const inner = `<div class="ec-tnode-h"><span class="ec-tnode-tag">${esc(ecBranchTag(n.branch))}</span></div>
      <div class="ec-tnode-name">${esc(n.name)}</div>
      ${descHtml}${bonus}
      <div class="ec-tnode-foot">${foot}</div>`;
    return { state, inner };
  };
  // холст (десктоп): абсолютные карточки
  const nodeCard = n => {
    const { state, inner } = nodeState(n); const p = pos[n.id];
    return `<div class="ec-tnode ec-tnode-${state} ec-br-${n.branch} ec-tnode-clk" style="left:${p.x}px;top:${p.y}px;width:${W}px;height:${H}px" onclick="ecResNodeInfo('${n.id}')" title="Подробнее">${inner}</div>`;
  };
  const cards = nodes.map(nodeCard).join('');
  const tree = `<div class="ec-tree-scroll"><div class="ec-tree" style="width:${cw}px;height:${ch}px">${svg}${cards}</div></div>`;

  // мобильный список: узлы сгруппированы по веткам, отсортированы по тиру (prereq → выше)
  const mobileLanes = LANE_ORDER.concat([...new Set(extra.map(n => n.branch))].filter(b => !LANE_ORDER.includes(b)));
  const treeMobile = `<div class="ec-tree-mobile">${mobileLanes.map(branch => {
    const ln = nodes.filter(n => n.branch === branch).sort((a, b) => (a._d || 0) - (b._d || 0));
    if (!ln.length) return '';
    const cardsM = ln.map(n => { const { state, inner } = nodeState(n); return `<div class="ec-tnode ec-tnode-m ec-tnode-${state} ec-br-${n.branch} ec-tnode-clk" onclick="ecResNodeInfo('${n.id}')">${inner}</div>`; }).join('');
    return `<div class="ec-tm-lane"><div class="ec-tm-lane-h">${esc(ecBranchTag(branch))}</div><div class="ec-tm-cards">${cardsM}</div></div>`;
  }).join('')}</div>`;

  const slotsBullet = maxSlots > 1
    ? 'Ваш машинный разум ведёт <b>2 исследования</b> параллельно, 1 ход на каждое.'
    : 'Одновременно изучается <b>одна</b> технология, 1 ход на исследование.';
  const slotsHint = maxSlots > 1 ? `${activeSlots.length}/${maxSlots} слота — 2 проекта параллельно` : '1 проект за раз; ведите ветку слева направо';
  return `${ecIntro('🔬', 'Исследования', 'Тратьте очки науки (ОН) на технологии — они открывают классы, оружие и компоненты в конструкторах.', ['ОН копятся от <b>Научных институтов</b> + бонусов доктрины. Стройте их во вкладке «Колонии».', slotsBullet, 'Тяжёлое оружие и продвинутые компоненты требуют сначала изучить класс-носитель.'])}<div class="ec-treasury" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
      <div class="ec-res"><span class="ec-res-k">Очки науки</span><span class="ec-res-v" style="color:var(--pu)">${ecNum(sci)} ОН</span></div>
      <div class="ec-res"><span class="ec-res-k">Доход</span><span class="ec-res-v" style="font-size:15px">+${sciInc} ОН/ход</span></div>
    </div>
    ${activeHtml}
    <div class="ec-rcat-tabs">${subTabs}</div>
    <div class="ec-section-title">Дерево исследований <span class="ec-hint">— ${slotsHint}</span></div>
    ${tree}${treeMobile}`;
}
function ecBranchTag(branch) {
  return { class: 'КЛАСС', type: 'КОРПУС', weapon: 'ОРУЖИЕ', armor: 'БРОНЯ', shield: 'ЩИТЫ', engine: 'ДВИГАТЕЛЬ', reactor: 'РЕАКТОР', hangar: 'АНГАР', module: 'СИСТЕМА', econ: 'ЭКОНОМИКА', prod: 'ПРОИЗВОДСТВО', expand: 'ЭКСПАНСИЯ', celestial: 'НЕБОЖИТЕЛИ' }[branch] || branch;
}
// Чипы бонуса политического узла (для карточки дерева).
function ecBonusChips(b, special, station) {
  const out = [];
  const pct = (k, lbl, goodHigh) => { if (!b || b[k] == null) return; const p = Math.round(b[k] * 100); const good = goodHigh ? p > 0 : p < 0; out.push(`<span class="ec-bchip ${good ? 'good' : 'bad'}">${lbl} ${p > 0 ? '+' : ''}${p}%</span>`); };
  pct('gc', 'Доход', true); pct('mine', 'Добыча', true);
  pct('build', 'Постройки', false); pct('colonize', 'Колонии', false); pct('claim_cost', 'Захват', false); pct('claim_cd', 'Кулдаун', false); pct('research', 'Наука', false);
  if (b && b.sci_flat) out.push(`<span class="ec-bchip good">Наука +${b.sci_flat}/ход</span>`);
  if (b && b.agents_flat) out.push(`<span class="ec-bchip good">Агенты +${b.agents_flat}/ход</span>`);
  if (special === 'claim2') out.push('<span class="ec-bchip special">★ +1 захват до перезарядки</span>');
  if (special === 'station' && station) out.push(`<span class="ec-bchip special">${station.icon || '★'} ${station.cells} ячеек</span>`);
  return out.length ? `<div class="ec-tnode-bonus">${out.join('')}</div>` : '';
}
function ecResearch(nodeId) {
  const n = ecBuildResearch().find(x => x.id === nodeId); if (!n) { toast('Узел не найден', 'err'); return; }
  const done = new Set(EC.eco.research || []);
  const maxSlots = ecIsRobot() ? 2 : 1;
  const activeIds = [EC.eco.research_active, EC.eco.research_active2].filter(Boolean);
  if (activeIds.includes(nodeId)) { toast('Уже изучается', 'inf'); return; }
  if (activeIds.length >= maxSlots) { toast(maxSlots > 1 ? 'Оба слота исследований заняты' : 'Уже идёт исследование', 'err'); return; }
  if (done.has(nodeId)) { toast('Уже изучено', 'inf'); return; }
  if (!(n.prereq || []).every(p => done.has(p))) { toast('Сначала изучите предшественников', 'err'); return; }
  const rc = ecResearchCost(n.cost);
  if ((EC.eco.science || 0) < rc) { toast(`Недостаточно ОН: нужно ${ecNum(rc)}`, 'err'); return; }
  ecRpcAct('economy_research', { p_node: nodeId, p_cost: rc }, 'Исследование начато (1 ход)');
}

// Карточка-описание узла дерева (по клику) — полный текст не влезает в плитку.
function ecResNodeInfo(id) {
  const all = ecBuildResearch();
  const n = all.find(x => x.id === id); if (!n) return;
  const byId = new Map(all.map(x => [x.id, x]));
  const done = new Set(EC.eco.research || []);
  const activeIds = [EC.eco.research_active, EC.eco.research_active2].filter(Boolean);
  const isDone = done.has(n.id), isActive = activeIds.includes(n.id);
  const prereqOk = (n.prereq || []).every(p => done.has(p));
  const maxSlots = ecIsRobot() ? 2 : 1;
  const slotsFull = activeIds.length >= maxSlots;
  const rc = ecResearchCost(n.cost), sci = EC.eco.science || 0;
  const can = !isDone && !isActive && prereqOk && !slotsFull && sci >= rc;

  const status = isDone ? '<span class="ec-tnode-badge ok">✓ изучено</span>'
    : isActive ? '<span class="ec-tnode-badge cur">⏳ изучается</span>'
    : !prereqOk ? '<span class="ec-tnode-badge lock">🔒 заблокировано</span>' : '';
  const prereqTxt = (n.prereq || []).length
    ? (n.prereq).map(p => `${done.has(p) ? '✓' : '🔒'} ${esc((byId.get(p) || {}).name || p)}`).join(' · ')
    : '<span style="color:var(--t4)">нет требований</span>';
  let stationHtml = '';
  if (n.special === 'station' && n.station) {
    const groups = n.station.groups.map(g => EC_GRP_LABEL[g] || g).join(', ');
    stationHtml = `<div class="ec-rinfo-station">${n.station.icon} <b>Станция</b> — открывает постройку на мирах: <b>${esc(groups)}</b> · размер <b>${n.station.cells} ячеек</b> · постройка <b>${ecNum(ecColonizeCost(EC_STATION_COST))} ГС</b></div>`;
  }
  const bonus = (n.bonus || n.special) ? ecBonusChips(n.bonus, n.special, n.station) : '';
  let actHint = '';
  if (isDone) actHint = '';
  else if (isActive) actHint = '<span class="ec-rinfo-note">Уже изучается — завершится в конце хода.</span>';
  else if (!prereqOk) actHint = '<span class="ec-rinfo-note">Сначала изучите предшественников.</span>';
  else if (slotsFull) actHint = '<span class="ec-rinfo-note">Все слоты исследований заняты.</span>';
  else if (sci < rc) actHint = `<span class="ec-rinfo-note">Не хватает ОН: нужно ${ecNum(rc)}, есть ${ecNum(sci)}.</span>`;
  const actBtn = (!isDone && !isActive && prereqOk)
    ? `<button class="btn ${can ? 'btn-gd' : 'btn-gh'}" ${can ? '' : 'disabled'} onclick="ecResNodeInfoClose();ecResearch('${esc(n.id)}')">🔬 Исследовать · ${ecNum(rc)} ОН</button>`
    : '';

  let ov = document.getElementById('ec-rinfo-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'ec-rinfo-ov'; ov.className = 'ec-rinfo-ov'; ov.onclick = e => { if (e.target === ov) ecResNodeInfoClose(); }; document.body.appendChild(ov); }
  ov.innerHTML = `<div class="ec-rinfo ec-br-${esc(n.branch)}">
    <button class="ec-rinfo-x" onclick="ecResNodeInfoClose()">✕</button>
    <div class="ec-rinfo-tag">${esc(ecBranchTag(n.branch))}${n.catLabel ? ' · ' + esc(n.catLabel) : ''}</div>
    <div class="ec-rinfo-name">${esc(n.name)} ${status}</div>
    ${n.desc ? `<div class="ec-rinfo-desc">${esc(n.desc)}</div>` : ''}
    ${stationHtml}
    ${bonus}
    <div class="ec-rinfo-meta"><span>Стоимость: <b style="color:var(--pu)">${ecNum(rc)} ОН</b></span><span>Требует: ${prereqTxt}</span></div>
    ${actHint}
    ${actBtn ? `<div class="ec-rinfo-act">${actBtn}</div>` : ''}
  </div>`;
  ov.classList.add('show');
}
function ecResNodeInfoClose() { document.getElementById('ec-rinfo-ov')?.classList.remove('show'); }

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

// ── Обмен (бартер) ──────────────────────────────────────────
// Список своих кораблей роста: [{name, qty}] по моделям (только готовые).
function ecMyShipList() {
  const m = {};
  (EC.roster || []).filter(r => r.category === 'ship').forEach(r => { m[r.unit_name] = (m[r.unit_name] || 0) + (r.qty || 0); });
  return Object.entries(m).filter(([, q]) => q > 0).map(([name, qty]) => ({ name, qty }));
}
// Человекочитаемая сводка набора активов.
function ecBarterSummary(a) {
  if (!a) return '—';
  const p = [];
  if (+a.gc) p.push(`${ecNum(a.gc)} ГС`);
  if (+a.science) p.push(`${ecNum(a.science)} ОН`);
  if (a.resources) for (const [k, v] of Object.entries(a.resources)) { if (+v) p.push(`${ecNum(v)} ${k}`); }
  if (a.ships) for (const [k, v] of Object.entries(a.ships)) { if (+v) p.push(`${ecNum(v)}× ${k}`); }
  return p.length ? p.join(', ') : '—';
}
// Собрать jsonb-набор активов из состояния EC.bt[side].
function ecBarterAssets(side) {
  const a = {};
  ((EC.bt && EC.bt[side]) || []).forEach(it => {
    if (it.kind === 'gc') a.gc = (a.gc || 0) + it.qty;
    else if (it.kind === 'science') a.science = (a.science || 0) + it.qty;
    else if (it.kind === 'resource') { a.resources = a.resources || {}; a.resources[it.name] = (a.resources[it.name] || 0) + it.qty; }
    else if (it.kind === 'ship') { a.ships = a.ships || {}; a.ships[it.name] = (a.ships[it.name] || 0) + it.qty; }
  });
  return a;
}
function ecBarterHasAny(a) { return !!(a.gc || a.science || a.resources || a.ships); }
function ecBarterPropose() {
  const fac = ecId('ec-bt-fac')?.value;
  if (!fac) { toast('Выберите фракцию', 'err'); return; }
  const give = ecBarterAssets('give'), want = ecBarterAssets('want');
  if (!ecBarterHasAny(give)) { toast('Добавьте, что отдаёте', 'err'); return; }
  const isGift = !ecBarterHasAny(want);
  EC.bt = { give: [], want: [] };   // очистим конструктор после отправки
  ecRpcAct('barter_propose', { p_to_fid: fac, p_give: give, p_want: want }, isGift ? 'Передано (подарок)' : 'Предложение обмена отправлено');
}
function ecBarterAccept(id) { ecRpcAct('barter_accept', { p_id: id }, 'Обмен совершён'); }
function ecBarterReject(id) { ecRpcAct('barter_reject', { p_id: id }, 'Предложение отклонено'); }
function ecBarterCancel(id) { ecRpcAct('barter_cancel', { p_id: id }, 'Предложение отозвано'); }
function ecTradePropose() {
  const c = ecTradeCalc();
  if (!c) { toast('Форма недоступна', 'err'); return; }
  if (c.err) { toast(c.err, 'err'); return; }
  // Отсутствие гиперпути НЕ блокирует: караван идёт напрямую, просто без данных об угрозах.
  const riskTxt = c.threats.length ? `риск ${c.riskPct}%` : 'путь безопасен';
  ecRpcAct('trade_propose_multi',
    { p_to_fid: c.dFac, p_origin_sys: c.oSys, p_dest_sys: c.dSys, p_cargo: c.cargo, p_convoy: c.convoy, p_threats: c.threats },
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
// ── Тайные операции: интерактив планировщика ────────────────
function ecPickSpyTarget(fid) { EC.spyTarget = fid; ecSpyCalcLive(); }
function ecPickSpyOp(op) {
  const c = ecSpyCalc(op, [], EC.spyTarget);
  if (c && c.err) {
    const recon = EC_SPY_OPS[c.err.includes('глубок') ? 'recon_deep' : 'recon_basic'].label;
    toast(`🔒 ${c.err}. Сначала запустите операцию «${recon}» по этой цели.`, 'err');
    return;
  }
  EC.spyOp = op;
  document.querySelectorAll('.ec-spy-op').forEach(b => b.classList.toggle('on', b.getAttribute('onclick').includes(`'${op}'`)));
  ecSpyCalcLive();
}
// Чипы выбора агентов под операцию (только свободные обученные)
function ecSpyAgentPickHtml() {
  const ready = ecSpyReadyAgents();
  EC.spyPick = (EC.spyPick || []).filter(id => ready.some(a => a.id === id));   // выкинуть ставших недоступными
  if (!ready.length) return '<div class="ec-empty" style="padding:6px">Нет свободных обученных агентов — наймите новых, дождитесь обучения или снимите часть с контрразведки.</div>';
  return ready.map(a => {
    const pk = ecPerk(a.perk); const on = EC.spyPick.includes(a.id);
    return `<button type="button" onclick="ecSpyTogglePick('${esc(a.id)}')" style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;cursor:pointer;border:1px solid ${on ? 'var(--gd)' : 'var(--bd,#2a3550)'};background:${on ? 'rgba(120,200,140,.10)' : 'transparent'};color:inherit;font:inherit">
      <span style="font-weight:700;color:${on ? 'var(--gd)' : 'var(--t4)'}">${on ? '✓' : '+'}</span>${pk.icon} <b>${esc(a.first_name)} ${esc(a.last_name)}</b> <i style="color:var(--t4);font-style:normal" title="${esc(pk.desc)}">${esc(pk.label)}</i></button>`;
  }).join('');
}
function ecSpyTogglePick(id) {
  EC.spyPick = EC.spyPick || [];
  const i = EC.spyPick.indexOf(id);
  if (i >= 0) EC.spyPick.splice(i, 1);
  else {
    const cap = Math.max(0, ecSpyReadyAgents().length - (EC.eco.counter_agents || 0));   // ready − контрразведка
    if (EC.spyPick.length >= cap) { toast('Все свободные агенты выбраны (часть зарезервирована в контрразведке)', 'inf'); return; }
    EC.spyPick.push(id);
  }
  const el = ecId('ec-spy-agents-pick'); if (el) el.innerHTML = ecSpyAgentPickHtml();
  ecSpyCalcLive();
}
// Живая сводка операции + состояние кнопки
function ecSpyCalcLive() {
  const sumEl = ecId('ec-spy-summary'); if (!sumEl) return null;
  const op = EC.spyOp, picks = EC.spyPick || [];
  const c = ecSpyCalc(op, picks, EC.spyTarget); if (!c) return null;
  const d = EC_SPY_OPS[op];
  const noAgents = picks.length < 1;
  // колония-цель для саботажа (из глубокой разведки)
  const colEl = ecId('ec-spy-colony');
  let colErr = '';
  if (colEl) {
    if (op === 'sabotage') {
      const cols = ecSpyColonyOptions(EC.spyTarget);
      if (!cols.length) { colEl.innerHTML = '<div class="ec-trade-note warn" style="margin:6px 0">⚠ Нужна свежая глубокая разведка цели, чтобы выбрать колонию для саботажа.</div>'; colErr = 'Нет данных о колониях — проведите глубокую разведку'; }
      else {
        if (!EC.spyColony || !cols.find(x => x.id === EC.spyColony)) EC.spyColony = cols[0].id;
        colEl.innerHTML = `<div class="ec-trade-label">Колония-цель</div>
          <select id="ec-spy-colony-sel" onchange="EC.spyColony=this.value;ecSpyCalcLive()">${cols.map(x => `<option value="${esc(x.id)}"${x.id === EC.spyColony ? ' selected' : ''}>${esc(x.name)}${Array.isArray(x.buildings) ? ` · ${x.buildings.length} построек` : ''}</option>`).join('')}</select>`;
      }
    } else { colEl.innerHTML = ''; }
  }
  // госуровневая операция требует сети (≥2 агента)
  let netErr = (op === 'steal_tech' && picks.length === 1) ? 'Госуровень: нужна сеть — минимум 2 агента' : '';
  const dosTxt = c.dossier.level ? `${c.dossier.level === 'deep' ? 'глубокая' : 'базовая'} (${c.dossier.ageDays} дн., +${c.intel})` : 'нет данных';
  const sColor = c.success >= 60 ? 'var(--ok)' : c.success >= 35 ? 'var(--color-warning,#e0a030)' : 'var(--err)';
  const dColor = c.detect >= 50 ? 'var(--err)' : c.detect > 20 ? 'var(--color-warning,#e0a030)' : 'var(--ok)';
  const perkTxt = (c.succB || c.detB) ? ` · перки: ${c.succB ? `+${c.succB}% успех` : ''}${c.succB && c.detB ? ', ' : ''}${c.detB ? `−${c.detB}% раскрытие` : ''}` : '';
  const gateErr = c.err || (noAgents ? 'Выберите агентов для операции' : '') || colErr || netErr;
  sumEl.innerHTML = `
    <div class="ec-trade-deal">${d.icon} <b>${esc(d.label)}</b> → ${esc(ecFacName(EC.spyTarget))} · 🕵 ${noAgents ? '—' : picks.length} агент(ов)${esc(perkTxt)}</div>
    <div class="ec-trade-srow"><span>Описание</span><b style="color:var(--t2);font-weight:400">${esc(d.desc)}</b></div>
    <div class="ec-trade-srow big"><span>Шанс успеха</span><b style="color:${sColor}">${noAgents ? '—' : c.success + '%'}</b></div>
    <div class="ec-trade-srow"><span>Риск раскрытия</span><b style="color:${dColor}">${noAgents ? '—' : c.detect + '%'}</b></div>
    <div class="ec-trade-srow"><span>Длительность</span><b>${noAgents ? '—' : c.turns + ' ход.'}</b></div>
    <div class="ec-trade-srow"><span>Разведданные цели</span><b>${dosTxt}</b></div>
    ${gateErr ? `<div class="ec-trade-note warn">⚠ ${esc(gateErr)}</div>` : `<div class="ec-trade-note">При раскрытии: назначенный агент будет схвачен (выбывает), цель узнает о вас. Расчёт ориентировочный — контрразведка цели уточнится при исполнении.</div>`}`;
  const btn = ecId('ec-spy-launch');
  if (btn) { btn.disabled = !!gateErr; btn.textContent = gateErr ? gateErr : `Запустить · успех ${c.success}% · ${c.turns} ход.`; }
  c.gateErr = gateErr;
  return c;
}
function ecSpyLaunch() {
  const picks = EC.spyPick || [];
  if (!picks.length) { toast('Выберите хотя бы одного агента', 'err'); return; }
  const c = ecSpyCalcLive(); if (!c) return;
  if (c.gateErr) { toast(c.gateErr, 'err'); return; }
  const colonyId = (EC.spyOp === 'sabotage') ? (EC.spyColony || null) : null;
  ecRpcAct('spy_launch', { p_target_fid: EC.spyTarget, p_op: EC.spyOp, p_agent_ids: picks, p_colony_id: colonyId }, `Операция «${EC_SPY_OPS[EC.spyOp].label}» запущена (${c.turns} ход.)`);
}
function ecSpyCancel(id) { ecRpcAct('spy_cancel', { p_id: id }, 'Операция отозвана, агенты возвращены'); }
function ecCounterIntel(scope, n) {
  ecRpcAct('counterintel_set', { p_scope: scope, p_n: Math.max(0, n | 0) }, 'Контрразведка обновлена');
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
      ? `<span class="ec-proj-tag" title="${ecProjEtaTxt(pendSlot)}">⏳ слот строится</span><button class="ec-bld-del" title="Отменить слот (возврат ГС)" onclick="ecCancelProject('${pendSlot.id}')">✕</button>`
      : `<button class="btn btn-gh btn-xs" onclick="ecOpenSlot('${b.id}')">+ слот · ${ecNum(ecBuildCost(d.ladder[b.slots_open]))} ГС</button>`;
  const slotCount = `<span class="ec-slot-count">${b.slots_open}/${EC_MAX_SLOTS}</span>`;
  let mineHtml = '';
  if (b.btype === 'mining') {
    const allRes = ecMiningPlanetRes(b);
    const targets = Array.isArray(b.mining_targets) ? b.mining_targets : [];
    const used = targets.length;
    const free = b.slots_open - used;
    if (allRes.length) {
      const rows = allRes.map(r => {
        const cnt = targets.filter(t => t === r.name).length;
        const rate = ecMineRate(r.r || 'common', r.amt);
        const total = rate * cnt;
        const canAdd = free > 0;
        const cls = cnt ? 'active' : '';
        return `<div class="ec-mine-row ${cls}">
          <span class="ec-mine-ic ec-rar-${r.r || 'common'}">${esc(r.icon || '◈')}</span>
          <span class="ec-mine-nm">${esc(r.name)}</span>
          <span class="ec-mine-rt">${cnt ? `+${total}/сут` : `<span class="ec-mine-rt-dim">+${rate}/яч.</span>`}</span>
          <span class="ec-mine-step">
            <button class="ec-mine-btn" ${cnt ? '' : 'disabled'} title="Снять слот" onclick="ecMineCell(${ecArg(b.id)},${ecArg(r.name)},-1)">−</button>
            <span class="ec-mine-cnt ${cnt ? 'on' : ''}">${cnt}</span>
            <button class="ec-mine-btn" ${canAdd ? '' : 'disabled'} title="${canAdd ? 'Добавить слот' : 'Нет свободных слотов'}" onclick="ecMineCell(${ecArg(b.id)},${ecArg(r.name)},1)">+</button>
          </span>
        </div>`;
      }).join('');
      mineHtml = `<div class="ec-bld-mine-hd">⛏ Месторождения <span class="ec-mine-slots-used">${used}/${b.slots_open} слотов занято</span></div><div class="ec-mine-list">${rows}</div>`;
    } else {
      mineHtml = `<div class="ec-bld-mine-empty">◌ планета без ресурсов — заводу нечего добывать</div>`;
    }
    // Режим завода: копить на складе ИЛИ сразу экспортировать поток за ГС
    const mode = b.mine_mode || 'store';
    const mkModeBtn = (m, label, title) => `<button class="btn btn-xs ${mode === m ? 'btn-gd' : 'btn-gh'}" title="${title}" onclick="ecSetMineMode('${b.id}','${m}')">${label}</button>`;
    mineHtml += `<div class="ec-bld-mine-hd" style="display:flex;align-items:center;gap:6px;margin-top:8px">Поток: ${mkModeBtn('store', '📦 На склад', 'Копить ресурсы на складе (до лимита ёмкости)')} ${mkModeBtn('export', '💱 Экспорт', 'Сразу продавать поток за ГС — не копится, месторождение работает дальше')}</div>`;
  }
  return `<div class="ec-bld">
    <div class="ec-bld-top">
      <span class="ec-bld-name">${esc(d.name)}</span>
      <button class="ec-bld-del" title="Снести" onclick="ecDemolish('${b.id}')">✕</button>
    </div>
    <div class="ec-slots" title="${b.slots_open} / ${EC_MAX_SLOTS} слотов открыто">${dots}</div>
    <div class="ec-bld-inc">${esc(incTxt)}</div>
    ${(() => {
      let ht = EC_BLD_HOWTO[b.btype];
      if (ecIsRobot()) {
        if (b.btype === 'training') ht = '⚙ Роботам не нужен: пехота собирается на Военном Заводе. Можно снести.';
        else if (b.btype === 'military_factory') ht = 'Робо-сборка: пехота (×3, 3000/слот) и наземная техника. Заказ — во вкладке «Строительство вооружённых сил».';
      }
      return ht ? `<div class="ec-bld-howto">${esc(ht)}</div>` : '';
    })()}
    ${mineHtml}
    <div class="ec-bld-act">${slotCount}${openBtn}</div>
  </div>`;
}

// экранирование строки для inline-onclick (одинарные кавычки)
function ecArg(s) { return "'" + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
// pid планеты как числовой литерал для inline-onclick (или null для немигрированных данных карты)
function ecPidArg(p) { return (p && Number.isInteger(p.pid)) ? String(p.pid) : 'null'; }

// ── Денежные операции теперь СЕРВЕРНЫЕ ──────────────────────
// Списание/возврат ГС и ОН делают SECURITY DEFINER RPC (economy_build,
// economy_colonize, economy_terraform, economy_produce, ... в _security_money.sql),
// которые сами считают цену. Прямой записи баланса с клиента больше нет —
// ecSpend/ecSpendBoth удалены как небезопасные (игрок мог писать любое число).

// ── Проекты колоний (отложенные на 1+ ход) ──────────────────
// Момент готовности = сейчас + turns суток (1 реальный день от момента постройки).
const _ecReadyTurns = (turns) => new Date(Date.now() + Math.max(1, turns || 1) * 86400000).toISOString();
function ecPendingSlot(buildingId) { return (EC.projects || []).find(p => p.kind === 'slot' && p.building_id === buildingId); }
function ecPendingHabitat(colonyId) { return (EC.projects || []).find(p => p.kind === 'habitat' && p.colony_id === colonyId); }
function ecPendingBuild(colonyId, btype) { return (EC.projects || []).find(p => p.kind === 'build' && p.colony_id === colonyId && p.btype === btype); }
function ecPendingTerraform(sysId, planetName, pid) {
  return (EC.projects || []).find(p => {
    if (p.kind !== 'terraform' || p.system_id !== sysId) return false;
    // pid точнее имени (две одноимённые планеты); имя — фолбэк для старых проектов без pid
    if (pid != null && p.planet_pid != null) return p.planet_pid === pid;
    return p.planet_name === planetName;
  });
}
// Сколько ходов осталось до завершения проекта
function ecProjTurnsLeft(p) {
  if (!p || !p.ready_at) return 0;
  const ms = new Date(p.ready_at).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 86400000));
}
function ecProjEtaTxt(p) {
  if (!p || !p.ready_at) return 'неизвестно';
  const ms = new Date(p.ready_at).getTime() - Date.now();
  if (ms <= 0) return 'готово — ждёт тика';
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `через ~${h} ч`;
  return `через ~${Math.ceil(ms / 86400000)} д`;
}

// ── Прогресс-бар таймера: шкала заполнения + остаток времени ──
// Компактный остаток времени (мин / ч / д).
function ecFmtLeft(ms) {
  if (ms <= 0) return 'готово';
  if (ms < 3600000)  return `${Math.max(1, Math.round(ms / 60000))} мин`;
  if (ms < 86400000) { const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); return m ? `${h} ч ${m} мин` : `${h} ч`; }
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000); return h ? `${d} д ${h} ч` : `${d} д`;
}
// Прогресс-бар [startMs..endMs] + подпись остатка. readyText — подпись по завершении.
function ecProgress(startMs, endMs, readyText) {
  const now = Date.now();
  const total = Math.max(1, endMs - startMs);
  const left = endMs - now;
  const ready = left <= 0;
  const pct = ready ? 100 : Math.min(100, Math.max(0, Math.round((now - startMs) / total * 100)));
  const txt = ready ? (readyText || 'готово') : ecFmtLeft(left);
  return `<span class="ec-prog${ready ? ' is-ready' : ''}">`
    + `<span class="ec-prog-track"><span class="ec-prog-fill" style="width:${pct}%"></span></span>`
    + `<span class="ec-prog-txt">${esc(txt)}</span></span>`;
}
// Враппер для ISO-строк. start может отсутствовать → берём end − fallbackDays.
function ecProgressISO(startISO, endISO, fallbackDays, readyText) {
  if (!endISO) return `<span class="ec-prog-txt">${esc(readyText || '—')}</span>`;
  const end = new Date(endISO).getTime();
  const start = startISO ? new Date(startISO).getTime() : end - Math.max(1, fallbackDays || 1) * 86400000;
  return ecProgress(start, end, readyText);
}
// Сколько вернуть при отмене проекта. Сначала — точные затраты из payload (как при
// создании). Фолбэк для старых проектов без payload: восстанавливаем цену из правил,
// чтобы возврат не пропадал (раньше такие проекты возвращали 0 — частая жалоба).
function ecProjectRefund(p) {
  let gc = (p.payload && +p.payload.spent_gc) || 0;
  let sci = (p.payload && +p.payload.spent_science) || 0;
  if (gc || sci) return { gc, science: sci };
  try {
    if (p.kind === 'slot') {
      const b = EC.buildings.find(x => x.id === p.building_id);
      const d = b && EC_BUILD[b.btype];
      if (d && d.ladder) gc = ecBuildCost(d.ladder[Math.max(0, b.slots_open)] || 0);
    } else if (p.kind === 'build') {
      const d = EC_BUILD[p.btype];
      if (d) gc = ecBuildCost(d.cost || 0);
    } else if (p.kind === 'habitat') {
      gc = ecColonizeCost(EC_HABITAT_COST);
    }
  } catch (e) {}
  return { gc, science: sci };
}
// Отмена проекта с возвратом ГС/ОН
async function ecCancelProject(id) {
  const p = (EC.projects || []).find(x => x.id === id); if (!p) return;
  const { gc: rg, science: rs } = ecProjectRefund(p);
  const refundTxt = (rg || rs) ? `Вернётся: ${rg ? ecNum(rg) + ' ГС' : ''}${rg && rs ? ' + ' : ''}${rs ? ecNum(rs) + ' ОН' : ''}.` : 'Затрат к возврату нет.';
  if (!confirm(`Отменить проект «${p.label || p.kind}»? ${refundTxt}`)) return;
  try {
    await ecRpc('economy_cancel_project', { p_project_id: id });
    toast('Проект отменён, затраты возвращены', 'inf');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
}

// Колонизация РОДНОЙ планеты — мгновенно (просто заселение пригодного мира).
// Поиск планеты в системе по стабильному pid (фолбэк — по имени для немигрированных данных).
function ecFindPlanet(sys, planetName, pid) {
  const planets = (sys && sys.planets) || [];
  if (pid != null) { const byPid = planets.find(x => x.pid === pid); if (byPid) return byPid; }
  return planets.find(x => x.name === planetName);
}

async function ecColonize(sysId, planetName, planetType, cells, foreign, pid) {
  if (foreign) return ecTerraform(sysId, planetName, planetType, cells, pid); // непригодная → отложенный терраформ
  if (EC.busy) return; EC.busy = true;
  try {
    if (pid == null) { toast('У планеты нет pid — обновите карту', 'err'); return; }
    await ecRpc('economy_colonize', { p_system_id: sysId, p_planet_pid: pid });
    toast('Планета колонизирована', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Небожители: построить станцию на непригодном мире — малая колония (3–5 ячеек), сразу.
// Требует изученной технологии-станции для группы этого мира. Ресурсы пояса/гиганта
// копируются в колонию — на станции можно добывать (астероидная добыча и т.п.).
async function ecBuildStation(sysId, planetName, planetType, group, pid) {
  if (EC.busy) return;
  const st = ecStationFor(group);
  if (!st) { toast('Нужна технология Небожителей для этого типа мира', 'err'); return; }
  EC.busy = true;
  try {
    if (pid == null) { toast('У планеты нет pid — обновите карту', 'err'); return; }
    await ecRpc('economy_build_station', { p_system_id: sysId, p_planet_pid: pid });
    toast(`${st.icon} ${st.label} построена · ${st.cells} ячеек`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Терраформирование НЕПРИГОДНОЙ планеты — отложенный проект (1..4 хода + ОН по сложности).
async function ecTerraform(sysId, planetName, planetType, cells, pid) {
  if (EC.busy) return;
  if (ecPendingTerraform(sysId, planetName, pid)) { toast('Терраформирование уже идёт', 'inf'); return; }
  const sys = EC.systems.find(s => s.id === sysId);
  const p = ecFindPlanet(sys, planetName, pid);
  const tier = ecTerraTier(p, EC.app.race), spec = EC_TERRA[tier];
  const terraGc = ecColonizeCost(spec.gc);
  if (!confirm(`Терраформирование «${planetName}» (${spec.label.toLowerCase()}):\n• срок: ${spec.turns} ход(ов)\n• затраты: ${ecNum(terraGc)} ГС${spec.science ? ` + ${ecNum(spec.science)} ОН` : ''}\nНачать?`)) return;
  EC.busy = true;
  try {
    if (pid == null) { toast('У планеты нет pid — обновите карту', 'err'); return; }
    await ecRpc('economy_terraform', { p_system_id: sysId, p_planet_pid: pid });
    toast(`Терраформирование начато (${spec.turns} ход.)`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
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
  // Лимит мощности за ход: пехота → Центр Подготовки, техника → Военный Завод, корабли → Верфь.
  const caps = ecCaps(), use = ecPendingUse(), mp = ecDivManpower(div);
  const needInf = mp.inf * qty, needTech = mp.tech * qty, needShips = mp.ships * qty;
  if (use.inf + needInf > caps.training) { toast(`Лимит Центра Подготовки: ${ecNum(needInf)} пехоты нужно, свободно ${ecNum(Math.max(0, caps.training - use.inf))}/${ecNum(caps.training)} за ход — постройте слоты или ждите хода`, 'err'); return; }
  if (use.tech + needTech > caps.military) { toast(`Лимит Военного Завода: ${ecNum(needTech)} техники нужно, свободно ${ecNum(Math.max(0, caps.military - use.tech))}/${ecNum(caps.military)} за ход — постройте слоты или ждите хода`, 'err'); return; }
  if (use.ships + needShips > caps.ships) { toast(`Лимит Верфи: ${ecNum(needShips)} кораблей в составе, свободно ${ecNum(Math.max(0, caps.ships - use.ships))}/${ecNum(caps.ships)} за ход`, 'err'); return; }
  const cost = ((div.summary && div.summary.cost) || 0) * qty;
  EC.busy = true;
  try {
    await ecRpc('economy_produce', { p_unit_id: div.id, p_qty: qty });
    toast(`Формируется дивизия: ${div.name} ×${qty}`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
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
    await ecRpc('economy_produce', { p_unit_id: u.id, p_qty: qty });
    toast(`Заложен корабль: ${u.name} ×${qty}`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

async function ecCancelProd(id) {
  try {
    await ecRpc('economy_cancel_production', { p_id: id });
    toast('Производство отменено', 'inf');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
}

// ── Постройка зданий: каталог-выбор → подтверждение → стройка ──
function _ecBuildFree(colonyId) {
  const colony = EC.colonies.find(c => c.id === colonyId); if (!colony) return 0;
  const used = EC.buildings.filter(b => b.colony_id === colonyId).length
    + (EC.projects || []).filter(p => p.kind === 'build' && p.colony_id === colonyId).length;
  return (colony.cells || EC_DEFAULT_CELLS) - used;
}
function _ecBuildHost() {
  let h = document.getElementById('ec-bp-host');
  if (!h) { h = document.createElement('div'); h.id = 'ec-bp-host'; document.body.appendChild(h); }
  return h;
}
function ecBuildClose() { const h = document.getElementById('ec-bp-host'); if (h) h.innerHTML = ''; }

// Шаг 1 — каталог построек (что можно построить)
function ecBuildPicker(colonyId) {
  if (EC.busy) return;
  const colony = EC.colonies.find(c => c.id === colonyId); if (!colony) return;
  const free = _ecBuildFree(colonyId);
  if (free <= 0) { toast('Нет свободных ячеек на планете', 'err'); return; }
  const gc = EC.eco.gc || 0;
  const cards = EC_ORDER.map(t => {
    const d = EC_BUILD[t]; const cost = ecBuildCost(d.cost); const afford = gc >= cost;
    return `<button class="ec-bp-card ec-bp-${d.cat}${afford ? '' : ' ec-bp-noaf'}" ${afford ? '' : 'disabled'} onclick="ecBuildConfirm('${colonyId}','${t}')">
      <span class="ec-bp-ic">${EC_BLD_ICON[t] || '⌂'}</span>
      <span class="ec-bp-info">
        <span class="ec-bp-row1"><span class="ec-bp-name">${esc(d.name)}</span><span class="ec-bp-cat ec-bp-cat-${d.cat}">${d.cat === 'civ' ? 'Гражд.' : 'Воен.'}</span></span>
        <span class="ec-bp-desc">${esc(d.desc)}</span>
        <span class="ec-bp-howto">${esc(EC_BLD_HOWTO[t] || '')}</span>
      </span>
      <span class="ec-bp-cost${afford ? '' : ' ec-bp-cant'}">${ecNum(cost)} <small>ГС</small></span>
    </button>`;
  }).join('');
  _ecBuildHost().innerHTML = `<div class="ec-bp-ov" onclick="if(event.target===this)ecBuildClose()">
    <div class="ec-bp-modal" role="dialog" aria-modal="true">
      <div class="ec-bp-hd">
        <div class="ec-bp-hd-t"><span class="ec-bp-hd-ic">🏗</span><span>Что построить</span></div>
        <button class="ec-bp-x" title="Закрыть" onclick="ecBuildClose()">✕</button>
      </div>
      <div class="ec-bp-meta"><span>🪐 ${esc(colony.planet_name || 'Колония')}</span><span>⬚ свободно ячеек: <b>${free}</b></span><span>💰 казна: <b>${ecNum(gc)}</b> ГС</span></div>
      <div class="ec-bp-grid">${cards}</div>
      <div class="ec-bp-foot">Постройка занимает 1 ячейку и завершается через 1 игровой день. Затраты возвращаются при отмене.</div>
    </div>
  </div>`;
}

// Шаг 2 — подтверждение выбранной постройки
function ecBuildConfirm(colonyId, btype) {
  const d = EC_BUILD[btype]; if (!d) return;
  const colony = EC.colonies.find(c => c.id === colonyId); if (!colony) return;
  const cost = ecBuildCost(d.cost); const after = (EC.eco.gc || 0) - cost;
  _ecBuildHost().innerHTML = `<div class="ec-bp-ov" onclick="if(event.target===this)ecBuildClose()">
    <div class="ec-bp-modal ec-bp-cf" role="dialog" aria-modal="true">
      <div class="ec-bp-cf-ic ec-bp-${d.cat}">${EC_BLD_ICON[btype] || '⌂'}</div>
      <div class="ec-bp-cf-title">Построить «${esc(d.name)}»?</div>
      <div class="ec-bp-cf-desc">${esc(d.desc)}</div>
      <div class="ec-bp-cf-howto">${esc(EC_BLD_HOWTO[btype] || '')}</div>
      <div class="ec-bp-cf-rows">
        <div class="ec-bp-cf-row"><span>🪐 Планета</span><b>${esc(colony.planet_name || 'Колония')}</b></div>
        <div class="ec-bp-cf-row"><span>💰 Стоимость</span><b>${ecNum(cost)} ГС</b></div>
        <div class="ec-bp-cf-row"><span>⏳ Срок</span><b>1 игровой день</b></div>
        <div class="ec-bp-cf-row"><span>🏦 Казна после</span><b class="${after < 0 ? 'ec-warn' : ''}">${ecNum(after)} ГС</b></div>
      </div>
      <div class="ec-bp-cf-act">
        <button class="btn btn-gh btn-sm" onclick="ecBuildPicker('${colonyId}')">← Назад к списку</button>
        <button class="btn btn-gd btn-sm" onclick="ecBuildDo('${colonyId}','${btype}')">✓ Построить за ${ecNum(cost)} ГС</button>
      </div>
    </div>
  </div>`;
}

// Шаг 3 — собственно постройка (отложенный проект, 1 ход)
async function ecBuildDo(colonyId, btype) {
  if (EC.busy) return;
  const d = EC_BUILD[btype]; if (!d) return;
  const colony = EC.colonies.find(c => c.id === colonyId); if (!colony) return;
  const used = EC.buildings.filter(b => b.colony_id === colonyId).length;
  const pending = (EC.projects || []).filter(p => p.kind === 'build' && p.colony_id === colonyId).length;
  if (used + pending >= (colony.cells || EC_DEFAULT_CELLS)) { toast('Нет свободных ячеек на планете', 'err'); ecBuildClose(); return; }
  EC.busy = true;
  try {
    await ecRpc('economy_build', { p_colony_id: colonyId, p_btype: btype });
    ecBuildClose();
    toast(d.name + ' — строительство начато (1 день)', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); ecBuildClose(); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Строительство слота здания — отложенный проект (1 ход).
async function ecOpenSlot(buildingId) {
  if (EC.busy) return;
  const b = EC.buildings.find(x => x.id === buildingId); if (!b) return;
  const d = EC_BUILD[b.btype]; if (!d) return;
  if (b.slots_open >= EC_MAX_SLOTS) { toast('Все слоты открыты', 'inf'); return; }
  if (ecPendingSlot(buildingId)) { toast('Слот уже строится', 'inf'); return; }
  EC.busy = true;
  try {
    await ecRpc('economy_open_slot', { p_building_id: buildingId });
    toast('Слот заложен — откроется через 1 день', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

async function ecToggleTnp(buildingId, checked) {
  try { await ecRpc('economy_set_tnp', { p_building_id: buildingId, p_on: !!checked }); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
}
// Режим добывающего завода: 'store' (копить на складе) | 'export' (продавать поток за ГС)
async function ecSetMineMode(buildingId, mode) {
  try {
    await ecRpc('economy_set_mine_mode', { p_building_id: buildingId, p_mode: mode });
    const b = EC.buildings.find(x => x.id === buildingId); if (b) b.mine_mode = mode;
    ecPaintCabinet();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); }
}

// Обустройство среды обитания на своей колонии (+ячейки) — отложенный проект (1 ход).
async function ecHabitat(colonyId) {
  if (EC.busy) return;
  const c = EC.colonies.find(x => x.id === colonyId); if (!c) return;
  if (ecPendingHabitat(colonyId)) { toast('Обустройство уже идёт', 'inf'); return; }
  EC.busy = true;
  try {
    await ecRpc('economy_habitat', { p_colony_id: colonyId });
    toast('Обустройство среды начато — завершится через 1 день', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Полная вложенная стоимость здания: база постройки + все ПЛАТНЫЕ открытые слоты
// (бесплатные стартовые слоты d.free идут с базой). Цены — по текущим правилам/доктрине.
function ecBuildingInvested(b) {
  const d = EC_BUILD[b.btype]; if (!d) return 0;
  let gc = ecBuildCost(d.cost || 0);
  const free = d.free || 0;
  for (let i = free; i < (b.slots_open || 0); i++) gc += ecBuildCost((d.ladder && d.ladder[i]) || 0);
  return gc;
}
async function ecDemolish(buildingId) {
  const b = EC.buildings.find(x => x.id === buildingId); if (!b) return;
  const pend = ecPendingSlot(buildingId);              // незавершённый слот этого здания тоже вернём
  let refund = ecBuildingInvested(b);
  if (pend) refund += ecProjectRefund(pend).gc;
  if (!confirm(`Снести постройку?${refund ? ` Вернётся ${ecNum(refund)} ГС (полная стоимость${pend ? ' + незавершённый слот' : ''}).` : ''}`)) return;
  try {
    await ecRpc('economy_demolish', { p_building_id: buildingId });
    toast(refund ? `Снесено · возврат ${ecNum(refund)} ГС` : 'Снесено', 'inf');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
}

async function ecAbandon(colonyId) {
  const c = EC.colonies.find(x => x.id === colonyId); if (!c) return;
  if (!confirm('Бросить колонию «' + (c.planet_name || '') + '»? Все её постройки будут потеряны.')) return;
  try { await ecRpc('economy_abandon', { p_colony_id: colonyId }); toast('Колония оставлена', 'inf'); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
}
