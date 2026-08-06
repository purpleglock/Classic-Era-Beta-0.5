-- © 2025–2026. Все права защищены.
-- ════════════════════════════════════════════════════════════
-- БОЙ: МОДЕЛИ УРОНА ОРУДИЙ + ФАКЕЛЬЩИК-АРТА  (проекция Dreadnought)
-- ════════════════════════════════════════════════════════════
-- ЦЕПОЧКА: применять ПОСЛЕ _bt_timepool + _bt_stance + _bt_terrain_cost
--          + _nano_repair (живое ядро _bt_stats оттуда). Идемпотентно.
--
-- ЧТО БЕРЁМ ИЗ ИСТОЧНИКА (dreadnought.fandom.com/wiki/Weapons):
--   Там у каждого орудия НЕ одна цифра урона, а ПОЛОСЫ по дистанции.
--   Три архетипа читаются сразу:
--     • Dual Heavy Autocannons (корвет): 2420 → 596 → 420 — обрыв в упор-оружие,
--       на краю остаётся четверть. Это наша КИНЕТИКА.
--     • Repeater / Beam Turrets: 1188 → 1188 → 1072 — пологий спад, работает
--       на всей дистанции. Это наша ЭНЕРГЕТИКА.
--     • Tempest Missiles: один урон на все 7000 м, но летит долго и его сбивают.
--       Это наши РАКЕТЫ — плоско, зато ПРО режет (уже есть) и в упор не наводятся.
--     • Heavy Tesla Cannon (Artillery Cruiser): DPS плоский 0–7000 м при RoF 8/мин
--       — то есть ДАЛЬНО, СИЛЬНО, РЕДКО. Это факельщик.
--
-- ЧТО МЕНЯЕТСЯ У НАС:
--   1) У огневой группы появляются opt/far/dmin — урон падает за оптимумом.
--   2) hyperCruiser («Факельщик») получает арт-профиль: дальность ×1.5, урон ×1.3,
--      спада НЕТ (flat), но залп дорожает 0.75 → 0.90 пула — за ход выходит один
--      выстрел и почти ничего сверху. Ровно размен из вики: дальность и альфа
--      против скорострельности.
--   3) Осадный режим (Siege Mode из /wiki/Modules) — четвёртая стойка колеса,
--      только факельщику: урон ×2, дальность ×1.25, но корабль ПРИКОВАН к месту.
-- ════════════════════════════════════════════════════════════

-- ── 1) Профиль спада урона по каналу ─────────────────────────
-- opt — доля дальности, на которой урон ещё полный; far — множитель на самом
-- краю. Между ними — линейно. Одно место на всю боёвку: крутить баланс тут.
create or replace function public._bt_wpn_opt(k text) returns numeric
language sql immutable as $$
  select case coalesce(k,'kinetic')
    when 'kinetic' then 0.40      -- автопушки: злые в упор
    when 'energy'  then 0.60      -- лучи: ровно тянут
    when 'missile' then 1.00      -- ракеты: урон от дистанции не зависит
    else 1.00 end;                -- repair и прочее — без спада
$$;

create or replace function public._bt_wpn_far(k text) returns numeric
language sql immutable as $$
  select case coalesce(k,'kinetic')
    when 'kinetic' then 0.25
    when 'energy'  then 0.60
    else 1.00 end;
$$;

-- Мёртвая зона: ракете нужен разгон и захват, вплотную она не работает.
-- Это то, ради чего корвету вообще имеет смысл лезть в упор.
create or replace function public._bt_wpn_dmin(k text) returns int
language sql immutable as $$
  select case when coalesce(k,'kinetic') = 'missile' then 2 else 1 end;
$$;

-- ── 2) Класс-профиль орудий: кто чем является ────────────────
-- rng/dmg — множители ТТХ, flat — снять спад (арта бьёт ровно на всю дистанцию).
create or replace function public._bt_cls_gun(cls text) returns jsonb
language sql immutable as $$
  select coalesce(
    (jsonb_build_object(
      -- Факельщик = Artillery Cruiser: дальше, больнее, реже (см. _bt_fire_cost).
      'hyperCruiser', jsonb_build_object('rng', 1.5, 'dmg', 1.3, 'flat', true)
    ))->cls,
    jsonb_build_object('rng', 1.0, 'dmg', 1.0, 'flat', false));
