-- © 2025–2026. Все права защищены.
-- ════════════════════════════════════════════════════════════
-- АКТИВНЫЕ МОДУЛИ, ПАКЕТ 2: дебаффы, импульсы, тараны, режимы
-- ════════════════════════════════════════════════════════════
-- ЦЕПОЧКА: ПОСЛЕ _bt_modules.sql и перегенерённого _unit_catalog.sql.
-- Идемпотентно.
--
-- ЧТО ДОБАВЛЯЕТ. Первый пакет умел только «ударить/подлечить/подвинуться».
-- В источнике (/wiki/Modules) половина модулей бьёт не по корпусу, а по
-- ВОЗМОЖНОСТЯМ: Weaponbreaker сажает урон, Disruptor глушит модули, Stasis
-- тормозит, Drain высаживает энергию, Armor Amplifier поднимает стойкость,
-- Tractor Beam тянет к себе. Для этого заводится общий механизм эффектов.
--
-- ДВА РОДА ЭФФЕКТОВ — и это принципиально разные сроки жизни:
--   • САМОБАФФ (amp/hard/pdb/rapid/sammo) — живёт до СВОЕГО следующего хода,
--     гасится в _bt_tp_refresh своей стороны. Так уже работает «Ярость».
--   • ДЕБАФФ на врага (deb jsonb) — должен пережить МОЙ ход и отработать ВЕСЬ
--     ЕГО. Поэтому вешается со счётчиком +1: его refresh уменьшит 2→1 (эффект
--     ещё жив и портит ему весь ход), а следующий его refresh уберёт совсем.
--     Без этой единицы дебафф гасился бы РАНЬШЕ, чем жертва успела походить.
-- ════════════════════════════════════════════════════════════

-- ── 1) Состояние ─────────────────────────────────────────────
alter table public.battle_units add column if not exists deb   jsonb   not null default '{}'::jsonb;
alter table public.battle_units add column if not exists hard  numeric not null default 0;
alter table public.battle_units add column if not exists pdb   numeric not null default 0;
alter table public.battle_units add column if not exists blind int     not null default 0;
alter table public.battle_units add column if not exists rapid boolean not null default false;
alter table public.battle_units add column if not exists sammo boolean not null default false;
alter table public.battle_units add column if not exists drain numeric not null default 0;

comment on column public.battle_units.deb   is 'дебаффы врага: {ключ: сколько ХОДОВ ещё висит}; вешать через _bt_deb_add (там +1)';
comment on column public.battle_units.hard  is 'доля снижения входящего урона (броневой замок / импульс брони)';
comment on column public.battle_units.pdb   is 'прибавка к ПРО от противоракетных лазеров';
comment on column public.battle_units.blind is 'сколько сенсора отнял скремблер (чтобы вернуть ровно столько)';
comment on column public.battle_units.rapid is 'беглый огонь: залп стоит вдвое дешевле до конца хода';
comment on column public.battle_units.sammo is 'стазис-боеприпас: залпы этого хода сажают цель в стазис';
comment on column public.battle_units.drain is 'сколько секунд снять со следующего пула (иссушитель)';

-- ── 2) Работа с дебаффами ────────────────────────────────────
create or replace function public._bt_deb_has(p_deb jsonb, p_key text) returns boolean
language sql immutable as $$ select coalesce((p_deb->>p_key)::int, 0) > 0 $$;

-- Вешает дебафф НА ХОД ЖЕРТВЫ. p_turns=1 → отработает ровно один её ход.
create or replace function public._bt_deb_add(p_unit uuid, p_key text, p_turns int default 1)
returns void language sql security definer set search_path=public as $$
  update public.battle_units
     set deb = coalesce(deb,'{}'::jsonb) || jsonb_build_object(p_key,
                 greatest(coalesce((deb->>p_key)::int, 0), greatest(1, p_turns) + 1))
   where id = p_unit;
$$;
revoke all on function public._bt_deb_add(uuid,text,int) from public;

create or replace function public._bt_deb_ru(k text) returns text language sql immutable as $$
  select coalesce((jsonb_build_object(
    'stasis','вязкое поле','disrupt','шина снаряжения заглушена',
    'wbreak','наведение сбито','soft','броня вспорота')->>k), k);
$$;

