-- ============================================================
-- ШПИОНАЖ · ЭТАП 4b: КОНТРРАЗВЕДКА ПО ОБЪЕКТАМ (Центр + конкретные колонии)
-- Применять в Supabase → SQL Editor ПОСЛЕ _spy_agents4.sql. Идемпотентно.
--
-- Раньше контрразведка была одним общегосударственным числом. Теперь агенты КР
-- РАСПРЕДЕЛЯЮТСЯ по областям (counter_map jsonb {scope: n}):
--   'hq'        — Центр: защищает казну/технологии/дестабилизацию (операции уровня государства);
--   <colony_id> — колония: защищает её от САБОТАЖА по ней.
-- Сила КР области = агенты в области + готовые Кураторы (перк, усиливает везде).
-- counter_agents = сумма по карте (для учёта занятых агентов).
-- ============================================================

alter table public.faction_economy add column if not exists counter_map jsonb default '{}'::jsonb;

-- миграция старого общего counter_agents → в Центр ('hq')
update public.faction_economy
  set counter_map = jsonb_build_object('hq', counter_agents)
  where coalesce(counter_agents,0) > 0
    and (counter_map is null or counter_map = '{}'::jsonb);

-- ── Сила КР конкретной области (+ Кураторы) ─────────────────
create or replace function public._spy_ci_power(p_fid text, p_scope text)
returns int language sql stable security definer set search_path=public as $$
  select coalesce((select (counter_map->>p_scope)::int from public.faction_economy where faction_id=p_fid),0)
       + coalesce((select count(*)::int from public.spy_agents
                   where faction_id=p_fid and perk='handler' and ready_at<=now()),0)
$$;
revoke all on function public._spy_ci_power(text,text) from public;
grant execute on function public._spy_ci_power(text,text) to authenticated;

-- ── Назначить КР на область (Центр 'hq' или колония) ────────
drop function if exists public.counterintel_set(int);
create or replace function public.counterintel_set(p_scope text, p_n int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_avail int; v_other int; n int; cur_map jsonb; total int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  perform 1 from public.faction_economy where faction_id=fid for update;
  -- область-колония должна принадлежать мне (или 'hq')
  if p_scope <> 'hq' and not exists(select 1 from public.colonies where id=p_scope::uuid and faction_id=fid) then
    raise exception 'bad scope';
  end if;
  -- доступные обученные, не занятые операциями
  select count(*) into v_avail from public.spy_agents ag
    where ag.faction_id=fid and ag.ready_at<=now()
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

-- ── spy_launch: КР цели по ОБЛАСТИ операции ─────────────────
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
  -- КР цели по области: саботаж по колонии → её КР; иначе государственный Центр
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

-- ── spy_investigate: КР области инцидента ведёт расследование ──
create or replace function public.spy_investigate(p_mission_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; m public.spy_missions; ci int; gain int; ev int; revealed boolean := false;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into m from public.spy_missions where id=p_mission_id and target_fid=fid and status='done';
  if not found then raise exception 'incident not found'; end if;
  if m.op not in ('steal_gc','sabotage','destabilize','steal_tech') or m.outcome <> 'success' then
    raise exception 'nothing to investigate'; end if;
  if m.detected or coalesce(m.evidence,0) >= 100 then raise exception 'already unmasked'; end if;

  update public.faction_economy set gc = gc - 150 where faction_id=fid and gc >= 150;
  if not found then raise exception 'not enough GC (need 150)'; end if;

  ci := public._spy_ci_power(fid, coalesce(m.target_colony::text, 'hq'));
  gain := greatest(5, round((10 + ci*6) * (0.6 + random()*0.8)));
  ev := least(100, coalesce(m.evidence,0) + gain);

  if ev >= 100 then
    revealed := true;
    update public.spy_missions set evidence=100, detected=true where id=m.id;
    insert into public.faction_relations(from_fid,to_fid,score,updated_at)
      values(fid, m.actor_fid, -15, now())
      on conflict (from_fid,to_fid) do update set score=greatest(-100, public.faction_relations.score-15), updated_at=now();
    insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
        title, excerpt, body, status, published_at, created_at, updated_at)
      values(fid, '🕵 КОНТРРАЗВЕДКА', 'rgba(90,140,200,0.55)', null, null,
        'Шпион вычислен', null,
        format('Контрразведка «%s» установила: за тайной операцией стоит фракция «%s».',
          public._fac_name(fid), public._fac_name(m.actor_fid)),
        'approved', now(), now(), now());
  else
    update public.spy_missions set evidence=ev where id=m.id;
  end if;

  return jsonb_build_object('ok',true,'evidence',ev,'revealed',revealed,
    'actor_name', case when revealed then public._fac_name(m.actor_fid) else null end);
end$$;
revoke all on function public.spy_investigate(uuid) from public;
grant execute on function public.spy_investigate(uuid) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- counterintel_set('hq',2) → 2 агента на Центр; counterintel_set('<colony_id>',1) →
-- защита колонии от саботажа. Саботаж по колонии резистится её КР, остальное — Центром.
