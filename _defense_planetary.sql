-- ============================================================
-- ОБОРОННЫЕ СТРУКТУРЫ — СЛАЙС 5: ПЛАНЕТАРНАЯ ОБОРОНА (ПВО + ПРО + БОЕЗАПАС)
-- Применять в Supabase → SQL Editor ПОСЛЕ _defense_outpost.sql.
-- (Цены зданий flak/abm заданы ещё в _defense_starbase.sql.)
-- Идемпотентно.
--
-- ПВО (flak) — пассивная защита планеты от вражеской авиации (множитель урона);
--   боезапаса не требует. Серверного боя авиации нет (бои тактические/ручные),
--   поэтому ПВО отдаётся как справочный множитель _flak_mitigation для боёвки.
-- ПРО (abm) — перехват ударов ПО ПЛАНЕТЕ; ТРЕБУЕТ снаряды. Снаряды докупаются
--   за ГС и прибывают через 1 день. Нет снарядов — удар проходит. Главный кейс —
--   перехват залпа орудия судного дня (хук в _doom_resolve, если оно установлено).
-- Боезапас хранится на самой строке здания abm в colony_buildings.
-- ============================================================

-- ── Поля боезапаса ПРО на строке здания ──
alter table public.colony_buildings add column if not exists ammo         int default 0;
alter table public.colony_buildings add column if not exists ammo_pending int default 0;
alter table public.colony_buildings add column if not exists ammo_ready   timestamptz;

-- ── Константы (надмножество _defense_outpost.sql) ──
create or replace function public._defense_const(p_key text)
returns numeric language sql immutable as $$
  -- ВНИМАНИЕ: это последний срез обороны — функция ДОЛЖНА быть суперсетом всех
  -- предыдущих (_defense_outpost.sql и др.), иначе create-or-replace затрёт ключи
  -- аванпостов/hex-мин и сломает их (напр. op_fly_h_* → NULL → arrive_at NULL,
  -- носитель застревает в полёте навсегда).
  select case p_key
    when 'starbase_cap_per_slot' then 50
    when 'repair_fraction'       then 0.40
    when 'repair_cost_frac'      then 0.50
    when 'repair_days'           then 1
    when 'mine_hex_max'          then 6
    when 'mine_hex_cost'         then 400
    when 'mine_hex_attrition'    then 0.05
    when 'mine_wear_hexes'       then 1
    when 'mine_refund_frac'      then 0.50
    when 'outpost_ship_cost'     then 2000    -- ГС за постройку корабля-носителя
    when 'outpost_build_h'       then 24      -- постройка носителя занимает сутки
    when 'outpost_cap'           then 20      -- +вместимость флота за добыв. аванпост
    when 'outpost_refund'        then 0.50    -- доля возврата при разборке/сломе
    when 'outpost_mine_gc'       then 75      -- ГС/сут с добывающего аванпоста
    when 'op_fly_h_min'          then 2       -- мин. полёт носителя (соседняя система), часов
    when 'op_fly_h_max'          then 18      -- макс. полёт носителя (край↔край карты), часов
    when 'abm_ammo_cost'         then 800     -- ГС за снаряд ПРО
    when 'abm_ammo_days'         then 1       -- срок доставки снарядов (дней)
    when 'flak_per_slot'         then 0.15    -- ПВО: −доля урона авиации за слот
    when 'flak_cap'              then 0.60    -- кап смягчения ПВО
    else null end
$$;

