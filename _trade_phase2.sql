-- ============================================================
-- ТОРГОВЛЯ · ФАЗА 2 (ядро): караван требует ГРУЗОПОДЪЁМНОСТЬ торгового флота
-- Применять в Supabase → SQL Editor ПОСЛЕ _trade_phase1.sql и _security_market.sql.
-- Идемпотентно.
--
-- Объём каравана (volume/ход) теперь ограничен суммарной грузоподъёмностью
-- торговых кораблей фракции (дизайны с грузовыми ангарами) минус то, что уже
-- занято активными/ожидающими маршрутами. Нет фрахтовщиков → нет торговли.
-- Грузоподъёмность считает СЕРВЕР через _ship_cargo(data) — не клиент.
-- ============================================================

create or replace function public.trade_propose(p_to_fid text, p_origin_sys text, p_dest_sys text, p_resource text, p_rarity text, p_volume int, p_convoy int, p_threats jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; cap int; used int; bowner uuid; roster_ships int; committed int;
  v_rarity text; fleet_cargo int; cargo_used int;
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

  -- ЭСКОРТ: конвой ≤ свободных боевых кораблей
  select coalesce(sum(qty),0) into roster_ships from public.unit_production where faction_id=app.faction_id and category='ship' and status='done';
  select coalesce(sum(convoy),0) into committed from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
  if coalesce(p_convoy,0) > roster_ships - committed then raise exception 'not enough escort ships'; end if;

  -- ГРУЗОПОДЪЁМНОСТЬ: объём ≤ свободной вместимости торгового флота (с грузовыми ангарами)
  select coalesce(sum(public._ship_cargo(fu.data) * up.qty),0) into fleet_cargo
    from public.unit_production up
    join public.faction_units fu on fu.id = up.unit_id
    where up.faction_id=app.faction_id and up.category='ship' and up.status='done';
  select coalesce(sum(volume),0) into cargo_used from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
  if p_volume > fleet_cargo - cargo_used then
    raise exception 'not enough trade capacity (free: %)', greatest(0, fleet_cargo - cargo_used);
  end if;

  -- ЦЕНА — по справочнику редкости ресурса (не из клиентского p_rarity)
  v_rarity := coalesce((select rarity from public.resource_rarity where name = p_resource), 'common');
  insert into public.trade_routes(a_fid,a_owner,a_name,b_fid,b_owner,b_name,volume,status,origin_sys,dest_sys,resource,price,convoy,threats)
    values(app.faction_id, auth.uid(), app.name, p_to_fid, bowner, public._fac_name(p_to_fid), p_volume, 'pending',
           p_origin_sys, p_dest_sys, p_resource, public._res_price(v_rarity), coalesce(p_convoy,0), coalesce(p_threats,'[]'::jsonb));
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.trade_propose(text,text,text,text,text,int,int,jsonb) from public;
grant execute on function public.trade_propose(text,text,text,text,text,int,int,jsonb) to authenticated;

-- ── Хелпер для UI: свободная грузоподъёмность торгового флота ──
create or replace function public.trade_capacity()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text; total int; used int;
begin
  fid := public._ec_my_fid();
  select coalesce(sum(public._ship_cargo(fu.data) * up.qty),0) into total
    from public.unit_production up join public.faction_units fu on fu.id = up.unit_id
    where up.faction_id=fid and up.category='ship' and up.status='done';
  select coalesce(sum(volume),0) into used from public.trade_routes where a_fid=fid and status in ('pending','active');
  return jsonb_build_object('total', total, 'used', used, 'free', greatest(0, total - used));
end$$;
revoke all on function public.trade_capacity() from public;
grant execute on function public.trade_capacity() to authenticated;
