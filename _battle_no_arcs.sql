-- ============================================================
-- БОЙ БЕЗ РАКУРСА: ДАЛЬНОСТЬ + ОГНЕВЫЕ ГРУППЫ
-- ============================================================
-- Ракурс убран целиком. Было: сектор орудия (нос/борт/корма) решал, достанет
-- ли ствол; курс надо было доворачивать, тяжёлый корабль не мог повернуть без
-- разгона; радар светил только вперёд; попадание в корму давало ×2. Это давало
-- возню с разворотами вместо боя.
--
-- Стало — две оси решений, и обе честные:
--   • ДАЛЬНОСТЬ. Группа достаёт цель или нет. Позиция = единственный рычаг:
--     подойти, чтобы вошли короткие тяжёлые группы, или держать дистанцию,
--     где отвечают только твои дальние.
--   • ОГНЕВЫЕ ГРУППЫ. Ствол приписан к группе (ручная батарея A..F из
--     конструктора) либо автогруппируется по (дальность, канал, тир залпа).
--     Игрок решает, как связать стволы: слить тяж в рой ради объёма или
--     держать спинальную отдельной группой ради пробития.
--
-- Курс (facing) остаётся ТОЛЬКО как разворот спрайта на доске — на правила
-- он больше не влияет нигде.
--
-- Порядок: катить ПОСЛЕ _war_battle_tactics.sql и _war_battle_batteries.sql.
--   node tools/db_run.js _battle_no_arcs.sql
-- ============================================================

-- ── 1) Обнаружение: круговое ────────────────────────────────
-- Радар больше не конус. Визуал 3 гекса + радар (sensor − stealth/2, но не
-- меньше 4) во все стороны. Аргумент mfacing сохранён в сигнатуре, чтобы не
-- переписывать вызовы, и НЕ используется.
create or replace function public._bt_detected(
  mx int, my int, mfacing int, msensor int,
  tx int, ty int, tstealth int, tflash boolean)
returns boolean language plpgsql immutable as $$
declare d int; es int; radar int;
begin
  d := public._bt_dist(mx, my, tx, ty);
  if d <= 3 then return true; end if;                 -- визуальный контакт
  es := case when tflash then 0 else greatest(0, tstealth) end;
  radar := greatest(4, msensor - (es / 2)::int);
  return d <= radar;
end$$;

