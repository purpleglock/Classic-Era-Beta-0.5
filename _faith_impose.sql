-- ============================================================
-- ВЕРА (РЕЛИГИЯ) · СЛАЙС 3: ТАЙНАЯ ОПЕРАЦИЯ «НАСАЖДЕНИЕ ВЕРЫ»
-- Применять в Supabase → SQL Editor ПОСЛЕ _faith_spread.sql и всех _spy_agents*.
-- Идемпотентно.
--
-- Ковёртная альтернатива дипломатическому признанию: спиритуалист/теократ тайно
-- насаждает СВОЮ веру в чужой державе. При успехе цель становится 'recognized'
-- (как при добровольном признании) — строит храмы, а основатель веры получает
-- десятину. Цель видит ВХОДЯЩУЮ операцию (исполнитель скрыт, пока не раскрыт).
--
-- Файл пересоздаёт _spy_op_meta / spy_launch / _spy_resolve как надмножества
-- (база: _economy_setup / _spy_agents5 / _spy_agents3). Добавленное помечено «-- ВЕРА-3:».
-- ============================================================

-- ── 1) Каталог операций + новая операция faith_impose ───────
create or replace function public._spy_op_meta(p_op text)
returns jsonb language sql immutable as $$
  select case p_op
    when 'recon_basic'  then '{"diff":0,"base":1,"need":"","recon":"basic"}'::jsonb
    when 'recon_deep'   then '{"diff":15,"base":2,"need":"","recon":"deep"}'::jsonb
    when 'steal_gc'     then '{"diff":25,"base":2,"need":"basic"}'::jsonb
    when 'sabotage'     then '{"diff":30,"base":2,"need":"deep"}'::jsonb
    when 'destabilize'  then '{"diff":35,"base":3,"need":"basic"}'::jsonb
    when 'steal_tech'   then '{"diff":45,"base":4,"need":"deep"}'::jsonb
    when 'faith_impose' then '{"diff":28,"base":3,"need":"basic"}'::jsonb  -- ВЕРА-3: насаждение веры
    else null end
$$;

-- ── 2) spy_launch + precheck для faith_impose ───────────────
-- База: _spy_agents5.sql. Добавлен блок «-- ВЕРА-3:».
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

  -- ВЕРА-3: насаждать можно только СВОЮ веру и только в державу без веры
  if p_op = 'faith_impose' then
    if not exists(select 1 from public.faith_membership where faction_id=app.faction_id) then
      raise exception 'you follow no faith to spread'; end if;
    if exists(select 1 from public.faith_membership where faction_id=p_target_fid) then
      raise exception 'target already follows a faith'; end if;
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
  if p_op = 'steal_tech' and a < 2 then raise exception 'state-level op needs a network: at least 2 agents'; end if;

  select count(*) into v_avail from public.spy_agents ag
  where ag.faction_id=app.faction_id and ag.ready_at<=now()
    and not exists(select 1 from public.spy_missions sm
                   where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text);
  if a > v_avail - coalesce(me.counter_agents,0) then raise exception 'agents reserved for counterintel'; end if;

  intel := public._spy_intel(app.faction_id, p_target_fid);
  need := meta->>'need'; rec := intel->>'level';
  if need = 'basic' and rec is null then raise exception 'intel required: basic recon'; end if;
  if need = 'deep'  and rec is distinct from 'deep' then raise exception 'intel required: deep recon'; end if;

  if p_op = 'sabotage' and p_colony_id is not null
     and exists(select 1 from public.colonies where id=p_colony_id and faction_id=p_target_fid) then
    v_colony := p_colony_id;
  end if;

  select coalesce(sum(case when ag.perk='infiltrator' and p_op in ('steal_gc','steal_tech') then 12
                           when ag.perk='saboteur'    and p_op in ('sabotage','destabilize') then 12
                           when ag.perk='analyst'     and p_op in ('recon_basic','recon_deep') then 10
                           else 0 end),0),
         coalesce(sum(case when ag.perk='ghost' then 10 else 0 end),0)
    into succ_b, det_b
    from public.spy_agents ag where ag.id = any(v_ids);

  diff := (meta->>'diff')::numeric;
  if p_op = 'sabotage' and v_colony is not null then
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

