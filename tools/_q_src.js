const fs=require('fs'),path=require('path');const{Client}=require('pg');
for(const line of fs.readFileSync(path.join(__dirname,'..','.env'),'utf8').split(/\r?\n/)){
  const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
(async()=>{
  const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await c.connect();
  const r=await c.query(`select p.proname, length(p.prosrc) len, p.prosrc from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('notif_counts','notif_mark','notif_counts__pre') order by 1`);
  for(const x of r.rows){
    console.log('──',x.proname,'('+x.len+' симв.)');
    if(x.proname==='notif_mark') console.log(x.prosrc);
    else console.log('каналы:', [...new Set((x.prosrc.match(/jsonb_build_object\('([a-z.]+)'/g)||[]).map(s=>s.slice(19,-1)))].join(', '));
  }
  await c.end();
})().catch(e=>{console.error('ОШИБКА:',e.message);process.exit(1);});
