-- ═══════════════════════════════════════════════════════════════════
-- 🤖 АДМИНСКИЙ ТЕСТОВЫЙ БОЙ С БОТАМИ  (ты против ботов)
--
-- Обычный бой 60×80 ([[battle-arena-size]]): ты — нападающий (реальный fid),
-- боты — сторона-защитник с синтетическим fid 'bot'. Боты не ходят через
-- клиентские RPC (у них нет auth) — их ход прогоняет админ кнопкой:
-- каждый бот-корабль едет к ближайшему врагу и стреляет, если тот в дальности.
--
-- ПОРЯДОК: применять ПОСЛЕ _battle_arena_size.sql → _war_battle_tactics.sql
--          → _fight_club.sql. Идемпотентно.
-- ═══════════════════════════════════════════════════════════════════

-- fid стороны-ботов (без FK на фракции — battle_units.fid просто text)
create or replace function public._bt_bot_fid() returns text language sql immutable as $$ select 'bot' $$;

-- текущий бот-бой (одна строка — как fc_test_duel)
create table if not exists public.admin_bot_duel (
  one        int primary key default 1 check (one = 1),
  battle_id  uuid references public.battles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.admin_bot_duel enable row level security;

-- ── СПАВН боя с ботами ───────────────────────────────────────────────
-- p_my_ship / p_bot_ship — проекты кораблей (faction_units.id); null → случайный
-- живой проект. p_n — бортов на сторону (1..12).
create or replace function public.admin_bot_battle(p_my_ship uuid default null,
                                                   p_bot_ship uuid default null,
                                                   p_n int default 3)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; bot text := public._bt_bot_fid();
        sys text; bid uuid; old uuid;
        sm jsonb; sb jsonb; i int; n int := least(12, greatest(1, coalesce(p_n,3)));
        w int := public._bt_wbig(); h int := public._bt_hbig(); yy int;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  me := public._ec_my_fid();
  if me is null then raise exception 'нет фракции у текущего пользователя'; end if;
  if me = bot then raise exception 'fid игрока совпал с fid бота — поменяйте _bt_bot_fid()'; end if;

  -- снести прошлый бот-бой целиком
  select battle_id into old from public.admin_bot_duel where one = 1;
  if old is not null then delete from public.battles where id = old; end if;

  -- корабли: заданные или случайные живые проекты
  if p_my_ship is null then
    select id into p_my_ship from public.faction_units
     where category='ship' and coalesce((summary->>'hp')::numeric,0) > 0
     order by random() limit 1;
  end if;
  if p_bot_ship is null then
    select id into p_bot_ship from public.faction_units
     where category='ship' and coalesce((summary->>'hp')::numeric,0) > 0
     order by random() limit 1;
  end if;
  sm := public._bt_stats(p_my_ship);
  sb := public._bt_stats(p_bot_ship);
  if sm is null or sb is null then raise exception 'проект корабля не найден (нужен опубликованный ship с hp>0)'; end if;

  select id into sys from public.map_systems order by random() limit 1;
  if sys is null then raise exception 'нет систем для арены'; end if;

  insert into public.battles(system_id, attacker_fid, defender_fid, status, kind,
                             att_ready, def_ready, side_to_move, turn_no, acts_left,
                             att_turns_left, def_turns_left, deadline_at)
    values (sys, me, bot, 'active', 'meeting', true, true, 'attacker', 1, public._bt_acts(),
            6, 6, now() + (public._bt_turn_hours() || ' hours')::interval)
    returning id into bid;
  perform public._bt_log(bid, '🤖 Тестовый бой с ботами. Ты — нападающий (слева).');

  -- расстановка: ты в красной зоне слева (x=1), боты в бирюзовой справа (x=w-2)
  for i in 1..n loop
    yy := least(h-1, greatest(0, h/2 + (i - 1 - n/2) * 2));
    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil)
      values (bid, me, 'attacker', p_my_ship, sm->>'name', sm->>'cls', 1, yy,
        (sm->>'hp')::numeric, (sm->>'hp')::numeric, (sm->>'armor')::numeric,
        (sm->>'shield')::numeric, (sm->>'shield')::numeric, (sm->>'dmg')::numeric,
        (sm->>'speed')::int, (sm->>'rng')::int,
        0, public._bt_turnneed(sm->>'cls'),
        coalesce((sm->>'sensor')::int,0), coalesce((sm->>'stealth')::int,0),
        coalesce(sm->'wpn','[]'::jsonb), coalesce(sm->'resist','{}'::jsonb),
        coalesce((sm->>'pd')::numeric,0), coalesce((sm->>'jam')::int,0), coalesce((sm->>'wings')::int,0),
        coalesce((sm->>'dejam')::int,0), coalesce((sm->>'eccm')::int,0),
        coalesce((sm->>'interdict')::bool,false), coalesce((sm->>'stabil')::bool,false));

    yy := least(h-1, greatest(0, h/2 + (i - 1 - n/2) * 2 + 1));
    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil)
      values (bid, bot, 'defender', p_bot_ship, sb->>'name', sb->>'cls', w-2, yy,
        (sb->>'hp')::numeric, (sb->>'hp')::numeric, (sb->>'armor')::numeric,
        (sb->>'shield')::numeric, (sb->>'shield')::numeric, (sb->>'dmg')::numeric,
        (sb->>'speed')::int, (sb->>'rng')::int,
        3, public._bt_turnneed(sb->>'cls'),
        coalesce((sb->>'sensor')::int,0), coalesce((sb->>'stealth')::int,0),
        coalesce(sb->'wpn','[]'::jsonb), coalesce(sb->'resist','{}'::jsonb),
        coalesce((sb->>'pd')::numeric,0), coalesce((sb->>'jam')::int,0), coalesce((sb->>'wings')::int,0),
        coalesce((sb->>'dejam')::int,0), coalesce((sb->>'eccm')::int,0),
        coalesce((sb->>'interdict')::bool,false), coalesce((sb->>'stabil')::bool,false));
  end loop;

  insert into public.admin_bot_duel(one, battle_id) values (1, bid)
    on conflict (one) do update set battle_id = excluded.battle_id, created_at = now();

  return jsonb_build_object('ok', true, 'battle_id', bid,
    'my_ship', sm->>'name', 'bot_ship', sb->>'name', 'n', n);
