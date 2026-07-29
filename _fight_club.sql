-- ════════════════════════════════════════════════════════════════════
-- 🥊 БОЙЦОВСКИЙ КЛУБ — дуэли в новелле вместо Поэмы/Ассамблеи (те на паузе).
--
-- Суть: игроки подают заявки; когда окно набора закрывается, сервер
-- выбирает ДВУХ случайных дуэлянтов. рев.8: вместо выданного корабля каждой
-- стороне даётся РЕЗЕРВ (пул) из свежих боеспособных проектов (любой фракции,
-- обновлённых с 2026-07-23, с уроном И корпусом > 0 — «новый редактор»).
-- Дуэлянт САМ драфтит флот из пула и расставляет его на доске (штатные
-- battle_deploy/battle_ready), в рамках ЕДИНОГО бюджета обеих сторон. Кто не
-- расставился до дедлайна — техническое поражение (форфейт).
-- Бой — НАСТОЯЩИЙ тактический (гекс-доска _war_battle_tactics), дуэлянты
-- ходят сами, все остальные смотрят (fc_watch_state — полное зрение).
-- Пока идёт бой, зрители ставят на победителя (кап 500 000 ГС, эскроу).
-- После боя: победитель дуэли получает призовой кошель клуба (250 000 ГС),
-- а банк ставок — проигравший пул + случайная ставка НПС (до 400 000 ГС) —
-- делится между угадавшими пропорционально ставкам. Если на победителя
-- не ставил никто — весь банк тоже уходит победителю дуэли (поверх приза).
-- Затем сутки паузы на набор заявок — и новый круг. Всё лениво через
-- _fc_ensure() при каждом fc_state(), крон не нужен.
--
-- Применять в Supabase SQL Editor ПОСЛЕ (по порядку):
--   _unit_catalog.sql → _unit_publish.sql → _battle_finish_fix.sql →
--   _war_battle_tactics.sql
-- Идемпотентно.
-- ════════════════════════════════════════════════════════════════════

-- ── Константы ────────────────────────────────────────────────
-- рев.8: корабли пула — только «новый редактор» (свежие проекты с 2026-07-23,
-- урон и корпус > 0). Старые/пустые проекты в клуб не допускаются.
create or replace function public._fc_fresh_since()
returns timestamptz language sql immutable as $$ select timestamptz '2026-07-23 00:00:00+00' $$;
create or replace function public._fc_bet_cap()
returns numeric language sql immutable as $$ select 500000::numeric $$;
create or replace function public._fc_npc_max()
returns numeric language sql immutable as $$ select 400000::numeric $$;
create or replace function public._fc_signup_hours()
returns int language sql immutable as $$ select 6 $$;
-- призовой кошель клуба: платится победителю дуэли ВСЕГДА, поверх банка ставок
create or replace function public._fc_prize()
returns numeric language sql immutable as $$ select 250000::numeric $$;
-- рев.8: окно расстановки флота (forming). Не расставился и не нажал «в бой»
-- до дедлайна → техническое поражение (форфейт).
create or replace function public._fc_form_hours()
returns int language sql immutable as $$ select 12 $$;
-- рев.8: бюджет драфта = множитель × медианная стоимость свежих проектов.
-- Обе стороны получают ОДИНАКОВЫЙ бюджет — честность по построению.
create or replace function public._fc_pool_mult()
returns numeric language sql immutable as $$ select 5::numeric $$;
-- сколько РАЗНЫХ проектов кладём в пул каждой стороне (выбор при драфте)
create or replace function public._fc_pool_designs()
returns int language sql immutable as $$ select 6 $$;

-- ── Дуэли допускаем как отдельный вид боя ───────────────────
alter table public.battles drop constraint if exists battles_kind_ck;
alter table public.battles add constraint battles_kind_ck
  check (kind in ('meeting','intercept','duel'));
-- рев.8: бюджет драфта дуэли (кап суммарной стоимости выставленных бортов).
-- NULL — не дуэль/без ограничения; battle_ready проверяет только при kind='duel'.
alter table public.battles add column if not exists duel_budget numeric;

-- ── События клуба ────────────────────────────────────────────
create table if not exists public.fc_events (
  id           uuid primary key default gen_random_uuid(),
  status       text not null default 'signup',      -- signup | live | done
  signup_until timestamptz not null default now() + interval '24 hours',
  duelist_a    text,
  duelist_b    text,
  ship_a       uuid,               -- проект faction_units (снапшот имён ниже)
  ship_b       uuid,
  ship_a_name  text,
  ship_b_name  text,
  cnt_a        int,                -- сколько бортов выдано каждой стороне
  cnt_b        int,
  battle_id    uuid references public.battles(id) on delete set null,
  npc_bet      numeric not null default 0,
  winner_fid   text,
  settled      boolean not null default false,
  created_at   timestamptz not null default now(),
  ended_at     timestamptz,
  constraint fc_events_status_ck check (status in ('signup','live','done'))
);
create index if not exists fc_events_open_idx on public.fc_events (created_at desc);
-- рев.6: призовой кошель круга (фиксируется при старте дуэли)
alter table public.fc_events add column if not exists prize numeric not null default 0;
-- рев.8: бюджет драфта круга (для табло клуба); ship_a/ship_b/cnt_* больше не
-- используются (флот драфтится игроком из пула), остаются для истории/совместимости.
alter table public.fc_events add column if not exists budget numeric not null default 0;

