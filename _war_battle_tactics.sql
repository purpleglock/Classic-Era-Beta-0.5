-- ============================================================
-- ТАКТИКА БОЯ: СЕКТОРА ОРУДИЙ + ИНЕРЦИЯ ПОВОРОТА + ЛАНДШАФТ + СИГНАТУРЫ
--
-- Применять в Supabase → SQL Editor ПОСЛЕ:
--   _war_battle.sql → _war_battle_rework.sql → _battle_finish_fix.sql
--
-- ЧТО МЕНЯЕТСЯ:
--  1) ОРУДИЯ ПО СЕКТОРАМ. Сектор берётся из конструктора: позиция узла
--     на схеме (layout.mounts[].pos) — центр = носовая батарея, лево/право
--     = бортовые. Носовые бьют только прямо по курсу (сектор 60°),
--     бортовые — в свой борт (×0.85 урона). Корма слепая — оттуда
--     корабль не стреляет вовсе.
--  2) ДАЛЬНОСТНЫЕ ПОЛОСЫ. Орудие с дальностью R бьёт на дистанции
--     max(1, R-1)..R: на дистанции 5 работают только «пятёрки», на 4 —
--     пятёрки и четвёрки, на 3 — четвёрки и тройки, но НЕ пятёрки.
--  3) ПОЛОЖЕНИЕ ЦЕЛИ. Атака в лоб ×1.0, в борт ×1.25, в корму ×2.0
--     (двигатели не прикрыты бронёй).
--  4) ИНЕРЦИЯ. Прежде чем повернуть на 60° (соседнее направление),
--     корабль обязан пройти прямо: корвет/фрегат 1 гекс, эсминец 2,
--     крейсера/линкоры 3, дредноут 4. Ход — это ПУТЬ (клиент шлёт
--     маршрут по гексам), сервер проверяет каждый шаг.
--  5) ЛАНДШАФТ (генерится один раз на бой, по сиду от id боя):
--       ast астероиды — непроходимы для огня (режут линию огня);
--                       стоять можно, но в конце хода -10% max_hp;
--       neb туманность — щиты внутри падают в 0, входящий урон ×0.7;
--       grv гравитационный колодец — в конце хода тянет корабли в
--                       радиусе 3 на 1 гекс к центру;
--       deb обломки — ход стартующего с них корабля короче на 1,
--                       входящий урон ×0.85.
--  6) СИГНАТУРЫ вместо тумана войны. Чужой корабль всегда виден как
--     точка, но стрелять можно только по ЗАХВАЧЕННОЙ цели:
--     захват есть, если у любого своего корабля (sensor − stealth) > L.
--     Выстрел «светит» стрелявшего: его stealth = 0 до начала его
--     следующего хода. Незахваченные цели отдаются клиенту усечённо
--     («неопознанный контакт»: только координаты).
--  7) ПОДКРЕПЛЕНИЕ. Вызывается ТОЛЬКО свежим ходом (все активации
--     целы) и съедает весь ход. На нуле активаций вызвать нельзя —
--     закрыт баг «корвет на нуле действий».
--  8) СТОЙКОСТИ БРОНИ (алхимия). summary.armor_resist проекта
--     {kinetic,energy,missile} едет в battle_units.resist; каждая
--     орудийная группа несёт тип урона (k, по названию орудия через
--     _cn_wpn_kind: ballistic→kinetic), и её урон гасится
--     ×(1 − resist[k]). Требует применённых _armor_alchemy.sql и
--     свежего _unit_publish.sql (armor_resist в summary).
-- ?v=20260721tactics2
-- ============================================================

-- ── 1) Схема ────────────────────────────────────────────────
alter table public.battles      add column if not exists terrain jsonb;
alter table public.battle_units add column if not exists facing   int not null default 0;
alter table public.battle_units add column if not exists straight int not null default 9;
alter table public.battle_units add column if not exists sensor   int not null default 10;
alter table public.battle_units add column if not exists stealth  int not null default 5;
alter table public.battle_units add column if not exists flash    boolean not null default false;
alter table public.battle_units add column if not exists wpn      jsonb;
alter table public.battle_units add column if not exists resist   jsonb;

