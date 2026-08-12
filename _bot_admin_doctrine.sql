-- © 2025–2026. Все права защищены.
-- ═══════════════════════════════════════════════════════════════════
-- 🤖 ТЕСТОВЫЕ БОИ С БОТАМИ: ТОТ ЖЕ ЗАМЫСЕЛ, ЧТО И НА АРЕНЕ
-- ═══════════════════════════════════════════════════════════════════
-- ПОРЯДОК: после _bot_ai_brain.sql, _bot_roster_faction.sql,
-- _bot_doctrine.sql, _bot_engage_fix.sql, _bot_pressure.sql. Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК. Тактику (поле потока, фокус огня, давление на того, кто
-- бьёт дальше) боты и так берут из общего мозга — она работает в ЛЮБОМ бою,
-- где ходит fid бота. А вот СОСТАВ в тестовом бою по-прежнему набирался
-- жребием: `array_agg(id order by random())` и дальше по кругу, пока не
-- наберётся p_n бортов. Ни ролей, ни строя — и это ровно та «болванка для
-- битья», от которой ушла арена клуба.
--
-- ЧЕМ ОТЛИЧАЕТСЯ ОТ АРЕНЫ (и что с этим делаем со спавном)
--
--   • На арене драфт меряется БЮДЖЕТОМ, здесь — ШТУКАМИ: админ сам говорит,
--     сколько бортов выставить (p_n). Поэтому доли доктрины режут не казну,
--     а поголовье.
--   • Ростером может быть любая держава (p_bot_fid) или вообще весь каталог
--     («*»), а не одна вольница. Роль читается из ТТХ проекта, так что
--     доктрина работает на любом наборе.
--   • Спавн НЕ меняется: борта по-прежнему встают в свой сектор подхода
--     (_bt_ensure_field ставит сектора для боя любого вида). Меняется только
--     МОМЕНТ и ПОРЯДОК: раньше боты вставали при создании боя — то есть
--     до того, как админ расставит свой флот, и подобрать ответ было не из
--     чего. Теперь бой помнит замысел (bot_roster / bot_count / bot_design),
--     а борта выходят на гонге, из _fc_kick_off, когда чужой строй уже на
--     доске: тараны — по кромке к врагу, снайперы и поддержка — в тыл.
--     Если что-то пойдёт не так и гонг драфт пропустит, его добирает сам
--     ход бота — пустым легион на доску не выйдет.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. ЗАМЫСЕЛ ХРАНИТСЯ В БОЮ ───────────────────────────────────────
alter table public.battles add column if not exists bot_roster text;
alter table public.battles add column if not exists bot_count  int;
alter table public.battles add column if not exists bot_design uuid;

comment on column public.battles.bot_roster is
  'ростер ботов для отложенного драфта: fid державы или NULL = весь каталог';
comment on column public.battles.bot_count is
  'сколько бортов выставить ботам на гонге (тестовый бой админа)';
comment on column public.battles.bot_design is
  'если задан — все борта ботов по одному проекту (режим «против конкретного корабля»)';

