-- ============================================================================
--  ДОКУПКА ЮНИТОВ ТЯНЕТ ИЗ ГЛОБАЛЬНОГО РЫНКА · конечный запас
--  Применять в Supabase → SQL Editor ПОСЛЕ _market_setup.sql и _unit_resources.sql.
--  Идемпотентно (create or replace + add column if not exists + миграция запаса).
--
--  ЧТО МЕНЯЕТСЯ:
--   1) Запасы рынка СНИЖЕНЫ до малых значений ради реального дефицита: legendary
--      макс. 20, остальные по редкости, но не больше 500 (см. _mk_equilibrium).
--   2) Когда при закладке юнита не хватает сырья на складе — дефицит ДОКУПАЕТСЯ
--      с рынка и теперь РЕАЛЬНО СПИСЫВАЕТСЯ С ЗАПАСА market_resources.stock
--      (цена ползёт вверх, как при обычной покупке). Раньше сырьё «доплачивалось»
--      из воздуха, рынок был бесконечным — теперь он конечен.
--   3) Если на рынке НЕ хватает запаса под дефицит — закладка ОТМЕНЯЕТСЯ целиком
--      (транзакция откатывается). Игроку надо ждать следующего суточного тика, когда
--      NPC пополнят рынок (market_tick), либо пока ресурс выставят другие игроки.
--   4) Отмена производства возвращает докупленное сырьё ОБРАТНО на рынок (восстановление
--      запаса), а не на свой склад — симметрично пункту 2.
-- ============================================================================

-- ── 1. МАЛЫЕ ЗАПАСЫ → НАСТОЯЩИЙ ДЕФИЦИТ. Самые крутые (legendary) max 20, ──────
--    остальные по-разному, но не больше 500.
--    (исходный сид был громадным: legendary 1500 / epic 10000 / … / common 800000)
create or replace function public._mk_equilibrium(p_rarity text) returns numeric language sql immutable as $$
  select case p_rarity
    when 'legendary' then 20 when 'epic' then 100 when 'rare' then 250
    when 'uncommon' then 400 else 500 end::numeric
$$;

-- Миграция живущих строк рынка: магнитуда падает в сотни/тысячи раз — масштабировать
-- бессмысленно, поэтому СБРАСЫВАЕМ запас и равновесие на новые малые значения, а NPC
-- суточный поток снижаем до ~3% равновесия (иначе NPC мгновенно бы перезаполняли рынок
-- и дефицита бы не было). Цена при stock=eq возвращается к базовой.
update public.market_resources mr
   set equilibrium = ne.neweq,
       stock       = ne.neweq,
       npc_supply  = greatest(1, round(ne.neweq * 0.03)),
       npc_demand  = greatest(1, round(ne.neweq * 0.03)),
       price       = public._market_price_calc(mr.base_price, ne.neweq, ne.neweq),
       updated_at  = now()
  from (
    select rr.name,
      (case rr.rarity when 'legendary' then 20 when 'epic' then 100 when 'rare' then 250
                      when 'uncommon' then 400 else 500 end)::numeric as neweq
    from public.resource_rarity rr
  ) ne
 where mr.name = ne.name;

-- ── Колонка учёта рыночной докупки (для возврата запаса на рынок при отмене) ──
alter table public.unit_production add column if not exists res_market jsonb default '{}'::jsonb;

