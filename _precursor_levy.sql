-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · ЭТАП 8: СБОР (lore/precursor_memory.md §18.2, §16)
--
-- ПОРЯДОК: после _precursor_arrears.sql и _legion_teeth.sql. Идемпотентно.
--
-- Сбор — не новая сущность на карте, а та же машина Легиона с другой причиной:
--   _legion_sector_of / _legion_wrath_targets / _legion_muscle / _legion_compose /
--   _legion_contact_spawn / legion_contacts_scan / _legion_news / _legion_feed.
-- Отличий от пиратов ровно четыре, и все они из §18.2:
--   • давление копится ТАМ, ОТКУДА БРАЛИ (pc_levy_pressure), а не там, где жирно;
--   • цель — по доле в недоимке, и это публично;
--   • он не грабит, а ВЗЫСКИВАЕТ: забирает ихор, ровно взятое плюс пеню;
--   • войной не кончается: пока недоимка есть, потерянные доли восполняются
--     из уже взятого — копилка сектора получает вложенное обратно.
--
-- ⚠ legion_engage_tick / legion_press_tick переопределены здесь ЦЕЛИКОМ ради
-- одного условия `kind <> 'levy'`: доли Сбора ходят по своим правилам, и пиратский
-- ход не должен подбирать их первым. Тела скопированы из _legion_teeth.sql —
-- правки в них надо носить в оба файла (иначе разъедутся).
-- ════════════════════════════════════════════════════════════

-- ── 1. КОНСТАНТЫ ────────────────────────────────────────────
create or replace function public._pc_levy_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'cost'        then 300    -- сколько копилки сектора стоит одна доля
    when 'cost_full'   then 190    -- при полном сборе взыскание идёт быстрее
    when 'inflight'    then 2      -- сколько долей одновременно летит в сектор
    when 'base'        then 40     -- костяк доли: она обязана встать на карту
    when 'share'       then 0.22   -- доля мускула должника, которую доля весит
    when 'hard_cap'    then 700
    when 'fee'         then 0.25   -- пеня: сверх взятого
    when 'refund'      then 0.6    -- сколько силы разбитой доли возвращается в копилку
    when 'grace_d'     then 3      -- сколько суток вскрытый мир ещё ничей
    when 'take_pop'    then 0.04   -- если ихора нет: тем, кто стоит между
    else 0 end
$$;

-- ── 2. КТО ДОЛЖНИК ЭТОГО СЕКТОРА ────────────────────────────
-- «Кто вскрывал у себя, того и придут собирать»: вес считаем по журналу
-- недоимки, сведённому к сектору, а не по общему счёту.
create or replace function public._pc_levy_debtor(p_sector uuid)
returns table(fid text, weight numeric, share numeric)
language sql stable security definer set search_path=public as $$
  with lg as (
    select l.faction_id, sum(greatest(0, l.weight)) w
      from public.pc_arrears_log l
     where l.weight > 0 and l.system_id is not null
       and public._legion_sector_of(l.system_id) = p_sector
     group by l.faction_id
  )
  select lg.faction_id, round(lg.w, 1),
         case when public._pc_arrears_total() > 0
              then round(a.amount / public._pc_arrears_total(), 4) else 0 end
    from lg join public.pc_arrears a on a.faction_id = lg.faction_id
   where a.amount > 0
   order by a.amount desc, lg.w desc
$$;
revoke all on function public._pc_levy_debtor(uuid) from public, anon, authenticated;

-- Куда идёт доля: имущество должника, по возможности в этом же секторе.
create or replace function public._pc_levy_target(p_fid text, p_sector uuid)
returns text language sql stable security definer set search_path=public as $$
  select coalesce(
    (select t.sys from public._legion_wrath_targets(p_fid) t
      where public._legion_sector_of(t.sys) = p_sector limit 1),
    (select t.sys from public._legion_wrath_targets(p_fid) t limit 1))
$$;
revoke all on function public._pc_levy_target(text,uuid) from public, anon, authenticated;