create table if not exists public.fc_signups (
  event_id   uuid not null references public.fc_events(id) on delete cascade,
  fid        text not null,
  created_at timestamptz not null default now(),
  primary key (event_id, fid)
);

create table if not exists public.fc_bets (
  event_id   uuid not null references public.fc_events(id) on delete cascade,
  fid        text not null,
  on_fid     text not null,        -- на кого поставил
  amount     numeric not null check (amount > 0),
  won        numeric,              -- выплата при сеттле (null = ещё не решено)
  created_at timestamptz not null default now(),
  primary key (event_id, fid, on_fid)   -- рев.7: можно ставить на ОБЕ стороны
);
-- Миграция ключа для баз, где таблица создана ДО рев.7 (create table if not exists
-- новый PK не накатывает, а fc_bet делает on conflict (event_id, fid, on_fid)).
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.fc_bets'::regclass and conname = 'fc_bets_pkey'
       and pg_get_constraintdef(oid) = 'PRIMARY KEY (event_id, fid)'
  ) then
    alter table public.fc_bets drop constraint fc_bets_pkey;
    alter table public.fc_bets add primary key (event_id, fid, on_fid);
  end if;
end $$;

alter table public.fc_events  enable row level security;
alter table public.fc_signups enable row level security;
alter table public.fc_bets    enable row level security;
drop policy if exists fc_events_read  on public.fc_events;
drop policy if exists fc_signups_read on public.fc_signups;
drop policy if exists fc_bets_read    on public.fc_bets;
create policy fc_events_read  on public.fc_events  for select to authenticated using (true);
create policy fc_signups_read on public.fc_signups for select to authenticated using (true);
create policy fc_bets_read    on public.fc_bets    for select to authenticated using (true);
revoke insert, update, delete on public.fc_events, public.fc_signups, public.fc_bets
  from anon, authenticated;

