-- © 2025–2026. Все права защищены.
-- ════════════════════════════════════════════════════════════
-- АКТИВНЫЕ МОДУЛИ В БОЮ  (второй слой проекции Dreadnought)
-- ════════════════════════════════════════════════════════════
-- ЦЕПОЧКА: ПОСЛЕ _unit_catalog.sql (перегенерён — в нём 7 новых модулей),
--          _bt_weapon_model.sql и _bt_siege_hold.sql. Идемпотентно.
--
-- ИДЕЯ. До сих пор боевые модули были ПАССИВНЫМИ: поставил — оно само работает
-- (pd/jam/stealth/hangar). В источнике (wiki/Modules) модуль — это КНОПКА с
-- кулдауном: Tempest Missiles, Plasma Broadside, Blink Warp, Cloak, Beam
-- Amplifier, Repair Drones, Siege Mode. Переносим именно это.
--
-- ⚠ Осадный режим переехал сюда из класса. В _bt_weapon_model.sql он был
--   привилегией hyperCruiser «по паспорту» — это неправильно: теперь это
--   модуль «Осадная платформа «Кряж»», который надо поставить на палубу и
--   заплатить за него энергией, слотом и деньгами. Класс больше ни при чём.
--
-- ЧЕГО СОЗНАТЕЛЬНО НЕТ: слотов Primary/Secondary/Perimeter/Internal из вики.
-- У нас модули ставятся свободно, в пределах потолка слотов (_cn_mod_slots).
-- Ввести 4 исключительных слота = переломать все живые проекты разом.
-- ════════════════════════════════════════════════════════════

-- ── 1) Состояние борта ───────────────────────────────────────
alter table public.battle_units add column if not exists acts  jsonb   not null default '[]'::jsonb;
alter table public.battle_units add column if not exists mcd   jsonb   not null default '{}'::jsonb;
alter table public.battle_units add column if not exists amp   numeric not null default 0;
alter table public.battle_units add column if not exists cloak int     not null default 0;

comment on column public.battle_units.acts is 'активные модули борта: [{k,cd,dmg,rng,val}]';
comment on column public.battle_units.mcd  is 'кулдауны активаций: {ключ: сколько ХОДОВ ещё ждать}';
comment on column public.battle_units.amp  is 'прибавка к урону залпа от «Ярости», гаснет с началом своего хода';
comment on column public.battle_units.cloak is 'сколько скрытности добавила «Вуаль» (чтобы ровно столько же снять)';

-- ── 2) Справочник активаций ──────────────────────────────────
-- Цена в секундах хода. Один источник правды и для сервера, и для подсказок.
create or replace function public._bt_act_cost(k text) returns numeric
language sql immutable as $$
  select coalesce((jsonb_build_object(
    'siege', 2.0, 'salvo', 2.0, 'broadside', 2.5,
    'blink', 0.0,            -- прыжок не тратит секунды: платой служит кулдаун
    'cloak', 1.0, 'amp', 1.0, 'drones', 1.5)->>k)::numeric, 1.0);
$$;

create or replace function public._bt_act_name(k text) returns text
language sql immutable as $$
  select coalesce((jsonb_build_object(
    'siege','осадная платформа','salvo','ракетный залп','broadside','бортовой залп',
    'blink','прыжок','cloak','маскировка','amp','усилитель контура',
    'drones','ремонтные дроны')->>k), k);
$$;

-- Есть ли у борта такой модуль (и его ТТХ). null — нет.
create or replace function public._bt_act(p_acts jsonb, p_key text) returns jsonb
language sql immutable as $$
  select a from jsonb_array_elements(coalesce(p_acts,'[]'::jsonb)) a
   where a->>'k' = p_key limit 1;
$$;

