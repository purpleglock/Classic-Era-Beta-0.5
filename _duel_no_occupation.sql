-- Дуэли (бойцовский клуб, тестовые бои с ботом) больше не поднимают флаг
-- оккупации и не пишут новость «💥 Сражение окончено» на всю галактику.
--
-- Причина: _fc_spawn_duel / admin_bot_battle кладут в battles реальный
-- system_id (нужен для рендера), kind='duel'. _bt_finish не различал вид боя
-- и звал _war_occupy_check + _war_news, как для настоящего сражения.
--
-- Порядок: применять после _battle_finish_fix.sql / _fight_club.sql.

create or replace function public._bt_finish(p_battle uuid, p_winner text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare b record; r record; f record; comp jsonb; e jsonb; newc jsonb; q int; loss int;
        sysname text; loser text;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or b.status = 'done' then return; end if;
  loser := case when p_winner = b.attacker_fid then b.defender_fid else b.attacker_fid end;

  -- Потери: по каждому проекту считаем убитых и вычитаем из составов
  -- скованных флотов (по порядку, пока не спишем всё).
  for r in select fid, unit_id, count(*) as dead
             from public.battle_units
            where battle_id = p_battle and not alive and unit_id is not null
            group by 1,2
  loop
    loss := r.dead;
    for f in select bf.fleet_id from public.battle_fleets bf
              where bf.battle_id = p_battle and bf.fid = r.fid
    loop
      exit when loss <= 0;
      select composition into comp from public.fleets where id = f.fleet_id for update;
      newc := '[]'::jsonb;
      for e in select value from jsonb_array_elements(coalesce(comp,'[]'::jsonb)) loop
        if (e->>'unit_id')::uuid = r.unit_id and loss > 0 then
          q := greatest(0, coalesce((e->>'qty')::int,0));
          if q <= loss then loss := loss - q; q := 0;
          else q := q - loss; loss := 0; end if;
          if q > 0 then newc := newc || jsonb_build_array(jsonb_set(e, array['qty'], to_jsonb(q), true)); end if;
        else
          newc := newc || jsonb_build_array(e);
        end if;
      end loop;
      update public.fleets set composition = newc where id = f.fleet_id;
    end loop;
  end loop;

  -- Флоты, оставшиеся без кораблей, распускаем; прочие — расковываем.
  -- алиас не должен совпадать с record-переменной f (42703: record "f" has no field "id")
  delete from public.fleets fl
   where fl.id in (select fleet_id from public.battle_fleets where battle_id = p_battle)
     and coalesce((select sum(greatest(0, coalesce((c->>'qty')::int,0)))
                   from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c), 0) = 0;

  update public.battles
     set status = 'done', winner_fid = p_winner, ended_at = now(), side_to_move = null
   where id = p_battle;

  -- Дуэль — это шоу, а не война: ни флага, ни галактической сводки.
  if b.kind = 'duel' then return; end if;

  -- Победитель остался хозяином положения: пробуем поднять флаг (срез 2
  -- сам решит, оккупация это или своя же система).
  begin
    perform public._war_occupy_check(p_winner, b.system_id, null);
  exception when undefined_function then null; end;

  select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = b.system_id;
  perform public._war_news(
    '💥 Сражение окончено: ' || sysname,
    public._news_pick(array[
      format('Бой в системе %s выигран державой %s. Обломки флота %s остывают на орбите.',
             sysname, public._war_nm(p_winner), public._war_nm(loser)),
      format('%s удерживает %s: флот %s разбит и отброшен.',
             public._war_nm(p_winner), sysname, public._war_nm(loser)),
      format('Сражение за %s кончилось победой %s. %s считает потери.',
             sysname, public._war_nm(p_winner), public._war_nm(loser))
    ]),
    jsonb_build_array(p_winner, loser));
end$function$;

-- Подчистить флаги, поднятые прошлыми дуэлями.
delete from public.system_occupation o
 where exists (select 1 from public.battles b
                where b.kind = 'duel' and b.system_id = o.system_id
                  and b.winner_fid = o.occupier_fid);

-- Проверка:
-- 1) Тестовый бой с ботом / дуэль клуба до конца → в «Оповещениях» нет
--    «💥 Сражение окончено», на карте нет чужого флага.
-- 2) Обычный бой (kind='meeting'/'intercept') — новость и флаг на месте.
