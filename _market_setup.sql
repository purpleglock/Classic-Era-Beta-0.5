-- ============================================================================
--  ГАЛАКТИЧЕСКИЙ РЫНОК · СРЕЗ 1 — динамические цены ресурсов
--  Применять в Supabase → SQL Editor. Идемпотентно. Зависит от:
--    _security_market.sql (resource_rarity), _economy_setup.sql (_res_price,
--    economy_tick/economy_tick_all/economy_accrue, _faction_mods, _ec_my_fid).
--
--  ИДЕЯ. Раньше цена ресурса была статичной (_res_value по имени). Теперь есть
--  ЕДИНЫЙ глобальный рынок: у каждого ресурса конечный «рыночный запас» (stock)
--  и ЖИВАЯ цена, которая зависит от запаса относительно равновесия:
--      price = base * clamp( (equilibrium / stock)^elast , 0.25 , 4.0 )
--  Дефицит на рынке → дорого, избыток → дёшево. Продажа на рынок повышает
--  запас (цена падает), покупка — снижает (цена растёт). NPC-спрос/предложение
--  и случайные блуждания двигают цену каждый суточный тик.
--
--  ГЛОБАЛЬНОЕ ВЛИЯНИЕ ЦЕНЫ — без переписывания больших функций: _res_value
--  переопределяется так, что возвращает ЖИВУЮ цену рынка (фолбэк — базовая).
--  Все потребители уже зовут _res_value: economy_accrue (экспорт-сбыт и товарная
--  биржа), economy_produce (докупка дефицита ×1.5), trade_propose (цена каравана).
--  Базовый якорь (target возврата к среднему) сохранён в _res_base_value и в
--  market_resources.base_price.
-- ============================================================================

-- ── Базовый «якорь» цены (бывшее тело _res_value): персональная цена по имени,
--    фолбэк по редкости. Чистая (immutable) — используется как target рынка. ──
create or replace function public._res_base_value(p_name text, p_rarity text default null)
returns numeric language sql immutable as $$
  select coalesce(
    case p_name
      when 'Силикаты'                 then 1
      when 'Сера'                     then 2
      when 'Железо'                   then 3
      when 'Углерод'                  then 3
      when 'Лёд'                      then 3
      when 'Метан'                    then 4
      when 'Медь'                     then 8
      when 'Аммиачный лёд'            then 10
      when 'Ионит'                    then 12
      when 'Титан'                    then 14
      when 'Жидкая вода'              then 45
      when 'Изотопы'                  then 50
      when 'Реликтовое дерево'        then 55
      when 'Редкоземельные руды'      then 60
      when 'Дейтерий'                 then 65
      when 'Платина'                  then 70
      when 'Гелий-3'                  then 80
      when 'Старвис'                  then 200
      when 'Хтонит'                   then 220
      when 'Стелларит'                then 260
      when 'Гравиядро'                then 1200
      when 'Рагенод'                  then 1500
      when 'Программируемая материя'  then 1600
      else null
    end,
    public._res_price(p_rarity)   -- фолбэк по редкости
  )::numeric
$$;

-- ── Равновесный запас и базовый NPC-поток по редкости («реальные количества») ──
create or replace function public._mk_equilibrium(p_rarity text) returns numeric language sql immutable as $$
  select case p_rarity
    when 'legendary' then 1500 when 'epic' then 10000 when 'rare' then 50000
    when 'uncommon' then 250000 else 800000 end::numeric
$$;

-- ── Цена от запаса (эластичность 0.45, ограничение 0.25..4.0 от базы) ──
create or replace function public._market_price_calc(p_base numeric, p_stock numeric, p_eq numeric)
returns numeric language sql immutable as $$
  select round(
    coalesce(p_base,2) * least(4.0, greatest(0.25,
      power( greatest(coalesce(p_eq,1),1) / greatest(coalesce(p_stock,1),1), 0.45 )
    )), 2)::numeric
$$;

