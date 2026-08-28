// ════════════════════════════════════════════════════════════════════════
//  Извлечение русских строк интерфейса в словарь.
//
//  Интерфейс написан по-русски прямо в шаблонах — 75 файлов, десятки тысяч
//  мест. Переписывать каждое место на T('ключ') значит месяц правок и риск
//  сломать вёрстку, поэтому идём иначе: собираем ФРАЗЫ в словарь, словарь
//  лежит в репозитории и правится руками, а подстановка делается на выходе
//  рендера (i18n_dict.js) — мгновенно и без сети.
//
//  Запуск:  node tools/i18n_extract.js
//  Выход:   tools/strings.ru.json — { "фраза": ["файл:строка", …] }
//
//  Что берём: русский текст внутри строковых литералов ('…', "…", `…`).
//  Что не берём: комментарии и вёрстку без слов.
// ════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT  = path.join(__dirname, 'strings.ru.json');   // рабочий файл, игроку не раздаётся

const SKIP_FILES = new Set(['saga_text_out.js']);
const HOLE = '';   // метка места под подстановку ${…}

function isCode(f) {
  return f.endsWith('.js') && !f.startsWith('_') && !SKIP_FILES.has(f);
}

// ── Разбор литералов посимвольно. Регулярка на кавычки с экранированием
//    на файлах по 10 000 строк уходит в экспоненциальный откат и вешает
//    процесс — проверено. Проход линеен и заодно честно отличает строку
//    от комментария.
function literals(src) {
  const out = [];
  let i = 0, line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }

    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      const q = c, start = line;
      let buf = '';
      i++;
      while (i < n) {
        const d = src[i];
        if (d === '\\') { buf += (src[i + 1] === 'n' ? '\n' : src[i + 1]); i += 2; continue; }
        if (d === q) { i++; break; }

        // ── Внутрь ${…} НАДО заходить: там лежат подписи, переданные
        //    аргументами — `${row('neb', …, 'Туманности', …)}`. Пока мы
        //    выбрасывали подстановку целиком, вся панель слоёв карты в
        //    словарь не попадала и оставалась русской. Поэтому вырезаем
        //    выражение, разбираем его как код и продолжаем строку.
        if (q === '`' && d === '$' && src[i + 1] === '{') {
          let depth = 1, j = i + 2;
          while (j < n && depth) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') depth--;
            else if (src[j] === '\n') line++;
            j++;
          }
          for (const inner of literals(src.slice(i + 2, j - 1))) out.push([inner[0], start]);
          buf += HOLE;                 // на месте выражения — место под значение
          i = j;
          continue;
        }

        if (d === '\n') { line++; if (q !== '`') break; }   // незакрытая кавычка — бросаем
        buf += d;
        i++;
      }
      out.push([buf, start]);
      continue;
    }
    i++;
  }
  return out;
}

// Ключ словаря обязан совпадать с тем, что игрок УВИДИТ в готовом узле,
// иначе подставлять будет не по чему. Поэтому ${…} превращаем в место под
// значение ({0}, {1}), из вёрстки достаём текст МЕЖДУ тегами, а фразу не
// рвём по словам: «Тишина в эфире.» — одна запись словаря, а не две.
function clean(s) {
  let out = s.replace(/[ \t\n\r]+/g, ' ').trim();
  // Висящая пунктуация по краям принадлежит вёрстке, а не фразе.
  out = out.replace(/^[·•|,:;]+ ?/, '').replace(/ ?[·•|]+$/, '').trim();
  if (!/[А-ЯЁа-яё]{2}/.test(out)) return '';
  return out.length >= 2 ? out : '';
}

function holes(s) {
  const parts = s.split(HOLE);
  if (parts.length === 1) return s;
  let out = parts[0];
  for (let k = 1; k < parts.length; k++) out += '{' + (k - 1) + '}' + parts[k];
  return out.trim();
}

// Надписи прячутся и в АТРИБУТАХ: подсказки (title), подписи полей
// (placeholder) и — главное — собственные атрибуты разметки вроде
// data-chap="Совет", из которых потом строится меню. Разрезав литерал по
// тегам, мы их теряли: пункты «Совет» и «Канцелярия» так и остались
// русскими в переведённом кабинете.
const ATTR_RX = /(?:title|placeholder|aria-label|alt|label|data-[a-z-]+)\s*=\s*"([^"]*)"/gi;

function phrases(lit) {
  const marked = lit.replace(/\$\{[^}]*\}/g, HOLE);
  const out = [];

  for (const m of marked.matchAll(ATTR_RX)) {
    const c = clean(m[1]);
    if (c) out.push(holes(c));
  }

  const pieces = marked.includes('<') ? marked.split(/<[^>]*>/) : [marked];
  for (const piece of pieces) {
    const c = clean(piece);
    if (c) out.push(holes(c));
  }
  return out;
}

function main() {
  const files = fs.readdirSync(ROOT).filter(isCode);
  const dict = new Map();   // фраза → места в коде

  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const [lit, line] of literals(src)) {
      if (!/[А-ЯЁа-яё]/.test(lit)) continue;
      for (const p of phrases(lit)) {
        if (!dict.has(p)) dict.set(p, new Set());
        dict.get(p).add(f + ':' + line);
      }
    }
  }

  // index.html — тоже интерфейс: шапка, модалки, подписи кнопок.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
                 .replace(/<script[\s\S]*?<\/script>/g, '');
  for (const p of phrases(html)) {
    if (!dict.has(p)) dict.set(p, new Set());
    dict.get(p).add('index.html');
  }

  const sorted = [...dict.entries()].sort((a, b) => b[1].size - a[1].size);
  const obj = {};
  for (const [k, v] of sorted) obj[k] = [...v].slice(0, 4);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(obj, null, 1), 'utf8');

  const chars = sorted.reduce((a, [k]) => a + k.length, 0);
  const tpl = sorted.filter(([k]) => k.includes('{0}')).length;
  console.log('файлов просмотрено:', files.length + 1);
  console.log('уникальных фраз:   ', sorted.length, '(из них с подстановками:', tpl + ')');
  console.log('символов:          ', chars);
  console.log('записано:          ', path.relative(ROOT, OUT));
}

main();
