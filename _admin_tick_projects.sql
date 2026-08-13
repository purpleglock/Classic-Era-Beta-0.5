-- ── «+1 тик» двигает и СТРОЙКИ, а не только казну ──────────────────────────
-- Было: admin_test_force_tick откатывал faction_economy.last_tick на 25 ч и звал
-- economy_accrue. Доход начислялся, но недострои в colony_projects живут по
-- АБСОЛЮТНОМУ ready_at (например, Ожерелье Немезиды = now() + 3 дня), и никакой
-- откат last_tick их не приближал: игрок жал «+1 тик» трижды и видел, что
-- стройка стоит на месте. Теперь тик = сутки для ВСЕЙ державы: дедлайны
-- недостроев тоже сдвигаются на 24 ч назад, и _apply_colony_projects внутри
-- economy_accrue достраивает то, что дозрело.
--
-- Флоты СПЕЦИАЛЬНО не трогаем: у них своя кнопка «🚀 Пропустить полёт»
-- (admin_test_skip_flight), которая считает границы, перехват и бой на прибытии.
-- Слепой сдвиг arrive_at мимо этой логики ломал бы перехват.

create or replace function public.admin_test_force_tick(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare res jsonb; moved int;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  update public.faction_economy set last_tick = now() - interval '25 hours' where faction_id = p_fid;
  if not found then raise exception 'no economy'; end if;

  -- сутки вперёд для недостроев (стройка, слоты, обустройство среды, терраформ)
  update public.colony_projects set ready_at = ready_at - interval '24 hours'
    where faction_id = p_fid;
  get diagnostics moved = row_count;

  res := public.economy_accrue(p_fid);   -- внутри: _apply_colony_projects(p_fid)
  return jsonb_build_object('ok', true, 'tick', res, 'projects_advanced', moved);
end$$;
revoke all on function public.admin_test_force_tick(text) from public;
grant execute on function public.admin_test_force_tick(text) to authenticated;

-- Проверка:
--   select public.admin_test_force_tick('<fid>');
--   select btype, ready_at from public.colony_projects where faction_id = '<fid>';
