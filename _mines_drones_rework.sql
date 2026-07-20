-- ============================================================
-- РЕВОРК МИН + ПОСТЫ ДРОНОВ (минирование СИСТЕМ, а не планет)
-- Применять в Supabase → SQL Editor ПОСЛЕ _defense_minefield.sql,
-- _war_intercept.sql и _battles_mine_fix.sql. Идемпотентно.
--
-- ЧТО МЕНЯЕТСЯ:
--  1) Планетарные гекс-мины ВЫРЕЗАНЫ: уже построенные поля у планет
--     разминируются с ПОЛНЫМ возвратом ГС, RPC minefield_lay/unlay удалены.
--  2) Вместо них — МИНИРОВАНИЕ СИСТЕМЫ: system_minefields с planet_pid=NULL,
--     колонка hexes теперь читается как ЗАРЯДЫ (1..sysmine_max).
--     Ставить можно там, где есть присутствие: свой флаг на системе,
--     своя колония или свой стоящий флот.
--  3) ПОСТЫ ДРОНОВ (system_drone_posts): крылья автономных дронов в системе.
--     Считают ПРО во флоте нарушителя (стволы «Зенитное» в проектах кораблей):
--     каждое aa_per_wing стволов ПРО связывает одно крыло. Непересиленные
--     крылья бьют СИЛЬНО СТРАШНЕЕ мин, и тем страшнее, чем их больше.
--  4) ВОЕННЫЙ ПРОЛЁТ: при войне с владельцем заграждения пролёт флота через
--     систему с шансом hazard_chance (95%) подрывает часть кораблей
--     (от нескольких до ВСЕХ). Вшито в _fleet_settle (надмножество
--     _battles_mine_fix.sql) — сработает при любом ленивом просчёте.
--     Пиратский хук _minefield_defend продолжает работать (сумма зарядов).
-- ?v=20260720minedrone1
-- ============================================================

-- ── 0) Константы заграждений ────────────────────────────────
create or replace function public._hazard_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'hazard_chance'      then 0.95   -- шанс срабатывания при военном пролёте
    when 'sysmine_cost'       then 6000   -- ГС за ОДИН заряд мин на систему
    when 'sysmine_max'        then 5      -- зарядов на систему на фракцию
    when 'sysmine_refund'     then 0.50   -- возврат при разминировании
    when 'mine_kill_base'     then 0.10   -- нижняя граница потерь (доля флота)
    when 'mine_kill_per_chg'  then 0.18   -- верх растёт с зарядами (кап 1.0 = весь флот)
    when 'dronewing_cost'     then 9000   -- ГС за ОДНО крыло дронов
    when 'dronewing_max'      then 12     -- крыльев на пост
    when 'dronewing_refund'   then 0.50
    when 'drone_aa_per_wing'  then 6      -- стволов ПРО («Зенитное»), связывающих 1 крыло
    when 'drone_kill_base'    then 0.20   -- дроны страшнее мин уже с первого крыла
    when 'drone_kill_per_wing' then 0.25  -- и растут с числом непересиленных крыльев
    else null end
$$;

-- ── 1) ВЫРЕЗАЕМ планетарные мины: полный возврат и снос ──────
-- «Понастроили дохуя» — возвращаем всё по номиналу гекса, чтобы никого не обокрасть.
do $$
declare r record; refund numeric;
begin
  for r in select faction_id, sum(greatest(1, hexes)) as hx
             from public.system_minefields
            where planet_pid is not null
            group by faction_id
  loop
    refund := r.hx * public._defense_const('mine_hex_cost');
    update public.faction_economy set gc = gc + refund where faction_id = r.faction_id;
  end loop;
  delete from public.system_minefields where planet_pid is not null;
end $$;

drop function if exists public.minefield_lay(text,int);
drop function if exists public.minefield_unlay(text,int);
-- minefield_clear(uuid) оставляем: снимает и системные поля (возврат ниже пересчитан).

-- ── 2) Присутствие в системе (право ставить заграждение) ─────
create or replace function public._hazard_presence(p_fid text, p_sys text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.map_systems s where s.id = p_sys and s.faction = p_fid)
      or exists(select 1 from public.colonies c where c.faction_id = p_fid and c.system_id = p_sys)
      or exists(select 1 from public.fleets f where f.faction_id = p_fid and f.status = 'idle' and f.system_id = p_sys)
