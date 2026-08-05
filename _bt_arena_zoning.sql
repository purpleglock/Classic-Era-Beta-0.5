-- ════════════════════════════════════════════════════════════════════════
-- ЗОНИРОВАНИЕ АРЕНЫ: ландшафт как планировка, а не как шум
-- Применять ПОСЛЕ _bt_arena_shape.sql (форма/сектора) и _war_battle_tactics.sql.
-- ────────────────────────────────────────────────────────────────────────
-- Было (_bt_gen_terrain из _bt_arena_shape.sql): 12 случайных «кистей»
-- блуждают от случайных точек. Итог — рваная сыпь без смысла: коридоров
-- нет, укрытия там, где повезло, обход ничем не отличается от лобовой.
-- Мехами боя (сектора орудий, инерция поворота, дальностные полосы,
-- захват радаром) играть негде — все дороги одинаковые.
--
-- Стало: карта СОБИРАЕТСЯ из ролевых элементов вокруг ОСИ БОЯ (линии
-- «якорь атакующего → якорь защитника»). Роли — в терминах наших же
-- эффектов ландшафта, без единой подписи на доске:
--
--   ЯДРО в центре          — плотная свалка ast с проходами. Точка
--                            схождения: линия огня рвётся, стрелять
--                            приходится с коротких дистанций.
--   ГРЯДЫ вдоль оси        — два барьера ast делят поле на ТРИ коридора
--                            (центр + два фланга). Обход перестал быть
--                            «то же самое, но левее».
--   ЧОКПОИНТЫ              — разрывы в грядах шириной в пару гексов,
--                            обрамлённые deb (ход из обломков короче на 1).
--                            Проход через створ стоит темпа — его держат.
--   СКАЛЫ на средней       — одиночные ast с открытым простреливаемым
--                            коридором за спиной: позиция для дальнобоя,
--                            который бьёт из полосы R-1..R и прячется.
--   КАРМАНЫ на флангах     — neb (щиты в 0, входящий урон ×0.7) в обкладке
--                            deb: место оттащить битый корпус и не умереть.
--   КОЛОДЦЫ grv            — на самых широких обходах: цена быстрого крюка.
--
-- ЧЕСТНОСТЬ. Всё, что кладётся в точке (a,p) оси, зеркалится в (−a,−p).
-- Точечная симметрия относительно центра арены: какой бы конец оси тебе
-- ни достался, набор возможностей тот же. Асимметрию даёт только форма
-- арены (кромка линзы/кольца) — она и так случайна.
--
-- АРХЕТИПЫ (сид = id боя):
--   belt     ядро + две гряды + скалы + карманы   — три коридора, классика
--   pillars  без гряд, поле симметричных скал     — открытая, манёвренная
--   strait   гряда ПОПЕРЁК оси с двумя створами   — жёсткие ворота
--
-- ⚠ ПРОИЗВОДИТЕЛЬНОСТЬ. Планировка кладёт ~150–250 клеток вместо ~60.
--   Старый `_bt_terra` — линейный скан jsonb-массива, и он зовётся в
--   горячих циклах хода бота (см. 57014 в истории). Поэтому terrain для
--   новых боёв хранится ОБЪЕКТОМ {"x:y":"ast"} — доступ за хеш, скан
--   исчез. Старые бои лежат массивом; обе формы читаются.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1) Ландшафт двух форм: объект (новый) и массив (легаси) ─────────────

-- Доступ к клетке. Объект — за хеш; массив — прежним сканом.
create or replace function public._bt_terra(t jsonb, px int, py int)
returns text language sql immutable as $$
  select case
    when t is null then null
    when jsonb_typeof(t) = 'object' then t ->> (px || ':' || py)
    else (select e->>'t' from jsonb_array_elements(t) e
           where (e->>'x')::int = px and (e->>'y')::int = py limit 1)
  end;
$$;

