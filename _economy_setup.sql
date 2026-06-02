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

-- v5: склад ресурсов фракции и снимок ресурсов планеты на колонии
alter table public.faction_economy add column if not exists resources jsonb default '{}'::jsonb;
alter table public.colonies        add column if not exists resources jsonb default '[]'::jsonb;
-- v6: исследования (открытые узлы + текущий проект, 1 активный)
alter table public.colony_buildings add column if not exists mining_targets jsonb default '[]'::jsonb;
alter table public.faction_economy add column if not exists research jsonb default '[]'::jsonb;
alter table public.faction_economy add column if not exists research_active text;
alter table public.faction_economy add column if not exists research_ready  timestamptz;

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

-- ── Проекты колоний (отложенные на 1+ ход) ──────────────────
-- Слоты зданий, терраформирование непригодных планет и обустройство
-- среды обитания не применяются мгновенно: проект завершается в конце хода
-- (terraform — через несколько ходов в зависимости от сложности).
create table if not exists public.colony_projects (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text,
  owner_id    uuid,
  kind        text not null,            -- slot | terraform | habitat
  colony_id   uuid,                     -- slot / habitat
  building_id uuid,                     -- slot
  system_id   text,                     -- terraform (новая планета)
  planet_name text,
  planet_type text,
  cells       int default 0,            -- terraform: размер новой колонии / habitat: +ячеек
  payload     jsonb default '{}'::jsonb,-- terraform: снимок ресурсов планеты
  label       text,                     -- человекочитаемое имя проекта
  ready_at    timestamptz,              -- момент завершения (конец хода/ходов)
  created_at  timestamptz default now()
);
create index if not exists cp_faction_idx on public.colony_projects(faction_id);
create index if not exists cp_owner_idx    on public.colony_projects(owner_id);
create index if not exists cp_ready_idx     on public.colony_projects(ready_at);

alter table public.colony_projects enable row level security;
drop policy if exists "cp_sel" on public.colony_projects;
drop policy if exists "cp_ins" on public.colony_projects;
drop policy if exists "cp_del" on public.colony_projects;
create policy "cp_sel" on public.colony_projects for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
create policy "cp_ins" on public.colony_projects for insert to authenticated
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));
create policy "cp_del" on public.colony_projects for delete to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));