-- ── 2) Гекс-геометрия: шаг и направление ────────────────────
-- Направления flat-top (углы 30°..330° через 60°, y вниз):
--   0=(+q,0) 1=(0,+r) 2=(−q,+r) 3=(−q,0) 4=(0,−r) 5=(+q,−r)
create or replace function public._bt_step(x int, y int, d int)
returns int[] language sql immutable as $$
  with a as (select x as q, y - (x - (x & 1)) / 2 as r),
       v as (select (array[1,0,-1,-1,0,1])[d+1] as dq, (array[0,1,1,0,-1,-1])[d+1] as dr)
  select array[q + dq, (r + dr) + ((q + dq) - ((q + dq) & 1)) / 2] from a, v;
$$;

-- Ближайшее из 6 направлений от гекса A к гексу B (по пиксельному углу).
create or replace function public._bt_dirof(x1 int, y1 int, x2 int, y2 int)
returns int language plpgsql immutable as $$
declare dq numeric; dr numeric; fx numeric; fy numeric; deg numeric;
begin
  dq := x2 - x1;
  dr := (y2 - (x2 - (x2 & 1)) / 2) - (y1 - (x1 - (x1 & 1)) / 2);
  if dq = 0 and dr = 0 then return 0; end if;
  fx := 1.5 * dq; fy := sqrt(3.0) * (dr + dq / 2.0);
  deg := degrees(atan2(fy, fx));           -- −180..180, 30° = dir 0
  return ((round((deg - 30) / 60)::int % 6) + 6) % 6;
end$$;

-- Сколько гексов прямо нужно пройти классу перед поворотом на 60°.
create or replace function public._bt_turnneed(cls text)
returns int language sql immutable as $$
  select coalesce((jsonb_build_object(
    'corvette',1,'frigate',1,'ss13',1,
    'destroyer',2,
    'cruiser',3,'mediumCruiser',3,'supportCarrier',3,'battleship',3,
    'hyperCruiser',3,'multiroleCarrier',3,
    'dreadnought',4)->>cls)::int, 2);
$$;

-- Скрытность класса: мелочь прячется, дредноут светится как город.
create or replace function public._bt_stealth(cls text)
returns int language sql immutable as $$
  select coalesce((jsonb_build_object(
    'corvette',9,'frigate',8,'destroyer',7,
    'cruiser',5,'mediumCruiser',5,
    'supportCarrier',4,'multiroleCarrier',4,
    'hyperCruiser',3,'battleship',3,
    'dreadnought',2,'ss13',1)->>cls)::int, 5);
$$;

-- Обнаружение цели одним кораблём-наблюдателем.
--   • Визуальный контакт: цель в пределах 3 гексов — видно в ЛЮБОМ
--     направлении (рядом не спрячешься, откуда бы ни смотрел).
--   • Радар: светит ВПЕРЁД, в передний сектор обзора (±60° от курса).
--     Дальность = (sensor − stealth/2), но не меньше 4 гексов; в туманности
--     радар глохнет (только визуал). Раскрытый выстрелом враг (flash) виден
--     без учёта скрытности. Итог: у радара логичная дальность и направление,
--     а не «всегда скрыт».
create or replace function public._bt_detected(
  mx int, my int, mfacing int, msensor int,
  tx int, ty int, tstealth int, tflash boolean)
returns boolean language plpgsql immutable as $$
declare d int; rel int; es int; radar int;
begin
  d := public._bt_dist(mx, my, tx, ty);
  if d <= 3 then return true; end if;                 -- визуальный контакт
  es := case when tflash then 0 else greatest(0, tstealth) end;
  rel := ((public._bt_dirof(mx, my, tx, ty) - coalesce(mfacing, 0)) % 6 + 6) % 6;
  if rel in (0, 1, 5) then                            -- передний сектор ±60°
    radar := greatest(4, msensor - (es / 2)::int);
    if d <= radar then return true; end if;
  end if;
  return false;
end$$;

-- ── 3) Ландшафт ─────────────────────────────────────────────
create or replace function public._bt_terra(t jsonb, px int, py int)
returns text language sql immutable as $$
  select e->>'t' from jsonb_array_elements(coalesce(t, '[]'::jsonb)) e
   where (e->>'x')::int = px and (e->>'y')::int = py limit 1;
$$;

-- Линия огня: астероиды между стрелком и целью глушат выстрел.
create or replace function public._bt_los_clear(t jsonb, x1 int, y1 int, x2 int, y2 int)
returns boolean language plpgsql immutable as $$
declare n int; i int; q1 numeric; r1 numeric; q2 numeric; r2 numeric;
        fq numeric; fr numeric; fs numeric; rq int; rr int; rs int;
        dqq numeric; drr numeric; dss numeric; hx int; hy int;
