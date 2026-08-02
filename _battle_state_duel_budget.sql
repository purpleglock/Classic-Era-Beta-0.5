-- ============================================================
-- ФИКС: в фазе расстановки дуэли клуба не виден лимит по деньгам
-- ============================================================
-- Симптом: на экране расстановки в HUD только «18/50 бортов»,
-- строки с бюджетом нет; игрок набирает состав дороже лимита и
-- ловит отказ уже на кнопке «в бой» (проверка живёт в battle_ready).
--
-- Причина: battle_state НЕ отдавала поле duel_budget. Версия с этим
-- полем есть в _fight_club.sql (рев.8), но поверх неё позже накатили
-- _war_battle_tactics.sql, и та затёрла функцию своей версией без
-- duel_budget. battle_pool при этом cost по каждому проекту отдаёт —
-- клиенту не хватало ровно одного числа, чтобы считать бюджет сам.
--
-- Что делает: берёт ЖИВОЙ исходник battle_state из базы и добавляет
-- в ответ одно поле duel_budget. Больше ничего не меняется —
-- тактическая логика (сигнатуры, РЭБ, захват) остаётся как есть.
-- ============================================================

create or replace function public.battle_state(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b record; sd text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_arm(p_battle);           -- взвести размер доски этого боя
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;

  -- ландшафт генерится лениво один раз (сид = id боя)
  if b.terrain is null then
    update public.battles set terrain = public._bt_gen_terrain(p_battle)
     where id = p_battle and terrain is null;
    select * into b from public.battles where id = p_battle;
  end if;

  return jsonb_build_object(
    'id', b.id, 'status', b.status, 'kind', b.kind,
    'system_id', b.system_id,
    'system_name', (select coalesce(nullif(ms.name,''), ms.id) from public.map_systems ms where ms.id = b.system_id),
    'w', public._bt_w(), 'h', public._bt_h(), 'cap', public._bt_cap(),
    'duel_budget', b.duel_budget,
    'zone', public._bt_zone(), 'acts_max', public._bt_acts(), 'acts_left', b.acts_left,
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
    -- интердикция: мои подкрепления сейчас заблокированы вражеским FTL-заградителем
    'interdicted', public._bt_interdicted(p_battle, sd),
    'log', b.log,
    'terrain', coalesce(b.terrain, '[]'::jsonb),
    'pool', public.battle_pool(p_battle, me),
    'units', (select coalesce(jsonb_agg(
        case when u.side = sd or lk.locked then
          jsonb_build_object(
            'id', u.id, 'side', u.side, 'mine', (u.fid = me),
            'name', u.unit_name, 'cls', u.cls,
            'x', u.x, 'y', u.y, 'facing', u.facing, 'straight', u.straight,
            'hp', round(u.hp), 'max_hp', round(u.max_hp),
            'shield', round(u.shield), 'max_shield', round(u.max_shield),
            'armor', round(u.armor), 'dmg', round(u.dmg),
            'speed', u.speed, 'rng', u.rng,
            'sensor', u.sensor, 'stealth', u.stealth, 'flash', u.flash,
            'pd', u.pd, 'jam', u.jam, 'wings', u.wings, 'is_wing', u.is_wing,
            'dejam', u.dejam, 'eccm', u.eccm, 'interdict', u.interdict, 'stabil', u.stabil,
            'ftl', u.ftl,
            'locked', true,
            'wpn', case when u.side = sd then coalesce(u.wpn, '[]'::jsonb) else null end,
            'resist', u.resist,   -- стойкости брони по типам (виден шов при захвате)
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

-- Проверка: select (public.battle_state('b56052ef-3324-4c75-9c0b-8695c7ae5d0e')->>'duel_budget');  → 204210
