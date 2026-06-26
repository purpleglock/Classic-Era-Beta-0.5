-- ════════════════════════════════════════════════════════════════════════
-- _spy_fleet_ops.sql — СПЕЦОПЕРАЦИИ ПРОТИВ ФЛОТА + ИМЕННАЯ КОНТРРАЗВЕДКА
-- ════════════════════════════════════════════════════════════════════════
-- Применять ПОСЛЕ: _spy_agents8.sql, _spy_new_ops.sql, _spy_race_infiltration.sql,
--                  _army_fleet.sql, _fleet_ops.sql, _mza.sql, _fleet_intel.sql.
-- Связано: [[spy-agent-progression]], [[spy-race-infiltration]], [[army-fleet]],
--          [[mza-mobile-doomgun]].
--
-- Что здесь:
--   1) Две тайные операции тактического слоя (МГНОВЕННЫЕ, не турновые):
--      • subspace_hunt  — «Подпространственная охота»: при успехе ВСКРЫВАЕТ
--        чужие гиперкрейсеры (mza_reveals) на 2 суток.
--      • fleet_sabotage — диверсия против вражеского флота. По степени успеха:
--        крит → выводит из строя ЧАСТЬ кораблей состава; обычный успех →
--        ТОРМОЗИТ флот на сутки (stalled_until).
--   2) КОНТРРАЗВЕДКА с ИМЕННЫМ назначением и двумя ролями:
--      • role='state'  — защита государства (контршпионаж кабинета).
--      • role='forces' — защита вооружённых сил (сопротивление диверсиям флота).
--      Ставишь КОНКРЕТНОГО агента в роль, а не «+1 к числу». counter_agents в
--      faction_economy пересчитывается = число назначенных (совместимость со
--      старой проверкой резерва в spy_launch).
--   3) Рынок рекрутов: обновление КАЖДЫЙ ДЕНЬ, заменяя 1–3 рекрута (а не раз в
--      неделю «всех сразу»), и чужие расы выпадают чаще (~45%).
-- ════════════════════════════════════════════════════════════════════════

-- ── 0. Реестр операций: добавляем две тактические ──
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
    -- тактический слой (флот): need='' — разведка не обязательна (флоты видят все)
    when 'subspace_hunt'  then '{"diff":40,"base":2,"need":"","tactical":true}'::jsonb
    when 'fleet_sabotage' then '{"diff":34,"base":2,"need":"","tactical":true}'::jsonb
    else null end
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 1. КОНТРРАЗВЕДКА — именное назначение в две роли
-- ════════════════════════════════════════════════════════════════════════
-- role: 'state' (государство/Центр), 'forces' (ВС/флот) ИЛИ <colony_id> (защита
-- конкретной колонии от саботажа). Свободный text — поэтому без CHECK.
create table if not exists public.faction_counterintel (
  faction_id text not null,
  agent_id   uuid not null references public.spy_agents(id) on delete cascade,
  role       text not null,
  set_at     timestamptz not null default now(),
  primary key (faction_id, agent_id)
);
alter table public.faction_counterintel drop constraint if exists faction_counterintel_role_check;
create index if not exists fci_fac_idx on public.faction_counterintel(faction_id);
alter table public.faction_counterintel enable row level security;
drop policy if exists "fci_sel" on public.faction_counterintel;
create policy "fci_sel" on public.faction_counterintel for select to public using (true);

-- пересчёт сводного числа counter_agents (совместимость со старой проверкой резерва)
create or replace function public._fci_sync(p_fid text)
returns void language sql security definer set search_path=public as $$
  update public.faction_economy
    set counter_agents = (select count(*) from public.faction_counterintel where faction_id=p_fid)
    where faction_id=p_fid;
$$;

-- сила контрразведки роли (для сопротивления операциям): сумма уровней назначенных
create or replace function public._fci_role_power(p_fid text, p_role text)
returns numeric language sql stable as $$
  select coalesce(sum(greatest(1, coalesce(a.level,1))) ,0)
  from public.faction_counterintel ci
  join public.spy_agents a on a.id = ci.agent_id and coalesce(a.captive,false)=false
  where ci.faction_id = p_fid and ci.role = p_role;
$$;

-- Override _spy_ci_power: сила КР области теперь = ИМЕННЫЕ агенты в этой области
-- (faction_counterintel) + готовые Кураторы. spy_launch зовёт _spy_ci_power(target,
-- 'hq'|<colony_id>) — так именная защита Центра/колоний автоматически работает
-- против чужих операций. scope 'hq' маппится на роль 'state'.
create or replace function public._spy_ci_power(p_fid text, p_scope text)
returns int language sql stable security definer set search_path=public as $$
  select public._fci_role_power(p_fid, case when p_scope='hq' then 'state' else p_scope end)::int
       + coalesce((select count(*)::int from public.spy_agents
                   where faction_id=p_fid and perk='handler' and ready_at<=now()),0)
