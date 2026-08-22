// ПРОБА: что делает крыло ангела на своём ходу. Всё в транзакции с ROLLBACK.
const fs=require('fs'),path=require('path'),{Client}=require('pg');
const envPath=path.join(__dirname,'..','.env');
if(fs.existsSync(envPath))for(const l of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const B='4e5f806f-c232-4b00-add3-86f6de03ff00';
const p=(t,r)=>{console.log('--- '+t); console.log(JSON.stringify(r.rows));};
(async()=>{
 const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
 await c.connect();
 await c.query('begin');
 try{
  p('до: доска',await c.query(`select side,unit_name,x,y,hp,alive,acted,tp from battle_units where battle_id=$1 order by side,x`,[B]));
  p('до: бой',await c.query(`select side_to_move,turn_no,acts_left,jsonb_array_length(log) lg from battles where id=$1`,[B]));
  // 1) видит ли крыло цели вообще
  p('_bt_bot_target для Офанима',await c.query(
    `select bu.id, public._bt_bot_target($1,bu.id) as tgt
       from battle_units bu where bu.battle_id=$1 and bu.side='defender' and bu.alive`,[B]));
  // 2) отдаём ход защитнику и гоняем машинный ход
  await c.query(`update battles set side_to_move='defender', acts_left=public._bt_acts() where id=$1`,[B]);
  await c.query(`update battle_units set acted=false, moved=false, fired=false where battle_id=$1 and side='defender'`,[B]);
  const t0=Date.now();
  await c.query(`select public._bt_bot_turn($1)`,[B]);
  console.log('--- ход машины занял мс: '+(Date.now()-t0));
  p('после: доска',await c.query(`select side,unit_name,x,y,hp,alive,acted,tp from battle_units where battle_id=$1 order by side,x`,[B]));
  p('после: бой',await c.query(`select side_to_move,turn_no,acts_left,status,jsonb_array_length(log) lg from battles where id=$1`,[B]));
  p('новые строки лога',await c.query(
    `select e->>'m' m from battles b, jsonb_array_elements(b.log) with ordinality o(e,i)
      where b.id=$1 and i>4 order by i`,[B]));
 }catch(e){ console.log('!!! ОШИБКА: '+e.message); }
 await c.query('rollback');
 await c.end();
})().catch(e=>{console.error('FATAL '+e.message);process.exit(1);});
