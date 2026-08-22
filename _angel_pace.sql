-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 24: ЗА УБЕГАЮЩИМ НЕ ГОНЯЮТСЯ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_orders.sql. Надмножество `_angel_host_orders`,
-- `_angel_wing_send` и `_angel_send`. ⚠️ Правки хода вести ОТСЮДА.
--
-- ЧТО БЫЛО ИЗМЕРЕНО (21-22.08, живая карта):
--   • перелёт sys_15 → «Великий трон» — 12.8 часа, sys_15 → sys_00 — 5.7;
--   • скорость у всех ОДНА: и ковчег, и крылья, и любой игрок считают время по
--     `_fleet_fly_hours`, то есть по одной и той же трассе с одинаковым тарифом;
--   • дальность залпа МЗА — 4 прыжка (тяжёлому — 8), поиск цели у тела — 5
--     прыжков, охота крыла — 3.
-- Отсюда прямое следствие: догнать флот, который не хочет драться, НЕЛЬЗЯ в
-- принципе. Он делает ровно тот же прыжок, что и преследователь, и разрыв не
-- сокращается никогда. А шаг 23 в этом ещё и помогал: в лестнице охоты чужой
-- флот стоял ВЫШЕ колонии («он уйдёт, она нет») — то есть крылья намеренно
-- отправлялись за самой убегающей целью на карте. Это был подарок игроку:
-- води их по кругу и делай что хочешь.
--
-- ЧТО МЕНЯЕМ, ДВЕ ВЕЩИ.
--   1) ЦЕЛЬ — ТО, ЧТО НЕ БЕГАЕТ. Крыло идёт на КОЛОНИЮ. Чужой флот считается
--      целью, только если он стоит рядом — в своей же системе или в одном
--      прыжке: тут это не погоня, а прыжок на дистанцию удара. Дальше первого
--      прыжка за флотом не ходим вовсе.
--   2) ХОД. Тело и его подобия идут быстрее обычных кораблей: ковчег ×0.62,
--      крылья ×0.72 от общего тарифа. Это не «догнать бегущего» (см. п.1) —
--      это чтобы игрок не мог безнаказанно ЖИТЬ в двух прыжках от кризиса,
--      успевая вернуться раньше, чем тот придёт. Расстояние наказывает всех
--      одинаково, разница только в темпе.
--
-- ⚠️ ПОЧЕМУ НЕ ПРОСТО «СДЕЛАТЬ ИХ БЫСТРЕЕ ВДВОЕ». Потому что от погони это не
-- лечит: убегающий всё равно уходит первым и всегда с полным ходом, а вдвое
-- быстрый кризис ловит уже не флот, а всю галактику за сутки. Настоящий ответ
-- на бегство лежит не в скорости, а в баллистике: «Сполох» ведёт тепловую
-- сигнатуру и берёт флот там, где он есть, — от него уйти нельзя вообще, и
-- бьёт он на 4 прыжка. Кузница теперь держит его запас (шаг 20), рук у тела
-- до четырёх — вот этим и надо отвечать на «летает и байтит», а не гонкой.
-- ════════════════════════════════════════════════════════════

