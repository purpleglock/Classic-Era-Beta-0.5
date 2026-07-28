-- ============================================================
-- 🎣 «ПОЙДЁМ К РЕКЕ» — правка берега (после _fishing.sql + _fishing_temple.sql)
-- ============================================================
-- Три вещи разом:
--
-- 1) НАГРАДЫ ЧЕСТНЫЕ. Раньше улов сыпал ТНП и «ОН» — ТНП как ресурса в
--    производстве нет, это была выдумка одного экрана. Теперь платят только
--    тем, что в игре действительно ходит:
--      ГС              — деньги;
--      ресурс          — настоящая порода из залежей ТЕЛА, в faction_economy.resources;
--      осколок цикла   — cycle_shards (как у Разлома; нет колонки — молча пропускаем);
--      артефакт        — редко, через _spy_artifact_grant.
--    Суммы небольшие: это не заработок, а повод посидеть у воды.
--
-- 2) РЫБАЛКА ПРОЩЕ. Вываживания больше нет. Клюнуло — успей подсечь, и улов
--    твой. Сервер отдаёт окно подсечки (react, секунды) вместо «сложности»:
--    чем крупнее добыча, тем короче окно.
--
-- 3) ТОТ БЕРЕГ. Через реку — поляна, на ней сидит старик. За 200 000 ГС он
--    продаёт «семечко мира»; посаженное на поляне, оно всходит СУТКИ, после
--    чего с него забирают 10 ихора. Одно семечко в рост на державу.
--
-- Зеркало клиента — fishing.js.
-- ============================================================

-- ── Семечко в руках игрока ──
alter table public.fishing_state
  add column if not exists seed int not null default 0;

-- ── Саженцы на поляне. Место общее: чужие деревья тоже видно. ──
create table if not exists public.fishing_plants (
  id         bigserial primary key,
  faction_id text not null,
  owner_id   uuid,
  x          int  not null,                       -- колонка поляны (тайл)
  planted_at timestamptz not null default now(),
  taken      boolean not null default false
);
alter table public.fishing_plants enable row level security;
-- Читают все: поляна одна на галактику, и чужие всходы — часть места.
drop policy if exists "fplant_sel" on public.fishing_plants;
create policy "fplant_sel" on public.fishing_plants for select to authenticated using (true);
revoke insert, update, delete on public.fishing_plants from public, anon, authenticated;
-- В одну лунку — одно дерево.
create unique index if not exists fishing_plants_x_live
  on public.fishing_plants(x) where not taken;

create or replace function public._fishing_seed_price()
returns numeric language sql immutable as $$ select 200000::numeric $$;
create or replace function public._fishing_seed_ichor()
returns numeric language sql immutable as $$ select 10::numeric $$;
create or replace function public._fishing_grow()
returns interval language sql immutable as $$ select interval '24 hours' $$;

-- ══════════════════════════════════════════════════════════════
-- БРОСОК: что клюнуло. Решает ТОЛЬКО сервер.
-- Награда описана прямо в добыче: gc / res+res_n / shard / art.
-- react — окно подсечки в секундах (клиент его отыгрывает).
-- ══════════════════════════════════════════════════════════════
create or replace function public._fishing_roll(p_site jsonb, p_depth int, p_night boolean)
returns jsonb language plpgsql volatile set search_path=public as $$
declare
  v_res   jsonb := coalesce(p_site->'res', '[]'::jsonb);
  v_dep   jsonb;
  v_rv    double precision;
  v_deep  boolean := coalesce(p_depth,0) >= 18;
  v_abyss boolean := coalesce(p_depth,0) >= 38;
  v_night boolean := coalesce(p_night,false);
  v_nm text; v_kind text; v_rar int; v_gc numeric := 0;
  v_rn text := null; v_rq numeric := 0; v_shard boolean := false;
  v_art boolean := false; v_react numeric := 1.1; v_kg numeric := null;
