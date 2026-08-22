-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 23: ВОИНСТВОМ КОМАНДУЮТ, А НЕ ВОЗЯТ ЗА СОБОЙ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_host.sql. Надмножество `_angel_host_follow` и
-- `angel_ai_tick`. ⚠️ Правки поведения крыльев вести ОТСЮДА.
--
-- ЧЕСТНЫЙ ОТВЕТ НА ВОПРОС «ТЫ ИМИ ВООБЩЕ КОМАНДУЕШЬ?».
--   В БОЮ — да, и с самого начала: борта стражи и эскорта ходят и стреляют
--   общим машинным мозгом (`_bt_bot_turn` → `_bt_bot_act`), тем же, что водит
--   пиратов Легиона. Отдельного ума им не нужно.
--   НА КАРТЕ — почти нет, и это была дыра. Всё, что умели крылья, — телепорт
--   за телом и посадка в занятую систему. Они не летали, не выбирали цели, не
--   шли на выручку ковчегу, когда его бьют, и не мешали никому жить. То есть
--   как боевые единицы на стратегическом слое они не существовали.
--
-- ЧТО ТЕПЕРЬ. Раз в тик каждое свободное крыло получает ОДИН приказ по
-- лестнице приоритетов:
--   1) ТЕЛО В БОЮ — всё бросаем и идём туда. Ковчег дерётся один по правилу
--      «на доску с ним выходят добровольно», но никто не запрещал его
--      сопровождению прийти на ту же доску: там ангел сторона, значит крыло
--      втягивается обычным порядком и выставляется тиком расстановки.
--   2) ОХОТА — ближайшая система в трёх прыжках, где стоит чужой флот или
--      живёт чужая колония (с кем война), и где нашего крыла ещё нет.
--   3) ГАРНИЗОН — занятая система без нашего флота: оккупацию снимают тихим
--      приходом владельца, если останавливать некому.
--   4) ИНАЧЕ — к телу.
--
-- ⚠️ ЛЕТЯТ ПО-НАСТОЯЩЕМУ. Прежний телепорт («они часть тела, как рука
-- Гиперпейсера») для сопровождения ещё сходил, но для крыла, которое идёт
-- ОХОТИТЬСЯ, он стал бы читерством: отметка возникает в системе без подлёта,
-- и ни перехватить её, ни увидеть заранее нельзя. Поэтому маршрут, время
-- подлёта и трасса — как у всех: `_fleet_path` + `_fleet_schedule`.
-- ════════════════════════════════════════════════════════════

-- ── ОТПРАВКА КРЫЛА ──────────────────────────────────────────
-- Слепок _angel_send для произвольного флота ангела: без памяти похода (она
-- принадлежит телу) и без права трогать сам ковчег.
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
  fly   := coalesce(public._fleet_fly_hours(f.system_id, p_dest), 2.0);
  sched := case when pth is null then null else public._fleet_schedule(pth, dep) end;

  update public.fleets
     set status = 'transit', from_sys = system_id, dest_sys = p_dest, system_id = null,
         depart_at = dep, arrive_at = dep + (fly || ' hours')::interval,
         route = pth, route_at = sched, fuel = fuel_cap
   where id = f.id;

  return jsonb_build_object('ok', true, 'dest', p_dest, 'fly_h', round(fly, 1));
end$$;
revoke all on function public._angel_wing_send(uuid,text) from public;

-- ── ПРИКАЗЫ КРЫЛЬЯМ ─────────────────────────────────────────
create or replace function public._angel_host_orders()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; ark record; w record; dest text; n int := 0; hunted int := 0;
        held int := 0; rescue int := 0; back int := 0; lead uuid; ark_bt text;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;
  select * into ark from public.fleets where id = a.fleet_id;

  -- Где сейчас дерётся тело (если дерётся).
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
      dest := ark_bt;
      if (public._angel_wing_send(w.id, dest)->>'ok')::boolean then
        rescue := rescue + 1; n := n + 1;
      end if;
      continue;
    end if;

    -- 2) ОХОТА: ближайшая система в трёх прыжках, где есть кого бить и где
    --    нашего крыла ещё нет. Чужой флот дороже колонии: он уйдёт, она нет.
    select r.sid into dest
      from public._angel_reach(w.system_id, 3) r
     where not exists (select 1 from public.fleets x
                        where x.faction_id = a.faction_id and x.system_id = r.sid)
       and (exists (select 1 from public.fleets fl
                     where fl.system_id = r.sid and fl.status = 'idle'
                       and fl.faction_id is distinct from a.faction_id
                       and fl.faction_id in (select public.war_enemies_of(a.faction_id)))
         or exists (select 1 from public.colonies c
                     where c.system_id = r.sid
                       and c.faction_id in (select public.war_enemies_of(a.faction_id))))
     order by (exists (select 1 from public.fleets fl
                        where fl.system_id = r.sid and fl.status = 'idle'
                          and fl.faction_id is distinct from a.faction_id)) desc,
              r.d asc
     limit 1;
    if dest is not null then
      if (public._angel_wing_send(w.id, dest)->>'ok')::boolean then
        hunted := hunted + 1; n := n + 1;
      end if;
      continue;
    end if;

    -- 3) ГАРНИЗОН: занятую систему без нашего флота надо держать.
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

-- ── ТИК: ПРИКАЗЫ ВМЕСТО ТЕЛЕПОРТА ───────────────────────────
-- Надмножество шага 22. `_angel_host_follow` больше не зовём: он телепортировал
-- крылья, а теперь они летают. Функцию оставляем в базе — ею чинят руками
-- разъехавшееся воинство, если понадобится.
create or replace function public.angel_ai_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare out jsonb := '{}'::jsonb;
begin
  begin out := out || jsonb_build_object('orders', public._angel_host_orders()); exception when others then null; end;
  begin out := out || jsonb_build_object('board',  public.angel_battle_tick());  exception when others then null; end;
  begin out := out || jsonb_build_object('war',    public.angel_war_tick());     exception when others then null; end;
  begin out := out || jsonb_build_object('barrage', public._angel_barrage());    exception when others then null; end;
  return out || jsonb_build_object('ok', true);
end$$;
revoke all on function public.angel_ai_tick() from public;

notify pgrst, 'reload schema';

-- ── ПРОВЕРКА ────────────────────────────────────────────────
-- 1) `select _angel_host_orders()` → крылья уходят в transit с честным
--    временем подлёта, а не возникают в системе мгновенно.
-- 2) Завязать бой с ковчегом → на следующем тике крылья идут в ту же систему
--    и втягиваются в ту же доску (там ангел сторона).
-- 3) Чужой флот в трёх прыжках → ближайшее свободное крыло идёт на него.
-- 4) Занятая система без нашего флота → туда садится крыло-гарнизон.
