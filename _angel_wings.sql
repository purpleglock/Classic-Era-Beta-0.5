-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — КРЫЛЬЯ: ВОИНСТВО, КОТОРОЕ УМЕЕТ УБИВАТЬ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_host.sql, _angel_ghost_board.sql и _angel_floor.sql.
-- Надмножество `_angel_host_const`, `_angel_host_stats`, `_angel_wound_cap`,
-- `_angel_guard_deploy`, `_angel_yard_const`. Идемпотентно.
--
-- ЗАМЕР ПО ЖИВОЙ БАЗЕ (24.08). Почему воинство «немощное»:
--
--   ОФАНИМ        hp 600000  armor  8000  dmg    22 000   acts: []
--   Серый Волк 02 hp  38705  armor     0  dmg 1 054 668   орудий 34
--   Бревноут      hp  51291  armor     0  dmg   752 086   орудий 46
--   Дредноут «Аманис»  hp 50000  armor 150000  dmg 28750  орудий 43
--
-- Разбор. Плоская `dmg` 22000 разбивается в `_angel_guard_deploy` на три
-- канала (0.50/0.32/0.18) — это 11000 за выстрел энергией. Против дредноута
-- с бронёй 150000 такой выстрел не значит НИЧЕГО. Плюс `acts = '[]'::jsonb`:
-- у эскорта не было ни одного боевого действия, только голые залпы, — тогда
-- как у стены (`wall`) полный набор. Итог: 600 000 живучести, которые ничего
-- не могут. Отсюда и вечные доски — оно не побеждает и не умирает.
--
-- ⚠️ НЕ «УМНОЖИТЬ dmg НА ДВАДЦАТЬ». Один раздутый борт — это тот же мешок,
-- только толще. Крыло должно быть СОСТАВОМ: кто держит строй, кто бьёт с
-- дистанции, кто прикрывает. Тогда против него есть тактика, а не только
-- арифметика.
--
-- ТРИ КОРПУСА В КРЫЛЕ:
--   • ОФАНИМ  (wheel)  — колесо. Линейный: броня, три канала, держит строй.
--   • СЕРАФИМ (sting)  — жало. Дальний перехватчик: rng 34, альфа, тонкий.
--   • АРЕЛИМ  (bearer) — носитель. Ракеты, звено, высокая ПРО, прикрывает.
--
-- КАЛИБРОВКА. Колесо ≈ 0.4 «Серого Волка» по залпу, жало ≈ 0.6. Крыло из
-- пяти бортов ≈ два «Серых Волка»; четыре крыла ≈ восемь. Против потолка
-- доски в 50 бортов это серьёзный, но не непобедимый противник — ровно то,
-- чего не было: сейчас ВСЁ воинство весит примерно полкорабля игрока.
-- ════════════════════════════════════════════════════════════

-- ── 0. ВИД КОРПУСА ──────────────────────────────────────────
-- ⚠️ Отдельной колонкой, а НЕ новым значением `role`. `role='escort'` читают
-- десять мест (сбор, верфь, следование, приказы, темп, раны) — подмена
-- значения молча выключила бы половину из них.
alter table public.angel_guard add column if not exists kind text;

create or replace function public._angel_hull_const(p_kind text, p_key text)
returns numeric language sql immutable as $$
  select case p_kind
    when 'sting' then case p_key
      when 'hp' then 240000 when 'armor' then 10000 when 'dmg' then 640000
      when 'rng' then 34 when 'speed' then 18 when 'resist' then 0.22
      when 'pd' then 0.15 when 'sensor' then 26 when 'wings' then 0
      when 'wounds' then 2 else 0 end
    when 'bearer' then case p_key
      when 'hp' then 500000 when 'armor' then 32000 when 'dmg' then 260000
      when 'rng' then 16 when 'speed' then 9 when 'resist' then 0.35
      when 'pd' then 0.60 when 'sensor' then 18 when 'wings' then 6
      when 'wounds' then 2 else 0 end
    else case p_key                      -- 'wheel' и всё неизвестное
      when 'hp' then 620000 when 'armor' then 45000 when 'dmg' then 420000
      when 'rng' then 20 when 'speed' then 10 when 'resist' then 0.42
      when 'pd' then 0.30 when 'sensor' then 20 when 'wings' then 0
      when 'wounds' then 3 else 0 end
  end
