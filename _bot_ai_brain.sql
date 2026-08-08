-- © 2025–2026. Все права защищены.
-- ═══════════════════════════════════════════════════════════════════
-- 🧠 ИИ БОТОВ: ПОЛЕ ПОТОКА, ПОЗИЦИОНКА, МОДУЛИ
-- ═══════════════════════════════════════════════════════════════════
-- ПОРЯДОК: после _bot_ai_rules.sql, _bot_turn_perf.sql, _bt_modules2.sql,
-- _bt_ram_nuke_aegis.sql, _bt_timepool.sql, _bt_arena_zoning.sql.
-- Идемпотентно. Ядро боя не трогаем — бот ходит теми же _bt_do_*.
--
-- ЧТО БЫЛО НЕ ТАК
--
-- 1) МАРШРУТ. _bt_bot_path — жадный шаг: из шести направлений брались три
--    «в сторону цели», и КАЖДЫЙ шаг обязан был строго сокращать дистанцию
--    (`if _bt_dist(nx,ny,tx,ty) >= curd then continue`). На рваной арене с
--    поясами и вырезанной пустотой это тупик по определению: как только
--    прямой коридор упирается в кромку, «приближающих» клеток не остаётся,
--    бот замирает у стены и жмёт «конец хода» до скончания боя.
--    Стало: ОДНО поле потока на ход — взвешенный обход всей арены от всех
--    вражеских бортов (open 1, туманность/обломки 2, пояс 3). Дальше борт
--    просто катится по градиенту: поле само огибает стены, пустоту и пояса,
--    потому что оно построено ПО проходимости, а не по прямой линии.
--
-- 2) ПОЗИЦИОНКА. Бот знал ровно одно поведение — «сблизиться до дальности
--    залпа». Отсюда и куча-мала под ядерку, и ракетчики, лезущие в упор.
--    Стало: у борта есть РОЛЬ (снайпер / скирмишер / таран / поддержка) и
--    рабочий рубеж; шаг выбирается по трём слагаемым — градиент поля,
--    ПЛОТНОСТЬ своих вокруг клетки (анти-ядерка) и УГРОЗА клетки (сколько
--    урона враг доносит до неё СЛЕДУЮЩИМ ходом, с учётом его хода — это и
--    есть «предугадывание»). Побитый борт разрывает дистанцию, а не умирает
--    на месте.
--
-- 3) МОДУЛИ. battle_module — игроцкий RPC с _ec_my_fid(), боту он был
--    недоступен физически. Стало: ядро _bt_do_module с явным актором (как
--    _bt_do_move/_bt_do_fire), сам battle_module — тонкая обёртка. Поверх —
--    политика применения: ядерка только по СКОПЛЕНИЮ и только когда своих в
--    радиусе нет, таран — на добивание, прыжок — на разрыв дистанции,
--    подавитель — по тому, у кого самому есть чем ударить.
--    Секунды хода при этом резервируются под главный залп: модуль не имеет
--    права сожрать пул, если обычный залп бьёт больнее.
-- ═══════════════════════════════════════════════════════════════════

-- ── 0. ЯДРО МОДУЛЕЙ С ЯВНЫМ АКТОРОМ ─────────────────────────────────
-- Тело берём ЖИВОЕ из базы и правим ровно две строки: бан-чек уезжает в
-- обёртку, актор становится параметром. Так политика бота не может разойтись
-- с правилами, по которым модули работают у игрока.
do $mod$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'battle_module'
   order by p.oid limit 1;
  if src is null then raise exception 'battle_module не найдена'; end if;

  if position('_bt_do_module(' in src) > 0 then
    raise notice 'battle_module уже обёртка — ядро не пересобираю';
    return;
  end if;

  src := replace(src,
    'FUNCTION public.battle_module(p_battle uuid, p_unit uuid, p_key text, p_target uuid DEFAULT NULL::uuid, p_x integer DEFAULT NULL::integer, p_y integer DEFAULT NULL::integer)',
    'FUNCTION public._bt_do_module(p_battle uuid, p_unit uuid, p_key text, p_target uuid, p_x integer, p_y integer, p_fid text)');
  if position('_bt_do_module' in src) = 0 then
    raise exception 'сигнатура battle_module не та, что ожидалась — ядро НЕ собрано';
  end if;
  src := replace(src,
    '  if public.current_user_banned() then raise exception ''forbidden: account banned''; end if;' || E'\n', '');
  src := replace(src, 'me := public._ec_my_fid();', 'me := p_fid;');
  if position('me := p_fid;' in src) = 0 then
    raise exception 'якорь актора не найден — ядро НЕ собрано';
  end if;
  execute src;
end$mod$;

revoke all on function public._bt_do_module(uuid,uuid,text,uuid,int,int,text) from public;

create or replace function public.battle_module(
  p_battle uuid, p_unit uuid, p_key text,
  p_target uuid default null, p_x int default null, p_y int default null)
returns jsonb language plpgsql security definer set search_path=public as $fn$
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  return public._bt_do_module(p_battle, p_unit, p_key, p_target, p_x, p_y, public._ec_my_fid());
end$fn$;
revoke all on function public.battle_module(uuid,uuid,text,uuid,int,int) from public;
grant execute on function public.battle_module(uuid,uuid,text,uuid,int,int) to authenticated;

-- ── 1. ПОЛЕ ПОТОКА ──────────────────────────────────────────────────
-- Волна от ВСЕХ вражеских бортов по проходимости арены. Значение в клетке —
-- во сколько «шагов» она отстоит от ближайшего врага с поправкой на грунт.
-- Строится один раз на ход бота: враг за наш ход с места не сходит.
create unlogged table if not exists public.bt_bot_flow(
  battle_id uuid not null,
  x int not null,
  y int not null,
  d int not null,
  primary key (battle_id, x, y)
);
alter table public.bt_bot_flow enable row level security;   -- служебная, наружу не отдаём
revoke all on table public.bt_bot_flow from anon, authenticated;
create index if not exists bt_bot_flow_d on public.bt_bot_flow(battle_id, d);

comment on table public.bt_bot_flow is 'поле потока ИИ: расстояние по проходимости до ближайшего врага; живёт один ход';

