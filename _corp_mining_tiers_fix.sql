-- ════════════════════════════════════════════════════════════════════════════
--  ФИКС: концессионные добывающие домики (mining_deep / mining_exotic) не
--  приносили дохода в корпорациях. Живая _corp_daily_gross (клоббер из
--  _exchange_demand.sql) знала только btype 'mining' → глубокая/экзотическая
--  добыча падала в else 0. Ярус домика по концессии обязан покрывать редкость
--  залежи (_concession_build.sql), поэтому концессионные почти всегда именно
--  этих ярусов — и давали 0, пока обычный mining давал 120/слот.
--
--  Применять ПОСЛЕ _exchange_demand.sql, _exchange_corp_moderation.sql и
--  _exchange_corp_index.sql (нужны corp_index/_corp_spark/corp_index_tick).
--  Ставки-зеркало ярусов: mining 120, mining_deep 200, mining_exotic 450 ГС/слот.
--  Идемпотентно.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Спрос: глубокая/экзотическая добыча живёт тем же сырьевым спросом ─────
create or replace function public._demand_factor(p_bt text)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare dem numeric; cap numeric; r numeric; m numeric;
begin
  if p_bt in ('mining','mining_deep','mining_exotic') then
    -- ДЕФИЦИТ СЫРЬЯ: равновесие/запас. Запас мал → ratio>1 → спрос вверх.
    select coalesce(sum(equilibrium),0), coalesce(sum(stock),0) into dem, cap from public.market_resources;
    if cap <= 0 then return 1.0; end if;
    r := dem / cap;
    m := power(r, 1.6);                          -- резкий отклик на дефицит
  elsif p_bt = 'factory' then
    -- УРОВЕНЬ ЦЕН: средняя цена/база. Дорогой рынок → промышленность нужнее.
    select coalesce(avg(price / nullif(base_price,0)), 1.0) into r from public.market_resources;
    m := power(coalesce(r,1.0), 1.3);
  elsif p_bt = 'shipyard' then
    -- ОЧЕРЕДЬ КОРАБЛЕЙ относительно мощности верфей галактики.
    select coalesce(sum(qty),0) into dem from public.unit_production where status = 'queued' and category = 'ship';
    select coalesce(sum(slots_open),0) into cap from public.colony_buildings where btype = 'shipyard';
    m := 0.6 + 0.8 * (dem / greatest(cap,1));
  elsif p_bt = 'military_factory' then
    -- ОЧЕРЕДЬ НАЗЕМКИ+АВИАЦИИ относительно мощности военпрома.
    select coalesce(sum(qty),0) into dem from public.unit_production where status = 'queued' and category in ('ground','aviation');
    select coalesce(sum(slots_open),0) into cap from public.colony_buildings where btype = 'military_factory';
    m := 0.6 + 0.8 * (dem / greatest(cap,1));
  elsif p_bt = 'trade' then
    -- АКТИВНЫЕ ТОРГОВЫЕ ПУТИ галактики относительно мощности хабов (~2 пути/слот нейтраль).
    select count(*) into dem from public.trade_routes where status = 'active';
    select coalesce(sum(slots_open),0) into cap from public.colony_buildings where btype = 'trade';
    m := 0.6 + 0.8 * (dem / greatest(cap/2.0,1));
  elsif p_bt = 'temple' then
    -- ОХВАТ ВЕРЫ: членства относительно мощности храмов (фолбэк 1.0, если веры нет).
    begin
      select count(*) into dem from public.faith_membership;
      select coalesce(sum(slots_open),0) into cap from public.colony_buildings where btype = 'temple';
      m := 0.6 + 0.8 * (dem / greatest(cap,1));
    exception when others then m := 1.0; end;
  else
    m := 1.0;                                    -- склад/рынок/наука/обучение/разведка — спросом не охвачены
  end if;
  return round(least(3.0, greatest(0.25, coalesce(m,1.0))), 3);
end$$;

-- ── 2) Валовая выручка/сутки: + ярусы добычи deep 200 / exotic 450 ───────────
create or replace function public._corp_daily_gross(p_corp uuid)
returns numeric language sql stable as $$
  select coalesce(sum(case cb.btype
            when 'factory'          then cb.slots_open * 200
            when 'shipyard'         then cb.slots_open * 160
            when 'temple'           then cb.slots_open * 150
            when 'military_factory' then cb.slots_open * 140
            when 'mining'           then cb.slots_open * 120
            when 'mining_deep'      then cb.slots_open * 200
            when 'mining_exotic'    then cb.slots_open * 450
            when 'trade'            then cb.slots_open * 100
            else 0 end), 0)::numeric
  from public.corp_buildings x
  join public.colony_buildings cb on cb.id = x.building_id
  where x.corp_id = p_corp
$$;