$$;

create or replace function public._angel_hull_name(p_kind text, p_ord int)
returns text language sql immutable as $$
  select case p_kind
    when 'sting'  then 'Серафим ' || p_ord
    when 'bearer' then 'Арелим '  || p_ord
    else               'Офаним '  || p_ord end
$$;

-- ── 1. ОРУЖИЕ ПО КОРПУСУ ────────────────────────────────────
-- У каждого вида свой разлёт по каналам и своя дистанция. Раньше разлёт был
-- один на всех (0.50 энергия / 0.32 кинетика / 0.18 ракеты), и «набрать
-- стойкость» против воинства можно было одной строчкой.
create or replace function public._angel_hull_wpn(p_kind text)
returns jsonb language sql stable as $$
  select case p_kind
    when 'sting' then jsonb_build_array(
      jsonb_build_object('rng', 34, 'dmg', round(640000 * 0.55 / 3), 'k', 'energy', 'shots', 3,
        'opt', public._bt_wpn_opt('energy'), 'far', public._bt_wpn_far('energy'),
        'dmin', public._bt_wpn_dmin('energy')),
      jsonb_build_object('rng', 40, 'dmg', round(640000 * 0.45 / 4), 'k', 'missile', 'shots', 4,
        'opt', public._bt_wpn_opt('missile'), 'far', public._bt_wpn_far('missile'),
        'dmin', public._bt_wpn_dmin('missile')))
    when 'bearer' then jsonb_build_array(
      jsonb_build_object('rng', 22, 'dmg', round(260000 * 0.55 / 5), 'k', 'missile', 'shots', 5,
        'opt', public._bt_wpn_opt('missile'), 'far', public._bt_wpn_far('missile'),
        'dmin', public._bt_wpn_dmin('missile')),
      jsonb_build_object('rng', 16, 'dmg', round(260000 * 0.45 / 4), 'k', 'energy', 'shots', 4,
        'opt', public._bt_wpn_opt('energy'), 'far', public._bt_wpn_far('energy'),
        'dmin', public._bt_wpn_dmin('energy')))
    else jsonb_build_array(
      jsonb_build_object('rng', 20, 'dmg', round(420000 * 0.50 / 5), 'k', 'kinetic', 'shots', 5,
        'opt', public._bt_wpn_opt('kinetic'), 'far', public._bt_wpn_far('kinetic'),
        'dmin', public._bt_wpn_dmin('kinetic')),
      jsonb_build_object('rng', 20, 'dmg', round(420000 * 0.30 / 4), 'k', 'energy', 'shots', 4,
        'opt', public._bt_wpn_opt('energy'), 'far', public._bt_wpn_far('energy'),
        'dmin', public._bt_wpn_dmin('energy')),
      jsonb_build_object('rng', 24, 'dmg', round(420000 * 0.20 / 3), 'k', 'missile', 'shots', 3,
        'opt', public._bt_wpn_opt('missile'), 'far', public._bt_wpn_far('missile'),
        'dmin', public._bt_wpn_dmin('missile')))
  end
$$;

