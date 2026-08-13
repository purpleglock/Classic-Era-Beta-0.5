-- ════════════════════════════════════════════════════════════
-- ЛЕГИОН, ШАГ 1: ФРАКЦИЯ, ДАВЛЕНИЕ ПО СЕКТОРАМ, АГГРО
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _map_sectors.sql (map_sectors), _army_fleet.sql (fleets),
-- _outpost_depot.sql (outposts.mode), _pirate_fleet.sql (корпуса Дивизиона).
-- Дальше по цепочке: _legion_contacts.sql → _legion_tick.sql. Идемпотентно.
--
-- ЗАМЫСЕЛ. Легион — не держава и не игрок. Как и 'bot', это СИНТЕТИЧЕСКИЙ fid:
-- строки в map_factions ему НЕ заводим намеренно — иначе он полезет во все
-- списки держав (дипломатия, колонизация, унии, реестр войн), а он там не нужен
-- и не должен быть кликабелен. Имя и цвет отдаёт _legion_meta(), клиент рисует
-- по ней. Корпуса Легион берёт готовые — 6 пиратских проектов Железного
-- Дивизиона (fac_5bfbfad5f8) из _pirate_fleet.sql, своих не плодим.
--
-- ПОЧЕМУ ДАВЛЕНИЕ, А НЕ СПАМ ФЛОТАМИ. Бесконечный нерест кораблей превращает
-- пиратов либо в фон, который никто не замечает, либо в вал, который нечем
-- держать. Здесь у Легиона один ресурс — ДАВЛЕНИЕ, копится посекторно:
--   • растёт там, где ЖИРНО (колонии, достаток, чужие караваны сквозь сектор);
--   • глохнет там, где УБРАНО (флоты на стоянке, аванпосты, мины, посты дронов);
--   • тратится на снаряжение отряда и НЕ ВОЗВРАЩАЕТСЯ, если отряд погиб.
-- Отсюда обратная связь, которой не было: зачистил сектор — стало тише;
-- разбогател и не прибрал — стало громче. Потолок копилки не даёт Легиону
-- «накопить на конец света», пока игрок неделю не заходит.
--
-- АГГРО — это память, а не злость. Кто бил Легион и кто жирнее, тот и получает
-- следующий визит. Живёт по державам, медленно тает (полураспад ~7 суток),
-- чтобы старые обиды не определяли игру вечно.
-- ════════════════════════════════════════════════════════════

-- ── 0. Кто такой Легион ─────────────────────────────────────
-- Один источник правды по id/имени/цвету: и тик, и клиент, и бой зовут ЭТО,
-- а не хардкодят строку в пяти местах.
create or replace function public._legion_fid() returns text
  language sql immutable as $$ select 'legion'::text $$;

create or replace function public._legion_meta() returns jsonb
  language sql stable as $$
  select jsonb_build_object(
    'fid',   public._legion_fid(),
    'name',  'Железный Легион',
    'short', 'Легион',
    'color', 'rgba(196,74,42,0.34)',
    -- откуда Легион берёт корпуса: проекты Железного Дивизиона (_pirate_fleet.sql)
    'hull_fid', 'fac_5bfbfad5f8')
$$;

-- ── 1. ДАВЛЕНИЕ ПО СЕКТОРАМ ─────────────────────────────────
create table if not exists public.legion_pressure (
  sector_id    uuid primary key references public.map_sectors(id) on delete cascade,
  pressure     numeric not null default 0,     -- копилка сектора
  spent_total  numeric not null default 0,     -- сколько всего ушло на отряды (для баланса)
  lost_total   numeric not null default 0,     -- сколько сгорело вместе с отрядами
  last_accrue  timestamptz not null default now()
);
-- Копилка — не игровые данные игрока, а внутренняя кухня ИИ: читать её напрямую
-- нельзя никому. Наружу давление просачивается ТОЛЬКО контактами (шаг 2).
alter table public.legion_pressure enable row level security;

create table if not exists public.legion_aggro (
  faction_id    text primary key,
  aggro         numeric not null default 0,
  last_provoke  timestamptz,
  last_reason   text,
  updated_at    timestamptz not null default now()
);
alter table public.legion_aggro enable row level security;

-- ── 2. ГЕОМЕТРИЯ: в каком секторе система ───────────────────
create or replace function public._legion_sector_of(p_sys text)
returns uuid language sql stable security definer set search_path=public as $$
  select s.id from public.map_sectors s
   where p_sys = any(s.system_ids) limit 1
$$;
revoke all on function public._legion_sector_of(text) from public;

