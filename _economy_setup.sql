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
-- v8: тайные операции 2.0 — контрразведка и дебафф дестабилизации
alter table public.faction_economy add column if not exists counter_agents int default 0;
alter table public.faction_economy add column if not exists debuff_until    timestamptz;
alter table public.faction_economy add column if not exists debuff_pct      numeric default 0;
-- spy_missions: расширение под планируемые операции с длительностью/факторами
alter table public.spy_missions add column if not exists target_owner uuid;
alter table public.spy_missions add column if not exists op           text;
alter table public.spy_missions add column if not exists params       jsonb default '{}'::jsonb;
alter table public.spy_missions add column if not exists agents       int default 1;
alter table public.spy_missions add column if not exists success_pct  int default 0;
alter table public.spy_missions add column if not exists detect_pct   int default 0;
alter table public.spy_missions add column if not exists status       text default 'done';
alter table public.spy_missions add column if not exists outcome      text;
alter table public.spy_missions add column if not exists detected     boolean default false;
alter table public.spy_missions add column if not exists started_at   timestamptz;
alter table public.spy_missions add column if not exists ready_at     timestamptz;

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
    if pr.kind = 'build' then
      insert into public.colony_buildings (colony_id, faction_id, owner_id, btype, slots_open, tnp_mode)
        values (pr.colony_id, p_fid, pr.owner_id, pr.btype,
                coalesce((pr.payload->>'free_slots')::int, 1), false);
    elsif pr.kind = 'slot' then
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

-- Бонусные стартовые постройки доктрины: форма правления + идеология дают
-- по одному тематическому зданию («допдомики»).
create or replace function public._doctrine_grant_buildings(p_gov text, p_ideology text)
returns text[] language sql immutable as $$
  select array_remove(array[
    case p_gov
      when 'Республика' then 'trade'           when 'Монархия' then 'factory'
      when 'Империя' then 'military_factory'    when 'Олигархия' then 'factory'
      when 'Диктатура' then 'training'          when 'Теократия' then 'training'
      when 'Технократия' then 'science'         when 'Корпоратократия' then 'trade'
      when 'Коллективный разум' then 'science'  when 'Машинный разум (ИИ)' then 'science'
      else null end,
    case p_ideology
      when 'Технократия (Культ науки)' then 'science'  when 'Милитаризм (Культ силы)' then 'military_factory'
      when 'Пацифизм' then 'factory'                   when 'Экспансионизм' then 'mining'
      when 'Изоляционизм' then 'intel'                 when 'Ксенофилия' then 'trade'
      when 'Ксенофобия' then 'training'                when 'Спиритуализм' then 'training'
      when 'Трансгуманизм' then 'science'              when 'Экоцентризм' then 'mining'
      when 'Индустриализм' then 'factory'              else null end
  ], null)
$$;
-- Бесплатная стартовая технология доктрины (стабильные id компонент-узлов).
create or replace function public._doctrine_grant_techs(p_ideology text)
returns jsonb language sql immutable as $$
  select case p_ideology
    when 'Технократия (Культ науки)' then '["comp.ship.reactor"]'::jsonb
    when 'Милитаризм (Культ силы)'   then '["comp.ground.armor"]'::jsonb
    when 'Трансгуманизм'             then '["comp.ground.shield"]'::jsonb
    when 'Индустриализм'             then '["comp.ship.engine"]'::jsonb
    when 'Изоляционизм'              then '["comp.ground.shield"]'::jsonb
    when 'Ксенофобия'                then '["comp.ground.armor"]'::jsonb
    else '[]'::jsonb end
$$;

-- Флаг разового доначисления стартовых зданий (для уже созданных фракций).
alter table public.faction_economy add column if not exists starter_fixed boolean default false;
-- Единый источник истины для столицы: флаг колонии + выбранная родная среда планеты.
alter table public.colonies add column if not exists is_capital boolean default false;
alter table public.faction_applications add column if not exists capital_env text;

