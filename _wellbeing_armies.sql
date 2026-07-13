-- ============================================================
-- БЛАГОПОЛУЧИЕ v5 + АРМИИ «ЗВЁЗДНЫЙ МАРШ»
-- Применять в Supabase → SQL Editor ПОСЛЕ _budget_wellbeing.sql
-- (и _faith_monuments.sql). Идемпотентно.
--
-- Что даёт:
--   1) БЛАГОПОЛУЧИЕ = единый индекс wb (клиент: «Индекс благополучия»):
--        wb = соцобеспечение (_budget_gc_mult)
--           + идентичность (_wb_identity: раса + форма правления + режим +
--             идеология — у КАЖДОЙ комбинации свой профиль, зеркало EC_WB_IDENT)
--           − перегруз флота (_fleet_overcap_pen: корабли сверх вместимости
--             Звёздных Баз давят на общество; чем больше перебор — тем сильнее.
--             Снос баз теперь НЕ бесплатный обход лимита!)
--           − перегруз гарнизонов (_garrison_pen: войска на колонии сверх
--             порога «мирного гарнизона» — оккупационный дискомфорт)
--        Клампится в [0.55 .. 1.35].
--      wb множит ВЕСЬ ГС-доход (как раньше w_mult) и — НОВОЕ — ПРОПУСКНУЮ
--      СПОСОБНОСТЬ Товарной биржи (благополучная держава продаёт больше:
--      её услуги и товары котируются). Идентичность также даёт ±к росту
--      населения (ident × 0.05 %/сут-долей) — прирост у всех разный.
--   2) ДИВИЗИИ НЕ СТРОЯТСЯ экономикой: триггер отклоняет заказ
--      category='division'. Вместо этого строятся ЮНИТЫ (наземка/авиация)
--      в рамках пропускной способности построек:
--        пехота  → Центр Подготовки, техника → Военный Завод,
--        авиация → НОВАЯ постройка «Аэрокосмический Завод» (airfield).
--      Уже построенные дивизии остаются в составе и годятся в армии.
--   3) АРМИИ (зеркало флотов _army_fleet.sql, но по КОЛОНИЯМ):
--      army_form — собрать армию из готовых юнитов (ground/aviation/division)
--      на своей колонии, дать имя; army_send — переброска ТОЛЬКО между
--      своими колониями (долёт ×1.5 от флотского); army_disband — юниты
--      возвращаются в состав. Карта: режим «Звёздный марш».
--   4) ГАРНИЗОН: порог колонии = greatest(20, население/10) юнитов.
--      Всё, что стоит сверх порога, копит штраф к wb (до −0.25) и глушит
--      рост населения колонии (−0.5%/сут).
--
-- ВАЖНО: economy_accrue пересоздаётся как СТРОГОЕ надмножество версии из
-- _budget_wellbeing.sql (строки -- ВЕРА / -- МУЛЬТИ / -- ПОТОКИ / -- БЮДЖЕТ /
-- -- ТОВАРЫ / -- ВОЛНА сохранены). Добавленное помечено «-- БЛАГО:».
-- ⚠ КЛОББЕР: _ec_bld_base и _budget_cat переопределяются здесь (добавлен
-- airfield) — при перекате _budget_wellbeing.sql продублируйте «-- МАРШ:».
-- ============================================================

-- ── 1) АРМИИ ────────────────────────────────────────────────
create table if not exists public.armies (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  owner_id    uuid,
  name        text,
  status      text not null default 'idle',        -- idle | transit
  colony_id   uuid references public.colonies(id) on delete set null,  -- где стоит (idle)
  from_colony uuid references public.colonies(id) on delete set null,
  dest_colony uuid references public.colonies(id) on delete set null,
  home_colony uuid references public.colonies(id) on delete set null,
  composition jsonb not null default '[]'::jsonb,  -- [{unit_id, unit_name, category, qty}]
  depart_at   timestamptz,
  arrive_at   timestamptz,
  created_at  timestamptz default now()
);
create index if not exists armies_fac_idx on public.armies(faction_id);
create index if not exists armies_col_idx on public.armies(colony_id);

alter table public.armies enable row level security;
drop policy if exists "armies_sel" on public.armies;
drop policy if exists "armies_all" on public.armies;
create policy "armies_sel" on public.armies for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
create policy "armies_all" on public.armies for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));
revoke insert, update, delete on public.armies from anon, authenticated;

-- Ленивое прибытие (зеркало _fleet_settle)
create or replace function public._army_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.armies
    set status='idle', colony_id=dest_colony, from_colony=null, dest_colony=null,
        depart_at=null, arrive_at=null
    where faction_id=p_fid and status='transit' and arrive_at <= now();
end$$;
revoke all on function public._army_settle(text) from public;

-- Юнитов в гарнизоне колонии (idle-армии, стоящие на ней)
create or replace function public._garrison_units(p_colony uuid)
returns int language sql stable security definer set search_path=public as $$
  select coalesce(sum(greatest(0,(c->>'qty')::int)),0)::int
  from public.armies a, jsonb_array_elements(coalesce(a.composition,'[]'::jsonb)) c
  where a.colony_id = p_colony and a.status = 'idle'
$$;
revoke all on function public._garrison_units(uuid) from public;

-- Порог «мирного гарнизона» колонии: до него штрафа нет.
-- 20 юнитов минимум, дальше — население/10 (зеркало ecGarrisonFree).
create or replace function public._garrison_free(p_colony uuid)
returns int language sql stable security definer set search_path=public as $$
  select greatest(20, round(coalesce(c.pop, coalesce(c.cells,0)*50) / 10.0))::int
  from public.colonies c where c.id = p_colony
$$;
revoke all on function public._garrison_free(uuid) from public;