$$;
revoke all on function public._hazard_presence(text,text) from public;

-- ── 3) RPC: минирование системы (заряды) ─────────────────────
create or replace function public.sysmine_lay(p_system_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; cost numeric; mx int; v_chg int;
begin
  fid := public._ec_my_fid();
  if not public._hazard_presence(fid, p_system_id) then
    raise exception 'нет присутствия в системе: нужен свой флаг, колония или стоящий флот';
  end if;
  mx := public._hazard_const('sysmine_max')::int;
  select hexes into v_chg from public.system_minefields
    where system_id=p_system_id and planet_pid is null and faction_id=fid;
  if coalesce(v_chg,0) >= mx then
    raise exception 'система уже заминирована полностью (% / % зарядов)', v_chg, mx;
  end if;
  cost := public._hazard_const('sysmine_cost');
  update public.faction_economy set gc = gc - cost where faction_id=fid and gc >= cost;
  if not found then raise exception 'not enough GC: заряд мин стоит %', cost; end if;
  insert into public.system_minefields(system_id, planet_pid, owner_id, faction_id, hexes)
    values(p_system_id, null, auth.uid(), fid, 1)
    on conflict (system_id, coalesce(planet_pid,-1), faction_id)
    do update set hexes = least(mx, public.system_minefields.hexes + 1)
    returning hexes into v_chg;
  return jsonb_build_object('ok', true, 'charges', v_chg, 'max', mx, 'cost', cost);
end$$;
revoke all on function public.sysmine_lay(text) from public;
grant execute on function public.sysmine_lay(text) to authenticated;

create or replace function public.sysmine_clear(p_system_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; mf public.system_minefields; refund numeric;
begin
  fid := public._ec_my_fid();
  select * into mf from public.system_minefields
    where system_id=p_system_id and planet_pid is null and faction_id=fid;
  if not found then raise exception 'в этой системе нет ваших мин'; end if;
  refund := floor(public._hazard_const('sysmine_cost')
                  * public._hazard_const('sysmine_refund') * greatest(1, mf.hexes));
  delete from public.system_minefields where id = mf.id;
  update public.faction_economy set gc = gc + refund where faction_id=fid;
  return jsonb_build_object('ok', true, 'refund', refund);
end$$;
revoke all on function public.sysmine_clear(text) from public;
grant execute on function public.sysmine_clear(text) to authenticated;

-- minefield_clear(uuid): пересобираем под системные заряды (возврат по sysmine_cost)
create or replace function public.minefield_clear(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; mf public.system_minefields; refund numeric;
begin
  fid := public._ec_my_fid();
  select * into mf from public.system_minefields where id=p_id;
  if not found then raise exception 'minefield not found'; end if;
  if mf.faction_id is distinct from fid then raise exception 'not your minefield'; end if;
  refund := floor(public._hazard_const('sysmine_cost')
                  * public._hazard_const('sysmine_refund') * greatest(1, mf.hexes));
  delete from public.system_minefields where id=p_id;
  update public.faction_economy set gc = gc + refund where faction_id=fid;
  return jsonb_build_object('ok', true, 'refund', refund);
end$$;

-- ── 4) Посты дронов ──────────────────────────────────────────
create table if not exists public.system_drone_posts (
  id         uuid primary key default gen_random_uuid(),
  system_id  text not null references public.map_systems(id) on delete cascade,
  owner_id   uuid,
  faction_id text not null,
  wings      int  not null default 1,     -- крыльев дронов (1..dronewing_max)
  created_at timestamptz default now(),
  unique(system_id, faction_id)
);
create index if not exists droneposts_sys_idx on public.system_drone_posts(system_id);
alter table public.system_drone_posts enable row level security;
drop policy if exists "dp_sel" on public.system_drone_posts;
create policy "dp_sel" on public.system_drone_posts for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
drop policy if exists "dp_all" on public.system_drone_posts;
create policy "dp_all" on public.system_drone_posts for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

create or replace function public.dronepost_build(p_system_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; cost numeric; mx int; v_w int;
begin
  fid := public._ec_my_fid();
  if not public._hazard_presence(fid, p_system_id) then
    raise exception 'нет присутствия в системе: нужен свой флаг, колония или стоящий флот';
  end if;
  mx := public._hazard_const('dronewing_max')::int;
  select wings into v_w from public.system_drone_posts where system_id=p_system_id and faction_id=fid;
  if coalesce(v_w,0) >= mx then
    raise exception 'пост дронов уже полный (% / % крыльев)', v_w, mx;
  end if;
  cost := public._hazard_const('dronewing_cost');
  update public.faction_economy set gc = gc - cost where faction_id=fid and gc >= cost;
  if not found then raise exception 'not enough GC: крыло дронов стоит %', cost; end if;
  insert into public.system_drone_posts(system_id, owner_id, faction_id, wings)
    values(p_system_id, auth.uid(), fid, 1)
    on conflict (system_id, faction_id)
    do update set wings = least(mx, public.system_drone_posts.wings + 1)
    returning wings into v_w;
  return jsonb_build_object('ok', true, 'wings', v_w, 'max', mx, 'cost', cost);
end$$;
revoke all on function public.dronepost_build(text) from public;
grant execute on function public.dronepost_build(text) to authenticated;

create or replace function public.dronepost_scrap(p_system_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; dp public.system_drone_posts; refund numeric;
begin
  fid := public._ec_my_fid();
  select * into dp from public.system_drone_posts where system_id=p_system_id and faction_id=fid;
  if not found then raise exception 'в этой системе нет вашего поста дронов'; end if;
  refund := floor(public._hazard_const('dronewing_cost')
                  * public._hazard_const('dronewing_refund') * greatest(1, dp.wings));
  delete from public.system_drone_posts where id = dp.id;
  update public.faction_economy set gc = gc + refund where faction_id=fid;
  return jsonb_build_object('ok', true, 'refund', refund);
end$$;
revoke all on function public.dronepost_scrap(text) from public;
grant execute on function public.dronepost_scrap(text) to authenticated;

-- ── 5) Видимость: мины (той же формой, что раньше) + посты ───
create or replace function public.minefields_visible()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', mf.id, 'system_id', mf.system_id, 'planet_pid', mf.planet_pid,
      'faction_id', mf.faction_id, 'hexes', mf.hexes, 'charges', mf.hexes,
      'hex_max', public._hazard_const('sysmine_max')::int,
      'mine', (mf.faction_id = fid)
    ))
    from public.system_minefields mf
    where public._defense_can_see(fid, mf.system_id, mf.faction_id)
  ), '[]'::jsonb);