-- ── 3) Цена активаций пакета 2 ───────────────────────────────
create or replace function public._bt_act_cost(k text) returns numeric
language sql immutable as $$
  select coalesce((jsonb_build_object(
    'siege', 2.0, 'salvo', 2.0, 'broadside', 2.5,
    'blink', 0.0, 'cloak', 1.0, 'amp', 1.0, 'drones', 1.5,
    -- пакет 2
    'torpedo', 2.5, 'storm', 2.0, 'ram', 2.0, 'rupture', 2.0,
    'drain', 1.5, 'wbreak', 1.5, 'disrupt', 1.5, 'wboost', 1.0,
    'pboost', 1.5, 'hell', 2.0, 'blind', 1.0, 'pdup', 1.0,
    'stasis', 1.5, 'aboost', 1.5, 'tractor', 1.5, 'nuke', 3.0,
    'tartarus', 2.0, 'sammo', 1.0, 'hard', 1.0, 'reboot', 1.0,
    'rapid', 1.0,
    'energy', 0.0)->>k)::numeric, 1.0);
$$;

create or replace function public._bt_act_name(k text) returns text
language sql immutable as $$
  select coalesce((jsonb_build_object(
    'siege','осадная платформа','salvo','ракетный залп','broadside','бортовой залп',
    'blink','прыжок','cloak','маскировка','amp','усилитель контура','drones','ремонтные дроны',
    'torpedo','торпеда «Голиаф»','storm','ракеты «Шквал»','ram','плазменный таран',
    'rupture','разрывной таран','drain','торпеда-иссушитель','wbreak','ракета «Ломовик»',
    'disrupt','ракета-подавитель','wboost','ракета-усилитель','pboost','импульс «Хорал»',
    'hell','адские лазеры','blind','скремблер-импульс','pdup','противоракетные лазеры',
    'stasis','стазис-лучи','aboost','импульс брони','tractor','тяговый луч',
    'nuke','ядерная ракета','tartarus','ракета «Тартар»','sammo','стазис-боеприпас',
    'hard','броневой замок','reboot','перезапуск снаряжения','rapid','беглый огонь',
    'energy','энергогенератор')->>k), k);
$$;

