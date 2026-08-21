-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 7: У БОЯ ЕСТЬ КОНЕЦ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: последним в ангельской цепочке — после _angel_ai.sql, но ПЕРЕД
-- _angel_lock.sql (тот раздаёт права заново; здесь заводятся новые функции).
--   node tools/db_run.js _angel_no_grip.sql
--   node tools/db_run.js _angel_lock.sql
-- Идемпотентно. Накат сразу разбирает уже идущие захваты (см. шаг 7).
--
-- ЧТО НАШЁЛ ИГРОК. Ящик корветов, выставляемых по одному, держал «Престол»
-- на месте неделями. Три обычных правила доски, каждое по отдельности
-- разумное, вместе дают стоп-кран:
--   • флот, скованный боем, никуда не летит (триггер battle_lock_fleet), а
--     ковчег — обычная строка в fleets;
--   • лимит ходов снят (_battle_finish_fix.sql): «победа только на
--     уничтожение». Работает, пока обе стороны хотят победить. Против того,
--     кого убить нельзя, «до последнего корабля» значит «навсегда»;
--   • на ход даётся 24 часа (_bt_turn_hours), а прожать просроченный ход
--     может только противник кнопкой. У ангела кнопки нет — у него нет игрока.
-- Резерв (battle_pool) считает корабли ВСЕХ скованных флотов, поэтому тридцать
-- флотов по корвету — это тридцать жизней подряд по суткам каждая.
--
-- ⚠️ ЗАБРАКОВАННОЕ ЛЕЧЕНИЕ №1: списывать за удержание флот целиком. Игрок не
-- жульничал, он пользовался правилами доски. Карать за находку — плохой размен.
--
-- ⚠️ ЗАБРАКОВАННОЕ ЛЕЧЕНИЕ №2 (и это важнее): вывести ковчег из-под триггера,
-- чтобы ангел уходил из боя когда захочет. Так делать НЕЛЬЗЯ. «Этому юниту
-- законы мира не писаны» — рояль в кустах: борт стоит в системе, сцепился с
-- флотом и растворяется, пока доска считает ходы. Заодно это выключает сам
-- бой с ангелом, ради которого писался _angel_battle.sql: поймать его стало бы
-- нельзя в принципе. Общее правило остаётся общим — ковчег сковывается, как
-- любой другой флот.
--
-- ЧТО ЛЕЧИМ НА САМОМ ДЕЛЕ. Не «ангела сковали», а «бой не кончается». У боя
-- с тем, кого нельзя убить, обязан быть конец по другому основанию, чем
-- уничтожение. Три правила:
--   1) ХОДЫ КОНЧАЮТСЯ. turn_cap полуходов на бой — и всё, сражение отгремело.
--      Никто не победил: winner_fid = null, флага никто не поднимает, потери —
--      только погибшие на доске. Резерв больше не продлевает ничего: докидывать
--      корветы бессмысленно, лимит режет и их.
--   2) ЧАСЫ ИДУТ БЫСТРЕЕ. Против ангела на ход даётся turn_min минут, а не
--      сутки, и просроченный ход прожимает сервер сам. Это не поблажка ангелу,
--      а следствие того, что у машинной стороны нет игрока с кнопкой.
--      ⚠️ Лимит ходов НЕ ограничитель удержания, а гарантия, что бой вообще
--      кончится: 20 ходов на сторону — это полноценное сражение, а не
--      формальность. Держать мешают ЧАСЫ (правило 2), а не короткий счётчик.
--   3) СТЕНА ПО ЧАСАМ. grip_h часов — предел на случай, если счётчик ходов
--      кто-то обойдёт (админская доска, чужой накат, зависшее 'forming').
--
-- ⚠️ ЧЕГО ЗДЕСЬ НЕТ: запрета атаковать ангела, запрета мелких флотов, кары за
-- попытку. Пробовать можно всегда. Печати по-прежнему рвутся только Дланью и
-- Гиперпейсером (_angel_shells.sql), флот против него по-прежнему бесполезен.
--
-- ⚠️ ГОЛОС. Ни одна строка ниже не объясняет игроку правило. «Ходы вышли»,
-- «лимит удержания», «ход сгорел» — это справка, а по правилам _angel_core.sql
-- её не бывает. Пишем событие: стрельба стихла. Причину пусть нащупают.
-- ════════════════════════════════════════════════════════════

