const fs=require('fs'),path=require('path'),{Client}=require('pg');
const envPath=path.join('C:/Users/Андрей/Desktop/Classic-Era-Beta-0.5','.env');
for(const l of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
(async()=>{
  const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await c.connect();
  const uid=process.argv[2], bid=process.argv[3];
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({sub:uid, role:'authenticated'})]);
  await c.query("set local role authenticated");
  const who=await c.query("select auth.uid() uid, public.current_user_role() r, public._ec_my_fid() fid");
  console.log('кто я:', who.rows[0]);
  const t0=Date.now();
  try{
    const r=await c.query('select public.battle_state($1) s',[bid]);
    console.log('battle_state OK за', Date.now()-t0, 'мс; юнитов', (r.rows[0].s.units||[]).length, 'пул', (r.rows[0].s.pool||[]).length);
  }catch(e){ console.log('battle_state УПАЛ за', Date.now()-t0,'мс:', e.message); }
  await c.query('rollback');
  await c.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
