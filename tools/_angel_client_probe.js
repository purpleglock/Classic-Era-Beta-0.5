// ПРОБА КЛИЕНТСКИХ ДВЕРЕЙ: как их видит игрок (сессия подделана set local).
const fs=require('fs'),path=require('path'),{Client}=require('pg');
const envPath=path.join(__dirname,'..','.env');
if(fs.existsSync(envPath))for(const l of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const B='4e5f806f-c232-4b00-add3-86f6de03ff00';
const UID=process.argv[2]||'10b972a0-5e83-4412-8e3e-734ad09c9870';
(async()=>{
 const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
 await c.connect(); await c.query('begin');
 await c.query(`select set_config('request.jwt.claims', $1, true)`,[JSON.stringify({sub:UID,role:'authenticated'})]);
 await c.query(`set local role authenticated`);
 const t=async(nm,sql,args=[])=>{const t0=Date.now();try{const r=await c.query(sql,args);
   console.log(`${nm}: ${Date.now()-t0} мс — ok`); return r.rows[0];}catch(e){console.log(`${nm}: ${Date.now()-t0} мс — ОШИБКА ${e.message}`);return null;}};
 await t('_ec_my_fid','select public._ec_my_fid() v');
 const st=await t('battle_state','select public.battle_state($1) v',[B]);
 if(st&&st.v){const s=st.v;
   console.log('  status='+s.status+' my_side='+s.my_side+' my_turn='+s.my_turn+' side_to_move='+s.side_to_move
     +' acts_left='+s.acts_left+' turn_no='+s.turn_no+' units='+(s.units||[]).length+' pool='+((s.pool||[]).length));
   for(const u of (s.units||[])) console.log('   • '+(u.mine?'мой ':'чужой ')+(u.name||'(контакт)')+' cls='+u.cls+' x='+u.x+' y='+u.y+' hp='+u.hp+' acted='+u.acted+' pk='+JSON.stringify(u.pk||null));
 }
 await t('battle_pool','select public.battle_pool($1, public._ec_my_fid()) v',[B]);
 await c.query('rollback'); await c.end();
})().catch(e=>{console.error('FATAL '+e.message);process.exit(1);});
