// ── СНИМОК ХРОНИКИ ───────────────────────────────────────────────────────────
// Собирает миры по всем сочетаниям расы, среды, века, состояния надлома и
// доктрины и складывает ВЕСЬ их текст в один файл. Нужен для правок, которые
// обязаны ничего не менять: вынос текста в полки, замена функции шаблоном,
// перестановка слоёв. Сверка — побайтовая.
//
//   node tools/saga_snap.js > _snap_до.txt
//   … правка …
//   node tools/saga_snap.js > _snap_после.txt
//   node tools/saga_snap.js --diff _snap_до.txt
'use strict';
const fs = require('fs');
const Weave = require('../saga_weave.js');
const Layers = require('../saga_layers.js');

const ENVS = ['океанический', 'пустыня', 'джунгли', 'горный хребет', 'тундра',
              'вулканический', 'болота', 'степь', 'равнина'];
const РАСЫ = Object.keys(Weave.RACE);
const ДОКТРИНЫ = Object.keys(Weave.DOCTRINE);
const ВЕКА = [0, 3, 6, 9, 10, 11];
const СОСТ = ['', 'затянувшийся', 'переписанный', 'изжитый', 'вскрытый'];

// Кадр бывает функцией от флагов: снимаем все ветви, иначе правка внутри
// развилки пройдёт мимо сверки.
const ФЛАГИ = [{}, { летопись: 'правда' }, { летопись: 'полу' },
               { летопись: 'подлог' }, { летопись: 'умолчание' },
               { голос: 'Смутьяны' }, { голос: 'Отверженные' }];

function текст(x) {
  if (typeof x === 'string') return [x];
  if (typeof x !== 'function') return [];
  const out = new Set();
  ФЛАГИ.forEach(f => { try { out.add(String(x(f))); } catch (e) { out.add('ОШИБКА: ' + e.message); } });
  return [...out];
}

// Строки складываем в МНОЖЕСТВО, а не в список: 30 тысяч миров дают один и
// тот же кадр тысячи раз, и полный список весит сотни мегабайт. Сверять надо
// набор фраз, какие хроника вообще способна выдать, — он и меняется от правки.
function снимок() {
  const набор = new Set();
  const строки = { push: s => набор.add(s), join: sep => [...набор].sort().join(sep) };
  РАСЫ.forEach(r => ENVS.forEach(e => ВЕКА.forEach(p => СОСТ.forEach(s => ДОКТРИНЫ.forEach(d => {
    const W = Weave.world(
      { system_id: 11, pid: 3, races: [r], env: e, phase: p, state: s, self_name: 'Проба' },
      { race: 'Гуманоиды', ideology: d, envoy: 'Посланник' });
    W.живое = () => ({ память: [], посланник: {} });
    W.fateList = Weave.FATES;
    const B = Layers.build(W);
    строки.push('══ ' + [r, e, 'E' + p, s || '—', d].join(' | '));
    Object.keys(B.NODES).sort().forEach(id => {
      const n = B.NODES[id];
      строки.push('  # ' + id + ' ch=' + (n.ch || '') + ' who=' + (n.who || '')
        + ' go=' + (typeof n.go === 'function' ? 'fn' : (n.go || '')) + ' end=' + (n.end || ''));
      (n.t || []).forEach(x => текст(x).forEach(t => строки.push('    . ' + t)));
      (n.ask || []).forEach(a => строки.push('    > ' + a.t + ' → ' + a.to
        + ' set=' + JSON.stringify(a.set) + ' вес=' + (a.вес == null ? '' : a.вес)
        + ' cost=' + JSON.stringify(a.cost || null) + ' tail=' + (a.tail || '')));
    });
  })))));
  return строки.join('\n');
}

const s = снимок();
const arg = process.argv[2];
if (arg === '--diff') {
  const был = fs.readFileSync(process.argv[3], 'utf8');
  if (был === s) { console.log('снимок совпал побайтово (' + s.split('\n').length + ' строк)'); process.exit(0); }
  const a = был.split('\n'), b = s.split('\n');
  console.log('РАЗОШЛОСЬ. строк было ' + a.length + ', стало ' + b.length);
  let n = 0;
  for (let i = 0; i < Math.max(a.length, b.length) && n < 20; i++) {
    if (a[i] !== b[i]) { n++; console.log('  ' + i + '\n    было:  ' + a[i] + '\n    стало: ' + b[i]); }
  }
  process.exit(1);
}
process.stdout.write(s);
