-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 9: ПУСТАЯ ДОСКА — ЭТО КОНЕЦ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_teeth.sql, перед _angel_lock.sql.
--   node tools/db_run.js _angel_wipe_end.sql
--   node tools/db_run.js _angel_lock.sql
-- Идемпотентно. Накат разбирает уже висящие бои.
--
-- ЖАЛОБА: «бой с ангелом не заканчивается, если уничтожить всех на карте».
-- Так и было: _bt_check_end объявляет исход только когда у стороны И доска
-- пуста, И резерв пуст. Резерв (battle_pool) — это корабли скованных флотов,
-- которых ещё не выставили. Ангел выбивает доску за ход, резерв остаётся, и
-- бой честно ждёт подкрепления — сутки за сутками. Наблюдается это как
-- «сражение зависло»: на карте один ангел, ходить некем, кончиться нечему.
--
-- ПОЧЕМУ ЭТО НЕ ПОЧИНИТЬ ОБЩИМ ПРАВИЛОМ. «Выбили доску — проиграл» ломает
-- обычные бои: там резерв и есть вторая линия, ради неё флот и везут.
-- Правим только бои ангела.
--
-- ⚠️ ЗАКРЫВАЕМ ЧЕРЕЗ _angel_slip, А НЕ ЧЕРЕЗ _bt_finish. _bt_finish объявляет
-- победителя, а победитель зовёт _war_occupy_check и поднимает флаг над
-- системой. Ангел флагов не берёт (см. разбор в _angel_no_grip.sql, там же
-- чистка уже поднятых). Стороны разошлись: потери — только погибшие на доске.
--
-- ⚠️ ГОЛОС: строку пишет сам _angel_slip («стрельба прекратилась»). Никаких
-- «резерв больше не спасёт» — правило игроку не объясняем.
-- ════════════════════════════════════════════════════════════

-- Надмножество живой редакции (_bt_perks2.sql): дословно она, плюс ветка
-- ангела перед общим разбором.
create or replace function public._bt_check_end(p_battle uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare b record; a_alive int; d_alive int; a_pool int; d_pool int;
        win text; is_bot boolean; af text;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status = 'done' then return; end if;
  if b.status <> 'active' then return; end if;

  -- Перехваченный «Машинным разумом» борт временно числится за захватчиком.
  -- Считать его чужим нельзя: иначе перехват ПОСЛЕДНЕГО вражеского корабля
  -- мгновенно заканчивал бы бой победой. Смотрим на РОДНУЮ сторону из pk.hj.
  select count(*) filter (where coalesce(pk->'hj'->>'s', side) = 'attacker'),
         count(*) filter (where coalesce(pk->'hj'->>'s', side) = 'defender')
    into a_alive, d_alive
    from public.battle_units where battle_id = p_battle and alive;

  -- ── ◈ ПРЕСТОЛ: доска пуста — сражение отгремело ───────────
  af := case when public._angel_is(b.attacker_fid) then b.attacker_fid
             when public._angel_is(b.defender_fid) then b.defender_fid else null end;
  if af is not null then
    if (b.attacker_fid = af and d_alive = 0)
       or (b.defender_fid = af and a_alive = 0)
       -- ангела на доске не стало (пал по печатям, снят админом) — тоже конец
       or not exists (select 1 from public.battle_units u
                       where u.battle_id = p_battle and u.fid = af and u.alive) then
      perform public._angel_slip(p_battle);
    end if;
    return;
  end if;

  -- это текущий админский бой с ботами?
  select exists(select 1 from public.admin_bot_duel where one = 1 and battle_id = p_battle)
    into is_bot;

  if is_bot then
    -- исход только по живым: у кого пусто на доске — тот проиграл
    if a_alive = 0 then win := b.defender_fid;
    elsif d_alive = 0 then win := b.attacker_fid;
    end if;
  else
    -- обычные бои: нет живых И резерв (реальные флоты) кончился
    select coalesce(jsonb_array_length(public.battle_pool(p_battle, b.attacker_fid)),0) into a_pool;
    select coalesce(jsonb_array_length(public.battle_pool(p_battle, b.defender_fid)),0) into d_pool;
    if a_alive = 0 and a_pool = 0 then win := b.defender_fid;
    elsif d_alive = 0 and d_pool = 0 then win := b.attacker_fid;
    end if;
  end if;

  if win is null then return; end if;
  perform public._bt_finish(p_battle, win);
end$function$;
revoke all on function public._bt_check_end(uuid) from public;
grant execute on function public._bt_check_end(uuid) to authenticated;

-- Разово: перепроверить идущие бои ангела — висящие закроются сами.
do $$
declare bid uuid; af text; n int := 0;
begin
  af := public._angel_fid();
  if af is null then return; end if;
  for bid in select id from public.battles
              where status = 'active' and (attacker_fid = af or defender_fid = af)
  loop
    begin perform public._bt_check_end(bid); n := n + 1;
    exception when others then raise notice 'battle % : %', bid, sqlerrm; end;
  end loop;
  raise notice 'angel battles rechecked: %', n;
end$$;

notify pgrst, 'reload schema';

-- ── ПРОВЕРКА ────────────────────────────────────────────────
-- 1) Ангел выбил доску → бой status='done', winner_fid = null, оккупации нет,
--    в журнале «стрельба прекратилась», флоты расковались.
-- 2) Резерв у выбитой стороны остался цел (минус погибшие на доске) —
--    докидывать в мясорубку больше не требуется и нечего продлевать.
-- 3) Обычные две державы: правило «доска + резерв» не тронуто.
