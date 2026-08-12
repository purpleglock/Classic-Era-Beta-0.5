-- ============================================================
-- 🌱 «ПОЙДЁМ К РЕКЕ» — РЕВОРК: САД ВМЕСТО БЕРЕГА
-- Выполнить целиком (после _fishing*.sql). Зеркало клиента — fishing.js.
-- ============================================================
-- ?v=20260812garden
--
-- ЧТО ПРОИСХОДИТ.
--
-- 1) МИРА СБОКУ БОЛЬШЕ НЕТ. Прежний берег был отдельной картинкой в
--    терраристском профиле — он ни к чему в игре не крепился. Теперь земля
--    под ногами — ЭТО КАРТА ГАЛАКТИКИ: система = надел, сектор = край,
--    пустота между секторами = река, края карты = моря. Геометрия целиком
--    клиентская (детерминированная, из map_systems/map_sectors) — серверу
--    нечего про неё знать. Сервер знает только АДРЕС грядки: система + номер
--    лунки. Этого хватает, чтобы всё проверить.
--
-- 2) ЗЕМЛЯ НЕ ВЕЗДЕ. Копать можно в системе, где у державы есть колония,
--    и на земле Храма мироздания (она общая). Сколько лунок даёт система —
--    считает _g_cells(): по числу тел и величине звезды. Больше держава —
--    больше огород, ровно как просили.
--
-- 3) УХОД — ГЛАВНОЕ. У всходов три шкалы: влага, питание, сорняки. Они
--    ходят по РЕАЛЬНОМУ времени. Урожай считается не «созрело/нет», а долей
--    времени, которое растение прожило в норме (care 0..1). Считается
--    ЧЕСТНО, интегралом: шкалы линейны, поэтому мы знаем точный момент, когда
--    растение вышло из нормы, и не гадаем по опросам.
--
-- 4) ИХОР ПЕРЕРАБОТАН. Дерево ихора сажают ТОЛЬКО на земле Храма
--    мироздания. Даёт floor(10 * care) — то есть ровно столько, сколько ты
--    заслужил уходом, и никогда больше 10.
-- ============================================================

-- ── Постоянные места. Одно на всю установку. ──
create or replace function public._g_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'water_h'   then 24      -- за сколько часов полная влага уходит в ноль
    when 'feed_h'    then 48      -- то же для питания
    when 'weed_h'    then 36      -- за сколько часов чистая грядка зарастает целиком
    when 'water_min' then 20      -- ниже — растение мучается
    when 'feed_min'  then 10
    when 'weed_max'  then 60      -- выше — глушат сорняки
    when 'ripe_res'  then 24      -- часов до урожая: порода
    when 'ripe_ichor' then 72     -- ихорное дерево тянется дольше
    when 'ichor_cap' then 10      -- потолок ихора с дерева
    when 'seed_ichor_gc' then 200000   -- цена семечка мира (как было у старика)
    when 'till_gc'   then 2500    -- вскопать лунку
    when 'feed_gc'   then 400     -- мешок удобрения
    when 'plot_cap'  then 24      -- сколько лунок держава может держать всего
    else 0 end::numeric
$$;

create or replace function public._g_temple_sys()
returns text language plpgsql stable set search_path=public as $$
declare v text;
begin
  if to_regclass('public.map_systems') is null then return null; end if;
  select id into v from public.map_systems
   where lower(btrim(name)) = 'храм мироздания' limit 1;
  return v;
end$$;

-- ── Сколько лунок держит система. Детерминированно: клиент раскладывает
-- ровно столько же ромбов вокруг звезды. ──
create or replace function public._g_cells(p_sys text)
returns int language plpgsql stable set search_path=public as $$
declare ms record; n int;
begin
  select * into ms from public.map_systems where id = p_sys;
  if not found then return 0; end if;
  n := 6 + 2 * coalesce(jsonb_array_length(coalesce(ms.planets,'[]'::jsonb)), 0);
  if coalesce(ms.is_giant, false) then n := n + 8; end if;
  return least(n, 48);
