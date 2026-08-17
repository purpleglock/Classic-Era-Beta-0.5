-- ════════════════════════════════════════════════════════════
-- 17.08 «CANCELING STATEMENT DUE TO STATEMENT TIMEOUT» на ходу ватаги.
--
-- У роли authenticated в Supabase statement_timeout = 8 c (см. [[bot-turn-statement-timeout]]).
-- Ход машинной стороны на доске с 44 бортами (38 корветов игрока + 6 пиратов)
-- в него не влезает — и игрок получает сырой 57014 вместо хода противника.
-- Гонять тяжёлый ИИ из браузера вообще неправильно: у Легиона нет сессии, его
-- ход — дело сервера. Клиентский вызов остаётся как быстрый путь (успел — хорошо),
-- а гарантию даёт крон: раз в минуту прогоняем все бои, где ходит машина.
--
-- ЦЕПОЧКА: после _legion_battle_ai.sql.
-- ════════════════════════════════════════════════════════════

create or replace function public.legion_ai_tick()
returns jsonb language plpgsql security definer as $$
declare b record; n int := 0; d int := 0;
begin
  -- 1) недорасставленные бои: ватага выходит на доску
  for b in select id from public.battles
            where status = 'forming'
              and (attacker_fid = public._legion_fid() or defender_fid = public._legion_fid())
  loop
    begin
      if (public.legion_battle_deploy(b.id)->>'ok')::boolean then d := d + 1; end if;
    exception when others then null; end;
  end loop;

  -- 2) ход машинной стороны там, где очередь за ней
  for b in select id from public.battles
            where status = 'active'
              and public._bt_is_machine(case when side_to_move = 'attacker'
                                             then attacker_fid else defender_fid end)
            order by created_at
            limit 12
  loop
    begin
      perform public._bt_bot_turn(b.id);
      n := n + 1;
    exception when others then null; end;   -- один зависший бой не должен рушить остальные
  end loop;

  return jsonb_build_object('ok', true, 'turns', n, 'deployed', d);
end $$;

select cron.schedule('legion-ai-tick', '* * * * *', $$select public.legion_ai_tick();$$);
