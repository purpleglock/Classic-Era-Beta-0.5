-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ГЛАС И ФИНАЛЫ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_wings.sql, _angel_anchors.sql, _angel_clock.sql.
-- Надмножество `_angel_guard_deploy`, `_angel_regen`, `_angel_clock_tick`,
-- `_angel_teardown`. Идемпотентно.
--
-- ГЛАС. Часы должны что-то ЗНАЧИТЬ, иначе это просто цифра в углу. Значение
-- такое: чем дальше зашло вознесение, тем тяжелее сам кризис — крылья
-- прибавляют в живучести и залпе, якоря затягивают печати быстрее.
-- Промедление стоит не «очков», а того, что противник растёт.
--
-- ⚠️ ЗАБРАКОВАНО: тянуть Глас в общую экономику (доход/prosperity всей
-- галактики). Полез проверять — `system_econ.prosperity` во ВСЕХ 246 строках
-- равен 1, при том что хозяйство ангела (`_angel_econ`, _angel_ai.sql) читает
-- его как шкалу 0–100 и делит на 100. То есть смысл поля сейчас разъехался
-- между слоями. Вешать на него галактический эффект — значит строить кризис
-- на цифре, которая уже врёт. Глас живёт в файлах ангела и трогает только его.
--
-- КАЛИБРОВКА. `grip` = вознесение / 100, от 0 до 1.
--   • живучесть и залп крыла  ×(1 + 0.60·grip) — на 100% это в 1.6 раза;
--   • зарастание с якоря      ×(1 + 1.00·grip) — на 100% вдвое.
-- На сегодняшних 4.9% это +3% и +5%: ничего. Это и правильно — Глас должен
-- быть не заметен в начале и невыносим в конце, иначе он не шкала, а штраф.
--
-- ФИНАЛЫ. Партия с кризисом должна КОНЧАТЬСЯ, и обоими способами:
--   • ВОЗНЕСЕНИЕ — часы дошли до 100. Кризис победил; событие пишется в
--     летопись эпох, отметка замирает, есть больше нечего и незачем.
--   • СОРВАНО — тело уничтожено НАСОВСЕМ (без `rise_at`). В летопись идёт
--     поимённый список всех, кто стоял против него в `war_sides`, — тот
--     самый реестр, по которому он их и находил.
-- ════════════════════════════════════════════════════════════

-- ── 0. СХЕМА ────────────────────────────────────────────────
alter table public.angel_state add column if not exists ascended_at timestamptz;

create table if not exists public.angel_epoch (
  id          bigserial primary key,
  kind        text not null,              -- 'ascended' | 'broken'
  faction_id  text,
  at          timestamptz not null default now(),
  pct         numeric,
  worlds      int,
  roster      jsonb                       -- кто стоял против него
);
alter table public.angel_epoch enable row level security;
drop policy if exists angel_epoch_read on public.angel_epoch;
create policy angel_epoch_read on public.angel_epoch
  for select to authenticated using (true);
revoke insert, update, delete on public.angel_epoch from anon, authenticated;

-- ── 1. ГЛАС ─────────────────────────────────────────────────
create or replace function public.angel_voice()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'ok',   true,
    'pct',  (public.angel_clock()->>'pct')::numeric,
    'grip', round(least(1, greatest(0, (public.angel_clock()->>'pct')::numeric / 100)), 3),
    'hull', round(1 + 0.60 * least(1, greatest(0, (public.angel_clock()->>'pct')::numeric / 100)), 3),
    'knit', round(1 + 1.00 * least(1, greatest(0, (public.angel_clock()->>'pct')::numeric / 100)), 3))
$$;
revoke all on function public.angel_voice() from public, anon;
grant execute on function public.angel_voice() to authenticated, anon;

-- Внутренний множитель. Отдельно от `angel_voice()`, чтобы не разбирать jsonb
-- в горячих местах (расстановка зовёт его на каждый борт).
create or replace function public._angel_grip()
returns numeric language sql stable security definer set search_path=public as $$
  select least(1, greatest(0,
    coalesce((select sum(taken) from public.angel_transmute), 0)
    / nullif(public._angel_clock_const('goal'), 0)))
$$;
revoke all on function public._angel_grip() from public;

-- ── 2. ЗАРАСТАНИЕ С УЧЁТОМ ГЛАСА ────────────────────────────
-- Надмножество `_angel_regen` из _angel_anchors.sql. Единственная правка —
-- множитель `knit`. Правило «нет якорей — нет зарастания» не тронуто.
create or replace function public._angel_regen()
returns void language plpgsql security definer set search_path=public as $$
declare a record; hrs numeric; calm boolean; gain numeric; mul numeric; mx numeric;
        f record; anch int; knit numeric;
