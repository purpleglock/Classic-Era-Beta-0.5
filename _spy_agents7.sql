-- ============================================================
-- ШПИОНАЖ · ЭТАП 7: ПЛЕН ПОЙМАННОГО АГЕНТА (казнь / возврат / выкуп / вербовка)
-- Применять в Supabase → SQL Editor ПОСЛЕ _spy_agents6.sql. Идемпотентно.
--
-- Раньше пойманный агент просто УДАЛЯЛСЯ. Теперь он попадает в ПЛЕН к жертве:
--   • агент переходит к жертве (faction_id=жертва, captive=true), исходный
--     владелец сохраняется в orig_fid/orig_owner — владелец перестаёт его видеть,
--     потолок найма у него освобождается;
--   • жертва (captor) решает судьбу пленника:
--       ⚔ Казнить    — уничтожить навсегда (владелец: −отношения, casus belli);
--       🕊 Вернуть    — отпустить даром (владелец: +отношения, добрая воля);
--       💰 Выкуп      — выставить цену в ГС; владелец принимает (платит → агент
--                       возвращается) или отклоняет (остаётся в плену);
--       🔁 Завербовать — перевербовать в ДВОЙНОГО агента себе (−ГС, в свой ростер).
--
-- Файл ПЕРЕСОЗДАЁТ как надмножество функции среза 6, добавляя фильтр «не пленник»
-- (coalesce(captive,false)=false) во все места, где считаются ДОСТУПНЫЕ агенты.
-- ============================================================

-- ── 0. Поля плена + таблица выкупов ─────────────────────────
alter table public.spy_agents add column if not exists captive     boolean default false;
alter table public.spy_agents add column if not exists orig_fid    text;
alter table public.spy_agents add column if not exists orig_owner  uuid;
alter table public.spy_agents add column if not exists captured_at timestamptz;
create index if not exists spy_agents_captive_idx on public.spy_agents(faction_id) where captive;
create index if not exists spy_agents_orig_idx    on public.spy_agents(orig_fid)   where captive;

create table if not exists public.spy_ransoms (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid references public.spy_agents(id) on delete cascade,
  captor_fid text not null,
  owner_fid  text not null,
  price_gc   numeric not null,
  status     text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz default now()
);
create index if not exists spy_ransoms_idx on public.spy_ransoms(agent_id) where status='pending';
alter table public.spy_ransoms enable row level security;
-- чтение только через RPC (security definer); прямого select нет
drop policy if exists "spy_ransoms_sel" on public.spy_ransoms;
create policy "spy_ransoms_sel" on public.spy_ransoms for select to authenticated using (false);

-- ── 1. _spy_ci_power: Кураторы-пленники КР не усиливают ──────
create or replace function public._spy_ci_power(p_fid text, p_scope text)
returns int language sql stable security definer set search_path=public as $$
  select coalesce((select (counter_map->>p_scope)::int from public.faction_economy where faction_id=p_fid),0)
       + coalesce((select count(*)::int from public.spy_agents
                   where faction_id=p_fid and perk='handler' and ready_at<=now()
                     and coalesce(captive,false)=false),0)
$$;
revoke all on function public._spy_ci_power(text,text) from public;
grant execute on function public._spy_ci_power(text,text) to authenticated;

