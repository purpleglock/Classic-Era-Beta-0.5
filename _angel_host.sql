-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 20: ВОИНСТВО. ОФАНИМ, РУКИ И БОЕКОМПЛЕКТ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_guard.sql. Надмножество `_angel_guard_deploy`,
-- `_angel_pacer`, `_angel_forge`, `_angel_sync_body`, `angel_ai_tick`.
-- ⚠️ Правки перечисленного вести ОТСЮДА.
--
-- ЗАМЕР, С КОТОРОГО ВСЁ НАЧАЛОСЬ (21.08, живая база):
--   • 274 939 ГС на счету при 20 из 20 занятых ячеек — тратить не на что,
--     деньги копятся мёртвым грузом;
--   • «рука» (Гиперпейсер) ОДНА при потолке в две. Причина: `_angel_pacer`
--     выходил с «moving», если ковчег в пути, — а он в пути почти всегда;
--   • `ball_hunter` = 0 при doom = 3. Кузница делает ОДИН снаряд за проход и
--     всегда предпочитает Длань, поэтому «Сполох» не рождался вовсе, и
--     `_angel_hunter` каждый тик отвечал «нет «Сполоха»»;
--   • на складе 106 «Фантомов» и по десятку лёгких, кассетных и тяжёлых —
--     ими не стреляли НИ РАЗУ: у ангела просто не было двери для обычной
--     баллистики, только Длань и «Сполох».
-- Отсюда и ощущение «ИИ ничего не делает»: он копил и не тратил.
--
-- ЧТО ДОБАВЛЕНО.
--   1) ОФАНИМ — эскорт. Не стена: стена стоит у порога и открывает ковчег
--      (см. шаг 15), а эти ходят ЗА телом, куда бы оно ни шло. Два флота по
--      три борта, слабее Херувимов вчетверо. В реестре у них role='escort',
--      и `_angel_guard_left` их НЕ считает — иначе выбить стену было бы
--      невозможно, пока жив хоть один эскорт.
--   2) РУКИ. Потолок 2 → 4, и стройка больше не спотыкается о перелёт.
--   3) КУЗНИЦА. Держим запас «Сполоха» ≥2 и делаем до двух снарядов за проход.
--   4) ЗАЛП ОБЫЧНОЙ БАЛЛИСТИКОЙ — новая дверь `_angel_barrage`: склад наконец
--      тратится, «Фантом» идёт мимо ПРО (для того он и есть), тяжёлый бьёт
--      дальше. Цель — самая жирная колония врага в радиусе.
-- ════════════════════════════════════════════════════════════

-- ── 1. РОЛЬ В РЕЕСТРЕ ───────────────────────────────────────
alter table public.angel_guard add column if not exists role text not null default 'wall';

-- Стена — это только Херувимы. ⚠️ От этого счёта зависит неуязвимость ковчега.
create or replace function public._angel_guard_left()
returns int language sql stable security definer set search_path=public as $$
  select count(*)::int from public.angel_guard where dead_at is null and role = 'wall'
$$;

create or replace function public._angel_host_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'fleets'  then 2          -- сколько эскортных флотов
    when 'per'     then 3          -- бортов во флоте
    when 'hp'      then 600000     -- вчетверо слабее Херувима
    when 'armor'   then 8000
    when 'dmg'     then 22000
    when 'rng'     then 18
    when 'speed'   then 8          -- быстрее стены: они сопровождают, а не стоят
    when 'resist'  then 0.40
    when 'wounds'  then 2          -- снарядом сносится вдвое легче Херувима
    when 'flak'    then 14         -- пол зенитного расчёта эскорта
    when 'pacer_cap' then 4        -- рук у тела
    when 'pacer_mul' then 0.25     -- доля каталожной цены МЗА: он её ОТДЕЛЯЕТ от себя
    when 'hunter_keep' then 2      -- запас «Сполоха», ниже которого кузница его и делает
    else 0 end
$$;

-- Паспорт борта по роли. Одна точка правды для расстановки.
create or replace function public._angel_host_stats(p_role text)
returns jsonb language sql stable security definer set search_path=public as $$
  select case when p_role = 'escort' then
    jsonb_build_object(
      'hp',     public._angel_host_const('hp'),
      'armor',  public._angel_host_const('armor'),
      'dmg',    public._angel_host_const('dmg'),
      'rng',    public._angel_host_const('rng')::int,
      'speed',  public._angel_host_const('speed')::int,
      'resist', public._angel_host_const('resist'),
      'cls',    'battleship',        -- честный класс, как и у стены
      'gd',     2)                   -- ступень облика: спрайт ещё мельче
  else
    jsonb_build_object(
      'hp',     public._angel_guard_const('hp'),
      'armor',  public._angel_guard_const('armor'),
      'dmg',    public._angel_guard_const('dmg'),
      'rng',    public._angel_guard_const('rng')::int,
      'speed',  public._angel_guard_const('speed')::int,
      'resist', public._angel_guard_const('resist'),
      'cls',    'dreadnought',
      'gd',     1)
  end
$$;

-- Ран до гибели — по роли (шаг 17 считал всех по стене).
create or replace function public._angel_wound_cap(p_unit uuid)
returns int language sql stable security definer set search_path=public as $$
  select greatest(1, case when (select role from public.angel_guard where unit_id = p_unit) = 'escort'
                          then public._angel_host_const('wounds')::int
                          else public._angel_guard_const('wounds')::int end)
$$;

