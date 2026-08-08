// ── СВЕРКА ТВОРЧЕСКОГО КОРПУСА: КЛИЕНТ ↔ SQL ──────────────────────────────────
// У колосса форму палубы задаёт не справочник, а маска, которую нарисовал игрок, и
// разбирают её ДВОЕ: верфь (cnColSane/cnDeckGeo) и сервер (_cn_hull_sane/_cn_hull_mask).
// Разъедутся — игрок увидит «на верфи стояло, а опубликовать нельзя». Гоняем
// заготовки, заготовки с вырезом и обрывком и случайные кляксы, сравнивая
// канонизацию, маску поклеточно и производные ТТХ.
//
// Запуск: node tools/check_colossus.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const { Client } = require('pg');
const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

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

const jsMask = h => vm.runInContext(`(function(){
  var hh = cnColSane(${JSON.stringify(h)});
  CN.hull = hh; CN._dg = null; CN_SHIP_GEO.colossus = cnColGeo(hh);
  var G = cnDeckGeo('colossus');
  var band = G.band.map(function(b){ return b === 'bow' ? 1 : b === 'mid' ? 2 : b === 'stern' ? 3 : 0; });
  return { sane: hh, w: G.w, h: G.h, cells: G.n, inside: G.inside, outer: G.outer, skin: G.skin,
           band: band, stats: cnColStats(G.n) };
})()`, ctx);

// hex-строка → массив булей (зеркало _cn_bits)
function unpack(hex, n) {
  const out = new Array(n).fill(false);
  for (let i = 0; i < hex.length; i++) {
    const v = parseInt(hex[i], 16);
    for (let b = 0; b < 4; b++) if ((v & (1 << b)) && i * 4 + b < n) out[i * 4 + b] = true;
  }
  return out;
}

// Что проверяем: заготовки как есть, заготовки с вырезом и с оторванным куском
// (канонизация должна отработать одинаково), плюс случайные кляксы — именно они
// ловят расхождение в поиске кусков и в обрезке полей.
const HULLS = [];
const mk = expr => vm.runInContext(expr, ctx);
mk('CN_COL_PRESETS').forEach((p, i) => {
  const hull = mk(`CN_COL_PRESETS[${i}].make()`);
  if (hull.w * hull.h < 4) return;
  HULLS.push({ name: p.name, hull });
  // тот же корпус с дыркой в середине и с отдельно стоящей клеткой в углу
  HULLS.push({ name: p.name + ' + вырез/обрывок', hull: mk(`(function(){
    var s = CN_COL_PRESETS[${i}].make(), b = cnColUnpack(s.mask, s.w*s.h);
    for (var y = ((s.h/3)|0); y < ((s.h/3)|0) + 4; y++)
      for (var x = ((s.w/2)|0) - 1; x <= ((s.w/2)|0) + 1; x++)
        if (x >= 0 && x < s.w && y < s.h) b[y*s.w+x] = false;
    b[0] = true; b[s.w-1] = true;
    return { w: s.w, h: s.h, mask: cnColPack(b) };
  })()`) });
});
let seed = 20260808;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let t = 0; t < 12; t++) {
  const w = 4 + Math.floor(rnd() * 30), h = 4 + Math.floor(rnd() * 60), bits = [];
  for (let i = 0; i < w * h; i++) bits.push(rnd() < 0.55);
  HULLS.push({ name: `клякса ${w}×${h}`, hull: mk(`(function(){ return { w: ${w}, h: ${h}, mask: ${JSON.stringify(vm.runInContext('cnColPack', ctx)(bits))} }; })()`) });
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  let bad = 0, i = 0;
  for (const H of HULLS) {
    i++;
    const h = H.hull, js = jsMask(h);
    const r = (await c.query(
      `select m.w, m.h, m.cells, m.inside, m.outer_, m.skin, m.band,
              public._cn_colossus_cls('{}'::jsonb, m.cells) stats,
              public._cn_hull_sane($1::jsonb) sane
         from public._cn_hull_mask($1::jsonb) m`, [JSON.stringify(h)])).rows[0];
    const errs = [];
    if (r.sane.mask !== js.sane.mask || r.sane.w !== js.sane.w || r.sane.h !== js.sane.h)
      errs.push(`канонизация: SQL ${r.sane.w}×${r.sane.h} ≠ JS ${js.sane.w}×${js.sane.h}`);
    if (r.w !== js.w || r.h !== js.h) errs.push(`решётка ${r.w}×${r.h} ≠ ${js.w}×${js.h}`);
    if (r.cells !== js.cells) errs.push(`клеток ${r.cells} ≠ ${js.cells}`);
    if (!errs.length) {
      const n = js.w * js.h;
      const cmp = (name, sqlBits, jsArr) => {
        const s = unpack(sqlBits, n);
        for (let q = 0; q < n; q++) if (!!s[q] !== !!jsArr[q]) { errs.push(`${name}: клетка ${q} (${q % js.w},${(q / js.w) | 0})`); return; }
      };
      cmp('inside', r.inside, js.inside);
      cmp('outer', r.outer_, js.outer);
      cmp('skin', r.skin, js.skin);
      const sb = r.band;
      for (let q = 0; q < n; q++) if (+sb[q] !== js.band[q]) { errs.push(`band: клетка ${q}`); break; }
      const S = js.stats, T = r.stats;
      ['mass', 'crewRequired', 'capacity', 'gabarit', 'price', 'modul'].forEach(kk => {
        if (Math.round(+T[kk]) !== Math.round(S[kk])) errs.push(`${kk}: SQL ${T[kk]} ≠ JS ${S[kk]}`);
      });
      for (const kk in S.resurs) if (Math.round(+T.resurs[kk]) !== Math.round(S.resurs[kk])) errs.push(`resurs.${kk}: ${T.resurs[kk]} ≠ ${S.resurs[kk]}`);
    }
    if (errs.length) { bad++; console.log(`✗ #${i} ${H.name} → ${errs.slice(0, 3).join(' · ')}`); }
    else console.log(`✓ #${i} ${H.name} · ${js.w}×${js.h}, ${js.cells} клеток`);
  }
  await c.end();
  console.log(bad ? `\nРАСХОЖДЕНИЙ: ${bad} из ${HULLS.length}` : `\nВсе ${HULLS.length} корпусов сошлись клетка в клетку.`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
