-- ============================================================================
--  БИРЖА · ВАРИАНТ 3 — «ЧЕСТНОЕ КАЗИНО» (официальный курс + комиссия + лимиты)
--  Применять в Supabase → SQL Editor ПОСЛЕДНИМ: после _market_setup.sql,
--  _market_sim.sql, ВСЕХ _exchange_*.sql (вкл. _exchange_safeguards.sql) и
--  _goods_off_exchange.sql. Идемпотентно.
--
--  ПРОБЛЕМА, которую закрываем: расчётная цена деривативов/индекса = та же цена,
--  которую игрок САМ двигает спотовыми сделками. Сам качнул → сам выиграл против
--  пула. mark-TWAP это лишь замедлял (за 5 суток курс всё равно утягивался).
--
--  ТРИ ЗАМКА:
--    1. ОФИЦИАЛЬНЫЙ КУРС (ref_price). У каждого ресурса теперь ДВЕ цены:
--         • price     — живой СПОТ («Рынок»), его двигают сделки игроков;
--         • ref_price — ОФИЦИАЛЬНЫЙ биржевой курс, его двигает ТОЛЬКО суточная
--           NPC-симуляция (случайное блуждание + возврат к базе). Игрок на него
--           НЕ влияет ничем. Деривативы и индекс считаются ТОЛЬКО по ref_price.
--       → раскачать курс под свою позицию физически нельзя; трюк «открыл→качнул→
--         закрыл» мёртв (в пределах суток ref_price не двигается).
--    2. КОМИССИЯ ДОМА (vig). Маржа/фьючерс входят по чуть ХУДШЕЙ цене (спред в
--       пользу дома) → матожидание игрока < 0, пул медленно растёт, а не тает.
--       (Индекс уже со спредом 0.5%, опционы — с 0.9 на закрытии.)
--    3. ЛИМИТ ОБЪЁМА. Потолок размера одной спотовой заявки (доля оборота) —
--       «400к за секунду не сбросишь». Крупная заявка к тому же бьёт по своей же
--       цене (проскальзывание — интеграл цены уже был).
-- ============================================================================

-- ── Официальный курс: отдельная цена, которую игрок не двигает ───────────────
alter table public.market_resources add column if not exists ref_price numeric;
alter table public.market_resources add column if not exists ref_drift numeric not null default 0;  -- текущий тренд курса (NPC, игрок не видит/не трогает)
alter table public.market_state     add column if not exists ref_tick timestamptz;                 -- когда официальный курс шагал в последний раз
update public.market_resources set ref_price = coalesce(ref_price, base_price) where true;

-- ════════════════════════════════════════════════════════════════════════════
--  ⚙ БАЛАНС: защита держится на ЯКОРЕ (курс нельзя качнуть), а НЕ на драконовских
--  лимитах. Поэтому комиссия/коридор/лимиты — человеческие, чтобы в игру был
--  СМЫСЛ играть: курс реально движется и ТРЕНДИТ несколько суток (его двигает
--  галактика — дефицит/профицит NPC и шоки), навык = поймать тренд с плечом.
--  Анти-кран спота (потолок заявки/сутки) оставлен — он дёшев и не мешает.
-- ════════════════════════════════════════════════════════════════════════════
-- ── Движение официального курса (NPC, читаемый тренд) ───────────────────────
create or replace function public._ex_ref_vol()     returns numeric language sql immutable as $$ select 0.04::numeric  $$;  -- амплитуда тренда на ШАГ (3 ч) ≈ ±4%
create or replace function public._ex_ref_revert()  returns numeric language sql immutable as $$ select 0.03::numeric  $$;  -- возврат к базе на шаг → тренды дышат, но курс не убегает
create or replace function public._ex_ref_keep()    returns numeric language sql immutable as $$ select 0.75::numeric  $$;  -- шанс, что тренд сохранится на след. шаге → движение тянется ~4 шага (~12ч)
create or replace function public._ex_ref_period_min() returns int   language sql immutable as $$ select 180          $$;  -- курс шагает раз в 3 ЧАСА (не 10 мин) — щадит БД, меньше места эксплойтам
create or replace function public._ex_sent_max()    returns numeric language sql immutable as $$ select 0.012::numeric $$;  -- макс. вклад настроя новостей в тренд за шаг (±1.2% — заметно, но НЕ доминирует над ±4% тренда)
create or replace function public._ex_ref_lo()      returns numeric language sql immutable as $$ select 0.35::numeric  $$;  -- пол курса = base×0.35 (широкий коридор → есть размах)
create or replace function public._ex_ref_hi()      returns numeric language sql immutable as $$ select 2.80::numeric  $$;  -- потолок курса = base×2.80

