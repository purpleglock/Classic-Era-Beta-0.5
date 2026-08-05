-- ============================================================
-- РЕЖИМЫ ХОДА (распределение мощности) + ФИКС КОНЦА ХОДА
-- Применять ПОСЛЕ _bt_timepool.sql. Идемпотентно. ?v=20260805stance
--
-- ЧТО БЫЛО НЕ ТАК
--  1) Колесо предлагало «Манёвр / Залп / Щит», но манёвр и залп НИЧЕГО не
--     давали: ходить и стрелять и так можно кликом по доске. Это было меню,
--     а не механика. В оригинале мощность НАПРАВЛЯЮТ, и направление даёт бонус.
--  2) Конец хода: живое ядро — _bt_do_end_turn (через него ходят бот и
--     просроченный ход), а секунды сбрасывала только моя обёртка
--     battle_end_turn. Итог: после хода бота секунды не восстанавливались.
--
-- ЧТО СТАЛО
--  Режим выбирается ОДИН раз за ход и стоит 1.0 c. Он не заменяет действия —
--  он меняет их правила до конца хода:
--    ⚙ eng «Форсаж двигателей» — шаг вдвое дешевле: корабль реально проходит
--       БОЛЬШЕ гексов, чем обычно (корвет 10 → 16, дредноут 3 → 5).
--    ⚔ wpn «Форсаж орудий»     — урон залпа ×1.3 и перезарядка на 20% быстрее.
--    🛡 shd «Щит»              — весь остаток секунд уходит в поле.
--  Платить дважды нельзя: режим на ход один, смена запрещена — в этом и выбор.
--
--  ЩИТ, чтобы снять путаницу: поднятый щит держится ВЕСЬ ХОД ПРОТИВНИКА и
--  опускается только в начале ВАШЕГО следующего хода. Он для того и нужен —
--  пережить чужой залп. Он НЕ падает по кнопке «завершить ход».
-- ============================================================

-- ── 1) Схема ────────────────────────────────────────────────
alter table public.battle_units add column if not exists stance text not null default 'off';

-- Цена включения режима и сами множители — одним местом, чтобы крутить баланс.
create or replace function public._bt_stance_cost() returns numeric language sql immutable as $$ select 1.0 $$;
create or replace function public._bt_eng_mult()    returns numeric language sql immutable as $$ select 0.5 $$;  -- шаг вдвое дешевле → дальше ход
create or replace function public._bt_wpn_mult()    returns numeric language sql immutable as $$ select 1.3 $$;  -- урон залпа
-- Форсаж орудий даёт ещё и скорость перезарядки. Без этого режим был ЛОВУШКОЙ
-- для эсминца: 1.0 c платы съедали его второй залп, и «бонус» выходил слабее
-- обычной стрельбы (1 залп ×1.3 против двух обычных). Теперь не проигрывает никто.
create or replace function public._bt_wpn_cost()    returns numeric language sql immutable as $$ select 0.8 $$;

-- ── 2) Включение режима ─────────────────────────────────────
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
  if p_mode not in ('eng','wpn','shd') then raise exception 'неизвестный режим «%»', p_mode; end if;
  if u.stance <> 'off' then
    raise exception 'мощность уже направлена в этом ходу («%») — переиграть можно только следующим ходом',
      case u.stance when 'eng' then 'двигатели' when 'wpn' then 'орудия' else 'щит' end;
  end if;

  -- ЩИТ: платы за режим нет, в поле уходит весь остаток хода. Держится до
  -- начала СВОЕГО следующего хода, то есть прикрывает ровно ход противника.
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

-- Старый battle_shield оставляем как синоним щита: клиенты, знающие его, не ломаются.
create or replace function public.battle_shield(p_battle uuid, p_unit uuid, p_sec numeric default null)
returns jsonb language plpgsql security definer set search_path=public as $fn$
begin
  return public.battle_stance(p_battle, p_unit, 'shd');
end$fn$;
grant execute on function public.battle_shield(uuid,uuid,numeric) to authenticated;

-- ── 3) ХОД: форсаж двигателей даёт БОЛЬШЕ гексов ────────────
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

  cost := public._bt_step_cost(u.speed);
  if u.stance = 'eng' then cost := cost * public._bt_eng_mult(); end if;   -- ФОРСАЖ: дальше за те же секунды
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
    f := public._bt_dirof(cx, cy, nx, ny);
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

