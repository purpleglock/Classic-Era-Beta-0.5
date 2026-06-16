-- ============================================================
-- ФИКС: производство ОБЩЕДОСТУПНЫХ (стоковых) дизайнов
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Баг: economy_produce отвергал дизайн, если u.faction_id <> мой fid. У
-- общедоступного дизайна faction_id = NULL, а `NULL is distinct from fid` = TRUE
-- → «not your design». Теперь строить можно СВОИ и ОБЩЕДОСТУПНЫЕ (faction_id null);
-- чужие фракционные дизайны по-прежнему нельзя.
-- ============================================================
create or replace function public.economy_produce(p_unit_id uuid, p_qty int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; u public.faction_units; qty int; cost numeric;
  cat text; ln text; w int; rdy timestamptz;
begin
  fid := public._ec_my_fid();
  qty := greatest(1, coalesce(p_qty, 1));
  select * into u from public.faction_units where id = p_unit_id;
  if not found then raise exception 'unit design not found'; end if;
  -- свои ИЛИ общедоступные (faction_id null); чужие фракционные — нельзя
  if u.faction_id is not null and u.faction_id is distinct from fid then raise exception 'not your design'; end if;

  if u.category = 'division' then cat:='division'; ln:='army';     w:=0;
  elsif u.category = 'ship'   then cat:='ship';     ln:='shipyard'; w:=1;
  else raise exception 'this category is not produced here'; end if;

  cost := coalesce((u.summary->>'cost')::numeric, 0) * qty;

  select coalesce(last_tick, now()) + interval '1 day' into rdy
    from public.faction_economy where faction_id = fid;
  if rdy is null then rdy := now() + interval '1 day'; end if;

  update public.faction_economy set gc = gc - cost where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.unit_production
    (faction_id, owner_id, unit_id, unit_name, category, line, weight, qty, status, ready_at)
  values
    (fid, auth.uid(), u.id, u.name, cat, ln, w, qty, 'queued', rdy);

  return jsonb_build_object('ok', true, 'cost', cost, 'qty', qty, 'ready_at', rdy);
end$$;
revoke all on function public.economy_produce(uuid,int) from public;
grant execute on function public.economy_produce(uuid,int) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- Общедоступный (faction_id null) корабль/дивизия теперь ставятся в производство.
