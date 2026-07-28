// Разовый SELECT в базу с печатью результата: node tools/db_q.js "select 1"
const fs=require('fs'),path=require('path'),{Client}=require('pg');
const p=path.join(__dirname,'..','.env');
if(fs.existsSync(p))for(const l of fs.readFileSync(p,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await c.connect();
try{const r=await c.query(process.argv.slice(2).join(' '));console.log(JSON.stringify(r.rows,null,1));}catch(e){console.error('ОШИБКА: '+e.message);}
await c.end();})();
