-- ════════════════════════════════════════════════════════════
-- ЛЕГИОН, ШАГ 2: СИГНАТУРЫ ВМЕСТО ФЛОТОВ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _legion_faction.sql (давление/аггро), _fleet_route.sql
-- (Дейкстра _fleet_path + _fleet_schedule + _fleet_leg_hours) и
-- _outpost_depot.sql (_outpost_crew_k, _fleet_coverage). Идемпотентно.
-- Дальше: _legion_tick.sql (кто и куда полетит), затем стыковка с боем.
--
-- ЗАМЫСЕЛ. Легион не гоняет по карте настоящие флоты — он идёт КОНТАКТОМ:
-- отметкой, которая ползёт по гиперпутям и материализуется в бой/рейд только
-- на месте (шаг 4). Так пиратов может быть много и часто, не превращая карту
-- в кашу из иконок и не сжигая тик на пересчёт сотен корабельных составов.
--
-- ГЛАВНОЕ РЕШЕНИЕ: СОСТОЯНИЕ КОНТАКТА — НЕ У КОНТАКТА, А У ЗРИТЕЛЯ.
-- Наивно было бы хранить ghost/signature/resolved полем в самой строке. Тогда
-- держава, вскрывшая контакт своей сетью, вскрывала бы его ВСЕМ — включая тех,
-- у кого в том углу нет ничего. Это убило бы весь смысл аванпостов. Поэтому
-- сам контакт объективен (где идёт, куда, чем снаряжён), а ступень
-- осведомлённости считается ПО КАЖДОЙ ДЕРЖАВЕ отдельно, в legion_sightings:
--   ghost      — «в секторе неспокойно»: сектор и только. Даёт любое присутствие
--                в секторе: держава чует шевеление у себя дома, но не более.
--   signature  — система и время подхода, сила полосой («заметная»), без состава.
--                Даёт обычное сенсорное покрытие (_fleet_coverage: свои системы
--                и соседи от укомплектованных станций и колоний).
--   resolved   — цель, замысел и оценка состава. Даёт ТОЛЬКО recon-аванпост с
--                ПОЛНЫМ экипажем в системе контакта или в соседней.
-- Отсюда и растёт ценность сети застав: без неё игрок слепой и получает удар
-- без предупреждения, с ней — видит, куда и зачем идут, за сутки.
--
-- Засечки НЕ стираются, когда контакт уходит из-под сенсора: остаётся
-- последнее известное положение. Разведка — это память, а не прямая трансляция.
-- ════════════════════════════════════════════════════════════

-- ── 1. КОНТАКТ ──────────────────────────────────────────────
create table if not exists public.legion_contacts (
  id          uuid primary key default gen_random_uuid(),
  sector_id   uuid references public.map_sectors(id) on delete set null,
  kind        text not null default 'probe',   -- probe | blind | strike (шаг 3)
  strength    numeric not null default 0,      -- сколько давления в него вложено
  target_fid  text,                            -- на чьё добро идёт
  target_sys  text,                            -- куда именно
  origin_sys  text,
  route       jsonb,                           -- [sys, sys, …] — узлы трассы
  route_at    jsonb,                           -- [ts, ts, …] — время прохода узлов
  depart_at   timestamptz not null default now(),
  arrive_at   timestamptz,
  state       text not null default 'inbound', -- inbound | landed | spent | gone
  fleet_id    uuid,                            -- материализовался в флот (шаг 4)
  created_at  timestamptz not null default now()
);
create index if not exists legion_contacts_state_idx on public.legion_contacts(state);
create index if not exists legion_contacts_target_idx on public.legion_contacts(target_fid);
-- Сырьё ИИ. Игроку выдаётся только через legion_contacts_visible(), просеянным
-- через его собственные сенсоры — прямого чтения нет ни у кого.
alter table public.legion_contacts enable row level security;

