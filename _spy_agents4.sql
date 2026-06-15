-- ============================================================
-- ШПИОНАЖ · ЭТАП 4: КОНТРРАЗВЕДКА (перк Куратора) + МИНИ-ИГРА РАССЛЕДОВАНИЯ
-- Применять в Supabase → SQL Editor ПОСЛЕ _durations_fix.sql. Идемпотентно.
--
-- 1) Перк 🛡 Куратор (handler) теперь пассивно усиливает контрразведку: каждый
--    готовый Куратор +1 к силе КР сверх зарезервированных counter_agents.
-- 2) Мини-игра улик: незаметную операцию против тебя можно РАССЛЕДОВАТЬ — тратишь
--    ГС, контрразведка (с Кураторами) копит улики; по мере улик открываются
--    подсказки об атакующем; на 100% — он вскрыт (casus belli, отношения−, новость).
-- ============================================================

alter table public.spy_missions add column if not exists evidence int default 0;

-- ── Сила контрразведки = резерв + готовые Кураторы ──────────
create or replace function public._spy_ci_power(p_fid text)
returns int language sql stable security definer set search_path=public as $$
  select coalesce((select counter_agents from public.faction_economy where faction_id=p_fid),0)
       + coalesce((select count(*)::int from public.spy_agents
                   where faction_id=p_fid and perk='handler' and ready_at<=now()),0)
$$;
revoke all on function public._spy_ci_power(text) from public;
grant execute on function public._spy_ci_power(text) to authenticated;

-- ── spy_launch: контрразведка цели = _spy_ci_power (учёт Кураторов) ──
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
  ci := public._spy_ci_power(p_target_fid);             -- ◄ КР цели с учётом Кураторов
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

-- ── Расследование: тратим ГС, КР копит улики, на 100% вскрываем атакующего ──
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

  ci := public._spy_ci_power(fid);
  gain := greatest(5, round((10 + ci*6) * (0.6 + random()*0.8)));   -- больше КР/Кураторов → быстрее
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

-- ── spy_incoming: + улики и подсказки (без actor_fid до 100%) ──
-- (DROP обязателен: изменился набор возвращаемых колонок RETURNS TABLE)
drop function if exists public.spy_incoming();
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
         or (m.outcome = 'success' and m.op in ('steal_gc','sabotage','destabilize','steal_tech')))
  order by m.created_at desc
  limit 30;
$$;
revoke all on function public.spy_incoming() from public;
grant execute on function public.spy_incoming() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- Куратор в ростере усиливает КР. Незаметную атаку можно «Расследовать»
-- (150 ГС/попытка): копятся улики и подсказки, на 100% атакующий вскрыт.
