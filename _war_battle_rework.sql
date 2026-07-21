-- ============================================================
-- ПЕРЕРАБОТКА БОЁВ: ГЕКС-ДОСКА + 6 АКТИВАЦИЙ + ТТХ ИЗ КОНСТРУКТОРА
--
-- Применять в Supabase → SQL Editor ПОСЛЕ _war_battle.sql
-- (и ПОСЛЕ свежих _unit_catalog.sql + _unit_publish.sql — оттуда
-- приходит summary.rng, дальность огня из орудий KV).
--
-- ЧТО МЕНЯЕТСЯ:
--  1) Доска 48×28 ГЕКСОВ (flat-top, odd-q offset) вместо 26×16 квадратов.
--     Вся дистанция — гексовая (_bt_dist), клиент зеркалит.
--  2) ХОД СТОРОНЫ = 6 АКТИВАЦИЙ КОРАБЛЯМИ, а не «все корабли ходят».
--     Активация = корабль впервые действует (ход и/или выстрел) в этом
--     ходу. Один корабль за ход по-прежнему: 1 перемещение + 1 выстрел.
--     Когда активации кончились — остальные корабли стоят.
--  3) ТТХ из конструктора (KV): подвижность = summary.speed (те самые
--     «квадраты» из форжа), дальность огня = summary.rng (max dalnost
--     установленных орудий). Никаких таблиц «класс → дальность».
--  4) Спавны: зоны разворачивания — 4 колонки со своего края; подкрепление
--     выходит на свою кромку в свободный гекс ближе к центру, а не «в
--     первый попавшийся сверху».
-- ?v=20260721battle1
-- ============================================================

-- ── 1) Доска и активации ─────────────────────────────────────
create or replace function public._bt_w() returns int language sql immutable as $$ select 48 $$;
create or replace function public._bt_h() returns int language sql immutable as $$ select 28 $$;
-- ширина зоны разворачивания (колонок со своего края)
create or replace function public._bt_zone() returns int language sql immutable as $$ select 4 $$;
-- активаций кораблями на один ход стороны
create or replace function public._bt_acts() returns int language sql immutable as $$ select 6 $$;

alter table public.battles add column if not exists acts_left int not null default 6;
alter table public.battle_units add column if not exists acted boolean not null default false;

-- ── 2) Гексовая дистанция (flat-top, odd-q offset → cube) ────
-- x = колонка, y = строка; нечётные колонки смещены вниз на полгекса.
create or replace function public._bt_dist(x1 int, y1 int, x2 int, y2 int)
returns int language sql immutable as $$
  with c as (
    select x1 as q1, y1 - (x1 - (x1 & 1)) / 2 as r1,
           x2 as q2, y2 - (x2 - (x2 & 1)) / 2 as r2
  )
  select (abs(q1 - q2) + abs(r1 - r2) + abs((q1 + r1) - (q2 + r2))) / 2 from c;
$$;

-- ── 3) ТТХ проекта: ВСЁ из конструктора ──────────────────────
-- speed — «квадраты» KV-синтеза (summary.speed), гексов за ход, кап 40.
-- rng — max dalnost орудий (summary.rng); старые summary без rng
-- пересчитываются на лету из data->weapons по каталогу.
create or replace function public._bt_stats(p_unit uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare u record; sm jsonb; cls text; spd int; rng numeric; cab jsonb;
begin
  select * into u from public.faction_units where id = p_unit;
  if u.id is null then return null; end if;
  sm  := coalesce(u.summary, '{}'::jsonb);
  cls := nullif(u.data->>'class','');
  spd := greatest(1, least(40, round(coalesce((sm->>'speed')::numeric, 4))::int));
  rng := (sm->>'rng')::numeric;
  if rng is null then
    -- старый summary: дальность собираем из орудий проекта по каталогу
    cab := public._cn_catalog();
    select max(coalesce((cab->coalesce(u.category,'ship')->'weapons'
                          ->(w->>'g')->coalesce((w->>'idx')::int,-1)->>'dalnost')::numeric, 0))
      into rng
      from jsonb_array_elements(coalesce(u.data->'weapons','[]'::jsonb)) w;
  end if;
  rng := greatest(1, least(40, coalesce(rng, 0)));
  return jsonb_build_object(
    'name',   u.name,
    'cls',    cls,
    'hp',     greatest(1, coalesce((sm->>'hp')::numeric, 100)),
    'armor',  greatest(0, coalesce((sm->>'armor')::numeric, 0)),
    'shield', greatest(0, coalesce((sm->>'shield')::numeric, 0)),
    'dmg',    greatest(1, coalesce((sm->>'dmg')::numeric, 10)),
    'speed',  spd,
    'rng',    round(rng)::int);
end$$;
revoke all on function public._bt_stats(uuid) from public;

-- ── 4) Активация корабля ─────────────────────────────────────
-- Первое действие корабля в этом ходу тратит одну из 6 активаций.
create or replace function public._bt_use_act(p_battle uuid, p_unit uuid)
returns void language plpgsql security definer set search_path=public as $$
declare u record; b record;
begin
  select * into u from public.battle_units where id = p_unit;
  if u.acted then return; end if;
  select * into b from public.battles where id = p_battle for update;
  if b.acts_left <= 0 then
    raise exception 'активации кончились: за ход действуют не больше % кораблей', public._bt_acts();
  end if;
  update public.battles set acts_left = acts_left - 1 where id = p_battle;
  update public.battle_units set acted = true where id = p_unit;
