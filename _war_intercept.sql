-- ============================================================
-- ВОЙНА, СРЕЗ 3: ПЕРЕХВАТ В ПОЛЁТЕ И ВСТРЕЧА ФЛОТОВ
--
-- 1) Флот больше НЕ пролетает сквозь вражеский флот: если на маршруте
--    стоит флот противника, полёт обрывается в этой системе — перехват.
-- 2) Встреча враждебных флотов в одной системе → завязывается бой.
-- 3) Скованные боем флоты никуда не летят, пока бой не кончится.
--
-- Применять в Supabase → SQL Editor ПОСЛЕ:
--   ... → _borders_closed.sql → _war_declare.sql →
--   _war_borders_occupation.sql → ЭТОТ ФАЙЛ.
--
-- ШОВ С СРЕЗОМ 4: здесь заводится таблица battles (кто, где, какими
-- флотами) и статус 'forming' — стороны ещё выбирают состав. Пошаговая
-- механика (battle_units / battle_turns / ходы / подкрепления) — целиком
-- в _war_battle.sql, и он ДОПОЛНЯЕТ battles (alter table), а НЕ создаёт
-- её заново. Не переносить сюда логику ходов и не пересоздавать battles
-- в срезе 4 — иначе перехват начнёт терять уже завязанные бои.
--
-- ЧЕСТНОЕ ОГРАНИЧЕНИЕ: перехват вычисляется в момент ПРИЛЁТА флота
-- (_fleet_settle ленивый — таймера в БД нет, всё считается при обращении).
-- То есть флот, вылетевший мимо врага, будет остановлен не «на полпути в
-- реальном времени», а когда игра в следующий раз тронет его флот. Позиция
-- при этом честная — система перехвата, а не пункт назначения. Настоящий
-- перехват в реальном времени потребовал бы крона (см. Disk I/O бюджет).
-- ?v=20260718war3
-- ============================================================

-- ── 1) Бой ───────────────────────────────────────────────────
-- status: forming — стороны выбирают состав (срез 4);
--         active  — идут ходы; done — кончился.
create table if not exists public.battles (
  id           uuid primary key default gen_random_uuid(),
  system_id    text not null references public.map_systems(id) on delete cascade,
  war_id       uuid references public.wars(id) on delete set null,
  attacker_fid text not null,          -- тот, кто пришёл / перехватил
  defender_fid text not null,          -- тот, кто стоял
  status       text not null default 'forming',
  kind         text not null default 'meeting',   -- meeting | intercept
  winner_fid   text,
  created_at   timestamptz not null default now(),
  ended_at     timestamptz,
  constraint battles_status_ck check (status in ('forming','active','done')),
  constraint battles_kind_ck check (kind in ('meeting','intercept')),
  constraint battles_sides_differ check (attacker_fid <> defender_fid)
);
create index if not exists battles_sys_idx on public.battles (system_id) where status <> 'done';
create index if not exists battles_att_idx on public.battles (attacker_fid) where status <> 'done';
create index if not exists battles_def_idx on public.battles (defender_fid) where status <> 'done';

-- Какие флоты скованы боем. Флот может быть только в одном бою разом.
create table if not exists public.battle_fleets (
  battle_id uuid not null references public.battles(id) on delete cascade,
  fleet_id  uuid not null references public.fleets(id) on delete cascade,
  fid       text not null,
  side      text not null,             -- attacker | defender
  primary key (battle_id, fleet_id),
  constraint battle_fleets_side_ck check (side in ('attacker','defender'))
);
create index if not exists battle_fleets_fleet_idx on public.battle_fleets (fleet_id);
create index if not exists battle_fleets_fid_idx on public.battle_fleets (fid);
-- НАМЕРЕННО без unique(fleet_id): такой индекс держал бы флот вечно, ведь
-- строки законченных боёв остаются как история. «Один флот — один бой
-- одновременно» и так гарантируют _war_hostile_fleet и триггер battle_lock_fleet:
-- оба смотрят только на бои со status <> 'done'. Дубли внутри одного боя
-- закрыты первичным ключом.
drop index if exists public.battle_fleets_fleet_uq;

