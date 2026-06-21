-- ============================================================
-- ПРОСТРАНСТВЕННАЯ ЭКОНОМИКА · СРЕЗ 4 — статусы по тикам + сектор + спилловер
-- Выполнить ПОСЛЕ _spatial_economy1..3.sql.
--  1) Персистентные статусы: дефицит копит «напряжение» (strain) → волнения →
--     стагнация; восстановление снимает. Применяется к просперити (лаг 1 тик).
--  2) Слой сектора: множитель событий (война/пираты/бум) с авто-истечением,
--     влияет на просперити всех систем сектора.
--  3) Пассивный спилловер: соседи той же фракции по гиперпути частично гасят
--     дефицит (амбиентно, слабее направленной логистики, без дохода).
-- ⚠ Зеркало в economy.js: EC.sectors (события сектора в полоске).
-- ============================================================

-- ── Состояние системы (накопление статуса) ──────────────────
create table if not exists public.system_econ (
  system_id  text primary key,
  strain     numeric not null default 0,    -- 0..6: напряжение от дефицита
  status     text    not null default 'ok', -- ok | unrest | stagnation
  updated_at timestamptz default now()
);
alter table public.system_econ enable row level security;
drop policy if exists "se_sel" on public.system_econ;
create policy "se_sel" on public.system_econ for select to public using (true);   -- статус виден на карте/в кабинете

-- ── Сектор: экономическое событие (staff-левер с авто-истечением) ──
alter table public.map_sectors add column if not exists econ_event text;            -- war | pirates | boom | depression | null
alter table public.map_sectors add column if not exists econ_mod   numeric default 1; -- множитель просперити (0.5..1.5)
alter table public.map_sectors add column if not exists econ_until timestamptz;       -- до какого момента активно (null = бессрочно)

-- ── Корректировка просперити: сектор + персистентный статус ──
--   Применяется в КОНЦЕ обоих балансов (raw и net), чтобы UI и сервер совпадали.
create or replace function public._econ_adjust(p_system_id text, p_prosp numeric, p_status text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare smod numeric; persist text; fstatus text; pr numeric;
begin
  select case when econ_until is not null and econ_until < now() then 1 else coalesce(econ_mod,1) end
    into smod from public.map_sectors where p_system_id = any(system_ids) limit 1;
  smod := coalesce(smod, 1);
  select status into persist from public.system_econ where system_id = p_system_id;
  fstatus := coalesce(persist, p_status);
  pr := p_prosp * smod;
  if fstatus = 'stagnation' then pr := least(pr, 0.4);
  elsif fstatus = 'unrest' then pr := pr * 0.85; end if;
  pr := round(least(1.6, greatest(0.4, pr)), 3);
  return jsonb_build_object('prosperity', pr, 'status', fstatus);
end$$;
revoke all on function public._econ_adjust(text,numeric,text) from public;
grant execute on function public._econ_adjust(text,numeric,text) to anon, authenticated;

-- ── Баланс системы (raw) — теперь с корректировкой сектор+статус ──
create or replace function public._system_balance(p_system_id text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  r record; v jsonb;
  sup_r numeric:=0; sup_g numeric:=0; sup_c numeric:=0;
  dem_r numeric:=0; dem_g numeric:=0; dem_c numeric:=0;
  lab_d numeric:=0; pop numeric:=0; lab_s numeric;
  cov_r numeric; cov_g numeric; cov_c numeric; cov_l numeric;
  pr_r numeric; pr_g numeric; pr_c numeric;
  welfare numeric; prosperity numeric; st text; adj jsonb;
begin
  select coalesce(sum(cells),0) into pop from public.colonies where system_id = p_system_id;

  for r in
    select cb.btype, cb.slots_open, cb.tnp_mode
    from public.colony_buildings cb
    join public.colonies c on c.id = cb.colony_id
    where c.system_id = p_system_id
  loop
    v := public._building_vector(r.btype, r.slots_open, coalesce(r.tnp_mode,false));
    sup_r := sup_r + (v->>'ro')::numeric; sup_g := sup_g + (v->>'go')::numeric; sup_c := sup_c + (v->>'co')::numeric;
    dem_r := dem_r + (v->>'ri')::numeric; dem_g := dem_g + (v->>'gi')::numeric; dem_c := dem_c + (v->>'ci')::numeric;
    lab_d := lab_d + (v->>'l')::numeric;
  end loop;

  lab_s := pop * 1;
  dem_c := dem_c + pop * 0.5;

  cov_r := case when dem_r<=0 then 1 else round(sup_r/dem_r,3) end;
  cov_g := case when dem_g<=0 then 1 else round(sup_g/dem_g,3) end;
  cov_c := case when dem_c<=0 then 1 else round(sup_c/dem_c,3) end;
  cov_l := case when lab_d<=0 then 1 else round(lab_s/lab_d,3) end;

  pr_r := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_r))),3);
  pr_g := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_g))),3);
  pr_c := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_c))),3);

  welfare := least(2.0, greatest(0, least(cov_c, cov_l)));
  prosperity := round(least(1.6, greatest(0.4, 0.4 + 0.6*welfare)),3);
  if cov_c < 0.4 or cov_l < 0.4 then st := 'stagnation';
  elsif cov_c < 0.7 or cov_l < 0.7 then st := 'unrest';
  else st := 'ok'; end if;

  adj := public._econ_adjust(p_system_id, prosperity, st);
  prosperity := (adj->>'prosperity')::numeric; st := adj->>'status';

  return jsonb_build_object(
    'system_id', p_system_id, 'pop', pop,
    'supply',   jsonb_build_object('r',sup_r,'g',sup_g,'c',sup_c),
    'demand',   jsonb_build_object('r',dem_r,'g',dem_g,'c',dem_c),
    'labor',    jsonb_build_object('supply',lab_s,'demand',lab_d),
    'coverage', jsonb_build_object('r',cov_r,'g',cov_g,'c',cov_c,'l',cov_l),
    'prices',   jsonb_build_object('r',pr_r,'g',pr_g,'c',pr_c),
    'prosperity', prosperity, 'status', st
  );
