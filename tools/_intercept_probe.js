// Прогон засады «в холостую»: всё внутри транзакции с откатом — живая партия
// не трогается. Берём летящий контакт, подводим часы к проходу узла выхода,
// ставим туда чужой флот и смотрим, что вышло.
const fs=require('fs'),path=require('path'),{Client}=require('pg');
const ROOT='C:/Users/Андрей/Desktop/Classic-Era-Beta-0.5';
for(const l of fs.readFileSync(path.join(ROOT,'.env'),'utf8').split(/\r?\n/)){
  const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
(async()=>{
  const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await c.connect(); await c.query('BEGIN');
  const q=async(s,p)=>(await c.query(s,p)).rows;
  const k=(await q(`select id,route,route_at,target_sys,target_fid from legion_contacts where state='inbound' limit 1`))[0];
  const n=k.route.length, i=Math.max(1,n-3), node=k.route[i];
  const at=k.route_at.slice(); at[i]=new Date(Date.now()-60000).toISOString();
  await q(`update legion_contacts set route_at=$1 where id=$2`,[JSON.stringify(at),k.id]);
  const fid=(await q(`select faction_id from colonies where faction_id is distinct from $1 limit 1`,[k.target_fid]))[0].faction_id;
  const unit=(await q(`select id,name from faction_units where category='ship' limit 1`))[0];
  const comp=JSON.stringify([{unit_id:unit.id,unit_name:unit.name,qty:4}]);
  const f=(await q(`insert into fleets(faction_id,name,status,system_id,home_sys,composition)
                    values($1,'ПРОБА',' idle',$2,$2,$3) returning id`.replace("' idle'","'idle'"),[fid,node,comp]))[0];
  console.log('узел засады:',node,'перехватчик:',fid);
  console.log('tick:',JSON.stringify((await q(`select legion_intercept_tick() r`))[0].r));
  console.log('контакт:',JSON.stringify((await q(
    `select state,waylaid,orig_sys,target_sys,fleet_id from legion_contacts where id=$1`,[k.id])),null,1));
  console.log('флот Легиона:',JSON.stringify(await q(
    `select name,system_id,jsonb_array_length(composition) n from fleets where faction_id=_legion_fid()`)));
  console.log('бой:',JSON.stringify(await q(
    `select b.system_id,b.kind,b.status,b.attacker_fid,b.defender_fid,
            (select count(*) from battle_fleets bf where bf.battle_id=b.id) fl,
            (select count(*) from battle_units bu where bu.battle_id=b.id) units
       from battles b where b.created_at > now()-interval '1 minute'`),null,1));
  console.log('сводки:',JSON.stringify(await q(
    `select faction_id,title from faction_news where created_at > now()-interval '1 minute'`)));
  await c.query('ROLLBACK'); await c.end();
})().catch(async e=>{console.error('ОШИБКА:',e.message);process.exit(1);});
