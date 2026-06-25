-- ============================================================
-- БИРЖА БРЕНДОВ · «свой товар» отдельной строкой на рынке
--   Каждая держава продаёт СВОИ товары (resources['Товары']) под СВОИМ
--   именем (goods_brand) по СВОЕЙ цене (goods_price). Другие игроки покупают
--   именно твой бренд: ГС переходят тебе, товары — покупателю.
--
-- ПРИМЕНЯТЬ ПОСЛЕ: _goods_factory.sql. Идемпотентно.
-- ============================================================

alter table public.faction_economy add column if not exists goods_price numeric;  -- цена за ед., owner-set

-- ── Доска брендов: все державы, у кого есть товары или задан бренд ──
create or replace function public.goods_market_board()
returns jsonb language sql security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'fid',   fe.faction_id,
      'name',  public._fac_name(fe.faction_id),
      'brand', fe.goods_brand,
      'price', coalesce(fe.goods_price, 14),
      'stock', floor(coalesce((fe.resources->>'Товары')::numeric, 0))
    ) order by floor(coalesce((fe.resources->>'Товары')::numeric,0)) desc), '[]'::jsonb)
  from public.faction_economy fe
  where coalesce((fe.resources->>'Товары')::numeric, 0) > 0 or fe.goods_brand is not null;
$$;
revoke all on function public.goods_market_board() from public;
grant execute on function public.goods_market_board() to authenticated;

-- ── Назначить цену своему товару ──
create or replace function public.goods_set_price(p_price numeric)
returns numeric language plpgsql security definer set search_path=public as $$
declare fid text; v numeric;
begin
  fid := public._ec_my_fid();
  v := greatest(1, round(coalesce(p_price, 14)));
  update public.faction_economy set goods_price = v where faction_id = fid;
  return v;
end$$;
revoke all on function public.goods_set_price(numeric) from public;
grant execute on function public.goods_set_price(numeric) to authenticated;

-- ── Купить чужой товар (бренд) ──
create or replace function public.goods_buy(p_seller_fid text, p_units int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  buyer text; seller public.faction_economy; b public.faction_economy;
  price numeric; have numeric; units int; cost numeric; cap numeric; bhave numeric;
begin
  buyer := public._ec_my_fid();
  if p_seller_fid = buyer then raise exception 'нельзя купить свой же товар'; end if;
  if coalesce(p_units,0) <= 0 then raise exception 'кол-во должно быть > 0'; end if;

  -- блокируем обе строки в стабильном порядке (избегаем дедлоков)
  if buyer < p_seller_fid then
    select * into b      from public.faction_economy where faction_id = buyer        for update;
    select * into seller from public.faction_economy where faction_id = p_seller_fid for update;
  else
    select * into seller from public.faction_economy where faction_id = p_seller_fid for update;
    select * into b      from public.faction_economy where faction_id = buyer        for update;
  end if;
  if seller.faction_id is null then raise exception 'продавец не найден'; end if;

  price := greatest(1, coalesce(seller.goods_price, 14));
  have  := floor(coalesce((seller.resources->>'Товары')::numeric, 0));
  -- лимит склада покупателя
  cap := 1000 + coalesce((select sum(slots_open) from public.colony_buildings
                          where faction_id = buyer and btype = 'warehouse'), 0) * 500;
  bhave := coalesce((b.resources->>'Товары')::numeric, 0);

  units := least(p_units, have, floor(coalesce(b.gc,0) / price), greatest(0, floor(cap - bhave)));
  if units <= 0 then raise exception 'нечего купить: проверь склад продавца, свою казну и место на складе'; end if;
  cost := units * price;

  update public.faction_economy
    set gc = gc + cost,
        resources = jsonb_set(resources, array['Товары'], to_jsonb(have - units), true)
    where faction_id = p_seller_fid;
  update public.faction_economy
    set gc = greatest(0, gc - cost),
        resources = jsonb_set(coalesce(resources,'{}'::jsonb), array['Товары'], to_jsonb(bhave + units), true)
    where faction_id = buyer;

  return jsonb_build_object('units', units, 'cost', cost, 'price', price,
    'brand', coalesce(seller.goods_brand, 'Товары'), 'seller', public._fac_name(p_seller_fid));
end$$;
revoke all on function public.goods_buy(text,int) from public;
grant execute on function public.goods_buy(text,int) to authenticated;

-- Проверка:
-- select public.goods_market_board();