end$$;

create or replace function public.droneposts_visible()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', dp.id, 'system_id', dp.system_id, 'faction_id', dp.faction_id,
      'wings', dp.wings, 'wing_max', public._hazard_const('dronewing_max')::int,
      'mine', (dp.faction_id = fid)
    ))
    from public.system_drone_posts dp
    where public._defense_can_see(fid, dp.system_id, dp.faction_id)
  ), '[]'::jsonb);
end$$;
revoke all on function public.droneposts_visible() from public;
grant execute on function public.droneposts_visible() to authenticated;

-- ── 6) ПРО во флоте: стволы «Зенитное» по проектам состава ───
create or replace function public._fleet_aa_count(p_fleet uuid)
returns int language sql stable security definer set search_path=public as $$
  select coalesce(sum(
    greatest(0, coalesce((c->>'qty')::int, 0)) *
    coalesce((select sum(greatest(1, coalesce((w->>'q')::int, 1)))
                from jsonb_array_elements(coalesce(u.data->'weapons','[]'::jsonb)) w
               where w->>'g' = 'Зенитное'), 0)
  ), 0)::int
  from public.fleets f
  cross join jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
  left join public.faction_units u on u.id = nullif(c->>'unit_id','')::uuid
  where f.id = p_fleet
$$;
revoke all on function public._fleet_aa_count(uuid) from public;

-- ── 7) Выбить N кораблей из состава флота (пропорционально) ──
-- Возвращает сколько реально выбито. Пустой флот удаляется.
create or replace function public._fleet_kill_ships(p_fleet uuid, p_kill int)
returns int language plpgsql security definer set search_path=public as $$
declare fl public.fleets; elem jsonb; comp jsonb := '[]'::jsonb;
        total int := 0; kill int; left_k int; q int; cut int; killed int := 0;