begin
  v_rv := random();

  -- Легенда: только глубоко и только ночью, и всё равно редко.
  if v_abyss and v_night and v_rv < 0.004 then
    v_nm := 'Сердце реки'; v_kind := 'legend'; v_rar := 4;
    v_gc := 3000; v_shard := true; v_react := 0.65;

  -- Реликвия → настоящий артефакт разведки.
  elsif v_deep and v_rv < 0.008 then
    v_nm := 'Реликвия со дна'; v_kind := 'relic'; v_rar := 3;
    v_art := true; v_gc := 300; v_react := 0.8;

  -- Обломки кораблей: чем глубже, тем чаще и жирнее. Самый глубокий — с осколком.
  elsif v_rv < (case when v_abyss then 0.20 when v_deep then 0.14 else 0.06 end) then
    if v_abyss and random() < 0.35 then
      v_nm := 'Капсула чёрного ящика'; v_rar := 3; v_gc := 900; v_shard := true; v_react := 0.85;
    elsif v_deep and random() < 0.4 then
      v_nm := 'Кольцо рулевого'; v_rar := 2; v_gc := 700; v_react := 0.95;
    else
      v_nm := 'Обломок обшивки'; v_rar := 2; v_gc := 400; v_react := 1.0;
    end if;
    v_kind := 'wreck';

  -- Донная находка: настоящая порода из залежей тела, её и кладём на склад.
  elsif v_rv < (case when v_deep then 0.34 else 0.24 end)
        and jsonb_typeof(v_res) = 'array' and jsonb_array_length(v_res) > 0 then
    select v_res->(floor(random()*jsonb_array_length(v_res))::int) into v_dep;
    v_rn := nullif(btrim(coalesce(v_dep->>'name','')), '');
    v_kind := 'ore';
    v_rar := case coalesce(v_dep->>'r','common')
               when 'legendary' then 4 when 'epic' then 3 when 'rare' then 2
               when 'uncommon' then 1 else 0 end;
    v_rar := greatest(v_rar, case when v_abyss then 2 when v_deep then 1 else 0 end);
    -- Чем реже порода, тем меньше её в иле. Это горсть со дна, а не шахта.
    v_rq := case v_rar when 4 then 1 when 3 then 1 when 2 then 2 when 1 then 3 else 5 end;
    if v_rn is null then                     -- залежей нет — поднялся просто ил
      v_nm := 'Ком донного ила'; v_kind := 'junk'; v_rar := 0; v_rq := 0;
    else
      v_nm := 'Ил с вкраплениями: ' || v_rn;
    end if;
    v_react := 1.15;

  -- Хлам — обязателен, иначе рыбалка перестаёт быть рыбалкой.
  elsif v_rv < (case when v_deep then 0.44 else 0.40 end) then
    v_nm := (array['Ржавая банка','Пучок водорослей','Старый сапог','Мокрая ветка','Ком донного ила'])
              [1 + floor(random()*5)::int];
    v_kind := 'junk'; v_rar := 0; v_react := 1.3;

  -- Рыба. Платят за неё немного и только деньгами.
  else
    v_kind := 'fish';
    if v_night and random() < 0.45 then
      if v_abyss then v_nm := 'Стеклянный угорь'; v_rar := 3; v_react := 0.8;
      else v_nm := 'Лунная форель'; v_rar := 2; v_react := 0.95; end if;
    elsif v_deep and random() < 0.45 then
      if random() < 0.4 then v_nm := 'Сом'; v_rar := 2; v_react := 0.9;
      else v_nm := 'Зеркальный карп'; v_rar := 2; v_react := 1.0; end if;
    else
      v_nm := (array['Плотва','Окунь','Карась','Линь'])[1 + floor(random()*4)::int];
      v_rar := 1; v_react := 1.2;
    end if;
    v_kg := round((0.2 + random() * (1.5 + v_rar * 2.2))::numeric, 2);
    v_gc := round(40 + v_rar * 60 + v_kg * 30, 0);
  end if;

  return jsonb_build_object(
    'id',   gen_random_uuid(),
    'name', v_nm, 'kind', v_kind, 'rar', v_rar, 'kg', v_kg,
    'gc',   v_gc, 'res', v_rn, 'res_n', v_rq, 'shard', v_shard, 'art', v_art,
    'react', v_react, 'depth', coalesce(p_depth,0), 'night', v_night);
