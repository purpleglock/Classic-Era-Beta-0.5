-- ============================================================
-- РАБСТВО И РЫНОК СИНЛИ-БЕЙ.
-- Применять в Supabase → SQL Editor ПОСЛЕ:
--   • цепочки флотов/границ (_army_fleet → _fleet_ops → _borders_closed) и
--     _fleet_raid.sql (рейд по караванам);
--   • _budget_wellbeing.sql / _economy_accrue_consolidated.sql (даёт colonies.pop).
-- Самодостаточно: НЕ переписывает economy_accrue. Доход рабского труда начисляется
-- отдельной функцией slaves_tick(), которую клиент зовёт рядом с economy_accrue.
-- Идемпотентно (create table if not exists / create or replace).
--
-- ПРАВИЛА:
--   • «Просвещённые» державы (regime ∈ {Демократический, Эгалитарный} ИЛИ
--     ideology ∈ {Пацифизм, Ксенофилия}) НЕ могут рейдить, держать/торговать
--     рабами и заходить в Синли-бей.
--   • Рейд флотом по чужой КОЛОНИИ (флот idle в её системе) — единственная проверка
--     заметили/нет; успех → часть населения угоняется в рабство (origin = держава
--     колонии).
--   • Рабы = рабочие без благополучия: дают владельцу доход ГС/тик, БЕЗ упкипа и
--     без влияния на благополучие.
--   • Синли-бей — общий рынок: раз в неделю появляются NPC-лоты рабов случайной
--     державы; игроки тоже выставляют своих. У лота ВИДНО происхождение рабов, но
--     НЕ видно продавца. Выкуп рабов СВОЕЙ державы → они снова становятся населением.
--   • Тайная операция «Похищение рабов» — агентами угнать часть рабов чужой державы
--     себе (происхождение сохраняется).
-- ============================================================

-- ── Схема ────────────────────────────────────────────────────
alter table public.faction_economy add column if not exists slave_tick timestamptz;

create table if not exists public.faction_slaves (
  id         uuid primary key default gen_random_uuid(),
  owner_fid  text not null,                 -- кто владеет
  origin_fid text not null,                 -- чьи это были люди (сохраняется при перепродаже)
  count      numeric not null default 0,
  updated_at timestamptz default now(),
  unique(owner_fid, origin_fid)
);
create index if not exists faction_slaves_owner_idx on public.faction_slaves(owner_fid);
alter table public.faction_slaves enable row level security;
-- читать может кто угодно свои строки; запись — только через RPC (definer)
drop policy if exists faction_slaves_read on public.faction_slaves;
create policy faction_slaves_read on public.faction_slaves for select using (true);

create table if not exists public.sinli_lots (
  id         uuid primary key default gen_random_uuid(),
  origin_fid text not null,                 -- происхождение рабов (видно всем)
  seller_fid text,                          -- продавец (СКРЫТ в UI); null = NPC-лот
  count      numeric not null,
  price      numeric not null,              -- цена за одного раба
  kind       text not null default 'npc',   -- 'npc' | 'player'
  created_at timestamptz default now()
);
create index if not exists sinli_lots_kind_idx on public.sinli_lots(kind);
alter table public.sinli_lots enable row level security;
drop policy if exists sinli_lots_read on public.sinli_lots;
create policy sinli_lots_read on public.sinli_lots for select using (true);

-- маркер последнего недельного завоза NPC-рабов (site_settings)
create table if not exists public.site_settings (key text primary key, value text);