begin
  select * into fl from public.fleets where id = p_fleet for update;
  if not found then return 0; end if;
  select coalesce(sum(greatest(0,(c->>'qty')::int)),0) into total
    from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c;
  if total <= 0 then return 0; end if;
  kill := least(total, greatest(0, p_kill));
  if kill <= 0 then return 0; end if;
  left_k := kill;
  for elem in select value from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) loop
    q := greatest(0, coalesce((elem->>'qty')::int, 0));
    cut := least(q, ceil(kill * q::numeric / total)::int, left_k);
    left_k := left_k - cut; killed := killed + cut;
    if q - cut > 0 then
      comp := comp || jsonb_set(elem, '{qty}', to_jsonb(q - cut));
    end if;
  end loop;
  if killed < kill and jsonb_array_length(comp) > 0 then
    -- округления недобрали — добираем с первой строки
    q := greatest(0, coalesce((comp->0->>'qty')::int, 0));
    cut := least(q, kill - killed); killed := killed + cut;
    if q - cut > 0 then comp := jsonb_set(comp, '{0,qty}', to_jsonb(q - cut));
    else comp := comp - 0; end if;
  end if;
  if jsonb_array_length(comp) = 0 then
    delete from public.fleets where id = p_fleet;
  else
    update public.fleets set composition = comp where id = p_fleet;
  end if;
  return killed;
end$$;
revoke all on function public._fleet_kill_ships(uuid,int) from public;

-- ── 8) Новость о подрыве (обеим сторонам) ────────────────────
create or replace function public._hazard_news(p_fid text, p_title text, p_body text)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, published_at, created_at, updated_at)
    values(p_fid, '⚠ ЗАГРАЖДЕНИЯ', 'rgba(230,120,60,0.55)', null, null,
           p_title, null, p_body, 'approved', now(), now(), now());
exception when others then null;   -- новость не должна валить пролёт
end$$;
revoke all on function public._hazard_news(text,text,text) from public;

