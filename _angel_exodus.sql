-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 34: ИСХОД К ХРАМУ МИРОЗДАНИЯ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_slow_feed.sql. Идемпотентно.
-- Функции ниже пересобраны с ЖИВЫХ определений из базы (pg_get_functiondef),
-- а не с файлов: ангельских файлов 30+, и кто из них лёг последним — знает
-- только база.
--
-- ЗАЧЕМ. Кризис пора закрывать: он свою работу сделал (45 переплавленных
-- миров, 21 929 душ в часах вознесения) и дальше просто перемалывает тех,
-- кто уже перемолот. Но «выключить кризис» апдейтом одной строки — значит
-- отобрать у него смысл задним числом. Поэтому он не выключается, а УХОДИТ:
-- снимается со всех систем, бросает войны, оккупации и недоеденное и идёт
-- одним походом к Храму мироздания. Пока идёт и пока стоит там — не стреляет,
-- не объявляет войн, не ест.
--
-- ⚠️ НЕ «стоп-кран». Каждая враждебная дверь закрыта СВОЕЙ проверкой
-- (`_angel_pilgrim()`), а не одним флагом в тике: тик — не единственный вход,
-- к орудиям и объявлению войны ходят ещё сторож крыльев и доска боя.
--
-- ⚠️ ПЕРЕПЛАВКА ДОВОДИТСЯ ДО КОНЦА, А НЕ ОТМЕНЯЕТСЯ. 18 начатых миров стоят
-- на полпути; бросить их — оставить на карте колонии с population 12, о
-- которых игрок помнит только то, что их ели. `angel_melt_finish` закрывает
-- начатое тем же кодом, что и укус: планета становится переплавленной.
-- Это и запас под следующий шаг — идеальные миры делаются из переплавленных.
-- ────────────────────────────────────────────────────────────

-- ── ХРАМ ────────────────────────────────────────────────────
create or replace function public._angel_temple()
returns text language sql stable set search_path=public as $$
  select coalesce((select id from public.map_systems
                    where name = 'Храм мироздания' limit 1), 'sys_mpvehb4p')
$$;

-- ── ИДЁТ ЛИ ИСХОД ───────────────────────────────────────────
create or replace function public._angel_pilgrim()
returns boolean language sql stable set search_path=public as $$
  select coalesce((select stance = 'pilgrim' from public.angel_state
                    where fell_at is null order by created_at limit 1), false)
$$;

-- ── КРЫЛЬЯ ИДУТ ЗА ТЕЛОМ ────────────────────────────────────
-- Штатное сопровождение сначала растаскивает крылья по оккупированным
-- системам гарнизонами. В походе гарнизонов нет — есть колонна.
create or replace function public._angel_pilgrim_follow()
returns int language plpgsql security definer set search_path=public as $$
declare a record; here text; f record; n int := 0;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.fleet_id is null then return 0; end if;
  select fl.system_id into here from public.fleets fl where fl.id = a.fleet_id;
  if here is null then return 0; end if;          -- тело в пути, крылья ждут

  for f in select fl.id from public.fleets fl
             join public.angel_guard g on g.fleet_id = fl.id and g.dead_at is null
            where fl.system_id is distinct from here
  loop
    if public._fleet_in_battle(f.id) is not null then continue; end if;
    update public.fleets
       set system_id = here, status = 'idle', from_sys = null, dest_sys = null,
           depart_at = null, arrive_at = null, route = null, route_at = null
     where id = f.id;
    n := n + 1;
  end loop;
  return n;
end$$;
revoke all on function public._angel_pilgrim_follow() from public;

-- ── ДОПЛАВИТЬ НАЧАТОЕ ───────────────────────────────────────
-- Тот же исход, что у последнего укуса: колонии нет, планета переплавлена.
-- Отдельной новости на каждый мир НЕ шлём — это одно событие, исход, и оно
-- получает одну строку в сводке.
create or replace function public.angel_melt_finish()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; t record; c record; arr jsonb; newpl jsonb; el jsonb; i int;
        done int := 0; ghosts int := 0; took numeric := 0;
begin
  select * into a from public.angel_state order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;

  for t in select * from public.angel_transmute where done_at is null loop
    select * into c from public.colonies where id = t.colony_id;
    if c.id is null then                       -- колония уже снесена иначе
      update public.angel_transmute set done_at = now() where colony_id = t.colony_id;
      ghosts := ghosts + 1;
      continue;
    end if;

    -- остаток населения уходит в часы: съедено — значит съедено
    took := took + greatest(0, coalesce(c.pop, 0));
    update public.angel_transmute
       set taken = taken + greatest(0, coalesce(c.pop, 0)), last_at = now(), done_at = now()
     where colony_id = t.colony_id;

    if c.planet_pid is not null then
      select coalesce(planets,'[]'::jsonb) into arr from public.map_systems where id = c.system_id;
      newpl := '[]'::jsonb;
      for i in 0 .. coalesce(jsonb_array_length(arr),1)-1 loop
        el := arr->i;
        if (el->>'pid')::int = c.planet_pid then
          el := el || jsonb_build_object(
                 'g','lava', 'kind','planet', 'type','Переплавленный мир',
                 'icon','🪨', 'slotsP', 0, 'slotsK', 0,
                 'resources','[]'::jsonb, 'dead', true,
                 'melted', true, 'melted_by', a.faction_id,
                 'melted_at', to_jsonb(now()));
        end if;
        newpl := newpl || jsonb_build_array(el);
      end loop;
      update public.map_systems set planets = newpl where id = c.system_id;
    end if;

    delete from public.colony_buildings where colony_id = c.id;
    delete from public.colonies where id = c.id;
    done := done + 1;
  end loop;

  if took > 0 then
    update public.angel_state
       set seals = least(public._angel_const('seals_max'),
                         seals + took * public._angel_ph('seal_per_pop')),
           mass  = least(public._angel_ph('mass_cap'),
                         mass + took * public._angel_ph('mass_per_pop'))
     where faction_id = a.faction_id;
  end if;

  return jsonb_build_object('ok', true, 'melted', done, 'ghosts', ghosts,
                            'took', round(took,1));