-- Перечисление всех клеток ландшафта — для тех мест, где нужен обход
-- (колодцы в конце хода, отрисовка, диагностика). Скрывает форму хранения.
create or replace function public._bt_terra_list(t jsonb)
returns table(x int, y int, k text) language sql immutable as $$
  select case when jsonb_typeof(t) = 'object' then split_part(kv.key, ':', 1)::int
              else (kv.value->>'x')::int end,
         case when jsonb_typeof(t) = 'object' then split_part(kv.key, ':', 2)::int
              else (kv.value->>'y')::int end,
         case when jsonb_typeof(t) = 'object' then kv.value #>> '{}'
              else kv.value->>'t' end
    from jsonb_each(case when jsonb_typeof(coalesce(t,'[]'::jsonb)) = 'object'
                         then t else '{}'::jsonb end) kv
   union all
  select (e->>'x')::int, (e->>'y')::int, e->>'t'
    from jsonb_array_elements(case when jsonb_typeof(coalesce(t,'{}'::jsonb)) = 'array'
                                   then t else '[]'::jsonb end) e;
$$;

-- ── 2) Кисти планировки ────────────────────────────────────────────────

-- Клетку можно занять? Внутри арены и вне обоих секторов подхода.
create or replace function public._bt_zok(sh jsonb, sp jsonb, px int, py int)
returns boolean language sql immutable as $$
  select public._bt_in_arena(sh, px, py)
     and not coalesce(public._bt_in_spawn(sp, 'att', px, py), false)
     and not coalesce(public._bt_in_spawn(sp, 'def', px, py), false);
$$;

-- Ось боя → доска. (a,p) — вдоль оси и поперёк неё, нормированные; phi —
-- курс оси. Возвращает гекс.
create or replace function public._bt_ax(sh jsonb, phi numeric, a numeric, p numeric)
returns int[] language sql immutable as $$
  select public._bt_denorm(coalesce((sh->>'w')::int, 1), coalesce((sh->>'h')::int, 1),
                           (a * cos(phi) - p * sin(phi))::numeric,
                           (a * sin(phi) + p * cos(phi))::numeric);
$$;

-- Пятно радиуса rad вокруг точки оси. Первый положивший клетку выигрывает —
-- поэтому кисти вызываются в порядке приоритета (ast → deb → neb → grv).
create or replace function public._bt_zblob(res jsonb, sh jsonb, sp jsonb, phi numeric,
                                            a numeric, p numeric, rad int, t text)
returns jsonb language plpgsql immutable as $$
declare c int[]; i int; j int; kk text;
        w int := coalesce((sh->>'w')::int, 1); h int := coalesce((sh->>'h')::int, 1);
begin
  c := public._bt_ax(sh, phi, a, p);
  for i in greatest(0, c[1] - rad - 1)..least(w - 1, c[1] + rad + 1) loop
    for j in greatest(0, c[2] - rad - 1)..least(h - 1, c[2] + rad + 1) loop
      kk := i || ':' || j;
      if public._bt_dist(c[1], c[2], i, j) <= rad
         and not (res ? kk) and public._bt_zok(sh, sp, i, j) then
        res := res || jsonb_build_object(kk, t);
      end if;
    end loop;
  end loop;
  return res;
end$$;

-- Подтянуть точку оси внутрь, пока она не станет годной. Нужно для редких
-- ролевых элементов (карман отхода, колодец): их всего по одному на сторону,
-- и если зеркальная копия угодила в пустоту за кромкой рваной арены, одна из
-- сторон осталась без своего кармана — это уже перекос, а не разнообразие.
-- Крупные массивы (ядро, гряды) в этом не нуждаются: их обрезка по кромке —
-- обычная работа формы арены.
create or replace function public._bt_zfit(sh jsonb, sp jsonb, phi numeric,
                                           a numeric, p numeric)