-- ── 1. СРОКИ ────────────────────────────────────────────────
-- Своя дверь констант, а НЕ дописывание в _angel_const: тот immutable и
-- переписывается ЦЕЛИКОМ в каждом ангельском файле — ключи отсюда унесло бы
-- первым же повторным накатом _angel_core.sql (ровно так уже терялась ПРО,
-- см. _defense_const_merge.sql).
create or replace function public._angel_grip_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'turn_min'  then 30    -- минут на ход против ангела (вместо 24 часов)
    when 'turn_cap'  then 40    -- полуходов на бой = по 20 ходов стороне
    when 'grip_h'    then 12    -- часов: стена на случай обхода счётчика ходов
    when 'form_h'    then 1     -- часов на «выставиться»: не вышел — не пришёл
    else 0 end
$$;

-- ── 2. ОБЩЕЕ ПРАВИЛО ОСТАЁТСЯ ОБЩИМ ─────────────────────────
-- Дословный возврат _war_intercept.sql и _fleet_settle_restore.sql. Стоит
-- здесь НЕ для красоты: предыдущая редакция этого файла делала ангелу
-- исключение, и без явного возврата оно осталось бы в базе навсегда.
-- ⚠️ Не заводить сюда никаких «кроме ангела». Ковчег скован боем — значит
-- никуда не летит, как любой флот галактики.
create or replace function public._battle_lock_fleet()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if NEW.status = 'transit' and coalesce(OLD.status,'') <> 'transit' then
    if public._fleet_in_battle(NEW.id) is not null then
      raise exception 'флот скован боем — пока сражение не окончено, он никуда не уйдёт';
    end if;
  end if;
  return NEW;
end$$;
drop trigger if exists battle_lock_fleet on public.fleets;
create trigger battle_lock_fleet before update on public.fleets
  for each row execute function public._battle_lock_fleet();

