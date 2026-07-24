-- ============================================================
-- ВОЙНА, СРЕЗ 4: ПОШАГОВАЯ ДОСКА БОЯ (СЕРВЕР)
--
-- ХОД = ход СТОРОНЫ на доске: все её живые корабли могут один раз
-- сдвинуться и один раз выстрелить, после чего ход уходит противнику.
-- У каждой стороны 6 таких ходов. Один ход можно целиком разменять на
-- вызов ОДНОГО корабля подкрепления — но только если он уже есть на поле
-- боя (в скованных боем флотах). Нет — вези флот в систему.
--
-- Применять в Supabase → SQL Editor ПОСЛЕ:
--   ... → _war_declare.sql → _war_borders_occupation.sql →
--   _war_intercept.sql → ЭТОТ ФАЙЛ.
--
-- ЭТОТ ФАЙЛ ДОПОЛНЯЕТ battles через alter table и НЕ пересоздаёт её:
-- в battles уже лежат бои, завязанные перехватом (срез 3). Пересоздание
-- таблицы потеряло бы их вместе со скованными флотами.
--
-- ТТХ берутся из ОПУБЛИКОВАННЫХ проектов конструктора (faction_units.summary,
-- пересчитанный сервером в _unit_publish.sql) — клиентским числам не верим.
-- Класс корабля (data->>'class') задаёт дальность, двигатель — подвижность.
-- ?v=20260718war4
-- ============================================================

-- ── 1) Доска и счётчик ходов ─────────────────────────────────
-- Поле 26×16 клеток: нападающий разворачивается слева (колонки 0-2),
-- обороняющийся справа (23-25). Дальность/подвижность — в клетках.
alter table public.battles add column if not exists side_to_move text;
alter table public.battles add column if not exists turn_no int not null default 0;
alter table public.battles add column if not exists att_turns_left int not null default 6;
alter table public.battles add column if not exists def_turns_left int not null default 6;
alter table public.battles add column if not exists att_ready boolean not null default false;
alter table public.battles add column if not exists def_ready boolean not null default false;
alter table public.battles add column if not exists deadline_at timestamptz;
alter table public.battles add column if not exists log jsonb not null default '[]'::jsonb;

create or replace function public._bt_w() returns int language sql immutable as $$ select 26 $$;
create or replace function public._bt_h() returns int language sql immutable as $$ select 16 $$;
create or replace function public._bt_cap() returns int language sql immutable as $$ select 50 $$;
-- Сколько часов даётся на ход, прежде чем противник вправе его прожать.
create or replace function public._bt_turn_hours() returns int language sql immutable as $$ select 24 $$;

-- ── 2) Корабли на доске ──────────────────────────────────────
-- Одна строка = ОДИН корабль (не стек): бой поштучный, 50 строк на сторону.
create table if not exists public.battle_units (
  id         uuid primary key default gen_random_uuid(),
  battle_id  uuid not null references public.battles(id) on delete cascade,
  fid        text not null,
  side       text not null,
  unit_id    uuid,                       -- проект из faction_units (может быть удалён → null)
  unit_name  text not null,
  cls        text,                       -- corvette | frigate | ... (для силуэта на клиенте)
  x          int not null,
  y          int not null,
  hp         numeric not null,
  max_hp     numeric not null,
  armor      numeric not null default 0,
  shield     numeric not null default 0,
  max_shield numeric not null default 0,
  dmg        numeric not null default 0,
  speed      int not null default 2,     -- клеток за ход
  rng        int not null default 3,     -- клеток
  alive      boolean not null default true,
  moved      boolean not null default false,
  fired      boolean not null default false,
  created_at timestamptz not null default now(),
  constraint battle_units_side_ck check (side in ('attacker','defender'))
);
create index if not exists battle_units_b_idx on public.battle_units (battle_id) where alive;
create unique index if not exists battle_units_cell_uq
  on public.battle_units (battle_id, x, y) where alive;   -- одна клетка — один корабль

alter table public.battle_units enable row level security;
drop policy if exists battle_units_read on public.battle_units;
create policy battle_units_read on public.battle_units for select to authenticated
  using (exists(select 1 from public.battles b where b.id = battle_id
                 and (b.attacker_fid = public._ec_my_fid() or b.defender_fid = public._ec_my_fid())));
revoke insert, update, delete on public.battle_units from anon, authenticated;