-- ── Комиссия дома и лимиты — человеческие (защита на якоре, не на удушении) ──
create or replace function public._ex_open_edge()    returns numeric language sql immutable as $$ select 0.005::numeric  $$;  -- комиссия на входе в маржу/фьючерс: 0.5% (×2 плечо → старт ≈ −1%, не −6%)
create or replace function public._ex_spot_max_frac() returns numeric language sql immutable as $$ select 0.15::numeric   $$;  -- потолок ОДНОЙ спот-заявки = 15% оборота (анти-кран спота)
create or replace function public._ex_spot_day_frac() returns numeric language sql immutable as $$ select 0.60::numeric   $$;  -- потолок СУТОЧНОГО объёма спота на державу/ресурс = 60% оборота
create or replace function public._ex_index_spread()  returns numeric language sql immutable as $$ select 0.003::numeric  $$;  -- спред индекса: 0.3% на сторону
-- max_coll / coll_frac / max_open / index_cap / margin_max_lev — оставляем как в
-- _exchange_safeguards.sql (100k / 25% / 6 / 500k / ×2): нормальные, не душат.

-- ── A. MARK = официальный курс (ref_price). Игрок его не двигает. ────────────
create or replace function public._ex_mark(p_name text)
returns numeric language sql stable security definer set search_path=public as $$
  select round(coalesce(
    (select ref_price from public.market_resources where name = p_name),
    (select price     from public.market_resources where name = p_name),
    public._res_base_value(p_name)
  ), 4)::numeric
$$;

-- ── A. Индекс считается по ОФИЦИАЛЬНОМУ курсу, а не по спотовой цене ──────────
create or replace function public._market_index_value()
returns numeric language sql stable as $$
  select round( 1000 * coalesce(
      sum( (coalesce(ref_price, base_price) / nullif(base_price,0)) * (equilibrium * base_price) )
      / nullif(sum(equilibrium * base_price), 0), 1.0), 2)::numeric
  from public.market_resources
$$;

-- ── _market_shock переопределён: ТОЛЬКО колебания СПОТ-стока (NPC «Рынка»), БЕЗ
--    выдуманных новостей. Раньше он постил фейковые «война/месторождение/бум» в
--    ленту — это сбивало с толку (события ненастоящие). Реальные события сектора
--    теперь двигают ОФИЦИАЛЬНЫЙ курс через _market_news_pulse (см. ниже). ──
create or replace function public._market_shock()
returns void language plpgsql security definer set search_path=public as $$
begin
  case floor(random()*4)::int
    when 0 then update public.market_resources set stock = greatest(1, stock * (0.55 + random()*0.15))
                  where name in ('Железо','Титан','Медь','Платина','Изотопы','Дейтерий');
    when 1 then update public.market_resources set stock = greatest(1, stock * (0.82 + random()*0.10)) where true;
    else        update public.market_resources set stock = stock * (1.12 + random()*0.12) where true;
  end case;
  update public.market_resources
     set price = public._market_price_calc(base_price, stock, equilibrium), updated_at = now()
   where true;
end$$;

