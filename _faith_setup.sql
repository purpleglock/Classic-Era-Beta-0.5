-- ============================================================
-- ВЕРА (РЕЛИГИЯ) · СЛАЙС 1: ФУНДАМЕНТ
-- Применять в Supabase → SQL Editor. Идемпотентно.
-- ВАЖНО: применять ПОСЛЕ _research_queue.sql и _unit_resources.sql и
-- _security_money.sql — этот файл пересоздаёт их функции economy_accrue /
-- economy_produce / economy_build / _ec_bld_base как строгие надмножества
-- (добавлена только механика веры). Если позже примените новый слайс,
-- пересоздающий economy_accrue/economy_produce — продублируйте в нём строки,
-- помеченные «-- ВЕРА:».
--
-- Идея (аналог торговли): спиритуалист/теократ ОСНОВЫВАЕТ веру → исповедующие
-- строят ХРАМЫ (btype='temple') → каждый слот храма даёт +деньги и удешевляет
-- постройку войск (армий). Распространение веры на чужие территории, десятина
-- основателю, федерация веры и тайные операции «насаждения» — слайсы 2-4.
--
-- Кто может основать: идеология «Спиритуализм» ИЛИ форма правления «Теократия»
-- ИЛИ админ (superadmin/editor/moderator — от лица НПС).
-- Запись только через SECURITY DEFINER RPC; чтение публичное (вера открыта миру).
-- Переменная фракции названа v_fid (НЕ fid) — во избежание конфликта с колонками.
-- ============================================================

-- ── 1) ДАННЫЕ ───────────────────────────────────────────────
create table if not exists public.faiths (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  founder_fid text not null,
  founder_owner uuid,
  dogma text,                       -- лор/догма веры (свободный текст)
  color text default '#c9a227',
  open boolean default true,        -- открыта ли для свободного вступления единоверцев
  created_at timestamptz default now()
);
create table if not exists public.faith_membership (
  faction_id text primary key,      -- одна фракция исповедует одну веру
  faith_id uuid not null references public.faiths(id) on delete cascade,
  role text not null default 'member' check (role in ('founder','member')),
  owner_id uuid,
  joined_at timestamptz default now()
);
create index if not exists fm_faith_idx on public.faith_membership(faith_id);

alter table public.faiths           enable row level security;
alter table public.faith_membership enable row level security;
drop policy if exists "faith_sel" on public.faiths;
create policy "faith_sel" on public.faiths for select to authenticated using (true);
drop policy if exists "fmem_sel" on public.faith_membership;
create policy "fmem_sel" on public.faith_membership for select to authenticated using (true);