end$$;

-- ══════════════════════════════════════════════════════════════
-- ЗАБРОС: как было, но клиенту уезжает окно подсечки вместо «сложности»
-- ══════════════════════════════════════════════════════════════
create or replace function public.fishing_cast(p_depth int default 0)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.fishing_state; v_site jsonb; v_depth int; v_bite jsonb; v_kept int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;

  v_site := public._fishing_site();
  if v_site is null then raise exception 'no site: реки нет на карте'; end if;
  if not coalesce((v_site->>'wet')::boolean, false) then
    raise exception 'no water: воды больше нет';
  end if;

  v_depth := least(greatest(coalesce(p_depth,0), 0), (v_site->>'maxdepth')::int);

  insert into public.fishing_state(faction_id, owner_id, day, kept, casts)
    values (fid, auth.uid(), current_date, 0, 0)
    on conflict (faction_id) do nothing;
  select * into st from public.fishing_state where faction_id = fid for update;

  if st.last_cast is not null and st.last_cast > now() - interval '2 seconds' then
    raise exception 'too fast: дай воде успокоиться';
  end if;

  v_kept := case when st.day < current_date then 0 else st.kept end;
  v_bite := public._fishing_roll(v_site, v_depth, public._fishing_night());

  update public.fishing_state
     set pending = v_bite, last_cast = now(), day = current_date,
         kept = v_kept, casts = case when st.day < current_date then 1 else st.casts + 1 end,
         updated_at = now()
   where faction_id = fid;

  -- Что клюнуло — тайна до подсечки: иначе видно, стоит ли дёргать.
  return jsonb_build_object('ok', true,
    'bite', jsonb_build_object('id', v_bite->>'id', 'react', v_bite->'react'),
    'kept', v_kept, 'cap', public._fishing_cap(), 'depth', v_depth,
    'night', public._fishing_night());
end$$;
revoke all on function public.fishing_cast(int) from public, anon;
grant execute on function public.fishing_cast(int) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- ПОДСЕЧКА: p_ok = успел / прозевал
-- ══════════════════════════════════════════════════════════════
create or replace function public.fishing_land(p_id uuid, p_ok boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.fishing_state; b jsonb;
        v_kept int; v_cap int; v_counts boolean; v_art jsonb; v_nm text; v_best jsonb;
        v_shard text; v_classes text[];
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  select * into st from public.fishing_state where faction_id = fid for update;
  if not found or st.pending is null then raise exception 'nothing on the hook'; end if;

  b := st.pending;
  if (b->>'id') is distinct from p_id::text then raise exception 'stale hook'; end if;

  if not coalesce(p_ok,false) then
    update public.fishing_state set pending = null, updated_at = now() where faction_id = fid;
    return jsonb_build_object('ok', true, 'lost', true,
      'name', b->>'name', 'rar', (b->>'rar')::int, 'kind', b->>'kind');
  end if;

  v_cap  := public._fishing_cap();
  v_kept := case when st.day < current_date then 0 else st.kept end;
  v_counts := v_kept < v_cap;    -- сверх садка ловим «для души»: без наград

  if v_counts then
    if coalesce((b->>'gc')::numeric, 0) > 0 then
      update public.faction_economy set gc = coalesce(gc,0) + (b->>'gc')::numeric
       where faction_id = fid;
    end if;
    -- Порода со дна — на склад державы, обычным ресурсом.
    if nullif(b->>'res','') is not null and coalesce((b->>'res_n')::numeric,0) > 0 then
      perform public._pc_res_add(fid, b->>'res', (b->>'res_n')::numeric);
    end if;
    -- Осколок цикла (та же схема, что у Разлома: нет колонки — награда молчит).
    if coalesce((b->>'shard')::boolean, false) then
      v_classes := array['corvette','destroyer','mediumCruiser','hyperCruiser'];
      v_shard := v_classes[1 + floor(random() * array_length(v_classes, 1))::int];
      begin
        update public.faction_economy
           set cycle_shards = jsonb_set(coalesce(cycle_shards, '{}'::jsonb), array[v_shard],
                 to_jsonb(coalesce((cycle_shards->>v_shard)::int, 0) + 1))
         where faction_id = fid;
      exception when others then v_shard := null;
      end;
    end if;
    if coalesce((b->>'art')::boolean, false) then
      v_art := public._spy_artifact_grant(fid, 'fishing');
    end if;
  end if;

  v_best := st.best;
  if v_best is null
     or (b->>'rar')::int > coalesce((v_best->>'rar')::int, -1)
     or ((b->>'rar')::int = coalesce((v_best->>'rar')::int, -1)
         and coalesce((b->>'kg')::numeric,0) > coalesce((v_best->>'kg')::numeric,0)) then
    v_best := jsonb_build_object('name', b->>'name', 'rar', (b->>'rar')::int,
                                 'kg', b->'kg', 'at', now());
  end if;

  update public.fishing_state
     set pending = null,
         kept    = v_kept + case when v_counts then 1 else 0 end,
         total   = coalesce(total,0) + 1,
         best    = v_best,
         day     = current_date,
         updated_at = now()
   where faction_id = fid;

  if (b->>'rar')::int >= 3 then
    begin
      v_nm := coalesce(nullif(public._fac_name(fid),''), 'Одна из держав');
      perform public._luck_post('fish', fid,
        format('%s поднимает со дна: «%s».', v_nm, b->>'name'));
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'lost', false,
    'name', b->>'name', 'kind', b->>'kind', 'rar', (b->>'rar')::int, 'kg', b->'kg',
    'gc',    case when v_counts then b->'gc' else to_jsonb(0) end,
    'res',   case when v_counts then b->'res' else null end,
    'res_n', case when v_counts then b->'res_n' else to_jsonb(0) end,
    'shard', v_shard, 'art', v_art, 'counted', v_counts,
    'kept', v_kept + case when v_counts then 1 else 0 end, 'cap', v_cap);