begin
  n := public._bt_dist(x1, y1, x2, y2);
  if n <= 1 then return true; end if;
  q1 := x1; r1 := y1 - (x1 - (x1 & 1)) / 2;
  q2 := x2; r2 := y2 - (x2 - (x2 & 1)) / 2;
  for i in 1..(n - 1) loop
    fq := q1 + (q2 - q1) * i / n;
    fr := r1 + (r2 - r1) * i / n;
    fs := -fq - fr;
    rq := round(fq); rr := round(fr); rs := round(fs);
    dqq := abs(rq - fq); drr := abs(rr - fr); dss := abs(rs - fs);
    if dqq > drr and dqq > dss then rq := -rr - rs;
    elsif drr > dss then rr := -rq - rs; end if;
    hx := rq; hy := rr + (rq - (rq & 1)) / 2;
    if public._bt_terra(t, hx, hy) = 'ast' then return false; end if;
  end loop;
  return true;
end$$;

-- Генерация поля: кластеры по сиду от id боя; зоны разворачивания чистые.
create or replace function public._bt_gen_terrain(p_battle uuid)
returns jsonb language plpgsql volatile as $$
declare w int := public._bt_w(); h int := public._bt_h(); z int := public._bt_zone();
        res jsonb := '[]'::jsonb; used jsonb := '{}'::jsonb;
        i int; j int; cx int; cy int; n int; d int; st int[];
  -- локальный помощник: занять гекс, если он в «середине» и свободен
begin
  perform setseed((abs(hashtext(p_battle::text)) % 100000) / 100000.0);
  -- астероидные кластеры: 5 случайных блужданий по 4–7 гексов
  for i in 1..5 loop
    cx := (z + 2) + floor(random() * (w - 2 * z - 4))::int;
    cy := 1 + floor(random() * (h - 2))::int;
    n  := 4 + floor(random() * 4)::int;
    for j in 1..n loop
      if cx >= z + 1 and cx < w - z - 1 and cy >= 0 and cy < h
         and not (used ? (cx || ':' || cy)) then
        res := res || jsonb_build_array(jsonb_build_object('x', cx, 'y', cy, 't', 'ast'));
        used := used || jsonb_build_object(cx || ':' || cy, true);
      end if;
      d := floor(random() * 6)::int;
      st := public._bt_step(cx, cy, d); cx := st[1]; cy := st[2];
    end loop;
  end loop;
  -- туманности: 3 пятна радиуса 1–2
  for i in 1..3 loop
    cx := (z + 3) + floor(random() * (w - 2 * z - 6))::int;
    cy := 2 + floor(random() * (h - 4))::int;
    n  := 1 + floor(random() * 2)::int;   -- радиус
    for j in 0..(w - 1) loop
      for d in 0..(h - 1) loop
        if public._bt_dist(cx, cy, j, d) <= n and j >= z + 1 and j < w - z - 1
           and not (used ? (j || ':' || d)) then
          res := res || jsonb_build_array(jsonb_build_object('x', j, 'y', d, 't', 'neb'));
          used := used || jsonb_build_object(j || ':' || d, true);
        end if;
      end loop;
    end loop;
  end loop;
  -- гравитационные колодцы: 2 одиночных
  for i in 1..2 loop
    cx := (z + 4) + floor(random() * (w - 2 * z - 8))::int;
    cy := 3 + floor(random() * (h - 6))::int;
    if not (used ? (cx || ':' || cy)) then
      res := res || jsonb_build_array(jsonb_build_object('x', cx, 'y', cy, 't', 'grv'));
      used := used || jsonb_build_object(cx || ':' || cy, true);
    end if;
  end loop;
  -- поля обломков: 4 блуждания по 3–5 гексов
  for i in 1..4 loop
    cx := (z + 2) + floor(random() * (w - 2 * z - 4))::int;
    cy := 1 + floor(random() * (h - 2))::int;
    n  := 3 + floor(random() * 3)::int;
    for j in 1..n loop
      if cx >= z + 1 and cx < w - z - 1 and cy >= 0 and cy < h
         and not (used ? (cx || ':' || cy)) then
        res := res || jsonb_build_array(jsonb_build_object('x', cx, 'y', cy, 't', 'deb'));
        used := used || jsonb_build_object(cx || ':' || cy, true);
      end if;
      d := floor(random() * 6)::int;
      st := public._bt_step(cx, cy, d); cx := st[1]; cy := st[2];
    end loop;
  end loop;
  return res;
