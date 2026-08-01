-- ════════════════════════════════════════════════════════════
-- НАНО-ОРУДИЯ = РЕМОНТНЫЙ РОЙ (лечат союзников в бою)
-- ────────────────────────────────────────────────────────────
-- Что меняется:
--  §1 _tg_carriers  — технология nano носится ТОЛЬКО средним крейсером
--                     (гиперкрейсер/«Факельщик», линкоры и станции — нет).
--  §2 _tg_stats     — у nano канал 'repair' и поле heal (= 0.5 × «урона»).
--  §3 _cn_wpn_obj   — ремонтная турель в проекте юнита даёт dmg = 0
--                     (в атакующую сводку корабля не идёт), несёт _heal.
--  §4 _bt_stats     — резолв СВОИХ орудий (turretId) в огневые группы + канал
--                     'repair'. До этой правки орудия верфи в бою вообще
--                     не находились: _bt_stats искал их в каталоге по {g,idx}.
--  §5 battle_fire   — цель на СВОЕЙ стороне разрешена, если у стрелка есть
--                     ремонтные группы: они возвращают союзнику корпус.
--                     По врагу ремонтные группы не работают; себя не чинят.
--
-- Порядок применения: ПОСЛЕ _turret_forge.sql, _turret_forge_units.sql,
-- _turret_price_science.sql, _war_battle_tactics.sql / _battle_no_arcs.sql.
-- Базой взяты ЖИВЫЕ тела функций из базы. Идемпотентно.
-- ════════════════════════════════════════════════════════════

-- ── §1. Носители: nano — только средний крейсер ──────────────
create or replace function public._tg_carriers(p_cfg jsonb, p_stats jsonb)
returns text[] language sql stable set search_path=public as $$
  select coalesce(array_agg(c.key order by c.ord), '{}'::text[])
  from (
    select e.value #>> '{}' as key, e.ordinality as ord
    from jsonb_array_elements(
           coalesce(public._tg_dict()->'classCarriers'->(p_cfg->>'klass'),
                    public._tg_dict()->'classCarriers'->'medium')) with ordinality e
  ) c
  where (p_stats->>'mass')::numeric   <= (public._tg_dict()->'carriers'->c.key->>'mass')::numeric
    and (p_stats->>'energy')::numeric <= (public._tg_dict()->'carriers'->c.key->>'power')::numeric
    -- ЗЕРКАЛО TECH_CARRIERS в turret_gen.js: ремонтный рой ставится только
    -- на средний крейсер. Гиперкрейсеру и всему тяжелее он не положен.
    and (coalesce(p_cfg->>'tech','') <> 'nano' or c.key = 'mediumCruiser')
$$;
grant execute on function public._tg_carriers(jsonb,jsonb) to authenticated;

-- ── §2. ТТХ орудия: канал repair и величина ремонта ──────────
-- Тело — живое из _turret_price_science.sql, изменены только kind/heal в конце.
create or replace function public._tg_stats(p_input jsonb)
returns jsonb language plpgsql stable set search_path=public as $$
declare
  d jsonb := public._tg_dict();
  cfg jsonb := public._tg_norm(p_input);
  T jsonb; K jsonb; R jsonb;
  refCfg jsonb; refC jsonb; C jsonb;
  v_tech text; kls text;
  kal double precision; n double precision;
  rof numeric; mass numeric; damage numeric;
  base double precision; energy numeric; price numeric;
  resurs jsonb; gs numeric := 0; on_ numeric := 1;
  refCal double precision; barrelMatters boolean; dal double precision; dalnost int;
  kind text; billKind text; bill jsonb := '{}'::jsonb;
  heal numeric := 0;
  TG_HEAL_K constant numeric := 0.5;   -- зеркало HEAL_K в turret_gen.js