$$;

-- ── 3) Осадный режим ─────────────────────────────────────────
create or replace function public._bt_siege_dmg()  returns numeric language sql immutable as $$ select 2.0 $$;
create or replace function public._bt_siege_rng()  returns numeric language sql immutable as $$ select 1.25 $$;
create or replace function public._bt_siege_cost() returns numeric language sql immutable as $$ select 2.0 $$;
-- Кто вообще умеет раскладываться в осаду. Список — не строка в коде UI.
create or replace function public._bt_can_siege(cls text) returns boolean
language sql immutable as $$ select coalesce(cls,'') = 'hyperCruiser' $$;

-- ── 4) Цена залпа: факельщик стреляет ещё реже ───────────────
create or replace function public._bt_fire_cost(cls text)
returns numeric language sql immutable as $$
  select public._bt_tp_max() * coalesce((jsonb_build_object(
    'wing',0.30,'corvette',0.35,'frigate',0.40,
    'destroyer',0.50,
    'mediumCruiser',0.55,'cruiser',0.55,'supportCarrier',0.55,
    'multiroleCarrier',0.60,'battleship',0.65,
    'hyperCruiser',0.90,'ss13',0.55,
    'dreadnought',0.70)->>cls)::numeric, 0.55);
$$;

-- ── 5) _bt_stats: класс-профиль + opt/far/dmin в каждой группе ──
-- Тело — живое ядро из _nano_repair.sql, доработанное. Менять здесь, не там.
create or replace function public._bt_stats(p_unit uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare u record; sm jsonb; cls text; spd int; rng numeric; cab jsonb;
        wpn jsonb; sens int; gp jsonb; gr numeric; gd numeric; flat boolean;
begin
  select * into u from public.faction_units where id = p_unit;
  if u.id is null then return null; end if;
  sm  := coalesce(u.summary, '{}'::jsonb);
  cls := nullif(u.data->>'class','');
  spd := greatest(1, least(40, round(coalesce((sm->>'speed')::numeric, 4))::int));
  if cls = 'ss13' then spd := 0; end if;   -- станция неподвижна
  cab := public._cn_catalog();

  gp   := public._bt_cls_gun(cls);
  gr   := coalesce((gp->>'rng')::numeric, 1);
  gd   := coalesce((gp->>'dmg')::numeric, 1);
  flat := coalesce((gp->>'flat')::boolean, false);

  with mounts as (
    select coalesce(m->'w'->>'g', m->>'g') as g,
           coalesce((m->'w'->>'idx')::int, (m->>'idx')::int) as idx,
           nullif(coalesce(m->'w'->>'turretId', m->>'turretId'),'')::uuid as tid,
           1 as q,
           nullif(m->>'battery','') as battery
      from jsonb_array_elements(coalesce(u.data->'layout'->'mounts','[]'::jsonb)) m
     where coalesce(m->'w'->>'g', m->>'g') is not null
        or nullif(coalesce(m->'w'->>'turretId', m->>'turretId'),'') is not null
    union all
    -- проекты без схемы (старый формат / наземка)
    select w->>'g', coalesce((w->>'idx')::int, -1),
           nullif(w->>'turretId','')::uuid,
           greatest(1, coalesce((w->>'q')::int, 1)), nullif(w->>'battery','')
      from jsonb_array_elements(coalesce(u.data->'weapons','[]'::jsonb)) w
     where u.data->'layout'->'mounts' is null
  ), src as (
    select m.*, ft.stats as ts,
           cab->coalesce(u.category,'ship')->'weapons'->m.g->m.idx as co
      from mounts m
      left join public.faction_turrets ft on ft.id = m.tid
  ), shots as (
    select s.battery,
           greatest(1, least(40, round(coalesce(
             (s.ts->>'dalnost')::numeric, (s.co->>'dalnost')::numeric, 1))))::int as rng,
           -- у ремонтной турели «урон» группы = сколько корпуса она вернёт
           coalesce(case when s.ts->>'kind' = 'repair'
                         then coalesce((s.ts->>'heal')::numeric,
                                       round(coalesce((s.ts->>'damage')::numeric,0) * 0.5))
                         else (s.ts->>'damage')::numeric end,
                    (s.co->>'dmg')::numeric, 0) * s.q as dmg,
           -- канал: repair — не бьёт, а лечит; ballistic→kinetic
           case when s.ts is not null then
                  case s.ts->>'kind' when 'repair' then 'repair'
                                     when 'missile' then 'missile'
                                     when 'energy' then 'energy' else 'kinetic' end
                else
                  case public._cn_wpn_kind(s.co->>'name')
                    when 'missile' then 'missile' when 'energy' then 'energy' else 'kinetic' end
           end as k,
           public._bt_shots_tier(coalesce((s.ts->>'rof')::numeric,
                                          (s.co->>'rof')::numeric)) as tier
      from src s
     where s.ts is not null or s.co is not null
  ),
  g_auto as (
    select shots.rng, shots.k, shots.tier as shots, sum(shots.dmg) as sum_dmg, null::text as bat
      from shots where shots.dmg > 0 and shots.battery is null
     group by shots.rng, shots.k, shots.tier
  ),
  g_man as (
    select min(shots.rng) as rng, shots.k,
           greatest(1, least(6, round(sum(shots.dmg * shots.tier) / nullif(sum(shots.dmg), 0))))::int as shots,
           sum(shots.dmg) as sum_dmg, shots.battery as bat
      from shots where shots.dmg > 0 and shots.battery is not null
     group by shots.k, shots.battery
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           -- ремонтный рой класс-профилем НЕ качаем: он не орудие
           'rng',  case when gg.k = 'repair' then gg.rng
                        else greatest(1, least(40, round(gg.rng * gr)))::int end,
           'dmg',  round(gg.sum_dmg * case when gg.k = 'repair' then 1 else gd end),
           'k',    gg.k,
           'shots', gg.shots,
           'bat',  gg.bat,
           -- модель урона по дистанции: полный урон до opt·rng, далее спад до far
           'opt',  case when flat or gg.k = 'repair' then 1.0 else public._bt_wpn_opt(gg.k) end,
           'far',  case when flat or gg.k = 'repair' then 1.0 else public._bt_wpn_far(gg.k) end,
           'dmin', case when gg.k = 'repair' then 1 else public._bt_wpn_dmin(gg.k) end
         )), '[]'::jsonb)
    into wpn
    from (select * from g_auto union all select * from g_man) gg;

  -- дальность корабля = самая длинная БОЕВАЯ группа (ремонт сюда не считаем)
  select coalesce(max((g->>'rng')::int), 1) into rng
    from jsonb_array_elements(wpn) g where coalesce(g->>'k','kinetic') <> 'repair';
  if rng is null or not exists(select 1 from jsonb_array_elements(wpn) g
                                where coalesce(g->>'k','kinetic') <> 'repair') then
    rng := greatest(1, least(40, coalesce((sm->>'rng')::numeric, 1) * gr));
  end if;

  sens := greatest(6, least(30, round(coalesce(nullif((sm->>'radar')::numeric, 0), 10))::int
                                + coalesce((sm->'mods'->>'sensor')::int, 0)));

  return jsonb_build_object(
    'name',    u.name,
    'cls',     cls,
    'hp',      greatest(1, coalesce((sm->>'hp')::numeric, 100)),
    'armor',   greatest(0, coalesce((sm->>'armor')::numeric, 0)),
    'shield',  greatest(0, coalesce((sm->>'shield')::numeric, 0)),
    'dmg',     greatest(1, coalesce((sm->>'dmg')::numeric, 10) * gd),
    'speed',   spd,
    'rng',     round(rng)::int,
    'wpn',     wpn,
    'sensor',  sens,
    'stealth', least(12, public._bt_stealth(cls) + coalesce((sm->'mods'->>'stealth')::int, 0)),
    'pd',      least(0.6, greatest(0, coalesce((sm->'mods'->>'pd')::numeric, 0))),
    'jam',     greatest(0, coalesce((sm->'mods'->>'jam')::int, 0)),
    'dejam',   greatest(0, coalesce((sm->'mods'->>'dejam')::int, 0)),
    'eccm',    greatest(0, coalesce((sm->'mods'->>'eccm')::int, 0)),
    'interdict', coalesce((sm->'mods'->>'interdict')::bool, false),
    'stabil',    coalesce((sm->'mods'->>'stabil')::bool, false),
    'ftl',       coalesce((sm->'mods'->>'ftl')::bool, false),
    'cargo',   greatest(0, coalesce((sm->>'cargo')::numeric, 0)),
    'crew',    greatest(0, coalesce((sm->>'crew')::numeric, 0)),
    'wings',   greatest(0, floor(coalesce((sm->'mods'->>'hangar')::numeric, 0) / 300))::int,
    'resist',  coalesce(sm->'armor_resist',
                        '{"kinetic":0,"energy":0,"missile":0}'::jsonb));