end$$;
revoke all on function public._system_balance(text) from public;
grant execute on function public._system_balance(text) to anon, authenticated;

-- ── Баланс NET — доставки караванов + ПАССИВНЫЙ СПИЛЛОВЕР + корректировка ──
create or replace function public._system_balance_net(p_system_id text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  raw jsonb; src jsonb; ng record;
  sup_r numeric; sup_g numeric; sup_c numeric;
  dem_r numeric; dem_g numeric; dem_c numeric;
  lab_s numeric; lab_d numeric;
  imp_c numeric:=0;
  sp_r numeric:=0; sp_g numeric:=0; sp_c numeric:=0;
  nsurp_r numeric:=0; nsurp_g numeric:=0; nsurp_c numeric:=0;
  spill numeric;
  v_fac text;
  cov_r numeric; cov_g numeric; cov_c numeric; cov_l numeric;
  pr_r numeric; pr_g numeric; pr_c numeric;
  welfare numeric; prosperity numeric; st text; adj jsonb;
begin
  raw := public._system_balance(p_system_id);
  sup_r := (raw->'supply'->>'r')::numeric; sup_g := (raw->'supply'->>'g')::numeric; sup_c := (raw->'supply'->>'c')::numeric;
  dem_r := (raw->'demand'->>'r')::numeric; dem_g := (raw->'demand'->>'g')::numeric; dem_c := (raw->'demand'->>'c')::numeric;
  lab_s := (raw->'labor'->>'supply')::numeric; lab_d := (raw->'labor'->>'demand')::numeric;

  -- КАРАВАНЫ ЧЕРЕЗ СИСТЕМУ: активные маршруты, чей путь по гиперпутям проходит
  -- здесь (транзит или доставка), кормят её → предложение потребления растёт,
  -- дефицит/бедность спадают.
  imp_c := public._caravan_inflow(p_system_id);
  sup_c := sup_c + imp_c;

  -- ПАССИВНЫЙ СПИЛЛОВЕР: соседи той же фракции по гиперпути гасят остаточный дефицит
  select faction into v_fac from public.map_systems where id = p_system_id;
  if v_fac is not null then
    for ng in
      select case when h.a_id = p_system_id then h.b_id else h.a_id end as nid
      from public.map_hyperlanes h
      where h.a_id = p_system_id or h.b_id = p_system_id
    loop
      if (select faction from public.map_systems where id = ng.nid) is distinct from v_fac then continue; end if;
      src := public._system_balance(ng.nid);
      nsurp_r := nsurp_r + greatest(0, (src->'supply'->>'r')::numeric - (src->'demand'->>'r')::numeric);
      nsurp_g := nsurp_g + greatest(0, (src->'supply'->>'g')::numeric - (src->'demand'->>'g')::numeric);
      nsurp_c := nsurp_c + greatest(0, (src->'supply'->>'c')::numeric - (src->'demand'->>'c')::numeric);
    end loop;
    -- амбиентно: ≤60% остаточного дефицита и ≤15% излишка соседей
    if dem_r > sup_r then spill := least((dem_r-sup_r)*0.6, nsurp_r*0.15); sup_r := sup_r + spill; sp_r := spill; end if;
    if dem_g > sup_g then spill := least((dem_g-sup_g)*0.6, nsurp_g*0.15); sup_g := sup_g + spill; sp_g := spill; end if;
    if dem_c > sup_c then spill := least((dem_c-sup_c)*0.6, nsurp_c*0.15); sup_c := sup_c + spill; sp_c := spill; end if;
  end if;

  cov_r := case when dem_r<=0 then 1 else round(sup_r/dem_r,3) end;
  cov_g := case when dem_g<=0 then 1 else round(sup_g/dem_g,3) end;
  cov_c := case when dem_c<=0 then 1 else round(sup_c/dem_c,3) end;
  cov_l := case when lab_d<=0 then 1 else round(lab_s/lab_d,3) end;

  pr_r := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_r))),3);
  pr_g := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_g))),3);
  pr_c := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_c))),3);

  welfare := least(2.0, greatest(0, least(cov_c, cov_l)));
  prosperity := round(least(1.6, greatest(0.4, 0.4 + 0.6*welfare)),3);
  if cov_c < 0.4 or cov_l < 0.4 then st := 'stagnation';
  elsif cov_c < 0.7 or cov_l < 0.7 then st := 'unrest';
  else st := 'ok'; end if;

  adj := public._econ_adjust(p_system_id, prosperity, st);
  prosperity := (adj->>'prosperity')::numeric; st := adj->>'status';

  return jsonb_build_object(
    'system_id', p_system_id, 'pop', raw->'pop',
    'supply',   jsonb_build_object('r',sup_r,'g',sup_g,'c',sup_c),
    'demand',   jsonb_build_object('r',dem_r,'g',dem_g,'c',dem_c),
    'labor',    jsonb_build_object('supply',lab_s,'demand',lab_d),
    'coverage', jsonb_build_object('r',cov_r,'g',cov_g,'c',cov_c,'l',cov_l),
    'prices',   jsonb_build_object('r',pr_r,'g',pr_g,'c',pr_c),
    'caravan',  jsonb_build_object('c', imp_c),   -- доставлено караванами в систему
    'spill',    jsonb_build_object('r',sp_r,'g',sp_g,'c',sp_c),
    'prosperity', prosperity, 'status', st
  );
