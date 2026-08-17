// Прогон вставшего мира БЕЗ следа в базе: всё делается в транзакции и
// откатывается. Проверяем то, что нельзя проверить глазами: рождение мира по
// исходу, гонку «кто первый», торг, старый счёт и увод.
//   node tools/pc_risen_probe.js
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

(async () => {
  loadEnv();
  const c = new Client({ connectionString: process.env.DATABASE_URL,
                         ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = async (sql, a) => (await c.query(sql, a)).rows;
  await c.query('BEGIN');
  try {
    const civ = (await q(`select system_id, pid, self_name, pop from public.primitive_civs
                           where pop > 800 and status not in ('dead','spacefaring')
                           order by pop desc limit 1`))[0];
    if (!civ) throw new Error('нет ни одного живого дозвёздного мира');
    const facs = await q(`select faction_id from public.faction_economy limit 2`);
    const [A, B] = facs.map(r => r.faction_id);
    const world = `civ:${civ.system_id}:${civ.pid}`;
    console.log(`мир: ${civ.self_name} (${world}), населения ${civ.pop}`);
    console.log(`державы: ${A}, ${B}\n`);

    // ── гонка: кто закрыл счёт первым ──
    console.log('— ' + JSON.stringify((await q(
      `select public._pc_risen_born($1,$2,'побратим') j`, [A, world]))[0].j));
    console.log('— второй с другим исходом: ' + JSON.stringify((await q(
      `select public._pc_risen_born($1,$2,'смута') j`, [B, world]))[0].j));
    const r = (await q(`select fate, игра, сила, by_fid from public.pc_risen where world=$1`,
                       [world]))[0];
    console.log('  судьба мира:', JSON.stringify(r), '\n');

    // ── торг: цена своя у каждого ──
    await q(`update public.pc_risen set ichor = 50 where world = $1`, [world]);
    for (const f of [A, B]) {
      console.log(`  цена для ${f}: ` +
        (await q(`select public._pc_risen_price($1,$2) p`, [world, f]))[0].p);
    }

    // ── кризис: увод и счёт ──
    await q(`delete from public.pc_risen_att where world=$1`, [world]);
    await q(`delete from public.pc_crisis where world=$1`, [world]);
    await q(`update public.pc_risen set fate='возвратный_ход', игра='кризис',
                скрыт=false where world=$1`, [world]);
    await q(`insert into public.pc_crisis(world, next_at, pressure)
             values ($1, now() - interval '1 hour', 40)`, [world]);
    console.log('\n— тик кризиса: ' + JSON.stringify((await q(
      `select public.pc_crisis_tick() j`))[0].j));
    const k = (await q(`select уведено, миров, счёт, pressure from public.pc_crisis
                         where world=$1`, [world]))[0];
    console.log('  уведено:', k.уведено, '| миров:', k.миров,
                '| счёт (ихора):', k.счёт, '| разгон:', k.pressure);
    const s = (await q(`select сила, pop from public.pc_risen where world=$1`, [world]))[0];
    console.log('  сила мира после увода:', s.сила);

    const news = await q(`select title, body from public.faction_news
                           where created_at > now() - interval '1 minute'
                           order by created_at desc limit 1`);
    if (news[0]) console.log('\n  сводка: «' + news[0].title + '» — ' + news[0].body);
  } catch (e) {
    console.error('ОШИБКА:', e.message);
  }
  await c.query('ROLLBACK');
  console.log('\n(откат: в базе ничего не осталось)');
  await c.end();
})();
