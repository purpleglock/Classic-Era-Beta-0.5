-- ════════════════════════════════════════════════════════════
-- ЛЕГИОН, ШАГ 9: ЗУБЫ — ТЕМП КОПИЛКИ И ВЕС УДАРА
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _legion_wrath.sql. Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК. Пираты «не работали» по трём независимым причинам, и все
-- три сводились к одному: механика есть, но она никогда не доходит до игрока.
--
--   1) КОПИЛКА НЕ ДОБИРАЛА ДО ЗАМЫСЛА. gain = 0.02 + fatn×0.06 − guardn×0.05
--      давало 0.06…0.54 в час при цене strike в 48. Богатый сектор молчал по
--      2-5 суток, а два сектора (Элизиум, Солярис) ушли в МИНУС: оборона в
--      вычитаемом обнуляла фон, и они замерли навсегда. «Тихий, а не безопасный
--      НАВСЕГДА» не работало буквально. Теперь оборона — ДЕЛИТЕЛЬ: она
--      замедляет Легион, но не выключает его.
--
--   2) ЛЕСТНИЦА ЗАМЫСЛОВ СЪЕЛА ФОН. Сектор с fatn>=6 копил ТОЛЬКО на strike и
--      не щупал вообще ничего. 6 секторов из 11 не производили ни единого
--      контакта сутками — ровно наоборот замыслу, где probe это «постоянный
--      налог на бардак». Фон теперь идёт ПАРАЛЛЕЛЬНО замыслу и дешевле (8):
--      богатый сектор зудит щупальцами И копит на удар. Молчание перед ударом
--      сохраняется, тишина «ничего не происходит» — нет.
--
--   3) ГЛАВНОЕ: КАРАТЕЛЬНЫЙ ОТРЯД ФИЗИЧЕСКИ НЕ МОГ ПОЯВИТЬСЯ. legion_engage_tick
--      материализовал флот только при def > 0, то есть если игрок УЖЕ держал
--      корабли ровно в этой системе. Не держал — ветка 4c: снять 4% населения
--      с ОДНОЙ колонии и раствориться. Проверено по базе: все 9 карательных
--      отрядов, включая волну силой 118 за залп по логову, ушли в эту ветку —
--      0 флотов Легиона на карте за всю историю, pressed_at пуст у всех.
--      Значит МЁРТВЫМИ оказались разом: вся раскладка гнева по мускулу
--      обидчика (сила отряда в 4c не используется НИГДЕ), волна из трёх ватаг
--      и всё «терпение ватаги» из шага 8 — press_tick смотрит на state
--      'engaged', которого никто никогда не выставлял.
--      Теперь: карательный отряд и крупный удар встают на карту ВСЕГДА, пустая
--      система их не отменяет. Мелкий probe по-прежнему кусает и уходит — он и
--      должен быть налогом, а не событием.
--
-- ⚠ По-прежнему НЕ фабрикуем строку battles из крона (см. _legion_engage.sql):
-- бой остаётся интерактивным. Ватага просто СТОИТ у игрока в системе, и теперь
-- у неё есть и вес, и терпение.
-- ════════════════════════════════════════════════════════════

-- ── 1. КОНСТАНТЫ: фон отдельно от замысла ───────────────────
create or replace function public._legion_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'cost_probe'   then 12
    when 'cost_blind'   then 26
    when 'cost_strike'  then 48
    -- фоновое щупальце: дешевле обычного probe и НЕ конкурирует с замыслом
    when 'cost_bg'      then 8
    -- не чаще раза в N часов на сектор, иначе фон превращается в ковёр
    when 'bg_gap_h'     then 5
    -- запас, ниже которого фон не трогает копилку: замысел важнее шума
    when 'bg_floor'     then 24
    when 'max_inflight' then 3
    when 'aggro_bite'   then 12
    -- сила, начиная с которой отряд встаёт на карту даже в пустой системе
    when 'stand_from'   then 40
    else 0 end
$$;

-- ── 2. ТЕМП КОПИЛКИ: оборона замедляет, а не обнуляет ───────
create or replace function public.legion_pressure_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare s record; fat numeric; guard numeric; gain numeric; cap numeric;
        nsys numeric; fatn numeric; guardn numeric;
        hrs numeric; touched int := 0; total numeric := 0;
