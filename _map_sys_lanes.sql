-- ════════════════════════════════════════════════════════════════════════
--  ВНУТРИСИСТЕМНЫЕ ПУТИ — сеть между телами ОДНОЙ системы
--
--  ЧТО БЫЛО: map_hyperlanes связывает систему с системой. Внутри системы
--  никакой сети нет вовсе: тела висят на орбитах, флот приходит «в систему»
--  и всё. Двигать что-либо на конкретную планету некуда — нет рёбер.
--
--  ЧТО СТАЛО: map_system_lanes — граф внутри системы. Узлы:
--     'S:<letter>' — звезда (A — главная, B/C/… — компаньоны кратной);
--     'P:<pid>'    — тело из map_systems.planets (планета, пояс, аномалия).
--  Рёбра трёх видов:
--     spine  — ХРЕБЕТ: лестница от самого дальнего тела внутрь, к звезде.
--              Строится ровно так, как сказано в задаче: от крайнего объекта
--              к центру. Это единственный гарантированно связный путь.
--     chord  — ХОРДА: прямой перелёт мимо соседей (в обход лестницы). Даёт
--              альтернативу и делает сеть неодинаковой от системы к системе.
--     bridge — ПЕРЕМЫЧКА между звёздами кратной системы (S:A ↔ S:B).
--
--  ЕСТЕСТВЕННЫЕ БАРЬЕРЫ. Пояс астероидов — это узел лестницы, а не помеха:
--  хребет и так идёт СКВОЗЬ него, и это уже узкое горло. Барьер режет
--  ПРОПУСКНУЮ СПОСОБНОСТЬ: сколько плеч всего разрешено провести сквозь его
--  орбиту. Ёмкость берётся из плотности пояса (см. _msl_cap):
--     Разрежённый  → 3  (хребет + 2 обхода)
--     Умеренный    → 2  (хребет + 1 обход — «не больше двух путей»)
--     Сверхплотный → 1  (только хребет: единственный створ, за него воюют)
--  Чёрная дыра — то же самое с ёмкостью 1.
--
--  ЭТОТ НАКАТ — ТОЛЬКО КАРТА. Флоты по этим рёбрам пока НЕ ходят: fleets
--  по-прежнему знает лишь system_id. cost здесь — заготовка под плечо
--  (условные часы), она нужна генератору для отбора хорд и показа в панели.
--
--  Зависимости: _map_setup.sql (map_systems), _multi_stars.sql (stars),
--               _migration_planet_pid.sql (pid у тел — БЕЗ него узлов нет).
--  Идемпотентно. После наката граф пересобирается сам при правках состава
--  системы в редакторе карты (триггер на planets/stars).
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. ХРАНИЛИЩЕ ────────────────────────────────────────────────────────
create table if not exists public.map_system_lanes (
  id          uuid primary key default gen_random_uuid(),
  system_id   text not null references public.map_systems(id) on delete cascade,
  star        text not null default 'A',     -- к какой звезде относится плечо
  a_key       text not null,                 -- 'S:A' | 'P:<pid>'
  b_key       text not null,
  kind        text not null default 'spine', -- spine | chord | bridge
  cost        numeric not null default 1,    -- условное плечо (заготовка под время)
  gate        boolean not null default false,-- плечо стеснено барьером (створ)
  barrier_pid int,                           -- pid пояса/аномалии, что жмёт это плечо
  created_at  timestamptz default now()
);
create unique index if not exists msl_uq  on public.map_system_lanes(system_id, a_key, b_key);
create index        if not exists msl_sys on public.map_system_lanes(system_id);

alter table public.map_system_lanes enable row level security;
drop policy if exists "read"  on public.map_system_lanes;
drop policy if exists "write" on public.map_system_lanes;
-- читают все (сеть внутри системы — такая же общедоступная география, как
-- сами гиперпути: скрывать её нечем и не от кого)
create policy "read"  on public.map_system_lanes for select to public using (true);
create policy "write" on public.map_system_lanes for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

-- ── 2. КЛАССИФИКАЦИЯ ТЕЛА ───────────────────────────────────────────────
-- kind у тел генератора есть всегда, но в базе живут и легаси-миры из сида
-- (_map_setup.sql: только name/type/img) и ручные правки из админки. Поэтому
-- вид определяем с фолбэком на текстовый type.
create or replace function public._msl_kind(el jsonb)
returns text language sql immutable as $fn$
  select case
    when el->>'kind' in ('belt','anomaly','planet') then el->>'kind'
    when coalesce(el->>'type','') ~* 'пояс|астероид|кольцо|belt'  then 'belt'
    when coalesce(el->>'type','') ~* 'аномал|anomal'              then 'anomaly'
    else 'planet' end