end$$;
revoke all on function public._bt_use_act(uuid,uuid) from public;

-- ── 5) Расстановка (зона = 4 колонки со своего края) ─────────
create or replace function public.battle_deploy(p_battle uuid, p_units jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; sd text; b record; e jsonb; uid uuid; st jsonb;
        cnt int; free int; used int; px int; py int; n int := 0; z int := public._bt_zone();
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle for update;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.status <> 'forming' then raise exception 'состав уже утверждён — бой идёт'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;
  if (sd = 'attacker' and b.att_ready) or (sd = 'defender' and b.def_ready) then
    raise exception 'вы уже подтвердили состав';
  end if;

  delete from public.battle_units where battle_id = p_battle and fid = me;

  for e in select value from jsonb_array_elements(coalesce(p_units,'[]'::jsonb)) loop
    uid := nullif(e->>'unit_id','')::uuid;
    px  := coalesce((e->>'x')::int, -1);
    py  := coalesce((e->>'y')::int, -1);
    if uid is null then continue; end if;
    if py < 0 or py >= public._bt_h() then raise exception 'гекс вне доски'; end if;
    if sd = 'attacker' and (px < 0 or px >= z) then
      raise exception 'нападающий разворачивается в % левых колонках', z;
    end if;
    if sd = 'defender' and (px < public._bt_w() - z or px >= public._bt_w()) then
      raise exception 'обороняющийся разворачивается в % правых колонках', z;
    end if;

    select coalesce(sum(greatest(0, coalesce((c->>'qty')::int,0))), 0) into free
      from public.battle_fleets bf
      join public.fleets f on f.id = bf.fleet_id
      cross join lateral jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
     where bf.battle_id = p_battle and bf.fid = me and (c->>'unit_id')::uuid = uid;
    select count(*) into used from public.battle_units
      where battle_id = p_battle and fid = me and unit_id = uid;
    if used >= free then raise exception 'таких кораблей в бою больше нет: «%»', coalesce(e->>'unit_name','проект'); end if;

    if exists(select 1 from public.battle_units
               where battle_id = p_battle and alive and x = px and y = py) then
      raise exception 'гекс %:% уже занят — на одном гексе один корабль', px, py;
    end if;

    st := public._bt_stats(uid);
    if st is null then raise exception 'проект корабля не найден'; end if;

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng)
      values (p_battle, me, sd, uid, st->>'name', st->>'cls', px, py,
        (st->>'hp')::numeric, (st->>'hp')::numeric, (st->>'armor')::numeric,
        (st->>'shield')::numeric, (st->>'shield')::numeric, (st->>'dmg')::numeric,
        (st->>'speed')::int, (st->>'rng')::int);
    n := n + 1;
    if n > public._bt_cap() then raise exception 'в бой можно вывести не больше % кораблей', public._bt_cap(); end if;
  end loop;

  select count(*) into cnt from public.battle_units where battle_id = p_battle and fid = me;
  return jsonb_build_object('ok', true, 'deployed', cnt);
end$$;

