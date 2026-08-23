-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 29: ЭТО КРИЗИС, А НЕ ГРУША
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_phase2.sql. Надмножество `_angel_pace`,
-- `_angel_take_salvo`, `_angel_rise2`, `_angel_transmute`, `angel_war_tick`.
--
-- ЖАЛОБА (и она правильная): «пока он долетит из этих ебеней, его сто раз
-- выебут, у людей больше сорока залпов МЗА».
--
-- ЧТО Я СДЕЛАЛ НЕ ТАК В ШАГЕ 28. Я выдал ему экономику, которую он НЕ МОЖЕТ
-- ЗАПУСТИТЬ. Плоть берётся только с колоний, колонии — за полкарты, гнездо
-- «Великий трон» стоит в углу, ход ковчега ×0.62 от общего тарифа — это 4+
-- часа на плечо. Всё это время он летит с пустым баком под непрерывным
-- обстрелом, и ни одна новая способность не работает: разворачивать снаряды
-- нечем. То есть вторая фаза начиналась ровно там же, где кончилась первая, —
-- мишенью. Разница только в цвете.
--
-- ЧЕТЫРЕ ПРАВКИ, И ГЛАВНАЯ — ВТОРАЯ.
--
--   1) ОНО ВСТАЁТ СЫТЫМ. Первое, что оно переплавило, — собственный труп.
--      Воплощение даёт полный бак плоти: четыре разворота есть сразу, ещё до
--      первой съеденной колонии.
--
--   2) ⚠️ УДАР КОРМИТ. Плоть теперь капает не только с миров, но и с КАЖДОГО
--      пришедшего снаряда: попал — +6, отбит — +3. Это и есть ответ на «сорок
--      залпов»: чем дольше по нему лупят, тем больше снарядов уходит обратно.
--      Обстрел из способа его убить превращается в способ его зарядить —
--      убивать всё ещё можно (печати текут по-прежнему), но теперь за это
--      платят своими же боеголовками. Заряжается ПОТОКОМ, а не запасом: банка
--      всё те же 100, важно, что она не пустеет, пока по нему стреляют.
--
--   3) ОНО НЕ УБЕГАЕТ ЛЕЧИТЬСЯ. Разворот в гнездо на низких печатях (flee_frac)
--      писался под первую фазу, где лечил только покой. Во второй фазе оно
--      лечится едой, и «уйти в угол зализывать раны» означало бы уйти туда,
--      где еды нет, — то есть умереть медленнее. В фазе 2 stance всегда
--      'march'. Заодно гнездо переезжает: `home_sys` становится последним
--      переплавленным миром, и угол карты перестаёт быть его домом.
--
--   4) ОНО ХОДИТ БЫСТРЕЕ, НО НЕ ЗА КЕМ-ТО. Тариф второй фазы: ковчег ×0.34,
--      крылья ×0.45 (было 0.62/0.72). ⚠️ Оговорка шага 24 в силе: догнать
--      убегающий флот всё равно нельзя и не нужно, скорость тут не про погоню,
--      а про то, чтобы кризис доезжал до людей раньше, чем его расстреляют на
--      подлёте.
--
-- И ОТДЕЛЬНО — ДЫРА, НАЙДЕННАЯ ПО ДОРОГЕ. `angel_war_tick` шаг 9.4 ищет новую
-- цель КАЖДЫЙ раз, как ковчег сел («стоящий на месте кризис перестаёт быть
-- кризисом»). С шагом 28 это значило: сел над колонией, начал переплавку — и
-- на следующем тике улетел, не доев. Механика фазы не работала бы вовсе.
-- Теперь: пока в системе идёт незаконченная переплавка, он никуда не уходит.
-- ════════════════════════════════════════════════════════════

-- ── 1. ТАРИФ ХОДА: ФАЗА ЗНАЕТ СВОЙ ТЕМП ─────────────────────
-- Надмножество _angel_pace.sql (шаг 24). ⚠️ Функция была IMMUTABLE — теперь
-- STABLE: она читает фазу из базы. Ключи и смысл прежние.
create or replace function public._angel_pace(p_key text)
returns numeric language sql stable security definer set search_path=public as $$
  select case
    when p_key = 'ark'  then case when public._angel_phase() >= 2 then 0.34 else 0.62 end
    when p_key = 'wing' then case when public._angel_phase() >= 2 then 0.45 else 0.72 end
    when p_key = 'chase_hops' then 1   -- дальше этого за ЧУЖИМ ФЛОТОМ не ходим
    when p_key = 'hunt_hops'  then 3   -- радиус поиска целей крылом
    else 1 end