end$$;

-- ── 6) Залп: спад по дистанции, мёртвая зона ракет, осада ────
-- Тело — живое ядро, доработаны только ветки расчёта группы.
create or replace function public._bt_do_fire(p_battle uuid, p_unit uuid, p_target uuid, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; u record; t record; dist int;
        wg jsonb; dmgfac numeric := 1;
        absorbed numeric; hull numeric; killed boolean := false;
        band_ok boolean := false; too_close boolean := false;
        rk numeric; resisted numeric := 0;
        rsh numeric; shabs numeric := 0;
        grp_shots int; per_shot numeric; gdmg numeric; absb numeric;
        use_sec numeric; covered numeric;
        total_dmg numeric := 0; hull_leak numeric := 0; i int;
        ally boolean; heal_sum numeric := 0; healed numeric := 0;
        fcost numeric; boost numeric := 1; rmul numeric := 1;
        grng int; gopt int; gfar numeric; fmul numeric; gdmin int;
begin
  perform public._bt_arm(p_battle);
  me := p_fid;
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;

  fcost := public._bt_fire_cost(u.cls);
  if u.stance = 'wpn' then fcost := fcost * public._bt_wpn_cost(); end if;
  if u.tp + 1e-9 < fcost then
    raise exception '«%» не успевает дать залп: нужно % c, осталось % c',
      u.unit_name, round(fcost, 1), round(u.tp, 1);
  end if;
  if u.stance = 'wpn'   then boost := public._bt_wpn_mult(); end if;   -- ФОРСАЖ ОРУДИЙ
  if u.stance = 'siege' then                                          -- ОСАДНЫЙ РЕЖИМ
    boost := public._bt_siege_dmg();
    rmul  := public._bt_siege_rng();
  end if;

  select * into t from public.battle_units where id = p_target and battle_id = p_battle for update;
  if t.id is null or not t.alive then raise exception 'цели нет'; end if;

  ally := (t.side = u.side);
  dist := public._bt_dist(u.x, u.y, t.x, t.y);

  -- ══ РЕМОНТ СОЮЗНИКА (нано-рой) ═════════════════════════════
  if ally then
    if t.id = u.id then
      raise exception 'нано-рой чинит только ДРУГОЙ корабль — себя им не залатать';
    end if;
    if not exists(select 1 from jsonb_array_elements(coalesce(u.wpn,'[]'::jsonb)) g
                   where g->>'k' = 'repair') then
      raise exception 'по своим не стреляем: на «%» нет ремонтных нано-роёв', u.unit_name;
    end if;
    if not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
      raise exception 'путь рою перекрыт астероидами';
    end if;
    for wg in select value from jsonb_array_elements(coalesce(u.wpn,'[]'::jsonb)) loop
      if wg->>'k' = 'repair' and dist >= 1 and dist <= (wg->>'rng')::int then
        band_ok := true;
        heal_sum := heal_sum + (wg->>'dmg')::numeric;
      end if;
    end loop;
    if not band_ok then
      raise exception 'дистанция % — дальше, чем добрасывает ремонтный рой «%». Сблизьтесь', dist, u.unit_name;
    end if;
    heal_sum := heal_sum * boost;      -- форсаж орудий качает и ремонтный рой
    if public._bt_terra(b.terrain, t.x, t.y) = 'neb' then heal_sum := heal_sum * 0.7; end if;
    healed := least(round(heal_sum), greatest(0, t.max_hp - t.hp));
    if healed <= 0 then raise exception '«%» и так цел — ремонтировать нечего', t.unit_name; end if;

    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units set hp = least(max_hp, hp + healed) where id = p_target;
    update public.battle_units
       set fired = true, flash = true, tp = greatest(0, tp - fcost) where id = p_unit;
    perform public._bt_log(p_battle, format('%s ⟳ %s: нано-рой восстановил %s корпуса',
      u.unit_name, t.unit_name, round(healed)));
    return jsonb_build_object('ok', true, 'healed', round(healed), 'hull', 0,
                              'shield_absorbed', 0, 'resisted', 0, 'killed', false,
                              'tp', round(u.tp - fcost, 1));
  end if;

  -- ══ ОБЫЧНЫЙ ЗАЛП ═══════════════════════════════════════════
  if not exists(select 1 from public.battle_units m
                 where m.battle_id = p_battle and m.side = u.side and m.alive
                   and public._bt_detected(m.x, m.y, m.facing,
                                           greatest(0, m.sensor - greatest(0, public._bt_ecm(p_battle, m.side, m.x, m.y) - m.eccm)),
                                           t.x, t.y, t.stealth, t.flash)) then
    raise exception 'цель не захвачена: неопознанный контакт. Подведите корабль с радаром ближе (визуал — 3 гекса) или выбейте РЭБ-глушилки врага';
  end if;

  if not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
    raise exception 'линия огня перекрыта астероидами';
  end if;

  rsh := greatest(0, coalesce(t.shield, 0));
  if public._bt_terra(b.terrain, t.x, t.y) = 'neb' then rsh := 0; dmgfac := 0.7; end if;
  if public._bt_terra(b.terrain, t.x, t.y) = 'deb' then dmgfac := 0.85; end if;

  for wg in select value from jsonb_array_elements(
      case when u.wpn is null or jsonb_array_length(u.wpn) = 0
           then jsonb_build_array(jsonb_build_object('rng',u.rng,'dmg',u.dmg))
           else u.wpn end) loop
    if coalesce(wg->>'k','kinetic') <> 'repair' then
      -- Дальность группы: осадный режим раздвигает рубеж.
      grng  := greatest(1, ceil((wg->>'rng')::numeric * rmul)::int);
      gdmin := greatest(1, coalesce((wg->>'dmin')::int,
                                    public._bt_wpn_dmin(wg->>'k')));
      if dist >= 1 and dist < gdmin then
        too_close := true;                       -- ракеты вплотную не наводятся
      elsif dist >= gdmin and dist <= grng then
        band_ok := true;
        -- Модель урона по дистанции: до gopt — полный, дальше линейно до gfar.
        gopt := greatest(1, floor(grng * coalesce((wg->>'opt')::numeric,
                                                  public._bt_wpn_opt(wg->>'k')))::int);
        gfar := coalesce((wg->>'far')::numeric, public._bt_wpn_far(wg->>'k'));
        if dist <= gopt or grng <= gopt then
          fmul := 1;
        else
          fmul := 1 - (1 - gfar) * (dist - gopt)::numeric / (grng - gopt)::numeric;
        end if;
        fmul := greatest(0.05, least(1, fmul));

        rk := least(0.9, greatest(-0.75, coalesce(
                (t.resist->>coalesce(wg->>'k','kinetic'))::numeric, 0)));
        if coalesce(wg->>'k','kinetic') = 'missile' and coalesce(t.pd,0) > 0 then
          rk := 1 - (1 - rk) * (1 - least(0.6, t.pd));
        end if;
        gdmg     := (wg->>'dmg')::numeric * boost * fmul * (1 - rk) * dmgfac;
        resisted := resisted + (wg->>'dmg')::numeric * boost * fmul * rk * dmgfac;
        grp_shots := greatest(1, least(6, coalesce((wg->>'shots')::int, 1)));
        per_shot := gdmg / grp_shots;
        for i in 1..grp_shots loop
          absb := 0;
          if rsh > 0 and per_shot > 0 then
            use_sec := least(rsh, per_shot / greatest(1, t.mitig));
            covered := use_sec * t.mitig;
            absb    := covered * t.reduc;
            rsh     := rsh - use_sec;
          end if;
          shabs     := shabs + absb;
          total_dmg := total_dmg + per_shot;
          hull_leak := hull_leak + (per_shot - absb);
        end loop;
      end if;
    end if;
  end loop;
  if not band_ok then
    if too_close then
      raise exception 'дистанция % — ракетам не хватает разгона на захват, отойдите дальше (нужно от % гексов)',
        dist, (select min(greatest(1, coalesce((g->>'dmin')::int, 1)))
                 from jsonb_array_elements(u.wpn) g
                where coalesce(g->>'k','kinetic') = 'missile');
    end if;
    raise exception 'дистанция % — дальше, чем бьют огневые группы «%». Сблизьтесь', dist, u.unit_name;
  end if;

  perform public._bt_use_act(p_battle, p_unit);

  absorbed := shabs;
  hull := greatest(total_dmg * 0.10, hull_leak - t.armor);
  if total_dmg <= 0 then hull := 0; end if;
  update public.battle_units
     set shield = rsh,
         hp = greatest(0, t.hp - hull),
         alive = (t.hp - hull) > 0
   where id = p_target;
  killed := (t.hp - hull) <= 0;
  update public.battle_units
     set fired = true, flash = true, tp = greatest(0, tp - fcost) where id = p_unit;

  perform public._bt_log(p_battle, format('%s → %s: %s урона%s%s%s',
    u.unit_name, t.unit_name, round(absorbed + hull),
    case when u.stance = 'siege' then ' (осадный режим)'
         when boost > 1 then ' (форсаж орудий)' else '' end,
    case when resisted >= 1 then format(' (броня рассеяла %s)', round(resisted)) else '' end,
    case when killed then ' — цель уничтожена' else '' end));

  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'shield_absorbed', round(absorbed), 'hull', round(hull),
                            'resisted', round(resisted), 'killed', killed, 'healed', 0,
                            'tp', round(u.tp - fcost, 1), 'target_shield', round(rsh, 1));
