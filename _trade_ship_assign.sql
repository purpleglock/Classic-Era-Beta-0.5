-- ============================================================
-- ТОРГОВЛЯ · ПОШТУЧНОЕ ЗАКРЕПЛЕНИЕ ГРУЗОВЫХ КОРАБЛЕЙ ЗА КАРАВАНАМИ
-- Применять в Supabase → SQL Editor ПОСЛЕ _trade_multi.sql. Идемпотентно.
--
-- Раньше флот был общим «пулом вместимости»: путь хранил только объём, и один
-- и тот же корабль визуально торчал в нескольких путях сразу. Теперь путь
-- РЕЗЕРВИРУЕТ конкретные грузовые корабли (ships = {unit_id: qty}). Корабль,
-- занятый одним путём, недоступен другим. Грузоподъёмность пути = сумма трюмов
-- назначенных кораблей; объём груза не может её превысить.
--
-- Эскорт (боевые корабли, convoy) остаётся по-старому — ограничен по количеству
-- свободных боевых, т.к. читается боёвкой рейдов как число.
-- Легаси-пути (ships = {}) ничего не резервируют; страховочная проверка по
-- суммарному объёму ≤ всего трюма флота ловит их до закрытия/пересоздания.
-- ============================================================

alter table public.trade_routes add column if not exists ships jsonb not null default '{}'::jsonb;

-- старую сигнатуру (без p_ships) убираем, чтобы не было перегрузки/неоднозначности
drop function if exists public.trade_propose_multi(text,text,text,jsonb,int,jsonb);

create or replace function public.trade_propose_multi(
    p_to_fid text, p_origin_sys text, p_dest_sys text,
    p_cargo jsonb, p_convoy int, p_threats jsonb, p_ships jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; cap int; used int; bowner uuid; roster_ships int; committed int;
  fleet_cargo int; cargo_used int; tot_vol int; citem jsonb; v_vol int; first_res text; first_price numeric;
  sid text; sqty int; owned_u int; ship_cargo int; committed_u int; route_cap int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_cargo is null or jsonb_array_length(p_cargo) = 0 then raise exception 'empty cargo'; end if;
  if p_ships is null or p_ships = '{}'::jsonb then raise exception 'no freighters assigned'; end if;
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

  -- эскорт ≤ свободных боевых кораблей (по количеству, как раньше)
  select coalesce(sum(qty),0) into roster_ships from public.unit_production where faction_id=app.faction_id and category='ship' and status='done';
  select coalesce(sum(convoy),0) into committed from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
  if coalesce(p_convoy,0) > roster_ships - committed then raise exception 'not enough escort ships'; end if;

  -- ── ПОШТУЧНОЕ ЗАКРЕПЛЕНИЕ: каждый назначенный грузовой свободен и реально твой ──
  route_cap := 0;
  for sid, sqty in select key, value::int from jsonb_each_text(p_ships) loop
    if sqty <= 0 then continue; end if;
    select coalesce(sum(up.qty),0), coalesce(max(public._ship_cargo(fu.data)),0)
      into owned_u, ship_cargo
      from public.unit_production up join public.faction_units fu on fu.id=up.unit_id
      where up.faction_id=app.faction_id and up.category='ship' and up.status='done' and up.unit_id::text = sid;
    if owned_u = 0 then raise exception 'ship % not owned', sid; end if;
    if ship_cargo <= 0 then raise exception 'ship % is not a freighter', sid; end if;
    -- сколько этого корабля уже закреплено моими путями
    select coalesce(sum((ships->>sid)::int),0) into committed_u
      from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
    if sqty > owned_u - committed_u then
      raise exception 'freighter % already committed (free: %)', sid, greatest(0, owned_u - committed_u);
    end if;
    route_cap := route_cap + ship_cargo * sqty;
  end loop;
  if route_cap <= 0 then raise exception 'no cargo capacity'; end if;

  -- объём грузов
  tot_vol := 0;
  for citem in select value from jsonb_array_elements(p_cargo) loop
    v_vol := coalesce((citem->>'vol')::int, 0);
    if v_vol <= 0 then raise exception 'bad cargo volume'; end if;
    tot_vol := tot_vol + v_vol;
    if first_res is null then first_res := citem->>'res'; end if;
  end loop;
  -- объём ≤ грузоподъёмности НАЗНАЧЕННЫХ кораблей
  if tot_vol > route_cap then raise exception 'cargo % exceeds assigned freighters capacity %', tot_vol, route_cap; end if;

  -- страховка для легаси-путей без ships: суммарный объём всех путей ≤ всего трюма флота
  select coalesce(sum(public._ship_cargo(fu.data)*up.qty),0) into fleet_cargo
    from public.unit_production up join public.faction_units fu on fu.id=up.unit_id
    where up.faction_id=app.faction_id and up.category='ship' and up.status='done';
  select coalesce(sum(volume),0) into cargo_used from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
  if tot_vol > fleet_cargo - cargo_used then
    raise exception 'not enough trade capacity (free: %)', greatest(0, fleet_cargo - cargo_used);
  end if;

  first_price := public._res_price(coalesce((select rarity from public.resource_rarity where name=first_res),'common'));
  insert into public.trade_routes(a_fid,a_owner,a_name,b_fid,b_owner,b_name,volume,status,origin_sys,dest_sys,resource,price,convoy,threats,cargo,ships)
    values(app.faction_id, auth.uid(), app.name, p_to_fid, bowner, public._fac_name(p_to_fid), tot_vol, 'pending',
           p_origin_sys, p_dest_sys, first_res, first_price, coalesce(p_convoy,0), coalesce(p_threats,'[]'::jsonb), p_cargo, p_ships);
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.trade_propose_multi(text,text,text,jsonb,int,jsonb,jsonb) from public;
grant execute on function public.trade_propose_multi(text,text,text,jsonb,int,jsonb,jsonb) to authenticated;
