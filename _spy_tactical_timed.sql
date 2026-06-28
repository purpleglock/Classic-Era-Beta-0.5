-- _spy_tactical_timed.sql — тактические операции ПО ТАЙМЕРУ (а не мгновенно)
-- ════════════════════════════════════════════════════════════════════════
-- РАНЬШЕ: outpost_strike / fleet_sabotage / subspace_hunt исполнялись МГНОВЕННО
--   внутри spy_fleet_op — без отсчёта, без новости, клиент писал «выполнено».
-- ТЕПЕРЬ: это нормальные спецоперации, как steal/sabotage:
--   • spy_fleet_op только ЗАПУСКАЕТ операцию (кладёт active-миссию с ready_at в будущем),
--     агенты уходят на 1–2 хода, на клиенте виден таймер;
--   • эффект применяется в _spy_resolve в момент завершения (тот же тик, что и у обычных);
--   • при успехе физических диверсий в общую ленту падает СЕКТОРНЫЙ СЛУХ,
--     а жертва видит входящее событие (spy_incoming).
--
-- ПРИМЕНЯТЬ ПОСЛЕ: _spy_outpost_strike.sql (был источником spy_fleet_op + _spy_op_meta),
--   _spy_agents8.sql (база _spy_resolve), _spy_race_infiltration.sql (формула succ/det),
--   _spy_investigation.sql (база spy_incoming).
-- Идемпотентно: только create or replace.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. spy_fleet_op → ЛАУНЧЕР тактической операции (без мгновенного эффекта) ──
-- Сигнатура сохранена: (target_fid, op, agent_ids, fleet_id). Возвращает turns.
create or replace function public.spy_fleet_op(
    p_target_fid text, p_op text, p_agent_ids jsonb,
    p_fleet_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; tgt public.faction_economy;
  meta jsonb; v_ids uuid[]; a int; v_avail int; tgt_owner uuid;
  diff numeric; ci int; spow numeric; succ int; det int; turns int;
  succ_b int; det_b int; trace text; race_pen numeric; race_mod numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  meta := public._spy_op_meta(p_op);
  if meta is null or not (meta ? 'tactical') then raise exception 'bad op'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_target_fid = app.faction_id then raise exception 'self'; end if;
  if p_op = 'fleet_sabotage' and p_fleet_id is null then raise exception 'pick a target fleet'; end if;

  select * into me  from public.faction_economy where faction_id=app.faction_id for update;
  select * into tgt from public.faction_economy where faction_id=p_target_fid;
  if not found then raise exception 'target has no economy'; end if;
  select owner_id into tgt_owner from public.faction_economy where faction_id=p_target_fid;

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

  -- перк-бонусы (saboteur помогает диверсиям)
  select coalesce(sum(case
      when ag.perk='saboteur' and p_op in ('fleet_sabotage','outpost_strike') then 12
      else 0 end),0),
    coalesce(sum(case when ag.perk='ghost' then 10 else 0 end),0)
    into succ_b, det_b
    from public.spy_agents ag where ag.id = any(v_ids);

  -- вживание по расе (зеркало spy_launch / клиентского ecSpyCalc)
  select race into trace from public.faction_applications
    where faction_id=p_target_fid and status='approved' order by updated_at desc limit 1;
  if trace is null then
    select race into trace from public.faction_applications
      where faction_id=p_target_fid order by updated_at desc limit 1;
  end if;
  select coalesce(avg(public._spy_race_penalty(ag.race, trace)),0) into race_pen
    from public.spy_agents ag where ag.id = any(v_ids);
  race_mod := round(race_pen);

  diff  := (meta->>'diff')::numeric;
  ci    := public._spy_ci_power(p_target_fid, 'hq');
  spow  := public._spy_power(app.faction_id);
  succ  := greatest(5, least(95, round(45 + a*8 + spow - diff - ci*9 + succ_b - race_mod)));
  det   := greatest(2, least(90, round(8 + diff*0.5 + ci*12 + a*2 + public._spy_power(p_target_fid) - spow - det_b)));
  turns := greatest(1, least(2, ceil((meta->>'base')::numeric / sqrt(a))));

  -- кладём как ОБЫЧНУЮ active-миссию: тик/_spy_resolve доведёт её до конца
  insert into public.spy_missions(actor_fid,actor_owner,target_fid,target_owner,target_name,op,mtype,agents,
      agent_ids, success_pct,detect_pct,status,started_at,ready_at,params)
    values(app.faction_id, auth.uid(), p_target_fid, tgt_owner, public._fac_name(p_target_fid), p_op, p_op, a,
      (select jsonb_agg(x::text) from unnest(v_ids) x),
      succ, det, 'active', now(), coalesce(me.last_tick, now()) + (turns || ' days')::interval,
      jsonb_build_object('fleet_id', p_fleet_id));
  return jsonb_build_object('ok',true,'success_pct',succ,'detect_pct',det,'turns',turns,'agents',a,'race_mod',race_mod);
end$$;
revoke all on function public.spy_fleet_op(text,text,jsonb,uuid) from public;
grant execute on function public.spy_fleet_op(text,text,jsonb,uuid) to authenticated;

-- ── 2. _spy_resolve: + ветки тактических операций (применяются при завершении) ──
-- База: _spy_agents8.sql (полностью воспроизведена) + 3 elsif-ветки.
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
  -- тактические:
  v_crit boolean; v_op_id uuid; v_op_sys text; v_op_name text; v_sys_name text; v_ship_killed int;
  v_fleet_id uuid; fl public.fleets; comp jsonb; elem jsonb; new_comp jsonb; q int; lost int; total_lost int;
  v_revealed int; mz record;
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

      -- ════ ТАКТИЧЕСКИЕ: применяются здесь, при завершении по таймеру ════
      elsif m.op='outpost_strike' then
        -- досчитываем перелёты/развёртывания носителей цели, затем бьём
        perform public._outpost_ship_settle(m.target_fid);
        select o.id, o.system_id, o.name into v_op_id, v_op_sys, v_op_name
          from public.outposts o where o.faction_id=m.target_fid
          order by random() limit 1 for update;
        if v_op_id is null then
          ok := false; res := jsonb_build_object('note','no deployed outposts to strike');
        else
          delete from public.outposts where id=v_op_id;
          v_ship_killed := 0;
          v_crit := (random()*100) < m.success_pct*0.5;   -- крит добивает носитель
          if v_crit then
            delete from public.outpost_ships
              where faction_id=m.target_fid and status in ('idle','building')
                and (system_id=v_op_sys or dest_sys=v_op_sys);
            get diagnostics v_ship_killed = row_count;
          end if;
          res := jsonb_build_object('outpost',v_op_name,'system',v_op_sys,
                                    'carrier_killed',v_ship_killed,'crit',v_crit);
          -- секторный слух
          select name into v_sys_name from public.map_systems where id=v_op_sys;
          insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
              title, excerpt, body, status, published_at, created_at, updated_at)
            values(null, '⚠ СЕКТОРНЫЕ СЛУХИ', 'rgba(150,160,180,0.55)', null, null,
              'Взрыв на аванпосте в районе ' || coalesce(v_sys_name,'окраины'), null,
              format('Очевидцы сообщают: аванпост «%s» фракции %s в системе %s взлетел на воздух. Диверсанты сработали чисто — свидетелей не осталось.',
                coalesce(v_op_name,'без названия'), public._fac_name(m.target_fid), coalesce(v_sys_name,'неизвестной')),
              'approved', now(), now(), now());
          delete from public.faction_news
            where owner_id is null and faction_name='⚠ СЕКТОРНЫЕ СЛУХИ'
              and id not in (select id from public.faction_news
                where owner_id is null and faction_name='⚠ СЕКТОРНЫЕ СЛУХИ'
                order by created_at desc limit 15);
        end if;

      elsif m.op='fleet_sabotage' then
        v_fleet_id := (m.params->>'fleet_id')::uuid;
        perform public._fleet_settle(m.target_fid);
        select * into fl from public.fleets where id=v_fleet_id and faction_id=m.target_fid for update;
        if not found then
          ok := false; res := jsonb_build_object('note','target fleet no longer exists');
        else
          v_crit := (random()*100) < m.success_pct*0.5;
          if v_crit then
            comp := coalesce(fl.composition,'[]'::jsonb); new_comp := '[]'::jsonb; total_lost := 0;
            for elem in select value from jsonb_array_elements(comp) loop
              q := greatest(0, coalesce((elem->>'qty')::int,0));
              if q <= 0 then continue; end if;
              lost := least(q, greatest(1, floor(q * (0.25 + random()*0.15))::int));
              total_lost := total_lost + lost;
              if q - lost > 0 then
                new_comp := new_comp || jsonb_build_array(jsonb_set(elem, '{qty}', to_jsonb(q - lost)));
              end if;
            end loop;
            if jsonb_array_length(new_comp) = 0 then
              delete from public.fleets where id=fl.id;
              res := jsonb_build_object('ships_lost',total_lost,'crit',true,'wrecked',true);
            else
              update public.fleets set composition=new_comp,
                  stalled_until = greatest(coalesce(stalled_until, now()), now()) + interval '12 hours'
                where id=fl.id;
              res := jsonb_build_object('ships_lost',total_lost,'crit',true);
            end if;
          else
            update public.fleets set stalled_until = greatest(coalesce(stalled_until, now()), now()) + interval '1 day'
              where id=fl.id;
            res := jsonb_build_object('stalled_hours',24);
          end if;
          -- секторный слух
          insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
              title, excerpt, body, status, published_at, created_at, updated_at)
            values(null, '⚠ СЕКТОРНЫЕ СЛУХИ', 'rgba(150,160,180,0.55)', null, null,
              'Диверсия против флота ' || public._fac_name(m.target_fid), null,
              format('По неподтверждённым данным, одно из соединений %s выведено из строя. Поговаривают о саботаже двигателей и сорванных гиперпрыжках.',
                public._fac_name(m.target_fid)),
              'approved', now(), now(), now());
          delete from public.faction_news
            where owner_id is null and faction_name='⚠ СЕКТОРНЫЕ СЛУХИ'
              and id not in (select id from public.faction_news
                where owner_id is null and faction_name='⚠ СЕКТОРНЫЕ СЛУХИ'
                order by created_at desc limit 15);
        end if;

      elsif m.op='subspace_hunt' then
        -- чистая разведка: вскрываем скрытые гиперкрейсера, без публичного шума
        v_revealed := 0;
        v_crit := (random()*100) < m.success_pct*0.5;
        for mz in select id from public.mza_ships where faction_id=m.target_fid and status in ('idle','transit') loop
          insert into public.mza_reveals(mza_id, hunter_fid, revealed_until)
            values(mz.id, m.actor_fid, now() + (case when v_crit then 4 else 2 end || ' days')::interval);
          v_revealed := v_revealed + 1;
        end loop;
        res := jsonb_build_object('revealed', v_revealed, 'crit', v_crit);
        if v_revealed = 0 then res := res || jsonb_build_object('note','no hidden cruisers found'); end if;
      end if;

      -- дроп артефакта за успешную боевую операцию (12%)
      if ok and m.op not in ('recon_basic','recon_deep','train','subspace_hunt') and random() < 0.12 then
        v_art_kind := arts[1 + floor(random()*array_length(arts,1))::int];
        insert into public.spy_artifacts(faction_id, kind) values(m.actor_fid, v_art_kind);
        res := res || jsonb_build_object('artifact', v_art_kind);
      end if;
    end if;

    -- пойманный агент → плен
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

    -- опыт уцелевшим агентам
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
    perform public._post_covert_rumor(m.op, m.target_fid);   -- для тактических вернётся сразу (guard)
  end loop;
