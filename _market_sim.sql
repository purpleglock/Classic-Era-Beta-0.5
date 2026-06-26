-- ============================================================================
--  ГАЛАКТИЧЕСКИЙ РЫНОК · СРЕЗ 2 — СИМУЛЯЦИЯ + ИНДЕКС/ETF
--  Применять в Supabase → SQL Editor ПОСЛЕ _market_setup.sql. Идемпотентно.
--  Зависит от: _market_setup.sql (market_resources / market_state /
--    market_price_history / _market_price_calc / market_tick), _news_mentions.sql
--    (_post_life_news — хроника сектора), _security_money.sql (_ec_my_fid).
--
--  ИДЕЯ. Срез 1 дал живые цены и суточный дрейф. Срез 2 добавляет:
--   1) СОБЫТИЙНЫЕ ШОКИ — раз в несколько ходов рынок встряхивает событие
--      (война → металлы дороже, открытие месторождения → редкий дешевле,
--       бум/рецессия → широкий сдвиг). Шок двигает запас → цену и пишет
--       строку в «Хронику сектора» (лента новостей).
--   2) Повышенная волатильность суточного блуждания.
--   3) ИНДЕКС РЫНКА (ETF) — взвешенная корзина живых цен, нормированная к 1000
--      на старте. Игрок может «вложиться в рынок целиком»: index_buy тратит ГС
--      на паи по текущему значению индекса, index_sell продаёт паи обратно.
--      Прибыль/убыток = движение всего рынка. История индекса (имя '__INDEX__'
--      в market_price_history) питает спарклайн.
-- ============================================================================

-- ── Таблица индекса (одна строка) ───────────────────────────────────────────
create table if not exists public.market_index (
  id         int primary key default 1,
  value      numeric not null default 1000,   -- текущее значение индекса
  base_value numeric not null default 1000,   -- стартовый якорь (= 1000)
  updated_at timestamptz not null default now()
);
insert into public.market_index(id, value, base_value) values(1, 1000, 1000) on conflict (id) do nothing;
alter table public.market_index enable row level security;
drop policy if exists "mi_sel" on public.market_index;
create policy "mi_sel" on public.market_index for select to public using (true);
-- запись — только через SECURITY DEFINER market_tick()

-- ── Позиции игроков в индексе (ETF). Чтение/запись только через RPC. ─────────
create table if not exists public.index_holdings (
  faction_id text primary key,
  units      numeric not null default 0,   -- паёв на руках
  basis      numeric not null default 0,   -- суммарно вложено ГС (для P/L)
  updated_at timestamptz not null default now()
);
alter table public.index_holdings enable row level security;
-- RLS без политик: клиентский доступ закрыт, позиции отдаёт exchange_status()

