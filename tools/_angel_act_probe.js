const fs=require('fs'),path=require('path'),{Client}=require('pg');
const envPath=path.join(__dirname,'..','.env');
if(fs.existsSync(envPath))for(const l of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const B='4e5f806f-c232-4b00-add3-86f6de03ff00';
const UID='10b972a0-5e83-4412-8e3e-734ad09c9870';
(async()=>{
 const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
 await c.connect(); await c.query('begin');
 await c.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:UID,role:'authenticated'})]);
 await c.query(`set local role authenticated`);
 const t=async(nm,sql,args=[])=>{const t0=Date.now();
   await c.query('savepoint sp');
   try{const r=await c.query(sql,args);console.log(`${nm}: ${Date.now()-t0} мс — ok ${JSON.stringify(r.rows[0]).slice(0,200)}`);
       await c.query('release savepoint sp');return r.rows[0];}
   catch(e){console.log(`${nm}: ${Date.now()-t0} мс — ОШИБКА ${e.message}`);await c.query('rollback to savepoint sp');return null;}};
 console.log('доска: '+JSON.stringify((await c.query(`select public._bt_w() w, public._bt_h() h, bw, bh from battles where id=$1`,[B])).rows[0]));
 const u=(await c.query(`select id,x,y from battle_units where battle_id=$1 and side='attacker' and alive and not acted limit 1`,[B])).rows[0];
 for(const d of [[1,0],[-1,0],[0,1],[0,-1]])
   await t(`battle_move ${d}`,'select public.battle_move($1,$2,$3) v',[B,u.id,JSON.stringify([{x:u.x+d[0],y:u.y+d[1]}])]);
 await t('battle_end_turn','select public.battle_end_turn($1) v',[B]);
 await t('состояние после','select side_to_move||\' t\'||turn_no as v from battles where id=$1',[B]);
 await c.query('rollback'); await c.end();
})().catch(e=>{console.error('FATAL '+e.message);process.exit(1);});
