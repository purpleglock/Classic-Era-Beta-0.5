-- ════════════════════════════════════════════════════════════
-- ЛЕГИОН, ШАГ 8: ГНЕВ — ОТВЕТ ПО РАЗМЕРУ ОБИДЧИКА
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _legion_vendetta.sql и _legion_lair.sql. Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК (три вещи, и все три читаются как «пираты — декорация»).
--
--   1) ОТВЕТ НЕ ЗНАЛ, КОМУ ОТВЕЧАЕТ. Сила отряда считалась ТОЛЬКО от долга:
--      16 + долг×1.5, потолок 72. Потолок = 9 корпусов (_legion_compose делит
--      силу на 8). Держава с 3040 кораблями получала за выжженное логово девять
--      лоханок. Долг измеряет НАГЛОСТЬ, но не измеряет, кого именно наказывают:
--      одна и та же обида от новичка и от первой державы галактики стоила
--      одинаково. Теперь в формуле два множителя: долг (за что) и МУСКУЛ
--      обидчика (кого). Ответ — доля от его же силы, а не фиксированная горстка.
--
--   2) КАРАТЕЛЬНЫЙ ОТРЯД ИСКАЛ, ГДЕ ПОСЛАБЖЕ. Цель бралась из _legion_my_targets,
--      где оборона стоит в ЗНАМЕНАТЕЛЕ. Для обычной кампании это правильно
--      (Легион — налог, он ищет бардак), но месть по этой формуле уходила в
--      самый пустой угол державы: игрок бил по логову, а «ответ» щипал дальний
--      аванпост. Вендетта считается ОТДЕЛЬНО: ценность вперёд, оборона — мягкий
--      делитель (guard^0.4), то есть она удорожает цель, но не уводит от неё.
--      Чем крупнее счёт, тем выше Легион готов лезть — вплоть до столицы.
--
--   3) ВАТАГА НЕ ДЕЛАЛА НИЧЕГО. legion_engage_tick: увидел чужой флот →
--      материализовался и ЖДЁТ, пока игрок сам придёт драться. Не пришёл —
--      отряд стоит вечно. Со стороны игрока это буквально «прилетели и
--      обосрались». Теперь у отряда есть ТЕРПЕНИЕ: простоял 3 часа без боя —
--      берёт своё силой (угон, вынос заставы), и пишет об этом в ленту.
--      Драться или платить — выбор игрока, но «не заметить» больше нельзя.
--
-- ⚠ ЧЕГО ЗДЕСЬ НАМЕРЕННО НЕТ. Легион по-прежнему не фабрикует строку battles из
-- крона (см. _legion_engage.sql): бой — интерактивная сущность с ходами и
-- дедлайном. Гнев меняет МАСШТАБ и НАСТОЙЧИВОСТЬ, а не способ появления.
-- ════════════════════════════════════════════════════════════

-- ── 1. МУСКУЛ ОБИДЧИКА ──────────────────────────────────────
-- Чем меряем «кого наказываем». Корабли на карте — ОСНОВА: встречать придётся
-- именно их. Гарнизоны и число колоний — добавка, и она НАМЕРЕННО ограничена
-- долей флота: держава с 60 кораблями и 18 тысячами пехоты набирала «мускул»
-- 4800 и получала в ответ армаду, которую ей нечем встретить в космосе. Земля
-- показывает, что есть чем огрызнуться, но войну в пустоте ведут корпуса.
create or replace function public._legion_muscle(p_fid text)
returns numeric language sql stable security definer set search_path=public as $$
  with s as (
    select coalesce((select sum(greatest(0,(c->>'qty')::int))
                       from public.fleets f, jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
                      where f.faction_id = p_fid), 0) ships,
           coalesce((select sum(greatest(0,(a2->>'qty')::int)) * 0.10
                       from public.armies ar, jsonb_array_elements(coalesce(ar.composition,'[]'::jsonb)) a2
                      where ar.faction_id = p_fid), 0)
         + coalesce((select count(*) * 1.5 from public.colonies c where c.faction_id = p_fid), 0) ground
  )
  select greatest(1.0, s.ships + least(s.ships * 0.6 + 40, s.ground)) from s
$$;
revoke all on function public._legion_muscle(text) from public;

