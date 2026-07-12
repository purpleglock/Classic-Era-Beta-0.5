-- ============================================================================
--  БИРЖА · СРЕЗ 4b — СЕКТОРНЫЙ СПРОС (привязка дохода/котировок к галактике)
--  Применять в Supabase → SQL Editor ПОСЛЕ _exchange_corps.sql. Идемпотентно.
--  Зависит от: _exchange_corps.sql (corporations / corp_buildings / corp_shares /
--    _corp_efficiency / corp_fix / corps_status), _economy_setup.sql
--    (colony_buildings, unit_production, trade_routes, faction_economy),
--    _market_setup.sql (market_resources: stock/equilibrium/price/base_price),
--    _faith_setup.sql (faith_membership — необязательно, есть фолбэк).
--
--  ИДЕЯ (поправка юзера — биржа «не из вакуума»).
--  Доход корпорации больше НЕ фикс «слоты×ставка». Он умножается на СЕКТОРНЫЙ
--  СПРОС — множитель 0.25×…3.0×, который крутится от РЕАЛЬНОГО состояния
--  галактики. Чем востребованнее отрасль, тем выше и доход, и котировка акций:
--
--    рудник  (mining)           ← ДЕФИЦИТ СЫРЬЯ: Σequilibrium / Σstock рынка
--    фабрика (factory)          ← УРОВЕНЬ ЦЕН: avg(price/base_price) рынка
--    верфь   (shipyard)         ← ОЧЕРЕДЬ КОРАБЛЕЙ / мощность верфей галактики
--    военпром(military_factory) ← ОЧЕРЕДЬ НАЗЕМКИ+АВИАЦИИ / мощность военпрома
--    торг.хаб(trade)            ← АКТИВНЫЕ ТОРГОВЫЕ ПУТИ / мощность хабов
--    храм    (temple)           ← ОХВАТ ВЕРЫ (членства) / мощность храмов
--    прочие  (склад/рынок/наука/…) → спросом не охвачены, множитель 1.0
--
--  ФИНАНСИРОВАНИЕ. Учредитель платит дивиденды из казны по БАЗЕ (слоты×ставка),
--  а наценку спроса×синергии организация «чеканит» сверху и раздаёт акционерам.
--  В горячем секторе (spros 3×) держать акции крайне выгодно; в мёртвом (0.25×)
--  даже учредитель уходит в минус — отрасль сама себя балансирует.
--  Котировка на каждом фиксинге дрейфует к фундаменталу (P/E≈20 от дохода со
--  спросом) — поэтому «акции растут с дефицитом» даже без сделок.
-- ============================================================================

-- ── Множитель спроса на ОТРАСЛЬ (btype) из реального состояния галактики ──────
--    Возвращает 0.25…3.0 (нейтраль ≈ 1.0). stable security definer: читает
--    общегалактические агрегаты независимо от владельца. Вера — в защ. блоке.
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

