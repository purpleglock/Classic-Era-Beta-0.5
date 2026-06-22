-- ============================================================
-- ОБОРОННЫЕ СТРУКТУРЫ — СЛАЙС 2: ВЕРФЬ ЧИНИТ ПОВРЕЖДЁННЫЕ КОРАБЛИ
-- Применять в Supabase → SQL Editor ПОСЛЕ _defense_starbase.sql и _raid_combat.sql.
-- Идемпотентно.
--
-- ИДЕЯ: бой больше не «испаряет» весь потерянный флот. Часть потерь
-- (REPAIR_FRACTION) уходит в статус 'damaged' — это ремонтопригодный корпус.
-- Корабельная Верфь чинит их за ГС и время (дешевле/проще новой постройки).
-- Ремонт идёт лениво (как содержание орудия судного дня): доходит при обращении
-- к панели/RPC ремонта. Статусы unit_production: done | queued | damaged | repairing.
-- ============================================================

-- ── Константы обороны (надмножество _defense_starbase.sql) ──
create or replace function public._defense_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'starbase_cap_per_slot' then 50      -- мест под корабли на слот базы (слайс 1)
    when 'repair_fraction'       then 0.40    -- доля боевых потерь → в ремонт
    when 'repair_cost_frac'      then 0.50    -- цена ремонта = доля стоимости постройки
    when 'repair_days'           then 1       -- срок ремонта (игровых дней)
    else null end
$$;

-- ── Вместимость флота: «занято» теперь учитывает и ремонтируемые ──
create or replace function public._fleet_used(p_fid text)
returns int language sql stable security definer set search_path=public as $$
  select coalesce(sum(qty),0)::int from public.unit_production
   where faction_id = p_fid and category = 'ship'
     and status in ('done','queued','damaged','repairing')
$$;
revoke all on function public._fleet_used(text) from public;
grant execute on function public._fleet_used(text) to authenticated;

-- ── _destroy_ships: часть потерь → ремонт, остальное уничтожено ──
-- Надмножество версии из _raid_combat.sql. p_n — сколько кораблей «выбито» из строя.
create or replace function public._destroy_ships(p_fid text, p_n int)
returns void language plpgsql security definer set search_path=public as $$
declare
  rem int; dmg_budget int; r record; take int; to_dmg int;
begin
  rem := greatest(0, coalesce(p_n,0));
  if rem <= 0 then return; end if;
  dmg_budget := floor(rem * public._defense_const('repair_fraction'))::int;   -- сколько уйдёт в ремонт
  for r in select id, unit_id, unit_name, line, weight, qty
           from public.unit_production
           where faction_id=p_fid and category='ship' and status='done' and qty>0
           order by created_at asc loop
    exit when rem <= 0;
    take   := least(rem, r.qty);
    to_dmg := least(dmg_budget, take);
    -- снимаем take кораблей из боеспособной строки
    if take >= r.qty then delete from public.unit_production where id=r.id;
    else update public.unit_production set qty=qty-take where id=r.id; end if;
    -- to_dmg из них становятся «повреждёнными» (новая строка), остальные уничтожены
    if to_dmg > 0 then
      insert into public.unit_production
        (faction_id, owner_id, unit_id, unit_name, category, line, weight, qty, status, ready_at, created_at)
      values
        (p_fid, null, r.unit_id, r.unit_name, 'ship', coalesce(r.line,'shipyard'),
         coalesce(r.weight,1), to_dmg, 'damaged', null, now());
      dmg_budget := dmg_budget - to_dmg;
    end if;
    rem := rem - take;
  end loop;
end$$;
revoke all on function public._destroy_ships(text,int) from public;

-- ── Доводка ремонта по факту времени (ленивый settle, как у doom) ──
create or replace function public._shipyard_settle(p_fid text)
returns void language sql security definer set search_path=public as $$
  update public.unit_production
     set status='done', ready_at=null
   where faction_id=p_fid and status='repairing' and ready_at is not null and ready_at<=now();
$$;
revoke all on function public._shipyard_settle(text) from public;
grant execute on function public._shipyard_settle(text) to authenticated;