-- ── РЕАЛЬНЫЕ СОБЫТИЯ ЛЕНТЫ → РЫНОК. Сканируем «Хронику сектора» (faction_news,
--    kind='bulletin') за последние 6 ч и классифицируем по смыслу:
--      • РАЗРУШЕНИЕ (удар Длани/МЗА, планета стёрта) → дефицит ресурсов → ВВЕРХ;
--      • КОНФЛИКТ/ТАЙНЫЕ ОПЕРАЦИИ (слухи, шпионаж, саботаж, рейд) → нестабильность → ВВЕРХ;
--      • ДЕФОЛТ по облигациям → финансовый стресс → ВНИЗ;
--      • РОСТ (новая держава/фракция, союз, вассал, обращение, достижение) → спрос → мягко ВВЕРХ.
--    Возвращает наклон рынка (bias, ограничен _ex_sent_max) + флаг дефицита (scarcity)
--    для резкого шока + счётчики для админ-панели. Никаких новых новостей НЕ постит.
create or replace function public._market_news_pulse()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare destr int; confl int; fin int; growth int; bias numeric;
begin
  select
    count(*) filter (where title ~* 'уничтож|ст[её]рт|м[её]ртв|залп по системе|длан|гиперпейс|неотврат'),
    count(*) filter (where title ~* 'слух|шпион|саботаж|диверс|рейд|нападен|захват|война|вторжен|переворот'),
    count(*) filter (where title ~* 'дефолт'),
    count(*) filter (where title ~* 'союз|вассал|обращен|достижен|держав|фракци|колониз|расшир|нов(ая|ый) ')
    into destr, confl, fin, growth
  from public.faction_news
  where kind = 'bulletin' and created_at > now() - interval '6 hours';
  destr := coalesce(destr,0); confl := coalesce(confl,0); fin := coalesce(fin,0); growth := coalesce(growth,0);
  bias := (destr*1.0 + confl*0.6 + growth*0.25 - fin*1.0) * 0.004;
  return jsonb_build_object(
    'bias',     greatest(-public._ex_sent_max(), least(public._ex_sent_max(), bias)),
    'scarcity', (destr + confl) > 0,
    'destr', destr, 'confl', confl, 'fin', fin, 'growth', growth);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  market_tick() — надмножество (из _exchange_safeguards.sql) + ШАГ КУРСА.
--  Спот (price/stock) и ОФИЦИАЛЬНЫЙ курс (ref_price) двигаются НЕЗАВИСИМО:
--  ref_price = только NPC-блуждание + возврат к базе (игрок не касается).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.market_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare st public.market_state; d int; i int; shocked boolean := false; rsteps int; permin int;
        v_sent numeric := 0; v_mood numeric := 0; v_react numeric := 0; v_pulse jsonb := '{}'::jsonb;
