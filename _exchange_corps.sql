-- ============================================================================
--  БИРЖА · СРЕЗ 4a — КОРПОРАЦИИ (бандл реальных построек) + СЕССИИ + ДИВИДЕНДЫ
--  Применять в Supabase → SQL Editor ПОСЛЕ _exchange_bonds.sql. Идемпотентно.
--  Зависит от: _exchange_bonds.sql (market_tick тело), _security_money.sql
--    (_ec_my_fid), _economy_setup.sql (faction_economy, colony_buildings,
--    colonies, _fac_name), _news_mentions.sql (_post_life_news).
--
--  ИДЕЯ (поправка юзера — биржа «не из вакуума», см. видение).
--  КОРПОРАЦИЯ — государственная организация, которая ОБЪЕДИНЯЕТ реальные
--  постройки державы. Её акции делятся на доли (total_shares); учредитель
--  изначально держит все. Доход вложенных построек НЕ оседает в казне —
--  на ЗАКРЫТИИ ТОРГОВ он списывается из казны учредителя и раздаётся
--  ДИВИДЕНДАМИ всем акционерам пропорционально долям (держава получает свою
--  долю как акционер). Акции продаются другим фракциям через стакан listings,
--  но ТОЛЬКО когда торги открыты.
--
--  СЕССИИ ТОРГОВ — биржа открыта в окне реального времени [open_hour, close_hour)
--  UTC. Открытие/закрытие пишется в ленту новостей. На закрытии — фиксинг
--  (дивиденды). Переход фазы ловит exchange_session_sync(): часовой pg_cron +
--  хук в market_tick (на заходе игрока). Идемпотентно.
--
--  Диверсия дохода сделана НЕИНВАЗИВНО: economy_accrue НЕ трогаем (её живая
--  версия переписана множеством слайсов). corp_fix() сам считает валовую
--  выручку построек по зеркальным рейтам и списывает из казны (clamp: в
--  дефиците платит частично). Рейты — зеркало economy_accrue (_faith_multi):
--  factory×200, trade×100, temple×150 ГС/слот/сутки (прочие btype → 0 дивид.).
-- ============================================================================

-- ── Корпорации ──────────────────────────────────────────────────────────────
create table if not exists public.corporations (
  id           uuid primary key default gen_random_uuid(),
  faction_id   text not null,                 -- учредитель-держава
  founder_name text,
  name         text not null,
  total_shares int  not null default 1000,
  share_price  numeric not null default 0,    -- последняя котировка за 1 акцию
  created_at   timestamptz not null default now()
);
create index if not exists corp_fac on public.corporations(faction_id);
alter table public.corporations enable row level security;

-- Постройки внутри корпорации (одна постройка — максимум в одной корпорации)
create table if not exists public.corp_buildings (
  building_id uuid primary key references public.colony_buildings(id) on delete cascade,
  corp_id     uuid not null references public.corporations(id) on delete cascade,
  added_at    timestamptz not null default now()
);
create index if not exists corpb_corp on public.corp_buildings(corp_id);
alter table public.corp_buildings enable row level security;

-- Реестр акционеров (cap table)
create table if not exists public.corp_shares (
  corp_id    uuid not null references public.corporations(id) on delete cascade,
  holder_fid text not null,
  shares     int  not null,
  primary key (corp_id, holder_fid)
);
create index if not exists corps_holder on public.corp_shares(holder_fid);
alter table public.corp_shares enable row level security;

-- Стакан продаж акций (эскроу: выставленные акции списаны с продавца)
create table if not exists public.corp_listings (
  id         uuid primary key default gen_random_uuid(),
  corp_id    uuid not null references public.corporations(id) on delete cascade,
  seller_fid text not null,
  shares     int  not null,
  price      numeric not null,             -- цена за 1 акцию
  created_at timestamptz not null default now()
);
create index if not exists corpl_corp on public.corp_listings(corp_id);
alter table public.corp_listings enable row level security;

-- Параметры/состояние биржевой сессии
create table if not exists public.exchange_market (
  id         int primary key default 1,
  open_hour  int not null default 12,        -- окно [open_hour, close_hour) UTC
  close_hour int not null default 18,
  phase      text not null default 'closed', -- последняя объявленная фаза: open|closed
  last_fix   timestamptz not null default now()
);
insert into public.exchange_market(id) values(1) on conflict (id) do nothing;
alter table public.exchange_market enable row level security;
-- Все эти таблицы: чтение и запись через SECURITY DEFINER RPC (corps_status и пр.)

