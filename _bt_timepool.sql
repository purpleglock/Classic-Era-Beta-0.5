-- ============================================================
-- ПУЛ ВРЕМЕНИ: ход корабля = 6 секунд, трать как хочешь
-- Применять ПОСЛЕ _war_battle_tactics.sql (и после _battle_pool_wpn.sql).
-- Идемпотентно. ?v=20260805timepool
--
-- ЧТО МЕНЯЕТСЯ ПО СУТИ
--  Было: три булева флага — moved / fired / acted. Один шаг маршрута и один
--  залп за ход, жёстко. Щит — отдельный запас (max_shield) с порогом на дробину
--  (sh_hard 0.30), который изображал «щит держит рой, но течёт от тяжёлых».
--
--  Стало: у каждого корабля пул ВРЕМЕНИ (tp, секунды). Действия стоят секунды:
--    • шаг по гексу   = tp_max / speed  — быстрый шагает дёшево (это и есть манёвр);
--    • залп           = tp_max × k(cls) — корвет успевает два, дредноут едва один;
--    • секунда щита   = 1 секунда       — вкладываешь остаток хода в защиту.
--  Щит больше НЕ запас урона, а ВРЕМЯ: держится ровно столько секунд, сколько
--  в него вложили на своём ходу, и опускается в начале следующего своего хода.
--  Пока держится — гасит `mitig` урона в секунду и пропускает (1 − reduc).
--  Отсюда роли классов (числа — §2):
--    • корвет — reduc 1.00 (блок), но дорогой по mitig: гасит всё и мгновенно выгорает;
--    • дредноут — reduc 0.65, зато mitig огромен: течёт, но терпит весь ход.
--
--  Активации стороны (_bt_acts = 6 кораблей за ход) НЕ трогаем: пул времени —
--  бюджет ОДНОГО корабля, acts_left — бюджет стороны. Это разные ручки.
--
--  Совместимость: колонки moved/fired/acted оставлены и по-прежнему пишутся —
--  на них завязаны подсветка в клиенте, flash (демаскировка выстрелом) и бот.
--  Гейтом они больше не служат: запрещает только нехватка секунд.
-- ============================================================

-- ── 1) Схема ────────────────────────────────────────────────
alter table public.battle_units add column if not exists tp     numeric not null default 6;   -- осталось секунд в ходу
alter table public.battle_units add column if not exists tp_max numeric not null default 6;   -- размер пула
alter table public.battle_units add column if not exists mitig  numeric not null default 500; -- урона, гасимого одной секундой щита
alter table public.battle_units add column if not exists reduc  numeric not null default 0.8; -- доля урона, снимаемая щитом (0..1)

-- ── 2) Константы и стоимости ────────────────────────────────
-- Пул хода. Единственная ручка «насколько тесен ход»: больше — мягче бой.
create or replace function public._bt_tp_max() returns numeric language sql immutable as $$ select 6.0 $$;

-- Шаг по гексу. Тот, кто раньше проходил N гексов за ход, проходит их и сейчас,
-- если не тратится ни на что другое — прежний баланс движения сохранён точь-в-точь.
create or replace function public._bt_step_cost(p_speed int)
returns numeric language sql immutable as $$
  select public._bt_tp_max() / greatest(1, coalesce(p_speed, 1));
$$;

-- Залп. Доля пула по классу: лёгкие скорострельны, тяжёлые перезаряжаются долго.
-- 0.35 → два залпа и остаток на манёвр; 0.75 → один залп и почти ничего больше.
create or replace function public._bt_fire_cost(cls text)
returns numeric language sql immutable as $$
  select public._bt_tp_max() * coalesce((jsonb_build_object(
    'wing',0.30,'corvette',0.35,'frigate',0.40,
    'destroyer',0.50,
    'mediumCruiser',0.55,'cruiser',0.55,'supportCarrier',0.55,
    'multiroleCarrier',0.60,'battleship',0.65,
    'hyperCruiser',0.75,'ss13',0.55,
    'dreadnought',0.70)->>cls)::numeric, 0.55);
$$;

