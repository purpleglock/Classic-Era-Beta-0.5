-- ============================================================
-- ОБОРОННЫЕ СТРУКТУРЫ — СЛАЙС 4: АВАНПОСТЫ (КОРАБЛЬ-НОСИТЕЛЬ + РАЗВЁРТЫВАНИЕ)
-- Применять в Supabase → SQL Editor ПОСЛЕ _defense_minefield.sql.
-- Идемпотентно.
--
-- ИДЕЯ (переработка): аванпост больше НЕ строится «из воздуха» в любой системе.
-- Сначала на верфи строится КОРАБЛЬ-НОСИТЕЛЬ аванпоста (outpost_ships) — он
-- появляется на карте в системе постройки. Его отправляют по гиперпутям в нужную
-- (нейтральную, неколонизированную) систему; долёт — функция дистанции (как залп
-- орудия судного дня). По ПРИБЫТИИ игрок жмёт «Развернуть» — корабль превращается
-- в стационарный аванпост (outposts) и исчезает.
-- Аванпост: (1) разведка — раскрывает оборонные объекты этой системы;
-- (2) стоянка — +вместимость флота вне границ. Можно разобрать.
-- ============================================================

-- ── Стационарный аванпост (результат развёртывания) ──
create table if not exists public.outposts (
  id          uuid primary key default gen_random_uuid(),
  system_id   text not null references public.map_systems(id) on delete cascade,
  owner_id    uuid,
  faction_id  text not null,
  name        text,
  created_at  timestamptz default now()
);
create unique index if not exists outposts_uidx on public.outposts(system_id, faction_id);
create index if not exists outposts_sys_idx on public.outposts(system_id);
create index if not exists outposts_fac_idx on public.outposts(faction_id);

alter table public.outposts enable row level security;
drop policy if exists "op_sel" on public.outposts;
drop policy if exists "op_all" on public.outposts;
create policy "op_sel" on public.outposts for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
create policy "op_all" on public.outposts for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

-- ── Корабль-носитель аванпоста (мобильный юнит на карте) ──
--   status='idle'    — стоит в системе system_id (готов к отправке / развёртыванию)
--   status='transit' — летит from_sys → dest_sys, прибудет в arrive_at
create table if not exists public.outpost_ships (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  owner_id    uuid,
  name        text,
  status      text not null default 'idle',
  system_id   text references public.map_systems(id) on delete set null,   -- где стоит (idle)
  from_sys    text references public.map_systems(id) on delete set null,   -- откуда летит (transit)
  dest_sys    text references public.map_systems(id) on delete set null,   -- куда летит (transit)
  depart_at   timestamptz,
  arrive_at   timestamptz,
  created_at  timestamptz default now()
);
create index if not exists opships_fac_idx on public.outpost_ships(faction_id);
create index if not exists opships_sys_idx on public.outpost_ships(system_id);

alter table public.outpost_ships enable row level security;
drop policy if exists "ops_sel" on public.outpost_ships;
drop policy if exists "ops_all" on public.outpost_ships;
create policy "ops_sel" on public.outpost_ships for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
create policy "ops_all" on public.outpost_ships for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

-- ── Константы (надмножество _defense_minefield.sql) ──
create or replace function public._defense_const(p_key text)
returns numeric language sql immutable as $$
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
    when 'outpost_ship_cost'     then 1500    -- ГС за постройку корабля-носителя
    when 'outpost_cap'           then 20      -- +вместимость флота за развёрнутый аванпост
    when 'outpost_refund'        then 0.50    -- доля возврата при разборке/сломе корабля
    when 'op_fly_h_min'          then 2       -- мин. полёт (соседняя система), часов
    when 'op_fly_h_max'          then 18      -- макс. полёт (край↔край карты), часов
    else null end
$$;

