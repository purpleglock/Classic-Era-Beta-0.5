// ============================================================
// ГЕНЕРАТОР КАТАЛОГА ЮНИТОВ: constructors.js → _unit_catalog.sql
// Извлекает data-литералы конструктора и печатает их одним jsonb-документом
// в SQL-функцию public._cn_catalog(). Сервер (economy_publish_unit) считает
// по нему cost/on/bill/ttx — это закрывает форж summary/data.
//
// Запуск:  node tools/gen_unit_catalog.js
// После любой правки чисел/таблиц в constructors.js — перегенерь и примен| SQL.
// ============================================================
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'constructors.js');
const OUT = path.join(__dirname, '..', '_unit_catalog.sql');
const text = fs.readFileSync(SRC, 'utf8');

// Вытащить literal после `const NAME = ` балансировкой скобок (учёт строк)
function extract(name) {
  const m = text.indexOf('const ' + name + ' =');
  if (m < 0) throw new Error('not found: ' + name);
  let i = text.indexOf('=', m) + 1;
  while (/\s/.test(text[i])) i++;
  const open = text[i], close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) throw new Error('bad literal start for ' + name + ': ' + open);
  let depth = 0, str = null, esc = false;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (str) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === str) str = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { str = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return text.slice(i, j + 1); }
  }
  throw new Error('unbalanced literal for ' + name);
}
function evalLit(name) { return eval('(' + extract(name) + ')'); }

const catalog = {
  ship: evalLit('CN_SHIP'),
  ground: evalLit('CN_GROUND'),
  aviation: evalLit('CN_AIR'),
  divData: evalLit('CN_DIV_DATA'),
  hullBill: evalLit('CN_HULL_BILL'),
  billDiv: evalLit('CN_BILL_DIV'),
  techSize: evalLit('CN_TECH_SIZE'),
  base: evalLit('CN_BASE'),
  // флаги билдеров (в CN_DEFS лежат вперемешку с функциями excl — берём только флаги)
  defs: {
    ship:     { hasType: true,  hasReactor: true,  hasEnergy: true,  hasHangars: true },
    ground:   { hasType: false, hasReactor: false, hasEnergy: false, hasHangars: false },
    aviation: { hasType: true,  hasReactor: true,  hasEnergy: true,  hasHangars: false },
  },
  divCap: 10000,
};

const json = JSON.stringify(catalog);
// одинарные кавычки внутри json экранируем для SQL-литерала
const sqlJson = json.replace(/'/g, "''");

const sql = `-- ============================================================
-- КАТАЛОГ ЮНИТОВ (АВТОГЕН) — НЕ РЕДАКТИРОВАТЬ РУКАМИ
-- Источник: constructors.js. Перегенерация: node tools/gen_unit_catalog.js
-- Применять в Supabase ПЕРЕД _unit_publish.sql.
-- ============================================================
create or replace function public._cn_catalog()
returns jsonb language sql immutable as $cn$
  select '${sqlJson}'::jsonb
$cn$;
`;

fs.writeFileSync(OUT, sql, 'utf8');
console.log('OK →', path.relative(path.join(__dirname, '..'), OUT), '(' + json.length + ' bytes jsonb)');
