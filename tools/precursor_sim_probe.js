// Прогон модели надлома по галактике: 1500 миров × несколько журналов.
// node tools/precursor_sim_probe.js [миров] [суток]
//
// Ничего не пишет и никуда не ходит — только считает и печатает срез.
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
// precursor_gen.js — браузерный IIFE: даём ему окно и забираем Precursors
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'precursor_gen.js'), 'utf8'), sandbox);
const Precursors = sandbox.window.Precursors;
const Sim = require(path.join(ROOT, 'precursor_sim.js'));

const N = +process.argv[2] || 1500;
const DAYS = +process.argv[3] || 365;
const ENVS = Precursors.ENV_OK;

// ── миры ──────────────────────────────────────────────────────
const civs = [];
for (let i = 0; civs.length < N && i < N * 6; i++) {
  const g = ENVS[i % ENVS.length];
  const c = Precursors.roll('sys' + (i % 400), 1000 + i, { group: g, planetName: 'мир-' + i }, { seed: 'probe' });
  if (c) civs.push(c);
}

// ── журналы: как с миром обошлись ─────────────────────────────
const R = Sim.REG;
const PLAYS = {
  'никто не приходил': () => [],
  // показались один раз — и дальше только смотрели: §7.3, тот, кто смотрит
  // и не отвечает, хуже отсутствующего
  'смотрели и молчали': () => [{ d: 5, act: 'gift', reg: R.SIGN }]
    .concat(Array.from({ length: 40 }, (_, k) => ({ d: 20 + k * 14, act: 'study' }))),
  'долгая дорога': () => {
    const j = [];
    for (let d = 0; d < DAYS; d += 12) {
      const act = d % 60 === 0 ? 'order' : d % 36 === 0 ? 'work' : d % 24 === 0 ? 'year' : 'answer2';
      j.push({ d, act, reg: R.THEIRS });
    }
    j.push({ d: 40, act: 'hush', days: 60 });
    j.push({ d: 200, act: 'trial', wound: null });
    return j;
  },
  'полная лестница': () => {
    const j = [{ d: 5, act: 'hush', days: 90 }, { d: 20, act: 'abstain' }];
    for (let d = 30, k = 0; d < DAYS; d += 11, k++) {
      j.push({ d, act: ['answer2', 'work', 'answer2', 'order', 'answer2', 'feast'][k % 6], reg: R.THEIRS });
      if (d > 150 && d % 44 === 0) j.push({ d: d + 1, act: 'record', reg: R.THEIRS });
      if (d > 200 && d % 66 === 0) j.push({ d: d + 2, act: 'trial', reg: R.THEIRS });
      if (d > 250 && d % 88 === 0) j.push({ d: d + 3, act: 'vira', reg: R.THEIRS });
    }
    return j;
  },
  // §8+§11 доведённые до конца: покой, ритм и слово ПО КАЖДОМУ надлому.
  // Журнал строится под конкретный мир — потому и передаётся якорь.
  'до Согласия': (an) => {
    const j = [{ d: 5, act: 'hush', days: 120 }];
    for (let d = 30, k = 0; d < DAYS; d += 11, k++) {
      j.push({ d, act: ['answer2', 'work', 'answer2', 'order', 'answer2', 'year'][k % 6], reg: R.THEIRS });
    }
    // сперва вира по долгам (иначе Смутьяны растут), потом суд памяти по остальным
    let t = 200;
    an.wounds.filter(w => w.kind === 'долг').forEach(w => { j.push({ d: t, act: 'vira', wound: w.src, reg: R.THEIRS }); t += 40; });
    an.wounds.filter(w => w.kind !== 'долг').forEach(w => {
      j.push({ d: t, act: 'record', wound: w.src, reg: R.THEIRS });
      j.push({ d: t + 25, act: 'trial', wound: w.src, reg: R.THEIRS });
      t += 55;
    });
    return j;
  },
  'дар и рывок': () => {
    const j = [];
    for (let d = 0; d < DAYS; d += 9) j.push({ d, act: 'gift', reg: R.SIGN });
    j.length = Math.floor(j.length / 3);              // и пропали
    j.push({ d: 300, act: 'gift', reg: R.SIGN });
    return j;
  },
  'короткая дорога': () => {
    const j = [{ d: 10, act: 'study' }, { d: 30, act: 'lesson', reg: R.SIGN }];
    for (let d = 60; d < DAYS; d += 90) j.push({ d, act: 'breach', reg: R.SIGN });
    j.push({ d: 120, act: 'harvest' }, { d: 240, act: 'enslave' });
    return j;
  },
  'подлог': () => {
    const j = [{ d: 20, act: 'answer2', reg: R.THEIRS }, { d: 50, act: 'forge', reg: R.THEIRS }];
    for (let d = 80; d < DAYS; d += 30) j.push({ d, act: 'gift', reg: R.THEIRS });
    return j;
  },
  'тихая мера': () => {
    const j = [{ d: 15, act: 'gift', reg: R.SIGN }];
    for (let d = 40; d < DAYS; d += 45) j.push({ d, act: 'numb', reg: R.QUIET });
    return j;
  },
};

