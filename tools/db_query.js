// Разовый читатель БД: node q.js "select ..."
const fs=require('fs'),path=require('path'),{Client}=require('pg');
const root='C:/Users/Андрей/Desktop/Classic-Era-Beta-0.5';
for(const line of fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/)){
  const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if(m) process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
(async()=>{
  const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await c.connect();
  const sql=process.argv[2].startsWith('@')?fs.readFileSync(process.argv[2].slice(1),'utf8'):process.argv[2];
  const r=await c.query(sql);
  const out=Array.isArray(r)?r.filter(x=>x.rows&&x.rows.length).map(x=>x.rows):r.rows;
  console.log(JSON.stringify(out,null,1).slice(0,20000));
  await c.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