-- ── Цена ремонта строки повреждённых кораблей (preview) ──
create or replace function public._repair_cost(p_unit_id uuid, p_qty int)
returns numeric language sql stable security definer set search_path=public as $$
  select greatest(1, ceil(
    coalesce((select (summary->>'cost')::numeric from public.faction_units where id=p_unit_id), 100)
    * public._defense_const('repair_cost_frac') * greatest(1, coalesce(p_qty,1))
  ))
$$;

-- ── Список повреждённых / ремонтируемых для панели ──
create or replace function public.shipyard_damaged()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text; v_slots int; v_busy int;
begin
  fid := public._ec_my_fid();
  perform public._shipyard_settle(fid);   -- сначала закрыть готовые ремонты
  select coalesce(sum(slots_open),0) into v_slots from public.colony_buildings
    where faction_id=fid and btype='shipyard';
  select coalesce(sum(qty),0) into v_busy from public.unit_production
    where faction_id=fid and category='ship' and status='repairing';
  return jsonb_build_object(
    'slots', v_slots, 'busy', v_busy, 'free', greatest(0, v_slots - v_busy),
    'damaged', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'unit_id', unit_id, 'name', unit_name, 'qty', qty,
        'cost_each', public._repair_cost(unit_id, 1)
      ) order by created_at asc)
      from public.unit_production
      where faction_id=fid and category='ship' and status='damaged' and qty>0
    ),'[]'::jsonb),
    'repairing', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'name', unit_name, 'qty', qty, 'ready_at', ready_at
      ) order by ready_at asc)
      from public.unit_production
      where faction_id=fid and category='ship' and status='repairing'
    ),'[]'::jsonb)
  );
end$$;
revoke all on function public.shipyard_damaged() from public;
grant execute on function public.shipyard_damaged() to authenticated;

-- ── RPC: запустить ремонт p_qty кораблей из повреждённой строки p_id ──
create or replace function public.shipyard_repair(p_id uuid, p_qty int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; row public.unit_production; qty int; cost numeric;
  v_slots int; v_busy int; rdy timestamptz;
begin
  fid := public._ec_my_fid();
  perform public._shipyard_settle(fid);

  select * into row from public.unit_production where id=p_id for update;
  if not found then raise exception 'damaged ship not found'; end if;
  if row.faction_id is distinct from fid then raise exception 'not your ship'; end if;
  if row.status <> 'damaged' then raise exception 'this row is not damaged'; end if;

  -- нужна Корабельная Верфь и свободная мощность ремонта (= её слоты)
  select coalesce(sum(slots_open),0) into v_slots from public.colony_buildings
    where faction_id=fid and btype='shipyard';
  if v_slots <= 0 then raise exception 'no shipyard: build a Корабельная Верфь first'; end if;
  select coalesce(sum(qty),0) into v_busy from public.unit_production
    where faction_id=fid and category='ship' and status='repairing';

  qty := greatest(1, least(coalesce(p_qty, row.qty), row.qty));
  if v_busy + qty > v_slots then
    raise exception 'Мощность Верфи занята: в ремонте %, мест всего %. Откройте слоты Верфи или дождитесь окончания ремонта.', v_busy, v_slots;
  end if;

  cost := public._repair_cost(row.unit_id, qty);

  update public.faction_economy set gc = gc - cost
    where faction_id=fid and gc >= cost;
  if not found then raise exception 'not enough GC: ремонт стоит %', cost; end if;

  select coalesce(last_tick, now()) + (public._defense_const('repair_days') || ' days')::interval
    into rdy from public.faction_economy where faction_id=fid;
  if rdy is null then rdy := now() + interval '1 day'; end if;

  -- переносим qty из 'damaged' в 'repairing'
  if qty >= row.qty then
    update public.unit_production set status='repairing', ready_at=rdy where id=row.id;
  else
    update public.unit_production set qty = row.qty - qty where id=row.id;   -- остаток остаётся повреждённым
    insert into public.unit_production
      (faction_id, owner_id, unit_id, unit_name, category, line, weight, qty, status, ready_at, created_at)
    values
      (fid, auth.uid(), row.unit_id, row.unit_name, 'ship', coalesce(row.line,'shipyard'),
       coalesce(row.weight,1), qty, 'repairing', rdy, now());
  end if;

  return jsonb_build_object('ok', true, 'cost', cost, 'qty', qty, 'ready_at', rdy);
end$$;
revoke all on function public.shipyard_repair(uuid,int) from public;
grant execute on function public.shipyard_repair(uuid,int) to authenticated;
