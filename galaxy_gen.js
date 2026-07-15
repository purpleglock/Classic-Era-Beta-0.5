// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════
// GALAXY GEN — генератор состава систем (на основе STELLAR FORGE)
// Экспортирует window.GalaxyGen.generate(opts) → {star, bodies}
// bodies[i] = {kind, name, type, icon, zone, dist, slotsP, slotsK, rings, moons, resources[]}
// ════════════════════════════════════════════════════════════
(function () {
  // ── RNG ──
  let _s = 1;
  function seedRng(s) { _s = (s >>> 0) || 1; }
  function rng() { _s ^= _s << 13; _s ^= _s >> 17; _s ^= _s << 5; return (_s >>> 0) / 0xffffffff; }
  function ri(a, b) { return Math.floor(rng() * (b - a + 1)) + a; }
  function rc(arr) { return arr[ri(0, arr.length - 1)]; }
  function ch(p) { return rng() * 100 < p; }
  function dN(n) { return ri(1, n); }

  // ── STARS ──
  const STARS = {
    O: { name: 'Голубой гигант', mass: [20, 60], col: '#6496ff', e: '🔵', orbits: [4, 7], dead: false, rb: ['EXOCRYST', 'ANTIMATTER', 'THERMFUEL'] },
    B: { name: 'Голубой', mass: [3, 20], col: '#96b4ff', e: '🔵', orbits: [5, 9], dead: false, rb: ['EXOCRYST', 'THERMFUEL', 'HELIUM3'] },
    A: { name: 'Бело-голубой', mass: [1.5, 3], col: '#c8d8ff', e: '⚪', orbits: [5, 9], dead: false, rb: ['RAREEARTH', 'DIAMONDS'] },
    F: { name: 'Жёлто-белый', mass: [1.1, 1.5], col: '#fff5c8', e: '🌕', orbits: [6, 10], dead: false, rb: ['RAREEARTH', 'ORGANICS', 'WATER'] },
    G: { name: 'Жёлтый', mass: [0.8, 1.1], col: '#ffe080', e: '☀️', orbits: [6, 12], dead: false, rb: ['ORGANICS', 'WATER', 'PLATINUM'] },
    K: { name: 'Оранжевый', mass: [0.5, 0.8], col: '#ff9940', e: '🟠', orbits: [5, 10], dead: false, rb: ['SULFIDES', 'TITANIUM'] },
    M: { name: 'Красный карлик', mass: [0.1, 0.5], col: '#ff4020', e: '🔴', orbits: [4, 8], dead: false, rb: ['SULFIDES', 'IRON'] },
    D: { name: 'Белый карлик', mass: [0.5, 1.4], col: '#c8c8ff', e: '⚫', orbits: [0, 3], dead: true, rb: ['DEGENERATE', 'QUANTUMCRYST'] },
    N: { name: 'Пульсар', mass: [1.4, 3], col: '#40ffc0', e: '💚', orbits: [0, 3], dead: true, rb: ['NEUTRONMAT', 'QUANTUMCRYST', 'ANTIMATTER'] },
  };
  const SDIST = { O: .00003, B: .1, A: .6, F: 3, G: 7, K: 12, M: 23, D: 2, N: .1 };

  const GRP = {
    lava: { name: 'Лавовые миры' }, volcanic: { name: 'Вулканические' }, terrestrial: { name: 'Землеподобные' },
    oceanic: { name: 'Океанические' }, desert: { name: 'Пустынные' }, cryo: { name: 'Криомиры' },
    gasgiant: { name: 'Газовые гиганты' }, icegiant: { name: 'Ледяные гиганты' }, hotgiant: { name: 'Горячие гиганты' },
    exotic: { name: 'Экзотические' }, micro: { name: 'Малые тела' }, anomaly: { name: 'Аномалии' },
  };

  const MOON_CLS = [
    { id: 'mc_rocky', sz: 'S', pg: ['terrestrial', 'desert', 'cryo', 'micro', 'lava', 'volcanic'] },
    { id: 'mc_ice_s', sz: 'S', pg: ['cryo', 'icegiant', 'gasgiant', 'oceanic'] },
    { id: 'mc_irr', sz: 'S', pg: ['gasgiant', 'icegiant', 'hotgiant', 'exotic', 'micro'] },
    { id: 'mc_dust', sz: 'S', pg: ['lava', 'volcanic', 'desert'] },
    { id: 'mc_volc_m', sz: 'M', pg: ['lava', 'volcanic', 'hotgiant', 'gasgiant'] },
    { id: 'mc_cryo_m', sz: 'M', pg: ['icegiant', 'cryo', 'gasgiant'] },
    { id: 'mc_metal_m', sz: 'M', pg: ['lava', 'terrestrial', 'micro'] },
    { id: 'mc_large_ice', sz: 'L', pg: ['gasgiant', 'icegiant', 'cryo'] },
    { id: 'mc_large_rock', sz: 'L', pg: ['gasgiant', 'terrestrial'] },
    { id: 'mc_captured', sz: 'L', pg: ['gasgiant', 'icegiant'] },
  ];
  const RING_CLS = [{ name: 'Ледяные' }, { name: 'Силикатные' }, { name: 'Пылевые' }, { name: 'Смешанные' }, { name: 'Металлические' }, { name: 'Органические' }];

  // ── PLANETS (с зонами/весами) ──
  const PLANETS = [
    { id: 'lavaworld', name: 'Катархей', g: 'lava', i: '🌋', s: [0], w: 9, rings: 6, mm: 1 },
    { id: 'coreplanet', name: 'Мёртвая планета', g: 'lava', i: '🪨', s: [0, 1], w: 6, rings: 3, mm: 0 },
    { id: 'supervolc', name: 'Супервулканическая планета', g: 'volcanic', i: '🌋', s: [0, 1], w: 7, rings: 9, mm: 2 },
    { id: 'chthonian', name: 'Хтонический мир', g: 'lava', i: '💀', s: [0, 1], w: 5, rings: 2, mm: 0 },
    { id: 'hotjup', name: 'Горячий Юпитер', g: 'hotgiant', i: '🔥', s: [0, 1], w: 4, rings: 16, mm: 3, rings_ex: true, unique: 'hotjup' },
    { id: 'hotnep', name: 'Горячий Нептун', g: 'hotgiant', i: '🌊', s: [0, 1], w: 6, rings: 13, mm: 2, rings_ex: true },
    { id: 'ironworld', name: 'Железный мир', g: 'lava', i: '⚙️', s: [0, 1], w: 5, rings: 3, mm: 1 },
    { id: 'venus', name: 'Дастория', g: 'volcanic', i: '♀️', s: [1], w: 8, rings: 2, mm: 1 },
    { id: 'desert', name: 'Литара', g: 'desert', i: '🏜️', s: [1, 2], w: 9, rings: 3, mm: 2 },
    { id: 'diamond', name: 'Океаническая суперземля', g: 'exotic', i: '💎', s: [1, 2], w: 3, rings: 11, mm: 2 },
    { id: 'superpuff', name: 'Рыхлый гигант', g: 'gasgiant', i: '🫧', s: [1, 2], w: 5, rings: 9, mm: 2, rings_ex: true },
    { id: 'ironearth', name: 'Железный карлик', g: 'terrestrial', i: '⚙️', s: [0, 1, 2], w: 5, rings: 3, mm: 1 },
    { id: 'acid', name: 'Духлесс', g: 'volcanic', i: '🧪', s: [1, 2], w: 4, rings: 3, mm: 1 },
    { id: 'earth', name: 'Терра', g: 'terrestrial', i: '🌍', s: [2], w: 6, rings: 3, mm: 3, unique: 'earth' },
    { id: 'superearth', name: 'Суперземля', g: 'terrestrial', i: '🌎', s: [2], w: 7, rings: 5, mm: 3 },
    { id: 'hycean', name: 'Гикеан', g: 'oceanic', i: '🌊', s: [2], w: 6, rings: 3, mm: 2 },
    { id: 'panth', name: 'Панталассическая планета', g: 'oceanic', i: '💧', s: [2], w: 5, rings: 3, mm: 2 },
    { id: 'ametallic', name: 'Теракрон', g: 'terrestrial', i: '🪨', s: [2], w: 4, rings: 5, mm: 2 },
    { id: 'mininep', name: 'Мини-Нептун', g: 'gasgiant', i: '🫐', s: [2, 3], w: 8, rings: 11, mm: 3, rings_ex: true },
    { id: 'jupII', name: 'Водный Юпитер', g: 'gasgiant', i: '🪐', s: [2, 3], w: 5, rings: 19, mm: 8, rings_ex: true, gasGiant: true },
    { id: 'tundra', name: 'Тундровая планета', g: 'terrestrial', i: '🏔️', s: [2, 3], w: 5, rings: 2, mm: 2 },
    { id: 'archipelago', name: 'Псамора', g: 'oceanic', i: '🏝️', s: [2], w: 4, rings: 2, mm: 2 },
    { id: 'ferroworld', name: 'Мир дюн', g: 'desert', i: '🟥', s: [1, 2], w: 5, rings: 3, mm: 2 },
    { id: 'cryo', name: 'Гельвард', g: 'cryo', i: '❄️', s: [3], w: 7, rings: 5, mm: 3 },
    { id: 'gasgiant', name: 'Турмион', g: 'gasgiant', i: '🪐', s: [3], w: 9, rings: 26, mm: 12, rings_ex: true, gasGiant: true },
    { id: 'icegiant', name: 'Ледяной гигант', g: 'icegiant', i: '🔵', s: [3, 4], w: 8, rings: 21, mm: 8, rings_ex: true, gasGiant: true },
    { id: 'ammonia', name: 'Аммиачный мир', g: 'cryo', i: '🟣', s: [3], w: 5, rings: 5, mm: 3 },
    { id: 'gasdwarf', name: 'Газовый карлик', g: 'gasgiant', i: '🪐', s: [3, 4], w: 6, rings: 11, mm: 4, rings_ex: true },
    { id: 'methane_w', name: 'Метановый мир', g: 'cryo', i: '🟩', s: [3], w: 4, rings: 3, mm: 2 },
    { id: 'superjup', name: 'Суперюпитер', g: 'gasgiant', i: '🪐', s: [3, 4], w: 4, rings: 31, mm: 15, rings_ex: true, gasGiant: true },
    { id: 'browndwarf', name: 'Коричневый карлик', g: 'gasgiant', i: '🟤', s: [4], w: 3, rings: 21, mm: 10, rings_ex: true, gasGiant: true },
    { id: 'sednoid', name: 'Гельвард', g: 'cryo', i: '🩵', s: [4], w: 6, rings: 2, mm: 1 },
    { id: 'rogue', name: 'Планета-сирота', g: 'exotic', i: '👁️', s: [4], w: 3, rings: 5, mm: 2 },
    { id: 'cometary', name: 'Углеродная планета', g: 'cryo', i: '☄️', s: [4], w: 5, rings: 9, mm: 1 },
    { id: 'darkfrozen', name: 'Тёмный замёрзший мир', g: 'cryo', i: '🌑', s: [4], w: 4, rings: 2, mm: 1 },
    { id: 'proto', name: 'Карликовая планета', g: 'micro', i: '🪨', s: [0, 1, 2, 3, 4], w: 11, rings: 2, mm: 1 },
    { id: 'megaast', name: 'Мегаастероид', g: 'micro', i: '🌑', s: [0, 1, 2, 3, 4], w: 11, rings: 0, mm: 0 },
    { id: 'blackhole', name: 'Черная дыра', g: 'anomaly', i: '⚫', s: [4], w: 1, rings: 0, mm: 0, anomaly: true },
    { id: 'wormhole', name: 'Кротовая нора', g: 'anomaly', i: '🌀', s: [4], w: 1, rings: 0, mm: 0, anomaly: true },
    { id: 'starshard', name: 'Токсичный карлик', g: 'anomaly', i: '✴️', s: [0, 1], w: 1, rings: 0, mm: 0, anomaly: true },
  ];

  // ── СЛОТЫ: планетные (П) и космические (К) ──
  // Значения со скрина пользователя + додуманы по группам
  const SLOTS_ID = {
    earth: { p: 10, k: 4 }, desert: { p: 6, k: 4 }, cryo: { p: 4, k: 4 }, gasgiant: { p: 0, k: 4 },
    archipelago: { p: 8, k: 4 }, acid: { p: 4, k: 4 }, ametallic: { p: 4, k: 4 }, venus: { p: 4, k: 4 },
    megaast: { p: 2, k: 1 }, proto: { p: 2, k: 1 }, coreplanet: { p: 1, k: 4 },
    superearth: { p: 9, k: 4 }, hycean: { p: 7, k: 4 }, panth: { p: 6, k: 3 }, tundra: { p: 5, k: 4 },
  };
  const SLOTS_GRP = {
    terrestrial: { p: 6, k: 4 }, oceanic: { p: 6, k: 3 }, desert: { p: 6, k: 4 }, lava: { p: 2, k: 4 },
    volcanic: { p: 3, k: 4 }, cryo: { p: 4, k: 4 }, gasgiant: { p: 0, k: 6 }, icegiant: { p: 0, k: 5 },
    hotgiant: { p: 0, k: 4 }, exotic: { p: 2, k: 4 }, micro: { p: 2, k: 1 }, anomaly: { p: 0, k: 0 },
  };
  function getSlots(pl) { return SLOTS_ID[pl.id] || SLOTS_GRP[pl.g] || { p: 3, k: 3 }; }

  // ── RESOURCES ──
  const RB = { common: 82, uncommon: 48, rare: 18, epic: 6, legendary: 1.5 };
  const RESOURCES = [
    { id: 'IRON', name: 'Железо', icon: '⚙️', r: 'common', d: [3, 6, 100], g: ['lava', 'volcanic', 'terrestrial', 'desert', 'cryo', 'micro'], ids: [], stars: [] },
    { id: 'SILICATE', name: 'Силикаты', icon: '🪨', r: 'common', d: [4, 6, 80], g: ['terrestrial', 'desert', 'micro', 'cryo', 'oceanic'], ids: [], stars: [] },
    { id: 'ICEWATER', name: 'Лёд', icon: '🧊', r: 'common', d: [4, 8, 150], g: ['cryo', 'icegiant', 'oceanic', 'micro'], ids: [], stars: [] },
    { id: 'CARBON', name: 'Углерод', icon: '⬛', r: 'common', d: [3, 6, 90], g: ['terrestrial', 'exotic', 'gasgiant'], ids: [], stars: [] },
    { id: 'METHANE', name: 'Метан', icon: '💚', r: 'common', d: [2, 6, 400], g: ['gasgiant', 'icegiant', 'cryo'], ids: [], stars: [] },
    { id: 'SULFUR', name: 'Сера', icon: '🌑', r: 'common', d: [2, 8, 60], g: ['lava', 'volcanic', 'desert'], ids: [], stars: ['K', 'M'] },
    { id: 'COPPER', name: 'Медь', icon: '🟤', r: 'uncommon', d: [2, 6, 40], g: ['terrestrial', 'micro', 'desert'], ids: [], stars: [] },
    { id: 'TITANIUM', name: 'Титан', icon: '🔘', r: 'uncommon', d: [2, 4, 30], g: ['terrestrial', 'cryo', 'micro'], ids: [], stars: ['F', 'G', 'K'] },
    { id: 'SULFIDES', name: 'Ионит', icon: '🟡', r: 'uncommon', d: [2, 4, 50], g: ['lava', 'volcanic'], ids: [], stars: ['K', 'M'] },
    { id: 'AMMONIA', name: 'Аммиачный лёд', icon: '🟣', r: 'uncommon', d: [2, 6, 120], g: ['cryo', 'icegiant'], ids: ['ammonia'], stars: [] },
    { id: 'RAREEARTH', name: 'Редкоземельные руды', icon: '💡', r: 'rare', d: [1, 6, 15], g: ['terrestrial', 'cryo'], ids: [], stars: ['A', 'F', 'G'] },
    { id: 'PLATINUM', name: 'Платина', icon: '⬜', r: 'rare', d: [1, 4, 10], g: ['terrestrial', 'micro'], ids: [], stars: ['G', 'K'] },
    { id: 'URANIUM', name: 'Изотопы', icon: '☢️', r: 'rare', d: [1, 4, 8], g: ['lava', 'terrestrial', 'volcanic'], ids: [], stars: [] },
    { id: 'WATER', name: 'Жидкая вода', icon: '🌊', r: 'rare', d: [1, 4, 20], g: ['oceanic', 'terrestrial'], ids: ['earth', 'superearth', 'hycean', 'panth', 'jupII', 'archipelago'], stars: ['G', 'K', 'F'] },
    { id: 'ORGANICS', name: 'Реликтовое дерево', icon: '🧬', r: 'rare', d: [1, 6, 18], g: ['terrestrial', 'oceanic'], ids: ['earth', 'hycean', 'panth'], stars: ['G', 'K', 'F'] },
    { id: 'DEUTERIUM', name: 'Дейтерий', icon: '⚛️', r: 'rare', d: [2, 6, 400], g: ['gasgiant', 'icegiant', 'hotgiant'], ids: [], stars: ['G', 'F', 'K'] },
    { id: 'HELIUM3', name: 'Гелий-3', icon: '🫧', r: 'rare', d: [1, 6, 250], g: ['gasgiant', 'hotgiant'], ids: [], stars: ['O', 'B', 'A'] },
    { id: 'THERMFUEL', name: 'Старвис', icon: '🔥', r: 'epic', d: [1, 4, 80], g: ['hotgiant', 'gasgiant'], ids: [], stars: ['O', 'B'] },
    { id: 'DIAMONDS', name: 'Хтонит', icon: '💎', r: 'epic', d: [1, 3, 5], g: ['exotic'], ids: ['diamond'], stars: ['A', 'F'] },
    { id: 'EXOCRYST', name: 'Стелларит', icon: '🔷', r: 'epic', d: [1, 2, 3], g: ['exotic'], ids: ['sednoid'], stars: ['O', 'B', 'D'] },
    { id: 'QUANTUMCRYST', name: 'Гравиядро', icon: '🔮', r: 'legendary', d: 'следы', g: ['exotic'], ids: ['diamond', 'sednoid', 'rogue'], stars: ['D', 'N'] },
    { id: 'DEGENERATE', name: 'Рагенод', icon: '💀', r: 'legendary', d: 'мкг', g: ['anomaly'], ids: ['coreplanet', 'chthonian'], stars: ['D', 'N'] },
    { id: 'NEUTRONMAT', name: 'Программируемая материя', icon: '🟢', r: 'legendary', d: 'пкг', g: ['anomaly'], ids: ['starshard', 'coreplanet'], stars: ['N'] },
  ];
  function rname(r) { return { common: 'обычный', uncommon: 'редкий', rare: 'ценный', epic: 'эпический', legendary: 'легенд.' }[r] || r; }
  function rollDice(spec, rmult) {
    if (!Array.isArray(spec)) return String(spec);
    const [n, s, m] = spec; let t = 0; for (let i = 0; i < n; i++) t += dN(s);
    return Math.round(t * (m || 1) * rmult);
  }
  function amtDesc(v) {
    if (typeof v === 'string') return v;
    if (v >= 5000) return 'колоссально'; if (v >= 1500) return 'очень много'; if (v >= 400) return 'много';
    if (v >= 80) return 'умеренно'; if (v >= 15) return 'мало'; return 'следы';
  }
  function getRes(pid, pg, sc, rmult) {
    const out = [];
    for (const R of RESOURCES) {
      if (!R.g.includes(pg) && !R.ids.includes(pid)) continue;
      let c = (RB[R.r] || 10) * rmult;
      if (R.stars.length && R.stars.includes(sc)) c = Math.min(97, c + 24);
      if (!ch(c)) continue;
      out.push({ name: R.name, icon: R.icon, r: R.r, rname: rname(R.r), amt: amtDesc(rollDice(R.d, rmult)) });
    }
    return out;
  }

  // ── BELTS ──
  const BTYPES = {
    main: { name: 'Главный пояс астероидов', icon: '🌑', dd: 6, cd: 8 },
    kuiper: { name: 'Пояс Койпера', icon: '🔵', dd: 8, cd: 6 },
    debris: { name: 'Мусорный пояс', icon: '💨', dd: 3, cd: 4 },
    vulcanoid: { name: 'Вулканоиды', icon: '🔥', dd: 4, cd: 4 },
  };
  const BCOMP = { 1: 'Силикатный', 2: 'Металлический', 3: 'Углеродный', 4: 'Смешанный', 5: 'Ледяной', 6: 'Ледяно-силикатный', 7: 'Металло-угл.', 8: 'Хондритовый' };
  const BDENS = ['', 'Разрежённый', 'Умеренный', 'Умеренный', 'Плотный', 'Плотный', 'Сверхплотный', 'Сверхплотный', 'Гиперплотный'];
  const BRES = { 1: ['SILICATE', 'IRON'], 2: ['IRON', 'PLATINUM', 'RAREEARTH'], 3: ['CARBON', 'DIAMONDS'], 4: ['IRON', 'SILICATE', 'COPPER'], 5: ['ICEWATER', 'AMMONIA', 'METHANE'], 6: ['ICEWATER', 'SILICATE', 'RAREEARTH'], 7: ['IRON', 'CARBON', 'URANIUM'], 8: ['SILICATE', 'IRON', 'RAREEARTH', 'URANIUM'] };
  function rollBelt(bt_id, sc, rmult) {
    const bt = BTYPES[bt_id]; const density = dN(bt.dd); const comp = Math.min(dN(bt.cd), 8);
    const dmult = [0, .4, .7, .7, 1.1, 1.3, 1.8, 1.8, 2.5][density] || 1;
    const resources = [];
    for (const rid of (BRES[comp] || [])) {
      const R = RESOURCES.find(r => r.id === rid); if (!R) continue;
      let bc = 50 * rmult; if (R.stars.includes(sc)) bc += 20; if (!ch(bc)) continue;
      const raw = rollDice(R.d, rmult); const amt = typeof raw === 'number' ? Math.round(raw * dmult) : raw;
      resources.push({ name: R.name, icon: R.icon, r: R.r, rname: rname(R.r), amt: amtDesc(amt) });
    }
    return { density, densD: BDENS[density] || 'Умеренный', compD: BCOMP[comp] || 'Смешанный', resources, bt, bt_id };
  }

  function getSec(T) { return T > 1000 ? 0 : T > 373 ? 1 : T > 250 ? 2 : T > 150 ? 3 : 4; }
  const ZN = ['Пекло', 'Внутр.', 'Обитаемая', 'Холод', 'Пустота'];

  function genStar(cls) {
    if (!cls || cls === 'random') {
      const keys = Object.keys(SDIST); const tot = keys.reduce((a, k) => a + SDIST[k], 0);
      let r = rng() * tot, cum = 0; for (const k of keys) { cum += SDIST[k]; if (r < cum) { cls = k; break; } }
      if (!cls) cls = 'G';
    }
    const sd = STARS[cls]; const mass = rng() * (sd.mass[1] - sd.mass[0]) + sd.mass[0];
    const L = sd.dead ? 0.001 : Math.pow(mass, 3.5);
    return { cls, sd, mass, L, hz_in: Math.sqrt(L / 1.1), hz_out: Math.sqrt(L / .53), orbits: ri(sd.orbits[0], sd.orbits[1]) };
  }

  function genSatellites(planet, sc) {
    const rings = [], moons = [];
    if (planet.rings > 0 && ch(planet.rings)) {
      const n = dN(6) <= 4 ? 1 : dN(6) <= 5 ? 2 : 3;
      for (let i = 0; i < n; i++) rings.push(rc(RING_CLS));
    }
    if (planet.mm === 0) return { rings, moons };
    const base = { micro: 8, lava: 8, volcanic: 10, terrestrial: 15, desert: 12, oceanic: 12, cryo: 22, gasgiant: 55, icegiant: 50, hotgiant: 20, exotic: 10 }[planet.g] || 10;
    if (!ch(base)) return { rings, moons };
    const mr = dN(6); let count = mr <= 2 ? 1 : mr <= 4 ? ri(1, 2) : mr === 5 ? dN(3) : ri(1, Math.max(1, Math.round(planet.mm / 2)));
    count = Math.min(count, planet.mm);
    const maxSz = (rings.length && planet.rings_ex) ? 'M' : 'L';
    const eligible = MOON_CLS.filter(mc => mc.pg.includes(planet.g) && !(maxSz === 'M' && mc.sz === 'L'));
    if (!eligible.length) return { rings, moons };
    for (let i = 0; i < count; i++) moons.push(rc(eligible));
    return { rings, moons };
  }

  function genOrbits(star, rmult) {
    let dist = Math.max(0.1, 0.1 * Math.sqrt(star.L));
    const orbits = []; let hasEarth = false, hasHotJup = false, hasAnomaly = false, gg = 0, iceDone = false;
    const forceJup = ch(25);
    for (let i = 0; i < star.orbits; i++) {
      dist *= (1.35 + rng() * 0.45);
      const T = 278 * Math.pow(star.L, .25) * Math.sqrt(1 / dist);
      const sec = getSec(T); const isLast = (i === star.orbits - 1);
      if (!iceDone && (sec === 3 || sec === 4)) { iceDone = true; if (ch(62)) { orbits.push({ type: 'belt', dist, sec, ...rollBelt('main', star.cls, rmult) }); continue; } }
      if (isLast && sec >= 3 && ch(88)) { orbits.push({ type: 'belt', dist, sec, ...rollBelt('kuiper', star.cls, rmult) }); continue; }
      if (sec === 0 && ch(16)) { orbits.push({ type: 'belt', dist, sec, ...rollBelt('vulcanoid', star.cls, rmult) }); continue; }
      if (!hasAnomaly && ch(1.5)) {
        const anoms = PLANETS.filter(p => p.anomaly && p.s.includes(sec));
        if (anoms.length) { hasAnomaly = true; orbits.push({ type: 'anomaly', planet: rc(anoms), dist, sec }); continue; }
      }
      let pool = PLANETS.filter(p => !p.anomaly && p.s.includes(sec));
      if (forceJup && sec >= 3 && gg === 0) pool = PLANETS.filter(p => p.id === 'gasgiant');
      pool = pool.filter(p => { if (p.unique === 'earth' && hasEarth) return false; if (p.unique === 'hotjup' && hasHotJup) return false; if (p.gasGiant && gg >= 2) return ch(8); return true; });
      if (!pool.length) pool = [PLANETS.find(p => p.id === 'proto')];
      const tw = pool.reduce((a, p) => a + (p.w || 5), 0); let r = rng() * tw, cum = 0, chosen = pool[0];
      for (const p of pool) { cum += (p.w || 5); if (r < cum) { chosen = p; break; } }
      if (chosen.unique === 'earth') hasEarth = true; if (chosen.unique === 'hotjup') hasHotJup = true; if (chosen.gasGiant) gg++;
      const { rings, moons } = genSatellites(chosen, star.cls);
      orbits.push({ type: 'planet', planet: chosen, dist, sec, rings, moons, resources: getRes(chosen.id, chosen.g, star.cls, rmult) });
    }
    return orbits;
  }

  // ── ПУБЛИЧНЫЙ API ──
  function generate(opts) {
    const o = opts || {};
    const richness = +o.richness || 5;
    seedRng(Math.floor(Math.random() * 0xffffffff));
    const rmult = 0.05 + ((richness - 1) / 9) * 2.15;
    const star = genStar(o.starCls || 'random');
    const orbits = genOrbits(star, rmult);
    const bodies = orbits.map(orb => {
      if (orb.type === 'belt') {
        return { kind: 'belt', g: 'belt', name: orb.bt.name, type: orb.compD + ' · ' + orb.densD, icon: orb.bt.icon,
          zone: ZN[orb.sec], dist: +orb.dist.toFixed(2), slotsP: 0, slotsK: Math.max(1, Math.round(orb.density / 2)),
          rings: 0, moons: 0, resources: orb.resources };
      }
      if (orb.type === 'anomaly') {
        return { kind: 'anomaly', g: 'anomaly', name: orb.planet.name, type: 'Аномалия', icon: orb.planet.i,
          zone: ZN[orb.sec], dist: +orb.dist.toFixed(2), slotsP: 0, slotsK: 0, rings: 0, moons: 0, resources: [] };
      }
      const sl = getSlots(orb.planet);
      // g — ключ климатической группы планеты: нужен редактору для типозависимого
      // реролла ресурсов (rollResources). Экономика поле игнорирует.
      return { kind: 'planet', g: orb.planet.g, name: orb.planet.name, type: GRP[orb.planet.g].name, icon: orb.planet.i,
        zone: ZN[orb.sec], dist: +orb.dist.toFixed(2), slotsP: sl.p, slotsK: sl.k,
        rings: (orb.rings || []).length, moons: (orb.moons || []).length, resources: orb.resources };
    });
    return { star: { cls: star.cls, name: star.sd.name, icon: star.sd.e }, bodies };
  }

  // Ролл ресурсов для ОДНОЙ планеты (для редактора: кнопка «🎲 ресурсы»).
  // group — ключ климатической группы (terrestrial/cryo/…); если не задан или
  // belt/anomaly — катим по всему каталогу. Возвращает массив записей в том же
  // формате, что и генератор: {name, icon, r, rname, amt}. Экономике важны name+r.
  function rollResources(group, starCls, richness) {
    seedRng(Math.floor(Math.random() * 0xffffffff));
    const rmult = 0.05 + (((+richness || 5) - 1) / 9) * 2.15;
    const sc = (starCls && starCls !== 'random') ? starCls : '';
    const useGroup = group && group !== 'belt' && group !== 'anomaly';
    const out = [];
    for (const R of RESOURCES) {
      if (useGroup && !R.g.includes(group)) continue;
      let c = (RB[R.r] || 10) * rmult;
      if (R.stars.length && sc && R.stars.includes(sc)) c = Math.min(97, c + 24);
      if (!ch(c)) continue;
      out.push({ name: R.name, icon: R.icon, r: R.r, rname: rname(R.r), amt: amtDesc(rollDice(R.d, rmult)) });
    }
    return out;
  }
  // ── Персональная ЦЕНА ресурса (ГС/ед) по id ────────────────────────────────
  // Раньше цена была общей по редкости; теперь у каждого ресурса своя ценность.
  // Зеркало в SQL — функция _res_value(name) (см. _migration_res_value.sql) и
  // в economy.js (через GalaxyGen.resPrice). Меняешь тут — синхронь SQL.
  // ⚠ Это БАЗОВЫЙ ЯКОРЬ. С появлением галактического рынка (_market_setup.sql)
  // ЖИВАЯ цена считается на сервере (market_resources) и зеркалится в EC.market;
  // resPrice/RES_PRICE остаются фолбэком и target-ом для возврата к среднему.
  const RB_PRICE = { common: 2, uncommon: 10, rare: 50, epic: 200, legendary: 1200 };
  const RES_PRICE = {
    SILICATE: 1, SULFUR: 2, IRON: 3, CARBON: 3, ICEWATER: 3, METHANE: 4,
    COPPER: 8, AMMONIA: 10, SULFIDES: 12, TITANIUM: 14,
    WATER: 45, URANIUM: 50, ORGANICS: 55, RAREEARTH: 60, DEUTERIUM: 65, PLATINUM: 70, HELIUM3: 80,
    THERMFUEL: 200, DIAMONDS: 220, EXOCRYST: 260,
    QUANTUMCRYST: 1200, DEGENERATE: 1500, NEUTRONMAT: 1600,
  };
  // Цена по имени ресурса; для неизвестных — фолбэк по редкости.
  function resPrice(name) {
    const R = RESOURCES.find(x => x.name === name);
    if (R && RES_PRICE[R.id] != null) return RES_PRICE[R.id];
    return R ? (RB_PRICE[R.r] || 2) : 2;
  }

  // Слим-каталог для ручного выбора в редакторе (без внутренних весов/групп).
  const RES_CATALOG = RESOURCES.map(R => ({ id: R.id, name: R.name, icon: R.icon, r: R.r, rname: rname(R.r), price: (RES_PRICE[R.id] != null ? RES_PRICE[R.id] : RB_PRICE[R.r]) }));
  // Уровни количества (для ручного выбора) — те же, что выдаёт amtDesc.
  const AMT_LEVELS = ['следы', 'мало', 'умеренно', 'много', 'очень много', 'колоссально'];

  // ── Иконки ресурсов (картинки вместо эмодзи) ──────────────────────────────
  // Файлы лежат в RES_ICON_DIR, имя = id ресурса в нижнем регистре + RES_ICON_EXT
  // (например IRON → assets/icons/res/iron.png). Чтобы перейти на svg/webp —
  // поменяй только RES_ICON_EXT. Эмодзи остаётся как фолбэк (alt), если файла нет.
  const RES_ICON_DIR = 'assets/icons/res/';
  const RES_ICON_EXT = '.png';
  const RES_ID_BY_NAME = {}, RES_EMOJI_BY_NAME = {};
  RESOURCES.forEach(R => { RES_ID_BY_NAME[R.name] = R.id; RES_EMOJI_BY_NAME[R.name] = R.icon; });

  // src иконки по имени ресурса (или null, если ресурса нет в каталоге)
  function resIconSrc(name) {
    const id = RES_ID_BY_NAME[name];
    return id ? RES_ICON_DIR + id.toLowerCase() + RES_ICON_EXT : null;
  }
  // Готовый HTML иконки. cls — доп. класс под размер в конкретном месте.
  // Если файла нет — браузер покажет alt (эмодзи), без JS и битых картинок.
  function resIconHtml(name, cls) {
    const c = 'res-ic' + (cls ? ' ' + cls : '');
    const src = resIconSrc(name);
    const emoji = RES_EMOJI_BY_NAME[name] || '◈';
    if (!src) return `<span class="${c} res-ic-emoji">${emoji}</span>`;
    const safe = String(name).replace(/"/g, '&quot;');
    return `<img class="${c}" src="${src}" alt="${emoji}" title="${safe}" loading="lazy" decoding="async">`;
  }
  window.resIconSrc = resIconSrc;
  window.resIconHtml = resIconHtml;
  window.resPrice = resPrice;

  // Каталог «классов планет» для ручной выдачи в редакторе карты и админке.
  // Каждый конкретный мир + его климат-группа (g): по g крутятся ресурсы/слоты.
  // Плюс сами группы как обобщённые классы (в конце списка).
  const PLANET_CLASSES = [
    ...PLANETS.map(p => ({ id: p.id, name: p.name, g: p.g, icon: p.i, group: GRP[p.g] ? GRP[p.g].name : p.g })),
    ...Object.keys(GRP).map(g => ({ id: 'grp_' + g, name: GRP[g].name, g, icon: '', group: GRP[g].name })),
  ];

  // ════════════════════════════════════════════════════════════
  // MULTI — генератор КРАТНЫХ систем (дополнение поверх установленных звёзд).
  // generateMulti({primaryCls, richness}) → { stars:[компаньоны], bodies:[тела компаньонов] }
  // Тела компаньонов помечены star:'B'/'C'/… и готовы к дозаписи в planets[]
  // системы (pid раздаёт редактор через gmAssignPids). Существующие тела НЕ трогаем.
  // ════════════════════════════════════════════════════════════

  const GREEK = ['Альфа', 'Бета', 'Гамма', 'Дельта', 'Эпсилон'];
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];

  // Доля кратных по классу primary (реальная астрофизика: массивные звёзды
  // почти всегда кратные, красные карлики — редко; Дюкенн–Майор, Рагхаван).
  const MULT_FRAC = { O: 85, B: 78, A: 62, F: 52, G: 46, K: 34, M: 26, D: 32, N: 18 };
  // Если кратная: распределение ЧИСЛА компаньонов (1..4 → система из 2..5 звёзд).
  // Иерархия реальна: двойные доминируют, пятерные — экзотика.
  const NCOMP_W = [64, 24, 9, 3];

  // Класс главной последовательности по массе (M☉)
  function clsByMass(m) {
    if (m >= 20) return 'O'; if (m >= 3) return 'B'; if (m >= 1.5) return 'A';
    if (m >= 1.1) return 'F'; if (m >= 0.8) return 'G'; if (m >= 0.5) return 'K';
    return 'M';
  }

  // Компаньон: отношение масс q + шанс мёртвого остатка.
  // q — почти плоское с подъёмом к малым q; «twin excess» (q≈1) у ТЕСНЫХ пар.
  function genCompanion(primary, sepAu) {
    // мёртвые компаньоны: белый карлик у эволюционировавших пар (как Сириус B),
    // пульсар-компаньон — только у массивных primary, очень редко
    if ((primary.cls === 'O' || primary.cls === 'B') && ch(4)) return genStar('N');
    if ('ABFGK'.includes(primary.cls) && ch(7)) return genStar('D');
    let q;
    if (sepAu < 1 && ch(30)) q = 0.82 + rng() * 0.18;           // twin excess
    else q = 0.12 + Math.pow(rng(), 1.4) * 0.88;
    const m = Math.max(0.08, primary.mass * Math.min(q, 1));
    return genStar(clsByMass(m));
  }

  // Иерархические сепарации (а.е.): лог-нормальное ядро (пик ~30-50 а.е. у
  // солнцеподобных, шире у массивных), каждый следующий компонент минимум
  // в ~3.5 раза дальше предыдущего — иначе система динамически развалится.
  function genSeparations(n, primary) {
    const base = primary.mass >= 3 ? 60 : 35;
    // лог-нормаль через сумму: exp(N(ln base, ~1.1))
    const g = () => { let s = 0; for (let i = 0; i < 6; i++) s += rng(); return (s - 3) / 0.7; };
    const seps = [];
    let a = Math.min(4000, Math.max(0.3, base * Math.exp(g() * 1.1)));
    for (let i = 0; i < n; i++) {
      seps.push(+a.toFixed(1));
      a = a * (3.5 + rng() * 4) * (1 + rng());
      if (a > 12000) a = 12000;
    }
    return seps;
  }

  // ── Сфера Хилла ──
  // Массы планет (в массах Земли) по классам/группам — для r_H = a·∛(m/3M★)
  const PMASS_ID = {
    superjup: 900, browndwarf: 8000, gasgiant: 300, jupII: 320, hotjup: 250,
    icegiant: 16, hotnep: 15, mininep: 8, superpuff: 6, gasdwarf: 4,
    superearth: 4, earth: 1, hycean: 3, panth: 2, diamond: 5,
    proto: 0.002, megaast: 0.0002,
  };
  const PMASS_GRP = { gasgiant: 150, icegiant: 15, hotgiant: 120, terrestrial: 1, oceanic: 1.5, desert: 0.5, lava: 0.7, volcanic: 0.8, cryo: 0.4, exotic: 2, micro: 0.001, anomaly: 0 };
  function planetMassEarth(pl) { return PMASS_ID[pl.id] != null ? PMASS_ID[pl.id] : (PMASS_GRP[pl.g] || 0.5); }
  // r_H в а.е.; m — массы Земли, M — массы Солнца (1 M☉ = 333000 M⊕)
  function hillAu(distAu, mEarth, mStarSun) {
    if (!mEarth || !mStarSun) return 0;
    return distAu * Math.cbrt(mEarth / 333000 / (3 * mStarSun));
  }
  // ёмкость по спутникам от r_H (стабильна ~ треть-половина сферы Хилла)
  function hillCap(rh) {
    if (rh > 0.3) return 20; if (rh > 0.08) return 8; if (rh > 0.02) return 4;
    if (rh > 0.005) return 2; if (rh > 0.0012) return 1; return 0;
  }

  // Расширенный каталог спутников (для кратного дополнения): виды с именами.
  const MOON_CLS2 = [
    { id: 'm2_reg_rock', name: 'Каменистая луна', sz: 'S', pg: ['terrestrial', 'desert', 'micro', 'lava', 'volcanic', 'cryo'] },
    { id: 'm2_reg_ice', name: 'Ледяная луна', sz: 'S', pg: ['cryo', 'icegiant', 'gasgiant', 'oceanic'] },
    { id: 'm2_dust', name: 'Пылевой сгусток', sz: 'S', pg: ['lava', 'volcanic', 'desert', 'hotgiant'] },
    { id: 'm2_capt_ast', name: 'Захваченный астероид', sz: 'S', pg: ['gasgiant', 'icegiant', 'hotgiant', 'terrestrial', 'desert', 'micro', 'exotic'] },
    { id: 'm2_io', name: 'Вулканическая луна', sz: 'M', pg: ['gasgiant', 'hotgiant', 'lava', 'volcanic'] },
    { id: 'm2_europa', name: 'Луна с подлёдным океаном', sz: 'M', pg: ['gasgiant', 'icegiant', 'cryo'] },
    { id: 'm2_metal', name: 'Металлическое ядро-луна', sz: 'M', pg: ['lava', 'terrestrial', 'micro', 'exotic'] },
    { id: 'm2_cryovolc', name: 'Криовулканическая луна', sz: 'M', pg: ['icegiant', 'cryo', 'gasgiant'] },
    { id: 'm2_titan', name: 'Титаноподобная (атмосфера)', sz: 'L', pg: ['gasgiant', 'icegiant'] },
    { id: 'm2_ganymede', name: 'Луна-гигант', sz: 'L', pg: ['gasgiant'] },
    { id: 'm2_bigrock', name: 'Крупная каменная луна', sz: 'L', pg: ['gasgiant', 'terrestrial', 'oceanic'] },
    { id: 'm2_capt_dwarf', name: 'Захваченный карлик (тритоноид)', sz: 'L', pg: ['gasgiant', 'icegiant'] },
    { id: 'm2_binary', name: 'Двойник (контактная пара)', sz: 'S', pg: ['micro', 'cryo', 'desert'] },
  ];

  // Спутники v2: количество лимитировано сферой Хилла хоста.
  function genSatellites2(planet, distAu, mStarSun) {
    const rings = [], moons = [];
    if (planet.rings > 0 && ch(planet.rings)) {
      const n = dN(6) <= 4 ? 1 : dN(6) <= 5 ? 2 : 3;
      for (let i = 0; i < n; i++) rings.push(rc(RING_CLS).name);
    }
    const rh = hillAu(distAu, planetMassEarth(planet), mStarSun);
    const cap = Math.min(hillCap(rh), planet.mm || 0);
    if (cap <= 0) return { rings, moons, rh };
    const base = { micro: 8, lava: 8, volcanic: 10, terrestrial: 15, desert: 12, oceanic: 12, cryo: 22, gasgiant: 60, icegiant: 55, hotgiant: 18, exotic: 10 }[planet.g] || 10;
    if (!ch(Math.min(96, base + cap * 4))) return { rings, moons, rh };
    let count;
    if (cap >= 8) count = ri(2, Math.min(7, cap));          // гиганты с большой сферой Хилла — свиты лун
    else { const mr = dN(6); count = mr <= 2 ? 1 : mr <= 4 ? ri(1, 2) : mr === 5 ? dN(3) : ri(1, Math.max(1, Math.round(cap / 2))); }
    count = Math.min(count, cap);
    const maxSz = (rings.length && planet.rings_ex) ? 'M' : 'L';
    const eligible = MOON_CLS2.filter(mc => mc.pg.includes(planet.g) && !(maxSz === 'M' && mc.sz === 'L'));
    if (!eligible.length) return { rings, moons, rh };
    for (let i = 0; i < count; i++) {
      // крупные луны редки: L проходит с даунвейтом
      let mc = rc(eligible);
      if (mc.sz === 'L' && !ch(35)) mc = rc(eligible.filter(x => x.sz !== 'L')) || mc;
      moons.push({ name: mc.name, sz: mc.sz });
    }
    return { rings, moons, rh };
  }

  // ── ПРЕДУСТАНОВЛЕННЫЕ ресурсы (не «крутить», а логичная раскладка) ──
  // Детерминированная логика: common по группе почти всегда; редкие ярусы —
  // только при совпадении и группы/ids, И профиля звезды. Хтонит не появится
  // на криомире у красного карлика — только там, где ему место.
  const PRESET_AMT = { common: ['умеренно', 'много', 'очень много'], uncommon: ['мало', 'умеренно', 'много'], rare: ['мало', 'умеренно'], epic: ['следы', 'мало'], legendary: ['следы'] };
  const PRESET_CH = { common: 88, uncommon: 55, rare: 30, epic: 45, legendary: 55 };
  // зональные запреты: вода/органика — только обитаемая зона, льды — не в пекле
  const ZONE_GATE = { WATER: [2], ORGANICS: [2], ICEWATER: [2, 3, 4], AMMONIA: [3, 4], METHANE: [2, 3, 4] };
  function presetRes(pl, starCls, isBelt, beltIds, sec) {
    const out = [];
    for (const R of RESOURCES) {
      if (sec != null && ZONE_GATE[R.id] && !ZONE_GATE[R.id].includes(sec)) continue;
      const idHit = R.ids.includes(pl && pl.id);
      const gHit = pl && R.g.includes(pl.g);
      const beltHit = isBelt && beltIds && beltIds.includes(R.id);
      if (!idHit && !gHit && !beltHit) continue;
      const starHit = !R.stars.length || R.stars.includes(starCls);
      // rare+ требует профиль звезды; epic/legendary — ещё и точечное попадание
      if ((R.r === 'rare') && !starHit) continue;
      if ((R.r === 'epic' || R.r === 'legendary') && (!starHit || !(idHit || beltHit))) continue;
      let c = PRESET_CH[R.r];
      if (R.stars.length && starHit) c += 22;
      if (idHit) c += 25;
      if (!ch(Math.min(97, c))) continue;
      const lv = PRESET_AMT[R.r]; const amt = lv[ri(0, lv.length - 1)];
      out.push({ name: R.name, icon: R.icon, r: R.r, rname: rname(R.r), amt });
    }
    return out;
  }

  // Орбиты компаньона: как genOrbits, но обрезаны пределом устойчивости
  // (S-тип: планеты живут внутри ~четверти расстояния до соседней звезды,
  // упрощённый Холман–Виггерт) + спутники по Хиллу + ресурсы presetRes.
  function genOrbitsMulti(star, limitAu) {
    let dist = Math.max(0.05, 0.1 * Math.sqrt(star.L));
    const orbits = []; let hasEarth = false, hasHotJup = false, gg = 0, iceDone = false;
    for (let i = 0; i < star.orbits; i++) {
      dist *= (1.35 + rng() * 0.45);
      if (dist > limitAu) break;                       // предел устойчивости
      const T = 278 * Math.pow(star.L, .25) * Math.sqrt(1 / dist);
      const sec = getSec(T); const isLast = (i === star.orbits - 1) || (dist * 1.6 > limitAu);
      if (!iceDone && (sec === 3 || sec === 4)) { iceDone = true; if (ch(55)) { orbits.push({ type: 'belt', dist, sec, bt_id: 'main' }); continue; } }
      if (isLast && sec >= 3 && ch(70)) { orbits.push({ type: 'belt', dist, sec, bt_id: 'kuiper' }); continue; }
      if (sec === 0 && ch(14)) { orbits.push({ type: 'belt', dist, sec, bt_id: 'vulcanoid' }); continue; }
      let pool = PLANETS.filter(p => !p.anomaly && p.s.includes(sec));
      pool = pool.filter(p => { if (p.unique === 'earth' && hasEarth) return false; if (p.unique === 'hotjup' && hasHotJup) return false; if (p.gasGiant && gg >= 2) return ch(8); return true; });
      if (!pool.length) pool = [PLANETS.find(p => p.id === 'proto')];
      const tw = pool.reduce((a, p) => a + (p.w || 5), 0); let r = rng() * tw, cum = 0, chosen = pool[0];
      for (const p of pool) { cum += (p.w || 5); if (r < cum) { chosen = p; break; } }
      if (chosen.unique === 'earth') hasEarth = true; if (chosen.unique === 'hotjup') hasHotJup = true; if (chosen.gasGiant) gg++;
      orbits.push({ type: 'planet', planet: chosen, dist, sec });
    }
    return orbits;
  }

  // Главный вход дополнения. primaryCls — класс УЖЕ установленной звезды
  // (неизвестен/кастомный → считаем G). Возвращает компаньонов и их тела.
  function generateMulti(opts) {
    const o = opts || {};
    seedRng(o.seed != null ? (o.seed >>> 0) : Math.floor(Math.random() * 0xffffffff));
    const pCls = STARS[o.primaryCls] ? o.primaryCls : 'G';
    const primary = genStar(pCls);
    // сколько компаньонов
    if (!(o.force) && !ch(MULT_FRAC[pCls] != null ? MULT_FRAC[pCls] : 45)) return { stars: [], bodies: [] };
    let nc = 1; { const tot = NCOMP_W.reduce((a, b) => a + b, 0); let r = rng() * tot, cum = 0; for (let i = 0; i < NCOMP_W.length; i++) { cum += NCOMP_W[i]; if (r < cum) { nc = i + 1; break; } } }
    const seps = genSeparations(nc, primary);
    const stars = [], bodies = [];
    for (let i = 0; i < nc; i++) {
      const sep = seps[i];
      const comp = genCompanion(primary, sep);
      const letter = LETTERS[i + 1] || 'E';
      // предел устойчивости планетной системы компаньона:
      // ближе соседа — предыдущий компонент или primary
      const gapIn = i === 0 ? sep : (sep - seps[i - 1]);
      const gapOut = (i + 1 < nc) ? (seps[i + 1] - sep) : Infinity;
      const limit = Math.max(0, Math.min(gapIn, gapOut) * 0.25);
      stars.push({ letter, greek: GREEK[i + 1] || 'Эпсилон', cls: comp.cls, name: comp.sd.name, icon: comp.sd.e, mass: +comp.mass.toFixed(2), sep_au: sep, dead: !!comp.sd.dead });
      if (limit < 0.15 || comp.sd.dead && limit < 0.3) continue;   // тесная пара — планет нет
      const orbits = genOrbitsMulti(comp, limit);
      for (const orb of orbits) {
        if (orb.type === 'belt') {
          const b = rollBelt(orb.bt_id, comp.cls, 1);
          // состав ресурсов — по ТОМУ ЖЕ композиционному типу, что показан у пояса
          const compKey = +Object.keys(BCOMP).find(k => BCOMP[k] === b.compD) || 4;
          const beltRes = presetRes(null, comp.cls, true, BRES[compKey], orb.sec);
          bodies.push({ kind: 'belt', g: 'belt', star: letter, name: b.bt.name, type: b.compD + ' · ' + b.densD, icon: b.bt.icon,
            zone: ZN[orb.sec], dist: +orb.dist.toFixed(2), slotsP: 0, slotsK: Math.max(1, Math.round(b.density / 2)),
            rings: 0, moons: 0, resources: beltRes.length ? beltRes : b.resources });
          continue;
        }
        const pl = orb.planet;
        const sat = genSatellites2(pl, orb.dist, comp.mass);
        const sl = getSlots(pl);
        bodies.push({ kind: 'planet', g: pl.g, star: letter, name: pl.name, type: GRP[pl.g].name, icon: pl.i,
          zone: ZN[orb.sec], dist: +orb.dist.toFixed(2), slotsP: sl.p, slotsK: sl.k,
          rings: sat.rings.length, ringsL: sat.rings, moons: sat.moons.length, moonsL: sat.moons,
          hillAu: +(sat.rh || 0).toFixed(4), resources: presetRes(pl, comp.cls, false, null, orb.sec) });
      }
    }
    return { stars, bodies };
  }

  window.GalaxyGen = {
    generate, getSlots, rollResources, resPrice,
    RESOURCES: RES_CATALOG, AMT_LEVELS, resIconHtml, resIconSrc,
    STAR_CLASSES: ['random', 'O', 'B', 'A', 'F', 'G', 'K', 'M', 'D', 'N'],
    PLANET_CLASSES,
    generateMulti, GREEK, STAR_LETTERS: LETTERS,
  };
})();