-- ── 6) Ход кораблём (гексы + активация) ──────────────────────
create or replace function public.battle_move(p_battle uuid, p_unit uuid, p_x int, p_y int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; u record; dist int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if u.moved then raise exception 'этот корабль уже ходил в этом ходу'; end if;
  if p_x < 0 or p_x >= public._bt_w() or p_y < 0 or p_y >= public._bt_h() then
    raise exception 'гекс вне доски';
  end if;
  dist := public._bt_dist(u.x, u.y, p_x, p_y);
  if dist = 0 then raise exception 'корабль уже здесь'; end if;
  if dist > u.speed then
    raise exception '«%» проходит % гексов за ход, а до цели %', u.unit_name, u.speed, dist;
  end if;
  if exists(select 1 from public.battle_units
             where battle_id = p_battle and alive and x = p_x and y = p_y) then
    raise exception 'гекс занят';
  end if;
  perform public._bt_use_act(p_battle, p_unit);
  update public.battle_units set x = p_x, y = p_y, moved = true where id = p_unit;
  return jsonb_build_object('ok', true);
end$$;

-- ── 7) Выстрел (гексы + активация) ───────────────────────────
create or replace function public.battle_fire(p_battle uuid, p_unit uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; u record; t record; dist int;
        dmg numeric; absorbed numeric; hull numeric; killed boolean := false;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if u.fired then raise exception 'этот корабль уже стрелял в этом ходу'; end if;
  select * into t from public.battle_units where id = p_target and battle_id = p_battle for update;
  if t.id is null or not t.alive then raise exception 'цели нет'; end if;
  if t.side = u.side then raise exception 'по своим не стреляем'; end if;
  dist := public._bt_dist(u.x, u.y, t.x, t.y);
  if dist > u.rng then
    raise exception '«%» бьёт на % гексов, до цели %', u.unit_name, u.rng, dist;
  end if;

  perform public._bt_use_act(p_battle, p_unit);

  dmg := u.dmg;
  absorbed := least(t.shield, dmg);
  dmg := dmg - absorbed;
  hull := greatest(u.dmg * 0.10, dmg - t.armor);
  if dmg <= 0 then hull := 0; end if;   -- щит съел весь залп
  update public.battle_units
     set shield = t.shield - absorbed,
         hp = greatest(0, t.hp - hull),
         alive = (t.hp - hull) > 0
   where id = p_target;
  killed := (t.hp - hull) <= 0;
  update public.battle_units set fired = true where id = p_unit;

  perform public._bt_log(p_battle, format('%s → %s: %s урона%s',
    u.unit_name, t.unit_name, round(absorbed + hull), case when killed then ' — цель уничтожена' else '' end));
  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'shield_absorbed', round(absorbed), 'hull', round(hull), 'killed', killed);
end$$;

-- ── 8) Завершить ход: следующей стороне 6 свежих активаций ───
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

  nxt := case when sd = 'attacker' then 'defender' else 'attacker' end;
  update public.battle_units set moved = false, fired = false, acted = false
   where battle_id = p_battle and side = nxt;
  update public.battles
     set side_to_move = nxt, turn_no = turn_no + 1, acts_left = public._bt_acts(),
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;

  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true);
end$$;

-- ── 9) Просроченный ход ──────────────────────────────────────
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
  nxt := case when b.side_to_move = 'attacker' then 'defender' else 'attacker' end;
  update public.battle_units set moved = false, fired = false, acted = false
   where battle_id = p_battle and side = nxt;
  update public.battles
     set side_to_move = nxt, turn_no = turn_no + 1, acts_left = public._bt_acts(),
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;
  perform public._bt_log(p_battle, 'Сторона не явилась к сроку — ход сгорел.');
  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true);
end$$;

