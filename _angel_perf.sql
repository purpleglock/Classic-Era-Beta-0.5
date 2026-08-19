-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 10: ВЫБОР ЦЕЛИ ПЕРЕСТАЁТ ЖЕЧЬ БАЗУ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_ai.sql, перед _angel_lock.sql.
--
-- ЗАМЕР: _angel_pick_target() = 2742 мс, и из них же складывался почти весь
-- angel_war_tick (3156 мс). Это не то, что положило сайт 19.08 (там был отзыв
-- прав, см. _angel_hotfix_perm.sql), но три секунды тяжёлой работы каждые пять
-- минут на общей с игроками базе — это налог, который платят все.
--
-- ПРИЧИНА. Обход галактики вызывался ПОКАЖДОЙ СИСТЕМЕ: `_mza_hops(here, ms.id, 5)`
-- стоял и в WHERE, и в ORDER BY, а систем 342. То есть до 684 рекурсивных
-- обходов гиперпутей на один выбор цели — и каждый заново разворачивал одну и
-- ту же сеть от одной и той же точки.
--
-- ЛЕЧЕНИЕ. Развернуть сеть ОДИН раз от текущей точки и дальше только
-- присоединять к ней кандидатов. Тот же ответ, одна волна вместо сотен.
-- ════════════════════════════════════════════════════════════

-- Достижимость от точки за p_max прыжков: одна волна по гиперпутям.
create or replace function public._angel_reach(p_from text, p_max int)
returns table(sid text, d int) language sql stable security definer set search_path=public as $$
  with recursive w(id, d) as (
    select p_from, 0
    union
    select case when l.a_id = w.id then l.b_id else l.a_id end, w.d + 1
      from w join public.map_hyperlanes l on (l.a_id = w.id or l.b_id = w.id)
     where w.d < p_max
  )
  select id, min(d)::int from w where id <> p_from group by id
$$;

create or replace function public._angel_pick_target()
returns text language plpgsql security definer set search_path=public as $$
declare a record; f record; here text; res text; log jsonb;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return null; end if;
  select * into f from public.fleets where id = a.fleet_id;
  here := coalesce(f.system_id, f.from_sys);
  if here is null then return null; end if;
  log := coalesce(a.path_log, '[]'::jsonb);

  -- Одна волна на весь выбор: дальше только соединения с ней.
  create temp table if not exists _angel_reach_tmp(sid text primary key, d int) on commit drop;
  delete from _angel_reach_tmp;
  insert into _angel_reach_tmp select sid, d from public._angel_reach(here, 5);

  -- 1) враг
  select r.sid into res
    from _angel_reach_tmp r
   where exists(select 1 from public.colonies c
                 where c.system_id = r.sid
                   and c.faction_id in (select public.war_enemies_of(a.faction_id)))
   order by (log ? r.sid) asc,
            (select count(*) from public.colonies c where c.system_id = r.sid) desc,
            r.d asc
   limit 1;
  if res is not null then return res; end if;

  -- 2) чужая жирная
  select r.sid into res
    from _angel_reach_tmp r
   where exists(select 1 from public.colonies c
                 where c.system_id = r.sid and c.faction_id is distinct from a.faction_id)
   order by (log ? r.sid) asc,
            (select coalesce(sum(coalesce(c.pop,0)),0) from public.colonies c
              where c.system_id = r.sid) desc,
            r.d asc
   limit 1;
  if res is not null then return res; end if;

  -- 3) хоть куда, лишь бы не стоять
  select case when l.a_id = here then l.b_id else l.a_id end into res
    from public.map_hyperlanes l
   where l.a_id = here or l.b_id = here
   order by (log ? case when l.a_id = here then l.b_id else l.a_id end) asc, random()
   limit 1;
  return res;
end$$;

notify pgrst, 'reload schema';
