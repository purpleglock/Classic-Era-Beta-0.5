-- ============================================================
-- ПИРАТСТВО — хелперы для UI рейдов. Применять после _raid_setup.sql.
-- ============================================================

-- Разведать активные караваны цели (RLS прячет чужие маршруты → нужен definer).
-- Возвращает то, что «видно в космосе»: ресурс, объём, эскорт, концы маршрута.
create or replace function public.raid_scout(p_target_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; arr jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if p_target_fid = fid then raise exception 'cannot scout yourself'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'resource', resource, 'volume', volume,
           'convoy', coalesce(convoy,0), 'origin', origin_sys, 'dest', dest_sys
         ) order by created_at desc), '[]'::jsonb)
    into arr
    from public.trade_routes
    where a_fid = p_target_fid and status = 'active';
  return arr;
end$$;
revoke all on function public.raid_scout(text) from public;
grant execute on function public.raid_scout(text) to authenticated;

-- Статус флота для панели рейдов: всего кораблей / занятых / свободных.
create or replace function public.raid_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text; done_ships int; conv int; raids int; pat int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select coalesce(sum(qty),0)    into done_ships from public.unit_production where faction_id=fid and category='ship' and status='done';
  select coalesce(sum(convoy),0) into conv       from public.trade_routes   where a_fid=fid and status in ('pending','active');
  select coalesce(sum(ships),0)  into raids      from public.raid_missions  where actor_fid=fid and status='active';
  select coalesce(patrol_ships,0) into pat       from public.faction_economy where faction_id=fid;
  return jsonb_build_object('ships',done_ships,'convoy',conv,'raids',raids,'patrol',pat,
    'free', done_ships - conv - raids - pat);
end$$;
revoke all on function public.raid_status() from public;
grant execute on function public.raid_status() to authenticated;
