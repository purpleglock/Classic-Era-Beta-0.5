// ============================================================
// ГЕНЕРАТОР tech_nodes ДЛЯ KV-КАТАЛОГА → _tech_nodes_kv.sql
// Зеркало ecBuildResearch() (economy.js) поверх window.KV_DB:
//  - классы: линейная цепочка 5·2^i (стартеры CN_KV_STARTER — бесплатны, не узлы)
//  - оружие: 12 + i·8, prereq — класс-тир из TREE (зеркало EC_TECH_TREE)
//  - компоненты: фикс-цены (reactor 16, armor 14, shield 16, engine 10, radar 12)
//  - модули: цепочка 8 + i·5
// Плюс миграция faction_economy.research со старых (легаси) ключей на новые.
// Запуск: node tools/gen_tech_nodes_kv.js  → перезаписывает _tech_nodes_kv.sql
// ============================================================
const fs = require('fs');
const path = require('path');

global.window = global.window || {};
require('../constructors_kv.js');
require('../constructors_kv_adapt.js');
const KVD = global.window.KV_DB;
if (!KVD) throw new Error('KV_DB не собрался');

// Зеркало CN_KV_STARTER (constructors.js) — бесплатная база, в дерево не входит
const STARTER = {
  classes: { ship: ['corvette'], ground: ['peh'], aviation: ['dron'] },
  weapons: {
    ship: ['КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ'],
    ground: ['ХОЛОДНОЕ ОРУЖИЕ', 'ЛИЧНОЕ ОРУЖИЕ'],
    aviation: ['БОЕВЫЕ ЧАСТИ (КАМИКАДЗЕ)', 'СТРЕЛКОВОЕ ВООРУЖЕНИЕ'],
  },
};
// Зеркало EC_TECH_TREE (economy.js) — привязка групп/компонентов к классу-тиру
const TREE = {
  ship: {
    weapon: { 'ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ': 'destroyer', 'ВЗРЫВНОЕ ВООРУЖЕНИЕ': 'mediumCruiser', 'АНГАРЫ И АВИАГРУППЫ': 'supportCarrier', 'АВИАГРУППЫ И ДРОНЫ': 'supportCarrier' },
    comp: { engine: 'destroyer', reactor: 'destroyer', armor: 'mediumCruiser', shield: 'mediumCruiser', radar: 'destroyer' },
  },
  ground: {
    weapon: { 'ШТУРМОВОЕ ОРУЖИЕ': 'peh', 'ГРАНАТЫ И МИНЫ': 'peh', 'ПУЛЕМЕТЫ': 'btr', 'ТЯЖЕЛОЕ ВООРУЖЕНИЕ': 'btr', 'ПУЛЕМЕТЫ И ТУРЕЛИ': 'btr', 'КИНЕТИКА': 'tanki', 'ЭНЕРГЕТИКА': 'tanki', 'РАКЕТНОЕ (БУМ)': 'tanki', 'ОСНОВНОЙ КАЛИБР': 'tanki', 'СТВОЛЬНАЯ АРТИЛЛЕРИЯ': 'arta', 'РЕАКТИВНЫЕ СИСТЕМЫ': 'arta' },
    comp: { engine: 'btr', reactor: 'btr', armor: 'tanki', shield: 'tanki', radar: 'btr' },
  },
  aviation: {
    weapon: { 'АВИАПУШКИ': 'aviacia', 'РАКЕТНОЕ ВООРУЖЕНИЕ': 'aviacia', 'ПУШКИ И ТУРЕЛИ': 'vertihui', 'КОСМИЧЕСКОЕ ВООРУЖЕНИЕ': 'dronkos' },
    comp: { engine: 'aviacia', reactor: 'aviacia', armor: 'vertihui', shield: 'dronkos', radar: 'aviacia' },
  },
};

