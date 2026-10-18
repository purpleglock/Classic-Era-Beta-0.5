-- ════════════════════════════════════════════════════════════
-- НАЗЕМКА, ЭТАП 1 — ВЫСАДКА  (19.10.2026, спецификация «Наземная война»)
-- ------------------------------------------------------------
-- Армия летит к чужой колонии так же, как к своей (время перелёта ×1.5),
-- но с миссией 'invade'. Условия высадки:
--   • с владельцем колонии идёт война;
--   • орбита за нападающим: в системе стоит его флот (или флот союзника по
--     этой войне) либо система оккупирована им, и нет ни свободного
--     вражеского флота, ни идущего космического боя.
-- Проверка — при отправке и ещё раз при прибытии. Орбиту потеряли, пока
-- армия летела, — высадка срывается, армия поворачивает домой.
-- Прибыла и орбита наша — создаётся наземный бой (battles.kind = 'ground',
-- статус 'forming'). Его доску и ход строит этап 2; здесь только сбор сторон:
-- десант и гарнизон колонии (армии владельца на ней). Обе стороны на время
-- боя заперты (status = 'battle'). Ополчение и постройки добавит этап 2.
-- Высадки разбирает планировщик ground-landing-tick раз в 5 минут, чтобы
-- бой появлялся, даже если обе стороны не в сети.
-- Повторный запуск безопасен. Удалений данных в файле нет.
-- ════════════════════════════════════════════════════════════

-- ── Схема ────────────────────────────────────────────────────
alter table public.armies add column if not exists mission text not null default 'move';
alter table public.armies add column if not exists battle_id uuid;

alter table public.battles add column if not exists colony_id uuid references public.colonies(id) on delete set null;
alter table public.battles drop constraint if exists battles_kind_ck;
alter table public.battles add constraint battles_kind_ck
  check (kind = any (array['meeting','intercept','duel','ground']));

create table if not exists public.ground_battle_armies (
  battle_id uuid not null references public.battles(id) on delete cascade,
  army_id   uuid not null references public.armies(id) on delete cascade,
  fid       text not null,
  side      text not null check (side in ('attacker','defender')),
  joined_at timestamptz not null default now(),
  primary key (battle_id, army_id)
);
alter table public.ground_battle_armies enable row level security;
drop policy if exists gba_read on public.ground_battle_armies;
create policy gba_read on public.ground_battle_armies for select using (true);

create index if not exists armies_landing_idx on public.armies(arrive_at)
  where status = 'transit' and mission = 'invade';
create unique index if not exists battles_ground_colony_live
  on public.battles(colony_id) where kind = 'ground' and status <> 'done';

-- ── Константы ────────────────────────────────────────────────
create or replace function public._ground_const(p_key text) returns numeric
language sql immutable as $$
  select case p_key
    when 'fly_mult'    then 1.5   -- армия летит в полтора раза дольше флота
    when 'same_sys_h'  then 0.5   -- высадка с орбиты своей же системы
    else null end
$$;

-- ── Война между державами (id войны) ─────────────────────────
create or replace function public._ground_war_between(p_a text, p_b text) returns uuid
language sql stable security definer set search_path = public as $$
  select w.id from public.wars w
    join public.war_sides sa on sa.war_id = w.id and sa.fid = p_a
    join public.war_sides sb on sb.war_id = w.id and sb.fid = p_b
   where w.status = 'active' and sa.side <> sb.side
   order by w.started_at limit 1
$$;

