-- ============================================================
-- ШПИОНАЖ · ЭТАП 8: АТРИБУТЫ АГЕНТОВ (раса/пол/репликация) + АРТЕФАКТЫ (артики)
-- Применять в Supabase → SQL Editor ПОСЛЕ _spy_agents7.sql. Идемпотентно.
--
--  • Рекруты теперь генерятся с РАСОЙ, ПОЛОМ и РЕПЛИКАЦИЕЙ (флавор/разнообразие).
--  • АРТЕФАКТЫ — экипируемые предметы (2 слота на агента), дают боевые бонусы:
--      🗝 Мастер-ключ  +8% кражи        🧨 Заряд-фантом +8% саботаж/снос
--      📡 Сканер       +10% разведка     🔪 Моно-клинок  +12% ликвидация
--      🧬 Нейро-чип    +5% любая опер.    🛰 Глушилка     +4% успех / −6% раскрытие
--      🎭 Маска-морф   −10% раскрытие     📚 Симулятор    +50% получаемого XP
--  • Артефакты ВЫПАДАЮТ с шансом за успешные боевые операции; экипируются на
--    готовых агентов; бонусы складываются в расчёт операции (зеркало в economy.js).
--
-- Файл ПЕРЕСОЗДАЁТ spy_recruits_list / spy_launch / _spy_resolve как надмножество
-- среза 7 (плен), добавляя атрибуты и артефакты.
-- ============================================================

-- ── 0. Поля атрибутов + таблица артефактов ──────────────────
alter table public.spy_agents   add column if not exists race text;
alter table public.spy_agents   add column if not exists gender text;
alter table public.spy_agents   add column if not exists replication text;
alter table public.spy_recruits add column if not exists race text;
alter table public.spy_recruits add column if not exists gender text;
alter table public.spy_recruits add column if not exists replication text;

create table if not exists public.spy_artifacts (
  id             uuid primary key default gen_random_uuid(),
  faction_id     text not null,
  kind           text not null,
  equipped_agent uuid references public.spy_agents(id) on delete set null,
  acquired_at    timestamptz default now()
);
create index if not exists spy_artifacts_fac_idx on public.spy_artifacts(faction_id);
create index if not exists spy_artifacts_eq_idx  on public.spy_artifacts(equipped_agent) where equipped_agent is not null;
alter table public.spy_artifacts enable row level security;
drop policy if exists "spy_artifacts_sel" on public.spy_artifacts;
create policy "spy_artifacts_sel" on public.spy_artifacts for select to authenticated using (false);

-- ── 1. Каталог артефактов: бонусы успеха / скрытности / XP ──
create or replace function public._spy_artifact_succ(p_kind text, p_op text)
returns numeric language sql immutable as $$
  select (case
    when p_kind='masterkey' and p_op in ('steal_gc','steal_tech','steal_res')      then 8
    when p_kind='charge'    and p_op in ('sabotage','destabilize','mass_demolish') then 8
    when p_kind='scanner'   and p_op in ('recon_basic','recon_deep')               then 10
    when p_kind='blade'     and p_op='kill_agent'                                  then 12
    when p_kind='neurochip'                                                        then 5
    when p_kind='jammer'                                                           then 4
    else 0 end)::numeric
$$;
create or replace function public._spy_artifact_det(p_kind text)
returns numeric language sql immutable as $$
  select (case p_kind when 'mask' then 10 when 'jammer' then 6 else 0 end)::numeric
$$;
create or replace function public._spy_artifact_xpmult(p_kind text)
returns numeric language sql immutable as $$
  select (case p_kind when 'sim' then 0.5 else 0 end)::numeric