end$$;
revoke all on function public._bt_gen_terrain(uuid) from public;

-- ── 4) ТТХ проекта: + орудийные группы по секторам, сенсор, скрытность ──
-- Сектор узла — из схемы конструктора (layout.mounts[].pos): центр = нос,
-- x<155 = левый борт, x>165 = правый. Проекты без схемы — турели ('any').
create or replace function public._bt_stats(p_unit uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare u record; sm jsonb; cls text; spd int; rng numeric; cab jsonb;
        wpn jsonb; sens int;
begin
  select * into u from public.faction_units where id = p_unit;
  if u.id is null then return null; end if;
  sm  := coalesce(u.summary, '{}'::jsonb);
  cls := nullif(u.data->>'class','');
  spd := greatest(1, least(40, round(coalesce((sm->>'speed')::numeric, 4))::int));
  cab := public._cn_catalog();

  -- орудийные группы: (сектор, дальность) → суммарный урон
  with mounts as (
    select coalesce(m->'w'->>'g', m->>'g') as g,
           coalesce((m->'w'->>'idx')::int, (m->>'idx')::int) as idx,
           case when m->'pos' is null then 'nose'
                when (m->'pos'->>'x')::numeric < 155 then 'left'
                when (m->'pos'->>'x')::numeric > 165 then 'right'
                else 'nose' end as s,
           1 as q
      from jsonb_array_elements(coalesce(u.data->'layout'->'mounts','[]'::jsonb)) m
     where coalesce(m->'w'->>'g', m->>'g') is not null
    union all
    -- проекты без схемы (старый формат / наземка): орудия-«турели»
    select w->>'g', coalesce((w->>'idx')::int, -1), 'any',
           greatest(1, coalesce((w->>'q')::int, 1))
      from jsonb_array_elements(coalesce(u.data->'weapons','[]'::jsonb)) w
     where u.data->'layout'->'mounts' is null
  ), shots as (
    select m.s,
           greatest(1, least(40, round(coalesce(
             (cab->coalesce(u.category,'ship')->'weapons'->m.g->m.idx->>'dalnost')::numeric, 1))))::int as rng,
           coalesce((cab->coalesce(u.category,'ship')->'weapons'->m.g->m.idx->>'dmg')::numeric, 0) * m.q as dmg,
           -- тип урона для стойкостей брони: ballistic→kinetic
           case public._cn_wpn_kind(cab->coalesce(u.category,'ship')->'weapons'->m.g->m.idx->>'name')
             when 'missile' then 'missile' when 'energy' then 'energy' else 'kinetic' end as k
      from mounts m
     where cab->coalesce(u.category,'ship')->'weapons'->m.g->m.idx is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('s', gg.s, 'rng', gg.rng, 'dmg', round(gg.sum_dmg), 'k', gg.k)), '[]'::jsonb)
    into wpn
    from (select shots.s, shots.rng, shots.k, sum(shots.dmg) as sum_dmg from shots where shots.dmg > 0 group by shots.s, shots.rng, shots.k) gg;

  select coalesce(max((g->>'rng')::int), 1) into rng from jsonb_array_elements(wpn) g;
  if jsonb_array_length(wpn) = 0 then
    rng := greatest(1, least(40, coalesce((sm->>'rng')::numeric, 1)));
  end if;

  sens := greatest(6, least(30, round(coalesce(nullif((sm->>'radar')::numeric, 0), 10))::int));

  return jsonb_build_object(
    'name',    u.name,
    'cls',     cls,
    'hp',      greatest(1, coalesce((sm->>'hp')::numeric, 100)),
    'armor',   greatest(0, coalesce((sm->>'armor')::numeric, 0)),
    'shield',  greatest(0, coalesce((sm->>'shield')::numeric, 0)),
    'dmg',     greatest(1, coalesce((sm->>'dmg')::numeric, 10)),
    'speed',   spd,
    'rng',     round(rng)::int,
    'wpn',     wpn,
    'sensor',  sens,
    'stealth', public._bt_stealth(cls),
    -- стойкости брони проекта (алхимия): гасят урон по типу орудия
    'resist',  coalesce(sm->'armor_resist',
                        '{"kinetic":0,"energy":0,"missile":0}'::jsonb));
