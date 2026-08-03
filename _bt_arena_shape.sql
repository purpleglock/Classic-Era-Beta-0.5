-- ════════════════════════════════════════════════════════════════════════
-- ФОРМА АРЕНЫ И ВЕКТОРЫ ПОДХОДА
-- ────────────────────────────────────────────────────────────────────────
-- Было: доска — жёсткий прямоугольник bw×bh, атакующий разворачивается в Z
-- левых колонках, защитник — в Z правых. Бой всегда выглядел одинаково:
-- две шеренги едут навстречу по горизонтали.
--
-- Стало:
--   1) АРЕНА — не прямоугольник. У каждого боя своя форма: линза, рваная
--      «долька», кольцо вокруг центрального тела, песочные часы с перешейком,
--      полумесяц. Клетки вне формы («пустота») недоступны: туда нельзя
--      встать, туда нельзя лететь, там не растёт ландшафт.
--   2) СПАВН — не колонки, а СЕКТОРА ПОДХОДА. У каждой стороны свой якорь на
--      кромке арены и радиус; стороны заходят с произвольных направлений,
--      разведённых на 100–180°. Иногда лоб в лоб, иногда под прямым углом.
--
-- ⚠ Форма НЕ хранится списком клеток. `_bt_terra` — линейный скан jsonb, и
--   тысяча клеток «пустоты» в terrain уложила бы ход бота в statement timeout
--   (см. историю с 57014). Вместо этого в battles.shape лежит НЕСКОЛЬКО ЧИСЕЛ,
--   а принадлежность считает арифметика в `_bt_in_arena` за константу.
--   Клиент считает ту же формулу — зеркало в battle_board.js (bbInArena).
--
-- Совместимость: у старых боёв shape/spawn = null. Null трактуется как
-- «прямоугольник целиком» и «колонки по краям» — идущие бои не ломаются.
-- ════════════════════════════════════════════════════════════════════════

alter table public.battles add column if not exists shape jsonb;
alter table public.battles add column if not exists spawn jsonb;

-- ── Геометрия: гекс → мировые координаты ────────────────────────────────
-- flat-top, тот же расклад, что в клиенте: x — колонки через 1.5R,
-- y — ряды через √3·R со сдвигом на полряда у нечётных колонок.
-- Возвращает нормированные u,v ∈ [-1,1] относительно габарита доски.
create or replace function public._bt_norm(w int, h int, px int, py int)
returns numeric[] language sql immutable as $$
  select array[
    case when w > 1 then (1.5 * px) / (1.5 * (w - 1)) * 2 - 1 else 0 end,
    case when h > 1 then (sqrt(3.0) * (py + 0.5 * (px & 1))) / (sqrt(3.0) * (h - 1)) * 2 - 1 else 0 end
  ];
$$;

-- Обратно: нормированные u,v → ближайший гекс доски
create or replace function public._bt_denorm(w int, h int, u numeric, v numeric)
returns int[] language plpgsql immutable as $$
declare x int; y int;
begin
  x := round(((u + 1) / 2) * (w - 1))::int;
  x := greatest(0, least(w - 1, x));
  y := round(((v + 1) / 2) * (h - 1) - 0.5 * (x & 1))::int;
  y := greatest(0, least(h - 1, y));
  return array[x, y];
end$$;

-- ── Принадлежность арене ────────────────────────────────────────────────
-- shape = {k, w, h, ...параметры}. Все проверки — на нормированных u,v.
--   rect  прямоугольник целиком (легаси и «открытый космос»)
--   lens  линза/эллипс: r ≤ 1
--   lobe  рваная долька: радиус гуляет синусом по углу — органичный силуэт
--   ring  кольцо: долька минус центральное тело (газовый гигант, звезда)
--   hour  песочные часы: два кармана и узкий перешеек посередине
--   cres  полумесяц: линза минус вырезанный сбоку диск
create or replace function public._bt_in_arena(sh jsonb, px int, py int)
returns boolean language plpgsql immutable as $$
declare w int; h int; k text; uv numeric[]; u numeric; v numeric;
        r numeric; th numeric; lim numeric;
        amp numeric; m numeric; ph numeric; hole numeric; waist numeric;
        ox numeric; oy numeric; hr numeric;