-- ── 3) ТТХ проекта → боевые характеристики ───────────────────
-- Подвижность: от двигателя (summary.speed 16..40) → 2..5 клеток.
-- Дальность: от класса корпуса — мелочь бьёт в упор, дредноут достаёт через
-- полполя. Это единственное место, где числа боя расходятся с конструктором,
-- и держим его здесь, чтобы баланс правился в одной точке.
create or replace function public._bt_range_of(p_cls text)
returns int language sql immutable as $$
  select case p_cls
    when 'corvette'    then 3
    when 'frigate'     then 4
    when 'destroyer'   then 5
    when 'cruiser'     then 5
    when 'battleship'  then 6
    when 'dreadnought' then 7
    else 4 end;
$$;

create or replace function public._bt_stats(p_unit uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare u record; sm jsonb; cls text; spd int;
begin
  select * into u from public.faction_units where id = p_unit;
  if u.id is null then return null; end if;
  sm  := coalesce(u.summary, '{}'::jsonb);
  cls := nullif(u.data->>'class','');
  spd := greatest(1, least(6, round(coalesce((sm->>'speed')::numeric, 20) / 8.0)::int));
  return jsonb_build_object(
    'name',   u.name,
    'cls',    cls,
    'hp',     greatest(1, coalesce((sm->>'hp')::numeric, 100)),
    'armor',  greatest(0, coalesce((sm->>'armor')::numeric, 0)),
    'shield', greatest(0, coalesce((sm->>'shield')::numeric, 0)),
    'dmg',    greatest(1, coalesce((sm->>'dmg')::numeric, 10)),
    'speed',  spd,
    'rng',    public._bt_range_of(cls));
end$$;
revoke all on function public._bt_stats(uuid) from public;

-- ── 4) Резерв стороны: что есть на поле боя, но не на доске ──
-- Всё, что лежит в скованных боем флотах, минус уже выставленное.
-- Именно отсюда берутся подкрепления: нет в резерве — вези флот.
create or replace function public.battle_pool(p_battle uuid, p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare res jsonb := '[]'::jsonb; r record; used int; st jsonb;
begin
  for r in
    select (c->>'unit_id')::uuid as uid,
           coalesce(c->>'unit_name','Корабль') as nm,
           sum(greatest(0, coalesce((c->>'qty')::int,0))) as qty
      from public.battle_fleets bf
      join public.fleets f on f.id = bf.fleet_id
      cross join lateral jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
     where bf.battle_id = p_battle and bf.fid = p_fid
       and nullif(c->>'unit_id','') is not null
     group by 1,2
  loop
    select count(*) into used from public.battle_units
      where battle_id = p_battle and fid = p_fid and unit_id = r.uid;
    if r.qty - used <= 0 then continue; end if;
    st := public._bt_stats(r.uid);
    res := res || jsonb_build_array(jsonb_build_object(
      'unit_id', r.uid, 'unit_name', r.nm, 'free', r.qty - used,
      'cls', st->>'cls', 'hp', st->'hp', 'dmg', st->'dmg',
      'speed', st->'speed', 'rng', st->'rng',
      -- расширенные ТТХ для карточки резерва/подкрепления
      'shield', st->'shield', 'armor', st->'armor', 'sensor', st->'sensor',
      'stealth', st->'stealth', 'cargo', st->'cargo', 'crew', st->'crew',
      'pd', st->'pd', 'jam', st->'jam', 'dejam', st->'dejam',
      'interdict', st->'interdict', 'stabil', st->'stabil', 'ftl', st->'ftl',
      'wings', st->'wings'));
  end loop;
  return res;
end$$;
revoke all on function public.battle_pool(uuid,text) from public;
grant execute on function public.battle_pool(uuid,text) to authenticated;

-- ── 5) Внутреннее: моя сторона в этом бою ────────────────────
create or replace function public._bt_side(p_battle uuid, p_fid text)
returns text language sql stable security definer set search_path=public as $$
  select case when b.attacker_fid = p_fid then 'attacker'
              when b.defender_fid = p_fid then 'defender' else null end
    from public.battles b where b.id = p_battle;
$$;