-- ── Открыты ли торги сейчас (по окну UTC) ───────────────────────────────────
create or replace function public.exchange_is_open()
returns boolean language sql stable as $$
  select case
    when m.open_hour = m.close_hour then false                       -- окно нулевое = закрыто
    when m.open_hour < m.close_hour
      then extract(hour from (now() at time zone 'UTC'))::int >= m.open_hour
       and extract(hour from (now() at time zone 'UTC'))::int <  m.close_hour
    else extract(hour from (now() at time zone 'UTC'))::int >= m.open_hour       -- окно через полночь
      or  extract(hour from (now() at time zone 'UTC'))::int <  m.close_hour
  end
  from public.exchange_market m where m.id = 1
$$;

-- ── Валовая выручка построек корпорации в сутки (зеркало рейтов accrue) ──────
create or replace function public._corp_daily_gross(p_corp uuid)
returns numeric language sql stable as $$
  select coalesce(sum(case cb.btype
            when 'factory' then cb.slots_open * 200
            when 'trade'   then cb.slots_open * 100
            when 'temple'  then cb.slots_open * 150
            else 0 end), 0)::numeric
  from public.corp_buildings x
  join public.colony_buildings cb on cb.id = x.building_id
  where x.corp_id = p_corp
$$;

-- ── СИНЕРГИЯ организации: бонус эффективности от числа вложенных построек.
--    Это и есть «выхлоп»: объединённые постройки приносят БОЛЬШЕ, чем по
--    отдельности. +3% за постройку, потолок +30%. Распределяется как дивиденд,
--    т.е. учредитель (100% долей) получает свой доход уже увеличенным. ──
create or replace function public._corp_efficiency(p_corp uuid)
returns numeric language sql stable as $$
  select least(0.30, count(*)::numeric * 0.03)
  from public.corp_buildings where corp_id = p_corp
$$;

-- ── Чистая распределяемая выручка/сутки = валовая × (1 + синергия) ───────────
create or replace function public._corp_daily_net(p_corp uuid)
returns numeric language sql stable as $$
  select round(public._corp_daily_gross(p_corp) * (1 + public._corp_efficiency(p_corp)), 2)
$$;

-- ── Право учреждать организации: только «корпоративные» державы. Учреждать
--    может держава с формой правления Корпоратократия/Олигархия ЛИБО режимом
--    Плутократический/Олигархический. Покупать доли могут все. ──
create or replace function public._corp_can_found(p_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.faction_applications
    where faction_id = p_fid and status = 'approved'
      and ( gov    in ('Корпоратократия','Олигархия')
         or regime in ('Плутократический','Олигархический') )
  )
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  corp_fix() — дивидендный фиксинг. Идемпотентно по суткам (exchange_market.
--  last_fix). Для каждой корпорации: gross = дневная выручка × сутки; списать
--  из казны учредителя (clamp), раздать акционерам по долям; обновить котировку.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.corp_fix()
returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.exchange_market; d int; co record; sh record;
        gross numeric; eff numeric; take numeric; payout numeric; owner_gc numeric; tot int; paid int := 0;
begin
  select * into m from public.exchange_market where id = 1 for update;
  if not found then return jsonb_build_object('ok', true, 'days', 0); end if;
  d := floor(extract(epoch from (now() - m.last_fix)) / 86400.0);
  if d < 1 then return jsonb_build_object('ok', true, 'days', 0); end if;
  d := least(d, 30);

  for co in select * from public.corporations loop
    -- фундаментальная котировка-ориентир (P/E≈20 от ЧИСТОЙ выручки), если не было сделок
    if co.share_price = 0 and co.total_shares > 0 then
      update public.corporations
         set share_price = round(public._corp_daily_net(co.id) * 20.0 / co.total_shares, 2)
       where id = co.id;
    end if;

    gross := public._corp_daily_gross(co.id) * d;     -- база: что accrue уже заплатил учредителю
    if gross <= 0 then continue; end if;

    select gc into owner_gc from public.faction_economy where faction_id = co.faction_id for update;
    if owner_gc is null then continue; end if;
    take := least(gross, greatest(0, owner_gc));       -- в дефиците изымаем частично
    if take <= 0 then continue; end if;

    select coalesce(sum(shares),0) into tot from public.corp_shares where corp_id = co.id;
    if tot <= 0 then continue; end if;

    eff    := public._corp_efficiency(co.id);          -- СИНЕРГИЯ: бонус сверх изъятого
    payout := floor(take * (1 + eff));                 -- раздаём БОЛЬШЕ, чем изъяли (выхлоп организации)

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

