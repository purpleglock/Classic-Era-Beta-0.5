-- © 2025–2026. Все права защищены.
-- ═══════════════════════════════════════════════════════════════════
-- 🧠 ИИ: КОГО ПЕРЕСТРЕЛИВАТЬ НЕЛЬЗЯ — ТОГО ДАВЯТ
-- ═══════════════════════════════════════════════════════════════════
-- ПОРЯДОК: после _bot_ai_brain.sql, _bot_doctrine.sql, _bot_engage_fix.sql.
-- Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК. Игрок вывел осадную артиллерию («Крупеллярий», ствол на
-- 30 клеток, режим осады) и расстреливал легион с дистанции, на которой тот
-- физически не отвечает. Легион при этом держал рубеж и вёл вялую
-- перестрелку — то есть добровольно играл в игру, которую не может выиграть.
--
-- 1) РУБЕЖ НЕ СРАВНИВАЛСЯ С ЧУЖИМ. Борт смотрел только на СВОЙ рубеж: «до
--    врага меньше моего рубежа — значит, стою правильно». Но рубеж меряется
--    не стволом, а тем, докуда сторона ВИДИТ (сенсор 6 у катера против
--    подсветки 17 у чужого разведчика). Если враг достаёт дальше — стоять
--    нельзя ни секунды: каждый ход обмена идёт в одни ворота.
--    Стало: считаем РАБОЧУЮ дальность обеих сторон (ствол, обрезанный
--    глазами стороны). Достаёт враг дальше — режим «сближение» независимо
--    от роли, даже если по кому-то уже идёт огонь.
--
-- 2) ФОКУС НЕ ВИДЕЛ РАЗНИЦЫ МЕЖДУ ПУШКОЙ И КАТЕРОМ. Замысел на ход брал
--    «урон × модули / живучесть» — и осадная батарея, которая и решает бой,
--    шла в общей очереди. Стало: цель, которая бьёт дальше нас или встала в
--    осаду (а значит, не убежит), весит вдвое. Артиллерию давят первой.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. РАБОЧАЯ ДАЛЬНОСТЬ: ствол, обрезанный глазами ─────────────────
create or replace function public._bt_bot_work_reach(p_battle uuid, p_unit uuid)
returns int language plpgsql stable security definer set search_path=public as $fn$
declare u record;
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null then return 1; end if;
  -- +2 к глазам: подсветку даёт вся сторона, и цель обычно сама идёт навстречу
  return greatest(1, least(public._bt_bot_reach(p_unit),
                           public._bt_bot_eyes(p_battle, u.side) + 2));
end$fn$;
revoke all on function public._bt_bot_work_reach(uuid,uuid) from public;

-- Самая длинная рабочая рука ВРАГА. Считается один раз на активацию.
create or replace function public._bt_bot_foe_reach(p_battle uuid, p_side text)
returns int language sql stable security definer set search_path=public as $$
  select coalesce(max(least(greatest(1, e.rng),
                            public._bt_bot_eyes(p_battle, e.side) + 2)), 1)::int
    from public.battle_units e
   where e.battle_id = p_battle and e.alive and e.side <> p_side;
$$;
revoke all on function public._bt_bot_foe_reach(uuid,text) from public;

