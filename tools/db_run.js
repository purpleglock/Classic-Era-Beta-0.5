// Прогон SQL-файлов в Supabase. Пароль/URL берётся из .env (DATABASE_URL).
// Использование: node tools/db_run.js file1.sql file2.sql ...
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('НЕТ DATABASE_URL в .env'); process.exit(1); }
  const files = process.argv.slice(2);
  if (!files.length) { console.error('Укажи файлы: node tools/db_run.js a.sql b.sql'); process.exit(1); }

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Подключено к базе.\n');

  for (const f of files) {
    const sql = fs.readFileSync(path.resolve(f), 'utf8');
    process.stdout.write(`>>> ${f} ... `);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log('OK');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.log('ОШИБКА (откат)');
      console.error('    ' + (e.message || e));
      await client.end();
      process.exit(1);
    }
  }
  await client.end();
  console.log('\nГотово. Все файлы применены.');
}
main().catch(e => { console.error(e); process.exit(1); });
