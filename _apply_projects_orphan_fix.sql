-- ─────────────────────────────────────────────────────────────
-- ФИКС: тик экономики падал с FK-ошибкой colony_buildings_colony_id_fkey
--   {"code":"23503", ... Key (colony_id)=(…) is not present in table "colonies"}
-- Причина: завершённый проект build в colony_projects ссылался на колонию,
-- которой уже нет (снесена/потеряна/захвачена). _apply_colony_projects вставлял
-- здание по мёртвому colony_id → нарушение внешнего ключа → весь economy_tick
-- откатывался → «Не удалось загрузить экономику».
--
-- Применять в Supabase SQL Editor одним куском. Идемпотентно.
-- (Соответствует правке в _economy_setup.sql — ветка kind='build'.)
-- ─────────────────────────────────────────────────────────────

create or replace function public._apply_colony_projects(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare pr record;
begin
  for pr in select * from public.colony_projects
            where faction_id = p_fid and ready_at <= now()
            order by ready_at asc
  loop
    if pr.kind = 'build' then
      -- колония могла исчезнуть, пока проект ждал завершения (снос/потеря/захват).
      -- Без этой проверки insert ломает FK colony_buildings_colony_id_fkey и валит весь тик.
      -- Стале-проект просто пропускаем — он удалится ниже как обычно.
      if exists (select 1 from public.colonies c
                 where c.id = pr.colony_id and c.faction_id = p_fid) then
        insert into public.colony_buildings (colony_id, faction_id, owner_id, btype, slots_open, tnp_mode)
          values (pr.colony_id, p_fid, pr.owner_id, pr.btype,
                  coalesce((pr.payload->>'free_slots')::int, 1), false);
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
end$$;
revoke all on function public._apply_colony_projects(text) from public;

-- Немедленная зачистка уже зависших осиротевших build-проектов,
-- чтобы тик прошёл сразу, не дожидаясь самолечения на следующем ходу.
delete from public.colony_projects cp
where cp.kind = 'build'
  and not exists (
    select 1 from public.colonies c
    where c.id = cp.colony_id and c.faction_id = cp.faction_id
  );