-- ── Таблицы рынка ───────────────────────────────────────────────────────────
create table if not exists public.market_resources (
  name        text primary key,
  base_price  numeric not null,
  price       numeric not null,
  stock       numeric not null,
  equilibrium numeric not null,
  npc_supply  numeric not null default 0,
  npc_demand  numeric not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.market_resources enable row level security;
drop policy if exists "mr_sel" on public.market_resources;
create policy "mr_sel" on public.market_resources for select to public using (true);
-- запись — только через SECURITY DEFINER RPC (никакого клиентского DML)

create table if not exists public.market_state (
  id        int primary key default 1,
  last_tick timestamptz not null default now()
);
insert into public.market_state(id,last_tick) values(1, now()) on conflict (id) do nothing;
-- служебная строка тика: клиент её не читает и не пишет; запись только через
-- SECURITY DEFINER market_tick(). RLS включён без политик → клиентский доступ закрыт.
alter table public.market_state enable row level security;

create table if not exists public.market_price_history (
  id    bigserial primary key,
  name  text not null,
  price numeric not null,
  stock numeric not null,
  at    timestamptz not null default now()
);
create index if not exists mph_name_at on public.market_price_history(name, at desc);
alter table public.market_price_history enable row level security;
drop policy if exists "mph_sel" on public.market_price_history;
create policy "mph_sel" on public.market_price_history for select to public using (true);

-- ── Сид рынка из справочника редкости (зеркало RESOURCES) ───────────────────
insert into public.market_resources (name, base_price, price, stock, equilibrium, npc_supply, npc_demand)
select rr.name,
       public._res_base_value(rr.name, rr.rarity)                       as base_price,
       public._res_base_value(rr.name, rr.rarity)                       as price,
       public._mk_equilibrium(rr.rarity)                                as stock,
       public._mk_equilibrium(rr.rarity)                                as equilibrium,
       round(public._mk_equilibrium(rr.rarity) * 0.03)                  as npc_supply,
       round(public._mk_equilibrium(rr.rarity) * 0.03)                  as npc_demand
from public.resource_rarity rr
on conflict (name) do nothing;   -- не затираем уже живущий рынок при повторном прогоне

-- ── ЖИВАЯ цена: _res_value теперь читает рынок (фолбэк — базовый якорь). ──────
--    Это и есть рычаг глобального влияния — все потребители зовут _res_value.
--    Меняем волатильность immutable→stable (читает таблицу).
create or replace function public._res_value(p_name text, p_rarity text default null)
returns numeric language sql stable as $$
  select coalesce(
    (select price from public.market_resources where name = p_name),
    public._res_base_value(p_name, p_rarity)
  )::numeric
$$;

-- ── Гарантировать строку рынка для ресурса (создаёт из справочника при нужде) ─
create or replace function public._market_ensure(p_name text)
returns public.market_resources language plpgsql security definer set search_path=public as $$
declare mr public.market_resources; v_rar text; v_base numeric; v_eq numeric;
begin
  select * into mr from public.market_resources where name = p_name for update;
  if found then return mr; end if;
  v_rar  := coalesce((select rarity from public.resource_rarity where name = p_name), 'common');
  v_base := public._res_base_value(p_name, v_rar);
  v_eq   := public._mk_equilibrium(v_rar);
  insert into public.market_resources(name, base_price, price, stock, equilibrium, npc_supply, npc_demand)
    values (p_name, v_base, v_base, v_eq, v_eq, round(v_eq*0.03), round(v_eq*0.03))
    on conflict (name) do nothing;
  select * into mr from public.market_resources where name = p_name for update;
  return mr;
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  market_tick() — суточная симуляция (идемпотентна по целым суткам)
--  NPC net-flow + случайное блуждание двигают запас, медленный возврат к
--  равновесию, пересчёт цены, снимок истории (≤60 точек/ресурс).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.market_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare st public.market_state; d int; i int;
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
    -- медленный возврат запаса к равновесию (mean reversion)
    update public.market_resources
       set stock = stock + (equilibrium - stock) * 0.08;
  end loop;

  -- пересчёт цены от итогового запаса
  update public.market_resources
     set price = public._market_price_calc(base_price, stock, equilibrium),
         updated_at = now();

  -- снимок истории + обрезка до 60 точек на ресурс
  insert into public.market_price_history(name, price, stock, at)
    select name, price, stock, now() from public.market_resources;
  delete from public.market_price_history h using (
    select id, row_number() over (partition by name order by at desc) rn
    from public.market_price_history
  ) x where h.id = x.id and x.rn > 60;

  update public.market_state set last_tick = last_tick + (d || ' days')::interval where id = 1;
  return jsonb_build_object('ok', true, 'days', d);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  Продажа на рынок: +запас (цена вниз), ГС по живой цене ×0.8 ×доктрина
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.market_sell_resource(p_name text, p_units numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; have numeric; mr public.market_resources; px numeric; gain numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_units is null or p_units <= 0 then raise exception 'bad units'; end if;
  fid := public._ec_my_fid();
  -- FOR UPDATE на казне: сериализует параллельные продажи (анти-double-pay)
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  have := coalesce((eco.resources->>p_name)::numeric, 0);
  if have < p_units then raise exception 'not enough resource'; end if;

  mr := public._market_ensure(p_name);   -- блокирует строку рынка
  px := mr.price;
  gain := floor(p_units * px * 0.8 * (public._faction_mods(fid)->>'gc')::numeric);

  update public.faction_economy
     set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[p_name], to_jsonb(have - p_units), true),
         gc = gc + gain
   where faction_id = fid;
  -- запас рынка растёт → цена пересчитывается вниз
  update public.market_resources
     set stock = stock + p_units,
         price = public._market_price_calc(base_price, stock + p_units, equilibrium),
         updated_at = now()
   where name = p_name;

  return jsonb_build_object('ok', true, 'gain', gain, 'price', px);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  Покупка с рынка: −запас (цена вверх), списываем ГС по живой цене
--  Запас рынка конечен: нельзя купить больше, чем есть.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.market_buy_resource(p_name text, p_units numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; mr public.market_resources; px numeric; cost numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_units is null or p_units <= 0 then raise exception 'bad units'; end if;
  fid := public._ec_my_fid();
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;

  mr := public._market_ensure(p_name);   -- блокирует строку рынка
  if mr.stock < p_units then raise exception 'not enough on market'; end if;
  px := mr.price;
  cost := ceil(p_units * px);
  if eco.gc < cost then raise exception 'not enough GC'; end if;

  update public.faction_economy
     set gc = gc - cost,
         resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[p_name],
                       to_jsonb(coalesce((resources->>p_name)::numeric,0) + p_units), true)
   where faction_id = fid;
  -- запас рынка падает → цена пересчитывается вверх
  update public.market_resources
     set stock = greatest(1, stock - p_units),
         price = public._market_price_calc(base_price, greatest(1, stock - p_units), equilibrium),
         updated_at = now()
   where name = p_name;

  return jsonb_build_object('ok', true, 'cost', cost, 'price', px);
end$$;

-- ── Совместимость: старый economy_sell_resource → живая цена (на случай, если
--    где-то ещё зовётся клиент со старой сигнатурой). p_rarity игнорируется. ──
create or replace function public.economy_sell_resource(p_name text, p_units numeric, p_rarity text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public.market_sell_resource(p_name, p_units);
end$$;

-- ── Караван: цена пути берётся по ЖИВОЙ цене рынка (через _res_value) ─────────
--    Полное тело trade_propose (security-fix из _security_market.sql), цена →
--    _res_value(p_resource) вместо _res_price(rarity).
create or replace function public.trade_propose(p_to_fid text, p_origin_sys text, p_dest_sys text, p_resource text, p_rarity text, p_volume int, p_convoy int, p_threats jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; cap int; used int; bowner uuid; roster_ships int; committed int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_volume is null or p_volume <= 0 then raise exception 'bad volume'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_to_fid = app.faction_id then raise exception 'self'; end if;
  select owner_id into bowner from public.faction_economy where faction_id=p_to_fid;
  if bowner is null then raise exception 'recipient has no economy'; end if;
  perform 1 from public.map_systems where id=p_origin_sys and faction=app.faction_id;
  if not found then raise exception 'origin not yours'; end if;
  perform 1 from public.map_systems where id=p_dest_sys and faction=p_to_fid;
  if not found then raise exception 'destination not theirs'; end if;
  select coalesce(sum(slots_open),0) into cap from public.colony_buildings where faction_id=app.faction_id and btype='trade';
  select count(*) into used from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
  if used >= cap then raise exception 'no free trade hub slots'; end if;
  select coalesce(sum(qty),0) into roster_ships from public.unit_production where faction_id=app.faction_id and category='ship' and status='done';
  select coalesce(sum(convoy),0) into committed from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
  if coalesce(p_convoy,0) > roster_ships - committed then raise exception 'not enough escort ships'; end if;
  insert into public.trade_routes(a_fid,a_owner,a_name,b_fid,b_owner,b_name,volume,status,origin_sys,dest_sys,resource,price,convoy,threats)
    values(app.faction_id, auth.uid(), app.name, p_to_fid, bowner, public._fac_name(p_to_fid), p_volume, 'pending',
           p_origin_sys, p_dest_sys, p_resource, public._res_value(p_resource, p_rarity), coalesce(p_convoy,0), coalesce(p_threats,'[]'::jsonb));
  return jsonb_build_object('ok', true);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  Хук рыночного тика в существующие тики дохода (мгновенная актуализация цен).
--  Тело прежнее + perform public.market_tick().
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.economy_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  perform public.market_tick();   -- глобальный рынок: догнать суточные изменения цен
  select faction_id into fid from public.faction_economy where owner_id=auth.uid() order by created_at asc limit 1;
  if fid is null then raise exception 'no economy'; end if;
  return public.economy_accrue(fid);
end$$;

create or replace function public.economy_tick_all()
returns jsonb language plpgsql security definer set search_path=public as $$
declare f record; n int := 0;
begin
  perform public.market_tick();   -- глобальный рынок тикает один раз за прогон
  for f in select faction_id from public.faction_economy loop
    begin perform public.economy_accrue(f.faction_id); n := n + 1;
    exception when others then null; end;
  end loop;
  return jsonb_build_object('ok', true, 'factions', n, 'at', now());
end$$;

-- ── Права ───────────────────────────────────────────────────────────────────
revoke all on function public.market_sell_resource(text,numeric)  from public;
revoke all on function public.market_buy_resource(text,numeric)   from public;
revoke all on function public.market_tick()                       from public;
revoke all on function public.economy_sell_resource(text,numeric,text) from public;
revoke all on function public.trade_propose(text,text,text,text,text,int,int,jsonb) from public;
revoke all on function public.economy_tick()     from public;
revoke all on function public.economy_tick_all() from public;
grant execute on function public.market_sell_resource(text,numeric)  to authenticated;
grant execute on function public.market_buy_resource(text,numeric)   to authenticated;
grant execute on function public.market_tick()                       to anon, authenticated;
grant execute on function public.economy_sell_resource(text,numeric,text) to authenticated;
grant execute on function public.trade_propose(text,text,text,text,text,int,int,jsonb) to authenticated;
grant execute on function public.economy_tick()     to authenticated;
grant execute on function public.economy_tick_all() to anon, authenticated;

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) select count(*) from public.market_resources;               -- = число ресурсов справочника
-- 2) select name, base_price, price, stock from public.market_resources order by base_price desc;
-- 3) select public.market_tick(); select public.market_tick();   -- второй раз days=0 (идемпотентно)
-- 4) Продажа двигает цену вниз / покупка вверх:
--      select public.market_sell_resource('Железо', 100000);     -- цена Железа просядет
--      select public.market_buy_resource('Железо', 50000);       -- цена подрастёт
-- 5) Живая цена видна везде: select public._res_value('Гравиядро');