-- Запись в журнал боя (последние 200 событий — клиент рисует ленту).
create or replace function public._bt_log(p_battle uuid, p_txt text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.battles
     set log = (case when jsonb_array_length(log) >= 200
                     then log - 0 else log end)
               || jsonb_build_array(jsonb_build_object('t', now(), 'm', p_txt))
   where id = p_battle;
end$$;

-- ── 6) Расстановка ──────────────────────────────────────────
-- p_units: [{unit_id, x, y}, ...]. Свои клетки: нападающий x ≤ 2,
-- обороняющийся x ≥ 23. Кап 50 кораблей на сторону.
create or replace function public.battle_deploy(p_battle uuid, p_units jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; sd text; b record; e jsonb; uid uuid; st jsonb;
        cnt int; free int; used int; px int; py int; n int := 0;
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

  -- перерасстановка: сносим прежнюю и ставим заново (пока бой не начался)
  delete from public.battle_units where battle_id = p_battle and fid = me;

  for e in select value from jsonb_array_elements(coalesce(p_units,'[]'::jsonb)) loop
    uid := nullif(e->>'unit_id','')::uuid;
    px  := coalesce((e->>'x')::int, -1);
    py  := coalesce((e->>'y')::int, -1);
    if uid is null then continue; end if;
    if py < 0 or py >= public._bt_h() then raise exception 'клетка вне доски'; end if;
    if sd = 'attacker' and (px < 0 or px > 2) then
      raise exception 'нападающий разворачивается в трёх левых колонках';
    end if;
    if sd = 'defender' and (px < public._bt_w()-3 or px >= public._bt_w()) then
      raise exception 'обороняющийся разворачивается в трёх правых колонках';
    end if;

    -- корабль обязан реально быть в скованных боем флотах
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
      raise exception 'клетка %:% уже занята — на одной клетке один корабль', px, py;
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
revoke all on function public.battle_deploy(uuid,jsonb) from public;
grant execute on function public.battle_deploy(uuid,jsonb) to authenticated;

-- ── 7) Готов к бою ──────────────────────────────────────────
-- Обе стороны подтвердили → бой начинается, первый ход за нападающим.
create or replace function public.battle_ready(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; sd text; b record; cnt int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle for update;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.status <> 'forming' then raise exception 'бой уже идёт'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;
  select count(*) into cnt from public.battle_units where battle_id = p_battle and fid = me;
  if cnt = 0 then raise exception 'выведите на доску хотя бы один корабль'; end if;

  if sd = 'attacker' then update public.battles set att_ready = true where id = p_battle;
  else                     update public.battles set def_ready = true where id = p_battle; end if;

  select * into b from public.battles where id = p_battle;
  if b.att_ready and b.def_ready then
    update public.battles
       set status = 'active', side_to_move = 'attacker', turn_no = 1,
           deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
     where id = p_battle;
    perform public._bt_log(p_battle, 'Бой начался. Первый ход за нападающими.');
  end if;
  return jsonb_build_object('ok', true, 'started', (b.att_ready and b.def_ready));
end$$;
revoke all on function public.battle_ready(uuid) from public;
grant execute on function public.battle_ready(uuid) to authenticated;

-- ── 8) Проверка «сейчас мой ход» ─────────────────────────────
-- ВАЖНО: returns public.battles, а НЕ record — функция, возвращающая
-- безымянный record, требует списка колонок в каждом вызове и падает
-- прямо на первом ходе.
create or replace function public._bt_require_turn(p_battle uuid, p_fid text)
returns public.battles language plpgsql stable security definer set search_path=public as $$
declare b public.battles; sd text;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.status <> 'active' then raise exception 'бой не идёт'; end if;
  sd := public._bt_side(p_battle, p_fid);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;
  if b.side_to_move is distinct from sd then raise exception 'сейчас не ваш ход'; end if;
  return b;
end$$;

-- ── 9) Ход кораблём ─────────────────────────────────────────
-- Манхэттенская дистанция ≤ speed, клетка свободна, корабль ещё не ходил.
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
    raise exception 'клетка вне доски';
  end if;
  dist := abs(p_x - u.x) + abs(p_y - u.y);
  if dist = 0 then raise exception 'корабль уже здесь'; end if;
  if dist > u.speed then
    raise exception '«%» проходит % клет. за ход, а до цели %', u.unit_name, u.speed, dist;
  end if;
  if exists(select 1 from public.battle_units
             where battle_id = p_battle and alive and x = p_x and y = p_y) then
    raise exception 'клетка занята';
  end if;
  update public.battle_units set x = p_x, y = p_y, moved = true where id = p_unit;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.battle_move(uuid,uuid,int,int) from public;
grant execute on function public.battle_move(uuid,uuid,int,int) to authenticated;

-- ── 10) Выстрел ─────────────────────────────────────────────
-- Урон: сначала щит, остаток — по корпусу с вычетом брони, но не меньше
-- 10% исходного (иначе тяжёлая броня делала бы корабль неуязвимым).
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
  dist := abs(t.x - u.x) + abs(t.y - u.y);
  if dist > u.rng then
    raise exception '«%» бьёт на % клет., до цели %', u.unit_name, u.rng, dist;
  end if;

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
revoke all on function public.battle_fire(uuid,uuid,uuid) from public;
grant execute on function public.battle_fire(uuid,uuid,uuid) to authenticated;

