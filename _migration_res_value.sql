-- ════════════════════════════════════════════════════════════════════════
--  МИГРАЦИЯ: персональная ЦЕНА каждого ресурса (вместо общей по редкости)
--
--  Зеркало значений — galaxy_gen.js (RES_PRICE) и economy.js (через resPrice).
--  Меняешь цены здесь — синхронь RES_PRICE в galaxy_gen.js (и наоборот).
--
--  Запускать в Supabase SQL Editor. Заменяет _res_price НЕ трогаем (оставляем
--  как фолбэк по редкости), добавляем _res_value(name) и переводим на неё
--  ручную продажу и создание каравана.
-- ════════════════════════════════════════════════════════════════════════

-- ── Цена по ИМЕНИ ресурса; для неизвестных — фолбэк на редкость (_res_price) ──
create or replace function public._res_value(p_name text, p_rarity text default null)
returns numeric language sql immutable as $$
  select coalesce(
    case p_name
      when 'Силикаты'                 then 1
      when 'Сера'                     then 2
      when 'Железо'                   then 3
      when 'Углерод'                  then 3
      when 'Лёд'                      then 3
      when 'Метан'                    then 4
      when 'Медь'                     then 8
      when 'Аммиачный лёд'            then 10
      when 'Ионит'                    then 12
      when 'Титан'                    then 14
      when 'Жидкая вода'              then 45
      when 'Изотопы'                  then 50
      when 'Реликтовое дерево'        then 55
      when 'Редкоземельные руды'      then 60
      when 'Дейтерий'                 then 65
      when 'Платина'                  then 70
      when 'Гелий-3'                  then 80
      when 'Старвис'                  then 200
      when 'Хтонит'                   then 220
      when 'Стелларит'                then 260
      when 'Гравиядро'                then 1200
      when 'Рагенод'                  then 1500
      when 'Программируемая материя'  then 1600
      else null
    end,
    public._res_price(p_rarity)   -- фолбэк по редкости
  )::numeric
$$;

-- ── Локальная продажа ресурса: цена теперь по имени ресурса ──
create or replace function public.economy_sell_resource(p_name text, p_units numeric, p_rarity text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; eco public.faction_economy; have numeric; gain numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_units is null or p_units <= 0 then raise exception 'bad units'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into eco from public.faction_economy where faction_id=app.faction_id;
  have := coalesce((eco.resources->>p_name)::numeric, 0);
  if have < p_units then raise exception 'not enough resource'; end if;
  -- доктрина: продажа ресурсов — часть ГС-экономики
  gain := floor(p_units * public._res_value(p_name, p_rarity) * 0.8 * (public._faction_mods(app.faction_id)->>'gc')::numeric);
  update public.faction_economy
    set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[p_name], to_jsonb(have - p_units), true),
        gc = gc + gain
    where faction_id=app.faction_id;
  return jsonb_build_object('ok', true, 'gain', gain);
end$$;

-- ── Торговый караван: цена пути берётся по имени ресурса ──
create or replace function public.trade_propose(p_to_fid text, p_origin_sys text, p_dest_sys text, p_resource text, p_rarity text, p_volume int, p_convoy int, p_threats jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; cap int; used int; bowner uuid; roster_ships int; committed int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_volume is null or p_volume <= 0 then raise exception 'bad volume'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_to_fid = app.faction_id then raise exception 'self'; end if;
  select owner_id into bowner from public.faction_economy where faction_id=p_to_fid;
  if bowner is null then raise exception 'recipient has no economy'; end if;
  perform 1 from public.map_systems where id=p_origin_sys and faction=app.faction_id;
  if not found then raise exception 'origin not yours'; end if;
  perform 1 from public.map_systems where id=p_dest_sys and faction=p_to_fid;
  if not found then raise exception 'destination not theirs'; end if;
  select coalesce(sum(slots_open),0) into cap from public.colony_buildings where faction_id=app.faction_id and btype='trade';
  select count(*) into used from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
  if used >= cap then raise exception 'no free trade hub slots'; end if;
  select coalesce(sum(qty),0) into roster_ships from public.unit_production where faction_id=app.faction_id and category='ship' and status='done';
  select coalesce(sum(convoy),0) into committed from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
  if coalesce(p_convoy,0) > roster_ships - committed then raise exception 'not enough escort ships'; end if;
  insert into public.trade_routes(a_fid,a_owner,a_name,b_fid,b_owner,b_name,volume,status,origin_sys,dest_sys,resource,price,convoy,threats)
    values(app.faction_id, auth.uid(), app.name, p_to_fid, bowner, public._fac_name(p_to_fid), p_volume, 'pending',
           p_origin_sys, p_dest_sys, p_resource, public._res_value(p_resource, p_rarity), coalesce(p_convoy,0), coalesce(p_threats,'[]'::jsonb));
  return jsonb_build_object('ok', true);
end$$;

-- права
do $$
declare fn text;
begin
  foreach fn in array array['economy_sell_resource(text,numeric,text)','trade_propose(text,text,text,text,text,int,int,jsonb)','_res_value(text,text)'] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end$$;

-- ════════════════════════════════════════════════════════════════════════
--  ТОВАРНАЯ БИРЖА (пассивный авто-сбыт в economy_accrue)
--  -----------------------------------------------------------------------
--  Чтобы биржа тоже считала по персональной цене — примени вторым файлом
--  _migration_economy_accrue_res_value.sql (полная economy_accrue с заменой
--  _res_price → _res_value в строке биржи; проценты по редкости сохранены).
-- ════════════════════════════════════════════════════════════════════════
