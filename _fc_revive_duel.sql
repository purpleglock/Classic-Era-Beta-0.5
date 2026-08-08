-- © 2025–2026. Все права защищены.
-- ════════════════════════════════════════════════════════════
-- 🥊 ВЕРНУТЬ НЕДОИГРАННУЮ ДУЭЛЬ НА ДОСКУ
-- ────────────────────────────────────────────────────────────
-- _fc_round_reset.sql закрыл круг от 06.08 вместе с боем — а бой был живой:
-- 23 борта на доске, ни одного убитого, просто никто не ходил трое суток.
-- Закрывать КРУГ было надо (иначе новая арена не стартует), а ДОСКУ — нет.
--
-- Чиним: бой снова active, ход за защитником (turn_no=2 → первый ход
-- нападающих уже сделан), срок хода отсчитывается заново. Круг клуба при
-- этом остаётся закрытым: бой доигрывается ОТДЕЛЬНО, без кассы и ставок
-- (их в том круге и не было), и жеребьёвку новой арены он не держит.
--
-- Открывается с вкладки «Горячие точки» (бой в списке своих) и с табло
-- клуба — fc_state отдаёт его в поле my_open_duel.
-- ЦЕПОЧКА: ПОСЛЕ _fc_round_reset.sql. Одноразово.
-- ════════════════════════════════════════════════════════════
update public.battles
   set status       = 'active',
       ended_at     = null,
       winner_fid   = null,
       side_to_move = case when turn_no % 2 = 1 then 'attacker' else 'defender' end,
       deadline_at  = now() + (public._bt_turn_hours() || ' hours')::interval
 where id = '3f37a796-525a-418a-a9f3-494e1b550af9'
   and status = 'done' and winner_fid is null
   and exists (select 1 from public.battle_units u
                where u.battle_id = battles.id and u.alive);

select public._bt_log('3f37a796-525a-418a-a9f3-494e1b550af9',
  '⚖ Круг клуба закрыт, но бой не окончен: доска возвращена в игру. Доигрывайте — победа только на уничтожение, кассы и ставок в этом бою нет.');

-- ── Табло клуба: ссылка на свой недоигранный бой ────────────
-- Круг может быть уже другим (или в наборе заявок), а бой висит. Отдаём
-- участнику ЛЮБУЮ живую дуэль, где он на доске, кроме боя текущего круга.
create or replace function public._fc_my_open_duel(p_me text, p_skip uuid)
returns uuid language sql stable security definer set search_path=public as $$
  select b.id
    from public.battles b
   where b.kind = 'duel'
     and b.status in ('forming','active')
     and (p_skip is null or b.id <> p_skip)
     and p_me is not null
     and (b.attacker_fid = p_me or b.defender_fid = p_me
          or exists(select 1 from public.battle_allies a
                     where a.battle_id = b.id and a.fid = p_me))
   order by b.created_at            -- сначала самый старый: кнопка зовёт ДОИГРАТЬ
   limit 1;
$$;
revoke all on function public._fc_my_open_duel(text,uuid) from public;
grant execute on function public._fc_my_open_duel(text,uuid) to authenticated;

notify pgrst, 'reload schema';
