-- ══════════════════════════════════════════════════════════════════════
-- СТАВКА ХРАМА В РАЗУМНЫХ РАМКАХ + СВЕДЕНИЕ _bld_daily_gc С ТИКОМ (06.08.2026)
--
-- После _gc_income_truth.sql вера начала платить, и замер показал перекос:
-- храм давал 360 ГС/слот против 200 у фабрики, хотя КАРТОЧКА ПОСТРОЙКИ обещает
-- «+150 ГС за слот», а стоит храм 1200 против 500 у фабрики. То есть храм
-- никогда не задумывался как денежный домик — его отдача это скидка на войска.
-- Разгон до 360…480 был не балансом, а незамеченным следствием формулы ВОЛНЫ,
-- которая до вчерашнего дня НИКЕМ не вызывалась в начислении.
--
-- Правка: диапазон ставки 150…220 вместо 150…480. Нижняя граница = ровно то,
-- что обещает карточка; верхняя — умеренная награда за охват, памятники и сеть
-- адептов. Храм ОСТАЁТСЯ дешевле фабрики по отдаче на вложенный ГС — так и надо.
-- ══════════════════════════════════════════════════════════════════════

create or replace function public._faith_temple_rate(p_fid text)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  slots numeric; pop numeric; reach numeric; cov numeric;
  b public.faction_budget; fervor numeric; net numeric; monu numeric; n int;
  base numeric; zeal numeric;
begin
  slots := coalesce((select sum(slots_open) from public.colony_buildings
                     where faction_id = p_fid and btype = 'temple'),0);
  pop := greatest(1, public._fac_pop(p_fid));
  n := public._faith_monuments_n(p_fid);
  monu := least(1.25, 1 + 0.05 * n);
  reach := slots * 120 * (1 + 0.10 * least(5, n));
  cov := least(1, reach / pop);
  b := public._budget_row(p_fid);
  fervor := (array[1.20, 1.10, 1.00, 0.94, 0.88])[greatest(0,least(4,b.social)) + 1];
  net := least(1.15, 1 + 0.03 * coalesce((
    select count(distinct m.faction_id) from public.faith_membership m
    join public.faiths f on f.id = m.faith_id and f.founder_fid = p_fid
    where m.faction_id <> p_fid),0));
  -- ⚠ БЫЛО: least(240, 150 + 90*...) и потолок 480 — храм выходил доходнее
  -- фабрики (200/слот). СТАЛО: 150 (обещание карточки) + скромная надбавка,
  -- жёсткий потолок 220. Ставку крутить ТОЛЬКО здесь — это единственное место.
  base := least(180, 150 + 30 * power(cov, 0.7) * fervor * net * monu);
  zeal := public._pc_faith_boost(p_fid);
  return round(least(220, base * zeal));
end$function$;

-- ── Дивиденды корпораций считаются по тому же доходу, что и казна ────
-- _bld_daily_gc — база выручки построек для корпораций/облигаций. Она жила
-- своей жизнью: множила фабрику ещё и на цену товаров системы (prices->>'g'),
-- чего в начислении нет, и платила за храм плоские 150 без гейта по вере и без
-- потолка паствы. Сводим с economy_accrue, иначе дивиденды опять разъедутся
-- с реальным доходом постройки — ровно та болезнь, которую чиним.
create or replace function public._bld_daily_gc(p_building uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case cb.btype
    when 'factory' then cb.slots_open * 200 * public._prosp_of(c.system_id)
    when 'trade'   then cb.slots_open * 100 * public._prosp_of(c.system_id)
    when 'temple'  then
      case when exists(select 1 from public.faith_membership mm
                        where mm.faction_id = cb.faction_id
                          and (cb.faith_id is null or mm.faith_id = cb.faith_id))
           then cb.slots_open * public._faith_paid_frac(cb.faction_id)
                              * public._faith_temple_rate(cb.faction_id)
                              * public._prosp_of(c.system_id)
           else 0 end
    else 0 end
  from public.colony_buildings cb
  left join public.colonies c on c.id = cb.colony_id
  where cb.id = p_building
$function$;
