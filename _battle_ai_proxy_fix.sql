-- © 2025–2026. Все права защищены.
-- ═══════════════════════════════════════════════════════════════════
-- 🤖 ИИ ЗА ДЕРЖАВУ: ПРАВКИ ПОСЛЕ ПЕРВОГО БОЯ (ALLMIND, 21.10)
-- ═══════════════════════════════════════════════════════════════════
-- ПОРЯДОК: после _battle_ai_proxy.sql. Идемпотентно.
--
-- 1) КОРАБЛЬ ЗА КАРТОЙ. _bt_proxy_deploy искал клетку через
--    _angel_free_hex: когда круг подхода заполнился (49 бортов при потолке
--    50), тот откатывался на легаси-«колонку у края» и ставил борт в пустоту
--    вне арены — ни сдвинуться, ни быть добитым, бой не кончался.
--    Стало: только свой сектор подхода (_bt_spawn_free); сектор полон —
--    расстановка на этом заканчивается. Легаси-край — лишь для боёв без
--    секторов, и то с проверкой, что клетка внутри арены.
--
-- 2) БОЙ НЕ КОНЧАЛСЯ ПРИ РЕЗЕРВЕ. Сторона проигрывает, когда у неё нет ни
--    бортов на доске, ни резерва; живой игрок тянет резерв подкреплениями,
--    а ИИ подкреплений не вызывает — бой зависал на пустой доске.
--    Решение (21.10): у державы под ИИ (faction_battle_ai) резерв в зачёт
--    не идёт — пустая доска = поражение. NPC, бот-бои и живые игроки —
--    как раньше.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Расстановка: только внутри своего сектора ─────────────
create or replace function public._bt_proxy_deploy(p_battle uuid, p_fid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; fsd text; fc int; cap int; n int := 0; c record; st jsonb; xy int[];
        ally record; notready int;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or b.status <> 'forming' then
    return jsonb_build_object('ok', true, 'skip', 'бой не в расстановке');
  end if;
  if b.kind in ('ground', 'duel') then
    return jsonb_build_object('ok', true, 'skip', 'не космический бой');
  end if;
  fsd := public._bt_side(p_battle, p_fid);
  if fsd is null then return jsonb_build_object('ok', true, 'skip', 'держава не в этом бою'); end if;

  select * into ally from public.battle_allies where battle_id = p_battle and fid = p_fid;
  if ally.fid is not null then
    if ally.ready then return jsonb_build_object('ok', true, 'skip', 'уже готова'); end if;
  elsif (fsd = 'attacker' and b.att_ready) or (fsd = 'defender' and b.def_ready) then
    return jsonb_build_object('ok', true, 'skip', 'сторона уже готова');
  end if;

  perform public._bt_arm(p_battle);
  perform public._bt_ensure_field(p_battle);
  fc  := public._bt_spawn_facing(b.spawn, fsd);
  cap := public._bt_cap();

  select count(*) into n from public.battle_units where battle_id = p_battle and fid = p_fid;

  for c in
    with pool as (
      select (e->>'unit_id')::uuid as uid,
             sum(greatest(0, coalesce((e->>'qty')::int, 0)))::int as qty
        from public.battle_fleets bf
        join public.fleets f on f.id = bf.fleet_id
        cross join lateral jsonb_array_elements(coalesce(f.composition, '[]'::jsonb)) e
       where bf.battle_id = p_battle and bf.fid = p_fid
         and nullif(e->>'unit_id', '') is not null
       group by 1
    ), left_ as (
      select p.uid, p.qty - (select count(*) from public.battle_units u
                              where u.battle_id = p_battle and u.fid = p_fid and u.unit_id = p.uid)::int as qty,
             coalesce((select (fu.summary->>'cost')::numeric from public.faction_units fu where fu.id = p.uid), 0) as cost
        from pool p
    )
    select l.uid, g.i
      from left_ l cross join lateral generate_series(1, greatest(0, l.qty)) g(i)
     order by g.i, l.cost desc, l.uid
  loop
    exit when n >= cap;
    begin st := public._bt_stats(c.uid); exception when others then st := null; end;
    continue when st is null;

    -- Только свой сектор подхода. Полон — больше не ставим.
    xy := public._bt_spawn_free(p_battle, case when fsd = 'attacker' then 'att' else 'def' end);
    if xy is null and b.spawn is null then
      xy := public._angel_free_hex(p_battle, fsd);          -- легаси-бой без секторов
    end if;
    exit when xy is null;
    exit when b.shape is not null and not public._bt_in_arena(b.shape, xy[1], xy[2]);

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil, ftl)
      values (p_battle, p_fid, fsd, c.uid, st->>'name', st->>'cls', xy[1], xy[2],
        (st->>'hp')::numeric, (st->>'hp')::numeric, (st->>'armor')::numeric,
        coalesce((st->>'shield')::numeric, 0), coalesce((st->>'shield')::numeric, 0),
        (st->>'dmg')::numeric, (st->>'speed')::int, (st->>'rng')::int,
        fc, public._bt_turnneed(st->>'cls'),
        coalesce((st->>'sensor')::int, 0), coalesce((st->>'stealth')::int, 0),
        st->'wpn', st->'resist',
        coalesce((st->>'pd')::numeric, 0), coalesce((st->>'jam')::int, 0),
        coalesce((st->>'wings')::int, 0), coalesce((st->>'dejam')::int, 0),
        coalesce((st->>'eccm')::int, 0), coalesce((st->>'interdict')::bool, false),
        coalesce((st->>'stabil')::bool, false), coalesce((st->>'ftl')::bool, false));
    n := n + 1;
  end loop;

  if ally.fid is not null then
    update public.battle_allies set ready = true where battle_id = p_battle and fid = p_fid;
    select count(*) into notready from public.battle_allies
     where battle_id = p_battle and side = fsd and not ready;
  else
    notready := 0;
  end if;
  if notready = 0 then
    if fsd = 'attacker' then update public.battles set att_ready = true where id = p_battle;
    else                     update public.battles set def_ready = true where id = p_battle; end if;
  end if;

  perform public._bt_log(p_battle, format(
    'Командование державы отсутствует — флот в бой выводит ИИ штаба. Бортов на поле: %s.', n));

  select * into b from public.battles where id = p_battle;
  if b.status = 'forming' and b.att_ready and b.def_ready then
    perform public._fc_kick_off(p_battle);
  end if;
  select * into b from public.battles where id = p_battle;
  return jsonb_build_object('ok', true, 'placed', n, 'side', fsd, 'started', (b.status = 'active'));
