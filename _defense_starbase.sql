-- ============================================================
-- ОБОРОННЫЕ СТРУКТУРЫ — СЛАЙС 1: ЗВЁЗДНАЯ БАЗА + ВМЕСТИМОСТЬ ФЛОТА
-- Применять в Supabase → SQL Editor ПОСЛЕ _faith_multi.sql и _unit_market_drain.sql.
-- Идемпотентно (CREATE OR REPLACE / IF NOT EXISTS).
--
-- ИДЕЯ: у флота не «содержание», а ВМЕСТИМОСТЬ. Звёздная База даёт N мест под
-- корабли. Нельзя строить корабли сверх суммарной вместимости баз (жёсткий гейт).
-- Уже имеющийся сверхлимитный флот не трогается (grandfather) — блокируется
-- только рост, пока не построишь ещё базу/слот.
--
-- ⚠ ЗДЕСЬ ЖЕ задаются цены ВСЕХ оборонных зданий (starbase / flak / abm),
--   чтобы поздние слайсы (ПВО/ПРО) не переопределяли _ec_bld_base и не теряли
--   starbase. Логику flak/abm включает _defense_planetary.sql.
-- ============================================================

-- ── Цена оборонных зданий (надмножество _security_money.sql) ──
-- starbase — Звёздная База: 1-й слот 5000 ГС; flak — ПВО; abm — ПРО.
create or replace function public._ec_bld_base(p_btype text)
returns numeric language sql immutable as $$
  select case p_btype
    when 'factory'          then 500    when 'mining'   then 500
    when 'trade'            then 1000   when 'market'   then 1500
    when 'science'          then 1000   when 'training' then 500
    when 'intel'            then 3000   when 'military_factory' then 1000
    when 'shipyard'         then 2000   when 'warehouse' then 800
    when 'starbase'         then 5000   -- Звёздная База (вместимость флота)
    when 'flak'             then 1500   -- ПВО  (см. _defense_planetary.sql)
    when 'abm'              then 3000   -- ПРО  (см. _defense_planetary.sql)
    else null end
$$;

create or replace function public._ec_bld_free(p_btype text)
returns int language sql immutable as $$
  select case when p_btype in ('factory','mining') then 2 else 1 end
$$;

-- Цена открытия слота: p_idx = текущее slots_open (0..5) → цена СЛЕДУЮЩЕГО слота.
-- starbase дороже (каждая «верфь баз» весомая), остальное — обычная лестница.
create or replace function public._ec_bld_ladder(p_btype text, p_idx int)
returns numeric language sql immutable as $$
  select case
    when p_idx < 0 or p_idx > 5 then null
    when p_btype = 'starbase'
         then (array[0,5000,5000,8000,8000,12000])[p_idx+1]
    when p_btype in ('factory','mining')
         then (array[0,0,500,1500,1500,3000])[p_idx+1]
    else (array[0,500,500,1500,1500,3000])[p_idx+1]
  end
$$;

-- ── Вместимость флота фракции ───────────────────────────────
-- Каждый открытый слот Звёздной Базы = +STARBASE_CAP_PER_SLOT кораблей.
-- (Слайс 4 «Аванпосты» переопределит эту функцию, добавив вместимость стоянок.)
create or replace function public._defense_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'starbase_cap_per_slot' then 50      -- мест под корабли на слот базы
    else null end
$$;

create or replace function public._fleet_capacity(p_fid text)
returns int language sql stable security definer set search_path=public as $$
  select coalesce((
    select sum(slots_open) from public.colony_buildings
     where faction_id = p_fid and btype = 'starbase'
  ),0)::int * public._defense_const('starbase_cap_per_slot')::int
$$;
revoke all on function public._fleet_capacity(text) from public;
grant execute on function public._fleet_capacity(text) to authenticated;

-- Сколько кораблей фракция уже «держит» (готовые + в очереди + в ремонте + развёрнутые в соединениях).
-- ВАЖНО: fleet_form (_army_fleet.sql) снимает корабли из unit_production и складывает снимком
-- в fleets.composition. Чтобы гейт вместимости не обходился через формирование флота, считаем
-- и корабли, ушедшие в соединения. to_regclass защищает от отсутствия таблицы fleets (срез не накачен).
create or replace function public._fleet_used(p_fid text)
returns int language plpgsql stable security definer set search_path=public as $$
declare v_prod int; v_fleet int := 0;
begin
  select coalesce(sum(qty),0)::int into v_prod from public.unit_production
   where faction_id = p_fid and category = 'ship'
     and status in ('done','queued','damaged');
  if to_regclass('public.fleets') is not null then
    select coalesce(sum((c->>'qty')::int),0)::int into v_fleet
      from public.fleets f, jsonb_array_elements(f.composition) c
     where f.faction_id = p_fid;
  end if;
  return v_prod + coalesce(v_fleet,0);