-- ── 2. spy_recruits_list: ростер без пленников + пленники + мои захваченные ──
create or replace function public.spy_recruits_list()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; uid uuid; v_last timestamptz; i int; fn text; ln text; pk text;
  first_names text[] := array['Алекс','Марк','Юри','Дана','Лена','Ник','Ивар','Соня','Рэй','Тао',
                              'Мира','Кай','Лев','Зара','Орин','Вера','Дрейк','Нея','Костас','Айла'];
  last_names  text[] := array['Восс','Кейн','Орлов','Драй','Морозов','Сато','Винтер','Холт','Рейес','Ким',
                              'Блэк','Норд','Айронс','Стрелков','Грей','Фокс','Маяк','Тейн','Волков','Дельгадо'];
  perks       text[] := array['infiltrator','saboteur','ghost','analyst','handler'];
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid(); uid := auth.uid();
  select max(created_at) into v_last from public.spy_recruits where faction_id=fid;
  if v_last is null or v_last < now() - interval '7 days' then
    delete from public.spy_recruits where faction_id=fid;
    for i in 1..4 loop
      fn := first_names[1 + floor(random()*array_length(first_names,1))::int];
      ln := last_names[1 + floor(random()*array_length(last_names,1))::int];
      pk := perks[1 + floor(random()*array_length(perks,1))::int];
      insert into public.spy_recruits(faction_id, owner_id, first_name, last_name, perk, cost)
        values(fid, uid, fn, ln, pk, public._spy_perk_cost(pk) + floor(random()*200));
    end loop;
  end if;
  return jsonb_build_object(
    'cap',   public._spy_agent_cap(fid),
    'hired', (select count(*) from public.spy_agents where faction_id=fid and coalesce(captive,false)=false),
    'roster',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',a.id,'first_name',a.first_name,'last_name',a.last_name,
                'perk',a.perk,'perk2',a.perk2,'ready_at',a.ready_at,
                'level',coalesce(a.level,1),'xp',coalesce(a.xp,0),
                'xp_floor',public._spy_xp_floor(coalesce(a.level,1)),
                'xp_next', case when coalesce(a.level,1) >= 5 then null
                                else public._spy_xp_floor(coalesce(a.level,1)+1) end,
                'status', case when a.ready_at > now() then 'training'
                               when exists(select 1 from public.spy_missions sm where sm.actor_fid=fid and sm.status='active' and sm.agent_ids ? a.id::text) then 'busy'
                               else 'ready' end) order by a.hired_at), '[]'::jsonb)
              from public.spy_agents a where a.faction_id=fid and coalesce(a.captive,false)=false),
    -- пленники, которых держу Я (захвачены у других): можно судить
    'prisoners',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',a.id,'first_name',a.first_name,'last_name',a.last_name,
                'perk',a.perk,'perk2',a.perk2,'level',coalesce(a.level,1),
                'orig_fid',a.orig_fid,'orig_name',public._fac_name(a.orig_fid),
                'captured_at',a.captured_at,
                'ransom_price',(select r.price_gc from public.spy_ransoms r where r.agent_id=a.id and r.status='pending' limit 1)
                ) order by a.captured_at desc), '[]'::jsonb)
              from public.spy_agents a where a.faction_id=fid and coalesce(a.captive,false)=true),
    -- МОИ агенты в чужом плену: вижу, кто держит, и предложенный выкуп
    'captured',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',a.id,'first_name',a.first_name,'last_name',a.last_name,
                'perk',a.perk,'level',coalesce(a.level,1),
                'captor_fid',a.faction_id,'captor_name',public._fac_name(a.faction_id),
                'ransom_id',(select r.id from public.spy_ransoms r where r.agent_id=a.id and r.status='pending' limit 1),
                'ransom_price',(select r.price_gc from public.spy_ransoms r where r.agent_id=a.id and r.status='pending' limit 1)
                ) order by a.captured_at desc), '[]'::jsonb)
              from public.spy_agents a where a.orig_fid=fid and coalesce(a.captive,false)=true),
    'recruits',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',id,'first_name',first_name,'last_name',last_name,'perk',perk,'cost',cost) order by cost), '[]'::jsonb)
              from public.spy_recruits where faction_id=fid),
    'refresh_at', (select max(created_at) + interval '7 days' from public.spy_recruits where faction_id=fid));
end$$;
revoke all on function public.spy_recruits_list() from public;
grant execute on function public.spy_recruits_list() to authenticated;