-- ── 9) Пролёт флота через заграждения системы ────────────────
-- Возвращает jsonb: {losses, wiped}. Работает только ПРИ ВОЙНЕ владельца
-- заграждения с фракцией флота. Мины: 95% срабатывание, потери от «нескольких»
-- до всех (верх растёт с зарядами), −1 заряд за подрыв. Дроны: ПРО флота
-- связывает крылья (aa_per_wing стволов = 1 крыло), непересиленные крылья
-- бьют страшнее мин; сбитые ПРО крылья списываются с поста, сработавшее — тоже.
create or replace function public._hazard_pass(p_fleet uuid, p_fid text, p_sys text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare mf record; dp record; w boolean; ships int; losses int := 0; l int;
        frac numeric; hi numeric; aa int; bound int; eff int; sysname text;
begin
  select coalesce(sum(greatest(0,(c->>'qty')::int)),0) into ships
    from public.fleets f, jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
   where f.id = p_fleet;
  if coalesce(ships,0) <= 0 then return jsonb_build_object('losses',0,'wiped',false); end if;
  select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = p_sys;

  -- 9.1 МИНЫ
  for mf in select * from public.system_minefields
             where system_id = p_sys and planet_pid is null
               and faction_id is distinct from p_fid and hexes > 0
  loop
    begin select public.at_war(p_fid, mf.faction_id) into w;
    exception when undefined_function then w := false; end;
    if not coalesce(w,false) then continue; end if;
    if random() > public._hazard_const('hazard_chance') then continue; end if;
    hi   := least(1.0, public._hazard_const('mine_kill_per_chg') * mf.hexes);
    frac := public._hazard_const('mine_kill_base')
            + random() * greatest(0, hi - public._hazard_const('mine_kill_base'));
    l := least(ships, greatest(1, round(ships * frac)::int));
    perform public._fleet_kill_ships(p_fleet, l);
    losses := losses + l; ships := ships - l;
    update public.system_minefields set hexes = hexes - 1 where id = mf.id;
    delete from public.system_minefields where id = mf.id and hexes <= 0;
    perform public._hazard_news(p_fid, '💥 Подрыв на минах: '||sysname,
      format('Флот напоролся на минные заграждения «%s» в системе %s. Потеряно кораблей: %s.',
             public._fac_name(mf.faction_id), sysname, l));
    perform public._hazard_news(mf.faction_id, '💥 Мины сработали: '||sysname,
      format('Минное поле в системе %s подорвало флот «%s». Уничтожено кораблей: %s. Израсходован 1 заряд.',
             sysname, public._fac_name(p_fid), l));
    if ships <= 0 then return jsonb_build_object('losses',losses,'wiped',true); end if;
  end loop;

  -- 9.2 ПОСТЫ ДРОНОВ
  for dp in select * from public.system_drone_posts
             where system_id = p_sys and faction_id is distinct from p_fid and wings > 0
  loop
    begin select public.at_war(p_fid, dp.faction_id) into w;
    exception when undefined_function then w := false; end;
    if not coalesce(w,false) then continue; end if;
    aa    := public._fleet_aa_count(p_fleet);
    bound := least(dp.wings, floor(aa / public._hazard_const('drone_aa_per_wing'))::int);
    eff   := dp.wings - bound;
    -- ПРО сбивает связанные крылья — пост «худеет» в любом случае
    if bound > 0 then
      update public.system_drone_posts set wings = wings - bound where id = dp.id;
      perform public._hazard_news(dp.faction_id, '🛰 ПРО против дронов: '||sysname,
        format('Зенитные расчёты флота «%s» сбили %s крыл. дронов поста в системе %s.',
               public._fac_name(p_fid), bound, sysname));
    end if;
    if eff > 0 and random() <= public._hazard_const('hazard_chance') then
      hi   := least(1.0, public._hazard_const('drone_kill_per_wing') * eff);
      frac := public._hazard_const('drone_kill_base')
              + random() * greatest(0, hi - public._hazard_const('drone_kill_base'));
      frac := least(1.0, frac);
      l := least(ships, greatest(1, round(ships * frac)::int));
      perform public._fleet_kill_ships(p_fleet, l);
      losses := losses + l; ships := ships - l;
      -- атака расходует одно крыло
      update public.system_drone_posts set wings = wings - 1 where id = dp.id;
      perform public._hazard_news(p_fid, '🛸 Атака дронов: '||sysname,
        format('Пост дронов «%s» в системе %s растерзал флот: потеряно кораблей — %s.%s',
               public._fac_name(dp.faction_id), sysname, l,
               case when aa <= 0 then ' Во флоте не было ни одного ствола ПРО.' else '' end));
      perform public._hazard_news(dp.faction_id, '🛸 Дроны сработали: '||sysname,
        format('Пост дронов в системе %s атаковал флот «%s». Уничтожено кораблей: %s.',
               sysname, public._fac_name(p_fid), l));
    end if;
    delete from public.system_drone_posts where id = dp.id and wings <= 0;
    if ships <= 0 then return jsonb_build_object('losses',losses,'wiped',true); end if;
  end loop;

  return jsonb_build_object('losses', losses, 'wiped', false);
end$$;
revoke all on function public._hazard_pass(uuid,text,text) from public;

-- ── 10) _fleet_settle — НАДМНОЖЕСТВО _war_intercept/_battles_mine_fix ──
-- Сохранены дословно: стоп по закрытым границам, перехват, встреча, оккупация.
-- ДОБАВЛЕНО: на каждом ПРОЛЁТНОМ шаге маршрута (и в точке посадки) флот
-- проходит _hazard_pass — мины и дроны воюющих с ним фракций. Уничтоженный
-- целиком флот исчезает, перехват/оккупация для него не считаются.
create or replace function public._fleet_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare fl record; path text[]; stop_sys text; i int; foe uuid; hit text; b uuid;
        hz jsonb; wiped boolean;
