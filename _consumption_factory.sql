-- ============================================================================
--  ФАБРИКИ ПОТРЕБЛЕНИЯ · настраиваемый рецепт + КАЧЕСТВО→благополучие (2026-07-23)
--  Метод №3 роста благополучия (см. память wellbeing-growth-methods).
--
--  ЧТО ДАЁТ. До технологии фабрика товаров работает как раньше (легаси-рецепт
--  вода 0.6 + сырьё 0.4 на 1 товар, welfare ≤ 1.10). Технология
--  «Товары народного потребления» (soc.consumer_goods) открывает панель, где
--  игрок сам задаёт КАКИЕ ресурсы и СКОЛЬКО ест фабрика на 1 товар. Премиальный
--  рецепт (редкие ресурсы: старвис/хтонит = epic/legendary) поднимает ПОТОЛОК
--  благополучия с 1.10 до 1.25.
--
--  АНТИ-ЭКСПЛОЙТ. Качество рецепта = взвешенное СРЕДНЕЕ редкости входов, поэтому
--  «залить один самый дорогой ресурс» не инфлейтит бонус; плюс требование
--  РАЗНООБРАЗИЯ (полный бонус лишь при ≥3 разных входах) — стимул к торговле.
--  Бонус ещё и пропорционален фактическому обеспечению (goods_cov).
--
--  ПОРЯДОК ПРИМЕНЕНИЯ:
--    1) этот файл (создаёт узел/таблицу/RPC/хелперы — самодостаточно);
--    2) ПЕРЕКАТИТЬ _economy_accrue_consolidated.sql — его голова economy_accrue
--       (блок _wellbeing_armies) уже содержит вызов _goods_recipe (патч ниже
--       по тексту консолидированного файла). До переката механика качества
--       не работает, но фабрика продолжает крутиться на легаси-рецепте.
--  Идемпотентно (create-or-replace / if not exists / on conflict).
-- ============================================================================

-- ── 1) Технологический узел-гейт ────────────────────────────────────────────
-- Хранилище изученного = faction_economy.research (jsonb-массив node_id).
insert into public.tech_nodes (node_id, base_cost, prereq) values
  ('soc.consumer_goods', 6, '[]'::jsonb)
on conflict (node_id) do nothing;

-- ── 2) Таблица рецепта державы ──────────────────────────────────────────────
-- ingredients = [{ "res": "Старвис", "qty": 0.5 }, ...]  — qty ресурса на 1 товар.
create table if not exists public.faction_goods_recipe (
  faction_id  text primary key,
  ingredients jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.faction_goods_recipe enable row level security;
drop policy if exists fgr_select_own on public.faction_goods_recipe;
create policy fgr_select_own on public.faction_goods_recipe
  for select to authenticated using (faction_id = public._ec_my_fid());
revoke insert, update, delete on public.faction_goods_recipe from anon, authenticated;

-- ── 3) Вес качества по редкости ресурса ─────────────────────────────────────
-- Зеркало клиента: EC_QUALITY_W в economy.js.
create or replace function public._res_quality_w(p_rar text)
returns numeric language sql immutable as $$
  select case coalesce(p_rar,'common')
    when 'legendary' then 1.70
    when 'epic'      then 1.45
    when 'rare'      then 1.25
    when 'uncommon'  then 1.10
    else 1.00 end
$$;