end$$;
revoke all on function public.angel_melt_finish() from public;

-- ── ИСХОД ───────────────────────────────────────────────────
-- Одна дверь: доплавить, отпустить всё захваченное, встать на курс.
create or replace function public.angel_exodus_begin()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; af text; melt jsonb; occ int; wr int; sal int; nm text;
        tmp text; sent jsonb := '{}'::jsonb;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false, 'why', 'ангела нет'); end if;
  af  := a.faction_id;
  tmp := public._angel_temple();

  -- 1. доплавить начатое — ДО смены стойки, иначе своя же проверка запретит
  melt := public.angel_melt_finish();

  -- 2. курс
  update public.angel_state
     set stance = 'pilgrim', target_sys = tmp, home_sys = tmp
   where faction_id = af;

  -- 3. отпустить занятое
  delete from public.system_occupation where occupier_fid = af;
  get diagnostics occ = row_count;

  -- 4. закрыть войны. Не «победа» и не «поражение» — оно просто ушло.
  update public.wars
     set status = 'status_quo', ended_at = now(),
         outcome_note = 'Исход к Храму мироздания'
   where status = 'active' and (attacker_fid = af or defender_fid = af);
  get diagnostics wr = row_count;

  -- 5. снять свои снаряды с траектории (чужие — летят, это выбор игроков)
  update public.doom_salvos set status = 'lost', resolved_at = now()
   where status = 'in_flight' and faction_id = af;
  get diagnostics sal = row_count;

  -- 6. тронуться
  begin sent := public._angel_send(tmp); exception when others then null; end;
  begin perform public._angel_pilgrim_follow(); exception when others then null; end;

  select coalesce(nullif(name,''), id) into nm from public.map_systems where id = tmp;
  perform public._angel_news(
    '◈ ОНО СНЯЛОСЬ СО ВСЕХ СИСТЕМ',
    'Отметки ушли с орбит одновременно, посреди начатого. Огонь прекращён, '
    || 'оккупационные порядки сняты, войны закрыты без условий и без нот. '
    || 'Вся колонна легла на один курс — к системе «' || coalesce(nm,'?') || '». '
    || 'Что оно намерено делать у Храма мироздания, не сообщается: '
    || 'запросы уходят, ответов нет. Миры, которых оно коснулось, оно доплавило '
    || 'перед уходом — все до одного.');

  return jsonb_build_object('ok', true, 'melt', melt, 'occupations', occ,
    'wars_closed', wr, 'salvos_dropped', sal, 'dest', tmp, 'march', sent);
end$$;
revoke all on function public.angel_exodus_begin() from public;

create or replace function public.admin_angel_exodus()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  return public.angel_exodus_begin();
end$$;
revoke all on function public.admin_angel_exodus() from public;
grant execute on function public.admin_angel_exodus() to authenticated;

-- ── ЗАКРЫТЫЕ ДВЕРИ ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._angel_transmute()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a record; f record; c record; t record; take numeric; seal numeric; ms numeric;
        started int := 0; bites int := 0; eaten int := 0; sysname text;
        arr jsonb; newpl jsonb; el jsonb; i int; onm text;
        mul numeric; hrs numeric;
