-- ============================================================================
--  ДОМИКИ · ЦЕНТР БЛАГОПОЛУЧИЯ (btype 'wellhub') — метод №1 роста благополучия
--  (см. память wellbeing-growth-methods). 2026-07-23.
--
--  ИДЕЯ. Отдельное здание «Центр благополучия», добавляющее к ИНДЕКСУ
--  благополучия державы (wb) положительный член. У КАЖДОЙ ИДЕОЛОГИИ свой домик,
--  усиливающийся по-своему и НЕ линейно от ресурсов игрока:
--    · Спиритуалисты/Теократия — святилище: питается ОХВАТОМ храмов (_faith_coverage);
--    · Корпораты/Индустриалы    — биржа: ЛОГАРИФМ от казны с жёстким потолком (не линейно);
--    · Пацифисты/Эгалитаристы    — коммуна: щедрый плоский бонус;
--    · остальные                 — базовый административный центр.
--
--  ЛИМИТ (анти-спам): не больше 1 центра на СИСТЕМУ и 5 на державу.
--  УРОВЕНЬ поднимается ТОЛЬКО технологиями (pol.welfare_hub2/3), апгрейда самого
--  здания нет. Постройка гейтится технологией pol.welfare_hub (чтобы не грузить
--  новичков). Итоговый вклад домиков в wb ограничен потолком +0.20.
--
--  ПОРЯДОК ПРИМЕНЕНИЯ:
--    1) этот файл (техи + формулы + лимиты в economy_build — самодостаточно);
--    2) ПЕРЕКАТИТЬ _economy_accrue_consolidated.sql — его голова уже включает
--       член wb_hub в индексе wb и wellbeing_status (guard на undefined_function,
--       так что до наката этого файла экономика работает по-старому).
--  Идемпотентно (create-or-replace / on conflict).
-- ============================================================================

-- ── 1) Технологии: гейт постройки + два уровня усиления ──────────────────────
insert into public.tech_nodes (node_id, base_cost, prereq) values
  ('pol.welfare_hub',  45,  '[]'::jsonb),
  ('pol.welfare_hub2', 90,  '["pol.welfare_hub"]'::jsonb),
  ('pol.welfare_hub3', 160, '["pol.welfare_hub2"]'::jsonb)
on conflict (node_id) do nothing;

-- ── 2) Каталог: btype 'wellhub' (суперсет _ec_bld_base; зеркалит МАРШ-версию
--       в _economy_accrue_consolidated.sql — там та же строка wellhub) ─────────
create or replace function public._ec_bld_base(p_btype text)
returns numeric language sql immutable as $$
  select case p_btype
    when 'factory'          then 500    when 'mining'   then 500
    when 'trade'            then 1000   when 'market'   then 1500
    when 'science'          then 1000   when 'training' then 500
    when 'intel'            then 3000   when 'military_factory' then 1000
    when 'shipyard'         then 2000   when 'warehouse' then 800
    when 'temple'           then 1200
    when 'starbase'         then 5000
    when 'flak'             then 1500
    when 'abm'              then 3000
    when 'goodsfab'         then 1200
    when 'mining_deep'      then 2500
    when 'mining_exotic'    then 8000
    when 'airfield'         then 1200
    when 'wellhub'          then 3000   -- ДОМИК: Центр благополучия
    else null end
$$;

-- ── 3) Уровень домиков от технологий (апгрейд здания невозможен) ─────────────
create or replace function public._wb_hub_level(p_fid text)
returns numeric language sql stable security definer set search_path=public as $$
  select 1.0
    + case when coalesce((select research from public.faction_economy where faction_id = p_fid), '[]'::jsonb) ? 'pol.welfare_hub2' then 0.5 else 0 end
    + case when coalesce((select research from public.faction_economy where faction_id = p_fid), '[]'::jsonb) ? 'pol.welfare_hub3' then 0.5 else 0 end;
$$;
revoke all on function public._wb_hub_level(text) from public;
grant execute on function public._wb_hub_level(text) to authenticated;

-- ── 4) Идеологический вклад ОДНОГО домика (до умножения на уровень/количество) ─
-- Зеркало EC_WB_HUB_UNIT в economy.js. Каждая ветка — «свой домик»:
create or replace function public._wb_hub_unit(p_fid text)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare a public.faction_applications; u numeric := 0.022; cov numeric; gc_v numeric; mf numeric;
begin
  select * into a from public.faction_applications
   where faction_id = p_fid and status = 'approved' order by updated_at desc limit 1;
  if not found then return 0.022; end if;

  if a.ideology = 'Спиритуализм' or a.gov = 'Теократия' then
    -- Святилище: сильнее там, где храмы охватывают народ (0.012..0.042)
    begin cov := public._faith_coverage(p_fid); exception when undefined_function then cov := 0; end;
    u := 0.012 + 0.030 * least(1, greatest(0, coalesce(cov, 0)));
  elsif a.gov = 'Корпоратократия' or a.ideology = 'Индустриализм' then
    -- Биржа: ЛОГАРИФМ от казны, насыщается (не линейно от ресурсов) (0.012..0.036)
    select coalesce(gc, 0) into gc_v from public.faction_economy where faction_id = p_fid;
    mf := least(1.0, ln(1 + greatest(0, gc_v) / 40000.0) / ln(1 + 25));
    u := 0.012 + 0.024 * mf;
  elsif a.ideology = 'Пацифизм' or a.regime = 'Эгалитарный' then
    -- Коммуна: щедрый плоский бонус
    u := 0.032;
  else
    u := 0.022;   -- базовый административный центр
  end if;
  return round(u, 4);
