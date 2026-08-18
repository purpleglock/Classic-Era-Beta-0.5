-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — САМОПРОВЕРКА НА ПОДСТАВНОЙ ДЕРЖАВЕ
-- ────────────────────────────────────────────────────────────
-- Гоняет всю цепочку на выдуманной державе fac_angeltest и УБИРАЕТ её за собой.
-- Живых данных не касается вообще. Катать после _angel_ai.sql.
--
-- Зачем отдельный файл, а не «проверю на живой»: вознесение сносит колонии, и
-- первая же опечатка в тике стоила бы игроку хозяйства. Здесь то же самое
-- происходит с державой, которой не существует.
-- ════════════════════════════════════════════════════════════
do $$
declare sysid text; cid uuid; a jsonb; st jsonb; tick jsonb; econ jsonb;
        hit jsonb; i int; parried int := 0; landed int := 0; salvos int := 0;
        seals numeric; fl uuid; nb int;
begin
  -- ── чистим следы прошлого прогона
  perform public.angel_descend('fac_angeltest');
  delete from public.angel_state  where faction_id = 'fac_angeltest';
  delete from public.angel_relic  where faction_id = 'fac_angeltest';
  delete from public.fleets       where faction_id = 'fac_angeltest';
  delete from public.colonies     where faction_id = 'fac_angeltest';
  delete from public.faction_units where faction_id = 'fac_angeltest';
  delete from public.doom_shells  where faction_id = 'fac_angeltest';
  delete from public.mza_ships    where faction_id = 'fac_angeltest';
  delete from public.faction_economy where faction_id = 'fac_angeltest';
  delete from public.faction_applications where faction_id = 'fac_angeltest';

  -- ── подставная держава в первой попавшейся системе
  select id into sysid from public.map_systems order by id limit 1;
  insert into public.faction_applications(faction_id, status, name, color, race, gov,
                                          regime, civ_type, system_id, system_name)
    values ('fac_angeltest', 'approved', 'ПРОБА ПРЕСТОЛА', 'rgba(255,255,255,0.34)',
            'Гуманоиды', 'Империя', 'Деспотичный', 'colony', sysid, 'проба');
  insert into public.faction_economy(faction_id, gc, resources, research)
    values ('fac_angeltest', 5000000, '{}'::jsonb, '[]'::jsonb);
  insert into public.colonies(faction_id, system_id, planet_name, planet_type, cells, planet_pid, is_capital, pop)
    values ('fac_angeltest', sysid, 'проба-1', 'Землеподобные', 6, 999001, true, 500)
    returning id into cid;
  insert into public.colony_buildings(colony_id, faction_id, btype, slots_open)
    values (cid, 'fac_angeltest', 'factory', 2);

  -- ── 1) ВОЗНЕСЕНИЕ
  a := public.angel_ascend('fac_angeltest');
  if not coalesce((a->>'ok')::boolean, false) then
    raise exception 'ПРОВАЛ 1: вознесение — %', a;
  end if;
  if (select count(*) from public.colonies where faction_id='fac_angeltest') <> 1 then
    raise exception 'ПРОВАЛ 1: колоний после вознесения должно остаться ровно 1 (ковчег)';
  end if;
  if (select cells from public.colonies where faction_id='fac_angeltest') <> 20 then
    raise exception 'ПРОВАЛ 1: у ковчега не 20 ячеек';
  end if;
  raise notice '1) вознесение: OK %', a;

  -- ── 2) ЗАПРЕТ ОЖЕРЕЛЬЯ (должен ругнуться)
  begin
    insert into public.colony_buildings(colony_id, faction_id, btype)
      values ((a->>'colony')::uuid, 'fac_angeltest', 'nemesis');
    raise exception 'ПРОВАЛ 2: Ожерелье построилось — запрет не работает';
  exception when others then
    if position('Ожерелье' in SQLERRM) = 0 then raise; end if;
    raise notice '2) запрет Ожерелья: OK';
  end;

  -- ── 3) ТИК ХОЗЯЙСТВА (десятина, арсенал, стройка, рука)
  econ := public.angel_econ_tick();
  if not coalesce((econ->>'ok')::boolean, false) then
    raise exception 'ПРОВАЛ 3: тик хозяйства — %', econ;
  end if;
  raise notice '3) хозяйство: OK %', econ;

  -- ── 4) ТИК ВОЙНЫ (регенерация, поход, огонь)
  tick := public.angel_ai_tick();
  if not coalesce((tick->>'ok')::boolean, false) then
    raise exception 'ПРОВАЛ 4: тик ИИ — %', tick;
  end if;
  raise notice '4) война: OK %', tick;

  -- ── 5) ПЕЧАТИ: сколько залпов Длани реально нужно при подавлении.
  -- Крутим по одному снаряду с шагом, при котором давление не успевает
  -- рассосаться, — это и есть «нормальная кампания».
  loop
    salvos := salvos + 1;
    hit := public._angel_take_salvo('fac_angeltest', 'doom', null);
    if coalesce((hit->>'parried')::boolean, false) then parried := parried + 1;
    else landed := landed + 1; end if;
    exit when coalesce((hit->>'fell')::boolean, false) or salvos > 400;
  end loop;
  select seals into seals from public.angel_state where faction_id='fac_angeltest';
  raise notice '5) печати: залпов всего %, отбито %, попало %, печатей осталось %',
    salvos, parried, landed, seals;
  if landed < 25 or landed > 55 then
    raise warning 'ВНИМАНИЕ: попаданий до слома % — вилка задумывалась 30-45', landed;
  end if;
  if not exists(select 1 from public.angel_state
                 where faction_id='fac_angeltest' and fell_at is not null) then
    raise exception 'ПРОВАЛ 5: печати кончились, а ангел не пал';
  end if;
  if exists(select 1 from public.fleets where faction_id='fac_angeltest') then
    raise exception 'ПРОВАЛ 5: ангел пал, а ковчег остался на карте';
  end if;
  raise notice '5) падение: OK';

  -- ── 6) ЗА СОБОЙ УБРАЛИ
  delete from public.angel_state  where faction_id = 'fac_angeltest';
  delete from public.angel_relic  where faction_id = 'fac_angeltest';
  delete from public.fleets       where faction_id = 'fac_angeltest';
  delete from public.colony_buildings where faction_id = 'fac_angeltest';
  delete from public.colony_projects  where faction_id = 'fac_angeltest';
  delete from public.colonies     where faction_id = 'fac_angeltest';
  delete from public.faction_units where faction_id = 'fac_angeltest';
  delete from public.doom_shells  where faction_id = 'fac_angeltest';
  delete from public.mza_ships    where faction_id = 'fac_angeltest';
  delete from public.war_sides    where fid = 'fac_angeltest';
  delete from public.wars where attacker_fid='fac_angeltest' or defender_fid='fac_angeltest';
  delete from public.faction_economy where faction_id = 'fac_angeltest';
  delete from public.faction_applications where faction_id = 'fac_angeltest';
  raise notice '6) уборка: OK — живых данных не тронуто';
end$$;
