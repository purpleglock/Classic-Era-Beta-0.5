-- ════════════════════════════════════════════════════════════
-- НАЗЕМКА, ЭТАП 3 — ЗАХВАТ КОЛОНИИ  (19.10.2026)
-- ------------------------------------------------------------
-- Победа десанта (этап 2 зовёт _ground_on_capture) ставит колонию в
-- ОККУПАЦИЮ на трое суток (colony_occupation). Пока она идёт:
--   • владелец может высадиться на свою же колонию и отбить её тем же
--     наземным боем (освобождение; ополчение в нём не участвует — колония
--     под чужим флагом), отбил — оккупация снята;
--   • оккупант может грабить склад владельца армией, стоящей на колонии
--     (army_plunder): доля ГС и сырья, раз в сутки на колонию;
--   • оккупация снимается сама, если на колонии не осталось армии
--     оккупанта или война между ними кончилась.
-- По истечении срока колония со всеми постройками переходит оккупанту.
-- Если у прежнего владельца в этой системе колоний не осталось, система на
-- карте тоже переходит. Взятая СТОЛИЦА — это полная капитуляция державы
-- (решение владельца игры): вся держава уходит захватчику через
-- _war_capitulate.
-- Высадку на чужую колонию теперь определяет тот, кто её ДЕРЖИТ: на
-- оккупированную колонию нападают, воюя с оккупантом.
-- Доход колонии в оккупации пока не перекрыт — это правка экономики,
-- она идёт отдельным шагом.
-- Планировщик ground-occupation-tick — раз в 10 минут.
-- Повторный запуск безопасен.
-- ════════════════════════════════════════════════════════════

-- ── Константы ────────────────────────────────────────────────
create or replace function public._ground_const(p_key text) returns numeric
language sql immutable as $$
  select case p_key
    when 'fly_mult'        then 1.5   -- армия летит в полтора раза дольше флота
    when 'same_sys_h'      then 0.5   -- высадка с орбиты своей системы
    when 'turns'           then 15    -- ходов на сторону до ничьей
    when 'board_w'         then 30    -- поле наземного боя
    when 'board_h'         then 22
    when 'form_h'          then 12    -- часов на расстановку
    when 'militia_per_pop' then 0.5   -- ополченцев на единицу населения
    when 'militia_stacks'  then 3     -- отрядов ополчения
    when 'militia_min'     then 20    -- ополченцев не меньше
    when 'training_mult'   then 1.5   -- центр подготовки: ополчение крепче
    when 'hq_hp_per_bld'   then 400   -- корпус узла обороны за постройку
    when 'hold_h'          then 72    -- оккупация до перехода колонии, часов
    when 'plunder_cd_h'    then 24    -- грабёж одной колонии не чаще, часов
    when 'plunder_share'   then 0.05  -- доля ГС и сырья владельца за налёт
    else null end
$$;

-- ── Схема ────────────────────────────────────────────────────
create table if not exists public.colony_occupation (
  colony_id    uuid primary key references public.colonies(id) on delete cascade,
  occupier_fid text not null,
  owner_fid    text not null,
  battle_id    uuid,
  since        timestamptz not null default now(),
  transfer_at  timestamptz not null,
  plundered_at timestamptz
);
alter table public.colony_occupation enable row level security;
drop policy if exists colony_occupation_read on public.colony_occupation;
create policy colony_occupation_read on public.colony_occupation for select using (true);

-- Кто держит колонию сейчас: оккупант или владелец
create or replace function public._ground_holder(p_colony uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select occupier_fid from public.colony_occupation where colony_id = p_colony),
                  (select faction_id from public.colonies where id = p_colony))
$$;