end$$;
revoke all on function public._bt_stats(uuid) from public;

-- ── 5) Расстановка: курс и новые ТТХ при высадке ─────────────
-- (переопределяем только вставку — тело battle_deploy из rework + facing)
create or replace function public.battle_deploy(p_battle uuid, p_units jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; sd text; b record; e jsonb; uid uuid; st jsonb;
        cnt int; free int; used int; px int; py int; n int := 0; z int := public._bt_zone();
        fc int;
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
  fc := case when sd = 'attacker' then 0 else 3 end;   -- курс: к врагу

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
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist)
      values (p_battle, me, sd, uid, st->>'name', st->>'cls', px, py,
        (st->>'hp')::numeric, (st->>'hp')::numeric, (st->>'armor')::numeric,
        (st->>'shield')::numeric, (st->>'shield')::numeric, (st->>'dmg')::numeric,
        (st->>'speed')::int, (st->>'rng')::int,
        fc, public._bt_turnneed(st->>'cls'), (st->>'sensor')::int, (st->>'stealth')::int,
        st->'wpn', st->'resist');
    n := n + 1;
    if n > public._bt_cap() then raise exception 'в бой можно вывести не больше % кораблей', public._bt_cap(); end if;
  end loop;

  select count(*) into cnt from public.battle_units where battle_id = p_battle and fid = me;
  return jsonb_build_object('ok', true, 'deployed', cnt);
end$$;