$$;
revoke all on function public._spy_ci_power(text,text) from public;
grant execute on function public._spy_ci_power(text,text) to authenticated;

-- поставить/снять конкретного агента в роль контрразведки
create or replace function public.spy_counter_set(p_agent_id uuid, p_role text, p_on boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if p_on then
    -- роль = государство/ВС ИЛИ моя колония (защита её от саботажа)
    if p_role not in ('state','forces')
       and not exists(select 1 from public.colonies where id=p_role::uuid and faction_id=fid) then
      raise exception 'bad role'; end if;
    -- агент должен быть мой, готовый, не пленник, не на активном задании
    if not exists(select 1 from public.spy_agents a where a.id=p_agent_id and a.faction_id=fid
                  and coalesce(a.captive,false)=false and a.ready_at<=now()) then
      raise exception 'agent unavailable'; end if;
    if exists(select 1 from public.spy_missions sm where sm.actor_fid=fid and sm.status='active'
              and sm.agent_ids ? p_agent_id::text) then
      raise exception 'agent is on a mission'; end if;
    insert into public.faction_counterintel(faction_id, agent_id, role)
      values(fid, p_agent_id, p_role)
      on conflict (faction_id, agent_id) do update set role=excluded.role, set_at=now();
  else
    delete from public.faction_counterintel where faction_id=fid and agent_id=p_agent_id;
  end if;
  perform public._fci_sync(fid);
  return public.spy_counter_list();
end$$;
revoke all on function public.spy_counter_set(uuid,text,boolean) from public;
grant execute on function public.spy_counter_set(uuid,text,boolean) to authenticated;

-- список моих назначений контрразведки
create or replace function public.spy_counter_list()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'state_power',  public._fci_role_power(fid,'state'),
    'forces_power', public._fci_role_power(fid,'forces'),
    'assignments', (select coalesce(jsonb_agg(jsonb_build_object(
        'agent_id', ci.agent_id, 'role', ci.role,
        'first_name', a.first_name, 'last_name', a.last_name,
        'level', coalesce(a.level,1), 'perk', a.perk) order by ci.role, a.last_name), '[]'::jsonb)
      from public.faction_counterintel ci
      join public.spy_agents a on a.id=ci.agent_id
      where ci.faction_id=fid));
end$$;
revoke all on function public.spy_counter_list() from public;
grant execute on function public.spy_counter_list() to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 2. spy_fleet_op — МГНОВЕННАЯ тактическая операция против флота/гиперкрейсера
-- ════════════════════════════════════════════════════════════════════════
-- subspace_hunt:  p_target_fid = чья ПВ-засветка; успех → вскрыть его гиперкрейсеры.
-- fleet_sabotage: p_fleet_id   = конкретный (видимый) вражеский флот.
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

  -- резерв контрразведки (как в spy_launch): нельзя гонять зарезервированных
  select count(*) into v_avail from public.spy_agents ag
  where ag.faction_id=app.faction_id and ag.ready_at<=now() and coalesce(ag.captive,false)=false
    and not exists(select 1 from public.spy_missions sm where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text);
  if a > v_avail - coalesce(me.counter_agents,0) then raise exception 'agents reserved for counterintel'; end if;

  -- база успеха/обнаружения от навыков выбранных агентов (как в spy_launch)
  select coalesce(sum(public._spy_perk_succ(ag.perk, p_op, ag.level)
                    + public._spy_perk_succ(ag.perk2, p_op, ag.level)
                    + (greatest(coalesce(ag.level,1),1)-1)*3),0),
         coalesce(sum((case when ag.perk='ghost' or ag.perk2='ghost'
                       then 10 + (greatest(coalesce(ag.level,1),1)-1)*2 else 0 end)
                    + (greatest(coalesce(ag.level,1),1)-1)*2),0)
    into succ_b, det_b
    from public.spy_agents ag where ag.id = any(v_ids);

  diff := (meta->>'diff')::numeric;
  -- сопротивление целит роль ВС (защита вооружённых сил)
  ci   := public._fci_role_power(p_target_fid, 'forces');
  spow := public._spy_power(app.faction_id);
  succ := greatest(5, least(95, round(45 + a*8 + spow - diff - ci*5 + succ_b)));
  det  := greatest(2, least(90, round(10 + diff*0.5 + ci*7 + a*2 + public._spy_power(p_target_fid) - spow - det_b)));

  ok     := (random()*100) < succ;
  -- крит: успех с хорошим запасом (вторая проверка против половины порога)
  crit   := ok and ((random()*100) < succ*0.5);
  caught := (random()*100) < det;
  res := '{}'::jsonb;

  if p_op = 'subspace_hunt' then
    if ok then
      -- вскрыть ВСЕ скрытые гиперкрейсера цели на 2 суток (крит — на 4 суток)
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
      -- КРИТ: выводим из строя часть кораблей (≈25–40% каждого типа, мин. 1)
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
        -- весь состав уничтожен → распускаем флот
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
      -- обычный успех: тормозим флот на сутки
      update public.fleets set stalled_until = greatest(coalesce(stalled_until, now()), now()) + interval '1 day'
        where id=fl.id;
      outcome := 'stalled';
      res := jsonb_build_object('stalled_hours', 24);
    else
      outcome := 'fail';
    end if;
  end if;

  -- журнал/след: запись завершённой операции (видна в «Журнале», питает alert цели)
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