-- ── 10) Подкрепление: своя кромка, свободный гекс ближе к центру ──
create or replace function public.battle_reinforce(p_battle uuid, p_unit_id uuid, p_y int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; sd text; st jsonb; free int; used int; px int; py int; cnt int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  sd := public._bt_side(p_battle, me);

  select count(*) into cnt from public.battle_units where battle_id = p_battle and fid = me and alive;
  if cnt >= public._bt_cap() then raise exception 'на доске уже % кораблей', public._bt_cap(); end if;

  select coalesce(sum(greatest(0, coalesce((c->>'qty')::int,0))), 0) into free
    from public.battle_fleets bf
    join public.fleets f on f.id = bf.fleet_id
    cross join lateral jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
   where bf.battle_id = p_battle and bf.fid = me and (c->>'unit_id')::uuid = p_unit_id;
  select count(*) into used from public.battle_units
    where battle_id = p_battle and fid = me and unit_id = p_unit_id;
  if free - used <= 0 then
    raise exception 'подкрепления нет на поле боя — его нужно сначала привезти в систему';
  end if;

  st := public._bt_stats(p_unit_id);
  if st is null then raise exception 'проект корабля не найден'; end if;

  -- своя кромка; желаемая строка p_y (или центр), выбираем свободный гекс
  -- с минимальным удалением от желаемой строки — «спавн у центра», не сверху
  px := case when sd = 'attacker' then 0 else public._bt_w() - 1 end;
  py := greatest(0, least(public._bt_h() - 1, coalesce(p_y, public._bt_h() / 2)));
  select g into py from generate_series(0, public._bt_h()-1) g
    where not exists(select 1 from public.battle_units
                      where battle_id=p_battle and alive and x=px and y=g)
    order by abs(g - py), g
    limit 1;
  if py is null then raise exception 'некуда вывести подкрепление — край доски занят'; end if;

  insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
      hp, max_hp, armor, shield, max_shield, dmg, speed, rng, moved, fired, acted)
    values (p_battle, me, sd, p_unit_id, st->>'name', st->>'cls', px, py,
      (st->>'hp')::numeric, (st->>'hp')::numeric, (st->>'armor')::numeric,
      (st->>'shield')::numeric, (st->>'shield')::numeric, (st->>'dmg')::numeric,
      (st->>'speed')::int, (st->>'rng')::int, true, true, true);   -- прибыл — в этом ходу не действует

  perform public._bt_log(p_battle, format('%s вызывает подкрепление: %s', public._war_nm(me), st->>'name'));
  perform public.battle_end_turn(p_battle);
  return jsonb_build_object('ok', true);
end$$;

-- ── 11) Состояние боя: + активации и зона ────────────────────
create or replace function public.battle_state(p_battle uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare me text; b record; sd text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;

  return jsonb_build_object(
    'id', b.id, 'status', b.status, 'kind', b.kind,
    'system_id', b.system_id,
    'system_name', (select coalesce(nullif(ms.name,''), ms.id) from public.map_systems ms where ms.id = b.system_id),
    'w', public._bt_w(), 'h', public._bt_h(), 'cap', public._bt_cap(),
    'zone', public._bt_zone(), 'acts_max', public._bt_acts(), 'acts_left', b.acts_left,
    'my_side', sd, 'my_fid', me,
    'attacker', b.attacker_fid, 'attacker_name', public._war_nm(b.attacker_fid),
    'defender', b.defender_fid, 'defender_name', public._war_nm(b.defender_fid),
    'side_to_move', b.side_to_move, 'my_turn', (b.side_to_move = sd),
    'turn_no', b.turn_no,
    'att_turns_left', b.att_turns_left, 'def_turns_left', b.def_turns_left,
    'att_ready', b.att_ready, 'def_ready', b.def_ready,
    'deadline_at', b.deadline_at,
    'can_force', (b.status='active' and b.side_to_move is distinct from sd
                  and b.deadline_at is not null and b.deadline_at <= now()),
    'winner', b.winner_fid,
    'log', b.log,
    'pool', public.battle_pool(p_battle, me),
    'units', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id, 'side', u.side, 'mine', (u.fid = me),
        'name', u.unit_name, 'cls', u.cls,
        'x', u.x, 'y', u.y,
        'hp', round(u.hp), 'max_hp', round(u.max_hp),
        'shield', round(u.shield), 'max_shield', round(u.max_shield),
        'armor', round(u.armor), 'dmg', round(u.dmg),
        'speed', u.speed, 'rng', u.rng,
        'moved', u.moved, 'fired', u.fired, 'acted', u.acted) order by u.created_at), '[]'::jsonb)
      from public.battle_units u where u.battle_id = p_battle and u.alive));
end$$;

-- ── Проверка ────────────────────────────────────────────────
-- 1) battle_state → w=48, h=28, zone=4, acts_left=6.
-- 2) Расстановка нападающего при x=4 → exception «в 4 левых колонках».
-- 3) battle_move на гекс дальше summary.speed → exception с гекс-дистанцией.
-- 4) 7-й корабль в одном ходу → «активации кончились».
-- 5) Выстрел дальше summary.rng (max dalnost орудий) → exception.
-- 6) end_turn → у противника acts_left=6, acted сброшен.