-- ── 2. КОНСТАНТЫ ГНЕВА ──────────────────────────────────────
-- Балансировать вендетту придётся отдельно от кампании — все числа тут.
create or replace function public._legion_vend_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'debt_bite'  then 6      -- ниже этого Легион просто запоминает
    when 'base'       then 16     -- костяк отряда, даже за мелкую наглость
    when 'per_debt'   then 1.5    -- сколько силы даёт единица долга
    when 'cap'        then 72     -- потолок для державы БЕЗ мускула (новичок)
    when 'cooldown_h' then 2      -- не чаще, чем раз в два часа на державу
    -- ── гнев ──
    when 'share'      then 0.10   -- доля мускула обидчика в рядовом ответе
    when 'share_cap'  then 0.30   -- доля, которую не перешагнёт даже логово
    when 'lair_mult'  then 2.0    -- залп по родовому гнезду стоит вдвое
    when 'hard_cap'   then 900    -- абсолютный предел одной волны
    when 'wave_max'   then 3      -- на сколько отрядов дробится крупная волна
    when 'wave_step'  then 160    -- сила, выше которой волна идёт по частям
    when 'patience_h' then 3      -- сколько ватага ждёт боя, прежде чем брать сама
    else 0 end
$$;

-- Была ли обида по ЛОГОВУ: от этого зависит и множитель, и право идти волной.
create or replace function public._legion_debt_lair(p_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.legion_grudges g
                  where g.faction_id = p_fid and g.answered_at is null
                    and g.sys is not null and public._legion_is_lair(g.sys))
$$;
revoke all on function public._legion_debt_lair(text) from public;

-- ── 3. КУДА ИДЁТ МЕСТЬ ──────────────────────────────────────
-- Отличие от _legion_my_targets ровно одно, и оно принципиальное: оборона здесь
-- не знаменатель, а мягкий делитель. guard^0.4 означает, что вчетверо более
-- защищённая система становится «дороже» примерно в 1.7 раза, а не в 4 — то
-- есть закатанная в оборону столица остаётся целью, просто требует крупной
-- волны. Ровно этого и ждёт игрок, когда бьёт по логову: что придут к нему
-- домой, а не пощиплют дальний буй.
create or replace function public._legion_wrath_targets(p_fid text)
returns table(sys text, kind text, value numeric, guard numeric, score numeric)
language sql stable security definer set search_path=public as $$
  with cand as (
    -- колонии: население и достаток. Столица (самая крупная) весит больше всех.
    select c.system_id sid, 'strike'::text kd,
           2.0 + coalesce(c.pop,0)/300.0
               + coalesce((select least(150,e.prosperity) from public.system_econ e
                            where e.system_id = c.system_id),0)/80.0 val
      from public.colonies c where c.faction_id = p_fid
    union all
    -- заставы: их сносят попутно, самостоятельной целью мести они слабы
    select o.system_id, 'blind',
           case o.mode when 'recon' then 2.0 when 'depot' then 1.8 else 0.8 end
      from public.outposts o
     where o.faction_id = p_fid and public._outpost_crew_k(o.crew, o.mode) >= 0.5
  ), agg as (
    select cd.sid, sum(cd.val) val,
           (array_agg(cd.kd order by case cd.kd when 'strike' then 3 else 1 end desc))[1] kd
      from cand cd where cd.sid is not null group by cd.sid
  )
  select a.sid, a.kd, round(a.val,2), round(g.gv,2),
         round(a.val / power(greatest(1.0, g.gv), 0.4), 3)
    from agg a
    cross join lateral (select public._legion_sys_guard(a.sid) gv) g
   order by 5 desc
$$;
revoke all on function public._legion_wrath_targets(text) from public;

-- ── 4. СОСТАВ: КРУПНАЯ ВОЛНА — КРУПНЫЕ КОРПУСА ──────────────
-- Суперсет _legion_compose из шага 4. Два исправления:
--   • ступени вверх: от 150 в дело идут battleship/cruiser. Раньше потолком
--     был mediumCruiser при ЛЮБОЙ силе — «карательная армада» состояла из
--     полусотни средних крейсеров, что выглядит как склад, а не как флот.
--   • раздаём ВСЕ корпуса: прежняя раздача «половина остатка» на трёх типах
--     теряла 1/8 отряда (7 из 56 кораблей просто не появлялись).
create or replace function public._legion_compose(p_strength numeric)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare want int; kinds text[]; comp jsonb := '[]'::jsonb; u record;
        left_n int; picks int; i int := 0; take int;
