const fs=require('fs'),path=require('path');const{Client}=require('pg');
for(const line of fs.readFileSync(path.join(__dirname,'..','.env'),'utf8').split(/\r?\n/)){
  const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
(async()=>{
  const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await c.connect();
  const u=(await c.query(`select id,email from auth.users where email=$1`,['xlopetsgod@gmail.com'])).rows[0];
  console.log('пользователь:',u);
  const fa=(await c.query(`select faction_id,status from public.faction_applications where owner_id=$1`,[u.id])).rows;
  console.log('державы:',fa);
  for(const f of fa){
    const r=(await c.query(`select id,name,status,system_id,dest_sys,is_station,fuel,fuel_cap,
        (select coalesce(sum(greatest(0,(x->>'qty')::int)),0) from jsonb_array_elements(coalesce(composition,'[]'::jsonb)) x) ships
        from public.fleets where faction_id=$1 order by created_at`,[f.faction_id])).rows;
    console.log('— флоты',f.faction_id,':',r.length);
    console.table(r);
  }
  await c.end();
})().catch(e=>{console.error('ОШИБКА:',e.message);process.exit(1);});
