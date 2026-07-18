-- ============================================================
-- ВОЙНА, СРЕЗ 2: ГРАНИЦЫ ВОЙНЫ + ОККУПАЦИЯ СИСТЕМ
--
-- 1) Объявленная война СНИМАЕТ пограничный запрет — но только между
--    воюющими сторонами. Чужие закрытые границы, к которым ты не имеешь
--    отношения, продолжают действовать.
-- 2) Флот, севший во вражеской системе, ОККУПИРУЕТ её (флаг оккупанта
--    на карте). Оккупация спадает, когда через систему проходит флот
--    обороняющейся стороны.
--
-- Применять в Supabase → SQL Editor ПОСЛЕ (порядок важен, клоббер!):
--   _army_fleet.sql → _fleet_ops.sql → _fleet_intel.sql →
--   _spy_fleet_ops.sql → _borders_closed.sql → _war_declare.sql → ЭТОТ ФАЙЛ.
--
-- ГЛАВНОЕ АРХИТЕКТУРНОЕ РЕШЕНИЕ: весь пограничный контроль сходится в
-- ОДНУ функцию _borders_blocked() — её зовут _fleet_path, _fleet_bfs,
-- _fleet_settle и fleet_send. Поэтому война снимает запрет правкой
-- ровно этой функции, и все четыре потребителя получают новое поведение
-- сами. fleet_send здесь НЕ переписан — и не надо его переписывать в
-- следующих срезах без крайней нужды (он уже пережил три клоббера).
--
-- Зеркало клиента: galaxy_map.js — слой карты «Оккупация» (gmToggleOccup).
-- ?v=20260718war2
-- ============================================================

-- ── 1) Таблица оккупаций ─────────────────────────────────────
-- Одна строка = одна оккупированная система. owner_fid фиксируем на
-- момент захвата: если система потом сменит владельца, мы всё ещё знаем,
-- у кого её отняли.
create table if not exists public.system_occupation (
  system_id     text primary key references public.map_systems(id) on delete cascade,
  occupier_fid  text not null,
  owner_fid     text not null,
  fleet_id      uuid,
  since         timestamptz not null default now(),
  constraint sysocc_sides_differ check (occupier_fid <> owner_fid)
);
create index if not exists sysocc_occ_idx on public.system_occupation (occupier_fid);
create index if not exists sysocc_own_idx on public.system_occupation (owner_fid);

alter table public.system_occupation enable row level security;
-- Оккупация публична: флаг над системой видит весь сектор, это её смысл.
drop policy if exists sysocc_read on public.system_occupation;
create policy sysocc_read on public.system_occupation for select to authenticated using (true);
revoke insert, update, delete on public.system_occupation from anon, authenticated;

-- ── 2) _borders_blocked — НАДМНОЖЕСТВО _borders_closed.sql ───
-- Добавлено РОВНО одно правило: если владелец системы и летящий состоят
-- в активной войне по разные стороны (public.at_war из _war_declare.sql),
-- граница для него больше не преграда — война отменяет пограничный режим.
-- Всё остальное поведение сохранено дословно.
--
-- at_war зовём мягко: если срез 1 не накачен (нет функции), молча
-- считаем, что войны нет, и работаем как раньше.
create or replace function public._borders_blocked(p_mover text, p_sys text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare owner text; closed boolean; ally boolean := false; war boolean := false;
begin
  select faction into owner from public.map_systems where id = p_sys;
  if owner is null or owner = p_mover or p_mover is null then return false; end if;
  select coalesce(borders_closed_fids, '[]'::jsonb) ? p_mover into closed
    from public.faction_economy where faction_id = owner;
  if not coalesce(closed, false) then return false; end if;

  -- ВОЙНА СНИМАЕТ ГРАНИЦУ: врагу закрытая граница не помеха.
  begin
    select public.at_war(p_mover, owner) into war;
  exception when undefined_function then war := false; end;
  if coalesce(war, false) then return false; end if;

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

-- ── 2б) borders_blocked_fids — тот же принцип для слоя карты ──
-- Из штриховки «закрытые границы» убираем тех, с кем мы воюем: их стены
-- для нас больше не существуют, и рисовать их — врать игроку.
create or replace function public.borders_blocked_fids()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare my_fid text; allies text[] := '{}'; enemies text[] := '{}'; res jsonb;
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
    begin
      select coalesce(array_agg(e), '{}') into enemies
        from public.war_enemies_of(my_fid) e;
    exception when undefined_function or undefined_table then enemies := '{}'; end;
  end if;
  select coalesce(jsonb_agg(faction_id), '[]'::jsonb) into res
    from public.faction_economy
    where faction_id is distinct from my_fid
      and not (faction_id = any(allies))
      and not (faction_id = any(enemies))
      and case when my_fid is null
            then jsonb_array_length(coalesce(borders_closed_fids, '[]'::jsonb)) > 0
            else coalesce(borders_closed_fids, '[]'::jsonb) ? my_fid
          end;
  return res;
end$$;
revoke all on function public.borders_blocked_fids() from public;
grant execute on function public.borders_blocked_fids() to authenticated, anon;