create or replace function public._bt_flow_cost(k text) returns int
language sql immutable as $$
  select case k when 'ast' then 3 when 'deb' then 2 when 'neb' then 2 else 1 end;
$$;

-- Проходимость арены: форма и грунт за бой не меняются, поэтому клетки с их
-- ценой входа считаются ОДИН раз за бой. Без этого кэша каждый уровень волны
-- заново гонял _bt_in_arena с его тригонометрией — 3.5 с на ход бота.
create unlogged table if not exists public.bt_bot_cell(
  battle_id uuid not null,
  x int not null,
  y int not null,
  c int not null,
  primary key (battle_id, x, y)
);
alter table public.bt_bot_cell enable row level security;
revoke all on table public.bt_bot_cell from anon, authenticated;

comment on table public.bt_bot_cell is 'кэш проходимости арены для ИИ: клетка внутри формы + цена входа';

-- Готовые рёбра гекс-сетки: сама волна не должна пересчитывать соседей.
create unlogged table if not exists public.bt_bot_edge(
  battle_id uuid not null,
  x int not null,
  y int not null,
  nx int not null,
  ny int not null,
  c int not null
);
alter table public.bt_bot_edge enable row level security;
revoke all on table public.bt_bot_edge from anon, authenticated;
create index if not exists bt_bot_edge_from on public.bt_bot_edge(battle_id, x, y);

create or replace function public._bt_cells_build(p_battle uuid)
returns int language plpgsql security definer set search_path=public as $fn$
declare b record; w int; h int; n int;
begin
  if exists(select 1 from public.bt_bot_cell where battle_id = p_battle limit 1) then
    return 0;                                   -- уже посчитано за этот бой
  end if;
  perform public._bt_arm(p_battle);
  w := public._bt_w(); h := public._bt_h();
  select * into b from public.battles where id = p_battle;
  if b.id is null then return 0; end if;
  -- кэш от снесённых боёв не копим
  delete from public.bt_bot_cell c
   where not exists(select 1 from public.battles z where z.id = c.battle_id);
  delete from public.bt_bot_flow f
   where not exists(select 1 from public.battles z where z.id = f.battle_id);
  delete from public.bt_bot_edge e
   where not exists(select 1 from public.battles z where z.id = e.battle_id);
  delete from public.bt_bot_risk r
   where not exists(select 1 from public.battles z where z.id = r.battle_id);

  insert into public.bt_bot_cell(battle_id, x, y, c)
    select p_battle, gx.px, gy.py,
           public._bt_flow_cost(public._bt_terra(b.terrain, gx.px, gy.py))
      from generate_series(0, w - 1) gx(px), generate_series(0, h - 1) gy(py)
     where public._bt_in_arena(b.shape, gx.px, gy.py)
    on conflict do nothing;
  get diagnostics n = row_count;

  delete from public.bt_bot_edge where battle_id = p_battle;
  insert into public.bt_bot_edge(battle_id, x, y, nx, ny, c)
    select p_battle, a.x, a.y, z.x, z.y, z.c
      from public.bt_bot_cell a
      cross join lateral (
        select st[1] as nx, st[2] as ny
          from (select public._bt_step(a.x, a.y, g) as st from generate_series(0,5) g) q
      ) s
      join public.bt_bot_cell z
        on z.battle_id = p_battle and z.x = s.nx and z.y = s.ny
     where a.battle_id = p_battle;
  return n;
end$fn$;
revoke all on function public._bt_cells_build(uuid) from public;

create or replace function public._bt_flow_build(p_battle uuid, p_side text)
returns int language plpgsql security definer set search_path=public as $fn$
declare b record; lvl int; n int; dry int := 0; w int; h int; total int := 0;
begin
  perform public._bt_arm(p_battle);
  w := public._bt_w(); h := public._bt_h();
  select * into b from public.battles where id = p_battle;
  if b.id is null then return 0; end if;
  perform public._bt_cells_build(p_battle);

  delete from public.bt_bot_flow where battle_id = p_battle;
  insert into public.bt_bot_flow(battle_id, x, y, d)
    select distinct p_battle, t.x, t.y, 0
      from public.battle_units t
     where t.battle_id = p_battle and t.alive and t.side <> p_side
    on conflict do nothing;
  get diagnostics total = row_count;
  if total = 0 then return 0; end if;

  -- Дейкстра вёдрами: на уровне lvl раскрываем всё, чья сумма «дистанция +
  -- цена входа» ровно lvl. Цены целые и не больше 3 — значит смотреть надо
  -- лишь узкую полосу уже посчитанного, а не всю карту.
  for lvl in 1..260 loop
    insert into public.bt_bot_flow(battle_id, x, y, d)
    select distinct p_battle, e.nx, e.ny, lvl
      from public.bt_bot_flow f
      join public.bt_bot_edge e
        on e.battle_id = p_battle and e.x = f.x and e.y = f.y
     where f.battle_id = p_battle and f.d >= lvl - 3 and f.d < lvl
       and f.d + e.c = lvl
    on conflict (battle_id, x, y) do nothing;
    get diagnostics n = row_count;
    total := total + n;
    if n = 0 then dry := dry + 1; else dry := 0; end if;
    exit when dry >= 3;          -- три пустых уровня подряд: волна выдохлась
  end loop;
  return total;
end$fn$;
revoke all on function public._bt_flow_build(uuid,text) from public;

-- Значение поля в клетке. 999 — «сюда волна не дошла» (пустота за кромкой
-- или закупоренный карман): такие клетки борт просто не выбирает.
create or replace function public._bt_flow_at(p_battle uuid, px int, py int)
returns int language sql stable security definer set search_path=public as $$
  select coalesce((select f.d from public.bt_bot_flow f
                    where f.battle_id = p_battle and f.x = px and f.y = py), 999);
$$;
revoke all on function public._bt_flow_at(uuid,int,int) from public;

-- ── 2. ЧТЕНИЕ ДОСКИ: угроза, плотность, дальнобойность ──────────────
-- Карта угрозы: сколько урона враг доносит до клетки. th_now — прямо сейчас,
-- th_next — с учётом ЕГО следующего хода (дальность + скорость). Это и есть
-- «предугадывание»: борт не встаёт туда, куда завтра дотянется полдоски.
-- Строится вместе с полем потока: за наш ход враг с места не сходит.
create unlogged table if not exists public.bt_bot_risk(
  battle_id uuid not null,
  x int not null,
  y int not null,
  th_now  numeric not null default 0,
  th_next numeric not null default 0,
  primary key (battle_id, x, y)
);
alter table public.bt_bot_risk enable row level security;
revoke all on table public.bt_bot_risk from anon, authenticated;

