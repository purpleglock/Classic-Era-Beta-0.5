-- ============================================================================
--  БИРЖА · СРЕЗ 8 — ЗАКАЗЫ (ГОСЗАКАЗЫ / RFQ: биржа закупок ресурсов)
--  Применять в Supabase → SQL Editor ПОСЛЕ _exchange_corps.sql (можно и после
--  любого другого биржевого среза — слайс самодостаточен). Идемпотентно.
--  Зависит от: _economy_setup.sql (faction_economy: gc/resources, _ec_my_fid,
--    current_user_banned), _faction_setup/_security (_fac_name),
--    _news_mentions.sql (_post_life_news).
--
--  ИДЕЯ (запрос юзера). Фракция выставляет ЗАКАЗ на закупку — «Куплю {ресурс}
--  × {объём} по {цена}/ед». Заказ объявляется в ленте «Хроника сектора» и висит
--  на ДОСКЕ ЗАКАЗОВ. Любая другая фракция, у которой есть этот ресурс, может
--  ОТОЗВАТЬСЯ и выполнить заказ (полностью или частично) — отдаёт единицы со
--  склада и мгновенно получает ГС, заказчик получает ресурс.
--
--  ПОЧЕМУ ЭТО «БИРЖЕВОЕ», А НЕ ПРОСТО ДОСКА ОБЪЯВЛЕНИЙ:
--    • ЭСКРОУ — при размещении заказа из казны заказчика СРАЗУ блокируется
--      объём×цена. Исполнитель получает деньги гарантированно из эскроу, а не
--      «по доброй воле» заказчика. Это твёрдая заявка (firm bid), как стакан
--      на покупку.
--    • ЧАСТИЧНОЕ ИСПОЛНЕНИЕ — заказ на 1000 ед. могут закрыть пятеро по 200.
--      Остаток эскроу хранится до полного исполнения / отмены / истечения.
--    • СРОК ЖИЗНИ — заказ живёт N суток; по истечении эскроу возвращается
--      заказчику (orders_sweep: lazy при заходе + pg_cron).
--  Поставка мгновенная (как спот-сделка): склад заказчика — биржевой пункт
--  приёмки, отдельный караван не нужен (это «биржа», не логистика).
-- ============================================================================