returns numeric[] language plpgsql immutable as $$
declare f numeric; c int[];
begin
  foreach f in array array[1.0, 0.85, 0.7, 0.55, 0.4, 0.25]::numeric[] loop
    c := public._bt_ax(sh, phi, a * f, p * f);
    if public._bt_zok(sh, sp, c[1], c[2]) then return array[a * f, p * f]; end if;
  end loop;
  return array[a, p];        -- некуда — пусть кисть просто ничего не положит
end$$;

-- Полоса вдоль оси на смещении p, от a0 до a1, с разрывами-створами.
-- gaps — центры створов по оси, gapw — их полуширина (в единицах оси).
-- thick 0 = нить в один гекс, 1 = с утолщением по перпендикуляру.
create or replace function public._bt_zline(res jsonb, sh jsonb, sp jsonb, phi numeric,
                                            a0 numeric, a1 numeric, p numeric,
                                            t text, gaps numeric[], gapw numeric,
                                            thick numeric default 0)
returns jsonb language plpgsql immutable as $$
declare a numeric; g numeric; skip boolean; c int[]; kk text; dp numeric;
begin
  a := a0;
  while a <= a1 loop
    skip := false;
    if gaps is not null then
      foreach g in array gaps loop
        if abs(a - g) < gapw then skip := true; end if;
      end loop;
    end if;
    if not skip then
      dp := -thick;
      while dp <= thick + 0.0001 loop
        c  := public._bt_ax(sh, phi, a, p + dp);
        kk := c[1] || ':' || c[2];
        if not (res ? kk) and public._bt_zok(sh, sp, c[1], c[2]) then
          res := res || jsonb_build_object(kk, t);
        end if;
        dp := dp + 0.030;
      end loop;
    end if;
    a := a + 0.012;
  end loop;
  return res;
end$$;

-- Полоса ПОПЕРЁК оси на смещении a: та же кисть с переставленными ролями.
create or replace function public._bt_zcross(res jsonb, sh jsonb, sp jsonb, phi numeric,
                                             p0 numeric, p1 numeric, a numeric,
                                             t text, gaps numeric[], gapw numeric,
                                             thick numeric default 0)
returns jsonb language plpgsql immutable as $$
begin
  return public._bt_zline(res, sh, sp, (phi + pi()/2)::numeric, p0, p1, -a, t, gaps, gapw, thick);
end$$;

-- ── 3) Планировщик ─────────────────────────────────────────────────────

create or replace function public._bt_gen_terrain(p_battle uuid)
returns jsonb language plpgsql volatile as $$
declare w int := public._bt_w(); h int := public._bt_h();
        sh jsonb; sp jsonb; kd text;
        axu numeric; ayv numeric; bxu numeric; byv numeric; phi numeric;
        uv numeric[]; res jsonb := '{}'::jsonb;
        arch text; roll numeric; sc numeric;
        pw numeric;            -- смещение гряд от оси
        g1 numeric; g2 numeric;-- створы в грядах
        gw numeric;            -- полуширина створа
        core numeric;          -- радиус ядра
        i int; s int; aa numeric; pp numeric; ap numeric[];
