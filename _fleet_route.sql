-- ============================================================
-- ФЛОТ · СРЕЗ 3 — МАРШРУТ ПО ГИПЕРПУТЯМ (а не полёт по прямой)
-- Применять ПОСЛЕ _army_fleet.sql и _fleet_ops.sql. Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК:
--   • _fleet_jumps честно ходил BFS по map_hyperlanes, НО
--   • _fleet_fly_hours считал время полёта по ЕВКЛИДОВОЙ прямой,
--   • маршрут нигде не хранился: флот исчезал в A и появлялся в B.
--   Итог: трассы на карте — декорация, промежуточных систем в пути нет,
--   встретить/перехватить флот принципиально негде.
--
-- ЧТО СТАЛО:
--   • _fleet_path(a,b)        — Дейкстра по map_hyperlanes, вес плеча = его
--                               длина; возвращает МАССИВ систем пути [a..b].
--   • _fleet_leg_hours(a,b)   — время одного плеча (соседние системы).
--   • _fleet_fly_hours(a,b)   — сумма плеч ПУТИ (фолбэк на прямую, если
--                               система недостижима по трассам).
--   • _fleet_jumps(a,b)       — теперь = длина пути Дейкстры (один источник
--                               правды с временем полёта и с топливом).
--   • fleets.route/route_at   — маршрут рейса и время прибытия в КАЖДЫЙ узел.
--   • fleet_position(id)      — где флот ПРЯМО СЕЙЧАС: пройденный узел,
--                               текущее плечо и доля пути по нему.
--                               Это опора для перехвата (Железный легион).
--   • fleet_send              — надмножество версии из _fleet_ops.sql:
--                               прежняя проверка/списание топлива + маршрут.
--
-- Зависимости: _army_fleet.sql, _fleet_ops.sql (_fleet_fuel_for),
--              public.map_systems / map_hyperlanes, public._ec_my_fid().
-- ============================================================

-- ── Хранение маршрута рейса ──
--   route    — jsonb-массив id систем: [from, ..., dest]
--   route_at — jsonb-массив ISO-меток прибытия в узел с тем же индексом
--              (route_at[0] = depart_at)
alter table public.fleets add column if not exists route    jsonb;
alter table public.fleets add column if not exists route_at jsonb;

-- ── Средняя длина рукава (нормировка времени плеча) ──
create or replace function public._fleet_lane_avg()
returns numeric language sql stable security definer set search_path=public as $$
  select nullif(avg(sqrt(power(s2.x - s1.x, 2) + power(s2.y - s1.y, 2))), 0)
    from public.map_hyperlanes hl
    join public.map_systems s1 on s1.id = hl.a_id
    join public.map_systems s2 on s2.id = hl.b_id
$$;
revoke all on function public._fleet_lane_avg() from public;

-- ── Время ОДНОГО плеча (между соседями по трассе) ──
-- Калибровка: средний рукав ≈ 1 ч. Карта — 342 системы / 466 трасс, край↔край
-- это ~30 плеч, то есть ~30 ч (сутки с небольшим) — местные операции идут
-- часами, переброс через галактику стоит суток. Прежние 18 ч «по прямой»
-- сами себе противоречили: топливо при этом бралось за 28 прыжков.
create or replace function public._fleet_leg_hours(p_a text, p_b text)
returns numeric language sql stable security definer set search_path=public as $$
  select round(0.4 + 0.6 * least(4.0,
           sqrt(power(b.x - a.x, 2) + power(b.y - a.y, 2))
           / coalesce(public._fleet_lane_avg(), 1)
         ), 2)
    from public.map_systems a, public.map_systems b
   where a.id = p_a and b.id = p_b
$$;
revoke all on function public._fleet_leg_hours(text,text) from public;