-- Родные среды расы (зеркало EC_HAB из economy.js).
create or replace function public._race_native_envs(p_race text) returns text[] language sql immutable as $$
  select case p_race
    when 'Гуманоиды'                  then array['terrestrial']
    when 'Млекопитающие'              then array['terrestrial','oceanic']
    when 'Рептилоиды'                 then array['desert','volcanic','terrestrial']
    when 'Авианы (Птицеподобные)'     then array['terrestrial','desert']
    when 'Инсектоиды'                 then array['terrestrial','desert','volcanic']
    when 'Акватики (Водные)'          then array['oceanic']
    when 'Плантоиды (Растениевидные)' then array['terrestrial','oceanic']
    when 'Литоиды (Каменные)'         then array['micro','lava','desert']
    when 'Синтетики / Киборги'        then array['terrestrial','desert','cryo','micro','lava','volcanic','exotic']
    when 'Энергетические сущности'    then array['exotic','cryo','lava']
    else array['terrestrial'] end
$$;

-- Среда → название типа планеты (обратимо классифицируется ecPlanetGroup через EC_GRP_NAME).
create or replace function public._env_label(p_env text) returns text language sql immutable as $$
  select case p_env
    when 'terrestrial' then 'Землеподобные'
    when 'oceanic'     then 'Океанические'
    when 'desert'      then 'Пустынные'
    when 'volcanic'    then 'Вулканические'
    when 'lava'        then 'Лавовые миры'
    when 'cryo'        then 'Криомиры'
    when 'micro'       then 'Малые тела'
    when 'exotic'      then 'Экзотические'
    else 'Землеподобные' end
$$;

-- Гарантирует столичную планету фракции: генерирует её в map_systems.planets
-- (по имени из анкеты и родной среде расы), создаёт/находит столичную колонию
-- с is_capital=true. Идемпотентно. Источник истины о столице.
create or replace function public._ensure_capital(p_fid text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  app public.faction_applications;
  env text; ptype text; cap_name text; cap_id uuid; sys_id text; pres jsonb;
begin
  select * into app from public.faction_applications
    where faction_id = p_fid and status = 'approved'
    order by updated_at desc limit 1;
  if not found then return null; end if;

  -- Существующая столичная колония — источник истины (её актуальные система и имя).
  select id, system_id, planet_name into cap_id, sys_id, cap_name from public.colonies
    where faction_id = p_fid
    order by is_capital desc, (planet_type = 'Столичный мир') desc, created_at asc limit 1;
  -- Новая фракция: система и имя берутся из анкеты.
  if cap_id is null then
    sys_id := app.system_id;
    cap_name := coalesce(nullif(app.planet_name, ''), app.system_name, 'Столица');
  end if;
  if sys_id is null then return cap_id; end if;

  env   := coalesce(nullif(app.capital_env, ''), (public._race_native_envs(app.race))[1], 'terrestrial');
  ptype := public._env_label(env);

  -- генерируем планету на карте, если её ещё нет в столичной системе
  if not exists (
    select 1 from public.map_systems ms, jsonb_array_elements(ms.planets) e
    where ms.id = sys_id and e->>'name' = cap_name
  ) then
    update public.map_systems
      set planets = coalesce(planets, '[]'::jsonb) || jsonb_build_object(
            'name', cap_name, 'type', ptype, 'slotsP', 9,
            'resources', public._basic_capital_res(ptype))
      where id = sys_id;
  end if;

  -- ресурсы столичной планеты с карты
  select e->'resources' into pres from public.map_systems ms, jsonb_array_elements(ms.planets) e
    where ms.id = sys_id and e->>'name' = cap_name limit 1;

  -- столичная колония (создаём только для новой фракции)
  if cap_id is null then
    insert into public.colonies (faction_id, owner_id, system_id, planet_name, planet_type, cells, is_capital, resources)
      values (p_fid, app.owner_id, sys_id, cap_name, ptype, 9, true, coalesce(pres, '[]'::jsonb))
      on conflict (system_id, planet_name) do nothing
      returning id into cap_id;
    if cap_id is null then
      select id into cap_id from public.colonies
        where system_id is not distinct from sys_id and planet_name = cap_name limit 1;
    end if;
  end if;

  -- ровно одна столица на фракцию + система закреплена на карте
  update public.colonies set is_capital = (id = cap_id) where faction_id = p_fid;
  update public.map_systems set faction = p_fid where id = sys_id;
  return cap_id;
end$$;
revoke all on function public._ensure_capital(text) from public;

-- Доначисляет недостающие СТАРТОВЫЕ здания одной фракции до ожидаемого набора:
--   бесплатное по типу цивилизации + купленные в анкете + гранты доктрины.
-- Идемпотентно — создаёт только дефицит по каждому типу здания.
create or replace function public._ensure_starter_buildings(p_fid text)
returns void language plpgsql security definer set search_path = public as $$
declare
  app public.faction_applications;
  cap uuid;
  expected text[] := array[]::text[];
  b text; t text; want int; have int; i int;
begin
  select * into app from public.faction_applications
    where faction_id = p_fid and status = 'approved'
    order by updated_at desc limit 1;
  if not found then return; end if;

  select id into cap from public.colonies
    where faction_id = p_fid
    order by is_capital desc, (planet_type = 'Столичный мир') desc, created_at asc limit 1;
  if cap is null then return; end if;

  -- 1) бесплатное по типу цивилизации
  expected := expected || (case when app.civ_type = 'frontier' then 'intel' else 'factory' end);
  -- 2) купленные в анкете (id → btype, как в economy_init)
  for b in select jsonb_array_elements_text(coalesce(app.buildings, '[]'::jsonb)) loop
    t := case b
      when 'encom' then 'factory'  when 'ind'  then 'mining'
      when 'unit'  then 'trade'    when 'sci'  then 'science'
      when 'emb'   then 'training' when 'com'  then 'intel'
      when 'yard'  then 'military_factory' when 'mil' then 'shipyard'
      else null end;
    if t is not null then expected := expected || t; end if;
  end loop;
  -- 3) гранты доктрины (форма правления + идеология)
  expected := expected || public._doctrine_grant_buildings(app.gov, app.ideology);

  -- дозаполняем дефицит по каждому типу здания
  for t in select distinct unnest(expected) loop
    want := (select count(*) from unnest(expected) e(v) where e.v = t);
    have := (select count(*) from public.colony_buildings cb
             where cb.faction_id = p_fid and cb.btype = t);
    if have < want then
      for i in 1..(want - have) loop
        insert into public.colony_buildings (colony_id, faction_id, owner_id, btype, slots_open)
        values (cap, p_fid, app.owner_id, t, case when t in ('factory','mining') then 2 else 1 end);
      end loop;
    end if;
  end loop;