comment on table public.bt_bot_risk is 'карта угрозы для ИИ: входящий урон в клетке сейчас и после хода врага';

create or replace function public._bt_risk_build(p_battle uuid, p_side text)
returns int language plpgsql security definer set search_path=public as $fn$
declare n int;
begin
  delete from public.bt_bot_risk where battle_id = p_battle;
  insert into public.bt_bot_risk(battle_id, x, y, th_now, th_next)
    select c.battle_id, c.x, c.y,
           coalesce(sum(case when public._bt_dist(e.x, e.y, c.x, c.y) <= greatest(1, e.rng)
                             then greatest(0, e.dmg) else 0 end), 0),
           coalesce(sum(greatest(0, e.dmg)), 0)
      from public.bt_bot_cell c
      join public.battle_units e
        on e.battle_id = p_battle and e.alive and e.side <> p_side
       and public._bt_dist(e.x, e.y, c.x, c.y)
           <= greatest(1, e.rng) + coalesce(e.speed, 0)
     where c.battle_id = p_battle
     group by c.battle_id, c.x, c.y;
  get diagnostics n = row_count;
  return n;
end$fn$;
revoke all on function public._bt_risk_build(uuid,text) from public;

create or replace function public._bt_threat_at(p_battle uuid, p_side text,
                                                px int, py int, p_next boolean default true)
returns numeric language plpgsql stable security definer set search_path=public as $fn$
declare v numeric;
begin
  if exists(select 1 from public.bt_bot_risk where battle_id = p_battle limit 1) then
    select case when p_next then r.th_next else r.th_now end into v
      from public.bt_bot_risk r
     where r.battle_id = p_battle and r.x = px and r.y = py;
    return coalesce(v, 0);
  end if;
  -- карты нет (ручной вызов, диагностика) — считаем по доске
  select coalesce(sum(
           case when public._bt_dist(e.x, e.y, px, py)
                     <= greatest(1, e.rng) + case when p_next then coalesce(e.speed,0) else 0 end
                then greatest(0, e.dmg) else 0 end), 0) into v
    from public.battle_units e
   where e.battle_id = p_battle and e.alive and e.side <> p_side;
  return coalesce(v, 0);
end$fn$;
revoke all on function public._bt_threat_at(uuid,text,int,int,boolean) from public;

-- Плотность своих вокруг клетки. Ядерка накрывает радиус 2, «Голиаф» и
-- бортовой залп — радиус 1: стоять в куче = дарить врагу размен один в трёх.
create or replace function public._bt_crowd_at(p_battle uuid, p_side text,
                                               px int, py int, p_self uuid)
returns int language sql stable security definer set search_path=public as $$
  select coalesce(count(*), 0)::int
    from public.battle_units f
   where f.battle_id = p_battle and f.alive and f.side = p_side
     and f.id is distinct from p_self
     and public._bt_dist(f.x, f.y, px, py) <= 2;
$$;
revoke all on function public._bt_crowd_at(uuid,text,int,int,uuid) from public;

-- Рабочая дальность борта: самая длинная боевая группа (ремонт не в счёт).
create or replace function public._bt_bot_reach(p_unit uuid)
returns int language sql stable security definer set search_path=public as $$
  select greatest(1, coalesce((
    select max((g->>'rng')::int)
      from public.battle_units u,
           lateral jsonb_array_elements(
             case when u.wpn is null or jsonb_array_length(u.wpn) = 0
                  then jsonb_build_array(jsonb_build_object('rng', u.rng, 'dmg', u.dmg))
                  else u.wpn end) g
     where u.id = p_unit
       and coalesce(g->>'k','kinetic') <> 'repair'
       and coalesce((g->>'dmg')::numeric, 0) > 0), 1));
$$;
revoke all on function public._bt_bot_reach(uuid) from public;

-- ── 3. РОЛЬ И РУБЕЖ ─────────────────────────────────────────────────
-- Роль читается из того, чем борт вооружён, а не из класса: проект с
-- ремонтным роем — поддержка, чем бы он ни назывался.
--   sniper  — длинная рука, держит рубеж и не подпускает
--   skirm   — средняя, работает на кромке своей полосы
--   brawler — короткая рука либо таран: идёт в упор
--   support — ремонт, баффы, глушилки: стоит за спиной
create or replace function public._bt_bot_role(p_battle uuid, p_unit uuid)
returns text language plpgsql stable security definer set search_path=public as $fn$
declare u record; reach int; heal boolean; ram boolean; aid boolean;
begin
  select * into u from public.battle_units where id = p_unit;
  if u.id is null then return 'skirm'; end if;
  reach := public._bt_bot_reach(p_unit);

  heal := exists(select 1 from jsonb_array_elements(coalesce(u.wpn,'[]'::jsonb)) g
                  where g->>'k' = 'repair');
  aid  := exists(select 1 from jsonb_array_elements(coalesce(u.acts,'[]'::jsonb)) a
                  where a->>'k' in ('drones','wboost','pboost','aboost','pdup','blind'));
  ram  := exists(select 1 from jsonb_array_elements(coalesce(u.acts,'[]'::jsonb)) a
                  where a->>'k' in ('ram','rupture'));

  if heal or (aid and reach <= 6) then return 'support'; end if;
  if u.cls = 'ss13' or coalesce(u.speed,0) <= 0 then return 'sniper'; end if;
  if ram and reach <= 6 then return 'brawler'; end if;
  if reach >= 10 then return 'sniper'; end if;
  if reach <= 4  then return 'brawler'; end if;
  return 'skirm';
end$fn$;
revoke all on function public._bt_bot_role(uuid,uuid) from public;

