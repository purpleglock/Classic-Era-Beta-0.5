-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 1: ДЕРЖАВА-АНГЕЛ. ФЛОТ, КОТОРЫЙ И ЕСТЬ ПЛАНЕТА
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _economy_setup.sql (colonies/colony_buildings/colony_projects),
-- _army_fleet.sql (fleets), _map_sectors.sql, _doom_shells.sql (btype nemesis),
-- _fleet_logistics.sql (fuel/аванпосты). Дальше по цепочке:
--   _angel_battle.sql → _angel_shells.sql → _angel_ai.sql
-- Идемпотентно, катится повторно.
--
-- ЗАМЫСЕЛ. Обычная держава — это сумма планет: сотри планеты, и державы нет.
-- Ангел устроен наоборот. У него ОДНО тело: корабль-ковчег, который
-- одновременно борт на доске боя и колония с 20 ячейками. Он не сидит в
-- системе — он идёт по галактике, и его «планета» идёт вместе с ним.
--
-- ПОЧЕМУ КОЛОНИЯ, А НЕ НОВАЯ СУЩНОСТЬ. Соблазн был завести angel_slots и
-- своё хозяйство. Не стали: economy_accrue не смотрит ни в map_systems, ни в
-- planet_pid, ни в planet_type — доход считается по colonies + colony_buildings.
-- Значит колония с planet_pid = null и КОЧУЮЩИМ system_id работает как есть:
-- заводы платят, храмы платят, институты дают ОН, склад копит. Двадцать ячеек
-- ковчега — это просто colonies.cells = 20. Ни одной строки экономики не
-- переписано, а «флот и есть планета» — правда на уровне данных, а не на
-- уровне надписи в интерфейсе.
--
-- ЧТО ТЕРЯЕТ АНГЕЛ. Всё остальное: колонии, аванпосты, армии, границы. Он
-- физически не может расползтись по карте — терять нечего, отобрать нечего,
-- осадить нечего. Поэтому и воюет он не как держава, а как кризис: приходит,
-- жжёт, уходит. Отсюда же его слабость — ОДНА цель. Убей ковчег, и державы
-- нет вообще; никаких «остались колонии на окраине».
--
-- ВОЗВРАТ. angel_ascend() перед сносом кладёт ВСЁ хозяйство в angel_relic
-- (jsonb-слепок), а angel_descend() поднимает обратно. Преображение —
-- операция обратимая, и это не любезность, а требование: иначе одна опечатка
-- в балансе стоила бы игроку 24 колонии без права на откат.
-- ════════════════════════════════════════════════════════════

-- ── 1. СОСТОЯНИЕ АНГЕЛА ─────────────────────────────────────
-- Одна строка на державу-ангела. Кто ангел — определяется НАЛИЧИЕМ строки,
-- а не константой в коде: так ангела можно назначить (и снять) без наката.
create table if not exists public.angel_state (
  faction_id     text primary key,
  unit_id        uuid,            -- проект «Престол» в faction_units
  fleet_id       uuid,            -- флот-ковчег (ровно один борт)
  colony_id      uuid,            -- тело ковчега как колония на 20 ячеек
  -- ПЕЧАТИ: 100 → 0. Единственная полоса жизни ангела. В бою не тратится
  -- никогда, снимается только залпами Длани и Гиперпейсера (см. _angel_shells).
  seals          numeric not null default 100,
  -- ДАВЛЕНИЕ: сколько залпов пришло НЕДАВНО. Гасит парирование (см. ниже),
  -- тает с полураспадом. Смысл: одиночный выстрел ангел отбивает, вал — нет.
  press          numeric not null default 0,
  awake          boolean not null default true,
  stance         text    not null default 'march',   -- march | siege | roost
  target_sys     text,            -- куда идёт сейчас
  home_sys       text,            -- откуда вознёсся; там же зализывает печати
  last_hit       timestamptz,     -- когда последний раз пробили печать
  last_press     timestamptz not null default now(),
  last_regen     timestamptz not null default now(),
  salvos_seen    int not null default 0,   -- всего залпов по ангелу
  salvos_parried int not null default 0,   -- из них отбито
  fell_at        timestamptz,     -- когда пал (null — жив)
  created_at     timestamptz not null default now()
);
-- Печати и давление — внутренняя кухня: читать их напрямую нельзя никому,
-- наружу они идут только через angel_status() (там же и цензура).
alter table public.angel_state enable row level security;

