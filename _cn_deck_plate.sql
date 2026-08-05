-- ============================================================
-- ПАЛУБА НА СЕРВЕРЕ · СИНЕРГИЯ, ГЕОМЕТРИЯ, ЭНЕРГИЯ
-- Применять ПОСЛЕ _cn_deck_masks.sql (даёт public.cn_deck_mask) и
-- ПОСЛЕ _unit_publish.sql (даёт _cn_catalog/_cn_recompute). Идемпотентно.
--
-- Зачем. Раскладка палубы (layout.bays) до сих пор была чистой картинкой: сервер
-- читал плоский список modules и складывал их combat-эффекты в лоб. Значит вся
-- «фактори из модулей» — соседство, форма контура, разбавление, усилители — жила
-- только в клиенте и правилась из консоли одной строкой. Здесь тот же расчёт
-- повторён в SQL и становится ЕДИНСТВЕННОЙ правдой:
--   1) геометрия — модуль стоит в клетке палубы, узлы не налезают друг на друга,
--      навесная броня лежит во внешнем поясе, семья модуля уважает отсек;
--   2) синергия — множитель контура умножает вклад КАЖДОЙ его клетки в mods;
--   3) энергия и грузоподъёмность — жёсткий отказ, а не подсказка в интерфейсе.
--
-- ⚠️ ЭТО ЗЕРКАЛО КЛИЕНТА. Числа продублированы из constructors.js (CN_PLATE,
-- CN_SYS, CN_ZONE_RULE, CN_BEACON_*, CN_ARMOR_PER_CELL, cnModNominal,
-- cnShapeBonus). Правишь там — правь здесь, иначе превью и опубликованный
-- корабль разъедутся, а игрок увидит «на верфи было больше».
-- ⚠️ Форму корпуса в SQL не тащим: маска классов испечена tools/gen_deck_masks.js.
-- ============================================================

-- ── Распаковка hex-маски в булев массив (1-based, клетка i → arr[i+1]) ──
create or replace function public._cn_bits(p text, n int)
returns boolean[] language plpgsql immutable as $$
declare out boolean[]; i int; v int; c int := 0;
begin
  out := array_fill(false, array[n]);
  for i in 1..coalesce(length(p),0) loop
    v := ('x' || substr(p, i, 1))::bit(4)::int;
    if (v & 1) > 0 and c+1 <= n then out[c+1] := true; end if;
    if (v & 2) > 0 and c+2 <= n then out[c+2] := true; end if;
    if (v & 4) > 0 and c+3 <= n then out[c+3] := true; end if;
    if (v & 8) > 0 and c+4 <= n then out[c+4] := true; end if;
    c := c + 4;
  end loop;
  return out;
end$$;

-- ── Справочник разводки палубы (зеркало CN_SYS + CN_SYS_ALIAS) ──
-- cw/ch — габарит в клетках, outer/len — навесная лента во внешнем поясе,
-- gs/energy/mass — железо самого узла, hp — доля прибавки прочности на клетку.
create or replace function public._cn_sys(p_key text)
returns jsonb language sql immutable as $$
  select case case when p_key = 'gun' then 'gun_m' else p_key end
    when 'beacon' then '{"cw":4,"ch":4,"energy":900,"gs":1200,"mass":3}'::jsonb
    when 'gun_s'  then '{"cw":1,"ch":1,"energy":30,"gs":200,"mass":1,"gun":"s"}'::jsonb
    when 'gun_m'  then '{"cw":2,"ch":2,"energy":90,"gs":700,"mass":3,"gun":"m"}'::jsonb
    when 'gun_l'  then '{"cw":3,"ch":3,"energy":220,"gs":2000,"mass":9,"gun":"l"}'::jsonb
    when 'coat'   then '{"cw":1,"ch":1,"energy":0,"gs":120,"mass":1,"outer":true,"len":1,"hp":0.5}'::jsonb
    when 'armor'  then '{"cw":2,"ch":1,"energy":0,"gs":400,"mass":6,"outer":true,"len":2,"hp":1.0}'::jsonb
    when 'screen' then '{"cw":3,"ch":1,"energy":0,"gs":1300,"mass":13,"outer":true,"len":3,"hp":1.5}'::jsonb
    else null end
$$;

-- ── Семья модуля: что он вообще делает (зеркало cnModFam) ──
-- Порядок ключей значим: модуль с двумя эффектами относится к первому найденному.
create or replace function public._cn_mod_fam(mob jsonb)
returns text language sql immutable as $$
  select coalesce((
    select f from unnest(array['jam','pd','stealth','sensor','hangar','dejam','interdict','stabil','ftl']) f
     where coalesce((mob->'combat'->>f)::numeric,0) <> 0 limit 1), 'hull')
