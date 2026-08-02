// Прогон SQL-файлов в транзакции с ROLLBACK (тест наката без применения):
//   node tools/db_try.js миграция.sql [проверка.sql ...]
// Печатает результат последнего запроса каждого файла и ВСЕГДА откатывает.
const fs = require('fs'), path = require('path'), { Client } = require('pg');
const p = path.join(__dirname, '..', '.env');
if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('begin');
  await c.query("set local statement_timeout = 0");
  try {
    for (const f of process.argv.slice(2)) {
      const r = await c.query(fs.readFileSync(f, 'utf8'));
      const last = Array.isArray(r) ? r.filter(x => x && x.rows && x.rows.length).pop() : r;
      console.log('── ' + path.basename(f));
      if (last && last.rows && last.rows.length) console.table(last.rows);
    }
  } catch (e) { console.error('ОШИБКА: ' + e.message); }
  await c.query('rollback');
  await c.end();
})();