-- ── Секторный множитель КОРПОРАЦИИ = средневзвешенный по слотам её построек ───
create or replace function public._corp_sector_mult(p_corp uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(round(
      sum(cb.slots_open * public._demand_factor(cb.btype)) / nullif(sum(cb.slots_open),0), 3), 1.0)
  from public.corp_buildings x join public.colony_buildings cb on cb.id = x.building_id
  where x.corp_id = p_corp
$$;

-- ── Валовая выручка/сутки (БАЗА): теперь включает рудник/верфь/военпром ───────
--    factory×200, shipyard×160, military_factory×140, temple×150, mining×120,
--    trade×100 ГС/слот; прочие → 0. (Раньше рудник/верфь давали НОЛЬ.)
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

-- ── Чистая распределяемая выручка/сутки = база × СПРОС × (1 + синергия) ───────
create or replace function public._corp_daily_net(p_corp uuid)
returns numeric language sql stable as $$
  select round(public._corp_daily_gross(p_corp)
             * public._corp_sector_mult(p_corp)
             * (1 + public._corp_efficiency(p_corp)), 2)
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  corp_fix() — дивидендный фиксинг со СПРОСОМ. Идемпотентно по суткам.
--  Учредитель финансирует БАЗУ из казны (clamp в дефиците); наценка спроса×
--  синергии чеканится сверху и раздаётся по долям. Котировка дрейфует к
--  фундаменталу (P/E≈20 от дохода со спросом).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.corp_fix()
returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.exchange_market; d int; co record; sh record;
        base numeric; mult numeric; eff numeric; take numeric; payout numeric;
        owner_gc numeric; fund numeric; tot int; paid int := 0;
begin
  select * into m from public.exchange_market where id = 1 for update;
  if not found then return jsonb_build_object('ok', true, 'days', 0); end if;
  d := floor(extract(epoch from (now() - m.last_fix)) / 86400.0);
  if d < 1 then return jsonb_build_object('ok', true, 'days', 0); end if;
  d := least(d, 30);

  for co in select * from public.corporations loop
    base := public._corp_daily_gross(co.id);
    mult := public._corp_sector_mult(co.id);
    eff  := public._corp_efficiency(co.id);

    -- котировка → дрейф к фундаменталу (доход со спросом × P/E 20 на долю)
    if co.total_shares > 0 then
      fund := round(base * mult * (1 + eff) * 20.0 / co.total_shares, 2);
      update public.corporations
         set share_price = case when co.share_price = 0 then fund
                                else round(co.share_price * 0.6 + fund * 0.4, 2) end
       where id = co.id;
    end if;

    if base <= 0 then continue; end if;

    select gc into owner_gc from public.faction_economy where faction_id = co.faction_id for update;
    if owner_gc is null then continue; end if;
    take := least(base * d, greatest(0, owner_gc));    -- казна финансирует БАЗУ (в дефиците — частично)
    if take <= 0 then continue; end if;

    select coalesce(sum(shares),0) into tot from public.corp_shares where corp_id = co.id;
    if tot <= 0 then continue; end if;

    payout := floor(take * mult * (1 + eff));          -- спрос×синергия чеканятся сверх изъятого

    update public.faction_economy set gc = gc - floor(take) where faction_id = co.faction_id;
    for sh in select * from public.corp_shares where corp_id = co.id loop
      update public.faction_economy
         set gc = gc + floor(payout * sh.shares::numeric / tot)
       where faction_id = sh.holder_fid;
    end loop;
    paid := paid + 1;
  end loop;

  update public.exchange_market set last_fix = last_fix + (d || ' days')::interval where id = 1;
  return jsonb_build_object('ok', true, 'days', d, 'corps_paid', paid);
end$$;

-- ── corp_create(): стартовая котировка-ориентир теперь учитывает спрос ───────
create or replace function public.corp_create(p_name text, p_buildings jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; nm text; v_id uuid; bid uuid; cnt int; n_added int := 0;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_name is null or length(btrim(p_name)) < 2 then raise exception 'bad name'; end if;
  fid := public._ec_my_fid();
  if not public._corp_can_found(fid) then
    raise exception 'only corporate states may found organizations';
  end if;
  select count(*) into cnt from public.corporations where faction_id = fid;
  if cnt >= 10 then raise exception 'too many corporations'; end if;
  nm := coalesce(nullif(public._fac_name(fid),''),'Держава');

  insert into public.corporations(faction_id, founder_name, name)
    values (fid, nm, btrim(p_name)) returning id into v_id;
  insert into public.corp_shares(corp_id, holder_fid, shares)
    values (v_id, fid, (select total_shares from public.corporations where id = v_id));

  if p_buildings is not null then
    for bid in select (jsonb_array_elements_text(p_buildings))::uuid loop
      perform 1 from public.colony_buildings where id = bid and faction_id = fid;
      if not found then continue; end if;
      perform 1 from public.corp_buildings where building_id = bid;
      if found then continue; end if;
      insert into public.corp_buildings(building_id, corp_id) values (bid, v_id);
      n_added := n_added + 1;
    end loop;
  end if;

  -- стартовая котировка-ориентир (P/E≈20 от чистой выручки со спросом+синергией)
  update public.corporations
     set share_price = round(public._corp_daily_net(v_id) * 20.0 / greatest(total_shares,1), 2)
   where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'buildings', n_added);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  corps_status() — + блок 'demand' (множители отраслей для инфографики) и
--  поле 'sector_mult' у каждой организации/доли/листинга. free_buildings.daily_gc
--  расширен на рудник/верфь/военпром.
-- ════════════════════════════════════════════════════════════════════════════
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
    'demand', jsonb_build_object(
       'mining',           public._demand_factor('mining'),
       'factory',          public._demand_factor('factory'),
       'shipyard',         public._demand_factor('shipyard'),
       'military_factory', public._demand_factor('military_factory'),
       'trade',            public._demand_factor('trade'),
       'temple',           public._demand_factor('temple')),
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'total_shares', c.total_shares, 'share_price', c.share_price,
        'base_gross', public._corp_daily_gross(c.id),
        'efficiency', public._corp_efficiency(c.id),
        'sector_mult', public._corp_sector_mult(c.id),
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
        'sector_mult', public._corp_sector_mult(c.id),
        'daily_gross', public._corp_daily_net(c.id)))
      from public.corp_shares s join public.corporations c on c.id = s.corp_id
      where s.holder_fid = fid and c.faction_id <> fid), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'corp_id', c.id, 'name', c.name, 'seller', public._fac_name(l.seller_fid),
        'mine', (l.seller_fid = fid), 'shares', l.shares, 'price', l.price,
        'sector_mult', public._corp_sector_mult(c.id),
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
            else 0 end))
      from public.colony_buildings cb left join public.colonies col on col.id=cb.colony_id
      where cb.faction_id = fid and cb.id not in (select building_id from public.corp_buildings)), '[]'::jsonb)
  );
end$$;

-- ── Права ───────────────────────────────────────────────────────────────────
revoke all on function public._demand_factor(text)      from public;
revoke all on function public._corp_sector_mult(uuid)    from public;
revoke all on function public.corp_fix()                 from public;
revoke all on function public.corp_create(text,jsonb)    from public;
revoke all on function public.corps_status()             from public;
grant execute on function public._demand_factor(text)    to anon, authenticated;
grant execute on function public._corp_sector_mult(uuid)  to anon, authenticated;
grant execute on function public.corp_fix()              to anon, authenticated;
grant execute on function public.corp_create(text,jsonb) to authenticated;
grant execute on function public.corps_status()          to authenticated;

-- PostgREST: подхватить новые/изменённые сигнатуры
notify pgrst, 'reload schema';

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select public._demand_factor('mining');   -- >1 при дефиците, <1 при профиците
--    select public._demand_factor('shipyard'); -- растёт с очередью кораблей
-- 2) select jsonb_pretty(corps_status() -> 'demand');   -- множители всех отраслей
-- 3) Корпорация из рудника теперь живая: corp_create('Рудный картель', <id рудников>)
--    → corps_status() -> 'mine' : base_gross>0, sector_mult, daily_gross.
-- 4) Сдвинуть exchange_market.last_fix назад → select corp_fix(); → дивиденды со
--    спросом; share_price дрейфует к фундаменталу.
-- 5) Создать дефицит: update market_resources set stock = stock*0.3; → mining ▲.