-- ── 11) Подкрепление вместо хода ────────────────────────────
-- Тратит ВЕСЬ ход и выводит ОДИН корабль из резерва. Резерв пуст —
-- значит подкрепление ещё не привезли в систему.
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

  -- встаёт в своей зоне разворачивания, в первой свободной клетке
  px := case when sd = 'attacker' then 0 else public._bt_w() - 1 end;
  py := greatest(0, least(public._bt_h() - 1, coalesce(p_y, public._bt_h() / 2)));
  if exists(select 1 from public.battle_units where battle_id=p_battle and alive and x=px and y=py) then
    select g into py from generate_series(0, public._bt_h()-1) g
      where not exists(select 1 from public.battle_units
                        where battle_id=p_battle and alive and x=px and y=g)
      limit 1;
    if py is null then raise exception 'некуда вывести подкрепление — край доски занят'; end if;
  end if;

  insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
      hp, max_hp, armor, shield, max_shield, dmg, speed, rng, moved, fired)
    values (p_battle, me, sd, p_unit_id, st->>'name', st->>'cls', px, py,
      (st->>'hp')::numeric, (st->>'hp')::numeric, (st->>'armor')::numeric,
      (st->>'shield')::numeric, (st->>'shield')::numeric, (st->>'dmg')::numeric,
      (st->>'speed')::int, (st->>'rng')::int, true, true);   -- прибыл — в этом ходу не действует

  perform public._bt_log(p_battle, format('%s вызывает подкрепление: %s', public._war_nm(me), st->>'name'));
  -- ход потрачен целиком
  perform public.battle_end_turn(p_battle);
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.battle_reinforce(uuid,uuid,int) from public;
grant execute on function public.battle_reinforce(uuid,uuid,int) to authenticated;

-- ── 12) Завершить ход ───────────────────────────────────────
create or replace function public.battle_end_turn(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; sd text; nxt text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  sd := b.side_to_move;

  -- списываем ход стороне, которая его отходила
  if sd = 'attacker' then
    update public.battles set att_turns_left = greatest(0, att_turns_left - 1) where id = p_battle;
  else
    update public.battles set def_turns_left = greatest(0, def_turns_left - 1) where id = p_battle;
  end if;

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
revoke all on function public.battle_end_turn(uuid) from public;
grant execute on function public.battle_end_turn(uuid) to authenticated;

-- ── 13) Просроченный ход ────────────────────────────────────
-- Асинхронный бой: противник не зашёл за сутки — можно прожать его ход.
-- Сам ход при этом сгорает, корабли не действуют.
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
  update public.battle_units set moved = false, fired = false where battle_id = p_battle and side = nxt;
  update public.battles
     set side_to_move = nxt, turn_no = turn_no + 1,
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;
  perform public._bt_log(p_battle, 'Сторона не явилась к сроку — ход сгорел.');
  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.battle_force_turn(uuid) from public;
grant execute on function public.battle_force_turn(uuid) to authenticated;

