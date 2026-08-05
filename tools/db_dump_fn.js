// Выгрузка исходника функции(й) из базы: node tools/db_dump_fn.js имя [имя2 ...]
const fs=require('fs'),path=require('path'),{Client}=require('pg');
const envPath=path.join(__dirname,'..','.env');
if(fs.existsSync(envPath))for(const l of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await c.connect();
for(const n of process.argv.slice(2)){const r=await c.query("select p.oid::regprocedure::text sig, pg_get_functiondef(p.oid) src from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where p.proname=$1 and ns.nspname not in ('pg_catalog','information_schema')",[n]);
r.rows.forEach(x=>console.log('-- ==== '+x.sig+' ====\n'+x.src+'\n'));if(!r.rows.length)console.log('-- НЕТ ФУНКЦИИ '+n);}
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
