-- ============================================================
-- ФЛОТ · СРЕЗ 2 — РЕДАКТИРОВАНИЕ + ТОПЛИВО ПЕРЕЛЁТОВ
-- Применять в Supabase → SQL Editor ПОСЛЕ _army_fleet.sql. Идемпотентно.
--
-- Добавляет к флоту (_army_fleet.sql):
--   1) РЕДАКТИРОВАНИЕ состава (fleet_edit) — добавить/убрать корабли и
--      переименовать. Можно ТОЛЬКО когда флот стоит (idle) в системе со
--      СВОЕЙ ВЕРФЬЮ (colony_buildings.btype='shipyard' своей колонии).
--   2) ТОПЛИВО НА ПЕРЕЛЁТ (fleet_send) — каждый переброс/возврат тратит
--      топливо со склада. Расход = (топливо на класс корабля) × число
--      кораблей × ЧИСЛО ГИПЕРПРЫЖКОВ между системами (а не время в пути).
--      Классы жгут ОСНОВНОЕ топливо тира + ВТОРИЧНОЕ:
--        корвет/фрегат   → Гелий-3  + Метан,
--        эсминец/крейсер → Дейтерий + Углерод,
--        линкор/дредноут → Старвис  + Изотопы.
--      Не хватает топлива — переброс не состоится (внятная ошибка).
--
-- Зеркало клиента: economy.js + galaxy_map.js (EC_FLEET_FUEL / gmFleetFuel*).
-- Зависимости: _army_fleet.sql, public.faction_economy.resources,
--   public.colony_buildings/colonies, public.map_hyperlanes/map_systems,
--   public.faction_units (data->>'class').
-- ============================================================

-- ── Число ГИПЕРПРЫЖКОВ между системами (BFS по гиперпутям) ──
-- Возвращает минимальное число рукавов в пути from→to. Если путь по
-- гиперпутям недостижим — оценка по дистанции / средней длине рукава
-- (флот можно перебрасывать по всей карте, даже без прямой трассы).
create or replace function public._fleet_jumps(p_from text, p_to text)
returns int language plpgsql stable security definer set search_path=public as $$
declare
  frontier text[]; visited text[]; nextf text[]; h int := 0; est numeric;
begin
  if p_from is null or p_to is null then return 1; end if;
  if p_from = p_to then return 0; end if;
  frontier := array[p_from]; visited := array[p_from];
  while array_length(frontier, 1) > 0 and h < 200 loop
    h := h + 1;
    select array_agg(distinct nb) into nextf from (
      select case when hl.a_id = any(frontier) then hl.b_id else hl.a_id end as nb
      from public.map_hyperlanes hl
      where hl.a_id = any(frontier) or hl.b_id = any(frontier)
    ) s where nb is not null and not (nb = any(visited));
    if nextf is null or array_length(nextf, 1) = 0 then exit; end if;     -- компонента исчерпана
    if p_to = any(nextf) then return h; end if;
    visited := visited || nextf;
    frontier := nextf;
  end loop;
  -- недостижимо по трассам → оценка по евклидовой дистанции / средней длине рукава
  select greatest(1, ceil(
      sqrt(power(b.x - a.x, 2) + power(b.y - a.y, 2))
      / nullif((select avg(sqrt(power(s2.x - s1.x, 2) + power(s2.y - s1.y, 2)))
                from public.map_hyperlanes hl
                join public.map_systems s1 on s1.id = hl.a_id
                join public.map_systems s2 on s2.id = hl.b_id), 0)
    ))::int into est
    from public.map_systems a, public.map_systems b
    where a.id = p_from and b.id = p_to;
  return coalesce(est, 1);
end$$;
revoke all on function public._fleet_jumps(text,text) from public;

-- ── Топливо на перелёт всего флота (по составу × числу прыжков) ──
-- Возвращает jsonb-карту {название_ресурса: количество}. Класс корабля
-- берём из снимка состава (cls), а если его там нет (старый флот) —
-- из дизайна faction_units.data->>'class'. Неизвестный класс ≈ фрегат.
create or replace function public._fleet_fuel_for(p_comp jsonb, p_jumps int)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  elem jsonb; k text; qty int; j int; cur numeric; fuels jsonb; fk text; fp numeric;
  out jsonb := '{}'::jsonb;
