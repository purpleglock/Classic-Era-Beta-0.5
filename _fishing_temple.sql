-- ============================================================
-- 🎣 ТИХАЯ ВОДА → ЛОКАЦИЯ «ХРАМ МИРОЗДАНИЯ»
-- ============================================================
-- Правка к _fishing.sql (ПРИМЕНЁН). Рыбалка перестаёт быть привязанной
-- к «любой своей водной колонии» и становится ОДНИМ местом на карте —
-- берегом планеты «Храм мироздания» в одноимённой системе.
--
-- Почему так: рыбалка — не производство, а место. Когда берег один на всю
-- галактику, у него появляется адрес, хроника и общая память: все державы
-- сидят у одной и той же воды, лут у всех из одних и тех же залежей, а
-- «трофей державы» становится сопоставимым — раньше он зависел от того,
-- кому досталась океаническая планета.
--
-- Что меняется против _fishing.sql:
--   • _fishing_site()  — новая: находит систему/тело по имени, отдаёт паспорт
--     берега (владелец, залежи, глубина, жив ли мир).
--   • _fishing_roll()  — принимает паспорт берега (jsonb), а не uuid колонии;
--     донные находки берутся из залежей ТЕЛА, а не колонии игрока.
--   • fishing_get()    — отдаёт site вместо списка spots (+ сколько держав
--     побывало у воды сегодня).
--   • fishing_cast()   — сигнатура без колонии: p_depth. Старая снята.
--   • fishing_land()   — только текст хроники (берег теперь именной).
--
-- ВАЖНО: воды нет, если планету стёрли Дланью — _doom_resolve переписывает
-- тело в «Мёртвая планета». Это не баг, а последствие: сожгли берег — сожгли
-- и рыбалку (ачивка spes_perdita, _achievements.sql).
--
-- Зеркало клиента — fishing.js (FISH_SITE_DEPTH, экран локации).
-- ============================================================

-- ── Глубина храмовой воды (метры). Своя, а не по типу мира: колодец у
-- «начала всего сущего» — единственное место, где вообще есть бездна
-- (>= 38 м), а значит и легенда с ночным уловом глубины. ──
create or replace function public._fishing_site_depth()
returns int language sql immutable as $$ select 48 $$;

-- ── Паспорт берега. null, если системы нет или воды не осталось. ──
create or replace function public._fishing_site()
returns jsonb language plpgsql stable set search_path=public as $$
declare ms record; b jsonb; v_pid int; v_own text;
begin
  if to_regclass('public.map_systems') is null then return null; end if;
  select * into ms from public.map_systems
   where lower(btrim(name)) = 'храм мироздания' limit 1;
  if not found then return null; end if;

  -- Тело берега: одноимённое с системой, иначе первое водное в ней.
  select el into b
    from jsonb_array_elements(coalesce(ms.planets,'[]'::jsonb)) as t(el)
   where lower(btrim(coalesce(el->>'name',''))) = 'храм мироздания'
   limit 1;
  if b is null then
    select el into b
      from jsonb_array_elements(coalesce(ms.planets,'[]'::jsonb)) as t(el)
     where public._fishing_wet(el->>'type')
     limit 1;
  end if;
  if b is null then return null; end if;

  v_pid := nullif(b->>'pid','')::int;
  -- Кто держит берег (флаг над водой). На право рыбачить не влияет.
  select c.faction_id into v_own
    from public.colonies c
   where c.system_id = ms.id and c.planet_pid = v_pid
   limit 1;

  return jsonb_build_object(
    'sys',      ms.id,
    'sysname',  ms.name,
    'pid',      v_pid,
    'name',     coalesce(b->>'name', ms.name),
    'type',     b->>'type',
    'dead',     coalesce((b->>'dead')::boolean, false),
    'wet',      public._fishing_wet(b->>'type') and not coalesce((b->>'dead')::boolean, false),
    'maxdepth', public._fishing_site_depth(),
    'res',      coalesce(b->'resources', '[]'::jsonb),
    'owner',    v_own,
    'owner_name', case when v_own is null then null else public._fac_name(v_own) end);
