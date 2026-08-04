// Приёмник растровых снимков из браузера. Нужен затем, чтобы видеть, что
// реально рисует char_gen.js: страница гонит сюда PNG, скрипт кладёт его
// файлом на диск. Внешних зависимостей нет — только http и fs из ядра.
// Запуск: конфигурация "shots" в .claude/launch.json.
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = process.env.SHOT_DIR || path.join(__dirname, '..', '.shots');
fs.mkdirSync(OUT, { recursive: true });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, CORS); return res.end('post only'); }

  let body = '';
  req.on('data', c => { body += c; if (body.length > 40e6) req.destroy(); });
  req.on('end', () => {
    try {
      const { name, data } = JSON.parse(body);
      const safe = String(name || 'shot').replace(/[^a-z0-9_.-]/gi, '_');
      const b64 = String(data).replace(/^data:[^,]+,/, '');
      const file = path.join(OUT, safe.endsWith('.png') ? safe : safe + '.png');
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      res.writeHead(200, CORS);
      res.end(file);
      console.log('saved', file, Buffer.from(b64, 'base64').length, 'bytes');
    } catch (e) {
      res.writeHead(400, CORS);
      res.end(String(e && e.message));
    }
  });
}).listen(8792, () => console.log('shot sink on 8792 →', OUT));
