-- ============================================================
-- ПИРАТСТВО — ФАЗА 1, СРЕЗ 2: БОЙ · ДОБЫЧА · РАЗРЕШЕНИЕ
-- Применять в Supabase → SQL Editor ПОСЛЕ _raid_setup.sql. Идемпотентно.
--
-- Двусторонний бой считает сервер на тике (в economy_accrue, рядом с _spy_resolve).
-- Добыча = ресурсы + ГС (с guard'ами). Потери кораблей с обеих сторон. Раскрытие →
-- отношения− + новость. Сила от ЧИСЛА кораблей (не ТТХ — клиентские).
-- ============================================================

-- ── helper: уничтожить N кораблей из ростера фракции ────────
create or replace function public._destroy_ships(p_fid text, p_n int)
returns void language plpgsql security definer set search_path=public as $$
declare rem int; r record; take int;
begin
  rem := greatest(0, coalesce(p_n,0));
  if rem <= 0 then return; end if;
  for r in select id, qty from public.unit_production
           where faction_id=p_fid and category='ship' and status='done' and qty>0
           order by created_at asc loop
    exit when rem <= 0;
    take := least(rem, r.qty);
    if take >= r.qty then delete from public.unit_production where id=r.id;
    else update public.unit_production set qty=qty-take where id=r.id; end if;
    rem := rem - take;
  end loop;
end$$;
revoke all on function public._destroy_ships(text,int) from public;

-- ── Разрешение готовых рейдов фракции-актора ────────────────
create or replace function public._raid_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare m record; rt public.trade_routes; tgt public.faction_economy;
  A numeric; D numeric; T numeric; s numeric; k numeric;
  att_losses int; def_losses int; loot_frac numeric;
  v_res text; v_price numeric; stock numeric; cargo numeric;
  loot_units numeric; loot_gc numeric; took_units numeric; took_gc numeric;
  det_chance int; v_detected boolean; conv int; pat int;
begin
  for m in select * from public.raid_missions
           where actor_fid=p_fid and status='active' and ready_at <= now()
           for update loop

    select * into rt from public.trade_routes where id=m.route_id;
    -- караван ушёл/закрылся до подхода флота → рейд впустую, корабли возвращаются
    if rt.id is null or rt.status <> 'active' then
      update public.raid_missions set status='done', detected=false,
        outcome = jsonb_build_object('result','no_target') where id=m.id;
      continue;
    end if;

    select * into tgt from public.faction_economy where faction_id=m.target_fid;
    conv := coalesce(rt.convoy,0);
    pat  := coalesce(tgt.patrol_ships,0);

    -- двусторонний бой по соотношению сил
    A := m.ships * 10;
    D := conv * 12 + pat * 9;
    T := greatest(1, A + D);
    s := A / T;                                  -- перевес пирата 0..1
    k := 0.5 * (0.8 + random()*0.4);             -- летальность ±20%
    att_losses := round(m.ships * (1 - s) * k);
    def_losses := round(conv     *    s  * k);
    loot_frac  := greatest(0, least(0.7, (s - 0.5) * 1.4));

    took_units := 0; took_gc := 0;
    -- ── ДОБЫЧА (ресурсы + ГС), только при перевесе ──
    if loot_frac > 0 and tgt.faction_id is not null then
      v_res := rt.resource; v_price := coalesce(rt.price,0);
      stock := coalesce((tgt.resources->>v_res)::numeric, 0);
      cargo := least(coalesce(rt.volume,0), stock);      -- угнать можно только реально везомое
      loot_units := floor(cargo * loot_frac);
      loot_gc    := floor(loot_units * v_price * 0.5);   -- ГС-надбавка за разбой
      -- ресурсы (атомарно, с guard)
      if loot_units > 0 then
        update public.faction_economy
          set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[v_res],
              to_jsonb(coalesce((resources->>v_res)::numeric,0) - loot_units), true)
          where faction_id=m.target_fid and coalesce((resources->>v_res)::numeric,0) >= loot_units;
        if found then
          update public.faction_economy
            set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[v_res],
                to_jsonb(coalesce((resources->>v_res)::numeric,0) + loot_units), true)
            where faction_id=m.actor_fid;
          took_units := loot_units;
        end if;
      end if;
      -- ГС (с guard)
      took_gc := least(floor(loot_gc), greatest(0, floor(coalesce(tgt.gc,0))));
      if took_gc > 0 then
        update public.faction_economy set gc = gc - took_gc where faction_id=m.target_fid and gc >= took_gc;
        if found then update public.faction_economy set gc = gc + took_gc where faction_id=m.actor_fid;
        else took_gc := 0; end if;
      end if;
    end if;

    -- ── ПОТЕРИ кораблей с обеих сторон ──
    if att_losses > 0 then perform public._destroy_ships(m.actor_fid, att_losses); end if;
    if def_losses > 0 then
      perform public._destroy_ships(m.target_fid, def_losses);
      update public.trade_routes set convoy = greatest(0, coalesce(convoy,0) - def_losses) where id=m.route_id;
    end if;

    -- ── РАСКРЫТИЕ (бой с эскортом — громче) ──
    det_chance := case when D > 0 then 70 else 30 end;
    v_detected := (random()*100) < det_chance;
    if v_detected then
      insert into public.faction_relations(from_fid, to_fid, score, updated_at)
        values(m.target_fid, m.actor_fid, -15, now())
        on conflict (from_fid, to_fid)
        do update set score = greatest(-100, public.faction_relations.score - 15), updated_at=now();
    end if;

    -- ── НОВОСТЬ цели (атакующий назван только при раскрытии) ──
    insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
        title, excerpt, body, status, published_at, created_at, updated_at)
      values(m.target_fid, '🏴‍☠ ПИРАТСТВО', 'rgba(200,80,80,0.55)', null, null,
        'Караван разграблен', null,
        format('Караван фракции «%s» атакован %s. Угнано %s ед. груза%s. Потери эскорта: %s кораблей.',
          public._fac_name(m.target_fid),
          case when v_detected then 'флотом «'||public._fac_name(m.actor_fid)||'»' else 'неизвестными пиратами' end,
          took_units::text,
          case when took_gc>0 then ' и '||took_gc::text||' ГС' else '' end,
          def_losses::text),
        'approved', now(), now(), now());

    -- ── ФИКСИРУЕМ исход, закрываем рейд ──
    update public.raid_missions
      set status='done', detected=v_detected,
          outcome = jsonb_build_object('ships',m.ships,'att_losses',att_losses,'def_losses',def_losses,
                    'loot_units',took_units,'loot_gc',took_gc,'resource',rt.resource,
                    'loot_frac',round(loot_frac,2),'detected',v_detected)
      where id=m.id;
  end loop;
