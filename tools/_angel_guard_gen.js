// Генерит _angel_no_sandbox.sql: берёт ЖИВЫЕ определения функций из базы и
// вставляет первой строкой тела охранник «это песочница — не трогаем».
const fs=require('fs'),path=require('path'),{Client}=require('pg');
for(const l of fs.readFileSync(path.join(__dirname,'..','.env'),'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const GUARD = {
  _angel_slip:      "  if public._angel_sandbox_bt(p_battle) then return jsonb_build_object('ok', true, 'skip', 'песочница'); end if;",
  _angel_wing_slip: "  if public._angel_sandbox_bt(p_battle) then return jsonb_build_object('ok', true, 'skip', 'песочница'); end if;",
  _angel_force_turn:"  if public._angel_sandbox_bt(p_battle) then return false; end if;",
};
(async()=>{
  const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await c.connect();
  let out='';
  for (const fn of Object.keys(GUARD)) {
    const r=await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",[fn]);
    if (r.rows.length!==1) throw new Error(fn+': найдено определений '+r.rows.length);
    let d=r.rows[0].d;
    const m=/^begin$/m.exec(d);
    if(!m) throw new Error(fn+': не нашёл начало тела');
    const at=m.index+m[0].length;
    const note='\n  -- ⚠️ ПЕСОЧНИЦА НЕ ЕГО ДЕЛО. Держава-ангел — это ЧЬЯ-ТО держава (сейчас\n'
             + '  -- fac_0fd51aa92b), и её владелец так же играет: заводит тестовый бой с\n'
             + '  -- ботами из админки, выходит на арену клуба. Свип ангела видел такую\n'
             + '  -- доску своей, брал строку боя FOR UPDATE и закрывал её без победителя —\n'
             + '  -- игрок получал «БОЙ НЕ ИДЁТ», а пока свип держал строку — «lock timeout».\n';
    d=d.slice(0,at)+note+GUARD[fn]+d.slice(at);
    out+=d+';\n\n';
  }
  fs.writeFileSync(path.join(__dirname,'..','_angel_no_sandbox.sql'),
`-- ============================================================
-- АНГЕЛЬСКИЙ СВИП НЕ ТРОГАЕТ ПЕСОЧНИЦУ (бой с ботами, арена клуба)
-- ?v=20260828nosandbox
--
-- БЫЛО: тестовый бой с ботами закрывался сам через минуту — «БОЙ НЕ ИДЁТ»,
-- а на ходу игрока прилетало «canceling statement due to lock timeout».
-- Замер: бой 5da3b262 создан 18:09:55, начат 18:10:41, закрыт 18:11:00.343
-- (angel-ai-tick, расписание 1-59/5) со status='done' и winner_fid=NULL —
-- почерк _angel_wing_slip. Обе стороны при этом были ЖИВЫ (8 против 10).
--
-- ПРИЧИНА: держава-ангел — это не безличный кризис, а КОНКРЕТНАЯ держава
-- (_angel_fid() = fac_0fd51aa92b), и её владелец продолжает играть. Свип
-- _angel_grip_sweep разбирает ВСЕ бои, где эта держава сторона, и правило 6.0
-- («ни одного флота воинства не стоит в системе боя — доска призрачная»)
-- честно срабатывало на админском бое с ботами: настоящего флота там нет и
-- быть не должно. Доска закрывалась без победителя. Заодно _angel_slip и
-- _angel_wing_slip держат «battles ... for update» и делают в этой же
-- транзакции разбор потерь и отправку флотов — отсюда и lock timeout у хода.
--
-- СТАЛО: песочница (админский бой с ботами, дуэль клуба, любая доска против
-- машинной стороны 'bot') для ангела не существует. Охранник стоит ПЕРВОЙ
-- строкой — до FOR UPDATE, поэтому строка боя даже не блокируется.
-- Определения ниже сняты с ЖИВОЙ базы (pg_get_functiondef) и отличаются от
-- неё ровно этими врезками — см. tools/_angel_guard_gen.js.
-- ============================================================

create or replace function public._angel_sandbox_bt(p_battle uuid)
returns boolean language sql stable
security definer set search_path to 'public' as $$
  select exists (select 1 from public.admin_bot_duel d
                  where d.one = 1 and d.battle_id = p_battle)
      or exists (select 1 from public.battles b
                  where b.id = p_battle
                    and (b.kind = 'duel'                      -- арена Бойцовского клуба
                      or b.attacker_fid = 'bot'               -- машинная сторона без державы
                      or b.defender_fid = 'bot'));
$$;

`+out, 'utf8');
  console.log('готово: _angel_no_sandbox.sql');
  await c.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
