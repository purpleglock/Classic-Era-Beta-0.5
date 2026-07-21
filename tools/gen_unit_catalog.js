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

// ── СИНТЕЗ (KV): каталог строим из window.KV_DB (адаптер), а не из CN_SHIP/GROUND/AIR.
// Загружаем модули данных+адаптер под shim window. Множества доступности → массивы.
global.window = global.window || {};
require('../constructors_kv.js');
require('../constructors_kv_adapt.js');
const KVD = global.window.KV_DB;
if (!KVD) throw new Error('window.KV_DB не собрался (constructors_kv*.js)');
const CN_KV_SPEEDCOEF = {
  peh: 5, btr: 8, tanki: 8, arta: 8, aviacia: 140, vertihui: 50, dron: 8,
  dronkos: 1000, mla: 1000, corvette: 1000, destroyer: 1000, supportCarrier: 1000,
  mediumCruiser: 1000, hyperCruiser: 1000, multiroleCarrier: 1000,
  battleship: 1000, dreadnought: 1000, ss13: 1,
};
// ── СЛИМ-каталог: только поля, которые читает серверный _cn_recompute
// (_unit_publish.sql). Остальное (описания, карты доступности, сырые KV-параметры,
// ветка army) серверу не нужно — клиент считает по window.KV_DB напрямую. Это
// срезает ~250КБ → ~50КБ, иначе SQL-редактор Supabase давится одним стейтментом.
// ⚠️ порядок массивов НЕ меняем: клиент шлёт {g,idx}, сервер индексирует так же.
function pick(o, keys) { const r = {}; if (!o) return r; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; }
function slimCls(c)  { return pick(c, ['name', 'mass', 'gabarit', 'crewRequired', 'modON', 'baseON', 'resurs']); }
function slimReac(r) { return pick(r, ['force', 'energy', 'resurs']); }
function slimEng(e)  { return pick(e, ['force', 'energy', 'resurs']); }
function slimArm(a)  { return pick(a, ['name', 'material', 'category', 'hpBoost', 'hpPercentBoost', 'armor', 'resurs']); }
function slimShd(s)  { return pick(s, ['shield', 'resurs']); }
function slimRad(r)  { const o = pick(r, ['crewRequired', 'resurs']); const d = r && r.customParameterradar && r.customParameterradar.dalnost; if (d) o.customParameterradar = { dalnost: d }; return o; }
function slimWpn(w)  { const o = pick(w, ['name', 'dmg', 'crewRequired', 'resurs']); const d = w && w.customParameter && +w.customParameter.dalnost; if (d) o.dalnost = d; return o; }
function slimMod(m)  { return pick(m, ['name', 'cost', 'crewRequired', 'resurs']); }
function mapClassColl(coll, fn) { const out = {}; for (const k in coll) out[k] = coll[k].map(fn); return out; }
function mapGroupColl(coll, fn) { const out = {}; for (const g in coll) out[g] = coll[g].map(fn); return out; }
function catFromKv(cat) {
  const db = KVD[cat];
  const out = {
    data:     Object.fromEntries(Object.keys(db.data).map(k => [k, slimCls(db.data[k])])),
    reactors: mapClassColl(db.reactors, slimReac),
    engines:  mapClassColl(db.engines, slimEng),
    armors:   mapClassColl(db.armors, slimArm),
    shields:  mapClassColl(db.shields, slimShd),
    weapons:  mapGroupColl(db.weapons, slimWpn),
    modules:  mapGroupColl(db.modules, slimMod),
  };
  if (db.radars) out.radars = mapClassColl(db.radars, slimRad);
  return out;
}

const catalog = {
  ship: catFromKv('ship'),
  ground: catFromKv('ground'),
  aviation: catFromKv('aviation'),
  // army в каталог НЕ кладём: сервер публикует армейцев под ground/aviation
  // (cnKvRealCat), economy_publish_unit не принимает category='army'.
  divData: evalLit('CN_DIV_DATA'),
  hullBill: evalLit('CN_HULL_BILL'),
  billDiv: evalLit('CN_BILL_DIV'),
  techSize: evalLit('CN_TECH_SIZE'),
  // base: СТАРТЕРЫ (зеркало CN_KV_STARTER/CN_BASE в constructors.js) — остальное
  // сервер гейтит по faction_economy.research (tech_nodes из _tech_nodes_kv.sql).
  base: (function () {
    const S = evalLit('CN_KV_STARTER');
    const b = { classes: {}, weapons: {} };
    for (const cat of ['ship', 'ground', 'aviation']) {
      b.classes[cat] = S.classes[cat].filter(k => KVD[cat].data[k]);
      b.weapons[cat] = S.weapons[cat].filter(g => KVD[cat].weapons[g]);
    }
    return b;
  })(),
  speedcoef: CN_KV_SPEEDCOEF,
  // KV-классы: без типов/ангаров, реактор есть, энергосеть-гейт выключен (как в CN_DEFS)
  defs: {
    ship:     { hasType: false, hasReactor: true, hasEnergy: false, hasHangars: false },
    ground:   { hasType: false, hasReactor: true, hasEnergy: false, hasHangars: false },
    aviation: { hasType: false, hasReactor: true, hasEnergy: false, hasHangars: false },
  },
  divCap: 10000,
};

const json = JSON.stringify(catalog);
// Литерал бьём на короткие куски и склеиваем через ||: одностраничный JSON в
// 80+КБ одной строкой ронял SQL-редактор Supabase («unterminated dollar-quoted
// string» — он обрезал ввод). Каждый кусок — в своём dollar-quote $c$…$c$ (в JSON
// нет '$', так что коллизии тега невозможны; кавычки экранировать не нужно).
if (json.includes('$c$')) throw new Error('JSON содержит $c$ — смени тег dollar-quote');
const CHUNK = 3800;
const parts = [];
for (let i = 0; i < json.length; i += CHUNK) parts.push('$c$' + json.slice(i, i + CHUNK) + '$c$');
const concat = parts.join(' ||\n    ');

const sql = `-- ============================================================
-- КАТАЛОГ ЮНИТОВ (АВТОГЕН) — НЕ РЕДАКТИРОВАТЬ РУКАМИ
-- Источник: constructors.js (window.KV_DB). Перегенерация: node tools/gen_unit_catalog.js
-- Слим: только поля, нужные серверному _cn_recompute (без описаний/army/сырых KV).
-- Литерал склеен из кусков ('||') — чтобы SQL-редактор не давился длинной строкой.
-- Применять в Supabase ПЕРЕД _unit_publish.sql.
-- ============================================================
create or replace function public._cn_catalog()
returns jsonb language sql immutable as $fn$
  select (
    ${concat}
  )::jsonb
$fn$;
`;

fs.writeFileSync(OUT, sql, 'utf8');
console.log('OK →', path.relative(path.join(__dirname, '..'), OUT), '(' + json.length + ' bytes jsonb, ' + parts.length + ' chunks)');