-- ── 3) Сбор активаций проекта из установленных модулей ───────
create or replace function public._bt_acts_of(p_unit uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare u record; cab jsonb; res jsonb;
begin
  select * into u from public.faction_units where id = p_unit;
  if u.id is null then return '[]'::jsonb; end if;
  cab := public._cn_catalog();

  select coalesce(jsonb_agg(x order by x->>'k'), '[]'::jsonb) into res
  from (
    select distinct on (cm->>'act') jsonb_strip_nulls(jsonb_build_object(
             'k',   cm->>'act',
             'cd',  greatest(0, coalesce((cm->>'cd')::int, 3)),
             'dmg', (cm->>'dmg')::numeric,
             'rng', (cm->>'rng')::int,
             'val', (cm->>'val')::numeric)) as x
      from jsonb_array_elements(coalesce(u.data->'modules','[]'::jsonb)) e
      cross join lateral (
        select cab->coalesce(u.category,'ship')->'modules'->(e->>'g')
                  ->coalesce((e->>'idx')::int, -1) -> 'combat' as cm
      ) c
     where cm ? 'act'
     order by cm->>'act'
  ) q;
  return res;
end$$;
revoke all on function public._bt_acts_of(uuid) from public;

-- ── 4) Триггер: активации попадают в бой сами ────────────────
-- Строки battle_units рождаются в ЧЕТЫРЁХ местах (battle_deploy, battle_reinforce,
-- admin_bot_battle, _bt_do_launch). Переписывать все четыре ради одной колонки —
-- напрашиваться на клоббер: они собраны разными накатами. Триггер закрывает все
-- входы разом и переживёт следующую правку этих функций.
create or replace function public._bt_units_acts_fill() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.unit_id is not null
     and (new.acts is null or jsonb_array_length(new.acts) = 0) then
    new.acts := public._bt_acts_of(new.unit_id);
  end if;
  return new;
end$$;

drop trigger if exists trg_bt_units_acts on public.battle_units;
create trigger trg_bt_units_acts before insert on public.battle_units
for each row execute function public._bt_units_acts_fill();

