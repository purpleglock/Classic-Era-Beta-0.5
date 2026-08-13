-- ════════════════════════════════════════════════════════════
-- ЛЕГИОН, ШАГ 3: ВЫБОР ЦЕЛИ И ТРИ ПОВЕДЕНИЯ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _legion_faction.sql и _legion_contacts.sql. Идемпотентно.
-- Дальше: стыковка с боем (_legion_engage.sql) и клиент.
--
-- ЗАМЫСЕЛ. У Легиона один кошелёк — давление сектора — и три способа его
-- потратить. Не «уровни сложности», а разные ЗАМЫСЛЫ, которые игрок должен
-- научиться различать по сигнатуре:
--   • probe  (щупальца, 12) — часто и мелко: караваны, окраинная колония.
--     Это фон, ради которого пираты и должны ощущаться тараканами: не событие,
--     а постоянный налог на бардак.
--   • blind  (ослепление, 26) — бьёт по recon-заставам и depot-заставам.
--     Смысл не в добыче: снести глаза и заправку, чтобы следующий удар пришёл
--     без предупреждения и в глубину. Отдельный слой, который делает сеть
--     аванпостов не «постройкой», а линией фронта.
--   • strike (удар, 48) — колония: угон населения, вынос склада.
--
-- ЧТО ИМЕННО СЧИТАЕМ. score = ценность ÷ оборона × близость × аггро.
-- Оборона в ЗНАМЕНАТЕЛЕ намеренно: Легион не героический ИИ, он ищет, где
-- плохо лежит. Богатая, но закатанная в оборону система для него хуже, чем
-- бедная и голая — иначе игрок не может влиять на выбор цели ничем, кроме
-- «стань беднее», а это не решение.
-- ════════════════════════════════════════════════════════════

-- ── 0. Константы в одном месте ──────────────────────────────
create or replace function public._legion_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'cost_probe'   then 12
    when 'cost_blind'   then 26
    when 'cost_strike'  then 48
    -- сколько контактов Легион держит в воздухе на сектор: без этого богатый
    -- сектор при полной копилке выплюнул бы всё разом
    when 'max_inflight' then 2
    -- аггро выше этого делает державу приоритетной целью
    when 'aggro_bite'   then 12
    else 0 end
$$;

-- ── 1. ОБОРОНА КОНКРЕТНОЙ СИСТЕМЫ ───────────────────────────
-- Локальная, а не секторальная: Легион смотрит, что стоит именно ТУТ.
-- Единица в основании — чтобы деление никогда не взрывалось на голой системе.
-- ⚠ Считать только флоты/мины/дроны было НЕДОСТАТОЧНО: у колоний редко стоит
-- флот на приколе, и знаменатель выходил ровно 1.00 у ВСЕХ целей — обещание
-- «закатанную в оборону систему Легион обходит» не работало вовсе. Настоящая
-- оборона колоний живёт в зданиях (abm, starbase) и в гарнизонных армиях,
-- которые крепятся к колонии, а не к системе.
create or replace function public._legion_sys_guard(p_sys text)
returns numeric language sql stable security definer set search_path=public as $$
  select 1.0
  + coalesce((select sum(greatest(0,(c->>'qty')::int)) * 0.30
                from public.fleets f, jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
               where f.system_id = p_sys and f.status = 'idle'
                 and f.faction_id is distinct from public._legion_fid()), 0)
  + coalesce((select sum(least(6, greatest(0, m.hexes))) * 0.20
                from public.system_minefields m where m.system_id = p_sys), 0)
  + coalesce((select sum(least(4, greatest(0, d.wings))) * 0.50
                from public.system_drone_posts d where d.system_id = p_sys), 0)
  -- орбита и ПРО: starbase держит рейдера крепче, чем ПРО, но и ПРО мешает
  + coalesce((select sum(case cb.btype when 'starbase' then 1.2 when 'abm' then 0.35
                                       else 0 end)
                from public.colony_buildings cb
                join public.colonies c on c.id = cb.colony_id
               where c.system_id = p_sys and cb.btype in ('starbase','abm')), 0)
  -- гарнизон: именно он мешает угнать население, ради которого и идёт strike
  + coalesce((select sum(greatest(0,(a2->>'qty')::int)) * 0.10
                from public.armies ar
                join public.colonies c on c.id = ar.colony_id,
                     jsonb_array_elements(coalesce(ar.composition,'[]'::jsonb)) a2
               where c.system_id = p_sys and ar.colony_id is not null), 0)