$$;
-- суммарный множитель XP агента от его артефактов
create or replace function public._spy_agent_xp_mult(p_agent uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select 1 + coalesce((select sum(public._spy_artifact_xpmult(kind))
                       from public.spy_artifacts where equipped_agent=p_agent),0)
$$;
revoke all on function public._spy_agent_xp_mult(uuid) from public;

-- ── 2. spy_recruits_list: атрибуты в генерации + артефакты ──
create or replace function public.spy_recruits_list()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; uid uuid; v_last timestamptz; i int; fn text; ln text; pk text; rc text; gn text; rp text; frace text;
  first_names text[] := array['Алекс','Марк','Юри','Дана','Лена','Ник','Ивар','Соня','Рэй','Тао',
                              'Мира','Кай','Лев','Зара','Орин','Вера','Дрейк','Нея','Костас','Айла'];
  last_names  text[] := array['Восс','Кейн','Орлов','Драй','Морозов','Сато','Винтер','Холт','Рейес','Ким',
                              'Блэк','Норд','Айронс','Стрелков','Грей','Фокс','Маяк','Тейн','Волков','Дельгадо'];
  perks       text[] := array['infiltrator','saboteur','ghost','analyst','handler'];
  genders     text[] := array['муж.','жен.','агендер'];
  repls       text[] := array['Оригинал','Оригинал','Оригинал','Клон','Репликант'];
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid(); uid := auth.uid();
  -- Раса рекрута = раса фракции (твои шпионы — твой народ). Берём из анкеты.
  select race into frace from public.faction_applications
    where faction_id=fid and status='approved' order by updated_at desc limit 1;
  if frace is null then
    select race into frace from public.faction_applications
      where faction_id=fid order by updated_at desc limit 1;
  end if;
  select max(created_at) into v_last from public.spy_recruits where faction_id=fid;
  if v_last is null or v_last < now() - interval '7 days' then
    delete from public.spy_recruits where faction_id=fid;
    for i in 1..4 loop
      fn := first_names[1 + floor(random()*array_length(first_names,1))::int];
      ln := last_names[1 + floor(random()*array_length(last_names,1))::int];
      pk := perks[1 + floor(random()*array_length(perks,1))::int];
      rc := frace;  -- раса фракции (NULL → портрет «универсальный/любой»)
      gn := genders[1 + floor(random()*array_length(genders,1))::int];
      rp := repls[1 + floor(random()*array_length(repls,1))::int];
      insert into public.spy_recruits(faction_id, owner_id, first_name, last_name, perk, cost, race, gender, replication)
        values(fid, uid, fn, ln, pk, public._spy_perk_cost(pk) + floor(random()*200), rc, gn, rp);
    end loop;
  end if;
  return jsonb_build_object(
    'cap',   public._spy_agent_cap(fid),
    'hired', (select count(*) from public.spy_agents where faction_id=fid and coalesce(captive,false)=false),
    'roster',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',a.id,'first_name',a.first_name,'last_name',a.last_name,
                'perk',a.perk,'perk2',a.perk2,'ready_at',a.ready_at,
                'race',a.race,'gender',a.gender,'replication',a.replication,
                'level',coalesce(a.level,1),'xp',coalesce(a.xp,0),
                'xp_floor',public._spy_xp_floor(coalesce(a.level,1)),
                'xp_next', case when coalesce(a.level,1) >= 5 then null
                                else public._spy_xp_floor(coalesce(a.level,1)+1) end,
                'arts',(select coalesce(jsonb_agg(art.kind order by art.acquired_at),'[]'::jsonb)
                        from public.spy_artifacts art where art.equipped_agent=a.id),
                'status', case when a.ready_at > now() then 'training'
                               when exists(select 1 from public.spy_missions sm where sm.actor_fid=fid and sm.status='active' and sm.agent_ids ? a.id::text) then 'busy'
                               else 'ready' end) order by a.hired_at), '[]'::jsonb)
              from public.spy_agents a where a.faction_id=fid and coalesce(a.captive,false)=false),
    'prisoners',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',a.id,'first_name',a.first_name,'last_name',a.last_name,
                'perk',a.perk,'perk2',a.perk2,'level',coalesce(a.level,1),
                'race',a.race,'gender',a.gender,'replication',a.replication,
                'orig_fid',a.orig_fid,'orig_name',public._fac_name(a.orig_fid),
                'captured_at',a.captured_at,
                'ransom_price',(select r.price_gc from public.spy_ransoms r where r.agent_id=a.id and r.status='pending' limit 1)
                ) order by a.captured_at desc), '[]'::jsonb)
              from public.spy_agents a where a.faction_id=fid and coalesce(a.captive,false)=true),
    'captured',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',a.id,'first_name',a.first_name,'last_name',a.last_name,
                'perk',a.perk,'level',coalesce(a.level,1),
                'captor_fid',a.faction_id,'captor_name',public._fac_name(a.faction_id),
                'ransom_id',(select r.id from public.spy_ransoms r where r.agent_id=a.id and r.status='pending' limit 1),
                'ransom_price',(select r.price_gc from public.spy_ransoms r where r.agent_id=a.id and r.status='pending' limit 1)
                ) order by a.captured_at desc), '[]'::jsonb)
              from public.spy_agents a where a.orig_fid=fid and coalesce(a.captive,false)=true),
    'artifacts',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',x.id,'kind',x.kind,'equipped_agent',x.equipped_agent) order by x.acquired_at), '[]'::jsonb)
              from public.spy_artifacts x where x.faction_id=fid),
    'recruits',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',id,'first_name',first_name,'last_name',last_name,'perk',perk,'cost',cost,
                'race',race,'gender',gender,'replication',replication) order by cost), '[]'::jsonb)
              from public.spy_recruits where faction_id=fid),
    'refresh_at', (select max(created_at) + interval '7 days' from public.spy_recruits where faction_id=fid));
