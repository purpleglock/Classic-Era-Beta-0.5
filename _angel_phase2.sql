-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 28: ФАЗА ДВА. ОНО НЕ КОНЧИЛОСЬ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_after_fall.sql. Надмножество `_angel_fall`,
-- `_angel_take_salvo`, `angel_ai_tick`, `angel_status`.
-- ⚠️ Всё про вторую фазу вести ОТСЮДА.
--
-- ЗАЧЕМ. Первую фазу прошли ровно так, как она была устроена: 54 залпа, 45
-- попаданий, 100 печатей в ноль. Кампания работает — и именно поэтому второй
-- раз тот же счёт вести нельзя: игрок уже знает, что ответ на кризис — это
-- «построй Длань и жми ПУСК сорок раз». Вторая фаза не добавляет мяса, она
-- ЛОМАЕТ ЭТОТ ОТВЕТ и требует другого.
--
-- ДВЕ НОВЫЕ ВЕЩИ, И ОБЕ СВЯЗАНЫ ОДНОЙ ЭКОНОМИКОЙ.
--   1) ТРАНСМУТАЦИЯ. Тело И ЕГО КРЫЛЬЯ, встав над чужой колонией, перерабатывают
--      мир в себя: население уходит, печати зарастают, а излишек копится
--      ПЛОТЬЮ (`angel_state.mass`). То есть лечится оно теперь не покоем в
--      гнезде, а тем, что ест.
--   2) РАЗВОРОТ СНАРЯДА. Плоть тратится на одно: снаряд, летящий в его
--      сигнатуру, разворачивается и уходит ОБРАТНО — в столицу того, кто
--      выстрелил. Не «щит», не «шанс промаха»: тот же снаряд, тот же паспорт,
--      та же ГИБЕЛЬ МИРА, только адрес другой.
--
-- ⚠️ ПОЧЕМУ ЭТО НЕ ГЛУХАЯ СТЕНА. Разворот стоит плоти, плоть берётся только из
-- съеденных миров, а есть оно может ТОЛЬКО стоя в системе и ТОЛЬКО пока не
-- скован боем. Значит контригра честная и не одна:
--   • не дать жрать — выйти навстречу флотом: скованное боем крыло не ест;
--   • обесточить — выбить крылья, их четыре, и каждое кормит отдельно;
--   • переждать — плоть не капает сама, голодное оно снаряды не разворачивает;
--   • или всё-таки залпами, но уже считая: пока сыто, каждый ПУСК — это залп
--     по себе.
--
-- ЗАМЕРЫ, ПО КОТОРЫМ СЧИТАНЫ ЧИСЛА (живая база, 23.08):
--   • колоний в галактике 1746, население: медиана 400, среднее 405,
--     потолок 1300, дно 84;
--   • снаряд Длани снимает 2.2–3.4 печати, полный слом — 30–45 попаданий;
--   • отсюда: съеденный средний мир (400) даёт +24 печати — это восемь
--     отменённых залпов, и +40 плоти — это полтора разворота.
-- Итог размена: чтобы дожать фазу 2, надо стрелять БЫСТРЕЕ, чем оно ест, и
-- при этом не кормить его собственными снарядами.
--
-- ⚠️ ЗАБРАКОВАНО:
--   • «в фазе 2 печатей 200» — это не сложнее, это дольше. Пул тот же, 100.
--   • «оно неуязвимо к Длани» — тогда кампания против него перестаёт
--     существовать, а вместе с ней и весь смысл Арсенала.
--   • мгновенное воскрешение на месте гибели. Между смертью и вторым
--     воплощением стоит тишина в 8 часов: сводка о падении должна успеть
--     стать правдой, чтобы перестать ею быть.
-- ════════════════════════════════════════════════════════════

-- ── 0. СХЕМА ────────────────────────────────────────────────
alter table public.angel_state add column if not exists phase   int not null default 1;
alter table public.angel_state add column if not exists mass    numeric not null default 0;
alter table public.angel_state add column if not exists rise_at timestamptz;

-- Переплавка идёт мир за миром и переживает тики: доля берётся от населения
-- НА НАЧАЛО (иначе экспонента никогда не доедает последнего жителя).
create table if not exists public.angel_transmute (
  colony_id   uuid primary key,
  faction_id  text not null,
  system_id   text,
  planet_pid  int,
  planet_name text,
  pop0        numeric not null,
  taken       numeric not null default 0,
  started_at  timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  done_at     timestamptz
);
alter table public.angel_transmute enable row level security;
drop policy if exists angel_transmute_read on public.angel_transmute;
create policy angel_transmute_read on public.angel_transmute for select to authenticated using (true);
revoke insert, update, delete on public.angel_transmute from anon, authenticated;

