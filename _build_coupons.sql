-- ─────────────────────────────────────────────────────────────
-- ОСКОЛКИ ЦИКЛА (админ-выдача) — бывш. «купоны на строительство»
-- ─────────────────────────────────────────────────────────────
-- Админ выдаёт державе осколки цикла. Если осколки есть, при заказе юнита
-- игрок получает ВЫБОР: построить как обычно (ГС + сырьё + сутки очереди)
-- либо потратить осколок — бесплатно и мгновенно.
--
-- ДВА ВИДА ОСКОЛКОВ:
--   • универсальный (faction_economy.build_coupons) — годится на ЛЮБОЙ класс;
--   • классовый (faction_economy.cycle_shards jsonb, ключи ship/aviation/
--     ground/inf) — годится только на свой класс юнитов.
-- При закладке за осколок сначала тратятся КЛАССОВЫЕ осколки нужного класса,
-- и только нехватка добирается из УНИВЕРСАЛЬНЫХ.
--
-- 1 осколок = 1 юнит. Закладка за осколок:
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
  add column if not exists build_coupons int not null default 0;          -- универсальные осколки
alter table public.faction_economy
  add column if not exists cycle_shards jsonb not null default '{}'::jsonb; -- классовые осколки: флот по классам корабля (corvette…dreadnought) + aviation/ground/inf

-- Осколки видны игроку в обычной выборке faction_economy (RLS уже настроена).

-- ── Заказ за осколок ────────────────────────────────────────
create or replace function public.economy_produce_coupon(p_unit_id uuid, p_qty int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; u public.faction_units; qty int;
  cat text; ln text; w int;
  key text; have_class int; have_uni int; from_class int; from_uni int;
begin
  fid := public._ec_my_fid();
  qty := greatest(1, coalesce(p_qty, 1));

  select * into u from public.faction_units where id = p_unit_id;
  if not found then raise exception 'unit design not found'; end if;
  -- свои ИЛИ общедоступные проекты; чужие фракционные — нельзя
  if u.faction_id is not null and u.faction_id is distinct from fid then raise exception 'not your design'; end if;

  -- та же раскладка категорий, что и в economy_produce (_produce_ground_air_fix.sql)
  -- key — класс осколка: у ФЛОТА это КЛАСС КОРАБЛЯ (corvette/frigate/…/dreadnought
  -- из data.class), у прочих родов — сам род (aviation/ground/inf).
  if    u.category = 'ship'     then cat:='ship';     ln:='shipyard';         w:=1; key:=coalesce(nullif(u.data->>'class',''), 'corvette');
  elsif u.category = 'aviation' then cat:='aviation'; ln:='airfield';         w:=1; key:='aviation';
  elsif u.category = 'ground' and coalesce(u.data->>'class','') = 'peh' then
    cat:='ground';
    ln := case when public._faction_is_robot(fid) then 'military_factory' else 'training' end;
    w:=1; key:='inf';
  elsif u.category = 'ground'   then cat:='ground';   ln:='military_factory'; w:=1; key:='ground';
  else raise exception 'this category is not produced here'; end if;

  -- атомарно берём остатки: сначала классовые, добор из универсальных
  select coalesce((cycle_shards->>key)::int, 0), coalesce(build_coupons, 0)
    into have_class, have_uni
    from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;

  if have_class + have_uni < qty then
    raise exception 'Недостаточно осколков цикла: нужно %, есть % (класса «%» — %, универсальных — %).',
      qty, have_class + have_uni, key, have_class, have_uni;
  end if;

  from_class := least(have_class, qty);
  from_uni   := qty - from_class;

  update public.faction_economy
     set cycle_shards  = jsonb_set(coalesce(cycle_shards, '{}'::jsonb),
                                    array[key], to_jsonb(have_class - from_class)),
         build_coupons = have_uni - from_uni
   where faction_id = fid;

  -- сразу готовый юнит: 'done' обходит триггеры, висящие на status='queued'
  insert into public.unit_production
    (faction_id, owner_id, unit_id, unit_name, category, line, weight, qty, status, ready_at, res_spent, res_surcharge, res_market)
  values
    (fid, auth.uid(), u.id, u.name, cat, ln, w, qty, 'done', now(), '{}'::jsonb, 0, '{}'::jsonb);

  return jsonb_build_object('ok', true, 'coupon', true, 'qty', qty,
    'class', key, 'class_left', have_class - from_class, 'uni_left', have_uni - from_uni,
    'coupons_left', have_uni - from_uni,   -- совместимость со старым клиентом
    'unit_name', u.name);
end$$;
revoke all on function public.economy_produce_coupon(uuid,int) from public;
grant execute on function public.economy_produce_coupon(uuid,int) to authenticated;

-- Проверка:
--   update public.faction_economy set build_coupons = 3,
--     cycle_shards = '{"ship":2,"aviation":1}'::jsonb where faction_id = '<fid>';
--   select public.economy_produce_coupon('<ship uuid>', 3);
--     -- → class_left=0 (израсходованы 2 ship), uni_left=2 (добор 1 из универсальных)