begin
  if sh is null then return true; end if;            -- легаси: доска целиком
  w := coalesce((sh->>'w')::int, 0); h := coalesce((sh->>'h')::int, 0);
  if w <= 0 or h <= 0 then return true; end if;
  if px < 0 or px >= w or py < 0 or py >= h then return false; end if;
  k := coalesce(sh->>'k', 'rect');
  if k = 'rect' then return true; end if;

  uv := public._bt_norm(w, h, px, py);
  u := uv[1]; v := uv[2];
  r := sqrt(u * u + v * v);

  if k = 'hour' then
    waist := coalesce((sh->>'waist')::numeric, 0.6);
    -- талия по центру: чем ближе к u=0, тем сильнее ужимается по v
    return abs(v) <= 1 - waist * (1 - u * u);
  end if;

  th  := atan2(v, u);
  amp := coalesce((sh->>'amp')::numeric, 0.0);
  m   := coalesce((sh->>'m')::numeric, 3);
  ph  := coalesce((sh->>'ph')::numeric, 0);
  -- радиус-предел гуляет по углу: 1-amp … 1
  lim := 1 - amp * (1 - cos(m * th + ph)) / 2;

  if r > lim then return false; end if;

  if k = 'ring' then
    hole := coalesce((sh->>'hole')::numeric, 0.32);
    return r >= hole;                                 -- центральное тело
  end if;
  if k = 'cres' then
    ox := coalesce((sh->>'ox')::numeric, 0.55);
    oy := coalesce((sh->>'oy')::numeric, 0.0);
    hr := coalesce((sh->>'hr')::numeric, 0.6);
    return sqrt((u - ox) * (u - ox) + (v - oy) * (v - oy)) >= hr;
  end if;
  return true;                                        -- lens / lobe
end$$;

-- ── Генерация формы: сид = id боя ───────────────────────────────────────
-- Дуэли (маленькая доска 48×28) держим ближе к открытому полю: кольцо и
-- полумесяц на ней съедают слишком много места. Большие бои — вся палитра.
create or replace function public._bt_gen_shape(p_battle uuid)
returns jsonb language plpgsql volatile as $$
declare w int := public._bt_w(); h int := public._bt_h();
        kd text; roll numeric; k text; res jsonb;
begin
  perform setseed((abs(hashtext('shape' || p_battle::text)) % 100000) / 100000.0);
  select kind into kd from public.battles where id = p_battle;
  roll := random();

  if kd = 'duel' then
    k := case when roll < 0.45 then 'lobe' when roll < 0.80 then 'lens' else 'hour' end;
  else
    k := case when roll < 0.34 then 'lobe'
              when roll < 0.52 then 'lens'
              when roll < 0.70 then 'ring'
              when roll < 0.86 then 'hour'
              else 'cres' end;
  end if;

  res := jsonb_build_object('k', k, 'w', w, 'h', h);

  if k in ('lobe', 'ring', 'cres') then
    res := res || jsonb_build_object(
      'amp', round((0.16 + random() * 0.22)::numeric, 3),        -- рваность кромки
      'm',   (3 + floor(random() * 3))::int,                     -- 3–5 долей
      'ph',  round((random() * 6.283)::numeric, 3));
  else
    res := res || jsonb_build_object('amp', round((0.05 + random() * 0.10)::numeric, 3),
                                     'm', 4, 'ph', round((random() * 6.283)::numeric, 3));
  end if;

  if k = 'ring' then
    res := res || jsonb_build_object('hole', round((0.26 + random() * 0.16)::numeric, 3));
  elsif k = 'hour' then
    res := res || jsonb_build_object('waist', round((0.45 + random() * 0.22)::numeric, 3));
  elsif k = 'cres' then
    res := res || jsonb_build_object(
      'ox', round((0.45 + random() * 0.25)::numeric, 3) * (case when random() < 0.5 then -1 else 1 end),
      'oy', round((random() * 0.5 - 0.25)::numeric, 3),
      'hr', round((0.55 + random() * 0.2)::numeric, 3));
  end if;
  return res;
end$$;
revoke all on function public._bt_gen_shape(uuid) from public;

