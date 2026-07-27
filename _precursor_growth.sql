-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ ЦИВИЛИЗАЦИИ · ЭТАП 4 — НЕДЕЛЬНЫЙ ХОД И РОЖДЕНИЕ ДЕРЖАВЫ
-- (лор: lore/precursor_civs.md §10; база: _precursor_civs.sql, _precursor_decisions.sql)
--
-- Раньше история цивилизации была снимком на 3000 год и стояла на месте.
-- Теперь она ИДЁТ: раз в неделю каждый живой мир делает один шаг по своей
-- летописи (E0 → … → E11), а следующим шагом после порога — звёздный полёт.
-- С этого момента цивилизация превращается в державу на карте:
--   • появляется строка в map_factions (имя и цвет придуманы ещё генератором);
--   • её родная система закрашивается за ней (если ничья);
--   • если мир был под протекторатом — система уходит патрону, а держава
--     рождается его вассалом.
--
-- Прозу для будущих шагов пишет НЕ база, а генератор (precursor_gen.js):
-- при спавне он складывает в колонку roadmap по записи на каждый недельный ход
-- (текст фазы + возможная карта ветвления + дельты). Тик просто снимает верхнюю.
-- Для старых строк без roadmap работает скромный запасной банк _pc_fallback_line.
--
-- ⚠ Порядок: применять ПОСЛЕ _precursor_civs.sql и _precursor_decisions.sql.
-- ⚠ После этого файла НЕ перекатывать _precursor_decisions.sql в одиночку:
--    он пересоздаёт precursor_act и снесёт обёртку отсюда (тогда накатить этот
--    файл повторно — он идемпотентен).
-- ════════════════════════════════════════════════════════════

-- ── 1. Новые поля ─────────────────────────────────────────
alter table public.primitive_civs
  add column if not exists roadmap      jsonb not null default '[]'::jsonb,  -- будущее: по записи на недельный ход
  add column if not exists next_step_at timestamptz,                          -- когда следующий ход
  add column if not exists steps        int not null default 0,               -- сколько ходов уже сделано
  add column if not exists state_name   text,                                 -- имя будущей державы
  add column if not exists state_color  text,
  add column if not exists map_fid      text,                                 -- id в map_factions после взлёта
  add column if not exists sovereign_at timestamptz;

-- статус получает шестое значение: spacefaring (вышли к звёздам)
-- wild | uplifted | protectorate | drained | dead | spacefaring

create index if not exists idx_prim_civ_due on public.primitive_civs(next_step_at)
  where status <> 'dead' and status <> 'spacefaring';

-- Часы расставляем врозь, иначе вся галактика шагнёт в одну секунду.
update public.primitive_civs
   set next_step_at = now() + (floor(random() * 7)::int || ' days')::interval
 where next_step_at is null and status <> 'dead';

-- ── 2. Ярус по фазе (зеркало tierOf в precursor_gen.js) ───
create or replace function public._pc_tier(p_phase int)
returns int language sql immutable set search_path=public as $$
  select case when p_phase <= 1 then 0 when p_phase <= 4 then 1 when p_phase <= 7 then 2
              when p_phase <= 9 then 3 when p_phase = 10 then 4 else 5 end;
$$;

-- ── 3. Таймер: любой рост фазы перезапускает недельные часы ─
-- Работает и для «🜂 Возвысить»: игрок подтолкнул — неделя считается заново.
-- На пороге (E11) ждать целую неделю до взлёта скучно: остаётся двое суток.
create or replace function public._pc_phase_timer()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.phase > old.phase then
    new.tier := public._pc_tier(new.phase);
    -- скрытность (Розенкрейцеры, «Небесная вахта») сохраняется как разница
    new.visible_tier := greatest(0, new.tier - greatest(0, old.tier - old.visible_tier));
    if new.status <> 'spacefaring' then
      new.next_step_at := now() + (case when new.phase >= 11 then interval '2 days' else interval '7 days' end);
    end if;
  end if;
  return new;
