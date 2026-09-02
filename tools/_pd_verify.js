const fs=require('fs'),{Client}=require('pg');
for(const l of fs.readFileSync('.env','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await c.connect();
const r=await c.query(`
select 'auth.users: google-мета осталось' k, count(*)::int v from auth.users where raw_user_meta_data ?| array['name','picture','full_name','email','iss','given_name']
union all select 'auth.identities: name/picture осталось', count(*)::int from auth.identities where identity_data ?| array['name','picture','given_name','email_verified']
union all select 'auth.identities: sub на месте', count(*)::int from auth.identities where identity_data ? 'sub'
union all select 'auth.users: email (логин) цел', count(*)::int from auth.users where email is not null
union all select 'profiles: гугл-аватары остались', count(*)::int from public.profiles where avatar_url like '%googleusercontent%'
union all select 'access_log: email остался', count(*)::int from public.access_log where email is not null
union all select 'access_log: строк всего', count(*)::int from public.access_log
union all select 'faction_units: email остался', count(*)::int from public.faction_units where owner_email like '%@%'
union all select 'tickets: email остался', count(*)::int from public.tickets where user_email like '%@%'
union all select 'legal_consents: email остался', count(*)::int from public.legal_consents where email like '%@%'
union all select 'dev_tasks: email остался', count(*)::int from public.dev_tasks where created_email like '%@%'
`);console.table(r.rows);
try{const j=await c.query(`select jobname,schedule from cron.job where jobname='access-log-prune'`);console.log('крон:',j.rows);}catch(e){console.log('крон: pg_cron недоступен');}
await c.end();})().catch(e=>{console.error(e.message);process.exit(1)});