-- ── ПУТЬ по гиперпутям (Дейкстра, вес = длина рукава) ──
-- Возвращает jsonb-массив id систем от p_from до p_to включительно.
-- Если пути по трассам нет — возвращает null (вызывающий берёт фолбэк).
create or replace function public._fleet_path(p_from text, p_to text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  dist   jsonb := '{}'::jsonb;   -- {system_id: стоимость}
  prev   jsonb := '{}'::jsonb;   -- {system_id: откуда пришли}
  seen   text[] := '{}';
  cur    text; curd numeric; nb text; w numeric; alt numeric;
  guard  int := 0;
  path   jsonb := '[]'::jsonb;
begin
  if p_from is null or p_to is null then return null; end if;
  if p_from = p_to then return jsonb_build_array(p_from); end if;

  dist := jsonb_set(dist, array[p_from], to_jsonb(0::numeric), true);

  loop
    guard := guard + 1;
    exit when guard > 5000;

    -- ближайший ещё не обработанный узел
    cur := null; curd := null;
    for nb, w in select key, (value)::numeric from jsonb_each_text(dist) loop
      if nb = any(seen) then continue; end if;
      if curd is null or w < curd then cur := nb; curd := w; end if;
    end loop;
    exit when cur is null;
    exit when cur = p_to;

    seen := seen || cur;

    -- вес плеча = ВРЕМЯ полёта по нему: маршрут минимизирует то, что игрок
    -- и видит в карточке рейса (часы), а не абстрактную геометрию
    for nb, w in
      select nbid,
             round(0.4 + 0.6 * least(4.0,
               sqrt(power(s2.x - s1.x, 2) + power(s2.y - s1.y, 2))
               / coalesce(public._fleet_lane_avg(), 1)), 2)
        from (
          select case when hl.a_id = cur then hl.b_id else hl.a_id end as nbid
            from public.map_hyperlanes hl
           where hl.a_id = cur or hl.b_id = cur
        ) e
        join public.map_systems s1 on s1.id = cur
        join public.map_systems s2 on s2.id = e.nbid
    loop
      -- (вес уже в часах — см. выражение выше)
      if nb is null or nb = any(seen) then continue; end if;
      alt := curd + coalesce(w, 1);
      if (dist->>nb) is null or alt < (dist->>nb)::numeric then
        dist := jsonb_set(dist, array[nb], to_jsonb(alt),  true);
        prev := jsonb_set(prev, array[nb], to_jsonb(cur),  true);
      end if;
    end loop;
  end loop;

  if (dist->>p_to) is null then return null; end if;          -- недостижимо

  -- разворачиваем цепочку назад
  cur := p_to;
  while cur is not null loop
    path := jsonb_build_array(cur) || path;
    exit when cur = p_from;
    cur := prev->>cur;
  end loop;
  if (path->>0) is distinct from p_from then return null; end if;
  return path;
end$$;
revoke all on function public._fleet_path(text,text) from public;

-- ── Число прыжков = длина пути Дейкстры (фолбэк — прежняя оценка) ──
create or replace function public._fleet_jumps(p_from text, p_to text)
returns int language plpgsql stable security definer set search_path=public as $$
declare pth jsonb; est numeric;
begin
  if p_from is null or p_to is null then return 1; end if;
  if p_from = p_to then return 0; end if;
  pth := public._fleet_path(p_from, p_to);
  if pth is not null then return greatest(1, jsonb_array_length(pth) - 1); end if;
  -- нет трассы → оценка по дистанции / средней длине рукава
  select greatest(1, ceil(
      sqrt(power(b.x - a.x, 2) + power(b.y - a.y, 2))
      / coalesce(public._fleet_lane_avg(), 1)))::int into est
    from public.map_systems a, public.map_systems b
   where a.id = p_from and b.id = p_to;
  return coalesce(est, 1)::int;
end$$;
revoke all on function public._fleet_jumps(text,text) from public;

-- ── Время в пути = сумма плеч МАРШРУТА ──
create or replace function public._fleet_fly_hours(p_from text, p_to text)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare pth jsonb; i int; tot numeric := 0;
begin
  if p_from is null or p_to is null or p_from = p_to then return 0; end if;
  pth := public._fleet_path(p_from, p_to);
  if pth is null then
    -- недостижимо по трассам: оценка по прямой в том же масштабе (1ч → 30ч край)
    return (
      with a as (select x, y from public.map_systems where id = p_from),
           b as (select x, y from public.map_systems where id = p_to),
           d as (select sqrt(power(max(x)-min(x),2) + power(max(y)-min(y),2)) diag
                   from public.map_systems)
      select 1.0 + least(1.0,
               sqrt(power(coalesce(b.x,0)-coalesce(a.x,0),2)
                  + power(coalesce(b.y,0)-coalesce(a.y,0),2))
               / nullif((select diag from d),0)) * 29.0
        from a, b);
  end if;
  for i in 0 .. jsonb_array_length(pth) - 2 loop
    tot := tot + coalesce(public._fleet_leg_hours(pth->>i, pth->>(i+1)), 2.0);
  end loop;
  return greatest(0.5, round(tot, 2));
end$$;
revoke all on function public._fleet_fly_hours(text,text) from public;

-- ── Расписание рейса: метки прибытия в каждый узел маршрута ──
create or replace function public._fleet_schedule(p_path jsonb, p_depart timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare i int; t timestamptz; out jsonb := '[]'::jsonb; lh numeric;
begin
  if p_path is null or jsonb_array_length(p_path) = 0 then return null; end if;
  t := p_depart;
  out := jsonb_build_array(to_jsonb(t));
  for i in 0 .. jsonb_array_length(p_path) - 2 loop
    lh := coalesce(public._fleet_leg_hours(p_path->>i, p_path->>(i+1)), 2.0);
    t  := t + (lh || ' hours')::interval;
    out := out || jsonb_build_array(to_jsonb(t));
  end loop;
  return out;
end$$;
revoke all on function public._fleet_schedule(jsonb,timestamptz) from public;

-- ── ГДЕ ФЛОТ СЕЙЧАС (опора перехвата) ──
-- Возвращает: {status, at} для стоящего; для летящего —
--   {status:'transit', last, next, leg, legs, t (доля плеча 0..1), arrive_at}
-- last — последний ПРОЙДЕННЫЙ узел маршрута (там его и встречают).
create or replace function public.fleet_position(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fl public.fleets; n int; i int; ta timestamptz; tb timestamptz;
begin
  select * into fl from public.fleets where id = p_id;
  if not found then return null; end if;
  if fl.status <> 'transit' then
    return jsonb_build_object('status', fl.status, 'at', fl.system_id);
  end if;
  if fl.route is null or fl.route_at is null then
    -- старый рейс без маршрута (до этого среза) — знаем только концы
    return jsonb_build_object('status','transit','last', fl.from_sys,
      'next', fl.dest_sys, 'leg', 0, 'legs', 1, 't', 0, 'arrive_at', fl.arrive_at);
  end if;
  n := jsonb_array_length(fl.route);
  for i in reverse (n - 2) .. 0 loop
    ta := (fl.route_at->>i)::timestamptz;
    if now() >= ta then
      tb := (fl.route_at->>(i+1))::timestamptz;
      return jsonb_build_object(
        'status','transit',
        'last',  fl.route->>i,
        'next',  fl.route->>(i+1),
        'leg',   i,
        'legs',  n - 1,
        't',     round(least(1.0, greatest(0.0,
                   extract(epoch from (now() - ta))
                   / nullif(extract(epoch from (tb - ta)), 0)))::numeric, 3),
        'route', fl.route,
        'arrive_at', fl.arrive_at);
    end if;
  end loop;
  return jsonb_build_object('status','transit','last', fl.route->>0,
    'next', fl.route->>1, 'leg', 0, 'legs', n - 1, 't', 0,
    'route', fl.route, 'arrive_at', fl.arrive_at);
end$$;
revoke all on function public.fleet_position(uuid) from public;
grant execute on function public.fleet_position(uuid) to authenticated;

-- ── Прибытие: чистим маршрут вместе с рейсом ──
create or replace function public._fleet_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.fleets
    set status='idle', system_id=dest_sys, from_sys=null, dest_sys=null,
        depart_at=null, arrive_at=null, route=null, route_at=null
    where faction_id=p_fid and status='transit' and arrive_at <= now();
end$$;
revoke all on function public._fleet_settle(text) from public;

-- ════════════════════════════════════════════════════════════
-- fleet_send — НАДМНОЖЕСТВО версии из _fleet_ops.sql:
-- топливо считается и списывается как прежде (по числу прыжков),
-- дополнительно прокладывается и сохраняется МАРШРУТ рейса.
-- ════════════════════════════════════════════════════════════
create or replace function public.fleet_send(p_id uuid, p_dest_sys text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; fl public.fleets; fly_h numeric; jumps int; fuel jsonb; res jsonb;
  rk text; rneed numeric; rhave numeric; short text := '';
  pth jsonb; sched jsonb; dep timestamptz := now();
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  select * into fl from public.fleets where id=p_id;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;
  if fl.status <> 'idle' then raise exception 'флот уже в пути'; end if;
  if coalesce(fl.is_station, false) then raise exception 'станция не перемещается'; end if;
  if not exists(select 1 from public.map_systems where id=p_dest_sys) then raise exception 'no such system'; end if;
  if p_dest_sys = fl.system_id then raise exception 'флот уже там'; end if;

  -- маршрут по гиперпутям (может быть null — тогда идём «по прямой», как раньше)
  pth   := public._fleet_path(fl.system_id, p_dest_sys);
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
  sched := case when pth is null then null else public._fleet_schedule(pth, dep) end;

  update public.fleets
    set status='transit', from_sys=system_id, dest_sys=p_dest_sys, system_id=null,
        depart_at=dep, arrive_at=dep + (fly_h || ' hours')::interval,
        route=pth, route_at=sched
    where id=p_id;

  return jsonb_build_object('ok', true, 'fly_h', round(fly_h,1), 'jumps', jumps,
    'fuel', fuel, 'route', pth, 'route_at', sched,
    'arrive_at', dep + (fly_h || ' hours')::interval);
end$$;
revoke all on function public.fleet_send(uuid,text) from public;
grant execute on function public.fleet_send(uuid,text) to authenticated;

-- ── Предпросмотр рейса для клиента (нарисовать маршрут ДО отправки) ──
create or replace function public.fleet_route_preview(p_id uuid, p_dest_sys text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text; fl public.fleets; pth jsonb; jumps int;
begin
  fid := public._ec_my_fid();
  select * into fl from public.fleets where id=p_id;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;
  pth   := public._fleet_path(coalesce(fl.system_id, fl.dest_sys), p_dest_sys);
  jumps := public._fleet_jumps(coalesce(fl.system_id, fl.dest_sys), p_dest_sys);
  return jsonb_build_object(
    'ok', true,
    'route', pth,
    'lanes', (pth is not null),
    'jumps', jumps,
    'fly_h', round(public._fleet_fly_hours(coalesce(fl.system_id, fl.dest_sys), p_dest_sys), 1),
    'fuel',  public._fleet_fuel_for(fl.composition, jumps));
end$$;
revoke all on function public.fleet_route_preview(uuid,text) from public;
grant execute on function public.fleet_route_preview(uuid,text) to authenticated;