-- ── Победа десанта ───────────────────────────────────────────
create or replace function public._ground_on_capture(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.battles; c public.colonies; occ public.colony_occupation; nm text;
begin
  select * into b from public.battles where id = p_battle;
  select * into c from public.colonies where id = b.colony_id;
  if c.id is null then return; end if;
  select * into occ from public.colony_occupation where colony_id = c.id;
  nm := coalesce('«' || c.planet_name || '»', 'колония');

  -- Освобождение: владелец отбил свою колонию
  if b.attacker_fid = c.faction_id then
    delete from public.colony_occupation where colony_id = c.id;
    perform public._war_news('🏳 Колония освобождена: ' || coalesce(c.planet_name, ''),
      format('%s отбивает %s у %s. Оккупация снята.',
             public._war_nm(c.faction_id), nm, public._war_nm(coalesce(occ.occupier_fid, b.defender_fid))),
      jsonb_build_array(c.faction_id, coalesce(occ.occupier_fid, b.defender_fid)));
    return;
  end if;

  insert into public.colony_occupation(colony_id, occupier_fid, owner_fid, battle_id, transfer_at)
    values (c.id, b.attacker_fid, c.faction_id, p_battle,
            now() + (public._ground_const('hold_h') || ' hours')::interval)
  on conflict (colony_id) do update
    set occupier_fid = excluded.occupier_fid, battle_id = excluded.battle_id,
        since = now(), transfer_at = excluded.transfer_at, plundered_at = null;
  perform public._war_news('⚑ Оккупация: ' || coalesce(c.planet_name, 'колония'),
    format('%s занимает %s державы %s. Если за трое суток колонию не отобьют, она перейдёт под новый флаг%s.',
           public._war_nm(b.attacker_fid), nm, public._war_nm(c.faction_id),
           case when c.is_capital then ' — а с падением столицы капитулирует вся держава' else '' end),
    jsonb_build_array(b.attacker_fid, c.faction_id));
end $$;
revoke all on function public._ground_on_capture(uuid) from public, anon, authenticated;

-- ── Высадка: цель определяет тот, кто держит колонию ─────────
create or replace function public.ground_landing_check(p_colony uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me text; c public.colonies; holder text;
begin
  me := public._ec_my_fid();
  select * into c from public.colonies where id = p_colony;
  if c.id is null then return jsonb_build_object('ok', false, 'why', 'колония не найдена'); end if;
  holder := public._ground_holder(c.id);
  if holder = me then return jsonb_build_object('ok', false, 'why', 'колония и так ваша'); end if;
  if not public.at_war(me, holder) then
    return jsonb_build_object('ok', false, 'why', 'с тем, кто держит колонию, нет войны');
  end if;
  if not public._ground_orbit_ok(me, c.system_id, holder) then
    return jsonb_build_object('ok', false, 'why', 'орбита не ваша: нужен свой флот в системе без вражеских флотов и боёв');
  end if;
  return jsonb_build_object('ok', true, 'liberation', c.faction_id = me);
end $$;

create or replace function public.army_invade__raw(p_id uuid, p_colony uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fid text; ar public.armies; c public.colonies; holder text; from_sys text; fly_h numeric;
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
  holder := public._ground_holder(c.id);
  if holder = fid then raise exception 'колония и так ваша — армию перебрасывают, а не высаживают'; end if;
  if not public.at_war(fid, holder) then
    raise exception 'высадка возможна только на колонию, которую держит держава, с которой идёт война';
  end if;
  if not public._ground_orbit_ok(fid, c.system_id, holder) then
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
                            'arrive_at', now() + (fly_h || ' hours')::interval,
                            'liberation', c.faction_id = fid);
end $$;

-- Разбор прибывших десантов (этап 1) с учётом оккупации
create or replace function public._ground_landing_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare ar record; c public.colonies; holder text; b uuid; w uuid; back_h numeric; home uuid;
        n_land int := 0; n_back int := 0; sysname text; lib boolean;
begin
  for ar in select * from public.armies
             where status = 'transit' and mission = 'invade' and arrive_at <= now()
             order by arrive_at for update skip locked loop
    select * into c from public.colonies where id = ar.dest_colony;
    holder := public._ground_holder(c.id);
    select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = c.system_id;

    if c.id is null or holder = ar.faction_id
       or not public.at_war(ar.faction_id, holder)
       or not public._ground_orbit_ok(ar.faction_id, c.system_id, holder) then
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

    lib := (c.faction_id = ar.faction_id);   -- владелец отбивает свою колонию
    select id into b from public.battles
     where kind = 'ground' and colony_id = c.id and status <> 'done' limit 1;
    if b is null then
      w := public._ground_war_between(ar.faction_id, holder);
      insert into public.battles(system_id, war_id, attacker_fid, defender_fid, status, kind, colony_id, pk)
        values (c.system_id, w, ar.faction_id, holder, 'forming', 'ground', c.id,
                jsonb_build_object('no_militia', lib))
        returning id into b;
      insert into public.ground_battle_armies(battle_id, army_id, fid, side)
        select b, g.id, g.faction_id, 'defender' from public.armies g
         where g.colony_id = c.id and g.status = 'idle' and g.faction_id = holder
        on conflict do nothing;
      update public.armies set status = 'battle', battle_id = b
       where colony_id = c.id and status = 'idle' and faction_id = holder;
      perform public._war_news('🪂 Высадка: ' || coalesce(c.planet_name, sysname, 'колония'),
        format(case when lib then 'Держава %s высаживается на свою колонию %s%s, занятую %s. Начинается бой за освобождение.'
                    else 'Десант державы %s высадился на колонию %s%s державы %s. Начинается наземный бой.' end,
               public._war_nm(ar.faction_id), coalesce('«' || c.planet_name || '» ', ''),
               coalesce('в системе ' || sysname, ''), public._war_nm(holder)),
        jsonb_build_array(ar.faction_id, holder));
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

-- В бою за освобождение ополчение колонии не встаёт на сторону оккупанта
do $$
declare d text;
begin
  d := pg_get_functiondef('public._ground_npc_deploy(uuid)'::regprocedure);
  if position('no_militia' in d) = 0 then
    execute replace(d, 'if b.kind <> ''ground'' or b.status <> ''forming'' then return 0; end if;',
      'if b.kind <> ''ground'' or b.status <> ''forming'' then return 0; end if;
  if coalesce((b.pk->>''no_militia'')::boolean, false) then return 0; end if;');
  end if;
end $$;

-- ── Грабёж колонии в оккупации ───────────────────────────────
create or replace function public.army_plunder__raw(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fid text; ar public.armies; occ public.colony_occupation; c public.colonies;
        sh numeric; gc_take numeric := 0; res jsonb; took jsonb := '{}'::jsonb; k text; v numeric; q numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into ar from public.armies where id = p_id;
  if ar.id is null then raise exception 'army not found'; end if;
  if ar.faction_id is distinct from fid then raise exception 'not your army'; end if;
  if ar.status <> 'idle' or ar.colony_id is null then raise exception 'армия должна стоять на колонии'; end if;
  select * into occ from public.colony_occupation where colony_id = ar.colony_id for update;
  if occ.colony_id is null or occ.occupier_fid <> fid then
    raise exception 'грабить можно только колонию, которую держит ваша армия';
  end if;
  if occ.plundered_at is not null
     and occ.plundered_at > now() - (public._ground_const('plunder_cd_h') || ' hours')::interval then
    raise exception 'колонию уже вычистили: следующий налёт через %',
      to_char(occ.plundered_at + (public._ground_const('plunder_cd_h') || ' hours')::interval - now(), 'HH24:MI');
  end if;
  select * into c from public.colonies where id = ar.colony_id;
  sh := public._ground_const('plunder_share');

  select greatest(0, floor(coalesce(gc, 0) * sh)), coalesce(resources, '{}'::jsonb) into gc_take, res
    from public.faction_economy where faction_id = occ.owner_fid for update;
  for k, v in select key, value::numeric from jsonb_each_text(coalesce(res, '{}'::jsonb)) loop
    q := floor(greatest(0, v) * sh);
    if q > 0 then
      res  := jsonb_set(res, array[k], to_jsonb(v - q));
      took := jsonb_set(took, array[k], to_jsonb(q));
    end if;
  end loop;
  update public.faction_economy set gc = gc - gc_take, resources = res where faction_id = occ.owner_fid;
  update public.faction_economy e
     set gc = coalesce(e.gc, 0) + gc_take,
         resources = (select coalesce(jsonb_object_agg(key, to_jsonb(s)), '{}'::jsonb) from (
           select key, sum(value::numeric) s from (
             select * from jsonb_each_text(coalesce(e.resources, '{}'::jsonb))
             union all select * from jsonb_each_text(took)) x group by key) y)
   where e.faction_id = fid;
  update public.colony_occupation set plundered_at = now() where colony_id = occ.colony_id;

  perform public._war_news('💰 Разграбление: ' || coalesce(c.planet_name, 'колония'),
    format('Армия державы %s выносит склады колонии %s: %s ГС и сырьё державы %s.',
           public._war_nm(fid), coalesce('«' || c.planet_name || '»', ''), gc_take::bigint, public._war_nm(occ.owner_fid)),
    jsonb_build_array(fid, occ.owner_fid));
  return jsonb_build_object('ok', true, 'gc', gc_take, 'resources', took,
    'next_at', now() + (public._ground_const('plunder_cd_h') || ' hours')::interval);
end $$;

create or replace function public.army_plunder(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._fm_gate('army', 'army', p_id::text);
  return public.army_plunder__raw(p_id);
end $$;
revoke all on function public.army_plunder__raw(uuid) from public, anon, authenticated;
grant execute on function public.army_plunder(uuid) to authenticated;

-- ── Переход колонии ──────────────────────────────────────────
create or replace function public._ground_transfer(p_colony uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare occ public.colony_occupation; c public.colonies; new_owner uuid; w uuid; nm text;
begin
  select * into occ from public.colony_occupation where colony_id = p_colony for update;
  select * into c from public.colonies where id = p_colony for update;
  if occ.colony_id is null or c.id is null then return jsonb_build_object('ok', false); end if;
  nm := coalesce('«' || c.planet_name || '»', 'колония');

  -- Пала столица — капитулирует вся держава
  if c.is_capital then
    w := public._ground_war_between(occ.occupier_fid, occ.owner_fid);
    delete from public.colony_occupation where colony_id = p_colony;
    if w is not null then
      perform public._war_capitulate(w, occ.occupier_fid, occ.owner_fid,
        format('пала столица %s', nm));
      return jsonb_build_object('ok', true, 'capitulation', true);
    end if;
  end if;

  select owner_id into new_owner from public.faction_applications
   where faction_id = occ.occupier_fid and status = 'approved' order by updated_at desc limit 1;

  update public.colonies set faction_id = occ.occupier_fid, owner_id = coalesce(new_owner, owner_id),
         is_capital = false
   where id = p_colony;
  update public.colony_buildings set faction_id = occ.occupier_fid, owner_id = coalesce(new_owner, owner_id)
   where colony_id = p_colony;

  -- система на карте — тоже, если у прежнего владельца в ней ничего не осталось
  if not exists (select 1 from public.colonies where system_id = c.system_id and faction_id = occ.owner_fid) then
    update public.map_systems set faction = occ.occupier_fid
     where id = c.system_id and faction = occ.owner_fid;
  end if;

  delete from public.colony_occupation where colony_id = p_colony;
  perform public._war_news('🏴 Колония перешла: ' || coalesce(c.planet_name, ''),
    format('Трое суток %s держала %s, и колония отходит ей. Держава %s потеряла её со всеми постройками.',
           public._war_nm(occ.occupier_fid), nm, public._war_nm(occ.owner_fid)),
    jsonb_build_array(occ.occupier_fid, occ.owner_fid));
  return jsonb_build_object('ok', true, 'capitulation', false);
end $$;
revoke all on function public._ground_transfer(uuid) from public, anon, authenticated;

-- ── Планировщик оккупаций ────────────────────────────────────
create or replace function public._ground_occupation_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; c public.colonies; n_lift int := 0; n_move int := 0; why text;
begin
  for o in select * from public.colony_occupation order by since for update skip locked loop
    select * into c from public.colonies where id = o.colony_id;
    why := null;
    if c.id is null then why := 'колонии больше нет';
    elsif c.faction_id = o.occupier_fid then why := 'колония уже принадлежит оккупанту';
    elsif c.faction_id <> o.owner_fid then why := 'у колонии сменился владелец';
    elsif not public.at_war(o.occupier_fid, o.owner_fid) then why := 'война окончена';
    elsif exists (select 1 from public.battles b where b.kind = 'ground' and b.colony_id = o.colony_id
                    and b.status <> 'done') then
      continue;                                       -- за колонию идёт бой: ждём исхода
    elsif not exists (select 1 from public.armies a where a.colony_id = o.colony_id
                        and a.faction_id = o.occupier_fid and a.status = 'idle') then
      why := 'на колонии не осталось армии оккупанта';
    end if;

    if why is not null then
      delete from public.colony_occupation where colony_id = o.colony_id;
      if c.id is not null and c.faction_id = o.owner_fid then
        perform public._war_news('🏳 Оккупация снята: ' || coalesce(c.planet_name, ''),
          format('Колония %s снова под флагом %s: %s.', coalesce('«' || c.planet_name || '»', ''),
                 public._war_nm(o.owner_fid), why),
          jsonb_build_array(o.owner_fid, o.occupier_fid));
      end if;
      n_lift := n_lift + 1;
      continue;
    end if;

    if o.transfer_at <= now() then
      perform public._ground_transfer(o.colony_id);
      n_move := n_move + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'lifted', n_lift, 'transferred', n_move);
end $$;
revoke all on function public._ground_occupation_tick() from public, anon, authenticated;

-- ── Справка для клиента ──────────────────────────────────────
create or replace function public.colony_occupations() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'colony_id', o.colony_id, 'planet_name', c.planet_name, 'system_id', c.system_id,
    'occupier', o.occupier_fid, 'occupier_name', public._war_nm(o.occupier_fid),
    'owner', o.owner_fid, 'owner_name', public._war_nm(o.owner_fid),
    'since', o.since, 'transfer_at', o.transfer_at, 'plundered_at', o.plundered_at,
    'is_capital', c.is_capital) order by o.transfer_at), '[]'::jsonb)
  from public.colony_occupation o join public.colonies c on c.id = o.colony_id
$$;
grant execute on function public.colony_occupations() to authenticated, anon;

-- ── Расписание ───────────────────────────────────────────────
do $$ begin
  perform cron.unschedule('ground-occupation-tick');
exception when others then null; end $$;
select cron.schedule('ground-occupation-tick', '3-59/10 * * * *', 'select public._ground_occupation_tick();');