begin
  j := greatest(1, coalesce(p_jumps, 1));
  for elem in select value from jsonb_array_elements(coalesce(p_comp, '[]'::jsonb)) loop
    qty := greatest(0, coalesce((elem->>'qty')::int, 0));
    if qty <= 0 then continue; end if;
    k := nullif(elem->>'cls', '');
    if k is null then
      select data->>'class' into k from public.faction_units
        where id = nullif(elem->>'unit_id', '')::uuid;
    end if;
    -- Каждый класс жжёт ОСНОВНОЕ топливо тира + вторичное: лёгкие — Метан,
    -- средние (дейтериевый тир) — Углерод, тяжёлые (линкор/дредноут) — Изотопы.
    case k
      when 'corvette'    then fuels := '{"Гелий-3":1,"Метан":1}';
      when 'frigate'     then fuels := '{"Гелий-3":2,"Метан":1}';
      when 'destroyer'   then fuels := '{"Дейтерий":2,"Углерод":1}';
      when 'cruiser'     then fuels := '{"Дейтерий":3,"Углерод":2}';
      when 'battleship'  then fuels := '{"Старвис":2,"Изотопы":1}';
      when 'dreadnought' then fuels := '{"Старвис":4,"Изотопы":2}';
      else                    fuels := '{"Гелий-3":2,"Метан":1}';   -- неизвестный класс ≈ фрегат
    end case;
    for fk, fp in select key, (value)::numeric from jsonb_each_text(fuels) loop
      cur := coalesce((out->>fk)::numeric, 0);
      out := jsonb_set(out, array[fk], to_jsonb(cur + fp * qty * j), true);
    end loop;
  end loop;
  return out;
end$$;
revoke all on function public._fleet_fuel_for(jsonb,int) from public;

-- ════════════════════════════════════════════════════════════
-- fleet_form — НАДМНОЖЕСТВО версии из _army_fleet.sql: дополнительно
-- пишет в снимок состава класс корабля (cls) и его подпись (className),
-- чтобы расчёт топлива не зависел от живого дизайна.
-- ════════════════════════════════════════════════════════════
create or replace function public.fleet_form(p_system_id text, p_name text, p_units jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; elem jsonb; uid uuid; want int; avail int; uname text;
  v_cls text; v_clsname text;
  rem int; r record; take int; comp jsonb := '[]'::jsonb; total int := 0; v_id uuid;
begin
  fid := public._ec_my_fid();
  if not exists(select 1 from public.colonies where faction_id=fid and system_id=p_system_id) then
    raise exception 'формировать флот можно только в системе своей колонии';
  end if;
  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception 'не выбран состав флота';
  end if;

  for elem in select value from jsonb_array_elements(p_units) loop
    uid  := nullif(elem->>'unit_id','')::uuid;
    want := greatest(0, coalesce((elem->>'qty')::int, 0));
    if uid is null or want <= 0 then continue; end if;

    select coalesce(sum(qty),0) into avail from public.unit_production
      where faction_id=fid and status='done' and category='ship' and unit_id=uid;
    if avail < want then raise exception 'недостаточно кораблей в составе (нужно % , есть %)', want, avail; end if;

    select unit_name into uname from public.unit_production
      where faction_id=fid and status='done' and category='ship' and unit_id=uid limit 1;
    select data->>'class', summary->>'className' into v_cls, v_clsname
      from public.faction_units where id=uid;

    rem := want;
    for r in select id, qty from public.unit_production
        where faction_id=fid and status='done' and category='ship' and unit_id=uid
        order by created_at asc loop
      exit when rem <= 0;
      take := least(r.qty, rem);
      if take >= r.qty then delete from public.unit_production where id=r.id;
      else update public.unit_production set qty=qty-take where id=r.id; end if;
      rem := rem - take;
    end loop;

    comp  := comp || jsonb_build_object('unit_id', uid::text, 'unit_name', uname, 'qty', want,
                       'cls', coalesce(v_cls,''), 'className', coalesce(v_clsname,''));
    total := total + want;
  end loop;

  if total < 1 then raise exception 'выберите хотя бы один корабль для флота'; end if;

  insert into public.fleets(faction_id, owner_id, name, status, system_id, home_sys, composition)
    values(fid, auth.uid(), nullif(trim(coalesce(p_name,'')),''), 'idle', p_system_id, p_system_id, comp)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'ships', total, 'system_id', p_system_id);