end$$;
revoke all on function public._wb_hub_unit(text) from public;
grant execute on function public._wb_hub_unit(text) to authenticated;

-- ── 5) Суммарный вклад домиков в индекс wb (потолок +0.20) ───────────────────
-- Активным считается домик с открытым слотом (есть рабочие руки).
create or replace function public._wb_hub_bonus(p_fid text)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare n int; lvl numeric; unit numeric;
begin
  select count(*) into n from public.colony_buildings
   where faction_id = p_fid and btype = 'wellhub' and coalesce(slots_open, 0) >= 1;
  if n <= 0 then return 0; end if;
  lvl  := public._wb_hub_level(p_fid);
  unit := public._wb_hub_unit(p_fid);
  return round(least(0.20, n * unit * lvl), 3);
end$$;
revoke all on function public._wb_hub_bonus(text) from public;
grant execute on function public._wb_hub_bonus(text) to authenticated;

-- ── 6) economy_build: суперсет _faith_multi.sql + гейт/лимит для wellhub ──────
create or replace function public.economy_build(p_colony_id uuid, p_btype text, p_faith_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies; base numeric; cost numeric;
  used int; pending int;
begin
  fid := public._ec_my_fid();
  if public._ec_bld_base(p_btype) is null then raise exception 'bad btype'; end if;
  -- МУЛЬТИ: храм можно строить только исповедуя веру; метка = выбранная вера
  if p_btype = 'temple' then
    if not exists(select 1 from public.faith_membership where faction_id = fid) then
      raise exception 'no faith: found or join a faith before building a temple';
    end if;
    if p_faith_id is null then
      select faith_id into p_faith_id from public.faith_membership
        where faction_id = fid order by (role = 'founder') desc, joined_at asc limit 1;
    elsif not public._faith_member(fid, p_faith_id) then
      raise exception 'you do not follow that faith';
    end if;
  else
    p_faith_id := null;
  end if;
  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if col.faction_id is distinct from fid then raise exception 'not your colony'; end if;

  -- ДОМИК: Центр благополучия — гейт технологией + лимит 1/система, 5/держава.
  if p_btype = 'wellhub' then
    if not (select coalesce(research, '[]'::jsonb) ? 'pol.welfare_hub'
            from public.faction_economy where faction_id = fid) then
      raise exception 'нужна технология «Центр благополучия»';
    end if;
    if (select count(*) from public.colony_buildings cb
          join public.colonies c on c.id = cb.colony_id
          where c.faction_id = fid and c.system_id is not distinct from col.system_id and cb.btype = 'wellhub')
     + (select count(*) from public.colony_projects pr
          join public.colonies c on c.id = pr.colony_id
          where pr.kind = 'build' and pr.btype = 'wellhub'
            and c.faction_id = fid and c.system_id is not distinct from col.system_id) >= 1 then
      raise exception 'В этой системе уже есть Центр благополучия (лимит 1 на систему)';
    end if;
    if (select count(*) from public.colony_buildings where faction_id = fid and btype = 'wellhub')
     + (select count(*) from public.colony_projects where faction_id = fid and kind = 'build' and btype = 'wellhub') >= 5 then
      raise exception 'Достигнут лимит Центров благополучия в державе (5)';
    end if;
  end if;

  select count(*) into used    from public.colony_buildings where colony_id = p_colony_id;
  select count(*) into pending from public.colony_projects
    where colony_id = p_colony_id and kind = 'build';
  if used + pending >= coalesce(col.cells, 6) then raise exception 'no free cells'; end if;

  base := public._ec_bld_base(p_btype);
  cost := public._ec_build_cost(fid, base);

  update public.faction_economy set gc = gc - cost
    where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects
    (faction_id, owner_id, kind, btype, colony_id, payload, label, ready_at)
  values
    (fid, auth.uid(), 'build', p_btype, p_colony_id,
     jsonb_build_object('spent_gc', cost, 'spent_science', 0, 'btype', p_btype,
                        'free_slots', public._ec_bld_free(p_btype),
                        'faith_id', p_faith_id),
     'Постройка', now() + interval '1 day');

  return jsonb_build_object('ok', true, 'cost', cost);
end$$;
revoke all on function public.economy_build(uuid,text,uuid) from public;
grant execute on function public.economy_build(uuid,text,uuid) to authenticated;

notify pgrst, 'reload schema';

-- ── Проверка после применения ───────────────────────────────────────────────
-- 1) select public._wb_hub_unit('<fid>'), public._wb_hub_level('<fid>');
-- 2) изучить pol.welfare_hub → select public.economy_build('<colony uuid>', 'wellhub');
-- 3) второй в той же системе → ИСКЛЮЧЕНИЕ «лимит 1 на систему»
-- 4) select public.wellbeing_status();   -- ключи hub / hub_n / hub_level / wb