begin
  -- ⟨ИСХОД⟩ переплавка кончилась вместе с походом.
  if public._angel_pilgrim() then return jsonb_build_object('ok', true, 'why', 'исход'); end if;
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null or coalesce(a.phase,1) < 2 then
    return jsonb_build_object('ok', true, 'why', 'не та фаза');
  end if;
  hrs := public._angel_ph('cycle_h');

  -- ⚠️ ТЕЛО ПЕРВЫМ. Иначе крыло, стоящее с ним в одной системе, откусывало
  -- свою четверть и закрывало цикл ковчегу на все три часа.
  for f in select fl.id, fl.system_id from public.fleets fl
            where fl.faction_id = a.faction_id and fl.status = 'idle'
              and fl.system_id is not null
            order by (fl.id = a.fleet_id) desc, fl.id
  loop
    if public._fleet_in_battle(f.id) is not null then continue; end if;

    -- ВСТАВКА 2: кто кусает.
    mul := case when f.id = a.fleet_id then 1.0 else public._angel_ph('wing_mul') end;

    -- ВСТАВКА 3: ОДНА КОЛОНИЯ НА СИСТЕМУ. Начатая — она же и продолжается;
    -- начатой нет — берём самый населённый мир. Остальные ждут очереди.
    for c in
      select * from public.colonies co
       where co.system_id = f.system_id
         and co.faction_id is distinct from a.faction_id
       order by exists (select 1 from public.angel_transmute t2
                         where t2.colony_id = co.id and t2.done_at is null) desc,
                coalesce(co.pop, 0) desc
       limit 1
    loop
      select * into t from public.angel_transmute where colony_id = c.id;

      if t.colony_id is null then
        insert into public.angel_transmute(colony_id, faction_id, system_id, planet_pid,
                                           planet_name, pop0, last_at)
          values (c.id, c.faction_id, c.system_id, c.planet_pid, c.planet_name,
                  greatest(1, coalesce(c.pop, 1)), now() - (hrs || ' hours')::interval)
          returning * into t;
        started := started + 1;
        select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = c.system_id;
        perform public._angel_tell(c.faction_id,
          public._angel_glitch('◈ «' || coalesce(c.planet_name,'?') || '»: НАЧАЛОСЬ', 0.24),
          public._angel_glitch(
            'Над колонией в системе «' || coalesce(sysname,'?') || '» встало то, что не отвечает на запросы. '
            || 'Связь с поверхностью держится, но говорить с ней стало не с кем: люди уходят вверх '
            || 'ровными вертикальными линиями и не возвращаются', 0.18)
          || ' ' || public._angel_scream(13));
      end if;

      if t.done_at is not null then continue; end if;
      if now() - t.last_at < (hrs || ' hours')::interval then continue; end if;

      take := least(coalesce(c.pop, 0), t.pop0 * public._angel_ph('take_frac') * mul);
      if take <= 0 then take := coalesce(c.pop, 0); end if;

      seal := take * public._angel_ph('seal_per_pop');
      ms   := take * public._angel_ph('mass_per_pop');

      update public.colonies set pop = greatest(0, coalesce(pop,0) - take) where id = c.id;
      update public.angel_state
         set seals = least(public._angel_const('seals_max'), seals + seal),
             mass  = least(public._angel_ph('mass_cap'), mass + ms),
             last_regen = now()
       where faction_id = a.faction_id;
      update public.angel_transmute
         set taken = taken + take, last_at = now() where colony_id = c.id;
      bites := bites + 1;

      if coalesce((select pop from public.colonies where id = c.id), 0) <= 0 then
        select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = c.system_id;
        select name into onm from public.faction_applications
         where faction_id = c.faction_id and status = 'approved' order by updated_at desc limit 1;

        if c.planet_pid is not null then
          select coalesce(planets,'[]'::jsonb) into arr from public.map_systems where id = c.system_id;
          newpl := '[]'::jsonb;
          for i in 0 .. coalesce(jsonb_array_length(arr),1)-1 loop
            el := arr->i;
            if (el->>'pid')::int = c.planet_pid then
              el := el || jsonb_build_object(
                     'g','lava', 'kind','planet', 'type','Переплавленный мир',
                     'icon','🪨', 'slotsP', 0, 'slotsK', 0,
                     'resources','[]'::jsonb, 'dead', true,
                     'melted', true, 'melted_by', a.faction_id,
                     'melted_at', to_jsonb(now()));
            end if;
            newpl := newpl || jsonb_build_array(el);
          end loop;
          update public.map_systems set planets = newpl where id = c.system_id;
        end if;

        delete from public.colony_buildings where colony_id = c.id;
        delete from public.colonies where id = c.id;
        update public.angel_transmute set done_at = now() where colony_id = c.id;
        -- ⚠️ ВСТАВКА ШАГА 29: съеденное становится домом.
        update public.angel_state set home_sys = c.system_id where faction_id = a.faction_id;
        eaten := eaten + 1;

        perform public._angel_news(
          public._angel_glitch('◈ МИР ПЕРЕПЛАВЛЕН', 0.22),
          public._angel_glitch(
            'Колония «' || coalesce(c.planet_name,'?') || '» в системе «' || coalesce(sysname,'?') || '»'
            || case when onm is not null then ' державы «' || onm || '»' else '' end
            || ' перестала быть населённой. Взрыва не было, кратера нет, '
            || 'атмосфера на месте. Поверхность перестала отражать сигнал так, как отражал её камень', 0.18)
          || ' ' || public._angel_scream(14));
      end if;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'started', started, 'bites', bites, 'eaten', eaten,
    'mass', (select round(mass,1) from public.angel_state where faction_id = a.faction_id),
    'seals', (select round(seals,1) from public.angel_state where faction_id = a.faction_id));
end$function$;

revoke all on function public._angel_transmute() from public;
CREATE OR REPLACE FUNCTION public._angel_hunter()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a record; sh record; tgt record; hops int; maxh int; fly numeric; rdy timestamptz;
        lock_sys text; have_q int;
