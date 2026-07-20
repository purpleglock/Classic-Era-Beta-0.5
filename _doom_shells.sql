-- ============================================================
--  СНАРЯДЫ СУДНОГО ДНЯ · ТИРЫ БАЛЛИСТИКИ · ГИПЕРПЕЙСЕР-ТЕХНОЛОГИЯ
--  + МЕГАСООРУЖЕНИЕ «ОЖЕРЕЛЬЕ НЕМЕЗИДЫ» (тоже технология)
--
--  Что меняется (ревизия 2 — тиры баллистики и цепочка технологий):
--   1) СНАРЯДЫ СТРОЯТСЯ, а не «просто тратятся».
--      • «☢ Арсенал Судного Дня» (btype 'shellforge', без слотов) —
--        собирает ТОЛЬКО снаряды Длани ('doom'): 1 шт / 1 день.
--      • «🏭 Баллистический военпромзавод» (btype 'ballfab', без слотов,
--        технология pol.ballistics) — собирает БАЛЛИСТИКУ: 1 шт / 1 день.
--      Запас — в doom_shells (фракция × тип).
--   2) ТИРЫ БАЛЛИСТИКИ (только Гиперпейсер умеет их нести):
--      • ball_light  «Лёгкая»    — летит ВДВОЕ быстрее, урон скромный
--                                  (2–6% населения, 0–1 постройка).
--      • ball_emp    «Фантом»    — прикол: НЕ перехватывается планетарной
--                                  ПРО (только Ожерелье Немезиды может сбить);
--                                  урон малый (2–5% населения, 1 постройка).
--      • ball_cluster «Кассетная» — прикол: широкое накрытие
--                                  (8–16% населения, 2–4 постройки).
--      • ball_heavy  «Тяжёлая»   — строится за 1 Гравиядро, ГАРАНТИРОВАННО
--                                  5 построек (12–22% населения), летит
--                                  ДАЛЬШЕ радиуса (×2 прыжков), но медленно.
--   3) Гиперпейсер = ОТДЕЛЬНАЯ технология pol.hyperpacer.
--      ЦЕПОЧКА: pol.inevitability → pol.nemesis (Ожерелье) → pol.hyperpacer.
--      Баллистика — своя ветка: pol.ballistics (без пререквизитов судного дня).
--   4) ДАЛЬНОСТЬ Гиперпейсера: ≈4 системы = 4 ПРЫЖКА по гиперпутям (BFS),
--      не евклидов круг. Тяжёлая баллистика бьёт на 8 прыжков.
--   5) «Ожерелье Немезиды» (btype 'nemesis', технология pol.nemesis) —
--      системная ПРО: вся система, 6 зарядов, реген +1/сутки.
--      Цена: ГС + 50 Стелларит (фиолет.) + 10 Рагенод + 5 Гравиядро (оранж.).
--
--  Зависимости (применить РАНЕЕ): _interstellar_artillery.sql, _mza.sql.
--  _defense_planetary.sql (ПРО) — желательно, хук через to_regprocedure.
--  Выполнить ЦЕЛИКОМ в Supabase → SQL Editor. Идемпотентно.
--  ⚠ Пересоздаёт _doom_resolve (суперсет версии из _interstellar_artillery.sql).
-- ============================================================

-- ── 0) ТЕХНОЛОГИИ: цепочка судного дня + баллистика ─────────
insert into public.tech_nodes (node_id, base_cost, prereq) values
  ('pol.ballistics', 800,  '[]'::jsonb),                       -- баллистический военпром
  ('pol.nemesis',    2000, '["pol.inevitability"]'::jsonb),    -- Ожерелье (ДО Гиперпейсера)
  ('pol.hyperpacer', 3500, '["pol.nemesis"]'::jsonb)           -- Гиперпейсер (после Ожерелья)
on conflict (node_id) do update set base_cost = excluded.base_cost, prereq = excluded.prereq;

-- ── 1) КОНСТАНТЫ (баланс) — своя функция, ничего не клоббер ──
create or replace function public._shell_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    -- фабрики снарядов
    when 'forge_gc'        then 300000  -- ГС за Арсенал Судного Дня
    when 'forge_matter'    then 20      -- Программируемой материи за Арсенал
    when 'ballfab_gc'      then 150000  -- ГС за Баллистический военпромзавод
    when 'shell_h'         then 24      -- 1 снаряд = 1 день работы фабрики
    -- снаряд Длани
    when 'doom_gc'         then 150000
    when 'doom_grav'       then 20
    when 'doom_matter'     then 8
    -- дальность Гиперпейсера: прыжков по гиперпутям
    when 'mza_range_hops'  then 4
    when 'heavy_range_mul' then 2       -- тяжёлая бьёт ×2 радиуса (8 прыжков)
    -- Ожерелье Немезиды
    when 'nemo_gc'         then 500000
    when 'nemo_charges'    then 6
    when 'nemo_regen_d'    then 1
    when 'nemo_build_d'    then 3
    else 0 end
$$;

-- Паспорт тира баллистики: цена + урон + модификаторы полёта/перехвата.
--   fly_mul     — множитель времени полёта залпа
--   pmin/pmax   — доля населения, гибнущая при попадании
--   bmin/bmax   — построек в руины (равновероятный дайс bmin..bmax)
--   no_abm      — планетарная ПРО НЕ видит снаряд (только Немезида)
--   long_range  — дальность ×heavy_range_mul
create or replace function public._ball_params(p_kind text)
returns jsonb language sql immutable as $$
  select case p_kind
    when 'ball_light'   then jsonb_build_object('gc',20000,'grav',0,'fly_mul',0.5,
      'pmin',0.02,'pmax',0.06,'bmin',0,'bmax',1,'no_abm',false,'long_range',false)
    when 'ball_emp'     then jsonb_build_object('gc',60000,'grav',2,'fly_mul',1.0,
      'pmin',0.02,'pmax',0.05,'bmin',1,'bmax',1,'no_abm',true,'long_range',false)
    when 'ball_cluster' then jsonb_build_object('gc',90000,'grav',4,'fly_mul',1.0,
      'pmin',0.08,'pmax',0.16,'bmin',2,'bmax',4,'no_abm',false,'long_range',false)
    when 'ball_heavy'   then jsonb_build_object('gc',250000,'grav',1,'fly_mul',1.4,
      'pmin',0.12,'pmax',0.22,'bmin',5,'bmax',5,'no_abm',false,'long_range',true)
    else null end
