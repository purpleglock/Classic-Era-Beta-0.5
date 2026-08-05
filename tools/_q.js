const fs=require('fs'),path=require('path'),{Client}=require('pg');
const root='C:/Users/Андрей/Desktop/Classic-Era-Beta-0.5';
for(const line of fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/)){
  const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
(async()=>{
  const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await c.connect();
  const sql=fs.readFileSync(process.argv[2],'utf8');
  const r=await c.query(sql);
  const rs=Array.isArray(r)?r:[r];
  for(const x of rs){ if(x.rows) console.log(JSON.stringify(x.rows,null,1)); }
  await c.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
