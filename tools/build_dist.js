/*
 * Сборка продакшен-версии в dist/ для Vercel.
 * 1) В деплой попадает ТОЛЬКО белый список (никаких *.sql, tools/, supabase/ и т.п.).
 * 2) Все корневые *.js минифицируются terser'ом: локальные имена → однобуквенные,
 *    комментарии/форматирование удаляются. Глобальные имена НЕ трогаем —
 *    на них держатся inline onclick-обработчики и связи между файлами.
 */
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const COPY_DIRS  = ['css', 'assets', 'legal'];
const COPY_FILES = ['index.html', 'LICENSE'];

const BANNER = '/*! (c) Setis241. Proprietary. All rights reserved. Unauthorized copying prohibited. */';

const TERSER_OPTS = {
  compress: { passes: 2 },
  mangle: true, // toplevel НЕ включать: глобальные функции зовутся из inline onclick и соседних файлов
  format: { comments: false, preamble: BANNER }
};

// fs.cpSync крэшит Node 24 на Windows (STATUS_STACK_BUFFER_OVERRUN) — копируем сами
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.name.startsWith('_')) continue; // дев-манифесты (_IMAGES.md и т.п.) не публикуем
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

async function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  for (const d of COPY_DIRS) {
    const src = path.join(ROOT, d);
    if (fs.existsSync(src)) {
      copyDir(src, path.join(DIST, d));
      console.log('copy dir  ' + d + '/');
    }
  }
  for (const f of COPY_FILES) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(DIST, f));
      console.log('copy file ' + f);
    }
  }

  const jsFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  let before = 0, after = 0;
  for (const f of jsFiles) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const out = await minify({ [f]: code }, TERSER_OPTS);
    if (!out.code) throw new Error('terser вернул пусто для ' + f);
    fs.writeFileSync(path.join(DIST, f), out.code, 'utf8');
    before += code.length; after += out.code.length;
    console.log('minify    ' + f.padEnd(22) + (code.length / 1024).toFixed(0) + 'K -> ' + (out.code.length / 1024).toFixed(0) + 'K');
  }
  console.log('JS итого: ' + (before / 1024).toFixed(0) + 'K -> ' + (after / 1024).toFixed(0) + 'K');
}

main().catch(e => { console.error(e); process.exit(1); });