end$$;
drop trigger if exists trg_pc_phase_timer on public.primitive_civs;
create trigger trg_pc_phase_timer before update on public.primitive_civs
  for each row execute function public._pc_phase_timer();

-- ── 4. Запасной банк строк (для строк без roadmap) ────────
create or replace function public._pc_fallback_line(p_phase int, p_name text, p_planet text)
returns text language sql immutable set search_path=public as $$
  select replace(replace(case p_phase
    when 0 then 'Стаи {n} расходятся по {p} за пищей: табу, огонь и страх перед тем, что живёт в земле.'
    when 1 then '{n} перестают ходить и начинают ждать урожая. Первые стены, первые лодки, первые долги.'
    when 2 then 'Руда становится посудой, посуда — оружием. Мастера {n} выделяются в касту и больше не пашут.'
    when 3 then 'Появляется знак, который переживает того, кто его начертил. С ним приходят закон, жречество и учёт.'
    when 4 then 'Сплавы дают армию, армия даёт царство. {p} впервые делят целиком, без остатка.'
    when 5 then 'Железо дешевле бронзы — воевать может каждый. В ответ рождаются школы мысли, монета и библиотека.'
    when 6 then 'Империя {n} строит акведуки, кодексы и храмы, а заодно бюрократию, которая переживёт её саму.'
    when 7 then 'Центр рушится. Дороги зарастают, знание держится в монастырях, набеги считают за погоду.'
    when 8 then 'Порох, компас и печать за один век. {n} обходят {p} кругом и возвращаются с другой стороны.'
    when 9 then 'Пар и фабрика перемалывают старый уклад. Появляются нации, идеологии и толпы.'
    when 10 then 'Цепная реакция, счётные машины, первый спутник. {n} узнают, что небо — не купол.'
    else 'Термояд, орбитальный лифт и что-то безымянное в их сети. {n} больше не примитивы.'
  end, '{n}', coalesce(p_name, 'они')), '{p}', coalesce(p_planet, 'этом мире'));
$$;

-- ── 4-бис. ОПОВЕЩЕНИЯ: досье и лента «Оповещения» ─────────
-- Постим через _post_life_news (_news_mentions.sql): «Хроника сектора» + пинг
-- конкретной державе, чтобы находка попала ей в ленту оповещений. Если этого
-- среза в базе нет — молча обходимся хроникой удачи (_luck_post).

-- ВАЖНО про формат. Новость читает вслух персонаж новеллы на главной
-- (heroVNTell берёт первые ~300 символов body и произносит их от лица героини),
-- и видят её ВСЕ. Поэтому body устроен так:
--   первые 1–2 фразы — живая речь от третьего лица, с именем нашедшей державы;
--   сухие цифры — хвостом, за границей обрезки: они нужны в статье, а не в эфире.
-- Никаких «наша колония»: диктор говорит на всю галактику, а не от лица игрока.

-- Эпоха словами, с приметой времени — чтобы фраза звучала, а не нумеровалась.
create or replace function public._pc_phase_word(p_phase int)
returns text language sql immutable set search_path=public as $$
  select case p_phase
    when 0 then 'ходят стаями и знают только огонь'
    when 1 then 'едва осели: первые поля, первые стены'
    when 2 then 'освоили металл'
    when 3 then 'выучились письму'
    when 4 then 'делят планету бронзовыми царствами'
    when 5 then 'живут в железном веке'
    when 6 then 'строят империю с акведуками и правом'
    when 7 then 'переживают распад империи'
    when 8 then 'обходят свою планету под парусом'
    when 9 then 'дожили до пара и фабрик'
    when 10 then 'расщепили атом и вышли в эфир'
    when 11 then 'стоят на пороге космоса'
    else 'непонятно на каком веку' end;
$$;

