-- ============================================================
-- ЭКОНОМИКА — казна, колонии, постройки, RLS, RPC (доход/инициализация)
-- Выполнить целиком в Supabase → SQL Editor
-- Требует: public.current_user_role(), public.faction_applications, public.map_systems
-- ============================================================

-- ── Таблицы ─────────────────────────────────────────────────
create table if not exists public.faction_economy (
  faction_id  text primary key,
  owner_id    uuid,
  owner_email text,
  gc          numeric default 0,          -- галактический стандарт
  science     numeric default 0,          -- очки науки (ОН)
  tnp         numeric default 0,          -- товары народного потребления
  last_tick   timestamptz default now(),  -- момент последнего начисления
  created_at  timestamptz default now()
);

create table if not exists public.colonies (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text,
  owner_id    uuid,
  system_id   text,
  planet_name text,
  planet_type text,
  cells       int default 6,              -- ячеек под застройку
  terraformed boolean default false,
  created_at  timestamptz default now(),
  unique (system_id, planet_name)
);

create table if not exists public.colony_buildings (
  id          uuid primary key default gen_random_uuid(),
  colony_id   uuid references public.colonies(id) on delete cascade,
  faction_id  text,
  owner_id    uuid,
  btype       text not null,              -- factory|mining|trade|science|training|intel|military_factory|shipyard
  slots_open  int default 1,              -- сколько производственных слотов открыто (1..6)
  tnp_mode    boolean default false,      -- фабрика: производить ТНП вместо ГС
  created_at  timestamptz default now()
);

create index if not exists colonies_faction_idx on public.colonies(faction_id);
create index if not exists colonies_owner_idx    on public.colonies(owner_id);
create index if not exists cb_colony_idx          on public.colony_buildings(colony_id);
create index if not exists cb_faction_idx         on public.colony_buildings(faction_id);

-- ── RLS ─────────────────────────────────────────────────────
alter table public.faction_economy  enable row level security;
alter table public.colonies         enable row level security;
alter table public.colony_buildings enable row level security;

-- Казна — приватна: видит владелец и стафф
drop policy if exists "fe_sel" on public.faction_economy;
drop policy if exists "fe_ins" on public.faction_economy;
drop policy if exists "fe_upd" on public.faction_economy;
drop policy if exists "fe_del" on public.faction_economy;
create policy "fe_sel" on public.faction_economy for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
create policy "fe_ins" on public.faction_economy for insert to authenticated
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));
create policy "fe_upd" on public.faction_economy for update to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'))
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));
create policy "fe_del" on public.faction_economy for delete to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));

-- Колонии и постройки — читать всем (видна империя на карте), писать владелец/стафф
do $$
declare t text;
begin
  foreach t in array array['colonies','colony_buildings'] loop
    execute format('drop policy if exists "ec_sel" on public.%I', t);
    execute format('drop policy if exists "ec_ins" on public.%I', t);
    execute format('drop policy if exists "ec_upd" on public.%I', t);
    execute format('drop policy if exists "ec_del" on public.%I', t);
    execute format('create policy "ec_sel" on public.%I for select to public using (true)', t);
    execute format('create policy "ec_ins" on public.%I for insert to authenticated with check (owner_id = auth.uid() or public.current_user_role() in (''superadmin'',''editor''))', t);
    execute format('create policy "ec_upd" on public.%I for update to authenticated using (owner_id = auth.uid() or public.current_user_role() in (''superadmin'',''editor'')) with check (owner_id = auth.uid() or public.current_user_role() in (''superadmin'',''editor''))', t);
    execute format('create policy "ec_del" on public.%I for delete to authenticated using (owner_id = auth.uid() or public.current_user_role() in (''superadmin'',''editor''))', t);
  end loop;
end$$;

-- ── Производство юнитов (очередь/склад) ─────────────────────
create table if not exists public.unit_production (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text,
  owner_id    uuid,
  unit_id     uuid,            -- дизайн из faction_units
  unit_name   text,
  category    text,            -- ship | ground | aviation
  line        text,            -- military | shipyard
  qty         int default 1,
  status      text default 'queued',   -- queued | done
  ready_at    timestamptz,             -- момент готовности (конец хода)
  created_at  timestamptz default now()
);
create index if not exists up_faction_idx on public.unit_production(faction_id);
create index if not exists up_owner_idx    on public.unit_production(owner_id);

alter table public.unit_production enable row level security;
drop policy if exists "up_sel" on public.unit_production;
drop policy if exists "up_ins" on public.unit_production;
drop policy if exists "up_upd" on public.unit_production;
drop policy if exists "up_del" on public.unit_production;
create policy "up_sel" on public.unit_production for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
create policy "up_ins" on public.unit_production for insert to authenticated
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));
create policy "up_upd" on public.unit_production for update to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'))
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));
create policy "up_del" on public.unit_production for delete to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));

-- ── RPC: инициализация экономики из одобренной анкеты ────────
create or replace function public.economy_init()
returns public.faction_economy
language plpgsql
security definer
set search_path = public
as $$
declare
  app public.faction_applications;
  eco public.faction_economy;
  cap_colony uuid;
  cap_name text;
  fb text;
  bid text;
  bt text;
  free_slots int;
