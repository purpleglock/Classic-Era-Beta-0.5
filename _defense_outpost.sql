-- ============================================================
-- ОБОРОННЫЕ СТРУКТУРЫ — СЛАЙС 4: АВАНПОСТЫ (КОРАБЛЬ-НОСИТЕЛЬ + РАЗВЁРТЫВАНИЕ)
-- Применять в Supabase → SQL Editor ПОСЛЕ _defense_minefield.sql.
-- (для РЕЖИМА РАЗВЕДКИ нужен также _passive_intel.sql — берём оттуда _pi_report).
-- Идемпотентно.
--
-- ИДЕЯ (переработка): аванпост больше НЕ строится «из воздуха» в любой системе.
-- Сначала на верфи строится КОРАБЛЬ-НОСИТЕЛЬ аванпоста (outpost_ships) — он
-- строится СУТКИ (status='building'), затем появляется на карте в системе
-- постройки. Его отправляют по гиперпутям в нужную (нейтральную,
-- неколонизированную) систему; долёт — функция дистанции (как залп орудия
-- судного дня). По ПРИБЫТИИ игрок жмёт «Развернуть» и ВЫБИРАЕТ РЕЖИМ —
-- корабль превращается в стационарный аванпост (outposts) и исчезает.
--
-- РЕЖИМЫ аванпоста (выбираются при развёртывании, mode):
--   • 'recon'  — РАЗВЕДКА: раскрывает оборонные объекты системы И даёт размытый
--                срез (как пассивная разведка) по соседним по гиперпутям державам.
--   • 'mining' — ДОБЫЧА: работает как вынесенный добывающий завод — каждые сутки
--                извлекает ресурсы с планет своей (нейтральной) системы + немного
--                ГС, и служит стоянкой флота (+вместимость). Начисление ленивое.
-- Можно разобрать (частичный возврат).
-- ============================================================

-- ── Стационарный аванпост (результат развёртывания) ──
create table if not exists public.outposts (
  id          uuid primary key default gen_random_uuid(),
  system_id   text not null references public.map_systems(id) on delete cascade,
  owner_id    uuid,
  faction_id  text not null,
  name        text,
  mode        text not null default 'recon',   -- 'recon' | 'mining'
  last_accrue timestamptz default now(),        -- для ленивой добычи (mode='mining')
  created_at  timestamptz default now()
);
create unique index if not exists outposts_uidx on public.outposts(system_id, faction_id);
create index if not exists outposts_sys_idx on public.outposts(system_id);
create index if not exists outposts_fac_idx on public.outposts(faction_id);
-- миграция уже существующей таблицы (если применялась старая версия слайса)
alter table public.outposts add column if not exists mode        text not null default 'recon';
alter table public.outposts add column if not exists last_accrue timestamptz default now();

alter table public.outposts enable row level security;
drop policy if exists "op_sel" on public.outposts;
drop policy if exists "op_all" on public.outposts;
create policy "op_sel" on public.outposts for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
create policy "op_all" on public.outposts for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