end$$;

-- Старый бросок «от колонии» больше не нужен: берег один и он не колония.
drop function if exists public._fishing_roll(uuid, int, boolean);

-- ══════════════════════════════════════════════════════════════
-- БРОСОК: что клюнуло. Решает ТОЛЬКО сервер.
-- p_site — паспорт берега из _fishing_site() (залежи тела берём оттуда).
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
  v_nm text; v_kind text; v_rar int; v_gc numeric := 0; v_tnp numeric := 0; v_sci numeric := 0;
  v_art boolean := false; v_hard numeric := 1; v_kg numeric := null;
begin
  v_rv := random();

  -- Легенда: только глубоко и только ночью, и всё равно редко.
  if v_abyss and v_night and v_rv < 0.004 then
    v_nm := 'Сердце тихой воды'; v_kind := 'legend'; v_rar := 4;
    v_sci := 120; v_gc := 4000; v_hard := 1.9;

  -- Реликвия → настоящий артефакт разведки.
  elsif v_deep and v_rv < 0.008 then
    v_nm := 'Реликвия со дна'; v_kind := 'relic'; v_rar := 3;
    v_art := true; v_gc := 500; v_hard := 1.5;

  -- Обломки кораблей: чем глубже, тем чаще и жирнее.
  elsif v_rv < (case when v_abyss then 0.20 when v_deep then 0.14 else 0.06 end) then
    if v_abyss and random() < 0.35 then
      v_nm := 'Капсула чёрного ящика'; v_rar := 3; v_gc := 3200; v_sci := 45; v_hard := 1.3;
    elsif v_deep and random() < 0.4 then
      v_nm := 'Кольцо рулевого'; v_rar := 2; v_gc := 2100; v_hard := 1.25;
    else
      v_nm := 'Обломок обшивки'; v_rar := 2; v_gc := 1200; v_hard := 1.15;
    end if;
    v_kind := 'wreck';

  -- Донная находка из залежей ТЕЛА. Берег один на всех, поэтому список пород
  -- у всех одинаковый — а вот цена находки растёт с глубиной: у поверхности
  -- поднимаешь то, что и так лежит под ногами, со дна — жилу.
  elsif v_rv < (case when v_deep then 0.34 else 0.24 end)
        and jsonb_typeof(v_res) = 'array' and jsonb_array_length(v_res) > 0 then
    select v_res->(floor(random()*jsonb_array_length(v_res))::int) into v_dep;
    v_nm := 'Ил с вкраплениями: ' || coalesce(v_dep->>'name','порода');
    v_kind := 'ore';
    v_rar := case coalesce(v_dep->>'r','common')
               when 'legendary' then 4 when 'epic' then 3 when 'rare' then 2
               when 'uncommon' then 1 else 0 end;
    v_rar := greatest(v_rar, case when v_abyss then 2 when v_deep then 1 else 0 end);
    v_gc := (200 + v_rar * 650)::numeric;
    v_hard := 1 + v_rar * 0.08;

  -- Хлам — обязателен, иначе рыбалка перестаёт быть рыбалкой.
  elsif v_rv < (case when v_deep then 0.44 else 0.40 end) then
    v_nm := (array['Ржавая банка','Пучок водорослей','Старый сапог','Мокрая ветка','Ком донного ила'])
              [1 + floor(random()*5)::int];
    v_kind := 'junk'; v_rar := 0; v_hard := 0.85;

  -- Рыба.
  else
    v_kind := 'fish';
    if v_night and random() < 0.45 then
      if v_abyss then v_nm := 'Стеклянный угорь'; v_rar := 3; v_hard := 1.5;
      else v_nm := 'Лунная форель'; v_rar := 2; v_hard := 1.2; end if;
    elsif v_deep and random() < 0.45 then
      if random() < 0.4 then v_nm := 'Сом'; v_rar := 2; v_hard := 1.35;
      else v_nm := 'Зеркальный карп'; v_rar := 2; v_hard := 1.2; end if;
    else
      v_nm := (array['Плотва','Окунь','Карась','Линь'])[1 + floor(random()*4)::int];
      v_rar := 1; v_hard := 1;
    end if;
    v_kg  := round((0.2 + random() * (1.5 + v_rar * 2.2))::numeric, 2);
    v_tnp := round((6 + v_rar * 14) * v_kg, 1);
    v_gc  := round((40 + v_rar * 90) * v_kg, 0);
  end if;

  return jsonb_build_object(
    'id',   gen_random_uuid(),
    'name', v_nm, 'kind', v_kind, 'rar', v_rar, 'kg', v_kg,
    'gc',   v_gc, 'tnp', v_tnp, 'sci', v_sci, 'art', v_art,
    'hard', v_hard, 'depth', coalesce(p_depth,0), 'night', v_night);