begin
  begin perform public.bonds_settle();          exception when others then null; end;
  begin perform public.exchange_session_sync(); exception when others then null; end;
  begin perform public.margin_settle();         exception when others then null; end;
  begin perform public.futures_settle();        exception when others then null; end;
  begin perform public.options_settle();        exception when others then null; end;

  select * into st from public.market_state where id = 1 for update;
  if not found then
    insert into public.market_state(id, last_tick) values(1, now()) on conflict (id) do nothing;
    select * into st from public.market_state where id = 1 for update;
  end if;

  -- ════ РЕФ-ТИК: ОФИЦИАЛЬНЫЙ КУРС шагает раз в _ex_ref_period_min минут ════════
  --   (НЕ раз в сутки — иначе ставить не на что). Тренд (ref_drift) держится с
  --   шансом _ex_ref_keep → движение тянется; иначе перекат. Шок даёт сильный
  --   тренд паре ресурсов. Игрок на курс не влияет ничем (только NPC).
  permin := public._ex_ref_period_min();
  rsteps := floor(extract(epoch from (now() - coalesce(st.ref_tick, st.last_tick))) / (permin * 60));
  if rsteps >= 1 then
    rsteps := least(rsteps, 60);
    -- НАСТРОЙ СЕКТОРА = РЕАКЦИИ ИГРОКОВ + РЕАЛЬНЫЕ СОБЫТИЯ ЛЕНТЫ. Он НАПРАВЛЯЕТ
    -- новые тренды (волной), а НЕ плюсуется плоско каждый шаг. (а) реакции на
    -- новости за сутки (👍+8/👎−8); (б) реальные события «Хроники» за 6 ч (удар
    -- Длани/МЗА, тайные операции, дефолты, рост фракций) через _market_news_pulse.
    begin
      select coalesce(sum(weight),0) into v_sent
        from public.news_reactions where created_at > now() - interval '24 hours';
    exception when others then v_sent := 0; end;
    v_react := v_sent / 8.0 * 0.001;
    begin v_pulse := public._market_news_pulse(); exception when others then v_pulse := '{}'::jsonb; end;
    v_mood := greatest(-public._ex_sent_max(), least(public._ex_sent_max(),
                v_react + coalesce((v_pulse->>'bias')::numeric, 0)));
    for i in 1..rsteps loop
      -- тренд держится с шансом keep; при перекате новый тренд = случайный ± с
      -- наклоном к настрою сектора (негатив тянет вниз, позитив — вверх)
      update public.market_resources
         set ref_drift = case when random() < public._ex_ref_keep()
                              then ref_drift
                              else (random()-0.5)*2*public._ex_ref_vol() + v_mood end
       where true;                                            -- pg_safeupdate требует WHERE
      update public.market_resources
         set ref_price = round( (greatest(base_price * public._ex_ref_lo(),
                           least(base_price * public._ex_ref_hi(),
               coalesce(ref_price, base_price) * (1 + ref_drift + (random()-0.5)*0.012)
               + (base_price - coalesce(ref_price, base_price)) * public._ex_ref_revert()
             )))::numeric, 4)         -- ::numeric: random() делает выражение double, а round(double,int) в PG нет
       where true;
    end loop;
    -- ДЕФИЦИТНЫЙ ШОК ОТ РЕАЛЬНОГО СОБЫТИЯ: если в ленте было разрушение (удар
    -- Длани/МЗА) или конфликт/тайные операции — паре ресурсов резкий тренд ВВЕРХ
    -- (дефицит/нестабильность). Не выдумка — реакция на то, что реально произошло.
    if coalesce((v_pulse->>'scarcity')::boolean, false) then
      shocked := true;
      update public.market_resources
         set ref_drift = (0.4 + random()*0.6) * 4 * public._ex_ref_vol()   -- строго ВВЕРХ
       where name in (select name from public.market_resources order by random() limit 3);
    end if;
    update public.market_index set value = public._market_index_value(), updated_at = now() where id = 1;
    -- точка графика на каждый шаг курса (история = ОФИЦИАЛЬНЫЙ курс), обрезка до 60
    insert into public.market_price_history(name, price, stock, at)
      select name, ref_price, stock, now() from public.market_resources;
    insert into public.market_price_history(name, price, stock, at)
      select '__INDEX__', value, 0, now() from public.market_index where id = 1;
    delete from public.market_price_history h using (
      select id, row_number() over (partition by name order by at desc) rn
      from public.market_price_history
    ) x where h.id = x.id and x.rn > 60;
    update public.market_state
       set ref_tick = coalesce(ref_tick, last_tick) + (rsteps * permin || ' minutes')::interval
     where id = 1;
  end if;

  -- ════ СУТОЧНЫЙ ТИК: спот-сток (двигает живую цену «Рынка») раз в игровые сутки ═
  d := floor(extract(epoch from (now() - st.last_tick)) / 86400.0);
  if d < 1 then return jsonb_build_object('ok', true, 'days', 0, 'ref_steps', rsteps, 'shock', shocked, 'mood', round(v_mood,4), 'events', v_pulse); end if;
  d := least(d, 30);
  for i in 1..d loop
    update public.market_resources
       set stock = greatest(1, stock + npc_supply*(0.6+random()*0.8) - npc_demand*(0.6+random()*0.8))
     where true;
    update public.market_resources
       set stock = greatest(1, stock * (0.96 + random()*0.08))
     where true;
    update public.market_resources
       set stock = stock + (equilibrium - stock) * 0.08
     where true;
  end loop;
  if random() < least(0.6, 0.12 * d) then
    perform public._market_shock();
    shocked := true;
  end if;
  update public.market_resources
     set price = public._market_price_calc(base_price, stock, equilibrium),
         updated_at = now()
   where true;
  if public._house_drip() > 0 then
    begin
      update public.exchange_house
         set pool = least(public._house_baseline(), pool + public._house_drip() * d), updated_at = now()
       where id = 1 and pool < public._house_baseline();
    exception when others then null; end;
  end if;
  update public.market_state set last_tick = last_tick + (d || ' days')::interval where id = 1;
  return jsonb_build_object('ok', true, 'days', d, 'ref_steps', rsteps, 'shock', shocked, 'mood', round(v_mood,4), 'events', v_pulse);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  B. КОМИССИЯ ДОМА на входе в маржу/фьючерс: вход по чуть худшей цене.