-- ── 1. КОНСТАНТЫ ФАЗЫ ───────────────────────────────────────
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
    -- плоть и разворот
    when 'mass_cap'      then 100
    when 'reflect_cost'  then 25     -- полный бак = четыре разворота
    when 'reflect_lead'  then 25     -- минут до подлёта: позже разворачивать нечего
    when 'back_min_h'    then 0.7    -- обратный путь не короче
    when 'back_max_h'    then 6.0    -- и не длиннее
    else 0 end
$$;

-- Фаза живого (или последнего) ангела — одним числом, чтобы не тащить record.
create or replace function public._angel_phase(p_fid text default null)
returns int language sql stable security definer set search_path=public as $$
  select coalesce(max(phase), 1) from public.angel_state
   where p_fid is null or faction_id = p_fid
$$;

-- ── 2. ВТОРОЕ ВОПЛОЩЕНИЕ ────────────────────────────────────
-- Тело собирается заново по чертежу `angel_ascend`: колония-«Оплот», борт
-- класса 'angel', флот ОПЛОТ. Державу не трогаем — она уже пуста.
-- ⚠️ Реестр стражи ЧИСТИМ ПОЛНОСТЬЮ (не помечаем мёртвым, а сносим): сбор
-- пропускает строки с `dead_at`, и без этого воинство второй раз не отольётся.
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

  -- Хвосты прошлой жизни: их снёс шаг 27, но накат идемпотентный.
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
         mass = 0, press = 0, awake = true, stance = 'roost',
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
      'Обломков в квадрате нет. Сопровождение снова полное. Классификатор второй раз '
      || 'не выдал класса и во второй раз не ошибся.', 0.22)
    || ' ' || public._angel_scream(15));

  return jsonb_build_object('ok', true, 'phase', 2, 'fid', a.faction_id,
                            'home', home, 'fleet', flid, 'wall', wall, 'host', host);
end$$;
revoke all on function public._angel_rise2() from public;

-- ── 3. ГИБЕЛЬ — НАДМНОЖЕСТВО ────────────────────────────────
-- Слово в слово шаг 27, плюс развилка по фазе: из первой оно ВСТАЁТ, из
-- второй — уходит совсем.
create or replace function public._angel_fall(p_fid text, p_killer text default null)
returns void language plpgsql security definer set search_path=public as $$
declare a record; nm text; kn text; ph int;
begin
  select * into a from public.angel_state where faction_id = p_fid and fell_at is null;
  if a.faction_id is null then return; end if;
  ph := coalesce(a.phase, 1);

  select name into nm from public.faction_applications
   where faction_id = p_fid and status = 'approved' order by updated_at desc limit 1;
  select name into kn from public.faction_applications
   where faction_id = p_killer and status = 'approved' order by updated_at desc limit 1;

  -- борта нет: снимаем с доски всё, что от него осталось
  update public.battle_units set alive = false, hp = 0
   where fid = p_fid and alive;
  delete from public.fleets   where id = a.fleet_id;
  delete from public.colony_buildings where colony_id = a.colony_id;
  delete from public.colonies where id = a.colony_id;

  update public.angel_state
     set fell_at = now(), seals = 0, awake = false, stance = 'roost',
         mass = 0,
         -- ⚠️ ФАЗА 1 — НЕ КОНЕЦ: срок второго воплощения ставится здесь и
         -- никому не показывается. Из фазы 2 вставать уже нечему.
         rise_at = case when ph = 1
                        then now() + (public._angel_ph('rise_h') || ' hours')::interval
                        else null end
   where faction_id = p_fid;

  perform public._angel_news(public._angel_glitch('◈ ОНО ОСТАНОВИЛОСЬ', 0.20),
    public._angel_glitch(
      'Отметка перестала двигаться в 19:40 и погасла не сразу. ' ||
      'Крылья сложились не по порядку. Глаза закрылись не одновременно.', 0.16) ||
    ' ' || public._angel_scream(11) || ' ' ||
    case when kn is not null
         then public._angel_glitch('Последний импульс пришёл со стороны «' || kn || '».', 0.24) || ' '
         else '' end ||
    public._angel_glitch('Осталась пыль, которую нечем взвесить. Считать это победой каждый будет сам.', 0.14));

  -- Кризис разбирается в обе стороны одинаково: воинство складывается, доски
  -- разводятся, флаги снимаются (шаг 27). Разница только в том, встанет ли
  -- оно через восемь часов.
  begin perform public._angel_teardown(p_fid); exception when others then null; end;

  if ph >= 2 then
    perform public._angel_news(public._angel_glitch('◈ БОЛЬШЕ НИЧЕГО НЕ ПРИШЛО', 0.26),
      public._angel_glitch(
        'Квадрат держали под наблюдением вторые сутки. Ни отметки, ни фона, ни эха. '
        || 'Стало тихо так, как было до всего этого, и это оказалось непривычно.', 0.16)
      || ' ' || public._angel_scream(9));
  end if;
