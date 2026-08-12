-- ============================================================
-- 🌱 РОСТКИ ИЗ КАМНЕЙ: ловля даёт посевной материал
-- Выполнить целиком (после _garden.sql и всей цепочки _fishing*.sql).
-- Зеркало клиента — garden.js.
-- ============================================================
-- ?v=20260813sprouts
--
-- ЧТО МЕНЯЕТСЯ.
--
-- 1) СЕЯТЬ «ЧТО УГОДНО ИЗ ЗАЛЕЖЕЙ» БОЛЬШЕ НЕЛЬЗЯ. Раньше garden_plant брал
--    любую породу из _g_seeds(sys): список висел в панели простынёй и ничего
--    не стоил — посев был бесплатным выбором из выпадашки, а ловля камней
--    жила отдельной забавой и ни на что не влияла. Теперь посевной материал
--    один: РОСТОК, и берётся он ТОЛЬКО из пойманного камня. Ловля стала
--    входом в садоводство, а не аттракционом сбоку.
--
-- 2) _g_seeds ВОЗВРАЩАЛ МУСОР. В map_systems planets[].resources лежат
--    ОБЪЕКТЫ ({name,r,icon,amt}), а функция гнала их через
--    jsonb_array_elements_text — в панель падали куски JSON целиком (это и
--    видно на экране: кнопки с «{"r": "common", ...}»). Берём имя и редкость.
--
-- 3) ЛОВЛЯ ПЕРЕЕХАЛА НА СВОИ RPC. fishing_cast/fishing_land остались как
--    были (их зовёт старый берег), а у сада теперь garden_cast/garden_haul:
--    добыча садовая (росток / порода / спора мира / пыль), и результат
--    зависит от того, КАК отыграна мини-игра (p_score 0..1), а не от одного
--    успел/не успел.
-- ============================================================

-- ── Пул пород системы: объекты, а не текст. ──
create or replace function public._g_res_pool(p_sys text)
returns jsonb language plpgsql stable set search_path=public as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'name', btrim(el->>'name'),
           'r',    coalesce(nullif(btrim(el->>'r'),''), 'common'),
           'icon', coalesce(el->>'icon', '◇'))), '[]'::jsonb)
    into v
    from public.map_systems ms,
         jsonb_array_elements(coalesce(ms.planets,'[]'::jsonb)) as t(pl),
         jsonb_array_elements(coalesce(pl->'resources','[]'::jsonb)) as u(el)
   where ms.id = p_sys and nullif(btrim(coalesce(el->>'name','')),'') is not null;
  return coalesce(v, '[]'::jsonb);
end$$;

-- ── Имена пород системы. Теперь это ИМЕНА, а не сырой JSON. ──
create or replace function public._g_seeds(p_sys text)
returns jsonb language plpgsql stable set search_path=public as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(distinct el->>'name'), '[]'::jsonb) into v
    from jsonb_array_elements(public._g_res_pool(p_sys)) as t(el);
  return coalesce(v, '[]'::jsonb);
end$$;

-- ── Редкость породы числом: 0 обычная … 4 легендарная. ──
create or replace function public._g_rar(p_r text)
returns int language sql immutable as $$
  select case lower(coalesce(p_r,'common'))
    when 'legendary' then 4 when 'epic' then 3
    when 'rare' then 2 when 'uncommon' then 1 else 0 end
$$;

-- ══════════════════════════════════════════════════════════════
-- ТРЮМ С РОСТКАМИ
-- ══════════════════════════════════════════════════════════════
create table if not exists public.garden_sprouts (
  faction_id text    not null,
  res        text    not null,
  rar        int     not null default 0,
  icon       text,
  qty        int     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (faction_id, res)
);
alter table public.garden_sprouts enable row level security;
drop policy if exists "gsprout_sel" on public.garden_sprouts;
create policy "gsprout_sel" on public.garden_sprouts for select to authenticated using (true);
revoke insert, update, delete on public.garden_sprouts from public, anon, authenticated;

