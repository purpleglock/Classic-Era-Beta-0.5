-- ============================================================
-- ИМПЕРСКИЙ КОЛОСС · КОРПУС, КОТОРЫЙ НАРИСОВАЛ ИГРОК
-- Применять ПОСЛЕ _unit_catalog.sql (класс colossus в каталоге) и
-- ПОСЛЕ _cn_deck_masks.sql (даёт тип public.cn_deck_mask),
-- ПЕРЕД _colossus_patch.sql. Идемпотентно.
--
-- Зачем. У прочих классов силуэт — константа, и решётка палубы испечена
-- справочником cn_deck_mask (tools/gen_deck_masks.js). У колосса корпус рисуется
-- в верфи и приезжает в проекте битовой маской: клетки И ЕСТЬ корабль. Значит
-- маску нельзя взять из справочника — её надо принять от клиента, а раз так,
-- надо и проверить: клиент правится из консоли, и без заслона игрок опубликует
-- себе решётку любой площади и любой формы прямой записью в базу.
--
-- Что делает сервер (и ровно то же делает клиент, зеркало пофункционально):
--   _cn_hull_sane  — канонизация: один кусок (обрывки отваливаются), обрезка по
--                    закрашенному, зажим габарита канвы. Зеркало cnColSane.
--   _cn_hull_mask  — из маски в ту же строку, что лежит в cn_deck_mask: отсеки
--                    (нос/мидель/корма), борта, внешний пояс. Зеркало cnDeckZones.
--   _cn_colossus_cls — ТТХ от площади. Зеркало cnColStats.
-- ⚠️ ПОТОЛКА ПЛОЩАДИ НЕТ. Предел — только габарит канвы (46×130 клеток, его держит
-- _cn_hull_sane) и деньги: цена, сырьё и экипаж растут КВАДРАТИЧНО от площади, так
-- что вдвое больший корпус стоит вчетверо. Отдельная проверка «сверх предела» в
-- _cn_recompute поэтому снята — режет только канва.
--
-- ⚠️ Формат маски — тот же, что у cn_deck_mask: 4 клетки на hex-символ, младший
-- бит = меньший индекс. Никакой плавающей точки: одни целые, поэтому «на верфи
-- было 1194 клетки, а в базе 1192» здесь невозможно в принципе.
-- Сверка: node tools/check_colossus.js.
-- ============================================================

-- Старые (параметрические) версии сносим: сигнатуры и смысл поменялись.
drop function if exists public._cn_hull_st(jsonb);
drop function if exists public._cn_hull_half(double precision[], double precision);
drop function if exists public._cn_hull_half(numeric[], numeric);
drop function if exists public._cn_jsround(double precision);
drop function if exists public._cn_col_q(numeric, numeric, numeric, numeric);

-- ── Пределы творческого режима (зеркало CN_COL) ──
create or replace function public._cn_col_lim()
returns jsonb language sql immutable as $$
  select '{"cw":46,"ch":130,"min":40,"refCells":655,"imperial":1.25}'::jsonb
$$;

-- ── Упаковка булева массива в hex (зеркало cnColPack / packBits) ──
create or replace function public._cn_pack(bits boolean[])
returns text language plpgsql immutable as $$
declare n int := coalesce(array_length(bits,1),0); i int := 1; b int; v int; out text := '';
begin
  while i <= n loop
    v := 0;
    for b in 0..3 loop
      if i + b <= n and bits[i+b] then v := v | (1 << b); end if;
    end loop;
    out := out || to_hex(v);
    i := i + 4;
  end loop;
  return out;
end$$;