-- ── 5) Осада: теперь по модулю, а не по классу ───────────────
-- Сигнатуру _bt_can_siege(text) не трогаем (на неё ссылается battle_stance из
-- _bt_siege_hold.sql), но смысл меняем: класс больше ничего не решает.
create or replace function public._bt_can_siege(cls text) returns boolean
language sql immutable as $$ select true $$;   -- решает модуль, см. battle_stance

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
  if p_mode not in ('eng','wpn','shd','siege','off') then raise exception 'неизвестный режим «%»', p_mode; end if;

  -- СВОРАЧИВАНИЕ ОСАДЫ
  if p_mode = 'off' then
    if u.stance <> 'siege' then
      raise exception 'сворачивать нечего: «%» не в осадном режиме', u.unit_name;
    end if;
    cost := public._bt_act_cost('siege');
    if u.tp + 1e-9 < cost then
      raise exception 'на сборку платформы нужно % c, у «%» осталось % c',
        round(cost,1), u.unit_name, round(u.tp,1);
    end if;
    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units set stance = 'off', tp = greatest(0, tp - cost) where id = p_unit;
    perform public._bt_log(p_battle, format('%s сворачивает осадную платформу — снова на ходу', u.unit_name));
    return jsonb_build_object('ok', true, 'stance', 'off', 'tp', round(u.tp - cost, 1));
  end if;

  if u.stance <> 'off' then
    raise exception 'мощность уже направлена в этом ходу («%») — переиграть можно только следующим ходом%',
      case u.stance when 'eng' then 'двигатели' when 'wpn' then 'орудия'
                    when 'siege' then 'осадный режим' else 'щит' end,
      case when u.stance = 'siege' then '. Платформу можно свернуть — это отдельное действие' else '' end;
  end if;

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

  -- ОСАДА: только если на борту стоит «Осадная платформа «Кряж»».
  if p_mode = 'siege' then
    if public._bt_act(u.acts, 'siege') is null then
      raise exception 'на «%» нет осадной платформы: поставьте модуль «Осадная платформа «Кряж»» в конструкторе', u.unit_name;
    end if;
    cost := public._bt_act_cost('siege');
    if u.tp + 1e-9 < cost then
      raise exception 'на раскладку осадной платформы нужно % c, у «%» осталось % c',
        round(cost,1), u.unit_name, round(u.tp,1);
    end if;
    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units set stance = 'siege', tp = greatest(0, tp - cost) where id = p_unit;
    perform public._bt_log(p_battle, format('%s раскладывает осадную платформу: урон ×%s, рубеж ×%s — платформа держится, пока её не свернут',
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

-- ── 6) Общая «пробойка»: урон по цели с щитом, бронёй и ПРО ──
-- Модульные удары бьют по тем же правилам, что и залп орудий, иначе игрок
-- не сможет предсказать результат. Возвращает {hull, shield_absorbed, killed}.
create or replace function public._bt_hit(p_target uuid, p_dmg numeric, p_k text, p_terr jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t record; rk numeric; rsh numeric; dmgfac numeric := 1;
        gdmg numeric; absb numeric := 0; use_sec numeric; hull numeric; killed boolean;
begin
  select * into t from public.battle_units where id = p_target for update;
  if t.id is null or not t.alive then return jsonb_build_object('hull',0,'shield_absorbed',0,'killed',false); end if;

  rsh := greatest(0, coalesce(t.shield, 0));
  if public._bt_terra(p_terr, t.x, t.y) = 'neb' then rsh := 0; dmgfac := 0.7; end if;
  if public._bt_terra(p_terr, t.x, t.y) = 'deb' then dmgfac := 0.85; end if;

  rk := least(0.9, greatest(-0.75, coalesce((t.resist->>coalesce(p_k,'kinetic'))::numeric, 0)));
  if coalesce(p_k,'kinetic') = 'missile' and coalesce(t.pd,0) > 0 then
    rk := 1 - (1 - rk) * (1 - least(0.6, t.pd));
  end if;
  gdmg := p_dmg * (1 - rk) * dmgfac;

  if rsh > 0 and gdmg > 0 then
    use_sec := least(rsh, gdmg / greatest(1, t.mitig));
    absb    := use_sec * t.mitig * t.reduc;
    rsh     := rsh - use_sec;
  end if;

  hull := greatest(gdmg * 0.10, (gdmg - absb) - t.armor);
  if gdmg <= 0 then hull := 0; end if;
  killed := (t.hp - hull) <= 0;
  update public.battle_units
     set shield = rsh, hp = greatest(0, t.hp - hull), alive = not killed
   where id = p_target;
  return jsonb_build_object('hull', round(hull), 'shield_absorbed', round(absb), 'killed', killed);
end$$;
revoke all on function public._bt_hit(uuid,numeric,text,jsonb) from public;

-- ── 7) RPC: нажать модуль ────────────────────────────────────
create or replace function public.battle_module(
  p_battle uuid, p_unit uuid, p_key text,
  p_target uuid default null, p_x int default null, p_y int default null)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b public.battles; u record; t record; a jsonb;
        cost numeric; cd int; dist int; hit jsonb; res jsonb;
        dmg numeric; rng int; val numeric; killed int := 0; healed numeric;
        n int := 0;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_arm(p_battle);
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;

  a := public._bt_act(u.acts, p_key);
  if a is null then raise exception 'на «%» нет такого снаряжения', u.unit_name; end if;

  cd := coalesce((u.mcd->>p_key)::int, 0);
  if cd > 0 then
    raise exception '«%» ещё перезаряжается: осталось % ход(ов)', public._bt_act_name(p_key), cd;
  end if;

  cost := public._bt_act_cost(p_key);
  if u.tp + 1e-9 < cost then
    raise exception 'на «%» нужно % c, у «%» осталось % c',
      public._bt_act_name(p_key), round(cost,1), u.unit_name, round(u.tp,1);
  end if;

  dmg := coalesce((a->>'dmg')::numeric, 0);
  rng := coalesce((a->>'rng')::int, 1);
  val := coalesce((a->>'val')::numeric, 0);

  -- ══ РАКЕТНЫЙ ЗАЛП ═════════════════════════════════════════
  if p_key = 'salvo' then
    select * into t from public.battle_units where id = p_target and battle_id = p_battle;
    if t.id is null or not t.alive then raise exception 'цели нет'; end if;
    if t.side = u.side then raise exception 'по своим ракетами не бьём'; end if;
    dist := public._bt_dist(u.x, u.y, t.x, t.y);
    if dist < 2 then raise exception 'дистанция % — ракетам не хватает разгона на захват', dist; end if;
    if dist > rng then raise exception 'дистанция % — «Буревестник» бьёт до % гексов', dist, rng; end if;
    if not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
      raise exception 'линия огня перекрыта астероидами';
    end if;
    hit := public._bt_hit(t.id, dmg, 'missile', b.terrain);
    if (hit->>'killed')::bool then killed := 1; end if;
    perform public._bt_log(p_battle, format('%s ✦ %s: ракетный залп «Буревестник» — %s урона%s',
      u.unit_name, t.unit_name, (hit->>'hull')::numeric + (hit->>'shield_absorbed')::numeric,
      case when killed > 0 then ' — цель уничтожена' else '' end));
    res := jsonb_build_object('hit', hit);

  -- ══ БОРТОВОЙ ЗАЛП (по площади) ════════════════════════════
  elsif p_key = 'broadside' then
    select * into t from public.battle_units where id = p_target and battle_id = p_battle;
    if t.id is null or not t.alive then raise exception 'цели нет'; end if;
    if t.side = u.side then raise exception 'по своим бортом не бьём'; end if;
    dist := public._bt_dist(u.x, u.y, t.x, t.y);
    if dist > rng then raise exception 'дистанция % — бортовой залп достаёт до % гексов', dist, rng; end if;
    if not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
      raise exception 'линия огня перекрыта астероидами';
    end if;
    -- накрывает цель и ВСЁ вокруг неё, включая своих: это площадь, а не выстрел
    for t in select * from public.battle_units
              where battle_id = p_battle and alive
                and public._bt_dist(x, y, (select x from public.battle_units where id = p_target),
                                          (select y from public.battle_units where id = p_target)) <= 1
                and id <> p_unit
    loop
      hit := public._bt_hit(t.id, case when t.id = p_target then dmg else dmg * 0.5 end,
                            'energy', b.terrain);
      n := n + 1;
      if (hit->>'killed')::bool then killed := killed + 1; end if;
    end loop;
    perform public._bt_log(p_battle, format('%s ✷ бортовой залп «Свара»: накрыто бортов — %s%s',
      u.unit_name, n, case when killed > 0 then format(', уничтожено %s', killed) else '' end));
    res := jsonb_build_object('splash', n, 'killed_n', killed);

  -- ══ ПРЫЖОК ════════════════════════════════════════════════
  elsif p_key = 'blink' then
    if p_x is null or p_y is null then raise exception 'некуда прыгать: не указан гекс'; end if;
    if p_x < 0 or p_x >= public._bt_w() or p_y < 0 or p_y >= public._bt_h()
       or not public._bt_in_arena(b.shape, p_x, p_y) then
      raise exception 'прыжок за кромку арены';
    end if;
    dist := public._bt_dist(u.x, u.y, p_x, p_y);
    if dist < 1 or dist > rng then raise exception 'прыжок бьёт на % гексов, а до цели %', rng, dist; end if;
    if exists(select 1 from public.battle_units
               where battle_id = p_battle and alive and x = p_x and y = p_y) then
      raise exception 'гекс %:% занят', p_x, p_y;
    end if;
    if u.stance = 'siege' then raise exception 'из разложенной осады не прыгают'; end if;
    update public.battle_units set x = p_x, y = p_y, moved = true where id = p_unit;
    perform public._bt_log(p_battle, format('%s уходит прыжком на %s гекс(ов)', u.unit_name, dist));
    res := jsonb_build_object('x', p_x, 'y', p_y);

  -- ══ МАСКИРОВКА ════════════════════════════════════════════
  elsif p_key = 'cloak' then
    if public._bt_terra(b.terrain, u.x, u.y) = 'neb' then
      raise exception 'в туманности поле маскировки не держится';
    end if;
    update public.battle_units
       set stealth = stealth + val::int, cloak = val::int, flash = false
     where id = p_unit;
    perform public._bt_log(p_battle, format('%s уходит под маскировочное поле: +%s к скрытности', u.unit_name, val::int));
    res := jsonb_build_object('cloak', val::int);

  -- ══ УСИЛИТЕЛЬ КОНТУРА ═════════════════════════════════════
  elsif p_key = 'amp' then
    update public.battle_units set amp = amp + val where id = p_unit;
    perform public._bt_log(p_battle, format('%s разгоняет орудийный контур: +%s%% урона до конца хода',
      u.unit_name, round(val * 100)));
    res := jsonb_build_object('amp', val);

  -- ══ РЕМОНТНЫЕ ДРОНЫ ═══════════════════════════════════════
  elsif p_key = 'drones' then
    select * into t from public.battle_units where id = p_target and battle_id = p_battle;
    if t.id is null or not t.alive then raise exception 'цели нет'; end if;
    if t.side <> u.side then raise exception 'дроны чинят только своих'; end if;
    dist := public._bt_dist(u.x, u.y, t.x, t.y);
    if dist > rng then raise exception 'дистанция % — дроны добираются на % гексов', dist, rng; end if;
    healed := least(val, greatest(0, t.max_hp - t.hp));
    if healed <= 0 then raise exception '«%» и так цел', t.unit_name; end if;
    update public.battle_units set hp = least(max_hp, hp + healed) where id = t.id;
    perform public._bt_log(p_battle, format('%s ⟳ %s: ремонтные дроны вернули %s корпуса',
      u.unit_name, t.unit_name, round(healed)));
    res := jsonb_build_object('healed', round(healed));

  else
    raise exception 'неизвестное снаряжение «%»', p_key;
  end if;

  perform public._bt_use_act(p_battle, p_unit);
  update public.battle_units
     set tp  = greatest(0, tp - cost),
         mcd = coalesce(mcd,'{}'::jsonb) || jsonb_build_object(p_key, coalesce((a->>'cd')::int, 3))
   where id = p_unit;

  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'key', p_key,
                            'tp', round(u.tp - cost, 1),
                            'cd', coalesce((a->>'cd')::int, 3)) || coalesce(res, '{}'::jsonb);