-- ── 3. ВЗЫСКАНИЕ ────────────────────────────────────────────
-- Доля берёт ихор со склада должника: ровно взятое плюс пеня. Снятое гасит
-- недоимку по номиналу — пеня в зачёт не идёт, на то она и пеня.
create or replace function public._pc_levy_collect(p_fid text, p_want numeric, p_sys text)
returns numeric language plpgsql security definer set search_path=public as $$
declare v_have numeric; v_take numeric; v_cut numeric;
begin
  if p_fid is null or coalesce(p_want, 0) <= 0 then return 0; end if;
  select coalesce((resources->>'Ихор')::numeric, 0) into v_have
    from public.faction_economy where faction_id = p_fid;
  v_take := round(least(coalesce(v_have, 0), p_want), 3);
  if v_take <= 0 then return 0; end if;

  update public.faction_economy
     set resources = jsonb_set(coalesce(resources, '{}'::jsonb), array['Ихор'],
           to_jsonb(round(coalesce((resources->>'Ихор')::numeric, 0) - v_take, 3)), true)
   where faction_id = p_fid;

  -- в зачёт идёт взятое без пени
  v_cut := round(v_take / (1 + public._pc_levy_const('fee')), 3);
  update public.pc_arrears
     set amount = greatest(0, amount - v_cut), repaid = repaid + v_cut, updated_at = now()
   where faction_id = p_fid;
  insert into public.pc_arrears_log(faction_id, system_id, pid, kind, ichor, weight, tier)
    values (p_fid, p_sys, null, 'взыскание', -v_take, -v_cut, null);
  return v_take;
end$$;
revoke all on function public._pc_levy_collect(text,numeric,text) from public, anon, authenticated;

-- ── 4. ХОД СБОРА ────────────────────────────────────────────
create or replace function public.precursor_levy_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_stage text; s record; d record; v_cost numeric; v_str numeric;
        v_sys text; kid uuid; live int; n_sent int := 0; n_back int := 0;
        n_took int := 0; v_amt numeric; k record; c record; v_sec uuid;
        n_claim int := 0; sname text; log jsonb := '[]'::jsonb;