end$$;
revoke all on function public.spy_recruits_list() from public;
grant execute on function public.spy_recruits_list() to authenticated;

-- ── 3. Экипировать / снять артефакт ─────────────────────────
create or replace function public.spy_artifact_equip(p_artifact_id uuid, p_agent_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_slots int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if not exists(select 1 from public.spy_artifacts where id=p_artifact_id and faction_id=fid) then
    raise exception 'artifact not found'; end if;
  if not exists(select 1 from public.spy_agents where id=p_agent_id and faction_id=fid and coalesce(captive,false)=false) then
    raise exception 'agent not available'; end if;
  select count(*) into v_slots from public.spy_artifacts where equipped_agent=p_agent_id;
  if v_slots >= 2 then raise exception 'agent slots full (2)'; end if;
  update public.spy_artifacts set equipped_agent=p_agent_id where id=p_artifact_id;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.spy_artifact_equip(uuid,uuid) from public;
grant execute on function public.spy_artifact_equip(uuid,uuid) to authenticated;

create or replace function public.spy_artifact_unequip(p_artifact_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  update public.spy_artifacts set equipped_agent=null where id=p_artifact_id and faction_id=fid;
  if not found then raise exception 'artifact not found'; end if;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.spy_artifact_unequip(uuid) from public;
grant execute on function public.spy_artifact_unequip(uuid) to authenticated;

-- ── 4. spy_launch: + бонусы экипированных артефактов ───────
create or replace function public.spy_launch(p_target_fid text, p_op text, p_agent_ids jsonb, p_colony_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; tgt public.faction_economy;
  meta jsonb; intel jsonb; diff numeric; need text; rec text;
  a int; ci int; ibonus numeric; spow numeric; succ int; det int; turns int;
  tgt_owner uuid; v_ids uuid[]; v_avail int; succ_b int; det_b int; v_colony uuid;
  art_succ numeric; art_det numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  meta := public._spy_op_meta(p_op);
  if meta is null then raise exception 'bad op'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_target_fid = app.faction_id then raise exception 'self'; end if;

  if p_op = 'faith_impose' then
    if not exists(select 1 from public.faith_membership where faction_id=app.faction_id) then
      raise exception 'you follow no faith to spread'; end if;
    if exists(select 1 from public.faith_sects where owner_fid=app.faction_id and host_fid=p_target_fid and status='active') then
      raise exception 'you already run a sect in that nation'; end if;
  end if;

  select * into me from public.faction_economy where faction_id=app.faction_id for update;
  select * into tgt from public.faction_economy where faction_id=p_target_fid;
  if not found then raise exception 'target has no economy'; end if;
  select owner_id into tgt_owner from public.faction_economy where faction_id=p_target_fid;

  select array_agg(ag.id) into v_ids
  from public.spy_agents ag
  where ag.faction_id=app.faction_id and coalesce(ag.captive,false)=false
    and ag.id in (select (jsonb_array_elements_text(coalesce(p_agent_ids,'[]'::jsonb)))::uuid)
    and ag.ready_at <= now()
    and not exists(select 1 from public.spy_missions sm
                   where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text);
  a := coalesce(array_length(v_ids,1),0);
  if a < 1 then raise exception 'select at least one available agent'; end if;
  if p_op in ('steal_tech','mass_demolish') and a < 2 then
    raise exception 'this op needs a network: at least 2 agents'; end if;

  select count(*) into v_avail from public.spy_agents ag
  where ag.faction_id=app.faction_id and ag.ready_at<=now() and coalesce(ag.captive,false)=false
    and not exists(select 1 from public.spy_missions sm
                   where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text);
  if a > v_avail - coalesce(me.counter_agents,0) then raise exception 'agents reserved for counterintel'; end if;

  intel := public._spy_intel(app.faction_id, p_target_fid);
  need := meta->>'need'; rec := intel->>'level';
  if need = 'basic' and rec is null then raise exception 'intel required: basic recon'; end if;
  if need = 'deep'  and rec is distinct from 'deep' then raise exception 'intel required: deep recon'; end if;

  if p_op in ('sabotage','mass_demolish') and p_colony_id is not null
     and exists(select 1 from public.colonies where id=p_colony_id and faction_id=p_target_fid) then
    v_colony := p_colony_id;
  end if;

  select coalesce(sum(
           public._spy_perk_succ(ag.perk,  p_op, ag.level)
         + public._spy_perk_succ(ag.perk2, p_op, ag.level)
         + (greatest(coalesce(ag.level,1),1)-1)*3 ),0),
         coalesce(sum(
           (case when ag.perk='ghost' or ag.perk2='ghost'
                 then 10 + (greatest(coalesce(ag.level,1),1)-1)*2 else 0 end)
         + (greatest(coalesce(ag.level,1),1)-1)*2 ),0)
    into succ_b, det_b
    from public.spy_agents ag where ag.id = any(v_ids);

  -- бонусы экипированных артефактов выбранных агентов
  select coalesce(sum(public._spy_artifact_succ(art.kind, p_op)),0),
         coalesce(sum(public._spy_artifact_det(art.kind)),0)
    into art_succ, art_det
    from public.spy_artifacts art where art.equipped_agent = any(v_ids);
  succ_b := succ_b + art_succ; det_b := det_b + art_det;

  diff := (meta->>'diff')::numeric;
  if p_op in ('sabotage','mass_demolish') and v_colony is not null then
    ci := public._spy_ci_power(p_target_fid, v_colony::text);
  else
    ci := public._spy_ci_power(p_target_fid, 'hq');
  end if;
  ibonus := case when meta ? 'recon' then 0
                 else greatest(0, (case when rec='deep' then 20 else 10 end) - coalesce((intel->>'age')::numeric,9999)) end;
  spow := public._spy_power(app.faction_id);
  succ := greatest(5,  least(95, round(45 + a*8 + ibonus + spow - diff - ci*9 + succ_b)));
  det  := greatest(2,  least(90, round(8 + diff*0.5 + ci*12 + a*2 + public._spy_power(p_target_fid) - spow - det_b)));
  turns := greatest(1, least(2, ceil((meta->>'base')::numeric / sqrt(a))));

  insert into public.spy_missions(actor_fid,actor_owner,target_fid,target_owner,target_name,op,mtype,agents,
      agent_ids, target_colony, success_pct,detect_pct,status,started_at,ready_at,params)
    values(app.faction_id, auth.uid(), p_target_fid, tgt_owner, public._fac_name(p_target_fid), p_op, p_op, a,
      (select jsonb_agg(x::text) from unnest(v_ids) x), v_colony,
      succ, det, 'active', now(), coalesce(me.last_tick, now()) + (turns || ' days')::interval, '{}'::jsonb);
  return jsonb_build_object('ok',true,'success_pct',succ,'detect_pct',det,'turns',turns,'agents',a);
end$$;
revoke all on function public.spy_launch(text,text,jsonb,uuid) from public;
grant execute on function public.spy_launch(text,text,jsonb,uuid) to authenticated;

-- ── 5. _spy_resolve: дроп артефактов + XP-множитель + снятие при пленении ──
create or replace function public._spy_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare m public.spy_missions; ok boolean; caught boolean; res jsonb; steal numeric; bid uuid; bt text;
  techs jsonb; node text; tgt public.faction_economy; v_colname text;
  v_faith uuid; v_faith_name text;
  v_res_name text; v_res_have numeric; v_res_steal numeric;
  v_n_destroy int; v_i int;
  v_kill_id uuid; v_kill_name text;
  v_xp numeric; aid text;
  v_cap_id uuid; v_cap_name text;
  v_art_kind text; arts text[] := array['masterkey','charge','scanner','blade','neurochip','jammer','mask','sim'];
begin
  for m in select * from public.spy_missions where actor_fid=p_fid and status='active' and ready_at<=now() loop
    ok := (random()*100) < m.success_pct;
    caught := (random()*100) < m.detect_pct;
    res := '{}'::jsonb; v_cap_id := null;
    select * into tgt from public.faction_economy where faction_id=m.target_fid;

    if ok then
      if m.op in ('recon_basic','recon_deep') then
        res := jsonb_build_object('gc',tgt.gc,'science',tgt.science,
          'agents',(select count(*) from public.spy_agents where faction_id=m.target_fid and ready_at<=now() and coalesce(captive,false)=false),
          'colonies',(select count(*) from public.colonies where faction_id=m.target_fid),
          'buildings',(select count(*) from public.colony_buildings where faction_id=m.target_fid));
        res := res || jsonb_build_object('colony_list', (
          select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.planet_name,
              'buildings', case when m.op='recon_deep'
                then (select coalesce(jsonb_agg(distinct cb.btype), '[]'::jsonb) from public.colony_buildings cb where cb.colony_id=c.id)
                else null end) order by c.created_at), '[]'::jsonb)
          from public.colonies c where c.faction_id=m.target_fid));
        if m.op='recon_deep' then res := res || jsonb_build_object(
          'units',(select coalesce(sum(qty),0) from public.unit_production where faction_id=m.target_fid and status='done'),
          'research',(select coalesce(jsonb_array_length(research),0) from public.faction_economy where faction_id=m.target_fid)); end if;

      elsif m.op='steal_gc' then
        steal := round(coalesce(tgt.gc,0) * least(0.30, 0.06*m.agents));
        update public.faction_economy set gc=greatest(0,gc-steal) where faction_id=m.target_fid;
        update public.faction_economy set gc=gc+steal where faction_id=m.actor_fid;
        res := jsonb_build_object('gc',steal);

      elsif m.op='steal_res' then
        select key into v_res_name from jsonb_each_text(coalesce(tgt.resources,'{}'))
          where value::numeric > 0 order by random() limit 1;
        if v_res_name is not null then
          v_res_have  := coalesce((tgt.resources->>v_res_name)::numeric, 0);
          v_res_steal := greatest(1, round(v_res_have * least(0.25, 0.06 * m.agents)));
          update public.faction_economy
            set resources = jsonb_set(coalesce(resources,'{}'), array[v_res_name],
              to_jsonb(greatest(0, coalesce((resources->>v_res_name)::numeric,0) - v_res_steal)))
            where faction_id=m.target_fid;
          update public.faction_economy
            set resources = jsonb_set(coalesce(resources,'{}'), array[v_res_name],
              to_jsonb(coalesce((resources->>v_res_name)::numeric,0) + v_res_steal))
            where faction_id=m.actor_fid;
          res := jsonb_build_object('resource', v_res_name, 'amount', v_res_steal);
        else
          ok := false; res := jsonb_build_object('note','no resources to steal');
        end if;

      elsif m.op='sabotage' then
        if m.target_colony is not null then
          select id,btype into bid,bt from public.colony_buildings
            where colony_id=m.target_colony and faction_id=m.target_fid order by random() limit 1;
        end if;
        if bid is null then
          select id,btype into bid,bt from public.colony_buildings where faction_id=m.target_fid order by random() limit 1;
        end if;
        select planet_name into v_colname from public.colonies where id = coalesce(m.target_colony, (select colony_id from public.colony_buildings where id=bid));
        if bid is not null then delete from public.colony_buildings where id=bid;
          res := jsonb_build_object('building',bt,'colony',v_colname);
        else res := jsonb_build_object('building',null); end if;

      elsif m.op='mass_demolish' then
        v_n_destroy := least(m.agents, 5);
        res := jsonb_build_object('buildings', '[]'::jsonb, 'count', 0);
        for v_i in 1..v_n_destroy loop
          bid := null; bt := null;
          if m.target_colony is not null then
            select id,btype into bid,bt from public.colony_buildings
              where colony_id=m.target_colony and faction_id=m.target_fid order by random() limit 1;
          end if;
          if bid is null then
            select id,btype into bid,bt from public.colony_buildings
              where faction_id=m.target_fid order by random() limit 1;
          end if;
          if bid is not null then
            delete from public.colony_buildings where id=bid;
            res := jsonb_set(
              jsonb_set(res, '{count}', to_jsonb((res->>'count')::int + 1)),
              '{buildings}', (res->'buildings') || to_jsonb(bt));
          end if;
        end loop;
        if (res->>'count')::int = 0 then ok := false; end if;

      elsif m.op='steal_tech' then
        select research into techs from public.faction_economy where faction_id=m.target_fid;
        node := (select value::text from jsonb_array_elements_text(coalesce(techs,'[]'::jsonb)) value
                 where value::text not in (select jsonb_array_elements_text(coalesce(research,'[]'::jsonb)) from public.faction_economy where faction_id=m.actor_fid)
                 order by random() limit 1);
        if node is not null then
          update public.faction_economy set research = coalesce(research,'[]'::jsonb) || to_jsonb(node) where faction_id=m.actor_fid;
          res := jsonb_build_object('tech',node,'tech_name',node);
        else ok := false; res := jsonb_build_object('note','no tech to steal'); end if;

      elsif m.op='destabilize' then
        update public.faction_economy set debuff_pct=0.25, debuff_until=now()+interval '3 days' where faction_id=m.target_fid;
        res := jsonb_build_object('debuff_pct',0.25,'turns',3);

      elsif m.op='kill_agent' then
        select id, first_name || ' ' || last_name into v_kill_id, v_kill_name
          from public.spy_agents where faction_id=m.target_fid and ready_at<=now() and coalesce(captive,false)=false
          order by random() limit 1;
        if v_kill_id is not null then
          delete from public.spy_agents where id=v_kill_id;
          res := jsonb_build_object('agent_name', v_kill_name);
        else
          ok := false; res := jsonb_build_object('note','no available agents to eliminate');
        end if;

      elsif m.op='faith_impose' then
        select fm.faith_id into v_faith from public.faith_membership fm where fm.faction_id=m.actor_fid;
        if v_faith is not null
           and not exists(select 1 from public.faith_sects where owner_fid=m.actor_fid and host_fid=m.target_fid and status='active') then
          insert into public.faith_sects(faith_id, owner_fid, host_fid)
            values(v_faith, m.actor_fid, m.target_fid);
          select name into v_faith_name from public.faiths where id=v_faith;
          res := jsonb_build_object('sect', v_faith_name);
        else
          ok := false; res := jsonb_build_object('note','sect already present or no faith');
        end if;

      elsif m.op='train' then
        res := jsonb_build_object('trained', m.agents);
      end if;

      -- дроп артефакта за успешную боевую операцию (12%)
      if ok and m.op not in ('recon_basic','recon_deep','train') and random() < 0.12 then
        v_art_kind := arts[1 + floor(random()*array_length(arts,1))::int];
        insert into public.spy_artifacts(faction_id, kind) values(m.actor_fid, v_art_kind);
        res := res || jsonb_build_object('artifact', v_art_kind);
      end if;
    end if;

    -- пойманный агент → плен (его артефакты снимаются и остаются у владельца)
    if caught and m.op <> 'train' and m.target_fid is distinct from m.actor_fid
       and jsonb_array_length(coalesce(m.agent_ids,'[]'::jsonb)) > 0 then
      v_cap_id := (m.agent_ids->>0)::uuid;
      update public.spy_artifacts set equipped_agent=null where equipped_agent=v_cap_id;
      update public.spy_agents
        set captive=true, orig_fid=faction_id, orig_owner=owner_id,
            faction_id=m.target_fid, owner_id=m.target_owner, captured_at=now()
        where id=v_cap_id and faction_id=m.actor_fid and coalesce(captive,false)=false
        returning first_name || ' ' || last_name into v_cap_name;
      if v_cap_name is not null then
        res := res || jsonb_build_object('caught',true,'captured',true,'actor_name',public._fac_name(m.actor_fid));
        insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
            title, excerpt, body, status, published_at, created_at, updated_at)
          values(m.actor_fid, '🕵 СПЕЦСЛУЖБА', 'rgba(200,90,90,0.55)', null, null,
            'Агент схвачен', null,
            format('Ваш оперативник «%s» провалил операцию и захвачен фракцией «%s». Его судьба теперь в руках противника.',
              v_cap_name, public._fac_name(m.target_fid)),
            'approved', now(), now(), now());
      else
        v_cap_id := null;
        res := res || jsonb_build_object('caught',true,'actor_name',public._fac_name(m.actor_fid));
      end if;
    end if;

    -- опыт уцелевшим (не пленённым) агентам, с учётом артефакта-симулятора
    v_xp := public._spy_op_xp(m.op) * (case when ok then 1 else 0.25 end);
    if v_xp > 0 then
      for aid in select jsonb_array_elements_text(coalesce(m.agent_ids,'[]'::jsonb)) loop
        if aid::uuid is distinct from v_cap_id then
          perform public._spy_grant_xp(aid::uuid, round(v_xp * public._spy_agent_xp_mult(aid::uuid)));
        end if;
      end loop;
    end if;

    update public.spy_missions
      set status='done', outcome=(case when ok then 'success' else 'fail' end), detected=caught, result=res
      where id=m.id;
    perform public._post_covert_rumor(m.op, m.target_fid);
  end loop;