end$$;
revoke all on function public._ensure_starter_buildings(text) from public;

create or replace function public.economy_init()
returns public.faction_economy
language plpgsql
security definer
set search_path = public
as $$
declare
  app public.faction_applications;
  eco public.faction_economy;
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
  if found then
    -- разово догоняем недовыданное у старых фракций (до фикса): столица на карте + здания
    if not coalesce(eco.starter_fixed, false) then
      perform public._ensure_capital(app.faction_id);
      perform public._ensure_starter_buildings(app.faction_id);
      update public.faction_economy set starter_fixed = true where faction_id = app.faction_id;
    end if;
    return eco;
  end if;

  insert into public.faction_economy (faction_id, owner_id, owner_email, gc, science, tnp, last_tick, research, starter_fixed)
    values (app.faction_id, app.owner_id, app.owner_email,
            case when app.bonus_money then 500 else 0 end, 0, 0, now(),
            public._doctrine_grant_techs(app.ideology), true)   -- бесплатные техи доктрины
    returning * into eco;

  -- столичная планета (генерируется прямо на карту) + столичная колония is_capital
  perform public._ensure_capital(app.faction_id);

  -- стартовые здания: бесплатное по типу + купленные в анкете + гранты доктрины
  perform public._ensure_starter_buildings(app.faction_id);

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
  mods jsonb;