end$$;

-- ── 7) Стойка «осада»: четвёртый сегмент колеса ──────────────
-- Тело — живое ядро из _bt_stance.sql плюс ветка siege.
create or replace function public.battle_stance(p_battle uuid, p_unit uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b public.battles; u record; cost numeric; sec numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_arm(p_battle);
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if p_mode not in ('eng','wpn','shd','siege') then raise exception 'неизвестный режим «%»', p_mode; end if;
  if u.stance <> 'off' then
    raise exception 'мощность уже направлена в этом ходу («%») — переиграть можно только следующим ходом',
      case u.stance when 'eng' then 'двигатели' when 'wpn' then 'орудия'
                    when 'siege' then 'осадный режим' else 'щит' end;
  end if;

  -- ЩИТ: платы за режим нет, в поле уходит весь остаток хода.
  if p_mode = 'shd' then
    if public._bt_terra(b.terrain, u.x, u.y) = 'neb' then
      raise exception 'в туманности защитное поле не держится';
    end if;
    sec := u.tp;
    if sec <= 0 then raise exception '«%» израсходовал ход — секунд на щит не осталось', u.unit_name; end if;
    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units
       set stance = 'shd', shield = shield + sec, tp = 0, acted = true
     where id = p_unit;
    perform public._bt_log(p_battle, format('%s уводит мощность в щит: %s c поля (гасит %s урона/с, снимает %s%%)',
      u.unit_name, round(sec,1), round(u.mitig), round(u.reduc*100)));
    return jsonb_build_object('ok', true, 'stance', 'shd', 'shield', round(u.shield + sec, 1), 'tp', 0);
  end if;

  -- ОСАДА: раскладывается только факельщик и только стоя. Плата выше обычной —
  -- разворачивание орудийной платформы съедает секунды, зато залп страшный.
  if p_mode = 'siege' then
    if not public._bt_can_siege(u.cls) then
      raise exception 'осадный режим — привилегия факельщика: «%» так не раскладывается', u.unit_name;
    end if;
    cost := public._bt_siege_cost();
    if u.tp + 1e-9 < cost then
      raise exception 'на раскладку осадной платформы нужно % c, у «%» осталось % c',
        round(cost,1), u.unit_name, round(u.tp,1);
    end if;
    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units set stance = 'siege', tp = greatest(0, tp - cost) where id = p_unit;
    perform public._bt_log(p_battle, format('%s раскладывается в осадный режим: урон ×%s, рубеж ×%s — но с места ни шагу',
      u.unit_name, public._bt_siege_dmg(), public._bt_siege_rng()));
    return jsonb_build_object('ok', true, 'stance', 'siege', 'tp', round(u.tp - cost, 1));
  end if;

  cost := public._bt_stance_cost();
  if u.tp + 1e-9 < cost then
    raise exception 'на переброс мощности нужно % c, у «%» осталось % c',
      round(cost,1), u.unit_name, round(u.tp,1);
  end if;

  perform public._bt_use_act(p_battle, p_unit);
  update public.battle_units set stance = p_mode, tp = greatest(0, tp - cost) where id = p_unit;
  perform public._bt_log(p_battle, case p_mode
    when 'eng' then format('%s форсирует двигатели: шаг дешевле на %s%%', u.unit_name, round((1-public._bt_eng_mult())*100))
    else            format('%s форсирует орудия: урон залпа ×%s', u.unit_name, public._bt_wpn_mult()) end);
  return jsonb_build_object('ok', true, 'stance', p_mode, 'tp', round(u.tp - cost, 1));
end$fn$;
revoke all on function public.battle_stance(uuid,uuid,text) from public;
grant execute on function public.battle_stance(uuid,uuid,text) to authenticated;

-- ── 8) Ход: в осаде корабль прикован ─────────────────────────
-- Живое ядро _bt_do_move пересобрано другими накатами (интердикция, цена гекса
-- по ландшафту) — переписывать его целиком нельзя, иначе снесём чужую работу.
-- Вшиваем ровно одну проверку текстовой правкой, идемпотентно.
do $patch$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = '_bt_do_move'
   order by p.oid limit 1;
  if src is null then raise notice '_bt_do_move не найдена — пропускаю'; return; end if;
  if position('осадный режим приковал' in src) > 0 then return; end if;   -- уже вшито
  if position('станция неподвижна' in src) = 0 then
    raise notice 'якорь в _bt_do_move не найден — запрет хода в осаде НЕ вшит';
    return;
  end if;
  src := replace(src,
    'if u.cls = ''ss13'' or u.speed <= 0 then raise exception ''станция неподвижна',
    'if u.stance = ''siege'' then raise exception ''осадный режим приковал «%» к месту: платформа разложена, до конца хода корабль не сдвинуть'', u.unit_name; end if;
  if u.cls = ''ss13'' or u.speed <= 0 then raise exception ''станция неподвижна');
  execute src;
end$patch$;

-- ── 9) Перепубликация ТТХ живых бортов ───────────────────────
-- _bt_stats читается лениво при развёртывании, так что старым боям ничего не
-- ломаем; новые бои поднимутся уже с opt/far/dmin.

-- ПРОВЕРКА ГЛАЗАМИ:
--  1) select public._bt_stats(id) from faction_units where data->>'class'='hyperCruiser' limit 1;
--     → в wpn у групп есть opt/far/dmin, opt=1.0 (арта не теряет урон), rng в 1.5 раза выше.
--  2) Корвет с автопушками: opt≈0.4, far=0.25 — стрельба с края кольца заметно слабее.
--  3) battle_stance(bid, факельщик, 'siege') → в журнале «раскладывается в осадный
--     режим», попытка хода тем же бортом → отказ «осадный режим приковал».
--  4) Ракетная группа с дистанции 1 → отказ «ракетам не хватает разгона».