alter table public.battles       enable row level security;
alter table public.battle_fleets enable row level security;
-- Бой видят только его стороны: чужие сражения — не твоё дело.
drop policy if exists battles_read on public.battles;
create policy battles_read on public.battles for select to authenticated
  using (attacker_fid = public._ec_my_fid() or defender_fid = public._ec_my_fid());
drop policy if exists battle_fleets_read on public.battle_fleets;
create policy battle_fleets_read on public.battle_fleets for select to authenticated
  using (exists(select 1 from public.battles b where b.id = battle_id
                 and (b.attacker_fid = public._ec_my_fid() or b.defender_fid = public._ec_my_fid())));
revoke insert, update, delete on public.battles, public.battle_fleets from anon, authenticated;

-- Флот скован боем? (используется и в fleet_send, и в срезе 4)
create or replace function public._fleet_in_battle(p_fleet uuid)
returns uuid language sql stable security definer set search_path=public as $$
  select bf.battle_id from public.battle_fleets bf
    join public.battles b on b.id = bf.battle_id
   where bf.fleet_id = p_fleet and b.status <> 'done'
   limit 1;
$$;
revoke all on function public._fleet_in_battle(uuid) from public;

-- ── 2) Враждебный флот в системе ─────────────────────────────
-- Первый попавшийся ЧУЖОЙ флот в системе p_sys, с чьей фракцией p_fid
-- в состоянии войны. Флоты, уже скованные боем, не перехватывают:
-- иначе один флот стопорил бы весь сектор, сидя в двух боях сразу.
create or replace function public._war_hostile_fleet(p_fid text, p_sys text)
returns uuid language plpgsql stable security definer set search_path=public as $$
declare r record; w boolean;
begin
  if p_fid is null or p_sys is null then return null; end if;
  for r in select fl.id, fl.faction_id from public.fleets fl
            where fl.system_id = p_sys and fl.status = 'idle'
              and fl.faction_id is distinct from p_fid
  loop
    if public._fleet_in_battle(r.id) is not null then continue; end if;
    begin
      select public.at_war(p_fid, r.faction_id) into w;
    exception when undefined_function then w := false; end;
    if coalesce(w, false) then return r.id; end if;
  end loop;
  return null;
end$$;
revoke all on function public._war_hostile_fleet(text,text) from public;

