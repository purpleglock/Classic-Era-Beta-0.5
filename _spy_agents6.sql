-- ============================================================
-- ШПИОНАЖ · ЭТАП 6: УРОВНИ И ПРОКАЧКА АГЕНТОВ + ТАЙНОЕ ОБУЧЕНИЕ
-- Применять в Supabase → SQL Editor ПОСЛЕ _spy_new_ops.sql и _faith_sect.sql.
-- Идемпотентно. Файл ПЕРЕСОЗДАЁТ spy_launch / _spy_resolve / spy_recruits_list
-- как НАДМНОЖЕСТВО обеих веток (новые операции _spy_new_ops + тайные секты
-- _faith_sect), добавляя сверху опыт/уровни и операцию обучения.
--
--  • Каждый агент копит XP за УСПЕШНЫЕ операции (провал — четверть, для роста).
--  • Уровни 1..5 по кумулятивному порогу XP: 0 / 100 / 300 / 600 / 1000.
--  • Уровень даёт: +3% успех и −2% раскрытие за уровень (на агента); перк-бонус
--    РАСТЁТ с уровнем (+2 за уровень); на 5-м уровне агент получает ВТОРОЙ перк.
--  • Новая тайная операция «Обучение» (spy_train): агенты уходят на 2 хода,
--    тратится ГС, по возвращении — гарантированный опыт, без риска раскрытия.
-- ============================================================

-- ── 0. Поля прокачки ────────────────────────────────────────
alter table public.spy_agents add column if not exists xp    numeric default 0;
alter table public.spy_agents add column if not exists level int     default 1;
alter table public.spy_agents add column if not exists perk2 text;

-- ── 1. Уровень по суммарному XP (кумулятивные пороги) ───────
create or replace function public._spy_level(p_xp numeric)
returns int language sql immutable as $$
  select case
    when coalesce(p_xp,0) >= 1000 then 5
    when coalesce(p_xp,0) >= 600  then 4
    when coalesce(p_xp,0) >= 300  then 3
    when coalesce(p_xp,0) >= 100  then 2
    else 1 end
$$;

-- Нижний порог XP для уровня (для XP-бара в UI)
create or replace function public._spy_xp_floor(p_level int)
returns numeric language sql immutable as $$
  select (case greatest(1,least(5,coalesce(p_level,1)))
    when 1 then 0 when 2 then 100 when 3 then 300 when 4 then 600 else 1000 end)::numeric
$$;

-- ── 2. XP за операцию ───────────────────────────────────────
create or replace function public._spy_op_xp(p_op text)
returns numeric language sql immutable as $$
  select (case p_op
    when 'recon_basic'   then 12 when 'recon_deep'    then 22
    when 'steal_gc'      then 25 when 'steal_res'     then 25
    when 'sabotage'      then 30 when 'destabilize'   then 30
    when 'kill_agent'    then 35 when 'faith_impose'  then 30
    when 'steal_tech'    then 45 when 'mass_demolish' then 40
    when 'train'         then 60
    else 15 end)::numeric
$$;

-- ── 3. Перк-бонус успеха с учётом уровня (+2 за уровень) ─────
create or replace function public._spy_perk_succ(p_perk text, p_op text, p_level int)
returns numeric language sql immutable as $$
  select (case
    when p_perk='infiltrator' and p_op in ('steal_gc','steal_tech','steal_res')      then 12 + (greatest(coalesce(p_level,1),1)-1)*2
    when p_perk='saboteur'    and p_op in ('sabotage','destabilize','mass_demolish') then 12 + (greatest(coalesce(p_level,1),1)-1)*2
    when p_perk='analyst'     and p_op in ('recon_basic','recon_deep')               then 10 + (greatest(coalesce(p_level,1),1)-1)*2
    when p_perk='ghost'       and p_op = 'kill_agent'                                then  8 + (greatest(coalesce(p_level,1),1)-1)*2
    else 0 end)::numeric
$$;
revoke all on function public._spy_perk_succ(text,text,int) from public;
grant execute on function public._spy_perk_succ(text,text,int) to authenticated;

-- ── 4. Начислить XP агенту: пересчитать уровень, на 5-м дать 2-й перк ──
create or replace function public._spy_grant_xp(p_agent_id uuid, p_xp numeric)
returns void language plpgsql security definer set search_path=public as $$
declare v_new int; v_perk text; v_perk2 text; v_xp numeric;
  perks text[] := array['infiltrator','saboteur','ghost','analyst','handler'];
