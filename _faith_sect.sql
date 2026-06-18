-- ============================================================
-- ВЕРА (РЕЛИГИЯ) · СЛАЙС 4: ТАЙНЫЕ СЕКТЫ
-- Применять в Supabase → SQL Editor ПОСЛЕ _faith_impose.sql. Идемпотентно.
--
-- ПЕРЕОСМЫСЛЕНИЕ операции faith_impose: вместо открытого «обращения» цели агент
-- внедряет ТАЙНУЮ СЕКТУ вашей веры в чужую державу. Секта работает как храм
-- (доход + сила веры — ВЛАДЕЛЬЦУ, скрытно), пока контрразведка хозяина её не
-- ВСКРОЕТ. «Подавление веры через агентов» = КР хозяина: чем её больше, тем
-- быстрее растёт «вскрытие»; на 100% секта гибнет, хозяин узнаёт виновника.
--
-- Файл пересоздаёт _faith_strength / spy_launch / _spy_resolve / spy_incoming /
-- economy_accrue / faith_status как надмножества. Добавленное помечено «-- ВЕРА-4:».
-- ============================================================

-- ── 1) ДАННЫЕ: тайные секты ─────────────────────────────────
create table if not exists public.faith_sects (
  id uuid primary key default gen_random_uuid(),
  faith_id uuid not null references public.faiths(id) on delete cascade,
  owner_fid text not null,          -- кто внедрил (его вера)
  host_fid text not null,           -- в какой державе сидит секта
  exposure numeric not null default 0,   -- 0..100, рост от КР хозяина
  status text not null default 'active' check (status in ('active','exposed')),
  planted_at timestamptz default now(),
  exposed_at timestamptz
);
create index if not exists fsect_owner_idx on public.faith_sects(owner_fid, status);
create index if not exists fsect_host_idx  on public.faith_sects(host_fid, status);

alter table public.faith_sects enable row level security;
-- ВАЖНО: чтение НЕ публичное — иначе хозяин увидит секту до вскрытия.
-- Клиент получает секты только через RPC faith_status (владельцу — свои,
-- хозяину — лишь вскрытые). Прямого select по таблице нет.
drop policy if exists "fsect_sel" on public.faith_sects;
create policy "fsect_sel" on public.faith_sects for select to authenticated using (false);

-- ── 2) _faith_strength v2: храмы + СВОИ активные секты ───────
create or replace function public._faith_strength(p_fid text)
returns int language sql stable security definer set search_path=public as $$
  select coalesce((select sum(slots_open) from public.colony_buildings
                   where faction_id = p_fid and btype = 'temple'),0)::int
       + coalesce((select count(*) from public.faith_sects
                   where owner_fid = p_fid and status = 'active'),0)::int   -- ВЕРА-4: секты как храмы
$$;
revoke all on function public._faith_strength(text) from public;

-- ── 3) spy_launch v3: faith_impose → внедрение секты ────────
-- База: _faith_impose.sql. Изменён precheck (помечено «-- ВЕРА-4:»).
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

  -- ВЕРА-4: для секты нужна СВОЯ вера; нельзя держать две секты в одной державе
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

-- ── 4) _spy_resolve v3: faith_impose внедряет секту ─────────
-- База: _faith_impose.sql. Изменена ветка faith_impose (помечено «-- ВЕРА-4:»).
create or replace function public._spy_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare m public.spy_missions; ok boolean; caught boolean; res jsonb; steal numeric; bid uuid; bt text;
  techs jsonb; node text; tgt public.faction_economy; v_colname text;
  v_faith uuid; v_faith_name text;
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
      elsif m.op='faith_impose' then               -- ВЕРА-4: внедрение ТАЙНОЙ СЕКТЫ
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

-- ── 5) spy_incoming: секту НЕ показываем хозяину до вскрытия ─
-- Возврат к whitelist без faith_impose (база _spy_agents4 — сигнатура с evidence/hint).
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

