-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ПОЛ: ДОСКА, КОТОРАЯ НАЧИНАЕТСЯ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_ghost_board.sql и _angel_phase2.sql. Идемпотентно.
--
-- ЧТО НАШЛОСЬ В ЖИВОЙ БАЗЕ (24.08).
--   193 боя fac_0fd51aa92b ↔ fac_63c33ef6d5 с 17.08. У ВСЕХ turn_no = 0.
--   Новая доска ровно каждые 5 минут: 13:11, 13:16, 13:21, … 14:41, 14:46.
--   Живая доска в тот момент:
--       status forming · att_ready = TRUE · def_ready = FALSE · turn_no 0
--       флотов 6 · бортов на поле 4 — и все четыре его.
--
-- ДИАГНОЗ. Ангел выставляется исправно. Не жмёт «готов» ПРОТИВНИК. Доска
-- висит в расстановке, через час её сносит стена `form_h` (_angel_no_grip),
-- через пять минут `_war_sweep` заводит её заново — два враждебных флота
-- по-прежнему стоят в одной системе. И так неделю: воинство всё это время
-- сковано боем (`_battle_lock_fleet`), никуда не уходит и ни разу не стреляет.
--
-- ⚠️ ПОЧЕМУ ЭТО НЕЛЬЗЯ ЛЕЧИТЬ РОСПУСКОМ ДОСКИ. Роспуск и есть текущее
-- поведение — оно и дало 193 пустых боя. Разводить надо не бой, а тупик:
-- сторона, которая не пришла на расстановку, должна ПОЛУЧИТЬ БОЙ, а не
-- бесплатную отмену. Иначе кризис отменяется простым неведением кнопки.
--
-- ПРАВИЛО. Кризис не ждёт приглашения. Двадцать минут на расстановку — и
-- флоты выводит на поле сервер, тем составом, что и так числится в бою.
-- Это не наказание: состав честный, зона своя, ход первый по общему правилу.
-- Кто расставился сам — расставился лучше, вот и вся разница.
--
-- ⚠️ ТОЛЬКО ДЛЯ ДОСОК АНГЕЛА. Обычные войны игроков этого не касаются ни
-- строкой: там неявка — законная тактика, и ломать её нечем и незачем.
-- ════════════════════════════════════════════════════════════

-- ── 0. КОНСТАНТЫ ────────────────────────────────────────────
-- Своя дверь, а НЕ дописывание в _angel_const/_angel_grip_const: те immutable
-- и переписываются целиком в каждом ангельском файле — ключи отсюда унесло бы
-- первым же повторным накатом (ровно так уже терялась ПРО, _defense_const_merge).
create or replace function public._angel_floor_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'wait_min' then 20    -- минут на расстановку, дальше выводит сервер
    when 'cap'      then 24    -- потолок бортов, которые сервер выставит за сторону
    else 0 end
$$;

-- ── 1. СВОБОДНЫЙ ГЕКС В ЗОНЕ СТОРОНЫ ────────────────────────
-- Зона считается ровно как в `battle_deploy`: нападающий — z левых колонок,
-- обороняющийся — z правых. Иначе сервер выставил бы борт туда, куда игроку
-- ставить запрещено, и доска читалась бы как жульничество.
create or replace function public._angel_free_hex(p_battle uuid, p_side text)
returns int[] language plpgsql stable security definer set search_path=public as $$
declare z int; w int; h int; x0 int; x1 int; xi int; yi int;
begin
  z := public._bt_zone(); w := public._bt_w(); h := public._bt_h();
  if p_side = 'attacker' then x0 := 0; x1 := z - 1;
  else                       x0 := w - z; x1 := w - 1; end if;

  for yi in 0 .. h - 1 loop
    for xi in x0 .. x1 loop
      if not exists (select 1 from public.battle_units u
                      where u.battle_id = p_battle and u.alive and u.x = xi and u.y = yi) then
        return array[xi, yi];
      end if;
    end loop;
  end loop;
  return null;
end$$;
revoke all on function public._angel_free_hex(uuid, text) from public;

