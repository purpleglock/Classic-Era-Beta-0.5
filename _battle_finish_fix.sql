-- ═══ Хотфикс: 42703 record "f" has no field "id" при завершении боя ═══
-- Причина: в _bt_finish record-переменная f совпадала с алиасом таблицы
-- в DELETE fleets f — PL/pgSQL подставлял переменную вместо алиаса.
-- Катить поверх _war_battle.sql (переопределяет только _bt_finish).

-- Плюс: убран лимит ходов. Победа только на уничтожение — бой идёт,
-- пока у одной из сторон не останется ни живых кораблей, ни резерва.
create or replace function public._bt_check_end(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $$
declare b record; a_alive int; d_alive int; a_pool int; d_pool int; win text;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status = 'done' then return; end if;

  select count(*) filter (where side='attacker'), count(*) filter (where side='defender')
    into a_alive, d_alive
    from public.battle_units where battle_id = p_battle and alive;

  select coalesce(jsonb_array_length(public.battle_pool(p_battle, b.attacker_fid)),0) into a_pool;
  select coalesce(jsonb_array_length(public.battle_pool(p_battle, b.defender_fid)),0) into d_pool;

  if b.status = 'active' then
    if a_alive = 0 and a_pool = 0 then win := b.defender_fid;
    elsif d_alive = 0 and d_pool = 0 then win := b.attacker_fid;
    end if;
  end if;
  if win is null then return; end if;

  perform public._bt_finish(p_battle, win);
end$$;
revoke all on function public._bt_check_end(uuid) from public;

create or replace function public._bt_finish(p_battle uuid, p_winner text)
returns void language plpgsql security definer set search_path=public as $$
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
end$$;
revoke all on function public._bt_finish(uuid,text) from public;
