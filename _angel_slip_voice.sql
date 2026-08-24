-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — РОСПУСК ДОСКИ ГОВОРИТ ГОЛОСОМ, А НЕ ПОМЕХАМИ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_lines.sql. Надмножество живого `_angel_slip`:
-- снято ровно одно — блок глитч-новости, вместо него реплика с отбоем.
-- Вся механика роспуска (потери, состав флотов, уход дальше) не тронута.
-- ⚠️ Файл собран ИЗ ЖИВОГО ОПРЕДЕЛЕНИЯ (`pg_get_functiondef`), а не написан
-- заново: `_angel_slip` переопределяется в семи файлах цепочки, и написанная
-- по памяти копия откатила бы всё, что накатывали после.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._angel_slip(p_battle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record; af text; foe text; sysname text; r record; f record;
        comp jsonb; e jsonb; newc jsonb; q int; loss int; dead int := 0;
        dest text; gone jsonb := null;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or b.status = 'done' then return jsonb_build_object('ok', true, 'skip', true); end if;
  af := case when public._angel_is(b.attacker_fid) then b.attacker_fid
             when public._angel_is(b.defender_fid) then b.defender_fid else null end;
  if af is null then return jsonb_build_object('ok', false, 'why', 'ангела в этом бою нет'); end if;
  foe := case when b.attacker_fid = af then b.defender_fid else b.attacker_fid end;

  -- Борт ангела снимаем с доски: доска кончилась, тело возвращается ковчегу.
  delete from public.battle_units where battle_id = p_battle and fid = af and cls = 'angel';

  -- Потери — только реально погибшие на доске (стража сюда входит).
  for r in select fid, unit_id, count(*) as n
             from public.battle_units
            where battle_id = p_battle and not alive and unit_id is not null
            group by 1,2
  loop
    dead := dead + r.n;
    loss := r.n;
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

  -- Флот, у которого не осталось ни одного корабля, распускаем.
  delete from public.fleets fl
   where fl.id in (select fleet_id from public.battle_fleets where battle_id = p_battle)
     and coalesce((select sum(greatest(0, coalesce((c->>'qty')::int,0)))
                   from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c), 0) = 0;

  -- ⚠️ winner_fid НЕ ставим: победы не было. Флага никто не поднимает.
  update public.battles
     set status = 'done', ended_at = now(), side_to_move = null, deadline_at = null
   where id = p_battle;

  -- ◈ ГОЛОС. Было: глитченая канцелярская фраза НА КАЖДУЮ распущенную доску.
  -- Семь досок за час = семь СЛУЧАЙНО побитых заголовков, а часовая сводка
  -- группирует именно по заголовку — группировка разваливалась, и в беседу
  -- уезжала стена шума. Теперь оно говорит ОДИН раз в полтора часа и своими
  -- словами. sysname больше не нужен: имя системы в реплике не звучит, босс
  -- не диктует координаты.
  perform public._angel_speak('stand_down', 90, foe);

  -- ── ОНО ИДЁТ ДАЛЬШЕ ───────────────────────────────────────
  begin
    if exists(select 1 from public.angel_state s
               where s.faction_id = af and s.stance = 'roost') then
      select case when s.home_sys is distinct from b.system_id then s.home_sys end
        into dest from public.angel_state s where s.faction_id = af;
    end if;
    if dest is null then dest := public._angel_pick_target(); end if;
    if dest is not null and dest is distinct from b.system_id then
      gone := public._angel_send(dest);
    end if;
  exception when others then gone := jsonb_build_object('ok', false, 'why', sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'battle', p_battle, 'foe', foe, 'dead', dead,
                            'left', gone);
end$function$
;
revoke all on function public._angel_slip(uuid) from public;

notify pgrst, 'reload schema';