-- ── 2. ДРАФТ ПО ШТУКАМ ──────────────────────────────────────────────
-- Тот же порядок, что и в _fc_place_bots: доли ролей от доктрины, роль
-- добирается по доле НАБРАННОГО, строй — по _bt_bot_slot. Разница одна:
-- меряем поголовьем, а не ГС.
create or replace function public._bt_bot_draft_n(p_battle uuid, p_roster text,
                                                  p_n int, p_design uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare bot text := public._bt_bot_fid();
        sp jsonb; fc int; n int := least(80, greatest(1, coalesce(p_n, 3)));
        doc jsonb; cand jsonb; roles text[]; rl text;
        by_role jsonb := '{}'::jsonb; dupcap int;
        pick_id uuid; pick_role text; placed int := 0; guard int := 0;
        xy int[]; sb jsonb;
begin
  perform public._bt_ensure_field(p_battle);
  select b.spawn into sp from public.battles b where b.id = p_battle;
  fc := public._bt_spawn_facing(sp, 'defender');
  doc := public._bt_bot_doctrine(p_battle, 'defender');
  dupcap := greatest(2, ceil(n / 3.0)::int);

  if p_design is not null then
    -- режим «против конкретного проекта»: доктрина ни при чём
    cand := jsonb_build_array(jsonb_build_object(
              'id', p_design, 'role', public._bt_bot_role_kit(p_design)));
    dupcap := n;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', fu.id, 'role', public._bt_bot_role_kit(fu.id))), '[]'::jsonb)
      into cand
      from public.faction_units fu
     where fu.category = 'ship'
       and coalesce((fu.summary->>'hp')::numeric, 0) > 0
       and not exists(select 1 from public.bt_bot_exclude bx where bx.unit_id = fu.id)
       and (case when p_roster is null then coalesce(fu.faction_id,'') <> 'club'
                 else fu.faction_id = p_roster end);
  end if;
  if coalesce(jsonb_array_length(cand), 0) = 0 then
    raise exception 'нет опубликованных кораблей (ship с hp>0) для ботов';
  end if;

  loop
    guard := guard + 1;
    exit when guard > 400 or placed >= n;

    select array_agg(q.rl order by q.fill, q.rl) into roles
      from (select r as rl,
                   coalesce((by_role->>r)::numeric, 0)
                     / greatest(0.01, coalesce((doc->>r)::numeric, 0) * n) as fill
              from unnest(array['brawler','skirm','sniper','support']) r) q;

    pick_id := null;
    foreach rl in array roles loop
      select (c->>'id')::uuid into pick_id
        from jsonb_array_elements(cand) c
       where c->>'role' = rl
         and (select count(*) from public.battle_units bu
               where bu.battle_id = p_battle and bu.unit_id = (c->>'id')::uuid) < dupcap
       order by (select count(*) from public.battle_units bu
                  where bu.battle_id = p_battle and bu.unit_id = (c->>'id')::uuid),
                random()
       limit 1;
      if pick_id is not null then pick_role := rl; exit; end if;
    end loop;

    -- роль не набралась ни одна (узкий ростер) — берём кого есть
    if pick_id is null then
      select (c->>'id')::uuid, c->>'role' into pick_id, pick_role
        from jsonb_array_elements(cand) c
       order by (select count(*) from public.battle_units bu
                  where bu.battle_id = p_battle and bu.unit_id = (c->>'id')::uuid),
                random()
       limit 1;
    end if;
    exit when pick_id is null;

    xy := public._bt_bot_slot(p_battle, pick_role);
    exit when xy is null;                       -- сектор забит
    sb := public._bt_stats(pick_id);
    if sb is null then exit; end if;

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil, ftl)
      values (p_battle, bot, 'defender', pick_id, sb->>'name', sb->>'cls', xy[1], xy[2],
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

    placed  := placed + 1;
    by_role := jsonb_set(by_role, array[pick_role],
                 to_jsonb(coalesce((by_role->>pick_role)::numeric, 0) + 1), true);
  end loop;

  if placed = 0 then raise exception 'ботам не нашлось свободных клеток в секторе'; end if;
  return jsonb_build_object('n', placed, 'doctrine', doc->>'why', 'by_role', by_role);
end$fn$;
revoke all on function public._bt_bot_draft_n(uuid,text,int,uuid) from public;

-- ── 3. ГОНГ ДЛЯ ОБОИХ ВИДОВ БОЯ ─────────────────────────────────────
-- Драфт вынесен в отдельную функцию: её же зовёт ход бота, если гонг по
-- какой-то причине драфт пропустил.
create or replace function public._bt_bot_draft_due(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare b record; res jsonb;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.defender_fid is distinct from public._bt_bot_fid() then
    return null;
  end if;
  if exists(select 1 from public.battle_units u
             where u.battle_id = p_battle and u.side = 'defender') then
    return null;                                  -- уже выставлены
  end if;

  if coalesce(b.bot_budget, 0) > 0 then           -- арена клуба: драфт на ГС
    res := public._fc_place_bots(p_battle, b.bot_budget);
    perform public._bt_log(p_battle, format(
      'Вольница выставила %s бортов на %s ГС. Замысел: %s.',
      (res->>'n'), (res->>'spent')::numeric::bigint, (res->>'doctrine')));
  elsif coalesce(b.bot_count, 0) > 0 then         -- тестовый бой: драфт по штукам
    res := public._bt_bot_draft_n(p_battle, b.bot_roster, b.bot_count, b.bot_design);
    perform public._bt_log(p_battle, format(
      '🤖 Боты вышли на доску: %s бортов. Замысел: %s.',
      (res->>'n'), (res->>'doctrine')));
  end if;
  return res;
end$fn$;
revoke all on function public._bt_bot_draft_due(uuid) from public;

create or replace function public._fc_kick_off(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $$
declare b record;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status <> 'forming' then return; end if;

  -- ДРАФТ БОТОВ. Строй игрока уже на доске — доктрина читает именно его.
  begin
    perform public._bt_bot_draft_due(p_battle);
  exception when others then
    perform public._bt_log(p_battle, 'Боты не смогли собрать состав: ' || sqlerrm);
  end;

  update public.battle_units set moved = false, fired = false, acted = false, flash = false
   where battle_id = p_battle and side = 'attacker';
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

-- Страховка: ход бота на пустой стороне сперва выставляет состав.
create or replace function public._bt_bot_turn(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare bot text := public._bt_bot_fid(); botside text;
        b record; pick uuid; skip uuid[] := '{}'; guard int := 0;
        st text; acts int; did boolean;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status <> 'active' then return; end if;
  perform public._bt_arm(p_battle);
  botside := b.side_to_move;
  if (botside = 'attacker' and b.attacker_fid <> bot)
     or (botside = 'defender' and b.defender_fid <> bot) then
    return;
  end if;

  if botside = 'defender'
     and not exists(select 1 from public.battle_units u
                     where u.battle_id = p_battle and u.side = 'defender') then
    begin perform public._bt_bot_draft_due(p_battle); exception when others then null; end;
  end if;

  perform public._bt_flow_build(p_battle, botside);
  perform public._bt_risk_build(p_battle, botside);
  perform public._bt_seen_arm(p_battle, botside);
  perform public._bt_bot_plan_build(p_battle, botside);

  loop
    guard := guard + 1;
    exit when guard > 60;
    select status, acts_left into st, acts from public.battles where id = p_battle;
    exit when st <> 'active' or coalesce(acts, 0) <= 0;

    perform public._bt_seen_arm(p_battle, botside);

    select bu.id into pick
      from public.battle_units bu
      left join lateral (select public._bt_bot_target(p_battle, bu.id) as tid) tg on true
     where bu.battle_id = p_battle and bu.side = botside and bu.alive
       and not bu.acted and not (bu.id = any(skip))
     order by
       (tg.tid is not null and exists(
          select 1 from public.battle_units z where z.id = tg.tid
            and z.hp + z.shield <= bu.dmg)) desc,
       (tg.tid is not null and tg.tid = public._bt_bot_focus(p_battle)) desc,
       (tg.tid is not null) desc,
       (public._bt_bot_repair(p_battle, bu.id) is not null) desc,
       coalesce((select min(public._bt_dist(bu.x, bu.y, t.x, t.y))
                   from public.battle_units t
                  where t.battle_id = p_battle and t.alive and t.side <> botside), 999) asc,
       bu.id
     limit 1;
    exit when pick is null;

    did := public._bt_bot_act(p_battle, pick, bot);
    if not did then skip := skip || pick; end if;
  end loop;

  delete from public.bt_bot_flow where battle_id = p_battle;
  delete from public.bt_bot_risk where battle_id = p_battle;
  delete from public.bt_bot_plan where battle_id = p_battle;

  select status into st from public.battles where id = p_battle;
  if st = 'active' then
    begin perform public._bt_do_end_turn(p_battle, bot); exception when others then null; end;
  end if;
end$fn$;
revoke all on function public._bt_bot_turn(uuid) from public;

-- ── 4. ТЕСТОВЫЙ БОЙ: ЗАПОМНИТЬ ЗАМЫСЕЛ ВМЕСТО РАССТАНОВКИ ───────────
create or replace function public.admin_bot_battle(p_my_ship uuid default null,
                                                   p_bot_ship uuid default null,
                                                   p_n int default 3,
                                                   p_bot_fid text default null)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; bot text := public._bt_bot_fid();
        sys text; bid uuid; old uuid; have int;
        rf text := case when btrim(coalesce(p_bot_fid,'')) in ('*','all') then null
                        else coalesce(nullif(btrim(coalesce(p_bot_fid,'')), ''),
                                      public._bt_bot_roster_default()) end;
        rf_expl boolean := nullif(btrim(coalesce(p_bot_fid,'')), '') is not null
                           and btrim(p_bot_fid) not in ('*','all');
        n int := least(80, greatest(1, coalesce(p_n,3)));
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  me := public._ec_my_fid();
  if me is null then raise exception 'нет фракции у текущего пользователя'; end if;
  if me = bot then raise exception 'fid игрока совпал с fid бота — поменяйте _bt_bot_fid()'; end if;

  select battle_id into old from public.admin_bot_duel where one = 1;
  if old is not null then delete from public.battles where id = old; end if;

  -- ростер проверяем СЕЙЧАС, чтобы бой не завёлся вхолостую
  if p_bot_ship is null then
    select count(*) into have from public.faction_units fu
     where fu.category = 'ship' and coalesce((fu.summary->>'hp')::numeric,0) > 0
       and not exists(select 1 from public.bt_bot_exclude bx where bx.unit_id = fu.id)
       and (case when rf is null then coalesce(fu.faction_id,'') <> 'club'
                 else fu.faction_id = rf end);
    if have = 0 then
      if rf_expl then
        raise exception 'у державы «%» нет своих опубликованных кораблей (ship с hp>0) — ботам нечем воевать',
          coalesce(nullif(public._war_nm(rf),''), rf);
      end if;
      rf := null;                                  -- ростер по умолчанию пуст: берём весь каталог
      select count(*) into have from public.faction_units fu
       where fu.category = 'ship' and coalesce((fu.summary->>'hp')::numeric,0) > 0
         and not exists(select 1 from public.bt_bot_exclude bx where bx.unit_id = fu.id)
         and coalesce(fu.faction_id,'') <> 'club';
      if have = 0 then
        raise exception 'нет опубликованных кораблей (ship с hp>0) для ботов';
      end if;
    end if;
  else
    rf := null;
  end if;

  select id into sys from public.map_systems order by random() limit 1;
  if sys is null then raise exception 'нет систем для арены'; end if;

  insert into public.battles(system_id, attacker_fid, defender_fid, status, kind,
                             att_ready, def_ready, side_to_move, turn_no, acts_left,
                             att_turns_left, def_turns_left, deadline_at,
                             bot_roster, bot_count, bot_design)
    values (sys, me, bot, 'forming', 'meeting', false, true, 'attacker', 0, public._bt_acts(),
            6, 6, null, rf, n, p_bot_ship)
    returning id into bid;

  perform public._bt_ensure_field(bid);            -- форма и сектора подхода

  perform public._bt_log(bid, '🤖 Тестовый бой с ботами'
    || case when rf is not null
            then ' · ростер державы «' || coalesce(nullif(public._war_nm(rf),''), rf) || '» (только её проекты)'
            else '' end
    || '. Ты — нападающий: расставь свой флот из полного каталога в СВОЁМ секторе подхода и жми «В бой». '
    || 'Боты выйдут по гонгу — состав они подберут ПОД ТВОЙ строй.');

  insert into public.admin_bot_duel(one, battle_id, bot_fid) values (1, bid, rf)
    on conflict (one) do update set battle_id = excluded.battle_id,
                                    bot_fid   = excluded.bot_fid,
                                    created_at = now();

  return jsonb_build_object('ok', true, 'battle_id', bid, 'n', n, 'phase', 'forming',
    'bot_fid', rf, 'bot_fname', case when rf is null then null
                                     else coalesce(nullif(public._war_nm(rf),''), rf) end);
end$fn$;
revoke all on function public.admin_bot_battle(uuid,uuid,int,text) from public;
grant execute on function public.admin_bot_battle(uuid,uuid,int,text) to authenticated;

notify pgrst, 'reload schema';

-- Проверка:
--   select public.admin_bot_battle(null, null, 8, 'fac_5bfbfad5f8');
--   → доска пустая со стороны ботов; после «В бой» в журнале появится
--     «🤖 Боты вышли на доску: N бортов. Замысел: …»
