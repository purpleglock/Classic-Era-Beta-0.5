-- © 2025–2026. Все права защищены.
-- ════════════════════════════════════════════════════════════
-- 🤖 ХОД ЛЕГИОНА: ТАЙМАУТ И ЗАМОК (правка к _fc_bot_arena.sql)
-- ────────────────────────────────────────────────────────────
-- Ход шести ботов на доске 60×80 идёт ~6-7 секунд, а роли authenticated
-- и authenticator живут с statement_timeout = 8s. Клубный ход бота
-- проходил впритык и на людной доске падал бы 57014 — с откатом всего хода.
--
--   §1  своё окно времени: statement_timeout на функциях хода ботов
--       (SET на функции пере-взводит таймер на время её работы).
--   §2  замок: ход прогоняет ПЕРВЫЙ, кто дёрнул RPC. Доску смотрят
--       и бойцы, и трибуна — без замка десяток клиентов начал бы
--       гонять один и тот же ход параллельно.
--   §3  запасной прогон в fc_state включается не сразу, а если ход
--       легиона висит дольше минуты (обычно его прогоняет тот, у кого
--       открыта доска).
-- ЦЕПОЧКА: ПОСЛЕ _fc_bot_arena.sql. Идемпотентно.
-- ════════════════════════════════════════════════════════════

-- ── §1. Своё окно времени ───────────────────────────────────
alter function public._bt_bot_turn(uuid) set statement_timeout to '120s';
alter function public.admin_bot_turn(uuid) set statement_timeout to '120s';

-- ── §2. Публичный ход легиона с замком ──────────────────────
create or replace function public.fc_bot_turn(p_battle uuid)
returns jsonb language plpgsql security definer
set search_path=public set statement_timeout to '120s' as $$
declare b record; sfid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;

  -- замок берём сразу: параллельные клиенты не должны гонять один ход
  begin
    select * into b from public.battles where id = p_battle for update nowait;
  exception when lock_not_available then
    return jsonb_build_object('ok', false, 'why', 'ход уже прогоняется');
  end;

  if b.id is null then raise exception 'no such battle'; end if;
  if b.status <> 'active' then return jsonb_build_object('ok', false, 'why', 'бой не идёт'); end if;
  sfid := case when b.side_to_move = 'attacker' then b.attacker_fid else b.defender_fid end;
  if sfid is distinct from public._bt_bot_fid() then
    return jsonb_build_object('ok', false, 'why', 'сейчас ход игрока');
  end if;

  perform public._bt_bot_turn(p_battle);
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.fc_bot_turn(uuid) from public;
grant execute on function public.fc_bot_turn(uuid) to authenticated;

-- ── §3. Запасной прогон в дозоре — только если ход завис ────
create or replace function public._fc_ensure()
returns uuid language plpgsql security definer set search_path=public as $$
declare ev record; b record; sfid text; started timestamptz;
begin
  select * into ev from public.fc_events order by created_at desc limit 1;
  if ev.id is null then
    insert into public.fc_events(status, signup_until)
      values ('signup', now() + (public._fc_signup_hours() || ' hours')::interval)
      returning * into ev;
  end if;
  if ev.status = 'signup' and now() >= ev.signup_until then
    perform public._fc_start(ev.id);
  elsif ev.status = 'live' then
    perform public._fc_settle(ev.id);
    select * into b from public.battles where id = ev.battle_id;
    if b.id is not null and b.status = 'active' then
      sfid := case when b.side_to_move = 'attacker' then b.attacker_fid else b.defender_fid end;
      -- просроченный ход игроков закрываем сами, иначе арена стоит колом
      if sfid is distinct from public._bt_bot_fid()
         and b.deadline_at is not null and b.deadline_at <= now() then
        begin perform public._bt_do_end_turn(b.id, sfid); exception when others then null; end;
        select * into b from public.battles where id = ev.battle_id;
        sfid := case when b.side_to_move = 'attacker' then b.attacker_fid else b.defender_fid end;
      end if;
      -- ход легиона обычно прогоняет тот, у кого открыта доска (fc_bot_turn).
      -- Сюда доходим, если доску не открыл никто: ждём минуту и ходим сами.
      started := b.deadline_at - (public._bt_turn_hours() || ' hours')::interval;
      if b.status = 'active' and sfid = public._bt_bot_fid()
         and (started is null or started < now() - interval '60 seconds') then
        begin perform public.fc_bot_turn(b.id); exception when others then null; end;
      end if;
    end if;
  end if;
  select id into ev from public.fc_events order by created_at desc limit 1;
  return ev.id;
end$$;
revoke all on function public._fc_ensure() from public;

notify pgrst, 'reload schema';