-- ── 2. СБОР ЭСКОРТА ─────────────────────────────────────────
create or replace function public.angel_host_muster()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; app record; ecoown uuid; nf int; np int; i int; j int;
        uid uuid; flid uuid; comp jsonb; made int := 0; here text; nm text;
        wing text[] := array['ОФАНИМ-АЛЬФА','ОФАНИМ-БЕТА','ОФАНИМ-ГАММА'];
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false, 'why', 'ангела нет'); end if;
  select * into app from public.faction_applications
   where faction_id = a.faction_id and status = 'approved' order by updated_at desc limit 1;
  select owner_id into ecoown from public.faction_economy where faction_id = a.faction_id;
  select coalesce(f.system_id, f.from_sys, a.home_sys) into here
    from public.fleets f where f.id = a.fleet_id;
  nf := greatest(1, public._angel_host_const('fleets')::int);
  np := greatest(1, public._angel_host_const('per')::int);

  for i in 1..nf loop
    -- Флот эскорта заводим один раз: дальше он живёт и убывает.
    select g.fleet_id into flid from public.angel_guard g
     where g.role = 'escort' and g.ord / 10 = i and g.fleet_id is not null limit 1;
    if flid is not null and not exists(select 1 from public.fleets where id = flid) then flid := null; end if;
    if flid is null then
      insert into public.fleets(faction_id, owner_id, name, status, system_id, home_sys,
                                composition, is_station, fuel, fuel_cap)
        values (a.faction_id, ecoown, coalesce(wing[i], 'ОФАНИМ-' || i), 'idle', here, a.home_sys,
                '[]'::jsonb, false, 99, 99)
        returning id into flid;
    end if;

    comp := '[]'::jsonb;
    for j in 1..np loop
      uid := ('a0000000-0000-4000-8000-e261f549bb' || lpad((i*10 + j)::text, 2, '0'))::uuid;
      nm  := 'Офаним ' || i || '-' || j;
      if exists(select 1 from public.angel_guard g where g.unit_id = uid and g.dead_at is not null) then
        continue;                                   -- сбитого не воскрешаем
      end if;

      insert into public.faction_units(id, category, name, faction_id, faction_name,
                                       faction_color, owner_id, summary, data, card_text)
        values (uid, 'ship', nm, a.faction_id, coalesce(app.name, 'Престол'),
                coalesce(app.color, '#e6d38f'), ecoown,
                jsonb_build_object(
                  'hp',    public._angel_host_const('hp'),
                  'armor', public._angel_host_const('armor'),
                  'dmg',   public._angel_host_const('dmg'),
                  'rng',   public._angel_host_const('rng'),
                  'speed', public._angel_host_const('speed'),
                  'radar', 16,
                  'armor_resist', jsonb_build_object(
                    'kinetic', public._angel_host_const('resist'),
                    'energy',  public._angel_host_const('resist'),
                    'missile', public._angel_host_const('resist'))),
                jsonb_build_object('class', 'battleship', 'angel_guard', true,
                                   'layout', jsonb_build_object('mounts', '[]'::jsonb),
                                   'weapons', '[]'::jsonb, 'modules', '[]'::jsonb),
                'Колесо без обода и без глаз. Оно идёт следом и не отстаёт.')
        on conflict (id) do update
          set name = excluded.name, faction_id = excluded.faction_id,
              summary = excluded.summary, data = excluded.data;

      begin
        insert into public.bt_bot_exclude(unit_id, why) values (uid, 'эскорт Престола')
          on conflict (unit_id) do nothing;
      exception when others then null; end;

      insert into public.angel_guard(unit_id, faction_id, fleet_id, name, ord, role)
        values (uid, a.faction_id, flid, nm, i*10 + j, 'escort')
        on conflict (unit_id) do update set fleet_id = excluded.fleet_id, name = excluded.name,
                                            role = 'escort';
      comp := comp || jsonb_build_array(jsonb_build_object('unit_id', uid, 'qty', 1));
      made := made + 1;
    end loop;

    if jsonb_array_length(comp) > 0 then
      update public.fleets set composition = comp, status = 'idle', system_id = here
       where id = flid;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'made', made,
    'escort', (select count(*) from public.angel_guard where role='escort' and dead_at is null),
    'wall',   public._angel_guard_left());
end$$;
revoke all on function public.angel_host_muster() from public, anon;

create or replace function public.admin_angel_host_muster()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public._angel_staff_only();
  return public.angel_host_muster();
end$$;
revoke all on function public.admin_angel_host_muster() from public, anon;
grant execute on function public.admin_angel_host_muster() to authenticated;

-- ── 3. ЭСКОРТ ИДЁТ ЗА ТЕЛОМ ─────────────────────────────────
-- Тем же приёмом, что и «рука» (см. _angel_pacer): эскорт не летит своим
-- маршрутом, он ЕСТЬ там, где тело. Иначе пришлось бы гонять его логистикой с
-- баком и плечами — а у ковчега ни бака, ни плеч не бывает.
-- ⚠️ Флот, скованный боем, не трогаем: он остался драться, это его право.
create or replace function public._angel_host_follow()
returns int language plpgsql security definer set search_path=public as $$
declare a record; here text; n int := 0; f record;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.fleet_id is null then return 0; end if;
  -- ⚠️ ТОЛЬКО ПО ПРИБЫТИИ. Соблазн был брать dest_sys, пока тело в пути, —
  -- тогда эскорт материализуется в чужой системе РАНЬШЕ ковчега и принимает
  -- бой без него. Сопровождение не обгоняет сопровождаемого.
  select fl.system_id into here from public.fleets fl where fl.id = a.fleet_id;
  if here is null then return 0; end if;

  for f in select distinct fl.id from public.fleets fl
             join public.angel_guard g on g.fleet_id = fl.id and g.dead_at is null
                                      and g.role = 'escort'
            where coalesce(fl.system_id,'') is distinct from here
  loop
    if public._fleet_in_battle(f.id) is not null then continue; end if;
    update public.fleets
       set system_id = here, status = 'idle', from_sys = null, dest_sys = null,
           depart_at = null, arrive_at = null, route = null, route_at = null
     where id = f.id;
    n := n + 1;
  end loop;
  return n;
end$$;
revoke all on function public._angel_host_follow() from public;