-- ── 2. ЗАСЕЧКА: что КОНКРЕТНАЯ держава знает о контакте ─────
create table if not exists public.legion_sightings (
  contact_id  uuid not null references public.legion_contacts(id) on delete cascade,
  faction_id  text not null,
  grade       text not null default 'ghost',   -- ghost | signature | resolved
  last_sys    text,                            -- последнее известное положение
  last_sector uuid,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  notified    boolean not null default false,  -- шаг 5: оповещение уже ушло
  primary key (contact_id, faction_id)
);
alter table public.legion_sightings enable row level security;

-- ── 3. ГДЕ КОНТАКТ СЕЙЧАС ───────────────────────────────────
-- Зеркало fleet_position, но по строке контакта: узлы маршрута + время прохода.
-- Возвращает последний ПРОЙДЕННЫЙ узел — там его и застают.
create or replace function public.legion_contact_position(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare k public.legion_contacts; n int; i int; ta timestamptz; tb timestamptz;
begin
  select * into k from public.legion_contacts where id = p_id;
  if k.id is null then return null; end if;
  if k.route is null or jsonb_array_length(k.route) < 2 then
    return jsonb_build_object('at', coalesce(k.target_sys, k.origin_sys), 'leg', 0, 'legs', 0);
  end if;
  n := jsonb_array_length(k.route);
  if now() >= coalesce(k.arrive_at, k.depart_at) then
    return jsonb_build_object('at', k.route->>(n-1), 'leg', n-1, 'legs', n-1, 'arrived', true);
  end if;
  for i in 0 .. n - 2 loop
    ta := (k.route_at->>i)::timestamptz;
    tb := (k.route_at->>(i+1))::timestamptz;
    if now() < tb then
      return jsonb_build_object(
        'at',   k.route->>i,          -- последний пройденный узел
        'next', k.route->>(i+1),
        'leg',  i, 'legs', n-1,
        't',    case when tb > ta then
                  round(extract(epoch from (now()-ta)) / nullif(extract(epoch from (tb-ta)),0), 3)
                else 0 end,
        'arrive_at', k.arrive_at);
    end if;
  end loop;
  return jsonb_build_object('at', k.route->>(n-1), 'leg', n-1, 'legs', n-1, 'arrived', true);
end$$;
revoke all on function public.legion_contact_position(uuid) from public;

-- ── 4. ЗАПУСК КОНТАКТА (зовёт шаг 3) ────────────────────────
-- Давление уже должно быть списано вызывающим (_legion_spend): здесь только
-- прокладка маршрута. Выход из сектора — из системы, где Легиону вольготнее
-- всего: ничья или с самым слабым присмотром, но обязательно в этом секторе.
create or replace function public._legion_contact_spawn(
  p_sector uuid, p_target_fid text, p_target_sys text,
  p_kind text default 'probe', p_strength numeric default 0)
returns uuid language plpgsql security definer set search_path=public as $$
declare src text; path jsonb; sch jsonb; kid uuid; n int;
begin
  if p_sector is null or p_target_sys is null then return null; end if;

  -- откуда лезут: система сектора без колоний и без укомплектованных станций,
  -- предпочтительно подальше от цели — логово, а не парадный вход.
  -- ⚠ «Подальше» меряем ПО КООРДИНАТАМ, а не _fleet_jumps: сортировка по
  -- прыжкам гоняла Дейкстру на каждую систему сектора (47 прогонов на сектор,
  -- ход кампании занимал 30 с при лимите 57). Для выбора угла, из которого
  -- вылезут пираты, точность графа не нужна — нужен дальний край.
  select sid into src from (
    select unnest(s.system_ids) sid from public.map_sectors s where s.id = p_sector
  ) q
  join public.map_systems ms on ms.id = q.sid
  cross join (select x tx, y ty from public.map_systems where id = p_target_sys) tg
  where not exists (select 1 from public.colonies c where c.system_id = q.sid)
    and not exists (select 1 from public.outposts o where o.system_id = q.sid
                      and public._outpost_crew_k(o.crew, o.mode) >= 0.5)
  order by ((ms.x - tg.tx)^2 + (ms.y - tg.ty)^2) desc
  limit 1;
  -- сектор вычищен под ноль — Легион всё равно откуда-то приходит, берём дальний край
  if src is null then
    select sid into src from (
      select unnest(s.system_ids) sid from public.map_sectors s where s.id = p_sector
    ) q
    join public.map_systems ms on ms.id = q.sid
    cross join (select x tx, y ty from public.map_systems where id = p_target_sys) tg
    order by ((ms.x - tg.tx)^2 + (ms.y - tg.ty)^2) desc limit 1;
  end if;
  if src is null or src = p_target_sys then return null; end if;

  path := public._fleet_path(src, p_target_sys);
  if path is null or jsonb_array_length(path) < 2 then return null; end if;
  sch := public._fleet_schedule(path, now());
  n   := jsonb_array_length(path);

  insert into public.legion_contacts(sector_id, kind, strength, target_fid, target_sys,
                                     origin_sys, route, route_at, depart_at, arrive_at)
  values (p_sector, coalesce(p_kind,'probe'), greatest(0,coalesce(p_strength,0)),
          p_target_fid, p_target_sys, src, path, sch, now(),
          (sch->>(n-1))::timestamptz)
  returning id into kid;
  return kid;
end$$;
revoke all on function public._legion_contact_spawn(uuid,text,text,text,numeric) from public;

-- ── 5. КТО ЧТО ЗАСЁК ────────────────────────────────────────
-- Ступень осведомлённости державы p_fid о контакте, стоящем в системе p_sys.
-- Порядок проверок = порядок убывания требований к сети.
create or replace function public._legion_grade(p_fid text, p_sys text, p_sector uuid)
returns text language sql stable security definer set search_path=public as $$
  select case
    -- resolved: ПОЛНЫЙ экипаж recon-станции в этой системе или в соседней.
    -- Именно здесь заставы наконец отрабатывают вложенные в них деньги.
    when exists (
      select 1 from public.outposts o
       where o.faction_id = p_fid and o.mode = 'recon'
         and public._outpost_crew_k(o.crew, o.mode) >= 1.0
         and (o.system_id = p_sys
              or exists (select 1 from public.map_hyperlanes hl
                          where (hl.a_id = o.system_id and hl.b_id = p_sys)
                             or (hl.b_id = o.system_id and hl.a_id = p_sys)))
    ) then 'resolved'
    -- signature: обычное сенсорное покрытие (свои системы + соседи от
    -- укомплектованных станций и колоний)
    when exists (select 1 from public._fleet_coverage(p_fid) c where c.sid = p_sys)
      then 'signature'
    -- ghost: хоть что-то своё в этом секторе — «дома неспокойно»
    when p_sector is not null and exists (
      select 1 from public.map_sectors s
       where s.id = p_sector
         and (exists (select 1 from public.colonies c
                       where c.faction_id = p_fid and c.system_id = any(s.system_ids))
           or exists (select 1 from public.outposts o
                       where o.faction_id = p_fid and o.system_id = any(s.system_ids)))
    ) then 'ghost'
    else null end
$$;
revoke all on function public._legion_grade(text,text,uuid) from public;

-- Ступени сравнимы: засечка только УЛУЧШАЕТСЯ, ухудшить её нельзя.
-- Потерять из виду — не то же самое, что «узнать меньше».
create or replace function public._legion_grade_rank(p_grade text)
returns int language sql immutable as $$
  select case p_grade when 'resolved' then 3 when 'signature' then 2
                      when 'ghost' then 1 else 0 end
$$;

-- ── 6. СКАНИРОВАНИЕ: раскладываем засечки по державам ───────
-- Крутится в тике, а не при открытии карты: иначе оповещение о подходе
-- приходило бы только тем, кто как раз смотрит на экран.
create or replace function public.legion_contacts_scan()
returns jsonb language plpgsql security definer set search_path=public as $$
declare k record; f record; pos jsonb; sys text; g text; n int := 0;
begin
  for k in select * from public.legion_contacts where state = 'inbound' loop
    pos := public.legion_contact_position(k.id);
    sys := pos->>'at';
    if sys is null then continue; end if;

    for f in select distinct faction_id fid from public.colonies where faction_id is not null loop
      g := public._legion_grade(f.fid, sys, k.sector_id);
      if g is null then continue; end if;

      insert into public.legion_sightings(contact_id, faction_id, grade, last_sys, last_sector)
        values (k.id, f.fid, g, sys, k.sector_id)
      on conflict (contact_id, faction_id) do update set
        -- ступень только вверх; положение обновляем, пока видим
        grade = case when public._legion_grade_rank(excluded.grade)
                        > public._legion_grade_rank(public.legion_sightings.grade)
                     then excluded.grade else public.legion_sightings.grade end,
        last_sys    = excluded.last_sys,
        last_sector = excluded.last_sector,
        last_seen   = now();
      n := n + 1;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'sightings', n);
