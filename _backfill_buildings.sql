-- ════════════════════════════════════════════════════════════════════
-- РАЗОВАЯ МИГРАЦИЯ: доначисление недостающих СТАРТОВЫХ зданий.
--
-- Зачем: public.economy_init() создаёт стартовые здания РОВНО ОДИН РАЗ
-- (при первом заходе в «Кабинет»: `if found then return eco`). Фракции,
-- инициализированные до текущей версии логики выдачи (в т.ч. грант-здания
-- доктрины), недополучили часть построек и повторным входом не чинятся.
--
-- Что делает: для каждой approved-фракции считает ОЖИДАЕМЫЙ набор
--   = бесплатное по типу цивилизации (frontier→intel, colony→factory)
--   + купленные в анкете (app.buildings)
--   + грант-здания доктрины (_doctrine_grant_buildings)
-- и сравнивает с фактическими colony_buildings (по всей фракции).
-- Если по какому-то типу зданий МЕНЬШЕ ожидаемого — дозаполняет разницу
-- на столичную колонию.
--
-- Безопасность:
--  • Идемпотентно — повторный запуск ничего не добавит.
--  • Консервативно — считает по всей фракции, поэтому НЕ дублирует тем, кто
--    уже имеет нужное (в т.ч. построил сам). Снесённое игроком осознанно
--    может вернуться — это компромисс в пользу пострадавших.
-- ════════════════════════════════════════════════════════════════════

create or replace function public._backfill_starter_buildings(p_apply boolean default false)
returns table(faction text, kind text, missing int)
language plpgsql security definer set search_path = public as $$
declare
  app record;
  cap uuid;
  expected text[];
  b text; t text;
  want int; have int; i int;
begin
  for app in
    select * from public.faction_applications
    where status = 'approved' and faction_id is not null
  loop
    -- столичная колония (приоритет — помеченная «Столичный мир»)
    select id into cap from public.colonies
      where faction_id = app.faction_id
      order by (planet_type = 'Столичный мир') desc, created_at asc
      limit 1;
    if cap is null then continue; end if;

    -- ── собираем ОЖИДАЕМЫЙ набор btype (мультимножество) ──
    expected := array[]::text[];

    -- 1) бесплатное по типу цивилизации
    expected := expected || (case when app.civ_type = 'frontier' then 'intel' else 'factory' end);

    -- 2) купленные в анкете (маппинг id → btype, как в economy_init)
    for b in select jsonb_array_elements_text(coalesce(app.buildings, '[]'::jsonb)) loop
      t := case b
        when 'encom' then 'factory'  when 'ind'  then 'mining'
        when 'unit'  then 'trade'    when 'sci'  then 'science'
        when 'emb'   then 'training' when 'com'  then 'intel'
        when 'yard'  then 'military_factory' when 'mil' then 'shipyard'
        else null end;
      if t is not null then expected := expected || t; end if;
    end loop;

    -- 3) грант-здания доктрины
    expected := expected || public._doctrine_grant_buildings(app.gov, app.ideology);

    -- ── по каждому типу: сколько ожидается vs сколько есть ──
    for t in select distinct unnest(expected) loop
      want := (select count(*) from unnest(expected) e(v) where e.v = t);
      have := (select count(*) from public.colony_buildings cb
               where cb.faction_id = app.faction_id and cb.btype = t);
      if have < want then
        faction := app.name; kind := t; missing := want - have; return next;
        if p_apply then
          for i in 1..(want - have) loop
            insert into public.colony_buildings (colony_id, faction_id, owner_id, btype, slots_open)
            values (cap, app.faction_id, app.owner_id, t,
                    case when t in ('factory','mining') then 2 else 1 end);
          end loop;
        end if;
      end if;
    end loop;
  end loop;
end$$;

revoke all on function public._backfill_starter_buildings(boolean) from public;

-- ── КАК ЗАПУСКАТЬ ──
-- 1) Сухой прогон — показать, кому и чего не хватает (НИЧЕГО не меняет):
--      select * from public._backfill_starter_buildings(false);
-- 2) Применить — доначислить недостающие здания всем:
--      select * from public._backfill_starter_buildings(true);
-- Повторный запуск (true) безопасен — добавит только новый дефицит.