-- Щит класса: {mitig, reduc}. reduc — та самая «Shield Dmg Absorption»,
-- mitig — «сколько урона стоит одна секунда щита» (наша шкала урона, не чужая).
-- Корвет: блок — снимает 100%, но одна секунда покрывает мало.
-- Дредноут: почти не тратится (mitig велик), но пропускает 35% — держит весь ход.
create or replace function public._bt_shield_spec(cls text)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_build_object(
    'wing',              jsonb_build_object('m', 220,  'r', 1.00),
    'corvette',          jsonb_build_object('m', 300,  'r', 1.00),
    'frigate',           jsonb_build_object('m', 380,  'r', 0.90),
    'destroyer',         jsonb_build_object('m', 500,  'r', 0.75),
    'cruiser',           jsonb_build_object('m', 520,  'r', 0.85),
    'mediumCruiser',     jsonb_build_object('m', 520,  'r', 0.85),
    'supportCarrier',    jsonb_build_object('m', 520,  'r', 0.85),
    'multiroleCarrier',  jsonb_build_object('m', 560,  'r', 0.80),
    'hyperCruiser',      jsonb_build_object('m', 560,  'r', 0.80),
    'battleship',        jsonb_build_object('m', 800,  'r', 0.70),
    'ss13',              jsonb_build_object('m', 900,  'r', 0.75),
    'dreadnought',       jsonb_build_object('m', 1400, 'r', 0.65)
  )->cls, jsonb_build_object('m', 500, 'r', 0.80));
$$;

-- ── 3) Заполнение при постановке борта на доску ─────────────
-- Триггером, а не правкой трёх мест вставки (deploy / reinforce / авиакрыло):
-- любой новый борт получает пул и щит своего класса, что бы ни прислал вызывающий.
-- Заодно гасит легаси-значение shield из summary: щит теперь ВРЕМЯ, а не запас урона.
create or replace function public._bt_tp_fill()
returns trigger language plpgsql as $$
declare sp jsonb;
begin
  sp := public._bt_shield_spec(new.cls);
  new.tp_max     := public._bt_tp_max();
  new.tp         := new.tp_max;
  new.mitig      := (sp->>'m')::numeric;
  new.reduc      := (sp->>'r')::numeric;
  new.shield     := 0;            -- секунд щита поднято: на своём ходу ещё не решали
  new.max_shield := 0;            -- легаси-ёмкость больше не участвует в расчёте
  return new;
end$$;
drop trigger if exists trg_bt_tp_fill on public.battle_units;
create trigger trg_bt_tp_fill before insert on public.battle_units
  for each row execute function public._bt_tp_fill();

-- Догнать уже стоящие на доске бои (идущие партии не ломаем).
update public.battle_units u
   set tp_max = public._bt_tp_max(),
       tp     = public._bt_tp_max(),
       mitig  = (public._bt_shield_spec(u.cls)->>'m')::numeric,
       reduc  = (public._bt_shield_spec(u.cls)->>'r')::numeric,
       shield = 0, max_shield = 0
 where u.tp_max is distinct from public._bt_tp_max() or u.mitig is null;