end$fn$;
revoke all on function public.battle_module(uuid,uuid,text,uuid,int,int) from public;
grant execute on function public.battle_module(uuid,uuid,text,uuid,int,int) to authenticated;

-- ── 8) Начало хода: тикаем кулдауны, гасим разовые эффекты ───
create or replace function public._bt_tp_refresh(p_battle uuid, p_side text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.battle_units
     set moved = false, fired = false, acted = false, flash = false,
         tp = tp_max,
         shield = 0,
         -- осадная платформа держится, остальное распределяется заново
         stance = case when stance = 'siege' then 'siege' else 'off' end,
         -- «Ярость» и «Вуаль» живут ровно до своего следующего хода
         amp = 0,
         stealth = stealth - cloak,
         cloak = 0,
         -- кулдауны считаются в СВОИХ ходах: тикают, когда борт снова ходит
         mcd = coalesce((
           select jsonb_object_agg(k, greatest(0, v::int - 1))
             from jsonb_each_text(coalesce(mcd,'{}'::jsonb)) as e(k, v)
            where v::int - 1 > 0
         ), '{}'::jsonb)
   where battle_id = p_battle and side = p_side;
end$$;

-- ── 9) Залп учитывает «Ярость» ───────────────────────────────
-- Точечная правка живого ядра: множитель boost домножается на (1 + amp).
-- Переписывать всю _bt_do_fire ради одной строки — терять правки соседей.
do $patch$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = '_bt_do_fire'
   order by p.oid limit 1;
  if src is null then raise notice '_bt_do_fire не найдена'; return; end if;
  if position('boost := boost * (1 + coalesce(u.amp, 0))' in src) > 0 then return; end if;
  if position('rmul  := public._bt_siege_rng();' in src) = 0 then
    raise notice 'якорь в _bt_do_fire не найден — «Ярость» НЕ вшита в залп';
    return;
  end if;
  src := replace(src,
    'rmul  := public._bt_siege_rng();
  end if;',
    'rmul  := public._bt_siege_rng();
  end if;
  boost := boost * (1 + coalesce(u.amp, 0));   -- «Ярость»: складывается с форсажем');
  execute src;
end$patch$;

-- ── 10) Задним числом: активации уже стоящим в бою бортам ────
update public.battle_units bu
   set acts = public._bt_acts_of(bu.unit_id)
 where bu.unit_id is not null
   and jsonb_array_length(coalesce(bu.acts,'[]'::jsonb)) = 0
   and exists(select 1 from public.battles b
               where b.id = bu.battle_id and b.status = 'active');

-- ПРОВЕРКА ГЛАЗАМИ:
--  1) Поставить в конструкторе «Осадная платформа «Кряж»» на факельщика →
--     в бою у борта acts содержит {"k":"siege"}, стойка «Осада» доступна.
--     Без модуля battle_stance(...,'siege') отвечает «нет осадной платформы».
--  2) battle_module(bid, uid, 'salvo', цель) → урон каналом missile, ПРО режет,
--     mcd.salvo = 3; повтор в том же бою → «ещё перезаряжается».
--  3) 'broadside' → в журнале «накрыто бортов — N» (цель + соседи, свои тоже).
--  4) 'blink' с x/y → борт переехал, секунды хода не тронуты.
--  5) Свой следующий ход → mcd уменьшился на 1, amp = 0, скрытность вернулась.
