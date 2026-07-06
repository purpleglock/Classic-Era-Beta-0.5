-- ============================================================
-- РЕЙТИНГ ИГРОКОВ (новелла «📊 Рейтинг игроков») — ЖИВАЯ статистика сектора
--
-- Идея: как у пассивной разведки (_passive_intel.sql) — все сырые числа
-- считаются НА СЕРВЕРЕ (SECURITY DEFINER), наружу уходят только готовые
-- РЕЙТИНГОВЫЕ величины: доли в %, очки индекса, ряды по дням. Точные
-- значения (слоты, корабли, казна) клиенту не выдаются.
--
-- Четыре дисциплины (= вкладки клиента):
--   • territory  — доля территории: системы карты (map_systems.faction), %
--   • media      — потоки влияния: эфир новостей за 12 дней (faction_news),
--                  ряд по дням на державу + итоговая доля эфира, %
--   • perception — индекс восприятия: средний ВХОДЯЩИЙ балл отношений
--                  (faction_relations.score → ±очки) + число связей
--   • industry   — промышленная мощь: слоты предприятий (colony_buildings), %
--                  + состав (гражд./воен./культ.) в процентах
--
-- Применять в Supabase → SQL Editor ПОСЛЕ _economy_setup.sql (есть
-- colony_buildings/faction_economy) и _diplomacy_relations.sql. Идемпотентно.
-- ============================================================

create or replace function public.faction_rating()
returns jsonb language sql stable security definer set search_path=public as $$
with f as (
  select faction_id as fid, owner_id, name,
         coalesce(color,'#3a9bdc') as color, herald_url
  from public.faction_applications
  where status='approved' and faction_id is not null
),

-- ── 1. ТЕРРИТОРИЯ: системы карты по владельцам ────────────────
tn as (
  select ms.faction as fid, count(*)::numeric as n
  from public.map_systems ms
  where ms.faction is not null
  group by ms.faction
),
tt as (select greatest(coalesce(sum(n),0),1) as s from tn),
terr as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'fid', x.fid, 'name', x.name, 'color', x.color, 'herald', x.herald_url,
           'pct', x.pct, 'rank', x.rank)
         order by x.rank), '[]'::jsonb) as j
  from (
    select f.*, round(coalesce(tn.n,0) * 1000 / tt.s) / 10 as pct,
           row_number() over (order by coalesce(tn.n,0) desc, f.name) as rank
    from f left join tn on tn.fid = f.fid, tt
  ) x
),

-- ── 2. ЭФИР: новости/события за 12 дней, ряд по дням ─────────
-- Привязка записи к державе: faction_id, автор (owner_id) или имя в заголовке.
mn as (
  select f.fid,
         least(11, greatest(0,
           11 - floor(extract(epoch from (now() - coalesce(n.published_at, n.created_at))) / 86400)::int)) as dk
  from f
  join public.faction_news n
    on n.status = 'approved'
   and coalesce(n.published_at, n.created_at) >= now() - interval '12 days'
   and (n.faction_id = f.fid
        or (n.owner_id is not null and n.owner_id = f.owner_id)
        or (f.name <> '' and n.title ilike '%' || f.name || '%'))
),
mc as (select fid, dk, count(*)::numeric as c from mn group by fid, dk),
mt as (select fid, sum(c) as tot from mc group by fid),
mtt as (select greatest(coalesce(sum(tot),0),1) as s from mt),
mser as (
  select f.fid, f.name, f.color, f.herald_url,
         coalesce(mt.tot,0) as tot,
         round(coalesce(mt.tot,0) * 1000 / mtt.s) / 10 as pct,
         (select coalesce(jsonb_agg(coalesce(mc.c,0) order by d.k), '[]'::jsonb)
            from generate_series(0,11) as d(k)
            left join mc on mc.fid = f.fid and mc.dk = d.k) as counts
  from f left join mt on mt.fid = f.fid, mtt
),
media as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'fid', s.fid, 'name', s.name, 'color', s.color, 'herald', s.herald_url,
           'pct', s.pct, 'counts', s.counts)
         order by s.tot desc, s.name), '[]'::jsonb) as j
  from (select * from mser order by tot desc, name limit 6) s
),

-- ── 3. ВОСПРИЯТИЕ: средний входящий балл отношений (±очки) ───
pn as (
  select fr.to_fid as fid, round(avg(fr.score))::int as score, count(*)::int as links
  from public.faction_relations fr
  group by fr.to_fid
),
perc as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'fid', x.fid, 'name', x.name, 'color', x.color, 'herald', x.herald_url,
           'score', x.score, 'links', x.links, 'rank', x.rank)
         order by x.rank), '[]'::jsonb) as j
  from (
    select f.*, coalesce(pn.score,0) as score, coalesce(pn.links,0) as links,
           row_number() over (order by coalesce(pn.score,0) desc, coalesce(pn.links,0) desc, f.name) as rank
    from f left join pn on pn.fid = f.fid
  ) x
),

-- ── 4. ОТРАСЛИ: слоты предприятий = промышленная мощь, % ─────
bn as (
  select cb.faction_id as fid,
         sum(coalesce(cb.slots_open,1))::numeric as slots,
         count(*) filter (where cb.btype in ('factory','mining','trade','market','warehouse'))::numeric as civ,
         count(*) filter (where cb.btype in ('science','training','intel','military_factory','shipyard'))::numeric as mil,
         count(*) filter (where cb.btype = 'temple')::numeric as faith
  from public.colony_buildings cb
  group by cb.faction_id
),
bt as (select greatest(coalesce(sum(slots),0),1) as s from bn),
ind as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'fid', x.fid, 'name', x.name, 'color', x.color, 'herald', x.herald_url,
           'pct', x.pct, 'rank', x.rank,
           'civ_pct', x.civ_pct, 'mil_pct', x.mil_pct, 'faith_pct', x.faith_pct)
         order by x.rank), '[]'::jsonb) as j
  from (
    select f.*, round(coalesce(bn.slots,0) * 1000 / bt.s) / 10 as pct,
           row_number() over (order by coalesce(bn.slots,0) desc, f.name) as rank,
           case when coalesce(bn.civ,0)+coalesce(bn.mil,0)+coalesce(bn.faith,0) > 0
                then round(coalesce(bn.civ,0)  *100/(bn.civ+bn.mil+bn.faith)) else 0 end as civ_pct,
           case when coalesce(bn.civ,0)+coalesce(bn.mil,0)+coalesce(bn.faith,0) > 0
                then round(coalesce(bn.mil,0)  *100/(bn.civ+bn.mil+bn.faith)) else 0 end as mil_pct,
           case when coalesce(bn.civ,0)+coalesce(bn.mil,0)+coalesce(bn.faith,0) > 0
                then round(coalesce(bn.faith,0)*100/(bn.civ+bn.mil+bn.faith)) else 0 end as faith_pct
    from f left join bn on bn.fid = f.fid, bt
  ) x
)

select jsonb_build_object(
  'at',         now(),
  'territory',  (select j from terr),
  'media',      (select j from media),
  'perception', (select j from perc),
  'industry',   (select j from ind)
)
$$;

revoke all on function public.faction_rating() from public;
grant execute on function public.faction_rating() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- select jsonb_pretty(public.faction_rating());