-- Хвост-досье: то самое «что она из себя представляет», но НЕ для эфира.
create or replace function public._pc_dossier(p_civ public.primitive_civs)
returns text language sql stable set search_path=public as $$
  select concat_ws(' ',
    '— Досье наблюдательных постов.',
    'Мир: ' || coalesce(p_civ.planet_name, '?') || ' (' || coalesce(p_civ.system_name, p_civ.system_id) || ').',
    'Народ: ' || array_to_string(p_civ.races, ' и ') ||
      (case when p_civ.synergy is not null then ' — связка «' || p_civ.synergy || '»' else '' end) || '.',
    'Уклад: ' || coalesce(p_civ.gov, '?') || ', ' || coalesce(p_civ.ideology, '?') || '.',
    -- население — в игровых единицах, тех же, что у колоний (_precursor_pop_scale.sql)
    'Население — около ' || p_civ.pop::text ||
      ', благополучие ' || p_civ.wellbeing || ' из 100.',
    (case when coalesce(p_civ.ruins, 'нет') <> 'нет'
          then 'На планете руины: ' || p_civ.ruins || '.' else '' end),
    -- вместо сухого списка шрамов — их собственная летопись, теми же словами
    coalesce((select 'Из летописи: ' || string_agg('«' || (q.l->>'text') || '»', ' ' order by q.ord)
                from (select t.l, t.ord from jsonb_array_elements(p_civ.chronicle)
                             with ordinality as t(l, ord)
                       where t.l ? 'scar' order by t.ord desc limit 2) q), ''),
    'Мораторий Фонда 2986 года действует: любое вмешательство пойдёт в досье.');
$$;

-- Отношение к гостям — одной фразой.
create or replace function public._pc_mood(p_att int)
returns text language sql immutable set search_path=public as $$
  select case when p_att >= 40 then 'а гостей с неба ждут как сбывшегося обещания'
              when p_att >= 10 then 'и к гостям с неба относятся с осторожным любопытством'
              when p_att > -25 then 'и к гостям с неба относятся настороженно'
              when p_att > -60 then 'и гостей с неба встречают враждебно'
              else 'и любого гостя с неба считают тем, за кем придут с оружием' end;
$$;

-- Свой постер (а не _post_life_news) нужен ради ЛИДА: excerpt — это то, что
-- зачитает героиня новеллы на главной, body — полный текст для статьи.
create or replace function public._pc_news(p_title text, p_lead text, p_body text, p_color text, p_fids jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, kind, mentions, reviewed_by, published_at, created_at, updated_at)
    values (null, '◈ ХРОНИКА СЕКТОРА', coalesce(p_color, 'rgba(120,180,140,0.5)'), null, null,
      p_title, p_lead, btrim(p_lead || ' ' || coalesce(p_body, '')), 'approved', 'bulletin',
      coalesce(p_fids, '[]'::jsonb), 'system', now(), now(), now());
  -- та же уборка, что у «Хроники сектора»: держим последние 60 сводок
  delete from public.faction_news
    where owner_id is null and kind = 'bulletin' and reviewed_by = 'system'
      and id not in (select id from public.faction_news
                      where owner_id is null and kind = 'bulletin' and reviewed_by = 'system'
                      order by created_at desc limit 60);
exception when others then null;   -- оповещение косметическое, игру не роняем
end$$;
drop function if exists public._pc_news(text, text, text, jsonb);

