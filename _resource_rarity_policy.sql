-- ════════════════════════════════════════════════════════════════════════
-- ПОЛИТИКА ДОБЫЧИ ПО РЕДКОСТИ (вкладка «Ресурсы»)
-- Катить ПОСЛЕ _resource_rework.sql (переопределяет три его функции +
-- добавляет хранилище политики и RPC). Идемпотентно.
--
-- Игрок задаёт по каждой редкости (common/uncommon/rare/epic/legendary):
--   • ✗ ВЫКЛ  — залежи этой редкости НЕ копаются (спрос = 0, рабочие туда не идут);
--   • ★ ПРИОРИТЕТ — колонии с такой залежью получают рабочих ПЕРВЫМИ (как система-приоритет);
--   • обычно — без изменений.
-- Хранится в faction_economy.rarity_policy jsonb = {"off":[...],"prio":[...]}.
-- ════════════════════════════════════════════════════════════════════════

alter table public.faction_economy
  add column if not exists rarity_policy jsonb not null default '{}'::jsonb;

-- ── Хелперы: множества выключенных / приоритетных редкостей державы ──
create or replace function public._rarity_off(p_fid text)
returns text[] language sql stable security definer set search_path=public as $$
  select coalesce(array(select jsonb_array_elements_text(coalesce(rarity_policy->'off','[]'::jsonb)))
                  , '{}'::text[])
    from public.faction_economy where faction_id = p_fid
$$;
revoke all on function public._rarity_off(text) from public;

create or replace function public._rarity_prio(p_fid text)
returns text[] language sql stable security definer set search_path=public as $$
  select coalesce(array(select jsonb_array_elements_text(coalesce(rarity_policy->'prio','[]'::jsonb)))
                  , '{}'::text[])
    from public.faction_economy where faction_id = p_fid
$$;
revoke all on function public._rarity_prio(text) from public;