-- ── 2) ХЕЛПЕРЫ ──────────────────────────────────────────────
-- Может ли фракция основать/принять веру: спиритуалист, теократ или админ.
create or replace function public._faith_can_found(p_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((
    select a.ideology = 'Спиритуализм' or a.gov = 'Теократия'
    from public.faction_applications a
    where a.faction_id = p_fid and a.status = 'approved'
    order by a.updated_at desc limit 1
  ), false)
  or public.current_user_role() in ('superadmin','editor','moderator')
$$;

-- Вера, которую исповедует фракция (или NULL).
create or replace function public._faith_of(p_fid text)
returns uuid language sql stable security definer set search_path=public as $$
  select faith_id from public.faith_membership where faction_id = p_fid
$$;

-- «Сила веры» фракции = суммарное число слотов её храмов.
create or replace function public._faith_strength(p_fid text)
returns int language sql stable security definer set search_path=public as $$
  select coalesce(sum(slots_open),0)::int
  from public.colony_buildings where faction_id = p_fid and btype = 'temple'
$$;

-- Скидка на постройку войск от веры: 0..0.30. Спиритуалисты/теократы — сильнее.
-- Только если фракция реально исповедует веру (есть членство).
create or replace function public._faith_unit_discount(p_fid text)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare s int; spirit boolean;
begin
  if not exists(select 1 from public.faith_membership where faction_id = p_fid) then
    return 0;
  end if;
  s := public._faith_strength(p_fid);
  if s <= 0 then return 0; end if;
  select coalesce((
    select a.ideology = 'Спиритуализм' or a.gov = 'Теократия'
    from public.faction_applications a
    where a.faction_id = p_fid and a.status = 'approved'
    order by a.updated_at desc limit 1), false) into spirit;
  if spirit then return least(0.30, s * 0.02);
  else            return least(0.18, s * 0.012);
  end if;
end$$;

-- ── 3) RPC: ЖИЗНЕННЫЙ ЦИКЛ ВЕРЫ ─────────────────────────────
-- Основать веру. Основатель = текущая фракция, роль 'founder'.
create or replace function public.faith_found(p_name text, p_dogma text default null, p_color text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_uid uuid; new_id uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid(); v_uid := auth.uid();
  if not public._faith_can_found(v_fid) then
    raise exception 'only spiritualists, theocracies or admins may found a faith';
  end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'name required'; end if;
  if exists(select 1 from public.faith_membership where faction_id = v_fid) then
    raise exception 'already follow a faith — leave it first';
  end if;
  if exists(select 1 from public.faiths where lower(name) = lower(btrim(p_name))) then
    raise exception 'faith name already taken';
  end if;
  insert into public.faiths(name, founder_fid, founder_owner, dogma, color)
    values(btrim(p_name), v_fid, v_uid, nullif(btrim(coalesce(p_dogma,'')),''),
           coalesce(nullif(btrim(coalesce(p_color,'')),''),'#c9a227'))
    returning id into new_id;
  insert into public.faith_membership(faction_id, faith_id, role, owner_id)
    values(v_fid, new_id, 'founder', v_uid);
  return jsonb_build_object('ok', true, 'faith_id', new_id);
end$$;
revoke all on function public.faith_found(text,text,text) from public;
grant execute on function public.faith_found(text,text,text) to authenticated;

-- Принять веру (вступить в открытую). Слайс 1: только единоверцы (спирит/теократ).
-- Признание чужой веры для прочих фракций — слайс 2 (тайные операции/дипломатия).
create or replace function public.faith_join(p_faith_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_uid uuid; f public.faiths;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid(); v_uid := auth.uid();
  if not public._faith_can_found(v_fid) then
    raise exception 'only spiritualists or theocracies may adopt a faith (recognition comes later)';
  end if;
  if exists(select 1 from public.faith_membership where faction_id = v_fid) then
    raise exception 'already follow a faith — leave it first';
  end if;
  select * into f from public.faiths where id = p_faith_id;
  if not found then raise exception 'faith not found'; end if;
  if not f.open then raise exception 'this faith is closed for new adepts'; end if;
  insert into public.faith_membership(faction_id, faith_id, role, owner_id)
    values(v_fid, p_faith_id, 'member', v_uid);
  return jsonb_build_object('ok', true, 'faith_id', p_faith_id);
end$$;
revoke all on function public.faith_join(uuid) from public;
grant execute on function public.faith_join(uuid) to authenticated;

-- Покинуть веру. Основатель может уйти только если он последний — тогда вера распускается.
create or replace function public.faith_leave()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; m public.faith_membership; others int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  select * into m from public.faith_membership where faction_id = v_fid;
  if not found then raise exception 'you follow no faith'; end if;
  if m.role = 'founder' then
    select count(*) into others from public.faith_membership
      where faith_id = m.faith_id and faction_id <> v_fid;
    if others > 0 then
      raise exception 'founder cannot abandon a faith with other adepts (transfer comes later)';
    end if;
    delete from public.faiths where id = m.faith_id;          -- каскадом снимет членство
    return jsonb_build_object('ok', true, 'dissolved', true);
  end if;
  delete from public.faith_membership where faction_id = v_fid;
  return jsonb_build_object('ok', true, 'dissolved', false);
end$$;
revoke all on function public.faith_leave() from public;
grant execute on function public.faith_leave() to authenticated;

-- ── 4) RPC: ЧТЕНИЕ ДЛЯ UI ───────────────────────────────────
-- Список вер с числом адептов и суммарной паствой (слоты храмов).
create or replace function public.faith_list()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(row order by created_at), '[]'::jsonb) from (
    select f.id, f.name, f.founder_fid, f.dogma, f.color, f.open, f.created_at,
      (select count(*) from public.faith_membership m where m.faith_id = f.id) as adepts,
      coalesce((select sum(cb.slots_open) from public.faith_membership m
        join public.colony_buildings cb on cb.faction_id = m.faction_id and cb.btype = 'temple'
        where m.faith_id = f.id), 0) as flock
    from public.faiths f
  ) row