$$;

-- ── Номинал контура: сколько клеток нужно модулю для полной отдачи ──
-- (зеркало cnModNominal: чем прожорливее коробка, тем длиннее контур)
create or replace function public._cn_mod_nominal(mob jsonb)
returns int language sql immutable as $$
  select case
    when coalesce((mob->>'energy')::numeric, (mob->>'power')::numeric, 0) <= 200  then 6
    when coalesce((mob->>'energy')::numeric, (mob->>'power')::numeric, 0) <= 600  then 10
    when coalesce((mob->>'energy')::numeric, (mob->>'power')::numeric, 0) <= 1500 then 16
    when coalesce((mob->>'energy')::numeric, (mob->>'power')::numeric, 0) <= 5000 then 24
    else 32 end
$$;

-- ── Отсеки: где семье вообще можно стоять (зеркало CN_ZONE_RULE) ──
-- band: 1 нос · 2 мидель · 3 корма; side: 'skin' нужен выход на борт, 'core' — вглубь.
create or replace function public._cn_zone_rule(p_fam text)
returns jsonb language sql immutable as $$
  select case p_fam
    when 'sensor'    then '{"band":[1,2],"side":"skin"}'::jsonb
    when 'jam'       then '{"band":[1,2,3],"side":"skin"}'::jsonb
    when 'dejam'     then '{"band":[1,2,3],"side":"skin"}'::jsonb
    when 'pd'        then '{"band":[1,2,3],"side":"skin"}'::jsonb
    when 'stealth'   then '{"band":[1,2,3],"side":"skin"}'::jsonb
    when 'hangar'    then '{"band":[2,3],"side":"core"}'::jsonb
    when 'ftl'       then '{"band":[2],"side":"core"}'::jsonb
    when 'stabil'    then '{"band":[2,3],"side":"core"}'::jsonb
    when 'interdict' then '{"band":[3]}'::jsonb
    else '{"band":[1,2,3]}'::jsonb end
$$;

-- ════════════════════════════════════════════════════════════
-- КАРТА ПЛАТЫ: разбор layout.bays по маске класса
-- ════════════════════════════════════════════════════════════
-- Возвращает jsonb:
--   { ok, w, h, bad:[индексы клеток, куда узел не встал],
--     load:{gs,energy,mass,hp,plates,guns},        -- железо разводки палубы
--     kcell:[множитель отдачи для каждой клетки],  -- 0 там, где модуля нет
--     conts:[{g,idx,k}]                            -- контуры: боевой эффект берётся отсюда
--   }
-- ⚠️ ДВА РАЗНЫХ СЧЁТА, И ЭТО НАМЕРЕННО. Платят за КЛЕТКУ (каждая — отдельная
-- коробка в ведомости и в экипаже), а работает КОНТУР: размер уже учтён внутри
-- множителя через fill (клеток / номинал), и складывать эффект ещё и по клеткам
-- значило бы считать размер дважды.
create or replace function public._cn_plate_map(p_class text, p_layout jsonb, p_db jsonb)
returns jsonb language plpgsql stable as $$
declare
  msk public.cn_deck_mask;
  W int; H int; N int;
  inside boolean[]; outer_ boolean[]; skin boolean[]; band int[];
  bays jsonb;
  own int[];                    -- own[i+1] = якорь занявшего клетку (0 = свободна)
  cellmod int[];                -- cellmod[i+1] = 1, если клетка занята модулем
  fam text[]; gkey text[];      -- семья и «группа|idx» модуля в клетке
  kcell numeric[];
  bad int[] := '{}';
  i int; j int; x0 int; y0 int; x int; y int; c int; fits bool;
  b jsonb; sk text; S jsonb; fw int; fh int;
  mm jsonb; mob jsonb; mfam text; rule jsonb;
  ld_gs numeric := 0; ld_e numeric := 0; ld_m numeric := 0; ld_hp numeric := 0;
  ld_pl numeric := 0; ld_gun int := 0;
  dirs int[][]; d int;
  -- контуры
  seen boolean[]; qq int[]; cells int[]; head int; cur int;
  anchor int; nom int; fillk numeric; famset text[] := '{}';
  cont_at int[] := '{}'; cont_fam text[] := '{}'; cont_k numeric[] := '{}';
  cont_cells jsonb := '[]'::jsonb; ci int;
  dil numeric; nb int; nbset int[]; sh numeric; bw int; bh int; lon int; shrt int;
  x1 int; y1 int; x2 int; y2 int; lin bool; sq bool;
  conts jsonb := '[]'::jsonb;   -- контуры для боевых эффектов: [{g,idx,k}]
  bcn int[] := '{}';            -- якоря усилителей, вставших на палубу
  bhits int; bmul numeric; kk numeric;
  cl int[];