-- ── Значение индекса = взвешенная корзина (price/base), вес = «капитализация
--    флоата» equilibrium*base_price; нормировка ×1000 (на старте price=base → 1000) ─
create or replace function public._market_index_value()
returns numeric language sql stable as $$
  select round( 1000 * coalesce(
      sum( (price / nullif(base_price,0)) * (equilibrium * base_price) )
      / nullif(sum(equilibrium * base_price), 0), 1.0), 2)::numeric
  from public.market_resources
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  Событийный шок рынка: один случайный сценарий двигает запас → цену,
--  публикует строку в «Хронику сектора». Best-effort (сбой новости не валит тик).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._market_shock()
returns void language plpgsql security definer set search_path=public as $$
declare kind int; tgt text; v_title text; v_body text; v_color text;
begin
  kind := floor(random()*4)::int;   -- 0..3
  if kind = 0 then
    -- ВОЙНА: металлы/изотопы в дефиците (спрос → запас вниз → цена вверх)
    update public.market_resources set stock = greatest(1, stock * (0.55 + random()*0.15))
      where name in ('Железо','Титан','Медь','Платина','Изотопы','Дейтерий');
    v_title := '⚔ Военный спрос вздул цены на металлы';
    v_body  := 'Эскалация в секторе: верфи и арсеналы скупают железо, титан и платину. Котировки металлов резко пошли вверх.';
    v_color := 'rgba(224,104,138,0.55)';
  elsif kind = 1 then
    -- ОТКРЫТИЕ: случайный редкий/легендарный ресурс — избыток (запас вверх → цена вниз)
    select name into tgt from public.market_resources
      where name in (select name from public.resource_rarity where rarity in ('rare','epic','legendary'))
      order by random() limit 1;
    if tgt is null then return; end if;
    update public.market_resources set stock = stock * (1.6 + random()*0.8) where name = tgt;
    v_title := '⛏ Открыто богатое месторождение: ' || tgt;
    v_body  := format('Разведчики наткнулись на крупную залежь — рынок «%s» захлестнуло предложением, цена просела.', tgt);
    v_color := 'rgba(95,201,138,0.55)';
  elsif kind = 2 then
    -- ТОРГОВЫЙ БУМ: общий спрос (запас слегка вниз → цены вверх широким фронтом)
    update public.market_resources set stock = greatest(1, stock * (0.82 + random()*0.10)) where true;
    v_title := '📈 Торговый бум в секторе';
    v_body  := 'Оживление караванных путей подняло спрос по всей номенклатуре — цены подросли широким фронтом.';
    v_color := 'rgba(201,162,39,0.55)';
  else
    -- РЕЦЕССИЯ: общий избыток (запас вверх → цены вниз)
    update public.market_resources set stock = stock * (1.12 + random()*0.12) where true;
    v_title := '📉 Спад спроса накрыл рынки';
    v_body  := 'Снижение деловой активности оставило склады переполненными — котировки поползли вниз по всему рынку.';
    v_color := 'rgba(120,150,190,0.55)';
  end if;
  -- пересчёт цен от нового запаса
  update public.market_resources
     set price = public._market_price_calc(base_price, stock, equilibrium), updated_at = now()
   where true;
  begin perform public._post_life_news(v_title, v_body, v_color, '[]'::jsonb); exception when others then null; end;
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  market_tick() — пересобрана: суточный дрейф + повышенная волатильность +
--  событийный шок (раз в прогон, вероятность растёт с числом пропущенных суток)
--  + пересчёт индекса и снимок истории (ресурсы + '__INDEX__'). Идемпотентно.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.market_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare st public.market_state; d int; i int; shocked boolean := false;
begin
  select * into st from public.market_state where id = 1 for update;
  if not found then
    insert into public.market_state(id, last_tick) values(1, now()) on conflict (id) do nothing;
    select * into st from public.market_state where id = 1 for update;
  end if;
  d := floor(extract(epoch from (now() - st.last_tick)) / 86400.0);
  if d < 1 then return jsonb_build_object('ok', true, 'days', 0); end if;
  d := least(d, 30);   -- защита от гигантского простоя

  for i in 1..d loop
    -- NPC спрос/предложение + случайное блуждание (каждая сторона ±40%)
    update public.market_resources
       set stock = greatest(1, stock + npc_supply*(0.6+random()*0.8) - npc_demand*(0.6+random()*0.8));
    -- усиленная волатильность: дополнительный мультипликативный шум ±4%/сутки
    update public.market_resources
       set stock = greatest(1, stock * (0.96 + random()*0.08));
    -- медленный возврат запаса к равновесию (mean reversion)
    update public.market_resources
       set stock = stock + (equilibrium - stock) * 0.08;
  end loop;

  -- событийный шок: один раз за прогон; шанс растёт с простоем (cap 60%)
  if random() < least(0.6, 0.12 * d) then
    perform public._market_shock();
    shocked := true;
  end if;

  -- пересчёт цены от итогового запаса
  update public.market_resources
     set price = public._market_price_calc(base_price, stock, equilibrium),
         updated_at = now();

  -- пересчёт индекса рынка
  update public.market_index set value = public._market_index_value(), updated_at = now() where id = 1;

  -- снимок истории (ресурсы + индекс) + обрезка до 60 точек на имя
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
--  ETF: купить паи индекса на p_gc ГС по текущему значению индекса
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.index_buy(p_gc numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; val numeric; units numeric; spend bigint;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_gc is null or p_gc < 1 then raise exception 'bad amount'; end if;
  spend := floor(p_gc);
  fid := public._ec_my_fid();
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  if eco.gc < spend then raise exception 'not enough GC'; end if;

  perform public.market_tick();   -- актуализируем индекс перед сделкой
  select value into val from public.market_index where id = 1;
  if val is null or val <= 0 then raise exception 'no index'; end if;
  units := spend / val;

  update public.faction_economy set gc = gc - spend where faction_id = fid;
  insert into public.index_holdings(faction_id, units, basis, updated_at)
    values (fid, units, spend, now())
    on conflict (faction_id) do update
      set units = public.index_holdings.units + excluded.units,
          basis = public.index_holdings.basis + excluded.basis,
          updated_at = now();

  return jsonb_build_object('ok', true, 'units', round(units,4), 'value', val, 'spent', spend);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  ETF: продать p_units паёв по текущему значению индекса (P/L по basis)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.index_sell(p_units numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; h public.index_holdings; val numeric; proceeds bigint; basis_out numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_units is null or p_units <= 0 then raise exception 'bad units'; end if;
  fid := public._ec_my_fid();
  select * into h from public.index_holdings where faction_id = fid for update;
  if not found or h.units < p_units then raise exception 'not enough units'; end if;

  perform public.market_tick();   -- актуализируем индекс перед сделкой
  select value into val from public.market_index where id = 1;
  if val is null or val <= 0 then raise exception 'no index'; end if;

  proceeds  := floor(p_units * val);
  basis_out := h.basis * (p_units / h.units);   -- доля вложенного, приходящаяся на эти паи

  update public.index_holdings
     set units = units - p_units, basis = greatest(0, basis - basis_out), updated_at = now()
   where faction_id = fid;
  update public.faction_economy set gc = gc + proceeds where faction_id = fid;

  return jsonb_build_object('ok', true, 'proceeds', proceeds, 'value', val,
                            'pl', floor(proceeds - basis_out));
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  exchange_status() — данные для UI «Биржи»: индекс + спарклайн, моя позиция,
--  спарклайны цен по ресурсам (последние точки). Только чтение.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.exchange_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'index', jsonb_build_object(
       'value', (select value from public.market_index where id = 1),
       'base',  (select base_value from public.market_index where id = 1),
       'spark', coalesce((
          select jsonb_agg(price order by at)
          from (select price, at from public.market_price_history
                where name = '__INDEX__' order by at desc limit 24) z), '[]'::jsonb)
    ),
    'holdings', coalesce((
       select jsonb_build_object('units', units, 'basis', basis)
       from public.index_holdings where faction_id = fid),
       jsonb_build_object('units', 0, 'basis', 0)),
    'resources', coalesce((
       select jsonb_object_agg(name, spark)
       from (
         select name, jsonb_agg(price order by at) as spark
         from (
           select name, price, at,
                  row_number() over (partition by name order by at desc) rn
           from public.market_price_history where name <> '__INDEX__') q
         where rn <= 12
         group by name) s), '{}'::jsonb)
  );
end$$;

-- ── Права ───────────────────────────────────────────────────────────────────
revoke all on function public.market_tick()             from public;
revoke all on function public._market_shock()           from public;
revoke all on function public.index_buy(numeric)        from public;
revoke all on function public.index_sell(numeric)       from public;
revoke all on function public.exchange_status()         from public;
grant execute on function public.market_tick()          to anon, authenticated;
grant execute on function public.index_buy(numeric)     to authenticated;
grant execute on function public.index_sell(numeric)    to authenticated;
grant execute on function public.exchange_status()      to authenticated;

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select public._market_index_value();                 -- ≈1000 на свежем рынке
-- 2) select public.market_tick();                          -- days>0 в первый раз, '__INDEX__' в истории
-- 3) Прогнать несколько суток (сдвинуть market_state.last_tick назад) → шоки и
--    строки в faction_news (kind='bulletin', '◈ ХРОНИКА СЕКТОРА').
-- 4) select public.index_buy(10000);  select public.exchange_status();   -- появилась позиция
-- 5) select public.index_sell(1);                          -- proceeds/pl по движению индекса