end$$;

-- ══════════════════════════════════════════════════════════════
-- СОСТОЯНИЕ: паспорт берега + садок + хроника
-- ══════════════════════════════════════════════════════════════
create or replace function public.fishing_get()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.fishing_state; v_kept int; v_site jsonb; v_pil int;
begin
  v_site := public._fishing_site();
  -- Без державы берег всё равно показываем (место и хроника — общие),
  -- поэтому «нет одобренной фракции» здесь не ошибка, а просто гость.
  begin fid := public._ec_my_fid(); exception when others then fid := null; end;
  if fid is null then
    -- _luck_feed помечает «свои» строки и тоже требует державы — гостю отдаём
    -- ленту без пометок.
    return jsonb_build_object('site', v_site, 'kept', 0, 'cap', public._fishing_cap(),
      'total', 0, 'best', null, 'night', public._fishing_night(),
      'night_left', public._fishing_night_left(),
      'feed', coalesce((select jsonb_agg(jsonb_build_object('txt', t.txt, 'at', t.at) order by t.id desc)
                          from (select * from public.luck_chronicle where kind = 'fish'
                                 order by id desc limit 8) t), '[]'::jsonb));
  end if;

  select * into st from public.fishing_state where faction_id = fid;
  v_kept := case when not found or st.day < current_date then 0 else st.kept end;

  -- Сколько держав спускалось к воде сегодня — берег общий, пусть это будет видно.
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
    'pending', case when st.day = current_date then st.pending else null end,
    'feed',  public._luck_feed('fish', 8));
end$$;
revoke all on function public.fishing_get() from public, anon;
grant execute on function public.fishing_get() to authenticated;

-- Заброс «в свою колонию» снят: у рыбалки один адрес.
drop function if exists public.fishing_cast(uuid, int, boolean);

-- ══════════════════════════════════════════════════════════════
-- ЗАБРОС: сервер решает, кто клюнул, и кладёт добычу в pending
-- ══════════════════════════════════════════════════════════════
create or replace function public.fishing_cast(p_depth int default 0)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.fishing_state; v_site jsonb; v_depth int; v_bite jsonb; v_kept int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;

  v_site := public._fishing_site();
  if v_site is null then raise exception 'no site: берега нет на карте'; end if;
  if not coalesce((v_site->>'wet')::boolean, false) then
    raise exception 'no water: у Храма мироздания больше нет открытой воды';
  end if;

  -- Глубину клиент ЗАЯВЛЯЕТ, но сервер зажимает её реальным берегом.
  v_depth := least(greatest(coalesce(p_depth,0), 0), (v_site->>'maxdepth')::int);

  insert into public.fishing_state(faction_id, owner_id, day, kept, casts)
    values (fid, auth.uid(), current_date, 0, 0)
    on conflict (faction_id) do nothing;
  select * into st from public.fishing_state where faction_id = fid for update;

  -- Антиспам: заброс не чаще раза в 3 секунды (быстрее его и не отыграть).
  if st.last_cast is not null and st.last_cast > now() - interval '3 seconds' then
    raise exception 'too fast: дай воде успокоиться';
  end if;

  v_kept := case when st.day < current_date then 0 else st.kept end;
  -- Время суток берём с сервера (см. _fishing_night): клиент его только рисует.
  v_bite := public._fishing_roll(v_site, v_depth, public._fishing_night());

  update public.fishing_state
     set pending = v_bite, last_cast = now(), day = current_date,
         kept = v_kept, casts = case when st.day < current_date then 1 else st.casts + 1 end,
         updated_at = now()
   where faction_id = fid;

  -- Клиенту отдаём добычу БЕЗ сумм награды: цифры он увидит после вываживания,
  -- чтобы по «жирности» клёва нельзя было решать, тянуть или обрывать.
  return jsonb_build_object('ok', true,
    'bite', jsonb_build_object('id', v_bite->>'id', 'hard', v_bite->'hard'),
    'kept', v_kept, 'cap', public._fishing_cap(), 'depth', v_depth,
    'night', public._fishing_night());