-- Слепок хозяйства до преображения — единственная дорога назад.
create table if not exists public.angel_relic (
  faction_id text primary key,
  snap       jsonb not null,
  taken_at   timestamptz not null default now()
);
alter table public.angel_relic enable row level security;

-- ── 2. КТО ТУТ АНГЕЛ ────────────────────────────────────────
-- Один источник правды. Зовут и бой, и резолв залпов, и ИИ, и клиент.
create or replace function public._angel_fid()
returns text language sql stable security definer set search_path=public as $$
  select faction_id from public.angel_state order by created_at limit 1
$$;

create or replace function public._angel_is(p_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select p_fid is not null
     and exists(select 1 from public.angel_state a
                 where a.faction_id = p_fid and a.fell_at is null)
$$;

-- Живой ангел: и строка есть, и печати целы. Пал — уже не ангел, а обломки.
create or replace function public._angel_alive(p_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.angel_state a
                 where a.faction_id = p_fid and a.fell_at is null
                   and a.awake and a.seals > 0)
$$;

-- ── 3. БАЛАНС ───────────────────────────────────────────────
-- ПОЧЕМУ ИМЕННО ТАК. Задача была: «30-45 залпов Длани и потом всё», но при
-- этом не сверхимба. Одного числа хватило бы на «танкануть 35 залпов», но
-- тогда ангела убивала бы ОДНА пушка за месяц капания по залпу в сутки —
-- скучно и не похоже на кризис. Поэтому печати сняты в трёхслойную механику:
--
--   1) ПАРИРОВАНИЕ. В покое ангел отбивает ~72% залпов. Это не броня и не
--      ПРО: он видит снаряд и уходит с траектории. Одиночный выстрел почти
--      бесполезен — 3 из 4 в пустоту.
--   2) ДАВЛЕНИЕ. Каждый ПРИШЕДШИЙ залп (даже отбитый, даже пустой) добавляет
--      давления. Парирование гаснет по exp(-k·press): при давлении ~6 ангел
--      отбивает уже 6%. Нужен ВАЛ в узком окне, а не обстрел по расписанию.
--      Полураспад давления 3 часа — окно короткое, координация обязательна.
--   3) РЕГЕНЕРАЦИЯ. Печати зарастают 1.6/час, но ТОЛЬКО в покое (5 часов без
--      попаданий). Значит капать нельзя вовсе: сутки покоя = +38 печатей,
--      это больше, чем даст ленивый обстрел. Кампанию надо доводить.
--
-- Итого при нормальном подавлении (press≈6, парирование 6.5%): залп снимает
-- в среднем 2.8·0.935 ≈ 2.6 печати → 38 залпов Длани. Ровно вилка 30-45.
-- Гиперпейсер печати почти не рвёт (0.5-1.1), но давление даёт такое же —
-- он и есть инструмент ПОДАВЛЕНИЯ, дешёвый и быстрый. Отсюда честная тактика:
-- глушить баллистикой, добивать Дланью. Одной Дланью в одиночку — никогда.
create or replace function public._angel_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    -- печати
    when 'seals_max'   then 100
    when 'doom_min'    then 2.2    -- печатей за снаряд Длани
    when 'doom_max'    then 3.4    -- → 30..45 залпов на полный слом
    when 'ball_min'    then 0.5    -- печатей за баллистику Гиперпейсера
    when 'ball_max'    then 1.1
    -- регенерация
    when 'regen_h'     then 1.6    -- печатей в час покоя
    when 'calm_h'      then 5      -- часов без попаданий = покой
    when 'roost_mul'   then 2.0    -- в гнезде (home_sys, stance=roost) зарастает вдвое
    -- парирование
    when 'parry_base'  then 0.72   -- шанс отбить залп в полном покое
    when 'parry_floor' then 0.04   -- ниже не падает: абсолютных гарантий нет
    when 'parry_k'     then 0.55   -- крутизна подавления по давлению
    -- давление
    when 'press_hit'   then 1.0    -- за каждый пришедший залп
    when 'press_half_h' then 3     -- полураспад давления, часов
    when 'press_cap'   then 12     -- потолок: сверх него подавлять некуда
    -- тело ковчега
    when 'ark_cells'   then 20     -- ячеек под постройки ИИ
    when 'ark_pop'     then 4000   -- «население» ковчега (рабочие руки)
    -- порог тревоги: ниже этой доли печатей ангел уходит в гнездо лечиться
    when 'flee_frac'   then 0.28
    when 'back_frac'   then 0.72   -- и возвращается на войну, зарастив до этой
    else 0 end
