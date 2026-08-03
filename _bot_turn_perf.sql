-- ═══════════════════════════════════════════════════════════════════
-- ХОД БОТА УПИРАЛСЯ В statement_timeout (57014)
-- ═══════════════════════════════════════════════════════════════════
-- У роли authenticated лимит 8 с на запрос. Ход бота на встречном бою
-- 60×60 с 23 бортами в него не влезал: игрок жал «завершить ход» и
-- получал сырой 57014 вместо хода противника.
--
-- Где утекало время. _bt_bot_target на КАЖДУЮ цель проверяет «видит ли
-- её хоть кто-то из наших», а внутри на каждую пару (наш, цель) заново
-- считается _bt_ecm — то есть скан всех глушилок доски. Это n³ на один
-- вызов, ≈16 мс при 23 бортах. А _bt_bot_turn вызывает его (и парный
-- _bt_bot_repair) для всех неактивированных бортов на КАЖДОЙ итерации
-- цикла выбора — два десятка вызовов на итерацию, десяток итераций.
--
-- Что делаем: захват радаром считаем ОДИН раз за итерацию и кладём в
-- транзакционную переменную bt.seen (ключ — бой+сторона, чтобы кэш не
-- утёк на чужой расчёт). _bt_bot_target читает готовый список. Логика
-- выбора цели не меняется ни на гекс: тот же захват, те же приоритеты.
-- Кэша нет (ручной вызов, admin_bot_turn) — считает по-старому.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Захват радаром стороны: список видимых вражеских бортов ──────
create or replace function public._bt_seen_calc(p_battle uuid, p_side text)
returns uuid[] language sql stable security definer set search_path=public as $$
  -- Помеху на каждого НАШЕГО считаем один раз (было — на каждую пару).
  with mine as (
    select m.id, m.x, m.y, m.facing,
           greatest(0, m.sensor - greatest(0, public._bt_ecm(p_battle, m.side, m.x, m.y) - m.eccm)) as rng
      from public.battle_units m
     where m.battle_id = p_battle and m.side = p_side and m.alive
  )
  select coalesce(array_agg(t.id), '{}'::uuid[])
    from public.battle_units t
   where t.battle_id = p_battle and t.alive and t.side <> p_side
     and exists(select 1 from mine m
                 where public._bt_detected(m.x, m.y, m.facing, m.rng,
                                           t.x, t.y, t.stealth, t.flash))
$$;
revoke all on function public._bt_seen_calc(uuid,text) from public;

-- Взвести кэш захвата на транзакцию. Ключ — бой:сторона.
create or replace function public._bt_seen_arm(p_battle uuid, p_side text)
returns void language plpgsql security definer set search_path=public as $$
declare ids uuid[];
begin
  ids := public._bt_seen_calc(p_battle, p_side);
  perform set_config('bt.seen_key', p_battle::text || ':' || p_side, true);
  perform set_config('bt.seen', array_to_string(ids, ','), true);
end$$;
revoke all on function public._bt_seen_arm(uuid,text) from public;

-- Прочитать кэш: null — кэша на эту пару нет, считать по-старому.
-- Пустой массив — валидный ответ «не видно никого», это НЕ то же, что null.
create or replace function public._bt_seen_get(p_battle uuid, p_side text)
returns uuid[] language plpgsql stable security definer set search_path=public as $$
declare k text; v text;
begin
  k := nullif(current_setting('bt.seen_key', true), '');
  if k is distinct from (p_battle::text || ':' || p_side) then return null; end if;
  v := coalesce(current_setting('bt.seen', true), '');
  if v = '' then return '{}'::uuid[]; end if;
  return string_to_array(v, ',')::uuid[];
end$$;
revoke all on function public._bt_seen_get(uuid,text) from public;

-- ── 2. Выбор цели: тот же отбор, но захват берём из кэша ────────────
create or replace function public._bt_bot_target(p_battle uuid, p_unit uuid)
returns uuid language plpgsql stable security definer set search_path=public as $fn$
declare u record; b record; maxr int; res uuid; seen uuid[];
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null or not u.alive or u.fired then return null; end if;
  select * into b from public.battles where id = p_battle;

  select max((g->>'rng')::int) into maxr
    from jsonb_array_elements(
      case when u.wpn is null or jsonb_array_length(u.wpn) = 0
           then jsonb_build_array(jsonb_build_object('rng',u.rng,'dmg',u.dmg))
           else u.wpn end) g
   where coalesce(g->>'k','kinetic') <> 'repair'
     and coalesce((g->>'dmg')::numeric, 0) > 0;
  if coalesce(maxr, 0) < 1 then return null; end if;

  seen := public._bt_seen_get(p_battle, u.side);
  if seen is null then seen := public._bt_seen_calc(p_battle, u.side); end if;
  if array_length(seen, 1) is null then return null; end if;   -- никого не видно

  select t.id into res from public.battle_units t
   where t.battle_id = p_battle and t.alive and t.side <> u.side
     and t.id = any(seen)
     and public._bt_dist(u.x, u.y, t.x, t.y) between 1 and maxr
     and public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y)
   order by ((t.hp + t.shield) <= coalesce(u.dmg, 0)) desc,
            (t.hp + t.shield) asc,
            public._bt_dist(u.x, u.y, t.x, t.y) asc, t.id
   limit 1;
  return res;
