// ════════════════════════════════════════════════════════════
// ДОЗВЁЗДНЫЕ · ПОСУТОЧНЫЙ ШАГ  (лор: lore/precursor_memory.md, этап 1 §20)
//
//   PrecursorSim.anchor(civ)              → якорь: надломы, седмицы, начальное русло
//   PrecursorSim.state(civ, journal, day) → состояние державы на сутки `day`
//
// Чистая функция: ноль сети, ноль БД, ноль Math.random(). Всё случайное —
// от hash(seed‖повод‖сутки), одной формулой на обеих сторонах (§19).
// state(t) = f(seed, spawn_at, now, журнал) — путь к нему не важен, важен журнал.
//
// ГОЛОС (§0): в коде латиница, в тексте для игрока — только летописное слово.
// Ни «травмы», ни «психики», ни «терапии»: надлом, набат, устой, уговор, вира.
// ════════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PrecursorSim = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // ── детерминированный ГПСЧ (зеркало precursor_gen.js) ─────
  function hash32(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // одно число из повода — без последовательного состояния (§19)
  function h01(seed, tag) { return (hash32(seed + '|' + tag) >>> 0) / 4294967296; }
  function hInt(seed, tag, n) { return Math.floor(h01(seed, tag) * n) % n; }
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // ══════════════════════════════════════════════════════════
  // СЛОВАРЬ
  // ══════════════════════════════════════════════════════════

  // §4.3 — крючки. Список конечен и виден в досье: это и есть интерфейс осторожности.
  const HOOKS = ['небо', 'голод', 'увод', 'чужой', 'мор', 'раскол', 'земля', 'святилище', 'слово', 'тишина', 'седмица'];

  const KIND = { OFFENCE: 'обида', DEBT: 'долг', LOSS: 'утрата' };
  const STATE = { OLD: 'затянувшийся', OPEN: 'вскрытый', LIVED: 'изжитый', FALSE: 'переписанный' };
  const BAND = { EMERG: 'чрезвычайщина', FLOW: 'русло', STALL: 'застой' };
  const SIDE = { KEEP: 'Хранители', CAST: 'Отверженные', RIOT: 'Смутьяны' };
  const SKY = { PILLAR: 'опора', FAR: 'далёкое', FICKLE: 'капризное', TWOFACE: 'двуликое', NONE: 'нет' };

  // Карта ветвления → надлом. Не всякая карта — беда: золотой век ран не оставляет.
  // base — глубина ДО правила дозы (§4.2).
  const CARD_WOUND = {
    // ── удар сверху и контакт ──
    skyfall:   { hook: 'небо',  kind: KIND.LOSS,    base: 30 },
    abduct:    { hook: 'увод',  kind: KIND.LOSS,    base: 42 },
    skywatch:  { hook: 'небо',  kind: KIND.OFFENCE, base: 22 },
    orbitjunk: { hook: 'небо',  kind: KIND.OFFENCE, base: 16 },
    ruinguest: { hook: 'чужой', kind: KIND.OFFENCE, base: 20 },
    forbidden: { hook: 'чужой', kind: KIND.OFFENCE, base: 18 },
    luddite:   { hook: 'чужой', kind: KIND.OFFENCE, base: 26 },
    // ── беды самой планеты ──
    plague:    { hook: 'мор',   kind: KIND.LOSS,    base: 40 },
    twinmoon:  { hook: 'голод', kind: KIND.LOSS,    base: 34 },
    famine:    { hook: 'голод', kind: KIND.LOSS,    base: 38 },
    quake:     { hook: 'земля', kind: KIND.LOSS,    base: 32 },
    flood:     { hook: 'земля', kind: KIND.LOSS,    base: 30 },
    greengrave:{ hook: 'земля', kind: KIND.LOSS,    base: 28 },
    energyfade:{ hook: 'мор',   kind: KIND.LOSS,    base: 34 },
    longnight: { hook: 'голод', kind: KIND.LOSS,    base: 24 },
    // ── раскол ──
    schism:      { hook: 'раскол', kind: KIND.OFFENCE, base: 30 },
    netschism:   { hook: 'раскол', kind: KIND.OFFENCE, base: 28 },
    synthschism: { hook: 'раскол', kind: KIND.OFFENCE, base: 26 },
    holywar:     { hook: 'раскол', kind: KIND.DEBT,    base: 34 },
    scentwar:    { hook: 'раскол', kind: KIND.OFFENCE, base: 22 },
    ventwar:     { hook: 'земля',  kind: KIND.OFFENCE, base: 24 },
    guildwar:    { hook: 'раскол', kind: KIND.OFFENCE, base: 18 },
    // ── державы с долгом (§12): сделали сами, и это иная рана ──
    hivesplit:  { hook: 'раскол', kind: KIND.DEBT, base: 44 },
    avianexile: { hook: 'увод',   kind: KIND.DEBT, base: 46 },
    seedwar:    { hook: 'земля',  kind: KIND.DEBT, base: 42 },
    eugenpurge: { hook: 'слово',  kind: KIND.DEBT, base: 52 },
    anthropo:   { hook: 'голод',  kind: KIND.DEBT, base: 48 },
    slavestate: { hook: 'увод',   kind: KIND.DEBT, base: 44 },
    packlaw:    { hook: 'увод',   kind: KIND.DEBT, base: 30 },
    castebreed: { hook: 'слово',  kind: KIND.DEBT, base: 38 },
    vacuumcaste:{ hook: 'слово',  kind: KIND.DEBT, base: 34 },
    debtjail:   { hook: 'слово',  kind: KIND.DEBT, base: 26 },
    deathind:   { hook: 'слово',  kind: KIND.DEBT, base: 40 },
    earlynuke:  { hook: 'земля',  kind: KIND.DEBT, base: 50 },
    worldwar:   { hook: 'слово',  kind: KIND.DEBT, base: 40 },
    mindctl:    { hook: 'слово',  kind: KIND.DEBT, base: 32 },
    printban:   { hook: 'слово',  kind: KIND.OFFENCE, base: 20 },
    icefast:    { hook: 'голод',  kind: KIND.DEBT, base: 22 },
    waterlords: { hook: 'голод',  kind: KIND.DEBT, base: 24 },
    narcoempire:{ hook: 'слово',  kind: KIND.DEBT, base: 24 },
    moralfall:  { hook: 'слово',  kind: KIND.LOSS, base: 18 },
  };
  // Чего в таблице нет — берётся по группе карты; boon/sci/law-без-крови ран не оставляют.
  const GRP_WOUND = {
    shock:   { hook: 'земля', kind: KIND.LOSS,    base: 28 },
    dark:    { hook: 'слово', kind: KIND.DEBT,    base: 36 },
    war:     { hook: 'слово', kind: KIND.OFFENCE, base: 26 },
    contact: { hook: 'чужой', kind: KIND.OFFENCE, base: 24 },
    void:    { hook: 'небо',  kind: KIND.OFFENCE, base: 14 },
    mind:    { hook: 'слово', kind: KIND.DEBT,    base: 28 },
  };

  // Тихие надломы — то, что случилось без карты и без вас (§14.2).
  // Пул подбирается по классу мира: у вулкана трясёт, в океане топит.
  const QUIET = [
    { id: 'мор',        hook: 'мор',    kind: KIND.LOSS,    base: 30, w: 10 },
    { id: 'голод',      hook: 'голод',  kind: KIND.LOSS,    base: 28, w: 12 },
    { id: 'усобица',    hook: 'раскол', kind: KIND.OFFENCE, base: 26, w: 10 },
    { id: 'нашествие',  hook: 'слово',  kind: KIND.OFFENCE, base: 30, w: 8 },
    { id: 'чистка',     hook: 'слово',  kind: KIND.DEBT,    base: 38, w: 6 },
    { id: 'угон',       hook: 'увод',   kind: KIND.DEBT,    base: 34, w: 6 },
    { id: 'трус',       hook: 'земля',  kind: KIND.LOSS,    base: 26, w: 8, env: ['volcanic', 'lava'] },
    { id: 'потоп',      hook: 'земля',  kind: KIND.LOSS,    base: 26, w: 8, env: ['oceanic', 'terrestrial'] },
    { id: 'засуха',     hook: 'голод',  kind: KIND.LOSS,    base: 28, w: 8, env: ['desert', 'terrestrial'] },
    { id: 'стужа',      hook: 'голод',  kind: KIND.LOSS,    base: 26, w: 8, env: ['cryo'] },
    { id: 'разгерметизация', hook: 'земля', kind: KIND.LOSS, base: 30, w: 8, env: ['micro'] },
    { id: 'помрачение', hook: 'чужой',  kind: KIND.LOSS,    base: 24, w: 6, env: ['exotic'] },
  ];

  // Кто несёт надлом (§9): вина — Хранителям, утрата — Отверженным, обида — Смутьянам.
  const OWNER_BY_KIND = { [KIND.DEBT]: SIDE.KEEP, [KIND.LOSS]: SIDE.CAST, [KIND.OFFENCE]: SIDE.RIOT };

  // ── решения журнала ────────────────────────────────────────
  // Каждое: {d: сутки, act, ...}. `reg` — образ появления (§7.1).
  const REG = { SIGN: 'знамение', THEIRS: 'их словом', QUIET: 'тихо' };

  // Какие крючки жмёт действие само по себе (до образа).
  const ACT_HOOKS = {
    study:    ['тишина', 'мор'],
    gift:     [],
    answer:   [],
    lesson:   ['небо'],
    harvest:  ['голод'],
    enslave:  ['увод'],
    convert:  ['раскол', 'чужой'],
    outpost:  ['земля'],
    mine:     ['земля'],
    breach:   ['святилище', 'небо', 'земля'],
    forge:    ['слово'],          // подлог: чужая рука в их священной истории
    sample:   ['мор'],
  };
  // Что действие делает с уговором и русло-величинами напрямую.
  const ACT = {
    // ── §8.1 покой ──
    hush:    { alarm: -0.0, keepDays: 1, still: true },     // тишина в небе: обязательство, работает временем
    ward:    { alarm: -6, accord: +6 },                     // отвод беды
    abstain: { alarm: -3, accord: +3, still: true },        // карантин находки
    leave:   { alarm: -14, accord: 0, still: true },        // уйти совсем
    // ── §8.2 ритм ──
    answer:  { accord: +8, well: +4 },                      // отклик на сказанное (§6)
    answer2: { accord: +12, well: +6, alarm: -5 },          // отклик на настоящее
    year:    { stead: +5, accord: +4 },                     // круг года
    work:    { stead: +8, accord: +5, unstall: true },      // общее дело
    feast:   { stead: +4, alarm: -4, accord: +3 },          // праздник
    gift:    { well: +8, accord: +2, feed: +6, alarm: +2 }, // дар: остаётся и становится опасным
    order:   { grit: +2, feed: -8, stead: +2 },             // §8.4 устроение
    // ── §7.5 ──
    ack:     { accord: +6, debtDown: 4 },                   // признать
    // ── §11 слово ──
    trial:   { alarm: -12, stead: +10 },                    // суд памяти
    // §9.2: держава, где заговорили молчавшие, на время становится хуже — и это норма
    record:  { cast: +12, alarm: +6 },                      // внести в летопись
    vira:    { alarm: -8, stead: +6 },                      // вира
    forge:   { accord: +30, alarm: -10, stead: +4 },        // подлог
    // ── §13 тёмное ──
    numb:    { alarm: -25, grit: -3, well: +6, feed: +10 }, // тихая мера
    lesson:  { alarm: +22, well: -10, accord: -18 },
    harvest: { well: -12, alarm: +8, accord: -8, feed: +4 },
    enslave: { well: -20, alarm: +18, accord: -25 },
    breach:  { alarm: +30, well: -14, accord: -30 },        // §17 вскрытие святилищ
    convert: { alarm: +6, accord: -4 },
    outpost: { alarm: +5, accord: -3 },
    mine:    { alarm: +6, well: -4, accord: -4 },
    study:   { alarm: +3, accord: -2 },                     // §7.3 молчащее небо
    sample:  { alarm: +5, accord: -4 },
  };
  // Действия, которые считаются «откликом»: по ним меряется регулярность (§7.2).
  const CARING = ['answer', 'answer2', 'year', 'work', 'feast', 'gift', 'order', 'ward', 'trial', 'record', 'vira', 'ack'];
  const CRUEL  = ['lesson', 'harvest', 'enslave', 'breach', 'sample'];

  // §6 — нужда в двух слоях: сказано / на деле.
  const NEEDS = [
    { id: 'голод',  said: 'зерна',   real: 'порядок раздачи',        hook: 'голод' },
    { id: 'война',  said: 'оружия',  real: 'посредника',             hook: 'раскол' },
    { id: 'мор',    said: 'лекаря',  real: 'право хоронить',         hook: 'мор' },
    { id: 'раскол', said: 'чуда',    real: 'признать правоту меньших', hook: 'раскол' },
    { id: 'немота', said: 'ничего, молчат', real: 'чтобы спросили',  hook: 'тишина' },
  ];

  // ══════════════════════════════════════════════════════════
  // ЯКОРЬ: что у державы было ДО вас (§14.2)
  // ══════════════════════════════════════════════════════════

  function woundOf(cardId, cards) {
    if (CARD_WOUND[cardId]) return CARD_WOUND[cardId];
    const c = cards && cards.find(x => x.id === cardId);
    return (c && GRP_WOUND[c.grp]) || null;
  }

  // weight = base × (1 + 1.6×(11−phase)/11) × (1 + 0.25×уже_имеющихся)   §4.2
  // Накопление ограничено: без потолка пятый надлом любой глубины упирался в 100,
  // и «держава ломается от четвёртого сильнее» превращалось в «все одинаково сломаны».
  // BASE_SCALE: множители §4.2 дают до ×4.5 — база должна оставлять им место,
  // иначе всё тяжелее лёгкой обиды упирается в потолок и глубина перестаёт значить.
  const BASE_SCALE = 0.5;
  function dose(base, phase, already) {
    const acc = Math.min(1 + 0.25 * already, 1.75);
    return clamp(Math.round(base * BASE_SCALE * (1 + 1.6 * (11 - phase) / 11) * acc), 1, 100);
  }

  function anchor(civ, opts) {
    opts = opts || {};
    const cards = opts.cards || (typeof window !== 'undefined' && window.Precursors ? window.Precursors.CARDS : null);
    const seed = String(civ.seed || 'v1') + ':' + civ.system_id + ':' + civ.pid;
    const wounds = [];

    // 1. Карты ветвления, которые в летописи уже лежат. Фаза — из записи летописи.
    const phaseOf = {};
    (civ.chronicle || []).forEach(e => { if (e.scar) phaseOf[e.scar] = phIndex(e.ph); });
    (civ.scars || []).forEach(id => {
      const w = woundOf(id, cards);
      if (!w) return;
      const ph = phaseOf[id] != null ? phaseOf[id] : clamp(civ.phase - 2, 0, 11);
      wounds.push(mkWound(seed, 'card:' + id, id, w, ph, wounds.length, civ));
    });

    // 2. Добор тихими: держава несёт 3–7 надломов, и большинство — не от вас.
    const want = 3 + hInt(seed, 'wcount', 5);
    let guard = 0;
    while (wounds.length < want && guard++ < 24) {
      const tag = 'quiet' + wounds.length + ':' + guard;
      const pool = QUIET.filter(q => !q.env || q.env.includes(civ.env));
      const pick = pickW(pool, q => q.w, h01(seed, tag));
      if (!pick) break;
      if (wounds.some(w => w.src === pick.id)) continue;
      // Беду помнят ближнюю: тихий надлом ложится в последние эпохи, а не поровну
      // по всей истории — иначе у державы на Пороге всё детство в ранах.
      const ph = clamp(civ.phase - hInt(seed, tag + ':ph', 6), 0, 11);
      wounds.push(mkWound(seed, tag, pick.id, pick, ph, wounds.length, civ));
    }

    // 3. Чёрные седмицы: до трёх на год, и это их календарь, а не наш (§4.4).
    // Дату получают самые тяжёлые, а не превысившие абсолютный порог: у державы
    // на Пороге веса вдвое ниже по правилу дозы, и с общим порогом её год оставался
    // бы без единой чёрной седмицы — то есть механика для поздних миров была бы мертва.
    const weeks = [];
    wounds.slice().sort((x, y) => y.weight - x.weight).forEach(w => {
      if (weeks.length >= 3 || w.weight < 20) { w.date = null; return; }
      weeks.push(w.date);
    });

    // 4. Начальное русло. Считаем по ГЛУБИНЕ надломов, а не по их сумме: держава
    //    с пятью затянувшимися бедами живёт, а не горит. Горит — от вскрытых.
    const load = wounds.length ? wounds.reduce((s, w) => s + w.weight, 0) / wounds.length : 0;
    const openN = wounds.filter(w => w.state === STATE.OPEN).length;
    const alarm = clamp(Math.round(8 + load * 0.34 + openN * 11 - (civ.wellbeing - 50) * 0.25), 0, 100);
    const stead = clamp(Math.round(48 + (civ.wellbeing - 50) * 0.5 + civ.phase * 1.6 - load * 0.28 - openN * 6), 0, 100);
    const grit  = clamp(Math.round(12 + civ.phase * 1.6 + (civ.wellbeing - 50) * 0.16 - wounds.length * 0.8), 10, 60);

    return {
      seed, spawn_phase: civ.phase, env: civ.env, tier: civ.tier,
      phase0: civ.phase,              // фаза в день постановки якоря — от неё считаем ход
      roadmap: (civ.roadmap || []),   // будущее вычисляется, а не хранится колонкой (§19)
      wounds, weeks,
      base: { alarm, stead, grit, accord: 0, feed: 0, debt: 0 },
      forces: { keep: clamp(40 + civ.phase * 2, 0, 100), cast: clamp(20 - civ.phase, 0, 100), riot: clamp(15 + Math.round(load * 0.1), 0, 100) },
      ruins: civ.ruins,
    };
  }

  // Один надлом. Всё, кроме глубины, — от повода: два мира с одним набором карт
  // расходятся навсегда только из-за порядка выпадения (§4.2).
  function mkWound(seed, tag, src, w, phase, already, civ) {
    const weight = dose(w.base, phase, already);
    const r = h01(seed, tag + ':st');
    return {
      src,
      kind: w.kind,
      hook: w.hook,
      phase,
      weight,
      // Свежая глубокая беда может застать державу уже вскрытой; прочее осело в уклад.
      state: (weight >= 60 && phase >= civ.phase - 1 && r < 0.35) ? STATE.OPEN : STATE.OLD,
      thresh: clamp(30 - Math.round(weight * 0.2), 6, 30),   // ниже порог — легче вскрыть
      woke: 0,
      wokeAt: -999,
      mute: 1 + hInt(seed, tag + ':mute', weight >= 50 ? 3 : 2),  // сколько записей летописи съел
      owner: OWNER_BY_KIND[w.kind] || SIDE.KEEP,
      date: hInt(seed, tag + ':date', YEAR),                 // их дата, §4.4
    };
  }

  function phIndex(ph) {
    if (!ph || ph === '—' || ph === '★') return 0;
    const n = parseInt(String(ph).replace(/[^0-9]/g, ''), 10);
    return isNaN(n) ? 0 : clamp(n, 0, 11);
  }
  function pickW(arr, wf, r) {
    if (!arr || !arr.length) return null;
    const tot = arr.reduce((s, x) => s + wf(x), 0);
    let t = r * tot;
    for (const x of arr) { t -= wf(x); if (t <= 0) return x; }
    return arr[arr.length - 1];
  }

  // ══════════════════════════════════════════════════════════
  // ЛЕТОПИСЬ (§10): умолчание — не пустота, а обломок
  // ══════════════════════════════════════════════════════════

  // Строка не на своём месте, без даты. Чего именно «с тех пор» — не написано.
  const MUTE = [
    '…и с тех пор в этом месяце не поют.',
    '…в том году перестали давать это имя детям.',
    '…с той поры на восточную дорогу не ходят, и никто не помнит запрета.',
    '…здесь запись обрывается; следующая начата другой рукой.',
    '…и было решено больше не считать эти годы.',
    '…о том, кто ушёл первым, в летописи не сказано.',
    '…дальше лист вырезан ровно, ножом, а не временем.',
    '…и старшие велели забыть, и забыли, а запрет остался.',
    '…в этот день не судят и не женятся, причины не приводят.',
    '…им нечем было это сказать.',
  ];

  // Летопись как её видит игрок: прожитое + умолчания + записи-надломы,
  // которые стоят в настоящем времени и не сглаживаются никогда.
  function chronicleOf(civ, a) {
    a = a || anchor(civ);
    const src = (civ.chronicle || []).map((e, i) => Object.assign({ i }, e));
    const out = src.slice();
    const seed = a.seed;

    a.wounds.forEach((w, k) => {
      // куда лёг надлом: ищем запись его фазы, иначе ставим по номеру фазы
      const at = out.findIndex(e => phIndex(e.ph) === w.phase);
      const pos = at >= 0 ? at : clamp(w.phase, 0, out.length);

      if (w.state === STATE.LIVED) {
        // §11.1 умолчания заполняются ЗАДНИМ ЧИСЛОМ — их словами, из seed
        out.splice(pos + 1, 0, {
          ph: '—', wound: w.src, filled: true,
          text: 'Теперь об этом можно рассказать целиком, и рассказ имеет конец.',
        });
        return;
      }
      // §10 умолчание съедает записи: их не «нет», они обломки
      const eat = Math.min(w.mute || 1, 2);
      for (let n = 0; n < eat; n++) {
        const at2 = pos + n;
        if (at2 < 0 || at2 >= out.length) break;
        // последнюю запись не трогаем: у державы должно остаться «сегодня»,
        // и умолчаний не может быть больше трети летописи — иначе это не летопись
        if (at2 === out.length - 1) break;
        if (out[at2].mute || out[at2].scar) continue;
        if (out.filter(e => e.mute).length >= Math.max(1, Math.floor(out.length / 3))) break;
        // обломок не должен повторяться дословно: два одинаковых умолчания
        // читаются как опечатка, а не как умолчание
        const free = MUTE.filter(t => !out.some(e => e.text === t));
        const bank = free.length ? free : MUTE;
        const t = bank[hInt(seed, 'mute:' + k + ':' + n + ':' + w.src, bank.length)];
        out[at2] = { ph: out[at2].ph, mute: true, wound: w.src, text: t };
      }
      // сама запись-надлом: настоящее время, и это должно выбиваться глазом
      if (w.state === STATE.OPEN) {
        out.splice(clamp(pos + eat, 0, out.length), 0, {
          ph: PHASES_ID[w.phase] || '—', wound: w.src, open: true,
          text: 'Это происходит сейчас. Так пишут не о прошлом.',
        });
      }
    });
    return out;
  }
  const PHASES_ID = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11'];

  // ══════════════════════════════════════════════════════════
  // ПОСУТОЧНЫЙ ШАГ
  // ══════════════════════════════════════════════════════════

  const YEAR = 52;   // их год в неделях — то же деление, что у чёрных седмиц

  function state(civ, journal, day, opts) {
    const a = (opts && opts.anchor) || anchor(civ, opts);
    const seed = a.seed;
    // opts.from — сутки, с которых журнал вообще считается. Нужен ровно для того,
    // для чего на сервере стоит `anchor_at` в _pc_calm: действия, сделанные до
    // появления модели, жили по другим правилам и задним числом не судятся.
    const from = (opts && opts.from) || 0;
    const log = (journal || []).filter(e => e.d >= from).slice().sort((x, y) => x.d - y.d);

    // рабочая копия надломов
    const W = a.wounds.map(w => Object.assign({}, w));
    let alarm = a.base.alarm, stead = a.base.stead, grit = a.base.grit;
    let accord = 0, feed = 0, debt = 0;      // уговор, кормление, счёт
    let forces = Object.assign({}, a.forces);
    let contacted = false, lastCare = null, streak = 0, gap = 0;
    let hitCount = 0, saveCount = 0, careCount = 0, missCount = 0;
    let hushUntil = -1, breaches = 0, taken = 0, faked = 0, prog = 0;
    const events = [];                        // то, что попадёт в летопись
    let idx = 0;

    for (let d = 0; d <= day; d++) {
      // ── 1. решения этого дня ──
      while (idx < log.length && log[idx].d === d) {
        const e = log[idx++];
        applyAct(e, d);
        // Наблюдение державу о вас не извещает: пока не показались — вас нет.
        if (e.act !== 'study' || e.reg === REG.SIGN) contacted = true;
      }

      // ── 2. чёрная седмица: надлом вскрывается сам, без повода извне (§4.4) ──
      if (d % 7 === 0) {
        const week = Math.floor(d / 7) % YEAR;
        W.forEach(w => {
          if (w.date === week && w.state === STATE.OLD) wake(w, 'седмица', d);
          if (w.date === week && w.state === STATE.FALSE && h01(seed, 'crack' + w.src + week) < 0.06) collapseForgery(d);
        });
      }

      // ── 3. набат падает ТОЛЬКО от времени без крючков (§8.1). Купить покой нельзя. ──
      // Не линейный рост, а тяга к тому уровню, который держава заслужила: иначе
      // за год любая история упирается в 100 и все миры становятся одинаковыми.
      const open = W.filter(w => w.state === STATE.OPEN);
      const load = W.length ? W.reduce((s, w) => s + Math.abs(w.weight) * (w.state === STATE.LIVED ? 0 : 1), 0) / W.length : 0;
      const aimA = clamp(6 + load * 0.45 + open.length * 16 - (d <= hushUntil ? 10 : 0), 0, 100);
      const aimS = clamp(58 + grit * 0.35 - load * 0.28 - open.length * 14 - (a.numbed ? 22 : 0), 0, 100);
      alarm += (aimA - alarm) * (alarm > aimA ? 0.020 : 0.055);   // тревога встаёт быстро, оседает долго
      stead += (aimS - stead) * (a.numbed ? 0.008 : 0.016);

      // ── 4. уговор тает от тишины ПОСЛЕ начатого (§7.2) ──
      // Штраф идёт не за паузу вообще, а за паузу СВЕРХ взятого ритма: помогать
      // раз в две недели — это ритм, а не пропажа.
      if (contacted && lastCare != null) {
        gap = d - lastCare;
        if (gap > 14 && (gap - 14) % 10 === 0) accord -= 6;
        if (gap === 45 && streak >= 3) { accord -= 14; missCount++; streak = 0; }   // «начать и бросить»
      }

      // ── 5. вскрытый надлом сам себя углубляет, затянувшийся — оседает в уклад ──
      W.forEach(w => {
        if (w.state === STATE.OPEN && d - w.wokeAt > 45 && alarm < aimA + 6) w.state = STATE.OLD;
      });

      // ── 6. силы державы: каждая защищает, и ни одна не бесплатна (§9) ──
      const band0 = bandOf(alarm, stead, grit);

      // ── ход истории: одна запись роадмапа = неделя, но темп задаёт русло (§5).
      // Крон для этого больше не нужен: фаза — такая же функция времени, как набат.
      prog += (band0 === BAND.EMERG ? 1.4 : band0 === BAND.STALL ? 0.3 : 1) / 7;
      if (band0 === BAND.EMERG) { forces.riot += 0.35; forces.keep -= 0.1; }
      else if (band0 === BAND.STALL) { forces.keep += 0.25; forces.cast -= 0.15; }
      // §9.2 Отверженные растут ТОЛЬКО от слова: само собой изгнание не кончается
      else { forces.keep += 0.05; forces.riot -= 0.12; }
      if (W.some(w => w.kind === KIND.DEBT && w.state !== STATE.LIVED)) forces.riot += 0.08;  // §12

      alarm = clamp(alarm, 0, 100); stead = clamp(stead, 0, 100);
      forces.keep = clamp(forces.keep, 0, 100);
      forces.cast = clamp(forces.cast, 0, 100);
      forces.riot = clamp(forces.riot, 0, 100);
      accord = clamp(accord, -50, ceilOf(skyOf()));
    }

    // ── функции шага ──────────────────────────────────────────
    function applyAct(e, d) {
      const A = ACT[e.act] || {};
      const reg = e.reg || REG.THEIRS;

      // §7.1 образ появления важнее содержания
      let mul = 1, extraHooks = [];
      if (reg === REG.SIGN) { mul = 1.15; extraHooks = ['небо', 'чужой']; }
      else if (reg === REG.THEIRS) { mul = accord >= 25 ? 1.35 : 0.8; }
      else if (reg === REG.QUIET) { mul = 0; }   // уговора не растит вовсе — и не вскрывает

      if (A.alarm) alarm += A.alarm;
      if (A.stead) stead += A.stead;
      // благополучие и деньги остаются на сервере — здесь только русло (§19)
      if (A.grit) grit = clamp(grit + A.grit, 10, 60);
      if (A.feed) feed = clamp(feed + A.feed, 0, 100);
      if (A.accord) accord += A.accord * (A.accord > 0 ? mul : 1);
      if (A.debtDown) debt = Math.max(0, debt - A.debtDown);
      if (A.still) hushUntil = d + (e.days || 14);
      if (A.unstall && bandOf(alarm, stead, grit) === BAND.STALL) stead += 6;
      if (A.cast) forces.cast = clamp(forces.cast + A.cast, 0, 100);

      // регулярность: важен не безошибочный, а вернувшийся
      if (CARING.includes(e.act)) {
        const back = lastCare != null && d - lastCare <= 14;
        if (back) { streak++; if (streak > 3) accord += Math.min(12, 4 * (streak - 3)); }
        else if (lastCare != null && d - lastCare > 45 && (e.act === 'gift')) accord -= 10;  // рывок
        lastCare = d; careCount++; saveCount += (e.act === 'ward' || e.act === 'answer2') ? 1 : 0;
      }
      if (CRUEL.includes(e.act)) { hitCount++; debt += 6; }

      // §7.3 молчащее небо: study перестал быть бесплатным
      if (e.act === 'study' && contacted && accord > 0) {
        events.push({ d, text: 'Небо снова смотрело и снова промолчало.', hook: 'тишина' });
      }

      // ── крючки ──
      const hooks = (ACT_HOOKS[e.act] || []).concat(reg === REG.QUIET ? [] : extraHooks);
      if (e.act === 'study' && !contacted) hooks.length = 0;         // до контакта — чистая разведка
      hooks.forEach(h => W.forEach(w => {
        // «Тишина» — крючок без своего надлома: она будит всё, что про брошенность (§4.3)
        if (h === 'тишина' ? w.kind !== KIND.LOSS : w.hook !== h) return;
        if (w.state === STATE.OLD || w.state === STATE.LIVED) {
          if (w.state === STATE.LIVED) return;                       // изжитое не вскрывается
          wake(w, h, d);
        }
      }));

      // ── §11 слово: адресные действия ──
      if (e.act === 'trial') {
        const w = W.find(x => x.src === e.wound);
        if (w && w.kind !== KIND.DEBT && w.hook !== 'святилище' && !open_any_but(w)) {
          const black = a.weeks.includes(Math.floor(d / 7) % YEAR);
          w.state = STATE.LIVED;
          w.weight = -w.weight;                                       // вес меняет знак (§4.1)
          alarm -= black ? 24 : 12; stead += black ? 20 : 10;
          forces.cast = clamp(forces.cast + 8, 0, 100);   // названное вернуло им голос
          events.push({ d, text: 'Названное перестало быть вечным сейчас.', wound: w.src });
        }
      }
      if (e.act === 'record') {
        const w = W.find(x => x.src === e.wound);
        if (w && w.state === STATE.OPEN && h01(seed, 'rec' + w.src + d) < 0.55) w.state = STATE.OLD;
        forces.keep = clamp(forces.keep - 6, 0, 100);
      }
      if (e.act === 'vira') {
        const w = W.find(x => x.src === e.wound);
        if (w && (w.kind === KIND.DEBT || w.hook === 'святилище')) {
          w.state = STATE.LIVED; w.weight = -Math.abs(w.weight);
          debt = Math.max(0, debt - 20);
        }
      }
      if (e.act === 'forge') {
        faked++;
        W.filter(w => w.state === STATE.OLD || w.state === STATE.OPEN)
         .slice(0, 1 + hInt(seed, 'forge' + d, 2))
         .forEach(w => { w.state = STATE.FALSE; });
      }
      if (e.act === 'numb') {   // §13.3 тихая мера: причина цела, лестница закрыта навсегда
        W.forEach(w => { if (w.state === STATE.OPEN) { w.state = STATE.OLD; w.weight = clamp(w.weight + 4, 1, 100); } });
        a.numbed = true;
      }
      if (e.act === 'breach') {  // §17
        breaches++;
        taken += Math.round((40 + 44 * (civ.tier || 0)) * (0.8 + h01(seed, 'br' + d) * 0.6));
        let w = W.find(x => x.hook === 'святилище');
        if (!w) { w = { src: 'святилище', hook: 'святилище', kind: KIND.OFFENCE, weight: 0, state: STATE.OPEN, phase: civ.phase, woke: 0, wokeAt: d, mute: 1, owner: SIDE.KEEP, date: null }; W.push(w); }
        w.weight = clamp(w.weight + 45, 1, 100);         // вес не зависит от фазы: вскрытое вскрыто
        w.state = STATE.OPEN; w.wokeAt = d;
        // короткая дорога закрывает долгую навсегда
        a.covenantLocked = true;
      }
      if (e.act === 'ack') {
        streak = Math.max(streak, 1);
        a.fickleCleared = true;
      }
    }

    function open_any_but(w) { return W.some(x => x !== w && x.state === STATE.OPEN); }

    function wake(w, hook, d) {
      w.state = STATE.OPEN; w.woke++; w.wokeAt = d;
      w.weight = clamp(w.weight + 8, 1, 100);
      w.thresh = Math.max(4, (w.thresh || 20) - 4);      // каждый раз порог ниже
      alarm += 8 + w.weight * 0.12;
      stead -= 6;
      events.push({ d, text: 'Держава живёт в том годе.', wound: w.src, hook });
    }

    function collapseForgery(d) {
      W.forEach(w => { if (w.state === STATE.FALSE) { w.state = STATE.OPEN; w.wokeAt = d; w.weight = clamp(w.weight + 10, 1, 100); } });
      accord = 0; debt += 60; a.twoface = true;
      events.push({ d, text: 'Летопись встретилась с правдой.' });
    }

    // §7.4 четыре образа неба — выводится из истории действий, не выбирается
    function skyOf() {
      if (!careCount && !hitCount) return SKY.NONE;
      if (hitCount && careCount >= 2) return SKY.TWOFACE;
      if (careCount && missCount >= 2) return SKY.FICKLE;
      if (careCount >= 5 && missCount === 0 && streak >= 3) return SKY.PILLAR;
      return SKY.FAR;
    }
    function ceilOf(sky) {
      return sky === SKY.PILLAR ? 100 : sky === SKY.TWOFACE ? 90 : sky === SKY.FICKLE ? 70 : sky === SKY.FAR ? 55 : 40;
    }

    // ── итог ──────────────────────────────────────────────────
    const sky = a.twoface ? SKY.TWOFACE : skyOf();
    const band = bandOf(alarm, stead, grit);
    const openW = W.filter(w => w.state === STATE.OPEN);
    const need = needOf(seed, day, W, accord);
    // §9.4 Согласие — не «все раны зажили», а «ни одна сила не в изгнании»:
    // покой, три силы при своём, и ни одного неискупленного долга.
    const accordance = !openW.length && forces.keep > 25 && forces.cast > 25 && forces.riot < 45
      && !W.some(w => w.kind === KIND.DEBT && w.state !== STATE.LIVED)
      && !W.some(w => w.state !== STATE.LIVED && w.weight >= 70)
      && !a.numbed && !a.covenantLocked;

    // §19 фаза и летопись — вычисление, а не колонка. Шаг съедает запись роадмапа;
    // взлёт (последняя запись) отдаётся отдельно: его проверяет сервер, не клиент.
    const road = a.roadmap || civ.roadmap || [];
    const steps = clamp(Math.floor(prog), 0, road.length);
    const walked = road.slice(0, steps);
    const ignited = steps >= road.length && road.length > 0;

    return {
      day, band,
      phase: clamp((a.phase0 != null ? a.phase0 : civ.phase) + walked.filter(e => !e.ignite).length, 0, 11),
      steps, steps_left: road.length - steps, ignited,
      walked,                                       // что дописалось в летопись за это время
      alarm: Math.round(alarm), stead: Math.round(stead), grit: Math.round(grit),
      accord: Math.round(accord), feed: Math.round(feed), debt: Math.round(debt),
      forces: { keep: Math.round(forces.keep), cast: Math.round(forces.cast), riot: Math.round(forces.riot) },
      sky, sky_cap: ceilOf(sky),
      wounds: W, open: openW.length,
      weeks: a.weeks,
      need,
      accordance,                                   // §9.4 Согласие — то, ради чего Завет
      covenant: accordance && !a.covenantLocked,    // §15 долгая дорога открыта
      covenant_locked: !!a.covenantLocked,
      numbed: !!a.numbed, forged: faked > 0,
      breaches, ichor_taken: taken,                 // §18: сколько ушло в недоимку (считает СЕРВЕР)
      horizon: horizonOf(band, civ),                // §5.2 держава без замысла
      events,
      doctrine: doctrineOf(W, band, sky, grit, accordance, a),   // §16 чем выйдет в космос
    };
  }

  // §5 русло: ширина = прочность
  function bandOf(alarm, stead, grit) {
    if (alarm >= 50 + grit * 0.4) return BAND.EMERG;
    if (stead <= 34 - grit * 0.25) return BAND.STALL;
    return BAND.FLOW;
  }

  // §5.2 — вне русла держава перестаёт видеть вперёд
  function horizonOf(band, civ) {
    const full = (civ.roadmap || []).length;
    if (band === BAND.STALL) return { steps: Math.min(full, 1 + (full > 3 ? 1 : 0)), blind: true };
    if (band === BAND.EMERG) return { steps: full, war: true };
    return { steps: full };
  }

  // §6 — держава не знает, чего хочет
  function needOf(seed, day, W, accord) {
    const epoch = Math.floor(day / 30);
    const openW = W.filter(w => w.state === STATE.OPEN);
    let n;
    if (openW.length) n = NEEDS.find(x => x.hook === openW[0].hook) || NEEDS[4];
    else n = NEEDS[hInt(seed, 'need' + epoch, NEEDS.length)];
    return { said: n.said, real: accord >= 40 ? n.real : null, id: n.id };
  }

  // §16 — чем держава выходит в космос
  function doctrineOf(W, band, sky, grit, accordance, a) {
    if (W.some(w => w.hook === 'святилище')) return 'не выходит вовсе';
    if (a.twoface || sky === SKY.TWOFACE) return 'союзник, который однажды ударит';
    if (accordance && grit >= 45) return 'держава-посредник';
    if (W.some(w => w.state === STATE.FALSE)) return 'фанатичный вассал с вашей верой';
    if (W.some(w => w.state === STATE.OPEN && w.hook === 'небо')) return 'выходит с флотом и претензией';
    if (W.some(w => w.state === STATE.LIVED && w.kind === KIND.DEBT)) return 'единственные, кто умеет мириться';
    if (W.some(w => w.state === STATE.LIVED && w.hook === 'мор')) return 'лучшие лекари галактики';
    // «Идут делать с чужими то, что делали с ними» — только если увод так и остался
    // вскрытым и тяжёлым, а не просто лежит в летописи строкой.
    if (W.some(w => w.hook === 'увод' && w.state === STATE.OPEN && w.weight >= 55)) return 'работорговая держава';
    if (band === BAND.STALL) return 'чей-то протекторат';
    if (band === BAND.EMERG) return 'милитарист-однодневка';
    return 'обычная молодая держава';
  }

  return {
    anchor, state, chronicleOf,
    HOOKS, KIND, STATE, BAND, SIDE, SKY, REG, NEEDS, QUIET, CARD_WOUND, GRP_WOUND, ACT,
    hash32, mulberry, h01, dose, bandOf,
  };
});