-- ── Хелперы ──────────────────────────────────────────────────
-- «Просвещённая» держава: гуманный уклон закрывает рабство целиком.
create or replace function public._faction_enlightened(p_fid text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare a public.faction_applications;
begin
  select * into a from public.faction_applications
    where faction_id=p_fid and status='approved' order by updated_at desc limit 1;
  if not found then return false; end if;
  return a.regime in ('Демократический','Эгалитарный')
      or a.ideology in ('Пацифизм','Ксенофилия');
end$$;
revoke all on function public._faction_enlightened(text) from public;
grant execute on function public._faction_enlightened(text) to authenticated;

-- добавить рабов владельцу (upsert по происхождению)
create or replace function public._slaves_add(p_owner text, p_origin text, p_n numeric)
returns void language plpgsql security definer set search_path=public as $$
begin
  if coalesce(p_n,0) <= 0 then return; end if;
  insert into public.faction_slaves(owner_fid, origin_fid, count, updated_at)
    values(p_owner, p_origin, p_n, now())
    on conflict (owner_fid, origin_fid)
    do update set count = public.faction_slaves.count + p_n, updated_at=now();
end$$;
revoke all on function public._slaves_add(text,text,numeric) from public;

-- снять N рабов ЛЮБОГО происхождения у владельца, вернуть карту {origin: taken}
create or replace function public._slaves_take_any(p_owner text, p_n numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; rem numeric; take numeric; out jsonb := '{}'::jsonb;
begin
  rem := greatest(0, coalesce(p_n,0));
  for r in select id, origin_fid, count from public.faction_slaves
           where owner_fid=p_owner and count>0 order by count desc loop
    exit when rem <= 0;
    take := least(rem, r.count);
    update public.faction_slaves set count=count-take, updated_at=now() where id=r.id;
    out := jsonb_set(out, array[r.origin_fid], to_jsonb(coalesce((out->>r.origin_fid)::numeric,0)+take), true);
    rem := rem - take;
  end loop;
  delete from public.faction_slaves where owner_fid=p_owner and count<=0;
  return out;
end$$;
revoke all on function public._slaves_take_any(text,numeric) from public;

-- ── РАБЫ = РАБОЧИЕ (без благополучия) ───────────────────────
-- Ключевая интеграция: рабы вливаются в ПУЛ РАБОЧИХ державы (_resource_rework.sql),
-- поэтому копают залежи РОВНО как обычные рабочие (их распределяет _worker_alloc),
-- но при этом НЕ являются населением и не требуют благополучия/упкипа.
-- Переопределяем _fac_workers: население×доля(снабжение) + всего рабов-владельца.
-- ⚠ Должно применяться ПОСЛЕ _resource_rework.sql (иначе перекроется его версией —
--   тогда просто перекатить этот блок последним).
create or replace function public._fac_workers(p_fid text)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare b public.faction_budget; lvl int; base numeric; slaves numeric;
begin
  b := public._budget_row(p_fid);
  lvl := coalesce(b.industry_eff, b.industry);
  base := floor(public._fac_pop(p_fid) * public._worker_share(lvl));
  select coalesce(sum(count),0) into slaves from public.faction_slaves where owner_fid=p_fid;
  return base + coalesce(slaves,0);
end$$;
revoke all on function public._fac_workers(text) from public;

-- Отчётный RPC для клиента (рабов больше не «доят» в ГС — они уже работают как
-- рабочие). Держим совместимость: возвращает счёт, gc=0.
create or replace function public.slaves_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; total numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select coalesce(sum(count),0) into total from public.faction_slaves where owner_fid=fid;
  return jsonb_build_object('gc',0,'slaves',total);
end$$;
revoke all on function public.slaves_tick() from public;
grant execute on function public.slaves_tick() to authenticated;

-- ── Рейд флотом по колонии: угон населения в рабство ─────────
-- Флот (idle) стоит В СИСТЕМЕ чужой колонии → единственная проверка заметили/нет.
-- НЕ заметили → угон % населения в рабов (origin=держава колонии). Заметили → 0,
-- отношения−, новость с именем атакующего. Боя/потерь кораблей нет.
create or replace function public.fleet_raid_colony(p_fleet_id text, p_colony_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; fl public.fleets; col public.colonies; ships int; pop numeric;
  garr int; det_chance int; v_detected boolean; abduct numeric;
  ABDUCT_FRAC constant numeric := 0.06;   -- доля населения за успешный налёт
  ABDUCT_CAP  constant numeric := 600;    -- потолок угона за раз
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if public._faction_enlightened(fid) then raise exception 'enlightened factions cannot raid'; end if;

  select * into fl from public.fleets where id=p_fleet_id::uuid and faction_id=fid for update;
  if fl.id is null then raise exception 'no such fleet'; end if;
  if fl.status <> 'idle' or fl.system_id is null then raise exception 'fleet must be idle in a system'; end if;
  if fl.raid_cd_until is not null and fl.raid_cd_until > now() then raise exception 'fleet on cooldown'; end if;

  select * into col from public.colonies where id=p_colony_id::uuid for update;
  if col.id is null then raise exception 'no such colony'; end if;
  if col.faction_id = fid then raise exception 'cannot raid your own colony'; end if;
  if col.system_id is distinct from fl.system_id then raise exception 'fleet is not in the colony system'; end if;

  ships := (select coalesce(sum((c->>'qty')::int),0) from jsonb_array_elements(fl.composition) c);
  if ships < 1 then raise exception 'empty fleet'; end if;

  pop := coalesce(col.pop, coalesce(col.cells,0)*50);
  -- «гарнизон/оборона» цели: число построек на колонии как прокси
  select count(*) into garr from public.colony_buildings where colony_id=col.id;

  -- ЕДИНСТВЕННАЯ ПРОВЕРКА: заметили или нет. Оборона и размер населения повышают
  -- шанс детекта, крупный флот — тоже; границы 10..90%.
  det_chance := least(90, greatest(10, 25 + garr*4 + floor(pop/4000)::int + ships));
  v_detected := (random()*100) < det_chance;

  abduct := 0;
  if not v_detected then
    abduct := least(ABDUCT_CAP, floor(pop * ABDUCT_FRAC));
    abduct := least(abduct, greatest(0, pop - 1));   -- колонию не обнуляем
    if abduct > 0 then
      update public.colonies set pop = greatest(1, coalesce(pop, coalesce(cells,0)*50) - abduct) where id=col.id;
      perform public._slaves_add(fid, col.faction_id, abduct);
    end if;
  else
    insert into public.faction_relations(from_fid, to_fid, score, updated_at)
      values(col.faction_id, fid, -20, now())
      on conflict (from_fid, to_fid)
      do update set score = greatest(-100, public.faction_relations.score - 20), updated_at=now();
  end if;

  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, published_at, created_at, updated_at)
    values(col.faction_id, '⛓ РАБОТОРГОВЛЯ', 'rgba(160,60,60,0.55)', null, null,
      case when v_detected then 'Налёт работорговцев отбит' else 'Угон населения' end, null,
      case when v_detected then
        format('Флот державы «%s» пытался угнать жителей колонии «%s», но гарнизон вовремя поднял тревогу. Похищений нет.',
          public._fac_name(fid), coalesce(col.planet_name,'колония'))
      else
        format('Колония «%s» подверглась налёту неизвестных работорговцев — угнано %s жителей.',
          coalesce(col.planet_name,'колония'), abduct::text)
      end,
      'approved', now(), now(), now());

  update public.fleets set raid_cd_until = now() + interval '3 hours' where id=fl.id;
  return jsonb_build_object('detected', v_detected, 'abducted', abduct,
    'colony', coalesce(col.planet_name,'колония'), 'origin_name', public._fac_name(col.faction_id));
end$$;
revoke all on function public.fleet_raid_colony(text,text) from public;
grant execute on function public.fleet_raid_colony(text,text) to authenticated;

-- ── Тайная операция: похищение рабов чужой державы ──────────
-- Мгновенный covert-RPC (не через очередь _spy_resolve). Успех зависит от числа
-- агентов; при успехе угоняем часть рабов цели себе (происхождение сохраняется).
create or replace function public.spy_steal_slaves(p_target_fid text, p_agents int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; ag int; succ_ch int; ok boolean; tgt_total numeric; steal numeric;
  r record; rem numeric; take numeric; moved numeric := 0; detected boolean;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if public._faction_enlightened(fid) then raise exception 'enlightened factions cannot enslave'; end if;
  if p_target_fid = fid then raise exception 'cannot target yourself'; end if;
  ag := greatest(1, coalesce(p_agents,1));

  -- требуем ≥ag готовых агентов (ready_at<=now и не заняты активной операцией);
  -- операция мгновенная, агентов не «съедает».
  if (select count(*) from public.spy_agents ag2
        where ag2.faction_id=fid and ag2.ready_at<=now()
          and not exists(select 1 from public.spy_missions sm
                         where sm.actor_fid=fid and sm.status='active' and sm.agent_ids ? ag2.id::text)) < ag then
    raise exception 'not enough ready agents';
  end if;

  select coalesce(sum(count),0) into tgt_total from public.faction_slaves where owner_fid=p_target_fid;
  if tgt_total < 1 then raise exception 'target has no slaves'; end if;

  succ_ch := least(90, 30 + ag*12);
  ok := (random()*100) < succ_ch;
  detected := (random()*100) < 45;

  if ok then
    steal := least(tgt_total, greatest(1, floor(tgt_total * (0.15 + ag*0.05))));
    rem := steal;
    for r in select id, origin_fid, count from public.faction_slaves
             where owner_fid=p_target_fid and count>0 order by count desc loop
      exit when rem <= 0;
      take := least(rem, r.count);
      update public.faction_slaves set count=count-take, updated_at=now() where id=r.id;
      perform public._slaves_add(fid, r.origin_fid, take);
      moved := moved + take; rem := rem - take;
    end loop;
    delete from public.faction_slaves where owner_fid=p_target_fid and count<=0;
  end if;

  if detected then
    insert into public.faction_relations(from_fid, to_fid, score, updated_at)
      values(p_target_fid, fid, -15, now())
      on conflict (from_fid, to_fid)
      do update set score = greatest(-100, public.faction_relations.score - 15), updated_at=now();
  end if;

  -- новость цели (при удаче/раскрытии)
  if ok or detected then
    insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
        title, excerpt, body, status, published_at, created_at, updated_at)
      values(p_target_fid, '⛓ РАБОТОРГОВЛЯ', 'rgba(160,60,60,0.55)', null, null,
        'Рабов увели из-под стражи', null,
        format('Из невольничьих бараков державы «%s» %s. %s',
          public._fac_name(p_target_fid),
          case when ok then 'исчезло '||moved::text||' рабов' else 'сорвалась попытка похищения рабов' end,
          case when detected then 'Замечен почерк агентов державы «'||public._fac_name(fid)||'».' else 'Виновных установить не удалось.' end),
        'approved', now(), now(), now());
  end if;

  return jsonb_build_object('ok', ok, 'stolen', moved, 'detected', detected, 'chance', succ_ch);
end$$;
revoke all on function public.spy_steal_slaves(text,int) from public;
grant execute on function public.spy_steal_slaves(text,int) to authenticated;

-- ── СИНЛИ-БЕЙ: недельный завоз NPC-рабов ────────────────────
create or replace function public._sinli_restock()
returns void language plpgsql security definer set search_path=public as $$
declare last_ts timestamptz; f record; cnt numeric; pr numeric;
begin
  select value::timestamptz into last_ts from public.site_settings where key='sinli_restock_at';
  if last_ts is not null and last_ts > now() - interval '7 days' then return; end if;
  -- убрать прошлые NPC-лоты, завезти новые от 1–3 случайных держав
  delete from public.sinli_lots where kind='npc';
  for f in select faction_id from public.faction_applications where status='approved'
           order by random() limit (1 + floor(random()*3)::int) loop
    cnt := 80 + floor(random()*320);       -- 80..400 рабов
    pr  := 500 + floor(random()*1000);     -- 500..1500 ГС/раб
    insert into public.sinli_lots(origin_fid, seller_fid, count, price, kind)
      values(f.faction_id, null, cnt, pr, 'npc');
  end loop;
  -- upsert без ON CONFLICT: у существующей site_settings может не быть уникального
  -- ключа под key → on conflict падал и валил весь sinli_get («Ряды заперты»).
  if exists(select 1 from public.site_settings where key='sinli_restock_at') then
    update public.site_settings set value=now()::text where key='sinli_restock_at';
  else
    insert into public.site_settings(key,value) values('sinli_restock_at', now()::text);
  end if;
end$$;
revoke all on function public._sinli_restock() from public;

-- витрина рынка + мои рабы + баланс + флаг просвещённости
create or replace function public.sinli_get()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; enl boolean; lots jsonb; mine jsonb; bal numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  enl := public._faction_enlightened(fid);
  perform public._sinli_restock();
  -- лоты: происхождение видно, продавец СКРЫТ
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'origin_fid', origin_fid, 'origin_name', public._fac_name(origin_fid),
           'count', count, 'price', price, 'kind', kind,
           'mine_origin', (origin_fid = fid)
         ) order by created_at desc), '[]'::jsonb)
    into lots from public.sinli_lots where count > 0;
  select coalesce(jsonb_agg(jsonb_build_object(
           'origin_fid', origin_fid, 'origin_name', public._fac_name(origin_fid), 'count', count
         ) order by count desc), '[]'::jsonb)
    into mine from public.faction_slaves where owner_fid=fid and count>0;
  select coalesce(fe.gc,0) into bal from public.faction_economy fe where fe.faction_id=fid;
  return jsonb_build_object('enlightened', enl, 'lots', lots, 'mine', mine, 'gc', bal);