-- ── 3) _spy_resolve + эффект faith_impose ───────────────────
-- База: _spy_agents3.sql. Добавлена ветка «-- ВЕРА-3:».
create or replace function public._spy_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare m public.spy_missions; ok boolean; caught boolean; res jsonb; steal numeric; bid uuid; bt text;
  techs jsonb; node text; tgt public.faction_economy; v_colname text;
  v_faith uuid; v_faith_name text;                  -- ВЕРА-3
begin
  for m in select * from public.spy_missions where actor_fid=p_fid and status='active' and ready_at<=now() loop
    ok := (random()*100) < m.success_pct;
    caught := (random()*100) < m.detect_pct;
    res := '{}'::jsonb;
    select * into tgt from public.faction_economy where faction_id=m.target_fid;

    if ok then
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
      elsif m.op='steal_gc' then
        steal := round(coalesce(tgt.gc,0) * least(0.30, 0.06*m.agents));
        update public.faction_economy set gc=greatest(0,gc-steal) where faction_id=m.target_fid;
        update public.faction_economy set gc=gc+steal where faction_id=m.actor_fid;
        res := jsonb_build_object('gc',steal);
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
      elsif m.op='faith_impose' then               -- ВЕРА-3: насаждение веры
        select fm.faith_id into v_faith from public.faith_membership fm where fm.faction_id=m.actor_fid;
        if v_faith is not null and not exists(select 1 from public.faith_membership where faction_id=m.target_fid) then
          insert into public.faith_membership(faction_id, faith_id, role, owner_id)
            values(m.target_fid, v_faith, 'recognized', tgt.owner_id);
          select name into v_faith_name from public.faiths where id=v_faith;
          res := jsonb_build_object('faith', v_faith_name);
        else
          ok := false; res := jsonb_build_object('note','target already faithful or actor faithless');
        end if;
      end if;
    end if;

    if caught and jsonb_array_length(coalesce(m.agent_ids,'[]'::jsonb)) > 0 then
      delete from public.spy_agents where id = (m.agent_ids->>0)::uuid and faction_id=m.actor_fid;
      res := res || jsonb_build_object('caught',true,'actor_name',public._fac_name(m.actor_fid));
    end if;

    update public.spy_missions
      set status='done', outcome=(case when ok then 'success' else 'fail' end), detected=caught, result=res
      where id=m.id;
    perform public._post_covert_rumor(m.op, m.target_fid);
  end loop;
end$$;
revoke all on function public._spy_resolve(text) from public;

-- ── 4) spy_incoming: показывать жертве успешное насаждение веры ──
-- База: _spy_agents4.sql (сигнатура с evidence/hint — НЕ менять колонки!).
-- В белый список «видно при успехе» добавлен faith_impose, чтобы жертва получила
-- оповещение (и могла отречься во вкладке «Вера»).
create or replace function public.spy_incoming()
returns table(
  id uuid, op text, outcome text, detected boolean,
  actor_name text, result jsonb, evidence int, hint text,
  created_at timestamptz, ready_at timestamptz)
language sql security definer set search_path = public as $$
  with me as (
    select faction_id from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1
  )
  select
    m.id, m.op, m.outcome, m.detected,
    case when m.detected then public._fac_name(m.actor_fid) else null end,
    case when m.detected then m.result else (coalesce(m.result,'{}'::jsonb) - 'actor_name') end,
    coalesce(m.evidence,0),
    case when m.detected then null
         when coalesce(m.evidence,0) >= 67 then 'Фракция из ' || length(public._fac_name(m.actor_fid)) || ' симв., на «' || left(public._fac_name(m.actor_fid),1) || '…»'
         when coalesce(m.evidence,0) >= 34 then 'След ведёт к фракции на «' || left(public._fac_name(m.actor_fid),1) || '…»'
         else null end,
    m.created_at, m.ready_at
  from public.spy_missions m, me
  where m.target_fid = me.faction_id
    and m.status = 'done'
    and (m.detected = true
         or (m.outcome = 'success'
             and m.op in ('steal_gc','sabotage','destabilize','steal_tech','faith_impose')))  -- ВЕРА-3
  order by m.created_at desc
  limit 30;
$$;
revoke all on function public.spy_incoming() from public;
grant execute on function public.spy_incoming() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- 1) разведать цель (recon_basic), 2) spy_launch('<tgt>','faith_impose', '["<agent_id>"]'),
-- 3) после тика: faith_membership цели = 'recognized' вашей веры, идёт десятина.
