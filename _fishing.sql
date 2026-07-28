-- ============================================================
-- 🎣 ТИХАЯ ВОДА — рыбалка (ПЕРВАЯ РЕДАКЦИЯ, применена 28.07)
-- ============================================================
-- ⚠ УСТАРЕЛО ЧАСТИЧНО: привязка «к любой своей водной колонии» снята.
--   Рыбалка переехала в ОДНУ локацию на карте — см. _fishing_temple.sql
--   (там же новые fishing_get / fishing_cast / _fishing_roll). Здесь живут
--   только таблица fishing_state, садок, сутки берега и _fishing_wet.
-- ============================================================
-- Не казино и не гринд: сюда ходят отдыхать. Экран живёт в НОВЕЛЛЕ
-- (оверлей hp-vn-fish), рядом с «Георазведкой» и «Разломом».
--
-- Правила:
--   • Рыбачить можно только на СВОЕЙ колонии, где есть вода: группы
--     Океанические / Землеподобные / Криомиры (подо льдом). Прочие миры
--     сервер не пускает — там воды нет.
--   • Заброс бесплатный. Клиент играет в платформер, но ЧТО клюнуло решает
--     СЕРВЕР (fishing_cast) — клиент только отыгрывает вываживание и
--     сообщает исход (fishing_land). Награда живёт в pending и выдаётся
--     ровно один раз по её id.
--   • СУТОЧНЫЙ САДОК: первые FISH_CAP уловов за день идут в державу,
--     дальше ловится «для души» — в улов и статистику, но без наград.
--     Ловить при этом можно сколько угодно: это медитация, а не работа.
--   • Глубина точки заброса — от клиента, но сервер её ЗАЖИМАЕТ по
--     реальному миру планеты, поэтому «глубоким» лутом не разжиться враньём.
--
-- Что даёт улов:
--   рыба      → ТНП (кормит население) + немного ГС
--   ил/донное → ресурсная находка из ЗАЛЕЖЕЙ этой колонии → ГС по редкости
--   обломки   → ГС, чёрный ящик — ещё и наука
--   реликвия  → артефакт разведки (_spy_artifact_grant, source='fishing')
--   легенда   → «Сердце тихой воды»: наука + запись в хронику берега
--
-- Хроника берега — общая лента luck_chronicle с kind='fish' (та же, что у
-- георазведки/Разлома; читается через _luck_feed).
-- Зеркало клиента — fishing.js (FISH_LOOT/подписи) + render.js (heroVNFishOpen).
-- ============================================================

-- ── Состояние рыбалки: одна строка на фракцию ──
create table if not exists public.fishing_state (
  faction_id  text primary key,
  owner_id    uuid,
  day         date not null default current_date,   -- день, к которому относится садок
  kept        int  not null default 0,              -- сколько уловов зачтено сегодня
  casts       int  not null default 0,              -- забросов за день (косметика/статистика)
  pending     jsonb,                                -- что сейчас на крючке {id,…} (null = никого)
  last_cast   timestamptz,                          -- антиспам забросов
  best        jsonb,                                -- лучший трофей державы за всё время
  total       int  not null default 0,              -- всего уловов за всё время
  updated_at  timestamptz default now()
);
alter table public.fishing_state enable row level security;
drop policy if exists "fish_sel" on public.fishing_state;
create policy "fish_sel" on public.fishing_state for select to authenticated
  using (owner_id = auth.uid());
revoke insert, update, delete on public.fishing_state from public, anon, authenticated;

-- Хроника берега пишется в общую luck_chronicle (создаётся в _geosurvey.sql /
-- _stargaze.sql). Дублируем идемпотентно: срезы катятся в любом порядке.
create table if not exists public.luck_chronicle (
  id         bigserial primary key,
  kind       text not null,
  faction_id text,
  txt        text not null,
  at         timestamptz not null default now()
);

-- ── Суточный садок ──
create or replace function public._fishing_cap()
returns int language sql immutable as $$ select 12 $$;

-- ── Есть ли на планете вода (по группе мира) ──
-- Зеркало клиента: FISH_WET в fishing.js.
create or replace function public._fishing_wet(p_type text)
returns boolean language sql immutable as $$
  select coalesce(p_type,'') in ('Океанические','Землеподобные','Криомиры')
$$;

-- ── СУТКИ БЕРЕГА. Ночь решает СЕРВЕР, а не клиент: от неё зависит лут
-- (лунная форель, стеклянный угорь, легенда). Цикл 30 минут: 15 день / 15 ночь,
-- одинаково для всех игроков. Клиент рисует небо по этой же формуле, поэтому
-- картинка и лут всегда сходятся. Зеркало клиента: fishNightNow() в fishing.js.
create or replace function public._fishing_night()
returns boolean language sql stable as $$
  select (floor(extract(epoch from now()) / 900)::bigint % 2) = 1
$$;
-- Сколько секунд осталось до смены времени суток (для часов на экране).
create or replace function public._fishing_night_left()
returns int language sql stable as $$
  select (900 - (floor(extract(epoch from now()))::bigint % 900))::int
$$;

-- ── Максимальная глубина мира (метры) — потолок для заявки клиента ──
create or replace function public._fishing_maxdepth(p_type text)
returns int language sql immutable as $$
  select case coalesce(p_type,'')
    when 'Океанические'  then 60
    when 'Землеподобные' then 26
    when 'Криомиры'      then 40      -- подлёдное озеро: узко, но глубоко
    else 0 end