begin
  v_stage := public._pc_arrears_stage();

  -- ── 4.0 ПОТЕРИ ВОСПОЛНЯЮТСЯ ─────────────────────────────
  -- Доля разбита, а счёт не погашен — вложенное возвращается в копилку сектора.
  -- Это и есть «войной его не кончить»: воевать можно, но убывает он от виры.
  for k in select lc.* from public.legion_contacts lc
            where lc.kind = 'levy' and lc.state = 'engaged' and lc.fleet_id is not null
              and not exists (select 1 from public.fleets f where f.id = lc.fleet_id) loop
    if public._pc_arrears_total() > 0 and k.sector_id is not null then
      update public.pc_levy_pressure
         set pressure = pressure + coalesce(k.strength, 0) * public._pc_levy_const('refund'),
             updated_at = now()
       where sector_id = k.sector_id;
      n_back := n_back + 1;
    end if;
    update public.legion_contacts set state = 'spent' where id = k.id;
  end loop;

  if v_stage not in ('сбор', 'полный сбор') then
    return jsonb_build_object('ok', true, 'stage', v_stage, 'refunded', n_back);
  end if;
  v_cost := public._pc_levy_const(case when v_stage = 'полный сбор' then 'cost_full' else 'cost' end);

  -- ── 4.1 ВЗЫСКАНИЕ СО СТОЯЩИХ ДОЛЕЙ ──────────────────────
  -- Доля, уже стоящая в системе, берёт своё каждый ход, пока её не выбьют.
  for k in select lc.* from public.legion_contacts lc
            where lc.kind = 'levy' and lc.state = 'engaged' and lc.fleet_id is not null
              and exists (select 1 from public.fleets f where f.id = lc.fleet_id) loop
    v_amt := public._pc_levy_collect(k.target_fid,
               round(coalesce(k.strength, 40) / 4.0, 1), k.target_sys);
    select name into sname from public.map_systems where id = k.target_sys;
    if v_amt > 0 then
      n_took := n_took + 1;
      perform public._legion_news(k.target_fid, '☠ Доля Сбора взяла своё',
        format('В системе «%s» доля Сбора взяла со складов %s ихора — взятое и пеню сверх. Недоимка уменьшилась на столько, сколько было взято; пеня в зачёт не идёт.',
               coalesce(sname, k.target_sys), v_amt));
    else
      -- склад пуст: берут тех, кто стоит между
      update public.colonies
         set pop = greatest(1, coalesce(pop, coalesce(cells,0)*50)
                              * (1 - public._pc_levy_const('take_pop')))
       where system_id = k.target_sys and faction_id = k.target_fid;
      if found then
        perform public._legion_news(k.target_fid, '☠ Сбору нечего взять',
          format('В системе «%s» на складах не нашлось ихора. Доля Сбора не ушла: она взяла людьми и осталась стоять. Счёт этим не гасится.',
                 coalesce(sname, k.target_sys)));
      end if;
    end if;
    update public.legion_contacts set pressed_at = now() where id = k.id;
  end loop;

  -- ── 4.2 НОВЫЕ ДОЛИ ──────────────────────────────────────
  for s in select p.sector_id, p.pressure, sec.name
             from public.pc_levy_pressure p
             join public.map_sectors sec on sec.id = p.sector_id
            where p.pressure >= v_cost
            order by p.pressure desc loop

    select count(*) into live from public.legion_contacts
     where kind = 'levy' and sector_id = s.sector_id and state in ('inbound','landed');
    if live >= public._pc_levy_const('inflight') then continue; end if;

    select * into d from public._pc_levy_debtor(s.sector_id) limit 1;
    if d.fid is null then continue; end if;                 -- брали, но счёт уже закрыт
    v_sys := public._pc_levy_target(d.fid, s.sector_id);
    if v_sys is null then continue; end if;                 -- должнику нечего взыскивать

    -- вес доли: доля в недоимке × мускул должника. Крупнейший должник —
    -- главная цель, и приходят к нему соответствующей силой.
    v_str := least(public._pc_levy_const('hard_cap'),
                   public._pc_levy_const('base')
                   + public._legion_muscle(d.fid) * public._pc_levy_const('share')
                     * greatest(0.25, coalesce(d.share, 0.25)));
    if v_stage = 'полный сбор' then v_str := least(public._pc_levy_const('hard_cap'), v_str * 1.4); end if;

    update public.pc_levy_pressure set pressure = greatest(0, pressure - v_cost), updated_at = now()
     where sector_id = s.sector_id;

    kid := public._legion_contact_spawn(s.sector_id, d.fid, v_sys, 'levy', v_str);
    if kid is null then continue; end if;
    n_sent := n_sent + 1;
    log := log || jsonb_build_array(jsonb_build_object(
      'sector', s.name, 'fid', d.fid, 'sys', v_sys,
      'strength', round(v_str, 1), 'share', d.share));

    select name into sname from public.map_systems where id = v_sys;
    perform public._legion_news(d.fid, '☠ Сбор идёт за вами',
      format('От вскрытых руин в секторе «%s» отделилась доля Сбора и легла на курс к системе «%s». Она идёт не грабить, а взыскивать: ей нужен ихор, ровно взятый вами, и пеня сверх. Ваша доля в недоимке — %s%%.',
             s.name, coalesce(sname, v_sys), round(coalesce(d.share,0) * 100)::text));
  end loop;

  -- ── 4.3 ВСКРЫТЫЕ МИРЫ ПЕРЕХОДЯТ К СБОРЩИКУ (§18.2) ──────
  -- Мир со вскрытыми святилищами не гибнет и не взлетает: он становится точкой
  -- Сбора на карте. Собственный посев игрока оборачивается против него.
  for c in select * from public.primitive_civs
            where coalesce((flags->>'covenant_locked')::boolean, false)
              and not coalesce((flags->>'levied')::boolean, false)
              and status not in ('dead','spacefaring')
              and coalesce(last_act_at, created_at)
                  < now() - (public._pc_levy_const('grace_d') || ' days')::interval
            limit 3 loop
    insert into public.colonies(faction_id, system_id, planet_name, planet_pid, cells, pop)
      values ((public._legion_meta()->>'hull_fid'), c.system_id,
              coalesce(c.planet_name, c.self_name), c.pid, 4,
              greatest(1, coalesce(c.pop, 0) * 0.25));
    update public.primitive_civs
       set status = 'levied',
           flags = coalesce(flags, '{}'::jsonb) || jsonb_build_object('levied', true),
           chronicle = coalesce(chronicle, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'ph', '☠',
             'text', 'К вскрытым святилищам пришли те, кто их считает. Они не спрашивали и не воевали: '
                  || 'встали над руинами и остались. С тех пор ' || c.self_name
                  || ' живут при них, а над миром чужой знак.'))
     where system_id = c.system_id and pid = c.pid;
    v_sec := public._legion_sector_of(c.system_id);
    n_claim := n_claim + 1;
    perform public._legion_feed('☠ Сбор занял мир',
      format('Дозвёздный мир «%s» (%s) со вскрытыми святилищами перешёл к Сбору и стал его точкой на карте. Ни одна держава этот мир больше не поднимет.',
             coalesce(c.self_name, c.planet_name), coalesce(c.system_name, c.system_id)));
  end loop;

  perform public.legion_contacts_scan();
  return jsonb_build_object('ok', true, 'stage', v_stage, 'sent', n_sent,
                            'collected', n_took, 'refunded', n_back,
                            'claimed', n_claim, 'log', log);
