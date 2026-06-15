-- ============================================================
-- ФИКС ДЛИТЕЛЬНОСТЕЙ: всё в коротких ЦИКЛАХ (1 тик = 1 день), не «неделях»
-- Применять в Supabase → SQL Editor ПОСЛЕ _spy_agents3.sql. Идемпотентно.
--
-- Было: обучение 2 цикла, операции до 5–6 циклов (≈неделя), время в пути до ~4.
-- Стало: обучение 1 цикл; операции 1–2 цикла; караван в пути 1–2 цикла.
-- Рынок рекрутов оставлен еженедельным (это каденс появления новых, не блокирует).
-- ============================================================

-- ── Обучение агента: 1 цикл ─────────────────────────────────
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
  select count(*) into have from public.spy_agents where faction_id=fid;
  if have >= cap then raise exception 'agent cap reached (% / %)', have, cap; end if;
  update public.faction_economy set gc = gc - rc.cost where faction_id=fid and gc >= rc.cost;
  if not found then raise exception 'not enough GC'; end if;
  insert into public.spy_agents(faction_id, owner_id, first_name, last_name, perk, ready_at)
    values(fid, auth.uid(), rc.first_name, rc.last_name, rc.perk, now() + interval '1 day');
  delete from public.spy_recruits where id=p_recruit_id;
  return jsonb_build_object('ok',true,'agent',rc.first_name||' '||rc.last_name,'perk',rc.perk,'cost',rc.cost,'training_turns',1);
end$$;
revoke all on function public.spy_hire(uuid) from public;
grant execute on function public.spy_hire(uuid) to authenticated;

-- ── Операции: 1–2 цикла (без множителя сложности на срок) ───
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
  ci := coalesce(tgt.counter_agents,0);
  ibonus := case when meta ? 'recon' then 0
                 else greatest(0, (case when rec='deep' then 20 else 10 end) - coalesce((intel->>'age')::numeric,9999)) end;
  spow := public._spy_power(app.faction_id);
  succ := greatest(5,  least(95, round(45 + a*8 + ibonus + spow - diff - ci*9 + succ_b)));
  det  := greatest(2,  least(90, round(8 + diff*0.5 + ci*12 + a*2 + public._spy_power(p_target_fid) - spow - det_b)));
  turns := greatest(1, least(2, ceil((meta->>'base')::numeric / sqrt(a))));   -- 1–2 цикла

  insert into public.spy_missions(actor_fid,actor_owner,target_fid,target_owner,target_name,op,mtype,agents,
      agent_ids, target_colony, success_pct,detect_pct,status,started_at,ready_at,params)
    values(app.faction_id, auth.uid(), p_target_fid, tgt_owner, public._fac_name(p_target_fid), p_op, p_op, a,
      (select jsonb_agg(x::text) from unnest(v_ids) x), v_colony,
      succ, det, 'active', now(), coalesce(me.last_tick, now()) + (turns || ' days')::interval, '{}'::jsonb);
  return jsonb_build_object('ok',true,'success_pct',succ,'detect_pct',det,'turns',turns,'agents',a);
end$$;
revoke all on function public.spy_launch(text,text,jsonb,uuid) from public;
grant execute on function public.spy_launch(text,text,jsonb,uuid) to authenticated;

-- ── Караван в пути: 1–2 цикла ───────────────────────────────
create or replace function public.trade_respond(p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; r public.trade_routes; cap int; used int;
  v_speed int; v_adj boolean; v_turns int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into r from public.trade_routes where id=p_id;
  if not found then raise exception 'route not found'; end if;
  if r.b_fid <> app.faction_id then raise exception 'not your route'; end if;
  if r.status <> 'pending' then raise exception 'route not pending'; end if;
  if not p_accept then
    update public.trade_routes set status='declined' where id=p_id;
    return jsonb_build_object('ok',true,'status','declined');
  end if;
  select coalesce(sum(slots_open),0) into cap from public.colony_buildings where faction_id=app.faction_id and btype='trade';
  select count(*) into used from public.trade_routes where b_fid=app.faction_id and status='active';
  if used >= cap then raise exception 'no free trade hub slots'; end if;

  v_speed := public._fleet_speed(r.a_fid);
  select exists(select 1 from public.map_hyperlanes h
                where (h.a_id=r.origin_sys and h.b_id=r.dest_sys)
                   or (h.a_id=r.dest_sys and h.b_id=r.origin_sys)) into v_adj;
  v_turns := greatest(1, least(2, ceil((case when v_adj then 1 else 2 end) * 20.0 / greatest(1, v_speed))));  -- 1–2 цикла

  update public.trade_routes
    set status='active', b_owner=auth.uid(), transit_until = now() + (v_turns || ' days')::interval
    where id=p_id;
  return jsonb_build_object('ok',true,'status','active','transit_turns',v_turns);
end$$;
revoke all on function public.trade_respond(uuid, boolean) from public;
grant execute on function public.trade_respond(uuid, boolean) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- Обучение 1 цикл; операции 1–2 цикла; караван в пути 1–2 цикла.
