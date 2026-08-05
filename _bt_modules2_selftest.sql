-- ТЕСТ пакета 2. Завершается намеренной ошибкой → транзакция откатывается,
-- в живой базе не остаётся ничего.  node tools/db_run.js _bt_modules2_selftest.sql
do $t$
declare bid uuid; a uuid; d uuid; v_deb jsonb; v_mcd jsonb;
        hp0 numeric; sh0 numeric; hit jsonb; n int;
begin
  select id into bid from public.battles limit 1;
  if bid is null then raise exception 'нет ни одного боя — тест невозможен'; end if;

  insert into public.battle_units(battle_id, fid, side, unit_name, cls, x, y,
         hp, max_hp, armor, shield, max_shield, dmg, speed, rng, mitig, reduc, resist, tp, tp_max)
    values (bid,'zz','attacker','ТЕСТ-А','destroyer', 0,0, 9000,9000, 50, 0,0, 100,4,5,
            50,0.5,'{"kinetic":0,"energy":0,"missile":0}'::jsonb, 6,6)
    returning id into a;
  insert into public.battle_units(battle_id, fid, side, unit_name, cls, x, y,
         hp, max_hp, armor, shield, max_shield, dmg, speed, rng, mitig, reduc, resist, tp, tp_max)
    values (bid,'zz','defender','ТЕСТ-Б','destroyer', 1,0, 9000,9000, 50, 400,400, 100,4,5,
            50,0.5,'{"kinetic":0,"energy":0,"missile":0}'::jsonb, 6,6)
    returning id into d;

  -- 1) ДЕБАФФ ЖИВЁТ ВЕСЬ ХОД ЖЕРТВЫ ------------------------------------
  perform public._bt_deb_add(d, 'wbreak', 1);
  select deb into v_deb from public.battle_units where id = d;
  if (v_deb->>'wbreak')::int <> 2 then raise exception 'ПРОВАЛ: дебафф повешен без запаса: %', v_deb; end if;
  perform public._bt_tp_refresh(bid, 'defender');          -- начался ход жертвы
  select deb into v_deb from public.battle_units where id = d;
  if not public._bt_deb_has(v_deb,'wbreak') then
    raise exception 'ПРОВАЛ: дебафф снялся ДО хода жертвы — весь смысл потерян: %', v_deb;
  end if;
  perform public._bt_tp_refresh(bid, 'defender');          -- следующий её ход
  select deb into v_deb from public.battle_units where id = d;
  if public._bt_deb_has(v_deb,'wbreak') then raise exception 'ПРОВАЛ: дебафф завис навсегда: %', v_deb; end if;
  raise notice 'OK 1/6: дебафф отрабатывает ровно один ход жертвы';

  -- 2) ТАРАН ИДЁТ СКВОЗЬ ЩИТ -------------------------------------------
  select shield into sh0 from public.battle_units where id = d;
  hit := public._bt_hit(d, 3000, 'kinetic', '[]'::jsonb, true);
  if (select shield from public.battle_units where id = d) <> sh0 then
    raise exception 'ПРОВАЛ: таран сожрал щит, а должен пройти мимо него';
  end if;
  if (hit->>'hull')::numeric <= 0 then raise exception 'ПРОВАЛ: таран не нанёс урона корпусу'; end if;
  raise notice 'OK 2/6: таран пробивает щит (поле цело, корпус просел)';

  -- 3) БРОНЕВОЙ ЗАМОК РЕЖЕТ УРОН ---------------------------------------
  update public.battle_units set hard = 0, shield = 0, hp = 9000 where id = d;
  hit := public._bt_hit(d, 4000, 'kinetic', '[]'::jsonb);
  hp0 := (hit->>'hull')::numeric;
  update public.battle_units set hard = 0.5, hp = 9000 where id = d;
  hit := public._bt_hit(d, 4000, 'kinetic', '[]'::jsonb);
  if (hit->>'hull')::numeric >= hp0 then
    raise exception 'ПРОВАЛ: броневой замок не снизил урон (% против %)', hit->>'hull', hp0;
  end if;
  raise notice 'OK 3/6: броневой замок режет входящий урон (% → %)', hp0, hit->>'hull';

  -- 4) ЗОНТИК ПРО РЕЖЕТ РАКЕТЫ -----------------------------------------
  update public.battle_units set hard = 0, pdb = 0, hp = 9000, shield = 0 where id = d;
  hit := public._bt_hit(d, 4000, 'missile', '[]'::jsonb);
  hp0 := (hit->>'hull')::numeric;
  update public.battle_units set pdb = 0.5, hp = 9000 where id = d;
  hit := public._bt_hit(d, 4000, 'missile', '[]'::jsonb);
  if (hit->>'hull')::numeric >= hp0 then
    raise exception 'ПРОВАЛ: противоракетный зонт не сработал (% против %)', hit->>'hull', hp0;
  end if;
  raise notice 'OK 4/6: противоракетные лазеры срезают ракетный урон (% → %)', hp0, hit->>'hull';

  -- 5) ИССУШИТЕЛЬ ОТНИМАЕТ СЕКУНДЫ У СЛЕДУЮЩЕГО ПУЛА --------------------
  update public.battle_units set drain = 2 where id = d;
  perform public._bt_tp_refresh(bid, 'defender');
  if (select tp from public.battle_units where id = d) >= (select tp_max from public.battle_units where id = d) then
    raise exception 'ПРОВАЛ: иссушитель не срезал пул';
  end if;
  if (select drain from public.battle_units where id = d) <> 0 then
    raise exception 'ПРОВАЛ: иссушитель не разрядился и будет резать пул вечно';
  end if;
  raise notice 'OK 5/6: иссушитель снял секунды один раз и разрядился';

  -- 6) СКРЕМБЛЕР ВОЗВРАЩАЕТ СЕНСОР -------------------------------------
  update public.battle_units set sensor = 12, blind = 0 where id = d;
  update public.battle_units set sensor = sensor - 5, blind = blind + 5 where id = d;
  perform public._bt_tp_refresh(bid, 'defender');
  if (select sensor from public.battle_units where id = d) <> 12 then
    raise exception 'ПРОВАЛ: сенсор не вернулся после скремблера: %',
      (select sensor from public.battle_units where id = d);
  end if;
  raise notice 'OK 6/6: скремблер возвращает ровно столько сенсора, сколько снял';

  raise exception 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ — откатываю тестовые данные (это не ошибка)';
end$t$;