-- ── Новость клуба (не падаем, если _war_news ещё не накачен) ──
create or replace function public._fc_news(p_title text, p_body text, p_who jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  begin
    perform public._war_news(p_title, p_body, p_who);
  exception when undefined_function then null; end;
end$$;
revoke all on function public._fc_news(text,text,jsonb) from public;

-- ── Свежий боеспособный проект? (новый редактор: урон и корпус > 0) ──
-- рев.8: пул клуба берёт ТОЛЬКО такие корабли — «примерно с 23.07».
create or replace function public._fc_qualifies(fu public.faction_units)
returns boolean language sql immutable as $$
  select fu.category = 'ship'
     and coalesce(fu.updated_at, fu.created_at) >= public._fc_fresh_since()
     and coalesce((fu.summary->>'hp')::numeric,  0) > 0
     and coalesce((fu.summary->>'dmg')::numeric, 0) > 0
$$;

-- ── Сборщик пула стороны: синтетический «флот» из свежих проектов ──
-- рев.8: вместо одного выданного корабля сторона получает РЕЗЕРВ из нескольких
-- разных свежих проектов (любых фракций), из которого сама драфтит и расставляет
-- флот штатным battle_deploy. Количество каждого проекта щедрое — драфт ограничен
-- бюджетом (duel_budget), а не числом бортов в пуле.
create or replace function public._fc_make_pool(p_battle uuid, p_fid text, p_side text,
                                                p_budget numeric, p_sys text)
returns int language plpgsql security definer set search_path=public as $$
declare comp jsonb := '[]'::jsonb; r record; qty int; n int := 0; fl uuid;
        cap int := public._bt_cap();
begin
  for r in
    select fu.id, fu.name, coalesce((fu.summary->>'cost')::numeric, 0) as cost
      from public.faction_units fu
     where public._fc_qualifies(fu)
     order by random()
     limit public._fc_pool_designs()
  loop
    -- запас каждого проекта: сколько таких влезло бы в бюджет целиком (но не
    -- больше кап-доски). Дешёвым даём больше, дорогим меньше — драфт гибкий.
    qty := least(cap, greatest(1, floor(p_budget / greatest(r.cost, 1))::int));
    comp := comp || jsonb_build_array(jsonb_build_object(
      'unit_id', r.id, 'unit_name', r.name, 'qty', qty));
    n := n + 1;
  end loop;
  if n = 0 then
    raise exception 'в клубе нет свежих кораблей: ни один проект не обновлялся с % с уроном > 0',
      public._fc_fresh_since()::date;
  end if;

  -- синтетический флот-резерв: status='duel' (не idle/transit — на карте не всплывёт),
  -- battle_pool читает состав через battle_fleets → fleets.composition.
  insert into public.fleets(faction_id, name, status, system_id, composition)
    values (p_fid, 'Резерв Бойцовского клуба', 'duel', p_sys, comp)
    returning id into fl;
  insert into public.battle_fleets(battle_id, fleet_id, fid, side)
    values (p_battle, fl, p_fid, p_side);
  return n;
end$$;
revoke all on function public._fc_make_pool(uuid,text,text,numeric,text) from public;

-- ── Спавнер дуэли: доска forming + пул каждой стороне (без авто-расстановки) ──
-- Общая часть боевого круга клуба И админского тестового боя. Бой создаётся в
-- статусе 'forming': дуэлянты сами драфтят флот из пула и жмут «в бой».
create or replace function public._fc_spawn_duel(da text, db text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare bid uuid; sys text; budget numeric; med numeric; na int; nb int;
begin
  if da is null or db is null or da = db then raise exception 'нужны две разные державы'; end if;

  -- бюджет драфта = множитель × медианная стоимость свежих проектов (обе стороны
  -- получают одинаковый). Пол — 1, чтобы бюджет всегда позволял вывести борт.
  select percentile_cont(0.5) within group (order by coalesce((fu.summary->>'cost')::numeric, 0))
    into med
    from public.faction_units fu
   where public._fc_qualifies(fu);
  if med is null then
    raise exception 'в клубе нет свежих кораблей: ни один проект не обновлялся с % с уроном > 0',
      public._fc_fresh_since()::date;
  end if;
  budget := greatest(1, round(public._fc_pool_mult() * greatest(med, 1)));

  -- арена: случайная система (чисто сцена — оккупаций по дуэли не бывает,
  -- _war_occupy_check сам не тронет чужую систему без войны)
  select id into sys from public.map_systems order by random() limit 1;
  if sys is null then raise exception 'нет систем для арены'; end if;

  insert into public.battles(system_id, attacker_fid, defender_fid, status, kind,
                             att_ready, def_ready, side_to_move, turn_no, acts_left,
                             duel_budget, deadline_at)
    values (sys, da, db, 'forming', 'duel', false, false, 'attacker', 0, public._bt_acts(),
            budget, now() + (public._fc_form_hours() || ' hours')::interval)
    returning id into bid;
  perform public._bt_log(bid, format(
    '🥊 Дуэль Бойцовского клуба! Расставьте флот из выданного резерва (бюджет — %s ГС). Победа — только на уничтожение.',
    budget::bigint));

  na := public._fc_make_pool(bid, da, 'attacker', budget, sys);
  nb := public._fc_make_pool(bid, db, 'defender', budget, sys);

  return jsonb_build_object('battle_id', bid, 'budget', budget,
    'pool_a', na, 'pool_b', nb);
end$$;
revoke all on function public._fc_spawn_duel(text,text) from public;

-- ── Подтверждение состава: у дуэли — с проверкой бюджета драфта ──
-- рев.8: переопределяем battle_ready (база — _war_battle.sql) так, чтобы для
-- kind='duel' с заданным duel_budget суммарная стоимость выставленных бортов
-- не превышала бюджет. Для остальных боёв поведение прежнее. Катить ПОСЛЕ
-- _war_battle.sql (иначе базовая версия затрёт эту).
create or replace function public.battle_ready(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; sd text; b record; cnt int; spent numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle for update;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.status <> 'forming' then raise exception 'бой уже идёт'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;
  select count(*) into cnt from public.battle_units where battle_id = p_battle and fid = me;
  if cnt = 0 then raise exception 'выведите на доску хотя бы один корабль'; end if;

  -- бюджет драфта дуэли: сумма стоимости выставленных бортов ≤ duel_budget
  if b.kind = 'duel' and b.duel_budget is not null then
    select coalesce(sum(coalesce((fu.summary->>'cost')::numeric, 0)), 0) into spent
      from public.battle_units u
      join public.faction_units fu on fu.id = u.unit_id
     where u.battle_id = p_battle and u.fid = me;
    if spent > b.duel_budget then
      raise exception 'состав дороже бюджета: % из % ГС — уберите борт',
        spent::bigint, b.duel_budget::bigint;
    end if;
  end if;

  if sd = 'attacker' then update public.battles set att_ready = true where id = p_battle;
  else                     update public.battles set def_ready = true where id = p_battle; end if;

  -- рев.8: у дуэли резерв (пул) = материал для драфта, НЕ источник бесконечных
  -- подкреплений. Подтвердил состав — резерв гасим: что на доске, то и весь флот.
  -- Иначе (а) проигравший вводил бы борта из пула сверх бюджета, (б) _bt_check_end
  -- не завершил бы бой, пока pool > 0.
  if b.kind = 'duel' then
    delete from public.fleets f
      using public.battle_fleets bf
     where bf.battle_id = p_battle and bf.fid = me and bf.fleet_id = f.id;
  end if;

  select * into b from public.battles where id = p_battle;
  if b.att_ready and b.def_ready then
    -- рев.8: переход в active САМ взводит первый ход — свежие активации и чистые
    -- флаги нападающего. Раньше acts_left полагался на значение из insert, и любое
    -- касание счётчика в фазе forming давало «0/6» и мёртвый ход.
    update public.battle_units set moved = false, fired = false, acted = false, flash = false
     where battle_id = p_battle and side = 'attacker';
    -- курс по стороне на старте: флоты пришли с разных краёв и должны смотреть
    -- навстречу (нападающий слева → вправо=0, защитник справа → влево=3).
    -- Никто ещё не маневрировал, поэтому нормализуем безопасно.
    update public.battle_units set facing = case when side = 'defender' then 3 else 0 end
     where battle_id = p_battle;
    update public.battles
       set status = 'active', side_to_move = 'attacker', turn_no = 1,
           acts_left = public._bt_acts(),
           deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
     where id = p_battle;
    perform public._bt_log(p_battle, 'Бой начался. Первый ход за нападающими.');
  end if;
  return jsonb_build_object('ok', true, 'started', (b.att_ready and b.def_ready));
end$$;
revoke all on function public.battle_ready(uuid) from public;
grant execute on function public.battle_ready(uuid) to authenticated;

-- ── battle_state + бюджет драфта ─────────────────────────────
-- рев.8: колонка battles.duel_budget появляется только с этим срезом (после
-- _war_battle_tactics), поэтому добавляем её в state ЗДЕСЬ. Тело — копия
-- tactics-версии battle_state + одно поле 'duel_budget'. Катить ПОСЛЕ
-- _war_battle_tactics.sql. Если tactics-версия меняется — синхронизировать.
create or replace function public.battle_state(p_battle uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare me text; b record; sd text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_arm(p_battle);
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;

  if b.terrain is null then
    update public.battles set terrain = public._bt_gen_terrain(p_battle)
     where id = p_battle and terrain is null;
    select * into b from public.battles where id = p_battle;
  end if;

  return jsonb_build_object(
    'id', b.id, 'status', b.status, 'kind', b.kind,
    'system_id', b.system_id,
    'system_name', (select coalesce(nullif(ms.name,''), ms.id) from public.map_systems ms where ms.id = b.system_id),
    'w', public._bt_w(), 'h', public._bt_h(), 'cap', public._bt_cap(),
    'zone', public._bt_zone(), 'acts_max', public._bt_acts(), 'acts_left', b.acts_left,
    -- рев.8: бюджет драфта (для счётчика при расстановке дуэли)
    'duel_budget', b.duel_budget,
    'my_side', sd, 'my_fid', me,
    'attacker', b.attacker_fid, 'attacker_name', public._war_nm(b.attacker_fid),
    'defender', b.defender_fid, 'defender_name', public._war_nm(b.defender_fid),
    'side_to_move', b.side_to_move, 'my_turn', (b.side_to_move = sd),
    'turn_no', b.turn_no,
    'att_turns_left', b.att_turns_left, 'def_turns_left', b.def_turns_left,
    'att_ready', b.att_ready, 'def_ready', b.def_ready,
    'deadline_at', b.deadline_at,
    'can_force', (b.status='active' and b.side_to_move is distinct from sd
                  and b.deadline_at is not null and b.deadline_at <= now()),
    'winner', b.winner_fid,
    'interdicted', public._bt_interdicted(p_battle, sd),
    'log', b.log,
    'terrain', coalesce(b.terrain, '[]'::jsonb),
    'pool', public.battle_pool(p_battle, me),
    'units', (select coalesce(jsonb_agg(
        case when u.side = sd or lk.locked then
          jsonb_build_object(
            'id', u.id, 'side', u.side, 'mine', (u.fid = me),
            'name', u.unit_name, 'cls', u.cls,
            'x', u.x, 'y', u.y, 'facing', u.facing, 'straight', u.straight,
            'hp', round(u.hp), 'max_hp', round(u.max_hp),
            'shield', round(u.shield), 'max_shield', round(u.max_shield),
            'armor', round(u.armor), 'dmg', round(u.dmg),
            'speed', u.speed, 'rng', u.rng,
            'sensor', u.sensor, 'stealth', u.stealth, 'flash', u.flash,
            'pd', u.pd, 'jam', u.jam, 'wings', u.wings, 'is_wing', u.is_wing,
            'dejam', u.dejam, 'eccm', u.eccm, 'interdict', u.interdict, 'stabil', u.stabil,
            'ftl', u.ftl,
            'locked', true,
            'wpn', case when u.side = sd then coalesce(u.wpn, '[]'::jsonb) else null end,
            'moved', u.moved, 'fired', u.fired, 'acted', u.acted)
        else
          jsonb_build_object(
            'id', u.id, 'side', u.side, 'mine', false, 'contact', true,
            'locked', false, 'x', u.x, 'y', u.y)
        end order by u.created_at), '[]'::jsonb)
      from public.battle_units u
      cross join lateral (select exists(
          select 1 from public.battle_units m
           where m.battle_id = p_battle and m.side = sd and m.alive
             and public._bt_detected(m.x, m.y, m.facing,
                                     greatest(0, m.sensor - greatest(0, public._bt_ecm(p_battle, m.side, m.x, m.y) - m.eccm)),
                                     u.x, u.y, u.stealth, u.flash)) as locked) lk
      where u.battle_id = p_battle and u.alive));
end$$;
revoke all on function public.battle_state(uuid) from public;
grant execute on function public.battle_state(uuid) to authenticated;

-- ── Старт круга клуба: жребий пары + спавн + касса ──────────
create or replace function public._fc_start(p_event uuid)
returns void language plpgsql security definer set search_path=public as $$
declare ev record; picked text[]; da text; db text; sp jsonb; npc numeric;
begin
  select * into ev from public.fc_events where id = p_event for update;
  if ev.id is null or ev.status <> 'signup' then return; end if;

  select array_agg(fid) into picked
    from (select fid from public.fc_signups
           where event_id = p_event order by random() limit 2) s;
  if picked is null or array_length(picked,1) < 2 then
    -- заявок меньше двух — продлеваем окно ещё на сутки
    update public.fc_events
       set signup_until = now() + (public._fc_signup_hours() || ' hours')::interval
     where id = p_event;
    return;
  end if;
  da := picked[1]; db := picked[2];

  sp := public._fc_spawn_duel(da, db);

  -- ставка НПС: случайная, до 400 000 ГС, круглыми тысячами
  npc := (floor(random() * (public._fc_npc_max()/1000)) + 1) * 1000;

  -- рев.8: событие 'live' с момента спавна, но бой стартует в 'forming' —
  -- дуэлянты драфтят флот. Ставки открываются, когда бой перейдёт в 'active'
  -- (fc_bet проверяет статус боя). ship_*/cnt_* больше не заполняем.
  update public.fc_events
     set status = 'live', duelist_a = da, duelist_b = db,
         battle_id = (sp->>'battle_id')::uuid, npc_bet = npc,
         budget = (sp->>'budget')::numeric,
         prize = public._fc_prize()
   where id = p_event;

  perform public._fc_news('🥊 Бойцовский клуб: жребий брошен',
    format('%s и %s выходят на арену. Каждому выдан резерв свежих проектов — дуэлянты драфтят флот в рамках бюджета %s ГС и расставляют его на доске. Приз победителю — %s ГС из кассы клуба. Ставки откроются с началом боя (кап %s ГС).',
      public._war_nm(da), public._war_nm(db), (sp->>'budget')::bigint,
      public._fc_prize()::bigint, public._fc_bet_cap()::bigint),
    jsonb_build_array(da, db));
end$$;
revoke all on function public._fc_start(uuid) from public;

-- ── Сеттл: банк делится между угадавшими ────────────────────
create or replace function public._fc_settle(p_event uuid)
returns void language plpgsql security definer set search_path=public as $$
declare ev record; b record; win text; lose text;
        pool_win numeric; pool_lose numeric; bank numeric; r record; pay numeric;
        prz numeric;
begin
  select * into ev from public.fc_events where id = p_event for update;
  if ev.id is null or ev.status <> 'live' or ev.settled then return; end if;
  select * into b from public.battles where id = ev.battle_id;
  if b.id is null then
    -- бой пропал (система удалена и т.п.) — вернуть все ставки и закрыть круг
    for r in select * from public.fc_bets where event_id = p_event loop
      update public.faction_economy set gc = gc + r.amount where faction_id = r.fid;
      update public.fc_bets set won = r.amount
        where event_id = p_event and fid = r.fid and on_fid = r.on_fid;
    end loop;
    update public.fc_events set status='done', settled=true, ended_at=now() where id = p_event;
    return;
  end if;

  -- рев.8: таймаут расстановки. Кто не расставился и не нажал «в бой» до
  -- дедлайна — техническое поражение. Если оба промолчали — дуэль не состоялась.
  if b.status = 'forming' and b.deadline_at is not null and b.deadline_at <= now() then
    -- гасим невыставленные резервы обеих сторон (синтетические пул-флоты)
    delete from public.fleets f
      using public.battle_fleets bf
     where bf.battle_id = b.id and bf.fleet_id = f.id;
    if b.att_ready and not b.def_ready then
      update public.battles set status='done', winner_fid=b.attacker_fid, ended_at=now()
       where id = b.id;
      perform public._bt_log(b.id, format('⏳ %s не расставил флот — техническое поражение. Победа %s.',
        public._war_nm(b.defender_fid), public._war_nm(b.attacker_fid)));
    elsif b.def_ready and not b.att_ready then
      update public.battles set status='done', winner_fid=b.defender_fid, ended_at=now()
       where id = b.id;
      perform public._bt_log(b.id, format('⏳ %s не расставил флот — техническое поражение. Победа %s.',
        public._war_nm(b.attacker_fid), public._war_nm(b.defender_fid)));
    else
      -- никто не расставился — дуэль не состоялась: возврат ставок, новый круг
      for r in select * from public.fc_bets where event_id = p_event loop
        update public.faction_economy set gc = gc + r.amount where faction_id = r.fid;
        update public.fc_bets set won = r.amount
          where event_id = p_event and fid = r.fid and on_fid = r.on_fid;
      end loop;
      update public.battles set status='done', ended_at=now() where id = b.id;
      update public.fc_events set status='done', settled=true, ended_at=now() where id = p_event;
      perform public._fc_news('🥊 Бойцовский клуб: дуэль не состоялась',
        format('%s и %s не вышли на арену в срок — круг отменён, ставки возвращены.',
          public._war_nm(ev.duelist_a), public._war_nm(ev.duelist_b)),
        jsonb_build_array(ev.duelist_a, ev.duelist_b));
      insert into public.fc_events(status, signup_until)
        values ('signup', now() + (public._fc_signup_hours() || ' hours')::interval);
      return;
    end if;
    select * into b from public.battles where id = ev.battle_id;   -- перечитать вердикт
  end if;

  if b.status <> 'done' or b.winner_fid is null then return; end if;

  win  := b.winner_fid;
  lose := case when win = ev.duelist_a then ev.duelist_b else ev.duelist_a end;
  select coalesce(sum(amount) filter (where on_fid = win), 0),
         coalesce(sum(amount) filter (where on_fid <> win), 0)
    into pool_win, pool_lose
    from public.fc_bets where event_id = p_event;
  bank := pool_lose + ev.npc_bet;

  -- призовой кошель клуба: победителю дуэли ВСЕГДА (страховка coalesce/0 —
  -- на случай круга, стартовавшего до этой ревизии, где prize не записан)
  prz := coalesce(ev.prize, 0);
  if prz <= 0 then prz := public._fc_prize(); end if;
  update public.faction_economy set gc = gc + prz where faction_id = win;

  if pool_win > 0 then
    -- угадавшие: возврат ставки + доля банка пропорционально ставке
    for r in select * from public.fc_bets where event_id = p_event and on_fid = win loop
      pay := round(r.amount + bank * r.amount / pool_win);
      update public.faction_economy set gc = gc + pay where faction_id = r.fid;
      update public.fc_bets set won = pay
        where event_id = p_event and fid = r.fid and on_fid = win;
    end loop;
    update public.fc_bets set won = 0 where event_id = p_event and on_fid <> win;
  else
    -- никто не угадал — весь банк уходит победителю дуэли
    update public.faction_economy set gc = gc + bank where faction_id = win;
    update public.fc_bets set won = 0 where event_id = p_event;
  end if;

  update public.fc_events
     set status = 'done', settled = true, winner_fid = win, ended_at = now(),
         prize = prz
   where id = p_event;

  perform public._fc_news('🥊 Бойцовский клуб: вердикт арены',
    format('Дуэль окончена: %s разбивает %s. Победитель забирает приз клуба — %s ГС. Банк круга — %s ГС (в том числе %s ГС от анонимного мецената)%s.',
      public._war_nm(win), public._war_nm(lose), prz::bigint, bank::bigint, ev.npc_bet::bigint,
      case when pool_win > 0 then ' — разделён между угадавшими'
           else ' — тоже уходит победителю: не угадал никто' end),
    jsonb_build_array(win, lose));

  -- пауза: следующий круг открывается сразу, окно заявок = _fc_signup_hours() (6ч)
  insert into public.fc_events(status, signup_until)
    values ('signup', now() + (public._fc_signup_hours() || ' hours')::interval);
end$$;
revoke all on function public._fc_settle(uuid) from public;

-- ── Ленивый дозор: двигает машину состояний при каждом обращении ──
create or replace function public._fc_ensure()
returns uuid language plpgsql security definer set search_path=public as $$
declare ev record;
begin
  select * into ev from public.fc_events order by created_at desc limit 1;
  if ev.id is null then
    insert into public.fc_events(status, signup_until)
      values ('signup', now() + (public._fc_signup_hours() || ' hours')::interval)
      returning * into ev;
  end if;
  if ev.status = 'signup' and now() >= ev.signup_until then
    perform public._fc_start(ev.id);
  elsif ev.status = 'live' then
    perform public._fc_settle(ev.id);
  end if;
  select id into ev from public.fc_events order by created_at desc limit 1;
  return ev.id;
end$$;
revoke all on function public._fc_ensure() from public;

-- ── RPC: состояние клуба ─────────────────────────────────────
create or replace function public.fc_state()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare me text; ev record;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid_opt();
  perform public._fc_ensure();
  select * into ev from public.fc_events order by created_at desc limit 1;

  return jsonb_build_object(
    'event_id', ev.id, 'status', ev.status,
    'signup_until', ev.signup_until,
    'signups', (select count(*) from public.fc_signups where event_id = ev.id),
    'me', me,
    'me_signed', exists(select 1 from public.fc_signups where event_id = ev.id and fid = me),
    'duelist_a', ev.duelist_a, 'duelist_a_name', public._war_nm(ev.duelist_a),
    'duelist_b', ev.duelist_b, 'duelist_b_name', public._war_nm(ev.duelist_b),
    'ship_a_name', ev.ship_a_name, 'ship_b_name', ev.ship_b_name,
    'ship_a_cls', (select data->>'class' from public.faction_units where id = ev.ship_a),
    'ship_b_cls', (select data->>'class' from public.faction_units where id = ev.ship_b),
    'cnt_a', ev.cnt_a, 'cnt_b', ev.cnt_b,
    'battle_id', ev.battle_id,
    'battle_status', (select status from public.battles where id = ev.battle_id),
    -- рев.8: фаза расстановки (forming) — бюджет драфта, кто уже готов, дедлайн
    'budget', case when coalesce(ev.budget,0) > 0 then ev.budget else null end,
    'att_ready', (select att_ready from public.battles where id = ev.battle_id),
    'def_ready', (select def_ready from public.battles where id = ev.battle_id),
    'battle_deadline', (select deadline_at from public.battles where id = ev.battle_id),
    -- сторона текущего игрока в дуэли (для кнопки «Расставить флот»): a|b|null
    'i_side', case when me is null then null
                   when me = ev.duelist_a then 'a'
                   when me = ev.duelist_b then 'b' else null end,
    'npc_bet', case when ev.status = 'done' then ev.npc_bet else null end,
    -- приз победителю: до старта показываем плановый, после — фактический
    'prize', case when coalesce(ev.prize,0) > 0 then ev.prize else public._fc_prize() end,
    'bet_cap', public._fc_bet_cap(),
    'pool_a', (select coalesce(sum(amount),0) from public.fc_bets
                where event_id = ev.id and on_fid = ev.duelist_a),
    'pool_b', (select coalesce(sum(amount),0) from public.fc_bets
                where event_id = ev.id and on_fid = ev.duelist_b),
    'bettors', (select count(*) from public.fc_bets where event_id = ev.id),
    -- рев.7: массив ставок (можно держать на обе стороны). my_bet — для обратной совместимости (первая).
    'my_bets', (select coalesce(jsonb_agg(jsonb_build_object(
        'on', b.on_fid, 'on_name', public._war_nm(b.on_fid),
        'amount', b.amount, 'won', b.won) order by b.created_at), '[]'::jsonb)
      from public.fc_bets b where b.event_id = ev.id and b.fid = me),
    'my_bet', (select jsonb_build_object('on', b.on_fid, 'on_name', public._war_nm(b.on_fid),
                         'amount', b.amount, 'won', b.won)
      from public.fc_bets b where b.event_id = ev.id and b.fid = me order by b.created_at limit 1),
    'i_duel', (me is not null and me in (ev.duelist_a, ev.duelist_b)),
    'winner', ev.winner_fid, 'winner_name', public._war_nm(ev.winner_fid),
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
        'a', public._war_nm(h.duelist_a), 'b', public._war_nm(h.duelist_b),
        'winner', public._war_nm(h.winner_fid),
        'ship_a', h.ship_a_name, 'ship_b', h.ship_b_name,
        'npc', h.npc_bet, 'prize', h.prize, 'ended', h.ended_at) order by h.ended_at desc), '[]'::jsonb)
      from (select * from public.fc_events
             where status = 'done' and winner_fid is not null
             order by ended_at desc limit 5) h));