end$$;
revoke all on function public._angel_fall(text,text) from public;

-- ── 4. ТРАНСМУТАЦИЯ: МИР УХОДИТ В НЕГО ──────────────────────
-- Ест ТЕЛО И КРЫЛЬЯ одинаково: «его флоты» — это тоже оно.
-- ⚠️ Скованное боем крыло НЕ ест. Это и есть главная контригра: выйти
-- навстречу — значит остановить переплавку, ничего больше не делая.
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

      -- Мир доеден: он не взорван, он ПЕРЕПЛАВЛЕН. Камень остаётся, жить на
      -- нём больше нельзя — та же отметка, что у ГИБЕЛИ МИРА, но своя.
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

-- ── 5. РАЗВОРОТ СНАРЯДА ─────────────────────────────────────
-- ⚠️ ДЕЛАЕМ НА ПОДЛЁТЕ, А НЕ В МОМЕНТ ПОПАДАНИЯ. Так не приходится трогать
-- `_doom_resolve` (там уже сидит надмножество шага 17 со стражей), и главное —
-- развёрнутый снаряд идёт по общим правилам: он виден в `abm_incoming` новому
-- адресату, его берут Ожерелье и планетарная ПРО, у него честное время подлёта.
-- Снаряд не «отражён магией» — он просто летит в другую сторону.
create or replace function public._angel_reflect()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; s record; col record; back numeric; n int := 0; skipped int := 0;
        cost numeric; have numeric; sysname text; shooter text;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null or coalesce(a.phase,1) < 2 then
    return jsonb_build_object('ok', true, 'why', 'не та фаза');
  end if;
  cost := public._angel_ph('reflect_cost');

  for s in select ds.* from public.doom_salvos ds
            join public.fleets fl on fl.id = ds.target_fleet_id
           where ds.status = 'in_flight'
             and fl.faction_id = a.faction_id
             and ds.ready_at > now() + (public._angel_ph('reflect_lead') || ' minutes')::interval
           order by ds.ready_at
  loop
    -- плоть читаем заново на каждом снаряде: предыдущий её уже потратил
    select mass into have from public.angel_state where faction_id = a.faction_id;
    if have < cost then skipped := skipped + 1; exit; end if;

    -- Адрес возврата: столица стрелявшего, иначе самый людный его мир.
    select * into col from public.colonies
     where faction_id = s.faction_id and planet_pid is not null
     order by is_capital desc nulls last, pop desc nulls last limit 1;
    if col.id is null then skipped := skipped + 1; continue; end if;

    back := least(public._angel_ph('back_max_h'),
                  greatest(public._angel_ph('back_min_h'),
                           extract(epoch from (s.ready_at - coalesce(s.launched_at, s.ready_at))) / 3600.0));

    update public.doom_salvos
       set target_fleet_id = null,
           target_system_id = col.system_id,
           target_pid       = col.planet_pid,
           target_planet    = col.planet_name,
           victim_fid       = s.faction_id,
           ready_at         = now() + (round(back*60)::int || ' minutes')::interval,
           -- дуэль перехвата заводится заново: адресат другой, и играть в неё
           -- теперь ему (см. abm_incoming — он читает цель прямо из строки)
           duel_result = null, flak_p = null,
           def_fid = null, def_approach = null, def_window = null, def_pid = null,
           def_pick = null, def_pick_at = null, approach = null, appr_window = null,
           feint = null, boost = null
     where id = s.id;

    update public.angel_state
       set mass = greatest(0, mass - cost)
     where faction_id = a.faction_id;
    n := n + 1;

    select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = col.system_id;
    select name into shooter from public.faction_applications
     where faction_id = s.faction_id and status = 'approved' order by updated_at desc limit 1;

    -- Стрелявшему говорим прямо: это его снаряд и он возвращается. Прятать тут
    -- нечего — через час это и так будет видно в окне перехвата.
    perform public._angel_tell(s.faction_id,
      public._angel_glitch('◈ СНАРЯД РАЗВЕРНУЛСЯ', 0.24),
      public._angel_glitch(
        'Телеметрия боеголовки не пропала — она продолжает идти, но с обратным знаком. '
        || 'Снаряд лёг на новый курс сам, без коррекции с орудия, и идёт к «'
        || coalesce(col.planet_name,'?') || '» в системе «' || coalesce(sysname,'?')
        || '». Расчётное время подлёта ' || to_char(back,'FM990.0') || ' ч', 0.18)
      || ' ' || public._angel_scream(13) || ' '
      || public._angel_glitch('Перехват возможен — снаряд обычный. Необычен только адрес.', 0.14));
  end loop;

  return jsonb_build_object('ok', true, 'turned', n, 'skipped', skipped,
    'mass', (select round(mass,1) from public.angel_state where faction_id = a.faction_id));