-- Перегруз гарнизона колонии: 0 = в норме, 1 = вдвое сверх порога и т.п.
create or replace function public._garrison_over_ratio(p_colony uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select round(greatest(0, public._garrison_units(p_colony) - public._garrison_free(p_colony))::numeric
         / greatest(1, public._garrison_free(p_colony)), 3)
$$;
revoke all on function public._garrison_over_ratio(uuid) from public;

-- ── 2) RPC армий ────────────────────────────────────────────
-- Сформировать армию из ГОТОВЫХ юнитов (ground/aviation/division) на своей колонии.
create or replace function public.army_form(p_colony_id uuid, p_name text, p_units jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; elem jsonb; uid uuid; want int; avail int; uname text; ucat text;
  rem int; r record; take int; comp jsonb := '[]'::jsonb; total int := 0; v_id uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if not exists(select 1 from public.colonies where id=p_colony_id and faction_id=fid) then
    raise exception 'формировать армию можно только на своей колонии';
  end if;
  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception 'не выбран состав армии';
  end if;

  for elem in select value from jsonb_array_elements(p_units) loop
    uid  := nullif(elem->>'unit_id','')::uuid;
    want := greatest(0, coalesce((elem->>'qty')::int, 0));
    if uid is null or want <= 0 then continue; end if;

    select coalesce(sum(qty),0) into avail from public.unit_production
      where faction_id=fid and status='done' and category in ('ground','aviation','division') and unit_id=uid;
    if avail < want then raise exception 'недостаточно юнитов в составе (нужно %, есть %)', want, avail; end if;

    select unit_name, category into uname, ucat from public.unit_production
      where faction_id=fid and status='done' and category in ('ground','aviation','division') and unit_id=uid limit 1;

    rem := want;
    for r in select id, qty from public.unit_production
        where faction_id=fid and status='done' and category in ('ground','aviation','division') and unit_id=uid
        order by created_at asc loop
      exit when rem <= 0;
      take := least(r.qty, rem);
      if take >= r.qty then delete from public.unit_production where id=r.id;
      else update public.unit_production set qty=qty-take where id=r.id; end if;
      rem := rem - take;
    end loop;

    comp  := comp || jsonb_build_object('unit_id', uid::text, 'unit_name', uname, 'category', ucat, 'qty', want);
    total := total + want;
  end loop;

  if total < 1 then raise exception 'выберите хотя бы один юнит для армии'; end if;

  insert into public.armies(faction_id, owner_id, name, status, colony_id, home_colony, composition)
    values(fid, auth.uid(), nullif(trim(coalesce(p_name,'')),''), 'idle', p_colony_id, p_colony_id, comp)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'units', total, 'colony_id', p_colony_id,
    'garrison', public._garrison_units(p_colony_id), 'garrison_free', public._garrison_free(p_colony_id));
end$$;
revoke all on function public.army_form(uuid,text,jsonb) from public;
grant execute on function public.army_form(uuid,text,jsonb) to authenticated;

-- Перебросить армию на ДРУГУЮ СВОЮ колонию (наземка без колонии не выживает).
-- Долёт = флотский × 1.5 (войсковые транспорты медленнее).
create or replace function public.army_send(p_id uuid, p_dest_colony uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; ar public.armies; from_sys text; to_sys text; fly_h numeric;
begin
  fid := public._ec_my_fid();
  perform public._army_settle(fid);
  select * into ar from public.armies where id=p_id;
  if not found then raise exception 'army not found'; end if;
  if ar.faction_id is distinct from fid then raise exception 'not your army'; end if;
  if ar.status <> 'idle' then raise exception 'армия уже на марше'; end if;
  select system_id into to_sys from public.colonies where id=p_dest_colony and faction_id=fid;
  if to_sys is null then raise exception 'перебрасывать армии можно только на свои колонии'; end if;
  if p_dest_colony = ar.colony_id then raise exception 'армия уже там'; end if;
  select system_id into from_sys from public.colonies where id=ar.colony_id;

  fly_h := coalesce(public._fleet_fly_hours(from_sys, to_sys), 2.0) * 1.5;
  update public.armies
    set status='transit', from_colony=colony_id, dest_colony=p_dest_colony, colony_id=null,
        depart_at=now(), arrive_at=now() + (fly_h || ' hours')::interval
    where id=p_id;
  return jsonb_build_object('ok', true, 'fly_h', round(fly_h,1),
    'arrive_at', now() + (fly_h || ' hours')::interval);
end$$;
revoke all on function public.army_send(uuid,uuid) from public;
grant execute on function public.army_send(uuid,uuid) to authenticated;

-- Вернуть армию на колонию формирования.
create or replace function public.army_recall(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; ar public.armies;
begin
  fid := public._ec_my_fid();
  perform public._army_settle(fid);
  select * into ar from public.armies where id=p_id;
  if not found then raise exception 'army not found'; end if;
  if ar.faction_id is distinct from fid then raise exception 'not your army'; end if;
  if ar.home_colony is null then raise exception 'у армии нет родной колонии'; end if;
  if ar.status <> 'idle' then raise exception 'армия уже на марше'; end if;
  if ar.colony_id = ar.home_colony then raise exception 'армия уже дома'; end if;
  return public.army_send(p_id, ar.home_colony);
end$$;
revoke all on function public.army_recall(uuid) from public;
grant execute on function public.army_recall(uuid) to authenticated;

-- Распустить армию — юниты возвращаются в состав.
create or replace function public.army_disband(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; ar public.armies; elem jsonb; total int := 0;
begin
  fid := public._ec_my_fid();
  perform public._army_settle(fid);
  select * into ar from public.armies where id=p_id;
  if not found then raise exception 'army not found'; end if;
  if ar.faction_id is distinct from fid then raise exception 'not your army'; end if;
  if ar.status <> 'idle' then raise exception 'дождитесь прибытия армии, прежде чем распускать'; end if;

  for elem in select value from jsonb_array_elements(coalesce(ar.composition,'[]'::jsonb)) loop
    insert into public.unit_production(faction_id, owner_id, unit_id, unit_name, category, line, qty, status, ready_at)
      values(fid, auth.uid(), nullif(elem->>'unit_id','')::uuid, elem->>'unit_name',
             coalesce(nullif(elem->>'category',''),'ground'), 'military_factory',
             greatest(0, coalesce((elem->>'qty')::int,0)), 'done', now());
    total := total + greatest(0, coalesce((elem->>'qty')::int,0));
  end loop;

  delete from public.armies where id=p_id;
  return jsonb_build_object('ok', true, 'returned', total);
end$$;
revoke all on function public.army_disband(uuid) from public;
grant execute on function public.army_disband(uuid) to authenticated;

-- Мои армии (для кабинета и карты). VOLATILE — внутри _army_settle.
create or replace function public.armies_mine()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._army_settle(fid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'status', a.status,
      'colony_id', a.colony_id, 'from_colony', a.from_colony, 'dest_colony', a.dest_colony,
      'home_colony', a.home_colony, 'composition', a.composition,
      'depart_at', a.depart_at, 'arrive_at', a.arrive_at,
      'system_id', (select system_id from public.colonies c where c.id = a.colony_id),
      'from_system_id', (select system_id from public.colonies c where c.id = a.from_colony),
      'dest_system_id', (select system_id from public.colonies c where c.id = a.dest_colony),
      'planet_name', (select planet_name from public.colonies c where c.id = a.colony_id),
      'units', (select coalesce(sum(greatest(0,(c->>'qty')::int)),0)
                from jsonb_array_elements(coalesce(a.composition,'[]'::jsonb)) c),
      'can_recall', (a.status='idle' and a.home_colony is not null and a.colony_id is distinct from a.home_colony)
    ) order by a.created_at asc)
    from public.armies a where a.faction_id = fid
  ), '[]'::jsonb);