end $$;
revoke all on function public._bt_proxy_deploy(uuid, text) from public, anon, authenticated;

-- ── 2. Конец боя: у державы под ИИ резерв не в зачёт ─────────
create or replace function public._bt_check_end(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b record; a_alive int; d_alive int; a_pool int; d_pool int;
        win text; is_bot boolean; af text;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status = 'done' then return; end if;
  if b.kind = 'ground' then perform public._ground_check_end(p_battle); return; end if;
  if b.status <> 'active' then return; end if;

  select count(*) filter (where coalesce(pk->'hj'->>'s', side) = 'attacker'),
         count(*) filter (where coalesce(pk->'hj'->>'s', side) = 'defender')
    into a_alive, d_alive
    from public.battle_units where battle_id = p_battle and alive;

  -- ── ◈ ПРЕСТОЛ: доска пуста — сражение отгремело ───────────
  af := public._angel_ark_bt(p_battle);
  if af is not null then
    if (b.attacker_fid = af and d_alive = 0)
       or (b.defender_fid = af and a_alive = 0)
       -- ковчега на доске не стало (пал по печатям, снят админом) — тоже конец
       or not exists (select 1 from public.battle_units u
                       where u.battle_id = p_battle and u.cls = 'angel' and u.alive) then
      perform public._angel_slip(p_battle);
    end if;
    return;
  end if;

  select exists(select 1 from public.admin_bot_duel where one = 1 and battle_id = p_battle)
    into is_bot;

  if is_bot then
    if a_alive = 0 then win := b.defender_fid;
    elsif d_alive = 0 then win := b.attacker_fid;
    end if;
  else
    select coalesce(jsonb_array_length(public.battle_pool(p_battle, b.attacker_fid)),0) into a_pool;
    select coalesce(jsonb_array_length(public.battle_pool(p_battle, b.defender_fid)),0) into d_pool;
    -- Держава под ИИ подкреплений не вызывает: её резерв в зачёт не идёт.
    if exists (select 1 from public.faction_battle_ai a where a.fid = b.attacker_fid) then a_pool := 0; end if;
    if exists (select 1 from public.faction_battle_ai a where a.fid = b.defender_fid) then d_pool := 0; end if;
    if a_alive = 0 and a_pool = 0 then win := b.defender_fid;
    elsif d_alive = 0 and d_pool = 0 then win := b.attacker_fid;
    end if;
  end if;

  if win is null then return; end if;
  perform public._bt_finish(p_battle, win);
end $$;
