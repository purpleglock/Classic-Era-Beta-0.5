-- ============================================================
--  РЕВОРК РЕСУРСОВ  ·  _resource_rework.sql
--  Применять в Supabase → SQL Editor ПОСЛЕ _economy_accrue_consolidated.sql
--  (последний накаченный слайс тика). Идемпотентно, повторный прогон безопасен.
--
--  ЧТО МЕНЯЕТСЯ (одним куском, чтобы убрать старые неработающие ветки):
--   1) ДОБЫВАЮЩИЙ ДОМИК больше НЕ копает сам и НЕ является гейтом присутствия.
--      РЕВ.2: любая залежь любой редкости копается РАБОЧИМИ и БЕЗ домика — по
--      базовому капу (_mine_cap) с множителем ×1.0. Домик — чистый БУСТ: каждый
--      слот = +10% к добыче И к капу (_house_mult). Тир-гейт редкости УБРАН,
--      перебор идёт от ЗАЛЕЖЕЙ колоний, а не от построек.
--   2) РАБОЧИЕ = подкласс населения. Доля рабочих задаётся ползунком INDUSTRY
--      («Снабжение»): 10/20/30/40/50 % населения при уровне 0..4.
--      ИЗМЕНЕНИЕ СНАБЖЕНИЯ ВСТУПАЕТ СО СЛЕДУЮЩЕГО ТИКА (faction_budget.industry_eff
--      лагает на один тик — снапшот сдвигается в конце accrue).
--   3) ПУЛ РАБОЧИХ распределяется по системам пропорционально СПРОСУ залежей
--      (спрос залежи = _mine_cap × 5 рабочих). Приоритетные системы (6000 ГС,
--      colonies.worker_priority) забиваются ПЕРВЫМИ; переполнение переливается
--      на остальные. За каждые 5 рабочих на залежи — её базовый выход в тик
--      на СКЛАД, × m_mine × множитель домика × все прочие баффы.
--   4) ВСЁ ТОЛЬКО СО СКЛАДА (faction_economy.resources):
--        · добыча → всегда на склад;
--        · КАРАВАНЫ (trade_routes) грузят со склада;
--        · РЫНОК (btype=market) продаёт со склада;
--        · БИРЖА работает со складом (как и раньше).
--      Вырезаны: mine_flow / flow_rar / export_gc / mine_mode='export' /
--      доставка концессионного потока. Концессионные ДОМИКИ (чужая колония)
--      сохранены — их залежи копают рабочие концессионера.
--
--  БЮДЖЕТ/ВЕРА/ТОВАРЫ/ВОЛНА/АРМИИ не трогаются — economy_accrue пересоздаётся
--  строгим надмножеством. Хелперы (_faction_mods, _budget_*, _faith_*, _res_*,
--  _mine_cap, _mine_tier_ok, _apply_colony_projects, _spy_resolve, _raid_resolve,
--  _research_step) уже накачены и здесь НЕ переопределяются.
-- ============================================================

-- ── 0) СХЕМА ────────────────────────────────────────────────
-- Снабжение с лагом на тик: industry_eff = значение INDUSTRY «как на прошлом тике».
alter table public.faction_budget add column if not exists industry_eff int;
update public.faction_budget set industry_eff = industry where industry_eff is null;

-- Приоритетная система для заполнения рабочими (6000 ГС за отметку).
alter table public.colonies add column if not exists worker_priority boolean not null default false;

-- ⚠ ADD COLUMN industry_eff изменил ФОРМУ составного типа public.faction_budget.
-- Уже накаченная _budget_row() собирает fallback-строку row(...)::faction_budget
-- с прежним числом полей → после ALTER она бы падала. Пересоздаём с новым полем
-- (industry_eff — ПОСЛЕДНИЙ столбец, добавлен ALTER'ом; дефолт = 2, как industry).
create or replace function public._budget_row(p_fid text)
returns public.faction_budget language sql stable as $$
  select coalesce(
    (select b from public.faction_budget b where b.faction_id = p_fid),
    row(p_fid, 2,2,2,2,2, now(), 2)::public.faction_budget);
$$;

-- ── 1) ДОЛЯ РАБОЧИХ ОТ СНАБЖЕНИЯ (INDUSTRY) ─────────────────
-- Зеркало EC_WORKER_SHARE в economy.js.
create or replace function public._worker_share(p_lvl int)
returns numeric language sql immutable as $$
  select (array[0.10, 0.20, 0.30, 0.40, 0.50])[greatest(0,least(4,coalesce(p_lvl,2))) + 1]::numeric;
$$;
revoke all on function public._worker_share(int) from public;

