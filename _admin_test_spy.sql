-- ============================================================
-- АДМИН · ТЕСТ ШПИОНАЖА (консоль управления → вкладка «🧪 Тест»)
-- Применять в Supabase → SQL Editor ПОСЛЕ _spy_new_ops.sql (и всех слайсов
-- шпионажа/веры, на которых стоит spy_launch / _spy_resolve). Идемпотентно.
--
-- Назначение: выдать ВЫБРАННОЙ фракции разведку (базовую/глубокую) ИЛИ
-- провести любую другую операцию ПРОТИВ другой фракции — мгновенно, для
-- тестирования, не дожидаясь суточного тика и без требований по интелу/агентам.
--
-- Механика: вставляем «операцию» в spy_missions с success_pct=100, detect_pct=0
-- (гарантированный успех, без раскрытия — реальных агентов не теряем) и зовём
-- ЖИВУЮ _spy_resolve(actor). Эффекты (срез интела для recon, кража/снос/…)
-- считаются теми же серверными функциями — баланс не дублируется.
-- SECURITY DEFINER, доступ только стаффу (superadmin/editor).
-- ============================================================

create or replace function public.admin_test_spy_op(
    p_actor_fid text,
    p_target_fid text,
    p_op text,
    p_agents int default 2)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_meta jsonb;
  v_actor_owner uuid;
  v_target_owner uuid;
  v_a int;
  v_id uuid;
  v_out text;
  v_res jsonb;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  if p_actor_fid is null or p_target_fid is null then
    raise exception 'actor and target required';
  end if;
  if p_actor_fid = p_target_fid then
    raise exception 'actor and target must differ';
  end if;

  v_meta := public._spy_op_meta(p_op);
  if v_meta is null then raise exception 'bad op: %', p_op; end if;

  select owner_id into v_actor_owner  from public.faction_economy where faction_id = p_actor_fid;
  select owner_id into v_target_owner from public.faction_economy where faction_id = p_target_fid;
  if not found then raise exception 'target has no economy'; end if;

  v_a := greatest(1, coalesce(p_agents, 1));

  -- Вставляем гарантированно-успешную, нераскрытую операцию.
  -- agent_ids пуст → реальные агенты не задействуются и не теряются при провале.
  insert into public.spy_missions(
      actor_fid, actor_owner, target_fid, target_owner, target_name,
      op, mtype, agents, agent_ids, target_colony,
      success_pct, detect_pct, status, started_at, ready_at, params)
    values(
      p_actor_fid, v_actor_owner, p_target_fid, v_target_owner, public._fac_name(p_target_fid),
      p_op, p_op, v_a, '[]'::jsonb, null,
      100, 0, 'active', now(), now(), '{}'::jsonb)
    returning id into v_id;

  -- Резолвим живой серверной функцией (тот же расчёт эффектов, что и на тике).
  perform public._spy_resolve(p_actor_fid);

  select outcome, result into v_out, v_res from public.spy_missions where id = v_id;

  return jsonb_build_object(
    'ok', true,
    'mission_id', v_id,
    'op', p_op,
    'outcome', coalesce(v_out, 'unknown'),
    'result', coalesce(v_res, '{}'::jsonb));
end$$;
revoke all on function public.admin_test_spy_op(text, text, text, int) from public;
grant execute on function public.admin_test_spy_op(text, text, text, int) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- select public.admin_test_spy_op('<actor>','<target>','recon_basic');  -- базовая разведка
-- select public.admin_test_spy_op('<actor>','<target>','recon_deep');   -- глубокая разведка
-- select public.admin_test_spy_op('<actor>','<target>','steal_res', 3); -- кража ресурсов (3 «агента»)