-- ════════════════════════════════════════════════════════════════════════
-- 3. fleet_send — уважать торможение диверсией (override _fleet_ops.sql)
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.fleet_send(p_id uuid, p_dest_sys text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; fl public.fleets; fly_h numeric; jumps int; fuel jsonb; res jsonb;
  rk text; rneed numeric; rhave numeric; short text := '';
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  select * into fl from public.fleets where id=p_id;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;
  if fl.status <> 'idle' then raise exception 'флот уже в пути'; end if;
  if fl.stalled_until is not null and fl.stalled_until > now() then
    raise exception 'флот обездвижен диверсией ещё % ч', ceil(extract(epoch from (fl.stalled_until-now()))/3600.0);
  end if;
  if not exists(select 1 from public.map_systems where id=p_dest_sys) then raise exception 'no such system'; end if;
  if p_dest_sys = fl.system_id then raise exception 'флот уже там'; end if;

  jumps := public._fleet_jumps(fl.system_id, p_dest_sys);
  fuel  := public._fleet_fuel_for(fl.composition, jumps);

  select coalesce(resources,'{}'::jsonb) into res
    from public.faction_economy where faction_id=fid for update;
  if res is null then raise exception 'нет экономики фракции'; end if;

  for rk, rneed in select key, (value)::numeric from jsonb_each_text(fuel) loop
    if rneed is null or rneed <= 0 then continue; end if;
    rhave := coalesce((res->>rk)::numeric, 0);
    if rhave < rneed then short := short || rk || ' ' || round(rneed - rhave) || ', '; end if;
  end loop;
  if short <> '' then
    raise exception 'не хватает топлива на складе: %', rtrim(short, ', ');
  end if;

  for rk, rneed in select key, (value)::numeric from jsonb_each_text(fuel) loop
    if rneed is null or rneed <= 0 then continue; end if;
    res := jsonb_set(res, array[rk], to_jsonb(coalesce((res->>rk)::numeric,0) - rneed), true);
  end loop;
  update public.faction_economy set resources=res where faction_id=fid;

  fly_h := coalesce(public._fleet_fly_hours(fl.system_id, p_dest_sys), 2.0);
  update public.fleets
    set status='transit', from_sys=system_id, dest_sys=p_dest_sys, system_id=null,
        depart_at=now(), arrive_at=now() + (fly_h || ' hours')::interval
    where id=p_id;
  return jsonb_build_object('ok', true, 'fly_h', round(fly_h,1), 'jumps', jumps, 'fuel', fuel,
    'arrive_at', now() + (fly_h || ' hours')::interval);
end$$;
revoke all on function public.fleet_send(uuid,text) from public;
grant execute on function public.fleet_send(uuid,text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 4. Рынок рекрутов — ЕЖЕДНЕВНОЕ обновление 1–3 шт, чужие расы чаще (override)
-- ════════════════════════════════════════════════════════════════════════
-- Заменяет генерацию из _spy_agents8/_spy_race_infiltration: вместо «раз в неделю
-- всех» — каждый день истекает 1–3 старейших рекрута и подбираются новые.
create or replace function public.spy_recruits_list()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; uid uuid; v_last timestamptz; v_cnt int; i int; n_replace int;
  fn text; ln text; pk text; rc text; gn text; rp text; frace text; nm jsonb; rid uuid;
  perks       text[] := array['infiltrator','saboteur','ghost','analyst','handler'];
  repls       text[] := array['Оригинал','Оригинал','Оригинал','Клон','Репликант'];
  all_races   text[] := array['Гуманоиды','Млекопитающие','Рептилоиды','Авианы (Птицеподобные)',
                              'Инсектоиды','Акватики (Водные)','Плантоиды (Растениевидные)',
                              'Литоиды (Каменные)','Синтетики / Киборги','Энергетические сущности'];
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid(); uid := auth.uid();
  select race into frace from public.faction_applications
    where faction_id=fid and status='approved' order by updated_at desc limit 1;
  if frace is null then
    select race into frace from public.faction_applications
      where faction_id=fid order by updated_at desc limit 1;
  end if;

  select count(*), max(created_at) into v_cnt, v_last from public.spy_recruits where faction_id=fid;

  -- сколько обновить за этот заход: первый раз (пусто) — добить до 4; дальше — раз
  -- в сутки заменяем 1–3 старейших. Несколько заходов в день не множат подмену.
  if v_cnt = 0 then
    n_replace := 4;
  elsif v_last is null or v_last < now() - interval '1 day' then
    n_replace := 1 + floor(random()*3)::int;          -- 1..3
  else
    n_replace := 0;
  end if;

  if n_replace > 0 then
    -- удалить N старейших (но не больше, чем есть)
    if v_cnt > 0 and n_replace < 4 then
      for rid in select id from public.spy_recruits where faction_id=fid order by created_at asc limit n_replace loop
        delete from public.spy_recruits where id=rid;
      end loop;
    elsif v_cnt > 0 then
      delete from public.spy_recruits where faction_id=fid;   -- первый ребилд
    end if;
    -- добрать до 4
    select count(*) into v_cnt from public.spy_recruits where faction_id=fid;
    for i in 1..(4 - v_cnt) loop
      -- чужие расы чаще: ~55% чужак, иначе своя (раньше было наоборот)
      if frace is not null and random() < 0.45 then
        rc := frace;
      else
        rc := all_races[1 + floor(random()*array_length(all_races,1))::int];
      end if;
      nm := public._spy_gen_name(rc);
      fn := nm->>'fn'; ln := nm->>'ln'; gn := nm->>'gn';
      pk := perks[1 + floor(random()*array_length(perks,1))::int];
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
                -- роль контрразведки агента (если назначен)
                'ci_role',(select ci.role from public.faction_counterintel ci where ci.faction_id=fid and ci.agent_id=a.id),
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
    -- следующий «дневной» подвоз
    'refresh_at', (select max(created_at) + interval '1 day' from public.spy_recruits where faction_id=fid),
    'counterintel', public.spy_counter_list());
end$$;
revoke all on function public.spy_recruits_list() from public;
grant execute on function public.spy_recruits_list() to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 5. МИГРАЦИЯ старой контрразведки (counter_map счётчики → ИМЕННЫЕ агенты)
-- ════════════════════════════════════════════════════════════════════════
-- До этого среза КР задавалась числами в faction_economy.counter_map
-- ({'hq':n, <colony_id>:n}). Эти агенты остаются «заняты» (counter_agents>0),
-- но в новом именном UI не видны → «никто не назначен · свободно 0». Переносим:
-- для каждой области берём первых доступных агентов по числу, ставим их в роль
-- ('hq'→'state', колонии — как есть), затем очищаем counter_map. Идемпотентно:
-- работает только для фракций, у которых ещё нет именных назначений.
do $$
declare f record; sc record; aid uuid;
begin
  for f in select faction_id, counter_map from public.faction_economy
           where counter_map is not null and counter_map <> '{}'::jsonb
             and not exists(select 1 from public.faction_counterintel ci where ci.faction_id=faction_economy.faction_id)
  loop
    for sc in select key as scope, (value)::int as n from jsonb_each_text(f.counter_map) where (value)::int > 0 loop
      for aid in select a.id from public.spy_agents a
                 where a.faction_id=f.faction_id and coalesce(a.captive,false)=false and a.ready_at<=now()
                   and not exists(select 1 from public.faction_counterintel ci where ci.faction_id=f.faction_id and ci.agent_id=a.id)
                 order by a.hired_at limit sc.n
      loop
        insert into public.faction_counterintel(faction_id, agent_id, role)
          values(f.faction_id, aid, case when sc.scope='hq' then 'state' else sc.scope end)
          on conflict (faction_id, agent_id) do nothing;
      end loop;
    end loop;
    update public.faction_economy
      set counter_agents = (select count(*) from public.faction_counterintel where faction_id=f.faction_id),
          counter_map = '{}'::jsonb
      where faction_id=f.faction_id;
  end loop;
end$$;