-- ── 3. ЖИРНОСТЬ СЕКТОРА: ради чего сюда лететь ──────────────
-- Колонии и их достаток + чужие караваны, чьи концы лежат в секторе.
-- Намеренно считаем ЧУЖОЕ богатство целиком, без скидки на владельца: Легиону
-- всё равно, чьё грабить, и это делает богатые тихие углы опасными сами по себе.
create or replace function public._legion_sector_fat(p_sector uuid)
returns numeric language sql stable security definer set search_path=public as $$
  with sys as (
    select unnest(system_ids) sid from public.map_sectors where id = p_sector
  )
  select
    -- колонии: сама колония весит 1, достаток добавляет до ~1.5 сверху
    coalesce((select count(*) from public.colonies c join sys on sys.sid = c.system_id
               where c.faction_id is not null), 0) * 1.0
  + coalesce((select sum(greatest(0, least(150, e.prosperity))) / 100.0
                from public.system_econ e join sys on sys.sid = e.system_id), 0)
    -- караваны: концы трассы в секторе — значит, сквозь него возят
  + coalesce((select count(*) * 0.6 from public.trade_routes r
               where r.status = 'active'
                 and (r.origin_sys in (select sid from sys)
                   or r.dest_sys   in (select sid from sys))), 0)
$$;
revoke all on function public._legion_sector_fat(uuid) from public;

-- ── 4. ПРИБРАНО ЛИ В СЕКТОРЕ ────────────────────────────────
-- Всё, что физически мешает работать: стоящие флоты, аванпосты (застава и
-- разведка держат крепче, чем шахта), мины и крылья дронов.
-- Пустой экипаж аванпоста не считается — брошенная станция никого не пугает.
create or replace function public._legion_sector_guard(p_sector uuid)
returns numeric language sql stable security definer set search_path=public as $$
  with sys as (
    select unnest(system_ids) sid from public.map_sectors where id = p_sector
  )
  select
    coalesce((select sum(greatest(0,(c->>'qty')::int)) * 0.25
                from public.fleets f join sys on sys.sid = f.system_id,
                     jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
               where f.status = 'idle'
                 and f.faction_id is distinct from public._legion_fid()), 0)
  + coalesce((select sum(case when o.mode = 'mining' then 0.5 else 1.2 end)
                from public.outposts o join sys on sys.sid = o.system_id
               where coalesce(o.crew,0) > 0), 0)
  + coalesce((select sum(least(6, greatest(0, m.hexes))) * 0.15
                from public.system_minefields m join sys on sys.sid = m.system_id), 0)
  + coalesce((select sum(least(4, greatest(0, d.wings))) * 0.4
                from public.system_drone_posts d join sys on sys.sid = d.system_id), 0)
$$;
revoke all on function public._legion_sector_guard(uuid) from public;

-- ── 5. ТИК ДАВЛЕНИЯ ─────────────────────────────────────────
-- Раз в час. Считаем ПЛОТНОСТЬ на систему, а не валовые суммы: сектора разного
-- размера (22 … 60 систем) иначе несопоставимы — большой всегда «жирнее»
-- маленького просто потому, что большой, и Легион бы вечно жил в одном углу.
-- Прирост = фон + плотность добычи − плотность обороны. Фон крошечный, но
-- ненулевой: вычищенный сектор становится тихим, а не безопасным НАВСЕГДА.
-- Потолок = 15 + 6×плотность: в нищем углу не на что снарядить большой удар,
-- в богатом есть — но не бесконечно, недельное отсутствие игрока не копит
-- конец света.
create or replace function public.legion_pressure_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare s record; fat numeric; guard numeric; gain numeric; cap numeric;
        nsys numeric; fatn numeric; guardn numeric;
        hrs numeric; touched int := 0; total numeric := 0;
begin
  for s in select id, coalesce(array_length(system_ids,1),0) ns from public.map_sectors loop
    if s.ns = 0 then continue; end if;
    -- новый сектор начинает с часовой «задолженностью», иначе первый тик после
    -- наката всегда пустой (last_accrue = now() → hrs = 0)
    insert into public.legion_pressure(sector_id, last_accrue)
      values (s.id, now() - interval '1 hour')
      on conflict (sector_id) do nothing;

    select greatest(0, least(6, extract(epoch from (now() - lp.last_accrue))/3600.0))
      into hrs from public.legion_pressure lp where lp.sector_id = s.id;
    -- пропущенные часы добираем, но не больше 6 за раз: после простоя сервера
    -- Легион не должен разом обрушиться на всех
    if hrs < 0.5 then continue; end if;

    nsys   := greatest(1, s.ns);
    fat    := public._legion_sector_fat(s.id);
    guard  := public._legion_sector_guard(s.id);
    fatn   := fat / nsys;
    guardn := guard / nsys;
    cap    := 15 + fatn * 6;
    gain   := (0.02 + fatn * 0.06 - guardn * 0.05) * hrs;

    update public.legion_pressure
       set pressure    = greatest(0, least(cap, pressure + gain)),
           last_accrue = now()
     where sector_id = s.id;
    touched := touched + 1;
  end loop;

  -- аггро тает: полураспад ~7 суток
  update public.legion_aggro
     set aggro = case when aggro < 0.05 then 0 else aggro * 0.99 end,
         updated_at = now()
   where aggro > 0;

  select coalesce(sum(pressure),0) into total from public.legion_pressure;
  return jsonb_build_object('ok', true, 'sectors', touched, 'pressure_total', round(total,2));
