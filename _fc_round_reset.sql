-- © 2025–2026. Все права защищены.
-- ════════════════════════════════════════════════════════════
-- 🥊 РАЗОВО: закрыть зависшую PvP-дуэль и открыть круг по рев.10
-- ────────────────────────────────────────────────────────────
-- Круг от 06.08 встал на втором ходу: обе стороны бросили бой, а сеттл
-- клуба ждёт победителя, которого не будет. Пока он висит, жеребьёвка
-- новой арены (игроки против вольницы) не запустится ни разу.
-- Ставок в круге нет — возвращать нечего; бой закрываем без победителя,
-- круг помечаем сеттленым и открываем набор заявок на полчаса.
-- ЦЕПОЧКА: ПОСЛЕ _fc_bot_arena.sql. Одноразово (idempotent по смыслу:
-- повторный накат просто ничего не найдёт).
-- ════════════════════════════════════════════════════════════
do $$
declare ev record;
begin
  for ev in select * from public.fc_events where status = 'live' loop
    -- возврат ставок, если они всё-таки были
    update public.faction_economy e
       set gc = e.gc + b.amount
      from public.fc_bets b
     where b.event_id = ev.id and e.faction_id = b.fid;
    update public.fc_bets set won = amount where event_id = ev.id;

    delete from public.fleets f
      using public.battle_fleets bf
     where bf.battle_id = ev.battle_id and bf.fleet_id = f.id;
    update public.battles set status = 'done', ended_at = now(), side_to_move = null
     where id = ev.battle_id and status <> 'done';
    update public.fc_events
       set status = 'done', settled = true, ended_at = now()
     where id = ev.id;
    perform public._fc_news('🥊 Бойцовский клуб: круг закрыт',
      'Дуэль двух держав заглохла на втором ходу — круг аннулирован, ставки возвращены. Клуб переоборудует арену: со следующего круга жребий выпускает державы против пиратской вольницы.',
      jsonb_build_array(ev.duelist_a, ev.duelist_b));
  end loop;
end $$;

-- свежий круг: короткое окно заявок, чтобы арену увидели сегодня
insert into public.fc_events(status, signup_until)
  select 'signup', now() + interval '30 minutes'
 where not exists (select 1 from public.fc_events where status = 'signup');

select public._fc_sweep_pools();