end$$;
revoke all on function public.precursor_levy_tick() from public, anon, authenticated;

-- ── 5. ВЫСАДКА ДОЛИ ─────────────────────────────────────────
-- Доля встаёт на карту ВСЕГДА: пустая система её не отменяет (грабли §3
-- _legion_teeth.sql, повторять их второй раз незачем).
create or replace function public.precursor_levy_engage()
returns jsonb language plpgsql security definer set search_path=public as $$
declare k record; comp jsonb; fid_new uuid; sname text; v_amt numeric; n int := 0;
begin
  for k in select * from public.legion_contacts
            where kind = 'levy' and state = 'landed' and fleet_id is null
            order by arrive_at loop
    comp := public._legion_compose(k.strength);
    if jsonb_array_length(comp) = 0 then
      update public.legion_contacts set state = 'spent' where id = k.id;
      continue;
    end if;
    insert into public.fleets(faction_id, name, status, system_id, home_sys, composition)
      values (public._legion_fid(), 'Доля Сбора', 'idle', k.target_sys, k.target_sys, comp)
      returning id into fid_new;
    update public.legion_contacts
       set state = 'engaged', fleet_id = fid_new, pressed_at = now() where id = k.id;

    v_amt := public._pc_levy_collect(k.target_fid, round(coalesce(k.strength, 40) / 3.0, 1), k.target_sys);
    select name into sname from public.map_systems where id = k.target_sys;
    perform public._legion_news(k.target_fid, '☠ Доля Сбора в системе',
      format('В системе «%s» из пустоты вышли корабли Сбора: %s корпусов. %s Доля не уйдёт сама: пока недоимка не погашена, разбитая — она возвращается, и возвращается из того, что уже взято.',
        coalesce(sname, k.target_sys),
        (select coalesce(sum((x->>'qty')::int),0) from jsonb_array_elements(comp) x),
        case when v_amt > 0 then 'Со складов взято ' || v_amt || ' ихора.'
             else 'Ихора на складах не нашлось — они остались ждать.' end));
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'landed', n);
end$$;
revoke all on function public.precursor_levy_engage() from public, anon, authenticated;

-- ── 6. ПИРАТСКИЙ ХОД НЕ ТРОГАЕТ ДОЛИ ────────────────────────
-- Тела ниже — копия _legion_teeth.sql §5 и §6 с единственной правкой
-- `kind <> 'levy'`. Правки носить в оба файла.
create or replace function public.legion_engage_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare k record; def int; comp jsonb; col public.colonies; op public.outposts;
        abduct numeric; v_pop numeric; cut int; fid_new uuid; frac numeric;
        hits int; nm text;
        n_fight int := 0; n_plunder int := 0; n_blind int := 0; n_dud int := 0;
begin
  for k in select * from public.legion_contacts
            where state = 'landed' and fleet_id is null and kind <> 'levy'
            order by arrive_at loop

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

create or replace function public.legion_press_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare k record; col public.colonies; op public.outposts;
        v_pop numeric; abduct numeric; cut int; n int := 0; sname text; frac numeric;