--     long → входишь дороже курса, short → дешевле. На закрытии считаем по
--     чистому ref_price ⇒ старт всегда на величину спреда в минусе (edge дома).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.margin_open(p_resource text, p_side text, p_collateral numeric, p_leverage numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy;
        coll numeric; lev numeric; notional numeric; size numeric; mk numeric; entry numeric; liq numeric; v_id uuid; open_cnt int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_side not in ('long','short') then raise exception 'bad side'; end if;
  coll := floor(coalesce(p_collateral,0));
  lev  := round(coalesce(p_leverage,1));
  if coll < 100 then raise exception 'collateral too small (min 100)'; end if;
  if lev < 1 or lev > public._margin_max_lev() then raise exception 'bad leverage (1..%)', public._margin_max_lev(); end if;
  fid := public._ec_my_fid();

  select count(*) into open_cnt from public.margin_positions where faction_id = fid and status = 'open';
  if open_cnt >= public._ex_max_open() then raise exception 'too many open positions (max %)', public._ex_max_open(); end if;

  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  if eco.gc < coll then raise exception 'not enough GC'; end if;
  perform public._ex_check_stake(coll, eco.gc);

  perform public._market_ensure(p_resource);
  mk := public._ex_mark(p_resource);                    -- ОФИЦИАЛЬНЫЙ курс
  if mk is null or mk <= 0 then raise exception 'no market price'; end if;
  entry := round(mk * (1 + (case when p_side='long' then 1 else -1 end) * public._ex_open_edge()), 4);  -- + комиссия дома
  notional := coll * lev;
  size     := notional / entry;
  liq      := public._margin_liq_price(p_side, entry, lev);

  update public.faction_economy set gc = gc - coll where faction_id = fid;
  perform public._house_take(coll);
  insert into public.margin_positions(faction_id, resource, side, size_units, entry_price, collateral, leverage, liq_price)
    values (fid, p_resource, p_side, size, entry, coll, lev, liq)
    returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'entry', entry, 'mark', mk, 'size', round(size,4), 'liq', liq);
end$$;

create or replace function public.futures_open(p_resource text, p_side text, p_collateral numeric, p_leverage numeric, p_term_days int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy;
        coll numeric; lev numeric; notional numeric; size numeric; spot numeric; fut numeric; entry numeric; liq numeric; v_id uuid; open_cnt int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_side not in ('long','short') then raise exception 'bad side'; end if;
  coll := floor(coalesce(p_collateral,0));
  lev  := round(coalesce(p_leverage,1));
  if coll < 100 then raise exception 'collateral too small (min 100)'; end if;
  if lev < 1 or lev > public._margin_max_lev() then raise exception 'bad leverage'; end if;
  if p_term_days is null or p_term_days < 1 or p_term_days > 90 then raise exception 'bad term (1..90)'; end if;
  fid := public._ec_my_fid();

  select count(*) into open_cnt from public.futures_positions where faction_id = fid and status = 'open';
  if open_cnt >= public._ex_max_open() then raise exception 'too many open futures (max %)', public._ex_max_open(); end if;

  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  if eco.gc < coll then raise exception 'not enough GC'; end if;
  perform public._ex_check_stake(coll, eco.gc);

  perform public._market_ensure(p_resource);
  spot := public._ex_mark(p_resource);                  -- ОФИЦИАЛЬНЫЙ курс
  if spot is null or spot <= 0 then raise exception 'no market price'; end if;
  fut      := public._fut_price(spot, p_term_days);
  entry    := round(fut * (1 + (case when p_side='long' then 1 else -1 end) * public._ex_open_edge()), 4);  -- + комиссия дома
  notional := coll * lev;
  size     := notional / entry;
  liq      := public._margin_liq_price(p_side, entry, lev);

  update public.faction_economy set gc = gc - coll where faction_id = fid;
  perform public._house_take(coll);
  insert into public.futures_positions(faction_id, resource, side, size_units, entry_price, spot_entry, collateral, leverage, liq_price, expires_at)
    values (fid, p_resource, p_side, size, entry, spot, coll, lev, liq, now() + (p_term_days || ' days')::interval)
    returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'fut', entry, 'spot', spot, 'size', round(size,4), 'liq', liq);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  C. ЛИМИТ ОБЪЁМА СПОТА — (1) потолок ОДНОЙ заявки + (2) СУТОЧНЫЙ потолок на