-- ── RPC: сохранить политику целиком ({off:[],prio:[]}) ──
create or replace function public.resource_rarity_policy_set(p_policy jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; clean jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('error','no_faction'); end if;
  -- нормализуем: только известные редкости, off приоритетнее prio
  clean := jsonb_build_object(
    'off',  coalesce((select jsonb_agg(distinct e) from jsonb_array_elements_text(coalesce(p_policy->'off','[]'::jsonb)) e
                       where e in ('common','uncommon','rare','epic','legendary')), '[]'::jsonb),
    'prio', coalesce((select jsonb_agg(distinct e) from jsonb_array_elements_text(coalesce(p_policy->'prio','[]'::jsonb)) e
                       where e in ('common','uncommon','rare','epic','legendary')
                         and e not in (select jsonb_array_elements_text(coalesce(p_policy->'off','[]'::jsonb)))), '[]'::jsonb));
  update public.faction_economy set rarity_policy = clean where faction_id = fid;
  return jsonb_build_object('ok', true, 'rarity_policy', clean);
end$$;
revoke all on function public.resource_rarity_policy_set(jsonb) from public;
grant execute on function public.resource_rarity_policy_set(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- ПЕРЕОПРЕДЕЛЕНИЕ функций добычи с учётом политики редкости
-- (тела скопированы из _resource_rework.sql + фильтр off + prio-флаг)
-- ════════════════════════════════════════════════════════════════════════

-- ── _worker_demand: спрос по колониям; off-редкости исключены,
--    prio-редкость поднимает колонию в приоритет (как worker_priority) ──
create or replace function public._worker_demand(p_fid text)
returns table(colony_id uuid, owner_fid text, demand numeric, priority boolean)
language sql stable security definer set search_path=public as $$
  with pol as (
    select public._rarity_off(p_fid) as off_r, public._rarity_prio(p_fid) as prio_r
  ),
  dep as (
    select c.id as colony_id,
           c.faction_id as owner_fid,
           coalesce(c.worker_priority,false) as priority,
           (relem->>'name') as rname,
           coalesce(relem->>'r',
             (select rarity from public.resource_rarity where name = relem->>'name'),
             'common') as rr,
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
    select d.*, (d.rr = any(pol.prio_r)) as is_prio
    from dep d, pol
    where not (d.rr = any(pol.off_r))                       -- ✗ выключенная редкость не копается
      and (
        (d.owner_fid is distinct from p_fid
           and exists(select 1 from public.mining_concessions mc
                      where mc.colony_id = d.colony_id and mc.res_name = d.rname and mc.to_fid = p_fid))
        or (d.owner_fid = p_fid
           and not exists(select 1 from public.mining_concessions mc
                          where mc.colony_id = d.colony_id and mc.res_name = d.rname))
      )
  )
  select ok.colony_id,
         max(ok.owner_fid)                                                        as owner_fid,
         sum(round(ok.base_cap * public._house_mult(ok.house_slots)) * 5)::numeric as demand,
         (bool_or(ok.priority) or bool_or(ok.is_prio))                            as priority
  from ok
  group by ok.colony_id
$$;
revoke all on function public._worker_demand(text) from public;

-- ── _worker_deposits: разбивка по залежам; off-редкости исключены ──
drop function if exists public._worker_deposits(text);
create or replace function public._worker_deposits(p_fid text)
returns table(colony_id uuid, system_id text, planet_name text, res_name text, rarity text, amt text,
              dep_demand numeric, house_slots int, bcount int, btype text, priority boolean)
language sql stable security definer set search_path=public as $$
  with pol as (
    select public._rarity_off(p_fid) as off_r, public._rarity_prio(p_fid) as prio_r
  ),
  dep as (
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
    select d.* from dep d, pol
    where not (d.rr = any(pol.off_r))
      and (
        (d.owner_fid is distinct from p_fid
           and exists(select 1 from public.mining_concessions mc
                      where mc.colony_id = d.colony_id and mc.res_name = d.rname and mc.to_fid = p_fid))
        or (d.owner_fid = p_fid
           and not exists(select 1 from public.mining_concessions mc
                          where mc.colony_id = d.colony_id and mc.res_name = d.rname))
      )
  )
  select ok.colony_id, ok.system_id, max(ok.planet_name) as planet_name, ok.rname as res_name,
         max(ok.rr) as rarity, max(ok.amt) as amt,
         (round(max(ok.base_cap) * public._house_mult(max(ok.house_slots))) * 5)::numeric as dep_demand,
         max(ok.house_slots)::int as house_slots,
         max(ok.bcount)::int as bcount,
         max(ok.btype) as btype,
         bool_or(ok.priority) as priority
  from ok
  group by ok.colony_id, ok.system_id, ok.rname
$$;
revoke all on function public._worker_deposits(text) from public;

-- ── resource_worker_plan: тот же снимок + отдаём rarity_policy клиенту ──
create or replace function public.resource_worker_plan()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  fid text; alloc jsonb; total_w numeric; b public.faction_budget;
  mods jsonb; m_mine numeric; systems jsonb := '[]'::jsonb;
  sysrec record; deprec record;
  col_dem_map jsonb := '{}'::jsonb;
  dw record;
  sys_workers numeric; sys_demand numeric; deps jsonb;
  col_workers numeric; col_dem numeric; dep_workers numeric; dep_yield numeric;
  rpol jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('error','no_faction'); end if;
  b := public._budget_row(fid);
  total_w := public._fac_workers(fid);
  alloc := public._worker_alloc(fid);
  mods := public._faction_mods(fid);
  m_mine := (mods->>'mine')::numeric;
  select coalesce(rarity_policy,'{}'::jsonb) into rpol from public.faction_economy where faction_id = fid;

  for dw in select colony_id, demand from public._worker_demand(fid) loop
    col_dem_map := jsonb_set(col_dem_map, array[dw.colony_id::text], to_jsonb(dw.demand), true);
  end loop;

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
        'house_bonus', round((public._house_mult(deprec.house_slots) - 1) * 100),
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
    'mine_sources', public._mine_breakdown(fid),
    'priority_cost', 6000,
    'rarity_policy', coalesce(rpol,'{}'::jsonb),
    'systems', systems);
end$$;
revoke all on function public.resource_worker_plan() from public;
grant execute on function public.resource_worker_plan() to authenticated;

-- select public.resource_rarity_policy_set('{"off":["legendary"],"prio":["epic"]}'::jsonb);