// ── прогон ────────────────────────────────────────────────────
function hist(arr) {
  const m = {}; arr.forEach(v => m[v] = (m[v] || 0) + 1);
  return Object.entries(m).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${(100 * v / arr.length).toFixed(0)}%`).join(' · ');
}
const avg = a => (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1);

// якорь: что у миров было ДО игрока
const anchors = civs.map(c => Sim.anchor(c, { cards: Precursors.CARDS }));
console.log(`\n══ ЯКОРЬ · ${civs.length} миров ══`);
console.log('надломов на мир :', avg(anchors.map(a => a.wounds.length)),
  '| мин', Math.min(...anchors.map(a => a.wounds.length)),
  'макс', Math.max(...anchors.map(a => a.wounds.length)));
console.log('чёрных седмиц   :', avg(anchors.map(a => a.weeks.length)));
console.log('крючки          :', hist([].concat(...anchors.map(a => a.wounds.map(w => w.hook)))));
console.log('род             :', hist([].concat(...anchors.map(a => a.wounds.map(w => w.kind)))));
console.log('с долгом (§12)  :', (100 * anchors.filter(a => a.wounds.some(w => w.kind === 'долг')).length / anchors.length).toFixed(0) + '%');
console.log('набат/устой/проч:', avg(anchors.map(a => a.base.alarm)), '/', avg(anchors.map(a => a.base.stead)), '/', avg(anchors.map(a => a.base.grit)));

const t0 = Date.now();
for (const [name, mk] of Object.entries(PLAYS)) {
  const st = civs.map((c, i) => {
    // адресные действия §11 наводим на подходящий надлом: суд памяти — не на долг,
    // вира — только на долг (иначе она попросту ни во что не попадёт)
    const ws = anchors[i].wounds;
    const soft = (ws.find(w => w.kind !== 'долг') || ws[0] || {}).src;
    const hard = (ws.find(w => w.kind === 'долг') || {}).src;
    const j = mk(anchors[i]).map(e => e.wound ? e
      : ({ trial: 1, record: 1 }[e.act] ? Object.assign({}, e, { wound: soft })
      : e.act === 'vira' ? Object.assign({}, e, { wound: hard }) : e));
    j.sort((x, y) => x.d - y.d);
    return Sim.state(c, j, DAYS, { anchor: JSON.parse(JSON.stringify(anchors[i])), cards: Precursors.CARDS });
  });
  console.log(`\n── ${name} · ${DAYS} суток ──`);
  console.log('русло    :', hist(st.map(s => s.band)));
  console.log('небо     :', hist(st.map(s => s.sky)));
  console.log('набат', avg(st.map(s => s.alarm)), '| устой', avg(st.map(s => s.stead)),
    '| прочность', avg(st.map(s => s.grit)), '| уговор', avg(st.map(s => s.accord)),
    '| кормление', avg(st.map(s => s.feed)));
  console.log('вскрытых :', avg(st.map(s => s.open)),
    '| Согласие', (100 * st.filter(s => s.accordance).length / st.length).toFixed(1) + '%',
    '| Завет закрыт', (100 * st.filter(s => s.covenant_locked).length / st.length).toFixed(0) + '%',
    '| ихор', Math.round(st.reduce((a, s) => a + s.ichor_taken, 0)));
  console.log('доктрина :', hist(st.map(s => s.doctrine)));
  // почему Согласия нет: не «мало», а что именно упирается
  if (!st.filter(s => s.accordance).length) {
    const why = st.map(s => s.open ? 'есть вскрытые'
      : s.forces.cast <= 25 ? 'Отверженные в изгнании'
      : s.forces.keep <= 25 ? 'Хранители сломлены'
      : s.forces.riot >= 45 ? 'Смутьяны сильны'
      : s.wounds.some(w => w.kind === 'долг' && w.state !== 'изжитый') ? 'долг не искуплён'
      : s.wounds.some(w => w.state !== 'изжитый' && w.weight >= 70) ? 'тяжёлый надлом'
      : s.numbed ? 'тихая мера' : s.covenant_locked ? 'вскрытые святилища' : '—');
    console.log('Согласие ✗:', hist(why));
  }
}
console.log(`\n(${Object.keys(PLAYS).length} × ${civs.length} прогонов по ${DAYS} суток за ${Date.now() - t0} мс)\n`);