-- ── 4) Эффективный рецепт державы (с предрасчётом качества) ──────────────────
-- Возвращает NULL, если технология не изучена ИЛИ рецепт пуст → в accrue это
-- сигнал «работать по легаси-хардкоду». Иначе:
--   { ingredients:[{res,qty,rar,q}], q_avg, diversity, total_qty }
--   diversity = min(1, число_разных_входов / 3)
create or replace function public._goods_recipe(p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  has_tech boolean; r jsonb; ing jsonb;
  nm text; qty numeric; rar text; qw numeric;
  qsum numeric := 0; wsum numeric := 0; nd int := 0;
  out_ing jsonb := '[]'::jsonb;
begin
  select coalesce(research,'[]'::jsonb) ? 'soc.consumer_goods'
    into has_tech from public.faction_economy where faction_id = p_fid;
  if not coalesce(has_tech, false) then return null; end if;

  select ingredients into r from public.faction_goods_recipe where faction_id = p_fid;
  if r is null or jsonb_array_length(r) = 0 then return null; end if;

  for ing in select value from jsonb_array_elements(r) loop
    nm  := ing->>'res';
    qty := coalesce((ing->>'qty')::numeric, 0);
    if nm is null or qty <= 0 then continue; end if;
    rar := coalesce((select rarity from public.resource_rarity where name = nm), 'common');
    qw  := public._res_quality_w(rar);
    qsum := qsum + qw * qty;
    wsum := wsum + qty;
    nd   := nd + 1;
    out_ing := out_ing || jsonb_build_object('res', nm, 'qty', qty, 'rar', rar, 'q', qw);
  end loop;

  if wsum <= 0 then return null; end if;
  return jsonb_build_object(
    'ingredients', out_ing,
    'q_avg',      round(qsum / wsum, 4),
    'diversity',  round(least(1.0, nd / 3.0), 4),
    'total_qty',  wsum);
end$$;
revoke all on function public._goods_recipe(text) from public;

-- ── 5) RPC: задать рецепт ───────────────────────────────────────────────────
-- Валидация: 1..4 ингредиента, каждый ресурс существует в каталоге, qty ∈ [0.1,2],
-- суммарный расход на 1 товар ∈ [0.5,3] (баланс к легаси = 1.0). Гейт по технологии.
create or replace function public.goods_recipe_set(p_ingredients jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; ing jsonb; nm text; qty numeric;
  n int := 0; tot numeric := 0; clean jsonb := '[]'::jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;

  if not (select coalesce(research,'[]'::jsonb) ? 'soc.consumer_goods'
          from public.faction_economy where faction_id = fid) then
    raise exception 'нужна технология «Товары народного потребления»';
  end if;

  if p_ingredients is null or jsonb_typeof(p_ingredients) <> 'array' then
    raise exception 'ingredients must be an array';
  end if;

  for ing in select value from jsonb_array_elements(p_ingredients) loop
    nm  := btrim(coalesce(ing->>'res',''));
    qty := round(coalesce((ing->>'qty')::numeric, 0), 3);
    if nm = '' then continue; end if;
    if not exists(select 1 from public.resource_rarity where name = nm) then
      raise exception 'неизвестный ресурс: %', nm;
    end if;
    if exists(select 1 from jsonb_array_elements(clean) c where c->>'res' = nm) then
      raise exception 'ресурс дублируется в рецепте: %', nm;
    end if;
    if qty < 0.1 or qty > 2 then
      raise exception 'расход «%» вне диапазона 0.1..2 на товар', nm;
    end if;
    n := n + 1; tot := tot + qty;
    clean := clean || jsonb_build_object('res', nm, 'qty', qty);
  end loop;

  if n < 1 or n > 4 then raise exception 'нужно от 1 до 4 ингредиентов'; end if;
  if tot < 0.5 or tot > 3 then raise exception 'суммарный расход на товар должен быть 0.5..3'; end if;

  insert into public.faction_goods_recipe(faction_id, ingredients, updated_at)
    values (fid, clean, now())
  on conflict (faction_id) do update set ingredients = excluded.ingredients, updated_at = now();

  return public._goods_recipe(fid);
end$$;
revoke all on function public.goods_recipe_set(jsonb) from public;
grant execute on function public.goods_recipe_set(jsonb) to authenticated;

-- ── 6) RPC: прочитать текущий рецепт + статус технологии ─────────────────────
create or replace function public.goods_recipe_get()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text; has_tech boolean; raw jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('tech', false, 'ingredients', '[]'::jsonb); end if;
  select coalesce(research,'[]'::jsonb) ? 'soc.consumer_goods' into has_tech
    from public.faction_economy where faction_id = fid;
  select ingredients into raw from public.faction_goods_recipe where faction_id = fid;
  return jsonb_build_object(
    'tech',        coalesce(has_tech, false),
    'ingredients', coalesce(raw, '[]'::jsonb),
    'effective',   public._goods_recipe(fid),   -- NULL до техи/рецепта = легаси
    'welfare_cap', case when public._goods_recipe(fid) is null then 1.10 else 1.25 end);
end$$;
revoke all on function public.goods_recipe_get() from public;
grant execute on function public.goods_recipe_get() to authenticated;

notify pgrst, 'reload schema';

-- ── Проверка после применения ───────────────────────────────────────────────
-- 1) select public.goods_recipe_get();  -- tech:false, ingredients:[]  (до изучения)
-- 2) после изучения soc.consumer_goods:
--    select public.goods_recipe_set('[{"res":"Старвис","qty":0.5},{"res":"Железо","qty":0.5}]');
-- 3) select (public.economy_accrue('<fid>'))->'goods';  -- welfare учитывает качество