begin
  -- ⟨ИСХОД⟩ орудия зачехлены.
  if public._angel_pilgrim() then return jsonb_build_object('ok', true, 'why', 'исход'); end if;
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;
  select coalesce(d.qty,0) into have_q from public.doom_shells d
   where d.faction_id = a.faction_id and d.kind = 'ball_hunter';
  if coalesce(have_q,0) < 1 then return jsonb_build_object('ok', true, 'why', 'нет «Сполоха»'); end if;

  select * into sh from public.mza_ships
   where faction_id = a.faction_id and status = 'idle' and system_id is not null
     and integrity > 0
     and not exists(select 1 from public.doom_salvos s
                     where s.mza_id = mza_ships.id and s.status = 'in_flight')
   order by integrity desc limit 1;
  if sh.id is null then return jsonb_build_object('ok', true, 'why', 'рука занята'); end if;

  maxh := public._shell_const('mza_range_hops')::int;

  -- Цель: САМЫЙ КРУПНЫЙ чужой флот в радиусе захвата. Крупный, а не близкий:
  -- снаряд один, и тратить его на курьера, когда рядом ордер, — расточительство.
  select f.id, f.name, f.faction_id, f.system_id, f.from_sys,
         (select coalesce(sum(greatest(0,(c->>'qty')::int)),0)
            from jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c) ships
    into tgt
    from public.fleets f
   where f.faction_id is distinct from a.faction_id
     and coalesce(f.system_id, f.from_sys) is not null
     and coalesce(jsonb_array_length(f.composition), 0) > 0
     and public._mza_hops(sh.system_id, coalesce(f.system_id, f.from_sys), maxh) is not null
     and not exists(select 1 from public.doom_salvos s
                     where s.target_fleet_id = f.id and s.status = 'in_flight')
   order by ships desc limit 1;
  if tgt.id is null then return jsonb_build_object('ok', true, 'why', 'целей в радиусе нет'); end if;

  lock_sys := coalesce(tgt.system_id, tgt.from_sys);
  perform public._shell_take(a.faction_id, 'ball_hunter');
  update public.mza_ships
     set integrity = greatest(0, integrity - public._mza_const('shot_wear')),
         total_shots = total_shots + 1
   where id = sh.id;

  fly := coalesce(public._mza_dist_hours(sh.system_id, lock_sys,
                    public._mza_const('salvo_h_min'), public._mza_const('salvo_h_max')),
                  public._mza_const('salvo_h_min')) * 0.8;
  rdy := now() + (round(fly*60)::int || ' minutes')::interval;

  insert into public.doom_salvos
    (mza_id, faction_id, owner_id, origin_system_id, target_system_id,
     target_pid, target_planet, target_fleet_id, flak_p, ready_at, kind, victim_fid)
  values
    (sh.id, a.faction_id,
     (select owner_id from public.faction_economy where faction_id = a.faction_id),
     sh.system_id, lock_sys, null, coalesce(tgt.name,'флот'), tgt.id,
     public._fleet_flak_p(public._fleet_flak(tgt.id)), rdy, 'ball_hunter', tgt.faction_id);

  -- ⚠️ Убрано «ведёт сигнатуру, уходить бесполезно, остаётся зенитный огонь» —
  -- это инструкция по обороне. Пусть узнают, попробовав уйти.
  perform public._angel_tell(tgt.faction_id, public._angel_glitch('◈ Оно посмотрело на ваш флот', 0.22),
    public._angel_glitch(
      'С отметки ушёл снаряд по флоту «' || coalesce(tgt.name,'???') || '». Подлёт ~' ||
      to_char(fly,'FM990.0') || ' ч.', 0.16) ||
    ' ' || public._angel_scream(12));

  return jsonb_build_object('ok', true, 'act', 'hunter', 'target', tgt.name,
                            'ships', tgt.ships, 'ready_at', rdy);
end$function$;

revoke all on function public._angel_hunter() from public;
CREATE OR REPLACE FUNCTION public._angel_doom()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a record; g record; f record; tgt record; have_q int;
        org public.map_systems; tsys public.map_systems; dist numeric; diag numeric;
        frac numeric; fly numeric; rdy timestamptz;
