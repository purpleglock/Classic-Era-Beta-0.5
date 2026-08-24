-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ДОБОР ВОИНСТВА ДО ШТАТА (разовый, идемпотентный)
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_wings.sql.
--
-- ЗАЧЕМ. _angel_wings.sql поднял крыло с трёх бортов до пяти. Верфь дотянет
-- сама, но по своей экономике: 40 000 ГС за борт при доходе около 14 000 в
-- час — это примерно двое суток на недостающие борта. Платить этими сутками
-- игрок не должен: воинство простояло неделю скованным в 193 пустых досках
-- не по своей вине, а по ошибке в расстановке (см. _angel_floor.sql).
--
-- ⚠️ ЭТО НЕ ПОДАРОК ЭКОНОМИКЕ. ГС выдаётся ровно под добор и тут же
-- списывается верфью по каталожной цене — баланс хозяйства не сдвигается ни
-- на единицу. Повторный накат ничего не делает: штат уже набран.
-- ════════════════════════════════════════════════════════════
do $$
declare af text; want int; have int; price numeric; r jsonb; made int := 0; guard int := 0;
begin
  select faction_id into af from public.angel_state where fell_at is null order by created_at limit 1;
  if af is null then raise notice 'ангела нет — добирать некого'; return; end if;

  price := public._angel_yard_const('ship_gc');
  -- ⚠️ ШТАТ — ПО ПОТОЛКУ ВЕРФИ, а не по `fleets × per`. Крыльев в живой базе
  -- пять, а не четыре: верфь заводила их сама, пока константа говорила «два».
  -- Считать по константе значило бы остановиться на четырёх бортах в крыле —
  -- ровно на позицию раньше носителя, и ни одного «Арелима» не появилось бы.
  want  := public._angel_yard_const('cap')::int;

  loop
    select count(*) into have from public.angel_guard
     where role = 'escort' and dead_at is null;
    exit when have >= want;

    guard := guard + 1;
    exit when guard > 60;                 -- страховка от вечного цикла

    update public.faction_economy set gc = gc + price where faction_id = af;
    begin
      r := public._angel_shipyard();
    exception when others then
      raise notice 'верфь встала: %', sqlerrm;
      update public.faction_economy set gc = gc - price where faction_id = af;
      exit;
    end;
    -- Верфь не построила (полна, нет места) — деньги назад и выходим.
    if coalesce(r->>'act', '') <> 'ship' then
      update public.faction_economy set gc = gc - price where faction_id = af;
      raise notice 'верфь не строит: %', r;
      exit;
    end if;
    made := made + 1;
  end loop;

  begin perform public._angel_kinds(); exception when others then null; end;

  select count(*) into have from public.angel_guard where role = 'escort' and dead_at is null;
  raise notice 'добрано бортов: %, воинство: % из %', made, have, want;
end$$;