-- Рубеж: на каком расстоянии от врага борту выгодно стоять.
create or replace function public._bt_bot_band(p_battle uuid, p_unit uuid)
returns int language plpgsql stable security definer set search_path=public as $fn$
declare u record; reach int; role text;
begin
  select * into u from public.battle_units where id = p_unit;
  if u.id is null then return 2; end if;
  reach := public._bt_bot_reach(p_unit);
  role  := public._bt_bot_role(p_battle, p_unit);
  return case role
    when 'sniper'  then greatest(4, floor(reach * 0.80)::int)
    when 'skirm'   then greatest(2, floor(reach * 0.70)::int)
    when 'support' then greatest(3, least(6, floor(reach * 0.60)::int))
    else 1 end;
end$fn$;
revoke all on function public._bt_bot_band(uuid,uuid) from public;

-- ── 4. ВЫБОР ЦЕЛИ: фокус огня, а не «кто ближе» ─────────────────────
-- Считаем ПРИМЕРНЫЙ урон по каждой цели (полоса группы + её стойкости) и
-- делим на остаток живучести: так залп идёт туда, где он ближе всего к
-- убийству. Добивание — вне конкуренции, следом — самый зубастый враг.
create or replace function public._bt_bot_target(p_battle uuid, p_unit uuid)
returns uuid language plpgsql stable security definer set search_path=public as $fn$
declare u record; b record; maxr int; res uuid; seen uuid[];
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null or not u.alive or u.fired then return null; end if;
  select * into b from public.battles where id = p_battle;
  maxr := public._bt_bot_reach(p_unit);

  seen := public._bt_seen_get(p_battle, u.side);
  if seen is null then seen := public._bt_seen_calc(p_battle, u.side); end if;
  if array_length(seen, 1) is null then return null; end if;

  select t.id into res
    from public.battle_units t
    cross join lateral (
      select coalesce(sum((g->>'dmg')::numeric
               * (1 - least(0.9, greatest(-0.75,
                   coalesce((t.resist->>coalesce(g->>'k','kinetic'))::numeric, 0))))), 0) as eff
        from jsonb_array_elements(
               case when u.wpn is null or jsonb_array_length(u.wpn) = 0
                    then jsonb_build_array(jsonb_build_object('rng', u.rng, 'dmg', u.dmg))
                    else u.wpn end) g
       where coalesce(g->>'k','kinetic') <> 'repair'
         and public._bt_dist(u.x, u.y, t.x, t.y)
             between greatest(1, coalesce((g->>'dmin')::int, 1)) and (g->>'rng')::int
    ) w
   where t.battle_id = p_battle and t.alive and t.side <> u.side
     and t.id = any(seen)
     and public._bt_dist(u.x, u.y, t.x, t.y) between 1 and maxr
     and public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y)
     and w.eff > 0
   order by (w.eff >= t.hp + t.shield) desc,                       -- добить
            w.eff / greatest(1, t.hp + t.shield)
              * (1 + greatest(0, t.dmg) / greatest(1, u.max_hp)) desc,   -- больнее и опаснее
            t.id
   limit 1;
  return res;
end$fn$;
revoke all on function public._bt_bot_target(uuid,uuid) from public;

-- ── 5. МАРШРУТ ПО ПОЛЮ ПОТОКА ───────────────────────────────────────
-- Режимы: 'close' — сократить рубеж, 'stand' — выйти НА рубеж и держать его,
-- 'back' — разорвать дистанцию. Внутри одного шага сравниваются шесть соседей
-- и «остаться на месте»: если стоять лучше — маршрут пустой, и борт не тратит
-- секунды впустую.
-- Во что обходится сам грунт, помимо секунд: пояс каждый ход грызёт корпус,
-- туманность роняет щит, обломки замедляют. Это плата за КЛЕТКУ, поэтому она
-- одинаково считается и для шага в неё, и для решения остаться в ней.
create or replace function public._bt_terra_pen(k text) returns numeric
language sql immutable as $$
  select case k when 'ast' then 14 when 'neb' then 6 when 'deb' then 3 else 0 end::numeric;
$$;

create or replace function public._bt_bot_route(p_battle uuid, p_unit uuid,
                                                p_mode text, p_band int)
returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare u record; b record; path jsonb := '[]'::jsonb;
        base numeric; budget numeric; cx int; cy int;
        dir int; nb int[]; nx int; ny int; tt text; hc numeric;
        fv int; sc numeric; best numeric; bx int; byy int; bhc numeric;
        dur numeric; wthreat numeric; step int; stay numeric;
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null or not u.alive or u.moved then return path; end if;
  if u.stance = 'siege' or u.cls = 'ss13' or coalesce(u.speed,0) <= 0 then return path; end if;
  select * into b from public.battles where id = p_battle;

  base := public._bt_step_cost(u.speed);
  if u.stance = 'eng' then base := base * public._bt_eng_mult(); end if;
  if public._bt_deb_has(u.deb, 'stasis') then base := base * 2; end if;
  budget := coalesce(u.tp, 0);
  if budget < base then return path; end if;

  dur := greatest(1, coalesce(u.hp,0) + coalesce(u.shield,0));
  -- насколько борт считается с огнём: стеклянному снайперу угроза важнее,
  -- тарану она почти безразлична — он за тем и идёт
  wthreat := case public._bt_bot_role(p_battle, p_unit)
                  when 'brawler' then 0.6 when 'support' then 3.0
                  when 'sniper'  then 2.5 else 1.5 end;

  cx := u.x; cy := u.y;
  for step in 1..12 loop
    -- цена «остаться»: то же место, но без траты секунд. Грунт под килем
    -- считаем и здесь — иначе борт, заехавший в пояс, так в нём и живёт,
    -- каждый ход теряя по десятой корпуса.
    fv   := public._bt_flow_at(p_battle, cx, cy);
    stay := case p_mode
              when 'close' then -fv::numeric
              when 'back'  then least(fv, p_band * 2)::numeric
              else          -abs(fv - p_band)::numeric end * 10
            - public._bt_crowd_at(p_battle, u.side, cx, cy, u.id) * 6
            - wthreat * public._bt_threat_at(p_battle, u.side, cx, cy) / dur * 8
            - public._bt_terra_pen(public._bt_terra(b.terrain, cx, cy));

    best := stay; bx := null;
    for dir in 0..5 loop
      nb := public._bt_step(cx, cy, dir);
      nx := nb[1]; ny := nb[2];
      continue when nx < 0 or nx >= public._bt_w() or ny < 0 or ny >= public._bt_h();
      continue when not public._bt_in_arena(b.shape, nx, ny);
      continue when exists(select 1 from public.battle_units
                            where battle_id = p_battle and alive and x = nx and y = ny);
      continue when exists(select 1 from jsonb_array_elements(path) e
                            where (e->>'x')::int = nx and (e->>'y')::int = ny);
      continue when nx = u.x and ny = u.y;
      tt := public._bt_terra(b.terrain, nx, ny);
      hc := base * public._bt_terra_mult(tt);
      continue when budget < hc;                      -- не по карману

      fv := public._bt_flow_at(p_battle, nx, ny);
      continue when fv >= 999 and p_mode <> 'back';   -- в закупоренный карман не лезем

      sc := case p_mode
              when 'close' then -fv::numeric
              when 'back'  then least(fv, p_band * 2)::numeric
              else          -abs(fv - p_band)::numeric end * 10
          - public._bt_crowd_at(p_battle, u.side, nx, ny, u.id) * 6
          - wthreat * public._bt_threat_at(p_battle, u.side, nx, ny) / dur * 8
          - public._bt_terra_pen(tt)
          - 0.5;                                       -- шаг ради шага не делаем
      if sc > best then best := sc; bx := nx; byy := ny; bhc := hc; end if;
    end loop;

    exit when bx is null;                              -- стоять выгоднее
    path   := path || jsonb_build_array(jsonb_build_object('x', bx, 'y', byy));
    budget := budget - bhc;
    cx := bx; cy := byy;
    exit when budget < base;
  end loop;
  return path;