begin
  -- ⟨ИСХОД⟩ снаряды не собираются.
  if public._angel_pilgrim() then return jsonb_build_object('ok', true, 'why', 'исход'); end if;
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;
  select coalesce(d.qty,0) into have_q from public.doom_shells d
   where d.faction_id = a.faction_id and d.kind = 'doom';
  if coalesce(have_q,0) < 1 then return jsonb_build_object('ok', true, 'why', 'нет снаряда Длани'); end if;

  select * into f from public.fleets where id = a.fleet_id;
  select * into g from public.doom_guns
   where faction_id = a.faction_id and integrity > 0
     and not exists(select 1 from public.doom_salvos s
                     where s.gun_id = doom_guns.id and s.status = 'in_flight')
   order by integrity desc limit 1;
  if g.id is null then return jsonb_build_object('ok', true, 'why', 'ствол занят или разрушен'); end if;

  -- ствол стоит на ковчеге — значит стреляет оттуда, где ковчег сейчас
  update public.doom_guns set system_id = coalesce(f.system_id, f.from_sys, g.system_id)
   where id = g.id;
  select * into g from public.doom_guns where id = g.id;
  if g.system_id is null then return jsonb_build_object('ok', true, 'why', 'ствол вне карты'); end if;

  select c.system_id, c.planet_pid, c.planet_name, c.faction_id, c.pop
    into tgt
    from public.colonies c
    join public.map_systems ms on ms.id = c.system_id
   where c.planet_pid is not null
     and c.faction_id is distinct from a.faction_id
     and c.faction_id in (select public.war_enemies_of(a.faction_id))
     and not exists(select 1 from public.doom_salvos s
                     where s.status = 'in_flight' and s.target_system_id = c.system_id
                       and s.target_pid = c.planet_pid)
     -- Ожерелье над системой снимет залп гарантированно: не тратим снаряд
     and not exists(select 1 from public.colony_buildings cb
                      join public.colonies c2 on c2.id = cb.colony_id
                     where cb.btype = 'nemesis' and c2.system_id = c.system_id)
   order by coalesce(c.pop, 0) desc
   limit 1;
  if tgt.system_id is null then return jsonb_build_object('ok', true, 'why', 'нет цели среди врагов'); end if;

  perform public._shell_take(a.faction_id, 'doom');
  update public.doom_guns
     set integrity = greatest(0, integrity - public._doom_const('shot_wear')),
         total_shots = total_shots + 1
   where id = g.id;

  select * into org  from public.map_systems where id = g.system_id;
  select * into tsys from public.map_systems where id = tgt.system_id;
  dist := sqrt(power(coalesce(tsys.x,0)-coalesce(org.x,0),2)
             + power(coalesce(tsys.y,0)-coalesce(org.y,0),2));
  select sqrt(power(max(x)-min(x),2) + power(max(y)-min(y),2)) into diag from public.map_systems;
  frac := least(1.0, greatest(0.0, dist / nullif(diag,0)));
  fly  := public._doom_const('flight_h_min')
        + frac * (public._doom_const('flight_h_max') - public._doom_const('flight_h_min'));
  rdy  := now() + (round(fly*60)::int || ' minutes')::interval;

  insert into public.doom_salvos
    (gun_id, faction_id, owner_id, origin_system_id, target_system_id, target_pid,
     target_planet, ready_at, kind, victim_fid)
  values
    (g.id, a.faction_id,
     (select owner_id from public.faction_economy where faction_id = a.faction_id),
     g.system_id, tgt.system_id, tgt.planet_pid, tgt.planet_name, rdy, 'doom', tgt.faction_id);

  perform public._angel_tell(tgt.faction_id, public._angel_glitch('◈ Оно выбрало планету', 0.22),
    public._angel_glitch(
      'С отметки ушёл снаряд судного дня по планете «' || coalesce(tgt.planet_name,'???') ||
      '». Подлёт ~' || to_char(fly,'FM990.0') || ' ч.', 0.16) ||
    ' ' || public._angel_scream(14));

  return jsonb_build_object('ok', true, 'act', 'doom', 'planet', tgt.planet_name, 'ready_at', rdy);
end$function$;

revoke all on function public._angel_doom() from public;
CREATE OR REPLACE FUNCTION public._angel_barrage()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a record; sh record; tgt record; kind text; bp jsonb; maxh int;
        fly numeric; rdy timestamptz; nm text;
