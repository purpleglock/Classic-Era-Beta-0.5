// ПРОГОН БЕЗ НАКАТА: файл выполняется и откатывается. Печатает notice'ы.
const fs=require('fs'),path=require('path'),{Client}=require('pg');
const envPath=path.join(__dirname,'..','.env');
if(fs.existsSync(envPath))for(const l of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
(async()=>{
 const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
 c.on('notice',n=>console.log('NOTICE: '+n.message));
 await c.connect();
 const f=process.argv[2];
 await c.query('begin');
 try{
   await c.query(fs.readFileSync(f,'utf8'));
   console.log('СИНТАКСИС И ПРОГОН: ok');
   for(const q of process.argv.slice(3)){
     const r=await c.query(q); console.log('-- '+q.slice(0,80)+'\n'+JSON.stringify(r.rows));
   }
 }catch(e){ console.log('ОШИБКА: '+e.message + (e.position?(' [поз '+e.position+']'):'') + (e.where?('\n  где: '+e.where):'')); }
 await c.query('rollback');
 await c.end();
})().catch(e=>{console.error('FATAL '+e.message);process.exit(1);});