-- Всего рабочих державы = население × доля(снабжение), по ЛАГ-снапшоту industry_eff.
create or replace function public._fac_workers(p_fid text)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare b public.faction_budget; lvl int;
begin
  b := public._budget_row(p_fid);
  lvl := coalesce(b.industry_eff, b.industry);
  return floor(public._fac_pop(p_fid) * public._worker_share(lvl));
end$$;
revoke all on function public._fac_workers(text) from public;

-- Множитель домика по слотам (зеркало EC_HOUSE_MULT).
-- РЕВ.2: домик — НЕ гейт присутствия, а БУСТ. 0 слотов (домика нет) = ×1.0,
-- залежь всё равно копается по базовому капу. Каждый слот домика = +10% к
-- добыче И к капу (домик «повышает кап»). Тир-гейт редкости УБРАН.
create or replace function public._house_mult(p_slots int)
returns numeric language sql immutable as $$
  select case when coalesce(p_slots,0) > 0 then 1 + 0.10 * p_slots::numeric else 1.0 end;
$$;
revoke all on function public._house_mult(int) from public;

-- ── 2) СПРОС РАБОЧИХ ПО КОЛОНИЯМ ────────────────────────────
-- Для державы p_fid: по КАЖДОЙ добывающей постройке (свои + концессионные на
-- чужих колониях) и по КАЖДОЙ залежи, покрытой ярусом постройки, спрос =
-- _mine_cap × 5. Гейт концессий — как в accrue: на чужой колонии копаю только
-- отданные мне залежи, на своей — только НЕ отданные никому.
-- Возврат: (colony_id, owner_fid, demand, priority).
-- РЕВ.2: перебор идёт от ЗАЛЕЖЕЙ (все колонии державы + концессии на чужих),
-- а НЕ от добывающих домиков. Домик больше не требуется, чтобы залежь копалась;
-- он лишь поднимает кап/спрос (× _house_mult по лучшему домику колонии). Тир-гейт
-- редкости УБРАН — копается любой ярус. house_slots = слоты ЛУЧШЕГО добывающего
-- домика колонии любого яруса (0 = домика нет → множитель ×1.0).
create or replace function public._worker_demand(p_fid text)
returns table(colony_id uuid, owner_fid text, demand numeric, priority boolean)
language sql stable security definer set search_path=public as $$
  with dep as (
    select c.id as colony_id,
           c.faction_id as owner_fid,
           coalesce(c.worker_priority,false) as priority,
           (relem->>'name') as rname,
           public._mine_cap(relem->>'amt') as base_cap,
           coalesce((select max(coalesce(cb.slots_open,1))
                       from public.colony_buildings cb
                      where cb.colony_id = c.id and cb.faction_id = p_fid
                        and cb.btype in ('mining','mining_deep','mining_exotic')), 0) as house_slots
    from public.colonies c
    cross join lateral jsonb_array_elements(coalesce(c.resources,'[]'::jsonb)) relem
    where c.resources is not null and jsonb_array_length(c.resources) > 0
  ),
  ok as (
    select d.* from dep d
    where (
        -- чужая колония → только отданные мне по концессии залежи
        (d.owner_fid is distinct from p_fid
           and exists(select 1 from public.mining_concessions mc
                      where mc.colony_id = d.colony_id and mc.res_name = d.rname and mc.to_fid = p_fid))
        -- своя колония → залежь не должна быть отдана никому
        or (d.owner_fid = p_fid
           and not exists(select 1 from public.mining_concessions mc
                          where mc.colony_id = d.colony_id and mc.res_name = d.rname))
      )
  )
  select colony_id,
         max(owner_fid)                                                     as owner_fid,
         sum(round(base_cap * public._house_mult(house_slots)) * 5)::numeric as demand,  -- кап × буст домика, 5 раб./ед
         bool_or(priority)                                                  as priority
  from ok
  group by colony_id
$$;
revoke all on function public._worker_demand(text) from public;

-- Разбивка по КАЖДОЙ покрытой залежи (для панели «Ресурсы»): одна строка на
-- залежь колонии. dep_demand = Σ(_mine_cap×5) по покрывающим домикам (стек),
-- house_slots = макс. слотов среди них. Гейт — как в _worker_demand.
-- (DROP — форма возврата менялась между ревизиями: +planet_name в OUT-колонках.)
drop function if exists public._worker_deposits(text);
create or replace function public._worker_deposits(p_fid text)
returns table(colony_id uuid, system_id text, planet_name text, res_name text, rarity text, amt text,
              dep_demand numeric, house_slots int, bcount int, btype text, priority boolean)