-- ── Таблица заказов ──────────────────────────────────────────────────────────
create table if not exists public.exchange_orders (
  id          uuid primary key default gen_random_uuid(),
  buyer_fid   text not null,                 -- фракция-заказчик
  buyer_name  text,
  resource    text not null,                 -- какой ресурс закупается (имя как в складе)
  qty_total   numeric not null,              -- сколько всего нужно
  qty_filled  numeric not null default 0,    -- сколько уже поставлено
  price       numeric not null,              -- ГС за 1 единицу
  escrow      numeric not null,              -- заблокированная казна на НЕисполненный остаток
  note        text,                          -- комментарий заказчика
  status      text not null default 'open',  -- open|filled|cancelled|expired
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists xorders_status on public.exchange_orders(status);
create index if not exists xorders_buyer  on public.exchange_orders(buyer_fid);
alter table public.exchange_orders enable row level security;
-- Доступ — только через SECURITY DEFINER RPC ниже (прямой DML закрыт RLS).

-- ════════════════════════════════════════════════════════════════════════════
--  orders_sweep() — истёкшие заказы: вернуть остаток эскроу заказчику, закрыть.
--  Идемпотентно. Зовётся лениво из orders_status() + по pg_cron.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.orders_sweep()
returns jsonb language plpgsql security definer set search_path=public as $$
declare o record; n int := 0;
begin
  -- 1) Истёкшие заказы: вернуть остаток эскроу, закрыть.
  -- 2) «Мусорные» заказы на нескладские ресурсы (напр. ОН/ГС, ошибочно созданные
  --    до валидации order_create): они невыполнимы — возвращаем эскроу и гасим.
  for o in select * from public.exchange_orders
           where status = 'open'
             and ( (expires_at is not null and expires_at < now())
                or not exists (select 1 from public.resource_rarity where name = exchange_orders.resource) )
           for update loop
    if o.escrow > 0 then
      update public.faction_economy set gc = gc + o.escrow where faction_id = o.buyer_fid;
    end if;
    update public.exchange_orders
       set status = 'expired', escrow = 0, updated_at = now() where id = o.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'expired', n);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  order_create() — выставить заказ на закупку. Блокирует эскроу = qty×price.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.order_create(
  p_resource text, p_qty numeric, p_price numeric, p_note text default null, p_days int default 7)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; nm text; eco public.faction_economy; cost numeric; cnt int; v_id uuid; res text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  res := btrim(coalesce(p_resource, ''));
  if length(res) < 1 then raise exception 'bad resource'; end if;
  -- Заказывать можно только РЕАЛЬНЫЙ складской ресурс (есть в справочнике редкости).
  -- ГС/ОН — это валюты (faction_economy.gc/.science), их в `resources` не бывает,
  -- значит заказ на них невыполним и лишь засоряет доску. Отсекаем сразу.
  if not exists (select 1 from public.resource_rarity where name = res) then
    raise exception 'bad resource: % is not a tradeable warehouse resource', res;
  end if;
  if p_qty   is null or p_qty   <  1 then raise exception 'bad qty'; end if;
  if p_price is null or p_price <  1 then raise exception 'bad price'; end if;
  fid := public._ec_my_fid();

  select count(*) into cnt from public.exchange_orders where buyer_fid = fid and status = 'open';
  if cnt >= 20 then raise exception 'too many open orders (max 20)'; end if;

  cost := floor(p_qty) * floor(p_price);                 -- цельночисленные единицы/цена
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  if eco.gc < cost then raise exception 'not enough GC for escrow'; end if;

  update public.faction_economy set gc = gc - cost where faction_id = fid;  -- блок эскроу
  nm := coalesce(nullif(public._fac_name(fid), ''), 'Держава');
  insert into public.exchange_orders(buyer_fid, buyer_name, resource, qty_total, price, escrow, note, expires_at)
    values (fid, nm, res, floor(p_qty), floor(p_price),
            cost, nullif(btrim(coalesce(p_note,'')),''),
            now() + (greatest(1, least(coalesce(p_days,7), 60)) || ' days')::interval)
    returning id into v_id;

  begin perform public._post_life_news(
    '📋 Биржа заказов: новый госзаказ',
    format('%s размещает заказ: закупить %s ед. «%s» по %s ГС/ед (всего до %s ГС). Желающие могут выполнить заказ из своих запасов на вкладке Биржа → Заказы.',
           nm, floor(p_qty)::text, res, floor(p_price)::text, cost::text),
    'rgba(95,160,201,0.5)', '[]'::jsonb);
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'id', v_id, 'escrow', cost);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  order_fulfill() — выполнить заказ (полностью/частично) из своих запасов.
--  Поставщик отдаёт ресурс → получает ГС из эскроу; заказчик получает ресурс.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.order_fulfill(p_order uuid, p_qty numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; o public.exchange_orders; remaining numeric; have numeric; take numeric;
        pay numeric; done boolean := false;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_qty is null or p_qty < 1 then raise exception 'bad qty'; end if;
  fid := public._ec_my_fid();

  select * into o from public.exchange_orders where id = p_order for update;
  if not found then raise exception 'no order'; end if;
  if o.status <> 'open' then raise exception 'order not open'; end if;
  if o.buyer_fid = fid then raise exception 'cannot fulfill own order'; end if;

  remaining := o.qty_total - o.qty_filled;
  if remaining <= 0 then raise exception 'order already filled'; end if;

  -- сколько реально могу поставить: min(запрошено, остаток заказа, мой склад)
  select coalesce((resources->>o.resource)::numeric, 0) into have
    from public.faction_economy where faction_id = fid for update;
  take := least(floor(p_qty), remaining, floor(coalesce(have,0)));
  if take <= 0 then raise exception 'nothing to deliver (no stock or order full)'; end if;

  pay := take * o.price;
  if pay > o.escrow then pay := o.escrow; end if;       -- страховка: не платим больше эскроу

  -- поставщик: −ресурс, +ГС
  update public.faction_economy
     set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[o.resource],
                       to_jsonb(coalesce((resources->>o.resource)::numeric,0) - take), true),
         gc = gc + pay
   where faction_id = fid;
  -- заказчик: +ресурс (ГС уже списан в эскроу при размещении)
  update public.faction_economy
     set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[o.resource],
                       to_jsonb(coalesce((resources->>o.resource)::numeric,0) + take), true)
   where faction_id = o.buyer_fid;

  update public.exchange_orders
     set qty_filled = qty_filled + take,
         escrow     = greatest(0, escrow - pay),
         status     = case when qty_filled + take >= qty_total then 'filled' else 'open' end,
         updated_at = now()
   where id = o.id;
  done := (o.qty_filled + take >= o.qty_total);

  if done then
    -- остаток эскроу (если цена была округлена) вернуть заказчику
    if o.escrow - pay > 0 then
      update public.faction_economy set gc = gc + (o.escrow - pay) where faction_id = o.buyer_fid;
      update public.exchange_orders set escrow = 0 where id = o.id;
    end if;
    begin perform public._post_life_news(
      '✅ Биржа заказов: заказ выполнен',
      format('Госзаказ «%s» (%s ед.) заказчика %s полностью исполнен.',
             o.resource, o.qty_total::text, o.buyer_name),
      'rgba(95,201,138,0.5)', jsonb_build_array(o.buyer_fid));
    exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true, 'delivered', take, 'earned', pay, 'filled', done);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  order_cancel() — заказчик снимает свой открытый заказ; остаток эскроу назад.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.order_cancel(p_order uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; o public.exchange_orders;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into o from public.exchange_orders where id = p_order for update;
  if not found then raise exception 'no order'; end if;
  if o.buyer_fid <> fid then raise exception 'not your order'; end if;
  if o.status <> 'open' then raise exception 'order not open'; end if;
  if o.escrow > 0 then
    update public.faction_economy set gc = gc + o.escrow where faction_id = fid;
  end if;
  update public.exchange_orders set status = 'cancelled', escrow = 0, updated_at = now() where id = o.id;
  return jsonb_build_object('ok', true, 'refunded', o.escrow);
end$$;

-- ════════════════════════════════════════════════════════════════════════════
--  orders_status() — данные для UI «Заказы». Лениво подметает истёкшие.
--    mine  — мои заказы (открытые + недавняя история);
--    board — открытые заказы ДРУГИХ фракций (+ my_stock = мой склад по ресурсу).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.orders_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; my_res jsonb;
begin
  begin perform public.orders_sweep(); exception when others then null; end;
  fid := public._ec_my_fid();
  select coalesce(resources, '{}'::jsonb) into my_res from public.faction_economy where faction_id = fid;
  return jsonb_build_object(
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'resource', o.resource, 'qty_total', o.qty_total, 'qty_filled', o.qty_filled,
        'price', o.price, 'escrow', o.escrow, 'note', o.note, 'status', o.status,
        'expires_at', o.expires_at, 'created_at', o.created_at)
      order by (o.status = 'open') desc, o.updated_at desc)
      from public.exchange_orders o
      where o.buyer_fid = fid and (o.status = 'open' or o.updated_at > now() - interval '3 days')), '[]'::jsonb),
    'board', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'buyer', o.buyer_name, 'resource', o.resource,
        'qty_total', o.qty_total, 'qty_filled', o.qty_filled,
        'remaining', o.qty_total - o.qty_filled, 'price', o.price, 'note', o.note,
        'expires_at', o.expires_at, 'created_at', o.created_at,
        'my_stock', floor(coalesce((my_res->>o.resource)::numeric, 0)))
      order by o.created_at desc)
      from public.exchange_orders o
      where o.status = 'open' and o.buyer_fid <> fid), '[]'::jsonb)
  );