$$;

-- ── 2. УДАР КОРМИТ ──────────────────────────────────────────
-- Надмножество шага 28. Вставка одна: во второй фазе любой пришедший снаряд
-- добавляет плоть — отбитый меньше, попавший больше.
create or replace function public._angel_take_salvo(p_fid text, p_kind text, p_from text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; pp numeric; parried boolean; lo numeric; hi numeric;
        loss numeric; seals_left numeric; mx numeric; feed numeric := 0;
begin
  select * into a from public.angel_state where faction_id = p_fid and fell_at is null;
  if a.faction_id is null then
    return jsonb_build_object('ok', false, 'why', 'ангела нет');
  end if;
  mx := public._angel_const('seals_max');

  pp := public._angel_parry_p(p_fid);
  parried := (random() < pp);

  -- ⚠️ ПЛОТЬ С УДАРА. Снаряд — это тоже вещество, и оно тоже перерабатывается.
  -- Кормит именно ПРИЛЁТ, а не урон: отбитый снаряд оно всё равно разобрало.
  if coalesce(a.phase,1) >= 2 then
    feed := case when parried then public._angel_ph('mass_parry')
                 else public._angel_ph('mass_hit') end;
  end if;

  update public.angel_state
     set press = least(public._angel_const('press_cap'),
                       press + public._angel_const('press_hit')),
         last_press = now(),
         mass = least(public._angel_ph('mass_cap'), mass + feed),
         salvos_seen = salvos_seen + 1,
         salvos_parried = salvos_parried + case when parried then 1 else 0 end
   where faction_id = p_fid;

  if parried then
    return jsonb_build_object('ok', true, 'parried', true, 'parry_p', pp,
                              'seals', round(a.seals, 1), 'fed', feed,
                              'frac', round(a.seals / mx, 3));
  end if;

  if p_kind = 'doom' then
    lo := public._angel_const('doom_min'); hi := public._angel_const('doom_max');
  else
    lo := public._angel_const('ball_min'); hi := public._angel_const('ball_max');
  end if;
  loss := lo + random() * (hi - lo);
  if coalesce(a.phase,1) >= 2 then loss := loss * public._angel_ph('sal_mul'); end if;

  update public.angel_state
     set seals = greatest(0, seals - loss), last_hit = now(), last_regen = now()
   where faction_id = p_fid
  returning seals into seals_left;

  if seals_left <= 0 then
    perform public._angel_fall(p_fid, p_from);
  end if;

  return jsonb_build_object('ok', true, 'parried', false, 'parry_p', pp,
                            'loss', round(loss, 2), 'seals', round(seals_left, 1),
                            'frac', round(seals_left / mx, 3), 'fed', feed,
                            'fell', (seals_left <= 0));
end$$;
revoke all on function public._angel_take_salvo(text,text,text) from public;

-- ── 3. КОНСТАНТЫ ФАЗЫ — НАДМНОЖЕСТВО ────────────────────────
-- Добавлены две строки корма. Остальное слово в слово из шага 28.
create or replace function public._angel_ph(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'rise_h'        then 8      -- часов тишины между гибелью и вторым воплощением
    when 'sal_mul'       then 0.7    -- залп снимает меньше: оно уже умирало однажды
    -- трансмутация
    when 'cycle_h'       then 1      -- один укус в час на мир
    when 'take_frac'     then 0.20   -- доля НАЧАЛЬНОГО населения за укус → 5 часов на мир
    when 'seal_per_pop'  then 0.06   -- средний мир (400) = +24 печати
    when 'mass_per_pop'  then 0.10   -- средний мир (400) = +40 плоти
    -- плоть с прилетевшего снаряда (шаг 29): четыре попадания = один разворот
    when 'mass_hit'      then 6
    when 'mass_parry'    then 3
    -- плоть и разворот
    when 'mass_cap'      then 100
    when 'reflect_cost'  then 25     -- полный бак = четыре разворота
    when 'reflect_lead'  then 25     -- минут до подлёта: позже разворачивать нечего
    when 'back_min_h'    then 0.7    -- обратный путь не короче
    when 'back_max_h'    then 6.0    -- и не длиннее
    else 0 end
$$;

-- ── 4. ВОПЛОЩЕНИЕ С ПОЛНЫМ БАКОМ ────────────────────────────
-- Надмножество шага 28: `mass = mass_cap` и строка в сводке про то, ЧЕМ оно
-- заправилось. Остальное — как было.
create or replace function public._angel_rise2()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; app record; ecoown uuid; home text; uid uuid; flid uuid; cid uuid;
        host jsonb; wall jsonb;
begin
  select * into a from public.angel_state
   where fell_at is not null and phase = 1 and rise_at is not null and rise_at <= now()
   order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', true, 'skip', true); end if;

  select * into app from public.faction_applications
   where faction_id = a.faction_id and status = 'approved' order by updated_at desc limit 1;
  select owner_id into ecoown from public.faction_economy where faction_id = a.faction_id;
  home := coalesce(a.home_sys, a.target_sys);
  if home is null then return jsonb_build_object('ok', false, 'why', 'некуда вставать'); end if;

  delete from public.fleets   where faction_id = a.faction_id;
  delete from public.colonies where faction_id = a.faction_id;
  delete from public.angel_guard where faction_id = a.faction_id;

  insert into public.colonies(faction_id, owner_id, system_id, planet_name, planet_type,
                              cells, planet_pid, is_capital, pop, resources)
    values (a.faction_id, ecoown, home, 'Оплот', 'Структура',
            public._angel_const('ark_cells')::int, null, true,
            public._angel_const('ark_pop'), '[]'::jsonb)
    returning id into cid;

  uid := public._angel_unit_id(a.faction_id);
  insert into public.faction_units(id, category, name, faction_id, faction_name,
                                   faction_color, owner_id, summary, data, card_text)
    values (uid, 'ship', 'Престол', a.faction_id, app.name, app.color, ecoown,
            public._angel_summary(),
            jsonb_build_object('class', 'angel', 'angel', true,
                               'layout', jsonb_build_object('mounts', '[]'::jsonb),
                               'weapons', '[]'::jsonb, 'modules', '[]'::jsonb),
            'Оно собрано не так, как было. Швов не видно, но их больше.')
    on conflict (id) do update
      set summary = excluded.summary, data = excluded.data,
          faction_id = excluded.faction_id, name = excluded.name,
          card_text = excluded.card_text;

  insert into public.fleets(faction_id, owner_id, name, status, system_id, home_sys,
                            composition, is_station, fuel, fuel_cap)
    values (a.faction_id, ecoown, 'ОПЛОТ', 'idle', home, home,
            jsonb_build_array(jsonb_build_object('unit_id', uid, 'qty', 1)),
            false, 99, 99)
    returning id into flid;

  update public.angel_state
     set phase = 2, fell_at = null, rise_at = null,
         unit_id = uid, fleet_id = flid, colony_id = cid,
         seals = public._angel_const('seals_max'),
         -- ⚠️ ПОЛНЫЙ БАК. Первое, что оно переплавило, — себя прежнее.
         mass = public._angel_ph('mass_cap'),
         press = 0, awake = true, stance = 'march',
         target_sys = home, last_hit = null, last_regen = now()
   where faction_id = a.faction_id;

  begin wall := public.angel_guard_muster(); exception when others then wall := null; end;
  begin host := public.angel_host_muster();  exception when others then host := null; end;

  perform public._angel_news(public._angel_glitch('◈ ОНО НЕ КОНЧИЛОСЬ', 0.24),
    public._angel_glitch(
      'Восемь часов на месте гибели не было ничего — и приборы это подтверждали. '
      || 'В 4:11 отметка вернулась в тот же квадрат, не подлетев к нему ниоткуда: '
      || 'её просто снова стало видно.', 0.18)
    || ' ' || public._angel_scream(12) || ' '
    || public._angel_glitch(
      'Обломков в квадрате нет — ни одного, хотя вчера их считали тоннами. '
      || 'Сопровождение снова полное. Классификатор второй раз не выдал класса '
      || 'и во второй раз не ошибся.', 0.22)
    || ' ' || public._angel_scream(15));

  return jsonb_build_object('ok', true, 'phase', 2, 'fid', a.faction_id,
                            'home', home, 'fleet', flid, 'wall', wall, 'host', host,
                            'mass', public._angel_ph('mass_cap'));
end$$;
revoke all on function public._angel_rise2() from public;

-- ── 5. ХОД КРИЗИСА — НАДМНОЖЕСТВО ───────────────────────────
-- Слово в слово живой `angel_war_tick`, вставок две:
--   • 9.2 во второй фазе бегства в гнездо НЕТ;
--   • 9.4 пока в системе идёт переплавка — никуда не уходим.
create or replace function public.angel_war_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
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
end$$;
revoke all on function public.angel_war_tick() from public;

-- ── 6. ГНЕЗДО ПЕРЕЕЗЖАЕТ ────────────────────────────────────
-- Надмножество шага 28: доев мир, оно объявляет эту систему своей. Угол карты
-- перестаёт быть его домом, и второе воплощение (если будет третья фаза —
-- не будет) встанет там, где оно в последний раз ело, а не в «Великом троне».
create or replace function public._angel_transmute()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; f record; c record; t record; take numeric; seal numeric; ms numeric;
        started int := 0; bites int := 0; eaten int := 0; sysname text;
        arr jsonb; newpl jsonb; el jsonb; i int; onm text;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null or coalesce(a.phase,1) < 2 then
    return jsonb_build_object('ok', true, 'why', 'не та фаза');
  end if;

  for f in select fl.id, fl.system_id from public.fleets fl
            where fl.faction_id = a.faction_id and fl.status = 'idle'
              and fl.system_id is not null
  loop
    if public._fleet_in_battle(f.id) is not null then continue; end if;

    for c in select * from public.colonies
              where system_id = f.system_id and faction_id is distinct from a.faction_id
    loop
      select * into t from public.angel_transmute where colony_id = c.id;

      if t.colony_id is null then
        insert into public.angel_transmute(colony_id, faction_id, system_id, planet_pid,
                                           planet_name, pop0, last_at)
          values (c.id, c.faction_id, c.system_id, c.planet_pid, c.planet_name,
                  greatest(1, coalesce(c.pop, 1)), now() - (public._angel_ph('cycle_h') || ' hours')::interval)
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
      if now() - t.last_at < (public._angel_ph('cycle_h') || ' hours')::interval then continue; end if;

      take := least(coalesce(c.pop, 0), t.pop0 * public._angel_ph('take_frac'));
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
            || ' перестала быть населённой за пять часов. Взрыва не было, кратера нет, '
            || 'атмосфера на месте. Поверхность перестала отражать сигнал так, как отражал её камень', 0.18)
          || ' ' || public._angel_scream(14));
      end if;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'started', started, 'bites', bites, 'eaten', eaten,
    'mass', (select round(mass,1) from public.angel_state where faction_id = a.faction_id),
    'seals', (select round(seals,1) from public.angel_state where faction_id = a.faction_id));