begin
  want := greatest(1, round(coalesce(p_strength,12) / 8.0))::int;
  if    p_strength >= 150 then kinds := array['battleship','cruiser','mediumCruiser','supportCarrier','destroyer'];
  elsif p_strength >= 80  then kinds := array['cruiser','mediumCruiser','destroyer','supportCarrier'];
  elsif p_strength >= 40  then kinds := array['mediumCruiser','cruiser','destroyer','corvette','supportCarrier'];
  elsif p_strength >= 22  then kinds := array['destroyer','corvette','mediumCruiser'];
  else                         kinds := array['corvette','destroyer'];
  end if;

  select count(*) into picks from (
    select fu.id from public.faction_units fu
      where fu.faction_id = (public._legion_meta()->>'hull_fid')
        and fu.category = 'ship' and (fu.data->>'class') = any(kinds)
      limit 4) z;
  if picks = 0 then return comp; end if;

  left_n := want;
  for u in select fu.id, fu.name from public.faction_units fu
            where fu.faction_id = (public._legion_meta()->>'hull_fid')
              and fu.category = 'ship'
              and (fu.data->>'class') = any(kinds)
            order by random() limit picks loop
    i := i + 1;
    -- последний тип забирает весь остаток: отряд выходит ровно заявленным
    take := case when i = picks then left_n
                 else greatest(1, round(want::numeric / picks)::int) end;
    take := least(take, left_n);
    exit when take <= 0;
    comp := comp || jsonb_build_array(jsonb_build_object(
      'unit_id', u.id, 'unit_name', u.name, 'qty', take));
    left_n := left_n - take;
  end loop;

  return comp;
end$$;
revoke all on function public._legion_compose(numeric) from public;

-- ── 5. ВЕНДЕТТА: СИЛА ПО ОБИДЧИКУ, ВОЛНОЙ ───────────────────
-- Суперсет legion_vendetta_tick из шага 7.
create or replace function public.legion_vendetta_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v record; t record; debt numeric; str numeric; kid uuid; take numeric;
        sec uuid; sname text; fname text; made int := 0; log jsonb := '[]'::jsonb;
        mus numeric; lair boolean; waves int; part numeric; live int; w int;
        tsys text; tkind text; seen text[];