-- Суточный потолок споры мира из камней.
alter table public.fishing_state
  add column if not exists spore_day int not null default 0;

-- ══════════════════════════════════════════════════════════════
-- ЧТО В КАМНЕ. Решает ТОЛЬКО сервер.
-- Возвращает паспорт добычи: вид, порода, редкость, «жёсткость» для
-- мини-игры. Наград клиенту до вываживания не показываем.
-- ══════════════════════════════════════════════════════════════
create or replace function public._g_rock_roll(p_sys text)
returns jsonb language plpgsql volatile set search_path=public as $$
declare
  v_pool jsonb := public._g_res_pool(p_sys);
  v_n int := jsonb_array_length(coalesce(v_pool,'[]'::jsonb));
  v_rv double precision := random();
  v_el jsonb; v_kind text; v_nm text; v_rar int := 0; v_gc numeric := 0;
  v_res text := null; v_icon text := null; v_hard numeric := 1; v_spore boolean := false;
  v_try int;
begin
  if v_n = 0 then
    return jsonb_build_object('id', gen_random_uuid(), 'kind', 'dust',
      'name', 'Пыль', 'rar', 0, 'hard', 0.8, 'gc', 0);
  end if;

  -- Спора мира: очень редко и не чаще раза в сутки (режется в garden_cast).
  if v_rv < 0.012 then
    v_kind := 'spore'; v_nm := 'Спора мира'; v_rar := 4; v_hard := 1.7;
    v_spore := true; v_gc := 0;

  -- Росток. Основной улов: ради него и ловят.
  elsif v_rv < 0.62 then
    -- Редкую породу вытянуть труднее: тянем пару раз и берём БОЛЕЕ ЧАСТУЮ,
    -- иначе система с одной легендарной залежью раздавала бы её каждым камнем.
    v_el := v_pool->(floor(random()*v_n)::int);
    for v_try in 1..2 loop
      if public._g_rar(v_el->>'r') > 1 and random() < 0.62 then
        v_el := v_pool->(floor(random()*v_n)::int);
      end if;
    end loop;
    v_kind := 'sprout';
    v_res  := v_el->>'name';
    v_icon := v_el->>'icon';
    v_rar  := public._g_rar(v_el->>'r');
    v_nm   := 'Росток: ' || v_res;
    v_hard := 0.9 + v_rar * 0.22;

  -- Порода как есть: сразу в деньги, сеять нечего.
  elsif v_rv < 0.86 then
    v_el := v_pool->(floor(random()*v_n)::int);
    v_kind := 'ore';
    v_res  := v_el->>'name';
    v_icon := v_el->>'icon';
    v_rar  := public._g_rar(v_el->>'r');
    v_nm   := 'Обломок: ' || v_res;
    v_gc   := (300 + v_rar * 900)::numeric;
    v_hard := 0.85 + v_rar * 0.12;

  -- Пыль. Без промахов ловля перестаёт быть ловлей.
  else
    v_kind := 'dust'; v_rar := 0; v_hard := 0.75; v_gc := 0;
    v_nm := (array['Пыль и лёд','Пустая порода','Кусок шлака','Мёрзлая крошка'])
              [1 + floor(random()*4)::int];
  end if;

  return jsonb_build_object(
    'id', gen_random_uuid(), 'kind', v_kind, 'name', v_nm,
    'res', v_res, 'icon', v_icon, 'rar', v_rar,
    'gc', v_gc, 'spore', v_spore, 'hard', round(v_hard, 2), 'sys', p_sys);
end$$;