$$;
revoke all on function public._legion_sys_guard(text) from public;

-- ── 2. ЦЕЛИ ─────────────────────────────────────────────────
-- Три списка под три замысла. Возвращаем уже со score, отбор — снаружи.
create or replace function public._legion_targets(p_sector uuid, p_kind text)
returns table(sys text, fid text, value numeric, guard numeric, score numeric)
language plpgsql stable security definer set search_path=public as $$
begin
  return query
  with sysl as (
    select unnest(system_ids) sid from public.map_sectors where id = p_sector
  ), cand as (
    select * from (
      -- УДАР: колонии. Ценность — население и достаток: есть кого угонять.
      select c.system_id sid, c.faction_id cfid,
             1.0 + coalesce(c.pop,0)/500.0
                 + coalesce((select least(150,e.prosperity) from public.system_econ e
                              where e.system_id = c.system_id),0)/100.0 val
        from public.colonies c join sysl on sysl.sid = c.system_id
       where p_kind = 'strike' and c.faction_id is not null
      union all
      -- ОСЛЕПЛЕНИЕ: чужие глаза и заправка. Ценность не в добыче, а в том,
      -- что снос заставы схлопывает игроку радиус действия флота.
      select o.system_id, o.faction_id,
             case o.mode when 'recon' then 3.0 when 'depot' then 2.6 else 1.2 end
        from public.outposts o join sysl on sysl.sid = o.system_id
       where p_kind = 'blind' and public._outpost_crew_k(o.crew, o.mode) >= 0.5
      union all
      -- ЩУПАЛЬЦА: концы караванных трасс. Объём груза = чем поживиться.
      select r.origin_sys, r.a_fid, 1.0 + least(4.0, coalesce(r.volume,0)/200.0)
        from public.trade_routes r join sysl on sysl.sid = r.origin_sys
       where p_kind = 'probe' and r.status = 'active'
      union all
      select r.dest_sys, r.b_fid, 1.0 + least(4.0, coalesce(r.volume,0)/200.0)
        from public.trade_routes r join sysl on sysl.sid = r.dest_sys
       where p_kind = 'probe' and r.status = 'active'
      union all
      -- щупальцам сгодится и окраинная колония, если караванов рядом нет
      select c.system_id, c.faction_id, 1.0 + coalesce(c.pop,0)/900.0
        from public.colonies c join sysl on sysl.sid = c.system_id
       where p_kind = 'probe' and c.faction_id is not null
    ) q where q.cfid is not null
  )
  -- Оборона считается ОДИН раз на систему (agg + lateral), а не отдельно для
  -- колонки value и для колонки score: _legion_sys_guard сама по себе не дёшева.
  , agg as (
    select cd.sid, cd.cfid, sum(cd.val) val
      from cand cd group by cd.sid, cd.cfid
  )
  select a.sid, a.cfid,
         round(a.val, 2) as value,
         round(g.gv, 2) as guard,
         round(
           a.val / g.gv
           -- аггро: кто бил Легион, того навещают охотнее (до ×2)
           * (1.0 + least(1.0, coalesce((select x.aggro from public.legion_aggro x
                                          where x.faction_id = a.cfid), 0)
                                / (public._legion_const('aggro_bite') * 2)))
         , 3) as score
    from agg a
    cross join lateral (select public._legion_sys_guard(a.sid) gv) g
   order by score desc;
end$$;
revoke all on function public._legion_targets(uuid,text) from public;

