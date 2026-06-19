-- ============================================================
-- АДМИН · ТЕСТОВЫЕ ИНСТРУМЕНТЫ (консоль управления → вкладка «🧪 Тест»)
-- Применять в Supabase → SQL Editor ПОСЛЕ всех слайсов рейдов/шпионажа/веры
-- (_raid_balance.sql, _spy_agents5.sql, _faith_sect.sql). Идемпотентно.
--
-- Назначение: ускорять игровые таймеры и резолвить отложенные действия
-- НЕМЕДЛЕННО для тестирования механик, не дожидаясь суточного тика.
-- Всё через SECURITY DEFINER (таблицы под строгим RLS), доступ только
-- стаффу (superadmin/editor). Резолв переиспользует живые серверные функции
-- (_raid_resolve / _spy_resolve / economy_accrue) — баланс не дублируется.
-- ============================================================

-- ── Завершить рейды немедленно ──────────────────────────────
-- Все активные рейды фракции (как атакующего И как цели) получают ready_at=now
-- и резолвятся живой _raid_resolve (бой/добыча/потери/детект — как на тике).
create or replace function public.admin_test_speed_raids(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n_att int; n_def int; r record;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  -- фракция-АТАКУЮЩИЙ: резолвятся на её собственном тике
  update public.raid_missions set ready_at = now()
    where actor_fid = p_fid and status = 'active';
  get diagnostics n_att = row_count;
  -- фракция-ЦЕЛЬ: резолвятся на тике каждого атакующего
  update public.raid_missions set ready_at = now()
    where target_fid = p_fid and status = 'active';
  get diagnostics n_def = row_count;
  perform public._raid_resolve(p_fid);                       -- свои рейды
  for r in select distinct actor_fid from public.raid_missions
           where target_fid = p_fid and status = 'active' loop
    perform public._raid_resolve(r.actor_fid);               -- рейды против нас
  end loop;
  return jsonb_build_object('ok', true, 'as_attacker', n_att, 'as_target', n_def);
end$$;
revoke all on function public.admin_test_speed_raids(text) from public;
grant execute on function public.admin_test_speed_raids(text) to authenticated;

-- ── Завершить шпионаж немедленно ────────────────────────────
-- Агенты дообучаются (ready_at=now), активные операции резолвятся сейчас.
create or replace function public.admin_test_speed_spy(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  update public.spy_agents   set ready_at = now() where faction_id = p_fid and ready_at > now();
  update public.spy_missions set ready_at = now() where actor_fid = p_fid and status = 'active';
  get diagnostics n = row_count;
  perform public._spy_resolve(p_fid);
  return jsonb_build_object('ok', true, 'ops', n);
end$$;
revoke all on function public.admin_test_speed_spy(text) from public;
grant execute on function public.admin_test_speed_spy(text) to authenticated;

-- ── Форсировать тик дохода ──────────────────────────────────
-- Откатываем last_tick на 25 ч и зовём живой economy_accrue → доход за сутки
-- сразу (попутно резолвятся колонии/шпионаж/рейды, как на обычном тике).
create or replace function public.admin_test_force_tick(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare res jsonb;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  update public.faction_economy set last_tick = now() - interval '25 hours' where faction_id = p_fid;
  if not found then raise exception 'no economy'; end if;
  res := public.economy_accrue(p_fid);
  return jsonb_build_object('ok', true, 'tick', res);
end$$;
revoke all on function public.admin_test_force_tick(text) from public;
grant execute on function public.admin_test_force_tick(text) to authenticated;

-- ── Удалить религию фракции ─────────────────────────────────
-- Удаляет веру, ОСНОВАННУЮ этой фракцией. Каскадом уходят faith_membership,
-- faith_sects, faith_offers (все ссылаются на faiths(id) on delete cascade).
create or replace function public.admin_test_delete_faith(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_name text;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  delete from public.faiths where founder_fid = p_fid returning name into v_name;
  if v_name is null then raise exception 'no faith founded by this faction'; end if;
  return jsonb_build_object('ok', true, 'name', v_name);
end$$;
revoke all on function public.admin_test_delete_faith(text) from public;
grant execute on function public.admin_test_delete_faith(text) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- select public.admin_test_speed_raids('<fid>');   -- резолв рейдов
-- select public.admin_test_force_tick('<fid>');     -- начислить доход за сутки
-- select public.admin_test_delete_faith('<fid>');   -- снести веру фракции
