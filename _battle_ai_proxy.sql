-- © 2025–2026. Все права защищены.
-- ═══════════════════════════════════════════════════════════════════
-- 🤖 ИИ ВМЕСТО ОТСУТСТВУЮЩЕГО ИГРОКА — ТОЛЬКО В КОСМИЧЕСКИХ БОЯХ
-- ═══════════════════════════════════════════════════════════════════
-- ЗАЧЕМ. Держава ушла в АФК, а на неё напали: бой висит в расстановке, пока
-- хозяин не вернётся, и атакующий сутками ждёт. Боевой ИИ у нас уже есть
-- (легион, Престол, бот-бои) — не хватало только способа посадить его за
-- обычную державу игрока.
--
-- КАК СДЕЛАНО
--   • faction_battle_ai — держава, за которую в боях играет ИИ. Ставит и
--     снимает только стафф (admin_faction_battle_ai). Экономика, карта,
--     ноты и всё прочее остаются за игроком — ИИ трогает ТОЛЬКО доску боя.
--   • _bt_is_machine_in(бой, fid) — «машина» ли эта сторона в ЭТОМ бою:
--     прежние NPC или держава из реестра. Наземные бои и дуэли клуба не
--     трогаем: у наземки свой движок и своё ополчение, дуэль — личное дело.
--   • _bt_proxy_deploy — расстановка за державу: её же флоты, записанные в
--     бой, ничего не дарим. Борта берутся вперемешку по типам (дорогие
--     первыми), до потолка доски. Затем готовность и старт, если вторая
--     сторона уже готова.
--   • legion_ai_tick (крон раз в минуту) — расставляет такие бои и ходит в
--     них тем же _bt_bot_turn, что и за легион.
--   • _bt_bot_turn — пускает в ход и державу из реестра. Добор флота
--     «из воздуха» (_bt_bot_draft_due) — только для настоящих NPC.
--
-- Идемпотентно. ПОРЯДОК: после _legion_ai_cron.sql, _bot_allies.sql,
-- _angel_absent_deploy (_angel_floor.sql).
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.faction_battle_ai (
  fid        text primary key,
  enabled_by uuid,
  enabled_at timestamptz not null default now()
);
alter table public.faction_battle_ai enable row level security;
drop policy if exists fbai_read on public.faction_battle_ai;
create policy fbai_read on public.faction_battle_ai for select using (true);