begin
  select b.shape, b.spawn, b.kind into sh, sp, kd from public.battles b where b.id = p_battle;
  perform setseed((abs(hashtext('zone' || p_battle::text)) % 100000) / 100000.0);

  -- Ось боя = направление «якорь атакующего → якорь защитника». Планировка
  -- поворачивается вместе с секторами подхода, поэтому коридоры всегда
  -- ведут ОТ одной стороны К другой, а не поперёк намерений.
  if sp is null then
    phi := 0;                                          -- легаси: колонки по краям
  else
    uv := public._bt_norm(w, h, coalesce((sp->'att'->>'x')::int, 0), coalesce((sp->'att'->>'y')::int, 0));
    axu := uv[1]; ayv := uv[2];
    uv := public._bt_norm(w, h, coalesce((sp->'def'->>'x')::int, 0), coalesce((sp->'def'->>'y')::int, 0));
    bxu := uv[1]; byv := uv[2];
    if abs(bxu - axu) < 0.0001 and abs(byv - ayv) < 0.0001 then phi := 0;
    else phi := atan2(byv - ayv, bxu - axu); end if;
  end if;

  -- Дуэльная доска 48×28 вдвое теснее: планировка та же, но реже и мельче,
  -- иначе три коридора вырождаются в три щели.
  sc   := case when kd = 'duel' then 0.62 else 1.0 end;
  roll := random();
  arch := case when kd = 'duel' then (case when roll < 0.5 then 'belt' else 'pillars' end)
               when roll < 0.46 then 'belt'
               when roll < 0.76 then 'pillars'
               else 'strait' end;

  pw   := 0.36 + random() * 0.14;
  gw   := (0.045 + random() * 0.025) * sc;
  g1   := -0.34 - random() * 0.16;
  g2   :=  0.34 + random() * 0.16;
  core := round((2 + random() * 1.4) * sc)::numeric;

  if arch = 'belt' then
    -- ЯДРО: не монолит, а 3 глыбы со сквозными проходами между ними.
    -- Пройти центр можно, но только протискиваясь — и всегда в упор.
    res := public._bt_zblob(res, sh, sp, phi,  0.00,  0.00, greatest(2, core::int + 1), 'ast');
    res := public._bt_zblob(res, sh, sp, phi,  0.13,  0.20, greatest(1, core::int), 'ast');
    res := public._bt_zblob(res, sh, sp, phi, -0.13, -0.20, greatest(1, core::int), 'ast');
    -- обломки по подступам к ядру: вход в свалку стоит хода
    res := public._bt_zblob(res, sh, sp, phi,  0.22, -0.10, greatest(1, core::int), 'deb');
    res := public._bt_zblob(res, sh, sp, phi, -0.22,  0.10, greatest(1, core::int), 'deb');

    -- ГРЯДЫ: два барьера вдоль оси. Между ними — центральный коридор через
    -- ядро, снаружи — фланговые. Створы g1/g2 разнесены по оси, так что
    -- переложиться с фланга на фланг можно, но не мгновенно.
    res := public._bt_zline(res, sh, sp, phi, -0.72, 0.72,  pw, 'ast', array[g1, g2], gw, 0.03);
    res := public._bt_zline(res, sh, sp, phi, -0.72, 0.72, -pw, 'ast', array[-g2, -g1], gw, 0.03);
    -- обрамление створов обломками: держать ворота выгоднее, чем ломиться
    res := public._bt_zblob(res, sh, sp, phi, g1,   pw, 1, 'deb');
    res := public._bt_zblob(res, sh, sp, phi, g2,   pw, 1, 'deb');
    res := public._bt_zblob(res, sh, sp, phi, -g2, -pw, 1, 'deb');
    res := public._bt_zblob(res, sh, sp, phi, -g1, -pw, 1, 'deb');

    -- СКАЛЫ: одиночные укрытия на средней дистанции в коридорах. За такой
    -- скалой встаёт дальнобой: полоса R-1..R достаёт коридор, сам он крыт.
    res := public._bt_zblob(res, sh, sp, phi,  0.48,  0.16, 1, 'ast');
    res := public._bt_zblob(res, sh, sp, phi, -0.48, -0.16, 1, 'ast');
    res := public._bt_zblob(res, sh, sp, phi,  0.40,  0.66, 1, 'ast');
    res := public._bt_zblob(res, sh, sp, phi, -0.40, -0.66, 1, 'ast');

  elsif arch = 'pillars' then
    -- Открытая карта: гряд нет, есть решётка одиночных скал. Простреливается
    -- насквозь, но всякая скала — готовая позиция; бой идёт перекатами.
    for i in 0..5 loop
      aa := -0.62 + i * 0.248;
      pp := (case when i % 2 = 0 then 0.22 else 0.58 end) * (case when i % 4 < 2 then 1 else -1 end);
      res := public._bt_zblob(res, sh, sp, phi,  aa,  pp, 1 + (i % 2), 'ast');
      res := public._bt_zblob(res, sh, sp, phi, -aa, -pp, 1 + (i % 2), 'ast');
    end loop;
    -- центр всё равно чем-то занят, иначе середина карты — пустой тир
    res := public._bt_zblob(res, sh, sp, phi, 0, 0, greatest(1, core::int), 'ast');
    res := public._bt_zblob(res, sh, sp, phi, 0.10, 0.34, greatest(1, core::int), 'deb');
    res := public._bt_zblob(res, sh, sp, phi, -0.10, -0.34, greatest(1, core::int), 'deb');

  else -- strait
    -- Стена поперёк оси с двумя створами: встречный бой упирается в ворота.
    -- Кто первым занял створ и держит его сектором орудий — диктует размен.
    res := public._bt_zcross(res, sh, sp, phi, -0.85, 0.85, 0.0, 'ast',
                             array[(-0.42 - random()*0.12)::numeric, (0.42 + random()*0.12)::numeric],
                             gw * 1.6, 0.045);
    res := public._bt_zblob(res, sh, sp, phi,  0.10, -0.44, greatest(1, core::int), 'deb');
    res := public._bt_zblob(res, sh, sp, phi, -0.10,  0.44, greatest(1, core::int), 'deb');
    -- подступы к воротам с обеих сторон — симметрично
    res := public._bt_zblob(res, sh, sp, phi,  0.30,  0.16, 1, 'ast');
    res := public._bt_zblob(res, sh, sp, phi, -0.30, -0.16, 1, 'ast');
    res := public._bt_zblob(res, sh, sp, phi,  0.34, -0.70, 2, 'ast');
    res := public._bt_zblob(res, sh, sp, phi, -0.34,  0.70, 2, 'ast');
  end if;

  -- КАРМАНЫ. Туманность на фланге ближе к своему краю: щиты внутри в нуле,
  -- зато входящий урон ×0.7 — единственное место, куда осмысленно оттащить
  -- пробитый корпус. По одному на сторону, зеркально.
  s := (case when random() < 0.5 then -1 else 1 end);
  aa := 0.50 + random() * 0.12;
  pp := (0.58 + random() * 0.14) * s;
  ap := public._bt_zfit(sh, sp, phi,  aa,  pp);
  res := public._bt_zblob(res, sh, sp, phi, ap[1], ap[2], round(2 * sc + 0.5)::int, 'neb');
  -- обкладка обломками: в карман входят медленно, значит его можно накрыть
  res := public._bt_zblob(res, sh, sp, phi, ap[1] - 0.10, ap[2] - 0.10 * s, 1, 'deb');
  ap := public._bt_zfit(sh, sp, phi, -aa, -pp);
  res := public._bt_zblob(res, sh, sp, phi, ap[1], ap[2], round(2 * sc + 0.5)::int, 'neb');
  res := public._bt_zblob(res, sh, sp, phi, ap[1] + 0.10, ap[2] + 0.10 * s, 1, 'deb');

  -- КОЛОДЦЫ на широких обходах: самый быстрый крюк проходит через тягу.
  aa := 0.16 + random() * 0.18;
  pp := 0.74 + random() * 0.10;
  ap := public._bt_zfit(sh, sp, phi,  aa,  pp);
  res := public._bt_zblob(res, sh, sp, phi, ap[1], ap[2], 0, 'grv');
  ap := public._bt_zfit(sh, sp, phi, -aa, -pp);
  res := public._bt_zblob(res, sh, sp, phi, ap[1], ap[2], 0, 'grv');

  return res;
