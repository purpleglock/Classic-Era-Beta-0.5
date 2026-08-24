-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — СРЕЗАТЬ ЛИШНЕЕ ВОИНСТВО ДО ПОТОЛКА ВЕРФИ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_wings.sql (редакции, где `fleets/per` возвращены
-- к 2×3). Идемпотентно: при эскорте в пределах потолка не делает ничего.
--
-- ЗАЧЕМ. Пока `_angel_host_const('fleets'/'per')` стояли 4×5, `angel_host_muster`
-- при каждом тике доливал бесплатные борта с детерминированными uuid — эскорт
-- разнесло до 44 при потолке верфи 30. Лишнее срезаем по СТАРШИНСТВУ: уходят
-- самые поздние `ord`, то есть ровно те, что налило сбором.
-- ════════════════════════════════════════════════════════════
do $$
declare af text; cap int; have int; r record; n int := 0;
begin
  select faction_id into af from public.angel_state where fell_at is null order by created_at limit 1;
  if af is null then raise notice 'ангела нет'; return; end if;

  cap := public._angel_yard_const('cap')::int;
  select count(*) into have from public.angel_guard
   where faction_id = af and role = 'escort' and dead_at is null;
  raise notice 'эскорт: % при потолке %', have, cap;
  if have <= cap then raise notice 'резать нечего'; return; end if;

  for r in select g.unit_id, g.fleet_id, g.name
             from public.angel_guard g
            where g.faction_id = af and g.role = 'escort' and g.dead_at is null
            order by g.ord desc
            limit (have - cap)
  loop
    -- Из состава флота.
    update public.fleets f
       set composition = (
             select coalesce(jsonb_agg(e), '[]'::jsonb)
               from jsonb_array_elements(coalesce(f.composition, '[]'::jsonb)) e
              where nullif(e->>'unit_id','')::uuid is distinct from r.unit_id)
     where f.id = r.fleet_id;

    -- Из реестра и каталога. Строку в angel_guard сносим НАСОВСЕМ, а не
    -- помечаем dead_at: покойник занял бы место в крыле, и верфь никогда бы
    -- его не пополнила (см. комментарий в `_angel_shipyard`).
    delete from public.angel_guard  where unit_id = r.unit_id;
    delete from public.battle_units where unit_id = r.unit_id
      and battle_id in (select id from public.battles where status <> 'done');
    delete from public.faction_units where id = r.unit_id;
    n := n + 1;
  end loop;

  -- Пустые крылья убрать, иначе верфь считает их местом под пополнение.
  delete from public.fleets f
   where f.faction_id = af
     and coalesce(jsonb_array_length(coalesce(f.composition,'[]'::jsonb)), 0) = 0
     and f.id is distinct from (select fleet_id from public.angel_state where faction_id = af)
     and not exists (select 1 from public.angel_guard g where g.fleet_id = f.id);

  raise notice 'срезано бортов: %', n;
end$$;

-- ── РОВНЫЙ СТРОЙ ────────────────────────────────────────────
-- После среза крылья разъехались (6 / 2 / 9 / 4 / 9): сбор раскидывал борта
-- по своим номерам, а резали мы по старшинству. Раскладываем эскорт заново
-- по пять — иначе состав «2 колеса + 2 жала + носитель» существует только на
-- бумаге, а на доске выходит крыло из двух колёс или из девяти чего попало.
do $$
declare af text; per int; i int; wid uuid; ecoown uuid; here text; r record;
        want int; have int; nw int;
        wing text[] := array['ОФАНИМ-АЛЬФА','ОФАНИМ-БЕТА','ОФАНИМ-ГАММА',
                             'ОФАНИМ-ДЕЛЬТА','ОФАНИМ-ЭПСИЛОН','ОФАНИМ-ДЗЕТА'];
begin
  select faction_id into af from public.angel_state where fell_at is null order by created_at limit 1;
  if af is null then return; end if;
  per := public._angel_yard_const('per_wing')::int;

  select count(*) into have from public.angel_guard
   where faction_id = af and role = 'escort' and dead_at is null;
  if have = 0 then raise notice 'эскорта нет'; return; end if;
  want := ceil(have::numeric / per)::int;

  select owner_id into ecoown from public.faction_economy where faction_id = af;
  select coalesce(f.system_id, a.home_sys) into here
    from public.angel_state a left join public.fleets f on f.id = a.fleet_id
   where a.faction_id = af;

  -- Нужное число крыльев: недостающие заводим, лишние уйдут пустыми ниже.
  for i in 1 .. want loop
    select id into wid from public.fleets
     where faction_id = af and name = coalesce(wing[i], 'ОФАНИМ-' || i) limit 1;
    if wid is null then
      insert into public.fleets(faction_id, owner_id, name, status, system_id, home_sys,
                                composition, is_station, fuel, fuel_cap)
        values (af, ecoown, coalesce(wing[i], 'ОФАНИМ-' || i), 'idle', here,
                (select home_sys from public.angel_state where faction_id = af),
                '[]'::jsonb, false, 99, 99);
    end if;
  end loop;

  -- Раскладка по пять, по старшинству `ord`.
  for r in
    select g.unit_id,
           ((row_number() over (order by g.ord) - 1) / per) + 1 as slot
      from public.angel_guard g
     where g.faction_id = af and g.role = 'escort' and g.dead_at is null
  loop
    select id into wid from public.fleets
     where faction_id = af and name = coalesce(wing[r.slot], 'ОФАНИМ-' || r.slot) limit 1;
    update public.angel_guard set fleet_id = wid where unit_id = r.unit_id;
  end loop;

  -- Состав флотов пересобираем ИЗ реестра: это одна точка правды, и после
  -- перекладки старые composition врут поголовно.
  update public.fleets f
     set composition = coalesce((
           select jsonb_agg(jsonb_build_object('unit_id', g.unit_id, 'qty', 1) order by g.ord)
             from public.angel_guard g
            where g.fleet_id = f.id and g.dead_at is null), '[]'::jsonb)
   where f.faction_id = af
     and f.id is distinct from (select fleet_id from public.angel_state where faction_id = af);

  -- Пустые крылья убрать: верфь считает их местом под пополнение.
  delete from public.fleets f
   where f.faction_id = af
     and f.id is distinct from (select fleet_id from public.angel_state where faction_id = af)
     and not exists (select 1 from public.angel_guard g where g.fleet_id = f.id and g.dead_at is null);

  begin perform public._angel_kinds(); exception when others then null; end;

  select count(distinct fleet_id) into nw from public.angel_guard
   where faction_id = af and role = 'escort' and dead_at is null;
  raise notice 'строй выровнен: % бортов в % крыльях', have, nw;
end$$;