-- ── ПВО: справочный множитель смягчения авиаудара по колонии (для боёвки) ──
create or replace function public._flak_mitigation(p_colony_id uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select least(
    public._defense_const('flak_cap'),
    coalesce((select sum(slots_open) from public.colony_buildings
              where colony_id=p_colony_id and btype='flak'),0)
      * public._defense_const('flak_per_slot')
  )
$$;
revoke all on function public._flak_mitigation(uuid) from public;
grant execute on function public._flak_mitigation(uuid) to authenticated;

-- ── ПРО: довоз снарядов по факту времени (ленивый settle) ──
create or replace function public._abm_settle(p_fid text)
returns void language sql security definer set search_path=public as $$
  update public.colony_buildings
     set ammo = coalesce(ammo,0) + coalesce(ammo_pending,0),
         ammo_pending = 0, ammo_ready = null
   where faction_id = p_fid and btype='abm'
     and ammo_pending > 0 and ammo_ready is not null and ammo_ready <= now();
$$;
revoke all on function public._abm_settle(text) from public;
grant execute on function public._abm_settle(text) to authenticated;

-- ── RPC: докупить снаряды ПРО (доставка 1 день) ──
create or replace function public.abm_buy_ammo(p_colony_id uuid, p_qty int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; bld public.colony_buildings; qty int; cost numeric; rdy timestamptz;
begin
  fid := public._ec_my_fid();
  perform public._abm_settle(fid);
  qty := greatest(1, coalesce(p_qty,1));
  select * into bld from public.colony_buildings
    where colony_id=p_colony_id and btype='abm' and faction_id=fid
    order by created_at asc limit 1 for update;
  if not found then raise exception 'no ПРО on this colony: build a Комплекс ПРО first'; end if;

  cost := public._defense_const('abm_ammo_cost') * qty;
  update public.faction_economy set gc = gc - cost where faction_id=fid and gc >= cost;
  if not found then raise exception 'not enough GC: снаряды стоят %', cost; end if;

  select coalesce(last_tick, now()) + (public._defense_const('abm_ammo_days') || ' days')::interval
    into rdy from public.faction_economy where faction_id=fid;
  if rdy is null then rdy := now() + interval '1 day'; end if;

  update public.colony_buildings
     set ammo_pending = coalesce(ammo_pending,0) + qty, ammo_ready = rdy
   where id = bld.id;

  return jsonb_build_object('ok', true, 'cost', cost, 'qty', qty, 'ready_at', rdy);
end$$;
revoke all on function public.abm_buy_ammo(uuid,int) from public;
grant execute on function public.abm_buy_ammo(uuid,int) to authenticated;

-- ── ПРО: перехват одного удара по планете (system_id, pid) ──
-- Возвращает true, если удар перехвачен (снаряд списан). Сначала довозит снаряды.
create or replace function public._abm_intercept(p_system_id text, p_pid int)
returns boolean language plpgsql security definer set search_path=public as $$
declare row record;
begin
  select cb.id, cb.faction_id, coalesce(cb.ammo,0) as ammo
    into row
    from public.colony_buildings cb
    join public.colonies c on c.id = cb.colony_id
    where cb.btype='abm' and c.system_id=p_system_id and c.planet_pid=p_pid
    order by coalesce(cb.ammo,0) desc
    limit 1;
  if not found then return false; end if;
  perform public._abm_settle(row.faction_id);   -- довезти готовые снаряды защитника
  -- перечитать боезапас после довоза
  select coalesce(ammo,0) into row.ammo from public.colony_buildings where id=row.id;
  if row.ammo <= 0 then return false; end if;
  update public.colony_buildings set ammo = ammo - 1 where id=row.id;
  return true;
end$$;
revoke all on function public._abm_intercept(text,int) from public;
grant execute on function public._abm_intercept(text,int) to authenticated;

-- ── Сводка планетарной обороны для UI (по моим колониям) ──
create or replace function public.planet_defense_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._abm_settle(fid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'colony_id', cb.colony_id, 'building_id', cb.id, 'btype', cb.btype,
      'slots', cb.slots_open, 'ammo', coalesce(cb.ammo,0),
      'ammo_pending', coalesce(cb.ammo_pending,0), 'ammo_ready', cb.ammo_ready
    ))
    from public.colony_buildings cb
    where cb.faction_id=fid and cb.btype in ('flak','abm')
  ), '[]'::jsonb);
end$$;
revoke all on function public.planet_defense_status() from public;
grant execute on function public.planet_defense_status() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  ХУК ПРО В ОРУДИЕ СУДНОГО ДНЯ
--  Сам перехват вызывается из public._doom_resolve (файл _interstellar_artillery.sql):
--  перед «убийством» планеты он вызывает public._abm_intercept(target_system, pid)
--  через to_regprocedure+EXECUTE — поэтому порядок применения двух файлов не важен,
--  а если орудие не установлено вовсе, ПРО просто нечего перехватывать.
--  Никаких действий здесь не требуется — функция _abm_intercept уже создана выше.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ОДНОРАЗОВЫЙ БЭКФИЛЛ: расклинить носители, застрявшие в полёте с arrive_at=NULL ──
--  Симптом: ранее этот срез затирал _defense_const устаревшей версией без ключей
--  op_fly_h_*, поэтому outpost_ship_send писал arrive_at=NULL → полёт не считался и
--  ленивое прибытие (arrive_at <= now()) никогда не срабатывало. Функции выше уже
--  починены; здесь добиваем уже испорченные строки: проставляем им корректный
--  arrive_at от depart_at (или от now(), если и его нет) по дистанции маршрута.
update public.outpost_ships
  set depart_at = coalesce(depart_at, now()),
      arrive_at = coalesce(depart_at, now())
                  + (coalesce(public._outpost_fly_hours(from_sys, dest_sys),
                              public._defense_const('op_fly_h_min')) || ' hours')::interval
  where status = 'transit' and arrive_at is null and dest_sys is not null;