end$$;
revoke all on function public._bt_gen_terrain(uuid) from public;

-- ── 4) Обходы ландшафта: через _bt_terra_list, а не по массиву ──────────
-- Колодцы в конце хода читали terrain как массив — с объектной формой это
-- пустой цикл, и тяга просто перестала бы работать. Переписан обход.
create or replace function public._bt_env_end(p_battle uuid, p_side text)
returns void language plpgsql security definer set search_path=public as $$
declare b record; r record; wl record; d int; st int[]; nbx int; nby int; bd int;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null then return; end if;
  -- астероиды: сторона, закончившая ход в поясе, платит 10% max_hp
  for r in select * from public.battle_units
            where battle_id = p_battle and side = p_side and alive
              and public._bt_terra(b.terrain, x, y) = 'ast' loop
    update public.battle_units
       set hp = greatest(0, hp - max_hp * 0.10),
           alive = (hp - max_hp * 0.10) > 0
     where id = r.id;
    perform public._bt_log(p_battle, format('%s дробит обшивку в астероидном поясе (−10%% корпуса)', r.unit_name));
  end loop;
  -- гравитационные колодцы: всех в радиусе 3 тянет на 1 гекс к центру
  for wl in select tl.x wx, tl.y wy from public._bt_terra_list(b.terrain) tl where tl.k = 'grv' loop
    for r in select * from public.battle_units
              where battle_id = p_battle and alive
                and public._bt_dist(x, y, wl.wx, wl.wy) between 1 and 3 loop
      nbx := null; bd := public._bt_dist(r.x, r.y, wl.wx, wl.wy);
      for d in 0..5 loop
        st := public._bt_step(r.x, r.y, d);
        if st[1] >= 0 and st[1] < public._bt_w() and st[2] >= 0 and st[2] < public._bt_h()
           and public._bt_dist(st[1], st[2], wl.wx, wl.wy) < bd
           and not exists(select 1 from public.battle_units
                           where battle_id = p_battle and alive and x = st[1] and y = st[2]) then
          nbx := st[1]; nby := st[2]; bd := public._bt_dist(st[1], st[2], wl.wx, wl.wy);
        end if;
      end loop;
      if nbx is not null then
        update public.battle_units set x = nbx, y = nby where id = r.id;
      end if;
    end loop;
  end loop;
  perform public._bt_check_end(p_battle);