-- ── Корабль-носитель аванпоста (мобильный юнит на карте) ──
--   status='building' — строится в системе system_id, готов в arrive_at (сутки)
--   status='idle'     — стоит в системе system_id (готов к отправке / развёртыванию)
--   status='transit'  — летит from_sys → dest_sys, прибудет в arrive_at
create table if not exists public.outpost_ships (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  owner_id    uuid,
  name        text,
  status      text not null default 'idle',
  system_id   text references public.map_systems(id) on delete set null,   -- где стоит (building/idle)
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
    when 'outpost_ship_cost'     then 2000    -- ГС за постройку корабля-носителя (дорого: минимум 2к)
    when 'outpost_build_h'       then 24      -- постройка носителя занимает сутки
    when 'outpost_cap'           then 20      -- +вместимость флота за добывающий аванпост (стоянка)
    when 'outpost_refund'        then 0.50    -- доля возврата при разборке/сломе корабля
    when 'outpost_mine_gc'       then 75      -- ГС/сут с добывающего аванпоста (вне добытых ресурсов)
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

-- ── Вместимость флота: базы + ДОБЫВАЮЩИЕ аванпосты (стоянка) ──
create or replace function public._fleet_capacity(p_fid text)
returns int language sql stable security definer set search_path=public as $$
  select
    coalesce((select sum(slots_open) from public.colony_buildings
              where faction_id = p_fid and btype = 'starbase'),0)::int
      * public._defense_const('starbase_cap_per_slot')::int
    + coalesce((select count(*) from public.outposts
                where faction_id = p_fid and mode = 'mining'),0)::int
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

-- ── Ленивое «прибытие»/«достройка»: достроенные → idle в системе постройки,
--    долетевшие → idle в системе назначения ──
create or replace function public._outpost_ship_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
begin
  -- достройка носителя (прошли сутки постройки): остаётся в системе постройки
  update public.outpost_ships
    set status='idle', depart_at=null, arrive_at=null
    where faction_id=p_fid and status='building' and arrive_at <= now();
  -- прибытие из полёта: становится idle в системе назначения
  update public.outpost_ships
    set status='idle', system_id=dest_sys, from_sys=null, dest_sys=null,
        depart_at=null, arrive_at=null
    where faction_id=p_fid and status='transit' and arrive_at <= now();
end$$;
revoke all on function public._outpost_ship_settle(text) from public;

-- ── Ленивая ДОБЫЧА: каждый mode='mining' аванпост за прошедшие сутки извлекает
--    ресурсы с планет своей системы + немного ГС, начисляя на казну фракции. ──
create or replace function public._outpost_mining_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare
  o record; pl jsonb; relem jsonb; d int; rr text; rate numeric;
  rname text; cur jsonb; gc_total numeric := 0;
begin
  if not exists(select 1 from public.outposts where faction_id=p_fid and mode='mining'
                  and floor(extract(epoch from (now()-coalesce(last_accrue,created_at)))/86400.0) >= 1) then
    return;   -- нечего начислять
  end if;
  select coalesce(resources,'{}'::jsonb) into cur from public.faction_economy where faction_id=p_fid for update;
  if cur is null then return; end if;

  for o in select * from public.outposts where faction_id=p_fid and mode='mining' loop
    d := floor(extract(epoch from (now()-coalesce(o.last_accrue,o.created_at)))/86400.0);
    if d < 1 then continue; end if;
    gc_total := gc_total + public._defense_const('outpost_mine_gc') * d;
    -- ресурсы планет системы аванпоста (та же шкала редкостей, что и в добыче колонии,
    -- но «вне границ» — на ~половину ниже)
    for pl in select value from jsonb_array_elements(
        coalesce((select planets from public.map_systems where id=o.system_id),'[]'::jsonb)) loop
      for relem in select value from jsonb_array_elements(coalesce(pl->'resources','[]'::jsonb)) loop
        rname := relem->>'name'; if rname is null then continue; end if;
        rr := coalesce(relem->>'r','common');
        rate := case rr when 'uncommon' then 6 when 'rare' then 3 when 'epic' then 1 when 'legendary' then 1 else 12 end;
        cur := jsonb_set(cur, array[rname], to_jsonb(coalesce((cur->>rname)::numeric,0) + rate*d), true);
      end loop;
    end loop;
    update public.outposts set last_accrue = coalesce(last_accrue,created_at) + (d || ' days')::interval
      where id = o.id;
  end loop;

  update public.faction_economy set gc = gc + gc_total, resources = cur where faction_id = p_fid;
end$$;
revoke all on function public._outpost_mining_settle(text) from public;

-- ── RPC: построить корабль-носитель (в системе своей колонии; строится СУТКИ) ──
create or replace function public.outpost_ship_build(p_system_id text, p_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; cost numeric; build_h numeric; v_id uuid; ready timestamptz;
begin
  fid := public._ec_my_fid();
  if not exists(select 1 from public.colonies where faction_id=fid and system_id=p_system_id) then
    raise exception 'build outpost-ship only at a system with your colony';
  end if;
  cost := public._defense_const('outpost_ship_cost');
  update public.faction_economy set gc = gc - cost where faction_id=fid and gc >= cost;
  if not found then raise exception 'not enough GC: корабль-носитель стоит %', cost; end if;

  build_h := public._defense_const('outpost_build_h');
  ready := now() + (build_h || ' hours')::interval;
  insert into public.outpost_ships(faction_id, owner_id, name, status, system_id, depart_at, arrive_at)
    values(fid, auth.uid(), nullif(trim(coalesce(p_name,'')),''), 'building', p_system_id, now(), ready)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'cost', cost, 'ready_at', ready);
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
  if sh.status = 'building' then raise exception 'ship is still under construction'; end if;
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

-- ── RPC: развернуть прибывший корабль в стационарный аванпост (с выбором режима) ──
create or replace function public.outpost_ship_deploy(p_id uuid, p_mode text default 'recon')
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; sh public.outpost_ships; sysid text; v_id uuid; md text;
begin
  fid := public._ec_my_fid();
  md := lower(coalesce(p_mode,'recon'));
  if md not in ('recon','mining') then raise exception 'unknown outpost mode: %', p_mode; end if;
  perform public._outpost_ship_settle(fid);
  select * into sh from public.outpost_ships where id=p_id;
  if not found then raise exception 'outpost-ship not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your ship'; end if;
  if sh.status = 'building' then raise exception 'ship is still under construction'; end if;
  if sh.status <> 'idle' or sh.system_id is null then raise exception 'ship still in transit'; end if;
  sysid := sh.system_id;
  -- разворачивать можно только вне границ И не впритык к чужому государству
  if not public._outpost_can_deploy(fid, sysid) then
    raise exception 'cannot deploy here: must be neutral space, не впритык к чужой границе';
  end if;

  insert into public.outposts(system_id, owner_id, faction_id, name, mode, last_accrue)
    values(sysid, auth.uid(), fid, sh.name, md, now())
    returning id into v_id;
  delete from public.outpost_ships where id=p_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'system_id', sysid, 'mode', md);
