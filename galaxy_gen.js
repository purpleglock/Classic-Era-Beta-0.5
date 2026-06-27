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

  window.GalaxyGen = {
    generate, getSlots, rollResources, resPrice,
    RESOURCES: RES_CATALOG, AMT_LEVELS, resIconHtml, resIconSrc,
    STAR_CLASSES: ['random', 'O', 'B', 'A', 'F', 'G', 'K', 'M', 'D', 'N'],
    PLANET_CLASSES,
  };
})();