begin
  -- ⟨ИСХОД⟩ заградительного огня нет.
  if public._angel_pilgrim() then return jsonb_build_object('ok', true, 'why', 'исход'); end if;
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;

  select d.kind into kind from public.doom_shells d
   where d.faction_id = a.faction_id and d.qty > 0
     and d.kind in ('ball_heavy','ball_cluster','ball_emp','ball_light')
   order by case d.kind when 'ball_heavy' then 1 when 'ball_cluster' then 2
                        when 'ball_emp' then 3 else 4 end
   limit 1;
  if kind is null then return jsonb_build_object('ok', true, 'why', 'склад пуст'); end if;

  select * into sh from public.mza_ships
   where faction_id = a.faction_id and status = 'idle' and system_id is not null
     and integrity > 0
     and not exists(select 1 from public.doom_salvos s
                     where s.mza_id = mza_ships.id and s.status = 'in_flight')
   order by integrity desc limit 1;
  if sh.id is null then return jsonb_build_object('ok', true, 'why', 'все руки заняты'); end if;

  bp   := public._ball_params(kind);
  maxh := public._shell_const('mza_range_hops')::int
        * case when coalesce((bp->>'long_range')::boolean, false)
               then public._shell_const('heavy_range_mul')::int else 1 end;

  -- Цель: самая жирная колония врага в радиусе. «Фантом» ПРО не видит, поэтому
  -- ему Ожерелье не помеха; остальным — помеха, и снаряд туда не тратим.
  select c.system_id, c.planet_pid, c.planet_name, c.faction_id
    into tgt
    from public.colonies c
   where c.planet_pid is not null
     and c.faction_id is distinct from a.faction_id
     and c.faction_id in (select public.war_enemies_of(a.faction_id))
     and public._mza_hops(sh.system_id, c.system_id, maxh) is not null
     and not exists(select 1 from public.doom_salvos s
                     where s.status = 'in_flight' and s.target_system_id = c.system_id
                       and s.target_pid = c.planet_pid)
     and (kind = 'ball_emp' or not exists(
            select 1 from public.colony_buildings cb
              join public.colonies c2 on c2.id = cb.colony_id
             where cb.btype = 'nemesis' and c2.system_id = c.system_id))
   order by coalesce(c.pop, 0) desc
   limit 1;
  if tgt.system_id is null then return jsonb_build_object('ok', true, 'why', 'целей в радиусе нет'); end if;

  perform public._shell_take(a.faction_id, kind);
  update public.mza_ships
     set integrity = greatest(0, integrity - public._mza_const('shot_wear')),
         total_shots = total_shots + 1
   where id = sh.id;

  fly := coalesce(public._mza_dist_hours(sh.system_id, tgt.system_id,
                    public._mza_const('salvo_h_min'), public._mza_const('salvo_h_max')),
                  public._mza_const('salvo_h_min'))
       * coalesce((bp->>'fly_mul')::numeric, 1.0);
  rdy := now() + (round(fly*60)::int || ' minutes')::interval;

  insert into public.doom_salvos
    (mza_id, faction_id, owner_id, origin_system_id, target_system_id,
     target_pid, target_planet, ready_at, kind, victim_fid)
  values
    (sh.id, a.faction_id,
     (select owner_id from public.faction_economy where faction_id = a.faction_id),
     sh.system_id, tgt.system_id, tgt.planet_pid, tgt.planet_name, rdy, kind, tgt.faction_id);

  select coalesce(nullif(name,''), id) into nm from public.map_systems where id = tgt.system_id;
  perform public._angel_tell(tgt.faction_id,
    public._angel_glitch('◈ Оно посмотрело на «' || coalesce(tgt.planet_name,'?') || '»', 0.22),
    public._angel_glitch('С отметки ушёл снаряд. Подлёт ~' || to_char(fly,'FM990.0') || ' ч.', 0.16)
    || ' ' || public._angel_scream(12));

  return jsonb_build_object('ok', true, 'act', 'barrage', 'kind', kind,
                            'planet', tgt.planet_name, 'sys', nm, 'ready_at', rdy);
end$function$;

revoke all on function public._angel_barrage() from public;
CREATE OR REPLACE FUNCTION public._angel_declare(p_target text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af text; w uuid; nfoes int;
begin
  -- ⟨ИСХОД⟩ войн больше не объявляет.
  if public._angel_pilgrim() then return jsonb_build_object('ok', true, 'why', 'исход'); end if;
  af := public._angel_fid();
  if af is null or p_target is null or p_target = af then
    return jsonb_build_object('ok', false);
  end if;
  if not exists (select 1 from public.faction_applications
                  where faction_id = p_target and status = 'approved') then
    return jsonb_build_object('ok', false, 'why', 'нет такой державы');
  end if;
  if public.at_war(af, p_target) then return jsonb_build_object('ok', true, 'already', true); end if;

  select count(*) into nfoes from public._angel_foes(af);
  if nfoes > 0 and not exists (select 1 from public._angel_foes(af) f where f.fid = p_target) then
    return jsonb_build_object('ok', true, 'skipped', 'не в реестре', 'fid', p_target);
  end if;

  insert into public.wars(attacker_fid, defender_fid, cause)
    values (af, p_target, public._angel_cause()) returning id into w;
  insert into public.war_sides(war_id, fid, side)
    values (w, af, 'attacker'), (w, p_target, 'defender');

  -- ФАКТ: сухо и стабильно. Державе надо знать, что она в войне.
  perform public._war_news(
    '◈ Престол объявил войну: ' || public._war_nm(p_target),
    'Отметка вышла из прыжка над их мирами. Переговоров не было — их не с кем вести.',
    jsonb_build_array(af, p_target));
  -- РЕПЛИКА: отдельной строкой, редко.
  perform public._angel_speak('arrive', 180);

  return jsonb_build_object('ok', true, 'war_id', w);
end$function$;

revoke all on function public._angel_declare(text) from public;
CREATE OR REPLACE FUNCTION public._angel_guard_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af text; ark uuid; g record; foe record; b uuid; n int := 0; wars int := 0;
begin
  -- ⟨ИСХОД⟩ стража не бросается на встречных.
  if public._angel_pilgrim() then return jsonb_build_object('ok', true, 'why', 'исход'); end if;
  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;
  select fleet_id into ark from public.angel_state where faction_id = af;

  for g in select f.id, f.system_id from public.fleets f
            where f.faction_id = af and f.status = 'idle' and f.system_id is not null
              and f.id is distinct from ark          -- тело само ни во что не лезет
  loop
    if public._fleet_in_battle(g.id) is not null then continue; end if;

    for foe in select fl.id, fl.faction_id from public.fleets fl
                where fl.system_id = g.system_id and fl.status = 'idle'
                  and fl.faction_id is distinct from af
    loop
      if public._fleet_in_battle(foe.id) is not null then continue; end if;
      begin
        if not public.at_war(af, foe.faction_id) then
          perform public._angel_declare(foe.faction_id);
          wars := wars + 1;
        end if;
      exception when others then null; end;

      b := public._war_engage(g.id, foe.id, g.system_id, 'meeting');
      if b is not null then n := n + 1; end if;
      exit;                                  -- один бой за проход
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'battles', n, 'wars', wars);
end$function$;