-- ── 3) Завязать бой ──────────────────────────────────────────
-- p_mover перехвачен/встретил p_foe_fleet в системе p_sys.
-- Если в этой системе уже идёт бой между теми же сторонами — новый флот
-- просто вливается в него, а не плодит второй бой на том же месте.
create or replace function public._war_engage(p_mover_fleet uuid, p_foe_fleet uuid, p_sys text, p_kind text)
returns uuid language plpgsql security definer set search_path=public as $$
declare a_fid text; d_fid text; b uuid; wid uuid; sysname text;
begin
  select faction_id into a_fid from public.fleets where id = p_mover_fleet;
  select faction_id into d_fid from public.fleets where id = p_foe_fleet;
  if a_fid is null or d_fid is null or a_fid = d_fid then return null; end if;

  select b2.id into b from public.battles b2
   where b2.system_id = p_sys and b2.status <> 'done'
     and ((b2.attacker_fid = a_fid and b2.defender_fid = d_fid)
       or (b2.attacker_fid = d_fid and b2.defender_fid = a_fid))
   limit 1;

  if b is null then
    select w.id into wid from public.wars w
      join public.war_sides sa on sa.war_id = w.id and sa.fid = a_fid
      join public.war_sides sd on sd.war_id = w.id and sd.fid = d_fid and sd.side <> sa.side
     where w.status = 'active' limit 1;
    insert into public.battles(system_id, war_id, attacker_fid, defender_fid, kind)
      values (p_sys, wid, a_fid, d_fid, coalesce(p_kind,'meeting'))
      returning id into b;

    select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = p_sys;
    perform public._war_news(
      (case when p_kind = 'intercept' then '🛑 Перехват: ' else '⚔ Столкновение флотов: ' end) || sysname,
      public._news_pick(array[
        format('Флоты %s и %s сходятся в системе %s. Отступать некуда — бой неизбежен.',
               public._war_nm(a_fid), public._war_nm(d_fid), sysname),
        format('В %s замечены встречные курсы: корабли %s наткнулись на заслон %s. Начинается сражение.',
               sysname, public._war_nm(a_fid), public._war_nm(d_fid)),
        format('%s перехвачена силами %s в системе %s. Орудия расчехлены.',
               public._war_nm(a_fid), public._war_nm(d_fid), sysname)
      ]),
      jsonb_build_array(a_fid, d_fid));
  end if;

  -- Втягиваем оба флота (повторный вызов безвреден).
  insert into public.battle_fleets(battle_id, fleet_id, fid, side)
    select b, p_mover_fleet, a_fid,
           case when (select attacker_fid from public.battles where id=b) = a_fid then 'attacker' else 'defender' end
  on conflict (battle_id, fleet_id) do nothing;
  insert into public.battle_fleets(battle_id, fleet_id, fid, side)
    select b, p_foe_fleet, d_fid,
           case when (select attacker_fid from public.battles where id=b) = d_fid then 'attacker' else 'defender' end
  on conflict (battle_id, fleet_id) do nothing;
  return b;
end$$;
revoke all on function public._war_engage(uuid,uuid,text,text) from public;

-- ── 4) _fleet_settle — НАДМНОЖЕСТВО _war_borders_occupation.sql ──
-- Сохранены дословно: стоп на закрытой границе (_borders_closed.sql) и
-- проверка оккупации (срез 2). ДОБАВЛЕН перехват:
--   • идём по маршруту от точки вылета к точке, где флот должен был сесть;
--   • первая система с вражеским флотом — конечная: там перехват и бой;
--   • долетели без помех, но в цели стоит враг — бой на месте (встреча).
-- Порядок важен: сначала считаем стоп по границам, потом урезаем маршрут
-- перехватом (перехват не может унести флот ДАЛЬШЕ, чем пустила граница).
create or replace function public._fleet_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare fl record; path text[]; stop_sys text; i int; foe uuid; hit text; b uuid;
begin
  for fl in select id, from_sys, dest_sys from public.fleets
            where faction_id=p_fid and status='transit' and arrive_at <= now()
  loop
    -- 4.1 стоп по закрытым границам (как было)
    stop_sys := fl.dest_sys;
    if public._borders_blocked(p_fid, fl.dest_sys) then
      path := public._fleet_path(fl.from_sys, fl.dest_sys, p_fid, true);
      if path is null then
        path := public._fleet_path(fl.from_sys, fl.dest_sys, p_fid, false);
      end if;
      stop_sys := coalesce(fl.from_sys, fl.dest_sys);
      if path is not null then
        for i in 2..array_length(path, 1) loop
          exit when public._borders_blocked(p_fid, path[i]);
          stop_sys := path[i];
        end loop;
      end if;
    end if;

    -- 4.2 ПЕРЕХВАТ: идём по маршруту до stop_sys и ищем вражеский заслон.
    -- Маршрут берём тот же, каким флот реально летел (в обход закрытых).
    foe := null; hit := null;
    if stop_sys is distinct from fl.from_sys then
      path := public._fleet_path(fl.from_sys, stop_sys, p_fid, true);
      if path is null then path := public._fleet_path(fl.from_sys, stop_sys, p_fid, false); end if;
      if path is not null then
        for i in 2..array_length(path, 1) loop
          foe := public._war_hostile_fleet(p_fid, path[i]);
          if foe is not null then hit := path[i]; exit; end if;
        end loop;
      end if;
    end if;
    if hit is not null then stop_sys := hit; end if;

    -- 4.3 посадка
    update public.fleets
      set status='idle', system_id=stop_sys, from_sys=null, dest_sys=null,
          depart_at=null, arrive_at=null
      where id = fl.id;

    -- 4.4 бой: перехват на трассе либо встреча в точке прибытия
    if foe is null then foe := public._war_hostile_fleet(p_fid, stop_sys); end if;
    if foe is not null then
      b := public._war_engage(fl.id, foe, stop_sys,
             case when hit is not null then 'intercept' else 'meeting' end);
    end if;

    -- 4.5 оккупация (срез 2). Систему, где идёт бой, НЕ оккупируем:
    -- сначала выиграй сражение — потом поднимай флаг.
    if foe is null then
      perform public._war_occupy_check(p_fid, stop_sys, fl.id);
    end if;
  end loop;