end$$;
revoke all on function public.armies_mine() from public;
grant execute on function public.armies_mine() to authenticated;

-- ── 3) Дивизии больше НЕ строятся экономикой ────────────────
create or replace function public._no_division_build()
returns trigger language plpgsql as $$
begin
  raise exception 'дивизии больше не строятся: стройте юниты и формируйте армии («Звёздный марш»)';
end$$;
drop trigger if exists trg_no_division_build on public.unit_production;
create trigger trg_no_division_build
  before insert on public.unit_production
  for each row when (new.category = 'division' and new.status = 'queued')
  execute function public._no_division_build();

-- ── 4) Аэрокосмический Завод (авиация) ──────────────────────
-- МАРШ: надмножество _ec_bld_base из _budget_wellbeing.sql (+ airfield).
create or replace function public._ec_bld_base(p_btype text)
returns numeric language sql immutable as $$
  select case p_btype
    when 'factory'          then 500    when 'mining'   then 500
    when 'trade'            then 1000   when 'market'   then 1500
    when 'science'          then 1000   when 'training' then 500
    when 'intel'            then 3000   when 'military_factory' then 1000
    when 'shipyard'         then 2000   when 'warehouse' then 800
    when 'temple'            then 1200
    when 'starbase'         then 5000
    when 'flak'             then 1500
    when 'abm'              then 3000
    when 'goodsfab'         then 1200
    when 'mining_deep'      then 2500   -- ЯРУСЫ: uncommon + rare
    when 'mining_exotic'    then 8000   -- ЯРУСЫ: epic + legendary
    when 'airfield'         then 1200   -- МАРШ: Аэрокосмический Завод (авиация)
    else null end
$$;

-- МАРШ: надмножество _budget_cat (+ airfield → military)
create or replace function public._budget_cat(p_btype text)
returns text language sql immutable as $$
  select case
    when p_btype in ('shipyard','military_factory','training','starbase','airfield') then 'military'
    when p_btype in ('science','intel') then 'science'
    else 'industry' end;
$$;

-- ── 5) БЛАГОПОЛУЧИЕ: идентичность расы/политики ─────────────
-- Аддитивный профиль благополучия (зеркало EC_WB_IDENT в economy.js).
-- У каждой расы и каждой политики — свой характер прироста.
create or replace function public._wb_identity(p_fid text)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare a public.faction_applications; w numeric := 0;
begin
  select * into a from public.faction_applications
   where faction_id=p_fid and status='approved' order by updated_at desc limit 1;
  if not found then return 0; end if;

  w := w + case a.race
    when 'Гуманоиды'                  then 0.03
    when 'Млекопитающие'              then 0.05
    when 'Рептилоиды'                 then -0.02
    when 'Авианы (Птицеподобные)'     then 0.01
    when 'Инсектоиды'                 then -0.03
    when 'Акватики (Водные)'          then 0.04
    when 'Плантоиды (Растениевидные)' then 0.06
    when 'Литоиды (Каменные)'         then -0.04
    when 'Синтетики / Киборги'        then 0.00
    when 'Энергетические сущности'    then 0.02
    else 0 end;

  w := w + case a.gov
    when 'Республика'          then 0.04
    when 'Монархия'            then 0.02
    when 'Империя'             then -0.03
    when 'Олигархия'           then -0.04
    when 'Диктатура'           then -0.05
    when 'Теократия'           then 0.03
    when 'Технократия'         then 0.02
    when 'Корпоратократия'     then -0.02
    when 'Коллективный разум'  then 0.05
    when 'Машинный разум (ИИ)' then 0.00
    else 0 end;

  w := w + case a.regime
    when 'Демократический'   then 0.04
    when 'Эгалитарный'       then 0.06
    when 'Меритократический'  then 0.02
    when 'Плутократический'   then -0.05
    when 'Олигархический'     then -0.03
    when 'Авторитарный'       then -0.03
    when 'Тоталитарный'       then -0.06
    when 'Деспотичный'        then -0.06
    when 'Деспотизм'          then -0.04
    when 'Анархический'       then -0.02
    else 0 end;

  w := w + case a.ideology
    when 'Пацифизм'                  then 0.05
    when 'Ксенофилия'                then 0.03
    when 'Спиритуализм'              then 0.02
    when 'Экоцентризм'               then 0.03
    when 'Милитаризм (Культ силы)'   then -0.04
    when 'Ксенофобия'                then -0.03
    when 'Экспансионизм'             then -0.02
    when 'Изоляционизм'              then 0.01
    when 'Технократия (Культ науки)' then 0.01
    when 'Трансгуманизм'             then 0.02
    when 'Индустриализм'             then -0.01
    else 0 end;

  return round(greatest(-0.20, least(0.20, w)), 3);