begin
  rof := public._tg_rof(cfg);
  cfg := cfg || jsonb_build_object('rof', rof);
  kls := cfg->>'klass'; v_tech := cfg->>'tech';
  T := coalesce(d->'techs'->v_tech, d->'techs'->'ehs');
  K := coalesce(d->'classes'->kls, d->'classes'->'medium');
  R := coalesce(d->'rules'->kls, d->'rules'->'medium');
  kal := (cfg->>'caliber')::double precision;
  n   := (cfg->>'barrels')::double precision;

  C := public._tg_core(cfg);
  mass := (C->>'mass')::numeric; damage := (C->>'damage')::numeric;

  base := coalesce((d->'powerBase'->>kls)::double precision, 500);
  refCfg := cfg || jsonb_build_object(
    'tech', case when (R->'techs') ? 'ehs' then 'ehs' else R->'techs'->>0 end,
    'caliber', greatest((R->'cal'->>0)::numeric,
                least((R->'cal'->>1)::numeric,
                      coalesce((d->'powerRef'->>kls)::numeric, 130))),
    'barrels', 1,
    'barrelLen', greatest((R->'len'->>0)::numeric, least((R->'len'->>1)::numeric, 50)),
    'size', 1, 'layout', 'row');
  refCfg := refCfg || jsonb_build_object('rof', public._tg_rof(refCfg));
  refC := public._tg_core(refCfg);
  energy := greatest(1, round((base * (T->>'pw')::double precision
            * power(damage::double precision
                    / greatest(1,(refC->>'damage')::double precision), 0.8))::numeric));

  price := 55800 * power(kal, 0.402) * power(mass::double precision, 0.157)
         * power((C->>'tC')::double precision * (C->>'cC')::double precision, 0.338)
         * power(1 + energy::double precision, 0.343) / 1.15;
  price := price * power(n, 0.15);
  price := round(price/1000)*1000;

  resurs := jsonb_build_object(
    'blackmetall',   greatest(1, round(mass/900)),
    'coloredmetall', case when v_tech in ('laser','plasma','em') then greatest(1, round(mass/2200)) else 0 end,
    'rudametall',    case when v_tech in ('ehs','kinetic')       then greatest(1, round(mass/1400)) else 0 end,
    'kristall',      case when v_tech in ('laser','plasma')      then greatest(1, round(mass/1800)) else 0 end,
    'staarvis',      case when v_tech in ('rail','em') or kls='super' then greatest(1, round(mass/6000)) else 0 end);

  refCal := coalesce((d->'powerRef'->>kls)::double precision, 130);
  barrelMatters := (T->>'kind') in ('gun','rail');
  dal := coalesce((d->'rangeBase'->>kls)::double precision, 3) * (T->>'dl')::double precision
       * power(kal/refCal, 0.55)
       * (case when barrelMatters
               then power(greatest(10,(cfg->>'barrelLen')::double precision)/50, 0.55) else 1 end)
       * coalesce((d->'rangeLayout'->>public._tg_eff_layout(cfg))::double precision, 1);
  dalnost := greatest(1, least(40, round(dal::numeric)::int));

  gs := greatest(5, round((3.2 * power(damage::double precision, 0.86)
        * power(1 + dalnost::double precision/12, 0.55)
        * power(1 + energy::double precision/400, 0.18))::numeric));
  on_ := greatest(1, least(60, round((0.30*power(damage::double precision,0.42))::numeric, 1)));

  -- КАНАЛ. nano — не боевой: рой не грызёт чужую броню, а латает свой корпус.
  kind := case when v_tech = 'nano' then 'repair'
               when v_tech = 'missile' then 'missile'
               when v_tech in ('laser','plasma') then 'energy' else 'kinetic' end;
  if kind = 'repair' then heal := greatest(1, round(damage * TG_HEAL_K)); end if;

  billKind := case when v_tech = 'missile' then 'missile'
                   when v_tech in ('laser','plasma','em') then 'energy' else 'kinetic' end;
  if billKind = 'missile' then
    bill := public._cn_bill_add(bill, 'Изотопы', damage/150);
  elsif billKind = 'energy' then
    bill := public._cn_bill_add(bill, 'Редкоземельные руды', damage/180);
    bill := public._cn_bill_add(bill, 'Гелий-3', damage/400);
  else
    bill := public._cn_bill_add(bill, 'Железо', damage/120);
  end if;

  return jsonb_build_object(
    'ok', true,
    'damage', damage, 'heal', heal, 'price', price, 'gs', gs, 'on', on_, 'bill', bill,
    'mass', mass, 'energy', energy, 'crew', 0, 'dalnost', dalnost,
    'rof', rof, 'caliber', kal, 'barrels', n::int, 'kind', kind,
    'salvo', (C->>'one')::numeric,
    'tC', C->'tC', 'dC', C->'dC', 'cC', C->'cC',
    'resurs', resurs,
    'kvTech', T->>'kvTech', 'kvDmg', T->>'kvDmg', 'kvClass', K->>'kvClass',
    'klassRu', K->>'ru');
