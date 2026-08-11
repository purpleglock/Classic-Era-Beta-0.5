-- © 2025–2026. Все права защищены.
-- ════════════════════════════════════════════════════════════
-- ХОД СТОРОНЫ ЗАКАНЧИВАЮТ ВСЕ, А НЕ ПЕРВЫЙ НАЖАВШИЙ
-- ────────────────────────────────────────────────────────────
-- БОЛЬ. На арене клуба (_fc_bot_arena.sql) на одну сторону садится до трёх
-- держав: battle_allies, общий пул из 6 активаций, общий side_to_move.
-- battle_end_turn при этом переворачивал ход СРАЗУ — кто первый нажал, тот
-- и оборвал ход союзникам посреди манёвра. Плюс союзник мог жать «завершить»
-- прямо во время твоего хода: борта замирали, секунды сгорали, доска
-- превращалась в кашу.
--
-- ЧТО ДЕЛАЕМ. Кнопка «завершить ход» становится ГОТОВНОСТЬЮ державы:
--   §1  battles.turn_pass — список fid, кто уже отходил в этом ходу.
--       Триггер чистит его на любой смене side_to_move / turn_no, поэтому
--       ни force_turn, ни ход ботов, ни _fc_* про него знать не обязаны.
--   §2  _bt_do_end_turn — если на стороне одна держава, всё как раньше.
--       Если несколько — записываем готовность и ждём остальных; ход
--       переворачивается, когда отходили ВСЕ, у кого есть живые борта.
--       Повторное нажатие СНИМАЕТ готовность (передумал — доигрывай).
--   §3  _bt_require_turn — держава, объявившая готовность, больше не
--       двигает, не стреляет и не жмёт модули до конца хода стороны.
--       Один гейт закрывает все действия разом (move/fire/module/launch/
--       reinforce/stance ходят через него).
--   §4  battle_state отдаёт клиенту состав своей стороны (mates), свою
--       готовность (i_ready) и кого ещё ждут (wait_for).
--
-- ЦЕПОЧКА: ПОСЛЕ _bt_timepool.sql, _bot_ai_rules.sql, _bt_stance.sql,
--          _fc_bot_arena.sql, _battle_unit_fid.sql. Идемпотентно.
-- ════════════════════════════════════════════════════════════

-- ── §1. Готовность держав внутри хода стороны ───────────────
alter table public.battles
  add column if not exists turn_pass jsonb not null default '[]'::jsonb;

-- Ход перевернулся — готовности обнулились. Триггером, а не руками в каждой
-- функции: side_to_move пишут семь разных мест (force_turn, ход ботов,
-- _fc_kick_off, _fc_ensure, _bt_finish), и любое забытое — залипший «готов».
create or replace function public._bt_pass_reset()
returns trigger language plpgsql as $fn$
begin
  if new.side_to_move is distinct from old.side_to_move
     or new.turn_no is distinct from old.turn_no
     or new.status is distinct from old.status then
    new.turn_pass := '[]'::jsonb;
  end if;
  return new;
end$fn$;

drop trigger if exists trg_bt_pass_reset on public.battles;
create trigger trg_bt_pass_reset before update on public.battles
  for each row execute function public._bt_pass_reset();

-- Кто на стороне ещё «в игре»: держава с хотя бы одним живым бортом.
-- Выбитый союзник ход не держит — иначе сторона стояла бы в ожидании
-- того, кому нечем ходить. Если живых нет вовсе (сторона добита, бой
-- вот-вот кончится), возвращаем владельца стороны, чтобы список не был пуст.
create or replace function public._bt_side_actors(p_battle uuid, p_side text)
returns text[] language sql stable security definer set search_path=public as $fn$
  select coalesce(nullif(
    array(select distinct u.fid from public.battle_units u
           where u.battle_id = p_battle and u.side = p_side
             and u.alive and u.fid is not null
           order by 1), '{}'::text[]),
    array(select case when p_side = 'attacker' then b.attacker_fid else b.defender_fid end
            from public.battles b where b.id = p_battle));
$fn$;
grant execute on function public._bt_side_actors(uuid, text) to authenticated, service_role;