-- ════════════════════════════════════════════════════════════════════════════
--  exchange_session_sync() — ловит переход фазы окна; пишет в ленту; на
--  закрытии запускает фиксинг. Идемпотентно (действует только при смене фазы).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.exchange_session_sync()
returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.exchange_market; cur text; changed boolean := false;
begin
  select * into m from public.exchange_market where id = 1 for update;
  if not found then return jsonb_build_object('ok', true); end if;
  cur := case when public.exchange_is_open() then 'open' else 'closed' end;
  if cur = m.phase then return jsonb_build_object('ok', true, 'phase', cur, 'changed', false); end if;

  update public.exchange_market set phase = cur where id = 1;
  changed := true;
  if cur = 'open' then
    begin perform public._post_life_news(
      '📈 Биржа: торги открылись',
      format('Галактическая биржа открыла сессию. До закрытия (%s:00 UTC) фракции торгуют долями корпораций.', m.close_hour),
      'rgba(95,201,138,0.55)', '[]'::jsonb); exception when others then null; end;
  else
    perform public.corp_fix();   -- закрытие → дивидендный фиксинг
    begin perform public._post_life_news(
      '📉 Биржа: торги закрыты — фиксинг',
      'Сессия завершена. Корпорации выплатили дивиденды акционерам по итогам дня.',
      'rgba(224,104,138,0.45)', '[]'::jsonb); exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'phase', cur, 'changed', changed);
end$$;

-- ── Хук сессии в market_tick(): тело из _exchange_bonds.sql + session_sync ───
create or replace function public.market_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare st public.market_state; d int; i int; shocked boolean := false;
begin
  begin perform public.bonds_settle();          exception when others then null; end;  -- облигации
  begin perform public.exchange_session_sync(); exception when others then null; end;  -- сессии биржи: open/close + фиксинг

  select * into st from public.market_state where id = 1 for update;
  if not found then
    insert into public.market_state(id, last_tick) values(1, now()) on conflict (id) do nothing;
    select * into st from public.market_state where id = 1 for update;
  end if;
  d := floor(extract(epoch from (now() - st.last_tick)) / 86400.0);
  if d < 1 then return jsonb_build_object('ok', true, 'days', 0); end if;
  d := least(d, 30);

  for i in 1..d loop
    update public.market_resources
       set stock = greatest(1, stock + npc_supply*(0.6+random()*0.8) - npc_demand*(0.6+random()*0.8));
    update public.market_resources
       set stock = greatest(1, stock * (0.96 + random()*0.08));
    update public.market_resources
       set stock = stock + (equilibrium - stock) * 0.08;
  end loop;

  if random() < least(0.6, 0.12 * d) then
    perform public._market_shock();
    shocked := true;
  end if;

  update public.market_resources
     set price = public._market_price_calc(base_price, stock, equilibrium),
         updated_at = now();
  update public.market_index set value = public._market_index_value(), updated_at = now() where id = 1;

  insert into public.market_price_history(name, price, stock, at)
    select name, price, stock, now() from public.market_resources;
  insert into public.market_price_history(name, price, stock, at)
    select '__INDEX__', value, 0, now() from public.market_index where id = 1;
  delete from public.market_price_history h using (
    select id, row_number() over (partition by name order by at desc) rn
    from public.market_price_history
  ) x where h.id = x.id and x.rn > 60;

  update public.market_state set last_tick = last_tick + (d || ' days')::interval where id = 1;
  return jsonb_build_object('ok', true, 'days', d, 'shock', shocked);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  corp_create() — учредить корпорацию из своих построек (p_buildings = jsonb
--  массив id построек). Учредитель получает все акции.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.corp_create(p_name text, p_buildings jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; nm text; v_id uuid; bid uuid; cnt int; n_added int := 0;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_name is null or length(btrim(p_name)) < 2 then raise exception 'bad name'; end if;
  fid := public._ec_my_fid();
  if not public._corp_can_found(fid) then
    raise exception 'only corporate states may found organizations';   -- Корпоратократия/Олигархия или Плутократ./Олигарх. режим
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
      -- постройка должна быть моей и ещё не в корпорации
      perform 1 from public.colony_buildings where id = bid and faction_id = fid;
      if not found then continue; end if;
      perform 1 from public.corp_buildings where building_id = bid;
      if found then continue; end if;
      insert into public.corp_buildings(building_id, corp_id) values (bid, v_id);
      n_added := n_added + 1;
    end loop;
  end if;

  -- стартовая котировка-ориентир (P/E≈20 от чистой выручки с синергией)
  update public.corporations
     set share_price = round(public._corp_daily_net(v_id) * 20.0 / greatest(total_shares,1), 2)
   where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'buildings', n_added);