const nodes = [];   // { id, cost, prereq: [] }
for (const cat of ['ship', 'ground', 'aviation']) {
  const db = KVD[cat], t = TREE[cat];
  const baseCls = STARTER.classes[cat], baseW = STARTER.weapons[cat];
  const clsId = k => (k && !baseCls.includes(k) && db.data[k]) ? ['cls.' + cat + '.' + k] : [];
  // классы — цепочка
  let prev = null, ci = 0;
  Object.keys(db.data).forEach(k => {
    if (baseCls.includes(k)) return;
    const id = 'cls.' + cat + '.' + k;
    nodes.push({ id, cost: 5 * Math.pow(2, ci), prereq: prev ? [prev] : [] });
    prev = id; ci++;
  });
  // оружие
  let wi = 0;
  Object.keys(db.weapons).forEach(g => {
    if (baseW.includes(g)) return;
    nodes.push({ id: 'wpn.' + cat + '.' + g, cost: 12 + wi * 8, prereq: clsId(t.weapon[g]) });
    wi++;
  });
  // компоненты (radar — если в каталоге есть радары)
  const comps = [['reactor', 16], ['armor', 14], ['shield', 16], ['engine', 10]];
  if (db.radars) comps.push(['radar', 12]);
  comps.forEach(([c, cost]) => nodes.push({ id: 'comp.' + cat + '.' + c, cost, prereq: clsId(t.comp[c]) }));
  // модули — цепочка
  let prevMod = null, mi = 0;
  Object.keys(db.modules).forEach(g => {
    const id = 'mod.' + cat + '.' + g;
    nodes.push({ id, cost: 8 + mi * 5, prereq: prevMod ? [prevMod] : [] });
    prevMod = id; mi++;
  });
}

// Миграция исследований фракций: старый (легаси) ключ → новый KV-ключ.
// Ключи, ставшие стартерами, просто выпадают (база бесплатна).
const MIGRATE = {
  'cls.ship.frigate': 'cls.ship.destroyer',
  'cls.ship.cruiser': 'cls.ship.mediumCruiser',
  'cls.ground.light': null, 'cls.ground.medium': 'cls.ground.btr',
  'cls.ground.heavy': 'cls.ground.tanki', 'cls.ground.artillery': 'cls.ground.arta',
  'cls.ground.walker': 'cls.ground.tanki',
  'cls.aviation.light': null, 'cls.aviation.medium': 'cls.aviation.aviacia',
  'cls.aviation.heavy': 'cls.aviation.vertihui', 'cls.aviation.cargo': 'cls.aviation.dronkos',
  'wpn.ship.Легкие': null, 'wpn.ship.Средние': null,
  'wpn.ship.Тяжёлые': 'wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ',
  'wpn.ship.Сверхтяжёлые': 'wpn.ship.ВЗРЫВНОЕ ВООРУЖЕНИЕ',
  'wpn.ship.Ракетное': 'wpn.ship.ВЗРЫВНОЕ ВООРУЖЕНИЕ',
  'wpn.ship.Зенитное': 'wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ',
  'wpn.ground.Противопехотное': 'wpn.ground.ШТУРМОВОЕ ОРУЖИЕ',
  'wpn.ground.Противотанковое': 'wpn.ground.ТЯЖЕЛОЕ ВООРУЖЕНИЕ',
  'wpn.ground.Артиллерия и ПВО': 'wpn.ground.СТВОЛЬНАЯ АРТИЛЛЕРИЯ',
  'wpn.aviation.Курсовое вооружение': 'wpn.aviation.АВИАПУШКИ',
  'wpn.aviation.Ракетное и бомбовое': 'wpn.aviation.РАКЕТНОЕ ВООРУЖЕНИЕ',
  'wpn.aviation.Спецоборудование': 'wpn.aviation.КОСМИЧЕСКОЕ ВООРУЖЕНИЕ',
  'mod.ship.Радарное оборудование': 'comp.ship.radar',
  'mod.ship.Радиоэлектронная борьба': 'mod.ship.Модули радиотумана',
  'mod.ship.Активная защита': 'mod.ship.Конструкционные модули',
  'mod.ship.Управление': 'mod.ship.Конструкционные модули',
  'mod.ship.Спец. системы': 'mod.ship.Модули станции',
  'mod.ground.Оптика и Связь': 'mod.ground.Конструкционные модули',
  'mod.ground.Защита и Поддержка': 'mod.ground.Десант',
  'mod.aviation.Авионика и Радары': 'mod.aviation.Конструкционные модули',
  'mod.aviation.Защита и РЭБ': 'mod.aviation.Конструкционные модули',
  'mod.aviation.Служебные': 'mod.aviation.Десант',
  'hangar.ship': 'wpn.ship.АНГАРЫ И АВИАГРУППЫ',
  'hangar.ship.heavy': 'wpn.ship.АВИАГРУППЫ И ДРОНЫ',
};

