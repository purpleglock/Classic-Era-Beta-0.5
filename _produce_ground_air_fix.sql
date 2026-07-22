-- ─────────────────────────────────────────────────────────────
-- ФИКС: «this category is not produced here» при заказе наземки/авиации
-- ─────────────────────────────────────────────────────────────
-- ПРИЧИНА: система «Звёздный марш» строит юниты category='ground' и
-- 'aviation' (ecProduceUnit в economy.js), но серверный economy_produce
-- принимал только 'division' и 'ship' → любой ground/aviation падал с
-- 'this category is not produced here'. Игрок видел «не здесь строится».
--
-- ЧИНИМ: economy_produce маппит все 4 категории:
--   ship     → line 'shipyard'         (Корабельная Верфь)
--   aviation → line 'airfield'         (Аэрокосмический Завод)
--   ground   → line 'military_factory' (Военный Завод)
--   division → line 'army' (легаси; новые дивизии не проектируются)
--
-- База — последняя прод-версия economy_produce из _unit_market_drain.sql
-- (склад → дефицит докупается с рынка ×1.5). ГЕЙТ ВМЕСТИМОСТИ ФЛОТА для
-- кораблей сохранён из _defense_starbase.sql.
-- Катить ПОСЛЕДНИМ (после _unit_market_drain / _defense_starbase).
-- ─────────────────────────────────────────────────────────────

create or replace function public.economy_produce(p_unit_id uuid, p_qty int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; u public.faction_units; qty int;
  base_cost numeric; surcharge numeric := 0; total numeric;
  cat text; ln text; w int; rdy timestamptz;
  bill jsonb; res jsonb; spent jsonb := '{}'::jsonb; bought jsonb := '{}'::jsonb;
  rkey text; rneed numeric; rhave numeric; rcons numeric; rshort numeric;
  mr public.market_resources;
  v_cap int; v_have int;        -- ГЕЙТ ВМЕСТИМОСТИ ФЛОТА (слайс «Звёздная База»)
begin
  fid := public._ec_my_fid();
  qty := greatest(1, coalesce(p_qty, 1));
  select * into u from public.faction_units where id = p_unit_id;
  if not found then raise exception 'unit design not found'; end if;
  -- свои ИЛИ общедоступные (faction_id null); чужие фракционные — нельзя
  if u.faction_id is not null and u.faction_id is distinct from fid then raise exception 'not your design'; end if;

  -- ★ ФИКС: наземка и авиация теперь тоже строятся (Звёздный марш)
  -- ★ ПЕХОТА: класс 'peh' лежит в БД как category='ground' (единый армейский форж),
  --   но набирается в ЦЕНТРЕ ПОДГОТОВКИ — линия 'training', не Военный Завод.
  --   У роботов носитель пехоты = Военный Завод (см. _faction_is_robot), поэтому
  --   линия выбирается по расе/правлению.
  if    u.category = 'ship'     then cat:='ship';     ln:='shipyard';         w:=1;
  elsif u.category = 'aviation' then cat:='aviation'; ln:='airfield';         w:=1;
  elsif u.category = 'ground' and coalesce(u.data->>'class','') = 'peh' then
    cat:='ground';
    ln := case when public._faction_is_robot(fid) then 'military_factory' else 'training' end;
    w:=1;
  elsif u.category = 'ground'   then cat:='ground';   ln:='military_factory'; w:=1;
  elsif u.category = 'division' then cat:='division'; ln:='army';             w:=0;
  else raise exception 'this category is not produced here'; end if;

  -- ⚓ ГЕЙТ ВМЕСТИМОСТИ ФЛОТА: корабли нельзя строить сверх вместимости Звёздных Баз.
  if cat = 'ship' then
    v_cap  := public._fleet_capacity(fid);
    v_have := public._fleet_used(fid);
    if v_have + qty > v_cap then
      raise exception 'Превышена вместимость флота: занято %, мест всего % (≈% кораблей/слот). Постройте Звёздную Базу или откройте её слот, затем повторите. Запрошено ещё %.',
        v_have, v_cap, public._defense_const('starbase_cap_per_slot'), qty;
    end if;
  end if;

  base_cost := coalesce((u.summary->>'cost')::numeric, 0) * qty;
  bill := coalesce(u.summary->'bill', '{}'::jsonb);

  -- запираем строку экономики на время расчёта (анти-гонка двойной закладки)
  select coalesce(resources, '{}'::jsonb) into res
    from public.faction_economy where faction_id = fid for update;
  if res is null then raise exception 'no economy'; end if;

  -- по каждому ресурсу: тратим со склада сколько есть, дефицит ДОКУПАЕМ С РЫНКА ×1.5
  for rkey, rneed in select key, (value)::numeric * qty from jsonb_each_text(bill) loop
    if rneed is null or rneed <= 0 then continue; end if;
    rhave  := coalesce((res->>rkey)::numeric, 0);
    rcons  := least(rhave, rneed);
    rshort := rneed - rcons;
    if rcons > 0 then
      res   := jsonb_set(res,   array[rkey], to_jsonb(rhave - rcons), true);
      spent := jsonb_set(spent, array[rkey], to_jsonb(rcons), true);
    end if;
    if rshort > 0 then
      mr := public._market_ensure(rkey);   -- блокирует строку рынка (FOR UPDATE)
      if mr.stock < rshort then
        raise exception 'Не хватает «%» на рынке: нужно докупить % ед., в продаже % ед. Дождитесь обновления рынка или закупки у других держав.',
          rkey, floor(rshort), floor(mr.stock);
      end if;
      surcharge := surcharge + rshort * mr.price * 1.5;
      bought    := jsonb_set(bought, array[rkey], to_jsonb(rshort), true);
      update public.market_resources
         set stock = greatest(1, stock - rshort),
             price = public._market_price_calc(base_price, greatest(1, stock - rshort), equilibrium),
             updated_at = now()
       where name = rkey;
    end if;
  end loop;
  surcharge := ceil(surcharge);
  total := base_cost + surcharge;

  select coalesce(last_tick, now()) + interval '1 day' into rdy
    from public.faction_economy where faction_id = fid;
  if rdy is null then rdy := now() + interval '1 day'; end if;

  update public.faction_economy
     set gc = gc - total, resources = res
   where faction_id = fid and gc >= total;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.unit_production
    (faction_id, owner_id, unit_id, unit_name, category, line, weight, qty, status, ready_at, res_spent, res_surcharge, res_market)
  values
    (fid, auth.uid(), u.id, u.name, cat, ln, w, qty, 'queued', rdy, spent, surcharge, bought);

  return jsonb_build_object('ok', true, 'cost', total, 'gc_base', base_cost,
    'surcharge', surcharge, 'res_spent', spent, 'res_market', bought, 'qty', qty, 'ready_at', rdy);
end$$;
revoke all on function public.economy_produce(uuid,int) from public;
grant execute on function public.economy_produce(uuid,int) to authenticated;

-- Проверка: заказать наземку/авиацию — должно вернуть {ok:true}, не падать.
-- select public.economy_produce('<ground unit uuid>', 1);
