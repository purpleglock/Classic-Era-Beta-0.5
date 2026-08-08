-- © 2025–2026. Все права защищены.
-- ════════════════════════════════════════════════════════════
-- 🥊 БОЙЦОВСКИЙ КЛУБ, рев.10 — АРЕНА ПРОТИВ ВОЛЬНИЦЫ
-- ────────────────────────────────────────────────────────────
-- ЧТО МЕНЯЕТСЯ. Клуб перестаёт быть дуэлью «игрок против игрока».
-- Теперь на арену выходит ЖРЕБИЙ игроков (1–3, как ляжет) против
-- ботов-пиратов «Пустотных рейдеров» (_bt_bot_name) — той же вольницы,
-- что и в бот-боях: корпуса Железного Дивизиона
-- (ростер _bt_bot_roster_default(), пиратские корпуса, fid 'bot').
--
--   §1  ЦЕНА В ОЧКАХ. У пиратов ценник считался конструктором, а
--       варианты (_bt_bot_variant) множили ТТХ, не трогая цену: борт
--       вдвое злее стоил столько же. Заводим общий аршин — «очки арены»
--       (_fc_pw): корпус, поле, урон и вес активных модулей. Курс очка
--       (_fc_price_k) прибит к ЦЕННИКУ КЛУБА, поэтому бюджет на табло
--       остаётся в ГС и означает ровно то же, что раньше.
--   §2  ПРЕИМУЩЕСТВО БОТОВ. Легион получает бюджет ×_fc_bot_edge()
--       (1.25) от бюджета стороны игроков — «чутка» больше, чтобы
--       победа требовала состава, а не явки.
--   §3  ГРУППА ИГРОКОВ. Жребий сажает на одну сторону до трёх держав.
--       Общий бюджет стороны при этом НЕ растёт: он делится между
--       участниками (активаций у стороны всё те же 6, иначе толпа
--       выигрывала бы числом). Соучастие держится на battle_allies —
--       _bt_side теперь видит союзников, и весь боевой движок
--       (deploy/move/fire/state) работает для них без правок.
--   §4  БОТЫ ХОДЯТ САМИ. fc_bot_turn — публичный RPC: любой, кто
--       смотрит доску, прогоняет ход легиона, когда очередь за ним.
--       Плюс ленивый догон в _fc_ensure (если доску никто не открыл).
--   §5  ВИДНО ВЕСЬ РОСТЕР. _fc_make_pool клал в резерв 8 СЛУЧАЙНЫХ
--       проектов из 16 — половина гладиаторов просто не доезжала до
--       расстановки. Кладём весь ростер, по возрастанию цены.
--
-- ЦЕПОЧКА: ПОСЛЕ _fight_club.sql, _club_gladiators3.sql, _bt_arena_bot.sql,
--          _bot_ai_brain.sql, _bt_pool_acts.sql. Идемпотентно.
-- ════════════════════════════════════════════════════════════

-- ── §0. Константы круга ─────────────────────────────────────
-- преимущество легиона: бюджет ботов = бюджет стороны игроков × edge
create or replace function public._fc_bot_edge()
returns numeric language sql immutable as $$ select 1.25::numeric $$;
-- потолок жребия: сколько держав может выпасть на одну арену
create or replace function public._fc_party_max()
returns int language sql immutable as $$ select 3 $$;
-- ростер клуба целиком: 8 из 16 случайных прятали половину гладиаторов
create or replace function public._fc_pool_designs()
returns int language sql immutable as $$ select 999 $$;

