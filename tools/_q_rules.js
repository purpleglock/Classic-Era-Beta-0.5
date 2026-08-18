const fs=require('fs'),path=require('path');const{Client}=require('pg');
for(const line of fs.readFileSync(path.join(__dirname,'..','.env'),'utf8').split(/\r?\n/)){
  const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
(async()=>{
  const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await c.connect(); await c.query('BEGIN');
  await c.query(`select set_config('role','authenticated',true),
    set_config('request.jwt.claims', json_build_object('sub','272a2209-f2c1-4f13-ab95-136b4e039a8d','role','authenticated')::text,true)`);
  const cnt=(await c.query(`select public.notif_counts() j`)).rows[0].j;
  console.log('канал rules в notif_counts:', cnt.rules, '| всего каналов:', Object.keys(cnt).length);
  console.log('прежние каналы целы:', ['news','ticket','battle','stat.ach','dipl.war'].every(k=>k in cnt));
  const lst=(await c.query(`select public.rules_updates_list(5) j`)).rows[0].j;
  console.log('лента обновлений:', Array.isArray(lst)?lst.length+' записей':lst);
  await c.query('ROLLBACK'); await c.end();
})().catch(e=>{console.error('ОШИБКА:',e.message);process.exit(1);});
