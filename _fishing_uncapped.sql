-- ============================================================
-- 🎣 БЕРЕГ БЕЗ САДКА + АРТЕФАКТЫ В УЛОВЕ
-- ============================================================
-- Правка к _fishing.sql → _fishing_temple.sql → _fishing_river.sql (все
-- ПРИМЕНЕНЫ). Две вещи:
--
-- 1) САДКА БОЛЬШЕ НЕТ. Раньше первые 12 уловов за сутки шли в державу, а
--    дальше ловилось «для души» — без наград. Теперь платят за КАЖДЫЙ улов,
--    сколько бы его ни было: сидеть у воды столько, сколько хочется, — это
--    и был смысл места, а счётчик «12/12 · дальше без наград» его отменял.
--    _fishing_cap() остаётся ради зеркал (клиент и старые вызовы читают cap),
--    но возвращает 0 = «предела нет». kept с этого момента — просто «улов
--    сегодня», статистика, а не квота.
--
-- 2) АРТЕФАКТЫ — ПОЛНОЦЕННЫЙ ПРИЗ. Раньше артефакт разведки падал ровно из
--    одной строки таблицы («Реликвия со дна», только с глубины). Теперь это
--    отдельный вид добычи, доступный на любой глубине:
--      • Реликвия со дна      — глубина, ~0.9 %
--      • Кофр/ящик/тубус      — любая глубина: 0.5 % у берега, 1.2 % на
--                               глубине, 1.6 % в бездне
--      • Капсула чёрного ящика — в четверти случаев внутри ещё и снаряжение
--      • Сердце реки (легенда) — теперь несёт артефакт вместе с осколком
--    Выдаёт всё тот же _spy_artifact_grant(fid,'fishing') — предмет ложится
--    в хранилище державы, оттуда его вешают на оперативника с его карточки.
--    Если в справочнике не осталось выпадающих видов (drop_weight = 0),
--    grant вернёт null — тогда вместо предмета доплачиваем ГС, чтобы приз
--    не исчезал в никуда.
--
-- Зеркало клиента — fishing.js (fishCatchLine / fishPaintHud / fishPaintSite).
-- ============================================================

-- ── Садок снят. 0 = предела нет (клиент прячет счётчик квоты). ──
create or replace function public._fishing_cap()
returns int language sql immutable as $$ select 0 $$;

-- ── Сколько ГС платим, если артефакт выпал, а выдать нечего ──
create or replace function public._fishing_art_fallback()
returns numeric language sql immutable as $$ select 600::numeric $$;

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
  -- Раз в жизни — значит и приз целиком: деньги, осколок и артефакт.
  if v_abyss and v_night and v_rv < 0.004 then
    v_nm := 'Сердце реки'; v_kind := 'legend'; v_rar := 4;
    v_gc := 3000; v_shard := true; v_art := true; v_react := 0.65;

  -- Реликвия со дна → артефакт разведки. Только с глубины.
  elsif v_deep and v_rv < 0.009 then
    v_nm := 'Реликвия со дна'; v_kind := 'relic'; v_rar := 3;
    v_art := true; v_gc := 300; v_react := 0.8;

  -- Снаряжение чьей-то оперативной группы: кофр, ящик, тубус. В отличие от
  -- реликвии ловится и у берега — просто у берега такое тонет реже.
  elsif v_rv < (case when v_abyss then 0.016 when v_deep then 0.012 else 0.005 end) then
    v_nm := (array['Кофр оперативника','Ящик со снаряжением','Запаянный тубус','Полевой сейф'])
              [1 + floor(random()*4)::int];
    v_kind := 'relic'; v_rar := 3;
    v_art := true; v_gc := 200; v_react := 0.85;

  -- Обломки кораблей: чем глубже, тем чаще и жирнее. Самый глубокий — с осколком.
  elsif v_rv < (case when v_abyss then 0.20 when v_deep then 0.14 else 0.06 end) then
    if v_abyss and random() < 0.35 then
      -- В чёрном ящике не только записи: иногда рядом всплывает и то, что
      -- возил с собой экипаж.
      v_nm := 'Капсула чёрного ящика'; v_rar := 3; v_gc := 900; v_shard := true; v_react := 0.85;
      v_art := random() < 0.25;
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
-- ПОДСЕЧКА: p_ok = успел / прозевал. Награда идёт ВСЕГДА — садка нет.
-- ══════════════════════════════════════════════════════════════
create or replace function public.fishing_land(p_id uuid, p_ok boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.fishing_state; b jsonb;
        v_kept int; v_gc numeric; v_art jsonb; v_nm text; v_best jsonb;
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

  v_kept := case when st.day < current_date then 0 else st.kept end;
  v_gc   := coalesce((b->>'gc')::numeric, 0);

  -- Артефакт разведки в хранилище державы. Выдаём ДО денег: если справочник
  -- пуст и выдать нечего, приз превращается в ГС и уезжает тем же платежом.
  if coalesce((b->>'art')::boolean, false) then
    begin
      v_art := public._spy_artifact_grant(fid, 'fishing');
    exception when others then v_art := null;
    end;
    if v_art is null then v_gc := v_gc + public._fishing_art_fallback(); end if;
  end if;

  if v_gc > 0 then
    update public.faction_economy set gc = coalesce(gc,0) + v_gc where faction_id = fid;
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
         kept    = v_kept + 1,          -- теперь это «улов сегодня», не квота
         total   = coalesce(total,0) + 1,
         best    = v_best,
         day     = current_date,
         updated_at = now()
   where faction_id = fid;

  if (b->>'rar')::int >= 3 then
    begin
      v_nm := coalesce(nullif(public._fac_name(fid),''), 'Одна из держав');
      perform public._luck_post('fish', fid,
        case when v_art is not null
             then format('%s поднимает со дна: «%s». Внутри — %s.',
                         v_nm, b->>'name', coalesce(v_art->>'label','чьё-то снаряжение'))
             else format('%s поднимает со дна: «%s».', v_nm, b->>'name') end);
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'lost', false,
    'name', b->>'name', 'kind', b->>'kind', 'rar', (b->>'rar')::int, 'kg', b->'kg',
    'gc',    v_gc,
    'res',   b->'res',
    'res_n', b->'res_n',
    'shard', v_shard, 'art', v_art, 'counted', true,
    'kept', v_kept + 1, 'cap', public._fishing_cap());
end$$;
revoke all on function public.fishing_land(uuid, boolean) from public, anon;
grant execute on function public.fishing_land(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
