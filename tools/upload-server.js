#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Локальный аплоад-сервер портретов оперативников.
//
// Пишет картинки ПРЯМО в папку игры assets/portraits/ — без выбора папки в
// браузере и без Supabase Storage. Запусти рядом с игрой и держи открытым:
//
//     node tools/upload-server.js
//
// Админка (вкладка «Арты») сама найдёт его на http://localhost:8787 и будет
// слать файлы сюда. Сервер кладёт их в assets/portraits/ и возвращает
// относительный путь, который админка пишет в БД. Потом просто публикуешь
// папку вместе с игрой — путь резолвится у всех.
//
// Зависимостей нет — только встроенные модули Node.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT     = process.env.PORT ? Number(process.env.PORT) : 8787;
const ROOT     = path.resolve(__dirname, '..');               // корень проекта
const REL_DIR  = 'assets/portraits';                          // путь от корня сайта (по умолчанию)
const DEST_DIR = path.join(ROOT, 'assets', 'portraits');

// Разрешённые папки назначения (защита от записи куда попало). Ключ — значение
// query ?dir=, значение — путь от корня сайта. Заливка планет шлёт dir=planets.
const ALLOWED_DIRS = {
  portraits: 'assets/portraits',
  planets:   'assets/map/planets',
  guide:     'assets/guide',          // обложки разделов гайдбука (фикс. имя = id раздела)
  ach:       'assets/ach',            // арт ачивок (<id>.webp) + правки подписей (_overrides.json)
  hero:      'assets/hero',           // спрайты персонажей для диалогового окна главной (визуальная новелла)
};
// Возвращает {rel, abs} для папки назначения по query ?dir= (или дефолт-портреты).
function destDir(dirKey) {
  const rel = ALLOWED_DIRS[dirKey] || REL_DIR;
  const abs = path.join(ROOT, ...rel.split('/'));
  fs.mkdirSync(abs, { recursive: true });
  return { rel, abs };
}

const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
const MAX_BYTES   = 12 * 1024 * 1024;                         // 12 МБ потолок на файл

fs.mkdirSync(DEST_DIR, { recursive: true });

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Portrait-Name');
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
// Имя файла безопасно: только из basename, без путей вверх.
function safeName(name) {
  const base = path.basename(String(name || ''));
  return /^[\w.\-]+$/.test(base) ? base : null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  // Пинг — админка проверяет, поднят ли сервер.
  if (req.method === 'GET' && url.pathname === '/ping') {
    return json(res, 200, { ok: true, dir: REL_DIR });
  }

  // Загрузка: тело = сырые байты картинки, метаданные в query (?ext=webp).
  if (req.method === 'POST' && url.pathname === '/upload') {
    const ct  = (req.headers['content-type'] || '').split(';')[0].trim();
    const ext = EXT_BY_MIME[ct] || (url.searchParams.get('ext') || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
    const chunks = []; let size = 0; let aborted = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES) { aborted = true; json(res, 413, { ok: false, error: 'файл слишком большой (>12 МБ)' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      if (!size) return json(res, 400, { ok: false, error: 'пустое тело' });
      const { rel: relDir, abs: absDir } = destDir(url.searchParams.get('dir'));
      // ?name= — фиксированное имя (для заливки классов планет, перезаписью);
      //          иначе случайное (портреты — пул, имена не должны конфликтовать).
      const fixed = safeName(url.searchParams.get('name'));
      const name = fixed ? (/\.[a-z0-9]+$/i.test(fixed) ? fixed : `${fixed}.${ext}`)
                         : `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
      const dest = path.join(absDir, name);
      fs.writeFile(dest, Buffer.concat(chunks), (err) => {
        if (err) { console.error('[upload] write', err); return json(res, 500, { ok: false, error: String(err.message || err) }); }
        const rel = `${relDir}/${name}`;
        console.log(`[upload] +${(size / 1024).toFixed(0)} КБ → ${rel}`);
        json(res, 200, { ok: true, url: rel, name });
      });
    });
    req.on('error', () => { if (!aborted) json(res, 400, { ok: false, error: 'ошибка приёма' }); });
    return;
  }

  // Удаление файла (best-effort) — админка зовёт при удалении портрета из пула.
  if (req.method === 'DELETE' && url.pathname === '/file') {
    const name = safeName(url.searchParams.get('name'));
    if (!name) return json(res, 400, { ok: false, error: 'плохое имя' });
    const { rel: relDir, abs: absDir } = destDir(url.searchParams.get('dir'));
    fs.unlink(path.join(absDir, name), (err) => {
      if (err && err.code !== 'ENOENT') { console.error('[delete]', err); return json(res, 500, { ok: false, error: String(err.message || err) }); }
      console.log(`[delete] ${relDir}/${name}`);
      json(res, 200, { ok: true });
    });
    return;
  }

  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  🎨 Аплоад-сервер портретов запущен`);
  console.log(`     http://localhost:${PORT}  →  ${path.relative(ROOT, DEST_DIR).replace(/\\/g, '/')}/`);
  console.log(`     Держи это окно открытым, пока грузишь арты в админке. Ctrl+C — выход.\n`);
});
