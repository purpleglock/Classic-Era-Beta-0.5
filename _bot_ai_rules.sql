-- ═══════════════════════════════════════════════════════════════════
-- 🤖 БОТЫ ХОДЯТ ПО ПРАВИЛАМ БОЯ + имя стороны «Пустотные рейдеры»
--
-- 1) ИМЯ. Сторона ботов жила под техническим fid 'bot', и _war_nm отдавал
--    для неё «Одна из держав». Теперь у неё есть лицо: _bt_bot_name() →
--    «Пустотные рейдеры». Это имя идёт всюду, где считается _war_nm:
--    battle_state (attacker_name/defender_name), журнал боя, победа в админке.
--
-- 2) ПРАВИЛА. Старый _bt_bot_turn был отдельной «упрощённой боёвкой»:
--    ехал напролом, бил плоским u.dmg через щит-минус-броню, не знал ни
--    активаций, ни огневых групп, ни ПРО/стойкостей, ни радаров, ни ландшафта.
--    Теперь боевое ядро вынесено из игроцких RPC в общие функции с явным
--    актором:
--      _bt_do_move(bid, unit, path, fid)    ← тело battle_move
--      _bt_do_fire(bid, unit, target, fid)  ← тело battle_fire
--      _bt_do_launch(bid, unit, fid)        ← тело battle_launch
--      _bt_do_end_turn(bid, fid)            ← тело battle_end_turn
--    а battle_move / battle_fire / battle_launch / battle_end_turn стали
--    тонкими обёртками (бан-чек + _ec_my_fid() + вызов ядра). Логика правил
--    одна на всех — боты физически не могут ходить «мимо правил».
--    Новый _bt_bot_turn — это ИИ поверх тех же RPC: тратит активации
--    (_bt_acts), уважает скорость и занятые гексы, обходит астероиды и
--    туманность, стреляет только по ЗАХВАЧЕННЫМ целям с чистой линией огня,
--    урон считает залповый (группы, тиры, ПРО, стойкости), чинит своих
--    нано-роем и поднимает авиакрылья.
--
-- ПОРЯДОК: после _admin_bot_battle.sql и _bot_roster_faction.sql. Идемпотентно.
-- Тела ядра взяты ЖИВЫЕ из базы (pg_get_functiondef), правки — только замена
-- актора: `me := public._ec_my_fid()` → `me := p_fid`.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. ИМЯ СТОРОНЫ БОТОВ ─────────────────────────────────────────────
create or replace function public._bt_bot_name() returns text
language sql immutable as $fn$ select 'Пустотные рейдеры' $fn$;

create or replace function public._war_nm(p_fid text) returns text
language sql stable security definer set search_path=public as $fn$
  select case when p_fid = public._bt_bot_fid() then public._bt_bot_name()
              else coalesce(nullif(public._fac_name(p_fid), ''), 'Одна из держав') end;
$fn$;

