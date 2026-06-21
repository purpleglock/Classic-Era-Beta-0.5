-- ============================================================================
--  БИРЖА · СРЕЗ 4e — ИНДЕКС КОРПОРАЦИЙ + ИСТОРИЯ КОТИРОВОК (живой терминал)
--  Применять в Supabase → SQL Editor ПОСЛЕ _exchange_corp_moderation.sql. Идемпотентно.
--  Зависит от: _exchange_corps.sql (corporations/corp_*), _exchange_demand.sql
--    (_corp_daily_net/_corp_sector_mult), _exchange_corp_moderation.sql
--    (corps_status v3 со статусом — этот срез её НАДМНОЖЕСТВО).
--
--  ИДЕЯ. Чтобы биржа ВЫГЛЯДЕЛА как биржа, нужен живой график. Раньше котировка
--  двигалась только на закрытии сессии (corp_fix) — данных для графика нет.
--  Здесь:
--   1) corp_price_history — снимок котировки каждой одобренной организации по
--      суткам (corp_id=NULL → точка индекса). Питает спарклайны и график индекса.
--   2) corp_index — взвешенный по капитализации индекс корпораций (как S&P),
--      нормирован к 1000 на старте (divisor фиксируется при первом запуске).
--   3) corp_index_tick() — суточный дрейф котировок к фундаменталу (P/E≈20 от
--      дохода со спросом) + рыночный шум ±1.5%, пересчёт индекса, снимок истории.
--      Идемпотентно по целым суткам (corp_index_state.last_tick). Зацеплен в
--      corps_status() на чтении (как market_tick в index_buy) — открыл вкладку →
--      рынок прожил прошедшие дни.
--   4) corps_status v4 (надмножество): + блок 'index' (value/base/spark) и
--      'board' — ВСЕ одобренные организации (тикер/цена/Δ/спрос/спарклайн/аск),
--      + 'spark' у моих организаций.
-- ============================================================================

-- ── 1) История котировок (corp_id=NULL → точка корпоративного индекса) ───────
create table if not exists public.corp_price_history (
  id      bigserial primary key,
  corp_id uuid,
  price   numeric not null,
  at      timestamptz not null default now()
);
create index if not exists cph_corp_at on public.corp_price_history(corp_id, at desc);
alter table public.corp_price_history enable row level security;
-- чтение/запись только через SECURITY DEFINER RPC

-- ── 2) Индекс корпораций (взвешенная капитализация, нормировка к 1000) ───────
create table if not exists public.corp_index (
  id         int primary key default 1,
  value      numeric not null default 1000,
  base_value numeric not null default 1000,
  divisor    numeric not null default 0,    -- фиксируется при первом запуске (cap→1000)
  updated_at timestamptz not null default now()
);
insert into public.corp_index(id) values(1) on conflict (id) do nothing;
alter table public.corp_index enable row level security;

create table if not exists public.corp_index_state (
  id        int primary key default 1,
  last_tick timestamptz not null default now()
);
insert into public.corp_index_state(id) values(1) on conflict (id) do nothing;
alter table public.corp_index_state enable row level security;

-- ── Текущая капитализация одобренного рынка (Σ цена×доли) ────────────────────
create or replace function public._corp_market_cap()
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(sum(greatest(share_price,0) * greatest(total_shares,0)), 0)::numeric
  from public.corporations where status = 'approved'
$$;