begin
  for s in select id, coalesce(array_length(system_ids,1),0) ns from public.map_sectors loop
    if s.ns = 0 then continue; end if;
    insert into public.legion_pressure(sector_id, last_accrue)
      values (s.id, now() - interval '1 hour')
      on conflict (sector_id) do nothing;

    select greatest(0, least(6, extract(epoch from (now() - lp.last_accrue))/3600.0))
      into hrs from public.legion_pressure lp where lp.sector_id = s.id;
    if hrs < 0.5 then continue; end if;

    nsys   := greatest(1, s.ns);
    fat    := public._legion_sector_fat(s.id);
    guard  := public._legion_sector_guard(s.id);
    fatn   := fat / nsys;
    guardn := guard / nsys;
    cap    := 15 + fatn * 6;
    -- ⚠ ДЕЛИТЕЛЬ, а не вычитаемое. Вчетверо укреплённый сектор Легион копит
    -- вдвое дольше — но копит. Обнулить его насовсем нельзя ничем: иначе у
    -- игрока с крепкой обороной пираты просто исчезают из игры.
    gain   := (0.05 + fatn * 0.18) / (1.0 + guardn * 0.25) * hrs;

    update public.legion_pressure
       set pressure    = greatest(0, least(cap, pressure + gain)),
           last_accrue = now()
     where sector_id = s.id;
    touched := touched + 1;
  end loop;

  update public.legion_aggro
     set aggro = case when aggro < 0.05 then 0 else aggro * 0.99 end,
         updated_at = now()
   where aggro > 0;

  select coalesce(sum(pressure),0) into total from public.legion_pressure;
  return jsonb_build_object('ok', true, 'sectors', touched, 'pressure_total', round(total,2));
end$$;
revoke all on function public.legion_pressure_tick() from public;

-- ── 3. ХОД: замысел копится, фон идёт параллельно ───────────
create or replace function public.legion_campaign_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare s record; p numeric; kind text; cost numeric; t record; fatn numeric;
        kid uuid; live int; made int := 0; bg int := 0; log jsonb := '[]'::jsonb;
        eyes boolean; fired boolean;
begin
  for s in select lp.sector_id, lp.pressure, sec.name,
                  greatest(1, coalesce(array_length(sec.system_ids,1),1)) nsys
             from public.legion_pressure lp
             join public.map_sectors sec on sec.id = lp.sector_id
            where lp.pressure >= public._legion_const('cost_bg')
            order by lp.pressure desc loop

    select count(*) into live from public.legion_contacts
     where sector_id = s.sector_id and state = 'inbound';
    if live >= public._legion_const('max_inflight') then continue; end if;

    p := s.pressure;
    fatn := public._legion_sector_fat(s.sector_id) / s.nsys;
    select exists (
      select 1 from public.outposts o
       where o.system_id in (select unnest(system_ids) from public.map_sectors
                              where id = s.sector_id)
         and o.mode in ('recon','depot')
         and public._outpost_crew_k(o.crew, o.mode) >= 0.5) into eyes;

    if    fatn >= 6            then kind := 'strike';
    elsif fatn >= 3 and eyes   then kind := 'blind';
    else                            kind := 'probe';
    end if;
    cost := public._legion_const('cost_' || kind);
    fired := false;

    -- ── ЗАМЫСЕЛ ──
    if p >= cost then
      select * into t from public._legion_targets(s.sector_id, kind) limit 1;
      if t.sys is null and kind <> 'probe' then
        kind := 'probe'; cost := public._legion_const('cost_probe');
        select * into t from public._legion_targets(s.sector_id, kind) limit 1;
      end if;
      if t.sys is not null and public._legion_spend(s.sector_id, cost) then
        kid := public._legion_contact_spawn(s.sector_id, t.fid, t.sys, kind, cost);
        if kid is not null then
          fired := true; made := made + 1;
          log := log || jsonb_build_array(jsonb_build_object(
            'sector', s.name, 'kind', kind, 'cost', cost,
            'target_sys', t.sys, 'target_fid', t.fid, 'score', t.score));
        end if;
      end if;
    end if;

    -- ── ФОН ──
    -- Щупальце идёт, только если сектор копит на что-то КРУПНОЕ (иначе probe
    -- и есть его замысел, дублировать незачем), копилка выше пола и в этом
    -- секторе давно не шумели. Оплачивается отдельной мелкой монетой, чтобы
    -- накопление на strike фон не срывал.
    if not fired and kind <> 'probe'
       and (select pressure from public.legion_pressure where sector_id = s.sector_id)
           >= public._legion_const('bg_floor')
       and not exists (select 1 from public.legion_contacts k
                        where k.sector_id = s.sector_id and not k.reprisal
                          and k.depart_at > now()
                              - (public._legion_const('bg_gap_h') || ' hours')::interval)
    then
      select * into t from public._legion_targets(s.sector_id, 'probe') limit 1;
      if t.sys is not null
         and public._legion_spend(s.sector_id, public._legion_const('cost_bg')) then
        kid := public._legion_contact_spawn(s.sector_id, t.fid, t.sys, 'probe',
                                            public._legion_const('cost_bg'));
        if kid is not null then
          bg := bg + 1;
          log := log || jsonb_build_array(jsonb_build_object(
            'sector', s.name, 'kind', 'probe/фон', 'cost', public._legion_const('cost_bg'),
            'target_sys', t.sys, 'target_fid', t.fid));
        end if;
      end if;
    end if;
  end loop;

  perform public.legion_contacts_scan();
  return jsonb_build_object('ok', true, 'launched', made, 'background', bg, 'log', log);
