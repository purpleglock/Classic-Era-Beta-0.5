-- ============================================================
-- ПОЛИТИКА: ЗАКРЫТИЕ ГРАНИЦ (ПОФРАКЦИОННО)
--
-- Блок «Границы» во вкладке «Дипломатия» — доступен ЛЮБОЙ фракции
-- сразу, БЕЗ исследования. Границы закрываются ДЛЯ ВЫБРАННЫХ фракций
-- (jsonb-список fid в faction_economy.borders_closed_fids):
--   • fid В СПИСКЕ → его флоты НЕ могут прилетать в системы владельца
--     (map_systems.faction = owner), а гипермаршруты СКВОЗЬ её системы
--     строятся в обход (растёт число прыжков → дороже топливо).
--     Флоты летают ТОЛЬКО по гиперпутям — евклидового «глухого космоса»
--     здесь НЕТ. Обход по трассам есть → летим в объезд (дороже топливо).
--     Обхода нет → вылет запрещён («путь перекрыт» / «нет гиперпути»).
--     Граница закрылась, пока флот УЖЕ ЛЕТЕЛ → флот завершает полёт в
--     ближайшей открытой системе своего маршрута (не в закрытой цели).
--   • Союзники по федерации/конфедерации (diplo_members, один union_id)
--     проходят свободно, даже если попали в список. Своя фракция — тоже.
--
-- Применять в Supabase → SQL Editor ПОСЛЕ (порядок важен, клоббер!):
--   _army_fleet.sql → _fleet_ops.sql → _fleet_intel.sql →
--   _spy_fleet_ops.sql → ЭТОТ ФАЙЛ.
-- fleet_send здесь — НАДМНОЖЕСТВО версии из _spy_fleet_ops.sql
-- (сохранён stalled_until-чек диверсии). Идемпотентно.
-- Зеркало клиента: economy.js вкладка «Дипломатия» (ecBordersBlock)
-- ?v=20260706borders3 + galaxy_map.js слой карты «Закрытые границы»
-- (gmToggleBlocked → RPC borders_blocked_fids, штриховка gmmPaintBlocked)
-- ?v=20260706blockmap1.
-- ============================================================

-- ── 1) Список фракций, для которых границы закрыты ───────────
alter table public.faction_economy
  add column if not exists borders_closed_fids jsonb not null default '[]'::jsonb;

-- ── 2) Переключатель границ (RPC из кабинета) ────────────────
-- p_fid = конкретная фракция; p_fid IS NULL = все текущие фракции разом.
-- p_closed = true → закрыть, false → открыть.
drop function if exists public.borders_set(boolean); -- старая глобальная версия
create or replace function public.borders_set(p_fid text, p_closed boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; cur jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select coalesce(borders_closed_fids, '[]'::jsonb) into cur
    from public.faction_economy where faction_id = fid for update;
  if cur is null then raise exception 'нет экономики фракции'; end if;
  if p_fid is null then
    if coalesce(p_closed, false) then
      select coalesce(jsonb_agg(faction_id), '[]'::jsonb) into cur
        from public.faction_applications
        where status = 'approved' and faction_id is not null and faction_id <> fid;
    else
      cur := '[]'::jsonb;
    end if;
  else
    if p_fid = fid then raise exception 'нельзя закрыть границы от самих себя'; end if;
    if not exists(select 1 from public.faction_applications
                  where faction_id = p_fid and status = 'approved') then
      raise exception 'no such faction';
    end if;
    cur := cur - p_fid;  -- jsonb-минус убирает строку из массива (и дедуплицирует)
    if coalesce(p_closed, false) then cur := cur || jsonb_build_array(p_fid); end if;
  end if;
  update public.faction_economy set borders_closed_fids = cur where faction_id = fid;
  return jsonb_build_object('ok', true, 'closed_fids', cur);
end$$;
revoke all on function public.borders_set(text, boolean) from public;
grant execute on function public.borders_set(text, boolean) to authenticated;

-- ── 2б) Кто закрыл границы ДЛЯ МЕНЯ (слой карты «Закрытые границы») ──
-- Возвращает jsonb-массив fid фракций, чьи территории закрыты для вызывающего:
-- мой fid в их borders_closed_fids, не моя фракция и не союзник по
-- федерации/конфедерации. Гость/без фракции → все, кто закрылся хоть от
-- кого-то (факт закрытия границ — публичное знание, адресаты — нет).
-- Союзы проверяем мягко: срезы diplo могут быть не применены (нет diplo_members).
create or replace function public.borders_blocked_fids()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare my_fid text; allies text[] := '{}'; res jsonb;
begin
  select faction_id into my_fid from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1;
  if my_fid is not null then
    begin
      select coalesce(array_agg(distinct m2.fid), '{}') into allies
        from public.diplo_members m1
        join public.diplo_members m2 on m2.union_id = m1.union_id
        where m1.fid = my_fid;
    exception when undefined_table then allies := '{}'; end;
  end if;
  select coalesce(jsonb_agg(faction_id), '[]'::jsonb) into res
    from public.faction_economy
    where faction_id is distinct from my_fid
      and not (faction_id = any(allies))
      and case when my_fid is null
            then jsonb_array_length(coalesce(borders_closed_fids, '[]'::jsonb)) > 0
            else coalesce(borders_closed_fids, '[]'::jsonb) ? my_fid
          end;
  return res;
