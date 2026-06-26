-- ============================================================
-- ФЛОТ (мобильное соединение на карте)
-- Игрок «формирует флот» из РЕАЛЬНЫХ построенных кораблей своего состава
-- (unit_production, category='ship', status='done'), размещает его в системе
-- своей колонии и двигает по карте. Распуск возвращает корабли в состав.
--
-- Зеркало паттерна корабля-носителя аванпоста (_defense_outpost.sql):
--   таблица мобильного юнита + ленивое прибытие (_settle) + RPC send/mine.
-- Боёвки пока НЕТ — только формирование/движение/распуск.
--
-- Зависимости: public._ec_my_fid() (_security_money.sql),
--              public.unit_production (_economy_setup.sql),
--              public.map_systems / map_hyperlanes / colonies.
-- Выполнить ЦЕЛИКОМ в Supabase → SQL Editor. Идемпотентно.
-- ============================================================

-- ── Таблица флота ──
--   status='idle'    — стоит в системе system_id (готов к переброске / распуску)
--   status='transit' — летит from_sys → dest_sys, прибудет в arrive_at
--   composition      — снимок состава: [{unit_id, unit_name, qty}, ...]
--   home_sys         — база (куда «вернуть на базу»)
create table if not exists public.fleets (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  owner_id    uuid,
  name        text,
  status      text not null default 'idle',
  system_id   text references public.map_systems(id) on delete set null,   -- где стоит (idle)
  from_sys    text references public.map_systems(id) on delete set null,   -- откуда летит (transit)
  dest_sys    text references public.map_systems(id) on delete set null,   -- куда летит (transit)
  home_sys    text references public.map_systems(id) on delete set null,   -- база формирования
  composition jsonb not null default '[]'::jsonb,
  depart_at   timestamptz,
  arrive_at   timestamptz,
  created_at  timestamptz default now()
);
create index if not exists fleets_fac_idx on public.fleets(faction_id);
create index if not exists fleets_sys_idx on public.fleets(system_id);

alter table public.fleets enable row level security;
drop policy if exists "fleets_sel" on public.fleets;
drop policy if exists "fleets_all" on public.fleets;
create policy "fleets_sel" on public.fleets for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
create policy "fleets_all" on public.fleets for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

-- ── Долёт по дистанции (как у носителя/залпа): 2ч сосед → 18ч край↔край ──
create or replace function public._fleet_fly_hours(p_from text, p_to text)
returns numeric language sql stable security definer set search_path=public as $$
  with a as (select x, y from public.map_systems where id = p_from),
       b as (select x, y from public.map_systems where id = p_to),
       d as (select sqrt(power(max(x)-min(x),2) + power(max(y)-min(y),2)) diag from public.map_systems)
  select 2.0
       + least(1.0, sqrt(power(coalesce(b.x,0)-coalesce(a.x,0),2) + power(coalesce(b.y,0)-coalesce(a.y,0),2))
                    / nullif((select diag from d),0))
         * (18.0 - 2.0)
  from a, b
$$;
revoke all on function public._fleet_fly_hours(text,text) from public;

-- ── Ленивое прибытие: долетевшие флоты → idle в системе назначения ──
create or replace function public._fleet_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.fleets
    set status='idle', system_id=dest_sys, from_sys=null, dest_sys=null,
        depart_at=null, arrive_at=null
    where faction_id=p_fid and status='transit' and arrive_at <= now();
end$$;
revoke all on function public._fleet_settle(text) from public;

-- ── RPC: сформировать флот из кораблей состава (в системе своей колонии) ──
-- p_units = [{"unit_id": "...", "qty": N}, ...] — какие корабли и сколько забрать.
-- Корабли СНИМАЮТСЯ из состава (unit_production done) и фиксируются в флоте.
create or replace function public.fleet_form(p_system_id text, p_name text, p_units jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; elem jsonb; uid uuid; want int; avail int; uname text;
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

    comp  := comp || jsonb_build_object('unit_id', uid::text, 'unit_name', uname, 'qty', want);
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

-- ── RPC: перебросить флот по гиперпутям в систему-цель (вся карта) ──
create or replace function public.fleet_send(p_id uuid, p_dest_sys text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; fl public.fleets; fly_h numeric;
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  select * into fl from public.fleets where id=p_id;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;
  if fl.status <> 'idle' then raise exception 'флот уже в пути'; end if;
  if not exists(select 1 from public.map_systems where id=p_dest_sys) then raise exception 'no such system'; end if;
  if p_dest_sys = fl.system_id then raise exception 'флот уже там'; end if;

  fly_h := coalesce(public._fleet_fly_hours(fl.system_id, p_dest_sys), 2.0);
  update public.fleets
    set status='transit', from_sys=system_id, dest_sys=p_dest_sys, system_id=null,
        depart_at=now(), arrive_at=now() + (fly_h || ' hours')::interval
    where id=p_id;
  return jsonb_build_object('ok', true, 'fly_h', round(fly_h,1), 'arrive_at', now() + (fly_h || ' hours')::interval);
end$$;
revoke all on function public.fleet_send(uuid,text) from public;
grant execute on function public.fleet_send(uuid,text) to authenticated;

-- ── RPC: вернуть флот на базу (отправка в home_sys) ──
create or replace function public.fleet_recall(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; fl public.fleets;
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  select * into fl from public.fleets where id=p_id;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;
  if fl.home_sys is null then raise exception 'у флота нет базы'; end if;
  if fl.status <> 'idle' then raise exception 'флот уже в пути'; end if;
  if fl.system_id = fl.home_sys then raise exception 'флот уже на базе'; end if;
  return public.fleet_send(p_id, fl.home_sys);
end$$;
revoke all on function public.fleet_recall(uuid) from public;
grant execute on function public.fleet_recall(uuid) to authenticated;

-- ── RPC: распустить флот — корабли возвращаются в состав ──
create or replace function public.fleet_disband(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; fl public.fleets; elem jsonb; total int := 0;
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  select * into fl from public.fleets where id=p_id;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;
  if fl.status <> 'idle' then raise exception 'дождитесь прибытия флота, прежде чем распускать'; end if;

  for elem in select value from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) loop
    insert into public.unit_production(faction_id, owner_id, unit_id, unit_name, category, line, qty, status, ready_at)
      values(fid, auth.uid(), nullif(elem->>'unit_id','')::uuid, elem->>'unit_name',
             'ship', 'shipyard', greatest(0, coalesce((elem->>'qty')::int,0)), 'done', now());
    total := total + greatest(0, coalesce((elem->>'qty')::int,0));
  end loop;

  delete from public.fleets where id=p_id;
  return jsonb_build_object('ok', true, 'returned', total);
end$$;
revoke all on function public.fleet_disband(uuid) from public;
grant execute on function public.fleet_disband(uuid) to authenticated;

-- ── RPC: мои флоты (idle + в полёте). VOLATILE — внутри _fleet_settle делает UPDATE ──
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
      'can_recall', (fl.status='idle' and fl.home_sys is not null and fl.system_id is distinct from fl.home_sys)
    ) order by fl.created_at asc)
    from public.fleets fl where fl.faction_id = fid
  ), '[]'::jsonb);
end$$;
revoke all on function public.fleets_mine() from public;
grant execute on function public.fleets_mine() to authenticated;