end$$;
revoke all on function public._raid_resolve(text) from public;

-- ════════════════════════════════════════════════════════════
-- economy_accrue — ТОЧНО твоя живая версия + ОДНА строка:
--   perform public._raid_resolve(p_fid);   (рядом с _spy_resolve)
-- Логика дохода не изменена.
-- ════════════════════════════════════════════════════════════
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

  mods := public._faction_mods(p_fid);
  m_mine := (mods->>'mine')::numeric;
  m_gc   := (mods->>'gc')::numeric;
  if eco.debuff_until is not null and eco.debuff_until > now() then
    m_gc := m_gc * (1 - coalesce(eco.debuff_pct,0));
  end if;

  update public.unit_production set status='done' where faction_id=p_fid and status='queued' and ready_at<=now();

  perform public._apply_colony_projects(p_fid);
  perform public._spy_resolve(p_fid);
  perform public._raid_resolve(p_fid);   -- ◄ ПИРАТСТВО: разрешаем готовые рейды этой фракции

  if eco.research_active is not null and eco.research_ready is not null and eco.research_ready <= now() then
    update public.faction_economy
      set research = coalesce(research,'[]'::jsonb) || to_jsonb(eco.research_active::text),
          research_active = null, research_ready = null
      where faction_id = p_fid;
    select * into eco from public.faction_economy where faction_id = p_fid;
  end if;
  if eco.research_active2 is not null and eco.research_ready2 is not null and eco.research_ready2 <= now() then
    update public.faction_economy
      set research = coalesce(research,'[]'::jsonb) || to_jsonb(eco.research_active2::text),
          research_active2 = null, research_ready2 = null
      where faction_id = p_fid;
    select * into eco from public.faction_economy where faction_id = p_fid;
  end if;

  d := floor(extract(epoch from (now()-eco.last_tick))/86400.0);

  for r in select btype, slots_open from public.colony_buildings where faction_id=p_fid loop
    if r.btype='factory' then inc_gc := inc_gc + r.slots_open*200;
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    end if;
  end loop;

  if d >= 1 then
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
        rate := case rr when 'uncommon' then 12 when 'rare' then 6 when 'epic' then 3 when 'legendary' then 1 else 25 end;
        rate := greatest(1, round(rate * m_mine));
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
      update public.faction_economy set gc = gc + round(shipped*coalesce(r.price,0)*0.5) where faction_id = r.b_fid;
    end loop;
    trade_gc := round(trade_gc * m_gc);

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
      merged := jsonb_set(merged, array[k], to_jsonb(coalesce((merged->>k)::numeric,0) + (res_add->>k)::numeric), true);
    end loop;
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric)), true);
    end loop;

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
revoke all on function public.economy_accrue(text) from public;     -- внутренняя

-- ── Проверка ────────────────────────────────────────────────
-- После применения рейды (raid_launch) будут разрешаться на тике автора:
-- бой считается, добыча/потери применяются, в raid_missions.outcome — результат,
-- жертве приходит новость. Доход начисляется как раньше (логика не тронута).
