-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 3: ПЕЧАТИ. ЕДИНСТВЕННАЯ ДОРОГА К СМЕРТИ АНГЕЛА
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_core.sql, _angel_battle.sql и после
-- _shell_fleet_resolve.sql (этот файл — его надмножество).
-- ⚠️ ПРАВКИ РЕЗОЛВА ЗАЛПОВ ВЕСТИ ОТСЮДА: теперь _doom_resolve последний раз
-- переопределяется здесь. Планетарные ветки и ветка «Сполох по флоту» не
-- тронуты ни строкой — добавлена ветка ангела ПЕРЕД ними.
-- Дальше по цепочке: _angel_ai.sql. Идемпотентно.
--
-- ЗАЧЕМ. На доске ангела убить нельзя (см. _angel_battle.sql) — значит должна
-- существовать ровно одна дорога, и она обязана быть трудной, дорогой и
-- КООРДИНИРУЕМОЙ. Иначе получится либо неубиваемая имба, либо «сбили из ружья».
--
-- КАК ЭТО ИГРАЕТСЯ ЖЕРТВОЙ АНГЕЛА (то есть всей галактикой):
--   1) Гиперпейсеры берут тепловую сигнатуру ковчега и льют по нему баллистику.
--      Печати она почти не рвёт (0.5-1.1 из 100), зато КАЖДЫЙ пришедший снаряд
--      добавляет давления, а давление гасит парирование по экспоненте.
--   2) Пока ангел подавлен (давление ~6 → отбивает 6% вместо 72%), Длани бьют
--      снарядами судного дня: 2.2-3.4 печати за попадание.
--   3) Останавливаться нельзя. Пять часов без попаданий — и печати начинают
--      зарастать по 1.6/час, в гнезде вдвое быстрее. Недоведённая кампания
--      не наносит ангелу вообще никакого ущерба, только тратит снаряды.
-- Итог: ~30-45 залпов Длани при нормальном подавлении. В одиночку — никогда.
--
-- ЧТО НЕ РАБОТАЕТ ПРОТИВ АНГЕЛА И ПОЧЕМУ:
--   • Зенитный огонь. У ковчега один борт — зениток нет по устройству, и
--     парирование это не зенитки, а уход с траектории. Ветку flak пропускаем.
--   • Ожерелье Немезиды. Ангел его строить не может (запрет в _angel_core), но
--     он мог бы ПРИПАРКОВАТЬСЯ под чужим Ожерельем и стать бессмертным. Кольцо
--     перехватчиков настроено на защиту ПЛАНЕТ системы; ковчег планетой этой
--     системы не является, и Ожерелье его не прикрывает. Дыру закрываем здесь.
-- ════════════════════════════════════════════════════════════

-- ── 1. КОВЧЕГ НЕ РАЗБИРАЕТСЯ ПО КОРАБЛЯМ ────────────────────
-- Надмножество _army_fleet.sql. _fleet_kill_ships снимает корабли с состава и
-- УДАЛЯЕТ флот, когда состав опустел. У ангела в составе один борт: любая мина,
-- любая ловушка, любой «Сполох» уносили бы всю державу мимо механики печатей.
-- Ковчег теряется только через печати — здесь ставим заслонку.
create or replace function public._fleet_kill_ships(p_fleet uuid, p_kill int)
returns int language plpgsql security definer set search_path=public as $$
declare fl public.fleets; elem jsonb; comp jsonb := '[]'::jsonb;
        total int := 0; kill int; left_k int; q int; cut int; killed int := 0;
begin
  select * into fl from public.fleets where id = p_fleet for update;
  if not found then return 0; end if;
  -- ◈ ПРЕСТОЛ: корабли у ангела не считают. Урон по нему идёт только печатями.
  if public._angel_is(fl.faction_id) then return 0; end if;

  select coalesce(sum(greatest(0,(c->>'qty')::int)),0) into total
    from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c;
  if total <= 0 then return 0; end if;
  kill := least(total, greatest(0, p_kill));
  if kill <= 0 then return 0; end if;
  left_k := kill;
  for elem in select value from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) loop
    q := greatest(0, coalesce((elem->>'qty')::int, 0));
    cut := least(q, ceil(kill * q::numeric / total)::int, left_k);
    left_k := left_k - cut; killed := killed + cut;
    if q - cut > 0 then
      comp := comp || jsonb_set(elem, '{qty}', to_jsonb(q - cut));
    end if;
  end loop;
  if killed < kill and jsonb_array_length(comp) > 0 then
    -- округления недобрали — добираем с первой строки
    q := greatest(0, coalesce((comp->0->>'qty')::int, 0));
    cut := least(q, kill - killed); killed := killed + cut;
    if q - cut > 0 then comp := jsonb_set(comp, '{0,qty}', to_jsonb(q - cut));
    else comp := comp - 0; end if;
  end if;
  if jsonb_array_length(comp) = 0 then
    delete from public.fleets where id = p_fleet;
  else
    update public.fleets set composition = comp where id = p_fleet;
  end if;
  return killed;