revoke all on function public._angel_guard_watch() from public;
CREATE OR REPLACE FUNCTION public._angel_pick_target()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a record; f record; here text; res text; log jsonb; nfoes int;
begin
  -- ⟨ИСХОД⟩ цель одна и она не держава.
  if public._angel_pilgrim() then return public._angel_temple(); end if;
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return null; end if;
  select * into f from public.fleets where id = a.fleet_id;
  here := coalesce(f.system_id, f.from_sys);
  if here is null then return null; end if;
  log := coalesce(a.path_log, '[]'::jsonb);

  select count(*) into nfoes from public._angel_foes(a.faction_id);

  -- 1) РЕЕСТР. Ближайший мир того, кто против него воевал. Радиуса нет:
  -- Альянс не перестаёт быть врагом оттого, что успел отойти подальше.
  if nfoes > 0 then
    -- ⚠️ ОЧЕРЁДНОСТЬ — ПО СТАРШИНСТВУ ВОЙНЫ, а не по близости. Сначала тот,
    -- с кем война началась раньше: Шестнадцатая Волна и Альянс. Только когда
    -- у старшего врага не осталось досягаемых миров, очередь идёт дальше.
    select ms.id into res
      from public.map_systems ms
      join public._angel_dist(here, 40) dd on dd.sys = ms.id
      join lateral (
        select min(fo.since) as since
          from public.colonies c
          join public._angel_foes(a.faction_id) fo on fo.fid = c.faction_id
         where c.system_id = ms.id
      ) q on q.since is not null
     where ms.id <> here
     order by q.since asc,
              (log ? ms.id) asc,
              dd.d asc,
              (select count(*) from public.colonies c where c.system_id = ms.id) desc
     limit 1;
    if res is not null then return res; end if;
    -- Реестр цел, но досягаемых миров у них нет — падаем в общий поиск ниже:
    -- стоять на месте кризису нельзя, а идти всё равно надо к людям.
  end if;

  -- 2) ЗАВЯЗКА. Реестр пуст (или враги недосягаемы) — ближайший чужой мир.
  -- Именно здесь кризис заводит себе первого врага, и дальше держится за него.
  select ms.id into res
    from public.map_systems ms
    join public._angel_dist(here, 40) dd on dd.sys = ms.id
   where ms.id <> here
     and exists (select 1 from public.colonies c
                  where c.system_id = ms.id and c.faction_id is distinct from a.faction_id)
   order by (log ? ms.id) asc,
            dd.d asc,
            (select coalesce(sum(coalesce(c.pop,0)),0) from public.colonies c
              where c.system_id = ms.id) desc
   limit 1;
  if res is not null then return res; end if;

  -- 3) Хоть куда, лишь бы не стоять.
  select case when l.a_id = here then l.b_id else l.a_id end into res
    from public.map_hyperlanes l
   where l.a_id = here or l.b_id = here
   order by (log ? case when l.a_id = here then l.b_id else l.a_id end) asc, random()
   limit 1;
  return res;
end$function$;

revoke all on function public._angel_pick_target() from public;
CREATE OR REPLACE FUNCTION public._angel_host_follow()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a record; here text; n int := 0; f record; sys text; lead uuid;
begin
  -- ⟨ИСХОД⟩ крылья идут за телом, а не по гарнизонам.
  if public._angel_pilgrim() then return public._angel_pilgrim_follow(); end if;
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.fleet_id is null then return 0; end if;
  -- ⚠️ Только по прибытии: сопровождение не обгоняет сопровождаемого.
  select fl.system_id into here from public.fleets fl where fl.id = a.fleet_id;

  -- Ведущее крыло — самое старое. Оно и есть сопровождение тела.
  select g.fleet_id into lead from public.angel_guard g
   where g.role = 'escort' and g.dead_at is null
   order by g.ord limit 1;

  for f in select distinct fl.id, fl.system_id from public.fleets fl
             join public.angel_guard g on g.fleet_id = fl.id and g.dead_at is null
                                      and g.role = 'escort'
  loop
    if public._fleet_in_battle(f.id) is not null then continue; end if;

    sys := null;
    if f.id is distinct from lead then
      -- Занятая система, где нашего флота нет, — туда садится гарнизон.
      select o.system_id into sys from public.system_occupation o
       where o.occupier_fid = a.faction_id
         and not exists (select 1 from public.fleets x
                          where x.faction_id = a.faction_id and x.system_id = o.system_id
                            and x.id <> f.id)
       order by (o.system_id = f.system_id) desc
       limit 1;
    end if;
    -- Ведущему — и всем, кому гарнизона не досталось, — к телу.
    if sys is null then sys := here; end if;
    if sys is null or f.system_id is not distinct from sys then continue; end if;

    update public.fleets
       set system_id = sys, status = 'idle', from_sys = null, dest_sys = null,
           depart_at = null, arrive_at = null, route = null, route_at = null
     where id = f.id;
    n := n + 1;
  end loop;
  return n;
end$function$;