-- ── 3. counterintel_set: пленников нельзя ставить в КР ──────
create or replace function public.counterintel_set(p_scope text, p_n int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_avail int; v_other int; n int; cur_map jsonb; total int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  perform 1 from public.faction_economy where faction_id=fid for update;
  if p_scope <> 'hq' and not exists(select 1 from public.colonies where id=p_scope::uuid and faction_id=fid) then
    raise exception 'bad scope';
  end if;
  select count(*) into v_avail from public.spy_agents ag
    where ag.faction_id=fid and ag.ready_at<=now() and coalesce(ag.captive,false)=false
      and not exists(select 1 from public.spy_missions sm where sm.actor_fid=fid and sm.status='active' and sm.agent_ids ? ag.id::text);
  select coalesce(counter_map,'{}'::jsonb) into cur_map from public.faction_economy where faction_id=fid;
  select coalesce(sum(value::int),0) into v_other from jsonb_each_text(cur_map) where key <> p_scope;
  n := greatest(0, least(coalesce(p_n,0), v_avail - v_other));
  if n = 0 then cur_map := cur_map - p_scope;
  else cur_map := jsonb_set(cur_map, array[p_scope], to_jsonb(n), true); end if;
  select coalesce(sum(value::int),0) into total from jsonb_each_text(cur_map);
  update public.faction_economy set counter_map=cur_map, counter_agents=total where faction_id=fid;
  return jsonb_build_object('ok',true,'scope',p_scope,'n',n,'total',total);
end$$;
revoke all on function public.counterintel_set(text,int) from public;
grant execute on function public.counterintel_set(text,int) to authenticated;

-- ── 4. spy_launch: доступные агенты — без пленников ─────────
create or replace function public.spy_launch(p_target_fid text, p_op text, p_agent_ids jsonb, p_colony_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; tgt public.faction_economy;
  meta jsonb; intel jsonb; diff numeric; need text; rec text;
  a int; ci int; ibonus numeric; spow numeric; succ int; det int; turns int;
  tgt_owner uuid; v_ids uuid[]; v_avail int; succ_b int; det_b int; v_colony uuid;
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

-- ── 5. spy_train: доступные агенты — без пленников ─────────
create or replace function public.spy_train(p_agent_ids jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy;
  v_ids uuid[]; a int; v_avail int; v_cost numeric; turns int := 2;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into me from public.faction_economy where faction_id=app.faction_id for update;
  if not found then raise exception 'no economy'; end if;

  select array_agg(ag.id) into v_ids
  from public.spy_agents ag
  where ag.faction_id=app.faction_id and coalesce(ag.captive,false)=false
    and ag.id in (select (jsonb_array_elements_text(coalesce(p_agent_ids,'[]'::jsonb)))::uuid)
    and ag.ready_at <= now()
    and not exists(select 1 from public.spy_missions sm
                   where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text);
  a := coalesce(array_length(v_ids,1),0);
  if a < 1 then raise exception 'select at least one available agent'; end if;

  select count(*) into v_avail from public.spy_agents ag
  where ag.faction_id=app.faction_id and ag.ready_at<=now() and coalesce(ag.captive,false)=false
    and not exists(select 1 from public.spy_missions sm
                   where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text);
  if a > v_avail - coalesce(me.counter_agents,0) then raise exception 'agents reserved for counterintel'; end if;

  v_cost := a * 120;
  update public.faction_economy set gc = gc - v_cost where faction_id=app.faction_id and gc >= v_cost;
  if not found then raise exception 'not enough GC (need %)', v_cost; end if;

  insert into public.spy_missions(actor_fid,actor_owner,target_fid,target_owner,target_name,op,mtype,agents,
      agent_ids, success_pct,detect_pct,status,started_at,ready_at,params)
    values(app.faction_id, auth.uid(), app.faction_id, auth.uid(), '— тайное обучение —', 'train', 'train', a,
      (select jsonb_agg(x::text) from unnest(v_ids) x),
      100, 0, 'active', now(), coalesce(me.last_tick, now()) + (turns || ' days')::interval, '{}'::jsonb);
  return jsonb_build_object('ok',true,'agents',a,'turns',turns,'cost',v_cost);
end$$;
revoke all on function public.spy_train(jsonb) from public;
grant execute on function public.spy_train(jsonb) to authenticated;

-- ── 6. _spy_resolve: пойманный агент → ПЛЕН (не удаление) ───
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
begin
  for m in select * from public.spy_missions where actor_fid=p_fid and status='active' and ready_at<=now() loop
    ok := (random()*100) < m.success_pct;
    caught := (random()*100) < m.detect_pct;
    res := '{}'::jsonb;
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
    end if;

    -- пойманный агент попадает В ПЛЕН к жертве (обучение не ловится; цель ≠ self)
    if caught and m.op <> 'train' and m.target_fid is distinct from m.actor_fid
       and jsonb_array_length(coalesce(m.agent_ids,'[]'::jsonb)) > 0 then
      v_cap_id := (m.agent_ids->>0)::uuid;
      update public.spy_agents
        set captive=true, orig_fid=faction_id, orig_owner=owner_id,
            faction_id=m.target_fid, owner_id=m.target_owner, captured_at=now()
        where id=v_cap_id and faction_id=m.actor_fid and coalesce(captive,false)=false
        returning first_name || ' ' || last_name into v_cap_name;
      if v_cap_name is not null then
        res := res || jsonb_build_object('caught',true,'captured',true,'actor_name',public._fac_name(m.actor_fid));
        -- владелец узнаёт: агент схвачен
        insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
            title, excerpt, body, status, published_at, created_at, updated_at)
          values(m.actor_fid, '🕵 СПЕЦСЛУЖБА', 'rgba(200,90,90,0.55)', null, null,
            'Агент схвачен', null,
            format('Ваш оперативник «%s» провалил операцию и захвачен фракцией «%s». Его судьба теперь в руках противника.',
              v_cap_name, public._fac_name(m.target_fid)),
            'approved', now(), now(), now());
      else
        res := res || jsonb_build_object('caught',true,'actor_name',public._fac_name(m.actor_fid));
      end if;
    end if;

    -- опыт уцелевшим (не пленённым) агентам
    v_xp := public._spy_op_xp(m.op) * (case when ok then 1 else 0.25 end);
    if v_xp > 0 then
      for aid in select jsonb_array_elements_text(coalesce(m.agent_ids,'[]'::jsonb)) loop
        if aid::uuid is distinct from v_cap_id then
          perform public._spy_grant_xp(aid::uuid, v_xp);
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

-- ── 7. Действия ЖЕРТВЫ (captor) над пленником ──────────────
-- helper: достать пленника, которого держу Я
create or replace function public._spy_my_captive(p_id uuid)
returns public.spy_agents language plpgsql security definer set search_path=public as $$
declare fid text; ag public.spy_agents;
begin
  fid := public._ec_my_fid();
  select * into ag from public.spy_agents where id=p_id and faction_id=fid and coalesce(captive,false)=true;
  if not found then raise exception 'captive not found'; end if;
  return ag;
end$$;
revoke all on function public._spy_my_captive(uuid) from public;

-- ⚔ Казнить: уничтожить; владелец зол (−отношения, casus belli)
create or replace function public.spy_captive_execute(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; ag public.spy_agents; v_name text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  ag := public._spy_my_captive(p_id);
  v_name := ag.first_name || ' ' || ag.last_name;
  delete from public.spy_agents where id=ag.id;
  insert into public.faction_relations(from_fid,to_fid,score,updated_at)
    values(ag.orig_fid, fid, -12, now())
    on conflict (from_fid,to_fid) do update set score=greatest(-100, public.faction_relations.score-12), updated_at=now();
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, published_at, created_at, updated_at)
    values(ag.orig_fid, '🕵 СПЕЦСЛУЖБА', 'rgba(200,60,60,0.6)', null, null,
      'Агент казнён', null,
      format('Фракция «%s» казнила вашего пленённого оперативника «%s». Это не останется без ответа.',
        public._fac_name(fid), v_name),
      'approved', now(), now(), now());
  return jsonb_build_object('ok',true,'executed',v_name);
end$$;
revoke all on function public.spy_captive_execute(uuid) from public;
grant execute on function public.spy_captive_execute(uuid) to authenticated;

-- 🕊 Вернуть даром: отпустить владельцу (+отношения, добрая воля)
create or replace function public.spy_captive_return(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; ag public.spy_agents; v_name text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  ag := public._spy_my_captive(p_id);
  v_name := ag.first_name || ' ' || ag.last_name;
  update public.spy_agents
    set captive=false, faction_id=ag.orig_fid, owner_id=ag.orig_owner,
        orig_fid=null, orig_owner=null, captured_at=null, ready_at=now()
    where id=ag.id;
  delete from public.spy_ransoms where agent_id=ag.id and status='pending';
  insert into public.faction_relations(from_fid,to_fid,score,updated_at)
    values(ag.orig_fid, fid, 10, now())
    on conflict (from_fid,to_fid) do update set score=least(100, public.faction_relations.score+10), updated_at=now();
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, published_at, created_at, updated_at)
    values(ag.orig_fid, '🕊 ДИПЛОМАТИЯ', 'rgba(120,180,120,0.55)', null, null,
      'Агент возвращён', null,
      format('Фракция «%s» в знак доброй воли вернула вашего оперативника «%s» на родину.',
        public._fac_name(fid), v_name),
      'approved', now(), now(), now());
  return jsonb_build_object('ok',true,'returned',v_name);
end$$;
revoke all on function public.spy_captive_return(uuid) from public;
grant execute on function public.spy_captive_return(uuid) to authenticated;

-- 💰 Выставить выкуп (или обновить цену)
create or replace function public.spy_captive_ransom(p_id uuid, p_price_gc numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; ag public.spy_agents; v_price numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  ag := public._spy_my_captive(p_id);
  v_price := greatest(1, round(coalesce(p_price_gc,0)));
  delete from public.spy_ransoms where agent_id=ag.id and status='pending';
  insert into public.spy_ransoms(agent_id, captor_fid, owner_fid, price_gc, status)
    values(ag.id, fid, ag.orig_fid, v_price, 'pending');
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, published_at, created_at, updated_at)
    values(ag.orig_fid, '💰 ВЫКУП', 'rgba(200,170,60,0.55)', null, null,
      'Предложен выкуп за агента', null,
      format('Фракция «%s» готова вернуть вашего пленённого оперативника «%s %s» за %s ГС.',
        public._fac_name(fid), ag.first_name, ag.last_name, v_price),
      'approved', now(), now(), now());
  return jsonb_build_object('ok',true,'price',v_price);
end$$;
revoke all on function public.spy_captive_ransom(uuid,numeric) from public;
grant execute on function public.spy_captive_ransom(uuid,numeric) to authenticated;

-- 🔁 Завербовать пленника в двойного агента (−ГС, в свой ростер)
create or replace function public.spy_captive_recruit(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; ag public.spy_agents; v_name text; v_cost numeric := 400; cap int; have int; v_orig text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  ag := public._spy_my_captive(p_id);
  v_name := ag.first_name || ' ' || ag.last_name; v_orig := ag.orig_fid;
  -- потолок: вербовка добавляет агента в мой ростер
  cap := public._spy_agent_cap(fid);
  select count(*) into have from public.spy_agents where faction_id=fid and coalesce(captive,false)=false;
  if have >= cap then raise exception 'agent cap reached (% / %) — освободите слот', have, cap; end if;
  update public.faction_economy set gc = gc - v_cost where faction_id=fid and gc >= v_cost;
  if not found then raise exception 'not enough GC (need %)', v_cost; end if;
  -- становится моим (faction_id уже мой со времени пленения), снимаем флаг плена
  update public.spy_agents
    set captive=false, orig_fid=null, orig_owner=null, captured_at=null, ready_at=now()
    where id=ag.id;
  delete from public.spy_ransoms where agent_id=ag.id and status='pending';
  insert into public.faction_relations(from_fid,to_fid,score,updated_at)
    values(v_orig, fid, -10, now())
    on conflict (from_fid,to_fid) do update set score=greatest(-100, public.faction_relations.score-10), updated_at=now();
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, published_at, created_at, updated_at)
    values(v_orig, '🕵 ИЗМЕНА', 'rgba(180,80,160,0.55)', null, null,
      'Агент перевербован', null,
      format('Ваш пленённый оперативник «%s» переметнулся к фракции «%s» и теперь работает против вас.',
        v_name, public._fac_name(fid)),
      'approved', now(), now(), now());
  return jsonb_build_object('ok',true,'recruited',v_name,'cost',v_cost);
end$$;
revoke all on function public.spy_captive_recruit(uuid) from public;
grant execute on function public.spy_captive_recruit(uuid) to authenticated;

-- ── 8. Действия ВЛАДЕЛЬЦА по выкупу ────────────────────────
-- Принять выкуп: плачу captor'у, агент возвращается ко мне
create or replace function public.spy_ransom_accept(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; r public.spy_ransoms; ag public.spy_agents;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into r from public.spy_ransoms where id=p_id and owner_fid=fid and status='pending';
  if not found then raise exception 'ransom offer not found'; end if;
  select * into ag from public.spy_agents where id=r.agent_id and coalesce(captive,false)=true;
  if not found then raise exception 'captive no longer held'; end if;
  -- оплата (атомарно)
  update public.faction_economy set gc = gc - r.price_gc where faction_id=fid and gc >= r.price_gc;
  if not found then raise exception 'not enough GC (need %)', r.price_gc; end if;
  update public.faction_economy set gc = gc + r.price_gc where faction_id=r.captor_fid;
  -- возврат агента владельцу
  update public.spy_agents
    set captive=false, faction_id=ag.orig_fid, owner_id=ag.orig_owner,
        orig_fid=null, orig_owner=null, captured_at=null, ready_at=now()
    where id=ag.id;
  update public.spy_ransoms set status='accepted' where id=r.id;
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, published_at, created_at, updated_at)
    values(r.captor_fid, '💰 ВЫКУП', 'rgba(200,170,60,0.55)', null, null,
      'Выкуп уплачен', null,
      format('Фракция «%s» выкупила своего пленённого агента за %s ГС.', public._fac_name(fid), r.price_gc),
      'approved', now(), now(), now());
  return jsonb_build_object('ok',true,'paid',r.price_gc);
end$$;
revoke all on function public.spy_ransom_accept(uuid) from public;
grant execute on function public.spy_ransom_accept(uuid) to authenticated;

-- Отклонить выкуп: пленник остаётся у captor'а
create or replace function public.spy_ransom_decline(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  update public.spy_ransoms set status='declined' where id=p_id and owner_fid=fid and status='pending';
  if not found then raise exception 'ransom offer not found'; end if;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.spy_ransom_decline(uuid) from public;
grant execute on function public.spy_ransom_decline(uuid) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- Пойманный агент теперь в плену у жертвы (spy_recruits_list.prisoners у неё,
-- .captured у владельца). captor: spy_captive_execute/return/ransom/recruit.
-- владелец: spy_ransom_accept/decline. Возврат/выкуп возвращают агента с уровнем.