begin
  for fl in select id, from_sys, dest_sys from public.fleets
            where faction_id=p_fid and status='transit' and arrive_at <= now()
  loop
    -- 10.1 стоп по закрытым границам (как было)
    stop_sys := fl.dest_sys;
    if public._borders_blocked(p_fid, fl.dest_sys) then
      path := public._fleet_path(fl.from_sys, fl.dest_sys, p_fid, true);
      if path is null then
        path := public._fleet_path(fl.from_sys, fl.dest_sys, p_fid, false);
      end if;
      stop_sys := coalesce(fl.from_sys, fl.dest_sys);
      if path is not null then
        for i in 2..array_length(path, 1) loop
          exit when public._borders_blocked(p_fid, path[i]);
          stop_sys := path[i];
        end loop;
      end if;
    end if;

    -- 10.2 ПЕРЕХВАТ + ЗАГРАЖДЕНИЯ: идём по маршруту до stop_sys.
    -- В каждой системе шага сначала мины/дроны (флот может погибнуть или
    -- истаять), затем поиск вражеского заслона.
    foe := null; hit := null; wiped := false;
    if stop_sys is distinct from fl.from_sys then
      path := public._fleet_path(fl.from_sys, stop_sys, p_fid, true);
      if path is null then path := public._fleet_path(fl.from_sys, stop_sys, p_fid, false); end if;
      if path is not null then
        for i in 2..array_length(path, 1) loop
          hz := public._hazard_pass(fl.id, p_fid, path[i]);
          if coalesce((hz->>'wiped')::boolean, false) then wiped := true; hit := path[i]; exit; end if;
          foe := public._war_hostile_fleet(p_fid, path[i]);
          if foe is not null then hit := path[i]; exit; end if;
        end loop;
      end if;
    else
      -- флот «сел там же» (граница вернула) — заграждения точки всё равно встречают
      hz := public._hazard_pass(fl.id, p_fid, stop_sys);
      wiped := coalesce((hz->>'wiped')::boolean, false);
    end if;
    if wiped then continue; end if;   -- флот уничтожен заграждениями целиком
    if hit is not null then stop_sys := hit; end if;

    -- 10.3 посадка
    update public.fleets
      set status='idle', system_id=stop_sys, from_sys=null, dest_sys=null,
          depart_at=null, arrive_at=null
      where id = fl.id;

    -- 10.4 бой: перехват на трассе либо встреча в точке прибытия
    if foe is null then foe := public._war_hostile_fleet(p_fid, stop_sys); end if;
    if foe is not null then
      b := public._war_engage(fl.id, foe, stop_sys,
             case when hit is not null then 'intercept' else 'meeting' end);
    end if;

    -- 10.5 оккупация (как было); систему с боем не оккупируем
    if foe is null then
      perform public._war_occupy_check(p_fid, stop_sys, fl.id);
    end if;
  end loop;
end$$;
revoke all on function public._fleet_settle(text) from public;

-- ── 11) ДРОНЫ В БОЮ: залп в конце каждого хода ───────────────
-- Пост дронов в системе боя работает за свою сторону: в КОНЦЕ ХОДА крылья
-- бьют по живым кораблям противника. ПРО противника связывает крылья ровно
-- так же, как при пролёте (drone_aa_per_wing стволов «Зенитное» = 1 крыло),
-- и связанные крылья сбиваются насовсем. Урон одного крыла = drone_wing_dmg,
-- цели выбираются случайно, по одному крылу на цель. Пост сам не сбивается
-- боем: он тратится только на связанные ПРО крылья.
create or replace function public._hazard_const_dmg()
returns numeric language sql immutable as $$ select 900::numeric $$;   -- урон крыла за ход

-- Стволы ПРО у стороны в бою (по проектам живых кораблей)
create or replace function public._bt_side_aa(p_battle uuid, p_side text)
returns int language sql stable security definer set search_path=public as $$
  select coalesce(sum(
    coalesce((select sum(greatest(1, coalesce((w->>'q')::int, 1)))
                from jsonb_array_elements(coalesce(u.data->'weapons','[]'::jsonb)) w
               where w->>'g' = 'Зенитное'), 0)
  ), 0)::int
  from public.battle_units bu
  left join public.faction_units u on u.id = bu.unit_id
  where bu.battle_id = p_battle and bu.side = p_side and bu.alive
$$;
revoke all on function public._bt_side_aa(uuid,text) from public;