-- ── 2. ПРИЗЫВ: ВЫВЕСТИ СТОРОНУ, КОТОРАЯ НЕ ПРИШЛА ───────────
create or replace function public._angel_absent_deploy(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; af text; fsd text; ready boolean; wait interval;
        c record; st jsonb; xy int[]; fc int; n int := 0; cap int; i int; done int;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or b.status <> 'forming' then
    return jsonb_build_object('ok', true, 'skip', 'бой не в расстановке');
  end if;

  af := case when public._angel_is(b.attacker_fid) then b.attacker_fid
             when public._angel_is(b.defender_fid) then b.defender_fid else null end;
  if af is null then return jsonb_build_object('ok', true, 'skip', 'не его доска'); end if;

  -- Сторона ПРОТИВ ангела.
  fsd   := case when b.attacker_fid = af then 'defender' else 'attacker' end;
  ready := case when fsd = 'attacker' then b.att_ready else b.def_ready end;
  if ready then return jsonb_build_object('ok', true, 'skip', 'сторона уже готова'); end if;

  -- Часы. Раньше срока не трогаем: расстановка своими руками всегда лучше.
  wait := (public._angel_floor_const('wait_min') || ' minutes')::interval;
  if now() - b.created_at < wait then
    return jsonb_build_object('ok', true, 'waiting', true,
                              'left_s', extract(epoch from (b.created_at + wait - now()))::int);
  end if;

  perform public._bt_arm(p_battle);          -- размер доски ЭТОГО боя
  perform public._bt_ensure_field(p_battle);
  fc  := public._bt_spawn_facing(b.spawn, fsd);
  cap := least(public._angel_floor_const('cap')::int, public._bt_cap());

  -- Состав берём тот же, что видел бы игрок в резерве: борта флотов,
  -- записанных в бой на этой стороне. Ничего не добавляем и не дарим.
  for c in
    select (e->>'unit_id')::uuid as uid, bf.fid as fid,
           greatest(0, coalesce((e->>'qty')::int, 0)) as qty
      from public.battle_fleets bf
      join public.fleets f on f.id = bf.fleet_id
      cross join lateral jsonb_array_elements(coalesce(f.composition, '[]'::jsonb)) e
     where bf.battle_id = p_battle and bf.side = fsd
       and nullif(e->>'unit_id','') is not null
     order by bf.fid, (e->>'unit_id')
  loop
    begin st := public._bt_stats(c.uid); exception when others then st := null; end;
    continue when st is null;

    -- Игрок мог успеть расставить часть — доводим до штатного числа, не дублируя.
    select count(*) into done from public.battle_units u
     where u.battle_id = p_battle and u.unit_id = c.uid;

    for i in 1 .. greatest(0, c.qty - done) loop
      exit when n >= cap;
      xy := public._angel_free_hex(p_battle, fsd);
      exit when xy is null;

      insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
          hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
          facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
          dejam, eccm, interdict, stabil, ftl)
        values (p_battle, c.fid, fsd, c.uid, st->>'name', st->>'cls', xy[1], xy[2],
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
    exit when n >= cap;
  end loop;

  -- ⚠️ ГОТОВНОСТЬ СТАВИМ ДАЖЕ ПРИ n = 0. Пустой резерв — это тоже ответ:
  -- бой начнётся и кончится по обычному правилу пустой стороны. Иначе доска
  -- снова зависнет в расстановке, а это ровно та беда, которую чиним.
  if fsd = 'attacker' then update public.battles set att_ready = true where id = p_battle;
  else                     update public.battles set def_ready = true where id = p_battle; end if;

  perform public._bt_log(p_battle, format(
    'Расстановка не подана в срок: флоты выводит штаб на месте. Бортов на поле: %s.', n));

  select * into b from public.battles where id = p_battle;
  if b.status = 'forming' and b.att_ready and b.def_ready then
    begin perform public._fc_kick_off(p_battle); exception when others then null; end;
  end if;

  select * into b from public.battles where id = p_battle;
  return jsonb_build_object('ok', true, 'placed', n, 'side', fsd,
                            'started', (b.status = 'active'));
end$$;
revoke all on function public._angel_absent_deploy(uuid) from public;

-- ── 3. ТИК ДОСКИ — НАДМНОЖЕСТВО ─────────────────────────────
-- Слово в слово живой `angel_battle_tick` (_angel_guard.sql, последняя
-- редакция), плюс призыв неявившейся стороны после обеих расстановок ангела.
-- ⚠️ Порядок важен: сначала своё воинство на поле, потом чужое — иначе
-- `_angel_free_hex` считал бы занятость по недособранной доске.
create or replace function public.angel_battle_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; d int := 0; g int := 0; k int := 0; af text; w jsonb; u jsonb; sw jsonb;
begin
  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;

  begin u  := public._angel_unstick();     exception when others then u  := null; end;
  begin sw := public._angel_grip_sweep();  exception when others then sw := null; end;
  begin w  := public._angel_guard_watch(); exception when others then w  := null; end;

  for b in select id from public.battles
            where status = 'forming' and (attacker_fid = af or defender_fid = af)
  loop
    begin
      if (public.angel_battle_deploy(b.id)->>'ok')::boolean then d := d + 1; end if;
    exception when others then null;
    end;
    begin
      g := g + coalesce((public._angel_guard_deploy(b.id)->>'placed')::int, 0);
    exception when others then null;
    end;
    begin
      if (public._angel_absent_deploy(b.id)->>'started')::boolean then k := k + 1; end if;
    exception when others then null;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'deployed', d, 'guards', g, 'kicked', k,
                            'unstick', u, 'sweep', sw, 'watch', w);
