-- ============================================================
-- ФИКС: _ec_bld_base потеряла 'temple' (и оборонные типы)
--   Причина: поздний слайс (_security_money.sql / _resources_phase1.sql)
--   пересоздал _ec_bld_base БЕЗ 'temple', перезатерев версию из
--   _faith_setup.sql → economy_build('temple') падал с 'bad btype' (P0001).
--   Здесь — ПОЛНЫЙ НАДМНОЖЕСТВЕННЫЙ справочник цен (зеркало EC_BUILD economy.js).
--   Применять в Supabase ОДИН раз; безопасно для повторного запуска.
-- ============================================================
create or replace function public._ec_bld_base(p_btype text)
returns numeric language sql immutable as $$
  select case p_btype
    when 'factory'          then 500    when 'mining'   then 500
    when 'trade'            then 1000   when 'market'   then 1500
    when 'science'          then 1000   when 'training' then 500
    when 'intel'            then 3000   when 'military_factory' then 1000
    when 'shipyard'         then 2000   when 'warehouse' then 800
    when 'temple'           then 1200   -- ВЕРА: храм (_faith_setup.sql)
    when 'starbase'         then 5000   -- Звёздная База (_defense_starbase.sql)
    when 'flak'             then 1500   -- ПВО
    when 'abm'              then 3000   -- ПРО
    else null end
$$;