-- Кого ещё ждёт ходящая сторона (пусто = можно переворачивать ход).
create or replace function public._bt_pass_wait(p_battle uuid)
returns text[] language sql stable security definer set search_path=public as $fn$
  select coalesce(array(
    select f from unnest(public._bt_side_actors(p_battle, b.side_to_move)) f
     where not (coalesce(b.turn_pass, '[]'::jsonb) ? f)), '{}'::text[])
    from public.battles b where b.id = p_battle;
$fn$;
grant execute on function public._bt_pass_wait(uuid) to authenticated, service_role;

-- ── §3. Гейт действий: объявил готовность — доигрывают союзники ──
create or replace function public._bt_require_turn(p_battle uuid, p_fid text)
returns public.battles language plpgsql stable security definer set search_path=public as $fn$
declare b public.battles; sd text;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.status <> 'active' then raise exception 'бой не идёт'; end if;
  sd := public._bt_side(p_battle, p_fid);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;
  if b.side_to_move is distinct from sd then raise exception 'сейчас не ваш ход'; end if;
  -- готовность объявлена: свои борта на этот ход замерли, ждём союзников
  if coalesce(b.turn_pass, '[]'::jsonb) ? p_fid then
    raise exception 'вы уже завершили ход — доигрывают союзники';
  end if;
  return b;
end$fn$;

-- ── §2. Конец хода = готовность державы ─────────────────────
create or replace function public._bt_do_end_turn(p_battle uuid, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b public.battles; sd text; nxt text; mates text[]; wait text[];
begin
  perform public._bt_arm(p_battle);
  me := p_fid;

  -- Повторное нажатие СНИМАЕТ готовность. Проверяем до _bt_require_turn:
  -- он для уже отходившего сам бросает исключение (см. §3).
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.status = 'active'
     and b.side_to_move is not distinct from public._bt_side(p_battle, me)
     and coalesce(b.turn_pass, '[]'::jsonb) ? me then
    update public.battles set turn_pass = coalesce(turn_pass, '[]'::jsonb) - me
     where id = p_battle;
    perform public._bt_log(p_battle, format('%s передумал(а) заканчивать ход.', public._war_nm(me)));
    return jsonb_build_object('ok', true, 'ready', false,
                              'wait', to_jsonb(public._bt_pass_wait(p_battle)));
  end if;

  b  := public._bt_require_turn(p_battle, me);
  sd := b.side_to_move;

  -- Сторона не одна держава: сперва копим готовности, ход переворачивает
  -- последний. Так союзник не обрывает чужой манёвр на полуслове.
  mates := public._bt_side_actors(p_battle, sd);
  if coalesce(array_length(mates, 1), 0) > 1 then
    update public.battles
       set turn_pass = coalesce(turn_pass, '[]'::jsonb) || to_jsonb(me)
     where id = p_battle;
    wait := public._bt_pass_wait(p_battle);
    if coalesce(array_length(wait, 1), 0) > 0 then
      perform public._bt_log(p_battle, format('%s закончил(а) ход — ждём союзников.', public._war_nm(me)));
      return jsonb_build_object('ok', true, 'ready', true, 'wait', to_jsonb(wait));
    end if;
  end if;

  -- отходили все: дальше — как было
  if sd = 'attacker' then
    update public.battles set att_turns_left = greatest(0, att_turns_left - 1) where id = p_battle;
  else
    update public.battles set def_turns_left = greatest(0, def_turns_left - 1) where id = p_battle;
  end if;

  perform public._bt_env_end(p_battle, sd);

  nxt := case when sd = 'attacker' then 'defender' else 'attacker' end;
  perform public._bt_tp_refresh(p_battle, nxt);
  update public.battles
     set side_to_move = nxt, turn_no = turn_no + 1, acts_left = public._bt_acts(),
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;   -- turn_pass чистит триггер trg_bt_pass_reset

  perform public._bt_hijack_tick(p_battle);
  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'ready', true, 'wait', '[]'::jsonb);
end$fn$;