-- Первый контакт: мир, у которого в системе появилась чужая колония, попадает
-- в каталог нашедшей державы — с полным досье в ленте оповещений.
create or replace function public.precursor_scan_contacts(p_limit int default 200)
returns int language plpgsql security definer set search_path=public as $$
declare c public.primitive_civs%rowtype; v_fid text; v_who text; n int := 0;
begin
  for c in select * from public.primitive_civs
            where contacted_by is null and status <> 'dead'
            limit greatest(1, coalesce(p_limit, 200))
  loop
    select col.faction_id into v_fid from public.colonies col
      where col.system_id = c.system_id
      order by col.created_at nulls last limit 1;
    if v_fid is null then continue; end if;
    update public.primitive_civs
       set contacted_by = v_fid, contacted_at = now()
     where system_id = c.system_id and pid = c.pid and contacted_by is null;
    begin v_who := nullif(public._fac_name(v_fid), ''); exception when others then v_who := null; end;
    perform public._pc_news(
      '🜃 Найдена дозвёздная цивилизация: ' || c.self_name,
      -- ЛИД: ровно это зачитает героиня новеллы — значит, это должно звучать
      'В системе ' || coalesce(c.system_name, c.system_id) || ' нашли живых. ' ||
      coalesce('Колонисты державы «' || v_who || '»', 'Колонисты') || ' докладывают: планету ' ||
      coalesce(c.planet_name, '?') || ' населяет народ, называющий себя «' || c.self_name || '» — ' ||
      array_to_string(c.races, ' и ') || '. Они ' || public._pc_phase_word(c.phase) || ', ' ||
      public._pc_mood(c.attitude) || '.',
      public._pc_dossier(c),
      'rgba(150,190,140,0.5)', jsonb_build_array(v_fid));
    perform public._luck_post('geo', v_fid,
      '🜃 ' || c.self_name || ' (' || coalesce(c.planet_name, '?') || '): найдена дозвёздная цивилизация.');
    n := n + 1;
  end loop;
  return n;
end$$;
revoke all on function public.precursor_scan_contacts(int) from public, anon;

