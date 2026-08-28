// ════════════════════════════════════════════════════════════════════════
//  Наполнение словаря интерфейса переводом.
//
//  Гоняется РАЗ, руками, здесь — а не у игрока в браузере. Результат ложится
//  в i18n/en.json и дальше живёт как обычный файл репозитория: правится,
//  вычитывается, спорные места переписываются вручную.
//
//  Запуск:   node tools/i18n_fill.js            — добить непереведённое
//            node tools/i18n_fill.js --limit 500 — только первые N (проба)
//            node tools/i18n_fill.js --force     — перевести заново всё
//
//  Что НЕ трогаем:
//   • глоссарий (i18n/glossary.json) — термины, названия валют, аббревиатуры;
//     он всегда сильнее машины;
//   • аббревиатуры из заглавных («ГС», «ОН») — машина делает из них чушь;
//   • строки без букв.
// ════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const SRC   = path.join(__dirname, 'strings.ru.json');
const OUT   = path.join(ROOT, 'i18n', 'en.json');
const GLOSS = path.join(ROOT, 'i18n', 'glossary.json');

const URL = 'https://pgngkkiiopymvrcozvvr.supabase.co/functions/v1/translate';
const KEY = 'sb_publishable_f_xjq0WQcf2AUdHWjk1-XQ_BDLpsoiS';

const BATCH = 30;    // фраз в одном рейсе
const PAR   = 4;     // рейсов одновременно — больше провоцирует 429

const args  = process.argv.slice(2);
const FORCE = args.includes('--force');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) || 0 : 0;
})();

const readJson = (p, def) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return def; }
};

// Машине такое отдавать нельзя: аббревиатуры она разворачивает в случайные
// слова, а места под подстановку ({0}) переставляет или теряет.
function skip(s) {
  if (!/[А-ЯЁа-яё]{2}/.test(s)) return true;
  const letters = s.replace(/[^А-ЯЁа-яё]/g, '');
  if (letters.length <= 3 && letters === letters.toUpperCase()) return true;
  return false;
}

// Места под значения должны пережить перевод. Прячем их за токенами, которые
// переводчик не трогает, и возвращаем на место в ответе.
const mask = s => s.replace(/\{(\d+)\}/g, (_, k) => `[[${k}]]`);
const unmask = s => s.replace(/\[\[\s*(\d+)\s*\]\]/g, (_, k) => `{${k}}`);

function holesOk(ru, en) {
  const a = (ru.match(/\{\d+\}/g) || []).sort().join(',');
  const b = (en.match(/\{\d+\}/g) || []).sort().join(',');
  return a === b;
}

async function translate(batch) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: KEY, authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ q: batch.map(mask), to: 'en', from: 'ru' }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return (j.t || []).map(unmask);
}

async function main() {
  const src   = readJson(SRC, null);
  if (!src) { console.error('нет tools/strings.ru.json — сперва node tools/i18n_extract.js'); process.exit(1); }
  const gloss = readJson(GLOSS, {});
  const out   = FORCE ? {} : readJson(OUT, {});

  let todo = Object.keys(src).filter(k => !skip(k) && !gloss[k] && !out[k]);
  if (LIMIT) todo = todo.slice(0, LIMIT);

  console.log('в словаре фраз:', Object.keys(src).length);
  console.log('уже переведено:', Object.keys(out).length, '| в глоссарии:', Object.keys(gloss).length);
  console.log('к переводу:    ', todo.length);
  if (!todo.length) return;

  const parts = [];
  for (let i = 0; i < todo.length; i += BATCH) parts.push(todo.slice(i, i + BATCH));

  let done = 0, failed = 0, dropped = 0;
  const t0 = Date.now();

  for (let i = 0; i < parts.length; i += PAR) {
    const wave = parts.slice(i, i + PAR);
    const res = await Promise.all(wave.map(async (b) => {
      try { return await translate(b); } catch (e) { return null; }
    }));

    res.forEach((tr, k) => {
      const batch = wave[k];
      if (!tr) { failed += batch.length; return; }
      batch.forEach((ru, n) => {
        const en = tr[n];
        if (!en || en === ru) { failed++; return; }
        // Перевод, потерявший место под значение, испортит строку в игре.
        if (!holesOk(ru, en)) { dropped++; return; }
        out[ru] = en;
        done++;
      });
    });

    // Пишем по ходу: прогон длинный (16 900 фраз, ~15 минут), обрыв не должен
    // стоить всей работы — повторный запуск добирает только непереведённое.
    fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');
    const pct = Math.round(((i + wave.length) / parts.length) * 100);
    process.stdout.write(`\r${pct}% · переведено ${done} · сбоев ${failed} · отброшено ${dropped}   `);
  }

  console.log('\nготово за', Math.round((Date.now() - t0) / 1000) + 'с');
  console.log('в словаре теперь:', Object.keys(out).length, 'фраз →', path.relative(ROOT, OUT));
}

main();
