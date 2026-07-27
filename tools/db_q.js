// Разовый запрос с ВЫВОДОМ строк: node tools/db_q.js "select 1"
const fs=require('fs'),path=require('path'),{Client}=require('pg');
const envPath=path.join(__dirname,'..','.env');
if(fs.existsSync(envPath))for(const l of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await c.connect();
try{const r=await c.query(process.argv[2]);console.log(JSON.stringify(r.rows,null,1));}catch(e){console.error('ОШИБКА: '+e.message);}
await c.end();})();