create or replace function public._angel_pace(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'ark'  then 0.62      -- доля общего времени перелёта для ковчега
    when 'wing' then 0.72      -- для крыльев
    when 'chase_hops' then 1   -- дальше этого за ЧУЖИМ ФЛОТОМ не ходим
    when 'hunt_hops'  then 3   -- радиус поиска целей крылом
    else 1 end
$$;

-- ── ХОД ТЕЛА ────────────────────────────────────────────────
-- Надмножество _angel_no_grip.sql (шаг 6.5). Вставка одна — множитель темпа.
create or replace function public._angel_send(p_dest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; f record; pth jsonb; sched jsonb; fly numeric; dep timestamptz := now();
        log jsonb;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;
  select * into f from public.fleets where id = a.fleet_id for update;
  if f.id is null then return jsonb_build_object('ok', false, 'why', 'ковчега нет'); end if;
  if f.status <> 'idle' then return jsonb_build_object('ok', true, 'moving', true); end if;
  if p_dest is null or p_dest = f.system_id then return jsonb_build_object('ok', true, 'stay', true); end if;
  if not exists(select 1 from public.map_systems where id = p_dest) then
    return jsonb_build_object('ok', false, 'why', 'нет такой системы');
  end if;

  pth   := public._fleet_path(f.system_id, p_dest);
  fly   := coalesce(public._fleet_fly_hours(f.system_id, p_dest), 2.0)
         * public._angel_pace('ark');
  sched := case when pth is null then null else public._fleet_schedule(pth, dep) end;

  update public.fleets
     set status='transit', from_sys=system_id, dest_sys=p_dest, system_id=null,
         depart_at=dep, arrive_at=dep + (fly || ' hours')::interval,
         route=pth, route_at=sched, fuel=fuel_cap
   where id = f.id;

  -- память похода: последние 12 систем, чтобы не ходить челноком
  log := coalesce(a.path_log, '[]'::jsonb) || jsonb_build_array(p_dest);
  if jsonb_array_length(log) > 12 then
    log := (select coalesce(jsonb_agg(v), '[]'::jsonb) from (
              select value v, row_number() over () rn
                from jsonb_array_elements(log)) q
             where rn > jsonb_array_length(log) - 12);
  end if;
  update public.angel_state set target_sys = p_dest, path_log = log
   where faction_id = a.faction_id;

  return jsonb_build_object('ok', true, 'act', 'march', 'dest', p_dest, 'fly_h', round(fly,1));
end$$;
revoke all on function public._angel_send(text) from public;

-- ── ХОД КРЫЛА ───────────────────────────────────────────────
create or replace function public._angel_wing_send(p_fleet uuid, p_dest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; f record; pth jsonb; sched jsonb; fly numeric; dep timestamptz := now();
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;
  if p_fleet = a.fleet_id then return jsonb_build_object('ok', false, 'why', 'это тело'); end if;

  select * into f from public.fleets where id = p_fleet for update;
  if f.id is null or f.faction_id is distinct from a.faction_id then
    return jsonb_build_object('ok', false, 'why', 'не его флот');
  end if;
  if f.status <> 'idle' then return jsonb_build_object('ok', true, 'moving', true); end if;
  if p_dest is null or p_dest = f.system_id then return jsonb_build_object('ok', true, 'stay', true); end if;
  if public._fleet_in_battle(f.id) is not null then
    return jsonb_build_object('ok', true, 'busy', true);
  end if;
  if not exists(select 1 from public.map_systems where id = p_dest) then
    return jsonb_build_object('ok', false, 'why', 'нет такой системы');
  end if;

  pth   := public._fleet_path(f.system_id, p_dest);
  fly   := coalesce(public._fleet_fly_hours(f.system_id, p_dest), 2.0)
         * public._angel_pace('wing');
  sched := case when pth is null then null else public._fleet_schedule(pth, dep) end;

  update public.fleets
     set status = 'transit', from_sys = system_id, dest_sys = p_dest, system_id = null,
         depart_at = dep, arrive_at = dep + (fly || ' hours')::interval,
         route = pth, route_at = sched, fuel = fuel_cap
   where id = f.id;

  return jsonb_build_object('ok', true, 'dest', p_dest, 'fly_h', round(fly, 1));
end$$;
revoke all on function public._angel_wing_send(uuid,text) from public;

-- ── ПРИКАЗЫ: ОХОТА ПО НЕПОДВИЖНОМУ ──────────────────────────
-- Надмножество шага 23. Изменена только лестница цели (п. 2).
create or replace function public._angel_host_orders()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; ark record; w record; dest text; n int := 0; hunted int := 0;
        held int := 0; rescue int := 0; back int := 0; lead uuid; ark_bt text;
        chase int; hunt int;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;
  select * into ark from public.fleets where id = a.fleet_id;
  chase := public._angel_pace('chase_hops')::int;
  hunt  := public._angel_pace('hunt_hops')::int;

  select b.system_id into ark_bt
    from public.battles b
   where b.status <> 'done'
     and (b.attacker_fid = a.faction_id or b.defender_fid = a.faction_id)
     and exists (select 1 from public.battle_units u
                  where u.battle_id = b.id and u.cls = 'angel' and u.alive)
   order by b.created_at desc limit 1;

  select g.fleet_id into lead from public.angel_guard g
   where g.role = 'escort' and g.dead_at is null
   order by g.ord limit 1;

  for w in select distinct f.id, f.system_id from public.fleets f
             join public.angel_guard g on g.fleet_id = f.id and g.dead_at is null
                                      and g.role = 'escort'
            where f.status = 'idle' and f.system_id is not null
  loop
    if public._fleet_in_battle(w.id) is not null then continue; end if;
    dest := null;

    -- 1) ТЕЛО В БОЮ — идём на выручку.
    if ark_bt is not null and w.system_id is distinct from ark_bt then
      if (public._angel_wing_send(w.id, ark_bt)->>'ok')::boolean then
        rescue := rescue + 1; n := n + 1;
      end if;
      continue;
    end if;

    -- 2) ЦЕЛЬ. Сначала — ЧУЖОЙ ФЛОТ В ОДНОМ ПРЫЖКЕ: это не погоня, это удар по
    --    тому, кто уже рядом. Дальше — только КОЛОНИИ: они никуда не денутся,
    --    и именно за них кризис и воюет.
    select r.sid into dest
      from public._angel_reach(w.system_id, chase) r
     where not exists (select 1 from public.fleets x
                        where x.faction_id = a.faction_id and x.system_id = r.sid)
       and exists (select 1 from public.fleets fl
                    where fl.system_id = r.sid and fl.status = 'idle'
                      and fl.faction_id is distinct from a.faction_id
                      and fl.faction_id in (select public.war_enemies_of(a.faction_id)))
     order by r.d asc limit 1;

    if dest is null then
      select r.sid into dest
        from public._angel_reach(w.system_id, hunt) r
       where not exists (select 1 from public.fleets x
                          where x.faction_id = a.faction_id and x.system_id = r.sid)
         and exists (select 1 from public.colonies c
                      where c.system_id = r.sid
                        and c.faction_id in (select public.war_enemies_of(a.faction_id)))
       order by (select coalesce(sum(coalesce(c.pop, 0)), 0) from public.colonies c
                  where c.system_id = r.sid) desc,
                r.d asc
       limit 1;
    end if;

    if dest is not null then
      if (public._angel_wing_send(w.id, dest)->>'ok')::boolean then
        hunted := hunted + 1; n := n + 1;
      end if;
      continue;
    end if;

    -- 3) ГАРНИЗОН.
    if w.id is distinct from lead then
      select o.system_id into dest from public.system_occupation o
       where o.occupier_fid = a.faction_id
         and not exists (select 1 from public.fleets x
                          where x.faction_id = a.faction_id and x.system_id = o.system_id)
       limit 1;
      if dest is not null then
        if (public._angel_wing_send(w.id, dest)->>'ok')::boolean then
          held := held + 1; n := n + 1;
        end if;
        continue;
      end if;
    end if;

    -- 4) ИНАЧЕ — к телу (только если оно уже прилетело: не обгоняем).
    if ark.system_id is not null and w.system_id is distinct from ark.system_id then
      if (public._angel_wing_send(w.id, ark.system_id)->>'ok')::boolean then
        back := back + 1; n := n + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'sent', n, 'rescue', rescue,
                            'hunt', hunted, 'hold', held, 'follow', back);
end$$;
revoke all on function public._angel_host_orders() from public;

notify pgrst, 'reload schema';

-- ── ПРОВЕРКА ────────────────────────────────────────────────
-- 1) Перелёт ковчега стал короче примерно на треть, крыла — на четверть.
-- 2) Чужой флот в двух прыжках → крыло на него НЕ идёт (идёт на колонию).
-- 3) Чужой флот в одном прыжке → крыло прыгает на него.
-- 4) Убегающий флот в радиусе 4 прыжков от МЗА → его берёт «Сполох», а не гонка.