-- ── Сектор подхода: якорь на кромке по заданному курсу ──────────────────
-- Идём от центра арены наружу по лучу th и берём последнюю клетку, которая
-- ещё принадлежит арене; затем отступаем внутрь, чтобы диск радиуса r влез.
create or replace function public._bt_anchor(sh jsonb, th numeric, rad int)
returns int[] language plpgsql immutable as $$
declare w int := coalesce((sh->>'w')::int, 1); h int := coalesce((sh->>'h')::int, 1);
        f numeric; best numeric := null; xy int[]; i int;
begin
  -- крупным шагом наружу: где луч ещё внутри арены
  for i in 0..18 loop
    f := 0.06 * i;
    xy := public._bt_denorm(w, h, (f * cos(th))::numeric, (f * sin(th))::numeric);
    if public._bt_in_arena(sh, xy[1], xy[2]) then best := f; end if;
  end loop;
  if best is null then best := 0; end if;
  best := greatest(0, best * 0.80);        -- отступ внутрь: диск должен влезть
  xy := public._bt_denorm(w, h, (best * cos(th))::numeric, (best * sin(th))::numeric);
  -- страховка: если после отступа попали в дыру кольца — тянем наружу
  for i in 1..12 loop
    exit when public._bt_in_arena(sh, xy[1], xy[2]);
    best := least(1.0, best + 0.06);
    xy := public._bt_denorm(w, h, (best * cos(th))::numeric, (best * sin(th))::numeric);
  end loop;
  return array[xy[1], xy[2], rad];
end$$;

-- Два сектора: курсы разведены на 100–180°, обе стороны заходят с кромки.
create or replace function public._bt_gen_spawn(p_battle uuid, sh jsonb)
returns jsonb language plpgsql volatile as $$
declare rad int := public._bt_zone() + 1;
        ta numeric; tb numeric; a int[]; bb int[];
begin
  perform setseed((abs(hashtext('spawn' || p_battle::text)) % 100000) / 100000.0);
  ta := random() * 2 * pi();
  tb := ta + radians(100 + random() * 80) * (case when random() < 0.5 then -1 else 1 end);
  a  := public._bt_anchor(sh, ta, rad);
  bb := public._bt_anchor(sh, tb, rad);
  return jsonb_build_object(
    'att', jsonb_build_object('x', a[1],  'y', a[2],  'r', rad, 'th', round(ta::numeric, 3)),
    'def', jsonb_build_object('x', bb[1], 'y', bb[2], 'r', rad, 'th', round(tb::numeric, 3)));
end$$;
revoke all on function public._bt_gen_spawn(uuid, jsonb) from public;

-- Клетка в секторе развёртывания своей стороны?
create or replace function public._bt_in_spawn(sp jsonb, sd text, px int, py int)
returns boolean language sql immutable as $$
  select case when sp is null then null::boolean
         else public._bt_dist(px, py,
                coalesce((sp->sd->>'x')::int, 0),
                coalesce((sp->sd->>'y')::int, 0)) <= coalesce((sp->sd->>'r')::int, 0)
         end;
$$;

-- ── Ландшафт: с оглядкой на форму и на сектора ──────────────────────────
-- Прежняя версия чистила «Z левых и Z правых колонок». Теперь чистое место —
-- это сами сектора подхода, где бы они ни оказались, а вне арены ландшафта
-- нет вовсе. Кольцо получает центральное тело обломками по внутренней кромке.
create or replace function public._bt_gen_terrain(p_battle uuid)
returns jsonb language plpgsql volatile as $$
declare w int := public._bt_w(); h int := public._bt_h();
        sh jsonb; sp jsonb;
        res jsonb := '[]'::jsonb; used jsonb := '{}'::jsonb;
        i int; j int; cx int; cy int; n int; d int; st int[];
        ok boolean;