begin
  select * into app from public.faction_applications
    where owner_id = auth.uid() and status = 'approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  -- доктрина: модификаторы стоимости и кулдауна захвата
  mods := public._faction_mods(app.faction_id);
  cost := round(3000 * (mods->>'claim_cost')::numeric);
  cd := (round(7 * (mods->>'claim_cd')::numeric) || ' days')::interval;
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
create index if not exists spy_target_idx on public.spy_missions(target_owner);
create index if not exists spy_ready_idx  on public.spy_missions(ready_at);
drop policy if exists "spy_sel" on public.spy_missions;
-- Приватность: свои операции видит автор; цель — ТОЛЬКО раскрытые против себя; стафф — всё.
create policy "spy_sel" on public.spy_missions for select to authenticated
  using (actor_owner = auth.uid()
      or (target_owner = auth.uid() and detected = true)
      or public.current_user_role() in ('superadmin','editor','moderator'));

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
-- ════════════════════════════════════════════════════════════
-- ТАЙНЫЕ ОПЕРАЦИИ 2.0 — планирование, формула, длительность, контрразведка
-- ⚠ ФОРМУЛЫ ДОЛЖНЫ СОВПАДАТЬ с ecSpyCalc/EC_SPY_OPS в economy.js.
-- ════════════════════════════════════════════════════════════
-- Сложность/база длительности операции.
create or replace function public._spy_op_meta(p_op text)
returns jsonb language sql immutable as $$
  select case p_op
    when 'recon_basic' then '{"diff":0,"base":1,"need":"","recon":"basic"}'::jsonb
    when 'recon_deep'  then '{"diff":15,"base":2,"need":"","recon":"deep"}'::jsonb
    when 'steal_gc'    then '{"diff":25,"base":2,"need":"basic"}'::jsonb
    when 'sabotage'    then '{"diff":30,"base":2,"need":"deep"}'::jsonb
    when 'destabilize' then '{"diff":35,"base":3,"need":"basic"}'::jsonb
    when 'steal_tech'  then '{"diff":45,"base":4,"need":"deep"}'::jsonb
    else null end
$$;
-- Сила спецслужб фракции от доктрины (agents_flat*5).
create or replace function public._spy_power(p_fid text)
returns numeric language sql stable as $$
  select coalesce((public._faction_mods(p_fid)->>'agents_flat')::numeric,0) * 5
$$;
-- Свежая разведка актора по цели: 'deep' | 'basic' | null + возраст(дней).
create or replace function public._spy_intel(p_actor text, p_target text)
returns jsonb language sql stable as $$
  select coalesce((
    select jsonb_build_object(
      'level', case when bool_or(op='recon_deep') then 'deep' else 'basic' end,
      'age', floor(extract(epoch from (now()-max(coalesce(ready_at,created_at))))/86400.0))
    from public.spy_missions
    where actor_fid=p_actor and target_fid=p_target and outcome='success' and op in ('recon_basic','recon_deep')
  ), '{"level":null,"age":9999}'::jsonb)
$$;