end$$;
revoke all on function public.legion_pressure_tick() from public;

-- ── 6. ТРАТА ДАВЛЕНИЯ ───────────────────────────────────────
-- Списывает ровно p_amount или ничего: снарядить «половину отряда» нельзя.
-- Возврата нет и не будет — потерянный отряд это потраченный сектор-месяц,
-- ради чего игроку и есть смысл драться, а не пропускать удар.
create or replace function public._legion_spend(p_sector uuid, p_amount numeric)
returns boolean language plpgsql security definer set search_path=public as $$
declare cur numeric;
begin
  if p_sector is null or coalesce(p_amount,0) <= 0 then return false; end if;
  select pressure into cur from public.legion_pressure
    where sector_id = p_sector for update;
  if cur is null or cur < p_amount then return false; end if;
  update public.legion_pressure
     set pressure = pressure - p_amount,
         spent_total = spent_total + p_amount
   where sector_id = p_sector;
  return true;
end$$;
revoke all on function public._legion_spend(uuid,numeric) from public;

-- Отряд погиб: записываем потерю в статистику сектора (давление уже списано).
create or replace function public._legion_lost(p_sector uuid, p_amount numeric)
returns void language sql security definer set search_path=public as $$
  update public.legion_pressure
     set lost_total = lost_total + greatest(0, coalesce(p_amount,0))
   where sector_id = p_sector;
$$;
revoke all on function public._legion_lost(uuid,numeric) from public;

-- ── 7. АГГРО ────────────────────────────────────────────────
-- Зовётся из боя, из рейдов и из тика. Причина хранится ради «Угроз» в кабинете:
-- игрок должен понимать, ЗА ЧТО им занялись, иначе это просто случайный шум.
create or replace function public._legion_aggro_add(p_fid text, p_amount numeric, p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_fid is null or p_fid = public._legion_fid() or coalesce(p_amount,0) = 0 then return; end if;
  insert into public.legion_aggro(faction_id, aggro, last_provoke, last_reason)
       values (p_fid, greatest(0, p_amount), now(), p_reason)
  on conflict (faction_id) do update
     set aggro        = greatest(0, public.legion_aggro.aggro + p_amount),
         last_provoke = case when p_amount > 0 then now() else public.legion_aggro.last_provoke end,
         last_reason  = coalesce(case when p_amount > 0 then p_reason end, public.legion_aggro.last_reason),
         updated_at   = now();
end$$;
revoke all on function public._legion_aggro_add(text,numeric,text) from public;

-- ── 8. СВОДКА (админ/отладка; игроку это НЕ показываем) ─────
create or replace function public.legion_state()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'meta', public._legion_meta(),
    'sectors', coalesce((select jsonb_agg(jsonb_build_object(
        'sector', s.name,
        'pressure', round(lp.pressure,2),
        'sys',   coalesce(array_length(s.system_ids,1),0),
        -- плотности, а не валовые суммы: по ним и настраивается баланс
        'fat',   round(public._legion_sector_fat(s.id) / greatest(1,coalesce(array_length(s.system_ids,1),1)),2),
        'guard', round(public._legion_sector_guard(s.id) / greatest(1,coalesce(array_length(s.system_ids,1),1)),2),
        'spent', round(lp.spent_total,2),
        'lost',  round(lp.lost_total,2)) order by lp.pressure desc)
      from public.legion_pressure lp join public.map_sectors s on s.id = lp.sector_id), '[]'::jsonb),
    'aggro', coalesce((select jsonb_agg(jsonb_build_object(
        'fid', a.faction_id, 'aggro', round(a.aggro,2), 'reason', a.last_reason)
        order by a.aggro desc)
      from public.legion_aggro a where a.aggro > 0), '[]'::jsonb))
$$;
revoke all on function public.legion_state() from public;

-- ── 9. ЧАСОВОЙ ТИК ──────────────────────────────────────────
-- Рядом с market_tick (каждые 10 мин) держать незачем: давление — величина
-- суточного масштаба, часа хватает. Идемпотентно пересоздаём задание.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('legion-pressure-tick')
      where exists (select 1 from cron.job where jobname = 'legion-pressure-tick');
    perform cron.schedule('legion-pressure-tick', '13 * * * *',
                          'select public.legion_pressure_tick();');
  end if;
end$$;