-- ── 3) Оккупация: реакция на приземление флота ───────────────
-- Зовётся из _fleet_settle для КАЖДОГО севшего флота.
--   • сел враг владельца        → система оккупирована (или сменила оккупанта);
--   • сел владелец или его союзник по войне → оккупация снята (деоккупация).
-- Обороняющаяся сторона = владелец системы + все, кто воюет ПРОТИВ
-- оккупанта на стороне владельца. Именно поэтому спрашиваем at_war, а не
-- сравниваем fid напрямую: союзник по коалиции тоже освобождает.
create or replace function public._war_occupy_check(p_fid text, p_sys text, p_fleet uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare owner text; occ record; hostile boolean := false;
begin
  if p_fid is null or p_sys is null then return; end if;
  select faction into owner from public.map_systems where id = p_sys;
  if owner is null then return; end if;   -- ничейная система не оккупируется

  select * into occ from public.system_occupation where system_id = p_sys;

  -- Пришёл освободитель: владелец лично либо тот, кто воюет с оккупантом
  -- и НЕ воюет с владельцем (то есть на стороне обороны).
  if occ.system_id is not null then
    if p_fid = occ.owner_fid or p_fid = owner then
      delete from public.system_occupation where system_id = p_sys;
      perform public._war_occ_news(p_sys, p_fid, occ.occupier_fid, false);
      return;
    end if;
    begin
      select public.at_war(p_fid, occ.occupier_fid) and not public.at_war(p_fid, occ.owner_fid)
        into hostile;
    exception when undefined_function then hostile := false; end;
    if coalesce(hostile, false) then
      delete from public.system_occupation where system_id = p_sys;
      perform public._war_occ_news(p_sys, p_fid, occ.occupier_fid, false);
      return;
    end if;
  end if;

  -- Пришёл враг владельца → оккупация.
  if p_fid = owner then return; end if;
  begin
    select public.at_war(p_fid, owner) into hostile;
  exception when undefined_function then hostile := false; end;
  if not coalesce(hostile, false) then return; end if;
  if occ.system_id is not null and occ.occupier_fid = p_fid then return; end if;  -- уже наша

  insert into public.system_occupation(system_id, occupier_fid, owner_fid, fleet_id)
    values (p_sys, p_fid, owner, p_fleet)
    on conflict (system_id) do update
      set occupier_fid = excluded.occupier_fid,
          owner_fid    = excluded.owner_fid,
          fleet_id     = excluded.fleet_id,
          since        = now();
  perform public._war_occ_news(p_sys, p_fid, owner, true);
end$$;
revoke all on function public._war_occupy_check(text,text,uuid) from public;

-- Хроника оккупации. Не валит военный акт, если лента недоступна.
create or replace function public._war_occ_news(p_sys text, p_actor text, p_other text, p_taken boolean)
returns void language plpgsql security definer set search_path=public as $$
declare sysname text; a text; b text;
begin
  begin
    select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = p_sys;
    a := public._war_nm(p_actor); b := public._war_nm(p_other);
    if p_taken then
      perform public._war_news(
        '⚑ Оккупация: ' || sysname,
        public._news_pick(array[
          format('Флот %s занимает систему %s. Над орбитой поднят чужой флаг — держава %s теряет контроль.', a, sysname, b),
          format('%s под оккупацией: корабли %s встали на якорь, и власть %s здесь больше ничего не решает.', sysname, a, b),
          format('%s берёт систему %s под свою руку. %s остаётся только вернуться сюда с флотом.', a, sysname, b)
        ]),
        jsonb_build_array(p_actor, p_other));
    else
      perform public._war_news(
        '🎌 Освобождение: ' || sysname,
        public._news_pick(array[
          format('Флот %s возвращается в систему %s — оккупация %s снята.', a, sysname, b),
          format('%s снова свободна: корабли %s прошли по орбите, и флаг оккупанта %s спущен.', sysname, a, b),
          format('%s выбивает %s из системы %s. Контроль восстановлен.', a, b, sysname)
        ]),
        jsonb_build_array(p_actor, p_other));
    end if;
  exception when others then null;
  end;
end$$;
revoke all on function public._war_occ_news(text,text,text,boolean) from public;

-- ── 4) _fleet_settle — НАДМНОЖЕСТВО _borders_closed.sql ──────
-- Дословно сохранена логика стопа на закрытой границе; добавлен ровно
-- один вызов _war_occupy_check после посадки флота.
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
    -- НОВОЕ: флот сел — проверяем оккупацию/деоккупацию этой системы.
    perform public._war_occupy_check(p_fid, stop_sys, fl.id);
  end loop;
end$$;
revoke all on function public._fleet_settle(text) from public;

-- ── 5) Слой карты: кто что оккупировал ───────────────────────
-- Volatile, потому что попутно чистит протухшие оккупации: война кончилась
-- → флаги сами спадают, отдельного крона не нужно. Обычно удаляет 0 строк.
create or replace function public.occupations_all()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
begin
  begin
    delete from public.system_occupation o
     where not public.at_war(o.occupier_fid, o.owner_fid);
  exception when undefined_function then null; end;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'system_id', o.system_id,
      'occupier', o.occupier_fid,
      'occupier_name', public._war_nm(o.occupier_fid),
      'occupier_color', (select mf.color from public.map_factions mf where mf.id = o.occupier_fid),
      'owner', o.owner_fid,
      'owner_name', public._war_nm(o.owner_fid),
      'since', o.since) order by o.since desc)
    from public.system_occupation o), '[]'::jsonb);
end$$;
revoke all on function public.occupations_all() from public;
grant execute on function public.occupations_all() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- 1) Б закрыл границы для А; war_declare А→Б → fleet_send А в систему Б
--    ПРОХОДИТ (раньше «границы закрыты»). Границы третьей державы, с
--    которой войны нет, по-прежнему держат.
-- 2) Флот А сел в системе Б → строка в system_occupation + «⚑ Оккупация»
--    в ленте; occupations_all() отдаёт флаг с цветом А.
-- 3) Флот Б пришёл в свою оккупированную систему → строка удалена,
--    «🎌 Освобождение» в ленте.
-- 4) Мир (war_offer_respond accept) → следующий occupations_all() сам
--    вычищает флаги: at_war стал false.