end$$;

-- ── Добавить/убрать постройку из своей корпорации ───────────────────────────
create or replace function public.corp_building_set(p_corp uuid, p_building uuid, p_add boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  perform 1 from public.corporations where id = p_corp and faction_id = fid;
  if not found then raise exception 'not your corporation'; end if;
  perform 1 from public.colony_buildings where id = p_building and faction_id = fid;
  if not found then raise exception 'not your building'; end if;
  if p_add then
    perform 1 from public.corp_buildings where building_id = p_building;
    if found then raise exception 'building already in a corporation'; end if;
    insert into public.corp_buildings(building_id, corp_id) values (p_building, p_corp);
  else
    delete from public.corp_buildings where building_id = p_building and corp_id = p_corp;
  end if;
  return jsonb_build_object('ok', true);
end$$;

-- ── Распустить корпорацию (только если учредитель держит все акции) ──────────
create or replace function public.corp_dissolve(p_corp uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; co public.corporations; mine int; tot int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into co from public.corporations where id = p_corp for update;
  if not found then raise exception 'no corporation'; end if;
  if co.faction_id <> fid then raise exception 'not your corporation'; end if;
  select coalesce(sum(shares),0) into tot  from public.corp_shares where corp_id = p_corp;
  select coalesce(shares,0)      into mine from public.corp_shares where corp_id = p_corp and holder_fid = fid;
  if mine < tot then raise exception 'outside shareholders exist'; end if;   -- нельзя бросить акционеров
  if exists(select 1 from public.corp_listings where corp_id = p_corp) then raise exception 'active listings'; end if;
  delete from public.corporations where id = p_corp;   -- cascade чистит buildings/shares
  return jsonb_build_object('ok', true);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  Торг акциями: выставить (эскроу) / снять / купить. Покупка — только в сессию.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.corp_list_shares(p_corp uuid, p_shares int, p_price numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; have int; v_id uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_shares is null or p_shares < 1 then raise exception 'bad shares'; end if;
  if p_price is null or p_price < 1 then raise exception 'bad price'; end if;
  fid := public._ec_my_fid();
  select shares into have from public.corp_shares where corp_id = p_corp and holder_fid = fid for update;
  if have is null or have < p_shares then raise exception 'not enough shares'; end if;
  -- эскроу: списываем акции с продавца в листинг
  update public.corp_shares set shares = shares - p_shares where corp_id = p_corp and holder_fid = fid;
  delete from public.corp_shares where corp_id = p_corp and holder_fid = fid and shares <= 0;
  insert into public.corp_listings(corp_id, seller_fid, shares, price)
    values (p_corp, fid, p_shares, floor(p_price)) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end$$;

create or replace function public.corp_cancel_listing(p_listing uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; l public.corp_listings;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into l from public.corp_listings where id = p_listing for update;
  if not found then raise exception 'no listing'; end if;
  if l.seller_fid <> fid then raise exception 'not your listing'; end if;
  insert into public.corp_shares(corp_id, holder_fid, shares) values (l.corp_id, fid, l.shares)
    on conflict (corp_id, holder_fid) do update set shares = public.corp_shares.shares + excluded.shares;
  delete from public.corp_listings where id = p_listing;
  return jsonb_build_object('ok', true);
end$$;

create or replace function public.corp_buy_shares(p_listing uuid, p_shares int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; l public.corp_listings; eco public.faction_economy; cost numeric; take int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if not public.exchange_is_open() then raise exception 'market closed'; end if;   -- только в сессию
  if p_shares is null or p_shares < 1 then raise exception 'bad shares'; end if;
  fid := public._ec_my_fid();
  select * into l from public.corp_listings where id = p_listing for update;
  if not found then raise exception 'no listing'; end if;
  if l.seller_fid = fid then raise exception 'cannot buy own listing'; end if;
  take := least(p_shares, l.shares);
  cost := take * l.price;

  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  if eco.gc < cost then raise exception 'not enough GC'; end if;

  update public.faction_economy set gc = gc - cost where faction_id = fid;
  update public.faction_economy set gc = gc + cost where faction_id = l.seller_fid;
  insert into public.corp_shares(corp_id, holder_fid, shares) values (l.corp_id, fid, take)
    on conflict (corp_id, holder_fid) do update set shares = public.corp_shares.shares + excluded.shares;
  update public.corp_listings set shares = shares - take where id = p_listing;
  delete from public.corp_listings where id = p_listing and shares <= 0;
  update public.corporations set share_price = l.price where id = l.corp_id;   -- котировка = последняя сделка

  return jsonb_build_object('ok', true, 'shares', take, 'cost', cost);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  corps_status() — данные для UI «Корпорации».
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
        'daily_gc', case cb.btype when 'factory' then cb.slots_open*200 when 'trade' then cb.slots_open*100
                     when 'temple' then cb.slots_open*150 else 0 end))
      from public.colony_buildings cb left join public.colonies col on col.id=cb.colony_id
      where cb.faction_id = fid and cb.id not in (select building_id from public.corp_buildings)), '[]'::jsonb)
  );