end$$;
revoke all on function public._angel_transmute() from public;

notify pgrst, 'reload schema';

-- ── 7. ЗАПРАВИТЬ ТОГО, КТО УЖЕ ВСТАЛ ────────────────────────
-- Он поднялся по шагу 28 с пустым баком и уже летит. Наливаем.
do $$
begin
  update public.angel_state
     set mass = public._angel_ph('mass_cap'), stance = 'march'
   where fell_at is null and coalesce(phase,1) >= 2 and mass < public._angel_ph('mass_cap');
  raise notice 'бак: %', (select round(mass,1) from public.angel_state limit 1);
end$$;

-- ── ПРОВЕРКА ────────────────────────────────────────────────
-- 1) `select _angel_pace('ark')` при живой фазе 2 → 0.34; плечо, которое было
--    4.0 ч, становится ~2.2 ч.
-- 2) Залп по нему: в ответе `_angel_take_salvo` поле `fed` = 6 (или 3, если
--    отбит), `angel_state.mass` растёт. Сорок залпов больше не бесплатны.
-- 3) Печати ниже flee_frac → в фазе 2 stance остаётся 'march', сводки «ОНО
--    СМЕНИЛО КУРС» нет, в угол оно не уходит.
-- 4) Ковчег сел над колонией → в тике `feeding: true`, `march` не вызывается,
--    пока мир не доеден; после — `home_sys` = эта система.