$$;

-- Все допустимые типы снарядов.
create or replace function public._shell_kind_ok(p_kind text)
returns boolean language sql immutable as $$
  select p_kind in ('doom','ball_light','ball_emp','ball_cluster','ball_heavy')
$$;

-- ── 2) СКЛАД СНАРЯДОВ ───────────────────────────────────────
create table if not exists public.doom_shells (
  faction_id text not null,
  kind       text not null,
  qty        int  not null default 0,
  primary key (faction_id, kind)
);
-- миграция ревизии 1 → 2: расширяем список типов (старый check мешал бы)
alter table public.doom_shells drop constraint if exists doom_shells_kind_check;
alter table public.doom_shells add constraint doom_shells_kind_check
  check (kind in ('doom','ball_light','ball_emp','ball_cluster','ball_heavy'));
alter table public.doom_shells enable row level security;
drop policy if exists "shells_sel" on public.doom_shells;
create policy "shells_sel" on public.doom_shells for select to public using (true);

-- заказ снаряда: висит на строке фабрики в colony_buildings
alter table public.colony_buildings add column if not exists shell_kind  text;
alter table public.colony_buildings add column if not exists shell_ready timestamptz;
-- Немезида: заряды в ammo, точка отсчёта регена — nemesis_last
alter table public.colony_buildings add column if not exists ammo int default 0;   -- уже есть после _defense_planetary; страховка
alter table public.colony_buildings add column if not exists nemesis_last timestamptz;
-- тип снаряда на залпе
alter table public.doom_salvos add column if not exists kind text not null default 'doom';

-- ── 3) helpers: цена снаряда, выдача/списание со склада ─────
create or replace function public._shell_cost(p_kind text)
returns jsonb language sql immutable as $$
  select case
    when p_kind = 'doom' then jsonb_build_object(
      'gc', public._shell_const('doom_gc'),
      'Гравиядро', public._shell_const('doom_grav'),
      'Программируемая материя', public._shell_const('doom_matter'))
    else (select case when coalesce((b->>'grav')::numeric,0) > 0
            then jsonb_build_object('gc', (b->>'gc')::numeric, 'Гравиядро', (b->>'grav')::numeric)
            else jsonb_build_object('gc', (b->>'gc')::numeric) end
          from public._ball_params(p_kind) b)
  end
$$;

create or replace function public._shell_add(p_fid text, p_kind text, p_qty int)
returns void language sql security definer set search_path=public as $$
  insert into public.doom_shells(faction_id, kind, qty) values (p_fid, p_kind, p_qty)
  on conflict (faction_id, kind) do update set qty = public.doom_shells.qty + excluded.qty;
$$;
revoke all on function public._shell_add(text,text,int) from public;

-- списать 1 снаряд; исключение, если нет
create or replace function public._shell_take(p_fid text, p_kind text)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public._shell_settle(p_fid);
  update public.doom_shells set qty = qty - 1
    where faction_id = p_fid and kind = p_kind and qty > 0;
  if not found then
    raise exception 'no % shell in stock: постройте снаряд (Арсенал / Баллистический военпромзавод)', p_kind;
  end if;
end$$;
revoke all on function public._shell_take(text,text) from public;

-- ── 4) Ленивая достройка снарядов (готовые заказы → склад) ──
create or replace function public._shell_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare r record;
begin
  for r in select id, shell_kind from public.colony_buildings
           where faction_id = p_fid and btype in ('shellforge','ballfab')
             and shell_kind is not null and shell_ready is not null and shell_ready <= now()
  loop
    perform public._shell_add(p_fid, r.shell_kind, 1);
    update public.colony_buildings set shell_kind = null, shell_ready = null where id = r.id;
  end loop;
end$$;
revoke all on function public._shell_settle(text) from public;