-- ── 6) Ход = МАРШРУТ. Инерция поворота, обломки, туманность ──
drop function if exists public.battle_move(uuid, uuid, int, int);
create or replace function public.battle_move(p_battle uuid, p_unit uuid, p_path jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; u record; e jsonb;
        cx int; cy int; nx int; ny int; d int; rel int;
        f int; s int; need int; steps int := 0; maxs int; terr text; last boolean;
        i int; total int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if u.moved then raise exception 'этот корабль уже ходил в этом ходу'; end if;
  total := coalesce(jsonb_array_length(p_path), 0);
  if total < 1 then raise exception 'пустой маршрут'; end if;

  maxs := u.speed;
  if public._bt_terra(b.terrain, u.x, u.y) = 'deb' then maxs := greatest(1, maxs - 1); end if;
  if total > maxs then
    raise exception '«%» проходит % гексов за ход (обломки замедляют), а маршрут — %', u.unit_name, maxs, total;
  end if;

  cx := u.x; cy := u.y; f := u.facing; s := u.straight;
  need := public._bt_turnneed(u.cls);
  i := 0;
  for e in select value from jsonb_array_elements(p_path) loop
    i := i + 1; last := (i = total);
    nx := coalesce((e->>'x')::int, -1); ny := coalesce((e->>'y')::int, -1);
    if nx < 0 or nx >= public._bt_w() or ny < 0 or ny >= public._bt_h() then
      raise exception 'маршрут выходит за доску';
    end if;
    if public._bt_dist(cx, cy, nx, ny) <> 1 then raise exception 'маршрут разорван — шаг только в соседний гекс'; end if;
    d := public._bt_dirof(cx, cy, nx, ny);
    rel := ((d - f) % 6 + 6) % 6;
    if rel = 0 then
      s := s + 1;
    elsif rel = 1 or rel = 5 then
      if s < need then
        raise exception '«%» слишком тяжёл для манёвра: перед поворотом нужно пройти прямо % гекс(а), пройдено %', u.unit_name, need, s;
      end if;
      f := d; s := 1;
    else
      raise exception 'слишком крутой вираж: не больше 60° за один гекс';
    end if;
    if exists(select 1 from public.battle_units
               where battle_id = p_battle and alive and x = nx and y = ny) then
      raise exception 'гекс %:% занят — сквозь корабли не летают', nx, ny;
    end if;
    cx := nx; cy := ny;
  end loop;

  perform public._bt_use_act(p_battle, p_unit);
  terr := public._bt_terra(b.terrain, cx, cy);
  update public.battle_units
     set x = cx, y = cy, facing = f, straight = s, moved = true,
         shield = case when terr = 'neb' then 0 else shield end
   where id = p_unit;
  if terr = 'neb' then
    perform public._bt_log(p_battle, format('%s входит в туманность — защитное поле схлопывается', u.unit_name));
  end if;
  return jsonb_build_object('ok', true, 'facing', f);
end$$;

-- ── 7) Выстрел: сектора, полосы дальности, захват, линия огня ──
create or replace function public.battle_fire(p_battle uuid, p_unit uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; u record; t record; dist int;
        wg jsonb; rel int; relt int; dmg numeric := 0; mult numeric; posmul numeric;
        absorbed numeric; hull numeric; killed boolean := false;
        tsh numeric; band_ok boolean := false; arc_ok boolean := false; nsect text;
        rk numeric; resisted numeric := 0;
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

  -- захват цели: у кого-то из своих (sensor − stealth) > дистанция до неё
  if not exists(select 1 from public.battle_units m
                 where m.battle_id = p_battle and m.side = u.side and m.alive
                   and public._bt_detected(m.x, m.y, m.facing, m.sensor,
                                           t.x, t.y, t.stealth, t.flash)) then
    raise exception 'цель не захвачена: неопознанный контакт. Наведите на неё нос корабля с радаром или подведите ближе (визуал — 3 гекса)';
  end if;

  if not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
    raise exception 'линия огня перекрыта астероидами';
  end if;

  -- какие орудийные группы достают: дальность 1..R + сектор наведения
  -- Секторы (rel = направление на цель − курс, 0 = прямо по носу):
  --   нос — передние 180° {5,0,1}; правый борт {1,2,3}; левый борт {3,4,5};
  --   турели (any) — круговые. Прямо в корму (rel 3) достаёт только борт.
  rel := ((public._bt_dirof(u.x, u.y, t.x, t.y) - u.facing) % 6 + 6) % 6;
  for wg in select value from jsonb_array_elements(
      case when u.wpn is null or jsonb_array_length(u.wpn) = 0
           then jsonb_build_array(jsonb_build_object('s','any','rng',u.rng,'dmg',u.dmg))
           else u.wpn end) loop
    nsect := wg->>'s';
    if dist >= 1 and dist <= (wg->>'rng')::int then
      band_ok := true;
      mult := case
        when nsect = 'any' then 1.0
        when nsect = 'nose'  and rel in (5,0,1) then 1.0
        when nsect = 'right' and rel in (1,2,3) then 0.9
        when nsect = 'left'  and rel in (3,4,5) then 0.9
        else null end;
      if mult is not null then
        arc_ok := true;
        -- стойкость брони цели к типу этой орудийной группы (алхимия):
        -- группа без типа (старый снапшот) считается кинетикой
        rk := least(0.9, greatest(0, coalesce(
                (t.resist->>coalesce(wg->>'k','kinetic'))::numeric, 0)));
        dmg := dmg + (wg->>'dmg')::numeric * mult * (1 - rk);
        resisted := resisted + (wg->>'dmg')::numeric * mult * rk;
      end if;
    end if;
  end loop;
  if not band_ok then
    raise exception 'дистанция % — дальше, чем бьют орудия «%»', dist, u.unit_name;
  end if;
  if not arc_ok then
    raise exception 'цель вне секторов обстрела: нос бьёт вперёд, борта — вбок и назад, прямо в корму огня нет. Доверните корабль';
  end if;

  perform public._bt_use_act(p_battle, p_unit);

  -- положение цели: в лоб ×1.0, в борт ×1.25, в корму ×2.0
  relt := ((public._bt_dirof(t.x, t.y, u.x, u.y) - t.facing) % 6 + 6) % 6;
  posmul := case when relt = 0 then 1.0 when relt = 3 then 2.0 else 1.25 end;
  dmg := dmg * posmul;

  -- ландшафт цели: туманность гасит щиты и рассеивает залп, обломки прикрывают
  tsh := t.shield;
  if public._bt_terra(b.terrain, t.x, t.y) = 'neb' then tsh := 0; dmg := dmg * 0.7; end if;
  if public._bt_terra(b.terrain, t.x, t.y) = 'deb' then dmg := dmg * 0.85; end if;

  absorbed := least(tsh, dmg);
  hull := greatest(dmg * 0.10, (dmg - absorbed) - t.armor);
  if dmg - absorbed <= 0 then hull := 0; end if;
  update public.battle_units
     set shield = tsh - absorbed,
         hp = greatest(0, t.hp - hull),
         alive = (t.hp - hull) > 0
   where id = p_target;
  killed := (t.hp - hull) <= 0;
  -- выстрел выдал позицию: скрытность стрелявшего обнулена до его следующего хода
  update public.battle_units set fired = true, flash = true where id = p_unit;

  perform public._bt_log(p_battle, format('%s → %s: %s урона%s%s%s',
    u.unit_name, t.unit_name, round(absorbed + hull),
    case when resisted >= 1 then format(' (броня рассеяла %s)', round(resisted)) else '' end,
    case when relt = 3 then ' (в корму ×2)' when relt <> 0 then ' (в борт ×1.25)' else '' end,
    case when killed then ' — цель уничтожена' else '' end));
  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'shield_absorbed', round(absorbed), 'hull', round(hull),
                            'resisted', round(resisted), 'killed', killed, 'posmul', posmul);