-- ── 3) corps_status v5 — надмножество v4e (_exchange_corp_index.sql): сохранены
--      'index'/'board'/'spark' и corp_index_tick() (в прошлой ревизии этого файла
--      они клоббернулись копией v3 → доска «нет одобренных организаций»);
--      исправлен daily_gc свободных домиков: ярусы добычи больше не «+0/ход» ───
create or replace function public.corps_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  begin perform public.corp_index_tick(); exception when others then null; end;   -- ИНДЕКС: рынок проживает прошедшие дни
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'session', jsonb_build_object(
       'open', public.exchange_is_open(),
       'open_hour', (select open_hour from public.exchange_market where id=1),
       'close_hour',(select close_hour from public.exchange_market where id=1)),
    'can_found', public._corp_can_found(fid),
    'demand', jsonb_build_object(                                              -- СПРОС
       'mining',           public._demand_factor('mining'),
       'factory',          public._demand_factor('factory'),
       'shipyard',         public._demand_factor('shipyard'),
       'military_factory', public._demand_factor('military_factory'),
       'trade',            public._demand_factor('trade'),
       'temple',           public._demand_factor('temple')),
    'index', jsonb_build_object(                                               -- ИНДЕКС
       'value', (select value from public.corp_index where id=1),
       'base',  (select base_value from public.corp_index where id=1),
       'spark', public._corp_spark(null, 40)),
    'board', coalesce((                                                        -- ИНДЕКС: вся доска котировок (одобренные)
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'founder', coalesce(c.founder_name, public._fac_name(c.faction_id)),
        'mine', (c.faction_id = fid),
        'image_url', c.image_url,
        'share_price', c.share_price, 'total_shares', c.total_shares,
        'sector_mult', public._corp_sector_mult(c.id),
        'daily_gross', public._corp_daily_net(c.id),
        'spark', public._corp_spark(c.id, 24),
        'my_shares', coalesce((select shares from public.corp_shares s where s.corp_id=c.id and s.holder_fid=fid),0),
        'ask', (select jsonb_build_object('id', l.id, 'price', l.price, 'shares', l.shares)
                from public.corp_listings l where l.corp_id = c.id and l.seller_fid <> fid
                order by l.price asc limit 1)
      ) order by (c.share_price * c.total_shares) desc)
      from public.corporations c where c.status = 'approved'), '[]'::jsonb),
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'total_shares', c.total_shares, 'share_price', c.share_price,
        'base_gross', public._corp_daily_gross(c.id),
        'efficiency', public._corp_efficiency(c.id),
        'sector_mult', public._corp_sector_mult(c.id),                         -- СПРОС
        'daily_gross', public._corp_daily_net(c.id),
        'spark', public._corp_spark(c.id, 24),                                 -- ИНДЕКС
        'description', c.description, 'image_url', c.image_url,                 -- МОД: контент (учредитель видит свой)
        'status', c.status, 'pending_review', c.pending_review,                -- МОД: статус модерации
        'pending', c.pending, 'reject_reason', c.reject_reason,                -- МОД: что предложено / причина отказа
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
        'sector_mult', public._corp_sector_mult(c.id),                         -- СПРОС
        'spark', public._corp_spark(c.id, 24),                                 -- ИНДЕКС
        'description', case when c.status='approved' then c.description else null end,  -- МОД: чужой контент только одобренный
        'image_url',   case when c.status='approved' then c.image_url   else null end,  -- МОД:
        'daily_gross', public._corp_daily_net(c.id)))
      from public.corp_shares s join public.corporations c on c.id = s.corp_id
      where s.holder_fid = fid and c.faction_id <> fid), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'corp_id', c.id, 'name', c.name, 'seller', public._fac_name(l.seller_fid),
        'mine', (l.seller_fid = fid), 'shares', l.shares, 'price', l.price,
        'sector_mult', public._corp_sector_mult(c.id),                         -- СПРОС
        'description', case when c.status='approved' then c.description else null end,  -- МОД:
        'image_url',   case when c.status='approved' then c.image_url   else null end,  -- МОД:
        'daily_gross', public._corp_daily_net(c.id), 'total_shares', c.total_shares)
      order by l.created_at desc)
      from public.corp_listings l join public.corporations c on c.id = l.corp_id), '[]'::jsonb),
    'free_buildings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cb.id, 'btype', cb.btype, 'slots', cb.slots_open, 'colony', col.planet_name,
        'daily_gc', case cb.btype
            when 'factory'          then cb.slots_open*200 when 'shipyard' then cb.slots_open*160
            when 'temple'           then cb.slots_open*150 when 'military_factory' then cb.slots_open*140
            when 'mining'           then cb.slots_open*120 when 'trade' then cb.slots_open*100
            when 'mining_deep'      then cb.slots_open*200 when 'mining_exotic' then cb.slots_open*450
            else 0 end))
      from public.colony_buildings cb left join public.colonies col on col.id=cb.colony_id
      where cb.faction_id = fid and cb.id not in (select building_id from public.corp_buildings)), '[]'::jsonb)
  );
end$$;
revoke all on function public.corps_status() from public;
grant execute on function public.corps_status() to authenticated;

-- PostgREST: подхватить изменённые функции
notify pgrst, 'reload schema';

-- ── Проверка ────────────────────────────────────────────────────────────────
-- select public._corp_daily_gross('<corp_id>');  -- теперь > 0 при deep/exotic домиках
-- select corps_status()->'free_buildings';       -- у ярусных домиков daily_gc > 0
