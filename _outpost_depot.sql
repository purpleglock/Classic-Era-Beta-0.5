-- ============================================================
-- АВАНПОСТЫ · РЕЖИМ «ЗАСТАВА» (depot) + ЭКИПАЖ
-- Применять ПОСЛЕ _defense_outpost.sql, _fleet_route.sql, _fleet_tank.sql.
-- Идемпотентно.
--
-- ЗАЧЕМ:
--   1) Аванпосты стояли и ничего не делали — их некому было укомплектовать,
--      и режимов было всего два. Теперь у аванпоста есть ЭКИПАЖ: без людей
--      он работает вполсилы, а пустой — со временем сворачивается сам.
--      Это чинит бездействие честно, не выключая уже построенное.
--   2) Новый режим 'depot' (ЗАСТАВА) — точка ЗАПРАВКИ флота вне своих границ.
--      Вместе с баком (_fleet_tank.sql) он и делает аванпост стратегическим:
--      радиус действия державы = её сеть застав. Ровно это Железный легион
--      и будет выбивать в первую очередь.
--
-- ЭКИПАЖ (outposts.crew):
--   • Нужный штат зависит от режима: recon 10, mining 25, depot 20.
--   • Укомплектованность k = crew / штат (0..1):
--       recon  — k < 0.5 → аванпост «слепнет»: не даёт ни обзора соседей,
--                 ни вскрытия чужих оборонных объектов;
--       mining — добыча умножается на k;
--       depot  — k < 0.5 → заправлять нечем, застава не работает.
--   • Наём стоит ГС разово + ЖАЛОВАНИЕ ГС/сут. Не платится (казна пуста) —
--     экипаж тает. Пустой аванпост через 5 суток сворачивается.
--
-- Начисление ленивое, как везде: _outpost_crew_settle(fid).
-- ============================================================

alter table public.outposts add column if not exists crew         int not null default 0;
alter table public.outposts add column if not exists crew_paid    timestamptz;
alter table public.outposts add column if not exists empty_since  timestamptz;

update public.outposts set crew_paid = coalesce(crew_paid, now()) where crew_paid is null;

-- ── Константы: надмножество _defense_outpost.sql ──
create or replace function public._defense_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'starbase_cap_per_slot' then 50
    when 'repair_fraction'       then 0.40
    when 'repair_cost_frac'      then 0.50
    when 'repair_days'           then 1
    when 'mine_hex_max'          then 6
    when 'mine_hex_cost'         then 400
    when 'mine_hex_attrition'    then 0.05
    when 'mine_wear_hexes'       then 1
    when 'mine_refund_frac'      then 0.50
    when 'outpost_ship_cost'     then 2000
    when 'outpost_build_h'       then 24
    when 'outpost_cap'           then 20
    when 'outpost_refund'        then 0.50
    when 'outpost_mine_gc'       then 75
    when 'op_fly_h_min'          then 2
    when 'op_fly_h_max'          then 18
    -- ЭКИПАЖ И ЗАСТАВА
    when 'crew_need_recon'       then 10      -- штат по режимам
    when 'crew_need_mining'      then 25
    when 'crew_need_depot'       then 20
    when 'crew_hire_gc'          then 20      -- ГС за человека при найме
    when 'crew_wage_gc'          then 2       -- ГС за человека в сутки
    when 'crew_desert_frac'      then 0.25    -- доля экипажа, уходящая за неоплаченные сутки
    when 'op_empty_days'         then 5       -- пустой аванпост сворачивается через N суток
    when 'depot_cap'             then 30      -- +вместимость флота за заставу (стоянка)
    else null end
$$;

-- ── Штат по режиму ──
create or replace function public._outpost_crew_need(p_mode text)
returns int language sql immutable as $$
  select case lower(coalesce(p_mode,'recon'))
    when 'mining' then public._defense_const('crew_need_mining')::int
    when 'depot'  then public._defense_const('crew_need_depot')::int
    else               public._defense_const('crew_need_recon')::int
  end
$$;

-- ── Укомплектованность 0..1 ──
create or replace function public._outpost_crew_k(p_crew int, p_mode text)
returns numeric language sql immutable as $$
  select least(1.0, greatest(0.0,
    coalesce(p_crew,0)::numeric / nullif(public._outpost_crew_need(p_mode),0)))