end$$;

-- ── Право копать в системе. Возвращает 'own' | 'temple' | null. ──
create or replace function public._g_land(p_fid text, p_sys text)
returns text language plpgsql stable set search_path=public as $$
begin
  if p_sys is null then return null; end if;
  if p_sys = public._g_temple_sys() then return 'temple'; end if;
  if exists (select 1 from public.colonies c
              where c.system_id = p_sys and c.faction_id = p_fid) then return 'own'; end if;
  return null;
end$$;

-- ── Породы, какие в этой системе вообще родятся: то, что лежит в залежах
-- её тел. Сеять «с потолка» нельзя — земля помнит, что в ней есть. ──
create or replace function public._g_seeds(p_sys text)
returns jsonb language plpgsql stable set search_path=public as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(distinct r), '[]'::jsonb) into v
    from public.map_systems ms,
         jsonb_array_elements(coalesce(ms.planets,'[]'::jsonb)) as t(el),
         jsonb_array_elements_text(coalesce(el->'resources','[]'::jsonb)) as u(r)
   where ms.id = p_sys and nullif(btrim(r),'') is not null;
  return coalesce(v, '[]'::jsonb);
end$$;

-- ══════════════════════════════════════════════════════════════
-- ГРЯДКИ И ВСХОДЫ
-- ══════════════════════════════════════════════════════════════
create table if not exists public.garden_plots (
  id         bigserial primary key,
  faction_id text not null,
  owner_id   uuid,
  sys        text not null,
  cell       int  not null,
  land       text not null default 'own',       -- own | temple
  tilled_at  timestamptz not null default now()
);
create unique index if not exists garden_plots_sys_cell on public.garden_plots(sys, cell);
create index if not exists garden_plots_fid on public.garden_plots(faction_id);

create table if not exists public.garden_plants (
  id         bigserial primary key,
  plot_id    bigint not null references public.garden_plots(id) on delete cascade,
  faction_id text not null,
  owner_id   uuid,
  kind       text not null,                     -- res | ichor
  res        text,                              -- имя породы для kind='res'
  planted_at timestamptz not null default now(),
  ripe_at    timestamptz not null,
  water      numeric not null default 100,
  feed       numeric not null default 100,
  weeds      numeric not null default 0,
  ok_sec     numeric not null default 0,        -- секунд прожито в норме
  tot_sec    numeric not null default 0,        -- секунд всего
  last_tick  timestamptz not null default now(),
  dead       boolean not null default false,
  harvested  boolean not null default false
);
create index if not exists garden_plants_plot on public.garden_plants(plot_id);
create unique index if not exists garden_plants_plot_live
  on public.garden_plants(plot_id) where not harvested;

alter table public.garden_plots  enable row level security;
alter table public.garden_plants enable row level security;
-- Сад общий: чужие грядки видно (в этом половина смысла — ходить и смотреть).
drop policy if exists "gplot_sel"  on public.garden_plots;
drop policy if exists "gplant_sel" on public.garden_plants;
create policy "gplot_sel"  on public.garden_plots  for select to authenticated using (true);
create policy "gplant_sel" on public.garden_plants for select to authenticated using (true);
revoke insert, update, delete on public.garden_plots  from public, anon, authenticated;
revoke insert, update, delete on public.garden_plants from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════
-- ТИК УХОДА. Точный, а не по опросам.
--
-- Шкалы линейны, значит момент выхода из нормы вычисляется, а не угадывается:
--   влага падает   → выйдет из нормы через (water - water_min) / rate_w часов
--   питание падает → (feed - feed_min) / rate_f
--   сорняки растут → (weed_max - weeds) / rate_g
-- Раньше всех — тот и обрывает «хорошее» время. Остальное время идёт в брак.
-- Так игрок, заходящий раз в сутки, теряет часть урожая, но не всё.
-- ══════════════════════════════════════════════════════════════
create or replace function public._g_tick(p_id bigint)
returns public.garden_plants language plpgsql volatile set search_path=public as $$
declare p public.garden_plants;
        v_now timestamptz; v_end timestamptz; v_h numeric;
        rw numeric; rf numeric; rg numeric; t_ok numeric;