const q = s => s.replace(/'/g, "''");
const values = nodes.map(n => `('${q(n.id)}',${n.cost},'${q(JSON.stringify(n.prereq))}')`).join(',\n');
const keepIds = nodes.map(n => `'${q(n.id)}'`).join(',');
const migPairs = Object.entries(MIGRATE).map(([o, n]) => `('${q(o)}',${n ? `'${q(n)}'` : 'null'})`).join(',\n  ');

const sql = `-- ============================================================
-- tech_nodes ДЛЯ KV-КАТАЛОГА (АВТОГЕН) — НЕ РЕДАКТИРОВАТЬ РУКАМИ
-- Источник: constructors_kv*.js. Перегенерация: node tools/gen_tech_nodes_kv.js
-- Применять в Supabase ПОСЛЕ _research_total.sql (и ВМЕСТЕ с выкатом клиента,
-- где CN_BASE = стартеры: без клиента игроки не увидят замки, без SQL сервер
-- не примет новые id). Идемпотентно.
--
-- 1) Ресид каталога узлов конструктора под KV-классы/группы (политика pol.* не
--    трогается). 2) Миграция faction_economy.research: легаси-ключи → KV-ключи,
--    ключи-стартеры выпадают (база бесплатна), мусор чистится. 3) Overlay
--    стаффских правок связей (tech_prereq) переприменяется.
-- ============================================================

-- ── 1) Каталог: KV-узлы конструктора ──
insert into public.tech_nodes (node_id, base_cost, prereq) values
${values}
on conflict (node_id) do update
  set base_cost = excluded.base_cost, prereq = excluded.prereq;

-- Старые узлы конструктора, которых нет в KV-дереве — убрать (pol.* остаются)
delete from public.tech_nodes
 where (node_id like 'cls.%' or node_id like 'wpn.%' or node_id like 'comp.%'
     or node_id like 'mod.%' or node_id like 'type.%' or node_id like 'hangar.%')
   and node_id not in (${keepIds});

-- ── 2) Миграция исследований фракций: легаси → KV ──
with mig(old_id, new_id) as (values
  ${migPairs}
)
update public.faction_economy e
set research = (
  select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from (
    select coalesce(m.new_id, r.x) as v
    from jsonb_array_elements_text(coalesce(e.research,'[]'::jsonb)) r(x)
    left join mig m on m.old_id = r.x
  ) t
  -- оставляем только живые узлы (KV-дерево + политика); null (стартеры) выпадают
  where v is not null
    and (v like 'pol.%' or exists (select 1 from public.tech_nodes n where n.node_id = v))
)
where coalesce(e.research,'[]'::jsonb) <> '[]'::jsonb;

-- Очередь исследований: выкинуть отовсюду умершие id
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name='faction_economy' and column_name='research_queue') then
    update public.faction_economy e
    set research_queue = (
      select coalesce(jsonb_agg(x), '[]'::jsonb)
      from jsonb_array_elements_text(coalesce(e.research_queue,'[]'::jsonb)) r(x)
      where exists (select 1 from public.tech_nodes n where n.node_id = x))
    where coalesce(e.research_queue,'[]'::jsonb) <> '[]'::jsonb;
  end if;
  if exists (select 1 from information_schema.columns
             where table_name='faction_economy' and column_name='research_slots') then
    update public.faction_economy e
    set research_slots = (
      select coalesce(jsonb_agg(x), '[]'::jsonb)
      from jsonb_array_elements_text(coalesce(e.research_slots,'[]'::jsonb)) r(x)
      where exists (select 1 from public.tech_nodes n where n.node_id = x))
    where coalesce(e.research_slots,'[]'::jsonb) <> '[]'::jsonb;
  end if;
end $$;

-- ── 3) Overlay стаффских правок связей поверх сида ──
do $$ begin
  if to_regclass('public.tech_prereq') is not null then
    update public.tech_nodes n
       set prereq = tp.prereq
      from public.tech_prereq tp
     where tp.node_id = n.node_id
       and n.prereq is distinct from tp.prereq;
    -- правки, указывающие на умершие узлы — убрать, чтобы не блокировали дерево
    delete from public.tech_prereq tp
     where not exists (select 1 from public.tech_nodes n where n.node_id = tp.node_id);
  end if;
end $$;

-- Проверка:
-- select count(*) from public.tech_nodes where node_id like 'cls.%';  -- ${nodes.filter(n => n.id.startsWith('cls.')).length}
-- select count(*) from public.tech_nodes;  -- KV-узлов: ${nodes.length} (+ pol.*)
`;

fs.writeFileSync(path.join(__dirname, '..', '_tech_nodes_kv.sql'), sql, 'utf8');
console.log('OK → _tech_nodes_kv.sql (' + nodes.length + ' узлов)');