-- ══════════════════════════════════════════════════════════════
-- БРОСОК СЕТИ: кладём добычу в pending, отдаём параметры мини-игры
-- ══════════════════════════════════════════════════════════════
create or replace function public.garden_cast(p_sys text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.fishing_state; v_sys text; v_rock jsonb; v_spd int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;

  v_sys := coalesce(nullif(btrim(coalesce(p_sys,'')),''), public._g_temple_sys());
  if v_sys is null then raise exception 'нет системы'; end if;
  -- Ловить можно там, где вообще можно копать: свои системы и земля Храма.
  if public._g_land(fid, v_sys) is null then raise exception 'это не ваш небосвод'; end if;

  insert into public.fishing_state(faction_id, owner_id, day, kept, casts)
    values (fid, auth.uid(), current_date, 0, 0)
    on conflict (faction_id) do nothing;
  select * into st from public.fishing_state where faction_id = fid for update;

  if st.last_cast is not null and st.last_cast > now() - interval '1 second' then
    raise exception 'слишком часто: сеть ещё в полёте';
  end if;

  v_rock := public._g_rock_roll(v_sys);

  -- Спора мира — не чаще раза в сутки. Не исчезает: становится породой.
  v_spd := case when st.day < current_date then 0 else coalesce(st.spore_day,0) end;
  if coalesce((v_rock->>'spore')::boolean,false) and v_spd >= 1 then
    v_rock := jsonb_set(v_rock, '{spore}', 'false'::jsonb);
    v_rock := jsonb_set(v_rock, '{kind}',  '"ore"'::jsonb);
    v_rock := jsonb_set(v_rock, '{name}',  '"Слиток пустоты"'::jsonb);
    v_rock := jsonb_set(v_rock, '{gc}',    to_jsonb(2500::numeric));
  end if;

  update public.fishing_state
     set pending = v_rock, last_cast = now(), day = current_date,
         spore_day = v_spd,
         casts = case when st.day < current_date then 1 else coalesce(st.casts,0) + 1 end,
         kept  = case when st.day < current_date then 0 else st.kept end,
         updated_at = now()
   where faction_id = fid;

  -- Что внутри — тайна до вываживания; отдаём только «жёсткость».
  return jsonb_build_object('ok', true,
    'id', v_rock->>'id', 'hard', v_rock->'hard');
end$$;
revoke all on function public.garden_cast(text) from public, anon;
grant execute on function public.garden_cast(text) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- ВЫВАЖИВАНИЕ ОКОНЧЕНО. p_score 0..1 — насколько чисто отыграно.
-- ══════════════════════════════════════════════════════════════
create or replace function public.garden_haul(p_id uuid, p_ok boolean, p_score numeric default 1)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.fishing_state; b jsonb; v_sc numeric; v_qty int; v_gc numeric;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  select * into st from public.fishing_state where faction_id = fid for update;
  if not found or st.pending is null then raise exception 'сеть пуста'; end if;

  b := st.pending;
  if (b->>'id') is distinct from p_id::text then raise exception 'stale hook'; end if;
  v_sc := least(1, greatest(0, coalesce(p_score, 1)));

  if not coalesce(p_ok, false) then
    update public.fishing_state set pending = null, updated_at = now() where faction_id = fid;
    return jsonb_build_object('ok', true, 'lost', true, 'name', b->>'name');
  end if;

  v_qty := 0; v_gc := 0;

  if (b->>'kind') = 'sprout' then
    -- Чем чище отыграно, тем больше ростков снимаешь с одного камня.
    v_qty := greatest(1, floor(1 + v_sc * 2.4)::int);
    insert into public.garden_sprouts (faction_id, res, rar, icon, qty)
    values (fid, b->>'res', coalesce((b->>'rar')::int,0), b->>'icon', v_qty)
    on conflict (faction_id, res) do update
      set qty = public.garden_sprouts.qty + excluded.qty,
          icon = coalesce(excluded.icon, public.garden_sprouts.icon),
          updated_at = now();

  elsif (b->>'kind') = 'spore' then
    insert into public.fishing_state (faction_id, seed) values (fid, 1)
      on conflict (faction_id) do update set seed = coalesce(public.fishing_state.seed,0) + 1;
    update public.fishing_state set spore_day = coalesce(spore_day,0) + 1 where faction_id = fid;

  else
    v_gc := round(coalesce((b->>'gc')::numeric, 0) * (0.45 + 0.55 * v_sc));
    if v_gc > 0 then
      update public.faction_economy set gc = coalesce(gc,0) + v_gc where faction_id = fid;
    end if;
  end if;

  update public.fishing_state
     set pending = null, total = coalesce(total,0) + 1,
         day = current_date, updated_at = now()
   where faction_id = fid;

  return jsonb_build_object('ok', true, 'lost', false,
    'kind', b->>'kind', 'name', b->>'name', 'res', b->>'res',
    'icon', b->>'icon', 'rar', (b->>'rar')::int,
    'qty', v_qty, 'gc', v_gc, 'score', round(v_sc, 2));
end$$;
revoke all on function public.garden_haul(uuid, boolean, numeric) from public, anon;
grant execute on function public.garden_haul(uuid, boolean, numeric) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- ПОСЕВ ТЕПЕРЬ ТРАТИТ РОСТОК
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
    if not found then raise exception 'нет споры мира'; end if;
    v_ripe := public._g_const('ripe_ichor');
    p_res := null;

  elsif p_kind = 'res' then
    if nullif(btrim(coalesce(p_res,'')),'') is null then raise exception 'какой росток сажаем?'; end if;
    -- ⚠️ ЗЕМЛЯ БОЛЬШЕ НЕ РАЗДАЁТ ПОСЕВ. Материал только из трюма: росток
    -- добыт из камня, и второй раз его не посадить.
    update public.garden_sprouts set qty = qty - 1, updated_at = now()
     where faction_id = fid and res = p_res and qty > 0;
    if not found then raise exception 'нет такого ростка в трюме'; end if;
    v_ripe := public._g_const('ripe_res');

  else
    raise exception 'неизвестный посев';
  end if;

  insert into public.garden_plants (plot_id, faction_id, owner_id, kind, res, ripe_at)
  values (g.id, fid, auth.uid(), p_kind, p_res, now() + (v_ripe || ' hours')::interval)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end$$;
grant execute on function public.garden_plant(bigint, text, text) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- СОСТОЯНИЕ: добавили трюм с ростками
-- ══════════════════════════════════════════════════════════════
create or replace function public.garden_get()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_plots jsonb; v_lands jsonb; v_temple text; v_spr jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  v_temple := public._g_temple_sys();

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

  select coalesce(jsonb_agg(jsonb_build_object(
      'sys', s.id, 'name', s.name, 'land', public._g_land(fid, s.id),
      'cells', public._g_cells(s.id), 'seeds', public._g_seeds(s.id))), '[]'::jsonb)
    into v_lands
    from public.map_systems s
   where s.id = v_temple
      or exists (select 1 from public.colonies c
                  where c.system_id = s.id and c.faction_id = fid);

  select coalesce(jsonb_agg(jsonb_build_object(
      'res', gs.res, 'rar', gs.rar, 'icon', gs.icon, 'qty', gs.qty)
      order by gs.rar desc, gs.res), '[]'::jsonb)
    into v_spr
    from public.garden_sprouts gs
   where gs.faction_id = fid and gs.qty > 0;

  return jsonb_build_object(
    'fid', fid, 'temple', v_temple,
    'plots', v_plots, 'lands', v_lands, 'sprouts', v_spr,
    'seed_ichor', coalesce((select seed from public.fishing_state where faction_id = fid), 0),
    'const', jsonb_build_object(
      'till_gc',   public._g_const('till_gc'),
      'feed_gc',   public._g_const('feed_gc'),
      'seed_gc',   public._g_const('seed_ichor_gc'),
      'ichor_cap', public._g_const('ichor_cap'),
      'plot_cap',  public._g_const('plot_cap')));
end$$;
grant execute on function public.garden_get() to authenticated;