-- ── 2. ХОД БОРТА: перестрелку на чужих условиях не ведём ────────────
create or replace function public._bt_bot_act(p_battle uuid, p_unit uuid, p_fid text)
returns boolean language plpgsql security definer set search_path=public as $fn$
declare u record; role text; band int; mode text; did boolean := false;
        m jsonb; tgt uuid; path jsonb; reserve numeric; i int; hpq numeric;
        near int; threat numeric; foe_raw int; has_tgt boolean;
        my_work int; foe_work int; outranged boolean;
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null or not u.alive then return false; end if;

  role := public._bt_bot_role(p_battle, p_unit);
  band := public._bt_bot_band(p_battle, p_unit);
  hpq  := coalesce(u.hp,0) / greatest(1, coalesce(u.max_hp,1));
  select coalesce(min(public._bt_dist(u.x, u.y, e.x, e.y)), 999) into near
    from public.battle_units e
   where e.battle_id = p_battle and e.alive and e.side <> u.side;
  threat := public._bt_threat_at(p_battle, u.side, u.x, u.y, false);
  select coalesce(max(greatest(1, e.rng)), 1) into foe_raw
    from public.battle_units e
   where e.battle_id = p_battle and e.alive and e.side <> u.side;
  has_tgt   := public._bt_bot_target(p_battle, p_unit) is not null;
  my_work   := public._bt_bot_work_reach(p_battle, p_unit);
  foe_work  := public._bt_bot_foe_reach(p_battle, u.side);
  -- враг достаёт дальше — держать дистанцию значит проигрывать по обмену
  outranged := foe_work > my_work + 1;

  if hpq < 0.35 and threat > (u.hp + u.shield) * 0.5 and not outranged then
    -- ОТСТУПЛЕНИЕ. Но не от того, кто бьёт дальше: от него не убежать,
    -- отход только продлит расстрел.
    mode := 'back'; band := greatest(band, public._bt_bot_reach(p_unit) + 3);
  elsif not public._bt_bot_committed(p_battle)
        and role in ('brawler','skirm') and foe_raw <= 12 and not has_tgt
        and not outranged then
    mode := 'stand'; band := greatest(band, foe_raw + 1);
  elsif outranged then
    -- ДАВИТЬ. Пока идём — теряем меньше, чем стоя под чужой артиллерией.
    mode := 'close';
  elsif not has_tgt then
    mode := 'close';
  elsif role = 'brawler' then
    mode := 'close';
  elsif near > band + 2 then
    mode := 'close';
  else
    mode := 'stand';
  end if;

  reserve := case when not u.fired and has_tgt
                  then public._bt_fire_cost(u.cls) else 0 end;

  for i in 1..2 loop
    m := public._bt_bot_module(p_battle, p_unit, reserve);
    exit when m is null;
    begin
      perform public._bt_do_module(p_battle, p_unit, m->>'k',
                nullif(m->>'t','')::uuid, (m->>'x')::int, (m->>'y')::int, p_fid);
      did := true;
    exception when others then exit; end;
  end loop;

  select * into u from public.battle_units where id = p_unit;
  if u.alive and not u.moved then
    path := public._bt_bot_route(p_battle, p_unit, mode, band);
    if coalesce(jsonb_array_length(path), 0) > 0 then
      begin
        perform public._bt_do_move(p_battle, p_unit, path, p_fid);
        did := true;
        perform public._bt_seen_arm(p_battle, u.side);
      exception when others then null; end;
    end if;
  end if;

  tgt := public._bt_bot_target(p_battle, p_unit);
  if tgt is not null then
    begin perform public._bt_do_fire(p_battle, p_unit, tgt, p_fid); did := true;
    exception when others then null; end;
  else
    tgt := public._bt_bot_repair(p_battle, p_unit);
    if tgt is not null then
      begin perform public._bt_do_fire(p_battle, p_unit, tgt, p_fid); did := true;
      exception when others then null; end;
    end if;
  end if;

  for i in 1..3 loop
    m := public._bt_bot_module(p_battle, p_unit, 0);
    exit when m is null;
    begin
      perform public._bt_do_module(p_battle, p_unit, m->>'k',
                nullif(m->>'t','')::uuid, (m->>'x')::int, (m->>'y')::int, p_fid);
      did := true;
    exception when others then exit; end;
  end loop;

  select * into u from public.battle_units where id = p_unit;
  if u.alive and coalesce(u.wings,0) > 0 and not u.is_wing and near <= 10 then
    begin perform public._bt_do_launch(p_battle, p_unit, p_fid); did := true;
    exception when others then null; end;
  end if;

  return did;
