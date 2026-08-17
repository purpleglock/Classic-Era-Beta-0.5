-- ════════════════════════════════════════════════════════════
-- 17.08 «бой упал :D» — точнее, встал намертво: «ЖДЁМ ВРАГА» навсегда.
--
-- Причина: боевой ИИ знал ровно ОДНОГО машинного игрока — fid 'bot' (арена
-- клуба и тестовые бои). Легион (fid 'legion') в бою был просто фракцией без
-- живого владельца: на доску никто не выставлялся, готовность никто не жал,
-- ходов никто не делал. Бой оставался в forming вечно.
-- До сегодняшнего дня это никого не жгло, потому что флотов у Легиона не было
-- вообще (см. legion-teeth) — до доски боя дело просто не доходило.
--
-- Здесь: (1) понятие «машинная сторона» вместо одного зашитого fid,
--        (2) расстановка Легиона СВОИМИ кораблями из состава его флота
--            (не драфт по каталогу: на доску выходит ровно та ватага, что
--            стоит в системе — сколько кораблей, столько и бортов),
--        (3) ход Легиона тем же мозгом, что у ботов клуба.
--
-- ЦЕПОЧКА: после _legion_standoff.sql. Идемпотентно.
-- ════════════════════════════════════════════════════════════

-- ── 1) Кто в бою «машина» ─────────────────────────────────────────────
create or replace function public._bt_is_machine(p_fid text)
returns boolean language sql stable as $$
  select p_fid is not null
     and (p_fid = public._bt_bot_fid() or p_fid = public._legion_fid())
$$;

-- ── 2) Ватага выходит на доску своим составом ─────────────────────────
-- Берём корабли из composition флотов Легиона, привязанных к бою, и ставим
-- их в его сектор подхода. Роль каждого борта считаем тем же _bt_bot_role_kit,
-- что и у ботов, — чтобы драчун лез вперёд, а снайпер стоял позади.
create or replace function public.legion_battle_deploy(p_battle uuid)
returns jsonb language plpgsql security definer as $$
declare b record; lf text := public._legion_fid(); sd text; fc int;
        e record; st jsonb; xy int[]; n int := 0; i int;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.id is null then return jsonb_build_object('ok', false, 'why', 'нет боя'); end if;
  if b.status <> 'forming' then return jsonb_build_object('ok', false, 'why', 'бой уже идёт'); end if;

  sd := case when b.attacker_fid = lf then 'attacker'
             when b.defender_fid = lf then 'defender' else null end;
  if sd is null then return jsonb_build_object('ok', false, 'why', 'Легион не в этом бою'); end if;
  if exists (select 1 from public.battle_units u
              where u.battle_id = p_battle and u.fid = lf) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  perform public._bt_ensure_field(p_battle);
  fc := public._bt_spawn_facing(b.spawn, sd);

  -- разворачиваем состав в отдельные борта: qty=2 → два корабля на доске
  for e in
    select (c->>'unit_id')::uuid uid, greatest(1, coalesce((c->>'qty')::int,1)) qty
      from public.battle_fleets bf
      join public.fleets f on f.id = bf.fleet_id
      cross join lateral jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
     where bf.battle_id = p_battle and bf.fid = lf
  loop
    st := public._bt_stats(e.uid);
    if st is null then continue; end if;        -- мёртвая ссылка на проект — пропускаем борт
    for i in 1 .. least(e.qty, 40) loop
      xy := public._bt_bot_slot_side(p_battle, public._bt_bot_role_kit(e.uid), sd);
      exit when xy is null;                      -- сектор подхода забит
      insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
          hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
          facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
          dejam, eccm, interdict, stabil, ftl)
        values (p_battle, lf, sd, e.uid, st->>'name', st->>'cls', xy[1], xy[2],
          (st->>'hp')::numeric, (st->>'hp')::numeric, (st->>'armor')::numeric,
          (st->>'shield')::numeric, (st->>'shield')::numeric, (st->>'dmg')::numeric,
          (st->>'speed')::int, (st->>'rng')::int,
          fc, public._bt_turnneed(st->>'cls'), (st->>'sensor')::int, (st->>'stealth')::int,
          st->'wpn', st->'resist', (st->>'pd')::numeric, (st->>'jam')::numeric,
          (st->>'wings')::int, (st->>'dejam')::numeric, (st->>'eccm')::numeric,
          (st->>'interdict')::boolean, (st->>'stabil')::boolean, (st->>'ftl')::boolean);
      n := n + 1;
    end loop;
  end loop;

  if n = 0 then return jsonb_build_object('ok', false, 'why', 'нечего выставить'); end if;

  -- Легион готов сразу: у пиратов нет штаба, который совещается
  if sd = 'attacker' then update public.battles set att_ready = true where id = p_battle;
  else                     update public.battles set def_ready = true where id = p_battle; end if;

  perform public._bt_log(p_battle,
    format('☠ Ватага Железного Легиона вышла на позиции: %s бортов.', n));

  select * into b from public.battles where id = p_battle;
  if b.att_ready and b.def_ready then perform public._fc_kick_off(p_battle); end if;

  return jsonb_build_object('ok', true, 'placed', n, 'side', sd,
                            'started', (b.att_ready and b.def_ready));