end$$;

-- ── 2. ПОПАДАНИЕ В ПЕЧАТЬ ───────────────────────────────────
-- Одна функция на оба калибра: разница только в тарифе печатей.
-- Возвращает, что произошло, — резолв по этому пишет сводку.
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

  -- Парирование считаем по давлению ДО этого снаряда: подавляют ангела
  -- ПРЕДЫДУЩИЕ залпы, а не тот, который сейчас подлетает.
  pp := public._angel_parry_p(p_fid);
  parried := (random() < pp);

  -- Давление копит ЛЮБОЙ пришедший снаряд, включая отбитый: ангел всё равно
  -- уходил с траектории, всё равно тратил внимание. Именно поэтому дешёвая
  -- баллистика Гиперпейсера работает как подавление, ничего не разрушая.
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

-- ── 3. ДВЕРЬ ДЛАНИ: ЗАЛП ПО ПРЕСТОЛУ ────────────────────────
-- Отдельная дверь, потому что doom_fire требует planet_pid из map_systems, а у
-- ковчега пида нет и быть не может: он не планета системы, он в системе гостит.
-- Наводка здесь такая же, как у «Сполоха» — по СИГНАТУРЕ. Уйти нельзя.
-- Гиперпейсеру своя дверь не нужна: mza_fire_fleet уже стреляет по флоту,
-- а ковчег — флот. Резолв разберётся сам.
create or replace function public.doom_fire_angel(p_gun_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; g public.doom_guns; a record; f public.fleets; lock_sys text;
        org public.map_systems; tgt public.map_systems; dist numeric; map_diag numeric;
        frac numeric; fly_h numeric; rdy timestamptz; fname text;
begin
  fid := public._ec_my_fid();
  perform public._doom_settle(fid);

  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then raise exception 'Престола нет — стрелять не по чему'; end if;
  if a.faction_id = fid then raise exception 'это ваш собственный Престол'; end if;

  select * into g from public.doom_guns where id = p_gun_id;
  if not found then raise exception 'gun not found'; end if;
  if g.faction_id is distinct from fid then raise exception 'not your gun'; end if;
  if g.integrity <= 0 then raise exception 'gun is wrecked'; end if;
  if exists(select 1 from public.doom_salvos where gun_id = g.id and status='in_flight') then
    raise exception 'salvo already in flight';
  end if;

  select * into f from public.fleets where id = a.fleet_id;
  if not found then raise exception 'сигнатура не читается: ковчега нет на карте'; end if;
  lock_sys := coalesce(f.system_id, f.from_sys, f.dest_sys);
  if lock_sys is null then raise exception 'сигнатура не читается: ковчег вне карты'; end if;

  -- боекомплект: 1 построенный СНАРЯД ДЛАНИ со склада снарядов
  perform public._shell_take(fid, 'doom');
  update public.doom_guns
     set integrity = greatest(0, integrity - public._doom_const('shot_wear')),
         total_shots = total_shots + 1
   where id = g.id;

  select * into org from public.map_systems where id = g.system_id;
  select * into tgt from public.map_systems where id = lock_sys;
  dist := sqrt(power(coalesce(tgt.x,0)-coalesce(org.x,0),2)
             + power(coalesce(tgt.y,0)-coalesce(org.y,0),2));
  select sqrt(power(max(x)-min(x),2) + power(max(y)-min(y),2)) into map_diag from public.map_systems;
  frac  := least(1.0, greatest(0.0, dist / nullif(map_diag,0)));
  fly_h := public._doom_const('flight_h_min')
         + frac * (public._doom_const('flight_h_max') - public._doom_const('flight_h_min'));
  rdy := now() + (round(fly_h*60)::int || ' minutes')::interval;

  insert into public.doom_salvos
    (gun_id, faction_id, owner_id, origin_system_id, target_system_id,
     target_pid, target_planet, target_fleet_id, ready_at, kind, victim_fid)
  values
    (g.id, fid, auth.uid(), g.system_id, lock_sys,
     null, 'Престол', f.id, rdy, 'doom', a.faction_id);

  select name into fname from public.faction_applications
   where faction_id = fid and status='approved' order by updated_at desc limit 1;
  perform public._doom_news(public._angel_glitch('🜨 ЗАЛП ПО ОТМЕТКЕ', 0.20),
    public._angel_glitch(
      'Длань Неотвратимости ('||coalesce(fname,'???')||') дала залп. Подлёт ~'||
      to_char(fly_h,'FM990.0')||' ч.', 0.14)
    ||' '||public._angel_scream(11));

  return jsonb_build_object('ok', true, 'ready_at', rdy, 'flight_h', round(fly_h,1),
                            'lock_sys', lock_sys, 'dist', round(dist));
end$$;
revoke all on function public.doom_fire_angel(uuid) from public;
grant execute on function public.doom_fire_angel(uuid) to authenticated;

-- ── 4. РЕЗОЛВ: ВЕТКА АНГЕЛА ПЕРЕД ВСЕМИ ─────────────────────
-- Надмножество _shell_fleet_resolve.sql. Вставка одна: если цель — ковчег,
-- уходим в печати и НЕ доходим ни до Ожерелья, ни до зениток, ни до планет.
create or replace function public._doom_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare s record; tgt public.map_systems; arr jsonb; el jsonb; newpl jsonb; i int;
  victim_fid text; victim_name text; col public.colonies;
  v_icept text; bp jsonb; pop0 numeric; frac numeric; dead_pop numeric; dice int; killed int; bnames text;
  bpf jsonb; fl public.fleets; cur_sys text; flak numeric; fp numeric; nships int; dead_ships int;
  newcomp jsonb; c jsonb; take int; left_ships int;
  ang_fid text; hit jsonb; shooter text;
begin
  for s in select * from public.doom_salvos
           where faction_id = p_fid and status='in_flight' and ready_at <= now()
  loop
    -- ══ ◈ ПРЕСТОЛ: ПЕЧАТЬ ══════════════════════════════════════════════
    -- Ковчег ловим по флоту-цели: и Длань (doom_fire_angel), и Гиперпейсер
    -- (mza_fire_fleet) наводятся на сигнатуру, так что цель у обоих одна.
    ang_fid := null;
    if s.target_fleet_id is not null then
      select a.faction_id into ang_fid from public.angel_state a
        where a.fleet_id = s.target_fleet_id and a.fell_at is null;
    end if;
    if ang_fid is not null then
      shooter := public._fac_name(p_fid);
      hit := public._angel_take_salvo(ang_fid,
               case when coalesce(s.kind,'doom') = 'doom' then 'doom' else 'ball' end, p_fid);

      if coalesce((hit->>'parried')::boolean, false) then
        update public.doom_salvos
           set status='intercepted', resolved_at=now(), duel_result='parry',
               victim_fid = ang_fid
         where id = s.id;
        -- ⚠️ Ни слова про «печати целы» и почему промах: стрелявший должен
        -- увидеть, что снаряд пропал, и не понять причины.
        perform public._doom_news(public._angel_glitch('◈ ЦЕЛЬ НЕ ПОРАЖЕНА', 0.24),
          public._angel_glitch(
            'Снаряд ('||coalesce(shooter,'???')||') шёл точно и пришёл точно — в то место, где цели уже не было.', 0.20)
          ||' '||public._angel_scream(12)||' '||
          public._angel_glitch('Расход боекомплекта — полный.', 0.12));
      else
        update public.doom_salvos
           set status='done', resolved_at=now(), duel_result='seal',
               victim_fid = ang_fid
         where id = s.id;
        if coalesce((hit->>'fell')::boolean, false) then
          -- сводку о падении уже дал _angel_fall — здесь молчим, чтобы в ленте
          -- не стояло двух строк об одном событии (см. news-terse)
          null;
        else
          -- ⚠️ ШКАЛУ СНЯЛИ. Здесь стояло «печати: рвутся / на исходе» — то есть
          -- ровно та подсказка, ради которой всю затею и стоило прятать: по ней
          -- считалось, сколько залпов осталось. Теперь попадание видно, а
          -- ПОСЛЕДСТВИЙ не видно. Понять, работает ли кампания, можно только
          -- продолжая её.
          perform public._doom_news(
            public._angel_glitch('◈ ПОПАДАНИЕ ЗАФИКСИРОВАНО', 0.26),
            public._angel_glitch(
              'Залп ('||coalesce(shooter,'???')||') дошёл до отметки. Вспышка держалась дольше расчётной.', 0.20)
            ||' '||public._angel_scream(10)||' '||
            public._angel_glitch('Оно не издало ни звука. Оценка состояния цели', 0.24)
            ||' '||public._angel_scream(15));
        end if;
      end if;
      continue;
    end if;

    -- 🔥 Х77 «СПОЛОХ»: цель — не координата, а тепловая сигнатура флота.
    -- Уйти нельзя: берём флот там, где он сейчас. Отвечает только он сам —
    -- зенитным огнём, либо Ожерелье Немезиды над системой, где его застали.
    bpf := public._ball_params(coalesce(s.kind,'doom'));
    if s.target_fleet_id is not null then
      select * into fl from public.fleets where id = s.target_fleet_id;
      select coalesce(sum(greatest(0,(x->>'qty')::int)),0) into nships
        from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) x;
      if not found or coalesce(nships,0) <= 0 then
        perform public._doom_news('🔥 «СПОЛОХ» ПОТЕРЯЛ ЦЕЛЬ',
          'Снаряд Х77 пришёл на сигнатуру флота «'||coalesce(s.target_planet,'???')||
          '», но жечь было уже нечего: флота не существует. Вспышка ушла в пустоту.');
        update public.doom_salvos set status='done', resolved_at=now() where id = s.id;
        continue;
      end if;
      cur_sys := fl.system_id;
      if cur_sys is not null and exists(
           select 1 from public.colony_buildings cb
             join public.colonies c2 on c2.id = cb.colony_id
            where cb.btype='nemesis' and c2.system_id = cur_sys) then
        update public.doom_salvos set status='intercepted', resolved_at=now(), duel_result='nemesis' where id = s.id;
        perform public._doom_news('⛨ «СПОЛОХ» СНЯТ ОЖЕРЕЛЬЕМ',
          'Флот «'||coalesce(fl.name,'???')||'» встретил подлёт под Ожерельем Немезиды. '||
          'Кольцо перехватчиков сняло Х77 на подходе — на мостиках даже не сыграли тревогу.');
        continue;
      end if;
      flak := public._fleet_flak(fl.id);
      fp   := public._fleet_flak_p(flak);
      update public.doom_salvos set flak_p = fp, victim_fid = fl.faction_id where id = s.id;
      if random() < fp then
        update public.doom_salvos set status='intercepted', resolved_at=now(), duel_result='flak' where id = s.id;
        perform public._doom_news('⛨ ЗЕНИТНЫЙ ОГОНЬ: «СПОЛОХ» СБИТ',
          'Флот «'||coalesce(fl.name,'???')||'» встретил Х77 плотным зенитным огнём: '||
          to_char(flak,'FM999990')||' расчётных стволов, шанс перехвата '||
          to_char(round(fp*100),'FM990')||'%. Боеголовка сгорела в стороне.');
        continue;
      end if;
      -- 💥 Вспышка: часть кораблей просто перестаёт быть.
      frac := (bpf->>'kmin')::numeric + random() * (((bpf->>'kmax')::numeric) - ((bpf->>'kmin')::numeric));
      newcomp := '[]'::jsonb; dead_ships := 0;
      for c in select value from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) loop
        take := round(greatest(0,(c->>'qty')::int) * frac);
        dead_ships := dead_ships + take;
        newcomp := newcomp || jsonb_build_array(
          c || jsonb_build_object('qty', greatest(0,(c->>'qty')::int) - take));
      end loop;
      if dead_ships = 0 then       -- малый флот: округление съело потери, но вспышка была
        newcomp := '[]'::jsonb; dead_ships := 0;
        for c in select value from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) loop
          take := case when dead_ships = 0 and greatest(0,(c->>'qty')::int) > 0 then 1 else 0 end;
          dead_ships := dead_ships + take;
          newcomp := newcomp || jsonb_build_array(
            c || jsonb_build_object('qty', greatest(0,(c->>'qty')::int) - take));
        end loop;
      end if;
      select coalesce(sum(greatest(0,(x->>'qty')::int)),0) into left_ships
        from jsonb_array_elements(newcomp) x;
      if left_ships <= 0 then
        delete from public.fleets where id = fl.id;
      else
        update public.fleets set composition = (
          select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(newcomp) x
           where greatest(0,(x->>'qty')::int) > 0) where id = fl.id;
      end if;
      perform public._doom_news(
        '🔥 ВСПЫШКА В ПУСТОТЕ: ФЛОТ ПОД УДАРОМ Х77',
        'Зенитный огонь флота «'||coalesce(fl.name,'???')||'» ('||to_char(round(fp*100),'FM990')||
        '%) не достал боеголовку. «Сполох» подорвался в ордере: потеряно '||dead_ships||
        ' кораблей из '||nships||'. '||
        case when left_ships <= 0 then 'Флота больше нет — на радарах чисто.'
             else 'В строю осталось '||left_ships||'. Уцелевшие идут дальше, но идут не все.' end);
      update public.doom_salvos set status='done', resolved_at=now() where id = s.id;
      continue;
    end if;

    -- ⛨ ПЕРЕХВАТ: Ожерелье Немезиды (вся система) → планетарная ПРО
    v_icept := public._doom_intercept(s.target_system_id, s.target_pid, coalesce(s.kind,'doom'));
    if v_icept is not null then
      update public.doom_salvos set status='intercepted', resolved_at=now() where id = s.id;
      perform public._doom_news('⛨ ЗАЛП ПЕРЕХВАЧЕН',
        case when v_icept = 'nemesis'
          then 'Ожерелье Немезиды вспыхнуло над системой: залп по планете «'||coalesce(s.target_planet,'???')||
               '» сбит кольцом перехватчиков ещё на подходе. Пока Ожерелье стоит, система неуязвима — сбивать залпы оно будет вечно.'
          else 'Залп по планете «'||coalesce(s.target_planet,'???')||
               '» сбит планетарной ПРО. Планета уцелела — снаряд противоракеты израсходован.' end);
      continue;
    end if;

    bp := public._ball_params(coalesce(s.kind,'doom'));
    if bp is not null then
      -- 💥 БАЛЛИСТИКА: планета живёт; урон по паспорту тира
      select * into col from public.colonies
        where system_id = s.target_system_id
          and ((s.target_pid is not null and planet_pid = s.target_pid)
               or (s.target_pid is null and s.target_planet is not null and planet_name = s.target_planet))
        order by (planet_pid is not null) desc limit 1;
      if found then
        pop0 := coalesce(col.pop, coalesce(col.cells,6)*50);
        frac := (bp->>'pmin')::numeric + random() * ((bp->>'pmax')::numeric - (bp->>'pmin')::numeric);
        dead_pop := round(pop0 * frac);
        update public.colonies set pop = greatest(1, pop0 - dead_pop) where id = col.id;
        -- постройки: равновероятный дайс bmin..bmax (у тяжёлой bmin=bmax=5 — гарантия)
        dice := (bp->>'bmin')::int + floor(random() * ((bp->>'bmax')::int - (bp->>'bmin')::int + 1))::int;
        killed := 0; bnames := null;
        if dice > 0 then
          with victims as (
            select id, btype from public.colony_buildings
              where colony_id = col.id order by random() limit dice
          ), gone as (
            delete from public.colony_buildings cb using victims v where cb.id = v.id returning v.btype
          )
          select string_agg(coalesce(nullif(btype,''),'постройка'), ', '), count(*)
            into bnames, killed from gone;
        end if;
        select name into victim_name from public.faction_applications
          where faction_id = col.faction_id and status='approved' order by updated_at desc limit 1;
        update public.doom_salvos set victim_fid = col.faction_id where id = s.id;
        perform public._doom_news(
          '💥 БАЛЛИСТИЧЕСКИЙ УДАР ПО «'||upper(coalesce(s.target_planet,'???'))||'»',
          'Баллистический снаряд достиг планеты «'||coalesce(s.target_planet,'???')||'»'||
          case when victim_name is not null then ' державы «'||victim_name||'»' else '' end||
          '. Погибло ~'||to_char(dead_pop,'FM999999990')||' жителей ('||to_char(round(frac*100),'FM990')||'% населения). '||
          case when coalesce(killed,0) > 0
               then 'Разрушено построек: '||killed||' ('||coalesce(bnames,'')||').'
               else 'Постройки чудом уцелели.' end);
      else
        perform public._doom_news(
          '💥 БАЛЛИСТИЧЕСКИЙ УДАР В ПУСТОТУ',
          'Баллистический снаряд лёг на «'||coalesce(s.target_planet,'???')||'», но смерть не вышла на работу. '||
          'Кратер станет памятником расточительности.');
      end if;
      update public.doom_salvos set status='done', resolved_at=now() where id = s.id;
      continue;
    end if;

    -- ☠ СНАРЯД ДЛАНИ: планета → мёртвый камень (как раньше)
    select * into tgt from public.map_systems where id = s.target_system_id;
    if found then
      arr := coalesce(tgt.planets, '[]'::jsonb);
      newpl := '[]'::jsonb;
      for i in 0 .. jsonb_array_length(arr)-1 loop
        el := arr->i;
        if (el->>'pid')::int = s.target_pid then
          el := el
            || jsonb_build_object(
                 'g','lava', 'kind','planet', 'type','Мёртвая планета',
                 'icon','🪨', 'slotsP', 0, 'slotsK', 0,
                 'resources','[]'::jsonb, 'dead', true, 'doomed', true,
                 'doomed_by', p_fid, 'doomed_at', to_jsonb(now()));
        end if;
        newpl := newpl || jsonb_build_array(el);
      end loop;
      update public.map_systems set planets = newpl where id = tgt.id;

      if to_regclass('public.system_minefields') is not null then
        delete from public.system_minefields
          where system_id = s.target_system_id
            and ((s.target_pid is not null and planet_pid = s.target_pid)
                 or (s.target_pid is null and planet_pid is null));
      end if;

      victim_fid := null; victim_name := null;
      select * into col from public.colonies
        where system_id = s.target_system_id
          and ((s.target_pid is not null and planet_pid = s.target_pid)
               or (s.target_pid is null and s.target_planet is not null and planet_name = s.target_planet))
        order by (planet_pid is not null) desc limit 1;
      if found then
        victim_fid := col.faction_id;
        select name into victim_name from public.faction_applications
          where faction_id = victim_fid and status='approved' order by updated_at desc limit 1;
        delete from public.colonies where id = col.id;
        update public.doom_salvos set victim_fid = col.faction_id where id = s.id;
      end if;

      perform public._doom_news(
        '☠ ГИБЕЛЬ МИРА',
        'Планета «'||coalesce(s.target_planet,'???')||'» в системе «'||coalesce(tgt.name,'???')||
        '» перестала существовать. И ты, как все, пойдешь во мрак, где нет ни Бога, ни людей. И будешь ты, как падший злак, в пустыне тлеть, один, как враг самих теней!'||
        case when victim_name is not null then ' Колония державы «'||victim_name||'» стёрта вместе с миром.' else '' end||
        ' Молчите. Здесь больше нечего сказать.');
    end if;

    update public.doom_salvos set status='done', resolved_at=now() where id = s.id;
  end loop;