-- ── 4. РАССТАНОВКА: СТЕНА И ЭСКОРТ ПО СВОИМ ПАСПОРТАМ ───────
-- Надмножество шага 16: стата берётся по роли, метка облика — тоже.
create or replace function public._angel_guard_deploy(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; af text; sd text; fc int; xy int[]; g record; n int := 0;
        st jsonb; dmg numeric; rng int; res numeric; wpn jsonb;
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

  perform public._bt_ensure_field(p_battle);
  fc := public._bt_spawn_facing(b.spawn, sd);

  for g in select g2.* from public.angel_guard g2
             join public.battle_fleets bf on bf.fleet_id = g2.fleet_id
            where bf.battle_id = p_battle and g2.dead_at is null
            order by (g2.role = 'wall') desc, g2.ord
  loop
    continue when exists (select 1 from public.battle_units u
                           where u.battle_id = p_battle and u.unit_id = g.unit_id);
    st  := public._angel_host_stats(g.role);
    dmg := (st->>'dmg')::numeric;
    rng := (st->>'rng')::int;
    res := (st->>'resist')::numeric;
    wpn := jsonb_build_array(
      jsonb_build_object('rng', rng,     'dmg', round(dmg * 0.50), 'k', 'energy',  'shots', 4,
                         'opt', public._bt_wpn_opt('energy'),  'far', public._bt_wpn_far('energy'),
                         'dmin', public._bt_wpn_dmin('energy')),
      jsonb_build_object('rng', greatest(1, rng - 4), 'dmg', round(dmg * 0.32), 'k', 'kinetic', 'shots', 4,
                         'opt', public._bt_wpn_opt('kinetic'), 'far', public._bt_wpn_far('kinetic'),
                         'dmin', public._bt_wpn_dmin('kinetic')),
      jsonb_build_object('rng', rng + 4, 'dmg', round(dmg * 0.18), 'k', 'missile', 'shots', 3,
                         'opt', public._bt_wpn_opt('missile'), 'far', public._bt_wpn_far('missile'),
                         'dmin', public._bt_wpn_dmin('missile')));

    xy := public._bt_bot_slot_side(p_battle, case when g.role='wall' then 'brawler' else 'skirm' end, sd);
    if xy is null then xy := public._bt_bot_slot_side(p_battle, 'brawler', sd); end if;
    exit when xy is null;

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil, ftl, acts, pk)
      values (p_battle, af, sd, g.unit_id, g.name, st->>'cls', xy[1], xy[2],
        (st->>'hp')::numeric, (st->>'hp')::numeric, (st->>'armor')::numeric, 0, 0, dmg,
        (st->>'speed')::int, rng,
        fc, public._bt_turnneed(st->>'cls'), 18, 1, wpn,
        jsonb_build_object('kinetic', res, 'energy', res, 'missile', res),
        0.25, 2, 0, 2, 2, false, true, false,
        case when g.role = 'wall' then public._angel_guard_acts() else '[]'::jsonb end,
        -- ⚠️ МЕТКА ОБЛИКА: 1 — Херувим, 2 — Офаним (спрайт ещё мельче).
        jsonb_build_object('gd', (st->>'gd')::int));
    n := n + 1;
  end loop;

  if n > 0 then
    if sd = 'attacker' then update public.battles set att_ready = true where id = p_battle;
    else                     update public.battles set def_ready = true where id = p_battle; end if;
    perform public._bt_log(p_battle, public._angel_glitch(
      '◈ Сопровождение разворачивается в линию. Отметки одинаковые до последнего знака', 0.24)
      || ' ' || public._angel_scream(8));
  end if;

  select * into b from public.battles where id = p_battle;
  if b.status = 'forming' and b.att_ready and b.def_ready then
    begin perform public._fc_kick_off(p_battle); exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true, 'placed', n);
end$$;
revoke all on function public._angel_guard_deploy(uuid) from public;