begin
  update public.spy_agents set xp = coalesce(xp,0) + coalesce(p_xp,0)
    where id = p_agent_id
    returning xp, perk, perk2 into v_xp, v_perk, v_perk2;
  if not found then return; end if;
  v_new := public._spy_level(v_xp);
  update public.spy_agents set level = v_new where id = p_agent_id and coalesce(level,1) <> v_new;
  -- второй перк на максимальном уровне: случайный, отличный от основного
  if v_new >= 5 and v_perk2 is null then
    select p into v_perk2 from unnest(perks) p where p <> coalesce(v_perk,'') order by random() limit 1;
    update public.spy_agents set perk2 = v_perk2 where id = p_agent_id;
  end if;
end$$;
revoke all on function public._spy_grant_xp(uuid,numeric) from public;

-- ── 5. spy_recruits_list: ростер отдаёт уровень/XP/2-й перк ──
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
    'hired', (select count(*) from public.spy_agents where faction_id=fid),
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
              from public.spy_agents a where a.faction_id=fid),
    'recruits',(select coalesce(jsonb_agg(jsonb_build_object(
                'id',id,'first_name',first_name,'last_name',last_name,'perk',perk,'cost',cost) order by cost), '[]'::jsonb)
              from public.spy_recruits where faction_id=fid),
    'refresh_at', (select max(created_at) + interval '7 days' from public.spy_recruits where faction_id=fid));
end$$;
revoke all on function public.spy_recruits_list() from public;
grant execute on function public.spy_recruits_list() to authenticated;

-- ── 6. spy_launch (НАДМНОЖЕСТВО): новые операции + секты + бонус уровней ──
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

  -- тайная секта: нужна СВОЯ вера; нельзя держать две секты в одной державе
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
  where ag.faction_id=app.faction_id
    and ag.id in (select (jsonb_array_elements_text(coalesce(p_agent_ids,'[]'::jsonb)))::uuid)
    and ag.ready_at <= now()
    and not exists(select 1 from public.spy_missions sm
                   where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text);
  a := coalesce(array_length(v_ids,1),0);
  if a < 1 then raise exception 'select at least one available agent'; end if;
  -- операции, требующие сети (≥2 агента)
  if p_op in ('steal_tech','mass_demolish') and a < 2 then
    raise exception 'this op needs a network: at least 2 agents'; end if;

  select count(*) into v_avail from public.spy_agents ag
  where ag.faction_id=app.faction_id and ag.ready_at<=now()
    and not exists(select 1 from public.spy_missions sm
                   where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text);
  if a > v_avail - coalesce(me.counter_agents,0) then raise exception 'agents reserved for counterintel'; end if;

  intel := public._spy_intel(app.faction_id, p_target_fid);
  need := meta->>'need'; rec := intel->>'level';
  if need = 'basic' and rec is null then raise exception 'intel required: basic recon'; end if;
  if need = 'deep'  and rec is distinct from 'deep' then raise exception 'intel required: deep recon'; end if;

  -- саботаж и массовый снос могут бить по конкретной колонии
  if p_op in ('sabotage','mass_demolish') and p_colony_id is not null
     and exists(select 1 from public.colonies where id=p_colony_id and faction_id=p_target_fid) then
    v_colony := p_colony_id;
  end if;

  -- перк-бонусы выбранных агентов с учётом уровня + общий бонус уровня
  --   успех:  перк(основной)+перк(второй) с ростом по уровню, плюс +3%/уровень
  --   скрытность: Призрак −10%(+2/ур.), плюс общий −2%/уровень
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
  -- КР цели по области операции: колония для саботажа/сноса, иначе государственный Центр
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

-- ── 7. spy_train: тайное обучение (новая операция) ──────────
-- Агенты уходят на 2 хода, тратится 120 ГС/агента, по возвращении — опыт.
-- Без цели и без риска раскрытия. Миссия живёт в spy_missions с op='train'.
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
  where ag.faction_id=app.faction_id
    and ag.id in (select (jsonb_array_elements_text(coalesce(p_agent_ids,'[]'::jsonb)))::uuid)
    and ag.ready_at <= now()
    and not exists(select 1 from public.spy_missions sm
                   where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text);
  a := coalesce(array_length(v_ids,1),0);
  if a < 1 then raise exception 'select at least one available agent'; end if;

  -- нельзя забрать на обучение агентов, зарезервированных в контрразведке
  select count(*) into v_avail from public.spy_agents ag
  where ag.faction_id=app.faction_id and ag.ready_at<=now()
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

-- ── 8. _spy_resolve (НАДМНОЖЕСТВО): все операции + обучение + начисление XP ──
create or replace function public._spy_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare m public.spy_missions; ok boolean; caught boolean; res jsonb; steal numeric; bid uuid; bt text;
  techs jsonb; node text; tgt public.faction_economy; v_colname text;
  v_faith uuid; v_faith_name text;
  v_res_name text; v_res_have numeric; v_res_steal numeric;
  v_n_destroy int; v_i int;
  v_kill_id uuid; v_kill_name text;
  v_xp numeric; aid text;
