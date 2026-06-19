-- ============================================================
-- ПАССИВНАЯ РАЗВЕДКА — минимальный уровень разведданных без агентов
--
-- Идея (задача 3): если у фракции есть СТАНДИНГ-связь с другой —
--   • активный ТОРГОВЫЙ ПУТЬ,
--   • ХОРОШИЕ ОТНОШЕНИЯ (балл ≥ 40 в любую сторону),
--   • СОЮЗ / ВАССАЛИТЕТ (общий diplo_union либо diplo_vassals active),
-- — она бесплатно и постоянно получает ПРИБЛИЗИТЕЛЬНЫЙ срез по этой фракции:
--   • грубый состав флота (порядок числа кораблей / наземки),
--   • примерный доход,
--   • примерное распределение предприятий (гражд./воен./культ. в %),
--   • общий анализ сил относительно СЕБЯ: наука / военная промышленность /
--     армия — опережает / наравне / отстаёт.
--
-- В отличие от активной разведки (recon_basic/deep), данные НАМЕРЕННО размыты
-- (порядки величин, диапазоны), а у союзников (tier 2) — чуть точнее (≈N).
-- Всё считается на SECURITY DEFINER RPC: сырые числа цели наружу не уходят,
-- клиент получает только готовые ярлыки/проценты.
--
-- Применять в Supabase → SQL Editor ПОСЛЕ _economy_setup.sql, _diplo_unions.sql,
-- _diplomacy_relations.sql. Идемпотентно.
-- ============================================================

-- ── 1. Ярлык порядка величины (грубо; tight=true → ≈N для союзников) ──
create or replace function public._pi_qty_label(n numeric, tight boolean)
returns text language sql immutable as $$
  select case
    when coalesce(n,0) <= 0 then 'нет'
    when tight then
      case
        when n < 10   then '≈' || round(n)::text
        when n < 100  then '≈' || (round(n/10.0)*10)::int::text
        when n < 1000 then '≈' || (round(n/50.0)*50)::int::text
        else '≈' || (round(n/500.0)*500)::int::text || '+'
      end
    else
      case
        when n < 10   then 'единицы (1–9)'
        when n < 50   then 'десятки'
        when n < 200  then 'около сотни'
        when n < 1000 then 'сотни'
        else 'тысячи'
      end
  end
$$;

-- ── 2. Ярлык примерного дохода (ГС/ход) ──────────────────────
create or replace function public._pi_income_label(g numeric, tight boolean)
returns text language sql immutable as $$
  select case
    when coalesce(g,0) <= 0 then 'минимальный'
    when tight then '≈' || (round(g/100.0)*100)::int::text || ' ГС/ход'
    else case
      when g < 500  then 'скромный (<500/ход)'
      when g < 2000 then 'средний (≈1–2 тыс./ход)'
      when g < 5000 then 'высокий (неск. тыс./ход)'
      else 'очень высокий (5 тыс.+/ход)'
    end
  end
$$;

-- ── 3. Сравнение «их показатель против моего» ────────────────
create or replace function public._pi_cmp(theirs numeric, mine numeric)
returns text language sql immutable as $$
  select case
    when coalesce(theirs,0)=0 and coalesce(mine,0)=0 then 'данных нет'
    when coalesce(mine,0)=0 then 'значительно опережает'
    when theirs/mine >= 1.6  then 'значительно опережает'
    when theirs/mine >= 1.2  then 'опережает'
    when theirs/mine >= 0.83 then 'примерно наравне'
    when theirs/mine >= 0.6  then 'отстаёт'
    else 'значительно отстаёт'
  end
$$;

-- ── 4. Сырые метрики фракции (для отчёта и сравнения) ────────
-- Доход ГС приблизительно: фабрика 200, торг.хаб 100, храм 150 за слот
-- (зеркало EC_BUILD; добыча/биржа дают ресурсы, не прямой ГС → не учитываем).
-- Наука: научный институт (слоты) + изученные технологии (вес 3) как уровень развития.
-- Военпром: военный завод + верфь (слоты). Армия: готовые корабли + наземка/авиация.
create or replace function public._pi_metrics(p_fid text)
returns jsonb language sql stable as $$
  with b as (
    select btype, sum(coalesce(slots_open,1)) as slots, count(*) as cnt
    from public.colony_buildings where faction_id=p_fid group by btype
  ),
  agg as (
    select
      coalesce(sum(case when btype='factory' then slots*200
                        when btype='trade'   then slots*100
                        when btype='temple'  then slots*150 else 0 end),0) as income_gc,
      coalesce(sum(case when btype='science' then slots else 0 end),0)                     as science_slots,
      coalesce(sum(case when btype in ('military_factory','shipyard') then slots else 0 end),0) as mil_slots,
      coalesce(sum(case when btype in ('factory','mining','trade','market','warehouse') then cnt else 0 end),0) as civ_cnt,
      coalesce(sum(case when btype in ('science','training','intel','military_factory','shipyard') then cnt else 0 end),0) as mil_cnt,
      coalesce(sum(case when btype='temple' then cnt else 0 end),0)                        as faith_cnt
    from b
  ),
  fleet as (
    select
      coalesce(sum(case when category='ship' then qty else 0 end),0)               as ships,
      coalesce(sum(case when category in ('ground','aviation') then qty else 0 end),0) as ground
    from public.unit_production where faction_id=p_fid and status='done'
  ),
  tech as (
    select coalesce(jsonb_array_length(research),0) as n
    from public.faction_economy where faction_id=p_fid
  )
  select jsonb_build_object(
    'income_gc',    (select income_gc from agg),
    'science',      (select n from tech)*3 + (select science_slots from agg),
    'mil_industry', (select mil_slots from agg),
    'ships',        (select ships from fleet),
    'ground',       (select ground from fleet),
    'army',         (select ships + ground from fleet),
    'civ_cnt',      (select civ_cnt from agg),
    'mil_cnt',      (select mil_cnt from agg),
    'faith_cnt',    (select faith_cnt from agg)
  )