$$;

-- ══════════════════════════════════════════════════════════════
-- БРОСОК: что клюнуло. Решает ТОЛЬКО сервер.
-- Возвращает добычу с наградой и сложностью вываживания (hard).
-- ══════════════════════════════════════════════════════════════
create or replace function public._fishing_roll(p_colony uuid, p_depth int, p_night boolean)
returns jsonb language plpgsql volatile set search_path=public as $$
declare
  v_res   jsonb;        -- залежи колонии — из них берём донные находки
  v_dep   jsonb;
  v_rv    double precision;
  v_deep  boolean := coalesce(p_depth,0) >= 18;
  v_abyss boolean := coalesce(p_depth,0) >= 38;
  v_night boolean := coalesce(p_night,false);
  v_nm text; v_kind text; v_rar int; v_gc numeric := 0; v_tnp numeric := 0; v_sci numeric := 0;
  v_art boolean := false; v_hard numeric := 1; v_kg numeric := null;
begin
  select resources into v_res from public.colonies where id = p_colony;
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

  -- Донная находка из ЗАЛЕЖЕЙ этой колонии: ил с вкраплениями того, что тут есть.
  elsif v_rv < (case when v_deep then 0.34 else 0.24 end)
        and jsonb_typeof(v_res) = 'array' and jsonb_array_length(v_res) > 0 then
    select v_res->(floor(random()*jsonb_array_length(v_res))::int) into v_dep;
    v_nm := 'Ил с вкраплениями: ' || coalesce(v_dep->>'name','порода');
    v_kind := 'ore';
    v_rar := case coalesce(v_dep->>'r','common')
               when 'legendary' then 4 when 'epic' then 3 when 'rare' then 2
               when 'uncommon' then 1 else 0 end;
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
-- СОСТОЯНИЕ: где можно рыбачить + садок + хроника берега
-- ══════════════════════════════════════════════════════════════
create or replace function public.fishing_get()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.fishing_state; v_kept int; v_spots jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then
    return jsonb_build_object('spots','[]'::jsonb,'kept',0,'cap',public._fishing_cap(),
      'total',0,'best',null,'feed','[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.planet_name, 'type', c.planet_type,
           'maxdepth', public._fishing_maxdepth(c.planet_type),
           'deposits', coalesce(jsonb_array_length(c.resources), 0))
         order by c.planet_name), '[]'::jsonb)
    into v_spots
    from public.colonies c
   where c.faction_id = fid and public._fishing_wet(c.planet_type);

  select * into st from public.fishing_state where faction_id = fid;
  v_kept := case when not found or st.day < current_date then 0 else st.kept end;

  return jsonb_build_object(
    'spots', v_spots,
    'kept',  v_kept,
    'cap',   public._fishing_cap(),
    'total', coalesce(st.total, 0),
    'best',  st.best,
    'night', public._fishing_night(),
    'night_left', public._fishing_night_left(),
    'pending', case when st.day = current_date then st.pending else null end,
    'feed',  public._luck_feed('fish', 8));
end$$;
revoke all on function public.fishing_get() from public, anon;
grant execute on function public.fishing_get() to authenticated;

-- ══════════════════════════════════════════════════════════════
-- ЗАБРОС: сервер решает, кто клюнул, и кладёт добычу в pending
-- ══════════════════════════════════════════════════════════════
create or replace function public.fishing_cast(p_colony uuid, p_depth int default 0, p_night boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies; st public.fishing_state;
        v_depth int; v_bite jsonb; v_kept int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;

  select * into col from public.colonies where id = p_colony;
  if not found or col.faction_id is distinct from fid then
    raise exception 'not your colony: рыбачить можно только в своих водах';
  end if;
  if not public._fishing_wet(col.planet_type) then
    raise exception 'no water: на этом мире нет открытой воды';
  end if;

  -- Глубину клиент ЗАЯВЛЯЕТ, но сервер зажимает её реальным миром.
  v_depth := least(greatest(coalesce(p_depth,0), 0), public._fishing_maxdepth(col.planet_type));

  insert into public.fishing_state(faction_id, owner_id, day, kept, casts)
    values (fid, auth.uid(), current_date, 0, 0)
    on conflict (faction_id) do nothing;
  select * into st from public.fishing_state where faction_id = fid for update;

  -- Антиспам: заброс не чаще раза в 3 секунды (быстрее его и не отыграть).
  if st.last_cast is not null and st.last_cast > now() - interval '3 seconds' then
    raise exception 'too fast: дай воде успокоиться';
  end if;

  v_kept := case when st.day < current_date then 0 else st.kept end;
  -- p_night игнорируем намеренно: время суток берём с сервера (см. _fishing_night).
  v_bite := public._fishing_roll(p_colony, v_depth, public._fishing_night());

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
revoke all on function public.fishing_cast(uuid, int, boolean) from public, anon;
grant execute on function public.fishing_cast(uuid, int, boolean) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- ВЫВАЖИВАНИЕ ЗАКОНЧЕНО: p_ok = вытащил / леска лопнула
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
             then format('%s вытащила из тихой воды %s. На берегу молчали.', v_nm, b->>'name')
             else format('%s поднимает со дна: «%s».', v_nm, b->>'name') end);
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
