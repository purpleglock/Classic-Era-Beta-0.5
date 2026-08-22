-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 26: БОЙ, В КОТОРОМ УЖЕ НИКОГО НЕТ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_board_pace.sql. Надмножество `angel_host_muster`,
-- `angel_guard_muster` и `_angel_grip_sweep`. ⚠️ Конец боёв ВОИНСТВА (не тела)
-- вести отсюда.
--
-- ЖАЛОБА: «бой против флотов ангела завис», Спящие фронтиры.
--
-- ЧТО НАШЛОСЬ В ЖИВОЙ БАЗЕ (бой 4e5f806f, заведён 21.08 18:43; к 22.08 — 83
-- полухода и четыре строки лога за сутки):
--   • доска стоит в sys_mpvehi15 «Спящие фронтиры», а флот защитника
--     ОФАНИМ-БЕТА — в sys_mr4pko8s, в гнезде. Он ушёл из системы, НЕ выйдя
--     из боя. Доска осталась с призраком: убивать некого, терять нечего,
--     кончиться нечем;
--   • обе стороны исчерпали бюджет ходов (att_turns_left = def_turns_left = 0),
--     а общая дверь `_bt_check_end` лимит ходов не считает — он снят из неё
--     сознательно (_battle_finish_fix.sql). Значит и по ходам конца нет;
--   • сторож `_angel_grip_sweep` эту доску не смотрит вовсе: с шага 14 он
--     берёт только те, где СТОИТ КОВЧЕГ (`_angel_ark_bt is not null`). Решение
--     верное — стражу держать боем можно, — но вместе с получасовыми часами
--     из-под досок воинства уехало ВСЁ: и стена по часам, и лимит ходов, и
--     прожатие просроченного хода;
--   • крыло из-за этого выбыло и из кампании: `_angel_host_orders` пропускает
--     флот, скованный боем, — а бой не кончится никогда.
--
-- ПОЧЕМУ КРЫЛО ОКАЗАЛОСЬ НЕ ТАМ, ГДЕ ДЕРЁТСЯ. `angel_host_muster` сажает
-- флоты эскорта в систему тела одной строкой:
--     update fleets set composition = comp, status = 'idle', system_id = here
-- Ни слова про бой. Триггер `battle_lock_fleet` этого не ловит и поймать не
-- может: он стережёт переход idle → transit, а здесь телепорт — system_id
-- меняется на месте, не выходя из 'idle'. Тот же телепорт в `angel_guard_muster`
-- (там — сразу в `home_sys`). Сбор зовётся при каждом накате шага (в конце
-- _angel_host.sql и _angel_board_pace.sql) — и накат 22.08 утром выдернул
-- дерущееся крыло к гнезду, пока ковчег был в прыжке (`here` = home_sys).
--
-- ⚠️ ЗАБРАКОВАНО: запрещать смену system_id триггером у всех. Флот двигают
-- десятки дверей (посадка, роспуск, админский перенос, конец боя), и общий
-- запрет посреди боя сломал бы их разом ради одного кризиса. Чиним ту дверь,
-- через которую прошли, и ставим сеть на случай, если найдётся вторая.
--
-- ТРИ СЛОЯ ЛЕЧЕНИЯ:
--   1) СБОР НЕ ТРОГАЕТ ДЕРУЩИХСЯ. Флот, скованный боем, сбор обходит целиком:
--      ни места, ни состава. Соберётся, когда отгремит.
--   2) ПРИЗРАЧНАЯ ДОСКА ЗАКРЫВАЕТСЯ САМА. Никого из воинства нет в системе
--      боя → бой разводится без победителя, потери по доске записываются,
--      флоты расковываются. Это ровно правило 5.0 «ЕГО ТАМ НЕТ» для тела,
--      только считанное по флотам крыла, а не по ковчегу.
--   3) У ДОСКИ ВОИНСТВА ЕСТЬ ДНО. Ходы кончились или двое суток прошли —
--      развод. Просроченный ход живой стороны жмёт сервер: напротив машина,
--      у неё нет ни сессии, ни кнопки «прожать ход», и без этого ушедший в
--      офлайн игрок морозит крыло навсегда.
--
-- ⚠️ ЧАСЫ НЕ РЕЖЕМ. Получасовой ход (turn_min) придуман против того, что
-- ковчег нельзя держать боем. Стражу держать боем МОЖНО — её для того и
-- выбивают, — поэтому у крыла остаётся обычный суточный ход.
-- ════════════════════════════════════════════════════════════

