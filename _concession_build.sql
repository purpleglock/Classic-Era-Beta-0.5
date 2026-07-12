-- ════════════════════════════════════════════════════════════════════════════
--  КОНЦЕССИИ v2 · «строй и добывай» · 2026-07-12
--  Концессия больше НЕ капает сама (юзер: «человек просто так будет получать
--  доход и нихуя не строить»). Право добычи = право ПОСТРОИТЬ свой добывающий
--  домик нужного яруса на чужой колонии (concession_build). Дальше домик
--  работает как обычный: слоты от бюджета/населения ПОЛУЧАТЕЛЯ, добыча идёт
--  в его потоки (склад/экспорт/биржа), но копает ТОЛЬКО отданные ему залежи
--  (проверка в economy_accrue, _budget_wellbeing.sql).
--  При отзыве/отказе от концессии домики получателя, оставшиеся без права,
--  сносятся с возвратом ½ базовой цены (правило сноса).
--  Требует: _budget_wellbeing.sql (перекаченный), _res_flows-таблица
--  mining_concessions, хелперы _ec_bld_base/_ec_build_cost/_ec_bld_free/_mine_tier_ok.
--  Идемпотентно. Катить ПОСЛЕ _budget_wellbeing.sql.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Постройка добывающего домика на колонии-концеденте (мгновенная) ──
create or replace function public.concession_build(p_conc uuid, p_btype text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; mc public.mining_concessions; col public.colonies;
  rr text; base numeric; cost numeric; used int; v_id uuid;
begin
  fid := public._ec_my_fid();
  select * into mc from public.mining_concessions where id = p_conc;
  if not found or mc.to_fid is distinct from fid then raise exception 'concession not found'; end if;
  if p_btype not in ('mining','mining_deep','mining_exotic') then
    raise exception 'bad btype: по концессии строятся только добывающие здания';
  end if;
  select * into col from public.colonies where id = mc.colony_id;
  if not found then raise exception 'colony not found'; end if;

  -- ярус домика обязан покрывать редкость отданной залежи
  rr := coalesce((select value->>'r' from jsonb_array_elements(coalesce(col.resources,'[]'::jsonb))
                    where value->>'name' = mc.res_name limit 1),
                 (select rarity from public.resource_rarity where name = mc.res_name), 'common');
  if not public._mine_tier_ok(p_btype, rr) then
    raise exception 'wrong tier: залежь «%» (%) добывается другим ярусом', mc.res_name, rr;
  end if;

  -- ячейки колонии общие с владельцем
  select count(*) into used from public.colony_buildings where colony_id = mc.colony_id;
  if used >= coalesce(col.cells, 6) then raise exception 'no free cells: на колонии нет свободных ячеек'; end if;

  base := public._ec_bld_base(p_btype);
  cost := public._ec_build_cost(fid, base);
  update public.faction_economy set gc = gc - cost where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_buildings (colony_id, faction_id, owner_id, btype, slots_open, tnp_mode)
    values (mc.colony_id, fid, auth.uid(), p_btype, greatest(1, coalesce(public._ec_bld_free(p_btype),1)), false)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'cost', cost, 'id', v_id);
end$$;
revoke all on function public.concession_build(uuid,text) from public, anon;
grant execute on function public.concession_build(uuid,text) to authenticated;

-- ── Отзыв/отказ: снести домики получателя, оставшиеся без права (½ базы назад) ──
create or replace function public.concession_revoke(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; mc public.mining_concessions; b record; refunded int := 0;
begin
  fid := public._ec_my_fid();
  select * into mc from public.mining_concessions where id = p_id and (from_fid = fid or to_fid = fid);
  if not found then raise exception 'concession not found'; end if;
  delete from public.mining_concessions where id = mc.id;

  -- домики получателя на этой колонии, чей ярус больше не покрыт НИ ОДНОЙ
  -- оставшейся концессией ему же — сносим с возвратом ½ базовой цены
  for b in select cb.* from public.colony_buildings cb
           where cb.colony_id = mc.colony_id and cb.faction_id = mc.to_fid
             and cb.btype in ('mining','mining_deep','mining_exotic')
  loop
    if not exists(
      select 1 from public.mining_concessions m2
      join public.colonies c on c.id = m2.colony_id
      where m2.colony_id = b.colony_id and m2.to_fid = b.faction_id
        and public._mine_tier_ok(b.btype,
              coalesce((select value->>'r' from jsonb_array_elements(coalesce(c.resources,'[]'::jsonb))
                          where value->>'name' = m2.res_name limit 1),
                       (select rarity from public.resource_rarity where name = m2.res_name), 'common'))
    ) then
      update public.faction_economy set gc = gc + round(coalesce(public._ec_bld_base(b.btype),0) / 2.0)
        where faction_id = b.faction_id;
      delete from public.colony_buildings where id = b.id;
      refunded := refunded + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'demolished', refunded);
end$$;
revoke all on function public.concession_revoke(uuid) from public, anon;
grant execute on function public.concession_revoke(uuid) to authenticated;
