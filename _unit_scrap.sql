-- ════════════════════════════════════════════════════════════════════
-- СПИСАНИЕ ЮНИТОВ ИЗ БОЕВОГО СОСТАВА (2026-07-29)
-- ════════════════════════════════════════════════════════════════════
-- Проблема: из состава (unit_production status='done') не было НИ ОДНОГО
-- способа убрать юнит. Корабли/техника, чей проект удалён в конструкторе,
-- зависали навсегда: во флот их ещё можно было взять, но карточка ТТХ
-- пустая, а убрать — никак. RLS на unit_production даёт delete только
-- владельцу, но клиент DML не пишет (см. _security_hardening) — нужен RPC.
--
-- Списание идёт по ИМЕНИ + КАТЕГОРИИ, а не по unit_id: у осиротевших
-- записей дизайн уже удалён, и привязка к faction_units не работает.
--
-- Возврат: 40% цены проекта, если проект ещё жив (faction_units.summary.cost).
-- Осиротевшие юниты списываются без возврата — цену взять неоткуда.
--
-- Зависит от: _economy_setup.sql (unit_production, faction_economy),
--             public._ec_my_fid()
-- ════════════════════════════════════════════════════════════════════

create or replace function public.unit_scrap(
  p_unit_name text,
  p_category  text,
  p_qty       int default null      -- null = списать всё
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; have int; want int; rem int; take int; r record;
  v_uid uuid; unit_cost numeric := 0; back numeric := 0;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'нет фракции'; end if;
  if coalesce(trim(p_unit_name),'') = '' then raise exception 'не указан юнит'; end if;
  if coalesce(p_category,'') not in ('ship','ground','aviation','division') then
    raise exception 'неизвестная категория «%»', p_category;
  end if;

  select coalesce(sum(qty),0) into have from public.unit_production
    where faction_id = fid and status = 'done'
      and category = p_category and unit_name = p_unit_name;
  if have <= 0 then raise exception 'такого юнита нет в составе'; end if;

  want := least(have, greatest(1, coalesce(p_qty, have)));

  -- цена проекта, если он ещё существует в конструкторе
  select up.unit_id into v_uid from public.unit_production up
    where up.faction_id = fid and up.status = 'done'
      and up.category = p_category and up.unit_name = p_unit_name
      and up.unit_id is not null limit 1;
  if v_uid is not null then
    select coalesce((fu.summary->>'cost')::numeric, 0) into unit_cost
      from public.faction_units fu where fu.id = v_uid;
  end if;
  back := round(coalesce(unit_cost,0) * 0.4 * want);

  rem := want;
  for r in select id, qty from public.unit_production
      where faction_id = fid and status = 'done'
        and category = p_category and unit_name = p_unit_name
      order by created_at asc loop
    exit when rem <= 0;
    take := least(r.qty, rem);
    if take >= r.qty then delete from public.unit_production where id = r.id;
    else update public.unit_production set qty = qty - take where id = r.id; end if;
    rem := rem - take;
  end loop;

  if back > 0 then
    update public.faction_economy set gc = gc + back where faction_id = fid;
  end if;

  return jsonb_build_object('ok', true, 'scrapped', want, 'left', have - want, 'refund', back);
end$$;

revoke all on function public.unit_scrap(text, text, int) from public, anon;
grant execute on function public.unit_scrap(text, text, int) to authenticated;

notify pgrst, 'reload schema';