end$fn$;
revoke all on function public._bt_bot_route(uuid,uuid,text,int) from public;

-- ── 6. ПОЛИТИКА МОДУЛЕЙ ─────────────────────────────────────────────
-- Возвращает {k,t,x,y} — что применить прямо сейчас, или null.
-- p_reserve — сколько секунд НЕЛЬЗЯ трогать: под них уже запланирован
-- обычный залп. Обходят резерв только те решения, что дороже залпа по
-- определению: добивание, накрытие скопления, спасение борта.
create or replace function public._bt_bot_module(p_battle uuid, p_unit uuid,
                                                 p_reserve numeric default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare u record; b record; a jsonb; seen uuid[];
        k text; a_cost numeric; a_rng int; a_dmg numeric; a_val numeric;
        t record; hpq numeric;
        near int; nallies int; cnt int; jx int; jy int;
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null or not u.alive then return null; end if;
  if coalesce(jsonb_array_length(u.acts), 0) = 0 then return null; end if;
  if public._bt_deb_has(u.deb, 'disrupt') then return null; end if;   -- шина заглушена
  select * into b from public.battles where id = p_battle;

  seen := public._bt_seen_get(p_battle, u.side);
  if seen is null then seen := public._bt_seen_calc(p_battle, u.side); end if;
  if seen is null then seen := '{}'::uuid[]; end if;

  hpq  := coalesce(u.hp,0) / greatest(1, coalesce(u.max_hp,1));
  select coalesce(min(public._bt_dist(u.x, u.y, e.x, e.y)), 999) into near
    from public.battle_units e
   where e.battle_id = p_battle and e.alive and e.side <> u.side;
  select count(*) into nallies from public.battle_units f
   where f.battle_id = p_battle and f.alive and f.side = u.side and f.id <> u.id
     and public._bt_dist(f.x, f.y, u.x, u.y) <= 3;

  -- ── 6.1 СПАСЕНИЕ: прыжок из-под удара ─────────────────────────────
  a := public._bt_act(u.acts, 'blink');
  if a is not null and coalesce((u.mcd->>'blink')::int,0) = 0
     and hpq < 0.45 and near <= 3
     and u.tp + 1e-9 >= public._bt_act_cost('blink') and u.stance <> 'siege' then
    a_rng := coalesce((a->>'rng')::int, 1);
    jx := null;
    select q.px, q.py into jx, jy
      from (select gx.px, gy.py from generate_series(greatest(0, u.x - a_rng), least(public._bt_w()-1, u.x + a_rng)) gx(px),
                                     generate_series(greatest(0, u.y - a_rng), least(public._bt_h()-1, u.y + a_rng)) gy(py)) q
     where public._bt_dist(u.x, u.y, q.px, q.py) between 1 and a_rng
       and public._bt_in_arena(b.shape, q.px, q.py)
       and not exists(select 1 from public.battle_units
                       where battle_id = p_battle and alive and x = q.px and y = q.py)
     order by public._bt_threat_at(p_battle, u.side, q.px, q.py, false) asc,
              public._bt_flow_at(p_battle, q.px, q.py) desc
     limit 1;
    if jx is not null
       and public._bt_threat_at(p_battle, u.side, jx, jy, false)
           < public._bt_threat_at(p_battle, u.side, u.x, u.y, false) * 0.6 then
      return jsonb_build_object('k','blink','x',jx,'y',jy);
    end if;
  end if;

  -- ── 6.2 НАКРЫТИЕ СКОПЛЕНИЯ ────────────────────────────────────────
  -- Ядерка/торпеда/бортовой залп бьют по площади и НЕ разбирают своих.
  -- Условие простое: врагов под накрытием минимум двое, своих — ни одного.
  foreach k in array array['nuke','torpedo','broadside'] loop
    a := public._bt_act(u.acts, k);
    continue when a is null or coalesce((u.mcd->>k)::int, 0) > 0;
    a_cost := public._bt_act_cost(k);
    continue when u.tp + 1e-9 < a_cost;
    a_rng := coalesce((a->>'rng')::int, 1);
    a_dmg := coalesce((a->>'dmg')::numeric, 0);
    select e.id, e.x, e.y,
           (select count(*) from public.battle_units z
             where z.battle_id = p_battle and z.alive and z.side <> u.side
               and public._bt_dist(z.x, z.y, e.x, e.y) <= case when k='nuke' then 2 else 1 end) as ne
      into t
      from public.battle_units e
     where e.battle_id = p_battle and e.alive and e.side <> u.side
       and e.id = any(seen)
       and public._bt_dist(u.x, u.y, e.x, e.y) <= a_rng
       and (k in ('nuke','torpedo')
            or public._bt_los_clear(b.terrain, u.x, u.y, e.x, e.y))
       -- своих под раздачу не подставляем, себя в том числе
       and not exists(select 1 from public.battle_units f
                       where f.battle_id = p_battle and f.alive and f.side = u.side
                         and public._bt_dist(f.x, f.y, e.x, e.y)
                             <= case when k='nuke' then 2 else 1 end)
     order by (select count(*) from public.battle_units z
                where z.battle_id = p_battle and z.alive and z.side <> u.side
                  and public._bt_dist(z.x, z.y, e.x, e.y) <= case when k='nuke' then 2 else 1 end) desc,
              (e.hp + e.shield) asc
     limit 1;
    if t.id is not null then
      -- ядерка на одиночку — перевод боекомплекта; торпедой добить можно
      if t.ne >= 2 or (k <> 'nuke' and a_dmg >= t.hp + t.shield) then
        return jsonb_build_object('k', k, 't', t.id);
      end if;
    end if;
  end loop;

  -- ── 6.3 ТАРАН: только вплотную и только по делу ───────────────────
  foreach k in array array['ram','rupture'] loop
    a := public._bt_act(u.acts, k);
    continue when a is null or coalesce((u.mcd->>k)::int, 0) > 0;
    a_cost := public._bt_act_cost(k);
    continue when u.tp + 1e-9 < a_cost;
    a_dmg := coalesce((a->>'dmg')::numeric, 0);
    select * into t from public.battle_units e
     where e.battle_id = p_battle and e.alive and e.side <> u.side
       and public._bt_dist(u.x, u.y, e.x, e.y) = 1
     order by (a_dmg >= e.hp) desc, e.dmg desc, (e.hp + e.shield) asc
     limit 1;
    if t.id is not null then
      -- «Разрывной» вспарывает обшивку тому, кого добить не выходит,
      -- плазменный — добивает; в упор к сильному не лезем на последних НР
      if (a_dmg >= t.hp) or (hpq > 0.5 and (k = 'rupture' or a_dmg >= t.hp * 0.5)) then
        return jsonb_build_object('k', k, 't', t.id);
      end if;
    end if;
  end loop;

  -- ── 6.4 ИМПУЛЬСЫ ПО ВРАГАМ ВОКРУГ ─────────────────────────────────
  foreach k in array array['hell','stasis','blind'] loop
    a := public._bt_act(u.acts, k);
    continue when a is null or coalesce((u.mcd->>k)::int, 0) > 0;
    a_cost := public._bt_act_cost(k);
    continue when u.tp + 1e-9 < a_cost + p_reserve;
    a_rng := coalesce((a->>'rng')::int, 1);
    select count(*) into cnt from public.battle_units e
     where e.battle_id = p_battle and e.alive and e.side <> u.side
       and public._bt_dist(e.x, e.y, u.x, u.y) <= a_rng;
    if cnt >= 2 or (cnt >= 1 and k = 'hell'
                    and coalesce((a->>'dmg')::numeric,0) >= (select min(e.hp) from public.battle_units e
                          where e.battle_id = p_battle and e.alive and e.side <> u.side
                            and public._bt_dist(e.x, e.y, u.x, u.y) <= a_rng)) then
      return jsonb_build_object('k', k);
    end if;
  end loop;

  -- ── 6.5 ОДИНОЧНЫЕ РАКЕТЫ ──────────────────────────────────────────
  -- «Ломовик»/подавитель/«Тартар» — по самому зубастому, у кого есть чем
  -- ответить; «Шквал»/«Буревестник»/иссушитель — по тому, кого добиваем.
  foreach k in array array['salvo','storm','tartarus','wbreak','disrupt','drain'] loop
    a := public._bt_act(u.acts, k);
    continue when a is null or coalesce((u.mcd->>k)::int, 0) > 0;
    a_cost := public._bt_act_cost(k);
    continue when u.tp + 1e-9 < a_cost + p_reserve;
    a_rng := coalesce((a->>'rng')::int, 1);
    a_dmg := coalesce((a->>'dmg')::numeric, 0);
    select * into t from public.battle_units e
     where e.battle_id = p_battle and e.alive and e.side <> u.side
       and e.id = any(seen)
       and public._bt_dist(u.x, u.y, e.x, e.y)
           between (case when k = 'salvo' then 2 else 1 end) and a_rng
       and public._bt_los_clear(b.terrain, u.x, u.y, e.x, e.y)
     order by
       case when k in ('wbreak','disrupt','tartarus')
            then (e.dmg * (1 + coalesce(jsonb_array_length(e.acts),0)))
            else 0 end desc,
       (a_dmg >= e.hp + e.shield) desc,
       (e.hp + e.shield) asc
     limit 1;
    if t.id is not null then
      -- глушить того, кому нечем ответить, смысла нет
      if k not in ('wbreak','disrupt','tartarus')
         or coalesce(t.dmg,0) > 0 or coalesce(jsonb_array_length(t.acts),0) > 0 then
        return jsonb_build_object('k', k, 't', t.id);
      end if;
    end if;
  end loop;

  -- ── 6.6 ТЯГОВЫЙ ЛУЧ: выдернуть дальнобойного из его полосы ─────────
  a := public._bt_act(u.acts, 'tractor');
  if a is not null and coalesce((u.mcd->>'tractor')::int,0) = 0
     and u.tp + 1e-9 >= public._bt_act_cost('tractor') + p_reserve then
    a_rng := coalesce((a->>'rng')::int, 1);
    select * into t from public.battle_units e
     where e.battle_id = p_battle and e.alive and e.side <> u.side
       and e.id = any(seen)
       and public._bt_dist(u.x, u.y, e.x, e.y) between 2 and a_rng
       and e.rng > u.rng                                   -- он бьёт дальше нас
     order by e.dmg desc limit 1;
    if t.id is not null then return jsonb_build_object('k','tractor','t',t.id); end if;
  end if;

  -- ── 6.7 РЕМОНТ И БАФФЫ ────────────────────────────────────────────
  a := public._bt_act(u.acts, 'drones');
  if a is not null and coalesce((u.mcd->>'drones')::int,0) = 0
     and u.tp + 1e-9 >= public._bt_act_cost('drones') + p_reserve then
    a_val := coalesce((a->>'val')::numeric, 0);
    a_rng := coalesce((a->>'rng')::int, 1);
    select * into t from public.battle_units f
     where f.battle_id = p_battle and f.alive and f.side = u.side
       and f.max_hp - f.hp >= a_val * 0.6
       and public._bt_dist(u.x, u.y, f.x, f.y) <= a_rng
     order by (f.max_hp - f.hp) desc limit 1;
    if t.id is not null then return jsonb_build_object('k','drones','t',t.id); end if;
  end if;

  foreach k in array array['pboost','aboost','pdup'] loop
    a := public._bt_act(u.acts, k);
    continue when a is null or coalesce((u.mcd->>k)::int, 0) > 0;
    continue when u.tp + 1e-9 < public._bt_act_cost(k) + p_reserve;
    a_rng := coalesce((a->>'rng')::int, 1);
    select count(*) into cnt from public.battle_units f
     where f.battle_id = p_battle and f.alive and f.side = u.side
       and public._bt_dist(f.x, f.y, u.x, u.y) <= a_rng;
    -- импульс имеет смысл на группе и когда до неё уже дотягиваются
    if cnt >= 3 and near <= 8 then return jsonb_build_object('k', k); end if;
  end loop;

  a := public._bt_act(u.acts, 'wboost');
  if a is not null and coalesce((u.mcd->>'wboost')::int,0) = 0
     and u.tp + 1e-9 >= public._bt_act_cost('wboost') + p_reserve then
    a_rng := coalesce((a->>'rng')::int, 1);
    select * into t from public.battle_units f
     where f.battle_id = p_battle and f.alive and f.side = u.side and f.id <> u.id
       and not f.fired and f.dmg > u.dmg
       and public._bt_dist(u.x, u.y, f.x, f.y) <= a_rng
     order by f.dmg desc limit 1;
    if t.id is not null then return jsonb_build_object('k','wboost','t',t.id); end if;
  end if;

  -- ── 6.8 ОБОРОНА ───────────────────────────────────────────────────
  a := public._bt_act(u.acts, 'hard');
  if a is not null and coalesce((u.mcd->>'hard')::int,0) = 0
     and u.tp + 1e-9 >= public._bt_act_cost('hard') + p_reserve
     and coalesce(u.hard,0) = 0
     and nallies >= 1 and near <= 6 and hpq > 0.4 then
    return jsonb_build_object('k','hard');            -- «Эгида»: увести залпы на себя
  end if;

  a := public._bt_act(u.acts, 'cloak');
  if a is not null and coalesce((u.mcd->>'cloak')::int,0) = 0
     and u.tp + 1e-9 >= public._bt_act_cost('cloak') + p_reserve
     and coalesce(u.cloak,0) = 0 and hpq < 0.5 and near <= 8
     and public._bt_terra(b.terrain, u.x, u.y) is distinct from 'neb' then
    return jsonb_build_object('k','cloak');
  end if;

  -- ── 6.9 РАЗГОН ЗАЛПА ──────────────────────────────────────────────
  -- Только если этим ходом действительно есть по кому стрелять.
  if not u.fired and public._bt_bot_target(p_battle, p_unit) is not null then
    a := public._bt_act(u.acts, 'amp');
    if a is not null and coalesce((u.mcd->>'amp')::int,0) = 0 and coalesce(u.amp,0) = 0
       and u.tp + 1e-9 >= public._bt_act_cost('amp') + p_reserve then
      return jsonb_build_object('k','amp');
    end if;
    a := public._bt_act(u.acts, 'rapid');
    if a is not null and coalesce((u.mcd->>'rapid')::int,0) = 0 and not coalesce(u.rapid,false)
       and u.tp + 1e-9 >= public._bt_act_cost('rapid') + p_reserve * 0.5 then
      return jsonb_build_object('k','rapid');          -- вдвое дешевле залп — вдвое больше залпов
    end if;
    a := public._bt_act(u.acts, 'sammo');
    if a is not null and coalesce((u.mcd->>'sammo')::int,0) = 0 and not coalesce(u.sammo,false)
       and u.tp + 1e-9 >= public._bt_act_cost('sammo') + p_reserve then
      return jsonb_build_object('k','sammo');
    end if;
  end if;

  -- ── 6.10 ХОЗЯЙСТВО: секунды и перезарядки ─────────────────────────
  a := public._bt_act(u.acts, 'energy');
  if a is not null and coalesce((u.mcd->>'energy')::int,0) = 0
     and u.tp < public._bt_tp_max() * 0.5 and near <= 12 then
    return jsonb_build_object('k','energy');
  end if;

  a := public._bt_act(u.acts, 'reboot');
  if a is not null and coalesce((u.mcd->>'reboot')::int,0) = 0
     and u.tp + 1e-9 >= public._bt_act_cost('reboot') + p_reserve and near <= 10
     and (select count(*) from jsonb_each_text(coalesce(u.mcd,'{}'::jsonb)) e(kk, vv)
           where kk <> 'reboot' and vv::int >= 2) >= 2 then
    return jsonb_build_object('k','reboot');
  end if;

  return null;
end$fn$;
revoke all on function public._bt_bot_module(uuid,uuid,numeric) from public;

-- ── 7. ХОД ОДНОГО БОРТА ─────────────────────────────────────────────
-- Один борт = одна активация, но внутри неё он тратит ВЕСЬ пул секунд:
-- модули → манёвр → залп → добор модулями. Порядок не случайный: разгон
-- контура должен лечь до залпа, а лечение и «Эгида» — после манёвра, когда
-- уже видно, кто где встал.
create or replace function public._bt_bot_act(p_battle uuid, p_unit uuid, p_fid text)
returns boolean language plpgsql security definer set search_path=public as $fn$
declare u record; role text; band int; mode text; did boolean := false;
        m jsonb; tgt uuid; path jsonb; reserve numeric; i int; hpq numeric;
        near int; threat numeric;
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null or not u.alive then return false; end if;

  role := public._bt_bot_role(p_battle, p_unit);
  band := public._bt_bot_band(p_battle, p_unit);
  hpq  := coalesce(u.hp,0) / greatest(1, coalesce(u.max_hp,1));
  select coalesce(min(public._bt_dist(u.x, u.y, e.x, e.y)), 999) into near
    from public.battle_units e
   where e.battle_id = p_battle and e.alive and e.side <> u.side;
  threat := public._bt_threat_at(p_battle, u.side, u.x, u.y, false);

  -- ОТСТУПЛЕНИЕ: борт на последних процентах под сосредоточенным огнём
  -- уходит, а не размениается — уцелевший корпус ещё повоюет следующим ходом.
  if hpq < 0.35 and threat > (u.hp + u.shield) * 0.5 then
    mode := 'back'; band := greatest(band, public._bt_bot_reach(p_unit) + 3);
  elsif role = 'brawler' then
    mode := 'close';
  elsif near > band + 2 then
    mode := 'close';                      -- ещё далеко: сокращаем по потоку
  else
    mode := 'stand';                      -- на рубеже: держим и правим позицию
  end if;

  -- секунды под главный залп резервируем заранее
  reserve := case when not u.fired and public._bt_bot_target(p_battle, p_unit) is not null
                  then public._bt_fire_cost(u.cls) else 0 end;

  -- 7.1 предманёвренные модули (спасение, накрытие, разгон)
  for i in 1..2 loop
    m := public._bt_bot_module(p_battle, p_unit, reserve);
    exit when m is null;
    begin
      perform public._bt_do_module(p_battle, p_unit, m->>'k',
                nullif(m->>'t','')::uuid, (m->>'x')::int, (m->>'y')::int, p_fid);
      did := true;
    exception when others then exit; end;
  end loop;

  -- 7.2 манёвр
  select * into u from public.battle_units where id = p_unit;
  if u.alive and not u.moved then
    path := public._bt_bot_route(p_battle, p_unit, mode, band);
    if coalesce(jsonb_array_length(path), 0) > 0 then
      begin
        perform public._bt_do_move(p_battle, p_unit, path, p_fid);
        did := true;
        perform public._bt_seen_arm(p_battle, u.side);
      exception when others then null; end;
    end if;
  end if;

  -- 7.3 залп
  tgt := public._bt_bot_target(p_battle, p_unit);
  if tgt is not null then
    begin perform public._bt_do_fire(p_battle, p_unit, tgt, p_fid); did := true;
    exception when others then null; end;
  else
    -- ремонтник латает своих, если стрелять не по кому
    tgt := public._bt_bot_repair(p_battle, p_unit);
    if tgt is not null then
      begin perform public._bt_do_fire(p_battle, p_unit, tgt, p_fid); did := true;
      exception when others then null; end;
    end if;
  end if;

  -- 7.4 остаток секунд — в модули
  for i in 1..3 loop
    m := public._bt_bot_module(p_battle, p_unit, 0);
    exit when m is null;
    begin
      perform public._bt_do_module(p_battle, p_unit, m->>'k',
                nullif(m->>'t','')::uuid, (m->>'x')::int, (m->>'y')::int, p_fid);
      did := true;
    exception when others then exit; end;
  end loop;

  -- 7.5 авиакрыло поднимаем, когда есть кому его встретить
  select * into u from public.battle_units where id = p_unit;
  if u.alive and coalesce(u.wings,0) > 0 and not u.is_wing and near <= 10 then
    begin perform public._bt_do_launch(p_battle, p_unit, p_fid); did := true;
    exception when others then null; end;
  end if;

  return did;
end$fn$;
revoke all on function public._bt_bot_act(uuid,uuid,text) from public;

-- ── 8. ХОД СТОРОНЫ ──────────────────────────────────────────────────
-- Активаций за ход столько же, сколько у живой стороны, поэтому важно, КОГО
-- активировать: сперва тех, кто прямо сейчас кого-то добивает, затем тех, у
-- кого есть цель или готовый модуль, и лишь потом идущих на сближение.
create or replace function public._bt_bot_turn(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare bot text := public._bt_bot_fid(); botside text;
        b record; pick uuid; skip uuid[] := '{}'; guard int := 0;
        st text; acts int; did boolean;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status <> 'active' then return; end if;
  perform public._bt_arm(p_battle);
  botside := b.side_to_move;
  if (botside = 'attacker' and b.attacker_fid <> bot)
     or (botside = 'defender' and b.defender_fid <> bot) then
    return;
  end if;

  -- поле потока и карту угрозы строим ОДИН раз: за наш ход враг с места не сходит
  perform public._bt_flow_build(p_battle, botside);
  perform public._bt_risk_build(p_battle, botside);

  loop
    guard := guard + 1;
    exit when guard > 60;
    select status, acts_left into st, acts from public.battles where id = p_battle;
    exit when st <> 'active' or coalesce(acts, 0) <= 0;

    perform public._bt_seen_arm(p_battle, botside);

    -- очередь активации: добивающие → стреляющие → поддержка → сближающиеся
    select bu.id into pick
      from public.battle_units bu
      left join lateral (select public._bt_bot_target(p_battle, bu.id) as tid) tg on true
     where bu.battle_id = p_battle and bu.side = botside and bu.alive
       and not bu.acted and not (bu.id = any(skip))
     order by
       (tg.tid is not null and exists(
          select 1 from public.battle_units z where z.id = tg.tid
            and z.hp + z.shield <= bu.dmg)) desc,          -- этот залп кого-то снимет
       (tg.tid is not null) desc,
       (public._bt_bot_repair(p_battle, bu.id) is not null) desc,
       coalesce((select min(public._bt_dist(bu.x, bu.y, t.x, t.y))
                   from public.battle_units t
                  where t.battle_id = p_battle and t.alive and t.side <> botside), 999) asc,
       bu.id
     limit 1;
    exit when pick is null;

    did := public._bt_bot_act(p_battle, pick, bot);
    if not did then skip := skip || pick; end if;
  end loop;

  delete from public.bt_bot_flow where battle_id = p_battle;
  delete from public.bt_bot_risk where battle_id = p_battle;

  select status into st from public.battles where id = p_battle;
  if st = 'active' then
    begin perform public._bt_do_end_turn(p_battle, bot); exception when others then null; end;
  end if;
end$fn$;
revoke all on function public._bt_bot_turn(uuid) from public;

notify pgrst, 'reload schema';

-- Проверка:
--   select public._bt_flow_build('<battle>', 'defender');   → число клеток поля
--   select public.admin_bot_turn('<battle>');               → в журнале манёвры и модули