-- ── 6) economy_accrue v4: доход сект (владельцу) + вскрытие (хозяином) ──
-- База: _faith_spread.sql (строки «-- ВЕРА» и «-- ВЕРА-2»). Добавлено «-- ВЕРА-4».
create or replace function public.economy_accrue(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  eco public.faction_economy; d int;
  inc_gc numeric:=0; inc_sci numeric:=0; inc_agents int:=0; trade_gc numeric:=0; pirate boolean:=false;
  r record; col record; bld record; relem jsonb; thr jsonb;
  res_add jsonb := '{}'::jsonb; res_sub jsonb := '{}'::jsonb; merged jsonb; k text;
  rname text; rr text; rate numeric; escorted boolean; attacked boolean; chance numeric; avail numeric; shipped numeric;
  mods jsonb; m_mine numeric; m_gc numeric;
  market_cap numeric; market_gc numeric := 0; sell numeric;
  export_gc numeric := 0; cap numeric;
  rel_score int; dip_coef numeric;
  mine_flow jsonb := '{}'::jsonb;
  flow_rar  jsonb := '{}'::jsonb;
  citem jsonb; cargo_price numeric;
  policy_cost numeric := 0;
  has_faith boolean := false;                       -- ВЕРА
  tithe_gc numeric := 0;                             -- ВЕРА-2
  v_sects int := 0;                                  -- ВЕРА-4: мои активные секты
  sct record; v_ci_host int; v_new_exp numeric;      -- ВЕРА-4: вскрытие чужих сект
begin
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then return jsonb_build_object('faction_id',p_fid,'days',0); end if;

  mods := public._faction_mods(p_fid);
  m_mine := (mods->>'mine')::numeric;
  m_gc   := (mods->>'gc')::numeric;
  if eco.debuff_until is not null and eco.debuff_until > now() then
    m_gc := m_gc * (1 - coalesce(eco.debuff_pct,0));
  end if;
  policy_cost := public._trade_policy_cost(coalesce(eco.trade_policy,0));

  update public.unit_production set status='done' where faction_id=p_fid and status='queued' and ready_at<=now();

  perform public._apply_colony_projects(p_fid);
  perform public._spy_resolve(p_fid);
  perform public._raid_resolve(p_fid);

  d := floor(extract(epoch from (now()-eco.last_tick))/86400.0);

  has_faith := exists(select 1 from public.faith_membership where faction_id = p_fid);  -- ВЕРА

  for r in select btype, slots_open from public.colony_buildings where faction_id=p_fid loop
    if r.btype='factory' then inc_gc := inc_gc + r.slots_open*200;
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    elsif r.btype='temple' and has_faith then inc_gc := inc_gc + r.slots_open*150;  -- ВЕРА
    end if;
  end loop;

  -- ВЕРА-2: десятина основателю с храмов адептов
  if exists(select 1 from public.faiths where founder_fid = p_fid) then
    select coalesce(sum(cb.slots_open),0) * 150 * 0.20 into tithe_gc
    from public.faith_membership m
    join public.faiths f on f.id = m.faith_id and f.founder_fid = p_fid
    join public.colony_buildings cb on cb.faction_id = m.faction_id and cb.btype = 'temple'
    where m.role <> 'founder';
    inc_gc := inc_gc + coalesce(tithe_gc, 0);
  end if;

  -- ВЕРА-4: доход моих тайных сект (covert temples) — каждая как храм, +150 ГС
  select count(*) into v_sects from public.faith_sects where owner_fid = p_fid and status = 'active';
  if v_sects > 0 then inc_gc := inc_gc + v_sects * 150; end if;

  if d >= 1 then
    cap := 1000 + coalesce((select sum(slots_open) from public.colony_buildings
                            where faction_id=p_fid and btype='warehouse'),0) * 500;

    -- ВЕРА-4: контрразведка хозяина вскрывает чужие секты на его территории
    if exists(select 1 from public.faith_sects where host_fid = p_fid and status = 'active') then
      v_ci_host := public._spy_ci_power(p_fid, 'hq');
      for sct in select * from public.faith_sects where host_fid = p_fid and status = 'active' loop
        v_new_exp := least(100, sct.exposure + greatest(3, v_ci_host * 12) * d);
        if v_new_exp >= 100 then
          update public.faith_sects set exposure = 100, status = 'exposed', exposed_at = now() where id = sct.id;
          insert into public.faction_relations(from_fid,to_fid,score,updated_at)
            values(p_fid, sct.owner_fid, -10, now())
            on conflict (from_fid,to_fid) do update set score=greatest(-100, public.faction_relations.score-10), updated_at=now();
          insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
              title, excerpt, body, status, published_at, created_at, updated_at)
            values(p_fid, '🛐 КОНТРРАЗВЕДКА', 'rgba(200,150,40,0.55)', null, null,
              'Вскрыта тайная секта', null,
              format('Контрразведка «%s» раскрыла тайную секту веры «%s», насаждённую фракцией «%s». Ячейка ликвидирована.',
                public._fac_name(p_fid),
                coalesce((select name from public.faiths where id=sct.faith_id),'неизвестной веры'),
                public._fac_name(sct.owner_fid)),
              'approved', now(), now(), now());
        else
          update public.faith_sects set exposure = v_new_exp where id = sct.id;
        end if;
      end loop;
    end if;

    for bld in
      select cb.mining_targets, coalesce(cb.mine_mode,'store') as mine_mode, c.resources as cres
      from public.colony_buildings cb
      join public.colonies c on c.id = cb.colony_id
      where cb.faction_id = p_fid and cb.btype = 'mining'
        and jsonb_array_length(coalesce(cb.mining_targets,'[]'::jsonb)) > 0
        and c.resources is not null and jsonb_array_length(c.resources) > 0
    loop
      for rname in select value from jsonb_array_elements_text(bld.mining_targets) loop
        select value into relem from jsonb_array_elements(bld.cres) where value->>'name' = rname limit 1;
        if relem is null then continue; end if;
        rr := coalesce(relem->>'r','common');
        rate := case rr when 'uncommon' then 12 when 'rare' then 6 when 'epic' then 3 when 'legendary' then 1 else 25 end;
        rate := greatest(1, round(rate * public._richness_mult(relem->>'amt') * m_mine));
        if bld.mine_mode = 'export' then
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(coalesce((mine_flow->>rname)::numeric,0) + rate*d), true);
          flow_rar  := jsonb_set(flow_rar,  array[rname], to_jsonb(rr), true);
        else
          res_add := jsonb_set(res_add, array[rname], to_jsonb(coalesce((res_add->>rname)::numeric,0) + rate*d), true);
        end if;
      end loop;
    end loop;

    for r in select cargo, resource, volume, price, convoy, threats, b_fid, transit_until from public.trade_routes where status='active' and a_fid=p_fid loop
      if r.transit_until is not null and r.transit_until > now() then continue; end if;
      escorted := coalesce(r.convoy,0) > 0; attacked := false;
      for thr in select value from jsonb_array_elements(coalesce(r.threats,'[]'::jsonb)) loop
        if (thr->>'type') = 'ancient' then chance := case when escorted then 0.65 else 0.80 end;
        else chance := case when escorted then 0.40 else 0.80 end; end if;
        if random() < chance then attacked := true; end if;
      end loop;
      if attacked then pirate := true; continue; end if;
      select coalesce(score,0) into rel_score from public.faction_relations where from_fid=p_fid and to_fid=r.b_fid;
      dip_coef := greatest(0.8, least(1.2, 1 + coalesce(rel_score,0)/500.0));

      if jsonb_array_length(coalesce(r.cargo,'[]'::jsonb)) > 0 then
        for citem in select value from jsonb_array_elements(r.cargo) loop
          rname := citem->>'res';
          avail := coalesce((mine_flow->>rname)::numeric, 0);
          shipped := least(coalesce((citem->>'vol')::numeric,0)*d, avail);
          if shipped <= 0 then continue; end if;
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(avail - shipped), true);
          cargo_price := public._res_price(coalesce((select rarity from public.resource_rarity where name=rname),'common'));
          trade_gc := trade_gc + shipped * cargo_price * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*cargo_price*0.5*dip_coef) where faction_id = r.b_fid;
        end loop;
      else
        avail := coalesce((mine_flow->>r.resource)::numeric, 0);
        shipped := least(coalesce(r.volume,0)*d, avail);
        if shipped > 0 then
          mine_flow := jsonb_set(mine_flow, array[r.resource], to_jsonb(avail - shipped), true);
          trade_gc := trade_gc + shipped * coalesce(r.price,0) * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*coalesce(r.price,0)*0.5*dip_coef) where faction_id = r.b_fid;
        end if;
      end if;
    end loop;
    trade_gc := round(trade_gc * m_gc);

    for rname in select jsonb_object_keys(mine_flow) loop
      avail := coalesce((mine_flow->>rname)::numeric, 0);
      if avail > 0 then
        export_gc := export_gc + avail * public._res_value(rname, coalesce(flow_rar->>rname,'common')) * 0.6;
      end if;
    end loop;
    export_gc := round(export_gc * m_gc);

    market_cap := (select coalesce(sum(slots_open),0) from public.colony_buildings
                   where faction_id = p_fid and btype = 'market') * 25 * d;
    if market_cap > 0 then
      for r in
        select res_name, res_rar, avail from (
          select distinct on (nm) nm as res_name, rr as res_rar,
            greatest(0, coalesce((eco.resources->>nm)::numeric,0)
                        + coalesce((res_add->>nm)::numeric,0)
                        - coalesce((res_sub->>nm)::numeric,0)) as avail
          from (
            select (e.value->>'name') as nm, coalesce(e.value->>'r','common') as rr
            from public.colonies c, jsonb_array_elements(c.resources) e
            where c.faction_id = p_fid
          ) q
          order by nm, public._res_value(nm, rr) desc
        ) u
        where avail > 0
        order by public._res_value(res_name, res_rar) desc
      loop
        exit when market_cap <= 0;
        sell := least(r.avail, market_cap);
        res_sub := jsonb_set(res_sub, array[r.res_name],
                     to_jsonb(coalesce((res_sub->>r.res_name)::numeric,0) + sell), true);
        market_gc := market_gc + sell * public._res_value(r.res_name, r.res_rar) *
          (case r.res_rar when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65 when 'uncommon' then 0.55 else 0.5 end);
        market_cap := market_cap - sell;
      end loop;
      market_gc := round(market_gc * m_gc);
    end if;

    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_add) loop
      merged := jsonb_set(merged, array[k], to_jsonb(least(cap, coalesce((merged->>k)::numeric,0) + (res_add->>k)::numeric)), true);
    end loop;
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric)), true);
    end loop;

    update public.faction_economy
      set gc = greatest(0, gc + round(inc_gc * m_gc * d) + trade_gc + market_gc + export_gc - policy_cost * d),
          science = science + greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
          agents  = agents  + greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
          resources = merged,
          last_tick = last_tick + (d || ' days')::interval
      where faction_id=p_fid returning * into eco;

    insert into public.income_history(faction_id, owner_id, days, gc_build, gc_trade, gc_market, gc_export, gc_policy, gc_net, gc_after, sci, agents_n, mined)
      values(p_fid, eco.owner_id, d,
        round(inc_gc * m_gc * d), trade_gc, market_gc, export_gc, policy_cost * d,
        round(inc_gc * m_gc * d) + trade_gc + market_gc + export_gc - policy_cost * d,
        eco.gc,
        greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
        greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
        (select coalesce(sum(value::numeric),0) from jsonb_each_text(res_add)));
    delete from public.income_history where faction_id=p_fid
      and id not in (select id from public.income_history where faction_id=p_fid order by tick_at desc limit 30);
  end if;

  perform public._research_step(p_fid);
  select * into eco from public.faction_economy where faction_id = p_fid;

  return jsonb_build_object('faction_id',eco.faction_id,'gc',eco.gc,'science',eco.science,'agents',eco.agents,
    'resources',eco.resources,'last_tick',eco.last_tick,'days',d, 'mods', mods,
    'income', jsonb_build_object(
      'gc',     round(inc_gc * m_gc),
      'science',greatest(0, inc_sci    + (mods->>'sci_flat')::numeric),
      'agents', greatest(0, inc_agents + (mods->>'agents_flat')::numeric),
      'trade',  trade_gc, 'market', market_gc, 'export', export_gc,
      'policy', policy_cost, 'pirate', pirate));
