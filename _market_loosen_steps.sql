-- ════════════════════════════════════════════════════════════════════════════
--  РЫНОК: (1) послабление объёмов, (2) лимит СБЫТА/СКУПКИ теперь по ШАГАМ курса
--  (а не «за UTC-сутки»), (3) усиленная реакция курса на удары «Длани» и —
--  особенно — на УНИЧТОЖЕНИЕ ПЛАНЕТ (для рынка это катастрофа).
--
--  Применять ПОСЛЕ _exchange_fair_casino.sql и _market_autosell.sql.
--
--  Что меняется по сравнению с _exchange_fair_casino.sql:
--   • потолок ОДНОЙ заявки: 25%→45% оборота, нижний пол 100→500 ед.;
--   • «суточный» потолок УБРАН. Вместо него — потолок НА ШАГ КУРСА (окно 3 ч,
--     то же, чем шагает ref_price): budget обновляется каждый шаг, а не в 00:00 UTC.
--     Пол шага щедрый (2000 ед.), доля 150% оборота → на живом рынке почти не
--     упирается, но мгновенно обвалить курс всё равно нельзя (кривая + клампы);
--   • новостной наклон курса усилён (±1.2%→±3%), «Длань»/залпы теперь ловятся
--     надёжно (регексп по «залп»), а УНИЧТОЖЕНИЕ ПЛАНЕТЫ бьёт по ВСЕМУ рынку вверх.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ── 1) ПОСЛАБЛЕНИЕ ОБЪЁМОВ ───────────────────────────────────────────────────
create or replace function public._ex_spot_max_frac()   returns numeric language sql immutable as $$ select 0.45::numeric $$;  -- одна заявка ≤ 45% оборота (было 25%)
create or replace function public._ex_spot_min_cap()     returns numeric language sql immutable as $$ select 500::numeric  $$;  -- нижний пол потолка заявки (было 100)

-- ── 2) ЛИМИТ ПО ШАГАМ КУРСА (окно = _ex_ref_period_min минут, по умолч. 3 ч) ──
create or replace function public._ex_spot_step_frac()    returns numeric language sql immutable as $$ select 1.50::numeric $$;  -- бюджет на ШАГ = 150% оборота ресурса
create or replace function public._ex_spot_step_min_cap() returns numeric language sql immutable as $$ select 2000::numeric $$;  -- нижний пол бюджета на шаг (мелкие рынки)

-- Начало текущего окна-шага: пол now() к сетке из period_min минут (стабильно,
-- предсказуемо для клиента — обратный отсчёт до следующей границы очевиден).
create or replace function public._ex_step_window_start() returns timestamptz
language sql stable as $$
  select to_timestamp( floor( extract(epoch from now())
           / (public._ex_ref_period_min()*60) ) * (public._ex_ref_period_min()*60) )
$$;

-- Учёт объёма на ОКНО-ШАГ (заменяет market_daily_vol).
create table if not exists public.market_step_vol (
  faction_id text        not null,
  name       text        not null,
  win_start  timestamptz not null,
  units      numeric      not null default 0,
  primary key (faction_id, name, win_start)
);
alter table public.market_step_vol enable row level security;   -- пишется только через SECURITY DEFINER RPC
revoke all on table public.market_step_vol from anon, authenticated;

-- Потолок объёма на шаг для ресурса (оборот × доля, но не ниже пола).
create or replace function public._ex_step_cap(p_eq numeric) returns numeric
language sql stable as $$
  select greatest(public._ex_spot_step_min_cap(),
                  floor(coalesce(p_eq,1) * public._ex_spot_step_frac()))
$$;

-- Проверить + забронировать объём в текущем окне-шаге (raise при превышении).
create or replace function public._ex_spot_step_reserve(p_fid text, p_name text, p_units numeric, p_eq numeric)
returns void language plpgsql security definer set search_path=public as $$
declare win timestamptz := public._ex_step_window_start(); used numeric; cap numeric; nxt timestamptz;
begin
  cap := public._ex_step_cap(p_eq);
  select coalesce(units,0) into used from public.market_step_vol
    where faction_id = p_fid and name = p_name and win_start = win for update;
  if coalesce(used,0) + p_units > cap then
    nxt := win + (public._ex_ref_period_min() || ' minutes')::interval;
    raise exception 'step volume limit for %: % of % units this step (resets at % UTC)',
      p_name, floor(coalesce(used,0)), cap, to_char(nxt,'HH24:MI');
  end if;
  insert into public.market_step_vol(faction_id, name, win_start, units)
    values (p_fid, p_name, win, p_units)
    on conflict (faction_id, name, win_start) do update set units = public.market_step_vol.units + excluded.units;
  -- лёгкая уборка прошлых окон этой пары (не копим историю)
  delete from public.market_step_vol
    where faction_id = p_fid and name = p_name and win_start < win - interval '1 day';
