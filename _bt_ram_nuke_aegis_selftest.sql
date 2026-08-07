-- ТЕСТ тарана/ядерки/«Эгиды». Завершается намеренной ошибкой → откат,
-- в живой базе не остаётся ничего.  node tools/db_run.js _bt_ram_nuke_aegis_selftest.sql
do $t$
declare bid uuid; a uuid; d uuid; g uuid;
        hp0 numeric; hpg0 numeric; hit jsonb; who uuid;
begin
  select id into bid from public.battles limit 1;
  if bid is null then raise exception 'нет ни одного боя — тест невозможен'; end if;

  insert into public.battle_units(battle_id, fid, side, unit_name, cls, x, y,
         hp, max_hp, armor, shield, max_shield, dmg, speed, rng, mitig, reduc, resist, tp, tp_max)
    values (bid,'zz','attacker','ТЕСТ-А','destroyer', 0,0, 9000,9000, 50, 0,0, 100,4,5,
            50,0.5,'{"kinetic":0.4,"energy":0,"missile":0}'::jsonb, 6,6)
    returning id into a;
  insert into public.battle_units(battle_id, fid, side, unit_name, cls, x, y,
         hp, max_hp, armor, shield, max_shield, dmg, speed, rng, mitig, reduc, resist, tp, tp_max)
    values (bid,'zz','defender','ТЕСТ-Б','destroyer', 1,0, 20000,20000, 3000, 0,0, 100,4,5,
            50,0.5,'{"kinetic":0.4,"energy":0,"missile":0}'::jsonb, 6,6)
    returning id into d;
  insert into public.battle_units(battle_id, fid, side, unit_name, cls, x, y,
         hp, max_hp, armor, shield, max_shield, dmg, speed, rng, mitig, reduc, resist, tp, tp_max)
    values (bid,'zz','defender','ТЕСТ-Г','destroyer', 2,0, 20000,20000, 0, 0,0, 100,4,5,
            50,0.5,'{"kinetic":0,"energy":0,"missile":0}'::jsonb, 6,6)
    returning id into g;

  -- 1) ТАРАН ИДЁТ МИМО БРОНИ И ПОЧТИ МИМО СТОЙКОСТЕЙ ---------------------
  update public.battle_units set hp = 20000 where id = d;
  hit := public._bt_hit(d, 10000, 'kinetic', '[]'::jsonb, false);
  hp0 := (hit->>'hull')::numeric;                      -- обычный удар: −40% и −3000 брони
  update public.battle_units set hp = 20000 where id = d;
  hit := public._bt_hit(d, 10000, 'kinetic', '[]'::jsonb, true);
  if (hit->>'hull')::numeric <= hp0 * 1.5 then
    raise exception 'ПРОВАЛ: пробойка почти не отличается от обычного удара (% против %)',
      hit->>'hull', hp0;
  end if;
  raise notice 'OK 1/4: таран мимо брони и стойкостей (обычный % → таран %)', hp0, hit->>'hull';

  -- 2) «ЭГИДА» ЗАБИРАЕТ УДАР ПО СОСЕДУ ------------------------------------
  update public.battle_units set guard = 2, hard = 0, hp = 20000 where id = g;
  update public.battle_units set hp = 20000 where id = d;
  hit := public._bt_hit(d, 5000, 'kinetic', '[]'::jsonb, false);
  if coalesce((hit->>'guard')::boolean, false) is not true then
    raise exception 'ПРОВАЛ: удар не перенаправлен на гвардейца: %', hit;
  end if;
  if (select hp from public.battle_units where id = d) <> 20000 then
    raise exception 'ПРОВАЛ: прикрытый борт всё равно получил урон';
  end if;
  if (select hp from public.battle_units where id = g) >= 20000 then
    raise exception 'ПРОВАЛ: гвардеец урона не принял';
  end if;
  raise notice 'OK 2/4: «Эгида» приняла удар вместо соседа';

  -- 3) ПОДАВИТЕЛЬ СНИМАЕТ ПРОТОКОЛ ----------------------------------------
  perform public._bt_deb_add(g, 'disrupt', 1);
  update public.battle_units set hp = 20000 where id = d;
  update public.battle_units set hp = 20000 where id = g;
  hit := public._bt_hit(d, 5000, 'kinetic', '[]'::jsonb, false);
  if coalesce((hit->>'guard')::boolean, false) then
    raise exception 'ПРОВАЛ: заглушённый гвардеец продолжает прикрывать — контры нет';
  end if;
  if (select hp from public.battle_units where id = d) >= 20000 then
    raise exception 'ПРОВАЛ: удар не дошёл до цели, хотя гвардеец заглушён';
  end if;
  raise notice 'OK 3/4: ракета-подавитель выключает «Эгиду»';

  -- 4) РАДИУС И НАЧАЛО ХОДА ------------------------------------------------
  update public.battle_units set deb = '{}'::jsonb where id = g;
  update public.battle_units set x = 9, y = 9 where id = d;    -- вне двух гексов
  if public._bt_guard_for(d) is not null then
    raise exception 'ПРОВАЛ: гвардеец прикрывает борт за пределами своего радиуса';
  end if;
  update public.battle_units set x = 1, y = 0 where id = d;
  if public._bt_guard_for(d) is null then raise exception 'ПРОВАЛ: сосед в радиусе не прикрыт'; end if;
  perform public._bt_tp_refresh(bid, 'defender');
  if (select guard from public.battle_units where id = g) <> 0 then
    raise exception 'ПРОВАЛ: «Эгида» не гаснет к своему ходу — она вечная';
  end if;
  raise notice 'OK 4/4: радиус соблюдается, протокол гаснет к своему ходу';

  raise exception 'ВСЕ 4 ПРОВЕРКИ ПРОЙДЕНЫ — откатываю тестовые борта';
end$t$;