end$fn$;
revoke all on function public._bt_bot_act(uuid,uuid,text) from public;

-- ── 3. ФОКУС: артиллерия и лекарь вперёд всех ───────────────────────
create or replace function public._bt_bot_plan_build(p_battle uuid, p_side text)
returns void language plpgsql security definer set search_path=public as $fn$
declare b record; seen uuid[]; fo uuid; mine int; ready int; nearest int; go boolean;
        my_reach int;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null then return; end if;

  delete from public.bt_bot_plan p
   where not exists(select 1 from public.battles z where z.id = p.battle_id);
  delete from public.bt_bot_plan where battle_id = p_battle;

  seen := public._bt_seen_get(p_battle, p_side);
  if seen is null then seen := public._bt_seen_calc(p_battle, p_side); end if;
  if seen is null then seen := '{}'::uuid[]; end if;

  select coalesce(max(public._bt_bot_work_reach(p_battle, f.id)), 1) into my_reach
    from public.battle_units f
   where f.battle_id = p_battle and f.alive and f.side = p_side;

  -- ФОКУС: лекарь → артиллерия, которая бьёт дальше нас или встала в осаду
  -- (такая не убежит) → самый зубастый из достижимых.
  select e.id into fo
    from public.battle_units e
    cross join lateral (
      select count(*) as reachers
        from public.battle_units f
       where f.battle_id = p_battle and f.alive and f.side = p_side
         and public._bt_dist(f.x, f.y, e.x, e.y) <= public._bt_bot_reach(f.id)
                                                    + coalesce(f.speed, 0)
    ) rr
   where e.battle_id = p_battle and e.alive and e.side <> p_side
     and e.id = any(seen)
     and rr.reachers > 0
   order by exists(select 1 from jsonb_array_elements(coalesce(e.acts,'[]'::jsonb)) a
                    where a->>'k' in ('drones','wboost','hard')) desc,
            (rr.reachers >= 2) desc,
            (coalesce(e.dmg,0) * (1 + coalesce(jsonb_array_length(e.acts), 0))
              * case when e.stance = 'siege' or greatest(1, e.rng) > my_reach
                     then 2 else 1 end)
              / greatest(1, coalesce(e.hp,0) + coalesce(e.shield,0)) desc,
            e.id
   limit 1;

  select count(*) into mine from public.battle_units f
   where f.battle_id = p_battle and f.alive and f.side = p_side;
  select count(*) into ready from public.battle_units f
   where f.battle_id = p_battle and f.alive and f.side = p_side
     and exists(select 1 from public.battle_units e
                 where e.battle_id = p_battle and e.alive and e.side <> p_side
                   and public._bt_dist(f.x, f.y, e.x, e.y) <= public._bt_bot_reach(f.id));
  select coalesce(min(public._bt_dist(f.x, f.y, e.x, e.y)), 999) into nearest
    from public.battle_units f
    join public.battle_units e
      on e.battle_id = p_battle and e.alive and e.side <> p_side
   where f.battle_id = p_battle and f.alive and f.side = p_side;

  go := coalesce(b.turn_no, 0) >= 4
        or mine <= 2
        or ready * 2 >= mine
        or nearest <= 2
        -- нас перестреливают: ждать нечего, выдержка отменяется
        or public._bt_bot_foe_reach(p_battle, p_side) > my_reach;

  insert into public.bt_bot_plan(battle_id, side, focus, committed, turn_no)
    values (p_battle, p_side, fo, go, coalesce(b.turn_no, 0));
end$fn$;
revoke all on function public._bt_bot_plan_build(uuid,text) from public;

notify pgrst, 'reload schema';

-- Проверка:
--   select unit_name, public._bt_bot_work_reach(b, id) from battle_units ...
--   select public._bt_bot_foe_reach('<battle>', 'defender');