end$$;

-- Сводка лимитов для клиента: когда сбросится и сколько уже использовано по паре.
create or replace function public.market_step_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text; win timestamptz := public._ex_step_window_start(); nxt timestamptz;
begin
  fid := public._ec_my_fid();
  nxt := win + (public._ex_ref_period_min() || ' minutes')::interval;
  return jsonb_build_object(
    'window_start', win,
    'next_reset',   nxt,
    'resets_in',    greatest(0, floor(extract(epoch from (nxt - now()))))::int,
    'period_min',   public._ex_ref_period_min(),
    'step_frac',    public._ex_spot_step_frac(),
    'step_min_cap', public._ex_spot_step_min_cap(),
    'order_frac',   public._ex_spot_max_frac(),
    'order_min_cap',public._ex_spot_min_cap(),
    'used', coalesce(
      (select jsonb_object_agg(name, units) from public.market_step_vol
        where faction_id = fid and win_start = win and units > 0), '{}'::jsonb));
end$$;
revoke all on function public.market_step_status() from public;
grant execute on function public.market_step_status() to authenticated;

-- ── 3) СПОТ-СДЕЛКИ: те же тела, что в _exchange_fair_casino.sql, но лимит per-STEP ─
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
  cap_units := greatest(public._ex_spot_min_cap(), floor(mr.equilibrium * public._ex_spot_max_frac()));
  if p_units > cap_units then raise exception 'order too large: max % units per trade', cap_units; end if;
  perform public._ex_spot_step_reserve(fid, p_name, p_units, mr.equilibrium);   -- потолок на шаг курса
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
  cap_units := greatest(public._ex_spot_min_cap(), floor(mr.equilibrium * public._ex_spot_max_frac()));
  if p_units > cap_units then raise exception 'order too large: max % units per trade', cap_units; end if;
  if mr.stock < p_units then raise exception 'not enough on market'; end if;
  perform public._ex_spot_step_reserve(fid, p_name, p_units, mr.equilibrium);   -- потолок на шаг курса
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

grant execute on function public.market_sell_resource(text,numeric) to authenticated;
grant execute on function public.market_buy_resource(text,numeric)  to authenticated;

-- Автопродажа тоже шагает по новому потолку (per-step вместо старого кап-per-trade).
create or replace function public.market_autosell_run()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; eco public.faction_economy; mr public.market_resources;
  r record; have numeric; sell numeric; cap_units numeric;
  new_stock numeric; px1 numeric; gross numeric; gain numeric;
  total_gain numeric := 0; sold jsonb := '{}'::jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', true, 'gain', 0, 'sold', '{}'::jsonb); end if;
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then return jsonb_build_object('ok', true, 'gain', 0, 'sold', '{}'::jsonb); end if;

  for r in
    select resource, units from public.market_autosell
     where faction_id = fid and units > 0
     order by resource
  loop
    have := floor(coalesce((eco.resources->>r.resource)::numeric, 0));
    sell := least(r.units, have);
    if sell <= 0 then continue; end if;
    mr := public._market_ensure(r.resource);
    cap_units := greatest(public._ex_spot_min_cap(), floor(mr.equilibrium * public._ex_spot_max_frac()));
    sell := least(sell, cap_units);
    if sell <= 0 then continue; end if;
    new_stock := mr.stock + sell;
    px1   := public._market_price_calc(mr.base_price, new_stock, mr.equilibrium);
    gross := public._market_area(mr.base_price, mr.stock, new_stock, mr.equilibrium);
    gain  := floor(gross * 0.8);
    eco.resources := jsonb_set(coalesce(eco.resources, '{}'::jsonb),
                       array[r.resource], to_jsonb(have - sell), true);
    total_gain := total_gain + gain;
    update public.market_resources set stock = new_stock, price = px1, updated_at = now() where name = r.resource;
    sold := sold || jsonb_build_object(r.resource, jsonb_build_object('units', sell, 'gain', gain));
  end loop;

  if sold <> '{}'::jsonb then
    update public.faction_economy set resources = eco.resources, gc = gc + total_gain where faction_id = fid;
  end if;
  return jsonb_build_object('ok', true, 'gain', total_gain, 'sold', sold);
