-- ════════════════════════════════════════════════════════════════════════════
--  АВТОПРОДАЖА: постоянный приказ сбывать N единиц ресурса КАЖДЫЙ ТИК.
--  Игрок задаёт «сколько единиц ресурса продавать за тик» прямо на Галактическом
--  рынке; на каждом заходном тике (клиент зовёт market_autosell_run рядом с
--  economy_tick) держава автоматически сбывает эти единицы на спот-рынок по той
--  же кривой цены/спреду, что и ручная продажа (market_sell_resource).
--
--  Модель НАМЕРЕННО простая и без эксплойтов:
--    • объём за один прогон зажат тем же спот-капом, что и ручная сделка
--      (_ex_spot_min_cap / _ex_spot_max_frac × equilibrium) — нельзя обвалить рынок;
--    • продаётся не больше, чем реально лежит на складе;
--    • цена/спред/движение стока — ровно как в market_sell_resource (спред 20%).
--
--  Применять ПОСЛЕ _exchange_fair_casino.sql (нужны _market_ensure,
--  _market_price_calc, _market_area, _ex_spot_min_cap, _ex_spot_max_frac).
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ── Хранилище приказов: держава × ресурс → единиц/тик ────────────────────────
create table if not exists public.market_autosell (
  faction_id text        not null,
  resource   text        not null,
  units      numeric     not null default 0 check (units >= 0),
  updated_at timestamptz not null default now(),
  primary key (faction_id, resource)
);
alter table public.market_autosell enable row level security;
-- Пишем только через SECURITY DEFINER RPC; прямого DML клиенту не даём.
revoke all on table public.market_autosell from anon, authenticated;

-- ── Задать/снять автопродажу выбранного ресурса ──────────────────────────────
--   p_units <= 0 → приказ снимается (строка удаляется).
create or replace function public.market_autosell_set(p_name text, p_units numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_units numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'bad resource'; end if;
  perform public._market_ensure(p_name);          -- ресурс должен быть торгуемым
  v_units := floor(coalesce(p_units, 0));
  if v_units <= 0 then
    delete from public.market_autosell where faction_id = fid and resource = p_name;
    return jsonb_build_object('ok', true, 'resource', p_name, 'units', 0);
  end if;
  insert into public.market_autosell (faction_id, resource, units, updated_at)
    values (fid, p_name, v_units, now())
    on conflict (faction_id, resource)
      do update set units = excluded.units, updated_at = now();
  return jsonb_build_object('ok', true, 'resource', p_name, 'units', v_units);
end$$;
revoke all on function public.market_autosell_set(text, numeric) from public;
grant execute on function public.market_autosell_set(text, numeric) to authenticated;

-- ── Мои приказы автопродажи: { ресурс → единиц/тик } ─────────────────────────
create or replace function public.market_autosell_list()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  if fid is null then return '{}'::jsonb; end if;
  return coalesce(
    (select jsonb_object_agg(resource, units)
       from public.market_autosell
      where faction_id = fid and units > 0),
    '{}'::jsonb);
end$$;
revoke all on function public.market_autosell_list() from public;
grant execute on function public.market_autosell_list() to authenticated;

-- ── Прогон автопродажи за один тик (клиент зовёт рядом с economy_tick) ───────
--   Сбывает по каждому приказу до N единиц (зажато спот-капом и складом),
--   двигает цену/сток как ручная продажа, начисляет ГС. Возвращает сводку.
create or replace function public.market_autosell_run(p_days numeric default 1)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; eco public.faction_economy; mr public.market_resources;
  r record; have numeric; sell numeric; cap_units numeric; v_days numeric;
  new_stock numeric; px1 numeric; gross numeric; gain numeric;
  total_gain numeric := 0; sold jsonb := '{}'::jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', true, 'gain', 0, 'sold', '{}'::jsonb); end if;
  -- Приказ = «units за ОДИН тик»; исполняем ровно за столько игровых дней,
  -- сколько реально прошло (клиент передаёт tick.days). Без прошедшего дня — ноль.
  v_days := floor(coalesce(p_days, 1));
  if v_days < 1 then return jsonb_build_object('ok', true, 'gain', 0, 'sold', '{}'::jsonb); end if;
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then return jsonb_build_object('ok', true, 'gain', 0, 'sold', '{}'::jsonb); end if;

  for r in
    select resource, units from public.market_autosell
     where faction_id = fid and units > 0
     order by resource
  loop
    have := floor(coalesce((eco.resources->>r.resource)::numeric, 0));
    sell := least(r.units * v_days, have);        -- N/тик × прошедшие тики, но не больше склада
    if sell <= 0 then continue; end if;
    mr := public._market_ensure(r.resource);
    cap_units := greatest(public._ex_spot_min_cap(), floor(mr.equilibrium * public._ex_spot_max_frac()));
    sell := least(sell, cap_units);           -- тот же потолок, что и у ручной сделки
    if sell <= 0 then continue; end if;
    new_stock := mr.stock + sell;
    px1   := public._market_price_calc(mr.base_price, new_stock, mr.equilibrium);
    gross := public._market_area(mr.base_price, mr.stock, new_stock, mr.equilibrium);
    gain  := floor(gross * 0.8);              -- спред 20% (как market_sell_resource)
    -- списываем со склада (в локальной копии — один UPDATE в конце)
    eco.resources := jsonb_set(coalesce(eco.resources, '{}'::jsonb),
                       array[r.resource], to_jsonb(have - sell), true);
    total_gain := total_gain + gain;
    update public.market_resources
       set stock = new_stock, price = px1, updated_at = now()
     where name = r.resource;
    sold := sold || jsonb_build_object(r.resource,
              jsonb_build_object('units', sell, 'gain', gain));
  end loop;

  if sold <> '{}'::jsonb then
    update public.faction_economy
       set resources = eco.resources, gc = gc + total_gain
     where faction_id = fid;
  end if;
  return jsonb_build_object('ok', true, 'gain', total_gain, 'sold', sold);
end$$;
revoke all on function public.market_autosell_run() from public;
grant execute on function public.market_autosell_run() to authenticated;

commit;

-- Проверка:
--   select public.market_autosell_set('Гелий-3', 100);   -- продавать 100/тик
--   select public.market_autosell_list();                 -- {"Гелий-3": 100}
--   select public.market_autosell_run();                  -- прогнать один тик
--   select public.market_autosell_set('Гелий-3', 0);      -- снять приказ