language sql stable security definer set search_path=public as $$
  with dep as (
    select c.id as colony_id, c.system_id,
           coalesce(nullif(c.planet_name,''),'Колония') as planet_name,
           coalesce(c.worker_priority,false) as priority,
           (relem->>'name') as rname,
           coalesce(relem->>'r',
             (select rarity from public.resource_rarity where name = relem->>'name'),
             'common') as rr,
           (relem->>'amt') as amt,
           public._mine_cap(relem->>'amt') as base_cap,
           c.faction_id as owner_fid,
           coalesce((select max(coalesce(cb.slots_open,1)) from public.colony_buildings cb
                      where cb.colony_id = c.id and cb.faction_id = p_fid
                        and cb.btype in ('mining','mining_deep','mining_exotic')), 0) as house_slots,
           (select count(*) from public.colony_buildings cb
                      where cb.colony_id = c.id and cb.faction_id = p_fid
                        and cb.btype in ('mining','mining_deep','mining_exotic')) as bcount,
           (select cb.btype from public.colony_buildings cb
                      where cb.colony_id = c.id and cb.faction_id = p_fid
                        and cb.btype in ('mining','mining_deep','mining_exotic')
                      order by coalesce(cb.slots_open,1) desc limit 1) as btype
    from public.colonies c
    cross join lateral jsonb_array_elements(coalesce(c.resources,'[]'::jsonb)) relem
    where c.resources is not null and jsonb_array_length(c.resources) > 0
  ),
  ok as (
    select d.* from dep d
    where (
        (d.owner_fid is distinct from p_fid
           and exists(select 1 from public.mining_concessions mc
                      where mc.colony_id = d.colony_id and mc.res_name = d.rname and mc.to_fid = p_fid))
        or (d.owner_fid = p_fid
           and not exists(select 1 from public.mining_concessions mc
                          where mc.colony_id = d.colony_id and mc.res_name = d.rname))
      )
  )
  select colony_id, system_id, max(planet_name) as planet_name, rname as res_name,
         max(rr) as rarity, max(amt) as amt,
         (round(max(base_cap) * public._house_mult(max(house_slots))) * 5)::numeric as dep_demand,  -- базовый кап × буст домика × 5 раб./ед
         max(house_slots)::int as house_slots,       -- слоты лучшего домика (0 = домика нет, ×1.0)
         max(bcount)::int as bcount,                  -- сколько добывающих домиков на колонии (любой ярус)
         max(btype) as btype,                         -- btype лучшего домика (null = домика нет)
         bool_or(priority) as priority
  from ok
  group by colony_id, system_id, rname
$$;
revoke all on function public._worker_deposits(text) from public;