end$$;
revoke all on function public.angel_battle_tick() from public;

-- ════════════════════════════════════════════════════════════
-- 4. ВОЙНЫ НЕ ЗАКРЫВАЮТСЯ ВРАНЬЁМ
-- ────────────────────────────────────────────────────────────
-- Живая база: все четыре войны ангела закрыты ОДНОЙ секундой
-- 2026-08-23T15:37:45 с пометкой «Противник перестал существовать» — а
-- Шестнадцатая Волна жива и держит 253 колонии. Никто не переставал
-- существовать: у ангела пало тело, и `_angel_teardown` заодно погасил войны.
--
-- ПОЧЕМУ ЭТО НЕ КОСМЕТИКА. С фазой 2 тело возвращается через восемь часов.
-- Гасить войну на смерть тела — значит каждый раз стирать реестр тех, кто
-- против него воевал, и отправлять кризис искать новых врагов по соседству.
-- Отсюда и «Присутствие» вместо исходной «ДеМЗАфикации»: он просто забыл.
-- Война с ним кончается ТОЛЬКО вместе с ним, насовсем.
create or replace function public._angel_teardown(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n_bt int := 0; n_dead int := 0; n_fleet int := 0; n_occ int := 0; n_war int := 0;
        b record; fin boolean;
begin
  if p_fid is null then return jsonb_build_object('ok', false); end if;

  -- Насовсем ли? Фаза 2 поднимет его снова — тогда это не конец, а пауза.
  fin := not exists (select 1 from public.angel_state
                      where faction_id = p_fid and rise_at is not null);

  -- Доски закрываем: тела на них больше нет.
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

  -- ⚠️ ВОЙНЫ ГАСИМ ТОЛЬКО НАСОВСЕМ. Пока висит `rise_at`, война идёт: он не
  -- побеждён, он перезаряжается, и держава, закрывшая границы, права.
  if fin then
    select count(*) into n_war from public.wars
     where status = 'active' and (attacker_fid = p_fid or defender_fid = p_fid);
    update public.wars
       set status = 'status_quo', ended_at = coalesce(ended_at, now()),
           outcome_note = coalesce(outcome_note, 'Кризис прекращён. Тело уничтожено.')
     where status = 'active' and (attacker_fid = p_fid or defender_fid = p_fid);
  end if;

  return jsonb_build_object('ok', true, 'fid', p_fid, 'battles', n_bt,
                            'losses', n_dead, 'fleets', n_fleet,
                            'occupations', n_occ, 'wars', n_war, 'final', fin);
end$$;
revoke all on function public._angel_teardown(text) from public;

notify pgrst, 'reload schema';

-- ── 5. ПОЧИНИТЬ УЖЕ СОЛГАННОЕ ───────────────────────────────
-- Реестр Альянса надо вернуть: он и есть цель кризиса. Войны, закрытые
-- гибелью тела 23.08, поднимаем обратно — противники живы, кризис жив.
-- ⚠️ `wars_active_pair_uq` не даёт двух ЖИВЫХ войн на одну пару: по Алой Унии
-- активная строка уже есть (та самая, за «Присутствие»). Поднимаем только
-- те пары, у которых живой войны нет, — остальные и так в реестре.
do $$
declare n int;
begin
  update public.wars w
     set status = 'active', ended_at = null, outcome_note = null
   where w.outcome_note = 'Противник перестал существовать.'
     and exists (select 1 from public.angel_state a
                  where a.fell_at is null
                    and a.faction_id in (w.attacker_fid, w.defender_fid))
     and not exists (select 1 from public.wars w2
                      where w2.status = 'active'
                        and w2.attacker_fid = w.attacker_fid
                        and w2.defender_fid = w.defender_fid);
  get diagnostics n = row_count;
  raise notice 'войн возвращено в реестр: %', n;
end$$;
