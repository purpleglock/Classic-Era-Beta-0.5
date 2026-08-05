-- ============================================================
-- ЯКОРЬ ЗАХОДА: не «где-то на луче», а там, где ФЛОТ ВЛЕЗЕТ
-- Применять ПОСЛЕ _bt_arena_shape.sql / _bt_arena_apply.sql. Идемпотентно.
-- ?v=20260805spawnfix
--
-- БЫЛО (симптом): «В зоне разворачивания не осталось свободных гексов» —
-- поставить нельзя ни одного борта, доска пустая, бой не начать.
--
-- ПРИЧИНА: _bt_anchor шёл лучом из ЦЕНТРА арены наружу, запоминал последнюю
-- точку внутри формы и отступал назад на 20%. У «полумесяца» (k='cres') дыра
-- смещена от центра (ox/oy), поэтому точка после отступа падала В ДЫРУ, а
-- страховочный цикл толкал её ОБРАТНО НАРУЖУ — и выходил за кромку. Проверки
-- «а влезет ли сюда диск развёртывания» не было вообще: якорь мог оказаться
-- в арене, но с нулём свободных клеток вокруг.
-- Живой пример: бой 996db4a5, att-якорь 19:47 — вне арены, 0 клеток; def 45:17 — 85.
--
-- СТАЛО: идём по лучу ОТ КРОМКИ ВНУТРЬ и берём первую точку, вокруг которой
-- в радиусе развёртывания реально лежит достаточно клеток арены. Если всё
-- направление занято дырой — доворачиваем луч шагами по 15° (до ±90°).
-- Курс захода (th) при этом сохраняем как есть: он задаёт, кто с какой стороны.
-- ============================================================

-- ── Сколько клеток арены лежит в радиусе развёртывания вокруг точки ──
-- Это и есть «влезет ли флот»: якорь без места вокруг бесполезен.
create or replace function public._bt_room(sh jsonb, cx int, cy int, rad int)
returns int language plpgsql immutable as $$
declare w int := coalesce((sh->>'w')::int, 1); h int := coalesce((sh->>'h')::int, 1);
        n int := 0; x int; y int;
begin
  if not public._bt_in_arena(sh, cx, cy) then return 0; end if;
  for x in greatest(0, cx - rad) .. least(w - 1, cx + rad) loop
    for y in greatest(0, cy - rad - 1) .. least(h - 1, cy + rad + 1) loop
      if public._bt_dist(x, y, cx, cy) <= rad and public._bt_in_arena(sh, x, y) then
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end$$;

-- ── Якорь: от кромки внутрь, с проверкой места; при неудаче — доворот ──
create or replace function public._bt_anchor(sh jsonb, th numeric, rad int)
returns int[] language plpgsql immutable as $$
declare w int := coalesce((sh->>'w')::int, 1); h int := coalesce((sh->>'h')::int, 1);
        NEED int := 12;                 -- минимум клеток вокруг якоря
        f numeric; xy int[]; i int; k int; dth numeric; a numeric;
        room int; best int[] := null; best_room int := 0;
begin
  -- k = 0 — заданный курс; дальше довороты ±15°, ±30° … ±90°
  for k in 0..12 loop
    dth := radians(15 * ceil(k / 2.0)) * (case when k % 2 = 0 then 1 else -1 end);
    a := th + dth;
    -- от кромки (0.95) внутрь к центру: заходим с края, как и задумано
    for i in reverse 19..0 loop
      f  := 0.05 * i;
      xy := public._bt_denorm(w, h, (f * cos(a))::numeric, (f * sin(a))::numeric);
      if public._bt_in_arena(sh, xy[1], xy[2]) then
        room := public._bt_room(sh, xy[1], xy[2], rad);
        if room >= NEED then
          return array[xy[1], xy[2], rad];
        end if;
        -- запасной вариант на случай, если нигде не наберётся NEED
        if room > best_room then best_room := room; best := array[xy[1], xy[2], rad]; end if;
      end if;
    end loop;
  end loop;
  if best is not null then return best; end if;
  -- вырожденная форма: отдаём центр, лишь бы не вернуть точку вне доски
  return array[greatest(0, w / 2), greatest(0, h / 2), rad];
end$$;

-- ── Починка уже сгенерированных боёв ────────────────────────
-- Пересчитываем spawn там, где хоть одной стороне некуда вставать.
-- Курсы (th) берём прежние: расстановка сторон друг относительно друга не едет.
do $$
declare r record; sp jsonb; a int[]; bb int[]; ta numeric; tb numeric; fixed int := 0;
begin
  for r in select id, shape, spawn from public.battles
            where shape is not null and spawn is not null
              and status in ('forming', 'active') loop
    a  := array[(r.spawn->'att'->>'x')::int, (r.spawn->'att'->>'y')::int];
    bb := array[(r.spawn->'def'->>'x')::int, (r.spawn->'def'->>'y')::int];
    if public._bt_room(r.shape, a[1], a[2], coalesce((r.spawn->'att'->>'r')::int, 5)) >= 6
       and public._bt_room(r.shape, bb[1], bb[2], coalesce((r.spawn->'def'->>'r')::int, 5)) >= 6
    then continue; end if;

    ta := coalesce((r.spawn->'att'->>'th')::numeric, 0);
    tb := coalesce((r.spawn->'def'->>'th')::numeric, pi());
    a  := public._bt_anchor(r.shape, ta, coalesce((r.spawn->'att'->>'r')::int, 5));
    bb := public._bt_anchor(r.shape, tb, coalesce((r.spawn->'def'->>'r')::int, 5));
    sp := jsonb_build_object(
      'att', jsonb_build_object('x', a[1],  'y', a[2],  'r', a[3],  'th', round(ta, 3)),
      'def', jsonb_build_object('x', bb[1], 'y', bb[2], 'r', bb[3], 'th', round(tb, 3)));
    update public.battles set spawn = sp where id = r.id;
    fixed := fixed + 1;
    raise notice 'бой %: точки входа пересчитаны', r.id;
  end loop;
  raise notice 'починено боёв: %', fixed;
end$$;

-- ============================================================
-- ПРОВЕРКА
--  1) select public._bt_room(shape, (spawn->'att'->>'x')::int, (spawn->'att'->>'y')::int, 5)
--       from public.battles where status='forming';  → у всех > 0
--  2) На доске «+» на карточке корабля ставит борт, а не ругается «нет гексов».
--  3) Курс захода не поменялся: стороны заходят с тех же кромок, что и раньше.
-- ============================================================