-- ⚠️ СТРАЖА СЧИТАЕТСЯ ПО-СТАРОМУ. «Херувим» калиброван отдельно (шаг 19,
-- _angel_guard.sql: dmg 60000, rng 30) и в этот реворк не входит. Дословный
-- разлёт из _angel_host.sql — 0.50 энергия / 0.32 кинетика / 0.18 ракеты.
-- Без этой функции стражу пришлось бы кормить оружием колеса, и её залп
-- молча вырос бы всемеро, а дальность упала бы с 30 до 20.
create or replace function public._angel_wall_wpn()
returns jsonb language sql stable as $$
  select jsonb_build_array(
    jsonb_build_object('rng', public._angel_guard_const('rng')::int,
      'dmg', round(public._angel_guard_const('dmg') * 0.50), 'k', 'energy', 'shots', 4,
      'opt', public._bt_wpn_opt('energy'), 'far', public._bt_wpn_far('energy'),
      'dmin', public._bt_wpn_dmin('energy')),
    jsonb_build_object('rng', greatest(1, public._angel_guard_const('rng')::int - 4),
      'dmg', round(public._angel_guard_const('dmg') * 0.32), 'k', 'kinetic', 'shots', 4,
      'opt', public._bt_wpn_opt('kinetic'), 'far', public._bt_wpn_far('kinetic'),
      'dmin', public._bt_wpn_dmin('kinetic')),
    jsonb_build_object('rng', public._angel_guard_const('rng')::int + 4,
      'dmg', round(public._angel_guard_const('dmg') * 0.18), 'k', 'missile', 'shots', 3,
      'opt', public._bt_wpn_opt('missile'), 'far', public._bt_wpn_far('missile'),
      'dmin', public._bt_wpn_dmin('missile')))
$$;

-- ── 2. ДЕЙСТВИЯ ПО КОРПУСУ ──────────────────────────────────
-- Главная правка: у эскорта их теперь ЕСТЬ. Набор свой у каждого вида —
-- колесо держит, жало бьёт и уходит, носитель прикрывает.
create or replace function public._angel_hull_acts(p_kind text)
returns jsonb language sql immutable as $$
  select case p_kind
    when 'sting' then jsonb_build_array(
      jsonb_build_object('k', 'salvo',  'cd', 2, 'dmg', 150000, 'rng', 20),
      jsonb_build_object('k', 'blink',  'cd', 4, 'val', 6),
      jsonb_build_object('k', 'rapid',  'cd', 3, 'val', 0.6),
      jsonb_build_object('k', 'amp',    'cd', 4, 'val', 0.35, 'rng', 3))
    when 'bearer' then jsonb_build_array(
      jsonb_build_object('k', 'drones', 'cd', 2, 'val', 6),
      jsonb_build_object('k', 'pdup',   'cd', 3, 'val', 0.45, 'rng', 4),
      jsonb_build_object('k', 'torpedo','cd', 3, 'dmg', 180000, 'rng', 22),
      jsonb_build_object('k', 'aboost', 'cd', 4, 'val', 0.30, 'rng', 4))
    else jsonb_build_array(
      jsonb_build_object('k', 'hard',      'cd', 3, 'val', 0.35, 'rng', 2),
      jsonb_build_object('k', 'broadside', 'cd', 2, 'dmg', 160000, 'rng', 5),
      jsonb_build_object('k', 'salvo',     'cd', 3, 'dmg', 120000, 'rng', 14),
      jsonb_build_object('k', 'ram',       'cd', 5),
      jsonb_build_object('k', 'aboost',    'cd', 4, 'val', 0.30, 'rng', 3))
  end
$$;

-- ── 3. КОНСТАНТЫ ВОИНСТВА — НАДМНОЖЕСТВО ────────────────────
-- Крыло из пяти вместо трёх, крыльев четыре вместо двух. Ключи `hp/armor/dmg/
-- rng/speed/resist` оставлены и указывают на КОЛЕСО: их читают старые места
-- (спрайты, зенитки, раны), и пустить туда ноль значило бы тихо всё сломать.
create or replace function public._angel_host_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    -- ⚠️ ЭТО РАЗМЕР ПЕРВОГО СБОРА, А НЕ ШТАТ ВОИНСТВА. `angel_host_muster`
    -- лепит `fleets × per` бортов с детерминированными uuid и БЕЗ ГС —
    -- это завязка кризиса, она обязана быть маленькой. Подняв здесь 2×3 до
    -- 4×5, я заставил сбор штамповать по 20 бесплатных бортов каждый тик, и
    -- эскорт за один прогон разнесло с 24 до 44 при потолке верфи 30.
    -- Штат задаёт ВЕРФЬ: `_angel_yard_const('cap')` и `per_wing`.
    when 'fleets'  then 2          -- крыльев в ПЕРВОМ сборе
    when 'per'     then 3          -- бортов в крыле при ПЕРВОМ сборе
    when 'hp'      then public._angel_hull_const('wheel', 'hp')
    when 'armor'   then public._angel_hull_const('wheel', 'armor')
    when 'dmg'     then public._angel_hull_const('wheel', 'dmg')
    when 'rng'     then public._angel_hull_const('wheel', 'rng')
    when 'speed'   then public._angel_hull_const('wheel', 'speed')
    when 'resist'  then public._angel_hull_const('wheel', 'resist')
    when 'wounds'  then public._angel_hull_const('wheel', 'wounds')
    when 'flak'    then 30         -- пол зенитного расчёта крыла
    when 'pacer_cap' then 4
    when 'pacer_mul' then 0.25
    when 'hunter_keep' then 2
    else 0 end