-- Применение завершённых проектов колоний (вызывается в начале начисления).
-- Идемпотентно: проект применяется и сразу удаляется только когда ready_at<=now().
create or replace function public._apply_colony_projects(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare pr record;
begin
  for pr in select * from public.colony_projects
            where faction_id = p_fid and ready_at <= now()
            order by ready_at asc
  loop
    if pr.kind = 'slot' then
      update public.colony_buildings set slots_open = least(6, slots_open + 1)
        where id = pr.building_id and faction_id = p_fid;
    elsif pr.kind = 'habitat' then
      update public.colonies set cells = cells + coalesce(pr.cells, 3), terraformed = true
        where id = pr.colony_id and faction_id = p_fid;
    elsif pr.kind = 'terraform' then
      if not exists (select 1 from public.colonies c
                     where c.faction_id = p_fid
                       and c.system_id is not distinct from pr.system_id
                       and c.planet_name = pr.planet_name) then
        insert into public.colonies (faction_id, owner_id, system_id, planet_name, planet_type, cells, terraformed, resources)
          values (p_fid, pr.owner_id, pr.system_id, pr.planet_name, pr.planet_type,
                  coalesce(nullif(pr.cells, 0), 6), true, coalesce(pr.payload->'resources', '[]'::jsonb));
      end if;
    end if;
    delete from public.colony_projects where id = pr.id;
  end loop;
end$$;
revoke all on function public._apply_colony_projects(text) from public;

-- ── RPC: инициализация экономики из одобренной анкеты ────────
-- Базовый набор «нежирных» (common) ресурсов столичной планеты по её типу.
-- Полная версия и одноразовый бэкфилл существующих столиц — в _capital_resources.sql.
create or replace function public._basic_capital_res(p_type text)
returns jsonb language sql immutable as $$
  select case
    when p_type = 'Землеподобные' then jsonb_build_array(
      jsonb_build_object('name','Железо','icon',E'\u2699\uFE0F','r','common'),
      jsonb_build_object('name','Силикаты','icon',E'\U0001FAA8','r','common'),
      jsonb_build_object('name','Углерод','icon',E'\u2B1B','r','common'))
    when p_type = 'Океанические' then jsonb_build_array(
      jsonb_build_object('name','Силикаты','icon',E'\U0001FAA8','r','common'),
      jsonb_build_object('name','Лёд','icon',E'\U0001F9CA','r','common'))
    when p_type = 'Пустынные' then jsonb_build_array(
      jsonb_build_object('name','Железо','icon',E'\u2699\uFE0F','r','common'),
      jsonb_build_object('name','Силикаты','icon',E'\U0001FAA8','r','common'),
      jsonb_build_object('name','Сера','icon',E'\U0001F311','r','common'))
    when p_type = 'Криомиры' then jsonb_build_array(
      jsonb_build_object('name','Лёд','icon',E'\U0001F9CA','r','common'),
      jsonb_build_object('name','Железо','icon',E'\u2699\uFE0F','r','common'),
      jsonb_build_object('name','Силикаты','icon',E'\U0001FAA8','r','common'))
    when p_type in ('Вулканические','Лавовые миры') then jsonb_build_array(
      jsonb_build_object('name','Железо','icon',E'\u2699\uFE0F','r','common'),
      jsonb_build_object('name','Сера','icon',E'\U0001F311','r','common'))
    when p_type = 'Экзотические' then jsonb_build_array(
      jsonb_build_object('name','Углерод','icon',E'\u2B1B','r','common'),
      jsonb_build_object('name','Силикаты','icon',E'\U0001FAA8','r','common'))
    else jsonb_build_array(
      jsonb_build_object('name','Железо','icon',E'\u2699\uFE0F','r','common'),
      jsonb_build_object('name','Силикаты','icon',E'\U0001FAA8','r','common'))
  end
$$;

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

  -- синхронизируем ресурсы колоний из данных карты (только у пустых — быстро)
  update public.colonies c
  set resources = coalesce((
    select pl->'resources'
    from public.map_systems ms, jsonb_array_elements(ms.planets) pl
    where ms.id = c.system_id and pl->>'name' = c.planet_name limit 1
  ), '[]'::jsonb)
  where c.faction_id = app.faction_id
    and (c.resources is null or c.resources = '[]'::jsonb);

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

  -- снимок ресурсов столичной планеты с карты; если их нет (или планеты нет
  -- в данных системы) — выдаём базовые «нежирные» ресурсы, чтобы было что добывать.
  update public.colonies set resources = coalesce(
    (select pl->'resources' from public.map_systems ms, jsonb_array_elements(ms.planets) pl
     where ms.id = app.system_id and pl->>'name' = cap_name
       and jsonb_array_length(coalesce(pl->'resources','[]'::jsonb)) > 0 limit 1),
    public._basic_capital_res(coalesce(
      (select pl->>'type' from public.map_systems ms, jsonb_array_elements(ms.planets) pl
       where ms.id = app.system_id and pl->>'name' = cap_name limit 1), 'Столичный мир'))
  ) where id = cap_colony;

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

-- ════════════════════════════════════════════════════════════
-- v4: ТОРГОВЛЯ · ПЕРЕДАЧА · КРЕДИТЫ/МГА · ШПИОНАЖ
-- ════════════════════════════════════════════════════════════
alter table public.faction_economy add column if not exists agents int default 0;

create table if not exists public.trade_routes (
  id uuid primary key default gen_random_uuid(),
  a_fid text, a_owner uuid, a_name text,
  b_fid text, b_owner uuid, b_name text,
  volume int default 0,
  status text default 'pending',          -- pending | active | declined | closed
  created_at timestamptz default now()
);
create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  lender_fid text, lender_owner uuid, lender_name text,
  borrower_fid text, borrower_owner uuid, borrower_name text,
  amount numeric,
  status text default 'active',           -- active | repaid | disputed | defaulted | forgiven
  note text, resolved_by text,
  created_at timestamptz default now()
);
create table if not exists public.spy_missions (
  id uuid primary key default gen_random_uuid(),
  actor_fid text, actor_owner uuid,
  target_fid text, target_name text,
  mtype text, success boolean, result jsonb,
  created_at timestamptz default now()
);
create index if not exists tr_a_idx on public.trade_routes(a_fid);
create index if not exists tr_b_idx on public.trade_routes(b_fid);
create index if not exists loans_l_idx on public.loans(lender_fid);
create index if not exists loans_b_idx on public.loans(borrower_fid);
create index if not exists spy_actor_idx on public.spy_missions(actor_fid);

alter table public.trade_routes enable row level security;
alter table public.loans        enable row level security;
alter table public.spy_missions enable row level security;

