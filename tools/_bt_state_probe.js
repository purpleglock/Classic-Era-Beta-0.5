const fs=require('fs'),path=require('path'),{Client}=require('pg');
for(const l of fs.readFileSync(path.join(__dirname,'..','.env'),'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
(async()=>{
  const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await c.connect();
  const uid=process.argv[2], bid=process.argv[3];
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({sub:uid, role:'authenticated'})]);
  await c.query("set local role authenticated");
  const steps = [
    ['_bt_side',        "select public._bt_side($1, public._ec_my_fid())"],
    ['_bt_ensure_field',"select public._bt_ensure_field($1)"],
    ['_bt_admin_full',  "select public._bt_admin_full($1)"],
    ['battle_pool',     "select jsonb_array_length(public.battle_pool($1, public._ec_my_fid()))"],
    ['units-подзапрос', "select count(*) from public.battle_units u where u.battle_id=$1"],
    ['_bt_side_actors', "select public._bt_side_actors($1, public._bt_side($1, public._ec_my_fid()))"],
    ['_bt_pass_wait',   "select public._bt_pass_wait($1)"],
    ['_bt_interdicted', "select public._bt_interdicted($1, public._bt_side($1, public._ec_my_fid()))"],
  ];
  for (const [nm, sql] of steps) {
    const t=Date.now();
    try { await c.query(sql,[bid]); console.log((Date.now()-t)+' мс\t'+nm); }
    catch(e){ console.log('ОШИБКА\t'+nm+': '+e.message); }
  }
  await c.query('rollback'); await c.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
