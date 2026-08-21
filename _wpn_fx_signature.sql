-- ═══════════════════════════════════════════════════════════════
-- ПОЧЕРК ОРУДИЯ (fx) — паспорт для доски боя
-- ───────────────────────────────────────────────────────────────
-- Канал урона (k) у нас ТРИ: кинетика / энергия / ракеты — на них висят
-- стойкости брони, и трогать их нельзя. Но на доске из-за этого рельсотрон,
-- лазер, плазма, ионник, грав-орудие и аннигилятор выглядели одним из трёх
-- мазков: бой читался как мигание.
-- Здесь заводится ВТОРОЙ ключ — 'fx'. Он ничего не считает и ни на что не
-- влияет в бою: это только подпись, по которой клиент (BBFX_S в
-- battle_board.js) выбирает форму снаряда, след и характер попадания.
-- Источник правды двойной:
--   • своя турель из оружейной верфи — cfg->>'tech' (точно, без гаданий);
--   • каталожное орудие — имя, через _cn_wpn_fx (как и канал в _cn_wpn_kind).
-- ═══════════════════════════════════════════════════════════════

-- ── Имя орудия → почерк ────────────────────────────────────────
-- Порядок проверок важен: «плазменная граната» — сначала плазма, а не осколки.
create or replace function public._cn_wpn_fx(p_name text)
returns text language sql immutable as $$
  select case
    when lower(coalesce(p_name,'')) ~ 'нанорой|ремкомплект|ремонтн'            then 'nano'
    when lower(coalesce(p_name,'')) ~ 'аннигил|антиматер|нуль|пустотн'         then 'void'
    when lower(coalesce(p_name,'')) ~ 'гравит|грав-'                           then 'grav'
    when lower(coalesce(p_name,'')) ~ 'плазм'                                  then 'plasma'
    when lower(coalesce(p_name,'')) ~ 'ион|электромагн|эми\M|разряд'           then 'ion'
    when lower(coalesce(p_name,'')) ~ 'лазер|ланцет|излучател|бластер'         then 'laser'
    when lower(coalesce(p_name,'')) ~ 'импульсн'                               then 'ion'
    when lower(coalesce(p_name,'')) ~ 'рельсотрон|гаусс|масс-драйвер|рейлган'  then 'rail'
    when lower(coalesce(p_name,'')) ~ 'торпед|мбр|стратегическ'                then 'torpedo'
    when lower(coalesce(p_name,'')) ~ 'дрон|перехватчик|бомбардировщ|звено'    then 'swarm'
    when lower(coalesce(p_name,'')) ~ 'пусков|ракет|зрк|прк|шахт|нар\M|бч|боева. част' then 'missile'
    when lower(coalesce(p_name,'')) ~ 'осколоч|фугас|картеч|зенитн|гранат|мина' then 'flak'
    else 'ballistic' end
$$;

-- ── Технология своей турели → почерк ───────────────────────────
-- Ключи те же, что в оружейной верфи (turret_gen.js, TECH).
create or replace function public._tg_wpn_fx(p_tech text)
returns text language sql immutable as $$
  select case lower(coalesce(p_tech,''))
    when 'rail'    then 'rail'
    when 'laser'   then 'laser'
    when 'plasma'  then 'plasma'
    when 'em'      then 'ion'
    when 'ew'      then 'ion'
    when 'grav'    then 'grav'
    when 'anti'    then 'void'
    when 'nano'    then 'nano'
    when 'missile' then 'missile'
    when 'explos'  then 'flak'
    else 'ballistic' end
$$;

-- ── _bt_stats: тот же живой расчёт + ключ fx в каждой группе ──
CREATE OR REPLACE FUNCTION public._bt_stats(p_unit uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select m.*, ft.stats as ts, ft.cfg as tc,
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
           -- ПОЧЕРК: чем это выглядит на доске (на расчёт боя не влияет)
           case when s.ts->>'kind' = 'repair' then 'nano'
                when s.tc is not null then public._tg_wpn_fx(s.tc->>'tech')
                else public._cn_wpn_fx(s.co->>'name') end as fx,
           public._bt_shots_tier(coalesce((s.ts->>'rof')::numeric,
                                          (s.co->>'rof')::numeric)) as tier
      from src s
     where s.ts is not null or s.co is not null
  ),
  g_auto as (
    select shots.rng, shots.k, shots.fx, shots.tier as shots, sum(shots.dmg) as sum_dmg, null::text as bat
      from shots where shots.dmg > 0 and shots.battery is null
     group by shots.rng, shots.k, shots.fx, shots.tier
  ),
  g_man as (
    select min(shots.rng) as rng, shots.k,
           -- у сборной батареи почерк берём от САМОГО тяжёлого ствола
           (array_agg(shots.fx order by shots.dmg desc))[1] as fx,
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
           'fx',   gg.fx,
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
end$function$


