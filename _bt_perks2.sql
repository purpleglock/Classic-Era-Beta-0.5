-- ══════════════════════════════════════════════════════════════════
--  ПЕРКИ, СЛАЙС 2: происхождение державы + три новые карточки
--  ─────────────────────────────────────────────────────────────────
--  • Гейт по анкете фракции (_perk_gate_ok): вера / ИИ / улей.
--  • «Путь мученика»   — пастырь берёт половину боли союзника (вера).
--  • «Перехват контура»— чужой борт воюет за вас 2 хода (ИИ).
--  • «Звёздный хор»    — пул хода растёт от здоровых союзников (улей).
--  • Переименованы: perk.necro → «Пожиратель душ», perk.calm →
--    «Трансцендентность»; обе, как и мученик, теперь только для веры.
--
--  КАТИТСЯ ПОСЛЕ _bt_perks.sql. Клиентское зеркало — perks.js.
-- ══════════════════════════════════════════════════════════════════

insert into public.tech_nodes (node_id, base_cost, prereq) values
  ('perk.martyr', 140, '[]'::jsonb),
  ('perk.hijack', 260, '[]'::jsonb),
  ('perk.choir',  120, '[]'::jsonb)
on conflict (node_id) do update
  set base_cost = excluded.base_cost, prereq = excluded.prereq;

-- ── Каталог: имена, класс, происхождение ──────────────────────────
create or replace function public._perk_cat() returns jsonb
  language sql immutable as $$
  select '{
    "perk.patience":   {"n":"Терпение",               "cls":null,           "g":null},
    "perk.timeman":    {"n":"Тайменеджмент",          "cls":null,           "g":null},
    "perk.list":       {"n":"Наклонности",            "cls":null,           "g":null},
    "perk.altaan":     {"n":"Альтаанская стойкость",  "cls":null,           "g":null},
    "perk.shine":      {"n":"Сияй другим",            "cls":null,           "g":null},
    "perk.slow":       {"n":"Медленно и верно",       "cls":null,           "g":null},
    "perk.kchau":      {"n":"Кчау",                   "cls":null,           "g":null},
    "perk.conformist": {"n":"Капитан-конформист",     "cls":null,           "g":null},
    "perk.beamrider":  {"n":"Бимрайдер",              "cls":["destroyer"],  "g":null},
    "perk.recycler":   {"n":"Серийный ресайклер",     "cls":null,           "g":null},
    "perk.despair":    {"n":"Отчаяние",               "cls":null,           "g":null},
    "perk.necro":      {"n":"Пожиратель душ",         "cls":null,           "g":"faith"},
    "perk.bloodlust":  {"n":"Жажда крови",            "cls":null,           "g":null},
    "perk.calm":       {"n":"Трансцендентность",      "cls":null,           "g":"faith"},
    "perk.martyr":     {"n":"Путь мученика",          "cls":null,           "g":"faith"},
    "perk.hijack":     {"n":"Перехват контура",       "cls":null,           "g":"ai"},
    "perk.choir":      {"n":"Звёздный хор",           "cls":null,           "g":"hive"}
  }'::jsonb;
$$;