end$$;
grant execute on function public._tg_stats(jsonb) to authenticated;

-- Пересчитать уже зарегистрированные орудия: у нано-сборок появится канал
-- repair, heal и суженный список носителей.
update public.faction_turrets t
   set stats = public._tg_stats(t.cfg),
       carriers = public._tg_carriers(public._tg_norm(t.cfg), public._tg_stats(t.cfg))
 where t.cfg->>'tech' = 'nano';

-- ── §3. Резолв орудия в проекте: ремонт не идёт в атаку ──────
create or replace function public._cn_wpn_obj(p_db jsonb, p_class text, w jsonb)
returns jsonb language plpgsql stable as $fn$
declare tur public.faction_turrets; o jsonb; v_heal numeric;
begin
  if nullif(w->>'turretId','') is not null then
    select * into tur from public.faction_turrets where id = (w->>'turretId')::uuid;
    if not found then raise exception 'custom turret not found'; end if;
    if not (tur.owner_id = auth.uid() or tur.faction_id is null
            or tur.faction_id = public._ec_my_fid_opt()) then
      raise exception 'custom turret not accessible';
    end if;
    if not (tur.carriers @> array[p_class]) then
      raise exception 'орудие «%» не встаёт на носитель этого класса', tur.name;
    end if;
    -- Ремонтный рой: урона нет вовсе, в атакующую сводку проекта не идёт.
    v_heal := case when tur.stats->>'kind' = 'repair'
                   then coalesce((tur.stats->>'heal')::numeric,
                                 round(coalesce((tur.stats->>'damage')::numeric,0) * 0.5))
                   else 0 end;
    return jsonb_build_object(
      'name',         '⚙ ' || tur.name,
      'dmg',          case when v_heal > 0 then to_jsonb(0)
                           else coalesce(tur.stats->'damage', to_jsonb(0)) end,
      'energy',       coalesce(tur.stats->'energy',  to_jsonb(0)),
      'dalnost',      coalesce(tur.stats->'dalnost', to_jsonb(0)),
      'crewRequired', 0,
      'resurs',       '{}'::jsonb,
      '_gs',          coalesce(tur.stats->'gs', to_jsonb(0)),
      '_heal',        to_jsonb(v_heal),
      '_kind',        coalesce(tur.stats->>'kind','kinetic'),
      '_turret',      true);
  end if;
  o := p_db->'weapons'->(w->>'g')->coalesce((w->>'idx')::int,-1);
  if o is null then raise exception 'bad weapon'; end if;
  return o || jsonb_build_object('_kind', public._cn_wpn_kind(o->>'name'));
end$fn$;
grant execute on function public._cn_wpn_obj(jsonb,text,jsonb) to authenticated;

