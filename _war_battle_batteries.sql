-- © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
-- ════════════════════════════════════════════════════════════
-- БОЙ: БАТАРЕИ-«СПЕЛЫ» + ХАРАКТЕР ЗАЛПА (Фаза 1, серверное ядро)
-- ════════════════════════════════════════════════════════════
-- ЦЕПОЧКА: применять ПОСЛЕ _unit_catalog + _unit_publish + _war_battle_rework
--          + _war_battle_tactics + _fight_club (последним ПЕРЕД admin_bot_battle).
--          ⚠ каталог перегенерён (rof в слим-орудии) — накатить _unit_catalog.sql заново.
--
-- ИДЕЯ (см. диалог 27.07):
--   • Орудие несёт тип урона (= ключ группы каталога) и скорострельность (rof).
--   • Скорострельность → ТИР ДРОБИН 1..6 (не буквальные выстрелы — иначе 1200 rpm
--     ломает бой). Суммарный урон батареи ~сохраняется, но РАСКЛАДКА разная:
--       — много мелких дробин: броня вычитается из КАЖДОЙ → контр щитам/лёгким;
--       — мало тяжёлых: одна дробина пробивает броню разом → альфа против брони.
--   • Тип урона × стойкость сплава (resist{kinetic,energy,missile}) — множитель дробины.
--   • Батарея = «спел»: залп решается ОДНИМ RPC (не по выстрелу), клиент рисует бёрст.
--
-- Ленивая модель: батареи и стойкости считаются из faction_units по unit_id —
-- схему battle_units НЕ трогаем, battle_deploy/reinforce НЕ переписываем.
-- ════════════════════════════════════════════════════════════

-- ── 1) Скорострельность → тир дробин (1..6) ──────────────────
-- Жёсткий потолок: 1200 rpm ≠ 1200 выстрелов, а «шквальный» тир = 6 дробин.
create or replace function public._bt_shots_tier(rof numeric)
returns int language sql immutable as $$
  select case
    when coalesce(rof,0) <= 1   then 1
    when rof <= 10              then 2
    when rof <= 30              then 3
    when rof <= 100            then 4
    when rof <= 400            then 5
    else                            6
  end;
$$;

-- ── 2) Ключ группы орудия → канал урона (kinetic/energy/missile) ──
-- Каналы совпадают с resist-полями сплавов (_armor_alchemy). Мягкий матч по
-- названию группы; неизвестное → kinetic (безопасный дефолт, множитель 1).
create or replace function public._bt_dmg_channel(grp text)
returns text language sql immutable as $$
  select case
    when grp ~* 'лаз|энерг|луч|плазм|излуч|бластер' then 'energy'
    when grp ~* 'ракет|торпед|камикад|бо[её]в.* част|снаряд.* самонав' then 'missile'
    else 'kinetic'
  end;
$$;

-- ── 3) Батареи проекта (авто-группировка по каналу; ручные группы — Фаза 2) ──
-- Возвращает jsonb-массив: [{key, channel, shots, per_shot, dmg, rng}].
-- Ручная группа: data->weapons[i]->>'battery' (если задана); иначе канал урона.
create or replace function public._bt_batteries(p_unit uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare u record; cab jsonb; cat text; rows jsonb;
begin
  select * into u from public.faction_units where id = p_unit;
  if u.id is null then return '[]'::jsonb; end if;
  cab := public._cn_catalog();
  cat := coalesce(u.category, 'ship');

  with w as (
    select
      -- ссылка на запись каталога орудия по {g, idx}
      cab->cat->'weapons'->(e->>'g')->coalesce((e->>'idx')::int, -1) as cw,
      e->>'g'                                               as grp,
      nullif(e->>'battery','')                              as manual
    from jsonb_array_elements(coalesce(u.data->'weapons','[]'::jsonb)) e
  ),
  ww as (
    select
      coalesce(w.manual, public._bt_dmg_channel(w.grp))     as bkey,
      public._bt_dmg_channel(w.grp)                         as channel,
      coalesce((w.cw->>'dmg')::numeric, 0)                  as dmg,
      coalesce((w.cw->>'dalnost')::numeric, 0)              as rng,
      public._bt_shots_tier((w.cw->>'rof')::numeric)        as tier
    from w
    where w.cw is not null and coalesce((w.cw->>'dmg')::numeric,0) > 0
  ),
  agg as (
    select
      bkey,
      -- канал батареи = преобладающий (по суммарному урону) канал её орудий
      (array_agg(channel order by dmg desc))[1]             as channel,
      sum(dmg)                                              as dmg,
      max(rng)                                              as rng,
      -- shots = ХАРАКТЕР орудий (урон-взвешенный средний тир), НЕ число стволов:
      -- количество мультиплицирует объём (sum dmg), а не дробность залпа. Иначе
      -- у любого большого корабля shots упирается в потолок и различие теряется.
      greatest(1, least(6, round(sum(tier * dmg) / nullif(sum(dmg),0))::int)) as shots
    from ww
    group by bkey
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',      bkey,
    'channel',  channel,
    'dmg',      round(dmg),
    'rng',      round(rng)::int,
    'shots',    shots,
    'per_shot', round(dmg / shots)
  ) order by dmg desc), '[]'::jsonb) into rows from agg;

  return rows;
end$$;
revoke all on function public._bt_batteries(uuid) from public;