end$$;
revoke all on function public.economy_accrue(text) from public;

-- Вскрытые на моей территории секты (кто и какой веры) — для оповещения хозяина.
create or replace function public._faith_exposed_here(p_fid text)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'owner_fid', x.owner_fid,
      'faith_name', (select name from public.faiths where id=x.faith_id)) order by x.exposed_at desc), '[]'::jsonb)
  from public.faith_sects x where x.host_fid = p_fid and x.status = 'exposed'
$$;
revoke all on function public._faith_exposed_here(text) from public;

-- ── 7) faith_status v3: + мои секты и вскрытые секты у меня ──
create or replace function public.faith_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_fid text; m public.faith_membership; f public.faiths;
  s int; disc numeric; is_founder boolean;
begin
  v_fid := public._ec_my_fid();
  s    := public._faith_strength(v_fid);
  disc := public._faith_unit_discount(v_fid);
  select * into m from public.faith_membership where faction_id = v_fid;

  if not found then
    return jsonb_build_object('faith', null, 'can_found', public._faith_can_found(v_fid),
      'strength', s, 'unit_discount', disc, 'temple_income', 150, 'tithe_pct', 0.20,
      'offers_in', public._faith_offers_in(v_fid),
      'sects', '[]'::jsonb, 'exposed_here', public._faith_exposed_here(v_fid));   -- ВЕРА-4
  end if;

  select * into f from public.faiths where id = m.faith_id;
  is_founder := (m.role = 'founder');
  return jsonb_build_object(
    'faith', jsonb_build_object('id', f.id, 'name', f.name, 'dogma', f.dogma,
       'color', f.color, 'open', f.open, 'founder_fid', f.founder_fid),
    'role', m.role,
    'can_found', public._faith_can_found(v_fid),
    'strength', s,
    'unit_discount', disc,
    'temple_income', 150,
    'tithe_pct', 0.20,
    'adepts', (select coalesce(jsonb_agg(jsonb_build_object(
                 'fid', mm.faction_id, 'role', mm.role,
                 'flock', public._faith_strength(mm.faction_id)) order by mm.joined_at), '[]'::jsonb)
               from public.faith_membership mm where mm.faith_id = f.id),
    'offers_in', public._faith_offers_in(v_fid),
    'offers_out', case when is_founder then (
        select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'to_fid', o.to_fid) order by o.created_at), '[]'::jsonb)
        from public.faith_offers o where o.faith_id = f.id and o.status = 'pending')
      else '[]'::jsonb end,
    -- ВЕРА-4: мои тайные секты (где сижу, риск вскрытия) + вскрытые у меня
    'sects', (select coalesce(jsonb_agg(jsonb_build_object(
        'host_fid', x.host_fid, 'exposure', round(x.exposure)) order by x.planted_at), '[]'::jsonb)
        from public.faith_sects x where x.owner_fid = v_fid and x.status = 'active'),
    'exposed_here', public._faith_exposed_here(v_fid));
end$$;
revoke all on function public.faith_status() from public;
grant execute on function public.faith_status() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- 1) разведать цель, 2) spy_launch('<tgt>','faith_impose','["<agent>"]') → тайная секта;
-- 3) у владельца faith_status.sects растёт доход; у хозяина с КР растёт exposure→вскрытие.