end$$;
revoke all on function public._fleet_used(text) from public;
grant execute on function public._fleet_used(text) to authenticated;

-- Сводка вместимости для UI.
create or replace function public.fleet_capacity_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'cap',  public._fleet_capacity(fid),
    'used', public._fleet_used(fid),
    'bases', coalesce((select sum(slots_open) from public.colony_buildings
                       where faction_id=fid and btype='starbase'),0),
    'per_slot', public._defense_const('starbase_cap_per_slot')
  );
end$$;
revoke all on function public.fleet_capacity_status() from public;
grant execute on function public.fleet_capacity_status() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  economy_produce — НАДМНОЖЕСТВО версии из _unit_market_drain.sql + ГЕЙТ ФЛОТА
--  Единственное отличие: при cat='ship' проверяем вместимость Звёздных Баз.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.economy_produce(p_unit_id uuid, p_qty int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; u public.faction_units; qty int;
  base_cost numeric; surcharge numeric := 0; total numeric;
  cat text; ln text; w int; rdy timestamptz;
  bill jsonb; res jsonb; spent jsonb := '{}'::jsonb; bought jsonb := '{}'::jsonb;
  rkey text; rneed numeric; rhave numeric; rcons numeric; rshort numeric;
  mr public.market_resources;
  v_cap int; v_have int;        -- ГЕЙТ ВМЕСТИМОСТИ ФЛОТА (слайс «Звёздная База»)
begin
  fid := public._ec_my_fid();
  qty := greatest(1, coalesce(p_qty, 1));
  select * into u from public.faction_units where id = p_unit_id;
  if not found then raise exception 'unit design not found'; end if;
  -- свои ИЛИ общедоступные (faction_id null); чужие фракционные — нельзя
  if u.faction_id is not null and u.faction_id is distinct from fid then raise exception 'not your design'; end if;

  if u.category = 'division' then cat:='division'; ln:='army';     w:=0;
  elsif u.category = 'ship'   then cat:='ship';     ln:='shipyard'; w:=1;
  else raise exception 'this category is not produced here'; end if;

  -- ⚓ ГЕЙТ ВМЕСТИМОСТИ ФЛОТА: корабли нельзя строить сверх вместимости Звёздных Баз.
  -- Уже имеющийся сверхлимит не трогаем — просто блокируем дальнейший рост.
  if cat = 'ship' then
    v_cap  := public._fleet_capacity(fid);
    v_have := public._fleet_used(fid);
    if v_have + qty > v_cap then
      raise exception 'Превышена вместимость флота: занято %, мест всего % (≈% кораблей/слот). Постройте Звёздную Базу или откройте её слот, затем повторите. Запрошено ещё %.',
        v_have, v_cap, public._defense_const('starbase_cap_per_slot'), qty;
    end if;
  end if;

  base_cost := coalesce((u.summary->>'cost')::numeric, 0) * qty;
  bill := coalesce(u.summary->'bill', '{}'::jsonb);

  -- запираем строку экономики на время расчёта (анти-гонка двойной закладки)
  select coalesce(resources, '{}'::jsonb) into res
    from public.faction_economy where faction_id = fid for update;
  if res is null then raise exception 'no economy'; end if;

  -- по каждому ресурсу: тратим со склада сколько есть, дефицит ДОКУПАЕМ С РЫНКА ×1.5
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
      mr := public._market_ensure(rkey);   -- блокирует строку рынка (FOR UPDATE)
      if mr.stock < rshort then
        raise exception 'Не хватает «%» на рынке: нужно докупить % ед., в продаже % ед. Дождитесь обновления рынка или закупки у других держав.',
          rkey, floor(rshort), floor(mr.stock);
      end if;
      surcharge := surcharge + rshort * mr.price * 1.5;
      bought    := jsonb_set(bought, array[rkey], to_jsonb(rshort), true);
      update public.market_resources
         set stock = greatest(1, stock - rshort),
             price = public._market_price_calc(base_price, greatest(1, stock - rshort), equilibrium),
             updated_at = now()
       where name = rkey;
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
    (faction_id, owner_id, unit_id, unit_name, category, line, weight, qty, status, ready_at, res_spent, res_surcharge, res_market)
  values
    (fid, auth.uid(), u.id, u.name, cat, ln, w, qty, 'queued', rdy, spent, surcharge, bought);

  return jsonb_build_object('ok', true, 'cost', total, 'gc_base', base_cost,
    'surcharge', surcharge, 'res_spent', spent, 'res_market', bought, 'qty', qty, 'ready_at', rdy);
end$$;
revoke all on function public.economy_produce(uuid,int) from public;
grant execute on function public.economy_produce(uuid,int) to authenticated;