-- ── 3) РАСПРЕДЕЛЕНИЕ РАБОЧИХ (пул с приоритетом и переливом) ─
-- Возврат jsonb { colony_id::text : workers }. Приоритетные системы забиваются
-- первыми (пропорц. если рабочих не хватает на все приоритетные), остаток
-- переливается на прочие пропорционально их спросу.
create or replace function public._worker_alloc(p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  w numeric; p_dem numeric; n_dem numeric; rem numeric;
  out jsonb := '{}'::jsonb; r record; give numeric; frac numeric;
begin
  w := public._fac_workers(p_fid);
  if w <= 0 then return out; end if;

  select coalesce(sum(demand) filter (where priority),0),
         coalesce(sum(demand) filter (where not priority),0)
    into p_dem, n_dem
  from public._worker_demand(p_fid);

  -- приоритетные
  if p_dem > 0 then
    frac := least(1, w / p_dem);          -- если рабочих меньше спроса приоритетных — делим пропорц.
    for r in select * from public._worker_demand(p_fid) where priority loop
      give := floor(r.demand * frac);
      out := jsonb_set(out, array[r.colony_id::text], to_jsonb(give), true);
    end loop;
    rem := greatest(0, w - p_dem);
  else
    rem := w;
  end if;

  -- прочие: остаток пропорц. спросу, кап по спросу (перелив «сгорает» в простой рабочих)
  if rem > 0 and n_dem > 0 then
    frac := least(1, rem / n_dem);
    for r in select * from public._worker_demand(p_fid) where not priority loop
      give := floor(r.demand * frac);
      out := jsonb_set(out, array[r.colony_id::text], to_jsonb(give), true);
    end loop;
  end if;

  return out;
end$$;
revoke all on function public._worker_alloc(text) from public;

-- ── 3b) РАЗБИВКА mine-баффов по источникам (для панели) ─────
-- Повторяет РОВНО mine-ветки _faction_mods (форма правления/режим/идеология/
-- раса/тип цив./столица/полит-техи/КУРС). Возврат: [{source,label,delta}], где
-- delta — аддитивная прибавка к mine (итог = 1 + Σdelta, кламп 0.3). Чисто
-- информативно; авторитетный множитель по-прежнему mods.mine.
create or replace function public._mine_breakdown(p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a public.faction_applications; out jsonb := '[]'::jsonb; rsrch jsonb; pol jsonb; pm numeric;
  add_row text; add_d numeric;
begin
  select * into a from public.faction_applications where faction_id=p_fid and status='approved' order by updated_at desc limit 1;
  if not found then return out; end if;

  add_d := case a.gov when 'Корпоратократия' then 0.10 when 'Коллективный разум' then 0.20 else 0 end;
  if add_d <> 0 then out := out || jsonb_build_object('source','Форма правления','label',a.gov,'delta',add_d); end if;

  add_d := case a.regime when 'Олигархический' then -0.10 when 'Авторитарный' then 0.10 when 'Тоталитарный' then 0.20 when 'Деспотизм' then 0.15 else 0 end;
  if add_d <> 0 then out := out || jsonb_build_object('source','Режим','label',a.regime,'delta',add_d); end if;

  add_d := case a.ideology when 'Ксенофобия' then 0.15 when 'Экоцентризм' then 0.25 when 'Индустриализм' then 0.10 else 0 end;
  if add_d <> 0 then out := out || jsonb_build_object('source','Идеология','label',a.ideology,'delta',add_d); end if;

  add_d := case a.race when 'Инсектоиды' then 0.15 when 'Плантоиды (Растениевидные)' then 0.15 when 'Литоиды (Каменные)' then 0.20 else 0 end;
  if add_d <> 0 then out := out || jsonb_build_object('source','Раса','label',a.race,'delta',add_d); end if;

  add_d := case a.civ_type when 'colony' then 0.10 else 0 end;
  if add_d <> 0 then out := out || jsonb_build_object('source','Тип цивилизации','label','Колониальная','delta',add_d); end if;

  add_d := case a.capital_env when 'desert' then 0.10 when 'volcanic' then 0.10 when 'lava' then 0.12 else 0 end;
  if add_d <> 0 then out := out || jsonb_build_object('source','Столица','label',a.capital_env,'delta',add_d); end if;

  select research into rsrch from public.faction_economy where faction_id=p_fid;
  if rsrch is not null and rsrch ? 'pol.goelro' then
    out := out || jsonb_build_object('source','Полит-технология','label','ГОЭЛРО','delta',0.15);
  end if;

  begin
    pol := public._econ_policy_mods(p_fid);
    pm := coalesce((pol->>'mine')::numeric, 0);
    if pm <> 0 then out := out || jsonb_build_object('source','Курс державы','label','экономический курс','delta',pm); end if;
  exception when undefined_function then null;
  end;

  return out;
end$$;
revoke all on function public._mine_breakdown(text) from public;

-- ── 4) ПЛАН ДЛЯ КЛИЕНТА (вкладка «Ресурсы») ─────────────────
-- Богатый снимок: сколько рабочих всего, как легли по системам, прогноз выхода
-- по залежам. Читает СНАПШОТ (industry_eff) → показывает то, что будет В ТИК.
create or replace function public.resource_worker_plan()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  fid text; alloc jsonb; total_w numeric; b public.faction_budget;
  mods jsonb; m_mine numeric; systems jsonb := '[]'::jsonb;
  sysrec record; deprec record;
  col_dem_map jsonb := '{}'::jsonb;   -- colony_id -> суммарный спрос колонии
  dw record;
  sys_workers numeric; sys_demand numeric; deps jsonb;
  col_workers numeric; col_dem numeric; dep_workers numeric; dep_yield numeric;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('error','no_faction'); end if;
  b := public._budget_row(fid);
  total_w := public._fac_workers(fid);
  alloc := public._worker_alloc(fid);
  mods := public._faction_mods(fid);
  m_mine := (mods->>'mine')::numeric;

  -- спрос по колониям (для деления рабочих колонии между её залежами)
  for dw in select colony_id, demand from public._worker_demand(fid) loop
    col_dem_map := jsonb_set(col_dem_map, array[dw.colony_id::text], to_jsonb(dw.demand), true);
  end loop;

  -- по СИСТЕМАМ (map_systems); внутри — залежи с покрытием рабочими
  for sysrec in
    select d.system_id,
           coalesce(nullif(ms.name,''), d.system_id, 'Система') as sys_name,
           bool_or(d.priority) as priority,
           array_agg(distinct d.colony_id) as colony_ids
    from public._worker_deposits(fid) d
    left join public.map_systems ms on ms.id = d.system_id
    group by d.system_id, ms.name
  loop
    sys_workers := 0; sys_demand := 0; deps := '[]'::jsonb;
    for deprec in
      select * from public._worker_deposits(fid) dep
      where dep.system_id is not distinct from sysrec.system_id
      order by dep.dep_demand desc
    loop
      col_workers := coalesce((alloc->>deprec.colony_id::text)::numeric, 0);
      col_dem     := coalesce((col_dem_map->>deprec.colony_id::text)::numeric, 0);
      dep_workers := case when col_dem > 0 then floor(col_workers * deprec.dep_demand / col_dem) else 0 end;
      dep_yield   := least(500, round(floor(dep_workers / 5.0) * m_mine * public._house_mult(deprec.house_slots)));
      sys_workers := sys_workers + dep_workers;
      sys_demand  := sys_demand + deprec.dep_demand;
      deps := deps || jsonb_build_object(
        'colony_id', deprec.colony_id,
        'planet', deprec.planet_name,
        'res', deprec.res_name,
        'rarity', deprec.rarity,
        'amt', deprec.amt,
        'demand', round(deprec.dep_demand),
        'workers', round(dep_workers),
        'base', floor(dep_workers / 5.0),
        'covered', dep_workers >= 5,
        'fill', case when deprec.dep_demand > 0 then round(least(1, dep_workers / deprec.dep_demand), 3) else 0 end,
        'btype', deprec.btype,
        'house_slots', deprec.house_slots,
        'bcount', deprec.bcount,
        'house_bonus', round((public._house_mult(deprec.house_slots) - 1) * 100),  -- +% к добыче от домика
        'm_mine', m_mine,
        'yield', round(dep_yield));
    end loop;

    systems := systems || jsonb_build_object(
      'system_id', sysrec.system_id,
      'name', sysrec.sys_name,
      'priority', sysrec.priority,
      'colony_ids', to_jsonb(sysrec.colony_ids),
      'demand', round(sys_demand),
      'workers', round(sys_workers),
      'fill', case when sys_demand > 0 then round(least(1, sys_workers / sys_demand), 3) else 0 end,
      'deposits', deps);
  end loop;

  return jsonb_build_object(
    'workers_total', round(total_w),
    'pop', round(public._fac_pop(fid)),
    'share', public._worker_share(coalesce(b.industry_eff, b.industry)),
    'industry', b.industry,
    'industry_eff', coalesce(b.industry_eff, b.industry),
    'm_mine', m_mine,
    'mine_sources', public._mine_breakdown(fid),   -- разбивка общих mine-баффов по источникам
    'priority_cost', 6000,
    'systems', systems);