$$;

-- ── 4. ГОЛОС ────────────────────────────────────────────────
-- ⚠️ ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: игрок НИКОГДА не читает объяснения, как
-- ангел устроен и чем его берут. Ни в сводках, ни в журнале боя, ни в панели.
-- Причина не в загадочности ради загадочности: как только правило написано
-- словами, кризис превращается в задачу с известным ответом, и весь ужас
-- становится арифметикой. Способ убийства галактика должна НАЩУПАТЬ сама —
-- заметить, что одиночные выстрелы бесполезны, что пауза всё откатывает,
-- что вдвоём получается, а поодиночке нет.
--
-- Поэтому всё, что оно «говорит», проходит через порчу сигнала: приборы
-- пишут, датчики врут, половина букв не доезжает. Читается как сбой связи,
-- а не как справка.
--
-- ПОРЧА. Пробелы и длину слов бережём — иначе выходит не испорченный текст,
-- а каша, и глаз перестаёт его читать вовсе. Меняем ДОЛЮ букв на глифы
-- помех: рамки, блоки, геометрия. Диакритику не берём — она рвёт строку
-- на части шрифтов и превращает страх в мусор.
create or replace function public._angel_glitch(p_text text, p_rate numeric default 0.30)
returns text language plpgsql immutable as $$
declare gl text[] := array['▓','░','▒','█','╳','╬','┼','◹','◺','⌁','⟊','⟟','⍜','⏢','⨯','⩫','◈','▚','▞','▟'];
        out text := ''; ch text; i int;
begin
  if p_text is null then return null; end if;
  for i in 1 .. length(p_text) loop
    ch := substr(p_text, i, 1);
    if ch = ' ' or ch = e'\n' then out := out || ch;
    elsif random() < p_rate then out := out || gl[1 + floor(random() * array_length(gl,1))::int];
    else out := out || ch;
    end if;
  end loop;
  return out;
end$$;

-- Чистый шум — туда, где раньше стояло бы объяснение. Именно ПУСТОТА на месте
-- ответа пугает сильнее, чем страшный ответ.
create or replace function public._angel_scream(p_len int default 12)
returns text language plpgsql immutable as $$
declare gl text[] := array['▓','░','▒','█','╳','╬','┼','⌁','⟊','⟟','⍜','⏢','⨯','⩫','▚','▞','▟'];
        out text := ''; i int;
begin
  for i in 1 .. greatest(1, p_len) loop
    out := out || gl[1 + floor(random() * array_length(gl,1))::int];
  end loop;
  return out;
end$$;

-- Ангел говорит редко и в сектор: он событие галактики, а не переписка держав.
create or replace function public._angel_news(p_title text, p_body text)
returns void language plpgsql security definer set search_path=public as $$
begin
  begin
    perform public._post_sector_news(p_title, p_body, 'rgba(250,240,190,0.55)');
  exception when others then null;   -- лента не критична для механики
  end;
