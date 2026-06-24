-- ============================================================
-- ШПИОНАЖ · ВЖИВАНИЕ ПО РАСЕ (срез 10)
-- Применять в Supabase → SQL Editor ПОСЛЕ _spy_new_ops.sql и _spy_agents8.sql.
-- Идемпотентно (re-runnable, надмножество spy_launch).
--
-- Идея: в рынке рекрутов теперь появляются агенты РАЗНЫХ рас (не только своей).
-- Чтобы внедриться в чужое общество, агент должен сойти за местного. Чем дальше
-- его «субстрат» от расы цели — тем тяжелее операция:
--   своя раса .............. −5 (бонус: свой среди своих)
--   разные виды 1 субстрата . +8
--   органик ↔ органик ....... +18
--   органик ↔ камень/машина/энергия (и наоборот) ... +32  ← гуманоид в роботах ≈ провал
--   камень/машина/энергия между собой .............. +28
-- Для разведки (recon) штраф вполовину — это наблюдение со стороны, не внедрение.
-- При группе агентов берётся СРЕДНИЙ штраф (выгодно собирать команду нужной расы).
-- ============================================================

-- Класс «субстрата» расы (зеркало JS ecRaceClass):
--   1 органик-позвоночные · 2 органик-экзотика · 3 камень · 4 машины · 5 энергия · 0 неизвестно
create or replace function public._spy_race_class(p_race text)
returns int language sql immutable as $$
  select case p_race
    when 'Гуманоиды' then 1
    when 'Млекопитающие' then 1
    when 'Рептилоиды' then 1
    when 'Авианы (Птицеподобные)' then 1
    when 'Инсектоиды' then 2
    when 'Акватики (Водные)' then 2
    when 'Плантоиды (Растениевидные)' then 2
    when 'Литоиды (Каменные)' then 3
    when 'Синтетики / Киборги' then 4
    when 'Энергетические сущности' then 5
    else 0 end
$$;

-- Штраф к успеху (положительный = тяжелее; отрицательный = бонус «свой среди своих»).
create or replace function public._spy_race_penalty(p_agent_race text, p_target_race text)
returns numeric language sql immutable as $$
  select case
    when p_agent_race is null or p_target_race is null then 0
    when p_agent_race = p_target_race then -5
    else (
      with c as (select public._spy_race_class(p_agent_race) ca,
                        public._spy_race_class(p_target_race) ct)
      select case
        when ca = 0 or ct = 0 then 0
        when ca = ct then 8
        when ca <= 2 and ct <= 2 then 18
        when ca <= 2 or ct <= 2 then 32
        else 28
      end from c)
  end
$$;
revoke all on function public._spy_race_class(text) from public;
revoke all on function public._spy_race_penalty(text,text) from public;

-- ── spy_launch с расовым модификатором ──────────────────────
-- Надмножество _spy_new_ops.sql: добавлены trace / race_pen / race_mod.
create or replace function public.spy_launch(p_target_fid text, p_op text, p_agent_ids jsonb, p_colony_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; tgt public.faction_economy;
  meta jsonb; intel jsonb; diff numeric; need text; rec text;
  a int; ci int; ibonus numeric; spow numeric; succ int; det int; turns int;
  tgt_owner uuid; v_ids uuid[]; v_avail int; succ_b int; det_b int; v_colony uuid;
  trace text; race_pen numeric; race_mod numeric;
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

  if p_op in ('sabotage','mass_demolish') and p_colony_id is not null
     and exists(select 1 from public.colonies where id=p_colony_id and faction_id=p_target_fid) then
    v_colony := p_colony_id;
  end if;

  select coalesce(sum(case
    when ag.perk='infiltrator' and p_op in ('steal_gc','steal_tech','steal_res') then 12
    when ag.perk='saboteur'    and p_op in ('sabotage','destabilize','mass_demolish') then 12
    when ag.perk='analyst'     and p_op in ('recon_basic','recon_deep') then 10
    when ag.perk='ghost'       and p_op = 'kill_agent' then 8
    else 0 end),0),
  coalesce(sum(case when ag.perk='ghost' then 10 else 0 end),0)
    into succ_b, det_b
    from public.spy_agents ag where ag.id = any(v_ids);

  -- ── Вживание по расе: средний штраф выбранных агентов против расы цели ──
  select race into trace from public.faction_applications
    where faction_id=p_target_fid and status='approved' order by updated_at desc limit 1;
  if trace is null then
    select race into trace from public.faction_applications
      where faction_id=p_target_fid order by updated_at desc limit 1;
  end if;
  select coalesce(avg(public._spy_race_penalty(ag.race, trace)),0) into race_pen
    from public.spy_agents ag where ag.id = any(v_ids);
  race_mod := round(race_pen * (case when meta ? 'recon' then 0.5 else 1 end));

  diff := (meta->>'diff')::numeric;
  if p_op in ('sabotage','mass_demolish') and v_colony is not null then
    ci := public._spy_ci_power(p_target_fid, v_colony::text);
  else
    ci := public._spy_ci_power(p_target_fid, 'hq');
  end if;
  ibonus := case when meta ? 'recon' then 0
                 else greatest(0, (case when rec='deep' then 20 else 10 end) - coalesce((intel->>'age')::numeric,9999)) end;
  spow := public._spy_power(app.faction_id);
  succ := greatest(5,  least(95, round(45 + a*8 + ibonus + spow - diff - ci*9 + succ_b - race_mod)));
  det  := greatest(2,  least(90, round(8 + diff*0.5 + ci*12 + a*2 + public._spy_power(p_target_fid) - spow - det_b)));
  turns := greatest(1, least(2, ceil((meta->>'base')::numeric / sqrt(a))));

  insert into public.spy_missions(actor_fid,actor_owner,target_fid,target_owner,target_name,op,mtype,agents,
      agent_ids, target_colony, success_pct,detect_pct,status,started_at,ready_at,params)
    values(app.faction_id, auth.uid(), p_target_fid, tgt_owner, public._fac_name(p_target_fid), p_op, p_op, a,
      (select jsonb_agg(x::text) from unnest(v_ids) x), v_colony,
      succ, det, 'active', now(), coalesce(me.last_tick, now()) + (turns || ' days')::interval, '{}'::jsonb);
  return jsonb_build_object('ok',true,'success_pct',succ,'detect_pct',det,'turns',turns,'agents',a,'race_mod',race_mod);
end$$;
revoke all on function public.spy_launch(text,text,jsonb,uuid) from public;
grant execute on function public.spy_launch(text,text,jsonb,uuid) to authenticated;