end$$;
grant execute on function public.market_autosell_run() to authenticated;

-- ── 4) РЕАКЦИЯ КУРСА НА СОБЫТИЯ: усиление + КАТАСТРОФА при уничтожении планеты ──
create or replace function public._ex_sent_max() returns numeric language sql immutable as $$ select 0.030::numeric $$;  -- макс. новостной наклон за шаг ±3% (было ±1.2%)

-- Классификатор ленты → наклон рынка. Добавлена отдельная категория CATA
-- (уничтожение планеты — тяжелейший удар) и надёжная ловля залпов «Длани».
create or replace function public._market_news_pulse()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare cata int; destr int; confl int; fin int; growth int; bias numeric;
begin
  select
    count(*) filter (where title ~* 'планета уничтож|перестала существовать|☠|мироубий'),
    count(*) filter (where title ~* 'залп|длан|гиперпейс|неотврат|орудие судного|уничтож|ст[её]рт|м[её]ртв'),
    count(*) filter (where title ~* 'слух|шпион|саботаж|диверс|рейд|нападен|захват|война|вторжен|переворот'),
    count(*) filter (where title ~* 'дефолт'),
    count(*) filter (where title ~* 'союз|вассал|обращен|достижен|держав|фракци|колониз|расшир|нов(ая|ый) ')
    into cata, destr, confl, fin, growth
  from public.faction_news
  where kind = 'bulletin' and created_at > now() - interval '6 hours';
  cata := coalesce(cata,0); destr := coalesce(destr,0); confl := coalesce(confl,0);
  fin := coalesce(fin,0); growth := coalesce(growth,0);
  -- катастрофа весит втрое тяжелее обычного разрушения; дефицит → цены ВВЕРХ
  bias := (cata*3.0 + destr*1.0 + confl*0.6 + growth*0.25 - fin*1.0) * 0.006;
  return jsonb_build_object(
    'bias',       greatest(-public._ex_sent_max(), least(public._ex_sent_max(), bias)),
    'scarcity',   (destr + confl) > 0,
    'catastrophe', cata > 0,
    'cata', cata, 'destr', destr, 'confl', confl, 'fin', fin, 'growth', growth);
end$$;

