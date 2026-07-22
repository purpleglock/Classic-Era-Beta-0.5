-- ════════════════════════════════════════════════════════════════════════════
--  ФИКС: economy load падал с 21000 "UPDATE requires a WHERE clause"
--
--  Причина: pg_safeupdate (session-preload в Supabase) запрещает UPDATE без WHERE.
--  Суточный тик economy_tick → economy_accrue → market_tick(), а market_tick
--  массово правил public.market_resources БЕЗ where — первый же такой UPDATE
--  ронял весь заход в кабинет ("Не удалось загрузить экономику").
--
--  Лечение: на каждый bulk-UPDATE по всей таблице добавлен `where true`
--  (pg_safeupdate доволен любым WHERE). Логика не меняется.
--
--  Безопасно запускать повторно. Если у вас применён _mining_market_routing.sql
--  (market_tick с cfg-логикой) — примените ИМЕННО его исправленную версию,
--  этот файл вернёт market_tick к exchange-overhaul версии.
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
       set stock = greatest(1, stock + npc_supply*(0.6+random()*0.8) - npc_demand*(0.6+random()*0.8))
     where true;   -- pg_safeupdate требует WHERE
    -- усиленная волатильность: дополнительный мультипликативный шум ±4%/сутки
    update public.market_resources
       set stock = greatest(1, stock * (0.96 + random()*0.08))
     where true;
    -- медленный возврат запаса к равновесию (mean reversion)
    update public.market_resources
       set stock = stock + (equilibrium - stock) * 0.08
     where true;
  end loop;

  -- событийный шок: один раз за прогон; шанс растёт с простоем (cap 60%)
  if random() < least(0.6, 0.12 * d) then
    perform public._market_shock();
    shocked := true;
  end if;

  -- пересчёт цены от итогового запаса
  update public.market_resources
     set price = public._market_price_calc(base_price, stock, equilibrium),
         updated_at = now()
   where true;

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

revoke all on function public.market_tick() from public;
grant execute on function public.market_tick() to anon, authenticated;
