-- ============================================================
-- ПРОСТРАНСТВЕННАЯ ЭКОНОМИКА · СРЕЗ 5 — корпорации/биржа на пространственный доход
-- Выполнить ПОСЛЕ _spatial_economy1..4.sql и _exchange_corps.sql.
-- Доход домиков корпорации (factory/trade/temple) теперь умножается на просперити
-- их системы (+ ценовую премию товаров фабрикам) — ровно как в economy_accrue.
-- Следствие: дивиденды (corp_fix) и котировка (P/E от чистой выручки) становятся
-- ПРОИЗВОДНОЙ от состояния галактики — дефицит/война/стагнация в системах корпы
-- роняют её бумагу, бум/сбалансированность поднимают.
-- _corp_daily_net / corp_fix не трогаем — они идут через _corp_daily_gross.
-- ============================================================

-- ── Доход одного домика/сутки с учётом просперити его системы ──
--   Зеркало per-building логики economy_accrue (factory×prosp×price_g,
--   trade/temple×prosp). Без доктринного m_gc — как и было в corp gross.
create or replace function public._bld_daily_gc(p_building uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select case cb.btype
    when 'factory' then cb.slots_open * 200 * coalesce((nb->>'prosperity')::numeric,1) * coalesce((nb->'prices'->>'g')::numeric,1)
    when 'trade'   then cb.slots_open * 100 * coalesce((nb->>'prosperity')::numeric,1)
    when 'temple'  then cb.slots_open * 150 * coalesce((nb->>'prosperity')::numeric,1)
    else 0 end
  from public.colony_buildings cb
  left join public.colonies c on c.id = cb.colony_id
  left join lateral (select public._system_balance_net(c.system_id) as nb) s on true
  where cb.id = p_building
$$;
revoke all on function public._bld_daily_gc(uuid) from public;

-- ── Валовая выручка корпорации/сутки = Σ доходов домиков (пространственно) ──
create or replace function public._corp_daily_gross(p_corp uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(sum(public._bld_daily_gc(x.building_id)), 0)::numeric
  from public.corp_buildings x
  where x.corp_id = p_corp
$$;
revoke all on function public._corp_daily_gross(uuid) from public;

-- ── corps_status: free_buildings.daily_gc теперь тоже пространственный ──
--   (идентична _exchange_corps.sql, изменён лишь расчёт daily_gc у свободных домиков)
create or replace function public.corps_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'session', jsonb_build_object(
       'open', public.exchange_is_open(),
       'open_hour', (select open_hour from public.exchange_market where id=1),
       'close_hour',(select close_hour from public.exchange_market where id=1)),
    'can_found', public._corp_can_found(fid),
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'total_shares', c.total_shares, 'share_price', c.share_price,
        'base_gross', public._corp_daily_gross(c.id),
        'efficiency', public._corp_efficiency(c.id),
        'daily_gross', public._corp_daily_net(c.id),
        'my_shares', coalesce((select shares from public.corp_shares s where s.corp_id=c.id and s.holder_fid=fid),0),
        'holders', (select count(*) from public.corp_shares s where s.corp_id=c.id),
        'buildings', coalesce((select jsonb_agg(jsonb_build_object(
            'id', cb.id, 'btype', cb.btype, 'slots', cb.slots_open, 'colony', col.planet_name))
          from public.corp_buildings x join public.colony_buildings cb on cb.id=x.building_id
          left join public.colonies col on col.id=cb.colony_id where x.corp_id=c.id), '[]'::jsonb)
      ) order by c.created_at desc)
      from public.corporations c where c.faction_id = fid), '[]'::jsonb),
    'holdings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'corp_id', c.id, 'name', c.name, 'founder', coalesce(c.founder_name, public._fac_name(c.faction_id)),
        'shares', s.shares, 'total_shares', c.total_shares, 'share_price', c.share_price,
        'value', round(s.shares * c.share_price),
        'daily_gross', public._corp_daily_net(c.id)))
      from public.corp_shares s join public.corporations c on c.id = s.corp_id
      where s.holder_fid = fid and c.faction_id <> fid), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'corp_id', c.id, 'name', c.name, 'seller', public._fac_name(l.seller_fid),
        'mine', (l.seller_fid = fid), 'shares', l.shares, 'price', l.price,
        'daily_gross', public._corp_daily_net(c.id), 'total_shares', c.total_shares)
      order by l.created_at desc)
      from public.corp_listings l join public.corporations c on c.id = l.corp_id), '[]'::jsonb),
    'free_buildings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cb.id, 'btype', cb.btype, 'slots', cb.slots_open, 'colony', col.planet_name,
        'daily_gc', round(public._bld_daily_gc(cb.id))))
      from public.colony_buildings cb left join public.colonies col on col.id=cb.colony_id
      where cb.faction_id = fid and cb.id not in (select building_id from public.corp_buildings)), '[]'::jsonb)
  );
end$$;
revoke all on function public.corps_status() from public;
grant execute on function public.corps_status() to authenticated;

-- ── Проверка после применения ───────────────────────────────
-- select public._corp_daily_gross('<corp>');   -- меньше у корпы в дефицитных/воюющих системах
-- select public.corps_status();                 -- base_gross/daily_gross/free_buildings.daily_gc пространственные
-- select public.corp_fix();                     -- дивиденды теперь зависят от состояния систем корпы