begin
  mx   := public._angel_const('seals_max');
  knit := 1 + public._angel_grip();
  for a in select * from public.angel_state where fell_at is null loop
    calm := a.last_hit is null
         or now() - a.last_hit > (public._angel_const('calm_h') || ' hours')::interval;
    if not calm then
      update public.angel_state set last_regen = now() where faction_id = a.faction_id;
      continue;
    end if;
    hrs := greatest(0, least(24, extract(epoch from (now() - a.last_regen)) / 3600.0));
    if hrs < 0.05 then continue; end if;

    select count(*)::int into anch from public.angel_anchor
     where faction_id = a.faction_id and broken_at is null;
    if anch <= 0 then
      update public.angel_state set last_regen = now() where faction_id = a.faction_id;
      continue;
    end if;

    select * into f from public.fleets where id = a.fleet_id;
    mul := case when a.stance = 'roost' and coalesce(f.system_id,'') = coalesce(a.home_sys,'')
                then public._angel_const('roost_mul') else 1 end;
    gain := public._angel_anchor_const('regen_each') * hrs * mul * knit
            * least(anch, public._angel_anchor_const('regen_cap')::int);
    update public.angel_state
       set seals = least(mx, seals + gain), last_regen = now()
     where faction_id = a.faction_id;
  end loop;
end$$;
revoke all on function public._angel_regen() from public;

-- ── 3. КРЫЛЬЯ С УЧЁТОМ ГЛАСА ────────────────────────────────
-- Надмножество `_angel_guard_deploy` из _angel_wings.sql. Правка одна:
-- живучесть и урон умножаются на `hull`. Состав, оружие, действия, порядок
-- постановки и расчёт стражи — слово в слово оттуда.
create or replace function public._angel_guard_deploy(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; af text; sd text; fc int; xy int[]; g record; n int := 0;
        st jsonb; kd text; wpn jsonb; res numeric; hull numeric;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status = 'done' then return jsonb_build_object('ok', false, 'why', 'нет боя'); end if;

  af := case when public._angel_is(b.attacker_fid) then b.attacker_fid
             when public._angel_is(b.defender_fid) then b.defender_fid else null end;
  if af is null then return jsonb_build_object('ok', false, 'why', 'ангела в этом бою нет'); end if;
  sd := case when b.attacker_fid = af then 'attacker' else 'defender' end;

  if not exists (select 1 from public.angel_guard g2
                  join public.battle_fleets bf on bf.fleet_id = g2.fleet_id
                 where bf.battle_id = p_battle and g2.dead_at is null) then
    return jsonb_build_object('ok', true, 'placed', 0, 'why', 'воинства в этом бою нет');
  end if;

  begin perform public._angel_kinds(); exception when others then null; end;

  -- ⚠️ ГЛАС берём ОДИН РАЗ на всю расстановку, а не на борт: иначе крылья
  -- одного боя оказались бы разной силы, если тик переплавки успел между ними.
  hull := 1 + 0.60 * public._angel_grip();

  perform public._bt_ensure_field(p_battle);
  fc := public._bt_spawn_facing(b.spawn, sd);

  for g in select g2.* from public.angel_guard g2
             join public.battle_fleets bf on bf.fleet_id = g2.fleet_id
            where bf.battle_id = p_battle and g2.dead_at is null
            order by (g2.role = 'wall') desc, g2.ord
  loop
    continue when exists (select 1 from public.battle_units u
                           where u.battle_id = p_battle and u.unit_id = g.unit_id);
    kd  := case when g.role = 'wall' then 'wall' else coalesce(g.kind, 'wheel') end;
    st  := public._angel_host_stats(kd);
    res := (st->>'resist')::numeric;
    wpn := case when kd = 'wall' then public._angel_wall_wpn()
                else public._angel_hull_wpn(kd) end;

    -- Оружие масштабируем поканально, а не одной цифрой `dmg`: доска считает
    -- урон по `wpn`, а `dmg` держит только сводку для карточки.
    wpn := (select coalesce(jsonb_agg(
              w || jsonb_build_object('dmg', round((w->>'dmg')::numeric * hull))), '[]'::jsonb)
              from jsonb_array_elements(wpn) w);

    xy := public._bt_bot_slot_side(p_battle,
            case when kd = 'sting' then 'skirm' else 'brawler' end, sd);
    if xy is null then xy := public._bt_bot_slot_side(p_battle, 'brawler', sd); end if;
    if xy is null then xy := public._angel_free_hex(p_battle, sd); end if;
    exit when xy is null;

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil, ftl, acts, pk)
      values (p_battle, af, sd, g.unit_id, g.name, st->>'cls', xy[1], xy[2],
        round((st->>'hp')::numeric * hull), round((st->>'hp')::numeric * hull),
        (st->>'armor')::numeric, 0, 0,
        round((st->>'dmg')::numeric * hull), (st->>'speed')::int, (st->>'rng')::int,
        fc, public._bt_turnneed(st->>'cls'), (st->>'sensor')::int, 1, wpn,
        jsonb_build_object('kinetic', res, 'energy', res, 'missile', res),
        (st->>'pd')::numeric, 4, (st->>'wings')::int, 4, 4,
        (kd = 'wheel' or kd = 'wall'), true, false,
        case when kd = 'wall' then public._angel_guard_acts()
             else public._angel_hull_acts(kd) end,
        jsonb_build_object('gd', (st->>'gd')::int, 'kd', kd));
    n := n + 1;
  end loop;

  if n > 0 then
    if sd = 'attacker' then update public.battles set att_ready = true where id = p_battle;
    else                     update public.battles set def_ready = true where id = p_battle; end if;
    perform public._bt_log(p_battle, public._angel_glitch(
      '◈ Сопровождение разворачивается в линию. Колёса впереди, жала расходятся по флангам', 0.24)
      || ' ' || public._angel_scream(8));
  end if;

  select * into b from public.battles where id = p_battle;
  if b.status = 'forming' and b.att_ready and b.def_ready then
    begin perform public._fc_kick_off(p_battle); exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true, 'placed', n, 'hull', round(hull, 3));