-- ── 2) ТТХ проекта: огневые группы вместо секторов ──────────
-- Группа = (дальность, канал, тир залпа) для автостволов, либо ручная
-- батарея игрока (буква A..F) — она бандлит помеченные стволы одного канала
-- в ОДИН залп. Позиция ствола на схеме (layout.mounts[].pos) больше не читается.
create or replace function public._bt_stats(p_unit uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare u record; sm jsonb; cls text; spd int; rng numeric; cab jsonb;
        wpn jsonb; sens int;
begin
  select * into u from public.faction_units where id = p_unit;
  if u.id is null then return null; end if;
  sm  := coalesce(u.summary, '{}'::jsonb);
  cls := nullif(u.data->>'class','');
  spd := greatest(1, least(40, round(coalesce((sm->>'speed')::numeric, 4))::int));
  if cls = 'ss13' then spd := 0; end if;   -- станция неподвижна
  cab := public._cn_catalog();

  with mounts as (
    select coalesce(m->'w'->>'g', m->>'g') as g,
           coalesce((m->'w'->>'idx')::int, (m->>'idx')::int) as idx,
           1 as q,
           nullif(m->>'battery','') as battery
      from jsonb_array_elements(coalesce(u.data->'layout'->'mounts','[]'::jsonb)) m
     where coalesce(m->'w'->>'g', m->>'g') is not null
    union all
    -- проекты без схемы (старый формат / наземка)
    select w->>'g', coalesce((w->>'idx')::int, -1),
           greatest(1, coalesce((w->>'q')::int, 1)), nullif(w->>'battery','')
      from jsonb_array_elements(coalesce(u.data->'weapons','[]'::jsonb)) w
     where u.data->'layout'->'mounts' is null
  ), shots as (
    select m.battery,
           greatest(1, least(40, round(coalesce(
             (cab->coalesce(u.category,'ship')->'weapons'->m.g->m.idx->>'dalnost')::numeric, 1))))::int as rng,
           coalesce((cab->coalesce(u.category,'ship')->'weapons'->m.g->m.idx->>'dmg')::numeric, 0) * m.q as dmg,
           -- тип урона для стойкостей брони: ballistic→kinetic
           case public._cn_wpn_kind(cab->coalesce(u.category,'ship')->'weapons'->m.g->m.idx->>'name')
             when 'missile' then 'missile' when 'energy' then 'energy' else 'kinetic' end as k,
           -- скорострельность → тир дробин 1..6 (характер залпа)
           public._bt_shots_tier((cab->coalesce(u.category,'ship')->'weapons'->m.g->m.idx->>'rof')::numeric) as tier
      from mounts m
     where cab->coalesce(u.category,'ship')->'weapons'->m.g->m.idx is not null
  ),
  -- АВТО-группа = (дальность, канал, ТИР). Тир НЕ усредняем: спинальную
  -- (тир1, тяж) и автопушки (тир6, рой) держим РАЗНЫМИ группами — иначе
  -- тяжёлый залп размылся бы в средний и потерял характер.
  g_auto as (
    select shots.rng, shots.k, shots.tier as shots, sum(shots.dmg) as sum_dmg, null::text as bat
      from shots where shots.dmg > 0 and shots.battery is null
     group by shots.rng, shots.k, shots.tier
  ),
  -- РУЧНАЯ группа игрока: один залп; дальность — по слабейшему стволу,
  -- тир — урон-взвешенный средний (разменять пробитие на объём или наоборот).
  g_man as (
    select min(shots.rng) as rng, shots.k,
           greatest(1, least(6, round(sum(shots.dmg * shots.tier) / nullif(sum(shots.dmg), 0))))::int as shots,
           sum(shots.dmg) as sum_dmg, shots.battery as bat
      from shots where shots.dmg > 0 and shots.battery is not null
     group by shots.k, shots.battery
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rng', gg.rng, 'dmg', round(gg.sum_dmg), 'k', gg.k, 'shots', gg.shots, 'bat', gg.bat)), '[]'::jsonb)
    into wpn
    from (select * from g_auto union all select * from g_man) gg;

  select coalesce(max((g->>'rng')::int), 1) into rng from jsonb_array_elements(wpn) g;
  if jsonb_array_length(wpn) = 0 then
    rng := greatest(1, least(40, coalesce((sm->>'rng')::numeric, 1)));
  end if;

  sens := greatest(6, least(30, round(coalesce(nullif((sm->>'radar')::numeric, 0), 10))::int
                                + coalesce((sm->'mods'->>'sensor')::int, 0)));

  return jsonb_build_object(
    'name',    u.name,
    'cls',     cls,
    'hp',      greatest(1, coalesce((sm->>'hp')::numeric, 100)),
    'armor',   greatest(0, coalesce((sm->>'armor')::numeric, 0)),
    'shield',  greatest(0, coalesce((sm->>'shield')::numeric, 0)),
    'dmg',     greatest(1, coalesce((sm->>'dmg')::numeric, 10)),
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
revoke all on function public._bt_stats(uuid) from public;

-- ── 3) Ход = маршрут, без инерции поворота ──────────────────
-- Любой шаг в соседний свободный гекс. Единственный лимит — скорость
-- (обломки её режут). facing проставляем по последнему шагу: спрайт смотрит
-- туда, куда летел. Столбец straight держим на 99 — правил на нём больше нет.
create or replace function public.battle_move(p_battle uuid, p_unit uuid, p_path jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; u record; e jsonb;
        cx int; cy int; nx int; ny int; f int;
        maxs int; terr text; i int; total int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_arm(p_battle);
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if u.cls = 'ss13' or u.speed <= 0 then raise exception 'станция неподвижна — она не двигается на поле боя'; end if;
  if u.moved then raise exception 'этот корабль уже ходил в этом ходу'; end if;
  total := coalesce(jsonb_array_length(p_path), 0);
  if total < 1 then raise exception 'пустой маршрут'; end if;

  maxs := u.speed;
  if public._bt_terra(b.terrain, u.x, u.y) = 'deb' then maxs := greatest(1, maxs - 1); end if;
  if total > maxs then
    raise exception '«%» проходит % гексов за ход (обломки замедляют), а маршрут — %', u.unit_name, maxs, total;
  end if;

  cx := u.x; cy := u.y; f := u.facing;
  i := 0;
  for e in select value from jsonb_array_elements(p_path) loop
    i := i + 1;
    nx := coalesce((e->>'x')::int, -1); ny := coalesce((e->>'y')::int, -1);
    if nx < 0 or nx >= public._bt_w() or ny < 0 or ny >= public._bt_h() then
      raise exception 'маршрут выходит за доску';
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
  terr := public._bt_terra(b.terrain, cx, cy);
  update public.battle_units
     set x = cx, y = cy, facing = f, straight = 99, moved = true,
         shield = case when terr = 'neb' then 0 else shield end
   where id = p_unit;
  if terr = 'neb' then
    perform public._bt_log(p_battle, format('%s входит в туманность — защитное поле схлопывается', u.unit_name));
  end if;
  return jsonb_build_object('ok', true, 'facing', f);
end$$;

-- ── 4) Выстрел: полосы дальности + огневые группы ───────────
-- Стреляют ВСЕ группы, чья дальность накрывает дистанцию. Ни секторов, ни
-- бонуса за корму. Остальное как было: захват цели, линия огня, ландшафт,
-- стойкости сплава, ПРО против ракет, порог щита на дробину.
create or replace function public.battle_fire(p_battle uuid, p_unit uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; u record; t record; dist int;
        wg jsonb; dmgfac numeric := 1;
        absorbed numeric; hull numeric; killed boolean := false;
        band_ok boolean := false;
        rk numeric; resisted numeric := 0;
        rsh numeric; shcap numeric; sh_hard numeric := 0.30; shabs numeric := 0;
        grp_shots int; per_shot numeric; gdmg numeric; absb numeric;
        total_dmg numeric := 0; hull_leak numeric := 0; i int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_arm(p_battle);
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if u.fired then raise exception 'этот корабль уже стрелял в этом ходу'; end if;
  select * into t from public.battle_units where id = p_target and battle_id = p_battle for update;
  if t.id is null or not t.alive then raise exception 'цели нет'; end if;
  if t.side = u.side then raise exception 'по своим не стреляем'; end if;

  dist := public._bt_dist(u.x, u.y, t.x, t.y);

  -- захват цели: кто-то из своих её видит (радар круговой)
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

  -- ландшафт цели: туманность схлопывает щиты и рассеивает залп, обломки прикрывают
  rsh := t.shield;
  if public._bt_terra(b.terrain, t.x, t.y) = 'neb' then rsh := 0; dmgfac := 0.7; end if;
  if public._bt_terra(b.terrain, t.x, t.y) = 'deb' then dmgfac := 0.85; end if;
  -- ПОРОГ ЩИТА: одну дробину щит гасит не более чем на shcap. Рой мелких щит
  -- держит; тяжёлая дробина пробивает порог, избыток течёт в корпус.
  shcap := greatest(1, t.max_shield * sh_hard);

  for wg in select value from jsonb_array_elements(
      case when u.wpn is null or jsonb_array_length(u.wpn) = 0
           then jsonb_build_array(jsonb_build_object('rng',u.rng,'dmg',u.dmg))
           else u.wpn end) loop
    if dist >= 1 and dist <= (wg->>'rng')::int then
      band_ok := true;
      -- стойкость брони цели к каналу этой группы (алхимия).
      -- ⚠ пол −0.75 (НЕ 0): отрицательная стойкость = уязвимость → урон растёт.
      rk := least(0.9, greatest(-0.75, coalesce(
              (t.resist->>coalesce(wg->>'k','kinetic'))::numeric, 0)));
      -- ПРО цели: сбивает долю РАКЕТНОГО урона на подлёте
      if coalesce(wg->>'k','kinetic') = 'missile' and coalesce(t.pd,0) > 0 then
        rk := 1 - (1 - rk) * (1 - least(0.6, t.pd));
      end if;
      gdmg := (wg->>'dmg')::numeric * (1 - rk) * dmgfac;
      resisted := resisted + (wg->>'dmg')::numeric * rk * dmgfac;
      -- дробим на залп: тир скорострельности = число равных дробин
      grp_shots := greatest(1, least(6, coalesce((wg->>'shots')::int, 1)));
      per_shot := gdmg / grp_shots;
      for i in 1..grp_shots loop
        absb := least(rsh, least(per_shot, shcap));
        rsh := rsh - absb;
        shabs := shabs + absb;
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
  -- выстрел выдал позицию: скрытность стрелявшего обнулена до его следующего хода
  update public.battle_units set fired = true, flash = true where id = p_unit;

  perform public._bt_log(p_battle, format('%s → %s: %s урона%s%s',
    u.unit_name, t.unit_name, round(absorbed + hull),
    case when resisted >= 1 then format(' (броня рассеяла %s)', round(resisted)) else '' end,
    case when killed then ' — цель уничтожена' else '' end));

  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'shield_absorbed', round(absorbed), 'hull', round(hull),
                            'resisted', round(resisted), 'killed', killed);
end$$;
-- права не трогаем: create or replace сохраняет существующий ACL функции

-- ── 5) Пересобрать снапшоты ТТХ у живых боёв ────────────────
-- Старые снапшоты wpn содержат ключ 's' (сектор) — без пересборки корабли
-- в уже идущих боях стреляли бы по старой раскладке групп.
update public.battle_units bu
   set wpn = coalesce(public._bt_stats(bu.unit_id)->'wpn', bu.wpn),
       straight = 99
 where bu.unit_id is not null
   and exists (select 1 from public.battles b
                where b.id = bu.battle_id and b.status in ('forming','active'));
