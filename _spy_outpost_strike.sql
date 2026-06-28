-- _spy_outpost_strike.sql — ТАЙНАЯ ОПЕРАЦИЯ: уничтожение аванпоста
-- ════════════════════════════════════════════════════════════════════════
-- Несложная тактическая операция (мгновенная, как subspace_hunt/fleet_sabotage):
--   outpost_strike — диверсанты подрывают развёрнутый аванпост цели.
--     успех        → уничтожает 1 случайный стационарный аванпост (outposts);
--     крит         → дополнительно уничтожает строящийся/idle корабль-носитель
--                     (outpost_ships) в той же системе, не дав развернуть второй;
--     сопротивление → роль ВС цели (как у диверсии против флота).
--
-- ПРИМЕНЯТЬ ПОСЛЕ: _spy_fleet_ops.sql (надмножество _spy_op_meta + spy_fleet_op)
--           и ПОСЛЕ: _defense_outpost.sql (таблицы outposts / outpost_ships).
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Каталог операций: + outpost_strike (тактическая) ──────────────────
create or replace function public._spy_op_meta(p_op text)
returns jsonb language sql immutable as $$
  select case p_op
    when 'recon_basic'    then '{"diff":0,"base":1,"need":"","recon":"basic"}'::jsonb
    when 'recon_deep'     then '{"diff":15,"base":2,"need":"","recon":"deep"}'::jsonb
    when 'steal_gc'       then '{"diff":25,"base":2,"need":"basic"}'::jsonb
    when 'steal_res'      then '{"diff":28,"base":2,"need":"basic"}'::jsonb
    when 'sabotage'       then '{"diff":30,"base":2,"need":"deep"}'::jsonb
    when 'destabilize'    then '{"diff":35,"base":3,"need":"basic"}'::jsonb
    when 'kill_agent'     then '{"diff":38,"base":2,"need":"basic"}'::jsonb
    when 'steal_tech'     then '{"diff":45,"base":4,"need":"deep"}'::jsonb
    when 'mass_demolish'  then '{"diff":45,"base":3,"need":"deep"}'::jsonb
    when 'faith_impose'   then '{"diff":28,"base":3,"need":"basic"}'::jsonb
    -- тактический слой: need='' — разведка не обязательна
    when 'subspace_hunt'  then '{"diff":40,"base":2,"need":"","tactical":true}'::jsonb
    when 'fleet_sabotage' then '{"diff":34,"base":2,"need":"","tactical":true}'::jsonb
    when 'outpost_strike' then '{"diff":32,"base":2,"need":"","tactical":true}'::jsonb
    else null end
$$;

