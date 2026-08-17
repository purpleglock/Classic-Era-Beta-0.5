// Сквозной прогон хроники по серверу: шаг за шагом от пролога до исхода,
// с посланником, чужой памятью и вставшим миром. Всё в транзакции, откат.
//   node tools/pc_saga_probe.js
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
    const civ = (await q(`select system_id, pid, self_name, races, env, phase
                            from public.primitive_civs
                           where status not in ('dead','spacefaring')
                           order by pop desc limit 1`))[0];
    const fid = (await q(`select faction_id from public.faction_economy
                           order by gc desc limit 1`))[0].faction_id;
    const world = `civ:${civ.system_id}:${civ.pid}`;
    console.log(`мир ${civ.self_name} (${civ.races[0]}, E${civ.phase}), держава ${fid}\n`);

    // _ec_my_fid() читает сессию; для прогона подменяем её на нужную державу.
    await q(`create or replace function public._ec_my_fid() returns text
             language sql stable as $$ select '${fid}'::text $$`);

    // Проходим хронику узлами, как это делает клиент. Сроки сбиваем: иначе
    // прогон упрётся в выдержку на шесть часов.
    const шаг = async (node, flags, ending) => {
      await q(`update public.precursor_saga set updated_at = now() - interval '9 days'
                where faction_id = $1 and world = $2`, [fid, world]);
      return (await q(`select public.precursor_saga_step($1,$2,$3,$4) j`,
        [world, node, flags ? JSON.stringify(flags) : null, ending || null]))[0].j;
    };

    await шаг('p1'); await шаг('p2'); await шаг('w_1'); await шаг('k0');
    let r = await шаг('k_ряд', { подход: 'ряд' });
    console.log('после первой развилки, посланник:', JSON.stringify(r.посланник));
    await шаг('d0'); await шаг('d1');
    await шаг('d_правда', { летопись: 'правда' });
    await шаг('w_2'); await шаг('r0');
    r = await шаг('r_хран', { голос: 'Хранители' });
    console.log('после третьей главы, посланник:', JSON.stringify(r.посланник));
    await шаг('f_отчёт'); await шаг('f0');
    r = await шаг('f_уговор', { ваше: 'уговор' });
    await шаг('w_3'); await шаг('z');
    r = await шаг('end_побратим', null, 'побратим');
    console.log('\nисход записан:', JSON.stringify(r.мир));
    console.log('цена исхода:', JSON.stringify(r.pay));
    console.log('посланник в конце:', JSON.stringify(r.посланник));

    const g = (await q(`select public.precursor_saga_get() j`))[0].j;
    const row = g.rows[0];
    console.log('\nчтение: встреча в новых мирах =', g.me['встреча']);
    console.log('память мира о вас:',
      JSON.stringify((await q(`select строка from public.pc_record
                                where world=$1 and faction_id=$2`, [world, fid]))[0]));
    const l = (await q(`select public.pc_risen_list() j`))[0].j;
    console.log('витрина:', JSON.stringify(l.worlds[0]));
  } catch (e) {
    console.error('ОШИБКА:', e.message);
  }
  await c.query('ROLLBACK');
  console.log('\n(откат: в базе ничего не осталось)');
  await c.end();
})();
