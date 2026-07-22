-- ОТКАТ боёвки: восстановить рабочую _bt_stats.
-- Причина поломки: в живой БД в _bt_stats вписали проверку «есть ли на корабле
-- что-то» (оружие/модули), из-за которой функция стала возвращать NULL для
-- части проектов. Следствие: в ростере null HP/урон/ход/«бьёт до», а при
-- высадке — «проект корабля не найден» (_war_battle_tactics.sql, battle_deploy).
-- Здесь — версия из репозитория (без этой проверки): NULL только если проекта
-- реально нет в faction_units; иначе ТТХ считаются с дефолтами.
-- Применять в SQL-редакторе Supabase. Идемпотентно (create or replace).

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
  cab := public._cn_catalog();

  -- орудийные группы: (сектор, дальность) → суммарный урон
  with mounts as (
    select coalesce(m->'w'->>'g', m->>'g') as g,
           coalesce((m->'w'->>'idx')::int, (m->>'idx')::int) as idx,
           case when m->'pos' is null then 'nose'
                when (m->'pos'->>'x')::numeric < 155 then 'left'
                when (m->'pos'->>'x')::numeric > 165 then 'right'
                else 'nose' end as s,
           1 as q
      from jsonb_array_elements(coalesce(u.data->'layout'->'mounts','[]'::jsonb)) m
     where coalesce(m->'w'->>'g', m->>'g') is not null
    union all
    -- проекты без схемы (старый формат / наземка): орудия-«турели»
    select w->>'g', coalesce((w->>'idx')::int, -1), 'any',
           greatest(1, coalesce((w->>'q')::int, 1))
      from jsonb_array_elements(coalesce(u.data->'weapons','[]'::jsonb)) w
     where u.data->'layout'->'mounts' is null
  ), shots as (
    select m.s,
           greatest(1, least(40, round(coalesce(
             (cab->coalesce(u.category,'ship')->'weapons'->m.g->m.idx->>'dalnost')::numeric, 1))))::int as rng,
           coalesce((cab->coalesce(u.category,'ship')->'weapons'->m.g->m.idx->>'dmg')::numeric, 0) * m.q as dmg,
           -- тип урона для стойкостей брони: ballistic→kinetic
           case public._cn_wpn_kind(cab->coalesce(u.category,'ship')->'weapons'->m.g->m.idx->>'name')
             when 'missile' then 'missile' when 'energy' then 'energy' else 'kinetic' end as k
      from mounts m
     where cab->coalesce(u.category,'ship')->'weapons'->m.g->m.idx is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('s', gg.s, 'rng', gg.rng, 'dmg', round(gg.sum_dmg), 'k', gg.k)), '[]'::jsonb)
    into wpn
    from (select shots.s, shots.rng, shots.k, sum(shots.dmg) as sum_dmg from shots where shots.dmg > 0 group by shots.s, shots.rng, shots.k) gg;

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
    -- скрытность: база класса + маскирующие модули (транспондер и пр.), кап 12
    'stealth', least(12, public._bt_stealth(cls) + coalesce((sm->'mods'->>'stealth')::int, 0)),
    -- модули в бою: ПРО (доля сбитых ракет), РЭБ (радиус 5), авиакрылья ангаров
    'pd',      least(0.6, greatest(0, coalesce((sm->'mods'->>'pd')::numeric, 0))),
    'jam',     greatest(0, coalesce((sm->'mods'->>'jam')::int, 0)),
    'dejam',   greatest(0, coalesce((sm->'mods'->>'dejam')::int, 0)),
    'eccm',    greatest(0, coalesce((sm->'mods'->>'eccm')::int, 0)),
    'interdict', coalesce((sm->'mods'->>'interdict')::bool, false),
    'stabil',    coalesce((sm->'mods'->>'stabil')::bool, false),
    'wings',   greatest(0, floor(coalesce((sm->'mods'->>'hangar')::numeric, 0) / 300))::int,
    -- стойкости брони проекта (алхимия): гасят урон по типу орудия
    'resist',  coalesce(sm->'armor_resist',
                        '{"kinetic":0,"energy":0,"missile":0}'::jsonb));
end$$;
revoke all on function public._bt_stats(uuid) from public;