-- Запуск операции: списывает агентов, считает факторы, ставит в очередь на N ходов.
create or replace function public.spy_launch(p_target_fid text, p_op text, p_agents int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; tgt public.faction_economy;
  meta jsonb; intel jsonb; diff numeric; need text; rec text;
  a int; busy int; freeag int; ci int; ibonus numeric; spow numeric; succ int; det int; turns int;
  tgt_owner uuid;
begin
  meta := public._spy_op_meta(p_op);
  if meta is null then raise exception 'bad op'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_target_fid = app.faction_id then raise exception 'self'; end if;
  select * into me from public.faction_economy where faction_id=app.faction_id for update;
  select * into tgt from public.faction_economy where faction_id=p_target_fid;
  if not found then raise exception 'target has no economy'; end if;
  select owner_id into tgt_owner from public.faction_economy where faction_id=p_target_fid;

  a := greatest(1, coalesce(p_agents,1));
  select coalesce(sum(agents),0) into busy from public.spy_missions where actor_fid=app.faction_id and status='active';
  freeag := coalesce(me.agents,0) - coalesce(me.counter_agents,0) - busy;
  if a > freeag then raise exception 'not enough free agents'; end if;

  -- требование разведки
  intel := public._spy_intel(app.faction_id, p_target_fid);
  need := meta->>'need';
  rec := intel->>'level';
  if need = 'basic' and rec is null then raise exception 'intel required: basic recon'; end if;
  if need = 'deep'  and rec is distinct from 'deep' then raise exception 'intel required: deep recon'; end if;

  -- факторы
  diff := (meta->>'diff')::numeric;
  ci := coalesce(tgt.counter_agents,0);
  ibonus := case when meta ? 'recon' then 0
                 else greatest(0, (case when rec='deep' then 20 else 10 end) - coalesce((intel->>'age')::numeric,9999)) end;
  spow := public._spy_power(app.faction_id);
  succ := greatest(5,  least(95, round(45 + a*8 + ibonus + spow - diff - ci*9)));
  det  := greatest(2,  least(90, round(8 + diff*0.5 + ci*12 + a*2 + public._spy_power(p_target_fid) - spow)));
  turns := greatest(1, ceil((meta->>'base')::numeric * (1 + diff/100.0) / sqrt(a)));

  update public.faction_economy set agents = agents - a where faction_id=app.faction_id;  -- агенты заняты
  insert into public.spy_missions(actor_fid,actor_owner,target_fid,target_owner,target_name,op,mtype,agents,
      success_pct,detect_pct,status,started_at,ready_at,params)
    values(app.faction_id, auth.uid(), p_target_fid, tgt_owner, public._fac_name(p_target_fid), p_op, p_op, a,
      succ, det, 'active', now(), coalesce(me.last_tick, now()) + (turns || ' days')::interval, '{}'::jsonb);
  return jsonb_build_object('ok',true,'success_pct',succ,'detect_pct',det,'turns',turns);
end$$;

-- Назначить агентов в контрразведку (≤ свободных).
create or replace function public.counterintel_set(p_n int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; busy int; n int;
begin
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into me from public.faction_economy where faction_id=app.faction_id for update;
  select coalesce(sum(agents),0) into busy from public.spy_missions where actor_fid=app.faction_id and status='active';
  n := greatest(0, least(coalesce(p_n,0), coalesce(me.agents,0) - busy));
  update public.faction_economy set counter_agents = n where faction_id=app.faction_id;
  return jsonb_build_object('ok',true,'counter_agents',n);
end$$;

-- Отозвать активную операцию (вернуть агентов).
create or replace function public.spy_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.spy_missions;
begin
  select * into m from public.spy_missions where id=p_id and actor_owner=auth.uid() and status='active';
  if not found then raise exception 'not found'; end if;
  update public.faction_economy set agents = agents + m.agents where faction_id=m.actor_fid;
  delete from public.spy_missions where id=p_id;
  return jsonb_build_object('ok',true);
end$$;

-- Разрешение готовых операций фракции (вызывается в economy_accrue).
create or replace function public._spy_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare m public.spy_missions; ok boolean; caught boolean; res jsonb; steal numeric; bid uuid; bt text;
  techs jsonb; node text; tgt public.faction_economy;
begin
  for m in select * from public.spy_missions where actor_fid=p_fid and status='active' and ready_at<=now() loop
    ok := (random()*100) < m.success_pct;
    caught := (random()*100) < m.detect_pct;
    res := '{}'::jsonb;
    select * into tgt from public.faction_economy where faction_id=m.target_fid;

    if ok then
      if m.op in ('recon_basic','recon_deep') then
        res := jsonb_build_object('gc',tgt.gc,'science',tgt.science,'agents',tgt.agents,
          'colonies',(select count(*) from public.colonies where faction_id=m.target_fid),
          'buildings',(select count(*) from public.colony_buildings where faction_id=m.target_fid));
        if m.op='recon_deep' then res := res || jsonb_build_object(
          'units',(select coalesce(sum(qty),0) from public.unit_production where faction_id=m.target_fid and status='done'),
          'research',(select coalesce(jsonb_array_length(research),0) from public.faction_economy where faction_id=m.target_fid)); end if;
      elsif m.op='steal_gc' then
        steal := round(coalesce(tgt.gc,0) * least(0.30, 0.06*m.agents));
        update public.faction_economy set gc=greatest(0,gc-steal) where faction_id=m.target_fid;
        update public.faction_economy set gc=gc+steal where faction_id=m.actor_fid;
        res := jsonb_build_object('gc',steal);
      elsif m.op='sabotage' then
        select id,btype into bid,bt from public.colony_buildings where faction_id=m.target_fid order by random() limit 1;
        if bid is not null then delete from public.colony_buildings where id=bid; res := jsonb_build_object('building',bt);
        else res := jsonb_build_object('building',null); end if;
      elsif m.op='steal_tech' then
        select research into techs from public.faction_economy where faction_id=m.target_fid;
        node := (select value::text from jsonb_array_elements_text(coalesce(techs,'[]'::jsonb)) value
                 where value::text not in (select jsonb_array_elements_text(coalesce(research,'[]'::jsonb)) from public.faction_economy where faction_id=m.actor_fid)
                 order by random() limit 1);
        if node is not null then
          update public.faction_economy set research = coalesce(research,'[]'::jsonb) || to_jsonb(node) where faction_id=m.actor_fid;
          res := jsonb_build_object('tech',node,'tech_name',node);
        else ok := false; res := jsonb_build_object('note','no tech to steal'); end if;
      elsif m.op='destabilize' then
        update public.faction_economy set debuff_pct=0.25, debuff_until=now()+interval '3 days' where faction_id=m.target_fid;
        res := jsonb_build_object('debuff_pct',0.25,'turns',3);
      end if;
    end if;

    -- агенты возвращаются; при раскрытии — один пойман (средне)
    update public.faction_economy set agents = agents + m.agents - (case when caught then 1 else 0 end)
      where faction_id=m.actor_fid;
    if caught then res := res || jsonb_build_object('caught',true,'actor_name',public._fac_name(m.actor_fid)); end if;

    update public.spy_missions
      set status='done', outcome=(case when ok then 'success' else 'fail' end), detected=caught, result=res
      where id=m.id;
  end loop;
end$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'economy_transfer(text,text,numeric)','trade_propose(text,int)','trade_respond(uuid,boolean)','trade_close(uuid)',
    'loan_issue(text,numeric,text)','loan_repay(uuid)','loan_dispute(uuid)','loan_verdict(uuid,text)','_fac_name(text)',
    'spy_launch(text,text,int)','counterintel_set(int)','spy_cancel(uuid)'
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
  -- доктрина: продажа ресурсов — часть ГС-экономики
  gain := floor(p_units * public._res_price(p_rarity) * 0.8 * (public._faction_mods(app.faction_id)->>'gc')::numeric);
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
-- ДОКТРИНА ГОСУДАРСТВА — модификаторы от выбора в анкете.
-- ⚠ ЧИСЛА ДОЛЖНЫ СОВПАДАТЬ с EC_MODS в economy.js.
-- Поля: gc/sci/agents/mine (>1 лучше), colonize/claim_cost (<1 дешевле),
-- claim_cd (<1 чаще). Полы: доход/добыча/стоимости ≥ 0.3; claim_cd ≥ 0.25.
-- ════════════════════════════════════════════════════════════
create or replace function public._faction_mods(p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a public.faction_applications;
  gc numeric:=0; mine numeric:=0; bld numeric:=0; col numeric:=0; cc numeric:=0; cd numeric:=0; rsch numeric:=0;
  scf int:=0; agf int:=0;   -- плоские: наука ОН/сут, агенты /сут
begin
  select * into a from public.faction_applications where faction_id=p_fid and status='approved' order by updated_at desc limit 1;
  if not found then
    return jsonb_build_object('gc',1,'mine',1,'build',1,'research',1,'colonize',1,'claim_cost',1,'claim_cd',1,'sci_flat',0,'agents_flat',0);
  end if;

  case a.gov
    when 'Республика'          then gc:=gc+0.10; cd:=cd+0.15; scf:=scf+1;
    when 'Монархия'            then gc:=gc+0.20; scf:=scf-1;
    when 'Империя'             then cc:=cc-0.25; cd:=cd-0.25; gc:=gc-0.10; agf:=agf+1;
    when 'Олигархия'           then gc:=gc+0.25; scf:=scf-1;
    when 'Диктатура'           then cd:=cd-0.20; gc:=gc-0.10; agf:=agf+1;
    when 'Теократия'           then gc:=gc+0.10; rsch:=rsch+0.15; scf:=scf-2; agf:=agf+1;
    when 'Технократия'         then gc:=gc-0.15; bld:=bld+0.10; rsch:=rsch-0.25; scf:=scf+3;
    when 'Корпоратократия'     then gc:=gc+0.20; mine:=mine+0.15; bld:=bld-0.10; agf:=agf-1;
    when 'Коллективный разум'  then mine:=mine+0.15; cc:=cc+0.20; rsch:=rsch-0.10; scf:=scf+1;
    when 'Машинный разум (ИИ)' then gc:=gc-0.15; bld:=bld-0.10; rsch:=rsch-0.15; scf:=scf+1; agf:=agf+1;
    else null;
  end case;

  case a.regime
    when 'Демократический'   then gc:=gc+0.15; agf:=agf-1;
    when 'Эгалитарный'       then gc:=gc+0.10; cc:=cc+0.10; scf:=scf+1;
    when 'Меритократический'  then gc:=gc-0.10; rsch:=rsch-0.15; scf:=scf+2;
    when 'Плутократический'   then gc:=gc+0.25; scf:=scf-1;
    when 'Олигархический'     then gc:=gc+0.15; mine:=mine-0.10;
    when 'Авторитарный'       then mine:=mine+0.10; gc:=gc-0.10; agf:=agf+1;
    when 'Тоталитарный'       then mine:=mine+0.25; gc:=gc-0.15; agf:=agf+1;
    when 'Деспотичный'        then cd:=cd-0.20; scf:=scf-1; agf:=agf+1;
    when 'Деспотизм'          then gc:=gc+0.15; mine:=mine+0.10; rsch:=rsch+0.15; scf:=scf-1; agf:=agf+1;
    when 'Анархический'       then col:=col-0.25; gc:=gc-0.20; bld:=bld+0.15; scf:=scf+1;
    else null;
  end case;

  case a.ideology
    when 'Технократия (Культ науки)' then gc:=gc-0.15; rsch:=rsch-0.25; scf:=scf+3;
    when 'Милитаризм (Культ силы)'   then cc:=cc-0.15; gc:=gc-0.10; rsch:=rsch+0.10; agf:=agf+1;
    when 'Пацифизм'                  then gc:=gc+0.25; agf:=agf-1;
    when 'Экспансионизм'             then col:=col-0.30; cc:=cc-0.30; cd:=cd-0.40; gc:=gc-0.10;
    when 'Изоляционизм'              then gc:=gc+0.15; cc:=cc+0.25; cd:=cd+0.25; scf:=scf+1;
    when 'Ксенофилия'                then gc:=gc+0.20; agf:=agf-1;
    when 'Ксенофобия'                then mine:=mine+0.10; gc:=gc-0.20; agf:=agf+1;
    when 'Спиритуализм'              then rsch:=rsch+0.15; scf:=scf-1; agf:=agf+1;
    when 'Трансгуманизм'             then gc:=gc-0.10; rsch:=rsch-0.15; scf:=scf+2;
    when 'Экоцентризм'               then mine:=mine+0.30; gc:=gc-0.20;
    when 'Индустриализм'             then gc:=gc+0.25; mine:=mine+0.10; bld:=bld-0.15; rsch:=rsch+0.10; scf:=scf-1;
    else null;
  end case;

  case a.race
    when 'Гуманоиды'                  then gc:=gc+0.05; scf:=scf+1;
    when 'Млекопитающие'              then gc:=gc+0.20;
    when 'Рептилоиды'                 then gc:=gc-0.10; agf:=agf+1;
    when 'Авианы (Птицеподобные)'     then cd:=cd-0.25; gc:=gc-0.05; agf:=agf+1;
    when 'Инсектоиды'                 then mine:=mine+0.20; gc:=gc+0.10; rsch:=rsch+0.10; scf:=scf-1;
    when 'Акватики (Водные)'          then gc:=gc+0.15; col:=col+0.15;
    when 'Плантоиды (Растениевидные)' then mine:=mine+0.15; gc:=gc+0.10; agf:=agf-1;
    when 'Литоиды (Каменные)'         then mine:=mine+0.25; gc:=gc-0.15;
    when 'Синтетики / Киборги'        then gc:=gc-0.15; rsch:=rsch-0.15; scf:=scf+2;
    when 'Энергетические сущности'    then gc:=gc-0.15; rsch:=rsch-0.10; scf:=scf+1; agf:=agf+1;
    else null;
  end case;

  case a.civ_type
    when 'frontier' then col:=col-0.25; cd:=cd-0.25; gc:=gc-0.15;
    when 'colony'   then gc:=gc+0.20; mine:=mine+0.10; cc:=cc+0.15; bld:=bld-0.10;
    else null;
  end case;

  return jsonb_build_object(
    'gc',          greatest(0.3,  1+gc),
    'mine',        greatest(0.3,  1+mine),
    'build',       greatest(0.3,  1+bld),
    'research',    greatest(0.3,  1+rsch),
    'colonize',    greatest(0.3,  1+col),
    'claim_cost',  greatest(0.3,  1+cc),
    'claim_cd',    greatest(0.25, 1+cd),
    'sci_flat',    scf,
    'agents_flat', agf);
end$$;
revoke all on function public._faction_mods(text) from public;

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
  mods jsonb; m_mine numeric; m_gc numeric;
  market_cap numeric; market_gc numeric := 0; sell numeric;
begin
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then return jsonb_build_object('faction_id',p_fid,'days',0); end if;

  mods := public._faction_mods(p_fid);          -- доктрина государства
  m_mine := (mods->>'mine')::numeric;
  m_gc   := (mods->>'gc')::numeric;
  -- дебафф дестабилизации (вражеская операция) — режет ГС-доход, пока активен
  if eco.debuff_until is not null and eco.debuff_until > now() then
    m_gc := m_gc * (1 - coalesce(eco.debuff_pct,0));
  end if;

  update public.unit_production set status='done' where faction_id=p_fid and status='queued' and ready_at<=now();

  -- завершённые проекты колоний (слоты/терраформ/обустройство среды)
  perform public._apply_colony_projects(p_fid);
  -- готовые тайные операции (разрешение успеха/раскрытия, эффекты, возврат агентов)
  perform public._spy_resolve(p_fid);

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

  -- Доктрина применяется к НАКОПЛЕНИЮ за весь период (base*mult*d), а не поштучно
  -- за день — иначе бонусы к малым показателям (наука/агенты) съедало округление.

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
        rate := greatest(1, round(rate * m_mine));   -- доктрина: множитель добычи
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
    trade_gc := round(trade_gc * m_gc);   -- доктрина: торговля — часть ГС-экономики

    -- ── товарная биржа: пассивная продажа накопленных ресурсов за ГС (≈50% цены),
    --    без торговых путей. 1 слот = до 25 ед./сут., дорогие ресурсы продаются первыми.
    market_cap := (select coalesce(sum(slots_open),0) from public.colony_buildings
                   where faction_id = p_fid and btype = 'market') * 25 * d;
    if market_cap > 0 then
      for r in
        select res_name, res_rar, avail from (
          select distinct on (nm) nm as res_name, rr as res_rar,
            greatest(0, coalesce((eco.resources->>nm)::numeric,0)
                        + coalesce((res_add->>nm)::numeric,0)
                        - coalesce((res_sub->>nm)::numeric,0)) as avail
          from (
            select (e.value->>'name') as nm, coalesce(e.value->>'r','common') as rr
            from public.colonies c, jsonb_array_elements(c.resources) e
            where c.faction_id = p_fid
          ) q
          order by nm, public._res_price(rr) desc
        ) u
        where avail > 0
        order by public._res_price(res_rar) desc
      loop
        exit when market_cap <= 0;
        sell := least(r.avail, market_cap);
        res_sub := jsonb_set(res_sub, array[r.res_name],
                     to_jsonb(coalesce((res_sub->>r.res_name)::numeric,0) + sell), true);
        market_gc := market_gc + sell * public._res_price(r.res_rar) * 0.5;
        market_cap := market_cap - sell;
      end loop;
      market_gc := round(market_gc * m_gc);   -- доктрина: рыночный сбыт — часть ГС-экономики
    end if;

    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_add) loop
      merged := jsonb_set(merged, array[k], to_jsonb(coalesce((merged->>k)::numeric,0) + (res_add->>k)::numeric), true);
    end loop;
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric)), true);
    end loop;

    -- наука/агенты — ПЛОСКИЙ бонус доктрины (+N в сутки), не процент (дискретны);
    -- за день не уходит в минус (greatest 0).
    update public.faction_economy
      set gc = gc + round(inc_gc * m_gc * d) + trade_gc + market_gc,
          science = science + greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
          agents  = agents  + greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
          resources = merged,
          last_tick = last_tick + (d || ' days')::interval
      where faction_id=p_fid returning * into eco;
  end if;

  return jsonb_build_object('faction_id',eco.faction_id,'gc',eco.gc,'science',eco.science,'agents',eco.agents,
    'resources',eco.resources,'last_tick',eco.last_tick,'days',d, 'mods', mods,
    'income', jsonb_build_object(
      'gc',     round(inc_gc * m_gc),
      'science',greatest(0, inc_sci    + (mods->>'sci_flat')::numeric),
      'agents', greatest(0, inc_agents + (mods->>'agents_flat')::numeric),
      'trade',  trade_gc, 'market', market_gc, 'pirate', pirate));
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