end$$;
revoke all on function public._wb_identity(text) from public;
grant execute on function public._wb_identity(text) to authenticated;

-- ── 6) БЛАГОПОЛУЧИЕ: штраф перегруза флота ──────────────────
-- Корабли сверх вместимости Звёздных Баз: пропорционально перебору,
-- 100% перебора = −0.12, потолок −0.35. Нет баз, а флот есть — считаем от 50.
create or replace function public._fleet_overcap_pen(p_fid text)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare used int; cap int; over numeric;
begin
  used := public._fleet_used(p_fid);
  cap  := public._fleet_capacity(p_fid);
  over := greatest(0, used - cap);
  if over <= 0 then return 0; end if;
  return round(least(0.35, 0.12 * over / greatest(cap, 50)), 3);
end$$;
revoke all on function public._fleet_overcap_pen(text) from public;
grant execute on function public._fleet_overcap_pen(text) to authenticated;

-- ── 7) БЛАГОПОЛУЧИЕ: штраф перегруза гарнизонов ─────────────
-- Сумма перегрузов колоний (×0.06), потолок −0.25.
create or replace function public._garrison_pen(p_fid text)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare s numeric;
begin
  if to_regclass('public.armies') is null then return 0; end if;
  select coalesce(sum(public._garrison_over_ratio(c.id)),0) into s
    from public.colonies c where c.faction_id = p_fid;
  return round(least(0.25, 0.06 * s), 3);
end$$;
revoke all on function public._garrison_pen(text) from public;
grant execute on function public._garrison_pen(text) to authenticated;

-- Сводка благополучия для UI.
create or replace function public.wellbeing_status()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare fid text; b public.faction_budget; ident numeric; fpen numeric; gpen numeric; base numeric;
begin
  fid := public._ec_my_fid();
  perform public._army_settle(fid);
  b := public._budget_row(fid);
  base  := public._budget_gc_mult(b.social);
  ident := public._wb_identity(fid);
  fpen  := public._fleet_overcap_pen(fid);
  gpen  := public._garrison_pen(fid);
  return jsonb_build_object(
    'base', base, 'ident', ident, 'fleet_pen', fpen, 'garrison_pen', gpen,
    'wb', round(greatest(0.55, least(1.35, base + ident - fpen - gpen)), 3),
    'fleet_used', public._fleet_used(fid), 'fleet_cap', public._fleet_capacity(fid),
    'garrisons', coalesce((
      select jsonb_agg(jsonb_build_object('colony_id', c.id, 'planet', c.planet_name,
        'units', public._garrison_units(c.id), 'free', public._garrison_free(c.id),
        'over', public._garrison_over_ratio(c.id)) order by c.planet_name)
      from public.colonies c where c.faction_id = fid and public._garrison_units(c.id) > 0), '[]'::jsonb));
end$$;
revoke all on function public.wellbeing_status() from public;
grant execute on function public.wellbeing_status() to authenticated;