end$$;
revoke all on function public.fishing_cast(int) from public, anon;
grant execute on function public.fishing_cast(int) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- ВЫВАЖИВАНИЕ ЗАКОНЧЕНО: p_ok = вытащил / леска лопнула
-- (тело как в _fishing.sql, изменён только текст хроники — берег именной)
-- ══════════════════════════════════════════════════════════════
create or replace function public.fishing_land(p_id uuid, p_ok boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.fishing_state; b jsonb;
        v_kept int; v_cap int; v_counts boolean; v_art jsonb; v_nm text; v_best jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  select * into st from public.fishing_state where faction_id = fid for update;
  if not found or st.pending is null then raise exception 'nothing on the hook'; end if;

  b := st.pending;
  if (b->>'id') is distinct from p_id::text then raise exception 'stale hook'; end if;

  -- Сорвалось: добыча просто исчезает.
  if not coalesce(p_ok,false) then
    update public.fishing_state set pending = null, updated_at = now() where faction_id = fid;
    return jsonb_build_object('ok', true, 'lost', true,
      'name', b->>'name', 'rar', (b->>'rar')::int, 'kind', b->>'kind');
  end if;

  v_cap  := public._fishing_cap();
  v_kept := case when st.day < current_date then 0 else st.kept end;
  v_counts := v_kept < v_cap;    -- сверх садка ловим «для души»: без наград

  if v_counts then
    update public.faction_economy
       set gc      = coalesce(gc,0)      + coalesce((b->>'gc')::numeric, 0),
           tnp     = coalesce(tnp,0)     + coalesce((b->>'tnp')::numeric, 0),
           science = coalesce(science,0) + coalesce((b->>'sci')::numeric, 0)
     where faction_id = fid;
    if coalesce((b->>'art')::boolean, false) then
      v_art := public._spy_artifact_grant(fid, 'fishing');
    end if;
  end if;

  -- Лучший трофей державы — по редкости, при равной редкости по весу.
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

  -- В хронику берега — только то, что стоит чужого взгляда.
  if (b->>'rar')::int >= 3 then
    begin
      v_nm := coalesce(nullif(public._fac_name(fid),''), 'Одна из держав');
      perform public._luck_post('fish', fid,
        case when (b->>'kind') = 'legend'
             then format('%s вытащила из храмовой воды %s. На берегу молчали.', v_nm, b->>'name')
             else format('%s поднимает со дна у Храма мироздания: «%s».', v_nm, b->>'name') end);
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'lost', false,
    'name', b->>'name', 'kind', b->>'kind', 'rar', (b->>'rar')::int, 'kg', b->'kg',
    'gc',  case when v_counts then b->'gc'  else to_jsonb(0) end,
    'tnp', case when v_counts then b->'tnp' else to_jsonb(0) end,
    'sci', case when v_counts then b->'sci' else to_jsonb(0) end,
    'art', v_art, 'counted', v_counts,
    'kept', v_kept + case when v_counts then 1 else 0 end, 'cap', v_cap);
end$$;
revoke all on function public.fishing_land(uuid, boolean) from public, anon;
grant execute on function public.fishing_land(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