-- ── 5) RPC: ПОСТРОЙКА ФАБРИК СНАРЯДОВ (без слотов, проект 1 день) ──
-- Общий каркас для Арсенала (снаряды Длани) и Баллистического военпромзавода.
create or replace function public._shell_factory_build(p_colony_id uuid, p_btype text,
    p_tech text, p_gc numeric, p_matter numeric, p_label text, p_news_title text, p_news_body text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies; eco public.faction_economy;
  used int; pending int; have_matter numeric; res jsonb; fname text;
begin
  fid := public._ec_my_fid();
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  if not (coalesce(eco.research,'[]'::jsonb) ? p_tech) then
    raise exception 'research required: %', p_tech;
  end if;
  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if col.faction_id is distinct from fid then raise exception 'not your colony'; end if;
  select count(*) into used    from public.colony_buildings where colony_id = p_colony_id;
  select count(*) into pending from public.colony_projects  where colony_id = p_colony_id and kind='build';
  if used + pending >= coalesce(col.cells,6) then raise exception 'no free cells'; end if;

  res := coalesce(eco.resources,'{}'::jsonb);
  if p_matter > 0 then
    have_matter := coalesce((res->>'Программируемая материя')::numeric, 0);
    if have_matter < p_matter then
      raise exception 'not enough programmable matter: need %, have %', p_matter, floor(have_matter);
    end if;
    res := jsonb_set(res, array['Программируемая материя'], to_jsonb(have_matter - p_matter), true);
  end if;
  update public.faction_economy set gc = gc - p_gc, resources = res
    where faction_id = fid and gc >= p_gc;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects (faction_id, owner_id, kind, btype, colony_id, payload, label, ready_at)
  values (fid, auth.uid(), 'build', p_btype, p_colony_id,
          jsonb_build_object('spent_gc', p_gc, 'btype', p_btype, 'free_slots', 1),
          p_label, now() + interval '1 day');

  select name into fname from public.faction_applications where faction_id=fid and status='approved' order by updated_at desc limit 1;
  perform public._doom_news(p_news_title,
    coalesce(fname,'Неизвестная держава') || p_news_body || ' («' || coalesce(col.planet_name,'???') || '»).');
  return jsonb_build_object('ok', true, 'gc', p_gc);
end$$;
revoke all on function public._shell_factory_build(uuid,text,text,numeric,numeric,text,text,text) from public;

-- Арсенал Судного Дня: только снаряды Длани; ворота pol.inevitability.
create or replace function public.shellforge_build(p_colony_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public._shell_factory_build(p_colony_id, 'shellforge', 'pol.inevitability',
    public._shell_const('forge_gc'), public._shell_const('forge_matter'),
    'Возведение Центра метрических технологий',
    '☢ Центр метрических технологий',
    ' с этой постройкой вы сможете закупать для Длани и гиперейсеров по 1 снаряду за сутки');
end$$;
revoke all on function public.shellforge_build(uuid) from public;
grant execute on function public.shellforge_build(uuid) to authenticated;

-- Баллистический военпромзавод: тиры баллистики; ворота pol.ballistics.
create or replace function public.ballfab_build(p_colony_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public._shell_factory_build(p_colony_id, 'ballfab', 'pol.ballistics',
    public._shell_const('ballfab_gc'), 0,
    'Возведение Баллистического военпромзавода',
    '🏭 БАЛЛИСТИЧЕСКИЙ ВОЕНПРОМЗАВОД',
    ' разворачивает Баллистический военпромзавод - конвейер межзвёздных боеголовок');
end$$;
revoke all on function public.ballfab_build(uuid) from public;
grant execute on function public.ballfab_build(uuid) to authenticated;

-- ── 6) RPC: ЗАКАЗ СНАРЯДА (1 фабрика = 1 снаряд в сутки) ────
-- 'doom' собирает ТОЛЬКО Арсенал; тиры баллистики — ТОЛЬКО военпромзавод.
create or replace function public.shell_order(p_building_id uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; bld public.colony_buildings; eco public.faction_economy; res jsonb;
  cost jsonb; k text; need numeric; have numeric; gc_cost numeric; rdy timestamptz; want_btype text;
begin
  fid := public._ec_my_fid();
  perform public._shell_settle(fid);
  if not public._shell_kind_ok(p_kind) then raise exception 'bad shell kind'; end if;
  want_btype := case when p_kind = 'doom' then 'shellforge' else 'ballfab' end;
  select * into bld from public.colony_buildings
    where id = p_building_id and faction_id = fid and btype = want_btype for update;
  if not found then
    raise exception 'wrong factory: % собирается только в %', p_kind,
      case when want_btype='shellforge' then 'Арсенале Судного Дня' else 'Баллистическом военпромзаводе' end;
  end if;
  if bld.shell_kind is not null then raise exception 'factory is busy: фабрика уже собирает снаряд'; end if;

  cost := public._shell_cost(p_kind);
  gc_cost := coalesce((cost->>'gc')::numeric, 0);
  select * into eco from public.faction_economy where faction_id = fid for update;
  res := coalesce(eco.resources,'{}'::jsonb);
  for k in select jsonb_object_keys(cost) loop
    continue when k = 'gc';
    need := (cost->>k)::numeric;
    have := coalesce((res->>k)::numeric, 0);
    if have < need then raise exception 'not enough %: need %, have %', k, need, floor(have); end if;
    res := jsonb_set(res, array[k], to_jsonb(have - need), true);
  end loop;
  update public.faction_economy set gc = gc - gc_cost, resources = res
    where faction_id = fid and gc >= gc_cost;
  if not found then raise exception 'not enough GC: снаряд стоит %', gc_cost; end if;

  rdy := now() + (public._shell_const('shell_h') || ' hours')::interval;
  update public.colony_buildings set shell_kind = p_kind, shell_ready = rdy where id = bld.id;
  return jsonb_build_object('ok', true, 'kind', p_kind, 'ready_at', rdy, 'gc', gc_cost);
end$$;
revoke all on function public.shell_order(uuid,text) from public;
grant execute on function public.shell_order(uuid,text) to authenticated;

-- ── 7) RPC: СТАТУС СНАРЯДОВ/ФАБРИК/НЕМЕЗИД (для кабинета) ──
create or replace function public.shell_status()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare fid text; stock jsonb; forges jsonb; nemo jsonb;
begin
  fid := public._ec_my_fid();
  perform public._shell_settle(fid);
  perform public._nemesis_settle(fid);
  select coalesce(jsonb_object_agg(kind, qty), '{}'::jsonb) into stock
    from public.doom_shells where faction_id = fid;
  select coalesce(jsonb_agg(jsonb_build_object(
           'building_id', cb.id, 'colony_id', cb.colony_id, 'btype', cb.btype,
           'shell_kind', cb.shell_kind, 'shell_ready', cb.shell_ready)), '[]'::jsonb)
    into forges from public.colony_buildings cb
    where cb.faction_id = fid and cb.btype in ('shellforge','ballfab');
  select coalesce(jsonb_agg(jsonb_build_object(
           'building_id', cb.id, 'colony_id', cb.colony_id, 'system_id', c.system_id,
           'charges', coalesce(cb.ammo,0), 'max', public._shell_const('nemo_charges'))), '[]'::jsonb)
    into nemo from public.colony_buildings cb join public.colonies c on c.id = cb.colony_id
    where cb.faction_id = fid and cb.btype = 'nemesis';
  return jsonb_build_object('stock', stock, 'forges', forges, 'nemesis', nemo);
end$$;
revoke all on function public.shell_status() from public;
grant execute on function public.shell_status() to authenticated;

-- ── 8) ДАЛЬНОБОЙНОСТЬ: прыжки по гиперпутям (BFS), а не круг ──
-- Мин. число прыжков from→to по map_hyperlanes в пределах p_max; null = недостижимо.
create or replace function public._mza_hops(p_from text, p_to text, p_max int)
returns int language sql stable security definer set search_path=public as $$
  with recursive r(id, d) as (
    select p_from, 0
    union
    select case when l.a_id = r.id then l.b_id else l.a_id end, r.d + 1
      from r join public.map_hyperlanes l on (l.a_id = r.id or l.b_id = r.id)
      where r.d < p_max
  )
  select min(d)::int from r where id = p_to
$$;
revoke all on function public._mza_hops(text,text,int) from public;
grant execute on function public._mza_hops(text,text,int) to authenticated;

-- ── 9) doom_fire: снаряд Длани вместо Гравиядра ─────────────
create or replace function public.doom_fire(p_gun_id uuid, p_target_system_id text, p_target_pid int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; g public.doom_guns; tgt public.map_systems; pl jsonb; rdy timestamptz; fname text; ptname text;
  org public.map_systems; dist numeric; map_diag numeric; frac numeric; fly_h numeric;
begin
  fid := public._ec_my_fid();
  perform public._doom_settle(fid);
  select * into g from public.doom_guns where id = p_gun_id;
  if not found then raise exception 'gun not found'; end if;
  if g.faction_id is distinct from fid then raise exception 'not your gun'; end if;
  if g.integrity <= 0 then raise exception 'gun is wrecked'; end if;
  if exists(select 1 from public.doom_salvos where gun_id = g.id and status='in_flight') then
    raise exception 'salvo already in flight';
  end if;

  select * into tgt from public.map_systems where id = p_target_system_id;
  if not found then raise exception 'target system not found'; end if;
  select value into pl from jsonb_array_elements(coalesce(tgt.planets,'[]'::jsonb))
    where (value->>'pid')::int = p_target_pid limit 1;
  if pl is null then raise exception 'target planet not found'; end if;
  if coalesce((pl->>'dead')::boolean, false) then raise exception 'planet already dead'; end if;
  ptname := coalesce(pl->>'name','планета');

  -- боекомплект: 1 построенный СНАРЯД ДЛАНИ со склада снарядов
  perform public._shell_take(fid, 'doom');

  update public.doom_guns set integrity = greatest(0, integrity - public._doom_const('shot_wear')),
                              total_shots = total_shots + 1
    where id = g.id;

  select * into org from public.map_systems where id = g.system_id;
  dist := sqrt(power(coalesce(tgt.x,0)-coalesce(org.x,0),2)
             + power(coalesce(tgt.y,0)-coalesce(org.y,0),2));
  select sqrt(power(max(x)-min(x),2) + power(max(y)-min(y),2)) into map_diag from public.map_systems;
  frac := least(1.0, greatest(0.0, dist / nullif(map_diag,0)));
  fly_h := public._doom_const('flight_h_min')
         + frac * (public._doom_const('flight_h_max') - public._doom_const('flight_h_min'));
  rdy := now() + (round(fly_h*60)::int || ' minutes')::interval;
  insert into public.doom_salvos
    (gun_id, faction_id, owner_id, origin_system_id, target_system_id, target_pid, target_planet, ready_at, kind)
  values
    (g.id, fid, auth.uid(), g.system_id, p_target_system_id, p_target_pid, ptname, rdy, 'doom');

  select name into fname from public.faction_applications where faction_id=fid and status='approved' order by updated_at desc limit 1;
  perform public._doom_news(
    '🜨 ЗАЛП ВЫПУЩЕН — ОТСЧЁТ ПОШЁЛ',
    'Длань Неотвратимости ('||coalesce(fname,'???')||') дала залп по системе «'||coalesce(tgt.name,'???')||
    '». Снаряд уже в пути к планете «'||ptname||'» — расчётное время полёта ~'||
    to_char(fly_h,'FM990.0')||' ч. Эвакуация бессмысленна — он придёт. И никто его не остановит.');

  return jsonb_build_object('ok', true, 'ready_at', rdy, 'target', ptname,
                            'flight_h', round(fly_h,1), 'dist', round(dist));
end$$;
revoke all on function public.doom_fire(uuid,text,int) from public;
grant execute on function public.doom_fire(uuid,text,int) to authenticated;

-- ── 10) mza_build/mza_fire: технология + тиры снарядов + дальность прыжками ──
create or replace function public.mza_build(p_system_id text, p_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; res jsonb;
  gc_cost numeric; matter_need numeric; have_matter numeric; build_h numeric; ready timestamptz; v_id uuid;
  sysname text; fname text;
begin
  fid := public._ec_my_fid();
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  -- ВОРОТА: ОТДЕЛЬНАЯ технология Гиперпейсера
  if not (coalesce(eco.research,'[]'::jsonb) ? 'pol.hyperpacer') then
    raise exception 'research required: pol.hyperpacer';
  end if;
  if not exists(select 1 from public.colonies where faction_id=fid and system_id=p_system_id) then
    raise exception 'build MZA only at a system with your colony';
  end if;

  gc_cost     := public._mza_const('build_gc');
  matter_need := public._mza_const('build_matter');
  res := coalesce(eco.resources,'{}'::jsonb);
  have_matter := coalesce((res->>'Программируемая материя')::numeric, 0);
  if have_matter < matter_need then
    raise exception 'not enough programmable matter: need %, have %', matter_need, floor(have_matter);
  end if;
  if coalesce(eco.gc,0) < gc_cost then raise exception 'not enough GC'; end if;

  res := jsonb_set(res, array['Программируемая материя'], to_jsonb(have_matter - matter_need), true);
  update public.faction_economy set gc = gc - gc_cost, resources = res
    where faction_id = fid and gc >= gc_cost;
  if not found then raise exception 'not enough GC'; end if;

  build_h := public._mza_const('build_h');
  ready := now() + (build_h || ' hours')::interval;
  insert into public.mza_ships(faction_id, owner_id, name, status, system_id, depart_at, arrive_at)
    values(fid, auth.uid(), nullif(trim(coalesce(p_name,'')),''), 'building', p_system_id, now(), ready)
    returning id into v_id;

  select name into sysname from public.map_systems where id=p_system_id;
  select name into fname from public.faction_applications where faction_id=fid and status='approved' order by updated_at desc limit 1;
  perform public._doom_news(
    '☣ ЗАЛОЖЕН ГИПЕРПЕЙСЕР',
    coalesce(fname,'Неизвестная держава')||' закладывает Гиперпейсер — мобильное орудие судного дня — в системе «'||
    coalesce(sysname,'???')||'». Теперь приговор мирам обретёт ноги: он сможет прийти к любой звезде.');

  return jsonb_build_object('ok', true, 'id', v_id, 'gc', gc_cost, 'matter', matter_need, 'ready_at', ready);
end$$;
revoke all on function public.mza_build(text,text) from public;
grant execute on function public.mza_build(text,text) to authenticated;

-- залп: p_kind = 'doom' | тир баллистики; дальность = 4 прыжка (тяжёлая — 8)
drop function if exists public.mza_fire(uuid, text, int, text);
drop function if exists public.mza_fire(uuid, text, int, text, text);
create or replace function public.mza_fire(p_id uuid, p_target_system_id text,
                                           p_target_pid int, p_target_name text default null,
                                           p_kind text default 'doom')
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; sh public.mza_ships; tgt public.map_systems; pl jsonb; rdy timestamptz;
  fly_h numeric; ptname text; fname text; newint numeric; hops int; max_hops int; bp jsonb;
begin
  fid := public._ec_my_fid();
  perform public._mza_settle(fid);
  if not public._shell_kind_ok(p_kind) then raise exception 'bad shell kind'; end if;
  bp := public._ball_params(p_kind);   -- null для 'doom'
  select * into sh from public.mza_ships where id=p_id;
  if not found then raise exception 'MZA not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your MZA'; end if;
  if sh.status <> 'idle' or sh.system_id is null then raise exception 'MZA must be idle in a system to fire'; end if;
  if sh.integrity <= 0 then raise exception 'MZA is wrecked'; end if;
  if exists(select 1 from public.doom_salvos where mza_id = sh.id and status='in_flight') then
    raise exception 'salvo already in flight';
  end if;

  select * into tgt from public.map_systems where id = p_target_system_id;
  if not found then raise exception 'target system not found'; end if;

  -- ДАЛЬНОБОЙНОСТЬ: прыжки по гиперпутям. Тяжёлая баллистика — ×2 радиуса.
  max_hops := public._shell_const('mza_range_hops')::int
            * case when coalesce((bp->>'long_range')::boolean, false)
                   then public._shell_const('heavy_range_mul')::int else 1 end;
  if p_target_system_id <> sh.system_id then
    hops := public._mza_hops(sh.system_id, p_target_system_id, max_hops);
    if hops is null then
      raise exception 'target out of range: дальность залпа — % прыжков по гиперпутям', max_hops;
    end if;
  end if;

  if p_target_pid is not null then
    select value into pl from jsonb_array_elements(coalesce(tgt.planets,'[]'::jsonb))
      where (value->>'pid')::int = p_target_pid limit 1;
  end if;
  if pl is null then
    select coalesce(planet_name,'планета') into ptname from public.colonies
      where system_id = p_target_system_id
        and ((p_target_pid is not null and planet_pid = p_target_pid)
             or (p_target_name is not null and planet_name = p_target_name))
      order by (planet_pid is not null) desc limit 1;
    if ptname is null then raise exception 'target planet not found'; end if;
  else
    if coalesce((pl->>'dead')::boolean, false) then raise exception 'planet already dead'; end if;
    ptname := coalesce(pl->>'name','планета');
  end if;

  -- боекомплект: построенный снаряд выбранного типа
  perform public._shell_take(fid, p_kind);

  newint := greatest(0, sh.integrity - public._mza_const('shot_wear'));
  update public.mza_ships set integrity = newint, total_shots = total_shots + 1 where id = sh.id;

  fly_h := coalesce(public._mza_dist_hours(sh.system_id, p_target_system_id,
                      public._mza_const('salvo_h_min'), public._mza_const('salvo_h_max')),
                    public._mza_const('salvo_h_min'))
         * coalesce((bp->>'fly_mul')::numeric, 1.0);   -- лёгкая ×0.5, тяжёлая ×1.4
  rdy := now() + (round(fly_h*60)::int || ' minutes')::interval;
  insert into public.doom_salvos
    (gun_id, mza_id, faction_id, owner_id, origin_system_id, target_system_id, target_pid, target_planet, ready_at, kind)
  values
    (null, sh.id, fid, auth.uid(), sh.system_id, p_target_system_id, p_target_pid, ptname, rdy, p_kind);

  select name into fname from public.faction_applications where faction_id=fid and status='approved' order by updated_at desc limit 1;
  if p_kind = 'doom' then
    perform public._doom_news(
      '🜨 ЗАЛП ГИПЕРПЕЙСЕРА ВЫПУЩЕН — ОТСЧЁТ ПОШЁЛ',
      'Гиперпейсер ('||coalesce(fname,'???')||') дал залп по системе «'||coalesce(tgt.name,'???')||
      '». Снаряд уже в пути к планете «'||ptname||'» — расчётное время полёта ~'||
      to_char(fly_h,'FM990.0')||' ч. Ни птица, ни ива слезы не прольет, если сгинет с Земли человеческий род. И весна… и весна встретит новый рассвет, не заметив, что нас уже нет.');
  else
    perform public._doom_news(
      '💥 БАЛЛИСТИЧЕСКИЙ ЗАЛП ГИПЕРПЕЙСЕРА',
      'Гиперпейсер ('||coalesce(fname,'???')||') выпустил '||
      case p_kind when 'ball_light' then 'лёгкий баллистический снаряд'
                  when 'ball_emp' then 'снаряд-«Фантом» (невидим для планетарной ПРО)'
                  when 'ball_cluster' then 'кассетный баллистический снаряд'
                  else 'тяжёлый баллистический снаряд' end||
      ' по планете «'||ptname||'» в системе «'||coalesce(tgt.name,'???')||'». Подлёт ~'||
      to_char(fly_h,'FM990.0')||' ч. Я видел сон... который не был сном. Погасло солнце светлое, и звезды скиталися без цели, без лучей');
  end if;

  return jsonb_build_object('ok', true, 'kind', p_kind, 'ready_at', rdy, 'target', ptname,
                            'flight_h', round(fly_h,1), 'integrity', newint);
end$$;
revoke all on function public.mza_fire(uuid,text,int,text,text) from public;
grant execute on function public.mza_fire(uuid,text,int,text,text) to authenticated;

-- админ-выдача открывает всю цепочку технологий
drop function if exists public.admin_grant_mza(text,text);
create or replace function public.admin_grant_mza(p_fid text, p_system_id text default null, p_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare sid text; v_owner uuid; v_id uuid; sysname text; v_name text;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  sid := p_system_id;
  v_name := nullif(btrim(coalesce(p_name,'')), '');
  if v_name is null then v_name := 'Гиперпейсер'; end if;
  v_name := left(v_name, 40);
  if sid is null then
    select system_id into sid from public.colonies where faction_id=p_fid order by created_at asc limit 1;
  end if;
  if sid is null then raise exception 'no system: specify p_system_id or give the faction a colony first'; end if;
  if not exists(select 1 from public.map_systems where id=sid) then raise exception 'no such system: %', sid; end if;
  select owner_id into v_owner from public.faction_economy where faction_id=p_fid;
  if v_owner is null then
    select owner_id into v_owner from public.faction_applications
      where faction_id=p_fid and status='approved' order by updated_at desc limit 1;
  end if;
  if v_owner is null then
    select owner_id into v_owner from public.colonies where faction_id=p_fid order by created_at asc limit 1;
  end if;
  insert into public.mza_ships(faction_id, owner_id, name, status, system_id)
    values(p_fid, v_owner, v_name, 'idle', sid)
    returning id into v_id;
  update public.faction_economy
    set research = (select jsonb_agg(distinct e) from jsonb_array_elements(
          coalesce(research,'[]'::jsonb)
          || '["pol.inevitability","pol.nemesis","pol.hyperpacer","pol.ballistics"]'::jsonb) e)
    where faction_id = p_fid;
  select name into sysname from public.map_systems where id=sid;
  return jsonb_build_object('ok', true, 'id', v_id, 'system_id', sid, 'system_name', sysname);
end$$;
revoke all on function public.admin_grant_mza(text,text,text) from public;
grant execute on function public.admin_grant_mza(text,text,text) to authenticated;

-- админ: насыпать снарядов для тестов
create or replace function public.admin_grant_shells(p_fid text, p_kind text, p_qty int default 5)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  if not public._shell_kind_ok(p_kind) then raise exception 'bad shell kind'; end if;
  perform public._shell_add(p_fid, p_kind, greatest(1, coalesce(p_qty,5)));
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.admin_grant_shells(text,text,int) from public;
grant execute on function public.admin_grant_shells(text,text,int) to authenticated;

-- ── 11) ОЖЕРЕЛЬЕ НЕМЕЗИДЫ — мегасооружение, системная ПРО ───
-- Реген зарядов: +1/сутки до максимума, лениво.
create or replace function public._nemesis_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare r record; days int; mx int;
begin
  mx := public._shell_const('nemo_charges')::int;
  for r in select id, coalesce(ammo,0) ammo, coalesce(nemesis_last, now()) nl
           from public.colony_buildings where faction_id = p_fid and btype = 'nemesis'
  loop
    days := floor(extract(epoch from (now() - r.nl)) / 86400.0 / public._shell_const('nemo_regen_d'))::int;
    if days < 1 or r.ammo >= mx then
      if r.ammo >= mx then update public.colony_buildings set nemesis_last = now() where id = r.id; end if;
      continue;
    end if;
    update public.colony_buildings
      set ammo = least(mx, r.ammo + days), nemesis_last = r.nl + (days || ' days')::interval
      where id = r.id;
  end loop;
end$$;
revoke all on function public._nemesis_settle(text) from public;

-- рождение Немезиды: полный магазин зарядов
create or replace function public._nemesis_on_building()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if NEW.btype = 'nemesis' then
    NEW.ammo := public._shell_const('nemo_charges')::int;
    NEW.nemesis_last := now();
  end if;
  return NEW;
end$$;
drop trigger if exists trg_nemesis_on_building on public.colony_buildings;
create trigger trg_nemesis_on_building before insert on public.colony_buildings
  for each row execute function public._nemesis_on_building();

-- RPC: возвести Ожерелье. ТЕХНОЛОГИЯ pol.nemesis (стоит ДО Гиперпейсера в ветке).
-- Цена: ГС + 50 Стелларит (фиолет.) + 10 Рагенод + 5 Гравиядро (оранж.). 3 дня.
create or replace function public.nemesis_build(p_colony_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies; eco public.faction_economy; res jsonb;
  used int; pending int; gc_cost numeric; k text; need numeric; have numeric; fname text; sysname text;
  cost jsonb := jsonb_build_object('Стелларит', 50, 'Рагенод', 10, 'Гравиядро', 5);
begin
  fid := public._ec_my_fid();
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  -- ВОРОТА: технология «Ожерелье Немезиды»
  if not (coalesce(eco.research,'[]'::jsonb) ? 'pol.nemesis') then
    raise exception 'research required: pol.nemesis';
  end if;
  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if col.faction_id is distinct from fid then raise exception 'not your colony'; end if;
  -- одна Немезида на систему (мегасооружение прикрывает всю систему)
  if exists(select 1 from public.colony_buildings cb join public.colonies c on c.id = cb.colony_id
            where cb.btype='nemesis' and c.system_id = col.system_id) then
    raise exception 'system already shielded: в этой системе уже есть Ожерелье Немезиды';
  end if;
  if exists(select 1 from public.colony_projects cp join public.colonies c2 on c2.id = cp.colony_id
            where cp.kind='build' and cp.btype='nemesis' and c2.system_id = col.system_id) then
    raise exception 'nemesis already under construction in this system';
  end if;
  select count(*) into used    from public.colony_buildings where colony_id = p_colony_id;
  select count(*) into pending from public.colony_projects  where colony_id = p_colony_id and kind='build';
  if used + pending >= coalesce(col.cells,6) then raise exception 'no free cells'; end if;

  gc_cost := public._shell_const('nemo_gc');
  res := coalesce(eco.resources,'{}'::jsonb);
  for k in select jsonb_object_keys(cost) loop
    need := (cost->>k)::numeric;
    have := coalesce((res->>k)::numeric, 0);
    if have < need then raise exception 'not enough %: need %, have %', k, need, floor(have); end if;
    res := jsonb_set(res, array[k], to_jsonb(have - need), true);
  end loop;
  update public.faction_economy set gc = gc - gc_cost, resources = res
    where faction_id = fid and gc >= gc_cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects (faction_id, owner_id, kind, btype, colony_id, payload, label, ready_at)
  values (fid, auth.uid(), 'build', 'nemesis', p_colony_id,
          jsonb_build_object('spent_gc', gc_cost, 'btype', 'nemesis', 'free_slots', 1),
          'Сборка Ожерелья Немезиды', now() + (public._shell_const('nemo_build_d') || ' days')::interval);

  select name into fname from public.faction_applications where faction_id=fid and status='approved' order by updated_at desc limit 1;
  select name into sysname from public.map_systems where id = col.system_id;
  perform public._doom_news(
    '⛨ ОЖЕРЕЛЬЕ НЕМЕЗИДЫ',
    coalesce(fname,'Неизвестная держава')||' начинает сборку Ожерелья Немезиды над системой «'||
    coalesce(sysname,'???')||'» — кольца перехватчиков, способного защитить каждую планету системы. '||
    'Даже судный день теперь можно отменить.');
  return jsonb_build_object('ok', true, 'gc', gc_cost, 'cost', cost,
                            'ready_at', now() + (public._shell_const('nemo_build_d') || ' days')::interval);
end$$;
revoke all on function public.nemesis_build(uuid) from public;
grant execute on function public.nemesis_build(uuid) to authenticated;

-- ── 12) ЕДИНЫЙ ПЕРЕХВАТ: Немезида (вся система) → планетарная ПРО ──
-- Возвращает 'nemesis' | 'abm' | null. «Фантом» (no_abm) планетарная ПРО не видит.
create or replace function public._doom_intercept(p_system_id text, p_pid int, p_kind text default 'doom')
returns text language plpgsql security definer set search_path=public as $$
declare r record; hit boolean; bp jsonb;
begin
  -- 1) Ожерелье Немезиды: любая колония системы с btype='nemesis'
  select cb.id, cb.faction_id into r
    from public.colony_buildings cb join public.colonies c on c.id = cb.colony_id
    where cb.btype='nemesis' and c.system_id = p_system_id
    order by coalesce(cb.ammo,0) desc limit 1;
  if found then
    perform public._nemesis_settle(r.faction_id);
    update public.colony_buildings set ammo = ammo - 1
      where id = r.id and coalesce(ammo,0) > 0;
    if found then return 'nemesis'; end if;
  end if;
  -- 2) планетарная ПРО (если срез обороны применён); «Фантом» она не видит
  bp := public._ball_params(p_kind);
  if coalesce((bp->>'no_abm')::boolean, false) then return null; end if;
  if to_regprocedure('public._abm_intercept(text,int)') is not null then
    execute 'select public._abm_intercept($1,$2)' into hit using p_system_id, p_pid;
    if hit then return 'abm'; end if;
  end if;
  return null;
