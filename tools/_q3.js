const fs=require('fs'),path=require('path'),{Client}=require('pg');
for(const line of fs.readFileSync(path.join(__dirname,'..','.env'),'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await c.connect();
try{const r=await c.query(fs.readFileSync(process.argv[2],'utf8'));const rs=Array.isArray(r)?r:[r];for(const x of rs){if(x.rows)console.log(JSON.stringify(x.rows,null,1));}}catch(e){console.error('ERR',e.message);}
await c.end();})();