end$$;

-- Личное — тому, кого это касается (жертве удара, хозяину сбитого флота).
create or replace function public._angel_tell(p_fid text, p_title text, p_body text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_fid is null then return; end if;
  begin
    perform public._war_news(p_title, p_body, jsonb_build_array(p_fid));
  exception when others then null;
  end;
end$$;

-- ── 5. ПАСПОРТ «ПРЕСТОЛА» ───────────────────────────────────
-- Сводка проекта: по ней считают вместимость, зенитки, карточки в интерфейсе.
-- Боевые числа борта на доске берутся НЕ отсюда (см. _angel_battle.sql):
-- у ангела своя ведомость, иначе он бы зависел от каталога модулей, которых
-- у него нет вовсе — ни одного отсека, ни одной турели.
create or replace function public._angel_summary()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'hp', 900000, 'armor', 4000, 'shield', 0, 'dmg', 90000,
    'speed', 7, 'rng', 30, 'radar', 30, 'cargo', 0, 'crew', 0,
    'mass', 0, 'price', 0,
    'armor_resist', jsonb_build_object('kinetic', 0.9, 'energy', 0.9, 'missile', 0.9),
    'mods', jsonb_build_object('sensor', 12, 'stealth', 0, 'pd', 0.6,
                               'dejam', 12, 'eccm', 12, 'jam', 8,
                               'interdict', true, 'stabil', true, 'ftl', true,
                               'hangar', 0))
$$;

-- Стабильный id проекта: один и тот же при каждом накате, иначе повторное
-- вознесение плодило бы «Престолов» в списке проектов державы.
create or replace function public._angel_unit_id(p_fid text)
returns uuid language sql immutable as $$
  select ('a0000000-0000-4000-8000-' || substr(md5('angel:' || p_fid), 1, 12))::uuid
$$;