end$$;
revoke all on function public.borders_blocked_fids() from public;
grant execute on function public.borders_blocked_fids() to authenticated, anon;

-- ── 3) Закрыта ли система p_sys для флотов фракции p_mover ──
-- true = граница закрыта: система принадлежит ЧУЖОЙ фракции, у которой
-- p_mover в borders_closed_fids, и p_mover ей не союзник. Диплом-союз
-- проверяем мягко: срезы союзов не применены (нет diplo_members) — без обхода.
create or replace function public._borders_blocked(p_mover text, p_sys text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare owner text; closed boolean; ally boolean := false;
begin
  select faction into owner from public.map_systems where id = p_sys;
  if owner is null or owner = p_mover or p_mover is null then return false; end if;
  select coalesce(borders_closed_fids, '[]'::jsonb) ? p_mover into closed
    from public.faction_economy where faction_id = owner;
  if not coalesce(closed, false) then return false; end if;
  begin
    select exists(
      select 1 from public.diplo_members m1
        join public.diplo_members m2 on m2.union_id = m1.union_id
      where m1.fid = p_mover and m2.fid = owner
    ) into ally;
  exception when undefined_table then ally := false; end;
  return not ally;
end$$;
revoke all on function public._borders_blocked(text,text) from public;

-- чистка черновых версий (если применялась ранняя редакция этого файла)
drop function if exists public._borders_route_blocked(text,text,text);
drop function if exists public._fleet_jumps(text,text,text);

-- ── 4a) Маршрут по гиперпутям: список систем или NULL, если пути нет ──
-- BFS с восстановлением пути. p_respect=true → закрытые для p_mover системы
-- НЕПРОХОДИМЫ (сама цель p_to проверяется отдельно вызывающим кодом);
-- p_respect=false → чистая топология трасс. НИКАКОГО евклидового фолбэка:
-- флоты летают ТОЛЬКО по гиперпутям.
create or replace function public._fleet_path(p_from text, p_to text, p_mover text, p_respect boolean)
returns text[] language plpgsql stable security definer set search_path=public as $$
declare
  frontier text[]; visited text[]; nextf text[]; h int := 0;
  prev jsonb := '{}'::jsonb; r record; path text[]; cur text;
begin
  if p_from is null or p_to is null or p_from = p_to then return null; end if;
  frontier := array[p_from]; visited := array[p_from];
  while array_length(frontier, 1) > 0 and h < 200 loop
    h := h + 1; nextf := '{}';
    for r in
      select distinct
             case when hl.a_id = any(frontier) then hl.b_id else hl.a_id end as nb,
             case when hl.a_id = any(frontier) then hl.a_id else hl.b_id end as via
      from public.map_hyperlanes hl
      where hl.a_id = any(frontier) or hl.b_id = any(frontier)
    loop
      if r.nb is null or r.nb = any(visited) then continue; end if;
      if p_respect and r.nb <> p_to and public._borders_blocked(p_mover, r.nb) then continue; end if;
      prev := prev || jsonb_build_object(r.nb, r.via);
      visited := visited || r.nb; nextf := nextf || r.nb;
      if r.nb = p_to then
        cur := p_to; path := array[p_to];
        while cur is distinct from p_from loop
          cur := prev->>cur; exit when cur is null;
          path := cur || path;
        end loop;
        return path;
      end if;
    end loop;
    if array_length(nextf, 1) is null then exit; end if;
    frontier := nextf;
  end loop;
  return null;  -- по трассам (в этом режиме) недостижимо
end$$;
revoke all on function public._fleet_path(text,text,text,boolean) from public;

-- ── 4б) Число прыжков по маршруту (обёртка над _fleet_path) ──
create or replace function public._fleet_bfs(p_from text, p_to text, p_mover text, p_respect boolean)
returns int language plpgsql stable security definer set search_path=public as $$
declare path text[];
begin
  if p_from is null or p_to is null then return null; end if;
  if p_from = p_to then return 0; end if;
  path := public._fleet_path(p_from, p_to, p_mover, p_respect);
  if path is null then return null; end if;
  return array_length(path, 1) - 1;
end$$;
revoke all on function public._fleet_bfs(text,text,text,boolean) from public;