--     державу/ресурс. Дробить большую сделку на сотню мелких бесполезно: упрётся
--     в дневной лимит. Счётчик объёма за UTC-сутки. (Полные тела из _market_setup.)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.market_daily_vol (
  faction_id text not null,
  name       text not null,
  day        date not null default (now() at time zone 'utc')::date,
  units      numeric not null default 0,
  primary key (faction_id, name, day)
);
alter table public.market_daily_vol enable row level security;  -- пишется только через SECURITY DEFINER RPC

-- проверить + забронировать суточный объём (raise при превышении)
create or replace function public._ex_spot_day_reserve(p_fid text, p_name text, p_units numeric, p_eq numeric)
returns void language plpgsql security definer set search_path=public as $$
declare today date := (now() at time zone 'utc')::date; used numeric; day_cap numeric;
begin
  day_cap := greatest(1, floor(coalesce(p_eq,1) * public._ex_spot_day_frac()));
  select coalesce(units,0) into used from public.market_daily_vol
    where faction_id = p_fid and name = p_name and day = today for update;
  if coalesce(used,0) + p_units > day_cap then
    raise exception 'daily volume limit for %: % used of % units (resets 00:00 UTC)', p_name, floor(coalesce(used,0)), day_cap;
  end if;
  insert into public.market_daily_vol(faction_id, name, day, units)
    values (p_fid, p_name, today, p_units)
    on conflict (faction_id, name, day) do update set units = public.market_daily_vol.units + excluded.units;
end$$;
create or replace function public.market_sell_resource(p_name text, p_units numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; have numeric; mr public.market_resources;
        px1 numeric; new_stock numeric; gross numeric; gain numeric; cap_units numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_units is null or p_units <= 0 then raise exception 'bad units'; end if;
  fid := public._ec_my_fid();
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  have := coalesce((eco.resources->>p_name)::numeric, 0);
  if have < p_units then raise exception 'not enough resource'; end if;

  mr := public._market_ensure(p_name);
  cap_units := greatest(1, floor(mr.equilibrium * public._ex_spot_max_frac()));
  if p_units > cap_units then raise exception 'order too large: max % units per trade', cap_units; end if;
  perform public._ex_spot_day_reserve(fid, p_name, p_units, mr.equilibrium);   -- суточный потолок
  new_stock := mr.stock + p_units;
  px1   := public._market_price_calc(mr.base_price, new_stock, mr.equilibrium);
  gross := public._market_area(mr.base_price, mr.stock, new_stock, mr.equilibrium);
  gain  := floor(gross * 0.8);

  update public.faction_economy
     set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[p_name], to_jsonb(have - p_units), true),
         gc = gc + gain
   where faction_id = fid;
  update public.market_resources
     set stock = new_stock, price = px1, updated_at = now()
   where name = p_name;

  return jsonb_build_object('ok', true, 'gain', gain, 'unit', round(gain/p_units,2), 'newprice', px1);
end$$;

create or replace function public.market_buy_resource(p_name text, p_units numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; mr public.market_resources;
        px1 numeric; new_stock numeric; cost numeric; cap_units numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_units is null or p_units <= 0 then raise exception 'bad units'; end if;
  fid := public._ec_my_fid();
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;

  mr := public._market_ensure(p_name);
  cap_units := greatest(1, floor(mr.equilibrium * public._ex_spot_max_frac()));
  if p_units > cap_units then raise exception 'order too large: max % units per trade', cap_units; end if;
  if mr.stock < p_units then raise exception 'not enough on market'; end if;
  perform public._ex_spot_day_reserve(fid, p_name, p_units, mr.equilibrium);   -- суточный потолок
  new_stock := mr.stock - p_units;
  px1  := public._market_price_calc(mr.base_price, new_stock, mr.equilibrium);
  cost := ceil(public._market_area(mr.base_price, new_stock, mr.stock, mr.equilibrium));
  if eco.gc < cost then raise exception 'not enough GC'; end if;

  update public.faction_economy
     set gc = gc - cost,
         resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[p_name],
                       to_jsonb(coalesce((resources->>p_name)::numeric,0) + p_units), true)
   where faction_id = fid;
  update public.market_resources
     set stock = new_stock, price = px1, updated_at = now()
   where name = p_name;

  return jsonb_build_object('ok', true, 'cost', cost, 'unit', round(cost/p_units,2), 'newprice', px1);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  ИНДЕКС (ETF) УБРАН С БИРЖИ. Игроку непонятен и лишний. Отзываем грант на