-- ── 6. ВОЗНЕСЕНИЕ ───────────────────────────────────────────
-- Снимает державу с планет и собирает её в один борт. ОБРАТИМО: слепок
-- ложится в angel_relic целиком, до единой постройки.
create or replace function public.angel_ascend(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app record; snap jsonb; home text; uid uuid; ecoown uuid;
        cid uuid; flid uuid; ncol int; nbld int; nsys int; nout int;
begin
  -- ⚠️ ЗАСОВ. Одних грантов мало: `create or replace` возвращает права по
  -- умолчанию, и дверь открывается молча (так и вышло — см. _angel_lock.sql).
  -- Проверка в теле теряется только вместе с самой функцией.
  perform public._angel_staff_only();

  select * into app from public.faction_applications
   where faction_id = p_fid and status = 'approved'
   order by updated_at desc limit 1;
  if app.faction_id is null then
    return jsonb_build_object('ok', false, 'why', 'держава не найдена или не одобрена');
  end if;
  if exists(select 1 from public.angel_state where faction_id = p_fid) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select owner_id into ecoown from public.faction_economy where faction_id = p_fid;

  -- ── 6.1 СЛЕПОК: всё, что сейчас снесём
  select jsonb_build_object(
    'at', now(),
    'colonies', coalesce((select jsonb_agg(to_jsonb(c)) from public.colonies c
                           where c.faction_id = p_fid), '[]'::jsonb),
    'buildings', coalesce((select jsonb_agg(to_jsonb(b)) from public.colony_buildings b
                            where b.faction_id = p_fid), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(to_jsonb(pr)) from public.colony_projects pr
                            where pr.faction_id = p_fid), '[]'::jsonb),
    'outposts', coalesce((select jsonb_agg(to_jsonb(o)) from public.outposts o
                           where o.faction_id = p_fid), '[]'::jsonb),
    'systems', coalesce((select jsonb_agg(s.id) from public.map_systems s
                          where s.faction = p_fid), '[]'::jsonb),
    'armies', coalesce((select jsonb_agg(to_jsonb(a)) from public.armies a
                         where a.faction_id = p_fid), '[]'::jsonb))
    into snap;

  insert into public.angel_relic(faction_id, snap) values (p_fid, snap)
    on conflict (faction_id) do update set snap = excluded.snap, taken_at = now();

  -- ── 6.2 ГНЕЗДО: столичная система остаётся точкой возврата
  select c.system_id into home from public.colonies c
   where c.faction_id = p_fid order by c.is_capital desc nulls last, c.created_at limit 1;
  home := coalesce(home, app.system_id);

  select count(*) into ncol from public.colonies where faction_id = p_fid;
  select count(*) into nbld from public.colony_buildings where faction_id = p_fid;
  select count(*) into nout from public.outposts where faction_id = p_fid;
  select count(*) into nsys from public.map_systems where faction = p_fid;

  -- ── 6.3 ОПУСТОШЕНИЕ. Земля отпущена, стройки отменены, гарнизонов нет.
  --      Порядок важен: проекты и постройки уйдут каскадом за колониями, но
  --      сносим явно — часть строк могла остаться от чужих слоёв (унии).
  delete from public.colony_projects  where faction_id = p_fid;
  delete from public.colony_buildings where faction_id = p_fid;
  delete from public.colonies         where faction_id = p_fid;
  delete from public.outposts         where faction_id = p_fid;
  delete from public.armies           where faction_id = p_fid;
  update public.map_systems set faction = null where faction = p_fid;

  -- ── 6.4 ТЕЛО: колония-ковчег. planet_pid = null намеренно — этой планеты
  --      нет ни в одной системе, она движется вместе с флотом.
  insert into public.colonies(faction_id, owner_id, system_id, planet_name, planet_type,
                              cells, planet_pid, is_capital, pop, resources)
    values (p_fid, ecoown, home, 'Оплот', 'Структура',
            public._angel_const('ark_cells')::int, null, true,
            public._angel_const('ark_pop'), '[]'::jsonb)
    returning id into cid;

  -- ── 6.5 БОРТ: проект «Престол». Одна строка, стабильный id.
  uid := public._angel_unit_id(p_fid);
  insert into public.faction_units(id, category, name, faction_id, faction_name,
                                   faction_color, owner_id, summary, data, card_text)
    values (uid, 'ship', 'Престол', p_fid, app.name, app.color, ecoown,
            public._angel_summary(),
            jsonb_build_object('class', 'angel', 'angel', true,
                               'layout', jsonb_build_object('mounts', '[]'::jsonb),
                               'weapons', '[]'::jsonb, 'modules', '[]'::jsonb),
            'Шесть крыл, и под каждым — глаза. Оно не отвечает на вопросы.')
    on conflict (id) do update
      set summary = excluded.summary, data = excluded.data,
          faction_id = excluded.faction_id, name = excluded.name;

  -- ── 6.6 ФЛОТ: ровно один борт. Бак условный — ангелу не нужны заправки,
  --      но поля бака читает вся логистика, поэтому держим их полными.
  insert into public.fleets(faction_id, owner_id, name, status, system_id, home_sys,
                            composition, is_station, fuel, fuel_cap)
    values (p_fid, ecoown, 'ОПЛОТ', 'idle', home, home,
            jsonb_build_array(jsonb_build_object('unit_id', uid, 'qty', 1)),
            false, 99, 99)
    returning id into flid;

  insert into public.angel_state(faction_id, unit_id, fleet_id, colony_id,
                                 seals, home_sys, target_sys, stance)
    values (p_fid, uid, flid, cid,
            public._angel_const('seals_max'), home, home, 'roost');

  perform public._angel_news(public._angel_glitch('◈ ОНО ВСТАЛО', 0.22),
    public._angel_glitch(
      'Связь с державой «' || app.name || '» оборвалась в 04:11 и больше не восстанавливалась. ' ||
      'Первыми отказали дальние посты, потом орбита, потом сама столица. ' ||
      'Последняя телеметрия шла ещё двенадцать минут и не содержала слов.', 0.18) ||
    ' ' || public._angel_scream(9) || ' ' ||
    public._angel_glitch('Приборы ведут одну отметку. Классификатор не выдал класса.', 0.34) ||
    ' ' || public._angel_scream(14));

  return jsonb_build_object('ok', true, 'fid', p_fid, 'colony', cid, 'fleet', flid,
    'unit', uid, 'home', home,
    'razed', jsonb_build_object('colonies', ncol, 'buildings', nbld,
                                'outposts', nout, 'systems', nsys));