-- ── 5. ВЗЛЁТ: цивилизация становится державой на карте ────
-- Патрон (протекторат/возвышение) забирает систему себе — новая держава рождается
-- в его тени. Без патрона рождается независимая фракция карты со своим цветом.
create or replace function public._pc_ignite(p_system_id text, p_pid int, p_entry jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c public.primitive_civs%rowtype;
  v_fid text; v_name text; v_color text; v_txt text; v_sys_free boolean; v_hostile boolean;
begin
  select * into c from public.primitive_civs
    where system_id = p_system_id and pid = p_pid for update;
  if not found or c.status in ('dead','spacefaring') then return jsonb_build_object('ok', false); end if;

  v_name  := coalesce(nullif(p_entry->>'state_name',''), c.state_name, c.self_name);
  v_color := coalesce(nullif(p_entry->>'state_color',''), c.state_color, 'rgba(180,180,190,0.26)');
  v_hostile := coalesce(c.attitude, 0) <= -40;

  if c.patron_fid is not null then
    -- вассал: система уходит патрону, отдельной фракции карты не появляется
    v_fid := c.patron_fid;
    v_txt := coalesce(nullif(p_entry->>'ward_text',''),
      c.self_name || ' вышли к звёздам под чужим флагом.');
  else
    v_fid := 'pc_' || regexp_replace(lower(c.system_id), '[^a-z0-9]', '', 'g') || '_' || c.pid;
    insert into public.map_factions (id, name, color, sort)
      values (v_fid, v_name, v_color, 80)
      on conflict (id) do update set name = excluded.name, color = excluded.color;
    v_txt := case when v_hostile
      then coalesce(nullif(p_entry->>'hostile_text',''), c.self_name || ' вышли к звёздам и никому этому не рады.')
      else coalesce(nullif(p_entry->>'text',''), c.self_name || ' вышли к звёздам.') end;
  end if;

  -- систему закрашиваем только если она ничья: чужую границу взлёт не двигает
  select faction is null into v_sys_free from public.map_systems where id = c.system_id;
  if coalesce(v_sys_free, false) then
    update public.map_systems set faction = v_fid where id = c.system_id and faction is null;
  end if;

  update public.primitive_civs
     set status = 'spacefaring',
         phase = 11, tier = 5, visible_tier = 5,
         map_fid = v_fid, state_name = v_name, state_color = v_color,
         sovereign_at = now(), next_step_at = null, steps = steps + 1,
         roadmap = '[]'::jsonb,
         attitude = case when c.patron_fid is not null then attitude else greatest(-100, attitude - 10) end,
         chronicle = chronicle || jsonb_build_array(jsonb_build_object('ph', '★', 'text', v_txt))
   where system_id = c.system_id and pid = c.pid;

  perform public._luck_post('geo', c.patron_fid,
    '★ ' || v_name || ' (' || coalesce(c.planet_name, '?') || ', ' || coalesce(c.system_name, c.system_id) ||
    '): дозвёздный мир совершил первый межзвёздный полёт и вышел на карту' ||
    (case when c.patron_fid is not null then ' под покровительством патрона.'
          when v_hostile then '. Настроены они скверно.' else '.' end));

  -- Новая держава — новость галактического масштаба: в общую хронику,
  -- с пингом патрону и тому, кто их когда-то нашёл.
  perform public._pc_news(
    '★ Новая держава: ' || v_name,
    v_txt ||
    (case when c.patron_fid is not null
          then ' Держава рождается под покровительством: система остаётся за патроном, флаг — новый.'
          when v_hostile then ' Настроены они скверно и помнят каждый корабль, что висел над их небом.'
          else ' Отныне это сосед, а не находка: примитивных решений по ним больше не принимают.' end),
    public._pc_dossier(c),
    v_color,
    (case when c.patron_fid is not null then jsonb_build_array(c.patron_fid) else '[]'::jsonb end)
      || (case when c.contacted_by is not null and c.contacted_by is distinct from c.patron_fid
               then jsonb_build_array(c.contacted_by) else '[]'::jsonb end));

  return jsonb_build_object('ok', true, 'ignited', true, 'fid', v_fid, 'name', v_name, 'txt', v_txt);
end$$;

-- ── 6. ОДИН НЕДЕЛЬНЫЙ ХОД ─────────────────────────────────
-- Порядок: мёртвые и звёздные пропускаются; выпитый досуха мир неделю
-- отлёживается вместо шага (выкачивание буквально тормозит их историю);
-- иначе снимаем верхнюю запись roadmap и живём её.
create or replace function public.precursor_step(p_system_id text, p_pid int, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c public.primitive_civs%rowtype;
  e jsonb; v_add jsonb; v_ph int; v_txt text; v_ideo text;
begin
  select * into c from public.primitive_civs
    where system_id = p_system_id and pid = p_pid for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'no civ'); end if;
  if c.status in ('dead','spacefaring') then return jsonb_build_object('ok', false, 'why', 'no clock'); end if;
  if not p_force and (c.next_step_at is null or c.next_step_at > now()) then
    return jsonb_build_object('ok', false, 'why', 'not due');
  end if;

  -- выпитые досуха не идут вперёд: сначала им надо отдышаться
  if c.status = 'drained' or c.wellbeing <= 8 then
    update public.primitive_civs
       set next_step_at = now() + interval '7 days',
           wellbeing = least(100, wellbeing + 4),
           status = case when wellbeing + 4 >= 25 and status = 'drained' then 'wild' else status end,
           chronicle = chronicle || jsonb_build_array(jsonb_build_object(
             'ph', 'пауза',
             'text', 'Год прошёл впустую: ' || c.self_name ||
                     ' восстанавливают то, что у них забрали, и в эту неделю история не двинулась.'))
     where system_id = c.system_id and pid = c.pid;
    return jsonb_build_object('ok', true, 'stalled', true);
  end if;

  -- выбрасываем записи, которые игрок уже «проехал» через возвышение
  loop
    exit when jsonb_array_length(c.roadmap) = 0;
    e := c.roadmap->0;
    exit when coalesce((e->>'ignite')::boolean, false);
    exit when coalesce((e->>'i')::int, 99) > c.phase;
    c.roadmap := c.roadmap - 0;
  end loop;

  -- ── взлёт ──
  if jsonb_array_length(c.roadmap) > 0 and coalesce((c.roadmap->0->>'ignite')::boolean, false) then
    update public.primitive_civs set roadmap = c.roadmap
      where system_id = c.system_id and pid = c.pid;
    return public._pc_ignite(c.system_id, c.pid, c.roadmap->0);
  end if;
  -- roadmap пуст (старая строка или всё прожито)
  if jsonb_array_length(c.roadmap) = 0 then
    if c.phase >= 11 then
      return public._pc_ignite(c.system_id, c.pid, '{}'::jsonb);
    end if;
    v_ph := c.phase + 1;
    v_txt := public._pc_fallback_line(v_ph, c.self_name, c.planet_name);
    update public.primitive_civs
       set phase = v_ph, steps = steps + 1,
           pop = greatest(0, (pop * 1.25)::bigint),
           chronicle = chronicle || jsonb_build_array(jsonb_build_object(
             'ph', 'E' || v_ph::text, 'text', v_txt))
     where system_id = c.system_id and pid = c.pid;
    return jsonb_build_object('ok', true, 'phase', v_ph, 'txt', v_txt);
  end if;

  -- ── обычный шаг по написанному будущему ──
  e := c.roadmap->0;
  v_ph := least(11, coalesce((e->>'i')::int, c.phase + 1));
  v_add := jsonb_build_array(jsonb_build_object('ph', coalesce(e->>'ph', 'E' || v_ph::text), 'text', e->>'text'));
  if coalesce(e->>'scarText', '') <> '' then
    v_add := v_add || jsonb_build_array(jsonb_build_object(
      'ph', coalesce(e->>'ph', 'E' || v_ph::text), 'text', e->>'scarText', 'scar', e->>'scar'));
  end if;
  v_ideo := nullif(e#>>'{d,ideo}', '');

  update public.primitive_civs
     set phase = v_ph,
         steps = steps + 1,
         roadmap = c.roadmap - 0,
         pop = greatest(0, (pop * 1.25 * coalesce((e#>>'{d,pop}')::numeric, 1))::bigint),
         wellbeing = greatest(0, least(100, wellbeing + coalesce((e#>>'{d,wb}')::int, 0))),
         attitude  = greatest(-100, least(100, attitude + coalesce((e#>>'{d,att}')::int, 0))),
         ideology  = coalesce(v_ideo, ideology),
         scars     = case when coalesce(e->>'scar','') <> '' and not (scars @> array[e->>'scar'])
                          then scars || array[e->>'scar'] else scars end,
         chronicle = chronicle || v_add
   where system_id = c.system_id and pid = c.pid;

  -- Порог пройден — тем, кто за ними следит, стоит узнать заранее: через пару
  -- суток это будет уже держава, и решать что-то станет поздно.
  if v_ph >= 11 and c.phase < 11 then
    perform public._pc_news(
      '🜂 ' || c.self_name || ': порог космоса',
      '«' || c.self_name || '» вышли на порог: термояд, орбитальный лифт и первые собственные корабли. ' ||
      'Через считанные дни они уйдут за пределы своей системы и станут державой на карте — ' ||
      'всё, что кто-то собирался с ними сделать, делается сейчас или никогда.',
      'Планета ' || coalesce(c.planet_name, '?') || ', система ' || coalesce(c.system_name, c.system_id) ||
      '. Дозвёздных решений после первого полёта по ним уже не принимают.',
      'rgba(210,180,90,0.5)',
      (case when c.patron_fid is not null then jsonb_build_array(c.patron_fid) else '[]'::jsonb end)
        || (case when c.contacted_by is not null and c.contacted_by is distinct from c.patron_fid
                 then jsonb_build_array(c.contacted_by) else '[]'::jsonb end));
  end if;

  -- отдельные карты будущего прячут их от разведки сильнее
  if coalesce((e#>>'{d,hide}')::int, 0) > 0 then
    update public.primitive_civs
       set visible_tier = greatest(0, tier - (e#>>'{d,hide}')::int)
     where system_id = c.system_id and pid = c.pid;
  end if;

  return jsonb_build_object('ok', true, 'phase', v_ph, 'txt', e->>'text');
end$$;
revoke all on function public.precursor_step(text, int, boolean) from public, anon, authenticated;

-- ── 7. ПРОГОН ПО ВСЕЙ ГАЛАКТИКЕ ───────────────────────────
create or replace function public.precursor_tick_all(p_limit int default 500)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; n int := 0; ign int := 0; found_new int := 0; res jsonb;
begin
  -- сначала первый контакт: кто-то мог за неделю поставить колонию по соседству
  begin found_new := public.precursor_scan_contacts(200);
  exception when others then found_new := 0; end;
  for r in select system_id, pid from public.primitive_civs
            where status not in ('dead','spacefaring')
              and next_step_at is not null and next_step_at <= now()
            order by next_step_at
            limit greatest(1, coalesce(p_limit, 500))
  loop
    begin
      res := public.precursor_step(r.system_id, r.pid, false);
      if coalesce((res->>'ok')::boolean, false) then n := n + 1; end if;
      if coalesce((res->>'ignited')::boolean, false) then ign := ign + 1; end if;
    exception when others then null;   -- один сломанный мир не должен ронять галактику
    end;
  end loop;
  return jsonb_build_object('stepped', n, 'ignited', ign, 'found', found_new);
end$$;
revoke all on function public.precursor_tick_all(int) from public, anon;

-- ── 8. Часы на случай, если pg_cron не завёлся ────────────
-- Заход игрока во вкладку прокручивает мир, но не чаще раза в час.
create table if not exists public.precursor_clock (
  id      boolean primary key default true check (id),
  last_at timestamptz not null default now() - interval '1 day'
);
insert into public.precursor_clock(id) values (true) on conflict (id) do nothing;
alter table public.precursor_clock enable row level security;
revoke select, insert, update, delete on public.precursor_clock from public, anon, authenticated;

create or replace function public._pc_clock()
returns void language plpgsql security definer set search_path=public as $$
declare v_last timestamptz;
begin
  update public.precursor_clock set last_at = now()
    where id and last_at < now() - interval '1 hour'
    returning last_at into v_last;
  if v_last is not null then perform public.precursor_tick_all(300); end if;
exception when others then null;
end$$;

-- ── 9. Витрина: тот же precursor_get + часы и сведения о ходе ─
-- Будущее игроку НЕ показываем — только сколько шагов до звёзд осталось.
create or replace function public.precursor_get()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v jsonb; rep int;
begin
  fid := public._ec_my_fid();
  perform public._pc_clock();
  -- находки ищем на каждом заходе: колонию могли поставить пять минут назад
  begin perform public.precursor_scan_contacts(50); exception when others then null; end;
  select coalesce(f.rep, 0) into rep from public.faction_foundation f where f.faction_id = fid;
  select coalesce(jsonb_agg(x order by x_tier desc, x_name), '[]'::jsonb) into v
    from (
      select (to_jsonb(c) - 'roadmap')
             || jsonb_build_object('steps_left', jsonb_array_length(c.roadmap),
                                   'phase_name', case when c.phase between 0 and 11 then
                                     (array['Собиратели','Оседлость','Металл','Письмо','Бронзовые царства','Железо',
                                            'Классика','Тёмный провал','Порох и паруса','Пар и фабрика','Атом и код','Порог'])[c.phase + 1]
                                     else '?' end) as x,
             c.tier as x_tier, c.self_name as x_name
        from public.primitive_civs c
       where exists (select 1 from public.colonies col
                      where col.system_id = c.system_id and col.faction_id = fid)
          or c.contacted_by = fid or c.patron_fid = fid
    ) t;
  return jsonb_build_object(
    'fid', fid,
    'rep', coalesce(rep, 0),
    'now', now(),
    'gc', (select gc from public.faction_economy where faction_id = fid),
    'civs', v);
end$$;
revoke all on function public.precursor_get() from public, anon;
grant execute on function public.precursor_get() to authenticated;

-- ── 10. Обёртка над решениями ─────────────────────────────
-- Со звёздной державой примитивных решений уже не принимают: изучать можно,
-- выкачивать и «возвышать» — нет. А вот «🜂 Возвысить» на самом пороге теперь
-- имеет смысл: это толчок в космос, и они будут знать, чей.
do $$
begin
  if to_regprocedure('public._precursor_act_v1(text,int,text)') is null
     and to_regprocedure('public.precursor_act(text,int,text)') is not null then
    execute 'alter function public.precursor_act(text,int,text) rename to _precursor_act_v1';
  end if;
end$$;
-- звать v1 напрямую игрок не должен — только обёртка (она security definer)
do $$
begin
  if to_regprocedure('public._precursor_act_v1(text,int,text)') is not null then
    execute 'revoke all on function public._precursor_act_v1(text,int,text) from public, anon, authenticated';
  end if;
end$$;

create or replace function public.precursor_act(p_system_id text, p_pid int, p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.primitive_civs%rowtype; fid text; v_cost numeric; v_gc numeric; v_rep int;
        v_entry jsonb; res jsonb;
begin
  select * into c from public.primitive_civs where system_id = p_system_id and pid = p_pid;
  if not found then raise exception 'no civ'; end if;

  if c.status = 'spacefaring' and p_action <> 'study' then
    raise exception 'civ is sovereign';
  end if;

  -- возвышение на пороге = выпихнуть их в космос своими руками
  if p_action = 'uplift' and c.phase >= 11 and c.status <> 'spacefaring' then
    fid := public._ec_my_fid();
    if not exists (select 1 from public.colonies col
                    where col.system_id = c.system_id and col.faction_id = fid)
       and coalesce(c.patron_fid, '') <> fid then
      raise exception 'no presence in system';
    end if;
    if c.patron_fid is not null and c.patron_fid <> fid then
      raise exception 'civ belongs to another patron';
    end if;
    if c.last_act_at is not null and now() - c.last_act_at < interval '20 hours' then
      raise exception 'too soon';
    end if;
    v_cost := public._pc_cost('uplift', c.tier);
    select e.gc into v_gc from public.faction_economy e where e.faction_id = fid;
    if coalesce(v_gc, 0) < v_cost then raise exception 'not enough gc'; end if;
    update public.faction_economy set gc = gc - v_cost where faction_id = fid and gc >= v_cost;
    v_rep := public._pc_rep(fid, -15);
    update public.primitive_civs
       set patron_fid = coalesce(patron_fid, fid), last_act_at = now(), acts = acts + 1,
           contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now())
     where system_id = c.system_id and pid = c.pid;
    -- последняя запись roadmap — это и есть сценарий взлёта (имя державы, цвет, текст)
    select coalesce(pc.roadmap -> (jsonb_array_length(pc.roadmap) - 1), '{}'::jsonb)
      into v_entry from public.primitive_civs pc
     where pc.system_id = c.system_id and pc.pid = c.pid;
    if not coalesce((v_entry->>'ignite')::boolean, false) then v_entry := '{}'::jsonb; end if;
    res := public._pc_ignite(c.system_id, c.pid, v_entry);
    insert into public.primitive_acts(system_id, pid, faction_id, action, payload)
      values (c.system_id, c.pid, fid, 'ignite', jsonb_build_object('rep', v_rep, 'cost', v_cost));
    return jsonb_build_object('ok', true, 'cost', v_cost, 'rep', v_rep,
      'txt', c.self_name || ' ушли к звёздам с вашей верфи. Теперь это держава, и она помнит, кому обязана.');
  end if;

  return public._precursor_act_v1(p_system_id, p_pid, p_action);
end$$;
revoke all on function public.precursor_act(text, int, text) from public, anon;
grant execute on function public.precursor_act(text, int, text) to authenticated;

-- ── 11. Планировщик: ежедневная проверка, кому пора шагнуть ─
-- Часы у каждого мира свои (next_step_at), период — неделя; крон только смотрит,
-- у кого срок вышел. Если pg_cron нет — сработают часы из precursor_get.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.unschedule('precursor-weekly-step')
        from cron.job where jobname = 'precursor-weekly-step';
      perform cron.schedule('precursor-weekly-step', '25 0 * * *', 'select public.precursor_tick_all(500);');
      raise notice 'pg_cron: недельный ход дозвёздных запланирован (проверка ежедневно 00:25 UTC)';
    exception when others then
      raise notice 'pg_cron настроить не удалось (%) — ход прокрутит заход игрока', sqlerrm;
    end;
  else
    raise notice 'pg_cron недоступен — недельный ход прокрутит заход игрока (precursor_get)';
  end if;
end$$;
