// Сквозная проверка precursor_commit от лица настоящего игрока.
// Всё делается в транзакции и ОТКАТЫВАЕТСЯ: база после прогона не меняется.
//   node tools/precursor_commit_test.js
const fs = require('fs'), path = require('path'), { Client } = require('pg');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const UID = process.argv[2] || '42f9b7e3-f378-4dce-a4bb-acf0c0ac9e3e';
const CIV = process.argv[3] || 'Скарши';

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('begin');
  try {
    await c.query(`set local request.jwt.claims = '{"sub":"${UID}"}'`);
    const { rows: [civ] } = await c.query(
      'select system_id, pid, self_name, tier from primitive_civs where self_name=$1', [CIV]);
    const gc0 = (await c.query('select gc from faction_economy where faction_id=public._ec_my_fid()')).rows[0];
    console.log(`мир: ${civ.self_name} (тир ${civ.tier}) · казна ${gc0.gc}\n`);

    for (const act of ['feast', 'hush', 'record', 'order', 'trial']) {
      const { rows: [r] } = await c.query(
        'select public.precursor_commit($1,$2,$3,$4,$5) r', [civ.system_id, civ.pid, act, 'их словом', null]);
      const v = r.r;
      console.log(`${act.padEnd(8)} ${v.ok ? '✓ записано, ГС −' + v.gc + ', ступень «' + v.step + '»' : '✗ ' + v.why}`);
    }

    const j = (await c.query(
      'select action, reg, payload->>\'gc\' gc from primitive_acts where system_id=$1 and pid=$2 and at > now() - interval \'1 minute\' order by at',
      [civ.system_id, civ.pid])).rows;
    console.log('\nв журнал легло:', j.map(x => x.action).join(', ') || '(ничего)');
    const gc1 = (await c.query('select gc from faction_economy where faction_id=public._ec_my_fid()')).rows[0];
    console.log('казна стала  :', gc1.gc, '(списано ' + (gc0.gc - gc1.gc) + ')');
    const hot = (await c.query(
      'select acts, last_act_at is not null t from primitive_civs where system_id=$1 and pid=$2', [civ.system_id, civ.pid])).rows[0];
    console.log('горячая строка: acts =', hot.acts, '— и это всё, что в ней поменялось');
  } finally {
    await c.query('rollback');
    console.log('\n(транзакция откачена — база не тронута)');
    await c.end();
  }
})().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