--  index_buy/index_sell — точки входа исчезают (клиент тоже прячет вкладку).
--  Облигации/маржа/фьючерсы/опционы остаются. exchange_status ещё отдаёт данные
--  индекса (для совместимости), но без грантов на сделки ими не воспользуешься.
-- ════════════════════════════════════════════════════════════════════════════
do $$ begin
  begin revoke execute on function public.index_buy(numeric)  from authenticated; exception when undefined_function then null; end;
  begin revoke execute on function public.index_sell(numeric) from authenticated; exception when undefined_function then null; end;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  НОВОСТИ → РЫНОК: реакция на новость теперь ОДНОРАЗОВА. Игрок больше не может
--  менять мнение туда-сюда и накручивать настрой сектора (а через него — курсы).
--  Переопределяет news_react из _diplomacy_relations.sql (fair_casino применять
--  ПОСЛЕ него). Первая реакция фиксирует балл отношений + настрой; повтор → отказ.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.news_react(p_news_id uuid, p_stance text)
returns int language plpgsql security definer set search_path=public as $$
declare v_fid text; v_owner uuid; v_to text; v_new int; v_score int;
begin
  perform public.assert_not_banned();
  select faction_id, owner_id into v_fid, v_owner
    from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1;
  if v_fid is null then raise exception 'no approved faction'; end if;
  select faction_id into v_to from public.faction_news where id = p_news_id;
  if v_to is null then raise exception 'news not found'; end if;
  if v_to = v_fid then raise exception 'cannot react to own faction news'; end if;
  -- ОДНОРАЗОВО: уже реагировал на эту новость → отказ (анти-накрутка настроя рынка)
  if exists (select 1 from public.news_reactions where news_id = p_news_id and reactor_fid = v_fid) then
    raise exception 'мнение об этой новости уже выражено — изменить нельзя';
  end if;
  v_new := case p_stance when 'approve' then 8 when 'neutral' then 0 when 'disapprove' then -8 else null end;
  if v_new is null then raise exception 'bad stance'; end if;
  insert into public.news_reactions (news_id, reactor_fid, reactor_owner, stance, weight)
    values (p_news_id, v_fid, v_owner, p_stance, v_new);
  insert into public.faction_relations (from_fid, to_fid, score, updated_at)
    values (v_fid, v_to, greatest(-100, least(100, v_new)), now())
    on conflict (from_fid, to_fid)
    do update set score = greatest(-100, least(100, public.faction_relations.score + v_new)), updated_at = now();
  select score into v_score from public.faction_relations where from_fid = v_fid and to_fid = v_to;
  return v_score;
