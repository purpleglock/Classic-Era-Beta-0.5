-- ════════════════════════════════════════════════════════════════════
-- 26.08 — «не входит в кабинет»: тик экономики падал на
--   colony_buildings_colony_id_fkey (23503).
--
-- Что было: планеты державы разбомбили МЗА, колонии удалены. Их
-- недостроенные build-проекты остались висеть в colony_projects (FK на
-- colonies там ОТСУТСТВОВАЛ вовсе — файл _colony_projects_fk_cascade.sql
-- так и не накатали). Тик доводил проект до конца и вставлял здание по
-- мёртвому colony_id → откат всей транзакции → кабинет не грузится.
--
-- Guard из _apply_projects_orphan_fix.sql был затёрт более поздними
-- пересозданиями функции (_faith_multi → _interstellar_artillery).
-- Поэтому чиним ДВАЖДЫ: схемой (FK cascade) и в теле функции.
-- Идемпотентно.
-- ════════════════════════════════════════════════════════════════════

-- 1) Снести уже зависших сирот (иначе ADD CONSTRAINT не пройдёт).
delete from public.colony_projects cp
where cp.colony_id is not null
  and not exists (select 1 from public.colonies c where c.id = cp.colony_id);

delete from public.colony_buildings cb
where not exists (select 1 from public.colonies c where c.id = cb.colony_id);

-- 2) ПРИЧИНА: FK с каскадом. Удаление колонии само сносит её проекты.
alter table public.colony_projects
  drop constraint if exists colony_projects_colony_id_fkey;
alter table public.colony_projects
  add constraint colony_projects_colony_id_fkey
  foreign key (colony_id) references public.colonies(id) on delete cascade;

-- 3) Пояс поверх подтяжек: живая версия функции (база — _interstellar_artillery,
--    т.е. faith_id + хук _doom_resolve) с возвращённой проверкой колонии.
create or replace function public._apply_colony_projects(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare pr record;
begin
  for pr in select * from public.colony_projects
            where faction_id = p_fid and ready_at <= now()
            order by ready_at asc
  loop
    if pr.kind = 'build' then
      -- колония могла исчезнуть, пока проект ждал (снос/потеря/захват/бомбардировка).
      -- Без проверки insert ломает FK colony_buildings_colony_id_fkey и валит весь тик.
      if exists (select 1 from public.colonies c
                 where c.id = pr.colony_id and c.faction_id = p_fid) then
        insert into public.colony_buildings (colony_id, faction_id, owner_id, btype, slots_open, tnp_mode, faith_id)
          values (pr.colony_id, p_fid, pr.owner_id, pr.btype,
                  coalesce((pr.payload->>'free_slots')::int, 1), false,
                  nullif(pr.payload->>'faith_id','')::uuid);     -- МУЛЬТИ: метка веры храма
      end if;
    elsif pr.kind = 'slot' then
      update public.colony_buildings set slots_open = least(6, slots_open + 1)
        where id = pr.building_id and faction_id = p_fid;
    elsif pr.kind = 'habitat' then
      update public.colonies set cells = cells + coalesce(pr.cells, 3), terraformed = true
        where id = pr.colony_id and faction_id = p_fid;
    elsif pr.kind = 'terraform' then
      if not exists (select 1 from public.colonies c
                     where c.faction_id = p_fid
                       and c.system_id is not distinct from pr.system_id
                       and (case when pr.planet_pid is not null
                                 then c.planet_pid = pr.planet_pid
                                 else c.planet_name = pr.planet_name end)) then
        insert into public.colonies (faction_id, owner_id, system_id, planet_name, planet_pid, planet_type, cells, terraformed, resources)
          values (p_fid, pr.owner_id, pr.system_id, pr.planet_name, pr.planet_pid, pr.planet_type,
                  coalesce(nullif(pr.cells, 0), 6), true, coalesce(pr.payload->'resources', '[]'::jsonb));
      end if;
    end if;
    delete from public.colony_projects where id = pr.id;
  end loop;

  -- DOOM: приземление залпов в полёте.
  perform public._doom_resolve(p_fid);
end$$;
revoke all on function public._apply_colony_projects(text) from public;
