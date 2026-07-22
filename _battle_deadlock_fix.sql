-- ═══ Хотфикс: бой не завершается, когда поле пусто, а резерв заперт ═══
-- Симптом: у стороны на доске не осталось ни одного корабля, но бой висит
-- в статусе active и не кончается.
--
-- Причина: _bt_check_end завершал бой у стороны только при alive=0 И pool=0
-- ОДНОВРЕМЕННО. Но вражеское поле интердикции (FTL-заградитель, модуль
-- interdict) запрещает высаживать подкрепление. Тогда:
--   • свои корабли выбиты        → alive = 0,
--   • в составе флота есть резерв → pool  > 0,
--   • battle_reinforce блокирован полем интердикции — высадить нельзя.
-- Условие победы врага (pool=0) не наступает никогда → вечный дедлок.
--
-- Фикс: сторона проигрывает, если на доске никого И подкрепление недоступно —
-- резерв кончился ЛИБО он заперт вражеской интердикцией (и своего
-- стабилизатора «Альтаан» на поле нет).
--
-- Катить в Supabase → SQL Editor ПОСЛЕ:
--   _war_battle.sql → _war_battle_rework.sql → _battle_finish_fix.sql
--     → _war_battle_tactics.sql
-- (переопределяет только _bt_check_end; требует _bt_interdicted из tactics).

create or replace function public._bt_check_end(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $$
declare b record; a_alive int; d_alive int; a_pool int; d_pool int;
        a_locked boolean; d_locked boolean; win text;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status = 'done' then return; end if;

  select count(*) filter (where side='attacker'), count(*) filter (where side='defender')
    into a_alive, d_alive
    from public.battle_units where battle_id = p_battle and alive;

  select coalesce(jsonb_array_length(public.battle_pool(p_battle, b.attacker_fid)),0) into a_pool;
  select coalesce(jsonb_array_length(public.battle_pool(p_battle, b.defender_fid)),0) into d_pool;

  -- заперт ли резерв вражеским полем интердикции (функция из _war_battle_tactics)
  begin
    a_locked := public._bt_interdicted(p_battle, 'attacker');
    d_locked := public._bt_interdicted(p_battle, 'defender');
  exception when undefined_function then
    a_locked := false; d_locked := false;
  end;

  if b.status = 'active' then
    -- на доске никого и подкрепление недоступно (кончилось или заперто) → поражение
    if a_alive = 0 and (a_pool = 0 or a_locked) then win := b.defender_fid;
    elsif d_alive = 0 and (d_pool = 0 or d_locked) then win := b.attacker_fid;
    end if;
  end if;
  if win is null then return; end if;

  perform public._bt_finish(p_battle, win);
end$$;
revoke all on function public._bt_check_end(uuid) from public;

-- ── Разово: перепроверить все идущие бои — застрявшие завершатся сами ──
do $$
declare bid uuid;
begin
  for bid in select id from public.battles where status = 'active' loop
    perform public._bt_check_end(bid);
  end loop;
end$$;