-- ── 2. ЯДРО: ХОД (тело battle_move, актор — параметром) ──────────────
create or replace function public._bt_do_move(p_battle uuid, p_unit uuid, p_path jsonb, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b public.battles; u record; e jsonb;
        cx int; cy int; nx int; ny int; f int;
        maxs int; terr text; i int; total int;
begin
  perform public._bt_arm(p_battle);
  me := p_fid;
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if u.cls = 'ss13' or u.speed <= 0 then raise exception 'станция неподвижна — она не двигается на поле боя'; end if;
  if u.moved then raise exception 'этот корабль уже ходил в этом ходу'; end if;
  total := coalesce(jsonb_array_length(p_path), 0);
  if total < 1 then raise exception 'пустой маршрут'; end if;

  maxs := u.speed;
  if public._bt_terra(b.terrain, u.x, u.y) = 'deb' then maxs := greatest(1, maxs - 1); end if;
  if total > maxs then
    raise exception '«%» проходит % гексов за ход (обломки замедляют), а маршрут — %', u.unit_name, maxs, total;
  end if;

  cx := u.x; cy := u.y; f := u.facing;
  i := 0;
  for e in select value from jsonb_array_elements(p_path) loop
    i := i + 1;
    nx := coalesce((e->>'x')::int, -1); ny := coalesce((e->>'y')::int, -1);
    if nx < 0 or nx >= public._bt_w() or ny < 0 or ny >= public._bt_h() then
      raise exception 'маршрут выходит за доску';
    end if;
    if public._bt_dist(cx, cy, nx, ny) <> 1 then raise exception 'маршрут разорван — шаг только в соседний гекс'; end if;
    if exists(select 1 from public.battle_units
               where battle_id = p_battle and alive and x = nx and y = ny) then
      raise exception 'гекс %:% занят — сквозь корабли не летают', nx, ny;
    end if;
    f := public._bt_dirof(cx, cy, nx, ny);   -- только разворот спрайта
    cx := nx; cy := ny;
  end loop;

  perform public._bt_use_act(p_battle, p_unit);
  terr := public._bt_terra(b.terrain, cx, cy);
  update public.battle_units
     set x = cx, y = cy, facing = f, straight = 99, moved = true,
         shield = case when terr = 'neb' then 0 else shield end
   where id = p_unit;
  if terr = 'neb' then
    perform public._bt_log(p_battle, format('%s входит в туманность — защитное поле схлопывается', u.unit_name));
  end if;
  return jsonb_build_object('ok', true, 'facing', f);
end$fn$;
revoke all on function public._bt_do_move(uuid,uuid,jsonb,text) from public;

create or replace function public.battle_move(p_battle uuid, p_unit uuid, p_path jsonb)
returns jsonb language plpgsql security definer set search_path=public as $fn$
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  return public._bt_do_move(p_battle, p_unit, p_path, public._ec_my_fid());
end$fn$;
revoke all on function public.battle_move(uuid,uuid,jsonb) from public;
grant execute on function public.battle_move(uuid,uuid,jsonb) to authenticated;

-- ── 3. ЯДРО: ЗАЛП / РЕМОНТ (тело battle_fire) ────────────────────────
create or replace function public._bt_do_fire(p_battle uuid, p_unit uuid, p_target uuid, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b public.battles; u record; t record; dist int;
        wg jsonb; dmgfac numeric := 1;
        absorbed numeric; hull numeric; killed boolean := false;
        band_ok boolean := false;
        rk numeric; resisted numeric := 0;
        rsh numeric; shcap numeric; sh_hard numeric := 0.30; shabs numeric := 0;
        grp_shots int; per_shot numeric; gdmg numeric; absb numeric;
        total_dmg numeric := 0; hull_leak numeric := 0; i int;
        ally boolean; heal_sum numeric := 0; healed numeric := 0;
begin
  perform public._bt_arm(p_battle);
  me := p_fid;
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if u.fired then raise exception 'этот корабль уже стрелял в этом ходу'; end if;
  select * into t from public.battle_units where id = p_target and battle_id = p_battle for update;
  if t.id is null or not t.alive then raise exception 'цели нет'; end if;

  ally := (t.side = u.side);
  dist := public._bt_dist(u.x, u.y, t.x, t.y);

  -- ══ РЕМОНТ СОЮЗНИКА (нано-рой) ═════════════════════════════
  if ally then
    if t.id = u.id then
      raise exception 'нано-рой чинит только ДРУГОЙ корабль — себя им не залатать';
    end if;
    if not exists(select 1 from jsonb_array_elements(coalesce(u.wpn,'[]'::jsonb)) g
                   where g->>'k' = 'repair') then
      raise exception 'по своим не стреляем: на «%» нет ремонтных нано-роёв', u.unit_name;
    end if;
    if not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
      raise exception 'путь рою перекрыт астероидами';
    end if;
    for wg in select value from jsonb_array_elements(coalesce(u.wpn,'[]'::jsonb)) loop
      if wg->>'k' = 'repair' and dist >= 1 and dist <= (wg->>'rng')::int then
        band_ok := true;
        heal_sum := heal_sum + (wg->>'dmg')::numeric;
      end if;
    end loop;
    if not band_ok then
      raise exception 'дистанция % — дальше, чем добрасывает ремонтный рой «%». Сблизьтесь', dist, u.unit_name;
    end if;
    if public._bt_terra(b.terrain, t.x, t.y) = 'neb' then heal_sum := heal_sum * 0.7; end if;
    healed := least(round(heal_sum), greatest(0, t.max_hp - t.hp));
    if healed <= 0 then raise exception '«%» и так цел — ремонтировать нечего', t.unit_name; end if;

    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units set hp = least(max_hp, hp + healed) where id = p_target;
    update public.battle_units set fired = true, flash = true where id = p_unit;
    perform public._bt_log(p_battle, format('%s ⟳ %s: нано-рой восстановил %s корпуса',
      u.unit_name, t.unit_name, round(healed)));
    return jsonb_build_object('ok', true, 'healed', round(healed), 'hull', 0,
                              'shield_absorbed', 0, 'resisted', 0, 'killed', false);
  end if;

  -- ══ ОБЫЧНЫЙ ЗАЛП ═══════════════════════════════════════════
  if not exists(select 1 from public.battle_units m
                 where m.battle_id = p_battle and m.side = u.side and m.alive
                   and public._bt_detected(m.x, m.y, m.facing,
                                           greatest(0, m.sensor - greatest(0, public._bt_ecm(p_battle, m.side, m.x, m.y) - m.eccm)),
                                           t.x, t.y, t.stealth, t.flash)) then
    raise exception 'цель не захвачена: неопознанный контакт. Подведите корабль с радаром ближе (визуал — 3 гекса) или выбейте РЭБ-глушилки врага';
  end if;

  if not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
    raise exception 'линия огня перекрыта астероидами';
  end if;

  rsh := t.shield;
  if public._bt_terra(b.terrain, t.x, t.y) = 'neb' then rsh := 0; dmgfac := 0.7; end if;
  if public._bt_terra(b.terrain, t.x, t.y) = 'deb' then dmgfac := 0.85; end if;
  shcap := greatest(1, t.max_shield * sh_hard);

  for wg in select value from jsonb_array_elements(
      case when u.wpn is null or jsonb_array_length(u.wpn) = 0
           then jsonb_build_array(jsonb_build_object('rng',u.rng,'dmg',u.dmg))
           else u.wpn end) loop
    if coalesce(wg->>'k','kinetic') <> 'repair'
       and dist >= 1 and dist <= (wg->>'rng')::int then
      band_ok := true;
      rk := least(0.9, greatest(-0.75, coalesce(
              (t.resist->>coalesce(wg->>'k','kinetic'))::numeric, 0)));
      if coalesce(wg->>'k','kinetic') = 'missile' and coalesce(t.pd,0) > 0 then
        rk := 1 - (1 - rk) * (1 - least(0.6, t.pd));
      end if;
      gdmg := (wg->>'dmg')::numeric * (1 - rk) * dmgfac;
      resisted := resisted + (wg->>'dmg')::numeric * rk * dmgfac;
      grp_shots := greatest(1, least(6, coalesce((wg->>'shots')::int, 1)));
      per_shot := gdmg / grp_shots;
      for i in 1..grp_shots loop
        absb := least(rsh, least(per_shot, shcap));
        rsh := rsh - absb;
        shabs := shabs + absb;
        total_dmg := total_dmg + per_shot;
        hull_leak := hull_leak + (per_shot - absb);
      end loop;
    end if;
  end loop;
  if not band_ok then
    raise exception 'дистанция % — дальше, чем бьют огневые группы «%». Сблизьтесь', dist, u.unit_name;
  end if;

  perform public._bt_use_act(p_battle, p_unit);

  absorbed := shabs;
  hull := greatest(total_dmg * 0.10, hull_leak - t.armor);
  if total_dmg <= 0 then hull := 0; end if;
  update public.battle_units
     set shield = rsh,
         hp = greatest(0, t.hp - hull),
         alive = (t.hp - hull) > 0
   where id = p_target;
  killed := (t.hp - hull) <= 0;
  update public.battle_units set fired = true, flash = true where id = p_unit;

  perform public._bt_log(p_battle, format('%s → %s: %s урона%s%s',
    u.unit_name, t.unit_name, round(absorbed + hull),
    case when resisted >= 1 then format(' (броня рассеяла %s)', round(resisted)) else '' end,
    case when killed then ' — цель уничтожена' else '' end));

  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'shield_absorbed', round(absorbed), 'hull', round(hull),
                            'resisted', round(resisted), 'killed', killed, 'healed', 0);
end$fn$;
revoke all on function public._bt_do_fire(uuid,uuid,uuid,text) from public;

create or replace function public.battle_fire(p_battle uuid, p_unit uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path=public as $fn$
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  return public._bt_do_fire(p_battle, p_unit, p_target, public._ec_my_fid());
end$fn$;
revoke all on function public.battle_fire(uuid,uuid,uuid) from public;
grant execute on function public.battle_fire(uuid,uuid,uuid) to authenticated;

-- ── 4. ЯДРО: ВЗЛЁТ АВИАКРЫЛА (тело battle_launch) ────────────────────
create or replace function public._bt_do_launch(p_battle uuid, p_unit uuid, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b public.battles; u record; d int; st int[]; px int := null; py int;
begin
  me := p_fid;
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if u.is_wing then raise exception 'авиакрыло само авиацию не несёт'; end if;
  if coalesce(u.wings, 0) <= 0 then raise exception 'ангары пусты: авиакрыльев больше нет'; end if;

  for d in 0..5 loop
    st := public._bt_step(u.x, u.y, (u.facing + d) % 6);
    if st[1] >= 0 and st[1] < public._bt_w() and st[2] >= 0 and st[2] < public._bt_h()
       and public._bt_terra(b.terrain, st[1], st[2]) is distinct from 'ast'
       and not exists(select 1 from public.battle_units
                       where battle_id = p_battle and alive and x = st[1] and y = st[2]) then
      px := st[1]; py := st[2]; exit;
    end if;
  end loop;
  if px is null then raise exception 'вокруг авианосца нет свободного гекса для взлёта'; end if;

  perform public._bt_use_act(p_battle, p_unit);
  update public.battle_units set wings = wings - 1 where id = p_unit;

  insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
      hp, max_hp, armor, shield, max_shield, dmg, speed, rng, moved, fired, acted,
      facing, straight, sensor, stealth, wpn, resist, pd, jam, wings, is_wing)
    values (p_battle, me, u.side, u.unit_id, format('Авиакрыло «%s»', u.unit_name), 'wing', px, py,
      60, 60, 0, 0, 0, 45, 9, 2, true, true, true,
      u.facing, 1, 8, 9,
      '[{"s":"any","rng":2,"dmg":45,"k":"kinetic"}]'::jsonb,
      '{"kinetic":0,"energy":0,"missile":0}'::jsonb, 0, 0, 0, true);

  perform public._bt_log(p_battle, format('%s поднимает авиакрыло с палубы', u.unit_name));
  return jsonb_build_object('ok', true, 'wings_left', u.wings - 1);
end$fn$;
revoke all on function public._bt_do_launch(uuid,uuid,text) from public;

create or replace function public.battle_launch(p_battle uuid, p_unit uuid)
returns jsonb language plpgsql security definer set search_path=public as $fn$
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  return public._bt_do_launch(p_battle, p_unit, public._ec_my_fid());
end$fn$;
revoke all on function public.battle_launch(uuid,uuid) from public;
grant execute on function public.battle_launch(uuid,uuid) to authenticated;

-- ── 5. ЯДРО: КОНЕЦ ХОДА (тело battle_end_turn) ───────────────────────
create or replace function public._bt_do_end_turn(p_battle uuid, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b public.battles; sd text; nxt text;
begin
  perform public._bt_arm(p_battle);
  me := p_fid;
  b  := public._bt_require_turn(p_battle, me);
  sd := b.side_to_move;

  if sd = 'attacker' then
    update public.battles set att_turns_left = greatest(0, att_turns_left - 1) where id = p_battle;
  else
    update public.battles set def_turns_left = greatest(0, def_turns_left - 1) where id = p_battle;
  end if;

  perform public._bt_env_end(p_battle, sd);

  nxt := case when sd = 'attacker' then 'defender' else 'attacker' end;
  update public.battle_units set moved = false, fired = false, acted = false, flash = false
   where battle_id = p_battle and side = nxt;
  update public.battles
     set side_to_move = nxt, turn_no = turn_no + 1, acts_left = public._bt_acts(),
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;

  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true);
end$fn$;
revoke all on function public._bt_do_end_turn(uuid,text) from public;

create or replace function public.battle_end_turn(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $fn$
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  return public._bt_do_end_turn(p_battle, public._ec_my_fid());
end$fn$;
revoke all on function public.battle_end_turn(uuid) from public;
grant execute on function public.battle_end_turn(uuid) to authenticated;

-- ── 6. ИИ: ВЫБОР ЦЕЛИ ────────────────────────────────────────────────
-- Ровно те же условия, что проверит _bt_do_fire: дистанция в полосе хотя бы
-- одной огневой группы, чистая линия огня, цель ЗАХВАЧЕНА чьим-то радаром.
-- Приоритет: кого добьём этим залпом → кто слабее → кто ближе.
create or replace function public._bt_bot_target(p_battle uuid, p_unit uuid)
returns uuid language plpgsql stable security definer set search_path=public as $fn$
declare u record; b record; maxr int; res uuid;
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null or not u.alive or u.fired then return null; end if;
  select * into b from public.battles where id = p_battle;

  select max((g->>'rng')::int) into maxr
    from jsonb_array_elements(
      case when u.wpn is null or jsonb_array_length(u.wpn) = 0
           then jsonb_build_array(jsonb_build_object('rng',u.rng,'dmg',u.dmg))
           else u.wpn end) g
   where coalesce(g->>'k','kinetic') <> 'repair'
     and coalesce((g->>'dmg')::numeric, 0) > 0;
  if coalesce(maxr, 0) < 1 then return null; end if;

  select t.id into res from public.battle_units t
   where t.battle_id = p_battle and t.alive and t.side <> u.side
     and public._bt_dist(u.x, u.y, t.x, t.y) between 1 and maxr
     and public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y)
     and exists(select 1 from public.battle_units m
                 where m.battle_id = p_battle and m.side = u.side and m.alive
                   and public._bt_detected(m.x, m.y, m.facing,
                         greatest(0, m.sensor - greatest(0, public._bt_ecm(p_battle, m.side, m.x, m.y) - m.eccm)),
                         t.x, t.y, t.stealth, t.flash))
   order by ((t.hp + t.shield) <= coalesce(u.dmg, 0)) desc,
            (t.hp + t.shield) asc,
            public._bt_dist(u.x, u.y, t.x, t.y) asc, t.id
   limit 1;
  return res;
end$fn$;
revoke all on function public._bt_bot_target(uuid,uuid) from public;

-- Кого чинить нано-роем: самый побитый союзник в полосе роя.
create or replace function public._bt_bot_repair(p_battle uuid, p_unit uuid)
returns uuid language plpgsql stable security definer set search_path=public as $fn$
declare u record; b record; rr int; res uuid;
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null or not u.alive or u.fired then return null; end if;
  select max((g->>'rng')::int) into rr
    from jsonb_array_elements(coalesce(u.wpn,'[]'::jsonb)) g where g->>'k' = 'repair';
  if coalesce(rr, 0) < 1 then return null; end if;
  select * into b from public.battles where id = p_battle;

  select t.id into res from public.battle_units t
   where t.battle_id = p_battle and t.alive and t.side = u.side and t.id <> u.id
     and t.hp < t.max_hp
     and public._bt_dist(u.x, u.y, t.x, t.y) between 1 and rr
     and public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y)
   order by (t.max_hp - t.hp) desc, t.id
   limit 1;
  return res;
end$fn$;
revoke all on function public._bt_bot_repair(uuid,uuid) from public;

-- ── 7. ИИ: МАРШРУТ ───────────────────────────────────────────────────
-- Тот же формат пути, что шлёт клиент игрока: массив соседних гексов, длина
-- не больше скорости (обломки под килем — минус гекс). Занятые гексы обходим,
-- астероиды и туманность выбираем в последнюю очередь: первый бьёт по корпусу
-- в конце хода, вторая схлопывает щит.
create or replace function public._bt_bot_path(p_battle uuid, p_unit uuid,
                                               p_tx int, p_ty int, p_goal int)
returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare u record; b record; maxs int; path jsonb := '[]'::jsonb;
        cx int; cy int; d int; cand int; nb int[]; nx int; ny int;
        bx int; byy int; bpen int; pen int; tt text; step int; curd int;
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null or not u.alive or u.moved or coalesce(u.speed,0) <= 0
     or u.cls = 'ss13' then return path; end if;
  select * into b from public.battles where id = p_battle;

  maxs := u.speed;
  if public._bt_terra(b.terrain, u.x, u.y) = 'deb' then maxs := greatest(1, maxs - 1); end if;
  cx := u.x; cy := u.y;

  for step in 1..maxs loop
    curd := public._bt_dist(cx, cy, p_tx, p_ty);
    exit when curd <= greatest(1, p_goal);
    d := public._bt_dirof(cx, cy, p_tx, p_ty);
    bx := null; bpen := 99;
    foreach cand in array array[d, (d + 1) % 6, (d + 5) % 6] loop
      nb := public._bt_step(cx, cy, cand);
      nx := nb[1]; ny := nb[2];
      if nx < 0 or nx >= public._bt_w() or ny < 0 or ny >= public._bt_h() then continue; end if;
      if public._bt_dist(nx, ny, p_tx, p_ty) >= curd then continue; end if;   -- не приближает
      if exists(select 1 from public.battle_units
                 where battle_id = p_battle and alive and x = nx and y = ny) then continue; end if;
      if exists(select 1 from jsonb_array_elements(path) e
                 where (e->>'x')::int = nx and (e->>'y')::int = ny) then continue; end if;
      tt := public._bt_terra(b.terrain, nx, ny);
      pen := case when tt = 'ast' then 2 when tt = 'neb' then 1 else 0 end;
      if pen < bpen then bpen := pen; bx := nx; byy := ny; end if;
    end loop;
    exit when bx is null;                      -- шагнуть некуда
    path := path || jsonb_build_array(jsonb_build_object('x', bx, 'y', byy));
    cx := bx; cy := byy;
  end loop;
  return path;
end$fn$;
revoke all on function public._bt_bot_path(uuid,uuid,int,int,int) from public;

-- ── 8. ХОД БОТОВ: те же RPC, что у игрока ────────────────────────────
-- Активаций за ход — ровно _bt_acts(), как у живой стороны. Порядок: сначала
-- те, кто может ударить или починить своих прямо сейчас (не тратим сближение
-- впустую), затем самые близкие к врагу — они идут на сближение и стреляют
-- уже после манёвра (движение и залп одного корабля — одна активация).
create or replace function public._bt_bot_turn(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare bot text := public._bt_bot_fid(); botside text;
        b record; u record; pick uuid; tgt uuid; path jsonb;
        skip uuid[] := '{}'; guard int := 0; did boolean;
        st text; acts int; maxr int; goal int; exid uuid; seen boolean;
        tx int; ty int;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status <> 'active' then return; end if;
  perform public._bt_arm(p_battle);
  botside := b.side_to_move;
  -- прогоняем ТОЛЬКО если сейчас ход стороны-бота
  if (botside = 'attacker' and b.attacker_fid <> bot)
     or (botside = 'defender' and b.defender_fid <> bot) then
    return;
  end if;

  loop
    guard := guard + 1;
    exit when guard > 200;                       -- страховка от вечного цикла
    select status, acts_left into st, acts from public.battles where id = p_battle;
    exit when st <> 'active' or coalesce(acts, 0) <= 0;

    -- ── кого активируем: сперва тот, кто уже может бить/чинить ──
    pick := null;
    for exid in select bu.id from public.battle_units bu
                 where bu.battle_id = p_battle and bu.side = botside and bu.alive
                   and not bu.acted and not (bu.id = any(skip))
                 order by bu.id loop
      if public._bt_bot_target(p_battle, exid) is not null
         or public._bt_bot_repair(p_battle, exid) is not null then
        pick := exid; exit;
      end if;
    end loop;
    -- иначе — ближайший к врагу из тех, кто ещё может двигаться
    if pick is null then
      select bu.id into pick from public.battle_units bu
        where bu.battle_id = p_battle and bu.side = botside and bu.alive
          and not bu.acted and not (bu.id = any(skip))
          and not bu.moved and coalesce(bu.speed,0) > 0 and bu.cls is distinct from 'ss13'
        order by coalesce((select min(public._bt_dist(bu.x, bu.y, t.x, t.y))
                             from public.battle_units t
                            where t.battle_id = p_battle and t.alive and t.side <> botside), 999),
                 bu.id
        limit 1;
    end if;
    exit when pick is null;                      -- действовать больше некому

    select * into u from public.battle_units where id = pick;
    did := false;

    -- ── авиакрылья: поднимаем, когда враг уже недалеко ──
    if coalesce(u.wings,0) > 0 and not u.is_wing then
      select exists(select 1 from public.battle_units t
                     where t.battle_id = p_battle and t.alive and t.side <> botside
                       and public._bt_dist(u.x, u.y, t.x, t.y) <= 10) into seen;
      if seen then
        begin perform public._bt_do_launch(p_battle, u.id, bot); did := true;
        exception when others then null; end;
      end if;
    end if;

    -- ── ремонтник латает своих раньше, чем стреляет ──
    tgt := public._bt_bot_repair(p_battle, u.id);
    if tgt is not null then
      begin perform public._bt_do_fire(p_battle, u.id, tgt, bot); did := true;
      exception when others then null; end;
    else
      tgt := public._bt_bot_target(p_battle, u.id);

      -- цели в полосе нет — идём на сближение
      if tgt is null and not u.moved and coalesce(u.speed,0) > 0 and u.cls is distinct from 'ss13' then
        select max((g->>'rng')::int) into maxr
          from jsonb_array_elements(
            case when u.wpn is null or jsonb_array_length(u.wpn) = 0
                 then jsonb_build_array(jsonb_build_object('rng',u.rng,'dmg',u.dmg))
                 else u.wpn end) g
         where coalesce(g->>'k','kinetic') <> 'repair'
           and coalesce((g->>'dmg')::numeric, 0) > 0;
        -- если враг уже захвачен радаром — довольно выйти на дальность залпа;
        -- если нет — подходим на визуальный контакт (3 гекса), иначе стрелять не по кому
        select exists(select 1 from public.battle_units t
                       where t.battle_id = p_battle and t.alive and t.side <> botside
                         and exists(select 1 from public.battle_units m
                                     where m.battle_id = p_battle and m.side = botside and m.alive
                                       and public._bt_detected(m.x, m.y, m.facing,
                                             greatest(0, m.sensor - greatest(0, public._bt_ecm(p_battle, m.side, m.x, m.y) - m.eccm)),
                                             t.x, t.y, t.stealth, t.flash))) into seen;
        goal := case when seen then greatest(1, coalesce(maxr, u.rng, 3)) else 3 end;

        tx := null; ty := null;
        select t.x, t.y into tx, ty from public.battle_units t
          where t.battle_id = p_battle and t.alive and t.side <> botside
          order by public._bt_dist(u.x, u.y, t.x, t.y), t.id limit 1;
        if tx is not null then
          path := public._bt_bot_path(p_battle, u.id, tx, ty, goal);
          if coalesce(jsonb_array_length(path), 0) > 0 then
            begin perform public._bt_do_move(p_battle, u.id, path, bot); did := true;
            exception when others then null; end;
          end if;
        end if;
        tgt := public._bt_bot_target(p_battle, u.id);   -- после манёвра цель могла войти в полосу
      end if;

      if tgt is not null then
        begin perform public._bt_do_fire(p_battle, u.id, tgt, bot); did := true;
        exception when others then null; end;
      end if;
    end if;

    -- корабль ничего не смог: больше его в этом ходу не трогаем
    if not did then skip := skip || pick; end if;
  end loop;

  -- передать ход игроку — тем же ядром, что и у живой стороны
  select status into st from public.battles where id = p_battle;
  if st = 'active' then
    begin perform public._bt_do_end_turn(p_battle, bot); exception when others then null; end;
  end if;
end$fn$;
revoke all on function public._bt_bot_turn(uuid) from public;

notify pgrst, 'reload schema';

-- Проверка:
--   select public._war_nm('bot');            → «Пустотные рейдеры»
--   select public.admin_bot_turn('<battle>'); → в журнале обычные строки залпов