begin
  for k in select c.* from public.legion_contacts c
            where c.state = 'engaged' and c.fleet_id is not null and c.kind <> 'levy'
              and coalesce(c.pressed_at, c.arrive_at)
                  < now() - (public._legion_vend_const('patience_h') || ' hours')::interval
              and exists (select 1 from public.fleets f where f.id = c.fleet_id)
              and not exists (select 1 from public.battles b
                               where b.system_id = c.target_sys
                                 and b.status not in ('done','finished','ended','cancelled')) loop

    select name into sname from public.map_systems where id = k.target_sys;
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

-- ── 7. ЧЕМ ДЕРЖАВА ВЫХОДИТ В КОСМОС (§16) ───────────────────
-- Состояние надломов на взлёте сворачивается в доктрину новой державы, а
-- вскрытые святилища взлёт отменяют совсем: такой мир достаётся Сбору.
-- Триггером, а не правкой _pc_ignite: там девяносто строк чужой логики.
create or replace function public._pc_doctrine(p_civ public.primitive_civs)
returns text language sql stable as $$
  with w as (
    select x->>'src' src, coalesce(x->>'state','') st, x->>'hook' hook
      from jsonb_array_elements(coalesce(p_civ.anchor->'wounds', '[]'::jsonb)) x
  )
  select case
    when exists (select 1 from w where st = 'переписанный')
      then 'вассал с чужой верой'
    when exists (select 1 from w where hook = 'небо' and st = 'вскрытый')
      then 'флот и претензия'
    when exists (select 1 from w where src = 'enslave' and st <> 'изжитый')
      then 'работорговцы'
    when (select count(*) from w where st = 'изжитый') >= (select count(*) from w) and (select count(*) from w) > 0
      then 'посредники'
    when exists (select 1 from w where src = 'plague' and st = 'изжитый')
      then 'лекари'
    when exists (select 1 from w where src = 'lesson' and st = 'изжитый')
      then 'глубокий рейд'
    when coalesce(p_civ.grudge, 0) >= 60 then 'милитарист-однодневка'
    when coalesce(p_civ.trust, 0) <= 20 then 'будущий протекторат'
    else 'обычная держава' end
$$;

create or replace function public._pc_ignite_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status = 'spacefaring' and coalesce(old.status,'') <> 'spacefaring' then
    -- §16: со вскрытыми святилищами не выходит вовсе
    if coalesce((coalesce(new.flags, old.flags)->>'covenant_locked')::boolean, false) then
      new.status := old.status;
      new.sovereign_at := old.sovereign_at;
      new.map_fid := old.map_fid;
      new.phase := old.phase;
      new.chronicle := coalesce(old.chronicle, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'ph', '☠',
        'text', 'Первый корабль так и не поднялся. Под ними пусто: то, чем держались святилища, вывезли, '
             || 'и вывезли не они. К звёздам из этого мира не вышел никто.'));
      return new;
    end if;
    new.flags := coalesce(new.flags, '{}'::jsonb)
               || jsonb_build_object('doctrine', public._pc_doctrine(new));
  end if;
  return new;
end$$;
drop trigger if exists trg_pc_ignite_guard on public.primitive_civs;
create trigger trg_pc_ignite_guard before update on public.primitive_civs
  for each row execute function public._pc_ignite_guard();

-- ── 8. КРОН ─────────────────────────────────────────────────
-- Сбор живёт на кроне Легиона по смыслу, но своим расписанием: раз в час ход,
-- четырежды в час высадка — как у пиратов, чтобы доли не зависали «в пути».
do $$
begin
  perform cron.unschedule('precursor-levy');
exception when others then null;
end$$;
do $$
begin
  perform cron.schedule('precursor-levy', '47 * * * *',
    'select public.precursor_levy_tick(); select public.precursor_levy_engage();');
exception when others then null;
end$$;

-- ── 9. ПРОВЕРКА ─────────────────────────────────────────────
select jsonb_pretty(jsonb_build_object(
  'ступень',   public._pc_arrears_stage(),
  'копилка',   (select coalesce(jsonb_agg(jsonb_build_object(
                  'сектор', s.name, 'копит', round(p.pressure,1))), '[]'::jsonb)
                  from public.pc_levy_pressure p join public.map_sectors s on s.id = p.sector_id),
  'доли',      (select count(*) from public.legion_contacts where kind = 'levy'),
  'крон',      (select schedule from cron.job where jobname = 'precursor-levy')
)) as итог;