end$$;
revoke all on function public._system_balance_net(text) from public;
grant execute on function public._system_balance_net(text) to anon, authenticated;

-- ── Накопление статуса (вызывается из economy_accrue каждый день тика) ──
create or replace function public._econ_update_status(p_fid text, p_days int)
returns void language plpgsql security definer set search_path=public as $$
declare s record; nb jsonb; cc numeric; cl numeric; w numeric; cur numeric; strn numeric; newst text;
begin
  for s in select distinct c.system_id as sid from public.colonies c
           where c.faction_id = p_fid and c.system_id is not null loop
    nb := public._system_balance_net(s.sid);
    cc := coalesce((nb->'coverage'->>'c')::numeric, 1);
    cl := coalesce((nb->'coverage'->>'l')::numeric, 1);
    w  := least(cc, cl);
    select strain into cur from public.system_econ where system_id = s.sid;
    strn := coalesce(cur, 0);
    if w < 0.4 then strn := strn + 2*p_days;
    elsif w < 0.7 then strn := strn + 1*p_days;
    elsif w >= 0.9 then strn := strn - 1*p_days;
    end if;
    strn := least(6, greatest(0, strn));
    newst := case when strn >= 4 then 'stagnation' when strn >= 2 then 'unrest' else 'ok' end;
    insert into public.system_econ(system_id, strain, status, updated_at)
      values(s.sid, strn, newst, now())
      on conflict (system_id) do update set strain = excluded.strain, status = excluded.status, updated_at = now();
  end loop;
end$$;
revoke all on function public._econ_update_status(text,int) from public;

