-- ═══════════════════════════════════════════════════════════════════
-- ФИКС: «Постройка носителя аванпоста полностью сломана» — всегда
--       «ОШИБКА: НЕДОСТАТОЧНО ГС», даже когда ГС хватает.
--
-- ПРИЧИНА. Функция public._defense_const(key) переопределяется ПЯТЬЮ
-- файлами обороны (_defense_minefield / _defense_starbase / _defense_repair /
-- _defense_planetary / _defense_outpost). Три «боевых» версии (минные поля,
-- звёздные базы, ремонт) НЕ содержат ключи 'outpost_ship_cost' /
-- 'outpost_build_h' — их CASE заканчивается `else null`. Кто применён
-- ПОСЛЕДНИМ — тот и живёт в БД. Если это одна из «боевых» версий, то
--     _defense_const('outpost_ship_cost') → NULL
-- и в outpost_ship_build проверка `where gc >= cost` = `gc >= NULL` = NULL
-- (никогда true) → `not found` → raise 'not enough GC'. Постройка падает
-- при любом балансе. Аналогично build_h → NULL сломал бы вставку.
--
-- РЕШЕНИЕ (идемпотентно, устойчиво к порядку применения):
--   1) пересоздать _defense_const ПОЛНЫМ суперсетом всех ключей;
--   2) захардить сами RPC носителя литеральными фолбэками через coalesce,
--      чтобы постройка работала ДАЖЕ если _defense_const снова затрут
--      частичной «боевой» версией.
-- Катить можно в любой момент; повторное применение безопасно.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Полный суперсет всех констант обороны (зеркало _defense_outpost.sql).
create or replace function public._defense_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'starbase_cap_per_slot' then 50
    when 'repair_fraction'       then 0.40
    when 'repair_cost_frac'      then 0.50
    when 'repair_days'           then 1
    when 'mine_hex_max'          then 6
    when 'mine_hex_cost'         then 400
    when 'mine_hex_attrition'    then 0.05
    when 'mine_wear_hexes'       then 1
    when 'mine_refund_frac'      then 0.50
    when 'outpost_ship_cost'     then 2000    -- ГС за постройку корабля-носителя
    when 'outpost_build_h'       then 24      -- постройка носителя занимает сутки
    when 'outpost_cap'           then 20      -- +вместимость флота за добывающий аванпост
    when 'outpost_refund'        then 0.50    -- доля возврата при разборке/сломе
    when 'outpost_mine_gc'       then 75      -- ГС/сут с добывающего аванпоста
    when 'op_fly_h_min'          then 2       -- мин. полёт, часов
    when 'op_fly_h_max'          then 18      -- макс. полёт, часов
    else null end
$$;

-- 2) Захардить постройку носителя литеральными фолбэками — на случай, если
--    _defense_const снова затрут частичной версией без outpost-ключей.
create or replace function public.outpost_ship_build(p_system_id text, p_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; cost numeric; build_h numeric; v_id uuid; ready timestamptz;
begin
  fid := public._ec_my_fid();
  if not exists(select 1 from public.colonies where faction_id=fid and system_id=p_system_id) then
    raise exception 'build outpost-ship only at a system with your colony';
  end if;
  cost    := coalesce(public._defense_const('outpost_ship_cost'), 2000);  -- ФИКС: фолбэк 2000
  build_h := coalesce(public._defense_const('outpost_build_h'), 24);      -- ФИКС: фолбэк 24ч
  update public.faction_economy set gc = gc - cost where faction_id=fid and gc >= cost;
  if not found then raise exception 'not enough GC: корабль-носитель стоит %', cost; end if;

  ready := now() + (build_h || ' hours')::interval;
  insert into public.outpost_ships(faction_id, owner_id, name, status, system_id, depart_at, arrive_at)
    values(fid, auth.uid(), nullif(trim(coalesce(p_name,'')),''), 'building', p_system_id, now(), ready)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'cost', cost, 'ready_at', ready);
end$$;
revoke all on function public.outpost_ship_build(text,text) from public;
grant execute on function public.outpost_ship_build(text,text) to authenticated;

-- 3) Тот же фолбэк для возврата при сломе носителя (иначе refund = NULL).
create or replace function public.outpost_ship_scrap(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; sh public.outpost_ships; refund numeric;
begin
  fid := public._ec_my_fid();
  select * into sh from public.outpost_ships where id=p_id;
  if not found then raise exception 'outpost-ship not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your ship'; end if;
  refund := floor(coalesce(public._defense_const('outpost_ship_cost'), 2000)
                  * coalesce(public._defense_const('outpost_refund'), 0.50));   -- ФИКС: фолбэки
  delete from public.outpost_ships where id=p_id;
  update public.faction_economy set gc = gc + refund where faction_id=fid;
  return jsonb_build_object('ok', true, 'refund', refund);
end$$;
revoke all on function public.outpost_ship_scrap(uuid) from public;
grant execute on function public.outpost_ship_scrap(uuid) to authenticated;

-- Проверка: select public._defense_const('outpost_ship_cost');  -- должно быть 2000
