-- ============================================================
-- АНГЕЛЬСКИЙ СВИП НЕ ТРОГАЕТ ПЕСОЧНИЦУ (бой с ботами, арена клуба)
-- ?v=20260828nosandbox
--
-- БЫЛО: тестовый бой с ботами закрывался сам через минуту — «БОЙ НЕ ИДЁТ»,
-- а на ходу игрока прилетало «canceling statement due to lock timeout».
-- Замер: бой 5da3b262 создан 18:09:55, начат 18:10:41, закрыт 18:11:00.343
-- (angel-ai-tick, расписание 1-59/5) со status='done' и winner_fid=NULL —
-- почерк _angel_wing_slip. Обе стороны при этом были ЖИВЫ (8 против 10).
--
-- ПРИЧИНА: держава-ангел — это не безличный кризис, а КОНКРЕТНАЯ держава
-- (_angel_fid() = fac_0fd51aa92b), и её владелец продолжает играть. Свип
-- _angel_grip_sweep разбирает ВСЕ бои, где эта держава сторона, и правило 6.0
-- («ни одного флота воинства не стоит в системе боя — доска призрачная»)
-- честно срабатывало на админском бое с ботами: настоящего флота там нет и
-- быть не должно. Доска закрывалась без победителя. Заодно _angel_slip и
-- _angel_wing_slip держат «battles ... for update» и делают в этой же
-- транзакции разбор потерь и отправку флотов — отсюда и lock timeout у хода.
--
-- СТАЛО: песочница (админский бой с ботами, дуэль клуба, любая доска против
-- машинной стороны 'bot') для ангела не существует. Охранник стоит ПЕРВОЙ
-- строкой — до FOR UPDATE, поэтому строка боя даже не блокируется.
-- Определения ниже сняты с ЖИВОЙ базы (pg_get_functiondef) и отличаются от
-- неё ровно этими врезками — см. tools/_angel_guard_gen.js.
-- ============================================================

create or replace function public._angel_sandbox_bt(p_battle uuid)
returns boolean language sql stable
security definer set search_path to 'public' as $$
  select exists (select 1 from public.admin_bot_duel d
                  where d.one = 1 and d.battle_id = p_battle)
      or exists (select 1 from public.battles b
                  where b.id = p_battle
                    and (b.kind = 'duel'                      -- арена Бойцовского клуба
                      or b.attacker_fid = 'bot'               -- машинная сторона без державы
                      or b.defender_fid = 'bot'));
$$;

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
  -- ⚠️ ПЕСОЧНИЦА НЕ ЕГО ДЕЛО. Держава-ангел — это ЧЬЯ-ТО держава (сейчас
  -- fac_0fd51aa92b), и её владелец так же играет: заводит тестовый бой с
  -- ботами из админки, выходит на арену клуба. Свип ангела видел такую
  -- доску своей, брал строку боя FOR UPDATE и закрывал её без победителя —
  -- игрок получал «БОЙ НЕ ИДЁТ», а пока свип держал строку — «lock timeout».
  if public._angel_sandbox_bt(p_battle) then return jsonb_build_object('ok', true, 'skip', 'песочница'); end if;
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