-- market_tick() — копия из _exchange_fair_casino.sql + БЛОК КАТАСТРОФЫ:
-- при уничтожении планеты весь рынок получает резкий тренд ВВЕРХ (трагедия/дефицит).
create or replace function public.market_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare st public.market_state; d int; i int; shocked boolean := false; rsteps int; permin int;
        v_sent numeric := 0; v_mood numeric := 0; v_react numeric := 0; v_pulse jsonb := '{}'::jsonb;
        v_cata boolean := false;
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

  permin := public._ex_ref_period_min();
  rsteps := floor(extract(epoch from (now() - coalesce(st.ref_tick, st.last_tick))) / (permin * 60));
  if rsteps >= 1 then
    rsteps := least(rsteps, 60);
    begin
      select coalesce(sum(weight),0) into v_sent
        from public.news_reactions where created_at > now() - interval '24 hours';
    exception when others then v_sent := 0; end;
    v_react := v_sent / 8.0 * 0.001;
    begin v_pulse := public._market_news_pulse(); exception when others then v_pulse := '{}'::jsonb; end;
    v_cata := coalesce((v_pulse->>'catastrophe')::boolean, false);
    v_mood := greatest(-public._ex_sent_max(), least(public._ex_sent_max(),
                v_react + coalesce((v_pulse->>'bias')::numeric, 0)));
    for i in 1..rsteps loop
      update public.market_resources
         set ref_drift = case when random() < public._ex_ref_keep()
                              then ref_drift
                              else (random()-0.5)*2*public._ex_ref_vol() + v_mood end
       where true;
      update public.market_resources
         set ref_price = round( (greatest(base_price * public._ex_ref_lo(),
                           least(base_price * public._ex_ref_hi(),
               coalesce(ref_price, base_price) * (1 + ref_drift + (random()-0.5)*0.012)
               + (base_price - coalesce(ref_price, base_price)) * public._ex_ref_revert()
             )))::numeric, 4)
       where true;
    end loop;
    -- ☠ КАТАСТРОФА: планета уничтожена — резкий тренд ВВЕРХ по ВСЕМУ рынку
    --   (панический дефицит; для рынка это трагедия, а не локальный шок).
    if v_cata then
      shocked := true;
      update public.market_resources
         set ref_drift = (0.6 + random()*0.5) * 5 * public._ex_ref_vol()   -- сильный, весь рынок
       where true;
      update public.market_resources
         set ref_price = round( least(base_price * public._ex_ref_hi(),
               coalesce(ref_price, base_price) * (1 + ref_drift))::numeric, 4)
       where true;
    -- обычный дефицитный шок (удар «Длани»/конфликт) — паре ресурсов вверх
    elsif coalesce((v_pulse->>'scarcity')::boolean, false) then
      shocked := true;
      update public.market_resources
         set ref_drift = (0.4 + random()*0.6) * 4 * public._ex_ref_vol()
       where name in (select name from public.market_resources order by random() limit 3);
    end if;
    update public.market_index set value = public._market_index_value(), updated_at = now() where id = 1;
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

  d := floor(extract(epoch from (now() - st.last_tick)) / 86400.0);
  if d < 1 then return jsonb_build_object('ok', true, 'days', 0, 'ref_steps', rsteps, 'shock', shocked, 'cata', v_cata, 'mood', round(v_mood,4), 'events', v_pulse); end if;
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
  return jsonb_build_object('ok', true, 'days', d, 'ref_steps', rsteps, 'shock', shocked, 'cata', v_cata, 'mood', round(v_mood,4), 'events', v_pulse);
end$$;
grant execute on function public.market_tick() to anon, authenticated;

-- ── 5) «Что там на рынке»: недавние события ленты и их влияние на курс ────────
-- Возвращает классифицированные сводки за 24 ч со знаком/силой влияния (для
-- VN-экрана). Не постит новостей — только читает «Хронику сектора».
create or replace function public.market_events_recent()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  return coalesce((
    select jsonb_agg(x order by x.at desc) from (
      select id, title, created_at as at,
        case
          when title ~* 'планета уничтож|перестала существовать|☠|мироубий'                 then 'cata'
          when title ~* 'залп|длан|гиперпейс|неотврат|орудие судного'                        then 'doom'
          when title ~* 'уничтож|ст[её]рт|м[её]ртв'                                          then 'destr'
          when title ~* 'слух|шпион|саботаж|диверс|рейд|нападен|захват|война|вторжен|переворот' then 'confl'
          when title ~* 'дефолт'                                                             then 'fin'
          when title ~* 'союз|вассал|обращен|колониз|расшир' then 'growth'
          else 'flat'
        end as cls
      from public.faction_news
      where kind = 'bulletin' and created_at > now() - interval '24 hours'
        -- Достижения фракций («🏆 Достижение: …») — НЕ рыночное событие: курс не двигают,
        -- а лента забивается обрезанными бессмысленными кнопками. Явно вырезаем.
        and title !~* 'достижен'
        and title ~* 'планета уничтож|перестала существовать|☠|мироубий|залп|длан|гиперпейс|неотврат|орудие судного|уничтож|ст[её]рт|м[её]ртв|слух|шпион|саботаж|диверс|рейд|нападен|захват|война|вторжен|переворот|дефолт|союз|вассал|обращен|колониз|расшир'
      order by created_at desc limit 30
    ) x
  ), '[]'::jsonb);
end$$;
revoke all on function public.market_events_recent() from public;
grant execute on function public.market_events_recent() to authenticated;

-- Старый суточный учёт больше не нужен (оставляем таблицу — вдруг откат; DML на неё
-- уже никто не делает). При желании: drop table public.market_daily_vol;

commit;

-- Проверка:
--   select public.market_step_status();      -- окно, сброс, использованный объём
--   select public.market_events_recent();    -- недавние события ленты и их класс
--   select public.market_sell_resource('Гелий-3', 3000);  -- послабленный объём
