-- © 2025–2026. Все права защищены.
-- ═══════════════════════════════════════════════════════════════════
-- 🤝 НПС-СОЮЗНИК ЗАКРЫВАЕТ ХОД САМ
-- ═══════════════════════════════════════════════════════════════════
-- ПОРЯДОК: после _bt_side_pass.sql и _bot_allies.sql. Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК. Конец хода на стороне из нескольких держав — это
-- ГОТОВНОСТЬ каждой: ход переворачивает последний нажавший (_bt_side_pass).
-- НПС кнопок не нажимает, поэтому стоило посадить союзников-ботов в команду,
-- как ход застревал: игрок готов, а сторона ждёт «Империю» и «Повстанцев»
-- до скончания века. Союзники при этом не ходили вовсе — их черёд по логике
-- наступал уже ПОСЛЕ переворота, которого не происходило.
--
-- СТАЛО. Когда живой игрок закрывает ход, за всех НПС этой стороны сразу
-- отрабатывает ИИ (_bt_ally_turn на остаток активаций) и их готовность
-- проставляется автоматически. Ждать сторона может только живых.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public._bt_do_end_turn(p_battle uuid, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $function$
declare me text; b public.battles; sd text; nxt text; mates text[]; wait text[];
        ai text[]; f text;
begin
  perform public._bt_arm(p_battle);
  me := p_fid;

  -- Повторное нажатие СНИМАЕТ готовность.
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

  mates := public._bt_side_actors(p_battle, sd);
  if coalesce(array_length(mates, 1), 0) > 1 then
    update public.battles
       set turn_pass = coalesce(turn_pass, '[]'::jsonb) || to_jsonb(me)
     where id = p_battle;

    -- НПС этой стороны: за них ходит и «нажимает кнопку» ИИ
    select array_agg(a.fid) into ai
      from public.battle_ai_fids a
     where a.battle_id = p_battle
       and public._bt_side(p_battle, a.fid) = sd
       and a.fid <> me
       and not (coalesce((select turn_pass from public.battles where id = p_battle),
                         '[]'::jsonb) ? a.fid);
    if ai is not null then
      begin
        perform public._bt_ally_turn(p_battle, public._bt_acts());
      exception when others then null; end;
      foreach f in array ai loop
        update public.battles
           set turn_pass = coalesce(turn_pass, '[]'::jsonb) || to_jsonb(f)
         where id = p_battle and not (coalesce(turn_pass, '[]'::jsonb) ? f);
      end loop;
    end if;

    wait := public._bt_pass_wait(p_battle);
    if coalesce(array_length(wait, 1), 0) > 0 then
      perform public._bt_log(p_battle, format('%s закончил(а) ход — ждём союзников.', public._war_nm(me)));
      return jsonb_build_object('ok', true, 'ready', true, 'wait', to_jsonb(wait));
    end if;
  end if;

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
end$function$;
revoke all on function public._bt_do_end_turn(uuid,text) from public;

notify pgrst, 'reload schema';
