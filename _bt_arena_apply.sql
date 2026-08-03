-- ════════════════════════════════════════════════════════════════════════
-- АРЕНА-ФОРМА: подключение к боевым RPC
-- ────────────────────────────────────────────────────────────────────────
-- Катать СТРОГО после _bt_arena_shape.sql (здесь используются _bt_in_arena,
-- _bt_in_spawn, _bt_ensure_field).
--
-- Что меняется:
--   battle_deploy    — вместо «Z левых/правых колонок» проверка сектора подхода
--   battle_reinforce — подкрепление входит в свой сектор, а не с края доски
--   _bt_do_move      — нельзя уйти в пустоту вне арены
--   _bt_bot_path     — бот не пытается шагать в пустоту
--   battle_state     — отдаёт клиенту shape и spawn
--   admin_bot_battle — боты встают в свой сектор, а не колонками у края
-- ════════════════════════════════════════════════════════════════════════

-- Ближайшая свободная клетка сектора подхода стороны (для подкреплений и ботов)
create or replace function public._bt_spawn_free(p_battle uuid, sd text)
returns int[] language plpgsql stable security definer set search_path=public as $$
declare sh jsonb; sp jsonb; ax int; ay int; r int; w int; h int; out_xy int[];
begin
  perform public._bt_arm(p_battle);
  w := public._bt_w(); h := public._bt_h();
  select b.shape, b.spawn into sh, sp from public.battles b where b.id = p_battle;
  if sp is null then return null; end if;
  ax := (sp->sd->>'x')::int; ay := (sp->sd->>'y')::int; r := (sp->sd->>'r')::int;

  select array[gx, gy] into out_xy
    from generate_series(greatest(0, ax - r), least(w - 1, ax + r)) gx,
         generate_series(greatest(0, ay - r - 1), least(h - 1, ay + r + 1)) gy
   where public._bt_dist(ax, ay, gx, gy) <= r
     and public._bt_in_arena(sh, gx, gy)
     and not exists(select 1 from public.battle_units bu
                     where bu.battle_id = p_battle and bu.alive and bu.x = gx and bu.y = gy)
   order by public._bt_dist(ax, ay, gx, gy), gx, gy
   limit 1;
  return out_xy;
end$$;
grant execute on function public._bt_spawn_free(uuid, text) to authenticated;

-- Курс борта при высадке: носом на сектор противника.
-- sd принимает и 'attacker'/'defender', и короткие ключи спавна 'att'/'def'.
create or replace function public._bt_spawn_facing(sp jsonb, sd text)
returns int language sql immutable as $$
  with k as (select case when sd in ('attacker','att') then 'att' else 'def' end as mine,
                    case when sd in ('attacker','att') then 'def' else 'att' end as foe)
  select case when sp is null then (case when sd in ('attacker','att') then 0 else 3 end)
         else public._bt_dirof(
                (sp->k.mine->>'x')::int, (sp->k.mine->>'y')::int,
                (sp->k.foe ->>'x')::int, (sp->k.foe ->>'y')::int)
         end
    from k;
$$;

-- ── РАССТАНОВКА ─────────────────────────────────────────────────────────
create or replace function public.battle_deploy(p_battle uuid, p_units jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; sd text; b record; e jsonb; uid uuid; st jsonb;
        cnt int; free int; used int; px int; py int; n int := 0;
        fc int; is_full boolean; sk text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_ensure_field(p_battle);   -- форма, сектора и ландшафт готовы
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle for update;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.status <> 'forming' then raise exception 'состав уже утверждён — бой идёт'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;
  if (sd = 'attacker' and b.att_ready) or (sd = 'defender' and b.def_ready) then
    raise exception 'вы уже подтвердили состав';
  end if;
  is_full := public._bt_admin_full(p_battle);   -- админский полный каталог
  sk := case when sd = 'attacker' then 'att' else 'def' end;
  fc := public._bt_spawn_facing(b.spawn, sd);   -- курс: на сектор врага

  delete from public.battle_units where battle_id = p_battle and fid = me;

  for e in select value from jsonb_array_elements(coalesce(p_units,'[]'::jsonb)) loop
    uid := nullif(e->>'unit_id','')::uuid;
    px  := coalesce((e->>'x')::int, -1);
    py  := coalesce((e->>'y')::int, -1);
    if uid is null then continue; end if;
    if px < 0 or px >= public._bt_w() or py < 0 or py >= public._bt_h() then
      raise exception 'гекс вне доски';
    end if;
    if not public._bt_in_arena(b.shape, px, py) then
      raise exception 'гекс %:% вне арены — там пустота', px, py;
    end if;
    if not coalesce(public._bt_in_spawn(b.spawn, sk, px, py), true) then
      raise exception 'гекс %:% вне вашего сектора подхода — флот входит в бой оттуда, откуда пришёл', px, py;
    end if;

    -- проверку «есть ли в резерве» пропускаем при админском полном каталоге
    if not is_full then
      select coalesce(sum(greatest(0, coalesce((c->>'qty')::int,0))), 0) into free
        from public.battle_fleets bf
        join public.fleets f on f.id = bf.fleet_id
        cross join lateral jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
       where bf.battle_id = p_battle and bf.fid = me and (c->>'unit_id')::uuid = uid;
      select count(*) into used from public.battle_units
        where battle_id = p_battle and fid = me and unit_id = uid;
      if used >= free then raise exception 'таких кораблей в бою больше нет: «%»', coalesce(e->>'unit_name','проект'); end if;
    end if;

    if exists(select 1 from public.battle_units
               where battle_id = p_battle and alive and x = px and y = py) then
      raise exception 'гекс %:% уже занят — на одном гексе один корабль', px, py;
    end if;

    st := public._bt_stats(uid);
    if st is null then raise exception 'проект корабля не найден'; end if;

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil, ftl)
      values (p_battle, me, sd, uid, st->>'name', st->>'cls', px, py,
        (st->>'hp')::numeric, (st->>'hp')::numeric, (st->>'armor')::numeric,
        (st->>'shield')::numeric, (st->>'shield')::numeric, (st->>'dmg')::numeric,
        (st->>'speed')::int, (st->>'rng')::int,
        fc, public._bt_turnneed(st->>'cls'), (st->>'sensor')::int, (st->>'stealth')::int,
        st->'wpn', st->'resist',
        coalesce((st->>'pd')::numeric,0), coalesce((st->>'jam')::int,0), coalesce((st->>'wings')::int,0),
        coalesce((st->>'dejam')::int,0), coalesce((st->>'eccm')::int,0),
        coalesce((st->>'interdict')::bool,false), coalesce((st->>'stabil')::bool,false),
        coalesce((st->>'ftl')::bool,false));
    n := n + 1;
    if n > public._bt_cap() then raise exception 'в бой можно вывести не больше % кораблей', public._bt_cap(); end if;
  end loop;

  select count(*) into cnt from public.battle_units where battle_id = p_battle and fid = me;
  return jsonb_build_object('ok', true, 'deployed', cnt);