-- ── 1. СБОР ЭСКОРТА: ДЕРУЩИЙСЯ ФЛОТ НЕ ТРОГАЕМ ──────────────
-- Надмножество _angel_host.sql (шаг 2). Вставок две: обход посадки и счётчик.
create or replace function public.angel_host_muster()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; app record; ecoown uuid; nf int; np int; i int; j int;
        uid uuid; flid uuid; comp jsonb; made int := 0; here text; nm text;
        busy int := 0;
        wing text[] := array['ОФАНИМ-АЛЬФА','ОФАНИМ-БЕТА','ОФАНИМ-ГАММА'];
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false, 'why', 'ангела нет'); end if;
  select * into app from public.faction_applications
   where faction_id = a.faction_id and status = 'approved' order by updated_at desc limit 1;
  select owner_id into ecoown from public.faction_economy where faction_id = a.faction_id;
  select coalesce(f.system_id, a.home_sys) into here
    from public.fleets f where f.id = a.fleet_id;
  nf := greatest(1, public._angel_host_const('fleets')::int);
  np := greatest(1, public._angel_host_const('per')::int);

  for i in 1..nf loop
    -- Флот эскорта заводим один раз: дальше он живёт и убывает.
    select g.fleet_id into flid from public.angel_guard g
     where g.role = 'escort' and g.ord / 10 = i and g.fleet_id is not null limit 1;
    if flid is not null and not exists(select 1 from public.fleets where id = flid) then flid := null; end if;

    -- ⚠️ ВСТАВКА ШАГА 26. Крыло в бою пересобирать НЕЛЬЗЯ: строка посадки
    -- меняет system_id на месте, мимо `battle_lock_fleet`, и доска остаётся
    -- с призраком. Состав тоже не трогаем: сбитых на доске ведёт триггер
    -- `_angel_guard_fell`, а сбор собрал бы их обратно.
    if flid is not null and public._fleet_in_battle(flid) is not null then
      busy := busy + 1; continue;
    end if;

    if flid is null then
      insert into public.fleets(faction_id, owner_id, name, status, system_id, home_sys,
                                composition, is_station, fuel, fuel_cap)
        values (a.faction_id, ecoown, coalesce(wing[i], 'ОФАНИМ-' || i), 'idle', here, a.home_sys,
                '[]'::jsonb, false, 99, 99)
        returning id into flid;
    end if;

    comp := '[]'::jsonb;
    for j in 1..np loop
      uid := ('a0000000-0000-4000-8000-e261f549bb' || lpad((i*10 + j)::text, 2, '0'))::uuid;
      nm  := 'Офаним ' || i || '-' || j;
      if exists(select 1 from public.angel_guard g where g.unit_id = uid and g.dead_at is not null) then
        continue;                                   -- сбитого не воскрешаем
      end if;

      insert into public.faction_units(id, category, name, faction_id, faction_name,
                                       faction_color, owner_id, summary, data, card_text)
        values (uid, 'ship', nm, a.faction_id, coalesce(app.name, 'Престол'),
                coalesce(app.color, '#e6d38f'), ecoown,
                jsonb_build_object(
                  'hp',    public._angel_host_const('hp'),
                  'armor', public._angel_host_const('armor'),
                  'dmg',   public._angel_host_const('dmg'),
                  'rng',   public._angel_host_const('rng'),
                  'speed', public._angel_host_const('speed'),
                  'radar', 16,
                  'armor_resist', jsonb_build_object(
                    'kinetic', public._angel_host_const('resist'),
                    'energy',  public._angel_host_const('resist'),
                    'missile', public._angel_host_const('resist'))),
                jsonb_build_object('class', 'battleship', 'angel_guard', true,
                                   'layout', jsonb_build_object('mounts', '[]'::jsonb),
                                   'weapons', '[]'::jsonb, 'modules', '[]'::jsonb),
                'Колесо без обода и без глаз. Оно идёт следом и не отстаёт.')
        on conflict (id) do update
          set name = excluded.name, faction_id = excluded.faction_id,
              summary = excluded.summary, data = excluded.data;

      begin
        insert into public.bt_bot_exclude(unit_id, why) values (uid, 'эскорт Престола')
          on conflict (unit_id) do nothing;
      exception when others then null; end;

      insert into public.angel_guard(unit_id, faction_id, fleet_id, name, ord, role)
        values (uid, a.faction_id, flid, nm, i*10 + j, 'escort')
        on conflict (unit_id) do update set fleet_id = excluded.fleet_id, name = excluded.name,
                                            role = 'escort';
      comp := comp || jsonb_build_array(jsonb_build_object('unit_id', uid, 'qty', 1));
      made := made + 1;
    end loop;

    if jsonb_array_length(comp) > 0 then
      update public.fleets set composition = comp, status = 'idle', system_id = here
       where id = flid and public._fleet_in_battle(flid) is null;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'made', made, 'busy', busy,
    'escort', (select count(*) from public.angel_guard where role='escort' and dead_at is null),
    'wall',   public._angel_guard_left());
