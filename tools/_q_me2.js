const fs=require('fs'),path=require('path');const{Client}=require('pg');
for(const line of fs.readFileSync(path.join(__dirname,'..','.env'),'utf8').split(/\r?\n/)){
  const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
(async()=>{
  const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await c.connect(); await c.query('BEGIN');
  await c.query(`select set_config('role','authenticated',true),
    set_config('request.jwt.claims', json_build_object('sub','272a2209-f2c1-4f13-ab95-136b4e039a8d','role','authenticated')::text,true)`);
  for(const fn of ['fleets_mine','fleets_visible']){
    try{ const j=(await c.query(`select public.${fn}() j`)).rows[0].j||[];
      console.log(fn,'→',j.length); j.slice(0,3).forEach(x=>console.log('   ',JSON.stringify(x).slice(0,300)));
    }catch(e){console.log(fn,'ОШИБКА:',e.message);}
  }
  const s=(await c.query(`select id,name,x,y from public.map_systems where id='sys_mr4pcvcj'`)).rows[0];
  console.log('система флота:',s);
  await c.query('ROLLBACK'); await c.end();
})().catch(e=>{console.error('ОШИБКА:',e.message);process.exit(1);});