begin
  for m in select * from public.spy_missions where actor_fid=p_fid and status='active' and ready_at<=now() loop
    ok := (random()*100) < m.success_pct;
    caught := (random()*100) < m.detect_pct;
    res := '{}'::jsonb;
    select * into tgt from public.faction_economy where faction_id=m.target_fid;

    if ok then
      -- ── разведка ──
      if m.op in ('recon_basic','recon_deep') then
        res := jsonb_build_object('gc',tgt.gc,'science',tgt.science,
          'agents',(select count(*) from public.spy_agents where faction_id=m.target_fid and ready_at<=now()),
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

      -- ── кража казны ──
      elsif m.op='steal_gc' then
        steal := round(coalesce(tgt.gc,0) * least(0.30, 0.06*m.agents));
        update public.faction_economy set gc=greatest(0,gc-steal) where faction_id=m.target_fid;
        update public.faction_economy set gc=gc+steal where faction_id=m.actor_fid;
        res := jsonb_build_object('gc',steal);

      -- ── кража ресурсов ──
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

      -- ── саботаж одного здания ──
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

      -- ── массовый снос зданий ──
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

      -- ── кража технологий ──
      elsif m.op='steal_tech' then
        select research into techs from public.faction_economy where faction_id=m.target_fid;
        node := (select value::text from jsonb_array_elements_text(coalesce(techs,'[]'::jsonb)) value
                 where value::text not in (select jsonb_array_elements_text(coalesce(research,'[]'::jsonb)) from public.faction_economy where faction_id=m.actor_fid)
                 order by random() limit 1);
        if node is not null then
          update public.faction_economy set research = coalesce(research,'[]'::jsonb) || to_jsonb(node) where faction_id=m.actor_fid;
          res := jsonb_build_object('tech',node,'tech_name',node);
        else ok := false; res := jsonb_build_object('note','no tech to steal'); end if;

      -- ── дестабилизация ──
      elsif m.op='destabilize' then
        update public.faction_economy set debuff_pct=0.25, debuff_until=now()+interval '3 days' where faction_id=m.target_fid;
        res := jsonb_build_object('debuff_pct',0.25,'turns',3);

      -- ── ликвидация агента ──
      elsif m.op='kill_agent' then
        select id, first_name || ' ' || last_name into v_kill_id, v_kill_name
          from public.spy_agents where faction_id=m.target_fid and ready_at<=now()
          order by random() limit 1;
        if v_kill_id is not null then
          delete from public.spy_agents where id=v_kill_id;
          res := jsonb_build_object('agent_name', v_kill_name);
        else
          ok := false; res := jsonb_build_object('note','no available agents to eliminate');
        end if;

      -- ── внедрение ТАЙНОЙ СЕКТЫ ──
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

      -- ── тайное обучение ──
      elsif m.op='train' then
        res := jsonb_build_object('trained', m.agents);
      end if;
    end if;

    -- пойманный агент схвачен (выбывает один из назначенных); обучение не ловится
    if caught and jsonb_array_length(coalesce(m.agent_ids,'[]'::jsonb)) > 0 then
      delete from public.spy_agents where id = (m.agent_ids->>0)::uuid and faction_id=m.actor_fid;
      res := res || jsonb_build_object('caught',true,'actor_name',public._fac_name(m.actor_fid));
    end if;

    -- ── НАЧИСЛЕНИЕ ОПЫТА: уцелевшим агентам (полный за успех, четверть за провал) ──
    v_xp := public._spy_op_xp(m.op) * (case when ok then 1 else 0.25 end);
    if v_xp > 0 then
      for aid in select jsonb_array_elements_text(coalesce(m.agent_ids,'[]'::jsonb)) loop
        perform public._spy_grant_xp(aid::uuid, v_xp);   -- no-op, если агента схватили
      end loop;
    end if;

    update public.spy_missions
      set status='done', outcome=(case when ok then 'success' else 'fail' end), detected=caught, result=res
      where id=m.id;
    perform public._post_covert_rumor(m.op, m.target_fid);
  end loop;
end$$;
revoke all on function public._spy_resolve(text) from public;

-- ── Проверка ────────────────────────────────────────────────
-- Успешная операция начисляет XP всем уцелевшим агентам; на порогах 100/300/600/
-- 1000 XP растёт уровень (бонус успех/скрытность и перк); на 5-м — второй перк.
-- spy_train('["<id>"]') отправляет агента на 2 хода обучаться (−120 ГС/агента),
-- по возвращении +60 XP без риска. spy_launch и _spy_resolve — надмножество всех
-- операций (новые + тайные секты) с бонусом уровней.