end$$;
revoke all on function public._spy_resolve(text) from public;

-- ── 3. spy_incoming: жертва видит и тактические диверсии (база _spy_investigation.sql) ──
create or replace function public.spy_incoming()
returns table(
  id uuid, op text, outcome text, detected boolean,
  actor_name text, result jsonb, evidence int, hint text,
  has_case boolean, case_verdict text, case_confidence int,
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
    null::text,
    (not m.detected
        and m.outcome='success'
        -- следственное «дело» — только для классических операций (у тактических его нет)
        and m.op in ('steal_gc','steal_res','sabotage','mass_demolish','destabilize','steal_tech','kill_agent','faith_impose')
        and coalesce(m.case_state->>'verdict','') not in ('wrong','solved')
        and (m.case_state is null or public._spy_case_trail(m, m.case_state) > 0)) as has_case,
    case when coalesce(m.case_state->>'verdict','') <> '' then m.case_state->>'verdict'
         when m.case_state is not null and public._spy_case_trail(m, m.case_state) <= 0 then 'cold'
         else null end,
    case when m.case_state is not null
         then (public._spy_case_view(m, me.faction_id)->>'confidence')::int else null end,
    m.created_at, m.ready_at
  from public.spy_missions m, me
  where m.target_fid = me.faction_id
    and m.status = 'done'
    and (m.detected = true
         or (m.outcome = 'success'
             and m.op in ('steal_gc','steal_res','sabotage','mass_demolish','destabilize','steal_tech','kill_agent','faith_impose',
                          'outpost_strike','fleet_sabotage')))
  order by m.created_at desc
  limit 30;
$$;
revoke all on function public.spy_incoming() from public;
grant execute on function public.spy_incoming() to authenticated;

-- ── ПРОВЕРКА ─────────────────────────────────────────────────────────────
-- spy_fleet_op('<tgt>','outpost_strike','["<agent_id>"]')
--   → возвращает {turns:N}; миссия active, агенты заняты, в кабинете виден таймер;
--   через N ходов _spy_resolve уничтожает аванпост и постит секторный слух.
