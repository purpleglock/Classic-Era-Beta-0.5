-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 33: НЕОТВРАТИМОСТЬ ВМЕСТО СКОРОСТИ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_not_a_bag.sql (шаг 29) и _angel_clock.sql.
-- Надмножество `_angel_ph`, `_angel_transmute`, `_angel_clock_const`.
-- Идемпотентно. Уже съеденное НЕ пересчитывается: якоря и `taken` на месте.
--
-- ЖАЛОБА: «слишком быстро хавает игроков; кризис должен быть про
-- неотвратимость, а не про скорость — от этой хуйни фиг законтришься».
--
-- ЧТО БЫЛО ПОСЧИТАНО ПО ЖИВЫМ ЧИСЛАМ (25.08).
--   • укус раз в ЧАС по 20% НАЧАЛЬНОГО населения → мир мёртв за 5 часов;
--   • ест КАЖДЫЙ борт: и ковчег, и любое крыло, стоящее в системе;
--   • ест ВСЕ колонии системы ОДНОВРЕМЕННО — циклы у них независимые;
--   • колония на нуле удаляется, планета становится «Переплавленным миром»
--     навсегда.
--   Складываем: два крыла садятся в систему из трёх миров вечером — к утру
--   системы нет. Игрок, заходящий раз в сутки, не видит НИ ОДНОГО хода
--   кризиса: он видит результат. Контрить нечего, потому что контрить уже
--   поздно к моменту, когда узнал.
--
-- ⚠️ ДИАГНОЗ: это не «сильный кризис», это КОРОТКИЙ. Давления он не создаёт
-- вовсе — давление требует времени, в течение которого ты знаешь, что тебя
-- едят, и решаешь, чем платить. У нас между «началось» и «мира нет» помещался
-- один сон.
--
-- ТРИ ПРАВКИ.
--
--   1) ТЕМП. Укус раз в 3 часа по 10% начального населения → мир держится
--      ~30 часов вместо 5. Прогресс укуса НЕ СБРАСЫВАЕТСЯ никогда: отогнал —
--      оно вернётся и доест с того места, где остановилось (`angel_transmute`
--      живёт до `done_at`). Вот это и есть неотвратимость: не быстро, но
--      обратно уже не отрастёт.
--
--   2) КРЫЛО ЕСТ ВЧЕТВЕРО СЛАБЕЕ ТЕЛА. Полноценно жрёт только ковчег
--      (`angel_state.fleet_id`), крылья — 0.25 от укуса. Теперь важно, ГДЕ
--      ТЕЛО: рой крыльев по карте перестаёт быть равномерным геноцидом и
--      становится тем, чем должен, — оцеплением. Мир, над которым висит
--      только крыло, умирает пять суток; у игрока есть время дойти.
--      ⚠️ Ковчег в системе всегда ходит ПЕРВЫМ (order by), иначе крыло
--      успевало откусить свой слабый кусок и закрыть цикл телу на 3 часа.
--
--   3) ОДНА КОЛОНИЯ ЗА РАЗ В СИСТЕМЕ. Переплавляется ровно один мир:
--      начатый (`done_at is null`), а если начатого нет — самый населённый.
--      Остальные ЖДУТ очереди и живут полной жизнью. Система умирает по
--      одному миру, а не целиком; каждый доеденный мир — отдельная новость и
--      отдельный повод прийти.
--
-- ⚠️ ПОРОГ ВОЗНЕСЕНИЯ 150 000 → 60 000. При темпе в шесть раз медленнее
-- старый порог означал бы, что финала не будет никогда, — а кризис без конца
-- это опять фон (ровно та беда, от которой заводились часы, _angel_clock).
-- Съедено на сейчас ~7 400; новый порог — это ~1/12 населения галактики и
-- обозримая, но долгая дорога.
--
-- ⚠️ ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. «Присутствие флота ставит кормление на паузу»
-- и «эвакуация населения» обсуждались и НЕ берутся: первое делает ответом
-- один припаркованный корвет (ровно то, что уже забраковано в
-- angel-cannot-be-gripped), второе — новая большая механика перевозки
-- населения, которой в игре нет ни для чего другого.
-- ════════════════════════════════════════════════════════════

-- ── 1. КОНСТАНТЫ ФАЗЫ — НАДМНОЖЕСТВО ────────────────────────
-- Слово в слово шаг 29, изменены `cycle_h`/`take_frac`, добавлен `wing_mul`.
-- ⚠️ Функция immutable и переписывается ЦЕЛИКОМ в каждом ангельском файле:
-- дописывать ключ «сверху» нельзя — унесёт следующим накатом
-- (defense-const-clobber).
create or replace function public._angel_ph(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'rise_h'        then 8      -- часов тишины между гибелью и вторым воплощением
    when 'sal_mul'       then 0.7    -- залп снимает меньше: оно уже умирало однажды
    -- трансмутация
    when 'cycle_h'       then 3      -- укус раз в три часа на мир (было 1)
    when 'take_frac'     then 0.10   -- доля НАЧАЛЬНОГО населения за укус → ~30 часов на мир
    when 'wing_mul'      then 0.25   -- крыло откусывает вчетверо меньше тела
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

-- ── 2. ЧАСЫ: ПОРОГ ──────────────────────────────────────────
create or replace function public._angel_clock_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'goal' then 60000    -- население, после которого партия кончается
    else 0 end
$$;

-- ── 3. ПЕРЕПЛАВКА — НАДМНОЖЕСТВО ────────────────────────────
-- Слово в слово шаг 29, три вставки: порядок бортов, множитель крыла и
-- выбор ОДНОЙ колонии на систему.
create or replace function public._angel_transmute()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; f record; c record; t record; take numeric; seal numeric; ms numeric;
        started int := 0; bites int := 0; eaten int := 0; sysname text;
        arr jsonb; newpl jsonb; el jsonb; i int; onm text;
        mul numeric; hrs numeric;
begin
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
end$$;
revoke all on function public._angel_transmute() from public;

notify pgrst, 'reload schema';

-- ── ПРОВЕРКА ────────────────────────────────────────────────
-- 1) select _angel_ph('cycle_h'), _angel_ph('take_frac'), _angel_ph('wing_mul');
--    → 3 · 0.10 · 0.25
-- 2) select _angel_clock_const('goal'); → 60000, и `angel_clock()->>'pct'`
--    вырастает ровно в 2.5 раза (число съеденного не тронуто).
-- 3) В системе с двумя и более чужими колониями: `angel_transmute` заводится
--    РОВНО на одну, вторая живёт (pop не убывает).
-- 4) Крыло над миром pop0=400: укус 10, ковчег там же — 40.
-- 5) Отогнать оба борта из системы → `angel_transmute` строка остаётся с
--    прежним `taken`; вернулись — доедают с того же места, а не сначала.
