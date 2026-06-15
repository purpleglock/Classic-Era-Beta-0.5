-- ============================================================
-- ШПИОНАЖ · ЭТАП 2: ОПЕРАЦИИ НА ИМЕНОВАННЫХ АГЕНТАХ + ПЕРКИ + ОБУЧЕНИЕ
-- Применять в Supabase → SQL Editor ПОСЛЕ _spy_agents.sql. Идемпотентно.
--
-- Операции теперь назначают КОНКРЕТНЫХ агентов (не абстрактный пул). Перки баффают:
--   infiltrator +12% успеха краж (казна/техно); saboteur +12% саботаж/дестабилизация;
--   analyst +10% разведка; ghost −10% раскрытия. handler — для контрразведки (этап 4).
-- Наём теперь с ВРЕМЕНЕМ ОБУЧЕНИЯ (2 хода): агент готов по ready_at. Доступность
-- считается лениво (ready_at<=now, не занят активной операцией) — пул eco.agents
-- операциями больше НЕ используется (intel-здания остаются как потолок найма).
-- Пойманный агент выбывает из ростера (схвачен).
-- ============================================================

alter table public.spy_agents   add column if not exists ready_at timestamptz default now();
alter table public.spy_missions  add column if not exists agent_ids jsonb default '[]'::jsonb;

-- ── Наём: время обучения 2 хода, пул не трогаем ─────────────
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
    values(fid, auth.uid(), rc.first_name, rc.last_name, rc.perk, now() + interval '2 days');
  delete from public.spy_recruits where id=p_recruit_id;
  return jsonb_build_object('ok',true,'agent',rc.first_name||' '||rc.last_name,'perk',rc.perk,'cost',rc.cost,'training_turns',2);
end$$;
revoke all on function public.spy_hire(uuid) from public;
grant execute on function public.spy_hire(uuid) to authenticated;