end$$;
revoke all on function public.legion_campaign_tick() from public;

-- ── 4. СОСТАВ: пустой отряд больше не «дуд» ─────────────────
-- Если у Железного Дивизиона нет корпусов нужного калибра, отряд собирался
-- ПУСТЫМ и контакт молча гас. Теперь падаем на то, что есть: пираты приходят
-- на чём попало, это их и характеризует.
create or replace function public._legion_compose(p_strength numeric)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare want int; kinds text[]; comp jsonb := '[]'::jsonb; u record;
        left_n int; picks int; i int := 0; take int; hull text;
begin
  hull := public._legion_meta()->>'hull_fid';
  want := greatest(1, round(coalesce(p_strength,12) / 8.0))::int;
  if    p_strength >= 150 then kinds := array['battleship','cruiser','mediumCruiser','supportCarrier','destroyer'];
  elsif p_strength >= 80  then kinds := array['cruiser','mediumCruiser','destroyer','supportCarrier'];
  elsif p_strength >= 40  then kinds := array['mediumCruiser','cruiser','destroyer','corvette','supportCarrier'];
  elsif p_strength >= 22  then kinds := array['destroyer','corvette','mediumCruiser'];
  else                         kinds := array['corvette','destroyer'];
  end if;

  select count(*) into picks from (
    select fu.id from public.faction_units fu
      where fu.faction_id = hull and fu.category = 'ship'
        and (fu.data->>'class') = any(kinds)
      limit 4) z;
  -- нет калибра — берём любые корпуса Легиона
  if picks = 0 then
    kinds := null;
    select count(*) into picks from (
      select fu.id from public.faction_units fu
        where fu.faction_id = hull and fu.category = 'ship' limit 4) z;
  end if;
  if picks = 0 then return comp; end if;

  left_n := want;
  for u in select fu.id, fu.name from public.faction_units fu
            where fu.faction_id = hull and fu.category = 'ship'
              and (kinds is null or (fu.data->>'class') = any(kinds))
            order by random() limit picks loop
    i := i + 1;
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

-- ── 5. ВЫСАДКА: отряд встаёт на карту, а грабёж знает свой вес ─
create or replace function public.legion_engage_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare k record; def int; comp jsonb; col public.colonies; op public.outposts;
        abduct numeric; v_pop numeric; cut int; fid_new uuid; frac numeric;
        hits int; nm text;
        n_fight int := 0; n_plunder int := 0; n_blind int := 0; n_dud int := 0;