end$$;

-- ── 8) Конец хода: астероиды грызут, колодцы тянут ───────────
create or replace function public._bt_env_end(p_battle uuid, p_side text)
returns void language plpgsql security definer set search_path=public as $$
declare b record; r record; wl record; d int; st int[]; nbx int; nby int; bd int;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null then return; end if;
  -- астероиды: сторона, закончившая ход в поясе, платит 10% max_hp
  for r in select * from public.battle_units
            where battle_id = p_battle and side = p_side and alive
              and public._bt_terra(b.terrain, x, y) = 'ast' loop
    update public.battle_units
       set hp = greatest(0, hp - max_hp * 0.10),
           alive = (hp - max_hp * 0.10) > 0
     where id = r.id;
    perform public._bt_log(p_battle, format('%s дробит обшивку в астероидном поясе (−10%% корпуса)', r.unit_name));
  end loop;
  -- гравитационные колодцы: всех в радиусе 3 тянет на 1 гекс к центру
  for wl in select (e->>'x')::int wx, (e->>'y')::int wy
              from jsonb_array_elements(coalesce(b.terrain,'[]'::jsonb)) e
             where e->>'t' = 'grv' loop
    for r in select * from public.battle_units
              where battle_id = p_battle and alive
                and public._bt_dist(x, y, wl.wx, wl.wy) between 1 and 3 loop
      nbx := null; bd := public._bt_dist(r.x, r.y, wl.wx, wl.wy);
      for d in 0..5 loop
        st := public._bt_step(r.x, r.y, d);
        if st[1] >= 0 and st[1] < public._bt_w() and st[2] >= 0 and st[2] < public._bt_h()
           and public._bt_dist(st[1], st[2], wl.wx, wl.wy) < bd
           and not exists(select 1 from public.battle_units
                           where battle_id = p_battle and alive and x = st[1] and y = st[2]) then
          nbx := st[1]; nby := st[2]; bd := public._bt_dist(st[1], st[2], wl.wx, wl.wy);
        end if;
      end loop;
      if nbx is not null then
        update public.battle_units set x = nbx, y = nby where id = r.id;
      end if;
    end loop;
  end loop;
  perform public._bt_check_end(p_battle);
end$$;
revoke all on function public._bt_env_end(uuid,text) from public;

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

  perform public._bt_env_end(p_battle, sd);

  nxt := case when sd = 'attacker' then 'defender' else 'attacker' end;
  -- новая сторона: свежие действия, «вспышки» её кораблей гаснут
  update public.battle_units set moved = false, fired = false, acted = false, flash = false
   where battle_id = p_battle and side = nxt;
  update public.battles
     set side_to_move = nxt, turn_no = turn_no + 1, acts_left = public._bt_acts(),
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;

  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true);
end$$;

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
  perform public._bt_env_end(p_battle, b.side_to_move);
  nxt := case when b.side_to_move = 'attacker' then 'defender' else 'attacker' end;
  update public.battle_units set moved = false, fired = false, acted = false, flash = false
   where battle_id = p_battle and side = nxt;
  update public.battles
     set side_to_move = nxt, turn_no = turn_no + 1, acts_left = public._bt_acts(),
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;
  perform public._bt_log(p_battle, 'Сторона не явилась к сроку — ход сгорел.');
  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true);
end$$;