end$$;
revoke all on function public.fc_state() from public;
grant execute on function public.fc_state() to authenticated;

-- ── RPC: заявка на участие ───────────────────────────────────
create or replace function public.fc_signup()
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; ev record;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  perform public._fc_ensure();
  select * into ev from public.fc_events order by created_at desc limit 1 for update;
  if ev.status <> 'signup' then raise exception 'набор заявок закрыт — дуэль уже идёт'; end if;
  insert into public.fc_signups(event_id, fid) values (ev.id, me)
    on conflict do nothing;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.fc_signup() from public;
grant execute on function public.fc_signup() to authenticated;

-- ── RPC: ставка (эскроу сразу, кап 500 000, дуэлянтам нельзя) ──
create or replace function public.fc_bet(p_on text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; ev record; amt numeric; old record; have numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  perform public._fc_ensure();
  select * into ev from public.fc_events order by created_at desc limit 1 for update;
  if ev.status <> 'live' then raise exception 'ставки принимаются только во время дуэли'; end if;
  if (select status from public.battles where id = ev.battle_id) = 'forming' then
    raise exception 'дуэлянты ещё расставляют флот — ставки откроются с началом боя';
  end if;
  if (select status from public.battles where id = ev.battle_id) = 'done' then
    raise exception 'бой окончен — кассы закрыты';
  end if;
  if me in (ev.duelist_a, ev.duelist_b) then
    raise exception 'дуэлянтам ставить нельзя — вы и есть ставка';
  end if;
  if p_on is null or p_on not in (ev.duelist_a, ev.duelist_b) then
    raise exception 'ставить можно только на одного из дуэлянтов';
  end if;
  amt := floor(coalesce(p_amount, 0));
  if amt <= 0 then raise exception 'ставка должна быть больше нуля'; end if;

  -- рев.7: сторону выбираешь свободно — можно держать ставку на обе.
  -- Кап действует отдельно на каждую сторону (old = уже поставленное на p_on).
  select * into old from public.fc_bets where event_id = ev.id and fid = me and on_fid = p_on;
  if coalesce(old.amount, 0) + amt > public._fc_bet_cap() then
    raise exception 'кап ставки — % ГС на сторону', public._fc_bet_cap()::bigint;
  end if;

  select gc into have from public.faction_economy where faction_id = me for update;
  if coalesce(have, 0) < amt then raise exception 'не хватает средств: нужно % ГС', amt::bigint; end if;
  update public.faction_economy set gc = gc - amt where faction_id = me;

  insert into public.fc_bets(event_id, fid, on_fid, amount)
    values (ev.id, me, p_on, amt)
    on conflict (event_id, fid, on_fid) do update set amount = public.fc_bets.amount + excluded.amount;

  return jsonb_build_object('ok', true, 'amount', coalesce(old.amount,0) + amt);
end$$;
revoke all on function public.fc_bet(text, numeric) from public;
grant execute on function public.fc_bet(text, numeric) to authenticated;

-- ── RPC: доска дуэли для ЗРИТЕЛЯ (полное зрение, без действий) ──
create or replace function public.fc_watch_state(p_battle uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare b record;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_arm(p_battle);           -- взвести размер доски этого боя
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.kind <> 'duel' then raise exception 'зрительский режим — только для дуэлей клуба'; end if;

  if b.terrain is null then
    update public.battles set terrain = public._bt_gen_terrain(p_battle)
     where id = p_battle and terrain is null;
    select * into b from public.battles where id = p_battle;
  end if;

  return jsonb_build_object(
    'id', b.id, 'status', b.status, 'kind', b.kind,
    'system_id', b.system_id,
    'system_name', (select coalesce(nullif(ms.name,''), ms.id) from public.map_systems ms where ms.id = b.system_id),
    'w', public._bt_w(), 'h', public._bt_h(), 'cap', public._bt_cap(),
    'zone', public._bt_zone(), 'acts_max', public._bt_acts(), 'acts_left', b.acts_left,
    'my_side', 'spectator', 'my_fid', null,
    'attacker', b.attacker_fid, 'attacker_name', public._war_nm(b.attacker_fid),
    'defender', b.defender_fid, 'defender_name', public._war_nm(b.defender_fid),
    'side_to_move', b.side_to_move, 'my_turn', false,
    'turn_no', b.turn_no,
    'att_turns_left', b.att_turns_left, 'def_turns_left', b.def_turns_left,
    'att_ready', true, 'def_ready', true,
    'deadline_at', b.deadline_at,
    'can_force', false,
    'winner', b.winner_fid,
    'interdicted', false,
    'log', b.log,
    'terrain', coalesce(b.terrain, '[]'::jsonb),
    'pool', '[]'::jsonb,
    -- зрители видят ВСЁ: дуэль — это шоу, туман войны тут неуместен
    'units', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id, 'side', u.side, 'mine', false,
        'name', u.unit_name, 'cls', u.cls,
        'x', u.x, 'y', u.y, 'facing', u.facing, 'straight', u.straight,
        'hp', round(u.hp), 'max_hp', round(u.max_hp),
        'shield', round(u.shield), 'max_shield', round(u.max_shield),
        'armor', round(u.armor), 'dmg', round(u.dmg),
        'speed', u.speed, 'rng', u.rng,
        'sensor', u.sensor, 'stealth', u.stealth, 'flash', u.flash,
        'pd', u.pd, 'jam', u.jam, 'wings', u.wings, 'is_wing', u.is_wing,
        'dejam', u.dejam, 'eccm', u.eccm, 'interdict', u.interdict, 'stabil', u.stabil,
        'locked', true, 'wpn', null,
        'moved', u.moved, 'fired', u.fired, 'acted', u.acted) order by u.created_at), '[]'::jsonb)
      from public.battle_units u where u.battle_id = p_battle and u.alive));