$$;

-- ── 5. Готовый размытый отчёт по цели относительно меня ──────
create or replace function public._pi_report(p_me text, p_tgt text, p_tier int, p_source text)
returns jsonb language sql stable as $$
  with m as (select public._pi_metrics(p_me)  as j),
       t as (select public._pi_metrics(p_tgt) as j),
       tot as (select (t.j->>'civ_cnt')::numeric + (t.j->>'mil_cnt')::numeric + (t.j->>'faith_cnt')::numeric as n from t)
  select jsonb_build_object(
    'target_fid',  p_tgt,
    'target_name', public._fac_name(p_tgt),
    'source',      p_source,
    'tier',        p_tier,
    'fleet', jsonb_build_object(
      'ships',  public._pi_qty_label((t.j->>'ships')::numeric,  p_tier>=2),
      'ground', public._pi_qty_label((t.j->>'ground')::numeric, p_tier>=2)),
    'income', public._pi_income_label((t.j->>'income_gc')::numeric, p_tier>=2),
    'enterprises', jsonb_build_object(
      'civ_pct',   case when (select n from tot)>0 then round((t.j->>'civ_cnt')::numeric  *100/(select n from tot)) else 0 end,
      'mil_pct',   case when (select n from tot)>0 then round((t.j->>'mil_cnt')::numeric  *100/(select n from tot)) else 0 end,
      'faith_pct', case when (select n from tot)>0 then round((t.j->>'faith_cnt')::numeric*100/(select n from tot)) else 0 end,
      'total',     public._pi_qty_label((select n from tot), p_tier>=2)),
    'forces', jsonb_build_object(
      'science',      public._pi_cmp((t.j->>'science')::numeric,      (m.j->>'science')::numeric),
      'mil_industry', public._pi_cmp((t.j->>'mil_industry')::numeric, (m.j->>'mil_industry')::numeric),
      'army',         public._pi_cmp((t.j->>'army')::numeric,         (m.j->>'army')::numeric))
  )
  from m, t
$$;

-- ── 6. RPC: пассивная разведка по всем доступным целям ───────
-- Возвращает jsonb-массив отчётов. Источник лучшего тира на цель: ally>trade>relations.
create or replace function public.passive_intel_all()
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; rep jsonb := '[]'::jsonb; r record;
begin
  if public.current_user_banned() then return rep; end if;
  select faction_id into me from public.faction_applications
    where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if me is null then return rep; end if;

  for r in
    with elig as (
      -- союз: общий diplo_union
      select dm2.fid as tgt, 2 as tier, 'ally' as source
        from public.diplo_members dm1
        join public.diplo_members dm2 on dm2.union_id=dm1.union_id and dm2.fid <> dm1.fid
        where dm1.fid = me
      union all
      -- вассалитет (любая сторона), активный
      select case when v.overlord_fid=me then v.vassal_fid else v.overlord_fid end, 2, 'ally'
        from public.diplo_vassals v
        where v.status='active' and me in (v.overlord_fid, v.vassal_fid)
      union all
      -- активный торговый путь
      select case when tr.a_fid=me then tr.b_fid else tr.a_fid end, 1, 'trade'
        from public.trade_routes tr
        where tr.status='active' and me in (tr.a_fid, tr.b_fid)
      union all
      -- хорошие отношения (балл ≥ 40 в любую сторону)
      select case when fr.from_fid=me then fr.to_fid else fr.from_fid end, 1, 'relations'
        from public.faction_relations fr
        where fr.score >= 40 and me in (fr.from_fid, fr.to_fid)
    ),
    best as (
      select tgt, max(tier) as tier, (array_agg(source order by tier desc))[1] as source
        from elig where tgt is not null and tgt <> me group by tgt
    )
    select b.tgt, b.tier, b.source from best b
      where exists(select 1 from public.faction_economy fe where fe.faction_id=b.tgt)
  loop
    rep := rep || public._pi_report(me, r.tgt, r.tier, r.source);
  end loop;

  return rep;
end$$;
revoke all on function public.passive_intel_all() from public;
grant execute on function public.passive_intel_all() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- select public.passive_intel_all();   -- от лица текущего пользователя