end$$;
revoke all on function public.angel_ascend(text) from public;

-- ── 7. НИЗВЕРЖЕНИЕ (дорога назад) ───────────────────────────
-- Поднимает хозяйство из слепка и снимает с державы ангельский статус.
-- Нужно ровно для одного: если баланс окажется людоедским, партию можно
-- вернуть в исходное состояние, а не переигрывать.
create or replace function public.angel_descend(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare rel record; a record; e jsonb; n int := 0;
begin
  perform public._angel_staff_only();   -- ⚠️ см. засов в angel_ascend выше
  select * into rel from public.angel_relic where faction_id = p_fid;
  if rel.faction_id is null then
    return jsonb_build_object('ok', false, 'why', 'слепка нет — восстанавливать нечего');
  end if;
  select * into a from public.angel_state where faction_id = p_fid;

  -- сносим тело
  if a.faction_id is not null then
    delete from public.fleets   where id = a.fleet_id;
    delete from public.colonies where id = a.colony_id;
    delete from public.angel_state where faction_id = p_fid;
  end if;
  delete from public.colonies where faction_id = p_fid;

  -- поднимаем колонии, потом постройки (у построек ссылка на колонию)
  for e in select value from jsonb_array_elements(rel.snap->'colonies') loop
    insert into public.colonies select * from jsonb_populate_record(null::public.colonies, e)
      on conflict (id) do nothing;
    n := n + 1;
  end loop;
  for e in select value from jsonb_array_elements(rel.snap->'buildings') loop
    insert into public.colony_buildings
      select * from jsonb_populate_record(null::public.colony_buildings, e)
      on conflict (id) do nothing;
  end loop;
  for e in select value from jsonb_array_elements(rel.snap->'outposts') loop
    insert into public.outposts select * from jsonb_populate_record(null::public.outposts, e)
      on conflict (id) do nothing;
  end loop;
  for e in select value from jsonb_array_elements(coalesce(rel.snap->'projects','[]'::jsonb)) loop
    insert into public.colony_projects
      select * from jsonb_populate_record(null::public.colony_projects, e)
      on conflict (id) do nothing;
  end loop;
  for e in select value from jsonb_array_elements(coalesce(rel.snap->'armies','[]'::jsonb)) loop
    insert into public.armies select * from jsonb_populate_record(null::public.armies, e)
      on conflict (id) do nothing;
  end loop;
  for e in select value from jsonb_array_elements(coalesce(rel.snap->'systems','[]'::jsonb)) loop
    update public.map_systems set faction = p_fid where id = (e #>> '{}');
  end loop;

  return jsonb_build_object('ok', true, 'colonies', n);
end$$;
revoke all on function public.angel_descend(text) from public;

-- ── 8. ТЕЛО ИДЁТ ВМЕСТЕ С ФЛОТОМ ────────────────────────────
-- Колония-ковчег обязана стоять там, где стоит борт. Иначе получилась бы
-- шизофрения: планета осталась в одной системе, ангел ушёл в другую, и
-- экономика считалась бы по чужому небу.
-- Флот в прыжке (status='transit') — тело числим по СИСТЕМЕ ВЫЛЕТА: ковчег
-- в пути никому не принадлежит, но откуда-то доход всё равно идти должен.
create or replace function public._angel_sync_body()
returns void language plpgsql security definer set search_path=public as $$
declare a record; sys text;
begin
  for a in select * from public.angel_state where fell_at is null loop
    select coalesce(f.system_id, f.from_sys) into sys
      from public.fleets f where f.id = a.fleet_id;
    if sys is null then continue; end if;
    update public.colonies set system_id = sys
     where id = a.colony_id and system_id is distinct from sys;
  end loop;
end$$;
revoke all on function public._angel_sync_body() from public;

-- ── 9. ЗАПРЕТ НА ОЖЕРЕЛЬЕ ───────────────────────────────────
-- Ожерелье Немезиды снимает ЛЮБОЙ залп Длани и Гиперпейсера гарантированно.
-- Ангел с Ожерельем — не сложный противник, а неубиваемый: единственная
-- дорога к его печатям закрывается наглухо. Поэтому запрет жёсткий и стоит
-- на данных, а не на вежливости ИИ: даже если кто-то позовёт nemesis_build
-- руками или чужой слой перепишет выбор построек, ячейка не появится.
create or replace function public._angel_no_nemesis()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if NEW.btype = 'nemesis' and public._angel_is(NEW.faction_id) then
    raise exception 'Ожерелье Немезиды ангелу недоступно: оно сделало бы его неуязвимым';
  end if;
  return NEW;
end$$;
drop trigger if exists trg_angel_no_nemesis_b on public.colony_buildings;
create trigger trg_angel_no_nemesis_b before insert on public.colony_buildings
  for each row execute function public._angel_no_nemesis();
drop trigger if exists trg_angel_no_nemesis_p on public.colony_projects;
create trigger trg_angel_no_nemesis_p before insert on public.colony_projects
  for each row execute function public._angel_no_nemesis();

-- ── 10. СВОДКА ──────────────────────────────────────────────
-- Печати наружу отдаём ДОЛЕЙ и словом, а не числом: враг должен понимать,
-- близко ли конец, но не считать точный остаток и не подбирать залпы под
-- калькулятор. Своя держава видит всё как есть — это её тело.
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
    'stance', a.stance, 'system', sysname,
    'moving', (f.status = 'transit'), 'arrive_at', f.arrive_at,
    'seals_frac', case when mine then round(frac, 3) end,
    -- ⚠️ НАРУЖУ — ТОЛЬКО ШУМ. Раньше здесь стояла честная шкала («целы» →
    -- «на исходе»), и это был готовый калькулятор: враг видел, сколько ещё
    -- нести залпов, и переставал бояться. Своя держава читает правду ниже.
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
    -- точные числа — только своим
    'seals', case when mine then round(a.seals, 1) end,
    'press', case when mine then round(a.press, 2) end,
    'parry', case when mine then public._angel_parry_p(a.faction_id) end);
end$$;
revoke all on function public.angel_status() from public;
grant execute on function public.angel_status() to authenticated, anon;

-- ── 11. ПАРИРОВАНИЕ И РЕГЕНЕРАЦИЯ (счёт) ────────────────────
-- Давление тает НЕПРЕРЫВНО, поэтому считаем его лениво: при каждом обращении
-- досчитываем распад от last_press. Крона на это заводить нельзя — залпы
-- приходят в произвольные секунды, а не по расписанию тика.
create or replace function public._angel_press_now(p_fid text)
returns numeric language plpgsql security definer set search_path=public as $$
declare a record; hrs numeric; half numeric; val numeric;
begin
  select * into a from public.angel_state where faction_id = p_fid;
  if a.faction_id is null then return 0; end if;
  half := greatest(0.25, public._angel_const('press_half_h'));
  hrs  := greatest(0, extract(epoch from (now() - a.last_press)) / 3600.0);
  val  := a.press * power(0.5, hrs / half);
  if val < 0.01 then val := 0; end if;
  update public.angel_state set press = val, last_press = now() where faction_id = p_fid;
  return val;
end$$;
revoke all on function public._angel_press_now(text) from public;

-- Шанс отбить входящий залп. Читается как кривая: покой → почти всегда,
-- вал → почти никогда. Пола parry_floor хватает, чтобы даже в аду оставалась
-- крупица «повезло», но не хватает, чтобы на неё рассчитывать.
create or replace function public._angel_parry_p(p_fid text)
returns numeric language plpgsql security definer set search_path=public as $$
declare pr numeric; base numeric; fl numeric; k numeric;
begin
  pr   := public._angel_press_now(p_fid);
  base := public._angel_const('parry_base');
  fl   := public._angel_const('parry_floor');
  k    := public._angel_const('parry_k');
  return round((fl + (base - fl) * exp(-k * pr))::numeric, 3);
end$$;
revoke all on function public._angel_parry_p(text) from public;

-- Печати зарастают только в покое. Зовётся из тика ИИ (раз в минуту) — там же,
-- где ангел решает, воевать ему или отлежаться.
create or replace function public._angel_regen()
returns void language plpgsql security definer set search_path=public as $$
declare a record; hrs numeric; calm boolean; gain numeric; mul numeric; mx numeric;
        f record;
begin
  mx := public._angel_const('seals_max');
  for a in select * from public.angel_state where fell_at is null loop
    calm := a.last_hit is null
         or now() - a.last_hit > (public._angel_const('calm_h') || ' hours')::interval;
    if not calm then
      update public.angel_state set last_regen = now() where faction_id = a.faction_id;
      continue;
    end if;
    hrs := greatest(0, least(24, extract(epoch from (now() - a.last_regen)) / 3600.0));
    if hrs < 0.05 then continue; end if;
    select * into f from public.fleets where id = a.fleet_id;
    mul := case when a.stance = 'roost' and coalesce(f.system_id,'') = coalesce(a.home_sys,'')
                then public._angel_const('roost_mul') else 1 end;
    gain := public._angel_const('regen_h') * hrs * mul;
    update public.angel_state
       set seals = least(mx, seals + gain), last_regen = now()
     where faction_id = a.faction_id;
  end loop;
end$$;
revoke all on function public._angel_regen() from public;

-- ── 12. ПАДЕНИЕ ─────────────────────────────────────────────
-- Печати кончились. Ковчег — это и борт, и планета, и держава: гибнет всё
-- сразу, «остатков на окраине» у ангела нет по устройству.
create or replace function public._angel_fall(p_fid text, p_killer text default null)
returns void language plpgsql security definer set search_path=public as $$
declare a record; nm text; kn text;
begin
  select * into a from public.angel_state where faction_id = p_fid and fell_at is null;
  if a.faction_id is null then return; end if;

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
     set fell_at = now(), seals = 0, awake = false, stance = 'roost'
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
end$$;
revoke all on function public._angel_fall(text,text) from public;

-- ── 13. АДМИНСКАЯ ДВЕРЬ ─────────────────────────────────────
-- Преображение — операция разрушительная (пусть и обратимая), поэтому только
-- через админа и только явным вызовом. Автоматически не срабатывает никогда.
create or replace function public.admin_angel_ascend(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  return public.angel_ascend(p_fid);
end$$;
revoke all on function public.admin_angel_ascend(text) from public;
grant execute on function public.admin_angel_ascend(text) to authenticated;

create or replace function public.admin_angel_descend(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  return public.angel_descend(p_fid);
end$$;
revoke all on function public.admin_angel_descend(text) from public;
grant execute on function public.admin_angel_descend(text) to authenticated;

-- Отладка баланса: снять печатей руками, посмотреть, где ломается.
create or replace function public.admin_angel_seals(p_fid text, p_seals numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  update public.angel_state
     set seals = greatest(0, least(public._angel_const('seals_max'), p_seals))
   where faction_id = p_fid;
  if (select seals from public.angel_state where faction_id = p_fid) <= 0 then
    perform public._angel_fall(p_fid, null);
  end if;
  return public.angel_status();
end$$;
revoke all on function public.admin_angel_seals(text,numeric) from public;
grant execute on function public.admin_angel_seals(text,numeric) to authenticated;