-- ── 2. spy_fleet_op: + ветка outpost_strike ─────────────────────────────
-- Надмножество версии из _spy_fleet_ops.sql: добавлена только новая elsif-ветка.
create or replace function public.spy_fleet_op(
    p_target_fid text, p_op text, p_agent_ids jsonb,
    p_fleet_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy;
  meta jsonb; v_ids uuid[]; a int; v_avail int;
  succ_b numeric; det_b numeric; diff numeric; ci numeric; spow numeric;
  succ int; det int; ok boolean; crit boolean; caught boolean;
  fl public.fleets; comp jsonb; elem jsonb; new_comp jsonb := '[]'::jsonb;
  q int; lost int; total_lost int := 0; v_revealed int := 0; mz record;
  outcome text; res jsonb;
  v_op_id uuid; v_op_sys text; v_op_name text; v_ship_killed int := 0;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  meta := public._spy_op_meta(p_op);
  if meta is null or not (meta ? 'tactical') then raise exception 'bad op'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_target_fid = app.faction_id then raise exception 'self'; end if;
  select * into me from public.faction_economy where faction_id=app.faction_id for update;

  -- доступные выбранные агенты (готовы, не пленники, не на задании, не в контрразведке)
  select array_agg(ag.id) into v_ids
  from public.spy_agents ag
  where ag.faction_id=app.faction_id and coalesce(ag.captive,false)=false
    and ag.id in (select (jsonb_array_elements_text(coalesce(p_agent_ids,'[]'::jsonb)))::uuid)
    and ag.ready_at <= now()
    and not exists(select 1 from public.spy_missions sm where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text)
    and not exists(select 1 from public.faction_counterintel ci where ci.faction_id=app.faction_id and ci.agent_id=ag.id);
  a := coalesce(array_length(v_ids,1),0);
  if a < 1 then raise exception 'select at least one available agent'; end if;

  -- резерв контрразведки
  select count(*) into v_avail from public.spy_agents ag
  where ag.faction_id=app.faction_id and ag.ready_at<=now() and coalesce(ag.captive,false)=false
    and not exists(select 1 from public.spy_missions sm where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text);
  if a > v_avail - coalesce(me.counter_agents,0) then raise exception 'agents reserved for counterintel'; end if;

  -- база успеха/обнаружения от навыков выбранных агентов
  select coalesce(sum(public._spy_perk_succ(ag.perk, p_op, ag.level)
                    + public._spy_perk_succ(ag.perk2, p_op, ag.level)
                    + (greatest(coalesce(ag.level,1),1)-1)*3),0),
         coalesce(sum((case when ag.perk='ghost' or ag.perk2='ghost'
                       then 10 + (greatest(coalesce(ag.level,1),1)-1)*2 else 0 end)
                    + (greatest(coalesce(ag.level,1),1)-1)*2),0)
    into succ_b, det_b
    from public.spy_agents ag where ag.id = any(v_ids);

  diff := (meta->>'diff')::numeric;
  ci   := public._fci_role_power(p_target_fid, 'forces');
  spow := public._spy_power(app.faction_id);
  succ := greatest(5, least(95, round(45 + a*8 + spow - diff - ci*5 + succ_b)));
  det  := greatest(2, least(90, round(10 + diff*0.5 + ci*7 + a*2 + public._spy_power(p_target_fid) - spow - det_b)));

  ok     := (random()*100) < succ;
  crit   := ok and ((random()*100) < succ*0.5);
  caught := (random()*100) < det;
  res := '{}'::jsonb;

  if p_op = 'subspace_hunt' then
    if ok then
      for mz in select id from public.mza_ships where faction_id=p_target_fid and status in ('idle','transit') loop
        insert into public.mza_reveals(mza_id, hunter_fid, revealed_until)
          values(mz.id, app.faction_id, now() + (case when crit then 4 else 2 end || ' days')::interval);
        v_revealed := v_revealed + 1;
      end loop;
      outcome := case when v_revealed>0 then 'success' else 'empty' end;
      res := jsonb_build_object('revealed', v_revealed, 'crit', crit);
    else
      outcome := 'fail';
    end if;

  elsif p_op = 'fleet_sabotage' then
    if p_fleet_id is null then raise exception 'pick a target fleet'; end if;
    perform public._fleet_settle(p_target_fid);
    select * into fl from public.fleets where id=p_fleet_id and faction_id=p_target_fid for update;
    if not found then raise exception 'no such enemy fleet'; end if;
    if ok and crit then
      comp := coalesce(fl.composition,'[]'::jsonb);
      for elem in select value from jsonb_array_elements(comp) loop
        q := greatest(0, coalesce((elem->>'qty')::int,0));
        if q <= 0 then continue; end if;
        lost := greatest(1, floor(q * (0.25 + random()*0.15))::int);
        lost := least(lost, q);
        total_lost := total_lost + lost;
        if q - lost > 0 then
          new_comp := new_comp || jsonb_build_array(jsonb_set(elem, '{qty}', to_jsonb(q - lost)));
        end if;
      end loop;
      if jsonb_array_length(new_comp) = 0 then
        delete from public.fleets where id=fl.id;
        outcome := 'wrecked';
      else
        update public.fleets set composition=new_comp,
            stalled_until = greatest(coalesce(stalled_until, now()), now()) + interval '12 hours'
          where id=fl.id;
        outcome := 'crippled';
      end if;
      res := jsonb_build_object('ships_lost', total_lost, 'crit', true);
    elsif ok then
      update public.fleets set stalled_until = greatest(coalesce(stalled_until, now()), now()) + interval '1 day'
        where id=fl.id;
      outcome := 'stalled';
      res := jsonb_build_object('stalled_hours', 24);
    else
      outcome := 'fail';
    end if;

  elsif p_op = 'outpost_strike' then
    -- сначала досчитываем перелёты/развёртывания носителей цели, затем бьём
    perform public._outpost_ship_settle(p_target_fid);
    select o.id, o.system_id, o.name into v_op_id, v_op_sys, v_op_name
      from public.outposts o where o.faction_id=p_target_fid
      order by random() limit 1 for update;
    if v_op_id is null then
      raise exception 'no deployed outposts to strike';
    end if;
    if ok then
      delete from public.outposts where id=v_op_id;
      outcome := 'destroyed';
      -- крит: добиваем корабль-носитель в той же системе (если он там стоит/строится)
      if crit then
        delete from public.outpost_ships
          where faction_id=p_target_fid and status in ('idle','building')
            and (system_id=v_op_sys or dest_sys=v_op_sys);
        get diagnostics v_ship_killed = row_count;
      end if;
      res := jsonb_build_object('outpost', v_op_name, 'system', v_op_sys,
                                'carrier_killed', v_ship_killed, 'crit', crit);
    else
      outcome := 'fail';
      res := jsonb_build_object('system', v_op_sys);
    end if;
  end if;

  -- журнал/след завершённой операции
  insert into public.spy_missions(actor_fid,actor_owner,target_fid,target_owner,target_name,op,mtype,agents,
      agent_ids, success_pct,detect_pct,status,outcome,started_at,ready_at,params)
    values(app.faction_id, auth.uid(), p_target_fid,
      (select owner_id from public.faction_economy where faction_id=p_target_fid),
      public._fac_name(p_target_fid), p_op, p_op, a,
      (select jsonb_agg(x::text) from unnest(v_ids) x),
      succ, det, 'done', outcome, now(), now(),
      jsonb_build_object('caught', caught) || res);

  return jsonb_build_object('ok',true,'op',p_op,'success_pct',succ,'detect_pct',det,
    'outcome',outcome,'caught',caught) || res;
end$$;
revoke all on function public.spy_fleet_op(text,text,jsonb,uuid) from public;
grant execute on function public.spy_fleet_op(text,text,jsonb,uuid) to authenticated;

-- ── ПРОВЕРКА ─────────────────────────────────────────────────────────────
-- разведка не нужна: spy_fleet_op('<tgt>','outpost_strike','["<agent_id>"]')
--   → уничтожает 1 аванпост цели; крит добивает корабль-носитель в той же системе.