$$;

create or replace function public._angel_yard_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'ship_gc'  then 40000
    when 'cap'      then 30        -- потолок бортов эскорта (шесть крыльев по пять)
    when 'per_wing' then 5
    else 0 end
$$;

-- ── 4. ПАСПОРТ БОРТА — НАДМНОЖЕСТВО ─────────────────────────
-- Ключ теперь вид корпуса, а не роль: 'wall' по-прежнему Херувим и берёт свои
-- числа из `_angel_guard_const`, всё остальное — корпуса воинства.
create or replace function public._angel_host_stats(p_role text)
returns jsonb language sql stable as $$
  select case when p_role = 'wall' then
    jsonb_build_object(
      'hp',     public._angel_guard_const('hp'),
      'armor',  public._angel_guard_const('armor'),
      'dmg',    public._angel_guard_const('dmg'),
      'rng',    public._angel_guard_const('rng')::int,
      'speed',  public._angel_guard_const('speed')::int,
      'resist', public._angel_guard_const('resist'),
      'pd',     0.25, 'sensor', 18, 'wings', 0,
      'cls',    'dreadnought', 'gd', 1)
  else
    jsonb_build_object(
      'hp',     public._angel_hull_const(coalesce(p_role,'wheel'), 'hp'),
      'armor',  public._angel_hull_const(coalesce(p_role,'wheel'), 'armor'),
      'dmg',    public._angel_hull_const(coalesce(p_role,'wheel'), 'dmg'),
      'rng',    public._angel_hull_const(coalesce(p_role,'wheel'), 'rng')::int,
      'speed',  public._angel_hull_const(coalesce(p_role,'wheel'), 'speed')::int,
      'resist', public._angel_hull_const(coalesce(p_role,'wheel'), 'resist'),
      'pd',     public._angel_hull_const(coalesce(p_role,'wheel'), 'pd'),
      'sensor', public._angel_hull_const(coalesce(p_role,'wheel'), 'sensor')::int,
      'wings',  public._angel_hull_const(coalesce(p_role,'wheel'), 'wings')::int,
      'cls',    case when coalesce(p_role,'wheel') = 'sting' then 'cruiser'
                     else 'battleship' end,
      'gd',     2)
  end
$$;

-- ── 5. РАНЫ ПО КОРПУСУ ──────────────────────────────────────
create or replace function public._angel_wound_cap(p_unit uuid)
returns int language sql stable security definer set search_path=public as $$
  select greatest(1, case
    when (select role from public.angel_guard where unit_id = p_unit) = 'escort'
      then public._angel_hull_const(
             coalesce((select kind from public.angel_guard where unit_id = p_unit), 'wheel'),
             'wounds')::int
    else public._angel_guard_const('wounds')::int end)
$$;

