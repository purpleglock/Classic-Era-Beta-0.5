-- ============================================================
-- ЭТАП 2f — РЕДКОСТЬ РЕСУРСОВ НА СЕРВЕРЕ (закрывает чит на ГС)
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Дыра: economy_sell_resource и trade_propose брали РЕДКОСТЬ ресурса (→ цену)
--   из клиентского параметра p_rarity. _res_price('legendary')=1200 против 2 у
--   обычного → продать «Железо», указав 'legendary', = ×600 ГС из воздуха.
--     ecRpc('economy_sell_resource',{p_name:'Железо',p_units:1000,p_rarity:'legendary'})
--
-- Фикс: справочник resource_rarity (зеркало RESOURCES из galaxy_gen.js).
--   Обе функции теперь берут редкость по ИМЕНИ из справочника, p_rarity клиента
--   игнорируется. Сигнатуры прежние → клиент не трогаем.
--
-- ⚠ Если добавляешь новые ресурсы в galaxy_gen.js — добавь их сюда же.
-- ============================================================

create table if not exists public.resource_rarity (
  name   text primary key,
  rarity text not null
);
alter table public.resource_rarity enable row level security;
drop policy if exists "rr_sel" on public.resource_rarity;
create policy "rr_sel" on public.resource_rarity for select to public using (true);

insert into public.resource_rarity (name, rarity) values
('Железо','common'),
('Силикаты','common'),
('Лёд','common'),
('Углерод','common'),
('Метан','common'),
('Сера','common'),
('Медь','uncommon'),
('Титан','uncommon'),
('Ионит','uncommon'),
('Аммиачный лёд','uncommon'),
('Редкоземельные руды','rare'),
('Платина','rare'),
('Изотопы','rare'),
('Жидкая вода','rare'),
('Реликтовое дерево','rare'),
('Дейтерий','rare'),
('Гелий-3','rare'),
('Старвис','epic'),
('Хтонит','epic'),
('Стелларит','epic'),
('Гравиядро','legendary'),
('Рагенод','legendary'),
('Программируемая материя','legendary')
on conflict (name) do update set rarity = excluded.rarity;

-- ── Локальная продажа ресурса: редкость берётся СЕРВЕРОМ по имени ──
create or replace function public.economy_sell_resource(p_name text, p_units numeric, p_rarity text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; eco public.faction_economy; have numeric; gain numeric; v_rarity text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_units is null or p_units <= 0 then raise exception 'bad units'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into eco from public.faction_economy where faction_id=app.faction_id;
  have := coalesce((eco.resources->>p_name)::numeric, 0);
  if have < p_units then raise exception 'not enough resource'; end if;
  -- РЕДКОСТЬ — по справочнику, а не из клиентского p_rarity
  v_rarity := coalesce((select rarity from public.resource_rarity where name = p_name), 'common');
  gain := floor(p_units * public._res_price(v_rarity) * 0.8 * (public._faction_mods(app.faction_id)->>'gc')::numeric);
  update public.faction_economy
    set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[p_name], to_jsonb(have - p_units), true),
        gc = gc + gain
    where faction_id=app.faction_id;
  return jsonb_build_object('ok', true, 'gain', gain);
end$$;
revoke all on function public.economy_sell_resource(text,numeric,text) from public;
grant execute on function public.economy_sell_resource(text,numeric,text) to authenticated;

-- ── Торговый караван: цена ресурса — по справочнику (а не p_rarity) ──
create or replace function public.trade_propose(p_to_fid text, p_origin_sys text, p_dest_sys text, p_resource text, p_rarity text, p_volume int, p_convoy int, p_threats jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; cap int; used int; bowner uuid; roster_ships int; committed int; v_rarity text;
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
  -- ЦЕНА — по справочнику редкости ресурса, а не из клиентского p_rarity
  v_rarity := coalesce((select rarity from public.resource_rarity where name = p_resource), 'common');
  insert into public.trade_routes(a_fid,a_owner,a_name,b_fid,b_owner,b_name,volume,status,origin_sys,dest_sys,resource,price,convoy,threats)
    values(app.faction_id, auth.uid(), app.name, p_to_fid, bowner, public._fac_name(p_to_fid), p_volume, 'pending',
           p_origin_sys, p_dest_sys, p_resource, public._res_price(v_rarity), coalesce(p_convoy,0), coalesce(p_threats,'[]'::jsonb));
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.trade_propose(text,text,text,text,text,int,int,jsonb) from public;
grant execute on function public.trade_propose(text,text,text,text,text,int,int,jsonb) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- select count(*) from public.resource_rarity;   -- 23
-- Из консоли продать дешёвый ресурс как 'legendary' — выручка будет как за
-- ОБЫЧНЫЙ (сервер игнорит p_rarity):
--   ecRpc('economy_sell_resource',{p_name:'Железо',p_units:1,p_rarity:'legendary'})