$fn$;

-- Пропускная способность тела как БАРЬЕРА: сколько всего плеч может пройти
-- сквозь его орбиту (включая сам хребет). null = телу всё равно, кто мимо летит.
create or replace function public._msl_cap(el jsonb)
returns int language sql immutable as $fn$
  select case
    when public._msl_kind(el) = 'belt' then case
      when coalesce(el->>'type','') ~* 'гиперплотн|сверхплотн' then 1
      when coalesce(el->>'type','') ~* 'плотн'                 then 2
      when coalesce(el->>'type','') ~* 'разрежённ|разрежен'    then 3
      else 2 end                                          -- легаси-пояс без плотности
    when public._msl_kind(el) = 'anomaly'
     and coalesce(el->>'name','') || ' ' || coalesce(el->>'type','') ~* 'чёрн|черн|black' then 1
    else null end
$fn$;

-- ── 3. СБОРКА ГРАФА ОДНОЙ СИСТЕМЫ ───────────────────────────────────────
create or replace function public.map_sys_lanes_build(p_sys text)
returns int language plpgsql security definer set search_path=public as $fn$
declare
  v_planets jsonb; v_stars jsonb;
  letters   text[]; comp_l text[]; L text;
  kinds text[]; dists numeric[]; pids int[]; caps int[];
  m int; i int; b int;
  deg int[]; cross_used int[];
  cand record; ok boolean; bar int; c numeric;
  n_ins int := 0; sep numeric;
  key_a text; key_b text;