revoke all on function public._angel_host_follow() from public;
CREATE OR REPLACE FUNCTION public.angel_war_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a record; f record; out jsonb := '{}'::jsonb; mx numeric; frac numeric;
        inc int; dest text; st text; af text; foes text[]; ph int; busy boolean;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;
  af := a.faction_id;

  perform public._angel_regen();
  perform public._angel_sync_body();
  begin perform public._fleet_settle(af); exception when others then null; end;
  begin perform public._doom_resolve(af); exception when others then null; end;

  select * into a from public.angel_state where faction_id = af;
  if a.fell_at is not null then return jsonb_build_object('ok', true, 'fell', true); end if;
  select * into f from public.fleets where id = a.fleet_id;
  if f.id is null then return jsonb_build_object('ok', true, 'why', 'ковчега нет'); end if;

  -- ⟨ИСХОД⟩ ПОХОД К ХРАМУ. Дальше этой развилки тик войны не идёт вовсе:
  -- ни выбора врага, ни огня, ни объявления войны по факту присутствия.
  -- Осталось одно движение — к Храму мироздания, и стояние в нём.
  if a.stance = 'pilgrim' then
    if f.status = 'idle' and coalesce(f.system_id,'') is distinct from public._angel_temple() then
      begin out := out || jsonb_build_object('march', public._angel_send(public._angel_temple()));
      exception when others then null; end;
    end if;
    return out || jsonb_build_object('ok', true, 'stance', 'pilgrim',
      'sys', coalesce(f.system_id, f.from_sys), 'dest', public._angel_temple(),
      'arrived', coalesce(f.system_id,'') = public._angel_temple());
  end if;

  ph   := coalesce(a.phase, 1);
  mx   := public._angel_const('seals_max');
  frac := a.seals / nullif(mx, 0);
  select count(*) into inc from public.doom_salvos s
   where s.status = 'in_flight' and s.target_fleet_id = a.fleet_id;

  -- 9.2 РЕШЕНИЕ О ЖИЗНИ.
  -- ⚠️ ФАЗА 2: БЕГСТВА НЕТ. Разворот в гнездо писался под первую фазу, где
  -- лечил только покой. Теперь оно лечится едой, и уйти в угол — значит уйти
  -- туда, где еды нет.
  st := a.stance;
  if ph >= 2 then
    st := 'march';
  elsif frac <= public._angel_const('flee_frac') then st := 'roost';
  elsif st = 'roost' and frac >= public._angel_const('back_frac') then st := 'march';
  end if;
  if st is distinct from a.stance then
    update public.angel_state set stance = st where faction_id = af;
    if st = 'roost' then
      perform public._angel_news(public._angel_glitch('◈ ОНО СМЕНИЛО КУРС', 0.24),
        public._angel_glitch('Отметка развернулась и уходит. Причина манёвра', 0.18)
        || ' ' || public._angel_scream(16));
    else
      perform public._angel_news(public._angel_glitch('◈ ОНО СНОВА ДВИЖЕТСЯ', 0.24),
        public._angel_glitch('Отметка снялась с места. Пауза длилась', 0.18)
        || ' ' || public._angel_scream(11));
    end if;
  end if;

  -- 9.25 ВОЙНА ПО ФАКТУ.
  if f.system_id is not null then
    select array_agg(distinct c.faction_id) into foes from public.colonies c
     where c.system_id = f.system_id and c.faction_id is not null
       and c.faction_id is distinct from af
       and not public.at_war(af, c.faction_id);
    if foes is not null then
      begin
        perform public._angel_declare(v) from unnest(foes) v;
      exception when others then null; end;
    end if;
  end if;

  -- 9.3 ОГОНЬ.
  begin out := out || jsonb_build_object('hunter', public._angel_hunter()); exception when others then null; end;
  begin out := out || jsonb_build_object('doom',   public._angel_doom());   exception when others then null; end;

  -- 9.4 ХОД.
  -- ⚠️ ЕДА ДЕРЖИТ НА МЕСТЕ. Без этой проверки ковчег садился над колонией,
  -- начинал переплавку и на следующем тике улетал к новой цели — то есть
  -- главная механика второй фазы не срабатывала НИ РАЗУ.
  busy := false;
  if ph >= 2 and f.system_id is not null then
    select exists(select 1 from public.angel_transmute t
                   where t.system_id = f.system_id and t.done_at is null)
      into busy;
  end if;

  if f.status = 'idle' and not busy then
    if st = 'roost' then
      dest := case when coalesce(f.system_id,'') = coalesce(a.home_sys,'') then null else a.home_sys end;
    else
      dest := public._angel_pick_target();
    end if;
    if dest is not null then
      begin out := out || jsonb_build_object('march', public._angel_send(dest));
      exception when others then null; end;
    end if;
  end if;

  return out || jsonb_build_object('ok', true, 'stance', st, 'phase', ph,
    'seals', round(a.seals,1), 'frac', round(frac,3), 'incoming', inc,
    'mass', round(a.mass,1), 'feeding', busy,
    'sys', coalesce(f.system_id, f.from_sys));
end$function$;

revoke all on function public.angel_war_tick() from public;

notify pgrst, 'reload schema';