-- ── «Машина» ли сторона в этом бою ──────────────────────────
create or replace function public._bt_is_machine_in(p_battle uuid, p_fid text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_fid is not null and (
    public._bt_is_machine(p_fid)
    or (exists (select 1 from public.faction_battle_ai a where a.fid = p_fid)
        and exists (select 1 from public.battles b
                     where b.id = p_battle and b.kind not in ('ground', 'duel'))))
$$;

-- ── Расстановка за державу ───────────────────────────────────
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

  -- Что игрок успел расставить сам — оставляем; добираем до потолка.
  select count(*) into n from public.battle_units where battle_id = p_battle and fid = p_fid;

  -- Резерв: борта флотов державы в этом бою, разложенные в «очередь» —
  -- i-й экземпляр каждого типа, внутри круга дорогие первыми. Так на доску
  -- выходит смесь, а не пятьдесят одинаковых корпусов.
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
    xy := public._angel_free_hex(p_battle, fsd);
    exit when xy is null;

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

  -- Готовность — как в battle_ready: союзник отмечается в battle_allies,
  -- сторона готова, когда готовы все её союзники.
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

-- ── Ход машины: пускаем и державу из реестра ─────────────────
create or replace function public._bt_bot_turn(p_battle uuid) returns void
language plpgsql security definer as $$
declare bot text; botside text;
        b record; pick uuid; skip uuid[] := '{}'; guard int := 0;
        st text; acts int; did boolean;
        au uuid; foes int; cap int; i int; ang boolean := false;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status <> 'active' then return; end if;
  perform public._bt_arm(p_battle);
  botside := b.side_to_move;
  bot := case when botside = 'attacker' then b.attacker_fid else b.defender_fid end;
  if not public._bt_is_machine_in(p_battle, bot) then return; end if;

  -- Добор флота из ростера — только настоящим NPC. За державу игрока ИИ
  -- воюет тем, что она сама привела в бой.
  if botside = 'defender' and public._bt_is_machine(bot)
     and not exists(select 1 from public.battle_units u
                     where u.battle_id = p_battle and u.side = 'defender') then
    begin perform public._bt_bot_draft_due(p_battle); exception when others then null; end;
  end if;

  perform public._bt_flow_build(p_battle, botside);
  perform public._bt_risk_build(p_battle, botside);
  perform public._bt_seen_arm(p_battle, botside);
  perform public._bt_bot_plan_build(p_battle, botside);

  -- ── ◈ ПРЕСТОЛ: ОДИН БОРТ, ШЕСТЬ АКТИВАЦИЙ ─────────────────
  ang := public._angel_is(bot);
  if ang then
    select bu.id into au from public.battle_units bu
     where bu.battle_id = p_battle and bu.side = botside and bu.alive
       and bu.fid = bot and bu.cls = 'angel' limit 1;

    if au is not null then
      cap := greatest(1, public._angel_bt_const('acts_per_turn')::int);
      for i in 1..cap loop
        select status into st from public.battles where id = p_battle;
        exit when st <> 'active';
        select count(*) into foes from public.battle_units z
         where z.battle_id = p_battle and z.alive and z.side <> botside;
        exit when foes = 0;

        -- Борт поднимается заново: активация возвращается ему и стороне.
        -- ⚠️ Только ковчегу и только внутри его собственного хода.
        update public.battle_units
           set acted = false, moved = false, fired = false
         where id = au;
        update public.battles
           set acts_left = greatest(coalesce(acts_left,0), 1) where id = p_battle;

        perform public._bt_seen_arm(p_battle, botside);
        did := public._bt_bot_act(p_battle, au, bot);
        exit when not did;          -- бить некого и идти некуда — хватит
      end loop;

      -- Ковчег отработал: дальше он в переборе не участвует.
      update public.battle_units set acted = true where id = au;
      skip := skip || au;
      -- Страже полагается свой обычный ход — возвращаем бюджет стороне.
      update public.battles
         set acts_left = greatest(coalesce(acts_left, 0), public._bt_acts())
       where id = p_battle and status = 'active';
    end if;
  end if;

  -- ── обычная машинная сторона: как было ────────────────────
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

  if not ang then
    select * into b from public.battles where id = p_battle;
    if b.status = 'active' and b.side_to_move is distinct from botside then
      begin
        perform public._bt_ally_turn(p_battle, greatest(1, public._bt_acts() / 2));
      exception when others then null; end;
    end if;
  end if;
end $$;

-- ── Крон раз в минуту: расставить и походить за державы из реестра ──
create or replace function public.legion_ai_tick()
returns jsonb language plpgsql security definer as $$
declare b record; n int := 0; d int := 0; p int := 0; sp jsonb;
begin
  for b in select id from public.battles
            where status = 'forming'
              and (attacker_fid = public._legion_fid() or defender_fid = public._legion_fid())
  loop
    begin
      if (public.legion_battle_deploy(b.id)->>'ok')::boolean then d := d + 1; end if;
    exception when others then null; end;
  end loop;

  -- Державы под ИИ: расстановка за отсутствующего командира.
  for b in select bt.id, a.fid from public.battles bt
             join public.faction_battle_ai a
               on a.fid in (bt.attacker_fid, bt.defender_fid)
               or exists (select 1 from public.battle_allies al
                           where al.battle_id = bt.id and al.fid = a.fid)
            where bt.status = 'forming' and bt.kind not in ('ground', 'duel')
  loop
    begin
      if coalesce((public._bt_proxy_deploy(b.id, b.fid)->>'placed')::int, -1) >= 0 then p := p + 1; end if;
    exception when others then null; end;
  end loop;

  for b in select id from public.battles
            where status = 'active'
              and public._bt_is_machine_in(id, case when side_to_move = 'attacker'
                                                    then attacker_fid else defender_fid end)
            order by created_at
            limit 12
  loop
    begin
      perform public._bt_bot_turn(b.id);
      n := n + 1;
    exception when others then null; end;
  end loop;

  begin sp := public.legion_spoils_tick(); exception when others then sp := null; end;

  return jsonb_build_object('ok', true, 'turns', n, 'deployed', d, 'proxy_deployed', p,
                            'spoils', coalesce(sp->'spoils', '0'::jsonb));
end $$;

-- ── Админ: включить / выключить ИИ в боях за державу ─────────
create or replace function public.admin_faction_battle_ai(p_fid text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; dep jsonb := '[]'::jsonb; r jsonb;
begin
  if public.current_user_role() not in ('superadmin', 'editor') then
    raise exception 'forbidden: staff only';
  end if;
  if p_fid is null or not exists (select 1 from public.faction_applications
                                   where faction_id = p_fid and status = 'approved') then
    raise exception 'держава не найдена';
  end if;

  if not coalesce(p_on, false) then
    delete from public.faction_battle_ai where fid = p_fid;
    return jsonb_build_object('ok', true, 'on', false);
  end if;

  insert into public.faction_battle_ai(fid, enabled_by) values (p_fid, auth.uid())
    on conflict (fid) do update set enabled_by = excluded.enabled_by, enabled_at = now();

  -- Висящие расстановки разбираем сразу, не дожидаясь крона.
  for b in select bt.id from public.battles bt
            where bt.status = 'forming' and bt.kind not in ('ground', 'duel')
              and (p_fid in (bt.attacker_fid, bt.defender_fid)
                   or exists (select 1 from public.battle_allies al
                               where al.battle_id = bt.id and al.fid = p_fid))
  loop
    r := public._bt_proxy_deploy(b.id, p_fid);
    dep := dep || jsonb_build_array(r || jsonb_build_object('battle_id', b.id));
  end loop;
  return jsonb_build_object('ok', true, 'on', true, 'battles', dep);
end $$;
revoke all on function public.admin_faction_battle_ai(text, boolean) from public, anon;
grant execute on function public.admin_faction_battle_ai(text, boolean) to authenticated;