-- ── 3. ХОД ЛЕГИОНА ──────────────────────────────────────────
-- ⚠ ЛЕГИОН КОПИТ, А НЕ СПУСКАЕТ ПРИ ПЕРВОЙ ВОЗМОЖНОСТИ. Первая редакция брала
-- «самый дорогой замысел, который по карману» — и при часовом тике это значило
-- вечную нижнюю ступень: давление доходит до 12, тут же уходит в probe, до
-- strike (48) не добирается НИКОГДА. Три поведения схлопывались в одно.
-- Стало: у сектора есть ЗАМЫСЕЛ (ambition) от его плотности добычи, и копилка
-- копится именно под него. Бедный угол постоянно зудит щупальцами, богатый
-- молчит и потом бьёт — и молчание богатого сектора само по себе сигнал.
-- Один контакт за тик на сектор: Легион давит постоянством, а не залпом.
create or replace function public.legion_campaign_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare s record; p numeric; kind text; cost numeric; t record; fatn numeric;
        kid uuid; live int; made int := 0; log jsonb := '[]'::jsonb; eyes boolean;
begin
  for s in select lp.sector_id, lp.pressure, sec.name,
                  greatest(1, coalesce(array_length(sec.system_ids,1),1)) nsys
             from public.legion_pressure lp
             join public.map_sectors sec on sec.id = lp.sector_id
            where lp.pressure >= public._legion_const('cost_probe')
            order by lp.pressure desc loop

    -- уже посланного хватит?
    select count(*) into live from public.legion_contacts
     where sector_id = s.sector_id and state = 'inbound';
    if live >= public._legion_const('max_inflight') then continue; end if;

    p := s.pressure;
    fatn := public._legion_sector_fat(s.sector_id) / s.nsys;
    -- есть ли что ослеплять: чужие укомплектованные глаза/заправка в секторе
    select exists (
      select 1 from public.outposts o
       where o.system_id in (select unnest(system_ids) from public.map_sectors
                              where id = s.sector_id)
         and o.mode in ('recon','depot')
         and public._outpost_crew_k(o.crew, o.mode) >= 0.5) into eyes;

    -- ЗАМЫСЕЛ сектора: под что копим
    if    fatn >= 6            then kind := 'strike';
    elsif fatn >= 3 and eyes   then kind := 'blind';
    else                            kind := 'probe';
    end if;
    cost := public._legion_const('cost_' || kind);

    -- не накопили на свой замысел — ждём. Именно здесь рождается пауза перед
    -- ударом, которой не было в первой редакции.
    if p < cost then continue; end if;

    select * into t from public._legion_targets(s.sector_id, kind) limit 1;
    -- нечего ослеплять — не копим впустую, бьём по тому, что есть
    if t.sys is null and kind <> 'probe' then
      kind := 'probe'; cost := public._legion_const('cost_probe');
      select * into t from public._legion_targets(s.sector_id, kind) limit 1;
    end if;
    if t.sys is null then continue; end if;

    if not public._legion_spend(s.sector_id, cost) then continue; end if;

    kid := public._legion_contact_spawn(s.sector_id, t.fid, t.sys, kind, cost);
    if kid is null then
      -- маршрут не проложился (сектор отрезан) — давление вернуть нельзя по
      -- замыслу, но и записывать это в «потери» нечестно: отряда не было
      continue;
    end if;

    made := made + 1;
    log := log || jsonb_build_array(jsonb_build_object(
      'sector', s.name, 'kind', kind, 'cost', cost,
      'target_sys', t.sys, 'target_fid', t.fid, 'score', t.score));
  end loop;

  -- засечки сразу, чтобы контакт не «прыгал» в поле зрения через 15 минут
  perform public.legion_contacts_scan();
  return jsonb_build_object('ok', true, 'launched', made, 'log', log);
end$$;
revoke all on function public.legion_campaign_tick() from public;

-- ── 4. ЦИКЛ ─────────────────────────────────────────────────
-- Раз в час, через 20 минут после тика давления: сперва копилка пополнилась,
-- потом Легион решает, тратить ли.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('legion-campaign-tick')
      where exists (select 1 from cron.job where jobname = 'legion-campaign-tick');
    perform cron.schedule('legion-campaign-tick', '33 * * * *',
                          'select public.legion_campaign_tick();');
  end if;
end$$;