-- ── 6. РАЗДАЧА КОРПУСОВ ─────────────────────────────────────
-- Сбор и верфь (`angel_host_muster`, `_angel_shipyard`) не трогаем: обе
-- функции большие и заняты другим. Вид корпуса проставляем отдельным проходом
-- по порядку в крыле — 2 колеса, 2 жала, носитель. Пересчитывается на каждый
-- тик, поэтому пополнение верфи получает вид само.
create or replace function public._angel_kinds()
returns jsonb language plpgsql security definer set search_path=public as $$
declare n int := 0;
begin
  with ranked as (
    select g.unit_id,
           row_number() over (partition by g.fleet_id order by g.ord) as pos
      from public.angel_guard g
     where g.role = 'escort' and g.dead_at is null
  )
  update public.angel_guard g
     set kind = case ((r.pos - 1) % 5)
                  when 2 then 'sting'
                  when 3 then 'sting'
                  when 4 then 'bearer'
                  else        'wheel' end
    from ranked r
   where g.unit_id = r.unit_id
     and g.kind is distinct from case ((r.pos - 1) % 5)
                  when 2 then 'sting'
                  when 3 then 'sting'
                  when 4 then 'bearer'
                  else        'wheel' end;
  get diagnostics n = row_count;

  -- Имя борта идёт за корпусом: «Серафим» в списке флота должен читаться
  -- как другой корабль, иначе состав крыла не виден вообще нигде.
  update public.angel_guard g
     set name = public._angel_hull_name(g.kind, g.ord)
   where g.role = 'escort' and g.dead_at is null
     and g.name is distinct from public._angel_hull_name(g.kind, g.ord);

  update public.faction_units u
     set name = g.name,
         summary = u.summary || jsonb_build_object(
           'hp',    public._angel_hull_const(g.kind, 'hp'),
           'armor', public._angel_hull_const(g.kind, 'armor'),
           'dmg',   public._angel_hull_const(g.kind, 'dmg'),
           'rng',   public._angel_hull_const(g.kind, 'rng'),
           'speed', public._angel_hull_const(g.kind, 'speed'),
           'armor_resist', jsonb_build_object(
             'kinetic', public._angel_hull_const(g.kind, 'resist'),
             'energy',  public._angel_hull_const(g.kind, 'resist'),
             'missile', public._angel_hull_const(g.kind, 'resist')))
    from public.angel_guard g
   where g.unit_id = u.id and g.role = 'escort' and g.dead_at is null;

  return jsonb_build_object('ok', true, 'retyped', n);
end$$;
revoke all on function public._angel_kinds() from public;

-- ── 7. РАССТАНОВКА ВОИНСТВА — НАДМНОЖЕСТВО ──────────────────
-- Дословный `_angel_guard_deploy` из _angel_host.sql (шаг 20), три правки:
--   • паспорт и оружие берутся по ВИДУ КОРПУСА, а не по одной плоской `dmg`;
--   • у эскорта появились действия (`_angel_hull_acts`) — раньше было '[]';
--   • жало встаёт в сектор стрелка, колесо и носитель — в свалку.
create or replace function public._angel_guard_deploy(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; af text; sd text; fc int; xy int[]; g record; n int := 0;
        st jsonb; kd text; wpn jsonb; res numeric;
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
        (st->>'hp')::numeric, (st->>'hp')::numeric, (st->>'armor')::numeric, 0, 0,
        (st->>'dmg')::numeric, (st->>'speed')::int, (st->>'rng')::int,
        fc, public._bt_turnneed(st->>'cls'), (st->>'sensor')::int, 1, wpn,
        jsonb_build_object('kinetic', res, 'energy', res, 'missile', res),
        (st->>'pd')::numeric, 4, (st->>'wings')::int, 4, 4,
        -- ⚠️ Интердикцию держит только колесо: иначе от крыла нельзя было бы
        -- уйти в прыжок вообще ничем, и «сбежать» перестало бы быть ответом.
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

  return jsonb_build_object('ok', true, 'placed', n);
end$$;
revoke all on function public._angel_guard_deploy(uuid) from public;

notify pgrst, 'reload schema';

-- ── 8. РАЗДАТЬ КОРПУСА УЖЕ СОБРАННОМУ ВОИНСТВУ ──────────────
do $$
declare r jsonb;
begin
  r := public._angel_kinds();
  raise notice 'корпуса розданы: %', r;
end$$;
