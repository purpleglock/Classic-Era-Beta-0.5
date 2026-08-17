// Сверка партии на ЖИВОЙ базе: совпадают ли цены и постоянные с клиентом
// (precursor_run.js) и стоят ли двери. Ничего не пишет — только читает.
const fs = require('fs'), path = require('path'), { Client } = require('pg');
const JS = require('../precursor_run.js');

function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

(async () => {
  loadEnv();
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  let бед = 0;

  const K = (await c.query('select public._pcr_const() k')).rows[0].k;
  const ждём = { 'срок': JS.СРОК, 'приход': JS.ПРИХОД, 'потолок': JS.ПОТОЛОК, 'предел': JS.ПРЕДЕЛ };
  Object.keys(ждём).forEach(k => {
    const ок = +K[k] === +ждём[k];
    if (!ок) бед++;
    console.log(`${ок ? '✔' : '✘'} ${k}: база ${K[k]}, клиент ${ждём[k]}`);
  });

  // Цены и сдвиги — по каждому действию и на двух уровнях мира.
  // Обряд в `_pcr_act` не живёт вовсе: у него своя дверь (_precursor_run_rite.sql).
  for (const тир of [0, 3]) {
    for (const a of JS.РУКА.filter(x => !x.обряд)) {
      const s = (await c.query('select public._pcr_act($1,$2) a', [a.id, тир])).rows[0].a;
      const пары = [
        ['влияние', +s.att, a.цена],
        ['ГС', +s.gc, JS.ценаГС(a, тир)],
        ['Фонд', +s.rep, a.фонд],
        ['развитие', +s.flow, a.русло],
        ['ущерб', +s.wound, a.надлом],
      ];
      пары.forEach(([имя, б, к]) => {
        if (б !== к) { бед++; console.log(`✘ ${a.id} (тир ${тир}) ${имя}: база ${б}, клиент ${к}`); }
      });
    }
  }
  if (!бед) console.log('✔ цены и сдвиги базы совпадают с клиентом на тирах 0 и 3');

  // Двери на месте и закрыты от прямой записи?
  const f = (await c.query(`select proname from pg_proc where proname like 'precursor_run%' order by 1`)).rows.map(r => r.proname);
  const надо = ['precursor_run_act', 'precursor_run_get', 'precursor_run_pick',
                'precursor_run_turn', 'precursor_run_rite'];
  надо.forEach(n => { if (!f.includes(n)) { бед++; console.log('✘ нет двери ' + n); } });

  // ── обряд не проходит обычной кнопкой хода ────────────────
  // Главная проверка этого наката: `тёмное` снято со ступеней и на клиенте,
  // и на сервере. Пройдёт здесь — значит мир снова можно вычистить без спроса.
  const обряд = JS.РУКА.find(a => a.обряд);
  if (!обряд) { бед++; console.log('✘ в РУКЕ нет карты обряда'); }
  else {
    const s = (await c.query('select public._pcr_act($1,0) a', [обряд.id])).rows[0].a;
    if (s !== null) { бед++; console.log('✘ обряд всё ещё живёт ступенью в _pcr_act: ' + JSON.stringify(s)); }
    else console.log('✔ обряд снят со ступеней (_pcr_act вернул null)');
    const w = (await c.query('select public.precursor_run_act($1,$2,$3) r',
      ['—нет такой системы—', 0, обряд.id])).rows[0].r;
    const ок = w && w.ok === false && /обряд идёт своей дверью/.test(w.why || '');
    if (!ок) { бед++; console.log('✘ дверь ступеней не отказала обряду: ' + JSON.stringify(w)); }
    else console.log('✔ дверь ступеней отказывает обряду: «' + w.why + '»');
  }
  const p = (await c.query(`select cmd, policyname from pg_policies where tablename='precursor_run'`)).rows;
  const пишущие = p.filter(x => x.cmd !== 'SELECT');
  if (пишущие.length) { бед++; console.log('✘ есть политика на запись: ' + JSON.stringify(пишущие)); }
  if (!бед) console.log(`✔ четыре двери на месте, политик записи нет (только ${p.map(x => x.cmd).join(', ')})`);

  // ── переживает ли партия F5 ───────────────────────────────
  // Двери ходят от имени игрока (`_ec_my_fid`), поэтому здесь дёргаем нижний
  // слой напрямую: заводим партию, меняем её, читаем заново из ТАБЛИЦЫ. Всё
  // внутри транзакции с откатом — в базе после замера не остаётся ничего.
  await c.query('begin');
  try {
    const civ = (await c.query(
      `select system_id, pid from public.primitive_civs
        where status not in ('dead','spacefaring') limit 1`)).rows[0];
    const fac = (await c.query('select faction_id from public.faction_economy limit 1')).rows[0];
    if (!civ || !fac) {
      console.log('· живых миров или держав в базе нет — проверку хранения пропускаю');
    } else {
      await c.query('select public._pcr_open($1,$2,$3)', [fac.faction_id, civ.system_id, civ.pid]);
      const было = (await c.query(
        `select turn, att, flow, wound from public.precursor_run
          where faction_id=$1 and system_id=$2 and pid=$3`,
        [fac.faction_id, civ.system_id, civ.pid])).rows[0];
      if (!было) { бед++; console.log('✘ партия не завелась в таблице'); }
      else {
        await c.query(
          `update public.precursor_run set turn=7, flow=61, decided=true
            where faction_id=$1 and system_id=$2 and pid=$3`,
          [fac.faction_id, civ.system_id, civ.pid]);
        // Читаем ЗАНОВО — это и есть «после F5»: состояние лежит в базе, а не в вкладке.
        const стало = (await c.query(
          `select turn, flow, decided from public.precursor_run
            where faction_id=$1 and system_id=$2 and pid=$3`,
          [fac.faction_id, civ.system_id, civ.pid])).rows[0];
        const ок = +стало.turn === 7 && +стало.flow === 61 && стало.decided === true;
        if (!ок) бед++;
        console.log(`${ок ? '✔' : '✘'} партия хранится: век ${было.turn}→${стало.turn}, `
          + `развитие ${было.flow}→${стало.flow} — перечитано из таблицы`);
      }
    }
  } finally { await c.query('rollback'); }

  // ── ихор обряда доезжает до склада ────────────────────────
  // Сам `precursor_run_rite` отсюда не дёрнуть: он ходит от имени игрока
  // (`_ec_my_fid`), а замер подключён напрямую. Проверяем то звено, которого
  // у выкачивания не было вовсе, — счёт жертвы и запись на склад державы.
  await c.query('begin');
  try {
    const fac = (await c.query('select faction_id from public.faction_economy limit 1')).rows[0];
    const civ = (await c.query(
      `select self_name, pop from public.primitive_civs
        where status not in ('dead','spacefaring') and coalesce(pop,0) > 0
        order by pop desc limit 1`)).rows[0];
    if (!fac || !civ) console.log('· некому и не за кого служить обряд — проверку склада пропускаю');
    else {
      const сч = +(await c.query('select public._pc_rite_ichor($1) i', [civ.pop])).rows[0].i;
      const до = +(await c.query(
        `select coalesce((resources->>'Ихор')::numeric,0) v from public.faction_economy
          where faction_id=$1`, [fac.faction_id])).rows[0].v;
      await c.query('select public._pc_res_add($1,$2,$3)', [fac.faction_id, 'Ихор', сч]);
      const после = +(await c.query(
        `select coalesce((resources->>'Ихор')::numeric,0) v from public.faction_economy
          where faction_id=$1`, [fac.faction_id])).rows[0].v;
      const ок = сч > 0 && Math.abs((после - до) - сч) < 1e-6;
      if (!ок) бед++;
      console.log(`${ок ? '✔' : '✘'} ихор обряда на складе: «${civ.self_name}» ${
        Math.round(civ.pop)} душ → ${сч} ихора, склад ${до} → ${после}`);
    }
  } finally { await c.query('rollback'); }

  await c.end();
  if (бед) { console.error(`\nПРОВАЛ: расхождений ${бед}`); process.exit(1); }
  console.log('\nок');
})().catch(e => { console.error(e && e.message); process.exitCode = 1; });
