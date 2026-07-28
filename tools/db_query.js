// Разовый SELECT в базу: node tools/db_query.js "select 1"
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
  const sql = process.argv.slice(2).join(' ');
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const r = await client.query(sql);
    console.log(JSON.stringify(r.rows, null, 1));
  } catch (e) {
    console.log('ОШИБКА: ' + (e.message || e));
  }
  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