begin
  select * into p from public.garden_plants where id = p_id for update;
  if not found then return null; end if;
  if p.harvested then return p; end if;

  v_now := now();
  -- После созревания время не копится: перестоявшее не портится, но и
  -- «отсидеться» до идеального ухода нельзя.
  v_end := least(v_now, p.ripe_at);
  v_h := extract(epoch from (v_end - p.last_tick)) / 3600.0;
  if v_h <= 0 then return p; end if;

  rw := 100.0 / public._g_const('water_h');
  rf := 100.0 / public._g_const('feed_h');
  rg := 100.0 / public._g_const('weed_h');

  t_ok := least(
    greatest((p.water - public._g_const('water_min')) / rw, 0),
    greatest((p.feed  - public._g_const('feed_min'))  / rf, 0),
    greatest((public._g_const('weed_max') - p.weeds)  / rg, 0));
  t_ok := least(t_ok, v_h);

  update public.garden_plants set
    water     = greatest(0,   p.water - rw * v_h),
    feed      = greatest(0,   p.feed  - rf * v_h),
    weeds     = least(100,    p.weeds + rg * v_h),
    ok_sec    = p.ok_sec  + t_ok * 3600.0,
    tot_sec   = p.tot_sec + v_h  * 3600.0,
    last_tick = v_end
  where id = p_id
  returning * into p;
  return p;
end$$;

create or replace function public._g_care(p public.garden_plants)
returns numeric language sql immutable as $$
  select case when coalesce(p.tot_sec,0) <= 0 then 1
              else greatest(0, least(1, p.ok_sec / p.tot_sec)) end
$$;

-- ══════════════════════════════════════════════════════════════
-- ЧТО ВИДНО ИГРОКУ
-- ══════════════════════════════════════════════════════════════
create or replace function public.garden_get()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_plots jsonb; v_lands jsonb; v_temple text;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  v_temple := public._g_temple_sys();

  -- Тикаем СВОИ всходы: чужие пусть тикают их хозяева, иначе один заход в сад
  -- перебирал бы всю галактику.
  perform public._g_tick(pl.id)
     from public.garden_plants pl
    where pl.faction_id = fid and not pl.harvested;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'sys', g.sys, 'cell', g.cell, 'land', g.land,
      'fid', g.faction_id, 'mine', (g.faction_id = fid),
      'plant', case when p.id is null then null else jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'res', p.res,
        'water', round(p.water), 'feed', round(p.feed), 'weeds', round(p.weeds),
        'care',  round(public._g_care(p), 3),
        'ripe',  (now() >= p.ripe_at),
        'left',  greatest(0, floor(extract(epoch from (p.ripe_at - now()))))::int)
      end)), '[]'::jsonb) into v_plots
    from public.garden_plots g
    left join public.garden_plants p on p.plot_id = g.id and not p.harvested;

  -- Где мне можно копать и что там растёт.
  select coalesce(jsonb_agg(jsonb_build_object(
      'sys', s.id, 'name', s.name, 'land', public._g_land(fid, s.id),
      'cells', public._g_cells(s.id), 'seeds', public._g_seeds(s.id))), '[]'::jsonb)
    into v_lands
    from public.map_systems s
   where s.id = v_temple
      or exists (select 1 from public.colonies c
                  where c.system_id = s.id and c.faction_id = fid);

  return jsonb_build_object(
    'fid', fid, 'temple', v_temple,
    'plots', v_plots, 'lands', v_lands,
    'seed_ichor', coalesce((select seed from public.fishing_state where faction_id = fid), 0),
    'const', jsonb_build_object(
      'till_gc',   public._g_const('till_gc'),
      'feed_gc',   public._g_const('feed_gc'),
      'seed_gc',   public._g_const('seed_ichor_gc'),
      'ichor_cap', public._g_const('ichor_cap'),
      'plot_cap',  public._g_const('plot_cap')));