end$$;
revoke all on function public._bt_env_end(uuid,text) from public;

-- ── 5) Сектора подхода: разводить круче ────────────────────────────────
-- Планировка строится вдоль оси «атакующий → защитник». При разводе в 100°
-- ось косая, и половина коридоров упирается в кромку. 130–180° держит
-- встречный характер боя, оставляя место косым заходам.
create or replace function public._bt_gen_spawn(p_battle uuid, sh jsonb)
returns jsonb language plpgsql volatile as $$
declare rad int := public._bt_zone() + 1;
        ta numeric; tb numeric; a int[]; bb int[];
begin
  perform setseed((abs(hashtext('spawn' || p_battle::text)) % 100000) / 100000.0);
  ta := random() * 2 * pi();
  tb := ta + radians(130 + random() * 50) * (case when random() < 0.5 then -1 else 1 end);
  a  := public._bt_anchor(sh, ta, rad);
  bb := public._bt_anchor(sh, tb, rad);
  return jsonb_build_object(
    'att', jsonb_build_object('x', a[1],  'y', a[2],  'r', rad, 'th', round(ta::numeric, 3)),
    'def', jsonb_build_object('x', bb[1], 'y', bb[2], 'r', rad, 'th', round(tb::numeric, 3)));
end$$;
revoke all on function public._bt_gen_spawn(uuid, jsonb) from public;

-- ── Проверка ───────────────────────────────────────────────────────────
--   select public._bt_terra(terrain, 30, 30), jsonb_typeof(terrain)
--     from public.battles order by created_at desc limit 5;
--   -- разложить свежий бой заново (только пока никто не расставлен):
--   -- update public.battles set terrain = null where id = '<uuid>';