begin
  for k in select * from public.legion_contacts
            where state = 'landed' and fleet_id is null
            order by arrive_at loop

    -- ── 4a. ОСЛЕПЛЕНИЕ ──────────────────────────────────────
    if k.kind = 'blind' then
      select * into op from public.outposts
        where system_id = k.target_sys and faction_id = k.target_fid
          and mode in ('recon','depot')
        order by public._outpost_crew_k(crew, mode) desc limit 1;

      if op.id is null then
        update public.legion_contacts set state = 'spent' where id = k.id;
        n_dud := n_dud + 1;
        continue;
      end if;

      cut := greatest(1, round(coalesce(op.crew,0) * 0.6
                               / greatest(1, public._legion_sys_guard(k.target_sys)))::int);
      update public.outposts set crew = greatest(0, coalesce(crew,0) - cut) where id = op.id;

      perform public._legion_news(k.target_fid,
        case when coalesce(op.crew,0) - cut <= 0
             then 'Застава потеряна' else 'Налёт на заставу' end,
        format('Отряд Железного Легиона ударил по %s-аванпосту в системе %s. Экипаж потерял %s человек%s',
          case op.mode when 'recon' then 'разведывательному' else 'заправочному' end,
          k.target_sys, cut,
          case when coalesce(op.crew,0) - cut <= 0
               then '. Станция брошена и будет свёрнута — сектор остался без глаз.'
               else '. Станция держится, но работает вполсилы.' end));

      update public.legion_contacts set state = 'spent' where id = k.id;
      n_blind := n_blind + 1;
      continue;
    end if;

    -- ── 4b. ОТРЯД ВСТАЁТ НА КАРТУ ───────────────────────────
    -- ⚠ Условие было `def > 0`, и это убивало весь гнев: карательная волна в
    -- пустой системе не материализовалась НИКОГДА. Теперь на карту встают все,
    -- кто пришёл наказывать или пришёл крупным составом. Пустая система — не
    -- причина отменить отряд, а причина, по которой выбивать его будет некому.
    def := public._legion_defenders(k.target_sys);
    if def > 0 or k.reprisal
       or coalesce(k.strength,0) >= public._legion_const('stand_from') then
      comp := public._legion_compose(k.strength);
      if jsonb_array_length(comp) = 0 then
        update public.legion_contacts set state = 'spent' where id = k.id;
        n_dud := n_dud + 1;
        continue;
      end if;
      insert into public.fleets(faction_id, name, status, system_id, home_sys, composition)
        values (public._legion_fid(),
                case when k.reprisal then 'Карательный отряд Легиона'
                     else 'Ватага Легиона' end,
                'idle', k.target_sys, k.target_sys, comp)
        returning id into fid_new;

      update public.legion_contacts
         set state = 'engaged', fleet_id = fid_new where id = k.id;

      select name into nm from public.map_systems where id = k.target_sys;
      perform public._legion_news(k.target_fid,
        case when k.reprisal then '☠ Карательный отряд встал в системе'
             else 'Пираты в системе' end,
        format('%s Железного Легиона вышел из пустоты в системе «%s» и встал там: %s корпусов. Ватага не уйдёт сама — её придётся выбивать, иначе через несколько часов она возьмёт своё%s',
          case when k.reprisal then 'Карательный отряд' else 'Отряд' end,
          coalesce(nm, k.target_sys),
          (select coalesce(sum((c->>'qty')::int),0) from jsonb_array_elements(comp) c),
          case when def > 0 then ', а ваши корабли уже под её орудиями.' else '.' end));
      n_fight := n_fight + 1;
      continue;
    end if;

    -- ── 4c. МЕЛОЧЬ: укусить и уйти ──────────────────────────
    -- Сюда падает только фон и слабый probe. Доля добычи теперь зависит от
    -- вложенной силы: раньше отряд в 118 и щупальце в 8 угоняли поровну.
    frac := least(0.10, 0.02 + coalesce(k.strength,0) / 800.0);
    hits := least(3, 1 + floor(coalesce(k.strength,0) / 40.0)::int);

    select * into col from public.colonies
      where system_id = k.target_sys and faction_id = k.target_fid
      order by coalesce(pop,0) desc limit 1;

    if col.id is not null then
      v_pop := coalesce(col.pop, coalesce(col.cells,0) * 50);
      abduct := least(400, floor(v_pop * frac));
      abduct := least(abduct, greatest(0, v_pop - 1));
      if abduct > 0 then
        update public.colonies
           set pop = greatest(1, v_pop - abduct) where id = col.id;
      end if;
      perform public._legion_news(k.target_fid, 'Угон населения',
        format('Пираты Железного Легиона беспрепятственно вошли в систему %s: в колонии «%s» не оказалось ни одного корабля прикрытия. Угнано около %s жителей.',
               k.target_sys, coalesce(col.planet_name,'колония'), abduct));
      n_plunder := n_plunder + 1;
    else
      update public.trade_routes
         set volume = greatest(0, coalesce(volume,0) * 0.75)
       where status = 'active'
         and (origin_sys = k.target_sys or dest_sys = k.target_sys)
         and (a_fid = k.target_fid or b_fid = k.target_fid);
      perform public._legion_news(k.target_fid, 'Караван разграблен',
        format('Ватага Легиона перехватила конвой у системы %s. Часть груза потеряна.', k.target_sys));
      n_plunder := n_plunder + 1;
    end if;

    update public.legion_contacts set state = 'spent' where id = k.id;
  end loop;

  return jsonb_build_object('ok', true, 'fights', n_fight,
                            'plunder', n_plunder, 'blinded', n_blind, 'duds', n_dud);
end$$;
revoke all on function public.legion_engage_tick() from public;

-- ── 6. ТЕРПЕНИЕ: «взять своё» тоже по весу отряда ───────────
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
              and not exists (select 1 from public.battles b
                               where b.system_id = c.target_sys
                                 and b.status not in ('done','finished','ended','cancelled')) loop

    select name into sname from public.map_systems where id = k.target_sys;
    -- вес отряда решает, сколько он берёт: волна за логово должна ощущаться
    -- иначе, чем ватага с трассы
    frac := least(0.18, (case when k.reprisal then 0.05 else 0.02 end)
                        + coalesce(k.strength,0) / 1200.0);

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