-- ── §1. Очки арены: общий аршин для клуба и вольницы ────────
-- Корпус и поле — по десятке за единицу, урон — по пятёрке, каждая
-- активация — своей ценой из _fc_act_price. Читается по ТТХ боя
-- (_bt_stats), поэтому «вариант» с ×1.2 корпуса честно дорожает.
create or replace function public._fc_pw(p_unit uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select round(
      coalesce((s.st->>'hp')::numeric, 0) / 10
    + coalesce((s.st->>'shield')::numeric, 0) / 10
    + coalesce((s.st->>'dmg')::numeric, 0) / 5
    + coalesce((select sum(public._fc_act_price(a->>'k')) / 1000
                  from jsonb_array_elements(public._bt_acts_of(p_unit)) a), 0)
  , 2)
  from (select public._bt_stats(p_unit) as st) s;
$$;
grant execute on function public._fc_pw(uuid) to anon, authenticated, service_role;

-- Курс очка в ГС. Медиана ценника клуба, делённая на медиану его же очков:
-- бюджет на табло остаётся в привычных ГС, а сравнивать им можно любой борт.
create or replace function public._fc_price_k()
returns numeric language sql stable security definer set search_path=public as $$
  select greatest(1, coalesce(
    (select percentile_cont(0.5) within group (order by coalesce((fu.summary->>'cost')::numeric,0))
       from public.faction_units fu where fu.faction_id = 'club' and fu.category = 'ship')
    / nullif((select percentile_cont(0.5) within group (order by public._fc_pw(fu.id))
                from public.faction_units fu where fu.faction_id = 'club' and fu.category = 'ship'), 0),
    100));
$$;
grant execute on function public._fc_price_k() to anon, authenticated, service_role;

-- Цена борта на арене в ГС (для ботов; у клуба она уже проставлена в summary)
create or replace function public._fc_arena_price(p_unit uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select greatest(1, round(public._fc_pw(p_unit) * public._fc_price_k()));
$$;
grant execute on function public._fc_arena_price(uuid) to anon, authenticated, service_role;

-- ── §3a. Союзники на стороне ────────────────────────────────
-- battles знает ровно два fid (attacker_fid/defender_fid). Чтобы на одной
-- стороне стояли несколько держав, ведём отдельный реестр: _bt_side
-- сначала смотрит в бой, потом сюда. Для всех прочих боёв таблица пуста —
-- поведение не меняется ни на йоту.
create table if not exists public.battle_allies (
  battle_id uuid not null references public.battles(id) on delete cascade,
  fid       text not null,
  side      text not null check (side in ('attacker','defender')),
  ready     boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (battle_id, fid)
);
create index if not exists battle_allies_b_idx on public.battle_allies (battle_id);
alter table public.battle_allies enable row level security;
drop policy if exists battle_allies_read on public.battle_allies;
create policy battle_allies_read on public.battle_allies for select to authenticated using (true);
revoke insert, update, delete on public.battle_allies from anon, authenticated;

create or replace function public._bt_side(p_battle uuid, p_fid text)
returns text language sql stable security definer set search_path=public as $$
  select coalesce(
    (select case when b.attacker_fid = p_fid then 'attacker'
                 when b.defender_fid = p_fid then 'defender' end
       from public.battles b where b.id = p_battle),
    (select a.side from public.battle_allies a
      where a.battle_id = p_battle and a.fid = p_fid));
$$;

-- ── §5. Резерв стороны: весь ростер клуба ───────────────────
-- Было `limit _fc_pool_designs()` при 8 — восемь случайных из шестнадцати.
-- Стало: все, что проходят _fc_qualifies, по возрастанию цены (лёгкие
-- впереди — лента расстановки читается сверху вниз по весу).
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
     order by coalesce((fu.summary->>'cost')::numeric, 0), fu.name
     limit public._fc_pool_designs()
  loop
    qty := least(cap, greatest(1, floor(p_budget / greatest(r.cost, 1))::int));
    comp := comp || jsonb_build_array(jsonb_build_object(
      'unit_id', r.id, 'unit_name', r.name, 'qty', qty));
    n := n + 1;
  end loop;
  if n = 0 then
    raise exception 'в клубе нет боеспособных гладиаторов — накатите _club_gladiators*.sql';
  end if;

  insert into public.fleets(faction_id, name, status, system_id, composition)
    values (p_fid, 'Резерв Бойцовского клуба', 'duel', p_sys, comp)
    returning id into fl;
  insert into public.battle_fleets(battle_id, fleet_id, fid, side)
    values (p_battle, fl, p_fid, p_side);
  return n;
end$$;
revoke all on function public._fc_make_pool(uuid,text,text,numeric,text) from public;

-- ── §2. Флот легиона: набираем на бюджет ────────────────────
-- Борта берём из ростера ботов (по умолчанию — вольница), считая цену
-- очками арены. Выбор смещён к тяжёлым (random()*price), чтобы легион не
-- выкатывал полсотни катеров: остаток бюджета доедают мелочью.
create or replace function public._fc_place_bots(p_battle uuid, p_budget numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare bot text := public._bt_bot_fid(); rf text := public._bt_bot_roster_default();
        sp jsonb; fc int; k numeric; spent numeric := 0; placed int := 0;
        guard int := 0; cap int := public._bt_cap(); xy int[]; sb jsonb; r record;
begin
  perform public._bt_ensure_field(p_battle);      -- форма и сектора — до расстановки
  select b.spawn into sp from public.battles b where b.id = p_battle;
  fc := public._bt_spawn_facing(sp, 'defender');
  k  := public._fc_price_k();

  loop
    guard := guard + 1;
    exit when guard > 400 or placed >= cap;

    select fu.id as uid, greatest(1, round(public._fc_pw(fu.id) * k)) as price
      into r
      from public.faction_units fu
     where fu.category = 'ship'
       and coalesce(fu.faction_id,'') = rf
       and coalesce((fu.summary->>'hp')::numeric, 0) > 0
       and not exists(select 1 from public.bt_bot_exclude bx where bx.unit_id = fu.id)
       and greatest(1, round(public._fc_pw(fu.id) * k)) <= (p_budget - spent)
     order by random() * greatest(1, round(public._fc_pw(fu.id) * k)) desc
     limit 1;
    exit when r.uid is null;

    xy := public._bt_spawn_free(p_battle, 'def');
    exit when xy is null;                          -- сектор забит
    sb := public._bt_stats(r.uid);
    if sb is null then continue; end if;

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil, ftl)
      values (p_battle, bot, 'defender', r.uid, sb->>'name', sb->>'cls', xy[1], xy[2],
        (sb->>'hp')::numeric, (sb->>'hp')::numeric, (sb->>'armor')::numeric,
        (sb->>'shield')::numeric, (sb->>'shield')::numeric, (sb->>'dmg')::numeric,
        (sb->>'speed')::int, (sb->>'rng')::int,
        fc, public._bt_turnneed(sb->>'cls'),
        coalesce((sb->>'sensor')::int,0), coalesce((sb->>'stealth')::int,0),
        coalesce(sb->'wpn','[]'::jsonb), coalesce(sb->'resist','{}'::jsonb),
        coalesce((sb->>'pd')::numeric,0), coalesce((sb->>'jam')::int,0), coalesce((sb->>'wings')::int,0),
        coalesce((sb->>'dejam')::int,0), coalesce((sb->>'eccm')::int,0),
        coalesce((sb->>'interdict')::bool,false), coalesce((sb->>'stabil')::bool,false),
        coalesce((sb->>'ftl')::bool,false));
    spent  := spent + r.price;
    placed := placed + 1;
  end loop;

  if placed = 0 then
    raise exception 'у ростера ботов «%» нет бортов по карману арены', rf;
  end if;
  return jsonb_build_object('n', placed, 'spent', spent, 'budget', p_budget);
end$$;
revoke all on function public._fc_place_bots(uuid,numeric) from public;

-- ── §2b. Спавн арены: жребий игроков против легиона ─────────
create or replace function public._fc_spawn_bot_duel(p_fids text[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare bid uuid; sys text; med numeric; total numeric; per numeric; botb numeric;
        n int := coalesce(array_length(p_fids, 1), 0); f text; bots jsonb;
        bot text := public._bt_bot_fid();
begin
  if n < 1 then raise exception 'на арену некого выпускать'; end if;
  if n > public._fc_party_max() then raise exception 'жребий вытянул слишком много держав'; end if;
  if bot = any(p_fids) then raise exception 'fid бота совпал с державой игрока'; end if;

  select percentile_cont(0.5) within group (order by coalesce((fu.summary->>'cost')::numeric, 0))
    into med
    from public.faction_units fu
   where public._fc_qualifies(fu);
  if med is null then
    raise exception 'в клубе нет боеспособных гладиаторов — накатите _club_gladiators*.sql';
  end if;

  -- бюджет СТОРОНЫ фиксирован и делится между выпавшими: активаций у стороны
  -- всё те же 6, и толпа не должна выигрывать одним лишь числом корпусов.
  total := greatest(1, round(public._fc_pool_mult() * greatest(med, 1)));
  per   := greatest(1, round(total / n));
  botb  := greatest(1, round(total * public._fc_bot_edge()));

  select id into sys from public.map_systems order by random() limit 1;
  if sys is null then raise exception 'нет систем для арены'; end if;

  insert into public.battles(system_id, attacker_fid, defender_fid, status, kind,
                             att_ready, def_ready, side_to_move, turn_no, acts_left,
                             duel_budget, deadline_at)
    values (sys, p_fids[1], bot, 'forming', 'duel', false, true, 'attacker', 0,
            public._bt_acts(), per,
            now() + (public._fc_form_hours() || ' hours')::interval)
    returning id into bid;

  foreach f in array p_fids loop
    insert into public.battle_allies(battle_id, fid, side, ready)
      values (bid, f, 'attacker', false)
      on conflict (battle_id, fid) do nothing;
    perform public._fc_make_pool(bid, f, 'attacker', per, sys);
  end loop;

  bots := public._fc_place_bots(bid, botb);

  perform public._bt_log(bid, format(
    '🥊 Арена Бойцовского клуба: %s против вольницы «%s». Бюджет драфта — %s ГС на державу; боты вышли %s бортами на %s ГС (бюджет ботов больше на %s%%). Победа — только на уничтожение.',
    (select string_agg(public._war_nm(x), ', ') from unnest(p_fids) x),
    public._war_nm(bot), per::bigint, (bots->>'n'), (bots->>'spent')::numeric::bigint,
    round((public._fc_bot_edge() - 1) * 100)::int));

  return jsonb_build_object('battle_id', bid, 'budget', per, 'total', total,
    'bot_budget', botb, 'bots', bots->>'n', 'party', to_jsonb(p_fids));
end$$;
revoke all on function public._fc_spawn_bot_duel(text[]) from public;

-- ── §3b. Старт боя: общий кусок для battle_ready и дедлайна ──
create or replace function public._fc_kick_off(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $$
declare b record;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status <> 'forming' then return; end if;

  update public.battle_units set moved = false, fired = false, acted = false, flash = false
   where battle_id = p_battle and side = 'attacker';
  -- курс на старте: смотреть на сектор врага. Раньше выставлялось жёстко 0/3 —
  -- это верно только для боёв-«колонок»; на арене с секторами подхода борт
  -- разворачивало в стену.
  update public.battle_units u
     set facing = case when b.spawn is null
                       then (case when u.side = 'defender' then 3 else 0 end)
                       else public._bt_spawn_facing(b.spawn, u.side) end
   where u.battle_id = p_battle;
  update public.battles
     set status = 'active', side_to_move = 'attacker', turn_no = 1,
         acts_left = public._bt_acts(),
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;
  perform public._bt_log(p_battle, 'Бой начался. Первый ход за нападающими.');
end$$;
revoke all on function public._fc_kick_off(uuid) from public;

-- ── §3c. Подтверждение состава с учётом союзников ───────────
-- База — живая версия из _fight_club.sql. Отличий два: готовность союзника
-- пишется в battle_allies (сторона «готова», когда готовы ВСЕ), и старт боя
-- вынесен в _fc_kick_off.
create or replace function public.battle_ready(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; sd text; b record; cnt int; spent numeric; ally record; notready int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle for update;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.status <> 'forming' then raise exception 'бой уже идёт'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;

  select * into ally from public.battle_allies
   where battle_id = p_battle and fid = me;
  if ally.fid is not null and ally.ready then
    raise exception 'вы уже подтвердили состав';
  end if;

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

  if ally.fid is not null then
    update public.battle_allies set ready = true
     where battle_id = p_battle and fid = me;
    select count(*) into notready from public.battle_allies
     where battle_id = p_battle and side = sd and not ready;
  else
    notready := 0;
  end if;

  if notready = 0 then
    if sd = 'attacker' then update public.battles set att_ready = true where id = p_battle;
    else                     update public.battles set def_ready = true where id = p_battle; end if;
  end if;

  -- резерв дуэли — материал для драфта, а не бесконечное подкрепление
  if b.kind = 'duel' then
    delete from public.fleets f
      using public.battle_fleets bf
     where bf.battle_id = p_battle and bf.fid = me and bf.fleet_id = f.id;
  end if;

  select * into b from public.battles where id = p_battle;
  if b.att_ready and b.def_ready then
    perform public._fc_kick_off(p_battle);
  end if;
  return jsonb_build_object('ok', true,
    'started', (b.att_ready and b.def_ready),
    'waiting', notready);
end$$;
revoke all on function public.battle_ready(uuid) from public;
grant execute on function public.battle_ready(uuid) to authenticated;

-- ── §4. Ход легиона ─────────────────────────────────────────
-- Боты не ходят сами: у них нет сессии. Ход инициирует клиент — доску
-- смотрят и дуэлянты, и трибуна, так что кто-нибудь да прогонит. Функция
-- сама проверяет, что сейчас действительно очередь бота.
create or replace function public.fc_bot_turn(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; sfid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.status <> 'active' then return jsonb_build_object('ok', false, 'why', 'бой не идёт'); end if;
  sfid := case when b.side_to_move = 'attacker' then b.attacker_fid else b.defender_fid end;
  if sfid is distinct from public._bt_bot_fid() then
    return jsonb_build_object('ok', false, 'why', 'сейчас ход игрока');
  end if;
  perform public._bt_bot_turn(p_battle);
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.fc_bot_turn(uuid) from public;
grant execute on function public.fc_bot_turn(uuid) to authenticated;

-- ── §6. Круг клуба: жребий и запуск ─────────────────────────
create or replace function public._fc_start(p_event uuid)
returns void language plpgsql security definer set search_path=public as $$
declare ev record; picked text[]; k int; have int; sp jsonb; npc numeric;
        bot text := public._bt_bot_fid();
begin
  select * into ev from public.fc_events where id = p_event for update;
  if ev.id is null or ev.status <> 'signup' then return; end if;

  select count(*) into have from public.fc_signups where event_id = p_event;
  if have < 1 then
    -- заявок нет — продлеваем окно
    update public.fc_events
       set signup_until = now() + (public._fc_signup_hours() || ' hours')::interval
     where id = p_event;
    return;
  end if;

  -- сколько держав выпустить: чаще одну, реже двоих, изредка троих
  k := case when random() < 0.60 then 1 when random() < 0.65 then 2 else 3 end;
  k := least(k, have, public._fc_party_max());

  select array_agg(fid) into picked
    from (select fid from public.fc_signups
           where event_id = p_event order by random() limit k) s;

  sp := public._fc_spawn_bot_duel(picked);

  npc := (floor(random() * (public._fc_npc_max()/1000)) + 1) * 1000;

  update public.fc_events
     set status = 'live', duelist_a = picked[1], duelist_b = bot,
         battle_id = (sp->>'battle_id')::uuid, npc_bet = npc,
         budget = (sp->>'budget')::numeric,
         prize = public._fc_prize()
   where id = p_event;

  perform public._fc_news('🥊 Бойцовский клуб: жребий брошен',
    format('%s выход%s на арену против вольницы «%s». Бюджет драфта — %s ГС на державу; у ботов его на %s%% больше, так что лёгкой прогулки не будет. Приз за победу — %s ГС из кассы клуба. Ставки откроются с началом боя (кап %s ГС).',
      (select string_agg(public._war_nm(x), ', ') from unnest(picked) x),
      case when array_length(picked,1) > 1 then 'ят' else 'ит' end,
      public._war_nm(bot), (sp->>'budget')::numeric::bigint,
      round((public._fc_bot_edge() - 1) * 100)::int,
      public._fc_prize()::bigint, public._fc_bet_cap()::bigint),
    to_jsonb(picked));
end$$;
revoke all on function public._fc_start(uuid) from public;

-- ── §7. Сеттл круга ─────────────────────────────────────────
-- Отличия от рев.9: сторона игроков может быть группой (приз делится),
-- а победителем может оказаться бот (у него нет казны — приз сгорает,
-- банк делят угадавшие). Старые PvP-круги проходят той же веткой.
create or replace function public._fc_settle(p_event uuid)
returns void language plpgsql security definer set search_path=public as $$
declare ev record; b record; win text; lose text; bot text := public._bt_bot_fid();
        pool_win numeric; pool_lose numeric; bank numeric; r record; pay numeric;
        prz numeric; party text[]; nparty int; deployed int; win_is_bot boolean;
        legacy boolean; payees text[]; npay int;
begin
  select * into ev from public.fc_events where id = p_event for update;
  if ev.id is null or ev.status <> 'live' or ev.settled then return; end if;
  select * into b from public.battles where id = ev.battle_id;
  if b.id is null then
    for r in select * from public.fc_bets where event_id = p_event loop
      update public.faction_economy set gc = gc + r.amount where faction_id = r.fid;
      update public.fc_bets set won = r.amount
        where event_id = p_event and fid = r.fid and on_fid = r.on_fid;
    end loop;
    update public.fc_events set status='done', settled=true, ended_at=now() where id = p_event;
    perform public._fc_sweep_pools();
    return;
  end if;

  -- сторона игроков: группа жребия. Круг, начатый до рев.10 (дуэль двух
  -- держав), реестра союзников не имеет — он идёт по старой ветке (legacy).
  select array_agg(a.fid) into party
    from public.battle_allies a where a.battle_id = b.id and a.side = 'attacker';
  legacy := party is null;
  if legacy then party := array[ev.duelist_a, ev.duelist_b]; end if;
  nparty := greatest(1, coalesce(array_length(party, 1), 1));

  -- ── дедлайн расстановки ──
  if b.status = 'forming' and b.deadline_at is not null and b.deadline_at <= now() then
    select count(*) into deployed
      from public.battle_units u where u.battle_id = b.id and u.side = 'attacker';
    if deployed > 0 then
      -- кто-то вышел — опоздавших вычёркиваем и начинаем бой
      delete from public.fleets f
        using public.battle_fleets bf
       where bf.battle_id = b.id and bf.fleet_id = f.id
         and not exists(select 1 from public.battle_units u
                         where u.battle_id = b.id and u.fid = bf.fid);
      delete from public.battle_allies a
       where a.battle_id = b.id and a.side = 'attacker'
         and not exists(select 1 from public.battle_units u
                         where u.battle_id = b.id and u.fid = a.fid);
      update public.battles set att_ready = true where id = b.id;
      perform public._bt_log(b.id, '⏳ Срок расстановки вышел: опоздавшие в бой не вышли.');
      perform public._fc_kick_off(b.id);
      return;                                     -- бой только начался, сеттлить нечего
    end if;
    -- не вышел никто: круг отменён, ставки (если были) возвращены
    delete from public.fleets f
      using public.battle_fleets bf
     where bf.battle_id = b.id and bf.fleet_id = f.id;
    for r in select * from public.fc_bets where event_id = p_event loop
      update public.faction_economy set gc = gc + r.amount where faction_id = r.fid;
      update public.fc_bets set won = r.amount
        where event_id = p_event and fid = r.fid and on_fid = r.on_fid;
    end loop;
    update public.battles set status='done', ended_at=now() where id = b.id;
    update public.fc_events set status='done', settled=true, ended_at=now() where id = p_event;
    perform public._fc_news('🥊 Бойцовский клуб: арена пустует',
      'Ни одна держава не вывела флот в срок — круг отменён, ставки возвращены.',
      to_jsonb(party));
    insert into public.fc_events(status, signup_until)
      values ('signup', now() + (public._fc_signup_hours() || ' hours')::interval);
    return;
  end if;

  if b.status <> 'done' or b.winner_fid is null then return; end if;

  perform public._fc_sweep_pools();

  win  := b.winner_fid;
  win_is_bot := (win = bot);
  lose := case when win = ev.duelist_a then ev.duelist_b else ev.duelist_a end;
  select coalesce(sum(amount) filter (where on_fid = win), 0),
         coalesce(sum(amount) filter (where on_fid <> win), 0)
    into pool_win, pool_lose
    from public.fc_bets where event_id = p_event;
  bank := pool_lose + ev.npc_bet;

  -- кому платить: у арены — вся группа жребия, у старой дуэли — победитель
  if win_is_bot then payees := '{}'::text[];
  elsif legacy   then payees := array[win];
  else                payees := party;
  end if;
  npay := greatest(1, coalesce(array_length(payees, 1), 1));

  prz := coalesce(ev.prize, 0);
  if prz <= 0 then prz := public._fc_prize(); end if;
  if win_is_bot then
    prz := 0;                                     -- у легиона нет казны: приз остаётся в клубе
  else
    update public.faction_economy
       set gc = gc + round(prz / npay)
     where faction_id = any(payees);
  end if;

  if pool_win > 0 then
    for r in select * from public.fc_bets where event_id = p_event and on_fid = win loop
      pay := round(r.amount + bank * r.amount / pool_win);
      update public.faction_economy set gc = gc + pay where faction_id = r.fid;
      update public.fc_bets set won = pay
        where event_id = p_event and fid = r.fid and on_fid = win;
    end loop;
    update public.fc_bets set won = 0 where event_id = p_event and on_fid <> win;
  elsif not win_is_bot then
    -- никто не угадал — банк уходит победителям круга
    update public.faction_economy
       set gc = gc + round(bank / npay)
     where faction_id = any(payees);
    update public.fc_bets set won = 0 where event_id = p_event;
  else
    -- выиграли боты, и на них никто не поставил: банк остаётся клубу
    update public.fc_bets set won = 0 where event_id = p_event;
  end if;

  update public.fc_events
     set status = 'done', settled = true, winner_fid = win, ended_at = now(),
         prize = prz
   where id = p_event;

  perform public._fc_news('🥊 Бойцовский клуб: вердикт арены',
    case when legacy then
      format('Дуэль окончена: %s разбивает %s. Победитель забирает приз клуба — %s ГС. Банк круга — %s ГС (в том числе %s ГС от анонимного мецената)%s.',
        public._war_nm(win), public._war_nm(lose), prz::bigint, bank::bigint, ev.npc_bet::bigint,
        case when pool_win > 0 then ' — разделён между угадавшими'
             else ' — тоже уходит победителю: не угадал никто' end)
    when win_is_bot then
      format('Арена за вольницей: «%s» перемололи %s. Приз клуба остался в кассе, банк круга — %s ГС (в том числе %s ГС от анонимного мецената)%s.',
        public._war_nm(bot), (select string_agg(public._war_nm(x), ', ') from unnest(party) x),
        bank::bigint, ev.npc_bet::bigint,
        case when pool_win > 0 then ' — разделён между поставившими на ботов'
             else ' — на легион не поставил никто, деньги осели в клубе' end)
    else
      format('%s разбива%s «%s». Приз клуба — %s ГС%s. Банк круга — %s ГС (в том числе %s ГС от анонимного мецената)%s.',
        (select string_agg(public._war_nm(x), ', ') from unnest(party) x),
        case when nparty > 1 then 'ют' else 'ет' end,
        public._war_nm(bot), prz::bigint,
        case when nparty > 1 then format(' — делится между %s державами', nparty) else '' end,
        bank::bigint, ev.npc_bet::bigint,
        case when pool_win > 0 then ' — разделён между угадавшими'
             else ' — тоже уходит победителям: не угадал никто' end)
    end,
    to_jsonb(party));

  insert into public.fc_events(status, signup_until)
    values ('signup', now() + (public._fc_signup_hours() || ' hours')::interval);
end$$;
revoke all on function public._fc_settle(uuid) from public;

-- ── §8. Ленивый дозор: плюс ход ботов и просроченный ход игроков ──
create or replace function public._fc_ensure()
returns uuid language plpgsql security definer set search_path=public as $$
declare ev record; b record; sfid text;
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
    -- ход не должен зависать: просроченный ход игроков закрываем сами,
    -- а ход легиона прогоняем, даже если доску никто не открыл.
    select * into b from public.battles where id = ev.battle_id;
    if b.id is not null and b.status = 'active' then
      sfid := case when b.side_to_move = 'attacker' then b.attacker_fid else b.defender_fid end;
      if sfid is distinct from public._bt_bot_fid()
         and b.deadline_at is not null and b.deadline_at <= now() then
        begin perform public._bt_do_end_turn(b.id, sfid); exception when others then null; end;
        select * into b from public.battles where id = ev.battle_id;
        sfid := case when b.side_to_move = 'attacker' then b.attacker_fid else b.defender_fid end;
      end if;
      if b.status = 'active' and sfid = public._bt_bot_fid() then
        begin perform public._bt_bot_turn(b.id); exception when others then null; end;
      end if;
    end if;
  end if;
  select id into ev from public.fc_events order by created_at desc limit 1;
  return ev.id;
end$$;
revoke all on function public._fc_ensure() from public;

-- ── §9. Табло клуба ─────────────────────────────────────────
create or replace function public.fc_state()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare me text; ev record; party jsonb; im boolean;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid_opt();
  perform public._fc_ensure();
  select * into ev from public.fc_events order by created_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'fid', a.fid, 'name', public._war_nm(a.fid), 'ready', a.ready)
         order by a.created_at), '[]'::jsonb)
    into party
    from public.battle_allies a
   where a.battle_id = ev.battle_id and a.side = 'attacker';

  im := me is not null and (me = ev.duelist_a or exists(
          select 1 from public.battle_allies a
           where a.battle_id = ev.battle_id and a.fid = me));

  return jsonb_build_object(
    'event_id', ev.id, 'status', ev.status,
    'signup_until', ev.signup_until,
    'signups', (select count(*) from public.fc_signups where event_id = ev.id),
    'me', me,
    'me_signed', exists(select 1 from public.fc_signups where event_id = ev.id and fid = me),
    'duelist_a', ev.duelist_a, 'duelist_a_name', public._war_nm(ev.duelist_a),
    'duelist_b', ev.duelist_b, 'duelist_b_name', public._war_nm(ev.duelist_b),
    -- рев.10: сторона игроков — группа жребия; соперник — боты легиона
    'party', party,
    'party_n', jsonb_array_length(party),
    'vs_bot', (ev.duelist_b = public._bt_bot_fid()),
    'bot_edge', public._fc_bot_edge(),
    'party_max', public._fc_party_max(),
    'battle_id', ev.battle_id,
    'battle_status', (select status from public.battles where id = ev.battle_id),
    'budget', case when coalesce(ev.budget,0) > 0 then ev.budget else null end,
    'att_ready', (select att_ready from public.battles where id = ev.battle_id),
    'def_ready', (select def_ready from public.battles where id = ev.battle_id),
    'i_ready', exists(select 1 from public.battle_allies a
                       where a.battle_id = ev.battle_id and a.fid = me and a.ready),
    'battle_deadline', (select deadline_at from public.battles where id = ev.battle_id),
    'i_side', case when im then 'a' else null end,
    'npc_bet', case when ev.status = 'done' then ev.npc_bet else null end,
    'prize', case when coalesce(ev.prize,0) > 0 then ev.prize else public._fc_prize() end,
    'bet_cap', public._fc_bet_cap(),
    'pool_a', (select coalesce(sum(amount),0) from public.fc_bets
                where event_id = ev.id and on_fid = ev.duelist_a),
    'pool_b', (select coalesce(sum(amount),0) from public.fc_bets
                where event_id = ev.id and on_fid = ev.duelist_b),
    'bettors', (select count(*) from public.fc_bets where event_id = ev.id),
    'my_bets', (select coalesce(jsonb_agg(jsonb_build_object(
        'on', b.on_fid, 'on_name', public._war_nm(b.on_fid),
        'amount', b.amount, 'won', b.won) order by b.created_at), '[]'::jsonb)
      from public.fc_bets b where b.event_id = ev.id and b.fid = me),
    'my_bet', (select jsonb_build_object('on', b.on_fid, 'on_name', public._war_nm(b.on_fid),
                         'amount', b.amount, 'won', b.won)
      from public.fc_bets b where b.event_id = ev.id and b.fid = me order by b.created_at limit 1),
    'i_duel', im,
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

-- ── §10. Ставка: бойцам группы ставить нельзя ───────────────
create or replace function public.fc_bet(p_on text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; ev record; amt numeric; old record; other record; have numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  perform public._fc_ensure();
  select * into ev from public.fc_events order by created_at desc limit 1 for update;
  if ev.status <> 'live' then raise exception 'ставки принимаются только во время боя'; end if;
  if (select status from public.battles where id = ev.battle_id) = 'forming' then
    raise exception 'бойцы ещё расставляют флот — ставки откроются с началом боя';
  end if;
  if (select status from public.battles where id = ev.battle_id) = 'done' then
    raise exception 'бой окончен — кассы закрыты';
  end if;
  if me in (ev.duelist_a, ev.duelist_b)
     or exists(select 1 from public.battle_allies a
                where a.battle_id = ev.battle_id and a.fid = me) then
    raise exception 'бойцам ставить нельзя — вы и есть ставка';
  end if;
  if p_on is null or p_on not in (ev.duelist_a, ev.duelist_b) then
    raise exception 'ставить можно только на одну из сторон арены';
  end if;
  amt := floor(coalesce(p_amount, 0));
  if amt <= 0 then raise exception 'ставка должна быть больше нуля'; end if;

  select * into other from public.fc_bets
   where event_id = ev.id and fid = me and on_fid <> p_on limit 1;
  if other.fid is not null then
    raise exception 'вы уже поставили на %, на обе стороны ставить нельзя',
      public._war_nm(other.on_fid);
  end if;

  select * into old from public.fc_bets where event_id = ev.id and fid = me and on_fid = p_on;
  if coalesce(old.amount, 0) + amt > public._fc_bet_cap() then
    raise exception 'кап ставки — % ГС', public._fc_bet_cap()::bigint;
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

-- ── §11. Админский тест: арена против ботов ─────────────────
-- admin_test_duel(fid, 'bot') разворачивает клубную арену против легиона
-- в обход круга и кассы; со вторым реальным fid работает как раньше.
create or replace function public.admin_test_duel(p_a text, p_b text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare old uuid; sp jsonb;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  select battle_id into old from public.fc_test_duel where one = 1;
  if old is not null then delete from public.battles where id = old; end if;

  if p_b is null or p_b = public._bt_bot_fid() then
    sp := public._fc_spawn_bot_duel(array[p_a]);
  else
    sp := public._fc_spawn_duel(p_a, p_b);
  end if;

  insert into public.fc_test_duel(one, battle_id) values (1, (sp->>'battle_id')::uuid)
    on conflict (one) do update set battle_id = excluded.battle_id, created_at = now();

  return jsonb_build_object('ok', true, 'battle_id', sp->>'battle_id',
    'attacker_fid', p_a, 'defender_fid', coalesce(p_b, public._bt_bot_fid()),
    'budget', sp->>'budget', 'bots', sp->>'bots');
end$$;
revoke all on function public.admin_test_duel(text,text) from public;
grant execute on function public.admin_test_duel(text,text) to authenticated;

notify pgrst, 'reload schema';

-- ── Проверка ────────────────────────────────────────────────
-- 1) select public._fc_price_k(), public._fc_arena_price(id), name
--      from faction_units where faction_id in ('club','fac_5bfbfad5f8');
--    → цены клуба и вольницы в одном порядке величин.
-- 2) fc_state() → vs_bot=true после жеребьёвки, party = 1..3 державы,
--    duelist_b_name = имя легиона.
-- 3) Каждый из группы открывает доску, драфтит в рамках budget и жмёт «в бой»;
--    пока готовы не все — att_ready остаётся false, бой не стартует.
-- 4) После хода игроков fc_bot_turn(battle_id) прогоняет ход легиона
--    (клиент дёргает сам); ответ {ok:false,why:'сейчас ход игрока'} — норма.
-- 5) Уничтожили легион → fc_state().winner = держава-лидер, приз поделён
--    между party; проиграли → winner='bot', приз остался в клубе.