end$$;

-- ══════════════════════════════════════════════════════════════
-- ВСКОПАТЬ ЛУНКУ
-- ══════════════════════════════════════════════════════════════
create or replace function public.garden_till(p_sys text, p_cell int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_land text; v_cap int; v_have int; v_gc numeric; v_id bigint;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;

  v_land := public._g_land(fid, p_sys);
  if v_land is null then raise exception 'эта земля не ваша'; end if;

  v_cap := public._g_cells(p_sys);
  if p_cell is null or p_cell < 0 or p_cell >= v_cap then raise exception 'нет такой лунки'; end if;

  select count(*) into v_have from public.garden_plots where faction_id = fid;
  if v_have >= public._g_const('plot_cap') then raise exception 'больше грядок не потянуть'; end if;

  v_gc := public._g_const('till_gc');
  update public.faction_economy set gc = gc - v_gc
   where faction_id = fid and coalesce(gc,0) >= v_gc;
  if not found then raise exception 'не хватает ГС'; end if;

  begin
    insert into public.garden_plots (faction_id, owner_id, sys, cell, land)
    values (fid, auth.uid(), p_sys, p_cell, v_land)
    returning id into v_id;
  exception when unique_violation then
    update public.faction_economy set gc = gc + v_gc where faction_id = fid;
    raise exception 'лунка уже занята';
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end$$;

-- ══════════════════════════════════════════════════════════════
-- ПОСЕВ. kind='res' — порода из залежей ЭТОЙ системы;
--        kind='ichor' — только земля Храма и только за семечко мира.
-- ══════════════════════════════════════════════════════════════
create or replace function public.garden_plant(p_plot bigint, p_kind text, p_res text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; g public.garden_plots; v_ripe numeric; v_id bigint;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;

  select * into g from public.garden_plots where id = p_plot for update;
  if not found then raise exception 'нет грядки'; end if;
  if g.faction_id <> fid then raise exception 'грядка не ваша'; end if;
  if exists (select 1 from public.garden_plants where plot_id = g.id and not harvested)
    then raise exception 'тут уже растёт'; end if;

  if p_kind = 'ichor' then
    if g.land <> 'temple' then raise exception 'ихор родится только на земле Храма мироздания'; end if;
    update public.fishing_state set seed = seed - 1
     where faction_id = fid and coalesce(seed,0) > 0;
    if not found then raise exception 'нет семечка мира'; end if;
    v_ripe := public._g_const('ripe_ichor');
    p_res := null;

  elsif p_kind = 'res' then
    if nullif(btrim(coalesce(p_res,'')),'') is null then raise exception 'какую породу сеем?'; end if;
    if not (public._g_seeds(g.sys) ? p_res) then
      raise exception 'в этой земле такого не родится';
    end if;
    v_ripe := public._g_const('ripe_res');

  else
    raise exception 'неизвестный посев';
  end if;

  insert into public.garden_plants (plot_id, faction_id, owner_id, kind, res, ripe_at)
  values (g.id, fid, auth.uid(), p_kind, p_res, now() + (v_ripe || ' hours')::interval)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end$$;

-- ══════════════════════════════════════════════════════════════
-- УХОД: полить / удобрить / прополоть. Работа руками — своя грядка.
-- ══════════════════════════════════════════════════════════════
create or replace function public.garden_care(p_plant bigint, p_act text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; p public.garden_plants; v_gc numeric;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;

  select * into p from public.garden_plants where id = p_plant;
  if not found or p.harvested then raise exception 'нечего трогать'; end if;
  if p.faction_id <> fid then raise exception 'это не ваши всходы'; end if;

  p := public._g_tick(p_plant);           -- сперва досчитываем прошлое, потом правим

  if p_act = 'water' then
    update public.garden_plants set water = 100 where id = p_plant;
  elsif p_act = 'weed' then
    update public.garden_plants set weeds = 0 where id = p_plant;
  elsif p_act = 'feed' then
    v_gc := public._g_const('feed_gc');
    update public.faction_economy set gc = gc - v_gc
     where faction_id = fid and coalesce(gc,0) >= v_gc;
    if not found then raise exception 'не хватает ГС на удобрение'; end if;
    update public.garden_plants set feed = 100 where id = p_plant;
  else
    raise exception 'неизвестное действие';
  end if;

  select * into p from public.garden_plants where id = p_plant;
  return jsonb_build_object('ok', true, 'act', p_act,
    'water', round(p.water), 'feed', round(p.feed), 'weeds', round(p.weeds),
    'care', round(public._g_care(p), 3));
end$$;

-- ══════════════════════════════════════════════════════════════
-- УРОЖАЙ. Всё решает care.
--   порода — 1..12 единиц, где 1 это «росло само по себе»;
--   ихор   — floor(10 * care), и ни грамма больше десяти.
-- ══════════════════════════════════════════════════════════════
create or replace function public.garden_harvest(p_plant bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; p public.garden_plants; v_care numeric; v_amt numeric; v_nm text;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;

  select * into p from public.garden_plants where id = p_plant;
  if not found or p.harvested then raise exception 'нечего собирать'; end if;
  if p.faction_id <> fid then raise exception 'это не ваши всходы'; end if;
  if now() < p.ripe_at then raise exception 'ещё не созрело'; end if;

  p := public._g_tick(p_plant);
  v_care := public._g_care(p);

  if p.kind = 'ichor' then
    v_nm := 'Ихор';
    v_amt := floor(public._g_const('ichor_cap') * v_care);
  else
    v_nm := p.res;
    v_amt := floor(1 + 11 * v_care);
  end if;

  if v_amt > 0 then perform public._pc_res_add(fid, v_nm, v_amt); end if;

  update public.garden_plants set harvested = true where id = p_plant;

  return jsonb_build_object('ok', true, 'name', v_nm, 'amount', v_amt,
    'care', round(v_care, 3), 'kind', p.kind);
end$$;

-- ── Выкорчевать: лунка освобождается, урожая нет. ──
create or replace function public.garden_clear(p_plant bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  update public.garden_plants set harvested = true, dead = true
   where id = p_plant and faction_id = fid and not harvested;
  if not found then raise exception 'нечего корчевать'; end if;
  return jsonb_build_object('ok', true);
end$$;

-- ── Семечко мира: по-прежнему за 200 000 ГС, но сажают его теперь только
-- у Храма и отдаёт оно ровно по труду. ──
create or replace function public.garden_seed_buy()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_gc numeric;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  v_gc := public._g_const('seed_ichor_gc');
  update public.faction_economy set gc = gc - v_gc
   where faction_id = fid and coalesce(gc,0) >= v_gc;
  if not found then raise exception 'не хватает ГС'; end if;
  insert into public.fishing_state (faction_id, seed) values (fid, 1)
    on conflict (faction_id) do update set seed = public.fishing_state.seed + 1;
  return jsonb_build_object('ok', true);
end$$;

grant execute on function public.garden_get()                       to authenticated;
grant execute on function public.garden_till(text, int)             to authenticated;
grant execute on function public.garden_plant(bigint, text, text)   to authenticated;
grant execute on function public.garden_care(bigint, text)          to authenticated;
grant execute on function public.garden_harvest(bigint)             to authenticated;
grant execute on function public.garden_clear(bigint)               to authenticated;
grant execute on function public.garden_seed_buy()                  to authenticated;
revoke all on function public._g_tick(bigint) from public, anon, authenticated;
