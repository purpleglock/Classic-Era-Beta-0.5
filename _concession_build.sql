-- ════════════════════════════════════════════════════════════════════════════
--  КОНЦЕССИИ v5 · «корпоративные концессии» · 2026-07-12
--  Концессия = механика КОРПОРАЦИЙ: строить добывающие домики на чужой колонии
--  может только держава, у которой есть корпорация (_exchange_corps.sql).
--  Правило «1 концессия = 1 домик» УБРАНО. Вместо него — СЛОТЫ КОНЦЕССИОНЕРА
--  на колонию (независимо от числа концессий, лишь бы была хоть одна живая):
--    · 1 домик БЕСПЛАТНО «вне ячеек» планеты (идёт с концессией);
--    · +1 слот корпорация ДОКУПАЕТ за 2500 ГС (тоже вне ячеек, деньги сгорают);
--    · +2 слота корпорация ВЫКУПАЕТ у владельца колонии: разовая выплата
--      4000 ГС владельцу + аренда 150 ГС/сут владельцу (пока слот жив).
--  Итого максимум 4 добывающих домика концессионера на колонию.
--
--  «Вне ячеек» реализовано ВИРТУАЛЬНЫМИ ЯЧЕЙКАМИ: каждый концессионный
--  недострой/домик даёт колонии +1 cells (триггеры ниже), поэтому владельцу
--  НИЧЕГО не трогаем в economy_build/accrue — его проверки used+pending>=cells
--  сходятся сами. Побочка: pop-потолок владельца слегка растёт (+100/домик) —
--  считаем это платой за соседство.
--
--  Домики метятся colony_buildings.conc (uuid концессии) — их можно добавлять
--  в корпорацию (corp_building_set пропускает: faction_id = концессионер), и
--  они дают дивиденды (ставки mining в _corp_daily_gross, _exchange_corps.sql).
--
--  Стройка — через очередь colony_projects (+1 день), недострои занимают слот.
--  Аренда списывается лениво (_concession_rent_sync, d≤3, хвост сгорает) при
--  любом концессионном RPC и в _apply_colony_projects (т.е. на каждом заходе).
--
--  ЗАВИСИМОСТИ (катить строго ПОСЛЕ): _budget_wellbeing.sql (перекаченный,
--  accrue v8 с концессионной добычей), _exchange_corps.sql (таблица
--  corporations!), _res_flows (mining_concessions), хелперы _ec_bld_base/
--  _ec_build_cost/_ec_bld_free/_mine_tier_ok/_ec_my_fid. Идемпотентно.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Метка концессионного домика ──
alter table public.colony_buildings add column if not exists conc uuid;