begin
  for v in select g.faction_id fid, sum(g.weight) debt, max(g.at) last_at
             from public.legion_grudges g
            where g.answered_at is null
            group by g.faction_id
           having sum(g.weight) >= public._legion_vend_const('debt_bite')
            order by 2 desc loop

    lair := public._legion_debt_lair(v.fid);

    -- Сколько ватаг уже в воздухе на эту державу. Рядовая обида — одна, залп по
    -- логову снимает ограничение до трёх: за гнездо Легион приходит волной.
    select count(*) into live from public.legion_contacts k
      where k.reprisal and k.target_fid = v.fid and k.state = 'inbound';
    if live >= (case when lair then public._legion_vend_const('wave_max') else 1 end) then
      continue;
    end if;
    -- выдержка: залп из трёх снарядов подряд не должен родить три отряда.
    -- Для логова выдержки нет — там весь смысл в подлётном времени.
    if not lair and exists (select 1 from public.legion_contacts k
                where k.reprisal and k.target_fid = v.fid
                  and k.depart_at > now() - (public._legion_vend_const('cooldown_h') || ' hours')::interval) then
      continue;
    end if;

    debt := v.debt;
    mus  := public._legion_muscle(v.fid);

    -- СИЛА. Долг говорит «за что», мускул — «кого». Берём максимум из двух:
    -- мелкая держава не получает армаду за царапину, крупная не отделывается
    -- девятью корветами за выжженное логово.
    str := greatest(
             public._legion_vend_const('base') + debt * public._legion_vend_const('per_debt'),
             mus * public._legion_vend_const('share'));
    if lair then str := str * public._legion_vend_const('lair_mult'); end if;
    -- потолок тоже по обидчику: доля его же силы, но не ниже старых 72 —
    -- иначе безфлотовая держава становилась неприкасаемой
    str := least(str, greatest(public._legion_vend_const('cap'),
                               mus * public._legion_vend_const('share_cap')));
    str := least(str, public._legion_vend_const('hard_cap'));

    -- ВОЛНА. Одна ватага в 900 — это один бой, который игрок либо выигрывает,
    -- либо нет. Три по 300 в разных системах — это кампания: их нельзя встретить
    -- одним флотом, и именно так пираты и должны наказывать.
    waves := least(public._legion_vend_const('wave_max')::int,
                   greatest(1, ceil(str / public._legion_vend_const('wave_step'))::int));
    waves := least(waves, (case when lair then public._legion_vend_const('wave_max')::int else 1 end) - live);
    if waves < 1 then continue; end if;
    part := str / waves;

    seen := array[]::text[];
    for w in 1..waves loop
      -- каждая ватага идёт в СВОЮ систему: волну нельзя встретить одним флотом
      select * into t from public._legion_wrath_targets(v.fid)
        where not (sys = any(seen)) limit 1;
      if t.sys is null then exit; end if;
      tsys := t.sys; tkind := t.kind;
      seen := seen || tsys;

      sec := public._legion_sector_of(tsys);
      if sec is null then continue; end if;

      -- копилка сектора тратится, сколько есть; отряд оплачен обидой, не ею
      select least(coalesce(lp.pressure,0), part) into take
        from public.legion_pressure lp where lp.sector_id = sec;
      if coalesce(take,0) > 0 then perform public._legion_spend(sec, take); end if;

      kid := public._legion_contact_spawn(sec, v.fid, tsys, tkind, part);
      if kid is null then continue; end if;
      update public.legion_contacts set reprisal = true where id = kid;

      select name into sname from public.map_systems where id = tsys;
      select name into fname from public.faction_applications
        where faction_id = v.fid and status = 'approved' order by updated_at desc limit 1;

      perform public._legion_news(v.fid, '☠ КАРАТЕЛЬНЫЙ ОТРЯД ЛЕГИОНА ВЫШЕЛ',
        format('Железный Легион ведёт карательный отряд к системе «%s». Замысел — %s, сила отряда — %s (около %s корпусов). Отряд собран по нашей мерке: пираты считают не только нашу наглость, но и наш флот%s',
          coalesce(sname, tsys),
          case tkind when 'strike' then 'удар по колонии'
                     when 'blind'  then 'налёт на аванпост'
                     else 'разбой на трассе' end,
          to_char(round(part), 'FM9990'),
          greatest(1, round(part / 8.0))::int,
          case when lair then '. Счёт открыт залпом по родовому гнезду — идут волной.' else '.' end));

      perform public._legion_feed('☠ ЛЕГИОН ОТПРАВИЛ КАРАТЕЛЬНЫЙ ОТРЯД',
        format('Железный Легион ответил державе «%s» за налёт на свои угодья. К системе «%s» идёт ватага силой %s — около %s корпусов%s У пиратов нет дипломатии: у них есть память и счёт.',
          coalesce(fname, '???'), coalesce(sname, tsys),
          to_char(round(part), 'FM9990'), greatest(1, round(part / 8.0))::int,
          case when lair then ', и это лишь часть волны.' else '.' end));

      made := made + 1;
      log := log || jsonb_build_array(jsonb_build_object(
        'fid', v.fid, 'debt', round(debt,2), 'muscle', round(mus,1), 'lair', lair,
        'sys', tsys, 'kind', tkind, 'strength', round(part,2)));
    end loop;

    if made > 0 then
      update public.legion_grudges
         set answered_at = now(), contact_id = kid
       where faction_id = v.fid and answered_at is null;
    end if;
  end loop;

  perform public.legion_contacts_scan();
  return jsonb_build_object('ok', true, 'reprisals', made, 'log', log);
end$$;
revoke all on function public.legion_vendetta_tick() from public;