-- читать: участники + стафф (запись — только через RPC ниже)
drop policy if exists "tr_sel" on public.trade_routes;
create policy "tr_sel" on public.trade_routes for select to authenticated
  using (a_owner = auth.uid() or b_owner = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
drop policy if exists "loans_sel" on public.loans;
create policy "loans_sel" on public.loans for select to authenticated
  using (lender_owner = auth.uid() or borrower_owner = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
drop policy if exists "spy_sel" on public.spy_missions;
create policy "spy_sel" on public.spy_missions for select to authenticated
  using (actor_owner = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));

-- ── helper: имя/владелец фракции ──
create or replace function public._fac_name(p_fid text) returns text language sql security definer set search_path=public as $$
  select name from public.faction_applications where faction_id = p_fid and status='approved' order by updated_at desc limit 1
$$;

-- ── Передача ресурсов ──
create or replace function public.economy_transfer(p_to_fid text, p_res text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; cur numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'bad amount'; end if;
  if p_res not in ('gc','tnp','science') then raise exception 'bad resource'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_to_fid = app.faction_id then raise exception 'cannot transfer to self'; end if;
  select * into me from public.faction_economy where faction_id=app.faction_id;
  if not found then raise exception 'no economy'; end if;
  perform 1 from public.faction_economy where faction_id=p_to_fid;
  if not found then raise exception 'recipient has no economy'; end if;
  cur := case p_res when 'gc' then me.gc when 'tnp' then me.tnp else me.science end;
  if cur < p_amount then raise exception 'not enough'; end if;
  if p_res='gc' then
    update public.faction_economy set gc=gc-p_amount where faction_id=app.faction_id;
    update public.faction_economy set gc=gc+p_amount where faction_id=p_to_fid;
  elsif p_res='tnp' then
    update public.faction_economy set tnp=tnp-p_amount where faction_id=app.faction_id;
    update public.faction_economy set tnp=tnp+p_amount where faction_id=p_to_fid;
  else
    update public.faction_economy set science=science-p_amount where faction_id=app.faction_id;
    update public.faction_economy set science=science+p_amount where faction_id=p_to_fid;
  end if;
  return jsonb_build_object('ok',true);
end$$;

-- ── Торговые пути ──
create or replace function public.trade_propose(p_to_fid text, p_volume int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; cap int; used int; bowner uuid;
begin
  if p_volume is null or p_volume <= 0 then raise exception 'bad volume'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_to_fid = app.faction_id then raise exception 'self'; end if;
  select owner_id into bowner from public.faction_economy where faction_id=p_to_fid;
  if bowner is null then raise exception 'recipient has no economy'; end if;
  select coalesce(sum(slots_open),0) into cap from public.colony_buildings where faction_id=app.faction_id and btype='trade';
  select count(*) into used from public.trade_routes where a_fid=app.faction_id and status in ('pending','active');
  if used >= cap then raise exception 'no free trade hub slots'; end if;
  insert into public.trade_routes(a_fid,a_owner,a_name,b_fid,b_owner,b_name,volume,status)
    values(app.faction_id, auth.uid(), app.name, p_to_fid, bowner, public._fac_name(p_to_fid), p_volume, 'pending');
  return jsonb_build_object('ok',true);
end$$;

create or replace function public.trade_respond(p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; r public.trade_routes; cap int; used int;
begin
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into r from public.trade_routes where id=p_id;
  if not found then raise exception 'route not found'; end if;
  if r.b_fid <> app.faction_id then raise exception 'not your route'; end if;
  if r.status <> 'pending' then raise exception 'route not pending'; end if;
  if not p_accept then update public.trade_routes set status='declined' where id=p_id; return jsonb_build_object('ok',true,'status','declined'); end if;
  select coalesce(sum(slots_open),0) into cap from public.colony_buildings where faction_id=app.faction_id and btype='trade';
  select count(*) into used from public.trade_routes where b_fid=app.faction_id and status='active';
  if used >= cap then raise exception 'no free trade hub slots'; end if;
  update public.trade_routes set status='active', b_owner=auth.uid() where id=p_id;
  return jsonb_build_object('ok',true,'status','active');
end$$;

create or replace function public.trade_close(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; r public.trade_routes;
begin
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into r from public.trade_routes where id=p_id;
  if not found then raise exception 'route not found'; end if;
  if r.a_fid <> app.faction_id and r.b_fid <> app.faction_id then raise exception 'not a party'; end if;
  update public.trade_routes set status='closed' where id=p_id;
  return jsonb_build_object('ok',true);
end$$;

-- ── Кредиты ──
create or replace function public.loan_issue(p_to_fid text, p_amount numeric, p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; bowner uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'bad amount'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_to_fid = app.faction_id then raise exception 'self'; end if;
  select * into me from public.faction_economy where faction_id=app.faction_id;
  if me.gc < p_amount then raise exception 'not enough'; end if;
  select owner_id into bowner from public.faction_economy where faction_id=p_to_fid;
  if bowner is null then raise exception 'recipient has no economy'; end if;
  update public.faction_economy set gc=gc-p_amount where faction_id=app.faction_id;
  update public.faction_economy set gc=gc+p_amount where faction_id=p_to_fid;
  insert into public.loans(lender_fid,lender_owner,lender_name,borrower_fid,borrower_owner,borrower_name,amount,status,note)
    values(app.faction_id, auth.uid(), app.name, p_to_fid, bowner, public._fac_name(p_to_fid), p_amount, 'active', p_note);
  return jsonb_build_object('ok',true);
end$$;

create or replace function public.loan_repay(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; l public.loans; me public.faction_economy;
begin
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into l from public.loans where id=p_id;
  if not found then raise exception 'loan not found'; end if;
  if l.borrower_fid <> app.faction_id then raise exception 'not borrower'; end if;
  if l.status not in ('active','disputed') then raise exception 'not repayable'; end if;
  select * into me from public.faction_economy where faction_id=app.faction_id;
  if me.gc < l.amount then raise exception 'not enough to repay'; end if;
  update public.faction_economy set gc=gc-l.amount where faction_id=l.borrower_fid;
  update public.faction_economy set gc=gc+l.amount where faction_id=l.lender_fid;
  update public.loans set status='repaid' where id=p_id;
  return jsonb_build_object('ok',true);
end$$;

create or replace function public.loan_dispute(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; l public.loans;
begin
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into l from public.loans where id=p_id;
  if not found then raise exception 'loan not found'; end if;
  if l.lender_fid <> app.faction_id then raise exception 'not lender'; end if;
  if l.status <> 'active' then raise exception 'not active'; end if;
  update public.loans set status='disputed' where id=p_id;
  return jsonb_build_object('ok',true);
end$$;

create or replace function public.loan_verdict(p_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare l public.loans; me public.faction_economy; pay numeric;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden'; end if;
  select * into l from public.loans where id=p_id;
  if not found then raise exception 'loan not found'; end if;
  if p_action='forgive' then
    update public.loans set status='forgiven', resolved_by=auth.jwt()->>'email' where id=p_id;
  elsif p_action='default' then
    update public.loans set status='defaulted', resolved_by=auth.jwt()->>'email' where id=p_id;
  elsif p_action='repay' then
    select * into me from public.faction_economy where faction_id=l.borrower_fid;
    pay := least(coalesce(me.gc,0), l.amount);
    update public.faction_economy set gc=gc-pay where faction_id=l.borrower_fid;
    update public.faction_economy set gc=gc+pay where faction_id=l.lender_fid;
    update public.loans set status = (case when pay >= l.amount then 'repaid' else 'defaulted' end), resolved_by=auth.jwt()->>'email' where id=p_id;
  else raise exception 'bad action'; end if;
  return jsonb_build_object('ok',true);
end$$;

-- ── Шпионаж ──
create or replace function public.spy_mission(p_target_fid text, p_type text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; tgt public.faction_economy;
  suc boolean; res jsonb; steal numeric; bid uuid; bt text;
begin
  if p_type not in ('recon','sabotage') then raise exception 'bad type'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_target_fid = app.faction_id then raise exception 'self'; end if;
  select * into me from public.faction_economy where faction_id=app.faction_id;
  if coalesce(me.agents,0) < 1 then raise exception 'no agents'; end if;
  select * into tgt from public.faction_economy where faction_id=p_target_fid;
  if not found then raise exception 'target has no economy'; end if;
  update public.faction_economy set agents=agents-1 where faction_id=app.faction_id;
  if p_type='recon' then
    suc := true;
    res := jsonb_build_object('gc',tgt.gc,'tnp',tgt.tnp,'science',tgt.science,'agents',tgt.agents,
      'colonies',(select count(*) from public.colonies where faction_id=p_target_fid),
      'buildings',(select count(*) from public.colony_buildings where faction_id=p_target_fid),
      'units',(select coalesce(sum(qty),0) from public.unit_production where faction_id=p_target_fid and status='done'));
  else
    suc := random() < 0.5;
    if suc then
      if random() < 0.5 then
        steal := round(coalesce(tgt.gc,0)*0.1);
        update public.faction_economy set gc=gc-steal where faction_id=p_target_fid;
        update public.faction_economy set gc=gc+steal where faction_id=app.faction_id;
        res := jsonb_build_object('action','steal','gc',steal);
      else
        select id, btype into bid, bt from public.colony_buildings where faction_id=p_target_fid order by random() limit 1;
        if bid is not null then delete from public.colony_buildings where id=bid; res := jsonb_build_object('action','destroy','building',bt);
        else res := jsonb_build_object('action','none'); end if;
      end if;
    else res := jsonb_build_object('action','failed'); end if;
  end if;
  insert into public.spy_missions(actor_fid,actor_owner,target_fid,target_name,mtype,success,result)
    values(app.faction_id, auth.uid(), p_target_fid, public._fac_name(p_target_fid), p_type, suc, res);
  return jsonb_build_object('ok',true,'success',suc,'result',res);
end$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'economy_transfer(text,text,numeric)','trade_propose(text,int)','trade_respond(uuid,boolean)','trade_close(uuid)',
    'loan_issue(text,numeric,text)','loan_repay(uuid)','loan_dispute(uuid)','loan_verdict(uuid,text)','spy_mission(text,text)','_fac_name(text)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end$$;

-- ── economy_tick v4: + доход торговых путей (с пиратством) + агенты ──
create or replace function public.economy_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  eco public.faction_economy; d int;
  inc_gc numeric:=0; inc_sci numeric:=0; inc_tnp numeric:=0; inc_agents int:=0;
  trade_gc numeric:=0; pirate boolean:=false;
  r record;
begin
  -- FOR UPDATE: блокируем строку казны на время тика. Два параллельных
  -- economy_tick (напр. двойной рендер/две вкладки) сериализуются — второй
  -- дождётся первого, прочитает уже сдвинутый last_tick и d=0 -> без двойного
  -- начисления дохода/ресурсов/торговли.
  select * into eco from public.faction_economy where owner_id=auth.uid() order by created_at asc limit 1 for update;
  if not found then raise exception 'no economy'; end if;

  update public.unit_production set status='done' where faction_id=eco.faction_id and status='queued' and ready_at<=now();

  d := floor(extract(epoch from (now()-eco.last_tick))/86400.0);

  for r in select btype, slots_open, tnp_mode from public.colony_buildings where faction_id=eco.faction_id loop
    if r.btype='factory' then
      if r.tnp_mode then inc_tnp:=inc_tnp+r.slots_open*100; else inc_gc:=inc_gc+r.slots_open*100; end if;
    elsif r.btype in ('mining','trade') then inc_gc:=inc_gc+r.slots_open*100;
    elsif r.btype='science' then inc_sci:=inc_sci+r.slots_open*1;
    elsif r.btype='intel' then inc_agents:=inc_agents+r.slots_open*1;
    end if;
  end loop;

  for r in select volume from public.trade_routes where status='active' and (a_fid=eco.faction_id or b_fid=eco.faction_id) loop
    if random() < 0.15 then pirate:=true; else trade_gc:=trade_gc + r.volume*2; end if;
  end loop;

  if d >= 1 then
    update public.faction_economy
      set gc = gc + (inc_gc + trade_gc) * d,
          science = science + inc_sci * d,
          tnp = tnp + inc_tnp * d,
          agents = agents + inc_agents * d,
          last_tick = last_tick + (d || ' days')::interval
      where faction_id=eco.faction_id returning * into eco;
  end if;

  return jsonb_build_object(
    'faction_id',eco.faction_id,'gc',eco.gc,'science',eco.science,'tnp',eco.tnp,'agents',eco.agents,
    'last_tick',eco.last_tick,'days',d,
    'income', jsonb_build_object('gc',inc_gc+trade_gc,'science',inc_sci,'tnp',inc_tnp,'agents',inc_agents,'trade',trade_gc,'pirate',pirate)
  );
end$$;
revoke all on function public.economy_tick() from public;
grant execute on function public.economy_tick() to authenticated;

-- ════════════════════════════════════════════════════════════
-- v5: РЕСУРСЫ ПЛАНЕТ + ТОРГОВЫЕ КАРАВАНЫ (ТНП выведен)
-- ════════════════════════════════════════════════════════════
alter table public.trade_routes add column if not exists origin_sys text;
alter table public.trade_routes add column if not exists dest_sys   text;
alter table public.trade_routes add column if not exists resource   text;
alter table public.trade_routes add column if not exists price      numeric default 0;
alter table public.trade_routes add column if not exists convoy     int default 0;
alter table public.trade_routes add column if not exists threats    jsonb default '[]'::jsonb;

-- цена ресурса по редкости
create or replace function public._res_price(p_rarity text) returns numeric language sql immutable as $$
  select case p_rarity when 'uncommon' then 5 when 'rare' then 12 when 'epic' then 30 when 'legendary' then 80 else 2 end::numeric
$$;

-- ── Локальная продажа ресурса (страховочный сбыт, 80% цены) ──
create or replace function public.economy_sell_resource(p_name text, p_units numeric, p_rarity text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; eco public.faction_economy; have numeric; gain numeric;
begin
  if p_units is null or p_units <= 0 then raise exception 'bad units'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into eco from public.faction_economy where faction_id=app.faction_id;
  have := coalesce((eco.resources->>p_name)::numeric, 0);
  if have < p_units then raise exception 'not enough resource'; end if;
  gain := floor(p_units * public._res_price(p_rarity) * 0.8);
  update public.faction_economy
    set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[p_name], to_jsonb(have - p_units), true),
        gc = gc + gain
    where faction_id=app.faction_id;
  return jsonb_build_object('ok', true, 'gain', gain);
end$$;

-- ── Торговый караван: предложение (заменяет старый trade_propose) ──
drop function if exists public.trade_propose(text, int);
create or replace function public.trade_propose(p_to_fid text, p_origin_sys text, p_dest_sys text, p_resource text, p_rarity text, p_volume int, p_convoy int, p_threats jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; cap int; used int; bowner uuid; roster_ships int; committed int;
begin
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
           p_origin_sys, p_dest_sys, p_resource, public._res_price(p_rarity), coalesce(p_convoy,0), coalesce(p_threats,'[]'::jsonb));
  return jsonb_build_object('ok', true);
end$$;

do $$
declare fn text;
begin
  foreach fn in array array['economy_sell_resource(text,numeric,text)','trade_propose(text,text,text,text,text,int,int,jsonb)','_res_price(text)'] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end$$;

-- ── economy_tick v5: фабрика→ГС, добыча→ресурсы, караваны (пиратство/эскорт), агенты ──
create or replace function public.economy_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  eco public.faction_economy; d int;
  inc_gc numeric:=0; inc_sci numeric:=0; inc_agents int:=0; trade_gc numeric:=0; pirate boolean:=false;
  r record; col record; relem jsonb; thr jsonb;
  res_add jsonb := '{}'::jsonb; res_sub jsonb := '{}'::jsonb; merged jsonb; k text;
  rname text; rr text; rate numeric; escorted boolean; attacked boolean; chance numeric; avail numeric; shipped numeric;
begin
  -- FOR UPDATE: блокируем строку казны на время тика. Два параллельных
  -- economy_tick (напр. двойной рендер/две вкладки) сериализуются — второй
  -- дождётся первого, прочитает уже сдвинутый last_tick и d=0 -> без двойного
  -- начисления дохода/ресурсов/торговли.
  select * into eco from public.faction_economy where owner_id=auth.uid() order by created_at asc limit 1 for update;
  if not found then raise exception 'no economy'; end if;

  update public.unit_production set status='done' where faction_id=eco.faction_id and status='queued' and ready_at<=now();

  -- завершение исследования (1 ход)
  if eco.research_active is not null and eco.research_ready is not null and eco.research_ready <= now() then
    update public.faction_economy
      set research = coalesce(research,'[]'::jsonb) || to_jsonb(eco.research_active::text),
          research_active = null, research_ready = null
      where faction_id = eco.faction_id;
    select * into eco from public.faction_economy where faction_id = eco.faction_id;
  end if;

  d := floor(extract(epoch from (now()-eco.last_tick))/86400.0);

  for r in select btype, slots_open from public.colony_buildings where faction_id=eco.faction_id loop
    if r.btype in ('factory','mining','trade') then inc_gc := inc_gc + r.slots_open*100;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    end if;
  end loop;

  if d >= 1 then
    -- добыча ресурсов планет (колонии с Добывающим заводом)
    for col in
      select c.resources as cres,
             (select coalesce(sum(cb.slots_open),0) from public.colony_buildings cb where cb.colony_id=c.id and cb.btype='mining') as mslots
      from public.colonies c where c.faction_id=eco.faction_id
    loop
      if col.mslots > 0 and col.cres is not null then
        for relem in select value from jsonb_array_elements(col.cres) loop
          rname := relem->>'name'; if rname is null then continue; end if;
          rr := coalesce(relem->>'r','common');
          rate := case rr when 'uncommon' then 12 when 'rare' then 5 when 'epic' then 2 when 'legendary' then 1 else 25 end;
          res_add := jsonb_set(res_add, array[rname], to_jsonb(coalesce((res_add->>rname)::numeric,0) + col.mslots*rate*d), true);
        end loop;
      end if;
    end loop;

    -- торговые караваны (где фракция — отправитель)
    for r in select volume, resource, price, convoy, threats from public.trade_routes where status='active' and a_fid=eco.faction_id loop
      escorted := coalesce(r.convoy,0) > 0; attacked := false;
      for thr in select value from jsonb_array_elements(coalesce(r.threats,'[]'::jsonb)) loop
        if (thr->>'type') = 'ancient' then chance := case when escorted then 0.65 else 0.80 end;
        else chance := case when escorted then 0.40 else 0.80 end; end if;
        if random() < chance then attacked := true; end if;
      end loop;
      if attacked then pirate := true; continue; end if;
      avail := coalesce((eco.resources->>r.resource)::numeric,0) + coalesce((res_add->>r.resource)::numeric,0) - coalesce((res_sub->>r.resource)::numeric,0);
      shipped := least(coalesce(r.volume,0)*d, avail);
      if shipped <= 0 then continue; end if;
      res_sub := jsonb_set(res_sub, array[r.resource], to_jsonb(coalesce((res_sub->>r.resource)::numeric,0)+shipped), true);
      trade_gc := trade_gc + shipped * coalesce(r.price,0);
      update public.faction_economy set gc = gc + round(shipped*coalesce(r.price,0)*0.33) where faction_id = r.b_fid;
    end loop;

    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_add) loop
      merged := jsonb_set(merged, array[k], to_jsonb(coalesce((merged->>k)::numeric,0) + (res_add->>k)::numeric), true);
    end loop;
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric)), true);
    end loop;

    update public.faction_economy
      set gc = gc + inc_gc*d + trade_gc,
          science = science + inc_sci*d,
          agents = agents + inc_agents*d,
          resources = merged,
          last_tick = last_tick + (d || ' days')::interval
      where faction_id=eco.faction_id returning * into eco;
  end if;

  return jsonb_build_object('faction_id',eco.faction_id,'gc',eco.gc,'science',eco.science,'agents',eco.agents,
    'resources',eco.resources,'last_tick',eco.last_tick,'days',d,
    'income', jsonb_build_object('gc',inc_gc,'science',inc_sci,'agents',inc_agents,'trade',trade_gc,'pirate',pirate));
end$$;
revoke all on function public.economy_tick() from public;
grant execute on function public.economy_tick() to authenticated;

-- ════════════════════════════════════════════════════════════
-- v6: ИССЛЕДОВАНИЯ — старт проекта (ОН + 1 ход, 1 активный)
-- ════════════════════════════════════════════════════════════
create or replace function public.economy_research(p_node text, p_cost numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; eco public.faction_economy;
begin
  if p_node is null or p_node = '' then raise exception 'bad node'; end if;
  if p_cost is null or p_cost < 0 then raise exception 'bad cost'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into eco from public.faction_economy where faction_id=app.faction_id;
  if not found then raise exception 'no economy'; end if;
  if eco.research_active is not null then raise exception 'research in progress'; end if;
  if coalesce(eco.research,'[]'::jsonb) ? p_node then raise exception 'already researched'; end if;
  if coalesce(eco.science,0) < p_cost then raise exception 'not enough science'; end if;
  update public.faction_economy
    set science = science - p_cost, research_active = p_node, research_ready = now() + interval '1 day'
    where faction_id = app.faction_id;
  return jsonb_build_object('ok', true, 'ready_at', now() + interval '1 day');
end$$;
revoke all on function public.economy_research(text,numeric) from public;
grant execute on function public.economy_research(text,numeric) to authenticated;

-- ════════════════════════════════════════════════════════════
-- v7: АВТОНАЧИСЛЕНИЕ — доход капает САМ (планировщик), а не «по клику»
-- ════════════════════════════════════════════════════════════

-- Ядро начисления для ОДНОЙ фракции по faction_id (с FOR UPDATE — без гонок).
-- Используется и economy_tick (свой кабинет — фолбэк/мгновенная актуализация),
-- и economy_tick_all (ежедневный планировщик для ВСЕХ).
create or replace function public.economy_accrue(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  eco public.faction_economy; d int;
  inc_gc numeric:=0; inc_sci numeric:=0; inc_agents int:=0; trade_gc numeric:=0; pirate boolean:=false;
  r record; col record; bld record; relem jsonb; thr jsonb;
  res_add jsonb := '{}'::jsonb; res_sub jsonb := '{}'::jsonb; merged jsonb; k text;
  rname text; rr text; rate numeric; escorted boolean; attacked boolean; chance numeric; avail numeric; shipped numeric;
begin
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then return jsonb_build_object('faction_id',p_fid,'days',0); end if;

  update public.unit_production set status='done' where faction_id=p_fid and status='queued' and ready_at<=now();

  -- завершённые проекты колоний (слоты/терраформ/обустройство среды)
  perform public._apply_colony_projects(p_fid);

  if eco.research_active is not null and eco.research_ready is not null and eco.research_ready <= now() then
    update public.faction_economy
      set research = coalesce(research,'[]'::jsonb) || to_jsonb(eco.research_active::text),
          research_active = null, research_ready = null
      where faction_id = p_fid;
    select * into eco from public.faction_economy where faction_id = p_fid;
  end if;

  d := floor(extract(epoch from (now()-eco.last_tick))/86400.0);

  for r in select btype, slots_open from public.colony_buildings where faction_id=p_fid loop
    if r.btype in ('factory','mining','trade') then inc_gc := inc_gc + r.slots_open*100;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    end if;
  end loop;

  if d >= 1 then
    -- добыча: каждое mining-здание добывает только назначенные месторождения, 1 слот = 1 месторождение
    for bld in
      select cb.mining_targets, c.resources as cres
      from public.colony_buildings cb
      join public.colonies c on c.id = cb.colony_id
      where cb.faction_id = p_fid and cb.btype = 'mining'
        and jsonb_array_length(coalesce(cb.mining_targets,'[]'::jsonb)) > 0
        and c.resources is not null and jsonb_array_length(c.resources) > 0
    loop
      for rname in select value from jsonb_array_elements_text(bld.mining_targets) loop
        select value into relem from jsonb_array_elements(bld.cres) where value->>'name' = rname limit 1;
        if relem is null then continue; end if;
        rr := coalesce(relem->>'r','common');
        rate := case rr when 'uncommon' then 12 when 'rare' then 5 when 'epic' then 2 when 'legendary' then 1 else 25 end;
        res_add := jsonb_set(res_add, array[rname], to_jsonb(coalesce((res_add->>rname)::numeric,0) + rate*d), true);
      end loop;
    end loop;

    for r in select volume, resource, price, convoy, threats, b_fid from public.trade_routes where status='active' and a_fid=p_fid loop
      escorted := coalesce(r.convoy,0) > 0; attacked := false;
      for thr in select value from jsonb_array_elements(coalesce(r.threats,'[]'::jsonb)) loop
        if (thr->>'type') = 'ancient' then chance := case when escorted then 0.65 else 0.80 end;
        else chance := case when escorted then 0.40 else 0.80 end; end if;
        if random() < chance then attacked := true; end if;
      end loop;
      if attacked then pirate := true; continue; end if;
      avail := coalesce((eco.resources->>r.resource)::numeric,0) + coalesce((res_add->>r.resource)::numeric,0) - coalesce((res_sub->>r.resource)::numeric,0);
      shipped := least(coalesce(r.volume,0)*d, avail);
      if shipped <= 0 then continue; end if;
      res_sub := jsonb_set(res_sub, array[r.resource], to_jsonb(coalesce((res_sub->>r.resource)::numeric,0)+shipped), true);
      trade_gc := trade_gc + shipped * coalesce(r.price,0);
      update public.faction_economy set gc = gc + round(shipped*coalesce(r.price,0)*0.33) where faction_id = r.b_fid;
    end loop;

    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_add) loop
      merged := jsonb_set(merged, array[k], to_jsonb(coalesce((merged->>k)::numeric,0) + (res_add->>k)::numeric), true);
    end loop;
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric)), true);
    end loop;

    update public.faction_economy
      set gc = gc + inc_gc*d + trade_gc,
          science = science + inc_sci*d,
          agents = agents + inc_agents*d,
          resources = merged,
          last_tick = last_tick + (d || ' days')::interval
      where faction_id=p_fid returning * into eco;
  end if;

  return jsonb_build_object('faction_id',eco.faction_id,'gc',eco.gc,'science',eco.science,'agents',eco.agents,
    'resources',eco.resources,'last_tick',eco.last_tick,'days',d,
    'income', jsonb_build_object('gc',inc_gc,'science',inc_sci,'agents',inc_agents,'trade',trade_gc,'pirate',pirate));
end$$;

-- ── Назначение месторождений для mining-здания ───────────────
create or replace function public.mining_assign(p_building_id uuid, p_targets jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.colony_buildings;
begin
  select * into b from public.colony_buildings where id = p_building_id and owner_id = auth.uid();
  if not found then raise exception 'building not found'; end if;
  if b.btype != 'mining' then raise exception 'not a mining building'; end if;
  if jsonb_array_length(coalesce(p_targets,'[]'::jsonb)) > b.slots_open then
    raise exception 'too many targets: max % slots', b.slots_open;
  end if;
  update public.colony_buildings set mining_targets = coalesce(p_targets,'[]'::jsonb) where id = p_building_id;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.mining_assign(uuid, jsonb) from public;
grant execute on function public.mining_assign(uuid, jsonb) to authenticated;

-- economy_tick(): начисление СВОЕЙ фракции (вызывается при заходе — мгновенная
-- актуализация; идемпотентно, не двоит благодаря FOR UPDATE в economy_accrue).
create or replace function public.economy_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  select faction_id into fid from public.faction_economy where owner_id=auth.uid() order by created_at asc limit 1;
  if fid is null then raise exception 'no economy'; end if;
  return public.economy_accrue(fid);
end$$;

-- economy_tick_all(): начисление ВСЕМ фракциям (для ежедневного планировщика).
-- Идемпотентно (двигает last_tick на целые сутки) — безопасно дёргать хоть anon.
create or replace function public.economy_tick_all()
returns jsonb language plpgsql security definer set search_path=public as $$
declare f record; n int := 0;
begin
  for f in select faction_id from public.faction_economy loop
    begin perform public.economy_accrue(f.faction_id); n := n + 1;
    exception when others then null; end;  -- одна сбойная фракция не валит весь прогон
  end loop;
  return jsonb_build_object('ok', true, 'factions', n, 'at', now());
end$$;

revoke all on function public.economy_accrue(text) from public;     -- внутренняя
revoke all on function public.economy_tick() from public;
revoke all on function public.economy_tick_all() from public;
grant execute on function public.economy_tick() to authenticated;
grant execute on function public.economy_tick_all() to anon, authenticated;

-- ── Планировщик: ежедневное автоначисление через pg_cron (00:05 UTC) ──
-- Если pg_cron недоступен — резервом служит GitHub Action keep-alive.yml,
-- который раз в сутки дёргает RPC economy_tick_all (см. .github/workflows).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      if exists (select 1 from cron.job where jobname = 'economy-daily-tick') then
        perform cron.unschedule('economy-daily-tick');
      end if;
      perform cron.schedule('economy-daily-tick', '5 0 * * *', 'select public.economy_tick_all();');
      raise notice 'pg_cron: ежедневный economy_tick_all запланирован (00:05 UTC)';
    exception when others then
      raise notice 'pg_cron настроить не удалось (%) — используйте GitHub Action keep-alive', sqlerrm;
    end;
  else
    raise notice 'pg_cron недоступен — ежедневный тик обеспечит GitHub Action keep-alive.yml';
  end if;
end$$;

-- ════════════════════════════════════════════════════════════
-- ПАТЧ: backfill ресурсов колоний из данных карты
-- Исправляет колонии, созданные до добавления ресурсов (resources = []).
-- Безопасно запускать повторно — трогает только пустые колонии.
-- ════════════════════════════════════════════════════════════
update public.colonies c
set resources = pl->'resources'
from public.map_systems ms, jsonb_array_elements(ms.planets) pl
where ms.id = c.system_id
  and pl->>'name' = c.planet_name
  and (c.resources is null or c.resources = '[]'::jsonb or jsonb_array_length(c.resources) = 0)
  and jsonb_typeof(pl->'resources') = 'array'
  and jsonb_array_length(pl->'resources') > 0;
