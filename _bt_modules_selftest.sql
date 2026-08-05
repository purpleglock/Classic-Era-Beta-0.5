-- ТЕСТ активного снаряжения. Завершается намеренной ошибкой → db_run
-- откатывает транзакцию целиком, в живой базе не остаётся НИЧЕГО.
--   node tools/db_run.js _bt_modules_selftest.sql
do $t$
declare uid uuid; v_acts jsonb; a jsonb; got int; before_hp numeric; hit jsonb;
        tid uuid; bid uuid; sid uuid;
begin
  -- 1) РАЗБОР МОДУЛЕЙ ПРОЕКТА ------------------------------------------
  select id into uid from public.faction_units where category='ship' limit 1;
  update public.faction_units
     set data = jsonb_set(data, '{modules}',
           coalesce(data->'modules','[]'::jsonb)
           || jsonb_build_array(
                jsonb_build_object('g','Конструкционные модули','idx',7),   -- Кряж
                jsonb_build_object('g','Конструкционные модули','idx',8),   -- Буревестник
                jsonb_build_object('g','Модули радиотумана','idx',10)))     -- Вуаль
   where id = uid;

  v_acts := public._bt_acts_of(uid);
  raise notice 'acts = %', v_acts;
  if public._bt_act(v_acts,'siege') is null then raise exception 'ПРОВАЛ: осада не собралась'; end if;
  if public._bt_act(v_acts,'salvo') is null then raise exception 'ПРОВАЛ: ракетный залп не собрался'; end if;
  if public._bt_act(v_acts,'cloak') is null then raise exception 'ПРОВАЛ: маскировка не собралась'; end if;
  a := public._bt_act(v_acts,'salvo');
  if (a->>'dmg')::numeric <> 4200 or (a->>'rng')::int <> 12 then
    raise exception 'ПРОВАЛ: ТТХ ракетного блока не доехали: %', a;
  end if;
  raise notice 'OK 1/4: модули проекта разобраны в активации';

  -- 2) ТРИГГЕР НА ВСТАВКЕ ----------------------------------------------
  select id into bid from public.battles limit 1;
  if bid is null then raise exception 'в базе нет ни одного боя — тест вставки пропущен'; end if;
  insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls,
                                  x, y, hp, max_hp, armor, shield, max_shield, dmg, speed, rng)
       values (bid, 'zzz_test', 'attacker', uid, 'ТЕСТ-БОРТ', 'destroyer',
               0, 0, 1000, 1000, 0, 0, 0, 100, 4, 5)
    returning id into sid;
  select jsonb_array_length(bu.acts) into got from public.battle_units bu where bu.id = sid;
  if coalesce(got,0) < 3 then
    raise exception 'ПРОВАЛ: триггер не наполнил acts (получено %)', got;
  end if;
  raise notice 'OK 2/4: триггер наполнил acts при вставке (% шт)', got;

  -- 3) ПРОБОЙКА УРОНА ---------------------------------------------------
  insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls,
                                  x, y, hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
                                  mitig, reduc, resist)
       values (bid, 'zzz_test', 'defender', null, 'ТЕСТ-ЦЕЛЬ', 'destroyer',
               3, 0, 5000, 5000, 100, 0, 0, 100, 4, 5,
               50, 0.5, '{"kinetic":0,"energy":0,"missile":0}'::jsonb)
    returning id into tid;
  select hp into before_hp from public.battle_units where id = tid;
  hit := public._bt_hit(tid, 1000, 'missile', '[]'::jsonb);
  raise notice 'hit = %', hit;
  if (hit->>'hull')::numeric <= 0 then raise exception 'ПРОВАЛ: пробойка не нанесла урона'; end if;
  if (select hp from public.battle_units where id = tid) >= before_hp then
    raise exception 'ПРОВАЛ: корпус цели не уменьшился';
  end if;
  raise notice 'OK 3/4: _bt_hit снял корпус с учётом брони';

  -- 4) ТИК КУЛДАУНОВ И ГАШЕНИЕ РАЗОВЫХ ЭФФЕКТОВ -------------------------
  update public.battle_units
     set mcd = '{"salvo":3,"cloak":1}'::jsonb, amp = 0.6, cloak = 8,
         stealth = stealth + 8, stance = 'siege'
   where id = sid;
  perform public._bt_tp_refresh(bid, 'attacker');
  select bu.mcd into v_acts from public.battle_units bu where bu.id = sid;
  if (v_acts->>'salvo')::int <> 2 then raise exception 'ПРОВАЛ: кулдаун не тикнул: %', v_acts; end if;
  if v_acts ? 'cloak' then raise exception 'ПРОВАЛ: отстоявший кулдаун не убрался: %', v_acts; end if;
  if (select amp from public.battle_units where id = sid) <> 0 then
    raise exception 'ПРОВАЛ: «Ярость» не погасла';
  end if;
  if (select cloak from public.battle_units where id = sid) <> 0 then
    raise exception 'ПРОВАЛ: «Вуаль» не снялась';
  end if;
  if (select stance from public.battle_units where id = sid) <> 'siege' then
    raise exception 'ПРОВАЛ: осада не пережила ход';
  end if;
  raise notice 'OK 4/4: кулдауны тикают, разовые эффекты гаснут, осада держится';

  raise exception 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ — откатываю тестовые данные (это не ошибка)';
end$t$;