-- ── 6. ТЕРПЕНИЕ ВАТАГИ ──────────────────────────────────────
-- Отметка последнего «взятия своего»: без неё ватага доила бы колонию каждые
-- 15 минут, а это уже не давление, а геноцид по расписанию.
alter table public.legion_contacts
  add column if not exists pressed_at timestamptz;

-- Отряд, который стоит в системе и ничего не делает, — главный источник
-- ощущения «бот не работает». Через patience_h часов без боя он берёт своё:
-- колонию грабят прямо под флотом прикрытия (потери за это платит население и
-- склад, а не корабли — драки не было), заставу режут. Флот с карты НЕ
-- убираем: он остаётся стоять, и его всё ещё можно выбить — но уже за долг.
create or replace function public.legion_press_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare k record; col public.colonies; op public.outposts;
        v_pop numeric; abduct numeric; cut int; n int := 0; sname text; frac numeric;
begin
  for k in select c.* from public.legion_contacts c
            where c.state = 'engaged' and c.fleet_id is not null
              and coalesce(c.pressed_at, c.arrive_at)
                  < now() - (public._legion_vend_const('patience_h') || ' hours')::interval
              and exists (select 1 from public.fleets f where f.id = c.fleet_id)
              -- идёт бой — не мешаем: игрок вышел навстречу, это и требовалось
              and not exists (select 1 from public.battles b
                               where b.system_id = c.target_sys
                                 and b.status not in ('done','finished','ended','cancelled')) loop

    select name into sname from public.map_systems where id = k.target_sys;
    -- карательный отряд берёт вдвое: он пришёл наказывать, а не кормиться
    frac := case when k.reprisal then 0.08 else 0.04 end;

    if k.kind = 'blind' then
      select * into op from public.outposts
        where system_id = k.target_sys and faction_id = k.target_fid
          and mode in ('recon','depot')
        order by public._outpost_crew_k(crew, mode) desc limit 1;
      if op.id is not null then
        cut := greatest(1, round(coalesce(op.crew,0) * 0.8)::int);
        update public.outposts set crew = greatest(0, coalesce(crew,0) - cut) where id = op.id;
        perform public._legion_news(k.target_fid, '☠ Заставу взяли на абордаж',
          format('Ватага Легиона простояла в системе «%s» несколько часов и не дождалась боя. Аванпост взят на абордаж: экипаж потерял %s человек. Ватага никуда не ушла.',
                 coalesce(sname, k.target_sys), cut));
        n := n + 1;
      end if;
    else
      select * into col from public.colonies
        where system_id = k.target_sys and faction_id = k.target_fid
        order by coalesce(pop,0) desc limit 1;
      if col.id is not null then
        v_pop  := coalesce(col.pop, coalesce(col.cells,0) * 50);
        abduct := least(1200, floor(v_pop * frac));
        abduct := least(abduct, greatest(0, v_pop - 1));
        if abduct > 0 then
          update public.colonies set pop = greatest(1, v_pop - abduct) where id = col.id;
        end if;
        perform public._legion_news(k.target_fid, '☠ Ватага взяла своё',
          format('Отряд Железного Легиона простоял в системе «%s» несколько часов, боя ему не дали — и он высадился сам. Из колонии «%s» угнано около %s жителей. Ватага осталась на месте: пока её не выбьют, она вернётся.',
                 coalesce(sname, k.target_sys), coalesce(col.planet_name,'колония'), abduct));
        if k.reprisal then
          perform public._legion_feed('☠ ЛЕГИОН ВЗЯЛ СВОЁ',
            format('Карательный отряд простоял в системе «%s» без боя и высадился сам: угнано около %s жителей. Пираты не уходят — счёт закрывается кровью или выкупом.',
                   coalesce(sname, k.target_sys), abduct));
        end if;
        n := n + 1;
      end if;
    end if;

    update public.legion_contacts set pressed_at = now() where id = k.id;
  end loop;
  return jsonb_build_object('ok', true, 'pressed', n);
end$$;
revoke all on function public.legion_press_tick() from public;

-- ── 7. ЦИКЛ ─────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('legion-press-tick')
      where exists (select 1 from cron.job where jobname = 'legion-press-tick');
    perform cron.schedule('legion-press-tick', '11,41 * * * *',
                          'select public.legion_press_tick();');
  end if;
end$$;