-- ── Видимость скрытых оборонных объектов: + «есть мой аванпост в системе» ──
create or replace function public._defense_can_see(p_fid text, p_system_id text, p_owner_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select
    p_fid = p_owner_fid
    or exists(select 1 from public.colonies c
              where c.faction_id = p_fid and c.system_id = p_system_id)
    or exists(select 1 from public.map_systems s
              where s.id = p_system_id and s.faction = p_fid)
    or exists(select 1 from public.outposts o                                  -- мой аванпост в системе
              where o.faction_id = p_fid and o.system_id = p_system_id)
    or public._spy_intel(p_fid, p_owner_fid) is not null
$$;
revoke all on function public._defense_can_see(text,text,text) from public;
grant execute on function public._defense_can_see(text,text,text) to authenticated;

-- ── Вместимость флота: базы + стоянки аванпостов ──
create or replace function public._fleet_capacity(p_fid text)
returns int language sql stable security definer set search_path=public as $$
  select
    coalesce((select sum(slots_open) from public.colony_buildings
              where faction_id = p_fid and btype = 'starbase'),0)::int
      * public._defense_const('starbase_cap_per_slot')::int
    + coalesce((select count(*) from public.outposts where faction_id = p_fid),0)::int
      * public._defense_const('outpost_cap')::int
$$;
revoke all on function public._fleet_capacity(text) from public;
grant execute on function public._fleet_capacity(text) to authenticated;

-- ── Можно ли ВЛЕТЕТЬ в систему: нельзя заходить в ЧУЖИЕ границы ──
-- (своя/нейтральная — ок; чужая под флагом — нет).
create or replace function public._outpost_send_ok(p_fid text, p_sys text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.map_systems where id=p_sys)
    and not exists(select 1 from public.map_systems
                   where id=p_sys and faction is not null and faction <> p_fid)
$$;
revoke all on function public._outpost_send_ok(text,text) from public;
grant execute on function public._outpost_send_ok(text,text) to authenticated;

-- ── Можно ли РАЗВЕРНУТЬ аванпост в системе: нейтральная, неколонизированная,
-- без чужого аванпоста, БЕЗ моего аванпоста, и НЕ впритык к чужой границе —
-- ни один сосед по гиперпути не должен принадлежать другому государству
-- («примерно за одну систему от границ другого»). ──
create or replace function public._outpost_can_deploy(p_fid text, p_sys text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.map_systems where id=p_sys)
    and not exists(select 1 from public.map_systems where id=p_sys and faction is not null)  -- сама нейтральна
    and not exists(select 1 from public.colonies   where system_id=p_sys)                    -- не колонизирована
    and not exists(select 1 from public.outposts   where system_id=p_sys)                    -- нет ничьего аванпоста
    -- буфер: ни один сосед не под флагом ЧУЖОГО государства
    and not exists(
      select 1 from public.map_hyperlanes h
      join public.map_systems ns
        on ns.id = case when h.a_id=p_sys then h.b_id when h.b_id=p_sys then h.a_id end
      where (h.a_id=p_sys or h.b_id=p_sys)
        and ns.faction is not null and ns.faction <> p_fid
    )
$$;
revoke all on function public._outpost_can_deploy(text,text) from public;
grant execute on function public._outpost_can_deploy(text,text) to authenticated;

-- ── Долёт корабля-носителя по дистанции (как залп орудия судного дня) ──
create or replace function public._outpost_fly_hours(p_from text, p_to text)
returns numeric language sql stable security definer set search_path=public as $$
  with a as (select x, y from public.map_systems where id = p_from),
       b as (select x, y from public.map_systems where id = p_to),
       d as (select sqrt(power(max(x)-min(x),2) + power(max(y)-min(y),2)) diag from public.map_systems)
  select public._defense_const('op_fly_h_min')
       + least(1.0, sqrt(power(coalesce(b.x,0)-coalesce(a.x,0),2) + power(coalesce(b.y,0)-coalesce(a.y,0),2))
                    / nullif((select diag from d),0))
         * (public._defense_const('op_fly_h_max') - public._defense_const('op_fly_h_min'))
  from a, b
$$;

-- ── Ленивое «прибытие»: долетевшие корабли становятся idle в системе назначения ──
create or replace function public._outpost_ship_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.outpost_ships
    set status='idle', system_id=dest_sys, from_sys=null, dest_sys=null,
        depart_at=null, arrive_at=null
    where faction_id=p_fid and status='transit' and arrive_at <= now();
end$$;
revoke all on function public._outpost_ship_settle(text) from public;

-- ── RPC: построить корабль-носитель (в системе своей колонии) ──
create or replace function public.outpost_ship_build(p_system_id text, p_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; cost numeric; v_id uuid;
begin
  fid := public._ec_my_fid();
  if not exists(select 1 from public.colonies where faction_id=fid and system_id=p_system_id) then
    raise exception 'build outpost-ship only at a system with your colony';
  end if;
  cost := public._defense_const('outpost_ship_cost');
  update public.faction_economy set gc = gc - cost where faction_id=fid and gc >= cost;
  if not found then raise exception 'not enough GC: корабль-носитель стоит %', cost; end if;

  insert into public.outpost_ships(faction_id, owner_id, name, status, system_id)
    values(fid, auth.uid(), nullif(trim(coalesce(p_name,'')),''), 'idle', p_system_id)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'cost', cost);
end$$;
revoke all on function public.outpost_ship_build(text,text) from public;
grant execute on function public.outpost_ship_build(text,text) to authenticated;

-- ── RPC: отправить корабль по гиперпутям в систему-цель ──
create or replace function public.outpost_ship_send(p_id uuid, p_dest_sys text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; sh public.outpost_ships; fly_h numeric;
begin
  fid := public._ec_my_fid();
  perform public._outpost_ship_settle(fid);
  select * into sh from public.outpost_ships where id=p_id;
  if not found then raise exception 'outpost-ship not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your ship'; end if;
  if sh.status <> 'idle' then raise exception 'ship is already in transit'; end if;
  if not exists(select 1 from public.map_systems where id=p_dest_sys) then raise exception 'no such system'; end if;
  if p_dest_sys = sh.system_id then raise exception 'ship is already there'; end if;
  if not public._outpost_send_ok(fid, p_dest_sys) then
    raise exception 'cannot enter foreign borders';
  end if;

  fly_h := coalesce(public._outpost_fly_hours(sh.system_id, p_dest_sys),
                    public._defense_const('op_fly_h_min'));
  update public.outpost_ships
    set status='transit', from_sys=system_id, dest_sys=p_dest_sys, system_id=null,
        depart_at=now(), arrive_at=now() + (fly_h || ' hours')::interval
    where id=p_id;
  return jsonb_build_object('ok', true, 'fly_h', round(fly_h,1), 'arrive_at', now() + (fly_h || ' hours')::interval);
end$$;
revoke all on function public.outpost_ship_send(uuid,text) from public;
grant execute on function public.outpost_ship_send(uuid,text) to authenticated;

-- ── RPC: развернуть прибывший корабль в стационарный аванпост ──
create or replace function public.outpost_ship_deploy(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; sh public.outpost_ships; sysid text; v_id uuid;
begin
  fid := public._ec_my_fid();
  perform public._outpost_ship_settle(fid);
  select * into sh from public.outpost_ships where id=p_id;
  if not found then raise exception 'outpost-ship not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your ship'; end if;
  if sh.status <> 'idle' or sh.system_id is null then raise exception 'ship still in transit'; end if;
  sysid := sh.system_id;
  -- разворачивать можно только вне границ И не впритык к чужому государству
  if not public._outpost_can_deploy(fid, sysid) then
    raise exception 'cannot deploy here: must be neutral space, не впритык к чужой границе';
  end if;

  insert into public.outposts(system_id, owner_id, faction_id, name)
    values(sysid, auth.uid(), fid, sh.name)
    returning id into v_id;
  delete from public.outpost_ships where id=p_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'system_id', sysid);
end$$;
revoke all on function public.outpost_ship_deploy(uuid) from public;
grant execute on function public.outpost_ship_deploy(uuid) to authenticated;

-- ── RPC: списать корабль-носитель (частичный возврат) ──
create or replace function public.outpost_ship_scrap(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; sh public.outpost_ships; refund numeric;
begin
  fid := public._ec_my_fid();
  select * into sh from public.outpost_ships where id=p_id;
  if not found then raise exception 'outpost-ship not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your ship'; end if;
  refund := floor(public._defense_const('outpost_ship_cost') * public._defense_const('outpost_refund'));
  delete from public.outpost_ships where id=p_id;
  update public.faction_economy set gc = gc + refund where faction_id=fid;
  return jsonb_build_object('ok', true, 'refund', refund);
end$$;
revoke all on function public.outpost_ship_scrap(uuid) from public;
grant execute on function public.outpost_ship_scrap(uuid) to authenticated;

-- ── RPC: мои корабли-носители (idle + в полёте) с флагом «можно развернуть» ──
-- ВНИМАНИЕ: функция VOLATILE (не STABLE!) — внутри _outpost_ship_settle делает UPDATE
-- (ленивое прибытие). PostgREST гоняет STABLE-функции в read-only транзакции, и тогда
-- UPDATE падает с SQLSTATE 25006 → HTTP 405 → клиент получает [] вместо носителей.
create or replace function public.outpost_ships_mine()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._outpost_ship_settle(fid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', sh.id, 'name', sh.name, 'status', sh.status,
      'system_id', sh.system_id, 'from_sys', sh.from_sys, 'dest_sys', sh.dest_sys,
      'depart_at', sh.depart_at, 'arrive_at', sh.arrive_at,
      'can_deploy', (sh.status='idle' and sh.system_id is not null
        and public._outpost_can_deploy(fid, sh.system_id))
    ) order by sh.created_at asc)
    from public.outpost_ships sh where sh.faction_id = fid
  ), '[]'::jsonb);
