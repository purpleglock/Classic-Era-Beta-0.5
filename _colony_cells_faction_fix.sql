-- ─────────────────────────────────────────────────────────────
-- ФИКС: «ОШИБКА: no free cells» на планетах, которые РАНЬШЕ были
-- чужими колониями. Планета показывает свободные ячейки (⬚ 2/3),
-- но постройка отбивается сервером.
--
-- Причина: economy_build считал занятые ячейки по colony_id БЕЗ
-- фильтра по фракции — в счёт шли осиротевшие colony_buildings и
-- незавершённые colony_projects(kind='build') ПРОШЛОГО владельца
-- (со старым faction_id). Клиент их не видит (RLS отдаёт только свои),
-- поэтому показывал меньше, а сервер — больше → мнимая «нет ячеек».
--
-- Правка: used/pending считаем только по faction_id текущего игрока
-- + разово чистим осиротевшие строки на всех переданных планетах.
--
-- Идемпотентно. Выполнить целиком в Supabase → SQL Editor.
-- (Соответствует правке в _security_money.sql — economy_build.)
-- ─────────────────────────────────────────────────────────────

create or replace function public.economy_build(p_colony_id uuid, p_btype text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies; base numeric; cost numeric;
  used int; pending int;
begin
  fid := public._ec_my_fid();
  if public._ec_bld_base(p_btype) is null then raise exception 'bad btype'; end if;
  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if col.faction_id is distinct from fid then raise exception 'not your colony'; end if;

  -- свободные ячейки: считаем ТОЛЬКО строки текущей фракции, иначе
  -- фантомы прошлого владельца (при захвате/передаче планеты) блокируют застройку.
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
                        'free_slots', public._ec_bld_free(p_btype)),
     'Постройка', now() + interval '1 day');

  return jsonb_build_object('ok', true, 'cost', cost);
end$$;
revoke all on function public.economy_build(uuid, text) from public;
grant execute on function public.economy_build(uuid, text) to authenticated;

-- ── Разовая зачистка осиротевших строк на переданных планетах ──
-- Здания и стройки, чей faction_id не совпадает с текущим владельцем колонии.
delete from public.colony_buildings b
using public.colonies c
where b.colony_id = c.id
  and b.faction_id is distinct from c.faction_id;

delete from public.colony_projects p
using public.colonies c
where p.kind = 'build'
  and p.colony_id = c.id
  and p.faction_id is distinct from c.faction_id;
