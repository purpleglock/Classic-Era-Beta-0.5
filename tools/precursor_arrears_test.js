// Сквозной прогон недоимки и Сбора. Всё в транзакции с ROLLBACK: база не меняется.
//   node tools/precursor_arrears_test.js
const fs = require('fs'), path = require('path'), { Client } = require('pg');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const j = v => JSON.stringify(v);

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;
  await c.query('begin');
  try {
    // от лица настоящего игрока: реестр читает _ec_my_fid()
    const UID = process.argv[2] || '42f9b7e3-f378-4dce-a4bb-acf0c0ac9e3e';
    await c.query(`set local request.jwt.claims = '{"sub":"${UID}"}'`);
    const [civ] = await q(`select system_id, pid, tier, coalesce(ruins,'нет') ruins from public.primitive_civs
                            where status not in ('dead','spacefaring') order by tier desc limit 1`);
    console.log('мир:', civ.system_id, '#' + civ.pid, 'тир', civ.tier, civ.ruins);

    const [f1, f2] = await q(`select id from public.map_factions
                               where id in (select faction_id from public.faction_economy) limit 2`);
    console.log('державы:', f1.id, f2.id);

    console.log('\n── 1. Ступень до ─────────');
    console.log(await q(`select public._pc_arrears_stage() st, public._pc_arrears_total() tot`));

    console.log('\n── 2. Вскрытия: три залпа одной державы и один чужой ──');
    for (const w of [[f1.id, 260], [f1.id, 240], [f1.id, 260], [f2.id, 200]]) {
      await q(`select public._pc_arrears_add($1, $2, $3, $4, $5)`, [w[0], civ.system_id, civ.pid, w[1], civ.tier]);
    }
    console.log(await q(`select faction_id, amount, taken, worlds from public.pc_arrears order by amount desc`));
    console.log(await q(`select public._pc_arrears_stage() st, public._pc_arrears_total() tot,
                                public._pc_ichor_mult() mult`));
    console.log('копилка по секторам:', j(await q(`select sector_id, round(pressure,1) pressure from public.pc_levy_pressure`)));

    console.log('\n── 3. Реестр глазами игрока ──');
    const [reg] = await q(`select public.precursor_arrears() r`);
    console.log(j(reg.r).slice(0, 900));

    console.log('\n── 4. Вира: возврат гасит счёт ──');
    await q(`select public._pc_arrears_add($1, $2, $3, $4, $5)`, [f1.id, civ.system_id, civ.pid, -260, civ.tier]);
    console.log(await q(`select faction_id, round(amount,1) amount, round(repaid,1) repaid from public.pc_arrears order by amount desc`));

    console.log('\n── 5. Сбор: ход, доли, взыскание ──');
    const has = await q(`select 1 from pg_proc where proname = 'precursor_levy_tick'`);
    if (!has.length) { console.log('этап 8 ещё не накатан'); }
    else {
      // догоняем недоимку до порога Сбора
      await q(`select public._pc_arrears_add($1, $2, $3, $4, $5)`, [f1.id, civ.system_id, civ.pid, 2600, civ.tier]);
      console.log('ступень:', (await q(`select public._pc_arrears_stage() s`))[0].s);
      console.log('ход:', j((await q(`select public.precursor_levy_tick() t`))[0].t));
      console.log('контакты:', j(await q(`select kind, state, round(strength,1) strength, target_fid, target_sys
                                            from public.legion_contacts where kind = 'levy'`)));
      await q(`update public.legion_contacts set state = 'landed', arrive_at = now() where kind = 'levy'`);
      console.log('высадка:', j((await q(`select public.precursor_levy_engage() t`))[0].t));
      console.log('флоты Сбора:', j(await q(`select name, system_id,
                                               (select coalesce(sum((x->>'qty')::int),0)
                                                  from jsonb_array_elements(composition) x) qty
                                               from public.fleets where faction_id = public._legion_fid()
                                                and name like '%Сбор%'`)));
      console.log('счёт после взыскания:', j(await q(`select faction_id, round(amount,1) amount from public.pc_arrears order by amount desc`)));
      console.log('журнал:', j(await q(`select kind, round(weight,1) w from public.pc_arrears_log order by id desc limit 5`)));
    }
    console.log('\n── 6. Живое вскрытие через precursor_commit ──');
    const [tgt] = await q(`select c.system_id, c.pid, c.self_name, c.tier, col.faction_id
                             from public.primitive_civs c
                             join public.colonies col on col.system_id = c.system_id
                            where c.ruins = 'Даллерианцы' and c.status not in ('dead','spacefaring')
                            limit 1`);
    if (!tgt) { console.log('нет мира с даллерианскими руинами под колонией'); }
    else {
      const [u] = await q(`select owner_id from public.colonies
                            where faction_id = $1 and owner_id is not null limit 1`, [tgt.faction_id]);
      await c.query(`set local request.jwt.claims = '{"sub":"${u.owner_id}"}'`);
      // свидетель, а не платёж: флот в системе
      await q(`insert into public.fleets(faction_id, name, status, system_id, home_sys, composition)
               values ($1, 'проверка', 'idle', $2, $2, '[]'::jsonb)`, [tgt.faction_id, tgt.system_id]);
      const before = (await q(`select coalesce(amount,0) a from public.pc_arrears where faction_id=$1`, [tgt.faction_id]))[0];
      const [r] = await q(`select public.precursor_commit($1,$2,'breach') r`, [tgt.system_id, tgt.pid]);
      console.log(tgt.self_name, '(тир', tgt.tier + '):', j(r.r));
      console.log('счёт державы:', j(await q(`select round(amount,1) amount, worlds from public.pc_arrears where faction_id=$1`, [tgt.faction_id])),
                  '(было', before ? before.a : 0, ')');
      console.log('журнал:', j(await q(`select kind, round(weight,1) w from public.pc_arrears_log
                                          where faction_id=$1 order by id desc limit 2`, [tgt.faction_id])));
      console.log('замок Завета:', j(await q(`select flags->>'covenant_locked' locked from public.primitive_civs
                                                where system_id=$1 and pid=$2`, [tgt.system_id, tgt.pid])));
    }
  } catch (e) {
    console.error('ОШИБКА:', e.message);
  } finally {
    await c.query('rollback');
    await c.end();
    console.log('\n(rollback — база не изменилась)');
  }
})();