end$$;
revoke all on function public.outpost_ship_deploy(uuid,text) from public;
grant execute on function public.outpost_ship_deploy(uuid,text) to authenticated;

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

-- ── RPC: мои корабли-носители (building + idle + в полёте) с флагом «можно развернуть» ──
-- ВНИМАНИЕ: функция VOLATILE (не STABLE!) — внутри _outpost_ship_settle делает UPDATE
-- (ленивое прибытие/достройка). PostgREST гоняет STABLE-функции в read-only транзакции,
-- и тогда UPDATE падает с SQLSTATE 25006 → HTTP 405 → клиент получает [] вместо носителей.
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
-- VOLATILE: для своих mode='mining' лениво доначисляет добычу перед отдачей.
create or replace function public.outposts_visible()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._outpost_mining_settle(fid);   -- ленивое начисление добычи моих аванпостов
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'system_id', o.system_id, 'faction_id', o.faction_id,
      'name', o.name, 'mode', o.mode, 'mine', (o.faction_id = fid),
      'faction_name', public._fac_name(o.faction_id)
    ) order by o.created_at asc)
    from public.outposts o
    where public._defense_can_see(fid, o.system_id, o.faction_id)
  ), '[]'::jsonb);
end$$;
revoke all on function public.outposts_visible() from public;
grant execute on function public.outposts_visible() to authenticated;

-- ── RPC: разведданные от РАЗВЕД-аванпостов (mode='recon') ──
-- Каждый разведаванпост даёт размытый срез (как пассивная разведка, tier 1) по
-- СОСЕДНИМ по гиперпутям державам. Использует _pi_report из _passive_intel.sql.
create or replace function public.outpost_intel()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare me text; rep jsonb := '[]'::jsonb; r record;
begin
  me := public._ec_my_fid_opt();
  if me is null then return rep; end if;
  -- защита: если _pi_report недоступен (не применён _passive_intel.sql) — вернём системы-цели без отчёта
  for r in
    select distinct ns.faction as tgt, array_agg(distinct o.system_id) as via
    from public.outposts o
    join public.map_hyperlanes h on (h.a_id = o.system_id or h.b_id = o.system_id)
    join public.map_systems ns
      on ns.id = case when h.a_id = o.system_id then h.b_id else h.a_id end
    where o.faction_id = me and o.mode = 'recon'
      and ns.faction is not null and ns.faction <> me
    group by ns.faction
  loop
    if exists(select 1 from public.faction_economy fe where fe.faction_id = r.tgt) then
      begin
        rep := rep || (public._pi_report(me, r.tgt, 1, 'outpost') || jsonb_build_object('via', to_jsonb(r.via)));
      exception when undefined_function then
        rep := rep || jsonb_build_object('target_fid', r.tgt, 'target_name', public._fac_name(r.tgt),
                                         'source', 'outpost', 'via', to_jsonb(r.via));
      end;
    end if;
  end loop;
  return rep;
end$$;
revoke all on function public.outpost_intel() from public;
grant execute on function public.outpost_intel() to authenticated;

-- ── RPC: переключить режим уже развёрнутого аванпоста (разведка ↔ добыча) ──
-- При уходе ИЗ добычи — сперва доначисляем накопленное; при входе В добычу —
-- стартуем счётчик накопления с текущего момента.
create or replace function public.outpost_set_mode(p_id uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; op public.outposts; md text;
begin
  fid := public._ec_my_fid();
  md := lower(coalesce(p_mode,''));
  if md not in ('recon','mining') then raise exception 'unknown outpost mode: %', p_mode; end if;
  perform public._outpost_mining_settle(fid);   -- зафиксировать добычу до смены режима
  select * into op from public.outposts where id=p_id;
  if not found then raise exception 'outpost not found'; end if;
  if op.faction_id is distinct from fid then raise exception 'not your outpost'; end if;
  if op.mode = md then return jsonb_build_object('ok', true, 'mode', md, 'unchanged', true); end if;
  update public.outposts
    set mode = md,
        last_accrue = case when md='mining' then now() else last_accrue end
    where id = p_id;
  return jsonb_build_object('ok', true, 'mode', md);
end$$;
revoke all on function public.outpost_set_mode(uuid,text) from public;
grant execute on function public.outpost_set_mode(uuid,text) to authenticated;

-- ── RPC: разобрать развёрнутый аванпост (частичный возврат) ──
create or replace function public.outpost_dismantle(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; op public.outposts; refund numeric;
begin
  fid := public._ec_my_fid();
  perform public._outpost_mining_settle(fid);   -- доначислить добычу перед сносом
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