end$$;

-- ── Часовой pg_cron: подметание истёкших заказов ────────────────────────────
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      if exists (select 1 from cron.job where jobname = 'exchange-orders-sweep') then
        perform cron.unschedule('exchange-orders-sweep');
      end if;
      perform cron.schedule('exchange-orders-sweep', '7 * * * *', 'select public.orders_sweep();');
      raise notice 'pg_cron: orders_sweep запланирован (каждый час :07)';
    exception when others then
      raise notice 'pg_cron для заказов настроить не удалось (%) — истечение поймает заход игрока (orders_status)', sqlerrm;
    end;
  else
    raise notice 'pg_cron недоступен — истечение заказов поймает заход игрока (orders_status → orders_sweep)';
  end if;
end$$;

-- ── Права ────────────────────────────────────────────────────────────────────
revoke all on function public.orders_sweep()                       from public;
revoke all on function public.order_create(text,numeric,numeric,text,int) from public;
revoke all on function public.order_fulfill(uuid,numeric)          from public;
revoke all on function public.order_cancel(uuid)                   from public;
revoke all on function public.orders_status()                      from public;
grant execute on function public.orders_sweep()                       to anon, authenticated;
grant execute on function public.order_create(text,numeric,numeric,text,int) to authenticated;
grant execute on function public.order_fulfill(uuid,numeric)          to authenticated;
grant execute on function public.order_cancel(uuid)                   to authenticated;
grant execute on function public.orders_status()                      to authenticated;

-- PostgREST: подхватить новые сигнатуры
notify pgrst, 'reload schema';

-- ── Проверка ────────────────────────────────────────────────────────────────
-- 1) (заказчик) select order_create('Дилитий', 500, 12, 'для верфей', 7);
--      → из казны списано 6000 ГС (эскроу), новость в ленте.
-- 2) select jsonb_pretty(orders_status());  -- 'mine': мой заказ open, escrow=6000
-- 3) (другая фракция со складом «Дилитий») select orders_status();
--      → 'board': заказ виден, my_stock = мой запас.
--    select order_fulfill('<id>', 200);  -- отдал 200 ед., получил 2400 ГС
-- 4) Заказчик: +200 «Дилитий» на склад, escrow 6000→3600.
-- 5) Добить заказ (order_fulfill ещё на 300) → status='filled', новость «выполнен».
-- 6) (заказчик) select order_cancel('<id открытого>');  -- остаток эскроу назад.
-- 7) update exchange_orders set expires_at = now() - interval '1 day' where id='<id>';
--      select orders_sweep();  -- 'expired', эскроу возвращён.
