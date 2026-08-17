// Прогон сборщика хроник: собирает несколько разных миров и проверяет, что
// граф глав целый, а два мира с одним крючком дают РАЗНЫЕ сцены.
//   node tools/pc_kit_probe.js
'use strict';
const Weave = require('../saga_weave.js');
const Layers = require('../saga_layers.js');

const МИРЫ = [
  { civ: { system_id: 11, pid: 3, races: ['Гуманоиды'], env: 'океанический', phase: 8, state: 'затянувшийся', self_name: 'Долгая Вода' },
    fac: { race: 'Синтетики / Киборги', ideology: 'Технократия (Культ науки)', envoy: 'Кевен-посланник' } },
  { civ: { system_id: 42, pid: 1, races: ['Литоиды (Каменные)'], env: 'горный хребет', phase: 6, state: 'переписанный', self_name: 'Девять жил' },
    fac: { race: 'Гуманоиды', ideology: 'Индустриализм' } },
  { civ: { system_id: 7, pid: 2, races: ['Инсектоиды'], env: 'джунгли', phase: 4, state: 'вскрытый', self_name: 'Ярус' },
    fac: { race: 'Авианы (Птицеподобные)', ideology: 'Ксенофилия' } },
  { civ: { system_id: 99, pid: 5, races: ['Акватики (Водные)'], env: 'архипелаг', phase: 2, state: '', self_name: 'Придонные' },
    fac: { race: 'Рептилоиды', ideology: 'Милитаризм (Культ силы)' } },
];

function собрать(m) {
  const W = Weave.world(m.civ, m.fac);
  W.живое = () => ({ память: [], посланник: {} });
  W.fateList = Weave.FATES;
  return { W, B: Layers.build(W) };
}

// Обход графа: что достижимо из p0 и куда ведут переходы в пустоту.
function обход(NODES, first) {
  const виден = new Set(), дыры = new Set(), очередь = [first];
  while (очередь.length) {
    const id = очередь.shift();
    if (viд(id)) continue;
    function viд(x) { return viden(x); }
    function viden(x) { return виден.has(x); }
    виден.add(id);
    const n = NODES[id];
    if (!n) { дыры.add(id); continue; }
    const дальше = [];
    if (typeof n.go === 'string') дальше.push(n.go);
    if (typeof n.go === 'function') ['правда', 'полу', 'подлог', 'умолчание'].forEach(л => {
      try { дальше.push(n.go({ летопись: л })); } catch (e) {}
    });
    (n.ask || []).forEach(a => дальше.push(a.to));
    дальше.filter(Boolean).forEach(x => { if (!виден.has(x)) очередь.push(x); });
  }
  return { виден, дыры };
}

const собранные = МИРЫ.map(собрать);
собранные.forEach(({ W, B }) => {
  const { виден, дыры } = обход(B.NODES, B.first);
  const все = Object.keys(B.NODES);
  const сироты = все.filter(k => !виден.has(k));
  console.log('\n══ ' + W.name + '  [' + W.R.short + ', ' + W.EP.век + ', ' + W.E.место + ']');
  console.log('  доктрина: ' + (W.fac.ideology || '—'));
  console.log('  тема:     ' + B.наряд.тема.имя + '  (' + B.наряд.тема.линия + ')');
  console.log('  ружья:    ' + B.наряд.ружья.map(r => r.id).join(', '));
  console.log('  события:  ' + Object.keys(B.наряд.соб).map(k => k + '=' + B.наряд.соб[k].id).join('  '));
  console.log('  груз:     ' + B.наряд.груз.id);
  console.log('  узлов ' + все.length + ', достижимо ' + виден.size
    + (сироты.length ? ', СИРОТЫ: ' + сироты.join(',') : '')
    + (дыры.size ? ', ПЕРЕХОД В ПУСТОТУ: ' + [...дыры].join(',') : ''));
  const реш = все.filter(k => (B.NODES[k].ask || []).length);
  console.log('  решений ' + реш.length + ': ' + реш.map(k => k + '(' + B.NODES[k].ask.length + ')').join(' '));
});

// Две разные хроники обязаны отличаться сценами, а не только словами.
const A = собранные[0].наряд || собранные[0].B.наряд;
const Б = собранные[1].B.наряд;
const одинаковых = ['I', 'II', 'III', 'IV'].filter(k => A.соб[k].id === Б.соб[k].id);
console.log('\nсобытий совпало у первых двух миров: ' + одинаковых.length + ' из 4 '
  + (одинаковых.length ? '(' + одинаковых.join(',') + ')' : ''));
console.log('');
