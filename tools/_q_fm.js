// Вызов fleets_mine ровно как его зовёт клиент: роль authenticated + jwt-claims игрока.
const fs=require('fs'),path=require('path');const{Client}=require('pg');
for(const line of fs.readFileSync(path.join(__dirname,'..','.env'),'utf8').split(/\r?\n/)){
  const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
(async()=>{
  const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await c.connect();
  const own=(await c.query(`select owner_id, faction_id, count(*)::int n from public.fleets
      where owner_id is not null group by 1,2 order by n desc limit 1`)).rows[0];
  console.log('игрок:',own);
  await c.query('BEGIN');
  await c.query(`select set_config('role','authenticated',true),
                        set_config('request.jwt.claims', json_build_object('sub',$1::text,'role','authenticated')::text, true)`,[own.owner_id]);
  for (const fn of ['fleets_mine','fleets_visible','outposts_visible']) {
    try {
      const r=await c.query(`select public.${fn}() j`);
      const j=r.rows[0].j||[];
      console.log(fn,'→',Array.isArray(j)?j.length+' строк':typeof j, Array.isArray(j)&&j[0]?JSON.stringify(j[0]).slice(0,220):'');
    } catch(e){ console.log(fn,'→ ОШИБКА:', e.message); }
  }
  await c.query('ROLLBACK'); await c.end();
})().catch(e=>{console.error('ОШИБКА:',e.message);process.exit(1);});