-- ── §4. Огневые группы боя: свои орудия + канал repair ───────
-- ⚠ Здесь же чинится давняя дыра: орудия оружейной верфи (turretId) в бою
-- НЕ находились — _bt_stats искал их в каталоге Кваквантора по {g,idx},
-- где группы «⚙ Свои орудия» нет. Теперь ТТХ берутся из faction_turrets.
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
           'rng', gg.rng, 'dmg', round(gg.sum_dmg), 'k', gg.k, 'shots', gg.shots, 'bat', gg.bat)), '[]'::jsonb)
    into wpn
    from (select * from g_auto union all select * from g_man) gg;

  -- дальность корабля = самая длинная БОЕВАЯ группа (ремонт сюда не считаем)
  select coalesce(max((g->>'rng')::int), 1) into rng
    from jsonb_array_elements(wpn) g where coalesce(g->>'k','kinetic') <> 'repair';
  if rng is null or not exists(select 1 from jsonb_array_elements(wpn) g
                                where coalesce(g->>'k','kinetic') <> 'repair') then
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

-- ── §5. Огонь: ремонт союзника нано-роем ─────────────────────
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
        ally boolean; heal_sum numeric := 0; healed numeric := 0;
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

  ally := (t.side = u.side);
  dist := public._bt_dist(u.x, u.y, t.x, t.y);

  -- ══ РЕМОНТ СОЮЗНИКА (нано-рой) ═════════════════════════════
  -- Цель на своей стороне разрешена ТОЛЬКО ремонтными группами (k='repair')
  -- и ТОЛЬКО по другому кораблю: рой уходит наружу, себя им не залатать.
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
    -- туманность рассеивает рой так же, как залп
    if public._bt_terra(b.terrain, t.x, t.y) = 'neb' then heal_sum := heal_sum * 0.7; end if;
    healed := least(round(heal_sum), greatest(0, t.max_hp - t.hp));
    if healed <= 0 then raise exception '«%» и так цел — ремонтировать нечего', t.unit_name; end if;

    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units set hp = least(max_hp, hp + healed) where id = p_target;
    -- рой светится не хуже выстрела: позиция ремонтника раскрыта
    update public.battle_units set fired = true, flash = true where id = p_unit;
    perform public._bt_log(p_battle, format('%s ⟳ %s: нано-рой восстановил %s корпуса',
      u.unit_name, t.unit_name, round(healed)));
    return jsonb_build_object('ok', true, 'healed', round(healed), 'hull', 0,
                              'shield_absorbed', 0, 'resisted', 0, 'killed', false);
  end if;

  -- ══ ОБЫЧНЫЙ ЗАЛП ═══════════════════════════════════════════
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

  rsh := t.shield;
  if public._bt_terra(b.terrain, t.x, t.y) = 'neb' then rsh := 0; dmgfac := 0.7; end if;
  if public._bt_terra(b.terrain, t.x, t.y) = 'deb' then dmgfac := 0.85; end if;
  shcap := greatest(1, t.max_shield * sh_hard);

  for wg in select value from jsonb_array_elements(
      case when u.wpn is null or jsonb_array_length(u.wpn) = 0
           then jsonb_build_array(jsonb_build_object('rng',u.rng,'dmg',u.dmg))
           else u.wpn end) loop
    -- ремонтный рой по врагу не работает: он латает броню, а не режет её
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
  update public.battle_units set fired = true, flash = true where id = p_unit;

  perform public._bt_log(p_battle, format('%s → %s: %s урона%s%s',
    u.unit_name, t.unit_name, round(absorbed + hull),
    case when resisted >= 1 then format(' (броня рассеяла %s)', round(resisted)) else '' end,
    case when killed then ' — цель уничтожена' else '' end));

  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'shield_absorbed', round(absorbed), 'hull', round(hull),
                            'resisted', round(resisted), 'killed', killed, 'healed', 0);
end$$;
revoke all on function public.battle_fire(uuid,uuid,uuid) from public;
grant execute on function public.battle_fire(uuid,uuid,uuid) to authenticated;

-- Пересеять огневые группы уже высаженных кораблей (появятся свои орудия и ремонт).
update public.battle_units bu
   set wpn = coalesce(public._bt_stats(bu.unit_id)->'wpn', bu.wpn)
 where bu.alive and bu.unit_id is not null;
