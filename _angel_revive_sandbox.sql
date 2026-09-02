-- Поднять тестовый бой, который свип ангела закрыл без победителя.
-- Разовый накат: доска цела (16 живых бортов), закрыт был только статус.
-- ?v=20260828reviveSandbox
do $$
declare bid uuid; b record;
begin
  select battle_id into bid from public.admin_bot_duel where one = 1;
  if bid is null then raise notice 'админского боя с ботами нет'; return; end if;
  select * into b from public.battles where id = bid;
  if b.id is null then raise notice 'бой % не найден', bid; return; end if;
  if b.status <> 'done' then raise notice 'бой % и так идёт (%)', bid, b.status; return; end if;
  if not exists (select 1 from public.battle_units where battle_id = bid and alive) then
    raise notice 'на доске никого — поднимать нечего'; return;
  end if;
  update public.battles
     set status = 'active', ended_at = null, winner_fid = null,
         side_to_move = 'attacker',                 -- ход возвращаем игроку
         acts_left = public._bt_acts(),
         att_turns_left = greatest(att_turns_left, 4),
         def_turns_left = greatest(def_turns_left, 4),
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = bid;
  perform public._bt_log(bid, 'Доска поднята: бой закрывал свип кризиса, победы не было.');
  raise notice 'бой % поднят, ход за нападающим', bid;
end$$;