-- ── §4. Клиенту: состав своей стороны и чья готовность где ──
-- Тело взято ЖИВЫМ из базы (pg_get_functiondef); добавлены три поля.
create or replace function public.battle_state(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b record; sd text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;

  perform public._bt_ensure_field(p_battle);
  select * into b from public.battles where id = p_battle;

  return jsonb_build_object(
    'id', b.id, 'status', b.status, 'kind', b.kind,
    'system_id', b.system_id,
    'system_name', (select coalesce(nullif(ms.name,''), ms.id) from public.map_systems ms where ms.id = b.system_id),
    'w', public._bt_w(), 'h', public._bt_h(), 'cap', public._bt_cap(),
    'duel_budget', b.duel_budget,
    'zone', public._bt_zone(), 'acts_max', public._bt_acts(), 'acts_left', b.acts_left,
    'tp_max', public._bt_tp_max(),
    'shape', b.shape, 'spawn', b.spawn,
    'my_side', sd, 'my_fid', me,
    'attacker', b.attacker_fid, 'attacker_name', public._war_nm(b.attacker_fid),
    'defender', b.defender_fid, 'defender_name', public._war_nm(b.defender_fid),
    'side_to_move', b.side_to_move, 'my_turn', (b.side_to_move = sd),
    -- Кто ещё сидит на моей стороне (арена клуба сажает до трёх держав):
    -- по этому списку доска решает, «завершить ход» на кнопке или «готов».
    'mates', (select coalesce(jsonb_agg(jsonb_build_object(
                 'fid', f, 'name', public._war_nm(f),
                 'ready', coalesce(b.turn_pass, '[]'::jsonb) ? f,
                 'me', (f = me)) order by f), '[]'::jsonb)
                from unnest(public._bt_side_actors(p_battle, sd)) f),
    'i_ready', (b.side_to_move = sd and coalesce(b.turn_pass, '[]'::jsonb) ? me),
    'wait_for', to_jsonb(public._bt_pass_wait(p_battle)),
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
    'graves', (select coalesce(jsonb_agg(g), '[]'::jsonb)
                 from jsonb_array_elements(coalesce(b.graves,'[]'::jsonb)) g
                where coalesce((g->>'t')::int, 0) >= b.turn_no - 1),
    'pool', public.battle_pool(p_battle, me),
    'units', (select coalesce(jsonb_agg(
        case when u.side = sd or lk.locked then
          jsonb_build_object(
            'id', u.id, 'side', u.side, 'mine', (u.fid = me),
            'fid', u.fid, 'fname', public._war_nm(u.fid),
            'name', u.unit_name, 'cls', u.cls,
            'x', u.x, 'y', u.y, 'facing', u.facing, 'straight', u.straight,
            'hp', round(u.hp), 'max_hp', round(u.max_hp),
            'shield', round(u.shield, 1), 'mitig', round(u.mitig), 'reduc', u.reduc,
            'stance', u.stance, 'tp', round(u.tp, 1), 'tp_max', round(u.tp_max, 1),
            'step_cost', round(public._bt_step_cost(u.speed), 2),
            'fire_cost', round(public._bt_fire_cost(u.cls), 2),
            'armor', round(u.armor), 'dmg', round(u.dmg),
            'speed', u.speed, 'rng', u.rng,
            'sensor', u.sensor, 'stealth', u.stealth, 'flash', u.flash,
            'pd', u.pd, 'jam', u.jam, 'wings', u.wings, 'is_wing', u.is_wing,
            'dejam', u.dejam, 'eccm', u.eccm, 'interdict', u.interdict, 'stabil', u.stabil,
            'ftl', u.ftl,
            'locked', true,
            'wpn', case when u.side = sd then coalesce(u.wpn, '[]'::jsonb) else null end,
            'acts', case when u.side = sd then coalesce(u.acts, '[]'::jsonb) else null end)
          || jsonb_build_object(
            'deb',   coalesce(u.deb, '{}'::jsonb),
            'hard',  u.hard, 'pdb', u.pdb,
            'rapid', u.rapid, 'sammo', u.sammo,
            'perks', coalesce(u.perks, '[]'::jsonb),
            'guard', u.guard, 'cloak', u.cloak, 'blind', u.blind,
            'mcd',  case when u.side = sd then coalesce(u.mcd, '{}'::jsonb) else null end,
            'pk',   case when u.side = sd then coalesce(u.pk, '{}'::jsonb) else null end,
            'amp',  case when u.side = sd then u.amp else null end,
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
end$fn$;

revoke all on function public.battle_state(uuid) from public;
grant execute on function public.battle_state(uuid) to authenticated;

-- Проверка:
--   select public._bt_side_actors('<battle>', 'attacker');
--   select public._bt_pass_wait('<battle>');