end$$;
revoke all on function public._fleet_settle(text) from public;

-- ── 5) fleet_send: скованный боем флот никуда не летит ───────
-- fleet_send НЕ переписываем (он пережил три клоббера) — вешаем проверку
-- отдельным триггером на fleets. Любая попытка увести флот из боя,
-- откуда бы она ни шла, ловится здесь.
create or replace function public._battle_lock_fleet()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if NEW.status = 'transit' and coalesce(OLD.status,'') <> 'transit' then
    if public._fleet_in_battle(NEW.id) is not null then
      raise exception 'флот скован боем — пока сражение не окончено, он никуда не уйдёт';
    end if;
  end if;
  return NEW;
end$$;
drop trigger if exists battle_lock_fleet on public.fleets;
create trigger battle_lock_fleet before update on public.fleets
  for each row execute function public._battle_lock_fleet();

-- ── 6) Сводка боёв для клиента ───────────────────────────────
-- Полный состав/ходы отдаёт срез 4; здесь — минимум, чтобы кабинет и
-- карта могли показать «идёт бой» сразу после наката этого файла.
-- ⚠ Переменная НЕ должна называться fid: battle_fleets.fid делает ссылку
--   неоднозначной («column reference "fid" is ambiguous»), и функция падает,
--   как только у фракции появляется первый бой.
create or replace function public.battles_mine()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_fid text;
begin
  v_fid := public._ec_my_fid();
  perform public._fleet_settle(v_fid);   -- бои завязываются лениво, при обращении
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'system_id', b.system_id,
      'system_name', (select coalesce(nullif(ms.name,''), ms.id) from public.map_systems ms where ms.id = b.system_id),
      'status', b.status, 'kind', b.kind,
      'my_side', case when b.attacker_fid = v_fid then 'attacker' else 'defender' end,
      'foe', case when b.attacker_fid = v_fid then b.defender_fid else b.attacker_fid end,
      'foe_name', public._war_nm(case when b.attacker_fid = v_fid then b.defender_fid else b.attacker_fid end),
      'my_fleets', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name)), '[]'::jsonb)
                    from public.battle_fleets bf join public.fleets f on f.id = bf.fleet_id
                    where bf.battle_id = b.id and bf.fid = v_fid),
      'created_at', b.created_at) order by b.created_at desc)
    from public.battles b
    where b.status <> 'done' and (b.attacker_fid = v_fid or b.defender_fid = v_fid)
  ), '[]'::jsonb);
end$$;
revoke all on function public.battles_mine() from public;
grant execute on function public.battles_mine() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- 1) Война А↔Б. Флот Б стоит в системе X на трассе А→Y.
--    fleet_send(А, Y) → по прилёте флот А оказывается в X (не в Y),
--    в battles строка kind='intercept', в ленте «🛑 Перехват».
-- 2) Повторный fleet_send этого флота → exception «флот скован боем».
-- 3) Флот А сел в системе, где стоит враг → kind='meeting', оккупации НЕТ
--    (система занята боем, а не захвачена).
-- 4) Нет войны → _war_hostile_fleet возвращает null, всё летает как раньше.