begin
  select * into app from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction application'; end if;
  if app.faction_id is null then raise exception 'application has no faction_id'; end if;

  select * into eco from public.faction_economy where faction_id = app.faction_id;
  if found then return eco; end if;   -- уже инициализировано

  insert into public.faction_economy (faction_id, owner_id, owner_email, gc, science, tnp, last_tick)
    values (app.faction_id, app.owner_id, app.owner_email,
            case when app.bonus_money then 500 else 0 end, 0, 0, now())
    returning * into eco;

  cap_name := coalesce(nullif(app.planet_name, ''), app.system_name, 'Столица');
  insert into public.colonies (faction_id, owner_id, system_id, planet_name, planet_type, cells)
    values (app.faction_id, app.owner_id, app.system_id, cap_name, 'Столичный мир', 6)
    on conflict (system_id, planet_name) do nothing
    returning id into cap_colony;
  if cap_colony is null then
    select id into cap_colony from public.colonies
      where system_id is not distinct from app.system_id and planet_name = cap_name limit 1;
  end if;

  -- бесплатная постройка по типу цивилизации + выбранные в анкете
  fb := case when app.civ_type = 'frontier' then 'com' else 'encom' end;

  for bid in
    select distinct x from (
      select fb as x
      union all
      select jsonb_array_elements_text(coalesce(app.buildings, '[]'::jsonb)) as x
    ) q
  loop
    bt := case bid
      when 'encom' then 'factory'
      when 'ind'   then 'mining'
      when 'unit'  then 'trade'
      when 'sci'   then 'science'
      when 'emb'   then 'training'
      when 'com'   then 'intel'
      when 'yard'  then 'military_factory'
      when 'mil'   then 'shipyard'
      else null end;
    if bt is null then continue; end if;
    free_slots := case when bt in ('factory','mining') then 2 else 1 end;
    insert into public.colony_buildings (colony_id, faction_id, owner_id, btype, slots_open)
      values (cap_colony, app.faction_id, app.owner_id, bt, free_slots);
  end loop;

  return eco;
end$$;
revoke all on function public.economy_init() from public;
grant execute on function public.economy_init() to authenticated;

-- ── RPC: начисление дохода за прошедшие сутки ────────────────
create or replace function public.economy_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  eco public.faction_economy;
  d int;
  inc_gc numeric := 0;
  inc_sci numeric := 0;
  inc_tnp numeric := 0;
  r record;
begin
  select * into eco from public.faction_economy where owner_id = auth.uid()
    order by created_at asc limit 1;
  if not found then raise exception 'no economy'; end if;

  -- доставка готового производства (конец хода)
  update public.unit_production set status = 'done'
    where faction_id = eco.faction_id and status = 'queued' and ready_at <= now();

  d := floor(extract(epoch from (now() - eco.last_tick)) / 86400.0);

  for r in
    select btype, slots_open, tnp_mode from public.colony_buildings where faction_id = eco.faction_id
  loop
    if r.btype = 'factory' then
      if r.tnp_mode then inc_tnp := inc_tnp + r.slots_open * 100;
      else inc_gc := inc_gc + r.slots_open * 100; end if;
    elsif r.btype in ('mining','trade') then
      inc_gc := inc_gc + r.slots_open * 100;
    elsif r.btype = 'science' then
      inc_sci := inc_sci + r.slots_open * 1;
    end if;
  end loop;

  if d >= 1 then
    update public.faction_economy
      set gc = gc + inc_gc * d,
          science = science + inc_sci * d,
          tnp = tnp + inc_tnp * d,
          last_tick = last_tick + (d || ' days')::interval
      where faction_id = eco.faction_id
      returning * into eco;
  end if;

  return jsonb_build_object(
    'faction_id', eco.faction_id,
    'gc', eco.gc, 'science', eco.science, 'tnp', eco.tnp,
    'last_tick', eco.last_tick,
    'days', d,
    'income', jsonb_build_object('gc', inc_gc, 'science', inc_sci, 'tnp', inc_tnp)
  );
end$$;
revoke all on function public.economy_tick() from public;
grant execute on function public.economy_tick() to authenticated;

-- ── v3: колонки для производства и захвата систем ───────────
alter table public.faction_economy  add column if not exists last_system_claim timestamptz;
alter table public.unit_production   add column if not exists weight int default 1;

-- ── RPC: колонизация (захват) системы — раз в неделю, смежной и ничьей ──
create or replace function public.economy_claim_system(p_system_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  app public.faction_applications;
  eco public.faction_economy;
  sys public.map_systems;
  adj boolean;
  cost numeric := 3000;
  cd interval := '7 days';
begin
  select * into app from public.faction_applications
    where owner_id = auth.uid() and status = 'approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into eco from public.faction_economy where faction_id = app.faction_id;
  if not found then raise exception 'no economy'; end if;
  select * into sys from public.map_systems where id = p_system_id;
  if not found then raise exception 'system not found'; end if;
  if sys.faction is not null then raise exception 'system already claimed'; end if;

  -- смежность по гиперпути с любой системой фракции
  select exists (
    select 1 from public.map_hyperlanes h
    join public.map_systems ms
      on ms.id = case when h.a_id = p_system_id then h.b_id
                      when h.b_id = p_system_id then h.a_id end
    where (h.a_id = p_system_id or h.b_id = p_system_id) and ms.faction = app.faction_id
  ) into adj;
  if not adj then raise exception 'system not adjacent to your territory'; end if;

  if eco.last_system_claim is not null and eco.last_system_claim > now() - cd then
    raise exception 'claim cooldown active';
  end if;
  if eco.gc < cost then raise exception 'not enough GC'; end if;

  update public.faction_economy set gc = gc - cost, last_system_claim = now() where faction_id = app.faction_id;
  update public.map_systems set faction = app.faction_id where id = p_system_id;

  return jsonb_build_object('ok', true, 'system_id', p_system_id, 'cost', cost);
end$$;
revoke all on function public.economy_claim_system(text) from public;
grant execute on function public.economy_claim_system(text) to authenticated;