$$;
revoke all on function public.faith_list() from public;
grant execute on function public.faith_list() to authenticated;

-- Статус веры текущей фракции: вера, роль, сила, скидка, доход/слот, право основать.
create or replace function public.faith_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_fid text; m public.faith_membership; f public.faiths;
  s int; disc numeric;
begin
  v_fid := public._ec_my_fid();
  s    := public._faith_strength(v_fid);
  disc := public._faith_unit_discount(v_fid);
  select * into m from public.faith_membership where faction_id = v_fid;
  if not found then
    return jsonb_build_object('faith', null, 'can_found', public._faith_can_found(v_fid),
      'strength', s, 'unit_discount', disc, 'temple_income', 150);
  end if;
  select * into f from public.faiths where id = m.faith_id;
  return jsonb_build_object(
    'faith', jsonb_build_object('id', f.id, 'name', f.name, 'dogma', f.dogma,
       'color', f.color, 'open', f.open, 'founder_fid', f.founder_fid),
    'role', m.role,
    'can_found', public._faith_can_found(v_fid),
    'strength', s,
    'unit_discount', disc,
    'temple_income', 150,
    'adepts', (select coalesce(jsonb_agg(jsonb_build_object(
                 'fid', mm.faction_id, 'role', mm.role,
                 'flock', public._faith_strength(mm.faction_id)) order by mm.joined_at), '[]'::jsonb)
               from public.faith_membership mm where mm.faith_id = f.id));
end$$;
revoke all on function public.faith_status() from public;
grant execute on function public.faith_status() to authenticated;

-- ── 5) ХРАМ КАК ПОСТРОЙКА ───────────────────────────────────
-- Цена храма = 1200 ГС (между торговлей и рынком). Доступен только исповедующим.
-- Зеркало EC_BUILD в economy.js — добавьте туда 'temple' аналогично.
create or replace function public._ec_bld_base(p_btype text)
returns numeric language sql immutable as $$
  select case p_btype
    when 'factory'          then 500    when 'mining'   then 500
    when 'trade'            then 1000   when 'market'   then 1500
    when 'science'          then 1000   when 'training' then 500
    when 'intel'            then 3000   when 'military_factory' then 1000
    when 'shipyard'         then 2000   when 'warehouse' then 800
    when 'temple'           then 1200   -- ВЕРА: храм
    else null end
$$;

-- economy_build с гейтом: храм требует исповедуемой веры.
create or replace function public.economy_build(p_colony_id uuid, p_btype text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies; base numeric; cost numeric;
  used int; pending int;
begin
  fid := public._ec_my_fid();
  if public._ec_bld_base(p_btype) is null then raise exception 'bad btype'; end if;
  -- ВЕРА: храм можно строить только исповедуя веру
  if p_btype = 'temple' and not exists(select 1 from public.faith_membership where faction_id = fid) then
    raise exception 'no faith: found or join a faith before building a temple';
  end if;
  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if col.faction_id is distinct from fid then raise exception 'not your colony'; end if;

  select count(*) into used    from public.colony_buildings where colony_id = p_colony_id;
  select count(*) into pending from public.colony_projects
    where colony_id = p_colony_id and kind = 'build';
  if used + pending >= coalesce(col.cells, 6) then raise exception 'no free cells'; end if;

  base := public._ec_bld_base(p_btype);
  cost := public._ec_build_cost(fid, base);

  update public.faction_economy set gc = gc - cost
    where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects
    (faction_id, owner_id, kind, btype, colony_id, payload, label, ready_at)
  values
    (fid, auth.uid(), 'build', p_btype, p_colony_id,
     jsonb_build_object('spent_gc', cost, 'spent_science', 0, 'btype', p_btype,
                        'free_slots', public._ec_bld_free(p_btype)),
     'Постройка', now() + interval '1 day');

  return jsonb_build_object('ok', true, 'cost', cost);
end$$;
revoke all on function public.economy_build(uuid,text) from public;
grant execute on function public.economy_build(uuid,text) to authenticated;

-- ── 6) ДОХОД ХРАМОВ (пересоздание economy_accrue) ───────────
-- База: _research_queue.sql. Добавлено только то, что помечено «-- ВЕРА:».
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

  if d >= 1 then
    cap := 1000 + coalesce((select sum(slots_open) from public.colony_buildings
                            where faction_id=p_fid and btype='warehouse'),0) * 500;

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