end$$;
revoke all on function public.angel_host_muster() from public, anon;

-- ── 2. СБОР СТРАЖИ: ТО ЖЕ САМОЕ ─────────────────────────────
-- Надмножество _angel_guard.sql (шаг 2). Стража сидит в гнезде, но выйти
-- навстречу она может (`angel_engage`) — и тогда её тоже нельзя пересобирать.
create or replace function public.angel_guard_muster()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; app record; ecoown uuid; n int; i int; uid uuid; flid uuid;
        made int := 0; comp jsonb := '[]'::jsonb; nm text;
        ord_nm text[] := array['Первый','Второй','Третий','Четвёртый','Пятый'];
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false, 'why', 'ангела нет'); end if;
  select * into app from public.faction_applications
   where faction_id = a.faction_id and status = 'approved' order by updated_at desc limit 1;
  select owner_id into ecoown from public.faction_economy where faction_id = a.faction_id;
  n := greatest(1, public._angel_guard_const('n')::int);

  -- Флот стражи: один на всех, стоит в гнезде и никуда не ходит.
  -- ⚠️ ПРАВКА ШАГА 26: `and g.role = 'wall'`. Раньше строка брала ЛЮБУЮ запись
  -- реестра (`limit 1` без порядка), а с шага 22 там лежат и крылья — то есть
  -- сбор стражи мог подцепить флот ОФАНИМ-*, переписать ему состав херувимами
  -- и увести в гнездо. Та же болезнь, что и весь этот шаг.
  select g.fleet_id into flid from public.angel_guard g
   where g.faction_id = a.faction_id and g.role = 'wall' and g.fleet_id is not null limit 1;
  if flid is not null and not exists(select 1 from public.fleets where id = flid) then flid := null; end if;

  -- ⚠️ ВСТАВКА ШАГА 26: см. п.1.
  if flid is not null and public._fleet_in_battle(flid) is not null then
    return jsonb_build_object('ok', true, 'busy', true, 'fleet', flid,
                              'left', public._angel_guard_left());
  end if;

  if flid is null then
    insert into public.fleets(faction_id, owner_id, name, status, system_id, home_sys,
                              composition, is_station, fuel, fuel_cap)
      values (a.faction_id, ecoown, 'СТРАЖА', 'idle', a.home_sys, a.home_sys,
              '[]'::jsonb, false, 99, 99)
      returning id into flid;
  end if;

  for i in 1..n loop
    uid := ('a0000000-0000-4000-8000-e261f549aa0' || i)::uuid;
    nm  := 'Херувим. ' || coalesce(ord_nm[i], i::text);
    -- Убитого не собираем заново: строка осталась, dead_at стоит.
    if exists(select 1 from public.angel_guard g where g.unit_id = uid and g.dead_at is not null) then
      continue;
    end if;

    insert into public.faction_units(id, category, name, faction_id, faction_name,
                                     faction_color, owner_id, summary, data, card_text)
      values (uid, 'ship', nm, a.faction_id, coalesce(app.name, 'Престол'),
              coalesce(app.color, '#e6d38f'), ecoown,
              jsonb_build_object(
                'hp',    public._angel_guard_const('hp'),
                'armor', public._angel_guard_const('armor'),
                'dmg',   public._angel_guard_const('dmg'),
                'rng',   public._angel_guard_const('rng'),
                'speed', public._angel_guard_const('speed'),
                'radar', 18,
                'armor_resist', jsonb_build_object(
                  'kinetic', public._angel_guard_const('resist'),
                  'energy',  public._angel_guard_const('resist'),
                  'missile', public._angel_guard_const('resist'))),
              jsonb_build_object('class', 'dreadnought', 'angel_guard', true,
                                 'layout', jsonb_build_object('mounts', '[]'::jsonb),
                                 'weapons', '[]'::jsonb, 'modules', '[]'::jsonb),
              'Оно сделало их по своему подобию и оставило у порога.')
      on conflict (id) do update
        set name = excluded.name, faction_id = excluded.faction_id,
            summary = excluded.summary, data = excluded.data;

    -- Из драфта ботов исключаем: это не каталожный борт, а часть кризиса.
    begin
      insert into public.bt_bot_exclude(unit_id, why) values (uid, 'стража Престола')
        on conflict (unit_id) do nothing;
    exception when others then null; end;

    insert into public.angel_guard(unit_id, faction_id, fleet_id, name, ord)
      values (uid, a.faction_id, flid, nm, i)
      on conflict (unit_id) do update set fleet_id = excluded.fleet_id, name = excluded.name;
    made := made + 1;
    comp := comp || jsonb_build_array(jsonb_build_object('unit_id', uid, 'qty', 1));
  end loop;

  if jsonb_array_length(comp) > 0 then
    update public.fleets set composition = comp, system_id = a.home_sys,
                             status = 'idle', dest_sys = null, from_sys = null
     where id = flid and public._fleet_in_battle(flid) is null;
  end if;

  return jsonb_build_object('ok', true, 'fleet', flid, 'made', made,
                            'left', public._angel_guard_left());