-- ════════════════════════════════════════════════════════════════════
-- БЭКФИЛЛ СТОЛИЦ: пометить is_capital у существующих столичных колоний
-- и сгенерировать столичную планету на карте (если её там ещё нет).
-- Использует _ensure_capital (идемпотентно, без дублей колоний — берёт
-- актуальную столичную колонию фракции как источник истины).
-- Требует, чтобы _economy_setup.sql с _ensure_capital был уже применён.
-- Запуск:  select public._backfill_capitals();
-- ════════════════════════════════════════════════════════════════════
create or replace function public._backfill_capitals()
returns int language plpgsql security definer set search_path = public as $$
declare f record; n int := 0;
begin
  for f in select distinct faction_id from public.faction_applications
           where status = 'approved' and faction_id is not null loop
    perform public._ensure_capital(f.faction_id);
    n := n + 1;
  end loop;
  return n;
end$$;
revoke all on function public._backfill_capitals() from public;


-- ════════════════════════════════════════════════════════════════════
-- РАЗОВАЯ МИГРАЦИЯ: доначисление недостающих СТАРТОВЫХ ТЕХНОЛОГИЙ доктрины.
--
-- Зачем: бесплатные техи доктрины (_doctrine_grant_techs по идеологии)
-- выдаются в faction_economy.research ТОЛЬКО при первичной вставке в
-- economy_init(). Старые фракции, инициализированные до появления этой
-- логики, недополучили их, а login-догон (starter_fixed) чинит лишь
-- столицу и здания — НЕ техи. Аналог _backfill_starter_buildings, но для
-- технологий.
--
-- Что делает: для каждой approved-фракции берёт ожидаемые техи доктрины
-- и сверяет с faction_economy.research; недостающие ноды добавляет.
--
-- Безопасность:
--  • Идемпотентно — уже выданное/изученное (research ? node) не дублируется.
--  • Не трогает экономику, которая ещё не инициализирована (выдастся сама
--    при первом заходе в «Кабинет»).
-- ════════════════════════════════════════════════════════════════════
create or replace function public._backfill_doctrine_techs(p_apply boolean default false)
returns table(faction text, ideology text, tech_node text, tech_label text)
language plpgsql security definer set search_path = public as $$
declare
  app record;
  eco public.faction_economy;
  granted jsonb;
  tnode text;
  cur jsonb;
  chg boolean;
begin
  for app in
    select * from public.faction_applications
    where status = 'approved' and faction_id is not null
  loop
    granted := public._doctrine_grant_techs(app.ideology);
    if granted is null or jsonb_array_length(granted) = 0 then continue; end if;

    select * into eco from public.faction_economy where faction_id = app.faction_id;
    if not found then continue; end if;   -- экономика не инициализирована — выдастся при первом заходе

    cur := coalesce(eco.research, '[]'::jsonb);
    chg := false;

    -- по каждому гранту: если ноды нет в research — это недостача
    for tnode in select jsonb_array_elements_text(granted) loop
      if not (cur ? tnode) then
        faction := app.name; ideology := app.ideology; tech_node := tnode;
        tech_label := case tnode
          when 'comp.ship.reactor'  then 'Продвинутые реакторы (корабли)'
          when 'comp.ground.armor'  then 'Продвинутая броня (наземка)'
          when 'comp.ground.shield' then 'Продвинутые щиты (наземка)'
          when 'comp.ship.engine'   then 'Продвинутые двигатели (корабли)'
          else tnode end;
        return next;
        if p_apply then cur := cur || to_jsonb(tnode); chg := true; end if;
      end if;
    end loop;

    if p_apply and chg then
      update public.faction_economy set research = cur where faction_id = app.faction_id;
    end if;
  end loop;
end$$;

revoke all on function public._backfill_doctrine_techs(boolean) from public;

-- ── КАК ЗАПУСКАТЬ ──
-- 1) Сухой прогон — показать, кому каких техов не хватает (НИЧЕГО не меняет):
--      select * from public._backfill_doctrine_techs(false);
-- 2) Применить — доначислить недостающие техи доктрины всем:
--      select * from public._backfill_doctrine_techs(true);
-- Повторный запуск (true) безопасен — добавит только новый дефицит.