end$$;
revoke all on function public.legion_contacts_scan() from public;

-- ── 7. ЧТО ВИДИТ ИГРОК ──────────────────────────────────────
-- Объём выдачи режется ступенью. Это единственная дверь наружу: сами таблицы
-- под RLS без политик, прямого select по ним нет ни у кого.
create or replace function public.legion_contacts_visible()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(row order by row->>'eta' nulls last)
    from (
      select jsonb_strip_nulls(jsonb_build_object(
        'id',     g.contact_id,
        'grade',  g.grade,
        'sector', sec.name,
        'since',  g.first_seen,
        'seen',   g.last_seen,
        -- signature и выше: где идёт и когда дойдёт
        'sys',    case when public._legion_grade_rank(g.grade) >= 2 then g.last_sys end,
        'eta',    case when public._legion_grade_rank(g.grade) >= 2 then k.arrive_at end,
        'band',   case when public._legion_grade_rank(g.grade) >= 2 then
                    case when k.strength >= 45 then 'крупная'
                         when k.strength >= 20 then 'заметная'
                         else 'слабая' end end,
        -- resolved: куда и зачем идут, плюс оценка состава
        'target_sys', case when g.grade = 'resolved' then k.target_sys end,
        'mine',       case when g.grade = 'resolved' then (k.target_fid = fid) end,
        'kind',       case when g.grade = 'resolved' then k.kind end,
        'ships',      case when g.grade = 'resolved'
                           then greatest(1, round(k.strength / 8.0))::int end
      )) as row
      from public.legion_sightings g
      join public.legion_contacts k on k.id = g.contact_id
      left join public.map_sectors sec on sec.id = g.last_sector
      where g.faction_id = fid and k.state = 'inbound'
    ) q
  ), '[]'::jsonb);
