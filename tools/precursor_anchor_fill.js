// Ставит якорь (§19) мирам, которые его ещё не имеют.
//   node tools/precursor_anchor_fill.js         — показать, что будет
//   node tools/precursor_anchor_fill.js --write — записать
//
// Якорь неизменен: считаем один раз от seed и той летописи, которая уже прожита.
// Существующие миры от этого не меняются — у них лишь появляется прошлое,
// прочитанное по правилу дозы (§4.2) вместо мешка шрамов.
const fs = require('fs'), path = require('path'), vm = require('vm'), { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = { window: {}, console };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'precursor_gen.js'), 'utf8'), sb);
const Precursors = sb.window.Precursors;
const Sim = require(path.join(ROOT, 'precursor_sim.js'));
const WRITE = process.argv.includes('--write');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(`
    select system_id, pid, seed, self_name, planet_name, env, phase, tier, scars,
           wellbeing, attitude, ruins, chronicle, roadmap, created_at
      from public.primitive_civs
     where anchor is null order by created_at`);
  console.log(`миров без якоря: ${rows.length}\n`);

  for (const r of rows) {
    const a = Sim.anchor(r, { cards: Precursors.CARDS });
    const debt = a.wounds.filter(w => w.kind === 'долг').length;
    const open = a.wounds.filter(w => w.state === 'вскрытый').length;
    console.log(`${(r.self_name || '?').padEnd(18)} ${r.env.padEnd(12)} E${r.phase}  ` +
      `надломов ${a.wounds.length} (долг ${debt}, вскрыто ${open}) · седмиц ${a.weeks.length} · ` +
      `набат ${a.base.alarm} устой ${a.base.stead} прочность ${a.base.grit}`);
    console.log('   ' + a.wounds.map(w => `${w.src}[${w.hook} ${w.weight}]`).join(' · '));
    if (WRITE) {
      await c.query('update public.primitive_civs set anchor=$3, anchor_at=now() where system_id=$1 and pid=$2 and anchor is null',
        [r.system_id, r.pid, JSON.stringify(a)]);
    }
  }
  console.log(WRITE ? '\nзаписано.' : '\n(ничего не записано — добавьте --write)');
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