-- ── Купленные слоты концессионера на колонии ──
create table if not exists public.concession_slots (
  id         uuid primary key default gen_random_uuid(),
  colony_id  uuid not null references public.colonies(id) on delete cascade,
  fid        text not null,                    -- концессионер
  kind       text not null check (kind in ('extra','lease')),  -- extra=вне ячеек, lease=выкуплен у владельца
  paid       numeric not null default 0,       -- разовая выплата (lease → владельцу)
  rent       numeric not null default 0,       -- аренда/сут владельцу (только lease)
  last_rent  timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists concslot_col on public.concession_slots(colony_id);
create index if not exists concslot_fid on public.concession_slots(fid);
alter table public.concession_slots enable row level security;
drop policy if exists concslot_read on public.concession_slots;
create policy concslot_read on public.concession_slots for select to authenticated
  using (fid = public._ec_my_fid()
         or exists (select 1 from public.colonies c
                    where c.id = colony_id and c.faction_id = public._ec_my_fid()));

-- ── ВИРТУАЛЬНЫЕ ЯЧЕЙКИ: концессионные недострои и домики компенсируют cells ──
create or replace function public._conc_cells_shift()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'INSERT' then
    if (tg_table_name = 'colony_buildings' and new.conc is not null)
       or (tg_table_name = 'colony_projects' and nullif(new.payload->>'conc','') is not null) then
      update public.colonies set cells = coalesce(cells,6) + 1
        where id = new.colony_id;
    end if;
    return new;
  else
    if (tg_table_name = 'colony_buildings' and old.conc is not null)
       or (tg_table_name = 'colony_projects' and nullif(old.payload->>'conc','') is not null) then
      update public.colonies set cells = greatest(1, coalesce(cells,6) - 1)
        where id = old.colony_id;
    end if;
    return old;
  end if;
end$$;
drop trigger if exists trg_conc_cells_bld on public.colony_buildings;
create trigger trg_conc_cells_bld
  after insert or delete on public.colony_buildings
  for each row execute function public._conc_cells_shift();
drop trigger if exists trg_conc_cells_prj on public.colony_projects;
create trigger trg_conc_cells_prj
  after insert or delete on public.colony_projects
  for each row execute function public._conc_cells_shift();

-- ── Потолок домиков концессионера на колонии: 1 бесплатный + купленные слоты ──
create or replace function public._conc_cap(p_colony uuid, p_fid text)
returns int language sql stable as $$
  select case when exists (select 1 from public.mining_concessions
                           where colony_id = p_colony and to_fid = p_fid)
              then 1 else 0 end
       + (select count(*)::int from public.concession_slots
          where colony_id = p_colony and fid = p_fid)
$$;

-- ── Ленивая аренда: списать с концессионеров, начислить владельцам (d≤3) ──
create or replace function public._concession_rent_sync()
returns void language plpgsql security definer set search_path=public as $$
declare L record; d int; owner text; amt numeric;
begin
  for L in select * from public.concession_slots
           where kind = 'lease' and rent > 0
             and last_rent < now() - interval '1 day'
           for update skip locked
  loop
    d := least(floor(extract(epoch from now() - L.last_rent) / 86400)::int, 3);
    if d < 1 then continue; end if;
    select faction_id into owner from public.colonies where id = L.colony_id;
    amt := round(L.rent * d);
    update public.faction_economy set gc = gc - amt where faction_id = L.fid;
    if owner is not null then
      update public.faction_economy set gc = gc + amt where faction_id = owner;
    end if;
    -- хвост сверх капа сгорает (политика accrue)
    update public.concession_slots set last_rent = now() where id = L.id;
  end loop;
end$$;
revoke all on function public._concession_rent_sync() from public;

-- ── Покупка слота: extra (2500 ГС, сгорают) / lease (4000 ГС владельцу + аренда) ──
create or replace function public.concession_slot_buy(p_colony uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; owner text; n int; price numeric; rent numeric := 0;
begin
  perform public._concession_rent_sync();
  me := public._ec_my_fid();
  if p_kind not in ('extra','lease') then raise exception 'bad kind'; end if;
  if not exists (select 1 from public.corporations where faction_id = me) then
    raise exception 'no corporation: концессии — механика корпораций, сначала учредите организацию на бирже';
  end if;
  if not exists (select 1 from public.mining_concessions where colony_id = p_colony and to_fid = me) then
    raise exception 'no concession: на этой колонии вам не передано право добычи';
  end if;
  select faction_id into owner from public.colonies where id = p_colony;
  if owner is null then raise exception 'colony not found'; end if;

  select count(*) into n from public.concession_slots s
    where s.colony_id = p_colony and s.fid = me and s.kind = p_kind;
  if p_kind = 'extra' and n >= 1 then raise exception 'limit: корпорация может докупить только 1 слот вне ячеек'; end if;
  if p_kind = 'lease' and n >= 2 then raise exception 'limit: у владельца можно выкупить максимум 2 слота'; end if;

  price := case p_kind when 'extra' then 2500 else 4000 end;
  update public.faction_economy set gc = gc - price where faction_id = me and gc >= price;
  if not found then raise exception 'not enough GC'; end if;
  if p_kind = 'lease' then
    rent := 150;
    update public.faction_economy set gc = gc + price where faction_id = owner;  -- разовая выплата владельцу
  end if;
  insert into public.concession_slots(colony_id, fid, kind, paid, rent)
    values (p_colony, me, p_kind, price, rent);
  return jsonb_build_object('ok', true, 'kind', p_kind, 'price', price, 'rent', rent);
end$$;
revoke all on function public.concession_slot_buy(uuid,text) from public, anon;
grant execute on function public.concession_slot_buy(uuid,text) to authenticated;

-- ── Постройка добывающего домика на колонии-концеденте (очередь, +1 день) ──
create or replace function public.concession_build(p_conc uuid, p_btype text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; mc public.mining_concessions; col public.colonies;
  rr text; base numeric; cost numeric; my_bld int; my_pend int; cap int;
begin
  perform public._concession_rent_sync();
  fid := public._ec_my_fid();
  select * into mc from public.mining_concessions where id = p_conc;
  if not found or mc.to_fid is distinct from fid then raise exception 'concession not found'; end if;
  if p_btype not in ('mining','mining_deep','mining_exotic') then
    raise exception 'bad btype: по концессии строятся только добывающие здания';
  end if;
  if not exists (select 1 from public.corporations where faction_id = fid) then
    raise exception 'no corporation: концессии — механика корпораций, сначала учредите организацию на бирже';
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

  -- потолок концессионера: 1 бесплатный + купленные слоты (extra/lease);
  -- считаем ВСЕ мои домики и недострои на этой (чужой) колонии
  select count(*) into my_bld from public.colony_buildings
    where colony_id = mc.colony_id and faction_id = fid;
  select count(*) into my_pend from public.colony_projects
    where colony_id = mc.colony_id and faction_id = fid and kind = 'build';
  cap := public._conc_cap(mc.colony_id, fid);
  if my_bld + my_pend >= cap then
    raise exception 'no concession slots: домиков %/% — докупите слот корпорации или выкупите слот у владельца', my_bld + my_pend, cap;
  end if;

  base := public._ec_bld_base(p_btype);
  cost := public._ec_build_cost(fid, base);
  update public.faction_economy set gc = gc - cost where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects
    (faction_id, owner_id, kind, btype, colony_id, payload, label, ready_at)
  values
    (fid, auth.uid(), 'build', p_btype, mc.colony_id,
     jsonb_build_object('spent_gc', cost, 'spent_science', 0, 'btype', p_btype,
                        'free_slots', public._ec_bld_free(p_btype),
                        'conc', mc.id),                         -- метка концессионной стройки
     'Постройка (концессия)', now() + interval '1 day');
  return jsonb_build_object('ok', true, 'cost', cost);
end$$;
revoke all on function public.concession_build(uuid,text) from public, anon;
grant execute on function public.concession_build(uuid,text) to authenticated;

-- ── _apply_colony_projects: build-ветка достраивает КОНЦЕССИОННЫЕ домики
--    на чужой колонии (payload->>'conc'). База: _apply_projects_orphan_fix.sql
--    (проверка живой колонии) + _faith_multi.sql (перенос faith_id).
--    Если концессию отозвали, пока домик строился, — возврат ½ потраченного.
create or replace function public._apply_colony_projects(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare pr record; v_conc uuid; v_ok boolean;
begin
  perform public._concession_rent_sync();
  for pr in select * from public.colony_projects
            where faction_id = p_fid and ready_at <= now()
            order by ready_at asc
  loop
    if pr.kind = 'build' then
      v_conc := nullif(pr.payload->>'conc','')::uuid;
      if v_conc is not null then
        -- КОНЦЕССИЯ: колония жива и право всё ещё за строителем
        v_ok := exists (select 1 from public.mining_concessions mc
                        join public.colonies c on c.id = mc.colony_id
                        where mc.id = v_conc and mc.to_fid = p_fid
                          and mc.colony_id = pr.colony_id);
        if v_ok then
          insert into public.colony_buildings (colony_id, faction_id, owner_id, btype, slots_open, tnp_mode, conc)
            values (pr.colony_id, p_fid, pr.owner_id, pr.btype,
                    coalesce((pr.payload->>'free_slots')::int, 1), false, v_conc);
        else
          update public.faction_economy
            set gc = gc + round(coalesce((pr.payload->>'spent_gc')::numeric,
                                          public._ec_bld_base(pr.btype), 0) / 2.0)
            where faction_id = p_fid;
        end if;
      elsif exists (select 1 from public.colonies c
                    where c.id = pr.colony_id and c.faction_id = p_fid) then
        insert into public.colony_buildings (colony_id, faction_id, owner_id, btype, slots_open, tnp_mode, faith_id)
          values (pr.colony_id, p_fid, pr.owner_id, pr.btype,
                  coalesce((pr.payload->>'free_slots')::int, 1), false,
                  nullif(pr.payload->>'faith_id','')::uuid);     -- МУЛЬТИ: метка веры храма
      end if;
    elsif pr.kind = 'slot' then
      update public.colony_buildings set slots_open = least(6, slots_open + 1)
        where id = pr.building_id and faction_id = p_fid;
    elsif pr.kind = 'habitat' then
      update public.colonies set cells = cells + coalesce(pr.cells, 3), terraformed = true
        where id = pr.colony_id and faction_id = p_fid;
    elsif pr.kind = 'terraform' then
      if not exists (select 1 from public.colonies c
                     where c.faction_id = p_fid
                       and c.system_id is not distinct from pr.system_id
                       and (case when pr.planet_pid is not null
                                 then c.planet_pid = pr.planet_pid
                                 else c.planet_name = pr.planet_name end)) then
        insert into public.colonies (faction_id, owner_id, system_id, planet_name, planet_pid, planet_type, cells, terraformed, resources)
          values (p_fid, pr.owner_id, pr.system_id, pr.planet_name, pr.planet_pid, pr.planet_type,
                  coalesce(nullif(pr.cells, 0), 6), true, coalesce(pr.payload->'resources', '[]'::jsonb));
      end if;
    end if;
    delete from public.colony_projects where id = pr.id;
  end loop;
end$$;
revoke all on function public._apply_colony_projects(text) from public;

-- ── Отзыв/отказ: снести домики получателя, оставшиеся без права (½ базы назад).
--    Если у получателя не осталось НИ ОДНОЙ концессии на колонии — сносится всё
--    его хозяйство там, купленные слоты сгорают (разовая выплата не возвращается).
create or replace function public.concession_revoke(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; mc public.mining_concessions; b record; refunded int := 0; any_left boolean;
begin
  perform public._concession_rent_sync();
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
      delete from public.corp_buildings where building_id = b.id;   -- вынуть из корпорации перед сносом
      delete from public.colony_buildings where id = b.id;
      refunded := refunded + 1;
    end if;
  end loop;

  -- недострои получателя в очереди: те же правила — без покрытия хоть одной
  -- оставшейся концессией отменяем с возвратом ½ потраченного
  for b in select pr.* from public.colony_projects pr
           where pr.colony_id = mc.colony_id and pr.faction_id = mc.to_fid
             and pr.kind = 'build' and pr.btype in ('mining','mining_deep','mining_exotic')
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
      update public.faction_economy
        set gc = gc + round(coalesce((b.payload->>'spent_gc')::numeric, public._ec_bld_base(b.btype), 0) / 2.0)
        where faction_id = b.faction_id;
      delete from public.colony_projects where id = b.id;
      refunded := refunded + 1;
    end if;
  end loop;

  -- не осталось ни одной концессии этому получателю → купленные слоты сгорают
  select exists(select 1 from public.mining_concessions
                where colony_id = mc.colony_id and to_fid = mc.to_fid) into any_left;
  if not any_left then
    delete from public.concession_slots where colony_id = mc.colony_id and fid = mc.to_fid;
  end if;
  return jsonb_build_object('ok', true, 'demolished', refunded);
end$$;
revoke all on function public.concession_revoke(uuid) from public, anon;
grant execute on function public.concession_revoke(uuid) to authenticated;
