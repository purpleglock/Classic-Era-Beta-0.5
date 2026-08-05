-- ════════════════════════════════════════════════════════════════════════
-- resource_worker_plan: ОДИН проход вместо N+1 (лечит statement timeout 57014)
-- Катить ПОСЛЕ _res_mining_policy.sql. Идемпотентно, форма ответа та же.
--
-- Было: `_worker_deposits(fid)` звался в цикле — один раз на список систем и
-- ещё раз на КАЖДУЮ систему (13 систем ≈ 14 полных сканов всех колоний, ~300 мс
-- каждый) → упирались в лимит времени. Стало: обе тяжёлые функции вызываются
-- по одному разу, всё остальное — агрегация в SQL.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.resource_worker_plan()
returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare
  fid text; alloc jsonb; total_w numeric; b public.faction_budget;
  mods jsonb; m_mine numeric; systems jsonb := '[]'::jsonb;
  rpol jsonb; rcat jsonb; mine_names text[];
  store_cap numeric; store_used numeric;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('error','no_faction'); end if;
  b := public._budget_row(fid);
  total_w := public._fac_workers(fid);
  alloc := public._worker_alloc(fid);
  mods := public._faction_mods(fid);
  m_mine := (mods->>'mine')::numeric;
  select coalesce(rarity_policy,'{}'::jsonb) into rpol from public.faction_economy where faction_id = fid;

  store_cap := round((1000 + coalesce((select sum(slots_open) from public.colony_buildings
                          where faction_id=fid and btype='warehouse'),0) * 500)
                     * public._budget_cap_mult(b.infra));
  select coalesce(sum(value::numeric),0) into store_used
    from public.faction_economy fe, jsonb_each_text(coalesce(fe.resources,'{}'::jsonb))
   where fe.faction_id = fid;

  -- справочник ресурсов для чипов политики (редкость + «есть ли у меня залежь»);
  -- считаем ДО фильтра политики, иначе выключенный ресурс исчез бы из списка
  select coalesce(array_agg(distinct relem->>'name'), '{}'::text[]) into mine_names
    from public.colonies c
    cross join lateral jsonb_array_elements(coalesce(c.resources,'[]'::jsonb)) relem
   where c.faction_id = fid;
  select coalesce(jsonb_agg(jsonb_build_object('name', rr.name, 'rarity', rr.rarity,
                                               'mine', rr.name = any(mine_names)) order by rr.name), '[]'::jsonb)
    into rcat from public.resource_rarity rr;

  -- ── один проход: залежи + спрос колоний → выход по залежи → сборка систем ──
  with dep as (select * from public._worker_deposits(fid)),
       dem as (select colony_id, demand from public._worker_demand(fid)),
       w as (
         select d.*,
                case when coalesce(dm.demand,0) > 0
                     then floor(coalesce((alloc->>d.colony_id::text)::numeric,0) * d.dep_demand / dm.demand)
                     else 0 end as dep_workers
           from dep d left join dem dm on dm.colony_id = d.colony_id
       ),
       y as (
         -- зеркало economy_accrue: ставка × покрытие, срез потолком залежи
         select w.*,
                greatest(1, round(
                  (case w.rarity when 'uncommon' then 12 when 'rare' then 6
                                 when 'epic' then 3 when 'legendary' then 1 else 25 end)
                  * public._richness_mult(w.amt) * m_mine * public._house_mult(w.house_slots))) as dep_full,
                greatest(1, round(public._mine_cap(w.amt) * 8 * m_mine))                        as dep_cap,
                case when w.dep_demand > 0 then least(1, w.dep_workers / w.dep_demand) else 0 end as dep_cov
           from w
       ),
       z as (
         select y.*, case when y.dep_workers < 5 then 0
                          else least(y.dep_cap, round(y.dep_full * y.dep_cov)) end as dep_yield
           from y
       ),
       sys as (
         select z.system_id,
                bool_or(z.priority)                as priority,
                array_agg(distinct z.colony_id)    as colony_ids,
                sum(z.dep_demand)                  as sys_demand,
                sum(z.dep_workers)                 as sys_workers,
                jsonb_agg(jsonb_build_object(
                  'colony_id', z.colony_id,
                  'planet', z.planet_name,
                  'res', z.res_name,
                  'rarity', z.rarity,
                  'amt', z.amt,
                  'demand', round(z.dep_demand),
                  'workers', round(z.dep_workers),
                  'base', floor(z.dep_workers / 5.0),
                  'covered', z.dep_workers >= 5,
                  'fill', round(z.dep_cov, 3),
                  'btype', z.btype,
                  'house_slots', z.house_slots,
                  'bcount', z.bcount,
                  'house_bonus', round((public._house_mult(z.house_slots) - 1) * 100),
                  'm_mine', m_mine,
                  'full_rate', z.dep_full,          -- ставка при 100% покрытии
                  'dep_cap', z.dep_cap,             -- потолок залежи (анти-стакинг)
                  'cov', round(z.dep_cov, 3),
                  'yield', round(z.dep_yield)) order by z.dep_demand desc) as deps
           from z group by z.system_id
       )
  select coalesce(jsonb_agg(jsonb_build_object(
           'system_id', s.system_id,
           'name', coalesce(nullif(ms.name,''), s.system_id, 'Система'),
           'priority', s.priority,
           'colony_ids', to_jsonb(s.colony_ids),
           'demand', round(s.sys_demand),
           'workers', round(s.sys_workers),
           'fill', case when s.sys_demand > 0 then round(least(1, s.sys_workers / s.sys_demand), 3) else 0 end,
           'deposits', s.deps) order by coalesce(nullif(ms.name,''), s.system_id)), '[]'::jsonb)
    into systems
    from sys s left join public.map_systems ms on ms.id = s.system_id;

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
    'res_catalog', rcat,
    'store_cap', store_cap,
    'store_used', round(store_used),
    'systems', systems);
end$fn$;
revoke all on function public.resource_worker_plan() from public;
grant execute on function public.resource_worker_plan() to authenticated;