-- ── Увольнение: нельзя занятого; пул не трогаем ─────────────
create or replace function public.spy_agent_fire(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if exists(select 1 from public.spy_missions sm where sm.actor_fid=fid and sm.status='active' and sm.agent_ids ? p_id::text) then
    raise exception 'agent is on a mission';
  end if;
  delete from public.spy_agents where id=p_id and faction_id=fid and owner_id=auth.uid();
  if not found then raise exception 'agent not found'; end if;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.spy_agent_fire(uuid) from public;
grant execute on function public.spy_agent_fire(uuid) to authenticated;

-- ── Список рекрутов + ростер со статусами (training/busy/ready) ──
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
                'id',a.id,'first_name',a.first_name,'last_name',a.last_name,'perk',a.perk,'ready_at',a.ready_at,
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

-- ── Запуск операции: назначаем конкретных агентов + перки ───
create or replace function public.spy_launch(p_target_fid text, p_op text, p_agent_ids jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; tgt public.faction_economy;
  meta jsonb; intel jsonb; diff numeric; need text; rec text;
  a int; ci int; ibonus numeric; spow numeric; succ int; det int; turns int;
  tgt_owner uuid; v_ids uuid[]; v_avail int; succ_b int; det_b int;
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

  -- валидные доступные агенты из выбранных: мои, обученные, не заняты
  select array_agg(ag.id) into v_ids
  from public.spy_agents ag
  where ag.faction_id=app.faction_id
    and ag.id in (select (jsonb_array_elements_text(coalesce(p_agent_ids,'[]'::jsonb)))::uuid)
    and ag.ready_at <= now()
    and not exists(select 1 from public.spy_missions sm
                   where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text);
  a := coalesce(array_length(v_ids,1),0);
  if a < 1 then raise exception 'select at least one available agent'; end if;

  -- не больше, чем свободно (доступные − зарезервированные в контрразведке)
  select count(*) into v_avail from public.spy_agents ag
  where ag.faction_id=app.faction_id and ag.ready_at<=now()
    and not exists(select 1 from public.spy_missions sm
                   where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text);
  if a > v_avail - coalesce(me.counter_agents,0) then raise exception 'agents reserved for counterintel'; end if;

  intel := public._spy_intel(app.faction_id, p_target_fid);
  need := meta->>'need'; rec := intel->>'level';
  if need = 'basic' and rec is null then raise exception 'intel required: basic recon'; end if;
  if need = 'deep'  and rec is distinct from 'deep' then raise exception 'intel required: deep recon'; end if;

  -- перк-бонусы выбранных агентов
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
  turns := greatest(1, ceil((meta->>'base')::numeric * (1 + diff/100.0) / sqrt(a)));

  insert into public.spy_missions(actor_fid,actor_owner,target_fid,target_owner,target_name,op,mtype,agents,
      agent_ids, success_pct,detect_pct,status,started_at,ready_at,params)
    values(app.faction_id, auth.uid(), p_target_fid, tgt_owner, public._fac_name(p_target_fid), p_op, p_op, a,
      (select jsonb_agg(x::text) from unnest(v_ids) x),
      succ, det, 'active', now(), coalesce(me.last_tick, now()) + (turns || ' days')::interval, '{}'::jsonb);
  return jsonb_build_object('ok',true,'success_pct',succ,'detect_pct',det,'turns',turns,'agents',a);
end$$;
revoke all on function public.spy_launch(text,text,jsonb) from public;
grant execute on function public.spy_launch(text,text,jsonb) to authenticated;

-- ── Контрразведка: потолок = доступные обученные агенты ─────
create or replace function public.counterintel_set(p_n int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_avail int; n int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  perform 1 from public.faction_economy where faction_id=fid for update;
  select count(*) into v_avail from public.spy_agents ag
   where ag.faction_id=fid and ag.ready_at<=now()
     and not exists(select 1 from public.spy_missions sm where sm.actor_fid=fid and sm.status='active' and sm.agent_ids ? ag.id::text);
  n := greatest(0, least(coalesce(p_n,0), v_avail));
  update public.faction_economy set counter_agents=n where faction_id=fid;
  return jsonb_build_object('ok',true,'counter_agents',n);
end$$;
revoke all on function public.counterintel_set(int) from public;
grant execute on function public.counterintel_set(int) to authenticated;

-- ── Отзыв операции: агенты освобождаются (миссия удалена) ───
create or replace function public.spy_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  delete from public.spy_missions where id=p_id and actor_owner=auth.uid() and status='active';
  if not found then raise exception 'not found'; end if;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.spy_cancel(uuid) from public;
grant execute on function public.spy_cancel(uuid) to authenticated;

-- ── Разрешение операций: агенты освобождаются; пойманный выбывает ──
create or replace function public._spy_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare m public.spy_missions; ok boolean; caught boolean; res jsonb; steal numeric; bid uuid; bt text;
  techs jsonb; node text; tgt public.faction_economy;
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
        if m.op='recon_deep' then res := res || jsonb_build_object(
          'units',(select coalesce(sum(qty),0) from public.unit_production where faction_id=m.target_fid and status='done'),
          'research',(select coalesce(jsonb_array_length(research),0) from public.faction_economy where faction_id=m.target_fid)); end if;
      elsif m.op='steal_gc' then
        steal := round(coalesce(tgt.gc,0) * least(0.30, 0.06*m.agents));
        update public.faction_economy set gc=greatest(0,gc-steal) where faction_id=m.target_fid;
        update public.faction_economy set gc=gc+steal where faction_id=m.actor_fid;
        res := jsonb_build_object('gc',steal);
      elsif m.op='sabotage' then
        select id,btype into bid,bt from public.colony_buildings where faction_id=m.target_fid order by random() limit 1;
        if bid is not null then delete from public.colony_buildings where id=bid; res := jsonb_build_object('building',bt);
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
      end if;
    end if;

    -- пойманный агент схвачен (выбывает один из назначенных)
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

-- ── Проверка ────────────────────────────────────────────────
-- Наём → агент «обучается» 2 хода (ready_at), потом доступен. Операция требует
-- выбрать конкретных агентов; перки баффают успех/скрытность. Пойманный выбывает.
