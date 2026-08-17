// Проверка цены и чаши: списывается ли груз, занимается ли слот исследования,
// складываются ли веса решений. Всё в транзакции, откат.
//   node tools/pc_cost_probe.js
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
    const fid = (await q(`select faction_id from public.faction_economy
                           order by gc desc limit 1`))[0].faction_id;
    const world = 'civ:probe:1';
    await q(`create or replace function public._ec_my_fid() returns text
             language sql stable as $$ select '${fid}'::text $$`);

    // Кладём на склад ровно 30 дейтерия: на первую цену хватит, на вторую нет.
    await q(`update public.faction_economy
                set resources = jsonb_set(coalesce(resources,'{}'::jsonb),
                      '{Дейтерий}', '30'::jsonb, true)
              where faction_id = $1`, [fid]);

    const слоты = async () => (await q(`select public._research_slots($1) n`, [fid]))[0].n;
    const склад = async () => (await q(`select (resources->>'Дейтерий')::numeric n
                                          from public.faction_economy
                                         where faction_id=$1`, [fid]))[0].n;
    const шаг = async (node, flags, cost, вес) => {
      await q(`update public.precursor_saga set updated_at = now() - interval '9 days'
                where faction_id = $1 and world = $2`, [fid, world]);
      return (await q(`select public.precursor_saga_step($1,$2,$3,null,$4,$5) j`,
        [world, node, flags ? JSON.stringify(flags) : null,
         cost ? JSON.stringify(cost) : null, вес || 0]))[0].j;
    };

    console.log('слотов до:', await слоты(), '· дейтерий:', await склад());

    let r = await шаг('p1', null, null, 2);
    console.log('\nшаг без цены, вес +2 → чаша', r.scale);

    r = await шаг('k1', null, { 'груз': { id: 'Дейтерий', n: 13 }, 'срок': 2 }, 2);
    console.log('шаг с ценой 13 + срок 2 → ok', r.ok, '· чаша', r.scale,
                '· списано', JSON.stringify(r.cost));
    console.log('  дейтерий:', await склад(), '· слотов:', await слоты());

    r = await шаг('k2', null, { 'груз': { id: 'Дейтерий', n: 40 } }, -3);
    console.log('\nшаг, на который не хватает → ok', r.ok, '·', r.err);
    console.log('  дейтерий:', await склад(), '(не тронут)');
    const узел = (await q(`select node, scale from public.precursor_saga
                            where faction_id=$1 and world=$2`, [fid, world]))[0];
    console.log('  узел остался', узел.node, '· чаша', узел.scale, '(не сдвинулась)');

    r = await шаг('k3', null, null, -1);
    console.log('\nшаг вниз, вес −1 → чаша', r.scale);
    await шаг('k1', null, null, 0);        // вернулись на уже пройденный k1
    r = await шаг('k4', null, null, 3);    // и решаем его ВТОРОЙ раз
    console.log('решение на пройденном узле, вес +3 → чаша', r.scale, '(не растёт)');
  } catch (e) {
    console.error('ОШИБКА:', e.message);
  }
  await c.query('ROLLBACK');
  console.log('\n(откат: в базе ничего не осталось)');
  await c.end();
})();