create or replace function public._bt_drone_strike(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $$
declare b public.battles; dp record; foe_side text; aa int; bound int; eff int;
        t record; dmg numeric; absorbed numeric; hull numeric; i int;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status <> 'active' then return; end if;

  for dp in select * from public.system_drone_posts
             where system_id = b.system_id and wings > 0
               and faction_id in (b.attacker_fid, b.defender_fid)
  loop
    foe_side := case when dp.faction_id = b.attacker_fid then 'defender' else 'attacker' end;
    aa    := public._bt_side_aa(p_battle, foe_side);
    bound := least(dp.wings, floor(aa / public._hazard_const('drone_aa_per_wing'))::int);
    eff   := dp.wings - bound;
    if bound > 0 then
      update public.system_drone_posts set wings = wings - bound where id = dp.id;
      perform public._bt_log(p_battle, format('ПРО сбивает %s крыл. дронов поста «%s»',
        bound, public._war_nm(dp.faction_id)));
    end if;
    if eff <= 0 then continue; end if;

    for i in 1..eff loop
      select * into t from public.battle_units
        where battle_id = p_battle and side = foe_side and alive
        order by random() limit 1;
      exit when t.id is null;
      dmg      := public._hazard_const_dmg();
      absorbed := least(t.shield, dmg);
      hull     := greatest(0, (dmg - absorbed) - t.armor);
      update public.battle_units
         set shield = t.shield - absorbed,
             hp = greatest(0, t.hp - hull),
             alive = (t.hp - hull) > 0
       where id = t.id;
      perform public._bt_log(p_battle, format('🛸 Крыло дронов «%s» → %s: %s урона%s',
        public._war_nm(dp.faction_id), t.unit_name, round(absorbed + hull),
        case when (t.hp - hull) <= 0 then ' — цель уничтожена' else '' end));
    end loop;
    delete from public.system_drone_posts where id = dp.id and wings <= 0;
  end loop;

  perform public._bt_check_end(p_battle);
end$$;
revoke all on function public._bt_drone_strike(uuid) from public;

-- battle_end_turn — НАДМНОЖЕСТВО _war_battle.sql + залп дронов в конце хода
create or replace function public.battle_end_turn(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; sd text; nxt text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  sd := b.side_to_move;

  if sd = 'attacker' then
    update public.battles set att_turns_left = greatest(0, att_turns_left - 1) where id = p_battle;
  else
    update public.battles set def_turns_left = greatest(0, def_turns_left - 1) where id = p_battle;
  end if;

  -- ⛯ дроны отрабатывают ДО передачи хода — «в конце хода»
  perform public._bt_drone_strike(p_battle);

  nxt := case when sd = 'attacker' then 'defender' else 'attacker' end;
  update public.battle_units set moved = false, fired = false
   where battle_id = p_battle and side = nxt;
  update public.battles
     set side_to_move = nxt, turn_no = turn_no + 1,
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;

  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true);
end$$;

-- battle_force_turn — то же самое для сгоревшего хода
create or replace function public.battle_force_turn(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b record; sd text; nxt text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle for update;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.status <> 'active' then raise exception 'бой не идёт'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;
  if b.side_to_move = sd then raise exception 'это ваш собственный ход'; end if;
  if b.deadline_at is null or b.deadline_at > now() then
    raise exception 'срок хода противника ещё не вышел';
  end if;

  if b.side_to_move = 'attacker' then
    update public.battles set att_turns_left = greatest(0, att_turns_left - 1) where id = p_battle;
  else
    update public.battles set def_turns_left = greatest(0, def_turns_left - 1) where id = p_battle;
  end if;
  perform public._bt_drone_strike(p_battle);
  nxt := case when b.side_to_move = 'attacker' then 'defender' else 'attacker' end;
  update public.battle_units set moved = false, fired = false where battle_id = p_battle and side = nxt;
  update public.battles
     set side_to_move = nxt, turn_no = turn_no + 1,
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;
  perform public._bt_log(p_battle, 'Сторона не явилась к сроку — ход сгорел.');
  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true);
end$$;

-- ── Проверка ────────────────────────────────────────────────
-- 1) Планетарные поля исчезли, ГС вернулись (hexes × 1000 за поле).
-- 2) sysmine_lay без присутствия → exception; со своим флотом в системе — ок.
-- 3) Война А↔Б, у Б мины (3 заряда) в системе X на трассе А:
--    fleet_send А через X → ~95% подрыв, потери 10..54% флота, у поля −1 заряд,
--    новости обеим сторонам.
-- 4) У Б пост дронов 4 крыла; во флоте А 0 стволов «Зенитное» → потери 20..100%.
--    Во флоте А ≥24 стволов ПРО → все крылья связаны, потерь нет, пост тает.
-- 5) Без войны всё пролетает молча.
-- 6) Бой в системе с постом дронов: в конце каждого хода в журнале боя строки
--    «🛸 Крыло дронов … → …», при большом ПРО противника — «ПРО сбивает N крыл.».