end$$;
revoke all on function public.angel_guard_muster() from public, anon;

-- ── 3. РАЗВОД ДОСКИ ВОИНСТВА ────────────────────────────────
-- Слепок `_angel_slip` для доски БЕЗ ковчега. Отличий три:
--   • борта воинства с доски НЕ снимаем: они смертны, и убитых уже записал
--     триггер `_angel_guard_fell` — здесь только вычёркиваем их из состава;
--   • ковчег не трогаем вовсе: он может драться в другой системе, и утащить
--     его отсюда — та же беда, из-за которой всё и завязалось;
--   • уходит крыло: у него всегда есть куда — к телу, иначе в гнездо.
create or replace function public._angel_wing_slip(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; af text; foe text; sysname text; r record; f record; w record;
        a record; comp jsonb; e jsonb; newc jsonb; q int; loss int; dead int := 0;
        dest text; gone jsonb := null; sent int := 0;
begin
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
end$$;
revoke all on function public._angel_wing_slip(uuid) from public;

-- ── 4. ОБХОД: ТЕПЕРЬ И ДОСКИ ВОИНСТВА ───────────────────────
-- Надмножество шага 14 (_angel_guard.sql). Первый цикл — слово в слово, он
-- про ковчег. Второй — новый, про крылья и стражу, и правила у него мягче:
-- держать их боем МОЖНО, нельзя только держать вечно и в пустоте.
create or replace function public._angel_grip_sweep()
returns jsonb language plpgsql security definer set search_path=public as $$
declare af text; fsys text; fst text; b record; sd text; foe text;
        spent int; over int := 0; slipped int := 0; forced int := 0;
        clamped int := 0; ghost int := 0; waived int := 0;
        wghost int := 0; wover int := 0; wslip int := 0; wforced int := 0;
        cap int; lim interval; frm interval; tmin int;
        wcap int; wlim interval;
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
  -- Дно доски воинства — вдвое дальше, чем у тела: его и надо выбивать долго.
  wcap := cap * 2;
  wlim := lim * 2;

  -- ── ДОСКИ ТЕЛА ────────────────────────────────────────────
  for b in select * from public.battles
            where status <> 'done' and (attacker_fid = af or defender_fid = af)
              and public._angel_ark_bt(id) is not null
  loop
    -- 5.0 ЕГО ТАМ НЕТ — сильнее любого пропуска.
    if coalesce(fst,'') <> 'idle' or fsys is null or fsys is distinct from b.system_id then
      begin perform public._angel_slip(b.id); ghost := ghost + 1;
      exception when others then null; end;
      continue;
    end if;

    -- 5.0.1 ПРОПУСК: этот бой живёт по старым правилам доски.
    foe := case when b.attacker_fid = af then b.defender_fid else b.attacker_fid end;
    if public._angel_waived(foe) then waived := waived + 1; continue; end if;

    -- 5.1 ХОДЫ КОНЧИЛИСЬ.
    spent := coalesce(b.turn_no, 0);
    if b.status = 'active'
       and (spent >= cap
            or coalesce(b.att_turns_left, 1) <= 0
            or coalesce(b.def_turns_left, 1) <= 0) then
      begin perform public._angel_slip(b.id); over := over + 1;
      exception when others then null; end;
      continue;
    end if;

    -- 5.2 СТЕНА ПО ЧАСАМ.
    if now() - b.created_at > lim
       or (b.status = 'forming' and now() - b.created_at > frm) then
      begin perform public._angel_slip(b.id); slipped := slipped + 1;
      exception when others then null; end;
      continue;
    end if;

    -- 5.3 ЧАСЫ.
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

  -- ── ДОСКИ ВОИНСТВА ────────────────────────────────────────
  for b in select * from public.battles
            where status <> 'done' and (attacker_fid = af or defender_fid = af)
              and public._angel_ark_bt(id) is null
  loop
    -- 6.-1 СНАЧАЛА ОБЫЧНЫЙ КОНЕЦ. Если доска уже выбита, победа принадлежит
    -- тому, кто её выбил, — с флагом и оккупацией. Развод без победителя
    -- ниже по тексту не должен отнимать честно взятый бой.
    if b.status = 'active' then
      begin perform public._bt_check_end(b.id); exception when others then null; end;
      select * into b from public.battles where id = b.id;
      if b.status = 'done' then continue; end if;
    end if;

    -- 6.0 ИХ ТАМ НЕТ. Ни один флот воинства из этого боя не стоит в системе
    -- боя (увели сбором, распустили, потеряли) — доска призрачная.
    -- ⚠️ Только по ИДУЩЕМУ бою: 'forming' бывает и перехватом на подлёте, там
    -- флота в системе ещё нет законно. Зависшую расстановку снимает 6.2.
    if b.status = 'active'
       and not exists (select 1 from public.battle_fleets bf
                     join public.fleets fl on fl.id = bf.fleet_id
                    where bf.battle_id = b.id and bf.fid = af
                      and fl.status = 'idle'
                      and fl.system_id is not distinct from b.system_id) then
      begin perform public._angel_wing_slip(b.id); wghost := wghost + 1;
      exception when others then null; end;
      continue;
    end if;

    -- 6.1 ХОДЫ КОНЧИЛИСЬ. Считаем по turn_no; счётчики сторон — страховка.
    spent := coalesce(b.turn_no, 0);
    if b.status = 'active'
       and (spent >= wcap
            or coalesce(b.att_turns_left, 1) <= 0
            or coalesce(b.def_turns_left, 1) <= 0) then
      begin perform public._angel_wing_slip(b.id); wover := wover + 1;
      exception when others then null; end;
      continue;
    end if;

    -- 6.2 СТЕНА ПО ЧАСАМ.
    if now() - b.created_at > wlim
       or (b.status = 'forming' and now() - b.created_at > frm) then
      begin perform public._angel_wing_slip(b.id); wslip := wslip + 1;
      exception when others then null; end;
      continue;
    end if;

    -- 6.3 ПРОСРОЧЕННЫЙ ХОД ЖИВОЙ СТОРОНЫ. Часы НЕ режем (см. шапку) — но
    -- прожать сгоревший ход некому: напротив машина без сессии и без кнопки.
    if b.status = 'active' and b.side_to_move is not null then
      sd := case when b.attacker_fid = af then 'attacker' else 'defender' end;
      if b.side_to_move <> sd and b.deadline_at is not null and b.deadline_at <= now() then
        begin
          if public._angel_force_turn(b.id) then wforced := wforced + 1; end if;
        exception when others then null; end;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'over', over, 'slipped', slipped,
                            'ghost', ghost, 'forced', forced, 'clamped', clamped,
                            'waived', waived,
                            'wing', jsonb_build_object('ghost', wghost, 'over', wover,
                                                       'slipped', wslip, 'forced', wforced));
end$$;
revoke all on function public._angel_grip_sweep() from public;

notify pgrst, 'reload schema';

-- ── 5. РАЗБОР ТОГО, ЧТО УЖЕ ЗАВИСЛО ─────────────────────────
do $$
declare r jsonb;
begin
  begin
    r := public._angel_grip_sweep();
    raise notice 'обход: %', r;
  exception when others then raise notice 'обход не прошёл: %', sqlerrm;
  end;
end$$;

-- ── ПРОВЕРКА ────────────────────────────────────────────────
-- 1) Зависший бой в «Спящих фронтирах» закрыт: status='done', winner_fid null,
--    флот игрока расскован (_fleet_in_battle → null), ОФАНИМ-БЕТА снова ходит
--    по приказам (_angel_host_orders его больше не пропускает).
-- 2) `select angel_host_muster()` во время боя крыла → в ответе 'busy' ≥ 1,
--    а system_id дерущегося флота НЕ изменился.
-- 3) Свежий бой с крылом идёт как обычный: сутки на ход, победитель по
--    выбитой доске, оккупация — как в любом бою.
-- 4) Игрок ушёл в офлайн и сжёг ход → следующий обход (раз в 5 минут) жмёт
--    ход за него, доска идёт дальше, а не стоит колом.
