-- ============================================================
-- ЭТАП 2g — ГОНКА ВОЗВРАТОВ (double-refund через параллельные вызовы)
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Дыра: функции возврата делали SELECT → начисление → DELETE. При параллельных
--   вызовах на ОДИН id несколько прочитают строку до удаления → возврат
--   начислится несколько раз = деньги/агенты из воздуха. Эксплойт:
--     ps.forEach(p => ecCancelProject(p.id))   // или повтор одного id без await
--
-- Фикс: DELETE ... RETURNING как атомарный гейт. Только тот вызов, что РЕАЛЬНО
--   удалил строку, начисляет возврат; параллельные дубли удаляют 0 строк (not found).
-- Логика сумм возврата не меняется.
-- ============================================================

-- ── Отмена проекта колонии ──────────────────────────────────
create or replace function public.economy_cancel_project(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; pl jsonb; rg numeric; rs numeric;
begin
  fid := public._ec_my_fid();
  delete from public.colony_projects
    where id = p_project_id and faction_id = fid
    returning payload into pl;
  if not found then raise exception 'project not found or already cancelled'; end if;
  rg := coalesce((pl->>'spent_gc')::numeric, 0);
  rs := coalesce((pl->>'spent_science')::numeric, 0);
  if rg <> 0 or rs <> 0 then
    update public.faction_economy set gc = gc + rg, science = science + rs where faction_id = fid;
  end if;
  return jsonb_build_object('ok', true, 'refund_gc', rg, 'refund_science', rs);
end$$;
revoke all on function public.economy_cancel_project(uuid) from public;
grant execute on function public.economy_cancel_project(uuid) to authenticated;

-- ── Отмена производства ─────────────────────────────────────
create or replace function public.economy_cancel_production(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_unit uuid; v_qty int; refund numeric := 0;
begin
  fid := public._ec_my_fid();
  delete from public.unit_production
    where id = p_id and faction_id = fid and status = 'queued'
    returning unit_id, qty into v_unit, v_qty;
  if not found then raise exception 'production not found or already delivered'; end if;
  select coalesce((u.summary->>'cost')::numeric, 0) * coalesce(v_qty,0) into refund
    from public.faction_units u where u.id = v_unit;
  refund := coalesce(refund, 0);
  if refund <> 0 then
    update public.faction_economy set gc = gc + refund where faction_id = fid;
  end if;
  return jsonb_build_object('ok', true, 'refund', refund);
end$$;
revoke all on function public.economy_cancel_production(uuid) from public;
grant execute on function public.economy_cancel_production(uuid) to authenticated;

-- ── Снос здания (возврат вложенного) ────────────────────────
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

  -- незавершённые слот-проекты этого здания: удаляем атомарно, суммируем их возврат
  with del as (
    delete from public.colony_projects
      where kind = 'slot' and building_id = p_building_id and faction_id = fid
      returning payload
  )
  select coalesce(sum(coalesce((payload->>'spent_gc')::numeric, 0)), 0) into v_slot_refund from del;
  refund := refund + coalesce(v_slot_refund, 0);

  if refund <> 0 then
    update public.faction_economy set gc = gc + refund where faction_id = fid;
  end if;
  return jsonb_build_object('ok', true, 'refund', refund);
end$$;
revoke all on function public.economy_demolish(uuid) from public;
grant execute on function public.economy_demolish(uuid) to authenticated;

-- ── Отзыв тайной операции (возврат агентов) — та же гонка ────
create or replace function public.spy_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_agents int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  delete from public.spy_missions
    where id = p_id and actor_owner = auth.uid() and status = 'active'
    returning actor_fid, agents into v_fid, v_agents;
  if not found then raise exception 'not found or already resolved'; end if;
  update public.faction_economy set agents = agents + coalesce(v_agents,0) where faction_id = v_fid;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.spy_cancel(uuid) from public;
grant execute on function public.spy_cancel(uuid) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- Параллельная отмена одного проекта (без await) должна начислить возврат
-- ровно ОДИН раз; остальные вызовы — ошибка 'already cancelled'.
--   const id='<project id>';
--   Promise.all([1,2,3,4,5].map(()=>ecRpc('economy_cancel_project',{p_project_id:id})))
--     .then(r=>console.log('ok',r)).catch(e=>console.log('часть отбита:',e.message))
-- Баланс ГС должен вырасти на ОДИН возврат, не на пять.