-- ── 4в) _fleet_settle — НАДМНОЖЕСТВО _army_fleet.sql: стоп на границе ──
-- Долетевший transit-флот садится в пункте назначения, ТОЛЬКО если граница
-- всё ещё открыта. Если владелец закрыл границу, пока флот был в пути, полёт
-- завершается в БЛИЖАЙШЕЙ ОТКРЫТОЙ системе маршрута перед стеной:
--   1) маршрут в объезд текущих закрытых систем (respect=true) — все его
--      промежуточные системы открыты → встаём в последней перед целью;
--   2) объезда нет → маршрут по чистой топологии (respect=false), идём по
--      нему от старта и встаём перед первой закрытой системой;
--   3) пути нет вовсе (трассу удалили?) → остаёмся в точке вылета.
create or replace function public._fleet_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare fl record; path text[]; stop_sys text; i int;
begin
  for fl in select id, from_sys, dest_sys from public.fleets
            where faction_id=p_fid and status='transit' and arrive_at <= now()
  loop
    stop_sys := fl.dest_sys;
    if public._borders_blocked(p_fid, fl.dest_sys) then
      path := public._fleet_path(fl.from_sys, fl.dest_sys, p_fid, true);
      if path is null then
        path := public._fleet_path(fl.from_sys, fl.dest_sys, p_fid, false);
      end if;
      stop_sys := coalesce(fl.from_sys, fl.dest_sys);
      if path is not null then
        for i in 2..array_length(path, 1) loop
          exit when public._borders_blocked(p_fid, path[i]);
          stop_sys := path[i];
        end loop;
      end if;
    end if;
    update public.fleets
      set status='idle', system_id=stop_sys, from_sys=null, dest_sys=null,
          depart_at=null, arrive_at=null
      where id = fl.id;
  end loop;
end$$;
revoke all on function public._fleet_settle(text) from public;

-- ════════════════════════════════════════════════════════════
-- 5) fleet_send — НАДМНОЖЕСТВО _spy_fleet_ops.sql: + запрет прилёта в
-- систему за закрытой границей + маршрут в обход закрытых систем.
-- ════════════════════════════════════════════════════════════
create or replace function public.fleet_send(p_id uuid, p_dest_sys text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; fl public.fleets; fly_h numeric; jumps int; fuel jsonb; res jsonb;
  rk text; rneed numeric; rhave numeric; short text := '';
  owner_name text;
begin
  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  select * into fl from public.fleets where id=p_id;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;
  if fl.status <> 'idle' then raise exception 'флот уже в пути'; end if;
  if fl.stalled_until is not null and fl.stalled_until > now() then
    raise exception 'флот обездвижен диверсией ещё % ч', ceil(extract(epoch from (fl.stalled_until-now()))/3600.0);
  end if;
  if not exists(select 1 from public.map_systems where id=p_dest_sys) then raise exception 'no such system'; end if;
  if p_dest_sys = fl.system_id then raise exception 'флот уже там'; end if;

  -- закрытые границы: в чужую систему с закрытой границей прилёт запрещён
  if public._borders_blocked(fid, p_dest_sys) then
    select coalesce(mf.name, ms.faction) into owner_name
      from public.map_systems ms left join public.map_factions mf on mf.id = ms.faction
      where ms.id = p_dest_sys;
    raise exception 'границы закрыты: «%» не пускает флоты вашей фракции в свои системы', owner_name;
  end if;

  -- маршрут ТОЛЬКО по гиперпутям, в обход закрытых для нас систем.
  -- Обхода нет → различаем: стена закрытых границ или трасс вообще нет.
  jumps := public._fleet_bfs(fl.system_id, p_dest_sys, fid, true);
  if jumps is null then
    if public._fleet_bfs(fl.system_id, p_dest_sys, fid, false) is not null then
      raise exception 'путь перекрыт закрытыми границами: обходного маршрута к цели нет';
    end if;
    raise exception 'нет гиперпути к этой системе — флоты летают только по гиперпутям';
  end if;

  -- топливо: расход = состав × прыжки (маршрут — в обход закрытых границ)
  fuel  := public._fleet_fuel_for(fl.composition, jumps);

  select coalesce(resources,'{}'::jsonb) into res
    from public.faction_economy where faction_id=fid for update;
  if res is null then raise exception 'нет экономики фракции'; end if;

  for rk, rneed in select key, (value)::numeric from jsonb_each_text(fuel) loop
    if rneed is null or rneed <= 0 then continue; end if;
    rhave := coalesce((res->>rk)::numeric, 0);
    if rhave < rneed then short := short || rk || ' ' || round(rneed - rhave) || ', '; end if;
  end loop;
  if short <> '' then
    raise exception 'не хватает топлива на складе: %', rtrim(short, ', ');
  end if;

  for rk, rneed in select key, (value)::numeric from jsonb_each_text(fuel) loop
    if rneed is null or rneed <= 0 then continue; end if;
    res := jsonb_set(res, array[rk], to_jsonb(coalesce((res->>rk)::numeric,0) - rneed), true);
  end loop;
  update public.faction_economy set resources=res where faction_id=fid;

  fly_h := coalesce(public._fleet_fly_hours(fl.system_id, p_dest_sys), 2.0);
  update public.fleets
    set status='transit', from_sys=system_id, dest_sys=p_dest_sys, system_id=null,
        depart_at=now(), arrive_at=now() + (fly_h || ' hours')::interval
    where id=p_id;
  return jsonb_build_object('ok', true, 'fly_h', round(fly_h,1), 'jumps', jumps, 'fuel', fuel,
    'arrive_at', now() + (fly_h || ' hours')::interval);
end$$;
revoke all on function public.fleet_send(uuid,text) from public;
grant execute on function public.fleet_send(uuid,text) to authenticated;