begin
  select b.shape, b.spawn into sh, sp from public.battles b where b.id = p_battle;
  perform setseed((abs(hashtext(p_battle::text)) % 100000) / 100000.0);

  -- класть ландшафт можно только внутри арены и вне обоих секторов подхода
  for i in 1..12 loop
    -- 5 астероидных, 4 обломочных, 3 туманных «кисти» — блуждания от центра
    cx := floor(random() * w)::int;
    cy := floor(random() * h)::int;
    n  := case when i <= 5 then 4 + floor(random() * 4)::int
               when i <= 9 then 3 + floor(random() * 3)::int
               else 1 + floor(random() * 2)::int end;
    if i <= 9 then
      for j in 1..n loop
        ok := public._bt_in_arena(sh, cx, cy)
              and not coalesce(public._bt_in_spawn(sp, 'att', cx, cy), false)
              and not coalesce(public._bt_in_spawn(sp, 'def', cx, cy), false)
              and not (used ? (cx || ':' || cy));
        if ok then
          res  := res || jsonb_build_array(jsonb_build_object(
                    'x', cx, 'y', cy, 't', case when i <= 5 then 'ast' else 'deb' end));
          used := used || jsonb_build_object(cx || ':' || cy, true);
        end if;
        d := floor(random() * 6)::int;
        st := public._bt_step(cx, cy, d); cx := st[1]; cy := st[2];
      end loop;
    else
      -- туманность: пятно радиуса n вокруг центра, только по своей окрестности
      for j in greatest(0, cx - n)..least(w - 1, cx + n) loop
        for d in greatest(0, cy - n - 1)..least(h - 1, cy + n + 1) loop
          if public._bt_dist(cx, cy, j, d) <= n
             and public._bt_in_arena(sh, j, d)
             and not coalesce(public._bt_in_spawn(sp, 'att', j, d), false)
             and not coalesce(public._bt_in_spawn(sp, 'def', j, d), false)
             and not (used ? (j || ':' || d)) then
            res  := res || jsonb_build_array(jsonb_build_object('x', j, 'y', d, 't', 'neb'));
            used := used || jsonb_build_object(j || ':' || d, true);
          end if;
        end loop;
      end loop;
    end if;
  end loop;

  -- гравитационные колодцы: 2 одиночных внутри арены
  for i in 1..2 loop
    cx := floor(random() * w)::int; cy := floor(random() * h)::int;
    if public._bt_in_arena(sh, cx, cy)
       and not coalesce(public._bt_in_spawn(sp, 'att', cx, cy), false)
       and not coalesce(public._bt_in_spawn(sp, 'def', cx, cy), false)
       and not (used ? (cx || ':' || cy)) then
      res  := res || jsonb_build_array(jsonb_build_object('x', cx, 'y', cy, 't', 'grv'));
      used := used || jsonb_build_object(cx || ':' || cy, true);
    end if;
  end loop;

  return res;
end$$;
revoke all on function public._bt_gen_terrain(uuid) from public;

-- ── Поле боя генерится один раз, лениво ─────────────────────────────────
-- Порядок обязателен: форма → сектора → ландшафт. Ландшафт обходит сектора,
-- значит сектора должны быть уже записаны.
create or replace function public._bt_ensure_field(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $$
declare sh jsonb; sp jsonb; t jsonb; legacy boolean;
begin
  perform public._bt_arm(p_battle);
  select b.shape, b.spawn, b.terrain into sh, sp, t
    from public.battles b where b.id = p_battle;

  -- ⚠ Бой, начатый ДО этой ревизии, форму не получает. У него уже сгенерён
  -- ландшафт и/или расставлены борта по старым правилам (колонки у края) —
  -- новая арена вырезала бы землю из-под уже стоящих кораблей. Такие бои
  -- фиксируем как прямоугольные (spawn остаётся null = колонки).
  legacy := sh is null and (t is not null
            or exists(select 1 from public.battle_units bu where bu.battle_id = p_battle));
  if legacy then
    update public.battles
       set shape = jsonb_build_object('k','rect','w',public._bt_w(),'h',public._bt_h())
     where id = p_battle and shape is null;
    if t is null then
      update public.battles set terrain = public._bt_gen_terrain(p_battle)
       where id = p_battle and terrain is null;
    end if;
    return;
  end if;

  if sh is null then
    sh := public._bt_gen_shape(p_battle);
    update public.battles set shape = sh where id = p_battle and shape is null;
    select b.shape into sh from public.battles b where b.id = p_battle;
  end if;
  if sp is null then
    sp := public._bt_gen_spawn(p_battle, sh);
    update public.battles set spawn = sp where id = p_battle and spawn is null;
    select b.spawn into sp from public.battles b where b.id = p_battle;
  end if;
  if t is null then
    update public.battles set terrain = public._bt_gen_terrain(p_battle)
     where id = p_battle and terrain is null;
  end if;
end$$;
grant execute on function public._bt_ensure_field(uuid) to authenticated;