end$$;
revoke all on function public._spy_resolve(text) from public;

-- ── spy_hire: переносим расу/пол/репликацию рекрута в агента ─
-- (старые версии spy_hire их теряли — агент выходил без расы, портрет не
--  совпадал). Раса рекрута = раса фракции (см. spy_recruits_list выше).
create or replace function public.spy_hire(p_recruit_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; me public.faction_economy; rc public.spy_recruits; cap int; have int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into rc from public.spy_recruits where id=p_recruit_id and faction_id=fid;
  if not found then raise exception 'recruit not available'; end if;
  select * into me from public.faction_economy where faction_id=fid for update;
  if not found then raise exception 'no economy'; end if;
  cap := public._spy_agent_cap(fid);
  select count(*) into have from public.spy_agents where faction_id=fid and coalesce(captive,false)=false;
  if have >= cap then raise exception 'agent cap reached (% / %)', have, cap; end if;
  update public.faction_economy set gc = gc - rc.cost where faction_id=fid and gc >= rc.cost;
  if not found then raise exception 'not enough GC'; end if;
  insert into public.spy_agents(faction_id, owner_id, first_name, last_name, perk, ready_at, race, gender, replication)
    values(fid, auth.uid(), rc.first_name, rc.last_name, rc.perk, now() + interval '1 day', rc.race, rc.gender, rc.replication);
  delete from public.spy_recruits where id=p_recruit_id;
  return jsonb_build_object('ok',true,'agent',rc.first_name||' '||rc.last_name,'perk',rc.perk,'cost',rc.cost,'training_turns',1);
end$$;
revoke all on function public.spy_hire(uuid) from public;
grant execute on function public.spy_hire(uuid) to authenticated;

-- ── Бэкфилл: раса = раса фракции ────────────────────────────
-- У ранее нанятых агентов и текущих рекрутов раса была случайной из
-- выдуманного списка. Проставляем расу фракции (твои шпионы — твой народ).
-- Пол НЕ трогаем (он остаётся случайным и закреплённым за агентом).
-- Пленных не трогаем: их раса — раса их РОДНОЙ фракции (orig_fid), а не
-- захватчика, под которым они сейчас числятся.
update public.spy_agents s
  set race = fa.race
  from public.faction_applications fa
  where fa.faction_id = s.faction_id
    and fa.status = 'approved'
    and coalesce(s.captive,false) = false
    and coalesce(s.race,'') is distinct from fa.race;

update public.spy_recruits s
  set race = fa.race
  from public.faction_applications fa
  where fa.faction_id = s.faction_id
    and fa.status = 'approved'
    and coalesce(s.race,'') is distinct from fa.race;

-- ── Проверка ────────────────────────────────────────────────
-- Новые рекруты имеют расу/пол/репликацию. Успешные боевые операции иногда
-- дают артефакт (faction inventory). spy_artifact_equip(art,agent) ставит его
-- (макс 2 на агента) — бонусы успеха/скрытности/XP идут в расчёт операции.