-- ════════════════════════════════════════════════════════════════════════════
--  2-3. economy_produce — со склада бесплатно, дефицит тянем С РЫНКА (конечно)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.economy_produce(p_unit_id uuid, p_qty int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; u public.faction_units; qty int;
  base_cost numeric; surcharge numeric := 0; total numeric;
  cat text; ln text; w int; rdy timestamptz;
  bill jsonb; res jsonb; spent jsonb := '{}'::jsonb; bought jsonb := '{}'::jsonb;
  rkey text; rneed numeric; rhave numeric; rcons numeric; rshort numeric;
  mr public.market_resources;
begin
  fid := public._ec_my_fid();
  qty := greatest(1, coalesce(p_qty, 1));
  select * into u from public.faction_units where id = p_unit_id;
  if not found then raise exception 'unit design not found'; end if;
  -- свои ИЛИ общедоступные (faction_id null); чужие фракционные — нельзя
  if u.faction_id is not null and u.faction_id is distinct from fid then raise exception 'not your design'; end if;

  if u.category = 'division' then cat:='division'; ln:='army';     w:=0;
  elsif u.category = 'ship'   then cat:='ship';     ln:='shipyard'; w:=1;
  else raise exception 'this category is not produced here'; end if;

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
      -- рынок конечен: нечем закрыть дефицит → откат закладки, ждать пополнения
      if mr.stock < rshort then
        raise exception 'Не хватает «%» на рынке: нужно докупить % ед., в продаже % ед. Дождитесь обновления рынка или закупки у других держав.',
          rkey, floor(rshort), floor(mr.stock);
      end if;
      surcharge := surcharge + rshort * mr.price * 1.5;
      bought    := jsonb_set(bought, array[rkey], to_jsonb(rshort), true);
      -- списываем запас рынка → цена ползёт вверх (как обычная покупка)
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

  -- атомарно: списываем ГС (если хватает) и обновляем склад
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

-- ════════════════════════════════════════════════════════════════════════════
--  4. economy_cancel_production — возврат ГС + сырья на склад + докупки на РЫНОК
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.economy_cancel_production(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; q public.unit_production; refund numeric := 0;
  res jsonb; spent jsonb; bought jsonb; rkey text; rval numeric;
begin
  fid := public._ec_my_fid();
  select * into q from public.unit_production where id = p_id;
  if not found then raise exception 'production not found'; end if;
  if q.faction_id is distinct from fid then raise exception 'not your production'; end if;
  if q.status <> 'queued' then raise exception 'already delivered'; end if;

  -- база: cost*qty по дизайну (как раньше) + наценка за дефицит, уплаченная при закладке
  select coalesce((u.summary->>'cost')::numeric, 0) * coalesce(q.qty, 0) into refund
    from public.faction_units u where u.id = q.unit_id;
  refund := coalesce(refund, 0) + coalesce(q.res_surcharge, 0);

  spent  := coalesce(q.res_spent, '{}'::jsonb);
  bought := coalesce(q.res_market, '{}'::jsonb);

  delete from public.unit_production where id = p_id;

  -- возвращаем потраченное со склада сырьё обратно на склад (без проверки ёмкости — возврат)
  select coalesce(resources, '{}'::jsonb) into res
    from public.faction_economy where faction_id = fid for update;
  for rkey, rval in select key, (value)::numeric from jsonb_each_text(spent) loop
    if rval is null or rval = 0 then continue; end if;
    res := jsonb_set(res, array[rkey], to_jsonb(coalesce((res->>rkey)::numeric, 0) + rval), true);
  end loop;

  update public.faction_economy
     set gc = gc + refund, resources = res
   where faction_id = fid;

  -- возвращаем докупленное на РЫНОК (восстановление запаса → цена обратно вниз)
  for rkey, rval in select key, (value)::numeric from jsonb_each_text(bought) loop
    if rval is null or rval = 0 then continue; end if;
    perform public._market_ensure(rkey);   -- гарантировать/заблокировать строку
    update public.market_resources
       set stock = stock + rval,
           price = public._market_price_calc(base_price, stock + rval, equilibrium),
           updated_at = now()
     where name = rkey;
  end loop;

  return jsonb_build_object('ok', true, 'refund', refund, 'res_returned', spent, 'res_market_returned', bought);
end$$;
revoke all on function public.economy_cancel_production(uuid) from public;
grant execute on function public.economy_cancel_production(uuid) to authenticated;

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) Запасы малые: select name, stock, equilibrium, npc_supply from public.market_resources order by base_price desc;
--    (legendary ≈ 20, common ≤ 500)
-- 2) Закладка юнита с дефицитом редкого сырья при пустом рынке должна падать с
--    русским сообщением «Не хватает … на рынке». Запас рынка падает при успехе:
--      select stock from public.market_resources where name='Гравиядро';
--      select public.economy_produce('<ship_uuid>', 5);
--      select stock from public.market_resources where name='Гравиядро';   -- меньше
-- 3) Отмена возвращает запас на рынок:
--      select public.economy_cancel_production('<prod_uuid>');             -- stock назад
