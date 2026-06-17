-- ============================================================
-- СНОС И ОТМЕНА СТРОЙКИ — ВОЗВРАТ ПОЛОВИНЫ ЦЕНЫ
-- За снос готового здания или отмену постройки/апгрейда слота
-- возвращается ½ вложенной стоимости (база + платные слоты).
-- Habitat-проекты (колонизация среды) остаются без изменений — 100%.
-- Применять в Supabase → SQL Editor. Идемпотентно.
-- ============================================================

-- ── Отмена проекта колонии ──────────────────────────────────
create or replace function public.economy_cancel_project(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_kind text; pl jsonb; rg numeric; rs numeric;
begin
  fid := public._ec_my_fid();
  delete from public.colony_projects
    where id = p_project_id and faction_id = fid
    returning kind, payload into v_kind, pl;
  if not found then raise exception 'project not found or already cancelled'; end if;
  rg := coalesce((pl->>'spent_gc')::numeric, 0);
  rs := coalesce((pl->>'spent_science')::numeric, 0);
  -- постройка здания или апгрейд слота: возвращаем ½
  if v_kind in ('build', 'slot') then
    rg := floor(rg / 2);
    rs := floor(rs / 2);
  end if;
  if rg <> 0 or rs <> 0 then
    update public.faction_economy set gc = gc + rg, science = science + rs where faction_id = fid;
  end if;
  return jsonb_build_object('ok', true, 'refund_gc', rg, 'refund_science', rs);
end$$;
revoke all on function public.economy_cancel_project(uuid) from public;
grant execute on function public.economy_cancel_project(uuid) to authenticated;

-- ── Снос здания (возврат половины вложенного) ────────────────
create or replace function public.economy_demolish(p_building_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_btype text; v_slots int; refund numeric := 0; i int; free_n int; v_slot_refund numeric;
begin
  fid := public._ec_my_fid();
  -- атомарно удаляем СВОЁ здание; параллельные вызовы — только один удалит
  delete from public.colony_buildings
    where id = p_building_id and faction_id = fid
    returning btype, slots_open into v_btype, v_slots;
  if not found then raise exception 'building not found or already demolished'; end if;

  refund := public._ec_build_cost(fid, public._ec_bld_base(v_btype));
  free_n := public._ec_bld_free(v_btype);
  if coalesce(v_slots,0) > free_n then
    for i in free_n .. (v_slots - 1) loop
      refund := refund + public._ec_build_cost(fid, public._ec_bld_ladder(v_btype, i));
    end loop;
  end if;

  -- незавершённые слот-проекты этого здания: удаляем атомарно, суммируем затраты
  with del as (
    delete from public.colony_projects
      where kind = 'slot' and building_id = p_building_id and faction_id = fid
      returning payload
  )
  select coalesce(sum(coalesce((payload->>'spent_gc')::numeric, 0)), 0) into v_slot_refund from del;
  refund := refund + coalesce(v_slot_refund, 0);

  -- возвращаем ½ от всего вложенного
  refund := floor(refund / 2);

  if refund <> 0 then
    update public.faction_economy set gc = gc + refund where faction_id = fid;
  end if;
  return jsonb_build_object('ok', true, 'refund', refund);
end$$;
revoke all on function public.economy_demolish(uuid) from public;
grant execute on function public.economy_demolish(uuid) to authenticated;
