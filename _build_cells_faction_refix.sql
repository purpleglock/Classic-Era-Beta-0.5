-- ─────────────────────────────────────────────────────────────
-- РЕГРЕСС: economy_build(uuid,text,uuid) из _science_special_buildings.sql
-- снова считает занятые ячейки БЕЗ фильтра по фракции — фантомы прошлого
-- владельца (захват/передача планеты) опять блокируют застройку
-- («no free cells» на планете со свободными ячейками).
-- Возвращаем фильтр faction_id (правка _colony_cells_faction_fix.sql),
-- остальное тело — как в _science_special_buildings.sql. Идемпотентно.
-- ─────────────────────────────────────────────────────────────
create or replace function public.economy_build(p_colony_id uuid, p_btype text, p_faith_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies; base numeric; cost numeric;
  used int; pending int;
begin
  fid := public._ec_my_fid();
  if public._ec_bld_base(p_btype) is null then raise exception 'bad btype'; end if;
  -- МУЛЬТИ: храм можно строить только исповедуя веру; метка = выбранная вера
  if p_btype = 'temple' then
    if not exists(select 1 from public.faith_membership where faction_id = fid) then
      raise exception 'no faith: found or join a faith before building a temple';
    end if;
    if p_faith_id is null then
      select faith_id into p_faith_id from public.faith_membership
        where faction_id = fid order by (role = 'founder') desc, joined_at asc limit 1;
    elsif not public._faith_member(fid, p_faith_id) then
      raise exception 'you do not follow that faith';
    end if;
  else
    p_faith_id := null;
  end if;
  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if col.faction_id is distinct from fid then raise exception 'not your colony'; end if;

  -- ДОМИК: Центр благополучия — гейт технологией + лимит 1/система, 5/держава.
  if p_btype = 'wellhub' then
    if not (select coalesce(research, '[]'::jsonb) ? 'pol.welfare_hub'
            from public.faction_economy where faction_id = fid) then
      raise exception 'нужна технология «Центр благополучия»';
    end if;
    if (select count(*) from public.colony_buildings cb
          join public.colonies c on c.id = cb.colony_id
          where c.faction_id = fid and c.system_id is not distinct from col.system_id and cb.btype = 'wellhub')
     + (select count(*) from public.colony_projects pr
          join public.colonies c on c.id = pr.colony_id
          where pr.kind = 'build' and pr.btype = 'wellhub'
            and c.faction_id = fid and c.system_id is not distinct from col.system_id) >= 1 then
      raise exception 'В этой системе уже есть Центр благополучия (лимит 1 на систему)';
    end if;
    if (select count(*) from public.colony_buildings where faction_id = fid and btype = 'wellhub')
     + (select count(*) from public.colony_projects where faction_id = fid and kind = 'build' and btype = 'wellhub') >= 5 then
      raise exception 'Достигнут лимит Центров благополучия в державе (5)';
    end if;
  end if;

  -- ГИГАНТСКАЯ ОБСЕРВАТОРИЯ: только на станции над газовым/ледяным/горячим гигантом.
  if p_btype = 'sci_giant' and col.planet_type not in ('Газовые гиганты', 'Ледяные гиганты', 'Горячие гиганты') then
    raise exception 'Гигантская обсерватория строится только на станции над гигантом';
  end if;

  -- ИНСТИТУТ АНОМАЛИЙ: только на станции внутри аномалии.
  if p_btype = 'sci_anomaly' and col.planet_type is distinct from 'Аномалии' then
    raise exception 'Институт аномалий строится только на станции внутри аномалии';
  end if;

  -- свободные ячейки: ТОЛЬКО строки текущей фракции (см. _colony_cells_faction_fix.sql)
  select count(*) into used    from public.colony_buildings
    where colony_id = p_colony_id and faction_id = fid;
  select count(*) into pending from public.colony_projects
    where colony_id = p_colony_id and kind = 'build' and faction_id = fid;
  if used + pending >= coalesce(col.cells, 6) then raise exception 'no free cells'; end if;

  base := public._ec_bld_base(p_btype);
  cost := public._ec_build_cost(fid, base);

  update public.faction_economy set gc = gc - cost
    where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects
    (faction_id, owner_id, kind, btype, colony_id, payload, label, ready_at)
  values
    (fid, auth.uid(), 'build', p_btype, p_colony_id,
     jsonb_build_object('spent_gc', cost, 'spent_science', 0, 'btype', p_btype,
                        'free_slots', public._ec_bld_free(p_btype),
                        'faith_id', p_faith_id),
     'Постройка', now() + interval '1 day');

  return jsonb_build_object('ok', true, 'cost', cost);
end$$;
revoke all on function public.economy_build(uuid, text, uuid) from public;
grant execute on function public.economy_build(uuid, text, uuid) to authenticated;

-- Разовая зачистка осиротевших строк на переданных планетах.
delete from public.colony_buildings b using public.colonies c
 where b.colony_id = c.id and b.faction_id is distinct from c.faction_id;
delete from public.colony_projects p using public.colonies c
 where p.kind = 'build' and p.colony_id = c.id and p.faction_id is distinct from c.faction_id;