-- ── 4) ЗАЛП: форсаж орудий даёт БОЛЬШЕ урона ────────────────
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
        fcost numeric; boost numeric := 1;
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
  if u.stance = 'wpn' then boost := public._bt_wpn_mult(); end if;   -- ФОРСАЖ ОРУДИЙ

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
    if coalesce(wg->>'k','kinetic') <> 'repair'
       and dist >= 1 and dist <= (wg->>'rng')::int then
      band_ok := true;
      rk := least(0.9, greatest(-0.75, coalesce(
              (t.resist->>coalesce(wg->>'k','kinetic'))::numeric, 0)));
      if coalesce(wg->>'k','kinetic') = 'missile' and coalesce(t.pd,0) > 0 then
        rk := 1 - (1 - rk) * (1 - least(0.6, t.pd));
      end if;
      gdmg     := (wg->>'dmg')::numeric * boost * (1 - rk) * dmgfac;
      resisted := resisted + (wg->>'dmg')::numeric * boost * rk * dmgfac;
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

  perform public._bt_log(p_battle, format('%s → %s: %s урона%s%s%s',
    u.unit_name, t.unit_name, round(absorbed + hull),
    case when boost > 1 then ' (форсаж орудий)' else '' end,
    case when resisted >= 1 then format(' (броня рассеяла %s)', round(resisted)) else '' end,
    case when killed then ' — цель уничтожена' else '' end));

  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'shield_absorbed', round(absorbed), 'hull', round(hull),
                            'resisted', round(resisted), 'killed', killed, 'healed', 0,
                            'tp', round(u.tp - fcost, 1), 'target_shield', round(rsh, 1));
end$fn$;
revoke all on function public._bt_do_fire(uuid,uuid,uuid,text) from public;

-- ── 5) КОНЕЦ ХОДА: сброс секунд ЖИВЁТ В ЯДРЕ ────────────────
-- Ядро _bt_do_end_turn — общий путь для игрока, бота и просроченного хода.
-- Пока сброс висел в обёртке battle_end_turn, после хода бота секунды не
-- восстанавливались вовсе. Возвращаем канон: ядро делает, обёртки только зовут.
create or replace function public._bt_tp_refresh(p_battle uuid, p_side text)
returns void language plpgsql security definer set search_path=public as $fn$
begin
  update public.battle_units
     set moved = false, fired = false, acted = false, flash = false,
         tp = tp_max,        -- свежие секунды
         shield = 0,         -- поле опускается: корабль снова начинает действовать
         stance = 'off'      -- мощность распределяется заново
   where battle_id = p_battle and side = p_side;
end$fn$;
revoke all on function public._bt_tp_refresh(uuid,text) from public;

create or replace function public._bt_do_end_turn(p_battle uuid, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b public.battles; sd text; nxt text;
begin
  perform public._bt_arm(p_battle);
  me := p_fid;
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
end$fn$;
revoke all on function public._bt_do_end_turn(uuid,text) from public;

-- Обёртка снова ТОНКАЯ: логика одна на всех, боты не могут ходить мимо правил.
create or replace function public.battle_end_turn(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $fn$
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  return public._bt_do_end_turn(p_battle, public._ec_my_fid());
end$fn$;
revoke all on function public.battle_end_turn(uuid) from public;
grant execute on function public.battle_end_turn(uuid) to authenticated;

-- ── 6) Состояние: отдать режим клиенту ──────────────────────
-- Точечно: сама battle_state собрана в _bt_timepool.sql, здесь только
-- добавляем поле stance, чтобы колесо знало, куда уже направлена мощность.
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'battle_state';
  if src is null then raise exception 'battle_state не найдена'; end if;
  if position('''stance'', u.stance' in src) > 0 then return; end if;   -- уже есть
  src := replace(src, '''tp'', round(u.tp, 1),', '''stance'', u.stance, ''tp'', round(u.tp, 1),');
  execute src;
end$$;

-- ============================================================
-- ПРОВЕРКА
--  1) battle_stance(bid, uid, 'eng') → в ответе stance='eng', tp меньше на 1.5.
--     Дальше маршрут длиннее обычного: корвет 10 гекс → 16 за оставшиеся секунды.
--  2) battle_stance(..., 'wpn') → в журнале у залпа приписка «(форсаж орудий)»,
--     урон в 1.3 раза выше того же залпа без режима.
--  3) Повторный battle_stance в том же ходу → отказ «мощность уже направлена».
--  4) Ход бота → у своей стороны tp снова = tp_max, stance='off'.
--  5) Щит: поднять, завершить ход, дать врагу выстрелить — урон срезан,
--     а поле опускается только в начале СВОЕГО следующего хода.
-- ============================================================