-- ── 4) ЯДРО ХОДА: маршрут, оплаченный секундами ─────────────
-- Правим ИМЕННО ядро _bt_do_move, а не обёртку battle_move: ядро общее с ботом,
-- значит бот считает секунды по тем же правилам, что и игрок, без отдельной ветки.
-- Основа — живая версия из _bot_ai_rules.sql (арена-форма, без инерции поворота).
create or replace function public._bt_do_move(p_battle uuid, p_unit uuid, p_path jsonb, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b public.battles; u record; e jsonb;
        cx int; cy int; nx int; ny int; f int;
        maxs int; terr text; i int; total int; cost numeric; spend numeric;
begin
  perform public._bt_arm(p_battle);
  me := p_fid;
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if u.cls = 'ss13' or u.speed <= 0 then raise exception 'станция неподвижна — она не двигается на поле боя'; end if;
  total := coalesce(jsonb_array_length(p_path), 0);
  if total < 1 then raise exception 'пустой маршрут'; end if;

  -- ЦЕНА ШАГА. Кто раньше проходил N гексов за ход, пройдёт их и теперь, если
  -- не потратится ни на что другое: прежний баланс движения сохранён точь-в-точь.
  cost := public._bt_step_cost(u.speed);
  if public._bt_terra(b.terrain, u.x, u.y) = 'deb' then cost := cost * 1.5; end if;
  maxs := floor((u.tp + 1e-9) / cost)::int;
  if maxs < 1 then
    raise exception '«%» израсходовал ход: осталось % c, а шаг стоит % c',
      u.unit_name, round(u.tp, 1), round(cost, 1);
  end if;
  if total > maxs then
    raise exception '«%» пройдёт % гекс(ов) за оставшиеся % c (шаг — % c), а маршрут — %',
      u.unit_name, maxs, round(u.tp, 1), round(cost, 1), total;
  end if;

  cx := u.x; cy := u.y; f := u.facing;
  i := 0;
  for e in select value from jsonb_array_elements(p_path) loop
    i := i + 1;
    nx := coalesce((e->>'x')::int, -1); ny := coalesce((e->>'y')::int, -1);
    if nx < 0 or nx >= public._bt_w() or ny < 0 or ny >= public._bt_h() then
      raise exception 'маршрут выходит за доску';
    end if;
    if not public._bt_in_arena(b.shape, nx, ny) then
      raise exception 'маршрут уходит в пустоту за кромкой арены';
    end if;
    if public._bt_dist(cx, cy, nx, ny) <> 1 then raise exception 'маршрут разорван — шаг только в соседний гекс'; end if;
    if exists(select 1 from public.battle_units
               where battle_id = p_battle and alive and x = nx and y = ny) then
      raise exception 'гекс %:% занят — сквозь корабли не летают', nx, ny;
    end if;
    f := public._bt_dirof(cx, cy, nx, ny);   -- только разворот спрайта
    cx := nx; cy := ny;
  end loop;

  perform public._bt_use_act(p_battle, p_unit);
  spend := cost * total;
  terr := public._bt_terra(b.terrain, cx, cy);
  update public.battle_units
     set x = cx, y = cy, facing = f, straight = 99, moved = true,
         tp = greatest(0, tp - spend),
         shield = 0        -- манёвр роняет поле: идти и держать щит одновременно нельзя
   where id = p_unit;
  if terr = 'neb' then
    perform public._bt_log(p_battle, format('%s входит в туманность — защитное поле схлопывается', u.unit_name));
  end if;
  return jsonb_build_object('ok', true, 'facing', f, 'tp', round(u.tp - spend, 1));
end$fn$;
revoke all on function public._bt_do_move(uuid, uuid, jsonb, text) from public;

-- ── 5) ЯДРО ЗАЛПА: секунды на выстрел + щит как ВРЕМЯ ───────
-- Основа — живая версия из _bot_ai_rules.sql: ветка нано-ремонта на месте,
-- ракурсов/секторов обстрела нет (их сняли в _battle_no_arcs.sql).
-- Изменено ровно два места: гейт по секундам вместо флага fired и поглощение щитом.
create or replace function public._bt_do_fire(p_battle uuid, p_unit uuid, p_target uuid, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b public.battles; u record; t record; dist int;
        wg jsonb; dmgfac numeric := 1;
        absorbed numeric; hull numeric; killed boolean := false;
        band_ok boolean := false;
        rk numeric; resisted numeric := 0;
        rsh numeric; shabs numeric := 0;
        grp_shots int; per_shot numeric; gdmg numeric; absb numeric;
        use_sec numeric; covered numeric;
        total_dmg numeric := 0; hull_leak numeric := 0; i int;
        ally boolean; heal_sum numeric := 0; healed numeric := 0;
        fcost numeric;
begin
  perform public._bt_arm(p_battle);
  me := p_fid;
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;

  -- ГЕЙТ ПО ВРЕМЕНИ вместо «уже стрелял»: залп забирает свою долю пула,
  -- поэтому корвет успевает два, а дредноут не успевает и один после манёвра.
  fcost := public._bt_fire_cost(u.cls);
  if u.tp + 1e-9 < fcost then
    raise exception '«%» не успевает дать залп: нужно % c, осталось % c',
      u.unit_name, round(fcost, 1), round(u.tp, 1);
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

  -- ЩИТ ЦЕЛИ = ОСТАТОК СЕКУНД, поднятых ею на своём ходу (а не запас урона).
  rsh := greatest(0, coalesce(t.shield, 0));
  if public._bt_terra(b.terrain, t.x, t.y) = 'neb' then rsh := 0; dmgfac := 0.7; end if;
  if public._bt_terra(b.terrain, t.x, t.y) = 'deb' then dmgfac := 0.85; end if;

  for wg in select value from jsonb_array_elements(
      case when u.wpn is null or jsonb_array_length(u.wpn) = 0
           then jsonb_build_array(jsonb_build_object('rng',u.rng,'dmg',u.dmg))
           else u.wpn end) loop
    if coalesce(wg->>'k','kinetic') <> 'repair'
       and dist >= 1 and dist <= (wg->>'rng')::int then
      band_ok := true;
      rk := least(0.9, greatest(-0.75, coalesce(
              (t.resist->>coalesce(wg->>'k','kinetic'))::numeric, 0)));
      if coalesce(wg->>'k','kinetic') = 'missile' and coalesce(t.pd,0) > 0 then
        rk := 1 - (1 - rk) * (1 - least(0.6, t.pd));
      end if;
      gdmg := (wg->>'dmg')::numeric * (1 - rk) * dmgfac;
      resisted := resisted + (wg->>'dmg')::numeric * rk * dmgfac;
      grp_shots := greatest(1, least(6, coalesce((wg->>'shots')::int, 1)));
      per_shot := gdmg / grp_shots;
      for i in 1..grp_shots loop
        -- ЩИТ ТРАТИТ ВРЕМЯ: дробина в per_shot урона просит per_shot/mitig секунд.
        -- Секунд не хватило — поле накрывает лишь оплаченную часть, остальное в корпус.
        -- Накрытое умножается на reduc: у корвета (1.00) не проходит ничего,
        -- у дредноута (0.65) треть течёт сквозь поле даже при поднятом щите.
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
  end loop;
  if not band_ok then
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

  perform public._bt_log(p_battle, format('%s → %s: %s урона%s%s',
    u.unit_name, t.unit_name, round(absorbed + hull),
    case when resisted >= 1 then format(' (броня рассеяла %s)', round(resisted)) else '' end,
    case when killed then ' — цель уничтожена' else '' end));

  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'shield_absorbed', round(absorbed), 'hull', round(hull),
                            'resisted', round(resisted), 'killed', killed, 'healed', 0,
                            'tp', round(u.tp - fcost, 1), 'target_shield', round(rsh, 1));