end$$;
revoke all on function public.admin_bot_battle(uuid,uuid,int) from public;
grant execute on function public.admin_bot_battle(uuid,uuid,int) to authenticated;

-- ── ХОД БОТОВ ────────────────────────────────────────────────────────
-- Каждый живой бот-корабль: едет к ближайшему врагу (до speed шагов, огибая
-- занятые клетки и край), затем стреляет, если враг в дальности. Потом ход
-- передаётся игроку тем же порядком, что и battle_end_turn.
create or replace function public._bt_bot_turn(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $$
declare b record; botside text; nxt text; bot text := public._bt_bot_fid();
        u record; tgt record; w int; h int;
        d int; cand int; nb int[]; nx int; ny int; bestx int; besty int;
        step int; eff numeric; absorb numeric; hulld numeric; cur_d int;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or b.status <> 'active' then return; end if;
  perform public._bt_arm(p_battle);
  w := public._bt_w(); h := public._bt_h();
  botside := b.side_to_move;
  -- прогоняем ТОЛЬКО если сейчас ход стороны-бота
  if (botside = 'attacker' and b.attacker_fid <> bot)
     or (botside = 'defender' and b.defender_fid <> bot) then
    return;
  end if;

  for u in select * from public.battle_units
            where battle_id = p_battle and side = botside and alive
            order by id loop
    -- ближайший живой враг
    select * into tgt from public.battle_units
      where battle_id = p_battle and side <> botside and alive
      order by public._bt_dist(u.x, u.y, x, y) asc, id limit 1;
    if tgt.id is null then exit; end if;   -- врагов не осталось

    -- движение к цели
    step := 0;
    while step < coalesce(u.speed, 2) loop
      cur_d := public._bt_dist(u.x, u.y, tgt.x, tgt.y);
      exit when cur_d <= greatest(1, coalesce(u.rng, 3));   -- уже в дальности — стоп
      d := public._bt_dirof(u.x, u.y, tgt.x, tgt.y);
      bestx := null;
      -- пробуем прямое направление, потом два соседних
      foreach cand in array array[d, (d + 1) % 6, (d + 5) % 6] loop
        nb := public._bt_step(u.x, u.y, cand);
        nx := nb[1]; ny := nb[2];
        if nx < 0 or nx >= w or ny < 0 or ny >= h then continue; end if;
        if public._bt_dist(nx, ny, tgt.x, tgt.y) >= cur_d then continue; end if;   -- не приближает
        if exists(select 1 from public.battle_units
                   where battle_id = p_battle and alive and x = nx and y = ny) then continue; end if;
        bestx := nx; besty := ny; exit;
      end loop;
      exit when bestx is null;   -- шагнуть некуда
      update public.battle_units set x = bestx, y = besty where id = u.id;
      u.x := bestx; u.y := besty;
      step := step + 1;
    end loop;

    -- разворот носом к цели
    update public.battle_units set facing = public._bt_dirof(u.x, u.y, tgt.x, tgt.y) where id = u.id;

    -- выстрел, если цель в дальности
    if public._bt_dist(u.x, u.y, tgt.x, tgt.y) <= coalesce(u.rng, 3) then
      eff := coalesce(u.dmg, 0);
      if eff > 0 then
        absorb := least(coalesce(tgt.shield, 0), eff);
        if eff - absorb > 0 then
          hulld := greatest(1, eff - absorb - coalesce(tgt.armor, 0));
        else
          hulld := 0;
        end if;
        update public.battle_units
           set shield = greatest(0, coalesce(shield, 0) - absorb),
               hp     = hp - hulld,
               alive  = (hp - hulld) > 0,
               flash  = true
         where id = tgt.id;
        perform public._bt_log(p_battle,
          format('🤖 %s → %s (−%s)', coalesce(u.unit_name,'бот'),
                 coalesce(tgt.unit_name,'цель'), round(absorb + hulld)));
      end if;
    end if;
  end loop;

  -- передать ход игроку (как battle_end_turn)
  if botside = 'attacker' then
    update public.battles set att_turns_left = greatest(0, att_turns_left - 1) where id = p_battle;
  else
    update public.battles set def_turns_left = greatest(0, def_turns_left - 1) where id = p_battle;
  end if;
  begin perform public._bt_env_end(p_battle, botside); exception when others then null; end;
  nxt := case when botside = 'attacker' then 'defender' else 'attacker' end;
  update public.battle_units set moved = false, fired = false, acted = false, flash = false
   where battle_id = p_battle and side = nxt;
  update public.battles
     set side_to_move = nxt, turn_no = turn_no + 1, acts_left = public._bt_acts(),
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;
  perform public._bt_check_end(p_battle);
end$$;
revoke all on function public._bt_bot_turn(uuid) from public;

-- Публичная (стафф) обёртка: прогнать ход ботов на кнопку в админке.
create or replace function public.admin_bot_turn(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.status <> 'active' then raise exception 'бой не идёт (%).', b.status; end if;
  if b.side_to_move = 'attacker' and b.attacker_fid <> public._bt_bot_fid()
     and b.defender_fid <> public._bt_bot_fid() then
    raise exception 'это не бой с ботами';
  end if;
  if (b.side_to_move = 'attacker' and b.attacker_fid <> public._bt_bot_fid())
     or (b.side_to_move = 'defender' and b.defender_fid <> public._bt_bot_fid()) then
    raise exception 'сейчас ход игрока — сначала заверши свой ход';
  end if;
  perform public._bt_bot_turn(p_battle);
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.admin_bot_turn(uuid) from public;
grant execute on function public.admin_bot_turn(uuid) to authenticated;

-- Текущий бот-бой (для кнопки «Открыть доску» / «Ход ботов» в админке).
create or replace function public.admin_bot_battle_state()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare t record; b record;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  select * into t from public.admin_bot_duel where one = 1;
  if t.battle_id is null then return jsonb_build_object('battle_id', null); end if;
  select * into b from public.battles where id = t.battle_id;
  if b.id is null then return jsonb_build_object('battle_id', null); end if;
  return jsonb_build_object('battle_id', t.battle_id,
    'status', b.status, 'side_to_move', b.side_to_move,
    'winner', public._war_nm(b.winner_fid),
    'bot_turn', ((b.side_to_move='attacker' and b.attacker_fid=public._bt_bot_fid())
              or (b.side_to_move='defender' and b.defender_fid=public._bt_bot_fid())));
end$$;
revoke all on function public.admin_bot_battle_state() from public;
grant execute on function public.admin_bot_battle_state() to authenticated;