end$$;
revoke all on function public.outpost_ships_mine() from public;
grant execute on function public.outpost_ships_mine() to authenticated;

-- ── RPC: видимые мне аванпосты (свои + разведанные чужие) ──
create or replace function public.outposts_visible()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'system_id', o.system_id, 'faction_id', o.faction_id,
      'name', o.name, 'mine', (o.faction_id = fid),
      'faction_name', public._fac_name(o.faction_id)
    ) order by o.created_at asc)
    from public.outposts o
    where public._defense_can_see(fid, o.system_id, o.faction_id)
  ), '[]'::jsonb);
end$$;
revoke all on function public.outposts_visible() from public;
grant execute on function public.outposts_visible() to authenticated;

-- ── RPC: разобрать развёрнутый аванпост (частичный возврат) ──
create or replace function public.outpost_dismantle(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; op public.outposts; refund numeric;
begin
  fid := public._ec_my_fid();
  select * into op from public.outposts where id=p_id;
  if not found then raise exception 'outpost not found'; end if;
  if op.faction_id is distinct from fid then raise exception 'not your outpost'; end if;
  refund := floor(public._defense_const('outpost_ship_cost') * public._defense_const('outpost_refund'));
  delete from public.outposts where id=p_id;
  update public.faction_economy set gc = gc + refund where faction_id=fid;
  return jsonb_build_object('ok', true, 'refund', refund);
end$$;
revoke all on function public.outpost_dismantle(uuid) from public;
grant execute on function public.outpost_dismantle(uuid) to authenticated;