end$fn$;
revoke all on function public._bt_do_fire(uuid,uuid,uuid,text) from public;



-- ── 5б) Обёртки игрока: тонкие, зовут то же ядро, что и бот ──
-- Восстанавливаем канонический вид из _bot_ai_rules.sql: вся логика — в ядре,
-- обёртка только проверяет бан и подставляет fid вызывающего.
create or replace function public.battle_move(p_battle uuid, p_unit uuid, p_path jsonb)
returns jsonb language plpgsql security definer set search_path=public as $fn$
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  return public._bt_do_move(p_battle, p_unit, p_path, public._ec_my_fid());
end$fn$;
revoke all on function public.battle_move(uuid,uuid,jsonb) from public;
grant execute on function public.battle_move(uuid,uuid,jsonb) to authenticated;

create or replace function public.battle_fire(p_battle uuid, p_unit uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path=public as $fn$
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  return public._bt_do_fire(p_battle, p_unit, p_target, public._ec_my_fid());
end$fn$;
revoke all on function public.battle_fire(uuid,uuid,uuid) from public;
grant execute on function public.battle_fire(uuid,uuid,uuid) to authenticated;

-- ── 6) Поднять щит: вложить секунды остатка хода ────────────
-- p_sec = null → вложить весь остаток. Щит держится до начала своего следующего
-- хода, то есть прикрывает ровно ход противника — за это и платим временем.
create or replace function public.battle_shield(p_battle uuid, p_unit uuid, p_sec numeric default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; u record; sec numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_arm(p_battle);
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if public._bt_terra(b.terrain, u.x, u.y) = 'neb' then
    raise exception 'в туманности защитное поле не держится';
  end if;

  sec := coalesce(p_sec, u.tp);
  sec := least(sec, u.tp);
  if sec <= 0 then
    raise exception '«%» уже израсходовал ход — секунд на щит не осталось', u.unit_name;
  end if;

  perform public._bt_use_act(p_battle, p_unit);
  update public.battle_units
     set shield = shield + sec, tp = greatest(0, tp - sec), acted = true
   where id = p_unit;
  perform public._bt_log(p_battle, format('%s поднимает щит на %s c (гасит %s урона/с, снимает %s%%)',
    u.unit_name, round(sec, 1), round(u.mitig), round(u.reduc * 100)));
  return jsonb_build_object('ok', true, 'shield', round(u.shield + sec, 1), 'tp', round(u.tp - sec, 1));
end$$;
grant execute on function public.battle_shield(uuid,uuid,numeric) to authenticated;

-- ── 7) Смена хода: новой стороне свежий пул, щит опускается ──
create or replace function public._bt_tp_refresh(p_battle uuid, p_side text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.battle_units
     set moved = false, fired = false, acted = false, flash = false,
         tp = tp_max, shield = 0        -- поле опускается: корабль снова действует
   where battle_id = p_battle and side = p_side;
end$$;
revoke all on function public._bt_tp_refresh(uuid,text) from public;

create or replace function public.battle_end_turn(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; sd text; nxt text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_arm(p_battle);
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  sd := b.side_to_move;

  if sd = 'attacker' then
    update public.battles set att_turns_left = greatest(0, att_turns_left - 1) where id = p_battle;
  else
    update public.battles set def_turns_left = greatest(0, def_turns_left - 1) where id = p_battle;
  end if;

  perform public._bt_env_end(p_battle, sd);

  nxt := case when sd = 'attacker' then 'defender' else 'attacker' end;
  perform public._bt_tp_refresh(p_battle, nxt);
  update public.battles
     set side_to_move = nxt, turn_no = turn_no + 1, acts_left = public._bt_acts(),
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;

  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true);
end$$;

create or replace function public.battle_force_turn(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b record; sd text; nxt text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle for update;
  if b.id is null then raise exception 'no such battle'; end if;
  if b.status <> 'active' then raise exception 'бой не идёт'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;
  if b.side_to_move = sd then raise exception 'это ваш собственный ход'; end if;
  if b.deadline_at is null or b.deadline_at > now() then
    raise exception 'срок хода противника ещё не вышел';
  end if;

  if b.side_to_move = 'attacker' then
    update public.battles set att_turns_left = greatest(0, att_turns_left - 1) where id = p_battle;
  else
    update public.battles set def_turns_left = greatest(0, def_turns_left - 1) where id = p_battle;
  end if;
  perform public._bt_env_end(p_battle, b.side_to_move);
  nxt := case when b.side_to_move = 'attacker' then 'defender' else 'attacker' end;
  perform public._bt_tp_refresh(p_battle, nxt);
  update public.battles
     set side_to_move = nxt, turn_no = turn_no + 1, acts_left = public._bt_acts(),
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;
  perform public._bt_log(p_battle, 'Сторона не явилась к сроку — ход сгорел.');
  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true);
end$$;

-- ── 8) Состояние: отдать клиенту секунды и паспорт щита ─────
-- Основа — живая версия из _bt_arena_apply.sql (форма арены, спавн, бюджет дуэли,
-- fid/fname борта, ленивая генерация поля). Добавлены только поля пула времени.
create or replace function public.battle_state(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b record; sd text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;

  -- форма → сектора → ландшафт: генерится лениво один раз, сид = id боя
  perform public._bt_ensure_field(p_battle);
  select * into b from public.battles where id = p_battle;

  return jsonb_build_object(
    'id', b.id, 'status', b.status, 'kind', b.kind,
    'system_id', b.system_id,
    'system_name', (select coalesce(nullif(ms.name,''), ms.id) from public.map_systems ms where ms.id = b.system_id),
    'w', public._bt_w(), 'h', public._bt_h(), 'cap', public._bt_cap(),
    'duel_budget', b.duel_budget,
    'zone', public._bt_zone(), 'acts_max', public._bt_acts(), 'acts_left', b.acts_left,
    'tp_max', public._bt_tp_max(),
    'shape', b.shape, 'spawn', b.spawn,
    'my_side', sd, 'my_fid', me,
    'attacker', b.attacker_fid, 'attacker_name', public._war_nm(b.attacker_fid),
    'defender', b.defender_fid, 'defender_name', public._war_nm(b.defender_fid),
    'side_to_move', b.side_to_move, 'my_turn', (b.side_to_move = sd),
    'turn_no', b.turn_no,
    'att_turns_left', b.att_turns_left, 'def_turns_left', b.def_turns_left,
    'att_ready', b.att_ready, 'def_ready', b.def_ready,
    'deadline_at', b.deadline_at,
    'can_force', (b.status='active' and b.side_to_move is distinct from sd
                  and b.deadline_at is not null and b.deadline_at <= now()),
    'winner', b.winner_fid,
    'interdicted', public._bt_interdicted(p_battle, sd),
    'log', b.log,
    'terrain', coalesce(b.terrain, '[]'::jsonb),
    'pool', public.battle_pool(p_battle, me),
    'units', (select coalesce(jsonb_agg(
        case when u.side = sd or lk.locked then
          jsonb_build_object(
            'id', u.id, 'side', u.side, 'mine', (u.fid = me),
            'fid', u.fid, 'fname', public._war_nm(u.fid),
            'name', u.unit_name, 'cls', u.cls,
            'x', u.x, 'y', u.y, 'facing', u.facing, 'straight', u.straight,
            'hp', round(u.hp), 'max_hp', round(u.max_hp),
            -- ЩИТ = СЕКУНДЫ. mitig/reduc — паспорт поля, клиент рисует по ним подсказку
            'shield', round(u.shield, 1), 'mitig', round(u.mitig), 'reduc', u.reduc,
            'tp', round(u.tp, 1), 'tp_max', round(u.tp_max, 1),
            'step_cost', round(public._bt_step_cost(u.speed), 2),
            'fire_cost', round(public._bt_fire_cost(u.cls), 2),
            'armor', round(u.armor), 'dmg', round(u.dmg),
            'speed', u.speed, 'rng', u.rng,
            'sensor', u.sensor, 'stealth', u.stealth, 'flash', u.flash,
            'pd', u.pd, 'jam', u.jam, 'wings', u.wings, 'is_wing', u.is_wing,
            'dejam', u.dejam, 'eccm', u.eccm, 'interdict', u.interdict, 'stabil', u.stabil,
            'ftl', u.ftl,
            'locked', true,
            'wpn', case when u.side = sd then coalesce(u.wpn, '[]'::jsonb) else null end,
            'resist', u.resist,
            'moved', u.moved, 'fired', u.fired, 'acted', u.acted)
        else
          jsonb_build_object(
            'id', u.id, 'side', u.side, 'mine', false, 'contact', true,
            'locked', false, 'x', u.x, 'y', u.y)
        end order by u.created_at), '[]'::jsonb)
      from public.battle_units u
      cross join lateral (select exists(
          select 1 from public.battle_units m
           where m.battle_id = p_battle and m.side = sd and m.alive
             and public._bt_detected(m.x, m.y, m.facing,
                                     greatest(0, m.sensor - greatest(0, public._bt_ecm(p_battle, m.side, m.x, m.y) - m.eccm)),
                                     u.x, u.y, u.stealth, u.flash)) as locked) lk
      where u.battle_id = p_battle and u.alive));
end$fn$;
revoke all on function public.battle_state(uuid) from public;
grant execute on function public.battle_state(uuid) to authenticated;

-- ============================================================
-- ПРОВЕРКА
--  1) battle_state → у своих units есть tp/tp_max/step_cost/fire_cost, shield в СЕКУНДАХ.
--  2) Корвет (speed 10, шаг 0.6 c, залп 2.1 c): маршрут 4 гекса (2.4 c) + залп (2.1 c)
--     проходит, остаток 1.5 c → battle_shield берёт их. Второй залп → отказ по секундам.
--  3) Дредноут (залп 4.2 c): залп + маршрут длиннее 3 гексов → отказ «не успевает».
--  4) battle_move после поднятого щита → щит обнуляется (идти и держать поле нельзя).
--  5) Залп по цели с 3 c щита: в журнале урон меньше, target_shield в ответе убыл.
--  6) Конец хода → у новой стороны tp = tp_max, shield = 0.
--  7) Туманность: battle_shield → отказ; влёт в туманность роняет щит (как было).
-- ============================================================