end$$;
revoke all on function public._angel_guard_deploy(uuid) from public;

-- ── 4. ФИНАЛ: ВОЗНЕСЕНИЕ ────────────────────────────────────
create or replace function public._angel_ascend(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c jsonb; rost jsonb;
begin
  if exists (select 1 from public.angel_state
              where faction_id = p_fid and ascended_at is not null) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  c := public.angel_clock();
  select jsonb_agg(jsonb_build_object('fid', f.fid, 'name', public._war_nm(f.fid), 'since', f.since))
    into rost from public._angel_foes(p_fid) f;

  insert into public.angel_epoch(kind, faction_id, pct, worlds, roster)
    values ('ascended', p_fid, (c->>'pct')::numeric, (c->>'worlds')::int, rost);

  -- Отметка замирает: есть больше нечего и незачем. Тело не убираем — оно
  -- остаётся на карте, и это страшнее, чем если бы оно исчезло.
  update public.angel_state set ascended_at = now(), stance = 'roost'
   where faction_id = p_fid;
  return jsonb_build_object('ok', true, 'ascended', true, 'pct', c->>'pct');
end$$;
revoke all on function public._angel_ascend(text) from public;

-- ── 5. СТУПЕНИ — НАДМНОЖЕСТВО ───────────────────────────────
-- Дословный `_angel_clock_tick` из _angel_clock.sql, плюс вызов финала на
-- последней ступени.
create or replace function public._angel_clock_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare af text; pct numeric; rung int; want int;
begin
  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;

  pct  := (public.angel_clock()->>'pct')::numeric;
  select coalesce(a.rung, 0) into rung from public.angel_state a where a.faction_id = af;
  want := case when pct >= 100 then 5 when pct >= 90 then 4
               when pct >= 75  then 3 when pct >= 50 then 2
               when pct >= 25  then 1 else 0 end;
  if want <= rung then return jsonb_build_object('ok', true, 'pct', pct, 'rung', rung); end if;

  update public.angel_state set rung = want where faction_id = af;

  if want = 5 then
    perform public._war_news(
      public._angel_glitch('◈ ВОЗНЕСЕНИЕ', 0.30),
      public._angel_glitch(
        'Счёт закрыт. Того населения, которое числилось в реестрах галактики, '
        || 'больше нет в реестрах галактики. Отметка не двинулась с места и не '
        || 'подала сигнала. Наблюдение продолжается', 0.24) || ' ' || public._angel_scream(20),
      null);
    begin perform public._angel_ascend(af); exception when others then null; end;
  else
    perform public._war_news(
      public._angel_glitch('◈ ВОЗНЕСЕНИЕ: ' || round(pct)::text || '%', 0.22),
      public._angel_glitch(
        format('Сводный учёт населения по галактике сходится с недостачей. '
            || 'Недостача составляет %s из %s. Отметку последний раз видели у своих якорей; '
            || 'якорей за ней числится %s. Ниже приложен список систем, которые перестали отвечать',
          round((public.angel_clock()->>'taken')::numeric)::text,
          round(public._angel_clock_const('goal'))::text,
          (public.angel_clock()->>'anchors')), 0.18) || ' ' || public._angel_scream(12),
      null);
  end if;

  return jsonb_build_object('ok', true, 'pct', pct, 'rung', want, 'rang', true);
end$$;
revoke all on function public._angel_clock_tick() from public;

-- ── 6. ФИНАЛ: СОРВАНО ───────────────────────────────────────
-- Надмножество `_angel_teardown` из _angel_floor.sql. Правка одна: при
-- окончательной гибели пишем эпоху с поимённым реестром. Правило «войны
-- гасим только насовсем» не тронуто.
create or replace function public._angel_teardown(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n_bt int := 0; n_dead int := 0; n_fleet int := 0; n_occ int := 0; n_war int := 0;
        b record; fin boolean; c jsonb; rost jsonb;
begin
  if p_fid is null then return jsonb_build_object('ok', false); end if;

  fin := not exists (select 1 from public.angel_state
                      where faction_id = p_fid and rise_at is not null);

  for b in select id from public.battles
            where status <> 'done' and (attacker_fid = p_fid or defender_fid = p_fid)
  loop
    begin perform public._angel_wing_slip(b.id); n_bt := n_bt + 1;
    exception when others then null; end;
  end loop;

  update public.angel_guard set dead_at = now()
   where faction_id = p_fid and dead_at is null;
  get diagnostics n_dead = row_count;

  select count(*) into n_fleet from public.fleets where faction_id = p_fid;
  delete from public.fleets where faction_id = p_fid;

  select count(*) into n_occ from public.system_occupation where occupier_fid = p_fid;
  delete from public.system_occupation where occupier_fid = p_fid;

  if fin then
    select count(*) into n_war from public.wars
     where status = 'active' and (attacker_fid = p_fid or defender_fid = p_fid);
    update public.wars
       set status = 'status_quo', ended_at = coalesce(ended_at, now()),
           outcome_note = coalesce(outcome_note, 'Кризис прекращён. Тело уничтожено.')
     where status = 'active' and (attacker_fid = p_fid or defender_fid = p_fid);

    -- ЛЕТОПИСЬ. Поимённо — по тому же реестру, по которому он их находил.
    c := public.angel_clock();
    select jsonb_agg(jsonb_build_object('fid', f.fid, 'name', public._war_nm(f.fid), 'since', f.since))
      into rost from public._angel_foes(p_fid) f;
    insert into public.angel_epoch(kind, faction_id, pct, worlds, roster)
      values ('broken', p_fid, (c->>'pct')::numeric, (c->>'worlds')::int, rost);

    perform public._war_news(
      '◈ КРИЗИС СОРВАН',
      format('Отметка погасла окончательно. Вознесение остановлено на %s%%; '
          || 'миров переплавлено %s, якорей снято %s. '
          || 'В войне против него значились: %s.',
        c->>'pct', c->>'worlds', c->>'broken',
        coalesce((select string_agg(public._war_nm(f.fid), ', ' order by f.since)
                    from public._angel_foes(p_fid) f), '—')),
      null);
  end if;

  return jsonb_build_object('ok', true, 'fid', p_fid, 'battles', n_bt,
                            'losses', n_dead, 'fleets', n_fleet,
                            'occupations', n_occ, 'wars', n_war, 'final', fin);
end$$;
revoke all on function public._angel_teardown(text) from public;

-- ── 7. ЛЕТОПИСЬ ЭПОХ ────────────────────────────────────────
create or replace function public.angel_epochs()
returns table(kind text, at timestamptz, pct numeric, worlds int, roster jsonb)
language sql stable security definer set search_path=public as $$
  select e.kind, e.at, e.pct, e.worlds, e.roster
    from public.angel_epoch e order by e.at desc
$$;
revoke all on function public.angel_epochs() from public, anon;
grant execute on function public.angel_epochs() to authenticated, anon;

notify pgrst, 'reload schema';

do $$
declare v jsonb;
begin
  v := public.angel_voice();
  raise notice 'ГЛАС: вознесение % %%, крылья ×%, зарастание ×%',
    v->>'pct', v->>'hull', v->>'knit';
end$$;