end$$;
revoke all on function public.sinli_get() from public;
grant execute on function public.sinli_get() to authenticated;

-- купить рабов из лота. Если происхождение = МОЯ держава → выкуп: становятся снова
-- населением (подсаживаются в мою самую малую колонию). Иначе → мои рабы.
create or replace function public.sinli_buy(p_lot_id text, p_count numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; lot public.sinli_lots; n numeric; cost numeric; bal numeric; freed boolean := false; col_id uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if public._faction_enlightened(fid) then raise exception 'enlightened factions cannot use the slave market'; end if;

  select * into lot from public.sinli_lots where id=p_lot_id::uuid for update;
  if lot.id is null then raise exception 'lot gone'; end if;
  n := greatest(1, least(coalesce(p_count, lot.count), lot.count));
  cost := round(n * lot.price);
  select coalesce(fe.gc,0) into bal from public.faction_economy fe where fe.faction_id=fid;
  if bal < cost then raise exception 'not enough gc'; end if;

  -- оплата: списываем у покупателя; лот игрока → деньги продавцу (скрытому)
  update public.faction_economy set gc = faction_economy.gc - cost where faction_id=fid;
  if lot.kind='player' and lot.seller_fid is not null and lot.seller_fid <> fid then
    update public.faction_economy set gc = gc + cost where faction_id=lot.seller_fid;
  end if;

  -- уменьшаем/закрываем лот
  update public.sinli_lots set count = count - n where id=lot.id;
  delete from public.sinli_lots where id=lot.id and count<=0;

  if lot.origin_fid = fid then
    -- ВЫКУП СВОИХ: снова население, подсаживаем в наименьшую свою колонию
    freed := true;
    select id into col_id from public.colonies where faction_id=fid
      order by coalesce(pop, coalesce(cells,0)*50) asc limit 1;
    if col_id is not null then
      update public.colonies set pop = coalesce(pop, coalesce(cells,0)*50) + n where id=col_id;
    end if;
  else
    perform public._slaves_add(fid, lot.origin_fid, n);
  end if;

  return jsonb_build_object('bought', n, 'cost', cost, 'freed', freed);
end$$;
revoke all on function public.sinli_buy(text,numeric) from public;
grant execute on function public.sinli_buy(text,numeric) to authenticated;

-- выставить СВОИХ рабов данного происхождения на продажу (создаёт лот игрока;
-- продавец скрыт в UI, но получает оплату при выкупе).
create or replace function public.sinli_sell(p_origin_fid text, p_count numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; have numeric; n numeric; pr numeric;
  SELL_PRICE constant numeric := 400;  -- ГС/раб, чуть ниже завозной цены
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if public._faction_enlightened(fid) then raise exception 'enlightened factions cannot trade slaves'; end if;

  select coalesce(count,0) into have from public.faction_slaves where owner_fid=fid and origin_fid=p_origin_fid;
  n := greatest(1, least(coalesce(p_count, have), have));
  if n < 1 then raise exception 'no such slaves'; end if;

  update public.faction_slaves set count=count-n, updated_at=now() where owner_fid=fid and origin_fid=p_origin_fid;
  delete from public.faction_slaves where owner_fid=fid and count<=0;

  pr := SELL_PRICE;
  insert into public.sinli_lots(origin_fid, seller_fid, count, price, kind)
    values(p_origin_fid, fid, n, pr, 'player');
  return jsonb_build_object('listed', n, 'price', pr);
end$$;
revoke all on function public.sinli_sell(text,numeric) from public;
grant execute on function public.sinli_sell(text,numeric) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- 1) fleet_raid_colony(fleet, colony) для флота в чужой системе крадёт население;
-- 2) sinli_get() показывает витрину (после недельного _sinli_restock);
-- 3) sinli_buy своих origin → +pop в колонию (freed=true); чужих → мои рабы;
-- 4) sinli_sell выкладывает лот игрока (seller скрыт); 5) spy_steal_slaves крадёт
-- рабов у цели; 6) slaves_tick() капает ГС за форс-труд. Просвещённым всё это 403.