-- ── Господство на орбите ─────────────────────────────────────
-- Да, если: в системе нет ни идущего боя, ни свободного вражеского флота,
-- и есть свой/союзный по войне флот на стоянке либо оккупация системы.
create or replace function public._ground_orbit_ok(p_fid text, p_sys text, p_foe text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare w uuid; my_side text;
begin
  if p_fid is null or p_sys is null or p_foe is null then return false; end if;
  if exists (select 1 from public.battles b
              where b.system_id = p_sys and b.status <> 'done' and b.kind <> 'ground') then
    return false;
  end if;
  if public._war_hostile_fleet(p_fid, p_sys) is not null then return false; end if;

  if exists (select 1 from public.system_occupation o
              where o.system_id = p_sys and o.occupier_fid = p_fid) then
    return true;
  end if;

  w := public._ground_war_between(p_fid, p_foe);
  my_side := public._war_side_of(w, p_fid);
  return exists (
    select 1 from public.fleets f
     where f.system_id = p_sys and f.status = 'idle'
       and (f.faction_id = p_fid
            or exists (select 1 from public.war_sides s
                        where s.war_id = w and s.fid = f.faction_id and s.side = my_side)));
end $$;

-- ── Справка для клиента: можно ли высаживаться на колонию ────
create or replace function public.ground_landing_check(p_colony uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me text; c public.colonies;
begin
  me := public._ec_my_fid();
  select * into c from public.colonies where id = p_colony;
  if c.id is null then return jsonb_build_object('ok', false, 'why', 'колония не найдена'); end if;
  if c.faction_id = me then return jsonb_build_object('ok', false, 'why', 'это ваша колония'); end if;
  if not public.at_war(me, c.faction_id) then
    return jsonb_build_object('ok', false, 'why', 'с владельцем колонии нет войны');
  end if;
  if not public._ground_orbit_ok(me, c.system_id, c.faction_id) then
    return jsonb_build_object('ok', false, 'why', 'орбита не ваша: нужен свой флот в системе без вражеских флотов и боёв');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── Отправка армии на высадку ────────────────────────────────
create or replace function public.army_invade__raw(p_id uuid, p_colony uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fid text; ar public.armies; c public.colonies; from_sys text; fly_h numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  perform public._army_settle(fid);
  select * into ar from public.armies where id = p_id for update;
  if ar.id is null then raise exception 'army not found'; end if;
  if ar.faction_id is distinct from fid then raise exception 'not your army'; end if;
  if ar.status <> 'idle' then raise exception 'армия уже на марше или в бою'; end if;

  select * into c from public.colonies where id = p_colony;
  if c.id is null then raise exception 'колония не найдена'; end if;
  if c.faction_id = fid then raise exception 'на свою колонию армию перебрасывают, а не высаживают'; end if;
  if not public.at_war(fid, c.faction_id) then
    raise exception 'высадка возможна только на колонию державы, с которой идёт война';
  end if;
  if not public._ground_orbit_ok(fid, c.system_id, c.faction_id) then
    raise exception 'орбита не ваша: в системе нужен ваш флот (или союзный по войне), без вражеских флотов и идущих боёв';
  end if;

  select system_id into from_sys from public.colonies where id = ar.colony_id;
  if from_sys is not distinct from c.system_id then
    fly_h := public._ground_const('same_sys_h');
  else
    fly_h := coalesce(public._fleet_fly_hours(from_sys, c.system_id), 2.0) * public._ground_const('fly_mult');
  end if;

  update public.armies
     set status = 'transit', mission = 'invade', from_colony = colony_id, dest_colony = p_colony,
         colony_id = null, depart_at = now(), arrive_at = now() + (fly_h || ' hours')::interval
   where id = p_id;
  return jsonb_build_object('ok', true, 'fly_h', round(fly_h, 1),
                            'arrive_at', now() + (fly_h || ' hours')::interval);
end $$;

create or replace function public.army_invade(p_id uuid, p_colony uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._fm_gate('army', 'army', p_id::text);
  return public.army_invade__raw(p_id, p_colony);
end $$;
revoke all on function public.army_invade__raw(uuid, uuid) from public, anon, authenticated;
grant execute on function public.army_invade(uuid, uuid) to authenticated;

-- ── Обычное прибытие не трогает десант ───────────────────────
create or replace function public._army_settle(p_fid text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.armies
    set status='idle', colony_id=dest_colony, from_colony=null, dest_colony=null,
        depart_at=null, arrive_at=null, mission='move'
    where faction_id=p_fid and status='transit' and mission = 'move' and arrive_at <= now();
end $$;

-- ── Разбор прибывших десантов ────────────────────────────────
create or replace function public._ground_landing_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare ar record; c public.colonies; b uuid; w uuid; back_h numeric; home uuid;
        n_land int := 0; n_back int := 0; sysname text;
begin
  for ar in select * from public.armies
             where status = 'transit' and mission = 'invade' and arrive_at <= now()
             order by arrive_at for update skip locked loop
    select * into c from public.colonies where id = ar.dest_colony;
    select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = c.system_id;

    -- Высадка сорвана: колонии нет, она наша, войны нет или орбиту потеряли
    if c.id is null or c.faction_id = ar.faction_id
       or not public.at_war(ar.faction_id, c.faction_id)
       or not public._ground_orbit_ok(ar.faction_id, c.system_id, c.faction_id) then
      home := coalesce(ar.from_colony, ar.home_colony);
      back_h := coalesce(public._fleet_fly_hours(c.system_id,
                  (select system_id from public.colonies where id = home)), 2.0) * public._ground_const('fly_mult');
      update public.armies
         set mission = 'move', dest_colony = home, from_colony = ar.dest_colony,
             depart_at = now(), arrive_at = now() + (back_h || ' hours')::interval
       where id = ar.id;
      perform public._war_news('🪂 Высадка сорвана' || coalesce(': ' || sysname, ''),
        format('Десант державы %s не смог высадиться%s: орбита больше не под контролем. Армия поворачивает домой.',
               public._war_nm(ar.faction_id), coalesce(' в системе ' || sysname, '')),
        jsonb_build_array(ar.faction_id));
      n_back := n_back + 1;
      continue;
    end if;

    -- Наземный бой за колонию: присоединяемся к идущему или открываем новый
    select id into b from public.battles
     where kind = 'ground' and colony_id = c.id and status <> 'done' limit 1;
    if b is null then
      w := public._ground_war_between(ar.faction_id, c.faction_id);
      insert into public.battles(system_id, war_id, attacker_fid, defender_fid, status, kind, colony_id)
        values (c.system_id, w, ar.faction_id, c.faction_id, 'forming', 'ground', c.id)
        returning id into b;
      -- гарнизон колонии встаёт в оборону
      insert into public.ground_battle_armies(battle_id, army_id, fid, side)
        select b, g.id, g.faction_id, 'defender' from public.armies g
         where g.colony_id = c.id and g.status = 'idle' and g.faction_id = c.faction_id
        on conflict do nothing;
      update public.armies set status = 'battle', battle_id = b
       where colony_id = c.id and status = 'idle' and faction_id = c.faction_id;
      perform public._war_news('🪂 Высадка: ' || coalesce(c.planet_name, sysname, 'колония'),
        format('Десант державы %s высадился на колонию %s%s державы %s. Начинается наземный бой.',
               public._war_nm(ar.faction_id), coalesce('«' || c.planet_name || '» ', ''),
               coalesce('в системе ' || sysname, ''), public._war_nm(c.faction_id)),
        jsonb_build_array(ar.faction_id, c.faction_id));
    end if;

    insert into public.ground_battle_armies(battle_id, army_id, fid, side)
      values (b, ar.id, ar.faction_id,
              case when (select attacker_fid from public.battles where id = b) = ar.faction_id
                   then 'attacker' else 'defender' end)
      on conflict do nothing;
    update public.armies set status = 'battle', battle_id = b, colony_id = c.id,
           from_colony = null, depart_at = null, arrive_at = null
     where id = ar.id;
    n_land := n_land + 1;
  end loop;
  return jsonb_build_object('ok', true, 'landed', n_land, 'bounced', n_back);
end $$;
revoke all on function public._ground_landing_tick() from public, anon, authenticated;

-- ── Мои армии: миссия и бой ──────────────────────────────────
create or replace function public.armies_mine() returns jsonb
language plpgsql security definer set search_path = public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._army_settle(fid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'status', a.status, 'mission', a.mission, 'battle_id', a.battle_id,
      'colony_id', a.colony_id, 'from_colony', a.from_colony, 'dest_colony', a.dest_colony,
      'home_colony', a.home_colony, 'composition', a.composition,
      'depart_at', a.depart_at, 'arrive_at', a.arrive_at,
      'system_id', (select system_id from public.colonies c where c.id = a.colony_id),
      'from_system_id', (select system_id from public.colonies c where c.id = a.from_colony),
      'dest_system_id', (select system_id from public.colonies c where c.id = a.dest_colony),
      'planet_name', (select planet_name from public.colonies c where c.id = a.colony_id),
      'dest_planet_name', (select planet_name from public.colonies c where c.id = a.dest_colony),
      'units', (select coalesce(sum(greatest(0,(c->>'qty')::int)),0)
                from jsonb_array_elements(coalesce(a.composition,'[]'::jsonb)) c),
      'can_recall', (a.status='idle' and a.home_colony is not null and a.colony_id is distinct from a.home_colony)
    ) order by a.created_at asc)
    from public.armies a where a.faction_id = fid
  ), '[]'::jsonb);
end $$;

-- ── Расписание ───────────────────────────────────────────────
do $$ begin
  perform cron.unschedule('ground-landing-tick');
exception when others then null; end $$;
select cron.schedule('ground-landing-tick', '*/5 * * * *', 'select public._ground_landing_tick();');

-- ── Космос не трогает наземный бой ───────────────────────────
-- Без этого флот нападающего на орбите (_war_sweep → _war_join_battle) вступил
-- бы в наземный бой и был бы им скован, а сама высадка блокировала бы систему
-- для третьих держав. Список «Мои бои» до клиента этапа 4 наземку не показывает:
-- открыть её доску пока нечем. Правки точечные, повторный прогон их не дублирует.
do $$
declare d text;
begin
  d := pg_get_functiondef('public._war_join_battle(text,text,uuid)'::regprocedure);
  if position('b.kind <> ''ground''' in d) = 0 then
    execute replace(d, 'where b.system_id = p_sys and b.status <> ''done''',
                       'where b.system_id = p_sys and b.status <> ''done'' and b.kind <> ''ground''');
  end if;
  d := pg_get_functiondef('public._war_battle_block(text,text)'::regprocedure);
  if position('b.kind <> ''ground''' in d) = 0 then
    execute replace(d, 'where b.system_id = p_sys and b.status <> ''done''',
                       'where b.system_id = p_sys and b.status <> ''done'' and b.kind <> ''ground''');
  end if;
  d := pg_get_functiondef('public.battles_mine()'::regprocedure);
  if position('b.kind <> ''ground''' in d) = 0 then
    execute replace(d, 'where b.status <> ''done''', 'where b.status <> ''done'' and b.kind <> ''ground''');
  end if;
end $$;