-- ── КАНОНИЗАЦИЯ КОРПУСА (зеркало cnColSane) ──
-- Не отвергаем присланное, а приводим к канону — и делаем это ДЕТЕРМИНИРОВАННО,
-- иначе клиент и сервер из одной строки получат разные корабли:
--   1) остаётся ОДИН кусок — самый большой (при равенстве побеждает тот, чья
--      клетка идёт раньше: обход строго по возрастанию индекса);
--   2) поля обрезаются по закрашенному (поэтому «подвинуть корабль» бессмысленно);
--   3) габарит канвы зажимается пределами.
create or replace function public._cn_hull_sane(p jsonb)
returns jsonb language plpgsql immutable as $$
declare
  L jsonb := public._cn_col_lim();
  w int; h int; n int; bits boolean[]; comp int[];
  i int; x int; y int; ci int := 0; cnt int; best int := -1; bestn int := 0;
  q int[]; cur int;
  x1 int; y1 int; x2 int; y2 int; nw int; nh int; nb boolean[];
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{"w":1,"h":1,"mask":"0"}'::jsonb; end if;
  w := greatest(1, least((L->>'cw')::int, coalesce((p->>'w')::int, 1)));
  h := greatest(1, least((L->>'ch')::int, coalesce((p->>'h')::int, 1)));
  n := w * h;
  bits := public._cn_bits(coalesce(p->>'mask',''), n);
  comp := array_fill(-1, array[n]);
  -- 1) куски
  for i in 1..n loop
    if not bits[i] or comp[i] >= 0 then continue; end if;
    q := array[i]; comp[i] := ci; cnt := 0;
    while array_length(q,1) > 0 loop
      cur := q[array_length(q,1)]; q := q[1:array_length(q,1)-1];
      cnt := cnt + 1;
      x := (cur-1) % w; y := (cur-1) / w;
      if x > 0   and bits[cur-1] and comp[cur-1] < 0 then comp[cur-1] := ci; q := q || (cur-1); end if;
      if x < w-1 and bits[cur+1] and comp[cur+1] < 0 then comp[cur+1] := ci; q := q || (cur+1); end if;
      if y > 0   and bits[cur-w] and comp[cur-w] < 0 then comp[cur-w] := ci; q := q || (cur-w); end if;
      if y < h-1 and bits[cur+w] and comp[cur+w] < 0 then comp[cur+w] := ci; q := q || (cur+w); end if;
    end loop;
    if cnt > bestn then bestn := cnt; best := ci; end if;
    ci := ci + 1;
  end loop;
  for i in 1..n loop if bits[i] and comp[i] <> best then bits[i] := false; end if; end loop;
  -- 2) обрезка по закрашенному
  x1 := w; y1 := h; x2 := -1; y2 := -1;
  for i in 1..n loop
    if not bits[i] then continue; end if;
    x := (i-1) % w; y := (i-1) / w;
    if x < x1 then x1 := x; end if;  if x > x2 then x2 := x; end if;
    if y < y1 then y1 := y; end if;  if y > y2 then y2 := y; end if;
  end loop;
  if x2 < 0 then return '{"w":1,"h":1,"mask":"0"}'::jsonb; end if;
  nw := x2 - x1 + 1; nh := y2 - y1 + 1;
  nb := array_fill(false, array[nw * nh]);
  for y in y1..y2 loop
    for x in x1..x2 loop
      if bits[y*w + x + 1] then nb[(y-y1)*nw + (x-x1) + 1] := true; end if;
    end loop;
  end loop;
  return jsonb_build_object('w', nw, 'h', nh, 'mask', public._cn_pack(nb));
end$$;

-- ── МАСКА ПАЛУБЫ ИЗ КОРПУСА (зеркало cnDeckZones) ──
-- Возвращает строку того же вида, что лежит в cn_deck_mask, — дальше палуба
-- разбирается общим кодом и про творческий режим ничего не знает.
--   band — нос (передние 30% длины), мидель, корма (задние 28%);
--   skin — клетка с выходом на борт (нужна сенсорам/РЭБ/ПРО);
--   outer — клетка ЗА обшивкой, примыкающая к корпусу (навесная броня).
create or replace function public._cn_hull_mask(p_hull jsonb)
returns public.cn_deck_mask language plpgsql immutable as $$
declare
  hl jsonb := public._cn_hull_sane(p_hull);
  gw int := (hl->>'w')::int; gh int := (hl->>'h')::int; ncell int;
  inside boolean[]; outr boolean[]; skn boolean[]; bnd int[];
  i int; gx int; gy int; idx int; cnt int := 0;
  ry1 int; ry2 int; span double precision; t double precision;
  bands text := ''; out_ public.cn_deck_mask;
