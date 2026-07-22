-- ─────────────────────────────────────────────────────────────
-- КУПОНЫ НА СТРОИТЕЛЬСТВО (админ-выдача)
-- ─────────────────────────────────────────────────────────────
-- Админ выдаёт державе купоны (faction_economy.build_coupons). Если купоны
-- есть, при заказе юнита игрок получает ВЫБОР: построить как обычно (ГС +
-- сырьё + сутки очереди) либо потратить купон — бесплатно и мгновенно.
--
-- 1 купон = 1 юнит. Купонная закладка:
--   • не тратит ГС и сырьё (bill игнорируется, рынок не трогается);
--   • не ждёт хода: строка unit_production сразу status='done', ready_at=now()
--     → юнит немедленно в «⚔ Вооружённые силы»;
--   • обходит гейты, привязанные к статусу 'queued' (военный бюджет,
--     скорость военпрома) и лимиты цехов/вместимости флота — это подарок
--     администрации, а не производство.
--
-- Порядок: катить ПОСЛЕ _produce_ground_air_fix.sql (мы читаем ту же
-- раскладку category → line). Обычный economy_produce НЕ трогаем.
-- ─────────────────────────────────────────────────────────────

alter table public.faction_economy
  add column if not exists build_coupons int not null default 0;

-- Купоны видны игроку в обычной выборке faction_economy (RLS уже настроена).

-- ── Заказ за купон ──────────────────────────────────────────
create or replace function public.economy_produce_coupon(p_unit_id uuid, p_qty int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; u public.faction_units; qty int;
  cat text; ln text; w int; left_after int;
begin
  fid := public._ec_my_fid();
  qty := greatest(1, coalesce(p_qty, 1));

  select * into u from public.faction_units where id = p_unit_id;
  if not found then raise exception 'unit design not found'; end if;
  -- свои ИЛИ общедоступные проекты; чужие фракционные — нельзя
  if u.faction_id is not null and u.faction_id is distinct from fid then raise exception 'not your design'; end if;

  -- та же раскладка категорий, что и в economy_produce (_produce_ground_air_fix.sql)
  if    u.category = 'ship'     then cat:='ship';     ln:='shipyard';         w:=1;
  elsif u.category = 'aviation' then cat:='aviation'; ln:='airfield';         w:=1;
  elsif u.category = 'ground' and coalesce(u.data->>'class','') = 'peh' then
    cat:='ground';
    ln := case when public._faction_is_robot(fid) then 'military_factory' else 'training' end;
    w:=1;
  elsif u.category = 'ground'   then cat:='ground';   ln:='military_factory'; w:=1;
  else raise exception 'this category is not produced here'; end if;

  -- атомарно списываем купоны: не хватило — заказ не проходит
  update public.faction_economy
     set build_coupons = build_coupons - qty
   where faction_id = fid and build_coupons >= qty
  returning build_coupons into left_after;
  if not found then
    raise exception 'Недостаточно купонов: нужно %, есть %.',
      qty, coalesce((select build_coupons from public.faction_economy where faction_id = fid), 0);
  end if;

  -- сразу готовый юнит: 'done' обходит триггеры, висящие на status='queued'
  insert into public.unit_production
    (faction_id, owner_id, unit_id, unit_name, category, line, weight, qty, status, ready_at, res_spent, res_surcharge, res_market)
  values
    (fid, auth.uid(), u.id, u.name, cat, ln, w, qty, 'done', now(), '{}'::jsonb, 0, '{}'::jsonb);

  return jsonb_build_object('ok', true, 'coupon', true, 'qty', qty,
    'coupons_left', left_after, 'unit_name', u.name);
end$$;
revoke all on function public.economy_produce_coupon(uuid,int) from public;
grant execute on function public.economy_produce_coupon(uuid,int) to authenticated;

-- Проверка:
--   update public.faction_economy set build_coupons = 5 where faction_id = '<fid>';
--   select public.economy_produce_coupon('<unit uuid>', 2);   -- → coupons_left = 3
