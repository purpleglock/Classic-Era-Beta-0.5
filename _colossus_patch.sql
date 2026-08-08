-- ============================================================
-- ИМПЕРСКИЙ КОЛОСС · ПАТЧ ПУБЛИКАЦИИ (АВТОГЕН)
-- Источник: ЖИВЫЕ _cn_plate_map/_cn_recompute из базы + правки
-- tools/gen_colossus_patch.js. Руками не править — перегенерировать.
-- Применять ПОСЛЕ _colossus_hull.sql и _unit_catalog.sql.
-- ⚠️ Репозиторный _unit_publish.sql НЕ применён и его накат снесёт и это, и
-- заслон слотов: правки всегда снимаются с базы, а не с файла.
-- ============================================================

CREATE OR REPLACE FUNCTION public._cn_plate_map(p_class text, p_layout jsonb, p_db jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
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
  -- КОЛОСС: решётки в справочнике нет и быть не может — корпус у каждого проекта
  -- свой. Печём маску из data.hull (его прокидывает _cn_recompute в layout).
  if p_class = 'colossus' then
    msk := public._cn_hull_mask(p_layout->'hull');
  else
    select * into msk from public.cn_deck_mask where class = p_class;
  end if;
  if msk.w is null then                             -- класс без палубы: синергии нет
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
end$function$
;

CREATE OR REPLACE FUNCTION public._cn_recompute(p_cat text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  cab jsonb := public._cn_catalog();
  db jsonb; defs jsonb; bd jsonb;
  -- творческий корпус (Имперский колосс): параметры проекта и маска по ним
  v_hull jsonb; v_hmask public.cn_deck_mask; slotcap int;
  k text; cls jsonb; typeObj jsonb; reactObj jsonb; armorObj jsonb; shieldObj jsonb; engObj jsonb;
  radarObj jsonb; radar_ numeric := 0;
  v_tur public.faction_turrets;          -- своя турель из оружейной верфи
  v_reac jsonb;                          -- своя энергоустановка из реакторной верфи
  v_alloy public.faction_armor_alloys;   -- кастомный сплав брони (алхимия), если выбран
  -- база: штатная броня даёт лёгкую равномерную стойкость (+10% ко всем типам),
  -- чтобы «Броня цели» не читалась как ноль. Кастомный сплав (алхимия) её замещает
  -- своими типовыми стойкостями (создавая шов/уязвимость для контр-игры).
  armor_resist jsonb := jsonb_build_object('kinetic',0.1,'energy',0.1,'missile',0.1);
  a_rid text;
  v_aref jsonb;      -- эталон класса для сплава: {hp, resurs} (лучшая стоковая броня)
  v_amult numeric;   -- сила рецепта сплава относительно эталона
  v_abill numeric;   -- масштаб ведомости рецепта под класс
  hasType bool; hasReactor bool; hasEnergy bool; hasHangars bool;
  -- wgs — плоская цена своих орудий (оружейная верфь), поверх цены из сырья
  wgs numeric := 0;
  cost numeric := 0; econs numeric := 0; emax numeric := 0; on_ numeric; modon numeric;
  dmg numeric := 0; hp numeric; armor numeric; shield numeric; speed numeric; cargo numeric := 0;
  rng numeric := 0;   -- дальность огня в «квадратах» = max dalnost орудий (KV customParameter)
  crew numeric := 0; speedcoef jsonb;
  bill jsonb := '{}'::jsonb;
  kvres jsonb := '{}'::jsonb;   -- конструкционные решения (для цены ГС)
  w jsonb; m jsonb; h jsonb; hob jsonb; wob jsonb; mob jsonb; rec jsonb;
  q int; used int; kind text; wdmg numeric;
  -- division
  blk jsonb; mid text; cnt int; size numeric := 0; model jsonb; mbill jsonb; uid uuid; urow public.faction_units;
  rk text; rv numeric;
  m_armor numeric; m_atk numeric; m_dal numeric;
  -- боевые эффекты модулей (ПРО/РЭБ/маскировка/сенсор/ангары) → summary.mods
  mod_pd numeric := 0; mod_jam int := 0; mod_stealth int := 0; mod_sensor int := 0; mod_hangar numeric := 0;
  mod_dejam int := 0; mod_interdict bool := false; mod_stabil bool := false; mod_ftl bool := false;
  radar_eccm int := 0;   -- помехозащищённость выбранного радара
  d_count numeric := 0; sa numeric := 0; st numeric := 0; sd numeric := 0;
  ma numeric := 0; mt numeric := 0; md numeric := 0; pct numeric;
  -- ── палуба ──
  plate jsonb; pload jsonb; plate_k numeric := 0;   -- plate_k = прибавка HP от навесной брони
  mlist jsonb := '[]'::jsonb;    -- КЛЕТКИ: за них платят сырьём, ГС и экипажем
  clist jsonb := '[]'::jsonb;    -- КОНТУРЫ: они дают боевой эффект (с множителем)
  mk numeric;                    -- множитель отдачи текущего модуля
  n_cell int; bay jsonb; i int;
  kv_pow numeric := 0; kv_cap numeric := 0;         -- остаток энергосети и грузоподъёмности
begin
  if p_cat = 'division' then
    for blk in select * from jsonb_array_elements(coalesce(p_data->'blocks','[]'::jsonb)) loop
      mid := blk->>'modelId'; cnt := greatest(0, coalesce((blk->>'count')::int,0));
      if mid is null or cnt <= 0 then continue; end if;
      if left(mid,5) = 'tech:' then
        begin uid := substring(mid from 6)::uuid; exception when others then raise exception 'bad tech id'; end;
        select * into urow from public.faction_units where id = uid;
        if not found then raise exception 'tech design not found'; end if;
        -- доступность: своя / общедоступная / своей фракции
        if not (urow.owner_id = auth.uid() or urow.faction_id is null
                or urow.faction_id = public._ec_my_fid_opt()) then raise exception 'tech design not accessible'; end if;
        cost := cost + coalesce((urow.summary->>'cost')::numeric,0) * cnt;
        size := size + coalesce((cab->'techSize'->>urow.category)::numeric,200) * cnt;
        mbill := coalesce(urow.summary->'bill','{}'::jsonb);
        m_armor := coalesce((urow.summary->>'armor')::numeric,0) + coalesce((urow.summary->>'hp')::numeric,0);
        m_atk := coalesce((urow.summary->>'dmg')::numeric,0);
        m_dal := coalesce((urow.summary->>'dalnost')::numeric,0);
      else
        select e into model from jsonb_array_elements(cab->'divData') e where e->>'id' = mid limit 1;
        if model is null then raise exception 'division model not found: %', mid; end if;
        cost := cost + coalesce((model->>'cost')::numeric,0) * cnt;
        size := size + coalesce((model->>'size')::numeric,0) * cnt;
        mbill := coalesce(model->'bill','{}'::jsonb);
        m_armor := coalesce((model->>'armorhp')::numeric,0);
        m_atk := coalesce((model->>'atack')::numeric,0);
        m_dal := coalesce((model->>'dalnost')::numeric,0);
      end if;
      for rk, rv in select key, (value)::numeric from jsonb_each_text(mbill) loop
        bill := public._cn_bill_add(bill, rk, rv * cnt);
      end loop;
      d_count := d_count + cnt; sa := sa + m_armor*cnt; st := st + m_atk*cnt; sd := sd + m_dal*cnt;
      if m_armor > ma then ma := m_armor; end if;
      if m_atk > mt then mt := m_atk; end if;
      if m_dal > md then md := m_dal; end if;
    end loop;
    if size > (cab->>'divCap')::numeric then raise exception 'division exceeds size cap'; end if;
    pct := round(size / (cab->>'divCap')::numeric * 100, 1);
    return jsonb_build_object('cost', cost, 'size', size, 'bill', bill, 'percent', pct, 'count', d_count,
      'midArmor', case when d_count>0 then round(sa/d_count,1) else 0 end, 'maxArmor', ma,
      'midAtk',   case when d_count>0 then round(st/d_count,1) else 0 end, 'maxAtk', mt,
      'midRange', case when d_count>0 then round(sd/d_count,1) else 0 end, 'maxRange', md);
  end if;

  -- ── ТЕХНИКА (ship / ground / aviation) ──
  db := cab->p_cat; defs := cab->'defs'->p_cat; bd := cab->'billDiv'->p_cat;
  if db is null or defs is null then raise exception 'bad category'; end if;
  hasType := (defs->>'hasType')::bool; hasReactor := (defs->>'hasReactor')::bool;
  hasEnergy := (defs->>'hasEnergy')::bool; hasHangars := (defs->>'hasHangars')::bool;
  k := p_data->>'class'; cls := db->'data'->k;
  if cls is null then raise exception 'bad class'; end if;
  -- ── ТВОРЧЕСКИЙ КОРПУС ──────────────────────────────────────────────────────
  -- У колосса ТТХ класса в каталоге — только эталон «корпуса по умолчанию».
  -- Настоящие масса/экипаж/трюм/сырьё/цена и потолок отсеков считаются от площади
  -- нарисованного корпуса, а сама фигура — из САНИРОВАННОЙ маски (один кусок,
  -- обрезка полей, зажим габарита канвы), а не из того, что прислал клиент.
  -- ⚠️ Потолка площади нет намеренно: предел — канва и цена (квадратичная от
  -- площади), см. _cn_colossus_cls. Мелочь отсекаем: колосс начинается с 40 клеток.
  if k = 'colossus' then
    v_hull := public._cn_hull_sane(p_data->'hull');
    v_hmask := public._cn_hull_mask(v_hull);
    if v_hmask.cells < (public._cn_col_lim()->>'min')::int then
      raise exception 'корпус слишком мал: % клеток, колосс начинается с %',
        v_hmask.cells, (public._cn_col_lim()->>'min')::int;
    end if;
    cls := public._cn_colossus_cls(cls, v_hmask.cells);
  end if;
  modon := (cls->>'modON')::numeric; on_ := (cls->>'baseON')::numeric;

  if hasType then typeObj := cls->'types'->coalesce((p_data->>'type')::int,0); if typeObj is null then raise exception 'bad type'; end if; end if;
  if hasReactor then
    -- СВОЯ УСТАНОВКА ВЕДУЩАЯ. Индекс в db.reactors мог сместиться (игрок
    -- зарегистрировал ещё один реактор), стабилен только reactorId — по нему
    -- и берём ТТХ, пересчитанные сервером в реакторной верфи (_cn_reac_obj).
    -- Заодно проверяем, что установка спроектирована под ЭТОТ класс: иначе
    -- корвет унёс бы дредноутный реактор.
    if coalesce(p_data->>'reactorId','') <> '' then
      v_reac := public._cn_reac_obj((p_data->>'reactorId')::uuid);
      if v_reac is null then raise exception 'bad reactor: установка не найдена'; end if;
      if v_reac->>'_klass' is distinct from k then
        raise exception 'реактор спроектирован под другой класс (%)', v_reac->>'_klass';
      end if;
      reactObj := v_reac;
    else
      reactObj := db->'reactors'->k->coalesce((p_data->>'reactor')::int,0);
    end if;
    if reactObj is null then raise exception 'bad reactor'; end if;
  end if;
  -- Броня: кастомный сплав (алхимия) по стабильному id ИЛИ индекс каталога.
  -- Сплав пересчитан авторитетно при регистрации (armor_alloy_upsert) — берём его
  -- material/hpBoost/стойкости, клиентским цифрам не доверяем. HP = эталон класса ×
  -- сила рецепта; resurs = сырьё эталона × та же сила (ГС-цена), а расход постройки —
  -- САМ РЕЦЕПТ ниже, масштабированный классом (v_abill).
  if nullif(p_data->>'armorAlloyId','') is not null then
    select * into v_alloy from public.faction_armor_alloys where id = (p_data->>'armorAlloyId')::uuid;
    if v_alloy.id is null then raise exception 'bad alloy'; end if;
    v_aref := public._cn_alloy_ref(cls, db->'armors'->k);
    armorObj := jsonb_build_object(
      'material',       v_alloy.stats->'material',
      'category',       v_alloy.stats->>'category',
      'hpBoost',        coalesce(v_alloy.stats->'hpBoost', to_jsonb(0)),
      'hpPercentBoost', coalesce(v_alloy.stats->'hpPercentBoost', to_jsonb(0)),
      'capacityBoost',  coalesce(v_alloy.stats->'capacityBoost', to_jsonb(0)),
      'armor',          coalesce(v_alloy.stats->'hpBoost', to_jsonb(0)),
      'quality',        coalesce(v_alloy.stats->'quality', to_jsonb(1)),   -- качество рецепта
      '_alloy',         true,                                             -- ветка «эталон класса» в _cn_kv_armor_hp
      '_refHp',         v_aref->'hp'                                      -- база: лучшая стоковая броня класса
    );
    v_amult := public._cn_alloy_mult(armorObj);
    -- Сплав НЕ бесплатный: конструкц. resurs = сырьё эталонной брони × сила рецепта
    -- (идёт в ГС-цену), а ведомость постройки = САМ РЕЦЕПТ, масштабированный классом.
    armorObj := armorObj || jsonb_build_object(
      'armor', round((v_aref->>'hp')::numeric * v_amult),
      'resurs', jsonb_build_object(
        'blackmetall',   round(coalesce((v_aref->'resurs'->>'blackmetall')::numeric,0)   * v_amult),
        'coloredmetall', round(coalesce((v_aref->'resurs'->>'coloredmetall')::numeric,0) * v_amult),
        'rudametall',    round(coalesce((v_aref->'resurs'->>'rudametall')::numeric,0)    * v_amult),
        'kristall',      round(coalesce((v_aref->'resurs'->>'kristall')::numeric,0)      * v_amult),
        'staarvis',      round(coalesce((v_aref->'resurs'->>'staarvis')::numeric,0)      * v_amult)));
    -- CN_ALLOY_BILL_REF = 12800 (HP-якорь «полной» ведомости, ≈ царь-цитадель)
    v_abill := greatest(0.02, least(1, (v_aref->>'hp')::numeric / 12800)) * v_amult;
    armor_resist := coalesce(v_alloy.stats->'resist', armor_resist);
  else
    armorObj := db->'armors'->k->coalesce((p_data->>'armor')::int,0);
    if armorObj is null then raise exception 'bad armor'; end if;
  end if;
  shieldObj := db->'shields'->k->coalesce((p_data->>'shield')::int,0); if shieldObj is null then raise exception 'bad shield'; end if;
  engObj    := db->'engines'->k->coalesce((p_data->>'engine')::int,0); if engObj    is null then raise exception 'bad engine'; end if;
  -- Радар (KV.modules5): idx 0 = «Не выбран» — в расчёт не идёт (зеркало cnVehCalc)
  if coalesce((p_data->>'radar')::int,0) > 0 then
    radarObj := db->'radars'->k->((p_data->>'radar')::int);
    if radarObj is null then raise exception 'bad radar'; end if;
  end if;

  -- ── ПАЛУБА: разбор раскладки по маске класса ───────────────────────────────
  plate := public._cn_plate_map(k,
    coalesce(p_data->'layout','{}'::jsonb) || jsonb_build_object('hull', v_hull), db);
  pload := plate->'load';
  plate_k := coalesce((pload->>'hp')::numeric, 0);
  if not coalesce((plate->>'ok')::bool, true) then
    raise exception 'раскладка палубы не сходится: % узлов вне обшивки или внахлёст',
      jsonb_array_length(plate->'bad');
  end if;

  -- СОСТАВ МОДУЛЕЙ. Решётка главнее плоского списка — иначе в modules можно
  -- заплатить за три коробки, а в bays поставить тридцать.
  if coalesce((plate->>'legacy')::bool, false) or coalesce((plate->>'w')::int,0) = 0 then
    -- легаси: коробки поштучно, синергии нет — каждая сама себе контур
    for m in select * from jsonb_array_elements(coalesce(p_data->'modules','[]'::jsonb)) loop
      mlist := mlist || jsonb_build_array(jsonb_build_object('g', m->>'g', 'idx', (m->>'idx')::int, 'k', 1));
    end loop;
    clist := mlist;
  else
    n_cell := (plate->>'w')::int * (plate->>'h')::int;
    for i in 0..n_cell-1 loop
      bay := p_data->'layout'->'bays'->i;
      continue when bay is null or bay = 'null'::jsonb or (bay->>'g') is null;
      mlist := mlist || jsonb_build_array(jsonb_build_object(
        'g', bay->>'g', 'idx', (bay->>'idx')::int,
        'k', coalesce((plate->'kcell'->>i)::numeric, 1)));
    end loop;
    clist := plate->'conts';
  end if;
  -- ПОТОЛОК СЛОТОВ (страховка от прямой записи; форму держит маска палубы)
  -- Потолок слотов у колосса тоже плавает вместе с корпусом (страховка от прямой
  -- записи; форму по-прежнему держит маска палубы).
  slotcap := case when k = 'colossus' then greatest(4, (cls->>'modul')::int * 2)
                  else public._cn_mod_slots(k) end;
  if jsonb_array_length(mlist) > slotcap then
    raise exception 'модулей больше предела класса: % при потолке %',
      jsonb_array_length(mlist), slotcap;
  end if;

  -- ЦЕНА: собираем конструкционные решения (resurs) с корпуса и компонентов,
  -- итог считаем через _cn_kv_cost. Млн-прайсы Кваквантора в цену НЕ идут.
  kvres := public._cn_res_add(kvres, cls, 1);
  kvres := public._cn_res_add(kvres, reactObj, 1);
  kvres := public._cn_res_add(kvres, engObj, 1);
  -- навесные плиты = то же сырьё брони, что и основное бронирование (зеркало клиента)
  kvres := public._cn_res_add(kvres, armorObj, 1 + plate_k);
  kvres := public._cn_res_add(kvres, shieldObj, 1);
  kvres := public._cn_res_add(kvres, radarObj, 1);
  if hasEnergy then econs := coalesce((shieldObj->>'energy')::numeric,0) + coalesce((engObj->>'energy')::numeric,0); end if;

  -- оружие
  for w in select * from jsonb_array_elements(coalesce(p_data->'weapons','[]'::jsonb)) loop
    q := greatest(0, coalesce((w->>'q')::int,1));
    -- ⚠ орудия оружейной верфи ({turretId}) в каталоге Кваквантора не лежат —
    -- резолв только через _cn_wpn_obj, иначе свой ствол = 'bad weapon'
    wob := public._cn_wpn_obj(db, k, w);
    kvres := public._cn_res_add(kvres, wob, q); on_ := on_ + q * modon;
    wgs := wgs + coalesce((wob->>'_gs')::numeric, 0) * q;
    wdmg := (wob->>'dmg')::numeric; dmg := dmg + wdmg * q;
    rng := greatest(rng, coalesce((wob->>'dalnost')::numeric, 0));
    if hasEnergy then econs := econs + coalesce((wob->>'energy')::numeric,0) * q; end if;
    kind := public._cn_wpn_kind(wob->>'name');
    if kind = 'missile' then bill := public._cn_bill_add(bill,'Изотопы', wdmg/150*q);
    elsif kind = 'energy' then bill := public._cn_bill_add(bill,'Редкоземельные руды', wdmg/180*q);
                              bill := public._cn_bill_add(bill,'Гелий-3', wdmg/400*q);
    else bill := public._cn_bill_add(bill,'Железо', wdmg/120*q); end if;
  end loop;

  -- модули: сырьё из конструкционных решений (resurs, зеркало cnUnitBill) +
  -- агрегат боевых эффектов combat → summary.mods (читает боёвка, _bt_stats)
  for m in select * from jsonb_array_elements(mlist) loop
    mob := db->'modules'->(m->>'g')->coalesce((m->>'idx')::int,-1);
    if mob is null then raise exception 'bad module'; end if;
    kvres := public._cn_res_add(kvres, mob, 1); on_ := on_ + modon;
    if hasEnergy then econs := econs + coalesce((mob->>'energy')::numeric,0); end if;
    bill := public._cn_bill_add(bill,'Железо',              coalesce((mob->'resurs'->>'blackmetall')::numeric,0)/20);
    bill := public._cn_bill_add(bill,'Медь',                coalesce((mob->'resurs'->>'coloredmetall')::numeric,0)/20);
    bill := public._cn_bill_add(bill,'Титан',               coalesce((mob->'resurs'->>'rudametall')::numeric,0)/20);
    bill := public._cn_bill_add(bill,'Редкоземельные руды', coalesce((mob->'resurs'->>'kristall')::numeric,0)/20);
    bill := public._cn_bill_add(bill,'Стелларит',           coalesce((mob->'resurs'->>'staarvis')::numeric,0)/20);
  end loop;

  -- ── БОЕВЫЕ ЭФФЕКТЫ: ПО КОНТУРАМ, С МНОЖИТЕЛЕМ РАССТАНОВКИ ────────────────────
  -- ⚠️ ЗДЕСЬ И ЕСТЬ ВЕСЬ СМЫСЛ РАСКЛАДКИ. Раньше сервер складывал combat по
  -- КЛЕТКАМ и без множителя: место на палубе не решало ничего, а панель верфи
  -- показывала другое число. Считаем как панель — на контур, ×k (соседство,
  -- форма, разбавление, усилители). Суммируемое масштабируется, у РЭБ и
  -- контр-РЭБ берётся максимум: там сильнее не сумма, а лучший излучатель.
  for m in select * from jsonb_array_elements(clist) loop
    mob := db->'modules'->(m->>'g')->coalesce((m->>'idx')::int,-1);
    if mob is null then raise exception 'bad module'; end if;
    mk := coalesce((m->>'k')::numeric, 1);
    mod_pd      := mod_pd      + coalesce((mob->'combat'->>'pd')::numeric,0) * mk;
    mod_jam     := greatest(mod_jam, round(coalesce((mob->'combat'->>'jam')::numeric,0) * mk)::int);
    mod_stealth := mod_stealth + round(coalesce((mob->'combat'->>'stealth')::numeric,0) * mk)::int;
    mod_sensor  := mod_sensor  + round(coalesce((mob->'combat'->>'sensor')::numeric,0) * mk)::int;
    mod_hangar  := mod_hangar  + coalesce((mob->'combat'->>'hangar')::numeric,0) * mk;
    mod_dejam   := greatest(mod_dejam, round(coalesce((mob->'combat'->>'dejam')::numeric,0) * mk)::int);
    mod_interdict := mod_interdict or coalesce((mob->'combat'->>'interdict')::int,0) > 0;
    mod_stabil    := mod_stabil    or coalesce((mob->'combat'->>'stabil')::int,0) > 0;
    mod_ftl       := mod_ftl       or coalesce((mob->'combat'->>'ftl')::int,0) > 0;
  end loop;

  -- ЗАСЛОН: модули интердикции / стабилизатора — только линкор и дредноут
  -- (зеркало modules_ids: раньше их ставили на что угодно и заваливали ими бои)
  if (mod_interdict or mod_stabil) and k not in ('battleship','dreadnought','ss13') then
    raise exception 'модули интердикции и стабилизатора доступны только линкорам, дредноутам и станциям';
  end if;

  -- ангары (только корабли)
  if hasHangars then
    for h in select * from jsonb_array_elements(coalesce(p_data->'hangars','[]'::jsonb)) loop
      select e into hob from jsonb_array_elements(db->'hangarTypes') e where (e->>'id')::int = (h->>'id')::int limit 1;
      if hob is null then raise exception 'bad hangar'; end if;
      kvres := public._cn_res_add(kvres, hob, 1); on_ := on_ + modon; econs := econs + coalesce((hob->>'energy')::numeric,0);
      if (hob->>'canHaveUnits')::bool = false then cargo := cargo + coalesce((hob->>'capacity')::numeric,0); end if;
      used := 0;
      for rec in select * from jsonb_array_elements(coalesce(h->'units','[]'::jsonb)) loop
        used := used + coalesce((db->'airUnits'->((rec#>>'{}')::int)->>'points')::int, 0);
      end loop;
      if used > (hob->>'capacity')::int then raise exception 'hangar overload'; end if;
      bill := public._cn_bill_add(bill,'Титан', coalesce((hob->>'capacity')::numeric,0)/12);
    end loop;
  end if;

  -- ТТХ — СИНТЕЗ (KV): прочность от физики брони, скорость в «квадратах», экипаж-сумма.
  -- armor свёрнут в HP (как в клиенте). cost/on/ведомость — прежние (экономика не трогается).
  speedcoef := cab->'speedcoef';
  -- навесная лента добавляет к прочности ровно столько, сколько заняла клеток
  hp := round(public._cn_kv_armor_hp(cls, armorObj) * (1 + plate_k));
  armor := 0;
  shield := coalesce((shieldObj->>'shield')::numeric,0);
  speed := public._cn_kv_speed(cls, k, reactObj, engObj, speedcoef);
  emax := coalesce((reactObj->>'energy')::numeric,0);
  crew := coalesce((cls->>'crewRequired')::numeric,0);
  if radarObj is not null then
    crew := crew + coalesce((radarObj->>'crewRequired')::numeric,0);
    radar_ := coalesce((radarObj->'customParameterradar'->>'dalnost')::numeric,0);
    -- активные станции раскачиваются реактором: +1 кв за pwrPer E, кап pwrCap (зеркало cnVehCalc)
    if coalesce((radarObj->'customParameterradar'->>'pwrPer')::numeric,0) > 0 then
      radar_ := radar_ + least(coalesce((radarObj->'customParameterradar'->>'pwrCap')::numeric,0),
                               floor(coalesce((reactObj->>'energy')::numeric,0)
                                     / (radarObj->'customParameterradar'->>'pwrPer')::numeric));
    end if;
    radar_eccm := coalesce((radarObj->'customParameterradar'->>'eccm')::int,0);
  end if;
  for w in select * from jsonb_array_elements(coalesce(p_data->'weapons','[]'::jsonb)) loop
    wob := public._cn_wpn_obj(db, k, w);
    if wob is not null then crew := crew + coalesce((wob->>'crewRequired')::numeric,0) * greatest(0,coalesce((w->>'q')::int,1)); end if;
  end loop;
  for m in select * from jsonb_array_elements(mlist) loop
    mob := db->'modules'->(m->>'g')->coalesce((m->>'idx')::int,-1);
    if mob is not null then crew := crew + coalesce((mob->>'crewRequired')::numeric,0); end if;
  end loop;
  if hasEnergy and econs > emax then raise exception 'energy overload'; end if;

  -- ── ЭНЕРГОСЕТЬ И ГРУЗОПОДЪЁМНОСТЬ: ЖЁСТКИЙ ГЕЙТ (зеркало kv.power / kv.cap) ──
  -- Это единственное, что не даёт навесить на корвет линкорную батарею: не
  -- «предупреждение на верфи», а отказ публикации. Железо палубы тоже висит на
  -- реакторе и в трюме — иначе узлы и плиты ставились бы бесплатно.
  kv_pow := coalesce((reactObj->>'power')::numeric,0)
          - coalesce((engObj->>'power')::numeric,0)
          - coalesce((shieldObj->>'power')::numeric,0)
          - coalesce((radarObj->>'power')::numeric,0)
          - coalesce((pload->>'energy')::numeric,0);
  kv_cap := coalesce((cls->>'capacity')::numeric,0)
          + coalesce((armorObj->>'capacityBoost')::numeric,0)
          + coalesce((engObj->>'capacityBoost')::numeric,0)
          -- Своя энергоустановка грузит шасси в единицах нагрузки (зеркало cnVehCalc);
          -- у каталожных реакторов этого поля нет — они бесплатны по грузу.
          - coalesce((reactObj->>'capacityPenalty')::numeric,0)
          + coalesce((reactObj->>'capacityBoost')::numeric,0)
          - coalesce((radarObj->>'capacityPenalty')::numeric,0)
          - coalesce((pload->>'mass')::numeric,0);
  for w in select * from jsonb_array_elements(coalesce(p_data->'weapons','[]'::jsonb)) loop
    q := greatest(0, coalesce((w->>'q')::int,1));
    if nullif(w->>'turretId','') is not null then
      -- СВОЯ ТУРЕЛЬ. Записи вида {turretId,q} не лежат в db->'weapons', и старый
      -- резолв по g/idx промахивался: орудие с верфи не отнимало у гейта ни ⚡,
      -- ни трюма. Клиент (cnTurretToWeapon) их считал всегда, так что дизайн,
      -- прошедший верфь, гейт проходит тоже — это закрытие дыры, не ужесточение.
      select * into v_tur from public.faction_turrets where id = (w->>'turretId')::uuid;
      if found then
        kv_pow := kv_pow - coalesce((v_tur.stats->>'energy')::numeric,0) * q;
        -- зеркало CN_LOAD_DIV: ship 500, всё остальное 100
        kv_cap := kv_cap - round(coalesce((v_tur.stats->>'mass')::numeric,0)
                                 / case when p_cat = 'ship' then 500 else 100 end) * q;
      end if;
    else
      wob := db->'weapons'->(w->>'g')->coalesce((w->>'idx')::int,-1);
      if wob is not null then
        kv_pow := kv_pow - coalesce((wob->>'power')::numeric,0) * q;
        kv_cap := kv_cap - coalesce((wob->>'capacityPenalty')::numeric,0) * q;
      end if;
    end if;
  end loop;
  for m in select * from jsonb_array_elements(mlist) loop
    mob := db->'modules'->(m->>'g')->coalesce((m->>'idx')::int,-1);
    if mob is not null then
      kv_pow := kv_pow - coalesce((mob->>'power')::numeric,0);
      kv_cap := kv_cap + coalesce((mob->>'capacity')::numeric,0);
    end if;
  end loop;
  if round(kv_pow) < 0 then
    raise exception 'энергосеть перегружена: не хватает % ⚡ — нужен мощнее реактор', -round(kv_pow);
  end if;
  if round(kv_cap) < 0 then
    raise exception 'превышена грузоподъёмность: перегруз % — снимите оснастку', -round(kv_cap);
  end if;

  -- ведомость: корпус + компоненты (зеркало cnUnitBill)
  for rk, rv in select key, (value)::numeric from jsonb_each_text(coalesce(cab->'hullBill'->p_cat->k,'{}'::jsonb)) loop
    bill := public._cn_bill_add(bill, rk, rv);
  end loop;
  if v_alloy.id is not null then
    -- Кастомный сплав: постройка потребляет ИМЕННО рецепт (реальные ресурсы).
    for a_rid in select key from jsonb_each(coalesce(v_alloy.recipe,'{}'::jsonb)) loop
      bill := public._cn_bill_add(bill, public._aa_name(a_rid), (v_alloy.recipe->>a_rid)::numeric * coalesce(v_abill,1));
    end loop;
  else
    bill := public._cn_bill_add(bill,'Железо', (armorObj->>'armor')::numeric / (bd->>'armorFe')::numeric);
    bill := public._cn_bill_add(bill,'Титан',  (armorObj->>'armor')::numeric / (bd->>'armorTi')::numeric);
  end if;
  if shield > 0 then
    bill := public._cn_bill_add(bill,'Редкоземельные руды', shield / (bd->>'shRare')::numeric);
    bill := public._cn_bill_add(bill,'Дейтерий', shield / (bd->>'shDeu')::numeric);
  end if;
  if bd ? 'engFuel' then
    bill := public._cn_bill_add(bill,'Метан', coalesce((engObj->>'energy')::numeric,0) / (bd->>'engFuel')::numeric);
    bill := public._cn_bill_add(bill,'Дейтерий', coalesce((engObj->>'energy')::numeric,0) / (bd->>'engDeu')::numeric);
  else
    bill := public._cn_bill_add(bill,'Железо', 1);
  end if;
  if reactObj is not null and (reactObj ? '_fuelBill') then
    -- Своя установка: топливо и теплоноситель выбраны игроком, и верфь уже
    -- посчитала закладку — берём её как есть, а не каталожные изотопы.
    -- Зеркало cnUnitBill в constructors.js.
    bill := (select public._cn_bill_add_many(bill, reactObj->'_fuelBill'));
  elsif reactObj is not null and (bd ? 'reIso') then
    bill := public._cn_bill_add(bill,'Изотопы', coalesce((reactObj->>'energy')::numeric,0) / (bd->>'reIso')::numeric);
    bill := public._cn_bill_add(bill,'Гелий-3', coalesce((reactObj->>'energy')::numeric,0) / (bd->>'reHe')::numeric);
  end if;

  -- Железо палубы (башни, погоны, приводы, плиты) стоит своих ГС и своего сырья —
  -- ⚠️ иначе разводка выходит бесплатной: ставь сколько влезет.
  if coalesce((pload->>'gs')::numeric,0) > 0 then
    bill := public._cn_bill_add(bill,'Железо', (pload->>'gs')::numeric / 40);
    bill := public._cn_bill_add(bill,'Титан',  (pload->>'gs')::numeric / 120);
  end if;

  -- Итоговая цена ГС из конструкционных решений (зеркало cnKvCost).
  cost := public._cn_kv_cost(kvres, k) + coalesce((pload->>'gs')::numeric,0) + wgs;

  return jsonb_build_object(
    'cost', cost, 'on', round(on_,1), 'hp', hp, 'armor', armor, 'shield', shield,
    'dmg', dmg, 'speed', speed, 'crew', crew, 'radar', radar_, 'rng', rng, 'speedUnit', 'квадрат',
    'eCons', econs, 'eMax', emax, 'energy', hasEnergy,
    'cargo', cargo, 'bill', bill,
    -- разводка палубы и остатки бюджетов: чтобы карточка показывала то же, что верфь
    'deck', pload, 'kvPower', round(kv_pow), 'kvCap', round(kv_cap),
    'armor_resist', armor_resist,   -- стойкости брони к типам урона (для боёвки)
    -- боевые эффекты модулей: ПРО (кап 0.6), РЭБ (радиус 5), маскировка, сенсор, авиакрылья
    'mods', jsonb_build_object(
      'pd', least(0.6, mod_pd), 'jam', mod_jam, 'stealth', mod_stealth,
      'sensor', mod_sensor, 'hangar', mod_hangar,
      'dejam', mod_dejam, 'interdict', mod_interdict, 'stabil', mod_stabil,
      'ftl', mod_ftl,
      'eccm', radar_eccm),
    'hull', v_hull, 'hullCells', v_hmask.cells,
    'className', cls->>'name', 'typeName', coalesce(typeObj->>'name',''));
end$function$
;