end$$;
revoke all on function public._doom_intercept(text,int,text) from public;

-- ── 13) РЕЗОЛВ ЗАЛПОВ (суперсет _interstellar_artillery.sql) ──
-- Добавлено: тиры баллистики (население + постройки по паспорту тира,
-- планета живёт) и перехват через _doom_intercept.
create or replace function public._doom_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare s record; tgt public.map_systems; arr jsonb; el jsonb; newpl jsonb; i int;
  victim_fid text; victim_name text; col public.colonies;
  v_icept text; bp jsonb; pop0 numeric; frac numeric; dead_pop numeric; dice int; killed int; bnames text;
begin
  for s in select * from public.doom_salvos
           where faction_id = p_fid and status='in_flight' and ready_at <= now()
  loop
    -- ⛨ ПЕРЕХВАТ: Ожерелье Немезиды (вся система) → планетарная ПРО
    v_icept := public._doom_intercept(s.target_system_id, s.target_pid, coalesce(s.kind,'doom'));
    if v_icept is not null then
      update public.doom_salvos set status='intercepted', resolved_at=now() where id = s.id;
      perform public._doom_news('⛨ ЗАЛП ПЕРЕХВАЧЕН',
        case when v_icept = 'nemesis'
          then 'Ожерелье Немезиды вспыхнуло над системой: залп по планете «'||coalesce(s.target_planet,'???')||
               '» сбит кольцом перехватчиков ещё на подходе. Заряд Ожерелья израсходован — оно восстановится.'
          else 'Залп по планете «'||coalesce(s.target_planet,'???')||
               '» сбит планетарной ПРО. Планета уцелела — снаряд противоракеты израсходован.' end);
      continue;
    end if;

    bp := public._ball_params(coalesce(s.kind,'doom'));
    if bp is not null then
      -- 💥 БАЛЛИСТИКА: планета живёт; урон по паспорту тира
      select * into col from public.colonies
        where system_id = s.target_system_id
          and ((s.target_pid is not null and planet_pid = s.target_pid)
               or (s.target_pid is null and s.target_planet is not null and planet_name = s.target_planet))
        order by (planet_pid is not null) desc limit 1;
      if found then
        pop0 := coalesce(col.pop, coalesce(col.cells,6)*50);
        frac := (bp->>'pmin')::numeric + random() * ((bp->>'pmax')::numeric - (bp->>'pmin')::numeric);
        dead_pop := round(pop0 * frac);
        update public.colonies set pop = greatest(1, pop0 - dead_pop) where id = col.id;
        -- постройки: равновероятный дайс bmin..bmax (у тяжёлой bmin=bmax=5 — гарантия)
        dice := (bp->>'bmin')::int + floor(random() * ((bp->>'bmax')::int - (bp->>'bmin')::int + 1))::int;
        killed := 0; bnames := null;
        if dice > 0 then
          with victims as (
            select id, btype from public.colony_buildings
              where colony_id = col.id order by random() limit dice
          ), gone as (
            delete from public.colony_buildings cb using victims v where cb.id = v.id returning v.btype
          )
          select string_agg(coalesce(nullif(btype,''),'постройка'), ', '), count(*)
            into bnames, killed from gone;
        end if;
        select name into victim_name from public.faction_applications
          where faction_id = col.faction_id and status='approved' order by updated_at desc limit 1;
        update public.doom_salvos set victim_fid = col.faction_id where id = s.id;
        perform public._doom_news(
          '💥 БАЛЛИСТИЧЕСКИЙ УДАР ПО «'||upper(coalesce(s.target_planet,'???'))||'»',
          'Баллистический снаряд достиг планеты «'||coalesce(s.target_planet,'???')||'»'||
          case when victim_name is not null then ' державы «'||victim_name||'»' else '' end||
          '. Погибло ~'||to_char(dead_pop,'FM999999990')||' жителей ('||to_char(round(frac*100),'FM990')||'% населения). '||
          case when coalesce(killed,0) > 0
               then 'Разрушено построек: '||killed||' ('||coalesce(bnames,'')||').'
               else 'Постройки чудом уцелели.' end);
      else
        perform public._doom_news(
          '💥 БАЛЛИСТИЧЕСКИЙ УДАР В ПУСТОТУ',
          'Баллистический снаряд лёг на «'||coalesce(s.target_planet,'???')||'», но смерть не вышла на работу. '||
          'Кратер станет памятником расточительности.');
      end if;
      update public.doom_salvos set status='done', resolved_at=now() where id = s.id;
      continue;
    end if;

    -- ☠ СНАРЯД ДЛАНИ: планета → мёртвый камень (как раньше)
    select * into tgt from public.map_systems where id = s.target_system_id;
    if found then
      arr := coalesce(tgt.planets, '[]'::jsonb);
      newpl := '[]'::jsonb;
      for i in 0 .. jsonb_array_length(arr)-1 loop
        el := arr->i;
        if (el->>'pid')::int = s.target_pid then
          el := el
            || jsonb_build_object(
                 'g','lava', 'kind','planet', 'type','Мёртвая планета',
                 'icon','🪨', 'slotsP', 0, 'slotsK', 0,
                 'resources','[]'::jsonb, 'dead', true, 'doomed', true,
                 'doomed_by', p_fid, 'doomed_at', to_jsonb(now()));
        end if;
        newpl := newpl || jsonb_build_array(el);
      end loop;
      update public.map_systems set planets = newpl where id = tgt.id;

      if to_regclass('public.system_minefields') is not null then
        delete from public.system_minefields
          where system_id = s.target_system_id
            and ((s.target_pid is not null and planet_pid = s.target_pid)
                 or (s.target_pid is null and planet_pid is null));
      end if;

      victim_fid := null; victim_name := null;
      select * into col from public.colonies
        where system_id = s.target_system_id
          and ((s.target_pid is not null and planet_pid = s.target_pid)
               or (s.target_pid is null and s.target_planet is not null and planet_name = s.target_planet))
        order by (planet_pid is not null) desc limit 1;
      if found then
        victim_fid := col.faction_id;
        select name into victim_name from public.faction_applications
          where faction_id = victim_fid and status='approved' order by updated_at desc limit 1;
        delete from public.colonies where id = col.id;
        update public.doom_salvos set victim_fid = col.faction_id where id = s.id;
      end if;

      perform public._doom_news(
        '☠ ГИБЕЛЬ МИРА',
        'Планета «'||coalesce(s.target_planet,'???')||'» в системе «'||coalesce(tgt.name,'???')||
        '» перестала существовать. И ты, как все, пойдешь во мрак, где нет ни Бога, ни людей. И будешь ты, как падший злак, в пустыне тлеть, один, как враг самих теней!'||
        case when victim_name is not null then ' Колония державы «'||victim_name||'» стёрта вместе с миром.' else '' end||
        ' Молчите. Здесь больше нечего сказать.');
    end if;

    update public.doom_salvos set status='done', resolved_at=now() where id = s.id;
  end loop;
end$$;
revoke all on function public._doom_resolve(text) from public;

-- ── ГОТОВО ──────────────────────────────────────────────────
-- ПРО-математика (справка): планетарная ПРО тратит 1 снаряд (800 ГС,
-- доставка 1 день) на каждый входящий залп; перегруз = боезапас+1 залпов.
-- «Фантом» (ball_emp) планетарная ПРО не видит вовсе.
-- Ожерелье Немезиды перехватывает РАНЬШЕ планетарной ПРО, держит 6 зарядов
-- и восстанавливает +1/сутки — перегруз только серией 7+ залпов подряд.