create or replace function public._war_battle_block(p_fid text, p_sys text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare r record; w boolean;
begin
  if p_fid is null or p_sys is null then return false; end if;
  for r in select b.attacker_fid a, b.defender_fid d from public.battles b
            where b.system_id = p_sys and b.status <> 'done'
  loop
    if p_fid in (r.a, r.d) then continue; end if;
    begin select public.at_war(p_fid, r.a) into w;
    exception when undefined_function then w := false; end;
    if coalesce(w, false) then return true; end if;
    begin select public.at_war(p_fid, r.d) into w;
    exception when undefined_function then w := false; end;
    if coalesce(w, false) then return true; end if;
  end loop;
  return false;
end$$;
revoke all on function public._war_battle_block(text,text) from public;

-- ── 3. СРАЖЕНИЕ ОТГРЕМЕЛО ───────────────────────────────────
-- Закрытие боя без победителя. Не _bt_finish: та дверь объявляет победу, а
-- значит поднимает флаг (_war_occupy_check) и пишет «флот разбит и отброшен».
-- Здесь не было ни победы, ни разгрома — стороны разошлись. Из _bt_finish
-- взято дословно ровно две вещи: вычитание погибших из составов и роспуск
-- флотов, оставшихся без кораблей.
create or replace function public._angel_slip(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; af text; foe text; sysname text; r record; f record;
        comp jsonb; e jsonb; newc jsonb; q int; loss int; dead int := 0;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or b.status = 'done' then return jsonb_build_object('ok', true, 'skip', true); end if;
  af := case when public._angel_is(b.attacker_fid) then b.attacker_fid
             when public._angel_is(b.defender_fid) then b.defender_fid else null end;
  if af is null then return jsonb_build_object('ok', false, 'why', 'ангела в этом бою нет'); end if;
  foe := case when b.attacker_fid = af then b.defender_fid else b.attacker_fid end;

  -- Борт ангела снимаем с доски: доска кончилась, тело возвращается ковчегу.
  delete from public.battle_units where battle_id = p_battle and fid = af;

  -- Потери — только реально погибшие на доске.
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
  -- Флоты расковываются самим фактом status='done' (_fleet_in_battle).
  update public.battles
     set status = 'done', ended_at = now(), side_to_move = null, deadline_at = null
   where id = p_battle;

  select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = b.system_id;
  perform public._angel_tell(foe,
    public._angel_glitch('◈ ' || coalesce(sysname,'?') || ': стрельба прекратилась', 0.22),
    public._angel_glitch(
      'Цель перестала отвечать на манёвры и держит орбиту так, будто боя не было. '
      || 'Уцелевшие возвращаются. Что считать итогом, штаб', 0.16)
    || ' ' || public._angel_scream(13));

  return jsonb_build_object('ok', true, 'battle', p_battle, 'foe', foe, 'dead', dead);
end$$;
revoke all on function public._angel_slip(uuid) from public;

-- ── 4. ХОД ПРОЖИМАЕТ СЕРВЕР ─────────────────────────────────
-- Копия battle_force_turn без проверок сессии. Нужна потому, что просроченный
-- ход по общим правилам жмёт ПРОТИВНИК, а с той стороны машина: у неё нет ни
-- сессии, ни кнопки. Без этого «часы идут быстрее» не значит ничего.
create or replace function public._angel_force_turn(p_battle uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare b record; nxt text;
begin
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
end$$;
revoke all on function public._angel_force_turn(uuid) from public;

-- ── 5. ОБХОД БОЁВ АНГЕЛА ────────────────────────────────────
-- Ходы, часы, невышедшие. Зовётся из тика доски (шаг 6) раз в 5 минут — то
-- есть срок хода промахивается максимум на длину тика.
--
-- ⚠️ ПОЧЕМУ СЧЁТ ХОДОВ ЗДЕСЬ, А НЕ В _bt_check_end. Та дверь общая, её
-- переопределяют восемь файлов, и лимит ходов из неё вынули СОЗНАТЕЛЬНО
-- (_battle_finish_fix.sql). Возвращать его всем ради одного кризиса — клоббер
-- чужого решения; считаем ходы только в боях ангела и только отсюда.
create or replace function public._angel_grip_sweep()
returns jsonb language plpgsql security definer set search_path=public as $$
declare af text; fsys text; fst text; b record; sd text;
        spent int; over int := 0; slipped int := 0; forced int := 0;
        clamped int := 0; ghost int := 0;
        cap int; lim interval; frm interval; tmin int;
begin
  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;
  select f.system_id, f.status into fsys, fst
    from public.fleets f
    join public.angel_state a on a.fleet_id = f.id
   where a.faction_id = af;
  cap  := public._angel_grip_const('turn_cap')::int;
  lim  := (public._angel_grip_const('grip_h') || ' hours')::interval;
  frm  := (public._angel_grip_const('form_h') || ' hours')::interval;
  tmin := public._angel_grip_const('turn_min')::int;

  for b in select * from public.battles
            where status <> 'done' and (attacker_fid = af or defender_fid = af)
  loop
    -- 5.0 ЕГО ТАМ НЕТ. Ковчег улетел раньше (админская дверь, отмена боя,
    -- перенос) — доска считала бы ходы телу, которого в системе нет, и
    -- _bt_check_end рано или поздно объявил бы «победу» ни за что.
    if coalesce(fst,'') <> 'idle' or fsys is null or fsys is distinct from b.system_id then
      begin perform public._angel_slip(b.id); ghost := ghost + 1;
      exception when others then null; end;
      continue;
    end if;

    -- 5.1 ХОДЫ КОНЧИЛИСЬ — ГЛАВНОЕ ПРАВИЛО.
    -- Считаем по turn_no (сколько полуходов доска реально сделала), а не по
    -- att/def_turns_left: те переписывают разные слои, и на них полагаться
    -- нельзя. Плюс страховка по обнулённым счётчикам, если их всё же ведут.
    spent := coalesce(b.turn_no, 0);
    if b.status = 'active'
       and (spent >= cap
            or coalesce(b.att_turns_left, 1) <= 0
            or coalesce(b.def_turns_left, 1) <= 0) then
      begin perform public._angel_slip(b.id); over := over + 1;
      exception when others then null; end;
      continue;
    end if;

    -- 5.2 СТЕНА ПО ЧАСАМ. Счётчик ходов кто-то обошёл, либо бой висит в
    -- 'forming' и держит флоты, ни разу не начавшись.
    if now() - b.created_at > lim
       or (b.status = 'forming' and now() - b.created_at > frm) then
      begin perform public._angel_slip(b.id); slipped := slipped + 1;
      exception when others then null; end;
      continue;
    end if;

    -- 5.3 ЧАСЫ. Срок хода живой стороны режем до turn_min, просроченный —
    -- прожимаем. Ход самого ангела не трогаем: его гоняет legion-ai-tick.
    if b.status = 'active' and b.side_to_move is not null then
      sd := case when b.attacker_fid = af then 'attacker' else 'defender' end;
      if b.side_to_move <> sd then
        if b.deadline_at is null or b.deadline_at > now() + (tmin || ' minutes')::interval then
          update public.battles set deadline_at = now() + (tmin || ' minutes')::interval
           where id = b.id;
          clamped := clamped + 1;
        elsif b.deadline_at <= now() then
          begin
            if public._angel_force_turn(b.id) then forced := forced + 1; end if;
          exception when others then null; end;
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'over', over, 'slipped', slipped,
                            'ghost', ghost, 'forced', forced, 'clamped', clamped);
end$$;
revoke all on function public._angel_grip_sweep() from public;

-- ── 6. ТИК ДОСКИ — НАДМНОЖЕСТВО ─────────────────────────────
-- Дословно _angel_battle.sql, плюс обход из шага 5 ПЕРЕД расстановкой:
-- сначала закрываем отгремевшее, потом выставляемся в свежее.
create or replace function public.angel_battle_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; d int := 0; af text; gp jsonb := '{}'::jsonb;
begin
  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;

  begin gp := public._angel_grip_sweep(); exception when others then null; end;

  for b in select id from public.battles
            where status = 'forming' and (attacker_fid = af or defender_fid = af)
  loop
    begin
      if (public.angel_battle_deploy(b.id)->>'ok')::boolean then d := d + 1; end if;
    exception when others then null;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'deployed', d, 'grip', gp);
end$$;
revoke all on function public.angel_battle_tick() from public;

-- ── 6.5 ВОЗВРАТ _angel_send ─────────────────────────────────
-- ⚠️ ГРАБЛИ, НА КОТОРЫЕ Я НАСТУПИЛ: в прошлой редакции этого файла в
-- _angel_send была вписана строка «уходя — снимает бой» (_angel_slip_all).
-- Здесь сначала стояло «_angel_send не трогаем» — и это НЕ РАБОТАЕТ: трогать
-- было уже нечего, оригинал к тому моменту был затёрт этим же файлом, и в базе
-- осталась дверь, снимающая все бои ангела перед каждым вылетом. Бой закрывался
-- за миллисекунду до взлёта, а выглядело это как «бой отменился сам».
-- Отменённая правка требует ЯВНОГО возврата исходника, а не молчания о ней.
--
-- Дословная копия из _angel_ai.sql. Ковчег скован боем — значит стоит и
-- дерётся, как все: триггер поднимет исключение, тик его проглотит, ангел
-- просто пропустит этот заход и попробует в следующий раз.
create or replace function public._angel_send(p_dest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; f record; pth jsonb; sched jsonb; fly numeric; dep timestamptz := now();
        log jsonb;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;
  select * into f from public.fleets where id = a.fleet_id for update;
  if f.id is null then return jsonb_build_object('ok', false, 'why', 'ковчега нет'); end if;
  if f.status <> 'idle' then return jsonb_build_object('ok', true, 'moving', true); end if;
  if p_dest is null or p_dest = f.system_id then return jsonb_build_object('ok', true, 'stay', true); end if;
  if not exists(select 1 from public.map_systems where id = p_dest) then
    return jsonb_build_object('ok', false, 'why', 'нет такой системы');
  end if;

  pth   := public._fleet_path(f.system_id, p_dest);
  fly   := coalesce(public._fleet_fly_hours(f.system_id, p_dest), 2.0);
  sched := case when pth is null then null else public._fleet_schedule(pth, dep) end;

  update public.fleets
     set status='transit', from_sys=system_id, dest_sys=p_dest, system_id=null,
         depart_at=dep, arrive_at=dep + (fly || ' hours')::interval,
         route=pth, route_at=sched, fuel=fuel_cap
   where id = f.id;

  -- память похода: последние 12 систем, чтобы не ходить челноком
  log := coalesce(a.path_log, '[]'::jsonb) || jsonb_build_array(p_dest);
  if jsonb_array_length(log) > 12 then
    log := (select coalesce(jsonb_agg(v), '[]'::jsonb) from (
              select value v, row_number() over () rn
                from jsonb_array_elements(log)) q
             where rn > jsonb_array_length(log) - 12);
  end if;
  update public.angel_state set target_sys = p_dest, path_log = log
   where faction_id = a.faction_id;

  return jsonb_build_object('ok', true, 'act', 'march', 'dest', p_dest, 'fly_h', round(fly,1));
end$$;
revoke all on function public._angel_send(text) from public;

-- ── 7. РУЧНАЯ ДВЕРЬ И РАЗБОР ТОГО, ЧТО ВИСИТ ────────────────
create or replace function public.admin_angel_release()
returns jsonb language plpgsql security definer set search_path=public as $$
declare n int := 0; r record;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  for r in select b.id from public.battles b
            where b.status <> 'done'
              and (b.attacker_fid = public._angel_fid() or b.defender_fid = public._angel_fid())
  loop
    begin perform public._angel_slip(r.id); n := n + 1;
    exception when others then null; end;
  end loop;
  return jsonb_build_object('ok', true, 'battles', n);
end$$;
revoke all on function public.admin_angel_release() from public;
revoke all on function public.admin_angel_release() from anon;
grant execute on function public.admin_angel_release() to authenticated;

-- Прошлая редакция файла успела поднять ангелу флаг над чужой системой через
-- _bt_finish. Снимаем всё, где ковчега в системе нет, и обнуляем «победы»,
-- которых не было. Сводок об освобождении не пишем: события не было.
do $$
declare af text; fsys text; n int;
begin
  af := public._angel_fid();
  if af is null then return; end if;
  select f.system_id into fsys from public.fleets f
    join public.angel_state a on a.fleet_id = f.id where a.faction_id = af;

  with gone as (
    delete from public.system_occupation o
     where o.occupier_fid = af
       and (fsys is null or o.system_id is distinct from fsys)
    returning 1)
  select count(*) into n from gone;
  raise notice 'angel occupations removed: %', n;

  update public.battles set winner_fid = null
   where winner_fid = af and status = 'done'
     and ended_at > now() - interval '6 hours'
     and not exists (select 1 from public.battle_units u
                      where u.battle_id = battles.id and u.fid = af);
end$$;

do $$
declare r jsonb;
begin
  begin
    r := public._angel_grip_sweep();
    raise notice 'angel grip sweep: %', r;
  exception when others then
    raise notice 'angel grip sweep failed: %', sqlerrm;
  end;
end$$;

notify pgrst, 'reload schema';

-- ── ПРОВЕРКА ────────────────────────────────────────────────
-- 1) Ковчег в бою: update fleets set status='transit' where id = ark
--    → «флот скован боем». Правило общее и для него.
-- 2) Свежий бой: deadline_at ≤ 30 минут, не сутки. Не сходил — следующий тик
--    прожимает ход сам, в журнале «Оно не стало ждать».
-- 3) turn_no доходит до 40 → бой status='done', winner_fid = null, оккупации
--    нет, флот игрока цел минус погибшие на доске, ковчег снова волен идти.
--    Потолок удержания = 12 часов стены; ящик корветов не добавляет к нему
--    ни минуты, потому что лимит ходов режет и резерв.
-- 4) Обычные две державы: всё как было — и сковывание, и 24 часа на ход,
--    и «победа только на уничтожение».