-- ── 9) Подкрепление: только свежим ходом ─────────────────────
create or replace function public.battle_reinforce(p_battle uuid, p_unit_id uuid, p_y int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; sd text; st jsonb; free int; used int; px int; py int; cnt int; fc int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  sd := public._bt_side(p_battle, me);

  -- вызов стоит ЦЕЛОГО хода: на початом ходу (после любой активации) нельзя
  if b.acts_left < public._bt_acts() then
    raise exception 'подкрепление вызывается только свежим ходом: оно стоит всех % активаций. Сейчас часть хода уже потрачена', public._bt_acts();
  end if;

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
  fc := case when sd = 'attacker' then 0 else 3 end;

  px := case when sd = 'attacker' then 0 else public._bt_w() - 1 end;
  py := greatest(0, least(public._bt_h() - 1, coalesce(p_y, public._bt_h() / 2)));
  select g into py from generate_series(0, public._bt_h()-1) g
    where not exists(select 1 from public.battle_units
                      where battle_id=p_battle and alive and x=px and y=g)
    order by abs(g - py), g
    limit 1;
  if py is null then raise exception 'некуда вывести подкрепление — край доски занят'; end if;

  insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
      hp, max_hp, armor, shield, max_shield, dmg, speed, rng, moved, fired, acted,
      facing, straight, sensor, stealth, wpn)
    values (p_battle, me, sd, p_unit_id, st->>'name', st->>'cls', px, py,
      (st->>'hp')::numeric, (st->>'hp')::numeric, (st->>'armor')::numeric,
      (st->>'shield')::numeric, (st->>'shield')::numeric, (st->>'dmg')::numeric,
      (st->>'speed')::int, (st->>'rng')::int, true, true, true,
      fc, public._bt_turnneed(st->>'cls'), (st->>'sensor')::int, (st->>'stealth')::int, st->'wpn');

  perform public._bt_log(p_battle, format('%s вызывает подкрепление: %s', public._war_nm(me), st->>'name'));
  perform public.battle_end_turn(p_battle);
  return jsonb_build_object('ok', true);
end$$;

-- ── 10) Состояние: ландшафт, курсы, сигнатуры ────────────────
-- Незахваченные чужие корабли — усечённо: только гекс («контакт»).
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

  -- ландшафт генерится лениво один раз (сид = id боя)
  if b.terrain is null then
    update public.battles set terrain = public._bt_gen_terrain(p_battle)
     where id = p_battle and terrain is null;
    select * into b from public.battles where id = p_battle;
  end if;

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
    'terrain', coalesce(b.terrain, '[]'::jsonb),
    'pool', public.battle_pool(p_battle, me),
    'units', (select coalesce(jsonb_agg(
        case when u.side = sd or lk.locked then
          jsonb_build_object(
            'id', u.id, 'side', u.side, 'mine', (u.fid = me),
            'name', u.unit_name, 'cls', u.cls,
            'x', u.x, 'y', u.y, 'facing', u.facing, 'straight', u.straight,
            'hp', round(u.hp), 'max_hp', round(u.max_hp),
            'shield', round(u.shield), 'max_shield', round(u.max_shield),
            'armor', round(u.armor), 'dmg', round(u.dmg),
            'speed', u.speed, 'rng', u.rng,
            'sensor', u.sensor, 'stealth', u.stealth, 'flash', u.flash,
            'locked', true,
            'wpn', case when u.side = sd then coalesce(u.wpn, '[]'::jsonb) else null end,
            'moved', u.moved, 'fired', u.fired, 'acted', u.acted)
        else
          jsonb_build_object(
            'id', u.id, 'side', u.side, 'mine', false, 'contact', true,
            'locked', false, 'x', u.x, 'y', u.y)
        end order by u.created_at), '[]'::jsonb)
      from public.battle_units u
      cross join lateral (select exists(
          select 1 from public.battle_units m
           where m.battle_id = p_battle and m.side = sd and m.alive
             and public._bt_detected(m.x, m.y, m.facing, m.sensor,
                                     u.x, u.y, u.stealth, u.flash)) as locked) lk
      where u.battle_id = p_battle and u.alive));
end$$;

-- ── Проверка ────────────────────────────────────────────────
-- 1) battle_state → terrain: массив {x,y,t}, у своих units есть facing/wpn,
--    далёкий враг = {contact:true, x, y} без имени и HP.
-- 2) battle_move со «змейкой» круче 60°/гекс → exception «слишком крутой вираж».
-- 3) Поворот дредноутом без 4 прямых гексов → exception про манёвр.
-- 4) Выстрел с дистанции 3 орудием дальности 5 → «вне полос дальности».
-- 5) Выстрел через астероид → «линия огня перекрыта».
-- 6) Выстрел по контакту (не захвачен) → «цель не захвачена».
-- 7) battle_reinforce после хода любым кораблём → «только свежим ходом».
-- 8) Конец хода в астероидах → −10% корпуса в журнале.