begin
  select * into msk from public.cn_deck_mask where class = p_class;
  if not found then                             -- класс без палубы: синергии нет
    return jsonb_build_object('ok', true, 'w', 0, 'h', 0, 'bad', '[]'::jsonb,
      'load', jsonb_build_object('gs',0,'energy',0,'mass',0,'hp',0,'plates',0,'guns',0),
      'kcell', '[]'::jsonb, 'conts', '[]'::jsonb);
  end if;
  W := msk.w; H := msk.h; N := W * H;
  inside := public._cn_bits(msk.inside, N);
  outer_ := public._cn_bits(msk.outer_, N);
  skin   := public._cn_bits(msk.skin,   N);
  band   := (select array_agg(substr(msk.band, g, 1)::int order by g) from generate_series(1, N) g);
  bays   := coalesce(p_layout->'bays', '[]'::jsonb);
  -- ⚠️ ЛЕГАСИ. До «фактори из модулей» bays был коротким списком отсеков, а не
  -- решёткой: у живых дизайнов там 16-18 элементов вместо w*h. Читать их как
  -- координаты — значит свалить чужие модули в левый верхний угол и наказать
  -- игрока за наш же реворк. Такие раскладки считаем плоскими: множитель 1,
  -- геометрия не проверяется, разводки палубы нет.
  if jsonb_array_length(bays) <> N then
    return jsonb_build_object('ok', true, 'legacy', true, 'w', W, 'h', H, 'bad', '[]'::jsonb,
      'load', jsonb_build_object('gs',0,'energy',0,'mass',0,'hp',0,'plates',0,'guns',0),
      'kcell', '[]'::jsonb, 'conts', '[]'::jsonb);
  end if;
  own     := array_fill(0, array[N]);
  cellmod := array_fill(0, array[N]);
  kcell   := array_fill(0::numeric, array[N]);
  fam     := array_fill(null::text, array[N]);
  gkey    := array_fill(null::text, array[N]);

  -- ── РАЗМЕЩЕНИЕ: узлы разводки и клетки модулей ────────────────────────────
  -- Правило одно на всех: либо узел занимает ВСЕ свои клетки (в границах, по
  -- маске, свободные), либо не стоит вовсе и уходит в bad. Половинчатых нет.
  for i in 0..N-1 loop
    b := bays->i;
    if b is null or b = 'null'::jsonb then continue; end if;
    sk := b->>'sys';
    if sk is not null then
      S := public._cn_sys(sk);
      if S is null then bad := bad || i; continue; end if;
      x0 := i % W; y0 := i / W;
      if coalesce((S->>'outer')::bool, false) then
        -- НАВЕСНАЯ ЛЕНТА: len клеток подряд во внешнем поясе; ориентацию (вниз,
        -- вправо) ищем сами — пояс идёт то вдоль корпуса, то поперёк.
        cl := '{}'; fits := false;
        foreach d in array array[0,1] loop
          exit when fits;
          cl := '{}';
          for j in 0..(S->>'len')::int - 1 loop
            x := x0 + (case when d = 1 then j else 0 end);
            y := y0 + (case when d = 1 then 0 else j end);
            exit when x >= W or y >= H;
            c := y * W + x;
            exit when not outer_[c+1] or own[c+1] <> 0;
            cl := cl || c;
          end loop;
          if array_length(cl,1) = (S->>'len')::int then fits := true; end if;
        end loop;
        if not fits then bad := bad || i; continue; end if;
        foreach c in array cl loop own[c+1] := i + 1; end loop;
        ld_hp := ld_hp + 0.012 * coalesce((S->>'hp')::numeric,0) * (S->>'len')::int;   -- CN_ARMOR_PER_CELL
        ld_pl := ld_pl + (S->>'len')::int;
      else
        fw := (S->>'cw')::int; fh := (S->>'ch')::int;
        fits := (x0 + fw <= W) and (y0 + fh <= H);
        if fits then
          for y in y0..y0+fh-1 loop for x in x0..x0+fw-1 loop
            c := y * W + x;
            if not inside[c+1] or own[c+1] <> 0 then fits := false; end if;
          end loop; end loop;
        end if;
        if not fits then bad := bad || i; continue; end if;
        for y in y0..y0+fh-1 loop for x in x0..x0+fw-1 loop
          own[(y * W + x)+1] := i + 1;
        end loop; end loop;
        if (S ? 'gun') then ld_gun := ld_gun + 1; end if;
      end if;
      ld_gs := ld_gs + coalesce((S->>'gs')::numeric,0);
      ld_e  := ld_e  + coalesce((S->>'energy')::numeric,0);
      ld_m  := ld_m  + coalesce((S->>'mass')::numeric,0);
      continue;
    end if;
    -- модуль: одна клетка, внутри обшивки, свободная, в своём отсеке
    if (b->>'g') is null then continue; end if;
    mob := p_db->'modules'->(b->>'g')->coalesce((b->>'idx')::int,-1);
    if mob is null then raise exception 'bad module in layout'; end if;
    if not inside[i+1] or own[i+1] <> 0 then bad := bad || i; continue; end if;
    mfam := public._cn_mod_fam(mob);
    rule := public._cn_zone_rule(mfam);
    if not (band[i+1] = any (array(select jsonb_array_elements_text(rule->'band')::int))) then bad := bad || i; continue; end if;
    if rule->>'side' = 'skin' and not skin[i+1] then bad := bad || i; continue; end if;
    if rule->>'side' = 'core' and skin[i+1] then bad := bad || i; continue; end if;
    own[i+1] := i + 1; cellmod[i+1] := 1;
    fam[i+1] := mfam; gkey[i+1] := (b->>'g') || '|' || (b->>'idx');
  end loop;

  -- ── СЛИЯНИЕ В КОНТУРЫ: смежные клетки ОДНОГО И ТОГО ЖЕ модуля — один контур ──
  seen := array_fill(false, array[N]);
  dirs := array[array[-1,0],array[1,0],array[0,-1],array[0,1]];
  for i in 0..N-1 loop
    continue when cellmod[i+1] = 0 or seen[i+1];
    qq := array[i]; cells := '{}'; seen[i+1] := true;
    while array_length(qq,1) > 0 loop
      cur := qq[array_length(qq,1)]; qq := qq[1:array_length(qq,1)-1];
      cells := cells || cur;
      x := cur % W; y := cur / W;
      for d in 1..4 loop
        x0 := x + dirs[d][1]; y0 := y + dirs[d][2];
        continue when x0 < 0 or y0 < 0 or x0 >= W or y0 >= H;
        c := y0 * W + x0;
        continue when seen[c+1] or cellmod[c+1] = 0 or gkey[c+1] is distinct from gkey[i+1];
        seen[c+1] := true; qq := qq || c;
      end loop;
    end loop;
    anchor := (select min(e) from unnest(cells) e);
    cont_at := cont_at || anchor;
    cont_fam := cont_fam || fam[i+1];
    cont_cells := cont_cells || jsonb_build_array(to_jsonb(cells));
    -- недобор клеток бьёт по отдаче, перебор упирается в потолок 1.5
    mob := (p_db->'modules'->(split_part(gkey[i+1],'|',1)))->((split_part(gkey[i+1],'|',2))::int);
    nom := public._cn_mod_nominal(mob);
    cont_k := cont_k || least(1.5, array_length(cells,1)::numeric / nom);   -- пока это fill
    if fam[i+1] <> 'hull' and not (fam[i+1] = any(famset)) then famset := famset || fam[i+1]; end if;
    -- контур помечаем во всех своих клетках якорем, чтобы соседство считалось по контурам
    foreach c in array cells loop own[c+1] := anchor + 1; end loop;
  end loop;

  -- разбавление: чем больше РАЗНЫХ семей на борту, тем слабее каждая
  dil := 1.0 / (1 + 0.18 * greatest(0, coalesce(array_length(famset,1),0) - 1));

  -- усилители: якоря тех, что реально встали (не попали в bad)
  for i in 0..N-1 loop
    b := bays->i;
    continue when b is null or b = 'null'::jsonb or coalesce(b->>'sys','') <> 'beacon';
    continue when own[i+1] <> i + 1;                  -- усилитель не встал — не считается
    bcn := bcn || i;
  end loop;

  -- ── ОТДАЧА КОНТУРА: форма, соседи, разбавление, усилители ──────────────────
  for ci in 1..coalesce(array_length(cont_at,1),0) loop
    cells := (select array_agg(e::int) from jsonb_array_elements_text(cont_cells->(ci-1)) e);
    if cont_fam[ci] = 'hull' then                      -- корпусное не усиливается и не разбавляет
      foreach c in array cells loop kcell[c+1] := 1; end loop;
      conts := conts || jsonb_build_array(jsonb_build_object(
        'g', split_part(gkey[cont_at[ci]+1],'|',1), 'idx', split_part(gkey[cont_at[ci]+1],'|',2)::int, 'k', 1));
      continue;
    end if;
    -- ФОРМА (зеркало cnShapeBonus): жила — антенне, плотный контур — погребу
    sh := 1;
    if array_length(cells,1) >= 3 then
      select min(e % W), max(e % W), min(e / W), max(e / W) into x1, x2, y1, y2 from unnest(cells) e;
      bw := x2 - x1 + 1; bh := y2 - y1 + 1;
      lon := greatest(bw,bh); shrt := least(bw,bh);
      lin := (shrt = 1 and lon >= 3);
      sq  := (shrt >= 2 and lon <= shrt + 1 and array_length(cells,1) >= shrt * lon * 0.85);
      if     lin and cont_fam[ci] in ('sensor','jam','dejam','stealth')          then sh := 1.2;
      elsif  sq  and cont_fam[ci] in ('pd','hangar','ftl','stabil','interdict')  then sh := 1.2;
      elsif  lin and cont_fam[ci] in ('pd','hangar','ftl','stabil','interdict')  then sh := 0.85;
      elsif  sq  and cont_fam[ci] in ('sensor','jam','dejam','stealth')          then sh := 0.85;
      end if;
    end if;
    -- СОСЕДИ: сколько РАЗНЫХ контуров той же семьи касается нас гранью
    nbset := '{}';
    foreach cur in array cells loop
      x := cur % W; y := cur / W;
      for d in 1..4 loop
        x0 := x + dirs[d][1]; y0 := y + dirs[d][2];
        continue when x0 < 0 or y0 < 0 or x0 >= W or y0 >= H;
        c := y0 * W + x0;
        continue when cellmod[c+1] = 0 or own[c+1] = cont_at[ci] + 1 or own[c+1] = 0;
        continue when fam[c+1] is distinct from cont_fam[ci];
        if not (own[c+1] = any(nbset)) then nbset := nbset || own[c+1]; end if;
      end loop;
    end loop;
    nb := coalesce(array_length(nbset,1),0);
    -- УСИЛИТЕЛИ: первый +30%, второй +15%, третий +7%, дальше ничего.
    -- Достаёт, если ЛЮБАЯ клетка усилителя (квадрат 4×4 от якоря) в радиусе 6
    -- по Чебышёву от ЛЮБОЙ клетки контура — то есть якорь в коробке [-6, +3+6].
    bhits := (select count(*) from unnest(bcn) ba
               where exists (select 1 from unnest(cells) mc
                              where (mc % W) between (ba % W) - 6 and (ba % W) + 9
                                and (mc / W) between (ba / W) - 6 and (ba / W) + 9));
    bmul := 1
      + (case when bhits >= 1 then 0.30 else 0 end)
      + (case when bhits >= 2 then 0.15 else 0 end)
      + (case when bhits >= 3 then 0.07 else 0 end);

    kk := cont_k[ci] * sh * (1 + 0.22 * nb) * (case when nb >= 2 then 1.15 else 1 end) * dil * bmul;
    kk := greatest(0.25, least(2.2, kk));
    foreach c in array cells loop kcell[c+1] := kk; end loop;
    conts := conts || jsonb_build_array(jsonb_build_object(
      'g', split_part(gkey[cont_at[ci]+1],'|',1), 'idx', split_part(gkey[cont_at[ci]+1],'|',2)::int, 'k', kk));
  end loop;

  return jsonb_build_object(
    'ok', coalesce(array_length(bad,1),0) = 0, 'w', W, 'h', H,
    'bad', to_jsonb(bad),
    'load', jsonb_build_object('gs',ld_gs,'energy',ld_e,'mass',ld_m,'hp',ld_hp,'plates',ld_pl,'guns',ld_gun),
    'kcell', to_jsonb(kcell),
    -- ⚠️ БОЕВОЙ ЭФФЕКТ — НА КОНТУР, А НЕ НА КЛЕТКУ. Размер контура уже оплачен
    -- через fill (клеток / номинал, потолок 1.5); складывать эффект ещё и по
    -- каждой клетке — значит считать размер дважды. Панель верфи (cnDeckDraw)
    -- всегда суммировала по контурам, сервер — по клеткам; сходимся на контуре.
    'conts', conts);
end$$;

revoke all on function public._cn_plate_map(text, jsonb, jsonb) from public;
grant execute on function public._cn_plate_map(text, jsonb, jsonb) to authenticated, anon;
