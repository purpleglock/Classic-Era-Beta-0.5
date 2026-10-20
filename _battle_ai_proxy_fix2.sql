-- © 2025–2026. Все права защищены.
-- ═══════════════════════════════════════════════════════════════════
-- 🤖 ИИ ЗА ДЕРЖАВУ: КОРАБЛИ ВСЁ ЕЩЁ ВСТАВАЛИ ЗА АРЕНОЙ (21.10, второй заход)
-- ═══════════════════════════════════════════════════════════════════
-- ПОРЯДОК: после _battle_ai_proxy_fix.sql. Идемпотентно.
--
-- _bt_proxy_deploy читал бой ДО _bt_ensure_field, а форму арены и секторы
-- подхода тот создаёт только при первой расстановке. Поэтому в b.spawn и
-- b.shape лежал null: проверка «боя без секторов» срабатывала ложно, борт
-- снова уходил на легаси-край (x 56–59, y 0–1), а проверка «внутри арены»
-- пропускалась. Заодно с пустого spawn считался и курс бортов при старте.
-- Стало: после _bt_ensure_field бой перечитывается.
-- ═══════════════════════════════════════════════════════════════════

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
  -- ⚠️ ПЕРЕЧИТАТЬ: форму арены и секторы подхода _bt_ensure_field создаёт
  -- только что, а b прочитан ДО него — там shape/spawn ещё пустые.
  select * into b from public.battles where id = p_battle;
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