end$$;
revoke all on function public.fishing_land(uuid, boolean) from public, anon;
grant execute on function public.fishing_land(uuid, boolean) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- ПОЛЯНА: семечко мира
-- ══════════════════════════════════════════════════════════════
-- Что видно на поляне: все живые всходы, свои помечены mine.
create or replace function public._fishing_plants(p_fid text)
returns jsonb language sql stable set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'x', p.x, 'mine', p.faction_id = coalesce(p_fid,''),
           'ready', now() >= p.planted_at + public._fishing_grow(),
           'left', greatest(0, extract(epoch from (p.planted_at + public._fishing_grow() - now()))::int),
           'who', public._fac_name(p.faction_id))
         order by p.x), '[]'::jsonb)
    from public.fishing_plants p where not p.taken
$$;

-- Купить семечко: 200 000 ГС. Больше одного в руках не носят.
create or replace function public.fishing_seed_buy()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.fishing_state; v_gc numeric; v_price numeric := public._fishing_seed_price();
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;

  insert into public.fishing_state(faction_id, owner_id) values (fid, auth.uid())
    on conflict (faction_id) do nothing;
  select * into st from public.fishing_state where faction_id = fid for update;
  if coalesce(st.seed,0) > 0 then raise exception 'has seed: семечко уже в руках'; end if;
  if exists (select 1 from public.fishing_plants where faction_id = fid and not taken) then
    raise exception 'busy: одно семечко в рост — дождись всхода';
  end if;

  select coalesce(gc,0) into v_gc from public.faction_economy where faction_id = fid for update;
  if coalesce(v_gc,0) < v_price then raise exception 'poor: не хватает ГС'; end if;
  update public.faction_economy set gc = coalesce(gc,0) - v_price where faction_id = fid;
  update public.fishing_state set seed = 1, updated_at = now() where faction_id = fid;

  return jsonb_build_object('ok', true, 'seed', 1, 'paid', v_price);
end$$;
revoke all on function public.fishing_seed_buy() from public, anon;
grant execute on function public.fishing_seed_buy() to authenticated;