end$$;
revoke all on function public.resource_worker_plan() from public;
grant execute on function public.resource_worker_plan() to authenticated;

-- ── 5) RPC: отметить/снять приоритетную систему (6000 ГС) ────
create or replace function public.resource_priority_set(p_colony uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; cur boolean; gc_now numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  select worker_priority into cur from public.colonies where id = p_colony and faction_id = fid;
  if not found then raise exception 'not your colony'; end if;

  if p_on and not coalesce(cur,false) then
    select gc into gc_now from public.faction_economy where faction_id = fid for update;
    if coalesce(gc_now,0) < 6000 then raise exception 'need 6000 GC (have %)', coalesce(gc_now,0); end if;
    update public.faction_economy set gc = gc - 6000 where faction_id = fid;
    update public.colonies set worker_priority = true where id = p_colony;
    return jsonb_build_object('ok', true, 'priority', true, 'charged', 6000);
  elsif not p_on and coalesce(cur,false) then
    update public.colonies set worker_priority = false where id = p_colony;  -- снятие бесплатно, без возврата
    return jsonb_build_object('ok', true, 'priority', false, 'charged', 0);
  end if;
  return jsonb_build_object('ok', true, 'priority', coalesce(cur,false), 'charged', 0);
end$$;
revoke all on function public.resource_priority_set(uuid, boolean) from public;
grant execute on function public.resource_priority_set(uuid, boolean) to authenticated;

-- Системный вариант: отметить/снять приоритет для ВСЕЙ системы (все мои колонии
-- в ней). 6000 ГС списывается ОДИН раз при включении, если система ещё не
-- приоритетна ни одной колонией.
create or replace function public.resource_priority_set_system(p_system text, p_on boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; any_on boolean; gc_now numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  if not exists(select 1 from public.colonies where system_id = p_system and faction_id = fid) then
    raise exception 'no colonies of yours in system';
  end if;
  select bool_or(coalesce(worker_priority,false)) into any_on
    from public.colonies where system_id = p_system and faction_id = fid;

  if p_on and not coalesce(any_on,false) then
    select gc into gc_now from public.faction_economy where faction_id = fid for update;
    if coalesce(gc_now,0) < 6000 then raise exception 'need 6000 GC (have %)', coalesce(gc_now,0); end if;
    update public.faction_economy set gc = gc - 6000 where faction_id = fid;
    update public.colonies set worker_priority = true where system_id = p_system and faction_id = fid;
    return jsonb_build_object('ok', true, 'priority', true, 'charged', 6000);
  elsif not p_on then
    update public.colonies set worker_priority = false where system_id = p_system and faction_id = fid;
    return jsonb_build_object('ok', true, 'priority', false, 'charged', 0);
  end if;
  return jsonb_build_object('ok', true, 'priority', coalesce(any_on,false), 'charged', 0);
end$$;
revoke all on function public.resource_priority_set_system(text, boolean) from public;
grant execute on function public.resource_priority_set_system(text, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════
--  6) ПЕРЕСОЗДАНИЕ economy_accrue  (добыча рабочими, всё со склада)
-- ════════════════════════════════════════════════════════════
create or replace function public.economy_accrue(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  eco public.faction_economy; d int; d_raw int;
  inc_gc numeric:=0; inc_sci numeric:=0; inc_agents int:=0; trade_gc numeric:=0; pirate boolean:=false;
  r record; bld record; relem jsonb; thr jsonb;
  res_add jsonb := '{}'::jsonb; res_sub jsonb := '{}'::jsonb; merged jsonb; k text;
  rname text; rr text; rate numeric; escorted boolean; attacked boolean; chance numeric; avail numeric; shipped numeric;
  mods jsonb; m_mine numeric; m_gc numeric;
  market_cap numeric; market_gc numeric := 0; sell numeric;
  export_gc numeric := 0; cap numeric;
  rel_score int; dip_coef numeric;
  citem jsonb; cargo_price numeric;
  policy_cost numeric := 0;
  has_faith boolean := false;
  trate numeric := 150;
  tithe_gc numeric := 0;
  v_sects int := 0;
  sct record; v_ci_host int; v_new_exp numeric;
  bdg public.faction_budget;
  bdg_cost numeric := 0;
  w_mult numeric := 1;
  gf_slots numeric := 0; gf_ratio numeric := 0; gf_made numeric := 0;
  gf_water_need numeric; gf_mat_need numeric; take numeric; need numeric;
  av_lyod numeric; av_water numeric; av_iron numeric; av_silic numeric;
  goods_demand numeric := 0;
  goods_cov numeric := 1; goods_welfare numeric := 1;
  store_avail numeric; want numeric;
  -- РАБОЧИЕ
  w_alloc jsonb := '{}'::jsonb; col_dem_map jsonb := '{}'::jsonb;
  col_workers numeric; col_demand numeric;
  dep_demand numeric; dep_workers numeric; y numeric;
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

  bdg := public._budget_row(p_fid);
  w_mult := public._budget_gc_mult(bdg.social);
  m_gc := m_gc * w_mult;
  bdg_cost := public._budget_upkeep(p_fid);

  update public.unit_production set status='done' where faction_id=p_fid and status='queued' and ready_at<=now();

  perform public._apply_colony_projects(p_fid);
  perform public._spy_resolve(p_fid);
  perform public._raid_resolve(p_fid);

  d_raw := floor(extract(epoch from (now()-eco.last_tick))/86400.0);
  d := least(d_raw, 3);

  if d >= 1 then perform public._budget_auto_slots(p_fid); end if;

  has_faith := exists(select 1 from public.faith_membership where faction_id = p_fid);
  begin trate := public._faith_temple_rate(p_fid); exception when undefined_function then trate := 150; end;

  -- Доход построек (ГС/наука/агенты/храмы)
  for r in select btype, slots_open, faith_id from public.colony_buildings where faction_id=p_fid loop
    if r.btype='factory' then inc_gc := inc_gc + r.slots_open*200;
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    elsif r.btype='temple' and (
        (r.faith_id is not null and public._faith_member(p_fid, r.faith_id))
        or (r.faith_id is null and has_faith)) then inc_gc := inc_gc + r.slots_open*trate;
    end if;
  end loop;

  inc_sci := inc_sci * public._budget_sci_mult(bdg.science);

  if exists(select 1 from public.faiths where founder_fid = p_fid) then
    begin
      select coalesce(sum(cb.slots_open * public._faith_temple_rate(m.faction_id)),0) * 0.20 into tithe_gc
      from public.faith_membership m
      join public.faiths f on f.id = m.faith_id and f.founder_fid = p_fid
      join public.colony_buildings cb on cb.faction_id = m.faction_id and cb.btype = 'temple'
        and (cb.faith_id = f.id or cb.faith_id is null)
      where m.role <> 'founder';
    exception when undefined_function then
      select coalesce(sum(cb.slots_open),0) * 150 * 0.20 into tithe_gc
      from public.faith_membership m
      join public.faiths f on f.id = m.faith_id and f.founder_fid = p_fid
      join public.colony_buildings cb on cb.faction_id = m.faction_id and cb.btype = 'temple'
        and (cb.faith_id = f.id or cb.faith_id is null)
      where m.role <> 'founder';
    end;
    inc_gc := inc_gc + coalesce(tithe_gc, 0);
  end if;

  select count(*) into v_sects from public.faith_sects where owner_fid = p_fid and status = 'active';
  if v_sects > 0 then inc_gc := inc_gc + v_sects * 150; end if;

  if d >= 1 then
    cap := round((1000 + coalesce((select sum(slots_open) from public.colony_buildings
                            where faction_id=p_fid and btype='warehouse'),0) * 500)
                 * public._budget_cap_mult(bdg.infra));

    -- ВЕРА-4: контрразведка вскрывает чужие секты
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

    -- ════════ ДОБЫЧА РАБОЧИМИ (всё на склад) ════════
    -- Распределяем пул рабочих по системам (приоритет + перелив), затем внутри
    -- системы — по залежам пропорц. спросу залежи (базовый кап × буст домика × 5).
    -- За каждые 5 рабочих на залежи — её выход × m_mine × множитель домика.
    -- РЕВ.2: домик НЕ обязателен — залежь без домика копается по базовому капу
    -- (×1.0). Тир-гейт редкости убран; концессионный гейт — как в _worker_demand.
    -- ЕДИНЫЙ ИСТОЧНИК с планом (resource_worker_plan): идём по агрегатам
    -- _worker_deposits (одна строка на залежь: спрос = базовый кап × буст × 5),
    -- бонус по лучшему домику), делим рабочих колонии пропорц. спросу залежей.
    -- Так план и фактический тик считают ОДНО И ТО ЖЕ, расхождений нет.
    w_alloc := public._worker_alloc(p_fid);
    col_dem_map := '{}'::jsonb;
    for r in select colony_id, demand from public._worker_demand(p_fid) loop
      col_dem_map := jsonb_set(col_dem_map, array[r.colony_id::text], to_jsonb(r.demand), true);
    end loop;
    for bld in select * from public._worker_deposits(p_fid) loop
      col_workers := coalesce((w_alloc->>bld.colony_id::text)::numeric, 0);
      col_demand  := coalesce((col_dem_map->>bld.colony_id::text)::numeric, 0);
      if col_workers <= 0 or col_demand <= 0 then continue; end if;
      dep_workers := floor(col_workers * bld.dep_demand / col_demand);
      if dep_workers < 5 then continue; end if;    -- нужно хотя бы «5 рабочих = 1 ед.»
      -- выход = (рабочие/5) × m_mine × множитель лучшего домика
      y := least(500, round(floor(dep_workers / 5.0) * m_mine * public._house_mult(bld.house_slots)));
      if y <= 0 then continue; end if;
      res_add := jsonb_set(res_add, array[bld.res_name], to_jsonb(coalesce((res_add->>bld.res_name)::numeric,0) + y*d), true);
    end loop;

    -- ════════ ТОВАРЫ: поток под спрос (без склада) ════════
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

    -- Рост населения
    update public.colonies c
       set pop = least(coalesce(c.cells,0)*100,
                   greatest(coalesce(c.cells,0)*10,
                     round(coalesce(c.pop, coalesce(c.cells,0)*50)
                           * power(1 + public._pop_growth(bdg.social)
                                     + 0.01 * least(1, goods_cov)
                                     + case when exists(select 1 from public.faith_monuments fm
                                                        where fm.colony_id = c.id and fm.status <> 'rejected')
                                            then 0.005 else 0 end, d))))
     where c.faction_id = p_fid;

    -- ════════ КАРАВАНЫ: грузят СО СКЛАДА ════════
    for r in select cargo, resource, volume, price, convoy, threats, b_fid, transit_until from public.trade_routes where status='active' and a_fid=p_fid loop
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
          want := coalesce((citem->>'vol')::numeric,0)*d;
          store_avail := greatest(0, coalesce((eco.resources->>rname)::numeric,0)
                                     + coalesce((res_add->>rname)::numeric,0)
                                     - coalesce((res_sub->>rname)::numeric,0));
          shipped := least(want, store_avail);
          if shipped <= 0 then continue; end if;
          res_sub := jsonb_set(res_sub, array[rname], to_jsonb(coalesce((res_sub->>rname)::numeric,0) + shipped), true);
          cargo_price := public._res_price(coalesce((select rarity from public.resource_rarity where name=rname),'common'));
          trade_gc := trade_gc + shipped * cargo_price * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*cargo_price*0.5*dip_coef) where faction_id = r.b_fid;
        end loop;
      else
        rname := r.resource;
        want := coalesce(r.volume,0)*d;
        store_avail := greatest(0, coalesce((eco.resources->>rname)::numeric,0)
                                   + coalesce((res_add->>rname)::numeric,0)
                                   - coalesce((res_sub->>rname)::numeric,0));
        shipped := least(want, store_avail);
        if shipped > 0 then
          res_sub := jsonb_set(res_sub, array[rname], to_jsonb(coalesce((res_sub->>rname)::numeric,0) + shipped), true);
          trade_gc := trade_gc + shipped * coalesce(r.price,0) * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*coalesce(r.price,0)*0.5*dip_coef) where faction_id = r.b_fid;
        end if;
      end if;
    end loop;
    trade_gc := round(trade_gc * m_gc);

    -- ════════ РЫНОК (btype=market): продаёт СО СКЛАДА ════════
    -- До лимита слотов×25/сут, дороже — первым. Продаёт запас склада (учитывая
    -- уже добытое в этом тике и уже списанное караванами).
    market_cap := (select coalesce(sum(slots_open),0) from public.colony_buildings
                   where faction_id = p_fid and btype = 'market') * 25 * d;
    if market_cap > 0 then
      for r in
        select t.nm as res_name,
               coalesce((select rarity from public.resource_rarity where name=t.nm),'common') as res_rar
        from (
          select key as nm from jsonb_object_keys(eco.resources) as key
          union select nm from jsonb_object_keys(res_add) as nm
        ) t
        where t.nm <> 'Товары'
          -- РЫНОК НЕ ТРОГАЕТ РЕДКОЕ+ : Рагенод/Стелларит и прочее rare/epic/legendary
          -- копятся на складе, а не сливаются в ГС дороже-первым.
          and coalesce((select rarity from public.resource_rarity where name=t.nm),'common')
                not in ('rare','epic','legendary')
        order by public._res_value(t.nm, coalesce((select rarity from public.resource_rarity where name=t.nm),'common')) desc
      loop
        exit when market_cap <= 0;
        store_avail := greatest(0, coalesce((eco.resources->>r.res_name)::numeric,0)
                                   + coalesce((res_add->>r.res_name)::numeric,0)
                                   - coalesce((res_sub->>r.res_name)::numeric,0));
        sell := least(store_avail, market_cap);
        if sell <= 0 then continue; end if;
        res_sub := jsonb_set(res_sub, array[r.res_name],
                     to_jsonb(coalesce((res_sub->>r.res_name)::numeric,0) + sell), true);
        market_gc := market_gc + sell * public._res_value(r.res_name, r.res_rar) *
          (case r.res_rar when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65 when 'uncommon' then 0.55 else 0.5 end);
        market_cap := market_cap - sell;
      end loop;
      market_gc := round(market_gc * m_gc);
    end if;

    -- Склад: + добыча, − караваны/рынок/фабрика; кап по ёмкости
    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_add) loop
      merged := jsonb_set(merged, array[k], to_jsonb(round(least(cap, coalesce((merged->>k)::numeric,0) + (res_add->>k)::numeric))), true);
    end loop;
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(round(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric))), true);
    end loop;

    update public.faction_economy
      set gc = greatest(0, gc + round(inc_gc * m_gc * goods_welfare * d) + trade_gc + market_gc + export_gc - policy_cost * d - bdg_cost * d),
          science = science + round(greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d),
          agents  = agents  + greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
          resources = merged,
          last_tick = last_tick + (d_raw || ' days')::interval
      where faction_id=p_fid returning * into eco;

    -- СНАБЖЕНИЕ С ЛАГОМ: снапшот INDUSTRY сдвигается в конце тика →
    -- смена ползунка вступит в силу лишь со СЛЕДУЮЩЕГО тика.
    update public.faction_budget set industry_eff = industry where faction_id = p_fid;

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
    'workers', jsonb_build_object(                                     -- РАБОЧИЕ: сводка для клиента
       'total', round(public._fac_workers(p_fid)),
       'share', public._worker_share(coalesce(bdg.industry_eff, bdg.industry))),
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
      'upkeep', bdg_cost, 'w_mult', w_mult));
end$$;
revoke all on function public.economy_accrue(text) from public;

-- ── Проверка после применения ───────────────────────────────
-- select public.resource_worker_plan();                 -- план рабочих (нужна авторизация)
-- select public.economy_accrue('<fid>');                -- ключ workers в ответе, ресурсы растут со склада
-- select public._worker_alloc('<fid>');                 -- как легли рабочие по колониям
-- update public.faction_budget set last_tick = ...      -- нет; тик по времени last_tick faction_economy