-- Происхождение державы открывает карточку? Гейт «faith» — тот же, что и у
-- основания религии (_faith_can_found), только без админской лазейки: право
-- строить веру и право ставить её карточки должны совпадать.
create or replace function public._perk_gate_ok(p_key text, p_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select case public._perk_cat()->p_key->>'g'
    when null then true
    when 'faith' then coalesce((select a.ideology = 'Спиритуализм' or a.gov = 'Теократия'
                                  from public.faction_applications a
                                 where a.faction_id = p_fid and a.status = 'approved'
                                 order by a.updated_at desc limit 1), false)
    when 'ai'    then coalesce((select a.gov = 'Машинный разум (ИИ)'
                                  from public.faction_applications a
                                 where a.faction_id = p_fid and a.status = 'approved'
                                 order by a.updated_at desc limit 1), false)
    when 'hive'  then coalesce((select a.gov = 'Коллективный разум'
                                  from public.faction_applications a
                                 where a.faction_id = p_fid and a.status = 'approved'
                                 order by a.updated_at desc limit 1), false)
    else true end;
$$;
revoke all on function public._perk_gate_ok(text, text) from public;
grant execute on function public._perk_gate_ok(text, text) to authenticated;

-- ── Карточки проекта → карточки борта (теперь с гейтом происхождения) ──
create or replace function public._bt_perks_of(p_unit uuid, p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare u record; res jsonb; cls text; fid text;
begin
  if p_unit is null then return '[]'::jsonb; end if;
  select * into u from public.faction_units where id = p_unit;
  if u.id is null then return '[]'::jsonb; end if;
  cls := nullif(u.data->>'class','');
  fid := coalesce(p_fid, u.faction_id);

  select coalesce(jsonb_agg(k), '[]'::jsonb) into res
  from (
    select distinct on (e.value) e.value as k
      from jsonb_array_elements_text(coalesce(u.data->'perks','[]'::jsonb)) e
     where public._perk_cat() ? e.value
       and public._perk_cls_ok(e.value, cls)
       and public._perk_gate_ok(e.value, fid)
       and exists (select 1 from public.faction_economy fe
                    where fe.faction_id = fid
                      and coalesce(fe.research,'[]'::jsonb) ? e.value)
     order by e.value
     limit public._perk_slots()
  ) q;
  return res;
end$$;

-- ── «Перехват контура» получает кнопку в панели снаряжения ────────
-- Активный перк — единственный, поэтому не заводим отдельный слой UI:
-- дописываем его в acts борта, и он едет по общей дороге _bt_do_module.
create or replace function public._bt_act_cost(k text) returns numeric
 language sql immutable as $$
  select coalesce((jsonb_build_object(
    'siege', 2.0, 'salvo', 2.0, 'broadside', 2.5,
    'blink', 0.0, 'cloak', 1.0, 'amp', 1.0, 'drones', 1.5,
    'torpedo', 2.5, 'storm', 2.0, 'ram', 2.0, 'rupture', 2.0,
    'drain', 1.5, 'wbreak', 1.5, 'disrupt', 1.5, 'wboost', 1.0,
    'pboost', 1.5, 'hell', 2.0, 'blind', 1.0, 'pdup', 1.0,
    'stasis', 1.5, 'aboost', 1.5, 'tractor', 1.5, 'nuke', 3.0,
    'tartarus', 2.0, 'sammo', 1.0, 'hard', 1.0, 'reboot', 1.0,
    'rapid', 1.0, 'hijack', 3.0,
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
    'hard','протокол «Эгида»','reboot','перезапуск снаряжения','rapid','беглый огонь',
    'hijack','перехват контура',
    'energy','энергогенератор')->>k), k);
$$;

create or replace function public._bt_units_acts_fill()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.unit_id is not null
     and (new.acts is null or jsonb_array_length(new.acts) = 0) then
    new.acts := public._bt_acts_of(new.unit_id);
  end if;
  if new.unit_id is not null
     and (new.perks is null or jsonb_array_length(new.perks) = 0) then
    new.perks := public._bt_perks_of(new.unit_id, new.fid);
  end if;
  -- «Медленно и верно»: корпус ×1.2 до выхода на доску
  if public._bt_pk_has(new.perks, 'perk.slow') then
    new.max_hp := round(coalesce(new.max_hp, 0) * 1.20);
    new.hp     := round(coalesce(new.hp, 0) * 1.20);
  end if;
  -- «Перехват контура» — активная карточка: своя кнопка в панели снаряжения
  if public._bt_pk_has(new.perks, 'perk.hijack')
     and public._bt_act(new.acts, 'hijack') is null then
    new.acts := coalesce(new.acts, '[]'::jsonb)
                || jsonb_build_array(jsonb_build_object('k','hijack','cd',6,'rng',7));
  end if;
  return new;
end$$;

-- ── «Путь мученика» ───────────────────────────────────────────────
-- Половина урона по корпусу союзника в 4 гексах уходит на пастыря, а сам
-- союзник получает секунду к следующему ходу и −1 со всех кулдаунов.
-- Возвращает true, если сработало: вызывающий обязан ПЕРЕСЧИТАТЬ killed —
-- цель могла ожить, ведь половину корпуса ей вернули.
create or replace function public._bt_perk_martyr(p_victim uuid, p_hull numeric)
returns boolean language plpgsql security definer set search_path=public as $$
declare v record; m record; half numeric;
begin
  if coalesce(p_hull, 0) <= 0 then return false; end if;
  select * into v from public.battle_units where id = p_victim;
  if v.id is null then return false; end if;

  select * into m from public.battle_units bu
   where bu.battle_id = v.battle_id and bu.alive and bu.side = v.side and bu.id <> v.id
     and public._bt_pk_has(bu.perks, 'perk.martyr')
     and public._bt_dist(bu.x, bu.y, v.x, v.y) <= 4
   order by public._bt_dist(bu.x, bu.y, v.x, v.y)
   limit 1;
  if m.id is null then return false; end if;

  half := round(p_hull * 0.5);
  if half <= 0 then return false; end if;

  -- боль переезжает: половину корпуса цели возвращаем, столько же снимаем с пастыря
  update public.battle_units
     set hp = least(max_hp, hp + half), alive = (least(max_hp, hp + half) > 0)
   where id = v.id;
  update public.battle_units
     set hp = greatest(0, hp - half), alive = (hp - half) > 0
   where id = m.id;
  perform public._bt_perk_bank(v.id, 1.0);
  perform public._bt_mcd_cut(v.id, 1);
  perform public._bt_log(v.battle_id, format(
    '%s принимает боль %s на себя: %s урона переходит пастырю, ведомому +1 c и −1 ход со всех кулдаунов%s',
    m.unit_name, v.unit_name, half,
    case when m.hp - half <= 0 then ' — пастырь пал' else '' end));
  return true;
end$$;

-- ── «Перехват контура»: возврат пленников ─────────────────────────
-- Считаем в ПОЛУХОДАХ (turn_no растёт на каждой смене стороны): 2 своих
-- хода = 4 полухода. Возврат делаем в конце хода, до проверки конца боя.
create or replace function public._bt_hijack_tick(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $$
declare b record; r record;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null then return; end if;
  for r in select * from public.battle_units
            where battle_id = p_battle and coalesce(pk,'{}'::jsonb) ? 'hj'
              and coalesce((pk->'hj'->>'u')::int, 0) <= b.turn_no loop
    update public.battle_units
       set side = r.pk->'hj'->>'s',
           fid  = r.pk->'hj'->>'f',
           acted = true, tp = 0, moved = false, fired = false,
           pk = coalesce(pk,'{}'::jsonb) - 'hj'
     where id = r.id;
    if r.alive then
      perform public._bt_log(p_battle, format(
        '«%s» сбрасывает чужой контур и возвращается к своим', r.unit_name));
    end if;
  end loop;
end$$;

-- ── Начало хода стороны: сюда добавился «Звёздный хор» ────────────
create or replace function public._bt_tp_refresh(p_battle uuid, p_side text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.battle_units u
     set moved = false, fired = false, acted = false, flash = false,
         tp = greatest(1, u.tp_max - greatest(0, coalesce(u.drain, 0)))
              -- «Тайменеджмент»: половина неистраченного остатка переходит дальше
              + case when public._bt_pk_has(u.perks, 'perk.timeman')
                     then greatest(0, coalesce(u.tp, 0)) * 0.5 else 0 end
              -- «Терпение»: модули, выходящие из перезарядки, отдают секунды
              + case when public._bt_pk_has(u.perks, 'perk.patience') then coalesce((
                       select sum(0.25 * greatest(1, coalesce(
                                (public._bt_act(u.acts, e.k)->>'cd')::int, 3)))
                         from jsonb_each_text(coalesce(u.mcd,'{}'::jsonb)) as e(k, v)
                        where v::int = 1), 0) else 0 end
              -- «Звёздный хор»: улей поёт тем быстрее, чем больше здоровых тел
              + case when public._bt_pk_has(u.perks, 'perk.choir') then least(2.0, 0.15 * coalesce((
                       select count(*) from public.battle_units al
                        where al.battle_id = u.battle_id and al.alive
                          and al.side = u.side and al.id <> u.id
                          and al.hp > al.max_hp * 0.5), 0)) else 0 end
              -- копилка перков, сработавших на чужом ходу
              + greatest(0, coalesce((u.pk->>'bank')::numeric, 0)),
         drain = 0,
         shield = 0,
         stance = case when u.stance = 'siege' then 'siege' else 'off' end,
         amp = 0, hard = 0, pdb = 0, guard = 0, rapid = false, sammo = false,
         stealth = u.stealth - u.cloak, cloak = 0,
         sensor  = u.sensor + u.blind,  blind = 0,
         pk = (coalesce(u.pk,'{}'::jsonb) - 'bank') - 'ride',
         mcd = coalesce((
           select jsonb_object_agg(k, v::int - 1)
             from jsonb_each_text(coalesce(u.mcd,'{}'::jsonb)) as e(k, v)
            where v::int - 1 > 0
         ), '{}'::jsonb),
         deb = coalesce((
           select jsonb_object_agg(k, v::int - 1)
             from jsonb_each_text(coalesce(u.deb,'{}'::jsonb)) as e(k, v)
            where v::int - 1 > 0
         ), '{}'::jsonb)
   where u.battle_id = p_battle and u.side = p_side;
end$$;

-- ══════════════════════════════════════════════════════════════════
--  ПАТЧИ БОЕВЫХ ФУНКЦИЙ: «Путь мученика» в обеих точках урона,
--  ветка «Перехват контура», честный подсчёт сторон и возврат пленных.
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._bt_hit(p_target uuid, p_dmg numeric, p_k text, p_terr jsonb, p_pierce boolean DEFAULT false, p_src uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t record; rk numeric; rsh numeric; dmgfac numeric := 1;
        gdmg numeric; absb numeric := 0; use_sec numeric; hull numeric; killed boolean;
        gid uuid; redirected boolean := false;
begin
  -- «Эгида»: удар по прикрытому союзнику переадресуется гвардейцу целиком —
  -- вместе со щитом, бронёй и корпусом. Считаем ДО блокировки строки цели.
  gid := public._bt_guard_for(p_target);
  if gid is not null then p_target := gid; redirected := true; end if;

  select * into t from public.battle_units where id = p_target for update;
  if t.id is null or not t.alive then return jsonb_build_object('hull',0,'shield_absorbed',0,'killed',false); end if;

  rsh := greatest(0, coalesce(t.shield, 0));
  if p_pierce then rsh := 0; end if;                    -- таран идёт сквозь поле
  if public._bt_terra(p_terr, t.x, t.y) = 'neb' then rsh := 0; dmgfac := 0.7; end if;
  if public._bt_terra(p_terr, t.x, t.y) = 'deb' then dmgfac := 0.85; end if;
  -- «Эгида» / импульс брони
  dmgfac := dmgfac * (1 - least(0.8, greatest(0, coalesce(t.hard, 0))));

  rk := least(0.9, greatest(-0.75, coalesce((t.resist->>coalesce(p_k,'kinetic'))::numeric, 0)));
  -- «Разрывной таран» вспорол обшивку — стойкости работают хуже
  if public._bt_deb_has(t.deb, 'soft') then rk := rk * 0.7; end if;
  if coalesce(p_k,'kinetic') = 'missile' then
    rk := 1 - (1 - rk) * (1 - least(0.6, coalesce(t.pd,0) + coalesce(t.pdb,0)));
  end if;
  -- ТАРАН: пробойка бьёт в обшивку в упор — стойкости успевают рассеять треть
  if p_pierce then rk := greatest(0, rk) * 0.35; end if;
  gdmg := p_dmg * (1 - rk) * dmgfac;

  if rsh > 0 and gdmg > 0 then
    use_sec := least(rsh, gdmg / greatest(1, t.mitig));
    absb    := use_sec * t.mitig * t.reduc;
    rsh     := rsh - use_sec;
  end if;

  -- плоская броня таран тоже не держит: удар приходится не в плиту, а сквозь неё
  hull := greatest(gdmg * 0.10, (gdmg - absb) - case when p_pierce then 0 else t.armor end);
  if gdmg <= 0 then hull := 0; end if;
  killed := (t.hp - hull) <= 0;
  update public.battle_units
     set shield = case when p_pierce then shield else rsh end,
         hp = greatest(0, t.hp - hull), alive = not killed
   where id = p_target;
  if redirected and hull > 0 then
    perform public._bt_log(t.battle_id, format('«Эгида» %s принимает удар на себя: %s урона%s',
      t.unit_name, round(hull), case when killed then ' — гвардеец уничтожен' else '' end));
  end if;

  -- «Путь мученика»: пастырь рядом забрал половину боли — цель могла ожить
  if public._bt_perk_martyr(p_target, hull) then
    select bu.alive into killed from public.battle_units bu where bu.id = p_target;
    killed := not killed;
  end if;

  -- ── ПЕРКИ ЦЕЛИ ───────────────────────────────────────────────
  if killed then
    if public._bt_perk_save(p_target) then killed := false;              -- «Пульс покойника»
    else perform public._bt_grave_add(t.battle_id, t.x, t.y); end if;    -- обломки для «Некрофилии»
  end if;
  if not killed then
    perform public._bt_perk_block(p_target, absb);                       -- «Альтаанская стойкость»
    perform public._bt_perk_side(p_target, absb + hull, p_src);          -- «Наклонности»
    perform public._bt_perk_despair(p_target);                           -- «Отчаяние»
  end if;

  return jsonb_build_object('hull', round(hull), 'shield_absorbed', round(absb),
                            'killed', killed, 'guard', redirected);
end$function$;

CREATE OR REPLACE FUNCTION public._bt_do_fire(p_battle uuid, p_unit uuid, p_target uuid, p_fid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        ride int := 0;
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
  if coalesce(u.rapid, false) then fcost := fcost * 0.5; end if;   -- беглый огонь
  fcost := fcost * public._bt_perk_kchau(u.perks, u.stance);       -- «Кчау» вне разгона
  if u.tp + 1e-9 < fcost then
    raise exception '«%» не успевает дать залп: нужно % c, осталось % c',
      u.unit_name, round(fcost, 1), round(u.tp, 1);
  end if;
  if u.stance = 'wpn'   then boost := public._bt_wpn_mult(); end if;   -- ФОРСАЖ ОРУДИЙ
  if u.stance = 'siege' then                                          -- ОСАДНЫЙ РЕЖИМ
    boost := public._bt_siege_dmg();
    rmul  := public._bt_siege_rng();
  end if;
  boost := boost * (1 + coalesce(u.amp, 0));
  if public._bt_deb_has(u.deb, 'wbreak') then boost := boost * 0.5; end if;   -- «Ломовик»
  if public._bt_deb_has(u.deb, 'fury')   then boost := boost * 1.30; end if;  -- «Жажда крови»
  -- «Капитан-конформист»: за ход не сдвинулся — станки вышли на точность
  if public._bt_pk_has(u.perks, 'perk.conformist') and not coalesce(u.moved, false) then
    boost := boost * 1.25; rmul := rmul * 1.25;
  end if;
  -- «Бимрайдер»: разгон копился по гексам, сгорает этим залпом
  if public._bt_pk_has(u.perks, 'perk.beamrider') and u.cls = 'destroyer' then
    ride := least(5, greatest(0, coalesce((u.pk->>'ride')::int, 0)));
    boost := boost * (1 + 0.05 * ride);
  end if;

  select * into t from public.battle_units where id = p_target and battle_id = p_battle for update;
  if t.id is null or not t.alive then raise exception 'цели нет'; end if;

  if t.side <> u.side then
    declare g uuid; begin
      g := public._bt_guard_for(t.id);
      if g is not null then
        perform public._bt_log(p_battle, format('«Эгида» перехватывает залп, назначенный %s', t.unit_name));
        p_target := g;
        select * into t from public.battle_units where id = p_target and battle_id = p_battle for update;
      end if;
    end; end if;
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
    perform public._bt_perk_heal(p_unit, healed);            -- «Сияй другим»
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
  dmgfac := dmgfac * (1 - least(0.8, greatest(0, coalesce(t.hard, 0))));   -- броневой замок цели
  if public._bt_deb_has(t.deb, 'soft') then dmgfac := dmgfac * 1.2; end if;   -- обшивка вспорота

  for wg in select value from jsonb_array_elements(
      case when u.wpn is null or jsonb_array_length(u.wpn) = 0
           then jsonb_build_array(jsonb_build_object('rng',u.rng,'dmg',u.dmg))
           else u.wpn end) loop
    if coalesce(wg->>'k','kinetic') <> 'repair' then
      -- Дальность группы: осадный режим и «Конформист» раздвигают рубеж.
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
          rk := 1 - (1 - rk) * (1 - least(0.6, coalesce(t.pd,0) + coalesce(t.pdb,0)));
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
  -- «Путь мученика»: половина урона уходит на пастыря в 4 гексах
  if public._bt_perk_martyr(p_target, hull) then
    select bu.alive into killed from public.battle_units bu where bu.id = p_target;
    killed := not killed;
  end if;
  update public.battle_units
     set fired = true, flash = true, tp = greatest(0, tp - fcost),
         pk = coalesce(pk,'{}'::jsonb) - 'ride'     -- разгон «Бимрайдера» сгорел
   where id = p_unit;

  perform public._bt_log(p_battle, format('%s → %s: %s урона%s%s%s%s',
    u.unit_name, t.unit_name, round(absorbed + hull),
    case when u.stance = 'siege' then ' (осадный режим)'
         when boost > 1 then ' (форсаж орудий)' else '' end,
    case when ride > 0 then format(' (разгон +%s%%)', ride * 5) else '' end,
    case when resisted >= 1 then format(' (броня рассеяла %s)', round(resisted)) else '' end,
    case when killed then ' — цель уничтожена' else '' end));

  -- ── ПЕРКИ ЦЕЛИ И СТРЕЛЯВШЕГО ─────────────────────────────────
  if killed then
    if public._bt_perk_save(p_target) then killed := false;
    else perform public._bt_grave_add(p_battle, t.x, t.y); end if;
  end if;
  if not killed then
    perform public._bt_perk_block(p_target, absorbed);
    perform public._bt_perk_side(p_target, absorbed + hull, p_unit);
    perform public._bt_perk_despair(p_target);
  else
    perform public._bt_perk_kill(p_unit, 'wpn');            -- «Жажда крови»
  end if;

  if coalesce(u.sammo, false) then
    perform public._bt_deb_add(p_target, 'stasis', 1);
    perform public._bt_log(p_battle, format('%s сажает %s в стазис-поле: следующий ход вдвое дороже',
      u.unit_name, t.unit_name));
  end if;
  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'shield_absorbed', round(absorbed), 'hull', round(hull),
                            'resisted', round(resisted), 'killed', killed, 'healed', 0,
                            'tp', round(u.tp - fcost, 1), 'target_shield', round(rsh, 1));
end$function$;

CREATE OR REPLACE FUNCTION public._bt_do_module(p_battle uuid, p_unit uuid, p_key text, p_target uuid, p_x integer, p_y integer, p_fid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me text; b public.battles; u record; t record; a jsonb;
        cost numeric; cd int; dist int; hit jsonb; res jsonb;
        dmg numeric; a_rng int; val numeric; killed int := 0; healed numeric;
        n int := 0; tx int; ty int; nx int; ny int; step int;
begin
  perform public._bt_arm(p_battle);
  me := p_fid;
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

  cost := public._bt_act_cost(p_key) * public._bt_perk_kchau(u.perks, u.stance);
  if u.tp + 1e-9 < cost then
    raise exception 'на «%» нужно % c, у «%» осталось % c',
      public._bt_act_name(p_key), round(cost,1), u.unit_name, round(u.tp,1);
  end if;

  dmg := coalesce((a->>'dmg')::numeric, 0);
  a_rng := coalesce((a->>'rng')::int, 1);
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
    if dist > a_rng then
      raise exception 'дистанция % — «%» достаёт до % гексов', dist, public._bt_act_name(p_key), a_rng;
    end if;
    if p_key not in ('ram','rupture','nuke','torpedo')
       and not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
      raise exception 'линия огня перекрыта астероидами';
    end if;

    hit := public._bt_hit(t.id, dmg,
             case when p_key in ('ram','rupture') then 'kinetic'
                  when p_key in ('wbreak','disrupt','drain','tartarus') then 'missile'
                  else 'missile' end,
             b.terrain,
             p_key in ('ram','rupture'),             -- тараны идут сквозь щит
             p_unit);                                -- кто бил — для «Наклонностей»
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
    if dist > a_rng then
      raise exception 'дистанция % — «%» достаёт до % гексов', dist, public._bt_act_name(p_key), a_rng;
    end if;
    if p_key not in ('ram','rupture','nuke','torpedo')
       and not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
      raise exception 'линия огня перекрыта астероидами';
    end if;
    tx := t.x; ty := t.y;
    -- накрывает цель и всё вокруг неё, включая своих: это площадь, не выстрел
    for t in select * from public.battle_units
              where battle_id = p_battle and alive and id <> p_unit
                and public._bt_dist(x, y, tx, ty) <= (case when p_key = 'nuke' then 2 else 1 end)
    loop
      hit := public._bt_hit(t.id,
               case when t.x = tx and t.y = ty then dmg
                    when p_key <> 'nuke' then dmg * 0.65
                    when public._bt_dist(t.x, t.y, tx, ty) = 1 then dmg * 0.75
                    else dmg * 0.45 end,
               case when p_key = 'broadside' then 'energy'
                    when p_key = 'nuke' then 'kinetic'    -- подрыв уже не сбить ПРО
                    else 'missile' end,
               b.terrain, false, p_unit);
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
                and public._bt_dist(x, y, u.x, u.y) <= a_rng
    loop
      n := n + 1;
      if p_key = 'hell' then
        hit := public._bt_hit(t.id, dmg, 'energy', b.terrain, false, p_unit);
        if (hit->>'killed')::bool then killed := killed + 1; end if;
      elsif p_key = 'blind' then
        update public.battle_units
           set sensor = greatest(0, sensor - val::int), blind = blind + val::int
         where id = t.id;
      else
        perform public._bt_deb_add(t.id, 'stasis', 1);
      end if;
    end loop;
    if n = 0 then raise exception 'в радиусе % гексов нет ни одного врага', a_rng; end if;
    perform public._bt_log(p_battle, format('%s ◎ %s: задето врагов — %s%s',
      u.unit_name, public._bt_act_name(p_key), n,
      case when killed > 0 then format(', уничтожено %s', killed) else '' end));
    res := jsonb_build_object('hit_n', n, 'killed_n', killed);

  -- ══ ИМПУЛЬС ПО СВОИМ ВОКРУГ ═══════════════════════════════
  elsif p_key in ('pboost','pdup','aboost') then
    for t in select * from public.battle_units
              where battle_id = p_battle and alive and side = u.side
                and public._bt_dist(x, y, u.x, u.y) <= a_rng
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
    if dist > a_rng then raise exception 'дистанция % — достаёт до % гексов', dist, a_rng; end if;
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
      perform public._bt_perk_heal(p_unit, healed);          -- «Сияй другим»
      res := jsonb_build_object('healed', round(healed));
    end if;

  -- ══ ТЯГОВЫЙ ЛУЧ ═══════════════════════════════════════════
  elsif p_key = 'tractor' then
    select * into t from public.battle_units where id = p_target and battle_id = p_battle;
    if t.id is null or not t.alive then raise exception 'цели нет'; end if;
    if t.side = u.side then raise exception 'тяговый луч — для чужих бортов'; end if;
    dist := public._bt_dist(u.x, u.y, t.x, t.y);
    if dist > a_rng then raise exception 'дистанция % — луч достаёт до % гексов', dist, a_rng; end if;
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
    if dist < 1 or dist > a_rng then raise exception 'прыжок бьёт на % гексов, а до цели %', a_rng, dist; end if;
    if exists(select 1 from public.battle_units
               where battle_id = p_battle and alive and x = p_x and y = p_y) then
      raise exception 'гекс %:% занят', p_x, p_y;
    end if;
    if u.stance = 'siege' then raise exception 'из разложенной осады не прыгают'; end if;
    update public.battle_units set x = p_x, y = p_y, moved = true where id = p_unit;
    perform public._bt_log(p_battle, format('%s уходит прыжком на %s гекс(ов)', u.unit_name, dist));
    perform public._bt_perk_necro(p_battle, p_unit);          -- обломки под килем
    res := jsonb_build_object('x', p_x, 'y', p_y);

  -- ══ ПЕРЕХВАТ КОНТУРА (перк «Машинного разума») ═════════════
  elsif p_key = 'hijack' then
    if not public._bt_pk_has(u.perks, 'perk.hijack') then
      raise exception 'перехват контура держится на карточке экипажа «Перехват контура» — её на борту нет';
    end if;
    select * into t from public.battle_units where id = p_target and battle_id = p_battle for update;
    if t.id is null or not t.alive then raise exception 'цели нет'; end if;
    if t.side = u.side then raise exception 'перехватывать своих незачем'; end if;
    if coalesce(t.pk,'{}'::jsonb) ? 'hj' then
      raise exception '«%» уже под чужим контуром', t.unit_name;
    end if;
    dist := public._bt_dist(u.x, u.y, t.x, t.y);
    if dist > a_rng then
      raise exception 'дистанция % — перехват достаёт до % гексов', dist, a_rng;
    end if;
    -- Оригинальная принадлежность уезжает в pk.hj: по ней борт вернут домой
    -- и по ней же _bt_check_end считает, чья это единица на самом деле.
    update public.battle_units
       set side = u.side, fid = u.fid,
           acted = true, tp = 0,     -- в ход перехвата борт уже отработал
           pk = coalesce(pk,'{}'::jsonb) || jsonb_build_object('hj',
                  jsonb_build_object('s', t.side, 'f', t.fid, 'u', b.turn_no + 4))
     where id = t.id;
    perform public._bt_log(p_battle, format(
      '%s перехватывает контур «%s»: борт воюет за чужих 2 хода', u.unit_name, t.unit_name));
    res := jsonb_build_object('hijack', t.id);

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
    update public.battle_units
       set hard = greatest(hard, val), guard = greatest(guard, greatest(1, rng))
     where id = p_unit;
    perform public._bt_log(p_battle, format('%s поднимает «Эгиду»: удары по соседним своим идут в него, входящий −%s%%',
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
    perform public._bt_mcd_cut(p_unit, greatest(1, val::int));
    perform public._bt_log(p_battle, format('%s перезапускает шину снаряжения: −%s ход(а) со всех кулдаунов',
      u.unit_name, greatest(1, val::int)));
    res := jsonb_build_object('reboot', greatest(1, val::int));

  else
    raise exception 'неизвестное снаряжение «%»', p_key;
  end if;

  -- «Серийный ресайклер»: последний удар нанёс МОДУЛЬ
  if killed > 0 then perform public._bt_perk_kill(p_unit, 'mod'); end if;

  perform public._bt_use_act(p_battle, p_unit);
  update public.battle_units
     set tp  = greatest(0, tp - cost),
         mcd = coalesce(mcd,'{}'::jsonb)
               || jsonb_build_object(p_key, public._bt_perk_cd(u.perks, (a->>'cd')::int))
   where id = p_unit;

  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'key', p_key,
                            'tp', round(u.tp - cost, 1),
                            'cd', public._bt_perk_cd(u.perks, (a->>'cd')::int)) || coalesce(res, '{}'::jsonb);
end$function$;

CREATE OR REPLACE FUNCTION public._bt_check_end(p_battle uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record; a_alive int; d_alive int; a_pool int; d_pool int;
        win text; is_bot boolean;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status = 'done' then return; end if;
  if b.status <> 'active' then return; end if;

  -- Перехваченный «Машинным разумом» борт временно числится за захватчиком.
  -- Считать его чужим нельзя: иначе перехват ПОСЛЕДНЕГО вражеского корабля
  -- мгновенно заканчивал бы бой победой. Смотрим на РОДНУЮ сторону из pk.hj.
  select count(*) filter (where coalesce(pk->'hj'->>'s', side) = 'attacker'),
         count(*) filter (where coalesce(pk->'hj'->>'s', side) = 'defender')
    into a_alive, d_alive
    from public.battle_units where battle_id = p_battle and alive;

  -- это текущий админский бой с ботами?
  select exists(select 1 from public.admin_bot_duel where one = 1 and battle_id = p_battle)
    into is_bot;

  if is_bot then
    -- исход только по живым: у кого пусто на доске — тот проиграл
    if a_alive = 0 then win := b.defender_fid;      -- игрок выбит → победа ботов
    elsif d_alive = 0 then win := b.attacker_fid;   -- боты выбиты → победа игрока
    end if;
  else
    -- обычные бои: нет живых И резерв (реальные флоты) кончился
    select coalesce(jsonb_array_length(public.battle_pool(p_battle, b.attacker_fid)),0) into a_pool;
    select coalesce(jsonb_array_length(public.battle_pool(p_battle, b.defender_fid)),0) into d_pool;
    if a_alive = 0 and a_pool = 0 then win := b.defender_fid;
    elsif d_alive = 0 and d_pool = 0 then win := b.attacker_fid;
    end if;
  end if;

  if win is null then return; end if;
  perform public._bt_finish(p_battle, win);
end$function$;

CREATE OR REPLACE FUNCTION public._bt_do_end_turn(p_battle uuid, p_fid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  perform public._bt_hijack_tick(p_battle);   -- вернуть отгулявших своё пленников
  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true);
end$function$;
