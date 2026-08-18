-- ── 4) РЕЗОЛВ: ветка «цель — флот» перед планетарной ──
-- Надмножество _doom_shells.sql: планетарные ветки не тронуты, добавлена первая
-- проверка на target_fleet_id. Правки резолва вести ОТСЮДА.
create or replace function public._doom_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare s record; tgt public.map_systems; arr jsonb; el jsonb; newpl jsonb; i int;
  victim_fid text; victim_name text; col public.colonies;
  v_icept text; bp jsonb; pop0 numeric; frac numeric; dead_pop numeric; dice int; killed int; bnames text;
  bpf jsonb; fl public.fleets; cur_sys text; flak numeric; fp numeric; nships int; dead_ships int;
  newcomp jsonb; c jsonb; take int; left_ships int;
begin
  for s in select * from public.doom_salvos
           where faction_id = p_fid and status='in_flight' and ready_at <= now()
  loop
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