-- Посадить: колонка поляны, свободная лунка.
create or replace function public.fishing_seed_plant(p_x int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.fishing_state; v_id bigint;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  select * into st from public.fishing_state where faction_id = fid for update;
  if not found or coalesce(st.seed,0) <= 0 then raise exception 'no seed: семечка нет'; end if;
  if exists (select 1 from public.fishing_plants where faction_id = fid and not taken) then
    raise exception 'busy: одно семечко в рост';
  end if;
  if p_x is null or p_x < 0 or p_x > 400 then raise exception 'bad spot: тут не растёт'; end if;
  if exists (select 1 from public.fishing_plants where x = p_x and not taken) then
    raise exception 'occupied: тут уже растёт';
  end if;

  insert into public.fishing_plants(faction_id, owner_id, x)
    values (fid, auth.uid(), p_x) returning id into v_id;
  update public.fishing_state set seed = 0, updated_at = now() where faction_id = fid;

  return jsonb_build_object('ok', true, 'id', v_id,
    'left', extract(epoch from public._fishing_grow())::int);
end$$;
revoke all on function public.fishing_seed_plant(int) from public, anon;
grant execute on function public.fishing_seed_plant(int) to authenticated;

-- Забрать: через сутки дерево отдаёт 10 ихора и уходит.
create or replace function public.fishing_seed_take(p_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; pl public.fishing_plants; v_amt numeric := public._fishing_seed_ichor();
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  select * into pl from public.fishing_plants where id = p_id for update;
  if not found or pl.taken then raise exception 'gone: этого дерева уже нет'; end if;
  if pl.faction_id is distinct from fid then raise exception 'not yours: это чужое дерево'; end if;
  if now() < pl.planted_at + public._fishing_grow() then
    raise exception 'not ready: ещё растёт';
  end if;

  update public.fishing_plants set taken = true where id = p_id;
  perform public._pc_res_add(fid, 'Ихор', v_amt);

  return jsonb_build_object('ok', true, 'ichor', v_amt);
end$$;
revoke all on function public.fishing_seed_take(bigint) from public, anon;
grant execute on function public.fishing_seed_take(bigint) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- СОСТОЯНИЕ: берег + садок + поляна
-- ══════════════════════════════════════════════════════════════
create or replace function public.fishing_get()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.fishing_state; v_kept int; v_site jsonb; v_pil int;
begin
  v_site := public._fishing_site();
  begin fid := public._ec_my_fid(); exception when others then fid := null; end;
  if fid is null then
    return jsonb_build_object('site', v_site, 'kept', 0, 'cap', public._fishing_cap(),
      'total', 0, 'best', null, 'night', public._fishing_night(),
      'night_left', public._fishing_night_left(), 'seed', 0,
      'seed_price', public._fishing_seed_price(), 'seed_ichor', public._fishing_seed_ichor(),
      'plants', public._fishing_plants(null),
      'feed', coalesce((select jsonb_agg(jsonb_build_object('txt', t.txt, 'at', t.at) order by t.id desc)
                          from (select * from public.luck_chronicle where kind = 'fish'
                                 order by id desc limit 8) t), '[]'::jsonb));
  end if;

  select * into st from public.fishing_state where faction_id = fid;
  v_kept := case when not found or st.day < current_date then 0 else st.kept end;
  select count(*) into v_pil from public.fishing_state where day = current_date and casts > 0;

  return jsonb_build_object(
    'site',  v_site,
    'kept',  v_kept,
    'cap',   public._fishing_cap(),
    'total', coalesce(st.total, 0),
    'best',  st.best,
    'night', public._fishing_night(),
    'night_left', public._fishing_night_left(),
    'pilgrims', coalesce(v_pil, 0),
    'seed',  coalesce(st.seed, 0),
    'seed_price', public._fishing_seed_price(),
    'seed_ichor', public._fishing_seed_ichor(),
    'plants', public._fishing_plants(fid),
    'gc',    coalesce((select gc from public.faction_economy where faction_id = fid), 0),
    'pending', case when st.day = current_date then st.pending else null end,
    'feed',  public._luck_feed('fish', 8));
end$$;
revoke all on function public.fishing_get() from public, anon;
grant execute on function public.fishing_get() to authenticated;

notify pgrst, 'reload schema';