end$$;
revoke all on function public.news_react(uuid, text) from public;
grant execute on function public.news_react(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  АДМИН-СИМУЛЯЦИЯ: ручной «пропуск хода» рынка для тестов (вкладка «🧪 Тест»).
--  Отматывает таймеры назад и зовёт живой market_tick → курс шагает СРАЗУ,
--  не дожидаясь 3-часового тика. Только стафф. (Стиль _admin_testing.sql.)
--    p_steps — на сколько 3-часовых шагов курса промотать (1..60);
--    p_days  — на сколько игровых суток промотать спот-сток (0..30).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.admin_test_market_advance(p_steps int, p_days int default 0)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n int; dd int; per int; res jsonb; before_j jsonb; idx_before numeric; changes jsonb;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  n   := greatest(0, least(60, coalesce(p_steps,1)));
  dd  := greatest(0, least(30, coalesce(p_days,0)));
  per := public._ex_ref_period_min();
  -- снимок курсов ДО
  select jsonb_object_agg(name, ref_price) into before_j from public.market_resources;
  select value into idx_before from public.market_index where id = 1;
  insert into public.market_state(id, last_tick, ref_tick) values (1, now(), now()) on conflict (id) do nothing;
  update public.market_state
     set ref_tick  = coalesce(ref_tick, last_tick) - ((n * per) || ' minutes')::interval,
         last_tick = last_tick - (dd || ' days')::interval
   where id = 1;
  res := public.market_tick();
  -- что на что поменялось (сортировка по величине движения)
  select jsonb_agg(jsonb_build_object(
           'name', name,
           'before', round(coalesce((before_j->>name)::numeric, ref_price), 4),
           'after',  ref_price,
           'pct', round( ((ref_price / nullif((before_j->>name)::numeric,0)) - 1) * 100, 2))
         order by abs((ref_price / nullif((before_j->>name)::numeric,0)) - 1) desc)
    into changes
    from public.market_resources;
  return jsonb_build_object('ok', true, 'steps', n, 'days', dd,
    'index_before', idx_before, 'index_after', (select value from public.market_index where id = 1),
    'changes', coalesce(changes, '[]'::jsonb), 'tick', res);
end$$;
revoke all on function public.admin_test_market_advance(int,int) from public;
grant execute on function public.admin_test_market_advance(int,int) to authenticated;

-- ── Гранты (create-or-replace сохраняет старые, но на всякий случай) ─────────
grant execute on function public._ex_mark(text)              to anon, authenticated;
grant execute on function public.market_tick()               to anon, authenticated;
grant execute on function public.margin_open(text,text,numeric,numeric)      to authenticated;
grant execute on function public.futures_open(text,text,numeric,numeric,int) to authenticated;
grant execute on function public.market_sell_resource(text,numeric)          to authenticated;
grant execute on function public.market_buy_resource(text,numeric)           to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  ЧИСТЫЙ СТАРТ КОТИРОВОК (одноразово при накате). Старая история market_price_
--  history была забита ПУМПЛЕНЫМ спотом (+200%) с тестов — «Котировки» рисуются
--  из неё и потому врали. Стираем историю, ставим курс/спот к базе и пишем один
--  свежий снимок по официальному курсу. Дальше историю наполняет только тик.
--  ⚠ Повторный накат среза снова обнулит рынок к базе (это намеренный сброс).
--  pg_safeupdate (session-preload в Supabase) требует WHERE → ставим where true.
-- ════════════════════════════════════════════════════════════════════════════
update public.market_resources
   set ref_price = base_price,
       ref_drift = (random()-0.5) * 2 * public._ex_ref_vol(),   -- стартовый тренд случаен (±), а не 0 → курсы сразу в движении
       price = base_price, stock = equilibrium, updated_at = now()
   where true;
insert into public.market_state(id, last_tick, ref_tick) values (1, now(), now())
  on conflict (id) do update set last_tick = now(), ref_tick = now();
update public.market_index set value = public._market_index_value(), updated_at = now() where id = 1;
delete from public.market_price_history where true;
insert into public.market_price_history(name, price, stock, at)
  select name, ref_price, stock, now() from public.market_resources;
insert into public.market_price_history(name, price, stock, at)
  select '__INDEX__', value, 0, now() from public.market_index where id = 1;

notify pgrst, 'reload schema';

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select name, base_price, price, ref_price from public.market_resources;   -- ref_price = base (чистый старт)
-- 2) Накрутить спот: select public.market_buy_resource('Железо', 100);
--    → price двигается, а ref_price НЕ меняется → _ex_mark('Железо') прежний (накрутка мертва)
-- 3) select public.market_tick();   -- ТОЛЬКО тик двигает ref_price (NPC), раз в 3 часа
-- 4) select public.margin_open('Железо','long',1000,2);  -- entry ≈ mark + 0.5% (лёгкая комиссия)
-- 5) select public.market_sell_resource('Железо', 999999); -- ИСКЛЮЧЕНИЕ: order too large (>15% оборота)
-- 6) АДМИН-СИМУЛЯЦИЯ (тест без ожидания): select public.admin_test_market_advance(5, 0);
--    → курс промотан на 5 шагов (≈15ч); select name, base_price, ref_price, ref_drift
--      from market_resources;  -- курс уехал трендами
-- 7) НАСТРОЙ НОВОСТЕЙ: наставить disapprove-реакций (news_react) → след. шаг курса
--    идёт вниз (поле 'sentiment' в ответе market_tick < 0); approve → вверх
-- 8) Авто-движение без игрока — pg_cron (_exchange_market_cron.sql) зовёт market_tick;
--    курс шагает раз в 3 часа (ref_tick), ликвидации проверяются каждый вызов
-- 9) Индекс убран: select public.index_buy(100);  -- ИСКЛЮЧЕНИЕ: нет прав (revoked)
