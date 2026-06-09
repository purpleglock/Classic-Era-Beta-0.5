-- ════════════════════════════════════════════════════════════════════════
--  МИГРАЦИЯ: Добывающий завод — только РЕСУРСЫ, без ГС
--  Раньше mining давал 50 ГС/слот + ресурсы (выбор «ГС или ресурс» оказался
--  неудачным). Теперь mining НЕ приносит ГС вообще — только добыча ресурсов
--  по назначенным месторождениям (mining_targets).
--
--  Запускать ОТДЕЛЬНО в SQL-редакторе. Заменяет только economy_accrue —
--  её зависимости (_faction_mods, _apply_colony_projects, _spy_resolve,
--  _res_price) уже есть в базе. Применять ПОСЛЕ _migration_mining_factory_income.sql
--  (эта версия новее и перекрывает прежнюю формулу).
-- ════════════════════════════════════════════════════════════════════════

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
begin
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then return jsonb_build_object('faction_id',p_fid,'days',0); end if;

  mods := public._faction_mods(p_fid);          -- доктрина государства
  m_mine := (mods->>'mine')::numeric;
  m_gc   := (mods->>'gc')::numeric;
  -- дебафф дестабилизации (вражеская операция) — режет ГС-доход, пока активен
  if eco.debuff_until is not null and eco.debuff_until > now() then
    m_gc := m_gc * (1 - coalesce(eco.debuff_pct,0));
  end if;

  update public.unit_production set status='done' where faction_id=p_fid and status='queued' and ready_at<=now();

  -- завершённые проекты колоний (слоты/терраформ/обустройство среды)
  perform public._apply_colony_projects(p_fid);
  -- готовые тайные операции (разрешение успеха/раскрытия, эффекты, возврат агентов)
  perform public._spy_resolve(p_fid);

  if eco.research_active is not null and eco.research_ready is not null and eco.research_ready <= now() then
    update public.faction_economy
      set research = coalesce(research,'[]'::jsonb) || to_jsonb(eco.research_active::text),
          research_active = null, research_ready = null
      where faction_id = p_fid;
    select * into eco from public.faction_economy where faction_id = p_fid;
  end if;

  d := floor(extract(epoch from (now()-eco.last_tick))/86400.0);

  for r in select btype, slots_open from public.colony_buildings where faction_id=p_fid loop
    if r.btype='factory' then inc_gc := inc_gc + r.slots_open*200;
    -- mining: ГС НЕ даёт — только ресурсы (добыча по mining_targets ниже)
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    end if;
  end loop;

  -- Доктрина применяется к НАКОПЛЕНИЮ за весь период (base*mult*d), а не поштучно
  -- за день — иначе бонусы к малым показателям (наука/агенты) съедало округление.

  if d >= 1 then
    -- добыча: каждая ЯЧЕЙКА mining_targets добывает свой ресурс; повторы суммируются
    for bld in
      select cb.mining_targets, c.resources as cres
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
        rate := case rr when 'uncommon' then 12 when 'rare' then 5 when 'epic' then 2 when 'legendary' then 1 else 25 end;
        rate := greatest(1, round(rate * m_mine));   -- доктрина: множитель добычи
        res_add := jsonb_set(res_add, array[rname], to_jsonb(coalesce((res_add->>rname)::numeric,0) + rate*d), true);
      end loop;
    end loop;

    for r in select volume, resource, price, convoy, threats, b_fid from public.trade_routes where status='active' and a_fid=p_fid loop
      escorted := coalesce(r.convoy,0) > 0; attacked := false;
      for thr in select value from jsonb_array_elements(coalesce(r.threats,'[]'::jsonb)) loop
        if (thr->>'type') = 'ancient' then chance := case when escorted then 0.65 else 0.80 end;
        else chance := case when escorted then 0.40 else 0.80 end; end if;
        if random() < chance then attacked := true; end if;
      end loop;
      if attacked then pirate := true; continue; end if;
      avail := coalesce((eco.resources->>r.resource)::numeric,0) + coalesce((res_add->>r.resource)::numeric,0) - coalesce((res_sub->>r.resource)::numeric,0);
      shipped := least(coalesce(r.volume,0)*d, avail);
      if shipped <= 0 then continue; end if;
      res_sub := jsonb_set(res_sub, array[r.resource], to_jsonb(coalesce((res_sub->>r.resource)::numeric,0)+shipped), true);
      trade_gc := trade_gc + shipped * coalesce(r.price,0);
      update public.faction_economy set gc = gc + round(shipped*coalesce(r.price,0)*0.33) where faction_id = r.b_fid;
    end loop;
    trade_gc := round(trade_gc * m_gc);   -- доктрина: торговля — часть ГС-экономики

    -- ── товарная биржа: пассивная продажа накопленных ресурсов за ГС (≈50% цены),
    --    без торговых путей. 1 слот = до 25 ед./сут., дорогие ресурсы продаются первыми.
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
          order by nm, public._res_price(rr) desc
        ) u
        where avail > 0
        order by public._res_price(res_rar) desc
      loop
        exit when market_cap <= 0;
        sell := least(r.avail, market_cap);
        res_sub := jsonb_set(res_sub, array[r.res_name],
                     to_jsonb(coalesce((res_sub->>r.res_name)::numeric,0) + sell), true);
        market_gc := market_gc + sell * public._res_price(r.res_rar) * 0.5;
        market_cap := market_cap - sell;
      end loop;
      market_gc := round(market_gc * m_gc);   -- доктрина: рыночный сбыт — часть ГС-экономики
    end if;

    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_add) loop
      merged := jsonb_set(merged, array[k], to_jsonb(coalesce((merged->>k)::numeric,0) + (res_add->>k)::numeric), true);
    end loop;
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric)), true);
    end loop;

    -- наука/агенты — ПЛОСКИЙ бонус доктрины (+N в сутки), не процент (дискретны);
    -- за день не уходит в минус (greatest 0).
    update public.faction_economy
      set gc = gc + round(inc_gc * m_gc * d) + trade_gc + market_gc,
          science = science + greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
          agents  = agents  + greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
          resources = merged,
          last_tick = last_tick + (d || ' days')::interval
      where faction_id=p_fid returning * into eco;
  end if;

  return jsonb_build_object('faction_id',eco.faction_id,'gc',eco.gc,'science',eco.science,'agents',eco.agents,
    'resources',eco.resources,'last_tick',eco.last_tick,'days',d, 'mods', mods,
    'income', jsonb_build_object(
      'gc',     round(inc_gc * m_gc),
      'science',greatest(0, inc_sci    + (mods->>'sci_flat')::numeric),
      'agents', greatest(0, inc_agents + (mods->>'agents_flat')::numeric),
      'trade',  trade_gc, 'market', market_gc, 'pirate', pirate));
end$$;