-- ── 7) СКИДКА НА ВОЙСКА (пересоздание economy_produce) ───────
-- База: _unit_resources.sql. Добавлено только то, что помечено «-- ВЕРА:».
create or replace function public.economy_produce(p_unit_id uuid, p_qty int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; u public.faction_units; qty int;
  base_cost numeric; surcharge numeric := 0; total numeric;
  cat text; ln text; w int; rdy timestamptz;
  bill jsonb; res jsonb; spent jsonb := '{}'::jsonb;
  rkey text; rneed numeric; rhave numeric; rcons numeric; rshort numeric;
  disc numeric;                                     -- ВЕРА
begin
  fid := public._ec_my_fid();
  qty := greatest(1, coalesce(p_qty, 1));
  select * into u from public.faction_units where id = p_unit_id;
  if not found then raise exception 'unit design not found'; end if;
  if u.faction_id is not null and u.faction_id is distinct from fid then raise exception 'not your design'; end if;

  if u.category = 'division' then cat:='division'; ln:='army';     w:=0;
  elsif u.category = 'ship'   then cat:='ship';     ln:='shipyard'; w:=1;
  else raise exception 'this category is not produced here'; end if;

  base_cost := coalesce((u.summary->>'cost')::numeric, 0) * qty;
  -- ВЕРА: храмы удешевляют постройку войск (армии — полностью, флот — вполовину)
  disc := public._faith_unit_discount(fid);
  if disc > 0 then
    base_cost := round(base_cost * (1 - disc * (case when cat='ship' then 0.5 else 1 end)));
  end if;
  bill := coalesce(u.summary->'bill', '{}'::jsonb);

  select coalesce(resources, '{}'::jsonb) into res
    from public.faction_economy where faction_id = fid for update;
  if res is null then raise exception 'no economy'; end if;

  for rkey, rneed in select key, (value)::numeric * qty from jsonb_each_text(bill) loop
    if rneed is null or rneed <= 0 then continue; end if;
    rhave  := coalesce((res->>rkey)::numeric, 0);
    rcons  := least(rhave, rneed);
    rshort := rneed - rcons;
    if rcons > 0 then
      res   := jsonb_set(res,   array[rkey], to_jsonb(rhave - rcons), true);
      spent := jsonb_set(spent, array[rkey], to_jsonb(rcons), true);
    end if;
    if rshort > 0 then
      surcharge := surcharge + rshort * public._res_value(rkey) * 1.5;
    end if;
  end loop;
  surcharge := ceil(surcharge);
  total := base_cost + surcharge;

  select coalesce(last_tick, now()) + interval '1 day' into rdy
    from public.faction_economy where faction_id = fid;
  if rdy is null then rdy := now() + interval '1 day'; end if;

  update public.faction_economy
     set gc = gc - total, resources = res
   where faction_id = fid and gc >= total;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.unit_production
    (faction_id, owner_id, unit_id, unit_name, category, line, weight, qty, status, ready_at, res_spent, res_surcharge)
  values
    (fid, auth.uid(), u.id, u.name, cat, ln, w, qty, 'queued', rdy, spent, surcharge);

  return jsonb_build_object('ok', true, 'cost', total, 'gc_base', base_cost,
    'surcharge', surcharge, 'res_spent', spent, 'qty', qty, 'ready_at', rdy);
end$$;
revoke all on function public.economy_produce(uuid,int) from public;
grant execute on function public.economy_produce(uuid,int) to authenticated;

-- ── Проверка после применения ───────────────────────────────
-- select public.faith_found('Культ Звёздного Огня', 'Свет ведёт нас', '#e0a000');
-- select public.faith_status();
-- select public.faith_list();