-- ── 5. РАНЫ ПО РОЛИ ─────────────────────────────────────────
-- Надмножество шага 17: потолок ран у эскорта свой, и стену снарядами бьют
-- ПЕРЕД эскортом только внутри своего флота — флот выбирает сам стреляющий.
create or replace function public._angel_guard_hurt(p_fleet uuid, p_w int, p_src text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare g record; cap int; w int; dead boolean := false; comp jsonb; shooter text;
begin
  select * into g from public.angel_guard
   where fleet_id = p_fleet and dead_at is null
   order by (wounds > 0) desc, wounds desc, ord limit 1;
  if g.unit_id is null then return jsonb_build_object('ok', true, 'why', 'воинства нет'); end if;
  cap := public._angel_wound_cap(g.unit_id);

  w := g.wounds + greatest(1, coalesce(p_w, 1));
  begin shooter := public._fac_name(p_src); exception when others then shooter := null; end;

  if w >= cap then
    update public.angel_guard set wounds = cap, dead_at = now() where unit_id = g.unit_id;
    dead := true;
    select composition into comp from public.fleets where id = p_fleet for update;
    comp := coalesce((select jsonb_agg(c) from jsonb_array_elements(coalesce(comp,'[]'::jsonb)) c
                       where (c->>'unit_id')::uuid is distinct from g.unit_id), '[]'::jsonb);
    update public.fleets set composition = comp where id = p_fleet;
    perform public._angel_news(
      public._angel_glitch('◈ ОТМЕТКА ПОГАСЛА', 0.24),
      public._angel_glitch(
        'Подлёт зафиксирован, перехвата не было. ' || coalesce(g.name, 'Отметка')
        || ' держалась ещё сорок секунд и перестала', 0.18)
      || ' ' || public._angel_scream(11));
  else
    update public.angel_guard set wounds = w where unit_id = g.unit_id;
    perform public._angel_news(
      public._angel_glitch('◈ ПОПАДАНИЕ', 0.26),
      public._angel_glitch(
        'Вспышка легла точно. Отметка ушла с курса, вернулась на курс и '
        || 'продолжает держать строй', 0.2)
      || ' ' || public._angel_scream(9));
  end if;

  if public._angel_guard_left() <= 0 then
    perform public._angel_news(public._angel_glitch('◈ У ПОРОГА ПУСТО', 0.26),
      public._angel_glitch(
        'Отметки сопровождения погасли одна за другой. Отметка в центре '
        || 'держит курс и не меняет ни скорости, ни высоты', 0.18)
      || ' ' || public._angel_scream(12));
  end if;

  return jsonb_build_object('ok', true, 'dead', dead, 'wounds', least(w, cap),
                            'cap', cap, 'left', public._angel_guard_left(),
                            'by', shooter);
end$$;
revoke all on function public._angel_guard_hurt(uuid,int,text) from public;

-- Зенитки: у эскорта свой пол, ниже, чем у стены.
create or replace function public._fleet_flak(p_fleet uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select greatest(
    coalesce((
      select sum(greatest(0,(c->>'qty')::int) * (0.2 + public._unit_flak((c->>'unit_id')::uuid)))
        from public.fleets f, lateral jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
       where f.id = p_fleet and (c->>'unit_id') ~ '^[0-9a-fA-F-]{36}$'), 0),
    coalesce((select max(case when g.role = 'wall' then public._angel_guard_const('flak_floor')
                              else public._angel_host_const('flak') end)
                from public.angel_guard g
               where g.fleet_id = p_fleet and g.dead_at is null), 0))
$$;

-- ── 6. СКЛАД НАКОНЕЦ ТРАТИТСЯ: ОБЫЧНАЯ БАЛЛИСТИКА ───────────
-- У ангела было ровно две двери: Длань (по мирам) и «Сполох» (по флотам). А на
-- складе лежало 106 «Фантомов» и по десятку лёгких, кассетных и тяжёлых — их
-- нельзя было потратить НИКАК: обычная баллистика запускается через mza_fire,
-- а та требует живого игрока (`_ec_my_fid`). Вот эта дверь.
--
-- ЧЕМ СТРЕЛЯЕТ. По убыванию пользы: тяжёлый (бьёт дальше всех), кассетный,
-- «Фантом» (идёт мимо ПРО — за это его и держат), лёгкий. Один залп за проход:
-- носитель всё равно перезаряжается часами, а вал ангел устраивает Дланью.
create or replace function public._angel_barrage()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; sh record; tgt record; kind text; bp jsonb; maxh int;
        fly numeric; rdy timestamptz; nm text;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;

  select d.kind into kind from public.doom_shells d
   where d.faction_id = a.faction_id and d.qty > 0
     and d.kind in ('ball_heavy','ball_cluster','ball_emp','ball_light')
   order by case d.kind when 'ball_heavy' then 1 when 'ball_cluster' then 2
                        when 'ball_emp' then 3 else 4 end
   limit 1;
  if kind is null then return jsonb_build_object('ok', true, 'why', 'склад пуст'); end if;

  select * into sh from public.mza_ships
   where faction_id = a.faction_id and status = 'idle' and system_id is not null
     and integrity > 0
     and not exists(select 1 from public.doom_salvos s
                     where s.mza_id = mza_ships.id and s.status = 'in_flight')
   order by integrity desc limit 1;
  if sh.id is null then return jsonb_build_object('ok', true, 'why', 'все руки заняты'); end if;

  bp   := public._ball_params(kind);
  maxh := public._shell_const('mza_range_hops')::int
        * case when coalesce((bp->>'long_range')::boolean, false)
               then public._shell_const('heavy_range_mul')::int else 1 end;

  -- Цель: самая жирная колония врага в радиусе. «Фантом» ПРО не видит, поэтому
  -- ему Ожерелье не помеха; остальным — помеха, и снаряд туда не тратим.
  select c.system_id, c.planet_pid, c.planet_name, c.faction_id
    into tgt
    from public.colonies c
   where c.planet_pid is not null
     and c.faction_id is distinct from a.faction_id
     and c.faction_id in (select public.war_enemies_of(a.faction_id))
     and public._mza_hops(sh.system_id, c.system_id, maxh) is not null
     and not exists(select 1 from public.doom_salvos s
                     where s.status = 'in_flight' and s.target_system_id = c.system_id
                       and s.target_pid = c.planet_pid)
     and (kind = 'ball_emp' or not exists(
            select 1 from public.colony_buildings cb
              join public.colonies c2 on c2.id = cb.colony_id
             where cb.btype = 'nemesis' and c2.system_id = c.system_id))
   order by coalesce(c.pop, 0) desc
   limit 1;
  if tgt.system_id is null then return jsonb_build_object('ok', true, 'why', 'целей в радиусе нет'); end if;

  perform public._shell_take(a.faction_id, kind);
  update public.mza_ships
     set integrity = greatest(0, integrity - public._mza_const('shot_wear')),
         total_shots = total_shots + 1
   where id = sh.id;

  fly := coalesce(public._mza_dist_hours(sh.system_id, tgt.system_id,
                    public._mza_const('salvo_h_min'), public._mza_const('salvo_h_max')),
                  public._mza_const('salvo_h_min'))
       * coalesce((bp->>'fly_mul')::numeric, 1.0);
  rdy := now() + (round(fly*60)::int || ' minutes')::interval;

  insert into public.doom_salvos
    (mza_id, faction_id, owner_id, origin_system_id, target_system_id,
     target_pid, target_planet, ready_at, kind, victim_fid)
  values
    (sh.id, a.faction_id,
     (select owner_id from public.faction_economy where faction_id = a.faction_id),
     sh.system_id, tgt.system_id, tgt.planet_pid, tgt.planet_name, rdy, kind, tgt.faction_id);

  select coalesce(nullif(name,''), id) into nm from public.map_systems where id = tgt.system_id;
  perform public._angel_tell(tgt.faction_id,
    public._angel_glitch('◈ Оно посмотрело на «' || coalesce(tgt.planet_name,'?') || '»', 0.22),
    public._angel_glitch('С отметки ушёл снаряд. Подлёт ~' || to_char(fly,'FM990.0') || ' ч.', 0.16)
    || ' ' || public._angel_scream(12));

  return jsonb_build_object('ok', true, 'act', 'barrage', 'kind', kind,
                            'planet', tgt.planet_name, 'sys', nm, 'ready_at', rdy);
end$$;
revoke all on function public._angel_barrage() from public;

-- ── 7. ТИК: ВОИНСТВО ХОДИТ, СКЛАД ТРАТИТСЯ ──────────────────
-- Надмножество живого angel_ai_tick (три строки). Эскорт подтягиваем ПЕРВЫМ:
-- он должен оказаться там, где тело, до того как начнутся бои и залпы.
create or replace function public.angel_ai_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare out jsonb := '{}'::jsonb;
begin
  begin out := out || jsonb_build_object('host', public._angel_host_follow()); exception when others then null; end;
  begin out := out || jsonb_build_object('board', public.angel_battle_tick()); exception when others then null; end;
  begin out := out || jsonb_build_object('war',   public.angel_war_tick());    exception when others then null; end;
  begin out := out || jsonb_build_object('barrage', public._angel_barrage());  exception when others then null; end;
  return out || jsonb_build_object('ok', true);
end$$;
revoke all on function public.angel_ai_tick() from public;

-- ── 8. СОБРАТЬ ЭСКОРТ ПРЯМО СЕЙЧАС ──────────────────────────
do $$
declare r jsonb;
begin
  begin
    r := public.angel_host_muster();
    raise notice 'воинство: %', r;
  exception when others then raise notice 'эскорт собрать не вышло: %', sqlerrm;
  end;
end$$;

-- ── 20.1 КУЗНИЦА: НАДМНОЖЕСТВО _angel_forge ────────────────
CREATE OR REPLACE FUNCTION public._angel_forge()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- ⚠️ НАДМНОЖЕСТВО ЖИВОГО _angel_forge (см. _angel_host.sql, шаг 20).
declare a record; hrs numeric; nforge int; nfab int; made int := 0;
        matter numeric; grav numeric; res jsonb; kind text;
        have_h int; keep_h int;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;

  hrs := greatest(0, least(72, extract(epoch from (now() - coalesce(a.last_forge, now() - interval '1 hour'))) / 3600.0));
  if hrs < public._shell_const('shell_h') then
    return jsonb_build_object('ok', true, 'early', true, 'hours', round(hrs,1));
  end if;

  select count(*) into nforge from public.colony_buildings
   where colony_id = a.colony_id and btype = 'shellforge';
  select count(*) into nfab from public.colony_buildings
   where colony_id = a.colony_id and btype = 'ballfab';
  if nforge + nfab = 0 then return jsonb_build_object('ok', true, 'why', 'арсенала нет'); end if;

  select coalesce(resources, '{}'::jsonb) into res from public.faction_economy
   where faction_id = a.faction_id;
  matter := coalesce((res->>'Программируемая материя')::numeric, 0);
  grav   := coalesce((res->>'Гравиядро')::numeric, 0);

  -- ⚠️ ПОЧЕМУ ПОРЯДОК ПЕРЕВЁРНУТ. Раньше Длань шла первой ВСЕГДА, а снаряд за
  -- проход делался ровно один. На живой базе это дало doom = 3 при
  -- ball_hunter = 0: «Сполох» не рождался никогда, и охота на чужие флоты —
  -- главный ответ ангела тем, кто от него бегает, — не работала вовсе
  -- («нет «Сполоха»» в каждом тике). Теперь сначала добиваем запас охотника до
  -- порога, и только потом копим Длань. Плюс за проход можно сделать ДВА
  -- снаряда: фабрик две, а простой у кузницы всё равно считается по часам.
  have_h := coalesce((select d.qty from public.doom_shells d
                       where d.faction_id = a.faction_id and d.kind = 'ball_hunter'), 0);
  keep_h := public._angel_host_const('hunter_keep')::int;

  if nfab > 0 and have_h < keep_h and grav >= 3 then
    kind := 'ball_hunter';
    grav := grav - 3;
    perform public._shell_add(a.faction_id, 'ball_hunter', 1);
    made := made + 1;
  end if;

  if nforge > 0 and matter >= 8 and grav >= 20 then
    kind := case when made > 0 then 'doom+hunter' else 'doom' end;
    matter := matter - 8; grav := grav - 20;
    perform public._shell_add(a.faction_id, 'doom', 1);
    made := made + 1;
  elsif made = 0 and nfab > 0 and grav >= 3 then
    kind := 'ball_hunter';
    grav := grav - 3;
    perform public._shell_add(a.faction_id, 'ball_hunter', 1);
    made := made + 1;
  end if;

  if made > 0 then
    update public.faction_economy
       set resources = coalesce(resources, '{}'::jsonb)
         || jsonb_build_object('Программируемая материя', round(matter, 2),
                               'Гравиядро', round(grav, 2))
     where faction_id = a.faction_id;
    update public.angel_state set last_forge = now() where faction_id = a.faction_id;
  end if;

  return jsonb_build_object('ok', true, 'made', made, 'kind', kind);
end$function$;

-- ── 20.2 РУКИ: НАДМНОЖЕСТВО _angel_pacer ───────────────────
CREATE OR REPLACE FUNCTION public._angel_pacer()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- ⚠️ НАДМНОЖЕСТВО ЖИВОГО _angel_pacer (см. _angel_host.sql, шаг 20).
declare a record; f record; have int; have_gc numeric; cost numeric; nid uuid; here text;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;
  select * into f from public.fleets where id = a.fleet_id;
  -- ⚠️ РАНЬШЕ ЗДЕСЬ БЫЛ ВЫХОД «moving». Ковчег в пути ПОЧТИ ВСЕГДА (перелёт
  -- 4-6 часов, стоянка минуты), поэтому строитель рук не отрабатывал никогда:
  -- на живой базе одна «рука» при потолке в две и 275 тысяч ГС на счету.
  -- Берём точку так же, как её берёт вся остальная логистика ангела.
  here := coalesce(f.system_id, f.dest_sys, f.from_sys, a.home_sys);
  if here is null then return jsonb_build_object('ok', true, 'moving', true); end if;

  select count(*) into have from public.mza_ships where faction_id = a.faction_id;
  -- Больше двух рук незачем: залп у каждой раз в несколько часов, а износ
  -- корпуса всё равно съедает носитель за четыре выстрела.
  if have >= public._angel_host_const('pacer_cap')::int then
    -- рука ходит следом за телом
    update public.mza_ships set system_id = here, status = 'idle'
     where faction_id = a.faction_id and coalesce(system_id,'') <> here;
    return jsonb_build_object('ok', true, 'have', have, 'follow', true);
  end if;
  if not exists(select 1 from public.colony_buildings
                 where colony_id = a.colony_id and btype = 'ballfab') then
    return jsonb_build_object('ok', true, 'why', 'нет баллистического завода');
  end if;

  -- ⚠️ БЫЛО 0.5 — это 600 000 ГС при доходе ковчега в несколько тысяч в час:
  -- вторая рука не появлялась месяцами, и «Сполох» стрелять было нечем даже
  -- при полном складе. Четверть цены — он не строит носитель на верфи, он
  -- отделяет его от собственного корпуса.
  cost := public._mza_const('build_gc') * public._angel_host_const('pacer_mul');
  select e.gc into have_gc from public.faction_economy e where e.faction_id = a.faction_id;
  if coalesce(have_gc,0) < cost then
    return jsonb_build_object('ok', true, 'saving_for', 'pacer', 'need', cost);
  end if;
  update public.mza_ships set system_id = here, status = 'idle'
   where faction_id = a.faction_id and coalesce(system_id,'') <> here
     and status <> 'transit';
  update public.faction_economy set gc = gc - cost where faction_id = a.faction_id;
  insert into public.mza_ships(faction_id, owner_id, name, status, system_id, integrity)
    values (a.faction_id,
            (select owner_id from public.faction_economy where faction_id = a.faction_id),
            'Рука ' || (have + 1),
            'idle', here, 100)
    returning id into nid;
  return jsonb_build_object('ok', true, 'act', 'pacer', 'id', nid, 'gc', cost);
end$function$;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════
-- ШАГ 21: ВОИНСТВО ТОЖЕ НЕ ХОДИТ В ЧУЖИЕ БОИ
-- ────────────────────────────────────────────────────────────
-- ЧТО СЛУЧИЛОСЬ. Шаг 19 закрыл третью силу только для ТЕЛА — по флоту ковчега.
-- Как только у ангела появились свои флоты (шаг 20), в ту же дыру провалились
-- они: «⚔ В бой вступает третья сила: Проксима-Прайм» — и оба «Офанима»
-- оказались заперты в перехвате ЛЕГИОНА против чужой державы, где ангел не
-- сторона. Дальше тупик по кругу: флот скован боем и никуда не уйдёт, а на
-- доску его никто не выставит — `angel_battle_tick` разбирает только те бои,
-- где ангел числится нападающим или защищающимся. Десять часов простоя.
--
-- ПРАВИЛО. Ангел не союзник и не третья сила, он кризис. Его флоты выходят
-- только на СВОИ доски: стража — на бой у своего порога (там ангел сторона,
-- см. шаг 18), ковчег — по кнопке. Вступать в чужую драку им нечем и незачем.
-- Свои бои это не ломает: подкрепления и союзники — механизмы ПРОТИВНИКА,
-- и они работают, потому что там сторона он.
-- ════════════════════════════════════════════════════════════

-- ── ВЫТАЩИТЬ ЛЮБОЙ ЕГО ФЛОТ ИЗ ЧУЖОЙ ДОСКИ ──────────────────
-- Надмножество шага 19: раньше вытаскивало только тело.
create or replace function public._angel_unstick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare af text; ark uuid; r record; n int := 0;
begin
  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;
  select fleet_id into ark from public.angel_state where faction_id = af;

  for r in select bf.battle_id, bf.fleet_id, b.status, b.attacker_fid, b.defender_fid
             from public.battle_fleets bf
             join public.battles b on b.id = bf.battle_id
             join public.fleets f on f.id = bf.fleet_id
            where f.faction_id = af
  loop
    -- Бой кончился — строка уже ничего не держит.
    -- Ангел не сторона — это чужая драка, ему там нечего делать.
    -- Ангел сторона, но борта на доске нет и бой ещё формируется — тело
    -- (ковчег) туда не выставляют без приказа, значит и держать его нельзя.
    if r.status = 'done'
       or (r.attacker_fid is distinct from af and r.defender_fid is distinct from af)
       or (r.fleet_id = ark and not exists (select 1 from public.battle_units u
                                             where u.battle_id = r.battle_id and u.cls = 'angel'))
    then
      delete from public.battle_fleets
       where battle_id = r.battle_id and fleet_id = r.fleet_id;
      delete from public.battle_allies
       where battle_id = r.battle_id and fid = af
         and r.attacker_fid is distinct from af
         and r.defender_fid is distinct from af;
      n := n + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'freed', n);
end$$;
revoke all on function public._angel_unstick() from public;

-- ── 21.1 ТРЕТЬЯ СИЛА: НАДМНОЖЕСТВО _war_join_battle ────────
CREATE OR REPLACE FUNCTION public._war_join_battle(p_fid text, p_sys text, p_fleet uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- ⚠️ НАДМНОЖЕСТВО ЖИВОГО _war_join_battle (см. _angel_guard.sql, шаг 19).
declare r record; sd text; fresh boolean; sysname text; foe_name text;
begin
  if p_fid is null or p_sys is null or p_fleet is null then return null; end if;

  -- ◈ ПРЕСТОЛ. Ковчег НЕ вступает в чужие бои сам. Заслонка добровольности
  -- стояла только в `_war_engage`, а `_war_sweep` зовёт СНАЧАЛА эту дверь —
  -- и тело утягивало на чужую доску третьей силой, минуя правило целиком.
  -- Стоило это дорого: `_battle_lock_fleet` держит скованный флот на месте,
  -- а ковчег и есть держава — он вставал колом, переставал ходить по карте и
  -- висел в чужой расстановке обычным «Кораблём» из резерва.
  -- ⚠️ Стражи это НЕ касается: она обычный флот и в бои у своего порога
  -- вступает как все, вместе с подкреплениями и союзниками.
  if exists (select 1 from public.angel_state a
              where a.fleet_id = p_fleet and a.fell_at is null) then
    return null;
  end if;

  for r in select b.* from public.battles b
            where b.system_id = p_sys and b.status <> 'done'
            order by b.created_at
  loop
    sd := public._war_side_for(r.id, p_fid);
    if sd is null then continue; end if;   -- не моя война — следующий бой

    -- ◈ ПРЕСТОЛ НЕ ХОДИТ В ЧУЖИЕ БОИ. Он не союзник и не третья сила: он
    -- кризис. Своя доска у него есть — та, где он сторона (стража у порога,
    -- ковчег по кнопке). Всё остальное для него ловушка: втянутый флот
    -- скован боем, а выставить его туда некому — тик расстановки смотрит
    -- только бои, где ангел числится нападающим или защищающимся. Так и
    -- вышло: оба «Офанима» десять часов простояли запертыми в перехвате
    -- Легиона, куда их записало «в бой вступает третья сила».
    if public._angel_is(p_fid) and p_fid not in (r.attacker_fid, r.defender_fid) then
      continue;
    end if;

    -- Новичок на стороне? Запоминаем ДО вставки: главные участники в
    -- battle_allies не пишутся, им и объявляться незачем.
    fresh := (p_fid not in (r.attacker_fid, r.defender_fid))
             and not exists(select 1 from public.battle_allies a
                             where a.battle_id = r.id and a.fid = p_fid);

    if p_fid not in (r.attacker_fid, r.defender_fid) then
      insert into public.battle_allies(battle_id, fid, side, ready)
        values (r.id, p_fid, sd, false)
      on conflict (battle_id, fid) do nothing;
    end if;

    insert into public.battle_fleets(battle_id, fleet_id, fid, side)
      values (r.id, p_fleet, p_fid, sd)
    on conflict (battle_id, fleet_id) do nothing;

    if fresh then
      select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = p_sys;
      foe_name := public._war_nm(case when sd = 'attacker' then r.defender_fid else r.attacker_fid end);
      perform public._bt_log(r.id, format('%s вступает в бой на стороне %s.',
        public._war_nm(p_fid),
        public._war_nm(case when sd = 'attacker' then r.attacker_fid else r.defender_fid end)));
      perform public._war_news(
        '⚔ В бой вступает третья сила: ' || sysname,
        format('Флоты %s выходят из прыжка в системе %s и с ходу принимают сторону против %s. Расклад сил меняется.',
               public._war_nm(p_fid), sysname, foe_name),
        jsonb_build_array(p_fid, r.attacker_fid, r.defender_fid));
    else
      perform public._bt_log(r.id, format('%s подводит подкрепление.', public._war_nm(p_fid)));
    end if;

    return r.id;
  end loop;

  return null;
end$function$;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════
-- ШАГ 22: ОНО СТРОИТ. ВЕРФЬ, ГАРНИЗОНЫ И ПОРОГ ВЕЗДЕ
-- ────────────────────────────────────────────────────────────
-- ЗАМЫСЕЛ ЦЕЛИКОМ. Два эскортных флота фиксированным числом — декорация: их
-- выбьют один раз, и ангел снова останется голым телом, а всё, что он занял,
-- отберут на следующем ходу. Значит воинство должно РАСТИ: деньги (а их у него
-- 275 тысяч мёртвым грузом) идут в новые борта, борта — в крылья, крылья — в
-- гарнизоны занятых систем. Тогда захваченное держится не присутствием
-- ковчега, а тем, что там кто-то стоит.
--
-- ПОЧЕМУ НЕ ВЕРФЬ ИЗ КАТАЛОГА. У ангела нет ни верфи, ни палубы, ни экипажей —
-- ему нечем строить корабль в обычном смысле. Он его ОТДЕЛЯЕТ от себя, как и
-- «руку» Гиперпейсера: цена в ГС, одна штука за хозяйственный тик, потолок по
-- числу бортов. Медленно и предсказуемо — кризис, который растёт на глазах,
-- страшнее того, который однажды выкатил всё сразу.
--
-- ГАРНИЗОНЫ. Первое крыло ходит за телом (шаг 20). Остальные садятся в системы,
-- которые ангел занял (`system_occupation`) и где его флота нет: оккупация
-- снимается ПРИХОДОМ владельца или его союзника, причём тихо, если
-- останавливать некому. Гарнизон превращает это в бой — по обычным правилам
-- (шаг 18), потому что там ангел сторона.
--
-- ПОРОГ ВЕЗДЕ. `_angel_guard_watch` знал только стражу у гнезда. Теперь порог
-- там, где стоит любое его крыло: пришёл чужой флот — получил объявление войны
-- и доску. Ковчег по-прежнему сам ни во что не ввязывается.
-- ════════════════════════════════════════════════════════════

create or replace function public._angel_yard_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'ship_gc'  then 40000     -- цена одного Офанима
    when 'cap'      then 18        -- потолок бортов эскорта (шесть крыльев)
    when 'per_wing' then 3         -- бортов в крыле
    else 0 end
$$;

-- ── ВЕРФЬ: ОДИН БОРТ ЗА ХОЗЯЙСТВЕННЫЙ ТИК ───────────────────
create or replace function public._angel_shipyard()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; app record; ecoown uuid; have int; cap int; per int;
        price numeric; have_gc numeric; flid uuid; wname text; nord int; uid uuid;
        nm text; here text; wings int;
        wing text[] := array['ОФАНИМ-АЛЬФА','ОФАНИМ-БЕТА','ОФАНИМ-ГАММА',
                             'ОФАНИМ-ДЕЛЬТА','ОФАНИМ-ЭПСИЛОН','ОФАНИМ-ДЗЕТА'];
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;

  cap   := public._angel_yard_const('cap')::int;
  per   := public._angel_yard_const('per_wing')::int;
  price := public._angel_yard_const('ship_gc');

  select count(*) into have from public.angel_guard
   where role = 'escort' and dead_at is null;
  if have >= cap then return jsonb_build_object('ok', true, 'full', true, 'have', have); end if;

  -- ⚠️ Имя переменной НЕ `gc`: в `update faction_economy set gc = gc - price`
  -- ссылка стала бы двусмысленной, и функция падала бы на каждом вызове —
  -- молча, потому что тик глотает исключения.
  select e.gc into have_gc from public.faction_economy e where e.faction_id = a.faction_id;
  if coalesce(have_gc, 0) < price then
    return jsonb_build_object('ok', true, 'saving_for', 'ship', 'need', price);
  end if;

  select coalesce(f.system_id, f.dest_sys, f.from_sys, a.home_sys) into here
    from public.fleets f where f.id = a.fleet_id;
  select * into app from public.faction_applications
   where faction_id = a.faction_id and status = 'approved' order by updated_at desc limit 1;
  select owner_id into ecoown from public.faction_economy where faction_id = a.faction_id;

  -- Крыло с местом: борта считаем по ЖИВЫМ, иначе выбитое крыло никогда бы
  -- не пополнилось — место в нём занимали бы покойники.
  select g.fleet_id into flid
    from public.angel_guard g
   where g.role = 'escort' and g.dead_at is null and g.fleet_id is not null
     and exists (select 1 from public.fleets f where f.id = g.fleet_id)
   group by g.fleet_id
  having count(*) < per
   order by count(*) asc
   limit 1;

  if flid is null then
    select count(distinct g.fleet_id) into wings from public.angel_guard g
     where g.role = 'escort' and g.dead_at is null;
    wname := coalesce(wing[least(wings + 1, array_length(wing, 1))],
                      'ОФАНИМ-' || (wings + 1));
    insert into public.fleets(faction_id, owner_id, name, status, system_id, home_sys,
                              composition, is_station, fuel, fuel_cap)
      values (a.faction_id, ecoown, wname, 'idle', here, a.home_sys,
              '[]'::jsonb, false, 99, 99)
      returning id into flid;
  end if;

  select coalesce(max(ord), 100) + 1 into nord from public.angel_guard where role = 'escort';
  uid := ('a0000000-0000-4000-8000-e261f549b' || lpad(to_hex(nord), 3, '0'))::uuid;
  nm  := 'Офаним ' || nord;

  insert into public.faction_units(id, category, name, faction_id, faction_name,
                                   faction_color, owner_id, summary, data, card_text)
    values (uid, 'ship', nm, a.faction_id, coalesce(app.name, 'Престол'),
            coalesce(app.color, '#e6d38f'), ecoown,
            jsonb_build_object(
              'hp',    public._angel_host_const('hp'),
              'armor', public._angel_host_const('armor'),
              'dmg',   public._angel_host_const('dmg'),
              'rng',   public._angel_host_const('rng'),
              'speed', public._angel_host_const('speed'),
              'radar', 16,
              'armor_resist', jsonb_build_object(
                'kinetic', public._angel_host_const('resist'),
                'energy',  public._angel_host_const('resist'),
                'missile', public._angel_host_const('resist'))),
            jsonb_build_object('class', 'battleship', 'angel_guard', true,
                               'layout', jsonb_build_object('mounts', '[]'::jsonb),
                               'weapons', '[]'::jsonb, 'modules', '[]'::jsonb),
            'Колесо без обода и без глаз. Оно идёт следом и не отстаёт.')
    on conflict (id) do update set name = excluded.name, summary = excluded.summary;

  begin
    insert into public.bt_bot_exclude(unit_id, why) values (uid, 'эскорт Престола')
      on conflict (unit_id) do nothing;
  exception when others then null; end;

  insert into public.angel_guard(unit_id, faction_id, fleet_id, name, ord, role)
    values (uid, a.faction_id, flid, nm, nord, 'escort')
    on conflict (unit_id) do update set fleet_id = excluded.fleet_id, role = 'escort';

  update public.fleets
     set composition = coalesce(composition, '[]'::jsonb)
       || jsonb_build_array(jsonb_build_object('unit_id', uid, 'qty', 1))
   where id = flid;
  update public.faction_economy set gc = gc - price where faction_id = a.faction_id;

  return jsonb_build_object('ok', true, 'act', 'ship', 'name', nm,
                            'fleet', flid, 'have', have + 1, 'gc', price);
end$$;
revoke all on function public._angel_shipyard() from public;

-- ── КРЫЛЬЯ: ПЕРВОЕ ЗА ТЕЛОМ, ОСТАЛЬНЫЕ В ГАРНИЗОНЫ ──────────
-- Надмножество шага 20.
create or replace function public._angel_host_follow()
returns int language plpgsql security definer set search_path=public as $$
declare a record; here text; n int := 0; f record; sys text; lead uuid;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.fleet_id is null then return 0; end if;
  -- ⚠️ Только по прибытии: сопровождение не обгоняет сопровождаемого.
  select fl.system_id into here from public.fleets fl where fl.id = a.fleet_id;

  -- Ведущее крыло — самое старое. Оно и есть сопровождение тела.
  select g.fleet_id into lead from public.angel_guard g
   where g.role = 'escort' and g.dead_at is null
   order by g.ord limit 1;

  for f in select distinct fl.id, fl.system_id from public.fleets fl
             join public.angel_guard g on g.fleet_id = fl.id and g.dead_at is null
                                      and g.role = 'escort'
  loop
    if public._fleet_in_battle(f.id) is not null then continue; end if;

    sys := null;
    if f.id is distinct from lead then
      -- Занятая система, где нашего флота нет, — туда садится гарнизон.
      select o.system_id into sys from public.system_occupation o
       where o.occupier_fid = a.faction_id
         and not exists (select 1 from public.fleets x
                          where x.faction_id = a.faction_id and x.system_id = o.system_id
                            and x.id <> f.id)
       order by (o.system_id = f.system_id) desc
       limit 1;
    end if;
    -- Ведущему — и всем, кому гарнизона не досталось, — к телу.
    if sys is null then sys := here; end if;
    if sys is null or f.system_id is not distinct from sys then continue; end if;

    update public.fleets
       set system_id = sys, status = 'idle', from_sys = null, dest_sys = null,
           depart_at = null, arrive_at = null, route = null, route_at = null
     where id = f.id;
    n := n + 1;
  end loop;
  return n;
end$$;
revoke all on function public._angel_host_follow() from public;

-- ── ПОРОГ ТАМ, ГДЕ СТОИТ ЛЮБОЕ ЕГО КРЫЛО ────────────────────
-- Надмножество шага 18: сторож знал только стражу у гнезда.
create or replace function public._angel_guard_watch()
returns jsonb language plpgsql security definer set search_path=public as $$
declare af text; ark uuid; g record; foe record; b uuid; n int := 0; wars int := 0;
begin
  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;
  select fleet_id into ark from public.angel_state where faction_id = af;

  for g in select f.id, f.system_id from public.fleets f
            where f.faction_id = af and f.status = 'idle' and f.system_id is not null
              and f.id is distinct from ark          -- тело само ни во что не лезет
  loop
    if public._fleet_in_battle(g.id) is not null then continue; end if;

    for foe in select fl.id, fl.faction_id from public.fleets fl
                where fl.system_id = g.system_id and fl.status = 'idle'
                  and fl.faction_id is distinct from af
    loop
      if public._fleet_in_battle(foe.id) is not null then continue; end if;
      begin
        if not public.at_war(af, foe.faction_id) then
          perform public._angel_declare(foe.faction_id);
          wars := wars + 1;
        end if;
      exception when others then null; end;

      b := public._war_engage(g.id, foe.id, g.system_id, 'meeting');
      if b is not null then n := n + 1; end if;
      exit;                                  -- один бой за проход
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'battles', n, 'wars', wars);
end$$;
revoke all on function public._angel_guard_watch() from public;

-- ── ХОЗЯЙСТВЕННЫЙ ТИК: ДОБАВЛЕНА ВЕРФЬ ──────────────────────
create or replace function public.angel_econ_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; out jsonb := '{}'::jsonb;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;

  perform public._angel_seed_tech();
  begin perform public._apply_colony_projects(a.faction_id); exception when others then null; end;

  begin out := out || jsonb_build_object('tithe', public._angel_tithe());    exception when others then null; end;
  begin out := out || jsonb_build_object('forge', public._angel_forge());    exception when others then null; end;
  begin out := out || jsonb_build_object('build', public._angel_build());    exception when others then null; end;
  begin out := out || jsonb_build_object('pacer', public._angel_pacer());    exception when others then null; end;
  -- ⚠️ ВЕРФЬ ПОСЛЕДНЕЙ: сначала арсенал и руки, остаток денег — в борта.
  begin out := out || jsonb_build_object('yard',  public._angel_shipyard()); exception when others then null; end;

  return out || jsonb_build_object('ok', true);
end$$;
revoke all on function public.angel_econ_tick() from public;

notify pgrst, 'reload schema';