$$;

-- ── Работает ли аванпост вообще (порог половины штата) ──
create or replace function public._outpost_manned(p_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(public._outpost_crew_k(o.crew, o.mode) >= 0.5, false)
    from public.outposts o where o.id = p_id
$$;
revoke all on function public._outpost_manned(uuid) from public;

-- ════════════════════════════════════════════════════════════
-- ЖАЛОВАНИЕ И ДЕЗЕРТИРСТВО (ленивое начисление)
-- За каждые прошедшие сутки экипаж требует crew_wage_gc × людей.
-- Хватает ГС — списываем. Не хватает — часть экипажа уходит.
-- Пустой аванпост дольше op_empty_days — сворачивается.
-- ════════════════════════════════════════════════════════════
create or replace function public._outpost_crew_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare o record; d int; due numeric; have numeric; gone int;
begin
  if not exists(select 1 from public.outposts
                 where faction_id = p_fid
                   and floor(extract(epoch from (now()-coalesce(crew_paid,created_at)))/86400.0) >= 1)
  then return; end if;

  select gc into have from public.faction_economy where faction_id = p_fid for update;
  if have is null then return; end if;

  for o in select * from public.outposts where faction_id = p_fid loop
    d := floor(extract(epoch from (now()-coalesce(o.crew_paid,o.created_at)))/86400.0);
    if d < 1 then continue; end if;

    if o.crew > 0 then
      due := public._defense_const('crew_wage_gc') * o.crew * d;
      if have >= due then
        have := have - due;
        update public.outposts
           set crew_paid = coalesce(crew_paid,created_at) + (d || ' days')::interval,
               empty_since = null
         where id = o.id;
      else
        -- нечем платить: часть экипажа расходится (за каждые неоплаченные сутки)
        gone := greatest(1, ceil(o.crew * public._defense_const('crew_desert_frac') * d)::int);
        update public.outposts
           set crew = greatest(0, crew - gone),
               crew_paid = coalesce(crew_paid,created_at) + (d || ' days')::interval,
               empty_since = case when greatest(0, o.crew - gone) = 0
                                  then coalesce(empty_since, now()) else null end
         where id = o.id;
      end if;
    else
      update public.outposts
         set crew_paid   = coalesce(crew_paid,created_at) + (d || ' days')::interval,
             empty_since = coalesce(empty_since, coalesce(crew_paid, created_at))
       where id = o.id;
    end if;
  end loop;

  update public.faction_economy set gc = have where faction_id = p_fid;

  -- брошенные аванпосты сворачиваются
  delete from public.outposts
   where faction_id = p_fid and crew = 0 and empty_since is not null
     and empty_since < now() - (public._defense_const('op_empty_days') || ' days')::interval;
end$$;
revoke all on function public._outpost_crew_settle(text) from public;

-- ── RPC: нанять (+n) или распустить (-n) экипаж ──
create or replace function public.outpost_staff(p_id uuid, p_delta int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; o public.outposts; need int; want int; cost numeric; have numeric;
begin
  fid := public._ec_my_fid();
  perform public._outpost_crew_settle(fid);
  select * into o from public.outposts where id = p_id for update;
  if not found then raise exception 'outpost not found'; end if;
  if o.faction_id is distinct from fid then raise exception 'not your outpost'; end if;

  need := public._outpost_crew_need(o.mode);
  if coalesce(p_delta,0) = 0 then raise exception 'сколько людей?'; end if;

  if p_delta > 0 then
    want := least(p_delta, need - o.crew);
    if want <= 0 then
      return jsonb_build_object('ok', true, 'crew', o.crew, 'need', need, 'note', 'штат уже полон');
    end if;
    cost := public._defense_const('crew_hire_gc') * want;
    select gc into have from public.faction_economy where faction_id = fid for update;
    if coalesce(have,0) < cost then
      raise exception 'не хватает ГС на наём: нужно %, есть %', round(cost), round(coalesce(have,0));
    end if;
    update public.faction_economy set gc = gc - cost where faction_id = fid;
    update public.outposts
       set crew = crew + want, empty_since = null,
           crew_paid = coalesce(crew_paid, now())
     where id = p_id;
  else
    want := least(-p_delta, o.crew);
    update public.outposts
       set crew = crew - want,
           empty_since = case when o.crew - want = 0 then coalesce(empty_since, now()) else null end
     where id = p_id;
    cost := 0;
  end if;

  select crew into want from public.outposts where id = p_id;
  return jsonb_build_object('ok', true, 'crew', want, 'need', need,
    'k', public._outpost_crew_k(want, o.mode), 'cost', cost);
end$$;
revoke all on function public.outpost_staff(uuid,int) from public;
grant execute on function public.outpost_staff(uuid,int) to authenticated;

-- ── RPC: сменить режим аванпоста (в т.ч. перевести в заставу) ──
create or replace function public.outpost_set_mode(p_id uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; o public.outposts; md text;
begin
  fid := public._ec_my_fid();
  md := lower(coalesce(p_mode,''));
  if md not in ('recon','mining','depot') then raise exception 'unknown outpost mode: %', p_mode; end if;
  perform public._outpost_crew_settle(fid);
  select * into o from public.outposts where id = p_id for update;
  if not found then raise exception 'outpost not found'; end if;
  if o.faction_id is distinct from fid then raise exception 'not your outpost'; end if;
  if o.mode = md then return jsonb_build_object('ok', true, 'mode', md, 'note', 'режим уже такой'); end if;

  -- добытое до смены режима не теряем
  perform public._outpost_mining_settle(fid);
  update public.outposts
     set mode = md,
         crew = least(crew, public._outpost_crew_need(md)),
         last_accrue = now()
   where id = p_id;
  return jsonb_build_object('ok', true, 'mode', md,
    'need', public._outpost_crew_need(md),
    'crew', (select crew from public.outposts where id = p_id));
end$$;
revoke all on function public.outpost_set_mode(uuid,text) from public;
grant execute on function public.outpost_set_mode(uuid,text) to authenticated;

-- ── Развёртывание носителя: разрешаем режим 'depot' ──
-- ВАЖНО: живая сигнатура — ТРЁХарговая (p_res, выбор добываемого ресурса,
-- из _outpost_storage_fix.sql). Переопределяем именно её: двухарговая версия
-- была бы отдельной перегрузкой, и клиент бы её не увидел.
-- Старую двухарговую сносим, чтобы вызов не был неоднозначным.
drop function if exists public.outpost_ship_deploy(uuid, text);

create or replace function public.outpost_ship_deploy(p_id uuid, p_mode text default 'recon', p_res text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; sh public.outpost_ships; sysid text; v_id uuid; md text; res text; crew0 int;
begin
  fid := public._ec_my_fid();
  md := lower(coalesce(p_mode,'recon'));
  if md not in ('recon','mining','depot') then raise exception 'unknown outpost mode: %', p_mode; end if;
  perform public._outpost_ship_settle(fid);
  select * into sh from public.outpost_ships where id=p_id;
  if not found then raise exception 'outpost-ship not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your ship'; end if;
  if sh.status = 'building' then raise exception 'ship is still under construction'; end if;
  if sh.status <> 'idle' or sh.system_id is null then raise exception 'ship still in transit'; end if;
  sysid := sh.system_id;
  if not public._outpost_can_deploy(fid, sysid) then
    raise exception 'cannot deploy here: must be neutral space, не впритык к чужой границе';
  end if;

  res := nullif(trim(coalesce(p_res,'')),'');
  if md = 'mining' and res is not null then
    if not exists(
      select 1
      from jsonb_array_elements(coalesce((select planets from public.map_systems where id=sysid),'[]'::jsonb)) pl,
           jsonb_array_elements(coalesce(pl.value->'resources','[]'::jsonb)) rr
      where rr.value->>'name' = res
    ) then raise exception 'resource «%» not present in this system', res; end if;
  else
    res := null;
  end if;

  -- экипаж носителя переходит в аванпост: половина штата, чтобы объект сразу
  -- заработал, дальше игрок доукомплектовывает сам
  crew0 := ceil(public._outpost_crew_need(md) / 2.0)::int;
  insert into public.outposts(system_id, owner_id, faction_id, name, mode, mine_res, last_accrue, crew, crew_paid)
    values(sysid, auth.uid(), fid, sh.name, md, res, now(), crew0, now())
    returning id into v_id;
  delete from public.outpost_ships where id=p_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'system_id', sysid, 'mode', md,
    'mine_res', res, 'crew', crew0, 'need', public._outpost_crew_need(md));
end$$;
revoke all on function public.outpost_ship_deploy(uuid,text,text) from public;
grant execute on function public.outpost_ship_deploy(uuid,text,text) to authenticated;

-- ════════════════════════════════════════════════════════════
-- ВЛИЯНИЕ ЭКИПАЖА НА РАБОТУ (надмножества прежних функций)
-- ════════════════════════════════════════════════════════════

-- ── ЗАПРАВКА: застава заправляет только при укомплектованности ≥ 0.5 ──
create or replace function public._fleet_can_refuel(p_fid text, p_sys text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.colony_buildings cb
      join public.colonies c on c.id = cb.colony_id
     where cb.btype = 'shipyard' and c.faction_id = p_fid and c.system_id = p_sys)
  or exists(
    select 1 from public.outposts o
     where o.faction_id = p_fid and o.system_id = p_sys and o.mode = 'depot'
       and public._outpost_crew_k(o.crew, o.mode) >= 0.5)
$$;
revoke all on function public._fleet_can_refuel(text,text) from public;

-- ── ДОБЫЧА: объём умножается на укомплектованность ──
-- ВАЖНО: тело взято из _outpost_storage_fix.sql (АКТУАЛЬНАЯ версия — добыча
-- только по o.mine_res и упор в свободный объём склада), а НЕ из
-- _defense_outpost.sql. Единственное отличие — множитель k.
-- Порядок наката: _defense_outpost → _outpost_mining_fix → _outpost_storage_fix
--                 → _outpost_depot (этот файл).
create or replace function public._outpost_mining_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare
  o record; relem jsonb; d int; rr text; rate numeric;
  cur jsonb; gc_total numeric := 0; k numeric;
  cap numeric; used numeric; freecap numeric; addq numeric;
begin
  -- жалование считаем ПЕРЕД добычей: иначе доход набегал бы, а расход отставал
  -- (аванпосты начисляются лениво, по обращению, а не в economy_accrue).
  -- Обратного вызова нет — рекурсии не будет.
  perform public._outpost_crew_settle(p_fid);

  if not exists(select 1 from public.outposts where faction_id=p_fid and mode='mining'
                  and floor(extract(epoch from (now()-coalesce(last_accrue,created_at)))/86400.0) >= 1) then
    return;   -- нечего начислять
  end if;
  select coalesce(resources,'{}'::jsonb) into cur from public.faction_economy where faction_id=p_fid for update;
  if cur is null then return; end if;

  cap := 1000 + coalesce((select sum(slots_open) from public.colony_buildings
                          where faction_id=p_fid and btype='warehouse'),0) * 500;
  used := (select coalesce(sum(value::numeric),0) from jsonb_each_text(cur));
  freecap := greatest(0, cap - used);

  for o in select * from public.outposts where faction_id=p_fid and mode='mining' loop
    d := floor(extract(epoch from (now()-coalesce(o.last_accrue,o.created_at)))/86400.0);
    if d < 1 then continue; end if;
    k := public._outpost_crew_k(o.crew, o.mode);          -- ← укомплектованность
    gc_total := gc_total + public._defense_const('outpost_mine_gc') * d * k;

    if nullif(trim(coalesce(o.mine_res,'')),'') is not null and freecap > 0 then
      rate := 0;
      for relem in
        select r.value
        from jsonb_array_elements(coalesce((select planets from public.map_systems where id=o.system_id),'[]'::jsonb)) pl,
             jsonb_array_elements(coalesce(pl.value->'resources','[]'::jsonb)) r
        where r.value->>'name' = o.mine_res
      loop
        rr := coalesce(relem->>'r','common');
        rate := rate + (case rr when 'uncommon' then 6 when 'rare' then 3 when 'epic' then 1 when 'legendary' then 1 else 12 end);
      end loop;
      addq := least(rate * d * k, freecap);
      if addq > 0 then
        cur := jsonb_set(cur, array[o.mine_res], to_jsonb(coalesce((cur->>o.mine_res)::numeric,0) + addq), true);
        freecap := freecap - addq;
      end if;
    end if;

    update public.outposts set last_accrue = coalesce(last_accrue,created_at) + (d || ' days')::interval
      where id = o.id;
  end loop;

  update public.faction_economy set gc = gc + gc_total, resources = cur where faction_id = p_fid;
end$$;
revoke all on function public._outpost_mining_settle(text) from public;

-- ── РАЗВЕДКА: слепой (недоукомплектованный) аванпост не даёт обзора ──
create or replace function public._defense_can_see(p_fid text, p_system_id text, p_owner_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select
    p_fid = p_owner_fid
    or exists(select 1 from public.colonies c
              where c.faction_id = p_fid and c.system_id = p_system_id)
    or exists(select 1 from public.map_systems s
              where s.id = p_system_id and s.faction = p_fid)
    or exists(select 1 from public.outposts o
              where o.faction_id = p_fid and o.system_id = p_system_id
                and public._outpost_crew_k(o.crew, o.mode) >= 0.5)
    or public._spy_intel(p_fid, p_owner_fid) is not null
$$;
revoke all on function public._defense_can_see(text,text,text) from public;
grant execute on function public._defense_can_see(text,text,text) to authenticated;

-- ── СЕНСОРНОЕ ПОКРЫТИЕ: только укомплектованные аванпосты ──
drop function if exists public._fleet_coverage(text);
create or replace function public._fleet_coverage(p_viewer text)
returns table(sid text) language sql stable as $$
  with mine as (
    select c.system_id::text as sid from public.colonies c where c.faction_id = p_viewer
    union
    select o.system_id::text as sid from public.outposts o
     where o.faction_id = p_viewer
       and public._outpost_crew_k(o.crew, o.mode) >= 0.5
  )
  select sid from mine
  union
  select hl.b_id::text from public.map_hyperlanes hl join mine m on m.sid = hl.a_id::text
  union
  select hl.a_id::text from public.map_hyperlanes hl join mine m on m.sid = hl.b_id::text
$$;

-- ── СТОЯНКА ФЛОТА: заставы тоже дают вместимость ──
-- База — версия из _defense_starbase.sql (она НОВЕЕ _defense_outpost.sql и
-- намеренно убрала вместимость с добывающих аванпостов, оставив только базы).
-- Не возвращаем её обратно: добавляем только ЗАСТАВЫ, ради которых всё и есть.
create or replace function public._fleet_capacity(p_fid text)
returns int language sql stable security definer set search_path=public as $$
  select
    coalesce((select sum(slots_open) from public.colony_buildings
              where faction_id = p_fid and btype = 'starbase'),0)::int
      * public._defense_const('starbase_cap_per_slot')::int
    + coalesce((select count(*) from public.outposts
                where faction_id = p_fid and mode = 'depot'
                  and public._outpost_crew_k(crew, mode) >= 0.5),0)::int
      * public._defense_const('depot_cap')::int
$$;
revoke all on function public._fleet_capacity(text) from public;
grant execute on function public._fleet_capacity(text) to authenticated;

-- ── Сводка по аванпостам для кабинета/карты ──
create or replace function public.outposts_mine()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._outpost_crew_settle(fid);
  perform public._outpost_mining_settle(fid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'system_id', o.system_id, 'name', o.name, 'mode', o.mode,
      'crew', o.crew, 'need', public._outpost_crew_need(o.mode),
      'k', round(public._outpost_crew_k(o.crew, o.mode), 2),
      'manned', public._outpost_crew_k(o.crew, o.mode) >= 0.5,
      'wage_day', public._defense_const('crew_wage_gc') * o.crew,
      'empty_since', o.empty_since,
      'sys_name', (select s.name from public.map_systems s where s.id = o.system_id))
      order by o.created_at)
    from public.outposts o where o.faction_id = fid), '[]'::jsonb);
end$$;
revoke all on function public.outposts_mine() from public;
grant execute on function public.outposts_mine() to authenticated;

-- ── Миграция: уже построенные аванпосты получают ПОЛНЫЙ штат бесплатно.
--    Половина штата означала бы тихий нерф вдвое по добыче за то, что игрок
--    построил ДО введения экипажа. Механика начинает кусаться дальше —
--    с жалования и с новых аванпостов.
--    Защита от повторного наката: не трогаем державы, где игрок УЖЕ управлял
--    штатом вручную (есть аванпост с экипажем выше половины штата).
update public.outposts o
   set crew = public._outpost_crew_need(o.mode),
       crew_paid = now(), empty_since = null
 where o.crew <= ceil(public._outpost_crew_need(o.mode) / 2.0)::int
   and not exists (
     select 1 from public.outposts p
      where p.faction_id = o.faction_id
        and p.crew > ceil(public._outpost_crew_need(p.mode) / 2.0)::int);

-- ════════════════════════════════════════════════════════════
-- ВОССТАНОВЛЕНИЕ ГЕЙТА ПРАВ УЧАСТНИКОВ (_fm_gates.sql)
-- ВАЖНАЯ ГРАБЛЯ: гейт живёт ОБЁРТКОЙ поверх RPC (оригинал уезжает в
-- <имя>__raw). Любой `create or replace` этой RPC — в том числе наши
-- надмножества fleet_send / outpost_ship_deploy / outpost_set_mode —
-- ЗАТИРАЕТ обёртку, и право «флот»/«оборона» перестаёт проверяться:
-- участник державы без права смог бы двигать флоты и разворачивать
-- аванпосты. Поэтому после любой перезаливки этих функций гейт вешаем
-- заново. _fm_wrap идемпотентен и сам подчищает осиротевшие __raw.
do $gate$
begin
  if to_regprocedure('public._fm_wrap(text,text,text,text)') is null then
    raise notice 'fm_wrap отсутствует — _fm_gates.sql не накачен, гейт пропущен';
    return;
  end if;

  -- легаси-пара однарговой версии (эпоха, когда у deploy не было режима):
  -- убираем, чтобы вызов не был неоднозначным с трёхарговой
  drop function if exists public.outpost_ship_deploy(uuid);
  drop function if exists public.outpost_ship_deploy__raw(uuid);

  perform public._fm_wrap('fleet_send',          'fleet',   'fleet', 'p_id');
  perform public._fm_wrap('fleet_refuel',        'fleet',   'fleet', 'p_id');
  perform public._fm_wrap('outpost_ship_deploy', 'fleet',   null,    null);
  perform public._fm_wrap('outpost_set_mode',    'defense', null,    null);
  perform public._fm_wrap('outpost_staff',       'defense', null,    null);
end$gate$;

notify pgrst, 'reload schema';

-- ── outposts_visible: отдаём КЛИЕНТУ экипаж (для своих аванпостов) ──
-- Надмножество версии из _outpost_storage_fix.sql: те же поля + crew/need/k.
-- Без этого карта не может показать укомплектованность и кнопку найма.
create or replace function public.outposts_visible()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._outpost_mining_settle(fid);   -- внутри уже считается и жалование
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'system_id', o.system_id, 'faction_id', o.faction_id,
      'name', o.name, 'mode', o.mode, 'mine_res', o.mine_res, 'mine', (o.faction_id = fid),
      'faction_name', public._fac_name(o.faction_id),
      'crew',   case when o.faction_id = fid then o.crew else null end,
      'need',   case when o.faction_id = fid then public._outpost_crew_need(o.mode) else null end,
      'k',      case when o.faction_id = fid then round(public._outpost_crew_k(o.crew, o.mode), 2) else null end,
      'manned', (public._outpost_crew_k(o.crew, o.mode) >= 0.5),
      'wage_day', case when o.faction_id = fid
                    then public._defense_const('crew_wage_gc') * o.crew else null end
    ) order by o.created_at asc)
    from public.outposts o
    where public._defense_can_see(fid, o.system_id, o.faction_id)
  ), '[]'::jsonb);
end$$;
revoke all on function public.outposts_visible() from public;
grant execute on function public.outposts_visible() to authenticated;

notify pgrst, 'reload schema';
