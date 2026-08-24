const fs=require('fs'),path=require('path'),{Client}=require('pg');
const envPath=path.join(process.argv[2],'.env');
for(const l of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await c.connect();
const uid=process.argv[3];
await c.query('begin');
await c.query("set local role authenticated");
await c.query("select set_config('request.jwt.claims', $1, true)",[JSON.stringify({sub:uid,role:'authenticated'})]);
const q=async(s,p)=>{try{return (await c.query(s,p)).rows}catch(e){return 'ERR '+e.message}};
console.log('комнаты:',JSON.stringify(await q('select room,name,subtitle from public.chat_my_rooms()'),null,1));
console.log('своя запись:',JSON.stringify(await q("insert into public.chat_messages(author_id,room,name,body) values (auth.uid(),'fac:fac_5bfbfad5f8','Тест','привет') returning id,room")));
console.log('в общий:',JSON.stringify(await q("insert into public.chat_messages(author_id,room,name,body) values (auth.uid(),'global','Тест','всем') returning id,room")));
console.log('своя комната завелась:',JSON.stringify(await q("select public.chat_room_create('fac','fac_5bfbfad5f8','Штаб') k")));
console.log('видно после:',JSON.stringify(await q('select room,count(*) n from public.chat_messages group by 1')));
await c.query('rollback');await c.end();})().catch(e=>{console.error(e.message);process.exit(1)});