-- ── RPC (staff): задать экономическое событие сектора ────────
create or replace function public.sector_event_set(p_sector uuid, p_event text, p_mod numeric, p_days int)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden'; end if;
  update public.map_sectors
    set econ_event = nullif(p_event, ''),
        econ_mod   = greatest(0.3, least(1.7, coalesce(p_mod, 1))),
        econ_until = case when coalesce(p_days,0) > 0 then now() + (p_days || ' days')::interval else null end
    where id = p_sector;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.sector_event_set(uuid,text,numeric,int) from public;
grant execute on function public.sector_event_set(uuid,text,numeric,int) to authenticated;

-- ── economy_accrue: + накопление статуса систем (1 раз за день тика) ──
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
  has_faith boolean := false;
  tithe_gc numeric := 0;
  v_sects int := 0;
  sct record; v_ci_host int; v_new_exp numeric;
  sys_net jsonb := '{}'::jsonb;
  v_prosp numeric; v_pg numeric;
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

  has_faith := exists(select 1 from public.faith_membership where faction_id = p_fid);

  for col in select distinct c.system_id as sid from public.colonies c
             where c.faction_id = p_fid and c.system_id is not null loop
    sys_net := jsonb_set(sys_net, array[col.sid], public._system_balance_net(col.sid), true);
  end loop;

  for r in
    select cb.btype, cb.slots_open, cb.faith_id, c.system_id as sid
    from public.colony_buildings cb
    left join public.colonies c on c.id = cb.colony_id
    where cb.faction_id = p_fid
  loop
    v_prosp := coalesce((sys_net->r.sid->>'prosperity')::numeric, 1);
    if r.btype='factory' then
      v_pg := coalesce((sys_net->r.sid->'prices'->>'g')::numeric, 1);
      inc_gc := inc_gc + r.slots_open*200 * v_prosp * v_pg;
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100 * v_prosp;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    elsif r.btype='temple' and (
        (r.faith_id is not null and public._faith_member(p_fid, r.faith_id))
        or (r.faith_id is null and has_faith)) then inc_gc := inc_gc + r.slots_open*150 * v_prosp;
    end if;
  end loop;

  if exists(select 1 from public.faiths where founder_fid = p_fid) then
    select coalesce(sum(cb.slots_open),0) * 150 * 0.20 into tithe_gc
    from public.faith_membership m
    join public.faiths f on f.id = m.faith_id and f.founder_fid = p_fid
    join public.colony_buildings cb on cb.faction_id = m.faction_id and cb.btype = 'temple'
      and (cb.faith_id = f.id or cb.faith_id is null)
    where m.role <> 'founder';
    inc_gc := inc_gc + coalesce(tithe_gc, 0);
  end if;

  select count(*) into v_sects from public.faith_sects where owner_fid = p_fid and status = 'active';
  if v_sects > 0 then inc_gc := inc_gc + v_sects * 150; end if;

  if d >= 1 then
    cap := 1000 + coalesce((select sum(slots_open) from public.colony_buildings
                            where faction_id=p_fid and btype='warehouse'),0) * 500;

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
        select u.res_name, u.res_rar, u.avail from (
          select distinct on (q.nm) q.nm as res_name, q.rr as res_rar,
            greatest(0, coalesce((eco.resources->>q.nm)::numeric,0)
                        + coalesce((res_add->>q.nm)::numeric,0)
                        - coalesce((res_sub->>q.nm)::numeric,0)) as avail
          from (
            select (e.value->>'name') as nm, coalesce(e.value->>'r','common') as rr
            from public.colonies c, jsonb_array_elements(c.resources) e
            where c.faction_id = p_fid
          ) q
          order by q.nm, public._res_value(q.nm, q.rr) desc
        ) u
        where u.avail > 0
        order by public._res_value(u.res_name, u.res_rar) desc
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

    -- ПРОСТР.ЭК (срез 4): накопление статуса систем по итогам дня тика
    perform public._econ_update_status(p_fid, d);
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

-- ── Проверка после применения ───────────────────────────────
-- select public.sector_event_set('<sector_uuid>','war',0.7,5);  -- сектор в войне ×0.7 на 5 дн.
-- select public.spatial_status();   -- статус систем теперь персистентный; поле spill — спилловер
-- держите систему в дефиците несколько тиков → unrest → stagnation (доход в пол)