end$$;
revoke all on function public._doom_resolve(text) from public;

-- ── 5. ВХОДЯЩИЕ ПО ПРЕСТОЛУ ─────────────────────────────────
-- Ангел должен ВИДЕТЬ подлёт: на этом стоит вся его тактика (уйти в гнездо,
-- пока не рвут печати). Зовёт ИИ, и своя держава — в кабинете.
create or replace function public.angel_incoming()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return '[]'::jsonb; end if;
  -- ⚠️ Табло подлёта — только своей державе. Чужому оно показало бы, сколько
  -- снарядов уже в воздухе, то есть выдало бы чужую кампанию и её темп.
  begin
    if public._ec_my_fid_opt() is distinct from a.faction_id then return '[]'::jsonb; end if;
  exception when others then return '[]'::jsonb; end;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'salvo_id', s.id, 'kind', s.kind, 'from', public._fac_name(s.faction_id),
      'ready_at', s.ready_at,
      'doom', (coalesce(s.kind,'doom') = 'doom')) order by s.ready_at)
      from public.doom_salvos s
     where s.status = 'in_flight' and s.target_fleet_id = a.fleet_id
  ), '[]'::jsonb);
end$$;
revoke all on function public.angel_incoming() from public;
grant execute on function public.angel_incoming() to authenticated;

notify pgrst, 'reload schema';