CREATE OR REPLACE FUNCTION public._angel_wing_slip(p_battle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record; af text; foe text; sysname text; r record; f record; w record;
        a record; comp jsonb; e jsonb; newc jsonb; q int; loss int; dead int := 0;
        dest text; gone jsonb := null; sent int := 0;
begin
  -- ⚠️ ПЕСОЧНИЦА НЕ ЕГО ДЕЛО. Держава-ангел — это ЧЬЯ-ТО держава (сейчас
  -- fac_0fd51aa92b), и её владелец так же играет: заводит тестовый бой с
  -- ботами из админки, выходит на арену клуба. Свип ангела видел такую
  -- доску своей, брал строку боя FOR UPDATE и закрывал её без победителя —
  -- игрок получал «БОЙ НЕ ИДЁТ», а пока свип держал строку — «lock timeout».
  if public._angel_sandbox_bt(p_battle) then return jsonb_build_object('ok', true, 'skip', 'песочница'); end if;
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or b.status = 'done' then return jsonb_build_object('ok', true, 'skip', true); end if;
  af := case when public._angel_is(b.attacker_fid) then b.attacker_fid
             when public._angel_is(b.defender_fid) then b.defender_fid else null end;
  if af is null then return jsonb_build_object('ok', false, 'why', 'ангела в этом бою нет'); end if;
  -- Тело на доске — это не наша дверь: там свои правила и свои проводы.
  if public._angel_ark_bt(p_battle) is not null then return public._angel_slip(p_battle); end if;
  foe := case when b.attacker_fid = af then b.defender_fid else b.attacker_fid end;
  select * into a from public.angel_state where faction_id = af and fell_at is null;

  -- Потери чужой стороны — по доске, как в любом бою.
  for r in select fid, unit_id, count(*) as n
             from public.battle_units
            where battle_id = p_battle and not alive and unit_id is not null
              and fid is distinct from af
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

  -- Потери воинства ведёт angel_guard: сбитого вычёркиваем из состава крыла.
  for f in select bf.fleet_id from public.battle_fleets bf
            where bf.battle_id = p_battle and bf.fid = af
  loop
    update public.fleets fl
       set composition = (select coalesce(jsonb_agg(c), '[]'::jsonb)
                            from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c
                           where not exists (select 1 from public.angel_guard g
                                              where g.unit_id = (c->>'unit_id')::uuid
                                                and g.dead_at is not null))
     where fl.id = f.fleet_id;
  end loop;

  -- Флот, у которого не осталось ни одного корабля, распускаем.
  delete from public.fleets fl
   where fl.id in (select fleet_id from public.battle_fleets where battle_id = p_battle)
     and coalesce((select sum(greatest(0, coalesce((c->>'qty')::int,0)))
                   from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c), 0) = 0;

  -- ⚠️ winner_fid НЕ ставим: победы не было, флага никто не поднимает.
  update public.battles
     set status = 'done', ended_at = now(), side_to_move = null, deadline_at = null
   where id = p_battle;

  select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = b.system_id;
  perform public._angel_tell(foe,
    public._angel_glitch('◈ ' || coalesce(sysname,'?') || ': колёса ушли за горизонт', 0.22),
    public._angel_glitch(
      'Сопровождение перестало отвечать на манёвры и снялось с орбиты, не доведя '
      || 'боя до конца. Уцелевшие возвращаются', 0.16)
    || ' ' || public._angel_scream(11));

  -- ── ОНО ИДЁТ ДАЛЬШЕ ───────────────────────────────────────
  -- В ту же транзакцию: между закрытием боя и следующим тиком стоит
  -- `_war_sweep`, и он успевает завязать новый бой на тех же стоящих флотах.
  for w in select fl.id, fl.system_id from public.fleets fl
            join public.battle_fleets bf on bf.fleet_id = fl.id
           where bf.battle_id = p_battle and bf.fid = af and fl.status = 'idle'
  loop
    dest := null;
    if a.fleet_id is not null then
      select f2.system_id into dest from public.fleets f2 where f2.id = a.fleet_id;
    end if;
    if dest is null then dest := a.home_sys; end if;
    if dest is not null and dest is distinct from w.system_id then
      begin
        gone := public._angel_wing_send(w.id, dest);
        if coalesce((gone->>'ok')::boolean, false) then sent := sent + 1; end if;
      exception when others then null; end;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'battle', p_battle, 'foe', foe,
                            'dead', dead, 'sent', sent, 'left', gone);
end$function$
;

CREATE OR REPLACE FUNCTION public._angel_force_turn(p_battle uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record; nxt text;
begin
  -- ⚠️ ПЕСОЧНИЦА НЕ ЕГО ДЕЛО. Держава-ангел — это ЧЬЯ-ТО держава (сейчас
  -- fac_0fd51aa92b), и её владелец так же играет: заводит тестовый бой с
  -- ботами из админки, выходит на арену клуба. Свип ангела видел такую
  -- доску своей, брал строку боя FOR UPDATE и закрывал её без победителя —
  -- игрок получал «БОЙ НЕ ИДЁТ», а пока свип держал строку — «lock timeout».
  if public._angel_sandbox_bt(p_battle) then return false; end if;
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or b.status <> 'active' or b.side_to_move is null then return false; end if;
  if b.deadline_at is null or b.deadline_at > now() then return false; end if;

  if b.side_to_move = 'attacker' then
    update public.battles set att_turns_left = greatest(0, att_turns_left - 1) where id = p_battle;
  else
    update public.battles set def_turns_left = greatest(0, def_turns_left - 1) where id = p_battle;
  end if;
  begin perform public._bt_env_end(p_battle, b.side_to_move); exception when others then null; end;
  nxt := case when b.side_to_move = 'attacker' then 'defender' else 'attacker' end;
  begin perform public._bt_tp_refresh(p_battle, nxt); exception when others then null; end;
  update public.battles
     set side_to_move = nxt, turn_no = turn_no + 1, acts_left = public._bt_acts(),
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;
  -- ⚠️ Не пишем «ход сгорел по сроку»: это объяснение правила. Пишем то, что
  -- видит наблюдатель.
  perform public._bt_log(p_battle, public._angel_glitch(
    '◈ Оно не стало ждать.', 0.2) || ' ' || public._angel_scream(8));
  begin perform public._bt_check_end(p_battle); exception when others then null; end;
  return true;
end$function$
;

