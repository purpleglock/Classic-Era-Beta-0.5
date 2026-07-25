-- ============================================================
-- ТОРГОВЛЯ · МАССА РЕСУРСА (грузоподъёмность = масса × количество)
-- Применять в Supabase → SQL Editor. Идемпотентно.
-- Зависит от модели kv.cap — включает _ship_cargo (как в _trade_kv_cargo.sql),
-- поэтому применять можно и отдельно (он самодостаточен).
--
-- ПРОБЛЕМА (что чинит):
--   1. Сервер всё ещё считал грузоподъёмность корабля по НАЛИЧИЮ грузового
--      ангара (id3/id4 старого конструктора) — «проверка на модуль», а не по
--      настоящей грузоподъёмности шасси. Ниже _ship_cargo читает kv.cap (кг).
--   2. Месторождений больше нет — ресурс возится СО СКЛАДА, и его «вес» задаётся
--      РЕДКОСТЬЮ: чем реже, тем плотнее. Трюм расходуется = масса × количество.
--      Раньше объём считался как штуки 1:1 с грузоподъёмностью (кг) — мешало кг и
--      штуки. Теперь суммарный груз = Σ(vol_i × _res_mass(редкость_i)) кг ≤ флот.
--
-- Масса единицы ресурса (кг) по редкости — зеркало economy.js EC_RES_MASS:
--   common 1 · uncommon 2 · rare 4 · epic 8 · legendary 16.
--
-- Хранение: trade_routes.volume = ВЕС каравана в кг (Σ масса×кол-во). Так
--   trade_capacity (used = Σ volume) и приёмка новых путей считают в одних кг.
--   В начислении мультигруз возится по cargo[].vol (штуки), volume не участвует.
-- ============================================================

-- ── Грузоподъёмность корабля (кг) = замороженная kv.cap, легаси-откат на ангары ──
create or replace function public._ship_cargo(p_data jsonb)
returns int language sql immutable as $$
  select greatest(0, coalesce(
    (p_data->>'kv_cargo')::int,
    (select coalesce(sum(
        case (h->>'id')::int when 3 then 20 when 4 then 10 else 0 end
      ), 0)::int
      from jsonb_array_elements(coalesce(p_data->'hangars', '[]'::jsonb)) h)
  ))::int
$$;
revoke all on function public._ship_cargo(jsonb) from public;
grant execute on function public._ship_cargo(jsonb) to authenticated;

-- ── Масса ЕДИНИЦЫ ресурса (кг/ед) по редкости ──────────────
create or replace function public._res_mass(p_rarity text)
returns numeric language sql immutable as $$
  select case coalesce(p_rarity,'common')
           when 'legendary' then 16
           when 'epic'      then 8
           when 'rare'      then 4
           when 'uncommon'  then 2
           else 1
         end::numeric
$$;
revoke all on function public._res_mass(text) from public;
grant execute on function public._res_mass(text) to authenticated;

-- ── RPC: предложить караван (мультигруз) с учётом массы ──────
create or replace function public.trade_propose_multi(p_to_fid text, p_origin_sys text, p_dest_sys text, p_cargo jsonb, p_convoy int, p_threats jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; cap int; used int; bowner uuid; roster_ships int; committed int;
  fleet_cargo int; cargo_used int; tot_kg numeric; citem jsonb; v_vol int; v_mass numeric; first_res text; first_price numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_cargo is null or jsonb_array_length(p_cargo) = 0 then raise exception 'empty cargo'; end if;
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

  -- эскорт ≤ свободных боевых кораблей
  select coalesce(sum(qty),0) into roster_ships from public.unit_production where faction_id=app.faction_id and category='ship' and status='done';
  select coalesce(sum(convoy),0) into committed from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
  if coalesce(p_convoy,0) > roster_ships - committed then raise exception 'not enough escort ships'; end if;

  -- ВЕС груза (кг) = Σ vol × масса(редкость) ≤ свободной грузоподъёмности флота
  tot_kg := 0;
  for citem in select value from jsonb_array_elements(p_cargo) loop
    v_vol := coalesce((citem->>'vol')::int, 0);
    if v_vol <= 0 then raise exception 'bad cargo volume'; end if;
    v_mass := public._res_mass(coalesce((select rarity from public.resource_rarity where name=citem->>'res'),'common'));
    tot_kg := tot_kg + v_vol * v_mass;
    if first_res is null then first_res := citem->>'res'; end if;
  end loop;
  select coalesce(sum(public._ship_cargo(fu.data)*up.qty),0) into fleet_cargo
    from public.unit_production up join public.faction_units fu on fu.id=up.unit_id
    where up.faction_id=app.faction_id and up.category='ship' and up.status='done';
  select coalesce(sum(volume),0) into cargo_used from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
  if tot_kg > fleet_cargo - cargo_used then
    raise exception 'not enough trade capacity (free: % kg)', greatest(0, fleet_cargo - cargo_used);
  end if;

  -- resource/volume/price — легаси-поля: первый груз + ВЕС каравана (кг)
  first_price := public._res_price(coalesce((select rarity from public.resource_rarity where name=first_res),'common'));
  insert into public.trade_routes(a_fid,a_owner,a_name,b_fid,b_owner,b_name,volume,status,origin_sys,dest_sys,resource,price,convoy,threats,cargo)
    values(app.faction_id, auth.uid(), app.name, p_to_fid, bowner, public._fac_name(p_to_fid), ceil(tot_kg)::int, 'pending',
           p_origin_sys, p_dest_sys, first_res, first_price, coalesce(p_convoy,0), coalesce(p_threats,'[]'::jsonb), p_cargo);
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.trade_propose_multi(text,text,text,jsonb,int,jsonb) from public;
grant execute on function public.trade_propose_multi(text,text,text,jsonb,int,jsonb) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
--   select name, public._ship_cargo(data) kg from public.faction_units where category='ship' order by kg desc;
--   Караван: volume теперь = ВЕС в кг (Σ масса×кол-во), а trade_capacity.used — в тех же кг.