-- ── 4) Стойкости сплава цели {kinetic,energy,missile} ────────
-- Публикатор сплава кладёт resist в summary; фолбэк — нули (тип-преимущества нет).
-- Сначала ЖИВЫЕ стойкости сплава по armorAlloyId (пересчёт сплава виден в бою
-- мгновенно, без перепубликации юнита); фолбэк — замороженный summary.armor_resist;
-- иначе нули (штатная броня — нейтральна).
create or replace function public._bt_resist(p_unit uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(
    (select a.stats->'resist'
       from public.faction_units u
       join public.faction_armor_alloys a
         on a.id = nullif(u.data->>'armorAlloyId','')::uuid
      where u.id = p_unit),
    (select summary->'armor_resist' from public.faction_units where id = p_unit),
    jsonb_build_object('kinetic',0,'energy',0,'missile',0));
$$;
revoke all on function public._bt_resist(uuid) from public;

-- ── 5) Выстрел батареей: залп из N дробин одним RPC ──────────
-- Каждая дробина: eff = per_shot × (1 − resist[channel]); щит съедает первым
-- (общий пул), остаток пробивает броню ПОДРОБИННО → анти-щит vs анти-броня.
create or replace function public.battle_fire_battery(
  p_battle uuid, p_unit uuid, p_target uuid, p_battery int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; u record; t record; dist int;
        bats jsonb; bat jsonb; channel text; shots int; per numeric;
        resist numeric; eff numeric; shield_pool numeric; absorbed numeric;
        hull_total numeric := 0; pierce numeric; floor_dmg numeric;
        i int; killed boolean := false;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if u.fired then raise exception 'этот корабль уже стрелял в этом ходу'; end if;

  bats := public._bt_batteries(u.unit_id);
  if jsonb_typeof(bats) <> 'array' or jsonb_array_length(bats) = 0 then
    raise exception 'у «%» нет боевых батарей', u.unit_name;
  end if;
  bat := bats->coalesce(p_battery, 0);
  if bat is null then raise exception 'нет батареи №%', p_battery; end if;
  channel := bat->>'channel';
  shots   := greatest(1, (bat->>'shots')::int);
  per     := greatest(0, (bat->>'per_shot')::numeric);

  select * into t from public.battle_units where id = p_target and battle_id = p_battle for update;
  if t.id is null or not t.alive then raise exception 'цели нет'; end if;
  if t.side = u.side then raise exception 'по своим не стреляем'; end if;
  dist := public._bt_dist(u.x, u.y, t.x, t.y);
  if dist > (bat->>'rng')::int then
    raise exception 'батарея «%» бьёт на % гексов, до цели %', bat->>'key', bat->>'rng', dist;
  end if;

  perform public._bt_use_act(p_battle, p_unit);

  -- resist может быть ОТРИЦАТЕЛЬНЫМ = уязвимость → eff растёт (тот самый «лом»).
  resist      := greatest(-0.75, least(0.9, coalesce((public._bt_resist(t.unit_id)->>channel)::numeric, 0)));
  eff         := per * (1 - resist);            -- resist −0.5 → ×1.5 урона по этому каналу
  floor_dmg   := eff * 0.05;                    -- минимальный «скол» брони за дробину
  shield_pool := t.shield;

  for i in 1..shots loop
    if shield_pool > 0 then
      absorbed    := least(shield_pool, eff);
      shield_pool := shield_pool - absorbed;
      pierce      := eff - absorbed;            -- перелив дробины сверх щита
    else
      pierce := eff;
    end if;
    if pierce > 0 then
      hull_total := hull_total + greatest(floor_dmg, pierce - t.armor);
    end if;
  end loop;

  hull_total := round(hull_total);
  update public.battle_units
     set shield = shield_pool,
         hp     = greatest(0, t.hp - hull_total),
         alive  = (t.hp - hull_total) > 0
   where id = p_target;
  killed := (t.hp - hull_total) <= 0;
  update public.battle_units set fired = true where id = p_unit;

  perform public._bt_log(p_battle, format('%s [%s×%s %s] → %s: %s урона%s',
    u.unit_name, shots, round(per), channel, t.unit_name, hull_total,
    case when killed then ' — цель уничтожена' else '' end));
  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'battery', bat->>'key', 'channel', channel,
    'shots', shots, 'shield_left', round(shield_pool), 'hull', hull_total, 'killed', killed);
end$$;
revoke all on function public.battle_fire_battery(uuid,uuid,uuid,int) from public;
grant execute on function public.battle_fire_battery(uuid,uuid,uuid,int) to authenticated;

-- ⚠⚠ НЕ ПЕРЕОПРЕДЕЛЯТЬ battle_fire! Боевой огонь живёт в _war_battle_tactics.sql
-- (секторы, ПРО, корма ×2, тип-урона×resist уже там). Ранняя версия этого файла
-- затирала его обёрткой battle_fire_battery — это был РЕГРЕСС, откачено.
-- Функции выше (_bt_shots_tier / _bt_batteries) — задел под скорострельность-«залп»
-- (характер дробин), НЕ подключены к бою. Интегрировать НАДО ВНУТРЬ tactics-battle_fire
-- (per-group shots), а не заменяя его. См. память battle-batteries-salvo.

-- ════════════════════════════════════════════════════════════
-- ОСТАЁТСЯ (следующие фазы):
--   • battle_state: отдавать батареи юнита (public._bt_batteries(unit_id)) для UI.
--   • Публикатор сплава: класть resist в faction_units.summary->'resist'.
--   • Конструктор: ручная группировка орудий (data->weapons[i].battery) + превью.
--   • battle_board.js: выбор батареи вместо одной кнопки «огонь» + анимация бёрста.
-- ════════════════════════════════════════════════════════════