-- ── 8) economy_accrue v9: благополучие v5 ───────────────────
-- База: _budget_wellbeing.sql v8 (ВЕРА/МУЛЬТИ/ПОТОКИ/БЮДЖЕТ/ТОВАРЫ/ВОЛНА
-- сохранены). Добавленное помечено «-- БЛАГО:».
create or replace function public.economy_accrue(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  eco public.faction_economy; d int; d_raw int;
  inc_gc numeric:=0; inc_sci numeric:=0; inc_agents int:=0; trade_gc numeric:=0; pirate boolean:=false;
  r record; col record; bld record; relem jsonb; thr jsonb;
  res_add jsonb := '{}'::jsonb; res_sub jsonb := '{}'::jsonb; merged jsonb; k text;
  rname text; rr text; rate numeric; escorted boolean; attacked boolean; chance numeric; avail numeric; shipped numeric;
  mods jsonb; m_mine numeric; m_gc numeric;
  market_cap numeric; market_gc numeric := 0; sell numeric;
  export_gc numeric := 0; cap numeric;
  rel_score int; dip_coef numeric;
  mine_flow jsonb := '{}'::jsonb;
  flow_rar  jsonb := '{}'::jsonb;
  citem jsonb; cargo_price numeric;
  policy_cost numeric := 0;
  has_faith boolean := false;                       -- ВЕРА
  trate numeric := 150;                              -- ВОЛНА: ставка храма ГС/слот
  tithe_gc numeric := 0;                             -- ВЕРА-2: десятина основателю
  v_sects int := 0;                                  -- ВЕРА-4: мои активные секты
  sct record; v_ci_host int; v_new_exp numeric;      -- ВЕРА-4
  fcfg jsonb := '{}'::jsonb;                         -- ПОТОКИ
  eff_mode text; v_conc_fid text;                    -- ПОТОКИ
  conc_out jsonb := '{}'::jsonb;                     -- ПОТОКИ (легаси)
  k2 text; qty numeric; rcap numeric;                -- ПОТОКИ (легаси)
  want numeric; extra numeric; store_avail numeric;  -- ПОТОКИ
  lim numeric;                                       -- ПОТОКИ
  bdg public.faction_budget;                         -- БЮДЖЕТ
  bdg_cost numeric := 0;                             -- БЮДЖЕТ
  w_mult numeric := 1;                               -- БЮДЖЕТ → БЛАГО: теперь единый индекс wb
  wb_ident numeric := 0;                             -- БЛАГО: идентичность расы/политики
  wb_fpen numeric := 0;                              -- БЛАГО: штраф перегруза флота
  wb_gpen numeric := 0;                              -- БЛАГО: штраф гарнизонов
  gf_slots numeric := 0; gf_ratio numeric := 0; gf_made numeric := 0;
  gf_water_need numeric; gf_mat_need numeric; take numeric; need numeric;
  av_lyod numeric; av_water numeric; av_iron numeric; av_silic numeric;
  goods_demand numeric := 0;
  goods_cov numeric := 1; goods_welfare numeric := 1;
  col_mined jsonb := '{}'::jsonb; ckey text; already numeric; capv numeric;
begin
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then return jsonb_build_object('faction_id',p_fid,'days',0); end if;

  mods := public._faction_mods(p_fid);
  m_mine := (mods->>'mine')::numeric;
  m_gc   := (mods->>'gc')::numeric;
  if eco.debuff_until is not null and eco.debuff_until > now() then
    m_gc := m_gc * (1 - coalesce(eco.debuff_pct,0));
  end if;
  policy_cost := public._trade_policy_cost(coalesce(eco.trade_policy,0));

  perform public._army_settle(p_fid);               -- БЛАГО: армии прибывают до подсчёта гарнизонов

  -- БЮДЖЕТ: ползунки + благополучие + апкип
  bdg := public._budget_row(p_fid);
  -- БЛАГО: единый индекс благополучия = соцобеспечение + идентичность − штрафы
  wb_ident := public._wb_identity(p_fid);
  wb_fpen  := public._fleet_overcap_pen(p_fid);
  wb_gpen  := public._garrison_pen(p_fid);
  w_mult := round(greatest(0.55, least(1.35,
              public._budget_gc_mult(bdg.social) + wb_ident - wb_fpen - wb_gpen)), 3);
  m_gc := m_gc * w_mult;
  bdg_cost := public._budget_upkeep(p_fid);

  update public.unit_production set status='done' where faction_id=p_fid and status='queued' and ready_at<=now();

  perform public._apply_colony_projects(p_fid);
  perform public._spy_resolve(p_fid);
  perform public._raid_resolve(p_fid);

  d_raw := floor(extract(epoch from (now()-eco.last_tick))/86400.0);
  -- БЮДЖЕТ: КАП ДОБОРА — начисляем максимум за 3 суток; хвост СГОРАЕТ.
  d := least(d_raw, 3);

  if d >= 1 then perform public._budget_auto_slots(p_fid); end if;  -- БЮДЖЕТ

  has_faith := exists(select 1 from public.faith_membership where faction_id = p_fid);  -- ВЕРА
  -- ВОЛНА: храм = ретранслятор идей; ставка зависит от охвата населения
  begin trate := public._faith_temple_rate(p_fid); exception when undefined_function then trate := 150; end;

  -- ПОТОКИ: настройки потоков по ресурсам
  select coalesce(jsonb_object_agg(f.res_name, jsonb_build_object(
      'mode', f.mode, 'market_limit', f.market_limit,
      'market_from_store', f.market_from_store, 'to_store', f.to_store)), '{}'::jsonb)
    into fcfg
  from public.faction_res_flows f where f.faction_id = p_fid;

  for r in select btype, slots_open, faith_id from public.colony_buildings where faction_id=p_fid loop  -- МУЛЬТИ
    if r.btype='factory' then inc_gc := inc_gc + r.slots_open*200;
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    elsif r.btype='temple' and (
        (r.faith_id is not null and public._faith_member(p_fid, r.faith_id))
        or (r.faith_id is null and has_faith)) then inc_gc := inc_gc + r.slots_open*trate;  -- ВЕРА · ВОЛНА
    end if;
  end loop;

  inc_sci := inc_sci * public._budget_sci_mult(bdg.science);   -- БЮДЖЕТ

  -- ВЕРА-2: десятина основателю по динамической ставке каждого адепта (ВОЛНА)
  if exists(select 1 from public.faiths where founder_fid = p_fid) then
    begin
      select coalesce(sum(cb.slots_open * public._faith_temple_rate(m.faction_id)),0) * 0.20 into tithe_gc
      from public.faith_membership m
      join public.faiths f on f.id = m.faith_id and f.founder_fid = p_fid
      join public.colony_buildings cb on cb.faction_id = m.faction_id and cb.btype = 'temple'
        and (cb.faith_id = f.id or cb.faith_id is null)          -- МУЛЬТИ
      where m.role <> 'founder';
    exception when undefined_function then                        -- ВОЛНА: слайс памятников ещё не накачен
      select coalesce(sum(cb.slots_open),0) * 150 * 0.20 into tithe_gc
      from public.faith_membership m
      join public.faiths f on f.id = m.faith_id and f.founder_fid = p_fid
      join public.colony_buildings cb on cb.faction_id = m.faction_id and cb.btype = 'temple'
        and (cb.faith_id = f.id or cb.faith_id is null)
      where m.role <> 'founder';
    end;
    inc_gc := inc_gc + coalesce(tithe_gc, 0);
  end if;

  -- ВЕРА-4: доход моих тайных сект
  select count(*) into v_sects from public.faith_sects where owner_fid = p_fid and status = 'active';
  if v_sects > 0 then inc_gc := inc_gc + v_sects * 150; end if;

  if d >= 1 then
    cap := round((1000 + coalesce((select sum(slots_open) from public.colony_buildings
                            where faction_id=p_fid and btype='warehouse'),0) * 500)
                 * public._budget_cap_mult(bdg.infra));         -- БЮДЖЕТ

    -- ВЕРА-4: контрразведка хозяина вскрывает чужие секты
    if exists(select 1 from public.faith_sects where host_fid = p_fid and status = 'active') then
      v_ci_host := public._spy_ci_power(p_fid, 'hq');
      for sct in select * from public.faith_sects where host_fid = p_fid and status = 'active' loop
        v_new_exp := least(100, sct.exposure + greatest(3, v_ci_host * 12) * d);
        if v_new_exp >= 100 then
          update public.faith_sects set exposure = 100, status = 'exposed', exposed_at = now() where id = sct.id;
          insert into public.faction_relations(from_fid,to_fid,score,updated_at)
            values(p_fid, sct.owner_fid, -10, now())
            on conflict (from_fid,to_fid) do update set score=greatest(-100, public.faction_relations.score-10), updated_at=now();
          insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
              title, excerpt, body, status, published_at, created_at, updated_at)
            values(p_fid, '🛐 КОНТРРАЗВЕДКА', 'rgba(200,150,40,0.55)', null, null,
              'Вскрыта тайная секта', null,
              format('Контрразведка «%s» раскрыла тайную секту веры «%s», насаждённую фракцией «%s». Ячейка ликвидирована.',
                public._fac_name(p_fid),
                coalesce((select name from public.faiths where id=sct.faith_id),'неизвестной веры'),
                public._fac_name(sct.owner_fid)),
              'approved', now(), now(), now());
        else
          update public.faith_sects set exposure = v_new_exp where id = sct.id;
        end if;
      end loop;
    end if;

    -- БЮДЖЕТ: авто-добыча — завод копает ВСЕ залежи планеты. ЯРУСЫ по постройкам.
    for bld in
      select cb.colony_id, cb.btype, cb.slots_open, coalesce(cb.mine_mode,'store') as mine_mode,
             c.resources as cres, c.faction_id as col_fid
      from public.colony_buildings cb
      join public.colonies c on c.id = cb.colony_id
      where cb.faction_id = p_fid and cb.btype in ('mining','mining_deep','mining_exotic')
        and c.resources is not null and jsonb_array_length(c.resources) > 0
    loop
      for relem in select value from jsonb_array_elements(bld.cres) loop
        rname := relem->>'name';
        if rname is null then continue; end if;
        rr := coalesce(relem->>'r', (select rarity from public.resource_rarity where name = rname), 'common');
        if not public._mine_tier_ok(bld.btype, rr) then continue; end if;  -- ЯРУСЫ
        rate := case rr when 'uncommon' then 9 when 'rare' then 5 when 'epic' then 4 when 'legendary' then 2 else 14 end;
        rate := greatest(1, round(rate * m_mine * greatest(1, coalesce(bld.slots_open,1)) / 3.0));
        capv := least(70, greatest(1, round(public._mine_cap(relem->>'amt') * m_mine)));
        rate := least(rate, capv);
        -- ПОТОКИ: концессии
        if bld.col_fid is distinct from p_fid then
          if not exists(select 1 from public.mining_concessions mc
                        where mc.colony_id = bld.colony_id and mc.res_name = rname
                          and mc.to_fid = p_fid) then
            continue;
          end if;
        elsif exists(select 1 from public.mining_concessions mc
                     where mc.colony_id = bld.colony_id and mc.res_name = rname) then
          continue;
        end if;
        -- ПОТОКИ: режим ресурса
        eff_mode := coalesce(fcfg->rname->>'mode',
                             case when bld.mine_mode = 'export' then 'export' else 'store' end);
        if eff_mode = 'export' then
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(coalesce((mine_flow->>rname)::numeric,0) + rate*d), true);
          flow_rar  := jsonb_set(flow_rar,  array[rname], to_jsonb(rr), true);
        else
          res_add  := jsonb_set(res_add,  array[rname], to_jsonb(coalesce((res_add->>rname)::numeric,0) + rate*d), true);
          flow_rar := jsonb_set(flow_rar, array[rname], to_jsonb(rr), true);
        end if;
      end loop;
    end loop;

    -- ════════ ТОВАРЫ: поток ПОД СПРОС ════════
    goods_demand := public._fac_pop(p_fid) / 600.0 * d;
    select coalesce(sum(slots_open),0) into gf_slots
      from public.colony_buildings where faction_id=p_fid and btype='goodsfab';
    if gf_slots > 0 and goods_demand > 0 then
      av_lyod  := greatest(0, coalesce((eco.resources->>'Лёд')::numeric,0)         + coalesce((res_add->>'Лёд')::numeric,0)         - coalesce((res_sub->>'Лёд')::numeric,0));
      av_water := greatest(0, coalesce((eco.resources->>'Жидкая вода')::numeric,0) + coalesce((res_add->>'Жидкая вода')::numeric,0) - coalesce((res_sub->>'Жидкая вода')::numeric,0));
      av_iron  := greatest(0, coalesce((eco.resources->>'Железо')::numeric,0)      + coalesce((res_add->>'Железо')::numeric,0)      - coalesce((res_sub->>'Железо')::numeric,0));
      av_silic := greatest(0, coalesce((eco.resources->>'Силикаты')::numeric,0)    + coalesce((res_add->>'Силикаты')::numeric,0)    - coalesce((res_sub->>'Силикаты')::numeric,0));
      gf_water_need := 6 * gf_slots * d;
      gf_mat_need   := 4 * gf_slots * d;
      gf_ratio := least(1,
        case when gf_water_need > 0 then (av_lyod + av_water) / gf_water_need else 1 end,
        case when gf_mat_need   > 0 then (av_iron + av_silic) / gf_mat_need   else 1 end);
      gf_ratio := greatest(0, gf_ratio);
      gf_made := least(goods_demand, 10 * gf_slots * d * gf_ratio);
      if gf_made > 0 then
        need := gf_made * 0.6;
        take := least(need, av_lyod);
        if take > 0 then res_sub := jsonb_set(res_sub, array['Лёд'], to_jsonb(coalesce((res_sub->>'Лёд')::numeric,0)+take), true); need := need - take; end if;
        if need > 0 then take := least(need, av_water);
          if take > 0 then res_sub := jsonb_set(res_sub, array['Жидкая вода'], to_jsonb(coalesce((res_sub->>'Жидкая вода')::numeric,0)+take), true); end if;
        end if;
        need := gf_made * 0.4;
        take := least(need, av_iron);
        if take > 0 then res_sub := jsonb_set(res_sub, array['Железо'], to_jsonb(coalesce((res_sub->>'Железо')::numeric,0)+take), true); need := need - take; end if;
        if need > 0 then take := least(need, av_silic);
          if take > 0 then res_sub := jsonb_set(res_sub, array['Силикаты'], to_jsonb(coalesce((res_sub->>'Силикаты')::numeric,0)+take), true); end if;
        end if;
      end if;
    end if;
    goods_cov := case when goods_demand > 0 then round(least(1, gf_made / goods_demand), 3) else 1 end;
    goods_welfare := round(least(1.10, greatest(0.90, 0.90 + 0.20 * goods_cov)), 3);

    -- БЮДЖЕТ: рост населения = соцобеспечение + товары. ВОЛНА: Памятник Веры +0.5%/сут.
    -- БЛАГО: + идентичность (ident×0.05 — у всех разный прирост)
    --        − перегруз гарнизона колонии (−0.5%/сут, оккупационный дискомфорт)
    update public.colonies c
       set pop = least(coalesce(c.cells,0)*100,
                   greatest(coalesce(c.cells,0)*10,
                     round(coalesce(c.pop, coalesce(c.cells,0)*50)
                           * power(1 + public._pop_growth(bdg.social)
                                     + 0.01 * least(1, goods_cov)
                                     + wb_ident * 0.05
                                     + case when exists(select 1 from public.faith_monuments fm
                                                        where fm.colony_id = c.id and fm.status <> 'rejected')
                                            then 0.005 else 0 end
                                     - case when public._garrison_over_ratio(c.id) > 0
                                            then 0.005 else 0 end, d))))
     where c.faction_id = p_fid;

    for r in select cargo, resource, volume, price, convoy, threats, b_fid, transit_until, from_store from public.trade_routes where status='active' and a_fid=p_fid loop  -- ПОТОКИ
      if r.transit_until is not null and r.transit_until > now() then continue; end if;
      escorted := coalesce(r.convoy,0) > 0; attacked := false;
      for thr in select value from jsonb_array_elements(coalesce(r.threats,'[]'::jsonb)) loop
        if (thr->>'type') = 'ancient' then chance := case when escorted then 0.65 else 0.80 end;
        else chance := case when escorted then 0.40 else 0.80 end; end if;
        if random() < chance then attacked := true; end if;
      end loop;
      if attacked then pirate := true; continue; end if;
      select coalesce(score,0) into rel_score from public.faction_relations where from_fid=p_fid and to_fid=r.b_fid;
      dip_coef := greatest(0.8, least(1.2, 1 + coalesce(rel_score,0)/500.0));

      if jsonb_array_length(coalesce(r.cargo,'[]'::jsonb)) > 0 then
        for citem in select value from jsonb_array_elements(r.cargo) loop
          rname := citem->>'res';
          avail := coalesce((mine_flow->>rname)::numeric, 0);
          want := coalesce((citem->>'vol')::numeric,0)*d;
          shipped := least(want, avail);
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(avail - shipped), true);
          if r.from_store and shipped < want then
            store_avail := greatest(0, coalesce((eco.resources->>rname)::numeric,0)
                                       - coalesce((res_sub->>rname)::numeric,0));
            extra := least(want - shipped, store_avail);
            if extra > 0 then
              res_sub := jsonb_set(res_sub, array[rname], to_jsonb(coalesce((res_sub->>rname)::numeric,0) + extra), true);
              shipped := shipped + extra;
            end if;
          end if;
          if shipped <= 0 then continue; end if;
          cargo_price := public._res_price(coalesce((select rarity from public.resource_rarity where name=rname),'common'));
          trade_gc := trade_gc + shipped * cargo_price * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*cargo_price*0.5*dip_coef) where faction_id = r.b_fid;
        end loop;
      else
        avail := coalesce((mine_flow->>r.resource)::numeric, 0);
        want := coalesce(r.volume,0)*d;
        shipped := least(want, avail);
        mine_flow := jsonb_set(mine_flow, array[r.resource], to_jsonb(avail - shipped), true);
        if r.from_store and shipped < want then
          store_avail := greatest(0, coalesce((eco.resources->>r.resource)::numeric,0)
                                     - coalesce((res_sub->>r.resource)::numeric,0));
          extra := least(want - shipped, store_avail);
          if extra > 0 then
            res_sub := jsonb_set(res_sub, array[r.resource], to_jsonb(coalesce((res_sub->>r.resource)::numeric,0) + extra), true);
            shipped := shipped + extra;
          end if;
        end if;
        if shipped > 0 then
          trade_gc := trade_gc + shipped * coalesce(r.price,0) * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*coalesce(r.price,0)*0.5*dip_coef) where faction_id = r.b_fid;
        end if;
      end if;
    end loop;
    trade_gc := round(trade_gc * m_gc);

    for rname in select jsonb_object_keys(mine_flow) loop
      avail := coalesce((mine_flow->>rname)::numeric, 0);
      if avail > 0 then
        export_gc := export_gc + avail * public._res_value(rname, coalesce(flow_rar->>rname,'common')) * 0.6;
      end if;
    end loop;
    export_gc := round(export_gc * m_gc);

    -- Товарная биржа: сбывает свежедобытый поток, склад не трогает.
    -- БЛАГО: пропускная способность биржи × индекс благополучия — услуги
    -- благополучной державы котируются выше, неблагополучной — избегаются.
    market_cap := round((select coalesce(sum(slots_open),0) from public.colony_buildings
                   where faction_id = p_fid and btype = 'market') * 25 * d * w_mult);
    if market_cap > 0 then
      for r in
        select t.nm as res_name, coalesce(flow_rar->>t.nm,'common') as res_rar,
               coalesce((res_add->>t.nm)::numeric,0) as avail
        from jsonb_object_keys(res_add) as t(nm)
        where t.nm <> 'Товары' and coalesce((res_add->>t.nm)::numeric,0) > 0   -- ТОВАРЫ
        order by public._res_value(t.nm, coalesce(flow_rar->>t.nm,'common')) desc
      loop
        exit when market_cap <= 0;
        sell := least(r.avail, market_cap);
        lim := nullif(fcfg->r.res_name->>'market_limit','')::numeric;     -- ПОТОКИ
        if lim is not null then sell := least(sell, lim * d); end if;     -- ПОТОКИ
        if sell <= 0 then continue; end if;
        res_add := jsonb_set(res_add, array[r.res_name],
                     to_jsonb(coalesce((res_add->>r.res_name)::numeric,0) - sell), true);
        market_gc := market_gc + sell * public._res_value(r.res_name, r.res_rar) *
          (case r.res_rar when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65 when 'uncommon' then 0.55 else 0.5 end);
        market_cap := market_cap - sell;
      end loop;
      -- ПОТОКИ: явный добор со склада
      for r in
        select f.res_name, f.market_from_store from public.faction_res_flows f
        where f.faction_id = p_fid and f.market_from_store > 0
        order by public._res_value(f.res_name,
          coalesce((select rarity from public.resource_rarity where name=f.res_name),'common')) desc
      loop
        exit when market_cap <= 0;
        store_avail := greatest(0, coalesce((eco.resources->>r.res_name)::numeric,0)
                                   - coalesce((res_sub->>r.res_name)::numeric,0));
        sell := least(r.market_from_store * d, store_avail, market_cap);
        if sell <= 0 then continue; end if;
        res_sub := jsonb_set(res_sub, array[r.res_name],
                     to_jsonb(coalesce((res_sub->>r.res_name)::numeric,0) + sell), true);
        rr := coalesce((select rarity from public.resource_rarity where name=r.res_name),'common');
        market_gc := market_gc + sell * public._res_value(r.res_name, rr) *
          (case rr when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65 when 'uncommon' then 0.55 else 0.5 end);
        market_cap := market_cap - sell;
      end loop;
      market_gc := round(market_gc * m_gc);
    end if;

    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_add) loop
      -- ПОТОКИ: перелив на склад выключен — остаток авто-продаётся как экспорт
      if coalesce(fcfg->k->>'to_store','true') = 'false' then
        export_gc := export_gc + round(greatest(0,(res_add->>k)::numeric)
          * public._res_value(k, coalesce(flow_rar->>k,'common')) * 0.6 * m_gc);
        continue;
      end if;
      -- ОКРУГЛЕНИЕ: склад хранит только целые
      merged := jsonb_set(merged, array[k], to_jsonb(round(least(cap, coalesce((merged->>k)::numeric,0) + (res_add->>k)::numeric))), true);
    end loop;
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(round(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric))), true);
    end loop;

    update public.faction_economy
      set gc = greatest(0, gc + round(inc_gc * m_gc * goods_welfare * d) + trade_gc + market_gc + export_gc - policy_cost * d - bdg_cost * d),  -- БЮДЖЕТ · ТОВАРЫ
          science = science + round(greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d),  -- ОКРУГЛЕНИЕ
          agents  = agents  + greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
          resources = merged,
          last_tick = last_tick + (d_raw || ' days')::interval  -- БЮДЖЕТ: хвост сгорает
      where faction_id=p_fid returning * into eco;

    insert into public.income_history(faction_id, owner_id, days, gc_build, gc_trade, gc_market, gc_export, gc_policy, gc_net, gc_after, sci, agents_n, mined)
      values(p_fid, eco.owner_id, d,
        round(inc_gc * m_gc * goods_welfare * d), trade_gc, market_gc, export_gc, (policy_cost + bdg_cost) * d,
        round(inc_gc * m_gc * goods_welfare * d) + trade_gc + market_gc + export_gc - (policy_cost + bdg_cost) * d,
        eco.gc,
        greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
        greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
        (select coalesce(sum(value::numeric),0) from jsonb_each_text(res_add)));
    delete from public.income_history where faction_id=p_fid
      and id not in (select id from public.income_history where faction_id=p_fid order by tick_at desc limit 30);
  end if;

  perform public._research_step(p_fid);
  select * into eco from public.faction_economy where faction_id = p_fid;

  return jsonb_build_object('faction_id',eco.faction_id,'gc',eco.gc,'science',eco.science,'agents',eco.agents,
    'resources',eco.resources,'last_tick',eco.last_tick,'days',d, 'mods', mods,
    'goods', jsonb_build_object('demand', round(goods_demand),
       'coverage', goods_cov, 'welfare', goods_welfare, 'made', round(gf_made), 'ratio', gf_ratio),
    'income', jsonb_build_object(
      'gc',     round(inc_gc * m_gc * goods_welfare),
      'science',greatest(0, inc_sci    + (mods->>'sci_flat')::numeric),
      'agents', greatest(0, inc_agents + (mods->>'agents_flat')::numeric),
      'trade',  trade_gc, 'market', market_gc, 'export', export_gc,
      'policy', policy_cost, 'pirate', pirate,
      'budget', bdg_cost),
    'budget', jsonb_build_object(
      'industry', bdg.industry, 'military', bdg.military, 'science', bdg.science,
      'social', bdg.social, 'infra', bdg.infra,
      'pop', public._fac_pop(p_fid), 'pop_cap', public._fac_pop_cap(p_fid),
      'growth', public._pop_growth(bdg.social),
      'upkeep', bdg_cost, 'w_mult', w_mult,
      -- БЛАГО: разбивка индекса благополучия для клиента
      'wb_base', public._budget_gc_mult(bdg.social),
      'wb_ident', wb_ident, 'wb_fleet_pen', wb_fpen, 'wb_garrison_pen', wb_gpen,
      'fleet_used', public._fleet_used(p_fid), 'fleet_cap', public._fleet_capacity(p_fid)));
end$$;
revoke all on function public.economy_accrue(text) from public;

-- ── Проверка после применения ───────────────────────────────
-- select public.wellbeing_status();
-- select public.economy_accrue('<fid>');  -- budget.wb_* в ответе
-- заказ дивизии (economy_produce с division) должен падать с подсказкой
-- select public.army_form('<colony uuid>', 'Первая ударная', '[{"unit_id":"...","qty":2}]');