end$$;
revoke all on function public.battle_deploy(uuid, jsonb) from public;
grant execute on function public.battle_deploy(uuid, jsonb) to authenticated;

-- ── ДВИЖЕНИЕ: пустота вне арены непроходима ─────────────────────────────
create or replace function public._bt_do_move(p_battle uuid, p_unit uuid, p_path jsonb, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
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
    if not public._bt_in_arena(b.shape, nx, ny) then
      raise exception 'маршрут уходит в пустоту за кромкой арены';
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
end$$;
revoke all on function public._bt_do_move(uuid, uuid, jsonb, text) from public;

-- ── БОТ: маршрут в обход пустоты ────────────────────────────────────────
create or replace function public._bt_bot_path(p_battle uuid, p_unit uuid, p_tx integer, p_ty integer, p_goal integer)
returns jsonb language plpgsql stable security definer set search_path=public as $$
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
    -- шире веер направлений: у рваной арены прямой курс часто упирается в пустоту
    foreach cand in array array[d, (d + 1) % 6, (d + 5) % 6, (d + 2) % 6, (d + 4) % 6] loop
      nb := public._bt_step(cx, cy, cand);
      nx := nb[1]; ny := nb[2];
      if nx < 0 or nx >= public._bt_w() or ny < 0 or ny >= public._bt_h() then continue; end if;
      if not public._bt_in_arena(b.shape, nx, ny) then continue; end if;   -- пустота
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
end$$;
revoke all on function public._bt_bot_path(uuid, uuid, integer, integer, integer) from public;

-- ── ПОДКРЕПЛЕНИЕ: входит в свой сектор подхода ──────────────────────────
create or replace function public.battle_reinforce(p_battle uuid, p_unit_id uuid, p_y integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; sd text; st jsonb; free int; used int;
        px int; py int; cnt int; fc int; is_full boolean; xy int[];
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_ensure_field(p_battle);
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  sd := public._bt_side(p_battle, me);
  is_full := public._bt_admin_full(p_battle);   -- админский спавн из полного каталога

  st := public._bt_stats(p_unit_id);
  if st is null then raise exception 'проект корабля не найден'; end if;

  if public._bt_interdicted(p_battle, sd)
     and not coalesce((st->>'ftl')::bool, false) then
    raise exception 'подкрепление заблокировано полем интердикции: у врага работает FTL-заградитель. Уничтожьте его носителя, выведите корабль со стабилизационным полем «Альтаан» или вызовите корабль с собственным FTL-гипердвигателем';
  end if;

  if not is_full and b.acts_left < public._bt_acts() then
    raise exception 'подкрепление вызывается только свежим ходом: оно стоит всех % активаций. Сейчас часть хода уже потрачена', public._bt_acts();
  end if;

  select count(*) into cnt from public.battle_units where battle_id = p_battle and fid = me and alive;
  if cnt >= public._bt_cap() then raise exception 'на доске уже % кораблей', public._bt_cap(); end if;

  if not is_full then
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
  end if;

  fc := public._bt_spawn_facing(b.spawn, sd);

  -- подкрепление приходит тем же вектором, что и весь флот: в свой сектор
  xy := public._bt_spawn_free(p_battle, case when sd = 'attacker' then 'att' else 'def' end);
  if xy is null then
    -- легаси-бой без секторов: прежнее поведение — край доски
    px := case when sd = 'attacker' then 0 else public._bt_w() - 1 end;
    py := greatest(0, least(public._bt_h() - 1, coalesce(p_y, public._bt_h() / 2)));
    select g into py from generate_series(0, public._bt_h()-1) g
      where not exists(select 1 from public.battle_units
                        where battle_id=p_battle and alive and x=px and y=g)
      order by abs(g - py), g
      limit 1;
    if py is null then raise exception 'некуда вывести подкрепление — край доски занят'; end if;
  else
    px := xy[1]; py := xy[2];
  end if;

  insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
      hp, max_hp, armor, shield, max_shield, dmg, speed, rng, moved, fired, acted,
      facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
      dejam, eccm, interdict, stabil, ftl)
    values (p_battle, me, sd, p_unit_id, st->>'name', st->>'cls', px, py,
      (st->>'hp')::numeric, (st->>'hp')::numeric, (st->>'armor')::numeric,
      (st->>'shield')::numeric, (st->>'shield')::numeric, (st->>'dmg')::numeric,
      (st->>'speed')::int, (st->>'rng')::int, not is_full, not is_full, not is_full,
      fc, public._bt_turnneed(st->>'cls'), (st->>'sensor')::int, (st->>'stealth')::int,
      st->'wpn', st->'resist',
      coalesce((st->>'pd')::numeric,0), coalesce((st->>'jam')::int,0), coalesce((st->>'wings')::int,0),
      coalesce((st->>'dejam')::int,0), coalesce((st->>'eccm')::int,0),
      coalesce((st->>'interdict')::bool,false), coalesce((st->>'stabil')::bool,false),
      coalesce((st->>'ftl')::bool,false));

  perform public._bt_log(p_battle, format('%s вызывает подкрепление: %s', public._war_nm(me), st->>'name'));
  if not is_full then
    perform public.battle_end_turn(p_battle);
  end if;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.battle_reinforce(uuid, uuid, integer) from public;
grant execute on function public.battle_reinforce(uuid, uuid, integer) to authenticated;

-- ── СОСТОЯНИЕ: клиенту нужны форма и сектора ────────────────────────────
create or replace function public.battle_state(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b record; sd text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;

  -- форма → сектора → ландшафт: генерится лениво один раз, сид = id боя
  perform public._bt_ensure_field(p_battle);
  select * into b from public.battles where id = p_battle;

  return jsonb_build_object(
    'id', b.id, 'status', b.status, 'kind', b.kind,
    'system_id', b.system_id,
    'system_name', (select coalesce(nullif(ms.name,''), ms.id) from public.map_systems ms where ms.id = b.system_id),
    'w', public._bt_w(), 'h', public._bt_h(), 'cap', public._bt_cap(),
    'duel_budget', b.duel_budget,
    'zone', public._bt_zone(), 'acts_max', public._bt_acts(), 'acts_left', b.acts_left,
    'shape', b.shape, 'spawn', b.spawn,
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
    'interdicted', public._bt_interdicted(p_battle, sd),
    'log', b.log,
    'terrain', coalesce(b.terrain, '[]'::jsonb),
    'pool', public.battle_pool(p_battle, me),
    'units', (select coalesce(jsonb_agg(
        case when u.side = sd or lk.locked then
          jsonb_build_object(
            'id', u.id, 'side', u.side, 'mine', (u.fid = me),
            'fid', u.fid, 'fname', public._war_nm(u.fid),
            'name', u.unit_name, 'cls', u.cls,
            'x', u.x, 'y', u.y, 'facing', u.facing, 'straight', u.straight,
            'hp', round(u.hp), 'max_hp', round(u.max_hp),
            'shield', round(u.shield), 'max_shield', round(u.max_shield),
            'armor', round(u.armor), 'dmg', round(u.dmg),
            'speed', u.speed, 'rng', u.rng,
            'sensor', u.sensor, 'stealth', u.stealth, 'flash', u.flash,
            'pd', u.pd, 'jam', u.jam, 'wings', u.wings, 'is_wing', u.is_wing,
            'dejam', u.dejam, 'eccm', u.eccm, 'interdict', u.interdict, 'stabil', u.stabil,
            'ftl', u.ftl,
            'locked', true,
            'wpn', case when u.side = sd then coalesce(u.wpn, '[]'::jsonb) else null end,
            'resist', u.resist,
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
             and public._bt_detected(m.x, m.y, m.facing,
                                     greatest(0, m.sensor - greatest(0, public._bt_ecm(p_battle, m.side, m.x, m.y) - m.eccm)),
                                     u.x, u.y, u.stealth, u.flash)) as locked) lk
      where u.battle_id = p_battle and u.alive));
end$$;
revoke all on function public.battle_state(uuid) from public;
grant execute on function public.battle_state(uuid) to authenticated;