end$fn$;
revoke all on function public._bt_bot_target(uuid,uuid) from public;

-- ── 3. Ход бота: считать захват раз за итерацию, а не раз на борт ───
create or replace function public._bt_bot_turn(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare bot text := public._bt_bot_fid(); botside text;
        b record; u record; pick uuid; tgt uuid; path jsonb;
        skip uuid[] := '{}'; guard int := 0; did boolean;
        st text; acts int; maxr int; goal int; exid uuid; seen boolean;
        tx int; ty int;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status <> 'active' then return; end if;
  perform public._bt_arm(p_battle);
  botside := b.side_to_move;
  if (botside = 'attacker' and b.attacker_fid <> bot)
     or (botside = 'defender' and b.defender_fid <> bot) then
    return;
  end if;

  loop
    guard := guard + 1;
    exit when guard > 200;                       -- страховка от вечного цикла
    select status, acts_left into st, acts from public.battles where id = p_battle;
    exit when st <> 'active' or coalesce(acts, 0) <= 0;

    -- Захват радаром меняется от выстрелов (flash) и манёвров, поэтому
    -- пересчитываем его на каждой итерации — но ОДИН раз, а не на борт.
    perform public._bt_seen_arm(p_battle, botside);

    pick := null;
    for exid in select bu.id from public.battle_units bu
                 where bu.battle_id = p_battle and bu.side = botside and bu.alive
                   and not bu.acted and not (bu.id = any(skip))
                 order by bu.id loop
      if public._bt_bot_target(p_battle, exid) is not null
         or public._bt_bot_repair(p_battle, exid) is not null then
        pick := exid; exit;
      end if;
    end loop;
    if pick is null then
      select bu.id into pick from public.battle_units bu
        where bu.battle_id = p_battle and bu.side = botside and bu.alive
          and not bu.acted and not (bu.id = any(skip))
          and not bu.moved and coalesce(bu.speed,0) > 0 and bu.cls is distinct from 'ss13'
        order by coalesce((select min(public._bt_dist(bu.x, bu.y, t.x, t.y))
                             from public.battle_units t
                            where t.battle_id = p_battle and t.alive and t.side <> botside), 999),
                 bu.id
        limit 1;
    end if;
    exit when pick is null;

    select * into u from public.battle_units where id = pick;
    did := false;

    if coalesce(u.wings,0) > 0 and not u.is_wing then
      select exists(select 1 from public.battle_units t
                     where t.battle_id = p_battle and t.alive and t.side <> botside
                       and public._bt_dist(u.x, u.y, t.x, t.y) <= 10) into seen;
      if seen then
        begin perform public._bt_do_launch(p_battle, u.id, bot); did := true;
        exception when others then null; end;
      end if;
    end if;

    tgt := public._bt_bot_repair(p_battle, u.id);
    if tgt is not null then
      begin perform public._bt_do_fire(p_battle, u.id, tgt, bot); did := true;
      exception when others then null; end;
    else
      tgt := public._bt_bot_target(p_battle, u.id);

      if tgt is null and not u.moved and coalesce(u.speed,0) > 0 and u.cls is distinct from 'ss13' then
        select max((g->>'rng')::int) into maxr
          from jsonb_array_elements(
            case when u.wpn is null or jsonb_array_length(u.wpn) = 0
                 then jsonb_build_array(jsonb_build_object('rng',u.rng,'dmg',u.dmg))
                 else u.wpn end) g
         where coalesce(g->>'k','kinetic') <> 'repair'
           and coalesce((g->>'dmg')::numeric, 0) > 0;
        -- «видит ли сторона хоть кого-то» — из того же кэша захвата
        seen := coalesce(array_length(public._bt_seen_get(p_battle, botside), 1), 0) > 0;
        goal := case when seen then greatest(1, coalesce(maxr, u.rng, 3)) else 3 end;

        tx := null; ty := null;
        select t.x, t.y into tx, ty from public.battle_units t
          where t.battle_id = p_battle and t.alive and t.side <> botside
          order by public._bt_dist(u.x, u.y, t.x, t.y), t.id limit 1;
        if tx is not null then
          path := public._bt_bot_path(p_battle, u.id, tx, ty, goal);
          if coalesce(jsonb_array_length(path), 0) > 0 then
            begin perform public._bt_do_move(p_battle, u.id, path, bot); did := true;
            exception when others then null; end;
            -- борт сдвинулся: старый захват больше не описывает доску
            perform public._bt_seen_arm(p_battle, botside);
          end if;
        end if;
        tgt := public._bt_bot_target(p_battle, u.id);
      end if;

      if tgt is not null then
        begin perform public._bt_do_fire(p_battle, u.id, tgt, bot); did := true;
        exception when others then null; end;
      end if;
    end if;

    if not did then skip := skip || pick; end if;
  end loop;

  select status into st from public.battles where id = p_battle;
  if st = 'active' then
    begin perform public._bt_do_end_turn(p_battle, bot); exception when others then null; end;
  end if;
end$fn$;
revoke all on function public._bt_bot_turn(uuid) from public;

notify pgrst, 'reload schema';

-- Проверка:
--   select public._bt_seen_calc('<battle>', 'defender');   → массив видимых
--   select public.admin_bot_turn('<battle>');              → укладывается в 8 с