begin
  select coalesce(planets, '[]'::jsonb), coalesce(stars, '[]'::jsonb)
    into v_planets, v_stars
    from public.map_systems where id = p_sys;
  if not found then return 0; end if;

  delete from public.map_system_lanes where system_id = p_sys;

  select coalesce(array_agg(distinct s.val->>'letter'), '{}'::text[])
    into comp_l
    from jsonb_array_elements(v_stars) as s(val)
   where coalesce(s.val->>'letter','A') <> 'A';
  letters := array['A'] || coalesce(comp_l, '{}'::text[]);

  foreach L in array letters loop
    -- Лестница тел этой звезды: от солнца наружу.
    -- ⚠ ПОРЯДОК ОБЯЗАН СОВПАДАТЬ С КАРТОЙ. Карта раскладывает орбиты по
    -- `+p.dist || 0` (gmOrbitBodies в galaxy_map.js), то есть тело без dist —
    -- легаси-сид, ручная правка — встаёт САМЫМ БЛИЖНИМ к звезде. Если считать
    -- его здесь самым дальним, хребет протянется через всю систему к телу,
    -- которое на экране сидит вплотную к солнцу (поймано на стенде: Синли-Бей,
    -- тело «Я» без dist).
    select array_agg(q.kk order by q.o), array_agg(q.dd order by q.o),
           array_agg(q.pp order by q.o), array_agg(q.cc order by q.o)
      into kinds, dists, pids, caps
      from (
        select public._msl_kind(el.val) kk,
               coalesce((el.val->>'dist')::numeric, 0) dd,
               (el.val->>'pid')::int pp,
               public._msl_cap(el.val) cc,
               row_number() over (order by coalesce((el.val->>'dist')::numeric, 0), el.ord) o
          from jsonb_array_elements(v_planets) with ordinality as el(val, ord)
         where coalesce(el.val->>'star','A') = L
           and (el.val->>'pid') is not null
      ) q;

    m := coalesce(array_length(pids, 1), 0);
    if m = 0 then continue; end if;

    deg := array_fill(0, array[m]);
    cross_used := array_fill(0, array[m]);   -- сколько плеч уже прошло сквозь тело i

    -- ── ХРЕБЕТ: от крайнего тела внутрь, к звезде ────────────────────────
    -- (пишем от звезды наружу — порядок записи роли не играет, важна цепь)
    for i in 1..m loop
      if i = 1 then key_a := 'S:' || L; else key_a := 'P:' || pids[i-1]; end if;
      key_b := 'P:' || pids[i];
      -- плечо, упирающееся в барьер, помечаем створом: это и есть узкое горло
      bar := null;
      if caps[i] is not null then bar := pids[i];
      elsif i > 1 and caps[i-1] is not null then bar := pids[i-1]; end if;
      c := round(0.6 + 0.4 * ln(1 + abs(dists[i] - case when i = 1 then 0 else dists[i-1] end)), 2);
      insert into public.map_system_lanes(system_id, star, a_key, b_key, kind, cost, gate, barrier_pid)
        values (p_sys, L, key_a, key_b, 'spine', c, bar is not null, bar);
      n_ins := n_ins + 1;
      if i > 1 then deg[i-1] := deg[i-1] + 1; end if;
      deg[i] := deg[i] + 1;
      -- хребет ЗАНИМАЕТ створ барьера: у пояса на пути он и есть тот единственный
      -- проход, ради которого считается ёмкость
      if i > 1 and caps[i-1] is not null then cross_used[i-1] := cross_used[i-1] + 1; end if;
      if caps[i] is not null and i < m then cross_used[i] := cross_used[i] + 1; end if;
    end loop;

    -- ── ХОРДЫ: жадный отбор по цене под тремя ограничениями ──────────────
    --   • размах: дальнее тело не дальше 2.6× ближнего (мимо полсистемы не прыгают);
    --   • степень узла ≤ 3 — иначе у звезды вырастает «ромашка»;
    --   • барьеры: сквозь пояс/чёрную дыру не больше caps[b] плеч ВСЕГО.
    for cand in
      select gi.v as gi, gj.v as gj,
             round(1.6 * (0.6 + 0.4 * ln(1 + abs(dists[gi.v] - dists[gj.v]))), 2) as cst
        from generate_series(1, m) as gj(v), generate_series(1, m) as gi(v)
       where gi.v >= gj.v + 2
         and dists[gi.v] <= dists[gj.v] * 2.6 + 0.6
       order by 3, 2, 1
    loop
      ok := deg[cand.gi] < 3 and deg[cand.gj] < 3;
      bar := null;
      if ok then
        for b in (cand.gj + 1)..(cand.gi - 1) loop
          if caps[b] is not null then
            if cross_used[b] >= caps[b] then ok := false; exit; end if;
            bar := pids[b];
          end if;
        end loop;
      end if;
      if not ok then continue; end if;
      insert into public.map_system_lanes(system_id, star, a_key, b_key, kind, cost, gate, barrier_pid)
        values (p_sys, L, 'P:' || pids[cand.gj], 'P:' || pids[cand.gi], 'chord', cand.cst, bar is not null, bar)
        on conflict do nothing;
      n_ins := n_ins + 1;
      deg[cand.gi] := deg[cand.gi] + 1; deg[cand.gj] := deg[cand.gj] + 1;
      for b in (cand.gj + 1)..(cand.gi - 1) loop
        if caps[b] is not null then cross_used[b] := cross_used[b] + 1; end if;
      end loop;
    end loop;
  end loop;

  -- ── ПЕРЕМЫЧКИ КРАТНОЙ СИСТЕМЫ: главная звезда ↔ каждый компаньон ───────
  -- Цена растёт от сепарации: тесная пара — рукой подать, широкая — дороже
  -- иного межзвёздного плеча.
  foreach L in array coalesce(comp_l, '{}'::text[]) loop
    select coalesce((s.val->>'sep_au')::numeric, 100) into sep
      from jsonb_array_elements(v_stars) as s(val)
     where s.val->>'letter' = L limit 1;
    insert into public.map_system_lanes(system_id, star, a_key, b_key, kind, cost)
      values (p_sys, 'A', 'S:A', 'S:' || L, 'bridge', round(1.2 + 0.5 * ln(1 + coalesce(sep, 100)), 2))
      on conflict do nothing;
    n_ins := n_ins + 1;
  end loop;

  return n_ins;
end$fn$;
revoke all on function public.map_sys_lanes_build(text) from public;
grant execute on function public.map_sys_lanes_build(text) to authenticated;

-- ── 4. ПЕРЕСБОРКА ВСЕЙ КАРТЫ ────────────────────────────────────────────
create or replace function public.map_sys_lanes_build_all()
returns int language plpgsql security definer set search_path=public as $fn$
declare s text; n int := 0;
begin
  for s in select id from public.map_systems loop
    n := n + public.map_sys_lanes_build(s);
  end loop;
  return n;
end$fn$;
revoke all on function public.map_sys_lanes_build_all() from public;
grant execute on function public.map_sys_lanes_build_all() to authenticated;

-- ── 5. АВТОПЕРЕСБОРКА ПРИ ПРАВКЕ СОСТАВА ────────────────────────────────
-- Иначе граф пришлось бы катать руками после каждой правки в редакторе карты
-- (и он бы разошёлся с планетами — ровно та грабля, что уже была с pid).
create or replace function public._msl_touch()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  perform public.map_sys_lanes_build(new.id);
  return null;
end$fn$;
drop trigger if exists msl_touch on public.map_systems;
create trigger msl_touch after insert or update of planets, stars on public.map_systems
  for each row execute function public._msl_touch();

-- ── 6. ПЕРВИЧНАЯ СБОРКА ─────────────────────────────────────────────────
select public.map_sys_lanes_build_all() as lanes_built;
