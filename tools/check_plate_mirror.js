// ── СВЕРКА ЗЕРКАЛА: клиентский cnPlateMap против серверного _cn_plate_map ──────
// Синергия считается в двух местах (JS на верфи и SQL при публикации). Разъедутся —
// игрок увидит на верстаке одно, а в бою получит другое, и молча. Поэтому здесь
// гоняем случайные раскладки через оба расчёта и сверяем множитель по КАЖДОЙ клетке.
//
// Запуск: node tools/check_plate_mirror.js
// Требует .env с доступом к базе (тот же, что у tools/db_run.js).
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = { console };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = {
  getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }),
  addEventListener() {}, body: { appendChild() {} },
};
ctx.localStorage = { getItem: () => null, setItem() {} };
ctx.setTimeout = setTimeout; ctx.location = { search: '' }; ctx.navigator = { userAgent: '' };
vm.createContext(ctx);
const run = f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
run('hull_gen.js');
run('constructors.js');

// Игрушечный каталог: по модулю на каждую семью + разные аппетиты по энергии,
// чтобы задеть все ветки номинала, формы и разбавления.
const FAMS = ['jam', 'pd', 'stealth', 'sensor', 'hangar', 'dejam', 'interdict', 'stabil', 'ftl'];
const DB = { modules: { t: [] } };
FAMS.forEach((f, i) => {
  DB.modules.t.push({ name: f, energy: [120, 400, 900, 3000, 9000][i % 5], combat: { [f]: 1 }, resurs: {} });
});
DB.modules.t.push({ name: 'hold', energy: 100, combat: {}, resurs: {} });   // корпусное

const SYS = ['beacon', 'gun_s', 'gun_m', 'gun_l', 'coat', 'armor', 'screen'];
const CLASSES = ['corvette', 'destroyer', 'mediumCruiser', 'battleship', 'dreadnought', 'ss13'];

let seed = 20260805;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

function makeLayout(N) {
  const bays = new Array(N).fill(null);
  for (let t = 0; t < N * 0.35; t++) {
    const i = (rnd() * N) | 0;
    if (bays[i]) continue;
    if (rnd() < 0.22) bays[i] = { sys: SYS[(rnd() * SYS.length) | 0] };
    else bays[i] = { m: { g: 't', idx: (rnd() * DB.modules.t.length) | 0 } };
  }
  return bays;
}

// Раскладка для сервера: тот же формат, что шлёт клиент (cnVehSave)
const forSql = bays => bays.map(b => b ? (b.sys ? { sys: b.sys } : { g: b.m.g, idx: b.m.idx }) : null);

(async () => {
  const { Client } = require('pg');
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const cli = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await cli.connect();

  let cases = 0, bad = 0;
  for (const k of CLASSES) {
    for (let t = 0; t < 4; t++) {
      const G = vm.runInContext('CN._dg = null; cnDeckGeo(' + JSON.stringify(k) + ')', ctx);
      const N = G.w * G.h;
      const bays = makeLayout(N);
      // клиент (CN объявлен через const — правим его через лексику контекста)
      vm.runInContext(`CN.def = { db: ${JSON.stringify(DB)} };`
        + `CN.shipLayout = { mounts: [], bays: ${JSON.stringify(bays)} };`, ctx);
      const map = vm.runInContext('cnPlateMap(' + JSON.stringify(k) + ')', ctx);
      const jsK = new Array(N).fill(0);
      map.mods.forEach(m => m.cells.forEach(c => { jsK[c] = m.k; }));
      // сервер
      const r = await cli.query('select public._cn_plate_map($1,$2,$3) as p',
        [k, JSON.stringify({ bays: forSql(bays) }), JSON.stringify(DB)]);
      const P = r.rows[0].p;
      const sqlK = (P.kcell || []).map(Number);
      cases++;
      const diffs = [];
      for (let i = 0; i < N; i++) {
        const a = +jsK[i] || 0, b = +sqlK[i] || 0;
        if (Math.abs(a - b) > 1e-6) diffs.push(`${i}: js=${a.toFixed(4)} sql=${b.toFixed(4)}`);
      }
      const badJs = map.bad.slice().sort((a, b2) => a - b2).join(',');
      const badSql = (P.bad || []).slice().sort((a, b2) => a - b2).join(',');
      if (diffs.length || badJs !== badSql) {
        bad++;
        console.log(`✗ ${k} #${t}: расхождений ${diffs.length}`, diffs.slice(0, 6));
        if (badJs !== badSql) console.log(`   bad js=[${badJs.slice(0, 120)}] sql=[${badSql.slice(0, 120)}]`);
      } else {
        const dl = vm.runInContext('cnDeckLoadout(' + JSON.stringify(k) + ')', ctx);
        const L = P.load;
        const dz = ['gs', 'energy', 'mass', 'hp', 'plates', 'guns'].filter(f => Math.abs(+dl[f] - +L[f]) > 1e-6);
        if (dz.length) { bad++; console.log(`✗ ${k} #${t}: разводка палубы расходится по ${dz.join(', ')}`, dl, L); }
        else console.log(`✓ ${k} #${t}: ${map.mods.length} контуров, ${N} клеток — совпало`);
      }
    }
  }
  await cli.end();
  console.log(bad ? `\n✗ РАСХОЖДЕНИЯ: ${bad} из ${cases}` : `\n✓ Зеркало сходится: ${cases} раскладок`);
  process.exit(bad ? 1 : 0);
})();
