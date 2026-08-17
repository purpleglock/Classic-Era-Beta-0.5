// Этап 9: старые решения через новую дверь (precursor_commit).
// Проверяет, что цепочка v1..v5 снесена не в ущерб последствиям: наука, дары,
// выкачивание, протекторат, урок, обряд — всё считает `_pc_effects`.
// Всё в транзакции и ОТКАТЫВАЕТСЯ: база после прогона не меняется.
//   node tools/precursor_legacy_test.js [uid] [имя мира]
const fs = require('fs'), path = require('path'), { Client } = require('pg');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const UID = process.argv[2] || '42f9b7e3-f378-4dce-a4bb-acf0c0ac9e3e';
const CIV = process.argv[3] || 'Скарши';

const q = (c, sql, p) => c.query(sql, p).then(r => r.rows);

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('begin');
  try {
    await c.query(`set local request.jwt.claims = '{"sub":"${UID}"}'`);
    const [civ] = await q(c, `select system_id, pid, self_name, tier, phase, pop, status, attitude,
                                     wellbeing, trust, dependency
                                from primitive_civs where self_name=$1`, [CIV]);
    if (!civ) throw new Error('мира ' + CIV + ' нет');
    const [me] = await q(c, 'select public._ec_my_fid() fid');
    // Денег и веры даём щедро: проверяем последствия, а не бедность казны.
    await c.query(`update faction_economy set gc = 9000000, science = 0 where faction_id=$1`, [me.fid]);
    console.log(`мир: ${civ.self_name} (тир ${civ.tier}, эпоха ${civ.phase}, статус ${civ.status})`);
    console.log(`держава: ${me.fid}\n`);

    const run = async (act, note) => {
      const [r] = await q(c, 'select public.precursor_commit($1,$2,$3,$4,$5) r',
        [civ.system_id, civ.pid, act, 'их словом', null]);
      const v = r.r;
      const head = act.padEnd(9) + (v.ok ? '✓ ' : '✗ ');
      console.log(head + (v.ok ? (v.txt || '(без текста)') : v.why) + (note ? '   ← ' + note : ''));
      return v;
    };

    console.log('── 1. Цепочка v1..v5 ──');
    const [ch] = await q(c, `select count(*) n from pg_proc where proname like '\\_precursor\\_act\\_v%'`);
    console.log('обёрток осталось:', ch.n, ch.n === '0' ? '✓' : '✗ ДОЛЖНО БЫТЬ 0');

    console.log('\n── 2. Наблюдение: наука приходит ──');
    const sci0 = (await q(c, 'select science from faction_economy where faction_id=$1', [me.fid]))[0].science;
    await run('study');
    const sci1 = (await q(c, 'select science from faction_economy where faction_id=$1', [me.fid]))[0].science;
    console.log('наука:', sci0, '→', sci1, +sci1 > +sci0 ? '✓' : '✗');
    await run('study', 'те же часы — должно быть «слишком скоро»');

    console.log('\n── 3. Добрая воля: цена растёт, отдача падает ──');
    for (const a of ['boon', 'envoy']) {
      const [g] = await q(c, 'select public.precursor_can($1,$2,$3) r', [civ.system_id, civ.pid, a]);
      console.log(a.padEnd(9) + 'цена ' + (g.r.gc ?? '—') + (g.r.ok ? '' : ' (' + g.r.why + ')'));
    }
    await run('boon');
    await run('envoy', 'часы даров общие — «слишком скоро»');
    const [att] = await q(c, 'select attitude, dependency, trust, (flags->>\'gifts\')::int gifts from primitive_civs where system_id=$1 and pid=$2', [civ.system_id, civ.pid]);
    console.log('отношение', civ.attitude, '→', att.attitude, '· зависимость', civ.dependency, '→', att.dependency,
                '· даров', att.gifts);

    console.log('\n── 4. Вмешательство: одна рука на всё ──');
    await run('harvest');
    const [h] = await q(c, 'select pop, wellbeing, status, drained from primitive_civs where system_id=$1 and pid=$2', [civ.system_id, civ.pid]);
    console.log('население', civ.pop, '→', h.pop, '· благополучие', civ.wellbeing, '→', h.wellbeing, '· статус', h.status);
    await run('protect', 'часы вмешательства заняты выкачиванием');

    console.log('\n── 5. Бросок больше не random(): тот же день — тот же ответ ──');
    await c.query('savepoint roll');
    await c.query(`delete from primitive_acts where system_id=$1 and pid=$2 and action='harvest'`, [civ.system_id, civ.pid]);
    const p1 = await run('protect');
    await c.query('rollback to savepoint roll');
    await c.query(`delete from primitive_acts where system_id=$1 and pid=$2 and action='harvest'`, [civ.system_id, civ.pid]);
    const p2 = await run('protect');
    console.log('оба раза одинаково:', p1.ok === p2.ok ? '✓' : '✗ РАЗЪЕХАЛОСЬ');

    console.log('\n── 6. Завет теперь стоит на ступени слова ──');
    const [cov] = await q(c, 'select public.precursor_can($1,$2,$3) r', [civ.system_id, civ.pid, 'covenant']);
    console.log('covenant →', cov.r.ok ? 'можно, цена ' + cov.r.gc : cov.r.why);

    console.log('\n── 7. Урок: флот на месте вместо колонии ──');
    const [les] = await q(c, 'select public.precursor_can($1,$2,$3) r', [civ.system_id, civ.pid, 'lesson']);
    console.log('lesson →', les.r.ok ? 'можно' : les.r.why);

    console.log('\n── 8. Обряд: ихор, клеймо и недоимка одним движением ──');
    await c.query('savepoint rite');
    await c.query(`delete from primitive_acts where system_id=$1 and pid=$2`, [civ.system_id, civ.pid]);
    const arr0 = (await q(c, 'select coalesce(amount,0) a from pc_arrears where faction_id=$1', [me.fid]))[0];
    const rite = await run('rite');
    const arr1 = (await q(c, 'select coalesce(amount,0) a from pc_arrears where faction_id=$1', [me.fid]))[0];
    const [dead] = await q(c, 'select status, pop from primitive_civs where system_id=$1 and pid=$2', [civ.system_id, civ.pid]);
    console.log('статус мира:', dead.status, '· население:', dead.pop);
    console.log('недоимка:', (arr0 && arr0.a) || 0, '→', (arr1 && arr1.a) || 0,
                rite.ok && arr1 && +arr1.a > +((arr0 && arr0.a) || 0) ? '✓ обряд лёг в книгу долга' : '✗');
    await c.query('rollback to savepoint rite');

    console.log('\n── 9. Старая дверь: precursor_act ещё отвечает ──');
    await c.query('savepoint shim');
    await c.query(`delete from primitive_acts where system_id=$1 and pid=$2 and action in ('boon','envoy','miracle')`, [civ.system_id, civ.pid]);
    try {
      const [s] = await q(c, `select public.precursor_act($1,$2,'gift') r`, [civ.system_id, civ.pid]);
      console.log('precursor_act(gift) →', s.r.txt || JSON.stringify(s.r));
    } catch (e) { console.log('precursor_act(gift) → отказ:', e.message); }
    await c.query('rollback to savepoint shim');
  } finally {
    await c.query('rollback');
    console.log('\n(транзакция откачена — база не тронута)');
    await c.end();
  }
})().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