begin
  ncell := gw * gh;
  inside := public._cn_bits(hl->>'mask', ncell);
  outr := array_fill(false, array[ncell]);
  skn  := array_fill(false, array[ncell]);
  bnd  := array_fill(0, array[ncell]);
  ry1 := null; ry2 := null;
  for i in 1..ncell loop
    if inside[i] then
      cnt := cnt + 1;
      gy := (i-1) / gw;
      if ry1 is null or gy < ry1 then ry1 := gy; end if;
      if ry2 is null or gy > ry2 then ry2 := gy; end if;
    end if;
  end loop;
  span := greatest(1, coalesce(ry2,0) - coalesce(ry1,0));
  for gy in 0..gh-1 loop
    for gx in 0..gw-1 loop
      idx := gy * gw + gx + 1;
      if inside[idx] then
        t := (gy - ry1)::double precision / span;
        bnd[idx] := case when t < 0.30 then 1 when t > 0.72 then 3 else 2 end;
        skn[idx] := (gx = 0 or gx = gw-1 or gy = 0 or gy = gh-1
                     or not inside[idx-1] or not inside[idx+1]
                     or not inside[idx-gw] or not inside[idx+gw]);
      else
        outr[idx] := ((gx > 0 and inside[idx-1]) or (gx < gw-1 and inside[idx+1])
                   or (gy > 0 and inside[idx-gw]) or (gy < gh-1 and inside[idx+gw]));
      end if;
    end loop;
  end loop;
  for i in 1..ncell loop bands := bands || bnd[i]::text; end loop;

  out_.class := 'colossus'; out_.w := gw; out_.h := gh; out_.cells := cnt;
  out_.inside := public._cn_pack(inside);
  out_.outer_ := public._cn_pack(outr);
  out_.skin   := public._cn_pack(skn);
  out_.band   := bands;
  return out_;
end$$;

-- ── ТТХ КОРПУСА ОТ ЕГО ПЛОЩАДИ (зеркало cnColStats) ──
-- Класс в каталоге держит эталон «корпуса по умолчанию»; настоящие числа проекта
-- считаются от того, сколько клеток нарисовано. Показатели сверхлинейны намеренно:
-- вдвое больший корпус не должен стоить вдвое, иначе «рисуй максимум» — единственный ход.
create or replace function public._cn_colossus_cls(p_cls jsonb, p_cells int)
returns jsonb language sql immutable as $$
  with r as (
    select greatest(0.05, p_cells::numeric / (public._cn_col_lim()->>'refCells')::numeric) v,
           (public._cn_col_lim()->>'imperial')::numeric im)
  select p_cls || jsonb_build_object(
    'mass',         round(500000 * power(r.v, 1.35)),
    'crewRequired', greatest(20, round(100 * power(r.v, 1.25))),
    'capacity',     round(1800 * r.v),
    'gabarit',      round(800 * r.v),
    'price',        round(250000000 * power(r.v, 2) * r.im),
    'cost',         round(250000000 * power(r.v, 2) * r.im),
    'modul',        greatest(4, round(112 * r.v)),
    'resurs', jsonb_build_object(
      'blackmetall',   round(1800 * power(r.v, 2) * r.im),
      'coloredmetall', 0,
      'rudametall',    0,
      'kristall',      0,
      'staarvis',      round(4000 * power(r.v, 2) * r.im)))
  from r
$$;

grant execute on function public._cn_col_lim() to authenticated, anon;
grant execute on function public._cn_pack(boolean[]) to authenticated, anon;
grant execute on function public._cn_hull_sane(jsonb) to authenticated, anon;
grant execute on function public._cn_hull_mask(jsonb) to authenticated, anon;
grant execute on function public._cn_colossus_cls(jsonb, int) to authenticated, anon;