end$$;
revoke all on function public.legion_contacts_visible() from public;
grant execute on function public.legion_contacts_visible() to authenticated;

-- ── 8. УБОРКА ───────────────────────────────────────────────
-- Долетевшие обрабатывает шаг 4 (бой/рейд). Здесь только гигиена: контакт,
-- который долетел и не был обработан за сутки, гасим — иначе висяки копятся,
-- а игроку на карте маячит отметка, за которой ничего не стоит.
create or replace function public.legion_contacts_sweep()
returns jsonb language plpgsql security definer set search_path=public as $$
declare landed int; gone int;
begin
  update public.legion_contacts
     set state = 'landed'
   where state = 'inbound' and arrive_at is not null and now() >= arrive_at;
  get diagnostics landed = row_count;

  update public.legion_contacts
     set state = 'gone'
   where state = 'landed' and arrive_at < now() - interval '24 hours';
  get diagnostics gone = row_count;

  delete from public.legion_contacts
   where state = 'gone' and arrive_at < now() - interval '7 days';

  return jsonb_build_object('ok', true, 'landed', landed, 'gone', gone);
end$$;
revoke all on function public.legion_contacts_sweep() from public;

-- ── 9. ТИК КОНТАКТОВ ────────────────────────────────────────
-- Каждые 15 минут: сигнатура должна ползти заметно чаще, чем копится давление,
-- иначе «подходят через 9 часов» превращается в «уже на пороге».
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('legion-contacts-scan')
      where exists (select 1 from cron.job where jobname = 'legion-contacts-scan');
    perform cron.schedule('legion-contacts-scan', '*/15 * * * *',
      'select public.legion_contacts_sweep(); select public.legion_contacts_scan();');
  end if;
end$$;
