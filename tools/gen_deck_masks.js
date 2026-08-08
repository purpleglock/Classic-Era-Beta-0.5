// ── ГЕНЕРАТОР МАСОК ПАЛУБЫ ДЛЯ СЕРВЕРА ─────────────────────────────────────────
// Синергия модулей считается по СОСЕДСТВУ клеток, значит серверу нужна та же
// решётка, что у клиента: ширина/высота и какие клетки вообще палуба. Тащить в SQL
// полигон корпуса и точку-в-многоугольнике не нужно — форма классов фиксирована,
// поэтому маску печём здесь один раз и кладём в таблицу справочником.
//
// Запуск:  node tools/gen_deck_masks.js > _cn_deck_masks.sql
// Перегенерировать ОБЯЗАТЕЛЬНО, если менялись CN_SHIP_DIM, CN_HULL_PROFILES,
// CN_DECK_CELL или cnDeckGeo/cnDeckZones — иначе сервер и клиент разъедутся.
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = { console };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = {
  getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }),
  addEventListener() {}, body: { appendChild() {} },
};
ctx.localStorage = { getItem: () => null, setItem() {} };
ctx.setTimeout = setTimeout; ctx.location = { search: '' }; ctx.navigator = { userAgent: '' };
vm.createContext(ctx);
const run = f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
run('hull_gen.js');
run('constructors.js');

// Классы, у которых на палубе вообще что-то стоит (зеркало _cn_mod_slots).
// ⚠️ 'colossus' СЮДА НЕ ДОБАВЛЯТЬ: его корпус рисует игрок, маска у каждого проекта
// своя и печётся на сервере из data.hull (_cn_hull_mask, файл _colossus_hull.sql).
const CLASSES = [
  'corvette', 'destroyer', 'supportCarrier', 'mediumCruiser', 'hyperCruiser',
  'multiroleCarrier', 'battleship', 'dreadnought', 'ss13',
  'btr', 'tanki', 'aviacia', 'vertihui', 'arta', 'mla', 'peh', 'dron', 'dronkos',
];

// Клетки пакуем в hex-строку по одному биту на клетку (порядок = индекс в bays).
function packBits(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i += 4) {
    let v = 0;
    for (let b = 0; b < 4; b++) if (arr[i + b]) v |= 1 << b;
    out.push(v.toString(16));
  }
  return out.join('');
}
const q = s => "'" + String(s).replace(/'/g, "''") + "'";

const rows = [];
for (const k of CLASSES) {
  // CN объявлен через const — в объект контекста он не попадает, берём из лексики
  const G = vm.runInContext('CN._dg = null; cnDeckGeo(' + JSON.stringify(k) + ')', ctx);
  const band = i => G.band[i] === 'bow' ? 1 : G.band[i] === 'mid' ? 2 : G.band[i] === 'stern' ? 3 : 0;
  rows.push([
    q(k), G.w, G.h, G.n,
    q(packBits(G.inside)), q(packBits(G.outer)), q(packBits(G.skin)),
    q(G.band.map((_, i) => band(i)).join('')),
  ].join(','));
}

process.stdout.write(`-- СГЕНЕРИРОВАНО tools/gen_deck_masks.js — руками не править.
-- Маска палубы: та же решётка, что у клиента (cnDeckGeo/cnDeckZones).
--   inside — клетка накрыта корпусом (сюда ставят модули, узлы, шину)
--   outer  — клетка ЗА обшивкой, примыкает к корпусу (навесная броня)
--   skin   — клетка палубы с выходом на борт (нужна сенсорам/РЭБ/ПРО)
--   band   — 1 нос · 2 мидель · 3 корма · 0 не палуба
-- inside/outer/skin — hex, 1 бит на клетку, младший бит = меньший индекс.
create table if not exists public.cn_deck_mask(
  class text primary key,
  w int not null, h int not null, cells int not null,
  inside text not null, outer_ text not null, skin text not null, band text not null);
alter table public.cn_deck_mask enable row level security;
drop policy if exists cn_deck_mask_read on public.cn_deck_mask;
create policy cn_deck_mask_read on public.cn_deck_mask for select using (true);
revoke insert, update, delete on public.cn_deck_mask from anon, authenticated;

truncate public.cn_deck_mask;
insert into public.cn_deck_mask(class,w,h,cells,inside,outer_,skin,band) values
${rows.map(r => '  (' + r + ')').join(',\n')};
`);