end$$;
revoke all on function public.fc_watch_state(uuid) from public;
grant execute on function public.fc_watch_state(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 🧪 АДМИН: тестовая дуэль — ОТДЕЛЬНАЯ от сессии клуба.
-- Один перезапускаемый бой: повторный вызов сносит старую доску
-- (вместе с юнитами, каскадом) и разворачивает новую. Ставок/кассы
-- нет — fc_events не трогается, сеттл клуба такой бой не видит.
-- Смотреть можно как зрителем (fc_watch_state работает для любого
-- kind='duel'), так и играть за стороны (обычные battle_*).
-- ════════════════════════════════════════════════════════════
create table if not exists public.fc_test_duel (
  one       int primary key default 1 check (one = 1),   -- единственная строка
  battle_id uuid references public.battles(id) on delete set null,
  created_at timestamptz not null default now()
);
revoke all on public.fc_test_duel from anon, authenticated;
-- RLS без политик: доступ только у SECURITY DEFINER-функций админа
-- (admin_test_duel / _state), клиентам таблица закрыта. Глушит линтер Supabase.
alter table public.fc_test_duel enable row level security;

create or replace function public.admin_test_duel(p_a text, p_b text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare old uuid; sp jsonb;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  -- прежний тестовый бой сносим целиком (battle_units уходят каскадом)
  select battle_id into old from public.fc_test_duel where one = 1;
  if old is not null then delete from public.battles where id = old; end if;

  sp := public._fc_spawn_duel(p_a, p_b);

  insert into public.fc_test_duel(one, battle_id) values (1, (sp->>'battle_id')::uuid)
    on conflict (one) do update set battle_id = excluded.battle_id, created_at = now();

  return jsonb_build_object('ok', true, 'battle_id', sp->>'battle_id',
    'attacker_fid', p_a, 'defender_fid', p_b,
    'budget', sp->>'budget', 'pool_a', sp->>'pool_a', 'pool_b', sp->>'pool_b');
end$$;
revoke all on function public.admin_test_duel(text,text) from public;
grant execute on function public.admin_test_duel(text,text) to authenticated;

-- Текущий тестовый бой (для кнопки «Открыть доску» после перезагрузки админки)
create or replace function public.admin_test_duel_state()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare t record; b record;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  select * into t from public.fc_test_duel where one = 1;
  if t.battle_id is null then return jsonb_build_object('battle_id', null); end if;
  select * into b from public.battles where id = t.battle_id;
  return jsonb_build_object('battle_id', t.battle_id,
    'status', b.status, 'winner', public._war_nm(b.winner_fid),
    'attacker_fid', b.attacker_fid, 'defender_fid', b.defender_fid,
    'attacker', public._war_nm(b.attacker_fid), 'defender', public._war_nm(b.defender_fid));
end$$;
revoke all on function public.admin_test_duel_state() from public;
grant execute on function public.admin_test_duel_state() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- 1) fc_state() → status='signup', signup_until через ~24ч, signups=0.
-- 2) fc_signup() дважды → одна запись; после 2 заявок и истечения окна
--    fc_state() → status='live', battle_id заполнен, battle_status='forming',
--    budget>0, att_ready=def_ready=false.
-- 3) battle_state(battle_id) дуэлянтом → pool непустой (несколько свежих
--    проектов, каждый только с dmg>0 и updated_at≥2026-07-23), duel_budget задан.
-- 4) battle_deploy + battle_ready дороже бюджета → exception «состав дороже
--    бюджета»; в рамках бюджета — ok. Когда ОБА нажали «в бой» →
--    battle_status='active', ставки открываются.
-- 5) fc_bet во время forming → exception «дуэлянты ещё расставляют флот».
-- 6) fc_bet('<duelist_a>', 600000) во время active → exception про кап 500 000.
-- 7) Дедлайн forming прошёл, готова лишь одна сторона → её техническая победа,
--    приз/банк выплачены. Обе не готовы → круг отменён, ставки возвращены.
-- 8) После уничтожения одной стороны fc_state() → status='done', победитель
--    получил приз (_fc_prize=250 000), угадавшие — возврат+долю, новый круг.
-- 9) admin_test_duel('F1','F2') стаффом → battle_id в forming; обе стороны
--    драфтят через «Горячие точки» → «Расставить флот»; fc_events не трогается.