end $$;

grant execute on function public.legion_battle_deploy(uuid) to authenticated;

-- ── 3) Ход машинной стороны: тот же мозг, но не только для 'bot' ──────
create or replace function public._bt_bot_turn(p_battle uuid)
returns void language plpgsql security definer as $$
declare bot text; botside text;
        b record; pick uuid; skip uuid[] := '{}'; guard int := 0;
        st text; acts int; did boolean;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status <> 'active' then return; end if;
  perform public._bt_arm(p_battle);
  botside := b.side_to_move;
  -- ⚠ было: сравнение с одним зашитым fid 'bot'. Теперь ходит ЛЮБАЯ машинная
  -- сторона — и боты клуба, и Железный Легион.
  bot := case when botside = 'attacker' then b.attacker_fid else b.defender_fid end;
  if not public._bt_is_machine(bot) then return; end if;

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

  select * into b from public.battles where id = p_battle;
  if b.status = 'active' and b.side_to_move is distinct from botside then
    begin
      perform public._bt_ally_turn(p_battle, greatest(1, public._bt_acts() / 2));
    exception when others then null; end;
  end if;
end $$;

-- ── 4) Дверь для клиента: ход машинной стороны может запросить любой,
--      кто смотрит доску (у Легиона нет своей сессии, как и у ботов).
create or replace function public.fc_bot_turn(p_battle uuid)
returns jsonb language plpgsql security definer as $$
declare b record; sfid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.status <> 'active' then return jsonb_build_object('ok', false, 'why', 'бой не идёт'); end if;
  sfid := case when b.side_to_move = 'attacker' then b.attacker_fid else b.defender_fid end;
  if not public._bt_is_machine(sfid) then
    return jsonb_build_object('ok', false, 'why', 'сейчас ход игрока');
  end if;
  perform public._bt_bot_turn(p_battle);
  return jsonb_build_object('ok', true);
end $$;

-- ── 5) Ватага выходит на доску сразу, как бой завязался ───────────────
create or replace function public.legion_standoff_tick()
returns jsonb language plpgsql security definer as $$
declare k record; foe record; b uuid; nm text; n int := 0; d int := 0;
begin
  for k in select c.*, f.id fid_fleet
             from public.legion_contacts c
             join public.fleets f on f.id = c.fleet_id
            where c.state = 'engaged' and c.fleet_id is not null loop

    if exists (select 1 from public.battles b2
                where b2.system_id = k.target_sys
                  and b2.status not in ('done','finished','ended','cancelled')) then
      -- бой уже идёт: если Легион в нём ещё не расставлен — вывести ватагу
      for b in select b2.id from public.battles b2
                where b2.system_id = k.target_sys and b2.status = 'forming'
                  and (b2.attacker_fid = public._legion_fid()
                    or b2.defender_fid = public._legion_fid()) loop
        begin
          if (public.legion_battle_deploy(b)->>'ok')::boolean then d := d + 1; end if;
        exception when others then null; end;
      end loop;
      continue;
    end if;

    select f.* into foe from public.fleets f
     where f.system_id = k.target_sys
       and f.faction_id is distinct from public._legion_fid()
       and f.status = 'idle'
       and coalesce(jsonb_array_length(f.composition),0) > 0
     order by (select coalesce(sum((c->>'qty')::int),0)
                 from jsonb_array_elements(f.composition) c) desc
     limit 1;
    if foe.id is null then continue; end if;

    b := public._war_engage(k.fleet_id, foe.id, k.target_sys, 'meeting');
    if b is null then continue; end if;

    -- сразу ставим ватагу на доску: живого штаба у пиратов нет, ждать нечего
    begin
      if (public.legion_battle_deploy(b)->>'ok')::boolean then d := d + 1; end if;
    exception when others then null; end;

    nm := coalesce((select ms.name from public.map_systems ms where ms.id = k.target_sys),
                   k.target_sys);
    perform public._legion_news(foe.faction_id, '⚔ Бой с ватагой Легиона',
      format('Ватага Железного Легиона в системе «%s» не стала ждать: пираты навязали бой вашему флоту. Сражение началось — доска боя в разделе «Горячие точки».', nm));
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'battles', n, 'deployed', d);
end $$;