end$$;

-- ── Часовой pg_cron: синхронизация сессии (open/close + фиксинг) ─────────────
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      if exists (select 1 from cron.job where jobname = 'exchange-session-sync') then
        perform cron.unschedule('exchange-session-sync');
      end if;
      perform cron.schedule('exchange-session-sync', '2 * * * *', 'select public.exchange_session_sync();');
      raise notice 'pg_cron: exchange_session_sync запланирован (каждый час :02)';
    exception when others then
      raise notice 'pg_cron для биржевых сессий настроить не удалось (%) — переход фазы поймает заход игрока', sqlerrm;
    end;
  else
    raise notice 'pg_cron недоступен — переход фазы сессии поймает заход игрока (market_tick)';
  end if;
end$$;

-- ── Права ───────────────────────────────────────────────────────────────────
revoke all on function public.market_tick()                       from public;
revoke all on function public.corp_fix()                          from public;
revoke all on function public.exchange_session_sync()             from public;
revoke all on function public.exchange_is_open()                  from public;
revoke all on function public.corp_create(text,jsonb)             from public;
revoke all on function public.corp_building_set(uuid,uuid,boolean) from public;
revoke all on function public.corp_dissolve(uuid)                 from public;
revoke all on function public.corp_list_shares(uuid,int,numeric)  from public;
revoke all on function public.corp_cancel_listing(uuid)           from public;
revoke all on function public.corp_buy_shares(uuid,int)           from public;
revoke all on function public.corps_status()                      from public;
grant execute on function public.market_tick()                       to anon, authenticated;
grant execute on function public.corp_fix()                          to anon, authenticated;
grant execute on function public.exchange_session_sync()             to anon, authenticated;
grant execute on function public.exchange_is_open()                  to anon, authenticated;
grant execute on function public.corp_create(text,jsonb)             to authenticated;
grant execute on function public.corp_building_set(uuid,uuid,boolean) to authenticated;
grant execute on function public.corp_dissolve(uuid)                 to authenticated;
grant execute on function public.corp_list_shares(uuid,int,numeric)  to authenticated;
grant execute on function public.corp_cancel_listing(uuid)           to authenticated;
grant execute on function public.corp_buy_shares(uuid,int)           to authenticated;
grant execute on function public.corps_status()                      to authenticated;

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) Окно по умолчанию 12–18 UTC. Тест без ожидания: update exchange_market
--      set open_hour=0, close_hour=24 where id=1;  → select exchange_is_open() = true
-- 2) select corp_create('Орбитальный консорциум', (select jsonb_agg(id) from
--      colony_buildings where faction_id='<мой fid>' and btype in ('factory','trade','temple')));
-- 3) select corps_status();  -- моя корпорация, free_buildings, сессия
-- 4) select corp_list_shares('<corp_id>', 200, 50);  -- выставить 200 акций по 50
-- 5) (другой фракцией, при открытых торгах) select corp_buy_shares('<listing_id>', 200);
-- 6) Сдвинуть exchange_market.last_fix назад → select corp_fix(); → дивиденды акционерам
-- 7) Закрыть окно (close_hour=прошлый час) → select exchange_session_sync(); → новость+фиксинг