end$$;
revoke all on function public._angel_reflect() from public;

-- ── 6. ЗАЛП ПО НЕМУ — НАДМНОЖЕСТВО ──────────────────────────
-- Слово в слово живой `_angel_take_salvo`, вставка одна: во второй фазе печать
-- рвётся хуже (`sal_mul`). Разворот сюда НЕ лезет — он выше, на подлёте.
create or replace function public._angel_take_salvo(p_fid text, p_kind text, p_from text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; pp numeric; parried boolean; lo numeric; hi numeric;
        loss numeric; seals_left numeric; mx numeric;
begin
  select * into a from public.angel_state where faction_id = p_fid and fell_at is null;
  if a.faction_id is null then
    return jsonb_build_object('ok', false, 'why', 'ангела нет');
  end if;
  mx := public._angel_const('seals_max');

  pp := public._angel_parry_p(p_fid);
  parried := (random() < pp);

  update public.angel_state
     set press = least(public._angel_const('press_cap'),
                       press + public._angel_const('press_hit')),
         last_press = now(),
         salvos_seen = salvos_seen + 1,
         salvos_parried = salvos_parried + case when parried then 1 else 0 end
   where faction_id = p_fid;

  if parried then
    return jsonb_build_object('ok', true, 'parried', true, 'parry_p', pp,
                              'seals', round(a.seals, 1),
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
                            'frac', round(seals_left / mx, 3),
                            'fell', (seals_left <= 0));
end$$;
revoke all on function public._angel_take_salvo(text,text,text) from public;

-- ── 7. ТИК — НАДМНОЖЕСТВО ───────────────────────────────────
-- Воплощение ПЕРВЫМ: пока оно мёртво, все остальные шаги выходят с «ангела
-- нет», и без этой строки второй фазы просто не наступит.
create or replace function public.angel_ai_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare out jsonb := '{}'::jsonb;
begin
  begin out := out || jsonb_build_object('rise',   public._angel_rise2());      exception when others then null; end;
  begin out := out || jsonb_build_object('orders', public._angel_host_orders()); exception when others then null; end;
  begin out := out || jsonb_build_object('board',  public.angel_battle_tick());  exception when others then null; end;
  begin out := out || jsonb_build_object('war',    public.angel_war_tick());     exception when others then null; end;
  begin out := out || jsonb_build_object('melt',   public._angel_transmute());   exception when others then null; end;
  begin out := out || jsonb_build_object('turn',   public._angel_reflect());     exception when others then null; end;
  begin out := out || jsonb_build_object('barrage', public._angel_barrage());    exception when others then null; end;
  return out || jsonb_build_object('ok', true);
end$$;
revoke all on function public.angel_ai_tick() from public;

-- ── 8. СВОДКА СОСТОЯНИЯ — НАДМНОЖЕСТВО ──────────────────────
-- Наружу добавлены только `phase` и то, что и так станет видно: сколько миров
-- сейчас переплавляется. Плоть и печати — по-прежнему только своей стороне.
create or replace function public.angel_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; me text; mine boolean; f record; frac numeric; sysname text;
begin
  select * into a from public.angel_state order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', true, 'exists', false); end if;
  begin me := public._ec_my_fid_opt(); exception when others then me := null; end;
  mine := (me is not null and me = a.faction_id);

  select * into f from public.fleets where id = a.fleet_id;
  select coalesce(nullif(name,''), id) into sysname from public.map_systems
   where id = coalesce(f.system_id, f.from_sys, a.home_sys);
  frac := greatest(0, least(1, a.seals / nullif(public._angel_const('seals_max'), 0)));

  return jsonb_build_object(
    'ok', true, 'exists', true, 'fid', a.faction_id, 'mine', mine,
    'fell', (a.fell_at is not null), 'fell_at', a.fell_at,
    'phase', coalesce(a.phase, 1),
    'melting', (select count(*)::int from public.angel_transmute where done_at is null),
    'melted',  (select count(*)::int from public.angel_transmute where done_at is not null),
    -- ⚠️ СПИСОК ПЕРЕПЛАВЛЯЕМЫХ МИРОВ ВИДЯТ ВСЕ. Прятать нечего: над колонией
    -- пять часов стоит то, что видно с любой орбиты, и владелец уже получил
    -- депешу. Карта рисует по этому списку метку — иначе главная механика
    -- фазы происходит там, куда игрок не смотрит.
    'melting_list', (select coalesce(jsonb_agg(jsonb_build_object(
        'system_id', t.system_id, 'planet', t.planet_name,
        'frac', round(least(1, t.taken / nullif(t.pop0,0)), 3),
        'started_at', t.started_at) order by t.started_at), '[]'::jsonb)
      from public.angel_transmute t where t.done_at is null),
    'stance', a.stance, 'system', sysname,
    'moving', (f.status = 'transit'), 'arrive_at', f.arrive_at,
    'fleet', a.fleet_id,
    'guards', public._angel_guard_left(),
    'guards_all', (select count(*)::int from public.angel_guard),
    'seals_frac', case when mine then round(frac, 3) end,
    'seals_word', case when mine then
                    case when a.fell_at is not null then 'пал'
                         when frac > 0.85 then 'целы'
                         when frac > 0.6  then 'тронуты'
                         when frac > 0.35 then 'рвутся'
                         when frac > 0.12 then 'на исходе'
                         else 'последняя' end
                  else public._angel_scream(7) end,
    'salvos_seen', case when mine then a.salvos_seen end,
    'salvos_parried', case when mine then a.salvos_parried end,
    'seals', case when mine then round(a.seals, 1) end,
    'mass',  case when mine then round(a.mass, 1) end,
    'mass_frac', case when mine then round(a.mass / nullif(public._angel_ph('mass_cap'),0), 3) end,
    'press', case when mine then round(a.press, 2) end,
    'parry', case when mine then public._angel_parry_p(a.faction_id) end);
end$$;
revoke all on function public.angel_status() from public, anon;
grant execute on function public.angel_status() to authenticated, anon;

notify pgrst, 'reload schema';

-- ── 9. ВКЛЮЧЕНИЕ ФАЗЫ ДЛЯ ТОГО, КТО УЖЕ ПАЛ ─────────────────
-- Ангел пал 22.08 в 18:44, когда развилки по фазе ещё не было, и срок ему
-- никто не ставил. Восемь часов тишины он уже отстоял с запасом — поднимаем
-- сразу, в этом же накате, чтобы вторая фаза началась не «когда-нибудь».
do $$
declare r jsonb;
begin
  update public.angel_state
     set rise_at = least(now(), coalesce(fell_at, now()) + (public._angel_ph('rise_h') || ' hours')::interval)
   where fell_at is not null and coalesce(phase,1) = 1 and rise_at is null;

  begin
    r := public._angel_rise2();
    raise notice 'воплощение: %', r;
  exception when others then raise notice 'воплощение не вышло: %', sqlerrm;
  end;
end$$;

-- ── ПРОВЕРКА ────────────────────────────────────────────────
-- 1) `update angel_state set rise_at = now()` → следующий тик (или
--    `select _angel_rise2()`) поднимает тело: phase=2, печати полные, плоть 0,
--    ОПЛОТ и воинство на месте, в ленте «ОНО НЕ КОНЧИЛОСЬ».
-- 2) Крыло встало над чужой колонией → в `angel_transmute` строка, владельцу
--    ушла депеша «НАЧАЛОСЬ»; через 5 часов мир переплавлен, планета помечена
--    `melted`, у ангела +печати и +плоть.
-- 3) Завязать бой с этим крылом → укусы прекращаются, пока бой идёт.
-- 4) Выстрелить по нему Дланью при плоти ≥ 25 → снаряд в `doom_salvos`
--    сменил адрес на столицу стрелявшего, плоть −25, снаряд виден в
--    `abm_incoming` у нового адресата и сбивается обычной ПРО.
-- 5) Плоть 0 → разворотов нет, залпы доходят (но снимают 0.7 от прежнего).
