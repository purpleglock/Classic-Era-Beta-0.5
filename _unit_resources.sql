-- ============================================================
-- РЕСУРСЫ В ПРОИЗВОДСТВЕ ЮНИТОВ · СРЕЗ 1 (корабли)
-- Применять в Supabase → SQL Editor ПОСЛЕ _security_money.sql и
-- _fix_produce_public.sql. Идемпотентно.
--
-- Идея: у дизайна, кроме summary.cost (ГС из конструктора), теперь есть
--   summary.bill = {"Железо": N, "Медь": M, ...} — сырьё на 1 корпус
--   (считает constructors.js, как и cost). При закладке:
--     • по каждому ресурсу берём min(на складе, нужно) — БЕСПЛАТНО (уже добыто);
--     • дефицит ДОКУПАЕМ по рынку × 1.5 и добавляем к ГС-цене;
--   Итог ГС = cost*qty + Σ(дефицит × _res_value × 1.5).
-- Отмена возвращает и потраченные ресурсы, и наценку — для этого пишем их в
-- строку производства (две новые колонки).
--
-- Дивизии/техника/авиация: bill пуст → ведут себя как раньше (чистый ГС).
-- ============================================================

-- ── Колонки учёта для точного возврата при отмене ───────────
alter table public.unit_production add column if not exists res_spent     jsonb   default '{}'::jsonb;
alter table public.unit_production add column if not exists res_surcharge numeric default 0;

-- ════════════════════════════════════════════════════════════
-- economy_produce — списывает сырьё по summary.bill + докупает дефицит ×1.5
-- ════════════════════════════════════════════════════════════
create or replace function public.economy_produce(p_unit_id uuid, p_qty int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; u public.faction_units; qty int;
  base_cost numeric; surcharge numeric := 0; total numeric;
  cat text; ln text; w int; rdy timestamptz;
  bill jsonb; res jsonb; spent jsonb := '{}'::jsonb;
  rkey text; rneed numeric; rhave numeric; rcons numeric; rshort numeric;
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

  base_cost := coalesce((u.summary->>'cost')::numeric, 0) * qty;
  bill := coalesce(u.summary->'bill', '{}'::jsonb);

  -- запираем строку экономики на время расчёта (анти-гонка двойной закладки)
  select coalesce(resources, '{}'::jsonb) into res
    from public.faction_economy where faction_id = fid for update;
  if res is null then raise exception 'no economy'; end if;

  -- по каждому ресурсу ведомости: тратим со склада сколько есть, дефицит докупаем ×1.5
  for rkey, rneed in select key, (value)::numeric * qty from jsonb_each_text(bill) loop
    if rneed is null or rneed <= 0 then continue; end if;
    rhave  := coalesce((res->>rkey)::numeric, 0);
    rcons  := least(rhave, rneed);
    rshort := rneed - rcons;
    if rcons > 0 then
      res   := jsonb_set(res,   array[rkey], to_jsonb(rhave - rcons), true);
      spent := jsonb_set(spent, array[rkey], to_jsonb(rcons), true);
    end if;
    if rshort > 0 then
      surcharge := surcharge + rshort * public._res_value(rkey) * 1.5;
    end if;
  end loop;
  surcharge := ceil(surcharge);
  total := base_cost + surcharge;

  select coalesce(last_tick, now()) + interval '1 day' into rdy
    from public.faction_economy where faction_id = fid;
  if rdy is null then rdy := now() + interval '1 day'; end if;

  -- атомарно: списываем ГС (если хватает) и обновляем склад
  update public.faction_economy
     set gc = gc - total, resources = res
   where faction_id = fid and gc >= total;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.unit_production
    (faction_id, owner_id, unit_id, unit_name, category, line, weight, qty, status, ready_at, res_spent, res_surcharge)
  values
    (fid, auth.uid(), u.id, u.name, cat, ln, w, qty, 'queued', rdy, spent, surcharge);

  return jsonb_build_object('ok', true, 'cost', total, 'gc_base', base_cost,
    'surcharge', surcharge, 'res_spent', spent, 'qty', qty, 'ready_at', rdy);
end$$;
revoke all on function public.economy_produce(uuid,int) from public;
grant execute on function public.economy_produce(uuid,int) to authenticated;

-- ════════════════════════════════════════════════════════════
-- economy_cancel_production — возврат ГС (cost*qty + наценка) + сырья на склад
-- ════════════════════════════════════════════════════════════
create or replace function public.economy_cancel_production(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; q public.unit_production; refund numeric := 0;
  res jsonb; spent jsonb; rkey text; rval numeric;
begin
  fid := public._ec_my_fid();
  select * into q from public.unit_production where id = p_id;
  if not found then raise exception 'production not found'; end if;
  if q.faction_id is distinct from fid then raise exception 'not your production'; end if;
  if q.status <> 'queued' then raise exception 'already delivered'; end if;

  -- база: cost*qty по дизайну (как раньше) + наценка за дефицит, уплаченная при закладке
  select coalesce((u.summary->>'cost')::numeric, 0) * coalesce(q.qty, 0) into refund
    from public.faction_units u where u.id = q.unit_id;
  refund := coalesce(refund, 0) + coalesce(q.res_surcharge, 0);

  spent := coalesce(q.res_spent, '{}'::jsonb);

  delete from public.unit_production where id = p_id;

  -- возвращаем потраченное сырьё на склад (без проверки ёмкости — это возврат)
  select coalesce(resources, '{}'::jsonb) into res
    from public.faction_economy where faction_id = fid for update;
  for rkey, rval in select key, (value)::numeric from jsonb_each_text(spent) loop
    if rval is null or rval = 0 then continue; end if;
    res := jsonb_set(res, array[rkey], to_jsonb(coalesce((res->>rkey)::numeric, 0) + rval), true);
  end loop;

  update public.faction_economy
     set gc = gc + refund, resources = res
   where faction_id = fid;

  return jsonb_build_object('ok', true, 'refund', refund, 'res_returned', spent);
end$$;
revoke all on function public.economy_cancel_production(uuid) from public;
grant execute on function public.economy_cancel_production(uuid) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- 1) Закладка корвета (bill {"Железо":2}) при пустом складе: surcharge = 2*3*1.5 = 9 ГС.
-- 2) Та же закладка при наличии 2 Железа: surcharge = 0, со склада ушло 2 Железа.
-- 3) Отмена возвращает ГС (cost+наценка) и сырьё обратно на склад.