-- ── 14) Конец боя ───────────────────────────────────────────
-- Победа только на уничтожение: у врага не осталось ни живых
-- кораблей на доске, ни резерва. Лимита ходов нет — бой идёт,
-- пока одна из сторон не выбита полностью.
create or replace function public._bt_check_end(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $$
declare b record; a_alive int; d_alive int; a_pool int; d_pool int;
        a_hp numeric; d_hp numeric; win text;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status = 'done' then return; end if;

  select count(*) filter (where side='attacker'), count(*) filter (where side='defender'),
         coalesce(sum(hp) filter (where side='attacker'),0), coalesce(sum(hp) filter (where side='defender'),0)
    into a_alive, d_alive, a_hp, d_hp
    from public.battle_units where battle_id = p_battle and alive;

  select coalesce(jsonb_array_length(public.battle_pool(p_battle, b.attacker_fid)),0) into a_pool;
  select coalesce(jsonb_array_length(public.battle_pool(p_battle, b.defender_fid)),0) into d_pool;

  if b.status = 'active' then
    if a_alive = 0 and a_pool = 0 then win := b.defender_fid;
    elsif d_alive = 0 and d_pool = 0 then win := b.attacker_fid;
    end if;
  end if;
  if win is null then return; end if;

  perform public._bt_finish(p_battle, win);
end$$;
revoke all on function public._bt_check_end(uuid) from public;

-- Завершение: списать потери в составы флотов, расковать флоты,
-- поднять флаг оккупации победителю, отписать в хронику.
create or replace function public._bt_finish(p_battle uuid, p_winner text)
returns void language plpgsql security definer set search_path=public as $$
declare b record; r record; f record; comp jsonb; e jsonb; newc jsonb; q int; loss int;
        sysname text; loser text;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or b.status = 'done' then return; end if;
  loser := case when p_winner = b.attacker_fid then b.defender_fid else b.attacker_fid end;

  -- Потери: по каждому проекту считаем убитых и вычитаем из составов
  -- скованных флотов (по порядку, пока не спишем всё).
  for r in select fid, unit_id, count(*) as dead
             from public.battle_units
            where battle_id = p_battle and not alive and unit_id is not null
            group by 1,2
  loop
    loss := r.dead;
    for f in select bf.fleet_id from public.battle_fleets bf
              where bf.battle_id = p_battle and bf.fid = r.fid
    loop
      exit when loss <= 0;
      select composition into comp from public.fleets where id = f.fleet_id for update;
      newc := '[]'::jsonb;
      for e in select value from jsonb_array_elements(coalesce(comp,'[]'::jsonb)) loop
        if (e->>'unit_id')::uuid = r.unit_id and loss > 0 then
          q := greatest(0, coalesce((e->>'qty')::int,0));
          if q <= loss then loss := loss - q; q := 0;
          else q := q - loss; loss := 0; end if;
          if q > 0 then newc := newc || jsonb_build_array(jsonb_set(e, array['qty'], to_jsonb(q), true)); end if;
        else
          newc := newc || jsonb_build_array(e);
        end if;
      end loop;
      update public.fleets set composition = newc where id = f.fleet_id;
    end loop;
  end loop;

  -- Флоты, оставшиеся без кораблей, распускаем; прочие — расковываем.
  -- алиас не должен совпадать с record-переменной f (42703: record "f" has no field "id")
  delete from public.fleets fl
   where fl.id in (select fleet_id from public.battle_fleets where battle_id = p_battle)
     and coalesce((select sum(greatest(0, coalesce((c->>'qty')::int,0)))
                   from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c), 0) = 0;

  update public.battles
     set status = 'done', winner_fid = p_winner, ended_at = now(), side_to_move = null
   where id = p_battle;

  -- Победитель остался хозяином положения: пробуем поднять флаг (срез 2
  -- сам решит, оккупация это или своя же система).
  begin
    perform public._war_occupy_check(p_winner, b.system_id, null);
  exception when undefined_function then null; end;

  select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = b.system_id;
  perform public._war_news(
    '💥 Сражение окончено: ' || sysname,
    public._news_pick(array[
      format('Бой в системе %s выигран державой %s. Обломки флота %s остывают на орбите.',
             sysname, public._war_nm(p_winner), public._war_nm(loser)),
      format('%s удерживает %s: флот %s разбит и отброшен.',
             public._war_nm(p_winner), sysname, public._war_nm(loser)),
      format('Сражение за %s кончилось победой %s. %s считает потери.',
             sysname, public._war_nm(p_winner), public._war_nm(loser))
    ]),
    jsonb_build_array(p_winner, loser));
end$$;
revoke all on function public._bt_finish(uuid,text) from public;

-- ── 15) Состояние боя для клиента ───────────────────────────
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
        'moved', u.moved, 'fired', u.fired) order by u.created_at), '[]'::jsonb)
      from public.battle_units u where u.battle_id = p_battle and u.alive));
end$$;
revoke all on function public.battle_state(uuid) from public;
grant execute on function public.battle_state(uuid) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- 1) Перехват завязал бой (срез 3) → battle_state: status='forming', pool
--    полон, units пуст.
-- 2) battle_deploy(b,'[{"unit_id":"...","x":1,"y":5}]') → корабль на доске;
--    x=10 у нападающего → exception «разворачивается в трёх левых колонках».
-- 3) Обе стороны battle_ready → status='active', ход нападающего.
-- 4) battle_move за пределы speed → exception с числом клеток.
-- 5) battle_fire дальше rng → exception; в упор → щит съедает залп,
--    потом корпус за вычетом брони, но не меньше 10% залпа.
-- 6) battle_reinforce при пустом резерве → «подкрепление нужно привезти».
-- 7) Убить все корабли врага при пустом резерве → status='done',
--    потери списаны из fleets.composition, пустые флоты распущены,
--    в ленте «💥 Сражение окончено».