-- ── Фундаментал котировки (P/E≈20 от дохода со спросом×синергией), на 1 долю ──
create or replace function public._corp_fundamental(p_corp uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select round(public._corp_daily_net(p_corp) * 20.0
             / greatest((select total_shares from public.corporations where id = p_corp), 1), 2)
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  corp_index_tick() — суточный дрейф котировок + индекс + снимок истории.
--  Идемпотентно по целым суткам. Зацеплено в corps_status() (на чтении).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.corp_index_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare stt public.corp_index_state; d int; i int; ts timestamptz; cap numeric; div numeric; val numeric;
begin
  select * into stt from public.corp_index_state where id = 1 for update;
  if not found then
    insert into public.corp_index_state(id, last_tick) values(1, now()) on conflict (id) do nothing;
    select * into stt from public.corp_index_state where id = 1 for update;
  end if;
  d := floor(extract(epoch from (now() - stt.last_tick)) / 86400.0);
  if d < 1 then return jsonb_build_object('ok', true, 'days', 0); end if;
  d := least(d, 30);

  for i in 1..d loop
    ts := stt.last_tick + (i || ' days')::interval;
    -- дрейф котировки к фундаменталу (85/15) + рыночный шум ±1.5%
    update public.corporations c set
      share_price = round(greatest(1,
        (case when c.share_price > 0 then c.share_price else public._corp_fundamental(c.id) end) * 0.85
        + public._corp_fundamental(c.id) * 0.15) * (0.985 + random()*0.03), 2)
    where c.status = 'approved' and c.total_shares > 0;

    -- зафиксировать divisor при первом ненулевом cap → индекс стартует с 1000
    cap := public._corp_market_cap();
    select divisor into div from public.corp_index where id = 1;
    if (div is null or div <= 0) and cap > 0 then
      div := cap;
      update public.corp_index set divisor = div where id = 1;
    end if;
    val := case when div > 0 then round(1000 * cap / div, 2) else 1000 end;
    update public.corp_index set value = val, updated_at = ts where id = 1;

    -- снимок: котировки всех одобренных + точка индекса (corp_id=NULL)
    insert into public.corp_price_history(corp_id, price, at)
      select id, share_price, ts from public.corporations where status = 'approved' and total_shares > 0;
    insert into public.corp_price_history(corp_id, price, at) values (null, val, ts);
  end loop;

  -- обрезка до 60 точек на инструмент (включая индекс corp_id=NULL)
  delete from public.corp_price_history h using (
    select id, row_number() over (partition by corp_id order by at desc) rn
    from public.corp_price_history
  ) x where h.id = x.id and x.rn > 60;

  update public.corp_index_state set last_tick = last_tick + (d || ' days')::interval where id = 1;
  return jsonb_build_object('ok', true, 'days', d, 'value', val);
end$$;
revoke all on function public.corp_index_tick() from public;
grant execute on function public.corp_index_tick() to anon, authenticated;

-- ── Спарклайн инструмента (последние n точек, по возрастанию времени) ────────
create or replace function public._corp_spark(p_corp uuid, p_n int default 24)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce((select jsonb_agg(price order by at)
    from (select price, at from public.corp_price_history
          where corp_id is not distinct from p_corp order by at desc limit p_n) z), '[]'::jsonb)
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  corps_status v4 — НАДМНОЖЕСТВО версии из _exchange_corp_moderation.sql.
--  Сохранены 'demand'/sector_mult («-- СПРОС») и поля модерации («-- МОД:»).
--  Добавлены 'index', 'board' и 'spark' у моих организаций («-- ИНДЕКС»).
-- ════════════════════════════════════════════════════════════════════════════
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
        'description', c.description, 'image_url', c.image_url,                 -- МОД:
        'status', c.status, 'pending_review', c.pending_review,                -- МОД:
        'pending', c.pending, 'reject_reason', c.reject_reason,                -- МОД:
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
        'description', case when c.status='approved' then c.description else null end,  -- МОД:
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
            else 0 end))
      from public.colony_buildings cb left join public.colonies col on col.id=cb.colony_id
      where cb.faction_id = fid and cb.id not in (select building_id from public.corp_buildings)), '[]'::jsonb)
  );
end$$;
revoke all on function public.corps_status() from public;
grant execute on function public.corps_status() to authenticated;

-- ── Бэкафилл: одна стартовая точка истории, чтобы график был сразу не пустой ─
do $$ begin
  -- зафиксировать divisor от текущей капитализации (индекс = 1000 на старте)
  update public.corp_index set divisor = public._corp_market_cap()
    where id = 1 and (divisor is null or divisor <= 0) and public._corp_market_cap() > 0;
  insert into public.corp_price_history(corp_id, price, at)
    select id, share_price, now() from public.corporations where status='approved' and total_shares > 0
    on conflict do nothing;
  insert into public.corp_price_history(corp_id, price, at)
    values (null, (select value from public.corp_index where id=1), now());
exception when others then null; end $$;

notify pgrst, 'reload schema';

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select corp_index_tick();          -- days>0 при первом прогоне (двигает котировки)
-- 2) Сдвинуть corp_index_state.last_tick на -10 дней → select corp_index_tick(); → 10 точек
-- 3) select jsonb_pretty(corps_status() -> 'index');   -- value/base/spark
-- 4) select jsonb_pretty(corps_status() -> 'board');   -- вся доска котировок