-- ── 4) Пробойка с учётом брони-баффа и зонтика ПРО ───────────
create or replace function public._bt_hit(p_target uuid, p_dmg numeric, p_k text, p_terr jsonb,
                                          p_pierce boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t record; rk numeric; rsh numeric; dmgfac numeric := 1;
        gdmg numeric; absb numeric := 0; use_sec numeric; hull numeric; killed boolean;
begin
  select * into t from public.battle_units where id = p_target for update;
  if t.id is null or not t.alive then return jsonb_build_object('hull',0,'shield_absorbed',0,'killed',false); end if;

  rsh := greatest(0, coalesce(t.shield, 0));
  if p_pierce then rsh := 0; end if;                    -- таран идёт сквозь поле
  if public._bt_terra(p_terr, t.x, t.y) = 'neb' then rsh := 0; dmgfac := 0.7; end if;
  if public._bt_terra(p_terr, t.x, t.y) = 'deb' then dmgfac := 0.85; end if;
  -- броневой замок / импульс брони
  dmgfac := dmgfac * (1 - least(0.8, greatest(0, coalesce(t.hard, 0))));

  rk := least(0.9, greatest(-0.75, coalesce((t.resist->>coalesce(p_k,'kinetic'))::numeric, 0)));
  -- «Разрывной таран» вспорол обшивку — стойкости работают хуже
  if public._bt_deb_has(t.deb, 'soft') then rk := rk * 0.7; end if;
  if coalesce(p_k,'kinetic') = 'missile' then
    rk := 1 - (1 - rk) * (1 - least(0.6, coalesce(t.pd,0) + coalesce(t.pdb,0)));
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
     set shield = case when p_pierce then shield else rsh end,
         hp = greatest(0, t.hp - hull), alive = not killed
   where id = p_target;
  return jsonb_build_object('hull', round(hull), 'shield_absorbed', round(absb), 'killed', killed);
end$$;
revoke all on function public._bt_hit(uuid,numeric,text,jsonb,boolean) from public;

-- ── 5) Начало хода: гасим самобаффы, тикаем дебаффы и кулдауны ──
create or replace function public._bt_tp_refresh(p_battle uuid, p_side text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.battle_units
     set moved = false, fired = false, acted = false, flash = false,
         -- иссушитель: у пула этого хода отняли секунды
         tp = greatest(1, tp_max - greatest(0, coalesce(drain, 0))),
         drain = 0,
         shield = 0,
         stance = case when stance = 'siege' then 'siege' else 'off' end,
         -- самобаффы живут ровно до своего следующего хода
         amp = 0, hard = 0, pdb = 0, rapid = false, sammo = false,
         stealth = stealth - cloak, cloak = 0,
         sensor  = sensor + blind,  blind = 0,
         mcd = coalesce((
           select jsonb_object_agg(k, v::int - 1)
             from jsonb_each_text(coalesce(mcd,'{}'::jsonb)) as e(k, v)
            where v::int - 1 > 0
         ), '{}'::jsonb),
         -- дебаффы тикают ЗДЕСЬ же: повешенный врагом с запасом +1 доживёт
         -- до конца этого хода и снимется только следующим
         deb = coalesce((
           select jsonb_object_agg(k, v::int - 1)
             from jsonb_each_text(coalesce(deb,'{}'::jsonb)) as e(k, v)
            where v::int - 1 > 0
         ), '{}'::jsonb)
   where battle_id = p_battle and side = p_side;
end$$;

-- ── 6) Ход: вязкое поле удваивает цену шага ──────────────────
do $patch$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = '_bt_do_move'
   order by p.oid limit 1;
  if src is null then raise notice '_bt_do_move не найдена'; return; end if;
  if position('_bt_deb_has(u.deb, ''stasis'')' in src) > 0 then return; end if;
  if position('if u.stance = ''eng'' then cost := cost * public._bt_eng_mult(); end if;' in src) = 0 then
    raise notice 'якорь цены шага не найден — стазис в ход НЕ вшит';
    return;
  end if;
  src := replace(src,
    'if u.stance = ''eng'' then cost := cost * public._bt_eng_mult(); end if;',
    'if u.stance = ''eng'' then cost := cost * public._bt_eng_mult(); end if;
  if public._bt_deb_has(u.deb, ''stasis'') then cost := cost * 2; end if;   -- вязкое поле');
  execute src;
end$patch$;

-- ── 7) Залп: беглый огонь, сбитое наведение, стазис-боеприпас ──
do $patch$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = '_bt_do_fire'
   order by p.oid limit 1;
  if src is null then raise exception '_bt_do_fire не найдена'; end if;
  if position('_bt_deb_has(u.deb, ''wbreak'')' in src) > 0 then
    raise notice 'эффекты пакета 2 уже в залпе — пропускаю';
    return;
  end if;

  -- 7a) беглый огонь удешевляет залп
  if position('if u.stance = ''wpn'' then fcost := fcost * public._bt_wpn_cost(); end if;' in src) = 0 then
    raise exception 'якорь цены залпа не найден';
  end if;
  src := replace(src,
    'if u.stance = ''wpn'' then fcost := fcost * public._bt_wpn_cost(); end if;',
    'if u.stance = ''wpn'' then fcost := fcost * public._bt_wpn_cost(); end if;
  if coalesce(u.rapid, false) then fcost := fcost * 0.5; end if;   -- беглый огонь');

  -- 7b) сбитое наведение режет урон залпа
  if position('boost := boost * (1 + coalesce(u.amp, 0));' in src) = 0 then
    raise exception 'якорь «Ярости» не найден';
  end if;
  src := replace(src,
    'boost := boost * (1 + coalesce(u.amp, 0));',
    'boost := boost * (1 + coalesce(u.amp, 0));
  if public._bt_deb_has(u.deb, ''wbreak'') then boost := boost * 0.5; end if;   -- «Ломовик»');

  -- 7c) зонтик ПРО и броневой замок цели действуют и на обычный залп
  src := replace(src,
    'rk := 1 - (1 - rk) * (1 - least(0.6, t.pd));',
    'rk := 1 - (1 - rk) * (1 - least(0.6, coalesce(t.pd,0) + coalesce(t.pdb,0)));');
  src := replace(src,
    'if public._bt_terra(b.terrain, t.x, t.y) = ''deb'' then dmgfac := 0.85; end if;',
    'if public._bt_terra(b.terrain, t.x, t.y) = ''deb'' then dmgfac := 0.85; end if;
  dmgfac := dmgfac * (1 - least(0.8, greatest(0, coalesce(t.hard, 0))));   -- броневой замок цели
  if public._bt_deb_has(t.deb, ''soft'') then dmgfac := dmgfac * 1.2; end if;   -- обшивка вспорота');

  -- 7d) стазис-боеприпас сажает цель в вязкое поле
  src := replace(src,
    'perform public._bt_check_end(p_battle);',
    'if coalesce(u.sammo, false) then
    perform public._bt_deb_add(p_target, ''stasis'', 1);
    perform public._bt_log(p_battle, format(''%s сажает %s в стазис-поле: следующий ход вдвое дороже'',
      u.unit_name, t.unit_name));
  end if;
  perform public._bt_check_end(p_battle);');

  execute src;
end$patch$;

-- ── 8) RPC: все активации ────────────────────────────────────
create or replace function public.battle_module(
  p_battle uuid, p_unit uuid, p_key text,
  p_target uuid default null, p_x int default null, p_y int default null)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b public.battles; u record; t record; a jsonb;
        cost numeric; cd int; dist int; hit jsonb; res jsonb;
        dmg numeric; rng int; val numeric; killed int := 0; healed numeric;
        n int := 0; tx int; ty int; nx int; ny int; step int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_arm(p_battle);
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;

  if public._bt_deb_has(u.deb, 'disrupt') then
    raise exception 'шина снаряжения «%» заглушена подавителем — в этом ходу модули не работают', u.unit_name;
  end if;

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

  -- ══ ОДИНОЧНЫЕ УДАРЫ ПО ЦЕЛИ ═══════════════════════════════
  if p_key in ('salvo','storm','ram','rupture','drain','wbreak','disrupt','tartarus') then
    select * into t from public.battle_units where id = p_target and battle_id = p_battle;
    if t.id is null or not t.alive then raise exception 'цели нет'; end if;
    if t.side = u.side then raise exception 'по своим не бьём'; end if;
    dist := public._bt_dist(u.x, u.y, t.x, t.y);
    if p_key in ('ram','rupture') and dist <> 1 then
      raise exception 'таран бьёт только вплотную: до цели % гекс(ов)', dist;
    end if;
    if p_key = 'salvo' and dist < 2 then
      raise exception 'дистанция % — ракетам не хватает разгона на захват', dist;
    end if;
    if dist > rng then
      raise exception 'дистанция % — «%» достаёт до % гексов', dist, public._bt_act_name(p_key), rng;
    end if;
    if not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
      raise exception 'линия огня перекрыта астероидами';
    end if;

    hit := public._bt_hit(t.id, dmg,
             case when p_key in ('ram','rupture') then 'kinetic'
                  when p_key in ('wbreak','disrupt','drain','tartarus') then 'missile'
                  else 'missile' end,
             b.terrain,
             p_key in ('ram','rupture'));           -- тараны идут сквозь щит
    if (hit->>'killed')::bool then killed := 1; end if;

    if p_key = 'rupture'  then perform public._bt_deb_add(t.id, 'soft', 1); end if;
    if p_key = 'wbreak'   then perform public._bt_deb_add(t.id, 'wbreak', 1); end if;
    if p_key = 'disrupt'  then perform public._bt_deb_add(t.id, 'disrupt', 1); end if;
    if p_key = 'drain'    then update public.battle_units set drain = drain + val where id = t.id; end if;
    if p_key = 'tartarus' then
      perform public._bt_deb_add(t.id, 'stasis', 1);
      perform public._bt_deb_add(t.id, 'disrupt', 1);
      update public.battle_units set drain = drain + 2 where id = t.id;
    end if;

    perform public._bt_log(p_battle, format('%s ✦ %s: %s — %s урона%s',
      u.unit_name, t.unit_name, public._bt_act_name(p_key),
      (hit->>'hull')::numeric + (hit->>'shield_absorbed')::numeric,
      case when killed > 0 then ' — цель уничтожена' else '' end));
    res := jsonb_build_object('hit', hit);

  -- ══ УДАРЫ ПО ПЛОЩАДИ ══════════════════════════════════════
  elsif p_key in ('broadside','torpedo','nuke') then
    select * into t from public.battle_units where id = p_target and battle_id = p_battle;
    if t.id is null or not t.alive then raise exception 'цели нет'; end if;
    if t.side = u.side then raise exception 'по своим не бьём'; end if;
    dist := public._bt_dist(u.x, u.y, t.x, t.y);
    if dist > rng then
      raise exception 'дистанция % — «%» достаёт до % гексов', dist, public._bt_act_name(p_key), rng;
    end if;
    if not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
      raise exception 'линия огня перекрыта астероидами';
    end if;
    tx := t.x; ty := t.y;
    -- накрывает цель и всё вокруг неё, включая своих: это площадь, не выстрел
    for t in select * from public.battle_units
              where battle_id = p_battle and alive and id <> p_unit
                and public._bt_dist(x, y, tx, ty) <= 1
    loop
      hit := public._bt_hit(t.id,
               case when t.x = tx and t.y = ty then dmg
                    when p_key = 'nuke' then dmg * 0.6 else dmg * 0.5 end,
               case when p_key = 'broadside' then 'energy' else 'missile' end,
               b.terrain);
      n := n + 1;
      if (hit->>'killed')::bool then killed := killed + 1; end if;
    end loop;
    perform public._bt_log(p_battle, format('%s ✷ %s: накрыто бортов — %s%s',
      u.unit_name, public._bt_act_name(p_key), n,
      case when killed > 0 then format(', уничтожено %s', killed) else '' end));
    res := jsonb_build_object('splash', n, 'killed_n', killed);

  -- ══ ИМПУЛЬС ПО ВРАГАМ ВОКРУГ ══════════════════════════════
  elsif p_key in ('hell','blind','stasis') then
    for t in select * from public.battle_units
              where battle_id = p_battle and alive and side <> u.side
                and public._bt_dist(x, y, u.x, u.y) <= rng
    loop
      n := n + 1;
      if p_key = 'hell' then
        hit := public._bt_hit(t.id, dmg, 'energy', b.terrain);
        if (hit->>'killed')::bool then killed := killed + 1; end if;
      elsif p_key = 'blind' then
        update public.battle_units
           set sensor = greatest(0, sensor - val::int), blind = blind + val::int
         where id = t.id;
      else
        perform public._bt_deb_add(t.id, 'stasis', 1);
      end if;
    end loop;
    if n = 0 then raise exception 'в радиусе % гексов нет ни одного врага', rng; end if;
    perform public._bt_log(p_battle, format('%s ◎ %s: задето врагов — %s%s',
      u.unit_name, public._bt_act_name(p_key), n,
      case when killed > 0 then format(', уничтожено %s', killed) else '' end));
    res := jsonb_build_object('hit_n', n, 'killed_n', killed);

  -- ══ ИМПУЛЬС ПО СВОИМ ВОКРУГ ═══════════════════════════════
  elsif p_key in ('pboost','pdup','aboost') then
    for t in select * from public.battle_units
              where battle_id = p_battle and alive and side = u.side
                and public._bt_dist(x, y, u.x, u.y) <= rng
    loop
      n := n + 1;
      if p_key = 'pboost' then
        update public.battle_units set amp = amp + val where id = t.id;
      elsif p_key = 'pdup' then
        update public.battle_units set pdb = greatest(pdb, val) where id = t.id;
      else
        update public.battle_units set hard = greatest(hard, val) where id = t.id;
      end if;
    end loop;
    perform public._bt_log(p_battle, format('%s ◈ %s: накрыто своих бортов — %s',
      u.unit_name, public._bt_act_name(p_key), n));
    res := jsonb_build_object('ally_n', n);

  -- ══ БАФФ СОЮЗНИКУ / РЕМОНТ ════════════════════════════════
  elsif p_key in ('wboost','drones') then
    select * into t from public.battle_units where id = p_target and battle_id = p_battle;
    if t.id is null or not t.alive then raise exception 'цели нет'; end if;
    if t.side <> u.side then raise exception 'это снаряжение работает по СВОИМ'; end if;
    dist := public._bt_dist(u.x, u.y, t.x, t.y);
    if dist > rng then raise exception 'дистанция % — достаёт до % гексов', dist, rng; end if;
    if p_key = 'wboost' then
      update public.battle_units set amp = amp + val where id = t.id;
      perform public._bt_log(p_battle, format('%s ◈ %s: орудийный контур разогнан на %s%%',
        u.unit_name, t.unit_name, round(val * 100)));
      res := jsonb_build_object('amp', val);
    else
      healed := least(val, greatest(0, t.max_hp - t.hp));
      if healed <= 0 then raise exception '«%» и так цел', t.unit_name; end if;
      update public.battle_units set hp = least(max_hp, hp + healed) where id = t.id;
      perform public._bt_log(p_battle, format('%s ⟳ %s: ремонтные дроны вернули %s корпуса',
        u.unit_name, t.unit_name, round(healed)));
      res := jsonb_build_object('healed', round(healed));
    end if;

  -- ══ ТЯГОВЫЙ ЛУЧ ═══════════════════════════════════════════
  elsif p_key = 'tractor' then
    select * into t from public.battle_units where id = p_target and battle_id = p_battle;
    if t.id is null or not t.alive then raise exception 'цели нет'; end if;
    if t.side = u.side then raise exception 'тяговый луч — для чужих бортов'; end if;
    dist := public._bt_dist(u.x, u.y, t.x, t.y);
    if dist > rng then raise exception 'дистанция % — луч достаёт до % гексов', dist, rng; end if;
    if dist <= 1 then raise exception '«%» и так вплотную — тянуть некуда', t.unit_name; end if;
    nx := t.x; ny := t.y;
    -- шагаем к себе, пока есть куда: занятый или закрытый гекс останавливает
    for step in 1..greatest(1, val::int) loop
      tx := nx + sign(u.x - nx); ty := ny + sign(u.y - ny);
      exit when public._bt_dist(tx, ty, u.x, u.y) < 1;
      exit when not public._bt_in_arena(b.shape, tx, ty);
      exit when exists(select 1 from public.battle_units
                        where battle_id = p_battle and alive and x = tx and y = ty);
      nx := tx; ny := ty;
    end loop;
    if nx = t.x and ny = t.y then raise exception 'цель не сдвинуть: путь к вам перекрыт'; end if;
    update public.battle_units set x = nx, y = ny where id = t.id;
    perform public._bt_log(p_battle, format('%s ⟿ %s: тяговый луч подтянул цель на %s гекс(ов)',
      u.unit_name, t.unit_name, public._bt_dist(t.x, t.y, nx, ny)));
    res := jsonb_build_object('x', nx, 'y', ny);

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

  -- ══ САМОБАФФЫ ═════════════════════════════════════════════
  elsif p_key = 'cloak' then
    if public._bt_terra(b.terrain, u.x, u.y) = 'neb' then
      raise exception 'в туманности поле маскировки не держится';
    end if;
    update public.battle_units
       set stealth = stealth + val::int, cloak = cloak + val::int, flash = false
     where id = p_unit;
    perform public._bt_log(p_battle, format('%s уходит под маскировочное поле: +%s к скрытности', u.unit_name, val::int));
    res := jsonb_build_object('cloak', val::int);

  elsif p_key = 'amp' then
    update public.battle_units set amp = amp + val where id = p_unit;
    perform public._bt_log(p_battle, format('%s разгоняет орудийный контур: +%s%% урона до конца хода',
      u.unit_name, round(val * 100)));
    res := jsonb_build_object('amp', val);

  elsif p_key = 'hard' then
    update public.battle_units set hard = greatest(hard, val) where id = p_unit;
    perform public._bt_log(p_battle, format('%s встаёт в броневой замок: −%s%% входящего урона',
      u.unit_name, round(val * 100)));
    res := jsonb_build_object('hard', val);

  elsif p_key = 'rapid' then
    update public.battle_units set rapid = true where id = p_unit;
    perform public._bt_log(p_battle, format('%s переходит на беглый огонь: залп вдвое дешевле', u.unit_name));
    res := jsonb_build_object('rapid', true);

  elsif p_key = 'sammo' then
    update public.battle_units set sammo = true where id = p_unit;
    perform public._bt_log(p_battle, format('%s заряжает стазис-боеприпас', u.unit_name));
    res := jsonb_build_object('sammo', true);

  elsif p_key = 'energy' then
    update public.battle_units set tp = least(tp_max, tp + val) where id = p_unit;
    perform public._bt_log(p_battle, format('%s сбрасывает буфер в шину: +%s c к ходу', u.unit_name, val));
    res := jsonb_build_object('tp_gain', val);

  elsif p_key = 'reboot' then
    update public.battle_units
       set mcd = coalesce((
             select jsonb_object_agg(k, v::int - greatest(1, val::int))
               from jsonb_each_text(coalesce(mcd,'{}'::jsonb)) as e(k, v)
              where v::int - greatest(1, val::int) > 0 and k <> 'reboot'
           ), '{}'::jsonb)
     where id = p_unit;
    perform public._bt_log(p_battle, format('%s перезапускает шину снаряжения: −%s ход(а) со всех кулдаунов',
      u.unit_name, greatest(1, val::int)));
    res := jsonb_build_object('reboot', greatest(1, val::int));

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

-- ПРОВЕРКА: node tools/db_run.js _bt_modules2_selftest.sql

-- ── 9) Снос старой 4-аргументной _bt_hit ─────────────────────
-- Версия из _bt_modules.sql не знала про p_pierce. Новая объявлена с DEFAULT,
-- поэтому обе подходят под вызов из четырёх аргументов и Postgres честно
-- отвечает «is not unique». Оставляем ровно одну.
drop function if exists public._bt_hit(uuid, numeric, text, jsonb);