end$$;
revoke all on function public.fleet_form(text,text,jsonb) from public;
grant execute on function public.fleet_form(text,text,jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════
-- fleet_send — НАДМНОЖЕСТВО: перед переброской считает число прыжков и
-- ТОПЛИВО, списывает его со склада (faction_economy.resources). Не хватает
-- топлива — переброс отменяется с перечнем недостающего.
-- ════════════════════════════════════════════════════════════
create or replace function public.fleet_send(p_id uuid, p_dest_sys text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; fl public.fleets; fly_h numeric; jumps int; fuel jsonb; res jsonb;
  rk text; rneed numeric; rhave numeric; short text := '';
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  select * into fl from public.fleets where id=p_id;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;
  if fl.status <> 'idle' then raise exception 'флот уже в пути'; end if;
  if not exists(select 1 from public.map_systems where id=p_dest_sys) then raise exception 'no such system'; end if;
  if p_dest_sys = fl.system_id then raise exception 'флот уже там'; end if;

  -- топливо: расход = состав × прыжки. Сначала проверяем, потом списываем.
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
  update public.fleets
    set status='transit', from_sys=system_id, dest_sys=p_dest_sys, system_id=null,
        depart_at=now(), arrive_at=now() + (fly_h || ' hours')::interval
    where id=p_id;
  return jsonb_build_object('ok', true, 'fly_h', round(fly_h,1), 'jumps', jumps, 'fuel', fuel,
    'arrive_at', now() + (fly_h || ' hours')::interval);
end$$;
revoke all on function public.fleet_send(uuid,text) from public;
grant execute on function public.fleet_send(uuid,text) to authenticated;

-- ════════════════════════════════════════════════════════════
-- fleet_edit — редактирование флота на стоянке у своей ВЕРФИ.
--   p_add    = [{"unit_id":"…","qty":N}, …] — добавить из состава
--   p_remove = [{"unit_id":"…","qty":N}, …] — вернуть в состав
--   p_name   = новое имя (null = не менять, '' = снять имя)
-- ════════════════════════════════════════════════════════════
create or replace function public.fleet_edit(p_id uuid, p_add jsonb, p_remove jsonb, p_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; fl public.fleets; elem jsonb; uid uuid; want int; avail int;
  uname text; v_cls text; v_clsname text; rem int; r record; take int;
  comp_map jsonb := '{}'::jsonb; key text; cur jsonb; curqty int;
  newcomp jsonb := '[]'::jsonb; total int := 0;
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  select * into fl from public.fleets where id=p_id;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;
  if fl.status <> 'idle' then raise exception 'редактировать можно только флот на стоянке'; end if;
  if not exists(
      select 1 from public.colony_buildings cb
      join public.colonies c on c.id = cb.colony_id
      where cb.btype='shipyard' and c.faction_id=fid and c.system_id=fl.system_id) then
    raise exception 'редактировать флот можно только в системе со своей верфью';
  end if;

  -- текущий состав → карта по unit_id
  for elem in select value from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) loop
    key := nullif(elem->>'unit_id','');
    if key is null then continue; end if;
    comp_map := jsonb_set(comp_map, array[key], elem, true);
  end loop;

  -- УБРАТЬ корабли → вернуть в состав, уменьшить в карте
  if p_remove is not null and jsonb_typeof(p_remove)='array' then
    for elem in select value from jsonb_array_elements(p_remove) loop
      key  := nullif(elem->>'unit_id','');
      want := greatest(0, coalesce((elem->>'qty')::int,0));
      if key is null or want<=0 then continue; end if;
      cur := comp_map->key;
      if cur is null then continue; end if;
      curqty := greatest(0, coalesce((cur->>'qty')::int,0));
      want := least(want, curqty);
      if want<=0 then continue; end if;
      insert into public.unit_production(faction_id,owner_id,unit_id,unit_name,category,line,qty,status,ready_at)
        values(fid, auth.uid(), key::uuid, cur->>'unit_name','ship','shipyard',want,'done',now());
      if want >= curqty then comp_map := comp_map - key;
      else comp_map := jsonb_set(comp_map, array[key], jsonb_set(cur, array['qty'], to_jsonb(curqty-want), true), true);
      end if;
    end loop;
  end if;

  -- ДОБАВИТЬ корабли → снять из состава, увеличить в карте
  if p_add is not null and jsonb_typeof(p_add)='array' then
    for elem in select value from jsonb_array_elements(p_add) loop
      uid  := nullif(elem->>'unit_id','')::uuid;
      want := greatest(0, coalesce((elem->>'qty')::int,0));
      if uid is null or want<=0 then continue; end if;
      select coalesce(sum(qty),0) into avail from public.unit_production
        where faction_id=fid and status='done' and category='ship' and unit_id=uid;
      if avail < want then raise exception 'недостаточно кораблей в составе (нужно %, есть %)', want, avail; end if;
      select unit_name into uname from public.unit_production
        where faction_id=fid and status='done' and category='ship' and unit_id=uid limit 1;
      select data->>'class', summary->>'className' into v_cls, v_clsname
        from public.faction_units where id=uid;
      rem := want;
      for r in select id, qty from public.unit_production
          where faction_id=fid and status='done' and category='ship' and unit_id=uid
          order by created_at asc loop
        exit when rem<=0;
        take := least(r.qty, rem);
        if take>=r.qty then delete from public.unit_production where id=r.id;
        else update public.unit_production set qty=qty-take where id=r.id; end if;
        rem := rem - take;
      end loop;
      key := uid::text;
      cur := comp_map->key;
      curqty := coalesce((cur->>'qty')::int, 0);
      comp_map := jsonb_set(comp_map, array[key],
        jsonb_build_object('unit_id', key,
          'unit_name', coalesce(cur->>'unit_name', uname),
          'qty', curqty + want,
          'cls', coalesce(nullif(cur->>'cls',''), v_cls, ''),
          'className', coalesce(nullif(cur->>'className',''), v_clsname, '')), true);
    end loop;
  end if;

  -- собрать состав заново
  for key, cur in select k.key, k.value from jsonb_each(comp_map) k loop
    curqty := greatest(0, coalesce((cur->>'qty')::int,0));
    if curqty<=0 then continue; end if;
    newcomp := newcomp || cur;
    total := total + curqty;
  end loop;

  if total < 1 then raise exception 'во флоте не останется кораблей — распустите его вместо редактирования'; end if;

  update public.fleets
    set composition = newcomp,
        name = case when p_name is null then name else nullif(trim(p_name),'') end
    where id = p_id;

  return jsonb_build_object('ok', true, 'ships', total);
end$$;
revoke all on function public.fleet_edit(uuid,jsonb,jsonb,text) from public;
grant execute on function public.fleet_edit(uuid,jsonb,jsonb,text) to authenticated;

-- ════════════════════════════════════════════════════════════
-- fleets_mine — НАДМНОЖЕСТВО: добавлен флаг editable (idle в системе со
-- своей верфью) для кнопки «редактировать».
-- ════════════════════════════════════════════════════════════
create or replace function public.fleets_mine()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', fl.id, 'name', fl.name, 'status', fl.status,
      'system_id', fl.system_id, 'from_sys', fl.from_sys, 'dest_sys', fl.dest_sys,
      'home_sys', fl.home_sys, 'composition', fl.composition,
      'depart_at', fl.depart_at, 'arrive_at', fl.arrive_at,
      'ships', (select coalesce(sum(greatest(0,(c->>'qty')::int)),0)
                from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c),
      'can_recall', (fl.status='idle' and fl.home_sys is not null and fl.system_id is distinct from fl.home_sys),
      'editable', (fl.status='idle' and exists(
                    select 1 from public.colony_buildings cb
                    join public.colonies c on c.id = cb.colony_id
                    where cb.btype='shipyard' and c.faction_id=fid and c.system_id=fl.system_id))
    ) order by fl.created_at asc)
    from public.fleets fl where fl.faction_id = fid
  ), '[]'::jsonb);
end$$;
revoke all on function public.fleets_mine() from public;
grant execute on function public.fleets_mine() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- 1) _fleet_jumps(соседи) = 1; _fleet_jumps(через 2 рукава) = 2.
-- 2) Флот из 3 корветов на 2 прыжка → Гелий-3 = 1*3*2 = 6, Метан = 1*3*2 = 6.
-- 3) fleet_send без топлива на складе → exception «не хватает топлива».
-- 4) fleet_edit вне системы с верфью → exception «только в системе со своей верфью».
